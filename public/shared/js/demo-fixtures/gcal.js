/**
 * Fixtures de preview/demo · área "gcal" (Google Calendar, ronda 3b).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build().
 *
 *   - get_my_google_calendar_connection(): el artista demo tiene Google
 *     Calendar conectado (cuenta ficticia), con la última sincronización hace
 *     12 minutos. En preview el servidor no responde /api/google-calendar/*
 *     y google-calendar-repo.js cae a esta RPC (estado de solo lectura).
 *   - artist_google_calendar_busy: tres bloques "ocupado" importados de
 *     Google (sin títulos), uno de todo el día y dos con horario.
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
        if (ctx.TABLES.indexOf('artist_google_calendar_busy') < 0) ctx.TABLES.push('artist_google_calendar_busy');

        function at(dayOffset, hh, mm) {
            var d = new Date(now.getTime());
            d.setDate(d.getDate() + dayOffset);
            d.setHours(hh, mm || 0, 0, 0);
            return d.toISOString();
        }

        tables.artist_google_calendar_busy = [
            { user_id: artistId, google_event_id: 'demo-gcal-1', starts_at: at(1, 9), ends_at: at(1, 11), all_day: false, synced_at: new Date(now.getTime() - 12 * MIN).toISOString() },
            { user_id: artistId, google_event_id: 'demo-gcal-2', starts_at: at(3, 0), ends_at: at(4, 0), all_day: true, synced_at: new Date(now.getTime() - 12 * MIN).toISOString() },
            { user_id: artistId, google_event_id: 'demo-gcal-3', starts_at: at(-2, 16), ends_at: at(-2, 18, 30), all_day: false, synced_at: new Date(now.getTime() - 12 * MIN).toISOString() }
        ];

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
