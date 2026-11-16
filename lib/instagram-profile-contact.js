'use strict';

// ===========================================================================
// Ronda 2 · frente "registro" (P3): datos de contacto del perfil de Instagram.
// ---------------------------------------------------------------------------
// "Con el registro usando Instagram traer correo, país y ciudad, nombre
// completo". Instagram solo expone email y dirección en las cuentas
// profesionales; cuando no vienen, se infieren con prudencia:
//   · email   → campo profesional del perfil o, si no, el primer email escrito
//               en la bio (dato que la persona ya publicó);
//   · ciudad  → dirección profesional o la ubicación de la bio / la etiqueta
//               de lugar más usada ("Buenos Aires, Argentina");
//   · país    → solo si el texto nombra un país del catálogo del registro.
// Nada de esto se guarda solo: el registro lo precarga en campos vacíos,
// marcado "traído de Instagram", y la persona lo confirma o lo cambia.
// Lógica pura (sin red) para poder testearla.
// ===========================================================================

const { REGISTRATION_COUNTRIES } = require('./registration-catalogs');

const EMAIL_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}/;

// Nombres alternativos (inglés y variantes) de los países del catálogo.
const COUNTRY_ALIASES = Object.freeze({
    US: ['united states', 'united states of america', 'usa', 'u.s.a.', 'u.s.', 'eeuu', 'ee.uu.', 'ee. uu.', 'estados unidos de america'],
    AR: ['argentina'],
    ES: ['spain', 'espana'],
    DE: ['germany', 'deutschland'],
    AU: ['australia'],
    BR: ['brazil', 'brasil'],
    CA: ['canada'],
    CL: ['chile'],
    CO: ['colombia'],
    KR: ['south korea', 'korea', 'corea'],
    CR: ['costa rica'],
    DK: ['denmark', 'danmark'],
    FI: ['finland', 'suomi'],
    FR: ['france'],
    GR: ['greece'],
    ID: ['indonesia'],
    IT: ['italy', 'italia'],
    JP: ['japan'],
    MX: ['mexico'],
    NO: ['norway', 'norge'],
    NZ: ['new zealand'],
    NL: ['netherlands', 'the netherlands', 'holland', 'holanda', 'nederland'],
    PA: ['panama'],
    PE: ['peru'],
    PL: ['poland', 'polska'],
    PT: ['portugal'],
    GB: ['united kingdom', 'uk', 'u.k.', 'england', 'inglaterra', 'great britain', 'gran bretana', 'scotland', 'escocia', 'wales', 'gales'],
    SE: ['sweden', 'sverige'],
    CH: ['switzerland', 'schweiz', 'suisse'],
    TH: ['thailand'],
    UY: ['uruguay'],
    VE: ['venezuela']
});

function normalizeKey(value) {
    return String(value == null ? '' : value)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9.\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const COUNTRY_INDEX = (() => {
    const index = new Map();
    (REGISTRATION_COUNTRIES || []).forEach((country) => {
        const entry = { code: country.code, name: country.name };
        index.set(normalizeKey(country.name), entry);
        (COUNTRY_ALIASES[country.code] || []).forEach((alias) => index.set(normalizeKey(alias), entry));
    });
    return index;
})();

// País del catálogo que nombra un texto corto ("Argentina", "USA"). Los
// códigos ISO de 2 letras no se aceptan sueltos: "CO", "PA" o "DE" son también
// palabras y abreviaturas de estados.
function matchCountry(text) {
    const key = normalizeKey(text);
    if (!key || key.length < 2) return null;
    return COUNTRY_INDEX.get(key) || null;
}

function cleanText(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80);
}

// Nombre para mostrar: sin emojis ni adornos al principio o al final.
function cleanFullName(value) {
    const text = cleanText(value, 120);
    if (!text) return '';
    return text
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s|·•\-–—_.,:;]+|[\s|·•\-–—_.,:;]+$/g, '')
        .trim()
        .slice(0, 80);
}

function normalizeEmail(value) {
    const text = cleanText(String(value == null ? '' : value), 200).toLowerCase();
    const match = text.match(EMAIL_RE);
    if (!match) return '';
    const email = match[0].replace(/\.+$/, '');
    return email.length <= 120 ? email : '';
}

