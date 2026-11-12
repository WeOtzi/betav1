'use strict';
// Ronda 3 · grupo "pagos" (12 nov 2026). Cubre:
//   - quotation-payments-model.js (validación, saldo, seña, dashboard, actividad)
//   - wallet-model.js con movimientos informativos «Cobrado por fuera»
//   - helpers puros de la pestaña VERIFICACIONES de soporte
//   - la migración 20261112170000 (forma, RLS, RPC) y su reversa
//   - las fixtures del preview (demo-fixtures/pagos.js) y sus RPC espejo
//   - el cableado en las páginas (dashboard, detalle, soporte)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const P = require('../public/shared/js/quotation-payments-model.js');
const W = require('../public/shared/js/wallet-model.js');
const SV = require('../public/shared/js/support-dashboard-verification.js')._internal;
const Currency = require('../public/shared/js/currency-utils.js');
const Postgrest = require('../public/shared/js/wo-demo-postgrest.js');
const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');

const MIGRATION = 'supabase/migrations/20261112170000_quotation_payments_wallet_support.sql';
const ROLLBACK = 'supabase/rollbacks/20261112170000_quotation_payments_wallet_support.down.sql';
const TODAY = '2026-11-12';

// Tipo de cambio fijo para los tests: 1 USD = 1000 ARS = 0,9 EUR.
const RATES = { USD: 1, ARS: 1000, EUR: 0.9 };
const convert = (a, f, t) => (RATES[f] && RATES[t] ? (a / RATES[f]) * RATES[t] : null);

const quote = (extra) => Object.assign({
    id: 10, quote_id: 'COT-1', quote_status: 'client_approved', client_full_name: 'Mateo Ruiz',
    final_budget_amount: '1000', final_budget_currency: 'USD', artist_budget_amount: '900', artist_budget_currency: 'USD',
    artist_responded_at: '2026-11-01T10:00:00Z'
}, extra || {});
const pay = (extra) => Object.assign({ id: 'p' + Math.random(), quotation_id: 10, quote_id: 'COT-1', kind: 'session', method: 'cash', amount: 100, currency: 'USD', paid_on: '2026-11-10', client_name: 'Mateo Ruiz', created_at: '2026-11-10T15:00:00Z' }, extra || {});

/* ------------------------------ monedas y montos ------------------------------ */

test('las 24 monedas del modelo, del SQL y de CurrencyUtils.COUNTRY_CURRENCIES coinciden', () => {
    const codes = Currency.COUNTRY_CURRENCIES.map((c) => c.code);
    assert.deepEqual([...P.CURRENCY_CODES].sort(), [...codes].sort());
    assert.equal(P.CURRENCY_CODES.length, 24);
    const sql = read(MIGRATION);
    const lists = sql.match(/'USD', 'CAD'[\s\S]*?'NZD'/g);
    assert.ok(lists && lists.length >= 2, 'tabla y RPC listan las monedas');
    lists.forEach((l) => {
        const inSql = l.match(/'([A-Z]{3})'/g).map((s) => s.slice(1, 4));
        assert.deepEqual(inSql.sort(), [...codes].sort());
    });
    assert.ok(P.isCurrency('ars') && !P.isCurrency('BOB') && !P.isCurrency('XXX'));
});

test('parseAmount acepta formatos es-AR y en-US y rechaza negativos o vacíos', () => {
    assert.equal(P.parseAmount('1.240,50'), 1240.5);
    assert.equal(P.parseAmount('1240.5'), 1240.5);
    assert.equal(P.parseAmount('1,240.50'), 1240.5);
    assert.equal(P.parseAmount('1.240'), 1240);
    assert.equal(P.parseAmount('0,50'), 0.5);
    assert.ok(Number.isNaN(P.parseAmount('-5')));
    assert.ok(Number.isNaN(P.parseAmount('')));
    assert.ok(Number.isNaN(P.parseAmount('abc')));
    assert.equal(P.storedAmount('410000'), 410000);
    assert.equal(P.storedAmount(null), null);
    assert.equal(P.storedAmount('0'), null);
});

