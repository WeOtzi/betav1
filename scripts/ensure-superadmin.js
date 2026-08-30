'use strict';

require('dotenv').config();

const SUPERADMIN_EMAIL = 'isai@weotzi.com';
const SUPERADMIN_NAME = 'Soporte Superadmin';
const SUPERADMIN_SUPPORT_ROLE = 'admin';

function getConfig() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const superadminPassword = process.env.SUPERADMIN_PASSWORD || null;

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
        throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required');
    }

    return { supabaseUrl, serviceRoleKey, anonKey, superadminPassword };
}

async function parseResponse(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch (_) {
        return text;
    }
}

async function request(label, url, options) {
    const res = await fetch(url, options);
    const body = await parseResponse(res);
    if (!res.ok) {
        const error = new Error(`${label} failed (${res.status}): ${JSON.stringify(body)}`);
        error.status = res.status;
        error.body = body;
        throw error;
    }
    return body;
}

function adminHeaders(serviceRoleKey) {
    return {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'
    };
}

function restHeaders(serviceRoleKey, prefer = null) {
    const headers = adminHeaders(serviceRoleKey);
    if (prefer) headers.Prefer = prefer;
    return headers;
}

function buildSuperadminArtistCleanupFilter(userId) {
    return [
        `user_id.eq.${userId}`,
        `email.eq.${SUPERADMIN_EMAIL}`
    ].join(',');
}

function superadminPayload(password, extra = {}) {
    const payload = {
        email: SUPERADMIN_EMAIL,
        email_confirm: true,
        user_metadata: {
            full_name: SUPERADMIN_NAME,
            role: 'superadmin',
            email_verified: true
        },
        app_metadata: {
            role: 'superadmin'
        },
        ...extra,
    };
    if (password) payload.password = password;
    return payload;
}

function normalizeAuthUser(response) {
    if (response && response.user && response.user.id) return response.user;
    return response;
}

async function resolveExistingUserId({ supabaseUrl, serviceRoleKey }) {
    try {
        const response = await request(
            'resolve existing superadmin',
            `${supabaseUrl}/auth/v1/admin/generate_link`,
            {
                method: 'POST',
                headers: adminHeaders(serviceRoleKey),
                body: JSON.stringify({ type: 'recovery', email: SUPERADMIN_EMAIL })
            }
        );
        const user = normalizeAuthUser(response);
        return user && user.id ? user.id : null;
    } catch (err) {
        if (err.status === 404 || err.body?.error_code === 'user_not_found') return null;
        throw err;
    }
}

async function removeSuperadminFromArtists({ supabaseUrl, serviceRoleKey }, userId) {
    const filter = encodeURIComponent(`(${buildSuperadminArtistCleanupFilter(userId)})`);
    await request(
        'remove superadmin from artists',
        `${supabaseUrl}/rest/v1/artists_db?or=${filter}`,
        {
            method: 'DELETE',
            headers: restHeaders(serviceRoleKey, 'return=representation')
        }
    );
    return true;
}

async function ensureSuperadminSupportUser({ supabaseUrl, serviceRoleKey }, userId) {
    await request(
        'ensure superadmin support user',
        `${supabaseUrl}/rest/v1/support_users_db?on_conflict=user_id`,
        {
            method: 'POST',
            headers: restHeaders(serviceRoleKey, 'resolution=merge-duplicates,return=representation'),
            body: JSON.stringify({
                user_id: userId,
                email: SUPERADMIN_EMAIL,
                full_name: SUPERADMIN_NAME,
                role: SUPERADMIN_SUPPORT_ROLE,
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
        }
    );
    return true;
}

async function ensureSuperadminAuth(config) {
    const headers = adminHeaders(config.serviceRoleKey);
    const existingUserId = await resolveExistingUserId(config);

    let user;
    let action;

    if (existingUserId) {
        user = await request(
            'update superadmin',
            `${config.supabaseUrl}/auth/v1/admin/users/${existingUserId}`,
            {
                method: 'PUT',
                headers,
                body: JSON.stringify(superadminPayload(config.superadminPassword, { ban_duration: 'none' }))
            }
        );
        action = 'updated';
    } else {
        if (!config.superadminPassword) {
            throw new Error('SUPERADMIN_PASSWORD is required to create the superadmin account');
        }
        user = await request(
            'create superadmin',
            `${config.supabaseUrl}/auth/v1/admin/users`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify(superadminPayload(config.superadminPassword))
            }
        );
        action = 'created';
    }

    user = normalizeAuthUser(user);
    if (!user || !user.id) {
        throw new Error('Supabase Auth did not return a superadmin user id');
    }

    return { action, user };
}

async function verifySuperadminPassword(config) {
    if (!config.superadminPassword) return null;
    return request(
        'verify superadmin password',
        `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
        {
            method: 'POST',
            headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: SUPERADMIN_EMAIL,
                password: config.superadminPassword
            })
        }
    );
}

async function ensureSuperadmin() {
    const config = getConfig();
    const initialAuth = await ensureSuperadminAuth(config);

    // artists_db has a legacy trigger that deletes auth.users on artist delete.
    // Clean it first, then assert the superadmin Auth account again.
    const artistRowsRemoved = await removeSuperadminFromArtists(config, initialAuth.user.id);
    const finalAuth = await ensureSuperadminAuth(config);
    const supportUserEnsured = await ensureSuperadminSupportUser(config, finalAuth.user.id);
    const login = await verifySuperadminPassword(config);

    return {
        action: finalAuth.action,
        userId: finalAuth.user.id,
        email: finalAuth.user.email,
        role: finalAuth.user.app_metadata && finalAuth.user.app_metadata.role,
        emailConfirmed: Boolean(finalAuth.user.email_confirmed_at || finalAuth.user.confirmed_at),
        verifiedLogin: login ? Boolean(login.access_token) : null,
        artistRowsRemoved,
        supportUserEnsured
    };
}

if (require.main === module) {
    ensureSuperadmin()
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(err => {
            console.error(err.message);
            process.exitCode = 1;
        });
}

module.exports = {
    ensureSuperadmin,
    SUPERADMIN_EMAIL,
    SUPERADMIN_SUPPORT_ROLE
};
