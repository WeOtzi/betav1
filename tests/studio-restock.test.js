// Reposición del panel de estudio (studio-dashboard-restock.js): funciones
// puras, HTML escapado, controlador (submit/cancel/receive + avisos) y un
// recorrido completo de la UI sobre un DOM falso que parsea innerHTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'public', 'shared', 'js', 'studio-dashboard-restock.js');
const CSS_PATH = path.join(ROOT, 'public', 'shared', 'css', 'studio-restock.css');
const restock = require(MODULE_PATH);
const kit = require(path.join(ROOT, 'public', 'shared', 'js', 'studio-admin-kit.js'));
const { estimateOrder } = require(path.join(ROOT, 'public', 'shared', 'js', 'data', 'supplies-repo.js'));
const source = fs.readFileSync(MODULE_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const plain = s => String(s).replace(/[  ]/g, ' ');
// Copia por valor (los objetos del realm de la VM no son deepStrictEqual con los de acá).
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

// -----------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------
function vendorRow(overrides = {}) {
    return {
        id: 'vend-1', name: 'Tintas Sur', slug: 'tintas-sur', logo_image: 'https://cdn.example.com/logo.png',
        currency: 'ARS', platform_discount_pct: 10, free_shipping_threshold: 50000, min_order_amount: 10000,
        ships_to_countries: ['AR'], benefits: ['Envío en 48 h', 'Muestras gratis'], is_verified: true, is_active: true,
        ...overrides
    };
}
function productRow(overrides = {}, vendor = vendorRow()) {
    return {
        id: 'prod-1', vendor_id: vendor.id, name: 'Tinta negra 8oz', brand: 'Dynamic', sku: 'TN-8', category: 'inks',
        unit_label: 'frasco', pack_size: null, price: 12000, currency: 'ARS', compare_at_price: 14000,
        min_order_qty: 1, stock_quantity: 50, image_url: 'https://cdn.example.com/tn.png', is_active: true,
        supply_vendors: vendor, ...overrides
    };
}
function memoryStorage() {
    const map = new Map();
    return {
        map,
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: k => { map.delete(k); }
    };
}

// -----------------------------------------------------------------
// Sugerencias
// -----------------------------------------------------------------
test('needsRestock usa la misma regla que la vista de salud (<= punto de reposición)', () => {
    assert.equal(restock.needsRestock({ quantity_on_hand: 3, reorder_level: 3 }), true);
    assert.equal(restock.needsRestock({ quantity_on_hand: 4, reorder_level: 3 }), false);
    assert.equal(restock.needsRestock({ quantity_on_hand: 0, reorder_level: null }), false);
    assert.equal(restock.needsRestock({ quantity_on_hand: null, reorder_level: 0 }), true);
});

test('restockSuggestions ordena por urgencia (stock relativo) y después por nombre', () => {
    const rows = restock.restockSuggestions([
        { id: 'a', name: 'Guantes', quantity_on_hand: 5, reorder_level: 10 },
        { id: 'b', name: 'Agujas', quantity_on_hand: 0, reorder_level: 4 },
        { id: 'c', name: 'Film', quantity_on_hand: 20, reorder_level: 10 },
        { id: 'd', name: 'Alcohol', quantity_on_hand: 0, reorder_level: 2 }
    ]);
    // empate en 0 de stock: por nombre (Agujas < Alcohol)
    assert.deepEqual(rows.map(r => r.id), ['b', 'd', 'a']);
});

test('suggestQuantity repone hasta el doble del punto, en packs y con el mínimo del producto', () => {
    assert.equal(restock.suggestQuantity({ quantity_on_hand: 1, reorder_level: 3 }, { pack_size: null, min_order_qty: 1 }), 5);
    // 2*10 - 2 = 18 unidades, packs de 5 → 4 packs
    assert.equal(restock.suggestQuantity({ quantity_on_hand: 2, reorder_level: 10 }, { pack_size: 5, min_order_qty: 1 }), 4);
    // mínimo de compra 6 packs
    assert.equal(restock.suggestQuantity({ quantity_on_hand: 2, reorder_level: 10 }, { pack_size: 5, min_order_qty: 6 }), 6);
    // ya cubierto: al menos 1
    assert.equal(restock.suggestQuantity({ quantity_on_hand: 50, reorder_level: 10 }, null), 1);
});

// -----------------------------------------------------------------
// Cobertura de envío
// -----------------------------------------------------------------
test('país de la sede: ISO-2 de la sede; sin sede, el del estudio; sede sin país = null', () => {
    assert.equal(restock.locationCountry({ country_code: 'ar' }), 'AR');
    assert.equal(restock.locationCountry({ country_code: null, country: 'UY' }), 'UY');
    assert.equal(restock.locationCountry({ country: 'Argentina' }, { country_code: 'AR' }), null);
    assert.equal(restock.locationCountry(null, { country_code: 'MX' }), 'MX');
});

test('shipsTo: lista vacía envía a todos; con lista exige el país de la sede', () => {
    assert.equal(restock.shipsTo({ ships_to_countries: [] }, null), true);
    assert.equal(restock.shipsTo({ ships_to_countries: ['AR', 'uy'] }, 'UY'), true);
    assert.equal(restock.shipsTo({ ships_to_countries: ['AR'] }, 'CL'), false);
    assert.equal(restock.shipsTo({ ships_to_countries: ['AR'] }, null), false);
});

test('filterCatalogByShipping oculta vendors sin cobertura y descarta los no verificados', () => {
    const ar = productRow();
    const uy = productRow({ id: 'prod-2' }, vendorRow({ id: 'vend-2', ships_to_countries: ['UY'] }));
    const all = productRow({ id: 'prod-3' }, vendorRow({ id: 'vend-3', ships_to_countries: [] }));
    const unverified = productRow({ id: 'prod-4' }, vendorRow({ id: 'vend-4', is_verified: false, ships_to_countries: [] }));
    const split = restock.filterCatalogByShipping([ar, uy, all, unverified], 'AR');
    assert.deepEqual(split.visible.map(p => p.id), ['prod-1', 'prod-3']);
    assert.deepEqual(split.hidden.map(p => p.id), ['prod-2']);
});

// -----------------------------------------------------------------
// Carrito y sessionStorage
// -----------------------------------------------------------------
test('sanitizeCartState descarta ids inválidos, duplicados y basura; repara cantidades', () => {
    const state = restock.sanitizeCartState({
        locationId: 'loc-1"><script>',
        carts: {
            'vend-1': {
                vendor: { name: 'Tintas', currency: 'ars', platform_discount_pct: 99, ships_to_countries: ['ar', 'Argentina'] },
                locationId: 'loc-1',
                notes: 'Entregar\nde tarde\u0000',
                lines: [
                    { product_id: 'prod-1', name: 'Tinta', price: 100, quantity: 2.555, min_order_qty: 1, inventory_item_id: 'item-1' },
                    { product_id: 'prod-1', name: 'Duplicada', price: 1, quantity: 9 },
                    { product_id: 'prod-2', name: 'Sin cantidad', price: 50, quantity: -1, min_order_qty: 3, inventory_item_id: 'x y' },
                    { product_id: '<img onerror>', price: 1, quantity: 1 },
                    'basura'
                ]
            },
            'bad id': { lines: [{ product_id: 'prod-9', quantity: 1 }] },
            'vend-2': { lines: [] }
        }
    });
    assert.equal(state.locationId, null);
    assert.deepEqual(Object.keys(state.carts), ['vend-1']);
    const cart = state.carts['vend-1'];
    assert.equal(cart.vendor.currency, 'ARS', 'la moneda se normaliza a ISO en mayúsculas');
    assert.equal(cart.vendor.platform_discount_pct, 60);
    assert.deepEqual(cart.vendor.ships_to_countries, ['AR']);
    assert.equal(cart.notes, 'Entregar\nde tarde');
    assert.deepEqual(cart.lines.map(l => [l.product_id, l.quantity, l.inventory_item_id]), [['prod-1', 2.56, 'item-1'], ['prod-2', 3, null]]);
    assert.deepEqual(restock.sanitizeCartState('no es un objeto'), { locationId: null, carts: {} });
});

test('load/saveCartState: ida y vuelta, JSON roto y borrado al quedar vacío', () => {
    const storage = memoryStorage();
    const state = { locationId: 'loc-1', carts: {} };
    restock.addToCart(state, productRow(), { quantity: 2, inventoryItemId: 'item-1' });
    assert.equal(restock.saveCartState(storage, 'k', state), true);
    const back = restock.loadCartState(storage, 'k');
    assert.equal(back.locationId, 'loc-1');
    assert.equal(back.carts['vend-1'].lines[0].quantity, 2);
    assert.equal(back.carts['vend-1'].locationId, 'loc-1');
    storage.setItem('k', '{roto');
    assert.deepEqual(restock.loadCartState(storage, 'k'), { locationId: null, carts: {} });
    restock.saveCartState(storage, 'k', { locationId: null, carts: {} });
    assert.equal(storage.map.has('k'), false);
    assert.deepEqual(restock.loadCartState(null, 'k'), { locationId: null, carts: {} });
    const throwing = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() {} };
    assert.deepEqual(restock.loadCartState(throwing, 'k'), { locationId: null, carts: {} });
    assert.equal(restock.saveCartState(throwing, 'k', state), false);
});

