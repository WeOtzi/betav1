const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/shared/js/marketplace.js', 'utf8');
const wait = source.slice(source.indexOf('async function waitForConfigManager'), source.indexOf('// ============================================', source.indexOf('async function waitForConfigManager')));
const fetcher = source.slice(source.indexOf('async function fetchArtists'), source.indexOf('// ============ SEÑALES REALES'));

function harness({ error, demo = false } = {}) {
    let resolve, calls = 0, configured = false;
    const ready = new Promise(r => { resolve = () => { configured = true; r(); }; });
    const context = vm.createContext({ console, setTimeout, Date, window: {
        ConfigManager: { ready: () => ready, getSupabaseClient: () => configured ? {} : null, isDemoMode: () => demo },
        ARTIST_PUBLIC_COLUMNS: 'user_id,username,name'
    }, WeotziData: { Artists: { listPublic: async () => { calls++; return { data: [{ user_id: 'db-user', username: 'real.wo', name: 'Real' }], error }; } } } });
    vm.runInContext(wait + fetcher, context);
    return { context, resolve, calls: () => calls };
}

test('marketplace espera configuración lenta antes de consultar artists_db', async () => {
    const h = harness();
    const pending = h.context.fetchArtists();
    await Promise.resolve();
    assert.equal(h.calls(), 0);
    h.resolve();
    const artists = await pending;
    assert.equal(h.calls(), 1);
    assert.equal(artists[0].user_id, 'db-user');
});

test('un fallo de Supabase no se reemplaza por artistas de demostración', async () => {
    const h = harness({ error: new Error('connection failed') });
    h.resolve();
    await assert.rejects(h.context.fetchArtists(), /connection failed/);
});

test('la configuración demo no publica un catálogo ficticio como si fuera real', async () => {
    const h = harness({ demo: true });
    h.resolve();
    await assert.rejects(h.context.fetchArtists(), /no está disponible/);
    assert.equal(h.calls(), 0);
});
