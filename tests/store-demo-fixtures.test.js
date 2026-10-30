'use strict';
// Store del artista · fixtures del demo/preview y RPC simuladas
// (docs/plans/2026-10-30-store-artista.md §6 y §8.6). Carga store-model.js y la
// extensión public/shared/js/demo-fixtures/store.js en un sandbox vm (patrón de
// figma-final-cuenta), arma el demo completo con wo-demo-fixtures.build() y
// recorre los flujos contra el emulador PostgREST: compra → pago → licencia,
// exclusiva, stock, cancelación, envío, reembolso, reportes y vitrina. Al final
// corre las selects del repo (STORE_SELECTS) contra el mismo emulador.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const Postgrest = require('../public/shared/js/wo-demo-postgrest.js');
const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');

// store-model + extensión en su sandbox; build() lee el registro de `self`.
const sandbox = { console };
sandbox.self = sandbox;
vm.runInNewContext(read('public/shared/js/store-model.js'), sandbox, { filename: 'store-model.js' });
vm.runInNewContext(read('public/shared/js/demo-fixtures/store.js'), sandbox, { filename: 'demo-fixtures/store.js' });
global.self = sandbox;
const M = sandbox.WeotziStoreModel;
// Las filas de build() nacen en el realm del sandbox: se copian antes de deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));

const IDENTITY = { userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo Artist', email: 'demo@weotzi.test' };
const ME = IDENTITY.userId;
const STORE_TABLES = ['store_products', 'store_product_variants', 'store_design_assets', 'store_seller_settings', 'store_orders',
    'store_order_items', 'store_payments', 'store_licenses', 'store_download_events', 'store_demo_sellers'];
const sid = (n) => '0000c0de-0000-4000-8000-57' + String(n).padStart(10, '0');
const P = { D1: sid(101), D2: sid(102), D3: sid(103), M1: sid(104), M2: sid(105), M3: sid(106), MD1: sid(151), MD2: sid(152), MM1: sid(153) };
const O = { O1: sid(401), O2: sid(402), O3: sid(403), O4: sid(404), O5: sid(405), O6: sid(406), P1: sid(451), P2: sid(452) };
const V = { S: sid(201), M: sid(202), L: sid(203), XL: sid(204), XXL: sid(205), A3: sid(206), A4: sid(207), STK: sid(208), TOTE: sid(251) };
const MARA = sid(901);
const enc = encodeURIComponent;

function makeStore() {
    const fx = Fixtures.build(IDENTITY);
    const store = Postgrest.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views });
    const client = (i) => fx.clients[i].user_id;
    return { fx, store, client };
}
function call(store, method, p, search, body, ctx) {
    const res = store.handle({ method, path: p, search: search || '', headers: {}, body: body == null ? null : JSON.stringify(body), ctx: ctx || { userId: ME } });
    return { status: res.status, body: res.body == null ? null : JSON.parse(res.body) };
}
function rpc(store, fn, args, ctx) { return call(store, 'POST', 'rpc/' + fn, '', args, ctx); }
function ok(res) {
    assert.equal(res.status, 200, 'esperaba 200 y vino ' + res.status + ' ' + JSON.stringify(res.body));
    return res.body;
}
function fails(res, code) {
    assert.equal(res.status, 400, 'esperaba store:' + code + ' y vino ' + res.status + ' ' + JSON.stringify(res.body));
    assert.equal(res.body.code, 'P0001');
    assert.equal(res.body.message, 'store:' + code);
    assert.equal(M.errorCode({ message: '[x] ' + res.body.message, cause: res.body }), code);
}
function row(store, table, id) { return store.rows(table).find((r) => r.id === id); }
function orderArgs(extra) {
    return Object.assign({
        p_product_id: null, p_variant_id: null, p_quantity: 1, p_license_tier: null, p_license_holder_name: null,
        p_fulfillment_method: null, p_shipping_address: null, p_buyer_note: null, p_terms_version: M.TERMS_VERSION,
        p_idempotency_key: 'k-' + Math.random().toString(36).slice(2)
    }, extra);
}
const ADDRESS_AR = { recipient: 'Franco Medina', line1: 'Calle 1', city: 'Rosario', country: 'ar' };

/* ------------------------------ registro y forma ------------------------------ */

test('la extensión store está registrada y declara sus 9 tablas + store_demo_sellers con fixtures, ids estables y dump chico', () => {
    assert.ok(Fixtures.EXTENSIONS.includes('store'), "wo-demo-fixtures.js carga la extensión 'store'");
    const { fx, store } = makeStore();
    for (const t of STORE_TABLES) {
        assert.ok(Fixtures.TABLES.includes(t), t + ' declarada en TABLES');
        assert.ok(Array.isArray(fx.tables[t]), t + ' tiene fixture');
    }
    assert.deepEqual(Fixtures.TABLES.filter((t) => !fx.tables[t]), [], 'toda tabla declarada tiene fixture');
    for (const t of STORE_TABLES) {
        const ids = fx.tables[t].map((r) => r.id).filter((v) => v != null);
        assert.equal(new Set(ids).size, ids.length, t + ' sin ids duplicados');
        assert.ok(ids.every((v) => /^0000c0de-0000-4000-8000-57\d{10}$/.test(v)), t + ' usa el prefijo propio');
    }
    assert.ok(JSON.stringify(store.dump()).length < 400 * 1024, 'el dump del demo completo entra en sessionStorage');
    // Las relaciones que usa el repo.
    assert.ok(fx.relations.store_products.store_product_variants && fx.relations.store_products.store_design_assets);
    assert.ok(fx.relations.store_orders.store_order_items && fx.relations.store_orders.store_licenses && fx.relations.store_orders.store_payments);
    assert.ok(fx.relations.store_licenses.store_orders);
    // wo-demo.js subió la versión (cache de las extensiones).
    assert.doesNotMatch(read('public/shared/js/wo-demo.js'), /var VERSION = '20260903-1'/);
});

