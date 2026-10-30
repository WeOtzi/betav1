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
 * Sin demo activo, el script expone `window.WoDemo` y además:
 *   - Demo para cuentas nuevas (≤ 14 días): la primera visita al dashboard
 *     prende el demo EN EL LUGAR (sin recargar) con el recorrido desde el
 *     inicio; el espejo local `wo_onb_<uid>` evita que se repita.
 *   - Sugerencia persistente `.wo-demo-suggest` en el dashboard (cada visita),
 *     salvo que el artista la apague desde el menú Ö o toque "AHORA NO" en la
 *     sesión (sessionStorage `wo_demo_suggest_dismissed`).
 *   - Cargador del modo asistido (wo-assist.js): con `?asistido=1`, el espejo
 *     o el servidor diciendo `assisted.active`, y siempre con el demo apagado.
 *   - Cliente de `/api/artist/onboarding` con el fetch NATIVO (nunca el
 *     emulado): `api()`, `onboarding()`, `setSuggestions()`, `startAssist()`.
 *     Las lecturas que fallan son silenciosas (console.debug); si el POST de
 *     `setSuggestions()` o `stopAssist()` falla, el cambio local se deshace y
 *     la promesa rechaza para que la UI avise.
 * `?asistido=1|0` es de un solo uso: se aplica y se saca de la URL.
 */
