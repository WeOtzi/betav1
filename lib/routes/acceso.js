'use strict';

// ===========================================================================
// Rutas del frente "acceso" (registro, bienvenida y Términos del cliente).
//   POST /api/account/welcome  { role: 'artist'|'client' }
//        Bienvenida idempotente al entrar con la cuenta confirmada (ACC-04).
//   POST /api/account/terms    { accepted: true }
//        Sella la aceptación de Términos del cliente que entró con Google o
//        Facebook (ACC-08). El alta por email la sella handle_new_user.
// Lógica pura en lib/acceso.js; datos en lib/repos/acceso.js.
// ===========================================================================

const acceso = require('../acceso');

function createHandlers(deps = {}) {
    const resolveUser = deps.resolveUser || require('../auth/supabase-auth').resolveBearerUser;
    const repo = deps.repo || require('../repos/acceso').AccesoRepo;
    const sendEmail = deps.sendEmail || ((eventId, payload, options) => require('../../services/email-service').sendEmail(eventId, payload, options));
    const resolveEmailContext = deps.resolveEmailContext || require('../../services/email-request-context').resolveEmailContext;
    const now = deps.now || (() => Date.now());
    const config = deps.config || (() => acceso.welcomeConfig());
    const log = deps.log || ((...args) => console.warn(...args));

    async function welcome(req, res) {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, error: 'Iniciá sesión para continuar.' });
        const role = acceso.normalizeRole(req.body && req.body.role);
        if (!role) return res.status(400).json({ success: false, error: 'Rol no válido.' });
        try {
            const [artist, client] = await Promise.all([
                repo.getArtistProfile(user.id),
                role === 'client' ? repo.getClientProfile(user.id) : null
            ]);
            const decision = acceso.welcomeDecision({ user, role, artist, client, now: now(), config: config() });
            if (!decision.send) return res.json({ success: true, sent: false, reason: decision.reason });
            // Mismo armado que POST /api/email/:eventId: destinatario y datos
            // salen del perfil guardado; idempotencia `registration:<user_id>`.
            const context = await resolveEmailContext(req, decision.eventId, {}, { resolveUser: async () => user });
            if (!context.ok) return res.json({ success: true, sent: false, reason: 'no_context' });
            const result = await sendEmail(decision.eventId, context.payload, { idempotencyKey: context.idempotencyKey });
            return res.json({
                success: true,
                sent: Boolean(result && result.ok && !result.deduplicated),
                deduplicated: Boolean(result && result.deduplicated),
                reason: result && result.ok ? 'sent' : 'delivery_failed'
            });
        } catch (err) {
            log('[acceso] bienvenida:', err && err.message);
            return res.status(503).json({ success: false, error: 'No pudimos enviar el correo de bienvenida.' });
        }
    }

    async function terms(req, res) {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, error: 'Iniciá sesión para continuar.' });
        const patch = acceso.clientTermsPatch(req.body && req.body.accepted, { now: new Date(now()) });
        if (!patch) return res.status(400).json({ success: false, error: 'Falta aceptar los Términos y la Política de Privacidad.' });
        try {
            const client = await repo.getClientProfile(user.id);
            if (!client) return res.status(409).json({ success: false, error: 'Todavía no hay un perfil de cliente para esta cuenta.' });
            const result = await repo.stampClientTerms(user.id, patch);
            return res.json({ success: true, stored: result.stored, already: result.already, version: patch.version });
        } catch (err) {
            log('[acceso] términos del cliente:', err && err.message);
            return res.status(500).json({ success: false, error: 'No pudimos guardar la aceptación de los Términos.' });
        }
    }

    return { welcome, terms };
}

function register(app, deps = {}) {
    const handlers = createHandlers(deps);
    let limiter = deps.limiter;
    if (!limiter) {
        const rateLimit = require('express-rate-limit');
        limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 30,
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, error: 'Demasiados intentos. Probá de nuevo en unos minutos.' }
        });
    }
    app.post('/api/account/welcome', limiter, handlers.welcome);
    app.post('/api/account/terms', limiter, handlers.terms);
    return handlers;
}

module.exports = { register, createHandlers };