test('fixtures: el demo vende 3 diseños y 3 merch, recibe pedidos en cada estado y le compra a Mara Ink', () => {
    const { fx, store } = makeStore();
    const own = fx.tables.store_products.filter((p) => p.seller_id === ME);
    assert.equal(own.filter((p) => p.kind === 'design').length, 3);
    assert.equal(own.filter((p) => p.kind === 'merch').length, 3);
    assert.equal(row(store, 'store_products', P.D3).status, 'retired');
    assert.ok(row(store, 'store_products', P.D3).exclusive_sold_at);
    assert.equal(row(store, 'store_products', P.D2).reserved_order_id, O.O1);
    assert.deepEqual(plain(fx.tables.store_product_variants.filter((v) => v.product_id === P.M1 && v.active).map((v) => v.size)), ['S', 'M', 'L', 'XL']);

    const d1 = ok(rpc(store, 'get_public_store_product', { p_product_id: P.D1 }));
    assert.equal(d1.product.exclusive_available, true, 'D1: exclusiva disponible');
    const d2 = ok(rpc(store, 'get_public_store_product', { p_product_id: P.D2 }));
    assert.equal(d2.product.reserved, true, 'D2: reservado');
    assert.equal(d2.product.exclusive_available, false);
    assert.equal(rpc(store, 'get_public_store_product', { p_product_id: P.D3 }).body, null, 'D3 retirado no es público');

    // Mara Ink: solo en store_demo_sellers, nunca en artists_db.
    assert.deepEqual(plain(fx.tables.store_demo_sellers.map((s) => s.handle)), ['mara-ink.wo']);
    assert.ok(!fx.tables.artists_db || !fx.tables.artists_db.some((a) => a.user_id === MARA));
    assert.equal(fx.tables.store_products.filter((p) => p.seller_id === MARA && p.status === 'active').length, 3);

    // Pedidos recibidos: pendiente con pago informado, por preparar, enviado, digital completado con licencia.
    const received = fx.tables.store_orders.filter((o) => o.seller_id === ME);
    const has = (fn) => received.some(fn);
    assert.ok(has((o) => o.status === 'pending_payment' && o.buyer_payment_reported_at));
    assert.ok(has((o) => o.status === 'paid' && o.fulfillment_status === 'unfulfilled'));
    assert.ok(has((o) => o.status === 'paid' && o.fulfillment_status === 'shipped' && o.tracking_code));
    assert.ok(has((o) => o.status === 'fulfilled' && o.fulfillment_method === 'digital'));
    assert.ok(fx.tables.store_licenses.some((l) => l.order_id === O.O4 && l.tier === 'exclusive'));
    assert.deepEqual(plain([...new Set(fx.tables.store_orders.map((o) => o.currency))].sort()), ['ARS', 'USD']);

    // Compras del usuario demo: un diseño con licencia y archivos, y un merch enviado.
    const purchases = fx.tables.store_orders.filter((o) => o.buyer_user_id === ME);
    assert.deepEqual(plain(purchases.map((o) => [o.seller_id, o.status, o.fulfillment_status])),
        [[MARA, 'fulfilled', 'delivered'], [MARA, 'paid', 'shipped']]);
    const mine = fx.tables.store_licenses.find((l) => l.holder_user_id === ME);
    assert.equal(mine.product_id, P.MD1);
    assert.equal(fx.tables.store_design_assets.filter((a) => a.product_id === P.MD1).length, 2);

    // Los snapshots y vistas del modelo funcionan con las filas del demo.
    const fullOrders = call(store, 'GET', 'store_orders', '?select=' + enc('*,store_order_items(*),store_licenses(*),store_payments(*)')).body;
    const o1 = M.orderView(fullOrders.find((o) => o.id === O.O1), { role: 'seller' });
    assert.ok(o1.actions.some((a) => a.key === 'confirm_payment'));
    assert.ok(o1.paymentReported);
    const o2 = M.orderView(fullOrders.find((o) => o.id === O.O2), { role: 'seller' });
    assert.ok(o2.actions.some((a) => a.key === 'fulfillment' && a.status === 'preparing'));
    assert.equal(M.licenseView(row(store, 'store_licenses', sid(701))).status, 'used');
    assert.equal(M.licenseView(mine).status, 'available');
});