test('addToCart: un carrito por proveedor, suma cantidades y respeta el tope de líneas', () => {
    const state = { locationId: 'loc-1', carts: {} };
    const first = restock.addToCart(state, productRow(), { quantity: 2 });
    assert.equal(first.merged, false);
    const again = restock.addToCart(state, productRow(), { quantity: 1.5, inventoryItemId: 'item-1' });
    assert.equal(again.merged, true);
    assert.equal(again.line.quantity, 3.5);
    assert.equal(again.line.inventory_item_id, 'item-1');
    restock.addToCart(state, productRow({ id: 'prod-2' }, vendorRow({ id: 'vend-2', name: 'Agujas Norte' })), { quantity: 1 });
    assert.deepEqual(Object.keys(state.carts).sort(), ['vend-1', 'vend-2']);
    assert.equal(restock.cartLineCount(state), 2);
    assert.throws(() => restock.addToCart(state, productRow(), { quantity: 0 }), /mayor a 0/);
    const cart = state.carts['vend-1'];
    for (let i = cart.lines.length; i < restock.MAX_LINES; i++) cart.lines.push({ product_id: 'p-' + i, quantity: 1 });
    assert.throws(() => restock.addToCart(state, productRow({ id: 'prod-nuevo' }), { quantity: 1 }), /hasta 100 productos/);
});

test('orderItemsPayload: excluye líneas no disponibles y manda inventory_item_id solo si hay vínculo', () => {
    const cart = {
        lines: [
            { product_id: 'prod-1', quantity: 2.004, inventory_item_id: 'item-1' },
            { product_id: 'prod-2', quantity: 1, inventory_item_id: null },
            { product_id: 'prod-3', quantity: 1, unavailable: true },
            { product_id: 'prod-4', quantity: 0 }
        ]
    };
    assert.deepEqual(restock.orderItemsPayload(cart), [
        { product_id: 'prod-1', quantity: 2, inventory_item_id: 'item-1' },
        { product_id: 'prod-2', quantity: 1 }
    ]);
});

test('refreshCartFromCatalog marca precio actualizado, productos que ya no están y vendor no disponible', () => {
    const state = { locationId: null, carts: {} };
    restock.addToCart(state, productRow(), { quantity: 1 });
    restock.addToCart(state, productRow({ id: 'prod-2', name: 'Film' }), { quantity: 1 });
    const cart = state.carts['vend-1'];
    restock.refreshCartFromCatalog(cart, [productRow({ price: 13000 })], vendorRow());
    assert.equal(cart.lines[0].price, 13000);
    assert.equal(cart.lines[0].priceChanged, true);
    assert.equal(cart.lines[1].unavailable, true);
    assert.equal(cart.vendorUnavailable, false);
    restock.refreshCartFromCatalog(cart, [], null);
    assert.equal(cart.vendorUnavailable, true);
});

// -----------------------------------------------------------------
// Estimado y avisos del carrito
// -----------------------------------------------------------------
function cartWith(lines, vendor = vendorRow()) {
    const state = { locationId: 'loc-1', carts: {} };
    lines.forEach(([product, qty]) => restock.addToCart(state, product, { quantity: qty }));
    const cart = state.carts[vendor.id];
    cart.vendor = Object.assign(cart.vendor, restock.sanitizeCartState({ carts: { [vendor.id]: { vendor, lines: [{ product_id: 'x', quantity: 1 }] } } }).carts[vendor.id].vendor);
    return cart;
}

test('cartSummary: pedido mínimo bloquea el envío con el faltante por moneda', () => {
    const cart = cartWith([[productRow({ price: 3000 }), 2]]);
    const s = restock.cartSummary(cart, { kit, estimate: estimateOrder, tiers: [], country: 'AR' });
    assert.equal(s.canSubmit, false);
    assert.equal(s.estimate.subtotal, 6000);
    assert.ok(s.issues.some(t => /pedido mínimo de Tintas Sur es \$\s1\.000?0?/.test(plain(t)) || /pedido mínimo de Tintas Sur es/.test(t)));
    assert.match(plain(s.issues.join(' ')), /te faltan \$ 4\.000/);
});

test('cartSummary: envío gratis, descuento We Ötzi + volumen y próximo tier', () => {
    const tiers = [{ min_subtotal: 50000, currency: 'ARS', discount_pct: 5 }, { min_subtotal: 100000, currency: 'ARS', discount_pct: 8 }];
    const cart = cartWith([[productRow(), 5]]);   // 60.000
    const s = restock.cartSummary(cart, { kit, estimate: estimateOrder, tiers, country: 'AR' });
    assert.equal(s.canSubmit, true);
    assert.equal(s.estimate.pct, 15);
    assert.equal(s.estimate.total, 51000);
    assert.ok(s.notices.some(n => n.tone === 'success' && /Envío gratis/.test(n.text)));
    assert.ok(s.notices.some(n => /descuento por volumen del 8/.test(plain(n.text))));
    const html = restock.cartSummaryHtml(s, kit);
    assert.match(html, /Descuento \(We Ötzi 10[\s ]%  ?\+ volumen 5[\s ]%\)|Descuento \(We Ötzi 10.%.\+ volumen 5.%\)/);
    assert.match(plain(html), /Total estimado<\/dt><dd>\$ 51\.000/);

    const small = cartWith([[productRow(), 1]]);  // 12.000 − 10 % = 10.800
    const s2 = restock.cartSummary(small, { kit, estimate: estimateOrder, tiers: [], country: 'AR' });
    assert.ok(s2.notices.some(n => /Te faltan \$ 39\.200 para el envío gratis/.test(plain(n.text))));
});

test('cartSummary: sin cobertura en el país de la sede, stock y mínimo por línea bloquean', () => {
    const cart = cartWith([[productRow({ min_order_qty: 3, stock_quantity: 4 }), 5]]);
    const s = restock.cartSummary(cart, { kit, estimate: estimateOrder, tiers: [], country: 'CL' });
    assert.equal(s.canSubmit, false);
    assert.ok(s.issues.some(t => /no envía a/.test(t)));
    assert.deepEqual(s.lineIssues['prod-1'], ['Stock disponible: 4 frasco.']);
    cart.lines[0].quantity = 2;
    const s2 = restock.cartSummary(cart, { kit, estimate: estimateOrder, tiers: [], country: null });
    assert.deepEqual(s2.lineIssues['prod-1'], ['El mínimo es 3 frasco.']);
    assert.ok(s2.issues.some(t => /solo envía a .*Cargá el país de la sede/.test(t)));
});

// -----------------------------------------------------------------
// Pedidos
// -----------------------------------------------------------------
test('updatedTotalNotice: "Total actualizado por el proveedor: X (envío Y)" solo con envío confirmado', () => {
    const order = { status: 'confirmed', total: 56000, shipping_amount: 5000, currency: 'ARS' };
    assert.equal(plain(restock.updatedTotalNotice(order, kit)), 'Total actualizado por el proveedor: $ 56.000 (envío $ 5.000)');
    assert.equal(restock.updatedTotalNotice({ ...order, status: 'submitted' }, kit), null);
    assert.equal(restock.updatedTotalNotice({ ...order, shipping_amount: 0 }, kit), null);
    assert.ok(restock.updatedTotalNotice({ ...order, status: 'shipped' }, kit));
});

test('cancelar solo submitted/confirmed; recibir solo shipped/delivered', () => {
    const statuses = ['submitted', 'confirmed', 'rejected', 'shipped', 'delivered', 'received', 'cancelled'];
    assert.deepEqual(statuses.filter(s => restock.canCancel({ status: s })), ['submitted', 'confirmed']);
    assert.deepEqual(statuses.filter(s => restock.canReceive({ status: s })), ['shipped', 'delivered']);
    assert.deepEqual(restock.filterOrders(statuses.map(status => ({ status })), 'closed').map(o => o.status), ['rejected', 'cancelled']);
    assert.equal(restock.filterOrders(statuses.map(status => ({ status })), 'all').length, statuses.length);
});

test('receiveLinesPayload valida 0 ≤ recibido ≤ pedido y detecta parciales', () => {
    const items = [{ id: 'l1', quantity: 5 }, { id: 'l2', quantity: 2 }];
    assert.deepEqual(restock.receiveLinesPayload(items, { l1: '5', l2: '2' }), {
        lines: [{ item_id: 'l1', received_quantity: 5 }, { item_id: 'l2', received_quantity: 2 }], errors: {}, partial: false, nothing: false
    });
    const partial = restock.receiveLinesPayload(items, { l1: '3,5', l2: '0' });
    assert.equal(partial.partial, true);
    assert.deepEqual(partial.lines, [{ item_id: 'l1', received_quantity: 3.5 }, { item_id: 'l2', received_quantity: 0 }]);
    const bad = restock.receiveLinesPayload(items, { l1: '6', l2: '-1' });
    assert.deepEqual(Object.keys(bad.errors), ['l1', 'l2']);
    assert.equal(restock.receiveLinesPayload(items, { l1: '0', l2: '0' }).nothing, true);
});

