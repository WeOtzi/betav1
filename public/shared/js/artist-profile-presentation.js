(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ArtistProfilePresentation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function filterKey(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function buildPortfolioFilterOptions(items, categoryLabels) {
        const safeItems = Array.isArray(items) ? items : [];
        const options = [{ value: 'todos', label: 'Todos' }];
        const seen = new Set(['todos']);
        const styleOptions = [];

        for (const item of safeItems) {
            for (const style of Array.isArray(item?.styles) ? item.styles : []) {
                const key = filterKey(style);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                styleOptions.push({ value: key, label: String(style).trim() });
            }
        }
        if (styleOptions.length) return options.concat(styleOptions);

        for (const item of safeItems) {
            const category = String(item?.category || '').trim().toLowerCase();
            if (!category || seen.has(category)) continue;
            seen.add(category);
            options.push({ value: category, label: categoryLabels?.[category] || category });
        }
        return options;
    }

    function buildSpecialtyRows(styles, items, descriptions) {
        const safeItems = Array.isArray(items) ? items : [];
        return (Array.isArray(styles) ? styles : []).filter(Boolean).map((style) => {
            const key = filterKey(style);
            const media = safeItems.find((item) => (
                Array.isArray(item?.styles)
                && item.styles.some((itemStyle) => filterKey(itemStyle) === key)
            ));
            return {
                name: String(style),
                key,
                description: String(descriptions?.[key] || ''),
                mediaUrl: String(media?.url || ''),
                mediaKind: media?.kind === 'video' ? 'video' : 'image'
            };
        });
    }

    function setDisclosureState(toggle, menu, open) {
        if (!toggle || !menu) return;
        toggle.setAttribute('aria-expanded', String(Boolean(open)));
        menu.hidden = !open;
    }

    /* ---------- Figma final 801:1108 (oct 2026) ---------- */

    // Estilos de una obra del portafolio: `styles[]`, `style`/`style_name` y, si
    // la categoría no es una de las categorías de galería conocidas
    // (realizados/flash/proyectos), la categoría se lee como estilo (hay
    // artistas que agrupan su galería por estilo).
    function galleryItemStyles(raw, knownCategories) {
        const item = raw && typeof raw === 'object' ? raw : {};
        const out = [];
        const seen = new Set();
        const push = (value) => {
            const label = String(value || '').trim();
            const key = filterKey(label);
            if (!label || !key || seen.has(key)) return;
            seen.add(key);
            out.push(label);
        };
        (Array.isArray(item.styles) ? item.styles : []).forEach(push);
        push(item.style);
        push(item.style_name);
        const category = String(item.category || '').trim();
        const known = knownCategories && typeof knownCategories === 'object' ? knownCategories : {};
        if (category && !Object.prototype.hasOwnProperty.call(known, category.toLowerCase())) push(category);
        return out;
    }

    function toLocalDate(value) {
        if (!value) return null;
        const raw = String(value).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
        const parsed = new Date(`${raw}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function isoDay(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function shortMonth(date) {
        return date.toLocaleDateString('es-AR', { month: 'short' }).replace(/\./g, '').toLowerCase();
    }

    // Figma: "12 – 18 oct" (mismo mes) · "28 sep – 4 oct" (meses distintos).
    function formatResidencyRange(startDate, endDate) {
        const start = toLocalDate(startDate);
        const end = toLocalDate(endDate);
        if (!start || !end) return '';
        if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
            return `${start.getDate()} – ${end.getDate()} ${shortMonth(end)}`;
        }
        return `${start.getDate()} ${shortMonth(start)} – ${end.getDate()} ${shortMonth(end)}`;
    }

    const RESIDENCY_STATES = {
        open: 'Agenda abierta',
        waitlist: 'Lista de espera',
        upcoming: 'Próximamente',
        closed: 'Agenda cerrada'
    };

    function residencyState(agendaStatus, start, today) {
        const status = String(agendaStatus || '').toLowerCase();
        if (status === 'open') return 'open';
        if (status === 'waitlist') return 'waitlist';
        if (start && start.getTime() > today.getTime()) return 'upcoming';
        return 'closed';
    }

    /**
     * Filas de "Próximas residencias" (Figma 801:1108): ciudad · país · fechas ·
     * estado. Une las residencias con fechas cargadas por el artista
     * (`artist_tattoo_locations`) con los viajes confirmados de Travel
     * (`artist_public_travel_presences`). Las ubicaciones sin fechas (la base
     * actual) no son "próximas" y quedan fuera; también los tramos terminados.
     * Deduplica por ciudad + fecha de inicio y completa el país faltante con el
     * viaje o la ciudad base del artista.
     */
    function buildResidencyRows(locations, presences, options = {}) {
        const today = toLocalDate(options.today) || (() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
        })();
        const base = options.base || {};
        const baseCity = filterKey(base.city);
        const rows = [];
        const index = new Map();
        const keyOf = (city, start) => `${filterKey(city)}|${start ? isoDay(start) : 'current'}`;

        for (const loc of Array.isArray(locations) ? locations : []) {
            const city = String(loc?.city || '').trim();
            const venue = String(loc?.studio_name || '').trim();
            const label = city || venue;
            if (!label) continue;
            const start = toLocalDate(loc?.start_date);
            const end = toLocalDate(loc?.end_date);
            if (!start || (end && end.getTime() < today.getTime())) continue;
            if (index.has(keyOf(label, start))) continue;
            let country = String(loc?.country || '').trim();
            if (!country && city && filterKey(city) === baseCity) country = String(base.country || '').trim();
            const state = residencyState(loc?.agenda_status, start, today);
            const row = {
                city: label,
                country,
                venue: city && venue ? venue : '',
                dates: formatResidencyRange(loc?.start_date, loc?.end_date),
                startDate: start ? isoDay(start) : '',
                state,
                label: RESIDENCY_STATES[state],
                source: 'location',
                current: !start
            };
            index.set(keyOf(label, start), row);
            rows.push(row);
        }

        for (const trip of Array.isArray(presences) ? presences : []) {
            const city = String(trip?.city || trip?.studio_city || '').trim();
            if (!city) continue;
            const start = toLocalDate(trip?.start_date);
            const end = toLocalDate(trip?.end_date);
            if (!start || (end && end.getTime() < today.getTime())) continue;
            const country = String(trip?.country || trip?.studio_country || '').trim();
            const existing = index.get(keyOf(city, start));
            if (existing) {
                if (!existing.country && country) existing.country = country;
                if (!existing.venue && trip?.studio_name) existing.venue = String(trip.studio_name);
                continue;
            }
            // Viaje confirmado: en curso = agenda abierta; futuro = próximamente.
            const state = start.getTime() <= today.getTime() ? 'open' : 'upcoming';
            const row = {
                city,
                country,
                venue: String(trip?.studio_name || trip?.event_name || '').trim(),
                dates: formatResidencyRange(trip?.start_date, trip?.end_date),
                startDate: isoDay(start),
                state,
                label: RESIDENCY_STATES[state],
                source: 'travel',
                current: false
            };
            index.set(keyOf(city, start), row);
            rows.push(row);
        }

        // Para backfill de país: misma ciudad en otra fila con país conocido.
        const countryByCity = new Map(rows.filter((row) => row.country).map((row) => [filterKey(row.city), row.country]));
        rows.forEach((row) => {
            if (!row.country) row.country = countryByCity.get(filterKey(row.city)) || '';
        });

        return rows.sort((a, b) => {
            if (a.current !== b.current) return a.current ? -1 : 1;
            return String(a.startDate).localeCompare(String(b.startDate));
        });
    }

    /**
     * "Dónde tatué": ciudad base + ciudades donde el artista ya estuvo o está
     * (ubicaciones sin fecha o ya iniciadas y viajes de Travel ya iniciados).
     * Las residencias futuras no cuentan: el bloque está en pasado.
     */
    function buildVisitedCities(base, locations, presences, options = {}) {
        const today = toLocalDate(options.today) || (() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
        })();
        const out = [];
        const seen = new Set();
        const push = (value) => {
            const city = String(value || '').trim();
            const key = filterKey(city);
            if (!city || city === '-' || /^sin ciudad$/i.test(city) || seen.has(key)) return;
            seen.add(key);
            out.push(city);
        };
        push(base);
        for (const loc of Array.isArray(locations) ? locations : []) {
            const start = toLocalDate(loc?.start_date);
            if (start && start.getTime() > today.getTime()) continue;
            push(loc?.city);
        }
        for (const trip of Array.isArray(presences) ? presences : []) {
            const start = toLocalDate(trip?.start_date);
            if (!start || start.getTime() > today.getTime()) continue;
            push(trip?.city || trip?.studio_city);
        }
        return out;
    }

    /* ---------- Corrección ronda 1 (auditoría 801:1108) ---------- */

    // Ficha "Sobre el artista" · EXPERIENCIA (Figma 344:1391: "8 años tatuando").
    // `years_experience` llega como número, rango ("5-10", "10+") o texto con "años".
    function formatExperienceFact(value) {
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return '';
        if (/tatuando/i.test(raw)) return raw;
        const amount = raw.replace(/\s*a[ñn]os?\s*$/i, '').trim();
        if (!amount) return '';
        return `${amount} ${amount === '1' ? 'año' : 'años'} tatuando`;
    }

    const PRICE_SYMBOLS = { USD: '$', ARS: '$', MXN: '$', CLP: '$', COP: '$', UYU: '$', EUR: '€', GBP: '£', BRL: 'R$' };

    // Ficha "Sobre el artista" · SESIÓN MÍNIMA (Figma 344:1401: "$180 USD").
    // `session_price` es texto libre: "180 USD", "USD 180", "180". Con moneda
    // conocida antepone su símbolo; sin moneda o con formato libre lo deja igual.
    function formatSessionPriceFact(value) {
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return '';
        let amount = '';
        let code = '';
        const trailing = raw.match(/^([\d][\d.,]*)\s*([A-Za-z]{3})$/);
        const leading = raw.match(/^([A-Za-z]{3})\s*([\d][\d.,]*)$/);
        if (trailing) [, amount, code] = trailing;
        else if (leading) [, code, amount] = leading;
        if (!amount) return raw;
        code = code.toUpperCase();
        const symbol = PRICE_SYMBOLS[code];
        return symbol ? `${symbol}${amount} ${code}` : `${amount} ${code}`;
    }

    // Panel Estudio · ARTISTAS: miembros activos del roster sin repetir, y el
    // propio artista cuenta aunque su vínculo sea solo `artists_db.studio_id`.
    function studioRosterCount(roster, artistUserId) {
        const ids = new Set();
        let unidentified = 0;
        for (const row of Array.isArray(roster) ? roster : []) {
            const id = row?.artist_user_id || row?.artists_db?.user_id || row?.user_id;
            if (id) ids.add(String(id));
            else unidentified += 1;
        }
        if (artistUserId) ids.add(String(artistUserId));
        return ids.size + unidentified;
    }

    return {
        formatExperienceFact,
        formatSessionPriceFact,
        studioRosterCount,
        buildVisitedCities,
        filterKey,
        buildPortfolioFilterOptions,
        buildSpecialtyRows,
        setDisclosureState,
        galleryItemStyles,
        formatResidencyRange,
        buildResidencyRows,
        RESIDENCY_STATES
    };
});
