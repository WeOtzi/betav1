'use strict';

// Lógica pura de la Store (docs/plans/2026-10-30-store-artista.md §3, §4, §6 y
// §8.1): modelo, marca de agua y helpers puros del shell de /store/*.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const M = require('../public/shared/js/store-model.js');
const W = require('../public/shared/js/store-watermark.js');

const SELLER = '6f1c2a9e-0000-4000-8000-000000000001';
const PRODUCT = '9a7b3c1d-0000-4000-8000-000000000002';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function design(extra) {
    return Object.assign({
        id: PRODUCT, kind: 'design', status: 'active', currency: 'USD',
        license_personal_price: 40, license_artist_price: 90, license_exclusive_price: 500,
        licenses_issued: 0, reserved: false
    }, extra || {});
}
function merch(extra) {
    return Object.assign({
        id: PRODUCT, kind: 'merch', status: 'active', currency: 'ARS', price_amount: 30000, shipping_price_amount: 5000,
        pickup_available: true, ships_to_countries: ['AR', 'UY'],
        variants: [
            { id: 'v-s', label: 'S', price_amount: null, active: true, stock: 3 },
            { id: 'v-xl', label: 'XL', price_amount: 35000, active: true, stock: null },
            { id: 'v-off', label: 'XXL', price_amount: null, active: false, stock: 10 }
        ]
    }, extra || {});
}

/* ------------------------------- módulos ------------------------------- */

test('store-model y store-watermark son UMD: module.exports y window.*', () => {
    assert.equal(typeof M.formatMoney, 'function');
    assert.equal(typeof W.renderPreview, 'function');
    for (const [file, name] of [['store-model.js', 'WeotziStoreModel'], ['store-watermark.js', 'WeotziStoreWatermark'], ['store-shell.js', 'WeotziStoreShell']]) {
        const window = {};
        vm.runInNewContext(read('public/shared/js/' + file), { window, console }, { filename: file });
        assert.equal(typeof window[name], 'object', name + ' en window');
    }
});

/* -------------------------------- montos -------------------------------- */

test('formatMoney muestra siempre el código ISO con números europeos', () => {
    assert.equal(M.formatMoney(50, 'USD'), 'USD 50');
    assert.equal(M.formatMoney(65000, 'ars'), 'ARS 65.000');
    assert.equal(M.formatMoney(1240.5, 'USD'), 'USD 1.240,50');
    assert.equal(M.formatMoney('1999.99', 'EUR'), 'EUR 1.999,99');
    assert.equal(M.formatMoney(0, 'USD'), 'USD 0');
    assert.equal(M.formatMoney(null, 'USD'), '—');
    assert.equal(M.formatMoney('abc', 'USD'), '—');
});

test('formatMoney envuelve WeOtziCurrency solo para los decimales y nunca convierte', () => {
    const prev = globalThis.WeOtziCurrency;
    globalThis.WeOtziCurrency = {
        get: (code) => ({ CLP: { decimals: 0 }, USD: { decimals: 2 } })[code] || null,
        convert: () => { throw new Error('no se convierte'); },
        formatForDisplay: () => { throw new Error('no se usa la preferencia del visitante'); }
    };
    try {
        assert.equal(M.formatMoney(15990.6, 'CLP'), 'CLP 15.991');
        assert.equal(M.formatMoney(12.5, 'USD'), 'USD 12,50');
    } finally {
        if (prev === undefined) delete globalThis.WeOtziCurrency; else globalThis.WeOtziCurrency = prev;
    }
});

test('parseAmount acepta formatos es-AR y en-US', () => {
    assert.equal(M.parseAmount('1.240,50'), 1240.5);
    assert.equal(M.parseAmount('1,240.50'), 1240.5);
    assert.equal(M.parseAmount('65.000'), 65000);
    assert.equal(M.parseAmount('12.5'), 12.5);
    assert.ok(Number.isNaN(M.parseAmount('')));
});

/* --------------------------- precios y totales --------------------------- */

test('unitPriceFor: nivel del diseño y override de variante o precio base', () => {
    assert.equal(M.unitPriceFor(design(), { tier: 'personal' }), 40);
    assert.equal(M.unitPriceFor(design(), { tier: 'exclusive' }), 500);
    assert.equal(M.unitPriceFor(design({ license_artist_price: null }), { tier: 'artist' }), null);
    assert.equal(M.unitPriceFor(design(), { tier: 'otro' }), null);
    assert.equal(M.unitPriceFor(merch(), { variantId: 'v-s' }), 30000);
    assert.equal(M.unitPriceFor(merch(), { variantId: 'v-xl' }), 35000);
    assert.equal(M.unitPriceFor(merch(), { variantId: 'no-existe' }), null);
});

test('orderTotals: envío por pedido solo con shipping; diseño siempre 1 unidad', () => {
    const ship = M.orderTotals(merch(), { variantId: 'v-xl', quantity: 2, method: 'shipping' });
    assert.deepEqual([ship.unitPrice, ship.quantity, ship.subtotal, ship.shipping, ship.total, ship.valid, ship.currency], [35000, 2, 70000, 5000, 75000, true, 'ARS']);
    const pickup = M.orderTotals(merch(), { variantId: 'v-xl', quantity: 2, method: 'pickup' });
    assert.equal(pickup.shipping, 0);
    assert.equal(pickup.total, 70000);
    const d = M.orderTotals(design(), { tier: 'artist', quantity: 5, method: 'shipping' });
    assert.deepEqual([d.quantity, d.method, d.shipping, d.total, d.valid], [1, 'digital', 0, 90, true]);
});

test('orderTotals devuelve el código store:* que daría create_store_order', () => {
    assert.equal(M.orderTotals(merch(), { quantity: 1 }).error, 'variant_required');
    assert.equal(M.orderTotals(merch(), { variantId: 'v-off' }).error, 'variant_unavailable');
    assert.equal(M.orderTotals(merch(), { variantId: 'v-s', quantity: 4 }).error, 'out_of_stock');
    assert.equal(M.orderTotals(merch(), { variantId: 'v-xl', quantity: 21 }).error, 'invalid_quantity');
    assert.equal(M.orderTotals(merch(), { variantId: 'v-xl', quantity: 0 }).error, 'invalid_quantity');
    assert.equal(M.orderTotals(merch({ pickup_available: false }), { variantId: 'v-xl', method: 'pickup' }).error, 'pickup_unavailable');
    assert.equal(M.orderTotals(design({ license_personal_price: null }), { tier: 'personal' }).error, 'tier_unavailable');
    // RPC pública: in_stock / low_stock en lugar de stock.
    const pub = merch({ variants: [{ id: 'v1', label: 'M', price_amount: null, in_stock: true, low_stock: 2 }] });
    assert.equal(M.orderTotals(pub, { variantId: 'v1', quantity: 3 }).error, 'out_of_stock');
    assert.equal(M.orderTotals(pub, { variantId: 'v1', quantity: 2 }).valid, true);
});

test('priceFrom: price_from de la RPC o mínimo de niveles / variantes activas', () => {
    assert.equal(M.priceFrom(design()), 40);
    assert.equal(M.priceFrom(design({ license_personal_price: null })), 90);
    assert.equal(M.priceFrom(merch()), 30000);
    assert.equal(M.priceFrom(merch({ price_from: 12345 })), 12345);
    assert.equal(M.priceFrom(design({ license_personal_price: null, license_artist_price: null, license_exclusive_price: null })), null);
});

/* --------------------------------- niveles -------------------------------- */

