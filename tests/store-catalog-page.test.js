'use strict';
// Store del artista · vitrina pública (/store/?artist=) y ficha de producto
// (/store/item/?id=). Contrato: docs/plans/2026-10-30-store-artista.md §8.3 y
// §8.4.
//
//   1. Contrato de las dos páginas: wo-demo.js primero (mismo ?v= que travel),
//      sin client-auth.js, DS + store-ds + store-catalog, scripts requeridos en
//      orden y archivos locales existentes.
//   2. CSS .stc-*: solo tokens (sin hex), radius 0, :not([hidden]) y nunca
//      `.x[hidden]{display:…}`.
//   3. store-catalog.js: sin CRUD ad-hoc y solo métodos que existen en
//      WeotziData.Store, WeotziStoreShell y WeotziStoreModel.
//   4. Helpers y HTML de la página con los datos públicos reales del demo
//      (RPC get_public_storefront / get_public_store_product del emulador).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const PAGES = ['public/store/index.html', 'public/store/item/index.html'];
const REQUIRED_SCRIPTS = [
    '/shared/js/config-manager.js',
    '/shared/js/data/postgrest-client.js',
    '/shared/js/data/artists-repo.js',
    '/shared/js/currency-utils.js',
    '/shared/js/store-model.js',
    '/shared/js/data/store-repo.js',
    '/shared/js/store-shell.js',
    '/shared/js/store-catalog.js'
];
const REQUIRED_CSS = ['/shared/css/ds/tokens.css', '/shared/css/ds/components.css', '/shared/css/store-ds.css', '/shared/css/store-catalog.css'];
const CATALOG_JS = 'public/shared/js/store-catalog.js';
const CATALOG_CSS = 'public/shared/css/store-catalog.css';

const scriptTags = (html) => [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
const srcOf = (tag) => { const m = /\bsrc="([^"]+)"/.exec(tag); return m ? m[1] : null; };
const stylesheets = (html) => [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => /href="([^"]+)"/.exec(m[0])[1]);
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ------------------------------------------------------------------ */
/* 1. Contrato de las páginas                                          */
/* ------------------------------------------------------------------ */

const travelDemo = /\/shared\/js\/wo-demo\.js\?v=([^"]+)"/.exec(read('public/artist/travel/index.html'));

test('las páginas de la Store cargan wo-demo.js como primer script, con el mismo ?v= que travel', () => {
    assert.ok(travelDemo, 'travel incluye wo-demo.js con ?v=');
    for (const page of PAGES) {
        const html = read(page);
        const tags = scriptTags(html);
        assert.ok(tags.length > 0, page + ' tiene scripts');
        assert.equal(srcOf(tags[0]), '/shared/js/wo-demo.js?v=' + travelDemo[1], page + ': wo-demo.js es el primer script y usa el ?v= de travel');
        assert.equal((html.match(/\/shared\/js\/wo-demo\.js/g) || []).length, 1, page + ': un solo include de wo-demo.js');
        assert.ok(html.indexOf('wo-demo.js') < html.indexOf('<link'), page + ': wo-demo.js va antes de los estilos');
    }
});

test('las páginas de la Store no cargan client-auth.js', () => {
    for (const page of PAGES) {
        const html = read(page);
        assert.doesNotMatch(html, /client-auth\.js/, page);
        assert.doesNotMatch(html, /account-modes\.js/, page + ': el shell no monta el selector de modos');
    }
});

test('las páginas cargan los scripts requeridos una vez, en orden y al final del body', () => {
    for (const page of PAGES) {
        const html = read(page);
        const srcs = scriptTags(html).map(srcOf).filter(Boolean);
        const positions = REQUIRED_SCRIPTS.map((src) => {
            const count = srcs.filter((s) => s === src).length;
            assert.equal(count, 1, page + ': ' + src + ' aparece una vez');
            return srcs.indexOf(src);
        });
        for (let i = 1; i < positions.length; i++) {
            assert.ok(positions[i] > positions[i - 1], page + ': ' + REQUIRED_SCRIPTS[i] + ' va después de ' + REQUIRED_SCRIPTS[i - 1]);
        }
        assert.equal(srcs[srcs.length - 1], '/shared/js/store-catalog.js', page + ': store-catalog.js es el último script');
        const bodyStart = html.indexOf('<body');
        assert.ok(html.indexOf('/shared/js/config-manager.js') > bodyStart, page + ': los scripts de página van en el body');
        assert.ok(html.indexOf('/shared/js/store-catalog.js') < html.indexOf('</body>'));
        assert.match(html, /<script src="\/shared\/js\/wo-icons\.js" defer><\/script>/, page + ': wo-icons.js con defer');
        assert.match(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, page + ': supabase-js');
        assert.ok(html.indexOf('supabase-js@2') < html.indexOf('/shared/js/config-manager.js'), page + ': supabase-js antes de config-manager');
    }
});

test('las páginas cargan el DS, store-ds.css y store-catalog.css en ese orden', () => {
    for (const page of PAGES) {
        const html = read(page);
        const css = stylesheets(html).filter((href) => href.indexOf('/shared/') === 0);
        assert.deepEqual(css, REQUIRED_CSS, page);
        assert.match(html, /fonts\.googleapis\.com\/css2\?family=Archivo\+Black/, page + ': fuentes del DS');
    }
});

test('estructura: wo-app, página, topbar del shell, main, robots noindex por defecto y sin modo oscuro', () => {
    const expected = { 'public/store/index.html': 'storefront', 'public/store/item/index.html': 'item' };
    for (const page of PAGES) {
        const html = read(page);
        assert.match(html, /<html lang="es">/, page);
        assert.match(html, new RegExp('<body class="wo-app sts-page stc-page" data-stc-page="' + expected[page] + '">'), page);
        assert.equal((html.match(/id="store-topbar"/g) || []).length, 1, page + ': un contenedor de topbar');
        assert.match(html, /<main class="sts-shell stc-main" id="stc-main" tabindex="-1" aria-busy="true">/, page);
        assert.match(html, /<div id="stc-root">/, page);
        assert.match(html, /<meta name="robots" content="noindex, nofollow">/, page + ': noindex hasta conocer allow_search_indexing');
        assert.match(html, /<a class="stc-skip" href="#stc-main">Saltar al contenido<\/a>/, page);
        assert.doesNotMatch(html, /data-theme|prefers-color-scheme/, page + ': sin modo oscuro');
        assert.doesNotMatch(html, /¡|!\s*</, page + ': sin signos de exclamación en el copy');
    }
});

test('todos los archivos locales que referencian las páginas existen', () => {
    for (const page of PAGES) {
        const html = read(page);
        const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)/g)].map((m) => m[1]).filter((p) => p.indexOf('/shared/') === 0);
        assert.ok(refs.length >= 12, page + ': referencias locales');
        for (const ref of refs) assert.ok(fs.existsSync(path.join(root, 'public', ref)), page + ': existe ' + ref);
    }
});

