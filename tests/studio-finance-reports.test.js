// Finanzas (studio-dashboard-finance.js) y Reportes (studio-dashboard-reports.js)
// del panel de estudio (W-FIN): funciones puras, persistencia del comprobante,
// anulación, montaje sobre un root falso y la integración opcional con Store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const KIT = read('public/shared/js/studio-admin-kit.js');
const FINANCE = read('public/shared/js/studio-dashboard-finance.js');
const REPORTS = read('public/shared/js/studio-dashboard-reports.js');
const CSS = read('public/shared/css/studio-finance.css');
const plain = s => String(s).replace(/[  ]/g, ' ');
// Los objetos de la VM tienen otros prototipos: se comparan como JSON.
const j = v => JSON.parse(JSON.stringify(v));

// Corre el kit y un módulo en la misma VM; devuelve la API del módulo, el kit
// y lo que se registró en WeOtziStudioAdmin.
function load(source, { data = {}, extra = {} } = {}) {
    const registered = [];
    const window = Object.assign({
        WeotziData: data,
        WeOtziStudioAdmin: { register(tab, def) { registered.push({ tab, def }); return true; } },
        location: { pathname: '/studio/dashboard' }
    }, extra);
    const context = { window, console, Date, Intl, URL, Promise, Map, Set, WeakMap, JSON, setTimeout, clearTimeout, module: { exports: {} } };
    vm.createContext(context);
    vm.runInContext(KIT, context);
    context.module = { exports: {} };
    vm.runInContext(source, context);
    return { api: context.module.exports, kit: window.WeOtziStudioKit, window, registered };
}

// Root falso: guarda innerHTML, entrega elementos estables por selector y
// registra listeners (sin parsear HTML).
function fakeRoot() {
    const nodes = new Map();
    const listeners = {};
    const buttons = [{ disabled: false }, { disabled: false }];
    const el = () => ({ innerHTML: '', textContent: '', value: '', checked: false, hidden: false, attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
    return {
        innerHTML: '',
        listeners,
        buttons,
        nodes,
        addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
        contains() { return true; },
        querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, el()); return nodes.get(sel); },
        querySelectorAll(sel) { return /data-action/.test(sel) ? buttons : []; }
    };
}

function fakeButton(attrs) {
    return { disabled: false, getAttribute: name => (name in attrs ? attrs[name] : null), closest() { return this; } };
}

const ROWS = [
    { id: 'e1', studio_id: 's1', entry_type: 'income', category: 'chair_rent', description: 'Alquiler de puesto Ana', amount: 50000, currency: 'ARS', occurred_on: '2026-10-05', status: 'recorded' },
    { id: 'e2', studio_id: 's1', entry_type: 'expense', category: 'rent', description: 'Alquiler del local', amount: 30000, currency: 'ARS', occurred_on: '2026-10-01', status: 'recorded', receipt_storage_path: 's1/finance/a.pdf' },
    { id: 'e3', studio_id: 's1', entry_type: 'expense', category: 'software', description: 'Licencia', amount: 20, currency: 'USD', occurred_on: '2026-10-02', status: 'recorded' },
    { id: 'e4', studio_id: 's1', entry_type: 'expense', category: 'rent', description: 'Duplicado', amount: 30000, currency: 'ARS', occurred_on: '2026-10-01', status: 'voided', void_reason: 'Cargado dos veces' },
    { id: 'e5', studio_id: 's1', entry_type: 'expense', category: 'inventory_purchase', description: 'Pedido Tintas Sur', amount: 12000, currency: 'ARS', occurred_on: '2026-10-10', status: 'recorded', supply_order_id: 'o1', supplier_id: 'sup1' }
];

// =================================================================
// Finanzas
// =================================================================
test('finanzas se registra en la pestaña finanzas con mount y show', () => {
    const { registered } = load(FINANCE);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].tab, 'finanzas');
    assert.equal(typeof registered[0].def.mount, 'function');
    assert.equal(typeof registered[0].def.show, 'function');
});

test('los filtros arman el período y descartan una categoría de otro tipo', () => {
    const { api } = load(FINANCE);
    const now = new Date(2026, 9, 30, 12);
    const base = api.filterQuery(api.defaultFilters(), now);
    assert.deepEqual([base.range.from, base.range.to], ['2026-10-01', '2026-10-31']);
    assert.deepEqual(j(base.options), { from: '2026-10-01', to: '2026-10-31', type: null, category: null, includeVoided: false });

    const mixed = api.filterQuery({ ...api.defaultFilters(), type: 'expense', category: 'merch_manual', includeVoided: true }, now);
    assert.equal(mixed.options.type, 'expense');
    assert.equal(mixed.options.category, null, 'merch_manual es de ingreso');
    assert.equal(mixed.options.includeVoided, true);

    const custom = api.filterQuery({ ...api.defaultFilters(), preset: 'custom', from: '2026-09-15', to: '2026-10-20', category: 'rent' }, now);
    assert.deepEqual([custom.options.from, custom.options.to, custom.options.category], ['2026-09-15', '2026-10-20', 'rent']);
});