test('fixtures: cada imagen y archivo de demo existe en public/shared/assets/demo/store', () => {
    const { fx } = makeStore();
    const dir = path.join(root, 'public/shared/assets/demo/store');
    const paths = new Set();
    fx.tables.store_products.forEach((p) => p.images.forEach((img) => paths.add(img.path)));
    fx.tables.store_order_items.forEach((i) => paths.add(i.image_path));
    assert.ok(paths.size >= 9, '6 productos propios + 3 de Mara con preview');
    for (const p of paths) {
        assert.match(p, /^demo\/store\/[a-z0-9-]+\.svg$/);
        assert.ok(fs.existsSync(path.join(root, 'public/shared/assets', p)), p + ' existe');
    }
    for (const f of ['original.svg', 'stencil.svg', 'original.png', 'stencil.png', 'mara-avatar.svg']) {
        assert.ok(fs.existsSync(path.join(dir, f)), f + ' existe');
    }
    for (const f of fs.readdirSync(dir)) {
        assert.ok(fs.statSync(path.join(dir, f)).size < 20 * 1024, f + ' es liviano');
        if (f.endsWith('.svg')) assert.doesNotMatch(read('public/shared/assets/demo/store/' + f), /<script|on[a-z]+=/i, f + ' sin scripts');
    }
    assert.ok(fx.tables.store_design_assets.every((a) => a.storage_path.startsWith('demo/' + a.product_id + '/' + a.kind + '/')));
});

/* ------------------------------ compra → pago → licencia ------------------------------ */

test('compra de licencia personal: idempotencia, pago informado, confirmación, licencia verificable y uso único', () => {
    const { store, client } = makeStore();
    const buyer = { userId: client(2) };
    const args = orderArgs({ p_product_id: P.D1, p_license_tier: 'personal', p_license_holder_name: '  Ana Regalo ', p_buyer_note: 'Para mi hermana', p_idempotency_key: 'k-1' });
    const order = ok(rpc(store, 'create_store_order', args, buyer));
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.fulfillment_method, 'digital');
    assert.equal(order.total_amount, 35);
    assert.equal(order.currency, 'USD');
    assert.equal(order.buyer_role, 'client');
    assert.match(order.order_number, /^ST-[0-9A-F]{8}$/);
    assert.ok(order.payment_instructions && order.seller_contact, 'snapshots de cobro y contacto');
    const ttl = Date.parse(order.expires_at) - Date.now();
    assert.ok(ttl > 23 * 3600000 && ttl <= 24 * 3600000, 'vence en 24 h');
    const it = store.rows('store_order_items').find((i) => i.order_id === order.id);
    assert.equal(it.license_holder_name, 'Ana Regalo');
    assert.equal(it.terms_version, M.TERMS_VERSION);
    assert.equal(it.image_path, 'demo/store/golondrina.svg');

    // Idempotencia y límites.
    const count = store.rows('store_orders').length;
    assert.equal(ok(rpc(store, 'create_store_order', args, buyer)).id, order.id);
    assert.equal(store.rows('store_orders').length, count);
    fails(rpc(store, 'create_store_order', Object.assign({}, args, { p_idempotency_key: 'k-2' }), buyer), 'pending_order_exists');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.D1, p_license_tier: 'personal', p_terms_version: '2025-01' }), buyer), 'terms_version_mismatch');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.D1, p_license_tier: 'personal' })), 'own_product');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MD2, p_license_tier: 'artist' }), buyer), 'artist_tier_requires_artist');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MD2, p_license_tier: 'oro' }), buyer), 'tier_unavailable');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MD2, p_license_tier: 'personal' }), {}), 'not_authenticated');

    // Pago informado: extiende el vencimiento y ya no lo cancela el comprador.
    fails(rpc(store, 'report_store_payment', { p_order_id: order.id, p_reference: 'x' }, { userId: client(3) }), 'not_found');
    const reported = ok(rpc(store, 'report_store_payment', { p_order_id: order.id, p_reference: 'Transferencia 991' }, buyer));
    assert.ok(reported.buyer_payment_reported_at);
    assert.ok(Date.parse(reported.expires_at) - Date.now() > 6.9 * 86400000);
    fails(rpc(store, 'cancel_store_order', { p_order_id: order.id, p_reason: 'me arrepentí' }, buyer), 'payment_reported');

    // Confirmación: solo el vendedor (o soporte) y con el cobrador correcto.
    fails(rpc(store, 'confirm_store_order_payment', { p_order_id: order.id, p_collected_by: 'seller', p_reference: 'TR-1', p_note: null }, buyer), 'forbidden');
    fails(rpc(store, 'confirm_store_order_payment', { p_order_id: order.id, p_collected_by: 'platform', p_reference: 'TR-1', p_note: null }), 'collector_mismatch');
    const paid = ok(rpc(store, 'confirm_store_order_payment', { p_order_id: order.id, p_collected_by: 'seller', p_reference: 'TR-1', p_note: 'Llegó' }));
    assert.deepEqual([paid.status, paid.fulfillment_status, paid.delivered_by, paid.payment_collected_by], ['fulfilled', 'delivered', 'auto', 'seller']);
    assert.ok(paid.paid_at);
    const lic = store.rows('store_licenses').find((l) => l.order_id === order.id);
    assert.equal(lic.tier, 'personal');
    assert.equal(lic.holder_user_id, buyer.userId);
    assert.equal(lic.holder_name, 'Ana Regalo');
    assert.equal(lic.seller_username, 'demo.wo');
    assert.match(lic.verification_code, M.LICENSE_CODE_RE);
    assert.equal(row(store, 'store_products', P.D1).licenses_issued, 1);
    assert.equal(row(store, 'store_products', P.D1).sales_count, 1);
    assert.deepEqual(store.rows('store_payments').filter((p) => p.order_id === order.id).map((p) => p.status), ['succeeded']);

    // Reconfirmar: misma referencia no cambia nada; otra referencia queda como duplicado para soporte.
    ok(rpc(store, 'confirm_store_order_payment', { p_order_id: order.id, p_collected_by: 'seller', p_reference: 'TR-1', p_note: null }));
    assert.equal(store.rows('store_payments').filter((p) => p.order_id === order.id).length, 1);
    const dup = ok(rpc(store, 'confirm_store_order_payment', { p_order_id: order.id, p_collected_by: 'seller', p_reference: 'TR-2', p_note: null }));
    assert.equal(dup.metadata_json.needs_support, true);
    assert.deepEqual(store.rows('store_payments').filter((p) => p.order_id === order.id).map((p) => p.status), ['succeeded', 'duplicate']);

    // Verificación pública y uso único.
    const verified = ok(rpc(store, 'verify_store_license', { p_code: lic.verification_code.toLowerCase() }));
    assert.deepEqual([verified.found, verified.valid, verified.used, verified.holder_initials, verified.tier], [true, true, false, 'A. R.', 'personal']);
    assert.equal(M.licenseView(verified).status, 'available');
    fails(rpc(store, 'mark_store_license_used', { p_license_id: lic.id, p_note: 'x' }), 'not_found');
    const used = ok(rpc(store, 'mark_store_license_used', { p_license_id: lic.id, p_note: 'Tatuado el 12/11 en Estudio X' }, buyer));
    assert.ok(used.used_at);
    fails(rpc(store, 'mark_store_license_used', { p_license_id: lic.id, p_note: null }, buyer), 'license_used');
    assert.equal(ok(rpc(store, 'verify_store_license', { p_code: lic.verification_code })).used, true);
    assert.deepEqual(ok(rpc(store, 'verify_store_license', { p_code: 'WOL-0000-0000' })), { valid: false, found: false });

    // Con una licencia emitida, la exclusiva deja de estar disponible.
    assert.equal(ok(rpc(store, 'get_public_store_product', { p_product_id: P.D1 })).product.exclusive_available, false);
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.D1, p_license_tier: 'exclusive' }), { userId: client(9) }), 'exclusive_unavailable');
});

