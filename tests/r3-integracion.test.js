'use strict';
// Ronda 3 · grupo "integracion" (12 nov 2026): cabos sueltos entre grupos.
//   1. Dashboard «Saldo pend.» / «Ingresos» con los pagos registrados.
//   2. Consentimiento de importación de IG también desde el registro.
//   3. Orden de monedas del registro = CurrencyUtils.COUNTRY_CURRENCIES.
//   4. Soporte liquida retiros (RPC support_settle_artist_withdrawal).
//   5. Avisos al artista por decisiones de soporte (panel + email con prefs).
//   6. «Cambios solicitados · esperando al estudio» en el detalle de invitación.
//   7. Reversas 20261028110000 / 20261028130000 con storage.allow_delete_query.
//   8. Inbox del artista sin los hilos donde participa como estudio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const Currency = require('../public/shared/js/currency-utils.js');
const RegCore = require('../public/shared/js/acceso-register-final.js');
const Catalogs = require('../lib/registration-catalogs.js');
const SDM = require('../public/shared/js/support-decision-model.js');
const Notify = require('../lib/integracion-support-notify.js');
const SV = require('../public/shared/js/support-dashboard-verification.js')._internal;
const W = require('../public/shared/js/wallet-model.js');
const InvM = require('../public/shared/js/invitations-model.js');
const Postgrest = require('../public/shared/js/wo-demo-postgrest.js');
const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');

const MIGRATION = 'supabase/migrations/20261112220000_integracion_retiros_inbox.sql';
const ROLLBACK = 'supabase/rollbacks/20261112220000_integracion_retiros_inbox.down.sql';

/* ------------------------------ 1 · dashboard ------------------------------ */

