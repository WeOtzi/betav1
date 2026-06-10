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
const artistRegistration = require('./lib/artist-registration');
const emailService = require('./services/email-service');
const emailEventMapping = require('./services/email-event-mapping');
const { startLocalNgrok } = require('./lib/local-ngrok');

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

const APP_BASE_PATH = '/beta';

function stripAppBasePath(req, res, next) {
    const rawUrl = req.url || '';
    const queryIndex = rawUrl.indexOf('?');
    const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
    const search = queryIndex === -1 ? '' : rawUrl.slice(queryIndex);

    if (pathname === APP_BASE_PATH || pathname === `${APP_BASE_PATH}/`) {
        return res.redirect(`${APP_BASE_PATH}/quotation${search}`);
    }

    if (pathname.startsWith(`${APP_BASE_PATH}/`)) {
        req.weotziBasePath = APP_BASE_PATH;
        req.url = pathname.slice(APP_BASE_PATH.length) + search;
    }

    return next();
}

app.use(stripAppBasePath);

// Helmet: Security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disabled — app uses inline scripts and CDN resources
    crossOriginEmbedderPolicy: false
}));

// CORS: Restrict origins
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4545')
    .split(',')
    .map(o => o.trim());

function isLocalDevelopmentOrigin(origin) {
    if (process.env.NODE_ENV === 'production') return false;
    try {
        const { hostname } = new URL(origin);
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch {
        return false;
    }
}

function isDevelopmentTunnelOrigin(origin) {
    if (process.env.NODE_ENV === 'production') return false;
    try {
        const { protocol, hostname } = new URL(origin);
        if (protocol !== 'https:' && protocol !== 'http:') return false;
        return hostname.endsWith('.ngrok.app')
            || hostname.endsWith('.ngrok-free.app')
            || hostname.endsWith('.ngrok.io');
    } catch {
        return false;
    }
}

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (server-to-server, curl, mobile apps)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || isLocalDevelopmentOrigin(origin) || isDevelopmentTunnelOrigin(origin)) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// Rate limiting: General API endpoints
// 300/15min covers the pre-auth registration wizard, which fires ~30-60 autosaves
// to /api/register/artist-draft plus uniqueness checks, IG preview/commit, etc.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' }
});

// Rate limiting: Sensitive endpoints that create or modify auth credentials.
// Reserved for actual auth operations — NOT autosave endpoints. Putting a
// high-frequency endpoint here exhausts the bucket and starves the legit
// auth endpoints (e.g. artist-finalize) of their quota.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many authentication attempts, please try again later.' }
});

// Apply rate limits
app.use('/api/', apiLimiter);
app.use('/api/admin/update-user-password', authLimiter);
app.use('/api/auth/reset-temp-password', authLimiter);
app.use('/api/email/events', authLimiter);
// /api/register/artist-draft is intentionally NOT under authLimiter — it is a
// high-frequency form autosave (~30-60 calls per wizard session), not an auth
// operation. apiLimiter is sufficient. /api/register/artist-finalize stays
// here because that one actually creates the auth.users entry.
app.use('/api/register/artist-finalize', authLimiter);

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
// Tablas: support_conversations, support_messages.

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
    // clients_db and support_users_db expose `full_name`, not `name`. We alias
    // it via PostgREST (`name:full_name`) so downstream consumers (e.g. the
    // chatbot system prompt) keep reading `profile.name` uniformly.
    // Each lookup is independently try/catch'd so a failure in one table does
    // not short-circuit role detection for the others.
    try {
        const artists = await _supabaseFetch(`artists_db?user_id=eq.${userId}&select=id,name,username,email`);
        if (artists && artists.length) return { role: 'artist', profile: artists[0] };
    } catch (err) {
        console.warn('[support-chat] artist role lookup failed:', err.message);
    }
    try {
        const clients = await _supabaseFetch(`clients_db?user_id=eq.${userId}&select=id,name:full_name,email`);
        if (clients && clients.length) return { role: 'client', profile: clients[0] };
    } catch (err) {
        console.warn('[support-chat] client role lookup failed:', err.message);
    }
    if (email) {
        try {
            const support = await _supabaseFetch(`support_users_db?email=eq.${encodeURIComponent(email)}&select=id,name:full_name,is_active`);
            if (support && support.length) return { role: 'support', profile: support[0] };
        } catch (err) {
            console.warn('[support-chat] support role lookup failed:', err.message);
        }
    }
    return { role: 'anonymous', profile: null };
}

async function _getActiveSupportAgent(req) {
    const authUser = await _getAuthUserFromBearer(req);
    if (!authUser?.id) {
        return { ok: false, status: 401, error: 'Authentication required' };
    }

    try {
        const rows = await _supabaseFetch(
            `support_users_db?user_id=eq.${authUser.id}&is_active=eq.true&select=user_id,email,full_name,role,is_active&limit=1`
        );
        if (!rows || !rows.length) {
            return { ok: false, status: 403, error: 'Support agent access required' };
        }
        return { ok: true, authUser, supportUser: rows[0], supportUserId: rows[0].user_id || authUser.id };
    } catch (err) {
        console.warn('[support-chat] support agent auth failed:', err.message);
        return { ok: false, status: 500, error: 'Could not verify support agent' };
    }
}

async function _supportConversationAccess(req, conversation) {
    if (!conversation) return { ok: false, status: 404, error: 'Conversacion no encontrada' };

    const authUser = await _getAuthUserFromBearer(req);
    if (authUser?.id && conversation.user_id === authUser.id) {
        return { ok: true, authUser, role: 'owner' };
    }

    const anonymousId = String(req.body?.anonymous_id || '').trim();
    if (!conversation.user_id && anonymousId && conversation.anonymous_id === anonymousId) {
        return { ok: true, authUser: null, role: 'anonymous-owner' };
    }

    const supportAgent = await _getActiveSupportAgent(req);
    if (supportAgent.ok) {
        return { ok: true, ...supportAgent, role: 'support-agent' };
    }

    return { ok: false, status: 403, error: 'Conversation access denied' };
}

