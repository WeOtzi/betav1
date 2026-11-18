'use strict';

// ===========================================================================
// Sugerencia de artistas para cotizaciones SIN artista (beta cerrada).
// ---------------------------------------------------------------------------
// Lógica pura (sin red ni base): recibe la lista de artistas públicos y los
// criterios de la solicitud del cliente, y devuelve un ranking explicable.
//
// Puntaje (máx. ~100):
//   estilo       hasta 40  coincidencia exacta del estilo (40) o parcial (20)
//   ubicación    hasta 30  misma ciudad (30), cercanía por lat/lng (≤30),
//                          mismo país (14); si el cliente viaja, piso de 8
//   presupuesto  hasta 15  tarifa por sesión dentro del presupuesto (15),
//                          hasta 25 % arriba (7), sin datos (5)
//   desempate    hasta 15  verificado (+6), recomendado (+3), perfil completo
//                          (+3), foto (+2), fuera de vacaciones (+1);
//                          de vacaciones hoy resta 8
//
// Un artista solo se sugiere si coincide en estilo o en ubicación (o queda a
// menos de MAX_NEAR_KM): sugerir perfiles al azar no ayuda al cliente. La
// salida pública nunca incluye email, WhatsApp ni coordenadas.
// ===========================================================================

// Regla única de visibilidad de la galería (la misma del perfil público).
const galleryVisibility = require('../public/shared/js/gallery-visibility.js');
const verifiedBadge = require('../public/shared/js/verified-badge.js');

// Visibilidad pública del artista (registro terminado y sin sanción):
// lib/artist-visibility.js (frente de sanciones). Si todavía no está, se cae a
// la misma regla escrita acá.
let artistVisibility = null;
try { artistVisibility = require('./artist-visibility'); } catch (_) { artistVisibility = null; }

function isPublicArtistRow(artist) {
    if (artistVisibility && typeof artistVisibility.isPublicArtist === 'function') {
        try { return Boolean(artistVisibility.isPublicArtist(artist)); } catch (_) { /* regla local */ }
    }
    if (String(artist.registration_status || '').toLowerCase() === 'incompleto') return false;
    return String(artist.sanction_state || 'none') === 'none';
}

const MAX_NEAR_KM = 300;
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;

// Minúsculas, sin acentos, espacios simples.
function normalizeText(value) {
    return String(value == null ? '' : value)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Forma compacta para comparar estilos: "Neo-Tradicional" → "neotradicional".
function compact(value) {
    return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function words(value) {
    return normalizeText(value).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
}

function toArray(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed : [trimmed];
            } catch (_) {
                return [trimmed];
            }
        }
        return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [value];
}

// Estilos elegidos por el cliente, sea cual sea el formato guardado:
// { style_name, styles:[...] } del wizard, array de objetos, slug suelto.
function extractRequestedStyles(tattooStyle) {
    const out = [];
    const push = (name, slug) => {
        const label = String(name || slug || '').trim();
        if (!label) return;
        const key = compact(slug || name);
        if (!key || out.some((s) => s.key === key)) return;
        out.push({ label, key, words: words(`${name || ''} ${slug || ''}`) });
    };
    const visit = (value) => {
        if (value == null || value === '') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                try { visit(JSON.parse(trimmed)); return; } catch (_) { /* texto plano */ }
            }
            push(trimmed, trimmed);
            return;
        }
        if (typeof value === 'object') {
            if (Array.isArray(value.styles) && value.styles.length) { value.styles.forEach(visit); return; }
            push(value.style_name || value.name || value.label, value.style_slug || value.slug || value.value);
            if (value.substyle_name || value.substyle_slug) push(value.substyle_name, value.substyle_slug);
        }
    };
    visit(tattooStyle);
    return out;
}

function artistStyles(artist) {
    const list = toArray(artist && artist.styles_array);
    const fallback = list.length ? [] : toArray(artist && artist.estilo);
    return list.concat(fallback).map((s) => String(s || '').trim()).filter(Boolean);
}

// 1 = coincidencia exacta, 0.5 = comparten una palabra significativa, 0 = nada.
function styleMatchLevel(requested, styles) {
    if (!requested.length || !styles.length) return 0;
    const keys = styles.map((s) => ({ key: compact(s), words: words(s) }));
    let best = 0;
    for (const want of requested) {
        for (const have of keys) {
            if (!have.key) continue;
            if (have.key === want.key) return 1;
            if (want.words.some((w) => have.words.includes(w))) best = Math.max(best, 0.5);
        }
    }
    return best;
}