test('exclusiva: reserva el diseño, bloquea a otros y al confirmarse lo retira y cancela los pendientes', () => {
    const { store, client } = makeStore();
    const a = { userId: client(9) };
    const b = { userId: client(7) };
    const order = ok(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.D1, p_license_tier: 'exclusive' }), a));
    assert.equal(order.total_amount, 420);
    const reserved = row(store, 'store_products', P.D1);
    assert.equal(reserved.reserved_order_id, order.id);
    assert.equal(reserved.reserved_until, order.expires_at);
    const pub = ok(rpc(store, 'get_public_store_product', { p_product_id: P.D1 })).product;
    assert.deepEqual([pub.reserved, pub.exclusive_available], [true, false]);
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.D1, p_license_tier: 'personal' }), b), 'product_reserved');
    // Camila ya tiene la reserva de D2 (O1): una sola exclusiva activa por comprador.
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MD2, p_license_tier: 'exclusive' }), { userId: client(0) }), 'too_many_pending');

    // Un pendiente viejo del mismo diseño (red de seguridad del SQL).
    const legacy = store.insert('store_orders', [Object.assign({}, row(store, 'store_orders', O.O1), {
        id: sid(990), order_number: 'ST-LEGACY01', buyer_user_id: b.userId, buyer_payment_reported_at: null, idempotency_key: 'legacy'
    })])[0];
    store.insert('store_order_items', [Object.assign({}, store.rows('store_order_items').find((i) => i.order_id === O.O1), {
        id: sid(991), order_id: legacy.id, product_id: P.D1, license_tier: 'personal'
    })]);

    const sold = ok(rpc(store, 'confirm_store_order_payment', { p_order_id: order.id, p_collected_by: 'seller', p_reference: 'EX-1', p_note: null }));
    assert.equal(sold.status, 'fulfilled');
    const product = row(store, 'store_products', P.D1);
    assert.deepEqual([product.status, product.reserved_order_id, product.licenses_issued], ['retired', null, 1]);
    assert.ok(product.exclusive_sold_at && product.retired_at);
    const cancelled = row(store, 'store_orders', legacy.id);
    assert.deepEqual([cancelled.status, cancelled.cancel_reason], ['cancelled', 'exclusive_sold']);
    assert.equal(store.rows('store_licenses').find((l) => l.order_id === order.id).tier, 'exclusive');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.D1, p_license_tier: 'personal' }), b), 'product_unavailable');
    const front = ok(rpc(store, 'get_public_storefront', { p_seller_type: 'artist', p_handle: 'demo.wo' }));
    assert.ok(!front.products.some((p) => p.id === P.D1), 'el retirado sale de la vitrina');

    // Cooldown: cancelar una reserva exclusiva impide volver a reservarla por 7 días.
    const c = { userId: client(8) };
    const first = ok(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MD2, p_license_tier: 'exclusive' }), c));
    assert.equal(row(store, 'store_products', P.MD2).reserved_order_id, first.id);
    ok(rpc(store, 'cancel_store_order', { p_order_id: first.id, p_reason: 'Me equivoqué' }, c));
    assert.equal(row(store, 'store_products', P.MD2).reserved_order_id, null, 'cancelar libera la reserva');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MD2, p_license_tier: 'exclusive' }), c), 'exclusive_cooldown');
    ok(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MD2, p_license_tier: 'personal' }), c));
});

