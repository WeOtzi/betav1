/**
 * WE OTZI - Repositorio de sanciones para el panel de soporte (frontend)
 * ----------------------------------------------------------------------------
 * account_sanctions, banned_identifiers y security_alerts (migración
 * 20261118130000) los escribe SOLO el servidor (lib/routes/sanciones.js): un
 * cierre necesita la Admin API de Auth, BAN_HMAC_KEY, correos y cancelar
 * cotizaciones. El servidor autoriza al agente activo o al superadmin.
 *   GET  /api/support/sanctions?status=&user=
 *   GET  /api/support/sanctions/accounts?q=
 *   GET  /api/support/sanctions/:id
 *   POST /api/support/sanctions                       { user_id, kind, reason_code, summary, ticket_id?, ends_at? }
 *   POST /api/support/sanctions/:id/confirm           { note? }
 *   POST /api/support/sanctions/:id/lift              { note }
 *   POST /api/support/sanctions/:id/appeal-decision   { outcome, note }
 *   GET  /api/support/security-alerts?status=&kind=
 *   POST /api/support/security-alerts/:id             { status, resolution }
 *   GET  /api/support/image-alerts/:id                alerta image_duplicate + dueños (fase 2)
 *   POST /api/support/image-alerts/:id                { action: legitimo|retirar|denuncia, note }
 *        (lib/routes/disenos.js; «denuncia» devuelve json.prefill para «Proponer sanción»)
 *
 * Carga: DESPUÉS de postgrest-client.js. Expone WeotziData.SupportSanctions.
 * Cada método devuelve { ok, status, json }.
 */
(function (root) {
    'use strict';

    var D = root.WeotziData;
    if (!D || typeof D.getClient !== 'function') {
        console.error('[support-sanctions-repo] postgrest-client.js debe cargarse antes.');
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

    var noSession = { ok: false, status: 401, json: { error: 'Inicia sesión con tu usuario de soporte.' } };
    var offline = { ok: false, status: 0, json: { error: 'No pudimos conectar con el servidor. Revisa tu conexión.' } };
    var invalid = { ok: false, status: 400, json: { error: 'ID inválido.' } };

    async function call(method, path, body) {
        var s = await session();
        if (!s || typeof root.fetch !== 'function') return noSession;
        var res;
        try {
            var headers = { Authorization: 'Bearer ' + s.access_token };
            if (body) headers['Content-Type'] = 'application/json';
            res = await root.fetch(basePath() + path, {
                method: method,
                headers: headers,
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'same-origin',
                cache: 'no-store'
            });
        } catch (err) {
            return offline;
        }
        var json = await res.json().catch(function () { return {}; });
        return { ok: res.ok && !!(json && json.success), status: res.status, json: json || {} };
    }

    function query(params) {
        var parts = [];
        Object.keys(params || {}).forEach(function (k) {
            var v = params[k];
            if (v == null || v === '') return;
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
        });
        return parts.length ? '?' + parts.join('&') : '';
    }

    function byId(id, suffix, method, body) {
        if (!UUID_RE.test(String(id || ''))) return Promise.resolve(invalid);
        return call(method, '/api/support/sanctions/' + encodeURIComponent(id) + (suffix || ''), body);
    }

    D.SupportSanctions = {
        hasSession: async function () { return !!(await session()); },

        list: function (filters) {
            var f = filters || {};
            return call('GET', '/api/support/sanctions' + query({ status: f.status && f.status !== 'all' ? f.status : '', user: f.user || '' }));
        },

        searchAccounts: function (q) {
            var term = String(q || '').trim();
            if (term.length < 3) return Promise.resolve({ ok: false, status: 400, json: { error: 'Escribe al menos 3 letras para buscar.' } });
            return call('GET', '/api/support/sanctions/accounts' + query({ q: term.slice(0, 80) }));
        },

        get: function (id) { return byId(id, '', 'GET'); },

        propose: function (payload) { return call('POST', '/api/support/sanctions', payload || {}); },

        confirm: function (id, note) { return byId(id, '/confirm', 'POST', { note: note || '' }); },

        lift: function (id, note) { return byId(id, '/lift', 'POST', { note: note || '' }); },

        decideAppeal: function (id, outcome, note) { return byId(id, '/appeal-decision', 'POST', { outcome: outcome, note: note || '' }); },

        alerts: function (filters) {
            var f = filters || {};
            return call('GET', '/api/support/security-alerts' + query({ status: f.status || 'open', kind: f.kind && f.kind !== 'all' ? f.kind : '' }));
        },

        updateAlert: function (id, payload) {
            if (!UUID_RE.test(String(id || ''))) return Promise.resolve(invalid);
            return call('POST', '/api/support/security-alerts/' + encodeURIComponent(id), payload || {});
        },

        // Fase 2 · alertas de imagen duplicada (lib/routes/disenos.js).
        imageAlert: function (id) {
            if (!UUID_RE.test(String(id || ''))) return Promise.resolve(invalid);
            return call('GET', '/api/support/image-alerts/' + encodeURIComponent(id));
        },

        imageAlertAction: function (id, action, note) {
            if (!UUID_RE.test(String(id || ''))) return Promise.resolve(invalid);
            return call('POST', '/api/support/image-alerts/' + encodeURIComponent(id), { action: String(action || ''), note: String(note || '') });
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
