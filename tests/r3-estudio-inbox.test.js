'use strict';
// Ronda 3 · grupo estudio-inbox: inbox del estudio (lado estudio de 2007:5795,
// spots, invitaciones y vínculos de viaje) y respuesta a las solicitudes de
// cambio de invitaciones (801:1101). Cubre la lógica pura
// (studio-inbox-model.js), el contrato de la migración 20261112210000, las
// fixtures del preview contra el emulador PostgREST y el cableado del panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const M = require('../public/shared/js/studio-inbox-model.js');

const MIGRATION = 'supabase/migrations/20261112210000_estudio_inbox.sql';
const ROLLBACK = 'supabase/rollbacks/20261112210000_estudio_inbox.down.sql';

function row(overrides) {
    return Object.assign({
        id: 't1', category: 'studios', context_type: 'studio_contact', context_id: 's1',
        artist_user_id: 'a1', artist_name: 'Martina Ríos', artist_username: 'martina.rios', artist_avatar: null,
        subject: 'Guest spot · Costa Ink', context: { studio_id: 's1', reason: 'guest_spot', reason_label: 'Guest spot' },
        status: 'open', is_priority: false, last_message: 'Hola, quiero hacer un guest spot', last_message_at: '2026-11-12T10:00:00Z',
        last_sender_role: 'artist', is_participant: false, is_favorite: false, is_archived: false, unread_count: 2,
        pending_change_request: null, created_at: '2026-11-12T09:00:00Z'
    }, overrides || {});
}

/* ------------------------------ modelo puro ------------------------------ */

test('normalizeThread mapea context_type a categorías del estudio y estado de respuesta', () => {
    const t = M.normalizeThread(row());
    assert.equal(t.filter, 'contact');
    assert.equal(t.label, 'Consulta');
    assert.equal(t.initials, 'MR');
    assert.equal(t.unread, 2);
    assert.deepEqual(t.response, { key: 'waiting', label: 'Esperando tu respuesta', cls: 'is-waiting' });
    assert.equal(M.normalizeThread(row({ context_type: 'studio_spot_application' })).filter, 'spots');
    assert.equal(M.normalizeThread(row({ context_type: 'studio_invitation' })).filter, 'invitations');
    assert.equal(M.normalizeThread(row({ context_type: 'studio_contract' })).label, 'Contrato');
    assert.equal(M.normalizeThread(row({ context_type: 'trip_studio_link' })).filter, 'trips');
    assert.equal(M.normalizeThread(row({ last_sender_role: 'studio' })).response.key, 'replied');
    assert.equal(M.normalizeThread(row({ last_sender_role: 'system' })).response.key, 'activity');
    assert.equal(M.normalizeThread(row({ status: 'closed' })).response.key, 'closed');
    assert.equal(M.normalizeThread(row({ artist_name: '', artist_username: 'nico' })).name, '@nico');
});

test('filterThreads y counts separan archivados, favoritos, cambios pedidos y búsqueda sin tildes', () => {
    const threads = [
        row({ id: 'a' }),
        row({ id: 'b', context_type: 'studio_spot_application', last_sender_role: 'studio', unread_count: 0, is_favorite: true }),
        row({ id: 'c', context_type: 'studio_invitation', pending_change_request: { id: 'r1', message: 'Cambiar fechas' }, artist_name: 'Lucía Paz' }),
        row({ id: 'd', context_type: 'trip_studio_link', is_archived: true })
    ].map(M.normalizeThread);
    assert.deepEqual(M.filterThreads(threads, 'all', '').map(t => t.id), ['a', 'b', 'c']);
    assert.deepEqual(M.filterThreads(threads, 'archived', '').map(t => t.id), ['d']);
    assert.deepEqual(M.filterThreads(threads, 'favorites', '').map(t => t.id), ['b']);
    assert.deepEqual(M.filterThreads(threads, 'changes', '').map(t => t.id), ['c']);
    assert.deepEqual(M.filterThreads(threads, 'spots', '').map(t => t.id), ['b']);
    assert.deepEqual(M.filterThreads(threads, 'all', 'lucia').map(t => t.id), ['c']);
    const c = M.counts(threads);
    assert.equal(c.all, 3);
    assert.equal(c.archived, 1);
    assert.equal(c.contact, 1);
    assert.equal(c.invitations, 1);
    assert.equal(c.trips, 0);
    assert.equal(c.waiting, 2);
    assert.equal(c.replied, 1);
    assert.equal(c.changes, 1);
    assert.equal(c.unread, 2);
    assert.equal(M.unreadTotal(threads), 4, 'los archivados no suman al badge');
});