/* ------------------------------ stock y merch ------------------------------ */

test('merch: variante, cantidad, envío y retiro con los códigos del SQL; el stock se descuenta al crear y vuelve al cancelar', () => {
    const { store, client } = makeStore();
    const buyer = { userId: client(10) };
    const tee = (extra) => orderArgs(Object.assign({ p_product_id: P.M1, p_variant_id: V.S, p_fulfillment_method: 'shipping', p_shipping_address: ADDRESS_AR }, extra));
    fails(rpc(store, 'create_store_order', tee({ p_quantity: 5 }), buyer), 'out_of_stock');
    fails(rpc(store, 'create_store_order', tee({ p_quantity: 21 }), buyer), 'invalid_quantity');
    fails(rpc(store, 'create_store_order', tee({ p_quantity: 0 }), buyer), 'invalid_quantity');
    fails(rpc(store, 'create_store_order', tee({ p_variant_id: V.L }), buyer), 'out_of_stock');
    fails(rpc(store, 'create_store_order', tee({ p_variant_id: V.XXL }), buyer), 'variant_unavailable');
    fails(rpc(store, 'create_store_order', tee({ p_variant_id: V.A3 }), buyer), 'variant_unavailable');
    fails(rpc(store, 'create_store_order', tee({ p_variant_id: null }), buyer), 'variant_required');
    fails(rpc(store, 'create_store_order', tee({ p_license_tier: 'personal' }), buyer), 'tier_unavailable');
    fails(rpc(store, 'create_store_order', tee({ p_shipping_address: Object.assign({}, ADDRESS_AR, { country: 'CL' }) }), buyer), 'ships_to_unsupported');
    fails(rpc(store, 'create_store_order', tee({ p_shipping_address: { recipient: 'X', city: 'Rosario', country: 'AR' } }), buyer), 'shipping_address_invalid');
    fails(rpc(store, 'create_store_order', tee({ p_fulfillment_method: null }), buyer), 'shipping_address_invalid');
    fails(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.MM1, p_variant_id: V.TOTE, p_fulfillment_method: 'pickup' }), buyer), 'pickup_unavailable');
    assert.equal(row(store, 'store_product_variants', V.S).stock, 4, 'los rechazos no tocan el stock');

    const order = ok(rpc(store, 'create_store_order', tee({ p_quantity: 2 }), buyer));
    assert.deepEqual([order.subtotal_amount, order.shipping_amount, order.total_amount, order.currency], [56000, 6500, 62500, 'ARS']);
    assert.equal(order.shipping_address.country, 'AR');
    assert.equal(row(store, 'store_product_variants', V.S).stock, 2);
    const it = store.rows('store_order_items').find((i) => i.order_id === order.id);
    assert.deepEqual([it.kind, it.variant_label, it.quantity, it.license_tier], ['merch', 'Talle S', 2, null]);

    // Override de precio por variante y envío sin restricción de países.
    const print = ok(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.M2, p_variant_id: V.A4, p_fulfillment_method: 'shipping',
        p_shipping_address: Object.assign({}, ADDRESS_AR, { country: 'CL' }) }), buyer));
    assert.deepEqual([print.subtotal_amount, print.total_amount, print.currency], [28, 43, 'USD']);
    const pickup = ok(rpc(store, 'create_store_order', orderArgs({ p_product_id: P.M3, p_variant_id: V.STK, p_fulfillment_method: 'pickup' }), buyer));
    assert.deepEqual([pickup.fulfillment_method, pickup.shipping_amount, pickup.total_amount], ['pickup', 0, 6000]);
    assert.equal(row(store, 'store_product_variants', V.STK).stock, 2);

    // Cancelación (sin pago informado): el comprador puede y el stock vuelve.
    fails(rpc(store, 'cancel_store_order', { p_order_id: order.id, p_reason: null }, { userId: client(11) }), 'not_found');
    const cancelled = ok(rpc(store, 'cancel_store_order', { p_order_id: order.id, p_reason: 'Cambio de talle' }, buyer));
    assert.deepEqual([cancelled.status, cancelled.cancel_reason], ['cancelled', 'Cambio de talle']);
    assert.equal(row(store, 'store_product_variants', V.S).stock, 4);
    fails(rpc(store, 'cancel_store_order', { p_order_id: order.id, p_reason: null }, buyer), 'invalid_status');
    // El vendedor también cancela pendientes sin pago informado.
    ok(rpc(store, 'cancel_store_order', { p_order_id: pickup.id, p_reason: 'Sin stock real' }));
    assert.equal(row(store, 'store_product_variants', V.STK).stock, 3);

    // Ajuste de stock con concurrencia optimista.
    fails(rpc(store, 'adjust_store_variant_stock', { p_variant_id: V.S, p_new_stock: 10, p_expected_stock: 3 }), 'stock_changed');
    fails(rpc(store, 'adjust_store_variant_stock', { p_variant_id: V.S, p_new_stock: 10, p_expected_stock: 4 }, buyer), 'forbidden');
    fails(rpc(store, 'adjust_store_variant_stock', { p_variant_id: V.S, p_new_stock: -1, p_expected_stock: 4 }), 'invalid_quantity');
    assert.equal(ok(rpc(store, 'adjust_store_variant_stock', { p_variant_id: V.S, p_new_stock: 10, p_expected_stock: 4 })).stock, 10);
    assert.equal(ok(rpc(store, 'adjust_store_variant_stock', { p_variant_id: V.A4, p_new_stock: 5, p_expected_stock: null })).stock, 5);
    fails(rpc(store, 'adjust_store_variant_stock', { p_variant_id: sid(999), p_new_stock: 1, p_expected_stock: null }), 'not_found');
});

