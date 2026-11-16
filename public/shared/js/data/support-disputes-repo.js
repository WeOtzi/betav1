/**
 * WE OTZI - Repositorio de disputas para el panel de soporte (frontend)
 * ----------------------------------------------------------------------
 * Ronda 2 · P28 (REQ-15). Las disputas son tickets de soporte kind='disputa'
 * (las de sesión las abre POST /api/sesiones/:id/dispute). Se leen y se
 * gestionan SOLO por el servidor, que autoriza al agente de soporte activo o
 * al superadmin:
 *   GET  /api/support/disputes?status=
 *   GET  /api/support/disputes/:ticketId
 *   POST /api/support/disputes/:ticketId/status   { status, resolution, outcome }
 *   POST /api/support/disputes/:ticketId/notes    { note }
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone WeotziData.SupportDisputes.
 * Cada método devuelve { ok, status, json }.
 */
(function (root) {
    'use strict';

    var D = root.WeotziData;
    if (!D || typeof D.getClient !== 'function') {
        console.error('[support-disputes-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var p = (root.location && root.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    async function session() {
        var clients = [];
        try { clients.push(D.getClient()); } catch (_) { /* sin cliente */ }
        if (root._supabase) clients.push(root._supabase);
        for (var i = 0; i < clients.length; i++) {
            var c = clients[i];
            if (!c || !c.auth || typeof c.auth.getSession !== 'function') continue;
            try {
                var res = await c.auth.getSession();
                var s = res && res.data && res.data.session;
                if (s && s.user && s.access_token) return s;
            } catch (_) { /* probamos el siguiente */ }
        }
        return null;
    }

    async function call(method, path, body) {
        var s = await session();
        if (!s || typeof root.fetch !== 'function') {
            return { ok: false, status: 401, json: { error: 'Inicia sesión con tu usuario de soporte.' } };
        }
        try {
            var headers = { Accept: 'application/json', Authorization: 'Bearer ' + s.access_token };
            if (body) headers['Content-Type'] = 'application/json';
            var res = await root.fetch(basePath() + path, {
                method: method,
                headers: headers,
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'same-origin',
                cache: 'no-store'
            });
            var json = await res.json().catch(function () { return {}; });
            return { ok: res.ok && !!(json && json.success), status: res.status, json: json || {} };
        } catch (err) {
            return { ok: false, status: 0, json: { error: 'No pudimos conectar con el servidor. Revisa tu conexión.' } };
        }
    }

    function ticketPath(ticketId, suffix) {
        if (!UUID_RE.test(String(ticketId || ''))) return null;
        return '/api/support/disputes/' + encodeURIComponent(ticketId) + (suffix || '');
    }

    var invalid = { ok: false, status: 400, json: { error: 'ID de ticket inválido.' } };

    D.SupportDisputes = {
        hasSession: async function () { return !!(await session()); },

        // filters: { status: 'active' | 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed' | 'all' }
        list: function (filters) {
            var f = filters || {};
            return call('GET', '/api/support/disputes?status=' + encodeURIComponent(f.status || 'active'));
        },

        get: function (ticketId) {
            var path = ticketPath(ticketId);
            return path ? call('GET', path) : Promise.resolve(invalid);
        },

        setStatus: function (ticketId, payload) {
            var path = ticketPath(ticketId, '/status');
            return path ? call('POST', path, payload || {}) : Promise.resolve(invalid);
        },

        addNote: function (ticketId, note) {
            var path = ticketPath(ticketId, '/notes');
            return path ? call('POST', path, { note: note }) : Promise.resolve(invalid);
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