test('listTime usa el formato del inbox del artista (hora, ayer, día corto, fecha)', () => {
    const now = new Date(2026, 10, 12, 18, 0);
    assert.equal(M.listTime(new Date(2026, 10, 12, 9, 5), now), '09:05');
    assert.equal(M.listTime(new Date(2026, 10, 11, 9, 5), now), 'ayer');
    assert.equal(M.listTime(new Date(2026, 10, 9, 9, 5), now), 'lun');
    assert.equal(M.listTime(new Date(2026, 9, 1, 9, 5), now), '01 oct');
    assert.equal(M.listTime(null, now), '');
    assert.equal(M.dateRange('2026-12-02', '2026-12-16'), '2 dic 2026 – 16 dic 2026');
});

test('contextRows y contextAction arman el panel de contexto por tipo de hilo', () => {
    const contact = M.contextRows(M.normalizeThread(row({ context: { reason: 'guest_spot', start_date: '2026-12-27', end_date: '2027-01-10', portfolio_url: '/artist/profile?artist=x' } })));
    assert.equal(contact.eyebrow, 'CONSULTA');
    assert.deepEqual(contact.rows.map(r => r.label), ['Motivo', 'Fechas tentativas', 'Portfolio']);
    const invitation = M.normalizeThread(row({ context_type: 'studio_invitation', context: { role: 'guest', membership_status: 'pending_acceptance' }, pending_change_request: { id: 'r1' } }));
    const info = M.contextRows(invitation);
    assert.equal(info.status.label, 'Invitación pendiente');
    assert.equal(info.status.tone, 'warning');
    assert.deepEqual(M.contextAction(invitation), { tab: 'roster', label: 'Responder la solicitud de cambios' });
    assert.equal(M.contextAction(M.normalizeThread(row({ context_type: 'trip_studio_link' }))).tab, 'travel');
    assert.equal(M.contextAction(M.normalizeThread(row({ context_type: 'studio_spot_application' }))).tab, 'spots');
    assert.equal(M.contextAction(M.normalizeThread(row())), null);
});

test('messageRole: propio del estudio a la derecha, sistema centrado, artista a la izquierda', () => {
    assert.equal(M.messageRole({ sender_role: 'studio', sender_user_id: 'x' }, 'owner'), 'out');
    assert.equal(M.messageRole({ sender_role: 'artist', sender_user_id: 'owner' }, 'owner'), 'out');
    assert.equal(M.messageRole({ sender_role: 'artist', sender_user_id: 'a1' }, 'owner'), 'in');
    assert.equal(M.messageRole({ sender_role: 'system', message_kind: 'system' }, 'owner'), 'system');
    assert.equal(M.validateMessage('  '), 'Escribí un mensaje.');
    assert.match(M.validateMessage('x'.repeat(2001)), /2000/);
    assert.equal(M.validateMessage('Hola'), null);
});

test('buildChanges devuelve solo lo que cambió y validateResponse replica las reglas de la RPC', () => {
    const request = {
        membership: { role: 'guest', location_id: 'l1', revenue_split_pct: 60, has_contract: false },
        details: { proposed_start_date: '2026-12-02', proposed_end_date: '2026-12-16', duration_label: '2 semanas', message: 'Hola' }
    };
    const same = { role: 'guest', location_id: 'l1', revenue_split_pct: '60', proposed_start_date: '2026-12-02', proposed_end_date: '2026-12-16', duration_label: '2 semanas', message: 'Hola' };
    assert.deepEqual(M.buildChanges(same, request), {});
    const changed = M.buildChanges(Object.assign({}, same, { revenue_split_pct: '70', proposed_start_date: '2026-12-09', proposed_end_date: '2026-12-23' }), request);
    assert.deepEqual(changed, { revenue_split_pct: 70, proposed_start_date: '2026-12-09', proposed_end_date: '2026-12-23' });
    assert.deepEqual(M.buildChanges({ location_id: '' }, request), { location_id: null }, 'sin asignar sede');
    const today = '2026-11-12';
    assert.equal(M.validateResponse('accepted', '', changed, request, today), null);
    assert.match(M.validateResponse('accepted', '', {}, request, today), /No hay cambios/);
    assert.match(M.validateResponse('declined', 'corto', {}, request, today), /mínimo 10/);
    assert.equal(M.validateResponse('declined', 'Mantenemos las fechas por agenda.', {}, request, today), null);
    assert.match(M.validateResponse('accepted', '', { revenue_split_pct: 120 }, request, today), /entre 0 y 100/);
    assert.match(M.validateResponse('accepted', '', { proposed_end_date: '2026-11-30' }, request, today), /anterior al inicio/);
    assert.match(M.validateResponse('accepted', '', { proposed_start_date: '2026-11-01' }, request, today), /pasado/);
    assert.match(M.validateResponse('accepted', '', { role: 'resident' }, { membership: { has_contract: true } }, today), /nueva versión del contrato/);
    assert.match(M.validateResponse('maybe', '', {}, request, today), /Elegí/);
    assert.equal(M.changeRequestSummary(request), 'Guest · Split 60% · 2 dic 2026 – 16 dic 2026 · 2 semanas');
});

