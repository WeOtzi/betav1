'use strict';

// Store · lado servidor (docs/plans/2026-10-30-store-artista.md §7).
// Handlers con deps falsas (sin red), firma de Storage y repo con fetch
// mockeado, registro de adaptadores y un test de fuente sobre server.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-key';

const { signStorageObject } = require('../lib/storage-sign');
const { StoreRepo, storeErrorCode } = require('../lib/repos/store');
const storePayments = require('../services/store-payments');
const storeOrders = require('../services/store-orders');

const { createRegistry, verifyHmacSignature, manualProvider } = storePayments;
const { createHandlers, isStoreWebhookRequest, safeTokenEqual } = storeOrders;
const crypto = require('node:crypto');

const LICENSE_ID = '0b6f1c1e-3f5a-4c39-9b4c-1d2e3f4a5b6c';
const ASSET_ID = '7d1e2f3a-4b5c-4d6e-8f70-112233445566';
const PRODUCT_ID = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const ORDER_ID = 'c0ffee00-1234-4abc-9def-001122334455';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const FIXED_NOW = new Date('2026-10-30T12:00:00.000Z');

function fakeRes() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        json(body) { this.body = body; return this; },
    };
}

const silentLogger = { error() {}, warn() {}, log() {} };

function fakeRepo(overrides = {}) {
    const calls = { inserted: [], deleted: [], counted: [], maintenance: 0, confirmed: [] };
    const repo = {
        calls,
        async getLicenseForHolder(licenseId, userId) {
            return licenseId === LICENSE_ID && userId === USER_ID
                ? { id: LICENSE_ID, order_id: ORDER_ID, product_id: PRODUCT_ID, holder_user_id: USER_ID, revoked_at: null, access: 'holder' }
                : null;
        },
        async getAsset(assetId) {
            return assetId === ASSET_ID
                ? { id: ASSET_ID, product_id: PRODUCT_ID, kind: 'original', storage_path: `seller/${PRODUCT_ID}/original/1700000000000-luna.png`, file_name: 'luna.png', mime_type: 'image/png' }
                : null;
        },
        async countDownloadsToday(licenseId, opts) { calls.counted.push({ licenseId, opts }); return 3; },
        async insertDownloadEvent(event) { calls.inserted.push(event); return { id: 'ev-' + calls.inserted.length }; },
        async deleteDownloadEvent(id) { calls.deleted.push(id); },
        async runMaintenance() { calls.maintenance += 1; return { expired: 1, flagged: 0, delivered: 2, released: 0, failed: [] }; },
        async confirmProviderPayment(args) { calls.confirmed.push(args); return { id: args.orderId, status: 'fulfilled' }; },
        async getOrderWithItems(id) {
            return id === ORDER_ID
                ? {
                    id: ORDER_ID, order_number: 'ST-ABCD1234', buyer_user_id: USER_ID, status: 'pending_payment',
                    currency: 'USD', total_amount: 50, payment_provider: 'manual', expected_collector: 'seller',
                    payment_instructions: 'Transferí USD 50 al alias luna.tattoo', seller_contact: '@luna en Instagram',
                    expires_at: '2026-10-31T12:00:00.000Z',
                    items: [{ kind: 'design', title: 'Luna', license_tier: 'personal', quantity: 1, unit_price: 50, line_total: 50 }],
                }
                : null;
        },
        ...overrides,
    };
    return repo;
}

function handlersWith({ user = { id: USER_ID }, repo = fakeRepo(), providers, env = { CRON_API_TOKEN: 'cron-secret' }, sign } = {}) {
    const signCalls = [];
    const handlers = createHandlers({
        resolveUser: async () => user,
        repo,
        providers: providers || (() => { const r = createRegistry(); r.registerProvider(manualProvider); return r; })(),
        now: () => FIXED_NOW,
        env,
        sign: sign || (async (bucket, objectPath, opts) => {
            signCalls.push({ bucket, objectPath, opts });
            return `https://test.supabase.co/storage/v1/object/sign/${bucket}/${objectPath}?token=t&download=${encodeURIComponent(opts.download)}`;
        }),
        logger: silentLogger,
    });
    return { handlers, repo, signCalls };
}

function downloadReq(params = { licenseId: LICENSE_ID, assetId: ASSET_ID }) {
    return { headers: { authorization: 'Bearer token' }, params };
}

// ---------------------------------------------------------------------------
// lib/storage-sign.js
// ---------------------------------------------------------------------------

function mockFetch(responder) {
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url, opts) => {
        calls.push({ url, opts });
        const { status = 200, body = '{}', contentRange = null } = responder(url, opts) || {};
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (h) => (h.toLowerCase() === 'content-range' ? contentRange : null) },
            text: async () => body,
            json: async () => JSON.parse(body),
        };
    };
    return { calls, restore: () => { global.fetch = original; } };
}

