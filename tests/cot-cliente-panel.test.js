'use strict';
// Frente cot-cliente (beta cerrada): panel del cliente — estados claros,
// propuesta del artista, desglose manual, anticipo/pagos y aceptar/rechazar
// (CC-01 / CC-11 / CC-13 / COT-A-10), y vínculo por el servidor (CC-02).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UI = require('../public/shared/js/client-quote-proposal.js');
const PaymentsModel = require('../public/shared/js/quotation-payments-model.js');

const NOW = Date.parse('2026-11-15T12:00:00Z');
const q = (over = {}) => ({
    id: 7, quote_id: 'WO-7', quote_status: 'responded', artist_name: 'Lau', artist_responded_at: '2026-11-10T00:00:00Z',
    artist_budget_amount: '410000', artist_budget_currency: 'ARS', tattoo_estimated_sessions: '2', artist_session_minutes: 150,
    quote_expires_at: '2026-11-20T00:00:00Z', dispute_status: 'none', ...over,
});

// ------------------------------------------------------------ estados (CC-13)
test('estados con etiqueta clara: borradores no son "En proceso", vencidas y canceladas tienen nombre', () => {
    assert.equal(UI.statusOf({ quote_status: 'in_progress' }, NOW).label, 'Borrador sin enviar');
    assert.equal(UI.statusOf({ quote_status: 'in_progress', artist_responded_at: '2026-01-01' }, NOW).label, 'En curso');
    assert.equal(UI.statusOf({ quote_status: 'en_progreso', artist_responded_at: '2026-01-01' }, NOW).label, 'En curso');
    assert.equal(UI.statusOf({ quote_status: 'expired' }, NOW).label, 'Vencida');
    assert.equal(UI.statusOf(q({ quote_expires_at: '2026-11-01T00:00:00Z' }), NOW).label, 'Vencida');
    assert.equal(UI.statusOf({ quote_status: 'cancelled' }, NOW).label, 'Cancelada');
    assert.equal(UI.statusOf({ quote_status: 'pending' }, NOW).label, 'Esperando al artista');
    assert.equal(UI.statusOf({ quote_status: 'raro' }, NOW).label, 'En revisión');
    for (const s of ['pending', 'responded', 'client_approved', 'client_rejected', 'artist_completed', 'completed', 'cancelled', 'expired']) {
        assert.doesNotMatch(UI.statusOf({ quote_status: s, artist_responded_at: 'x' }, NOW).label, /_/);
    }
});

test('filtros: los borradores nunca entran al listado; "Activas" incluye propuestas por responder', () => {
    const draft = { quote_status: 'in_progress' };
    assert.equal(UI.matchesFilter(draft, 'all', NOW), false);
    assert.equal(UI.matchesFilter(draft, 'active', NOW), false);
    assert.equal(UI.matchesFilter(q(), 'active', NOW), true);
    assert.equal(UI.matchesFilter({ quote_status: 'completed' }, 'completed', NOW), true);
    assert.equal(UI.matchesFilter({ quote_status: 'cancelled' }, 'active', NOW), false);
});

// ------------------------------------------------------------ propuesta (CC-01)
test('la propuesta muestra monto, moneda, sesiones, duración y vigencia, con Aceptar/Rechazar', () => {
    const html = UI.renderProposal(q(), { now: NOW });
    assert.match(html, /Propuesta del artista/);
    assert.match(html, /410\.000 ARS/);
    assert.match(html, /<dt>Sesiones<\/dt><dd>2<\/dd>/);
    assert.match(html, /2 h 30 min/);
    assert.match(html, /Válida hasta/);
    assert.match(html, /data-proposal-action="approve"/);
    assert.match(html, /data-proposal-action="reject"/);
    assert.match(html, /data-quote-id="WO-7"/);
    assert.doesNotMatch(html, /undefined|NaN|null/);
});

