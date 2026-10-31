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
test('app-config: features.store es un booleano dentro del objeto features y el repo lo lee con getValue', () => {
    const config = JSON.parse(read('public/shared/js/app-config.json'));
    // Encendido el 31 oct 2026 junto con la aplicación de store_core en Supabase.
    assert.equal(typeof config.features.store, 'boolean');
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
        // El dashboard suma la entrada visible en el celular (la nav se oculta por debajo de 769px).
        assert.equal((html.match(/data-store-entry/g) || []).length, page === 'dashboard' ? 2 : 1, page + ': links de entrada');
        assert.match(html, /<script src="\/shared\/js\/store-entry\.js" defer><\/script>/, page);
        assert.ok(html.indexOf('/shared/js/config-manager.js') > -1, page + ': config-manager presente');
    }
});

test('cliente: «Mis compras» también en «Tu actividad» del dashboard, fuera de la nav y con el gate', () => {
    const html = read('public/client/dashboard/index.html');
    const counters = html.match(/<div class="client-counters">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/);
    assert.ok(counters, 'contadores de «Tu actividad»');
    const entry = counters[0].match(/<a class="wo-btn[^"]*" href="\/store\/purchases\/" data-store-entry hidden>Mis compras <i data-wo-icon="arrow-right"[^>]*><\/i><\/a>/);
    assert.ok(entry, 'entrada oculta por defecto con data-store-entry');
    const nav = html.match(/<nav class="wo-topbar-nav"[^>]*>[\s\S]*?<\/nav>/)[0];
    assert.ok(!nav.includes('Mis compras'), 'no depende de la nav de escritorio');
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
function loadStoreBand({ gate = true, storefront = null, fail = false, artist = null } = {}) {
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
    if (artist) sandbox.artistData = artist;
    vm.runInNewContext(
        'var artistData = this.artistData;\n' + js.slice(escStart, escEnd) + js.slice(start, end) + '\nthis.loadStoreBand = loadStoreBand;',
        sandbox,
        { filename: 'artist-profile.store-band.js' }
    );
    return { run: () => sandbox.loadStoreBand(), els, calls, warnings };
}

// La vitrina del artista del perfil (seller.id = artistData.user_id).
const SELLER = { id: 'u1', handle: 'valen.wo' };

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
    const band = loadStoreBand({ storefront: { seller: SELLER, products: [] } });
    await band.run();
    assert.equal(band.els['store-band'].hidden, true);
    assert.deepEqual(band.calls, [['artist', 'valen.wo']]);
});

test('perfil público: pinta hasta 6 ítems escapados con «Desde …», badges y «Ver la Store →»', async () => {
    const products = [1, 2, 3, 4, 5, 6, 7].map((n) => product(n));
    products[0].title = '<img src=x onerror=alert(1)>';
    products[0].license_exclusive_price = 400;
    products[0].exclusive_available = true;
    const band = loadStoreBand({ storefront: { seller: SELLER, products } });
    await band.run();
    const html = band.els['store-band-grid'].innerHTML;
    assert.equal(band.els['store-band'].hidden, false);
    assert.equal((html.match(/class="store-band-item"/g) || []).length, 6);
    assert.doesNotMatch(html, /<img src=x/, 'el título se escapa');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    // p1: un solo precio (la exclusiva) → sin «Desde»; p3: sin niveles cargados → «Desde» price_from.
    assert.match(html, /<span class="store-band-price">USD 400<\/span>/);
    assert.match(html, /<span class="store-band-price">Desde USD 30<\/span>/);
    assert.match(html, /Exclusiva disponible/);
    assert.match(html, /href="\/store\/item\/\?id=p1"/);
    assert.match(html, /src="\/shared\/assets\/demo\/store\/p1\.svg"/);
    assert.equal(band.els['store-band-link'].href, '/store/?artist=valen.wo');
});

