'use strict';
// Store del artista · repo de datos (public/shared/js/data/store-repo.js) en el
// preview y en producción (docs/plans/2026-10-30-store-artista.md §8.2 y §8.6).
//
// Preview: postgrest-client + store-model + store-repo en un sandbox vm con
// window.WEOTZI_PREVIEW = true. El _supabase es el cliente del preview local
// (scripts/release/preview-bootstrap.js, con la extensión store) con un
// Storage falso que cuenta llamadas: ningún método del repo toca Storage ni
// hace fetch al servidor. Producción: cliente falso para subir con path y
// compensación, descarga firmada con Bearer, isAvailable y previewUrl.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const boot = require('../scripts/release/preview-bootstrap');
const fixtures = require('../public/shared/js/wo-demo-fixtures');
const emulator = require('../public/shared/js/wo-demo-postgrest');

// La extensión store se registra donde build() la busca (self).
const registry = { console };
registry.self = registry;
vm.runInNewContext(read('public/shared/js/demo-fixtures/store.js'), registry, { filename: 'demo-fixtures/store.js' });
global.self = registry;

const PREVIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BASE = '/preview/store-test';
const sid = (n) => '0000c0de-0000-4000-8000-57' + String(n).padStart(10, '0');
const P = { D1: sid(101), M1: sid(104), MD1: sid(151), MD2: sid(152) };
const V = { S: sid(201), M: sid(202), XL: sid(204) };

