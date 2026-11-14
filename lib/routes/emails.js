'use strict';

// ===========================================================================
// Rutas y utilidades del frente "emails" (beta cerrada)
// ---------------------------------------------------------------------------
//  · dispatchLimiter: rate limit propio de POST /api/email/:eventId, por
//    usuario verificado (o IP), 30 por minuto. Ya no comparte el contador de
//    authLimiter (10 / 15 min por IP) con el registro y el reset (EM-N1).
//  · adminLimiter: /api/email/events y /api/email/test (backoffice).
//  · dispatchHandler: la ruta catch-all /api/email/:eventId. Un correo omitido
//    por preferencia o ya leído NO es un error; chat e inbox se envían
//    diferidos (2 min) y con ventana de 15 min por conversación.
//  · register(app, deps):
//      POST /api/support/artist-verification-notify  (verificación aprobada/denegada)
//      POST /api/sessions/reminders/dispatch          (cron del recordatorio 24 h)
//      + intervalo interno del recordatorio (SESSION_REMINDERS_JOB=off lo apaga)
//      + aviso de arranque si falta PUBLIC_APP_URL en producción.
//  · notifyQuotationCompleted(quoteId[, {events}]): resumen final + pedido de reseña.
//  · stripPublicWebhooks(config): saca las URLs de webhooks de n8n del JSON
//    público /shared/js/app-config.json (CC-19).
// ===========================================================================

const crypto = require('node:crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const DISPATCH_WINDOW_MS = 60 * 1000;
const DISPATCH_MAX = Math.max(5, Number(process.env.EMAIL_DISPATCH_RATE_MAX) || 30);
const USER_CACHE_TTL_MS = 60 * 1000;
const USER_CACHE_MAX = 500;
const MAX_PENDING_DEFERRED = 500;
const VERIFICATION_EVENTS = { Yes: 'profile_verified', Denied: 'profile_verification_denied' };

function emailService() { return require('../../services/email-service'); }
function emailContext() { return require('../../services/email-request-context'); }
function defaultResolveUser(req) { return require('../auth/supabase-auth').resolveBearerUser(req); }

// ---------------------------------------------------------------- usuario

const userCache = new Map();

function tokenOf(req) {
    const header = req && req.headers && (req.headers.authorization || req.headers.Authorization);
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return '';
    return header.slice(7).trim();
}

/**
 * Usuario verificado del Bearer (cacheado 60 s por hash del token y guardado
 * en req.weotziEmailUser para que resolveEmailContext no lo pida de nuevo).
 * Nunca usa el `sub` del JWT sin verificar.
 */
async function resolveRequestUser(req, resolveUser = defaultResolveUser) {
    if (req.weotziEmailUser !== undefined) return req.weotziEmailUser;
    const token = tokenOf(req);
    if (!token) { req.weotziEmailUser = null; return null; }
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const cached = userCache.get(key);
    if (cached && cached.at + USER_CACHE_TTL_MS > Date.now()) {
        req.weotziEmailUser = cached.user;
        return cached.user;
    }
    let user = null;
    try { user = await resolveUser(req); } catch (_) { user = null; }
    // Solo se cachea un usuario válido: un fallo transitorio de Auth no deja el
    // token marcado como anónimo durante todo el TTL.
    if (user) {
        if (userCache.size >= USER_CACHE_MAX) userCache.delete(userCache.keys().next().value);
        userCache.set(key, { user, at: Date.now() });
    }
    req.weotziEmailUser = user;
    return user;
}

// ---------------------------------------------------------------- limiters

function createEmailDispatchLimiter({ resolveUser = defaultResolveUser, windowMs = DISPATCH_WINDOW_MS, max = DISPATCH_MAX } = {}) {
    return rateLimit({
        windowMs,
        limit: max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: async (req) => {
            const user = await resolveRequestUser(req, resolveUser);
            return user && user.id ? `user:${user.id}` : `ip:${ipKeyGenerator(req.ip || '')}`;
        },
        message: { success: false, rate_limited: true, error: 'Enviaste muchos avisos seguidos. El cambio quedó guardado; probá de nuevo en un minuto.' }
    });
}

function createEmailAdminLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiadas operaciones de email seguidas. Probá de nuevo en unos minutos.' }
    });
}

const dispatchLimiter = createEmailDispatchLimiter();
const adminLimiter = createEmailAdminLimiter();

// ---------------------------------------------------------------- envío diferido

let pendingDeferred = 0;

