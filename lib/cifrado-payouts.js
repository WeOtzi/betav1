'use strict';

// ===========================================================================
// Destinos de retiro con el número de cuenta cifrado (servidor).
// ---------------------------------------------------------------------------
// Ronda 3c · grupo "cifrado". Lógica pura con dependencias inyectadas
// (crypto = lib/field-crypto, db = lib/repos/payout-destinations), testeable
// sin red.
//
//   - Alta / edición: valida igual que el navegador (wallet-model.js), cifra
//     el CBU/IBAN/alias con AES-256-GCM (AAD = tabla.columna:dueño) y guarda
//     solo el sobre + los últimos 4. La columna en claro queda en null.
//   - Lectura: el navegador recibe la fila sin el dato (solo
//     account_identifier_last4 y account_identifier_mask).
//   - Ver el dato completo: solo el dueño o un agente de soporte activo, por
//     endpoint, y cada acceso queda en sensitive_data_access_log.
//   - Estado de verificación: la base confía en service_role (trigger
//     guard_artist_payout_destination), así que acá se fuerza 'pending' en
//     altas y cuando cambian cuenta, método o moneda.
// ===========================================================================

const crypto = require('crypto');
const WalletModel = require('../public/shared/js/wallet-model.js');
const { contextFor, last4, maskTail, FieldCryptoError } = require('./field-crypto');

const TABLE = 'artist_payout_destinations';
const COLUMN = 'account_identifier';
const MIGRATION = '20261113104000_field_encryption';
const SERVER_METHODS = ['lemon', 'bank_usd', 'bank_international'];
const FORBIDDEN_METADATA = ['pan', 'card_number', 'cvv', 'cvc', 'security_code'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PayoutError extends Error {
    constructor(message, status, code) {
        super(message);
        this.name = 'PayoutError';
        this.status = status || 400;
        if (code) this.code = code;
    }
}

function identifierContext(ownerId) {
    return contextFor(TABLE, COLUMN, ownerId);
}

function hasForbiddenMetadata(value) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasForbiddenMetadata);
    return Object.entries(value).some(([key, child]) =>
        FORBIDDEN_METADATA.includes(String(key).toLowerCase()) || hasForbiddenMetadata(child));
}

// Fila apta para el navegador: sin columnas sensibles, con los últimos 4.
function publicView(row) {
    if (!row) return null;
    const out = {};
    Object.keys(row).forEach((key) => {
        if (key === 'account_identifier' || key === 'account_identifier_enc' || key === 'account_identifier_key_id') return;
        out[key] = row[key];
    });
    const tail = row.account_identifier_last4 || last4(row.account_identifier);
    out.account_identifier_last4 = tail || null;
    out.account_identifier_mask = maskTail(tail);
    return out;
}

function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
}

// Valida el pedido del navegador. En una edición el identificador puede venir
// vacío: se conserva el guardado.
function validateInput(input, { editing = false } = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const method = String(src.method || '');
    if (!SERVER_METHODS.includes(method)) throw new PayoutError('Elegí un método disponible.');
    if (hasForbiddenMetadata(src.metadata || {})) throw new PayoutError('No se permiten datos de tarjeta.');
    const identifier = String(src.accountIdentifier == null ? '' : src.accountIdentifier).trim();
    const keepIdentifier = editing && identifier === '';
    const check = WalletModel.validateDestination({
        method,
        holderName: src.holderName,
        currency: src.currency,
        accountIdentifier: keepIdentifier ? 'XXXX' : identifier
    });
    if (!check.ok) throw new PayoutError(Object.values(check.errors)[0]);
    const methodInfo = WalletModel.DESTINATION_METHODS[method] || {};
    const countryCode = src.countryCode ? String(src.countryCode).trim().toUpperCase() : null;
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new PayoutError('País inválido.');
    const rail = src.rail || methodInfo.rail || null;
    if (rail && !['ACH', 'SEPA', 'SWIFT', 'CBU', 'ALIAS', 'WALLET'].includes(rail)) throw new PayoutError('Red de pago inválida.');
    return {
        method,
        label: cleanText(src.label || methodInfo.label || method, 80),
        holderName: cleanText(src.holderName, 120),
        currency: cleanText(src.currency || 'USD', 4).toUpperCase(),
        identifier: keepIdentifier ? null : identifier,
        rail,
        countryCode,
        isDefault: !!src.isDefault
    };
}

