'use strict';

// ===========================================================================
// Web Push sin dependencias (frente "push")
// ---------------------------------------------------------------------------
// Implementa lo mínimo del protocolo para enviar un aviso a un navegador:
//   · VAPID (RFC 8292): JWT ES256 firmado con node:crypto, cabecera
//     `Authorization: vapid t=<jwt>, k=<clave pública>`.
//   · Cifrado del cuerpo `aes128gcm` (RFC 8291 sobre RFC 8188): ECDH P-256 +
//     HKDF-SHA-256 + AES-128-GCM, un solo registro.
//   · POST al endpoint de la suscripción (RFC 8030) con TTL / Urgency / Topic.
//
// Claves por entorno (ver .env.example y deployments/DEPLOY.md):
//   VAPID_PUBLIC_KEY   punto P-256 sin comprimir (65 bytes) en base64url
//   VAPID_PRIVATE_KEY  escalar P-256 (32 bytes) en base64url
//   VAPID_SUBJECT      mailto:… o https://… de contacto
// Sin claves válidas, isConfigured() es false y nadie envía nada: el resto de
// la app sigue funcionando.
//
// El endpoint lo aporta el navegador del usuario: SOLO se envía a los
// servicios push conocidos (isAllowedEndpoint) para que nadie pueda usar el
// servidor como proxy hacia una URL arbitraria (SSRF).
// ===========================================================================

const crypto = require('node:crypto');

const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 16 + 4 + 1 + 65; // salt + rs + idlen + clave pública del servidor
// Los servicios push aceptan cuerpos de hasta 4096 bytes.
const MAX_PLAINTEXT = RECORD_SIZE - HEADER_LENGTH - TAG_LENGTH - 1;
const JWT_TTL_SECONDS = 12 * 60 * 60; // RFC 8292: como mucho 24 h
const JWT_REUSE_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

// Servicios push de los navegadores soportados (sufijo de host exacto o subdominio).
const DEFAULT_PUSH_HOSTS = Object.freeze([
    'fcm.googleapis.com', // Chrome, Edge (Android), Opera, Brave, Samsung
    'android.googleapis.com',
    'updates.push.services.mozilla.com', // Firefox
    'notify.windows.com', // Edge (Windows)
    'push.apple.com' // Safari / iOS (web.push.apple.com)
]);

// ---------------------------------------------------------------- base64url

function b64url(value) {
    return Buffer.from(value).toString('base64url');
}

function fromB64url(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || !/^[A-Za-z0-9_\-+/]+={0,2}$/.test(text)) return Buffer.alloc(0);
    return Buffer.from(text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 'base64url');
}

// ---------------------------------------------------------------- HKDF (RFC 5869, un bloque)

function hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