/* ------------------------------------------------------------------ */
/* 2. CSS                                                              */
/* ------------------------------------------------------------------ */

test('store-catalog.css: solo tokens, radius 0, prefijo .stc- y :not([hidden]) para mostrar por estado', () => {
    const css = stripCssComments(read(CATALOG_CSS));
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos');
    assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/, 'sin colores literales');
    assert.doesNotMatch(css, /prefers-color-scheme|data-theme/, 'sin modo oscuro');
    assert.doesNotMatch(css, /!important/, 'sin !important');
    for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
        assert.ok(['0', 'var(--radius-none)', 'var(--radius-circle)'].includes(m[1].trim()), 'radius permitido: ' + m[1]);
    }
    // Cada selector toca algo propio (.stc-*), nunca un componente del DS a secas.
    const rules = [...css.replace(/@media[^{]+\{/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter(Boolean);
    assert.ok(rules.length > 40, 'reglas leídas');
    for (const group of rules) {
        for (const selector of group.split(',')) {
            assert.match(selector, /\.stc-/, 'selector con prefijo .stc-: ' + selector.trim());
        }
    }
    // Estado por atributo hidden: solo con :not([hidden]).
    assert.match(css, /:not\(\[hidden\]\)/, 'usa :not([hidden]) para mostrar por estado');
    for (const m of css.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g)) {
        if (m[1].includes(':not([hidden])')) continue;
        assert.doesNotMatch(m[2], /display\s*:/, 'no muestra elementos con [hidden]: ' + m[1].trim());
    }
});

/* ------------------------------------------------------------------ */
/* 3. store-catalog.js: capa de datos y métodos existentes             */
/* ------------------------------------------------------------------ */

const catalogSource = read(CATALOG_JS);
const catalogCode = catalogSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function repoApi() {
    const win = { console, location: { origin: 'http://localhost', href: 'http://localhost/store/', pathname: '/store/', search: '' }, document: { addEventListener() {} } };
    win.window = win;
    const ctx = vm.createContext(win);
    for (const file of ['public/shared/js/data/postgrest-client.js', 'public/shared/js/store-model.js', 'public/shared/js/data/store-repo.js']) {
        vm.runInContext(read(file), ctx, { filename: path.basename(file) });
    }
    return win.WeotziData.Store;
}

function usedMembers(alias) {
    const re = new RegExp('\\b' + alias + '\\.([A-Za-z_$][\\w$]*)', 'g');
    return [...new Set([...catalogCode.matchAll(re)].map((m) => m[1]))];
}

test('store-catalog.js no hace CRUD ad-hoc: todo pasa por WeotziData.Store', () => {
    assert.doesNotMatch(catalogCode, /\/rest\/v1/, 'sin /rest/v1/ inline');
    assert.doesNotMatch(catalogCode, /_supabase/, 'sin _supabase');
    assert.doesNotMatch(catalogCode, /\.from\(/, 'sin .from(…)');
    assert.doesNotMatch(catalogCode, /\bfetch\(/, 'sin fetch directo');
    assert.doesNotMatch(catalogCode, /\.rpc\(/, 'sin rpc directo');
    assert.doesNotMatch(catalogCode, /client-auth|ClientAuth/, 'sin client-auth');
    assert.doesNotMatch(catalogCode, /localStorage/, 'solo sessionStorage para la memoria de la vitrina');
    // El repo solo se toma de window.WeotziData.Store y se usa con el alias Repo.
    assert.deepEqual([...new Set([...catalogCode.matchAll(/WeotziData\.(\w+)/g)].map((m) => m[1]))], ['Store']);
});

test('store-catalog.js solo llama métodos que existen en WeotziData.Store, WeotziStoreShell y WeotziStoreModel', () => {
    const Repo = repoApi();
    const repoUsed = usedMembers('Repo');
    assert.deepEqual(repoUsed.sort(), ['getPublicProduct', 'getStorefront'], 'la página pública solo lee por RPC pública');
    for (const name of repoUsed) assert.equal(typeof Repo[name], 'function', 'WeotziData.Store.' + name);

    const Shell = require('../public/shared/js/store-shell.js');
    const shellUsed = usedMembers('Shell');
    assert.ok(shellUsed.length >= 12, 'usa el shell');
    for (const name of shellUsed) assert.equal(typeof Shell[name], 'function', 'WeotziStoreShell.' + name);
    for (const name of ['mountStoreTopbar', 'viewer', 'isStoreEnabled', 'setRobots', 'setTitle', 'loginLinks', 'previewImg', 'hydrateIcons', 'esc']) {
        assert.ok(shellUsed.includes(name), 'usa Shell.' + name);
    }

    const Model = require('../public/shared/js/store-model.js');
    const modelUsed = usedMembers('Model');
    for (const name of modelUsed) assert.notEqual(Model[name], undefined, 'WeotziStoreModel.' + name);
    for (const name of ['availableTiers', 'orderTotals', 'formatMoney', 'checkoutUrl', 'productBadges', 'termsFor', 'LICENSE_TIERS', 'DESIGN_INCLUDES']) {
        assert.ok(modelUsed.includes(name), 'usa Model.' + name);
    }
});

test('store-catalog.js: copy en voseo sin exclamaciones y navegación terminada en →', () => {
    const strings = [...catalogCode.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]);
    for (const s of strings) assert.doesNotMatch(s, /[¡!]/, 'sin exclamaciones: ' + s);
    for (const copy of ['La Store todavía no está disponible.', 'Explorá artistas →', 'Este artista todavía no publicó diseños ni merch.',
        'Mirá su portafolio →', 'Ver perfil →', 'Este producto ya no está disponible.', 'Comprar →', 'Este producto es tuyo',
        'Editarlo en tu Store →', 'Ingresá como artista →', 'Qué incluye']) {
        assert.ok(catalogSource.includes(copy), 'copy del contrato: ' + copy);
    }
    // Los links de acción (wo-btn) terminan en →.
    for (const m of catalogCode.matchAll(/'([^'\n]*?)'\)?\s*\+\s*'<\/a>'/g)) {
        if (/^[A-ZÁÉÍÓÚ]/.test(m[1])) assert.match(m[1], /→$/, 'navegación con →: ' + m[1]);
    }
});

/* ------------------------------------------------------------------ */
/* 4. Helpers y HTML con los datos públicos del demo                   */
/* ------------------------------------------------------------------ */

// store-model + extensión store en su sandbox: build() lee el registro de `self`.
const sandbox = { console };
sandbox.self = sandbox;
vm.runInNewContext(read('public/shared/js/store-model.js'), sandbox, { filename: 'store-model.js' });
vm.runInNewContext(read('public/shared/js/demo-fixtures/store.js'), sandbox, { filename: 'demo-fixtures/store.js' });
global.self = sandbox;
const Postgrest = require('../public/shared/js/wo-demo-postgrest.js');
const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');

// La página corre con los globals del navegador; acá, con los del proceso.
global.WeotziStoreModel = require('../public/shared/js/store-model.js');
global.WeotziStoreShell = require('../public/shared/js/store-shell.js');
const C = require('../public/shared/js/store-catalog.js');
const M = global.WeotziStoreModel;

const IDENTITY = { userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo Artist', email: 'demo@weotzi.test' };
const sid = (n) => '0000c0de-0000-4000-8000-57' + String(n).padStart(10, '0');
const P = { D1: sid(101), D2: sid(102), D3: sid(103), M1: sid(104), M2: sid(105), M3: sid(106), MD1: sid(151), MD2: sid(152), MM1: sid(153) };
const V = { S: sid(201), M: sid(202), L: sid(203), XL: sid(204), A3: sid(206), A4: sid(207) };
const plain = (value) => JSON.parse(JSON.stringify(value));

const demo = (() => {
    const fx = Fixtures.build(IDENTITY);
    const store = Postgrest.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views });
    const rpc = (fn, args) => {
        const res = store.handle({ method: 'POST', path: 'rpc/' + fn, search: '', headers: {}, body: JSON.stringify(args), ctx: { userId: IDENTITY.userId } });
        assert.equal(res.status, 200, fn + ' → ' + res.status + ' ' + res.body);
        return res.body == null ? null : plain(JSON.parse(res.body));
    };
    return {
        front: (handle) => rpc('get_public_storefront', { p_seller_type: 'artist', p_handle: handle }),
        item: (id) => rpc('get_public_store_product', { p_product_id: id })
    };
})();

const VIEWERS = {
    anon: { role: 'anon', session: null, user: null, artist: null, artistReady: false },
    client: { role: 'client', session: {}, user: { id: '22222222-2222-4222-8222-222222222222' }, artist: null, artistReady: false },
    artist: { role: 'artist', session: {}, user: { id: '33333333-3333-4333-8333-333333333333' }, artist: {}, artistReady: true },
    pending: { role: 'artist', session: {}, user: { id: '44444444-4444-4444-8444-444444444444' }, artist: {}, artistReady: false },
    seller: { role: 'artist', session: {}, user: { id: IDENTITY.userId }, artist: {}, artistReady: true }
};
const flagsFor = (data, viewer) => C.viewerFlags(data.seller, viewer);

test('vitrina de Mara: header, «Ver perfil →», chips, cards con badges y precios en su moneda', () => {
    const front = demo.front('mara-ink.wo');
    assert.equal(front.seller.handle, 'mara-ink.wo');
    assert.equal(front.allow_search_indexing, false);
    const products = front.products;
    assert.deepEqual(C.kindCounts(products), { all: 3, design: 2, merch: 1 });
    assert.equal(C.showFilters(products), true);

    const html = C.storefrontHtml(front, C.viewerFlags(front.seller, VIEWERS.anon), 'todo');
    assert.match(html, /<h1 class="sts-title stc-hero-title" id="stc-seller-name">Mara Ink<\/h1>/);
    assert.match(html, /@mara-ink\.wo/);
    assert.match(html, /Córdoba, Argentina/);
    assert.match(html, /href="\/artist\/profile\/\?artist=mara-ink\.wo">Ver perfil →<\/a>/);
    assert.match(html, /Blackwork y ornamental desde Córdoba\./, 'tagline');
    assert.match(html, /<summary class="stc-fold-summary"><span>Envíos<\/span>/, 'política de envíos plegable');
    assert.match(html, /<span>Cambios y devoluciones<\/span>/);
    assert.equal((html.match(/data-stc-filter=/g) || []).length, 3, 'chips Todo · Diseños · Merch');
    assert.match(html, /data-stc-filter="todo" aria-pressed="true">Todo <span class="stc-chip-count">3<\/span>/);
    assert.equal((html.match(/class="sts-card stc-card"/g) || []).length, 3);
    assert.match(html, new RegExp('href="/store/item/\\?id=' + P.MD2 + '"'));
    assert.match(html, /Desde USD 25/, 'diseño: desde el nivel más barato');
    assert.match(html, /<p class="sts-card-price">ARS 18\.000<\/p>/, 'merch con un solo precio: sin «Desde»');
    assert.match(html, /Exclusiva disponible/, 'MD2 tiene la exclusiva disponible');
    assert.doesNotMatch(html, /Gestionar tu Store/, 'solo el vendedor ve el link de gestión');
    assert.match(html, /<h2 class="sts-section-title" id="stc-catalog-title">Diseños y merch<\/h2>/);
    assert.match(html, /<p class="stc-count" id="stc-count" aria-live="polite">3 productos<\/p>/);

    const merchOnly = C.storefrontHtml(front, C.viewerFlags(front.seller, VIEWERS.anon), 'merch');
    assert.equal((merchOnly.match(/class="sts-card stc-card"/g) || []).length, 1, '?tipo=merch filtra');
    assert.match(merchOnly, /data-stc-filter="merch" aria-pressed="true"/);
});

test('vitrina propia: el vendedor ve «Gestionar tu Store →»; los retirados no aparecen', () => {
    const front = demo.front('demo.wo');
    const ids = front.products.map((p) => p.id);
    assert.ok(!ids.includes(P.D3), 'el diseño retirado por exclusiva no es público');
    assert.deepEqual(C.kindCounts(front.products), { all: 5, design: 2, merch: 3 });
    const html = C.storefrontHtml(front, C.viewerFlags(front.seller, VIEWERS.seller), 'todo');
    assert.match(html, /href="\/artist\/store\/">Gestionar tu Store →<\/a>/);
    assert.match(html, /Reservado/, 'D2 reservado');
});

test('filtros: ?tipo= se normaliza y se ignora si no hay de los dos tipos', () => {
    const products = demo.front('mara-ink.wo').products;
    assert.equal(C.normalizeFilter('merch', products), 'merch');
    assert.equal(C.normalizeFilter('disenos', products), 'disenos');
    assert.equal(C.normalizeFilter('diseños', products), 'disenos');
    assert.equal(C.normalizeFilter('cualquiera', products), 'todo');
    assert.equal(C.normalizeFilter('', products), 'todo');
    assert.equal(C.normalizeFilter('__proto__', products), 'todo');
    const designs = products.filter((p) => p.kind === 'design');
    assert.equal(C.normalizeFilter('merch', designs), 'todo', 'sin merch no hay filtro');
    assert.equal(C.showFilters(designs), false);
    assert.deepEqual(C.filterProducts(products, 'disenos').map((p) => p.kind), ['design', 'design']);
    assert.equal(C.filterProducts(products, 'todo').length, 3);
});

test('vitrina vacía: «Este artista todavía no publicó diseños ni merch. Mirá su portafolio →»', () => {
    const front = demo.front('mara-ink.wo');
    const html = C.storefrontHtml(Object.assign({}, front, { products: [] }), C.viewerFlags(front.seller, VIEWERS.anon), 'todo');
    assert.match(html, /Este artista todavía no publicó diseños ni merch\./);
    assert.match(html, /href="\/artist\/profile\/\?artist=mara-ink\.wo">Mirá su portafolio →<\/a>/);
    assert.doesNotMatch(html, /data-stc-filter/);
});

test('precios: merch sin price_amount público se deduce solo cuando es exacto', () => {
    const m1 = demo.item(P.M1).product;
    const m2 = demo.item(P.M2).product;
    assert.equal(m1.price_amount, undefined, 'la ficha pública no trae price_amount');
    assert.deepEqual(C.merchPricing(m1), { base: 28000, exact: true }, 'todas heredan: base = price_from');
    assert.deepEqual(C.merchPricing(m2), { base: 28, exact: false }, 'A4 con override igual a price_from: la base de A3 es desconocida');
    assert.deepEqual(C.variantPrice(m2, m2.variants.find((v) => v.id === V.A4)), { amount: 28, approx: false });
    assert.deepEqual(C.variantPrice(m2, m2.variants.find((v) => v.id === V.A3)), { amount: 28, approx: true });
    const withBase = Object.assign({}, m2, { price_amount: 40 });
    assert.deepEqual(C.variantPrice(withBase, withBase.variants.find((v) => v.id === V.A3)), { amount: 40, approx: false });
    assert.equal(C.priceSummary(m1).label, 'ARS 28.000');
    assert.equal(C.priceSummary(m2).label, 'Desde USD 28');
    assert.equal(C.priceSummary(demo.item(P.D1).product).label, 'Desde USD 35');
    assert.equal(C.priceSummary(Object.assign({}, demo.item(P.D1).product, { license_artist_price: null, license_exclusive_price: null })).label, 'USD 35');
    assert.equal(C.pricedProduct(m1).price_amount, 28000);
    assert.equal(C.kindLine(demo.item(P.D1).product), 'Diseño · Fine line');
    assert.equal(C.kindLine(m1), 'Merch · Remeras');
});

test('niveles de licencia: radio group con motivo para los no disponibles', () => {
    const d1 = demo.item(P.D1);
    const client = C.tierOptions(d1.product, flagsFor(d1, VIEWERS.client));
    assert.deepEqual(client.map((t) => [t.id, t.available]), [['personal', true], ['artist', false], ['exclusive', true]]);
    const artistTier = client.find((t) => t.id === 'artist');
    assert.equal(artistTier.code, 'artist_tier_requires_artist');
    assert.equal(artistTier.reason, 'Solo para cuentas de artista');
    assert.equal(artistTier.link.label, 'Ingresá como artista →');
    assert.match(artistTier.link.href, /^\/artist\/login\?returnTo=/);

    const pending = C.tierOptions(d1.product, flagsFor(d1, VIEWERS.pending)).find((t) => t.id === 'artist');
    assert.equal(pending.available, false);
    assert.match(pending.reason, /Completá tu registro de artista/);

    assert.ok(C.tierOptions(d1.product, flagsFor(d1, VIEWERS.artist)).every((t) => t.available), 'artista con registro completo');

    const own = C.tierOptions(d1.product, flagsFor(d1, VIEWERS.seller));
    assert.ok(own.every((t) => !t.available && t.code === 'own_product'), 'el vendedor no se compra a sí mismo');

    const md1 = demo.item(P.MD1);
    const exclusive = C.tierOptions(md1.product, flagsFor(md1, VIEWERS.client)).find((t) => t.id === 'exclusive');
    assert.equal(exclusive.code, 'exclusive_unavailable', 'MD1 ya tiene licencias vendidas');

    const html = C.itemHtml(d1, flagsFor(d1, VIEWERS.client), C.initialItemState(d1.product, flagsFor(d1, VIEWERS.client), {}));
    assert.match(html, /<fieldset class="stc-fieldset stc-tiers"><legend class="stc-legend">Elegí la licencia<\/legend>/);
    assert.equal((html.match(/type="radio" name="stc-tier"/g) || []).length, 3, 'tres tarjetas de nivel');
    assert.match(html, /id="stc-tier-personal" value="personal" checked aria-describedby="stc-tier-personal-summary">/);
    assert.match(html, /id="stc-tier-artist" value="artist" disabled aria-describedby="stc-tier-artist-summary stc-tier-artist-reason">/);
    assert.match(html, /<label class="stc-tier-label" for="stc-tier-personal">/);
    assert.match(html, /Solo para cuentas de artista<\/span><a href="\/artist\/login\?returnTo=[^"]+">Ingresá como artista →<\/a>/);
    assert.match(html, /Con la licencia Personal/, 'bullets del nivel elegido');
    assert.match(html, /Términos de la licencia Personal · v2026-10/, 'términos plegables del nivel');
    assert.match(html, /Reglas para todas las licencias/);
    assert.match(html, /Qué incluye/);
    for (const include of M.DESIGN_INCLUDES) assert.ok(html.includes(include.label), 'incluye ' + include.label);
    assert.match(html, /<dt>Medidas<\/dt><dd>9 × 7 cm<\/dd>/);
    assert.match(html, /<dt>Ubicación sugerida<\/dt><dd>Antebrazo interno o tobillo<\/dd>/);
    assert.match(html, /id="stc-buy-cta"[^>]*>Comprar →<\/a>/);
    assert.match(html, /href="\/store\/\?artist=demo\.wo">Store de Demo Artist<\/a>/, 'ruta con la Store del vendedor');
    assert.match(html, /Ver su Store →/);
});

test('ficha de diseño: CTA «Comprar →» al checkout con el nivel; reservado bloquea; el vendedor edita', () => {
    const d1 = demo.item(P.D1);
    const flags = flagsFor(d1, VIEWERS.client);
    const state = C.initialItemState(d1.product, flags, { license: 'artist' });
    assert.equal(state.tier, 'personal', 'un nivel no disponible cae al primero disponible');
    const buy = C.buyState(d1.product, state, flags);
    assert.equal(buy.mode, 'buy');
    assert.equal(buy.amount, 'USD 35');
    assert.equal(buy.href, '/store/checkout/?item=' + P.D1 + '&license=personal');
    const exclusive = C.buyState(d1.product, Object.assign({}, state, { tier: 'exclusive' }), flags);
    assert.equal(exclusive.amount, 'USD 420');
    assert.equal(exclusive.href, '/store/checkout/?item=' + P.D1 + '&license=exclusive');

    const d2 = demo.item(P.D2);
    const reserved = C.buyState(d2.product, C.initialItemState(d2.product, flagsFor(d2, VIEWERS.client), {}), flagsFor(d2, VIEWERS.client));
    assert.equal(reserved.mode, 'blocked');
    assert.equal(reserved.hint, M.ERROR_COPY.product_reserved);
    assert.equal(reserved.amount, 'Desde ARS 45.000');

    const sellerFlags = flagsFor(d1, VIEWERS.seller);
    const own = C.buyState(d1.product, C.initialItemState(d1.product, sellerFlags, {}), sellerFlags);
    assert.equal(own.mode, 'own');
    assert.equal(own.editHref, '/artist/store/?editar=' + P.D1);
    const ownHtml = C.itemHtml(d1, sellerFlags, C.initialItemState(d1.product, sellerFlags, {}));
    assert.match(ownHtml, /Este producto es tuyo/);
    assert.match(ownHtml, new RegExp('href="/artist/store/\\?editar=' + P.D1 + '">Editarlo en tu Store →</a>'));
    assert.doesNotMatch(ownHtml, /stc-buy-cta/, 'sin CTA de compra para el vendedor');
});

test('ficha de merch: variante, stock, cantidad, totales con envío y retiro, y CTA al checkout', () => {
    const m1 = demo.item(P.M1);
    const flags = flagsFor(m1, VIEWERS.client);
    const state = C.initialItemState(m1.product, flags, {});
    assert.equal(state.variantId, null, 'con varias variantes en stock no se preelige');
    const none = C.buyState(m1.product, state, flags);
    assert.equal(none.mode, 'blocked');
    assert.equal(none.hint, 'Elegí un talle para continuar.');
    assert.equal(none.amount, 'ARS 28.000');

    const small = m1.product.variants.find((v) => v.id === V.S);
    assert.deepEqual(C.variantState(small), { available: true, max: 4, note: 'Quedan 4' });
    assert.deepEqual(C.variantState(m1.product.variants.find((v) => v.id === V.L)), { available: false, max: 0, note: 'Sin stock' });
    assert.deepEqual(C.variantState(m1.product.variants.find((v) => v.id === V.M)), { available: true, max: 20, note: '' });
    assert.equal(C.variantState({ in_stock: true, low_stock: 1 }).note, 'Queda 1');
    assert.equal(C.variantLegend(m1.product.variants).label, 'Talle');

    const chosen = C.initialItemState(m1.product, flags, { variant: V.S, qty: '9' });
    assert.deepEqual([chosen.variantId, chosen.quantity], [V.S, 4], 'la cantidad se limita al stock');
    const two = C.buyState(m1.product, Object.assign({}, chosen, { quantity: 2 }), flags);
    assert.equal(two.mode, 'buy');
    assert.equal(two.amount, 'ARS 56.000');
    assert.equal(two.caption, 'Talle S · ARS 28.000 × 2');
    assert.deepEqual(two.rows.map((r) => [r.label, r.value]), [['Total con envío', 'ARS 62.500'], ['Total con retiro', 'ARS 56.000']]);
    assert.equal(two.rows[0].detail, 'Envío ARS 6.500');
    assert.equal(two.href, '/store/checkout/?item=' + P.M1 + '&variant=' + V.S + '&qty=2');
    assert.equal(C.clampQty(0, 4), 1);
    assert.equal(C.clampQty(99, Infinity), 20);

    const html = C.itemHtml(m1, flags, chosen);
    assert.match(html, /<legend class="stc-legend">Talle<\/legend>/);
    assert.match(html, new RegExp('value="' + V.S + '" checked>'));
    assert.match(html, new RegExp('value="' + V.L + '" disabled>'), 'sin stock: deshabilitada');
    assert.match(html, /<span class="stc-variant-note">Quedan 4<\/span>/);
    assert.match(html, /<label class="stc-legend" for="stc-qty-input">Cantidad<\/label>/);
    assert.match(html, /id="stc-qty-input" type="number" inputmode="numeric" min="1" max="4" step="1" value="4"/);
    assert.match(html, /Hace envíos a Argentina y Uruguay\./);
    assert.match(html, /Costo de envío: ARS 6\.500 por pedido\./);
    assert.match(html, /Retiro en el estudio/);
    assert.match(html, /Palermo, Buenos Aires · martes a sábado de 12 a 19 h/, 'nota pública de retiro');
    assert.match(html, /Pagás en ARS, la moneda que eligió el vendedor\. No convertimos el precio\./);

    const tote = demo.item(P.MM1);
    assert.deepEqual(C.deliveryMethods(tote.product), ['shipping'], 'Mara no ofrece retiro');
    const toteState = C.initialItemState(tote.product, flagsFor(tote, VIEWERS.client), {});
    assert.ok(toteState.variantId, 'con una sola variante en stock se preelige');
    const toteBuy = C.buyState(tote.product, toteState, flagsFor(tote, VIEWERS.client));
    assert.deepEqual(toteBuy.rows.map((r) => r.label), ['Total']);
    assert.equal(toteBuy.mode, 'buy');

    const m2 = demo.item(P.M2);
    const a3 = C.buyState(m2.product, { variantId: V.A3, quantity: 1 }, flagsFor(m2, VIEWERS.client));
    assert.equal(a3.amount, 'Desde USD 28', 'precio no exacto: se aclara');
    assert.match(a3.note, /se confirma en el checkout/);
    const noDelivery = C.buyState(Object.assign({}, m1.product, { shipping_price_amount: null, pickup_available: false }), chosen, flags);
    assert.equal(noDelivery.mode, 'blocked');
    assert.match(noDelivery.hint, /no tiene envío ni retiro/);
    const soldOut = C.buyState(Object.assign({}, m1.product, { variants: m1.product.variants.map((v) => Object.assign({}, v, { in_stock: false, low_stock: 0 })) }), { variantId: null, quantity: 1 }, flags);
    assert.match(soldOut.hint, /Agotado/);
});

test('ficha: galería accesible con miniaturas y alt', () => {
    const m1 = demo.item(P.M1);
    const html = C.itemHtml(m1, flagsFor(m1, VIEWERS.anon), C.initialItemState(m1.product, flagsFor(m1, VIEWERS.anon), {}));
    assert.match(html, /<section class="stc-gallery" aria-label="Imágenes del producto">/);
    assert.match(html, /<img class="sts-img" src="\/shared\/assets\/demo\/store\/remera-golondrina\.svg" alt="Remera negra con la golondrina, frente"[^>]*loading="eager"/);
    assert.match(html, /<div class="stc-thumbs" role="group" aria-label="Elegí una imagen">/);
    assert.match(html, /data-stc-thumb="0" aria-pressed="true" aria-controls="stc-gallery-main" aria-label="Ver imagen 1 de 2: Remera negra con la golondrina, frente"/);
    assert.match(html, /data-stc-thumb="1" aria-pressed="false"/);
    const d1 = demo.item(P.D1);
    const single = C.itemHtml(d1, flagsFor(d1, VIEWERS.anon), C.initialItemState(d1.product, flagsFor(d1, VIEWERS.anon), {}));
    assert.doesNotMatch(single, /stc-thumbs/, 'con una sola imagen no hay miniaturas');
});

test('el HTML escapa todo dato del servidor', () => {
    const evil = '<img src=x onerror="alert(1)">';
    const d1 = demo.item(P.D1);
    const data = plain(d1);
    Object.assign(data.product, { title: evil, description: evil + '\n<script>x()</script>', design_style: evil, tags: [evil], images: [{ path: 'demo/store/x.svg', alt: '" onload="x' }] });
    Object.assign(data.seller, { name: evil, handle: 'a"b', avatar_url: 'javascript:alert(1)', city: evil });
    Object.assign(data.settings, { tagline: evil, shipping_policy: evil, return_policy: evil });
    const flags = flagsFor(data, VIEWERS.client);
    const outputs = [
        C.itemHtml(data, flags, C.initialItemState(data.product, flags, {})),
        C.cardHtml(data.product),
        C.storefrontHtml({ seller: data.seller, settings: data.settings, products: [data.product], allow_search_indexing: false }, flags, 'todo')
    ];
    for (const html of outputs) {
        assert.doesNotMatch(html, /<img src=x/);
        assert.doesNotMatch(html, /<script>/);
        assert.doesNotMatch(html, /javascript:/);
        assert.doesNotMatch(html, /alt="" onload=/);
        assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    }
    assert.equal(C.avatarUrl('javascript:alert(1)'), '');
    assert.equal(C.avatarUrl('//evil.test/a.png'), '');
    assert.equal(C.avatarUrl('http://insecure.test/a.png'), '');
    assert.equal(C.avatarUrl('https://cdn.test/a.png'), 'https://cdn.test/a.png');
    assert.equal(C.avatarUrl('/shared/assets/demo/store/mara-avatar.svg'), '/shared/assets/demo/store/mara-avatar.svg');
});

test('mensajes de página: h1 propio y acción con →', () => {
    const html = C.messageHtml({ icon: 'package', title: 'Este producto ya no está disponible.', text: 'x', actionLabel: 'Explorá artistas →', actionHref: '/marketplace' });
    assert.match(html, /<h1 class="sts-empty-title">Este producto ya no está disponible\.<\/h1>/);
    assert.match(html, /href="\/marketplace">Explorá artistas →<\/a>/);
    assert.equal(C.countryList(['AR', 'UY']), 'Argentina y Uruguay');
    assert.equal(C.countryList(['CL', 'ES', 'IT']), 'Chile, España e Italia');
    assert.equal(C.sizeLabel({ design_width_cm: 7.5, design_height_cm: 12 }), '7,5 × 12 cm');
    assert.equal(C.sizeLabel({}), '');
});
