// Inventario y materiales por artista (W-INV): cambios en
// studio-dashboard-ops.js (sin la agenda vieja, evento de trabajos, entregas y
// devoluciones en el editor de movimientos, historial con artista y costo) y
// el módulo studio-dashboard-materials.js (#inventory-materials).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const opsSource = read('public/shared/js/studio-dashboard-ops.js');
const materialsSource = read('public/shared/js/studio-dashboard-materials.js');
const kit = require('../public/shared/js/studio-admin-kit.js');
const materials = require('../public/shared/js/studio-dashboard-materials.js');

const tick = () => new Promise(resolve => setImmediate(resolve));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

// ---------------------------------------------------------------
// Fakes de DOM mínimos
// ---------------------------------------------------------------
function fakeEl(id, extra = {}) {
    const el = {
        id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false, hidden: false,
        dataset: {}, style: {}, attrs: {}, listeners: {}, className: '',
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(type, cb) { (this.listeners[type] = this.listeners[type] || []).push(cb); },
        insertAdjacentHTML() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        remove() {}
    };
    return Object.assign(el, extra);
}

function fakeDocument() {
    const els = new Map();
    const listeners = {};
    const dispatched = [];
    return {
        els, listeners, dispatched,
        readyState: 'complete',
        getElementById(id) { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
        dispatchEvent(event) { dispatched.push(event); (listeners[event.type] || []).forEach(cb => cb(event)); return true; },
        createElement(tag) { return fakeEl(tag); }
    };
}

class FakeCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}

// StudioOps/StudioMemberships que responden {data: [], error: null} a todo
// lo no definido y registran las llamadas.
function recordingRepo(overrides = {}, calls = []) {
    return new Proxy(overrides, {
        get(target, name) {
            if (typeof name !== 'string') return undefined;
            return (...args) => {
                calls.push([name, ...args]);
                if (typeof target[name] === 'function') return target[name](...args);
                return Promise.resolve({ data: [], error: null });
            };
        }
    });
}

// ---------------------------------------------------------------
// studio-dashboard-ops.js
// ---------------------------------------------------------------
const OPS_EXPOSED = [
    'buildMovementPayload', 'movementArtistOptions', 'outstandingUnitCost', 'movementHistoryHtml',
    'movementSaveError', 'movementLabel', 'onJobsChanged', 'wireCrossModuleEvents', 'openMovementDialog'
];

function ops({ document = fakeDocument(), data = {}, window = {} } = {}) {
    const source = opsSource.replace(/\}\)\(\);\s*$/, 'globalThis.__ops = { ' + OPS_EXPOSED.join(', ') + ' }; })();');
    const context = {
        window, document, WeotziData: data, CustomEvent: FakeCustomEvent,
        setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, Date, Intl, URL, console, Promise, Map, Set
    };
    vm.runInNewContext(source, context);
    return { api: context.__ops, document, context };
}

test('ops ya no tiene la agenda vieja y sigue terminando en "})();"', () => {
    assert.doesNotMatch(opsSource, /wireBookingPanel|renderBookings|openBookingEditor/);
    assert.doesNotMatch(opsSource, /'bookings'|ops-sub-bookings|booking-(?:new|month|editor|refresh)/);
    assert.match(opsSource, /\['jobs', 'clients', 'invoices', 'documents'\]\.forEach/);
    assert.match(opsSource, /\}\)\(\);\s*$/);
});

test('al arrancar, ops escucha weotzi:studio-jobs-changed y vuelve a pintar trabajos y clientes', async () => {
    const document = fakeDocument();
    const calls = [];
    const data = {
        StudioOps: recordingRepo({}, calls),
        StudioMemberships: recordingRepo({}, calls),
        Artists: recordingRepo({}, calls)
    };
    const studio = { id: 'studio-1' };
    ops({ document, data, window: { WeOtziStudioAuth: { getCurrent: () => studio, getSupabase: () => ({}) } } });
    await flush();
    const count = name => calls.filter(call => call[0] === name).length;
    const jobsBefore = count('listJobs');
    const clientsBefore = count('listJobsForClientAggregation');
    assert.equal(jobsBefore, 1, 'pinta trabajos al cargar');
    assert.equal((document.listeners['weotzi:studio-jobs-changed'] || []).length, 1);
    document.dispatchEvent(new FakeCustomEvent('weotzi:studio-jobs-changed'));
    await flush();
    assert.equal(count('listJobs'), jobsBefore + 1);
    assert.equal(count('listJobsForClientAggregation'), clientsBefore + 1);
    assert.ok(calls.every(call => call[0] !== 'listBookings'), 'la agenda vieja no consulta citas');
});

