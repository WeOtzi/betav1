// Ronda 3c · grupo "pii-artistas": artists_db con privilegios por columna.
// Cubre la migración 20261113106000 (listas, RPCs, vista), el repo del
// navegador (enrutamiento a RPC, sin select('*') sobre artists_db), la lista
// pública de config-manager, los lectores directos y las fixtures del demo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const MIGRATION = 'supabase/migrations/20261113106000_pii_artistas_column_privileges.sql';
const ROLLBACK = 'supabase/rollbacks/20261113106000_pii_artistas_column_privileges.down.sql';

// Lo que el dueño pidió proteger: nunca puede quedar en la lista pública.
const MUST_BE_PRIVATE = [
    'email', 'birth_date', 'whatsapp_number', 'whatsapp_url',
    'street', 'street_number', 'unit', 'postal_code', 'formatted_address', 'google_place_id',
    'latitude', 'longitude', 'geocoded_address',
    'registration_draft_id', 'registration_source', 'registration_step',
    'registration_started_at', 'registration_last_saved_at', 'registration_submitted_at',
    'subscribed_newsletter', 'newsletter_topics', 'terms_accepted_at', 'password'
];

function sqlArray(sql, name) {
    const m = new RegExp(name + "\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\];").exec(sql);
    assert.ok(m, 'falta el array ' + name);
    return [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
}

function stripSqlComments(sql) {
    return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

// Builder grabador: registra la cadena de llamadas (from/rpc/select/eq...).
function recorder() {
    const calls = [];
    function chain(entry) {
        const b = {};
        ['select', 'eq', 'neq', 'ilike', 'in', 'or', 'limit', 'order', 'maybeSingle', 'single', 'update', 'upsert'].forEach((m) => {
            b[m] = (...args) => { entry.chain.push([m, ...args]); return b; };
        });
        return b;
    }
    const client = {
        rpc(fn, args) { const e = { kind: 'rpc', name: fn, args, chain: [] }; calls.push(e); return chain(e); },
        from(t) { const e = { kind: 'from', name: t, chain: [] }; calls.push(e); return chain(e); }
    };
    return { calls, client };
}

function loadRepo(extraWindow = {}) {
    const rec = recorder();
    const window = Object.assign({
        WeotziData: { from: (t) => rec.client.from(t), getClient: () => rec.client }
    }, extraWindow);
    const sandbox = { window, console };
    vm.runInNewContext(read('public/shared/js/data/artists-repo.js'), sandbox, { filename: 'artists-repo.js' });
    return { Artists: window.WeotziData.Artists, calls: rec.calls };
}

function configPublicColumns() {
    const src = read('public/shared/js/config-manager.js');
    const m = /window\.ARTIST_PUBLIC_COLUMNS\s*=\s*\[([\s\S]*?)\]\.join/.exec(src);
    assert.ok(m, 'config-manager define ARTIST_PUBLIC_COLUMNS');
    return [...stripSqlComments(m[1].replace(/\/\/.*$/gm, '')).matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
}

const selectOf = (entry) => (entry.chain.find((c) => c[0] === 'select') || [])[1];
const namesOf = (cols) => String(cols).split(',').map((c) => c.trim()).filter(Boolean);

test('migración: listas pública/privada disjuntas y todo lo sensible queda privado', () => {
    const sql = read(MIGRATION);
    const pub = sqlArray(sql, 'v_public');
    const priv = sqlArray(sql, 'v_private');
    assert.deepEqual(pub.filter((c) => priv.includes(c)), [], 'ninguna columna en las dos listas');
    MUST_BE_PRIVATE.forEach((c) => {
        assert.ok(priv.includes(c), c + ' en la lista privada');
        assert.ok(!pub.includes(c), c + ' fuera de la lista pública');
    });
    for (const c of ['user_id', 'username', 'name', 'profile_picture', 'styles_array', 'city', 'country', 'registration_status']) {
        assert.ok(pub.includes(c), c + ' sigue siendo pública');
    }
});

test('migración: revoca el SELECT de tabla y otorga solo columnas públicas', () => {
    const sql = stripSqlComments(read(MIGRATION));
    assert.match(sql, /revoke select on table public\.artists_db from anon, authenticated;/);
    assert.match(sql, /grant select \(%s\) on public\.artists_db to anon, authenticated/);
    assert.match(sql, /c\.column_name = any \(v_public\)/, 'intersecta con las columnas reales');
    assert.doesNotMatch(sql, /grant select on (table )?public\.artists_db to (anon|authenticated)/i, 'sin grant de tabla completo');
    assert.doesNotMatch(sql, /^\s*(begin|commit);/m, 'sin begin/commit propios (se valida dentro de begin … rollback)');
});

test('migración: get_my_artist_profile solo devuelve la fila propia y no es ejecutable por anon', () => {
    const sql = stripSqlComments(read(MIGRATION));
    const fn = /create or replace function public\.get_my_artist_profile\(\)[\s\S]*?\$\$;/.exec(sql)[0];
    assert.match(fn, /returns setof public\.artists_db/);
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = ''/);
    assert.match(fn, /a\.user_id = \(select auth\.uid\(\)\)/);
    assert.match(fn, /\(select auth\.uid\(\)\) is not null/);
    assert.match(sql, /revoke all on function public\.get_my_artist_profile\(\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.get_my_artist_profile\(\) to authenticated, service_role;/);
});

test('migración: support_list_artists exige is_support_user()', () => {
    const sql = stripSqlComments(read(MIGRATION));
    const fn = /create or replace function public\.support_list_artists\([\s\S]*?\$\$;/.exec(sql)[0];
    assert.match(fn, /security definer/);
    assert.match(fn, /if not coalesce\(public\.is_support_user\(\), false\) then\s+raise exception/);
    assert.match(fn, /errcode = '42501'/);
    assert.match(sql, /revoke all on function public\.support_list_artists\(uuid\[\]\) from public, anon;/);
});

test('migración: la vista artists_with_location no filtra datos exactos del artista', () => {
    const sql = stripSqlComments(read(MIGRATION));
    const view = /create view public\.artists_with_location[\s\S]*?;/.exec(sql)[0];
    for (const col of ['street', 'street_number', 'unit', 'postal_code', 'google_place_id', 'formatted_address', 'geocoded_at', 'geocoded_address', 'email', 'birth_date', 'whatsapp_number']) {
        assert.doesNotMatch(view, new RegExp('\\ba\\.' + col + '\\b'), 'la vista no lee a.' + col);
    }
    assert.match(view, /round\(a\.latitude::numeric, 2\)/);
    assert.match(view, /round\(a\.longitude::numeric, 2\)/);
    assert.doesNotMatch(view, /coalesce\(sl\.latitude,\s*a\.latitude\)/i);
    assert.match(view, /where a\.registration_status is distinct from 'incompleto'/);
    assert.match(view, /s\.website\s+as studio_website/, 'expone studio_website que pide el explorador');
    assert.match(sql, /grant select on public\.artists_with_location to anon, authenticated, service_role;/);
});

test('reversa: devuelve el SELECT de tabla y borra las RPCs', () => {
    const sql = read(ROLLBACK);
    assert.match(sql, /grant select on table public\.artists_db to anon, authenticated;/);
    assert.match(sql, /drop function if exists public\.get_my_artist_profile\(\);/);
    assert.match(sql, /drop function if exists public\.support_list_artists\(uuid\[\]\);/);
});

test('repo: listas idénticas a la migración', () => {
    const { Artists } = loadRepo();
    const sql = read(MIGRATION);
    assert.deepEqual([...Artists.PUBLIC_COLUMNS].sort(), sqlArray(sql, 'v_public').sort());
    assert.deepEqual([...Artists.PRIVATE_COLUMNS].sort(), sqlArray(sql, 'v_private').sort());
});

test('config-manager: ARTIST_PUBLIC_COLUMNS solo tiene columnas públicas', () => {
    const { Artists } = loadRepo();
    const cols = configPublicColumns();
    assert.ok(cols.length > 20);
    cols.forEach((c) => {
        assert.ok(Artists.PUBLIC_COLUMNS.includes(c), c + ' está en la lista blanca');
        assert.ok(!MUST_BE_PRIVATE.includes(c), c + ' no es sensible');
    });
});

test('repo: lecturas propias con columnas privadas van por get_my_artist_profile', () => {
    const { Artists, calls } = loadRepo();
    Artists.getByUserId('u1', '*');
    Artists.getDashboardByUserId('u1');
    Artists.getAccountByUserId('u1');
    Artists.getProfileByUserId('u1');
    Artists.getContactByUserId('u1');
    Artists.getByUserIdSingle('u1');
    Artists.getProfileByEmail('a@b.c');
    assert.equal(calls.length, 7);
    calls.forEach((c) => {
        assert.equal(c.kind, 'rpc');
        assert.equal(c.name, 'get_my_artist_profile');
    });
    assert.deepEqual(calls[0].chain.find((x) => x[0] === 'eq'), ['eq', 'user_id', 'u1']);
    assert.deepEqual(calls[6].chain.find((x) => x[0] === 'eq'), ['eq', 'email', 'a@b.c']);
});

test('repo: lecturas con columnas públicas siguen por la tabla', () => {
    const { Artists, calls } = loadRepo();
    Artists.getByUserId('u1', 'user_id, name');
    Artists.getGalleryFeedItems('u1');
    Artists.isUsernameAvailable('x', 'u1');
    Artists.searchCities('bue');
    calls.forEach((c) => assert.equal(c.kind === 'from' && c.name, 'artists_db'));
});

test('repo: lecturas de OTROS artistas nunca piden columnas privadas ni select(*)', () => {
    const { Artists, calls } = loadRepo();
    Artists.listPublic('*');
    Artists.listPublic('user_id, email, name, latitude, whatsapp_number');
    Artists.getPublicByUsername('ana', '*');
    Artists.getPublicByExactUsername('ana', 'username, birth_date, street');
    Artists.listByUserIds(['a'], '*');
    Artists.findByUsername('ana', 'user_id, email');
    Artists.listForMap();
    Artists.listForMap('user_id,latitude,longitude,street,formatted_address,studio_name');
    for (const c of calls) {
        assert.equal(c.kind, 'from');
        assert.equal(c.name, 'artists_db');
        const cols = namesOf(selectOf(c));
        assert.ok(!cols.includes('*'), 'sin select(*)');
        cols.forEach((col) => assert.ok(Artists.PUBLIC_COLUMNS.includes(col), col + ' es pública (' + c.chain[0][1] + ')'));
    }
});

test('repo: con window.ARTIST_PUBLIC_COLUMNS, "*" usa esa lista probada', () => {
    const list = 'user_id, username, name';
    const { Artists, calls } = loadRepo({ ARTIST_PUBLIC_COLUMNS: list });
    Artists.listPublic('*');
    assert.equal(selectOf(calls[0]), list);
});

test('repo: soporte por RPC, conteo y upsert sin select(*)', () => {
    const { Artists, calls } = loadRepo();
    Artists.listAll('*');
    Artists.listForSupport(['a', 'b'], 'user_id, email');
    Artists.count();
    Artists.upsertProfile({ user_id: 'u1' });
    assert.equal(calls[0].kind, 'rpc');
    assert.equal(calls[0].name, 'support_list_artists');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args)), { p_user_ids: ['a', 'b'] });
    assert.equal(selectOf(calls[2]), 'id');
    // upsert del registro: RPC (el upsert on_conflict directo da 42501 con
    // privilegios por columna), nunca la tabla.
    assert.equal(calls[3].kind, 'rpc');
    assert.equal(calls[3].name, 'upsert_my_artist_profile');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[3].args)), { p_profile: { user_id: 'u1' } });
    assert.ok(!calls.some((c) => c.kind === 'from' && c.chain.some((x) => x[0] === 'upsert')), 'sin upsert directo a artists_db');
});