/** HKDF-SHA-256 con salida de hasta 32 bytes (un solo bloque de expansión). */
function hkdf(salt, ikm, info, length) {
    const prk = hmac(salt, ikm);
    return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

// ---------------------------------------------------------------- claves

function isUncompressedPoint(buf) {
    return Buffer.isBuffer(buf) && buf.length === 65 && buf[0] === 4;
}

/** Par VAPID nuevo: { publicKey, privateKey } en base64url. */
function generateVapidKeys() {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** Clave pública (65 bytes) que corresponde a un escalar privado P-256. */
function publicKeyFromPrivate(privateKey) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(privateKey);
    return ecdh.getPublicKey();
}

function isValidSubject(subject) {
    const text = String(subject || '').trim();
    if (/^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i.test(text)) return true;
    try { return new URL(text).protocol === 'https:'; } catch (_) { return false; }
}

/**
 * Valida y normaliza la configuración VAPID.
 * @returns {{ ok: true, publicKey: string, publicKeyBytes: Buffer, signingKey: crypto.KeyObject, subject: string }
 *          | { ok: false, reason: string }}
 */
function loadVapidConfig(input = {}) {
    const publicRaw = String(input.publicKey || '').trim();
    const privateRaw = String(input.privateKey || '').trim();
    const subject = String(input.subject || '').trim();
    if (!publicRaw && !privateRaw) return { ok: false, reason: 'missing_keys' };
    if (!publicRaw || !privateRaw) return { ok: false, reason: 'incomplete_keys' };
    const publicKeyBytes = fromB64url(publicRaw);
    const privateKeyBytes = fromB64url(privateRaw);
    if (!isUncompressedPoint(publicKeyBytes)) return { ok: false, reason: 'invalid_public_key' };
    if (privateKeyBytes.length !== 32) return { ok: false, reason: 'invalid_private_key' };
    let derived;
    try { derived = publicKeyFromPrivate(privateKeyBytes); } catch (_) { return { ok: false, reason: 'invalid_private_key' }; }
    if (!derived.equals(publicKeyBytes)) return { ok: false, reason: 'key_mismatch' };
    if (!isValidSubject(subject)) return { ok: false, reason: 'invalid_subject' };
    let signingKey;
    try {
        signingKey = crypto.createPrivateKey({
            format: 'jwk',
            key: {
                kty: 'EC', crv: 'P-256',
                d: b64url(privateKeyBytes),
                x: b64url(publicKeyBytes.subarray(1, 33)),
                y: b64url(publicKeyBytes.subarray(33, 65))
            }
        });
    } catch (_) {
        return { ok: false, reason: 'invalid_private_key' };
    }
    return { ok: true, publicKey: b64url(publicKeyBytes), publicKeyBytes, signingKey, subject };
}

let envConfigCache = null;
let envConfigSource = '';

/** Configuración VAPID del entorno (memorizada mientras no cambien las variables). */
function vapidFromEnv(env = process.env) {
    const subject = env.VAPID_SUBJECT
        || (env.SUPPORT_EMAIL ? `mailto:${String(env.SUPPORT_EMAIL).trim()}` : '')
        || env.PUBLIC_APP_URL || 'https://beta.weotzi.com';
    const source = [env.VAPID_PUBLIC_KEY || '', env.VAPID_PRIVATE_KEY || '', subject].join('|');
    if (envConfigCache && envConfigSource === source) return envConfigCache;
    envConfigCache = loadVapidConfig({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject });
    envConfigSource = source;
    return envConfigCache;
}

function isConfigured(env = process.env) {
    return vapidFromEnv(env).ok === true;
}

// ---------------------------------------------------------------- VAPID (RFC 8292)

/**
 * JWT ES256 para el servicio push de `audience` (origen del endpoint).
 * @param {{ audience: string, subject: string, signingKey: crypto.KeyObject, expiresAt?: number }} input
 *        expiresAt en segundos Unix (por defecto ahora + 12 h).
 */
function createVapidJwt({ audience, subject, signingKey, expiresAt }) {
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64url(JSON.stringify({
        aud: audience,
        exp: Math.floor(expiresAt || (Date.now() / 1000 + JWT_TTL_SECONDS)),
        sub: subject
    }));
    const unsigned = `${header}.${claims}`;
    // JOSE usa la firma cruda r||s (64 bytes), no el DER que devuelve OpenSSL.
    const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: signingKey, dsaEncoding: 'ieee-p1363' });
    return `${unsigned}.${b64url(signature)}`;
}

/** Verifica un JWT ES256 contra una clave pública P-256 sin comprimir (tests y diagnóstico). */
function verifyVapidJwt(token, publicKey) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { ok: false };
    const point = Buffer.isBuffer(publicKey) ? publicKey : fromB64url(publicKey);
    if (!isUncompressedPoint(point)) return { ok: false };
    let header;
    let claims;
    try {
        header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
        claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    } catch (_) {
        return { ok: false };
    }
    if (!header || header.alg !== 'ES256') return { ok: false };
    let key;
    try {
        key = crypto.createPublicKey({
            format: 'jwk',
            key: { kty: 'EC', crv: 'P-256', x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) }
        });
    } catch (_) {
        return { ok: false };
    }
    const signature = fromB64url(parts[2]);
    if (signature.length !== 64) return { ok: false };
    const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, signature);
    return { ok, header, claims };
}

const jwtCache = new Map();