test('los totales van por moneda y los anulados no suman', () => {
    const { api } = load(FINANCE);
    const s = api.summarize(ROWS);
    assert.deepEqual({ ...s.income }, { ARS: 50000 });
    assert.deepEqual({ ...s.expense }, { ARS: 42000, USD: 20 });
    assert.deepEqual({ ...s.result }, { ARS: 8000, USD: -20 });
    assert.equal(s.count, 4);
    assert.equal(s.voided, 1);
    assert.equal(api.totalsTone(s.result), 'danger');
});

test('la búsqueda ignora mayúsculas y acentos', () => {
    const { api } = load(FINANCE);
    assert.equal(api.matchesSearch({ description: 'Licencia de diseño' }, 'DISENO'), true);
    assert.equal(api.matchesSearch({ description: 'Alquiler', studio_suppliers: { name: 'Tintas Sur' } }, 'tintas alq'), true);
    assert.equal(api.matchesSearch({ description: 'Alquiler' }, 'luz'), false);
});

test('el formulario valida tipo, categoría, importe, moneda, descripción y fecha', () => {
    const { api } = load(FINANCE);
    const ok = api.buildEntryPayload({
        entry_type: 'expense', category: 'artist_payout', description: '  Stipend   octubre ', amount: '1.234,56', currency: 'ars',
        occurred_on: '2026-10-30', payment_method: 'transfer', counterparty: '', supplier_id: '', location_id: 'loc1', membership_id: 'm1'
    }, { members: [{ id: 'm1', artists_db: { user_id: 'artist-1', name: 'Ana' } }] });
    assert.equal(ok.valid, true);
    assert.deepEqual({ ...ok.payload }, {
        entry_type: 'expense', category: 'artist_payout', amount: 1234.56, currency: 'ARS', supplier_id: null,
        description: 'Stipend octubre', occurred_on: '2026-10-30', payment_method: 'transfer', counterparty: null,
        location_id: 'loc1', membership_id: 'm1', artist_user_id: 'artist-1'
    });

    const bad = api.buildEntryPayload({ entry_type: 'income', category: 'rent', amount: 0, currency: 'pesos', description: 'x'.repeat(301), occurred_on: '2026-02-30', payment_method: 'crypto' });
    assert.equal(bad.valid, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'category', 'currency', 'description', 'occurred_on']);
    assert.equal(bad.payload.payment_method, null);
    assert.equal(api.buildEntryPayload({ entry_type: 'expense', category: 'rent', amount: 1e11, currency: 'ARS', description: 'a', occurred_on: '2026-10-01' }).errors.amount, 'El importe es demasiado alto.');
});

test('un gasto de reposición no manda los campos fijos', () => {
    const { api } = load(FINANCE);
    const built = api.buildEntryPayload({ description: 'Pedido P-2026-00001', occurred_on: '2026-10-10', membership_id: '' }, { locked: true });
    assert.equal(built.valid, true);
    for (const key of api.LOCKED_FIELDS) assert.ok(!(key in built.payload), key + ' no se envía');
    assert.equal(built.payload.artist_user_id, null);
});

test('el comprobante solo acepta PDF o imágenes de hasta 10 MB', () => {
    const { api } = load(FINANCE);
    assert.equal(api.validateReceiptFile({ type: 'application/pdf', size: 1000 }), null);
    assert.equal(api.validateReceiptFile({ type: 'image/webp', size: api.RECEIPT_MAX_BYTES }), null);
    assert.equal(api.validateReceiptFile({ type: 'image/svg+xml', size: 10 }), api.COPY.receiptType);
    assert.equal(api.validateReceiptFile({ type: 'image/png', size: api.RECEIPT_MAX_BYTES + 1 }), api.COPY.receiptSize);
    assert.equal(api.validateReceiptFile(null), null);
});

function storageClient(log, { removeError = null, signedUrl = 'https://x.supabase.co/storage/v1/object/sign/studio-documents/s1/finance/a.pdf?token=t' } = {}) {
    return {
        storage: {
            from(bucket) {
                log.push(['bucket', bucket]);
                return {
                    remove: async paths => { log.push(['remove', ...paths]); return { error: removeError }; },
                    createSignedUrl: async (p, ttl) => { log.push(['sign', p, ttl]); return { data: { signedUrl }, error: null }; }
                };
            }
        }
    };
}

test('el alta sube el comprobante a studio-documents/<estudio>/finance y guarda result.path', async () => {
    const log = [];
    const saved = [];
    const { api } = load(FINANCE, {
        data: { StudioFinance: { saveEntry: async obj => { saved.push(obj); return { data: { id: 'new', ...obj }, error: null }; } } },
        extra: { WeOtziUploader: { uploadFile: async opts => { log.push(['upload', opts.bucket, opts.pathPrefix, opts.supabase === client]); return { path: 's1/finance/1-abc-ticket.pdf' }; } } }
    });
    const client = storageClient(log);
    const row = await api.persistEntry({ studioId: 's1', client }, null, { description: 'Luz', amount: 10 }, { file: { name: 'ticket.pdf', type: 'application/pdf', size: 10 } });
    assert.deepEqual(log[0], ['upload', 'studio-documents', 's1/finance', true]);
    assert.equal(saved[0].studio_id, 's1');
    assert.equal(saved[0].receipt_storage_path, 's1/finance/1-abc-ticket.pdf');
    assert.ok(!('id' in saved[0]));
    assert.equal(row.id, 'new');
    assert.ok(!log.some(entry => entry[0] === 'remove'), 'un guardado exitoso no borra nada');
});

