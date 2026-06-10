const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'server.js');
const guardPath = path.join(repoRoot, 'public', 'shared', 'js', 'backoffice-guard.js');
const adminPath = path.join(repoRoot, 'public', 'shared', 'js', 'admin.js');
const configManagerPath = path.join(repoRoot, 'public', 'shared', 'js', 'config-manager.js');
const appSettingsPath = path.join(repoRoot, 'lib', 'app-settings.js');
const ensureSuperadminPath = path.join(repoRoot, 'scripts', 'ensure-superadmin.js');

async function runBackofficeGuard({ session, pathname = '/backoffice/', search = '', hash = '' }) {
    const source = fs.readFileSync(guardPath, 'utf8');
    const redirects = [];
    let signedOut = false;

    const client = {
        auth: {
            async getSession() {
                return { data: { session }, error: null };
            },
            async signOut() {
                signedOut = true;
                return { error: null };
            }
        }
    };

    const window = {
        CONFIG: { supabase: { url: 'https://example.supabase.co', anonKey: 'anon-key' } },
        location: {
            pathname,
            search,
            hash,
            replace(url) {
                redirects.push(url);
            }
        }
    };

    const context = {
        console,
        window,
        supabase: {
            createClient() {
                return client;
            }
        }
    };

    vm.runInNewContext(source, context, { filename: guardPath });
    await new Promise(resolve => setImmediate(resolve));

    return { redirects, signedOut, exposedClient: window.__backofficeGuardClient };
}

test('backoffice guard allows only the hardcoded superadmin email', async () => {
    const allowed = await runBackofficeGuard({
        session: { user: { email: 'isai@weotzi.com' } }
    });
    assert.deepEqual(allowed.redirects, []);
    assert.equal(allowed.signedOut, false);
    assert.ok(allowed.exposedClient);

    const rejected = await runBackofficeGuard({
        session: { user: { email: 'support@weotzi.com' } }
    });
    assert.equal(rejected.redirects.length, 1);
    assert.match(rejected.redirects[0], /^\/backoffice\/login\?redirect=/);
    assert.equal(rejected.signedOut, true);
});

test('backoffice guard redirects missing sessions to the backoffice login, not support login', async () => {
    const result = await runBackofficeGuard({
        session: null,
        pathname: '/backoffice/',
        search: '?section=apis',
        hash: '#token'
    });

    assert.equal(result.redirects.length, 1);
    assert.equal(result.redirects[0], '/backoffice/login?redirect=%2Fbackoffice%2F%3Fsection%3Dapis%23token');
    assert.equal(result.redirects[0].includes('/support/login'), false);
});

test('server admin verification accepts only the hardcoded superadmin email', async () => {
    const originalEnv = { ...process.env };
    const originalFetch = global.fetch;
    delete require.cache[require.resolve(appSettingsPath)];

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

    try {
        global.fetch = async () => ({
            ok: true,
            async json() {
                return { id: 'user-1', email: 'support@weotzi.com' };
            }
        });

        let appSettings = require(appSettingsPath);
        const rejected = await appSettings.verifyAdminCaller({
            headers: { authorization: 'Bearer token' }
        });
        assert.equal(rejected.ok, false);
        assert.equal(rejected.status, 403);

        delete require.cache[require.resolve(appSettingsPath)];
        global.fetch = async () => ({
            ok: true,
            async json() {
                return { id: 'user-2', email: 'isai@weotzi.com' };
            }
        });

        appSettings = require(appSettingsPath);
        const accepted = await appSettings.verifyAdminCaller({
            headers: { authorization: 'Bearer token' }
        });
        assert.equal(accepted.ok, true);
        assert.equal(accepted.email, 'isai@weotzi.com');
    } finally {
        process.env = originalEnv;
        global.fetch = originalFetch;
        delete require.cache[require.resolve(appSettingsPath)];
    }
});

