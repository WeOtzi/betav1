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
// El acceso a datos pasa por la capa PostgREST unificada (lib/postgrest.js,
// service-role). La verificacion de admin se delega en lib/auth/supabase-auth.

const { pgrest } = require('./postgrest');
const { verifyAdminCaller, isSuperadminEmail } = require('./auth/supabase-auth');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // setting_key -> { value, expiresAt }

async function readSettingFromDb(key) {
    const rows = await pgrest('app_settings')
        .select('setting_key,setting_value,updated_at,is_public')
        .eq('setting_key', key)
        .execute();
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
async function setSetting(key, value, _updatedBy = null) {
    await pgrest('app_settings').upsert(
        {
            setting_key: key,
            setting_value: value,
            setting_type: 'text',
            is_public: false,
            updated_at: new Date().toISOString()
        },
        { onConflict: 'setting_key', returning: false }
    );
    cache.delete(key);
    return true;
}

function clearCache(key) {
    if (key) cache.delete(key);
    else cache.clear();
}

module.exports = {
    getSetting,
    getSettingMeta,
    setSetting,
    clearCache,
    // Re-exportados desde lib/auth/supabase-auth para conservar el contrato
    // historico `appSettings.verifyAdminCaller` / `appSettings.isSuperadminEmail`.
    verifyAdminCaller,
    isSuperadminEmail
};
