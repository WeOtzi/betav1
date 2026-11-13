'use strict';

// ===========================================================================
// Cifrado de campos sensibles a nivel de aplicación (servidor).
// ---------------------------------------------------------------------------
// Ronda 3c · grupo "cifrado". Sin dependencias: crypto de Node.
//
//   - AES-256-GCM, IV aleatorio de 12 bytes por valor, tag de 16 bytes.
//   - AAD obligatorio (contexto): ata el texto cifrado a su tabla, columna y
//     dueño (p. ej. "artist_payout_destinations.account_identifier:<user_id>").
//     Un valor cifrado copiado a otra fila u otro artista no descifra.
//   - Sobre (envelope) en texto, apto para una columna `text`:
//         wo1:<key_id>:<iv>:<ciphertext>:<tag>      (base64url)
//     El key_id permite rotar: se cifra siempre con la clave primaria y se
//     descifra con cualquiera de las claves conocidas.
//
// Configuración SOLO por entorno (nunca en la base ni en el repo):
//   DATA_ENC_KEY            clave primaria, 32 bytes en base64 (obligatoria)
//   DATA_ENC_KEY_ID         id de la clave primaria (default "k1")
//   DATA_ENC_PREVIOUS_KEYS  claves anteriores, solo para descifrar durante una
//                           rotación: "k0=<base64>,k-viejo=<base64>"
//
// Generar una clave:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Nunca se loguean ni se incluyen en errores los valores en claro ni las claves.
// ===========================================================================

const crypto = require('crypto');

const ENVELOPE_PREFIX = 'wo1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_KEY_ID = 'k1';
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const NOT_CONFIGURED_MESSAGE = 'El cifrado de datos sensibles no está configurado en el servidor (DATA_ENC_KEY).';

class FieldCryptoError extends Error {
    constructor(code, message, status) {
        super(message || code);
        this.name = 'FieldCryptoError';
        this.code = code;
        this.status = status || (code === 'NOT_CONFIGURED' ? 503 : 500);
    }
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

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

function parsePreviousKeys(raw) {
    const keys = new Map();
    const invalid = [];
    clean(raw).split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
        const eq = part.indexOf('=');
        const id = eq > 0 ? part.slice(0, eq).trim() : '';
        const key = eq > 0 ? decodeKey(part.slice(eq + 1)) : null;
        if (!KEY_ID_RE.test(id) || !key) { invalid.push(id || '(sin id)'); return; }
        keys.set(id, key);
    });
    return { keys, invalid };
}

// Lee la configuración. Nunca expone las claves: solo ids y faltantes.
function fieldCryptoConfig(env = process.env) {
    const primaryKey = decodeKey(env.DATA_ENC_KEY);
    const primaryKeyId = clean(env.DATA_ENC_KEY_ID) || DEFAULT_KEY_ID;
    const previous = parsePreviousKeys(env.DATA_ENC_PREVIOUS_KEYS);
    const missing = [];
    const problems = [];
    if (!clean(env.DATA_ENC_KEY)) missing.push('DATA_ENC_KEY');
    else if (!primaryKey) problems.push('DATA_ENC_KEY no es una clave de 32 bytes en base64');
    if (!KEY_ID_RE.test(primaryKeyId)) problems.push('DATA_ENC_KEY_ID inválido (letras, números, _ o -; hasta 32)');
    if (previous.invalid.length) problems.push(`DATA_ENC_PREVIOUS_KEYS con entradas inválidas: ${previous.invalid.join(', ')}`);
    if (previous.keys.has(primaryKeyId)) problems.push('DATA_ENC_PREVIOUS_KEYS repite el id de la clave primaria');
    const keyring = new Map(previous.keys);
    if (primaryKey && KEY_ID_RE.test(primaryKeyId)) keyring.set(primaryKeyId, primaryKey);
    return {
        configured: !!primaryKey && KEY_ID_RE.test(primaryKeyId) && !previous.keys.has(primaryKeyId),
        missing,
        problems,
        primaryKeyId,
        knownKeyIds: Array.from(keyring.keys()),
        keyring
    };
}

function b64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
    return Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function isEnvelope(value) {
    return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX + ':') && parseEnvelope(value) !== null;
}

function parseEnvelope(value) {
    if (typeof value !== 'string') return null;
    const parts = value.split(':');
    if (parts.length !== 5 || parts[0] !== ENVELOPE_PREFIX) return null;
    const [, keyId, iv, ct, tag] = parts;
    if (!KEY_ID_RE.test(keyId) || ![iv, ct, tag].every((p) => B64URL_RE.test(p))) return null;
    return { keyId, iv, ct, tag };
}

