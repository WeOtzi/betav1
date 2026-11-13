'use strict';

// Ronda 3c · grupo "borrado": bajas de cuenta gestionadas por soporte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AD = require('../lib/account-deletion');
const Widget = require('../public/shared/js/account-deletion.js')._internal;
const Queue = require('../public/shared/js/support-dashboard-account-deletion.js')._internal;
const { EVENTS, buildAttribs } = require('../services/email-event-mapping');
const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');

const MIGRATION = 'supabase/migrations/20261113103000_account_deletion_requests.sql';
const ROLLBACK = 'supabase/rollbacks/20261113103000_account_deletion_requests.down.sql';
const UID = '11111111-2222-3333-4444-555555555555';
const RID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const block = { code: 'wallet_balance', severity: 'block', label: 'Saldo en el wallet', detail: 'USD 10,00', count: 1, href: '/artist/account#cobros' };
const check = { code: 'store_orders', severity: 'check', label: 'Store', detail: 'No pudimos verificar', count: null, href: null };
const warn = { code: 'quotes_open', severity: 'warn', label: 'Cotizaciones abiertas', detail: '2', count: 2, href: '/my-quotations' };

/* ------------------------------ migración ------------------------------ */

test('migración: tabla con RLS, una abierta por usuario, sin FK a auth.users y escrituras solo por RPC', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /create table if not exists public\.account_deletion_requests/);
    assert.match(sql, /status in \('pending', 'in_review', 'blocked', 'approved', 'completed', 'cancelled', 'rejected'\)/);
    assert.match(sql, /role text not null check \(role in \('client', 'artist', 'studio'\)\)/);
    assert.match(sql, /user_id uuid not null,\n/, 'sin FK: el registro sobrevive al borrado (auditoría)');
    assert.match(sql, /create unique index if not exists account_deletion_one_open_per_user[\s\S]*where status in \('pending', 'in_review', 'blocked', 'approved'\)/);
    assert.match(sql, /alter table public\.account_deletion_requests enable row level security/);
    assert.match(sql, /alter table public\.account_deletion_events enable row level security/);
    assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id or public\.is_support_user\(\)\)/);
    assert.match(sql, /revoke all on table public\.account_deletion_requests from anon, authenticated;/);
    assert.match(sql, /grant select on table public\.account_deletion_requests to authenticated;/);
    assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*account_deletion_requests to authenticated/);
});

