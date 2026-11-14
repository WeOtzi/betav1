/**
 * WE OTZI - Repositorio de bajas de cuenta (ronda 3c · grupo "borrado")
 * ---------------------------------------------------------------------
 * Tabla account_deletion_requests (migración 20261113103000). Lecturas con
 * RLS (el usuario ve las suyas; soporte, todas). Escrituras SOLO por RPC
 * security definer:
 *   request_account_deletion(role, reason)      → usuario
 *   cancel_account_deletion(id)                 → usuario (mientras esté abierta)
 *   account_deletion_blockers(user_id)          → usuario (propio) o soporte
 *   support_review_account_deletion(id, action, note) → soporte
 * El borrado real y los emails van por el servidor:
 *   POST /api/account-deletion/notify                 (dueño o soporte)
 *   POST /api/support/account-deletions/:id/execute   (soporte)
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone WeotziData.AccountDeletion.
 */
(function (root) {
    'use strict';

    var D = root.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[account-deletion-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    var run = D.run;
    var OPEN = ['pending', 'in_review', 'blocked', 'approved'];
    var SELECT = 'id, user_id, role, reason, status, support_notes, blockers, blockers_checked_at, email_snapshot, name_snapshot, requested_at, reviewed_at, decided_at, cancelled_at, completed_at, updated_at';

    function rpcRow(data) { return Array.isArray(data) ? (data[0] || null) : (data || null); }

    async function session() {
        var clients = [];
        try { if (typeof D.getClient === 'function') clients.push(D.getClient()); } catch (_) { /* sin cliente */ }
        if (root._supabase) clients.push(root._supabase);
        for (var i = 0; i < clients.length; i++) {
            var c = clients[i];
            if (!c || !c.auth || typeof c.auth.getSession !== 'function') continue;
            try {
                var res = await c.auth.getSession();
                var s = res && res.data && res.data.session;
                if (s && s.user) return s;
            } catch (_) { /* probamos el siguiente */ }
        }
        return null;
    }

    async function post(url, body) {
        var s = await session();
        if (!s || !s.access_token || typeof root.fetch !== 'function') return null;
        try {
            var res = await root.fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + s.access_token },
                body: JSON.stringify(body || {}),
                credentials: 'same-origin',
                cache: 'no-store'
            });
            var json = await res.json().catch(function () { return {}; });
            return { ok: res.ok && !!(json && json.success), status: res.status, json: json || {} };
        } catch (err) {
            return { ok: false, status: 0, json: { error: err && err.message } };
        }
    }

    var available = null;

    var AccountDeletion = {
        OPEN_STATUSES: OPEN,

        async isAvailable() {
            if (available !== null) return available;
            try {
                await run('accountDeletion.probe', function (c) {
                    return c.from('account_deletion_requests').select('id', { count: 'exact', head: true });
                });
                available = true;
            } catch (err) {
                console.warn('[account-deletion-repo] tabla no disponible:', err && err.message);
                available = false;
            }
            return available;
        },

        async currentUserId() {
            var s = await session();
            return s && s.user ? s.user.id : null;
        },

        // Últimas solicitudes del usuario logueado (la más nueva primero).
        async mine() {
            var uid = await this.currentUserId();
            if (!uid) return [];
            var res = await run('accountDeletion.mine', function (c) {
                return c.from('account_deletion_requests').select(SELECT).eq('user_id', uid)
                    .order('requested_at', { ascending: false }).limit(10);
            });
            return res.data || [];
        },

        async blockers(userId) {
            var uid = userId || await this.currentUserId();
            if (!uid) return [];
            var res = await run('accountDeletion.blockers', function (c) {
                return c.rpc('account_deletion_blockers', { p_user_id: uid });
            });
            return Array.isArray(res.data) ? res.data : [];
        },

        async request(role, reason) {
            var res = await run('accountDeletion.request', function (c) {
                return c.rpc('request_account_deletion', { p_role: role, p_reason: reason || null });
            });
            return rpcRow(res.data);
        },

        async cancel(id) {
            var res = await run('accountDeletion.cancel', function (c) {
                return c.rpc('cancel_account_deletion', { p_request_id: id });
            });
            return rpcRow(res.data);
        },

        // Email del estado actual (el servidor relee la fila; una vez por estado).
        notify(id) { return post('/api/account-deletion/notify', { id: id }); },

        // ---------------- soporte ----------------

        // status: 'open' | 'pending' | … | 'all'
        async list(status) {
            var res = await run('accountDeletion.list', function (c) {
                var q = c.from('account_deletion_requests').select(SELECT);
                if (status === 'open') q = q.in('status', OPEN);
                else if (status && status !== 'all') q = q.eq('status', status);
                return q.order('requested_at', { ascending: true }).limit(300);
            });
            return res.data || [];
        },

        async countOpen() {
            var res = await run('accountDeletion.countOpen', function (c) {
                return c.from('account_deletion_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_review']);
            });
            return res.count || 0;
        },

        async events(requestId) {
            var res = await run('accountDeletion.events', function (c) {
                return c.from('account_deletion_events').select('id, actor_role, action, from_status, to_status, detail, created_at')
                    .eq('request_id', requestId).order('created_at', { ascending: false }).limit(50);
            });
            return res.data || [];
        },

        // action: in_review | blocked | approved | rejected | note | refresh
        async review(id, action, note) {
            var res = await run('accountDeletion.review', function (c) {
                return c.rpc('support_review_account_deletion', { p_request_id: id, p_action: action, p_note: note || null });
            });
            return rpcRow(res.data);
        },

        execute(id, confirm) {
            return post('/api/support/account-deletions/' + encodeURIComponent(id) + '/execute', { confirm: confirm });
        }
    };

    D.AccountDeletion = AccountDeletion;
}(typeof window !== 'undefined' ? window : this));