test('si el insert falla se borra el objeto recién subido', async () => {
    const log = [];
    const { api } = load(FINANCE, {
        data: { StudioFinance: { saveEntry: async () => ({ data: null, error: { code: '23514', message: 'La sede no pertenece a este estudio' } }) } },
        extra: { WeOtziUploader: { uploadFile: async () => ({ path: 's1/finance/2-x.pdf' }) } }
    });
    await assert.rejects(
        api.persistEntry({ studioId: 's1', client: storageClient(log) }, null, { description: 'x' }, { file: { type: 'application/pdf', size: 1 } }),
        err => err.message === 'La sede no pertenece a este estudio' && err.code === '23514'
    );
    assert.deepEqual(log.filter(e => e[0] === 'remove'), [['remove', 's1/finance/2-x.pdf']]);

    const log2 = [];
    const failing = load(FINANCE, {
        data: { StudioFinance: { saveEntry: async () => ({ data: null, error: { message: 'Sin permiso' } }) } },
        extra: { WeOtziUploader: { uploadFile: async () => ({ path: 's1/finance/3-x.pdf' }) } }
    }).api;
    await assert.rejects(
        failing.persistEntry({ studioId: 's1', client: storageClient(log2, { removeError: { message: 'denied' } }) }, null, {}, { file: { type: 'application/pdf', size: 1 } }),
        err => err.message.startsWith('Sin permiso') && err.message.includes(failing.COPY.cleanupFailed)
    );
});

test('un upload rechazado por las policies no guarda el movimiento', async () => {
    let saves = 0;
    const { api } = load(FINANCE, {
        data: { StudioFinance: { saveEntry: async () => { saves++; return { data: {}, error: null }; } } },
        extra: { WeOtziUploader: { uploadFile: async () => { throw Object.assign(new Error('new row violates row-level security policy'), { statusCode: '403' }); } } }
    });
    await assert.rejects(api.persistEntry({ studioId: 's1', client: storageClient([]) }, null, {}, { file: { type: 'image/png', size: 1 } }), { message: api.COPY.uploadForbidden });
    assert.equal(saves, 0);
});

test('al editar: reemplazar o quitar el comprobante borra el anterior y un gasto de reposición conserva sus campos', async () => {
    const log = [];
    const saved = [];
    const { api } = load(FINANCE, {
        data: { StudioFinance: { saveEntry: async obj => { saved.push(obj); return { data: { ...obj }, error: null }; } } },
        extra: { WeOtziUploader: { uploadFile: async () => ({ path: 's1/finance/new.pdf' }) } }
    });
    const ctx = { studioId: 's1', client: storageClient(log) };
    await api.persistEntry(ctx, ROWS[1], { description: 'Alquiler', amount: 31000 }, { file: { type: 'application/pdf', size: 1 } });
    assert.equal(saved[0].id, 'e2');
    assert.ok(!('studio_id' in saved[0]), 'studio_id solo al crear');
    assert.deepEqual(log.filter(e => e[0] === 'remove'), [['remove', 's1/finance/a.pdf']]);

    log.length = 0;
    await api.persistEntry(ctx, ROWS[1], { description: 'Alquiler' }, { removeReceipt: true });
    assert.equal(saved[1].receipt_storage_path, null);
    assert.deepEqual(log.filter(e => e[0] === 'remove'), [['remove', 's1/finance/a.pdf']]);

    log.length = 0;
    await api.persistEntry(ctx, ROWS[4], { description: 'Pedido', amount: 1, currency: 'USD', entry_type: 'income', category: 'other_income', supplier_id: null });
    for (const key of api.LOCKED_FIELDS) assert.ok(!(key in saved[2]), key + ' queda fijo');
    assert.equal(log.length, 0, 'sin comprobante nuevo no se toca storage');
});

test('anular exige motivo y avisa si ya estaba anulado', async () => {
    const calls = [];
    let next = { data: { id: 'e1', status: 'voided' }, error: null };
    const { api } = load(FINANCE, { data: { StudioFinance: { voidEntry: async (id, reason) => { calls.push([id, reason]); return next; } } } });
    await assert.rejects(api.voidEntry('e1', '   '), /motivo/);
    assert.equal(calls.length, 0);
    const row = await api.voidEntry('e1', '  Cargado   dos veces ');
    assert.deepEqual(calls[0], ['e1', 'Cargado dos veces']);
    assert.equal(row.status, 'voided');
    next = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    await assert.rejects(api.voidEntry('e1', 'otra vez'), { message: api.COPY.alreadyVoided });
});