test('un cambio de inventario de Materiales repinta el stock; uno propio de ops no', async () => {
    const document = fakeDocument();
    const calls = [];
    const data = { StudioOps: recordingRepo({}, calls), StudioMemberships: recordingRepo({}, calls) };
    const { api } = ops({ document, data });
    api.wireCrossModuleEvents({}, { id: 's' });
    document.dispatchEvent(new FakeCustomEvent('weotzi:studio-inventory-changed', { detail: { source: 'materials' } }));
    await flush();
    assert.equal(calls.filter(call => call[0] === 'listInventoryItems').length, 1);
    document.dispatchEvent(new FakeCustomEvent('weotzi:studio-inventory-changed', { detail: { source: 'ops' } }));
    await flush();
    assert.equal(calls.filter(call => call[0] === 'listInventoryItems').length, 1);
});

test('el movimiento de entrega y devolución exige artista, valida stock/saldo y conserva el costo', () => {
    const { api } = ops();
    const item = { id: 'item-1', name: 'Tinta negra', unit: 'ml', quantity_on_hand: 10, cost_per_unit: 1500, currency: 'ARS' };
    const balanceRows = [{ artist_user_id: 'a1', item_id: 'item-1', net_assigned_qty: 3, assigned_cost: 4500, unit: 'ml' }];
    const ctx = { item, studioId: 's', balanceRows, materialsReady: true };
    assert.throws(() => api.buildMovementPayload({ kind: 'assignment', quantity: '2', artist: '' }, ctx), /artista que recibe/);
    assert.throws(() => api.buildMovementPayload({ kind: 'return', quantity: '2', artist: '' }, ctx), /artista que devuelve/);
    assert.throws(() => api.buildMovementPayload({ kind: 'assignment', quantity: '11', artist: 'a1' }, ctx), /No hay stock suficiente de Tinta negra: quedan 10 ml\./);
    assert.throws(() => api.buildMovementPayload({ kind: 'return', quantity: '4', artist: 'a1' }, ctx), /supera lo entregado: quedan 3 ml por devolver/);
    assert.throws(() => api.buildMovementPayload({ kind: 'assignment', quantity: '-1', artist: 'a1' }, ctx), /cantidad positiva/);
    assert.throws(() => api.buildMovementPayload({ kind: 'assignment', quantity: '1', artist: 'a1', cost: '-5' }, ctx), /no puede ser negativo/);
    assert.throws(() => api.buildMovementPayload({ kind: 'assignment', quantity: '1', artist: 'a1' }, { ...ctx, materialsReady: false }), /falta aplicar una migración/);

    const payload = api.buildMovementPayload({ kind: 'assignment', quantity: '2,5', artist: 'a1', cost: '1500', notes: '  sesión  ' }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        item_id: 'item-1', studio_id: 's', kind: 'assignment', quantity: 2.5,
        related_artist_user_id: 'a1', unit_cost: 1500, notes: 'sesión'
    });
    const restock = api.buildMovementPayload({ kind: 'restock', quantity: '5', artist: '', cost: '' }, ctx);
    assert.equal(restock.related_artist_user_id, null);
    assert.equal(restock.unit_cost, null, 'vacío → el trigger decide');
    assert.equal(api.buildMovementPayload({ kind: 'adjustment', quantity: '-2', artist: '' }, ctx).quantity, -2);
});

