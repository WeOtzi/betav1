// Inicio del panel de estudio (W-HOME): tarjetas de pendientes con enlace vía
// ctx.navigate, KPIs del mes por moneda y tarjetas que se ocultan cuando su
// fuente falla por migración pendiente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('public/shared/js/studio-dashboard-home.js');
const kit = require('../public/shared/js/studio-admin-kit.js');

const EXPOSED = [
    'settleSource', 'call', 'combine', 'classifyContracts', 'requestsCard', 'contractsCard', 'agendaCard',
    'stockCard', 'restockCard', 'spotsCard', 'monthKpis', 'buildModel', 'collectSources', 'summaryText',
    'cardHtml', 'renderHome', 'loadSpotsWithNewApplications', 'ranges', 'state'
];

function loadHome({ data = {}, withAdmin = true } = {}) {
    const registered = {};
    const warnings = [];
    const window = { WeOtziStudioKit: kit, WeotziData: data };
    if (withAdmin) window.WeOtziStudioAdmin = { register(tab, def) { registered[tab] = def; return true; } };
    const exposed = source.replace(/\}\)\(\);\s*$/, 'globalThis.__home = { ' + EXPOSED.join(', ') + ' }; })();');
    const context = { window, console: { warn: (...a) => warnings.push(a), error() {}, log() {} } };
    vm.runInNewContext(exposed, context);
    return { api: context.__home, registered, warnings };
}

const ok = rows => ({ state: 'ok', rows });
const MISSING = { state: 'missing' };
const fail = (message = 'permission denied') => ({ state: 'error', error: { message } });

function fakeRoot() {
    const listeners = {};
    return {
        innerHTML: '', attrs: {}, listeners,
        setAttribute(k, v) { this.attrs[k] = v; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
        contains() { return true; },
        querySelector() { return null; }
    };
}

// Simula un click sobre un elemento con los atributos dados.
function clickOn(root, attrs, extra = {}) {
    const el = { getAttribute: key => (key in attrs ? attrs[key] : null) };
    const target = {
        closest(selector) {
            const m = /^\[([a-z-]+)\]$/.exec(selector);
            return m && attrs[m[1]] != null ? el : null;
        }
    };
    let prevented = false;
    const event = Object.assign({ target, button: 0, preventDefault() { prevented = true; } }, extra);
    (root.listeners.click || []).forEach(cb => cb(event));
    return prevented;
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const at = (base, days, hours = 12, minutes = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hours, minutes);
const NOW = new Date(2026, 9, 30, 10, 0); // jueves 30/10/2026 10:00 local

// ---------------------------------------------------------------
// Registro y fuentes
// ---------------------------------------------------------------
test('se registra en la pestaña inicio con mount y show', () => {
    const { registered } = loadHome();
    assert.deepEqual(Object.keys(registered), ['inicio']);
    assert.equal(typeof registered.inicio.mount, 'function');
    assert.equal(typeof registered.inicio.show, 'function');
});

test('sin WeOtziStudioAdmin avisa y no rompe', () => {
    const { warnings } = loadHome({ withAdmin: false });
    assert.equal(warnings.length, 1);
});

test('settleSource: método ausente, unavailable y códigos de migración cuentan como pendiente', async () => {
    const { api } = loadHome();
    assert.equal((await api.settleSource(() => api.call({}, 'Supplies', 'listOrdersForStudio', 's'))).state, 'missing');
    assert.equal((await api.settleSource(async () => ({ data: [], error: null, unavailable: true }))).state, 'missing');
    for (const code of ['42P01', 'PGRST205', 'PGRST202', '42883', '42703', 'PGRST204', 'PGRST200']) {
        assert.equal((await api.settleSource(async () => ({ data: null, error: { code, message: 'x' } }))).state, 'missing', code);
    }
    assert.equal((await api.settleSource(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); })).state, 'missing');
    const err = await api.settleSource(async () => ({ data: null, error: { code: '42501', message: 'sin permiso' } }));
    assert.equal(err.state, 'error');
    assert.equal(err.error.message, 'sin permiso');
    const thrown = await api.settleSource(async () => { throw new Error('Failed to fetch'); });
    assert.equal(thrown.state, 'error');
    const rows = await api.settleSource(async () => ({ data: [{ id: 1 }, null], error: null }));
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), { state: 'ok', rows: [{ id: 1 }] });
});

