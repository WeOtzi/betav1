/**
 * WE ÖTZI — URL pública del artista
 * ---------------------------------
 * Una sola regla para armar y leer el enlace del perfil público:
 *
 *   https://beta.weotzi.com/<handle>          URL corta (la que se comparte)
 *   https://beta.weotzi.com/artist/profile?artist=<usuario>.wo   alias de siempre
 *
 * <handle> es el username sin el sufijo .wo (lauumarth.wo → lauumarth). Si el
 * handle choca con una ruta de la app (explore, studio, api…) o no cumple el
 * formato, se usa el alias largo, que siempre funciona.
 *
 * Lo usan el perfil público (artist-profile.js), los paneles de compartir
 * (dashboard-share.js, wo-share-sheet.js), el servidor (lib/routes/perfil.js)
 * y el paso "Comparte tu perfil" del onboarding (services/artist-onboarding.js).
 *
 * Módulo puro (sin DOM): `window.WoArtistPublicUrl` en el navegador y
 * `require` en Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoArtistPublicUrl = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Mismo formato que valida la base (migración 20261115110000).
    var USERNAME_RE = /^[a-z0-9]{1,30}\.wo$/;
    var HANDLE_RE = /^[a-z0-9]{1,30}$/;
    // Lo que se acepta en la ruta corta: /lau, /@lau, /lau.wo (case-insensitive).
    var PATH_HANDLE_RE = /^@?[a-z0-9]{1,30}(\.wo)?$/i;

    // Rutas de la app que no pueden ser un handle. Incluye todas las carpetas
    // de public/ con nombre alfanumérico (tests/perfil-url-publica.test.js
    // verifica que no falte ninguna) más rutas del servidor, rutas retiradas y
    // nombres que conviene no regalar. El servidor suma en vivo las carpetas
    // que existan en public/ (lib/reserved-handles.js).
    var RESERVED = [
        // carpetas de public/
        'artist', 'backoffice', 'bienvenida', 'calendar', 'client', 'componentes', 'explore',
        'inicio', 'legal', 'marketplace', 'quotation', 'quotations', 'recover', 'flash',
        'registerclosedbeta', 'shared', 'store', 'studio', 'support', 'travel',
        // servidor, rutas retiradas y base path
        'api', 'beta', 'archive', 'tutorial', 'health', 'status', 'webhook', 'webhooks', 'cron',
        // producto
        'admin', 'administrador', 'app', 'apps', 'artists', 'artista', 'artistas', 'tatuador',
        'tatuadores', 'clients', 'cliente', 'clientes', 'studios', 'estudio', 'estudios',
        'account', 'cuenta', 'dashboard', 'panel', 'inbox', 'mensajes', 'messages', 'chat',
        'profile', 'perfil', 'perfiles', 'settings', 'ajustes', 'configuracion', 'login', 'logout',
        'signin', 'signup', 'register', 'registro', 'auth', 'oauth', 'callback', 'session',
        'cotizar', 'cotizacion', 'cotizaciones', 'presupuesto', 'turnos', 'reservas', 'agenda',
        'mapa', 'map', 'globe', 'explorar', 'buscar', 'search', 'tienda', 'shop', 'checkout',
        'pagos', 'payments', 'wallet', 'billing', 'soporte', 'ayuda', 'help', 'faq', 'faqs',
        'about', 'contacto', 'contact', 'privacy', 'privacidad', 'terms', 'terminos', 'cookies',
        'blog', 'news', 'press', 'jobs', 'jobboard', 'spots', 'invitations', 'invitaciones',
        'notifications', 'notificaciones', 'statistics', 'estadisticas', 'home', 'index',
        // técnicos
        'assets', 'static', 'public', 'img', 'images', 'js', 'css', 'fonts', 'favicon', 'robots',
        'sitemap', 'manifest', 'well', 'www', 'mail', 'email', 'root', 'null', 'undefined',
        'weotzi', 'otzi', 'oetzi', 'new', 'edit', 'me', 'u', 'p', 'user', 'users', 'test'
    ];
    var RESERVED_SET = {};
    RESERVED.forEach(function (h) { RESERVED_SET[h] = true; });

    function isReserved(handle, extra) {
        var h = String(handle || '').toLowerCase();
        if (RESERVED_SET[h]) return true;
        if (extra && typeof extra.has === 'function') return extra.has(h);
        if (Array.isArray(extra)) return extra.indexOf(h) !== -1;
        return false;
    }

    /**
     * Normaliza lo que llega por URL o de la base: quita espacios y @ iniciales,
     * pasa a minúsculas y agrega .wo si falta. No valida el formato (las filas
     * viejas pueden traer guiones): devuelve '' solo si no queda nada.
     */
    function normalizeUsername(value) {
        var raw = String(value == null ? '' : value).trim().replace(/^@+/, '').toLowerCase();
        if (!raw) return '';
        return /\.wo$/.test(raw) ? raw : raw + '.wo';
    }

    function isValidUsername(value) {
        return USERNAME_RE.test(String(value || ''));
    }

    /** Handle de la URL corta, o '' si el usuario no admite URL corta. */
    function handleFromUsername(username, extraReserved) {
        var normalized = normalizeUsername(username);
        if (!isValidUsername(normalized)) return '';
        var handle = normalized.slice(0, -3);
        return HANDLE_RE.test(handle) && !isReserved(handle, extraReserved) ? handle : '';
    }

    /**
     * Lee un segmento de ruta (/lau, /@lau, /lau.wo). Devuelve
     * { handle, username, canonical } o null si no tiene forma de handle o
     * está reservado. `canonical` es false si hay que redirigir a /<handle>.
     */
    function parsePathHandle(segment, extraReserved) {
        var raw = String(segment == null ? '' : segment);
        try { raw = decodeURIComponent(raw); } catch (e) { return null; }
        raw = raw.replace(/^\/+|\/+$/g, '');
        if (!PATH_HANDLE_RE.test(raw)) return null;
        var handle = raw.replace(/^@/, '').replace(/\.wo$/i, '').toLowerCase();
        if (!HANDLE_RE.test(handle) || isReserved(handle, extraReserved)) return null;
        return { handle: handle, username: handle + '.wo', canonical: raw === handle };
    }

    function trimBase(base) {
        return String(base == null ? '' : base).replace(/\/+$/, '');
    }

    /**
     * URL pública para compartir. `base` es el origen + base path de la app
     * ('' para una ruta relativa). `opts.hash` agrega un ancla (#block-gallery).
     */
    function publicProfileUrl(username, base, opts) {
        var options = opts || {};
        var normalized = normalizeUsername(username);
        if (!normalized) return '';
        var handle = handleFromUsername(normalized, options.reserved);
        var path = handle
            ? '/' + handle
            : '/artist/profile?artist=' + encodeURIComponent(normalized);
        var hash = options.hash ? '#' + String(options.hash).replace(/^#/, '') : '';
        return trimBase(base) + path + hash;
    }

    /** Enlace interno de siempre (navegación dentro de la app). */
    function legacyProfilePath(username) {
        var normalized = normalizeUsername(username);
        return normalized ? '/artist/profile?artist=' + encodeURIComponent(normalized) : '';
    }

    /**
     * Usuario pedido en la URL del perfil: ?artist= (oficial) o los alias
     * ?u= / ?username= que usaban algunos enlaces. ?id= (uuid) va aparte.
     */
    function usernameFromSearch(search) {
        var params;
        try { params = new URLSearchParams(String(search || '')); } catch (e) { return ''; }
        return params.get('artist') || params.get('u') || params.get('username') || '';
    }

    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    function isUuid(value) { return UUID_RE.test(String(value || '')); }

    return {
        RESERVED: RESERVED.slice(),
        USERNAME_RE: USERNAME_RE,
        isReserved: isReserved,
        normalizeUsername: normalizeUsername,
        isValidUsername: isValidUsername,
        handleFromUsername: handleFromUsername,
        parsePathHandle: parsePathHandle,
        publicProfileUrl: publicProfileUrl,
        legacyProfilePath: legacyProfilePath,
        usernameFromSearch: usernameFromSearch,
        isUuid: isUuid
    };
}));