test('las opciones de artista dependen del tipo y la devolución solo lista a quien tiene saldo', () => {
    const { api } = ops();
    const members = [{ artist_user_id: 'a1', artists_db: { user_id: 'a1', name: 'Ana' } }, { artist_user_id: 'a2', artists_db: { user_id: 'a2', name: '<b>Beto</b>' } }];
    const names = new Map([['a1', 'Ana'], ['a2', '<b>Beto</b>'], ['ex', 'Ex integrante']]);
    const balance = [
        { artist_user_id: 'ex', net_assigned_qty: 2, unit: 'u' },
        { artist_user_id: 'a1', net_assigned_qty: 0, unit: 'u' }
    ];
    const assignment = api.movementArtistOptions('assignment', members, balance, names, null);
    assert.match(assignment, /<option value="">Elegí a quién se lo entregás<\/option>/);
    assert.match(assignment, /value="a1"/);
    assert.ok(assignment.includes('&lt;b&gt;Beto&lt;/b&gt;') && !assignment.includes('<b>'));
    const ret = api.movementArtistOptions('return', members, balance, names, 'ex');
    assert.match(ret, /value="ex" selected/);
    assert.match(ret, /Ex integrante · tiene 2 u/);
    assert.doesNotMatch(ret, /value="a1"/);
    assert.match(api.movementArtistOptions('return', members, [], names, null), /Nadie tiene este ítem por devolver/);
    assert.match(api.movementArtistOptions('return', members, null, names, null), /Elegí quién devuelve<\/option><option value="a1"/, 'sin balance cae a los activos');
    assert.match(api.movementArtistOptions('consumption', members, balance, names, null), /— Sin asignar —/);
});

test('el historial muestra tipo en español, artista y costo; el CHECK sin M3 se traduce', () => {
    const { api } = ops();
    assert.equal(api.outstandingUnitCost({ net_assigned_qty: 3, assigned_cost: 1000 }, 7), 333.33);
    assert.equal(api.outstandingUnitCost({ net_assigned_qty: 0, assigned_cost: 0 }, 7), 7);
    const html = api.movementHistoryHtml([
        { kind: 'assignment', quantity: 2, unit_cost: 1500, related_artist_user_id: 'a1', performed_at: '2026-10-30T15:00:00Z', notes: null },
        { kind: 'return', quantity: 1, unit_cost: null, related_artist_user_id: 'zz', performed_at: '2026-10-30T16:00:00Z', notes: '<x>' }
    ], new Map([['a1', 'Ana']]), { unit: 'ml', currency: 'ARS' });
    assert.match(html, /<th>Artista<\/th><th>Costo unit\.<\/th><th>Costo total<\/th>/);
    assert.match(html, /Entrega a artista/);
    assert.match(html, /Devolución/);
    assert.match(html, /−2 ml/);
    assert.match(html, /\+1 ml/);
    assert.match(html, /Ana/);
    assert.ok(html.includes(api.movementLabel('return')));
    assert.ok(html.includes(new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(3000)), 'costo total = cantidad × costo');
    assert.ok(html.includes('&lt;x&gt;') && !html.includes('<x>'));
    assert.doesNotMatch(html, />assignment<|>return</);
    const err = api.movementSaveError({ code: '23514', message: 'new row for relation "studio_inventory_movements" violates check constraint "studio_inventory_movements_kind_check"' });
    assert.match(err.message, /falta aplicar una migración/);
    assert.equal(api.movementSaveError({ code: '23514', message: 'Stock insuficiente de Tinta' }).message, 'Stock insuficiente de Tinta');
});