test('signStorageObject firma con service role y arma el href con &download=', async () => {
    const objectPath = `seller/${PRODUCT_ID}/original/1700000000000-mi diseño.png`;
    const mock = mockFetch(() => ({ body: JSON.stringify({ signedURL: `/object/sign/store-design-files/${objectPath}?token=abc.def` }) }));
    try {
        const href = await signStorageObject('store-design-files', objectPath, { expiresIn: 300, download: 'mi diseño & co.png' });
        const { url, opts } = mock.calls[0];
        assert.equal(url, `https://test.supabase.co/storage/v1/object/sign/store-design-files/${encodeURI(objectPath)}`);
        assert.equal(opts.method, 'POST');
        assert.deepEqual(JSON.parse(opts.body), { expiresIn: 300 });
        assert.equal(opts.headers.apikey, 'service-key');
        assert.equal(opts.headers.Authorization, 'Bearer service-key');
        assert.equal(href, `https://test.supabase.co/storage/v1/object/sign/store-design-files/${encodeURI(objectPath)}?token=abc.def&download=${encodeURIComponent('mi diseño & co.png')}`);
        assert.match(href, /&download=mi%20dise%C3%B1o%20%26%20co\.png$/);
    } finally {
        mock.restore();
    }
});

test('signStorageObject rechaza paths peligrosos y expiresIn inválido sin llamar a la red', async () => {
    const mock = mockFetch(() => ({ body: '{}' }));
    try {
        for (const bad of ['../otro/archivo.png', '/abs/archivo.png', 'a//b.png', 'a/b.png?x=1', 'a/b#c.png', 'a/%2e%2e/b.png', 'a\\b.png']) {
            await assert.rejects(signStorageObject('store-design-files', bad, { expiresIn: 300 }), /Invalid storage path/);
        }
        await assert.rejects(signStorageObject('Store Files', 'a/b.png', { expiresIn: 300 }), /Invalid storage bucket/);
        await assert.rejects(signStorageObject('store-design-files', 'a/b.png', { expiresIn: 0 }), /expiresIn/);
        await assert.rejects(signStorageObject('store-design-files', 'a/b.png', {}), /expiresIn/);
        assert.equal(mock.calls.length, 0);
    } finally {
        mock.restore();
    }
});

test('signStorageObject propaga el fallo de Storage como error (sin href)', async () => {
    const mock = mockFetch(() => ({ status: 400, body: '{"error":"not_found"}' }));
    try {
        await assert.rejects(signStorageObject('store-design-files', 'a/b.png', { expiresIn: 300 }), (e) => e.code === 'STORAGE_SIGN_FAILED');
    } finally {
        mock.restore();
    }
});

// ---------------------------------------------------------------------------
// lib/repos/store.js (fetch mockeado)
// ---------------------------------------------------------------------------

test('repo: mantenimiento y confirmación de proveedor van por RPC con service role', async () => {
    const mock = mockFetch((url) => ({ body: url.includes('run_store_maintenance') ? '{"expired":0,"flagged":0,"delivered":0,"released":0,"failed":[]}' : '{"id":"x"}' }));
    try {
        const result = await StoreRepo.runMaintenance();
        assert.deepEqual(result.failed, []);
        await StoreRepo.confirmProviderPayment({ orderId: ORDER_ID, provider: 'stripe', reference: 'pi_1', amount: 50, currency: 'USD' });
        assert.equal(mock.calls[0].url, 'https://test.supabase.co/rest/v1/rpc/run_store_maintenance');
        assert.equal(mock.calls[0].opts.method, 'POST');
        assert.equal(mock.calls[1].url, 'https://test.supabase.co/rest/v1/rpc/confirm_store_order_payment_as_provider');
        assert.deepEqual(JSON.parse(mock.calls[1].opts.body), { p_order_id: ORDER_ID, p_provider: 'stripe', p_reference: 'pi_1', p_amount: 50, p_currency: 'USD' });
        assert.equal(mock.calls[1].opts.headers.apikey, 'service-key');
    } finally {
        mock.restore();
    }
});

test('repo: getLicenseForHolder acepta titular o comprador y nada más; selects explícitos', async () => {
    const otherHolder = '99999999-2222-4333-8444-555555555555';
    const mock = mockFetch((url) => {
        if (url.includes('/store_licenses?')) {
            return { body: JSON.stringify([{ id: LICENSE_ID, order_id: ORDER_ID, product_id: PRODUCT_ID, holder_user_id: otherHolder, revoked_at: null }]) };
        }
        if (url.includes('/store_orders?')) return { body: JSON.stringify([{ id: ORDER_ID, buyer_user_id: USER_ID }]) };
        return { body: '[]' };
    });
    try {
        assert.equal((await StoreRepo.getLicenseForHolder(LICENSE_ID, otherHolder)).access, 'holder');
        assert.equal((await StoreRepo.getLicenseForHolder(LICENSE_ID, USER_ID)).access, 'buyer');
        assert.equal(await StoreRepo.getLicenseForHolder(LICENSE_ID, '00000000-0000-4000-8000-000000000000'), null);
        for (const call of mock.calls) {
            assert.doesNotMatch(call.url, /select=\*/);
            assert.match(call.url, /select=/);
        }
        assert.match(mock.calls[0].url, /select=id%2Corder_id%2Corder_item_id%2Cproduct_id%2Ctier%2Cholder_user_id%2Crevoked_at/);
    } finally {
        mock.restore();
    }
});