test('sin botones si venció, si hay disputa o si ya se decidió', () => {
    for (const over of [{ quote_expires_at: '2026-11-01T00:00:00Z' }, { dispute_status: 'open' }, { quote_status: 'client_approved' }, { quote_status: 'client_rejected' }]) {
        const html = UI.renderProposal(q(over), { now: NOW });
        assert.doesNotMatch(html, /data-proposal-action="approve"/, JSON.stringify(over));
    }
    assert.match(UI.renderProposal(q({ quote_expires_at: '2026-11-01T00:00:00Z' }), { now: NOW }), /Venció el/);
    assert.match(UI.renderProposal(q({ quote_status: 'client_approved', final_budget_amount: '400000', final_budget_currency: 'ARS', final_sessions: '3' }), { now: NOW }), /Acuerdo con el artista[\s\S]*Total acordado[\s\S]*400\.000 ARS/);
});

test('pendiente y borrador explican el estado sin inventar montos', () => {
    const pending = UI.renderProposal({ quote_id: 'WO-1', quote_status: 'pending' }, { now: NOW });
    assert.match(pending, /todavía no respondió/);
    assert.doesNotMatch(pending, /data-proposal-action/);
    const draft = UI.renderProposal({ quote_id: 'WO-2', quote_status: 'in_progress' }, { now: NOW });
    assert.match(draft, /Continuar cotización/);
});

test('todo lo que viene de datos se escapa', () => {
    const html = UI.renderProposal(q({ quote_id: 'WO-"><img>', artist_availability: '<script>x</script>', final_comment: '<b>ok</b>' }), {
        now: NOW,
        manual: { status: 'sent', currency: 'ARS', line_items: [{ name: '<i>Diseño</i>', qty: 1, price: 1000 }], subtotal: 1000, total: 1000, client_notes: '<a href=x>', extra_terms: '' },
    });
    assert.doesNotMatch(html, /<script>|<b>ok|<i>Diseño|<img>|<a href=x>/);
    assert.match(html, /&lt;script&gt;/);
    const confirm = UI.confirmHtml('reject', 'WO-"><x>');
    assert.doesNotMatch(confirm, /"><x>/);
    assert.match(confirm, /<label class="wo-label" for="cqp-reason-WO-x">/);
});

// ------------------------------------------------------------ desglose manual (COT-A-10)
test('cotización manual: conceptos, descuento, impuestos, anticipo, condiciones y notas', () => {
    const manual = {
        status: 'sent', currency: 'ars', line_items: [
            { name: 'Diseño personalizado', description: 'Boceto + ajustes', qty: '1', price: '50000' },
            { name: 'Sesión de tatuaje', qty: '2', price: '100000' },
        ],
        discount_pct: 10, tax_pct: 21, deposit_pct: 30, subtotal: 250000, total: 272250, deposit_amount: 81675,
        validity_days: 14, cancellation_policy: 'no-reembolsable-48', client_notes: 'Transfiere al alias LAU.INK', extra_terms: 'Traer DNI',
    };
    const b = UI.manualBreakdown(manual);
    assert.equal(b.items.length, 2);
    assert.equal(b.items[1].total, 200000);
    assert.equal(b.discount, 25000);
    assert.equal(b.tax, 47250);
    assert.equal(b.deposit, 81675);
    assert.equal(b.balance, 190575);
    const html = UI.renderProposal(q({ artist_budget_amount: '272250' }), { now: NOW, manual });
    assert.match(html, /Desglose/);
    assert.match(html, /Diseño personalizado/);
    assert.match(html, /Sesión de tatuaje × 2/);
    assert.match(html, /Descuento \(10%\)/);
    assert.match(html, /Impuestos \(21%\)/);
    assert.match(html, /Anticipo \(30%\)/);
    assert.match(html, /81\.675 ARS/);
    assert.match(html, /El anticipo no es reembolsable/);
    assert.match(html, /Transfiere al alias LAU\.INK/);
    assert.match(html, /Traer DNI/);
});

// ------------------------------------------------------------ anticipo y pagos (CC-11)
test('anticipo y pagos: estado del anticipo, pagado y saldo; sin pasarela inventada', () => {
    const manual = { status: 'sent', currency: 'ARS', total: 300000, deposit_amount: 90000, deposit_pct: 30, line_items: [] };
    const quote = q({ quote_status: 'client_approved', final_budget_amount: '300000', final_budget_currency: 'ARS' });
    const summary = PaymentsModel.summarize(quote, manual, [
        { id: 'p1', quotation_id: 7, kind: 'deposit', method: 'transfer', amount: 90000, currency: 'ARS', paid_on: '2026-11-12' },
    ]);
    const html = UI.renderProposal(quote, { now: NOW, manual, payments: { summary } });
    assert.match(html, /Anticipo y pagos/);
    assert.match(html, /<dt>Estado del anticipo<\/dt><dd>Pagado<\/dd>/);
    assert.match(html, /<dt>Pagado<\/dt><dd>90\.000 ARS<\/dd>/);
    assert.match(html, /<dt>Saldo<\/dt><dd>210\.000 ARS<\/dd>/);
    assert.match(html, /Transferencia/);
    assert.match(html, /coordina el anticipo y el saldo con el artista/);
    assert.doesNotMatch(html, /Pagar ahora|checkout|mercadopago/i);

    const pendingDeposit = UI.renderProposal(q(), { now: NOW, manual });
    assert.match(pendingDeposit, /<dt>Estado del anticipo<\/dt><dd>Pendiente<\/dd>/);
});

// ------------------------------------------------------------ dashboard (vm)
function memoryStorage() {
    const data = new Map();
    return {
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        setItem(k, v) { data.set(k, String(v)); },
        removeItem(k) { data.delete(k); },
    };
}

function dashboard({ search = '', withUi = true, storage = memoryStorage() } = {}) {
    const nodes = new Map();
    const channel = { on() { return this; }, subscribe() { return this; } };
    const sdk = { auth: { async getSession() { return { data: { session: { access_token: 't', user: { id: 'u1' } } } }; } } };
    const window = { _supabase: sdk, location: { search }, sessionStorage: storage };
    if (withUi) window.WoClientQuoteProposal = UI;
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, Date, URLSearchParams, URL, Intl,
        window,
        supabase: { createClient() { throw new Error('sin cliente real'); } },
        WeotziData: { channel() { return channel; } },
        document: {
            addEventListener() {}, body: { style: {} },
            getElementById(id) {
                if (!nodes.has(id)) nodes.set(id, { id, innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {} });
                return nodes.get(id);
            },
        },
    });
    vm.runInContext(read('public/shared/js/client-dashboard.js'), context, { filename: 'client-dashboard.js' });
    vm.runInContext('loadChatMessages = async () => {}; subscribeToChatMessages = () => {};', context);
    return { context, nodes };
}