test('el editor de movimientos ofrece entrega/devolución, precarga el costo y guarda con artista', async () => {
    const document = fakeDocument();
    const calls = [];
    const item = { id: 'item-1', name: 'Agujas 3RL', unit: 'u', quantity_on_hand: 20, cost_per_unit: 800, currency: 'ARS' };
    const data = {
        StudioMemberships: recordingRepo({ listActiveArtists: async () => ({ data: [{ artist_user_id: 'a1', artists_db: { user_id: 'a1', name: 'Ana' } }], error: null }) }, calls),
        StudioOps: recordingRepo({
            listMaterialBalance: async () => ({ data: [{ artist_user_id: 'a1', item_id: 'item-1', net_assigned_qty: 4, assigned_cost: 3000, unit: 'u' }], error: null }),
            listInventoryMovements: async () => ({ data: [{ kind: 'assignment', quantity: 4, unit_cost: 750, related_artist_user_id: 'a1', performed_at: '2026-10-29T10:00:00Z' }], error: null }),
            createInventoryMovement: async () => ({ data: null, error: null })
        }, calls)
    };
    const { api } = ops({ document, data });
    await api.openMovementDialog({}, { id: 's' }, 'item-1', item);
    const editor = document.getElementById('item-editor').innerHTML;
    assert.match(editor, /<option value="assignment">Entrega a artista \(salida\)<\/option>/);
    assert.match(editor, /<option value="return">Devolución de artista \(entrada\)<\/option>/);
    assert.match(editor, /id="mv-cost"[^>]*value="800"/);
    assert.match(editor, /Costo unitario \(ARS\)/);
    assert.match(document.getElementById('movement-history').innerHTML, /Ana/);

    // Cambiar a devolución con artista precarga el costo promedio (3000/4).
    document.getElementById('mv-kind').value = 'return';
    document.getElementById('mv-kind').listeners.change[0]();
    document.getElementById('mv-artist').value = 'a1';
    document.getElementById('mv-artist').listeners.change[0]();
    assert.equal(document.getElementById('mv-cost').value, '750');
    assert.equal(document.getElementById('mv-artist').attrs.required, '');

    document.getElementById('mv-kind').value = 'assignment';
    document.getElementById('mv-qty').value = '3';
    document.getElementById('mv-artist').value = 'a1';
    document.getElementById('mv-cost').value = '800';
    const button = { disabled: false, closest: () => ({ dataset: { panel: 'inventory' } }) };
    await document.getElementById('mv-save').listeners.click[0]({ currentTarget: button });
    const saved = calls.find(call => call[0] === 'createInventoryMovement')[1];
    assert.equal(saved.kind, 'assignment');
    assert.equal(saved.related_artist_user_id, 'a1');
    assert.equal(saved.unit_cost, 800);
    assert.equal(saved.quantity, 3);
    assert.equal(document.getElementById('inventory-status').textContent, 'Entrega registrada.');
    const event = document.dispatched.find(e => e.type === 'weotzi:studio-inventory-changed');
    assert.equal(event.detail.source, 'ops');
});

test('sin M3 el editor de movimientos no ofrece entrega ni devolución', async () => {
    const document = fakeDocument();
    const data = {
        StudioMemberships: recordingRepo({ listActiveArtists: async () => ({ data: [], error: null }) }),
        StudioOps: recordingRepo({ listMaterialBalance: async () => ({ data: [], error: null, unavailable: true }) })
    };
    const { api } = ops({ document, data });
    await api.openMovementDialog({}, { id: 's' }, 'item-1', { id: 'item-1', name: 'Guantes', unit: 'u', quantity_on_hand: 5, cost_per_unit: null, currency: 'USD' });
    const editor = document.getElementById('item-editor').innerHTML;
    assert.doesNotMatch(editor, /value="assignment"|value="return"/);
    assert.match(editor, /se habilitan cuando se aplique la migración/);
});

// ---------------------------------------------------------------
// studio-dashboard-materials.js · funciones puras
// ---------------------------------------------------------------
const ITEMS = [
    { id: 'i1', name: 'Tinta negra', unit: 'ml', quantity_on_hand: 100, cost_per_unit: 50, currency: 'ARS' },
    { id: 'i2', name: 'Guantes', unit: 'par', quantity_on_hand: 4, cost_per_unit: 2.5, currency: 'USD' }
];

test('la entrega multi-línea arma una fila assignment por ítem para un único insert', () => {
    const rows = materials.buildDeliveryRows({
        artistId: 'a1',
        lines: [{ itemId: 'i1', quantity: '10', cost: '' }, { itemId: '', quantity: '' }, { itemId: 'i2', quantity: '2,5', cost: '3.333' }],
        performedAt: '2026-10-30T12:00:00.000Z',
        notes: ' Kit inicial '
    }, { studioId: 's', items: ITEMS, activeArtistIds: ['a1'], now: '2026-10-30T13:00:00Z' });
    assert.equal(rows.length, 2, 'las líneas vacías se ignoran');
    assert.deepEqual(rows[0], { item_id: 'i1', studio_id: 's', kind: 'assignment', quantity: 10, related_artist_user_id: 'a1', unit_cost: null, notes: 'Kit inicial', performed_at: '2026-10-30T12:00:00.000Z' });
    assert.equal(rows[1].quantity, 2.5);
    assert.equal(rows[1].unit_cost, 3.33);
    assert.ok(rows.every(row => row.kind === 'assignment' && row.related_artist_user_id === 'a1'));
});

