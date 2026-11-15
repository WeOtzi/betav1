'use strict';

// ===========================================================================
// Rutas del frente cliente-panel (ronda 2).
// ---------------------------------------------------------------------------
//   GET /api/client/panel/notification-matrix
//        Eventos, canales y valores por defecto de las notificaciones del
//        cliente, tomados de lib/notification-prefs.js (la misma fuente que
//        decide cada envío). Es configuración pública: no lee ni expone datos
//        de ninguna cuenta. Las preferencias de cada cliente se leen y guardan
//        desde el navegador con su propia sesión (user_preferences, RLS dueño).
//
// Se registra desde server.js con una línea:
//   require('./lib/routes/cliente-panel').register(app);
// ===========================================================================

const logic = require('../cliente-panel');

function createHandlers(deps = {}) {
    const notificationPrefs = deps.notificationPrefs || require('../notification-prefs');

    function notificationMatrix(req, res) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.json(Object.assign({ success: true }, logic.clientNotificationMatrix(notificationPrefs)));
    }

    return { notificationMatrix };
}

function register(app, deps) {
    const handlers = createHandlers(deps);
    app.get('/api/client/panel/notification-matrix', handlers.notificationMatrix);
    return handlers;
}

module.exports = { register, createHandlers };
