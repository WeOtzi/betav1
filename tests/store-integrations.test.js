'use strict';
// Store del artista · integraciones en archivos compartidos
// (docs/plans/2026-10-30-store-artista.md §8.5): gate común, banda del perfil
// público, menú Ö, topbars de cliente, pestaña STORE de soporte, wallet,
// features.store en app-config y el limiter propio de las descargas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const M = require('../public/shared/js/store-model.js');
const W = require('../public/shared/js/wallet-model.js');

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function settle(times = 6) { for (let i = 0; i < times; i++) await flush(); }

/* ------------------------------ DOM mínimo ------------------------------ */
function fakeElement(attrs = {}) {
    const el = {
        hidden: attrs.hidden !== false,
        innerHTML: '',
        textContent: '',
        attributes: Object.assign({}, attrs.attributes || {}),
        dataset: {},
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
        setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'href') this.href = String(value); },
        querySelectorAll() { return []; }
    };
    if (el.attributes.href) el.href = el.attributes.href;
    return el;
}

/* ------------------------------ app-config ------------------------------ */
test('app-config: features.store nace en false dentro del objeto features y el repo lo lee con getValue', () => {
    const config = JSON.parse(read('public/shared/js/app-config.json'));
    assert.equal(config.features.store, false);
    assert.equal(config.features.demoMode, false, 'el resto de features no cambia');
    const repo = read('public/shared/js/data/store-repo.js');
    assert.match(repo, /CM\.getValue\('features\.store', false\) === true/);
});

/* ------------------------------ store-entry.js ------------------------------ */
function runStoreEntry({ flag = false, preview = false, store = null, basePath = '' } = {}) {
    const links = [
        fakeElement({ attributes: { href: '/store/purchases/', 'data-store-entry': '' } }),
        fakeElement({ attributes: { href: '/store/purchases/', 'data-store-entry': '' } })
    ];
    const document = {
        readyState: 'complete',
        addEventListener() {},
        querySelectorAll(selector) { return selector === '[data-store-entry]' ? links : []; }
    };
    const window = {
        WEOTZI_PREVIEW: preview,
        WEOTZI_BASE_PATH: basePath,
        ConfigManager: {
            ready: () => Promise.resolve(),
            getValue: (key, fallback) => (key === 'features.store' ? flag : fallback)
        },
        WeotziData: store ? { Store: store } : {}
    };
    const sandbox = { window, document, console, setTimeout, Promise };
    vm.runInNewContext(read('public/shared/js/store-entry.js'), sandbox, { filename: 'store-entry.js' });
    return { links, window };
}

test('store-entry: sin el flag los links [data-store-entry] siguen ocultos', async () => {
    const { links } = runStoreEntry({ flag: false });
    await settle();
    assert.ok(links.every((l) => l.hidden === true));
});

test('store-entry: con el flag y sin repo aparece el link y respeta el base path', async () => {
    const { links } = runStoreEntry({ flag: true, basePath: '/beta' });
    await settle();
    assert.ok(links.every((l) => l.hidden === false));
    assert.equal(links[0].getAttribute('href'), '/beta/store/purchases/');
});

test('store-entry: el preview enciende el gate liviano', async () => {
    const { links } = runStoreEntry({ preview: true });
    await settle();
    assert.ok(links.every((l) => l.hidden === false));
});

test('store-entry: con WeotziData.Store usa el gate completo (flag y tablas disponibles)', async () => {
    const off = runStoreEntry({ flag: true, store: { featureEnabled: () => true, isAvailable: () => Promise.resolve(false) } });
    await settle();
    assert.ok(off.links.every((l) => l.hidden === true), 'sin tablas no se muestra');

    const disabled = runStoreEntry({ flag: true, store: { featureEnabled: () => false, isAvailable: () => Promise.resolve(true) } });
    await settle();
    assert.ok(disabled.links.every((l) => l.hidden === true), 'el repo manda sobre el flag liviano');

    const on = runStoreEntry({ store: { featureEnabled: () => true, isAvailable: () => Promise.resolve(true) } });
    await settle();
    assert.ok(on.links.every((l) => l.hidden === false));
    assert.equal(typeof on.window.WeotziStoreEntry.refresh, 'function');
});