test('perfil público: las miniaturas son decorativas (alt="") y el título nombra el producto', async () => {
    const products = [1, 2].map((n) => product(n));
    products[0].images = [{ path: 'demo/store/p1.svg', alt: 'Texto que repite el título <b>' }];
    const band = loadStoreBand({ storefront: { seller: SELLER, products } });
    await band.run();
    const html = band.els['store-band-grid'].innerHTML;
    const imgs = html.match(/<img [^>]*>/g) || [];
    assert.equal(imgs.length, 2);
    assert.ok(imgs.every((img) => /\salt=""/.test(img)), imgs.join('\n'));
    assert.doesNotMatch(html, /Texto que repite el título/);
    assert.match(html, /<span class="store-band-title">Producto 1<\/span>/);
});

test('perfil público: con un username duplicado, la banda solo aparece si seller.id es el artista del perfil', async () => {
    const products = [product(1)];
    for (const seller of [{ id: 'otro-user', handle: 'valen.wo' }, { handle: 'valen.wo' }, null]) {
        const band = loadStoreBand({ storefront: { seller, products } });
        await band.run();
        assert.equal(band.els['store-band'].hidden, true, JSON.stringify(seller));
        assert.equal(band.els['store-band-grid'].innerHTML, '', 'no pinta productos de otro vendedor');
    }
    // Sin user_id en el perfil no hay con qué comparar: ni consulta la Store.
    const noId = loadStoreBand({ storefront: { seller: SELLER, products }, artist: { username: 'valen.wo' } });
    await noId.run();
    assert.equal(noId.els['store-band'].hidden, true);
    assert.equal(noId.calls.length, 0);

    const own = loadStoreBand({ storefront: { seller: SELLER, products } });
    await own.run();
    assert.equal(own.els['store-band'].hidden, false);
});

