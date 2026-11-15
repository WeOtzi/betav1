/**
 * WE ÖTZI — Favoritos · modelo puro (ronda 2 · P22)
 * ----------------------------------------------------------------------------
 * Reglas sin DOM de las listas de favoritos del cliente: qué es un favorito
 * válido, cómo se limpia lo que llega de un <button data-wo-favorite>, nombres
 * de lista, intención pendiente (guardar antes de iniciar sesión) y textos.
 * Lo usan wo-favorites.js (corazón + selector de listas), client-favorites.js
 * (/client/favorites) y los tests de Node (tests/r2-favoritos*.test.js).
 *
 * Los límites y las reglas de URL son los mismos que hace cumplir la base
 * (supabase/migrations/20261116190000_favoritos_listas.sql): lo que este
 * modelo deja pasar, la base lo acepta.
 *
 * Expone window.WoFavoritesModel (y module.exports en Node).
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root) root.WoFavoritesModel = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var KINDS = ['artist', 'design', 'merch', 'studio'];
    var KIND_LABELS = {
        artist: { one: 'Artista', many: 'Artistas' },
        design: { one: 'Diseño', many: 'Diseños' },
        merch: { one: 'Merch', many: 'Merch' },
        studio: { one: 'Estudio', many: 'Estudios' }
    };
    var LIMITS = {
        LIST_NAME: 60,
        LABEL: 160,
        TARGET: 200,
        URL: 600,
        IMAGE: 1000,
        LISTS: 50,
        ITEMS_PER_LIST: 500
    };
    var DEFAULT_LIST_NAME = 'Favoritos';
    var INTENT_KEY = 'wo_fav_intent';
    var INTENT_TTL_MS = 24 * 60 * 60 * 1000;
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Controles ASCII + separadores de línea Unicode.
    var CONTROL_RE = /[\u0000-\u001F\u007F\u2028\u2029]/g;   // para replace
    var HAS_CONTROL_RE = /[\u0000-\u001F\u007F\u2028\u2029]/; // para test (sin estado)
    var SPACE_RE = /\s/;

    function str(value) { return value == null ? '' : String(value); }

    /** Texto de una línea: sin controles, espacios colapsados y con tope. */
    function cleanText(value, max) {
        var s = str(value).replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
        return max && s.length > max ? s.slice(0, max).trim() : s;
    }

    function isUuid(value) { return UUID_RE.test(str(value).trim()); }

    function normalizeKind(value) {
        var k = str(value).trim().toLowerCase();
        return KINDS.indexOf(k) === -1 ? '' : k;
    }

    /** Id del destino. Los artistas van en minúsculas (uuid), como en la base. */
    function normalizeId(kind, value) {
        var id = str(value).replace(CONTROL_RE, '').trim();
        if (!id || id.length > LIMITS.TARGET) return '';
        return kind === 'artist' ? id.toLowerCase() : id;
    }

    /**
     * Imagen del snapshot: https absoluta o ruta local ("/shared/…"). Nunca
     * data:, blob:, javascript:, http: ni //host. Devuelve '' si no sirve.
     */
    function safeImageUrl(value) {
        var s = str(value).trim();
        if (!s || s.length > LIMITS.IMAGE || SPACE_RE.test(s) || HAS_CONTROL_RE.test(s)) return '';
        if (/^https:\/\/[^/]/i.test(s)) return 'https://' + s.slice(8);
        if (s.charAt(0) === '/' && s.length > 1 && s.charAt(1) !== '/' && s.charAt(1) !== '\\') return s;
        return '';
    }

    /**
     * Ruta del mismo sitio ("/store/item/?id=1"). Acepta una URL absoluta solo
     * si es del mismo origen (opts.origin) y le quita el base path (opts.basePath:
     * "/beta"). Devuelve '' para otro origen, esquemas raros o "//host".
     */
    function safePath(value, opts) {
        var o = opts || {};
        var s = str(value).trim();
        if (!s) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
            var origin = str(o.origin);
            if (!origin || s.toLowerCase().indexOf(origin.toLowerCase() + '/') !== 0) return '';
            s = s.slice(origin.length);
        }
        if (s.charAt(0) !== '/' || s.charAt(1) === '/' || s.charAt(1) === '\\') return '';
        if (SPACE_RE.test(s) || HAS_CONTROL_RE.test(s)) return '';
        var base = str(o.basePath).replace(/\/+$/, '');
        if (base && (s === base || s.indexOf(base + '/') === 0 || s.indexOf(base + '?') === 0)) {
            s = s.slice(base.length) || '/';
            if (s.charAt(0) !== '/') s = '/' + s;
            if (s.charAt(1) === '/' || s.charAt(1) === '\\') return '';
        }
        return s.length > LIMITS.URL ? '' : s;
    }

    /** Destino por defecto cuando el botón no trae data-url. */
    function defaultUrl(kind, id) {
        if (!id) return '';
        if (kind === 'artist') return isUuid(id) ? '/artist/profile?id=' + encodeURIComponent(id) : '';
        if (kind === 'studio') return '/studio/profile?studio=' + encodeURIComponent(id);
        return '';
    }

    /**
     * Normaliza lo que trae un <button data-wo-favorite>. data: { kind, id,
     * label, image, url, artistId }. ctx: { origin, basePath, pagePath }.
     * Devuelve { kind, id, label, image, url, artistId } o null si no alcanza
     * para guardar (sin kind válido o sin id).
     */
    function normalizeItem(data, ctx) {
        var d = data || {};
        var c = ctx || {};
        var kind = normalizeKind(d.kind);
        if (!kind) return null;
        var id = normalizeId(kind, d.id);
        if (!id) return null;
        var pathOpts = { origin: c.origin, basePath: c.basePath };
        var url = safePath(d.url, pathOpts) || defaultUrl(kind, id) || safePath(c.pagePath, pathOpts);
        var artistId = '';
        if (kind === 'artist') artistId = isUuid(id) ? id : '';
        else if (kind !== 'studio' && isUuid(d.artistId)) artistId = str(d.artistId).trim().toLowerCase();
        return {
            kind: kind,
            id: id,
            label: cleanText(d.label, LIMITS.LABEL),
            image: safeImageUrl(d.image),
            url: url,
            artistId: artistId
        };
    }

    function itemKey(kind, id) { return str(kind) + ':' + str(id); }

    /** Fila de favorite_items → objeto de la UI. */
    function rowToItem(row) {
        var r = row || {};
        var kind = normalizeKind(r.kind);
        return {
            itemId: str(r.id),
            listId: str(r.list_id),
            kind: kind,
            id: normalizeId(kind, r.target_id),
            label: cleanText(r.label, LIMITS.LABEL),
            image: safeImageUrl(r.image_url),
            url: safePath(r.url),
            artistId: isUuid(r.artist_user_id) ? str(r.artist_user_id).toLowerCase() : '',
            createdAt: str(r.created_at)
        };
    }

    /** Fila de favorite_lists → objeto de la UI. */
    function rowToList(row) {
        var r = row || {};
        return {
            id: str(r.id),
            name: cleanText(r.name, LIMITS.LIST_NAME) || DEFAULT_LIST_NAME,
            isDefault: r.is_default === true,
            sortOrder: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 0,
            createdAt: str(r.created_at)
        };
    }

    /** La lista por defecto primero; después por orden, fecha y nombre. */
    function sortLists(lists) {
        return (Array.isArray(lists) ? lists.slice() : []).sort(function (a, b) {
            if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
            return str(a.name).localeCompare(str(b.name), 'es');
        });
    }

    function nextSortOrder(lists) {
        var max = 0;
        (Array.isArray(lists) ? lists : []).forEach(function (l) { if (l && l.sortOrder > max) max = l.sortOrder; });
        return Math.min(max + 1, 100000);
    }

    /** { 'artist:<id>': [listId, …] } con los ítems ya normalizados (rowToItem). */
    function buildIndex(items) {
        var index = Object.create(null);
        (Array.isArray(items) ? items : []).forEach(function (it) {
            if (!it || !it.kind || !it.id || !it.listId) return;
            var key = itemKey(it.kind, it.id);
            if (!index[key]) index[key] = [];
            if (index[key].indexOf(it.listId) === -1) index[key].push(it.listId);
        });
        return index;
    }

    function kindCounts(items) {
        var counts = { all: 0, artist: 0, design: 0, merch: 0, studio: 0 };
        (Array.isArray(items) ? items : []).forEach(function (it) {
            if (!it || counts[it.kind] === undefined || it.kind === 'all') return;
            counts[it.kind] += 1;
            counts.all += 1;
        });
        return counts;
    }

    /** Ítems de una lista (y de un tipo, si se pide), más recientes primero. */
    function filterItems(items, filter) {
        var f = filter || {};
        var kind = normalizeKind(f.kind);
        return (Array.isArray(items) ? items : [])
            .filter(function (it) {
                return it && (!f.listId || it.listId === f.listId) && (!kind || it.kind === kind);
            })
            .sort(function (a, b) { return a.createdAt === b.createdAt ? 0 : (a.createdAt < b.createdAt ? 1 : -1); });
    }

    /**
     * Valida el nombre de una lista contra las del usuario. exceptId: la lista
     * que se está renombrando. → { ok, value, error }.
     */
    function validateListName(name, lists, exceptId) {
        var value = cleanText(name);
        if (!value) return { ok: false, value: '', error: 'Escribe un nombre para la lista.' };
        if (value.length > LIMITS.LIST_NAME) {
            return { ok: false, value: value, error: 'El nombre puede tener hasta ' + LIMITS.LIST_NAME + ' caracteres.' };
        }
        var lower = value.toLowerCase();
        var taken = (Array.isArray(lists) ? lists : []).some(function (l) {
            return l && l.id !== exceptId && str(l.name).toLowerCase() === lower;
        });
        if (taken) return { ok: false, value: value, error: 'Ya tienes una lista con ese nombre.' };
        return { ok: true, value: value, error: '' };
    }

    function canCreateList(lists) { return (Array.isArray(lists) ? lists.length : 0) < LIMITS.LISTS; }

    function countLabel(n) {
        var count = Number(n) || 0;
        if (count <= 0) return 'Sin guardados';
        return count === 1 ? '1 guardado' : count + ' guardados';
    }

    function kindLabel(kind, many) {
        var k = KIND_LABELS[normalizeKind(kind)];
        return k ? (many ? k.many : k.one) : '';
    }

    /** Nombre accesible del corazón según estado. */
    function buttonLabel(item, saved) {
        var it = item || {};
        var what = it.label ? (it.kind === 'artist' ? 'a ' + it.label : '«' + it.label + '»') : '';
        if (saved) return what ? 'Quitar ' + what + ' de favoritos' : 'Quitar de favoritos';
        return what ? 'Guardar ' + what + ' en favoritos' : 'Guardar en favoritos';
    }

    function savedMessage(listName) {
        return 'Guardado en «' + (cleanText(listName, LIMITS.LIST_NAME) || DEFAULT_LIST_NAME) + '»';
    }

    /* ------------------------------ intención ------------------------------ */

    /** Lo que se guarda en localStorage cuando alguien toca el corazón sin sesión. */
    function buildIntent(item, opts) {
        var o = opts || {};
        var it = normalizeItem(item, o);
        if (!it) return null;
        return {
            v: 1,
            item: it,
            returnTo: safePath(o.returnTo, { origin: o.origin, basePath: o.basePath }),
            at: Number(o.now) || Date.now()
        };
    }

    /** Lee una intención guardada. Vencida, rota o manipulada → null. */
    function parseIntent(raw, now) {
        var data = raw;
        if (typeof raw === 'string') {
            try { data = JSON.parse(raw); } catch (e) { return null; }
        }
        if (!data || typeof data !== 'object' || data.v !== 1) return null;
        var at = Number(data.at);
        var current = Number(now) || Date.now();
        if (!Number.isFinite(at) || at > current + 60000 || current - at > INTENT_TTL_MS) return null;
        var item = normalizeItem(data.item);
        if (!item) return null;
        return { v: 1, item: item, returnTo: safePath(data.returnTo), at: at };
    }

    /**
     * Enlaces de ingreso y registro del cliente. El login solo acepta returnTo
     * bajo /store/ (client-auth.js): para el resto, la intención guardada se
     * aplica al entrar y se ofrece volver.
     */
    function authLinks(returnPath) {
        var path = safePath(returnPath);
        var qs = path && (path.indexOf('/store/') === 0) ? '?returnTo=' + encodeURIComponent(path) : '';
        return { login: '/client/login' + qs, register: '/client/register' + qs };
    }

    /* -------------------------------- errores ------------------------------- */

    function errorCode(err) {
        var e = err || {};
        return str(e.code || (e.cause && e.cause.code));
    }
    function errorText(err) {
        var e = err || {};
        return str(e.message) + ' ' + str(e.cause && e.cause.message);
    }

    /** ¿La base todavía no tiene las tablas/funciones de favoritos? */
    function isMissingSchemaError(err) {
        var code = errorCode(err);
        if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') return true;
        var text = errorText(err);
        return /favorite_(lists|items)|favorites_(save|default_list_id)/i.test(text)
            && /does not exist|could not find|schema cache/i.test(text);
    }

    /** Mensaje para la persona. context: 'list' cuando el error viene de crear/renombrar. */
    function errorMessage(err, context) {
        var code = errorCode(err);
        var text = errorText(err);
        if (/favorites:list_limit/.test(text)) return 'Llegaste al máximo de ' + LIMITS.LISTS + ' listas. Borra alguna para crear otra.';
        if (/favorites:item_limit/.test(text)) return 'Esta lista está llena (' + LIMITS.ITEMS_PER_LIST + ' guardados). Elige otra lista.';
        if (/favorites:auth_required/.test(text) || code === '28000' || code === 'PGRST301' || /jwt expired/i.test(text)) {
            return 'Tu sesión venció. Inicia sesión de nuevo para guardar.';
        }
        if (code === '23505' && context === 'list') return 'Ya tienes una lista con ese nombre.';
        if (isMissingSchemaError(err)) return 'Los favoritos todavía no están disponibles. Inténtalo más tarde.';
        if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
            return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.';
        }
        return context === 'list'
            ? 'No pudimos guardar la lista. Inténtalo de nuevo.'
            : 'No pudimos guardar el cambio. Inténtalo de nuevo.';
    }

    return {
        KINDS: KINDS,
        KIND_LABELS: KIND_LABELS,
        LIMITS: LIMITS,
        DEFAULT_LIST_NAME: DEFAULT_LIST_NAME,
        INTENT_KEY: INTENT_KEY,
        INTENT_TTL_MS: INTENT_TTL_MS,
        cleanText: cleanText,
        isUuid: isUuid,
        normalizeKind: normalizeKind,
        normalizeId: normalizeId,
        safeImageUrl: safeImageUrl,
        safePath: safePath,
        defaultUrl: defaultUrl,
        normalizeItem: normalizeItem,
        itemKey: itemKey,
        rowToItem: rowToItem,
        rowToList: rowToList,
        sortLists: sortLists,
        nextSortOrder: nextSortOrder,
        buildIndex: buildIndex,
        kindCounts: kindCounts,
        filterItems: filterItems,
        validateListName: validateListName,
        canCreateList: canCreateList,
        countLabel: countLabel,
        kindLabel: kindLabel,
        buttonLabel: buttonLabel,
        savedMessage: savedMessage,
        buildIntent: buildIntent,
        parseIntent: parseIntent,
        authLinks: authLinks,
        isMissingSchemaError: isMissingSchemaError,
        errorMessage: errorMessage
    };
}));
