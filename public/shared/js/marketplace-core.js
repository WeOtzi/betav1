/**
 * WE OTZI - Lógica pura del Marketplace y de /explore
 * ---------------------------------------------------
 * Sin DOM ni red: `window.WeotziMarketplaceCore` en el navegador y `require`
 * en Node (tests). Lo usan marketplace.js y explore-map.js.
 *
 *  - Estilos: normalización sin tildes ni mayúsculas y agrupación por la
 *    etiqueta canónica del catálogo del registro (lib/registration-catalogs.js).
 *    "Japonés", "Japones" y "JAPONES" son el mismo estilo; "Tradicional" NO
 *    incluye "Neo-Tradicional" y "Realismo" NO incluye "Microrealismo".
 *    El catálogo completo llega de GET /api/registration/catalogs
 *    (setStyleCatalog); mientras tanto rige la copia local de los alias
 *    históricos (FALLBACK_ALIASES, espejo de LEGACY_STYLE_ALIASES: un test
 *    verifica la paridad).
 *  - Precio: tramos en USD normalizados (session_price_amount_usd) sin
 *    solapes; sin precio no cae en ningún tramo.
 *  - Agenda: banderas independientes por artista (disponible, agenda
 *    cerrada, guest ahora, viaje próximo, vacaciones) desde
 *    artist_tattoo_locations + viajes de Travel (public_artist_trips) +
 *    vacation_start/vacation_end.
 *  - Ciudades: clave sin tildes, se muestra la variante más frecuente.
 *  - Estudios: estado ("Turnos disponibles", "Con artistas invitados",
 *    "Busca artistas") desde sus columnas públicas y su roster.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeotziMarketplaceCore = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    // ------------------------------------------------------------------ texto

    function normalizeKey(value) {
        return String(value == null ? '' : value)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function titleCase(value) {
        return String(value == null ? '' : value).trim().split(/\s+/).filter(Boolean)
            .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
            .join(' ');
    }

    function plural(n, singular, pluralForm) {
        return n + ' ' + (n === 1 ? singular : pluralForm);
    }

    // Solo URLs http(s) o rutas del mismo sitio (nunca javascript:, data:…).
    function safeMediaUrl(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return '';
        if (/^https?:\/\//i.test(s)) return s;
        if (s.charAt(0) === '/' && s.charAt(1) !== '/') return s;
        return '';
    }

    function parseList(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.filter(function (v) { return v != null && String(v).trim(); }).map(function (v) { return String(v).trim(); });
        if (typeof value === 'string') {
            var s = value.trim();
            if (s.charAt(0) === '[') {
                try { return parseList(JSON.parse(s)); } catch (e) { /* texto libre */ }
            }
            return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        }
        return [String(value)];
    }

    // ---------------------------------------------------------------- estilos

    // Espejo de LEGACY_STYLE_ALIASES (lib/registration-catalogs.js). Solo se usa
    // hasta que llega el catálogo del servidor o si ese pedido falla.
    var FALLBACK_ALIASES = {
        'Realismo': ['REALIMSMO'],
        'Hiperrealismo': [],
        'Microrealismo': ['Micro-realismo', 'Micro realismo'],
        'Fine Line': ['FINELINE', 'Fineline'],
        'Black and Grey': ['Black & Grey', 'Black and Gray', 'Black & Gray'],
        'Tradicional Americano (Old School)': ['Tradicional', 'Tradicional americano', 'Old School', 'American Traditional'],
        'Neotradicional': ['Neo-Tradicional', 'Neo Tradicional', 'NEOTRADICIONAL'],
        'Tradicional Japonés (Irezumi)': ['Japonés', 'Japones', 'Irezumi'],
        'Neojaponés': ['Neo-Japanese', 'Neo Japonés', 'Neojapones'],
        'Geométrico': ['Geometrico'],
        'Lettering': ['Lettering / Caligrafía'],
        'Caligrafía': ['Caligrafia'],
        'Acuarela (Watercolor)': ['Acuarela', 'Watercolor'],
        'Surrealismo': ['Surrealista'],
        'Mandalas': ['Mandala'],
        'Tribal Polinesio': ['Polinesio'],
        'Maorí': ['Maori'],
        'Nórdico': ['Nordico / Viking', 'Nordico'],
        'Grabado (Engraving)': ['Etching / Grabado', 'Grabado'],
        'Xilografía (Woodcut)': ['Woodcut / Xilografia', 'Xilografia', 'Woodcut'],
        'Sketch': ['Sketch / Boceto', 'Boceto'],
        'Gothic Lettering': ['Blackletter / Gotico', 'Blackletter'],
        'Ignorant Style': ['Ignorant'],
        'Biomecánico': ['Biomecanico'],
        'Bioorgánico': ['Bioorganico'],
        'Botánico': ['Ilustracion botanica', 'Fineline botanico'],
        'Art Déco': ['Art Deco'],
        'Retratos': ['Retrato'],
        'Puntillismo Geométrico': ['Pointillism'],
        'Blackwork Ornamental': ['Ornamental Blackwork'],
        'Glitch Tattoo': ['Glitch'],
        'Cibersigilismo (Cybersigilism)': ['CYBERSIGILISMO', 'Cybersigilismo', 'Cybersigilism'],
        'Freehand Abstract': ['FREEHAND', 'Freehand'],
        'Brushstroke': ['Abstract Brush']
    };
    var FALLBACK_QUICK = [
        { label: 'Blackwork', catalog: ['Blackwork'] },
        { label: 'Fine Line', catalog: ['Fine Line'] },
        { label: 'Geométrico', catalog: ['Geométrico'] },
        { label: 'Japonés', catalog: ['Tradicional Japonés (Irezumi)'] },
        { label: 'Lettering / Caligrafía', catalog: ['Lettering', 'Caligrafía'] },
        { label: 'Microrealismo', catalog: ['Microrealismo'] },
        { label: 'Minimalista', catalog: ['Minimalista'] },
        { label: 'Neotradicional', catalog: ['Neotradicional'] },
        { label: 'Realismo', catalog: ['Realismo'] },
        { label: 'Tradicional americano', catalog: ['Tradicional Americano (Old School)'] }
    ];

    var catalogStyles = [];   // [{ label, aliases[] }]
    var quickStyles = [];     // [{ label, catalog[], aliases[] }]
    var canonicalIndex = new Map();

    function buildIndex() {
        canonicalIndex = new Map();
        catalogStyles.forEach(function (style) { canonicalIndex.set(normalizeKey(style.label), style.label); });
        catalogStyles.forEach(function (style) {
            style.aliases.forEach(function (alias) {
                var key = normalizeKey(alias);
                if (key && !canonicalIndex.has(key)) canonicalIndex.set(key, style.label);
            });
        });
        quickStyles.forEach(function (quick) {
            var key = normalizeKey(quick.label);
            if (key && !canonicalIndex.has(key) && quick.catalog.length) canonicalIndex.set(key, quick.catalog[0]);
        });
    }

    function quickFromDefs(defs, aliasesByLabel) {
        return defs.map(function (def) {
            var catalog = parseList(def.catalog);
            var aliases = parseList(def.aliases);
            if (!def.aliases) {
                var set = [];
                catalog.forEach(function (label) {
                    set.push(label);
                    (aliasesByLabel[label] || []).forEach(function (a) { set.push(a); });
                });
                aliases = set.filter(function (a) { return a !== def.label; });
            }
            return { label: String(def.label || ''), catalog: catalog, aliases: aliases };
        }).filter(function (q) { return q.label; });
    }

    function useFallbackCatalog() {
        catalogStyles = Object.keys(FALLBACK_ALIASES).map(function (label) {
            return { label: label, aliases: FALLBACK_ALIASES[label].slice() };
        });
        quickStyles = quickFromDefs(FALLBACK_QUICK, FALLBACK_ALIASES);
        buildIndex();
    }

    // payload = respuesta de /api/registration/catalogs (o su campo `styles`):
    // { quick: [{label, catalog, aliases}], groups: [{ styles: [{label, aliases}] }] }
    function setStyleCatalog(payload) {
        var styles = payload && payload.styles ? payload.styles : payload;
        var groups = styles && Array.isArray(styles.groups) ? styles.groups : null;
        if (!groups || !groups.length) return false;
        var list = [];
        groups.forEach(function (group) {
            (Array.isArray(group && group.styles) ? group.styles : []).forEach(function (style) {
                if (style && style.label) list.push({ label: String(style.label), aliases: parseList(style.aliases) });
            });
        });
        if (!list.length) return false;
        catalogStyles = list;
        quickStyles = quickFromDefs(Array.isArray(styles.quick) ? styles.quick : [], {});
        buildIndex();
        return true;
    }

    function canonicalStyleLabel(value) {
        var key = normalizeKey(value);
        if (!key) return null;
        return canonicalIndex.get(key) || null;
    }

    function styleMatchKeys(value) {
        var own = normalizeKey(value);
        if (!own) return [];
        var keys = new Set([own]);
        var canonical = canonicalStyleLabel(value);
        if (canonical) {
            keys.add(normalizeKey(canonical));
            var entry = catalogStyles.find(function (s) { return s.label === canonical; });
            (entry ? entry.aliases : []).forEach(function (a) { keys.add(normalizeKey(a)); });
        }
        var quick = quickStyles.find(function (q) { return normalizeKey(q.label) === own; });
        if (quick) quick.aliases.forEach(function (a) { keys.add(normalizeKey(a)); });
        return Array.from(keys);
    }

    function stylesMatch(storedValue, filterValue) {
        var stored = new Set(styleMatchKeys(storedValue));
        return styleMatchKeys(filterValue).some(function (k) { return stored.has(k); });
    }

    // Clave de agrupación de un estilo guardado: su canónica o, si es un
    // estilo propio, el propio texto normalizado.
    function styleGroupKey(value) {
        return normalizeKey(canonicalStyleLabel(value) || value);
    }

    // Opciones de un filtro de estilo a partir de los estilos REALES de una
    // lista (artistas o estudios). value = clave de grupo; label = canónica o
    // la variante más frecuente de un estilo propio; count = ítems distintos.
    function buildStyleOptions(items, getStyles) {
        var groups = new Map();
        (items || []).forEach(function (item) {
            var seen = new Set();
            parseList(getStyles(item)).forEach(function (raw) {
                var key = styleGroupKey(raw);
                if (!key || seen.has(key)) return;
                seen.add(key);
                var g = groups.get(key);
                if (!g) { g = { value: key, canonical: canonicalStyleLabel(raw), variants: new Map(), count: 0 }; groups.set(key, g); }
                g.count += 1;
                g.variants.set(raw, (g.variants.get(raw) || 0) + 1);
            });
        });
        return Array.from(groups.values()).map(function (g) {
            var label = g.canonical;
            if (!label) {
                var best = null;
                g.variants.forEach(function (n, variant) { if (!best || n > best.n) best = { v: variant, n: n }; });
                label = best ? titleCase(best.v) : g.value;
            }
            return { value: g.value, label: label, count: g.count };
        }).sort(function (a, b) { return (b.count - a.count) || a.label.localeCompare(b.label, 'es'); });
    }

    // ¿Algún estilo de la lista pertenece al grupo elegido en el filtro?
    function hasStyle(styles, optionKey) {
        if (!optionKey) return true;
        return parseList(styles).some(function (s) { return styleGroupKey(s) === optionKey; });
    }

    // ----------------------------------------------------------------- precio

    var PRICE_BUCKETS = [
        { value: 'low', label: 'Económico · menos de 200 USD', short: 'Económico', min: 0, max: 200 },
        { value: 'medium', label: 'Medio · 200 a 799 USD', short: 'Medio', min: 200, max: 800 },
        { value: 'high', label: 'Premium · 800 USD o más', short: 'Premium', min: 800, max: Infinity }
    ];

    // Tramo del precio de sesión en USD. Sin precio (o no numérico) -> null:
    // nunca cae en "Económico". Bordes sin solape: [0,200) [200,800) [800,∞).
    function priceBucket(usd) {
        if (usd === null || usd === undefined || usd === '') return null;
        var n = Number(usd);
        if (!Number.isFinite(n) || n <= 0) return null;
        for (var i = 0; i < PRICE_BUCKETS.length; i++) {
            if (n >= PRICE_BUCKETS[i].min && n < PRICE_BUCKETS[i].max) return PRICE_BUCKETS[i].value;
        }
        return null;
    }

    // ----------------------------------------------------------------- agenda

    function isoDay(value) {
        if (!value) return '';
        return String(value).slice(0, 10);
    }

    function inRange(today, start, end) {
        var s = isoDay(start), e = isoDay(end);
        if (!s && !e) return false;
        return (!s || s <= today) && (!e || e >= today);
    }

    function emptyFlags() {
        return { available: false, booked: false, guestNow: false, travelling: false, onVacation: false, nextTrip: null };
    }

    // Banderas por artista. locations: filas de artist_tattoo_locations;
    // trips: filas de public_artist_trips; artists: para las vacaciones.
    function buildAgenda(opts) {
        var today = isoDay((opts && opts.today) || new Date().toISOString());
        var agenda = {};
        function entry(id) { return agenda[id] || (agenda[id] = emptyFlags()); }
        function noteTrip(e, row) {
            var start = isoDay(row.start_date);
            if (!start || start <= today) return;
            if (!e.nextTrip || start < e.nextTrip.start) e.nextTrip = { start: start, city: row.city || '', country: row.country || '' };
        }
        ((opts && opts.locations) || []).forEach(function (row) {
            if (!row || !row.artist_user_id) return;
            var e = entry(row.artist_user_id);
            if (row.period_type === 'current') {
                if (row.agenda_status === 'closed') e.booked = true;
                else e.available = true;
                return;
            }
            if (row.period_type === 'upcoming') {
                var start = isoDay(row.start_date);
                if (start && start > today) { e.travelling = true; noteTrip(e, row); }
                else if (start && inRange(today, row.start_date, row.end_date)) e.guestNow = true;
            }
        });
        ((opts && opts.trips) || []).forEach(function (row) {
            if (!row || !row.artist_user_id) return;
            var e = entry(row.artist_user_id);
            var start = isoDay(row.start_date);
            if (start && start > today) { e.travelling = true; noteTrip(e, row); }
            else if (inRange(today, row.start_date, row.end_date)) e.guestNow = true;
        });
        ((opts && opts.artists) || []).forEach(function (artist) {
            if (!artist || !artist.user_id) return;
            if (artist.vacation_start && artist.vacation_end && inRange(today, artist.vacation_start, artist.vacation_end)) {
                var e = entry(artist.user_id);
                e.onVacation = true;
            }
        });
        return agenda;
    }

    // Disponibilidad real para el filtro: tiene agenda abierta y no está de
    // vacaciones. Agenda cerrada: la cerró o está de vacaciones.
    function isAvailable(flags) { return !!(flags && flags.available && !flags.onVacation); }
    function isBooked(flags) { return !!(flags && ((flags.booked && !flags.available) || flags.onVacation)); }

    function matchesAvailability(flags, value) {
        if (!value) return true;
        if (value === 'available') return isAvailable(flags);
        if (value === 'booked') return isBooked(flags);
        return false;
    }

    function matchesTravel(flags, value) {
        if (!value) return true;
        if (value === 'guest') return !!(flags && flags.guestNow);
        if (value === 'travelling') return !!(flags && flags.travelling);
        return false;
    }

    // Chip único de la card (solo presentación; los filtros usan las banderas).
    function artistStatus(flags) {
        if (!flags) return null;
        if (flags.onVacation) return { key: 'booked', label: 'De vacaciones' };
        if (flags.guestNow) return { key: 'guest', label: 'Artista invitado' };
        if (isBooked(flags)) return { key: 'booked', label: 'Agenda cerrada' };
        if (isAvailable(flags)) return { key: 'available', label: 'Disponible' };
        if (flags.travelling) return { key: 'travelling', label: 'De viaje pronto' };
        return null;
    }

    // --------------------------------------------------------------- ciudades

    function cityOf(artist) {
        var raw = (artist && (artist.city || artist.ubicacion)) || '';
        return String(raw).split(',')[0].trim();
    }

    function buildCityOptions(items, getCities) {
        var groups = new Map();
        (items || []).forEach(function (item) {
            var seen = new Set();
            parseList(getCities(item)).forEach(function (raw) {
                var key = normalizeKey(raw);
                if (!key || seen.has(key)) return;
                seen.add(key);
                var g = groups.get(key);
                if (!g) { g = { value: key, variants: new Map(), count: 0 }; groups.set(key, g); }
                g.count += 1;
                var label = titleCase(raw);
                g.variants.set(label, (g.variants.get(label) || 0) + 1);
            });
        });
        return Array.from(groups.values()).map(function (g) {
            var best = null;
            g.variants.forEach(function (n, label) { if (!best || n > best.n) best = { label: label, n: n }; });
            return { value: g.value, label: best ? best.label : g.value, count: g.count };
        }).sort(function (a, b) { return (b.count - a.count) || a.label.localeCompare(b.label, 'es'); });
    }

    // --------------------------------------------------------------- estudios

    function studioFlags(studio, opts) {
        var today = isoDay((opts && opts.today) || new Date().toISOString());
        var roster = (opts && opts.roster) || [];
        var agenda = (opts && opts.agenda) || {};
        var guestWindowOpen = !studio.guest_window_end || isoDay(studio.guest_window_end) >= today;
        return {
            guests: !!(studio.accepts_guest_spots && guestWindowOpen),
            seeking: !!studio.is_seeking_artists,
            openSlots: roster.some(function (a) { return isAvailable(agenda[a.user_id]); }),
            verified: studio.is_verified === true
        };
    }

    var STUDIO_AVAILABILITY_OPTIONS = [
        { value: 'openSlots', label: 'Turnos disponibles' },
        { value: 'guests', label: 'Con artistas invitados' },
        { value: 'seeking', label: 'Busca artistas' }
    ];

    function studioStatus(flags) {
        if (!flags) return null;
        if (flags.openSlots) return { key: 'available', label: 'Turnos disponibles' };
        if (flags.guests) return { key: 'guest', label: 'Con artistas invitados' };
        if (flags.seeking) return { key: 'travelling', label: 'Busca artistas' };
        return null;
    }

    // ---------------------------------------------------------------- búsqueda

    // ¿El texto libre aparece en alguno de los campos? Sin tildes ni mayúsculas;
    // los estilos también matchean por alias ("japones" encuentra "Irezumi").
    function matchesSearch(query, fields, styles) {
        var q = normalizeKey(query);
        if (!q) return true;
        var hit = (fields || []).some(function (f) { return normalizeKey(f).indexOf(q) !== -1; });
        if (hit) return true;
        return parseList(styles).some(function (s) {
            return normalizeKey(s).indexOf(q) !== -1 || stylesMatch(s, query);
        });
    }

    // --------------------------------------------------------------- paginado

    function pageInfo(total, visible) {
        var shown = Math.max(0, Math.min(total, visible));
        return { shown: shown, remaining: Math.max(0, total - shown), hasMore: total > shown };
    }

    useFallbackCatalog();

    return {
        normalizeKey: normalizeKey,
        escapeHtml: escapeHtml,
        titleCase: titleCase,
        plural: plural,
        safeMediaUrl: safeMediaUrl,
        parseList: parseList,
        FALLBACK_ALIASES: FALLBACK_ALIASES,
        FALLBACK_QUICK: FALLBACK_QUICK,
        setStyleCatalog: setStyleCatalog,
        useFallbackCatalog: useFallbackCatalog,
        canonicalStyleLabel: canonicalStyleLabel,
        styleMatchKeys: styleMatchKeys,
        stylesMatch: stylesMatch,
        styleGroupKey: styleGroupKey,
        buildStyleOptions: buildStyleOptions,
        hasStyle: hasStyle,
        PRICE_BUCKETS: PRICE_BUCKETS,
        priceBucket: priceBucket,
        buildAgenda: buildAgenda,
        isAvailable: isAvailable,
        isBooked: isBooked,
        matchesAvailability: matchesAvailability,
        matchesTravel: matchesTravel,
        artistStatus: artistStatus,
        cityOf: cityOf,
        buildCityOptions: buildCityOptions,
        studioFlags: studioFlags,
        studioStatus: studioStatus,
        STUDIO_AVAILABILITY_OPTIONS: STUDIO_AVAILABILITY_OPTIONS,
        matchesSearch: matchesSearch,
        pageInfo: pageInfo
    };
}));
