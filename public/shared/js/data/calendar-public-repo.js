/**
 * WE OTZI - Agenda pública del artista (frontend, solo lectura)
 * --------------------------------------------------------------
 * Ronda 3 · grupo "calendario". Días no disponibles / con agenda completa /
 * con turnos disponibles de un artista, para el selector de fecha del
 * cotizador. Usa la RPC security-definer list_artist_public_busy_days
 * (migración 20261112190000): devuelve solo fecha + estado, nunca títulos,
 * clientes ni motivos, y está habilitada para anon.
 *
 * Degrada: sin la migración (RPC inexistente) o sin red devuelve {} y el
 * selector sigue funcionando como antes.
 *
 * Carga: después de postgrest-client.js y calendar-model.js.
 * Expone window.WeotziData.CalendarPublic.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[calendar-public-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const cache = new Map();

    function toIndex(rows) {
        const Model = window.WeotziCalendarModel;
        if (Model) return Model.busyDaysIndex(rows);
        const index = {};
        (rows || []).forEach((row) => { if (row && row.busy_date) index[String(row.busy_date).slice(0, 10)] = row.busy_status; });
        return index;
    }

    const CalendarPublic = {
        // { 'YYYY-MM-DD': 'unavailable' | 'full' | 'available' } entre from y to.
        async listBusyDays(artistUserId, from, to) {
            if (!artistUserId) return {};
            const key = `${artistUserId}:${from || ''}:${to || ''}`;
            if (!cache.has(key)) {
                const request = D.run('calendarPublic.listBusyDays', (client) =>
                    client.rpc('list_artist_public_busy_days', {
                        p_artist_user_id: artistUserId,
                        p_from: from || null,
                        p_to: to || null,
                    })
                ).then(({ data }) => toIndex(data)).catch((error) => {
                    console.warn('[calendar-public-repo] Agenda del artista no disponible:', error?.message || error);
                    cache.delete(key);
                    return {};
                });
                cache.set(key, request);
            }
            return cache.get(key);
        },

        clearCache() {
            cache.clear();
        },
    };

    D.CalendarPublic = CalendarPublic;
})();