function defaultSchedule(fn, ms) {
    const timer = setTimeout(fn, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
}

/** Envía después de `delayMs` si el mensaje sigue sin leer. */
function scheduleDeferred(eventId, context, options, deps = {}) {
    const send = deps.sendEmail || ((id, payload, opts) => emailService().sendEmail(id, payload, opts));
    const schedule = deps.schedule || defaultSchedule;
    const run = async () => {
        pendingDeferred = Math.max(0, pendingDeferred - 1);
        try {
            if (context.defer.stillPending && !(await context.defer.stillPending())) {
                console.log(`[email] ${eventId} omitido: el destinatario ya leyó el mensaje`);
                return;
            }
            const result = await send(eventId, context.payload, options);
            if (!result || (!result.ok && !result.deduplicated)) {
                console.warn(`[email] ${eventId} diferido no confirmado: ${(result && result.error) || 'sin respuesta'}`);
            }
        } catch (error) {
            console.warn(`[email] ${eventId} diferido falló: ${error.message}`);
        }
    };
    if (pendingDeferred >= MAX_PENDING_DEFERRED) return run();
    pendingDeferred += 1;
    schedule(run, context.defer.delayMs);
    return null;
}

// ---------------------------------------------------------------- POST /api/email/:eventId

function createDispatchHandler(deps = {}) {
    return async function dispatchHandler(req, res) {
        const service = deps.emailService || emailService();
        const mapping = service.eventMapping;
        const eventId = req.params.eventId;
        const payload = (req.body && req.body.data) || req.body || {};
        const forceChannel = req.query && req.query.force ? String(req.query.force) : undefined;

        if (!mapping.getEvent(eventId)) {
            return res.status(404).json({ success: false, error: `Unknown eventId: ${eventId}` });
        }
        if (forceChannel) {
            if (!service.VALID_CHANNELS.includes(forceChannel)) {
                return res.status(400).json({ success: false, error: 'Invalid force channel' });
            }
            const verifyAdmin = deps.verifyAdmin || require('../app-settings').verifyAdminCaller;
            const auth = await verifyAdmin(req);
            if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
        }

        try {
            const resolveUser = deps.resolveUser || defaultResolveUser;
            const context = await (deps.resolveEmailContext || emailContext().resolveEmailContext)(req, eventId, payload, {
                ...(deps.contextDeps || {}),
                resolveUser: () => resolveRequestUser(req, resolveUser)
            });
            if (!context.ok) {
                // EM-12: sin PII (ni emails ni ids de usuario), solo el motivo.
                console.warn('[email] context rejected', { eventId, status: context.status, reason: context.reason || null });
                return res.status(context.status || 403).json({ success: false, error: context.error });
            }
            if (context.skip) {
                return res.json({ success: true, sent: false, skipped: true, delivery_status: context.reason || 'skipped' });
            }
            const options = { forceChannel, idempotencyKey: context.idempotencyKey };
            if (context.defer && context.defer.delayMs > 0) {
                scheduleDeferred(eventId, context, options, deps);
                return res.status(202).json({ success: true, queued: true, sent: false, delivery_status: 'queued' });
            }
            const result = await service.sendEmail(eventId, context.payload, options);
            if (result.ok) return res.json({ success: true, ...result });
            // Incierto o ya reclamado: no es seguro reintentar, pero tampoco es
            // un error del usuario (el cambio quedó guardado).
            if (result.uncertain || result.deduplicated) return res.status(202).json({ success: false, ...result });
            return res.status(502).json({ success: false, ...result });
        } catch (err) {
            console.error(`[email] dispatch failed for ${eventId}:`, err.message);
            return res.status(503).json({ success: false, error: 'No se pudo enviar el correo. El cambio guardado sigue disponible en tu cuenta.' });
        }
    };
}

const dispatchHandler = createDispatchHandler();

// ---------------------------------------------------------------- servidor → correo

/**
 * Cierre por el cliente (POST /api/client/quotations/:id/complete): resumen
 * final a ambos y pedido de reseña al cliente. Nunca rompe la acción.
 */
async function notifyQuotationCompleted(quoteId, deps = {}) {
    const ctx = deps.serverQuotationContext || emailContext().serverQuotationContext;
    const send = deps.sendEmail || ((id, payload, opts) => emailService().sendEmail(id, payload, opts));
    const out = {};
    // deps.events: el servidor pide solo request_rating porque el resumen lo
    // manda cot-artista-notices con una copia por rol (sin duplicar el correo).
    const events = Array.isArray(deps.events) && deps.events.length ? deps.events : ['quotation_completed_summary', 'request_rating'];
    for (const eventId of events) {
        try {
            const context = await ctx(eventId, quoteId, deps);
            if (!context.ok) { out[eventId] = { ok: false, error: context.error }; continue; }
            out[eventId] = await send(eventId, context.payload, { idempotencyKey: context.idempotencyKey });
        } catch (error) {
            out[eventId] = { ok: false, error: error.message };
            console.warn(`[email] ${eventId} al completar falló: ${error.message}`);
        }
    }
    return out;
}

/**
 * Verificación del artista decidida por soporte → profile_verified /
 * profile_verification_denied. Relee el estado guardado (no confía en el
 * navegador) y manda como mucho un correo por estado y día.
 */
async function notifyArtistVerification(body, deps) {
    const userId = String((body && body.artist_user_id) || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, status: 400, error: 'Falta el artista.' };
    const artist = await deps.fetchArtist(userId);
    if (!artist) return { ok: false, status: 404, error: 'No encontramos ese artista.' };
    const eventId = VERIFICATION_EVENTS[artist.verification_state];
    if (!eventId) return { ok: true, sent: false, skipped: 'state_without_email' };
    if (!artist.email) return { ok: false, status: 409, error: 'El artista no tiene un email guardado.' };
    const base = String(deps.baseUrl || '').replace(/\/$/, '');
    const reason = String((body && body.reason) || '').trim().slice(0, 500);
    const day = new Date(deps.now || Date.now()).toISOString().slice(0, 10);
    const result = await deps.sendEmail(eventId, {
        app_base_url: base || undefined,
        artist_email: artist.email,
        artist_name: artist.name || artist.username || '',
        artist_user_id: artist.user_id,
        reason: eventId === 'profile_verification_denied' ? reason : '',
        account_url: base ? `${base}/artist/account#verificacion` : undefined
    }, { idempotencyKey: `verify:${artist.user_id}:${artist.verification_state}:${day}` });
    return { ok: true, eventId, sent: !!(result && result.ok && !result.skipped), skipped: result && result.skipped ? 'notification_pref' : null,
        deduplicated: !!(result && result.deduplicated), uncertain: !!(result && result.uncertain) };
}

// ---------------------------------------------------------------- config pública

/** CC-19: el JSON público no expone URLs de webhooks de n8n. */
function stripPublicWebhooks(config) {
    if (!config || typeof config !== 'object' || !config.n8n || typeof config.n8n !== 'object') return config;
    delete config.n8n.webhookUrl;
    if (Array.isArray(config.n8n.events)) {
        config.n8n.events = config.n8n.events.map(({ webhookUrl, ...rest }) => ({ ...rest, webhookUrl: '' }));
    }
    return config;
}

// ---------------------------------------------------------------- registro

/**
 * @param {import('express').Express} app
 * @param {{ pgrest: Function, getActiveSupportAgent: Function, applicationBase: Function,
 *           safeTokenEqual: Function, startJobs?: boolean }} deps
 */
function register(app, deps = {}) {
    const { pgrest } = deps;
    const sessionReminders = require('../session-reminders');
    const base = () => deps.applicationBase({ headers: {}, get: () => '' });

    if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_APP_URL && !process.env.APP_URL) {
        console.warn('[email] PUBLIC_APP_URL no está definida: los links de los correos usan https://beta.weotzi.com');
    }

    app.post('/api/support/artist-verification-notify', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const agent = await deps.getActiveSupportAgent(req);
        if (!agent.ok) return res.status(agent.status).json({ success: false, error: agent.error });
        try {
            const result = await notifyArtistVerification(req.body || {}, {
                fetchArtist: (userId) => pgrest('artists_db').select('user_id,name,username,email,verification_state')
                    .eq('user_id', userId).limit(1).single().execute(),
                sendEmail: (eventId, payload, options) => emailService().sendEmail(eventId, payload, options),
                baseUrl: deps.applicationBase(req)
            });
            if (!result.ok) return res.status(result.status || 400).json({ success: false, error: result.error });
            return res.json({ success: true, ...result });
        } catch (error) {
            console.error('[email] aviso de verificación falló:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos avisarle al artista por email.' });
        }
    });

    const runReminders = (limit) => sessionReminders.dispatchSessionReminders({
        query: pgrest,
        sendEmail: (eventId, payload, options) => emailService().sendEmail(eventId, payload, options),
        baseUrl: base(),
        limit
    });

    app.post('/api/sessions/reminders/dispatch', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const expected = process.env.CRON_API_TOKEN;
        if (typeof expected !== 'string' || !expected.trim()) {
            return res.status(503).json({ success: false, error: 'El recordatorio de sesiones no está configurado.' });
        }
        if (!deps.safeTokenEqual(req.headers['x-cron-token'], expected)) {
            return res.status(401).json({ success: false, error: 'El token de cron no es válido.' });
        }
        try {
            const result = await runReminders(Math.min(200, Math.max(1, parseInt(req.body && req.body.limit, 10) || 100)));
            return res.json({ success: true, result });
        } catch (error) {
            console.error('[email] recordatorios de sesión fallaron:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos enviar los recordatorios de sesión.' });
        }
    });

    const interval = sessionReminders.intervalFromEnv(process.env);
    if (deps.startJobs && interval) {
        let running = false;
        const timer = setInterval(async () => {
            if (running) return;
            running = true;
            try {
                const result = await runReminders();
                if (result.found) console.log('[email] recordatorios de sesión:', JSON.stringify(result));
            } catch (error) {
                console.warn('[email] intervalo de recordatorios de sesión:', error.message);
            } finally {
                running = false;
            }
        }, interval);
        if (timer && typeof timer.unref === 'function') timer.unref();
    }
}

module.exports = {
    register,
    dispatchLimiter,
    adminLimiter,
    dispatchHandler,
    createDispatchHandler,
    createEmailDispatchLimiter,
    createEmailAdminLimiter,
    resolveRequestUser,
    scheduleDeferred,
    notifyQuotationCompleted,
    notifyArtistVerification,
    stripPublicWebhooks,
    DISPATCH_MAX,
    DISPATCH_WINDOW_MS
};
