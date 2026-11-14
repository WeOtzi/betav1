'use strict';

// ===========================================================================
// Repositorio de la verificación de estudios (servidor) — capa PostgREST.
// ---------------------------------------------------------------------------
// Tablas: studios (columnas de verificación), studio_locations (lectura),
// studio_verification_requests (lectura; las escrituras van por RPC),
// studio_instagram_verifications (solo service-role) y support_users_db.
// RPC: decide_studio_verification_as y revoke_studio_verification_as
// (migración 20261115220000, solo service_role). Bucket privado
// `studio-verification` (URLs firmadas con lib/storage-sign.js).
//
// Reglas:
//   - El email de cualquier aviso sale SIEMPRE de auth.users (Admin API con
//     service-role), nunca de studios.email.
//   - Todo corre con service-role: la autorización (dueño, superadmin, agente
//     de soporte activo) la hacen los endpoints de lib/routes/verif-estudio.js
//     ANTES de llamar a estos métodos.
//   - Las tablas/columnas nuevas pueden no existir todavía (migración sin
//     aplicar): los llamadores usan `isMissingSchemaError` para degradar.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { signStorageObject } = require('../storage-sign');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENTS_BUCKET = 'studio-verification';
const SIGNED_TTL_SECONDS = 10 * 60;

// Columnas del estudio que ve el dueño en /api/studio/verification.
const STUDIO_VERIFICATION_SELECT = 'id,name,slug,user_id,instagram,is_verified,verification_status,'
    + 'verification_required,verification_reason,verified_at,instagram_verified_at,instagram_verified_handle';
// Estudio embebido en la cola (`user_id` solo para resolver el email del
// dueño en auth.users; no viaja en la respuesta).
const QUEUE_STUDIO_SELECT = 'id,name,slug,city,country,logo_image,instagram,user_id,'
    + 'instagram_verified_at,instagram_verified_handle,verification_reason,verification_status,is_verified,verified_at';
const BASE_REQUEST_COLUMNS = 'id,studio_id,requested_by,status,reasons,matched_studio_ids,evidence,'
    + 'contact_name,contact_phone,links,created_at,updated_at,decided_at,decided_by,decision_note';
// Columnas de 20261115220000 (documentos, sede y responsable).
const DOCUMENT_REQUEST_COLUMNS = 'legal_name,responsible_role,responsible_contact,location_id,documents';
const REQUEST_SELECT = `${BASE_REQUEST_COLUMNS},${DOCUMENT_REQUEST_COLUMNS}`;
// Estado para el dueño (sin requested_by / decided_by).
const OWNER_REQUEST_SELECT = 'id,status,reasons,evidence,contact_name,contact_phone,links,created_at,decided_at,'
    + `decision_note,${DOCUMENT_REQUEST_COLUMNS}`;
const OWNER_REQUEST_SELECT_LEGACY = 'id,status,reasons,evidence,contact_name,contact_phone,links,created_at,decided_at,decision_note';
const LOCATION_SELECT = 'id,studio_id,label,city,country,formatted_address,is_primary,is_active';
const STUDIO_IG_TABLE = 'studio_instagram_verifications';
// Nunca se lee code_hash para mostrarlo: solo para buscar por hash.
const STUDIO_IG_STATE_SELECT = 'id,ig_handle,status,email_sent_to,email_sent,created_at,expires_at,verified_at';
const STUDIO_IG_MATCH_SELECT = 'id,studio_id,ig_handle,status,attempts,expires_at,created_at,dm_sender_handle';
const LIST_LIMIT = 200;

// Códigos de "migración pendiente".
const MISSING_SCHEMA_CODES = new Set(['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01']);

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

// Código de error de Postgres/PostgREST del Error que lanza la capa (el cuerpo
// JSON de la respuesta queda recortado dentro de `message`).
function pgErrorCode(err) {
    if (!err) return null;
    const match = /"code"\s*:\s*"([^"]{3,12})"/.exec(String(err.message || ''));
    if (match) return match[1];
    return err.code ? String(err.code) : null;
}

// Mensaje legible de Postgres (`raise exception '…'`) o null.
function pgErrorMessage(err) {
    if (!err) return null;
    const match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(err.message || ''));
    if (!match) return null;
    try { return JSON.parse(`"${match[1]}"`); } catch (_) { return match[1]; }
}

function isMissingSchemaError(err) {
    const code = pgErrorCode(err);
    return Boolean(code && MISSING_SCHEMA_CODES.has(code));
}

function serviceAuthConfig() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }
    return { url, serviceRoleKey };
}