test('superadmin maintenance script hardcodes the protected account and password', () => {
    const source = fs.readFileSync(ensureSuperadminPath, 'utf8');

    assert.match(source, /SUPERADMIN_EMAIL\s*=\s*'isai@weotzi\.com'/);
    assert.match(source, /SUPERADMIN_PASSWORD\s*=\s*'Soporte2026\.!'/);
    assert.match(source, /SUPERADMIN_SUPPORT_ROLE\s*=\s*'admin'/);
});

test('superadmin maintenance keeps the account in support users and out of artists', async () => {
    const originalEnv = { ...process.env };
    const originalFetch = global.fetch;
    delete require.cache[require.resolve(ensureSuperadminPath)];

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    const calls = [];
    let artistCleanupCompleted = false;
    let finalAuthEnsured = false;

    try {
        global.fetch = async (url, options = {}) => {
            const call = {
                url: String(url),
                method: options.method || 'GET',
                body: options.body ? JSON.parse(options.body) : null
            };
            calls.push(call);

            if (call.url.includes('/auth/v1/admin/generate_link')) {
                if (artistCleanupCompleted) {
                    return {
                        ok: false,
                        status: 404,
                        async text() {
                            return JSON.stringify({ error_code: 'user_not_found' });
                        }
                    };
                }

                return {
                    ok: true,
                    async text() {
                        return JSON.stringify({ id: 'artist-linked-auth-id' });
                    }
                };
            }

            if (call.url.includes('/auth/v1/admin/users/artist-linked-auth-id')) {
                return {
                    ok: true,
                    async text() {
                        return JSON.stringify({
                            id: 'artist-linked-auth-id',
                            email: 'isai@weotzi.com',
                            app_metadata: { role: 'superadmin' },
                            email_confirmed_at: '2026-05-12T00:00:00.000Z'
                        });
                    }
                };
            }

            if (call.url.endsWith('/auth/v1/admin/users') && call.method === 'POST') {
                finalAuthEnsured = true;
                return {
                    ok: true,
                    async text() {
                        return JSON.stringify({
                            id: 'support-auth-user-id',
                            email: 'isai@weotzi.com',
                            app_metadata: { role: 'superadmin' },
                            email_confirmed_at: '2026-05-12T00:00:00.000Z'
                        });
                    }
                };
            }

            if (call.url.includes('/auth/v1/token?grant_type=password')) {
                return {
                    ok: finalAuthEnsured,
                    status: finalAuthEnsured ? 200 : 400,
                    async text() {
                        return JSON.stringify(finalAuthEnsured
                            ? { access_token: 'verified-token' }
                            : { error_code: 'invalid_credentials' });
                    }
                };
            }

            if (call.url.includes('/rest/v1/artists_db')) {
                artistCleanupCompleted = true;
                return {
                    ok: true,
                    async text() {
                        return JSON.stringify([]);
                    }
                };
            }

            if (call.url.includes('/rest/v1/support_users_db')) {
                if (call.body?.user_id !== 'support-auth-user-id') {
                    return {
                        ok: false,
                        status: 409,
                        async text() {
                            return JSON.stringify({ code: '23503' });
                        }
                    };
                }

                return {
                    ok: true,
                    async text() {
                        return JSON.stringify([{ user_id: 'support-auth-user-id', email: 'isai@weotzi.com' }]);
                    }
                };
            }

            throw new Error(`Unexpected fetch: ${call.method} ${call.url}`);
        };

        const { ensureSuperadmin } = require(ensureSuperadminPath);
        const result = await ensureSuperadmin();

        assert.equal(result.userId, 'support-auth-user-id');
        assert.equal(result.supportUserEnsured, true);
        assert.equal(result.artistRowsRemoved, true);

        const artistCleanup = calls.find(call => call.url.includes('/rest/v1/artists_db'));
        assert.ok(artistCleanup, 'must delete any superadmin row from artists_db');
        assert.equal(artistCleanup.method, 'DELETE');
        assert.match(artistCleanup.url, /user_id\.eq\.artist-linked-auth-id/);
        assert.match(artistCleanup.url, /email\.eq\.isai%40weotzi\.com/);

        const supportUpsert = calls.find(call => call.url.includes('/rest/v1/support_users_db'));
        assert.ok(supportUpsert, 'must upsert the superadmin into support_users_db');
        assert.equal(supportUpsert.method, 'POST');
        assert.equal(supportUpsert.body.user_id, 'support-auth-user-id');
        assert.equal(supportUpsert.body.email, 'isai@weotzi.com');
        assert.equal(supportUpsert.body.role, 'admin');
        assert.equal(supportUpsert.body.is_active, true);
    } finally {
        process.env = originalEnv;
        global.fetch = originalFetch;
        delete require.cache[require.resolve(ensureSuperadminPath)];
    }
});

