'use strict';

// ===========================================================================
// Repositorio de Estudios (servidor) — sobre la capa PostgREST unificada.
// ---------------------------------------------------------------------------
// Tablas: studios, studio_locations (lectura), studio_artist_memberships,
// studio_membership_request_details, studio_contracts, studio_bookings,
// studio_claim_requests, studio_spot_applications (RPC),
// studio_verification_requests (RPC decide_studio_verification),
// studio_instagram_verifications (solo service-role) y artists_db
// (nombre/username del artista y la etiqueta `estudios`).
//
// Metodos con nombre para los avisos de la plataforma de estudios
// (/api/studio/notify, /api/artist/studio-notify), el registro de artistas
// (membresia `requested`) y el backoffice (reclamos de estudios).
//
// Reglas (docs/plans/2026-10-30-estudios-plataforma.md, Reglas transversales):
//   - El email de destino de cualquier aviso sale SIEMPRE de auth.users (Admin
//     API con service-role). Nunca de studios.email, contact_email ni
//     client_email. Si el estudio no tiene dueño, no hay destinatario.
//   - Todo corre con service-role (salta RLS): la autorizacion (dueño, artista
//     de la fila, soporte) la hacen los endpoints ANTES de llamar a estos
//     metodos. La excepcion son las RPC "as caller" (`*AsCaller`), que viajan
//     con el JWT del usuario para que la RPC valide `is_support_user()`.
//   - Las tablas nuevas pueden no existir todavia (migraciones sin aplicar):
//     los llamadores usan `isMissingSchemaError` para degradar.
// ===========================================================================

const { pgrest } = require('../postgrest');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Partes embebidas en los avisos. `user_id` del estudio = dueño (o null).
const STUDIO_PARTY_SELECT = 'id,name,slug,user_id';
const ARTIST_PARTY_SELECT = 'user_id,name,username';

// Estados "abiertos" de una membresía (mismo conjunto que el índice parcial
// `studio_memberships_one_open_per_role` de M1).
const OPEN_MEMBERSHIP_STATUSES = ['requested', 'pending_invite', 'pending_acceptance', 'active', 'paused'];

// Verificación de estudios (migración 20261102120000_studio_verification).
// Columnas del estudio que ve el dueño en /api/studio/verification.
const STUDIO_VERIFICATION_SELECT = 'id,name,slug,user_id,instagram,is_verified,verification_status,'
    + 'verification_required,verification_reason,verified_at,instagram_verified_at,instagram_verified_handle';
// Estudio embebido en la cola del backoffice (`user_id` solo para resolver el
// email del dueño en auth.users; no viaja en la respuesta).
const VERIFICATION_QUEUE_STUDIO_SELECT = 'id,name,slug,city,country,logo_image,instagram,user_id,'
    + 'instagram_verified_at,instagram_verified_handle,verification_reason,verification_status,is_verified';
const VERIFICATION_REQUEST_SELECT = 'id,studio_id,requested_by,status,reasons,matched_studio_ids,evidence,'
    + 'contact_name,contact_phone,links,created_at,updated_at,decided_at,decided_by,decision_note';
// Estado para el dueño (sin requested_by / decided_by).
const OWNER_REQUEST_SELECT = 'id,status,reasons,evidence,contact_name,contact_phone,links,created_at,decided_at,decision_note';
const STUDIO_IG_TABLE = 'studio_instagram_verifications';
// Nunca se lee code_hash para mostrarlo: solo para buscar por hash.
const STUDIO_IG_STATE_SELECT = 'id,ig_handle,status,email_sent_to,email_sent,created_at,expires_at,verified_at';
const STUDIO_IG_MATCH_SELECT = 'id,studio_id,ig_handle,status,attempts,expires_at,created_at,dm_sender_handle';
const VERIFICATION_LIST_LIMIT = 200;

// Codigos de "migracion pendiente" (Reglas transversales §5).
const MISSING_SCHEMA_CODES = new Set(['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01']);

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