test('la entrega valida artista, líneas, duplicados, stock, costo y fecha', () => {
    const ctx = { studioId: 's', items: ITEMS, activeArtistIds: ['a1'], now: '2026-10-30T13:00:00Z' };
    const build = input => () => materials.buildDeliveryRows({ artistId: 'a1', ...input }, ctx);
    assert.throws(build({ artistId: '', lines: [{ itemId: 'i1', quantity: 1 }] }), /Elegí a qué artista/);
    assert.throws(build({ artistId: 'ex', lines: [{ itemId: 'i1', quantity: 1 }] }), /artistas activos/);
    assert.throws(build({ lines: [{ itemId: '', quantity: '' }] }), /al menos un ítem/);
    assert.throws(build({ lines: [{ itemId: '', quantity: '2' }] }), /Elegí el ítem de la línea 1/);
    assert.throws(build({ lines: [{ itemId: 'i9', quantity: '2' }] }), /ya no está en el inventario/);
    assert.throws(build({ lines: [{ itemId: 'i1', quantity: '0' }] }), /mayor a 0 en la línea 1/);
    assert.throws(build({ lines: [{ itemId: 'i1', quantity: '1' }, { itemId: 'i1', quantity: '2' }] }), /Repetiste Tinta negra en la línea 2/);
    assert.throws(build({ lines: [{ itemId: 'i2', quantity: '5' }] }), /No hay stock suficiente de Guantes: quedan 4 par\./);
    assert.throws(build({ lines: [{ itemId: 'i1', quantity: '1', cost: '-1' }] }), /no puede ser negativo/);
    assert.throws(build({ lines: [{ itemId: 'i1', quantity: '1' }], performedAt: '2026-11-02T10:00:00Z' }), /no puede ser futura/);
    const tooMany = Array.from({ length: materials.MAX_LINES + 1 }, (_, i) => ({ itemId: 'x' + i, quantity: 1 }));
    assert.throws(build({ lines: tooMany }), /hasta 30 ítems/);
});

test('la devolución usa el costo promedio de lo entregado y no supera el saldo', () => {
    const balanceRows = [
        { artist_user_id: 'a1', item_id: 'i1', item_name: 'Tinta negra', unit: 'ml', net_assigned_qty: 30, assigned_cost: 1000 },
        { artist_user_id: 'a1', item_id: 'i2', item_name: 'Guantes', unit: 'par', net_assigned_qty: 0, assigned_cost: 0 },
        { artist_user_id: 'a2', item_id: 'i1', item_name: 'Tinta negra', unit: 'ml', net_assigned_qty: 5, assigned_cost: 250 }
    ];
    const rows = materials.buildReturnRows({ artistId: 'a1', lines: [{ itemId: 'i1', quantity: '12' }, { itemId: 'i2', quantity: '' }] }, { studioId: 's', balanceRows });
    assert.deepEqual(rows, [{ item_id: 'i1', studio_id: 's', kind: 'return', quantity: 12, related_artist_user_id: 'a1', unit_cost: 33.33, notes: null }]);
    assert.throws(() => materials.buildReturnRows({ artistId: '', lines: [{ itemId: 'i1', quantity: 1 }] }, { balanceRows }), /qué artista devuelve/);
    assert.throws(() => materials.buildReturnRows({ artistId: 'a1', lines: [{ itemId: 'i1', quantity: '' }] }, { balanceRows }), /al menos un ítem/);
    assert.throws(() => materials.buildReturnRows({ artistId: 'a1', lines: [{ itemId: 'i1', quantity: '31' }] }, { balanceRows }), /supera lo entregado: quedan 30 ml por devolver/);
    assert.throws(() => materials.buildReturnRows({ artistId: 'a1', lines: [{ itemId: 'i2', itemName: 'Guantes', quantity: '1' }] }, { balanceRows }), /no tiene Guantes por devolver/);
    assert.throws(() => materials.buildReturnRows({ artistId: 'a1', lines: [{ itemId: 'i1', quantity: '-2' }] }, { balanceRows }), /mayor a 0/);
});

