'use strict';

// ===========================================================================
// Most Wanted: puntaje de tendencia por zona (frente "perfil", ronda 2).
// ---------------------------------------------------------------------------
// Lógica PURA, espejo de public.recalculate_most_wanted() (migración
// 20261116180000_perfil_insignias_most_wanted.sql). La base es la que
// materializa; este módulo documenta y testea la regla, y la usa el servidor
// para armar el aviso al artista.
//
// Ventana: 30 días. Señales y pesos:
//   visitas al perfil        × 1  (visitantes únicos por día, tope 300)
//   cotizaciones recibidas   × 6  (clientes con cuenta + hasta 3 de invitado;
//                                  las manuales sin cliente vinculado no cuentan)
//   veces en favoritos       × 4
//   veces compartido         × 3  (personas distintas por día, tope 40; los
//                                  del propio artista no cuentan)
//   trabajos completados     × 8  (solo los que cerró el cliente con su cuenta)
//
// Zona: la ciudad si tiene 3 o más perfiles públicos; si no, el país ("resto
// del país"). Sin ciudad ni país el perfil no participa.
// Ganadores: los primeros N de cada zona (N = 1 hasta 4 perfiles, 2 hasta 8,
// 3 desde 9) que cumplan el mínimo de actividad: puntaje >= 12, al menos dos
// señales distintas y al menos una que el artista no puede generar solo
// (INDEPENDENT_SIGNALS: una cotización de un cliente con cuenta, un favorito
// o un trabajo cerrado por el cliente). Un perfil vacío, con una sola señal o
// que solo tiene visitas, compartidos y solicitudes de invitado nunca gana.
//
// Lo que se publica es solo el booleano y el puesto (get_artist_public_badges):
// los conteos y el puntaje quedan privados.
// ===========================================================================

const WINDOW_DAYS = 30;
const WEIGHTS = Object.freeze({ visits: 1, quotes: 6, favorites: 4, shares: 3, completed: 8 });
const CAPS = Object.freeze({ visits: 300, shares: 40, guestQuotes: 3 });
const MIN_SCORE = 12;
const MIN_SIGNALS = 2;
const MIN_CITY_ZONE_SIZE = 3;
const MAX_TOP_N = 3;
const SIGNALS = Object.freeze(['visits', 'quotes', 'favorites', 'shares', 'completed']);
// Conteos que dependen de otra cuenta: al menos uno tiene que ser mayor que 0.
// quotesAccount es la parte de `quotes` que viene de clientes con cuenta.
const INDEPENDENT_SIGNALS = Object.freeze(['quotesAccount', 'favorites', 'completed']);

/** Clave de zona: minúsculas, sin acentos, espacios colapsados. '' -> null. */
function zoneNorm(value) {
    const text = String(value == null ? '' : value)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ');
    return text || null;
}