function memoryStorage() {
    const values = new Map();
    return { getItem: (k) => (values.has(k) ? values.get(k) : null), setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}

// Storage falso que cuenta cada llamada.
function countingStorage() {
    const calls = [];
    const storage = {
        from(bucket) {
            calls.push(['from', bucket]);
            const op = (name, result) => (...args) => { calls.push([name, bucket].concat(args.slice(0, 1))); return result; };
            return {
                upload: op('upload', Promise.resolve({ data: { path: 'x' }, error: null })),
                remove: op('remove', Promise.resolve({ data: [], error: null })),
                createSignedUrl: op('createSignedUrl', Promise.resolve({ data: null, error: { message: 'no' } })),
                download: op('download', Promise.resolve({ data: null, error: { message: 'no' } })),
                getPublicUrl: op('getPublicUrl', { data: { publicUrl: 'https://cdn.test/x' } })
            };
        }
    };
    return { storage, calls };
}

// Carga la capa de datos real en un sandbox (realm aparte, como el navegador).
function loadRepo(win) {
    win.window = win;
    win.console = console;
    const ctx = vm.createContext(win);
    for (const file of ['public/shared/js/data/postgrest-client.js', 'public/shared/js/store-model.js', 'public/shared/js/data/store-repo.js']) {
        vm.runInContext(read(file), ctx, { filename: path.basename(file) });
    }
    return win.WeotziData.Store;
}

async function previewRepo() {
    const win = {
        location: { origin: 'https://preview.weotzi.com', href: 'https://preview.weotzi.com' + BASE + '/store/', pathname: BASE + '/store/' },
        WEOTZI_BASE_PATH: BASE, WEOTZI_PREVIEW_COMMIT: 'store-test',
        Response, Headers, btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
        document: { addEventListener() {}, body: null },
        localStorage: memoryStorage(), sessionStorage: memoryStorage(),
        WoDemoFixtures: fixtures, WoDemoPostgrest: emulator, WoDemoFixtureExt_store: true,
        navigator: { sendBeacon() { throw new Error('nunca'); } },
        fetch: async () => { throw new Error('el preview no sale a la red'); }
    };
    const runtime = boot(win);
    await runtime.ready;
    const counter = countingStorage();
    const client = Object.assign({}, win.supabase.createClient('https://real.supabase.co', 'real-key'), { storage: counter.storage });
    const fetches = [];
    const sandbox = {
        WEOTZI_PREVIEW: true, WEOTZI_BASE_PATH: BASE, location: win.location, _supabase: client,
        btoa: win.btoa, Blob, Uint8Array,
        fetch: async (url) => { fetches.push(String(url)); throw new Error('el repo no debe llamar al servidor en el preview'); }
    };
    const Store = loadRepo(sandbox);
    return { Store, sandbox, runtime, storage: counter.calls, fetches, M: sandbox.WeotziStoreModel };
}

function codeOf(M) { return (err) => M.errorCode(err); }

test('preview: subir imágenes y archivos, borrarlos y descargar no llaman a Storage ni al servidor', async () => {
    const { Store, runtime, storage, fetches, M } = await previewRepo();
    assert.equal(Store.isPreviewEnv(), true);
    assert.equal(Store.featureEnabled(), true);
    assert.equal(await Store.isAvailable(), true);

    const draft = await Store.createProduct({ seller_type: 'artist', seller_id: PREVIEW_ID, kind: 'design', title: 'Diseño nuevo', license_personal_price: '20' });
    assert.equal(draft.status, 'draft');
    assert.deepEqual([draft.license_personal_price, draft.sales_count, draft.images.length], [20, 0, 0]);

    // Imagen: data URL en el navegador.
    const blob = new Blob([Buffer.from('RIFF0000WEBPVP8 demo')], { type: 'image/webp' });
    const image = await Store.uploadPreviewImage(PREVIEW_ID, draft.id, blob, 0, 'image/webp');
    assert.match(image.path, /^data:image\/webp;base64,/);
    assert.equal(Store.previewUrl(image.path), image.path);
    await assert.rejects(Store.uploadPreviewImage(PREVIEW_ID, draft.id, new Blob(['<svg/>'], { type: 'image/svg+xml' }), 1, 'image/svg+xml'),
        (err) => err.validation === true && err.code === 'invalid_type');
    const updated = await Store.updateProduct(draft.id, { images: [{ path: image.path, alt: 'Vista', url: 'https://x' }], seller_id: 'otro', sales_count: 99 });
    assert.deepEqual(JSON.parse(JSON.stringify(updated.images)), [{ path: image.path, alt: 'Vista' }]);
    assert.equal(updated.seller_id, PREVIEW_ID, 'seller_id no se edita');
    assert.equal(updated.sales_count, 0, 'los campos del servidor no se editan');

    // Archivos de diseño: fila con path demo/… y MIME por extensión.
    const original = await Store.uploadDesignAsset(PREVIEW_ID, draft.id, 'original', { name: 'Mi Diseño Final (v2).PSD', type: '', size: 4096 });
    assert.match(original.storage_path, new RegExp('^demo/' + draft.id + '/original/\\d+-Mi-Diseno-Final-v2\\.psd$'));
    assert.deepEqual([original.mime_type, original.file_name, original.size_bytes], ['image/vnd.adobe.photoshop', 'Mi Diseño Final (v2).PSD', 4096]);
    const stencil = await Store.uploadDesignAsset(PREVIEW_ID, draft.id, 'stencil', { name: 'stencil.png', type: 'image/png', size: 2048 });
    await assert.rejects(Store.uploadDesignAsset(PREVIEW_ID, draft.id, 'stencil', { name: 'stencil.psd', type: '', size: 10 }),
        (err) => err.validation === true && err.code === 'invalid_type');

    // Descargas desde los assets de demo, con el base path.
    assert.equal(await Store.getDownloadUrl(sid(751), stencil), BASE + '/shared/assets/demo/store/stencil.png');
    assert.equal(await Store.getDownloadUrl(sid(751), original), BASE + '/shared/assets/demo/store/original.svg');
    assert.equal(await Store.getDownloadUrl(sid(751), { id: 'a', kind: 'stencil', mime_type: 'application/pdf' }), BASE + '/shared/assets/demo/store/stencil.svg');

    // Borrados: solo la fila.
    assert.equal(await Store.removeDesignAsset(original), true);
    assert.equal(runtime.getStore().rows('store_design_assets').some((a) => a.id === original.id), false);
    await assert.rejects(Store.removeDesignAsset(original), (err) => codeOf(M)(err) === 'not_found');
    assert.equal(await Store.removePreviewImage(image.path), true);
    assert.equal(await Store.removePreviewImage('artist/x/1-0.webp'), true);

    // El guard del checklist se espeja en el preview; retired es final.
    await assert.rejects(Store.setProductStatus(draft.id, 'active'), (err) => codeOf(M)(err) === 'checklist_incomplete');
    assert.equal(await Store.deleteDraftProduct(draft.id), true);
    assert.equal(runtime.getStore().rows('store_products').some((p) => p.id === draft.id), false);
    await assert.rejects(Store.deleteDraftProduct(P.D1), (err) => codeOf(M)(err) === 'invalid_status');

    assert.deepEqual(storage, [], 'cero llamadas a Storage');
    assert.deepEqual(fetches, [], 'cero fetch al servidor');
});

test('preview: el repo completo corre sobre el emulador (vendedor, comprador y público) con errores store:*', async () => {
    const { Store, runtime, storage, fetches, M } = await previewRepo();
    const st = runtime.getStore();

    // Vendedor.
    const products = await Store.listMyProducts('artist', PREVIEW_ID);
    assert.equal(products.length, 6);
    const tee = products.find((p) => p.id === P.M1);
    assert.equal(tee.variants.length, 5);
    assert.ok(Array.isArray(tee.assets) && !('store_product_variants' in tee));
    const d1 = await Store.getMyProduct(P.D1);
    assert.deepEqual([d1.assets.length, Boolean(d1.settings && d1.settings.payment_instructions)], [2, true]);
    assert.equal(Store.previewUrl(d1.images[0].path), BASE + '/shared/assets/demo/store/golondrina.svg');
    assert.equal(M.checklistComplete(M.publishChecklist(d1, { variants: d1.variants, assets: d1.assets, settings: d1.settings })), true);

    // Variantes: cambia una, agrega otra, borra la que no tiene pedidos y desactiva la que sí.
    const keep = tee.variants.filter((v) => v.id !== V.M && v.id !== V.XL).map((v) => Object.assign({}, v));
    keep.find((v) => v.id === V.S).label = 'Talle S (chico)';
    keep.push({ label: 'Talle XS', size: 'XS', color: 'Negro', stock: 3 });
    const saved = await Store.saveVariants(P.M1, keep);
    assert.ok(saved.some((v) => v.label === 'Talle S (chico)' && v.stock === 4), 'el stock no se pisa al editar');
    assert.ok(saved.some((v) => v.label === 'Talle XS' && v.stock === 3 && v.active));
    assert.equal(saved.some((v) => v.id === V.XL), false, 'sin pedidos: se borra');
    assert.equal(saved.find((v) => v.id === V.M).active, false, 'con pedidos: se desactiva');
    assert.equal((await Store.adjustStock(V.S, 10, 4)).stock, 10);
    await assert.rejects(Store.adjustStock(V.S, 5, 4), (err) => codeOf(M)(err) === 'stock_changed');

    const settings = await Store.saveSellerSettings('artist', PREVIEW_ID, { store_tagline: '  Flash nuevo  ', pickup_address: '' });
    assert.equal(settings.store_tagline, 'Flash nuevo');
    assert.ok(settings.payment_instructions, 'el upsert conserva lo que no se mandó');
    assert.equal((await Store.getSellerSettings('artist', PREVIEW_ID)).pickup_address, null);

    const orders = await Store.listSellerOrders('artist', PREVIEW_ID);
    assert.equal(orders.length, 6);
    assert.ok(orders.every((o) => Array.isArray(o.items) && o.items === o.store_order_items && Array.isArray(o.payments)));
    const pending = orders.find((o) => o.status === 'pending_payment');
    const confirmed = await Store.confirmPayment(pending.id, { reference: 'TR-9', note: 'Recibido' });
    assert.equal(confirmed.status, 'fulfilled');
    const preparing = orders.find((o) => o.status === 'paid' && o.fulfillment_status === 'unfulfilled');
    await assert.rejects(Store.updateFulfillment(preparing.id, { status: 'shipped', trackingUrl: 'http://x.test' }), (err) => codeOf(M)(err) === 'invalid_tracking_url');
    assert.equal((await Store.updateFulfillment(preparing.id, { status: 'preparing' })).fulfillment_status, 'preparing');
    const report = await Store.getSalesReport('artist', PREVIEW_ID, new Date(Date.now() - 400 * 86400000), null);
    assert.ok(report.length >= 3 && report.some((r) => r.currency === 'ARS') && report.some((r) => r.currency === 'USD'));

    // Comprador: el usuario del preview le compra a Mara Ink.
    const purchases = await Store.listMyPurchases(PREVIEW_ID);
    assert.equal(purchases.length, 2);
    const withLicense = purchases.find((o) => o.licenses.length);
    const license = await Store.getLicense(withLicense.licenses[0].id);
    assert.equal(license.store_orders.id, withLicense.id);
    assert.equal(M.licenseView(license).status, 'available');
    const assets = await Store.listLicenseAssets(license.product_id);
    assert.deepEqual(assets.map((a) => a.kind).sort(), ['original', 'stencil']);
    assert.match(await Store.getDownloadUrl(license.id, assets[0]), /\/shared\/assets\/demo\/store\/(original|stencil)\.png$/);
    assert.ok((await Store.markLicenseUsed(license.id, 'Tatuado el 12/11')).used_at);
    await assert.rejects(Store.markLicenseUsed(license.id, null), (err) => codeOf(M)(err) === 'license_used');
    const shipped = purchases.find((o) => o.fulfillment_status === 'shipped');
    assert.equal((await Store.confirmReceived(shipped.id)).status, 'fulfilled');

    const order = await Store.createOrder({ item: P.MD2, license: 'personal', holderName: 'Valentina' });
    assert.deepEqual([order.status, order.total_amount, order.currency], ['pending_payment', 25, 'USD']);
    const again = await Store.createOrder({ productId: P.MD2, tier: 'personal', idempotencyKey: order.idempotency_key });
    assert.equal(again.id, order.id, 'misma clave, mismo pedido');
    await assert.rejects(Store.createOrder({ productId: P.D1, tier: 'personal' }), (err) => {
        assert.equal(codeOf(M)(err), 'own_product');
        assert.equal(M.errorMessage(err), M.ERROR_COPY.own_product);
        return true;
    });
    assert.ok((await Store.reportPayment(order.id, 'Transferencia 1')).buyer_payment_reported_at);
    await assert.rejects(Store.cancelOrder(order.id, 'no'), (err) => codeOf(M)(err) === 'payment_reported');
    const mine = await Store.getMyOrder(order.id);
    assert.equal(mine.items[0].license_holder_name, 'Valentina');

    // Público: no lanza.
    const front = await Store.getStorefront('artist', 'valentina-preview');
    assert.equal(front.seller.handle, 'valentina-preview.wo');
    assert.ok(front.products.length >= 4);
    assert.equal((await Store.getStorefront('artist', 'mara-ink')).products.length, 3);
    assert.equal(await Store.getStorefront('artist', 'nadie'), null);
    assert.equal(await Store.getStorefront('artist', ''), null);
    assert.equal((await Store.getPublicProduct(P.MD1)).seller.name, 'Mara Ink');
    assert.equal(await Store.getPublicProduct(sid(999)), null);
    assert.deepEqual([(await Store.verifyLicense(' wol 0d9e 4b7c ')).found, (await Store.verifyLicense('cualquiera')).found], [true, false]);

    // Soporte: el preview filtra needs_support en el cliente.
    assert.ok(Array.isArray(await Store.listFlaggedOrders()));
    assert.deepEqual(await Store.listPendingPlatformOrders(), []);
    assert.ok(st.rows('store_orders').length >= 9);

    assert.deepEqual(storage, [], 'cero llamadas a Storage');
    assert.deepEqual(fetches, [], 'cero fetch al servidor');
});

test('preview: soporte lee los vencidos recientes y las notas internas; marcar revisado exige soporte', async () => {
    const { Store, runtime, storage, fetches, M } = await previewRepo();
    const st = runtime.getStore();
    const DAY = 86400000;
    const base = st.rows('store_orders').find((o) => o.id === sid(405));
    const expired = (n, days) => Object.assign({}, base, {
        id: sid(970 + n), order_number: 'ST-EXP0000' + n, status: 'expired', cancelled_at: null, cancel_reason: null,
        expires_at: new Date(Date.now() - days * DAY).toISOString(), idempotency_key: 'exp-' + n
    });
    st.insert('store_orders', [expired(1, 2), expired(2, 10), expired(3, 0.5)]);
    const item = st.rows('store_order_items').find((i) => i.order_id === sid(405));
    st.insert('store_order_items', [Object.assign({}, item, { id: sid(975), order_id: sid(971) })]);

    const recent = await Store.listRecentExpiredOrders({ days: 7 });
    assert.deepEqual(recent.map((o) => o.id), [sid(973), sid(971)], 'solo los de 7 días, el más reciente primero');
    assert.ok(recent.every((o) => o.status === 'expired' && Array.isArray(o.items) && o.items === o.store_order_items && Array.isArray(o.payments)));
    assert.equal(recent[1].items[0].product_id, sid(106), 'con ítems embebidos');
    assert.deepEqual((await Store.listRecentExpiredOrders()).map((o) => o.id), [sid(973), sid(971)], 'por defecto 7 días');
    assert.deepEqual((await Store.listRecentExpiredOrders({ days: 30 })).map((o) => o.id), [sid(973), sid(971), sid(972)]);

    const notes = await Store.listSupportNotes(sid(404));
    assert.deepEqual(notes.map((n) => [n.order_id, n.kind]), [[sid(404), 'flag_resolved']]);
    assert.deepEqual(Object.keys(notes[0]).sort(), ['actor_id', 'created_at', 'id', 'kind', 'note', 'order_id']);
    assert.equal((await Store.listSupportNotes(sid(402))).length, 0);
    assert.equal((await Store.listSupportNotes(null)).length, 0);

    // El usuario del preview no es soporte.
    await assert.rejects(Store.resolveOrderFlag(sid(404), 'Revisado'), (err) => M.errorCode(err) === 'forbidden');
    await assert.rejects(Store.resolveOrderFlag(null, 'x'), (err) => err.validation === true);

    assert.deepEqual(storage, [], 'cero llamadas a Storage');
    assert.deepEqual(fetches, [], 'cero fetch al servidor');
});

test('preview también con el modo demo (WoDemo.enabled) y gate por features.store fuera del preview', () => {
    const demo = loadRepo({ WoDemo: { enabled: true }, location: { pathname: '/artist/store/' } });
    assert.equal(demo.isPreviewEnv(), true);
    assert.equal(demo.featureEnabled(), true);
    assert.equal(demo.previewUrl('demo/store/golondrina.svg'), '/shared/assets/demo/store/golondrina.svg');
    assert.equal(demo.previewUrl('seller/product/1-0.webp'), '', 'en el demo no se arma una URL de Storage');

    const on = loadRepo({ ConfigManager: { getValue: (key, def) => (key === 'features.store' ? true : def) }, location: { pathname: '/' } });
    assert.equal(on.isPreviewEnv(), false);
    assert.equal(on.featureEnabled(), true);
    const off = loadRepo({ ConfigManager: { getValue: (key, def) => def }, location: { pathname: '/' } });
    assert.equal(off.featureEnabled(), false);
    assert.equal(loadRepo({ location: { pathname: '/' } }).featureEnabled(), false);
});

/* ------------------------------ producción ------------------------------ */

// Cliente falso con builder encadenable; `respond(state)` decide cada resultado.
function fakeClient(respond) {
    const calls = { storage: [], queries: [] };
    function builder(table) {
        const state = { table, ops: [] };
        const b = {};
        ['select', 'eq', 'neq', 'gte', 'order', 'limit', 'insert', 'update', 'delete', 'upsert', 'maybeSingle', 'single', 'in', 'is'].forEach((m) => {
            b[m] = (...args) => { state.ops.push([m].concat(args)); return b; };
        });
        b.then = (resolve, reject) => { calls.queries.push(state); return Promise.resolve(respond(state)).then(resolve, reject); };
        return b;
    }
    const client = {
        from: (table) => builder(table),
        rpc: (fn, args) => builder('rpc/' + fn).insert(args),
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } }, error: null }) },
        storage: {
            from: (bucket) => ({
                upload: async (p, file, opts) => { calls.storage.push(['upload', bucket, p, opts && opts.contentType]); return { data: { path: p }, error: null }; },
                remove: async (paths) => { calls.storage.push(['remove', bucket].concat(paths)); return { data: [], error: null }; },
                getPublicUrl: (p) => ({ data: { publicUrl: 'https://cdn.test/' + bucket + '/' + p } })
            })
        }
    };
    return { client, calls };
}

