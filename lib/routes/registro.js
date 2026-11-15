'use strict';

// ===========================================================================
// Rutas del frente "registro" (ronda 2).
//   GET /api/register/confirmation-status?uid=<uuid>
//       ¿La cuenta recién creada ya confirmó su email? La consulta la pestaña
//       "Falta confirmar email" del registro (public/shared/js/
//       email-confirmation.js · watchConfirmation) para seguir sola cuando la
//       persona abre el link en otra pestaña, otro navegador o el teléfono.
//
// Qué expone: solo { confirmed: true|false }. El uid es el id de Auth que el
// propio registro recibió al crear la cuenta (UUID v4, no adivinable); no se
// devuelve email ni ningún otro dato, y un uid inexistente responde igual que
// una cuenta sin confirmar (no sirve para enumerar cuentas).
// ===========================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

// true si el usuario de Auth tiene el email confirmado.
function isConfirmedAuthUser(user) {
    if (!user || typeof user !== 'object') return false;
    return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function createHandlers(deps = {}) {
    const fetchImpl = deps.fetchImpl || ((...args) => fetch(...args));
    const config = deps.config || (() => ({
        supabaseUrl: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    }));
    const log = deps.log || ((...args) => console.warn(...args));

    async function confirmationStatus(req, res) {
        res.set('Cache-Control', 'no-store');
        const uid = String((req.query && req.query.uid) || '').trim();
        if (!isUuid(uid)) return res.status(400).json({ success: false, error: 'Identificador no válido.' });
        const { supabaseUrl, serviceRoleKey } = config();
        if (!supabaseUrl || !serviceRoleKey) {
            return res.status(503).json({ success: false, error: 'Servicio no disponible.' });
        }
        try {
            const response = await fetchImpl(
                `${String(supabaseUrl).replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(uid)}`,
                { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
            );
            if (response.status === 404) return res.json({ success: true, confirmed: false });
            if (!response.ok) {
                log(`[registro] confirmation-status: auth HTTP ${response.status}`);
                return res.status(502).json({ success: false, error: 'No pudimos consultar el estado de la cuenta.' });
            }
            const body = await response.json().catch(() => null);
            const user = body && (body.user || body);
            return res.json({ success: true, confirmed: isConfirmedAuthUser(user) });
        } catch (error) {
            log('[registro] confirmation-status:', error && error.message);
            return res.status(502).json({ success: false, error: 'No pudimos consultar el estado de la cuenta.' });
        }
    }

    return { confirmationStatus };
}

function register(app, deps = {}) {
    const handlers = createHandlers(deps);
    let limiter = deps.limiter;
    if (!limiter) {
        const rateLimit = require('express-rate-limit');
        // La pestaña en espera consulta cada ~12 s: 120 por 15 min alcanza para
        // dos pestañas y corta cualquier barrido.
        limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 120,
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, error: 'Demasiadas consultas. Prueba de nuevo en unos minutos.' }
        });
    }
    app.get('/api/register/confirmation-status', limiter, handlers.confirmationStatus);
    return handlers;
}

module.exports = { register, createHandlers, isUuid, isConfirmedAuthUser };
