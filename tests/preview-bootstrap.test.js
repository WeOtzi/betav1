'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const boot = require('../scripts/release/preview-bootstrap');
const fixtures = require('../public/shared/js/wo-demo-fixtures');
const emulator = require('../public/shared/js/wo-demo-postgrest');

function storage() {
    const values = new Map();
    return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function browser(options = {}) {
    const requests = [];
    const win = {
        location: { origin: 'https://preview.weotzi.com', href: 'https://preview.weotzi.com/preview/valentina-login/inicio/' },
        WEOTZI_BASE_PATH: options.base || '/preview/valentina-login', WEOTZI_PREVIEW_COMMIT: 'abc123',
        Response, Headers, btoa: value => Buffer.from(value, 'binary').toString('base64'),
        document: { addEventListener() {}, body: null },
        localStorage: options.storage || storage(), sessionStorage: storage(),
        WoDemoFixtures: fixtures, WoDemoPostgrest: emulator,
        navigator: { sendBeacon() { throw new Error('Real beacon must never run'); } },
        fetch: async (input, init) => { requests.push({ input, init }); return new Response('asset', { status: 200 }); }
    };
    const runtime = boot(win);
    return { win, runtime, requests };
}

test('preview has one fictitious identity with both profiles and no Supabase network calls', async () => {
    const { win, runtime, requests } = browser();
    await runtime.ready;
    const client = win.supabase.createClient('https://real.supabase.co', 'real-key-must-not-be-used');
    const { data: { session } } = await client.auth.getSession();
    const artist = await client.from('artists_db').select('*').eq('user_id', session.user.id).single();
    const customer = await client.from('clients_db').select('*').eq('user_id', session.user.id).single();
    assert.equal(artist.error, null);
    assert.equal(customer.error, null);
    assert.equal(artist.data.user_id, customer.data.user_id);
    assert.equal(artist.data.gallery_images.length, 3);
    assert.match(artist.data.email, /example\.invalid$/);
    assert.ok(artist.data.gallery_images.every(url => url.startsWith('/preview/valentina-login/shared/')));
    const config = JSON.parse(win.localStorage.getItem('weotzi_config'));
    assert.equal(config.features.demoMode, false);
    assert.equal(config.features.emailNotifications, false);
    assert.equal(config.supabase.url, 'https://preview.weotzi.invalid');
    assert.equal(config.deployment.dataMode, 'browser-demo');
    assert.equal(requests.length, 0);
});

test('preview emulates filtered mutations and preserves them across navigation only in same branch', async () => {
    const shared = storage();
    const first = browser({ storage: shared });
    await first.runtime.ready;
    const client = first.win.supabase.createClient('x', 'x');
    const id = first.runtime.getSession().user.id;
    const changed = await client.from('artists_db').update({ name: 'Perfil ficticio modificado' }).eq('user_id', id).select('name').single();
    assert.equal(changed.error, null);
    assert.equal(changed.data.name, 'Perfil ficticio modificado');
    const second = browser({ storage: shared });
    await second.runtime.ready;
    const saved = await second.win.supabase.createClient('x', 'x').from('artists_db').select('name').eq('user_id', id).single();
    assert.equal(saved.data.name, 'Perfil ficticio modificado');
    const other = browser({ storage: shared, base: '/preview/valentina-other' });
    await other.runtime.ready;
    assert.equal(other.runtime.getStore().rows('artists_db')[0].name, 'Valentina · Preview');
    assert.equal(first.requests.length + second.requests.length + other.requests.length, 0);
});

test('external HTTP, unknown RPC/table/API and Storage writes fail visibly without pass-through', async () => {
    const { win, runtime, requests } = browser();
    await runtime.ready;
    const client = win.supabase.createClient('https://real.supabase.co', 'x');
    assert.equal((await win.fetch('https://n8n.example.com/webhook/send', { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await client.rpc('unknown_mutation', { victim: 'real-user' })).status, 501);
    assert.equal((await client.from('unknown_real_table').insert({ id: 1 }).select()).status, 501);
    assert.equal((await win.fetch('/api/email/client_approved', { method: 'POST', body: '{}' })).status, 501);
    assert.equal((await client.storage.from('artist-gallery').upload('photo.jpg', Buffer.from('fake'))).error.code, 'PREVIEW_UNSUPPORTED');
    assert.equal(win.navigator.sendBeacon('https://real.example/events', 'data'), false);
    assert.ok(runtime.coverage.some(item => item.status === 'unsupported'));
    assert.ok(runtime.coverage.some(item => item.status === 'blocked'));
    assert.equal(requests.length, 0);
});

test('auth fixtures survive logout/reload and do not verify passwords or accept real OAuth tokens', async () => {
    const shared = storage();
    const { win, runtime, requests } = browser({ storage: shared });
    await runtime.ready;
    const client = win.supabase.createClient('x', 'x');
    await client.auth.signOut();
    assert.equal((await client.auth.getSession()).data.session, null);
    const reload = browser({ storage: shared });
    await reload.runtime.ready;
    assert.equal(reload.runtime.getSession(), null);
    const invalid = await client.auth.signInWithPassword({ email: 'invalid', password: 'abc' });
    assert.equal(invalid.error.code, 'PREVIEW_INPUT');
    const login = await client.auth.signUp({ email: 'tester@example.invalid', password: 'preview123' });
    assert.equal(login.error, null);
    assert.equal(login.data.user.app_metadata.preview, true);
    assert.equal((await client.from('clients_db').select('user_id').eq('user_id', login.data.user.id).single()).error, null);
    assert.equal((await client.auth.setSession({ access_token: 'real-token' })).error.code, 'PREVIEW_UNSUPPORTED');
    assert.equal((await client.auth.signInWithOAuth({ provider: 'google' })).error.code, 'PREVIEW_UNSUPPORTED');
    assert.equal((await client.auth.resetPasswordForEmail('real@example.com')).error.code, 'PREVIEW_UNSUPPORTED');
    assert.equal(requests.length, 0);
});

test('SDK export reassignment keeps fixture createClient and scoped mode switching ignores supplied identity', async () => {
    const { win, runtime, requests } = browser();
    await runtime.ready;
    win.supabase.createClient = () => { throw new Error('Real SDK must not create a client'); };
    win.supabase = { createClient: () => { throw new Error('Real SDK must not create a client'); } };
    const client = win.supabase.createClient('https://real.supabase.co', 'secret');
    assert.ok(client.auth);
    const id = runtime.getSession().user.id;
    const switched = await win.fetch('/preview/valentina-login/api/account/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'client', user_id: 'real-victim' }) });
    assert.equal(switched.status, 200);
    assert.equal((await switched.json()).url, '/preview/valentina-login/client/dashboard/');
    assert.equal(runtime.getSession().user.id, id);
    await client.auth.signOut();
    assert.equal((await win.fetch('/api/account/mode', { method: 'POST', body: JSON.stringify({ mode: 'artist' }) })).status, 401);
    assert.equal(requests.length, 0);
});

test('quotation preview intake persists one idempotent fake submission without notifying anyone', async () => {
    const { win, runtime, requests } = browser();
    await runtime.ready;
    const body = { mode: 'submit', submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quotation: { artist_id: runtime.getSession().user.id,
        client_full_name: 'Cliente de prueba', client_email: 'tester@example.invalid', tattoo_idea_description: 'Botánico ficticio', tattoo_style: ['Fine line'], tattoo_body_part: 'Brazo', tattoo_size: 'Mediano' } };
    const submit = () => win.fetch('/api/quotations/intake', { method: 'POST', body: JSON.stringify(body) });
    const initial = await submit();
    assert.equal(initial.status, 200);
    const result = await initial.json();
    assert.equal(result.preview, true);
    assert.equal(result.status, 'pending');
    await submit();
    assert.equal(runtime.getStore().rows('quotations_db').filter(row => row.quote_id === result.quote_id).length, 1);
    assert.equal(requests.length, 0);
});

test('same-origin static reads remain allowed; POST cannot reach even a same-origin endpoint', async () => {
    const { win, runtime, requests } = browser();
    await runtime.ready;
    assert.equal((await win.fetch('/preview/valentina-login/shared/assets/demo/ref-01.svg')).status, 200);
    assert.equal(requests.length, 1);
    assert.equal((await win.fetch('/unhandled-upload', { method: 'POST', body: 'private' })).status, 403);
    assert.equal(requests.length, 1);
    const missing = await win.supabase.createClient('x', 'x').from('artists_db').select('*').eq('username', 'no-such-fake-artist').maybeSingle();
    assert.equal(missing.data, null);
    assert.equal(missing.error, null);
});

test('fixture RPC row mutations persist across a preview reload', async () => {
    const shared = storage();
    const first = browser({ storage: shared });
    await first.runtime.ready;
    const methods = first.runtime.getStore().rows('artist_payment_methods');
    assert.ok(methods.length > 1);
    const selected = methods.find(method => !method.is_default);
    const result = await first.win.supabase.createClient('x', 'x').rpc('set_artist_default_payment_method', { p_method_id: selected.id });
    assert.equal(result.error, null);
    const reloaded = browser({ storage: shared });
    await reloaded.runtime.ready;
    assert.equal(reloaded.runtime.getStore().rows('artist_payment_methods').find(method => method.id === selected.id).is_default, true);
    assert.equal(first.requests.length + reloaded.requests.length, 0);
});
