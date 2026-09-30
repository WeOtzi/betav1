const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/shared/js/studio-auth.js'), 'utf8');
const profile = { name: 'Estudio de prueba', languages: ['Español'] };
const locations = [{ label: 'Principal', formatted_address: 'Calle 123', is_primary: true }];
const user = { id: 'owner-id', email: 'studio@example.test', user_metadata: {} };

function harness(options = {}) {
    const calls = [];
    const studio = { id: 'studio-id', user_id: user.id, name: profile.name };
    const client = {
        auth: {
            getSession: async () => ({ data: { session: options.session || null } }),
            signUp: async payload => { calls.push(['signup', payload]); return { data: options.signup || { user, session: null } }; },
            signInWithPassword: async () => ({ data: { session: options.session || { user } } }),
            updateUser: async payload => { calls.push(['updateUser', payload]); return { data: { user } }; },
            resetPasswordForEmail: async (...args) => { calls.push(['reset', ...args]); return {}; },
            verifyOtp: async payload => { calls.push(['verifyOtp', payload]); return {}; },
            signOut: async () => { calls.push(['signOut']); return {}; }
        },
        rpc: async (name, args) => {
            calls.push(['rpc', name, args]);
            return options.rpcError ? { error: options.rpcError } : { data: studio };
        }
    };
    const data = {
        getClient: () => client,
        Studios: { getByUserId: async () => ({ data: options.studio || null }) }
    };
    const window = {
        location: { pathname: options.pathname || '/studio/register', search: options.search || '', hash: options.hash || '', origin: 'https://weotzi.com', href: '' },
        WeotziData: data,
        ConfigManager: { ready: async () => { calls.push(['ready']); } }
    };
    const document = { addEventListener() {}, getElementById() { return null; } };
    vm.runInNewContext(source, { window, document, WeotziData: data, URLSearchParams, console: { error() {} } });
    return { auth: window.WeOtziStudioAuth, window, calls, studio };
}

test('email confirmation does not attempt an anonymous database write or store a password in metadata', async () => {
    const h = harness();
    const result = await h.auth.register({ ...profile, email: user.email, password: 'test-password', locations });
    assert.equal(result.confirmationRequired, true);
    assert.equal(h.calls.some(call => call[0] === 'rpc'), false);
    const signup = h.calls.find(call => call[0] === 'signup')[1];
    assert.equal(signup.options.data.studio_registration.profile.password, undefined);
    assert.equal(signup.options.data.studio_registration.profile.email, undefined);
    assert.equal(signup.options.data.studio_registration.locations.length, 1);
});

test('confirmed signup creates profile and locations with one transactional call', async () => {
    const h = harness({ signup: { user, session: { user } } });
    const result = await h.auth.register({ ...profile, email: user.email, password: 'test-password', locations });
    assert.equal(result.id, h.studio.id);
    const rpc = h.calls.filter(call => call[0] === 'rpc');
    assert.equal(rpc.length, 1);
    assert.equal(rpc[0][1], 'complete_studio_registration');
    assert.equal(rpc[0][2].p_locations[0].formatted_address, 'Calle 123');
    assert.equal(h.calls.at(-1)[1].data.studio_registration, null);
});

test('confirmed user on another device resumes durable onboarding and reaches dashboard', async () => {
    const h = harness({ pathname: '/studio/login', session: { user: { ...user, user_metadata: { studio_registration: { profile, locations } } } } });
    await h.auth.check();
    assert.equal(h.auth.getCurrent().id, h.studio.id);
    assert.equal(h.window.location.href, '/studio/dashboard');
});

test('failed database transaction keeps registration draft for retry', async () => {
    const h = harness({ session: { user }, rpcError: { message: 'Database unavailable' } });
    await assert.rejects(h.auth.register({ ...profile, email: user.email, locations }), { message: 'Database unavailable' });
    assert.equal(h.calls.some(call => call[0] === 'updateUser'), false);
});

test('recovery never redirects a valid session away from the password form', async () => {
    const h = harness({ pathname: '/studio/login', search: '?recovery=1', session: { user }, studio: { id: 'studio-id' } });
    await h.auth.check();
    assert.equal(h.auth.isRecovery(), true);
    assert.equal(h.window.location.href, '');
    await h.auth.changePassword('new-password');
    assert.equal(h.calls.at(-1)[1].password, 'new-password');
});

test('expired recovery cannot change a password', async () => {
    const h = harness();
    await assert.rejects(h.auth.changePassword('new-password'), /enlace venció/);
    assert.equal(h.calls.some(call => call[0] === 'updateUser'), false);
});

test('another signed-in account cannot silently own the submitted registration', async () => {
    const h = harness({ session: { user } });
    await assert.rejects(h.auth.register({ ...profile, email: 'different@example.test', locations }), /otra cuenta abierta/);
    assert.equal(h.calls.some(call => call[0] === 'rpc'), false);
});

test('production beta prefix survives confirmation, recovery and redirects', async () => {
    const h = harness({ pathname: '/beta/studio/register' });
    await h.auth.register({ ...profile, email: user.email, password: 'test-password', locations });
    await h.auth.requestPasswordReset(user.email);
    assert.equal(h.calls.find(call => call[0] === 'signup')[1].options.emailRedirectTo, 'https://weotzi.com/beta/studio/login?confirmed=1');
    assert.equal(h.calls.find(call => call[0] === 'reset')[2].redirectTo, 'https://weotzi.com/beta/studio/login?recovery=1');
});

test('an existing Auth user completes a studio without another signup', async () => {
    const h = harness({ session: { user } });
    await h.auth.register({ ...profile, email: user.email, locations });
    assert.equal(h.calls.some(call => call[0] === 'signup'), false);
    assert.equal(h.calls.filter(call => call[0] === 'rpc').length, 1);
});

test('studio recovery can verify a mailed OTP before changing password', async () => {
    const h = harness();
    await h.auth.verifyRecoveryCode(user.email, '123456');
    const call = h.calls.find(call => call[0] === 'verifyOtp');
    assert.equal(call[1].email, user.email);
    assert.equal(call[1].token, '123456');
    assert.equal(call[1].type, 'recovery');
});