test('repo: countDownloadsToday filtra por licencia y ventana y lee el total de Content-Range', async () => {
    const mock = mockFetch(() => ({ body: '[{"id":"a"}]', contentRange: '0-0/51' }));
    try {
        const count = await StoreRepo.countDownloadsToday(LICENSE_ID, { since: '2026-10-29T12:00:00.000Z' });
        assert.equal(count, 51);
        const { url, opts } = mock.calls[0];
        assert.match(url, /\/rest\/v1\/store_download_events\?/);
        assert.match(url, new RegExp(`license_id=eq\\.${LICENSE_ID}`));
        assert.match(url, /created_at=gte\.2026-10-29T12%3A00%3A00\.000Z/);
        assert.match(opts.headers.Prefer, /count=exact/);
    } finally {
        mock.restore();
    }
});

test('repo: insertDownloadEvent devuelve el id insertado y deleteDownloadEvent borra solo esa fila', async () => {
    const mock = mockFetch((url, opts) => (opts.method === 'POST'
        ? { status: 201, body: '[{"id":"ev-1"}]' }
        : { status: 204, body: '' }));
    try {
        const event = await StoreRepo.insertDownloadEvent({ licenseId: LICENSE_ID, assetId: ASSET_ID, userId: USER_ID });
        assert.deepEqual(event, { id: 'ev-1' });
        const insert = mock.calls[0];
        assert.equal(insert.opts.method, 'POST');
        assert.match(insert.url, /\/rest\/v1\/store_download_events\?select=id$/);
        assert.match(insert.opts.headers.Prefer, /return=representation/);
        assert.deepEqual(JSON.parse(insert.opts.body), { license_id: LICENSE_ID, asset_id: ASSET_ID, user_id: USER_ID });

        await StoreRepo.deleteDownloadEvent('ev-1');
        const del = mock.calls[1];
        assert.equal(del.opts.method, 'DELETE');
        assert.match(del.url, /\/rest\/v1\/store_download_events\?id=eq\.ev-1$/);
    } finally {
        mock.restore();
    }
});

test('storeErrorCode extrae el código store:* del error de PostgREST', () => {
    assert.equal(storeErrorCode(new Error('PostgREST POST rpc/x failed (400): {"code":"P0001","message":"store:order_not_payable"}')), 'order_not_payable');
    assert.equal(storeErrorCode(new Error('boom')), null);
});

// ---------------------------------------------------------------------------
// services/store-payments.js
// ---------------------------------------------------------------------------

test('registerProvider rechaza interfaces incompletas', () => {
    const registry = createRegistry();
    const base = { id: 'stripe', label: 'Stripe', isConfigured: () => true, createCheckout: () => ({ mode: 'redirect', redirectUrl: 'https://pay.example' }) };
    assert.throws(() => registry.registerProvider(null), /objeto/);
    assert.throws(() => registry.registerProvider({ ...base, id: 'paypal' }), /id no soportado/);
    assert.throws(() => registry.registerProvider({ ...base, label: '' }), /label/);
    assert.throws(() => registry.registerProvider({ ...base, isConfigured: undefined }), /isConfigured/);
    assert.throws(() => registry.registerProvider({ ...base, createCheckout: 'no' }), /createCheckout/);
    assert.throws(() => registry.registerProvider({ ...base, parseWebhook: () => null }), /verifyWebhook/);
    assert.throws(() => registry.registerProvider({ ...base, parseWebhook: () => null, verifyWebhook: true }), /verifyWebhook/);
    assert.equal(registry.getProvider('stripe'), null, 'ninguna interfaz inválida quedó registrada');

    const ok = registry.registerProvider({ ...base, parseWebhook: () => null, verifyWebhook: () => false });
    assert.ok(Object.isFrozen(ok));
    assert.throws(() => registry.registerProvider(base), /ya hay un adaptador/);
    assert.deepEqual(registry.listProviders(), [{ id: 'stripe', label: 'Stripe', configured: true, webhooks: true }]);
});

test('el registro por defecto solo trae manual, sin webhook', () => {
    assert.deepEqual(storePayments.listProviders(), [{ id: 'manual', label: 'Pago manual', configured: true, webhooks: false }]);
    assert.equal(storePayments.getProvider('manual').parseWebhook, undefined);
    assert.equal(storePayments.getProvider('stripe'), null);
    assert.deepEqual(manualProvider.createCheckout({ payment_instructions: 'Alias x' }), { mode: 'manual', instructions: 'Alias x' });
});

test('verifyHmacSignature compara en tiempo constante y rechaza firmas ajenas', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = crypto.createHmac('sha256', 's3cret').update(raw).digest('hex');
    assert.equal(verifyHmacSignature({ rawBody: raw, signature: sig, secret: 's3cret' }), true);
    assert.equal(verifyHmacSignature({ rawBody: raw, signature: sig, secret: 'otro' }), false);
    assert.equal(verifyHmacSignature({ rawBody: raw, signature: sig.slice(0, 10), secret: 's3cret' }), false);
    assert.equal(verifyHmacSignature({ rawBody: raw, signature: 'zz', secret: 's3cret' }), false);
    assert.equal(verifyHmacSignature({ rawBody: '{"a":1}', signature: sig, secret: 's3cret' }), false);
    assert.equal(verifyHmacSignature({ rawBody: raw, signature: sig, secret: '' }), false);
});