test('listado: borradores aparte con "Continuar cotización", sin estados crudos', () => {
    for (const withUi of [true, false]) {
        const { context, nodes } = dashboard({ withUi });
        context.list = [
            { quote_id: 'WO-D', quote_status: 'in_progress', created_at: '2026-11-01' },
            { quote_id: 'WO-R', quote_status: 'responded', artist_responded_at: '2026-11-10', artist_budget_amount: '1000', artist_budget_currency: 'USD', created_at: '2026-11-02', quote_expires_at: '2099-01-01T00:00:00Z' },
            { quote_id: 'WO-C', quote_status: 'cancelled', created_at: '2026-11-03' },
        ];
        vm.runInContext('currentQuotations = list; currentFilter = "all"; renderQuotations();', context);
        const html = nodes.get('quotations-list').innerHTML;
        assert.match(html, /Tienes una cotización sin enviar/);
        assert.match(html, /href="\/quotation"/);
        assert.doesNotMatch(html, /data-quote-id="WO-D"/, `withUi=${withUi}`);
        assert.doesNotMatch(html, /En proceso|>cancelled<|>in_progress</);
        assert.match(html, /Cancelada/);
        assert.match(html, /Propuesta recibida/);
        if (withUi) {
            assert.match(html, /Esperando tu respuesta/);
            assert.match(html, /Ver propuesta/);
        }
    }
});

