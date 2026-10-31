/**
 * Fixtures de preview/demo · área "cuenta" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Cubre /artist/account:
 *   - We Ötzi Wallet (tablas nuevas de la migración NO aplicada
 *     20261028150000_artist_wallet.sql): destinos de retiro, movimientos y
 *     lista de espera de la We Ötzi Card, más las RPC de retiro y destino
 *     predeterminado.
 *   - Documentos de verificación (identidad y bioseguridad verificados,
 *     domicilio pendiente).
 *   - Disponibilidad por ubicación: horarios en user_preferences y ubicaciones
 *     extra (estudio privado + dos destinos Travel) en artist_tattoo_locations.
 *
 * Los montos cierran entre sí: disponible USD 1.240 · pendiente por servicio
 * USD 900 · esperando liberación USD 360 · bloqueado USD 700 · en retiro USD 500.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['cuenta'] = function (ctx) {
        var tables = ctx.tables;
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var HOUR = 3600000;
        var now = Date.now();
        var artistId = (ctx.identity && ctx.identity.userId) || null;

        function id(n) { return '0000c0de-0000-4000-8000-cc' + String(n).padStart(10, '0'); }
        function pad2(n) { return String(n).padStart(2, '0'); }
        function daysAgo(n) { return new Date(now - n * DAY).toISOString(); }
        function hoursFromNow(n) { return new Date(now + n * HOUR).toISOString(); }
        function dateOnly(offset) {
            var d = new Date(now + offset * DAY);
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }

        ['artist_payout_destinations', 'artist_wallet_movements', 'wallet_card_waitlist'].forEach(function (t) {
            if (ctx.TABLES.indexOf(t) === -1) ctx.TABLES.push(t);
        });

        /* ---------------------------- destinos ---------------------------- */
        var lemon = id(101), bankUsd = id(102), santander = id(103);
        tables.artist_payout_destinations = [
            { id: lemon, artist_user_id: artistId, method: 'lemon', label: 'Lemon', holder_name: 'Titular de prueba', currency: 'USD', account_identifier: 'lemon.demo.4821', rail: 'ACH', country_code: 'US', verification_status: 'verified', verified_at: daysAgo(80), is_default: true, active: true, metadata_json: { account_type: 'Cuenta USD en Estados Unidos' }, created_at: daysAgo(90), updated_at: daysAgo(80) },
            { id: bankUsd, artist_user_id: artistId, method: 'bank_usd', label: 'Cuenta bancaria USD', holder_name: 'Titular de prueba', currency: 'USD', account_identifier: '000123451190', rail: 'ACH', country_code: 'US', verification_status: 'verified', verified_at: daysAgo(60), is_default: false, active: true, metadata_json: {}, created_at: daysAgo(70), updated_at: daysAgo(60) },
            { id: santander, artist_user_id: artistId, method: 'bank_international', label: 'Banco Santander España', holder_name: 'Titular de prueba', currency: 'EUR', account_identifier: 'ES9100490001512345677734', rail: 'SEPA', country_code: 'ES', verification_status: 'verified', verified_at: daysAgo(40), is_default: false, active: true, metadata_json: {}, created_at: daysAgo(45), updated_at: daysAgo(40) }
        ];

        /* --------------------------- movimientos --------------------------- */
        // kind, status, monto, título, contraparte, reserva, quote_id, hace (días), extra
        var MOVES = [
            ['withdrawal', 'processing', 500, 'Retiro a Cuenta bancaria USD', null, null, null, 1, { destination_id: bankUsd }],
            ['release', 'completed', 1240, 'Fondos liberados — Martín Aguirre', 'Martín Aguirre', '#WO-4281', 'DEMO-C01', 2, {}],
            ['payment', 'awaiting_release', 360, 'Pago recibido — Lucía Beltrán', 'Lucía Beltrán', '#WO-4322', 'DEMO-D03', 3, { release_at: hoursFromNow(18) }],
            ['withdrawal', 'completed', 900, 'Retiro a Lemon', null, null, null, 8, { destination_id: lemon }],
            ['payment', 'pending_service', 680, 'Pago recibido — Sofía Martínez', 'Sofía Martínez', '#WO-4340', 'DEMO-D01', 9, { service_date: dateOnly(9) }],
            ['release', 'completed', 980, 'Fondos liberados — Paula Giménez', 'Paula Giménez', '#WO-4210', 'DEMO-C02', 11, {}],
            ['fee', 'completed', 60, 'Comisión We Ötzi', null, null, null, 13, { metadata_json: { detail: 'Comisión por servicio' } }],
            ['dispute', 'blocked', 700, 'Disputa abierta — Costa Ink Collective', 'Costa Ink Collective', '#WO-4199', null, 16, {}],
            ['payment', 'pending_service', 220, 'Pago recibido — Mateo Ruiz', 'Mateo Ruiz', '#WO-4356', 'DEMO-D02', 18, { service_date: dateOnly(20) }],
            ['release', 'completed', 480, 'Fondos liberados — Rocío Cabrera', 'Rocío Cabrera', '#WO-4170', 'DEMO-C04', 21, {}],
            ['payment', 'blocked', 1200, 'Pago recibido — Costa Ink Collective', 'Costa Ink Collective', '#WO-4199', null, 30, {}]
        ];
        tables.artist_wallet_movements = MOVES.map(function (m, i) {
            return Object.assign({
                id: id(201 + i), artist_user_id: artistId, kind: m[0], status: m[1], amount: m[2], currency: 'USD',
                title: m[3], counterparty_name: m[4], booking_reference: m[5], quote_id: m[6], destination_id: null,
                service_date: null, release_at: null, occurred_at: daysAgo(m[7]), external_reference: null,
                metadata_json: {}, created_at: daysAgo(m[7]), updated_at: daysAgo(m[7])
            }, m[8]);
        });
        tables.wallet_card_waitlist = [];

        /* ---------------------- documentos de verificación ---------------------- */
        if (!tables.artist_verification_documents || !tables.artist_verification_documents.length) {
            tables.artist_verification_documents = [
                ['identidad', 'dni-frente-dorso.pdf', 'verificado', 138],
                ['bioseguridad', 'certificado-bioseguridad-2026.pdf', 'verificado', 120],
                ['domicilio', 'factura-servicio.pdf', 'pendiente', null]
            ].map(function (d, i) {
                return {
                    id: id(301 + i), artist_user_id: artistId, doc_type: d[0], file_name: d[1],
                    storage_path: artistId + '/' + d[0] + '-demo.pdf', status: d[2],
                    uploaded_at: daysAgo(d[3] != null ? d[3] + 3 : 4), reviewed_at: d[3] != null ? daysAgo(d[3]) : null,
                    reviewer_notes: null
                };
            });
        }

        /* ------------------------ disponibilidad ------------------------ */
        var privado = id(401), cdmx = id(402), berlin = id(403);
        var weekdays = function (start, end, days, extra) {
            return ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].map(function (day) {
                var on = days.indexOf(day) !== -1;
                var custom = extra && extra[day];
                return { day: day, enabled: on || !!custom, start: custom ? custom[0] : start, end: custom ? custom[1] : end };
            });
        };
        var baseWeekly = weekdays('10:00', '19:00', ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']);
        var prefs = tables.user_preferences && tables.user_preferences[0];
        if (prefs) {
            prefs.app_settings = prefs.app_settings || {};
            var locs = {};
            locs['preview-location'] = { weekly: baseWeekly };
            locs[privado] = { weekly: weekdays('12:00', '20:00', ['martes', 'miercoles', 'jueves', 'viernes']) };
            locs[cdmx] = { weekly: weekdays('11:00', '20:00', ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'], { sabado: ['12:00', '18:00'] }) };
            locs[berlin] = { weekly: weekdays('11:00', '19:00', ['martes', 'miercoles', 'jueves', 'viernes', 'sabado']) };
            prefs.app_settings.availability = Object.assign({}, prefs.app_settings.availability || {}, { weekly: baseWeekly, locations: locs });
            // Recuperación (Seguridad): teléfono verificado, pregunta sin configurar.
            prefs.app_settings.recovery = Object.assign({ phone: { status: 'verified', number_masked: '···· 5678', verified_at: daysAgo(120) } }, prefs.app_settings.recovery || {});
        }

        /* ------------------------ sesiones de la cuenta ------------------------ */
        if (Array.isArray(tables.artist_account_sessions) && !tables.artist_account_sessions.some(function (s) { return s.id === id(501); })) {
            tables.artist_account_sessions.push({ id: id(501), artist_user_id: artistId, auth_session_id: id(591), device_name: 'iPad Air', browser: 'Safari', operating_system: 'iPadOS', city: 'Córdoba', country: 'Argentina', user_agent_hash: 'ua-cuenta-ipad', first_seen_at: daysAgo(40), last_seen_at: daysAgo(5), revoked_at: null, revoke_reason: null });
        }

        // El preview local (scripts/release/preview-bootstrap.js) asigna su propia
        // ubicación base DESPUÉS de build(); este setter le suma las ubicaciones
        // de la cuenta sin pisarla. En el modo demo sobre backend real nadie
        // asigna la tabla y la propiedad queda oculta: se leen las reales.
        var extraLocations = [
            { id: privado, artist_user_id: artistId, period_type: 'current', studio_id: null, studio_name: 'Estudio privado — Villa Crespo', city: 'Buenos Aires', country: 'Argentina', address: 'Villa Crespo, Buenos Aires', agenda_status: 'open', start_date: null, end_date: null, sort_order: 1, created_at: daysAgo(200), updated_at: daysAgo(30) },
            { id: cdmx, artist_user_id: artistId, period_type: 'upcoming', studio_id: null, studio_name: 'Tinta Negra Studio', city: 'Ciudad de México', country: 'México', neighborhood: 'Roma Norte', agenda_status: 'open', start_date: dateOnly(-2), end_date: dateOnly(12), sort_order: 0, created_at: daysAgo(40), updated_at: daysAgo(5) },
            { id: berlin, artist_user_id: artistId, period_type: 'upcoming', studio_id: null, studio_name: 'Blut & Tinte', city: 'Berlín', country: 'Alemania', neighborhood: 'Kreuzberg', agenda_status: 'closed', start_date: dateOnly(60), end_date: dateOnly(74), sort_order: 1, created_at: daysAgo(20), updated_at: daysAgo(3) }
        ];
        if (!Object.prototype.hasOwnProperty.call(tables, 'artist_tattoo_locations')) {
            var pending;
            Object.defineProperty(tables, 'artist_tattoo_locations', {
                configurable: true,
                enumerable: false,
                get: function () { return pending; },
                set: function (rows) {
                    var base = Array.isArray(rows) ? rows : [];
                    var merged = base.concat(extraLocations.filter(function (e) { return !base.some(function (r) { return r.id === e.id; }); }));
                    Object.defineProperty(tables, 'artist_tattoo_locations', { value: merged, writable: true, enumerable: true, configurable: true });
                }
            });
        }

        /* ------------------------------ RPCs ------------------------------ */
        function availableBalance(store, uidValue, currency) {
            return store.rows('artist_wallet_movements').reduce(function (sum, m) {
                if (m.artist_user_id !== uidValue || m.currency !== currency) return sum;
                var amount = Number(m.amount) || 0;
                if ((m.kind === 'release' || m.kind === 'adjustment') && m.status === 'completed') return sum + amount;
                if (m.kind === 'withdrawal' && (m.status === 'processing' || m.status === 'completed')) return sum - amount;
                if ((m.kind === 'fee' || m.kind === 'refund') && m.status === 'completed') return sum - amount;
                return sum;
            }, 0);
        }
        ctx.rpcs.request_artist_wallet_withdrawal = function (args, store, rpcCtx) {
            var userId = (rpcCtx && rpcCtx.userId) || artistId;
            var dest = store.rows('artist_payout_destinations').find(function (d) { return d.id === args.p_destination_id && d.active; });
            if (!dest) throw new Error('payout destination not found');
            if (dest.verification_status !== 'verified') throw new Error('payout destination not verified');
            var amount = Math.round(Number(args.p_amount) * 100) / 100;
            var currency = String(args.p_currency || 'USD').toUpperCase();
            if (!(amount > 0)) throw new Error('invalid amount');
            if (amount > availableBalance(store, dest.artist_user_id || userId, currency) + 1e-9) throw new Error('insufficient balance');
            var nowIso = new Date().toISOString();
            return store.insert('artist_wallet_movements', [{
                artist_user_id: dest.artist_user_id || userId, kind: 'withdrawal', status: 'processing', amount: amount, currency: currency,
                title: 'Retiro a ' + dest.label, counterparty_name: null, booking_reference: null, quote_id: null,
                destination_id: dest.id, service_date: null, release_at: null, occurred_at: nowIso, external_reference: null,
                metadata_json: { requested_by: 'artist' }, updated_at: nowIso
            }])[0];
        };
        ctx.rpcs.set_artist_default_payout_destination = function (args, store) {
            store.rows('artist_payout_destinations').forEach(function (d) { d.is_default = d.active && d.id === args.p_destination_id; });
            return null;
        };

    };
}(typeof self !== 'undefined' ? self : this));