function vapidAuthorization(endpoint, vapid, now = Date.now()) {
    const audience = new URL(endpoint).origin;
    const cacheKey = `${vapid.publicKey}|${vapid.subject}|${audience}`;
    const cached = jwtCache.get(cacheKey);
    let token = cached && cached.at + JWT_REUSE_MS > now ? cached.token : '';
    if (!token) {
        token = createVapidJwt({ audience, subject: vapid.subject, signingKey: vapid.signingKey, expiresAt: now / 1000 + JWT_TTL_SECONDS });
        if (jwtCache.size > 50) jwtCache.clear();
        jwtCache.set(cacheKey, { token, at: now });
    }
    return `vapid t=${token}, k=${vapid.publicKey}`;
}

// ---------------------------------------------------------------- cifrado (RFC 8291)

/**
 * Cifra `payload` para una suscripción. `options.salt` y
 * `options.localPrivateKey` existen para reproducir vectores de prueba: en
 * producción se generan al azar en cada mensaje (nunca se reutilizan).
 * @param {{ p256dh: string|Buffer, auth: string|Buffer }} keys  claves del navegador
 * @param {string|Buffer} payload
 * @returns {{ body: Buffer, salt: Buffer, localPublicKey: Buffer }}
 */
function encryptPayload(keys, payload, options = {}) {
    const uaPublic = Buffer.isBuffer(keys && keys.p256dh) ? keys.p256dh : fromB64url(keys && keys.p256dh);
    const authSecret = Buffer.isBuffer(keys && keys.auth) ? keys.auth : fromB64url(keys && keys.auth);
    if (!isUncompressedPoint(uaPublic)) throw new Error('Clave p256dh de la suscripción no válida.');
    if (authSecret.length !== 16) throw new Error('Secreto auth de la suscripción no válido.');
    const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload == null ? '' : payload), 'utf8');
    if (plaintext.length > MAX_PLAINTEXT) throw new Error(`El aviso supera el máximo de ${MAX_PLAINTEXT} bytes.`);

    const ecdh = crypto.createECDH('prime256v1');
    if (options.localPrivateKey) ecdh.setPrivateKey(options.localPrivateKey);
    else ecdh.generateKeys();
    const asPublic = ecdh.getPublicKey();
    const ecdhSecret = ecdh.computeSecret(uaPublic);
    const salt = options.salt || crypto.randomBytes(16);
    if (salt.length !== 16) throw new Error('El salt debe tener 16 bytes.');

    // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
    const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
    // CEK y NONCE (RFC 8188): PRK = HMAC(salt, IKM)
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16);
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12);

    const header = Buffer.alloc(21);
    salt.copy(header, 0);
    header.writeUInt32BE(RECORD_SIZE, 16);
    header.writeUInt8(asPublic.length, 20);

    // Registro único: texto || 0x02 (delimitador del último registro).
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
    return { body: Buffer.concat([header, asPublic, ciphertext]), salt, localPublicKey: asPublic };
}

/** Descifra un cuerpo aes128gcm con las claves del navegador (tests de ida y vuelta). */
function decryptPayload({ privateKey, auth }, body) {
    const uaPrivate = Buffer.isBuffer(privateKey) ? privateKey : fromB64url(privateKey);
    const authSecret = Buffer.isBuffer(auth) ? auth : fromB64url(auth);
    const salt = body.subarray(0, 16);
    const idLength = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idLength);
    const ciphertext = body.subarray(21 + idLength);
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(uaPrivate);
    const uaPublic = ecdh.getPublicKey();
    const ecdhSecret = ecdh.computeSecret(asPublic);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
    const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16);
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12);
    const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_LENGTH));
    const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - TAG_LENGTH)), decipher.final()]);
    let end = padded.length - 1;
    while (end >= 0 && padded[end] === 0) end -= 1;
    if (end < 0 || padded[end] !== 2) throw new Error('Relleno del registro no válido.');
    return padded.subarray(0, end);
}

// ---------------------------------------------------------------- endpoint

