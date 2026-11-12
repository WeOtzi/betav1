/**
 * WE ÖTZI - Configuración y accesibilidad global del artista (Cuenta 801:574)
 * ---------------------------------------------------------------------------
 * Loader liviano que aplica en TODAS las páginas del artista lo que se elige en
 * /artist/account#configuracion (user_preferences.app_settings):
 *   - Apariencia: tema, densidad, tamaño de texto, animaciones, reducir
 *     movimiento, aumentar contraste y escala de la interfaz
 *     (atributos body[data-aac-*] + /shared/css/ds/app-settings.css).
 *   - Zona horaria y formatos de fecha/hora: helpers formatDate/formatTime/
 *     formatDateTime para los módulos (window.WoAppSettings).
 *   - Página de inicio al iniciar sesión: startPagePath() (lo usa el login).
 *   - Confirmación antes de cerrar sesión: intercepta el botón LOG OUT.
 *   - 2FA (Cuenta 801:575): si la cuenta tiene un factor TOTP verificado y la
 *     sesión todavía es aal1, vuelve al login para pedir el código.
 * Lo carga wo-artist-menu.js (y el login para la página de inicio). Lee las
 * preferencias vía window.WeotziData.Prefs (account-repo.js) y guarda una copia
 * en localStorage para aplicar la apariencia sin parpadeo en la próxima página.
 * Es UMD: la lógica pura se prueba en tests/r3-cuenta.test.js.
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WoAppSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var CACHE_KEY = 'wo_app_settings_v1';
    var DEFAULTS = Object.freeze({
        timezone: 'America/Argentina/Buenos_Aires', date_format: 'DD/MM/AAAA', time_format: '24h',
        language: 'es', theme: 'light', density: 'comfortable', text_size: 'medium', animations: true,
        start_page: 'dashboard', confirm_logout: true, reduce_motion: false, high_contrast: false,
        interface_scale: '100', display_name: 'artistic', page_size: '25', default_sort: 'recent'
    });
    var START_PAGES = Object.freeze({
        dashboard: '/artist/dashboard',
        quotations: '/my-quotations',
        calendar: '/calendar',
        inbox: '/artist/inbox'
    });
    var DATE_FORMATS = ['DD/MM/AAAA', 'MM/DD/AAAA', 'AAAA-MM-DD'];

    function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

    /** Mezcla app_settings con los defaults y descarta valores fuera de rango. */
    function normalize(settings) {
        var s = {};
        var src = isObj(settings) ? settings : {};
        Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
        Object.keys(src).forEach(function (k) { if (src[k] !== undefined && src[k] !== null && src[k] !== '') s[k] = src[k]; });
        if (['light', 'dark', 'system'].indexOf(s.theme) < 0) s.theme = DEFAULTS.theme;
        if (['comfortable', 'compact'].indexOf(s.density) < 0) s.density = DEFAULTS.density;
        if (['small', 'medium', 'large'].indexOf(s.text_size) < 0) s.text_size = DEFAULTS.text_size;
        if (DATE_FORMATS.indexOf(s.date_format) < 0) s.date_format = DEFAULTS.date_format;
        if (['24h', '12h'].indexOf(s.time_format) < 0) s.time_format = DEFAULTS.time_format;
        if (!START_PAGES[s.start_page]) s.start_page = DEFAULTS.start_page;
        if (!isValidTimezone(s.timezone)) s.timezone = DEFAULTS.timezone;
        s.animations = s.animations !== false;
        s.confirm_logout = s.confirm_logout !== false;
        s.reduce_motion = s.reduce_motion === true;
        s.high_contrast = s.high_contrast === true;
        return s;
    }

    function isValidTimezone(tz) {
        if (!tz || typeof tz !== 'string') return false;
        try { new Intl.DateTimeFormat('es', { timeZone: tz }); return true; } catch (e) { return false; }
    }

    /** Ruta (sin base path) de la página de inicio elegida. */
    function startPagePath(settings) {
        var key = isObj(settings) ? settings.start_page : settings;
        return START_PAGES[key] || START_PAGES.dashboard;
    }

    /** Atributos de apariencia a aplicar (mismo criterio que artist-account.js). */
    function appearance(settings, systemDark) {
        var s = normalize(settings);
        var scale = Math.max(90, Math.min(125, Number(s.interface_scale) || 100));
        return {
            theme: s.theme === 'system' ? (systemDark ? 'dark' : 'light') : s.theme,
            density: s.density,
            textSize: s.text_size,
            noAnimations: s.animations === false || s.reduce_motion === true,
            highContrast: s.high_contrast === true,
            fontSize: scale + '%'
        };
    }

    function toDate(value) {
        if (value instanceof Date) return value;
        if (value === null || value === undefined || value === '') return null;
        // 'AAAA-MM-DD' sin hora es una fecha de calendario: se ancla al mediodía
        // UTC para que la zona horaria no la corra de día.
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T12:00:00Z');
        var d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    function parts(date, settings, opts) {
        var s = normalize(settings);
        var fmt = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: s.timezone }, opts));
        var out = {};
        fmt.formatToParts(date).forEach(function (p) { out[p.type] = p.value; });
        return out;
    }

    /** Fecha con el formato y la zona horaria elegidos ('' si no es fecha). */
    function formatDate(value, settings) {
        var d = toDate(value);
        if (!d) return '';
        var s = normalize(settings);
        var p = parts(d, s, { year: 'numeric', month: '2-digit', day: '2-digit' });
        if (s.date_format === 'MM/DD/AAAA') return p.month + '/' + p.day + '/' + p.year;
        if (s.date_format === 'AAAA-MM-DD') return p.year + '-' + p.month + '-' + p.day;
        return p.day + '/' + p.month + '/' + p.year;
    }

    /** Hora 24 h ("18:05") o 12 h ("6:05 p. m.") en la zona elegida. */
    function formatTime(value, settings) {
        var d = toDate(value);
        if (!d) return '';
        var s = normalize(settings);
        if (s.time_format === '12h') {
            var p12 = parts(d, s, { hour: 'numeric', minute: '2-digit', hour12: true });
            return p12.hour + ':' + p12.minute + ' ' + (String(p12.dayPeriod || '').toUpperCase() === 'PM' ? 'p. m.' : 'a. m.');
        }
        var p = parts(d, s, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        return p.hour + ':' + p.minute;
    }

    function formatDateTime(value, settings) {
        var d = toDate(value);
        if (!d) return '';
        return formatDate(d, settings) + ' · ' + formatTime(d, settings);
    }

    /** La sesión tiene un segundo factor verificado y todavía no lo validó. */
    function needsMfa(aal) {
        return !!aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2';
    }

    // ----------------------------------------------------------------------
    // Runtime (solo navegador)
    // ----------------------------------------------------------------------
    var hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
    var current = { uid: null, settings: normalize(null), loaded: false };

    function appPath(p) {
        var detected = /^\/beta(\/|$)/.test((root.location && root.location.pathname) || '') ? '/beta' : '';
        var base = String(root.WEOTZI_BASE_PATH || detected).replace(/\/$/, '');
        var s = String(p || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }

    function isPreview() {
        if (root.WEOTZI_PREVIEW === true) return true;
        try { return root.sessionStorage.getItem('wo_demo_mode') === '1'; } catch (e) { return false; }
    }

    function readCache() {
        try {
            var raw = JSON.parse(root.localStorage.getItem(CACHE_KEY) || 'null');
            return isObj(raw) && isObj(raw.settings) ? raw : null;
        } catch (e) { return null; }
    }

    function writeCache(uid, settings) {
        try { root.localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: uid || null, settings: settings })); }
        catch (e) { /* almacenamiento bloqueado */ }
    }

    function ensureStylesheet() {
        if (!hasDom || document.querySelector('link[data-wo-app-settings]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = appPath('/shared/css/ds/app-settings.css');
        link.setAttribute('data-wo-app-settings', '');
        (document.head || document.documentElement).appendChild(link);
    }

    function apply(settings) {
        if (!hasDom || !document.body) return;
        var systemDark = !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
        var a = appearance(settings, systemDark);
        var body = document.body;
        body.dataset.aacTheme = a.theme;
        body.dataset.aacDensity = a.density;
        body.dataset.aacTextSize = a.textSize;
        body.classList.toggle('aac-no-animations', a.noAnimations);
        body.classList.toggle('aac-high-contrast', a.highContrast);
        document.documentElement.style.fontSize = a.fontSize;
        document.documentElement.dataset.woTimezone = normalize(settings).timezone;
    }

    /** Lo llama Cuenta al guardar: actualiza la copia local y la página. */
    function remember(settings, uid) {
        current.settings = normalize(settings);
        if (uid) current.uid = uid;
        writeCache(current.uid, current.settings);
        apply(current.settings);
        if (hasDom) document.dispatchEvent(new CustomEvent('wo:app-settings', { detail: current.settings }));
        return current.settings;
    }

    async function resolveClient() {
        if (root.ConfigManager && typeof root.ConfigManager.ready === 'function') {
            try { await root.ConfigManager.ready(); } catch (e) { /* sigue */ }
        }
        for (var i = 0; i < 20; i++) {
            var c = root._supabase
                || (root.WeotziData && root.WeotziData.getClient && root.WeotziData.getClient())
                || (root.ConfigManager && typeof root.ConfigManager.getSupabaseClient === 'function'
                    && root.ConfigManager.getSupabaseClient());
            if (c) return c;
            await new Promise(function (r) { setTimeout(r, 150); });
        }
        return null;
    }

    function loadScript(src, isReady) {
        if (isReady()) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = appPath(src);
            script.onload = function () { isReady() ? resolve() : reject(new Error('Sin API: ' + src)); };
            script.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
            document.head.appendChild(script);
        });
    }

    /** Lee app_settings del usuario (WeotziData.Prefs). */
    async function fetchForUser(uid) {
        if (!uid) return normalize(null);
        await loadScript('/shared/js/data/account-repo.js', function () {
            return !!(root.WeotziData && root.WeotziData.Prefs);
        });
        var row = await root.WeotziData.Prefs.get(uid);
        return normalize(row && row.app_settings);
    }

    function onLoginPage() {
        return /\/artist\/login(\/|$)/.test((root.location && root.location.pathname) || '');
    }

    /** 2FA: vuelve al login si la sesión no validó el segundo factor. */
    async function enforceMfa(client) {
        if (onLoginPage() || isPreview()) return false;
        var mfa = client && client.auth && client.auth.mfa;
        if (!mfa || typeof mfa.getAuthenticatorAssuranceLevel !== 'function') return false;
        try {
            var res = await mfa.getAuthenticatorAssuranceLevel();
            if (res && !res.error && needsMfa(res.data)) {
                var back = root.location.pathname + root.location.search + root.location.hash;
                root.location.replace(appPath('/artist/login?mfa=1&returnTo=' + encodeURIComponent(back)));
                return true;
            }
        } catch (e) { console.warn('[app-settings] 2FA:', e && e.message); }
        return false;
    }

    var logoutGuardOn = false;
    function installLogoutConfirm() {
        if (!hasDom || logoutGuardOn) return;
        logoutGuardOn = true;
        // Captura en window: corre antes que el onclick del botón LOG OUT.
        root.addEventListener('click', function (event) {
            var btn = event.target && event.target.closest
                && event.target.closest('.wo-org-product-nav__logout, #logout-btn, [data-wo-logout]');
            // Cuenta (#aac-logout) ya pregunta con su propio confirm.
            if (!btn || btn.id === 'aac-logout' || !current.loaded || current.settings.confirm_logout === false) return;
            if (root.confirm('¿Querés cerrar sesión?')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    }

    async function boot() {
        ensureStylesheet();
        var cached = readCache();
        if (cached) { current.settings = normalize(cached.settings); current.uid = cached.uid || null; apply(current.settings); }

        var client = await resolveClient();
        if (!client || !client.auth) return;
        var session = null;
        try { session = (await client.auth.getSession()).data.session; } catch (e) { /* sin sesión */ }
        if (!session || !session.user) return;
        if (await enforceMfa(client)) return;

        if (cached && cached.uid && cached.uid !== session.user.id) {
            current.settings = normalize(null);
            apply(current.settings);
        }
        current.uid = session.user.id;
        try {
            remember(await fetchForUser(session.user.id), session.user.id);
        } catch (e) {
            console.warn('[app-settings] preferencias:', e && e.message);
        }
        current.loaded = true;
        installLogoutConfirm();
    }

    var api = {
        DEFAULTS: DEFAULTS,
        START_PAGES: START_PAGES,
        normalize: normalize,
        startPagePath: startPagePath,
        appearance: appearance,
        formatDate: function (v, s) { return formatDate(v, s || current.settings); },
        formatTime: function (v, s) { return formatTime(v, s || current.settings); },
        formatDateTime: function (v, s) { return formatDateTime(v, s || current.settings); },
        needsMfa: needsMfa,
        get: function () { return current.settings; },
        apply: apply,
        remember: remember,
        fetchForUser: fetchForUser,
        ready: null
    };

    if (hasDom && !root.WoAppSettings && !root.__WO_APP_SETTINGS_NO_BOOT) {
        var start = function () { api.ready = boot().catch(function (e) { console.warn('[app-settings]', e && e.message); }); };
        if (onLoginPage()) {
            api.ready = Promise.resolve(); // el login solo usa fetchForUser/startPagePath
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    }
    return api;
});