test('availableTiers: siempre los tres niveles, con motivo y código', () => {
    const rows = M.availableTiers(design(), { viewerIsArtist: true });
    assert.deepEqual(rows.map((r) => r.id), ['personal', 'artist', 'exclusive']);
    assert.ok(rows.every((r) => r.available));
});

test('availableTiers: el nivel artist solo para artistas', () => {
    const artist = M.availableTiers(design(), { viewerIsArtist: false }).find((r) => r.id === 'artist');
    assert.equal(artist.available, false);
    assert.equal(artist.code, 'artist_tier_requires_artist');
    assert.equal(artist.reason, 'Solo para cuentas de artista');
    assert.equal(M.availableTiers(design(), { viewerIsArtist: false }).find((r) => r.id === 'personal').available, true);
});

test('availableTiers: exclusiva no disponible con licencias emitidas o exclusive_available=false', () => {
    const licensed = M.availableTiers(design({ licenses_issued: 1 }), { viewerIsArtist: true });
    assert.equal(licensed.find((r) => r.id === 'exclusive').available, false);
    assert.equal(licensed.find((r) => r.id === 'exclusive').code, 'exclusive_unavailable');
    assert.equal(licensed.find((r) => r.id === 'personal').available, true);
    const flagged = M.availableTiers(design({ exclusive_available: false }), {});
    assert.equal(flagged.find((r) => r.id === 'exclusive').code, 'exclusive_unavailable');
});

test('availableTiers: un diseño reservado bloquea todos los niveles (product_reserved)', () => {
    const reserved = M.availableTiers(design({ reserved: true }), { viewerIsArtist: true });
    assert.ok(reserved.every((r) => !r.available && r.code === 'product_reserved'));
    // Fila del vendedor: reserva vigente o vencida.
    const now = Date.parse('2026-10-30T12:00:00Z');
    const live = design({ reserved: undefined, reserved_order_id: 'o1', reserved_until: '2026-10-31T00:00:00Z' });
    const stale = design({ reserved: undefined, reserved_order_id: 'o1', reserved_until: '2026-10-29T00:00:00Z' });
    assert.equal(M.availableTiers(live, { now })[0].code, 'product_reserved');
    assert.equal(M.availableTiers(stale, { now })[0].available, true);
    assert.equal(M.isReserved(design({ reserved: undefined, reserved_order_id: 'o1', reserved_until: null }), now), false, 'igual que la RPC pública');
});

test('availableTiers: niveles sin precio, producto inactivo y producto propio', () => {
    const rows = M.availableTiers(design({ license_artist_price: null }), { viewerIsArtist: true });
    assert.equal(rows.find((r) => r.id === 'artist').code, 'tier_unavailable');
    assert.ok(M.availableTiers(design({ status: 'paused' }), {}).every((r) => r.code === 'product_unavailable'));
    assert.ok(M.availableTiers(design(), { viewerIsSeller: true }).every((r) => r.code === 'own_product'));
});

test('productBadges: exclusiva disponible, reservado y últimas unidades', () => {
    assert.deepEqual(M.productBadges(design({ exclusive_available: true })).map((b) => b.label), ['Exclusiva disponible']);
    assert.deepEqual(M.productBadges(design({ reserved: true })).map((b) => b.label), ['Reservado']);
    assert.deepEqual(M.productBadges(design({ licenses_issued: 2 })), []);
    const low = merch({ variants: [{ id: 'a', in_stock: true, low_stock: 2 }, { id: 'b', in_stock: true, low_stock: 1 }] });
    assert.deepEqual(M.productBadges(low).map((b) => b.label), ['Últimas 3 unidades']);
    assert.deepEqual(M.productBadges(merch({ variants: [{ id: 'a', in_stock: false }] })).map((b) => b.label), ['Agotado']);
    assert.deepEqual(M.productBadges(merch({ variants: [{ id: 'a', in_stock: true, low_stock: null }] })), []);
});

/* ------------------------------ envío y wallet ----------------------------- */

test('usesWallet ≡ store_order_uses_wallet: artista y cobro platform/provider', () => {
    assert.equal(M.usesWallet({ seller_type: 'artist', payment_collected_by: 'platform' }), true);
    assert.equal(M.usesWallet({ seller_type: 'artist', payment_collected_by: 'provider' }), true);
    assert.equal(M.usesWallet({ seller_type: 'artist', payment_collected_by: 'seller' }), false);
    assert.equal(M.usesWallet({ seller_type: 'studio', payment_collected_by: 'platform' }), false);
    assert.equal(M.usesWallet({ seller_type: 'artist', payment_collected_by: null, expected_collector: 'platform' }), true);
    assert.equal(M.usesWallet(null), false);
});

test('canTransitionFulfillment: siempre hacia adelante y dentro del flujo del método', () => {
    const can = M.canTransitionFulfillment;
    assert.equal(can('shipping', 'unfulfilled', 'preparing', { actor: 'seller' }), true);
    assert.equal(can('shipping', 'preparing', 'shipped', { actor: 'seller' }), true);
    assert.equal(can('pickup', 'preparing', 'ready_for_pickup', { actor: 'seller' }), true);
    assert.equal(can('shipping', 'shipped', 'preparing', { actor: 'seller' }), false, 'nunca hacia atrás');
    assert.equal(can('shipping', 'preparing', 'preparing', { actor: 'seller' }), false);
    assert.equal(can('shipping', 'preparing', 'ready_for_pickup', { actor: 'seller' }), false, 'shipping no pasa por retiro');
    assert.equal(can('pickup', 'preparing', 'shipped', { actor: 'seller' }), false, 'pickup no se envía');
    assert.equal(can('shipping', 'delivered', 'shipped', { actor: 'support' }), false);
    assert.equal(can('shipping', 'unfulfilled', 'preparing', { actor: 'seller', orderStatus: 'pending_payment' }), false, 'solo pedidos paid');
    assert.equal(can('shipping', 'unfulfilled', 'preparing', { actor: 'hacker' }), false);
});

test('canTransitionFulfillment: delivered según actor y wallet', () => {
    const can = M.canTransitionFulfillment;
    // Comprador y mantenimiento: solo desde enviado / listo para retirar.
    assert.equal(can('shipping', 'shipped', 'delivered', { actor: 'buyer' }), true);
    assert.equal(can('pickup', 'ready_for_pickup', 'delivered', { actor: 'buyer' }), true);
    assert.equal(can('shipping', 'preparing', 'delivered', { actor: 'buyer' }), false);
    assert.equal(can('shipping', 'shipped', 'delivered', { actor: 'auto' }), true);
    assert.equal(can('pickup', 'preparing', 'delivered', { actor: 'auto' }), false);
    // El comprador no mueve pasos intermedios.
    assert.equal(can('shipping', 'unfulfilled', 'preparing', { actor: 'buyer' }), false);
    // Vendedor: delivered solo si el pedido NO usa wallet.
    assert.equal(can('shipping', 'shipped', 'delivered', { actor: 'seller', usesWallet: false }), true);
    assert.equal(can('shipping', 'shipped', 'delivered', { actor: 'seller', usesWallet: true }), false);
    assert.equal(can('pickup', 'ready_for_pickup', 'delivered', { actor: 'seller', usesWallet: true }), false);
    // Soporte puede siempre (hacia adelante).
    assert.equal(can('shipping', 'shipped', 'delivered', { actor: 'support', usesWallet: true }), true);
    // Digital: solo el sistema al confirmar el pago.
    assert.equal(can('digital', 'unfulfilled', 'delivered', { actor: 'auto' }), true);
    assert.equal(can('digital', 'unfulfilled', 'delivered', { actor: 'seller' }), false);
    assert.equal(can('digital', 'unfulfilled', 'delivered', { actor: 'buyer' }), false);
});