function requireContext(context) {
    const text = clean(context);
    if (!text) throw new FieldCryptoError('CONTEXT_REQUIRED', 'Falta el contexto (AAD) del campo cifrado.');
    return Buffer.from(text, 'utf8');
}

// Contexto estándar: "<tabla>.<columna>:<dueño>".
function contextFor(table, column, ownerId) {
    return `${table}.${column}:${ownerId == null ? '' : String(ownerId)}`;
}

function createFieldCrypto(options = {}) {
    const cfg = options.config || fieldCryptoConfig(options.env || process.env);

    function assertConfigured() {
        if (!cfg.configured) throw new FieldCryptoError('NOT_CONFIGURED', NOT_CONFIGURED_MESSAGE, 503);
    }

    function encrypt(plaintext, context) {
        assertConfigured();
        if (plaintext == null) throw new FieldCryptoError('EMPTY_VALUE', 'No hay valor para cifrar.', 400);
        const aad = requireContext(context);
        const key = cfg.keyring.get(cfg.primaryKeyId);
        const iv = crypto.randomBytes(IV_BYTES);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
        cipher.setAAD(aad);
        const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [ENVELOPE_PREFIX, cfg.primaryKeyId, b64url(iv), b64url(ct), b64url(tag)].join(':');
    }

    function decrypt(envelope, context) {
        assertConfigured();
        const parsed = parseEnvelope(envelope);
        if (!parsed) throw new FieldCryptoError('BAD_ENVELOPE', 'El valor cifrado no tiene un formato válido.');
        const key = cfg.keyring.get(parsed.keyId);
        if (!key) throw new FieldCryptoError('KEY_NOT_FOUND', `No está configurada la clave "${parsed.keyId}" para descifrar.`);
        const aad = requireContext(context);
        try {
            const iv = fromB64url(parsed.iv);
            const tag = fromB64url(parsed.tag);
            if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('length');
            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
            decipher.setAAD(aad);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(fromB64url(parsed.ct)), decipher.final()]).toString('utf8');
        } catch (_) {
            // Clave equivocada, contexto distinto o dato alterado: mismo error, sin detalles.
            throw new FieldCryptoError('DECRYPT_FAILED', 'No se pudo descifrar el valor (clave o contexto no coinciden).');
        }
    }

    function keyIdOf(envelope) {
        const parsed = parseEnvelope(envelope);
        return parsed ? parsed.keyId : null;
    }

    // true si el valor está cifrado con una clave que no es la primaria.
    function needsRotation(envelope) {
        const id = keyIdOf(envelope);
        return !!id && id !== cfg.primaryKeyId;
    }

    // Descifra con la clave que corresponda y vuelve a cifrar con la primaria.
    function reencrypt(envelope, context) {
        return encrypt(decrypt(envelope, context), context);
    }

    return {
        get configured() { return cfg.configured; },
        get primaryKeyId() { return cfg.primaryKeyId; },
        get missing() { return cfg.missing.slice(); },
        get problems() { return cfg.problems.slice(); },
        knownKeyIds: () => cfg.knownKeyIds.slice(),
        assertConfigured,
        encrypt,
        decrypt,
        keyIdOf,
        needsRotation,
        reencrypt
    };
}

// ---------------------- máscaras para mostrar ----------------------

// Últimos 4 caracteres alfanuméricos (sin espacios ni separadores).
function last4(value) {
    return String(value == null ? '' : value).replace(/[^A-Za-z0-9]/g, '').slice(-4);
}

// "···· 1234" a partir del valor completo o de sus últimos 4.
function maskTail(tail) {
    const t = last4(tail);
    return t ? '···· ' + t : '';
}

function maskIdentifier(value) {
    return maskTail(last4(value));
}

let shared = null;
// Instancia compartida del proceso (lee process.env una vez).
function getFieldCrypto() {
    if (!shared) shared = createFieldCrypto();
    return shared;
}

module.exports = {
    ENVELOPE_PREFIX,
    NOT_CONFIGURED_MESSAGE,
    FieldCryptoError,
    fieldCryptoConfig,
    createFieldCrypto,
    getFieldCrypto,
    contextFor,
    parseEnvelope,
    isEnvelope,
    decodeKey,
    last4,
    maskTail,
    maskIdentifier
};