test('summarizeReceiveResult normaliza faltantes, monedas distintas y gasto', () => {
    const r = restock.summarizeReceiveResult({
        order_id: 'o', partial: false, items: [{ product_name: 'Tinta' }], shortages: [{ product_name: 'Film', missing: 1 }],
        currency_mismatches: [null, { inventory_item_name: 'Agujas' }], expense: { amount: 100, currency: 'ARS' }
    });
    assert.equal(r.partial, true);
    assert.equal(r.mismatches.length, 1);
    assert.equal(r.expense.amount, 100);
    assert.equal(restock.summarizeReceiveResult(null).expense, null);
    assert.equal(restock.orderIdFrom({ order_id: 'order-1', id: 'x' }), 'order-1');
    assert.equal(restock.orderIdFrom([{ id: 'order-2' }]), 'order-2');
    assert.equal(restock.orderIdFrom(null), null);
});

// -----------------------------------------------------------------
// HTML
// -----------------------------------------------------------------
test('tarjeta del catálogo: precio, % We Ötzi, beneficios, envío gratis; escapa y filtra URLs', () => {
    const evil = vendorRow({ name: '<b>Tintas</b>', benefits: ['<img src=x onerror=alert(1)>'], logo_image: 'javascript:alert(1)' });
    const html = restock.catalogCardHtml(productRow({ name: 'Tinta "negra" <8oz>', image_url: 'javascript:alert(1)' }, evil), kit, { inCartQty: 2 });
    assert.ok(!html.includes('<b>Tintas</b>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('javascript:'));
    assert.match(html, /&lt;b&gt;Tintas&lt;\/b&gt;/);
    assert.match(html, /Tinta &quot;negra&quot; &lt;8oz&gt;/);
    assert.match(plain(html), /−10 % We Ötzi/);
    assert.match(plain(html), /Envío gratis desde \$ 50\.000/);
    assert.match(plain(html), /Pedido mínimo \$ 10\.000/);
    assert.match(plain(html), /<strong>\$ 12\.000<\/strong>/);
    assert.match(html, /<s>/);
    assert.match(html, /En el carrito: 2 frasco/);
    const ok = restock.catalogCardHtml(productRow(), kit);
    assert.match(ok, /src="https:\/\/cdn\.example\.com\/tn\.png"/);
    const out = restock.catalogCardHtml(productRow({ stock_quantity: 0 }), kit);
    assert.match(out, /Sin stock por ahora/);
    assert.match(out, /data-rs-action="add" data-product="prod-1" disabled/);
});

function fullOrder(overrides = {}) {
    return {
        id: 'order-1', order_number: 'P-2026-00001', status: 'confirmed', currency: 'ARS',
        subtotal: 60000, platform_discount_pct: 10, tier_discount_pct: 5, discount_amount: 9000, shipping_amount: 5000, total: 56000,
        notes: 'Tocar timbre', vendor_note: '<i>Sale el lunes</i>', tracking_code: null, estimated_delivery: '2026-11-03',
        submitted_at: '2026-10-30T12:00:00Z', confirmed_at: '2026-10-30T15:00:00Z',
        supply_vendors: { id: 'vend-1', name: 'Tintas <Sur>', contact_email: 'ventas@tintas.example', phone: '+54 11 5555' },
        studio_locations: { id: 'loc-1', label: 'Palermo', city: 'CABA' },
        supply_order_items: [
            { id: 'l1', product_name: 'Tinta negra 8oz', sku: 'TN-8', unit_label: 'frasco', pack_size: null, quantity: 5, unit_price: 12000, line_subtotal: 60000, line_discount: 9000, line_total: 51000, inventory_item_id: 'item-1', received_quantity: null }
        ],
        supply_order_events: [
            { id: 'e1', from_status: null, to_status: 'submitted', actor_role: 'studio', note: 'Pedido enviado', created_at: '2026-10-30T12:00:00Z' },
            { id: 'e2', from_status: 'submitted', to_status: 'confirmed', actor_role: 'vendor', note: '<script>x</script>', created_at: '2026-10-30T15:00:00Z' }
        ],
        ...overrides
    };
}

test('detalle del pedido: total actualizado, acciones por estado, eventos en español y escapado', () => {
    const html = restock.orderDetailHtml(fullOrder(), kit, { itemNames: new Map([['item-1', 'Tinta negra (estante)']]) });
    assert.match(plain(html), /Total actualizado por el proveedor: \$ 56\.000 \(envío \$ 5\.000\)/);
    assert.match(html, /data-rs-action="cancel-order"/);
    assert.ok(!html.includes('data-rs-action="receive-order"'));
    assert.match(html, /Solicitado/);
    assert.match(html, /Confirmado<\/strong> · Proveedor/);
    assert.match(html, /Inventario: Tinta negra \(estante\)/);
    assert.ok(!html.includes('<script>') && !html.includes('<i>Sale'));
    assert.match(html, /Tintas &lt;Sur&gt;/);
    assert.match(html, /Descuento \(We Ötzi 10.%.\+ volumen 5.%\)/);

    const shipped = restock.orderDetailHtml(fullOrder({ status: 'shipped', tracking_code: 'OCA-123' }), kit);
    assert.match(shipped, /data-rs-action="receive-order"/);
    assert.ok(!shipped.includes('data-rs-action="cancel-order"'));
    assert.match(shipped, /OCA-123/);

    const submitted = restock.orderDetailHtml(fullOrder({ status: 'submitted', shipping_amount: 0, total: 51000 }), kit);
    assert.ok(!submitted.includes('Total actualizado'));
    assert.match(submitted, /A confirmar por el proveedor/);
});

test('resultado de la recepción: faltantes, monedas distintas y gasto en Finanzas', () => {
    const html = restock.receiveResultHtml({
        partial: true,
        items: [{ product_name: 'Tinta', quantity: 5, received_quantity: 3, inventory_item_name: 'Tinta <negra>', created_item: true, units_added: 3, unit_cost: 10200, currency_mismatch: false }],
        shortages: [{ product_name: 'Tinta', quantity: 5, received_quantity: 3, missing: 2 }],
        currency_mismatches: [{ inventory_item_name: 'Agujas', item_currency: 'USD', order_currency: 'ARS' }],
        expense: { entry_id: 'f1', amount: 30600, currency: 'ARS' }
    }, kit);
    assert.match(html, /Recepción parcial/);
    assert.match(html, /Faltaron 2 de Tinta/);
    assert.match(html, /Agujas está en USD y el pedido en ARS/);
    assert.match(html, /Ítem nuevo/);
    assert.match(html, /Tinta &lt;negra&gt;/);
    assert.match(plain(html), /Gasto registrado en Finanzas: <strong>\$ 30\.600<\/strong>/);
    assert.match(restock.receiveResultHtml({ items: [], shortages: [] }, kit), /Pedido recibido/);
});

test('carrito HTML: botón deshabilitado si hay bloqueos y sede con placeholder si falta', () => {
    const cart = cartWith([[productRow({ price: 1000 }), 1]]);
    cart.locationId = null;
    const summary = restock.cartSummary(cart, { kit, estimate: estimateOrder, tiers: [], country: 'AR' });
    const html = restock.cartHtml(cart, summary, kit, {
        items: [{ id: 'item-1', name: 'Tinta <negra>', currency: 'USD' }],
        locations: [{ id: 'loc-1', label: 'Palermo' }]
    });
    assert.match(html, /data-rs-action="submit" disabled aria-disabled="true"/);
    assert.match(html, /<option value="" selected>Elegí una sede<\/option>/);
    assert.match(html, /Tinta &lt;negra&gt;/);
    assert.match(html, /Sin vincular \(se resuelve al recibir\)/);
});

// -----------------------------------------------------------------
// Controlador: servidor + avisos
// -----------------------------------------------------------------
function fakeSupplies(calls, overrides = {}) {
    return {
        estimateOrder,
        submitOrder: async args => { calls.push(['submitOrder', args]); return { data: { order_id: 'order-1', order_number: 'P-2026-00001' }, error: null }; },
        cancelOrder: async (id, note) => { calls.push(['cancelOrder', id, note]); return { data: { order_id: id, status: 'cancelled' }, error: null }; },
        receiveOrder: async (id, lines) => { calls.push(['receiveOrder', id, lines]); return { data: { order_id: id, partial: false, items: [] }, error: null }; },
        ...overrides
    };
}
function kitWithNotify(calls, result = { ok: true, sent: true }) {
    return { ...kit, postNotify: async (p, payload, client) => { calls.push(['notify', p, payload, client]); return result; } };
}

test('controller.submit: submitOrder con el payload del contrato, aviso order_submitted y carrito vaciado', async () => {
    const calls = [];
    const storage = memoryStorage();
    const client = { id: 'client' };
    const ctx = { studioId: 'studio-1', client, data: { Supplies: fakeSupplies(calls) } };
    const c = restock.createController(ctx, { kit: kitWithNotify(calls), storage });
    c.setLocation('loc-1');
    c.add(productRow(), { quantity: 5, inventoryItemId: 'item-1' });
    c.setCartField('vend-1', 'notes', '  Entregar de tarde  ');
    assert.ok(storage.getItem(restock.STORAGE_PREFIX + 'studio-1').includes('prod-1'));
    const r = await c.submit('vend-1');
    assert.deepEqual(calls[0], ['submitOrder', {
        studioId: 'studio-1', vendorId: 'vend-1', locationId: 'loc-1',
        items: [{ product_id: 'prod-1', quantity: 5, inventory_item_id: 'item-1' }], notes: 'Entregar de tarde'
    }]);
    assert.deepEqual(calls[1], ['notify', '/api/supplies/notify', { kind: 'order_submitted', order_id: 'order-1' }, client]);
    assert.equal(r.orderId, 'order-1');
    assert.equal(r.notified, true);
    assert.equal(c.cart('vend-1'), null);
    assert.ok(!storage.getItem(restock.STORAGE_PREFIX + 'studio-1').includes('prod-1'));
});

test('controller.submit: un error del servidor conserva el carrito y no avisa', async () => {
    const calls = [];
    const storage = memoryStorage();
    const ctx = { studioId: 's', data: { Supplies: fakeSupplies(calls, {
        submitOrder: async () => ({ data: null, error: { code: '23514', message: 'El pedido mínimo de Tintas es 10000.00 ARS.' } })
    }) } };
    const c = restock.createController(ctx, { kit: kitWithNotify(calls), storage });
    c.add(productRow(), { quantity: 1 });
    await assert.rejects(() => c.submit('vend-1'), err => err.code === '23514' && /pedido mínimo/.test(err.message));
    assert.ok(c.cart('vend-1'));
    assert.equal(calls.filter(x => x[0] === 'notify').length, 0);
});

test('controller.submit: si el aviso falla el pedido igual queda enviado (notified=false)', async () => {
    const calls = [];
    const ctx = { studioId: 's', data: { Supplies: fakeSupplies(calls) } };
    const c = restock.createController(ctx, { kit: kitWithNotify(calls, { ok: false, sent: false, status: 503 }), storage: memoryStorage() });
    c.add(productRow(), { quantity: 1 });
    const r = await c.submit('vend-1');
    assert.equal(r.notified, false);
    assert.equal(c.cart('vend-1'), null);
});

test('controller.cancel y controller.receive: RPC + avisos order_cancelled / order_received', async () => {
    const calls = [];
    const ctx = { studioId: 's', data: { Supplies: fakeSupplies(calls) } };
    const c = restock.createController(ctx, { kit: kitWithNotify(calls), storage: null });
    await c.cancel('order-1', '  ');
    await c.receive('order-1', [{ item_id: 'l1', received_quantity: 2 }]);
    assert.deepEqual(calls.map(x => x[0] === 'notify' ? x[2] : x.slice(0, 3)), [
        ['cancelOrder', 'order-1', null],
        { kind: 'order_cancelled', order_id: 'order-1' },
        ['receiveOrder', 'order-1', [{ item_id: 'l1', received_quantity: 2 }]],
        { kind: 'order_received', order_id: 'order-1' }
    ]);
});

test('controller sin Supplies (migración pendiente): mensaje en español', async () => {
    const c = restock.createController({ studioId: 's', data: {} }, { kit, storage: null });
    c.add(productRow(), { quantity: 1 });
    await assert.rejects(() => c.submit('vend-1'), /falta aplicar una migración/);
});

test('reconcileLocations: carritos con sedes que ya no existen pasan a la elegida', () => {
    const c = restock.createController({ studioId: 's', data: {} }, { kit, storage: memoryStorage() });
    c.setLocation('loc-vieja');
    c.add(productRow(), { quantity: 1 });
    assert.equal(c.cart('vend-1').locationId, 'loc-vieja');
    c.reconcileLocations(['loc-1', 'loc-2'], 'loc-2');
    assert.equal(c.state.locationId, 'loc-2');
    assert.equal(c.cart('vend-1').locationId, 'loc-2');
});

// -----------------------------------------------------------------
// DOM falso con parser de innerHTML (selectores simples, eventos con burbujeo)
// -----------------------------------------------------------------
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };
function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENTITIES[e] != null ? ENTITIES[e] : m;
    });
}
class TextNode {
    constructor(text) { this.nodeType = 3; this.data = text; this.parentNode = null; }
    get textContent() { return this.data; }
}
// Compuesto simple o descendiente ("[a] [b]"): el último tramo matchea el
// elemento y los anteriores, algún ancestro en orden.
function matchComplex(el, sel) {
    const parts = sel.split(/\s+/).filter(Boolean);
    if (!parts.length || !matchSimple(el, parts[parts.length - 1])) return false;
    let node = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
        while (node && node.nodeType === 1 && !matchSimple(node, parts[i])) node = node.parentNode;
        if (!node || node.nodeType !== 1) return false;
        node = node.parentNode;
    }
    return true;
}
function matchSimple(el, sel) {
    if (!sel) return false;
    const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(sel);
    let rest = tag ? sel.slice(tag[0].length) : sel;
    if (tag && el.localName !== tag[0].toLowerCase()) return false;
    while (rest) {
        const t = /^(?:\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\])/.exec(rest);
        if (!t) throw new Error('selector no soportado en el DOM falso: ' + sel);
        rest = rest.slice(t[0].length);
        if (t[1] && !el.className.split(/\s+/).includes(t[1])) return false;
        if (t[2] && el.getAttribute('id') !== t[2]) return false;
        if (t[3]) {
            if (!el.hasAttribute(t[3])) return false;
            if (t[4] !== undefined && el.getAttribute(t[3]) !== t[4]) return false;
        }
    }
    return true;
}
class El {
    constructor(tag, doc) {
        this.nodeType = 1;
        this.localName = tag.toLowerCase();
        this.tagName = tag.toUpperCase();
        this.attrs = new Map();
        this.childNodes = [];
        this.parentNode = null;
        this.listeners = {};
        this.ownerDocument = doc;
        this._value = undefined;
        this.style = {};
    }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
    setAttribute(n, v) { this.attrs.set(n, String(v)); }
    removeAttribute(n) { this.attrs.delete(n); }
    hasAttribute(n) { return this.attrs.has(n); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get classList() {
        const el = this;
        const list = () => el.className.split(/\s+/).filter(Boolean);
        const api = {
            contains: c => list().includes(c),
            add: (...cs) => { el.className = [...new Set([...list(), ...cs])].join(' '); },
            remove: (...cs) => { el.className = list().filter(x => !cs.includes(x)).join(' '); },
            toggle: (c, force) => { const on = force === undefined ? !list().includes(c) : !!force; if (on) api.add(c); else api.remove(c); return on; }
        };
        return api;
    }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get value() {
        if (this._value !== undefined) return this._value;
        if (this.localName === 'select') {
            const options = this.querySelectorAll('option');
            const sel = options.find(o => o.hasAttribute('selected')) || options[0];
            return sel ? sel.value : '';
        }
        if (this.localName === 'textarea') return this.textContent;
        if (this.localName === 'option') return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
        return this.getAttribute('value') || '';
    }
    set value(v) { this._value = String(v); }
    get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
    set textContent(v) {
        this.childNodes.forEach(c => { c.parentNode = null; });
        this.childNodes = [];
        if (v != null && v !== '') this.appendChild(new TextNode(String(v)));
    }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(html) {
        this.childNodes.forEach(c => { c.parentNode = null; });
        this.childNodes = [];
        parseInto(this, String(html), this.ownerDocument);
    }
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
    removeChild(n) { this.childNodes = this.childNodes.filter(c => c !== n); n.parentNode = null; return n; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { for (let c = n; c; c = c.parentNode) if (c === this) return true; return false; }
    get isConnected() { let top = this; while (top.parentNode) top = top.parentNode; return top === this.ownerDocument.body; }
    matches(sel) { return sel.split(',').some(s => matchComplex(this, s.trim())); }
    closest(sel) { for (let el = this; el && el.nodeType === 1; el = el.parentNode) if (el.matches(sel)) return el; return null; }
    querySelectorAll(sel) {
        const out = [];
        const walk = n => n.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); });
        walk(this);
        return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
    dispatchEvent(evt) {
        if (!evt.target) evt.target = this;
        for (let el = this; el; el = el.parentNode) {
            evt.currentTarget = el;
            ((el.listeners && el.listeners[evt.type]) || []).slice().forEach(fn => fn.call(el, evt));
            if (evt._stop) break;
        }
        return !evt.defaultPrevented;
    }
    click() { this.dispatchEvent(makeEvent('click')); }
    focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
}
function makeEvent(type) {
    return { type, target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; } };
}
function serialize(n) {
    if (n.nodeType === 3) return n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const attrs = [...n.attrs].map(([k, v]) => (v === '' ? ' ' + k : ' ' + k + '="' + v.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"')).join('');
    if (VOID.has(n.localName)) return '<' + n.localName + attrs + '>';
    return '<' + n.localName + attrs + '>' + n.childNodes.map(serialize).join('') + '</' + n.localName + '>';
}
function parseInto(parent, html, doc) {
    const stack = [parent];
    const re = /<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        const top = stack[stack.length - 1];
        if (m[1]) {
            const name = m[1].toLowerCase();
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].localName === name) { stack.length = i; break; }
            }
        } else if (m[2]) {
            const el = new El(m[2], doc);
            const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
            let a;
            while ((a = attrRe.exec(m[3] || ''))) el.attrs.set(a[1].toLowerCase(), decode(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : ''));
            top.appendChild(el);
            if (!VOID.has(el.localName)) stack.push(el);
        } else if (m[4]) {
            top.appendChild(new TextNode(decode(m[4])));
        }
    }
}
function fakeDocument() {
    const doc = { events: [], listeners: {}, activeElement: null };
    doc.body = new El('body', doc);
    doc.createElement = tag => new El(tag, doc);
    doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
    doc.dispatchEvent = evt => {
        doc.events.push(evt);
        (doc.listeners[evt.type] || []).slice().forEach(fn => fn(evt));
        return true;
    };
    doc.getElementById = id => doc.body.querySelector('#' + id);
    return doc;
}
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