test('migración: RPCs security definer con chequeos de identidad y de soporte', () => {
    const sql = read(MIGRATION);
    for (const fn of ['account_deletion_blockers', 'request_account_deletion', 'cancel_account_deletion', 'support_review_account_deletion', 'account_deletion_blockers_internal']) {
        const re = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = public`);
        assert.match(sql, re, `${fn} debe ser security definer con search_path fijo`);
    }
    assert.match(sql, /p_user_id = auth\.uid\(\) or public\.is_support_user\(\) or coalesce\(auth\.role\(\), ''\) = 'service_role'/);
    assert.match(sql, /revoke all on function public\.account_deletion_blockers_internal\(uuid\) from public, anon, authenticated/);
    assert.match(sql, /if not public\.is_support_user\(\) then\s+raise exception 'Solo soporte/);
    assert.match(sql, /v_action not in \('in_review', 'blocked', 'approved', 'rejected', 'note', 'refresh'\)/, "soporte nunca puede poner 'completed'");
    assert.match(sql, /if v_action = 'approved' and public\.account_deletion_has_blockers\(v_items\)/);
    assert.match(sql, /v_row\.status not in \('pending', 'in_review', 'blocked', 'approved'\)[\s\S]*Esta solicitud ya está cerrada/);
    assert.match(sql, /insert into public\.account_deletion_events/);
});

test('migración: los bloqueos cubren disputas, wallet, trabajos, sesiones, Store y estudio', () => {
    const sql = read(MIGRATION);
    const codes = ['protected_account', 'support_account', 'open_disputes', 'quotes_in_progress', 'upcoming_sessions',
        'wallet_balance', 'wallet_withdrawals', 'wallet_pending', 'store_orders', 'studio_memberships', 'studio_contracts',
        'studio_bookings', 'studio_roster', 'studio_roster_contracts', 'quotes_open', 'job_board_requests', 'job_board_applications'];
    for (const code of codes) assert.match(sql, new RegExp(`'${code}'`), `falta el chequeo ${code}`);
    assert.match(sql, /m\.kind = 'withdrawal' and m\.status = 'processing'/);
    assert.match(sql, /o\.status in \('pending_payment', 'paid'\)/);
    assert.match(sql, /quote_status in \('client_approved', 'in_progress', 'en_progreso', 'artist_completed'\)/);
    // Cada chequeo aislado: una tabla ausente no rompe la lista; una columna rara se marca 'check'.
    assert.ok((sql.match(/exception when undefined_table/g) || []).length >= 10);
    assert.match(sql, /e ->> 'severity' in \('block', 'check'\)/);
});

test('migración: aditiva, copia la tabla vieja una vez y tiene reversa', () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(sql, /drop table|alter table public\.artist_account_deletion_requests/i);
    assert.match(sql, /to_regclass\('public\.artist_account_deletion_requests'\) is not null/);
    assert.match(sql, /on conflict do nothing/);
    const down = read(ROLLBACK);
    for (const obj of ['support_review_account_deletion', 'cancel_account_deletion', 'request_account_deletion', 'account_deletion_blockers(uuid)']) {
        assert.ok(down.includes(obj), `la reversa elimina ${obj}`);
    }
    assert.match(down, /drop table if exists public\.account_deletion_requests/);
});

/* ------------------------------ lib ------------------------------ */

test('lib: estados, confirmación y normalización de bloqueos', () => {
    assert.deepEqual(AD.OPEN_STATUSES, ['pending', 'in_review', 'blocked', 'approved']);
    assert.equal(AD.canCancel('approved'), true);
    assert.equal(AD.canCancel('completed'), false);
    assert.equal(AD.isConfirmText(' eliminar '), true);
    assert.equal(AD.isConfirmText('borrar'), false);
    const items = AD.normalizeBlockers([block, warn, check, null, { severity: 'block' }, { code: 'x', severity: 'raro', href: '//evil.com' }]);
    assert.equal(items.length, 4);
    assert.equal(items[3].severity, 'block');
    assert.equal(items[3].href, null, 'nunca links externos o protocol-relative');
    assert.equal(AD.hasBlocking([warn]), false);
    assert.equal(AD.hasBlocking([warn, check]), true, "'check' (no verificable) también bloquea");
});

test('lib: la ejecución exige solicitud aprobada y cero bloqueos recalculados', () => {
    const approved = { id: RID, user_id: UID, status: 'approved' };
    assert.equal(AD.executionGate(null, []).status, 404);
    assert.equal(AD.executionGate({ ...approved, status: 'pending' }, []).ok, false);
    assert.equal(AD.executionGate({ ...approved, status: 'completed' }, []).status, 409);
    assert.equal(AD.executionGate(approved, null).status, 502, 'sin bloqueos en vivo no se ejecuta');
    const gate = AD.executionGate(approved, [block]);
    assert.equal(gate.ok, false);
    assert.equal(gate.blockers[0].code, 'wallet_balance');
    assert.equal(AD.executionGate(approved, [warn]).ok, true);
});

test('lib: payload de email por estado, idempotente y sin datos inventados', () => {
    const base = { id: RID, user_id: UID, role: 'client', email_snapshot: 'ana@example.com', name_snapshot: 'Ana', support_notes: 'Tenés un pedido pendiente.' };
    const pending = AD.buildEmailPayload({ ...base, status: 'pending' }, 'https://weotzi.com/beta/');
    assert.equal(pending.eventId, 'account_deletion_received');
    assert.equal(pending.payload.email, 'ana@example.com');
    assert.equal(pending.payload.account_url, 'https://weotzi.com/beta/client/profile#seguridad');
    assert.equal(pending.idempotencyKey, `account_deletion:${RID}:pending`);
    assert.equal(AD.buildEmailPayload({ ...base, status: 'rejected' }, '').payload.support_note, 'Tenés un pedido pendiente.');
    assert.equal(AD.buildEmailPayload({ ...base, status: 'approved', role: 'studio' }, 'x').payload.account_url, 'x/studio/dashboard#cuenta');
    assert.equal(AD.buildEmailPayload({ ...base, status: 'completed' }, 'x').payload.account_url, 'x/');
    assert.equal(AD.buildEmailPayload({ ...base, status: 'in_review' }, 'x'), null, 'en revisión no manda email');
    assert.equal(AD.buildEmailPayload({ ...base, status: 'pending', email_snapshot: null }, 'x'), null);
    assert.equal(AD.buildEmailPayload({ ...base, status: 'pending', name_snapshot: '' }, 'x').payload.user_name, 'ana');
});

test('lib: notifyStatus envía una vez con la clave de idempotencia', async () => {
    const calls = [];
    const out = await AD.notifyStatus({ id: RID, role: 'artist', status: 'approved', email_snapshot: 'a@b.co' }, {
        baseUrl: 'https://x', sendEmail: async (id, payload, opts) => { calls.push({ id, payload, opts }); return { ok: true }; }
    });
    assert.equal(out.sent, true);
    assert.equal(calls[0].id, 'account_deletion_approved');
    assert.equal(calls[0].opts.idempotencyKey, `account_deletion:${RID}:approved`);
    const skipped = await AD.notifyStatus({ id: RID, status: 'blocked', email_snapshot: 'a@b.co' }, { sendEmail: () => assert.fail('no envía') });
    assert.equal(skipped.skipped, 'no_email_for_status');
});

// pgrest falso: registra cada operación.
function fakePgrest(data, opts = {}) {
    const ops = [];
    function q(table) {
        const st = { table, filters: [] };
        const api = {
            select() { return api; },
            eq(c, v) { st.filters.push(['eq', c, v]); return api; },
            is(c, v) { st.filters.push(['is', c, v]); return api; },
            limit() { return api; },
            count() { return api; },
            async execute() {
                if (opts.missing && opts.missing.includes(table)) { const e = new Error('42P01 does not exist'); e.status = 404; throw e; }
                ops.push({ op: 'read', table, filters: st.filters });
                return data[table] || [];
            },
            async patch(body) { ops.push({ op: 'patch', table, body, filters: st.filters }); return []; },
            async delete() {
                if (opts.failDelete === table) { const e = new Error('23503'); e.status = 409; throw e; }
                ops.push({ op: 'delete', table, filters: st.filters }); return [{}];
            }
        };
        return api;
    }
    q.ops = ops;
    return q;
}

test('lib: executeAccountDeletion reutiliza el borrado existente (estudio, artista con relaciones, cliente, Auth)', async () => {
    const pg = fakePgrest({
        artists_db: [{ id: 'art-1', user_id: UID, email: 'a@b.co' }],
        studios: [{ id: 'st-1', user_id: UID, email: 'a@b.co', name: 'Estudio' }]
    });
    const rel = {
        countArtistRelations: async () => [{ table: 'studio_bookings', count: 1, blocking: true }],
        clearBlockingRelations: async () => { pg.ops.push({ op: 'clear' }); }
    };
    const deleted = [];
    const res = await AD.executeAccountDeletion({ user_id: UID, email_snapshot: 'a@b.co' }, {
        pgrest: pg, artistRelations: rel, deleteAuthUser: async (id) => { deleted.push(id); return { ok: false, status: 404 }; }
    });
    assert.equal(res.ok, true);
    const seq = pg.ops.filter((o) => o.op !== 'read').map((o) => o.op + ':' + (o.table || ''));
    assert.deepEqual(seq, ['patch:support_conversations', 'delete:studios', 'clear:', 'delete:artists_db', 'delete:clients_db']);
    assert.deepEqual(deleted, [UID], '404 de Auth = ya lo borró el trigger del artista');
});

test('lib: executeAccountDeletion protege al superadmin y frena ante FK', async () => {
    const pg = fakePgrest({ artists_db: [{ id: 'a', user_id: UID, email: 'isai@weotzi.com' }] });
    await assert.rejects(AD.executeAccountDeletion({ user_id: UID }, { pgrest: pg, artistRelations: {}, deleteAuthUser: async () => ({ ok: true }) }),
        (e) => e.status === 403);
    const pg2 = fakePgrest({ studios: [{ id: 's', user_id: UID, name: 'X' }] }, { failDelete: 'studios', missing: ['artists_db'] });
    await assert.rejects(AD.executeAccountDeletion({ user_id: UID }, { pgrest: pg2, artistRelations: {}, deleteAuthUser: async () => ({ ok: true }) }),
        (e) => e.status === 409 && Array.isArray(e.steps));
    await assert.rejects(AD.executeAccountDeletion({ user_id: 'no-uuid' }, {}), (e) => e.status === 400);
});

/* ------------------------------ servidor + emails ------------------------------ */

test('servidor: bloque borrado con auth de dueño/soporte, recálculo y auditoría', () => {
    const src = read('server.js');
    const start = src.indexOf('// ── borrado ──');
    const end = src.indexOf('// ── fin borrado ──');
    assert.ok(start > 0 && end > start, 'bloque propio en server.js');
    const block = src.slice(start, end);
    assert.match(block, /app\.post\('\/api\/account-deletion\/notify'/);
    assert.match(block, /app\.post\('\/api\/support\/account-deletions\/:id\/execute', authLimiter/);
    assert.match(block, /_getActiveSupportAgent\(req\)/);
    assert.match(block, /row\.user_id !== user\.id/);
    assert.match(block, /rpc\/account_deletion_blockers/);
    assert.match(block, /accountDeletion\.executionGate\(row, live\)/);
    assert.match(block, /account_deletion_events/);
    assert.match(block, /\.eq\('status', 'approved'\)\.patch\(\{\s*status: 'completed'/);
    assert.match(block, /isConfirmText\(req\.body && req\.body\.confirm\)/);
    assert.match(block, /require\('\.\/lib\/artist-relations'\)/);
});

test('emails: 4 eventos server-only con plantilla account-deletion', () => {
    for (const id of ['account_deletion_received', 'account_deletion_approved', 'account_deletion_rejected', 'account_deletion_completed']) {
        assert.ok(EVENTS[id], `${id} mapeado`);
        assert.equal(EVENTS[id].templateHint, 'account-deletion');
        assert.ok(SERVER_ONLY_EVENTS.has(id), `${id} solo lo envía el servidor`);
        const attribs = buildAttribs(id, { email: 'a@b.co', user_name: 'Ana', status_title: 't', status_detail: 'd', request_reference: 'R', account_url: 'u' });
        assert.deepEqual(Object.keys(attribs).sort(), ['account_url', 'request_reference', 'status_detail', 'status_title', 'support_note', 'user_name']);
    }
    const html = read('templates/email/billionmail/account-deletion.html');
    for (const v of ['user_name', 'status_title', 'status_detail', 'account_url']) assert.ok(html.includes(`{{${v}}}`));
    assert.ok(fs.existsSync(path.join(ROOT, 'templates/email/account-deletion.min.html')));
});

/* ------------------------------ UI usuario ------------------------------ */

test('widget: confirmación ELIMINAR, estado vigente y bloqueos sin links externos', () => {
    assert.equal(Widget.isConfirmText('ELIMINAR'), true);
    assert.equal(Widget.validateRequest('', 'eliminar').reason, null);
    assert.equal(Widget.validateRequest('x'.repeat(1001), 'ELIMINAR').field, 'reason');
    assert.equal(Widget.validateRequest('motivo', 'ELIMINA').field, 'confirm');
    const cur = Widget.currentRequest([
        { id: 1, status: 'cancelled', requested_at: '2026-11-10T00:00:00Z' },
        { id: 2, status: 'in_review', requested_at: '2026-11-01T00:00:00Z' }
    ]);
    assert.equal(cur.id, 2, 'la abierta gana aunque sea más vieja');
    assert.equal(Widget.currentRequest([]), null);
    assert.equal(Widget.canCancel({ status: 'approved' }), true);
    assert.equal(Widget.canCancel({ status: 'completed' }), false);
    const split = Widget.splitBlockers([block, warn, check]);
    assert.equal(split.blocking.length, 2);
    const html = Widget.blockerListHtml([{ ...block, label: '<b>x</b>', href: 'https://evil.com' }], 'vacío');
    assert.ok(!html.includes('<b>x</b>') && !html.includes('evil.com'));
    assert.match(Widget.blockerListHtml([], 'Sin pendientes'), /Sin pendientes/);
    assert.match(Widget.errorText({ message: 'duplicate 23505' }), /Ya tenés una solicitud/);
});

test('UI: artista, cliente y estudio montan "Eliminar mi cuenta"; el cliente ya no ve el mailto', () => {
    const artist = read('public/artist/account/index.html');
    assert.match(artist, /data-account-deletion="artist"/);
    assert.match(artist, /account-deletion-repo\.js[\s\S]*account-deletion\.js/);
    assert.doesNotMatch(artist, /id="aac-delete-dialog"/);
    const client = read('public/client/profile/index.html');
    assert.match(client, /data-account-deletion="client"/);
    assert.doesNotMatch(client, /mailto:clientes@weotzi\.com\?subject=Eliminar/);
    assert.match(client, /account-deletion-repo\.js/);
    const studio = read('public/studio/dashboard/index.html');
    assert.match(studio, /data-panel="cuenta"[\s\S]*data-account-deletion="studio"/);
    assert.match(studio, /account-deletion\.css/);
    const js = read('public/shared/js/account-deletion.js');
    assert.match(js, /aria-labelledby/);
    assert.match(js, /role="alert"/);
    const css = read('public/shared/css/account-deletion.css');
    assert.match(css, /prefers-reduced-motion/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i, 'solo tokens');
});

test('repo: escrituras solo por RPC y servidor', () => {
    const repo = read('public/shared/js/data/account-deletion-repo.js');
    for (const rpc of ['request_account_deletion', 'cancel_account_deletion', 'account_deletion_blockers', 'support_review_account_deletion']) {
        assert.match(repo, new RegExp(`rpc\\('${rpc}'`));
    }
    assert.doesNotMatch(repo, /\.(insert|update|upsert|delete)\(/);
    assert.match(repo, /\/api\/support\/account-deletions\//);
});

/* ------------------------------ UI soporte ------------------------------ */

test('soporte: cola BAJAS DE CUENTA con reglas de decisión y ejecución', () => {
    const html = read('public/support/dashboard/index.html');
    assert.match(html, /data-tab="bajas"[\s\S]*BAJAS DE CUENTA/);
    assert.match(html, /account-deletion-repo\.js[\s\S]*support-dashboard-account-deletion\.js/);
    assert.equal(Queue.buildReview('approved', '', [block]).error, Queue.MSG.blocked);
    assert.equal(Queue.buildReview('approved', '', null).error, Queue.MSG.blocked, 'sin bloqueos en vivo no aprueba');
    assert.equal(Queue.buildReview('approved', '', [warn]).action, 'approved');
    assert.equal(Queue.buildReview('rejected', 'no', []).field, 'note');
    assert.equal(Queue.buildReview('blocked', 'Tenés saldo.', [block]).action, 'blocked');
    assert.equal(Queue.buildReview('completed', '', []).error, Queue.MSG.generic, 'completed solo por el servidor');
    assert.equal(Queue.canExecute({ status: 'approved' }, []), true);
    assert.equal(Queue.canExecute({ status: 'approved' }, [check]), false);
    assert.equal(Queue.canExecute({ status: 'in_review' }, []), false);
    assert.equal(Queue.matchesSearch({ name_snapshot: 'Ana', email_snapshot: 'ana@x.co', role: 'client' }, 'cliente'), true);
    assert.match(Queue.checklistHtml([check], false), /Revisar/);
    assert.match(Queue.checklistHtml(null, true), /No ejecutes/);
});

/* ------------------------------ fixtures + legales ------------------------------ */

test('fixtures del preview: área borrado con las mismas reglas que la RPC', () => {
    global.self = global;
    const F = require('../public/shared/js/wo-demo-fixtures.js');
    assert.ok(F.EXTENSIONS.includes('borrado'));
    require('../public/shared/js/demo-fixtures/borrado.js');
    const built = F.build({ userId: UID, name: 'Artista', username: 'artista.wo' });
    assert.ok(built.tables.account_deletion_requests);
    const tables = { account_deletion_requests: [], account_deletion_events: [], quotations_db: [{ artist_id: UID, quote_status: 'in_progress' }],
        studio_artist_memberships: [], artists_db: [{ user_id: UID, name: 'Artista', email: 'a@b.co' }], clients_db: [] };
    let n = 0;
    const store = { rows: (t) => tables[t] || [], insert: (t, rows) => rows.map((r) => { const row = { id: 'r' + (++n), ...r }; (tables[t] = tables[t] || []).push(row); return row; }) };
    const ctx = { userId: UID };
    const list = built.rpcs.account_deletion_blockers({ p_user_id: UID }, store, ctx);
    assert.equal(list[0].code, 'quotes_in_progress');
    const req = built.rpcs.request_account_deletion({ p_role: 'artist', p_reason: 'chau' }, store, ctx);
    assert.equal(req.status, 'pending');
    assert.throws(() => built.rpcs.request_account_deletion({ p_role: 'artist' }, store, ctx), /abierta/);
    assert.throws(() => built.rpcs.support_review_account_deletion({ p_request_id: req.id, p_action: 'approved' }, store, ctx), /bloqueos/);
    assert.equal(built.rpcs.cancel_account_deletion({ p_request_id: req.id }, store, ctx).status, 'cancelled');
});

test('política de privacidad explica el proceso de baja', () => {
    const html = read('public/legal/privacy/index.html');
    assert.match(html, /id="baja-de-cuenta"/);
    assert.match(html, /Eliminar mi cuenta/);
    assert.match(html, /wallet \(saldo disponible o retiros en proceso\)/);
    assert.match(html, /podés cancelar la solicitud/);
});