test('producción: el archivo de diseño se sube con su path y, si la fila falla, se borra (compensación)', async () => {
    const { client, calls } = fakeClient((state) => {
        if (state.table === 'store_design_assets') return { data: null, error: { code: 'P0001', message: 'store:asset_missing' } };
        return { data: null, error: null };
    });
    const Store = loadRepo({ _supabase: client, location: { pathname: '/' } });
    assert.equal(Store.isPreviewEnv(), false);
    await assert.rejects(Store.uploadDesignAsset('seller-1', 'prod-1', 'original', { name: 'Golondrina Final.PSD', type: '', size: 2048 }),
        (err) => /store:asset_missing/.test(err.message) && err.cause.message === 'store:asset_missing');
    assert.equal(calls.storage.length, 2);
    const [upload, remove] = calls.storage;
    assert.deepEqual(upload.slice(0, 2), ['upload', 'store-design-files']);
    assert.match(upload[2], /^seller-1\/prod-1\/original\/\d+-Golondrina-Final\.psd$/);
    assert.equal(upload[3], 'image/vnd.adobe.photoshop');
    assert.deepEqual(remove, ['remove', 'store-design-files', upload[2]]);

    // Imagen pública: path del bucket store-previews.
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const { path: preview } = await Store.uploadPreviewImage('seller-1', 'prod-1', blob, 2, 'image/jpeg');
    assert.match(preview, /^seller-1\/prod-1\/\d+-2\.jpg$/);
    assert.deepEqual(calls.storage[2].slice(0, 2), ['upload', 'store-previews']);
    assert.equal(Store.previewUrl(preview), 'https://cdn.test/store-previews/' + preview);
    assert.equal(Store.previewUrl('demo/store/golondrina.svg'), '/shared/assets/demo/store/golondrina.svg');
    assert.equal(Store.previewUrl('https://evil.test/x.png'), '');
    assert.equal(Store.previewUrl('data:text/html;base64,PHNjcmlwdD4='), '');
});