function _isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
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
        'Tienes acceso a herramientas (tools) para consultar cotizaciones, verificación y FAQ. Úsalas cuando aplique.',
        'Cuando el usuario pida explícitamente hablar con un humano (palabras como "humano", "agente", "persona real"), llama a escalate_to_human.',
        `Si después de ${SUPPORT_CHAT_ESCALATE_AFTER} intentos no puedes resolver, llama a escalate_to_human tú solo.`,
        'Si el usuario reporta un bug reproducible o algo que requiere acción del equipo, ofrece escalar a un agente humano.',
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
        const anonymousId = _isUuid(anonymous_id) ? anonymous_id : crypto.randomUUID();

        // Auto-link: si llega JWT + anonymous_id, promover la conversación anónima al user_id
        if (authUser?.id && _isUuid(anonymous_id)) {
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
        } else {
            const rows = await _supabaseFetch(
                `support_conversations?anonymous_id=eq.${anonymousId}&status=neq.closed&order=last_message_at.desc&limit=1`
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
            anonymous_id: authUser?.id ? null : anonymousId,
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

        const access = await _supportConversationAccess(req, conv);
        if (!access.ok) {
            return res.status(access.status).json({ success: false, error: access.error });
        }

        const authUser = access.authUser || null;
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
        const convRows = await _supabaseFetch(`support_conversations?id=eq.${conversation_id}&limit=1`);
        const access = await _supportConversationAccess(req, convRows?.[0]);
        if (!access.ok) {
            return res.status(access.status).json({ success: false, error: access.error });
        }

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
    const { conversation_id } = req.body || {};
    if (!conversation_id) return res.status(400).json({ success: false, error: 'conversation_id requerido' });
    try {
        const agent = await _getActiveSupportAgent(req);
        if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });

        await _supabaseFetch(`support_conversations?id=eq.${conversation_id}`, {
            method: 'PATCH',
            body: { status: 'human', assigned_support_user_id: agent.supportUserId, updated_at: new Date().toISOString() },
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
        const agent = await _getActiveSupportAgent(req);
        if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });

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
    const { conversation_id, content } = req.body || {};
    if (!conversation_id || !content) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try {
        const agent = await _getActiveSupportAgent(req);
        if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });

        await _supabaseFetch('support_messages', {
            method: 'POST',
            body: [{
                conversation_id,
                role: 'human_agent',
                content,
                author_user_id: agent.supportUserId
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
        const agent = await _getActiveSupportAgent(req);
        if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });

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
    if (!_isUuid(anonymous_id)) return res.status(400).json({ success: false, error: 'anonymous_id invalido' });
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
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

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
// SUPABASE ADMIN API - DELETE ARTIST
// ============================================

/**
 * Delete an artist using the Supabase service-role key.
 * POST /api/admin/delete-artist
 * Body: { id?, userId? }  — at least one. `id` (the artists_db primary key) is
 * preferred; `user_id` is nullable since migration 20260513000000 made it
 * optional for registration drafts / imported artists, so it can't be relied
 * on to identify a row.
 *
 * Why server-side: the browser does this with the anon/authenticated key,
 * which is gated by the "Support admins can delete artists" RLS policy. That
 * policy only passes if the caller has an active admin row in support_users_db,
 * so an expired session or an unseeded support row makes the DELETE silently
 * affect 0 rows. The service-role key bypasses RLS entirely, so the superadmin
 * can remove ANY artist. Authorization is enforced by verifyAdminCaller.
 *
 * The DB trigger trigger_delete_auth_on_artist_delete cascades the matching
 * auth.users row automatically (a no-op when user_id is NULL, i.e. a draft),
 * and it already refuses to touch the superadmin account. We add an explicit
 * pre-check here too so the caller gets a clear 403.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.post('/api/admin/delete-artist', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const { id, userId } = req.body || {};

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({
            success: false,
            error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
        });
    }

    // Prefer the primary key `id`; fall back to user_id only if no id given.
    // Both columns are UUID — validate format so a bad value yields a clean
    // 400 instead of a confusing PostgREST 400, and never reaches the URL
    // unvalidated.
    let column, value;
    if (typeof id === 'string' && UUID_RE.test(id)) {
        column = 'id';
        value = id;
    } else if (typeof userId === 'string' && UUID_RE.test(userId)) {
        column = 'user_id';
        value = userId;
    } else {
        return res.status(400).json({
            success: false,
            error: 'Falta un identificador válido (id o userId en formato UUID)'
        });
    }

    const filter = `${column}=eq.${encodeURIComponent(value)}`;

    const svcHeaders = {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`
    };

    try {
        // Step 1: look up the target so we can (a) confirm it exists and
        // (b) refuse to delete the superadmin account.
        const lookupRes = await fetch(
            `${supabaseUrl}/rest/v1/artists_db?${filter}&select=id,user_id,email`,
            { method: 'GET', headers: svcHeaders }
        );
        if (!lookupRes.ok) {
            const errBody = await lookupRes.text();
            console.error('[Admin API] delete-artist lookup failed:', lookupRes.status, errBody);
            return res.status(502).json({ success: false, error: `Supabase lookup failed: HTTP ${lookupRes.status}` });
        }
        const rows = await lookupRes.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontró ningún artista con ese identificador.' });
        }
        const targetEmail = String(rows[0].email || '').trim().toLowerCase();
        if (targetEmail && appSettings.isSuperadminEmail(targetEmail)) {
            return res.status(403).json({ success: false, error: 'No se puede eliminar la cuenta superadmin.' });
        }

        // Step 2: delete. return=representation makes PostgREST echo the deleted
        // row so we can distinguish a real delete from a 0-row no-op.
        const delRes = await fetch(
            `${supabaseUrl}/rest/v1/artists_db?${filter}`,
            { method: 'DELETE', headers: { ...svcHeaders, 'Prefer': 'return=representation' } }
        );

        if (!delRes.ok) {
            const errBody = await delRes.text();
            console.error('[Admin API] delete-artist DELETE failed:', delRes.status, errBody);
            // 23503 = FK violation: related rows block the delete. Surface it.
            return res.status(409).json({
                success: false,
                error: `No se pudo eliminar (puede haber registros relacionados). HTTP ${delRes.status}: ${errBody.slice(0, 300)}`
            });
        }

        const deleted = await delRes.json();
        if (!Array.isArray(deleted) || deleted.length === 0) {
            return res.status(404).json({ success: false, error: 'No se eliminó ninguna fila.' });
        }

        console.log(`[Admin API] Artist deleted by superadmin ${auth.email}: ${column}=${value}`);
        return res.json({ success: true, message: 'Artista eliminado correctamente' });

    } catch (error) {
        console.error('[Admin API] delete-artist error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
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
 * 3. Return success (caller then triggers n8n webhook)
 * La contrasena solo vive en auth.users; nunca se espeja a tablas de perfil.
 */
app.post('/api/auth/reset-temp-password', async (req, res) => {
    // Authorization: this endpoint can set ANY user's auth password to a
    // caller-chosen value, so it must be gated. Two trusted callers exist:
    //   (1) Authenticated support agent (Bearer JWT of an active support_users_db
    //       row) — used by the support dashboard "reset password" action.
    //   (2) Server-to-server calls authenticated with the Supabase service-role
    //       key in the `apikey` header — used by n8n's "forgot password" flow.
    // Anything else is rejected. Without this check, an anonymous attacker
    // could POST { email: victim, tempPassword: 'attackerChoice' } and take
    // over the victim's account.
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const providedApiKey = req.headers['apikey'] || req.headers['x-supabase-service-role'];
    let authorized = false;
    let authMode = null;
    if (providedApiKey && serviceRoleKey && providedApiKey === serviceRoleKey) {
        authorized = true;
        authMode = 'service-role';
    } else {
        const agent = await _getActiveSupportAgent(req);
        if (agent.ok) {
            authorized = true;
            authMode = 'support-agent';
        }
    }
    if (!authorized) {
        return res.status(401).json({
            success: false,
            error: 'Esta operacion requiere credenciales de soporte o service-role.'
        });
    }
    console.log(`[Auth] reset-temp-password authorized via ${authMode}`);

    const { email, userType, tempPassword } = req.body;

    // Validation
    if (!email || !userType || !tempPassword) {
        return res.status(400).json({
            success: false,
            error: 'Faltan parametros requeridos (email, userType, tempPassword)'
        });
    }
    
    if (!['artist', 'client', 'studio'].includes(userType)) {
        return res.status(400).json({
            success: false,
            error: 'userType debe ser "artist", "client" o "studio"'
        });
    }
    
    if (tempPassword.length < 6) {
        return res.status(400).json({ 
            success: false, 
            error: 'La contrasena temporal debe tener al menos 6 caracteres' 
        });
    }
    
    // Get Supabase credentials from environment (serviceRoleKey was already
    // resolved at the top of this handler for the authorization check).
    const supabaseUrl = process.env.SUPABASE_URL;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('[Auth] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
        return res.status(500).json({
            success: false,
            error: 'Configuracion de servidor incompleta. Contacta al administrador.'
        });
    }
    
    try {
        // Determine which table to query
        const tableName = (
            userType === 'artist' ? 'artists_db'
          : userType === 'studio' ? 'studios'
          : 'clients_db'
        );
        
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

        // auth.users es la unica fuente de verdad de la contrasena. No se
        // espeja texto plano a tablas de perfil (la columna artists_db.password
        // se elimino: era legible con la anon key).

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
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

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

// Full catalog of tables/views the backoffice "Base de Datos" inspector can
// browse. `kind: 'view'` rows are read-only (PostgREST cannot UPDATE/DELETE a
// view), so the generic row-edit endpoints reject them — the writable set
// below is derived from this and used as the gate. Adding a name here is the
// only thing required to surface a table in the inspector.
const ADMIN_DATABASE_TABLES = [
    // Core users / accounts
    { name: 'artists_db', description: 'Artistas registrados' },
    { name: 'clients_db', description: 'Clientes' },
    { name: 'studios', description: 'Estudios' },
    { name: 'support_users_db', description: 'Usuarios de soporte' },
    { name: 'client_accounts', description: 'Cuentas de clientes (legacy)' },
    // Studios domain
    { name: 'studio_locations', description: 'Sedes de estudios' },
    { name: 'studio_artist_memberships', description: 'Membresias artista-estudio' },
    { name: 'studio_spots', description: 'Vacantes / spots de estudios' },
    { name: 'studio_spot_applications', description: 'Postulaciones a spots' },
    { name: 'studio_spot_attachments', description: 'Adjuntos de spots' },
    { name: 'studio_jobs_log', description: 'Registro de trabajos del estudio' },
    { name: 'studio_invoices', description: 'Facturas del estudio' },
    { name: 'studio_invoice_items', description: 'Items de factura' },
    { name: 'studio_inventory_items', description: 'Inventario (items)' },
    { name: 'studio_inventory_movements', description: 'Movimientos de inventario' },
    { name: 'studio_suppliers', description: 'Proveedores' },
    { name: 'studio_sponsors', description: 'Patrocinadores' },
    { name: 'studio_sponsor_artists', description: 'Patrocinios a artistas' },
    { name: 'studio_documents', description: 'Documentos del estudio' },
    // Quotations domain
    { name: 'quotations_db', description: 'Cotizaciones' },
    { name: 'quotations_attachments', description: 'Adjuntos de cotizaciones' },
    { name: 'quotation_notes', description: 'Notas de cotizacion' },
    { name: 'quotation_sessions', description: 'Sesiones de cotizacion' },
    { name: 'quotation_flow_config', description: 'Configuracion del flujo' },
    // Catalog / artist content
    { name: 'tattoo_styles', description: 'Estilos de tatuaje' },
    { name: 'body_parts', description: 'Partes del cuerpo' },
    { name: 'artist_tattoo_locations', description: 'Ubicaciones de tatuaje (artistas)' },
    { name: 'artist_profile_visits', description: 'Visitas a perfiles de artistas' },
    // Job board
    { name: 'job_board_requests', description: 'Solicitudes del job board' },
    { name: 'job_board_applications', description: 'Postulaciones del job board' },
    { name: 'job_board_attachments', description: 'Adjuntos del job board' },
    // Support / chat
    { name: 'support_conversations', description: 'Conversaciones de soporte' },
    { name: 'support_messages', description: 'Mensajes de soporte' },
    { name: 'chat_messages', description: 'Mensajes de chat' },
    // Platform / ops
    { name: 'app_settings', description: 'Configuracion de la app' },
    { name: 'session_logs', description: 'Logs de sesion' },
    { name: 'service_health_logs', description: 'Salud de servicios' },
    { name: 'currencies', description: 'Monedas' },
    { name: 'currency_refresh_logs', description: 'Logs de tipos de cambio' },
    { name: 'instagram_imports', description: 'Importaciones de Instagram' },
    // Read-only views
    { name: 'artists_with_location', description: 'Artistas con ubicacion (vista)', kind: 'view' },
    { name: 'artist_profile_visits_daily', description: 'Visitas diarias (vista)', kind: 'view' },
    { name: 'studio_dashboard_metrics_view', description: 'Metricas de panel de estudio (vista)', kind: 'view' },
    { name: 'studio_artist_performance_view', description: 'Rendimiento de artistas (vista)', kind: 'view' },
    { name: 'studio_inventory_health_view', description: 'Salud de inventario (vista)', kind: 'view' },
    { name: 'studio_public_sponsors_view', description: 'Patrocinadores publicos (vista)', kind: 'view' }
];
const ADMIN_DATABASE_TABLE_NAMES = new Set(ADMIN_DATABASE_TABLES.map(table => table.name));
// Only base tables are writable through the generic row editor. Views and any
// name not in the catalog above are rejected by the PATCH/DELETE endpoints.
const ADMIN_DATABASE_WRITABLE = new Set(
    ADMIN_DATABASE_TABLES.filter(table => table.kind !== 'view').map(table => table.name)
);
// Column-name guard for the generic row editor: PostgREST identifiers are
// lowercase snake_case, so anything else is rejected before building a filter.
const SAFE_COLUMN_RE = /^[a-z_][a-z0-9_]*$/;
const SUPPORT_ROLES = new Set(['support', 'supervisor', 'admin']);

function parseBoundedInt(value, fallback, { min = 0, max = 1000 } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function parseContentRangeTotal(response) {
    const contentRange = response.headers.get('content-range') || '';
    const total = contentRange.split('/')[1];
    if (!total || total === '*') return null;
    const parsed = Number.parseInt(total, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

const SAFE_ORDER_RE = /^[a-z_][a-z0-9_]*(\.(asc|desc))?$/;

async function fetchAdminTableRows(tableName, { limit = 50, offset = 0, filterColumn, filterValue, order } = {}) {
    if (!ADMIN_DATABASE_TABLE_NAMES.has(tableName)) {
        const err = new Error('Invalid table name');
        err.status = 400;
        throw err;
    }

    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    if (!supabaseUrl || !serviceRoleKey) {
        const err = new Error('Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        err.status = 500;
        throw err;
    }

    const safeLimit = parseBoundedInt(limit, 50, { min: 1, max: 1000 });
    const safeOffset = parseBoundedInt(offset, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });

    // Optional equality filter (e.g. studio_id=eq.<uuid>) and ordering. Column
    // names are validated so they can never break out of the query.
    let query = `select=*`;
    if (filterColumn) {
        if (!SAFE_COLUMN_RE.test(filterColumn)) {
            const err = new Error('Invalid filter column'); err.status = 400; throw err;
        }
        query += `&${filterColumn}=eq.${encodeURIComponent(filterValue == null ? '' : filterValue)}`;
    }
    if (order) {
        if (!SAFE_ORDER_RE.test(order)) {
            const err = new Error('Invalid order'); err.status = 400; throw err;
        }
        query += `&order=${order}`;
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}?${query}`, {
        headers: {
            ...getAdminHeaders(serviceRoleKey),
            'Range': `${safeOffset}-${safeOffset + safeLimit - 1}`,
            'Prefer': 'count=exact'
        }
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        const err = new Error(`Supabase table read failed (${response.status}): ${body.slice(0, 200)}`);
        err.status = 502;
        throw err;
    }

    const text = await response.text();
    return {
        rows: text ? JSON.parse(text) : [],
        count: parseContentRangeTotal(response),
        limit: safeLimit,
        offset: safeOffset
    };
}

async function fetchAdminTableCount(tableName) {
    const result = await fetchAdminTableRows(tableName, { limit: 1, offset: 0 });
    return result.count ?? result.rows.length;
}

/**
 * Get list of database tables for backup selection
 * GET /api/admin/backup-tables
 */
app.get('/api/admin/backup-tables', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    res.json({ success: true, tables: ADMIN_DATABASE_TABLES });
});

app.get('/api/admin/database/tables', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const tables = await Promise.all(ADMIN_DATABASE_TABLES.map(async table => {
        try {
            return { ...table, count: await fetchAdminTableCount(table.name) };
        } catch (err) {
            return { ...table, count: null, error: err.message };
        }
    }));

    res.json({ success: true, tables });
});

app.get('/api/admin/database/tables/:tableName', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    try {
        const result = await fetchAdminTableRows(req.params.tableName, {
            limit: req.query.limit,
            offset: req.query.offset,
            filterColumn: req.query.filterColumn,
            filterValue: req.query.filterValue,
            order: req.query.order
        });
        res.json({ success: true, table: req.params.tableName, ...result });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

/**
 * Insert a row into any writable table.
 * POST /api/admin/database/tables/:tableName/row   Body: { values: {col: val} }
 * Powers "Agregar" in the studio operations tabs (and the generic inspector).
 */
app.post('/api/admin/database/tables/:tableName/row', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const tableName = req.params.tableName;
    if (!ADMIN_DATABASE_WRITABLE.has(tableName)) {
        const isView = ADMIN_DATABASE_TABLE_NAMES.has(tableName);
        return res.status(400).json({
            success: false,
            error: isView ? 'Esta es una vista de solo lectura.' : 'Tabla no permitida.'
        });
    }
    const values = req.body && req.body.values;
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) {
        return res.status(400).json({ success: false, error: 'No hay valores para insertar.' });
    }
    for (const col of Object.keys(values)) {
        if (!SAFE_COLUMN_RE.test(col)) {
            return res.status(400).json({ success: false, error: `Nombre de columna inválido: ${col}` });
        }
    }

    try {
        const rows = await _supabaseFetch(tableName, {
            method: 'POST', prefer: 'return=representation', body: values
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        console.log(`[Admin API] Row inserted by ${auth.email}: ${tableName}`);
        res.json({ success: true, row });
    } catch (err) {
        const msg = /23503|foreign key/i.test(err.message)
            ? 'No se pudo insertar: una referencia (FK) no existe.'
            : err.message;
        res.status(400).json({ success: false, error: msg });
    }
});

/**
 * Validate a generic row operation: table must be a writable base table,
 * idColumn must be a safe identifier, idValue must be present. Returns either
 * { ok: true, table, idColumn, idValue } or { ok: false, status, error }.
 */
function validateRowTarget(tableName, idColumn, idValue) {
    if (!ADMIN_DATABASE_WRITABLE.has(tableName)) {
        const isView = ADMIN_DATABASE_TABLE_NAMES.has(tableName);
        return {
            ok: false,
            status: 400,
            error: isView
                ? 'Esta es una vista de solo lectura y no puede editarse.'
                : 'Tabla no permitida.'
        };
    }
    if (typeof idColumn !== 'string' || !SAFE_COLUMN_RE.test(idColumn)) {
        return { ok: false, status: 400, error: 'Columna identificadora inválida.' };
    }
    if (idValue === undefined || idValue === null || String(idValue) === '') {
        return { ok: false, status: 400, error: 'Falta el valor identificador de la fila.' };
    }
    return { ok: true };
}

/**
 * Update a single row in any writable table.
 * PATCH /api/admin/database/tables/:tableName/row
 * Body: { idColumn, idValue, patch: {col: value, ...} }
 * The match is `idColumn=eq.idValue`; the editor sends a unique key (id /
 * user_id / setting_key / first scalar column) so it targets one row.
 */
app.patch('/api/admin/database/tables/:tableName/row', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const tableName = req.params.tableName;
    const { idColumn, idValue, patch } = req.body || {};
    const check = validateRowTarget(tableName, idColumn, idValue);
    if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });

    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
        return res.status(400).json({ success: false, error: 'No hay cambios para guardar.' });
    }
    for (const col of Object.keys(patch)) {
        if (!SAFE_COLUMN_RE.test(col)) {
            return res.status(400).json({ success: false, error: `Nombre de columna inválido: ${col}` });
        }
    }

    try {
        const filter = `${idColumn}=eq.${encodeURIComponent(idValue)}`;
        const rows = await _supabaseFetch(`${tableName}?${filter}`, {
            method: 'PATCH', prefer: 'return=representation', body: patch
        });
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No se actualizó ninguna fila (¿identificador correcto?).' });
        }
        console.log(`[Admin API] Row updated by ${auth.email}: ${tableName} ${idColumn}=${idValue}`);
        res.json({ success: true, row: rows[0], affected: rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Delete a single row from any writable table.
 * DELETE /api/admin/database/tables/:tableName/row
 * Body: { idColumn, idValue }
 * Guard: refuses to delete a row whose `email` is the superadmin account, so
 * the protected login can never be removed via the generic inspector.
 */
app.delete('/api/admin/database/tables/:tableName/row', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const tableName = req.params.tableName;
    const { idColumn, idValue } = req.body || {};
    const check = validateRowTarget(tableName, idColumn, idValue);
    if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });

    try {
        const filter = `${idColumn}=eq.${encodeURIComponent(idValue)}`;

        // Superadmin protection: if the target row exposes an `email` column and
        // it matches the protected account, refuse. Best-effort — tables without
        // an email column simply skip the check.
        try {
            const existing = await _supabaseFetch(`${tableName}?${filter}&select=*&limit=1`);
            const row = Array.isArray(existing) && existing.length ? existing[0] : null;
            const email = row && typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
            if (email && appSettings.isSuperadminEmail(email)) {
                return res.status(403).json({ success: false, error: 'No se puede eliminar la cuenta superadmin.' });
            }
        } catch (_) { /* column may not exist; proceed */ }

        const rows = await _supabaseFetch(`${tableName}?${filter}`, {
            method: 'DELETE', prefer: 'return=representation'
        });
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No se eliminó ninguna fila.' });
        }
        console.log(`[Admin API] Row deleted by ${auth.email}: ${tableName} ${idColumn}=${idValue}`);
        res.json({ success: true, deleted: rows.length });
    } catch (err) {
        // 23503 = FK violation (related rows block the delete).
        const msg = /23503|foreign key/i.test(err.message)
            ? 'No se pudo eliminar: hay registros relacionados que dependen de esta fila.'
            : err.message;
        res.status(409).json({ success: false, error: msg });
    }
});

app.get('/api/admin/artists', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    try {
        const artists = await _supabaseFetch('artists_db?select=*&order=name.asc');
        res.json({ success: true, artists: Array.isArray(artists) ? artists : [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// SUPABASE ADMIN API - STUDIOS (studio accounts)
// ============================================

// Columns the studio edit form may write. id / user_id / primary_location_id /
// timestamps / computed columns are intentionally excluded so the editor can
// never corrupt ownership or relational pointers.
const STUDIO_EDITABLE_COLUMNS = new Set([
    'name', 'slug', 'email', 'tagline', 'bio', 'cover_image', 'logo_image',
    'photo_feed_items', 'founded_year', 'languages',
    'instagram', 'tiktok', 'whatsapp', 'contact_phone', 'phone', 'website',
    'google_maps_url', 'is_seeking_artists', 'is_verified', 'is_active',
    'profile_complete', 'ubicacion'
]);

app.get('/api/admin/studios', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    try {
        const studios = await _supabaseFetch('studios?select=*&order=name.asc');
        const list = Array.isArray(studios) ? studios : [];

        // Best-effort enrichment: how many sedes (locations) each studio has,
        // plus the primary location's city/country for the list view. A failure
        // here must not break the listing, so it's wrapped and degrades to 0.
        try {
            const locs = await _supabaseFetch(
                'studio_locations?select=studio_id,city,country,is_primary'
            );
            const byStudio = new Map();
            for (const loc of (Array.isArray(locs) ? locs : [])) {
                const entry = byStudio.get(loc.studio_id) || { count: 0, city: '', country: '' };
                entry.count += 1;
                if (loc.is_primary || !entry.city) {
                    entry.city = loc.city || entry.city;
                    entry.country = loc.country || entry.country;
                }
                byStudio.set(loc.studio_id, entry);
            }
            for (const studio of list) {
                const entry = byStudio.get(studio.id);
                studio.location_count = entry ? entry.count : 0;
                studio.primary_city = (entry && entry.city) || studio.city || '';
                studio.primary_country = (entry && entry.country) || studio.country || '';
            }
        } catch (locErr) {
            console.warn('[Admin API] studios location enrichment failed:', locErr.message);
        }

        res.json({ success: true, studios: list });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.patch('/api/admin/studios/:id', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const id = req.params.id;
    if (!UUID_RE.test(String(id))) {
        return res.status(400).json({ success: false, error: 'ID de estudio inválido (se espera UUID).' });
    }

    // Keep only known, editable columns from the body.
    const patch = {};
    for (const [key, value] of Object.entries(req.body || {})) {
        if (STUDIO_EDITABLE_COLUMNS.has(key)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ success: false, error: 'No hay cambios válidos para guardar.' });
    }

    try {
        const rows = await _supabaseFetch(`studios?id=eq.${encodeURIComponent(id)}`, {
            method: 'PATCH', prefer: 'return=representation', body: patch
        });
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontró el estudio.' });
        }
        console.log(`[Admin API] Studio updated by ${auth.email}: ${id}`);
        res.json({ success: true, studio: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Delete a studio account using the service-role key.
 * POST /api/admin/delete-studio  Body: { id }
 *
 * Unlike artists_db (which has trigger_delete_auth_on_artist_delete), studios
 * has NO trigger that removes the owning auth.users row on delete — the
 * studios.user_id FK is ON DELETE SET NULL the other way around. So we must:
 *   1. Look up the studio (confirm it exists; capture user_id + email).
 *   2. Refuse if it's the superadmin account.
 *   3. Delete the studios row — studio_locations / memberships / spots / etc.
 *      cascade via their ON DELETE CASCADE FKs.
 *   4. Delete the owning auth.users row (best-effort) so the login is gone too.
 */
app.post('/api/admin/delete-studio', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const { id } = req.body || {};
    if (!UUID_RE.test(String(id))) {
        return res.status(400).json({ success: false, error: 'Falta un ID de estudio válido (UUID).' });
    }

    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
    }
    const svcHeaders = getAdminHeaders(serviceRoleKey);
    const filter = `id=eq.${encodeURIComponent(id)}`;

    try {
        // Step 1: look up the studio.
        const lookupRes = await fetch(
            `${supabaseUrl}/rest/v1/studios?${filter}&select=id,user_id,email,name`,
            { method: 'GET', headers: svcHeaders }
        );
        if (!lookupRes.ok) {
            const body = await lookupRes.text();
            return res.status(502).json({ success: false, error: `Supabase lookup failed: HTTP ${lookupRes.status} ${body.slice(0, 200)}` });
        }
        const rows = await lookupRes.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontró ningún estudio con ese ID.' });
        }
        const studio = rows[0];
        const studioUserId = studio.user_id || null;
        const targetEmail = String(studio.email || '').trim().toLowerCase();
        if (targetEmail && appSettings.isSuperadminEmail(targetEmail)) {
            return res.status(403).json({ success: false, error: 'No se puede eliminar la cuenta superadmin.' });
        }

        // Step 2: delete the studio row (children cascade).
        const delRes = await fetch(
            `${supabaseUrl}/rest/v1/studios?${filter}`,
            { method: 'DELETE', headers: { ...svcHeaders, 'Prefer': 'return=representation' } }
        );
        if (!delRes.ok) {
            const body = await delRes.text();
            return res.status(409).json({
                success: false,
                error: `No se pudo eliminar (puede haber registros relacionados con ON DELETE RESTRICT). HTTP ${delRes.status}: ${body.slice(0, 300)}`
            });
        }
        const deleted = await delRes.json();
        if (!Array.isArray(deleted) || deleted.length === 0) {
            return res.status(404).json({ success: false, error: 'No se eliminó ninguna fila.' });
        }

        // Step 3: remove the owning auth user (best-effort — the studio is
        // already gone, so a failure here just leaves an orphan login).
        let authDeleted = false;
        if (studioUserId && UUID_RE.test(String(studioUserId))) {
            const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${studioUserId}`, {
                method: 'DELETE', headers: svcHeaders
            }).catch(() => null);
            authDeleted = Boolean(authRes && authRes.ok);
            if (!authDeleted) {
                console.warn(`[Admin API] delete-studio: studio ${id} removed but auth user ${studioUserId} could not be deleted.`);
            }
        }

        console.log(`[Admin API] Studio deleted by superadmin ${auth.email}: ${id} (auth user removed: ${authDeleted})`);
        return res.json({ success: true, message: 'Estudio eliminado correctamente', authUserDeleted: authDeleted });
    } catch (error) {
        console.error('[Admin API] delete-studio error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/support-users', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    try {
        const users = await _supabaseFetch('support_users_db?select=*&order=created_at.desc');
        res.json({ success: true, users: Array.isArray(users) ? users : [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/support-users/:userId', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    try {
        const rows = await _supabaseFetch(
            `support_users_db?user_id=eq.${encodeURIComponent(req.params.userId)}&select=*&limit=1`
        );
        const user = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!user) return res.status(404).json({ success: false, error: 'Support user not found' });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/support-users', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const email = String(req.body.email || '').trim().toLowerCase();
    const fullName = String(req.body.fullName || '').trim();
    const password = String(req.body.password || '');
    const role = SUPPORT_ROLES.has(req.body.role) ? req.body.role : 'support';

    if (!email || !fullName || password.length < 6) {
        return res.status(400).json({ success: false, error: 'Email, name and a 6+ character password are required' });
    }

    try {
        const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
        if (!supabaseUrl || !serviceRoleKey) {
            return res.status(500).json({ success: false, error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
        }

        const existingUsers = await listAuthUsersByEmail(email);
        let authUser = existingUsers[0] || null;

        if (!authUser) {
            const authResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
                method: 'POST',
                headers: getAdminHeaders(serviceRoleKey),
                body: JSON.stringify({
                    email,
                    password,
                    email_confirm: true,
                    user_metadata: { full_name: fullName, role: 'support_user' },
                    app_metadata: { role: 'support_user' }
                })
            });

            const authBody = await authResponse.text();
            if (!authResponse.ok) {
                return res.status(502).json({ success: false, error: `Auth user create failed: ${authBody.slice(0, 200)}` });
            }
            authUser = authBody ? JSON.parse(authBody) : null;
        }

        if (!authUser?.id) {
            return res.status(502).json({ success: false, error: 'Could not resolve Auth user id' });
        }

        const rows = await _supabaseFetch('support_users_db?on_conflict=user_id', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: {
                user_id: authUser.id,
                email,
                full_name: fullName,
                role,
                is_active: req.body.isActive !== false,
                updated_at: new Date().toISOString()
            }
        });

        res.json({ success: true, user: Array.isArray(rows) ? rows[0] : null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.patch('/api/admin/support-users/:userId', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const patch = { updated_at: new Date().toISOString() };
    if (req.body.fullName !== undefined) patch.full_name = String(req.body.fullName || '').trim();
    if (req.body.role !== undefined) patch.role = SUPPORT_ROLES.has(req.body.role) ? req.body.role : 'support';
    if (req.body.isActive !== undefined) patch.is_active = Boolean(req.body.isActive);

    try {
        const rows = await _supabaseFetch(
            `support_users_db?user_id=eq.${encodeURIComponent(req.params.userId)}`,
            { method: 'PATCH', prefer: 'return=representation', body: patch }
        );
        res.json({ success: true, user: Array.isArray(rows) ? rows[0] : null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
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

/**
 * Client accepts the artist-side completion request.
 * This is the verified close-out gate that enables reviews.
 * POST /api/client/quotations/:quoteId/complete
 * Headers: Authorization: Bearer <supabase_access_token>
 */
app.post('/api/client/quotations/:quoteId/complete', async (req, res) => {
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
                console.warn('[Client Complete] Auth check failed:', authErr.message);
            }
        }

        if (!callerUserId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const quoteResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db?quote_id=eq.${encodeURIComponent(quoteId)}&select=id,quote_id,quote_status,client_user_id,client_email,dispute_status,client_completed_at`,
            { headers }
        );
        const quoteData = await quoteResponse.json();

        if (!quoteData || quoteData.length === 0) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }

        const quotation = quoteData[0];
        let isOwner = quotation.client_user_id === callerUserId;

        if (!isOwner && callerEmail && quotation.client_email &&
            quotation.client_email.toLowerCase() === callerEmail.toLowerCase()) {
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

        if ((quotation.dispute_status || 'none') === 'open') {
            return res.status(409).json({ success: false, error: 'This quotation has an open dispute' });
        }

        if (quotation.quote_status === 'completed') {
            return res.json({
                success: true,
                quoteId,
                record_id: quotation.id,
                client_completed_at: quotation.client_completed_at || null,
                message: 'Already completed'
            });
        }

        if (quotation.quote_status !== 'artist_completed') {
            return res.status(409).json({
                success: false,
                error: `Quotation must be artist_completed before client completion. Current status: ${quotation.quote_status || 'unknown'}`
            });
        }

        const completedAt = new Date().toISOString();
        const patchResponse = await fetch(
            `${supabaseUrl}/rest/v1/quotations_db?id=eq.${quotation.id}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    quote_status: 'completed',
                    client_completed_at: completedAt,
                    completed_by_client_user_id: callerUserId
                })
            }
        );

        if (!patchResponse.ok) {
            const errBody = await patchResponse.text();
            throw new Error(`Failed to complete quotation: ${errBody}`);
        }

        console.log(`[Client Complete] Client ${callerUserId} completed quotation ${quoteId}`);
        return res.json({
            success: true,
            quoteId,
            record_id: quotation.id,
            client_completed_at: completedAt
        });
    } catch (error) {
        console.error('[Client Complete] Error:', error.message);
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

/**
 * POST /api/artists/geocode
 * Persist geocoding results computed by the client (Explore Map page).
 *
 * Body: {
 *   user_id: string (UUID, required),
 *   latitude: number (required),
 *   longitude: number (required),
 *   geocoded_address: string (optional, formatted address from Google)
 * }
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS (the public anon role cannot
 * UPDATE arbitrary artists_db rows). Validates that coordinates are finite
 * numbers within Earth bounds before writing.
 *
 * Idempotent: subsequent calls with the same (user_id, lat, lng) just refresh
 * geocoded_at.
 */
app.post('/api/artists/geocode', async (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(503).json({
            success: false,
            error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
        });
    }

    const { user_id, latitude, longitude, geocoded_address } = req.body || {};

    if (!user_id || typeof user_id !== 'string') {
        return res.status(400).json({ success: false, error: 'user_id is required' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ success: false, error: 'latitude must be a finite number in [-90, 90]' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, error: 'longitude must be a finite number in [-180, 180]' });
    }

    try {
        const updateRes = await fetch(
            `${supabaseUrl}/rest/v1/artists_db?user_id=eq.${encodeURIComponent(user_id)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': serviceRoleKey,
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    latitude: lat,
                    longitude: lng,
                    geocoded_address: geocoded_address ? String(geocoded_address).slice(0, 500) : null,
                    geocoded_at: new Date().toISOString()
                })
            }
        );

        if (!updateRes.ok) {
            const errBody = await updateRes.text();
            console.error('[Geocode] Supabase PATCH failed:', updateRes.status, errBody);
            return res.status(502).json({
                success: false,
                error: `Supabase update failed: HTTP ${updateRes.status}`
            });
        }

        const rows = await updateRes.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Artist not found for given user_id' });
        }

        return res.json({
            success: true,
            artist: {
                user_id: rows[0].user_id,
                latitude: rows[0].latitude,
                longitude: rows[0].longitude,
                geocoded_at: rows[0].geocoded_at
            }
        });
    } catch (err) {
        console.error('[Geocode] Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

function normalizeProfileVisitArtistUsername(value) {
    const raw = String(value || '').trim().replace(/^@+/, '').toLowerCase();
    if (!raw) return '';
    const withSuffix = raw.endsWith('.wo') ? raw : `${raw}.wo`;
    return withSuffix.replace(/[^a-z0-9._-]/g, '');
}

function getProfileVisitClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded
        || String(req.headers['cf-connecting-ip'] || '').trim()
        || req.ip
        || req.socket?.remoteAddress
        || '';
}

function hashProfileVisitIp(ip, serviceRoleKey) {
    if (!ip) return null;
    const salt = process.env.PROFILE_VISIT_HASH_SALT
        || process.env.CRON_API_TOKEN
        || String(serviceRoleKey || '').slice(0, 32);
    return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

function parseProfileVisitUserAgent(userAgent) {
    const ua = String(userAgent || '');
    const lower = ua.toLowerCase();

    let deviceType = 'desktop';
    if (/bot|crawl|spider|slurp/.test(lower)) deviceType = 'bot';
    else if (/ipad|tablet/.test(lower)) deviceType = 'tablet';
    else if (/mobi|android|iphone|ipod/.test(lower)) deviceType = 'mobile';

    let os = 'unknown';
    if (/windows nt/i.test(ua)) os = 'Windows';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/(iphone|ipad|ipod)/i.test(ua)) os = 'iOS';
    else if (/mac os x/i.test(ua)) os = 'macOS';
    else if (/linux/i.test(ua)) os = 'Linux';

    let browser = 'unknown';
    if (/edg\//i.test(ua)) browser = 'Edge';
    else if (/opr\//i.test(ua)) browser = 'Opera';
    else if (/firefox\//i.test(ua)) browser = 'Firefox';
    else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) browser = 'Chrome';
    else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';

    return { deviceType, os, browser };
}

function cleanProfileVisitText(value, maxLength) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function cleanProfileVisitCoordinate(value, min, max) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

async function lookupProfileVisitArtist({ artistId, username }) {
    if (artistId) {
        const rows = await _supabaseFetch(
            `artists_db?user_id=eq.${encodeURIComponent(artistId)}&select=user_id,username&limit=1`
        );
        return Array.isArray(rows) ? rows[0] : null;
    }

    const normalizedUsername = normalizeProfileVisitArtistUsername(username);
    if (!normalizedUsername) return null;
    const rows = await _supabaseFetch(
        `artists_db?username=ilike.${encodeURIComponent(normalizedUsername)}&select=user_id,username&limit=1`
    );
    return Array.isArray(rows) ? rows[0] : null;
}

async function insertProfileVisit(visit) {
    try {
        return await _supabaseFetch('artist_profile_visits', {
            method: 'POST',
            body: visit,
            prefer: 'return=representation'
        });
    } catch (error) {
        if (!/Could not find|column/i.test(error.message)) throw error;
        const compatibleVisit = {
            artist_id: visit.artist_id,
            artist_username: visit.artist_username,
            country: visit.country,
            city: visit.city,
            latitude: visit.latitude,
            longitude: visit.longitude,
            device_type: visit.device_type,
            os: visit.os,
            browser: visit.browser,
            ip_hash: visit.ip_hash,
            device_fingerprint: visit.device_fingerprint
        };
        return _supabaseFetch('artist_profile_visits', {
            method: 'POST',
            body: compatibleVisit,
            prefer: 'return=representation'
        });
    }
}

app.post('/api/artist/profile-visit', async (req, res) => {
    const { supabaseUrl, serviceKey } = _supabaseConfigForSupport();
    if (!supabaseUrl || !serviceKey) {
        return res.status(503).json({ success: false, error: 'Supabase service role not configured' });
    }

    const {
        artist_id,
        artist_username,
        device_fingerprint,
        is_authenticated,
        referrer,
        latitude,
        longitude
    } = req.body || {};

    if (!artist_id && !artist_username) {
        return res.status(400).json({ success: false, error: 'artist_username or artist_id is required' });
    }

    try {
        const artist = await lookupProfileVisitArtist({
            artistId: cleanProfileVisitText(artist_id, 80),
            username: artist_username
        });

        if (!artist?.user_id) {
            return res.status(404).json({ success: false, error: 'Artist not found' });
        }

        const ip = getProfileVisitClientIp(req);
        const ipHash = hashProfileVisitIp(ip, serviceKey);

        if (ipHash) {
            const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const duplicateRows = await _supabaseFetch(
                `artist_profile_visits?artist_id=eq.${encodeURIComponent(artist.user_id)}&ip_hash=eq.${encodeURIComponent(ipHash)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`
            );
            if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
                return res.json({ success: true, recorded: false, reason: 'deduplicated' });
            }
        }

        const userAgent = cleanProfileVisitText(req.body?.user_agent || req.headers['user-agent'], 500);
        const parsedUa = parseProfileVisitUserAgent(userAgent);
        const countryHeader = cleanProfileVisitText(req.headers['cf-ipcountry'], 80);

        const rows = await insertProfileVisit({
            artist_id: artist.user_id,
            artist_username: cleanProfileVisitText(
                artist.username || artist_username || artist_id,
                120
            ),
            country: countryHeader && countryHeader !== 'XX' ? countryHeader : null,
            city: null,
            latitude: cleanProfileVisitCoordinate(latitude, -90, 90),
            longitude: cleanProfileVisitCoordinate(longitude, -180, 180),
            device_type: parsedUa.deviceType,
            os: parsedUa.os,
            browser: parsedUa.browser,
            ip_hash: ipHash,
            device_fingerprint: cleanProfileVisitText(device_fingerprint, 200),
            referrer: cleanProfileVisitText(referrer, 500),
            is_authenticated: Boolean(is_authenticated),
            user_agent: userAgent
        });

        const created = Array.isArray(rows) ? rows[0] : null;
        return res.status(201).json({
            success: true,
            recorded: true,
            visit_id: created?.id || null
        });
    } catch (err) {
        console.error('[ProfileVisit] Error:', err.message);
        return res.status(502).json({ success: false, error: 'Could not record profile visit' });
    }
});

/**
 * POST /api/studio/notify
 *
 * Sends an email notification when a studio acts on an artist's application
 * or invites them to the roster.
 *
 * Body: { kind: 'spot_decision'|'roster_invite', application_id?, membership_id?, decision? }
 *
 * Caller must be authenticated. The endpoint:
 *   1. Validates the caller owns the studio originating the notification.
 *   2. Builds the email payload server-side (subject + body) with verified
 *      data (artist email, studio name, role).
 *   3. Posts to N8N_WEBHOOK_URL if configured. Falls back to console.log so
 *      dev environments without n8n don't break the dashboard flow.
 *   4. Returns success regardless of whether n8n was reached (the dashboard
 *      shouldn't roll back the underlying DB operation just because email
 *      delivery is degraded).
 */
app.post('/api/studio/notify', async (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server misconfigured: missing SUPABASE creds.' });
    }

    const { kind, application_id, membership_id, decision } = req.body || {};
    if (!kind || !['spot_decision', 'roster_invite'].includes(kind)) {
        return res.status(400).json({ success: false, error: 'kind invalido (esperado: spot_decision | roster_invite)' });
    }
    if (kind === 'spot_decision' && !['accepted', 'rejected'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'decision invalida (esperado: accepted | rejected)' });
    }

    const restHeaders = {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`
    };

    try {
        const authUser = await _getAuthUserFromBearer(req);
        if (!authUser?.id) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        let payload = null;

        if (kind === 'spot_decision') {
            if (!application_id) {
                return res.status(400).json({ success: false, error: 'application_id y decision son requeridos.' });
            }
            // Pull the application + spot + studio + artist in one go.
            const r = await fetch(
                `${supabaseUrl}/rest/v1/studio_spot_applications`
                + `?id=eq.${encodeURIComponent(application_id)}`
                + `&select=id,status,artist_user_id,artists_db(user_id,email,name,username),`
                + `studio_spots(id,title,kind,studios(id,name,slug,user_id,email))`,
                { headers: restHeaders }
            );
            if (!r.ok) throw new Error(`Could not load application: ${r.status}`);
            const rows = await r.json();
            const app = Array.isArray(rows) ? rows[0] : null;
            if (!app) return res.status(404).json({ success: false, error: 'Application not found.' });

            const studio = app.studio_spots?.studios || {};
            const artist = app.artists_db || {};
            const spot   = app.studio_spots || {};
            const access = await _verifyStudioNotifyAccess(req, studio, authUser);
            if (!access.ok) {
                return res.status(access.status).json({ success: false, error: access.error });
            }

            payload = {
                kind: 'studio_spot_decision',
                decision,                                            // 'accepted' | 'rejected'
                to:   artist.email,
                to_name: artist.name || artist.username || '',
                from_name: studio.name || 'Estudio',
                subject: decision === 'accepted'
                    ? `¡Te aceptaron en ${studio.name}!`
                    : `Actualización de tu postulación a ${studio.name}`,
                body_text: decision === 'accepted'
                    ? `Hola${artist.name ? ' ' + artist.name : ''},\n\n${studio.name} aceptó tu postulación al spot "${spot.title}". Ya formás parte del roster como ${roleFromKind(spot.kind)}.\n\nVas a ver el estudio bajo tus memberships activas en /artist/invitations. Mucha suerte y buena tinta.`
                    : `Hola${artist.name ? ' ' + artist.name : ''},\n\nGracias por postularte al spot "${spot.title}" en ${studio.name}. En esta oportunidad eligieron a otro artista, pero seguí atento al directorio para nuevas oportunidades: https://weotzi.com/studio-spots`,
                links: {
                    studio_profile:   `https://weotzi.com/studio/profile/?studio=${encodeURIComponent(studio.slug || studio.id)}`,
                    invitations:      'https://weotzi.com/artist/invitations',
                    spots_directory:  'https://weotzi.com/studio-spots'
                },
                meta: {
                    application_id: app.id,
                    artist_user_id: artist.user_id,
                    studio_id: studio.id,
                    spot_id:   spot.id,
                    spot_kind: spot.kind
                }
            };
        }

        if (kind === 'roster_invite') {
            if (!membership_id) {
                return res.status(400).json({ success: false, error: 'membership_id requerido.' });
            }
            const r = await fetch(
                `${supabaseUrl}/rest/v1/studio_artist_memberships`
                + `?id=eq.${encodeURIComponent(membership_id)}`
                + `&select=id,role,status,artist_user_id,artists_db(user_id,email,name,username),`
                + `studios(id,name,slug,user_id,email)`,
                { headers: restHeaders }
            );
            if (!r.ok) throw new Error(`Could not load membership: ${r.status}`);
            const rows = await r.json();
            const m = Array.isArray(rows) ? rows[0] : null;
            if (!m) return res.status(404).json({ success: false, error: 'Membership not found.' });

            const studio = m.studios || {};
            const artist = m.artists_db || {};
            const access = await _verifyStudioNotifyAccess(req, studio, authUser);
            if (!access.ok) {
                return res.status(access.status).json({ success: false, error: access.error });
            }

            payload = {
                kind: 'studio_roster_invite',
                to: artist.email,
                to_name: artist.name || artist.username || '',
                from_name: studio.name || 'Estudio',
                subject: `${studio.name} te invitó a su roster`,
                body_text:
                    `Hola${artist.name ? ' ' + artist.name : ''},\n\n`
                    + `${studio.name} te invitó como ${roleFromKind(m.role)} a su roster en We Ötzi.\n\n`
                    + `Para aceptar o rechazar la invitación, ingresá a https://weotzi.com/artist/invitations.`,
                links: {
                    invitations: 'https://weotzi.com/artist/invitations',
                    studio_profile: `https://weotzi.com/studio/profile/?studio=${encodeURIComponent(studio.slug || studio.id)}`
                },
                meta: {
                    membership_id: m.id,
                    artist_user_id: artist.user_id,
                    studio_id: studio.id,
                    role: m.role
                }
            };
        }

        // Forward to n8n if configured; otherwise just log (dev fallback).
        const webhook = process.env.N8N_WEBHOOK_URL;
        if (webhook && payload?.to) {
            try {
                const wr = await fetch(webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!wr.ok) {
                    const txt = await wr.text();
                    console.warn('[StudioNotify] n8n returned non-OK', wr.status, txt.slice(0, 200));
                } else {
                    console.log(`[StudioNotify] n8n OK kind=${kind} to=${payload.to}`);
                }
            } catch (err) {
                console.warn('[StudioNotify] n8n webhook error', err.message);
            }
        } else {
            // Fallback: log it. The dashboard treats this as success.
            console.log('[StudioNotify] (no webhook configured) would send:', payload?.kind, payload?.meta || {});
        }

        return res.json({ success: true, sent: !!(webhook && payload?.to), payload_kind: payload?.kind });
    } catch (err) {
        console.error('[StudioNotify] error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

async function _verifyStudioNotifyAccess(req, studio, authUser) {
    const ownerUserId = studio?.user_id ? String(studio.user_id) : '';
    if (ownerUserId && authUser?.id && ownerUserId === String(authUser.id)) {
        return { ok: true, role: 'studio-owner' };
    }

    const supportAgent = await _getActiveSupportAgent(req);
    if (supportAgent.ok) {
        return { ok: true, role: 'support-agent' };
    }

    if (supportAgent.status && supportAgent.status >= 500) {
        return {
            ok: false,
            status: supportAgent.status,
            error: supportAgent.error || 'Could not verify studio access'
        };
    }

    return { ok: false, status: 403, error: 'Studio ownership required' };
}

function roleFromKind(kindOrRole) {
    const map = {
        resident: 'residente', itinerant: 'itinerante', guest: 'guest',
        guest_spot: 'guest', manager: 'manager'
    };
    return map[kindOrRole] || (kindOrRole || 'miembro');
}

/**
 * POST /api/pre-quote/estimate
 * Calculate a tattoo estimate and matching artists from artists_db.
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
        return res.json({ success: true, ...estimatePreQuote(input, Array.isArray(artists) ? artists : []) });
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
 * Requires either a superadmin bearer session or a valid `X-Cron-Token`.
 */
app.post('/api/admin/currencies/refresh-now', async (req, res) => {
    const expectedToken = process.env.CRON_API_TOKEN;
    const provided = req.headers['x-cron-token'] || '';
    const tokenOk = Boolean(expectedToken && provided && provided === expectedToken);
    if (!tokenOk) {
        const auth = await appSettings.verifyAdminCaller(req);
        if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
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
// ADMIN INTEGRATIONS — Apify (Instagram import)
// ============================================
// Stored in app_settings.key='apify_token'. Frontend never receives the
// raw token after save — only metadata (configured flag + last 6 chars).

const appSettings = require('./lib/app-settings');
const igImport = require('./lib/instagram-import');

const APIFY_TOKEN_KEY = 'apify_token';
const APIFY_TEST_HANDLE_DEFAULT = 'instagram';
const APIFY_ACTOR = process.env.APIFY_INSTAGRAM_ACTOR || 'apify/instagram-profile-scraper';

function maskedTokenResponse(meta) {
    return {
        success: true,
        configured: meta.configured === true,
        last_chars: meta.last_chars || null,
        updated_at: meta.updated_at || null
    };
}

app.get('/api/admin/integrations/apify', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    try {
        const meta = await appSettings.getSettingMeta(APIFY_TOKEN_KEY);
        return res.json(maskedTokenResponse(meta));
    } catch (err) {
        console.error('[Admin][Apify] meta read failed:', err.message);
        return res.status(500).json({ success: false, error: 'Failed to read setting' });
    }
});

app.post('/api/admin/integrations/apify', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const token = String(req.body && req.body.token || '').trim();
    if (!token || token.length < 20 || !/^[A-Za-z0-9_]+$/.test(token)) {
        return res.status(400).json({ success: false, error: 'Token format looks invalid' });
    }

    try {
        await appSettings.setSetting(APIFY_TOKEN_KEY, token, auth.userId);
        const meta = await appSettings.getSettingMeta(APIFY_TOKEN_KEY);
        return res.json(maskedTokenResponse(meta));
    } catch (err) {
        console.error('[Admin][Apify] save failed:', err.message);
        return res.status(500).json({ success: false, error: 'Failed to save token' });
    }
});

app.post('/api/admin/integrations/apify/test', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    // Prefer a token sent in the body (live test before save). Fall back to
    // the persisted token so admins can re-test a previously saved key.
    let token = String(req.body && req.body.token || '').trim();
    if (!token) {
        token = await appSettings.getSetting(APIFY_TOKEN_KEY, { useCache: false }) || '';
    }
    if (!token) {
        return res.status(400).json({ success: false, error: 'No token to test (save one first or pass it in body)' });
    }

    const handle = String(req.body && req.body.handle || APIFY_TEST_HANDLE_DEFAULT)
        .trim()
        .replace(/^@/, '');
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(handle)) {
        return res.status(400).json({ success: false, error: 'Invalid Instagram handle' });
    }

    const actorPath = APIFY_ACTOR.replace('/', '~');
    const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const t0 = Date.now();

    try {
        const apifyRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [handle], resultsLimit: 6 })
        });
        const elapsedMs = Date.now() - t0;

        if (apifyRes.status === 401 || apifyRes.status === 403) {
            return res.status(200).json({
                success: false,
                ok: false,
                reason: 'invalid_token',
                message: 'Apify rejected the token',
                elapsedMs
            });
        }
        if (!apifyRes.ok) {
            const text = await apifyRes.text().catch(() => '');
            return res.status(200).json({
                success: false,
                ok: false,
                reason: 'apify_error',
                http_status: apifyRes.status,
                message: text.slice(0, 300),
                elapsedMs
            });
        }

        const items = await apifyRes.json();
        const profile = Array.isArray(items) && items.length ? items[0] : null;
        if (!profile) {
            return res.json({
                success: true,
                ok: false,
                reason: 'empty_dataset',
                handle,
                elapsedMs
            });
        }
        if (profile.private === true || profile.isPrivate === true) {
            return res.json({
                success: true,
                ok: false,
                reason: 'private_profile',
                handle,
                elapsedMs
            });
        }

        const posts = profile.latestPosts || profile.posts || [];
        return res.json({
            success: true,
            ok: true,
            handle,
            elapsedMs,
            sample: {
                username: profile.username || handle,
                fullName: profile.fullName || profile.name || null,
                hasBio: Boolean(profile.biography || profile.bio),
                hasExternalUrl: Boolean(profile.externalUrl || profile.website),
                postsReturned: posts.length,
                followersCount: profile.followersCount || profile.followers || null
            }
        });
    } catch (err) {
        console.error('[Admin][Apify] test failed:', err.message);
        return res.status(502).json({ success: false, error: 'Could not reach Apify', detail: err.message });
    }
});

// Aggregated statistics for the Instagram import feature. Used by the
// backoffice card to show daily volume + cumulative cost without leaving
// the panel. Three queries run in parallel — totals, daily breakdown,
// recent activity. RLS is bypassed (service role) so we get global view.
app.get('/api/admin/integrations/apify/stats', async (req, res) => {
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }
    const headers = {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'
    };

    // RPC-equivalent via PostgREST aggregate selectors. PostgREST doesn't
    // support FILTER WHERE inline, so we issue 4 lightweight calls instead
    // of one stored procedure. All cheap because the table has an index on
    // (user_id, created_at DESC) and counts use HEAD method.
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString();

    function countQuery(filter) {
        return fetch(`${supabaseUrl}/rest/v1/instagram_imports?${filter}&select=id`, {
            method: 'HEAD',
            headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }
        }).then(r => {
            const range = r.headers.get('content-range') || '*/0';
            const total = parseInt(range.split('/')[1], 10);
            return Number.isFinite(total) ? total : 0;
        }).catch(() => 0);
    }

    function sumCost() {
        // PostgREST aggregate selectors are quirky across versions; sum
        // client-side instead — table is small (one row per import) so this
        // is fine.
        return fetch(`${supabaseUrl}/rest/v1/instagram_imports?select=cost_estimate_usd`, {
            headers
        }).then(r => r.json()).then(rows => {
            if (!Array.isArray(rows)) return 0;
            return rows.reduce((s, r) => s + (Number(r.cost_estimate_usd) || 0), 0);
        }).catch(() => 0);
    }

    function recentRows() {
        return fetch(
            `${supabaseUrl}/rest/v1/instagram_imports?select=id,ig_handle,target,imported_fields,cost_estimate_usd,created_at&order=created_at.desc&limit=10`,
            { headers }
        ).then(r => r.json()).catch(() => []);
    }

    function recentForDailyBreakdown() {
        return fetch(
            `${supabaseUrl}/rest/v1/instagram_imports?select=created_at,cost_estimate_usd&created_at=gte.${fourteenDaysAgo}&order=created_at.asc`,
            { headers }
        ).then(r => r.json()).catch(() => []);
    }

    try {
        const [imports7d, imports30d, importsTotal, costTotal, recent, dailyRaw] = await Promise.all([
            countQuery(`created_at=gte.${sevenDaysAgo}`),
            countQuery(`created_at=gte.${thirtyDaysAgo}`),
            countQuery('id=not.is.null'),
            sumCost(),
            recentRows(),
            recentForDailyBreakdown()
        ]);

        // Build a 14-day strip — fill empty days with zeros so the chart is
        // continuous even when no imports happened that day.
        const dayBuckets = new Map();
        for (let i = 13; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400 * 1000);
            const key = d.toISOString().slice(0, 10);
            dayBuckets.set(key, { count: 0, cost: 0 });
        }
        for (const row of (Array.isArray(dailyRaw) ? dailyRaw : [])) {
            const key = String(row.created_at || '').slice(0, 10);
            const bucket = dayBuckets.get(key);
            if (bucket) {
                bucket.count += 1;
                bucket.cost += Number(row.cost_estimate_usd) || 0;
            }
        }
        const daily = [...dayBuckets.entries()].map(([day, v]) => ({
            day, count: v.count, cost_usd: Number(v.cost.toFixed(4))
        }));

        return res.json({
            success: true,
            totals: {
                imports_7d: imports7d,
                imports_30d: imports30d,
                imports_total: importsTotal,
                cost_total_usd: Number((Number(costTotal) || 0).toFixed(4))
            },
            daily,
            recent: Array.isArray(recent) ? recent : []
        });
    } catch (err) {
        console.error('[Admin][Apify stats] failed:', err.message);
        return res.status(500).json({ success: false, error: 'Failed to compute stats' });
    }
});

// ============================================
// Artist registration draft/finalization
// ============================================
// Public registration is intentionally pre-auth. The browser can create and
// update an artists_db draft through these endpoints, but Auth users are only
// created on the final confirmation step and no browser session is established.

function getSupabaseAdminConfig() {
    return {
        supabaseUrl: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    };
}

function getAdminHeaders(serviceRoleKey) {
    return {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`
    };
}

async function listAuthUsersByEmail(email) {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    if (!supabaseUrl || !serviceRoleKey || !email) return [];

    const response = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        { headers: getAdminHeaders(serviceRoleKey) }
    ).catch(() => null);

    if (!response || !response.ok) return [];
    const body = await response.json().catch(() => ({}));
    return Array.isArray(body.users) ? body.users : [];
}

async function listArtistRowsByFilter(filter, select = 'id,user_id,registration_draft_id,registration_status') {
    const rows = await _supabaseFetch(`artists_db?${filter}&select=${select}&limit=10`);
    return Array.isArray(rows) ? rows : [];
}

function isDifferentDraft(row, draftId) {
    return !draftId || String(row.registration_draft_id || '') !== draftId;
}

async function getRegistrationConflicts({ email, username, instagram, draftId, allowUserId }) {
    const conflicts = new Set();

    if (email) {
        const authUsers = await listAuthUsersByEmail(email);
        if (authUsers.some(user => !allowUserId || user.id !== allowUserId)) {
            conflicts.add('email');
        }

        const emailRows = await listArtistRowsByFilter(
            `email=ilike.${encodeURIComponent(email)}`
        );
        if (emailRows.some(row => isDifferentDraft(row, draftId))) {
            conflicts.add('email');
        }
    }

    if (username) {
        const usernameRows = await listArtistRowsByFilter(
            `username=ilike.${encodeURIComponent(username)}`
        );
        if (usernameRows.some(row => isDifferentDraft(row, draftId))) {
            conflicts.add('username');
        }
    }

    if (instagram) {
        const cleanInstagram = String(instagram || '').replace(/^@/, '');
        const instagramRows = await listArtistRowsByFilter(
            `instagram=ilike.${encodeURIComponent(cleanInstagram)}`
        );
        const instagramAtRows = instagramRows.length
            ? []
            : await listArtistRowsByFilter(`instagram=ilike.${encodeURIComponent('@' + cleanInstagram)}`);
        if ([...instagramRows, ...instagramAtRows].some(row => isDifferentDraft(row, draftId))) {
            conflicts.add('instagram');
        }
    }

    return Array.from(conflicts);
}

async function findArtistDraft({ draftId, email }) {
    if (draftId) {
        const rows = await _supabaseFetch(
            `artists_db?registration_draft_id=eq.${encodeURIComponent(draftId)}&select=*&limit=1`
        );
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
    }

    if (email) {
        const rows = await _supabaseFetch(
            `artists_db?email=ilike.${encodeURIComponent(email)}&registration_status=eq.${encodeURIComponent(artistRegistration.REGISTRATION_STATUS_INCOMPLETE)}&select=*&order=registration_last_saved_at.desc&limit=1`
        );
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
    }

    return null;
}

function isFinalizedArtist(row) {
    if (!row) return false;
    return Boolean(row.user_id) || row.registration_status === artistRegistration.REGISTRATION_STATUS_PENDING_VALIDATION;
}

function buildStudioAddressPatch(address) {
    return artistRegistration.buildStudioAddressPayload(address);
}

const STUDIO_LOCATION_SELECT = [
    'id',
    'studio_id',
    'label',
    'is_primary',
    'is_active',
    'sort_order',
    'country',
    'country_code',
    'state_province',
    'city',
    'locality',
    'street',
    'street_number',
    'unit',
    'postal_code',
    'formatted_address',
    'latitude',
    'longitude',
    'google_place_id',
    'geocoded_at'
].join(',');

function studioNameForStorage(studioName) {
    return String(studioName || '').trim().toUpperCase();
}

async function getStudioRecord(studioId) {
    if (!studioId) return null;
    const rows = await _supabaseFetch(
        `studios?id=eq.${encodeURIComponent(studioId)}&select=id,primary_location_id&limit=1`
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getStudioLocationById(studioId, locationId) {
    if (!studioId || !locationId) return null;
    const rows = await _supabaseFetch(
        `studio_locations?id=eq.${encodeURIComponent(locationId)}&studio_id=eq.${encodeURIComponent(studioId)}&select=${STUDIO_LOCATION_SELECT}&limit=1`
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function findMatchingStudioLocation(studioId, addressPatch) {
    if (!studioId || !addressPatch) return null;

    const filters = [];
    if (addressPatch.google_place_id) {
        filters.push(`google_place_id=eq.${encodeURIComponent(addressPatch.google_place_id)}`);
    }
    if (addressPatch.formatted_address) {
        filters.push(`formatted_address=eq.${encodeURIComponent(addressPatch.formatted_address)}`);
    }

    for (const filter of filters) {
        const rows = await _supabaseFetch(
            `studio_locations?studio_id=eq.${encodeURIComponent(studioId)}&${filter}&select=${STUDIO_LOCATION_SELECT}&limit=1`
        );
        if (Array.isArray(rows) && rows[0]) return rows[0];
    }

    return null;
}

async function setStudioPrimaryLocation(studioId, locationId, addressPatch) {
    if (!studioId || !locationId) return;
    await _supabaseFetch(`studios?id=eq.${encodeURIComponent(studioId)}`, {
        method: 'PATCH',
        body: {
            primary_location_id: locationId,
            ...(addressPatch || {})
        }
    });
}

async function createStudioLocation({ studioId, address, isPrimary, label }) {
    const row = artistRegistration.buildStudioLocationPayload({
        studioId,
        address,
        isPrimary,
        label,
        sortOrder: isPrimary ? 0 : 10
    });
    if (!row) return null;

    try {
        const created = await _supabaseFetch('studio_locations', {
            method: 'POST',
            prefer: 'return=representation',
            body: row
        });
        return Array.isArray(created) && created[0] ? created[0] : null;
    } catch (error) {
        if (row.is_primary && /idx_studio_locations_one_primary|duplicate|23505/i.test(error.message)) {
            const fallback = { ...row, is_primary: false, sort_order: 10 };
            const created = await _supabaseFetch('studio_locations', {
                method: 'POST',
                prefer: 'return=representation',
                body: fallback
            });
            return Array.isArray(created) && created[0] ? created[0] : null;
        }
        throw error;
    }
}

async function ensureStudioLocationForRegistration(formData, studioId) {
    if (!studioId || !artistRegistration.isStudioWorkType(formData?.work_type)) {
        return { locationId: null };
    }

    const selectedLocation = await getStudioLocationById(studioId, formData?.studio_location_id);
    if (selectedLocation) {
        const studio = await getStudioRecord(studioId);
        if (!studio?.primary_location_id) {
            await setStudioPrimaryLocation(studioId, selectedLocation.id, buildStudioAddressPatch(selectedLocation));
        }
        return { locationId: selectedLocation.id };
    }

    const addressPatch = buildStudioAddressPatch(formData?.address);
    if (!addressPatch) return { locationId: null };

    const matchingLocation = await findMatchingStudioLocation(studioId, addressPatch);
    const studio = await getStudioRecord(studioId);
    if (matchingLocation) {
        if (!studio?.primary_location_id && matchingLocation.id) {
            await setStudioPrimaryLocation(studioId, matchingLocation.id, addressPatch);
        }
        return { locationId: matchingLocation.id };
    }

    const shouldBePrimary = !studio?.primary_location_id;
    const createdLocation = await createStudioLocation({
        studioId,
        address: formData.address,
        isPrimary: shouldBePrimary,
        label: formData.studio_location_label || (shouldBePrimary ? 'Sede principal' : 'Sede')
    });

    if (createdLocation?.id && shouldBePrimary) {
        await setStudioPrimaryLocation(studioId, createdLocation.id, addressPatch);
    }

    return { locationId: createdLocation?.id || null };
}

async function persistRegistrationStudioAssociations({ formData, artistUserId, studioId, studioName }) {
    if (!artistUserId || !studioId || !artistRegistration.isStudioWorkType(formData?.work_type)) {
        return { locationId: null };
    }

    const { locationId } = await ensureStudioLocationForRegistration(formData, studioId);
    const address = formData?.address && typeof formData.address === 'object' ? formData.address : {};
    const normalizedStudioName = studioNameForStorage(studioName || formData?.studio_name);

    await _supabaseFetch('artist_tattoo_locations?on_conflict=artist_user_id,period_type,sort_order', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {
            artist_user_id: artistUserId,
            period_type: 'current',
            sort_order: 0,
            studio_id: studioId,
            studio_name: normalizedStudioName,
            city: address.city || address.locality || formData?.location_city || formData?.city || null,
            agenda_status: 'open'
        }
    });

    const membership = artistRegistration.buildStudioMembershipPayload({
        artistUserId,
        studioId,
        locationId,
        workType: formData.work_type
    });
    if (membership) {
        await _supabaseFetch('studio_artist_memberships?on_conflict=studio_id,artist_user_id,role,status', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: membership
        });
    }

    return { locationId };
}

async function resolveRegistrationStudio(formData) {
    const workType = artistRegistration.normalizeWorkType(formData?.work_type);
    if (workType === 'independent') {
        return { studioId: null, estudiosValue: 'Sin estudio/Independiente' };
    }

    if (!artistRegistration.isStudioWorkType(workType)) {
        return { studioId: null, estudiosValue: null };
    }

    const studioName = String(formData?.studio_name || '').trim();
    if (!studioName) {
        return { studioId: null, estudiosValue: null };
    }

    if (formData?.studio_id) {
        return { studioId: formData.studio_id, estudiosValue: studioNameForStorage(studioName), studioName };
    }

    const normalized = studioName.toUpperCase();
    let rows = await _supabaseFetch(
        `studios?normalized_name=eq.${encodeURIComponent(normalized)}&select=id,name&limit=1`
    );

    let studioId = Array.isArray(rows) && rows[0] ? rows[0].id : null;
    if (!studioId) {
        try {
            const created = await _supabaseFetch('studios', {
                method: 'POST',
                prefer: 'return=representation',
                body: { name: studioName, normalized_name: normalized }
            });
            studioId = Array.isArray(created) && created[0] ? created[0].id : null;
        } catch (error) {
            rows = await _supabaseFetch(
                `studios?normalized_name=eq.${encodeURIComponent(normalized)}&select=id,name&limit=1`
            );
            studioId = Array.isArray(rows) && rows[0] ? rows[0].id : null;
            if (!studioId) throw error;
        }
    }

    return { studioId, estudiosValue: studioNameForStorage(studioName), studioName };
}

async function createArtistAuthUser({ email, password, fullName, username, draftId, source }) {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: getAdminHeaders(serviceRoleKey),
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                display_name: fullName || 'Artista',
                full_name: fullName || null,
                username,
                role: 'artist',
                registration_draft_id: draftId,
                registration_source: source || 'manual'
            }
        })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.msg || body.message || body.error || `Auth create failed (${response.status})`);
    }
    return body.user || body;
}

function requestAbsoluteUrl(req, pathName) {
    const basePath = req.weotziBasePath || '';
    return `${req.protocol}://${req.get('host')}${basePath}${pathName}`;
}

app.get('/api/register/artist-draft', async (req, res) => {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const draftId = artistRegistration.normalizeDraftId(req.query.draft || req.query.draft_id);
    const email = artistRegistration.normalizeEmail(req.query.email);

    if (!draftId && !email) {
        return res.status(400).json({ success: false, error: 'draft_id o email requerido' });
    }

    try {
        const artist = await findArtistDraft({ draftId, email });
        if (!artist) return res.status(404).json({ success: false, error: 'Borrador de registro no encontrado' });
        if (isFinalizedArtist(artist)) {
            return res.status(409).json({
                success: false,
                error: 'Registro detectado para este email. Inicia sesion para continuar.',
                code: 'ALREADY_REGISTERED'
            });
        }

        return res.json({
            success: true,
            draft_id: artist.registration_draft_id,
            artist: artistRegistration.publicArtistDraft(artist)
        });
    } catch (error) {
        console.error('[register draft load] failed:', error.message);
        return res.status(500).json({ success: false, error: 'No se pudo cargar el borrador de registro' });
    }
});

app.post('/api/register/artist-draft', async (req, res) => {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const body = req.body || {};
    const formData = body.data && typeof body.data === 'object' ? body.data : {};
    const requestedDraftId = artistRegistration.normalizeDraftId(body.draft_id);
    const draftId = requestedDraftId || crypto.randomUUID();
    const email = artistRegistration.normalizeEmail(body.email || formData.email);
    const source = artistRegistration.sanitizeRegistrationSource(body.source || formData.registration_source);
    const step = artistRegistration.normalizeStep(body.step);

    if (email && !artistRegistration.isValidEmail(email)) {
        return res.status(400).json({ success: false, error: 'Email invalido' });
    }

    try {
        let existing = await findArtistDraft({ draftId: requestedDraftId, email });

        if (existing && isFinalizedArtist(existing)) {
            return res.status(409).json({
                success: false,
                error: 'Registro detectado para este email. Inicia sesion para continuar.',
                code: 'ALREADY_REGISTERED'
            });
        }

        const patch = artistRegistration.buildArtistRegistrationPayload(formData, {
            draftId: existing?.registration_draft_id || draftId,
            email: email || existing?.email || '',
            source,
            step,
            status: artistRegistration.REGISTRATION_STATUS_INCOMPLETE,
            started: !existing,
            allowEmailUsernameFallback: false
        });

        delete patch.user_id;
        delete patch.registration_submitted_at;
        if (!email && existing?.email) delete patch.email;

        let savedRows;
        if (existing) {
            savedRows = await _supabaseFetch(
                `artists_db?registration_draft_id=eq.${encodeURIComponent(existing.registration_draft_id)}&registration_status=eq.${encodeURIComponent(artistRegistration.REGISTRATION_STATUS_INCOMPLETE)}&user_id=is.null`,
                { method: 'PATCH', prefer: 'return=representation', body: patch }
            );
            if (!Array.isArray(savedRows) || !savedRows[0]) {
                const latest = await findArtistDraft({ draftId: existing.registration_draft_id });
                if (isFinalizedArtist(latest)) {
                    return res.status(409).json({
                        success: false,
                        error: 'Este registro ya fue enviado para validacion',
                        code: 'ALREADY_SUBMITTED'
                    });
                }
                throw new Error('Draft row was not updated');
            }
        } else {
            savedRows = await _supabaseFetch('artists_db', {
                method: 'POST',
                prefer: 'return=representation',
                body: patch
            });
        }

        const artist = Array.isArray(savedRows) && savedRows[0] ? savedRows[0] : existing;
        return res.json({
            success: true,
            draft_id: artist.registration_draft_id,
            artist: artistRegistration.publicArtistDraft(artist)
        });
    } catch (error) {
        console.error('[register draft] failed:', error.message);
        return res.status(500).json({ success: false, error: 'No se pudo guardar el borrador de registro' });
    }
});

app.post('/api/register/artist-finalize', async (req, res) => {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const body = req.body || {};
    const draftId = artistRegistration.normalizeDraftId(body.draft_id);
    const formData = body.data && typeof body.data === 'object' ? body.data : {};
    const email = artistRegistration.normalizeEmail(body.email || formData.email);
    const password = String(body.password || formData.signup_password || '');
    const source = artistRegistration.sanitizeRegistrationSource(body.source || formData.registration_source);

    if (!draftId) return res.status(400).json({ success: false, error: 'draft_id requerido' });
    if (!artistRegistration.isValidEmail(email)) return res.status(400).json({ success: false, error: 'Email invalido' });
    if (password.length < 6) return res.status(400).json({ success: false, error: 'La contrasena debe tener al menos 6 caracteres' });

    try {
        const draft = await findArtistDraft({ draftId });
        if (!draft) return res.status(404).json({ success: false, error: 'Borrador de registro no encontrado' });
        if (isFinalizedArtist(draft)) {
            return res.status(409).json({ success: false, error: 'Este registro ya fue enviado para validacion' });
        }

        const username = artistRegistration.formatArtistUsername(formData.artistic_name, email);
        const instagram = String(formData.instagram_handle || '').trim().replace(/^@/, '');
        const conflicts = await getRegistrationConflicts({ email, username, instagram, draftId });
        if (conflicts.length > 0) {
            return res.status(409).json({ success: false, error: 'Datos ya registrados', conflicts });
        }

        const { studioId, estudiosValue, studioName } = await resolveRegistrationStudio(formData);
        const fullName = artistRegistration.capitalizeWords(formData.full_name);
        const authUser = await createArtistAuthUser({
            email,
            password,
            fullName,
            username,
            draftId,
            source
        });
        if (!authUser || !authUser.id) {
            throw new Error('Auth create returned no user id');
        }

        const finalPatch = artistRegistration.buildArtistRegistrationPayload(formData, {
            draftId,
            userId: authUser.id,
            email,
            source,
            step: 12,
            studioId,
            estudiosValue,
            status: artistRegistration.REGISTRATION_STATUS_PENDING_VALIDATION,
            submitted: true
        });

        const savedRows = await _supabaseFetch(
            `artists_db?registration_draft_id=eq.${encodeURIComponent(draftId)}`,
            { method: 'PATCH', prefer: 'return=representation', body: finalPatch }
        );
        const artist = Array.isArray(savedRows) && savedRows[0] ? savedRows[0] : null;
        await persistRegistrationStudioAssociations({
            formData,
            artistUserId: authUser.id,
            studioId,
            studioName: studioName || estudiosValue
        });

        return res.json({
            success: true,
            user_id: authUser.id,
            draft_id: draftId,
            registration_status: artistRegistration.REGISTRATION_STATUS_PENDING_VALIDATION,
            artist: artistRegistration.publicArtistDraft(artist),
            dashboard_url: requestAbsoluteUrl(req, '/artist/dashboard'),
            login_url: requestAbsoluteUrl(req, '/registerclosedbeta'),
            profile_url: username ? requestAbsoluteUrl(req, `/artist/profile?artist=${encodeURIComponent(username)}`) : null
        });
    } catch (error) {
        console.error('[register finalize] failed:', error.message);
        const already = /already|exists|duplicate|registered/i.test(error.message);
        return res.status(already ? 409 : 500).json({
            success: false,
            error: already ? 'Ya existe una cuenta con ese email.' : 'No se pudo finalizar el registro'
        });
    }
});

// ============================================
// Registration uniqueness check
// ============================================
// Used by the pre-auth wizard before finalizing. It checks that the proposed
// email / username / instagram_handle are not already taken while excluding
// the current artists_db draft.

app.post('/api/register/check-uniqueness', async (req, res) => {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }

    const body = req.body || {};
    const email = artistRegistration.normalizeEmail(body.email);
    const username = String(body.username || '').trim().toLowerCase();
    const instagram = String(body.instagram || '').trim().toLowerCase().replace(/^@/, '');
    const draftId = artistRegistration.normalizeDraftId(body.draft_id);

    if (!email && !username && !instagram) {
        return res.status(400).json({ success: false, error: 'At least one of email/username/instagram required' });
    }

    try {
        const conflicts = await getRegistrationConflicts({ email, username, instagram, draftId });
        return res.json({
            success: true,
            available: conflicts.length === 0,
            conflicts
        });
    } catch (err) {
        console.error('[uniqueness check] failed:', err.message);
        return res.status(500).json({ success: false, error: 'Check failed' });
    }
});

app.post('/api/register/check-uniqueness-legacy', async (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server configuration incomplete' });
    }
    const headers = {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`
    };

    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const username = String(body.username || '').trim().toLowerCase();
    const instagram = String(body.instagram || '').trim().toLowerCase().replace(/^@/, '');

    if (!email && !username && !instagram) {
        return res.status(400).json({ success: false, error: 'At least one of email/username/instagram required' });
    }

    const conflicts = [];

    async function checkExistsHead(path) {
        try {
            const r = await fetch(`${supabaseUrl}${path}`, {
                method: 'HEAD',
                headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }
            });
            const range = r.headers.get('content-range') || '*/0';
            const total = parseInt(range.split('/')[1], 10);
            return Number.isFinite(total) && total > 0;
        } catch (_) {
            return false;
        }
    }

    try {
        // 1. Email — check both auth.users (via REST admin endpoint) and
        //    artists_db.email (the public mirror).
        if (email) {
            const authCheckRes = await fetch(
                `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
                { headers }
            ).catch(() => null);
            let emailInAuth = false;
            if (authCheckRes && authCheckRes.ok) {
                const j = await authCheckRes.json().catch(() => ({}));
                if (Array.isArray(j.users) && j.users.length > 0) emailInAuth = true;
            }
            const emailInArtists = await checkExistsHead(
                `/rest/v1/artists_db?email=eq.${encodeURIComponent(email)}&select=user_id`
            );
            if (emailInAuth || emailInArtists) conflicts.push('email');
        }

        // 2. Username (the .wo handle) — case-insensitive match in artists_db.
        if (username) {
            const taken = await checkExistsHead(
                `/rest/v1/artists_db?username=ilike.${encodeURIComponent(username)}&select=user_id`
            );
            if (taken) conflicts.push('username');
        }

        // 3. Instagram handle — match against artists_db.instagram (with or
        //    without @ prefix in stored data).
        if (instagram) {
            const takenA = await checkExistsHead(
                `/rest/v1/artists_db?instagram=ilike.${encodeURIComponent(instagram)}&select=user_id`
            );
            const takenB = takenA ? false : await checkExistsHead(
                `/rest/v1/artists_db?instagram=ilike.${encodeURIComponent('@' + instagram)}&select=user_id`
            );
            if (takenA || takenB) conflicts.push('instagram');
        }

        return res.json({
            success: true,
            available: conflicts.length === 0,
            conflicts
        });
    } catch (err) {
        console.error('[uniqueness check] failed:', err.message);
        return res.status(500).json({ success: false, error: 'Check failed' });
    }
});

// ============================================
// Instagram CDN proxy
// ============================================
// Instagram's CDN sets `Cross-Origin-Resource-Policy: same-origin` on most
// image URLs, so the browser blocks rendering from a different origin
// (NotSameOrigin). We proxy the image through our server with a permissive
// CORP header so thumbnails can render in /register-artist (Step 8 grid)
// and in the IGImport modal preview.
//
// Hostname allowlist prevents abusing the endpoint as an open proxy. The
// igSignupLimiter rate-limit (already on /api/instagram/*) provides
// protection against high-volume abuse.

const ALLOWED_IG_CDN_HOSTS = [
    /\.cdninstagram\.com$/,
    /\.fbcdn\.net$/
];

app.get('/api/instagram/proxy-thumb', async (req, res) => {
    const targetUrl = String(req.query.url || '');
    if (!targetUrl) {
        return res.status(400).json({ success: false, error: 'Missing url parameter' });
    }
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch (_) {
        return res.status(400).json({ success: false, error: 'Invalid URL' });
    }
    if (parsed.protocol !== 'https:') {
        return res.status(400).json({ success: false, error: 'Only https URLs allowed' });
    }
    if (!ALLOWED_IG_CDN_HOSTS.some(re => re.test(parsed.hostname))) {
        return res.status(400).json({ success: false, error: 'Host not allowed' });
    }

    try {
        const upstream = await fetch(parsed.toString(), {
            // Don't forward referrer — IG CDN sometimes 403s based on it.
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WeOtziProxy/1.0)' }
        });
        if (!upstream.ok) {
            return res.status(upstream.status).json({
                success: false,
                error: `Upstream ${upstream.status}`
            });
        }
        const contentType = upstream.headers.get('content-type') || 'image/jpeg';
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600'); // 1h cache to limit re-fetches
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
        return res.send(buf);
    } catch (err) {
        console.error('[ig-proxy] failed:', err.message);
        return res.status(502).json({ success: false, error: 'Proxy fetch failed' });
    }
});

// ============================================
// INSTAGRAM IMPORT — preview & commit
// ============================================
// Two-stage flow: preview is cheap (one Apify call, no Storage), commit
// downloads media + writes to DB. See lib/instagram-import.js.
//
// Auth model: any authenticated Supabase user can preview their own profile
// or import to their own row. The caller's JWT is required so we know which
// user_id to write to. We never let one user write to another user's row.

async function resolveCallerUserId(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.replace('Bearer ', '');
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) return null;
    try {
        const r = await fetch(`${url}/auth/v1/user`, {
            headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${token}` }
        });
        if (!r.ok) return null;
        const u = await r.json();
        return u && u.id ? u.id : null;
    } catch (_) {
        return null;
    }
}

function mapImportError(err) {
    const status = err.status || 500;
    return {
        status,
        body: {
            success: false,
            code: err.code || 'INTERNAL',
            error: err.message || 'Unexpected error'
        }
    };
}

// Tighter rate-limit for unauthenticated signup-mode imports — Apify costs
// per call, so we cap each IP at 8 imports / hour to prevent burst abuse.
const igSignupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many import attempts, try again later.' }
});

app.post('/api/instagram/preview', igSignupLimiter, async (req, res) => {
    if (process.env.INSTAGRAM_IMPORT_ENABLED === 'false') {
        return res.status(404).json({ success: false, error: 'Feature disabled' });
    }
    const body = req.body || {};
    const isSignup = body.mode === 'signup';
    if (!isSignup) {
        // Dashboard preview: require an authenticated caller.
        const callerId = await resolveCallerUserId(req);
        if (!callerId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
    }
    try {
        const out = await igImport.preview({
            handle: body.handle,
            limit: body.limit
        });
        return res.json({ success: true, ...out });
    } catch (err) {
        const m = mapImportError(err);
        return res.status(m.status).json(m.body);
    }
});

app.post('/api/instagram/commit', igSignupLimiter, async (req, res) => {
    if (process.env.INSTAGRAM_IMPORT_ENABLED === 'false') {
        return res.status(404).json({ success: false, error: 'Feature disabled' });
    }
    const body = req.body || {};
    const target = body.target;
    const isSignup = body.mode === 'signup';

    let target_user_id = null;
    if (!isSignup) {
        const callerId = await resolveCallerUserId(req);
        if (!callerId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const requestedTargetUserId = body.target_user_id || callerId;
        if (requestedTargetUserId !== callerId) {
            return res.status(403).json({ success: false, error: 'Cannot commit to another user' });
        }
        target_user_id = callerId;
    }

    try {
        const out = await igImport.commit({
            payload_id: body.payload_id,
            selection: body.selection,
            target_user_id,
            target,
            mode: isSignup ? 'signup' : 'dashboard',
            allowed_permalinks: Array.isArray(body.allowed_permalinks) ? body.allowed_permalinks : null
        });
        return res.json({ success: true, ...out });
    } catch (err) {
        const m = mapImportError(err);
        return res.status(m.status).json(m.body);
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
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

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
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

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
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

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
    if (forceChannel) {
        if (!emailService.VALID_CHANNELS.includes(forceChannel)) {
            return res.status(400).json({ success: false, error: 'Invalid force channel' });
        }
        const auth = await appSettings.verifyAdminCaller(req);
        if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
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

const packageInfo = require('./package.json');

const routeDescriptions = {
    '/': 'Redirects to quotation form',
    '/archive': 'Archived quotations',
    '/artist/dashboard': 'Artist dashboard',
    '/artist/invitations': 'Artist invitations',
    '/artist/login': 'Artist login',
    '/artist/profile': 'Public artist profile',
    '/artist/profile/details': 'Artist profile details',
    '/artist/profile/gallery': 'Artist profile gallery',
    '/artist/visitors': 'Artist visitors',
    '/backoffice': 'Admin panel',
    '/backoffice/login': 'Admin login',
    '/calendar': 'Calendar view',
    '/client/dashboard': 'Client dashboard',
    '/client/login': 'Client login',
    '/client/register': 'Client registration',
    '/explore': 'Explore experience',
    '/explore/globe': 'Explore globe',
    '/job-board': 'Job board public feed',
    '/job-board/request': 'Publish tattoo request',
    '/marketplace': 'Artists marketplace',
    '/migration-log': 'Migration log',
    '/my-quotations': 'Artist quotations panel',
    '/my-quotations/statistics': 'Quotation statistics',
    '/pre-cotizador': 'Pre-quote estimator',
    '/quotation': 'Quotation form',
    '/quotations': 'Quotations list',
    '/register-artist': 'Artist registration form',
    '/registerclosedbeta': 'Closed beta registration',
    '/studio/dashboard': 'Studio dashboard',
    '/studio/login': 'Studio login',
    '/studio/profile': 'Studio profile',
    '/studio/register': 'Studio registration',
    '/studio-spots': 'Studio spots',
    '/support/dashboard': 'Support dashboard',
    '/support/login': 'Support login',
    '/tutorial': 'Interactive tour'
};

function titleFromRoute(routePath) {
    return routePath
        .split('/')
        .filter(Boolean)
        .map(part => part
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' '))
        .join(' / ');
}

function collectPublicRoutes(dir = path.join(__dirname, 'public'), routePrefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const routes = [];

    if (entries.some(entry => entry.isFile() && entry.name === 'index.html')) {
        routes.push(routePrefix || '/');
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'shared') continue;
        routes.push(...collectPublicRoutes(path.join(dir, entry.name), `${routePrefix}/${entry.name}`));
    }

    return routes.sort((a, b) => a.localeCompare(b));
}

function collectRegisteredRoutes() {
    return app._router.stack
        .filter(layer => layer.route && layer.route.path)
        .flatMap(layer => {
            const methods = Object.keys(layer.route.methods)
                .map(method => method.toUpperCase())
                .sort()
                .join(',');
            return [{ methods, path: layer.route.path }];
        })
        .filter(route => route.path.startsWith('/api/') || route.path.startsWith('/shared/'))
        .sort((a, b) => `${a.path} ${a.methods}`.localeCompare(`${b.path} ${b.methods}`));
}

function logRouteList(title, routes, formatter) {
    console.log(`  ${title}:`);
    console.log('  -----------------------------------------');
    routes.forEach(route => console.log(formatter(route)));
    console.log('');
}

function logStartupBanner() {
    const appRoutes = ['/', ...collectPublicRoutes()];
    const apiRoutes = collectRegisteredRoutes();

    console.log('');
    console.log(' __        __       ___  _       _ ');
    console.log(' \\ \\      / /__    / _ \\| |_ ___(_)');
    console.log('  \\ \\ /\\ / / _ \\  | | | | __|_  / |');
    console.log('   \\ V  V /  __/  | |_| | |_ / /| |');
    console.log('    \\_/\\_/ \\___|   \\___/ \\__/___|_|');
    console.log('                We\u00D6tzi');
    console.log('');
    console.log(`  Bienvenido a We\u00D6tzi ${packageInfo.version}`);
    console.log('  Servidor unificado listo para trabajar.');
    console.log('');
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Port:        ${PORT}`);
    console.log(`  Local:       http://localhost:${PORT}`);
    console.log(`  Base path:   ${APP_BASE_PATH} (tambien disponible sin prefijo en local)`);
    console.log('');

    console.log('  Configuration Status:');
    console.log('  -----------------------------------------');
    console.log(`  Supabase:     ${process.env.SUPABASE_URL ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  Google Maps:  ${process.env.GOOGLE_MAPS_API_KEY ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  n8n Webhook:  ${process.env.N8N_WEBHOOK_URL ? 'Configured (env)' : 'Using file config'}`);
    console.log(`  Demo Mode:    ${process.env.DEMO_MODE || 'Not set (check file)'}`);
    console.log('');

    logRouteList('App Routes', appRoutes, route => {
        const description = routeDescriptions[route] || titleFromRoute(route);
        return `  ${route.padEnd(30)} - ${description}`;
    });

    logRouteList('API Routes', apiRoutes, route => {
        const label = `${route.methods} ${route.path}`;
        return `  ${label}`;
    });
}

// Start server
app.listen(PORT, () => {
    logStartupBanner();
    startLocalNgrok({ targetPort: PORT }).catch(err => {
        console.warn(`[ngrok] Startup failed: ${err.message}`);
    });
    return;
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