test('el comprobante se abre con un enlace temporal y nunca con una URL insegura', async () => {
    const log = [];
    const win = { closed: false, location: null, opener: 'x', close() { this.closed = true; } };
    const { api } = load(FINANCE, { extra: { open: () => win } });
    const url = await api.openReceipt({ client: storageClient(log) }, 's1/finance/a.pdf');
    assert.deepEqual(log, [['bucket', 'studio-documents'], ['sign', 's1/finance/a.pdf', 300]]);
    assert.equal(win.location, url);
    assert.equal(win.opener, null);

    const evil = { closed: false, close() { this.closed = true; } };
    const unsafe = load(FINANCE, { extra: { open: () => evil } }).api;
    await assert.rejects(unsafe.openReceipt({ client: storageClient([], { signedUrl: 'javascript:alert(1)' }) }, 's1/finance/a.pdf'), { message: unsafe.COPY.receiptUnavailable });
    assert.equal(evil.closed, true);
});

test('el libro escapa los datos, tacha los anulados y enlaza el pedido de reposición', () => {
    const { api } = load(FINANCE);
    const state = { orders: new Map([['o1', 'P-2026-00007']]), artistNames: new Map() };
    const rows = ROWS.concat([{ id: 'x"><img src=x onerror=alert(1)>', entry_type: 'income', category: 'other_income', description: '<script>alert(1)</script>', amount: 5, currency: 'USD', occurred_on: '2026-10-03', status: 'recorded', counterparty: '<b>yo</b>' }]);
    const html = plain(api.ledgerTableHtml(rows, state));
    assert.ok(!html.includes('<script>alert(1)</script>') && !html.includes('<b>yo</b>') && !html.includes('<img src=x'));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /class="sfin-row--voided"/);
    assert.match(html, /Anulado: Cargado dos veces/);
    assert.match(html, /data-action="order" data-id="e5"[^>]*>Pedido P-2026-00007</);
    assert.match(html, /data-action="receipt" data-id="e2"/);
    // Un anulado no se edita ni se vuelve a anular.
    assert.ok(!/data-action="(edit|void)" data-id="e4"/.test(html));
    assert.match(html, /\+\$ 50\.000/);
    assert.match(html, /-\$ 30\.000/);
});

test('el detalle no repite el proveedor cuando ya es la contraparte', () => {
    const { api } = load(FINANCE);
    const same = api.detailHtml({ description: 'Pedido', counterparty: 'Tintas Sur', studio_suppliers: { name: 'tintas sur' } }, {});
    assert.ok(!same.includes('Proveedor:'));
    const other = api.detailHtml({ description: 'Pedido', counterparty: 'Juan', studio_suppliers: { name: 'Tintas Sur' }, studio_locations: { label: 'Palermo' } }, {});
    assert.match(other, /Juan · Proveedor: Tintas Sur · Sede: Palermo/);
});

test('el botón del pedido navega a Reposición con el id del pedido', () => {
    const { api } = load(FINANCE);
    const navigations = [];
    const state = { root: { contains: () => true }, rows: ROWS, ctx: { navigate: (tab, params) => navigations.push([tab, params]) } };
    api.onClick(state, { target: fakeButton({ 'data-action': 'order', 'data-id': 'e5' }) });
    assert.deepEqual(JSON.parse(JSON.stringify(navigations)), [['reposicion', { order: 'o1' }]]);
});

test('los parámetros de navigate preseleccionan tipo, categoría y período', () => {
    const { api } = load(FINANCE);
    const state = { filters: api.defaultFilters() };
    assert.equal(api.applyParams(state, { categoria: 'rent', desde: '2026-05-01', hasta: '2026-10-31' }), true);
    assert.deepEqual({ ...state.filters }, { preset: 'custom', from: '2026-05-01', to: '2026-10-31', type: 'expense', category: 'rent', search: '', includeVoided: false });
    assert.equal(api.applyParams(state, {}), false);
    assert.deepEqual({ ...api.presetFromParam('merch_manual') }, { type: 'income', category: 'merch_manual' });
    assert.deepEqual({ ...api.presetFromParam('gasto') }, { type: 'expense' });
});

test('mount + show cargan el libro del estudio con los filtros y pintan totales y tabla', async () => {
    const calls = [];
    const { api, registered } = load(FINANCE, {
        data: { StudioFinance: { listEntries: async (studioId, opts) => { calls.push([studioId, opts]); return { data: ROWS, error: null }; } } }
    });
    const root = fakeRoot();
    const def = registered[0].def;
    def.mount(root, { studioId: 's1', studio: { id: 's1' } });
    assert.match(root.innerHTML, /data-region="filters"/);
    assert.match(root.innerHTML, /data-action="new"/);
    assert.ok(root.listeners.click && root.listeners.change && root.listeners.input);
    await def.show(root, { studioId: 's1' }, {});
    assert.equal(calls[0][0], 's1');
    assert.equal(calls[0][1].includeVoided, false);
    const summary = plain(root.querySelector('[data-region="summary"]').innerHTML);
    assert.match(summary, /Ingresos/);
    assert.match(summary, /\$ 8\.000/, 'resultado ARS');
    assert.match(root.querySelector('[data-region="ledger"]').innerHTML, /sfin-ledger/);
    assert.ok(root.buttons.every(b => b.disabled === false));
    assert.equal(typeof api.show, 'function');
});

