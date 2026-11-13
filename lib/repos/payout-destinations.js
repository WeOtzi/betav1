'use strict';

// Repositorio de destinos de retiro (servidor, service-role vía lib/postgrest.js).
// Ronda 3c · grupo "cifrado". Tabla artist_payout_destinations
// (20261028150000_artist_wallet.sql + 20261113104000_field_encryption.sql).
// Es el `db` de lib/cifrado-payouts.createPayoutDestinationService.
//
// Columnas que NUNCA salen al navegador: account_identifier (en claro, legado),
// account_identifier_enc y account_identifier_key_id. El servicio las filtra.

const { pgrest } = require('../postgrest');

const TABLE = 'artist_payout_destinations';
const AUDIT = 'sensitive_data_access_log';
const SAFE_COLUMNS = 'id,artist_user_id,method,label,holder_name,currency,rail,country_code,verification_status,verified_at,is_default,active,metadata_json,created_at,updated_at';
const SECURE_COLUMNS = `${SAFE_COLUMNS},account_identifier_last4`;
const SENSITIVE_COLUMNS = `${SECURE_COLUMNS},account_identifier,account_identifier_enc,account_identifier_key_id`;
const LEGACY_COLUMNS = `${SAFE_COLUMNS},account_identifier`;

// La migración 20261113104000 todavía no está aplicada (columna inexistente).
function isMissingColumnError(err) {
    const text = String(err && err.message || '');
    return /account_identifier_(enc|last4|key_id)/.test(text) && /(42703|PGRST204|does not exist|Could not find)/i.test(text);
}

function isMissingTableError(err, table) {
    const text = String(err && err.message || '');
    return text.includes(table) && /(42P01|PGRST205|does not exist|Could not find the table)/i.test(text);
}

const PayoutDestinationsRepo = {
    SAFE_COLUMNS,
    isMissingColumnError,

    // Lista del dueño (activos). Si falta la migración, cae a la columna en
    // claro: el servicio calcula los últimos 4 y nunca la devuelve.
    async listByOwner(userId) {
        const run = (cols) => pgrest(TABLE).select(cols)
            .eq('artist_user_id', userId).eq('active', true)
            .order('created_at', { ascending: true }).limit(50).execute();
        try {
            return await run(SECURE_COLUMNS);
        } catch (err) {
            if (!isMissingColumnError(err)) throw err;
            return run(LEGACY_COLUMNS);
        }
    },

    // Fila completa (incluye el sobre cifrado) para descifrar en el servidor.
    async getSensitive(id) {
        try {
            return await pgrest(TABLE).select(SENSITIVE_COLUMNS).eq('id', id).limit(1).single().execute();
        } catch (err) {
            if (!isMissingColumnError(err)) throw err;
            return pgrest(TABLE).select(LEGACY_COLUMNS).eq('id', id).limit(1).single().execute();
        }
    },

    async insert(row) {
        const rows = await pgrest(TABLE).select(SECURE_COLUMNS).insert([row]);
        return rows && rows[0] ? rows[0] : null;
    },

    async update(id, ownerId, patch) {
        const rows = await pgrest(TABLE).select(SECURE_COLUMNS)
            .eq('id', id).eq('artist_user_id', ownerId).patch(patch);
        return rows && rows[0] ? rows[0] : null;
    },

    // Para el script de migración y la rotación: filas con algo que cifrar o rotar.
    async listForEncryption({ afterId = null, limit = 200 } = {}) {
        let q = pgrest(TABLE).select('id,artist_user_id,account_identifier,account_identifier_enc,account_identifier_key_id,account_identifier_last4')
            .order('id', { ascending: true }).limit(limit);
        if (afterId) q = q.gt('id', afterId);
        return q.execute();
    },

    async patchById(id, patch, expected = {}) {
        let q = pgrest(TABLE).select('id,account_identifier,account_identifier_enc,account_identifier_key_id,account_identifier_last4').eq('id', id);
        // Concurrencia optimista: solo si la fila sigue como la leímos.
        if (Object.prototype.hasOwnProperty.call(expected, 'account_identifier_enc')) {
            q = expected.account_identifier_enc == null
                ? q.is('account_identifier_enc', null)
                : q.eq('account_identifier_enc', expected.account_identifier_enc);
        }
        const rows = await q.patch(patch);
        return rows && rows[0] ? rows[0] : null;
    },

    // Auditoría de accesos al dato completo. Si la tabla aún no existe, no
    // bloquea la operación (queda el log del servidor).
    async logAccess(entry) {
        try {
            await pgrest(AUDIT).insert([entry], { returning: false });
            return true;
        } catch (err) {
            if (isMissingTableError(err, AUDIT)) return false;
            throw err;
        }
    }
};

module.exports = { PayoutDestinationsRepo, isMissingColumnError, isMissingTableError, SAFE_COLUMNS, SECURE_COLUMNS };
