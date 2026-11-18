'use strict';

// ── términos ──
// Repositorio del gate de Términos (servidor, service-role vía lib/postgrest.js):
//   - aceptaciones por persona y versión (public.terms_acceptances, migración
//     20261118120000; solo escribe el servidor);
//   - perfiles propios (artists_db, clients_db, studios) para saber los roles,
//     la versión sellada y los identificadores del bloqueo de reingreso;
//   - re-sellado de terms_accepted_at / terms_version en TODOS los perfiles de
//     la persona. Con service_role los guardas guard_artist_terms_acceptance,
//     guard_client_terms_acceptance y private.guard_studio_terms_columns dejan
//     escribir. No usa AccesoRepo.stampClientTerms: su filtro
//     terms_accepted_at is null impide volver a sellar una versión nueva.

const { pgrest } = require('../postgrest');
const { writeWithTermsFallback } = require('../terms-acceptance');

const ARTIST_COLUMNS = 'user_id,registration_status,terms_accepted_at,terms_version,instagram,whatsapp_number,country,country_code';
const CLIENT_COLUMNS = 'user_id,terms_accepted_at,terms_version,instagram,whatsapp,country';
const STUDIO_COLUMNS = 'id,user_id,terms_accepted_at,terms_version,instagram,whatsapp,contact_phone,phone,country,country_code';
const PROFILE_TABLES = Object.freeze({ artist: 'artists_db', client: 'clients_db', studio: 'studios' });

// La tabla todavía no existe (migración sin aplicar): PostgREST responde
// PGRST205 / 42P01. El gate sigue con el respaldo de los perfiles.
function isMissingTableError(err) {
    const text = String((err && (err.message || err)) || '');
    return /PGRST205|42P01|terms_acceptances/.test(text) && /(does not exist|could not find|schema cache|PGRST205|42P01)/i.test(text);
}

const TerminosRepo = {
    // Filas de terms_acceptances del usuario, la más reciente primero.
    // null = la tabla no existe todavía.
    async listAcceptances(userId) {
        try {
            const rows = await pgrest('terms_acceptances')
                .select('version,accepted_at,surface')
                .eq('user_id', userId)
                .order('accepted_at', { ascending: false })
                .limit(20)
                .execute();
            return Array.isArray(rows) ? rows : [];
        } catch (err) {
            if (isMissingTableError(err)) return null;
            throw err;
        }
    },

    async getProfiles(userId) {
        const [artists, clients, studios] = await Promise.all([
            pgrest('artists_db').select(ARTIST_COLUMNS).eq('user_id', userId).limit(1).execute(),
            pgrest('clients_db').select(CLIENT_COLUMNS).eq('user_id', userId).limit(1).execute(),
            pgrest('studios').select(STUDIO_COLUMNS).eq('user_id', userId).limit(20).execute()
        ]);
        return {
            artist: Array.isArray(artists) && artists[0] ? artists[0] : null,
            client: Array.isArray(clients) && clients[0] ? clients[0] : null,
            studios: Array.isArray(studios) ? studios : []
        };
    },

    // Inserta la aceptación; si ya existe (user_id, version) no hace nada.
    // Devuelve { stored, missingTable }.
    async insertAcceptance({ userId, version, surface, userAgent = null }) {
        try {
            await pgrest.raw('terms_acceptances?on_conflict=user_id,version', {
                method: 'POST',
                prefer: 'resolution=ignore-duplicates,return=minimal',
                body: { user_id: userId, version, surface, user_agent: userAgent || null }
            });
            return { stored: true, missingTable: false };
        } catch (err) {
            if (isMissingTableError(err)) return { stored: false, missingTable: true };
            throw err;
        }
    },

    // Sella la aceptación en todos los perfiles que la persona tiene.
    // Devuelve { artist, client, studio } con la cantidad de filas selladas.
    async stampAllProfiles(userId, { version, acceptedAt }) {
        const patch = { terms_accepted_at: acceptedAt, terms_version: version };
        const out = {};
        for (const [role, table] of Object.entries(PROFILE_TABLES)) {
            const { result } = await writeWithTermsFallback(patch, (body) => (
                Object.keys(body).length
                    ? pgrest(table).eq('user_id', userId).select('user_id').patch(body)
                    : Promise.resolve([])
            ));
            out[role] = Array.isArray(result) ? result.length : 0;
        }
        return out;
    },

    // Barrido del bloqueo de reingreso: cuentas creadas desde `since` sin
    // aceptación ni revisión al día (RPC terms_reentry_pending, solo
    // service_role). [] si la migración todavía no está aplicada.
    async listPendingReentry(since, limit = 50) {
        try {
            const rows = await pgrest.raw('rpc/terms_reentry_pending', {
                method: 'POST',
                body: { p_since: since, p_limit: limit }
            });
            return Array.isArray(rows) ? rows : [];
        } catch (err) {
            if (isMissingTableError(err) || /terms_reentry_pending|PGRST202/.test(String(err && err.message))) return [];
            throw err;
        }
    },

    // Marca la cuenta como revisada (o bloqueada) por el barrido. El upsert
    // solo escribe estas tres columnas: no borra la excepción de soporte.
    async recordReentryCheck(userId, { blocked = false, checkedAt } = {}) {
        await pgrest.raw('terms_reentry_checks?on_conflict=user_id', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=minimal',
            body: { user_id: userId, blocked: Boolean(blocked), checked_at: checkedAt || new Date().toISOString() }
        });
        return true;
    },

    // Excepción de soporte del bloqueo de reingreso: la cuenta ya no se
    // bloquea por coincidir con las huellas de OTRA cuenta sancionada. La
    // escribe lib/sanciones-service (levantar un cierre o descartar una
    // alerta de reingreso). Devuelve { stored, missingTable }.
    async clearReentry(userId, { by = null, sanctionId = null, alertId = null, at } = {}) {
        const when = at || new Date().toISOString();
        try {
            await pgrest.raw('terms_reentry_checks?on_conflict=user_id', {
                method: 'POST',
                prefer: 'resolution=merge-duplicates,return=minimal',
                body: {
                    user_id: userId,
                    blocked: false,
                    checked_at: when,
                    cleared_at: when,
                    cleared_by: by || null,
                    cleared_sanction_id: sanctionId || null,
                    cleared_alert_id: alertId || null
                }
            });
            return { stored: true, missingTable: false };
        } catch (err) {
            if (isMissingReentrySchema(err)) return { stored: false, missingTable: true };
            throw err;
        }
    },

    // ¿La cuenta tiene la excepción de soporte? false si la migración todavía
    // no está aplicada.
    async isReentryCleared(userId) {
        try {
            const rows = await pgrest('terms_reentry_checks')
                .select('user_id,cleared_at')
                .eq('user_id', userId)
                .limit(1)
                .execute();
            return Boolean(Array.isArray(rows) && rows[0] && rows[0].cleared_at);
        } catch (err) {
            if (isMissingReentrySchema(err)) return false;
            throw err;
        }
    }
};

// terms_reentry_checks (o sus columnas cleared_*) todavía no existen.
function isMissingReentrySchema(err) {
    const text = String((err && (err.message || err)) || '');
    return /PGRST204|PGRST205|42P01|42703/.test(text)
        || (/terms_reentry_checks|cleared_/.test(text) && /(does not exist|could not find|schema cache)/i.test(text));
}

module.exports = { TerminosRepo, isMissingTableError, isMissingReentrySchema, PROFILE_TABLES };
