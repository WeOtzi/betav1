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

        // Ronda 3 · "Solicitud pendiente" real: la cotización pendiente pide
        // una fecha concreta (proyección de solo lectura en el mural).
        if (pendingQuote && !/\d{4}|\d{1,2}\s+\w{3}/.test(String(pendingQuote.client_preferred_date || ''))) {
            pendingQuote.client_preferred_date = dateOnly(4);
            pendingQuote.client_flexible_dates = 'false';
        }

        // Ronda 3 · recordatorio con hora en artist_reminders (aviso in-app).
        if (!tables.artist_reminders) tables.artist_reminders = [];
        if (ctx.TABLES && ctx.TABLES.indexOf('artist_reminders') < 0) ctx.TABLES.push('artist_reminders');
        var reminderId = '0000c0de-0000-4000-8000-ca1e00000901';
        if (!tables.artist_reminders.some(function (r) { return r.id === reminderId; })) {
            tables.artist_reminders.push({
                id: reminderId, artist_user_id: artistId, title: 'Llamar al proveedor de tintas', detail: 'Pedir 3RL y 5RM.',
                icon: 'bell', due_date: dateOnly(0), due_at: at(0, '18:00'), recurrence_rule: 'none', recurrence_until: null,
                last_notified_at: null, priority: 'normal', is_important: true, attachments: [], completed_at: null,
                created_at: daysAgo(3), updated_at: daysAgo(1)
            });
        }

        // Ronda 3 · agenda pública del artista para el cotizador
        // (list_artist_public_busy_days): solo fecha + estado.
        if (!ctx.rpcs) ctx.rpcs = {};
        ctx.rpcs.list_artist_public_busy_days = function (args, store) {
            var marks = {};
            function key(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
            function mark(date, level) { var k = key(date); marks[k] = Math.max(marks[k] || 0, level); }
            function eachDay(startIso, endExclusiveIso, level) {
                var d = new Date(startIso); d.setHours(0, 0, 0, 0);
                var end = new Date(endExclusiveIso);
                for (var i = 0; i < 400 && d < end; i += 1) { mark(d, level); d.setDate(d.getDate() + 1); }
            }
            (store.rows('artist_calendar_events') || []).forEach(function (e) {
                if (e.artist_user_id !== args.p_artist_user_id || e.status === 'cancelled') return;
                var weeks = e.recurrence_rule === 'weekly' ? 12 : 1;
                for (var w = 0; w < weeks; w += 1) {
                    var s = new Date(Date.parse(e.starts_at) + w * 7 * DAY).toISOString();
                    var f = new Date(Date.parse(e.ends_at) + w * 7 * DAY).toISOString();
                    if (['blocked_day', 'guest_spot', 'convention'].indexOf(e.event_type) >= 0 && e.all_day) eachDay(s, f, 3);
                    else if (e.event_type === 'personal' && e.all_day) eachDay(s, f, 3);
                    else if (e.event_type === 'availability') eachDay(s, f, 1);
                }
            });
            (store.rows('artist_trips') || []).forEach(function (t) {
                if (t.artist_user_id !== args.p_artist_user_id || t.status === 'cancelado') return;
                eachDay(t.start_date + 'T00:00:00', new Date(Date.parse(t.end_date + 'T00:00:00') + DAY).toISOString(), 3);
            });
            var labels = ['', 'available', 'full', 'unavailable'];
            return Object.keys(marks).sort().filter(function (d) {
                return (!args.p_from || d >= args.p_from) && (!args.p_to || d <= args.p_to);
            }).map(function (d) { return { busy_date: d, busy_status: labels[marks[d]] }; });
        };
    };
}(typeof self !== 'undefined' ? self : this));