test('envío: preparado → enviado con tracking https → recibido por el comprador; nunca hacia atrás', () => {
    const { store, client } = makeStore();
    const step = (orderId, status, extra, ctx) => rpc(store, 'update_store_order_fulfillment', Object.assign({
        p_order_id: orderId, p_status: status, p_tracking_carrier: null, p_tracking_code: null, p_tracking_url: null, p_seller_message: null
    }, extra), ctx);
    fails(step(O.O2, 'preparing', {}, { userId: client(1) }), 'forbidden');
    fails(step(O.O2, 'ready_for_pickup'), 'invalid_status');
    assert.equal(ok(step(O.O2, 'preparing')).fulfillment_status, 'preparing');
    fails(step(O.O2, 'unfulfilled'), 'invalid_status');
    fails(step(O.O2, 'shipped', { p_tracking_url: 'http://correo.example.com/x' }), 'invalid_tracking_url');
    const shipped = ok(step(O.O2, 'shipped', { p_tracking_carrier: 'Correo', p_tracking_code: 'AB123', p_tracking_url: 'https://seguimiento.example.com/AB123', p_seller_message: 'Salió hoy' }));
    assert.deepEqual([shipped.fulfillment_status, shipped.tracking_code, shipped.seller_message], ['shipped', 'AB123', 'Salió hoy']);
    assert.ok(shipped.shipped_at);
    fails(step(O.O2, 'preparing'), 'invalid_status');
    fails(rpc(store, 'confirm_store_order_received', { p_order_id: O.O2 }, { userId: client(5) }), 'not_found');
    const received = ok(rpc(store, 'confirm_store_order_received', { p_order_id: O.O2 }, { userId: client(1) }));
    assert.deepEqual([received.status, received.fulfillment_status, received.delivered_by], ['fulfilled', 'delivered', 'buyer']);
    fails(rpc(store, 'confirm_store_order_received', { p_order_id: O.O2 }, { userId: client(1) }), 'invalid_status');

    // Retiro listo: sin wallet, el vendedor puede marcarlo entregado.
    const picked = ok(step(O.O6, 'delivered'));
    assert.deepEqual([picked.status, picked.delivered_by], ['fulfilled', 'seller']);
    fails(step(O.O4, 'delivered'), 'invalid_status');
    // El demo también compra: confirma la tote de Mara.
    assert.equal(ok(rpc(store, 'confirm_store_order_received', { p_order_id: O.P2 })).status, 'fulfilled');
});

