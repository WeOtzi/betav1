/**
 * WE OTZI - Repositorio del feedback de la beta para el panel de soporte (frontend)
 * ----------------------------------------------------------------------------
 * La tabla public.beta_feedback (migración 20261117120000) se lee y se
 * gestiona SOLO por el servidor (lib/routes/feedback.js), que autoriza al
 * agente de soporte activo o al superadmin y firma las capturas:
 *   GET  /api/support/feedback?role=&kind=&status=&survey_key=&q=&from=&to=&page=&page_size=
 *   GET  /api/support/feedback/summary
 *   GET  /api/support/feedback/export.csv?(mismos filtros)
 *   GET  /api/support/feedback/:id
 *   POST /api/support/feedback/:id        { status?, support_note? }
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone WeotziData.SupportFeedback.
 * Cada método devuelve { ok, status, json } (exportCsv: { ok, status, blob, filename, json }).
 */
(function (root) {
    'use strict';

    var D = root.WeotziData;
    if (!D || typeof D.getClient !== 'function') {
        console.error('[support-feedback-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var FILTER_KEYS = ['role', 'kind', 'status', 'survey_key', 'q', 'from', 'to', 'page', 'page_size', 'include_dismissed'];

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

    var noSession = { ok: false, status: 401, json: { error: 'Inicia sesión con tu usuario de soporte.' } };
    var offline = { ok: false, status: 0, json: { error: 'No pudimos conectar con el servidor. Revisa tu conexión.' } };

    async function send(method, path, body) {
        var s = await session();
        if (!s || typeof root.fetch !== 'function') return { response: null, result: noSession };
        try {
            var headers = { Authorization: 'Bearer ' + s.access_token };
            if (body) headers['Content-Type'] = 'application/json';
            var res = await root.fetch(basePath() + path, {
                method: method,
                headers: headers,
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'same-origin',
                cache: 'no-store'
            });
            return { response: res, result: null };
        } catch (err) {
            return { response: null, result: offline };
        }
    }

    async function call(method, path, body) {
        var sent = await send(method, path, body);
        if (!sent.response) return sent.result;
        var json = await sent.response.json().catch(function () { return {}; });
        return { ok: sent.response.ok && !!(json && json.success), status: sent.response.status, json: json || {} };
    }

    function query(filters) {
        var f = filters || {};
        var parts = [];
        FILTER_KEYS.forEach(function (k) {
            var v = f[k];
            if (v == null || v === '' || v === 'all' || v === false) return;
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v === true ? '1' : String(v)));
        });
        return parts.length ? '?' + parts.join('&') : '';
    }

    var invalid = { ok: false, status: 400, json: { error: 'ID de feedback inválido.' } };

    D.SupportFeedback = {
        hasSession: async function () { return !!(await session()); },
        query: query,

        list: function (filters) { return call('GET', '/api/support/feedback' + query(filters)); },

        summary: function () { return call('GET', '/api/support/feedback/summary'); },

        get: function (id) {
            return UUID_RE.test(String(id || '')) ? call('GET', '/api/support/feedback/' + encodeURIComponent(id)) : Promise.resolve(invalid);
        },

        update: function (id, payload) {
            return UUID_RE.test(String(id || '')) ? call('POST', '/api/support/feedback/' + encodeURIComponent(id), payload || {}) : Promise.resolve(invalid);
        },

        // CSV con los filtros actuales (sin página). El archivo llega como blob.
        exportCsv: async function (filters) {
            var f = Object.assign({}, filters || {});
            delete f.page; delete f.page_size;
            var sent = await send('GET', '/api/support/feedback/export.csv' + query(f));
            if (!sent.response) return Object.assign({ blob: null, filename: '' }, sent.result);
            var res = sent.response;
            if (!res.ok) {
                var json = await res.json().catch(function () { return {}; });
                return { ok: false, status: res.status, json: json || {}, blob: null, filename: '' };
            }
            var disposition = (res.headers && res.headers.get && res.headers.get('content-disposition')) || '';
            var match = /filename="([^"]+)"/.exec(disposition);
            return { ok: true, status: res.status, json: {}, blob: await res.blob(), filename: match ? match[1] : 'feedback-beta.csv' };
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