// ---------------------------------------------------------------------------
// Descarga firmada
// ---------------------------------------------------------------------------

test('descarga: 401 sin sesión, sin tocar el repo', async () => {
    const repo = fakeRepo({ getLicenseForHolder: async () => { throw new Error('no debería consultarse'); } });
    const { handlers } = handlersWith({ user: null, repo });
    const res = fakeRes();
    await handlers.handleDownloadUrl(downloadReq(), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /Iniciá sesión/);
});

test('descarga: 400 con ids que no son UUID', async () => {
    const { handlers } = handlersWith();
    const res = fakeRes();
    await handlers.handleDownloadUrl(downloadReq({ licenseId: "1' or 1=1", assetId: ASSET_ID }), res);
    assert.equal(res.statusCode, 400);
});

test('descarga: 403 si la licencia no es del titular ni del comprador', async () => {
    const { handlers, repo } = handlersWith({ user: { id: '00000000-0000-4000-8000-000000000000' } });
    const res = fakeRes();
    await handlers.handleDownloadUrl(downloadReq(), res);
    assert.equal(res.statusCode, 403);
    assert.equal(repo.calls.inserted.length, 0);
});

test('descarga: 410 si la licencia está revocada', async () => {
    const repo = fakeRepo({ getLicenseForHolder: async () => ({ id: LICENSE_ID, product_id: PRODUCT_ID, holder_user_id: USER_ID, revoked_at: '2026-10-29T10:00:00Z' }) });
    const { handlers } = handlersWith({ repo });
    const res = fakeRes();
    await handlers.handleDownloadUrl(downloadReq(), res);
    assert.equal(res.statusCode, 410);
    assert.equal(repo.calls.inserted.length, 0);
});

test('descarga: 404 si el asset no existe o es de otro producto', async () => {
    const otherProduct = fakeRepo({ getAsset: async () => ({ id: ASSET_ID, product_id: '22222222-2222-4222-8222-222222222222', kind: 'original', storage_path: 'x/y/original/1-a.png', file_name: 'a.png' }) });
    for (const repo of [otherProduct, fakeRepo({ getAsset: async () => null })]) {
        const { handlers, signCalls } = handlersWith({ repo });
        const res = fakeRes();
        await handlers.handleDownloadUrl(downloadReq(), res);
        assert.equal(res.statusCode, 404);
        assert.equal(repo.calls.inserted.length, 0);
        assert.equal(signCalls.length, 0);
    }
});

test('descarga: 429 al llegar a 50 descargas en 24 h (y si el conteo no es número)', async () => {
    for (const value of [50, 51, NaN, undefined]) {
        const repo = fakeRepo({ countDownloadsToday: async () => value });
        const { handlers, signCalls } = handlersWith({ repo });
        const res = fakeRes();
        await handlers.handleDownloadUrl(downloadReq(), res);
        assert.equal(res.statusCode, 429, `conteo ${value}`);
        assert.match(res.body.error, /50 descargas/);
        assert.equal(repo.calls.inserted.length, 0);
        assert.equal(signCalls.length, 0);
    }
});

test('descarga: si al recontar con la fila propia se pasa del tope, la borra y responde 429 sin firmar', async () => {
    const counts = [49, 51];
    const repo = fakeRepo({ countDownloadsToday: async () => counts.shift() });
    const { handlers, signCalls } = handlersWith({ repo });
    const res = fakeRes();
    await handlers.handleDownloadUrl(downloadReq(), res);
    assert.equal(res.statusCode, 429);
    assert.match(res.body.error, /50 descargas/);
    assert.equal(repo.calls.inserted.length, 1);
    assert.deepEqual(repo.calls.deleted, ['ev-1']);
    assert.equal(signCalls.length, 0);
});

test('descarga: con requests en paralelo nunca se emiten más de 50 URLs por licencia', async () => {
    // Log compartido en memoria con un tick entre cada lectura y escritura,
    // para que las requests se intercalen como en PostgREST.
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const rows = Array.from({ length: 45 }, (_, i) => ({ id: 'old-' + i }));
    let seq = 0;
    const repo = fakeRepo({
        async countDownloadsToday() { await tick(); const n = rows.length; await tick(); return n; },
        async insertDownloadEvent() { await tick(); const row = { id: 'new-' + (++seq) }; rows.push(row); return { id: row.id }; },
        async deleteDownloadEvent(id) { await tick(); const i = rows.findIndex((r) => r.id === id); if (i > -1) rows.splice(i, 1); },
    });
    const { handlers, signCalls } = handlersWith({ repo });

    const burst = await Promise.all(Array.from({ length: 12 }, async () => {
        const res = fakeRes();
        await handlers.handleDownloadUrl(downloadReq(), res);
        return res.statusCode;
    }));
    const ok = burst.filter((s) => s === 200).length;
    assert.ok(burst.every((s) => s === 200 || s === 429), burst.join(','));
    assert.ok(45 + ok <= 50, `se emitieron ${ok} URLs con 45 ya usadas`);
    assert.equal(rows.length, 45 + ok, 'las filas rechazadas se borran');
    assert.equal(signCalls.length, ok);

    // En serie se llega exactamente al tope y la siguiente es 429.
    const statuses = [];
    for (let i = 0; i < 6; i++) {
        const res = fakeRes();
        await handlers.handleDownloadUrl(downloadReq(), res);
        statuses.push(res.statusCode);
    }
    assert.equal(rows.length, 50);
    assert.equal(statuses[statuses.length - 1], 429);
});

