'use strict';

// ===========================================================================
// Rutas del frente "push" (avisos push e in-app · P24)
//   GET  /api/push/config        → { enabled, publicKey } (clave pública VAPID)
//   POST /api/push/subscribe     { subscription }            (sesión requerida)
//        Guarda la suscripción del navegador para el usuario de la sesión.
//   POST /api/push/unsubscribe   { endpoint }
//        Borra la suscripción. No pide sesión (se llama también al cerrar
//        sesión): alcanza con conocer el endpoint, que es una URL secreta e
//        imposible de adivinar que solo tienen el navegador y el servidor.
//   POST /api/push/refresh       { old_endpoint, old_auth, subscription }
//        Rotación que dispara el navegador (pushsubscriptionchange). Exige el
//        secreto `auth` de la suscripción anterior: sin él no se reemplaza.
//   POST /api/push/test          { role }                    (sesión requerida)
//        Aviso de prueba al propio usuario ("Probar aviso").
// register() además habilita lib/push-dispatch.js (enganche del correo).
// Sin VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY el push queda apagado en silencio:
// config responde enabled=false y los avisos dentro de la app siguen andando.
// Lógica: lib/web-push.js y lib/push-dispatch.js; datos: lib/repos/push.js.
// ===========================================================================

const webPush = require('../web-push');
const pushDispatch = require('../push-dispatch');

const TEST_URL = {
    artist: '/artist/account#notificaciones',
    client: '/client/profile#notificaciones',
    studio: '/studio/dashboard'
};

