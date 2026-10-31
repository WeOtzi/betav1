/**
 * Fixtures de preview/demo · área "calendario" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Completa artist_calendar_events para que el mural (801:542/544/545) muestre
 * los nueve tipos en el mes y la semana actuales, relativos a "hoy":
 *   - disponibilidad semanal (jueves), recordatorio semanal (viernes),
 *     solicitud pendiente, día bloqueado, guest spot y convención propios;
 *   - una reserva pendiente vinculada a una cotización sin aprobar
 *     (columna nueva quotation_id, migración 20261028140000 no aplicada).
 * Los turnos con cliente salen de quotation_sessions (fixtures base) y los
 * viajes de artist_trips (Travel); no se duplican acá.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['calendario'] = function (ctx) {
        var tables = ctx.tables;
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 24 * 60 * 60 * 1000;
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        if (!tables.artist_calendar_events) tables.artist_calendar_events = [];
        if (ctx.TABLES.indexOf('artist_calendar_events') < 0) ctx.TABLES.push('artist_calendar_events');

        var now = new Date();
        function pad(n) { return String(n).padStart(2, '0'); }
        function at(dayOffset, hhmm) {
            var d = new Date(now.getTime());
            d.setDate(d.getDate() + dayOffset);
            var parts = String(hhmm || '00:00').split(':');
            d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10) || 0, 0, 0);
            return d.toISOString();
        }
        function dayStart(dayOffset) { return at(dayOffset, '00:00'); }
        function dateOnly(dayOffset) {
            var d = new Date(now.getTime());
            d.setDate(d.getDate() + dayOffset);
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        }
        function id(n) { return '0000c0de-0000-4000-8000-ca1e0000' + pad(n) + '00'; }
        function daysAgo(n) { return new Date(now.getTime() - n * DAY).toISOString(); }
        function row(n, fields) {
            return Object.assign({
                id: id(n), artist_user_id: artistId, client_name: null, all_day: false, location: null,
                notes: null, status: 'scheduled', recurrence_rule: 'none', recurrence_until: null,
                quotation_id: null, created_at: daysAgo(10), updated_at: daysAgo(2)
            }, fields);
        }

        // Cotización sin aprobar para la reserva vinculada (DEMO-P01 en los fixtures base).
        var pendingQuote = (tables.quotations_db || []).find(function (q) { return q.quote_status === 'pending'; }) || null;

        var rows = [
            row(1, { event_type: 'blocked_day', title: 'Día bloqueado · mantenimiento', starts_at: dayStart(-7), ends_at: dayStart(-6), all_day: true, notes: 'Service de máquinas y limpieza profunda.' }),
            row(2, { event_type: 'availability', title: 'Disponible para consultas', starts_at: at(-6, '14:00'), ends_at: at(-6, '18:00'), recurrence_rule: 'weekly', recurrence_until: dateOnly(60), notes: 'Bloque abierto para consultas y bocetos.' }),
            row(3, { event_type: 'reminder', title: 'Pedir cartuchos 3RL', starts_at: at(-5, '09:30'), ends_at: at(-5, '10:00'), recurrence_rule: 'weekly', recurrence_until: dateOnly(30) }),
            row(4, { event_type: 'pending_request', title: 'Nueva solicitud — Matías Silva', client_name: 'Matías Silva', starts_at: at(1, '11:00'), ends_at: at(1, '13:00'), status: 'pending', location: 'Estudio propio', notes: 'Pidió turno para un lettering en el antebrazo.' }),
            row(5, { event_type: 'guest_spot', title: 'Guest en Fierro Negro Tattoo', starts_at: dayStart(6), ends_at: dayStart(8), all_day: true, location: 'Rosario, Argentina', notes: 'Dos días con agenda abierta en el estudio.' }),
            row(6, { event_type: 'convention', title: 'Feria Tinta Buenos Aires', starts_at: dayStart(-13), ends_at: dayStart(-11), all_day: true, location: 'Buenos Aires, Argentina' })
        ];
        if (pendingQuote) {
            rows.push(row(7, {
                event_type: 'reservation', title: (pendingQuote.client_full_name || 'Cliente') + ' — reserva',
                client_name: pendingQuote.client_full_name || null, starts_at: at(2, '15:00'), ends_at: at(2, '17:00'),
                status: 'pending', location: 'Estudio propio', quotation_id: pendingQuote.id,
                notes: 'Reserva a confirmar cuando el cliente apruebe la cotización.'
            }));
        }

        var existing = {};
        tables.artist_calendar_events.forEach(function (event) { existing[event.id] = true; });
        rows.forEach(function (event) { if (!existing[event.id]) tables.artist_calendar_events.push(event); });
    };
}(typeof self !== 'undefined' ? self : this));
