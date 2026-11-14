/**
 * Fixtures de preview/demo · área "borrado" (bajas de cuenta, ronda 3c).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build().
 *
 *   - account_deletion_requests / account_deletion_events: vacías (el usuario
 *     demo todavía no pidió la baja).
 *   - account_deletion_blockers(p_user_id): calcula sobre las tablas en
 *     memoria los mismos chequeos que la RPC real que se pueden simular
 *     (trabajos en curso, cotizaciones abiertas, membresías activas e
 *     invitaciones de estudios).
 *   - request_account_deletion / cancel_account_deletion /
 *     support_review_account_deletion: mismas reglas que la migración
 *     20261113103000 (una abierta por usuario, aprobar sin bloqueos, nota
 *     obligatoria para rechazar o bloquear). Nada se borra en el demo.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['borrado'] = function (ctx) {
        var tables = ctx.tables;
        ['account_deletion_requests', 'account_deletion_events'].forEach(function (t) {
            if (ctx.TABLES.indexOf(t) < 0) ctx.TABLES.push(t);
        });
        tables.account_deletion_requests = [];
        tables.account_deletion_events = [];

        var OPEN = ['pending', 'in_review', 'blocked', 'approved'];
        var WORK = ['client_approved', 'in_progress', 'en_progreso', 'artist_completed'];
        function nowIso() { return new Date().toISOString(); }
        function item(code, severity, label, detail, count, href) {
            return { code: code, severity: severity, label: label, detail: detail, count: count, href: href };
        }
        function fail(message) { var e = new Error(message); e.message = message; throw e; }

        function blockers(store, uid) {
            var out = [];
            var quotes = store.rows('quotations_db').filter(function (q) { return q.artist_id === uid || q.client_user_id === uid; });
            var isArtist = store.rows('quotations_db').some(function (q) { return q.artist_id === uid; });
            var work = quotes.filter(function (q) { return WORK.indexOf(q.quote_status) >= 0; }).length;
            if (work) out.push(item('quotes_in_progress', 'block', 'Trabajos en curso', work + ' cotización(es) aprobada(s) o en progreso. Terminalas o cancelalas.', work, isArtist ? '/my-quotations' : '/client/dashboard#mis-cotizaciones'));
            var open = quotes.filter(function (q) { return q.quote_status === 'pending' || q.quote_status === 'responded'; }).length;
            if (open) out.push(item('quotes_open', 'warn', 'Cotizaciones abiertas', open + ' cotización(es) sin aprobar: se cierran al eliminar la cuenta.', open, isArtist ? '/my-quotations' : '/client/dashboard#mis-cotizaciones'));
            var mships = store.rows('studio_artist_memberships').filter(function (m) { return m.artist_user_id === uid; });
            var active = mships.filter(function (m) { return m.status === 'active' || m.status === 'paused'; }).length;
            if (active) out.push(item('studio_memberships', 'block', 'Membresías en estudios', active + ' membresía(s) activa(s) en estudios. Finalizalas primero.', active, '/artist/account#perfil'));
            var invites = mships.filter(function (m) { return m.status === 'pending_invite' || m.status === 'pending_acceptance'; }).length;
            if (invites) out.push(item('studio_invitations', 'warn', 'Invitaciones de estudios', invites + ' invitación(es) pendiente(s): se descartan al eliminar la cuenta.', invites, null));
            return out;
        }
        function hasBlocking(items) { return items.some(function (i) { return i.severity !== 'warn'; }); }
        function find(store, id) { return store.rows('account_deletion_requests').find(function (r) { return r.id === id; }) || null; }
        function log(store, req, actor, uid, action, from, to, detail) {
            store.insert('account_deletion_events', [{ request_id: req.id, actor_user_id: uid, actor_role: actor, action: action,
                from_status: from, to_status: to, detail: detail || {}, created_at: nowIso() }]);
        }

        if (!ctx.rpcs) ctx.rpcs = {};
        ctx.rpcs.account_deletion_blockers = function (args, store, c) {
            return blockers(store, args.p_user_id || (c && c.userId));
        };
        ctx.rpcs.request_account_deletion = function (args, store, c) {
            var uid = c && c.userId;
            if (!uid) fail('Iniciá sesión para pedir la baja.');
            if (['client', 'artist', 'studio'].indexOf(args.p_role) < 0) fail('Tipo de cuenta no válido.');
            if (store.rows('account_deletion_requests').some(function (r) { return r.user_id === uid && OPEN.indexOf(r.status) >= 0; })) fail('Ya tenés una solicitud de baja abierta.');
            var list = blockers(store, uid);
            var who = (store.rows('artists_db').find(function (a) { return a.user_id === uid; }) || store.rows('clients_db').find(function (x) { return x.user_id === uid; }) || {});
            var row = store.insert('account_deletion_requests', [{
                user_id: uid, role: args.p_role, reason: (args.p_reason || '').trim() || null, status: 'pending', support_notes: null,
                blockers: list, blockers_checked_at: nowIso(), email_snapshot: who.email || null, name_snapshot: who.name || who.full_name || null,
                requested_at: nowIso(), reviewed_at: null, decided_at: null, cancelled_at: null, completed_at: null, updated_at: nowIso()
            }])[0];
            log(store, row, 'user', uid, 'requested', null, 'pending', { blocking: hasBlocking(list), items: list.length });
            return row;
        };
        ctx.rpcs.cancel_account_deletion = function (args, store, c) {
            var row = find(store, args.p_request_id);
            if (!row || row.user_id !== (c && c.userId)) fail('No encontramos esa solicitud.');
            if (OPEN.indexOf(row.status) < 0) fail('Esta solicitud ya está cerrada.');
            var from = row.status;
            row.status = 'cancelled'; row.cancelled_at = nowIso(); row.updated_at = nowIso();
            log(store, row, 'user', c.userId, 'cancelled', from, 'cancelled');
            return row;
        };
        ctx.rpcs.support_review_account_deletion = function (args, store, c) {
            var row = find(store, args.p_request_id);
            var action = args.p_action;
            var note = (args.p_note || '').trim() || null;
            if (!row) fail('No encontramos esa solicitud.');
            if (OPEN.indexOf(row.status) < 0) fail('Esta solicitud ya está cerrada.');
            var list = blockers(store, row.user_id);
            if (action === 'approved' && hasBlocking(list)) fail('Todavía hay bloqueos: no se puede aprobar la baja.');
            if ((action === 'rejected' || action === 'blocked') && (!note || note.length < 5)) fail('Escribí una nota para el usuario (mínimo 5 caracteres).');
            var from = row.status;
            if (['in_review', 'blocked', 'approved', 'rejected'].indexOf(action) >= 0) row.status = action;
            row.blockers = list; row.blockers_checked_at = nowIso();
            if (note) row.support_notes = note;
            row.reviewed_at = nowIso(); row.updated_at = nowIso();
            log(store, row, 'support', c && c.userId, action, from, row.status, { note: note });
            return row;
        };
    };
})(typeof self !== 'undefined' ? self : this);