function emailFromBio(bio) {
    if (typeof bio !== 'string' || !bio) return '';
    // "nombre (at) dominio (dot) com" no se interpreta: solo emails escritos.
    return normalizeEmail(bio);
}

function parseBusinessAddress(raw) {
    let address = raw;
    if (typeof address === 'string') {
        try { address = JSON.parse(address); } catch (_) { return null; }
    }
    return address && typeof address === 'object' && !Array.isArray(address) ? address : null;
}

// "Buenos Aires, Argentina" → { city: 'Buenos Aires', country: {…} }.
// "Brooklyn, New York" → { city: 'Brooklyn', country: null } (sin inventar país).
function splitPlace(text) {
    const clean = cleanText(text, 120)
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean) return { city: '', country: null };
    const parts = clean.split(/\s*[,|·•/]\s*|\s+[-–—]\s+/).map(part => part.trim()).filter(Boolean);
    if (!parts.length) return { city: '', country: null };
    let country = null;
    let cityParts = parts;
    const last = matchCountry(parts[parts.length - 1]);
    if (last) {
        country = last;
        cityParts = parts.slice(0, -1);
    }
    let city = cityParts[0] || '';
    // Un único tramo que es un país ("Argentina") no es ciudad.
    if (!country && parts.length === 1 && matchCountry(parts[0])) {
        country = matchCountry(parts[0]);
        city = '';
    }
    // Una ciudad razonable: letras, sin URL ni arroba, hasta 60 caracteres.
    // ("St. Louis" vale; "www.sitio.com" no: un punto pegado a otra letra es un dominio).
    if (!/^[\p{L}][\p{L}\p{M}'’.\- ]{1,59}$/u.test(city) || /\.\S/.test(city)) city = '';
    return { city, country };
}

/**
 * Datos de contacto de un perfil de Apify.
 * @returns {{ email, email_source, city, country, country_code, location_source }}
 *   email_source: 'business' | 'bio' | null · location_source: 'business' | 'bio' | 'geotag' | null
 */
function extractProfileContact(profile, { bio = '', locationGuess = null, locationSource = null } = {}) {
    const p = profile && typeof profile === 'object' ? profile : {};
    const out = { email: null, email_source: null, city: null, country: null, country_code: null, location_source: null };

    const businessEmail = normalizeEmail(p.businessEmail || p.business_email || p.publicEmail || p.public_email || p.email || '');
    if (businessEmail) {
        out.email = businessEmail;
        out.email_source = 'business';
    } else {
        const fromBio = emailFromBio(bio || p.biography || p.bio || '');
        if (fromBio) {
            out.email = fromBio;
            out.email_source = 'bio';
        }
    }

    const address = parseBusinessAddress(p.businessAddress || p.business_address_json || p.businessAddressJson || p.business_address);
    const businessCity = cleanText((address && (address.city_name || address.cityName || address.city)) || p.cityName || p.city_name || '', 120);
    if (businessCity) {
        const place = splitPlace(businessCity);
        const explicitCountry = matchCountry((address && (address.country_name || address.country)) || p.countryName || '');
        if (place.city) out.city = place.city;
        const country = explicitCountry || place.country;
        if (country) { out.country = country.name; out.country_code = country.code; }
        if (out.city || out.country) out.location_source = 'business';
    }

    if (!out.city && !out.country && locationGuess) {
        const place = splitPlace(locationGuess);
        if (place.city) out.city = place.city;
        if (place.country) { out.country = place.country.name; out.country_code = place.country.code; }
        if (out.city || out.country) out.location_source = locationSource || 'bio';
    } else if (out.city && !out.country && locationGuess) {
        // La dirección profesional trae la ciudad; el país puede estar en la bio.
        const place = splitPlace(locationGuess);
        if (place.country) { out.country = place.country.name; out.country_code = place.country.code; }
    }

    return out;
}

module.exports = {
    COUNTRY_ALIASES,
    cleanFullName,
    emailFromBio,
    extractProfileContact,
    matchCountry,
    normalizeEmail,
    parseBusinessAddress,
    splitPlace
};