test('sin la migración M4 la pestaña avisa y deshabilita la carga', async () => {
    const { registered, kit } = load(FINANCE, {
        data: { StudioFinance: { listEntries: async () => ({ data: [], error: null, unavailable: true }) } }
    });
    const root = fakeRoot();
    registered[0].def.mount(root, { studioId: 's1' });
    await registered[0].def.show(root, { studioId: 's1' }, {});
    assert.ok(root.querySelector('[data-region="ledger"]').innerHTML.includes(kit.escapeHtml(kit.MISSING_SCHEMA_MESSAGE)));
    assert.equal(root.querySelector('[data-region="summary"]').innerHTML, '');
    assert.ok(root.buttons.every(b => b.disabled === true));

    const missingRepo = load(FINANCE, { data: {} });
    const root2 = fakeRoot();
    missingRepo.registered[0].def.mount(root2, { studioId: 's1' });
    await missingRepo.registered[0].def.show(root2, { studioId: 's1' }, {});
    assert.match(root2.querySelector('[data-region="ledger"]').innerHTML, /Finanzas todavía no está disponible/);
});

test('un error real del libro se muestra con reintento, sin totales engañosos', async () => {
    const { registered } = load(FINANCE, {
        data: { StudioFinance: { listEntries: async () => ({ data: null, error: { code: '42501', message: 'No tenés acceso a este estudio' } }) } }
    });
    const root = fakeRoot();
    registered[0].def.mount(root, { studioId: 's1' });
    await registered[0].def.show(root, { studioId: 's1' }, {});
    const ledger = root.querySelector('[data-region="ledger"]').innerHTML;
    assert.match(ledger, /No tenés acceso a este estudio/);
    assert.match(ledger, /data-action="retry"/);
    assert.equal(root.querySelector('[data-region="summary"]').innerHTML, '');
});

test('el CSV del libro firma los gastos en negativo y usa etiquetas en español', () => {
    const { api, kit } = load(FINANCE);
    const csv = kit.toCsv(api.csvColumns({ orders: new Map([['o1', 'P-2026-00007']]) }), ROWS.slice(1, 2).concat(ROWS[4]));
    const lines = csv.trim().split('\r\n');
    assert.match(lines[0], /^Fecha;Tipo;Categoría;Descripción/);
    assert.match(lines[1], /^2026-10-01;Gasto;Alquiler;Alquiler del local;;;;;ARS;-30000;Registrado;;;Sí$/);
    assert.match(lines[2], /Compra de inventario.*;-12000;Registrado;;P-2026-00007;No$/);
});