test('reembolso: merch sin despachar restituye stock; despachado solo soporte; la exclusiva revoca y pausa el diseño', () => {
    const { store, client } = makeStore();
    fails(rpc(store, 'refund_store_order', { p_order_id: O.O2, p_reason: 'x' }, { userId: client(1) }), 'forbidden');
    fails(rpc(store, 'refund_store_order', { p_order_id: O.O1, p_reason: 'x' }), 'invalid_status');
    const refunded = ok(rpc(store, 'refund_store_order', { p_order_id: O.O2, p_reason: 'Sin talle' }));
    assert.equal(refunded.status, 'refunded');
    assert.equal(row(store, 'store_product_variants', V.M).stock, 10, 'vuelve la remera M');
    assert.equal(row(store, 'store_products', P.M1).sales_count, 0);
    assert.deepEqual(store.rows('store_payments').filter((p) => p.order_id === O.O2).map((p) => p.status), ['succeeded', 'refunded']);

    fails(rpc(store, 'refund_store_order', { p_order_id: O.O3, p_reason: 'x' }), 'invalid_status');
    ok(rpc(store, 'refund_store_order', { p_order_id: O.O3, p_reason: 'Llegó dañado' }, { userId: client(12), isSupport: true }));
    assert.equal(row(store, 'store_product_variants', V.A3).stock, 12, 'despachado: el stock no vuelve');

    ok(rpc(store, 'refund_store_order', { p_order_id: O.O4, p_reason: 'Acuerdo con la clienta' }));
    const lic = row(store, 'store_licenses', sid(701));
    assert.ok(lic.revoked_at);
    assert.equal(lic.revoke_reason, 'Acuerdo con la clienta');
    const d3 = row(store, 'store_products', P.D3);
    assert.deepEqual([d3.status, d3.exclusive_sold_at, d3.licenses_issued, d3.retired_at], ['paused', null, 0, null]);
    const verified = ok(rpc(store, 'verify_store_license', { p_code: lic.verification_code }));
    assert.deepEqual([verified.valid, verified.revoked], [false, true]);
    fails(rpc(store, 'mark_store_license_used', { p_license_id: lic.id, p_note: null }, { userId: client(3) }), 'license_revoked');
});

/* ------------------------------ reporte, soporte y vitrina ------------------------------ */

test('reporte de ventas por producto, mes y moneda; solo para el vendedor o soporte', () => {
    const { store, client } = makeStore();
    const rows = ok(rpc(store, 'get_store_sales_report', { p_seller_type: 'artist', p_seller_id: ME, p_from: null, p_to: null }));
    const by = (product) => rows.filter((r) => r.product_id === product);
    assert.deepEqual([...new Set(rows.map((r) => r.currency))].sort(), ['ARS', 'USD']);
    assert.deepEqual(by(P.D3).map((r) => [r.kind, r.units, r.gross_amount, r.orders, r.currency]), [['design', 1, 420, 1, 'USD']]);
    assert.equal(by(P.M1)[0].gross_amount, 28000);
    assert.equal(by(P.M3)[0].units, 1, 'el pedido cancelado no suma');
    assert.equal(by(P.D2).length, 0, 'el pendiente no suma');
    assert.ok(rows.every((r) => /^\d{4}-\d{2}-01$/.test(r.month)));
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.deepEqual(ok(rpc(store, 'get_store_sales_report', { p_seller_type: 'artist', p_seller_id: ME, p_from: tomorrow, p_to: null })), []);
    fails(rpc(store, 'get_store_sales_report', { p_seller_type: 'artist', p_seller_id: ME, p_from: null, p_to: null }, { userId: client(0) }), 'forbidden');
    // Mara vende al demo; el demo no ve su reporte.
    fails(rpc(store, 'get_store_sales_report', { p_seller_type: 'artist', p_seller_id: MARA, p_from: null, p_to: null }), 'forbidden');

    fails(rpc(store, 'set_store_order_funds_hold', { p_order_id: O.O2, p_hold: true, p_note: 'x' }), 'forbidden');
    const held = ok(rpc(store, 'set_store_order_funds_hold', { p_order_id: O.O2, p_hold: true, p_note: 'Disputa abierta' }, { userId: client(12), isSupport: true }));
    assert.equal(held.funds_hold, true);
    assert.equal(held.metadata_json.funds_hold_note, 'Disputa abierta');
});

test('vitrina y ficha públicas: la identidad y Mara Ink resuelven; el resto devuelve null', () => {
    const { store } = makeStore();
    const front = ok(rpc(store, 'get_public_storefront', { p_seller_type: 'artist', p_handle: 'DEMO.wo' }));
    assert.deepEqual([front.seller.type, front.seller.id, front.seller.handle, front.seller.name], ['artist', ME, 'demo.wo', 'Demo Artist']);
    assert.ok(front.settings.tagline);
    assert.deepEqual(front.products.map((p) => p.id).sort(), [P.D1, P.D2, P.M1, P.M2, P.M3].sort());
    const tee = front.products.find((p) => p.id === P.M1);
    assert.deepEqual(tee.variants.map((v) => [v.label, v.in_stock, v.low_stock]),
        [['Talle S', true, 4], ['Talle M', true, null], ['Talle L', false, 0], ['Talle XL', true, null]]);
    assert.equal(tee.price_from, 28000);
    const print = front.products.find((p) => p.id === P.M2);
    assert.equal(print.price_from, 28, 'mínimo entre variantes con override');
    const d1 = front.products.find((p) => p.id === P.D1);
    assert.equal(d1.price_from, 35);
    for (const key of ['id', 'kind', 'title', 'description', 'category', 'tags', 'currency', 'price_from', 'license_personal_price',
        'license_artist_price', 'license_exclusive_price', 'exclusive_available', 'reserved', 'licenses_issued', 'design_width_cm',
        'design_height_cm', 'design_style', 'placement_suggestion', 'images', 'shipping_price_amount', 'ships_to_countries',
        'ships_to_note', 'pickup_available', 'pickup_note', 'variants', 'published_at']) {
        assert.ok(key in d1, 'producto público con ' + key);
    }
    assert.ok(d1.images.every((img) => img.path && !('url' in img)));

    const mara = ok(rpc(store, 'get_public_storefront', { p_seller_type: 'artist', p_handle: 'mara-ink.wo' }));
    assert.deepEqual([mara.seller.id, mara.seller.name, mara.allow_search_indexing, mara.products.length], [MARA, 'Mara Ink', false, 3]);
    assert.equal(ok(rpc(store, 'get_public_store_product', { p_product_id: P.MD1 })).seller.handle, 'mara-ink.wo');
    assert.equal(rpc(store, 'get_public_storefront', { p_seller_type: 'artist', p_handle: 'otro.wo' }).body, null);
    assert.equal(rpc(store, 'get_public_storefront', { p_seller_type: 'studio', p_handle: 'mara-ink.wo' }).body, null);
    assert.equal(rpc(store, 'get_public_storefront', { p_seller_type: 'artist', p_handle: '' }).body, null);
    assert.equal(rpc(store, 'get_public_store_product', { p_product_id: sid(999) }).body, null);
});

