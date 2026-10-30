// Tienda del panel de estudio: placeholder sin Store (o sin la migración
// store_core) y panel real sobre WeotziData.Store + venta de mostrador por
// StudioOps.createStorePosOrder (create_store_pos_order, M6).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('public/shared/js/studio-dashboard-store.js');
const kit = require('../public/shared/js/studio-admin-kit.js');

function loadStore({ data = {}, withAdmin = true } = {}) {
    const registered = {};
    const warnings = [];
    const window = { WeOtziStudioKit: kit, WeotziData: data };
    if (withAdmin) window.WeOtziStudioAdmin = { register(tab, def) { registered[tab] = def; return true; } };
    const context = { window, console: { warn: (...a) => warnings.push(a), error() {}, log() {} }, Promise, Date, Math };
    vm.runInNewContext(source, context);
    return { registered, warnings };
}

function fakeRoot() {
    const listeners = {};
    const slots = {};
    return {
        innerHTML: '', listeners, slots,
        addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
        contains() { return true; },
        querySelector(sel) { return (slots[sel] = slots[sel] || { innerHTML: '' }); }
    };
}

test('se registra en la pestaña tienda con mount y show', () => {
    const { registered } = loadStore();
    assert.deepEqual(Object.keys(registered), ['tienda']);
    assert.equal(typeof registered.tienda.mount, 'function');
    assert.equal(typeof registered.tienda.show, 'function');
    assert.equal(loadStore({ withAdmin: false }).warnings.length, 1);
});

test('sin WeotziData.Store muestra el empty state con botón a Finanzas', async () => {
    const data = { StudioFinance: {} };
    const { registered } = loadStore({ data });
    const root = fakeRoot();
    await registered.tienda.mount(root, { data, kit, navigate() {} });
    assert.match(root.innerHTML, /data-store-state="pending"/);
    assert.match(root.innerHTML, /La Tienda llega en la próxima fase/);
    assert.match(root.innerHTML, /data-nav="finanzas"/);
});

test('con Store pero sin la migración (isAvailable false) sigue el empty state', async () => {
    const data = { Store: { isAvailable: async () => false } };
    const { registered } = loadStore({ data });
    const root = fakeRoot();
    await registered.tienda.mount(root, { data, kit, navigate() {}, studioId: 's1', studio: {} });
    assert.match(root.innerHTML, /data-store-state="pending"/);
});

test('con Store disponible lista productos físicos del estudio, pedidos y avisa ajustes faltantes', async () => {
    const calls = [];
    const data = {
        Store: {
            isAvailable: async () => true,
            listMyProducts: async (type, id) => { calls.push(['products', type, id]); return [
                { id: 'p1', kind: 'merch', status: 'active', title: 'Remera <b>', category: 'merch', price_amount: 15000, currency: 'ARS', sales_count: 3, variants: [{ id: 'v1', label: 'M', stock: 4, active: true }] },
                { id: 'p2', kind: 'design', status: 'active', title: 'Diseño', variants: [] }
            ]; },
            listSellerOrders: async (type, id) => { calls.push(['orders', type, id]); return [
                { id: 'o1', order_number: 'ST-AAAA1111', channel: 'online', status: 'pending_payment', total_amount: 15000, currency: 'ARS', buyer_name: 'Ana', items: [{ title: 'Remera', quantity: 1 }] },
                { id: 'o2', order_number: 'ST-BBBB2222', channel: 'pos', status: 'fulfilled', total_amount: 30000, currency: 'ARS', buyer_name: 'Cliente en mostrador', items: [{ title: 'Remera', quantity: 2 }] }
            ]; },
            getSellerSettings: async () => ({ contact_channel: '@tinta', payment_instructions: '', pickup_address: '' })
        }
    };
    const { registered } = loadStore({ data });
    const root = fakeRoot();
    await registered.tienda.mount(root, { data, kit, navigate() {}, studioId: 'studio-1', studio: { slug: 'tinta-sur' } });
    assert.deepEqual(calls.map(c => c.join(':')).sort(), ['orders:studio:studio-1', 'products:studio:studio-1']);
    assert.match(root.innerHTML, /studio\/profile\/\?studio=tinta-sur#studio-store/);
    const products = root.slots['[data-store-products]'].innerHTML;
    assert.match(products, /Remera &lt;b&gt;/, 'escapa el título');
    assert.doesNotMatch(products, /Diseño/, 'solo productos físicos');
    assert.match(products, /data-act="pause"/);
    assert.match(products, /data-act="pos"/);
    const orders = root.slots['[data-store-orders]'].innerHTML;
    assert.match(orders, /data-act="order-paid" data-id="o1"/);
    assert.match(orders, /Mostrador/);
    assert.match(root.slots['[data-store-alert]'].innerHTML, /cómo te pagan, la dirección de retiro/);
});

test('repo: createStorePosOrder llama a create_store_pos_order con los p_* de M6', () => {
    const repo = read('public/shared/js/data/studios-repo.js');
    const block = repo.slice(repo.indexOf('createStorePosOrder('), repo.indexOf('// ---- reportes ----'));
    for (const key of ['p_studio_id', 'p_product_id', 'p_variant_id', 'p_quantity', 'p_payment_method', 'p_buyer_name', 'p_buyer_email', 'p_buyer_phone', 'p_idempotency_key']) {
        assert.match(block, new RegExp(key + ':'), key);
    }
    const sql = read('supabase/migrations/20261030205000_studio_store.sql');
    assert.match(sql, /create or replace function public\.create_store_pos_order\(\s*p_studio_id uuid,\s*p_product_id uuid,\s*p_variant_id uuid,\s*p_quantity integer,\s*p_payment_method text/);
    assert.match(sql, /'pos', null, 'guest'/);
    assert.match(sql, /grant execute on function public\.get_public_storefront\(text, text\) to anon, authenticated/);
});
