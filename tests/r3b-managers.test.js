'use strict';
// Ronda 3b · grupo managers: los managers activos del estudio
// (studio_artist_memberships role='manager', status='active') responden en el
// inbox del estudio y las solicitudes de cambio, sin ganar permisos de dueño.
// Cubre el contrato de la migración 20261113101000 (+ reversa), las fixtures
// del preview contra el emulador PostgREST y el cableado del panel/login.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const MIGRATION = 'supabase/migrations/20261113101000_studio_inbox_managers.sql';
const ROLLBACK = 'supabase/rollbacks/20261113101000_studio_inbox_managers.down.sql';
const BASE = 'supabase/migrations/20261112210000_estudio_inbox.sql';

const RPCS = ['list_studio_inbox_threads', 'open_studio_inbox_thread',
    'list_studio_invitation_change_requests', 'respond_studio_invitation_change_request'];

// Cuerpo de una función (desde "create or replace function <name>(" hasta el "$$;" que la cierra).
function fnBody(sql, name) {
    const start = sql.indexOf('create or replace function ' + name + '(');
    assert.ok(start >= 0, 'definida ' + name);
    const open = sql.indexOf('$$', start);
    const close = sql.indexOf('$$;', open + 2);
    return sql.slice(start, close + 3).replace(/\r\n/g, '\n');
}

/* ------------------------------ migración ------------------------------ */

test('la migración define el helper is_studio_inbox_member (dueño o manager activo)', () => {
    const sql = read(MIGRATION);
    const accessFor = fnBody(sql, 'private.studio_inbox_access_for');
    assert.match(accessFor, /s\.user_id = p_user_id[\s\S]*then 'owner'/);
    assert.match(accessFor, /m\.role = 'manager'\s+and m\.status = 'active'[\s\S]*then 'manager'/);
    assert.match(accessFor, /security definer\s+set search_path = ''/);
    assert.match(fnBody(sql, 'private.is_studio_inbox_member'), /studio_inbox_access_for\(p_studio_id, auth\.uid\(\)\) is not null/);
    for (const sig of ['private.studio_inbox_access_for(uuid, uuid)', 'private.studio_inbox_access(uuid)', 'private.is_studio_inbox_member(uuid)']) {
        assert.ok(sql.includes('revoke all on function ' + sig + ' from public, anon, authenticated;'), 'revoke ' + sig);
    }
});

test('list/open del inbox y list de solicitudes cambian solo el chequeo de acceso', () => {
    const sql = read(MIGRATION);
    const base = read(BASE);
    for (const fn of ['public.list_studio_inbox_threads', 'public.open_studio_inbox_thread']) {
        const now = fnBody(sql, fn);
        assert.match(now, /if not private\.is_studio_inbox_member\(p_studio_id\) then/, fn);
        assert.doesNotMatch(now, /is_studio_owner/, fn);
        assert.equal(now, fnBody(base, fn).replace('private.is_studio_owner(p_studio_id)', 'private.is_studio_inbox_member(p_studio_id)'), fn + ' igual al original salvo el chequeo');
    }
    const reqs = fnBody(sql, 'public.list_studio_invitation_change_requests');
    assert.match(reqs, /is_studio_inbox_member\(p_studio_id\)/);
    assert.match(reqs, /studio_inbox_access\(p_studio_id\) = 'owner' or m\.artist_user_id is distinct from auth\.uid\(\)/,
        'el manager no ve pedidos sobre su propia membresía');
    // El manager que también es artista no ve como estudio sus propios hilos.
    assert.match(fnBody(sql, 'public.list_studio_inbox_threads'), /t\.artist_user_id is distinct from auth\.uid\(\)/);
});