test('card y detalle escapan datos y no interpolan quote_id en JS', async () => {
    const { context, nodes } = dashboard();
    context.quotation = {
        quote_id: "WO-1'); alert(1);//", quote_status: 'pending', artist_name: '<img src=x>', tattoo_body_part: '<b>brazo</b>',
        tattoo_idea_description: '<script>x</script>', tattoo_references: 'javascript:alert(1)', client_travel_willing: 'false',
    };
    const card = vm.runInContext('renderQuotationCard(quotation)', context);
    assert.doesNotMatch(card, /<img src=x>|<b>brazo<\/b>/);
    assert.doesNotMatch(card, /onclick="[^"]*'WO-1/);
    assert.match(card, /onclick="viewQuotationDetail\(this\.dataset\.quoteId\)"/);
    vm.runInContext('currentQuotations = [quotation]', context);
    await vm.runInContext('viewQuotationDetail(quotation.quote_id)', context);
    const html = nodes.get('quotation-detail-content').innerHTML;
    assert.doesNotMatch(html, /<script>x<\/script>|<img src=x>|javascript:/);
    assert.match(html, /Disponibilidad para viajar<\/label>\s*<span>No<\/span>/);
    assert.match(html, /id="quote-proposal-slot"/);
});

test('deep link ?quote=ID abre el detalle de esa cotización', async () => {
    const { context, nodes } = dashboard({ search: '?quote=WO-R' });
    context.list = [{ quote_id: 'WO-R', quote_status: 'responded', artist_responded_at: '2026-11-10', artist_budget_amount: '1000', artist_budget_currency: 'USD', quote_expires_at: '2099-01-01T00:00:00Z' }];
    vm.runInContext('currentQuotations = list; currentClient = { user_id: "u1" }', context);
    await vm.runInContext('openQuotationFromUrl()', context);
    assert.equal(nodes.get('modal-quote-id').textContent, 'WO-R');
    assert.match(nodes.get('quotation-detail-content').innerHTML, /data-proposal-action="approve"/);
});

test('revisión: el deep link sobrevive al login (sessionStorage) y no se consume sin sesión', async () => {
    const storage = memoryStorage();
    // 1) Llega sin sesión con ?quote=WO-R: se guarda y openQuotationFromUrl no lo consume.
    const first = dashboard({ search: '?quote=WO-R', storage });
    vm.runInContext('rememberPendingQuote(); currentClient = null;', first.context);
    await vm.runInContext('openQuotationFromUrl()', first.context);
    assert.equal(storage.getItem('wo_client_pending_quote'), 'WO-R');
    // 2) Vuelve del login a /client/dashboard sin ?quote: se abre y se limpia.
    const second = dashboard({ search: '', storage });
    second.context.list = [{ quote_id: 'WO-R', quote_status: 'responded', artist_responded_at: '2026-11-10', artist_budget_amount: '1000', artist_budget_currency: 'USD', quote_expires_at: '2099-01-01T00:00:00Z' }];
    vm.runInContext('currentQuotations = list; currentClient = { user_id: "u1" }', second.context);
    await vm.runInContext('openQuotationFromUrl()', second.context);
    assert.equal(second.nodes.get('modal-quote-id').textContent, 'WO-R');
    assert.equal(storage.getItem('wo_client_pending_quote'), null);
});