test('combine oculta si todas faltan, falla si ninguna respondió y marca parcial', () => {
    const { api } = loadHome();
    assert.equal(api.combine([MISSING, MISSING]).hidden, true);
    assert.equal(api.combine([MISSING, fail()]).failed, true);
    assert.equal(api.combine([ok([]), fail()]).partial, true);
    assert.equal(api.combine([ok([]), MISSING]).partial, false);
    assert.equal(api.combine([{ state: 'ok', rows: [], partial: true }]).partial, true);
});

// ---------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------
test('solicitudes suma altas, cambios pedidos y contraofertas; se oculta sin las tres fuentes', () => {
    const { api } = loadHome();
    const card = api.requestsCard({
        requests: ok([{ id: 'r1', status: 'requested' }, { id: 'r2', status: 'requested' }]),
        changes: ok([{ id: 'c1', status: 'pending' }]),
        counters: MISSING
    });
    assert.equal(card.count, 3);
    assert.equal(card.tab, 'solicitudes');
    assert.deepEqual([...card.lines], ['2 altas para aprobar', '1 cambio pedido']);
    assert.equal(api.requestsCard({ requests: MISSING, changes: MISSING, counters: MISSING }), null);
    const failed = api.requestsCard({ requests: fail(), changes: MISSING, counters: MISSING });
    assert.equal(failed.failed, true);
    assert.equal(failed.count, null);
});

test('contratos: esperando firma, por vencer, vigencia que termina y vencidos sin reemplazo', () => {
    const { api } = loadHome();
    const iso = d => d.toISOString();
    const rows = [
        { id: 'w1', status: 'sent', expires_at: iso(at(NOW, 10)), created_at: iso(at(NOW, -2)) },
        { id: 'w2', status: 'sent', expires_at: iso(at(NOW, 2)), created_at: iso(at(NOW, -12)) },
        { id: 'o1', status: 'sent', expires_at: iso(at(NOW, 0, 8)), created_at: iso(at(NOW, -14)) },
        { id: 'e1', status: 'expired', expires_at: iso(at(NOW, -5)), created_at: iso(at(NOW, -19)), membership_id: 'm1' },
        { id: 'e2', status: 'expired', expires_at: iso(at(NOW, -6)), created_at: iso(at(NOW, -20)), membership_id: 'm2' },
        { id: 'd2', status: 'draft', created_at: iso(at(NOW, -1)), membership_id: 'm2' },
        { id: 'e3', status: 'expired', expires_at: iso(at(NOW, -45)), created_at: iso(at(NOW, -60)) },
        { id: 's1', status: 'signed', end_date: kit.toDateInput(at(NOW, 3)) },
        { id: 's2', status: 'signed', end_date: kit.toDateInput(at(NOW, 10)) },
        { id: 's3', status: 'signed', end_date: null }
    ];
    const c = api.classifyContracts(rows, NOW);
    const ids = list => Array.from(list, r => r.id);
    assert.deepEqual(ids(c.waiting), ['w1', 'w2']);
    assert.deepEqual(ids(c.expiringSoon), ['w2']);
    assert.deepEqual(ids(c.endingSoon), ['s1']);
    assert.deepEqual(ids(c.overdue), ['o1', 'e1'], 'e2 tiene un borrador nuevo y e3 es viejo');

    const card = api.contractsCard({ contracts: ok(rows) }, NOW);
    assert.equal(card.count, 5);
    assert.equal(card.tone, 'danger');
    assert.deepEqual([...card.lines], [
        '2 contratos esperando firma', '1 vence en 3 días o menos',
        '1 termina su vigencia en 3 días o menos', '2 vencidos sin firmar'
    ]);
    assert.equal(api.contractsCard({ contracts: MISSING }, NOW), null);
});