test('respond_studio_invitation_change_request: manager con límites (sin reparto, sin managers, sin lo propio)', () => {
    const body = fnBody(read(MIGRATION), 'public.respond_studio_invitation_change_request');
    assert.doesNotMatch(body, /v_studio\.user_id is distinct from auth\.uid\(\)/, 'ya no exige solo dueño');
    assert.match(body, /v_access := private\.studio_inbox_access\(v_membership\.studio_id\);\s+if v_access is null then\s+raise exception 'Solicitud no encontrada\.'/);
    assert.match(body, /v_access = 'manager'[\s\S]*v_membership\.artist_user_id = auth\.uid\(\)/);
    assert.match(body, /v_membership\.role = 'manager' then\s+raise exception 'Solo el dueño del estudio responde invitaciones de managers\.'/);
    assert.match(body, /v_access = 'manager' and v_role = 'manager'/);
    assert.match(body, /v_access = 'manager' and v_split is distinct from v_membership\.revenue_split_pct/);
    // El chequeo de acceso va antes del lock y de cualquier escritura.
    assert.ok(body.indexOf('v_access := ') < body.indexOf('lock_studio_artist_pair'));
    assert.ok(body.indexOf('v_access := ') < body.indexOf('update public.studio_artist_memberships'));
    // Misma firma y errores de validación que la versión del dueño.
    assert.match(body, /p_request_id uuid,\s+p_decision text,\s+p_reply text default null,\s+p_changes jsonb default '\{\}'::jsonb/);
    assert.match(body, /Esta solicitud ya fue respondida\./);
});

test('revocación al pausar/terminar un manager, guard de mensajes y RPC de acceso', () => {
    const sql = read(MIGRATION);
    const revoke = fnBody(sql, 'private.revoke_studio_manager_inbox');
    assert.match(revoke, /old\.role = 'manager' and old\.status = 'active'/);
    assert.match(revoke, /studio_inbox_access_for\(old\.studio_id, old\.artist_user_id\) is not null/, 'si sigue con acceso no se toca');
    assert.match(revoke, /delete from public\.inbox_thread_participants p[\s\S]*p\.participant_role = 'studio'/);
    assert.match(sql, /drop trigger if exists trg_revoke_studio_manager_inbox on public\.studio_artist_memberships;\s+create trigger trg_revoke_studio_manager_inbox\s+after update of role, status, studio_id, artist_user_id or delete on public\.studio_artist_memberships/);
    const guard = fnBody(sql, 'private.guard_studio_inbox_message');
    assert.match(guard, /new\.sender_role is distinct from 'studio' or new\.sender_user_id is null/);
    assert.match(guard, /errcode = '42501'/);
    assert.match(sql, /create trigger trg_guard_studio_inbox_message\s+before insert on public\.inbox_messages/);
    const access = fnBody(sql, 'public.list_my_studio_access');
    assert.match(access, /m\.role = 'manager'\s+and m\.status = 'active'/);
    assert.match(sql, /grant execute on function public\.list_my_studio_access\(\) to authenticated;/);
    assert.match(sql, /revoke all on function public\.list_my_studio_access\(\) from public, anon;/);
    for (const fn of RPCS) {
        assert.match(sql, new RegExp('grant execute on function public\\.' + fn + '\\([^)]*\\) to authenticated;'), 'grant ' + fn);
    }
});