test('balance: resumen por artista, filtros y totales por moneda separados', () => {
    const rows = [
        { artist_user_id: 'b', item_id: 'i1', item_name: 'Tinta', net_assigned_qty: 2, assigned_cost: 100, currency: 'ARS', last_movement_at: '2026-10-01T10:00:00Z' },
        { artist_user_id: 'b', item_id: 'i2', item_name: 'Guantes', net_assigned_qty: 0, assigned_cost: 0, currency: 'USD', last_movement_at: '2026-10-20T10:00:00Z' },
        { artist_user_id: 'a', item_id: 'i2', item_name: 'Guantes', net_assigned_qty: 1, assigned_cost: 2.5, currency: 'USD', last_movement_at: null }
    ];
    const names = new Map([['a', 'Ana'], ['b', 'Beto']]);
    const summary = materials.summarizeByArtist(rows, names);
    assert.deepEqual(summary.map(s => [s.artist_name, s.pending_items, s.items]), [['Ana', 1, 1], ['Beto', 1, 2]]);
    assert.deepEqual(summary[1].cost, { ARS: 100 });
    assert.equal(summary[1].last_movement_at, '2026-10-20T10:00:00Z');
    assert.deepEqual(materials.filterBalance(rows, names, { pendingOnly: true }).map(r => r.artist_name + ':' + r.item_name), ['Ana:Guantes', 'Beto:Tinta']);
    assert.equal(materials.filterBalance(rows, names, { artistId: 'b' }).length, 2);
    assert.deepEqual(materials.deliveryTotals([{ itemId: 'i1', quantity: '3' }, { itemId: 'i2', quantity: '2', cost: '3' }, { itemId: 'i1', quantity: '0' }], ITEMS), { ARS: 150, USD: 6 });
});

test('el CSV del balance sale con etiquetas en español, coma decimal y nombre con fecha', () => {
    const csv = kit.toCsv(materials.csvColumns(), [{ artist_name: 'Ana', item_name: 'Tinta', unit: 'ml', assigned_qty: 10, returned_qty: 2.5, net_assigned_qty: 7.5, consumed_qty: 0, assigned_cost: 375.5, currency: 'ars', last_movement_at: null }]);
    const [header, line] = csv.trim().split('\r\n');
    assert.equal(header, 'Artista;Ítem;Unidad;Entregado;Devuelto;En poder del artista;Consumo registrado;Costo neto entregado;Moneda;Último movimiento');
    assert.equal(line, 'Ana;Tinta;ml;10;2,5;7,5;0;375,5;ARS;');
    assert.equal(materials.csvFilename({ slug: 'Estudio Ñandú' }, new Date(2026, 9, 30)), 'materiales-estudio-nandu-2026-10-30.csv');
    assert.match(materials.saveError({ message: 'violates check constraint "studio_inventory_movements_kind_check"' }, kit).message, /falta aplicar una migración/);
});

// ---------------------------------------------------------------
// studio-dashboard-materials.js · módulo registrado en el shell
// ---------------------------------------------------------------
function materialsModule({ data, kitOverrides = {} } = {}) {
    const registered = [];
    const document = fakeDocument();
    const admin = { register(tab, def) { registered.push({ tab, def }); return true; } };
    const window = { WeOtziStudioAdmin: admin, document, CustomEvent: FakeCustomEvent };
    vm.runInNewContext(materialsSource, { window, console, Date, Intl, Promise, Map, Set, URL });

    const body = fakeEl('body');
    const filter = fakeEl('filter');
    const actions = ['deliver', 'return', 'csv'].map(action => fakeEl(action, { attrs: { 'data-materials-action': action } }));
    const root = fakeEl('inventory-materials', {
        querySelector(sel) {
            if (sel === '[data-materials-body]') return body;
            if (sel === '[data-materials-filter="artist"]') return filter;
            return null;
        },
        querySelectorAll(sel) { return sel === '[data-materials-action]' ? actions : []; }
    });
    const ctx = { studio: { id: 's', slug: 'estudio' }, studioId: 's', data, kit: { ...kit, ...kitOverrides } };
    return { registered, document, root, body, filter, actions, ctx };
}