test('producción: la descarga pide la URL firmada con Bearer y traduce 429 / 410 a store:*', async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    const requests = [];
    let reply = { status: 200, body: { success: true, url: 'https://signed.test/file?token=1', expires_in: 300 } };
    const fetch = async (url, init) => {
        requests.push({ url: String(url), init });
        return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
    };
    const Store = loadRepo({ _supabase: client, WEOTZI_BASE_PATH: '/beta', fetch, location: { pathname: '/beta/store/purchases/' } });
    const url = await Store.getDownloadUrl('lic-1', { id: 'asset-1', kind: 'original', mime_type: 'image/png' });
    assert.equal(url, 'https://signed.test/file?token=1');
    assert.equal(requests[0].url, '/beta/api/store/licenses/lic-1/assets/asset-1/url');
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer tok-123');
    const M = require('../public/shared/js/store-model.js');
    reply = { status: 429, body: { success: false, error: 'Llegaste al tope de 50 descargas por día.' } };
    await assert.rejects(Store.getDownloadUrl('lic-1', { id: 'asset-1' }), (err) => M.errorCode(err) === 'download_limit' && err.status === 429);
    reply = { status: 410, body: { success: false, error: 'Esta licencia fue revocada.' } };
    await assert.rejects(Store.getDownloadUrl('lic-1', { id: 'asset-1' }), (err) => M.errorCode(err) === 'license_revoked');
});