test('backoffice admin session messaging points to the backoffice login', () => {
    const source = fs.readFileSync(adminPath, 'utf8');
    const start = source.indexOf('function _apifyNoSessionHTML');
    const end = source.indexOf('function _renderApifyResult', start);
    const snippet = source.slice(start, end);

    assert.ok(snippet.includes('/backoffice/login'));
    assert.equal(
        snippet.includes('/support/login'),
        false,
        'backoffice no-session messaging must not send admins to the support login'
    );
});

function routeSnippet(source, route) {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, `${route} should exist`);
    const nextRoute = source.indexOf("app.", start + route.length);
    return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

test('sensitive backoffice API routes verify the superadmin bearer token', () => {
    const source = fs.readFileSync(serverPath, 'utf8');
    const routes = [
        "app.post('/api/admin/update-user-password'",
        "app.post('/api/admin/generate-backup'",
        "app.get('/api/admin/backup-tables'"
    ];

    for (const route of routes) {
        const snippet = routeSnippet(source, route);
        assert.ok(
            snippet.includes('appSettings.verifyAdminCaller(req)'),
            `${route} must verify the superadmin caller`
        );
    }
});

test('backoffice sensitive fetches send the current admin session token', () => {
    const source = fs.readFileSync(adminPath, 'utf8');

    const backupSnippet = source.slice(
        source.indexOf("fetch('/api/admin/generate-backup'"),
        source.indexOf("if (!response.ok)", source.indexOf("fetch('/api/admin/generate-backup'"))
    );
    assert.ok(backupSnippet.includes('...headers'));

    const passwordSnippet = source.slice(
        source.indexOf("fetch('/api/admin/update-user-password'"),
        source.indexOf('body: JSON.stringify', source.indexOf("fetch('/api/admin/update-user-password'"))
    );
    assert.ok(passwordSnippet.includes('...headers'));
});