test('dashboard: INGRESOS y SALDO PEND. usan WoPaymentsModel.income/dashboardDue con los pagos registrados', () => {
    const src = read('public/shared/js/dashboard-redesign.js');
    assert.match(src, /function loadIncomePayments\(\)/);
    assert.match(src, /R\.listForArtist\(user\.id, \{ limit: 500 \}\)/);
    assert.match(src, /PM\.income\(quotes, lastPayments, target, conv, new Date\(\)\)/);
    assert.match(src, /PM\.dashboardDue\(quotes, lastPayments, target, conv\)/);
    assert.match(src, /addEventListener\('weotzi:payments-changed', function \(\) \{ loadIncomePayments\(\); \}\)/);
    assert.match(src, /renderIncome\(quotes\);\s*\n\s*loadIncomePayments\(\);/);
    // Sin la tabla de pagos (isAvailable false) queda el cálculo por estado.
    assert.match(src, /if \(!ok\) return null;/);
    assert.match(src, /if \(PM && lastPayments\) \{/);
    const html = read('public/artist/dashboard/index.html');
    const pos = (s) => html.indexOf(s);
    assert.ok(pos('quotation-payments-model.js') > 0 && pos('quotation-payments-repo.js') > 0, 'modelo y repo de pagos cargados');
});

/* ------------------------------ 2 · consentimiento IG ------------------------------ */

function loadConsentHelper() {
    const src = read('public/shared/js/register.js');
    const start = src.indexOf('function igImportConsentForCommit(');
    assert.ok(start > 0, 'helper en register.js');
    const end = src.indexOf('\n}\n', start) + 2;
    const sandbox = {};
    vm.runInNewContext(src.slice(start, end) + '\nthis.fn = igImportConsentForCommit;', sandbox);
    return sandbox.fn;
}

test('registro: el commit final manda consent solo si se aceptó para ese mismo handle', () => {
    const fn = loadConsentHelper();
    assert.deepEqual(JSON.parse(JSON.stringify(fn({ accepted: true, version: 'ig-import-2026-11', handle: 'tinta.sur' }, '@Tinta.Sur'))),
        { accepted: true, version: 'ig-import-2026-11' });
    assert.equal(fn({ accepted: true, handle: 'otra.cuenta' }, 'tinta.sur'), null, 'otro handle → sin consentimiento');
    assert.equal(fn({ accepted: false }, 'tinta.sur'), null);
    assert.equal(fn(null, 'tinta.sur'), null);
    assert.equal(fn({ accepted: true, version: '<script>' }, 'x').version, 'ig-import-2026-11', 'versión saneada');
});

test('registro: el consentimiento viaja del importador al borrador y al commit (también al re-importar)', () => {
    const ig = read('public/shared/js/instagram-import.js');
    assert.match(ig, /const consent = this\.confirmed \? \{ accepted: true, version: 'ig-import-2026-11', handle: this\.handle \|\| null \} : null;/);
    assert.match(ig, /onComplete\(\{ \.\.\.data, handle: this\.handle, summary: this\.summary, consent \}\)/);
    const acc = read('public/shared/js/acceso-register-final.js');
    assert.match(acc, /formState\.data\.ig_import_consent = \{/);
    assert.match(acc, /result\.consent\.accepted === true/);
    const reg = read('public/shared/js/register.js');
    assert.match(reg, /const consent = igImportConsentForCommit\(formState\.data\.ig_import_consent, igHandle\);\s*\n\s*if \(consent\) body\.consent = consent;/);
    assert.match(reg, /data\.ig_import_consent = igImportConsentForCommit\(/, 'se guarda en el borrador local');
    assert.match(reg, /const savedConsent = draftData\.ig_import_consent;/, 'y se restaura');
    // El servidor ya normaliza consent en el commit (grupo dashboard).
    assert.match(read('server.js'), /consent: igConsent\.normalizeImportConsent\(body\.consent\)/);
});

/* ------------------------------ 3 · monedas ------------------------------ */

test('registro: la respuesta de /api/registration/catalogs se ordena y agrupa como CurrencyUtils.COUNTRY_CURRENCIES', () => {
    const parsed = RegCore.parseCatalogPayload({ success: true, ...Catalogs.getRegistrationCatalogs() });
    const canon = Currency.COUNTRY_CURRENCIES;
    assert.deepEqual(parsed.currencies.map((c) => c.code), canon.map((c) => c.code));
    assert.deepEqual(parsed.currencies.map((c) => c.region), canon.map((c) => c.region));
    // El servidor sigue mandando su orden (USD, ARS, EUR…): el render no depende de él.
    assert.deepEqual(Catalogs.REGISTRATION_CURRENCIES.slice(0, 3).map((c) => c.code), ['USD', 'ARS', 'EUR']);
    const regions = [];
    parsed.currencies.forEach((c) => { if (!regions.includes(c.region)) regions.push(c.region); });
    assert.deepEqual(regions, ['Américas', 'Europa', 'Asia y Oceanía']);
});

test('registro: monedas fuera del listado quedan al final en "Otras" y el orden es estable', () => {
    const out = RegCore.normalizeCurrencies(['NZD', 'XTS', 'ars', 'EUR', 'USD']);
    assert.deepEqual(out.map((c) => c.code), ['USD', 'ARS', 'EUR', 'NZD', 'XTS']);
    assert.equal(out[4].region, 'Otras');
    assert.deepEqual(RegCore.orderCurrencies([{ code: 'B1' }, { code: 'A1' }], [{ code: 'A1' }]).map((c) => c.code), ['A1', 'B1']);
});

/* ------------------------------ 4 · liquidar retiros ------------------------------ */

test('migración 20261112220000: RPC de liquidación security definer con is_support_user() y reglas de saldo', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /^begin;/m);
    assert.match(sql, /commit;\s*$/);
    assert.match(sql, /create or replace function public\.support_settle_artist_withdrawal\(\s*p_movement_id uuid,\s*p_outcome text,\s*p_reference text default null,\s*p_note text default null\s*\)/);
    assert.match(sql, /security definer\s*\n\s*set search_path = public, pg_temp/);
    assert.match(sql, /if not coalesce\(public\.is_support_user\(\), false\) then\s*\n\s*raise exception '[^']+' using errcode = '42501'/);
    assert.match(sql, /p_outcome not in \('completed', 'failed'\)/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtext\('artist_wallet_withdrawal:' \|\| v_row\.artist_user_id::text\)\)/, 'mismo lock que request_artist_wallet_withdrawal');
    assert.match(sql, /for update;/);
    assert.match(sql, /if v_row\.status <> 'processing' then/);
    assert.match(sql, /'settlement', jsonb_build_object\(/);
    assert.match(sql, /revoke all on function public\.support_settle_artist_withdrawal\(uuid, text, text, text\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.support_settle_artist_withdrawal\(uuid, text, text, text\) to authenticated;/);
    // El saldo ya trata 'failed' como devuelto: no hay movimiento compensatorio.
    assert.doesNotMatch(sql, /insert into public\.artist_wallet_movements/);
    const down = read(ROLLBACK);
    assert.match(down, /drop function if exists public\.support_settle_artist_withdrawal\(uuid, text, text, text\);/);
});

test('soporte: buildSettlement exige referencia para pagado y nota para fallido', () => {
    assert.deepEqual(SV.buildSettlement('paid', ' TRX-1 ', ''), { outcome: 'completed', reference: 'TRX-1', note: null });
    assert.equal(SV.buildSettlement('paid', 'ab', '').field, 'reference');
    assert.equal(SV.buildSettlement('failed', '', 'no').field, 'note');
    assert.deepEqual(SV.buildSettlement('failed', '', 'Cuenta cerrada'), { outcome: 'failed', reference: null, note: 'Cuenta cerrada' });
    assert.equal(SV.buildSettlement('paid', 'x'.repeat(121), '').field, 'reference');
    assert.ok(SV.buildSettlement('otro', 'TRX-1', '').error);
    assert.ok(SV.KINDS.includes('withdrawals'));
    assert.equal(SV.normalizeStatus('processing'), 'pending');
    assert.equal(SV.normalizeStatus('completed'), 'verified');
    assert.equal(SV.normalizeStatus('failed'), 'rejected');
    assert.equal(SV.statusMeta('completed', 'withdrawals').label, 'Pagado');
    assert.equal(SV.statusMeta('failed', 'withdrawals').label, 'Fallido');
    assert.equal(SV.statusMeta('verified').label, 'Verificado', 'las otras colas no cambian');
    assert.match(SV.errorText(new Error('Ese retiro ya fue resuelto (estado: completed).')), /ya fue resuelto/);
    assert.match(SV.errorText(new Error('Could not find the function public.support_settle_artist_withdrawal')), /20261112220000/);
});

function makeDemo() {
    const sandbox = { console };
    sandbox.self = sandbox;
    for (const f of ['cuenta', 'cotizaciones', 'pagos', 'invitaciones', 'integracion']) {
        vm.runInNewContext(read(`public/shared/js/demo-fixtures/${f}.js`), sandbox, { filename: f + '.js' });
    }
    global.self = sandbox;
    const identity = { userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo Artist', email: 'demo@weotzi.test' };
    const fx = Fixtures.build(identity);
    const store = Postgrest.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views });
    return { fx, store, me: identity.userId };
}
function rpc(store, fn, args, userId) {
    const res = store.handle({ method: 'POST', path: 'rpc/' + fn, search: '', headers: {}, body: JSON.stringify(args), ctx: { userId } });
    return { status: res.status, body: res.body == null ? null : JSON.parse(res.body) };
}

test('fixtures: liquidar el retiro en proceso (pagado / fallido) con las reglas del SQL', () => {
    assert.ok(Fixtures.EXTENSIONS.includes('integracion'));
    let demo = makeDemo();
    const usd = (store) => W.summarize(store.rows('artist_wallet_movements').map(W.normalizeMovement), 'USD').available;
    const processing = demo.store.rows('artist_wallet_movements').find((m) => m.kind === 'withdrawal' && m.status === 'processing');
    assert.ok(processing, 'la extensión cuenta deja un retiro en proceso');
    const before = usd(demo.store);
    assert.equal(rpc(demo.store, 'support_settle_artist_withdrawal', { p_movement_id: processing.id, p_outcome: 'completed', p_reference: '' }, demo.me).status, 400);
    const paid = rpc(demo.store, 'support_settle_artist_withdrawal', { p_movement_id: processing.id, p_outcome: 'completed', p_reference: 'TRX-777' }, demo.me);
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'completed');
    assert.equal(paid.body.metadata_json.settlement.reference, 'TRX-777');
    assert.equal(usd(demo.store), before, 'pagado: sigue descontado');
    assert.equal(rpc(demo.store, 'support_settle_artist_withdrawal', { p_movement_id: processing.id, p_outcome: 'failed', p_note: 'otra vez' }, demo.me).status, 400, 'una sola vez');
    const moved = W.normalizeMovement(demo.store.rows('artist_wallet_movements').find((m) => m.id === processing.id));
    assert.equal(moved.settlementReference, 'TRX-777');

    demo = makeDemo();
    const before2 = usd(demo.store);
    const failed = rpc(demo.store, 'support_settle_artist_withdrawal', { p_movement_id: processing.id, p_outcome: 'failed', p_note: 'Cuenta cerrada por el banco' }, demo.me);
    assert.equal(failed.status, 200);
    assert.equal(usd(demo.store), before2 + Number(processing.amount), 'fallido: el monto vuelve al disponible');
    assert.equal(W.normalizeMovement(failed.body).settlementNote, 'Cuenta cerrada por el banco');
});