function upsertFn(sql) {
    const m = /create or replace function public\.upsert_my_artist_profile\(p_profile jsonb\)[\s\S]*?\n\$\$;/.exec(sql);
    assert.ok(m, 'falta upsert_my_artist_profile');
    return m[0];
}

test('migración: upsert_my_artist_profile es definer, fuerza auth.uid() y solo escribe columnas editables', () => {
    const sql = stripSqlComments(read(MIGRATION));
    const fn = upsertFn(sql);
    assert.match(fn, /returns jsonb/);
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = public, pg_temp/);
    assert.match(fn, /v_uid uuid := auth\.uid\(\)/);
    assert.match(fn, /if v_uid is null then\s+raise exception[^;]*errcode = '42501'/);
    assert.match(fn, /insert into public\.artists_db as a \(user_id%1\$s\)\s+select \$1/, 'user_id = $1 (auth.uid())');
    assert.match(fn, /using v_uid, v_payload/);
    assert.match(fn, /on conflict \(user_id\) do update set/);
    assert.match(fn, /att\.attname <> 'user_id'/, 'user_id nunca sale del payload');
    assert.match(fn, /where e\.key = any \(v_editable\)/);
    for (const k of ['id', 'user_id', 'username', 'name', 'registration_status']) {
        assert.match(fn, new RegExp("''" + k + "'', a\\." + k), 'devuelve ' + k);
    }
    const editable = sqlArray(fn, 'v_editable constant');
    const forbidden = ['user_id', 'id', 'verification_state', 'is_recommended', 'embajador', 'nivel', 'artist_index',
        'idx', 'profile_completeness', 'index_updated_at', 'terms_accepted_at', 'terms_version',
        'registration_status', 'registration_submitted_at', 'registration_draft_id', 'registration_source',
        'registration_started_at', 'registration_last_saved_at', 'instagram_verified_at', 'instagram_verified_handle',
        'dashboard_config', 'custom_canvas_labels', 'password', 'email_confirmed'];
    forbidden.forEach((c) => assert.ok(!editable.includes(c), c + ' no es editable por el artista'));
    editable.forEach((c) => assert.ok(!/^ms_/.test(c), c + ' no es un hito'));
    // registration_status solo 'pendiente de validacion'; submitted_at lo pone el servidor
    assert.match(fn, /is distinct from 'pendiente de validacion' then\s+raise exception[^;]*errcode = '42501'/);
    assert.match(fn, /jsonb_build_object\('registration_submitted_at', now\(\)\)/);
    assert.match(sql, /revoke all on function public\.upsert_my_artist_profile\(jsonb\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.upsert_my_artist_profile\(jsonb\) to authenticated, service_role;/);
});