test('el módulo se registra en inventory y pinta el balance con nombres escapados', async () => {
    const data = {
        StudioOps: recordingRepo({
            listMaterialBalance: async () => ({ data: [
                { artist_user_id: 'a1', item_id: 'i1', item_name: 'Tinta <negra>', unit: 'ml', assigned_qty: 10, returned_qty: 4, net_assigned_qty: 6, consumed_qty: 1, assigned_cost: 300, currency: 'ARS', last_movement_at: '2026-10-30T10:00:00Z' },
                { artist_user_id: 'ex', item_id: 'i2', item_name: 'Guantes', unit: 'par', assigned_qty: 2, returned_qty: 0, net_assigned_qty: 2, consumed_qty: 0, assigned_cost: 5, currency: 'USD', last_movement_at: '2026-10-29T10:00:00Z' }
            ], error: null })
        }),
        StudioMemberships: recordingRepo({ listActiveArtists: async () => ({ data: [{ artist_user_id: 'a1', artists_db: { user_id: 'a1', name: '<i>Ana</i>' } }], error: null }) }),
        Artists: { listByUserIds: async ids => ({ data: ids.map(id => ({ user_id: id, name: 'Ex integrante' })), error: null }) }
    };
    const m = materialsModule({ data });
    assert.equal(m.registered.length, 1);
    assert.equal(m.registered[0].tab, 'inventory');
    const { mount, show } = m.registered[0].def;
    assert.equal(typeof show, 'function');
    mount(m.root, m.ctx);
    assert.match(m.root.innerHTML, /Entregar materiales/);
    assert.match(m.root.innerHTML, /Registrar devolución/);
    assert.match(m.root.innerHTML, /Exportar CSV/);
    await show(m.root, m.ctx, {});
    const html = m.body.innerHTML;
    assert.match(html, /Artistas con material/);
    assert.match(html, /Resumen por artista/);
    assert.match(html, /Detalle por ítem/);
    assert.ok(html.includes('&lt;i&gt;Ana&lt;/i&gt;') && !html.includes('<i>Ana'));
    assert.ok(html.includes('Tinta &lt;negra&gt;'));
    assert.match(html, /Ex integrante/, 'resuelve nombres de ex integrantes');
    assert.ok(html.includes(kit.fmtMoney(300, 'ARS')) && html.includes(kit.fmtMoney(5, 'USD')), 'costos por moneda');
    assert.match(html, /data-materials-return="a1" data-item="i1"/);
    assert.match(html, /data-materials-deliver="a1"/);
    assert.doesNotMatch(html, /data-materials-deliver="ex"/, 'a un ex integrante no se le entrega');
    assert.match(html, /data-materials-return="ex"/, 'pero sí puede devolver');
    assert.match(m.filter.innerHTML, /value="ex"/);
    assert.ok(m.actions.every(btn => !btn.disabled));
    assert.equal((m.document.listeners['weotzi:studio-inventory-changed'] || []).length, 1);
});

test('sin M3 la sección avisa la migración pendiente y deshabilita las acciones', async () => {
    const data = {
        StudioOps: recordingRepo({ listMaterialBalance: async () => ({ data: [], error: null, unavailable: true }) }),
        StudioMemberships: recordingRepo({ listActiveArtists: async () => ({ data: [], error: null }) })
    };
    const m = materialsModule({ data });
    const { mount, show } = m.registered[0].def;
    mount(m.root, m.ctx);
    await show(m.root, m.ctx, {});
    assert.match(m.body.innerHTML, /falta aplicar una migración/);
    assert.ok(m.actions.every(btn => btn.disabled));
});