test('friendlyError limpia el prefijo del repo y traduce errores en inglés', () => {
    assert.equal(M.friendlyError({ message: '[studioInbox.respondChangeRequest] Esta solicitud ya fue respondida.' }), 'Esta solicitud ya fue respondida.');
    assert.equal(M.friendlyError({ message: '[x] thread not found' }), 'No encontramos esa conversación en tu estudio.');
    assert.equal(M.friendlyError({ message: '[x] boom', cause: { message: 'authentication required' } }), 'Tu sesión venció. Volvé a ingresar.');
    assert.equal(M.friendlyError({ message: 'random failure' }), 'No pudimos completar la acción. Intentá nuevamente.');
});

/* ------------------------------ migración ------------------------------ */

test('la migración del inbox del estudio es aditiva, con dueño verificado y reversa', () => {
    const sql = read(MIGRATION);
    const down = read(ROLLBACK);
    for (const fn of ['list_studio_inbox_threads', 'open_studio_inbox_thread', 'list_studio_invitation_change_requests', 'respond_studio_invitation_change_request']) {
        assert.match(sql, new RegExp('create or replace function public\\.' + fn + '\\('), fn);
        assert.match(sql, new RegExp('grant execute on function public\\.' + fn + '\\([^)]*\\) to authenticated;'), 'grant ' + fn);
        assert.match(sql, new RegExp('revoke all on function public\\.' + fn + '\\([^)]*\\) from public, anon;'), 'revoke ' + fn);
        assert.match(down, new RegExp('drop function if exists public\\.' + fn + '\\('), 'down ' + fn);
    }
    // Toda RPC nueva verifica al dueño del estudio antes de leer o escribir.
    assert.equal((sql.match(/private\.is_studio_owner\(p_studio_id\)/g) || []).length, 3);
    assert.match(sql, /v_studio\.user_id is distinct from auth\.uid\(\)/, 'respond verifica dueño');
    assert.equal((sql.match(/security definer/g) || []).length >= 7, true);
    assert.doesNotMatch(sql, /\bdrop table\b|\balter table\b[^;]*drop|create table/i, 'sin tablas nuevas ni drops');
    assert.doesNotMatch(sql, /using \(true\)/i);
    // Solo hilos de estudio: Job Board (artista↔cliente) no entra.
    assert.match(sql, /'studio_contact', 'studio_spot_application', 'studio_invitation',\s*'studio_contract', 'trip_studio_link'/);
    assert.doesNotMatch(sql, /'job_board_application'/);
    // respond: lista blanca de campos y reglas del guard de memberships.
    assert.match(sql, /Campo no editable: %/);
    assert.match(sql, /El rol y el reparto se editan con una nueva versión del contrato\./);
    assert.match(sql, /private\.lock_studio_artist_pair/);
    // request_studio_invitation_changes conserva firma y errores, y publica en el hilo.
    assert.match(sql, /create or replace function public\.request_studio_invitation_changes\(p_membership_id uuid, p_message text\)/);
    assert.match(sql, /'message must contain 10 to 1000 characters'/);
    assert.match(sql, /'pending invitation not found'/);
    assert.match(sql, /'Solicitud de cambios: ' \|\| btrim\(p_message\)/);
    assert.match(down, /create or replace function public\.request_studio_invitation_changes/);
    assert.doesNotMatch(down, /Solicitud de cambios: /, 'la reversa vuelve a la versión sin hilo');
    // Backfill idempotente.
    assert.match(sql, /on conflict \(thread_id, user_id\) do nothing/);
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
    return { fx, store, Fixtures };
}
function rpc(store, fn, args, userId) {
    const res = store.handle({ method: 'POST', path: 'rpc/' + fn, search: '', headers: {}, body: JSON.stringify(args || {}), ctx: { userId } });
    return { status: res.status, body: res.body == null ? null : JSON.parse(res.body) };
}

test('fixtures: el estudio de preview ve sus hilos, los abre, responde y resuelve cambios', () => {
    const { fx, store, Fixtures } = buildPreview();
    assert.ok(Fixtures.EXTENSIONS.includes('estudio-inbox'));
    const studio = fx.tables.studios.find(s => s.slug === 'costa-ink-collective');
    assert.ok(studio && /-aaaa-4aaa-8aaa-/.test(studio.user_id), 'cuenta ficticia del estudio');
    const owner = studio.user_id;

    const denied = rpc(store, 'list_studio_inbox_threads', { p_studio_id: studio.id }, '11111111-1111-4111-8111-111111111111');
    assert.equal(denied.status, 400, 'otro usuario no lee el inbox del estudio');

    const list = rpc(store, 'list_studio_inbox_threads', { p_studio_id: studio.id }, owner);
    assert.equal(list.status, 200);
    const threads = list.body.map(M.normalizeThread);
    assert.equal(threads.length, 5);
    assert.deepEqual([...new Set(threads.map(t => t.filter))].sort(), ['contact', 'invitations', 'spots', 'trips']);
    const invitation = threads.find(t => t.pendingChange);
    assert.ok(invitation, 'la invitación con cambios pedidos trae pending_change_request');

    const artistList = rpc(store, 'list_artist_inbox_threads', {}, '11111111-1111-4111-8111-111111111111');
    assert.equal(artistList.body.some(t => t.id === invitation.id), false, 'el inbox del artista de preview no cambia');

    assert.equal(rpc(store, 'open_studio_inbox_thread', { p_studio_id: studio.id, p_thread_id: invitation.id }, owner).status, 200);
    const sent = rpc(store, 'send_inbox_message', { p_thread_id: invitation.id, p_body: 'Lo vemos y te respondemos.' }, owner);
    assert.equal(sent.body.sender_role, 'studio');

    const requests = rpc(store, 'list_studio_invitation_change_requests', { p_studio_id: studio.id }, owner).body;
    assert.equal(requests[0].status, 'pending');
    const changes = M.buildChanges({ proposed_start_date: '2099-01-10', proposed_end_date: '2099-01-24' }, requests[0]);
    assert.equal(M.validateResponse('accepted', 'Movimos el inicio.', changes, requests[0], '2026-11-12'), null);
    const done = rpc(store, 'respond_studio_invitation_change_request', { p_request_id: requests[0].id, p_decision: 'accepted', p_reply: 'Movimos el inicio.', p_changes: changes }, owner);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'accepted');
    assert.equal(rpc(store, 'respond_studio_invitation_change_request', { p_request_id: requests[0].id, p_decision: 'declined', p_reply: 'Otra respuesta más.' }, owner).status, 400);
    const after = rpc(store, 'list_studio_inbox_threads', { p_studio_id: studio.id }, owner).body.find(t => t.id === invitation.id);
    assert.equal(after.pending_change_request, null);
    assert.equal(after.last_sender_role, 'studio');
});

