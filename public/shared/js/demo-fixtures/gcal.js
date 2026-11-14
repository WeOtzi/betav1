/**
 * Fixtures de preview/demo · área "gcal" (Google Calendar, ronda 3b).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build().
 *
 *   - get_my_google_calendar_connection(): el artista demo tiene Google
 *     Calendar conectado (cuenta ficticia), con la última sincronización hace
 *     12 minutos. En preview el servidor no responde /api/google-calendar/*
 *     y google-calendar-repo.js cae a esta RPC (estado de solo lectura).
 *   Solo de ida (20261114100000): no hay bloques importados de Google.
 * Nunca hay tokens en el demo.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['gcal'] = function (ctx) {
        var tables = ctx.tables;
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        var MIN = 60 * 1000;
        var now = new Date();

        if (!ctx.rpcs) ctx.rpcs = {};
        ctx.rpcs.get_my_google_calendar_connection = function () {
            return [{
                connected: true,
                google_email: 'agenda.demo@gmail.com',
                calendar_id: 'primary',
                connected_at: new Date(now.getTime() - 20 * 24 * 60 * MIN).toISOString(),
                last_sync_at: new Date(now.getTime() - 12 * MIN).toISOString(),
                last_error: null,
                needs_reauth: false
            }];
        };
    };
})(typeof self !== 'undefined' ? self : this);
