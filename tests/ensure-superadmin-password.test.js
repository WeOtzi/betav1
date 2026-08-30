'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'scripts', 'ensure-superadmin.js');
const userId = '4e815477-ef3c-4c9f-8825-c54fd0e8b8f7';
const email = 'isai@weotzi.com';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

async function runEnsureSuperadmin(superadminPassword) {
    const previousEnv = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPERADMIN_PASSWORD: process.env.SUPERADMIN_PASSWORD
    };
    const previousFetch = global.fetch;
    const calls = [];

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    process.env.SUPABASE_ANON_KEY = 'anon-test-key';
    if (superadminPassword === undefined) {
        delete process.env.SUPERADMIN_PASSWORD;
    } else {
        process.env.SUPERADMIN_PASSWORD = superadminPassword;
    }

    global.fetch = async (url, options = {}) => {
        const call = {
            url: String(url),
            method: options.method || 'GET',
            body: options.body ? JSON.parse(options.body) : null
        };
        calls.push(call);

        if (call.url.endsWith('/auth/v1/admin/generate_link')) {
            return jsonResponse({
                id: userId,
                email,
                app_metadata: { role: 'superadmin' },
                confirmed_at: '2026-08-30T12:00:00.000Z'
            });
        }
        if (call.url.includes(`/auth/v1/admin/users/${userId}`)) {
            return jsonResponse({
                id: userId,
                email,
                app_metadata: { role: 'superadmin' },
                confirmed_at: '2026-08-30T12:00:00.000Z'
            });
        }
        if (call.url.includes('/rest/v1/artists_db?or=')) return jsonResponse([]);
        if (call.url.includes('/rest/v1/support_users_db?on_conflict=')) return jsonResponse([]);
        if (call.url.includes('/auth/v1/token?grant_type=password')) {
            return jsonResponse({ access_token: 'test-access-token' });
        }
        throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    };

    delete require.cache[require.resolve(scriptPath)];
    try {
        const { ensureSuperadmin } = require(scriptPath);
        const result = await ensureSuperadmin();
        return { calls, result };
    } finally {
        global.fetch = previousFetch;
        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        delete require.cache[require.resolve(scriptPath)];
    }
}

test('existing superadmin password is unchanged unless SUPERADMIN_PASSWORD is explicitly set', async () => {
    const { calls, result } = await runEnsureSuperadmin(undefined);
    const updateCalls = calls.filter(call => call.method === 'PUT' && call.url.includes('/auth/v1/admin/users/'));

    assert.equal(updateCalls.length, 2);
    assert.ok(updateCalls.every(call => !Object.hasOwn(call.body, 'password')));
    assert.equal(calls.some(call => call.url.includes('/auth/v1/token?grant_type=password')), false);
    assert.equal(result.verifiedLogin, null);
});

test('explicit SUPERADMIN_PASSWORD is applied and verified', async () => {
    const password = 'test-only-explicit-password';
    const { calls, result } = await runEnsureSuperadmin(password);
    const updateCalls = calls.filter(call => call.method === 'PUT' && call.url.includes('/auth/v1/admin/users/'));
    const loginCall = calls.find(call => call.url.includes('/auth/v1/token?grant_type=password'));

    assert.equal(updateCalls.length, 2);
    assert.ok(updateCalls.every(call => call.body.password === password));
    assert.equal(loginCall.body.password, password);
    assert.equal(result.verifiedLogin, true);
});