test('migración: upsert_my_artist_profile acepta todo lo que manda register.js (salvo lo del servidor)', () => {
    const fn = upsertFn(stripSqlComments(read(MIGRATION)));
    const editable = sqlArray(fn, 'v_editable constant');
    const src = read('public/shared/js/register.js');
    const start = src.indexOf('const artistData = {', src.indexOf('Final validation of birth_date'));
    assert.ok(start > 0, 'register.js arma artistData');
    const body = src.slice(start, src.indexOf('\n        };', start));
    const keys = [...body.matchAll(/^\s{12}([a-z_]+):/gm)].map((m) => m[1]);
    assert.ok(keys.length > 25, 'claves de artistData');
    const serverManaged = ['user_id', 'registration_status', 'registration_submitted_at'];
    keys.filter((k) => !serverManaged.includes(k))
        .forEach((k) => assert.ok(editable.includes(k), k + ' (register.js) está en v_editable'));
    assert.match(src, /WeotziData\.Artists\.upsertProfile\(artistData\)/);
});

test('migración: funciones invoker que leen columnas privadas pasan a definer y EXECUTE sin anon', () => {
    const sql = stripSqlComments(read(MIGRATION));
    const block = /do \$\$\s*declare\s*r record;[\s\S]*?'calculate_artist_index'[\s\S]*?end;\s*\$\$;/.exec(sql);
    assert.ok(block, 'bloque de funciones');
    const b = block[0];
    for (const name of ['calculate_artist_index', 'calculate_profile_completeness', 'validate_studio_booking',
        'sync_artists_db_studio_id_from_membership', 'check_artist_availability', 'check_style_match',
        'recalculate_all_artist_indexes']) {
        assert.ok(b.includes("'" + name + "'"), name + ' contemplada');
    }
    assert.match(b, /p\.oid::regprocedure/, 'por firma real (todas las sobrecargas)');
    assert.match(b, /if r\.proname in \('calculate_artist_index', 'calculate_profile_completeness'\) then\s+execute format\('alter function %s security definer', r\.fn\);\s+execute format\('alter function %s set search_path = public, pg_temp', r\.fn\);\s+execute format\('revoke all on function %s from public, anon', r\.fn\);\s+execute format\('grant execute on function %s to authenticated, service_role', r\.fn\);/);
    assert.match(b, /elsif r\.proname = 'validate_studio_booking' then[\s\S]*?execute format\('revoke all on function %s from public, anon, authenticated', r\.fn\);/);
    assert.doesNotMatch(b.slice(b.indexOf("elsif r.proname = 'validate_studio_booking'"), b.indexOf("elsif r.proname = 'sync_artists_db_studio_id_from_membership'")), /security definer/);
    // sin cuerpo en el repo / riesgo: no se convierten
    const definerCount = (b.match(/security definer/g) || []).length;
    assert.equal(definerCount, 1, 'solo la rama de calculate_* convierte a definer');
    assert.match(b, /elsif r\.proname = 'recalculate_all_artist_indexes' then\s+execute format\('revoke all on function %s from public, anon, authenticated', r\.fn\);\s+execute format\('grant execute on function %s to service_role', r\.fn\);/);
    assert.match(b, /else\s+execute format\('revoke all on function %s from public, anon', r\.fn\);/);
    assert.doesNotMatch(sql, /create or replace function public\.(calculate_artist_index|calculate_profile_completeness|validate_studio_booking|check_artist_availability|check_style_match|recalculate_all_artist_indexes)\b/, 'no redefine cuerpos');
});