function createPayoutDestinationService({ crypto: fieldCrypto, db, log = console, now = () => new Date() } = {}) {
    if (!fieldCrypto || !db) throw new Error('createPayoutDestinationService: faltan dependencias');

    function sealed(identifier, ownerId) {
        return {
            account_identifier: null,
            account_identifier_enc: fieldCrypto.encrypt(identifier, identifierContext(ownerId)),
            account_identifier_key_id: fieldCrypto.primaryKeyId,
            account_identifier_last4: last4(identifier) || null
        };
    }

    function wrapDbError(err) {
        if (db.isMissingColumnError && db.isMissingColumnError(err)) {
            return new PayoutError(`Falta aplicar la migración ${MIGRATION} en la base.`, 503, 'MIGRATION_MISSING');
        }
        return err;
    }

    // Valor completo de una fila (sobre cifrado o, si es una fila legada, la columna en claro).
    function revealRow(row) {
        if (!row) throw new PayoutError('No encontramos ese destino.', 404);
        if (row.account_identifier_enc) return fieldCrypto.decrypt(row.account_identifier_enc, identifierContext(row.artist_user_id));
        if (row.account_identifier) return String(row.account_identifier);
        throw new PayoutError('Este destino no tiene número de cuenta guardado.', 404);
    }

    async function list(ownerId) {
        const rows = await db.listByOwner(ownerId);
        return (rows || [])
            .map(publicView)
            .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0)
                || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    }

    async function create(ownerId, input) {
        fieldCrypto.assertConfigured();
        const v = validateInput(input);
        const existing = await db.listByOwner(ownerId);
        const row = Object.assign({
            id: crypto.randomUUID(),
            artist_user_id: ownerId,
            method: v.method,
            label: v.label,
            holder_name: v.holderName,
            currency: v.currency,
            rail: v.rail,
            country_code: v.countryCode,
            verification_status: 'pending',
            verified_at: null,
            is_default: v.isDefault || !(existing || []).length,
            active: true,
            metadata_json: { entered_via: 'account_center' }
        }, sealed(v.identifier, ownerId));
        try {
            return publicView(await db.insert(row));
        } catch (err) {
            throw wrapDbError(err);
        }
    }

    async function update(ownerId, id, input) {
        fieldCrypto.assertConfigured();
        if (!UUID_RE.test(String(id || ''))) throw new PayoutError('Destino inválido.', 400);
        const v = validateInput(input, { editing: true });
        const current = await db.getSensitive(id);
        if (!current || current.artist_user_id !== ownerId || !current.active) throw new PayoutError('No encontramos ese destino.', 404);

        let identifierChanged = false;
        const patch = {
            method: v.method,
            label: v.label,
            holder_name: v.holderName,
            currency: v.currency,
            rail: v.rail
        };
        if (v.countryCode) patch.country_code = v.countryCode;
        if (v.identifier !== null) {
            let previous = null;
            try { previous = revealRow(current); } catch (_) { previous = null; }
            identifierChanged = previous === null || previous.replace(/\s+/g, '') !== v.identifier.replace(/\s+/g, '');
            if (identifierChanged || !current.account_identifier_enc) Object.assign(patch, sealed(v.identifier, ownerId));
        } else if (!current.account_identifier_enc && current.account_identifier) {
            // Fila legada: se aprovecha la edición para cifrarla.
            Object.assign(patch, sealed(String(current.account_identifier), ownerId));
        }
        if (identifierChanged || v.method !== current.method || v.currency !== current.currency) {
            patch.verification_status = 'pending';
            patch.verified_at = null;
        }
        try {
            return publicView(await db.update(id, ownerId, patch));
        } catch (err) {
            throw wrapDbError(err);
        }
    }

    async function remove(ownerId, id) {
        if (!UUID_RE.test(String(id || ''))) throw new PayoutError('Destino inválido.', 400);
        const row = await db.update(id, ownerId, { active: false, is_default: false });
        if (!row) throw new PayoutError('No encontramos ese destino.', 404);
        return publicView(row);
    }

    async function audit(entry) {
        const record = Object.assign({ table_name: TABLE, column_name: COLUMN, created_at: now().toISOString() }, entry);
        try {
            const stored = await db.logAccess(record);
            if (!stored) log.warn && log.warn('[cifrado] auditoría sin tabla (migración pendiente):', record.accessor_role, record.row_id);
        } catch (err) {
            log.warn && log.warn('[cifrado] no se pudo registrar el acceso:', err && err.message);
        }
    }

    async function revealForOwner(ownerId, id, meta = {}) {
        fieldCrypto.assertConfigured();
        if (!UUID_RE.test(String(id || ''))) throw new PayoutError('Destino inválido.', 400);
        const row = await db.getSensitive(id);
        if (!row || row.artist_user_id !== ownerId || !row.active) throw new PayoutError('No encontramos ese destino.', 404);
        const value = revealRow(row);
        await audit({ row_id: id, owner_user_id: ownerId, accessor_user_id: ownerId, accessor_role: 'owner', purpose: cleanText(meta.purpose || 'owner_view', 60) });
        return { id, account_identifier: value };
    }

    async function revealForSupport(agentUserId, id, meta = {}) {
        fieldCrypto.assertConfigured();
        if (!UUID_RE.test(String(id || ''))) throw new PayoutError('Destino inválido.', 400);
        const purpose = cleanText(meta.purpose, 60);
        if (!['verification', 'withdrawal_settlement'].includes(purpose)) throw new PayoutError('Indicá para qué necesitás ver la cuenta.', 400);
        const row = await db.getSensitive(id);
        if (!row) throw new PayoutError('No encontramos ese destino.', 404);
        const value = revealRow(row);
        await audit({ row_id: id, owner_user_id: row.artist_user_id, accessor_user_id: agentUserId, accessor_role: 'support', purpose });
        return { id, account_identifier: value };
    }

    return { list, create, update, remove, revealForOwner, revealForSupport, publicView };
}

// Respuesta HTTP homogénea para errores del servicio.
function errorResponse(err, fallback) {
    if (err instanceof FieldCryptoError) {
        if (err.code === 'NOT_CONFIGURED') return { status: 503, body: { success: false, configured: false, error: err.message } };
        return { status: 500, body: { success: false, error: 'No pudimos leer el dato cifrado. Avisale a soporte.' } };
    }
    if (err instanceof PayoutError) return { status: err.status, body: { success: false, error: err.message, code: err.code || undefined } };
    return { status: 500, body: { success: false, error: fallback } };
}

// Freno simple en memoria para ver el dato completo (por usuario).
function createRevealLimiter({ max = 20, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    const hits = new Map();
    return function allow(key) {
        const t = now();
        const list = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
        if (list.length >= max) { hits.set(key, list); return false; }
        list.push(t);
        hits.set(key, list);
        if (hits.size > 5000) hits.clear();
        return true;
    };
}

module.exports = {
    MIGRATION,
    PayoutError,
    identifierContext,
    publicView,
    validateInput,
    createPayoutDestinationService,
    errorResponse,
    createRevealLimiter
};