// Extrae el codigo de error de Postgres/PostgREST del Error que lanza la capa
// (el cuerpo JSON de la respuesta queda recortado dentro de `message`).
function pgErrorCode(err) {
    if (!err) return null;
    const match = /"code"\s*:\s*"([^"]{3,12})"/.exec(String(err.message || ''));
    if (match) return match[1];
    return err.code ? String(err.code) : null;
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

// Lee un usuario de auth.users por id (Admin API). Devuelve
// { id, email, email_confirmed_at, full_name } o null si no existe.
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

// RPC con el JWT del caller (no service-role): la funcion SECURITY DEFINER ve
// `auth.uid()` del usuario y aplica sus propios chequeos (soporte, dueño).
// La capa pgrest siempre firma con la key del servidor, por eso este escape
// queda encapsulado aca y solo para RPCs.
async function rpcAsCaller(fnName, args, accessToken) {
    if (!/^[a-z_][a-z0-9_]*$/.test(String(fnName || ''))) throw new Error('Invalid RPC name');
    if (!accessToken) {
        const err = new Error('Authentication required');
        err.status = 401;
        throw err;
    }
    const url = process.env.SUPABASE_URL;
    const apiKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !apiKey) throw new Error('SUPABASE_URL and an API key must be set in environment');
    const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(args || {}),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
        const err = new Error(`PostgREST RPC ${fnName} failed (${res.status}): ${text.slice(0, 300)}`);
        err.status = res.status;
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = null; }
        if (parsed && parsed.code) err.code = String(parsed.code);
        if (parsed && parsed.message) err.dbMessage = String(parsed.message);
        throw err;
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
}

