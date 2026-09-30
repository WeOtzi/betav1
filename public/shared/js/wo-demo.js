/**
 * WE OTZI - Modo demo del artista (bootstrap)
 * -------------------------------------------
 * Activa un "sandbox" con datos de ejemplo para tatuadores: cotizaciones,
 * agenda, diseños, job board, spots, viajes, inbox y estadísticas de mentira,
 * sin escribir NADA en Supabase. Sobre ese sandbox corre el recorrido guiado
 * (wo-tour.js) que narra cada sección de la interfaz.
 *
 * Cómo funciona
 *   1. Este script se carga en el <head> de cada página del artista ANTES de
 *      config-manager.js. Si el demo está activo (`?demo=1`, `?tour=1` o
 *      sessionStorage) parchea `window.fetch` antes de que supabase-js cree su
 *      cliente (supabase-js captura la referencia a fetch al crearlo).
 *   2. Toda request a `/rest/v1/<tabla>` se resuelve en memoria con
 *      wo-demo-postgrest.js sobre las fixtures de wo-demo-fixtures.js. Las
 *      tablas que no forman parte del demo (perfil real del artista, catálogos)
 *      se leen del backend real; las escrituras a ellas se ignoran. Las subidas
 *      a Storage se bloquean con un error legible.
 *   3. La identidad (user id / username) sale de la sesión real de Supabase:
 *      las fixtures se generan para el artista logueado, así los filtros
 *      `artist_id=eq.<uuid>` de cada página coinciden.
 *
 * Sin demo activo, el script solo expone `window.WoDemo` (enable/disable) y la
 * invitación al recorrido para artistas nuevos en el dashboard.
 */