function createHandlers(deps = {}) {
    const resolveUser = deps.resolveUser || require('../auth/supabase-auth').resolveBearerUser;
    const repo = deps.repo || require('../repos/push').PushRepo;
    const vapid = deps.vapid || (() => webPush.vapidFromEnv());
    const notifyUser = deps.notifyUser || ((input) => pushDispatch.notifyUser(input, { repo }));
    const log = deps.log || ((...args) => console.warn(...args));

    function config(req, res) {
        const cfg = vapid();
        res.set('Cache-Control', 'no-store');
        return res.json({ success: true, enabled: cfg.ok === true, publicKey: cfg.ok ? cfg.publicKey : null });
    }

    async function subscribe(req, res) {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, error: 'Inicia sesión para activar los avisos.' });
        if (!vapid().ok) return res.status(503).json({ success: false, code: 'push_disabled', error: 'Los avisos push no están disponibles por ahora.' });
        const subscription = webPush.normalizeSubscription(req.body && req.body.subscription);
        if (!subscription) return res.status(400).json({ success: false, error: 'La suscripción del navegador no es válida.' });
        try {
            await repo.upsertSubscription({
                userId: user.id,
                ...subscription,
                userAgent: String((req.headers && req.headers['user-agent']) || '').slice(0, 400)
            });
            const max = repo.MAX_SUBSCRIPTIONS_PER_USER || 12;
            if ((await repo.countSubscriptions(user.id)) > max) await repo.deleteOldestSubscriptions(user.id, max);
            return res.json({ success: true });
        } catch (err) {
            log('[push] suscripción:', err && err.message);
            return res.status(500).json({ success: false, error: 'No pudimos guardar la suscripción. Inténtalo de nuevo.' });
        }
    }

    async function unsubscribe(req, res) {
        const endpoint = typeof (req.body && req.body.endpoint) === 'string' ? req.body.endpoint.trim() : '';
        if (!endpoint || endpoint.length > 2048 || !/^https:\/\//.test(endpoint)) {
            return res.status(400).json({ success: false, error: 'Falta el identificador de la suscripción.' });
        }
        try {
            const removed = await repo.deleteByEndpoint(endpoint, null);
            return res.json({ success: true, removed: Array.isArray(removed) ? removed.length : 0 });
        } catch (err) {
            log('[push] baja:', err && err.message);
            return res.status(500).json({ success: false, error: 'No pudimos desactivar los avisos. Inténtalo de nuevo.' });
        }
    }

    async function refresh(req, res) {
        const oldEndpoint = typeof (req.body && req.body.old_endpoint) === 'string' ? req.body.old_endpoint.trim() : '';
        const subscription = webPush.normalizeSubscription(req.body && req.body.subscription);
        // Prueba de que quien llama es el navegador dueño de la suscripción
        // anterior: su secreto `auth` (16 bytes), que solo conocen él y el servidor.
        const oldAuthBytes = webPush.fromB64url(req.body && req.body.old_auth);
        if (!oldEndpoint || oldEndpoint.length > 2048 || oldAuthBytes.length !== 16 || !subscription) {
            return res.status(400).json({ success: false, error: 'La suscripción del navegador no es válida.' });
        }
        try {
            const row = await repo.replaceEndpoint(oldEndpoint, webPush.b64url(oldAuthBytes), subscription);
            return res.json({ success: true, updated: !!row });
        } catch (err) {
            // 409: el endpoint nuevo ya estaba guardado (la app lo sincronizó antes).
            if (err && err.status === 409) return res.json({ success: true, updated: false });
            log('[push] rotación:', err && err.message);
            return res.status(500).json({ success: false, error: 'No pudimos actualizar la suscripción.' });
        }
    }

    async function test(req, res) {
        const user = await resolveUser(req);
        if (!user) return res.status(401).json({ success: false, error: 'Inicia sesión para probar los avisos.' });
        const role = Object.prototype.hasOwnProperty.call(TEST_URL, req.body && req.body.role) ? req.body.role : 'client';
        try {
            const result = await notifyUser({
                userId: user.id,
                role,
                kind: null,
                eventId: 'push_test',
                title: 'Los avisos de We Ötzi están activos',
                body: 'Así te avisaremos cuando recibas un mensaje o haya novedades en tus cotizaciones.',
                url: TEST_URL[role],
                tag: 'push-test'
            });
            const push = (result && result.push) || { attempted: 0, sent: 0 };
            return res.json({
                success: !!(result && result.ok),
                stored: !!(result && result.stored),
                push_enabled: vapid().ok === true,
                devices: push.attempted || 0,
                delivered: push.sent || 0
            });
        } catch (err) {
            log('[push] prueba:', err && err.message);
            return res.status(500).json({ success: false, error: 'No pudimos enviar el aviso de prueba.' });
        }
    }

    return { config, subscribe, unsubscribe, refresh, test };
}

function createLimiter(max, windowMs = 15 * 60 * 1000) {
    const { rateLimit } = require('express-rate-limit');
    return rateLimit({
        windowMs,
        limit: max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' }
    });
}

function register(app, deps = {}) {
    const handlers = createHandlers(deps);
    const limiter = deps.limiter || createLimiter(60);
    const testLimiter = deps.testLimiter || createLimiter(6, 10 * 60 * 1000);

    app.get('/api/push/config', handlers.config);
    app.post('/api/push/subscribe', limiter, handlers.subscribe);
    app.post('/api/push/unsubscribe', limiter, handlers.unsubscribe);
    app.post('/api/push/refresh', limiter, handlers.refresh);
    app.post('/api/push/test', testLimiter, handlers.test);

    if (deps.enableDispatch !== false) pushDispatch.enable(deps.dispatchDeps || {});
    // Claves presentes pero inválidas: se avisa una vez (sin mostrar secretos).
    // Sin claves, el push queda apagado en silencio.
    const cfg = webPush.vapidFromEnv();
    if (!cfg.ok && cfg.reason !== 'missing_keys') {
        (deps.log || console.warn)(`[push] VAPID mal configurado (${cfg.reason}): el push queda desactivado. Ver deployments/DEPLOY.md.`);
    }
    return handlers;
}

module.exports = { register, createHandlers, TEST_URL };
