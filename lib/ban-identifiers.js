'use strict';

// ===========================================================================
// Huellas de identificadores baneados (fase 1 · sanciones, 2.7.0).
// ---------------------------------------------------------------------------
// Lógica pura + HMAC. Sin dependencias: crypto de Node.
//
// Una cuenta baneada deja en `banned_identifiers` el HMAC-SHA256 de su correo,
// su teléfono y su Instagram, nunca el valor en claro. Para que el mismo dato
// escrito de otra forma dé la misma huella, antes del HMAC se normaliza:
//   · correo     → minúsculas, sin "+etiqueta"; en gmail/googlemail sin puntos
//                  (googlemail.com cuenta como gmail.com: es el mismo buzón);
//   · teléfono   → E.164. Con "+" (o "00") se valida /^\+\d{8,15}$/; sin "+"
//                  se usa el país del perfil (solo AR, ES y US):
//                    AR: 54 + 9 de celular, sin el 0 de larga distancia ni el 15;
//                    ES: 34; US: 1. Otro país sin "+" → null (no se compara).
//                  Un +54 de 10 dígitos nacionales recibe el 9 de celular: los
//                  números de WhatsApp de Argentina se escriben con y sin él;
//                  como los dos lados se normalizan igual, la huella coincide.
//   · Instagram  → sin @, sin URL (instagram.com/<handle>/…), minúsculas.
//
// Clave: BAN_HMAC_KEY = 32 bytes aleatorios en base64 (mismo formato que
// DATA_ENC_KEY de lib/field-crypto.js). Generarla con:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Falla abierta: sin clave (o con una inválida) isConfigured() es false,
// hmacIdentifier devuelve null e identifiersFor una lista vacía. El servidor
// sigue funcionando pero NO bloquea el reingreso (se avisa una sola vez en el
// log). Si la clave se pierde o cambia, las huellas guardadas dejan de
// coincidir con las nuevas.
//
// Nunca se loguean los valores en claro ni la clave.
// ===========================================================================

const crypto = require('crypto');