/* ------------------------------ cableado UI ------------------------------ */

test('el panel del estudio carga la pestaña Mensajes, el bloque de cambios y los scripts en orden', () => {
    const html = read('public/studio/dashboard/index.html');
    assert.match(html, /data-tab="mensajes">Mensajes<\/a>/);
    assert.match(html, /data-panel="mensajes"/);
    for (const id of ['si-shell', 'si-search', 'si-filters', 'si-list', 'si-thread', 'si-messages', 'si-composer', 'si-context', 'roster-change-requests']) {
        assert.match(html, new RegExp('id="' + id + '"'), id);
    }
    const order = ['data/postgrest-client.js', 'data/studios-repo.js', 'data/inbox-repo.js', 'data/studio-inbox-repo.js', 'studio-auth.js', 'studio-inbox-model.js', 'studio-inbox.js', 'studio-invitation-changes.js'];
    const positions = order.map(file => html.indexOf('/shared/js/' + file + '"'));
    positions.forEach((pos, i) => assert.ok(pos > 0, order[i] + ' cargado'));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'orden de scripts');
    assert.match(html, /studio-inbox-ds\.css/);
    const organisms = read('public/shared/js/ds/organisms.js');
    assert.match(organisms, /\{ id: 'mensajes', label: 'MENSAJES' \}/);
    for (const icon of ['search', 'paperclip', 'star', 'archive', 'message-circle', 'download', 'image', 'edit-2', 'info']) {
        assert.ok(fs.existsSync(path.join(root, 'public/shared/assets/feather-studio', icon + '.svg')), 'ícono ' + icon);
    }
    const ui = read('public/shared/js/studio-inbox.js') + read('public/shared/js/studio-invitation-changes.js');
    assert.doesNotMatch(ui, /\.from\(['"]|fetch\(['"]\/rest\/v1/, 'sin CRUD ad-hoc: todo por WeotziData');
});