test('el DOM falso parsea, consulta y burbujea eventos', () => {
    const doc = fakeDocument();
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    host.innerHTML = '<div data-a="1"><button type="button" data-rs-action="x" disabled>Hola &amp; chau</button><input value="3" data-q></div><select><option value="a">A</option><option value="b" selected>B</option></select>';
    const btn = host.querySelector('[data-rs-action="x"]');
    assert.equal(btn.textContent, 'Hola & chau');
    assert.equal(btn.disabled, true);
    assert.equal(host.querySelector('[data-q]').value, '3');
    assert.equal(host.querySelector('select').value, 'b');
    let seen = null;
    host.addEventListener('click', e => { seen = e.target.closest('[data-a]'); });
    btn.click();
    assert.equal(seen.getAttribute('data-a'), '1');
    assert.equal(btn.isConnected, true);
});

// -----------------------------------------------------------------
// Recorrido de la UI: registro → montaje → sugerencia → carrito →
// envío → recepción → drawer por navigate({order}) → cancelación
// -----------------------------------------------------------------
function harness() {
    const doc = fakeDocument();
    const root = doc.createElement('div');
    root.setAttribute('data-module-root', '');
    doc.body.appendChild(root);
    const calls = [];
    const toasts = [];
    const modals = [];
    const drawers = [];
    const badges = [];
    const navs = [];
    const storage = memoryStorage();
    const vendor = vendorRow();
    const product = productRow({}, vendor);
    const otherVendor = vendorRow({ id: 'vend-2', name: 'Uruguay Supplies', ships_to_countries: ['UY'] });
    const items = [
        { id: 'item-1', name: 'Tinta negra', sku: 'TN', unit: 'frasco', quantity_on_hand: 1, reorder_level: 3, currency: 'ARS', supply_product_id: 'prod-1', supply_products: { id: 'prod-1', name: 'Tinta negra 8oz', price: 12000, currency: 'ARS', vendor_id: 'vend-1', unit_label: 'frasco', pack_size: null } },
        { id: 'item-2', name: 'Guantes <nitrilo>', unit: 'caja', quantity_on_hand: 0, reorder_level: 2, currency: 'ARS', supply_product_id: null, supply_products: null },
        { id: 'item-3', name: 'Film', unit: 'rollo', quantity_on_hand: 9, reorder_level: 2, currency: 'ARS' }
    ];
    const orders = [];
    let currentOrder = null;
    const Supplies = {
        estimateOrder,
        listVendors: async () => { calls.push(['listVendors']); return { data: [vendor, otherVendor], error: null }; },
        listOrdersForStudio: async (sid, opts) => { calls.push(['listOrdersForStudio', sid, clone(opts || null)]); const st = opts && opts.status; return { data: st ? orders.filter(o => st.includes(o.status)) : orders.slice(), error: null }; },
        searchCatalog: async args => {
            calls.push(['searchCatalog', clone(args)]);
            const all = [product, productRow({ id: 'prod-uy', name: 'Aguja UY' }, otherVendor)];
            return { data: args.vendorId ? all.filter(p => p.vendor_id === args.vendorId) : all, error: null };
        },
        listTiers: async vid => { calls.push(['listTiers', vid]); return { data: [], error: null }; },
        submitOrder: async args => {
            calls.push(['submitOrder', clone(args)]);
            orders.push({ id: 'order-1', order_number: 'P-2026-00001', status: 'shipped', currency: 'ARS', total: 54000, shipping_amount: 0, submitted_at: '2026-10-30T12:00:00Z', supply_vendors: { id: 'vend-1', name: 'Tintas Sur' }, studio_locations: { id: 'loc-1', label: 'Palermo' } });
            return { data: { order_id: 'order-1', order_number: 'P-2026-00001', status: 'submitted' }, error: null };
        },
        getOrder: async id => { calls.push(['getOrder', id]); return { data: currentOrder && currentOrder.id === id ? currentOrder : null, error: null }; },
        cancelOrder: async (id, note) => { calls.push(['cancelOrder', id, note]); if (currentOrder) currentOrder = { ...currentOrder, status: 'cancelled' }; return { data: { order_id: id }, error: null }; },
        receiveOrder: async (id, lines) => {
            calls.push(['receiveOrder', id, clone(lines)]);
            const o = orders.find(x => x.id === id);
            if (o) o.status = 'received';
            return {
                data: {
                    order_id: id, order_number: 'P-2026-00001', partial: true,
                    items: [{ product_name: 'Tinta negra 8oz', quantity: 5, received_quantity: 2, inventory_item_name: 'Tinta negra', units_added: 2, unit_cost: 10800, currency_mismatch: false }],
                    shortages: [{ product_name: 'Tinta negra 8oz', quantity: 5, received_quantity: 2, missing: 3 }],
                    currency_mismatches: [],
                    expense: { entry_id: 'f1', amount: 21600, currency: 'ARS' }
                },
                error: null
            };
        }
    };
    const data = {
        StudioLocations: { listActiveByStudio: async (sid, cols) => { calls.push(['listActiveByStudio', sid, cols]); return { data: [{ id: 'loc-1', label: 'Palermo', city: 'CABA', country: 'Argentina', country_code: 'AR', is_primary: true }], error: null }; } },
        StudioOps: { listRestockCandidates: async sid => { calls.push(['listRestockCandidates', sid]); return { data: items, error: null }; } },
        Supplies
    };
    const testKit = {
        ...kit,
        toast: (msg, tone) => { toasts.push([String(msg), tone]); return { el: null, close() {} }; },
        confirmDialog: async opts => { calls.push(['confirm', opts.title]); return true; },
        promptDialog: async opts => { calls.push(['prompt', opts.title]); return 'Lo conseguimos en otro lado'; },
        postNotify: async (p, payload) => { calls.push(['notify', p, clone(payload)]); return { ok: true, sent: true }; },
        openModal: opts => {
            const body = doc.createElement('div');
            body.innerHTML = typeof opts.body === 'string' ? opts.body : '';
            let resolve;
            const closed = new Promise(r => { resolve = r; });
            const m = { opts, body, errors: [], setError(msg) { m.errors.push(msg); }, close(v) { resolve(v === undefined ? null : v); }, closed };
            modals.push(m);
            return m;
        },
        openDrawer: opts => {
            const body = doc.createElement('div');
            doc.body.appendChild(body);
            body.innerHTML = opts.body;
            const d = { opts, body, title: opts.title, setTitle(t) { d.title = t; }, close() { body.remove(); if (opts.onClose) opts.onClose(); } };
            drawers.push(d);
            return d;
        }
    };
    let registered = null;
    let resolveCtx;
    const ctxReady = new Promise(r => { resolveCtx = r; });
    const win = {
        WeOtziStudioAdmin: { register: (tab, def) => { registered = { tab, def }; return true; }, getContext: () => ctxReady },
        WeotziData: data,
        sessionStorage: storage,
        document: doc,
        console,
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
    };
    vm.runInNewContext(source, { window: win, console, setTimeout, clearTimeout });
    const ctx = {
        studio: { id: 'studio-1', name: 'Estudio', country_code: 'AR' },
        studioId: 'studio-1', userId: 'u1', client: {}, data, kit: testKit,
        navigate: (tab, params) => navs.push([tab, params || null]),
        setBadge: (tab, n) => badges.push([tab, n]),
        notify: async () => ({ ok: true }), refresh: async () => {}
    };
    return { doc, root, calls, toasts, modals, drawers, badges, navs, storage, orders, ctx, resolveCtx, get registered() { return registered; }, setOrder(o) { currentOrder = o; } };
}