const KINDS = ['email', 'phone', 'instagram', 'document', 'face'];
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const E164_RE = /^\+\d{8,15}$/;
const IG_HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const IG_URL_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:_u\/)?([^/?#\s]+)/i;
// Rutas de Instagram que no son perfiles.
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv', 'direct', 'about', 'legal', 'developer']);
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

// País del perfil → ISO-2. Los perfiles guardan el nombre ("Argentina",
// "España", "United States"); el contrato pide ISO-2. Se aceptan ambos.
const COUNTRY_ALIASES = {
    ar: 'AR', arg: 'AR', argentina: 'AR',
    es: 'ES', esp: 'ES', espana: 'ES', spain: 'ES',
    us: 'US', usa: 'US', 'estados unidos': 'US', 'united states': 'US', 'united states of america': 'US', eeuu: 'US', 'ee uu': 'US'
};

function clean(value) {
    return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
}

function stripAccents(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function countryCode(value) {
    const key = stripAccents(clean(value).toLowerCase()).replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
    return COUNTRY_ALIASES[key] || null;
}

// --- normalización -------------------------------------------------------------

function normalizeEmail(raw) {
    const text = clean(raw).toLowerCase();
    if (!text || text.length > 254 || !EMAIL_RE.test(text)) return null;
    const at = text.lastIndexOf('@');
    let local = text.slice(0, at);
    let domain = text.slice(at + 1).replace(/\.+$/, '');
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    if (GMAIL_DOMAINS.has(domain)) {
        local = local.replace(/\./g, '');
        domain = 'gmail.com';
    }
    if (!local || !domain) return null;
    return `${local}@${domain}`;
}

// Argentina: número nacional de 10 dígitos (código de área + local), sin 0,
// sin 9 de celular y sin 15. null si no cierra.
function argentineNational(digits) {
    let n = digits;
    if (n.startsWith('0')) n = n.slice(1);
    if (n.length === 13 && n.startsWith('549')) n = n.slice(3);
    else if (n.length === 12 && n.startsWith('54')) n = n.slice(2);
    if (n.length === 11 && n.startsWith('9')) n = n.slice(1);
    if (n.length === 12) {
        // Código de área + 15 + local. Buenos Aires (11) es el único de 2 dígitos.
        const areaLengths = n.startsWith('11') ? [2] : [3, 4];
        const at = areaLengths.find((len) => n.slice(len, len + 2) === '15');
        if (at === undefined) return null;
        n = n.slice(0, at) + n.slice(at + 2);
    }
    return /^\d{10}$/.test(n) && !n.startsWith('0') ? n : null;
}

function normalizePhone(raw, countryIso2) {
    let text = clean(raw);
    if (!text) return null;
    text = text.replace(/[\s\-.()/]/g, '');
    let international = false;
    if (text.startsWith('+')) { international = true; text = text.slice(1); }
    else if (text.startsWith('00')) { international = true; text = text.slice(2); }
    if (!/^\d+$/.test(text)) return null;

    let e164;
    if (international) {
        e164 = `+${text}`;
        if (!E164_RE.test(e164)) return null;
        // +54 sin el 9 de celular (o con 0 / 15 escritos de más) → forma canónica.
        if (e164.startsWith('+54')) {
            const national = argentineNational(text.slice(2));
            if (national) e164 = `+549${national}`;
        }
        return E164_RE.test(e164) ? e164 : null;
    }

    const country = countryCode(countryIso2);
    if (country === 'AR') {
        const national = argentineNational(text);
        e164 = national ? `+549${national}` : null;
    } else if (country === 'ES') {
        let n = text;
        if (n.length === 11 && n.startsWith('34')) n = n.slice(2);
        e164 = /^[6-9]\d{8}$/.test(n) ? `+34${n}` : null;
    } else if (country === 'US') {
        let n = text;
        if (n.length === 11 && n.startsWith('1')) n = n.slice(1);
        e164 = /^[2-9]\d{9}$/.test(n) ? `+1${n}` : null;
    } else {
        return null;
    }
    return e164 && E164_RE.test(e164) ? e164 : null;
}

function normalizeInstagram(raw) {
    let text = clean(raw);
    if (!text) return null;
    const url = IG_URL_RE.exec(text);
    if (url) {
        text = url[1];
        if (IG_RESERVED.has(text.toLowerCase())) return null;
    } else if (/[/:]/.test(text)) {
        return null;
    }
    text = text.replace(/^@+/, '').replace(/\/+$/, '').toLowerCase();
    return IG_HANDLE_RE.test(text) ? text : null;
}

// --- clave -----------------------------------------------------------------------

// Clave de 32 bytes en base64 (estándar o url-safe). null si no es válida.
function decodeKey(raw) {
    const text = clean(raw);
    if (!text) return null;
    try {
        const buf = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        return buf.length === 32 ? buf : null;
    } catch (_) {
        return null;
    }
}

function banKey(env = process.env) {
    return decodeKey(env && env.BAN_HMAC_KEY);
}

function isConfigured(env = process.env) {
    return banKey(env) !== null;
}

let warned = false;
function warnNotConfigured(env) {
    if (warned) return;
    warned = true;
    const present = Boolean(clean(env && env.BAN_HMAC_KEY));
    console.warn(`[ban-identifiers] BAN_HMAC_KEY ${present ? 'no es una clave de 32 bytes en base64' : 'no está configurada'}: el bloqueo de reingreso queda desactivado (falla abierta).`);
}

// Subclave para otro uso (p. ej. el token de apelación): HMAC(clave, etiqueta).
// null si no hay clave.
function deriveKey(label, env = process.env) {
    const key = banKey(env);
    if (!key) return null;
    return crypto.createHmac('sha256', key).update(`weotzi:${String(label || '')}`).digest();
}

// --- huellas -----------------------------------------------------------------------

function hmacIdentifier(kind, normalized, env = process.env) {
    if (!KINDS.includes(kind)) return null;
    const value = clean(normalized);
    if (!value) return null;
    const key = banKey(env);
    if (!key) { warnNotConfigured(env); return null; }
    return crypto.createHmac('sha256', key).update(`${kind}:${value}`).digest('hex');
}

function asList(value) {
    if (Array.isArray(value)) return value;
    return value == null || value === '' ? [] : [value];
}

// { email, phone, instagram, country } → [{ kind, value_hmac }] sin repetidos.
// phone e instagram aceptan una lista (perfil de artista + estudios).
// Un dato que no se puede normalizar se omite (nunca cuenta como coincidencia).
function identifiersFor(input, env = process.env) {
    const src = input && typeof input === 'object' ? input : {};
    if (!isConfigured(env)) { warnNotConfigured(env); return []; }
    const out = [];
    const seen = new Set();
    const push = (kind, normalized) => {
        if (!normalized) return;
        const value_hmac = hmacIdentifier(kind, normalized, env);
        const key = `${kind}:${value_hmac}`;
        if (!value_hmac || seen.has(key)) return;
        seen.add(key);
        out.push({ kind, value_hmac });
    };
    asList(src.email).forEach((v) => push('email', normalizeEmail(v)));
    asList(src.phone).forEach((v) => push('phone', normalizePhone(v, src.country)));
    asList(src.instagram).forEach((v) => push('instagram', normalizeInstagram(v)));
    return out;
}

module.exports = {
    KINDS,
    normalizeEmail,
    normalizePhone,
    normalizeInstagram,
    isConfigured,
    hmacIdentifier,
    identifiersFor,
    deriveKey,
    _internal: {
        decodeKey, countryCode, argentineNational, resetWarning: () => { warned = false; }
    }
};