function allowedHosts(env = process.env) {
    const extra = String(env.PUSH_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(h => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
    return [...DEFAULT_PUSH_HOSTS, ...extra];
}

/** ¿El endpoint es de un servicio push conocido? (https, sin credenciales ni puerto raro). */
function isAllowedEndpoint(endpoint, env = process.env) {
    if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
    let url;
    try { url = new URL(endpoint); } catch (_) { return false; }
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    const host = url.hostname.toLowerCase();
    return allowedHosts(env).some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

/** Valida la forma de una suscripción del navegador. Devuelve la versión normalizada o null. */
function normalizeSubscription(input, env = process.env) {
    if (!input || typeof input !== 'object') return null;
    const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
    const keys = input.keys && typeof input.keys === 'object' ? input.keys : {};
    const p256dh = fromB64url(keys.p256dh || input.p256dh);
    const auth = fromB64url(keys.auth || input.auth);
    if (!isAllowedEndpoint(endpoint, env)) return null;
    if (!isUncompressedPoint(p256dh) || auth.length !== 16) return null;
    return { endpoint, p256dh: b64url(p256dh), auth: b64url(auth) };
}

// ---------------------------------------------------------------- envío

function topicFor(value) {
    // Topic: hasta 32 caracteres del alfabeto base64url (RFC 8030 §5.4).
    if (!value) return '';
    return crypto.createHash('sha256').update(String(value)).digest('base64url').slice(0, 32);
}

/**
 * Envía un aviso a UNA suscripción.
 * @param {{ endpoint: string, p256dh: string, auth: string }} subscription
 * @param {object|string} payload  objeto (se serializa a JSON) o texto
 * @param {{ ttl?: number, urgency?: 'very-low'|'low'|'normal'|'high', topic?: string,
 *           vapid?: object, fetchImpl?: Function, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, status: number, gone: boolean, error?: string }>}
 *          gone = la suscripción ya no existe (404 / 410): hay que borrarla.
 */
async function sendNotification(subscription, payload, options = {}) {
    const vapid = options.vapid || vapidFromEnv();
    if (!vapid || !vapid.ok) return { ok: false, status: 0, gone: false, error: 'push_not_configured' };
    if (!subscription || !isAllowedEndpoint(subscription.endpoint)) {
        return { ok: false, status: 0, gone: true, error: 'endpoint_not_allowed' };
    }
    let body;
    try {
        const text = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload || {});
        body = encryptPayload({ p256dh: subscription.p256dh, auth: subscription.auth }, text).body;
    } catch (error) {
        // Claves corruptas: la suscripción no sirve más.
        return { ok: false, status: 0, gone: /suscripción/.test(error.message), error: error.message };
    }
    const headers = {
        Authorization: vapidAuthorization(subscription.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(Math.max(0, Math.floor(Number.isFinite(options.ttl) ? options.ttl : DEFAULT_TTL_SECONDS))),
        Urgency: ['very-low', 'low', 'normal', 'high'].includes(options.urgency) ? options.urgency : 'normal'
    };
    const topic = topicFor(options.topic);
    if (topic) headers.Topic = topic;

    const fetchImpl = options.fetchImpl || fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
        const res = await fetchImpl(subscription.endpoint, { method: 'POST', headers, body, signal: ctrl.signal, redirect: 'error' });
        const status = Number(res.status) || 0;
        return { ok: status >= 200 && status < 300, status, gone: status === 404 || status === 410 };
    } catch (error) {
        return { ok: false, status: 0, gone: false, error: error && error.name === 'AbortError' ? 'timeout' : 'network_error' };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    RECORD_SIZE,
    MAX_PLAINTEXT,
    DEFAULT_PUSH_HOSTS,
    b64url,
    fromB64url,
    hkdf,
    generateVapidKeys,
    publicKeyFromPrivate,
    loadVapidConfig,
    vapidFromEnv,
    isConfigured,
    isValidSubject,
    createVapidJwt,
    verifyVapidJwt,
    vapidAuthorization,
    encryptPayload,
    decryptPayload,
    isAllowedEndpoint,
    normalizeSubscription,
    topicFor,
    sendNotification
};
