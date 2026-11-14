// Marketplace MK-10 + Estudios ER-08: privilegios por columna en studios.
// anon/authenticated no leen el email del dueño ni datos internos; el front
// traduce '*' a la lista pública y el dueño lee su fila con get_my_studio().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const MIG = 'supabase/migrations/20261115200100_pii_studios_column_privileges.sql';
const MIG_VIEWS = 'supabase/migrations/20261115200000_marketplace_vistas_publicas.sql';
const PRIVATE = ['email', 'contact_phone', 'verification_reason', 'verification_required', 'instagram_verified_handle', 'created_by_artist_user_id'];

test('migración: revoca el SELECT de tabla y otorga todo menos lo privado; RPC del dueño', () => {
    const sql = read(MIG);
    assert.match(sql, /revoke select on table public\.studios from anon, authenticated;/);
    for (const col of PRIVATE.concat(['artist_requirements', 'default_revenue_split_pct'])) {
        assert.ok(sql.includes(`'${col}'`), col);
    }
    assert.match(sql, /grant select \(%s\) on public\.studios to anon, authenticated/);
    assert.match(sql, /grant select \(%s\) on public\.studios to authenticated'/);
    assert.match(sql, /create or replace function public\.get_my_studio\(\)[\s\S]*security definer[\s\S]*set search_path = ''/);
    assert.match(sql, /revoke all on function public\.get_my_studio\(\) from public, anon;/);
    assert.match(sql, /alter function %s security definer/);
    assert.ok(!/^\s*(begin|commit);/m.test(sql), 'sin begin/commit propios');
    assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks/20261115200100_pii_studios_column_privileges.down.sql')));
});

test('migración de vistas: studio_phone deja de exponer contact_phone; viajes sin notas', () => {
    const sql = read(MIG_VIEWS);
    assert.ok(!/contact_phone/.test(sql.split('-- 1) artists_with_location')[1]), 'la vista no usa contact_phone');
    assert.match(sql, /a\.session_price_amount_usd,\n\s*a\.verification_state\nfrom public\.artists_db a/);
    const trips = sql.slice(sql.indexOf('create or replace view public.public_artist_trips'));
    for (const hidden of ['personal_notes', 'agreed_conditions', 'share_slug', 'interested_people_count']) {
        assert.ok(!trips.includes(`t.${hidden}`), hidden);
    }
    assert.match(trips, /status = any \(array\['planificado'::text, 'confirmado'::text\]\)/);
    assert.match(trips, /cancelled_at is null/);
    assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks/20261115200000_marketplace_vistas_publicas.down.sql')));
});

function loadStudiosRepo({ rpcError = null } = {}) {
    const calls = [];
    function builder(target) {
        const b = {
            target,
            select(cols) { calls.push({ target, select: cols }); return b; },
            eq() { return b; }, in() { return b; }, ilike() { return b; }, order() { return b; },
            limit() { return b; }, not() { return b; }, range() { return b; },
            maybeSingle() { return Promise.resolve(target === 'rpc:get_my_studio' && rpcError ? { data: null, error: rpcError } : { data: { target }, error: null }); },
            single() { return b.maybeSingle(); }
        };
        return b;
    }
    const D = {
        from: (table) => builder(table),
        getClient: () => ({ rpc: (name) => builder(`rpc:${name}`) })
    };
    const context = vm.createContext({ window: { WeotziData: D }, console });
    vm.runInContext(read('public/shared/js/data/studios-repo.js'), context);
    return { Studios: context.window.WeotziData.Studios, calls };
}

test('studios-repo: getById/getBySlug con "*" piden solo columnas públicas', async () => {
    const { Studios, calls } = loadStudiosRepo();
    await Studios.getById('s1', '*');
    await Studios.getBySlug('slug');
    await Studios.getById('s1', 'id, name, email, contact_phone');
    for (const c of calls) {
        const cols = c.select.split(',').map((x) => x.trim());
        assert.ok(!cols.includes('*'));
        PRIVATE.forEach((p) => assert.ok(!cols.includes(p), `${p} en ${c.select}`));
    }
    assert.equal(calls[2].select, 'id, name');
    assert.ok(Studios.PUBLIC_COLUMNS.includes('whatsapp'), 'el WhatsApp del estudio es público a propósito');
    assert.ok(Studios.PUBLIC_COLUMNS.includes('location_verified'));
});

test('studios-repo: el dueño lee su fila completa con get_my_studio y cae a la tabla si la RPC falta', async () => {
    let repo = loadStudiosRepo();
    const own = await repo.Studios.getByUserId('u1');
    assert.equal(own.data.target, 'rpc:get_my_studio');
    const pub = await repo.Studios.getByUserId('u1', 'id,user_id,name,slug,profile_complete');
    assert.equal(pub.data.target, 'studios');

    repo = loadStudiosRepo({ rpcError: { code: 'PGRST202', message: 'Could not find the function' } });
    const fallback = await repo.Studios.getByUserId('u1');
    assert.equal(fallback.data.target, 'studios');
});

test('ninguna página pública pide columnas privadas de studios', () => {
    const files = ['public/shared/js/studio-profile.js', 'public/shared/js/artist-profile.js',
        'public/shared/js/marketplace.js', 'public/shared/js/data/marketplace-repo.js', 'public/shared/js/explore-map.js'];
    for (const f of files) {
        const src = read(f);
        for (const p of PRIVATE) assert.ok(!new RegExp(`studio\\w*\\.${p}\\b`).test(src), `${f}: ${p}`);
    }
    // La lista pública del repo no incluye ninguna privada.
    const repo = read('public/shared/js/data/studios-repo.js');
    const list = repo.slice(repo.indexOf('const PUBLIC_COLUMNS = Object.freeze(['), repo.indexOf(']);', repo.indexOf('const PUBLIC_COLUMNS = Object.freeze([')));
    for (const p of PRIVATE.concat(['artist_requirements', 'default_revenue_split_pct'])) assert.ok(!list.includes(`'${p}'`), p);
});

test('demo: get_my_studio devuelve solo el estudio de la sesión (y nada sin sesión)', () => {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/pii-studios.js'), sandbox, { filename: 'pii-studios.js' });
    const ext = sandbox.WoDemoFixtureExtensions['pii-studios'];
    assert.equal(typeof ext, 'function');
    const ctx = { rpcs: {} };
    ext(ctx);
    const rows = [{ id: 's1', user_id: 'u1', email: 'a@x.test' }, { id: 's2', user_id: 'u2', email: 'b@x.test' }];
    const store = { rows: (table) => (table === 'studios' ? rows : []) };
    const own = ctx.rpcs.get_my_studio({}, store, { userId: 'u1' });
    assert.deepEqual(JSON.parse(JSON.stringify(own)), [rows[0]]);
    own[0].email = 'cambiado@x.test';
    assert.equal(rows[0].email, 'a@x.test', 'devuelve copias, no la fila del store');
    assert.equal(ctx.rpcs.get_my_studio({}, store, {}).length, 0);
    assert.equal(ctx.rpcs.get_my_studio({}, store, { userId: 'nadie' }).length, 0);
    assert.ok(require('../public/shared/js/wo-demo-fixtures.js').EXTENSIONS.includes('pii-studios'));
});