// "Buenos Aires, CABA, Argentina" → { city: 'buenos aires', country: 'argentina' }
function splitLocation(text) {
    const parts = String(text || '').split(',').map((p) => normalizeText(p)).filter(Boolean);
    if (!parts.length) return { city: '', country: '' };
    return { city: parts[0], country: parts.length > 1 ? parts[parts.length - 1] : '' };
}

function artistLocation(artist) {
    const fromUbicacion = splitLocation(artist.ubicacion);
    return {
        city: normalizeText(artist.city) || fromUbicacion.city,
        locality: normalizeText(artist.locality),
        country: normalizeText(artist.country) || fromUbicacion.country
    };
}

function toNumber(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
}

function haversineKm(a, b) {
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validCoords(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    if (Math.abs(la) > 90 || Math.abs(ln) > 180 || (la === 0 && ln === 0)) return null;
    return { lat: la, lng: ln };
}

// Tarifa del artista expresada en la moneda del presupuesto del cliente.
function artistRateIn(artist, currency) {
    const cur = String(currency || '').toUpperCase();
    if (!cur) return null;
    if (cur === 'USD' && toNumber(artist.session_price_amount_usd)) return toNumber(artist.session_price_amount_usd);
    if (cur === 'EUR' && toNumber(artist.session_price_amount_eur)) return toNumber(artist.session_price_amount_eur);
    const ownCur = String(artist.session_price_currency || '').toUpperCase();
    if (ownCur && ownCur === cur) return toNumber(artist.session_price_amount);
    // session_price legacy: "300 USD".
    const legacy = String(artist.session_price || '').toUpperCase();
    if (legacy.includes(cur)) return toNumber(legacy);
    return null;
}

function isOnVacation(artist, now) {
    if (!artist.vacation_start || !artist.vacation_end) return false;
    const start = Date.parse(artist.vacation_start);
    const end = Date.parse(artist.vacation_end) + 24 * 60 * 60 * 1000;
    return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end;
}

function isEligibleArtist(artist) {
    if (!artist || !artist.user_id || !artist.username) return false;
    if (String(artist.registration_status || '').toLowerCase() === 'incompleto') return false;
    // Suspendidos o baneados no se sugieren (sanction_state ausente = 'none').
    return isPublicArtistRow(artist);
}

/**
 * Normaliza los criterios que llegan del navegador (o de la cotización).
 * Nunca confía en tipos: todo se convierte y se acota.
 */
function normalizeCriteria(input = {}) {
    const loc = splitLocation(input.city_residence || input.client_city_residence || '');
    const city = normalizeText(input.city || input.client_city_name || '') || loc.city;
    const country = normalizeText(input.country || input.client_country || '') || loc.country;
    const amount = toNumber(input.budget_amount ?? input.client_budget_amount);
    return {
        styles: extractRequestedStyles(input.styles ?? input.tattoo_style).slice(0, 8),
        city: city.slice(0, 120),
        country: country.slice(0, 120),
        coords: validCoords(input.lat ?? input.client_lat, input.lng ?? input.client_lng),
        budgetAmount: amount && amount < 1e7 ? amount : null,
        budgetCurrency: /^[A-Za-z]{3}$/.test(String(input.budget_currency || input.client_budget_currency || ''))
            ? String(input.budget_currency || input.client_budget_currency).toUpperCase() : null,
        travelWilling: input.travel_willing === true || input.travel_willing === 'true'
            || input.client_travel_willing === true || input.client_travel_willing === 'true',
        excludeUserIds: Array.isArray(input.exclude) ? input.exclude.map(String).slice(0, 50) : [],
        normalized: true
    };
}

/**
 * Puntúa un artista. Devuelve { score, eligible, match } donde match explica
 * el puntaje (lo usa la tarjeta para mostrar por qué se sugiere).
 */
function scoreArtist(artist, criteria, { now = Date.now() } = {}) {
    const match = { style: 0, location: null, distanceKm: null, budget: null, verified: false };
    let score = 0;

    // Estilo
    const styleLevel = styleMatchLevel(criteria.styles || [], artistStyles(artist));
    match.style = styleLevel;
    score += styleLevel * 40;

    // Ubicación
    const where = artistLocation(artist);
    let locationPoints = 0;
    if (criteria.city && (where.city === criteria.city || where.locality === criteria.city)) {
        locationPoints = 30;
        match.location = 'city';
    }
    const artistCoords = validCoords(artist.latitude, artist.longitude);
    if (criteria.coords && artistCoords) {
        const km = haversineKm(criteria.coords, artistCoords);
        match.distanceKm = Math.round(km);
        let nearPoints = 0;
        if (km <= 25) nearPoints = 30;
        else if (km <= 100) nearPoints = 22;
        else if (km <= MAX_NEAR_KM) nearPoints = 12;
        if (nearPoints > locationPoints) {
            locationPoints = nearPoints;
            match.location = km <= 25 ? 'city' : 'near';
        }
    }
    if (!locationPoints && criteria.country && where.country && where.country === criteria.country) {
        locationPoints = 14;
        match.location = 'country';
    }
    if (criteria.travelWilling && locationPoints < 8) locationPoints = 8;
    score += locationPoints;

    // Presupuesto
    if (criteria.budgetAmount && criteria.budgetCurrency) {
        const rate = artistRateIn(artist, criteria.budgetCurrency);
        if (rate == null) { score += 5; match.budget = 'unknown'; }
        else if (rate <= criteria.budgetAmount) { score += 15; match.budget = 'within'; }
        else if (rate <= criteria.budgetAmount * 1.25) { score += 7; match.budget = 'near'; }
        else match.budget = 'above';
    } else {
        score += 5;
    }

    // Desempate
    // Insignia: verificado y con el Instagram validado (verified-badge.js).
    if (verifiedBadge.isBadgeVisible(artist)) { score += 6; match.verified = true; }
    if (artist.is_recommended === true) score += 3;
    const completeness = Number(artist.profile_completeness);
    if (Number.isFinite(completeness)) score += Math.max(0, Math.min(100, completeness)) / 100 * 3;
    if (artist.profile_picture) score += 2;
    // De vacaciones hoy: se sugiere igual (la fecha puede ser posterior), atrás.
    if (isOnVacation(artist, now)) score -= 8;
    else score += 1;

    const relevant = styleLevel > 0 || match.location === 'city' || match.location === 'near'
        || match.location === 'country';
    return {
        score: Math.round(score * 10) / 10,
        eligible: isEligibleArtist(artist) && relevant,
        match
    };
}

function publicCity(artist) {
    const fromUbicacion = String(artist.ubicacion || '').split(',').map((p) => p.trim()).filter(Boolean);
    return String(artist.city || fromUbicacion[0] || '').trim() || null;
}

function publicCountry(artist) {
    const fromUbicacion = String(artist.ubicacion || '').split(',').map((p) => p.trim()).filter(Boolean);
    return String(artist.country || (fromUbicacion.length > 1 ? fromUbicacion[fromUbicacion.length - 1] : '')).trim() || null;
}

// Portfolio público del artista para el perfil reducido del cotizador (P19):
// primero gallery_feed_items ({ url, kind, category, caption }), después
// gallery_images (URLs sueltas). Solo imágenes https, sin repetir.
// Misma regla que el perfil público: las fotos importadas de Instagram no se
// muestran hasta que el artista valida su cuenta (gallery-visibility.js).
// gallery_images ya llega filtrada por la base (migración 20261030120000).
const PORTFOLIO_LIMIT = 12;

// Estado de validación de Instagram del artista, como lo arma
// services/instagram-verification.js. Siempre se exige: sin las columnas
// instagram_verified_* (fila incompleta) la cuenta cuenta como no validada.
function galleryState(artist) {
    const handle = galleryVisibility.normalizeHandle(artist && artist.instagram_verified_handle);
    return { enforced: true, verified: Boolean(handle && artist && artist.instagram_verified_at), handle: handle || null };
}

function portfolioPreview(artist, limit = PORTFOLIO_LIMIT) {
    const out = [];
    const seen = new Set();
    const push = (url, caption) => {
        if (out.length >= limit || typeof url !== 'string' || !/^https:\/\//i.test(url) || seen.has(url)) return;
        if (/\.(mp4|mov|webm)(\?|#|$)/i.test(url)) return;
        seen.add(url);
        const text = typeof caption === 'string' ? caption.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
        out.push({ url, caption: text || null });
    };
    const feed = toArray(artist && artist.gallery_feed_items).filter((item) => item && typeof item === 'object');
    for (const item of galleryVisibility.filterPublic(feed, galleryState(artist))) {
        if (item.kind && item.kind !== 'image') continue;
        push(item.url, item.caption);
    }
    for (const item of toArray(artist && artist.gallery_images)) {
        if (typeof item === 'string') push(item, null);
        else if (item && typeof item === 'object') push(item.url, item.caption);
    }
    return out;
}

function isAmbassador(artist) {
    return artist.embajador === true || String(artist.embajador || '').trim().toLowerCase() === 'si';
}

// Solo datos de perfil público: nada de email, WhatsApp ni coordenadas.
function toPublicSuggestion(artist, scored) {
    const picture = typeof artist.profile_picture === 'string' && /^https:\/\//i.test(artist.profile_picture)
        ? artist.profile_picture : null;
    const bio = typeof artist.bio_description === 'string' ? artist.bio_description.replace(/\s+/g, ' ').trim() : '';
    return {
        user_id: artist.user_id,
        username: artist.username,
        name: artist.name || artist.username,
        profile_picture: picture,
        styles: artistStyles(artist).slice(0, 4),
        city: publicCity(artist),
        country: publicCountry(artist),
        studio: artist.estudios || null,
        verified: verifiedBadge.isBadgeVisible(artist),
        // P19: etiqueta "Recomendado", insignia de embajador y perfil reducido.
        recommended: artist.is_recommended === true,
        ambassador: isAmbassador(artist),
        years_experience: artist.years_experience ? String(artist.years_experience).slice(0, 20) : null,
        bio: bio ? bio.slice(0, 280) : null,
        portfolio: portfolioPreview(artist),
        session_price_amount: toNumber(artist.session_price_amount),
        session_price_currency: artist.session_price_currency || null,
        match: {
            style: scored.match.style >= 1 ? 'exact' : scored.match.style > 0 ? 'partial' : null,
            location: scored.match.location,
            distance_km: scored.match.distanceKm,
            budget: scored.match.budget
        },
        score: scored.score
    };
}

/**
 * Ranking final: top N artistas relevantes, ordenados por puntaje y, a igual
 * puntaje, por nombre (orden estable para tests y para el cliente).
 */
function rankArtists(artists, rawCriteria, { limit = DEFAULT_LIMIT, now = Date.now() } = {}) {
    const criteria = rawCriteria && rawCriteria.normalized ? rawCriteria : normalizeCriteria(rawCriteria || {});
    const max = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
    const excluded = new Set(criteria.excludeUserIds || []);
    const seen = new Set();
    return (Array.isArray(artists) ? artists : [])
        .filter((a) => a && !excluded.has(String(a.user_id)))
        .filter((a) => { if (seen.has(a.user_id)) return false; seen.add(a.user_id); return true; })
        .map((artist) => ({ artist, scored: scoreArtist(artist, criteria, { now }) }))
        .filter((row) => row.scored.eligible)
        .sort((a, b) => (b.scored.score - a.scored.score)
            || String(a.artist.name || a.artist.username).localeCompare(String(b.artist.name || b.artist.username), 'es'))
        .slice(0, max)
        .map((row) => toPublicSuggestion(row.artist, row.scored));
}

// Columnas que el servidor lee de artists_db para puntuar (lat/lng solo se
// usan en el cálculo y nunca salen en la respuesta).
const MATCHING_COLUMNS = [
    'user_id', 'username', 'name', 'profile_picture', 'styles_array', 'estilo',
    'city', 'ubicacion', 'country', 'locality', 'latitude', 'longitude', 'estudios',
    'session_price', 'session_price_amount', 'session_price_currency',
    'session_price_amount_usd', 'session_price_amount_eur',
    'verification_state', 'is_recommended', 'profile_completeness',
    'vacation_start', 'vacation_end', 'registration_status',
    // Tarjeta y perfil reducido del cotizador (públicos en artists_db).
    'embajador', 'years_experience', 'bio_description', 'gallery_images', 'gallery_feed_items',
    // Fotos de Instagram visibles e insignia (verified-badge.js compara el
    // Instagram del perfil con el validado); no salen en la respuesta.
    'instagram', 'instagram_verified_at', 'instagram_verified_handle'
].join(',');

module.exports = {
    MATCHING_COLUMNS,
    MAX_NEAR_KM,
    normalizeText,
    extractRequestedStyles,
    styleMatchLevel,
    normalizeCriteria,
    scoreArtist,
    rankArtists,
    toPublicSuggestion,
    portfolioPreview,
    haversineKm,
    artistRateIn
};