test('la migración es aditiva/idempotente y la reversa vuelve a "solo dueño"', () => {
    const sql = read(MIGRATION);
    const down = read(ROLLBACK);
    assert.doesNotMatch(sql, /\bdrop table\b|\balter table\b[^;]*\bdrop\b|\btruncate\b/i, 'sin cambios destructivos de esquema');
    assert.doesNotMatch(sql, /^\s*create index (?!if not exists)/m, 'índices idempotentes');
    assert.doesNotMatch(sql, /^\s*create function /m, 'funciones con create or replace');
    (sql.match(/^create trigger (\w+)/gm) || []).forEach(line => {
        const name = line.split(' ')[2];
        assert.ok(sql.includes('drop trigger if exists ' + name), 'trigger idempotente ' + name);
    });
    const base = read(BASE);
    for (const fn of RPCS) {
        assert.equal(fnBody(down, 'public.' + fn), fnBody(base, 'public.' + fn), 'la reversa restaura ' + fn + ' tal cual');
    }
    for (const drop of ['drop trigger if exists trg_guard_studio_inbox_message', 'drop trigger if exists trg_revoke_studio_manager_inbox',
        'drop function if exists public.list_my_studio_access()', 'drop function if exists private.is_studio_inbox_member(uuid)',
        'drop function if exists private.studio_inbox_access_for(uuid, uuid)', 'drop index if exists public.idx_sam_active_managers']) {
        assert.ok(down.includes(drop), drop);
    }
    // Las funciones restauradas se borran DESPUÉS de recrear las RPC que ya no las usan.
    assert.ok(down.indexOf('drop function if exists private.is_studio_inbox_member') > down.lastIndexOf('create or replace function'));
    assert.doesNotMatch(down, /is_studio_inbox_member\(p_studio_id\)/);
});

/* --------------------------- fixtures del preview -------------------------- */

function buildPreview() {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/estudio-inbox.js'), sandbox, { filename: 'estudio-inbox.js' });
    global.self = sandbox;
    delete require.cache[require.resolve('../public/shared/js/wo-demo-fixtures.js')];
    const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');
    const Postgrest = require('../public/shared/js/wo-demo-postgrest.js');
    const fx = Fixtures.build({ userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo', email: 'demo@weotzi.test' });
    const store = Postgrest.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views });
    return { fx, store };
}
function rpc(store, fn, args, userId) {
    const res = store.handle({ method: 'POST', path: 'rpc/' + fn, search: '', headers: {}, body: JSON.stringify(args || {}), ctx: { userId } });
    return { status: res.status, body: res.body == null ? null : JSON.parse(res.body) };
}

test('fixtures: el manager activo usa el inbox y responde cambios; pausado u otro usuario no', () => {
    const { fx, store } = buildPreview();
    const studio = fx.tables.studios.find(s => s.slug === 'costa-ink-collective');
    const owner = studio.user_id;
    const managerRow = fx.tables.studio_artist_memberships.find(m => m.studio_id === studio.id && m.role === 'manager');
    assert.ok(managerRow && managerRow.status === 'active', 'hay un manager activo en el preview');
    const manager = managerRow.artist_user_id;
    const stranger = '11111111-1111-4111-8111-111111111111';

    const access = rpc(store, 'list_my_studio_access', {}, manager).body;
    assert.deepEqual(access.map(r => [r.studio_id, r.access]), [[studio.id, 'manager']]);
    assert.equal(rpc(store, 'list_my_studio_access', {}, owner).body[0].access, 'owner');
    assert.deepEqual(rpc(store, 'list_my_studio_access', {}, stranger).body, []);

    const threads = rpc(store, 'list_studio_inbox_threads', { p_studio_id: studio.id }, manager);
    assert.equal(threads.status, 200);
    assert.equal(threads.body.length, 5);
    const invitation = threads.body.find(t => t.pending_change_request);
    assert.equal(rpc(store, 'open_studio_inbox_thread', { p_studio_id: studio.id, p_thread_id: invitation.id }, manager).status, 200);
    const sent = rpc(store, 'send_inbox_message', { p_thread_id: invitation.id, p_body: 'Soy Sofía, manager del estudio.' }, manager);
    assert.equal(sent.body.sender_role, 'studio', 'el manager escribe como estudio');

    const requests = rpc(store, 'list_studio_invitation_change_requests', { p_studio_id: studio.id }, manager).body;
    const pending = requests.find(r => r.status === 'pending');
    const splitChange = rpc(store, 'respond_studio_invitation_change_request',
        { p_request_id: pending.id, p_decision: 'accepted', p_changes: { revenue_split_pct: 80 } }, manager);
    assert.equal(splitChange.status, 400, 'el manager no cambia el reparto');
    const roleChange = rpc(store, 'respond_studio_invitation_change_request',
        { p_request_id: pending.id, p_decision: 'accepted', p_changes: { role: 'manager' } }, manager);
    assert.equal(roleChange.status, 400, 'el manager no nombra managers');
    const ok = rpc(store, 'respond_studio_invitation_change_request',
        { p_request_id: pending.id, p_decision: 'accepted', p_reply: 'Movimos el inicio una semana.', p_changes: { proposed_start_date: '2099-01-10' } }, manager);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'accepted');

    // Pausado: pierde el acceso a todo el inbox del estudio.
    store.rows('studio_artist_memberships').find(m => m.id === managerRow.id).status = 'paused';
    assert.equal(rpc(store, 'list_studio_inbox_threads', { p_studio_id: studio.id }, manager).status, 400);
    assert.equal(rpc(store, 'list_studio_invitation_change_requests', { p_studio_id: studio.id }, manager).status, 400);
    assert.deepEqual(rpc(store, 'list_my_studio_access', {}, manager).body, []);
    assert.equal(rpc(store, 'list_studio_inbox_threads', { p_studio_id: studio.id }, stranger).status, 400);
    assert.equal(rpc(store, 'list_studio_inbox_threads', { p_studio_id: studio.id }, owner).status, 200, 'el dueño sigue');
});