test('reversa: borra upsert_my_artist_profile y devuelve las funciones a invoker', () => {
    const sql = read(ROLLBACK);
    assert.match(sql, /drop function if exists public\.upsert_my_artist_profile\(jsonb\);/);
    assert.match(sql, /alter function %s security invoker/);
});

test('validación v7: upsert por la RPC y update de bio con triggers', { skip: !fs.existsSync(path.join(root, 'output', 'figma-v3', 'sql', 'v7.sql')) && 'output/ no versionado' }, () => {
    const v7 = read('output/figma-v3/sql/v7.sql');
    const report = read('output/figma-v3/reports/r3c-pii-validacion.sql');
    assert.equal(v7.replace(/\r/g, ''), report.replace(/\r/g, ''), 'v7.sql y la del reporte son la misma');
    const mig = read(MIGRATION).replace(/\r/g, '').replace(/\nnotify pgrst, 'reload schema';\s*$/, '\n');
    assert.ok(v7.replace(/\r/g, '').includes(mig), 'incluye el cuerpo íntegro de la migración vigente');
    const tail = v7.slice(v7.indexOf('-- ===================== 4) Como OTRO'));
    assert.doesNotMatch(tail, /on conflict \(user_id\) do update/, 'el paso 4 ya no hace el upsert directo');
    assert.match(tail, /v_ret := public\.upsert_my_artist_profile\(/);
    assert.match(tail, /set bio_description = coalesce\(bio_description, ''\) \|\| ' \[pii-check\]'/);
    assert.match(tail, /index_updated_at/);
    assert.match(v7, /perform public\.upsert_my_artist_profile\('\{\}'::jsonb\);\s+raise exception 'FALLA anon/);
    assert.match(v7, /^begin;$/m);
    assert.match(v7, /^rollback;\s*$/m);
    assert.doesNotMatch(v7, /^commit;/m);
});

function publicJsFiles(dir = path.join(root, 'public')) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'demo-fixtures') continue;
            out.push(...publicJsFiles(full));
        } else if (/\.(js|html)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

test('código público: ningún select(*) ni columna privada leída directo de artists_db', () => {
    const { Artists } = loadRepo();
    const offenders = [];
    for (const file of publicJsFiles()) {
        const rel = path.relative(root, file).replace(/\\/g, '/');
        const src = fs.readFileSync(file, 'utf8');
        const re = /from\(\s*['"]artists_db['"]\s*\)\s*\.select\(\s*(['"`])([^'"`]*)\1/g;
        let m;
        while ((m = re.exec(src))) {
            const cols = namesOf(m[2]);
            const bad = cols.filter((c) => c === '*' || !Artists.PUBLIC_COLUMNS.includes(c));
            if (bad.length) offenders.push(rel + ': ' + bad.join(','));
        }
        // REST crudo a la tabla (las lecturas propias usan rpc/get_my_artist_profile).
        if (/['"`]artists_db\?/.test(src)) offenders.push(rel + ': REST crudo artists_db?');
        // Embeds de artists_db en otras tablas: solo columnas públicas.
        const embed = /artists_db\s*\(\s*([^)]*)\)/g;
        const code = src.split(/\r?\n/)
            .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
            .map((l) => l.replace(/\s\/\/.*$/, ''))
            .join('\n');
        while ((m = embed.exec(code))) {
            if (/^\s*['"]/.test(m[1])) continue; // from('artists_db')
            const bad = namesOf(m[1]).filter((c) => c === '*' || !Artists.PUBLIC_COLUMNS.includes(c));
            if (bad.length) offenders.push(rel + ': embed ' + bad.join(','));
        }
    }
    assert.deepEqual(offenders, []);
});

test('lectores directos: artist-auth, dashboard, cuenta, registro y soporte usan las RPCs', () => {
    const auth = read('public/shared/js/artist-auth.js');
    assert.match(auth, /rpc\/get_my_artist_profile\?\$\{searchParams\.toString\(\)\}/);
    assert.match(auth, /supabase\.rpc\('get_my_artist_profile'\)\.select\(artistSelect\)\.eq\('user_id', userId\)/);
    assert.match(read('public/shared/js/dashboard.js'), /path: `rpc\/get_my_artist_profile\?\$\{params\.toString\(\)\}`/);
    assert.match(read('public/shared/js/data/account-repo.js'), /c\.rpc\('get_my_artist_profile'\)\.select\(ACCOUNT_EXTRAS_SELECT\)/);
    assert.match(read('public/shared/js/data/registration-extras-repo.js'), /rpc\('get_my_artist_profile'\)\.select\('profile_links, newsletter_topics'\)/);
    assert.match(read('public/shared/js/data/support-verification-repo.js'), /c\.rpc\('support_list_artists', \{ p_user_ids: ids\.slice\(0, 300\) \}\)\.select\(ARTIST_SELECT\)/);
    assert.match(read('public/shared/js/admin.js'), /table === 'artists_db'\s*\?\s*await WeotziData\.Artists\.listForSupport\(null, '\*'\)/);
});

test('artist-auth: con cliente que tiene .rpc la fila propia sale de la RPC', async () => {
    const modulePath = path.join(root, 'public/shared/js/artist-auth.js');
    delete require.cache[modulePath];
    const ArtistAuth = require(modulePath);
    const seen = [];
    const builder = (kind, name) => {
        const b = { select: () => b, eq: (c, v) => { seen.push([kind, name, c, v]); return b; },
            maybeSingle: async () => ({ data: { user_id: 'u1', username: 'ana', email: 'ana@x.test', registration_status: 'aprobado' }, error: null }) };
        return b;
    };
    const supabase = {
        auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 't' } }, error: null }) },
        rpc: (fn) => builder('rpc', fn),
        from: (t) => builder('from', t)
    };
    const cm = { isDemoMode: () => false, getSupabaseClient: () => supabase, getRoutes: () => ({}) };
    const resolve = ArtistAuth.resolveArtistAuthState || (ArtistAuth.default && ArtistAuth.default.resolveArtistAuthState);
    assert.equal(typeof resolve, 'function');
    await resolve({ configManager: cm, root: {} }).catch(() => null);
    assert.ok(seen.length >= 1, 'hubo lookup');
    assert.deepEqual(seen[0].slice(0, 2), ['rpc', 'get_my_artist_profile']);
});