test('revisión: el banner de /client/chats usa las mismas etiquetas que el panel', () => {
    const js = read('public/shared/js/client-chats.js');
    assert.match(js, /in_progress:\s*\{ label: 'En curso'/);
    assert.match(js, /artist_completed: \{ label: 'Por confirmar'/);
    assert.match(js, /client_approved:\s*\{ label: 'Aceptada'/);
    assert.doesNotMatch(js, /'En proceso'|'Por finalizar'/);
    assert.doesNotMatch(js, /label: t\.quote_status/);
});

test('el dashboard vincula por el servidor en cada carga y no reclama desde el navegador', () => {
    const js = read('public/shared/js/client-dashboard.js');
    assert.match(js, /WeotziData\.Api\.claimMine\(accessToken\)/);
    assert.match(js, /await linkQuotationsByEmail\(session\.access_token\)/);
    assert.match(js, /WeotziData\.Api\.decideByClient\(quoteId, decision, reason, session\.access_token\)/);
    assert.doesNotMatch(js, /findUnclaimedByEmail|claimByQuoteIds/);
    const auth = read('public/shared/js/client-auth.js');
    assert.match(auth, /WeotziData\.Api\.claimMine\(token\)/);
    assert.doesNotMatch(auth, /findUnclaimedByEmail|claimByQuoteIds|claimByQuoteId\(/);
    const repo = read('public/shared/js/data/quotations-repo.js');
    assert.match(repo, /claimMine\(accessToken\)/);
    assert.match(repo, /\/api\/client\/quotations\/\$\{encodeURIComponent\(quoteId\)\}\/decision/);
    assert.doesNotMatch(repo, /findUnclaimedByEmail|claimByQuoteIds|claimByQuoteId\(/);
    const html = read('public/client/dashboard/index.html');
    for (const src of ['data/quotation-new-repo.js', 'data/quotation-payments-repo.js', 'quotation-payments-model.js', 'client-quote-proposal.js']) {
        assert.ok(html.includes(`/shared/js/${src}`), src);
    }
    assert.ok(html.indexOf('client-quote-proposal.js') < html.indexOf('client-dashboard.js'));
    assert.match(html, /client-quote-proposal\.css/);
});

test('Api del front: claimMine y decideByClient mandan JSON con el token y propagan status/código', async () => {
    const calls = [];
    const window = { location: { pathname: '/client/dashboard' } };
    const WeotziData = { run: async () => ({}), orValue: (v) => v };
    window.WeotziData = WeotziData;
    const context = vm.createContext({
        window, console,
        fetch: async (url, opts) => {
            calls.push({ url, opts });
            if (url.endsWith('/decision')) return { ok: false, status: 410, json: async () => ({ success: false, code: 'expired', error: 'La propuesta venció.' }) };
            return { ok: true, status: 200, json: async () => ({ success: true, linked: 0 }) };
        },
    });
    vm.runInContext(read('public/shared/js/data/quotations-repo.js'), context);
    const Api = window.WeotziData.Api;
    await Api.claimMine('tok');
    assert.equal(calls[0].url, '/api/client/quotations/claim');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
    await assert.rejects(() => Api.decideByClient('WO 7', 'reject', 'caro', 'tok'), (err) => err.status === 410 && err.code === 'expired' && /venció/.test(err.message));
    assert.equal(calls[1].url, '/api/client/quotations/WO%207/decision');
    assert.deepEqual(JSON.parse(calls[1].opts.body), { decision: 'reject', reason: 'caro' });
    assert.equal(calls[1].opts.headers['Content-Type'], 'application/json');
});

test('repo de servidor: filtros PostgREST del claim y de la decisión', async () => {
    const prev = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: global.fetch };
    process.env.SUPABASE_URL = 'https://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    const seen = [];
    global.fetch = async (url, opts) => { seen.push({ url, method: opts.method, body: opts.body }); return { ok: true, status: 200, headers: { get: () => null }, text: async () => '[]' }; };
    try {
        const { ClientQuotationsRepo } = require('../lib/repos/client-quotations');
        await ClientQuotationsRepo.listUnclaimedByEmail('a_b@x.com');
        // %2A = * (comodín de PostgREST); el _ del email va escapado (%5C_).
        assert.match(seen[0].url, /client_email=ilike\.%2Aa%5C_b%40x\.com%2A/);
        assert.match(seen[0].url, /client_user_id=is\.null/);
        await ClientQuotationsRepo.decide(7, { quote_status: 'client_approved' }, { userId: 'u1', claim: false });
        assert.equal(seen[1].method, 'PATCH');
        assert.match(seen[1].url, /id=eq\.7/);
        assert.match(seen[1].url, /quote_status=eq\.responded/);
        assert.match(seen[1].url, /client_user_id=eq\.u1/);
        await ClientQuotationsRepo.decide(7, { quote_status: 'client_rejected' }, { userId: 'u1', claim: true });
        assert.match(seen[2].url, /client_user_id=is\.null/);
        assert.deepEqual(JSON.parse(seen[2].body), { quote_status: 'client_rejected', client_user_id: 'u1' });
    } finally {
        if (prev.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prev.url;
        if (prev.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key;
        global.fetch = prev.fetch;
    }
});
