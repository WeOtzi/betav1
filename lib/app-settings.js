'use strict';

// Reads/writes rows in public.app_settings (key/value table for application
// configuration). The schema is owned by an earlier migration and shared
// with public/shared/js/config-manager.js. Columns of interest:
//   setting_key   TEXT UNIQUE
//   setting_value TEXT
//   setting_type  TEXT CHECK IN ('text','html','json','number','boolean')
//   is_public     BOOLEAN   -- false = secret; SELECT policy hides it from
//                              non-admin clients.
//
// All Supabase access uses the REST API + service-role key (same pattern as
// server.js). No @supabase/supabase-js dependency.

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // setting_key -> { value, expiresAt }

function supabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }
    return { url, serviceRoleKey };
}

function serviceHeaders() {
    const { serviceRoleKey } = supabaseConfig();
    return {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=representation'
    };
}

async function readSettingFromDb(key) {
    const { url } = supabaseConfig();
    const res = await fetch(
        `${url}/rest/v1/app_settings?setting_key=eq.${encodeURIComponent(key)}&select=setting_key,setting_value,updated_at,is_public`,
        { headers: serviceHeaders() }
    );
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`app_settings read failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const rows = await res.json();
    return rows && rows.length ? rows[0] : null;
}

// Returns the string value of a setting. Lookup order:
//   1. in-memory cache (5 min TTL)
//   2. app_settings.setting_value in Supabase
//   3. process.env[envFallback] if provided (handy for local dev)
// Returns null if nothing is found.
async function getSetting(key, options = {}) {
    const { envFallback = null, useCache = true } = options;

    if (useCache) {
        const hit = cache.get(key);
        if (hit && hit.expiresAt > Date.now()) {
            return hit.value;
        }
    }

    let value = null;
    try {
        const row = await readSettingFromDb(key);
        if (row && row.setting_value) value = row.setting_value;
    } catch (err) {
        console.warn(`[app-settings] DB read failed for "${key}":`, err.message);
        // fall through to env fallback
    }

    if (!value && envFallback && process.env[envFallback]) {
        value = process.env[envFallback];
    }

    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
}

// Returns metadata only (never the secret value). Safe to expose to the
// admin UI. `is_secret` is derived from `is_public=false` since the schema
// uses is_public as its visibility flag.
async function getSettingMeta(key) {
    const row = await readSettingFromDb(key);
    if (!row) return { configured: false };
    const value = row.setting_value || '';
    return {
        configured: Boolean(value),
        is_secret: row.is_public === false,
        updated_at: row.updated_at,
        last_chars: value ? value.slice(-6) : null
    };
}

// Upserts a setting value. The row's other columns (description, is_public,
// setting_type) are left as-is; if the row doesn't exist yet it is inserted
// with sensible defaults (text + private).
//
// Note: updatedBy is no longer persisted because the existing schema has no
// updated_by column. The existing updated_at default of now() handles
// timestamps; we set it explicitly to ensure cache invalidation works even
// if the DB clock is skewed.
async function setSetting(key, value, _updatedBy = null) {
    const { url } = supabaseConfig();
    const res = await fetch(
        `${url}/rest/v1/app_settings?on_conflict=setting_key`,
        {
            method: 'POST',
            headers: { ...serviceHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
                setting_key: key,
                setting_value: value,
                setting_type: 'text',
                is_public: false,
                updated_at: new Date().toISOString()
            })
        }
    );
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`app_settings write failed (${res.status}): ${body.slice(0, 200)}`);
    }
    cache.delete(key);
    return true;
}

function clearCache(key) {
    if (key) cache.delete(key);
    else cache.clear();
}

// ---------------------------------------------------------------------------
// Admin caller verification.
//
// Inspects the request's Authorization header, resolves the user via Supabase
// Auth, and grants admin access only to the hardcoded superadmin account.
// Returns:
//   { ok: true, userId, email } if the caller is the superadmin
//   { ok: false, status: 401|403, error } otherwise.

const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'isai@weotzi.com')
    .trim()
    .toLowerCase();

function isSuperadminEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return email.toLowerCase() === SUPERADMIN_EMAIL;
}

async function verifyAdminCaller(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { ok: false, status: 401, error: 'Authentication required' };
    }
    const token = authHeader.replace('Bearer ', '');
    const { url, serviceRoleKey } = supabaseConfig();

    try {
        const userRes = await fetch(`${url}/auth/v1/user`, {
            headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${token}` }
        });
        if (!userRes.ok) {
            return { ok: false, status: 401, error: 'Invalid or expired session' };
        }
        const userData = await userRes.json();
        const userId = userData && userData.id;
        const email = userData && userData.email;
        if (!userId) return { ok: false, status: 401, error: 'Invalid session' };
        if (!isSuperadminEmail(email)) {
            return { ok: false, status: 403, error: 'Admin access requires the superadmin account' };
        }
        return { ok: true, userId, email };
    } catch (err) {
        return { ok: false, status: 401, error: 'Auth check failed' };
    }
}

module.exports = {
    getSetting,
    getSettingMeta,
    setSetting,
    clearCache,
    verifyAdminCaller,
    isSuperadminEmail
};
