// ============================================
// WE ÖTZI - UNIFIED SERVER
// Express server for local development
// ============================================

// Load environment variables from .env file
try { require('dotenv').config(); } catch (e) { /* dotenv not installed, using system env */ }

const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const archiver = require('archiver');
const fs = require('fs-extra');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { estimatePreQuote } = require('./lib/prequote-estimator');
const emailService = require('./services/email-service');
const emailEventMapping = require('./services/email-event-mapping');

function ensureCronApiToken() {
    if (process.env.CRON_API_TOKEN && String(process.env.CRON_API_TOKEN).trim()) {
        return process.env.CRON_API_TOKEN;
    }

    const envPath = path.join(__dirname, '.env');
    const generatedToken = crypto.randomBytes(32).toString('hex');

    try {
        let envContent = '';
        if (fs.pathExistsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
            const existingMatch = envContent.match(/^CRON_API_TOKEN\s*=\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
            if (existingMatch && existingMatch[1] && existingMatch[1].trim()) {
                process.env.CRON_API_TOKEN = existingMatch[1].trim();
                return process.env.CRON_API_TOKEN;
            }
        }

        const tokenLine = `CRON_API_TOKEN=${generatedToken}`;
        if (/^CRON_API_TOKEN\s*=/m.test(envContent)) {
            envContent = envContent.replace(/^CRON_API_TOKEN\s*=.*$/m, tokenLine);
            fs.writeFileSync(envPath, envContent, 'utf8');
        } else {
            const separator = envContent && !envContent.endsWith('\n') ? '\n' : '';
            fs.appendFileSync(envPath, `${separator}\n# Auto-generated on server startup for n8n currency refresh\n${tokenLine}\n`, 'utf8');
        }

        process.env.CRON_API_TOKEN = generatedToken;
        console.warn('[Config] CRON_API_TOKEN was missing and has been auto-generated in .env');
        return process.env.CRON_API_TOKEN;
    } catch (err) {
        process.env.CRON_API_TOKEN = generatedToken;
        console.warn('[Config] CRON_API_TOKEN was missing. Generated a runtime-only token because .env could not be updated:', err.message);
        return process.env.CRON_API_TOKEN;
    }
}

ensureCronApiToken();

const app = express();
// The beta deployment runs behind Apache/proxy.php, which sets X-Forwarded-For.
// express-rate-limit requires trust proxy to parse client IPs correctly.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4545;
let googleApiModule = null;

function getGoogleApisModule() {
    if (!googleApiModule) {
        // Lazy-load to avoid blocking server boot on heavy module initialization.
        googleApiModule = require('googleapis');
    }
    return googleApiModule;
}

// ============================================
// STABILITY & ERROR HANDLING
// ============================================

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (err) => {
    console.error(' [CRITICAL] Uncaught Exception:', err.message);
    console.error(err.stack);
    // Give PM2 a chance to restart the process cleanly
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(' [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Memory monitoring
setInterval(() => {
    const used = process.memoryUsage();
    if (used.heapUsed > 250 * 1024 * 1024) { // 250MB
        console.warn(` [WARN] High memory usage: ${Math.round(used.heapUsed / 1024 / 1024)}MB. Triggering manual GC if available.`);
        if (global.gc) {
            global.gc();
        }
    }
}, 30000);

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet: Security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disabled — app uses inline scripts and CDN resources
    crossOriginEmbedderPolicy: false
}));

// CORS: Restrict origins
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4545')
    .split(',')
    .map(o => o.trim());

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (server-to-server, curl, mobile apps)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// Rate limiting: General API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' }
});

// Rate limiting: Sensitive endpoints (auth, password)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many authentication attempts, please try again later.' }
});

// Rate limiting: Profile-visit tracking (lightweight per-IP limiter)
const profileVisitLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many profile visit pings.' }
});

// Apply rate limits
app.use('/api/', apiLimiter);
app.use('/api/admin/update-user-password', authLimiter);
app.use('/api/auth/reset-temp-password', authLimiter);
app.use('/api/email/events', authLimiter); // Sensitive: changes routing config

// Middleware for JSON body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// GEMINI API INTEGRATION
// ============================================

/**
 * Generate image using Gemini API
 * POST /api/gemini/generate-image
 * Body: { prompt, model, aspectRatio, imageSize }
 * API key read from process.env (NEVER from frontend)
 */
app.post('/api/gemini/generate-image', async (req, res) => {
    const {
        prompt,
        model,
        aspectRatio,
        imageSize,
        temperature,
        maxOutputTokens,
        safetySettings
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!prompt) {
        return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'Server missing GEMINI_API_KEY environment variable' });
    }

    try {
        const targetModel = model || 'gemini-3-pro-image-preview';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

        // Note: maxOutputTokens should NOT be set for image generation
        // Images are returned as base64 which requires many tokens
        // Setting a low limit causes finishReason: MAX_TOKENS with empty content
        const requestBody = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                responseModalities: ["IMAGE"],
                temperature: temperature !== undefined ? temperature : 0.7,
                // Removed maxOutputTokens - not applicable for image generation
                imageConfig: {
                    aspectRatio: aspectRatio || "1:1",
                    imageSize: imageSize || "1K" // "1K", "2K", "4K" allowed for Gemini 3 Pro
                }
            }
        };

        // Add safety settings if provided
        if (safetySettings) {
            requestBody.safetySettings = safetySettings;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Failed to generate image');
        }

        // Extract image data
        // Response format: candidates[0].content.parts[0].inlineData.data (base64)
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('No image candidates returned');
        }

        // Handle case where parts might be undefined (API returned different structure)
        if (!candidates[0].content?.parts) {
            throw new Error('API response missing image parts. The model may not support image generation or returned text instead.');
        }

        const part = candidates[0].content.parts.find(p => p.inlineData);
        if (!part) {
            throw new Error('No image data found in response');
        }

        const base64Image = part.inlineData.data;
        const mimeType = part.inlineData.mimeType;

        return res.json({
            success: true,
            image: `data:${mimeType};base64,${base64Image}`
        });

    } catch (error) {
        console.error('Gemini API Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// SUPPORT CHAT AGENT (OpenAI GPT + handoff humano)
// ============================================
// Chat de soporte universal para tatuadores, clientes, soporte y visitantes.
// Motor: OpenAI con function calling; handoff bidireccional a agentes humanos.
// Tablas: support_conversations, support_messages, integración con feedback_tickets.

const SUPPORT_CHAT_ENABLED = (process.env.SUPPORT_CHAT_ENABLED || 'true') === 'true';
const SUPPORT_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SUPPORT_CHAT_MAX_TOKENS = parseInt(process.env.SUPPORT_CHAT_MAX_TOKENS || '800', 10);
const SUPPORT_CHAT_ESCALATE_AFTER = parseInt(process.env.SUPPORT_CHAT_ESCALATE_AFTER || '3', 10);

let _openaiClient = null;
function getOpenAIClient() {
    if (_openaiClient) return _openaiClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    try {
        const OpenAI = require('openai');
        _openaiClient = new OpenAI({ apiKey });
        return _openaiClient;
    } catch (err) {
        console.error('[support-chat] OpenAI client init failed:', err.message);
        return null;
    }
}

function _supabaseConfigForSupport() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return { supabaseUrl, serviceKey };
}

async function _supabaseFetch(path, { method = 'GET', body, prefer } = {}) {
    const { supabaseUrl, serviceKey } = _supabaseConfigForSupport();
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase service role not configured');
    const headers = {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
    };
    if (prefer) headers['Prefer'] = prefer;
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Supabase ${method} ${path} failed: ${res.status} ${errText}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function _getAuthUserFromBearer(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const { supabaseUrl, serviceKey } = _supabaseConfigForSupport();
    if (!supabaseUrl || !serviceKey) return null;
    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data && data.id ? data : null;
    } catch { return null; }
}

async function _detectUserRole(userId, email) {
    if (!userId) return null;
    try {
        const artists = await _supabaseFetch(`artists_db?user_id=eq.${userId}&select=id,name,username,email`);
        if (artists && artists.length) return { role: 'artist', profile: artists[0] };
        const clients = await _supabaseFetch(`clients_db?user_id=eq.${userId}&select=id,name,email`);
        if (clients && clients.length) return { role: 'client', profile: clients[0] };
        if (email) {
            const support = await _supabaseFetch(`support_users_db?email=eq.${encodeURIComponent(email)}&select=id,name,is_active`);
            if (support && support.length) return { role: 'support', profile: support[0] };
        }
    } catch (err) {
        console.warn('[support-chat] role detection failed:', err.message);
    }
    return { role: 'anonymous', profile: null };
}

// In-memory rate limit por conversación
const _supportRate = new Map(); // key: conv_id -> { windowStart, count, dayStart, dayCount }
function _rateLimitSupportChat(conversationId) {
    const now = Date.now();
    let entry = _supportRate.get(conversationId);
    if (!entry) {
        entry = { windowStart: now, count: 0, dayStart: now, dayCount: 0 };
        _supportRate.set(conversationId, entry);
    }
    if (now - entry.windowStart > 60 * 1000) { entry.windowStart = now; entry.count = 0; }
    if (now - entry.dayStart > 24 * 60 * 60 * 1000) { entry.dayStart = now; entry.dayCount = 0; }
    entry.count++; entry.dayCount++;
    if (entry.count > 20) return { ok: false, reason: 'Demasiados mensajes seguidos. Espera un momento.' };
    if (entry.dayCount > 200) return { ok: false, reason: 'Límite diario alcanzado.' };
    return { ok: true };
}

function _assertSupportEnabled(res) {
    if (!SUPPORT_CHAT_ENABLED) {
        res.status(503).json({ success: false, error: 'Support chat is disabled' });
        return false;
    }
    return true;
}

// ---- Tool definitions (OpenAI function calling) ----
const SUPPORT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'get_faq',
            description: 'Busca respuestas a preguntas frecuentes sobre la plataforma WeOtzi (registro, cotizaciones, pagos, verificación, job board, etc.).',
            parameters: {
                type: 'object',
                properties: { topic: { type: 'string', description: 'Tema o palabra clave a buscar' } },
                required: ['topic']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_quotation_status',
            description: 'Devuelve el estado de las cotizaciones del usuario autenticado (solo suyas). Requiere usuario logueado.',
            parameters: {
                type: 'object',
                properties: { quotation_id: { type: 'string', description: 'UUID opcional de una cotización específica' } }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_verification_status',
            description: 'Devuelve el estado de verificación del artista autenticado. Solo para usuarios artistas.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_user_tickets',
            description: 'Lista los tickets de soporte abiertos por el usuario.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_ticket',
            description: 'Crea un ticket de soporte cuando el usuario reporta un problema que requiere intervención humana.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    category: { type: 'string', description: 'Categoría: bug, question, billing, account, other' },
                    priority: { type: 'string', description: 'low | medium | high' }
                },
                required: ['title', 'description']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'escalate_to_human',
            description: 'Escala la conversación a un agente humano cuando el bot no puede resolver o el usuario lo solicita.',
            parameters: {
                type: 'object',
                properties: { reason: { type: 'string' } },
                required: ['reason']
            }
        }
    }
];

// ---- FAQ loader (cache en memoria) ----
let _faqCache = null;
let _faqLoadedAt = 0;
async function _loadFaq() {
    const ttl = 5 * 60 * 1000;
    if (_faqCache && (Date.now() - _faqLoadedAt) < ttl) return _faqCache;
    try {
        const faqPath = path.join(__dirname, 'public/shared/js/support-faq.json');
        const data = await fs.readJson(faqPath);
        _faqCache = Array.isArray(data) ? data : (data.items || []);
        _faqLoadedAt = Date.now();
        return _faqCache;
    } catch (err) {
        console.warn('[support-chat] FAQ load failed:', err.message);
        return [];
    }
}

// ---- Tool execution ----
async function _executeTool(toolName, args, ctx) {
    const { conversation, authUser } = ctx;
    const userId = authUser?.id || null;

    if (toolName === 'get_faq') {
        const faq = await _loadFaq();
        const topic = (args.topic || '').toLowerCase();
        const matches = faq.filter(item => {
            const haystack = [item.question, item.answer, ...(item.tags || [])].join(' ').toLowerCase();
            return haystack.includes(topic);
        }).slice(0, 5);
        return matches.length
            ? { matches }
            : { matches: [], message: 'Sin coincidencias directas. Da una respuesta general basada en conocimiento del producto.' };
    }

    if (toolName === 'get_quotation_status') {
        if (!userId) return { error: 'Usuario no autenticado. Pide que inicie sesión.' };
        try {
            const qid = args.quotation_id;
            // Buscar cotizaciones donde el usuario es el cliente (por email del profile o por id)
            let filter = '';
            if (qid) filter = `id=eq.${qid}&`;
            const q = await _supabaseFetch(
                `quotations_db?${filter}or=(user_id.eq.${userId},client_user_id.eq.${userId})&select=id,status,service_type,created_at,updated_at,artist_id&order=created_at.desc&limit=10`
            );
            return { quotations: q || [] };
        } catch (err) {
            return { error: err.message };
        }
    }

    if (toolName === 'get_verification_status') {
        if (!userId) return { error: 'Usuario no autenticado.' };
        try {
            const artist = await _supabaseFetch(
                `artists_db?user_id=eq.${userId}&select=id,name,is_verified,profile_status,verification_notes`
            );
            if (!artist || !artist.length) return { error: 'Este usuario no es un artista.' };
            return { artist: artist[0] };
        } catch (err) {
            return { error: err.message };
        }
    }

    if (toolName === 'get_user_tickets') {
        if (!authUser?.email) return { error: 'Usuario no autenticado.' };
        try {
            const tickets = await _supabaseFetch(
                `feedback_tickets?user_email=eq.${encodeURIComponent(authUser.email)}&select=id,reason,status,created_at&order=created_at.desc&limit=10`
            );
            return { tickets: tickets || [] };
        } catch (err) {
            return { error: err.message };
        }
    }

    if (toolName === 'create_ticket') {
        try {
            const ticket = await _supabaseFetch('feedback_tickets', {
                method: 'POST',
                body: [{
                    reason: args.title || 'Ticket desde chat de soporte',
                    cause: args.category || 'support_chat',
                    message: args.description || '',
                    metadata: {
                        source: 'support_chat',
                        conversation_id: conversation.id,
                        priority: args.priority || 'medium',
                        is_auto_generated: true
                    },
                    user_id: userId,
                    user_email: authUser?.email || null,
                    status: 'open'
                }],
                prefer: 'return=representation'
            });
            const ticketId = Array.isArray(ticket) ? ticket[0]?.id : ticket?.id;
            if (ticketId) {
                await _supabaseFetch(`support_conversations?id=eq.${conversation.id}`, {
                    method: 'PATCH',
                    body: { ticket_id: ticketId, updated_at: new Date().toISOString() },
                    prefer: 'return=minimal'
                });
                return { ticket_id: ticketId, status: 'created' };
            }
            return { error: 'No se pudo crear el ticket.' };
        } catch (err) {
            return { error: err.message };
        }
    }

    if (toolName === 'escalate_to_human') {
        try {
            await _supabaseFetch(`support_conversations?id=eq.${conversation.id}`, {
                method: 'PATCH',
                body: {
                    status: 'awaiting_human',
                    escalation_count: (conversation.escalation_count || 0) + 1,
                    updated_at: new Date().toISOString()
                },
                prefer: 'return=minimal'
            });
            return { status: 'escalated', reason: args.reason || 'unspecified' };
        } catch (err) {
            return { error: err.message };
        }
    }

    return { error: `Tool ${toolName} not implemented.` };
}

function _buildSystemPrompt({ role, profile, pageContext, conversation }) {
    const name = profile?.name || profile?.username || '';
    const greeting = role === 'artist' ? `Estás hablando con un tatuador${name ? ` (${name})` : ''}.`
        : role === 'client' ? `Estás hablando con un cliente${name ? ` (${name})` : ''}.`
        : role === 'support' ? 'Estás hablando con un miembro del equipo de soporte.'
        : 'Estás hablando con un visitante no autenticado.';
    return [
        'Eres el asistente de soporte oficial de WeOtzi, una plataforma para conectar tatuadores con clientes.',
        'Respondes siempre en español neutro rioplatense, con tono cálido, profesional y conciso.',
        greeting,
        pageContext ? `Página actual del usuario: ${pageContext}.` : '',
        'Tienes acceso a herramientas (tools) para consultar cotizaciones, verificación, tickets y FAQ. Úsalas cuando aplique.',
        'Cuando el usuario pida explícitamente hablar con un humano (palabras como "humano", "agente", "persona real"), llama a escalate_to_human.',
        `Si después de ${SUPPORT_CHAT_ESCALATE_AFTER} intentos no puedes resolver, llama a escalate_to_human tú solo.`,
        'Si el usuario reporta un bug reproducible o algo que requiere acción del equipo, crea un ticket con create_ticket.',
        'Nunca inventes datos ni prometas plazos. Si no sabes, dilo y ofrece escalamiento.',
        'Mantén las respuestas en 2-4 oraciones salvo que te pidan algo largo.'
    ].filter(Boolean).join(' ');
}