function toCount(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function countsOf(input) {
    const source = input && typeof input === 'object' ? input : {};
    const counts = {};
    for (const key of SIGNALS) counts[key] = toCount(source[key]);
    counts.quotesAccount = Math.min(toCount(source.quotesAccount), counts.quotes);
    return counts;
}

/**
 * Cotizaciones que cuentan: clientes con cuenta + invitados (tope 3).
 * `account` y `guest` son personas distintas; las manuales sin cliente
 * vinculado no entran en ninguno de los dos.
 */
function quoteCount({ account, guest } = {}) {
    const quotesAccount = toCount(account);
    return { quotes: quotesAccount + Math.min(toCount(guest), CAPS.guestQuotes), quotesAccount };
}

/** Puntaje de tendencia con los topes de visitas y compartidos. */
function trendScore(input) {
    const c = countsOf(input);
    return Math.min(c.visits, CAPS.visits) * WEIGHTS.visits
        + c.quotes * WEIGHTS.quotes
        + c.favorites * WEIGHTS.favorites
        + Math.min(c.shares, CAPS.shares) * WEIGHTS.shares
        + c.completed * WEIGHTS.completed;
}

/** Cantidad de señales distintas con actividad. */
function signalCount(input) {
    const c = countsOf(input);
    return SIGNALS.filter((key) => c[key] > 0).length;
}

/** ¿Hay al menos una señal que el artista no puede generar solo? */
function hasIndependentSignal(input) {
    const c = countsOf(input);
    return INDEPENDENT_SIGNALS.some((key) => c[key] > 0);
}

/** Mínimo de actividad para poder ganar la insignia. */
function isEligible(input) {
    return trendScore(input) >= MIN_SCORE && signalCount(input) >= MIN_SIGNALS && hasIndependentSignal(input);
}

/** Cuántos ganan en una zona de `size` perfiles públicos. */
function topNForZone(size, maxTopN = MAX_TOP_N) {
    const max = Math.min(Math.max(toCount(maxTopN) || MAX_TOP_N, 1), 10);
    return Math.min(max, Math.max(1, Math.ceil(toCount(size) * 0.25)));
}

/**
 * Asigna la zona de cada artista. `artists`: [{ userId, city, country }].
 * @returns {Array<{userId, zoneKey, zoneLabel, zoneLevel, zoneCountry}>}
 */
function assignZones(artists) {
    const rows = (Array.isArray(artists) ? artists : []).filter((a) => a && a.userId).map((a) => {
        const city = String(a.city == null ? '' : a.city).trim();
        const country = String(a.country == null ? '' : a.country).trim();
        let cityKey = zoneNorm(city);
        if (cityKey === 'sin ciudad') cityKey = null;
        return { userId: String(a.userId), city, country, cityKey, countryKey: zoneNorm(country) };
    });

    const citySizes = new Map();
    for (const row of rows) {
        if (!row.cityKey) continue;
        const key = `${row.cityKey}|${row.countryKey || ''}`;
        citySizes.set(key, (citySizes.get(key) || 0) + 1);
    }

    return rows.map((row) => {
        const cityZone = row.cityKey ? `${row.cityKey}|${row.countryKey || ''}` : null;
        const useCity = Boolean(cityZone) && (citySizes.get(cityZone) >= MIN_CITY_ZONE_SIZE || !row.countryKey);
        if (useCity) {
            return { userId: row.userId, zoneKey: `city:${cityZone}`, zoneLabel: row.city, zoneLevel: 'city', zoneCountry: row.country || null };
        }
        if (row.countryKey) {
            return { userId: row.userId, zoneKey: `country:${row.countryKey}`, zoneLabel: row.country, zoneLevel: 'country', zoneCountry: row.country };
        }
        return { userId: row.userId, zoneKey: null, zoneLabel: null, zoneLevel: null, zoneCountry: null };
    });
}

/**
 * Ranking completo. `artists`: [{ userId, city, country, visits, quotes,
 * quotesAccount, favorites, shares, completed }] con TODOS los perfiles
 * públicos (los que no tienen actividad cuentan para el tamaño de la zona).
 * @returns {{ scores: object[], winners: object[] }}
 */
function rankMostWanted(artists, options = {}) {
    const list = (Array.isArray(artists) ? artists : []).filter((a) => a && a.userId);
    const zones = new Map(assignZones(list).map((z) => [z.userId, z]));
    const zoneSizes = new Map();
    for (const zone of zones.values()) {
        if (zone.zoneKey) zoneSizes.set(zone.zoneKey, (zoneSizes.get(zone.zoneKey) || 0) + 1);
    }

    const scored = list.map((artist) => {
        const zone = zones.get(String(artist.userId));
        const counts = countsOf(artist);
        return {
            userId: String(artist.userId),
            ...zone,
            zoneSize: zone.zoneKey ? zoneSizes.get(zone.zoneKey) : 0,
            ...counts,
            score: trendScore(counts),
            signals: signalCount(counts),
            eligible: Boolean(zone.zoneKey) && isEligible(counts),
            zoneRank: null,
            mostWanted: false
        };
    });

    const byZone = new Map();
    for (const row of scored) {
        if (!row.eligible) continue;
        if (!byZone.has(row.zoneKey)) byZone.set(row.zoneKey, []);
        byZone.get(row.zoneKey).push(row);
    }
    for (const rows of byZone.values()) {
        rows.sort((a, b) => b.score - a.score
            || b.completed - a.completed
            || b.quotes - a.quotes
            || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
        const limit = topNForZone(rows[0].zoneSize, options.topN);
        rows.forEach((row, index) => {
            row.zoneRank = index + 1;
            row.mostWanted = index < limit;
        });
    }

    const scores = scored.filter((row) => row.score > 0);
    const winners = scores.filter((row) => row.mostWanted)
        .sort((a, b) => (a.zoneKey < b.zoneKey ? -1 : a.zoneKey > b.zoneKey ? 1 : a.zoneRank - b.zoneRank));
    return { scores, winners };
}

/** artists_db.embajador: 'si' (y variantes) = embajador activo. */
function isAmbassador(value) {
    if (value === true) return true;
    return ['si', 'sí', 'yes', 'true'].includes(String(value == null ? '' : value).trim().toLowerCase());
}

/**
 * Insignias públicas (misma forma que la RPC get_artist_public_badges).
 * Nunca incluye conteos; la zona respeta la privacidad de la ciudad.
 */
function publicBadges({ embajador, award, showCity = true } = {}) {
    const has = Boolean(award && award.rank);
    const hideCity = has && award.zoneLevel === 'city' && showCity === false;
    return {
        ambassador: isAmbassador(embajador),
        most_wanted: has,
        most_wanted_rank: has ? Number(award.rank) : null,
        most_wanted_zone: !has ? null : (hideCity ? (String(award.zoneCountry || '').trim() || null) : (award.zoneLabel || null)),
        most_wanted_zone_level: !has ? null : (hideCity ? 'country' : award.zoneLevel || null),
        most_wanted_since: has ? (award.awardedAt || null) : null
    };
}

module.exports = {
    WINDOW_DAYS,
    WEIGHTS,
    CAPS,
    MIN_SCORE,
    MIN_SIGNALS,
    MIN_CITY_ZONE_SIZE,
    MAX_TOP_N,
    SIGNALS,
    INDEPENDENT_SIGNALS,
    zoneNorm,
    countsOf,
    quoteCount,
    trendScore,
    signalCount,
    hasIndependentSignal,
    isEligible,
    topNForZone,
    assignZones,
    rankMostWanted,
    isAmbassador,
    publicBadges
};