test('agenda cuenta las citas confirmadas de hoy y de mañana y muestra la próxima', () => {
    const { api } = loadHome();
    const iso = d => d.toISOString();
    const rows = [
        { id: 'b0', status: 'confirmed', starts_at: iso(at(NOW, 0, 8)), ends_at: iso(at(NOW, 0, 9)), client_name: 'Pasada', artists_db: { name: 'Leo' } },
        { id: 'b1', status: 'confirmed', starts_at: iso(at(NOW, 0, 15, 30)), ends_at: iso(at(NOW, 0, 17)), client_name: 'Juana', artists_db: { name: 'Leo' } },
        { id: 'b2', status: 'cancelled', starts_at: iso(at(NOW, 0, 16)), ends_at: iso(at(NOW, 0, 17)) },
        { id: 'b3', status: 'confirmed', starts_at: iso(at(NOW, 1, 11)), ends_at: iso(at(NOW, 1, 12)), artists_db: { username: 'mica' } }
    ];
    const card = api.agendaCard({ bookings: ok(rows) }, NOW);
    assert.equal(card.count, 3);
    assert.deepEqual([...card.lines], ['Hoy: 2 citas', 'Mañana: 1 cita', 'Próxima: hoy 15:30 · Juana con Leo']);
    const empty = api.agendaCard({ bookings: ok([]) }, NOW);
    assert.equal(empty.count, 0);
    assert.deepEqual([...empty.lines], []);
    assert.match(api.cardHtml(empty), /Sin citas para hoy ni para mañana\./);
});

test('stock bajo lista hasta tres ítems y resume el resto', () => {
    const { api } = loadHome();
    const rows = [
        { id: 1, name: 'Tinta negra', quantity_on_hand: 2, reorder_level: 5, unit: 'frascos' },
        { id: 2, name: 'Guantes', quantity_on_hand: 50, reorder_level: 10 },
        { id: 3, name: 'Agujas 3RL', quantity_on_hand: 0, reorder_level: 20 },
        { id: 4, name: 'Film', quantity_on_hand: 1, reorder_level: 1 },
        { id: 5, name: 'Vaselina', quantity_on_hand: 3, reorder_level: 4 },
        { id: 6, name: 'Sin mínimo', quantity_on_hand: 0, reorder_level: null }
    ];
    const card = api.stockCard({ stock: ok(rows) });
    assert.equal(card.count, 4);
    assert.equal(card.tab, 'inventory');
    assert.equal(card.tone, 'danger');
    assert.deepEqual([...card.lines], ['Agujas 3RL: 0 (mín. 20)', 'Film: 1 (mín. 1)', 'Tinta negra: 2 frascos (mín. 5)', 'y 1 ítem más']);
});

test('reposición: en camino, por recibir y total actualizado por moneda; un solo pedido abre su detalle', () => {
    const { api } = loadHome();
    const card = api.restockCard({ orders: ok([
        { id: 'p1', status: 'shipped', total: 100, currency: 'ARS' },
        { id: 'p2', status: 'delivered', total: 50, currency: 'ARS' },
        { id: 'p3', status: 'confirmed', shipping_amount: 10, total: 1200, currency: 'ARS' },
        { id: 'p4', status: 'confirmed', shipping_amount: 5, total: 80.5, currency: 'USD' },
        { id: 'p5', status: 'confirmed', shipping_amount: 0, total: 999, currency: 'ARS' }
    ]) });
    assert.equal(card.count, 4);
    assert.equal(card.tone, 'warning');
    assert.deepEqual({ ...card.params }, { view: 'pedidos' }, 'varios pedidos: Reposición abre en Mis pedidos');
    assert.equal(card.lines[0], '1 pedido en camino');
    assert.equal(card.lines[1], '1 entregado: registrá la recepción');
    assert.match(card.lines[2], /^2 con total actualizado por el proveedor: /);
    assert.ok(card.lines[2].includes(kit.fmtMoney(1200, 'ARS')) && card.lines[2].includes(kit.fmtMoney(80.5, 'USD')), card.lines[2]);
    assert.ok(!card.lines[2].includes(kit.fmtMoney(999, 'ARS')));

    const single = api.restockCard({ orders: ok([{ id: 'p9', status: 'shipped', total: 1, currency: 'ARS' }]) });
    assert.deepEqual({ ...single.params }, { order: 'p9' });
    assert.equal(api.restockCard({ orders: MISSING }), null);
});