test('backoffice initializes Supabase from API-served ConfigManager settings', () => {
    const source = fs.readFileSync(adminPath, 'utf8');
    const start = source.indexOf('function initSupabase()');
    const end = source.indexOf('async function connectSupabase', start);
    assert.notEqual(start, -1, 'initSupabase should exist');
    assert.notEqual(end, -1, 'connectSupabase should follow initSupabase');
    const snippet = source.slice(start, end);

    assert.match(snippet, /getValue(?:\?\.)?\('supabase\.url'/);
    assert.match(snippet, /getValue(?:\?\.)?\('supabase\.anonKey'/);
    assert.ok(snippet.includes('connectSupabase(url, key)'));
    assert.equal(
        snippet.includes('if (!savedSettings) return;'),
        false,
        'backoffice should not require localStorage settings when API config is present'
    );
});

test('ConfigManager keeps API-served Supabase config above stale browser storage', () => {
    const source = fs.readFileSync(configManagerPath, 'utf8');
    const start = source.indexOf('function init()');
    const end = source.indexOf('function ready()', start);
    assert.notEqual(start, -1, 'ConfigManager init should exist');
    const snippet = source.slice(start, end);

    assert.ok(
        snippet.includes('preserveServerSupabaseConfig'),
        'init should preserve API-served Supabase settings after merging localStorage'
    );
});

test('backoffice database browser code uses authenticated admin database API', () => {
    const source = fs.readFileSync(adminPath, 'utf8');
    const start = source.indexOf('async function loadDatabaseStats()');
    const end = source.indexOf('function renderTableInspector', start);
    assert.notEqual(start, -1, 'loadDatabaseStats should exist');
    assert.notEqual(end, -1, 'renderTableInspector should follow database loaders');
    const snippet = source.slice(start, end);

    assert.ok(snippet.includes('/api/admin/database/tables'));
    assert.equal(
        snippet.includes('getSupabaseClient()'),
        false,
        'database inspection should use the server API, not a browser Supabase client'
    );
});

test('backoffice Supabase connection checks use the authenticated admin API', () => {
    const source = fs.readFileSync(adminPath, 'utf8');

    for (const [name, nextName] of [
        ['async function connectSupabase', 'async function testSupabaseConnection'],
        ['async function testSupabaseConnection', 'function updateConnectionStatus'],
        ['async function testSupabaseAPI', 'function saveSupabaseAPI']
    ]) {
        const start = source.indexOf(name);
        const end = source.indexOf(nextName, start);
        assert.notEqual(start, -1, `${name} should exist`);
        assert.notEqual(end, -1, `${nextName} should follow ${name}`);
        const snippet = source.slice(start, end);

        assert.ok(
            snippet.includes('/api/admin/database/tables'),
            `${name} should test the server-side Supabase connection`
        );
        assert.equal(
            snippet.includes('.from('),
            false,
            `${name} should not test Supabase with browser-side table reads`
        );
    }
});

test('backoffice artist list uses the authenticated admin artists API', () => {
    const source = fs.readFileSync(adminPath, 'utf8');
    const start = source.indexOf('async function loadArtists()');
    const end = source.indexOf('function renderArtistsMeta', start);
    assert.notEqual(start, -1, 'loadArtists should exist');
    assert.notEqual(end, -1, 'renderArtistsMeta should follow loadArtists');
    const snippet = source.slice(start, end);

    assert.ok(snippet.includes('/api/admin/artists'));
    assert.equal(
        snippet.includes(".from('artists_db')"),
        false,
        'artist list should not read artists_db directly from the browser'
    );
});

test('backoffice support user browser code uses authenticated admin support API', () => {
    const source = fs.readFileSync(adminPath, 'utf8');
    const start = source.indexOf('async function loadSupportUsers()');
    const end = source.indexOf('// ============ SUPPORT USERS EXPORTS', start);
    assert.notEqual(start, -1, 'loadSupportUsers should exist');
    assert.notEqual(end, -1, 'support user exports should follow support user code');
    const snippet = source.slice(start, end);

    assert.ok(snippet.includes('/api/admin/support-users'));
    assert.equal(
        snippet.includes(".from('support_users_db')"),
        false,
        'support user management should use the server API, not direct browser table writes'
    );
});

test('server exposes authenticated admin APIs for backoffice database and support users', () => {
    const source = fs.readFileSync(serverPath, 'utf8');
    const routes = [
        "app.get('/api/admin/database/tables'",
        "app.get('/api/admin/database/tables/:tableName'",
        "app.get('/api/admin/artists'",
        "app.get('/api/admin/support-users'",
        "app.post('/api/admin/support-users'",
        "app.patch('/api/admin/support-users/:userId'"
    ];

    for (const route of routes) {
        const snippet = routeSnippet(source, route);
        assert.ok(
            snippet.includes('appSettings.verifyAdminCaller(req)'),
            `${route} must verify the superadmin caller`
        );
    }
});