test('producción: isAvailable solo apaga la Store si la tabla no existe (404, 204 reescrito, PGRST205/202)', async () => {
    const probe = async (result) => {
        let n = 0;
        const { client } = fakeClient(() => { n += 1; return result; });
        const Store = loadRepo({ _supabase: client, location: { pathname: '/' } });
        const first = await Store.isAvailable();
        const second = await Store.isAvailable();
        assert.equal(first, second);
        assert.equal(n, 1, 'cacheado');
        return first;
    };
    assert.equal(await probe({ data: null, error: null, status: 200, count: 3 }), true);
    assert.equal(await probe({ data: null, error: null, status: 204, count: null }), false);
    assert.equal(await probe({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' }, status: 404 }), false);
    assert.equal(await probe({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }), false);
    assert.equal(await probe({ data: null, error: { message: '' }, status: 401 }), true, 'anon sin grants: la tabla existe');
});

test('producción: soporte (resolveOrderFlag, listSupportNotes y listRecentExpiredOrders) arma la RPC y las queries del contrato', async () => {
    let notesReply = { data: [{ id: 'n1', order_id: 'o-1', kind: 'funds_hold', note: 'Disputa', actor_id: 'u', created_at: '2026-10-30T10:00:00Z' }], error: null };
    const { client, calls } = fakeClient((state) => {
        if (state.table === 'rpc/resolve_store_order_flag') return { data: { id: 'o-1', metadata_json: { needs_support_resolved_at: 'x' } }, error: null };
        if (state.table === 'store_order_support_notes') return notesReply;
        return { data: [{ id: 'o-9', status: 'expired', store_order_items: { id: 'i-1' }, store_licenses: null, store_payments: [] }], error: null };
    });
    const Store = loadRepo({ _supabase: client, location: { pathname: '/' } });
    const opsOf = (table) => calls.queries.filter((q) => q.table === table).pop().ops;

    const resolved = await Store.resolveOrderFlag('o-1', '  Mismo pago, otra referencia.  ');
    assert.equal(resolved.id, 'o-1');
    assert.deepEqual(JSON.parse(JSON.stringify(opsOf('rpc/resolve_store_order_flag'))),
        [['insert', { p_order_id: 'o-1', p_note: 'Mismo pago, otra referencia.' }]]);
    await Store.resolveOrderFlag('o-1', '   ');
    assert.equal(opsOf('rpc/resolve_store_order_flag')[0][1].p_note, null, 'nota vacía → null');

    const notes = await Store.listSupportNotes('o-1');
    assert.equal(notes[0].kind, 'funds_hold');
    assert.deepEqual(JSON.parse(JSON.stringify(opsOf('store_order_support_notes'))), [
        ['select', 'id, order_id, kind, note, actor_id, created_at'], ['eq', 'order_id', 'o-1'],
        ['order', 'created_at', { ascending: false }], ['limit', 100]
    ]);
    // RLS: quien no es soporte no la lee. Nunca lanza.
    notesReply = { data: null, error: { code: '42501', message: 'permission denied for table store_order_support_notes' } };
    const warn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        assert.deepEqual(JSON.parse(JSON.stringify(await Store.listSupportNotes('o-1'))), []);
    } finally {
        console.warn = warn;
    }
    assert.equal(warnings.length, 1);

    const before = Date.now();
    const expiredOrders = await Store.listRecentExpiredOrders({ days: 7 });
    assert.deepEqual(expiredOrders.map((o) => [o.id, o.items.length, o.licenses.length]), [['o-9', 1, 0]], 'normalizado');
    const ops = opsOf('store_orders');
    assert.deepEqual(JSON.parse(JSON.stringify(ops.filter((op) => op[0] !== 'gte'))), [
        ['select', Store.STORE_SELECTS.orderFull], ['eq', 'status', 'expired'], ['order', 'expires_at', { ascending: false }], ['limit', 300]
    ]);
    const since = Date.parse(ops.find((op) => op[0] === 'gte' && op[1] === 'expires_at')[2]);
    assert.ok(Math.abs(since - (before - 7 * 86400000)) < 5000, 'expires_at >= ahora - 7 días');
    const sinceFor = async (days) => { await Store.listRecentExpiredOrders(days); return Date.parse(opsOf('store_orders').find((op) => op[0] === 'gte')[2]); };
    assert.ok(Math.abs(await sinceFor({}) - (Date.now() - 7 * 86400000)) < 5000, 'por defecto 7');
    assert.ok(Math.abs(await sinceFor({ days: 'x' }) - (Date.now() - 7 * 86400000)) < 5000, 'inválido → 7');
    assert.ok(Math.abs(await sinceFor({ days: 500 }) - (Date.now() - 90 * 86400000)) < 5000, 'tope de 90 días');
    assert.deepEqual(calls.storage, []);
});

test('las lecturas públicas no lanzan y las escrituras validan antes de tocar PostgREST', async () => {
    const { client, calls } = fakeClient((state) => (state.table.startsWith('rpc/') ? { data: null, error: { code: '500', message: 'boom' } } : { data: [], error: null }));
    const warn = console.warn;
    console.warn = () => {};
    try {
        const Store = loadRepo({ _supabase: client, location: { pathname: '/' } });
        assert.equal(await Store.getStorefront('artist', 'alguien'), null);
        assert.equal(await Store.getPublicProduct('x'), null);
        assert.equal(await Store.verifyLicense('WOL-ABCD-1234'), null);
        assert.deepEqual(JSON.parse(JSON.stringify(await Store.verifyLicense('no-es-un-código'))), { found: false, valid: false });
        const before = calls.queries.length;
        await assert.rejects(Store.createProduct({ seller_type: 'artist', seller_id: 'u', kind: 'otro', title: 'X' }), (err) => err.validation === true);
        await assert.rejects(Store.setProductStatus('p', 'borrado'), (err) => err.validation === true);
        await assert.rejects(Store.saveVariants('p', [{ label: '  ' }]), (err) => err.validation === true);
        assert.equal(calls.queries.length, before + 1, 'solo saveVariants leyó las variantes actuales');
        assert.deepEqual(calls.storage, []);
    } finally {
        console.warn = warn;
    }
    // Contrato de capa de datos: sin REST inline ni _supabase.from disperso.
    const src = read('public/shared/js/data/store-repo.js');
    assert.doesNotMatch(src, /\/rest\/v1\//);
    assert.doesNotMatch(src, /_supabase\.from\(/);
    assert.doesNotMatch(src, /\.(overlaps|textSearch)\(/);
});