const StudiosRepo = {
    // ---- identidad / destinatarios -----------------------------------------

    // Email de auth.users del dueño del estudio (studios.user_id). null si el
    // estudio no existe, no tiene dueño o el usuario no tiene email.
    async getStudioOwnerContact(studioId) {
        if (!isUuid(studioId)) return null;
        const studio = await pgrest('studios')
            .select('id,name,slug,user_id')
            .eq('id', studioId)
            .limit(1)
            .single()
            .execute();
        if (!studio || !studio.user_id) return null;
        const user = await getAuthUserContact(studio.user_id);
        if (!user || !user.email) return null;
        return {
            studio_id: studio.id,
            studio_name: studio.name || '',
            studio_slug: studio.slug || '',
            user_id: studio.user_id,
            email: user.email,
            name: user.full_name || studio.name || '',
        };
    },

    // Email de auth.users del artista + nombre/username de artists_db.
    async getArtistContact(userId) {
        const user = await getAuthUserContact(userId);
        if (!user || !user.email) return null;
        let artist = null;
        try {
            artist = await pgrest('artists_db')
                .select(ARTIST_PARTY_SELECT)
                .eq('user_id', userId)
                .limit(1)
                .single()
                .execute();
        } catch (_) {
            artist = null; // el nombre es cosmetico: el aviso sale igual
        }
        return {
            user_id: user.id,
            email: user.email,
            name: (artist && artist.name) || user.full_name || '',
            username: (artist && artist.username) || '',
        };
    },

    // Usuario de auth.users (id/email/confirmacion). Reexpuesto para el
    // backoffice y para el reset de contraseña de Supplies.
    getAuthUserContact,

    // ---- filas con sus partes (avisos) ------------------------------------

    getSpotApplicationWithParties(id) {
        return pgrest('studio_spot_applications')
            .select(
                `id,status,artist_user_id,artists_db(${ARTIST_PARTY_SELECT}),`
                + `studio_spots(id,title,kind,studios(${STUDIO_PARTY_SELECT}))`
            )
            .eq('id', id)
            .limit(1)
            .single()
            .execute();
    },

    getMembershipWithParties(id) {
        return pgrest('studio_artist_memberships')
            .select(`*,studios(${STUDIO_PARTY_SELECT}),artists_db(${ARTIST_PARTY_SELECT})`)
            .eq('id', id)
            .limit(1)
            .single()
            .execute();
    },

    getContractWithParties(id) {
        return pgrest('studio_contracts')
            .select(`*,studios(${STUDIO_PARTY_SELECT}),artists_db(${ARTIST_PARTY_SELECT})`)
            .eq('id', id)
            .limit(1)
            .single()
            .execute();
    },

    getBookingWithParties(id) {
        return pgrest('studio_bookings')
            .select(
                `*,studios(${STUDIO_PARTY_SELECT}),artists_db(${ARTIST_PARTY_SELECT}),`
                + 'studio_locations(id,label,city,formatted_address)'
            )
            .eq('id', id)
            .limit(1)
            .single()
            .execute();
    },

    // Reclamo + estudio + usuario reclamante (email de auth.users).
    async getClaimWithParties(id) {
        const claim = await pgrest('studio_claim_requests')
            .select('*,studios(id,name,slug,city,country,user_id,is_active,logo_image)')
            .eq('id', id)
            .limit(1)
            .single()
            .execute();
        if (!claim) return null;
        let user = null;
        try { user = await getAuthUserContact(claim.user_id); } catch (_) { user = null; }
        return { ...claim, user };
    },

    // Reclamos `pending` (los mas viejos primero) con estudio y usuario.
    async listPendingClaims() {
        const rows = await pgrest('studio_claim_requests')
            .select('*,studios(id,name,slug,city,country,user_id,is_active,logo_image)')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(200)
            .execute();
        const list = Array.isArray(rows) ? rows : [];
        const userIds = [...new Set(list.map((row) => row.user_id).filter(isUuid))];
        const contacts = new Map();
        await Promise.all(userIds.map(async (uid) => {
            try { contacts.set(uid, await getAuthUserContact(uid)); } catch (_) { contacts.set(uid, null); }
        }));
        return list.map((row) => ({ ...row, user: contacts.get(row.user_id) || null }));
    },

    // ---- backoffice (RPC con el JWT del caller) ---------------------------

    decideClaimAsCaller(claimId, decision, note, accessToken) {
        return rpcAsCaller('decide_studio_claim', {
            p_claim_id: claimId,
            p_decision: decision,
            p_note: note == null || note === '' ? null : String(note),
        }, accessToken);
    },

    decideSpotApplicationAsCaller(applicationId, status, accessToken) {
        return rpcAsCaller('decide_studio_spot_application', {
            p_application_id: applicationId,
            p_status: status,
        }, accessToken);
    },

    // ---- estudios ----------------------------------------------------------

    getStudioById(id, { select = 'id,name,user_id,primary_location_id,is_active' } = {}) {
        if (!isUuid(id)) return Promise.resolve(null);
        return pgrest('studios').select(select).eq('id', id).limit(1).single().execute();
    },

    findStudioByNormalizedName(normalizedName, { select = 'id,name,user_id' } = {}) {
        return pgrest('studios').select(select).eq('normalized_name', normalizedName).limit(1).single().execute();
    },

    // Estudio propio del usuario (deteccion de rol del chat de soporte).
    getOwnedStudioByUserId(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('studios').select('id,name,slug').eq('user_id', userId).limit(1).single().execute();
    },

    // ---- verificacion del estudio (dueño) ----------------------------------

    // Estudio propio del usuario con las columnas de verificación.
    getOwnedStudioForVerification(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('studios').select(STUDIO_VERIFICATION_SELECT).eq('user_id', userId).limit(1).single().execute();
    },

    // Última solicitud de verificación del estudio (cualquier estado) o null.
    getLatestVerificationRequest(studioId) {
        if (!isUuid(studioId)) return Promise.resolve(null);
        return pgrest('studio_verification_requests')
            .select(OWNER_REQUEST_SELECT)
            .eq('studio_id', studioId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
            .execute();
    },

    // ---- codigos de Instagram del estudio (solo service-role) --------------

    // Vencimiento perezoso: pendientes vencidos → 'expired' (de un estudio o todos).
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
        const list = (Array.isArray(hashes) ? hashes : []).filter(Boolean);
        if (!list.length) return Promise.resolve([]);
        return pgrest(STUDIO_IG_TABLE)
            .select(STUDIO_IG_MATCH_SELECT)
            .in('code_hash', list)
            .order('created_at', { ascending: false })
            .limit(limit)
            .execute();
    },

    // "Reclama" la fila solo si sigue en un estado confirmable. Devuelve las
    // filas actualizadas (vacío = otra entrega ya la procesó).
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

    // Soporte confirma el Instagram sin DM: los pendientes de ese usuario pasan
    // a verified (verified_via 'support'). Devuelve las filas actualizadas.
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

    // ---- verificacion del estudio (backoffice) -----------------------------

    // Cola del backoffice: solicitudes con el estudio, los estudios con los que
    // coincidió, el email del dueño (auth.users, nunca studios.email) y si hay
    // un código de Instagram pendiente. `status`: pending | approved |
    // rejected | cancelled | all. Pendientes: las más viejas primero.
    async listVerificationRequests({ status = 'pending', now = new Date().toISOString() } = {}) {
        let query = pgrest('studio_verification_requests')
            .select(`${VERIFICATION_REQUEST_SELECT},studios(${VERIFICATION_QUEUE_STUDIO_SELECT})`);
        if (status && status !== 'all') query = query.eq('status', status);
        const rows = await query
            .order('created_at', { ascending: status === 'pending' })
            .limit(VERIFICATION_LIST_LIMIT)
            .execute();
        const list = Array.isArray(rows) ? rows : [];

        const matchedIds = [...new Set(list.flatMap((row) => (Array.isArray(row.matched_studio_ids) ? row.matched_studio_ids : [])).filter(isUuid))];
        const matched = matchedIds.length
            ? await pgrest('studios').select('id,name,slug,city').in('id', matchedIds).execute()
            : [];
        const matchedById = new Map((Array.isArray(matched) ? matched : []).map((s) => [s.id, s]));

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
                for (const code of Array.isArray(codes) ? codes : []) {
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
            return {
                ...request,
                reasons: Array.isArray(row.reasons) ? row.reasons : [],
                links: Array.isArray(row.links) ? row.links : [],
                matched_studio_ids: Array.isArray(row.matched_studio_ids) ? row.matched_studio_ids : [],
                studio: embedded ? studio : null,
                matched_studios: (Array.isArray(row.matched_studio_ids) ? row.matched_studio_ids : [])
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

    // Solicitud + estudio (aviso de la decisión y confirmación del Instagram).
    getVerificationRequestWithStudio(id) {
        if (!isUuid(id)) return Promise.resolve(null);
        return pgrest('studio_verification_requests')
            .select(`${VERIFICATION_REQUEST_SELECT},studios(${VERIFICATION_QUEUE_STUDIO_SELECT})`)
            .eq('id', id)
            .limit(1)
            .single()
            .execute();
    },

    decideVerificationAsCaller(requestId, decision, note, accessToken) {
        return rpcAsCaller('decide_studio_verification', {
            p_request_id: requestId,
            p_decision: decision,
            p_note: note == null || note === '' ? null : String(note),
        }, accessToken);
    },

    // ---- membresias (registro de artista) ---------------------------------

    // Fila abierta del par estudio↔artista (cualquier rol), la mas reciente.
    findOpenMembership(studioId, artistUserId) {
        return pgrest('studio_artist_memberships')
            .select('id,status,role,location_id,studio_id,artist_user_id')
            .eq('studio_id', studioId)
            .eq('artist_user_id', artistUserId)
            .in('status', OPEN_MEMBERSHIP_STATUSES)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
            .execute();
    },

    // POST simple (sin on_conflict): un 23505 lo resuelve el llamador.
    async insertMembership(payload) {
        const rows = await pgrest('studio_artist_memberships').insert(payload);
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
    },

    insertMembershipRequestDetails(payload) {
        return pgrest('studio_membership_request_details').insert(payload, { returning: false });
    },

    // Etiqueta "tatúa en …" del artista. Solo se escribe cuando la membresía
    // queda activa (fallback legacy); con `requested` no se toca.
    setArtistStudioLabel(artistUserId, label) {
        return pgrest('artists_db').eq('user_id', artistUserId).patch({ estudios: label }, { returning: false });
    },
};

module.exports = {
    StudiosRepo,
    getAuthUserContact,
    rpcAsCaller,
    pgErrorCode,
    isMissingSchemaError,
    OPEN_MEMBERSHIP_STATUSES,
};