test('soporte: la pestaña VERIFICACIONES tiene la cola de retiros y avisa al artista', () => {
    const src = read('public/shared/js/support-dashboard-verification.js');
    assert.match(src, /<option value="withdrawals">Retiros<\/option>/);
    assert.match(src, /data-svq-settle="paid">MARCAR PAGADO/);
    assert.match(src, /data-svq-settle="failed">MARCAR FALLIDO/);
    assert.match(src, /notifyArtist\('withdrawal', d\.id\)/);
    assert.match(src, /notifyArtist\(d\.kind === 'destinations' \? 'destination' : 'document', d\.id\)/);
    assert.match(src, /'\/api\/support\/artist-decision-notify'/);
    const repo = read('public/shared/js/data/support-verification-repo.js');
    assert.match(repo, /c\.rpc\('support_settle_artist_withdrawal'/);
    assert.match(repo, /async listWithdrawals\(status\)/);
    assert.match(read('public/support/dashboard/index.html'), /support-dashboard-verification\.js\?v=20261112-integracion/);
});

/* ------------------------------ 5 · avisos al artista ------------------------------ */

const NOW = new Date('2026-11-12T15:00:00Z');
const ART = '22222222-2222-4222-8222-222222222222';
const rows = {
    document: { id: 'd1', artist_user_id: ART, doc_type: 'identidad', status: 'rechazado', reviewed_at: '2026-11-12T14:55:00Z', reviewer_notes: 'La foto está borrosa' },
    destination: { id: 'p1', artist_user_id: ART, label: 'Lemon', verification_status: 'verified', verified_at: '2026-11-12T14:58:00Z', metadata_json: { review: { decision: 'verified', note: null, reviewed_at: '2026-11-12T14:58:00Z' } } },
    withdrawal: { id: 'w1', artist_user_id: ART, kind: 'withdrawal', status: 'completed', amount: 1240.5, currency: 'usd', title: 'Retiro a Lemon', metadata_json: { settlement: { outcome: 'completed', reference: 'TRX-9', note: null, settled_at: '2026-11-12T14:59:00Z' } } }
};

test('modelo: fila decidida → decisión, textos en voseo y link a la sección de Cuenta', () => {
    const doc = SDM.fromRow('document', rows.document);
    assert.equal(doc.outcome, 'rejected');
    assert.match(SDM.describe(doc).title, /^Rechazamos tu documento de identidad$/);
    assert.match(SDM.describe(doc).detail, /Motivo: La foto está borrosa/);
    assert.equal(SDM.href(doc), '/artist/account#verificacion');
    const dest = SDM.fromRow('destination', rows.destination);
    assert.equal(SDM.describe(dest).title, 'Verificamos tu destino de retiro «Lemon»');
    const wd = SDM.fromRow('withdrawal', rows.withdrawal);
    assert.equal(SDM.describe(wd).title, 'Pagamos tu retiro de USD 1.240,50');
    assert.match(SDM.describe(wd).detail, /Referencia de la transferencia: TRX-9/);
    const failed = SDM.fromRow('withdrawal', { ...rows.withdrawal, status: 'failed', metadata_json: { settlement: { note: 'Cuenta cerrada', settled_at: '2026-11-12T14:59:00Z' } } });
    assert.match(SDM.describe(failed).detail, /volvió a tu saldo disponible/);
    // Sin decisión: pendiente, en proceso o sin fecha.
    assert.equal(SDM.fromRow('document', { ...rows.document, status: 'pendiente' }), null);
    assert.equal(SDM.fromRow('withdrawal', { ...rows.withdrawal, status: 'processing' }), null);
    assert.equal(SDM.fromRow('withdrawal', { ...rows.withdrawal, metadata_json: {} }), null);
    assert.equal(SDM.fromRow('withdrawal', { ...rows.withdrawal, kind: 'release' }), null);
});

test('modelo: ítems del panel (14 días, leídos con la misma clave) y ventana del email', () => {
    const old = { ...rows.document, id: 'd0', reviewed_at: '2026-10-01T10:00:00Z' };
    const key = SDM.feedKey(SDM.fromRow('destination', rows.destination));
    const items = SDM.feedItems({ documents: [rows.document, old], destinations: [rows.destination], withdrawals: [rows.withdrawal] },
        { now: NOW, seen: new Set([key]) });
    assert.equal(items.length, 3, 'la decisión de octubre queda afuera');
    assert.deepEqual(items.map((i) => i.icon), ['dollar-sign', 'credit-card', 'shield']);
    assert.equal(items.find((i) => i.key === key).unread, false);
    assert.ok(SDM.isRecent(SDM.fromRow('document', rows.document), NOW));
    assert.ok(!SDM.isRecent(SDM.fromRow('document', old), NOW));
    const p = SDM.emailPayload(SDM.fromRow('withdrawal', rows.withdrawal), { email: 'a@b.test', name: 'Ana' }, { baseUrl: 'https://beta.weotzi.com/' });
    assert.equal(p.dashboard_url, 'https://beta.weotzi.com/artist/account#cobros');
    assert.equal(p.support_reference, 'TRX-9');
    assert.equal(p.artist_email, 'a@b.test');
});

function deps(over) {
    const calls = { sent: [], prefs: [] };
    const d = Object.assign({
        now: NOW,
        baseUrl: 'https://beta.weotzi.com',
        fetchRow: async (table, select, id) => {
            const map = { artist_verification_documents: rows.document, artist_payout_destinations: rows.destination, artist_wallet_movements: rows.withdrawal };
            const row = map[table];
            return row && row.id === id ? row : null;
        },
        fetchArtist: async () => ({ user_id: ART, name: 'Ana', email: 'ana@example.test' }),
        shouldNotify: async (user, kind, channel) => { calls.prefs.push([user.id, kind, channel]); return true; },
        sendEmail: async (eventId, payload, options) => { calls.sent.push({ eventId, payload, options }); return { ok: true, channel: 'n8n' }; }
    }, over || {});
    return { d, calls };
}

test('servidor: notifyArtistDecision relee la fila, respeta shouldNotify y envía una vez por decisión', async () => {
    const UUID = '33333333-3333-4333-8333-333333333333';
    rows.document.id = UUID;
    const { d, calls } = deps();
    const res = await Notify.notifyArtistDecision({ subject: 'document', id: UUID }, d);
    assert.equal(res.ok, true);
    assert.equal(res.sent, true);
    assert.deepEqual(calls.prefs[0], [ART, 'cuenta', 'email']);
    assert.equal(calls.sent[0].eventId, 'artist_support_decision');
    assert.equal(calls.sent[0].options.idempotencyKey, 'support-decision:document:' + UUID + ':2026-11-12T14:55:00.000Z');
    assert.match(calls.sent[0].payload.decision_title, /Rechazamos/);

    const off = deps({ shouldNotify: async () => false });
    assert.equal((await Notify.notifyArtistDecision({ subject: 'document', id: UUID }, off.d)).skipped, 'notification_pref');
    assert.equal(off.calls.sent.length, 0);

    const late = deps({ now: new Date('2026-11-13T15:00:00Z') });
    assert.equal((await Notify.notifyArtistDecision({ subject: 'document', id: UUID }, late.d)).skipped, 'stale');

    assert.equal((await Notify.notifyArtistDecision({ subject: 'otro', id: UUID }, d)).status, 400);
    assert.equal((await Notify.notifyArtistDecision({ subject: 'document', id: 'x' }, d)).status, 400);
    assert.equal((await Notify.notifyArtistDecision({ subject: 'withdrawal', id: UUID }, d)).status, 404);
    const pending = deps({ fetchRow: async () => ({ ...rows.document, status: 'pendiente' }) });
    assert.equal((await Notify.notifyArtistDecision({ subject: 'document', id: UUID }, pending.d)).skipped, 'no_decision');
    const noMail = deps({ fetchArtist: async () => ({ user_id: ART }) });
    assert.equal((await Notify.notifyArtistDecision({ subject: 'document', id: UUID }, noMail.d)).skipped, 'no_email');
});

test('servidor: endpoint solo para soporte y evento de email server-only con plantilla', () => {
    const server = read('server.js');
    assert.match(server, /\/\/ ── integracion ──/);
    assert.match(server, /app\.post\('\/api\/support\/artist-decision-notify', async \(req, res\) => \{\s*\n\s*const agent = await _getActiveSupportAgent\(req\);/);
    const { EVENTS } = require('../services/email-event-mapping.js');
    const ev = EVENTS.artist_support_decision;
    assert.ok(ev);
    assert.equal(ev.templateHint, 'support-decision');
    assert.equal(ev.recipient({ artist_email: 'a@b.test' }), 'a@b.test');
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context.js');
    assert.ok(SERVER_ONLY_EVENTS.has('artist_support_decision'));
    for (const f of ['templates/email/support-decision.html', 'templates/email/support-decision.min.html', 'templates/email/billionmail/support-decision.html']) {
        assert.ok(fs.existsSync(path.join(root, f)), f);
    }
    assert.match(read('templates/email/support-decision.html'), /\{\{decision_title\}\}/);
});

test('panel del artista: carga el modelo y el repo de decisiones de soporte', () => {
    const menu = read('public/shared/js/wo-artist-menu.js');
    assert.match(menu, /loadCounterRepository\('\/shared\/js\/support-decision-model\.js'/);
    assert.match(menu, /loadCounterRepository\('\/shared\/js\/data\/support-decisions-repo\.js'/);
    assert.match(menu, /SDM\.feedItems\(rows, \{ seen: seen, now: new Date\(\) \}\)/);
    const repo = read('public/shared/js/data/support-decisions-repo.js');
    assert.match(repo, /D\.SupportDecisions = SupportDecisions/);
    assert.match(repo, /\.eq\('kind', 'withdrawal'\)\.in\('status', \['completed', 'failed'\]\)/);
});

/* ------------------------------ 6 · invitaciones ------------------------------ */

test('invitaciones: «Cambios solicitados · esperando al estudio» con la solicitud abierta', () => {
    assert.equal(InvM.CHANGE_PENDING_LABEL, 'Cambios solicitados · esperando al estudio');
    const open = InvM.openChangeRequests([
        { membership_id: 'm1', status: 'pending', created_at: '2026-11-10T10:00:00Z', message: 'a' },
        { membership_id: 'm1', status: 'pending', created_at: '2026-11-11T10:00:00Z', message: 'b' },
        { membership_id: 'm2', status: 'accepted', created_at: '2026-11-11T10:00:00Z' }
    ]);
    assert.deepEqual(Object.keys(open), ['m1']);
    assert.equal(open.m1.message, 'b');
    const src = read('public/shared/js/artist-invitations.js');
    assert.match(src, /repo\.listOpenChangeRequestsForArtist\(state\.userId\)/);
    assert.match(src, /_changeRequest: openChanges\[String\(m\.id\)\] \|\| null/);
    assert.match(src, /inv-detail-status--changes/);
    assert.match(src, /changePending\(membership\) \? '' : `<button type="button" class="inv-aside-btn" data-action="request-changes"/);
    assert.match(read('public/shared/js/data/studios-repo.js'), /listOpenChangeRequestsForArtist\(artistUserId\) \{\s*\n\s*return from\('studio_invitation_change_requests'\)/);
    assert.match(read('public/shared/css/artist-invitations-figma.css'), /\.inv-detail-status--changes/);
    const { fx, me } = makeDemo();
    const reqs = fx.tables.studio_invitation_change_requests.filter((r) => r.status === 'pending' && r.artist_user_id === me);
    assert.ok(reqs.length >= 1, 'el preview tiene una solicitud abierta');
});

/* ------------------------------ 7 · reversas ------------------------------ */

test('reversas 20261028110000 / 20261028130000 habilitan storage.allow_delete_query en su transacción', () => {
    for (const f of ['supabase/rollbacks/20261028110000_artist_reminders.down.sql', 'supabase/rollbacks/20261028130000_quotation_detail_figma.down.sql']) {
        const sql = read(f);
        const begin = sql.search(/^begin;$/m);
        const set = sql.indexOf("set local storage.allow_delete_query = 'true';");
        const del = sql.indexOf('delete from storage.buckets');
        assert.ok(begin >= 0, f + ': begin');
        assert.ok(set > begin && del > set, f + ': set local antes del delete');
        assert.match(sql, /commit;\s*$/, f + ': commit');
    }
    assert.match(read('supabase/rollbacks/20261028110000_artist_reminders.down.sql'),
        /and not exists \(select 1 from storage\.objects o where o\.bucket_id = 'artist-reminder-files'\)/, 'solo si está vacío');
});

/* ------------------------------ 8 · inbox ------------------------------ */

test('inbox del artista: list_artist_inbox_threads excluye participant_role studio (misma firma)', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /create or replace function public\.list_artist_inbox_threads\(\)\s*\nreturns table \(/);
    assert.match(sql, /where auth\.uid\(\) is not null\s*\n\s*and p\.participant_role <> 'studio'/);
    assert.match(sql, /grant execute on function public\.list_artist_inbox_threads\(\) to authenticated, service_role;/);
    const down = read(ROLLBACK);
    assert.doesNotMatch(down, /participant_role <> 'studio'/);
    assert.match(down, /create or replace function public\.list_artist_inbox_threads\(\)/);
});