test('perfil público: el precio de la banda es WeotziStoreModel.priceLabel, igual que la vitrina', () => {
    const js = read('public/shared/js/artist-profile.js');
    assert.match(js, /M\.priceLabel\(product\)\.label/);
    assert.doesNotMatch(js, /function storeBandPrice/, 'sin copia local del cálculo');
    const catalogBox = { window: { WeotziStoreModel: M }, console };
    vm.runInNewContext(read('public/shared/js/store-catalog.js'), catalogBox, { filename: 'store-catalog.js' });
    const C = catalogBox.window.WeotziStoreCatalog;
    assert.equal(typeof C.priceSummary, 'function');
    const cases = [
        { kind: 'merch', title: 'Sticker', currency: 'ARS', price_amount: 3000, price_from: 3000, variants: [] },
        { kind: 'merch', title: 'Remera', currency: 'USD', price_amount: 25, price_from: 25, variants: [{ id: 'v1' }, { id: 'v2' }] },
        { kind: 'merch', title: 'Remera XL', currency: 'USD', price_amount: 25, price_from: 25, variants: [{ id: 'v1' }, { id: 'v2', price_amount: 30 }] },
        { kind: 'merch', title: 'Print', currency: 'USD', price_from: 20, variants: [{ id: 'v1', price_amount: 30 }, { id: 'v2' }] },
        { kind: 'merch', title: 'Print A3', currency: 'USD', price_from: 15, variants: [{ id: 'v1', price_amount: 15 }, { id: 'v2' }] },
        { kind: 'merch', title: 'Sin precio', currency: 'USD', variants: [] },
        { kind: 'design', title: 'Luna', currency: 'USD', price_from: 50, license_personal_price: 50 },
        { kind: 'design', title: 'Sol', currency: 'USD', price_from: 50, license_personal_price: 50, license_artist_price: 120 },
        { kind: 'design', title: 'Ola', currency: 'USD', price_from: 80 }
    ];
    for (const p of cases) assert.equal(M.priceLabel(p).label, C.priceSummary(p).label, p.title);
    assert.equal(M.priceLabel(cases[0]).label, M.formatMoney(3000, 'ARS'), 'un solo precio, sin «Desde»');
    assert.equal(M.priceLabel(cases[6]).label, 'USD 50', 'una sola licencia, sin «Desde»');
    assert.equal(M.priceLabel(cases[7]).label, 'Desde USD 50');

    // La banda pinta exactamente ese label (y nada si no hay precio).
    const band = loadStoreBand({ storefront: { seller: SELLER, products: cases.slice(0, 6).map((p, i) => Object.assign({ id: 'c' + i, images: [] }, p)) } });
    return band.run().then(() => {
        const prices = (band.els['store-band-grid'].innerHTML.match(/<span class="store-band-price">([^<]*)<\/span>/g) || [])
            .map((s) => s.replace(/<[^>]+>/g, ''));
        assert.deepEqual(prices, cases.slice(0, 6).map((p) => M.priceLabel(p).label).filter(Boolean));
    });
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
    // «Confirmalo antes del…» solo si cobra el vendedor: los de We Ötzi o proveedor no los puede confirmar.
    assert.match(menu, /o\.buyer_payment_reported_at\s*\n\s*&& \(o\.expected_collector \|\| 'seller'\) === 'seller'/);
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
    for (const method of ['listPendingPlatformOrders', 'listFlaggedOrders', 'listRecentExpiredOrders', 'confirmPayment', 'cancelOrder', 'refundOrder', 'setFundsHold', 'resolveOrderFlag', 'listSupportNotes', 'featureEnabled', 'isAvailable']) {
        assert.ok(js.includes(method), method);
    }
    // Las notas internas salen de store_order_support_notes, no de metadata_json.
    assert.doesNotMatch(js, /funds_hold_note|m\.maintenance_error\b/);
    assert.match(js, /S\.resolveOrderFlag\(o\.id, value\('note'\)\)/);
    assert.match(js, /collectedBy: can\.collector/);
    // Cancelar con motivo obligatorio y window.confirm, igual que reembolsar.
    assert.match(js, /data-sds-form="cancel"/);
    assert.match(js, /kind === 'cancel' && can\.cancel/);
    assert.match(js, /if \(!cancelReason\) \{ feedback\('Contá el motivo de la cancelación\.', 'error'\); return; \}/);
    assert.match(js, /window\.confirm\('¿Cancelar el pedido '/);
    assert.match(js, /S\.cancelOrder\(o\.id, cancelReason\)/);
    assert.match(js, / STORE </);
    assert.doesNotMatch(js, /_supabase\.from\(|\/rest\/v1\/|WeotziData\.from\(/, 'solo WeotziData.Store');

    const css = read('public/shared/css/support-dashboard-store.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos');
    assert.match(css, /\.sds-count:not\(\[hidden\]\)/);
});

function loadSupportPlugin({ gate = false, store = {}, model = null } = {}) {
    const calls = { pending: 0, expired: [] };
    const window = {
        switchTab() {},
        WeotziStoreModel: model || undefined,
        WeotziData: {
            Store: Object.assign({
                featureEnabled: () => gate,
                isAvailable: () => Promise.resolve(true),
                listPendingPlatformOrders: () => { calls.pending += 1; return Promise.resolve([]); },
                listFlaggedOrders: () => Promise.resolve([])
            }, typeof store === 'function' ? store(calls) : store)
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

    assert.deepEqual(JSON.parse(JSON.stringify(api.capabilities(flagged[0]))), { collector: 'platform', confirm: true, cancel: true, refund: false, hold: false, resolve: false });
    assert.deepEqual(JSON.parse(JSON.stringify(api.capabilities(flagged[1]))), { collector: 'platform', confirm: false, cancel: false, refund: true, hold: true, resolve: false });
    assert.equal(api.capabilities(flagged[2]).resolve, true, 'pago duplicado: marcar como revisado');
    assert.equal(api.capabilities({ id: 'o4', status: 'pending_payment', expected_collector: 'provider' }).confirm, false, 'los de proveedor los confirma el webhook');
    assert.equal(api.capabilities({ id: 'o5', status: 'pending_payment', expected_collector: 'seller' }).collector, 'seller');
});

test('soporte: cancela pedidos pendientes aunque tengan pago informado (stock y reserva no quedan trabados)', () => {
    const { api } = loadSupportPlugin();
    const reported = { id: 'o1', status: 'pending_payment', expected_collector: 'seller', buyer_payment_reported_at: '2026-10-28T10:00:00Z', metadata_json: { needs_support: true, needs_support_reason: 'payment_reported_expired' } };
    assert.equal(api.capabilities(reported).cancel, true);
    for (const status of ['paid', 'fulfilled', 'cancelled', 'expired', 'refunded']) {
        assert.equal(api.capabilities({ id: 'x', status, expected_collector: 'seller' }).cancel, false, status);
    }
    // Ya resuelto (confirmado o cancelado), la marca «pago informado y vencido» sale de la cola;
    // vencido con la marca puesta (lo venció el mantenimiento), sigue: soporte decide si lo reabre.
    const rows = JSON.parse(JSON.stringify(api.mergeRows([], [
        reported,
        Object.assign({}, reported, { id: 'o2', status: 'cancelled' }),
        Object.assign({}, reported, { id: 'o3', status: 'paid' }),
        { id: 'o4', status: 'fulfilled', metadata_json: { needs_support: true, needs_support_reason: 'duplicate_payment' } },
        Object.assign({}, reported, { id: 'o5', status: 'expired' })
    ], [Object.assign({}, reported, { id: 'o5', status: 'expired' })])));
    assert.deepEqual(rows.map((r) => [r.order.id, r.reasons.join('+')]), [['o1', 'support'], ['o4', 'support'], ['o5', 'support+expired']]);
    assert.equal(api.isActionable(rows[2]), true, 'el vencido con pago informado suma al contador');
});

test('soporte: «Marcar como revisado» solo con needs_support y fuera de pending_payment', () => {
    const { api } = loadSupportPlugin();
    const flag = (status, reason, extra = {}) => Object.assign({ id: 'x', status, expected_collector: 'seller', metadata_json: { needs_support: true, needs_support_reason: reason } }, extra);
    assert.equal(api.capabilities(flag('paid', 'duplicate_payment')).resolve, true);
    assert.equal(api.capabilities(flag('fulfilled', 'duplicate_payment')).resolve, true);
    assert.equal(api.capabilities(flag('refunded', 'duplicate_payment')).resolve, true, 'reembolsó el vendedor: la marca sigue');
    assert.equal(api.capabilities(flag('expired', 'payment_reported_expired')).resolve, true, 'vencido con pago informado');
    // Pendiente: la salida es confirmar o cancelar (el mantenimiento lo volvería a marcar).
    const pending = api.capabilities(flag('pending_payment', 'payment_reported_expired'));
    assert.equal(pending.resolve, false);
    assert.equal(pending.confirm, true);
    assert.equal(pending.cancel, true);
    // Sin marca (o ya resuelta) no hay nada que revisar.
    assert.equal(api.capabilities({ id: 'x', status: 'paid', metadata_json: { needs_support_resolved_at: '2026-10-30T10:00:00Z' } }).resolve, false);
    assert.equal(api.capabilities({ id: 'x', status: 'paid' }).resolve, false);
});

/* DOM falso del dashboard de soporte: los nodos del drawer existen si su id está en el HTML pintado. */
function supportDom() {
    const els = {};
    const listeners = {};
    const ROOTS = ['table-body', 'drawer-content', 'drawer-toggle', 'toolbar-filters'];
    function make(id) {
        const el = {
            id, textContent: '', checked: false, dataset: {}, attributes: {}, style: {}, _html: '',
            setAttribute(n, v) { this.attributes[n] = String(v); },
            getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; },
            addEventListener(type, fn) { (listeners[id + ':' + type] = listeners[id + ':' + type] || []).push(fn); },
            focus() {}
        };
        Object.defineProperty(el, 'innerHTML', {
            get() { return this._html; },
            set(v) {
                this._html = String(v);
                // Pintar el drawer reemplaza sus nodos internos.
                if (id === 'drawer-content') Object.keys(els).forEach((k) => { if (!ROOTS.includes(k)) delete els[k]; });
            }
        });
        return el;
    }
    const get = (id) => (els[id] = els[id] || make(id));
    const document = {
        readyState: 'complete',
        addEventListener() {},
        getElementById(id) {
            if (ROOTS.includes(id)) return get(id);
            const drawer = els['drawer-content'];
            return drawer && drawer.innerHTML.includes(`id="${id}"`) ? get(id) : null;
        },
        querySelector: () => null,
        querySelectorAll: () => []
    };
    return { document, els, listeners };
}

function loadSupportPage({ store = {}, currentUser = null, confirm = () => true } = {}) {
    const dom = supportDom();
    const calls = { resolve: [], notes: [], confirms: [] };
    const window = {
        switchTab() {},
        confirm: (msg) => { calls.confirms.push(msg); return confirm(msg); },
        WeotziStoreModel: M,
        WeotziData: { Store: Object.assign({
            featureEnabled: () => true,
            isAvailable: () => Promise.resolve(true),
            listPendingPlatformOrders: () => Promise.resolve([]),
            listFlaggedOrders: () => Promise.resolve([]),
            listRecentExpiredOrders: () => Promise.resolve([])
        }, typeof store === 'function' ? store(calls) : store) }
    };
    function FormData(form) { return { get: (k) => (form.values || {})[k] }; }
    vm.runInNewContext(read('public/shared/js/support-dashboard-store.js'),
        { window, document: dom.document, console: { warn() {}, log() {}, error() {} }, setTimeout, Promise, Map, FormData, currentUser },
        { filename: 'support-dashboard-store.js' });
    const open = (id) => dom.listeners['table-body:click'][0]({ target: { closest: () => ({ getAttribute: () => id }) } });
    const submit = (kind, values) => dom.listeners['drawer-content:submit'][0]({
        target: { closest: () => ({ values, getAttribute: (n) => (n === 'data-sds-form' ? kind : null), setAttribute() {} }) },
        preventDefault() {}
    });
    return { dom, calls, window, open, submit, drawer: () => dom.els['drawer-content'].innerHTML, notes: () => (dom.els['sds-notes'] || {}).innerHTML };
}

test('soporte: el drawer muestra las notas internas (listSupportNotes) y no lee notas de metadata_json', async () => {
    const order = {
        id: 'o1', order_number: 'ST-AAAA1111', status: 'paid', seller_type: 'artist', expected_collector: 'platform', payment_collected_by: 'platform',
        funds_hold: true, total_amount: 50, currency: 'USD', items: [], payments: [],
        metadata_json: { funds_hold_at: '2026-10-29T10:00:00Z', funds_hold_note: 'NO-DEBE-VERSE', maintenance_error: 'NO-DEBE-VERSE', maintenance_error_at: '2026-10-29T11:00:00Z' }
    };
    const notes = [
        { id: 'n2', order_id: 'o1', kind: 'maintenance_error', note: '40P01 deadlock <detectado>', actor_id: null, created_at: '2026-10-29T11:00:00Z' },
        { id: 'n1', order_id: 'o1', kind: 'funds_hold', note: 'Contracargo en revisión', actor_id: 'agent-1', created_at: '2026-10-29T10:00:00Z' },
        { id: 'n0', order_id: 'o1', kind: 'refund', note: null, actor_id: 'agent-2', created_at: '2026-10-28T10:00:00Z' }
    ];
    const page = loadSupportPage({
        currentUser: { id: 'agent-1' },
        store: (calls) => ({
            listFlaggedOrders: () => Promise.resolve([order]),
            listSupportNotes: (id) => { calls.notes.push(id); return Promise.resolve(notes); }
        })
    });
    await settle();
    await page.open('o1');
    await settle();
    assert.deepEqual(page.calls.notes, ['o1']);
    const drawer = page.drawer();
    assert.match(drawer, /Notas internas/);
    assert.doesNotMatch(drawer, /NO-DEBE-VERSE/, 'ni la nota de la retención ni el error crudo salen de metadata_json');
    assert.match(drawer, /El detalle está en las notas internas/);
    const html = page.notes();
    assert.equal((html.match(/class="sds-note"/g) || []).length, 3, 'una por nota, en el orden del repo');
    assert.ok(html.indexOf('Error del mantenimiento') < html.indexOf('Retención de fondos'), 'la más reciente primero');
    assert.match(html, /40P01 deadlock &lt;detectado&gt;/, 'escapado');
    assert.match(html, /Contracargo en revisión/);
    assert.match(html, /Retención de fondos<\/span> · [^<]+ · Vos<\/p>/, 'la nota propia dice «Vos»');
    assert.match(html, /Reembolso<\/span> · [^<]+ · Soporte<\/p>/);
    assert.match(html, /Error del mantenimiento<\/span> · [^<]+ · Automático<\/p>/);
    assert.equal(page.dom.els['sds-notes'].getAttribute('aria-busy'), 'false');
});

test('soporte: sin notas (o si el repo devuelve []) el drawer lo dice; una respuesta vieja no pisa otro pedido', async () => {
    const orders = [
        { id: 'o1', status: 'paid', funds_hold: true, items: [], payments: [], metadata_json: {} },
        { id: 'o2', status: 'paid', funds_hold: true, items: [], payments: [], metadata_json: {} }
    ];
    let releaseFirst;
    const page = loadSupportPage({
        store: () => ({
            listFlaggedOrders: () => Promise.resolve(orders),
            listSupportNotes: (id) => (id === 'o1'
                ? new Promise((resolve) => { releaseFirst = () => resolve([{ id: 'n', kind: 'refund', note: 'DE-O1', created_at: '2026-10-29T10:00:00Z' }]); })
                : Promise.resolve([]))
        })
    });
    await settle();
    const first = page.open('o1');
    await page.open('o2');
    await settle();
    assert.match(page.notes(), /Este pedido todavía no tiene notas internas\./);
    releaseFirst();
    await first;
    await settle();
    assert.doesNotMatch(page.notes(), /DE-O1/, 'la respuesta de o1 llegó tarde y se descarta');
});

test('soporte: «Marcar como revisado» llama a resolveOrderFlag con la nota y saca el pedido de la cola', async () => {
    let flagged = [{ id: 'o3', order_number: 'ST-BBBB2222', status: 'fulfilled', expected_collector: 'seller', items: [], payments: [],
        metadata_json: { needs_support: true, needs_support_reason: 'duplicate_payment', needs_support_at: '2026-10-29T10:00:00Z' } }];
    const page = loadSupportPage({
        store: (calls) => ({
            listFlaggedOrders: () => Promise.resolve(flagged),
            listSupportNotes: () => Promise.resolve([]),
            resolveOrderFlag: (id, note) => {
                calls.resolve.push([id, note]);
                flagged = [];
                return Promise.resolve({ id, metadata_json: { needs_support_resolved_at: '2026-10-30T10:00:00Z' } });
            }
        })
    });
    await settle();
    await page.open('o3');
    const drawer = page.drawer();
    assert.match(drawer, /data-sds-form="resolve"/);
    assert.match(drawer, /Marcar como revisado/);
    assert.match(drawer, /Llegó un segundo pago con otra referencia/);
    page.submit('resolve', { note: '  Devuelto el pago de más.  ' });
    await settle(10);
    assert.deepEqual(page.calls.resolve, [['o3', 'Devuelto el pago de más.']]);
    assert.match(page.calls.confirms[0], /¿Marcar el pedido #ST-BBBB2222 como revisado\?/);
    assert.match(page.drawer(), /El pedido ya no necesita acciones de soporte\./);
    assert.equal(page.dom.els['sds-feedback'].textContent, 'Pedido marcado como revisado.');

    // Si se cancela el window.confirm no se llama al repo.
    const declined = loadSupportPage({
        confirm: () => false,
        store: (calls) => ({
            listFlaggedOrders: () => Promise.resolve([{ id: 'o4', status: 'expired', items: [], payments: [], metadata_json: { needs_support: true, needs_support_reason: 'payment_reported_expired' } }]),
            resolveOrderFlag: (id) => { calls.resolve.push(id); return Promise.resolve({}); }
        })
    });
    await settle();
    await declined.open('o4');
    assert.match(declined.drawer(), /El comprador informó un pago que nadie confirmó y el pedido venció/);
    declined.submit('resolve', { note: '' });
    await settle();
    assert.deepEqual(declined.calls.resolve, []);
});

test('soporte: un pendiente con pago informado vencido no ofrece «Marcar como revisado» (confirmar o cancelar)', async () => {
    const page = loadSupportPage({
        store: (calls) => ({
            listFlaggedOrders: () => Promise.resolve([{ id: 'o5', status: 'pending_payment', expected_collector: 'seller', buyer_payment_reported_at: '2026-10-20T10:00:00Z', items: [], payments: [],
                metadata_json: { needs_support: true, needs_support_reason: 'payment_reported_expired' } }]),
            resolveOrderFlag: (id) => { calls.resolve.push(id); return Promise.resolve({}); }
        })
    });
    await settle();
    await page.open('o5');
    const drawer = page.drawer();
    assert.doesNotMatch(drawer, /data-sds-form="resolve"/);
    assert.match(drawer, /Confirmá el pago o cancelá el pedido: cualquiera de las dos lo saca de la cola\./);
    assert.match(drawer, /data-sds-form="confirm"/);
    assert.match(drawer, /data-sds-form="cancel"/);
    // Aunque llegue un submit forzado, sin la capacidad no se llama al repo.
    page.submit('resolve', { note: 'x' });
    await settle();
    assert.deepEqual(page.calls.resolve, []);
});

test('soporte: retener fondos solo en pedidos con wallet sin liberar; una retención puesta siempre se levanta', () => {
    for (const model of [null, M]) {
        const { api } = loadSupportPlugin({ model });
        const base = { id: 'o1', status: 'paid', seller_type: 'artist', expected_collector: 'platform', payment_collected_by: 'platform', metadata_json: {} };
        assert.equal(api.capabilities(base).hold, true, 'artista + cobro de We Ötzi');
        assert.equal(api.capabilities(Object.assign({}, base, { status: 'fulfilled', expected_collector: 'provider', payment_collected_by: 'provider' })).hold, true, 'proveedor');
        assert.equal(api.capabilities(Object.assign({}, base, { expected_collector: 'seller', payment_collected_by: 'seller' })).hold, false, 'cobra el vendedor: sin wallet');
        assert.equal(api.capabilities(Object.assign({}, base, { seller_type: 'studio' })).hold, false, 'estudio: sin wallet');
        assert.equal(api.capabilities(Object.assign({}, base, { funds_released_at: '2026-10-29T10:00:00Z' })).hold, false, 'fondos ya liberados');
        assert.equal(api.capabilities(Object.assign({}, base, { status: 'pending_payment' })).hold, false, 'sin pago');
        assert.equal(api.capabilities(Object.assign({}, base, { expected_collector: 'seller', payment_collected_by: 'seller', funds_hold: true })).hold, true, 'levantar una retención vieja');
    }
});

test('soporte: los vencidos recientes llegan a la pestaña para «Reabrir y confirmar», sin sumar al contador', async () => {
    const { api } = loadSupportPlugin();
    const rows = JSON.parse(JSON.stringify(api.mergeRows([], [], [
        { id: 'e1', status: 'expired', expected_collector: 'platform', metadata_json: {} },
        { id: 'e2', status: 'expired', expected_collector: 'provider', metadata_json: {} },
        { id: 'e3', status: 'pending_payment', expected_collector: 'seller', metadata_json: {} }
    ])));
    assert.deepEqual(rows.map((r) => [r.order.id, r.reasons.join('+')]), [['e1', 'expired']], 'los de proveedor no se reabren desde soporte');
    assert.equal(api.isActionable(rows[0]), false, 'un vencido no es trabajo pendiente');
    assert.equal(api.isActionable({ reasons: ['expired', 'hold'] }), true);
    assert.equal(api.capabilities(rows[0].order).confirm, true, 'reabrir y confirmar');

    const js = read('public/shared/js/support-dashboard-store.js');
    assert.match(js, /expired: \{ label: 'Vencido', badge: 'closed' \}/);
    assert.match(js, /Reabrir y confirmar pago/);

    // Con el método en el repo, la carga pide los últimos 7 días; si falla, la pestaña sigue.
    const on = loadSupportPlugin({
        gate: true,
        store: (calls) => ({ listRecentExpiredOrders: (opts) => { calls.expired.push(opts); return Promise.reject(new Error('boom')); } })
    });
    await settle();
    assert.equal(on.calls.pending, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(on.calls.expired)), [{ days: 7 }]);
    await on.api.refresh();
    assert.equal(on.calls.expired.length, 2);
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

test('wallet: una venta de la Store retenida por soporte no se muestra como disputa', () => {
    const held = W.normalizeMovement({ kind: 'payment', status: 'blocked', amount: 80, currency: 'USD', booking_reference: 'ST-5E2A91C0', metadata_json: { source: 'store', store_hold: true } });
    assert.equal(held.storeHold, true);
    assert.deepEqual(W.releaseView(held), { label: 'Retenido por soporte', tone: 'danger', meta: 'We Ötzi está revisando el pedido' });
    const dispute = W.normalizeMovement({ kind: 'payment', status: 'blocked', amount: 80, currency: 'USD', booking_reference: 'Q-1' });
    assert.equal(dispute.storeHold, false);
    assert.equal(W.releaseView(dispute).label, 'Bloqueado por disputa');
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
    for (const table of ['store_products', 'store_product_variants', 'store_design_assets', 'store_seller_settings', 'store_orders', 'store_order_items', 'store_payments', 'store_licenses', 'store_download_events', 'store_order_support_notes']) {
        assert.ok(doc.includes('`' + table + '`'), table);
    }
    assert.ok(doc.includes('`resolve_store_order_flag`'), 'RPC de soporte en el mapa');
    // Aplicada el 31 oct 2026 junto con el flag; el flag igual no protege la API.
    assert.match(doc, /Migración aplicada el 31 oct 2026/);
    assert.match(doc, /features\.store: true/);
    assert.match(doc, /`features\.store` es solo un gate de UI/);
    assert.match(doc, /un gate propio en el SQL queda pendiente/);
    assert.match(read('docs/TECHNICAL.md'), /`features\.store` es solo un gate de UI/);
});

test('docs: el contrato refleja notas internas, gracia de 7 días, reaperturas y pendientes de lanzamiento', () => {
    const plan = read('docs/plans/2026-10-30-store-artista.md');
    const section = (n) => {
        const start = plan.indexOf(`\n## ${n}. `);
        const next = plan.indexOf('\n## ', start + 1);
        assert.ok(start > -1, `§${n}`);
        return plan.slice(start, next === -1 ? plan.length : next);
    };
    const s4 = section(4);
    assert.match(s4, /lock_timeout = '5s'/);
    assert.match(s4, /`store_order_support_notes` con `kind = 'maintenance_error'`/);
    assert.match(s4, /metadata_json\.maintenance_error_at/);
    const s5 = section(5);
    assert.match(s5, /\*\*`store_order_support_notes`\*\*/);
    assert.match(s5, /`app_settings`/);
    assert.match(s5, /is_public = false/);
    assert.match(s5, /design_width_cm, design_height_cm\}` con `jsonb_strip_nulls`/);
    const s6 = section(6);
    assert.match(s6, /`resolve_store_order_flag\(p_order_id, p_note text\)`/);
    assert.match(s6, /\*\*el vendedor que cobra directo\*\*/);
    assert.match(s6, /gracia de 7 días/);
    assert.match(s6, /`reserved`: `reserved_order_id is not null`/);
    assert.match(s6, /`pickup` exige `pickup_available` \*\*y\*\* una `pickup_address`/);
    assert.match(s6, /\*\*El proveedor también reabre un `expired`\*\*/);
    const s85 = plan.slice(plan.indexOf('### 8.5'), plan.indexOf('### 8.6'));
    assert.match(s85, /«Marcar como revisado»/);
    assert.match(s85, /listSupportNotes\(orderId\)/);
    assert.match(s85, /listRecentExpiredOrders\(\{ days: 7 \}\)/);
    assert.match(s85, /\*\*que cobra el vendedor\*\*/);
    assert.match(s85, /«Mis compras →» en «Tu actividad»/);
    assert.match(s85, /`storefront\.seller\.id` es el `user_id`/);
    const s9 = section(9);
    assert.match(s9, /\*\*Hecho el 31 oct 2026\*\*/);
    assert.match(s9, /\*\*`features\.store` es solo un gate de UI\*\*/);
    assert.match(s9, /\*\*Endurecer `artists_db`\*\* \(pendiente\)/);
    assert.match(s9, /`get_store_sales_report` con límites `timestamptz`/);
});