/* ------------------------------ topbars de cliente ------------------------------ */
test('topbars de cliente: link «Compras» oculto por defecto y store-entry.js con defer', () => {
    for (const page of ['dashboard', 'chats', 'requests', 'profile']) {
        const html = read(`public/client/${page}/index.html`);
        const nav = html.match(/<nav class="wo-topbar-nav"[^>]*>[\s\S]*?<\/nav>/);
        assert.ok(nav, page + ': nav de cliente');
        assert.match(nav[0], /<a class="wo-topbar-item" href="\/store\/purchases\/" data-store-entry hidden>Compras<\/a>/, page);
        assert.equal((html.match(/data-store-entry/g) || []).length, 1, page + ': un solo link de entrada');
        assert.match(html, /<script src="\/shared\/js\/store-entry\.js" defer><\/script>/, page);
        assert.ok(html.indexOf('/shared/js/config-manager.js') > -1, page + ': config-manager presente');
    }
});

/* ------------------------------ perfil público ------------------------------ */
test('perfil público: banda #store-band oculta entre Portafolio y Residencias, con los scripts de la Store', () => {
    const html = read('public/artist/profile/index.html');
    const band = html.match(/<section class="profile-band store-band reveal-block" id="store-band"[^>]*>/);
    assert.ok(band, 'banda presente');
    assert.match(band[0], /\shidden>$/, 'nace hidden');
    const gallery = html.indexOf('id="block-gallery"');
    const store = html.indexOf('id="store-band"');
    const presence = html.indexOf('id="presence-band"');
    assert.ok(gallery > -1 && gallery < store && store < presence, 'entre la 09 Portafolio y la 10 Residencias');
    assert.match(html, /id="store-band-grid"/);
    assert.match(html, /Ver la Store →/);

    const order = ['/shared/js/data/postgrest-client.js', '/shared/js/store-model.js', '/shared/js/data/store-repo.js', '/shared/js/artist-profile.js'];
    const positions = order.map((src) => html.indexOf(`<script src="${src}"`));
    assert.ok(positions.every((p, i) => p > -1 && (i === 0 || p > positions[i - 1])), 'orden de scripts: ' + positions.join(','));

    const js = read('public/shared/js/artist-profile.js');
    assert.match(js, /void loadStoreBand\(\);/);
    assert.match(js, /getStorefront\('artist', artistData\.username\)/);
    assert.match(js, /const STORE_BAND_MAX_ITEMS = 6;/);
    assert.doesNotMatch(js, /_supabase\.from\(|\/rest\/v1\//);

    const css = read('public/shared/css/artist-profile.css');
    const block = css.slice(css.indexOf('Store (banda 09b)'));
    assert.ok(block.length > 100, 'estilos de la banda');
    assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos');
    assert.doesNotMatch(block, /border-radius/, 'radius 0');
});

// Bloque de la banda de artist-profile.js en un sandbox con DOM y repo falsos.
function loadStoreBand({ gate = true, storefront = null, fail = false } = {}) {
    const js = read('public/shared/js/artist-profile.js');
    const start = js.indexOf('const STORE_BAND_MAX_ITEMS');
    const end = js.indexOf('/**\n * "Dónde tatué"');
    assert.ok(start > -1 && end > start, 'bloque de la banda');
    const escStart = js.indexOf('function escapeHtml(value)');
    const escEnd = js.indexOf('function normalizeUsernameFromUrl');
    const els = {
        'store-band': fakeElement(),
        'store-band-grid': fakeElement({ hidden: false }),
        'store-band-link': fakeElement({ hidden: false, attributes: { href: '/store/' } })
    };
    const calls = [];
    const warnings = [];
    const window = {
        WeotziStoreModel: M,
        ConfigManager: { ready: () => Promise.resolve() },
        WoIcons: { hydrate() {} },
        WeotziData: {
            Store: {
                featureEnabled: () => gate,
                isAvailable: () => Promise.resolve(true),
                previewUrl: (p) => '/shared/assets/' + p,
                getStorefront: (type, handle) => {
                    calls.push([type, handle]);
                    return fail ? Promise.reject(new Error('boom')) : Promise.resolve(storefront);
                }
            }
        }
    };
    const sandbox = {
        window,
        document: { getElementById: (id) => els[id] || null },
        console: { warn: (...args) => warnings.push(args), log() {}, error() {} },
        artistData: { username: 'valen.wo', user_id: 'u1' },
        Promise
    };
    vm.runInNewContext(
        'var artistData = this.artistData;\n' + js.slice(escStart, escEnd) + js.slice(start, end) + '\nthis.loadStoreBand = loadStoreBand;',
        sandbox,
        { filename: 'artist-profile.store-band.js' }
    );
    return { run: () => sandbox.loadStoreBand(), els, calls, warnings };
}

function product(n, extra = {}) {
    return Object.assign({
        id: 'p' + n, kind: n % 2 ? 'design' : 'merch', title: 'Producto ' + n, currency: 'USD',
        price_from: 10 * n, images: [{ path: 'demo/store/p' + n + '.svg', alt: 'Vista ' + n }], variants: []
    }, extra);
}

test('perfil público: sin el gate la banda queda oculta y no se consulta la Store', async () => {
    const band = loadStoreBand({ gate: false, storefront: { products: [product(1)] } });
    await band.run();
    assert.equal(band.els['store-band'].hidden, true);
    assert.equal(band.calls.length, 0);
});

test('perfil público: sin productos la banda queda oculta en silencio', async () => {
    const band = loadStoreBand({ storefront: { seller: { handle: 'valen.wo' }, products: [] } });
    await band.run();
    assert.equal(band.els['store-band'].hidden, true);
    assert.deepEqual(band.calls, [['artist', 'valen.wo']]);
});

test('perfil público: pinta hasta 6 ítems escapados con «Desde …», badges y «Ver la Store →»', async () => {
    const products = [1, 2, 3, 4, 5, 6, 7].map((n) => product(n));
    products[0].title = '<img src=x onerror=alert(1)>';
    products[0].license_exclusive_price = 400;
    products[0].exclusive_available = true;
    const band = loadStoreBand({ storefront: { seller: { handle: 'valen.wo' }, products } });
    await band.run();
    const html = band.els['store-band-grid'].innerHTML;
    assert.equal(band.els['store-band'].hidden, false);
    assert.equal((html.match(/class="store-band-item"/g) || []).length, 6);
    assert.doesNotMatch(html, /<img src=x/, 'el título se escapa');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /Desde USD 10/);
    assert.match(html, /Exclusiva disponible/);
    assert.match(html, /href="\/store\/item\/\?id=p1"/);
    assert.match(html, /src="\/shared\/assets\/demo\/store\/p1\.svg"/);
    assert.equal(band.els['store-band-link'].href, '/store/?artist=valen.wo');
});

test('perfil público: si la Store falla, la banda se oculta y solo deja un warning', async () => {
    const band = loadStoreBand({ fail: true });
    await band.run();
    assert.equal(band.els['store-band'].hidden, true);
    assert.equal(band.warnings.length, 1);
});

/* ------------------------------ menú Ö ------------------------------ */
test('menú Ö: «Mi Store» y «Mis compras» con appPath, solo con el gate', () => {
    const menu = read('public/shared/js/wo-artist-menu.js');
    assert.match(menu, /esc\(appPath\('\/artist\/store'\)\)[^\n]*Mi Store/);
    assert.match(menu, /esc\(appPath\('\/store\/purchases\/'\)\)[^\n]*Mis compras/);
    assert.match(menu, /\(state\.storeOn\s*\n\s*\? '<a class="wo-oam-link" id="wo-oam-my-store"/);
    assert.match(menu, /state\.storeOn = await storeGate\(\);/);
    // Gate: con el repo, featureEnabled + isAvailable; sin repo, el flag o el preview.
    assert.match(menu, /S\.featureEnabled\(\) && \(await S\.isAvailable\(\)\) === true/);
    assert.match(menu, /CM\.getValue\('features\.store', false\) === true/);
    assert.match(menu, /window\.WEOTZI_PREVIEW === true \|\| \(window\.WoDemo && window\.WoDemo\.enabled\)/);
    // El repo de la Store solo se carga con el flag encendido.
    assert.match(menu, /storeFlag\(\) \? loadCounterRepository\('\/shared\/js\/store-model\.js'/);
    assert.match(menu, /loadCounterRepository\('\/shared\/js\/data\/store-repo\.js'/);
});

test('menú Ö: fuente store con pagos informados, merch sin despachar y la fila «Pedidos de la Store»', () => {
    const menu = read('public/shared/js/wo-artist-menu.js');
    assert.match(menu, /state\.storeOn && D && D\.Store && typeof D\.Store\.listSellerOrders === 'function'/);
    assert.match(menu, /D\.Store\.listSellerOrders\('artist', uid\)/);
    assert.match(menu, /o\.status === 'pending_payment' && o\.buyer_payment_reported_at/);
    assert.match(menu, /o\.status === 'paid' && o\.fulfillment_method !== 'digital'/);
    assert.match(menu, /title: 'Pago informado'/);
    assert.match(menu, /'Pedido #' \+ storeOrderNumber\(o\) \+ ' · ' \+ \(due \? 'Confirmalo antes del ' \+ due/);
    assert.match(menu, /title: 'Pedido por preparar'/);
    assert.match(menu, /state\.counts\.store = reported\.length \+ toShip\.length;/);
    assert.match(menu, /activityRow\('wo-oam-store', 'shopping-bag', 'Pedidos de la Store', state\.counts\.store, false, '\/artist\/store\?tab=pedidos'\)/);
    // Los ítems de la Store entran al feed y así suman al badge (unreadTotal).
    assert.match(menu, /unread: !seen\.has\(key\), href: storeOrderHref\(o\)/);
    assert.doesNotMatch(menu, /from\('store_/, 'sin CRUD ad-hoc de la Store');
});

/* ------------------------------ soporte ------------------------------ */
test('soporte: la página carga el plugin STORE después del dashboard y la capa de datos de la Store', () => {
    const html = read('public/support/dashboard/index.html');
    const order = ['/shared/js/data/postgrest-client.js', '/shared/js/store-model.js', '/shared/js/data/store-repo.js', '/shared/js/support-dashboard.js', '/shared/js/support-dashboard-store.js'];
    const positions = order.map((src) => html.indexOf(`<script src="${src}"`));
    assert.ok(positions.every((p, i) => p > -1 && (i === 0 || p > positions[i - 1])), 'orden de scripts: ' + positions.join(','));
    assert.match(html, /<link rel="stylesheet" href="\/shared\/css\/support-dashboard-store\.css">/);

    const js = read('public/shared/js/support-dashboard-store.js');
    for (const method of ['listPendingPlatformOrders', 'listFlaggedOrders', 'confirmPayment', 'refundOrder', 'setFundsHold', 'featureEnabled', 'isAvailable']) {
        assert.ok(js.includes(method), method);
    }
    assert.match(js, /collectedBy: can\.collector/);
    assert.match(js, / STORE </);
    assert.doesNotMatch(js, /_supabase\.from\(|\/rest\/v1\/|WeotziData\.from\(/, 'solo WeotziData.Store');

    const css = read('public/shared/css/support-dashboard-store.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos');
    assert.match(css, /\.sds-count:not\(\[hidden\]\)/);
});

function loadSupportPlugin({ gate = false } = {}) {
    const calls = { pending: 0 };
    const window = {
        switchTab() {},
        WeotziData: {
            Store: {
                featureEnabled: () => gate,
                isAvailable: () => Promise.resolve(true),
                listPendingPlatformOrders: () => { calls.pending += 1; return Promise.resolve([]); },
                listFlaggedOrders: () => Promise.resolve([])
            }
        }
    };
    const document = {
        readyState: 'complete',
        addEventListener() {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
    vm.runInNewContext(read('public/shared/js/support-dashboard-store.js'), { window, document, console, setTimeout, Promise, Map }, { filename: 'support-dashboard-store.js' });
    return { api: window.WeotziSupportStore, calls };
}

test('soporte: sin el gate el plugin no carga pedidos ni toca la página', async () => {
    const { calls } = loadSupportPlugin({ gate: false });
    await settle();
    assert.equal(calls.pending, 0);
});

test('soporte: une pedidos por confirmar y marcados sin repetir, y decide las acciones', () => {
    const { api } = loadSupportPlugin();
    const pending = { id: 'o1', status: 'pending_payment', expected_collector: 'platform', metadata_json: {} };
    const flagged = [
        { id: 'o1', status: 'pending_payment', expected_collector: 'platform', metadata_json: { needs_support: true, needs_support_reason: 'payment_reported_expired' } },
        { id: 'o2', status: 'paid', expected_collector: 'platform', funds_hold: true, metadata_json: {} },
        { id: 'o3', status: 'fulfilled', expected_collector: 'seller', metadata_json: { needs_support: true, needs_support_reason: 'duplicate_payment' } }
    ];
    // El plugin corre en otro realm: se compara por JSON.
    const rows = JSON.parse(JSON.stringify(api.mergeRows([pending], flagged)));
    assert.deepEqual(rows.map((r) => [r.order.id, r.reasons.join('+')]), [['o1', 'platform+support'], ['o2', 'hold'], ['o3', 'support']]);

    assert.deepEqual(JSON.parse(JSON.stringify(api.capabilities(flagged[0]))), { collector: 'platform', confirm: true, refund: false, hold: false });
    assert.deepEqual(JSON.parse(JSON.stringify(api.capabilities(flagged[1]))), { collector: 'platform', confirm: false, refund: true, hold: true });
    assert.equal(api.capabilities({ id: 'o4', status: 'pending_payment', expected_collector: 'provider' }).confirm, false, 'los de proveedor los confirma el webhook');
    assert.equal(api.capabilities({ id: 'o5', status: 'pending_payment', expected_collector: 'seller' }).collector, 'seller');
});

/* ------------------------------ wallet ------------------------------ */
test('wallet: normalizeMovement suma source y orderNumber sin cambiar el saldo', () => {
    const store = W.normalizeMovement({
        kind: 'release', status: 'completed', amount: 50, currency: 'USD', title: 'Fondos liberados · Pedido #ST-5E2A91C0',
        booking_reference: 'ST-5E2A91C0', metadata_json: { source: 'store', order_id: 'o1', order_number: 'ST-5E2A91C0' }
    });
    assert.equal(store.source, 'store');
    assert.equal(store.orderNumber, 'ST-5E2A91C0');
    assert.equal(store.booking, 'ST-5E2A91C0');

    const booking = W.normalizeMovement({ kind: 'payment', status: 'pending_service', amount: 200, currency: 'USD', booking_reference: 'Q-123' });
    assert.equal(booking.source, null);
    assert.equal(booking.orderNumber, null, 'solo las ventas de la Store llevan número de pedido');

    const fromMeta = W.normalizeMovement({ kind: 'fee', status: 'completed', amount: 5, currency: 'USD', metadata_json: { source: 'store', order_number: 'ST-AD62E019' } });
    assert.equal(fromMeta.orderNumber, 'ST-AD62E019');

    assert.equal(W.summarize([store, fromMeta], 'USD').available, 45, 'la fórmula de saldo no cambia');
});

test('wallet: la actividad muestra «Pedido #ST-…» en las ventas de la Store', () => {
    const js = read('public/shared/js/wallet-account.js');
    assert.match(js, /return `Pedido \$\{n\.startsWith\('#'\) \? n : '#' \+ n\}`;/);
    assert.match(js, /\} else if \(m\.source === 'store' && m\.orderNumber\) \{\n\s*extra = storeOrderRef\(m\);/);
    assert.match(js, /const ref = m\.source === 'store' && m\.orderNumber \? storeOrderRef\(m\) : m\.booking/);
});

/* ------------------------------ servidor ------------------------------ */
test('server.js: las descargas de la Store usan storeDownloadLimiter (60 cada 15 min), no authLimiter', () => {
    const source = read('server.js');
    const def = source.match(/const storeDownloadLimiter = rateLimit\(\{([\s\S]*?)\n\}\);/);
    assert.ok(def, 'limiter definido');
    assert.match(def[1], /windowMs: 15 \* 60 \* 1000/);
    assert.match(def[1], /max: 60/);
    assert.match(def[1], /standardHeaders: true/);
    assert.match(def[1], /legacyHeaders: false/);
    assert.match(def[1], /message: \{ success: false, error: '[^']+' \}/);
    assert.match(source, /app\.post\('\/api\/store\/licenses\/:licenseId\/assets\/:assetId\/url', storeDownloadLimiter, storeOrders\.handleDownloadUrl\);/);
    assert.doesNotMatch(source, /assets\/:assetId\/url', authLimiter/);
    assert.ok(source.indexOf('const storeDownloadLimiter') < source.indexOf("app.post('/api/store/licenses/"), 'definido antes de la ruta');
});

/* ------------------------------ docs ------------------------------ */
test('docs: el mapa lista las rutas de la Store, las tablas store_* y la migración no aplicada', () => {
    const doc = read('docs/MAPA_APLICACION.md');
    for (const route of ['/artist/store/', '/store/?artist=', '/store/item/', '/store/checkout/', '/store/purchases/', '/store/license/']) {
        assert.ok(doc.includes('`' + route), route);
    }
    for (const table of ['store_products', 'store_product_variants', 'store_design_assets', 'store_seller_settings', 'store_orders', 'store_order_items', 'store_payments', 'store_licenses', 'store_download_events']) {
        assert.ok(doc.includes('`' + table + '`'), table);
    }
    assert.match(doc, /Migración NO aplicada/);
    assert.match(doc, /features\.store: false/);
});