test('el formulario escapa los valores guardados y avisa sobre los pagos a artistas', () => {
    const { api } = load(FINANCE);
    const html = plain(api.entryFormHtml({ rows: [], ctx: { studio: {} } }, {
        id: 'e9', entry_type: 'expense', category: 'artist_payout', description: '"><script>x</script>', amount: '1500.50', currency: 'USD',
        occurred_on: '2026-10-30', counterparty: 'A & B', membership_id: 'gone', receipt_storage_path: 's1/finance/r.pdf'
    }, {}, { suppliers: [], locations: [], members: [] }));
    assert.ok(!html.includes('<script>x</script>'));
    assert.match(html, /value="&quot;&gt;&lt;script&gt;/);
    assert.match(html, /value="1500\.5"/);
    assert.match(html, /<option value="USD" selected>/);
    assert.match(html, /data-hint="payout">/, 'la ayuda de artist_payout se ve');
    assert.match(html, /<option value="gone" selected>Artista anterior<\/option>/);
    assert.match(html, /name="remove_receipt"/);
    const locked = plain(api.entryFormHtml({ rows: [] }, ROWS[4], {}, null));
    assert.match(locked, /sfin-note/);
    assert.match(locked, /name="amount"[^>]*disabled/);
    assert.match(locked, /name="supplier_id" disabled/);
});

// =================================================================
// Reportes
// =================================================================
const NOW = new Date(2026, 9, 30, 12);

function sources(overrides = {}) {
    return Object.assign({
        metrics: { status: 'ok', rows: [
            { month: '2026-09-01', currency: 'ARS', jobs_count: 4, gross_amount: 400000, studio_net: 120000 },
            { month: '2026-10-01', currency: 'ARS', jobs_count: 2, gross_amount: 200000, studio_net: 60000 },
            { month: '2026-10-01', currency: 'USD', jobs_count: 1, gross_amount: 300, studio_net: 90 }
        ] },
        finance: { status: 'ok', rows: [
            { month: '2026-10-01', currency: 'ARS', entry_type: 'income', category: 'merch_manual', total: 15000, entries: 3 },
            { month: '2026-10-01', currency: 'ARS', entry_type: 'income', category: 'chair_rent', total: 50000, entries: 1 },
            { month: '2026-09-01', currency: 'ARS', entry_type: 'expense', category: 'rent', total: 100000, entries: 1 },
            { month: '2026-10-01', currency: 'ARS', entry_type: 'expense', category: 'rent', total: 100000, entries: 1 },
            { month: '2026-10-01', currency: 'ARS', entry_type: 'expense', category: 'inventory_purchase', total: 50000, entries: 2 },
            { month: '2026-10-01', currency: 'USD', entry_type: 'expense', category: 'software', total: 20, entries: 1 }
        ] },
        artists: { status: 'ok', rows: [{ artist_user_id: 'a1', name: 'Ana <b>', currency: 'ARS', jobs_count: 6, gross_billed: 600000, avg_ticket: 100000, supplies_consumed_cost: 5000, days_since_last_job: 2 }] },
        materials: { status: 'ok', rows: [
            { month: '2026-09-01', artist_user_id: 'a1', currency: 'ARS', quantity: 10, cost: 3000 },
            { month: '2026-10-01', artist_user_id: 'a1', currency: 'ARS', quantity: -2, cost: -600 },
            { month: '2026-10-01', artist_user_id: 'a2', currency: 'ARS', quantity: 4, cost: 1200 }
        ] },
        orders: { status: 'ok', rows: [
            { id: 'o1', vendor_id: 'v1', status: 'received', currency: 'ARS', total: 50000, submitted_at: '2026-07-20T12:00:00Z', received_at: '2026-10-03T15:00:00Z', supply_vendors: { id: 'v1', name: 'Tintas <Sur>' } },
            { id: 'o2', vendor_id: 'v1', status: 'confirmed', currency: 'ARS', total: 20000, submitted_at: '2026-10-20T12:00:00Z', supply_vendors: { id: 'v1', name: 'Tintas <Sur>' } },
            { id: 'o3', vendor_id: 'v1', status: 'cancelled', currency: 'ARS', total: 99999, submitted_at: '2026-10-21T12:00:00Z', supply_vendors: { id: 'v1', name: 'Tintas <Sur>' } },
            { id: 'o4', vendor_id: 'v2', status: 'submitted', currency: 'USD', total: 80, submitted_at: '2025-01-01T12:00:00Z', supply_vendors: { id: 'v2', name: 'Agujas' } }
        ] },
        roster: { status: 'ok', rows: [{ id: 'm2', artists_db: { user_id: 'a2', name: 'Bruno' } }] },
        merch: { source: 'manual', rows: [] }
    }, overrides);
}

test('reportes se registra en la pestaña analytics', () => {
    const { registered } = load(REPORTS);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].tab, 'analytics');
});

test('el período del reporte siempre cubre meses completos', () => {
    const { api } = load(REPORTS);
    const r = api.reportRange('custom', { from: '2026-03', to: '2026-02' }, NOW);
    assert.deepEqual([r.from, r.to, r.fromMonth], ['2026-02-01', '2026-03-31', '2026-02-01']);
    assert.deepEqual(j(r.months), ['2026-02', '2026-03']);
    assert.equal(api.lastDayOfMonth('2028-02'), '2028-02-29');
    const onlyFrom = api.reportRange('custom', { from: '2026-08' }, NOW);
    assert.deepEqual([onlyFrom.from, onlyFrom.to], ['2026-08-01', '2026-10-31']);
    const preset = api.reportRange('last_6_months', null, NOW);
    assert.deepEqual([preset.from, preset.to, preset.months.length], ['2026-05-01', '2026-10-31', 6]);
    assert.equal(api.reportRange('nope', null, NOW).preset, api.DEFAULT_PRESET);
});

test('resultado = ingreso por tatuajes + merch + otros ingresos − gastos, por moneda', () => {
    const { api } = load(REPORTS);
    const range = api.reportRange('last_6_months', null, NOW);
    const r = api.buildReport(sources(), range);
    assert.equal(r.jobs, 7);
    assert.deepEqual({ ...r.tattooGross }, { ARS: 600000, USD: 300 });
    assert.deepEqual({ ...r.tattooNet }, { ARS: 180000, USD: 90 });
    assert.deepEqual({ ...r.merch }, { ARS: 15000 });
    assert.equal(r.merchUnits, null, 'sin Tienda no hay unidades');
    assert.deepEqual({ ...r.otherIncome }, { ARS: 50000 });
    assert.deepEqual({ ...r.expenses }, { ARS: 250000, USD: 20 });
    assert.deepEqual({ ...r.result }, { ARS: -5000, USD: 70 });

    const oct = r.monthlyRows.find(m => m.month === '2026-10' && m.currency === 'ARS');
    assert.deepEqual({ ...oct }, { month: '2026-10', currency: 'ARS', jobs: 2, gross: 200000, tattooNet: 60000, merch: 15000, otherIncome: 50000, expenses: 150000, result: -25000 });
    assert.deepEqual(j(r.monthlyRows.map(m => m.month + ' ' + m.currency)), ['2026-09 ARS', '2026-10 ARS', '2026-10 USD']);

    const rent = r.categoryRows.find(c => c.category === 'rent');
    assert.deepEqual({ ...rent }, { category: 'rent', currency: 'ARS', total: 200000, entries: 2, share: 80 });
    assert.equal(r.categoryRows.find(c => c.currency === 'USD').share, 100);
});