test('spots con postulaciones nuevas: solo cuenta las pending de spots abiertos con postulaciones', async () => {
    const { api } = loadHome();
    const asked = [];
    const D = { StudioSpots: {
        listByStudio: async () => ({ data: [
            { id: 's1', title: 'Guest de verano', status: 'open', application_count: 3 },
            { id: 's2', title: 'Residencia', status: 'open', application_count: 0 },
            { id: 's3', title: 'Cerrado', status: 'closed', application_count: 4 },
            { id: 's4', title: '', status: 'open', application_count: null }
        ], error: null }),
        listApplications: async spotId => {
            asked.push(spotId);
            if (spotId === 's1') return { data: [{ status: 'pending' }, { status: 'pending' }, { status: 'viewed' }], error: null };
            return { data: [{ status: 'pending' }], error: null };
        }
    } };
    const src = await api.loadSpotsWithNewApplications(D, 'st');
    assert.deepEqual(asked, ['s1', 's4']);
    const card = api.spotsCard({ spots: src });
    assert.equal(card.count, 3);
    assert.deepEqual([...card.lines], ['Guest de verano: 2 nuevas', 'Spot sin título: 1 nueva']);

    const partial = await api.loadSpotsWithNewApplications({ StudioSpots: {
        listByStudio: D.StudioSpots.listByStudio,
        listApplications: async spotId => (spotId === 's1' ? { data: null, error: { message: 'boom' } } : { data: [{ status: 'pending' }], error: null })
    } }, 'st');
    assert.equal(partial.partial, true);
    const partialCard = api.spotsCard({ spots: partial });
    assert.equal(partialCard.count, 1);
    assert.ok(partialCard.lines.includes('Parte de este dato no se pudo cargar.'));
});

// ---------------------------------------------------------------
// KPIs del mes
// ---------------------------------------------------------------
test('KPIs del mes: tatuajes, ingreso del estudio y gastos agrupados por moneda', () => {
    const { api } = loadHome();
    const kpis = api.monthKpis({
        metrics: ok([
            { month: '2026-10-01', currency: 'ARS', jobs_count: 4, gross_amount: 400000, studio_net: 160000 },
            { month: '2026-10-01', currency: 'USD', jobs_count: 1, gross_amount: 300, studio_net: 120 }
        ]),
        expenses: ok([
            { entry_type: 'expense', category: 'rent', currency: 'ARS', total: 90000 },
            { entry_type: 'expense', category: 'supplies', currency: 'ARS', total: 10000 },
            { entry_type: 'income', category: 'merch_manual', currency: 'ARS', total: 5000 }
        ])
    });
    assert.deepEqual(Array.from(kpis, k => k.id), ['tatuajes', 'ingreso', 'gastos']);
    assert.equal(kpis[0].value, '5');
    assert.ok(kpis[0].hint.includes(kit.fmtMoney(400000, 'ARS')) && kpis[0].hint.includes(kit.fmtMoney(300, 'USD')));
    assert.ok(kpis[1].valueHtml.includes(kit.escapeHtml(kit.fmtMoney(160000, 'ARS'))));
    assert.ok(kpis[1].valueHtml.includes(kit.escapeHtml(kit.fmtMoney(120, 'USD'))));
    assert.equal((kpis[1].valueHtml.match(/sk-total/g) || []).length, 2, 'una línea por moneda');
    assert.ok(kpis[2].valueHtml.includes(kit.escapeHtml(kit.fmtMoney(100000, 'ARS'))));
    assert.ok(!kpis[2].valueHtml.includes(kit.escapeHtml(kit.fmtMoney(105000, 'ARS'))), 'los ingresos no cuentan como gasto');
});

test('KPIs: la fuente con migración pendiente se oculta y el error deja el KPI con aviso', () => {
    const { api } = loadHome();
    assert.deepEqual(Array.from(api.monthKpis({ metrics: ok([]), expenses: MISSING }), k => k.id), ['tatuajes', 'ingreso']);
    assert.equal(api.monthKpis({ metrics: MISSING, expenses: MISSING }).length, 0);
    const failed = api.monthKpis({ metrics: fail(), expenses: ok([]) });
    assert.equal(failed[0].value, '—');
    assert.equal(failed[0].hint, 'No pudimos cargar este dato.');
    assert.match(failed[2].valueHtml, /Sin gastos/);
});