(function () {
    'use strict';

    var VERSION = '20260903-1';
    var KEYS = {
        mode: 'wo_demo_mode',
        store: 'wo_demo_store',
        builtAt: 'wo_demo_built_at',
        identity: 'wo_demo_identity',
        tour: 'wo_tour_state',
        offer: 'wo_tour_offer_dismissed'
    };
    var ASSETS = {
        postgrest: '/shared/js/wo-demo-postgrest.js?v=' + VERSION,
        fixtures: '/shared/js/wo-demo-fixtures.js?v=' + VERSION,
        tour: '/shared/js/wo-tour.js?v=' + VERSION,
        steps: '/shared/js/wo-tour-steps.js?v=' + VERSION,
        css: '/shared/css/wo-tour.css?v=' + VERSION
    };
    var STORE_TTL_MS = 12 * 60 * 60 * 1000;
    // RPCs sin handler demo que igual son lecturas seguras: van al backend real.
    var READ_ONLY_RPC = /^(get|list|search|find|fetch|count|check|is|has|can)_/;

    function ss(key, value) {
        try {
            if (value === undefined) return sessionStorage.getItem(key);
            if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
        } catch (e) { return null; }
        return value;
    }
    function ls(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        } catch (e) { return null; }
        return value;
    }
    function warn() { if (window.console) console.warn.apply(console, ['[wo-demo]'].concat([].slice.call(arguments))); }

    /* --------------------------- estado del modo --------------------------- */
    var params = new URLSearchParams(window.location.search);
    var wantsTour = /^(1|on|true|yes)$/i.test(params.get('tour') || '');
    var demoParam = params.get('demo');
    if (wantsTour && !demoParam) demoParam = '1';
    if (demoParam != null) {
        if (/^(1|on|true|yes)$/i.test(demoParam)) ss(KEYS.mode, '1');
        else if (/^(0|off|false|no)$/i.test(demoParam)) exitStorage();
    }
    var enabled = ss(KEYS.mode) === '1';

    function exitStorage() {
        ss(KEYS.mode, null); ss(KEYS.store, null); ss(KEYS.builtAt, null); ss(KEYS.identity, null); ss(KEYS.tour, null);
    }

    /* ------------------------------ identidad ------------------------------ */
    function decodeJwt(token) {
        try {
            var payload = String(token).split('.')[1];
            var json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
            return JSON.parse(decodeURIComponent(json.split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join('')));
        } catch (e) { return null; }
    }
    function readSupabaseSession() {
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!/^sb-.+-auth-token$/.test(key)) continue;
                var raw = JSON.parse(localStorage.getItem(key) || 'null');
                var session = raw && raw.currentSession ? raw.currentSession : raw;
                if (session && session.user && session.user.id) return session;
            }
        } catch (e) { /* storage bloqueado */ }
        return null;
    }
    var identity = (function () {
        var stored = null;
        try { stored = JSON.parse(ss(KEYS.identity) || 'null'); } catch (e) { stored = null; }
        var session = readSupabaseSession();
        var meta = (session && session.user && session.user.user_metadata) || {};
        var id = {
            userId: (session && session.user && session.user.id) || (stored && stored.userId) || null,
            email: (session && session.user && session.user.email) || (stored && stored.email) || null,
            username: (stored && stored.username) || meta.username || meta.user_name || null,
            name: (stored && stored.name) || meta.name || meta.full_name || meta.artistic_name || null
        };
        return id;
    })();
    function saveIdentity() { ss(KEYS.identity, JSON.stringify(identity)); }
    function adoptIdentityFromJwt(headers) {
        if (identity.userId) return;
        var auth = headers && typeof headers.get === 'function' ? headers.get('authorization') : '';
        var payload = auth ? decodeJwt(auth.replace(/^Bearer\s+/i, '')) : null;
        if (payload && payload.sub) {
            identity.userId = payload.sub;
            identity.email = identity.email || payload.email || null;
            saveIdentity();
        }
    }
    // El perfil real del artista pasa al backend; de la respuesta tomamos
    // username y nombre para las fixtures y los links del recorrido.
    function captureIdentity(rows) {
        var row = Array.isArray(rows) ? rows[0] : rows;
        if (!row || typeof row !== 'object') return;
        var changed = false;
        if (row.username && identity.username !== row.username) { identity.username = row.username; changed = true; }
        if (row.name && identity.name !== row.name) { identity.name = row.name; changed = true; }
        if (row.user_id && !identity.userId) { identity.userId = row.user_id; changed = true; }
        if (changed) saveIdentity();
    }

    /* ------------------------------ carga lazy ------------------------------ */
    var loaded = {};
    function loadScript(src) {
        if (loaded[src]) return loaded[src];
        loaded[src] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src; s.async = false;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
            (document.head || document.documentElement).appendChild(s);
        });
        return loaded[src];
    }
    function loadCss(href) {
        if (loaded[href]) return loaded[href];
        loaded[href] = new Promise(function (resolve) {
            var l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = href;
            l.onload = resolve; l.onerror = resolve;
            (document.head || document.documentElement).appendChild(l);
        });
        return loaded[href];
    }

    /* ------------------------------- store ------------------------------- */
    var store = null;
    var ready = null;
    var persistTimer = null;

    function buildStore() {
        var F = window.WoDemoFixtures, P = window.WoDemoPostgrest;
        if (!F || !P) throw new Error('Módulos del demo no disponibles');
        var fixtures = F.build(identity);
        store = P.createStore({ tables: fixtures.tables, relations: fixtures.relations, rpcs: fixtures.rpcs, views: fixtures.views });
        // Mutaciones del demo sobreviven a la navegación dentro de la sesión.
        var builtAt = parseInt(ss(KEYS.builtAt) || '0', 10);
        var dumpRaw = ss(KEYS.store);
        if (dumpRaw && builtAt && Date.now() - builtAt < STORE_TTL_MS) {
            try {
                var dump = JSON.parse(dumpRaw);
                if (dump && dump.__userId === identity.userId) { delete dump.__userId; store.load(dump); }
            } catch (e) { warn('dump inválido, se regeneran fixtures'); }
        } else {
            ss(KEYS.builtAt, String(Date.now()));
        }
        store.onChange(function () {
            clearTimeout(persistTimer);
            persistTimer = setTimeout(function () {
                var dump = store.dump(); dump.__userId = identity.userId;
                try { ss(KEYS.store, JSON.stringify(dump)); } catch (e) { warn('no se pudo persistir el store', e); }
            }, 150);
        });
        return store;
    }

    /* ----------------------------- intercept ----------------------------- */
    var nativeFetch = window.fetch;

    function urlOf(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return String(input);
    }
    function methodOf(input, init) {
        return String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    }
    function headersOf(input, init) {
        try {
            if (init && init.headers) return new Headers(init.headers);
            if (input && input.headers) return new Headers(input.headers);
        } catch (e) { /* headers raros */ }
        return new Headers();
    }
    function bodyOf(input, init) {
        if (init && init.body != null) return typeof init.body === 'string' ? init.body : null;
        return null;
    }
    function jsonResponse(status, body, extraHeaders) {
        return new Response(body == null ? null : JSON.stringify(body), {
            status: status,
            headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, extraHeaders || {})
        });
    }

    function passThrough(input, init, table) {
        var p = nativeFetch.call(window, input, init);
        if (table !== 'artists_db') return p;
        return p.then(function (res) {
            try {
                var ct = res.headers.get('content-type') || '';
                if (ct.indexOf('json') === -1) return res;
                var copy = res.clone();
                copy.json().then(captureIdentity).catch(function () { /* sin cuerpo */ });
            } catch (e) { /* ignorar */ }
            return res;
        });
    }

    function handleRest(input, init, match) {
        var method = methodOf(input, init);
        var path = decodeURIComponent(match[1]).replace(/^\/+|\/+$/g, '');
        var search = match[2] || '';
        var headers = headersOf(input, init);
        var body = bodyOf(input, init);
        adoptIdentityFromJwt(headers);
        return ready.then(function (st) {
            var isRead = method === 'GET' || method === 'HEAD';
            if (path.indexOf('rpc/') === 0) {
                var fn = path.slice(4);
                if (!st.rpcs[fn]) {
                    if (isRead || READ_ONLY_RPC.test(fn)) return passThrough(input, init, null);
                    warn('RPC ignorada en modo demo:', fn);
                }
            } else if (!st.has(path)) {
                if (isRead) return passThrough(input, init, path);
                warn('Escritura ignorada en modo demo:', method, path);
            }
            var res = st.handle({ method: method, path: path, search: search, headers: headers, body: body, ctx: { userId: identity.userId, identity: identity } });
            return new Response(method === 'HEAD' ? null : res.body, { status: res.status, headers: res.headers });
        }).catch(function (err) {
            warn('fallo del emulador, se usa el backend real', err);
            return nativeFetch.call(window, input, init);
        });
    }

    function installFetch() {
        if (window.__woDemoFetchInstalled) return;
        window.__woDemoFetchInstalled = true;
        window.fetch = function (input, init) {
            var url = urlOf(input);
            var rest = /\/rest\/v1\/([^?#]+)(\?[^#]*)?/.exec(url);
            if (rest) return handleRest(input, init, rest);
            if (/\/storage\/v1\/object\//.test(url)) {
                var m = methodOf(input, init);
                if (m !== 'GET' && m !== 'HEAD') {
                    return Promise.resolve(jsonResponse(400, {
                        statusCode: '400', error: 'DemoMode',
                        message: 'Modo demo: nada se guarda. Salí del demo para subir archivos.'
                    }));
                }
            }
            return nativeFetch.call(window, input, init);
        };
    }

    /* ------------------------------ UI: barra ------------------------------ */
    function el(tag, className, html) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (html != null) node.innerHTML = html;
        return node;
    }

    function renderBar() {
        if (document.querySelector('.wo-demo-bar')) return;
        var bar = el('div', 'wo-demo-bar');
        bar.setAttribute('role', 'status');
        bar.innerHTML =
            '<span class="wo-demo-bar__marks" aria-hidden="true"><i class="m-sq"></i><i class="m-ci"></i><i class="m-tr"></i></span>' +
            '<span class="wo-demo-bar__text"><b>MODO DEMO</b> · datos de ejemplo · nada se guarda</span>' +
            '<span class="wo-demo-bar__actions">' +
            '<button type="button" class="wo-btn wo-btn--s wo-btn--accent wo-demo-bar__tour">RECORRIDO GUIADO →</button>' +
            '<button type="button" class="wo-btn wo-btn--s wo-btn--ghost wo-demo-bar__reset" title="Volver a los datos de ejemplo iniciales">REINICIAR</button>' +
            '<button type="button" class="wo-btn wo-btn--s wo-btn--ghost wo-demo-bar__exit">SALIR DEL DEMO</button>' +
            '</span>';
        bar.querySelector('.wo-demo-bar__tour').addEventListener('click', function () { api.startTour(); });
        bar.querySelector('.wo-demo-bar__reset').addEventListener('click', function () { api.reset(); });
        bar.querySelector('.wo-demo-bar__exit').addEventListener('click', function () { api.disable(); });
        document.body.appendChild(bar);
        document.documentElement.classList.add('wo-demo-on');
    }

    function renderOffer() {
        if (enabled) return;
        if (!/^\/artist\/dashboard\/?$/.test(window.location.pathname)) return;
        if (ls('wo_tour_seen') === '1' || ss(KEYS.offer) === '1') return;
        loadCss(ASSETS.css);
        var card = el('aside', 'wo-tour-invite');
        card.setAttribute('aria-label', 'Recorrido guiado');
        card.innerHTML =
            '<p class="wo-eyebrow">¿Primera vez acá?</p>' +
            '<h3 class="wo-tour-invite__title">Conocé tu panel con un recorrido guiado</h3>' +
            '<p class="wo-tour-invite__copy">Activamos datos de ejemplo y te contamos qué hace cada sección. Nada se guarda.</p>' +
            '<div class="wo-tour-invite__actions">' +
            '<button type="button" class="wo-btn wo-btn--s wo-btn--ink wo-btn--hard wo-tour-invite__go">EMPEZAR →</button>' +
            '<button type="button" class="wo-btn wo-btn--s wo-btn--ghost wo-tour-invite__later">AHORA NO</button>' +
            '</div>';
        card.querySelector('.wo-tour-invite__go').addEventListener('click', function () { ls('wo_tour_seen', '1'); api.enable({ tour: true }); });
        card.querySelector('.wo-tour-invite__later').addEventListener('click', function () { ls('wo_tour_seen', '1'); ss(KEYS.offer, '1'); card.remove(); });
        document.body.appendChild(card);
    }

    /* -------------------------------- API -------------------------------- */
    function cleanUrl(extra) {
        var url = new URL(window.location.href);
        url.searchParams.delete('demo'); url.searchParams.delete('tour');
        Object.keys(extra || {}).forEach(function (k) { url.searchParams.set(k, extra[k]); });
        return url.pathname + (url.search || '') + (url.hash || '');
    }

    var api = {
        version: VERSION,
        enabled: enabled,
        identity: identity,
        ready: null,
        tourReady: null,
        enable: function (opts) {
            opts = opts || {};
            ss(KEYS.mode, '1');
            if (opts.tour) ss(KEYS.tour, JSON.stringify({ active: true, chapter: 0, step: 0, fresh: true }));
            var target = opts.path || (opts.tour ? '/artist/dashboard' : window.location.pathname);
            var url = new URL(target, window.location.origin);
            url.searchParams.set('demo', '1');
            if (opts.tour) url.searchParams.set('tour', '1');
            window.location.href = url.pathname + url.search;
        },
        disable: function () {
            try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* sin voz */ }
            exitStorage();
            window.location.href = cleanUrl({ demo: '0' });
        },
        reset: function () {
            ss(KEYS.store, null); ss(KEYS.builtAt, null);
            window.location.href = cleanUrl({ demo: '1' });
        },
        startTour: function (opts) {
            if (!enabled) return api.enable({ tour: true });
            return api.tourReady.then(function () {
                if (window.WoTour) window.WoTour.start(opts || {});
            });
        },
        store: function () { return store; },
        assets: ASSETS
    };
    window.WoDemo = api;

    if (enabled) {
        installFetch();
        document.documentElement.classList.add('wo-demo-on');
        ready = Promise.all([loadScript(ASSETS.postgrest), loadScript(ASSETS.fixtures)]).then(buildStore);
        ready.catch(function (err) { warn('demo no disponible:', err && err.message); });
        api.ready = ready;
        api.tourReady = Promise.all([loadCss(ASSETS.css), loadScript(ASSETS.tour).then(function () { return loadScript(ASSETS.steps); })])
            .catch(function (err) { warn('recorrido no disponible:', err && err.message); });
        var boot = function () {
            renderBar();
            api.tourReady.then(function () {
                if (window.WoTour && typeof window.WoTour.autoResume === 'function') window.WoTour.autoResume({ wantsTour: wantsTour });
            });
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    } else {
        api.ready = Promise.resolve(null);
        api.tourReady = Promise.resolve(null);
        var offer = function () { setTimeout(renderOffer, 1800); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', offer); else offer();
    }
})();