test('demo: get_my_artist_profile devuelve solo la fila propia; support_list_artists filtra por ids', () => {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/pii-artistas.js'), sandbox, { filename: 'pii-artistas.js' });
    const ext = sandbox.WoDemoFixtureExtensions['pii-artistas'];
    assert.equal(typeof ext, 'function');
    const ctx = { rpcs: {} };
    ext(ctx);
    const rows = [{ user_id: 'u1', email: 'a@x.test' }, { user_id: 'u2', email: 'b@x.test' }];
    const store = { rows: () => rows };
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.rpcs.get_my_artist_profile({}, store, { userId: 'u1' }))), [rows[0]]);
    assert.equal(ctx.rpcs.get_my_artist_profile({}, store, {}).length, 0);
    assert.equal(ctx.rpcs.support_list_artists({ p_user_ids: ['u2'] }, store).map((r) => r.user_id).join(), 'u2');
    assert.equal(ctx.rpcs.support_list_artists({}, store).length, 2);
    assert.ok(require('../public/shared/js/wo-demo-fixtures.js').EXTENSIONS.includes('pii-artistas'));
});

test('demo: upsert_my_artist_profile escribe solo la fila propia y las columnas editables', () => {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/pii-artistas.js'), sandbox, { filename: 'pii-artistas.js' });
    const ctx = { rpcs: {} };
    sandbox.WoDemoFixtureExtensions['pii-artistas'](ctx);
    const rows = [{ id: 'a1', user_id: 'u1', name: 'Ana', is_recommended: false }, { id: 'a2', user_id: 'u2', name: 'Beto' }];
    const store = { rows: () => rows, insert: (t, list) => { rows.push(...list); return list; } };
    const out = ctx.rpcs.upsert_my_artist_profile({ p_profile: {
        user_id: 'u2', name: 'Ana B', birth_date: '1990-01-01', is_recommended: true, registration_status: 'pendiente de validacion'
    } }, store, { userId: 'u1' });
    assert.equal(out.user_id, 'u1');
    assert.equal(out.name, 'Ana B');
    assert.equal(rows[0].birth_date, '1990-01-01');
    assert.equal(rows[0].is_recommended, false);
    assert.equal(rows[1].name, 'Beto');
    ctx.rpcs.upsert_my_artist_profile({ p_profile: { name: 'Nueva' } }, store, { userId: 'u3' });
    assert.equal(rows.length, 3);
    assert.throws(() => ctx.rpcs.upsert_my_artist_profile({ p_profile: {} }, store, {}));
    // misma lista blanca que la migración
    const fixtureSrc = read('public/shared/js/demo-fixtures/pii-artistas.js');
    const fixtureList = [.../var EDITABLE = \[([\s\S]*?)\];/.exec(fixtureSrc)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(fixtureList.sort(), sqlArray(upsertFn(read(MIGRATION)), 'v_editable constant').sort());
});