test('se registra en WeOtziStudioAdmin como "reposicion" y calcula el badge por recibir al iniciar', async () => {
    const h = harness();
    assert.equal(h.registered.tab, 'reposicion');
    assert.equal(typeof h.registered.def.mount, 'function');
    assert.equal(typeof h.registered.def.show, 'function');
    h.orders.push({ id: 'o1', status: 'shipped' }, { id: 'o2', status: 'delivered' }, { id: 'o3', status: 'submitted' });
    h.resolveCtx(h.ctx);
    await flush();
    // El array viene del realm de la VM: se compara por valor.
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c => c[0] === 'listOrdersForStudio'))), ['listOrdersForStudio', 'studio-1', { status: ['shipped', 'delivered'] }]);
    assert.deepEqual(h.badges, [['reposicion', 2]]);
});

test('recorrido completo de la pestaña Reposición', async () => {
    const h = harness();
    const { root, calls } = h;
    await h.registered.def.mount(root, h.ctx);
    await h.registered.def.show(root, h.ctx, {});

    // Sugerencias por defecto: dos ítems por reponer, el más urgente primero, escapados.
    const suggestions = root.querySelector('[data-rs-region="view"]').innerHTML;
    assert.match(suggestions, /Guantes &lt;nitrilo&gt;/);
    assert.ok(suggestions.indexOf('Guantes') < suggestions.indexOf('Tinta negra'));
    assert.ok(!suggestions.includes('>Film<'));
    assert.match(suggestions, /data-rs-action="suggest-add" data-item="item-1"/);
    assert.match(suggestions, /data-rs-action="suggest-search" data-item="item-2"/);
    assert.equal(root.querySelector('[data-rs-global-location]').value, 'loc-1');
    assert.ok(calls.some(c => c[0] === 'listActiveByStudio' && /country_code/.test(c[2])));

    // Agregar desde la sugerencia: carrito del vendor con el ítem vinculado y la cantidad sugerida.
    root.querySelector('[data-rs-action="suggest-add"]').click();
    await flush();
    const key = 'weotzi:studio-restock:v1:studio-1';
    let saved = JSON.parse(h.storage.getItem(key));
    assert.deepEqual(saved.carts['vend-1'].lines.map(l => [l.product_id, l.quantity, l.inventory_item_id]), [['prod-1', 5, 'item-1']]);
    assert.equal(saved.carts['vend-1'].locationId, 'loc-1');
    assert.ok(h.toasts.some(([m, t]) => t === 'success' && /Agregamos 5 frasco de Tinta negra 8oz al carrito de Tintas Sur/.test(m)));
    assert.match(root.querySelector('[data-rs-region="tabs"]').innerHTML, /Carrito <span class="sk-chip-count">\(1\)<\/span>/);

    // Catálogo: el vendor sin cobertura en AR queda oculto; agregar suma al carrito existente.
    root.querySelector('[data-rs-action="view"][data-view="catalogo"]').click();
    await flush();
    const results = root.querySelector('[data-rs-region="catalog-results"]');
    assert.ok(results.querySelector('[data-rs-product="prod-1"]'));
    assert.equal(results.querySelector('[data-rs-product="prod-uy"]'), null);
    assert.match(results.innerHTML, /1 producto oculto porque su proveedor no envía a/);
    assert.match(results.innerHTML, /En el carrito: 5 frasco/);
    const card = results.querySelector('[data-rs-product="prod-1"]');
    card.querySelector('[data-rs-qty]').value = '2';
    card.querySelector('[data-rs-action="add"]').click();
    saved = JSON.parse(h.storage.getItem(key));
    assert.equal(saved.carts['vend-1'].lines[0].quantity, 7);
    assert.equal(card.querySelector('[data-rs-incart]').textContent, 'En el carrito: 7 frasco');

    // Carrito: revalida con el catálogo del vendor + tiers y muestra el estimado.
    root.querySelector('[data-rs-action="view"][data-view="carrito"]').click();
    await flush();
    assert.ok(calls.some(c => c[0] === 'searchCatalog' && c[1].vendorId === 'vend-1' && !c[1].limit));
    assert.ok(calls.some(c => c[0] === 'listTiers' && c[1] === 'vend-1'));
    let section = root.querySelector('[data-rs-cart="vend-1"]');
    assert.ok(section);
    assert.match(plain(section.querySelector('[data-rs-cart-summary]').innerHTML), /Total estimado<\/dt><dd>\$ 75\.600/);
    assert.equal(section.querySelector('[data-rs-action="submit"]').disabled, false);

    // Cantidad 0: aviso en la línea y botón deshabilitado, sin repintar todo.
    const qty = section.querySelector('[data-rs-line="prod-1"] [data-rs-field="quantity"]');
    qty.value = '0';
    qty.dispatchEvent(makeEvent('input'));
    assert.equal(root.querySelector('[data-rs-cart="vend-1"]'), section, 'no repinta la sección');
    assert.equal(section.querySelector('[data-rs-line-issue]').hidden, false);
    assert.match(section.querySelector('[data-rs-line-issue]').textContent, /mayor a 0/);
    assert.equal(section.querySelector('[data-rs-action="submit"]').disabled, true);
    qty.value = '5';
    qty.dispatchEvent(makeEvent('input'));
    assert.equal(section.querySelector('[data-rs-action="submit"]').disabled, false);
    assert.match(plain(section.querySelector('[data-rs-line="prod-1"] [data-rs-line-total]').textContent), /\$ 60\.000/);

    // Vincular a otro ítem y escribir notas (persisten en sessionStorage).
    const link = section.querySelector('[data-rs-field="inventory_item_id"]');
    link.value = 'item-3';
    link.dispatchEvent(makeEvent('change'));
    const notes = section.querySelector('[data-rs-field="notes"]');
    notes.value = 'Entregar de tarde';
    notes.dispatchEvent(makeEvent('input'));
    saved = JSON.parse(h.storage.getItem(key));
    assert.equal(saved.carts['vend-1'].lines[0].inventory_item_id, 'item-3');
    assert.equal(saved.carts['vend-1'].notes, 'Entregar de tarde');

    // Enviar: confirm → submitOrder → aviso order_submitted → Mis pedidos.
    section.querySelector('[data-rs-action="submit"]').click();
    await flush();
    assert.deepEqual(calls.find(c => c[0] === 'submitOrder')[1], {
        studioId: 'studio-1', vendorId: 'vend-1', locationId: 'loc-1',
        items: [{ product_id: 'prod-1', quantity: 5, inventory_item_id: 'item-3' }], notes: 'Entregar de tarde'
    });
    assert.deepEqual(calls.find(c => c[0] === 'notify'), ['notify', '/api/supplies/notify', { kind: 'order_submitted', order_id: 'order-1' }]);
    assert.ok(h.toasts.some(([m]) => /Pedido P-2026-00001 enviado a Tintas Sur/.test(m)));
    assert.equal(JSON.parse(h.storage.getItem(key)).carts['vend-1'], undefined);
    assert.equal(root.querySelector('[data-rs-action="view"][data-view="pedidos"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(h.badges[h.badges.length - 1], ['reposicion', 1]);

    // Recibir desde la tabla: modal con cantidades por línea.
    h.setOrder({ ...fullOrder({ status: 'shipped', shipping_amount: 0, total: 51000 }) });
    root.querySelector('[data-rs-action="receive-order"][data-order="order-1"]').click();
    await flush();
    const modal = h.modals[0];
    assert.match(modal.opts.title, /Recibir pedido P-2026-00001/);
    const input = modal.body.querySelector('[data-rs-receive="l1"]');
    assert.equal(input.value, '5');
    input.value = '7';
    assert.equal(await modal.opts.actions[1].onClick(modal), false, 'más de lo pedido no se envía');
    assert.match(modal.errors[0], /No puede superar lo pedido/);
    input.value = '2';
    const r = await modal.opts.actions[1].onClick(modal);
    modal.close(r);
    await flush();
    assert.deepEqual(calls.find(c => c[0] === 'receiveOrder'), ['receiveOrder', 'order-1', [{ item_id: 'l1', received_quantity: 2 }]]);
    assert.ok(calls.some(c => c[0] === 'notify' && c[2].kind === 'order_received' && c[2].order_id === 'order-1'));
    const result = h.modals[1];
    assert.equal(result.opts.title, 'Recepción parcial');
    assert.match(result.body.innerHTML, /Faltaron 3 de Tinta negra 8oz/);
    assert.ok(result.opts.actions.some(a => a.label === 'Ver en Finanzas'));
    assert.ok(h.doc.events.some(e => e.type === 'weotzi:studio-inventory-changed' && e.detail.source === 'restock' && e.detail.order_id === 'order-1'));
    assert.ok(h.doc.events.some(e => e.type === 'weotzi:studio-finance-changed' && e.detail.source === 'restock' && e.detail.entry_id === 'f1'),
        'Finanzas y Reportes se enteran del gasto nuevo');
    assert.deepEqual(h.badges[h.badges.length - 1], ['reposicion', 0]);

    // navigate('reposicion', {order}) abre el drawer; confirmado con envío → total actualizado.
    h.setOrder(fullOrder({ id: 'order-2', order_number: 'P-2026-00002' }));
    await h.registered.def.show(root, h.ctx, { order: 'order-2' });
    await flush();
    const drawer = h.drawers[0];
    assert.equal(drawer.title, 'Pedido P-2026-00002');
    assert.match(plain(drawer.body.innerHTML), /Total actualizado por el proveedor: \$ 56\.000 \(envío \$ 5\.000\)/);

    // Cancelar desde el drawer: motivo → cancel_supply_order → aviso order_cancelled → drawer refrescado.
    drawer.body.querySelector('[data-rs-action="cancel-order"]').click();
    await flush();
    assert.deepEqual(calls.find(c => c[0] === 'cancelOrder'), ['cancelOrder', 'order-2', 'Lo conseguimos en otro lado']);
    assert.ok(calls.some(c => c[0] === 'notify' && c[2].kind === 'order_cancelled' && c[2].order_id === 'order-2'));
    assert.match(drawer.body.innerHTML, /Cancelado/);
    assert.ok(!drawer.body.innerHTML.includes('data-rs-action="cancel-order"'));

    // "Buscar en el catálogo" desde una sugerencia sin vínculo precarga la búsqueda.
    root.querySelector('[data-rs-action="view"][data-view="sugerencias"]').click();
    root.querySelector('[data-rs-action="suggest-search"][data-item="item-2"]').click();
    await flush();
    assert.equal(root.querySelector('[data-rs-catalog="search"]').value, 'Guantes <nitrilo>');
    assert.match(root.querySelector('[data-rs-region="link-banner"]').innerHTML, /Buscando para <strong>Guantes &lt;nitrilo&gt;<\/strong>/);
    assert.ok(calls.some(c => c[0] === 'searchCatalog' && c[1].search === 'Guantes <nitrilo>' && c[1].limit === 120));
    assert.ok(!h.toasts.some(([, t]) => t === 'danger'), 'sin errores en el recorrido: ' + JSON.stringify(h.toasts));
});

test('sin la migración M5 la pestaña degrada con el aviso y deja ver las sugerencias', async () => {
    const h = harness();
    h.ctx.data.Supplies.listVendors = async () => ({ data: [], error: null, unavailable: true });
    h.ctx.data.Supplies.listOrdersForStudio = async () => ({ data: [], error: null, unavailable: true });
    await h.registered.def.mount(h.root, h.ctx);
    assert.match(h.root.querySelector('[data-rs-region="banner"]').innerHTML, /falta aplicar una migración/);
    const view = h.root.querySelector('[data-rs-region="view"]').innerHTML;
    assert.match(view, /Tinta negra/);
    assert.ok(!view.includes('data-rs-action="suggest-add"'));
    h.root.querySelector('[data-rs-action="view"][data-view="pedidos"]').click();
    assert.match(h.root.querySelector('[data-rs-region="view"]').innerHTML, /Pedidos no disponibles/);
});

test('con pedidos por recibir arranca en Mis pedidos', async () => {
    const h = harness();
    h.orders.push({ id: 'order-9', order_number: 'P-2026-00009', status: 'delivered', currency: 'ARS', total: 1000, shipping_amount: 0, supply_vendors: { name: 'Tintas Sur' } });
    await h.registered.def.mount(h.root, h.ctx);
    assert.equal(h.root.querySelector('[data-rs-action="view"][data-view="pedidos"]').getAttribute('aria-pressed'), 'true');
    assert.match(h.root.querySelector('[data-rs-region="view"]').innerHTML, /data-rs-action="receive-order" data-order="order-9"/);
});

// -----------------------------------------------------------------
// Ajustes de la auditoría: parámetros de navigate, tope del 60 %, sede
// obligatoria, eventos entre módulos, foco y flujos sin cubrir.
// -----------------------------------------------------------------
const pressedView = (h, view) => h.root.querySelector('[data-rs-action="view"][data-view="' + view + '"]').getAttribute('aria-pressed');
const viewHtml = h => h.root.querySelector('[data-rs-region="view"]').innerHTML;
const STORAGE_KEY = 'weotzi:studio-restock:v1:studio-1';

test('parseShowParams: order, view y filter válidos; el resto se ignora', () => {
    assert.deepEqual(restock.parseShowParams({ order: 'order-1', view: 'carrito', filter: 'received' }), { orderId: 'order-1', view: 'carrito', filter: 'received' });
    assert.deepEqual(restock.parseShowParams({ order: 'x y', view: 'otra', filter: 'toString' }), { orderId: null, view: null, filter: null });
    assert.deepEqual(restock.parseShowParams(null), { orderId: null, view: null, filter: null });
});

test('descuento con tope del 60 %: muestra el volumen efectivo y no promete tiers que no suman', () => {
    const vendor = vendorRow({ platform_discount_pct: 55 });
    const tiers = [{ min_subtotal: 10000, currency: 'ARS', discount_pct: 10 }, { min_subtotal: 100000, currency: 'ARS', discount_pct: 20 }];
    const cart = cartWith([[productRow({}, vendor), 5]], vendor);   // 60.000 → 55 + 10 = 65 → 60
    const s = restock.cartSummary(cart, { kit, estimate: estimateOrder, tiers, country: 'AR' });
    assert.equal(s.estimate.pct, 60);
    assert.equal(restock.effectiveTierPct(s.estimate), 5);
    assert.equal(restock.nextTier(tiers, s.estimate, 'ARS'), null, 'el tier de 20 % no mejora un 60 %');
    assert.ok(!s.notices.some(n => /descuento por volumen/.test(n.text)));
    assert.match(plain(restock.cartSummaryHtml(s, kit)), /Descuento \(We Ötzi 55 % \+ volumen 5 %\)/);
    assert.equal(restock.effectiveTierPct(null), 0);
});

test('cartSummary: con sedes cargadas exige elegir la sede (sin confundir con la cobertura)', () => {
    const cart = cartWith([[productRow(), 5]]);
    const s = restock.cartSummary(cart, { kit, estimate: estimateOrder, tiers: [], country: null, locationMissing: true });
    assert.equal(s.canSubmit, false);
    assert.ok(s.issues.includes('Elegí la sede de entrega del pedido.'));
    assert.ok(!s.issues.some(t => /envía a/.test(t)));
});

test('receiveLinesPayload: el tope se muestra con coma decimal', () => {
    const r = restock.receiveLinesPayload([{ id: 'l1', quantity: 2.5 }], { l1: '3' });
    assert.equal(r.errors.l1, 'No puede superar lo pedido (2,5).');
});

test('show({view|filter|order}) elige sección y filtro; un pedido recibido pasa la tabla a "Todos"', async () => {
    const h = harness();
    h.orders.push({ id: 'order-r', order_number: 'P-2026-00010', status: 'received', currency: 'ARS', total: 1000, shipping_amount: 0, supply_vendors: { name: 'Tintas Sur' } });
    await h.registered.def.mount(h.root, h.ctx);
    assert.equal(pressedView(h, 'sugerencias'), 'true');

    await h.registered.def.show(h.root, h.ctx, { view: 'carrito' });
    assert.equal(pressedView(h, 'carrito'), 'true');
    assert.match(viewHtml(h), /Tu carrito está vacío/);

    await h.registered.def.show(h.root, h.ctx, { view: 'nada' });
    assert.equal(pressedView(h, 'carrito'), 'true', 'una sección inválida se ignora');

    await h.registered.def.show(h.root, h.ctx, { filter: 'received' });
    assert.equal(pressedView(h, 'pedidos'), 'true');
    assert.equal(h.root.querySelector('[data-rs-action="order-filter"][data-filter="received"]').getAttribute('aria-pressed'), 'true');
    assert.match(viewHtml(h), /P-2026-00010/);

    h.root.querySelector('[data-rs-action="order-filter"][data-filter="active"]').click();
    assert.ok(!viewHtml(h).includes('P-2026-00010'));

    // Desde Finanzas: navigate('reposicion', {order}) de un pedido ya recibido.
    h.setOrder(fullOrder({
        id: 'order-r', order_number: 'P-2026-00010', status: 'received', shipping_amount: 0, total: 51000, received_at: '2026-10-31T10:00:00Z',
        receive_result: { order_id: 'order-r', partial: false, items: [], shortages: [], currency_mismatches: [], expense: { entry_id: 'f9', amount: 51000, currency: 'ARS' } }
    }));
    await h.registered.def.show(h.root, h.ctx, { order: 'order-r' });
    await flush();
    assert.equal(h.root.querySelector('[data-rs-action="order-filter"][data-filter="all"]').getAttribute('aria-pressed'), 'true');
    assert.match(viewHtml(h), /P-2026-00010/);
    const drawer = h.drawers[0];
    assert.equal(drawer.title, 'Pedido P-2026-00010');
    assert.match(drawer.body.innerHTML, /Pedido recibido: el inventario quedó repuesto/);
    drawer.body.querySelector('[data-rs-action="go-finance"]').click();
    assert.deepEqual(h.navs[h.navs.length - 1], ['finanzas', null]);
    assert.equal(drawer.body.isConnected, false, 'el drawer se cierra al ir a Finanzas');
});

test('un cambio de inventario en otro módulo recarga las sugerencias en la próxima visita', async () => {
    const h = harness();
    const loads = () => h.calls.filter(c => c[0] === 'listRestockCandidates').length;
    await h.registered.def.mount(h.root, h.ctx);
    await h.registered.def.show(h.root, h.ctx, {});
    assert.equal(loads(), 1);
    h.doc.dispatchEvent({ type: 'weotzi:studio-inventory-changed', detail: { source: 'restock' } });
    await h.registered.def.show(h.root, h.ctx, {});
    assert.equal(loads(), 1, 'los avisos propios no recargan');
    h.doc.dispatchEvent({ type: 'weotzi:studio-inventory-changed', detail: { source: 'inventory' } });
    await h.registered.def.show(h.root, h.ctx, {});
    assert.equal(loads(), 2);
    await h.registered.def.show(h.root, h.ctx, {});
    assert.equal(loads(), 2);
});

test('agregar una sugerencia de un proveedor que no envía a la sede avisa y el carrito bloquea el envío', async () => {
    const h = harness();
    h.ctx.data.StudioOps.listRestockCandidates = async () => ({
        data: [{ id: 'item-uy', name: 'Aguja', unit: 'caja', quantity_on_hand: 0, reorder_level: 2, currency: 'ARS', supply_product_id: 'prod-uy', supply_products: { id: 'prod-uy', name: 'Aguja UY', price: 12000, currency: 'ARS', vendor_id: 'vend-2', unit_label: 'frasco', pack_size: null } }],
        error: null
    });
    await h.registered.def.mount(h.root, h.ctx);
    h.root.querySelector('[data-rs-action="suggest-add"][data-item="item-uy"]').click();
    await flush();
    assert.ok(h.toasts.some(([m, t]) => t === 'success' && /Uruguay Supplies/.test(m)));
    assert.ok(h.toasts.some(([m, t]) => t === 'warning' && /Uruguay Supplies no envía a (Argentina|AR)\. Revisá la sede de entrega/.test(m)));
    h.root.querySelector('[data-rs-action="view"][data-view="carrito"]').click();
    await flush();
    const section = h.root.querySelector('[data-rs-cart="vend-2"]');
    assert.equal(section.querySelector('[data-rs-action="submit"]').disabled, true);
    assert.match(section.querySelector('[data-rs-cart-summary]').innerHTML, /no envía a (Argentina|AR)\. Elegí otra sede de entrega/);
});

test('catálogo con filtros, quitar línea, vaciar carrito y exportar pedidos', async () => {
    const h = harness();
    const csv = [];
    h.ctx.kit.downloadCsv = (name, columns, rows) => { csv.push(clone([name, columns.map(c => c.label), rows.length])); return ''; };
    const p1 = productRow();
    const p2 = productRow({ id: 'prod-2', name: 'Film <rollo>', price: 5000, category: 'paper_film' });
    h.ctx.data.Supplies.searchCatalog = async args => {
        h.calls.push(['searchCatalog', clone(args)]);
        return { data: args.vendorId ? [p1, p2].filter(p => p.vendor_id === args.vendorId) : [p1, p2], error: null };
    };
    h.orders.push({ id: 'order-5', order_number: 'P-2026-00005', status: 'submitted', currency: 'ARS', total: 1000, shipping_amount: 0, supply_vendors: { name: 'Tintas Sur' } });
    await h.registered.def.mount(h.root, h.ctx);

    h.root.querySelector('[data-rs-action="view"][data-view="catalogo"]').click();
    await flush();
    const category = h.root.querySelector('[data-rs-catalog="category"]');
    category.value = 'inks';
    category.dispatchEvent(makeEvent('change'));
    await flush();
    assert.ok(h.calls.some(c => c[0] === 'searchCatalog' && c[1].category === 'inks' && c[1].limit === 120));
    const vendorSel = h.root.querySelector('[data-rs-catalog="vendor"]');
    vendorSel.value = 'vend-1';
    vendorSel.dispatchEvent(makeEvent('change'));
    await flush();
    assert.ok(h.calls.some(c => c[0] === 'searchCatalog' && c[1].vendorId === 'vend-1' && c[1].category === 'inks'));

    const results = h.root.querySelector('[data-rs-region="catalog-results"]');
    assert.match(results.innerHTML, /Film &lt;rollo&gt;/);
    results.querySelector('[data-rs-product="prod-1"] [data-rs-action="add"]').click();
    results.querySelector('[data-rs-product="prod-2"] [data-rs-action="add"]').click();
    assert.equal(JSON.parse(h.storage.getItem(STORAGE_KEY)).carts['vend-1'].lines.length, 2);

    h.root.querySelector('[data-rs-action="view"][data-view="carrito"]').click();
    await flush();
    let section = h.root.querySelector('[data-rs-cart="vend-1"]');
    assert.equal(section.querySelectorAll('[data-rs-line]').length, 2);
    section.querySelector('[data-rs-line="prod-2"] [data-rs-action="remove-line"]').click();
    section = h.root.querySelector('[data-rs-cart="vend-1"]');
    assert.equal(section.querySelectorAll('[data-rs-line]').length, 1);
    assert.deepEqual(JSON.parse(h.storage.getItem(STORAGE_KEY)).carts['vend-1'].lines.map(l => l.product_id), ['prod-1']);

    section.querySelector('[data-rs-action="clear-cart"]').click();
    await flush();
    assert.ok(h.calls.some(c => c[0] === 'confirm' && c[1] === 'Vaciar carrito'));
    assert.match(viewHtml(h), /Tu carrito está vacío/);
    assert.equal(JSON.parse(h.storage.getItem(STORAGE_KEY) || '{"carts":{}}').carts['vend-1'], undefined);

    h.root.querySelector('[data-rs-action="view"][data-view="pedidos"]').click();
    h.root.querySelector('[data-rs-action="export-orders"]').click();
    assert.deepEqual(csv, [['pedidos-reposicion', ['Pedido', 'Proveedor', 'Sede', 'Estado', 'Fecha', 'Moneda', 'Subtotal', 'Descuento', 'Envío', 'Total'], 1]]);
});

test('si el servidor rechaza el pedido: toast con el motivo, el carrito queda y se revalida el catálogo', async () => {
    const h = harness();
    h.ctx.data.Supplies.submitOrder = async args => {
        h.calls.push(['submitOrder', clone(args)]);
        return { data: null, error: { code: '23514', message: 'Stock insuficiente para Tinta negra 8oz.' } };
    };
    await h.registered.def.mount(h.root, h.ctx);
    h.root.querySelector('[data-rs-action="suggest-add"][data-item="item-1"]').click();
    await flush();
    h.root.querySelector('[data-rs-action="view"][data-view="carrito"]').click();
    await flush();
    const vendorLoads = () => h.calls.filter(c => c[0] === 'searchCatalog' && c[1].vendorId === 'vend-1').length;
    const before = vendorLoads();
    h.root.querySelector('[data-rs-cart="vend-1"] [data-rs-action="submit"]').click();
    await flush();
    assert.ok(h.toasts.some(([m, t]) => t === 'danger' && m === 'Stock insuficiente para Tinta negra 8oz.'));
    assert.ok(JSON.parse(h.storage.getItem(STORAGE_KEY)).carts['vend-1']);
    assert.equal(h.calls.filter(c => c[0] === 'notify').length, 0);
    assert.equal(pressedView(h, 'carrito'), 'true');
    h.root.querySelector('[data-rs-action="view"][data-view="carrito"]').click();
    await flush();
    assert.equal(vendorLoads(), before + 1, 'precio/stock se vuelven a pedir');
});

test('sin el vínculo a Supplies (repo legacy) las sugerencias lo dicen y ofrecen buscar', async () => {
    const h = harness();
    h.ctx.data.StudioOps.listRestockCandidates = async () => ({
        data: [{ id: 'item-2', name: 'Guantes', unit: 'caja', quantity_on_hand: 0, reorder_level: 2, supply_product_id: null, supply_products: null }],
        error: null,
        legacy: true
    });
    await h.registered.def.mount(h.root, h.ctx);
    assert.match(viewHtml(h), /Vínculo no disponible/);
    assert.match(viewHtml(h), /data-rs-action="suggest-search" data-item="item-2"/);
});

test('la revalidación del carrito repinta sin perder el foco del campo que se edita', async () => {
    const h = harness();
    h.storage.setItem(STORAGE_KEY, JSON.stringify({
        locationId: 'loc-1',
        carts: { 'vend-1': { vendor: vendorRow(), locationId: 'loc-1', notes: '', lines: [{ product_id: 'prod-1', name: 'Tinta negra 8oz', price: 12000, currency: 'ARS', quantity: 5, min_order_qty: 1, unit_label: 'frasco' }] } }
    }));
    await h.registered.def.mount(h.root, h.ctx);
    h.root.querySelector('[data-rs-action="view"][data-view="carrito"]').click();
    const input = h.root.querySelector('[data-rs-line="prod-1"] [data-rs-field="quantity"]');
    input.focus();
    await flush();
    const fresh = h.root.querySelector('[data-rs-line="prod-1"] [data-rs-field="quantity"]');
    assert.notEqual(fresh, input, 'la revalidación repintó el carrito');
    assert.equal(h.doc.activeElement, fresh);
    assert.equal(fresh.id, input.id);
});

// -----------------------------------------------------------------
// CSS
// -----------------------------------------------------------------
test('studio-restock.css: prefijo rs-, radio 0 y breakpoints del panel', () => {
    const classes = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]);
    const foreign = classes.filter(c => !/^(rs-|sk-|studio-|is-|has-)/.test(c));
    assert.deepEqual([...new Set(foreign)], []);
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map(m => m[1].trim());
    assert.ok(radii.length > 0 && radii.every(v => v === '0'), 'sin bordes redondeados: ' + radii.join(', '));
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /@media \(max-width: 600px\)/);
    for (const cls of ['rs-card', 'rs-grid', 'rs-cart', 'rs-line', 'rs-totals', 'rs-notice--danger', 'rs-timeline', 'rs-receive__row', 'rs-detail__meta']) {
        assert.ok(css.includes('.' + cls), 'falta .' + cls);
    }
    // Cada clase rs- del markup tiene reglas (salvo los ganchos de JS documentados).
    const hooks = new Set(['rs-module', 'rs-view', 'rs-order-drawer', 'rs-receive-modal', 'rs-result__table', 'rs-orders__table', 'rs-suggestions', 'rs-detail__lines']);
    // Tokens de class="…" en el JS (cortados donde empieza una concatenación).
    const used = new Set([...source.matchAll(/class="([^"]*)"/g)]
        .flatMap(m => m[1].split(/\s+/))
        .map(c => (/^rs-[\w-]*\w/.exec(c) || [''])[0])
        .filter(Boolean));
    for (const cls of used) {
        if (hooks.has(cls) || /rs-notice--$/.test(cls)) continue;
        assert.ok(css.includes('.' + cls), 'falta CSS para .' + cls);
    }
});