test('validate: montos sanos, moneda de la lista, fecha no futura, nota y comprobante acotados', () => {
    const base = { quotationId: 10, kind: 'deposit', method: 'cash', amount: '300', currency: 'usd', paidOn: TODAY, note: '  seña  ' };
    const ok = P.validate(base, { today: TODAY });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value, { quotationId: 10, kind: 'deposit', method: 'cash', amount: 300, currency: 'USD', paid_on: TODAY, note: 'seña' });

    const bad = (patch) => P.validate(Object.assign({}, base, patch), { today: TODAY }).errors;
    assert.ok(bad({ amount: '0' }).amount);
    assert.ok(bad({ amount: '-10' }).amount);
    assert.ok(bad({ amount: '10,123' }).amount, 'más de 2 decimales');
    assert.ok(bad({ amount: '2000000000' }).amount, 'tope');
    assert.ok(bad({ currency: 'BOB' }).currency, 'fuera de las 24');
    assert.ok(bad({ paidOn: '2026-11-20' }).paidOn, 'futura');
    assert.equal(bad({ paidOn: '2026-11-13' }).paidOn, undefined, 'un día de margen por husos');
    assert.ok(bad({ paidOn: '2014-12-31' }).paidOn);
    assert.ok(bad({ paidOn: '2026-02-30' }).paidOn, 'fecha inexistente');
    assert.ok(bad({ kind: 'tip' }).kind);
    assert.ok(bad({ method: 'cheque' }).method);
    assert.ok(bad({ quotationId: null }).quotationId);
    assert.ok(bad({ note: 'x'.repeat(501) }).note);
    assert.ok(bad({ file: { name: 'a.exe', type: 'application/x-msdownload', size: 10 } }).file);
    assert.ok(bad({ file: { name: 'a.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 } }).file);
    assert.equal(bad({ file: { name: 'recibo.jpg', type: 'image/jpeg', size: 1000 } }).file, undefined);
});

/* --------------------------------- saldo y seña --------------------------------- */

test('agreedTotal: final > artista > total de la cotización manual', () => {
    assert.deepEqual(P.agreedTotal(quote()), { amount: 1000, currency: 'USD', source: 'final' });
    assert.deepEqual(P.agreedTotal(quote({ final_budget_amount: null })), { amount: 900, currency: 'USD', source: 'artist' });
    assert.deepEqual(P.agreedTotal(quote({ final_budget_amount: null, artist_budget_amount: null }), { total: 240000, currency: 'ARS' }),
        { amount: 240000, currency: 'ARS', source: 'manual' });
    assert.equal(P.agreedTotal(quote({ final_budget_amount: null, artist_budget_amount: null })), null);
});

test('summarize: saldo real (acordado − cobrado), seña pendiente → parcial → pagada', () => {
    const manual = { currency: 'USD', total: 1000, deposit_pct: 30, deposit_amount: 300 };
    let s = P.summarize(quote(), manual, []);
    assert.equal(s.total, 1000);
    assert.equal(s.paid, 0);
    assert.equal(s.balance, 1000);
    assert.deepEqual(s.deposit, { required: 300, currency: 'USD', pct: 30, paid: 0, status: 'pending' });
    assert.equal(P.suggestKind(s), 'deposit');
    assert.equal(P.suggestAmount(s, 'deposit'), 300);

    s = P.summarize(quote(), manual, [pay({ kind: 'deposit', amount: 100 })]);
    assert.equal(s.deposit.status, 'partial');
    assert.equal(s.balance, 900);
    assert.equal(P.suggestAmount(s, 'deposit'), 200);
    assert.equal(P.suggestKind(s), 'balance');

    s = P.summarize(quote(), manual, [pay({ kind: 'deposit', amount: 300 }), pay({ kind: 'session', amount: 400, paid_on: '2026-11-11' })]);
    assert.equal(s.deposit.status, 'paid');
    assert.equal(s.paid, 700);
    assert.equal(s.balance, 300);
    assert.equal(s.percent, 70);
    assert.equal(s.lastPaidOn, '2026-11-11');
    assert.equal(P.suggestAmount(s, 'balance'), 300);

    // Un pago de sesión que ya cubre la seña la da por pagada.
    s = P.summarize(quote(), manual, [pay({ kind: 'session', amount: 350 })]);
    assert.equal(s.deposit.status, 'paid');

    // Pagado de más.
    s = P.summarize(quote(), manual, [pay({ amount: 1200 })]);
    assert.equal(s.balance, 0);
    assert.equal(s.overpaid, 200);
    assert.equal(s.percent, 100);
});

test('summarize: otras monedas se convierten si hay tipo de cambio; si no, quedan aparte', () => {
    const payments = [pay({ amount: 100000, currency: 'ARS' }), pay({ amount: 50, currency: 'JPY' })];
    const withRates = P.summarize(quote(), null, payments, { convert });
    assert.equal(withRates.paid, 100);
    assert.equal(withRates.balance, 900);
    assert.deepEqual(withRates.others, [{ currency: 'JPY', amount: 50 }]);
    const noRates = P.summarize(quote(), null, payments, {});
    assert.equal(noRates.paid, 0);
    assert.equal(noRates.others.length, 2);
    assert.equal(P.summarize(quote(), null, []).deposit, null, 'sin cotización manual no hay seña');
});

test('isPayable: respondidas o con acuerdo; nunca el borrador del cotizador del cliente', () => {
    ['responded', 'client_approved', 'artist_completed', 'completed'].forEach((st) => assert.ok(P.isPayable(quote({ quote_status: st }))));
    ['pending', 'client_rejected', 'cancelled', 'expired'].forEach((st) => assert.equal(P.isPayable(quote({ quote_status: st })), false));
    const draft = quote({ quote_status: 'in_progress', artist_responded_at: null, final_budget_amount: null, final_sessions: null });
    assert.equal(P.isDraft(draft), true);
    assert.equal(P.isPayable(draft), false);
    assert.equal(P.isPayable(quote({ quote_status: 'in_progress' })), true);
    assert.equal(P.isPayable(quote({ is_archived: true })), false);
});

/* ---------------------------------- dashboard ---------------------------------- */

test('dashboardDue: «Saldo pend.» = acordado − cobrado; completadas solo si ya registran pagos', () => {
    const quotes = [
        quote({ id: 1, final_budget_amount: '1000' }),
        quote({ id: 2, quote_status: 'artist_completed', final_budget_amount: '500' }),
        quote({ id: 3, quote_status: 'completed', final_budget_amount: '800' }), // sin pagos: legado, no es deuda
        quote({ id: 4, quote_status: 'completed', final_budget_amount: '600' }),
        quote({ id: 5, quote_status: 'pending', final_budget_amount: '999' }),
        quote({ id: 6, final_budget_amount: '100000', final_budget_currency: 'ARS' }),
        quote({ id: 7, final_budget_amount: '700', final_budget_currency: 'JPY' }) // sin tipo de cambio
    ];
    const payments = [
        P.normalize(pay({ quotation_id: 1, amount: 300 })),
        P.normalize(pay({ quotation_id: 4, amount: 200 })),
        P.normalize(pay({ quotation_id: 6, amount: 50000, currency: 'ARS' }))
    ];
    // 700 + 500 + 400 + 50 USD
    assert.equal(P.dashboardDue(quotes, payments, 'USD', convert), 1650);
});

test('income: pagos por fecha de pago + completadas sin pagos (sin contar dos veces)', () => {
    const now = new Date(2026, 10, 12, 12); // jueves 12 nov 2026
    const quotes = [
        quote({ id: 1, quote_status: 'completed', final_budget_amount: '1000', client_completed_at: new Date(2026, 10, 3).toISOString() }),
        quote({ id: 2, quote_status: 'completed', final_budget_amount: '800', client_completed_at: new Date(2026, 10, 11).toISOString() })
    ];
    const payments = [
        P.normalize(pay({ quotation_id: 1, amount: 300, paid_on: '2026-11-10' })), // esta semana (lunes 9)
        P.normalize(pay({ quotation_id: 1, amount: 200, paid_on: '2026-11-02' })), // este mes
        P.normalize(pay({ quotation_id: 9, amount: 100, paid_on: '2026-10-30' })) // mes anterior
    ];
    const inc = P.income(quotes, payments, 'USD', convert, now);
    // Cotización 1 cuenta por sus pagos (500), no por el total; la 2 por su cierre (800).
    assert.equal(inc.month, 1300);
    assert.equal(inc.week, 1100);
    assert.equal(inc.counted, 4);
});

test('activityEvents: «Pago recibido · Mateo · $180» y «Seña recibida» con la fecha del pago', () => {
    const money = (a) => '$' + a;
    const evs = P.activityEvents([
        P.normalize(pay({ amount: 180, paid_on: P.isoDateLocal(new Date()), created_at: new Date().toISOString() })),
        P.normalize(pay({ kind: 'deposit', amount: 75, client_name: 'Sofía Martínez', paid_on: '2026-11-04', created_at: '2026-11-12T10:00:00Z' }))
    ], { money });
    assert.equal(evs[0].txt, 'Pago recibido · Mateo · $180');
    assert.equal(evs[0].icon, 'dollar-sign');
    assert.equal(evs[1].txt, 'Seña recibida · Sofía · $75');
    // Un pago de la semana pasada registrado hoy no figura como "hace 1 min".
    assert.equal(P.isoDateLocal(new Date(evs[1].when)), '2026-11-04');
    assert.equal(evs[1].quoteId, 'COT-1');
});

test('receiptPath: <artista>/<cotización>/<id>-<archivo saneado>', () => {
    assert.equal(P.receiptPath('u-1', 42, 'Recibo de pagó (1).PDF', 'abc'), 'u-1/42/abc-Recibo-de-pago-1-.PDF');
    assert.equal(P.formatMoney(1240.5, 'usd'), 'USD 1.240,50');
    assert.equal(P.formatDate('2026-11-04'), '4 nov 2026');
});

/* ------------------------------------ Wallet ------------------------------------ */

test('Wallet: los cobros por fuera son informativos y nunca suman al saldo retirable', () => {
    const moves = [
        { kind: 'release', status: 'completed', amount: 500, currency: 'USD', title: 'Fondos liberados', occurred_at: '2026-11-01T10:00:00Z' },
        { kind: 'payment', status: 'completed', amount: 300, currency: 'USD', title: 'Seña recibida — Mateo', quote_id: 'COT-1', occurred_at: '2026-11-10T10:00:00Z',
          metadata_json: { source: 'manual_payment', off_platform: true, method: 'cash', payment_kind: 'deposit' } },
        { kind: 'payment', status: 'completed', amount: 1000, currency: 'USD', title: 'Trabajo completado — Mateo', occurred_at: '2026-11-11T10:00:00Z',
          metadata_json: { source: 'quotation', off_platform: true, balance: 700 } },
        // Aunque llegara con un kind que suma (defensa en profundidad), off_platform no cuenta.
        { kind: 'release', status: 'completed', amount: 999, currency: 'USD', title: 'raro', metadata_json: { source: 'manual_payment', off_platform: true } },
        { kind: 'payment', status: 'cancelled', amount: 50, currency: 'USD', title: 'Pago anulado', metadata_json: { source: 'manual_payment', off_platform: true } }
    ].map(W.normalizeMovement);
    const s = W.summarize(moves, 'USD');
    assert.equal(s.available, 500);
    assert.equal(s.pendingService + s.awaitingRelease + s.blocked, 0);
    assert.equal(W.upcomingReleases(moves).length, 0);
    assert.equal(moves[1].offPlatform, true);
    assert.equal(moves[1].paymentMethod, 'cash');
    assert.equal(moves[2].agreedBalance, 700);
    assert.equal(W.movementView(moves[1]).statusLabel, 'Cobrado por fuera');
    assert.equal(W.movementView(moves[1]).sign, '');
    assert.equal(W.movementView(moves[1]).tone, 'muted');
    assert.equal(W.movementView(moves[2]).statusLabel, 'Acuerdo cerrado');
    assert.equal(W.movementView(moves[4]).statusLabel, 'Anulado');
    assert.equal(W.hasOffPlatform(moves), true);
    assert.equal(W.hasOffPlatform([moves[0]]), false);
    // Muchos cobros por fuera en ARS no cambian la moneda del Wallet.
    const ars = moves.concat([W.normalizeMovement({ kind: 'payment', status: 'completed', amount: 900000, currency: 'ARS', title: 'x', metadata_json: { off_platform: true, source: 'manual_payment' } })]);
    assert.equal(W.primaryCurrency(ars, null), 'USD');
    // Retirar más de lo disponible sigue bloqueado.
    assert.match(W.validateWithdrawal(600, s.available, { verification_status: 'verified' }), /supera/);
});

/* ------------------------------- soporte (puro) ------------------------------- */

test('soporte: rechazar exige nota (≥5) y la decisión se mapea por cola', () => {
    assert.deepEqual(SV.buildReview('destinations', 'approve', ''), { decision: 'verified', note: null });
    assert.deepEqual(SV.buildReview('documents', 'approve', ' ok '), { decision: 'verificado', note: 'ok' });
    assert.equal(SV.buildReview('documents', 'reject', 'mal').field, 'note');
    assert.deepEqual(SV.buildReview('destinations', 'reject', 'El titular no coincide'), { decision: 'rejected', note: 'El titular no coincide' });
    assert.deepEqual(SV.buildReview('documents', 'reject', 'Foto borrosa, subila de nuevo'), { decision: 'rechazado', note: 'Foto borrosa, subila de nuevo' });
    assert.equal(SV.buildReview('documents', 'approve', 'x'.repeat(501)).field, 'note');
    assert.equal(SV.normalizeStatus('pendiente'), 'pending');
    assert.equal(SV.normalizeStatus('verificado'), 'verified');
    assert.equal(SV.normalizeStatus('rejected'), 'rejected');
    assert.equal(SV.maskIdentifier('ES91 0049 0001 5123 4567 7734'), '···· 7734');
    assert.deepEqual(SV.requiredDocsStatus([{ doc_type: 'identidad', status: 'verificado' }, { doc_type: 'domicilio', status: 'pendiente' }]),
        { ok: false, missing: ['Comprobante de domicilio'] });
    assert.equal(SV.requiredDocsStatus([{ doc_type: 'identidad', status: 'verificado' }, { doc_type: 'domicilio', status: 'verificado' }]).ok, true);
    assert.match(SV.errorText({ message: '[x] Could not find the function public.support_review_payout_destination', cause: { code: 'PGRST202' } }), /migración/);
    assert.match(SV.errorText({ cause: { code: '42501', message: 'Solo soporte puede revisar documentos.' } }), /soporte/);
    assert.equal(SV.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

/* --------------------------------- migración --------------------------------- */

test('migración 20261112170000: tabla con RLS de solo lectura, RPC security definer, bucket privado y triggers del Wallet', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /NO APLICADA/);
    assert.match(sql, /create table if not exists public\.quotation_payments/);
    assert.match(sql, /amount numeric\(14,2\) not null check \(amount > 0/);
    assert.match(sql, /alter table public\.quotation_payments enable row level security/);
    assert.match(sql, /revoke all on table public\.quotation_payments from authenticated;\s*grant select on table public\.quotation_payments to authenticated;/);
    assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*quotation_payments/i);
    assert.match(sql, /'quotation-payment-receipts',\s*'quotation-payment-receipts',\s*false/);
    for (const fn of ['record_quotation_payment', 'void_quotation_payment', 'quotation_payments_wallet_feed', 'quotation_completed_wallet_feed',
        'support_review_payout_destination', 'support_review_verification_document', 'support_set_artist_verification_state']) {
        const block = sql.slice(sql.indexOf('function public.' + fn + '('));
        assert.ok(sql.includes('function public.' + fn + '('), fn);
        assert.match(block.slice(0, 1600), /security definer\s+set search_path = public, pg_temp/, fn + ' fija search_path');
    }
    // Soporte: las tres RPC chequean is_support_user().
    assert.equal((sql.match(/if not coalesce\(public\.is_support_user\(\), false\) then/g) || []).length, 3);
    // El Wallet nunca suma: kind 'payment' completado y marcado off_platform.
    assert.match(sql, /'payment', 'completed', new\.amount/);
    assert.equal((sql.match(/'off_platform', true/g) || []).length, 2);
    // Los triggers del Wallet no bloquean la escritura de origen.
    assert.equal((sql.match(/exception when others then\s+(--[^\n]*\n\s*)?raise warning/g) || []).length, 2);
    assert.match(sql, /after update of quote_status on public\.quotations_db/);
    assert.match(sql, /begin;[\s\S]*commit;\s*$/);

    const down = read(ROLLBACK);
    for (const name of ['record_quotation_payment', 'void_quotation_payment', 'support_review_payout_destination', 'support_review_verification_document',
        'support_set_artist_verification_state', 'quotation_payments_wallet_feed', 'quotation_completed_wallet_feed']) {
        assert.match(down, new RegExp('drop function if exists public\\.' + name + '\\('), name + ' en la reversa');
    }
    assert.match(down, /drop trigger if exists trg_quotation_completed_wallet_feed on public\.quotations_db/);
    assert.match(down, /drop table if exists public\.quotation_payments/);
});

/* ----------------------------- fixtures del preview ----------------------------- */

function makeDemo() {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/cuenta.js'), sandbox, { filename: 'cuenta.js' });
    vm.runInNewContext(read('public/shared/js/demo-fixtures/cotizaciones.js'), sandbox, { filename: 'cotizaciones.js' });
    vm.runInNewContext(read('public/shared/js/demo-fixtures/pagos.js'), sandbox, { filename: 'pagos.js' });
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

test('fixtures: pagos de Sofía, Mateo y Lucía, seña pendiente de DEMO-S01 y movimientos informativos', () => {
    assert.ok(Fixtures.EXTENSIONS.includes('pagos'));
    const { fx, store, me } = makeDemo();
    const rows = fx.tables.quotation_payments;
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.artist_user_id === me && /^[0-9a-f-]{36}$/.test(r.id)));
    const byRef = (ref) => fx.tables.quotations_db.find((q) => q.quote_id === ref);
    const d03 = byRef('DEMO-D03');
    const sum = P.summarize(d03, null, rows.filter((r) => r.quotation_id === d03.id));
    assert.equal(sum.balance, 0, 'Lucía pagó todo (180)');
    const s01 = byRef('DEMO-S01');
    const manual = fx.tables.artist_manual_quotes.find((m) => m.quote_id === 'DEMO-S01');
    assert.equal(P.summarize(s01, manual, []).deposit.status, 'pending');
    const offPlatform = store.rows('artist_wallet_movements').filter((m) => m.metadata_json && m.metadata_json.off_platform);
    assert.equal(offPlatform.length, 4);
    // Los saldos de la extensión "cuenta" no cambian (USD 1.240 disponible).
    const moves = store.rows('artist_wallet_movements').map(W.normalizeMovement);
    assert.equal(W.summarize(moves, 'USD').available, 1240);
});

test('fixtures: RPC espejo de record/void con las mismas reglas que el SQL', () => {
    const { fx, store, me } = makeDemo();
    const d01 = fx.tables.quotations_db.find((q) => q.quote_id === 'DEMO-D01');
    const p01 = fx.tables.quotations_db.find((q) => q.quote_id === 'DEMO-P01');
    const args = { p_quotation_id: d01.id, p_kind: 'session', p_method: 'transfer', p_amount: 100, p_currency: 'usd', p_paid_on: null, p_note: 'ok' };
    const okRes = rpc(store, 'record_quotation_payment', args, me);
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.currency, 'USD');
    assert.ok(store.rows('artist_wallet_movements').some((m) => m.external_reference === 'quotation_payment:' + okRes.body.id));
    assert.equal(rpc(store, 'record_quotation_payment', Object.assign({}, args, { p_amount: 0 }), me).status, 400);
    assert.equal(rpc(store, 'record_quotation_payment', Object.assign({}, args, { p_currency: 'BOB' }), me).status, 400);
    assert.equal(rpc(store, 'record_quotation_payment', Object.assign({}, args, { p_quotation_id: p01.id }), me).status, 400, 'pendiente');
    assert.equal(rpc(store, 'record_quotation_payment', args, 'otro-usuario').status, 400, 'ajeno');
    assert.equal(rpc(store, 'void_quotation_payment', { p_payment_id: okRes.body.id }, 'otro-usuario').status, 400);
    const voided = rpc(store, 'void_quotation_payment', { p_payment_id: okRes.body.id }, me);
    assert.equal(voided.status, 200);
    assert.ok(!store.rows('quotation_payments').some((p) => p.id === okRes.body.id));
    const mv = store.rows('artist_wallet_movements').find((m) => m.external_reference === 'quotation_payment:' + okRes.body.id);
    assert.equal(mv.status, 'cancelled');

    // RPC de soporte del preview: rechazo con nota obligatoria.
    const doc = store.rows('artist_verification_documents')[0];
    assert.equal(rpc(store, 'support_review_verification_document', { p_document_id: doc.id, p_decision: 'rechazado', p_note: 'no' }, me).status, 400);
    const reviewed = rpc(store, 'support_review_verification_document', { p_document_id: doc.id, p_decision: 'rechazado', p_note: 'Foto borrosa, subila de nuevo' }, me);
    assert.equal(reviewed.body.status, 'rechazado');
    assert.equal(reviewed.body.reviewer_notes, 'Foto borrosa, subila de nuevo');
    const dest = store.rows('artist_payout_destinations')[0];
    const verified = rpc(store, 'support_review_payout_destination', { p_destination_id: dest.id, p_decision: 'verified', p_note: null }, me);
    assert.equal(verified.body.verification_status, 'verified');
});

/* --------------------------------- cableado --------------------------------- */

test('páginas: REGISTRAR PAGO abre el modal, el detalle monta el bloque de pagos y soporte suma VERIFICACIONES', () => {
    const dash = read('public/artist/dashboard/index.html');
    assert.match(dash, /<button class="wod-quick-btn" id="wod-register-payment" type="button" aria-haspopup="dialog">/);
    assert.doesNotMatch(dash, /id="wod-register-payment" href=/);
    for (const s of ['quotation-payments-model.js', 'data/quotation-payments-repo.js', 'quotation-payment-dialog.js', 'dashboard-payments.js']) {
        assert.ok(dash.includes('/shared/js/' + s), s + ' en el dashboard');
    }
    assert.ok(dash.includes('/shared/css/quotation-payments.css'));

    const detail = read('public/my-quotations/detail/index.html');
    assert.ok(detail.indexOf('quotation-payments-panel.js') < detail.indexOf('quotation-detail-figma.js'), 'el panel escucha antes del primer render');
    const qd = read('public/shared/js/quotation-detail-figma.js');
    assert.match(qd, /<div id="qd-payments-slot"><\/div>/);
    assert.match(qd, /wo:quotation-detail-rendered/);

    const support = read('public/support/dashboard/index.html');
    assert.equal((support.match(/data-tab="verificacion"/g) || []).length, 2);
    assert.ok(support.indexOf('support-dashboard-verification.js') > support.indexOf('support-dashboard-instagram.js'));

    // Capa de datos: nada de CRUD ad-hoc en los módulos de UI.
    for (const f of ['quotation-payment-dialog.js', 'quotation-payments-panel.js', 'dashboard-payments.js', 'support-dashboard-verification.js']) {
        const src = read('public/shared/js/' + f);
        assert.doesNotMatch(src, /\.from\('|\/rest\/v1\//, f + ' usa los repos');
    }
    // El dashboard suma la actividad por el punto de extensión, sin tocar dashboard-redesign.js.
    assert.match(read('public/shared/js/dashboard-payments.js'), /registerSource\('payments'/);
});
