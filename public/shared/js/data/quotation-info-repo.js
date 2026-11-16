/**
 * WE ÖTZI — Repositorio de información y enlaces de la cotización (frontend)
 * ---------------------------------------------------------------------------
 * Ronda 2 · frente cot-detalle. Métodos con nombre sobre los endpoints de
 * lib/routes/cot-detalle.js (el servidor decide qué se puede ver):
 *   · info(quoteId)            contacto del cliente según la regla de
 *                              verificación, si está registrado y enlaces activos
 *   · clientContacts()         clientes de las cotizaciones del artista para el
 *                              buscador de la cotización manual (misma regla)
 *   · clientProfile(quoteId)   perfil del cliente registrado
 *   · sheet(quoteId)           hoja exportable (PDF / imagen)
 *   · createShareLink / revokeShareLinks   enlace público /cotizacion/<token>
 *   · publicSheet(token) / claimShared(token)   página pública
 *
 * Con postgrest-client.js cargado se expone como window.WeotziData.QuotationInfo;
 * en la página pública (sin la capa completa) queda en window.WoQuotationInfoRepo.
 */
(function () {
    'use strict';

    var LINK_CACHE_PREFIX = 'wo:quote-share:';

    function basePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var p = (window.location && window.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    function client() {
        if (window.WeotziData && typeof window.WeotziData.getClient === 'function') return window.WeotziData.getClient();
        if (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function') return window.ConfigManager.getSupabaseClient();
        return window._supabase || null;
    }

    async function accessToken() {
        try {
            var c = client();
            if (!c || !c.auth) return null;
            var res = await c.auth.getSession();
            return (res && res.data && res.data.session && res.data.session.access_token) || null;
        } catch (_) {
            return null;
        }
    }

    // fetch → cuerpo JSON; lanza Error con .status, .code y el mensaje del servidor.
    async function call(method, path, opts) {
        var o = opts || {};
        var headers = {};
        var token = o.token === undefined ? await accessToken() : o.token;
        if (o.auth !== false && !token) {
            throw Object.assign(new Error('Inicia sesión para continuar.'), { status: 401, code: 'auth' });
        }
        if (token) headers.Authorization = 'Bearer ' + token;
        if (o.body !== undefined) headers['Content-Type'] = 'application/json';
        var res;
        try {
            res = await fetch(basePath() + path, {
                method: method,
                headers: headers,
                body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
                cache: 'no-store'
            });
        } catch (networkError) {
            throw Object.assign(new Error('No hay conexión. Revisa tu internet y vuelve a intentarlo.'), { status: 0, code: 'network' });
        }
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok || body.success === false) {
            throw Object.assign(new Error(body.error || 'No pudimos completar la acción.'), { status: res.status, code: body.code || null });
        }
        return body;
    }

    function quotePath(quoteId, tail) {
        return '/api/cot-detalle/quotations/' + encodeURIComponent(quoteId) + tail;
    }

    // ------------------------------------------------------------ caché del enlace
    // El servidor guarda solo el hash del token: el enlace completo vive en el
    // navegador del artista que lo creó, para volver a copiarlo sin crear otro.
    function readCachedLink(quoteId) {
        try {
            var raw = window.localStorage.getItem(LINK_CACHE_PREFIX + quoteId);
            var data = raw ? JSON.parse(raw) : null;
            if (!data || typeof data.url !== 'string' || !data.id) return null;
            if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) return null;
            return data;
        } catch (_) {
            return null;
        }
    }
    function writeCachedLink(quoteId, data) {
        try {
            window.localStorage.setItem(LINK_CACHE_PREFIX + quoteId, JSON.stringify({ id: data.id, url: data.url, expires_at: data.expires_at || null }));
        } catch (_) { /* almacenamiento bloqueado: se crea otro enlace la próxima vez */ }
    }
    function clearCachedLink(quoteId) {
        try { window.localStorage.removeItem(LINK_CACHE_PREFIX + quoteId); } catch (_) { /* nada que limpiar */ }
    }

    var Repo = {
        basePath: basePath,
        accessToken: accessToken,

        info: function (quoteId) { return call('GET', quotePath(quoteId, '/info')); },
        // Clientes de las cotizaciones del artista (buscador de la cotización manual).
        // El servidor entrega el contacto solo donde la regla P20/P23 lo permite.
        clientContacts: async function () {
            var body = await call('GET', '/api/cot-detalle/client-contacts');
            return Array.isArray(body.contacts) ? body.contacts : [];
        },
        clientProfile: function (quoteId) { return call('GET', quotePath(quoteId, '/client-profile')); },
        sheet: function (quoteId) { return call('GET', quotePath(quoteId, '/sheet')); },

        async createShareLink(quoteId, days) {
            var body = await call('POST', quotePath(quoteId, '/share'), { body: { days: days } });
            if (body && body.url && body.link) writeCachedLink(quoteId, { id: body.link.id, url: body.url, expires_at: body.link.expires_at });
            return body;
        },
        async revokeShareLinks(quoteId, linkId) {
            var body = await call('DELETE', quotePath(quoteId, '/share') + (linkId ? '?id=' + encodeURIComponent(linkId) : ''));
            clearCachedLink(quoteId);
            return body;
        },

        // Enlace que este navegador ya tiene y el servidor sigue dando por vigente.
        cachedLink: function (quoteId, activeLinks) {
            var cached = readCachedLink(quoteId);
            if (!cached) return null;
            if (Array.isArray(activeLinks) && !activeLinks.some(function (l) { return l && l.id === cached.id; })) {
                clearCachedLink(quoteId);
                return null;
            }
            return cached;
        },
        clearCachedLink: clearCachedLink,

        // Página pública: la sesión es opcional (sirve para ofrecer "vincular").
        async publicSheet(token) {
            var session = await accessToken();
            return call('GET', '/api/cot-detalle/public/' + encodeURIComponent(token), { auth: false, token: session || null });
        },
        claimShared: function (token) {
            return call('POST', '/api/cot-detalle/public/' + encodeURIComponent(token) + '/claim', { body: {} });
        }
    };

    window.WoQuotationInfoRepo = Repo;
    if (window.WeotziData) window.WeotziData.QuotationInfo = Repo;
})();
