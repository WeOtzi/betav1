'use strict';

// ===========================================================================
// Admin API de Supabase Auth para sanciones (servidor, service-role).
// ---------------------------------------------------------------------------
// Sin supabase-js: PUT a /auth/v1/admin/users/:id con `ban_duration`, igual
// que el resto del servidor habla con GoTrue (mismo SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY que lib/auth/supabase-auth.js).
//
//   banAuthUser(userId, 'permanent' | horas)  → ban_duration '876000h' (~100 años) o '<n>h'
//   unbanAuthUser(userId)                     → ban_duration 'none'
//   revokeSessions(userId)                    → rpc revoke_user_sessions (borra
//                                               auth.sessions; los refresh tokens caen
//                                               en cascada). La función la crea la
//                                               migración 20261118130000 y solo la
//                                               ejecuta service_role.
//
// Un JWT de acceso emitido antes del baneo sigue siendo válido en PostgREST
// hasta que vence (≤ 1 h); por eso se revocan las sesiones: /auth/v1/user deja
// de resolverlo y las rutas /api/* lo rechazan enseguida.
//
// Configuración inyectable para tests: setConfig({ url, serviceRoleKey, fetch, rpc }).
// Nunca lanza con el token ni el correo en el mensaje.
// ===========================================================================

const { pgrest } = require('../postgrest');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMANENT_DURATION = '876000h';
const MAX_HOURS = 876000;
const REVOKE_RPC = 'revoke_user_sessions';

let overrides = {};

function setConfig(next) {
    const previous = overrides;
    overrides = { ...(next || {}) };
    return () => { overrides = previous; };
}

function config() {
    const url = overrides.url || process.env.SUPABASE_URL;
    const serviceRoleKey = overrides.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }
    return { url: String(url).replace(/\/+$/, ''), serviceRoleKey, fetch: overrides.fetch || globalThis.fetch };
}

function adminHeaders(serviceRoleKey) {
    return { 'Content-Type': 'application/json', apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
}

function assertUuid(userId) {
    if (!UUID_RE.test(String(userId || ''))) {
        const err = new Error('ID de usuario inválido.');
        err.status = 400;
        throw err;
    }
}

// 'permanent' | null → 876000h; número de horas (redondeo hacia arriba, mínimo 1).
function banDuration(duration) {
    if (duration === 'permanent' || duration == null) return PERMANENT_DURATION;
    const hours = Math.ceil(Number(duration));
    if (!Number.isFinite(hours) || hours < 1) {
        const err = new Error('Duración de bloqueo inválida.');
        err.status = 400;
        throw err;
    }
    return `${Math.min(hours, MAX_HOURS)}h`;
}

async function putUser(userId, body) {
    assertUuid(userId);
    const { url, serviceRoleKey, fetch } = config();
    const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: adminHeaders(serviceRoleKey),
        body: JSON.stringify(body)
    });
    if (res.status === 404) return { ok: false, status: 404, notFound: true };
    if (!res.ok) {
        const err = new Error(`Auth admin update failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    const json = await res.json().catch(() => null);
    const user = json && (json.user || json);
    return { ok: true, status: res.status, banned_until: (user && user.banned_until) || null };
}

// Datos de contacto de auth.users (correo y teléfono son los que valen para
// las huellas: no se pueden editar desde el perfil). null si no existe.
async function getAuthUser(userId) {
    assertUuid(userId);
    const { url, serviceRoleKey, fetch } = config();
    const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        headers: adminHeaders(serviceRoleKey)
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        const err = new Error(`Auth admin lookup failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    const json = await res.json().catch(() => null);
    const user = json && (json.user || json);
    if (!user || !user.id) return null;
    const meta = user.user_metadata || {};
    return {
        id: user.id,
        email: user.email ? String(user.email).trim().toLowerCase() : null,
        phone: user.phone ? String(user.phone).trim() : null,
        full_name: meta.full_name || meta.display_name || meta.name || null,
        banned_until: user.banned_until || null
    };
}

// Bloquea el ingreso. { ok, ban_duration, banned_until } | { ok:false, notFound }
async function banAuthUser(userId, duration) {
    const ban_duration = banDuration(duration);
    const out = await putUser(userId, { ban_duration });
    return { ...out, ban_duration };
}

async function unbanAuthUser(userId) {
    const out = await putUser(userId, { ban_duration: 'none' });
    return { ...out, ban_duration: 'none' };
}

// Cierra todas las sesiones del usuario. { ok, revoked } (revoked: filas borradas o null).
async function revokeSessions(userId) {
    assertUuid(userId);
    // Capa PostgREST unificada (service-role); `rpc` inyectable en los tests.
    const rpc = overrides.rpc || ((fn, body) => pgrest.raw(`rpc/${fn}`, { method: 'POST', body }));
    const revoked = await rpc(REVOKE_RPC, { p_user: userId });
    return { ok: true, revoked: revoked != null && Number.isFinite(Number(revoked)) ? Number(revoked) : null };
}

module.exports = {
    getAuthUser,
    banAuthUser,
    unbanAuthUser,
    revokeSessions,
    setConfig,
    PERMANENT_DURATION,
    _internal: { banDuration, config, REVOKE_RPC }
};