test('descarga: 200 registra el evento y firma 300 s fijos con el nombre de descarga', async () => {
    const { handlers, repo, signCalls } = handlersWith();
    const res = fakeRes();
    await handlers.handleDownloadUrl({ ...downloadReq(), body: { expiresIn: 99999 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.expires_in, 300);
    assert.match(res.body.url, /^https:\/\/test\.supabase\.co\/storage\/v1\/object\/sign\/store-design-files\//);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(repo.calls.inserted, [{ licenseId: LICENSE_ID, assetId: ASSET_ID, userId: USER_ID }]);
    assert.deepEqual(signCalls, [{ bucket: 'store-design-files', objectPath: `seller/${PRODUCT_ID}/original/1700000000000-luna.png`, opts: { expiresIn: 300, download: 'luna.png' } }]);
    assert.equal(repo.calls.counted[0].opts.since, '2026-10-29T12:00:00.000Z');
});

test('descarga: el nombre de descarga es la base sanitizada + la extensión del MIME real', async () => {
    const { downloadFileName } = storeOrders;
    const name = (file_name, mime_type, kind = 'original') => downloadFileName({ file_name, mime_type, kind });
    assert.equal(name('luna.png', 'image/png'), 'luna.png');
    assert.equal(name('Mi Diseño Final (v2).PNG', 'image/png'), 'Mi-Diseno-Final-v2.png', 'base con sanitizeFilename y extensión en minúscula');
    assert.equal(name('foto.jpeg', 'image/jpeg'), 'foto.jpeg', 'conserva una extensión propia del MIME');
    assert.equal(name('Capa.PSB', 'image/vnd.adobe.photoshop'), 'Capa.psb');
    assert.equal(name('arte.procreate', 'application/zip'), 'arte.procreate');
    assert.equal(name('scan.png', 'image/jpeg'), 'scan.jpg', 'otra extensión conocida se reemplaza por la del MIME');
    assert.equal(name('x.png.exe', 'image/png'), 'x.png.exe.png', 'una extensión desconocida no manda');
    assert.equal(name('"../evil\r\n.pdf', 'application/pdf'), 'evil.pdf', 'sin comillas, barras ni controles');
    assert.equal(name('mi diseño & co.png', 'image/png'), 'mi-diseno-co.png');
    assert.equal(name('x.png', 'IMAGE/PNG; charset=binary'), 'x.png', 'MIME normalizado');
    assert.equal(name('', 'image/tiff', 'stencil'), 'stencil.tiff', 'sin nombre usa el kind');
    assert.equal(name('.png', 'image/png'), 'original.png');
    // Un MIME fuera de store-design-files (o sin MIME) nunca baja con su extensión.
    assert.equal(name('x.svg', 'image/svg+xml'), 'x.bin');
    assert.equal(name('x.html', null), 'x.html.bin');
    assert.equal(downloadFileName(null), 'archivo.bin');
    const long = name('a'.repeat(300) + '.png', 'image/png');
    assert.ok(long.length <= 130 && long.endsWith('.png'), long.length);

    // Con el handler: se firma con el nombre normalizado, no con file_name crudo.
    const repo = fakeRepo({ getAsset: async () => ({ id: ASSET_ID, product_id: PRODUCT_ID, kind: 'original', storage_path: `seller/${PRODUCT_ID}/original/1-x.png`, file_name: 'x.png.exe', mime_type: 'image/png' }) });
    const { handlers, signCalls } = handlersWith({ repo });
    const res = fakeRes();
    await handlers.handleDownloadUrl(downloadReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(signCalls[0].opts.download, 'x.png.exe.png');
});

test('descarga: las extensiones por MIME son las del guard SQL y coinciden con EXTENSION_MIME del modelo', () => {
    const { DOWNLOAD_EXTENSIONS } = storeOrders;
    const M = require('../public/shared/js/store-model.js');
    for (const [mime, exts] of Object.entries(DOWNLOAD_EXTENSIONS)) {
        assert.ok(exts.length > 0, mime);
        for (const ext of exts) assert.equal(M.FILES.EXTENSION_MIME[ext], mime, `${ext} → ${mime}`);
    }
    // Cubre exactamente los MIME de store-design-files (originales y stencils).
    const bucket = [...new Set([...M.FILES.ORIGINAL_MIME, ...M.FILES.STENCIL_MIME])].sort();
    assert.deepEqual(Object.keys(DOWNLOAD_EXTENSIONS).sort(), bucket);

    // Mismo mapa y mismo orden (la primera es la preferida) que v_exts en store_design_assets_guard.
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261030150000_store_core.sql'), 'utf8');
    const guard = sql.slice(sql.indexOf('create or replace function public.store_design_assets_guard()'));
    const block = guard.slice(guard.indexOf('v_exts := case new.mime_type'), guard.indexOf('end;', guard.indexOf('v_exts := case new.mime_type')));
    const fromSql = {};
    for (const m of block.matchAll(/when '([^']+)' then array\[([^\]]+)\]/g)) {
        fromSql[m[1]] = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    }
    assert.ok(Object.keys(fromSql).length === 8, 'v_exts del guard');
    assert.deepEqual(JSON.parse(JSON.stringify(DOWNLOAD_EXTENSIONS)), fromSql);
});

test('descarga: un fallo interno responde 500 genérico sin filtrar el detalle', async () => {
    const { handlers } = handlersWith({ sign: async () => { throw new Error('Storage sign failed (500): secret-internal-detail'); } });
    const res = fakeRes();
    await handlers.handleDownloadUrl(downloadReq(), res);
    assert.equal(res.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /secret-internal-detail|Storage/);
});

// ---------------------------------------------------------------------------
// Mantenimiento por cron
// ---------------------------------------------------------------------------

test('mantenimiento: token correcto corre la RPC', async () => {
    const { handlers, repo } = handlersWith();
    const res = fakeRes();
    await handlers.handleMaintenance({ headers: { 'x-cron-token': 'cron-secret' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.result.failed, []);
    assert.equal(repo.calls.maintenance, 1);
});

test('mantenimiento: token incorrecto o ausente responde 401 sin correr nada', async () => {
    for (const headers of [{ 'x-cron-token': 'cron-secreT' }, { 'x-cron-token': 'cron-secret-extra' }, { 'x-cron-token': '' }, {}, { 'x-cron-token': ['cron-secret'] }]) {
        const { handlers, repo } = handlersWith();
        const res = fakeRes();
        await handlers.handleMaintenance({ headers }, res);
        assert.equal(res.statusCode, 401);
        assert.equal(repo.calls.maintenance, 0);
    }
});

test('mantenimiento: sin CRON_API_TOKEN en el entorno responde 503', async () => {
    const { handlers, repo } = handlersWith({ env: {} });
    const res = fakeRes();
    await handlers.handleMaintenance({ headers: { 'x-cron-token': '' } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(repo.calls.maintenance, 0);
});

test('mantenimiento: error de la RPC responde 500 genérico', async () => {
    const repo = fakeRepo({ runMaintenance: async () => { throw new Error('PostgREST failed: detalle interno'); } });
    const { handlers } = handlersWith({ repo });
    const res = fakeRes();
    await handlers.handleMaintenance({ headers: { 'x-cron-token': 'cron-secret' } }, res);
    assert.equal(res.statusCode, 500);
    assert.doesNotMatch(res.body.error, /detalle interno/);
});

test('safeTokenEqual compara con hash y timingSafeEqual', () => {
    assert.equal(safeTokenEqual('abc', 'abc'), true);
    assert.equal(safeTokenEqual('abc', 'abcd'), false);
    assert.equal(safeTokenEqual(undefined, 'abc'), false);
    assert.equal(safeTokenEqual('', ''), false);
});

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

test('checkout manual: el comprador dueño recibe las instrucciones del pedido', async () => {
    const { handlers } = handlersWith();
    const res = fakeRes();
    await handlers.handleCheckout({ headers: {}, params: { id: ORDER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, checkout: { mode: 'manual', instructions: 'Transferí USD 50 al alias luna.tattoo' } });
});

test('checkout: 401 sin sesión, 400 id inválido, 404 si no es el comprador', async () => {
    let res = fakeRes();
    await handlersWith({ user: null }).handlers.handleCheckout({ headers: {}, params: { id: ORDER_ID } }, res);
    assert.equal(res.statusCode, 401);
    res = fakeRes();
    await handlersWith().handlers.handleCheckout({ headers: {}, params: { id: 'nope' } }, res);
    assert.equal(res.statusCode, 400);
    res = fakeRes();
    await handlersWith({ user: { id: '00000000-0000-4000-8000-000000000000' } }).handlers.handleCheckout({ headers: {}, params: { id: ORDER_ID } }, res);
    assert.equal(res.statusCode, 404);
});

test('checkout: 409 si el pedido no está pending_payment o ya venció', async () => {
    const base = await fakeRepo().getOrderWithItems(ORDER_ID);
    for (const order of [{ ...base, status: 'paid' }, { ...base, expires_at: '2026-10-30T11:59:59.000Z' }]) {
        const { handlers } = handlersWith({ repo: fakeRepo({ getOrderWithItems: async () => order }) });
        const res = fakeRes();
        await handlers.handleCheckout({ headers: {}, params: { id: ORDER_ID } }, res);
        assert.equal(res.statusCode, 409);
    }
});

test('checkout: proveedor no registrado o sin configurar responde 503; redirect no https se rechaza', async () => {
    const base = await fakeRepo().getOrderWithItems(ORDER_ID);
    const stripeRepo = fakeRepo({ getOrderWithItems: async () => ({ ...base, payment_provider: 'stripe' }) });

    let res = fakeRes();
    await handlersWith({ repo: stripeRepo }).handlers.handleCheckout({ headers: {}, params: { id: ORDER_ID } }, res);
    assert.equal(res.statusCode, 503);

    const off = createRegistry();
    off.registerProvider({ id: 'stripe', label: 'Stripe', isConfigured: () => false, createCheckout: () => ({ mode: 'redirect', redirectUrl: 'https://pay.example' }) });
    res = fakeRes();
    await handlersWith({ repo: stripeRepo, providers: off }).handlers.handleCheckout({ headers: {}, params: { id: ORDER_ID } }, res);
    assert.equal(res.statusCode, 503);

    const unsafe = createRegistry();
    let received = null;
    unsafe.registerProvider({ id: 'stripe', label: 'Stripe', isConfigured: () => true, createCheckout: (order) => { received = order; return { mode: 'redirect', redirectUrl: 'javascript:alert(1)' }; } });
    res = fakeRes();
    await handlersWith({ repo: stripeRepo, providers: unsafe }).handlers.handleCheckout({ headers: {}, params: { id: ORDER_ID } }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(received.buyer_user_id, undefined, 'el adaptador no recibe ids de usuario');
    assert.equal(received.order_number, 'ST-ABCD1234');
});

// ---------------------------------------------------------------------------
// Webhook de pagos
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'whsec_test';

function fakeStripeRegistry() {
    const registry = createRegistry();
    registry.registerProvider(manualProvider);
    registry.registerProvider({
        id: 'stripe',
        label: 'Stripe (test)',
        isConfigured: () => true,
        createCheckout: () => ({ mode: 'redirect', redirectUrl: 'https://checkout.example/x' }),
        verifyWebhook: (rawBody, headers) => verifyHmacSignature({ rawBody, signature: headers['x-signature'], secret: WEBHOOK_SECRET }),
        parseWebhook: (rawBody) => {
            const data = JSON.parse(rawBody.toString('utf8'));
            if (data.type !== 'payment.succeeded') return null;
            return { kind: 'payment_succeeded', orderId: data.order_id, reference: data.id, amount: data.amount, currency: data.currency };
        },
    });
    return registry;
}

function webhookReq(payload, { provider = 'stripe', secret = WEBHOOK_SECRET, signature } = {}) {
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signature != null ? signature : crypto.createHmac('sha256', secret).update(body).digest('hex');
    return { params: { provider }, headers: { 'x-signature': sig, 'content-type': 'application/json' }, body };
}

const PAID_EVENT = { type: 'payment.succeeded', id: 'pi_123', order_id: ORDER_ID, amount: 50, currency: 'usd' };

test('webhook: 404 sin adaptador con parseWebhook (manual, desconocido o id raro)', async () => {
    for (const provider of ['manual', 'mercado_pago', 'paypal', '../x', 'Stripe']) {
        const { handlers, repo } = handlersWith({ providers: fakeStripeRegistry() });
        const res = fakeRes();
        await handlers.handleWebhook(webhookReq(PAID_EVENT, { provider }), res);
        assert.equal(res.statusCode, 404, provider);
        assert.equal(repo.calls.confirmed.length, 0);
    }
    // Con el registro por defecto (solo manual) cualquier webhook es 404.
    const res = fakeRes();
    await createHandlers({ repo: fakeRepo(), logger: silentLogger }).handleWebhook(webhookReq(PAID_EVENT), res);
    assert.equal(res.statusCode, 404);
});

test('webhook: firma inválida responde 401 y no parsea ni confirma', async () => {
    const { handlers, repo } = handlersWith({ providers: fakeStripeRegistry() });
    for (const req of [webhookReq(PAID_EVENT, { secret: 'otro-secreto' }), webhookReq(PAID_EVENT, { signature: '' })]) {
        const res = fakeRes();
        await handlers.handleWebhook(req, res);
        assert.equal(res.statusCode, 401);
    }
    // Cuerpo alterado después de firmar.
    const tampered = webhookReq(PAID_EVENT);
    tampered.body = Buffer.from(JSON.stringify({ ...PAID_EVENT, amount: 1 }));
    const res = fakeRes();
    await handlers.handleWebhook(tampered, res);
    assert.equal(res.statusCode, 401);
    assert.equal(repo.calls.confirmed.length, 0);
});

test('webhook: firma válida → parseWebhook → confirmProviderPayment → 200', async () => {
    const { handlers, repo } = handlersWith({ providers: fakeStripeRegistry() });
    const res = fakeRes();
    await handlers.handleWebhook(webhookReq(PAID_EVENT), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    assert.deepEqual(repo.calls.confirmed, [{ orderId: ORDER_ID, reference: 'pi_123', amount: 50, currency: 'USD', provider: 'stripe' }]);
});

test('webhook: eventos ignorados, inválidos, vacíos y errores de negocio', async () => {
    const providers = fakeStripeRegistry();

    let ctx = handlersWith({ providers });
    let res = fakeRes();
    await ctx.handlers.handleWebhook(webhookReq({ type: 'customer.created' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ignored, true);
    assert.equal(ctx.repo.calls.confirmed.length, 0);

    res = fakeRes();
    await ctx.handlers.handleWebhook(webhookReq({ ...PAID_EVENT, order_id: 'no-uuid' }), res);
    assert.equal(res.statusCode, 400);

    res = fakeRes();
    await ctx.handlers.handleWebhook({ params: { provider: 'stripe' }, headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 400, 'sin body crudo no hay firma posible');

    ctx = handlersWith({ providers, repo: fakeRepo({ confirmProviderPayment: async () => { throw new Error('PostgREST POST rpc failed (400): {"message":"store:collector_mismatch"}'); } }) });
    res = fakeRes();
    await ctx.handlers.handleWebhook(webhookReq(PAID_EVENT), res);
    assert.equal(res.statusCode, 422);
    assert.doesNotMatch(res.body.error, /collector_mismatch|PostgREST/);

    ctx = handlersWith({ providers, repo: fakeRepo({ confirmProviderPayment: async () => { throw new Error('fetch failed'); } }) });
    res = fakeRes();
    await ctx.handlers.handleWebhook(webhookReq(PAID_EVENT), res);
    assert.equal(res.statusCode, 500);
});

test('webhook: store:cannot_reopen deja un log claro del cobro huérfano y responde 422', async () => {
    const logs = [];
    const handlers = createHandlers({
        resolveUser: async () => null,
        repo: fakeRepo({ confirmProviderPayment: async () => { throw new Error('PostgREST POST rpc/confirm_store_order_payment_as_provider failed (400): {"code":"P0001","message":"store:cannot_reopen"}'); } }),
        providers: fakeStripeRegistry(),
        now: () => FIXED_NOW,
        env: {},
        logger: { error: (...args) => logs.push(args.join(' ')), warn() {}, log() {} },
    });
    const res = fakeRes();
    await handlers.handleWebhook(webhookReq(PAID_EVENT), res);
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.body, { success: false, error: 'No pudimos aplicar el pago a ese pedido.' });
    assert.equal(logs.length, 1, 'un solo log');
    const line = logs[0];
    assert.match(line, /COBRO HUÉRFANO/);
    assert.match(line, /store:cannot_reopen/);
    assert.ok(line.includes(`pedido ${ORDER_ID}`), 'pedido');
    assert.ok(line.includes('proveedor stripe'), 'proveedor');
    assert.ok(line.includes('referencia pi_123'), 'referencia');
    assert.ok(line.includes('USD 50'), 'monto');

    // Otro código de negocio sigue con el log genérico (sin «cobro huérfano»).
    logs.length = 0;
    const other = createHandlers({
        repo: fakeRepo({ confirmProviderPayment: async () => { throw new Error('{"message":"store:collector_mismatch"}'); } }),
        providers: fakeStripeRegistry(),
        logger: { error: (...args) => logs.push(args.join(' ')), warn() {}, log() {} },
    });
    const res2 = fakeRes();
    await other.handleWebhook(webhookReq(PAID_EVENT), res2);
    assert.equal(res2.statusCode, 422);
    assert.doesNotMatch(logs.join('\n'), /HUÉRFANO/);
});

test('isStoreWebhookRequest reconoce la ruta del webhook montada bajo /api/', () => {
    assert.equal(isStoreWebhookRequest({ baseUrl: '/api', path: '/store/payments/webhook/stripe' }), true);
    assert.equal(isStoreWebhookRequest({ baseUrl: '/api', path: '/store/orders/x/checkout' }), false);
    assert.equal(isStoreWebhookRequest({ baseUrl: '/api', path: '/foo/api/store/payments/webhook/x' }), false);
    assert.equal(isStoreWebhookRequest({}), false);
});

// ---------------------------------------------------------------------------
// Test de fuente: cableado en server.js
// ---------------------------------------------------------------------------

test('server.js: el webhook va con body crudo antes de express.json y las rutas usan services/store-orders.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const webhookIndex = source.indexOf("app.post('/api/store/payments/webhook/:provider'");
    const jsonIndex = source.indexOf('app.use(express.json');
    assert.ok(webhookIndex > -1, 'la ruta del webhook existe');
    assert.ok(jsonIndex > -1, 'express.json está montado');
    assert.ok(webhookIndex < jsonIndex, 'el webhook se registra antes de app.use(express.json(...))');
    assert.equal(source.split('app.use(express.json').length - 1, 1, 'un solo express.json global');

    const webhookLine = source.slice(webhookIndex, source.indexOf('\n', webhookIndex));
    assert.match(webhookLine, /storeWebhookLimiter/);
    assert.match(webhookLine, /express\.raw\(\{ type: '\*\/\*', limit: '1mb' \}\)/);
    assert.match(webhookLine, /storeOrders\.handleWebhook\)/);

    assert.match(source, /const storeOrders = require\('\.\/services\/store-orders'\);/);
    assert.match(source, /skip: \(req\) => storeOrders\.isStoreWebhookRequest\(req\)/);
    assert.match(source, /app\.post\('\/api\/store\/licenses\/:licenseId\/assets\/:assetId\/url', storeDownloadLimiter, storeOrders\.handleDownloadUrl\);/);
    assert.match(source, /app\.post\('\/api\/store\/orders\/:id\/checkout', storeOrders\.handleCheckout\);/);
    assert.match(source, /app\.post\('\/api\/store\/maintenance', storeOrders\.handleMaintenance\);/);

    // El require tiene que estar antes de apiLimiter (el skip lo usa al crear el limiter).
    assert.ok(source.indexOf("require('./services/store-orders')") < source.indexOf('const apiLimiter = rateLimit('));
    // Nada de firmar Storage inline en server.js.
    assert.doesNotMatch(source, /storage\/v1\/object\/sign/);
});