(function () {
    'use strict';

    var VERSION = '20261030-1';
    var KEYS = {
        mode: 'wo_demo_mode',
        store: 'wo_demo_store',
        builtAt: 'wo_demo_built_at',
        identity: 'wo_demo_identity',
        tour: 'wo_tour_state',
        // "AHORA NO" en la sugerencia del demo: solo por esta sesión del navegador.
        suggestDismissed: 'wo_demo_suggest_dismissed'
    };
    var ASSETS = {
        postgrest: '/shared/js/wo-demo-postgrest.js?v=' + VERSION,
        fixtures: '/shared/js/wo-demo-fixtures.js?v=' + VERSION,
        tour: '/shared/js/wo-tour.js?v=' + VERSION,
        steps: '/shared/js/wo-tour-steps.js?v=' + VERSION,
        css: '/shared/css/wo-tour.css?v=' + VERSION,
        assist: '/shared/js/wo-assist.js?v=' + VERSION,
        assistCss: '/shared/css/wo-assist.css?v=' + VERSION,
        onboardingCss: '/shared/css/wo-onboarding.css?v=' + VERSION
    };
    var STORE_TTL_MS = 12 * 60 * 60 * 1000;
    var DAY_MS = 24 * 60 * 60 * 1000;
    var NEW_WINDOW_DAYS = 14;              // mismo umbral que `is_new` del servidor
    var SYNC_TTL_MS = 15 * 60 * 1000;      // fuera del dashboard, re-sincroniza el espejo cada 15 min
    var SYNC_DELAY_MS = 900;               // deja que supabase-js refresque la sesión antes del GET
    var SUGGEST_DELAY_MS = 1200;           // la tarjeta aparece cuando el dashboard ya pintó
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
    // Los fallos de sincronización con el servidor (401/403/404/5xx, la preview
    // local responde 403) nunca rompen la página: solo dejan rastro en debug.
    function debug() {
        try { if (window.console && console.debug) console.debug.apply(console, ['[wo-demo]'].concat([].slice.call(arguments))); } catch (e) { /* sin consola */ }
    }
    function quiet(label) {
        return function (err) { debug(label + ':', err && err.status != null ? err.status : '', err && err.message); return null; };
    }
    function noop() { /* nada */ }
    function emit(name, detail) {
        try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* navegador sin CustomEvent */ }
    }

    /* ---------------------- decisiones puras (testeables) ---------------------- */
    var ON = /^(1|on|true|yes)$/i;
    var OFF = /^(0|off|false|no)$/i;
    function flagOf(value) {
        if (value == null) return null;
        if (ON.test(value)) return true;
        if (OFF.test(value)) return false;
        return null;
    }
    // ?demo, ?tour y ?asistido. `?tour=1` implica el demo; `?asistido=1` gana
    // sobre los dos: la página tiene que correr con datos reales.
    function parseFlags(search) {
        var p = new URLSearchParams(search || '');
        var rawDemo = p.get('demo');
        var assist = flagOf(p.get('asistido'));
        var tour = flagOf(p.get('tour')) === true;
        var demo = flagOf(rawDemo);
        if (tour && !rawDemo) demo = true;
        if (assist === true) { demo = false; tour = false; }
        return { demo: demo, tour: tour, assist: assist };
    }
    // Quita el base path (`/beta`, el de la preview) para comparar rutas.
    function stripBase(pathname, base) {
        var p = String(pathname || '');
        var b = String(base || '').replace(/\/$/, '');
        if (b && (p === b || p.indexOf(b + '/') === 0)) return p.slice(b.length) || '/';
        if (/^\/beta(\/|$)/.test(p)) return p.slice(5) || '/';
        return p;
    }
    function isDashboardPath(pathname, base) {
        return /^\/artist\/dashboard(\/|\/index\.html)?$/.test(stripBase(pathname, base));
    }
    function joinBase(base, path) {
        var s = String(path == null ? '' : path);
        var b = String(base || '').replace(/\/$/, '');
        if (!b || s.charAt(0) !== '/' || s.charAt(1) === '/') return s;
        if (s === b || s.indexOf(b + '/') === 0 || s.indexOf(b + '?') === 0 || s.indexOf(b + '#') === 0) return s;
        return b + s;
    }
    function assistTarget(base) { return joinBase(base, '/artist/account?asistido=1#perfil'); }
    function accountAgeMs(createdAt, now) {
        var t = Date.parse(createdAt || '');
        return isNaN(t) ? null : now - t;
    }
    function isNewAccount(createdAt, now) {
        var age = accountAgeMs(createdAt, typeof now === 'number' ? now : Date.now());
        return age !== null && age <= NEW_WINDOW_DAYS * DAY_MS;
    }
    // Demo para cuentas nuevas: sesión, cuenta de ≤ 14 días, el espejo sin
    // `demo_auto_started` y el dashboard. Tampoco arranca si la URL pide salir
    // del demo o entrar al modo asistido, si el artista apagó la sugerencia o si
    // ya está trabajando en el modo asistido.
    function shouldAutoStart(o) {
        o = o || {};
        var user = o.session && o.session.user;
        if (!user || !user.id) return false;
        if (!isNewAccount(user.created_at, o.now)) return false;
        var m = o.mirror || {};
        if (m.demo_auto_started || m.demo_suggestions === false || m.assisted_active) return false;
        var f = o.flags || {};
        if (f.demo === false || (f.assist != null)) return false;
        return isDashboardPath(o.pathname, o.basePath);
    }
    // Una cuenta nueva que entra al demo por otro camino (menú Ö, la
    // sugerencia, `?demo=1`, un link) ya lo conoció: se marca igual que el
    // arranque automático para que este no la vuelva a meter después de salir.
    function shouldMarkDemoSeen(o) {
        o = o || {};
        if (!o.enabled || o.autoStarted || !o.userId) return false;
        if ((o.mirror || {}).demo_auto_started) return false;
        return isNewAccount(o.createdAt, o.now);
    }
    // Saca un parámetro del query string sin re-codificar los demás.
    function withoutParam(search, key) {
        var parts = String(search || '').replace(/^\?/, '').split('&').filter(function (part) {
            if (!part) return false;
            var name = part.split('=')[0];
            try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch (e) { /* nombre mal codificado: se compara crudo */ }
            return name !== key;
        });
        return parts.length ? '?' + parts.join('&') : '';
    }
    // `enabled` = el demo está prendido (no hay nada que sugerir).
    function shouldShowSuggestion(o) {
        o = o || {};
        if (o.enabled || o.dismissed) return false;
        if ((o.mirror || {}).demo_suggestions === false) return false;
        return isDashboardPath(o.pathname, o.basePath);
    }
    // Con el demo apagado: el dashboard y el modo asistido siempre leen el
    // servidor; el resto de las páginas solo si el espejo falta o está viejo.
    function shouldSync(o) {
        o = o || {};
        if (!o.userId || o.enabled) return false;
        if (o.flags && o.flags.assist != null) return false; // el POST del flag ya trae el estado
        var m = o.mirror || {};
        if (isDashboardPath(o.pathname, o.basePath) || m.assisted_active) return true;
        var t = Date.parse(m.synced_at || '');
        var now = typeof o.now === 'number' ? o.now : Date.now();
        return isNaN(t) || now - t > SYNC_TTL_MS || now < t;
    }
    function mirrorKey(userId) { return 'wo_onb_' + userId; }
    function parseMirror(raw) {
        try {
            var m = JSON.parse(raw || 'null');
            return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
        } catch (e) { return {}; }
    }

    /* ------------------------------ base path ------------------------------ */
    function currentBase() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        return /^\/beta(\/|$)/.test(window.location.pathname || '') ? '/beta' : '';
    }
    function appPath(path) { return joinBase(currentBase(), path); }

    /* --------------------------- estado del modo --------------------------- */
    var flags = parseFlags(window.location.search);
    // `?asistido=1` llega con demo=false: sale del demo antes que nada.
    if (flags.demo === true) ss(KEYS.mode, '1');
    else if (flags.demo === false) exitStorage();
    var enabled = ss(KEYS.mode) === '1';
    var wantsTour = flags.tour;

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
    var session = readSupabaseSession();
    var identity = (function () {
        var stored = null;
        try { stored = JSON.parse(ss(KEYS.identity) || 'null'); } catch (e) { stored = null; }
        var meta = (session && session.user && session.user.user_metadata) || {};
        var id = {
            userId: (session && session.user && session.user.id) || (stored && stored.userId) || null,
            email: (session && session.user && session.user.email) || (stored && stored.email) || null,
            username: (stored && stored.username) || meta.username || meta.user_name || null,
            name: (stored && stored.name) || meta.name || meta.full_name || meta.artistic_name || null,
            // Alta del auth user (iso): decide la "cuenta nueva" sin ir al servidor.
            createdAt: (session && session.user && session.user.created_at) || (stored && stored.createdAt) || null
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

    /* ---------------- espejo local del onboarding (wo_onb_<uid>) ---------------- */
    // Lectura sincrónica en <head>; el servidor (user_preferences.app_settings.
    // onboarding) es la fuente de verdad y lo pisa en cada sincronización.
    function readMirror() { return identity.userId ? parseMirror(ls(mirrorKey(identity.userId))) : {}; }
    function writeMirror(m) {
        if (!identity.userId) return;
        try { ls(mirrorKey(identity.userId), JSON.stringify(m)); } catch (e) { /* storage lleno */ }
    }
    function patchMirror(patch) {
        var m = readMirror();
        Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
        writeMirror(m);
        return m;
    }
    // Cada cambio local lleva un número de secuencia: una respuesta del servidor
    // pedida ANTES del cambio no lo revierte (p. ej. un GET lento tras el toggle).
    var seq = 0;
    var localAt = {};
    function setLocal(key, value) {
        localAt[key] = ++seq;
        var patch = {}; patch[key] = value;
        return patchMirror(patch);
    }

    // `?asistido=1|0` es de un solo uso: el valor ya quedó en `flags` (el POST
    // de bootOff lo usa) y en el espejo. Se saca de la URL, con el hash y el
    // resto de los parámetros intactos, para que recargar, "Restablecer
    // preferencias" o volver con Atrás no prendan otra vez el modo asistido
    // después de que el artista salió.
    function stripAssistParam() {
        try {
            var loc = window.location;
            var next = loc.pathname + withoutParam(loc.search, 'asistido') + (loc.hash || '');
            if (next === loc.pathname + (loc.search || '') + (loc.hash || '')) return;
            window.history.replaceState(window.history.state, '', next);
        } catch (e) { /* sin History API: el flag queda en la URL */ }
    }
    if (flags.assist !== null) {
        setLocal('assisted_active', flags.assist);
        stripAssistParam();
    }

    // Demo para cuentas nuevas: se prende en el lugar, con el mismo estado que
    // `?demo=1&tour=1` y el recorrido desde el inicio. El espejo se marca ya
    // para que una recarga no lo repita; el POST va después de DOMContentLoaded.
    var autoStarted = !enabled && shouldAutoStart({
        session: session, mirror: readMirror(), flags: flags,
        pathname: window.location.pathname, basePath: currentBase(), now: Date.now()
    });
    if (autoStarted) {
        ss(KEYS.mode, '1');
        ss(KEYS.tour, JSON.stringify({ active: true, chapter: 0, step: 0, fresh: true }));
        enabled = true;
        wantsTour = true;
        patchMirror({ demo_auto_started: true });
    }
    // Cuenta nueva que ya está en el demo por otro camino: misma marca y mismo POST.
    var demoSeen = shouldMarkDemoSeen({
        enabled: enabled, autoStarted: autoStarted, userId: identity.userId,
        createdAt: identity.createdAt, mirror: readMirror(), now: Date.now()
    });
    if (demoSeen) patchMirror({ demo_auto_started: true });

    /* ------------------------------ carga lazy ------------------------------ */
    var loaded = {};
    function loadScript(src) {
        if (loaded[src]) return loaded[src];
        loaded[src] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = appPath(src); s.async = false;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
            (document.head || document.documentElement).appendChild(s);
        });
        return loaded[src];
    }
    // Extensiones de fixtures por área (ver EXTENSIONS en wo-demo-fixtures.js).
    // Un archivo ausente no rompe el demo: solo se omite esa área.
    function loadFixtureExtensions() {
        var names = (window.WoDemoFixtures && window.WoDemoFixtures.EXTENSIONS) || [];
        return Promise.all(names.map(function (name) {
            return loadScript('/shared/js/demo-fixtures/' + name + '.js?v=' + VERSION).catch(function () { return null; });
        }));
    }
    function loadCss(href) {
        if (loaded[href]) return loaded[href];
        loaded[href] = new Promise(function (resolve) {
            var l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = appPath(href);
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
            // Sin emulador (fixtures que no cargaron, un handler que tiró) solo
            // las lecturas pueden ir al backend real. Una escritura NUNCA sale
            // del demo: responde un error legible y no toca la cuenta real.
            if (method === 'GET' || method === 'HEAD') {
                warn('fallo del emulador, la lectura va al backend real', err);
                return nativeFetch.call(window, input, init);
            }
            warn('fallo del emulador, escritura bloqueada en modo demo:', method, path, err);
            return demoUnavailable();
        });
    }
    function demoUnavailable() {
        return jsonResponse(503, {
            code: 'DEMO_UNAVAILABLE', details: null, hint: null,
            message: 'Modo demo: los datos de ejemplo no están disponibles y nada se guardó. Recargá la página para reintentar.'
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

    /* ------------------- servidor: /api/artist/onboarding ------------------- */
    function localAccessToken() {
        var s = readSupabaseSession();
        if (!s || !s.access_token) return null;
        var exp = Number(s.expires_at) || 0; // segundos epoch
        if (exp && exp * 1000 <= Date.now() + 10000) return null; // vencido: supabase-js lo refresca
        return s.access_token;
    }
    function authClient() {
        if (window._supabase && window._supabase.auth) return window._supabase;
        try {
            var CM = window.ConfigManager;
            if (window.supabase && CM && typeof CM.getSupabaseClient === 'function'
                && (typeof CM.isSupabaseConfigured !== 'function' || CM.isSupabaseConfigured())) {
                var c = CM.getSupabaseClient();
                if (c && c.auth) return c;
            }
        } catch (e) { /* la config todavía carga */ }
        return null;
    }
    function getAccessToken() {
        var fallback = localAccessToken();
        var client = authClient();
        if (!client || typeof client.auth.getSession !== 'function') return Promise.resolve(fallback);
        return Promise.resolve().then(function () { return client.auth.getSession(); }).then(function (r) {
            var s = r && r.data && r.data.session;
            return (s && s.access_token) || fallback;
        }, function () { return fallback; });
    }
    function httpError(status, message, data) {
        var err = new Error(message);
        err.status = status;
        if (data) err.data = data;
        return err;
    }
    // Siempre con el fetch NATIVO capturado antes del parche: el emulador del
    // demo nunca ve estas llamadas, aunque el demo esté prendido.
    function apiCall(path, opts) {
        opts = opts || {};
        if (typeof nativeFetch !== 'function') return Promise.reject(httpError(0, 'fetch no disponible'));
        return getAccessToken().then(function (token) {
            if (!token) throw httpError(401, 'Authentication required');
            var init = {
                method: String(opts.method || 'GET').toUpperCase(),
                headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
                credentials: 'same-origin',
                cache: 'no-store'
            };
            if (opts.body !== undefined) {
                init.headers['Content-Type'] = 'application/json';
                init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
            }
            return nativeFetch.call(window, appPath(path), init);
        }).then(function (res) {
            return res.text().then(function (text) {
                var data = null;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
                if (!res.ok) throw httpError(res.status, (data && data.error) || ('HTTP ' + res.status), data);
                return data;
            });
        }, function (err) {
            if (err && err.status != null) throw err;
            throw httpError(0, (err && err.message) || 'Sin conexión');
        });
    }
    function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

    // Una sola lectura por página: GET y POST responden el mismo objeto, así que
    // cualquier respuesta (o pedido en curso) sirve de caché para onboarding().
    var onbCache = null;
    function track(promise) {
        onbCache = promise;
        promise.then(null, function () { if (onbCache === promise) onbCache = null; });
        return promise;
    }
    function requestOnboarding(body) {
        var mySeq = ++seq;
        var opts = body ? { method: 'POST', body: body } : null;
        var run = function () { return apiCall('/api/artist/onboarding', opts); };
        return track(run().then(null, function (err) {
            // Al cargar la página la sesión puede estar refrescándose: un reintento.
            if (!err || err.status !== 401 || !identity.userId) throw err;
            return wait(2500).then(run);
        }).then(function (data) {
            adoptServerState(data, mySeq);
            return data;
        }));
    }
    function onboarding(opts) {
        if (opts && opts.fresh) onbCache = null;
        return onbCache || requestOnboarding(null);
    }
    // Cambio local que el servidor tiene que guardar (switch de la sugerencia,
    // salida del modo asistido). `base` es el último valor confirmado: el de
    // antes del primer cambio en vuelo, o el del último POST que salió bien.
    // Si falla el POST del cambio más reciente, el espejo vuelve a `base` y
    // `onRollback(base)` restaura la UI; un fallo ya superado por otro cambio
    // no toca nada. La promesa rechaza igual para que la UI avise.
    var pendingSaves = {};
    function saveLocal(key, next, prev, body, onRollback) {
        var slot = pendingSaves[key] || (pendingSaves[key] = { count: 0, base: prev });
        slot.count += 1;
        setLocal(key, next);
        var mark = localAt[key];
        var settle = function () {
            slot.count -= 1;
            if (slot.count <= 0 && pendingSaves[key] === slot) delete pendingSaves[key];
        };
        return requestOnboarding(body).then(function (data) {
            slot.base = next;
            settle();
            return data;
        }, function (err) {
            var latest = localAt[key] === mark;
            var back = slot.base;
            settle();
            if (latest && back !== next) {
                setLocal(key, back);
                try { onRollback(back); } catch (e) { debug('rollback ' + key + ':', e && e.message); }
            }
            throw err;
        });
    }
    // Sincronización de fondo fallida. Un 403 ("Artist profile required": un
    // cliente logueado mirando perfiles públicos) no cambia en minutos: se
    // sella el espejo para que shouldSync respete SYNC_TTL_MS en vez de repetir
    // el GET en cada página. El resto de los errores queda en silencio.
    function syncFailed(err) {
        if (err && err.status === 403) patchMirror({ synced_at: new Date().toISOString() });
        return quiet('onboarding')(err);
    }
    function adoptServerState(data, mySeq) {
        if (!data || typeof data !== 'object' || !data.onboarding || typeof data.onboarding !== 'object') return;
        var o = data.onboarding;
        var prev = readMirror();
        var prevSuggest = prev.demo_suggestions !== false;
        var prevAssist = !!prev.assisted_active;
        var next = {
            demo_suggestions: (localAt.demo_suggestions || 0) > mySeq ? prevSuggest : o.demo_suggestions !== false,
            assisted_active: (localAt.assisted_active || 0) > mySeq ? prevAssist : !!(o.assisted && o.assisted.active),
            demo_auto_started: !!(prev.demo_auto_started || o.demo_auto_started_at),
            synced_at: new Date().toISOString()
        };
        writeMirror(next);
        if (prevSuggest !== next.demo_suggestions) emit('wo:demo-suggestions-changed', { enabled: next.demo_suggestions });
        if (prevAssist !== next.assisted_active) {
            emit('wo:assist-changed', { active: next.assisted_active });
            reconcileAssist(next.assisted_active);
        }
    }

    /* ------------------------ modo asistido (lazy) ------------------------ */
    function domReady() {
        if (document.readyState !== 'loading') return Promise.resolve();
        return new Promise(function (resolve) { document.addEventListener('DOMContentLoaded', function () { resolve(); }); });
    }
    var assistLoad = null;
    var assistBooted = false;
    function loadAssist() {
        if (!assistLoad) {
            // wo-tour.js va solo por su narrador (WoTour.narrator): cargarlo no
            // arranca ningún recorrido. Los dos scripts ejecutan en orden.
            assistLoad = Promise.all([
                loadScript(ASSETS.tour).then(null, noop),
                loadCss(ASSETS.assistCss),
                loadScript(ASSETS.assist)
            ]).then(function () {
                if (!window.WoAssist || typeof window.WoAssist.boot !== 'function') throw new Error('WoAssist no disponible');
                return window.WoAssist;
            });
            assistLoad.then(null, function (err) { debug('modo asistido no disponible:', err && err.message); });
        }
        return assistLoad;
    }
    function bootAssist(start) {
        if (enabled || !identity.userId) return Promise.resolve(null);
        return domReady().then(loadAssist).then(function (A) {
            if (!assistBooted) {
                assistBooted = true;
                A.boot({ start: !!start, identity: identity });
                emit('wo:assist-changed', { active: true });
            }
            return A;
        });
    }
    function reconcileAssist(active) {
        if (enabled) return;
        if (active) { bootAssist(false).then(null, quiet('asistido')); return; }
        var A = window.WoAssist;
        if (assistBooted && A && typeof A.close === 'function') {
            try { A.close(); } catch (e) { debug('WoAssist.close:', e && e.message); }
        }
    }
    function assistMounted() {
        var A = window.WoAssist;
        try { return !!(A && typeof A.isActive === 'function' && A.isActive()); } catch (e) { return false; }
    }
    // Vuelve a montar el panel después de una salida que el servidor no guardó.
    // boot sin start lee el estado real: si el servidor ya dice active:false,
    // el panel no aparece.
    function reopenAssist() {
        if (enabled) return;
        var A = window.WoAssist;
        if (A && typeof A.boot === 'function') {
            try { Promise.resolve(A.boot({ start: false, identity: identity })).then(null, quiet('asistido')); }
            catch (e) { debug('WoAssist.boot:', e && e.message); }
            return;
        }
        bootAssist(false).then(null, quiet('asistido'));
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

    /* ------------------- UI: sugerencia del demo (dashboard) ------------------- */
    // Reemplaza a la invitación "¿Primera vez acá?" de una sola vez: aparece en
    // cada visita con el demo apagado, salvo que el artista la apague desde el
    // menú Ö (servidor + espejo) o toque "AHORA NO" en esta sesión.
    function suggestionAllowed() {
        return shouldShowSuggestion({
            enabled: enabled, mirror: readMirror(), dismissed: ss(KEYS.suggestDismissed) === '1',
            pathname: window.location.pathname, basePath: currentBase()
        });
    }
    function removeSuggestion() {
        var card = document.querySelector('.wo-demo-suggest');
        if (card && card.parentNode) card.parentNode.removeChild(card);
    }
    function renderSuggestion() {
        if (!suggestionAllowed() || document.querySelector('.wo-demo-suggest')) return;
        loadCss(ASSETS.onboardingCss).then(function () {
            if (!document.body || !suggestionAllowed() || document.querySelector('.wo-demo-suggest')) return;
            var card = el('aside', 'wo-demo-suggest');
            card.setAttribute('aria-labelledby', 'wo-demo-suggest-title');
            card.innerHTML =
                '<p class="wo-eyebrow wo-demo-suggest__eyebrow">Modo demo</p>' +
                '<h2 class="wo-demo-suggest__title" id="wo-demo-suggest-title">Probá We Ötzi con datos de ejemplo</h2>' +
                '<p class="wo-demo-suggest__copy">Cotizaciones, agenda y mensajes ficticios, con un recorrido guiado por cada sección. Nada se guarda en tu cuenta.</p>' +
                '<p class="wo-demo-suggest__note">Podés desactivar esta sugerencia desde el menú Ö.</p>' +
                '<div class="wo-demo-suggest__actions">' +
                '<button type="button" class="wo-btn wo-btn--s wo-btn--ink wo-btn--hard wo-demo-suggest__go">ACTIVAR MODO DEMO →</button>' +
                '<button type="button" class="wo-btn wo-btn--s wo-btn--ghost wo-demo-suggest__later">AHORA NO</button>' +
                '</div>';
            card.querySelector('.wo-demo-suggest__go').addEventListener('click', function () { api.enable({ tour: true }); });
            card.querySelector('.wo-demo-suggest__later').addEventListener('click', function () {
                ss(KEYS.suggestDismissed, '1');
                removeSuggestion();
            });
            document.body.appendChild(card);
        });
    }

    /* -------------------------------- API -------------------------------- */
    function cleanUrl(extra) {
        var url = new URL(window.location.href);
        url.searchParams.delete('demo'); url.searchParams.delete('tour');
        Object.keys(extra || {}).forEach(function (k) { url.searchParams.set(k, extra[k]); });
        return url.pathname + (url.search || '') + (url.hash || '');
    }
    function withParam(path, key, value) {
        var url = new URL(path, window.location.origin);
        url.searchParams.set(key, value);
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
            var url = new URL(appPath(target), window.location.origin);
            url.searchParams.set('demo', '1');
            if (opts.tour) url.searchParams.set('tour', '1');
            window.location.href = url.pathname + url.search;
        },
        // opts.assist: sale del demo directo al modo asistido (Centro de Cuenta ·
        // Mi perfil, o opts.path). Sin assist vuelve a la página actual (u opts.path).
        disable: function (opts) {
            opts = opts || {};
            try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* sin voz */ }
            exitStorage();
            if (opts.assist) {
                setLocal('assisted_active', true);
                window.location.href = appPath(withParam(opts.path || '/artist/account?asistido=1#perfil', 'asistido', '1'));
                return;
            }
            window.location.href = opts.path ? appPath(withParam(opts.path, 'demo', '0')) : cleanUrl({ demo: '0' });
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
        // Modo asistido: con el demo prendido primero sale del demo (navega);
        // si no, lo activa en el servidor y abre el panel en esta página.
        startAssist: function (opts) {
            opts = opts || {};
            if (enabled) { api.disable({ assist: true, path: opts.path }); return Promise.resolve(null); }
            setLocal('assisted_active', true);
            requestOnboarding({ assisted: { active: true } }).then(null, quiet('asistido'));
            return bootAssist(true).then(function (A) {
                if (A && typeof A.open === 'function') A.open();
                emit('wo:assist-changed', { active: true });
                return A;
            }).then(null, function (err) {
                quiet('asistido')(err);
                emit('wo:assist-changed', { active: true });
                return null;
            });
        },
        // Si el POST falla, el espejo y el panel vuelven a como estaban (salvo
        // que otro cambio local haya pasado después) y la promesa rechaza: sin
        // esto el siguiente GET devolvía el modo asistido sin aviso.
        stopAssist: function () {
            var A = window.WoAssist;
            var prev = !!readMirror().assisted_active || assistMounted();
            var saving = saveLocal('assisted_active', false, prev, { assisted: { active: false } }, function (back) {
                if (!back) return;
                emit('wo:assist-changed', { active: true });
                reopenAssist();
            });
            if (A && typeof A.close === 'function') {
                try { A.close(); } catch (e) { debug('WoAssist.close:', e && e.message); }
            }
            emit('wo:assist-changed', { active: false });
            return saving.then(function () { return false; }, function (err) {
                quiet('asistido')(err);
                throw err;
            });
        },
        suggestionsEnabled: function () { return readMirror().demo_suggestions !== false; },
        // Mismo criterio que stopAssist: un POST fallido vuelve el switch y la
        // tarjeta al valor anterior, avisa con el evento y rechaza (el menú Ö
        // muestra un aviso breve).
        setSuggestions: function (value) {
            var next = !!value;
            var saving = saveLocal('demo_suggestions', next, api.suggestionsEnabled(), { demo_suggestions: next }, function (back) {
                emit('wo:demo-suggestions-changed', { enabled: back });
            });
            emit('wo:demo-suggestions-changed', { enabled: next });
            return saving.then(function () { return next; }, function (err) {
                quiet('demo_suggestions')(err);
                throw err;
            });
        },
        appPath: appPath,
        getAccessToken: getAccessToken,
        api: apiCall,
        onboarding: onboarding,
        store: function () { return store; },
        assets: ASSETS,
        // Decisiones puras, expuestas para tests/demo-onboarding.test.js.
        _internal: {
            parseFlags: parseFlags,
            isDashboardPath: isDashboardPath,
            shouldAutoStart: shouldAutoStart,
            shouldShowSuggestion: shouldShowSuggestion,
            shouldMarkDemoSeen: shouldMarkDemoSeen,
            shouldSync: shouldSync,
            withoutParam: withoutParam,
            assistTarget: assistTarget,
            joinBase: joinBase,
            mirrorKey: mirrorKey,
            parseMirror: parseMirror,
            NEW_WINDOW_DAYS: NEW_WINDOW_DAYS
        }
    };
    window.WoDemo = api;

    if (enabled) {
        installFetch();
        document.documentElement.classList.add('wo-demo-on');
        ready = Promise.all([loadScript(ASSETS.postgrest), loadScript(ASSETS.fixtures)]).then(loadFixtureExtensions).then(buildStore);
        ready.catch(function (err) { warn('demo no disponible:', err && err.message); });
        api.ready = ready;
        api.tourReady = Promise.all([loadCss(ASSETS.css), loadScript(ASSETS.tour).then(function () { return loadScript(ASSETS.steps); })])
            .catch(function (err) { warn('recorrido no disponible:', err && err.message); });
        var boot = function () {
            renderBar();
            api.tourReady.then(function () {
                if (window.WoTour && typeof window.WoTour.autoResume === 'function') window.WoTour.autoResume({ wantsTour: wantsTour });
            });
            if (autoStarted || demoSeen) {
                setTimeout(function () {
                    requestOnboarding({ demo_auto_started: true }).then(null, quiet('demo_auto_started'));
                }, SYNC_DELAY_MS);
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    } else {
        api.ready = Promise.resolve(null);
        api.tourReady = Promise.resolve(null);
        var bootOff = function () {
            // ?asistido=1|0: el POST deja el estado en el servidor y sirve de caché
            // para el primer onboarding() del panel.
            if (flags.assist !== null && identity.userId) {
                requestOnboarding({ assisted: { active: flags.assist } }).then(null, quiet('asistido'));
            } else if (shouldSync({
                userId: identity.userId, enabled: enabled, flags: flags, mirror: readMirror(),
                pathname: window.location.pathname, basePath: currentBase(), now: Date.now()
            })) {
                setTimeout(function () { onboarding().then(null, syncFailed); }, SYNC_DELAY_MS);
            }
            if (readMirror().assisted_active) bootAssist(flags.assist === true).then(null, quiet('asistido'));
            if (isDashboardPath(window.location.pathname, currentBase())) {
                document.addEventListener('wo:demo-suggestions-changed', function (e) {
                    if (e && e.detail && e.detail.enabled === false) removeSuggestion(); else renderSuggestion();
                });
                setTimeout(renderSuggestion, SUGGEST_DELAY_MS);
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootOff); else bootOff();
    }
})();