/* ------------------------------ selects del repo ------------------------------ */

function loadRepo() {
    const win = { WeotziData: { run: async () => ({ data: null }), getClient: () => null }, WeotziStoreModel: M };
    vm.runInNewContext(read('public/shared/js/data/store-repo.js'), { window: win, console }, { filename: 'store-repo.js' });
    return win.WeotziData.Store;
}

test('las selects del repo (STORE_SELECTS) resuelven contra el emulador con las columnas y embeds de las fixtures', () => {
    const Store = loadRepo();
    const { fx, store } = makeStore();
    const selects = Store.STORE_SELECTS;
    assert.deepEqual(Object.keys(selects).sort(), Object.keys(Store.STORE_SELECT_TABLES).sort());
    for (const key of Object.keys(selects)) {
        const table = Store.STORE_SELECT_TABLES[key];
        const select = selects[key];
        assert.doesNotMatch(select, /\*/, key + ': columnas explícitas');
        const res = call(store, 'GET', table, '?select=' + enc(select));
        assert.equal(res.status, 200, key);
        assert.ok(res.body.length > 0, key + ' devuelve filas');
        for (const node of Postgrest.parseSelect(select)) {
            if (node.children) {
                const rel = fx.relations[table] && fx.relations[table][node.name];
                assert.ok(rel, key + ': relación ' + table + ' → ' + node.name);
                for (const child of node.children) {
                    assert.ok(fx.tables[rel.table].every((r) => Object.prototype.hasOwnProperty.call(r, child.name)), key + ': ' + rel.table + '.' + child.name + ' en las fixtures');
                }
            } else {
                assert.ok(fx.tables[table].every((r) => Object.prototype.hasOwnProperty.call(r, node.name)), key + ': ' + table + '.' + node.name + ' en las fixtures');
            }
        }
    }
    // store_payments solo con las columnas del grant a authenticated.
    assert.equal(selects.payment, 'id, order_id, provider, status, amount, currency, collected_by, reference, created_at');

    // Las consultas del repo, con sus filtros, sobre el demo.
    const orders = call(store, 'GET', 'store_orders', `?select=${enc(selects.orderFull)}&seller_type=eq.artist&seller_id=eq.${ME}&order=created_at.desc&limit=300`).body;
    assert.equal(orders.length, 6);
    const o4 = orders.find((o) => o.id === O.O4);
    assert.deepEqual([o4.store_order_items.length, o4.store_licenses.length, o4.store_payments.length], [1, 1, 1]);
    assert.equal(M.orderView(o4, { role: 'seller' }).license.status, 'used');
    const purchases = call(store, 'GET', 'store_orders', `?select=${enc(selects.orderFull)}&buyer_user_id=eq.${ME}&order=created_at.desc`).body;
    assert.deepEqual(purchases.map((o) => o.id), [O.P2, O.P1]);
    const products = call(store, 'GET', 'store_products', `?select=${enc(selects.productWithChildren)}&seller_type=eq.artist&seller_id=eq.${ME}`).body;
    assert.equal(products.find((p) => p.id === P.M1).store_product_variants.length, 5);
    assert.equal(products.find((p) => p.id === P.D2).store_design_assets.length, 2);
    const license = call(store, 'GET', 'store_licenses', `?select=${enc(selects.licenseWithOrder)}&id=eq.${sid(751)}`).body[0];
    assert.equal(license.store_orders.order_number, 'ST-0D9E4B7C');
    const settings = call(store, 'GET', 'store_seller_settings', `?select=${enc(selects.settings)}&seller_type=eq.artist&seller_id=eq.${ME}`).body;
    assert.equal(settings.length, 1);
    assert.ok(settings[0].payment_instructions && settings[0].contact_channel && settings[0].authorship_attested_at);
    const head = store.handle({ method: 'HEAD', path: 'store_products', search: '?select=id', headers: { prefer: 'count=exact' }, body: null, ctx: {} });
    assert.equal(head.status, 200, 'isAvailable() del repo ve la tabla en el demo');
});