test('nextFulfillmentSteps: pasos con labels, tracking exigido solo con wallet', () => {
    const seller = M.nextFulfillmentSteps('shipping', 'preparing', { actor: 'seller', usesWallet: true });
    assert.deepEqual(seller.map((s) => s.status), ['shipped']);
    assert.equal(seller[0].actionLabel, 'Marcar enviado');
    assert.equal(seller[0].requiresTracking, true);
    const noWallet = M.nextFulfillmentSteps('shipping', 'preparing', { actor: 'seller', usesWallet: false });
    assert.deepEqual(noWallet.map((s) => s.status), ['shipped', 'delivered']);
    assert.equal(noWallet[0].requiresTracking, false);
    const buyer = M.nextFulfillmentSteps({ fulfillment_method: 'pickup', fulfillment_status: 'ready_for_pickup', status: 'paid', seller_type: 'artist', payment_collected_by: 'platform' }, { actor: 'buyer' });
    assert.deepEqual(buyer.map((s) => [s.status, s.actionLabel]), [['delivered', 'Ya lo recibí →']]);
    assert.deepEqual(M.nextFulfillmentSteps({ fulfillment_method: 'shipping', fulfillment_status: 'unfulfilled', status: 'pending_payment' }, { actor: 'seller' }), []);
});

/* -------------------------------- checklist -------------------------------- */

const READY_SETTINGS = { payment_instructions: 'Transferencia al alias mara.ink', contact_channel: '@mara.ink en Instagram', authorship_attested_at: '2026-10-30T10:00:00Z' };

test('publishChecklist de diseño: espejo del guard (precio, imagen, original, stencil, ajustes, autoría)', () => {
    const product = design({ images: [{ path: `${SELLER}/${PRODUCT}/1-0.webp`, alt: '' }] });
    const assets = [{ kind: 'original' }, { kind: 'stencil' }];
    const full = M.publishChecklist(product, { assets, settings: READY_SETTINGS });
    assert.deepEqual(full.map((i) => i.key), ['license_price', 'images', 'original', 'stencil', 'payment_instructions', 'contact_channel', 'authorship']);
    assert.ok(full.every((i) => i.ok && i.label));
    assert.equal(M.checklistComplete(full), true);

    const missing = M.publishChecklist(design({ license_personal_price: null, license_artist_price: null, license_exclusive_price: null, images: [] }), {
        assets: [{ kind: 'original' }],
        settings: { payment_instructions: '   ', contact_channel: 'x', authorship_attested_at: null }
    });
    const failed = missing.filter((i) => !i.ok).map((i) => i.key);
    assert.deepEqual(failed, ['license_price', 'images', 'stencil', 'payment_instructions', 'authorship']);
    assert.equal(M.checklistComplete(missing), false);
});

test('publishChecklist de merch: precio base, variante activa, imagen y ajustes, sin autoría', () => {
    const ok = M.publishChecklist(merch({ images: [{ path: 'a/b/1-0.jpg' }] }), { settings: { payment_instructions: 'x', contact_channel: 'y' } });
    assert.deepEqual(ok.map((i) => i.key), ['price', 'variants', 'images', 'payment_instructions', 'contact_channel']);
    assert.equal(M.checklistComplete(ok), true);
    const bad = M.publishChecklist(merch({ price_amount: null, images: [], variants: [{ id: 'v', active: false }] }), { settings: {} });
    assert.deepEqual(bad.filter((i) => !i.ok).map((i) => i.key), ['price', 'variants', 'images', 'payment_instructions', 'contact_channel']);
});

test('validateProductDraft limpia el patch y respeta los checks de forma', () => {
    const d = M.validateProductDraft({ kind: 'design', title: '  Dragón  ', currency: 'usd', license_personal_price: '40', license_exclusive_price: '1.200,50', design_width_cm: '12.34', price_amount: 10, pickup_available: true, tags: 'blackwork, #fineline, blackwork' });
    assert.equal(d.ok, true, JSON.stringify(d.errors));
    assert.equal(d.value.title, 'Dragón');
    assert.equal(d.value.currency, 'USD');
    assert.equal(d.value.license_exclusive_price, 1200.5);
    assert.equal(d.value.license_artist_price, null);
    assert.equal(d.value.design_width_cm, 12.3);
    assert.equal(d.value.price_amount, null, 'un diseño no tiene precio base');
    assert.equal(d.value.pickup_available, false);
    assert.deepEqual(d.value.tags, ['blackwork', 'fineline']);

    const m = M.validateProductDraft({ kind: 'merch', title: 'Remera', price_amount: '0', license_personal_price: 5, ships_to_countries: 'ar, uy, ARG', shipping_price_amount: '-1' });
    assert.equal(m.ok, false);
    assert.ok(m.errors.price_amount);
    assert.ok(m.errors.shipping_price_amount);
    assert.ok(m.errors.ships_to_countries);
    assert.equal(m.value.license_personal_price, null, 'un merch no tiene precios de licencia');

    const bad = M.validateProductDraft({ kind: 'otro', title: 'x', currency: 'US', tags: Array.from({ length: 13 }, (_, i) => 't' + i), design_width_cm: 300 });
    assert.ok(bad.errors.kind && bad.errors.title && bad.errors.currency && bad.errors.tags);
});

/* --------------------------------- dirección -------------------------------- */

test('validateShippingAddress: campos obligatorios, ISO-2 y ships_to_countries', () => {
    const product = merch();
    const ok = M.validateShippingAddress({ recipient: 'Ana Pérez', line1: 'Av. Siempre Viva 742', city: 'Montevideo', country: 'uy', postal_code: '11200' }, product);
    assert.equal(ok.ok, true);
    assert.equal(ok.value.country, 'UY');
    assert.equal(ok.value.line2, null);
    assert.equal(ok.code, null);

    const missing = M.validateShippingAddress({ recipient: '', line1: '', city: '', country: 'Argentina' }, product);
    assert.equal(missing.ok, false);
    assert.deepEqual(Object.keys(missing.errors).sort(), ['city', 'country', 'line1', 'recipient']);
    assert.equal(missing.code, 'shipping_address_invalid');

    const outside = M.validateShippingAddress({ recipient: 'Ana', line1: 'Calle 1', city: 'Madrid', country: 'ES' }, product);
    assert.equal(outside.ok, false);
    assert.equal(outside.code, 'ships_to_unsupported');
    assert.equal(outside.errors.country, M.ERROR_COPY.ships_to_unsupported);

    const anywhere = M.validateShippingAddress({ recipient: 'Ana', line1: 'Calle 1', city: 'Madrid', country: 'ES' }, merch({ ships_to_countries: [] }));
    assert.equal(anywhere.ok, true, 'lista vacía = sin restricción');
});

test('isHttpsUrl y validateTracking', () => {
    assert.equal(M.isHttpsUrl('https://correo.com.ar/seguimiento?c=AB123'), true);
    assert.equal(M.isHttpsUrl('http://correo.com.ar'), false);
    assert.equal(M.isHttpsUrl('javascript:alert(1)'), false);
    assert.equal(M.isHttpsUrl('https://'), false);
    assert.equal(M.isHttpsUrl('https://x.com/' + 'a'.repeat(500)), false);
    assert.equal(M.validateTracking({ url: 'http://x.com' }).errors.url, M.ERROR_COPY.invalid_tracking_url);
    assert.equal(M.validateTracking({ carrier: 'Correo' }, { required: true }).errors.code, M.ERROR_COPY.tracking_required);
    assert.equal(M.validateTracking({ code: 'AB123', url: 'https://x.com/t' }, { required: true }).ok, true);
    assert.equal(M.validateTracking({ url: 'https://x.com/t' }, { required: true }).ok, true, 'como la RPC: código o link');
});

