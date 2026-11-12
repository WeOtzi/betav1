/**
 * Fixtures de preview/demo · área "pagos" (ronda 3, 12 nov 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Cubre la migración NO aplicada 20261112170000_quotation_payments_wallet_support:
 *   - quotation_payments: seña de Sofía (DEMO-D01), pago de sesión de Mateo
 *     (DEMO-D02, «Pago recibido · Mateo · $180» del Figma 24:1425) y seña +
 *     saldo de Lucía (DEMO-D03, pagada en su totalidad).
 *   - artist_manual_quotes enviada para DEMO-S01 con seña del 30 % pendiente
 *     (801:556 → 801:577).
 *   - Movimientos informativos «Cobrado por fuera» en artist_wallet_movements
 *     (no cambian los saldos de la extensión "cuenta").
 *   - RPC record_quotation_payment / void_quotation_payment (espejo del SQL).
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['pagos'] = function (ctx) {
        var tables = ctx.tables;
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var now = Date.now();
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        var CURRENCIES = ['USD', 'CAD', 'MXN', 'CRC', 'COP', 'VES', 'PEN', 'BRL', 'ARS', 'CLP', 'UYU',
            'EUR', 'GBP', 'CHF', 'DKK', 'NOK', 'SEK', 'PLN', 'KRW', 'THB', 'IDR', 'JPY', 'AUD', 'NZD'];
        var PAYABLE = ['responded', 'client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];
        var LABELS = { deposit: 'Seña recibida', balance: 'Saldo recibido', session: 'Pago de sesión recibido', other: 'Pago recibido' };

        function pad2(n) { return String(n).padStart(2, '0'); }
        function dateOnly(offsetDays) {
            var d = new Date(now + offsetDays * DAY);
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }
        function id(n) { return '0000a9a0-0000-4000-8000-9a' + String(n).padStart(10, '0'); }

        ['quotation_payments', 'artist_manual_quotes', 'artist_wallet_movements'].forEach(function (t) {
            if (ctx.TABLES.indexOf(t) === -1) ctx.TABLES.push(t);
        });

        var quotes = tables.quotations_db || [];
        function byRef(ref) { return quotes.find(function (q) { return q.quote_id === ref; }) || null; }

        function movementFor(p) {
            return {
                id: 'mv-' + p.id, artist_user_id: p.artist_user_id, kind: 'payment', status: 'completed',
                amount: p.amount, currency: p.currency,
                title: (LABELS[p.kind] || 'Pago recibido') + (p.client_name ? ' — ' + p.client_name : ''),
                counterparty_name: p.client_name, booking_reference: p.quote_id, quote_id: p.quote_id,
                destination_id: null, service_date: p.paid_on, release_at: null,
                occurred_at: p.created_at, external_reference: 'quotation_payment:' + p.id,
                metadata_json: { source: 'manual_payment', off_platform: true, informational: true, payment_id: p.id, payment_kind: p.kind, method: p.method, quotation_id: p.quotation_id },
                created_at: p.created_at, updated_at: p.created_at
            };
        }

        // [ref, kind, method, monto, díasAtrás, horasAtrás(alta), nota]
        var SEED = [
            ['DEMO-D01', 'deposit', 'transfer', 75, 8, null, 'Seña del 30 % por transferencia'],
            ['DEMO-D02', 'session', 'cash', 180, 0, 1, 'Sesión 1 en efectivo'],
            ['DEMO-D03', 'deposit', 'cash', 54, 18, null, null],
            ['DEMO-D03', 'balance', 'transfer', 126, 6, null, 'Saldo al cerrar la segunda sesión']
        ];
        var payments = [];
        SEED.forEach(function (s, i) {
            var q = byRef(s[0]);
            if (!q) return;
            var created = s[5] != null ? new Date(now - s[5] * 3600000).toISOString() : new Date(now - s[4] * DAY).toISOString();
            payments.push({
                id: id(i + 1), quotation_id: q.id, quote_id: q.quote_id, artist_user_id: artistId,
                kind: s[1], method: s[2], amount: s[3], currency: 'USD', paid_on: dateOnly(-s[4]), note: s[6],
                client_name: q.client_full_name || null, receipt_path: null, receipt_name: null, receipt_mime: null,
                receipt_size: null, created_at: created
            });
        });
        tables.quotation_payments = payments;

        // Cotización manual enviada con seña pendiente (DEMO-S01, 380 USD · 30 %).
        var s01 = byRef('DEMO-S01');
        tables.artist_manual_quotes = (tables.artist_manual_quotes || []).concat(s01 ? [{
            id: 'a1d0e000-0000-4000-8000-0000000005a1', artist_id: artistId, quote_ref: 'DEMO-S01', status: 'sent', origin: 'manual',
            artist_client_id: null, quote_id: 'DEMO-S01', client: { name: s01.client_full_name }, project: { title: s01.project_description },
            line_items: [{ id: 'its01', name: 'Brazalete geométrico', description: null, qty: 1, price: 380 }],
            currency: 'USD', discount_pct: 0, tax_pct: 0, deposit_pct: 30, subtotal: 380, total: 380, deposit_amount: 114,
            validity_days: 14, cancellation_policy: 'no-reembolsable-48', client_notes: null, extra_terms: null,
            created_at: s01.created_at, updated_at: s01.updated_at, sent_at: s01.updated_at
        }] : []);

        tables.artist_wallet_movements = (tables.artist_wallet_movements || []).concat(payments.map(movementFor));

        /* ------------------- RPC (espejo de la migración) ------------------- */
        function fail(msg) { throw new Error(msg); }

        ctx.rpcs.record_quotation_payment = function (args, store, rpcCtx) {
            var uid = (rpcCtx && rpcCtx.userId) || artistId;
            var q = store.rows('quotations_db').find(function (r) { return Number(r.id) === Number(args.p_quotation_id); });
            if (!q || q.artist_id !== uid) fail('No encontramos esa cotización en tu cuenta.');
            if (PAYABLE.indexOf(q.quote_status) === -1) fail('Solo podés registrar pagos de cotizaciones respondidas o con acuerdo.');
            if (['deposit', 'session', 'balance', 'other'].indexOf(args.p_kind) === -1) fail('Elegí el tipo de pago.');
            if (['cash', 'transfer', 'other'].indexOf(args.p_method) === -1) fail('Elegí el medio de pago.');
            var amount = Number(args.p_amount);
            if (!(amount > 0) || amount > 1e9 || Math.round(amount * 100) / 100 !== amount) fail('Ingresá un monto mayor a cero, con hasta 2 decimales.');
            var cur = String(args.p_currency || '').toUpperCase();
            if (CURRENCIES.indexOf(cur) === -1) fail('Elegí una moneda de la lista.');
            var paidOn = args.p_paid_on || dateOnly(0);
            if (paidOn > dateOnly(1)) fail('La fecha del pago no puede ser futura.');
            var row = {
                id: id(1000 + store.rows('quotation_payments').length + Math.floor(Math.random() * 1000)),
                quotation_id: q.id, quote_id: q.quote_id, artist_user_id: uid, kind: args.p_kind, method: args.p_method,
                amount: amount, currency: cur, paid_on: paidOn, note: args.p_note ? String(args.p_note).trim() || null : null,
                client_name: q.client_full_name || null, receipt_path: args.p_receipt_path || null,
                receipt_name: args.p_receipt_path ? args.p_receipt_name : null, receipt_mime: args.p_receipt_path ? args.p_receipt_mime : null,
                receipt_size: args.p_receipt_path ? args.p_receipt_size : null, created_at: new Date().toISOString()
            };
            store.insert('quotation_payments', [row]);
            store.insert('artist_wallet_movements', [movementFor(row)]);
            return row;
        };

        ctx.rpcs.void_quotation_payment = function (args, store, rpcCtx) {
            var uid = (rpcCtx && rpcCtx.userId) || artistId;
            var row = store.rows('quotation_payments').find(function (p) { return String(p.id) === String(args.p_payment_id); });
            if (!row || row.artist_user_id !== uid) fail('No encontramos ese pago en tu cuenta.');
            store.remove('quotation_payments', [{ col: 'id', op: 'eq', value: String(row.id), negated: false }]);
            store.rows('artist_wallet_movements').forEach(function (m) {
                if (m.external_reference === 'quotation_payment:' + row.id) {
                    m.status = 'cancelled';
                    m.metadata_json = Object.assign({}, m.metadata_json, { voided_at: new Date().toISOString() });
                }
            });
            return { id: row.id, quotation_id: row.quotation_id, receipt_path: row.receipt_path };
        };

        /* ------- RPC de soporte (el preview no tiene rol de soporte: solo las reglas de datos) ------- */
        function reviewNote(decisionReject, note) {
            var clean = String(note == null ? '' : note).trim();
            if (decisionReject && clean.length < 5) fail('Escribí el motivo del rechazo (mínimo 5 caracteres).');
            if (clean.length > 500) fail('La nota puede tener hasta 500 caracteres.');
            return clean || null;
        }
        function patchOne(store, table, rowId, patch) {
            return store.update(table, [{ col: 'id', op: 'eq', value: String(rowId), negated: false }], patch)[0] || null;
        }

        ctx.rpcs.support_review_payout_destination = function (args, store) {
            if (['verified', 'rejected'].indexOf(args.p_decision) === -1) fail('Decisión inválida.');
            var note = reviewNote(args.p_decision === 'rejected', args.p_note);
            var dest = store.rows('artist_payout_destinations').find(function (d) { return String(d.id) === String(args.p_destination_id) && d.active; });
            if (!dest) fail('No encontramos ese destino (o fue dado de baja).');
            var at = new Date().toISOString();
            return patchOne(store, 'artist_payout_destinations', dest.id, {
                verification_status: args.p_decision, verified_at: args.p_decision === 'verified' ? at : null,
                metadata_json: Object.assign({}, dest.metadata_json, { review: { decision: args.p_decision, note: note, reviewed_at: at } })
            });
        };

        ctx.rpcs.support_review_verification_document = function (args, store) {
            if (['verificado', 'rechazado'].indexOf(args.p_decision) === -1) fail('Decisión inválida.');
            var note = reviewNote(args.p_decision === 'rechazado', args.p_note);
            var doc = store.rows('artist_verification_documents').find(function (d) { return String(d.id) === String(args.p_document_id); });
            if (!doc) fail('No encontramos ese documento.');
            return patchOne(store, 'artist_verification_documents', doc.id, { status: args.p_decision, reviewed_at: new Date().toISOString(), reviewer_notes: note });
        };

        ctx.rpcs.support_set_artist_verification_state = function (args, store) {
            if (['Yes', 'Denied', 'Requested', 'No'].indexOf(args.p_state) === -1) fail('Estado de verificación inválido.');
            var artist = store.rows('artists_db').find(function (a) { return String(a.user_id) === String(args.p_artist_user_id); });
            if (!artist) fail('No encontramos ese artista.');
            store.update('artists_db', [{ col: 'user_id', op: 'eq', value: String(artist.user_id), negated: false }], { verification_state: args.p_state });
            return args.p_state;
        };
    };
}(typeof self !== 'undefined' ? self : this));