/* ------------------------------ cableado UI ------------------------------ */

test('login y panel: el manager resuelve su estudio por list_my_studio_access y ve solo Mensajes y Equipo', () => {
    const repo = read('public/shared/js/data/studios-repo.js');
    assert.match(repo, /listMyAccess\(\) \{\s+return client\(\)\.rpc\('list_my_studio_access'\);/);

    const auth = read('public/shared/js/studio-auth.js');
    assert.match(auth, /return includeManaged \? resolveManagedStudio\(\) : null;/, 'después del estudio propio y del borrador de registro');
    assert.match(auth, /includeManaged: !path\.startsWith\('\/studio\/register'\)/, 'en registro un manager puede crear su estudio');
    assert.match(auth, /access: 'manager'/);
    assert.doesNotMatch(auth.slice(auth.indexOf('async function resolveManagedStudio')), /user_id:/, 'el estudio del manager no lleva el user_id del dueño');

    const dash = read('public/shared/js/studio-dashboard.js');
    assert.match(dash, /const MANAGER_TABS = \['mensajes', 'roster'\];/);
    assert.match(dash, /if \(studio\.access === 'manager'\) \{[\s\S]*?applyManagerMode\(studio\);\s+wireTabs\(\);\s+return;/,
        'no carga perfil, sedes, roster ni spots');
    assert.match(dash, /\.studio-invite-form, #roster-content/, 'sin invitar ni editar el roster');

    assert.match(read('public/shared/js/studio-dashboard-ops.js'), /studio && studio\.access !== 'manager'/);
    assert.match(read('public/shared/js/studio-travel-links.js'), /studio\.access === 'manager'\) return;/);
    assert.match(read('public/shared/css/studio-inbox-ds.css'),
        /body\[data-studio-access="manager"\] \.studio-dash-tab\[data-tab\]:not\(\[data-tab="mensajes"\]\):not\(\[data-tab="roster"\]\)/);

    const changes = read('public/shared/js/studio-invitation-changes.js');
    assert.match(changes, /filter\(role => !manager \|\| role !== 'manager' \|\| role === m\.role\)/);
    assert.match(changes, /\(locked \|\| manager \? ' disabled' : ''\)/, 'reparto bloqueado para el manager');
    const ui = read('public/shared/js/studio-auth.js') + changes + read('public/shared/js/studio-dashboard.js');
    assert.doesNotMatch(ui, /\.from\(['"]studio_artist_memberships|fetch\(['"]\/rest\/v1/, 'sin CRUD ad-hoc');
});
