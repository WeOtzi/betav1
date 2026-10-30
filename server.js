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
const { legacyRedirectFor, legacyLocation } = require('./lib/legacy-routes');
// Capa PostgREST unificada (ver docs/plans/2026-06-21-postgrest-capa-unificada-piloto-cotizaciones.md)
const { pgrest } = require('./lib/postgrest');
const { resolveBearerUser, bearerToken } = require('./lib/auth/supabase-auth');
const { QuotationsRepo } = require('./lib/repos/quotations');
const { JobBoardRepo } = require('./lib/repos/jobboard');
const { CurrenciesRepo } = require('./lib/repos/currencies');
const { InstagramRepo } = require('./lib/repos/instagram');
const { AnalyticsRepo } = require('./lib/repos/analytics');
const { StudiosRepo, pgErrorCode, isMissingSchemaError } = require('./lib/repos/studios');
const { SuppliesRepo } = require('./lib/repos/supplies');
const { summarizeArtistPublicProfileMetrics } = require('./lib/artist-public-profile-metrics');

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
const LISTEN_HOST = process.env.HOST || '127.0.0.1';
const LISTEN_SOCKET = process.env.LISTEN_SOCKET || '';
app.get('/api/release', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        ok: true,
        commit: process.env.RELEASE_COMMIT || null,
        version: require('./package.json').version,
        environment: process.env.DEPLOYMENT_ENV || process.env.NODE_ENV || 'development'
    });
});
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
        return res.redirect(`${APP_BASE_PATH}/inicio${search}`);
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
app.post('/api/quotations/intake', require('./services/quotation-intake').handleIntake);
const accountModes = require('./services/account-modes');
app.get('/api/account/testing', (req, res) => res.json({ registrationOpen: accountModes.testingEnabled() }));
app.post('/api/account/mode', accountModes.activate);
app.post('/api/register/test-client', authLimiter, accountModes.registerTestClient);

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

// Delega en la capa PostgREST unificada (lib/postgrest.js). Se conserva la
// firma para no tocar las ~60 llamadas no-cotizacion (soporte, artistas,
// estudios, etc.) que aun lo usan; la migracion de esas areas vendra despues.
async function _supabaseFetch(path, { method = 'GET', body, prefer } = {}) {
    return pgrest.raw(path, { method, body, prefer });
}

// Delega en lib/auth/supabase-auth.resolveBearerUser; devuelve el objeto de
// usuario crudo de Supabase Auth (con .id/.email) para conservar el contrato.
// Se memoiza por request: el rate limit de avisos (studioNotifyLimiter) y el
// handler resuelven el mismo Bearer una sola vez.
const _authUserByRequest = new WeakMap();
async function _getAuthUserFromBearer(req) {
    if (req && typeof req === 'object' && _authUserByRequest.has(req)) {
        return _authUserByRequest.get(req);
    }
    const user = await resolveBearerUser(req);
    const raw = user ? user.raw : null;
    if (req && typeof req === 'object') _authUserByRequest.set(req, raw);
    return raw;
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
    // Cuenta de estudio: dueño de una fila de `studios` (studios.user_id).
    try {
        const studio = await StudiosRepo.getOwnedStudioByUserId(userId);
        if (studio) return { role: 'studio', profile: studio };
    } catch (err) {
        console.warn('[support-chat] studio role lookup failed:', err.message);
    }
    // Cuenta Supplies: dueño de un vendor (supply_vendors.user_id). La tabla
    // nace en una migración que puede no estar aplicada: ahí no se loguea.
    try {
        const vendor = await SuppliesRepo.getVendorByUserId(userId);
        if (vendor) return { role: 'supplies', profile: { id: vendor.id, name: vendor.name, slug: vendor.slug } };
    } catch (err) {
        if (!isMissingSchemaError(err) && err.status !== 404) {
            console.warn('[support-chat] supplies role lookup failed:', err.message);
        }
    }
    return { role: 'anonymous', profile: null };
}

