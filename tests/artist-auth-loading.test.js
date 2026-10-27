const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(file, context) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
}

function artistLoaderPage() {
    assert.equal(fs.existsSync('public/shared/js/artist-auth-loader.js'), true, 'artist loading module must exist');
    const children = [];
    const timers = [];
    const document = {
        body: { appendChild: (node) => children.push(node) },
        createElement: () => ({ className: '', setAttribute(name, value) { this[name] = value; } }),
        querySelector: (selector) => selector === '.artist-auth-loader' ? children[0] : null
    };
    const window = { location: { href: '/artist/login' }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); } };
    load('public/shared/js/artist-auth-loader.js', { window, document });
    return { window, children, timers };
}

test('artist loading screen announces progress and redirects to the requested destination once', () => {
    const page = artistLoaderPage();
    page.window.ArtistAuthLoader.show({ targetUrl: '/artist/dashboard', delayMs: 1500 });
    page.window.ArtistAuthLoader.show({ targetUrl: '/artist/dashboard', delayMs: 1500 });

    assert.equal(page.children.length, 1);
    assert.equal(page.children[0].role, 'status');
    assert.match(page.children[0].innerHTML, /WE ÖTZI/);
    assert.match(page.children[0].innerHTML, /Organizando tu agenda/);
    assert.match(page.children[0].innerHTML, /artist-auth-loader__spinner/);
    assert.equal(page.timers.length, 1);
    assert.equal(page.timers[0].ms, 1500);
    page.timers[0].fn();
    assert.equal(page.window.location.href, '/artist/dashboard');
});

function loginPage({ result, artist, client }) {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', hidden: true, disabled: false, className: '', dataset: {} });
        return elements.get(id);
    };
    element('login-email').value = 'artist@example.invalid';
    element('login-password').value = 'not-a-real-password';
    const shown = [];
    const timers = [];
    const window = {
        location: { search: '', href: '/artist/login' },
        CONFIG: { supabase: { url: 'https://example.invalid', anonKey: 'fake' } },
        ArtistAuthLoader: { show: (options) => shown.push(options) }
    };
    const context = {
        window,
        document: { addEventListener() {}, getElementById: element },
        supabase: { createClient: () => ({ auth: { signInWithPassword: async () => result } }) },
        WeotziData: {
            Artists: { getByUserId: async () => ({ data: artist || null }) },
            Clients: { getByUserId: async () => ({ data: client || null }) }
        },
        URLSearchParams, console: { ...console, error() {} },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {}
    };
    load('public/shared/js/artist-login.js', context);
    return { context, element, shown, timers, window };
}

test('successful artist login displays the artist screen before navigating', async () => {
    const page = loginPage({ result: { data: { user: { id: 'artist-id' } }, error: null }, artist: { user_id: 'artist-id' } });
    await page.context.handleArtistLogin({ preventDefault() {} });
    assert.equal(page.shown.length, 1);
    assert.equal(page.shown[0].targetUrl, '/artist/dashboard');
    assert.equal(page.timers.some(({ ms }) => ms === 1500), false);
});

test('invalid login keeps its error visible instead of showing the loading screen', async () => {
    const page = loginPage({ result: { data: null, error: new Error('Invalid login credentials') } });
    await page.context.handleArtistLogin({ preventDefault() {} });
    assert.equal(page.shown.length, 0);
    assert.match(page.element('form-message').innerHTML, /Email o contraseña incorrectos/);
    assert.equal(page.element('btn-login').disabled, false);
});

test('client account on artist login keeps its client destination without the artist screen', async () => {
    const page = loginPage({ result: { data: { user: { id: 'client-id' } }, error: null }, client: { user_id: 'client-id' } });
    await page.context.handleArtistLogin({ preventDefault() {} });
    assert.equal(page.shown.length, 0);
    const redirect = page.timers.find(({ ms }) => ms === 1500);
    assert.ok(redirect);
    redirect.fn();
    assert.equal(page.window.location.href, '/client/dashboard');
});

function recoveryPage(search, artist) {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, {
            value: '', innerHTML: '', textContent: '', hidden: false, disabled: false, dataset: {},
            classList: { toggle() {}, remove() {} }, addEventListener(name, fn) { this[name] = fn; },
            focus() {}, querySelector() { return { innerHTML: '' }; }
        });
        return elements.get(id);
    };
    const artistCalls = [];
    const sharedCalls = [];
    const resetCalls = [];
    const window = {
        location: { search, origin: 'https://example.invalid', href: '/recover' },
        ArtistAuthLoader: { show: (options) => artistCalls.push(options) },
        WoPostAuthLoader: { show: (options) => sharedCalls.push(options) },
        setInterval: () => 1, clearInterval: () => {},
        ConfigManager: { getSupabaseClient: () => ({ auth: {
            getSession: async () => ({ data: { session: { user: { id: 'user-id' } } } }),
            resetPasswordForEmail: async (email, options) => { resetCalls.push({ email, options }); return { error: null }; },
            onAuthStateChange() {}
        } }) }
    };
    window.WeotziData = { Artists: { getByUserId: async () => ({ data: artist ? { user_id: 'user-id' } : null }) } };
    load('public/shared/js/recover.js', {
        window, document: { readyState: 'complete', getElementById: element, querySelectorAll: () => [] },
        URLSearchParams, console, setInterval, clearInterval
    });
    return { element, artistCalls, sharedCalls, resetCalls };
}

test('artist recovery email keeps its origin when the user returns through the verification link', async () => {
    const page = recoveryPage('?from=artist', true);
    page.element('rc-email').value = 'artist@example.invalid';
    await page.element('rc-email-form').submit({ preventDefault() {} });
    assert.equal(page.resetCalls.length, 1);
    assert.equal(page.resetCalls[0].options.redirectTo, 'https://example.invalid/recover?recovery=1&from=artist');
});

test('artist-origin recovery to an artist dashboard uses only the artist loading screen', async () => {
    const page = recoveryPage('?from=artist', true);
    await page.element('rc-success-cta').click();
    assert.equal(page.artistCalls.length, 1);
    assert.equal(page.artistCalls[0].targetUrl, '/artist/dashboard');
    assert.equal(page.sharedCalls.length, 0);
});

test('client-origin recovery and client destinations preserve the shared loader', async () => {
    for (const [search, artist, role] of [['?from=client', true, 'artist'], ['?from=artist', false, 'client']]) {
        const page = recoveryPage(search, artist);
        await page.element('rc-success-cta').click();
        assert.equal(page.artistCalls.length, 0);
        assert.equal(page.sharedCalls.length, 1);
        assert.equal(page.sharedCalls[0].role, role);
    }
});