// Usuario de auth.users por id (Admin API): { id, email, email_confirmed_at,
// full_name } o null.
async function getAuthUserContact(userId) {
    if (!isUuid(userId)) return null;
    const { url, serviceRoleKey } = serviceAuthConfig();
    const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        const err = new Error(`Auth admin lookup failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    const body = await res.json().catch(() => null);
    const user = body && (body.user || body);
    if (!user || !user.id) return null;
    const meta = user.user_metadata || {};
    return {
        id: user.id,
        email: user.email ? String(user.email).trim().toLowerCase() : null,
        email_confirmed_at: user.email_confirmed_at || user.confirmed_at || null,
        full_name: meta.full_name || meta.display_name || null,
    };
}

function rpc(fnName, args) {
    return pgrest.raw(`rpc/${fnName}`, { method: 'POST', body: args || {} });
}

function arrayOrEmpty(value) {
    return Array.isArray(value) ? value : [];
}

// Documentos tal como los guarda submit_studio_verification: solo las claves
// conocidas y rutas bajo `<studio_id>/`.
function cleanDocuments(value, studioId) {
    return arrayOrEmpty(value)
        .filter((d) => d && typeof d === 'object' && typeof d.path === 'string'
            && (!studioId || d.path.startsWith(`${studioId}/`)) && !d.path.includes('..'))
        .map((d) => ({
            kind: d.kind === 'space' ? 'space' : 'representation',
            path: d.path,
            name: String(d.name || d.path.split('/').pop() || 'archivo').slice(0, 200),
            mime: d.mime ? String(d.mime).slice(0, 80) : null,
            size: Number.isFinite(Number(d.size)) && d.size !== null ? Number(d.size) : null,
            uploaded_at: d.uploaded_at || null,
        }));
}

const StudioVerificationRepo = {
    DOCUMENTS_BUCKET,
    getAuthUserContact,

    // ---- autorización -------------------------------------------------------

    // Agente de soporte activo (support_users_db) o null.
    async getActiveSupportUser(userId) {
        if (!isUuid(userId)) return null;
        const rows = await pgrest('support_users_db')
            .select('user_id,email,full_name,role,is_active')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1)
            .execute();
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
    },

    // ---- estudio del dueño --------------------------------------------------

    getOwnedStudioForVerification(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('studios').select(STUDIO_VERIFICATION_SELECT).eq('user_id', userId).limit(1).single().execute();
    },

    getStudioById(id, { select = 'id,name,slug,user_id,is_verified,verification_status' } = {}) {
        if (!isUuid(id)) return Promise.resolve(null);
        return pgrest('studios').select(select).eq('id', id).limit(1).single().execute();
    },

    // Sedes del estudio, la principal primero.
    async listStudioLocations(studioId) {
        if (!isUuid(studioId)) return [];
        const rows = await pgrest('studio_locations')
            .select(LOCATION_SELECT)
            .eq('studio_id', studioId)
            .order('sort_order', { ascending: true })
            .limit(50)
            .execute();
        return arrayOrEmpty(rows).slice().sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true));
    },

    // Última solicitud del estudio (cualquier estado) o null. Sin la migración
    // de documentos cae a las columnas de 20261102120000.
    async getLatestVerificationRequest(studioId) {
        if (!isUuid(studioId)) return null;
        const query = (select) => pgrest('studio_verification_requests')
            .select(select)
            .eq('studio_id', studioId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
            .execute();
        try {
            return await query(OWNER_REQUEST_SELECT);
        } catch (err) {
            if (pgErrorCode(err) !== '42703') throw err;
            return query(OWNER_REQUEST_SELECT_LEGACY);
        }
    },

    // Email de auth.users del dueño del estudio. null si no hay dueño o email.
    async getStudioOwnerContact(studioId) {
        const studio = await this.getStudioById(studioId, { select: 'id,name,slug,user_id' });
        if (!studio || !studio.user_id) return null;
        const user = await getAuthUserContact(studio.user_id);
        if (!user || !user.email) return null;
        return {
            studio_id: studio.id,
            studio_name: studio.name || '',
            studio_slug: studio.slug || '',
            user_id: studio.user_id,
            email: user.email,
            name: user.full_name || '',
        };
    },

    // ---- documentos ---------------------------------------------------------

    cleanDocuments,

    // URLs firmadas (10 min) de los documentos de una solicitud. Un archivo que
    // no se puede firmar vuelve con url null (la fila igual se muestra).
    async signDocuments(documents, studioId) {
        const list = cleanDocuments(documents, studioId);
        return Promise.all(list.map(async (doc) => {
            let url = null;
            try {
                url = await signStorageObject(DOCUMENTS_BUCKET, doc.path, { expiresIn: SIGNED_TTL_SECONDS });
            } catch (_) {
                url = null;
            }
            return { ...doc, url: typeof url === 'string' ? url : null };
        }));
    },

    // ---- cola de revisión ---------------------------------------------------

    // Solicitudes con el estudio, la sede, los estudios con los que coincidió,
    // el email del dueño (auth.users) y si hay un código de Instagram vigente.
    // `status`: pending | approved | rejected | cancelled | all. Pendientes:
    // las más viejas primero.
    async listVerificationRequests({ status = 'pending', now = new Date().toISOString() } = {}) {
        let query = pgrest('studio_verification_requests')
            .select(`${REQUEST_SELECT},studios(${QUEUE_STUDIO_SELECT})`);
        if (status && status !== 'all') query = query.eq('status', status);
        const rows = await query
            .order('created_at', { ascending: status === 'pending' })
            .limit(LIST_LIMIT)
            .execute();
        const list = arrayOrEmpty(rows);

        const matchedIds = [...new Set(list.flatMap((row) => arrayOrEmpty(row.matched_studio_ids)).filter(isUuid))];
        const matched = matchedIds.length
            ? await pgrest('studios').select('id,name,slug,city').in('id', matchedIds).execute()
            : [];
        const matchedById = new Map(arrayOrEmpty(matched).map((s) => [s.id, s]));

        const locationIds = [...new Set(list.map((row) => row.location_id).filter(isUuid))];
        const locations = locationIds.length
            ? await pgrest('studio_locations').select(LOCATION_SELECT).in('id', locationIds).execute()
            : [];
        const locationById = new Map(arrayOrEmpty(locations).map((l) => [l.id, l]));

        const studioIds = [...new Set(list.map((row) => row.studio_id).filter(isUuid))];
        const pendingIg = new Map();
        if (studioIds.length) {
            try {
                const codes = await pgrest(STUDIO_IG_TABLE)
                    .select('studio_id,ig_handle,expires_at')
                    .in('studio_id', studioIds)
                    .eq('status', 'pending')
                    .gt('expires_at', now)
                    .execute();
                for (const code of arrayOrEmpty(codes)) {
                    if (!pendingIg.has(code.studio_id)) pendingIg.set(code.studio_id, code);
                }
            } catch (err) {
                if (!isMissingSchemaError(err)) throw err;
            }
        }

        const ownerIds = [...new Set(list.map((row) => row.studios && row.studios.user_id).filter(isUuid))];
        const owners = new Map();
        await Promise.all(ownerIds.map(async (uid) => {
            try { owners.set(uid, await getAuthUserContact(uid)); } catch (_) { owners.set(uid, null); }
        }));

        return list.map((row) => {
            const { studios: embedded, ...request } = row;
            const { user_id: ownerId, ...studio } = embedded || {};
            const owner = ownerId ? owners.get(ownerId) || null : null;
            const code = pendingIg.get(row.studio_id) || null;
            const location = row.location_id ? locationById.get(row.location_id) || null : null;
            return {
                ...request,
                reasons: arrayOrEmpty(row.reasons),
                links: arrayOrEmpty(row.links),
                matched_studio_ids: arrayOrEmpty(row.matched_studio_ids),
                documents: cleanDocuments(row.documents, row.studio_id),
                studio: embedded ? studio : null,
                location: location ? {
                    id: location.id,
                    label: location.label || null,
                    city: location.city || null,
                    country: location.country || null,
                    formatted_address: location.formatted_address || null,
                    is_primary: location.is_primary === true,
                } : null,
                matched_studios: arrayOrEmpty(row.matched_studio_ids)
                    .map((id) => matchedById.get(id))
                    .filter(Boolean)
                    .map((s) => ({ id: s.id, name: s.name || null, slug: s.slug || null, city: s.city || null })),
                owner_email: owner && owner.email ? owner.email : null,
                owner_name: owner && owner.full_name ? owner.full_name : null,
                owner_email_confirmed: Boolean(owner && owner.email_confirmed_at),
                instagram_pending_code: code ? { handle: code.ig_handle || null, expires_at: code.expires_at || null } : null,
            };
        });
    },

    getVerificationRequestWithStudio(id) {
        if (!isUuid(id)) return Promise.resolve(null);
        return pgrest('studio_verification_requests')
            .select(`${REQUEST_SELECT},studios(${QUEUE_STUDIO_SELECT})`)
            .eq('id', id)
            .limit(1)
            .single()
            .execute();
    },

    // RPC solo service_role (20261115220000). El endpoint ya autorizó al actor.
    decideVerification(requestId, decision, note, actorId) {
        return rpc('decide_studio_verification_as', {
            p_request_id: requestId,
            p_decision: decision,
            p_note: note == null || note === '' ? null : String(note),
            p_actor: isUuid(actorId) ? actorId : null,
        });
    },

    revokeVerification(studioId, note, actorId) {
        return rpc('revoke_studio_verification_as', {
            p_studio_id: studioId,
            p_note: String(note || ''),
            p_actor: isUuid(actorId) ? actorId : null,
        });
    },

    // ---- códigos de Instagram del estudio (solo service-role) ---------------

    expireStaleStudioInstagramCodes(studioId, nowIso) {
        let query = pgrest(STUDIO_IG_TABLE).eq('status', 'pending').lt('expires_at', nowIso);
        if (studioId) query = query.eq('studio_id', studioId);
        return query.patch({ status: 'expired' }, { returning: false });
    },

    listStudioInstagramCodes(studioId, { limit = 10 } = {}) {
        return pgrest(STUDIO_IG_TABLE)
            .select(STUDIO_IG_STATE_SELECT)
            .eq('studio_id', studioId)
            .order('created_at', { ascending: false })
            .limit(limit)
            .execute();
    },

    // Un 409 (hash repetido en otro pendiente) lo reintenta el llamador.
    async insertStudioInstagramCode(payload) {
        const rows = await pgrest(STUDIO_IG_TABLE).insert(payload);
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
    },

    // Cancela los pendientes ANTERIORES a `row` (nunca uno más nuevo).
    cancelOlderStudioInstagramCodes(studioId, row, note) {
        let query = pgrest(STUDIO_IG_TABLE).eq('studio_id', studioId).eq('status', 'pending');
        query = row.created_at ? query.lt('created_at', row.created_at) : query.neq('id', row.id);
        return query.patch({ status: 'cancelled', note }, { returning: false });
    },

    markStudioInstagramEmailSent(id) {
        return pgrest(STUDIO_IG_TABLE).eq('id', id).patch({ email_sent: true }, { returning: false });
    },

    findStudioInstagramCodesByHash(hashes, { limit = 10 } = {}) {
        const list = arrayOrEmpty(hashes).filter(Boolean);
        if (!list.length) return Promise.resolve([]);
        return pgrest(STUDIO_IG_TABLE)
            .select(STUDIO_IG_MATCH_SELECT)
            .in('code_hash', list)
            .order('created_at', { ascending: false })
            .limit(limit)
            .execute();
    },

    // "Reclama" la fila solo si sigue en un estado confirmable.
    claimStudioInstagramCode(id, update, fromStatuses = ['pending']) {
        return pgrest(STUDIO_IG_TABLE).eq('id', id).in('status', fromStatuses).patch(update);
    },

    revertStudioInstagramCode(id, status) {
        return pgrest(STUDIO_IG_TABLE).eq('id', id).eq('status', 'verified').patch({
            status, verified_at: null, verified_via: null, verified_by: null,
        }, { returning: false });
    },

    registerStudioInstagramMismatch(id, patch) {
        return pgrest(STUDIO_IG_TABLE).eq('id', id).eq('status', 'pending').patch(patch, { returning: false });
    },

    cancelOtherStudioInstagramCodes(studioId, exceptId, note) {
        let query = pgrest(STUDIO_IG_TABLE).eq('studio_id', studioId).eq('status', 'pending');
        if (exceptId) query = query.neq('id', exceptId);
        return query.patch({ status: 'cancelled', note }, { returning: false });
    },

    verifyPendingStudioInstagramCodesBySupport(studioId, handle, { verifiedAt, verifiedBy, note } = {}) {
        return pgrest(STUDIO_IG_TABLE).eq('studio_id', studioId).eq('status', 'pending').eq('ig_handle', handle).patch({
            status: 'verified',
            verified_at: verifiedAt,
            verified_via: 'support',
            verified_by: verifiedBy || null,
            note: note || null,
        });
    },

    // Solo las dos columnas de Instagram (el guard admite service-role).
    setStudioInstagramVerified(studioId, handle, verifiedAt) {
        return pgrest('studios').eq('id', studioId)
            .patch({ instagram_verified_at: verifiedAt, instagram_verified_handle: handle }, { returning: false });
    },
};

module.exports = {
    StudioVerificationRepo,
    getAuthUserContact,
    pgErrorCode,
    pgErrorMessage,
    isMissingSchemaError,
    cleanDocuments,
    DOCUMENTS_BUCKET,
};
