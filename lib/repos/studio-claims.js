'use strict';

// ===========================================================================
// Repositorio del registro de estudios (servidor) — capa PostgREST unificada.
// ---------------------------------------------------------------------------
// Frente estudio-registro (beta cerrada, nov 2026):
//   - Reclamos de fichas sin dueño (studio_claim_requests): cola del backoffice
//     y decisión con decide_studio_claim.
//   - Datos del estudio para el email de bienvenida.
//
// Reglas:
//   - El email del reclamante sale de auth.users (Admin API, service-role),
//     nunca de studios.email.
//   - Todo corre con service-role salvo decideClaimAsCaller, que viaja con el
//     JWT del agente de soporte para que la RPC SECURITY DEFINER vea su
//     auth.uid() y valide is_support_user(). La capa pgrest siempre firma con
//     la key del servidor: este único escape queda encapsulado aquí y solo para
//     RPC.
//   - Las tablas pueden faltar (migración pendiente): los llamadores usan
//     isMissingSchemaError para degradar.
// ===========================================================================

const { pgrest } = require('../postgrest');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_SCHEMA_CODES = new Set(['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01']);
const CLAIM_STUDIO_EMBED = 'studios(id,name,slug,city,country,user_id,is_active,logo_image)';
const CLAIM_SELECT = 'id,studio_id,user_id,status,evidence,contact_name,contact_phone,created_at,decided_at,decision_note,'
    + 'terms_accepted_at,terms_version,' + CLAIM_STUDIO_EMBED;
// Sin las columnas de términos (migración 20261115210000 pendiente).
const CLAIM_SELECT_LEGACY = 'id,studio_id,user_id,status,evidence,contact_name,contact_phone,created_at,decided_at,decision_note,'
    + CLAIM_STUDIO_EMBED;
const WELCOME_STUDIO_SELECT = 'id,user_id,name,slug,city,country,primary_location_id,verification_required';

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

// Código de error de Postgres/PostgREST dentro del Error de la capa.
function pgErrorCode(err) {
    if (!err) return null;
    if (err.code) return String(err.code);
    const match = /"code"\s*:\s*"([^"]{3,12})"/.exec(String(err.message || ''));
    return match ? match[1] : null;
}

// Mensaje legible de la base ("message":"…") para devolverlo al backoffice.
function pgErrorMessage(err) {
    if (!err) return '';
    if (err.dbMessage) return String(err.dbMessage);
    const match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(err.message || ''));
    if (!match) return '';
    try { return JSON.parse('"' + match[1] + '"'); } catch (_) { return match[1]; }
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

// Usuario de auth.users por id (Admin API). { id, email, email_confirmed_at, full_name } | null.
async function getAuthUserContact(userId, { fetchImpl = fetch } = {}) {
    if (!isUuid(userId)) return null;
    const { url, serviceRoleKey } = serviceAuthConfig();
    const res = await fetchImpl(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
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

// RPC con el JWT del caller (no service-role).
async function rpcAsCaller(fnName, args, accessToken, { fetchImpl = fetch } = {}) {
    if (!/^[a-z_][a-z0-9_]*$/.test(String(fnName || ''))) throw new Error('Invalid RPC name');
    if (!accessToken) {
        const err = new Error('Authentication required');
        err.status = 401;
        throw err;
    }
    const url = process.env.SUPABASE_URL;
    const apiKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !apiKey) throw new Error('SUPABASE_URL and an API key must be set in environment');
    const res = await fetchImpl(`${url}/rest/v1/rpc/${fnName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey, Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(args || {}),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
        const err = new Error(`PostgREST RPC ${fnName} failed (${res.status}): ${text.slice(0, 300)}`);
        err.status = res.status;
        let body = null;
        try { body = JSON.parse(text); } catch (_) { body = null; }
        if (body && body.code) err.code = String(body.code);
        if (body && body.message) err.dbMessage = String(body.message).slice(0, 300);
        throw err;
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
}

async function withContacts(rows, lookup = getAuthUserContact) {
    const list = Array.isArray(rows) ? rows : [];
    const ids = [...new Set(list.map((row) => row.user_id).filter(isUuid))];
    const contacts = new Map();
    await Promise.all(ids.map(async (uid) => {
        try { contacts.set(uid, await lookup(uid)); } catch (_) { contacts.set(uid, null); }
    }));
    return list.map((row) => ({ ...row, user: contacts.get(row.user_id) || null }));
}

async function selectClaims(build) {
    try {
        return await build(CLAIM_SELECT);
    } catch (err) {
        // 42703: sin las columnas de términos todavía.
        if (pgErrorCode(err) !== '42703' && !/terms_(accepted_at|version)/.test(String(err && err.message))) throw err;
        return build(CLAIM_SELECT_LEGACY);
    }
}

const StudioClaimsRepo = {
    // Reclamos pendientes, los más viejos primero, con estudio y reclamante.
    async listPendingClaims({ limit = 200 } = {}) {
        const rows = await selectClaims((select) => pgrest('studio_claim_requests')
            .select(select)
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(limit)
            .execute());
        return withContacts(rows);
    },

    // Un reclamo con estudio y reclamante (para el email de la decisión).
    async getClaimWithParties(id) {
        if (!isUuid(id)) return null;
        const rows = await selectClaims((select) => pgrest('studio_claim_requests')
            .select(select)
            .eq('id', id)
            .limit(1)
            .execute());
        const claim = Array.isArray(rows) ? rows[0] : null;
        if (!claim) return null;
        const [withUser] = await withContacts([claim]);
        return withUser;
    },

    decideClaimAsCaller(claimId, decision, note, accessToken, options) {
        return rpcAsCaller('decide_studio_claim', {
            p_claim_id: claimId,
            p_decision: decision,
            p_note: note == null || note === '' ? null : String(note),
        }, accessToken, options);
    },

    // Agente de soporte activo (support_users_db.user_id).
    async isActiveSupportUser(userId) {
        if (!isUuid(userId)) return false;
        const rows = await pgrest('support_users_db')
            .select('user_id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1)
            .execute();
        return Array.isArray(rows) && rows.length > 0;
    },

    // Estudio del dueño + sedes activas (email de bienvenida).
    async getOwnedStudioForWelcome(userId) {
        if (!isUuid(userId)) return null;
        const rows = await pgrest('studios')
            .select(WELCOME_STUDIO_SELECT)
            .eq('user_id', userId)
            .limit(1)
            .execute();
        const studio = Array.isArray(rows) ? rows[0] : null;
        if (!studio) return null;
        const locations = await pgrest('studio_locations')
            .select('id,label,city,country,is_primary,is_active')
            .eq('studio_id', studio.id)
            .order('is_primary', { ascending: false })
            .limit(30)
            .execute();
        return { ...studio, locations: Array.isArray(locations) ? locations : [] };
    },
};

module.exports = {
    StudioClaimsRepo,
    getAuthUserContact,
    rpcAsCaller,
    pgErrorCode,
    pgErrorMessage,
    isMissingSchemaError,
    isUuid,
};
