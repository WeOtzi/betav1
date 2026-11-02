'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const boot = require('../scripts/release/preview-bootstrap');
const fixtures = require('../public/shared/js/wo-demo-fixtures');
const emulator = require('../public/shared/js/wo-demo-postgrest');
const authSource = fs.readFileSync(require.resolve('../public/shared/js/studio-auth.js'), 'utf8');

function storage() {
    const values = new Map();
    return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
async function browser(shared = storage()) {
    const requests = [];
    const document = { addEventListener() {}, body: null, getElementById() { return null; } };
    const window = {
        location: { origin: 'https://preview.weotzi.com', href: 'https://preview.weotzi.com/preview/studio/studio/register/', pathname: '/preview/studio/studio/register/', search: '', hash: '' },
        WEOTZI_BASE_PATH: '/preview/studio', WEOTZI_PREVIEW_COMMIT: 'studio-registration-test',
        Response, Headers, btoa: value => Buffer.from(value, 'binary').toString('base64'), document,
        localStorage: shared, sessionStorage: storage(), WoDemoFixtures: fixtures, WoDemoPostgrest: emulator,
        fetch: async (...args) => { requests.push(args); throw new Error('Unexpected real network call'); }
    };
    const runtime = boot(window);
    await runtime.ready;
    const client = window.supabase.createClient('preview', 'preview');
    const data = { getClient: () => client, Studios: { getByUserId: id => client.from('studios').select('*').eq('user_id', id).maybeSingle() } };
    window.WeotziData = data;
    window.ConfigManager = { ready: async () => {} };
    vm.runInNewContext(authSource, { window, document, WeotziData: data, URLSearchParams, console: { error() {} } });
    return { window, runtime, client, requests, auth: window.WeOtziStudioAuth };
}
const registration = {
    name: 'Estudio de prueba', email: 'studio@example.invalid', password: 'preview123',
    website: 'https://studio.example.invalid', languages: ['Español'],
    photo_feed_items: [{ url: 'https://images.example.invalid/studio.jpg', kind: 'image' }],
    locations: [
        { label: 'Principal', formatted_address: 'Calle de prueba 123', city: 'Buenos Aires', country: 'Argentina', is_primary: true },
        { label: 'Sucursal', formatted_address: 'Avenida de prueba 456', city: 'Córdoba', country: 'Argentina', is_primary: false }
    ]
};

test('studio preview registers through the production auth controller without artist/client side effects', async () => {
    const h = await browser();
    await h.client.auth.signOut();
    const result = await h.auth.register(registration);
    const owner = h.runtime.getSession().user;
    const store = h.runtime.getStore();
    assert.equal(result.user_id, owner.id);
    assert.equal(result.email, registration.email);
    assert.equal(result.profile_complete, true);
    assert.equal(owner.user_metadata.studio_registration, null);
    assert.equal(store.rows('artists_db').some(row => row.user_id === owner.id), false);
    assert.equal(store.rows('clients_db').some(row => row.user_id === owner.id), false);
    const locations = store.rows('studio_locations').filter(row => row.studio_id === result.id);
    assert.equal(locations.length, 2);
    assert.equal(result.primary_location_id, locations[0].id);
    assert.equal(result.formatted_address, registration.locations[0].formatted_address);
    assert.equal(result.city, registration.locations[0].city);
    assert.equal(locations.filter(row => row.is_primary).length, 1);
    assert.equal(h.requests.length, 0);
});

test('studio preview validates the entire registration before creating any partial rows', async () => {
    const h = await browser();
    const before = h.runtime.getStore().dump();
    const args = { p_profile: { name: registration.name }, p_locations: [...registration.locations, { formatted_address: '' }] };
    const invalid = await h.client.rpc('complete_studio_registration', args);
    assert.equal(invalid.status, 400);
    assert.match(invalid.error.message, /dirección/);
    assert.deepEqual(h.runtime.getStore().dump(), before);
    await h.client.auth.signOut();
    const anonymous = await h.client.rpc('complete_studio_registration', { p_profile: registration, p_locations: registration.locations });
    assert.equal(anonymous.status, 400);
    assert.match(anonymous.error.message, /iniciá sesión/);
    assert.deepEqual(h.runtime.getStore().dump(), before);
    assert.equal(h.requests.length, 0);
});

test('studio preview retries are idempotent and owner identity cannot be supplied in the payload', async () => {
    const h = await browser();
    await h.client.auth.signOut();
    const first = await h.auth.register({ ...registration, user_id: 'victim-id', email: 'first-studio@example.invalid' });
    const ownerId = h.runtime.getSession().user.id;
    const repeat = await h.client.rpc('complete_studio_registration', { p_profile: { name: 'Duplicate', user_id: 'victim-id' }, p_locations: registration.locations });
    assert.equal(repeat.data.id, first.id);
    assert.equal(first.user_id, ownerId);
    assert.equal(h.runtime.getStore().rows('studios').filter(row => row.user_id === ownerId).length, 1);
    assert.equal(h.runtime.getStore().rows('studio_locations').filter(row => row.studio_id === first.id).length, 2);
    await h.client.auth.signOut();
    const second = await h.auth.register({ ...registration, email: 'second-studio@example.invalid', user_id: ownerId });
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.user_id, ownerId);
    assert.equal(second.user_id, h.runtime.getSession().user.id);
    assert.equal(h.requests.length, 0);
});

test('studio preview persists locations and photos across reload, logout and studio login', async () => {
    const shared = storage();
    const h = await browser(shared);
    await h.client.auth.signOut();
    const created = await h.auth.register(registration);
    await h.client.auth.signOut();
    const reloaded = await browser(shared);
    const studio = await reloaded.auth.login(registration.email, registration.password);
    assert.equal(studio.id, created.id);
    assert.deepEqual(studio.photo_feed_items, registration.photo_feed_items);
    assert.equal(reloaded.runtime.getSession().user.user_metadata.user_type, 'studio');
    assert.equal(reloaded.runtime.getStore().rows('studio_locations').filter(row => row.studio_id === studio.id).length, 2);
    assert.equal(reloaded.runtime.getStore().rows('artists_db').some(row => row.user_id === studio.user_id), false);
    assert.equal(reloaded.runtime.getStore().rows('clients_db').some(row => row.user_id === studio.user_id), false);
    assert.equal(h.requests.length + reloaded.requests.length, 0);
});