test('"Entregar materiales" guarda todas las líneas en un solo insert y avisa al stock', async () => {
    const calls = [];
    const balance = [];
    const data = {
        StudioOps: recordingRepo({
            listMaterialBalance: async () => ({ data: balance.slice(), error: null }),
            listInventoryItems: async () => ({ data: ITEMS, error: null }),
            createInventoryMovement: async () => ({ data: null, error: null })
        }, calls),
        StudioMemberships: recordingRepo({ listActiveArtists: async () => ({ data: [{ artist_user_id: 'a1', artists_db: { user_id: 'a1', name: 'Ana' } }], error: null }) }, calls)
    };
    let modalOpts = null;
    const toasts = [];
    const lineEl = (itemId, quantity, cost) => fakeEl('line', {
        querySelector(sel) {
            if (sel === '[data-field="item"]') return { value: itemId };
            if (sel === '[data-field="quantity"]') return { value: quantity };
            if (sel === '[data-field="cost"]') return { value: cost };
            return null;
        }
    });
    const modalBody = fakeEl('modal-body', {
        querySelector(sel) {
            if (sel === '[data-field="artist"]') return { value: 'a1' };
            if (sel === '[data-field="when"]') return { value: '' };
            if (sel === '[data-field="notes"]') return { value: 'Kit de bienvenida' };
            return null;
        },
        querySelectorAll(sel) { return sel === '[data-line]' ? [lineEl('i1', '10', ''), lineEl('i2', '2', '3')] : []; }
    });
    const m = materialsModule({
        data,
        kitOverrides: {
            openModal(opts) { modalOpts = opts; return { body: modalBody, setError() {}, close() {} }; },
            toast(msg, tone) { toasts.push([msg, tone]); return { close() {} }; }
        }
    });
    const { mount, show } = m.registered[0].def;
    mount(m.root, m.ctx);
    await show(m.root, m.ctx, {});
    const deliverBtn = fakeEl('btn', { attrs: { 'data-materials-action': 'deliver' } });
    deliverBtn.closest = () => deliverBtn;
    await m.root.listeners.click[0]({ target: deliverBtn });
    assert.ok(modalOpts, 'abre el modal');
    assert.equal(modalOpts.title, 'Entregar materiales');
    assert.match(modalOpts.body, /Artista que recibe/);
    assert.match(modalOpts.body, /Tinta negra · 100 ml disponibles/);
    assert.match(modalOpts.body, /\+ Agregar otro ítem/);
    const loadsBefore = calls.filter(call => call[0] === 'listMaterialBalance').length;
    const result = await modalOpts.actions[1].onClick({ body: modalBody, setError() {} });
    assert.equal(result, true);
    const inserts = calls.filter(call => call[0] === 'createInventoryMovement');
    assert.equal(inserts.length, 1, 'un solo insert para todas las líneas');
    assert.equal(inserts[0][1].length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(inserts[0][1].map(row => [row.kind, row.item_id, row.quantity, row.unit_cost, row.related_artist_user_id, row.notes]))), [
        ['assignment', 'i1', 10, null, 'a1', 'Kit de bienvenida'],
        ['assignment', 'i2', 2, 3, 'a1', 'Kit de bienvenida']
    ]);
    assert.deepEqual(toasts.at(-1), ['Entregaste 2 ítems a Ana.', 'success']);
    const event = m.document.dispatched.find(e => e.type === 'weotzi:studio-inventory-changed');
    assert.equal(event.detail.source, 'materials');
    assert.equal(calls.filter(call => call[0] === 'listMaterialBalance').length, loadsBefore + 1, 'recarga el balance');
});

test('un error del trigger (stock) vuelve al modal sin registrar nada', async () => {
    const data = {
        StudioOps: recordingRepo({
            listMaterialBalance: async () => ({ data: [], error: null }),
            listInventoryItems: async () => ({ data: ITEMS, error: null }),
            createInventoryMovement: async () => ({ data: null, error: { code: '23514', message: 'Stock insuficiente de Guantes' } })
        }),
        StudioMemberships: recordingRepo({ listActiveArtists: async () => ({ data: [{ artist_user_id: 'a1', artists_db: { user_id: 'a1', name: 'Ana' } }], error: null }) })
    };
    let modalOpts = null;
    const modalBody = fakeEl('modal-body', {
        querySelector(sel) { return sel === '[data-field="artist"]' ? { value: 'a1' } : { value: '' }; },
        querySelectorAll(sel) {
            return sel === '[data-line]' ? [fakeEl('line', { querySelector: s => ({ value: s.includes('item') ? 'i2' : s.includes('quantity') ? '1' : '' }) })] : [];
        }
    });
    const m = materialsModule({ data, kitOverrides: { openModal(opts) { modalOpts = opts; return { body: modalBody }; } } });
    const { mount, show } = m.registered[0].def;
    mount(m.root, m.ctx);
    await show(m.root, m.ctx, {});
    const btn = fakeEl('btn', { attrs: { 'data-materials-action': 'deliver' } });
    btn.closest = () => btn;
    await m.root.listeners.click[0]({ target: btn });
    await assert.rejects(modalOpts.actions[1].onClick({ body: modalBody }), /Stock insuficiente de Guantes/);
    assert.equal(m.document.dispatched.length, 0);
});