// ============================================
// ENDPOINT: POST /api/support-chat/conversation
// Crea o recupera una conversación (por anonymous_id o por user_id del JWT)
// ============================================
app.post('/api/support-chat/conversation', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    try {
        const { anonymous_id, page_context } = req.body || {};
        const authUser = await _getAuthUserFromBearer(req);
        const roleInfo = authUser ? await _detectUserRole(authUser.id, authUser.email) : null;

        // Auto-link: si llega JWT + anonymous_id, promover la conversación anónima al user_id
        if (authUser?.id && anonymous_id) {
            try {
                await _supabaseFetch(
                    `support_conversations?anonymous_id=eq.${anonymous_id}&user_id=is.null`,
                    {
                        method: 'PATCH',
                        body: {
                            user_id: authUser.id,
                            user_role: roleInfo?.role || 'anonymous',
                            updated_at: new Date().toISOString()
                        },
                        prefer: 'return=minimal'
                    }
                );
            } catch (err) {
                console.warn('[support-chat] auto-link failed:', err.message);
            }
        }

        // Buscar conversación existente (activa) para este usuario
        let existing = null;
        if (authUser?.id) {
            const rows = await _supabaseFetch(
                `support_conversations?user_id=eq.${authUser.id}&status=neq.closed&order=last_message_at.desc&limit=1`
            );
            existing = rows && rows[0] ? rows[0] : null;
        } else if (anonymous_id) {
            const rows = await _supabaseFetch(
                `support_conversations?anonymous_id=eq.${anonymous_id}&status=neq.closed&order=last_message_at.desc&limit=1`
            );
            existing = rows && rows[0] ? rows[0] : null;
        }

        if (existing) {
            const messages = await _supabaseFetch(
                `support_messages?conversation_id=eq.${existing.id}&order=created_at.asc&limit=50&select=id,role,content,created_at,author_user_id`
            );
            return res.json({ success: true, conversation: existing, messages: messages || [] });
        }

        // Crear nueva
        const payload = [{
            anonymous_id: authUser?.id ? null : (anonymous_id || null),
            user_id: authUser?.id || null,
            user_role: roleInfo?.role || 'anonymous',
            status: 'bot',
            page_context: page_context || null
        }];
        const created = await _supabaseFetch('support_conversations', {
            method: 'POST', body: payload, prefer: 'return=representation'
        });
        const conv = Array.isArray(created) ? created[0] : created;

        // Insertar mensaje de bienvenida
        const welcome = '¡Hola! Soy el asistente de soporte de WeOtzi. ¿En qué puedo ayudarte hoy?';
        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{ conversation_id: conv.id, role: 'assistant', content: welcome, model: SUPPORT_CHAT_MODEL }],
            prefer: 'return=minimal'
        });

        return res.json({ success: true, conversation: conv, messages: [{ role: 'assistant', content: welcome }] });
    } catch (err) {
        console.error('[support-chat] conversation error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ENDPOINT: POST /api/support-chat/message
// Body: { conversation_id, content, page_context }
// Persiste mensaje del usuario, llama al LLM (si status='bot'), persiste respuesta.
// ============================================
app.post('/api/support-chat/message', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    const { conversation_id, content, page_context } = req.body || {};
    if (!conversation_id || !content) {
        return res.status(400).json({ success: false, error: 'conversation_id y content son requeridos' });
    }

    const rl = _rateLimitSupportChat(conversation_id);
    if (!rl.ok) return res.status(429).json({ success: false, error: rl.reason });

    try {
        // Cargar conversación
        const convRows = await _supabaseFetch(`support_conversations?id=eq.${conversation_id}&limit=1`);
        if (!convRows || !convRows.length) return res.status(404).json({ success: false, error: 'Conversación no encontrada' });
        const conv = convRows[0];
        if (conv.status === 'closed') {
            return res.status(400).json({ success: false, error: 'La conversación está cerrada.' });
        }

        const authUser = await _getAuthUserFromBearer(req);
        const roleInfo = authUser ? await _detectUserRole(authUser.id, authUser.email) : { role: 'anonymous', profile: null };

        // Persistir mensaje del usuario
        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{
                conversation_id,
                role: 'user',
                content,
                author_user_id: authUser?.id || null
            }],
            prefer: 'return=minimal'
        });

        // Detectar intención manual de handoff
        const lower = (content || '').toLowerCase();
        const handoffKeywords = ['humano', 'persona real', 'agente real', 'hablar con alguien', 'un agente', 'operador'];
        const wantsHuman = handoffKeywords.some(k => lower.includes(k));

        if (wantsHuman && conv.status === 'bot') {
            await _supabaseFetch(`support_conversations?id=eq.${conversation_id}`, {
                method: 'PATCH',
                body: { status: 'awaiting_human', escalation_count: (conv.escalation_count || 0) + 1, updated_at: new Date().toISOString() },
                prefer: 'return=minimal'
            });
            const msg = 'Entendido. Estoy conectándote con un agente humano. En cuanto se conecte, verás su respuesta aquí.';
            await _supabaseFetch('support_messages', {
                method: 'POST',
                body: [{ conversation_id, role: 'system', content: msg }],
                prefer: 'return=minimal'
            });
            return res.json({ success: true, response: msg, status: 'awaiting_human' });
        }

        // Si ya está en humano o esperando, no invocar LLM
        if (conv.status === 'human' || conv.status === 'awaiting_human') {
            return res.json({ success: true, response: null, status: conv.status, note: 'Mensaje persistido. Esperando agente humano.' });
        }

        // Invocar OpenAI
        const openai = getOpenAIClient();
        if (!openai) {
            return res.status(503).json({ success: false, error: 'OpenAI no está configurado en el servidor.' });
        }

        // Construir historial (últimos 10 mensajes)
        const history = await _supabaseFetch(
            `support_messages?conversation_id=eq.${conversation_id}&order=created_at.desc&limit=10&select=role,content,tool_calls,tool_results`
        );
        const ordered = (history || []).reverse();
        const chatMessages = [
            { role: 'system', content: _buildSystemPrompt({ role: roleInfo.role, profile: roleInfo.profile, pageContext: page_context || conv.page_context, conversation: conv }) }
        ];
        for (const m of ordered) {
            if (m.role === 'user' || m.role === 'assistant') {
                chatMessages.push({ role: m.role, content: m.content });
            } else if (m.role === 'system') {
                chatMessages.push({ role: 'system', content: m.content });
            }
        }

        let finalText = null;
        let toolCallsLog = [];
        let tokensIn = 0, tokensOut = 0;
        const ctx = { conversation: conv, authUser: authUser ? { ...authUser, role: roleInfo.role } : null };
        let shouldEscalate = false;

        for (let round = 0; round < 3; round++) {
            const completion = await openai.chat.completions.create({
                model: SUPPORT_CHAT_MODEL,
                messages: chatMessages,
                tools: SUPPORT_TOOLS,
                max_tokens: SUPPORT_CHAT_MAX_TOKENS,
                temperature: 0.4
            });
            tokensIn += completion.usage?.prompt_tokens || 0;
            tokensOut += completion.usage?.completion_tokens || 0;

            const choice = completion.choices?.[0];
            const msg = choice?.message;
            if (!msg) break;

            if (msg.tool_calls && msg.tool_calls.length) {
                chatMessages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
                for (const tc of msg.tool_calls) {
                    const fnName = tc.function?.name;
                    let parsedArgs = {};
                    try { parsedArgs = JSON.parse(tc.function?.arguments || '{}'); } catch {}
                    const result = await _executeTool(fnName, parsedArgs, ctx);
                    toolCallsLog.push({ name: fnName, args: parsedArgs, result });
                    chatMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: JSON.stringify(result).slice(0, 4000)
                    });
                    if (fnName === 'escalate_to_human') shouldEscalate = true;
                }
                continue;
            }

            finalText = msg.content || '';
            break;
        }

        if (!finalText) {
            finalText = 'Disculpa, no pude procesar tu pregunta. Te conecto con un agente humano.';
            shouldEscalate = true;
        }

        // Persistir respuesta del asistente
        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{
                conversation_id,
                role: 'assistant',
                content: finalText,
                tool_calls: toolCallsLog.length ? toolCallsLog.map(t => ({ name: t.name, args: t.args })) : null,
                tool_results: toolCallsLog.length ? toolCallsLog.map(t => t.result) : null,
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                model: SUPPORT_CHAT_MODEL
            }],
            prefer: 'return=minimal'
        });

        // Re-leer conversación por si status cambió vía tool
        const updatedRows = await _supabaseFetch(`support_conversations?id=eq.${conversation_id}&limit=1`);
        const updated = updatedRows?.[0] || conv;

        return res.json({
            success: true,
            response: finalText,
            status: updated.status,
            escalated: shouldEscalate || updated.status === 'awaiting_human',
            tokens: { in: tokensIn, out: tokensOut }
        });
    } catch (err) {
        console.error('[support-chat] message error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ENDPOINT: POST /api/support-chat/escalate
// Forzar escalamiento desde el usuario (botón "hablar con humano")
// ============================================
app.post('/api/support-chat/escalate', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    const { conversation_id, reason } = req.body || {};
    if (!conversation_id) return res.status(400).json({ success: false, error: 'conversation_id requerido' });
    try {
        await _supabaseFetch(`support_conversations?id=eq.${conversation_id}`, {
            method: 'PATCH',
            body: { status: 'awaiting_human', updated_at: new Date().toISOString() },
            prefer: 'return=minimal'
        });
        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{ conversation_id, role: 'system', content: `Usuario solicita agente humano${reason ? ': ' + reason : ''}.` }],
            prefer: 'return=minimal'
        });
        return res.json({ success: true, status: 'awaiting_human' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ENDPOINT: POST /api/support-chat/assign
// Soporte toma una conversación
// ============================================
app.post('/api/support-chat/assign', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    const { conversation_id, support_user_id } = req.body || {};
    if (!conversation_id || !support_user_id) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try {
        await _supabaseFetch(`support_conversations?id=eq.${conversation_id}`, {
            method: 'PATCH',
            body: { status: 'human', assigned_support_user_id: support_user_id, updated_at: new Date().toISOString() },
            prefer: 'return=minimal'
        });
        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{ conversation_id, role: 'system', content: 'Un agente humano se ha unido a la conversación.' }],
            prefer: 'return=minimal'
        });
        return res.json({ success: true, status: 'human' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ENDPOINT: POST /api/support-chat/release
// Soporte devuelve la conversación al bot
// ============================================
app.post('/api/support-chat/release', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    const { conversation_id } = req.body || {};
    if (!conversation_id) return res.status(400).json({ success: false, error: 'conversation_id requerido' });
    try {
        await _supabaseFetch(`support_conversations?id=eq.${conversation_id}`, {
            method: 'PATCH',
            body: { status: 'bot', assigned_support_user_id: null, updated_at: new Date().toISOString() },
            prefer: 'return=minimal'
        });
        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{ conversation_id, role: 'system', content: 'El asistente automático retoma la conversación.' }],
            prefer: 'return=minimal'
        });
        return res.json({ success: true, status: 'bot' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ENDPOINT: POST /api/support-chat/agent-message
// Soporte envía un mensaje como humano
// ============================================
app.post('/api/support-chat/agent-message', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    const { conversation_id, content, support_user_id } = req.body || {};
    if (!conversation_id || !content) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try {
        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{
                conversation_id,
                role: 'human_agent',
                content,
                author_user_id: support_user_id || null
            }],
            prefer: 'return=minimal'
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ENDPOINT: POST /api/support-chat/close
// Cerrar conversación
// ============================================
app.post('/api/support-chat/close', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    const { conversation_id } = req.body || {};
    if (!conversation_id) return res.status(400).json({ success: false, error: 'conversation_id requerido' });
    try {
        await _supabaseFetch(`support_conversations?id=eq.${conversation_id}`, {
            method: 'PATCH',
            body: { status: 'closed', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
            prefer: 'return=minimal'
        });
        return res.json({ success: true, status: 'closed' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ENDPOINT: POST /api/support-chat/link-anonymous
// Al loguearse/registrarse, vincula la conversación anónima al user_id
// ============================================
app.post('/api/support-chat/link-anonymous', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    const { anonymous_id } = req.body || {};
    if (!anonymous_id) return res.status(400).json({ success: false, error: 'anonymous_id requerido' });
    try {
        const authUser = await _getAuthUserFromBearer(req);
        if (!authUser) return res.status(401).json({ success: false, error: 'Autenticación requerida' });
        const roleInfo = await _detectUserRole(authUser.id, authUser.email);
        await _supabaseFetch(`support_conversations?anonymous_id=eq.${anonymous_id}&user_id=is.null`, {
            method: 'PATCH',
            body: { user_id: authUser.id, user_role: roleInfo.role, updated_at: new Date().toISOString() },
            prefer: 'return=minimal'
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// GOOGLE DRIVE API INTEGRATION
// ============================================

/**
 * Get authenticated Google Drive client from provided credentials
 * @param {Object} credentials - Service account credentials object
 * @returns {Object|null} Google Drive client or null if failed
 */
function getGoogleDriveClient(credentials) {
    try {
        if (!credentials) {
            console.error('No credentials provided');
            return null;
        }
        
        // Validate required fields
        if (!credentials.client_email || !credentials.private_key) {
            console.error('Invalid credentials: missing client_email or private_key');
            return null;
        }

        const { google } = getGoogleApisModule();
        
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive']
        });
        
        return google.drive({ version: 'v3', auth });
    } catch (error) {
        console.error('Error initializing Google Drive client:', error.message);
        return null;
    }
}

/**
 * Test Google Drive API connection
 * POST /api/google-drive/test
 * Body: { folderId, credentials }
 */
app.post('/api/google-drive/test', async (req, res) => {
    const { folderId, credentials } = req.body;
    
    if (!folderId) {
        return res.status(400).json({ success: false, error: 'Folder ID is required' });
    }
    
    if (!credentials) {
        return res.status(400).json({ success: false, error: 'Service account credentials are required' });
    }
    
    const drive = getGoogleDriveClient(credentials);
    
    if (!drive) {
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to initialize Google Drive client. Check credentials format.' 
        });
    }
    
    try {
        // Try to get folder metadata to verify access
        // supportsAllDrives is required for Shared Drives
        const response = await drive.files.get({
            fileId: folderId,
            fields: 'id, name, mimeType, webViewLink, driveId',
            supportsAllDrives: true
        });
        
        if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
            return res.status(400).json({ 
                success: false, 
                error: 'The provided ID is not a folder' 
            });
        }
        
        return res.json({
            success: true,
            folderName: response.data.name,
            folderId: response.data.id,
            webViewLink: response.data.webViewLink
        });
    } catch (error) {
        console.error('Google Drive test error:', error.message);
        
        let errorMessage = 'Failed to access folder';
        if (error.code === 404) {
            errorMessage = 'Carpeta no encontrada. Asegurate que la carpeta existe y esta compartida con el email de la cuenta de servicio.';
        } else if (error.code === 403) {
            errorMessage = 'Acceso denegado. Comparte la carpeta con el email de la cuenta de servicio (permisos de Editor).';
        } else if (error.message.includes('invalid_grant')) {
            errorMessage = 'Credenciales invalidas. Verifica que el JSON de la cuenta de servicio sea correcto.';
        }
        
        return res.status(error.code || 500).json({ 
            success: false, 
            error: errorMessage 
        });
    }
});

/**
 * Create a quote folder and upload images
 * POST /api/google-drive/create-quote-folder
 * Body: { quoteId, quoteNumber, mainFolderId, credentials, files: [{ url, fileName, mimeType }] }
 */
app.post('/api/google-drive/create-quote-folder', async (req, res) => {
    const { quoteId, quoteNumber, mainFolderId, credentials, files } = req.body;
    
    console.log(`[DEBUG] ====== CREATE QUOTE FOLDER REQUEST ======`);
    console.log(`[DEBUG] quoteNumber: ${quoteNumber}`);
    console.log(`[DEBUG] mainFolderId: "${mainFolderId}"`);
    console.log(`[DEBUG] mainFolderId length: ${mainFolderId?.length}`);
    console.log(`[DEBUG] files count: ${files?.length}`);
    console.log(`[DEBUG] ===========================================`);
    
    console.log(`[Google Drive] Creating folder for quote: ${quoteNumber}`);
    console.log(`[Google Drive] Files to upload: ${files ? files.length : 0}`);
    
    if (!quoteNumber || !mainFolderId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Quote number and main folder ID are required' 
        });
    }
    
    if (!credentials) {
        return res.status(400).json({ 
            success: false, 
            error: 'Service account credentials are required' 
        });
    }
    
    const drive = getGoogleDriveClient(credentials);
    
    if (!drive) {
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to initialize Google Drive client' 
        });
    }
    
    try {
        // Step 1: Check if folder already exists for this quote
        const existingFolder = await findExistingQuoteFolder(drive, mainFolderId, quoteNumber);
        
        let quoteFolderId;
        let quoteFolderLink;
        
        if (existingFolder) {
            // Use existing folder
            quoteFolderId = existingFolder.id;
            quoteFolderLink = existingFolder.webViewLink;
            console.log(`[Google Drive] Using existing folder for quote ${quoteNumber}: ${quoteFolderId}`);
        } else {
            // Step 2: Create new folder for this quote
            const folderMetadata = {
                name: quoteNumber,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [mainFolderId]
            };
            
            const folder = await drive.files.create({
                resource: folderMetadata,
                fields: 'id, webViewLink',
                supportsAllDrives: true
            });
            
            quoteFolderId = folder.data.id;
            quoteFolderLink = folder.data.webViewLink;
            console.log(`[Google Drive] Created new folder for quote ${quoteNumber}: ${quoteFolderId}`);
        }
        
        // Step 3: Upload files to the quote folder
        const uploadedFiles = [];
        const uploadErrors = [];
        
        if (files && files.length > 0) {
            console.log(`[Google Drive] Starting upload of ${files.length} files...`);
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                console.log(`[Google Drive] Uploading file ${i + 1}/${files.length}: ${file.fileName}`);
                console.log(`[Google Drive] Source URL: ${file.url}`);
                
                try {
                    const uploadResult = await uploadFileToFolder(drive, quoteFolderId, file);
                    if (uploadResult) {
                        uploadedFiles.push(uploadResult);
                        console.log(`[Google Drive] Successfully uploaded: ${file.fileName}`);
                    }
                } catch (uploadError) {
                    const errorDetail = {
                        fileName: file.fileName,
                        error: uploadError.message,
                        url: file.url
                    };
                    uploadErrors.push(errorDetail);
                    console.error(`[Google Drive] Failed to upload ${file.fileName}:`, uploadError.message);
                }
            }
            
            console.log(`[Google Drive] Upload complete: ${uploadedFiles.length}/${files.length} files successful`);
        }
        
        // Determine overall success - folder created is minimum success
        // But warn if files failed to upload
        const hasUploadErrors = uploadErrors.length > 0;
        const allFilesFailed = files && files.length > 0 && uploadedFiles.length === 0;
        
        return res.json({
            success: true, // Folder was created successfully
            quoteFolderId,
            quoteFolderLink,
            uploadedCount: uploadedFiles.length,
            uploadedFiles,
            // Include error details so frontend can handle appropriately
            uploadErrors: hasUploadErrors ? uploadErrors : undefined,
            warning: allFilesFailed ? 'All files failed to upload to Google Drive' : undefined,
            partialSuccess: hasUploadErrors && uploadedFiles.length > 0
        });
        
    } catch (error) {
        console.error('[Google Drive] Error creating quote folder:', error.message);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Find existing folder for a quote number
 */
async function findExistingQuoteFolder(drive, parentId, quoteNumber) {
    try {
        const response = await drive.files.list({
            q: `'${parentId}' in parents and name = '${quoteNumber}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name, webViewLink)',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        
        return response.data.files.length > 0 ? response.data.files[0] : null;
    } catch (error) {
        console.error('Error finding existing folder:', error.message);
        return null;
    }
}

/**
 * Upload a file to a Google Drive folder
 * @param {Object} drive - Google Drive client
 * @param {string} folderId - Target folder ID
 * @param {Object} file - File info { url, fileName, mimeType }
 */
async function uploadFileToFolder(drive, folderId, file) {
    const startTime = Date.now();
    
    try {
        // Validate file URL
        if (!file.url) {
            throw new Error('File URL is missing or empty');
        }
        
        console.log(`[Upload] Fetching file from: ${file.url}`);
        
        // Download file from URL (Supabase storage) with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        let response;
        try {
            response = await fetch(file.url, { 
                signal: controller.signal,
                headers: {
                    'User-Agent': 'WeOtzi-Server/1.0'
                }
            });
        } finally {
            clearTimeout(timeout);
        }
        
        console.log(`[Upload] Fetch response status: ${response.status} ${response.statusText}`);
        console.log(`[Upload] Content-Type: ${response.headers.get('content-type')}`);
        console.log(`[Upload] Content-Length: ${response.headers.get('content-length')}`);
        
        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'Unable to read error body');
            throw new Error(`Failed to download file: HTTP ${response.status} ${response.statusText}. Body: ${errorBody.substring(0, 200)}`);
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        console.log(`[Upload] Downloaded ${buffer.length} bytes in ${Date.now() - startTime}ms`);
        
        if (buffer.length === 0) {
            throw new Error('Downloaded file is empty (0 bytes)');
        }
        
        // Create readable stream from buffer
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);
        
        // Upload to Google Drive
        const fileMetadata = {
            name: file.fileName || `reference_${Date.now()}.jpg`,
            parents: [folderId]
        };
        
        const media = {
            mimeType: file.mimeType || 'image/jpeg',
            body: stream
        };
        
        console.log(`[Upload] Uploading to Google Drive: ${fileMetadata.name} (${buffer.length} bytes, ${media.mimeType})`);
        
        const uploadResponse = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink, webContentLink',
            supportsAllDrives: true
        });
        
        const totalTime = Date.now() - startTime;
        console.log(`[Upload] Successfully uploaded: ${uploadResponse.data.name} (${totalTime}ms total)`);
        
        return {
            id: uploadResponse.data.id,
            name: uploadResponse.data.name,
            webViewLink: uploadResponse.data.webViewLink,
            webContentLink: uploadResponse.data.webContentLink
        };
    } catch (error) {
        const totalTime = Date.now() - startTime;
        
        // Provide detailed error information
        if (error.name === 'AbortError') {
            console.error(`[Upload] TIMEOUT after ${totalTime}ms fetching: ${file.url}`);
            throw new Error(`Fetch timeout after 30 seconds for ${file.fileName}`);
        }
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error(`[Upload] NETWORK ERROR (${error.code}): Cannot reach ${file.url}`);
            throw new Error(`Network error (${error.code}): Cannot reach Supabase storage`);
        }
        
        console.error(`[Upload] ERROR after ${totalTime}ms:`, error.message);
        console.error(`[Upload] Error stack:`, error.stack);
        throw error;
    }
}

// ============================================
// CLIENT INFO & SESSION LOGGING
// ============================================

/**
 * Get client information including IP address
 * GET /api/client-info
 */
app.get('/api/client-info', (req, res) => {
    // Get IP from various headers (supports proxies)
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               req.connection?.remoteAddress ||
               req.socket?.remoteAddress ||
               req.ip ||
               'unknown';
    
    res.json({
        ip: ip,
        timestamp: new Date().toISOString()
    });
});

/**
 * Receive session log data via sendBeacon on page unload
 * This endpoint handles the final persist when user leaves the page
 * POST /api/session-log
 * Also resolves IP geolocation (country/city) and updates the session_logs record
 */
app.post('/api/session-log', async (req, res) => {
    const { session_id, session_log_id, log_data, log_entries_count, has_errors, error_count, ended_at } = req.body;

    if (!session_id) {
        return res.status(400).json({ success: false, error: 'Session ID required' });
    }

    console.log(`[Session Log] Received final log for session ${session_id}: ${log_entries_count} entries, ${error_count} errors`);

    // Respond immediately (fire-and-forget for sendBeacon)
    res.status(200).json({ success: true, received: true });

    // Background: resolve IP geolocation and update the record
    if (session_log_id) {
        try {
            const cfg = getHealthConfig();
            if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) return;

            // Get the client IP from the request
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.headers['x-real-ip']
                || req.socket.remoteAddress;

            const isLocal = !clientIp || clientIp === '::1' || clientIp === '127.0.0.1' || clientIp.startsWith('192.168.') || clientIp.startsWith('10.');

            if (!isLocal) {
                const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,country,city`, {
                    signal: AbortSignal.timeout(3000)
                });
                const geo = await geoRes.json();

                if (geo.status === 'success' && (geo.country || geo.city)) {
                    await fetch(`${cfg.supabaseUrl}/rest/v1/session_logs?id=eq.${session_log_id}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': cfg.supabaseServiceKey,
                            'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify({ country: geo.country, city: geo.city })
                    });
                    console.log(`[Session Log] Geo resolved for ${session_log_id}: ${geo.city}, ${geo.country}`);
                }
            }
        } catch (err) {
            console.error(`[Session Log] Geo resolution failed for ${session_log_id}:`, err.message);
        }
    }
});

/**
 * Track a visit to a public artist profile page.
 * POST /api/artist/profile-visit
 * Body: { artist_username, device_fingerprint?, user_agent?, is_authenticated?, referrer? }
 *
 * - Responds 200 immediately (fire-and-forget pattern).
 * - Hashes IP (sha256+salt) — never stored in clear.
 * - Resolves geo via ip-api.com (country, city, lat, lon).
 * - Server-side dedupe: same ip_hash + artist in last hour is skipped.
 * - Parses user-agent into device_type / os / browser (mirrors analytics_devices view).
 * - Inserts into artist_profile_visits with service_role credentials.
 */
app.post('/api/artist/profile-visit', profileVisitLimiter, async (req, res) => {
    const { artist_username, device_fingerprint, user_agent, is_authenticated, referrer } = req.body || {};

    if (!artist_username || typeof artist_username !== 'string') {
        return res.status(400).json({ success: false, error: 'artist_username required' });
    }

    // Respond immediately — the heavy work happens in the background.
    res.status(200).json({ success: true });

    try {
        const cfg = getHealthConfig();
        if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
            console.warn('[profile-visit] Missing Supabase config, skipping');
            return;
        }

        const clientIp = (req.headers['x-forwarded-for']?.split(',')[0]?.trim())
            || req.headers['x-real-ip']
            || req.socket?.remoteAddress
            || '';

        const isLocal = !clientIp
            || clientIp === '::1'
            || clientIp === '127.0.0.1'
            || clientIp.startsWith('192.168.')
            || clientIp.startsWith('10.')
            || clientIp.startsWith('172.');

        // Hash the IP (never store it in clear). Use a stable salt from env.
        const salt = process.env.IP_HASH_SALT || 'weotzi';
        const ip_hash = clientIp
            ? crypto.createHash('sha256').update(clientIp + salt).digest('hex').slice(0, 32)
            : null;

        // Resolve artist_id from artist_username
        const normalizedUsername = String(artist_username).replace(/\.wo$/i, '');
        const lookupUrl = `${cfg.supabaseUrl}/rest/v1/artists_db?username=eq.${encodeURIComponent(normalizedUsername)}&select=user_id,username&limit=1`;
        const lookupRes = await fetch(lookupUrl, {
            headers: {
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`
            }
        });
        const artistRows = await lookupRes.json();
        const artist = Array.isArray(artistRows) ? artistRows[0] : null;
        if (!artist?.user_id) {
            console.warn(`[profile-visit] Artist not found: ${normalizedUsername}`);
            return;
        }

        // Server-side dedupe: skip if same ip_hash + artist within last hour
        if (ip_hash) {
            const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const dedupeUrl = `${cfg.supabaseUrl}/rest/v1/artist_profile_visits`
                + `?artist_id=eq.${artist.user_id}`
                + `&ip_hash=eq.${ip_hash}`
                + `&created_at=gte.${encodeURIComponent(sinceIso)}`
                + `&select=id&limit=1`;
            const dedupeRes = await fetch(dedupeUrl, {
                headers: {
                    'apikey': cfg.supabaseServiceKey,
                    'Authorization': `Bearer ${cfg.supabaseServiceKey}`
                }
            });
            const dedupeRows = await dedupeRes.json();
            if (Array.isArray(dedupeRows) && dedupeRows.length > 0) {
                // Already counted within the last hour — skip
                return;
            }
        }

        // Resolve geolocation (country, city, lat, lon) via ip-api.com
        let country = null, city = null, lat = null, lon = null;
        if (!isLocal) {
            try {
                const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,country,city,lat,lon`, {
                    signal: AbortSignal.timeout(3000)
                });
                const geo = await geoRes.json();
                if (geo.status === 'success') {
                    country = geo.country || null;
                    city = geo.city || null;
                    lat = typeof geo.lat === 'number' ? geo.lat : null;
                    lon = typeof geo.lon === 'number' ? geo.lon : null;
                }
            } catch (err) {
                console.warn(`[profile-visit] Geo resolution failed for ${clientIp}:`, err.message);
            }
        }

        // Parse user-agent (mirror analytics_devices view expressions)
        const ua = (user_agent || req.headers['user-agent'] || '').toString();
        const device_type = /Mobile|iPhone|Android.*Mobile/i.test(ua) ? 'Mobile'
                          : /iPad|Tablet/i.test(ua) ? 'Tablet'
                          : 'Desktop';
        const os = /iPhone/i.test(ua) ? 'iOS'
                 : /iPad/i.test(ua) ? 'iPadOS'
                 : /Android/i.test(ua) ? 'Android'
                 : /Macintosh/i.test(ua) ? 'macOS'
                 : /Windows/i.test(ua) ? 'Windows'
                 : /CrOS/i.test(ua) ? 'ChromeOS'
                 : /Linux/i.test(ua) ? 'Linux'
                 : 'Other';
        const browser = /CriOS\//i.test(ua) ? 'Chrome iOS'
                      : /FxiOS\//i.test(ua) ? 'Firefox iOS'
                      : /Edg\//i.test(ua) ? 'Edge'
                      : /OPR\//i.test(ua) ? 'Opera'
                      : /Chrome\//i.test(ua) ? 'Chrome'
                      : /Firefox\//i.test(ua) ? 'Firefox'
                      : /Safari\//i.test(ua) ? 'Safari'
                      : 'Other';

        const insertPayload = {
            artist_id: artist.user_id,
            artist_username: artist.username,
            ip_hash,
            device_fingerprint: device_fingerprint ? String(device_fingerprint).slice(0, 128) : null,
            device_type,
            os,
            browser,
            country,
            city,
            latitude: lat,
            longitude: lon,
            is_authenticated: !!is_authenticated,
            referrer: referrer ? String(referrer).slice(0, 500) : null
        };

        const insertRes = await fetch(`${cfg.supabaseUrl}/rest/v1/artist_profile_visits`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(insertPayload)
        });

        if (!insertRes.ok) {
            const errText = await insertRes.text();
            console.error(`[profile-visit] Insert failed (${insertRes.status}): ${errText}`);
        } else {
            console.log(`[profile-visit] Tracked visit to ${artist.username} from ${city || 'Unknown'}, ${country || 'Unknown'}`);
        }
    } catch (err) {
        console.error('[profile-visit] Unexpected error:', err.message);
    }
});

// ============================================
// SUPABASE ADMIN API - PASSWORD UPDATE
// ============================================

/**
 * Update user password using Supabase Admin API
 * POST /api/admin/update-user-password
 * Body: { userId, newPassword }
 * Keys read from process.env (NEVER from frontend)
 */
app.post('/api/admin/update-user-password', async (req, res) => {
    const { userId, newPassword } = req.body;

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({
            success: false,
            error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
        });
    }

    if (!userId || !newPassword) {
        return res.status(400).json({
            success: false,
            error: 'Faltan parametros requeridos (userId, newPassword)'
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            error: 'La contrasena debe tener al menos 6 caracteres'
        });
    }

    try {
        // Use Supabase Admin API to update user password
        const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`
            },
            body: JSON.stringify({
                password: newPassword
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('[Admin API] Error updating password:', data);
            throw new Error(data.message || data.error || 'Error al actualizar la contrasena');
        }
        
        console.log(`[Admin API] Password updated for user: ${userId}`);
        
        return res.json({
            success: true,
            message: 'Contrasena actualizada correctamente'
        });
        
    } catch (error) {
        console.error('[Admin API] Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================
// TEMPORARY PASSWORD RESET FOR N8N EMAIL FLOW
// ============================================

/**
 * Reset user password to a temporary password for n8n email flow
 * This endpoint is used when users request password reset via the app
 * POST /api/auth/reset-temp-password
 * Body: { email, userType ('artist' | 'client'), tempPassword }
 * 
 * Flow:
 * 1. Lookup user by email in artists_db or clients_db
 * 2. Update auth password via Supabase Admin API
 * 3. For artists, also update artists_db.password
 * 4. Return success (caller then triggers n8n webhook)
 */
app.post('/api/auth/reset-temp-password', async (req, res) => {
    const { email, userType, tempPassword } = req.body;
    
    // Validation
    if (!email || !userType || !tempPassword) {
        return res.status(400).json({ 
            success: false, 
            error: 'Faltan parametros requeridos (email, userType, tempPassword)' 
        });
    }
    
    if (!['artist', 'client'].includes(userType)) {
        return res.status(400).json({ 
            success: false, 
            error: 'userType debe ser "artist" o "client"' 
        });
    }
    
    if (tempPassword.length < 6) {
        return res.status(400).json({ 
            success: false, 
            error: 'La contrasena temporal debe tener al menos 6 caracteres' 
        });
    }
    
    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceRoleKey) {
        console.error('[Auth] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
        return res.status(500).json({ 
            success: false, 
            error: 'Configuracion de servidor incompleta. Contacta al administrador.' 
        });
    }
    
    try {
        // Determine which table to query
        const tableName = userType === 'artist' ? 'artists_db' : 'clients_db';
        
        // Step 1: Lookup user by email
        const lookupResponse = await fetch(`${supabaseUrl}/rest/v1/${tableName}?email=eq.${encodeURIComponent(email)}&select=user_id,email`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`
            }
        });
        
        if (!lookupResponse.ok) {
            const errorData = await lookupResponse.json();
            console.error('[Auth] Error looking up user:', errorData);
            throw new Error('Error al buscar usuario');
        }
        
        const users = await lookupResponse.json();
        
        if (!users || users.length === 0) {
            console.log(`[Auth] User not found: ${email} (type: ${userType})`);
            return res.status(404).json({ 
                success: false, 
                error: 'Usuario no encontrado' 
            });
        }
        
        const userId = users[0].user_id;
        console.log(`[Auth] Found user ${email} with user_id: ${userId}`);
        
        // Step 2: Update auth password via Admin API
        const authUpdateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`
            },
            body: JSON.stringify({
                password: tempPassword
            })
        });
        
        const authData = await authUpdateResponse.json();
        
        if (!authUpdateResponse.ok) {
            console.error('[Auth] Error updating auth password:', authData);
            throw new Error(authData.message || authData.error || 'Error al actualizar contrasena en auth');
        }
        
        console.log(`[Auth] Auth password updated for user: ${userId}`);
        
        // Step 3: For artists, also update artists_db.password column
        if (userType === 'artist') {
            const dbUpdateResponse = await fetch(`${supabaseUrl}/rest/v1/artists_db?user_id=eq.${userId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': serviceRoleKey,
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    password: tempPassword
                })
            });
            
            if (!dbUpdateResponse.ok) {
                // Log but don't fail - auth update succeeded
                console.warn('[Auth] Warning: Could not update artists_db.password');
            } else {
                console.log(`[Auth] artists_db.password updated for user: ${userId}`);
            }
        }
        
        console.log(`[Auth] Temporary password reset complete for: ${email}`);
        
        return res.json({
            success: true,
            message: 'Contrasena temporal establecida correctamente',
            userType: userType
        });
        
    } catch (error) {
        console.error('[Auth] Error in reset-temp-password:', error.message);
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================
// TATTOO STYLES - ENSURE / CREATE
// ============================================

/**
 * Ensure a tattoo style exists in tattoo_styles.
 * If a matching row (accent/case-insensitive) already exists, return it.
 * Otherwise insert a new top-level style and return it.
 * POST /api/tattoo-styles/ensure
 * Body: { name: string }
 */
app.post('/api/tattoo-styles/ensure', async (req, res) => {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'name is required' });
    }

    const trimmed = name.trim();
    if (trimmed.length > 100) {
        return res.status(400).json({ success: false, error: 'name must be 100 characters or fewer' });
    }

    let supabaseUrl = process.env.SUPABASE_URL;
    let apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !apiKey) {
        try {
            const configPath = path.join(__dirname, 'public', 'shared', 'js', 'app-config.json');
            if (fs.pathExistsSync(configPath)) {
                const cfg = fs.readJsonSync(configPath);
                supabaseUrl = supabaseUrl || cfg.supabase?.url;
                apiKey = apiKey || cfg.supabase?.anonKey;
            }
        } catch (_) { /* ignore */ }
    }

    if (!supabaseUrl || !apiKey) {
        console.error('[Styles] Missing Supabase credentials');
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Prefer': 'return=representation'
    };

    try {
        const allRes = await fetch(
            `${supabaseUrl}/rest/v1/tattoo_styles?parent_id=is.null&select=id,name,slug,sort_order`,
            { method: 'GET', headers }
        );
        if (!allRes.ok) throw new Error('Failed to fetch existing styles');
        const existing = await allRes.json();

        const normalize = (s) => s.trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const normalizedInput = normalize(trimmed);
        const match = existing.find(s => normalize(s.name) === normalizedInput);

        if (match) {
            return res.json({ success: true, style: match, created: false });
        }

        const slug = trimmed.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

        const maxSort = existing.reduce((max, s) => Math.max(max, s.sort_order || 0), 0);

        const insertRes = await fetch(`${supabaseUrl}/rest/v1/tattoo_styles`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: trimmed,
                slug: slug,
                parent_id: null,
                sort_order: maxSort + 1,
                substyles_display_mode: 'grouped'
            })
        });

        if (!insertRes.ok) {
            const err = await insertRes.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to insert style');
        }

        const [created] = await insertRes.json();
        console.log(`[Styles] Created new style: ${created.name} (${created.id})`);
        return res.json({ success: true, style: created, created: true });

    } catch (error) {
        console.error('[Styles] Error in ensure:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// SYSTEM BACKUP - FULL BACKUP WITH INSTALLER
// ============================================

/**
 * Generate full system backup with installer
 * POST /api/admin/generate-backup
 * Body: { dbData: { tableName: data[] }, config: {}, originalDomain: string }
 */
app.post('/api/admin/generate-backup', async (req, res) => {
    const { dbData, config, originalDomain } = req.body;
    
    console.log('[Backup] Starting full system backup generation...');
    
    try {
        // Set response headers for ZIP download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const filename = `weotzi-backup-${timestamp}.zip`;
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Create ZIP archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });
        
        // Handle archive errors
        archive.on('error', (err) => {
            console.error('[Backup] Archive error:', err);
            throw err;
        });
        
        // Pipe archive to response
        archive.pipe(res);
        
        // 1. Add metadata
        const metadata = {
            created: new Date().toISOString(),
            originalDomain: originalDomain || '',
            version: '1.0.0',
            backupType: 'full',
            nodeVersion: process.version
        };
        archive.append(JSON.stringify(metadata, null, 2), { name: 'backup/metadata.json' });
        console.log('[Backup] Added metadata.json');
        
        // 2. Add database dumps
        if (dbData && typeof dbData === 'object') {
            for (const [tableName, tableData] of Object.entries(dbData)) {
                archive.append(
                    JSON.stringify(tableData, null, 2), 
                    { name: `backup/database/${tableName}.json` }
                );
                console.log(`[Backup] Added database/${tableName}.json (${Array.isArray(tableData) ? tableData.length : 0} records)`);
            }
        }
        
        // 3. Add configuration
        if (config) {
            archive.append(JSON.stringify(config, null, 2), { name: 'backup/config/app-config.json' });
            console.log('[Backup] Added config/app-config.json');
        }
        
        // 4. Add application files
        const publicDir = path.join(__dirname, 'public');
        if (await fs.pathExists(publicDir)) {
            archive.directory(publicDir, 'public');
            console.log('[Backup] Added public/ directory');
        }
        
        // 5. Add server.js
        const serverPath = path.join(__dirname, 'server.js');
        if (await fs.pathExists(serverPath)) {
            archive.file(serverPath, { name: 'server.js' });
            console.log('[Backup] Added server.js');
        }
        
        // 6. Add package.json
        const packagePath = path.join(__dirname, 'package.json');
        if (await fs.pathExists(packagePath)) {
            archive.file(packagePath, { name: 'package.json' });
            console.log('[Backup] Added package.json');
        }
        
        // 7. Add setup.js (installer bootstrapper)
        const setupPath = path.join(__dirname, 'setup.js');
        if (await fs.pathExists(setupPath)) {
            archive.file(setupPath, { name: 'setup.js' });
            console.log('[Backup] Added setup.js');
        }
        
        // 8. Add installer directory
        const installerDir = path.join(__dirname, 'installer');
        if (await fs.pathExists(installerDir)) {
            archive.directory(installerDir, 'installer');
            console.log('[Backup] Added installer/ directory');
        }
        
        // 9. Create logs directory structure
        archive.append('', { name: 'logs/server_clients/.gitkeep' });
        console.log('[Backup] Added logs/ directory structure');
        
        // Finalize archive
        await archive.finalize();
        console.log('[Backup] Backup ZIP finalized successfully');
        
    } catch (error) {
        console.error('[Backup] Error generating backup:', error.message);
        if (!res.headersSent) {
            return res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
});

/**
 * Get list of database tables for backup selection
 * GET /api/admin/backup-tables
 */
app.get('/api/admin/backup-tables', (req, res) => {
    // Return the list of known tables
    const tables = [
        { name: 'artists_db', description: 'Artistas registrados' },
        { name: 'quotations_db', description: 'Cotizaciones' },
        { name: 'tattoo_styles', description: 'Estilos de tatuaje' },
        { name: 'body_parts', description: 'Partes del cuerpo' },
        { name: 'quotation_flow_config', description: 'Configuracion del flujo' },
        { name: 'support_users_db', description: 'Usuarios de soporte' },
        { name: 'feedback_tickets', description: 'Tickets de feedback' },
        { name: 'app_settings', description: 'Configuracion de la app' },
        { name: 'session_logs', description: 'Logs de sesion' },
        { name: 'client_accounts', description: 'Cuentas de clientes' }
    ];
    
    res.json({ success: true, tables });
});

// ============================================
// DYNAMIC CONFIGURATION ENDPOINT
// Serves app-config.json with environment variable overrides
// This allows Easypanel to manage configuration
// ============================================

/**
 * Serve dynamic configuration
 * GET /shared/js/app-config.json
 * Reads base config and overrides with environment variables
 */
app.get('/shared/js/app-config.json', async (req, res) => {
    try {
        // Read base configuration file
        const configPath = path.join(__dirname, 'public', 'shared', 'js', 'app-config.json');
        let config = {};
        
        if (await fs.pathExists(configPath)) {
            const fileContent = await fs.readFile(configPath, 'utf8');
            config = JSON.parse(fileContent);
        }
        
        // Override with environment variables if they exist
        // Supabase configuration
        if (process.env.SUPABASE_URL) {
            config.supabase = config.supabase || {};
            config.supabase.url = process.env.SUPABASE_URL;
        }
        if (process.env.SUPABASE_ANON_KEY) {
            config.supabase = config.supabase || {};
            config.supabase.anonKey = process.env.SUPABASE_ANON_KEY;
        }
        if (process.env.SUPABASE_STORAGE_BUCKET) {
            config.supabase = config.supabase || {};
            config.supabase.storageBucket = process.env.SUPABASE_STORAGE_BUCKET;
        }
        
        // Google Maps configuration
        if (process.env.GOOGLE_MAPS_API_KEY) {
            config.googleMaps = config.googleMaps || {};
            config.googleMaps.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        }

        // n8n configuration
        if (process.env.N8N_WEBHOOK_URL) {
            config.n8n = config.n8n || {};
            config.n8n.webhookUrl = process.env.N8N_WEBHOOK_URL;
        }
        if (process.env.N8N_DRIVE_FOLDER_ID) {
            config.n8n = config.n8n || {};
            config.n8n.driveFolderId = process.env.N8N_DRIVE_FOLDER_ID;
        }
        
        // Google Drive configuration
        if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
            config.googleDrive = config.googleDrive || {};
            config.googleDrive.mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        }
        if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT) {
            config.googleDrive = config.googleDrive || {};
            config.googleDrive.serviceAccountJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT;
        }
        
        // EmailJS configuration
        if (process.env.EMAILJS_SERVICE_ID) {
            config.emailjs = config.emailjs || {};
            config.emailjs.serviceId = process.env.EMAILJS_SERVICE_ID;
        }
        if (process.env.EMAILJS_TEMPLATE_ID) {
            config.emailjs = config.emailjs || {};
            config.emailjs.templateId = process.env.EMAILJS_TEMPLATE_ID;
        }
        if (process.env.EMAILJS_PUBLIC_KEY) {
            config.emailjs = config.emailjs || {};
            config.emailjs.publicKey = process.env.EMAILJS_PUBLIC_KEY;
        }
        
        // Gemini AI configuration
        if (process.env.GEMINI_API_KEY) {
            config.gemini = config.gemini || {};
            config.gemini.apiKey = process.env.GEMINI_API_KEY;
            config.gemini.enabled = true;
        }
        
        // WeOtzi configuration
        if (process.env.WHATSAPP_NUMBER) {
            config.weOtzi = config.weOtzi || {};
            config.weOtzi.whatsapp = process.env.WHATSAPP_NUMBER;
        }
        
        // Registration configuration
        if (process.env.PRESET_PASSWORD) {
            config.registration = config.registration || {};
            config.registration.presetPassword = process.env.PRESET_PASSWORD;
        }
        
        // Feature flags from environment
        if (process.env.DEMO_MODE !== undefined) {
            config.features = config.features || {};
            config.features.demoMode = process.env.DEMO_MODE === 'true';
        }
        
        // Set last modified timestamp
        config.lastModified = new Date().toISOString();
        
        // Send JSON response with cache headers
        res.set('Content-Type', 'application/json');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.json(config);
        
    } catch (error) {
        console.error('[Config] Error serving dynamic config:', error.message);
        res.status(500).json({ error: 'Failed to load configuration' });
    }
});

// ============================================
// JOB BOARD - ACCEPT APPLICATION ENDPOINT
// ============================================

/**
 * Accept an artist's application to a job board request
 * Creates a quotation in quotations_db and updates statuses
 * POST /api/job-board/accept-application
 * Body: { applicationId, requestId }
 */
app.post('/api/job-board/accept-application', async (req, res) => {
    const { applicationId, requestId } = req.body;

    if (!applicationId || !requestId) {
        return res.status(400).json({
            success: false,
            error: 'applicationId and requestId are required'
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({
            success: false,
            error: 'Server configuration incomplete'
        });
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=representation'
    };

    try {
        console.log(`[Job Board] Accepting application ${applicationId} for request ${requestId}`);

        // 0. Authenticate: extract caller identity from Authorization header
        const authHeader = req.headers['authorization'];
        let callerUserId = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            try {
                const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
                    headers: {
                        'apikey': serviceRoleKey,
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    callerUserId = userData?.id || null;
                }
            } catch (authErr) {
                console.warn('[Job Board] Auth check failed:', authErr.message);
            }
        }

        if (!callerUserId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // 1. Fetch the application with artist data
        const appResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_applications?id=eq.${applicationId}&select=*`,
            { headers }
        );
        const appData = await appResponse.json();
        if (!appData || appData.length === 0) {
            throw new Error('Application not found');
        }
        const application = appData[0];

        // 1b. Race condition guard: application must still be pending
        if (application.status !== 'pending' && application.status !== 'viewed') {
            return res.status(409).json({
                success: false,
                error: `Application already ${application.status}`
            });
        }

        // 2. Fetch the request with client data
        const reqResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_requests?id=eq.${requestId}&select=*`,
            { headers }
        );
        const reqData = await reqResponse.json();
        if (!reqData || reqData.length === 0) {
            throw new Error('Request not found');
        }
        const request = reqData[0];

        // 2b. Verify caller owns this request
        if (request.client_user_id !== callerUserId) {
            return res.status(403).json({
                success: false,
                error: 'Only the request owner can accept applications'
            });
        }

        // 2c. Race condition guard: request must still be open
        if (request.status !== 'open' && request.status !== 'in_review') {
            return res.status(409).json({
                success: false,
                error: `Request already ${request.status}`
            });
        }

        // 3. Fetch artist details
        const artistResponse = await fetch(
            `${supabaseUrl}/rest/v1/artists_db?user_id=eq.${application.artist_id}&select=*`,
            { headers }
        );
        const artistData = await artistResponse.json();
        const artist = artistData?.[0] || {};

        // 4. Fetch client details
        const clientResponse = await fetch(
            `${supabaseUrl}/rest/v1/clients_db?user_id=eq.${request.client_user_id}&select=*`,
            { headers }
        );
        const clientData = await clientResponse.json();
        const client = clientData?.[0] || {};

        // 5. Generate quote ID
        const quoteId = 'QN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

        // 6. Create quotation in quotations_db
        const quotationPayload = {
            quote_id: quoteId,
            quote_status: 'pending',
            source: 'job_board',
            job_board_request_id: request.id,

            // Tattoo data from request
            tattoo_body_part: request.tattoo_body_part,
            tattoo_body_side: request.tattoo_body_side,
            tattoo_idea_description: request.tattoo_idea_description,
            tattoo_size: request.tattoo_size,
            tattoo_style: request.tattoo_style,
            tattoo_color_type: request.tattoo_color_type,
            tattoo_is_first_tattoo: !!request.tattoo_is_first_tattoo,
            tattoo_is_cover_up: !!request.tattoo_is_cover_up,

            // Client data
            client_full_name: client.full_name || '',
            client_email: client.email || '',
            client_whatsapp: client.whatsapp || '',
            client_age: client.age ? String(client.age) : '',
            client_city_residence: request.client_city || client.city_residence || '',
            client_preferred_date: request.client_preferred_date || '',
            client_flexible_dates: request.client_flexible_dates || '',
            client_travel_willing: request.client_travel_willing ? 'true' : 'false',
            client_budget_amount: request.client_budget_max ? String(request.client_budget_max) : '',
            client_budget_currency: request.client_budget_currency || 'USD',
            client_user_id: request.client_user_id,
            client_instagram: client.instagram || '',

            // Artist data
            artist_id: application.artist_id,
            artist_name: artist.name || artist.username || '',
            artist_email: artist.email || '',
            artist_instagram: artist.instagram || '',
            artist_session_cost_amount: artist.session_price || '',
            artist_styles: artist.styles_array || [],
            artist_current_city: artist.ubicacion || artist.city || '',
            artist_studio_name: artist.estudios || '',

            // Accepted application offer
            artist_budget_amount: application.estimated_price ? String(application.estimated_price) : '',
            artist_budget_currency: request.client_budget_currency || 'USD',
            tattoo_estimated_sessions: application.estimated_sessions || null,

            created_at: new Date().toISOString()
        };

        const createQuoteResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify(quotationPayload)
            }
        );

        if (!createQuoteResponse.ok) {
            const err = await createQuoteResponse.json();
            console.error('[Job Board] Error creating quotation:', err);
            throw new Error('Failed to create quotation: ' + (err.message || JSON.stringify(err)));
        }

        console.log(`[Job Board] Created quotation ${quoteId}`);

        // 7. Update accepted application
        const updateAppResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_applications?id=eq.${applicationId}`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    status: 'accepted',
                    decided_at: new Date().toISOString()
                })
            }
        );

        if (!updateAppResponse.ok) {
            console.warn('[Job Board] Warning: Could not update application status');
        }

        // 8. Reject all other pending applications
        const rejectResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_applications?request_id=eq.${requestId}&id=neq.${applicationId}&status=in.(pending,viewed)`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    status: 'rejected',
                    decided_at: new Date().toISOString()
                })
            }
        );

        if (!rejectResponse.ok) {
            console.warn('[Job Board] Warning: Could not reject other applications');
        }

        // 9. Update request status
        const updateReqResponse = await fetch(
            `${supabaseUrl}/rest/v1/job_board_requests?id=eq.${requestId}`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    status: 'accepted',
                    accepted_at: new Date().toISOString(),
                    accepted_artist_id: application.artist_id,
                    accepted_application_id: applicationId,
                    resulting_quote_id: quoteId,
                    is_public: false
                })
            }
        );

        if (!updateReqResponse.ok) {
            console.warn('[Job Board] Warning: Could not update request status');
        }

        console.log(`[Job Board] Accept flow complete: application=${applicationId}, quote=${quoteId}`);

        return res.json({
            success: true,
            quoteId,
            message: 'Application accepted and quotation created'
        });

    } catch (error) {
        console.error('[Job Board] Error in accept-application:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CLIENT - HIDE QUOTATION ENDPOINT
// ============================================

/**
 * Hide a quotation from the client's dashboard (soft-delete for client only).
 * Sets client_deleted_at on the quotation row after verifying ownership.
 * POST /api/client/quotations/:quoteId/hide
 * Headers: Authorization: Bearer <supabase_access_token>
 */
app.post('/api/client/quotations/:quoteId/hide', async (req, res) => {
    const { quoteId } = req.params;

    if (!quoteId) {
        return res.status(400).json({ success: false, error: 'quoteId is required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const headers = {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=representation'
    };

    try {
        // 1. Authenticate caller from Bearer token
        const authHeader = req.headers['authorization'];
        let callerUserId = null;
        let callerEmail = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            try {
                const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
                    headers: {
                        'apikey': serviceRoleKey,
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    callerUserId = userData?.id || null;
                    callerEmail = userData?.email || null;
                }
            } catch (authErr) {
                console.warn('[Client Hide] Auth check failed:', authErr.message);
            }
        }

        if (!callerUserId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        // 2. Fetch the quotation by quote_id
        const quoteResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db?quote_id=eq.${encodeURIComponent(quoteId)}&select=id,quote_id,client_user_id,client_email,client_deleted_at`,
            { headers }
        );
        const quoteData = await quoteResponse.json();

        if (!quoteData || quoteData.length === 0) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }

        const quotation = quoteData[0];

        // 3. Verify ownership: client_user_id must match, or client_email must match
        let isOwner = quotation.client_user_id === callerUserId;

        if (!isOwner && callerEmail && quotation.client_email &&
            quotation.client_email.toLowerCase() === callerEmail.toLowerCase()) {
            // Link the quotation to this client before hiding
            await fetch(
                `${supabaseUrl}/rest/v1/quotations_db?id=eq.${quotation.id}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ client_user_id: callerUserId })
                }
            );
            isOwner = true;
        }

        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'You do not own this quotation' });
        }

        if (quotation.client_deleted_at) {
            return res.json({ success: true, quoteId, message: 'Already hidden' });
        }

        // 4. Set client_deleted_at
        const patchResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db?id=eq.${quotation.id}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ client_deleted_at: new Date().toISOString() })
            }
        );

        if (!patchResponse.ok) {
            const errBody = await patchResponse.text();
            throw new Error(`Failed to hide quotation: ${errBody}`);
        }

        console.log(`[Client Hide] Client ${callerUserId} hid quotation ${quoteId}`);
        return res.json({ success: true, quoteId });

    } catch (error) {
        console.error('[Client Hide] Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

/**
 * Helper: read config for health checks (env vars override file config)
 */
function getHealthConfig() {
    const configPath = path.join(__dirname, 'public', 'shared', 'js', 'app-config.json');
    let config = {};
    try {
        if (fs.pathExistsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) { /* use empty config */ }

    return {
        supabaseUrl: process.env.SUPABASE_URL || config.supabase?.url || '',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || config.supabase?.anonKey || '',
        supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        storageBucket: process.env.SUPABASE_STORAGE_BUCKET || config.supabase?.storageBucket || 'quotation-references',
        googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || config.googleMaps?.apiKey || '',
        n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || config.n8n?.webhookUrl || '',
        geminiApiKey: process.env.GEMINI_API_KEY || config.gemini?.apiKey || '',
        emailjsServiceId: process.env.EMAILJS_SERVICE_ID || config.emailjs?.serviceId || '',
        emailjsPublicKey: process.env.EMAILJS_PUBLIC_KEY || config.emailjs?.publicKey || '',
        gdriveCredentials: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT || config.googleDrive?.serviceAccountJson || '',
        gdriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || config.googleDrive?.mainFolderId || '',
        gcalClientId: config.googleCalendar?.clientId || '',
        gcalApiKey: config.googleCalendar?.apiKey || '',
        gcalEnabled: config.googleCalendar?.enabled || false
    };
}

/**
 * Helper: log health check result to Supabase
 */
async function logHealthCheck(cfg, serviceName, status, latencyMs, errorMessage, metadata) {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
    try {
        await fetch(`${cfg.supabaseUrl}/rest/v1/service_health_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseAnonKey,
                'Authorization': `Bearer ${cfg.supabaseAnonKey}`
            },
            body: JSON.stringify({
                service_name: serviceName,
                status,
                latency_ms: latencyMs,
                error_message: errorMessage || null,
                metadata: metadata || {},
                checked_by: 'server'
            })
        });
    } catch (e) {
        console.error(`[HealthLog] Failed to log ${serviceName}:`, e.message);
    }
}

/**
 * Check a single service health
 */
async function checkServiceHealth(serviceName, cfg) {
    const start = Date.now();
    let status = 'unconfigured';
    let error = null;
    let metadata = {};

    try {
        switch (serviceName) {
            case 'supabase': {
                if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) break;
                // Test 1: REST API query
                const dbRes = await fetch(
                    `${cfg.supabaseUrl}/rest/v1/artists_db?select=id&limit=1`,
                    {
                        headers: {
                            'apikey': cfg.supabaseAnonKey,
                            'Authorization': `Bearer ${cfg.supabaseAnonKey}`
                        }
                    }
                );
                if (!dbRes.ok) throw new Error(`DB query failed: HTTP ${dbRes.status}`);
                metadata.dbQuery = 'ok';

                // Test 2: Storage bucket accessible
                const storageRes = await fetch(
                    `${cfg.supabaseUrl}/storage/v1/bucket/${cfg.storageBucket}`,
                    {
                        headers: {
                            'apikey': cfg.supabaseAnonKey,
                            'Authorization': `Bearer ${cfg.supabaseAnonKey}`
                        }
                    }
                );
                metadata.storageBucket = storageRes.ok ? 'ok' : `HTTP ${storageRes.status}`;

                status = dbRes.ok && storageRes.ok ? 'healthy' : 'degraded';
                break;
            }

            case 'n8n': {
                if (!cfg.n8nWebhookUrl) break;
                // Use HEAD request to avoid triggering webhook actions
                const n8nRes = await fetch(cfg.n8nWebhookUrl, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(10000)
                });
                // n8n webhooks may return various codes; anything other than network error = reachable
                metadata.httpStatus = n8nRes.status;
                status = (n8nRes.status < 500) ? 'healthy' : 'degraded';
                break;
            }

            case 'gemini': {
                if (!cfg.geminiApiKey) break;
                // List models endpoint — lightweight, no token consumption
                const geminiRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${cfg.geminiApiKey}&pageSize=1`,
                    { signal: AbortSignal.timeout(10000) }
                );
                if (!geminiRes.ok) {
                    const errData = await geminiRes.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `HTTP ${geminiRes.status}`);
                }
                status = 'healthy';
                break;
            }

            case 'google-maps': {
                if (!cfg.googleMapsKey) break;
                // Geocoding test with a known address
                const mapsRes = await fetch(
                    `https://maps.googleapis.com/maps/api/geocode/json?address=Buenos+Aires&key=${cfg.googleMapsKey}`,
                    { signal: AbortSignal.timeout(10000) }
                );
                const mapsData = await mapsRes.json();
                if (mapsData.status === 'OK') {
                    status = 'healthy';
                } else if (mapsData.status === 'REQUEST_DENIED') {
                    throw new Error(`API Key denied: ${mapsData.error_message || 'check restrictions'}`);
                } else {
                    status = 'degraded';
                    metadata.apiStatus = mapsData.status;
                }
                break;
            }

            case 'google-drive': {
                if (!cfg.gdriveFolderId || !cfg.gdriveCredentials) break;
                let credentials;
                try {
                    credentials = typeof cfg.gdriveCredentials === 'string'
                        ? JSON.parse(cfg.gdriveCredentials)
                        : cfg.gdriveCredentials;
                } catch (e) {
                    throw new Error('Invalid service account JSON');
                }
                const drive = getGoogleDriveClient(credentials);
                if (!drive) throw new Error('Failed to initialize Drive client');
                const folderRes = await drive.files.get({
                    fileId: cfg.gdriveFolderId,
                    fields: 'id,name'
                });
                metadata.folderName = folderRes.data.name;
                status = 'healthy';
                break;
            }

            case 'emailjs': {
                if (!cfg.emailjsServiceId || !cfg.emailjsPublicKey) break;
                // EmailJS cannot be tested without sending email
                // Validate credentials format only
                status = 'healthy';
                metadata.note = 'Credentials present; real test requires sending email';
                break;
            }

            case 'google-calendar': {
                if (!cfg.gcalEnabled || !cfg.gcalApiKey) break;
                // Validate API key format
                if (cfg.gcalApiKey.startsWith('AIza') && cfg.gcalClientId.includes('.apps.googleusercontent.com')) {
                    status = 'healthy';
                    metadata.note = 'Credentials format valid; real OAuth test requires browser';
                } else {
                    status = 'degraded';
                    metadata.note = 'Credentials format invalid';
                }
                break;
            }

            default:
                error = `Unknown service: ${serviceName}`;
                status = 'down';
        }
    } catch (err) {
        status = 'down';
        error = err.message;
    }

    const latency = Date.now() - start;
    return { service: serviceName, status, latency_ms: latency, error, metadata };
}

const HEALTH_SERVICES = ['supabase', 'n8n', 'gemini', 'google-maps', 'google-drive', 'emailjs', 'google-calendar'];

/**
 * GET /api/health/all — Check all services
 */
app.get('/api/health/all', async (req, res) => {
    const cfg = getHealthConfig();
    const results = {};

    const checks = await Promise.allSettled(
        HEALTH_SERVICES.map(svc => checkServiceHealth(svc, cfg))
    );

    for (const check of checks) {
        if (check.status === 'fulfilled') {
            const r = check.value;
            results[r.service] = r;
            // Log to DB in background (don't await)
            logHealthCheck(cfg, r.service, r.status, r.latency_ms, r.error, r.metadata);
        }
    }

    const allHealthy = Object.values(results).every(r => r.status === 'healthy' || r.status === 'unconfigured');
    res.json({
        success: true,
        overall: allHealthy ? 'healthy' : 'degraded',
        checked_at: new Date().toISOString(),
        services: results
    });
});

/**
 * GET /api/health/:service — Check a single service
 */
app.get('/api/health/:service', async (req, res) => {
    const serviceName = req.params.service;
    if (!HEALTH_SERVICES.includes(serviceName)) {
        return res.status(400).json({ success: false, error: `Unknown service: ${serviceName}. Valid: ${HEALTH_SERVICES.join(', ')}` });
    }

    const cfg = getHealthConfig();
    const result = await checkServiceHealth(serviceName, cfg);

    // Log to DB in background
    logHealthCheck(cfg, result.service, result.status, result.latency_ms, result.error, result.metadata);

    res.json({ success: true, ...result });
});

/**
 * GET /api/health/history/:service — Get health check history
 */
app.get('/api/health/history/:service', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const serviceName = req.params.service;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    try {
        const historyRes = await fetch(
            `${cfg.supabaseUrl}/rest/v1/service_health_logs?service_name=eq.${encodeURIComponent(serviceName)}&order=checked_at.desc&limit=${limit}`,
            {
                headers: {
                    'apikey': cfg.supabaseAnonKey,
                    'Authorization': `Bearer ${cfg.supabaseAnonKey}`
                }
            }
        );
        const data = await historyRes.json();
        res.json({ success: true, service: serviceName, history: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

/**
 * Helper: make authenticated request to Supabase REST API
 */
async function supabaseQuery(cfg, path) {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
        headers: {
            'apikey': cfg.supabaseAnonKey,
            'Authorization': `Bearer ${cfg.supabaseAnonKey}`
        }
    });
    if (!res.ok) throw new Error(`Supabase query failed: HTTP ${res.status}`);
    return res.json();
}

/**
 * GET /api/analytics/users — Users by type and period
 * Query params: period (day|week|month), env (production|development|all), days (default 30)
 */
app.get('/api/analytics/users', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';
    const period = req.query.period || 'day';

    try {
        // Users by type
        const userTypes = await supabaseQuery(cfg,
            `analytics_user_sessions?select=user_type,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}`
        );

        // Aggregate by type
        const typeCounts = {};
        const timeline = {};
        for (const row of userTypes) {
            typeCounts[row.user_type] = (typeCounts[row.user_type] || 0) + 1;

            let key;
            const d = new Date(row.created_at);
            if (period === 'month') key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            else if (period === 'week') {
                const weekStart = new Date(d);
                weekStart.setDate(d.getDate() - d.getDay());
                key = weekStart.toISOString().split('T')[0];
            } else {
                key = d.toISOString().split('T')[0];
            }

            if (!timeline[key]) timeline[key] = { date: key, artist: 0, client: 0, anonymous: 0, authenticated_other: 0 };
            timeline[key][row.user_type] = (timeline[key][row.user_type] || 0) + 1;
        }

        // New vs returning
        const fingerprints = await supabaseQuery(cfg,
            `analytics_user_sessions?select=device_fingerprint,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}`
        );
        const fpFirst = {};
        for (const row of fingerprints) {
            if (!fpFirst[row.device_fingerprint] || row.created_at < fpFirst[row.device_fingerprint]) {
                fpFirst[row.device_fingerprint] = row.created_at;
            }
        }
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        let newVisitors = 0, returningVisitors = 0;
        for (const [fp, firstSeen] of Object.entries(fpFirst)) {
            if (firstSeen >= cutoff) newVisitors++;
            else returningVisitors++;
        }

        res.json({
            success: true,
            period: { days, groupBy: period, environment: env },
            summary: typeCounts,
            newVsReturning: { new: newVisitors, returning: returningVisitors },
            timeline: Object.values(timeline).sort((a, b) => a.date.localeCompare(b.date))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/devices — Device/OS/Browser distribution
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/devices', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const devices = await supabaseQuery(cfg,
            `analytics_devices?select=os,device_type,browser,created_at${env !== 'all' ? `&environment=eq.${env}` : ''}&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        const byOS = {};
        const byDeviceType = {};
        const byBrowser = {};
        for (const row of devices) {
            byOS[row.os] = (byOS[row.os] || 0) + 1;
            byDeviceType[row.device_type] = (byDeviceType[row.device_type] || 0) + 1;
            byBrowser[row.browser] = (byBrowser[row.browser] || 0) + 1;
        }

        res.json({
            success: true,
            total: devices.length,
            os: byOS,
            deviceType: byDeviceType,
            browser: byBrowser
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/pages — Most visited pages
 * Query params: days (default 30), env (production|development|all), limit (default 20)
 */
app.get('/api/analytics/pages', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    try {
        const sessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=page_path,created_at${env !== 'all' ? `&environment=eq.${env}` : ''}&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        const pageCounts = {};
        for (const row of sessions) {
            pageCounts[row.page_path] = (pageCounts[row.page_path] || 0) + 1;
        }

        const pages = Object.entries(pageCounts)
            .map(([page, visits]) => ({ page, visits }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, limit);

        res.json({ success: true, total: sessions.length, pages });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/errors — Sessions with errors
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/errors', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const errorSessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=page_path,error_count,user_type,environment,created_at&has_errors=eq.true&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}&order=created_at.desc`
        );

        // Aggregate by page
        const byPage = {};
        let totalErrors = 0;
        const timeline = {};
        for (const row of errorSessions) {
            byPage[row.page_path] = (byPage[row.page_path] || 0) + (row.error_count || 1);
            totalErrors += row.error_count || 1;

            const day = new Date(row.created_at).toISOString().split('T')[0];
            timeline[day] = (timeline[day] || 0) + 1;
        }

        const errorPages = Object.entries(byPage)
            .map(([page, errors]) => ({ page, errors }))
            .sort((a, b) => b.errors - a.errors);

        res.json({
            success: true,
            totalErrorSessions: errorSessions.length,
            totalErrors,
            byPage: errorPages,
            timeline: Object.entries(timeline)
                .map(([date, count]) => ({ date, errorSessions: count }))
                .sort((a, b) => a.date.localeCompare(b.date))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/locations — Geographic distribution from resolved IPs
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/locations', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const sessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=user_ip,country,city,created_at&user_ip=not.is.null${env !== 'all' ? `&environment=eq.${env}` : ''}&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        const countryCounts = {};
        const cityCounts = {};
        const ipCounts = {};
        let localhostCount = 0;
        let resolvedCount = 0;

        for (const row of sessions) {
            if (row.user_ip === '::1' || row.user_ip === '127.0.0.1') {
                localhostCount++;
                continue;
            }
            ipCounts[row.user_ip] = (ipCounts[row.user_ip] || 0) + 1;

            if (row.country) {
                resolvedCount++;
                countryCounts[row.country] = (countryCounts[row.country] || 0) + 1;
                if (row.city) {
                    const key = `${row.city}, ${row.country}`;
                    cityCounts[key] = (cityCounts[key] || 0) + 1;
                }
            }
        }

        const topCountries = Object.entries(countryCounts)
            .map(([country, count]) => ({ country, sessions: count }))
            .sort((a, b) => b.sessions - a.sessions);

        const topCities = Object.entries(cityCounts)
            .map(([city, count]) => ({ city, sessions: count }))
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 20);

        const uniqueIPs = Object.entries(ipCounts)
            .map(([ip, count]) => ({ ip, sessions: count }))
            .sort((a, b) => b.sessions - a.sessions);

        res.json({
            success: true,
            totalSessions: sessions.length,
            localhostSessions: localhostCount,
            uniquePublicIPs: uniqueIPs.length,
            resolvedSessions: resolvedCount,
            countries: topCountries,
            cities: topCities,
            topIPs: uniqueIPs.slice(0, 20)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/quotations — Quotation metrics
 * Query params: days (default 90)
 * Returns: status breakdown, avg response time, conversion by style, conversion by artist, trend over time
 */
app.get('/api/analytics/quotations', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
        const quotes = await supabaseQuery(cfg,
            `quotations_db?select=quote_id,quote_status,tattoo_style,artist_id,artist_name,created_at,sent_to_artist_at,artist_responded_at&created_at=gte.${since}`
        );

        // 1. Total by status
        const byStatus = {};
        for (const q of quotes) {
            const s = q.quote_status || 'unknown';
            byStatus[s] = (byStatus[s] || 0) + 1;
        }

        // 2. Average response time (sent_to_artist_at → artist_responded_at)
        const responseTimes = [];
        for (const q of quotes) {
            if (q.sent_to_artist_at && q.artist_responded_at) {
                const sent = new Date(q.sent_to_artist_at).getTime();
                const responded = new Date(q.artist_responded_at).getTime();
                if (responded > sent) {
                    responseTimes.push(responded - sent);
                }
            }
        }
        const avgResponseMs = responseTimes.length > 0
            ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
            : null;
        const avgResponseHours = avgResponseMs ? Math.round(avgResponseMs / 3600000 * 10) / 10 : null;

        // 3. Conversion by style (tattoo_style is JSONB with style_name)
        const CONVERTED_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'completed'];
        const styleStats = {};
        for (const q of quotes) {
            const styleName = q.tattoo_style?.style_name || 'Sin estilo';
            if (!styleStats[styleName]) styleStats[styleName] = { total: 0, converted: 0 };
            styleStats[styleName].total++;
            if (CONVERTED_STATUSES.includes(q.quote_status)) {
                styleStats[styleName].converted++;
            }
        }
        const conversionByStyle = Object.entries(styleStats)
            .map(([style, s]) => ({
                style,
                total: s.total,
                converted: s.converted,
                rate: s.total > 0 ? Math.round(s.converted / s.total * 1000) / 10 : 0
            }))
            .sort((a, b) => b.total - a.total);

        // 4. Conversion by artist
        const artistStats = {};
        for (const q of quotes) {
            if (!q.artist_id) continue;
            const key = q.artist_id;
            if (!artistStats[key]) artistStats[key] = { name: q.artist_name || 'Unknown', total: 0, converted: 0, responseTimes: [] };
            artistStats[key].total++;
            if (CONVERTED_STATUSES.includes(q.quote_status)) {
                artistStats[key].converted++;
            }
            if (q.sent_to_artist_at && q.artist_responded_at) {
                const diff = new Date(q.artist_responded_at).getTime() - new Date(q.sent_to_artist_at).getTime();
                if (diff > 0) artistStats[key].responseTimes.push(diff);
            }
        }
        const conversionByArtist = Object.entries(artistStats)
            .map(([artistId, s]) => ({
                artistId,
                name: s.name,
                total: s.total,
                converted: s.converted,
                rate: s.total > 0 ? Math.round(s.converted / s.total * 1000) / 10 : 0,
                avgResponseHours: s.responseTimes.length > 0
                    ? Math.round(s.responseTimes.reduce((a, b) => a + b, 0) / s.responseTimes.length / 3600000 * 10) / 10
                    : null
            }))
            .sort((a, b) => b.total - a.total);

        // 5. Trend by week
        const weekBuckets = {};
        for (const q of quotes) {
            const d = new Date(q.created_at);
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay());
            const key = weekStart.toISOString().slice(0, 10);
            if (!weekBuckets[key]) weekBuckets[key] = { total: 0, converted: 0 };
            weekBuckets[key].total++;
            if (CONVERTED_STATUSES.includes(q.quote_status)) {
                weekBuckets[key].converted++;
            }
        }
        const trend = Object.entries(weekBuckets)
            .map(([week, s]) => ({ week, total: s.total, converted: s.converted }))
            .sort((a, b) => a.week.localeCompare(b.week));

        res.json({
            success: true,
            period: { days, since: since.slice(0, 10) },
            total: quotes.length,
            byStatus,
            avgResponseHours,
            responseSamples: responseTimes.length,
            conversionByStyle,
            conversionByArtist,
            trend
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ARTIST INDEX — Score calculation (0-100)
// ============================================

/**
 * GET /api/artists/index — Calculate Artist Index for all artists or a specific one
 * Query params: artist_id (optional, UUID), recalculate (optional, "true" to force update)
 * Score components: profile completeness (25%), response time (25%), rating (25%), conversion (25%)
 */
app.get('/api/artists/index', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const targetArtistId = req.query.artist_id || null;
    const recalculate = req.query.recalculate === 'true';

    try {
        // Fetch artists
        let artistQuery = `artists_db?select=id,user_id,name,username,bio_description,profile_picture,gallery_images,styles_array,whatsapp_number,city,country,instagram,email,session_price,years_experience,languages,artist_index,index_updated_at,profile_completeness,verification_state`;
        if (targetArtistId) artistQuery += `&id=eq.${targetArtistId}`;
        const artists = await supabaseQuery(cfg, artistQuery);

        if (!artists.length) {
            return res.json({ success: true, artists: [], message: 'No artists found' });
        }

        // Fetch all quotations for these artists
        const artistIds = artists.map(a => a.user_id).filter(Boolean);
        let quotes = [];
        if (artistIds.length > 0) {
            quotes = await supabaseQuery(cfg,
                `quotations_db?select=artist_id,quote_status,sent_to_artist_at,artist_responded_at,rating&artist_id=in.(${artistIds.join(',')})`
            );
        }

        // Group quotations by artist_id
        const quotesByArtist = {};
        for (const q of quotes) {
            if (!q.artist_id) continue;
            if (!quotesByArtist[q.artist_id]) quotesByArtist[q.artist_id] = [];
            quotesByArtist[q.artist_id].push(q);
        }

        const CONVERTED_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'completed'];
        const PROFILE_FIELDS = ['name', 'bio_description', 'profile_picture', 'gallery_images', 'styles_array', 'whatsapp_number', 'city', 'country', 'instagram', 'email', 'session_price', 'years_experience', 'languages'];

        const results = artists.map(artist => {
            // 1. Profile Completeness (25 points)
            let filledFields = 0;
            for (const field of PROFILE_FIELDS) {
                const val = artist[field];
                if (val && val !== '' && val !== '[]' && val !== '{}' && !(Array.isArray(val) && val.length === 0)) {
                    filledFields++;
                }
            }
            const profileScore = Math.round((filledFields / PROFILE_FIELDS.length) * 25);

            // 2. Response Time (25 points)
            const artistQuotes = quotesByArtist[artist.user_id] || [];
            const responseTimes = [];
            for (const q of artistQuotes) {
                if (q.sent_to_artist_at && q.artist_responded_at) {
                    const diff = new Date(q.artist_responded_at).getTime() - new Date(q.sent_to_artist_at).getTime();
                    if (diff > 0) responseTimes.push(diff);
                }
            }
            let responseScore = 25; // Default: full score if no data
            if (responseTimes.length > 0) {
                const avgHours = (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) / 3600000;
                // Scale: 0-2h = 25pts, 2-12h = 20pts, 12-24h = 15pts, 24-48h = 10pts, 48-72h = 5pts, >72h = 0pts
                if (avgHours <= 2) responseScore = 25;
                else if (avgHours <= 12) responseScore = 20;
                else if (avgHours <= 24) responseScore = 15;
                else if (avgHours <= 48) responseScore = 10;
                else if (avgHours <= 72) responseScore = 5;
                else responseScore = 0;
            }

            // 3. Rating (25 points)
            const ratings = artistQuotes
                .map(q => parseFloat(q.rating))
                .filter(r => !isNaN(r) && r > 0);
            let ratingScore = 12; // Default: mid score if no ratings
            if (ratings.length > 0) {
                const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
                ratingScore = Math.round((avgRating / 5) * 25); // Assuming 1-5 scale
            }

            // 4. Conversion Rate (25 points)
            let conversionScore = 12; // Default: mid score if no quotes
            if (artistQuotes.length > 0) {
                const converted = artistQuotes.filter(q => CONVERTED_STATUSES.includes(q.quote_status)).length;
                const rate = converted / artistQuotes.length;
                conversionScore = Math.round(rate * 25);
            }

            const totalIndex = profileScore + responseScore + ratingScore + conversionScore;

            return {
                id: artist.id,
                user_id: artist.user_id,
                name: artist.name,
                username: artist.username,
                artist_index: totalIndex,
                profile_completeness: Math.round((filledFields / PROFILE_FIELDS.length) * 100),
                verification_state: artist.verification_state,
                breakdown: {
                    profile: profileScore,
                    responseTime: responseScore,
                    rating: ratingScore,
                    conversion: conversionScore
                },
                stats: {
                    totalQuotes: artistQuotes.length,
                    avgResponseHours: responseTimes.length > 0
                        ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) / 3600000 * 10) / 10
                        : null,
                    avgRating: ratings.length > 0
                        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
                        : null,
                    conversionRate: artistQuotes.length > 0
                        ? Math.round(artistQuotes.filter(q => CONVERTED_STATUSES.includes(q.quote_status)).length / artistQuotes.length * 1000) / 10
                        : null
                }
            };
        });

        // Persist index values if recalculate=true
        if (recalculate && cfg.supabaseServiceKey) {
            for (const r of results) {
                await fetch(`${cfg.supabaseUrl}/rest/v1/artists_db?id=eq.${r.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': cfg.supabaseServiceKey,
                        'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({
                        artist_index: r.artist_index,
                        profile_completeness: r.profile_completeness,
                        index_updated_at: new Date().toISOString()
                    })
                });
            }
        }

        results.sort((a, b) => b.artist_index - a.artist_index);

        res.json({
            success: true,
            count: results.length,
            persisted: recalculate,
            artists: results
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// VERIFICATION CENTER — Approve/Reject artists
// ============================================

/**
 * GET /api/verification/pending — Artists pending verification
 */
app.get('/api/verification/pending', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    try {
        const artists = await supabaseQuery(cfg,
            `artists_db?select=id,user_id,name,username,email,instagram,city,country,verification_state,profile_picture,styles_array,artist_index,profile_completeness&verification_state=in.(pending_review,pending)&order=created_at.asc`
        );

        res.json({ success: true, count: artists.length, artists });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/verification/history — Verification history for an artist or all
 * Query params: artist_id (optional)
 */
app.get('/api/verification/history', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const artistId = req.query.artist_id;

    try {
        let query = `verification_history?select=*&order=created_at.desc&limit=100`;
        if (artistId) query += `&artist_id=eq.${artistId}`;
        const history = await supabaseQuery(cfg, query);
        res.json({ success: true, count: history.length, history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/verification/review — Approve or reject an artist
 * Body: { artist_id, action ('approved'|'rejected'), notes, reviewed_by }
 */
app.post('/api/verification/review', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured or missing service key' });
    }

    const { artist_id, action, notes, reviewed_by } = req.body;

    if (!artist_id || !action) {
        return res.status(400).json({ success: false, error: 'artist_id and action are required' });
    }

    if (!['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ success: false, error: 'action must be "approved" or "rejected"' });
    }

    try {
        // 1. Update artist verification_state
        const newState = action === 'approved' ? 'verified' : 'rejected';
        const updateRes = await fetch(`${cfg.supabaseUrl}/rest/v1/artists_db?id=eq.${artist_id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({ verification_state: newState })
        });

        if (!updateRes.ok) {
            const err = await updateRes.text();
            throw new Error(`Failed to update artist: ${err}`);
        }

        const updatedArtist = await updateRes.json();

        // 2. Insert verification_history record
        const historyRes = await fetch(`${cfg.supabaseUrl}/rest/v1/verification_history`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                artist_id,
                action,
                notes: notes || null,
                reviewed_by: reviewed_by || 'backoffice'
            })
        });

        if (!historyRes.ok) {
            const err = await historyRes.text();
            throw new Error(`Failed to log verification: ${err}`);
        }

        const historyRecord = await historyRes.json();

        // 3. Fire email event through the centralized service.
        //    Routing (n8n / billionmail / dual / off) is per-event and configurable from the
        //    backoffice UI (Email Routing). Fire-and-forget: do NOT block the response.
        const emailEventId = action === 'approved' ? 'profile_verified' : 'profile_verification_denied';
        try {
            const artist = updatedArtist[0] || {};
            emailService.sendEmail(emailEventId, {
                artist_id,
                artist_name: artist.name,
                artist_email: artist.email,
                email: artist.email,
                action,
                notes,
                reviewed_by,
                timestamp: new Date().toISOString()
            }).catch(e => console.error(`[Verification] sendEmail failed:`, e.message));
        } catch (e) {
            console.error(`[Verification] sendEmail dispatch failed:`, e.message);
        }

        res.json({
            success: true,
            artist_id,
            action,
            new_state: newState,
            history: historyRecord[0] || historyRecord
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// QUOTATION STATUS HISTORY — Timeline data
// ============================================

/**
 * GET /api/quotations/:quoteId/timeline — Status history for a quotation
 */
app.get('/api/quotations/:quoteId/timeline', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const quoteId = req.params.quoteId;

    try {
        // Try by quote_id string first, then by numeric id
        let history = await supabaseQuery(cfg,
            `quotation_status_history?select=*&quote_id=eq.${quoteId}&order=changed_at.asc`
        );

        if (history.length === 0 && /^\d+$/.test(quoteId)) {
            history = await supabaseQuery(cfg,
                `quotation_status_history?select=*&quotation_id=eq.${quoteId}&order=changed_at.asc`
            );
        }

        res.json({ success: true, quote_id: quoteId, count: history.length, timeline: history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// TICKET SUPPORT — Assignments & Comments
// ============================================

/**
 * GET /api/tickets/:ticketId/assignments — Get assignments for a ticket
 */
app.get('/api/tickets/:ticketId/assignments', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }
    try {
        const assignments = await supabaseQuery(cfg,
            `ticket_assignments?select=*&ticket_id=eq.${req.params.ticketId}&order=assigned_at.desc`
        );
        res.json({ success: true, assignments });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tickets/:ticketId/assign — Assign a ticket to an agent
 * Body: { assigned_to, assigned_by }
 */
app.post('/api/tickets/:ticketId/assign', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const { assigned_to, assigned_by } = req.body;
    if (!assigned_to) {
        return res.status(400).json({ success: false, error: 'assigned_to is required' });
    }

    try {
        // Insert assignment
        const assignRes = await fetch(`${cfg.supabaseUrl}/rest/v1/ticket_assignments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                ticket_id: req.params.ticketId,
                assigned_to,
                assigned_by: assigned_by || 'backoffice'
            })
        });

        if (!assignRes.ok) throw new Error(await assignRes.text());
        const assignment = await assignRes.json();

        // Update ticket status to 'in_progress' if currently 'open'/'new'
        await fetch(`${cfg.supabaseUrl}/rest/v1/feedback_tickets?id=eq.${req.params.ticketId}&status=in.(open,new)`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ status: 'in_progress', updated_at: new Date().toISOString() })
        });

        res.json({ success: true, assignment: assignment[0] || assignment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/tickets/:ticketId/comments — Get comments for a ticket
 * Query params: include_internal (default true)
 */
app.get('/api/tickets/:ticketId/comments', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const includeInternal = req.query.include_internal !== 'false';

    try {
        let query = `ticket_comments?select=*&ticket_id=eq.${req.params.ticketId}&order=created_at.asc`;
        if (!includeInternal) query += '&is_internal=eq.false';
        const comments = await supabaseQuery(cfg, query);
        res.json({ success: true, comments });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tickets/:ticketId/comments — Add a comment to a ticket
 * Body: { author, content, is_internal }
 */
app.post('/api/tickets/:ticketId/comments', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const { author, content, is_internal } = req.body;
    if (!author || !content) {
        return res.status(400).json({ success: false, error: 'author and content are required' });
    }

    try {
        const commentRes = await fetch(`${cfg.supabaseUrl}/rest/v1/ticket_comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                ticket_id: req.params.ticketId,
                author,
                content,
                is_internal: is_internal || false
            })
        });

        if (!commentRes.ok) throw new Error(await commentRes.text());
        const comment = await commentRes.json();

        // Update ticket updated_at
        await fetch(`${cfg.supabaseUrl}/rest/v1/feedback_tickets?id=eq.${req.params.ticketId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ updated_at: new Date().toISOString() })
        });

        res.json({ success: true, comment: comment[0] || comment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/tickets/metrics — Support ticket metrics
 * Query params: days (default 30)
 */
app.get('/api/tickets/metrics', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
        const tickets = await supabaseQuery(cfg,
            `feedback_tickets?select=id,status,ticket_category,ticket_priority,is_auto_generated,created_at,updated_at&created_at=gte.${since}`
        );

        const byStatus = {};
        const byCategory = {};
        const byPriority = {};
        let autoGenerated = 0;
        const resolutionTimes = [];

        for (const t of tickets) {
            byStatus[t.status || 'unknown'] = (byStatus[t.status || 'unknown'] || 0) + 1;
            if (t.ticket_category) byCategory[t.ticket_category] = (byCategory[t.ticket_category] || 0) + 1;
            if (t.ticket_priority) byPriority[t.ticket_priority] = (byPriority[t.ticket_priority] || 0) + 1;
            if (t.is_auto_generated) autoGenerated++;

            if (t.status === 'resolved' && t.created_at && t.updated_at) {
                const diff = new Date(t.updated_at).getTime() - new Date(t.created_at).getTime();
                if (diff > 0) resolutionTimes.push(diff);
            }
        }

        const avgResolutionHours = resolutionTimes.length > 0
            ? Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length / 3600000 * 10) / 10
            : null;

        res.json({
            success: true,
            period: { days, since: since.slice(0, 10) },
            total: tickets.length,
            autoGenerated,
            byStatus,
            byCategory,
            byPriority,
            avgResolutionHours,
            resolvedCount: resolutionTimes.length
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// JOB BOARD BIDDING — Artist proposals & matches
// ============================================

/**
 * POST /api/job-board/:requestId/bid — Artist submits a bid/proposal
 * Body: { artist_id, estimated_price, estimated_sessions, message, availability_note, portfolio_links }
 */
app.post('/api/job-board/:requestId/bid', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const { artist_id, estimated_price, estimated_sessions, message, availability_note, portfolio_links } = req.body;
    if (!artist_id) {
        return res.status(400).json({ success: false, error: 'artist_id is required' });
    }

    try {
        // Check if request exists and is active
        const requests = await supabaseQuery(cfg,
            `job_board_requests?select=id,status,max_applications,application_count&id=eq.${req.params.requestId}`
        );

        if (!requests.length) {
            return res.status(404).json({ success: false, error: 'Request not found' });
        }

        const request = requests[0];
        if (request.status !== 'active' && request.status !== 'open') {
            return res.status(400).json({ success: false, error: `Request is ${request.status}, cannot accept bids` });
        }

        if (request.max_applications && request.application_count >= request.max_applications) {
            return res.status(400).json({ success: false, error: 'Maximum applications reached' });
        }

        // Check for duplicate bid
        const existing = await supabaseQuery(cfg,
            `job_board_applications?select=id&request_id=eq.${req.params.requestId}&artist_id=eq.${artist_id}`
        );
        if (existing.length > 0) {
            return res.status(409).json({ success: false, error: 'Artist already submitted a bid for this request' });
        }

        // Insert bid
        const bidRes = await fetch(`${cfg.supabaseUrl}/rest/v1/job_board_applications`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                request_id: req.params.requestId,
                artist_id,
                estimated_price: estimated_price || null,
                estimated_sessions: estimated_sessions || null,
                message: message || null,
                availability_note: availability_note || null,
                portfolio_links: portfolio_links || null,
                status: 'pending'
            })
        });

        if (!bidRes.ok) throw new Error(await bidRes.text());
        const bid = await bidRes.json();

        // Increment application_count
        await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/increment_application_count`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`
            },
            body: JSON.stringify({ request_id_input: req.params.requestId })
        }).catch(() => {
            // If RPC doesn't exist, do a manual update
            fetch(`${cfg.supabaseUrl}/rest/v1/job_board_requests?id=eq.${req.params.requestId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': cfg.supabaseServiceKey,
                    'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    application_count: (request.application_count || 0) + 1,
                    updated_at: new Date().toISOString()
                })
            });
        });

        res.json({ success: true, bid: bid[0] || bid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/job-board/:requestId/bids — List bids for a request
 */
app.get('/api/job-board/:requestId/bids', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    try {
        const bids = await supabaseQuery(cfg,
            `job_board_applications?select=*&request_id=eq.${req.params.requestId}&order=created_at.desc`
        );

        // Enrich with artist names
        const artistIds = [...new Set(bids.map(b => b.artist_id).filter(Boolean))];
        let artistMap = {};
        if (artistIds.length > 0) {
            const artists = await supabaseQuery(cfg,
                `artists_db?select=user_id,name,username,profile_picture,city,country,styles_array,artist_index&user_id=in.(${artistIds.join(',')})`
            );
            for (const a of artists) {
                artistMap[a.user_id] = a;
            }
        }

        const enriched = bids.map(b => ({
            ...b,
            artist: artistMap[b.artist_id] || null
        }));

        res.json({ success: true, count: enriched.length, bids: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PATCH /api/job-board/bid/:bidId — Approve or reject a bid
 * Body: { status ('accepted'|'rejected') }
 */
app.patch('/api/job-board/bid/:bidId', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const { status } = req.body;
    if (!status || !['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, error: 'status must be "accepted" or "rejected"' });
    }

    try {
        const updateBody = {
            status,
            decided_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const updateRes = await fetch(`${cfg.supabaseUrl}/rest/v1/job_board_applications?id=eq.${req.params.bidId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(updateBody)
        });

        if (!updateRes.ok) throw new Error(await updateRes.text());
        const updated = await updateRes.json();
        const bid = updated[0] || updated;

        // If accepted, update the request with accepted_artist_id and accepted_application_id
        if (status === 'accepted' && bid.request_id && bid.artist_id) {
            await fetch(`${cfg.supabaseUrl}/rest/v1/job_board_requests?id=eq.${bid.request_id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': cfg.supabaseServiceKey,
                    'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    status: 'assigned',
                    accepted_artist_id: bid.artist_id,
                    accepted_application_id: bid.id,
                    accepted_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
            });
        }

        // Fire email event through the centralized service.
        // Need the artist email so BillionMail/n8n can address the recipient. The bid row
        // only has artist_id, so look up the artist quickly. Fire-and-forget for the email.
        try {
            const emailEventId = status === 'accepted'
                ? 'job_board_application_accepted'
                : 'job_board_application_rejected';
            (async () => {
                let artistEmail = null;
                let artistName = null;
                try {
                    if (bid.artist_id) {
                        const artists = await supabaseQuery(
                            cfg,
                            `artists_db?select=email,name&user_id=eq.${bid.artist_id}&limit=1`
                        );
                        if (artists && artists[0]) {
                            artistEmail = artists[0].email || null;
                            artistName = artists[0].name || null;
                        }
                    }
                } catch (lookupErr) {
                    console.warn('[JobBoard] artist lookup for email failed:', lookupErr.message);
                }
                await emailService.sendEmail(emailEventId, {
                    bid_id: bid.id,
                    request_id: bid.request_id,
                    artist_id: bid.artist_id,
                    artist_email: artistEmail,
                    artist_name: artistName,
                    status,
                    timestamp: new Date().toISOString()
                }).catch(e => console.error(`[JobBoard] sendEmail failed:`, e.message));
            })().catch(e => console.error(`[JobBoard] sendEmail wrapper failed:`, e.message));
        } catch (e) { /* webhook optional */ }

        res.json({ success: true, bid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/job-board/matches — Find matching requests for an artist (by style + location + budget)
 * Query params: artist_id (required)
 */
app.get('/api/job-board/matches', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const artistId = req.query.artist_id;
    if (!artistId) {
        return res.status(400).json({ success: false, error: 'artist_id query param is required' });
    }

    try {
        // Get artist profile
        const artists = await supabaseQuery(cfg,
            `artists_db?select=user_id,styles_array,city,country,session_price&user_id=eq.${artistId}`
        );

        if (!artists.length) {
            return res.status(404).json({ success: false, error: 'Artist not found' });
        }

        const artist = artists[0];

        // Get active requests
        const requests = await supabaseQuery(cfg,
            `job_board_requests?select=*&status=in.(active,open)&is_public=eq.true&order=created_at.desc`
        );

        // Score each request for match quality
        const scored = requests.map(r => {
            let score = 0;
            let matchReasons = [];

            // Style match
            const requestStyle = r.tattoo_style?.style_name || r.tattoo_style?.style_slug || '';
            if (requestStyle && artist.styles_array && artist.styles_array.some(s =>
                s.toLowerCase().includes(requestStyle.toLowerCase()) ||
                requestStyle.toLowerCase().includes(s.toLowerCase())
            )) {
                score += 40;
                matchReasons.push('style');
            }

            // Location match
            if (artist.city && r.client_city &&
                artist.city.toLowerCase().includes(r.client_city.toLowerCase())) {
                score += 30;
                matchReasons.push('city');
            } else if (artist.country && r.client_country &&
                artist.country.toLowerCase().includes(r.client_country.toLowerCase())) {
                score += 15;
                matchReasons.push('country');
            }

            // Budget match
            if (artist.session_price && r.client_budget_max) {
                const artistPrice = parseFloat(artist.session_price.replace(/[^0-9.]/g, ''));
                if (!isNaN(artistPrice) && artistPrice <= r.client_budget_max) {
                    score += 20;
                    matchReasons.push('budget');
                }
            }

            // Travel willing bonus
            if (r.client_travel_willing) {
                score += 10;
                matchReasons.push('travel_willing');
            }

            return { ...r, match_score: score, match_reasons: matchReasons };
        });

        // Filter to score > 0 and sort
        const matches = scored
            .filter(r => r.match_score > 0)
            .sort((a, b) => b.match_score - a.match_score);

        res.json({
            success: true,
            artist_id: artistId,
            total_active_requests: requests.length,
            matches_found: matches.length,
            matches
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics/summary — Dashboard summary of all analytics
 * Query params: days (default 30), env (production|development|all)
 */
app.get('/api/analytics/summary', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const env = req.query.env || 'all';

    try {
        const sessions = await supabaseQuery(cfg,
            `analytics_user_sessions?select=user_type,page_path,has_errors,error_count,device_fingerprint,environment,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}${env !== 'all' ? `&environment=eq.${env}` : ''}`
        );

        const devices = await supabaseQuery(cfg,
            `analytics_devices?select=device_type,created_at&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`
        );

        // Compute summary
        const totalSessions = sessions.length;
        const uniqueVisitors = new Set(sessions.map(s => s.device_fingerprint)).size;
        const errorSessions = sessions.filter(s => s.has_errors).length;
        const totalErrors = sessions.reduce((sum, s) => sum + (s.error_count || 0), 0);

        const userTypes = {};
        for (const s of sessions) {
            userTypes[s.user_type] = (userTypes[s.user_type] || 0) + 1;
        }

        const deviceTypes = {};
        for (const d of devices) {
            deviceTypes[d.device_type] = (deviceTypes[d.device_type] || 0) + 1;
        }

        res.json({
            success: true,
            period: { days, environment: env },
            summary: {
                totalSessions,
                uniqueVisitors,
                errorSessions,
                totalErrors,
                errorRate: totalSessions > 0 ? ((errorSessions / totalSessions) * 100).toFixed(1) + '%' : '0%'
            },
            userTypes,
            deviceTypes
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// PRE-QUOTE ESTIMATOR ENDPOINT
// ============================================

/**
 * POST /api/pre-quote/estimate
 * Body: { tattoo_idea_description?, tattoo_style, tattoo_size, tattoo_body_part?, client_city_residence }
 * Returns: { success, estimate, suggestedArtists, matchedArtists, fallbackTier }
 */
app.post('/api/pre-quote/estimate', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const input = {
        tattoo_idea_description: String(req.body.tattoo_idea_description || '').trim(),
        tattoo_style: req.body.tattoo_style,
        tattoo_size: req.body.tattoo_size,
        tattoo_body_part: req.body.tattoo_body_part,
        client_city_residence: String(req.body.client_city_residence || '').trim()
    };

    if (!input.tattoo_style || !input.tattoo_size || !input.client_city_residence) {
        return res.status(400).json({
            success: false,
            error: 'tattoo_style, tattoo_size and client_city_residence are required'
        });
    }

    try {
        const artists = await supabaseQuery(cfg,
            'artists_db?select=user_id,username,name,instagram,portafolio,profile_picture,styles_array,city,country,ubicacion,estudios,session_price,artist_index,verification_state&order=artist_index.desc'
        );

        const result = estimatePreQuote(input, Array.isArray(artists) ? artists : []);
        return res.json({ success: true, ...result });
    } catch (err) {
        console.error('[PreQuote] Estimate failed:', err);
        return res.status(500).json({ success: false, error: 'Could not calculate pre-quote estimate' });
    }
});

// ============================================
// CURRENCY NORMALIZATION ENDPOINTS
// ============================================
// Master currency table refreshed daily by an n8n workflow that fetches
// rates from open.er-api.com and POSTs them to /api/admin/currencies/bulk-update.

const _currencyCache = { data: null, fetchedAt: 0, ttlMs: 60 * 60 * 1000 }; // 1h

function _resetCurrencyCache() {
    _currencyCache.data = null;
    _currencyCache.fetchedAt = 0;
}

/**
 * GET /api/currencies
 * Public list of active currencies and their FX rates against USD and EUR.
 * Cached in-memory for 1 hour.
 */
app.get('/api/currencies', async (req, res) => {
    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return res.status(503).json({ success: false, error: 'Supabase not configured' });
    }

    const force = String(req.query.force || '') === '1';
    const now = Date.now();
    if (!force && _currencyCache.data && (now - _currencyCache.fetchedAt) < _currencyCache.ttlMs) {
        return res.json({ success: true, currencies: _currencyCache.data, cached: true });
    }

    try {
        const url = `${cfg.supabaseUrl}/rest/v1/currencies`
            + `?select=code,name,symbol,decimals,units_per_usd,units_per_eur,is_active,last_updated_at,source`
            + `&is_active=eq.true&order=code.asc`;
        const response = await fetch(url, {
            headers: {
                'apikey': cfg.supabaseAnonKey,
                'Authorization': `Bearer ${cfg.supabaseAnonKey}`
            }
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Supabase responded ${response.status}: ${errText}`);
        }
        const list = await response.json();
        _currencyCache.data = list;
        _currencyCache.fetchedAt = now;
        return res.json({ success: true, currencies: list, cached: false });
    } catch (err) {
        console.error('[Currencies] List failed:', err.message);
        return res.status(500).json({ success: false, error: 'Could not load currencies' });
    }
});

/**
 * POST /api/admin/currencies/bulk-update
 * Called by the n8n daily cron workflow.
 * Auth: header `X-Cron-Token` must match process.env.CRON_API_TOKEN.
 * Body: {
 *   source?: 'open.er-api.com',
 *   rates: [
 *     { code: 'ARS', name?, symbol?, decimals?, units_per_usd, units_per_eur }
 *   ]
 * }
 */
app.post('/api/admin/currencies/bulk-update', async (req, res) => {
    const expectedToken = process.env.CRON_API_TOKEN;
    if (!expectedToken) {
        return res.status(503).json({ success: false, error: 'CRON_API_TOKEN not configured on server' });
    }
    const provided = req.headers['x-cron-token'] || '';
    if (provided !== expectedToken) {
        return res.status(401).json({ success: false, error: 'Invalid cron token' });
    }

    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase service role not configured' });
    }

    const source = String(req.body?.source || 'open.er-api.com').slice(0, 100);
    const rates = Array.isArray(req.body?.rates) ? req.body.rates : null;
    if (!rates || !rates.length) {
        return res.status(400).json({ success: false, error: 'Body must include non-empty `rates` array' });
    }

    const now = new Date().toISOString();
    const rows = [];
    const skipped = [];
    for (const r of rates) {
        const code = String(r.code || '').trim().toUpperCase();
        const upu = Number(r.units_per_usd);
        const upe = Number(r.units_per_eur);
        if (!/^[A-Z]{3}$/.test(code) || !isFinite(upu) || upu <= 0 || !isFinite(upe) || upe <= 0) {
            skipped.push({ code: r.code, reason: 'invalid code or rate' });
            continue;
        }
        rows.push({
            code,
            name: String(r.name || code).slice(0, 100),
            symbol: r.symbol ? String(r.symbol).slice(0, 16) : null,
            decimals: Number.isInteger(r.decimals) ? r.decimals : 2,
            units_per_usd: upu,
            units_per_eur: upe,
            is_active: true,
            source,
            last_updated_at: now
        });
    }

    if (!rows.length) {
        return res.status(400).json({ success: false, error: 'No valid currencies in payload', skipped });
    }

    let upserted = 0;
    let errorMessage = null;
    let status = 'success';

    try {
        const upsertUrl = `${cfg.supabaseUrl}/rest/v1/currencies?on_conflict=code`;
        const response = await fetch(upsertUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'resolution=merge-duplicates,return=representation'
            },
            body: JSON.stringify(rows)
        });
        if (!response.ok) {
            errorMessage = `Supabase upsert failed: ${response.status} ${await response.text()}`;
            status = 'error';
        } else {
            const data = await response.json();
            upserted = Array.isArray(data) ? data.length : rows.length;
            if (skipped.length) status = 'partial';
        }
    } catch (err) {
        errorMessage = err.message;
        status = 'error';
    }

    // Audit log (best-effort)
    try {
        await fetch(`${cfg.supabaseUrl}/rest/v1/currency_refresh_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`
            },
            body: JSON.stringify({
                source,
                currencies_updated: upserted,
                status,
                error_message: errorMessage,
                raw_payload: { count_in: rates.length, count_skipped: skipped.length }
            })
        });
    } catch (logErr) {
        console.warn('[Currencies] Audit log failed:', logErr.message);
    }

    _resetCurrencyCache();

    if (status === 'error') {
        return res.status(500).json({ success: false, error: errorMessage, upserted, skipped });
    }
    return res.json({ success: true, status, upserted, skipped, source, refreshed_at: now });
});

/**
 * POST /api/admin/currencies/refresh-now
 * Manual refresh from the backoffice. Fetches rates from open.er-api.com server-side
 * and writes them to Supabase via the bulk-update logic.
 * Requires: header `X-Cron-Token` (admin-only operation).
 */
app.post('/api/admin/currencies/refresh-now', async (req, res) => {
    const expectedToken = process.env.CRON_API_TOKEN;
    if (!expectedToken) {
        return res.status(503).json({ success: false, error: 'CRON_API_TOKEN not configured on server' });
    }
    const provided = req.headers['x-cron-token'] || '';
    if (provided !== expectedToken) {
        return res.status(401).json({ success: false, error: 'Invalid cron token' });
    }

    try {
        const apiResponse = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!apiResponse.ok) {
            throw new Error(`open.er-api.com responded ${apiResponse.status}`);
        }
        const payload = await apiResponse.json();
        if (payload.result !== 'success' || !payload.rates) {
            throw new Error('open.er-api.com returned unexpected payload');
        }

        const eurPerUsd = Number(payload.rates.EUR);
        if (!isFinite(eurPerUsd) || eurPerUsd <= 0) {
            throw new Error('Missing EUR rate from provider');
        }

        const rates = Object.entries(payload.rates).map(([code, units_per_usd]) => {
            const upu = Number(units_per_usd);
            return {
                code,
                units_per_usd: upu,
                units_per_eur: upu / eurPerUsd
            };
        }).filter(r => isFinite(r.units_per_usd) && r.units_per_usd > 0
                    && isFinite(r.units_per_eur) && r.units_per_eur > 0);

        // Forward through the bulk-update logic by re-issuing an internal request
        req.body = { source: 'open.er-api.com', rates };
        // Re-dispatch: simplest is to call the handler directly via routing helper.
        // Express doesn't expose handlers easily, so duplicate the upsert here.
        const cfg = getHealthConfig();
        if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
            return res.status(503).json({ success: false, error: 'Supabase service role not configured' });
        }

        const now = new Date().toISOString();
        const rows = rates.map(r => ({
            code: r.code,
            name: r.code,
            symbol: null,
            decimals: 2,
            units_per_usd: r.units_per_usd,
            units_per_eur: r.units_per_eur,
            is_active: true,
            source: 'open.er-api.com',
            last_updated_at: now
        }));

        const upsertUrl = `${cfg.supabaseUrl}/rest/v1/currencies?on_conflict=code`;
        const upsertRes = await fetch(upsertUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`,
                'Prefer': 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(rows)
        });
        if (!upsertRes.ok) {
            const errText = await upsertRes.text();
            throw new Error(`Supabase upsert failed: ${upsertRes.status} ${errText}`);
        }

        await fetch(`${cfg.supabaseUrl}/rest/v1/currency_refresh_logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`
            },
            body: JSON.stringify({
                source: 'open.er-api.com',
                currencies_updated: rows.length,
                status: 'success',
                raw_payload: { trigger: 'manual', count: rows.length }
            })
        }).catch(() => {});

        _resetCurrencyCache();

        return res.json({ success: true, upserted: rows.length, refreshed_at: now });
    } catch (err) {
        console.error('[Currencies] Manual refresh failed:', err.message);
        try {
            const cfg = getHealthConfig();
            if (cfg.supabaseUrl && cfg.supabaseServiceKey) {
                await fetch(`${cfg.supabaseUrl}/rest/v1/currency_refresh_logs`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': cfg.supabaseServiceKey,
                        'Authorization': `Bearer ${cfg.supabaseServiceKey}`
                    },
                    body: JSON.stringify({
                        source: 'open.er-api.com',
                        currencies_updated: 0,
                        status: 'error',
                        error_message: err.message,
                        raw_payload: { trigger: 'manual' }
                    })
                });
            }
        } catch { /* ignore */ }
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// EMAIL ROUTING (BillionMail / n8n / dual / off)
// Centralized dispatcher for all transactional emails.
// See services/email-service.js and services/email-event-mapping.js.
// IMPORTANT: register specific routes (/events, /test) BEFORE the catch-all
// /api/email/:eventId so Express does not interpret 'test' as an eventId.
// ============================================

/**
 * List all email events with their current routing channel.
 * GET /api/email/events
 */
app.get('/api/email/events', async (req, res) => {
    try {
        const events = await emailService.getEventsWithRouting();
        return res.json({ success: true, count: events.length, events });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Update routing for a single event id.
 * PUT /api/email/events/:eventId
 * Body: { channel: 'n8n'|'billionmail'|'dual'|'off',
 *         billionmail_api_key?, billionmail_sender?, n8n_webhook_url? }
 *
 * NOTE: Authorization is enforced at the backoffice UI level (same pattern as the rest
 * of /api/admin/*). The authLimiter prevents brute-force changes to the routing config.
 */
app.put('/api/email/events/:eventId', async (req, res) => {
    const eventId = req.params.eventId;
    if (!emailEventMapping.getEvent(eventId)) {
        return res.status(404).json({ success: false, error: `Unknown eventId: ${eventId}` });
    }
    const allowed = ['channel', 'billionmail_api_key', 'billionmail_sender', 'billionmail_api_url', 'n8n_webhook_url'];
    const updates = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No update fields provided' });
    }

    try {
        const result = await emailService.updateRoutingForEvent(eventId, updates);
        if (!result.ok) return res.status(500).json({ success: false, error: result.error });
        const refreshed = (await emailService.getEventsWithRouting()).find(e => e.id === eventId);
        return res.json({ success: true, event: refreshed });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Send a synthetic test email for an event id (admin / QA).
 * POST /api/email/test
 * Body: { eventId, recipient, channel? }
 * - When `recipient` is set, payload is built minimally so the recipient receives the test.
 */
app.post('/api/email/test', authLimiter, async (req, res) => {
    const { eventId, recipient, channel } = req.body || {};
    if (!eventId) return res.status(400).json({ success: false, error: 'eventId required' });
    if (!emailEventMapping.getEvent(eventId)) {
        return res.status(404).json({ success: false, error: `Unknown eventId: ${eventId}` });
    }
    if (!recipient || !String(recipient).includes('@')) {
        return res.status(400).json({ success: false, error: 'Valid recipient email required' });
    }

    // Build a synthetic payload that satisfies the most common recipient resolvers.
    const stub = {
        email: recipient,
        client_email: recipient,
        artist_email: recipient,
        admin_email: recipient,
        username: 'test_user',
        password: 'TempPass123!',
        temp_password: 'TempPass123!',
        full_name: 'Test User',
        name: 'Test User',
        artist_name: 'Test Artist',
        client_name: 'Test Client',
        quote_id: 'TEST-0001',
        login_url: 'https://weotzi.chat/client/login',
        dashboard_url: 'https://weotzi.chat/client/dashboard',
        timestamp: new Date().toISOString()
    };

    try {
        const result = await emailService.sendEmail(eventId, stub, {
            forceChannel: channel && emailService.VALID_CHANNELS.includes(channel) ? channel : undefined
        });
        return res.json({ success: !!result.ok, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Dispatch an email event (catch-all eventId route, must come after /events and /test).
 * POST /api/email/:eventId
 * Body: { data: {...} }
 * Optional query: ?force=billionmail|n8n|dual|off  (admin-only override)
 */
app.post('/api/email/:eventId', async (req, res) => {
    const eventId = req.params.eventId;
    const payload = (req.body && req.body.data) || req.body || {};
    const forceChannel = req.query.force ? String(req.query.force) : undefined;

    if (!emailEventMapping.getEvent(eventId)) {
        return res.status(404).json({ success: false, error: `Unknown eventId: ${eventId}` });
    }

    try {
        const result = await emailService.sendEmail(eventId, payload, { forceChannel });
        const status = result.ok ? 200 : (result.skipped ? 200 : 502);
        return res.status(status).json({ success: !!result.ok, ...result });
    } catch (err) {
        console.error(`[email] dispatch failed for ${eventId}:`, err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Redirect root to quotation page
app.get('/', (req, res) => {
    res.redirect('/quotation');
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle clean URLs (without .html extension)
app.get('*', (req, res) => {
    // Skip requests for static files
    if (req.path.includes('.')) {
        return res.status(404).send('Not Found');
    }

    // Try to serve index.html from the requested path
    const requestedPath = path.join(__dirname, 'public', req.path, 'index.html');
    
    res.sendFile(requestedPath, (err) => {
        if (err) {
            // If not found, try the path as-is with .html
            const htmlPath = path.join(__dirname, 'public', req.path + '.html');
            res.sendFile(htmlPath, (err2) => {
                if (err2) {
                    res.status(404).send(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>404 - Not Found</title>
                            <style>
                                body { 
                                    font-family: 'JetBrains Mono', monospace; 
                                    display: flex; 
                                    justify-content: center; 
                                    align-items: center; 
                                    height: 100vh; 
                                    margin: 0;
                                    background: #1a1a1a;
                                    color: #fff;
                                }
                                .error { 
                                    text-align: center;
                                    border: 3px solid #E63946;
                                    padding: 40px;
                                }
                                h1 { color: #E63946; margin: 0 0 10px 0; }
                                p { margin: 0; }
                                a { color: #F4D03F; }
                            </style>
                        </head>
                        <body>
                            <div class="error">
                                <h1>404</h1>
                                <p>Page not found</p>
                                <p style="margin-top: 20px;"><a href="/">Go to home</a></p>
                            </div>
                        </body>
                        </html>
                    `);
                }
            });
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║     WE ÖTZI - Unified Server Running       ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Port:        ${PORT}`);
    console.log(`  Local:       http://localhost:${PORT}`);
    console.log('');
    
    // Log configuration status
    console.log('  Configuration Status:');
    console.log('  ─────────────────────────────────────────');
    console.log(`  Supabase:     ${process.env.SUPABASE_URL ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  Google Maps:  ${process.env.GOOGLE_MAPS_API_KEY ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  n8n Webhook:  ${process.env.N8N_WEBHOOK_URL ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  Demo Mode:    ${process.env.DEMO_MODE || 'Not set (check file)'}`);
    console.log('');
    
    console.log('  Routes available:');
    console.log('  ─────────────────────────────────────────');
    console.log(`  /registerclosedbeta    - Landing & Registration`);
    console.log(`  /register-artist       - Artist Registration Form`);
    console.log(`  /artist/dashboard      - Artist Dashboard`);
    console.log(`  /artist/profile        - Public Artist Profile`);
    console.log(`  /my-quotations         - Artist Quotations Panel`);
    console.log(`  /calendar              - Calendar View`);
    console.log(`  /archive               - Archived Quotations`);
    console.log(`  /quotation             - Quotation Form (Client)`);
    console.log(`  /marketplace           - Artists Marketplace`);
    console.log(`  /backoffice            - Admin Panel`);
    console.log(`  /support/login         - Support Login`);
    console.log(`  /support/dashboard     - Support Dashboard`);
    console.log(`  /tutorial              - Interactive Tour`);
    console.log('');
    console.log('  Client Portal:');
    console.log('  ─────────────────────────────────────────');
    console.log(`  /client/login          - Client Login`);
    console.log(`  /client/register       - Client Registration`);
    console.log(`  /client/dashboard      - Client Dashboard`);
    console.log('');
    console.log('  Job Board:');
    console.log('  ─────────────────────────────────────────');
    console.log('  /job-board             - Job Board (Public Feed)');
    console.log('  /job-board/request     - Publish Tattoo Request');
    console.log('');
});