test('con la Tienda el merch suma sus ventas y muestra unidades', () => {
    const { api } = load(REPORTS);
    const range = api.reportRange('this_month', null, NOW);
    const r = api.buildReport(sources({ merch: { source: 'store', rows: [
        { month: '2026-10-01', currency: 'ARS', units: 5, gross_amount: 25000 },
        { month: '2026-10-01', currency: 'USD', units: 1, gross_amount: 15 }
    ] } }), range);
    assert.deepEqual({ ...r.merch }, { ARS: 40000, USD: 15 }, 'Tienda + ventas manuales');
    assert.equal(r.merchUnits, 6);
    const html = plain(api.kpisHtml(r));
    assert.match(html, /6 unidades vendidas en la Tienda · incluye ventas manuales/);
    const manual = plain(api.kpisHtml(api.buildReport(sources(), range)));
    assert.match(manual, /Activá la Tienda para ver unidades/);
});

test('la integración con Store es opcional y cae a merch_manual si falla', async () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const none = load(REPORTS, { data: {} }).api;
    assert.deepEqual(j(await none.loadMerch('s1', range)), { source: 'manual', rows: [] });

    const calls = [];
    const ok = load(REPORTS, { data: { Store: { getSalesReport: async (...args) => { calls.push(args); return [{ units: 2, gross_amount: 10, currency: 'ARS', month: '2026-10-01' }]; } } } }).api;
    const res = await ok.loadMerch('s1', range);
    assert.equal(res.source, 'store');
    assert.deepEqual(calls, [['studio', 's1', '2026-10-01', '2026-10-31']]);

    const throwing = load(REPORTS, { data: { Store: { getSalesReport: async () => { throw new Error('store:forbidden'); } } } }).api;
    assert.equal((await throwing.loadMerch('s1', range)).source, 'manual');

    let asked = false;
    const off = load(REPORTS, { data: { Store: { isAvailable: async () => false, getSalesReport: async () => { asked = true; return []; } } } }).api;
    assert.equal((await off.loadMerch('s1', range)).source, 'manual');
    assert.equal(asked, false);
});

test('las fuentes sin migración degradan solas y el aviso dice qué falta', async () => {
    const calls = [];
    const data = {
        StudioOps: {
            listMonthlyMetrics: async (...a) => { calls.push(['metrics', ...a]); return { data: [], error: null }; },
            getArtistPerformance: async () => ({ data: [], error: null }),
            listMaterialAssignmentsMonthly: async () => ({ data: [], error: null, unavailable: true })
        },
        StudioFinance: { monthlyByCategory: async (...a) => { calls.push(['finance', ...a]); return { data: null, error: { code: '42P01', message: 'relation does not exist' } }; } },
        StudioMemberships: { listRoster: async () => ({ data: [], error: null }) }
    };
    const { api } = load(REPORTS, { data });
    const range = api.reportRange('this_month', null, NOW);
    const src = await api.loadSources('s1', range);
    assert.deepEqual(calls, [['metrics', 's1', '2026-10-01', '2026-10-31'], ['finance', 's1', '2026-10-01', '2026-10-31']]);
    assert.equal(src.finance.status, 'unavailable');
    assert.equal(src.materials.status, 'unavailable');
    assert.equal(src.orders.status, 'unavailable', 'sin supplies-repo');
    const report = api.buildReport(src, range);
    assert.deepEqual(j(report.missing), ['finance', 'materials', 'orders']);
    const html = plain(api.reportHtml(report, src));
    assert.match(html, /el reporte todavía no incluye gastos e ingresos de Finanzas, materiales entregados, pedidos a Supplies/);
    assert.match(html, /Resultado mensual/);
});

test('las compras a Supplies excluyen cancelados y cuentan lo recibido en el mes de recepción', () => {
    const { api } = load(REPORTS);
    const r = api.buildReport(sources(), api.reportRange('this_month', null, NOW));
    assert.equal(r.purchaseRows.length, 1);
    assert.deepEqual({ ...r.purchaseRows[0] }, { vendor_id: 'v1', vendor: 'Tintas <Sur>', currency: 'ARS', orders: 2, received: 1, open: 1, total: 70000 });
});

test('los materiales se agregan por artista con nombres del roster y se recortan al período', () => {
    const { api } = load(REPORTS);
    const all = api.buildReport(sources(), api.reportRange('last_6_months', null, NOW));
    assert.deepEqual(j(all.materialRows.map(m => [m.name, m.quantity, m.cost])), [['Ana <b>', 8, 2400], ['Bruno', 4, 1200]]);
    const oct = api.buildReport(sources(), api.reportRange('this_month', null, NOW));
    assert.deepEqual(j(oct.materialRows.map(m => [m.name, m.quantity, m.cost])), [['Bruno', 4, 1200], ['Ana <b>', -2, -600]]);
});