// ---------------------------------------------------------------
// Render, montaje y navegación
// ---------------------------------------------------------------
test('cardHtml escapa los datos y enlaza a la pestaña con data-nav', () => {
    const { api } = loadHome();
    const card = api.spotsCard({ spots: ok([{ id: 's', title: '<img src=x onerror=alert(1)>', newCount: 1 }]) });
    const html = api.cardHtml(card);
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.match(html, /^<a class="sk-kpi sk-kpi--warning" href="#spots" data-home-card="spots" data-nav="spots">/);
    assert.match(html, /Ver spots/);
    const failed = api.cardHtml(api.stockCard({ stock: fail() }));
    assert.match(failed, /<a class="sk-kpi" href="#inventory"/);
    assert.match(failed, /No pudimos cargar este dato\./);
    assert.match(failed, /sk-kpi__value">—</);
});

test('summaryText resume las novedades y avisa si algo falló', () => {
    const { api } = loadHome();
    assert.equal(api.summaryText([]), 'Todavía no hay datos para mostrar acá.');
    assert.equal(api.summaryText([{ count: 0 }, { count: 0 }]), 'Estás al día: no hay nada pendiente.');
    assert.equal(api.summaryText([{ count: 2 }, { count: 1 }]), 'Tenés 3 novedades para revisar.');
    assert.equal(api.summaryText([{ count: 1 }, { failed: true, count: null }]), 'Tenés 1 novedad para revisar. Algunos datos no se pudieron cargar.');
});

function repos({ withMigrations }) {
    const now = new Date();
    const later = new Date(now.getTime() + 2 * 3600000);
    const missing = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    const calls = [];
    const track = (name, value) => async (...args) => { calls.push([name, ...args]); return value; };
    const data = {
        StudioMemberships: {
            listRequestsForStudio: track('requests', withMigrations ? { data: [{ id: 'r1', status: 'requested' }], error: null } : { data: [], error: null, unavailable: true }),
            listChangeRequestsForStudio: track('changes', withMigrations ? { data: [], error: null } : { data: [], error: null, unavailable: true })
        },
        StudioSpots: {
            listArtistCounterOffersForStudio: track('counters', withMigrations ? { data: [], error: null } : { data: [], error: null, unavailable: true }),
            listByStudio: track('spots', { data: [{ id: 'sp', title: 'Guest <b>verano</b>', status: 'open', application_count: 1 }], error: null }),
            listApplications: track('applications', { data: [{ status: 'pending' }], error: null })
        },
        StudioOps: {
            listBookingsRange: track('bookings', { data: [{ id: 'b', status: 'confirmed', starts_at: later.toISOString(), ends_at: new Date(later.getTime() + 3600000).toISOString(), client_name: 'Ana', artists_db: { name: 'Leo' } }], error: null }),
            listInventoryItems: track('stock', { data: [{ id: 'i', name: 'Tinta', quantity_on_hand: 1, reorder_level: 3 }], error: null }),
            listMonthlyMetrics: track('metrics', { data: [{ currency: 'ARS', jobs_count: 2, gross_amount: 1000, studio_net: 400 }], error: null })
        }
    };
    if (withMigrations) {
        data.StudioContracts = { listForStudio: track('contracts', { data: [{ id: 'c', status: 'sent', expires_at: new Date(now.getTime() + 10 * 86400000).toISOString() }], error: null }) };
        data.StudioFinance = { monthlyByCategory: track('finance', { data: [{ entry_type: 'expense', currency: 'ARS', total: 250 }], error: null }) };
        data.Supplies = { listOrdersForStudio: track('orders', { data: [{ id: 'po-1', status: 'delivered', total: 10, currency: 'ARS' }], error: null }) };
    } else {
        data.StudioContracts = { listForStudio: track('contracts', { data: [], error: null, unavailable: true }) };
        data.StudioFinance = { monthlyByCategory: track('finance', missing) };
        // Supplies sin cargar: el método no existe.
    }
    return { data, calls };
}

test('mount pinta el esqueleto y show carga todas las fuentes con los filtros del contrato', async () => {
    const { data, calls } = repos({ withMigrations: true });
    const { registered, api } = loadHome({ data });
    const root = fakeRoot();
    const navigations = [];
    const ctx = { studioId: 'st', data, kit, navigate: (tab, params) => navigations.push(params === undefined ? [tab] : [tab, params]) };
    registered.inicio.mount(root, ctx);
    assert.match(root.innerHTML, /Buscando pendientes…/);
    assert.match(root.innerHTML, /data-home-refresh/);
    await registered.inicio.show(root, ctx);

    const byName = JSON.parse(JSON.stringify(Object.fromEntries(calls.map(c => [c[0], c.slice(1)]))));
    assert.deepEqual(byName.contracts, ['st', { status: ['draft', 'sent', 'signed', 'expired'] }]);
    assert.deepEqual(byName.orders, ['st', { status: ['confirmed', 'shipped', 'delivered'] }]);
    const month = kit.periodRange('this_month');
    assert.deepEqual(byName.metrics, ['st', month.from, month.to]);
    assert.deepEqual(byName.finance, ['st', month.from, month.to]);
    const [fromIso, toIso] = byName.bookings.slice(1);
    assert.equal(new Date(toIso) - new Date(fromIso) >= 47 * 3600000, true, 'cubre hoy y mañana');
    assert.equal(new Date(fromIso).getHours(), 0);
    assert.deepEqual(byName.applications, ['sp']);

    const html = root.innerHTML;
    for (const id of ['solicitudes', 'contratos', 'agenda', 'stock', 'reposicion', 'spots']) {
        assert.match(html, new RegExp('data-home-card="' + id + '"'), id);
    }
    assert.ok(!html.includes('<b>verano</b>'), 'el título del spot va escapado');
    assert.match(html, /Tatuajes/);
    assert.match(html, /Gastos/);
    assert.match(html, /data-nav="finanzas"/);
    assert.match(html, /data-nav="analytics"/);
    assert.equal(root.attrs['aria-busy'], undefined, 'termina sin aria-busy');

    // Card con un solo pedido: navega con {order}.
    assert.equal(clickOn(root, { 'data-nav': 'reposicion', 'data-home-card': 'reposicion' }), true);
    assert.equal(clickOn(root, { 'data-nav': 'solicitudes', 'data-home-card': 'solicitudes' }), true);
    assert.equal(clickOn(root, { 'data-nav': 'finanzas' }), true);
    assert.deepEqual(JSON.parse(JSON.stringify(navigations)), [['reposicion', { order: 'po-1' }], ['solicitudes'], ['finanzas']]);
    // Ctrl-click: deja que el navegador abra el hash en otra pestaña.
    assert.equal(clickOn(root, { 'data-nav': 'agenda', 'data-home-card': 'agenda' }, { ctrlKey: true }), false);
    // Pestañas inválidas no navegan.
    assert.equal(clickOn(root, { 'data-nav': 'javascript:alert(1)' }), false);
    assert.equal(navigations.length, 3);
    assert.equal(api.state.loading, null);
});

test('sin migraciones aplicadas se ocultan las tarjetas y KPIs de esas fuentes', async () => {
    const { data } = repos({ withMigrations: false });
    const { registered } = loadHome({ data });
    const root = fakeRoot();
    const ctx = { studioId: 'st', data, kit, navigate() {} };
    registered.inicio.mount(root, ctx);
    await registered.inicio.show(root, ctx);
    const html = root.innerHTML;
    for (const id of ['solicitudes', 'contratos', 'reposicion']) {
        assert.doesNotMatch(html, new RegExp('data-home-card="' + id + '"'), id + ' debería ocultarse');
    }
    for (const id of ['agenda', 'stock', 'spots']) {
        assert.match(html, new RegExp('data-home-card="' + id + '"'), id + ' sigue visible');
    }
    assert.match(html, /Tatuajes/);
    assert.doesNotMatch(html, /Gastos/);
    assert.doesNotMatch(html, /No pudimos cargar/);
});

test('show no rechaza aunque los repos lancen y reutiliza la carga en vuelo', async () => {
    let resolveSpots;
    const data = { StudioSpots: { listByStudio: () => new Promise(resolve => { resolveSpots = resolve; }) },
        StudioOps: { listInventoryItems: () => { throw new Error('boom'); } } };
    const { registered } = loadHome({ data });
    const root = fakeRoot();
    const ctx = { studioId: 'st', data, kit, navigate() {} };
    registered.inicio.mount(root, ctx);
    const first = registered.inicio.show(root, ctx);
    const second = registered.inicio.show(root, ctx);
    assert.equal(first, second);
    assert.equal(root.attrs['aria-busy'], 'true');
    await tick();
    resolveSpots({ data: [], error: null });
    await first;
    assert.match(root.innerHTML, /data-home-card="stock"/);
    assert.match(root.innerHTML, /No pudimos cargar este dato\./);
    assert.match(root.innerHTML, /Algunos datos no se pudieron cargar\./);
});

test('el módulo solo usa los repos de WeotziData (sin CRUD ad-hoc)', () => {
    assert.doesNotMatch(source, /\.from\(\s*['"]/);
    assert.doesNotMatch(source, /fetch\(/);
    assert.doesNotMatch(source, /_supabase|\/rest\/v1/);
    assert.match(source, /\}\)\(\);\s*$/);
});