// support_conversations.user_role tiene un CHECK vivo (artist, client, support,
// anonymous): studio y supplies se guardan como 'anonymous' hasta extenderlo.
const SUPPORT_STORED_ROLES = new Set(['artist', 'client', 'support', 'anonymous']);
function _storedSupportRole(role) {
    return SUPPORT_STORED_ROLES.has(role) ? role : 'anonymous';
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
            // Cotizaciones donde el usuario es cliente o artista. Via la capa
            // unificada con columnas reales (antes pedia status/service_type/
            // user_id inexistentes y la query fallaba — doc §4-E).
            const q = await QuotationsRepo.listForUser({ userId, quoteId: args.quotation_id });
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
        : role === 'studio' ? `Estás hablando con un estudio de tatuaje${name ? ` (${name})` : ''}.`
        : role === 'supplies' ? `Estás hablando con un proveedor de insumos (Supplies)${name ? ` (${name})` : ''}.`
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
                            user_role: _storedSupportRole(roleInfo?.role),
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
            user_role: _storedSupportRole(roleInfo?.role),
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
// ENDPOINT: GET /api/support-chat/poll
// Query: conversationId (uuid), since (ISO timestamp opcional)
// Sustituye a Supabase Realtime para el widget: support_messages y
// support_conversations ahora son legibles solo por soporte via RLS, asi que
// el widget (anonimo o no) recibe las novedades a traves de este endpoint
// (service role). El conversationId es un uuid no adivinable: mismo modelo de
// confianza que tenia el canal de Realtime.
// ============================================
app.get('/api/support-chat/poll', async (req, res) => {
    if (!_assertSupportEnabled(res)) return;
    try {
        const conversationId = String(req.query.conversationId || '');
        if (!_isUuid(conversationId)) {
            return res.status(400).json({ success: false, error: 'conversationId invalido' });
        }
        const sinceRaw = req.query.since ? new Date(String(req.query.since)) : null;
        const sinceFilter = sinceRaw && !isNaN(sinceRaw.getTime())
            ? `&created_at=gt.${encodeURIComponent(sinceRaw.toISOString())}`
            : '';
        const [convRows, messages] = await Promise.all([
            _supabaseFetch(`support_conversations?id=eq.${conversationId}&limit=1`),
            _supabaseFetch(
                `support_messages?conversation_id=eq.${conversationId}${sinceFilter}` +
                `&order=created_at.asc&limit=50&select=id,role,content,created_at,author_user_id`
            )
        ]);
        const conversation = convRows && convRows[0] ? convRows[0] : null;
        if (!conversation) {
            return res.status(404).json({ success: false, error: 'conversacion no encontrada' });
        }
        return res.json({ success: true, conversation, messages: messages || [] });
    } catch (err) {
        console.error('[support-chat] poll error:', err.message);
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
            body: { user_id: authUser.id, user_role: _storedSupportRole(roleInfo.role), updated_at: new Date().toISOString() },
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
                    await pgrest('session_logs')
                        .eq('id', session_log_id)
                        .patch({ country: geo.country, city: geo.city }, { returning: false });
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

    try {
        // Step 1: look up the target so we can (a) confirm it exists and
        // (b) refuse to delete the superadmin account.
        let rows;
        try {
            rows = await pgrest('artists_db')
                .select('id,user_id,email')
                .eq(column, value)
                .execute();
        } catch (lookupErr) {
            console.error('[Admin API] delete-artist lookup failed:', lookupErr.status, lookupErr.message);
            return res.status(502).json({ success: false, error: `Supabase lookup failed: HTTP ${lookupErr.status || ''}`.trim() });
        }
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontró ningún artista con ese identificador.' });
        }
        const targetEmail = String(rows[0].email || '').trim().toLowerCase();
        if (targetEmail && appSettings.isSuperadminEmail(targetEmail)) {
            return res.status(403).json({ success: false, error: 'No se puede eliminar la cuenta superadmin.' });
        }

        // Step 2: delete. return=representation makes PostgREST echo the deleted
        // row so we can distinguish a real delete from a 0-row no-op.
        let deleted;
        try {
            deleted = await pgrest('artists_db')
                .eq(column, value)
                .delete({ returning: true });
        } catch (delErr) {
            console.error('[Admin API] delete-artist DELETE failed:', delErr.status, delErr.message);
            // 23503 = FK violation: related rows block the delete. Surface it.
            return res.status(409).json({
                success: false,
                error: `No se pudo eliminar (puede haber registros relacionados). HTTP ${delErr.status || ''}: ${String(delErr.message || '').slice(0, 300)}`
            });
        }

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
    
    if (!['artist', 'client', 'studio', 'supplies'].includes(userType)) {
        return res.status(400).json({
            success: false,
            error: 'userType debe ser "artist", "client", "studio" o "supplies"'
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
          : userType === 'supplies' ? 'supply_vendors'
          : 'clients_db'
        );

        // Step 1: Lookup user by email
        let users;
        try {
            users = userType === 'supplies'
                // supply_vendors.email es el email de LOGIN (lo fija el registro
                // desde auth.users, unico en minusculas), no el de contacto.
                ? await SuppliesRepo.listVendorsByLoginEmail(email)
                : await pgrest(tableName)
                    .select('user_id,email')
                    .eq('email', email)
                    .execute();
        } catch (lookupErr) {
            console.error('[Auth] Error looking up user:', lookupErr.message);
            throw new Error('Error al buscar usuario');
        }

        if (!users || users.length === 0) {
            console.log(`[Auth] User not found: ${email} (type: ${userType})`);
            return res.status(404).json({
                success: false,
                error: 'Usuario no encontrado'
            });
        }

        if (userType === 'supplies') {
            // El vendor tiene que tener dueño y ese usuario de Auth tiene que
            // ser el mismo email de login: si no coinciden, no se toca nada.
            const vendor = users.length === 1 ? users[0] : null;
            const authUser = vendor && vendor.user_id
                ? await StudiosRepo.getAuthUserContact(vendor.user_id).catch(() => null)
                : null;
            const sameLogin = authUser && authUser.email
                && authUser.email === String(email).trim().toLowerCase();
            if (!vendor || !vendor.user_id || !sameLogin) {
                console.log(`[Auth] Supplies login mismatch for: ${email}`);
                return res.status(404).json({
                    success: false,
                    error: 'Usuario no encontrado'
                });
            }
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

    try {
        let existing;
        try {
            existing = await pgrest('tattoo_styles')
                .select('id,name,slug,sort_order')
                .is('parent_id', null)
                .execute();
        } catch (_) {
            throw new Error('Failed to fetch existing styles');
        }

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

        let inserted;
        try {
            inserted = await pgrest('tattoo_styles').insert({
                name: trimmed,
                slug: slug,
                parent_id: null,
                sort_order: maxSort + 1,
                substyles_display_mode: 'grouped'
            });
        } catch (insertErr) {
            throw new Error(insertErr.message || 'Failed to insert style');
        }

        const [created] = inserted;
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
    { name: 'studio_spot_counter_offers', description: 'Contraofertas de spots' },
    { name: 'studio_spot_attachments', description: 'Adjuntos de spots' },
    { name: 'studio_membership_invitation_details', description: 'Detalle de invitaciones de estudios' },
    { name: 'studio_invitation_change_requests', description: 'Cambios solicitados en invitaciones' },
    { name: 'studio_jobs_log', description: 'Registro de trabajos del estudio' },
    { name: 'studio_invoices', description: 'Facturas del estudio' },
    { name: 'studio_invoice_items', description: 'Items de factura' },
    { name: 'studio_inventory_items', description: 'Inventario (items)' },
    { name: 'studio_inventory_movements', description: 'Movimientos de inventario' },
    { name: 'studio_suppliers', description: 'Proveedores' },
    { name: 'studio_sponsors', description: 'Patrocinadores' },
    { name: 'studio_sponsor_artists', description: 'Patrocinios a artistas' },
    { name: 'studio_documents', description: 'Documentos del estudio' },
    { name: 'studio_bookings', description: 'Agenda del estudio (citas)' },
    // Studios platform (migraciones 20261030200000–204000). `readonly: true`:
    // solo cambian por RPC (contratos, pedidos, reclamos, gastos ligados).
    { name: 'studio_membership_request_details', description: 'Detalle de solicitudes de alta de artistas', readonly: true },
    { name: 'studio_claim_requests', description: 'Reclamos de fichas de estudio', readonly: true },
    { name: 'studio_contracts', description: 'Contratos registrados estudio-artista', readonly: true },
    { name: 'studio_finance_entries', description: 'Gastos e ingresos del estudio', readonly: true },
    // Supplies (tiendas de insumos)
    { name: 'supply_vendors', description: 'Vendors Supplies' },
    { name: 'supply_vendor_private', description: 'Datos fiscales de vendors Supplies' },
    { name: 'supply_vendor_counters', description: 'Numeracion de pedidos por vendor', readonly: true },
    { name: 'supply_products', description: 'Catalogo de productos Supplies' },
    { name: 'supply_discount_tiers', description: 'Escalas de descuento Supplies' },
    { name: 'supply_orders', description: 'Pedidos de reposicion a Supplies', readonly: true },
    { name: 'supply_order_items', description: 'Lineas de pedidos Supplies', readonly: true },
    { name: 'supply_order_events', description: 'Historial de estados de pedidos Supplies', readonly: true },
    // Quotations domain
    { name: 'quotations_db', description: 'Cotizaciones' },
    { name: 'quotations_attachments', description: 'Adjuntos de cotizaciones' },
    { name: 'quotation_notes', description: 'Notas de cotizacion' },
    { name: 'quotation_sessions', description: 'Sesiones de cotizacion' },
    { name: 'quotation_status_history', description: 'Historial de estados de cotizacion' },
    { name: 'quotation_intake_extras', description: 'Datos complementarios de cotizacion' },
    { name: 'quotation_flow_config', description: 'Configuracion del flujo' },
    // Account center / verification
    { name: 'user_preferences', description: 'Preferencias de cuenta' },
    { name: 'artist_billing_profiles', description: 'Facturacion de artistas' },
    { name: 'artist_payment_methods', description: 'Metodos de cobro tokenizados' },
    { name: 'artist_financial_entries', description: 'Movimientos financieros de artistas' },
    { name: 'artist_account_sessions', description: 'Sesiones de cuenta de artistas' },
    { name: 'artist_integration_connections', description: 'Integraciones de cuenta de artistas' },
    { name: 'artist_account_deletion_requests', description: 'Solicitudes de eliminacion de cuenta' },
    { name: 'artist_verification_documents', description: 'Documentos de verificacion de artistas' },
    { name: 'verification_history', description: 'Historial de verificaciones' },
    // Catalog / artist content
    { name: 'tattoo_styles', description: 'Estilos de tatuaje' },
    { name: 'body_parts', description: 'Partes del cuerpo' },
    { name: 'artist_tattoo_locations', description: 'Ubicaciones de tatuaje (artistas)' },
    { name: 'artist_calendar_events', description: 'Eventos del calendario de artistas' },
    { name: 'artist_profile_visits', description: 'Visitas a perfiles de artistas' },
    { name: 'verified_reviews', description: 'Resenas verificadas' },
    // Artist travel
    { name: 'artist_trips', description: 'Viajes de artistas' },
    { name: 'trip_studio_links', description: 'Estudios vinculados a viajes' },
    { name: 'trip_checklist_items', description: 'Checklist de viajes' },
    { name: 'trip_documents', description: 'Documentos de viajes' },
    { name: 'trip_events', description: 'Cronologia de viajes' },
    { name: 'trip_studio_link_audit', description: 'Auditoria de vinculaciones de viajes' },
    // Job board
    { name: 'job_board_requests', description: 'Solicitudes del job board' },
    { name: 'job_board_applications', description: 'Postulaciones del job board' },
    { name: 'job_board_attachments', description: 'Adjuntos del job board' },
    { name: 'job_board_counter_offers', description: 'Contraofertas del job board' },
    { name: 'job_board_request_stats', description: 'Metricas de solicitudes del job board' },
    { name: 'artist_saved_job_requests', description: 'Solicitudes guardadas por artistas' },
    // Support / chat
    { name: 'support_conversations', description: 'Conversaciones de soporte' },
    { name: 'support_messages', description: 'Mensajes de soporte' },
    { name: 'chat_messages', description: 'Mensajes de chat' },
    { name: 'inbox_threads', description: 'Hilos canonicos del inbox' },
    { name: 'inbox_thread_participants', description: 'Participantes del inbox' },
    { name: 'inbox_messages', description: 'Mensajes del inbox' },
    { name: 'inbox_thread_activity', description: 'Actividad auditable del inbox' },
    { name: 'user_notification_reads', description: 'Lecturas de notificaciones por usuario' },
    { name: 'client_profiles', description: 'Perfiles extendidos de clientes' },
    { name: 'client_favorites', description: 'Favoritos de clientes' },
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
    { name: 'artist_artwork_view_counts', description: 'Vistas por trabajo del portfolio (vista)', kind: 'view' },
    { name: 'studio_dashboard_metrics_view', description: 'Metricas de panel de estudio (vista)', kind: 'view' },
    { name: 'studio_artist_performance_view', description: 'Rendimiento de artistas (vista)', kind: 'view' },
    { name: 'studio_inventory_health_view', description: 'Salud de inventario (vista)', kind: 'view' },
    { name: 'studio_public_sponsors_view', description: 'Patrocinadores publicos (vista)', kind: 'view' },
    { name: 'studio_monthly_metrics_by_currency', description: 'Metricas mensuales por moneda (vista)', kind: 'view' },
    { name: 'studio_artist_metrics_by_currency', description: 'Metricas por artista y moneda (vista)', kind: 'view' },
    { name: 'studio_inventory_health_by_currency', description: 'Salud de inventario por moneda (vista)', kind: 'view' },
    { name: 'studio_public_roster', description: 'Roster publico de estudios (vista)', kind: 'view' },
    { name: 'studio_artist_material_balance', description: 'Materiales entregados por artista (vista)', kind: 'view' },
    { name: 'studio_material_assignment_monthly', description: 'Entregas de materiales por mes (vista)', kind: 'view' },
    { name: 'studio_finance_monthly_by_category', description: 'Finanzas mensuales por categoria (vista)', kind: 'view' },
    { name: 'supply_vendor_sales_monthly', description: 'Ventas mensuales de vendors Supplies (vista)', kind: 'view' },
    { name: 'supply_vendor_customers', description: 'Clientes de vendors Supplies (vista)', kind: 'view' },
    { name: 'chat_threads', description: 'Hilos consolidados del inbox (vista)', kind: 'view' }
];
const ADMIN_DATABASE_TABLE_NAMES = new Set(ADMIN_DATABASE_TABLES.map(table => table.name));
// Only base tables without `readonly` are writable through the generic row
// editor. Views, readonly tables (state machines that only change through
// RPCs) and any name not in the catalog above are rejected by POST/PATCH/DELETE.
const ADMIN_DATABASE_WRITABLE = new Set(
    ADMIN_DATABASE_TABLES.filter(table => !(table.kind === 'view' || table.readonly)).map(table => table.name)
);
const ADMIN_DATABASE_READONLY_TABLES = new Set(
    ADMIN_DATABASE_TABLES.filter(table => table.kind !== 'view' && table.readonly).map(table => table.name)
);
// Mensaje para una tabla del catalogo que no admite escritura generica.
function adminReadonlyMessage(tableName, verb = 'editarse') {
    if (ADMIN_DATABASE_READONLY_TABLES.has(tableName)) {
        return `Esta tabla es de solo lectura: solo cambia desde la plataforma y no puede ${verb} acá.`;
    }
    return `Esta es una vista de solo lectura y no puede ${verb}.`;
}
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
    // names are validated so they can never break out of the query. La lectura
    // pasa por la capa unificada (pgrest) con service-role.
    const q = pgrest(tableName).select('*').range(safeOffset, safeOffset + safeLimit - 1).count('exact');
    if (filterColumn) {
        if (!SAFE_COLUMN_RE.test(filterColumn)) {
            const err = new Error('Invalid filter column'); err.status = 400; throw err;
        }
        q.eq(filterColumn, filterValue == null ? '' : filterValue);
    }
    if (order) {
        if (!SAFE_ORDER_RE.test(order)) {
            const err = new Error('Invalid order'); err.status = 400; throw err;
        }
        const [orderCol, orderDir] = order.split('.');
        q.order(orderCol, { ascending: orderDir !== 'desc' });
    }

    let result;
    try {
        result = await q.execute();
    } catch (err) {
        err.status = err.status || 502;
        throw err;
    }
    return {
        rows: result.rows,
        count: result.count,
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
            error: isView ? adminReadonlyMessage(tableName, 'recibir filas') : 'Tabla no permitida.'
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
                ? adminReadonlyMessage(tableName, 'editarse')
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

    try {
        // Step 1: look up the studio.
        let rows;
        try {
            rows = await pgrest('studios')
                .select('id,user_id,email,name')
                .eq('id', id)
                .execute();
        } catch (lookupErr) {
            return res.status(502).json({ success: false, error: `Supabase lookup failed: HTTP ${lookupErr.status || ''} ${String(lookupErr.message || '').slice(0, 200)}`.trim() });
        }
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
        let deleted;
        try {
            deleted = await pgrest('studios')
                .eq('id', id)
                .delete({ returning: true });
        } catch (delErr) {
            return res.status(409).json({
                success: false,
                error: `No se pudo eliminar (puede haber registros relacionados con ON DELETE RESTRICT). HTTP ${delErr.status || ''}: ${String(delErr.message || '').slice(0, 300)}`
            });
        }
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

// ============================================
// BACKOFFICE - RECLAMOS DE ESTUDIOS, VENDORS SUPPLIES Y POSTULACIONES
// ============================================
// Superadmin (verifyAdminCaller) o agente de soporte activo (support_users_db).
// Las decisiones que pasan por una RPC (decide_studio_claim,
// decide_studio_spot_application) viajan con el JWT del caller: la RPC exige
// is_support_user() y registra quién decidió. Los listados y los flags de
// vendors usan service-role (la autorización ya se hizo acá).

async function _verifyBackofficeOrSupport(req) {
    const admin = await appSettings.verifyAdminCaller(req);
    if (admin.ok) return { ok: true, role: 'superadmin', userId: admin.userId, email: admin.email };
    if (admin.status === 401) return admin;

    const agent = await _getActiveSupportAgent(req);
    if (agent.ok) {
        return { ok: true, role: 'support', userId: agent.authUser.id, email: agent.authUser.email || null };
    }
    if (agent.status && agent.status >= 500) {
        return { ok: false, status: agent.status, error: agent.error || 'Could not verify support access' };
    }
    return { ok: false, status: 403, error: 'Esta acción requiere el superadmin o un agente de soporte activo.' };
}

// Traduce el error de una RPC (errcodes del contrato) a una respuesta HTTP.
function _respondRpcFailure(res, err, label) {
    const code = pgErrorCode(err);
    const dbMessage = err && err.dbMessage ? String(err.dbMessage).slice(0, 300) : '';
    if (code === 'PGRST202' || isMissingSchemaError(err)) {
        return res.status(503).json({ success: false, migration_pending: true, error: NOTIFY_MIGRATION_PENDING });
    }
    if (code === '42501') {
        return res.status(403).json({ success: false, error: dbMessage || 'No tenés permiso para esta acción.' });
    }
    if (code === '22023' || code === '22P02') {
        return res.status(400).json({ success: false, error: dbMessage || 'Datos inválidos.' });
    }
    if (code === '23514' || code === 'P0001' || code === 'P0002') {
        return res.status(409).json({ success: false, error: dbMessage || 'El estado cambió. Recargá y probá de nuevo.' });
    }
    console.error(`[Admin API] ${label} failed:`, err && err.message);
    return res.status(502).json({ success: false, error: 'No se pudo completar la acción.' });
}

// Aviso best-effort al usuario que reclamó la ficha (email de auth.users).
async function _notifyStudioClaimDecision(req, claimId) {
    const claim = await StudiosRepo.getClaimWithParties(claimId);
    if (!claim || !['approved', 'rejected'].includes(claim.status)) return { sent: false, delivery_status: 'skipped' };
    const user = claim.user;
    if (!user || !user.email) return { sent: false, delivery_status: 'no_recipient' };

    const base = applicationBase(req);
    const studioName = _notifyText(claim.studios?.name, 120) || 'tu estudio';
    const approved = claim.status === 'approved';
    const note = _notifyText(claim.decision_note, 300);
    const ctaUrl = approved ? `${base}/studio/dashboard` : `${base}/studio/register`;
    const result = await _sendStudioPlatformEmail({
        eventId: 'studio_claim_decision',
        recipient: { email: user.email, name: claim.contact_name || user.full_name || '' },
        fromName: 'We Ötzi',
        subject: approved ? `Aprobamos tu reclamo de ${studioName}` : `Tu reclamo de ${studioName} no fue aprobado`,
        bodyText: approved
            ? `${_notifyGreeting(claim.contact_name || user.full_name)}Revisamos tu reclamo y ya sos el dueño de ${studioName} en We Ötzi.\n\n`
                + `Completá el perfil del estudio desde ${ctaUrl}.`
            : `${_notifyGreeting(claim.contact_name || user.full_name)}Revisamos tu reclamo de ${studioName} y no pudimos aprobarlo.${note ? ` Motivo: ${note}.` : ''}\n\n`
                + `Si querés, podés registrar un estudio nuevo desde ${ctaUrl}.`,
        ctaUrl,
        meta: { claim_id: claim.id, studio_id: claim.studio_id, status: claim.status },
        idempotencyKey: `claim_decision:${claim.id}:${claim.status}`
    });
    return { sent: Boolean(result && result.ok), delivery_status: result && result.delivery_status };
}

/**
 * GET /api/admin/studio-claims
 * Reclamos `pending` con su estudio y el usuario reclamante.
 */
app.get('/api/admin/studio-claims', async (req, res) => {
    const auth = await _verifyBackofficeOrSupport(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    try {
        const claims = await StudiosRepo.listPendingClaims();
        return res.json({ success: true, claims });
    } catch (err) {
        if (isMissingSchemaError(err)) {
            return res.json({ success: true, claims: [], migration_pending: true });
        }
        console.error('[Admin API] studio-claims list failed:', err.message);
        return res.status(500).json({ success: false, error: 'No se pudieron cargar los reclamos.' });
    }
});

/**
 * POST /api/admin/studio-claims/:id/decide
 * Body: { decision: 'approve' | 'reject', note? }
 * Llama a decide_studio_claim con el JWT del caller (debe ser soporte).
 */
app.post('/api/admin/studio-claims/:id/decide', async (req, res) => {
    const auth = await _verifyBackofficeOrSupport(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const id = req.params.id;
    if (!UUID_RE.test(String(id))) {
        return res.status(400).json({ success: false, error: 'ID de reclamo inválido (se espera UUID).' });
    }
    const { decision, note } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'decision invalida (esperado: approve | reject)' });
    }
    const cleanNote = note == null ? null : (String(note).trim().slice(0, 1000) || null);

    let result;
    try {
        result = await StudiosRepo.decideClaimAsCaller(id, decision, cleanNote, bearerToken(req));
    } catch (err) {
        return _respondRpcFailure(res, err, 'decide_studio_claim');
    }

    let email = { sent: false, delivery_status: 'skipped' };
    try {
        email = await _notifyStudioClaimDecision(req, id);
    } catch (notifyErr) {
        console.warn('[Admin API] studio claim decision email not sent:', notifyErr.message);
        email = { sent: false, delivery_status: 'failed' };
    }

    console.log(`[Admin API] Studio claim ${id} decided (${decision}) by ${auth.role} ${auth.email || auth.userId}`);
    return res.json({ success: true, result, email_sent: Boolean(email.sent), delivery_status: email.delivery_status || null });
});

/**
 * GET /api/admin/supply-vendors
 * Vendors Supplies (los más nuevos primero).
 */
app.get('/api/admin/supply-vendors', async (req, res) => {
    const auth = await _verifyBackofficeOrSupport(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    try {
        const vendors = await SuppliesRepo.listVendors();
        return res.json({ success: true, vendors: Array.isArray(vendors) ? vendors : [] });
    } catch (err) {
        if (isMissingSchemaError(err)) {
            return res.json({ success: true, vendors: [], migration_pending: true });
        }
        console.error('[Admin API] supply-vendors list failed:', err.message);
        return res.status(500).json({ success: false, error: 'No se pudieron cargar los vendors.' });
    }
});

/**
 * PATCH /api/admin/supply-vendors/:id
 * Body: { is_verified?: boolean, is_active?: boolean } (nada más).
 */
app.patch('/api/admin/supply-vendors/:id', async (req, res) => {
    const auth = await _verifyBackofficeOrSupport(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const id = req.params.id;
    if (!UUID_RE.test(String(id))) {
        return res.status(400).json({ success: false, error: 'ID de vendor inválido (se espera UUID).' });
    }
    const body = req.body || {};
    const patch = {};
    for (const key of ['is_verified', 'is_active']) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        if (typeof body[key] !== 'boolean') {
            return res.status(400).json({ success: false, error: `${key} debe ser true o false.` });
        }
        patch[key] = body[key];
    }
    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ success: false, error: 'No hay cambios válidos para guardar (is_verified, is_active).' });
    }

    try {
        const vendor = await SuppliesRepo.updateVendorFlags(id, patch);
        if (!vendor) return res.status(404).json({ success: false, error: 'No se encontró el vendor.' });
        console.log(`[Admin API] Supply vendor ${id} updated by ${auth.role} ${auth.email || auth.userId}: ${JSON.stringify(patch)}`);
        return res.json({ success: true, vendor });
    } catch (err) {
        if (isMissingSchemaError(err)) {
            return res.status(503).json({ success: false, migration_pending: true, error: NOTIFY_MIGRATION_PENDING });
        }
        console.error('[Admin API] supply-vendor update failed:', err.message);
        return res.status(500).json({ success: false, error: 'No se pudo actualizar el vendor.' });
    }
});

/**
 * POST /api/admin/studio-spot-applications/:id/decide
 * Body: { status: 'accepted' | 'rejected' }
 * El backoffice decide una postulación por la RPC (máquina spot → contrato),
 * nunca escribiendo `status` directo en la tabla.
 */
app.post('/api/admin/studio-spot-applications/:id/decide', async (req, res) => {
    const auth = await _verifyBackofficeOrSupport(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const id = req.params.id;
    if (!UUID_RE.test(String(id))) {
        return res.status(400).json({ success: false, error: 'ID de postulación inválido (se espera UUID).' });
    }
    const status = req.body && req.body.status;
    if (!['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, error: 'status invalido (esperado: accepted | rejected)' });
    }

    try {
        const application = await StudiosRepo.decideSpotApplicationAsCaller(id, status, bearerToken(req));
        console.log(`[Admin API] Spot application ${id} decided (${status}) by ${auth.role} ${auth.email || auth.userId}`);
        return res.json({ success: true, application });
    } catch (err) {
        // Sin la migración de contratos (M2) la RPC viva solo admite al dueño del
        // estudio: el backoffice vuelve a su escritura previa con service-role.
        if (pgErrorCode(err) === '42501' && await _contractsMigrationMissing()) {
            try {
                const rows = await _supabaseFetch(
                    `studio_spot_applications?id=eq.${encodeURIComponent(id)}&status=in.(pending,viewed,shortlisted)`,
                    { method: 'PATCH', prefer: 'return=representation', body: { status, decided_at: new Date().toISOString(), decided_by_user_id: auth.userId || null } }
                );
                if (!rows || !rows.length) return res.status(409).json({ success: false, error: 'La postulación ya fue decidida o no existe.' });
                console.log(`[Admin API] Spot application ${id} decided (${status}, legacy) by ${auth.role} ${auth.email || auth.userId}`);
                return res.json({ success: true, application: rows[0], legacy: true });
            } catch (legacyErr) {
                return _respondRpcFailure(res, legacyErr, 'decide_studio_spot_application');
            }
        }
        return _respondRpcFailure(res, err, 'decide_studio_spot_application');
    }
});

async function _contractsMigrationMissing() {
    try {
        await _supabaseFetch('studio_contracts?select=id&limit=1');
        return false;
    } catch (probeErr) {
        return isMissingSchemaError(probeErr);
    }
}

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
        const application = await JobBoardRepo.getApplicationById(applicationId);
        if (!application) {
            throw new Error('Application not found');
        }

        // 1b. Race condition guard: application must still be pending
        if (application.status !== 'pending' && application.status !== 'viewed') {
            return res.status(409).json({
                success: false,
                error: `Application already ${application.status}`
            });
        }

        // 2. Fetch the request with client data
        const request = await JobBoardRepo.getRequestById(requestId);
        if (!request) {
            throw new Error('Request not found');
        }

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
        const artistData = await pgrest('artists_db')
            .select('*')
            .eq('user_id', application.artist_id)
            .execute();
        const artist = artistData?.[0] || {};

        // 4. Fetch client details
        const clientData = await pgrest('clients_db')
            .select('*')
            .eq('user_id', request.client_user_id)
            .execute();
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

        try {
            await QuotationsRepo.createFromJobBoard(quotationPayload);
        } catch (err) {
            console.error('[Job Board] Error creating quotation:', err.message);
            throw new Error('Failed to create quotation: ' + err.message);
        }

        console.log(`[Job Board] Created quotation ${quoteId}`);

        // 7. Update accepted application (no-fatal: el quote ya se creo)
        try {
            await JobBoardRepo.acceptApplication(applicationId);
        } catch (e) {
            console.warn('[Job Board] Warning: Could not update application status');
        }

        // 8. Reject all other pending applications (no-fatal)
        try {
            await JobBoardRepo.rejectOtherApplications(requestId, applicationId);
        } catch (e) {
            console.warn('[Job Board] Warning: Could not reject other applications');
        }

        // 9. Update request status (no-fatal)
        try {
            await JobBoardRepo.closeRequestAsAccepted(requestId, {
                artistId: application.artist_id,
                applicationId,
                quoteId
            });
        } catch (e) {
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

    try {
        // 1. Authenticate caller from Bearer token (capa unificada)
        const caller = await resolveBearerUser(req);
        if (!caller) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        // 2. Fetch the quotation by quote_id
        const quotation = await QuotationsRepo.getByQuoteId(quoteId, {
            select: 'id,quote_id,client_user_id,client_email,client_deleted_at'
        });
        if (!quotation) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }

        // 3. Verify ownership: client_user_id matches, or client_email matches
        let isOwner = quotation.client_user_id === caller.id;
        if (!isOwner && accountModes.canClaimByEmail(caller, quotation)) {
            // Link the quotation to this client before hiding
            await QuotationsRepo.claimForClient(quotation.id, caller.id);
            isOwner = true;
        }
        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'You do not own this quotation' });
        }

        if (quotation.client_deleted_at) {
            return res.json({ success: true, quoteId, message: 'Already hidden' });
        }

        // 4. Soft-delete for the client (set client_deleted_at)
        await QuotationsRepo.softDeleteForClient(quotation.id);

        console.log(`[Client Hide] Client ${caller.id} hid quotation ${quoteId}`);
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

    try {
        const caller = await resolveBearerUser(req);
        if (!caller) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const quotation = await QuotationsRepo.getByQuoteId(quoteId, {
            select: 'id,quote_id,quote_status,client_user_id,client_email,dispute_status,client_completed_at'
        });
        if (!quotation) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }

        let isOwner = quotation.client_user_id === caller.id;
        if (!isOwner && accountModes.canClaimByEmail(caller, quotation)) {
            await QuotationsRepo.claimForClient(quotation.id, caller.id);
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
        await QuotationsRepo.markCompletedByClient(quotation.id, caller.id, completedAt);

        console.log(`[Client Complete] Client ${caller.id} completed quotation ${quoteId}`);
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
        await pgrest('service_health_logs', { key: 'anon' }).insert({
            service_name: serviceName,
            status,
            latency_ms: latencyMs,
            error_message: errorMessage || null,
            metadata: metadata || {},
            checked_by: 'server'
        }, { returning: false });
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
                // Test 1: REST API query (anon key, respeta RLS — sondeo).
                try {
                    await pgrest('artists_db', { key: 'anon' }).select('id').limit(1).execute();
                } catch (dbErr) {
                    throw new Error(`DB query failed: HTTP ${dbErr.status || ''}`.trim());
                }
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

                status = storageRes.ok ? 'healthy' : 'degraded';
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
        const data = await pgrest('service_health_logs', { key: 'anon' })
            .select('*')
            .eq('service_name', serviceName)
            .order('checked_at', { ascending: false })
            .limit(limit)
            .execute();
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
// Helper de lectura para los analytics no-cotizacion (users/devices/pages/
// errors/locations/summary). Delega en la capa PostgREST unificada usando la
// anon key explicita de getHealthConfig (mismo contexto de auth que antes).
async function supabaseQuery(cfg, path) {
    const rows = await pgrest.raw(path, { apiKey: cfg.supabaseAnonKey });
    return rows || [];
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
        const userTypes = await AnalyticsRepo.userSessionsByType(cfg, { days, env });

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
        const fingerprints = await AnalyticsRepo.userFingerprints(cfg, { days, env });
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
        const devices = await AnalyticsRepo.devices(cfg, { days, env });

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
        const sessions = await AnalyticsRepo.pageViews(cfg, { days, env });

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
        const errorSessions = await AnalyticsRepo.errorSessions(cfg, { days, env });

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
        const sessions = await AnalyticsRepo.locations(cfg, { days, env });

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
    // FIX (doc §4-A): este analytics expone datos de cotizaciones; ahora exige
    // superadmin y lee con service-role via la capa unificada (antes usaba la
    // anon key sin auth, dependiendo de RLS de anon).
    const auth = await appSettings.verifyAdminCaller(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

    const days = Math.min(parseInt(req.query.days) || 90, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
        const quotes = await QuotationsRepo.fetchAnalyticsSince(since);

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
        const sessions = await AnalyticsRepo.summarySessions(cfg, { days, env });

        const devices = await AnalyticsRepo.summaryDevices(cfg, { days });

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
        let rows;
        try {
            rows = await pgrest('artists_db')
                .eq('user_id', user_id)
                .patch({
                    latitude: lat,
                    longitude: lng,
                    geocoded_address: geocoded_address ? String(geocoded_address).slice(0, 500) : null,
                    geocoded_at: new Date().toISOString()
                });
        } catch (updateErr) {
            console.error('[Geocode] Supabase PATCH failed:', updateErr.status, updateErr.message);
            return res.status(502).json({
                success: false,
                error: `Supabase update failed: HTTP ${updateErr.status || ''}`.trim()
            });
        }

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

function normalizeAnalyticsStyles(rows) {
    const out = [];
    for (const row of rows || []) {
        const value = row && row.tattoo_style;
        let styles = [];
        if (Array.isArray(value)) styles = value;
        else if (typeof value === 'string') {
            try { const parsed = JSON.parse(value); styles = Array.isArray(parsed) ? parsed : [value]; }
            catch (_) { styles = [value]; }
        }
        for (const style of styles) {
            const clean = cleanProfileVisitText(style, 80);
            if (clean && !out.includes(clean)) out.push(clean);
            if (out.length >= 5) return out;
        }
    }
    return out;
}

async function resolveProfileVisitIdentity(visitorUserId, artistUserId) {
    const empty = {
        visitor_user_id: null,
        visitor_display_name: null,
        visitor_type: null,
        visitor_city: null,
        visitor_interests: [],
        requested_quote: false
    };
    if (!visitorUserId || visitorUserId === artistUserId) return empty;

    const [clients, studios, artists, quoteRows] = await Promise.all([
        _supabaseFetch(`clients_db?user_id=eq.${encodeURIComponent(visitorUserId)}&select=full_name,city_residence,country,public_profile_enabled&limit=1`).catch(() => []),
        _supabaseFetch(`studios?user_id=eq.${encodeURIComponent(visitorUserId)}&select=name,city,country&limit=1`).catch(() => []),
        _supabaseFetch(`artists_db?user_id=eq.${encodeURIComponent(visitorUserId)}&select=name,username,city,country&limit=1`).catch(() => []),
        _supabaseFetch(`quotations_db?client_user_id=eq.${encodeURIComponent(visitorUserId)}&artist_id=eq.${encodeURIComponent(artistUserId)}&select=tattoo_style,quote_status&order=created_at.desc&limit=20`).catch(() => [])
    ]);

    const client = Array.isArray(clients) ? clients[0] : null;
    const studio = Array.isArray(studios) ? studios[0] : null;
    const artist = Array.isArray(artists) ? artists[0] : null;
    const quotes = Array.isArray(quoteRows) ? quoteRows : [];

    if (client) {
        const mayIdentify = client.public_profile_enabled !== false;
        return {
            visitor_user_id: visitorUserId,
            visitor_display_name: mayIdentify ? cleanProfileVisitText(client.full_name, 120) : null,
            visitor_type: 'client',
            visitor_city: cleanProfileVisitText(client.city_residence || client.country, 120),
            visitor_interests: normalizeAnalyticsStyles(quotes),
            requested_quote: quotes.length > 0
        };
    }
    if (studio) {
        return {
            visitor_user_id: visitorUserId,
            visitor_display_name: cleanProfileVisitText(studio.name, 120),
            visitor_type: 'studio',
            visitor_city: cleanProfileVisitText(studio.city || studio.country, 120),
            visitor_interests: [],
            requested_quote: false
        };
    }
    if (artist) {
        return {
            visitor_user_id: visitorUserId,
            visitor_display_name: cleanProfileVisitText(artist.name || artist.username, 120),
            visitor_type: 'artist',
            visitor_city: cleanProfileVisitText(artist.city || artist.country, 120),
            visitor_interests: [],
            requested_quote: false
        };
    }
    return { ...empty, visitor_user_id: visitorUserId };
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

async function handleArtistProfileEvent(req, res) {
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
        longitude,
        event_kind,
        artwork_key,
        artwork_title
    } = req.body || {};

    const eventKind = ['profile_view', 'portfolio_view', 'artwork_view'].includes(event_kind)
        ? event_kind
        : 'profile_view';
    if (eventKind === 'artwork_view' && !cleanProfileVisitText(artwork_key, 240)) {
        return res.status(400).json({ success: false, error: 'artwork_key is required for artwork_view' });
    }

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

        let authUser = null;
        try { authUser = await _getAuthUserFromBearer(req); }
        catch (_) { /* public profile events may be anonymous */ }
        if (authUser?.id === artist.user_id) {
            return res.json({ success: true, recorded: false, reason: 'self_visit' });
        }
        const identity = await resolveProfileVisitIdentity(authUser?.id, artist.user_id);

        const ip = getProfileVisitClientIp(req);
        const ipHash = hashProfileVisitIp(ip, serviceKey);

        if (ipHash) {
            const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const duplicateRows = await _supabaseFetch(
                `artist_profile_visits?artist_id=eq.${encodeURIComponent(artist.user_id)}&ip_hash=eq.${encodeURIComponent(ipHash)}&event_kind=eq.${encodeURIComponent(eventKind)}${eventKind === 'artwork_view' ? `&artwork_key=eq.${encodeURIComponent(cleanProfileVisitText(artwork_key, 240))}` : ''}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`
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
            event_kind: eventKind,
            ...identity,
            artwork_key: eventKind === 'artwork_view' ? cleanProfileVisitText(artwork_key, 240) : null,
            artwork_title: eventKind === 'artwork_view' ? cleanProfileVisitText(artwork_title, 160) : null,
            country: countryHeader && countryHeader !== 'XX' ? countryHeader : null,
            city: identity.visitor_city,
            latitude: cleanProfileVisitCoordinate(latitude, -90, 90),
            longitude: cleanProfileVisitCoordinate(longitude, -180, 180),
            device_type: parsedUa.deviceType,
            os: parsedUa.os,
            browser: parsedUa.browser,
            ip_hash: ipHash,
            device_fingerprint: cleanProfileVisitText(device_fingerprint, 200),
            referrer: cleanProfileVisitText(referrer, 500),
            is_authenticated: Boolean(authUser?.id),
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
}

app.post('/api/artist/profile-visit', handleArtistProfileEvent);
app.post('/api/artist/profile-event', handleArtistProfileEvent);

/**
 * GET /api/artist/public-profile-metrics?artist=<username>
 *
 * Public, aggregate-only projection for the Figma profile stat strip. Raw
 * quotations remain behind the service-role boundary; the response contains
 * counts and rounded timing buckets only.
 */
app.get('/api/artist/public-profile-metrics', async (req, res) => {
    const { supabaseUrl, serviceKey } = _supabaseConfigForSupport();
    if (!supabaseUrl || !serviceKey) {
        return res.status(503).json({ success: false, error: 'Profile metrics are unavailable' });
    }

    const requestedArtist = cleanProfileVisitText(req.query.artist, 120);
    if (!requestedArtist) {
        return res.status(400).json({ success: false, error: 'artist is required' });
    }

    try {
        const artist = await lookupProfileVisitArtist({ username: requestedArtist });
        if (!artist?.user_id) {
            return res.status(404).json({ success: false, error: 'Artist not found' });
        }

        const quoteRows = await _supabaseFetch(
            `quotations_db?artist_id=eq.${encodeURIComponent(artist.user_id)}`
            + '&select=quote_status,sent_to_artist_at,artist_responded_at'
        );
        const metrics = summarizeArtistPublicProfileMetrics(quoteRows);

        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
        return res.json({ success: true, metrics });
    } catch (error) {
        console.error('[PublicProfileMetrics] Error:', error.message);
        return res.status(502).json({ success: false, error: 'Could not load profile metrics' });
    }
});

// ============================================
// PLATAFORMA DE ESTUDIOS + SUPPLIES: AVISOS POR EMAIL
// ============================================
// Tres endpoints con el mismo contrato (docs/plans/2026-10-30-estudios-plataforma.md
// §Servidor):
//   POST /api/studio/notify         dueño del estudio o soporte
//   POST /api/artist/studio-notify  el artista de la fila
//   POST /api/supplies/notify       dueño del estudio o del vendor (o soporte)
// Body { kind, <id> } -> { success, sent, delivery_status }.
//   1. Bearer obligatorio (401) antes de leer nada.
//   2. La fila se lee en el servidor y se verifican la pertenencia del caller y
//      el ESTADO PERSISTIDO que corresponde al kind (409 si no coincide).
//   3. El destinatario es SIEMPRE el email de auth.users del dueño (estudio o
//      vendor) o del artista. Nunca studios.email, contact_email ni
//      client_email. Sin dueño no se envía nada (sent:false, 'no_recipient').
//   4. Idempotencia `${kind}:${id}:${estado}` en el ledger de entregas.
//   5. Si el envío falla, la acción ya guardada NO se revierte.

// 60 avisos cada 15 min por usuario autenticado (fallback IP), en los 3
// endpoints. El Bearer se resuelve una vez por request (_getAuthUserFromBearer
// memoiza), asi que el handler no paga una segunda consulta a Auth.
async function _studioNotifyRateLimitKey(req) {
    let authUser = null;
    try { authUser = await _getAuthUserFromBearer(req); } catch (_) { authUser = null; }
    if (authUser && authUser.id) return `user:${authUser.id}`;
    return `ip:${rateLimit.ipKeyGenerator(req.ip || '')}`;
}

const studioNotifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: _studioNotifyRateLimitKey,
    message: { success: false, error: 'Demasiados avisos seguidos. Probá de nuevo en unos minutos.' }
});

const STUDIO_NOTIFY_KINDS = [
    'spot_decision', 'roster_invite', 'membership_request_decision',
    'contract_issued', 'contract_terminated', 'booking_created', 'booking_cancelled'
];
const ARTIST_STUDIO_NOTIFY_KINDS = ['membership_request_created', 'contract_signed', 'contract_declined', 'contract_terminated'];
// kind -> estado persistido del pedido que habilita el aviso.
const SUPPLY_NOTIFY_STATUS = {
    order_submitted: 'submitted',
    order_cancelled: 'cancelled',
    order_received: 'received',
    order_confirmed: 'confirmed',
    order_rejected: 'rejected',
    order_shipped: 'shipped',
    order_delivered: 'delivered'
};
// Quien dispara cada kind. order_cancelled puede venir de cualquiera de los dos
// lados (cancel_supply_order del estudio o 'cancel' del vendor): el lado sale
// del evento guardado y el aviso va a la contraparte.
const SUPPLY_STUDIO_SIDE_KINDS = new Set(['order_submitted', 'order_cancelled', 'order_received']);
const SUPPLY_VENDOR_SIDE_KINDS = new Set(['order_confirmed', 'order_rejected', 'order_shipped', 'order_delivered', 'order_cancelled']);

const NOTIFY_TIMEZONE = process.env.STUDIO_NOTIFY_TIMEZONE || 'America/Argentina/Buenos_Aires';
const NOTIFY_MIGRATION_PENDING = 'Esta función todavía no está disponible (falta aplicar una migración).';
const NOTIFY_SAVED_BUT_UNCONFIRMED = 'El cambio quedó guardado, pero no se pudo confirmar el correo.';

// Texto que viene de datos de usuario (nombres, motivos, notas) dentro del
// cuerpo del correo: sin caracteres de control ni < >, recortado.
function _notifyText(value, max = 160) {
    return String(value == null ? '' : value)
        .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function _notifyGreeting(name) {
    const clean = _notifyText(name, 80);
    return `Hola${clean ? ' ' + clean : ''},\n\n`;
}

function _notifyDateTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    try {
        return new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeStyle: 'short', timeZone: NOTIFY_TIMEZONE }).format(date);
    } catch (_) {
        return date.toISOString();
    }
}

function _notifyDate(value) {
    if (!value) return '';
    const text = String(value);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const date = new Date(dateOnly ? `${text}T12:00:00Z` : text);
    if (Number.isNaN(date.getTime())) return '';
    try {
        return new Intl.DateTimeFormat('es-AR', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: dateOnly ? 'UTC' : NOTIFY_TIMEZONE
        }).format(date);
    } catch (_) {
        return text.slice(0, 10);
    }
}

// Montos siempre con su moneda ("12.345,50 ARS"): nunca se mezclan monedas.
function _notifyMoney(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '';
    const code = /^[A-Z]{3}$/.test(String(currency || '')) ? String(currency) : '';
    let formatted;
    try {
        formatted = new Intl.NumberFormat('es-AR', {
            minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
            maximumFractionDigits: 2
        }).format(n);
    } catch (_) {
        formatted = n.toFixed(2);
    }
    return code ? `${formatted} ${code}` : formatted;
}

function _notifyRespond(res, result, extra = {}) {
    const ok = Boolean(result && result.ok);
    return res.status(ok ? 200 : 502).json({
        success: ok,
        sent: ok,
        delivery_status: (result && result.delivery_status)
            || (ok ? 'accepted' : (result && result.uncertain ? 'uncertain' : 'failed')),
        deduplicated: result ? result.deduplicated : undefined,
        uncertain: result ? result.uncertain : undefined,
        error: ok ? undefined : (result && result.error) || NOTIFY_SAVED_BUT_UNCONFIRMED,
        ...extra
    });
}

// Nada que enviar (estudio/vendor sin dueño, usuario sin email): la acción
// guardada queda y la respuesta lo dice sin simular un envío.
function _notifyNoRecipient(res, reason, extra = {}) {
    return res.status(200).json({ success: true, sent: false, delivery_status: 'no_recipient', reason, ...extra });
}

function _notifyLoadFailure(res, err, label) {
    if (isMissingSchemaError(err)) {
        return res.status(503).json({ success: false, sent: false, migration_pending: true, error: NOTIFY_MIGRATION_PENDING });
    }
    console.error(`[StudioNotify] could not load ${label}:`, err.message);
    return res.status(503).json({ success: false, sent: false, error: NOTIFY_SAVED_BUT_UNCONFIRMED });
}

// Envía un aviso con la plantilla 'studio-notification'. `recipient` viene de
// StudiosRepo/SuppliesRepo (email de auth.users), nunca del body del caller.
function _sendStudioPlatformEmail({ eventId, recipient, fromName, subject, bodyText, ctaUrl, meta, idempotencyKey }) {
    return emailService.sendEmail(eventId, {
        to: recipient.email,
        recipient_email: recipient.email,
        recipient_name: _notifyText(recipient.name, 120),
        studio_name: _notifyText(fromName, 120) || 'We Ötzi',
        subject: _notifyText(subject, 200),
        body_text: bodyText,
        dashboard_url: ctaUrl,
        meta: meta || {}
    }, { idempotencyKey });
}

// Aviso al dueño del estudio de una solicitud de alta (`requested`). Lo usan
// /api/artist/studio-notify y el registro de artista. Sin dueño: nada.
async function _notifyMembershipRequestCreated(req, membership) {
    const owner = await StudiosRepo.getStudioOwnerContact(membership.studio_id);
    if (!owner) return { skipped: true, reason: 'studio_without_owner' };
    const studio = membership.studios || {};
    const artist = membership.artists_db || {};
    const base = applicationBase(req);
    const studioName = _notifyText(studio.name || owner.studio_name, 120) || 'tu estudio';
    const artistName = _notifyText(artist.name || artist.username, 120) || 'Un artista';
    const handle = artist.username ? ` (@${_notifyText(artist.username, 60)})` : '';
    const ctaUrl = `${base}/studio/dashboard#solicitudes`;
    const result = await _sendStudioPlatformEmail({
        eventId: 'studio_membership_request_created',
        recipient: owner,
        fromName: studioName,
        subject: `${artistName} quiere sumarse a ${studioName}`,
        bodyText: `${_notifyGreeting(owner.name)}${artistName}${handle} pidió sumarse a ${studioName} como ${roleFromKind(membership.role)}.\n\n`
            + `Revisá la solicitud y aprobala o rechazala en ${ctaUrl}.`,
        ctaUrl,
        meta: { membership_id: membership.id, studio_id: membership.studio_id, artist_user_id: membership.artist_user_id },
        idempotencyKey: `membership_request_created:${membership.studio_id}:${membership.artist_user_id}:${new Date().toISOString().slice(0, 10)}`
    });
    return { skipped: false, result };
}

/**
 * POST /api/studio/notify
 *
 * Avisos que dispara el estudio (dueño) o soporte.
 *
 * Body: { kind, application_id?, membership_id?, contract_id?, booking_id?, decision? }
 *   spot_decision                     { application_id, decision }  -> artista
 *   roster_invite                     { membership_id }             -> artista
 *   membership_request_decision       { membership_id }             -> artista
 *   contract_issued | contract_terminated   { contract_id }         -> artista
 *   booking_created | booking_cancelled     { booking_id }          -> SOLO el artista (nunca client_email)
 *
 * Cada kind llama a _verifyStudioNotifyAccess y verifica el estado guardado.
 */
app.post('/api/studio/notify', studioNotifyLimiter, async (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Server misconfigured: missing SUPABASE creds.' });
    }

    const { kind, application_id, membership_id, contract_id, booking_id, decision } = req.body || {};
    if (!kind || !STUDIO_NOTIFY_KINDS.includes(kind)) {
        return res.status(400).json({ success: false, error: `kind invalido (esperado: ${STUDIO_NOTIFY_KINDS.join(' | ')})` });
    }
    if (kind === 'spot_decision' && !['accepted', 'rejected'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'decision invalida (esperado: accepted | rejected)' });
    }

    try {
        const authUser = await _getAuthUserFromBearer(req);
        if (!authUser?.id) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        let payload = null;
        const mailBase = applicationBase(req);
        const invitationsUrl = `${mailBase}/artist/invitations`;

        if (kind === 'spot_decision') {
            if (!UUID_RE.test(String(application_id || ''))) {
                return res.status(400).json({ success: false, error: 'application_id y decision son requeridos.' });
            }
            let app;
            try {
                app = await StudiosRepo.getSpotApplicationWithParties(application_id);
            } catch (loadErr) {
                return _notifyLoadFailure(res, loadErr, 'application');
            }
            if (!app) return res.status(404).json({ success: false, error: 'Application not found.' });

            const spot = app.studio_spots || {};
            const studio = spot.studios || {};
            const access = await _verifyStudioNotifyAccess(req, studio, authUser);
            if (!access.ok) {
                return res.status(access.status).json({ success: false, error: access.error });
            }
            // Con contratos, "aceptar" deja la postulación en `shortlisted` hasta
            // que el artista firma; sin la migración queda `accepted`.
            const persisted = decision === 'accepted'
                ? ['accepted', 'shortlisted'].includes(app.status)
                : app.status === 'rejected';
            if (!persisted) {
                return res.status(409).json({ success: false, sent: false, error: 'La decisión no coincide con la postulación guardada.' });
            }

            const artist = await StudiosRepo.getArtistContact(app.artist_user_id);
            if (!artist) return _notifyNoRecipient(res, 'artist_without_email');
            const studioName = _notifyText(studio.name, 120) || 'El estudio';
            const spotTitle = _notifyText(spot.title, 160);
            payload = {
                eventId: 'studio_spot_decision',
                recipient: artist,
                fromName: studioName,
                subject: decision === 'accepted'
                    ? `Tu postulación a ${studioName} avanzó`
                    : `Actualización de tu postulación a ${studioName}`,
                bodyText: decision === 'accepted'
                    ? `${_notifyGreeting(artist.name)}${studioName} eligió tu postulación al spot "${spotTitle}" como ${roleFromKind(spot.kind)}.\n\n`
                        + `Tu postulación avanzó; el estudio te va a enviar el contrato para firmar en ${invitationsUrl}.`
                    : `${_notifyGreeting(artist.name)}Gracias por postularte al spot "${spotTitle}" en ${studioName}. En esta oportunidad eligieron a otro artista, pero seguí atento al directorio para nuevas oportunidades: ${mailBase}/studio-spots`,
                ctaUrl: invitationsUrl,
                meta: { application_id: app.id, artist_user_id: app.artist_user_id, studio_id: studio.id, spot_id: spot.id, spot_kind: spot.kind },
                idempotencyKey: `spot_decision:${app.id}:${app.status}`
            };
        }

        if (kind === 'roster_invite') {
            if (!UUID_RE.test(String(membership_id || ''))) {
                return res.status(400).json({ success: false, error: 'membership_id requerido.' });
            }
            let m;
            try {
                m = await StudiosRepo.getMembershipWithParties(membership_id);
            } catch (loadErr) {
                return _notifyLoadFailure(res, loadErr, 'membership');
            }
            if (!m) return res.status(404).json({ success: false, error: 'Membership not found.' });

            const studio = m.studios || {};
            const access = await _verifyStudioNotifyAccess(req, studio, authUser);
            if (!access.ok) {
                return res.status(access.status).json({ success: false, error: access.error });
            }
            // `initiated_by` ausente (migración sin aplicar) equivale a 'studio'.
            if (!['pending_invite', 'pending_acceptance'].includes(m.status) || (m.initiated_by || 'studio') !== 'studio') {
                return res.status(409).json({ success: false, sent: false, error: 'La invitación ya no está pendiente.' });
            }

            const artist = await StudiosRepo.getArtistContact(m.artist_user_id);
            if (!artist) return _notifyNoRecipient(res, 'artist_without_email');
            const studioName = _notifyText(studio.name, 120) || 'Un estudio';
            payload = {
                eventId: 'studio_roster_invite',
                recipient: artist,
                fromName: studioName,
                subject: `${studioName} te invitó a su roster`,
                bodyText: `${_notifyGreeting(artist.name)}${studioName} te invitó como ${roleFromKind(m.role)} a su roster en We Ötzi.\n\n`
                    + `Para aceptar o rechazar la invitación, ingresá a ${invitationsUrl}.`,
                ctaUrl: invitationsUrl,
                meta: { membership_id: m.id, artist_user_id: m.artist_user_id, studio_id: studio.id, role: m.role },
                idempotencyKey: `roster_invite:${m.id}:${m.status}`
            };
        }

        if (kind === 'membership_request_decision') {
            if (!UUID_RE.test(String(membership_id || ''))) {
                return res.status(400).json({ success: false, error: 'membership_id requerido.' });
            }
            let m;
            try {
                m = await StudiosRepo.getMembershipWithParties(membership_id);
            } catch (loadErr) {
                return _notifyLoadFailure(res, loadErr, 'membership');
            }
            if (!m) return res.status(404).json({ success: false, error: 'Membership not found.' });

            const studio = m.studios || {};
            const access = await _verifyStudioNotifyAccess(req, studio, authUser);
            if (!access.ok) {
                return res.status(access.status).json({ success: false, error: access.error });
            }
            if ((m.initiated_by || 'studio') !== 'artist') {
                return res.status(409).json({ success: false, sent: false, error: 'Esta membresía no es una solicitud del artista.' });
            }
            if (!['active', 'rejected'].includes(m.status)) {
                return res.status(409).json({ success: false, sent: false, error: 'La solicitud todavía no tiene una respuesta guardada.' });
            }

            const artist = await StudiosRepo.getArtistContact(m.artist_user_id);
            if (!artist) return _notifyNoRecipient(res, 'artist_without_email');
            const studioName = _notifyText(studio.name, 120) || 'El estudio';
            const approved = m.status === 'active';
            payload = {
                eventId: 'studio_membership_request_decision',
                recipient: artist,
                fromName: studioName,
                subject: approved ? `${studioName} aprobó tu solicitud` : `${studioName} no aprobó tu solicitud`,
                bodyText: approved
                    ? `${_notifyGreeting(artist.name)}${studioName} aprobó tu solicitud: ya figurás en su equipo como ${roleFromKind(m.role)}.\n\nVas a ver el vínculo en ${invitationsUrl}.`
                    : `${_notifyGreeting(artist.name)}${studioName} no aprobó tu solicitud en esta oportunidad.\n\nSeguí explorando estudios y spots en ${mailBase}/studio-spots.`,
                ctaUrl: invitationsUrl,
                meta: { membership_id: m.id, artist_user_id: m.artist_user_id, studio_id: studio.id, status: m.status },
                idempotencyKey: `membership_request_decision:${m.id}:${m.status}`
            };
        }

        if (kind === 'contract_issued' || kind === 'contract_terminated') {
            if (!UUID_RE.test(String(contract_id || ''))) {
                return res.status(400).json({ success: false, error: 'contract_id requerido.' });
            }
            let c;
            try {
                c = await StudiosRepo.getContractWithParties(contract_id);
            } catch (loadErr) {
                return _notifyLoadFailure(res, loadErr, 'contract');
            }
            if (!c) return res.status(404).json({ success: false, error: 'Contrato no encontrado.' });

            const studio = c.studios || {};
            const access = await _verifyStudioNotifyAccess(req, studio, authUser);
            if (!access.ok) {
                return res.status(access.status).json({ success: false, error: access.error });
            }
            const issued = kind === 'contract_issued';
            // Rescisión del lado del estudio: si la hizo el artista, el aviso
            // va al estudio por /api/artist/studio-notify.
            const persisted = issued
                ? c.status === 'sent'
                : c.status === 'terminated' && String(c.terminated_by || '') !== String(c.artist_user_id || '');
            if (!persisted) {
                return res.status(409).json({ success: false, sent: false, error: 'El estado del contrato cambió. No se envió el aviso.' });
            }

            const artist = c.artist_user_id ? await StudiosRepo.getArtistContact(c.artist_user_id) : null;
            if (!artist) return _notifyNoRecipient(res, 'artist_without_email');
            const studioName = _notifyText(studio.name, 120) || 'El estudio';
            const number = _notifyText(c.contract_number, 40);
            const contractUrl = `${invitationsUrl}?contrato=${encodeURIComponent(c.id)}`;
            const expires = _notifyDate(c.expires_at);
            const reason = _notifyText(c.termination_reason, 300);
            payload = {
                eventId: issued ? 'studio_contract_issued' : 'studio_contract_terminated',
                recipient: artist,
                fromName: studioName,
                subject: issued ? `${studioName} te envió un contrato para firmar` : `Tu contrato con ${studioName} terminó`,
                bodyText: issued
                    ? `${_notifyGreeting(artist.name)}${studioName} te envió el contrato ${number} (versión ${Number(c.version) || 1}) como ${roleFromKind(c.role)}.\n\n`
                        + `Revisalo y firmalo${expires ? ` antes del ${expires}` : ''} en ${contractUrl}.`
                    : `${_notifyGreeting(artist.name)}${studioName} rescindió el contrato ${number}.${reason ? ` Motivo: ${reason}.` : ''}\n\n`
                        + `El historial queda en ${invitationsUrl}.`,
                ctaUrl: issued ? contractUrl : invitationsUrl,
                meta: { contract_id: c.id, membership_id: c.membership_id || null, artist_user_id: c.artist_user_id, studio_id: studio.id, status: c.status },
                idempotencyKey: `${kind}:${c.id}:${c.status}`
            };
        }

        if (kind === 'booking_created' || kind === 'booking_cancelled') {
            if (!UUID_RE.test(String(booking_id || ''))) {
                return res.status(400).json({ success: false, error: 'booking_id requerido.' });
            }
            let b;
            try {
                b = await StudiosRepo.getBookingWithParties(booking_id);
            } catch (loadErr) {
                return _notifyLoadFailure(res, loadErr, 'booking');
            }
            if (!b) return res.status(404).json({ success: false, error: 'Cita no encontrada.' });

            const studio = b.studios || {};
            const access = await _verifyStudioNotifyAccess(req, studio, authUser);
            if (!access.ok) {
                return res.status(access.status).json({ success: false, error: access.error });
            }
            const created = kind === 'booking_created';
            if (b.status !== (created ? 'confirmed' : 'cancelled')) {
                return res.status(409).json({ success: false, sent: false, error: 'El estado de la cita cambió. No se envió el aviso.' });
            }

            // El aviso de agenda va SOLO al artista: el estudio gestiona al cliente.
            const artist = await StudiosRepo.getArtistContact(b.artist_user_id);
            if (!artist) return _notifyNoRecipient(res, 'artist_without_email');
            const studioName = _notifyText(studio.name, 120) || 'El estudio';
            const when = _notifyDateTime(b.starts_at);
            const location = b.studio_locations || {};
            const place = _notifyText(location.label || location.city, 120);
            const client = _notifyText(b.client_name, 120);
            const calendarUrl = `${mailBase}/calendar`;
            payload = {
                eventId: created ? 'studio_booking_created' : 'studio_booking_cancelled',
                recipient: artist,
                fromName: studioName,
                subject: created ? `${studioName} te agendó una cita` : `${studioName} canceló una cita`,
                bodyText: `${_notifyGreeting(artist.name)}${studioName} ${created ? 'te agendó una cita' : 'canceló la cita'}`
                    + `${when ? (created ? ` para el ${when}` : ` del ${when}`) : ''}${place ? ` en ${place}` : ''}${client ? ` (cliente: ${client})` : ''}.\n\n`
                    + `${created ? 'La ves en tu calendario' : 'Tu calendario ya está actualizado'}: ${calendarUrl}.`,
                ctaUrl: calendarUrl,
                meta: { booking_id: b.id, artist_user_id: b.artist_user_id, studio_id: studio.id, status: b.status },
                idempotencyKey: `${kind}:${b.id}:${b.status}`
            };
        }

        const result = await _sendStudioPlatformEmail(payload);
        return _notifyRespond(res, result, { payload_kind: payload.eventId });
    } catch (err) {
        console.error('[StudioNotify] notification failed:', err.message);
        return res.status(503).json({ success: false, sent: false, error: NOTIFY_SAVED_BUT_UNCONFIRMED });
    }
});

function roleFromKind(kindOrRole) {
    const map = {
        resident: 'residente', itinerant: 'itinerante', guest: 'guest',
        guest_spot: 'guest', manager: 'manager'
    };
    return map[kindOrRole] || (kindOrRole || 'miembro');
}

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

/**
 * POST /api/artist/studio-notify
 *
 * Avisos que dispara el artista de la fila; el destinatario es el dueño del
 * estudio (email de auth.users). Si el estudio no tiene dueño, no se envía.
 *
 * Body: { kind, membership_id?, contract_id? }
 *   membership_request_created                          { membership_id }
 *   contract_signed | contract_declined | contract_terminated   { contract_id }
 */
app.post('/api/artist/studio-notify', studioNotifyLimiter, async (req, res) => {
    const { kind, membership_id, contract_id } = req.body || {};
    if (!kind || !ARTIST_STUDIO_NOTIFY_KINDS.includes(kind)) {
        return res.status(400).json({ success: false, error: `kind invalido (esperado: ${ARTIST_STUDIO_NOTIFY_KINDS.join(' | ')})` });
    }

    try {
        const authUser = await _getAuthUserFromBearer(req);
        if (!authUser?.id) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        if (kind === 'membership_request_created') {
            if (!UUID_RE.test(String(membership_id || ''))) {
                return res.status(400).json({ success: false, error: 'membership_id requerido.' });
            }
            let m;
            try {
                m = await StudiosRepo.getMembershipWithParties(membership_id);
            } catch (loadErr) {
                return _notifyLoadFailure(res, loadErr, 'membership');
            }
            if (!m) return res.status(404).json({ success: false, error: 'Solicitud no encontrada.' });
            if (String(m.artist_user_id || '') !== String(authUser.id)) {
                return res.status(403).json({ success: false, error: 'Esta solicitud no corresponde a tu cuenta.' });
            }
            if (m.status !== 'requested' || (m.initiated_by || 'studio') !== 'artist') {
                return res.status(409).json({ success: false, sent: false, error: 'La solicitud ya no está pendiente.' });
            }
            const outcome = await _notifyMembershipRequestCreated(req, m);
            if (outcome.skipped) return _notifyNoRecipient(res, outcome.reason, { studio_has_owner: false });
            return _notifyRespond(res, outcome.result, { payload_kind: 'studio_membership_request_created', studio_has_owner: true });
        }

        if (!UUID_RE.test(String(contract_id || ''))) {
            return res.status(400).json({ success: false, error: 'contract_id requerido.' });
        }
        let c;
        try {
            c = await StudiosRepo.getContractWithParties(contract_id);
        } catch (loadErr) {
            return _notifyLoadFailure(res, loadErr, 'contract');
        }
        if (!c) return res.status(404).json({ success: false, error: 'Contrato no encontrado.' });
        if (String(c.artist_user_id || '') !== String(authUser.id)) {
            return res.status(403).json({ success: false, error: 'Este contrato no corresponde a tu cuenta.' });
        }
        const expectedStatus = { contract_signed: 'signed', contract_declined: 'declined', contract_terminated: 'terminated' }[kind];
        const persisted = c.status === expectedStatus
            && (kind !== 'contract_terminated' || String(c.terminated_by || '') === String(authUser.id));
        if (!persisted) {
            return res.status(409).json({ success: false, sent: false, error: 'El estado del contrato cambió. No se envió el aviso.' });
        }

        const owner = await StudiosRepo.getStudioOwnerContact(c.studio_id);
        if (!owner) return _notifyNoRecipient(res, 'studio_without_owner', { studio_has_owner: false });

        const studio = c.studios || {};
        const artistRow = c.artists_db || {};
        const mailBase = applicationBase(req);
        const studioName = _notifyText(studio.name || owner.studio_name, 120) || 'tu estudio';
        const artistName = _notifyText(artistRow.name || artistRow.username, 120) || 'El artista';
        const number = _notifyText(c.contract_number, 40);
        const contractsUrl = `${mailBase}/studio/dashboard#contratos`;
        const declineReason = _notifyText(c.decline_reason, 300);
        const terminationReason = _notifyText(c.termination_reason, 300);
        const copy = {
            contract_signed: {
                eventId: 'studio_contract_signed',
                subject: `${artistName} firmó el contrato ${number}`,
                body: `${artistName} firmó el contrato ${number} y ya forma parte de ${studioName} como ${roleFromKind(c.role)}.`
            },
            contract_declined: {
                eventId: 'studio_contract_declined',
                subject: `${artistName} rechazó el contrato ${number}`,
                body: `${artistName} rechazó el contrato ${number}.${declineReason ? ` Motivo: ${declineReason}.` : ''} Podés preparar una nueva versión desde el panel.`
            },
            contract_terminated: {
                eventId: 'studio_contract_terminated',
                subject: `${artistName} rescindió el contrato ${number}`,
                body: `${artistName} rescindió el contrato ${number} con ${studioName}.${terminationReason ? ` Motivo: ${terminationReason}.` : ''}`
            }
        }[kind];

        const result = await _sendStudioPlatformEmail({
            eventId: copy.eventId,
            recipient: owner,
            fromName: studioName,
            subject: copy.subject,
            bodyText: `${_notifyGreeting(owner.name)}${copy.body}\n\nLo ves en ${contractsUrl}.`,
            ctaUrl: contractsUrl,
            meta: { contract_id: c.id, membership_id: c.membership_id || null, artist_user_id: c.artist_user_id, studio_id: c.studio_id, status: c.status },
            idempotencyKey: `${kind}:${c.id}:${c.status}`
        });
        return _notifyRespond(res, result, { payload_kind: copy.eventId, studio_has_owner: true });
    } catch (err) {
        console.error('[ArtistStudioNotify] notification failed:', err.message);
        return res.status(503).json({ success: false, sent: false, error: NOTIFY_SAVED_BUT_UNCONFIRMED });
    }
});

/**
 * POST /api/supplies/notify
 *
 * Avisos de pedidos de reposición a usuarios Supplies.
 *
 * Body: { kind, order_id }
 *   dueño del estudio:  order_submitted | order_cancelled | order_received  -> dueño del vendor
 *   dueño del vendor:   order_confirmed | order_rejected | order_shipped | order_delivered
 *                       (y order_cancelled cuando cancela el vendor)        -> dueño del estudio
 * Soporte puede disparar cualquiera de los dos lados. Los destinatarios son
 * siempre emails de auth.users (nunca supply_vendors.contact_email).
 */
app.post('/api/supplies/notify', studioNotifyLimiter, async (req, res) => {
    const { kind, order_id } = req.body || {};
    if (!kind || !Object.prototype.hasOwnProperty.call(SUPPLY_NOTIFY_STATUS, kind)) {
        return res.status(400).json({ success: false, error: `kind invalido (esperado: ${Object.keys(SUPPLY_NOTIFY_STATUS).join(' | ')})` });
    }
    if (!UUID_RE.test(String(order_id || ''))) {
        return res.status(400).json({ success: false, error: 'order_id requerido.' });
    }

    try {
        const authUser = await _getAuthUserFromBearer(req);
        if (!authUser?.id) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        let order;
        try {
            order = await SuppliesRepo.getOrderWithParties(order_id);
        } catch (loadErr) {
            return _notifyLoadFailure(res, loadErr, 'supply order');
        }
        if (!order) return res.status(404).json({ success: false, error: 'Pedido no encontrado.' });

        const studio = order.studios || {};
        const vendor = order.supply_vendors || {};
        const isStudioOwner = Boolean(studio.user_id) && String(studio.user_id) === String(authUser.id);
        const isVendorOwner = Boolean(vendor.user_id) && String(vendor.user_id) === String(authUser.id);
        let isSupport = false;
        if (!isStudioOwner && !isVendorOwner) {
            const agent = await _getActiveSupportAgent(req);
            if (agent.ok) isSupport = true;
            else if (agent.status && agent.status >= 500) {
                return res.status(agent.status).json({ success: false, error: agent.error || 'Could not verify access' });
            }
        }

        // Lado que dispara el aviso (el destinatario es la contraparte).
        let side;
        if (SUPPLY_STUDIO_SIDE_KINDS.has(kind) && !SUPPLY_VENDOR_SIDE_KINDS.has(kind)) side = 'studio';
        else if (SUPPLY_VENDOR_SIDE_KINDS.has(kind) && !SUPPLY_STUDIO_SIDE_KINDS.has(kind)) side = 'vendor';
        else {
            let cancelEvent = null;
            try { cancelEvent = await SuppliesRepo.getLatestOrderEvent(order.id, 'cancelled'); } catch (_) { cancelEvent = null; }
            if (cancelEvent && ['studio', 'vendor'].includes(cancelEvent.actor_role)) side = cancelEvent.actor_role;
            else side = isVendorOwner && !isStudioOwner ? 'vendor' : 'studio';
        }

        const allowed = isSupport || (side === 'studio' ? isStudioOwner : isVendorOwner);
        if (!allowed) {
            return res.status(403).json({
                success: false,
                error: side === 'studio' ? 'Este pedido no corresponde a tu estudio.' : 'Este pedido no corresponde a tu cuenta de Supplies.'
            });
        }
        if (order.status !== SUPPLY_NOTIFY_STATUS[kind]) {
            return res.status(409).json({ success: false, sent: false, error: 'El estado del pedido cambió. No se envió el aviso.' });
        }

        const recipient = side === 'studio'
            ? await SuppliesRepo.getVendorOwnerContact(order.vendor_id)
            : await StudiosRepo.getStudioOwnerContact(order.studio_id);
        if (!recipient) return _notifyNoRecipient(res, side === 'studio' ? 'vendor_without_owner' : 'studio_without_owner');

        const mailBase = applicationBase(req);
        const studioUrl = `${mailBase}/studio/dashboard#reposicion`;
        // Deep link: el panel de Supplies abre el drawer del pedido desde ?pedido=<uuid>.
        const vendorUrl = `${mailBase}/supplies/dashboard?pedido=${encodeURIComponent(order.id)}`;
        const studioName = _notifyText(studio.name, 120) || 'El estudio';
        const vendorName = _notifyText(vendor.name, 120) || 'El proveedor';
        const number = _notifyText(order.order_number, 40);
        const total = _notifyMoney(order.total, order.currency);
        const shipping = _notifyMoney(order.shipping_amount || 0, order.currency);
        const itemCount = Array.isArray(order.supply_order_items) ? order.supply_order_items.length : 0;
        const vendorNote = _notifyText(order.vendor_note, 300);
        const tracking = _notifyText(order.tracking_code, 120);
        const eta = _notifyDate(order.estimated_delivery);

        let subject;
        let body;
        if (kind === 'order_submitted') {
            subject = `Nuevo pedido ${number} de ${studioName}`;
            body = `${studioName} te envió el pedido ${number} (${itemCount} ${itemCount === 1 ? 'producto' : 'productos'}) por ${total}.\n\n`
                + `Confirmalo o rechazalo desde ${vendorUrl}.`;
        } else if (kind === 'order_cancelled' && side === 'studio') {
            subject = `${studioName} canceló el pedido ${number}`;
            body = `${studioName} canceló el pedido ${number}. Si ya lo habías confirmado, el stock reservado vuelve a tu catálogo.\n\nLo ves en ${vendorUrl}.`;
        } else if (kind === 'order_cancelled') {
            subject = `${vendorName} canceló tu pedido ${number}`;
            body = `${vendorName} canceló el pedido ${number}.${vendorNote ? ` Nota del proveedor: ${vendorNote}.` : ''}\n\nLo ves en ${studioUrl}.`;
        } else if (kind === 'order_received') {
            subject = `${studioName} recibió el pedido ${number}`;
            body = `${studioName} confirmó la recepción del pedido ${number}.\n\nEl detalle queda en ${vendorUrl}.`;
        } else if (kind === 'order_confirmed') {
            subject = `${vendorName} confirmó tu pedido ${number}`;
            body = `${vendorName} confirmó el pedido ${number}. Total actualizado por el proveedor: ${total} (envío ${shipping}).`
                + `${eta ? ` Entrega estimada: ${eta}.` : ''}\n\nSeguilo en ${studioUrl}.`;
        } else if (kind === 'order_rejected') {
            subject = `${vendorName} rechazó tu pedido ${number}`;
            body = `${vendorName} rechazó el pedido ${number}.${vendorNote ? ` Nota del proveedor: ${vendorNote}.` : ''}\n\nPodés armar otro pedido desde ${studioUrl}.`;
        } else if (kind === 'order_shipped') {
            subject = `${vendorName} despachó tu pedido ${number}`;
            body = `${vendorName} despachó el pedido ${number}.${tracking ? ` Código de seguimiento: ${tracking}.` : ''}`
                + `${eta ? ` Entrega estimada: ${eta}.` : ''}\n\nSeguilo en ${studioUrl}.`;
        } else {
            subject = `${vendorName} entregó tu pedido ${number}`;
            body = `${vendorName} marcó el pedido ${number} como entregado.\n\n`
                + `Confirmá la recepción en ${studioUrl} para sumar el stock al inventario y registrar el gasto.`;
        }

        const eventId = kind === 'order_submitted' ? 'supply_order_submitted' : 'supply_order_status';
        const result = await _sendStudioPlatformEmail({
            eventId,
            recipient,
            fromName: side === 'studio' ? studioName : vendorName,
            subject,
            bodyText: `${_notifyGreeting(recipient.name)}${body}`,
            ctaUrl: side === 'studio' ? vendorUrl : studioUrl,
            meta: { order_id: order.id, order_number: order.order_number, studio_id: order.studio_id, vendor_id: order.vendor_id, status: order.status },
            idempotencyKey: `${kind}:${order.id}:${order.status}`
        });
        return _notifyRespond(res, result, { payload_kind: eventId });
    } catch (err) {
        console.error('[SuppliesNotify] notification failed:', err.message);
        return res.status(503).json({ success: false, sent: false, error: NOTIFY_SAVED_BUT_UNCONFIRMED });
    }
});

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
        const list = await CurrenciesRepo.listActive();
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
        const data = await CurrenciesRepo.upsertRates(rows, { returning: true });
        upserted = Array.isArray(data) ? data.length : rows.length;
        if (skipped.length) status = 'partial';
    } catch (err) {
        errorMessage = `Supabase upsert failed: ${err.message}`;
        status = 'error';
    }

    // Audit log (best-effort)
    try {
        await CurrenciesRepo.logRefresh({
            source,
            currencies_updated: upserted,
            status,
            error_message: errorMessage,
            raw_payload: { count_in: rates.length, count_skipped: skipped.length }
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

        try {
            await CurrenciesRepo.upsertRates(rows, { returning: false });
        } catch (upsertErr) {
            throw new Error(`Supabase upsert failed: ${upsertErr.message}`);
        }

        await CurrenciesRepo.logRefresh({
            source: 'open.er-api.com',
            currencies_updated: rows.length,
            status: 'success',
            raw_payload: { trigger: 'manual', count: rows.length }
        }).catch(() => {});

        _resetCurrencyCache();

        return res.json({ success: true, upserted: rows.length, refreshed_at: now });
    } catch (err) {
        console.error('[Currencies] Manual refresh failed:', err.message);
        try {
            const cfg = getHealthConfig();
            if (cfg.supabaseUrl && cfg.supabaseServiceKey) {
                await CurrenciesRepo.logRefresh({
                    source: 'open.er-api.com',
                    currencies_updated: 0,
                    status: 'error',
                    error_message: err.message,
                    raw_payload: { trigger: 'manual' }
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

    // RPC-equivalent via la capa PostgREST unificada (service-role, vista
    // global). PostgREST no soporta FILTER WHERE inline, asi que emitimos
    // consultas livianas separadas. Los conteos van con count('exact').
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400 * 1000).toISOString();

    try {
        const [imports7d, imports30d, importsTotal, costTotal, recent, dailyRaw] = await Promise.all([
            InstagramRepo.countSince(sevenDaysAgo),
            InstagramRepo.countSince(thirtyDaysAgo),
            InstagramRepo.countTotal(),
            InstagramRepo.sumCost(),
            InstagramRepo.recent(),
            InstagramRepo.sinceForDailyBreakdown(fourteenDaysAgo)
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
    if (!email) return [];
    return pgrest.raw('rpc/registration_auth_lookup', { method: 'POST', body: { p_email: email } });
}

async function listArtistRowsByFilter(filter, select = 'id,user_id,registration_draft_id,registration_status') {
    const rows = await _supabaseFetch(`artists_db?${filter}&select=${select}&limit=10`);
    return Array.isArray(rows) ? rows : [];
}

function isDifferentDraft(row, draftId) {
    return !draftId || String(row.registration_draft_id || '') !== draftId;
}

// Solo las cuentas REALES bloquean un registro: filas finalizadas (user_id o
// pending_validation). Un borrador incompleto del autosave (abandonado o con
// draft-id perdido) nunca reserva email/username/instagram — antes si lo
// hacia y el propio borrador del usuario le "duplicaba" sus datos al
// reintentar tras un conflicto.
function isBlockingRegistrationRow(row, draftId) {
    return isDifferentDraft(row, draftId) && isFinalizedArtist(row);
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
        if (emailRows.some(row => row.user_id !== allowUserId && isBlockingRegistrationRow(row, draftId))) {
            conflicts.add('email');
        }
    }

    if (username) {
        const usernameRows = await listArtistRowsByFilter(
            `username=ilike.${encodeURIComponent(username)}`
        );
        if (usernameRows.some(row => row.user_id !== allowUserId && isBlockingRegistrationRow(row, draftId))) {
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
        if ([...instagramRows, ...instagramAtRows].some(row => isBlockingRegistrationRow(row, draftId))) {
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
        `studios?id=eq.${encodeURIComponent(studioId)}&select=id,primary_location_id,user_id&limit=1`
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

// Sede del estudio para la membresía del registro. Si el estudio TIENE dueño,
// sus sedes las administra él: el registro de un artista solo puede apuntar a
// una sede existente (la elegida o la que coincide con la dirección), nunca
// crearla ni tocar `primary_location_id`. Los estudios del catálogo sin dueño
// conservan el comportamiento anterior (se crea la sede si falta).
async function ensureStudioLocationForRegistration(formData, studioId) {
    if (!studioId || !artistRegistration.isStudioWorkType(formData?.work_type)) {
        return { locationId: null };
    }

    const studio = await getStudioRecord(studioId);
    const studioHasOwner = Boolean(studio?.user_id);

    const selectedLocation = await getStudioLocationById(studioId, formData?.studio_location_id);
    if (selectedLocation) {
        if (!studioHasOwner && !studio?.primary_location_id) {
            await setStudioPrimaryLocation(studioId, selectedLocation.id, buildStudioAddressPatch(selectedLocation));
        }
        return { locationId: selectedLocation.id };
    }

    const addressPatch = buildStudioAddressPatch(formData?.address);
    if (!addressPatch) return { locationId: null };

    const matchingLocation = await findMatchingStudioLocation(studioId, addressPatch);
    if (matchingLocation) {
        if (!studioHasOwner && !studio?.primary_location_id && matchingLocation.id) {
            await setStudioPrimaryLocation(studioId, matchingLocation.id, addressPatch);
        }
        return { locationId: matchingLocation.id };
    }

    if (studioHasOwner) return { locationId: null };

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

// Códigos con los que el alta `requested` falla mientras la migración de
// afiliaciones (20261030200000) no está aplicada: status fuera del CHECK
// (23514) o columna `initiated_by` inexistente (PGRST204 / 42703).
const LEGACY_MEMBERSHIP_FALLBACK_CODES = new Set(['23514', 'PGRST204', '42703']);

// Solicitud de alta del registro, sin on_conflict:
//   1. Si ya hay una fila abierta del par, se respeta (no se duplica).
//   2. Si no, POST simple `requested` + `initiated_by:'artist'` y su detalle.
//   3. Un 23505 (otra fila abierta en paralelo) cuenta como éxito.
//   4. Sin la migración, se reintenta con el payload legacy (`active`) y warn.
async function persistRegistrationMembership({ formData, artistUserId, studioId, locationId }) {
    const requested = artistRegistration.buildStudioMembershipPayload({
        artistUserId,
        studioId,
        locationId,
        workType: formData.work_type
    });
    if (!requested) return { membership: null, pending: false, legacy: false };

    const open = await StudiosRepo.findOpenMembership(studioId, artistUserId);
    if (open) return { membership: open, pending: open.status === 'requested', legacy: false };

    const afterDuplicate = async (legacy) => {
        const row = await StudiosRepo.findOpenMembership(studioId, artistUserId).catch(() => null);
        return { membership: row, pending: row ? row.status === 'requested' : !legacy, legacy };
    };

    let created;
    try {
        created = await StudiosRepo.insertMembership(requested);
    } catch (error) {
        const code = pgErrorCode(error);
        if (code === '23505') return afterDuplicate(false);
        if (!LEGACY_MEMBERSHIP_FALLBACK_CODES.has(code)) throw error;

        console.warn('[register finalize] studio membership request schema not applied; using legacy active membership:', error.message);
        const legacyPayload = artistRegistration.buildStudioMembershipPayload({
            artistUserId,
            studioId,
            locationId,
            workType: formData.work_type,
            legacy: true
        });
        try {
            const legacyRow = await StudiosRepo.insertMembership(legacyPayload);
            return { membership: legacyRow, pending: false, legacy: true };
        } catch (legacyError) {
            if (pgErrorCode(legacyError) === '23505') return afterDuplicate(true);
            throw legacyError;
        }
    }

    const details = artistRegistration.buildStudioMembershipRequestDetails({
        membershipId: created?.id,
        formData
    });
    if (details) {
        await StudiosRepo.insertMembershipRequestDetails(details).catch((detailsError) => {
            console.warn('[register finalize] membership request details not saved:', detailsError.message);
        });
    }

    return { membership: created, pending: true, legacy: false };
}

async function persistRegistrationStudioAssociations({ formData, artistUserId, studioId, studioName }) {
    const empty = { locationId: null, membership: null, membershipPending: false, membershipLegacy: false };
    if (!artistUserId || !studioId || !artistRegistration.isStudioWorkType(formData?.work_type)) {
        return empty;
    }

    const { locationId } = await ensureStudioLocationForRegistration(formData, studioId);
    const address = formData?.address && typeof formData.address === 'object' ? formData.address : {};

    // El vínculo (studio_id) no se escribe en la ubicación del artista mientras
    // la solicitud está pendiente: "Tatúa en …" sale de una membresía activa.
    // studio_name es NOT NULL + CHECK no vacío en vivo, así que queda el nombre
    // como texto (igual que register.js). Best-effort: un error acá no revierte
    // el registro.
    const tattooLocationLabel = studioNameForStorage(studioName || formData?.studio_name);
    if (tattooLocationLabel) {
        try {
            await _supabaseFetch('artist_tattoo_locations?on_conflict=artist_user_id,period_type,sort_order', {
                method: 'POST',
                prefer: 'resolution=merge-duplicates,return=representation',
                body: {
                    artist_user_id: artistUserId,
                    period_type: 'current',
                    sort_order: 0,
                    studio_id: null,
                    studio_name: tattooLocationLabel,
                    city: address.city || address.locality || formData?.location_city || formData?.city || null,
                    agenda_status: 'open'
                }
            });
        } catch (locationError) {
            console.warn('[register finalize] artist tattoo location not saved (registration kept):', locationError.message);
        }
    }

    // Un error de membresía NO revierte el registro: se loguea y la respuesta
    // dice membership_pending: false.
    let membershipResult = { membership: null, pending: false, legacy: false };
    try {
        membershipResult = await persistRegistrationMembership({ formData, artistUserId, studioId, locationId });
    } catch (error) {
        console.error('[register finalize] studio membership request failed (registration kept):', error.message);
    }

    // Fallback legacy: la membresía quedó activa como antes, así que el
    // artista sí figura en el estudio.
    if (membershipResult.legacy && membershipResult.membership?.status === 'active') {
        const label = studioNameForStorage(studioName || formData?.studio_name);
        if (label) {
            await StudiosRepo.setArtistStudioLabel(artistUserId, label).catch((labelError) => {
                console.warn('[register finalize] legacy studio label not saved:', labelError.message);
            });
        }
    }

    return {
        locationId,
        membership: membershipResult.membership || null,
        membershipPending: Boolean(membershipResult.pending && membershipResult.membership),
        membershipLegacy: Boolean(membershipResult.legacy)
    };
}

// Estudio del registro: un `studio_id` del wizard se verifica contra la base
// (si no existe se resuelve por nombre) y se informa si el estudio tiene dueño.
async function resolveRegistrationStudio(formData) {
    const workType = artistRegistration.normalizeWorkType(formData?.work_type);
    if (workType === 'independent') {
        return { studioId: null, estudiosValue: 'Sin estudio/Independiente', studioHasOwner: false };
    }

    if (!artistRegistration.isStudioWorkType(workType)) {
        return { studioId: null, estudiosValue: null, studioHasOwner: false };
    }

    const studioName = String(formData?.studio_name || '').trim();
    if (!studioName) {
        return { studioId: null, estudiosValue: null, studioHasOwner: false };
    }

    if (formData?.studio_id) {
        const known = await StudiosRepo.getStudioById(formData.studio_id, { select: 'id,name,user_id' }).catch(() => null);
        if (known) {
            return {
                studioId: known.id,
                estudiosValue: studioNameForStorage(studioName),
                studioName,
                studioHasOwner: Boolean(known.user_id)
            };
        }
    }

    const normalized = studioName.toUpperCase();
    let studio = await StudiosRepo.findStudioByNormalizedName(normalized);
    if (!studio) {
        try {
            const created = await _supabaseFetch('studios', {
                method: 'POST',
                prefer: 'return=representation',
                body: { name: studioName, normalized_name: normalized }
            });
            studio = Array.isArray(created) && created[0] ? created[0] : null;
        } catch (error) {
            studio = await StudiosRepo.findStudioByNormalizedName(normalized);
            if (!studio) throw error;
        }
    }

    return {
        studioId: studio ? studio.id : null,
        estudiosValue: studioNameForStorage(studioName),
        studioName,
        studioHasOwner: Boolean(studio && studio.user_id)
    };
}

// Aviso best-effort al dueño del estudio de la solicitud que dejó el registro
// (no bloquea la respuesta del finalize).
function _notifyRegistrationMembershipRequest(req, membershipId) {
    if (!membershipId) return;
    StudiosRepo.getMembershipWithParties(membershipId)
        .then((membership) => (membership && membership.status === 'requested'
            ? _notifyMembershipRequestCreated(req, membership)
            : null))
        .catch((error) => console.warn('[register finalize] studio owner not notified:', error.message));
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
            app_metadata: { qa_unverified_email: true, registration_draft_id: draftId },
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

// Un reintento del finalize adopta el usuario de Auth que creo el intento
// anterior de ESTE borrador; la contrasena mas reciente gana.
async function updateArtistAuthUserPassword(userId, password) {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: getAdminHeaders(serviceRoleKey),
        body: JSON.stringify({ password })
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.msg || body.message || `Auth update failed (${response.status})`);
    }
}

// Rollback del finalize: si algo falla DESPUES de crear el usuario de Auth,
// se borra para no dejar una cuenta a medias (que convertia el email en
// "duplicado" en el siguiente intento).
async function deleteArtistAuthUser(userId) {
    const { supabaseUrl, serviceRoleKey } = getSupabaseAdminConfig();
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: getAdminHeaders(serviceRoleKey)
    });
    if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.msg || body.message || `Auth delete failed (${response.status})`);
    }
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

        // ¿Un intento anterior de ESTE borrador ya creo el usuario de Auth y
        // fallo despues? Se adopta en vez de chocar con "email ya registrado".
        const priorAuthUsers = await listAuthUsersByEmail(email);
        const ownAuthUser = priorAuthUsers.find(
            (u) => u && u.user_metadata && u.user_metadata.registration_draft_id === draftId
        ) || null;

        const conflicts = await getRegistrationConflicts({
            email, username, instagram, draftId,
            allowUserId: ownAuthUser ? ownAuthUser.id : undefined
        });
        // Instagram duplicado NO bloquea (decision 26 ago): se registra igual y
        // el Instagram queda para validar despues. Solo email/username frenan.
        const blocking = conflicts.filter((c) => c !== 'instagram');
        if (blocking.length > 0) {
            return res.status(409).json({ success: false, error: 'Datos ya registrados', conflicts: blocking });
        }

        const { studioId, estudiosValue, studioName, studioHasOwner } = await resolveRegistrationStudio(formData);
        const joinsStudio = Boolean(studioId) && artistRegistration.isStudioWorkType(formData.work_type);
        // Sede elegida, verificada contra el estudio: sus coordenadas dejan al
        // artista en el mapa mientras la solicitud al estudio está pendiente.
        const selectedStudioLocation = joinsStudio && formData.studio_location_id
            ? await getStudioLocationById(studioId, formData.studio_location_id).catch(() => null)
            : null;
        const fullName = artistRegistration.capitalizeWords(formData.full_name);
        let authUser = ownAuthUser;
        let createdAuthUserId = null;
        if (authUser) {
            await updateArtistAuthUserPassword(authUser.id, password);
        } else {
            authUser = await createArtistAuthUser({
                email,
                password,
                fullName,
                username,
                draftId,
                source
            });
            createdAuthUserId = authUser && authUser.id ? authUser.id : null;
        }
        if (!authUser || !authUser.id) {
            throw new Error('Auth create returned no user id');
        }

        try {
        const finalPatch = artistRegistration.buildArtistRegistrationPayload(formData, {
            draftId,
            userId: authUser.id,
            email,
            source,
            step: 12,
            studioId,
            // Con estudio, "tatúa en …" espera a que el estudio apruebe la
            // solicitud: no se escribe la etiqueta ni artists_db.studio_id.
            estudiosValue: joinsStudio ? null : estudiosValue,
            studioLocation: selectedStudioLocation,
            status: artistRegistration.REGISTRATION_STATUS_PENDING_VALIDATION,
            submitted: true
        });

        const savedRows = await _supabaseFetch(
            `artists_db?registration_draft_id=eq.${encodeURIComponent(draftId)}`,
            { method: 'PATCH', prefer: 'return=representation', body: finalPatch }
        );
        const artist = Array.isArray(savedRows) && savedRows[0] ? savedRows[0] : null;
        const studioLink = await persistRegistrationStudioAssociations({
            formData,
            artistUserId: authUser.id,
            studioId,
            studioName: studioName || estudiosValue
        });
        if (studioLink.membershipPending && studioHasOwner) {
            _notifyRegistrationMembershipRequest(req, studioLink.membership?.id);
        }

        return res.json({
            success: true,
            user_id: authUser.id,
            draft_id: draftId,
            registration_status: artistRegistration.REGISTRATION_STATUS_PENDING_VALIDATION,
            membership_pending: Boolean(studioLink.membershipPending),
            membership_status: studioLink.membership?.status || null,
            studio_has_owner: joinsStudio ? Boolean(studioHasOwner) : null,
            artist: artistRegistration.publicArtistDraft(artist),
            dashboard_url: requestAbsoluteUrl(req, '/artist/dashboard'),
            login_url: requestAbsoluteUrl(req, '/registerclosedbeta'),
            profile_url: username ? requestAbsoluteUrl(req, `/artist/profile?artist=${encodeURIComponent(username)}`) : null
        });
        } catch (postCreateError) {
            // Rollback: nunca dejar una cuenta de Auth a medias.
            if (createdAuthUserId) {
                await deleteArtistAuthUser(createdAuthUserId).catch((rollbackErr) =>
                    console.error('[register finalize] rollback del auth user fallo:', rollbackErr.message)
                );
            }
            throw postCreateError;
        }
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
        const caller = await resolveBearerUser(req);
        const conflicts = await getRegistrationConflicts({ email, username, instagram, draftId, allowUserId: caller && (!email || caller.email?.toLowerCase() === email) ? caller.id : undefined });
        // Instagram duplicado no bloquea el registro: viaja como warning para
        // que el wizard avise que se validara despues.
        const blocking = conflicts.filter((c) => c !== 'instagram');
        const warnings = conflicts.includes('instagram') ? ['instagram'] : [];
        return res.json({
            success: true,
            available: blocking.length === 0,
            conflicts: blocking,
            warnings
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

    // ¿Existe al menos una fila en artists_db que cumpla `column op value`?
    // (antes: HEAD + Prefer:count=exact). count('exact') + range(0,0) da el
    // mismo total via content-range trayendo a lo sumo 1 fila. Fallback a false.
    async function artistExists(column, op, value) {
        try {
            const q = pgrest('artists_db').select('user_id').count('exact').range(0, 0);
            const { count } = await q[op](column, value).execute();
            return Number.isFinite(count) && count > 0;
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
            const emailInArtists = await artistExists('email', 'eq', email);
            if (emailInAuth || emailInArtists) conflicts.push('email');
        }

        // 2. Username (the .wo handle) — case-insensitive match in artists_db.
        if (username) {
            const taken = await artistExists('username', 'ilike', username);
            if (taken) conflicts.push('username');
        }

        // 3. Instagram handle — match against artists_db.instagram (with or
        //    without @ prefix in stored data).
        if (instagram) {
            const takenA = await artistExists('instagram', 'ilike', instagram);
            const takenB = takenA ? false : await artistExists('instagram', 'ilike', '@' + instagram);
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
const { resolveEmailContext, applicationBase } = require('./services/email-request-context');

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
        recipient_name: 'Test User',
        studio_name: 'Estudio de prueba',
        subject: 'We Ötzi — prueba de correo',
        body_text: 'Esta es una prueba controlada del envío de correo de We Ötzi.',
        name: 'Test User',
        artist_name: 'Test Artist',
        client_name: 'Test Client',
        quote_id: 'TEST-0001',
        login_url: `${applicationBase(req)}/client/login`,
        dashboard_url: `${applicationBase(req)}/client/dashboard`,
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
app.post('/api/email/:eventId', authLimiter, async (req, res) => {
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
        const context = await resolveEmailContext(req, eventId, payload);
        if (!context.ok) return res.status(context.status || 403).json({ success: false, error: context.error });
        const result = await emailService.sendEmail(eventId, context.payload, {
            forceChannel, idempotencyKey: context.idempotencyKey
        });
        const status = result.ok ? 200 : 502;
        return res.status(status).json({ success: !!result.ok, ...result });
    } catch (err) {
        console.error(`[email] dispatch failed for ${eventId}:`, err.message);
        return res.status(503).json({ success: false, error: 'No se pudo enviar el correo. El cambio guardado sigue disponible en tu cuenta.' });
    }
});


// Redirect root al selector de rol del nuevo diseño
app.get('/', (req, res) => {
    res.redirect('/inicio');
});

// Public Travel links use a readable, non-enumerating slug in the path.
// The page itself resolves the slug through the restricted Supabase RPC.
app.get('/travel/t/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'travel', 'share', 'index.html'));
});

// Rutas del artista retiradas por el Figma final: redirigen a su reemplazo
// solo cuando su carpeta ya no existe en public/ (ver lib/legacy-routes.js).
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const target = legacyRedirectFor(req.path, path.join(__dirname, 'public'));
    if (!target) return next();
    const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect(301, legacyLocation(target, search, { prefix: req.weotziBasePath || '' }));
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
    '/artist/dashboard': 'Artist dashboard',
    '/artist/invitations': 'Artist invitations',
    '/artist/login': 'Artist login',
    '/artist/profile': 'Public artist profile',
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
    '/supplies/dashboard': 'Supplies vendor dashboard',
    '/supplies/login': 'Supplies vendor login',
    '/supplies/register': 'Supplies vendor registration',
    '/studio-spots': 'Studio spots',
    '/support/dashboard': 'Support dashboard',
    '/support/login': 'Support login',
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
// Shared hosting can reject loopback TCP; a private Unix socket keeps the proxy local.
if (LISTEN_SOCKET) {
    if (!path.isAbsolute(LISTEN_SOCKET)) throw new Error('LISTEN_SOCKET must be absolute');
    fs.mkdirSync(path.dirname(LISTEN_SOCKET), { recursive: true, mode: 0o700 });
    try {
        const listenerFile = fs.lstatSync(LISTEN_SOCKET);
        if (!listenerFile.isSocket()) throw new Error('LISTEN_SOCKET is occupied by a non-socket file');
        fs.unlinkSync(LISTEN_SOCKET);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const listenArguments = LISTEN_SOCKET ? [LISTEN_SOCKET] : [PORT, LISTEN_HOST];
app.listen(...listenArguments, () => {
    if (LISTEN_SOCKET) fs.chmodSync(LISTEN_SOCKET, 0o600);
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