test('el reporte escapa nombres de artistas y proveedores e incluye la fórmula', () => {
    const { api } = load(REPORTS);
    const src = sources();
    const html = plain(api.reportHtml(api.buildReport(src, api.reportRange('last_6_months', null, NOW)), src));
    assert.ok(!html.includes('Ana <b>') && !html.includes('Tintas <Sur>'));
    assert.match(html, /Ana &lt;b&gt;/);
    assert.match(html, /Resultado = ingreso del estudio por tatuajes \+ merch \+ otros ingresos − gastos/);
    for (const kind of ['monthly', 'categories', 'artists', 'materials', 'purchases']) assert.match(html, new RegExp('data-csv="' + kind + '"'));
    assert.match(html, /class="sk-bars"/);
    assert.match(html, /data-action="finance" data-category="rent"/);
});

test('ver en Finanzas navega con la categoría y el período del reporte', () => {
    const { api } = load(REPORTS);
    const navigations = [];
    const state = { root: { contains: () => true }, range: { from: '2026-05-01', to: '2026-10-31' }, ctx: { navigate: (tab, p) => navigations.push([tab, p]) } };
    api.onClick(state, { target: fakeButton({ 'data-action': 'finance', 'data-category': 'rent' }) });
    assert.deepEqual(JSON.parse(JSON.stringify(navigations)), [['finanzas', { tipo: 'expense', categoria: 'rent', desde: '2026-05-01', hasta: '2026-10-31' }]]);
});

test('el CSV mensual exporta números crudos con etiquetas en español', () => {
    const { api, kit } = load(REPORTS);
    const report = api.buildReport(sources(), api.reportRange('last_6_months', null, NOW));
    const spec = api.csvFor('monthly', report);
    const lines = kit.toCsv(spec.columns, spec.rows).trim().split('\r\n');
    assert.equal(lines[0], 'Mes;Moneda;Tatuajes;Bruto por tatuajes;Ingreso del estudio por tatuajes;Merch;Otros ingresos;Gastos;Resultado');
    assert.equal(lines[2], 'Octubre 2026;ARS;2;200000;60000;15000;50000;150000;-25000');
    assert.equal(api.csvFor('nope', report), null);
});

test('mount + show montan el reporte en #reports-extended sin tocar el contenido histórico', async () => {
    const data = {
        StudioOps: {
            listMonthlyMetrics: async () => ({ data: sources().metrics.rows, error: null }),
            getArtistPerformance: async () => ({ data: [], error: null }),
            listMaterialAssignmentsMonthly: async () => ({ data: [], error: null })
        },
        StudioFinance: { monthlyByCategory: async () => ({ data: sources().finance.rows, error: null }) },
        Supplies: { listOrdersForStudio: async () => ({ data: [], error: null }) },
        StudioMemberships: { listRoster: async () => ({ data: [], error: null }) }
    };
    const { registered } = load(REPORTS, { data });
    const root = fakeRoot();
    registered[0].def.mount(root, { studioId: 's1' });
    assert.match(root.innerHTML, /Resultado del período/);
    assert.match(root.innerHTML, /Resumen histórico/);
    assert.ok(!/analytics-summary|analytics-monthly|analytics-artist/.test(root.innerHTML));
    await registered[0].def.show(root, { studioId: 's1' }, {});
    const report = plain(root.querySelector('[data-region="report"]').innerHTML);
    assert.match(report, /Ingreso del estudio por tatuajes/);
    assert.match(report, /sfin-report-table/);
    assert.match(root.querySelector('[data-region="period"]').textContent, /Últimos 6 meses/);
});

// =================================================================
// Markup y CSS
// =================================================================
test('la CSS del módulo usa el prefijo sfin-, respeta hidden y tiene responsive', () => {
    const selectors = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[\s,{}])\.[a-z][\w-]*/g) || [];
    const own = selectors.map(s => s.trim().replace(/^[,{}]/, '').trim()).filter(s => !/^\.(sk|studio)-/.test(s));
    assert.ok(own.length > 0);
    assert.ok(own.every(s => s.startsWith('.sfin')), 'clases propias con prefijo sfin-: ' + own.filter(s => !s.startsWith('.sfin')).join(', '));
    assert.match(CSS, /\.sfin \[hidden\][\s\S]*display: none !important/);
    assert.match(CSS, /@media \(max-width: 600px\)/);
    assert.ok(!/border-radius:\s*[1-9]/.test(CSS), 'radio 0');
});

test('los módulos solo leen datos vía WeotziData (sin CRUD ad-hoc)', () => {
    for (const source of [FINANCE, REPORTS]) {
        assert.ok(!/_supabase\.from\(|\.from\(['"](studio_|supply_)|\/rest\/v1/.test(source));
        assert.ok(source.trimEnd().endsWith('})();'));
    }
    assert.match(FINANCE, /bucket: BUCKET, pathPrefix: prefix/);
    assert.match(FINANCE, /const BUCKET = 'studio-documents'/);
});
