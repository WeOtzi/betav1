'use strict';

// ===========================================================================
// Resolucion de identidad por Bearer token contra Supabase Auth (servidor).
// ---------------------------------------------------------------------------
// Unifica el patron que estaba copiado en varios lugares:
//   - server.js `_getAuthUserFromBearer`
//   - los bloques inline identicos en POST /api/client/quotations/:id/hide y
//     .../complete
//   - la parte de auth de `verifyAdminCaller` (antes en lib/app-settings.js)
//
// No agrega dependencias: usa `fetch` contra /auth/v1/user con la service-role
// key como `apikey` y el token del usuario como Bearer (mismo patron de hoy).
// ===========================================================================

function authConfig() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }
    return { url, serviceRoleKey };
}

// Extrae el token "Bearer <jwt>" del header Authorization (o null).
function bearerToken(req) {
    const header = req && req.headers && (req.headers.authorization || req.headers.Authorization);
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
}

// Resuelve el usuario del token. Devuelve { id, email, raw } o null si el token
// es invalido/ausente. Nunca lanza por token invalido (igual que el original).
async function resolveBearerUser(req) {
    const token = bearerToken(req);
    if (!token) return null;
    const { url, serviceRoleKey } = authConfig();
    try {
        const res = await fetch(`${url}/auth/v1/user`, {
            headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data && data.id ? { id: data.id, email: data.email || null, raw: data } : null;
    } catch {
        return null;
    }
}

const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'isai@weotzi.com').trim().toLowerCase();

function isSuperadminEmail(email) {
    return Boolean(email) && typeof email === 'string' && email.toLowerCase() === SUPERADMIN_EMAIL;
}

// Verifica que el caller sea el superadmin. Mismo contrato que el antiguo
// lib/app-settings.verifyAdminCaller:
//   { ok: true, userId, email } | { ok: false, status: 401|403, error }
async function verifyAdminCaller(req) {
    const token = bearerToken(req);
    if (!token) return { ok: false, status: 401, error: 'Authentication required' };
    const user = await resolveBearerUser(req);
    if (!user) return { ok: false, status: 401, error: 'Invalid or expired session' };
    if (!isSuperadminEmail(user.email)) {
        return { ok: false, status: 403, error: 'Admin access requires the superadmin account' };
    }
    return { ok: true, userId: user.id, email: user.email };
}

module.exports = { resolveBearerUser, verifyAdminCaller, isSuperadminEmail, bearerToken };