/* --------------------------------- errores --------------------------------- */

const CONTRACT_CODES = [
    'not_authenticated', 'forbidden', 'not_found',
    'product_unavailable', 'product_reserved', 'exclusive_unavailable', 'tier_unavailable', 'artist_tier_requires_artist', 'own_product', 'design_no_longer_available',
    'email_unconfirmed', 'too_many_pending', 'pending_order_exists', 'exclusive_cooldown',
    'variant_required', 'variant_unavailable', 'out_of_stock', 'invalid_quantity', 'pickup_unavailable', 'shipping_address_invalid', 'ships_to_unsupported',
    'seller_not_ready', 'terms_version_mismatch',
    'invalid_status', 'order_not_payable', 'collector_mismatch', 'payment_reported', 'cannot_reopen',
    'tracking_required', 'invalid_tracking_url',
    'stock_changed', 'checklist_incomplete', 'asset_licensed', 'asset_missing', 'invalid_image_path', 'download_limit', 'license_revoked', 'license_used'
];

test('ERROR_COPY cubre exactamente los códigos store:* de la §4, en voseo y sin «!»', () => {
    assert.deepEqual([...M.ERROR_CODES].sort(), [...CONTRACT_CODES].sort());
    const plan = read('docs/plans/2026-10-30-store-artista.md');
    const section = plan.slice(plan.indexOf('- **Errores**'), plan.indexOf('## 5. Esquema'));
    const inPlan = [...section.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((c) => c !== 'store' && /_|^[a-z]+$/.test(c) && !['P0001'].includes(c));
    for (const code of inPlan) assert.ok(M.ERROR_COPY[code], 'falta copy para ' + code);
    for (const [code, copy] of Object.entries(M.ERROR_COPY)) {
        assert.ok(copy.length > 10, code);
        assert.doesNotMatch(copy, /[!¡]/, code + ' sin exclamación');
        assert.doesNotMatch(copy, /(?<![\p{L}])(puedes|tienes|intenta|ingresa|vuelve|revisa|confirma|elige)(?![\p{L}])/iu, code + ' en voseo');
    }
});

test('errorMessage busca store:<código> en message, cause, details y hint', () => {
    assert.equal(M.errorMessage(new Error('store:own_product')), M.ERROR_COPY.own_product);
    // El run() de postgrest-client envuelve el error original en err.cause.
    const wrapped = new Error('[Store.createOrder] PostgREST error');
    wrapped.cause = { code: 'P0001', message: 'store:out_of_stock', details: null };
    assert.equal(M.errorCode(wrapped), 'out_of_stock');
    assert.equal(M.errorMessage({ message: 'x', details: 'store:license_used' }), M.ERROR_COPY.license_used);
    assert.equal(M.errorMessage({ message: 'x', cause: { cause: { hint: 'store:download_limit' } } }), M.ERROR_COPY.download_limit);
    assert.equal(M.errorMessage('store:forbidden'), M.ERROR_COPY.forbidden);
    assert.equal(M.errorMessage(new Error('store:no_existe')), M.DEFAULT_ERROR);
    assert.equal(M.errorCode(new Error('store:no_existe')), 'no_existe');
    assert.equal(M.errorMessage(new Error('Failed to fetch'), 'Sin conexión.'), 'Sin conexión.');
    assert.equal(M.errorMessage(null), M.DEFAULT_ERROR);
});

/* ------------------------------ estados y copy ----------------------------- */

test('STATUS_LABELS con el copy fijo del contrato y un tag del DS por estado', () => {
    assert.deepEqual(M.STATUS_LABELS, {
        pending_payment: 'Esperando pago', paid: 'Pago confirmado', fulfilled: 'Completado', cancelled: 'Cancelado', refunded: 'Reembolsado', expired: 'Vencido',
        unfulfilled: 'Por preparar', preparing: 'En preparación', shipped: 'Enviado', ready_for_pickup: 'Listo para retirar', delivered: 'Entregado',
        draft: 'Borrador', active: 'Publicado', paused: 'Pausado', retired: 'Retirado'
    });
    for (const key of Object.keys(M.STATUS_LABELS)) assert.match(M.STATUS_TAGS[key], /^wo-tag wo-tag--[a-z]+$/, key);
    assert.deepEqual([...M.ORDER_STATUSES, ...M.FULFILLMENT_STATUSES, ...M.PRODUCT_STATUSES].sort(), Object.keys(M.STATUS_LABELS).sort());
});

test('LICENSE_TIERS: tres niveles fijos con resumen, bullets y requiresArtist', () => {
    assert.deepEqual(M.LICENSE_TIERS.map((t) => [t.id, t.label, t.requiresArtist]), [['personal', 'Personal', false], ['artist', 'Artista', true], ['exclusive', 'Exclusiva', false]]);
    for (const t of M.LICENSE_TIERS) {
        assert.ok(t.summary.length > 20 && t.bullets.length >= 3, t.id);
        assert.equal(t.priceField, 'license_' + t.id + '_price');
    }
    assert.equal(M.tierById('artist').holderEditable, false, 'el titular de artist sale de artists_db');
    assert.equal(M.termsAcceptanceLabel('personal'), 'Leí y acepto la licencia Personal (v2026-10)');
});

test("TERMS['2026-10'] tiene los 3 niveles y las reglas comunes del contrato", () => {
    assert.equal(M.TERMS_VERSION, '2026-10');
    const t = M.TERMS['2026-10'];
    for (const tier of ['personal', 'artist', 'exclusive']) {
        assert.ok(Array.isArray(t[tier].clauses) && t[tier].clauses.length >= 4, tier);
        assert.ok(t[tier].title, tier);
    }
    assert.ok(t.common.clauses.length >= 5);
    const stencil = /podés compartir el stencil con el tatuador que te va a tatuar, solo para esa sesión/i;
    assert.match(t.personal.clauses.join(' '), stencil);
    assert.match(t.exclusive.clauses.join(' '), stencil);
    assert.match(t.personal.clauses.join(' '), /una sola vez/);
    assert.match(t.artist.clauses.join(' '), /cobrar esa sesión/);
    assert.match(t.artist.clauses.join(' '), /crédito al autor/);
    assert.match(t.exclusive.clauses.join(' '), /venta única/i);
    const common = t.common.clauses.join(' ');
    assert.match(common, /autoría/);
    assert.match(common, /crédito al autor/);
    assert.match(common, /revender/);
    assert.match(common, /redistribuir/);
    assert.match(common, /inteligencia artificial/);
    assert.match(common, /Uso único/);
    assert.match(common, /WOL-XXXX-XXXX/);
    const all = JSON.stringify([M.TERMS, M.LICENSE_TIERS, M.DESIGN_INCLUDES, M.STATUS_LABELS]);
    assert.doesNotMatch(all, /[!¡]/, 'sin exclamaciones');
    const terms = M.termsFor('exclusive');
    assert.equal(terms.version, '2026-10');
    assert.equal(terms.common.length, t.common.clauses.length);
    assert.equal(M.termsFor('otro'), null);
});

/* ---------------------------- archivos y rutas ---------------------------- */

test('FILES: MIME y límites IDÉNTICOS a los buckets de la migración', () => {
    assert.equal(M.FILES.PREVIEW_MAX_BYTES, 3145728);
    assert.equal(M.FILES.ORIGINAL_MAX_BYTES, 52428800);
    assert.equal(M.FILES.STENCIL_MAX_BYTES, 20971520);
    assert.deepEqual(M.FILES.PREVIEW_MIME, ['image/jpeg', 'image/webp', 'image/png']);
    assert.deepEqual(M.FILES.ORIGINAL_MIME, ['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'application/pdf', 'image/vnd.adobe.photoshop', 'application/postscript', 'application/zip']);
    assert.deepEqual(M.FILES.STENCIL_MIME, ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
    assert.ok(!M.FILES.PREVIEW_MIME.includes('image/svg+xml'), 'sin SVG en previews');
    assert.equal(M.FILES.PREVIEW_BUCKET, 'store-previews');
    assert.equal(M.FILES.DESIGN_BUCKET, 'store-design-files');
    assert.equal(W.DEFAULTS.maxBytes, M.FILES.PREVIEW_MAX_BYTES);
});

test('contentTypeFor: psd, ai, eps y procreate aunque el navegador no los reconozca', () => {
    assert.equal(M.contentTypeFor('dragon.psd', ''), 'image/vnd.adobe.photoshop');
    assert.equal(M.contentTypeFor('dragon.PSD', 'application/octet-stream'), 'image/vnd.adobe.photoshop');
    assert.equal(M.contentTypeFor('vector.ai', 'application/illustrator'), 'application/postscript');
    assert.equal(M.contentTypeFor('vector.eps', ''), 'application/postscript');
    assert.equal(M.contentTypeFor('lienzo.procreate', ''), 'application/zip');
    assert.equal(M.contentTypeFor('pack.zip', 'application/x-zip-compressed'), 'application/zip');
    assert.equal(M.contentTypeFor('foto.JPG', 'image/jpeg'), 'image/jpeg');
    assert.equal(M.contentTypeFor('sin-extension', 'image/jpg'), 'image/jpeg');
    assert.equal(M.contentTypeFor('sin-extension', ''), 'application/octet-stream');
    assert.equal(M.contentTypeFor('logo.svg', 'image/svg+xml'), 'image/svg+xml');
});

test('validateFile por tipo: MIME admitido, tamaño máximo y archivo vacío', () => {
    const file = (name, size, type) => ({ name, size, type: type || '' });
    assert.equal(M.validateFile('original', file('a.psd', 10 * 1024 * 1024)).ok, true);
    assert.equal(M.validateFile('original', file('a.procreate', 1024)).contentType, 'application/zip');
    assert.equal(M.validateFile('original', file('a.psd', M.FILES.ORIGINAL_MAX_BYTES + 1)).code, 'too_large');
    assert.equal(M.validateFile('stencil', file('a.psd', 1024)).code, 'invalid_type');
    assert.equal(M.validateFile('stencil', file('a.pdf', 1024)).ok, true);
    assert.equal(M.validateFile('stencil', file('a.png', M.FILES.STENCIL_MAX_BYTES + 1)).code, 'too_large');
    assert.equal(M.validateFile('preview', file('a.svg', 1024, 'image/svg+xml')).code, 'invalid_type');
    assert.equal(M.validateFile('preview', file('a.webp', M.FILES.PREVIEW_MAX_BYTES)).ok, true);
    assert.equal(M.validateFile('preview', file('a.webp', M.FILES.PREVIEW_MAX_BYTES + 1)).code, 'too_large');
    assert.equal(M.validateFile('source', file('IMG_1234.HEIC', 4e6)).ok, true);
    assert.equal(M.validateFile('original', file('a.png', 0)).code, 'empty');
    assert.equal(M.validateFile('otro', file('a.png', 1)).code, 'invalid_kind');
    assert.doesNotMatch(M.validateFile('stencil', file('a.psd', 1)).error, /[!¡]/);
});

test('buildAssetPath y buildPreviewPath cumplen las regex de paths del contrato', () => {
    const assetRe = (kind) => new RegExp('^' + escapeRe(SELLER) + '/' + escapeRe(PRODUCT) + '/(original|stencil)/[^/]+$');
    const previewRe = new RegExp('^' + escapeRe(SELLER) + '/' + escapeRe(PRODUCT) + '/[0-9]+-[0-9]+\\.(jpe?g|webp|png)$');
    const orig = M.buildAssetPath(SELLER, PRODUCT, 'original', 'Mi Diseño Final (v2).PSD', 1761830400000);
    assert.match(orig, assetRe('original'));
    assert.equal(orig.split('/')[2], 'original', 'el segmento coincide con kind');
    assert.ok(orig.endsWith('/1761830400000-Mi-Diseno-Final-v2.psd'), orig);
    const sneaky = M.buildAssetPath(SELLER, PRODUCT, 'stencil', '../../otro/../x.png', 1);
    assert.match(sneaky, assetRe('stencil'));
    assert.equal(sneaky.split('/').length, 4);
    assert.ok(orig.length <= 512);
    assert.match(M.buildAssetPath(SELLER, PRODUCT, 'stencil', 'x'.repeat(400) + '.png', 1), assetRe('stencil'));
    assert.ok(M.buildAssetPath(SELLER, PRODUCT, 'stencil', 'x'.repeat(400) + '.png', 1).length <= 512);
    assert.throws(() => M.buildAssetPath(SELLER, PRODUCT, 'preview', 'a.png', 1));
    assert.throws(() => M.buildAssetPath('a/b', PRODUCT, 'original', 'a.png', 1));

    for (const ext of ['jpg', 'jpeg', 'webp', 'png', '.WEBP', 'image/jpeg', 'image/png']) {
        assert.match(M.buildPreviewPath(SELLER, PRODUCT, 1761830400000, 3, ext), previewRe, ext);
    }
    assert.equal(M.buildPreviewPath(SELLER, PRODUCT, 1761830400000, 0, 'image/webp'), `${SELLER}/${PRODUCT}/1761830400000-0.webp`);
    assert.throws(() => M.buildPreviewPath(SELLER, PRODUCT, 1, 0, 'svg'));
    assert.throws(() => M.buildPreviewPath(SELLER, PRODUCT, 1, 0, 'gif'));
    assert.throws(() => M.buildPreviewPath(SELLER, PRODUCT, -1, 0, 'png'));
    assert.match(M.buildPreviewPath(SELLER, PRODUCT, undefined, 1, 'png'), previewRe, 'ts por defecto = ahora');
});

test('sanitizeFilename: sin barras, sin puntos al inicio y con extensión', () => {
    assert.equal(M.sanitizeFilename('Mi Diseño (final).png'), 'Mi-Diseno-final.png');
    assert.equal(M.sanitizeFilename('../../etc/passwd'), 'etc-passwd');
    assert.equal(M.sanitizeFilename('...'), 'archivo');
    assert.equal(M.sanitizeFilename(''), 'archivo');
    assert.equal(M.sanitizeFilename('a..b...c.zip'), 'a.b.c.zip');
    assert.doesNotMatch(M.sanitizeFilename('a/b\\c.png'), /[\/\\]/);
    assert.ok(M.sanitizeFilename('x'.repeat(300) + '.procreate').endsWith('.procreate'));
    assert.ok(M.sanitizeFilename('x'.repeat(300) + '.procreate').length <= 120);
});

test('normalizeUsername, rutas públicas y VERIFY_PARAM', () => {
    assert.equal(M.normalizeUsername('mara-ink'), 'mara-ink.wo');
    assert.equal(M.normalizeUsername('@mara-ink.wo'), 'mara-ink.wo');
    assert.equal(M.normalizeUsername(''), '');
    assert.equal(M.VERIFY_PARAM, 'verificar');
    assert.equal(M.storeUrl('mara-ink'), '/store/?artist=mara-ink.wo');
    assert.equal(M.itemUrl('p 1'), '/store/item/?id=p%201');
    assert.equal(M.checkoutUrl({ item: 'p1', license: 'personal' }), '/store/checkout/?item=p1&license=personal');
    assert.equal(M.checkoutUrl({ productId: 'p1', variantId: 'v1', quantity: 2 }), '/store/checkout/?item=p1&variant=v1&qty=2');
    assert.equal(M.verifyUrl('wol-abcd-1234'), '/store/license/?verificar=WOL-ABCD-1234');
    assert.doesNotMatch(M.verifyUrl('WOL-ABCD-1234'), /[?&]code=/, 'nunca ?code= (callback OAuth de client-auth)');
    assert.equal(M.normalizeLicenseCode(' wol abcd 1234 '), 'WOL-ABCD-1234');
    assert.equal(M.normalizeLicenseCode('ABCD1234'), 'WOL-ABCD-1234');
    assert.equal(M.normalizeLicenseCode('WOL-ABC'), null);
    assert.equal(M.purchasesUrl('o1'), '/store/purchases/?pedido=o1');
});

test('las rutas respetan WEOTZI_BASE_PATH sin duplicarlo', () => {
    const window = { WEOTZI_BASE_PATH: '/beta' };
    vm.runInNewContext(read('public/shared/js/store-model.js'), { window, console }, { filename: 'store-model.js' });
    const BM = window.WeotziStoreModel;
    assert.equal(BM.storeUrl('mara-ink'), '/beta/store/?artist=mara-ink.wo');
    assert.equal(BM.appPath('/beta/store/'), '/beta/store/');
    assert.equal(BM.appPath('//evil.com'), '//evil.com');
});

/* ---------------------------------- vistas --------------------------------- */

const NOW = '2026-10-30T12:00:00Z';
function order(extra) {
    return Object.assign({
        id: 'o1', order_number: 'ST-ABCD1234', seller_type: 'artist', seller_id: SELLER, status: 'pending_payment',
        fulfillment_method: 'shipping', fulfillment_status: 'unfulfilled', expected_collector: 'seller', payment_collected_by: null,
        currency: 'ARS', subtotal_amount: 70000, shipping_amount: 5000, total_amount: 75000,
        created_at: '2026-10-30T10:00:00Z', expires_at: '2026-10-31T10:00:00Z',
        items: [{ kind: 'merch', title: 'Remera Ötzi', variant_label: 'XL', quantity: 2, unit_price: 35000, line_total: 70000 }]
    }, extra || {});
}

test('orderView del comprador: pago pendiente, plazo y próxima acción', () => {
    const v = M.orderView(order(), { role: 'buyer', now: NOW });
    assert.equal(v.statusLabel, 'Esperando pago');
    assert.equal(v.statusTag, 'wo-tag wo-tag--highlight');
    assert.equal(v.totals.totalLabel, 'ARS 75.000');
    assert.equal(v.numberLabel, 'Pedido #ST-ABCD1234');
    assert.match(v.deadlineLabel, /^Tenés hasta el 31 oct 2026 · \d\d:\d\d para pagar\.$/);
    assert.equal(v.nextAction.key, 'report_payment');
    assert.equal(v.nextAction.label, 'Ya pagué →');
    assert.ok(v.actions.some((a) => a.key === 'cancel'));
    assert.deepEqual(v.timeline.map((s) => s.key), ['created', 'paid', 'preparing', 'shipped', 'delivered']);
    assert.equal(v.timeline.find((s) => s.current).key, 'paid');

    const reported = M.orderView(order({ buyer_payment_reported_at: '2026-10-30T11:00:00Z' }), { role: 'buyer', now: NOW });
    assert.equal(reported.nextAction.kind, 'info');
    assert.ok(!reported.actions.some((a) => a.key === 'cancel'), 'con pago informado solo cancela soporte');
    assert.ok(reported.timeline.some((s) => s.key === 'reported' && s.done));
});

test('orderView del vendedor y soporte: confirmar pago, envío, reembolso y retención', () => {
    const pendingSeller = M.orderView(order(), { role: 'seller', now: NOW });
    assert.equal(pendingSeller.nextAction.key, 'confirm_payment');
    const platform = M.orderView(order({ expected_collector: 'platform' }), { role: 'seller', now: NOW });
    assert.ok(!platform.actions.some((a) => a.key === 'confirm_payment'), 'platform solo lo confirma soporte');
    assert.equal(platform.nextAction.kind, 'info');
    assert.ok(M.orderView(order({ expected_collector: 'platform' }), { role: 'support', now: NOW }).actions.some((a) => a.key === 'confirm_payment'));

    const paidWallet = order({ status: 'paid', paid_at: NOW, fulfillment_status: 'shipped', shipped_at: NOW, expected_collector: 'platform', payment_collected_by: 'platform' });
    const sellerView = M.orderView(paidWallet, { role: 'seller', now: NOW });
    assert.equal(sellerView.usesWallet, true);
    assert.ok(!sellerView.actions.some((a) => a.key === 'fulfillment' && a.status === 'delivered'), 'con wallet el vendedor no marca entregado');
    assert.equal(sellerView.nextAction.key, 'awaiting_delivery');
    assert.ok(sellerView.actions.some((a) => a.key === 'edit_tracking'), 'puede corregir el seguimiento');
    assert.ok(!sellerView.actions.some((a) => a.key === 'refund'), 'cobró la plataforma: reembolsa soporte');
    const supportView = M.orderView(paidWallet, { role: 'support', now: NOW });
    assert.ok(supportView.actions.some((a) => a.key === 'refund'));
    assert.ok(supportView.actions.some((a) => a.key === 'funds_hold' && a.hold === true));
    const buyerView = M.orderView(paidWallet, { role: 'buyer', now: NOW });
    assert.equal(buyerView.nextAction.key, 'confirm_received');
    assert.equal(buyerView.nextAction.label, 'Ya lo recibí →');

    const sellerCollected = order({ status: 'paid', paid_at: NOW, fulfillment_status: 'preparing', payment_collected_by: 'seller' });
    const refund = M.orderView(sellerCollected, { role: 'seller', now: NOW }).actions.find((a) => a.key === 'refund');
    assert.equal(refund.confirm, 'Confirmá que ya le devolviste el dinero.');
    const shipped = order({ status: 'paid', paid_at: NOW, fulfillment_status: 'shipped', payment_collected_by: 'seller' });
    assert.ok(!M.orderView(shipped, { role: 'seller', now: NOW }).actions.some((a) => a.key === 'refund'), 'merch despachado no se reembolsa desde el vendedor');
});

test('orderView de un pedido cancelado marca el paso terminal y los saltados', () => {
    const v = M.orderView(order({ status: 'cancelled', cancelled_at: NOW }), { role: 'buyer', now: NOW });
    const last = v.timeline[v.timeline.length - 1];
    assert.deepEqual([last.key, last.label, last.terminal], ['cancelled', 'Cancelado', true]);
    assert.ok(v.timeline.filter((s) => s.key === 'paid')[0].skipped);
    assert.equal(v.nextAction, null);
});

test('licenseView: uso disponible, usada y revocada; resultado público con iniciales', () => {
    const base = { id: 'l1', tier: 'personal', holder_name: 'Ana Pérez', design_title: 'Dragón', seller_display_name: 'Mara Ink', seller_username: 'mara-ink.wo', verification_code: 'WOL-ABCD-1234', issued_at: '2026-10-30T10:00:00Z', terms_version: '2026-10' };
    const free = M.licenseView(base);
    assert.equal(free.statusLabel, 'Uso disponible');
    assert.equal(free.tierLabel, 'Personal');
    assert.equal(free.canMarkUsed, true);
    assert.equal(free.verifyUrl, '/store/license/?verificar=WOL-ABCD-1234');
    assert.equal(free.storeUrl, '/store/?artist=mara-ink.wo');
    assert.equal(free.termsLabel, 'Licencia v2026-10');
    assert.ok(free.terms.clauses.length > 0);
    const used = M.licenseView(Object.assign({}, base, { used_at: '2026-11-12T15:00:00' }));
    assert.equal(used.statusLabel, 'Usada el 12 nov 2026');
    assert.equal(used.canMarkUsed, false);
    const revoked = M.licenseView(Object.assign({}, base, { revoked_at: NOW }));
    assert.equal(revoked.statusLabel, 'Revocada');
    assert.equal(revoked.valid, false);
    const pub = M.licenseView({ valid: true, revoked: false, used: false, tier: 'exclusive', holder_initials: 'A. P.', design_title: 'Dragón', seller_username: 'mara-ink.wo', issued_at: NOW });
    assert.equal(pub.holderName, 'A. P.');
    assert.equal(pub.tierLabel, 'Exclusiva');
    assert.equal(M.licenseView({ valid: false }).status, 'invalid');
});

/* ------------------------------ marca de agua ------------------------------ */

test('fitWithin reduce el lado mayor sin agrandar', () => {
    assert.deepEqual(W.fitWithin(4000, 3000, 1600), { width: 1600, height: 1200, scale: 0.4 });
    assert.deepEqual(W.fitWithin(3000, 4000, 1600), { width: 1200, height: 1600, scale: 0.4 });
    assert.deepEqual(W.fitWithin(800, 600, 1600), { width: 800, height: 600, scale: 1 });
    assert.deepEqual(W.fitWithin(0, 600, 1600), { width: 0, height: 0, scale: 0 });
    assert.equal(W.fitWithin(10000, 1, 1600).height, 1, 'nunca 0 px');
});

test('tilePositions cubre todo el canvas, con patrón ladrillo y tope de marcas', () => {
    const w = 1600, h = 1200, step = 400;
    const tiles = W.tilePositions(w, h, step);
    assert.ok(tiles.length > 10);
    // Cada punto del canvas tiene una marca a menos de un paso.
    for (let x = 0; x <= w; x += 100) {
        for (let y = 0; y <= h; y += 100) {
            assert.ok(tiles.some((t) => Math.hypot(t.x - x, t.y - y) <= step), `sin marca cerca de ${x},${y}`);
        }
    }
    const rows = [...new Set(tiles.map((t) => t.y))];
    const firstXs = rows.slice(0, 2).map((y) => Math.min(...tiles.filter((t) => t.y === y).map((t) => t.x)));
    assert.equal(firstXs[1] - firstXs[0], step / 2, 'filas impares corridas medio paso');
    assert.ok(W.tilePositions(1600, 1600, 1).length <= W.MAX_TILES, 'un paso mínimo no explota');
    assert.deepEqual(W.tilePositions(0, 100, 10), []);
});

test('watermarkLabel: «WE ÖTZI · @usuario»', () => {
    assert.equal(W.watermarkLabel('mara-ink.wo'), 'WE ÖTZI · @mara-ink.wo');
    assert.equal(W.watermarkLabel('@mara-ink.wo'), 'WE ÖTZI · @mara-ink.wo');
    assert.equal(W.watermarkLabel(''), 'WE ÖTZI');
});

test('encodePlan: primero baja la calidad, después el lado (sin repetir ni bajar de minSide)', () => {
    const plan = W.encodePlan({ side: 1600 });
    assert.deepEqual(plan.slice(0, 4), [0.82, 0.72, 0.62, 0.52].map((quality) => ({ quality, side: 1600 })));
    assert.deepEqual(plan.slice(4).map((p) => p.side), [1280, 1024, 800, 640]);
    assert.ok(plan.slice(4).every((p) => p.quality === 0.52));
    const small = W.encodePlan({ side: 500, minSide: 480 });
    assert.deepEqual(small.map((p) => p.side), [500, 500, 500, 500, 480]);
    const tiny = W.encodePlan({ side: 300 });
    assert.ok(tiny.every((p) => p.side === 300), 'una imagen chica no se achica más');
});

// Canvas falso inyectable: registra cada exportación y decide tipo/tamaño.
function fakeCanvasFactory(encode) {
    const calls = [];
    const draws = { images: 0, texts: 0 };
    const createCanvas = (width, height) => {
        const ctx = {
            fillRect() {}, drawImage() { draws.images += 1; }, save() {}, restore() {}, translate() {}, rotate() {},
            strokeText() {}, fillText() { draws.texts += 1; }, measureText: (t) => ({ width: t.length * 10 })
        };
        const canvas = {
            width, height,
            getContext: () => ctx,
            toBlob(cb, type, quality) {
                calls.push({ type, quality, width: this.width, height: this.height });
                const out = encode(type, quality, this);
                setTimeout(() => cb(out), 0);
            }
        };
        return canvas;
    };
    const loadImage = async () => ({ source: {}, width: 4000, height: 3000, close() { loadImage.closed = true; } });
    return { calls, draws, createCanvas, loadImage };
}

test('renderPreview exporta WebP cuando el navegador lo soporta', async () => {
    const f = fakeCanvasFactory((type) => ({ type, size: 400000 }));
    const out = await W.renderPreview({ name: 'a.png', type: 'image/png' }, { handle: 'mara-ink.wo', createCanvas: f.createCanvas, loadImage: f.loadImage });
    assert.deepEqual([out.contentType, out.ext, out.width, out.height, out.attempts], ['image/webp', 'webp', 1600, 1200, 1]);
    assert.deepEqual(f.calls.map((c) => [c.type, c.quality]), [['image/webp', 0.82]]);
    assert.ok(f.draws.texts > 10, 'dibuja la marca repetida');
    assert.equal(f.loadImage.closed, true, 'libera la imagen');
});

test('renderPreview: si toBlob no devuelve WebP (Safari), reexporta como JPEG 0.82', async () => {
    // Safari ignora image/webp y entrega PNG.
    const f = fakeCanvasFactory((type) => ({ type: type === 'image/webp' ? 'image/png' : type, size: 500000 }));
    const out = await W.renderPreview({ name: 'a.jpg' }, { createCanvas: f.createCanvas, loadImage: f.loadImage });
    assert.deepEqual([out.contentType, out.ext], ['image/jpeg', 'jpg']);
    assert.deepEqual(f.calls.map((c) => [c.type, c.quality]), [['image/webp', 0.82], ['image/jpeg', 0.82]]);
    // toBlob(null) también cae a JPEG.
    const g = fakeCanvasFactory((type) => (type === 'image/webp' ? null : { type, size: 1000 }));
    const out2 = await W.renderPlain({ name: 'a.jpg' }, { createCanvas: g.createCanvas, loadImage: g.loadImage });
    assert.equal(out2.contentType, 'image/jpeg');
    assert.equal(g.draws.texts, 0, 'renderPlain no dibuja marca');
    // El path que arma store-model con esa extensión es válido para el bucket.
    assert.match(M.buildPreviewPath(SELLER, PRODUCT, 1, 0, out.ext), /\.jpg$/);
});

test('renderPreview: mientras pase de 3 MB baja la calidad y después el lado; JPEG no reintenta WebP', async () => {
    // Tamaño proporcional a calidad × píxeles: a 1600 px nunca entra; a 1280 px con 0.52, sí.
    const f = fakeCanvasFactory((type, q, canvas) => ({ type: type === 'image/webp' ? 'image/png' : type, size: Math.round(canvas.width * canvas.height * q * 3.4) }));
    const out = await W.renderPreview({ name: 'a.jpg' }, { createCanvas: f.createCanvas, loadImage: f.loadImage });
    assert.ok(out.blob.size <= W.DEFAULTS.maxBytes);
    assert.deepEqual([out.width, out.height, out.quality, out.contentType], [1280, 960, 0.52, 'image/jpeg']);
    const webpTries = f.calls.filter((c) => c.type === 'image/webp');
    assert.equal(webpTries.length, 1, 'después del primer fallback ya no prueba WebP');
    assert.deepEqual(f.calls.filter((c) => c.type === 'image/jpeg').map((c) => [c.quality, c.width]), [[0.82, 1600], [0.72, 1600], [0.62, 1600], [0.52, 1600], [0.52, 1280]]);
});

test('renderPreview: convierte HEIC antes de leer y falla con copy claro si no entra en 3 MB', async () => {
    const seen = [];
    const f = fakeCanvasFactory((type) => ({ type, size: 10 * 1024 * 1024 }));
    const heic = { name: 'IMG_1.HEIC', type: 'image/heic' };
    const jpeg = { name: 'IMG_1.jpg', type: 'image/jpeg' };
    const loadImage = async (file) => { seen.push(file.name); return { source: {}, width: 2000, height: 2000 }; };
    await assert.rejects(
        W.renderPreview(heic, { createCanvas: f.createCanvas, loadImage, convertHeic: async (file) => (file === heic ? jpeg : file) }),
        /3 MB/
    );
    assert.deepEqual(seen, ['IMG_1.jpg']);
    // Si la conversión falla se sigue con el archivo original.
    const g = fakeCanvasFactory((type) => ({ type, size: 10 }));
    const out = await W.renderPreview(heic, { createCanvas: g.createCanvas, loadImage, convertHeic: async () => { throw new Error('heic2any'); } });
    assert.equal(out.contentType, 'image/webp');
    await assert.rejects(W.renderPreview(null, {}), /Elegí una imagen/);
});

/* --------------------------- shell (partes puras) --------------------------- */

function loadShell(win) {
    const window = Object.assign({ location: { origin: 'https://beta.weotzi.com', pathname: '/store/item/', search: '?id=p1' }, URL, URLSearchParams }, win || {});
    vm.runInNewContext(read('public/shared/js/store-shell.js'), { window, console, URL, URLSearchParams, setTimeout, clearTimeout }, { filename: 'store-shell.js' });
    return window.WeotziStoreShell;
}

test('loginLinks arma client/register/artist con returnTo bajo /store/', () => {
    const S = loadShell();
    const links = S.loginLinks();
    assert.equal(links.returnTo, '/store/item/?id=p1');
    assert.equal(links.client, '/client/login?returnTo=%2Fstore%2Fitem%2F%3Fid%3Dp1');
    assert.equal(links.register, '/client/register?returnTo=%2Fstore%2Fitem%2F%3Fid%3Dp1');
    assert.equal(links.artist, '/artist/login?returnTo=%2Fstore%2Fitem%2F%3Fid%3Dp1');
    assert.equal(S.loginLinks('/store/checkout/?item=p1&license=personal').returnTo, '/store/checkout/?item=p1&license=personal');
});

test('normalizeReturnTo solo acepta paths del mismo origen bajo /store/', () => {
    const S = loadShell();
    assert.equal(S.normalizeReturnTo('/store/purchases/?pedido=o1'), '/store/purchases/?pedido=o1');
    assert.equal(S.normalizeReturnTo('/store?artist=x'), '/store/?artist=x');
    assert.equal(S.normalizeReturnTo('https://evil.com/store/'), null);
    assert.equal(S.normalizeReturnTo('//evil.com/store/'), null);
    assert.equal(S.normalizeReturnTo('/\\evil.com/store/'), null);
    assert.equal(S.normalizeReturnTo('/client/dashboard'), null);
    assert.equal(S.normalizeReturnTo('javascript:alert(1)'), null);
    assert.equal(S.loginLinks('https://evil.com').returnTo, '/store/purchases/', 'fallback seguro');
});

test('loginLinks con base path: returnTo sin base, links con base', () => {
    const S = loadShell({ WEOTZI_BASE_PATH: '/beta', location: { origin: 'https://weotzi.com', pathname: '/beta/store/purchases/', search: '' } });
    const links = S.loginLinks();
    assert.equal(links.returnTo, '/store/purchases/');
    assert.equal(links.client, '/beta/client/login?returnTo=%2Fstore%2Fpurchases%2F');
    assert.equal(S.appPath('/beta/store/'), '/beta/store/');
});

test('esc y previewImg escapan HTML; previewUrl delega en WeotziData.Store', () => {
    const S = loadShell({ WeotziData: { Store: { previewUrl: (p) => 'https://cdn.test/' + p } } });
    assert.equal(S.esc('<b a="1">&\'</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
    assert.equal(S.previewUrl('s/p/1-0.webp'), 'https://cdn.test/s/p/1-0.webp');
    assert.equal(S.previewUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
    const img = S.previewImg('s/p/1-0.webp', { alt: 'Dragón "rojo"' });
    assert.match(img, /^<img class="sts-img" src="https:\/\/cdn\.test\/s\/p\/1-0\.webp" alt="Dragón &quot;rojo&quot;" loading="lazy" decoding="async">$/);
    const bare = loadShell();
    assert.equal(bare.previewUrl('s/p/1-0.webp'), '', 'sin repo no arma URLs de Storage');
    assert.match(bare.previewImg('', { alt: 'x' }), /sts-media-ph/);
    assert.equal(bare.initials('Mara Ink'), 'MI');
    assert.equal(bare.initials('ana@mail.com'), 'AN');
});

test('store-shell y store-ds.css respetan las reglas del DS y de la capa de datos', () => {
    const shell = read('public/shared/js/store-shell.js');
    assert.doesNotMatch(shell, /\/rest\/v1\//, 'sin CRUD inline');
    assert.doesNotMatch(shell, /_supabase\.from\(|\.from\(['"]/, 'sin _supabase.from');
    assert.match(shell, /WeotziData\.Artists/);
    assert.doesNotMatch(shell, /class="[^"]*wo-topbar-right/, 'sin .wo-topbar-right: account-modes no monta su selector');
    const css = read('public/shared/css/store-ds.css');
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(bare, /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos');
    assert.doesNotMatch(bare, /border-radius\s*:\s*(?!0|var\(--radius-none\))/, 'radius 0');
    assert.doesNotMatch(bare, /prefers-color-scheme/, 'sin modo oscuro');
    assert.match(bare, /\.sts-mobile-menu:not\(\[hidden\]\)\{display:flex\}/);
    assert.match(bare, /\.sts-overlay:not\(\[hidden\]\)\{display:flex\}/);
    assert.doesNotMatch(bare, /\[hidden\]\s*\{[^}]*display\s*:\s*(flex|grid|block)/, 'nunca .x[hidden]{display:…}');
    assert.match(bare, /padding:var\(--space-6\) var\(--space-4\)/, 'gutter de 16px en móvil');
});
