'use strict';
// Store del artista · página de gestión /artist/store/
// (docs/plans/2026-10-30-store-artista.md §8.4 y §8.7).
//
// Contratos estáticos del HTML (orden de scripts, nav y footer únicos, tabs y
// diálogos accesibles), del CSS (prefijo .ast-, sin hex, :not([hidden])) y del
// JS (sin CRUD inline; solo métodos que existen en WeotziData.Store,
// WeotziStoreModel y WeotziStoreWatermark). Más un recorrido en ejecución:
// artist-store.js con un DOM mínimo contra el emulador del preview (fixtures de
// la extensión store), sin red ni Storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const HTML_PATH = 'public/artist/store/index.html';
const JS_PATH = 'public/shared/js/artist-store.js';
const CSS_PATH = 'public/shared/css/artist-store-ds.css';
const html = read(HTML_PATH);
const js = read(JS_PATH);
const css = read(CSS_PATH);
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const jsNoComments = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function indexOfOrFail(haystack, needle, label) {
    const i = haystack.indexOf(needle);
    assert.notEqual(i, -1, label + ': falta ' + needle);
    return i;
}

/* ------------------------------ HTML ------------------------------ */

test('HTML: wo-demo.js es el primer script, con el mismo ?v= que Travel', () => {
    const firstScript = html.match(/<script\b[^>]*>/);
    assert.ok(firstScript, 'hay scripts');
    assert.match(firstScript[0], /src="\/shared\/js\/wo-demo\.js\?v=[^"]+"/);
    const travel = read('public/artist/travel/index.html').match(/\/shared\/js\/wo-demo\.js\?v=([^"]+)"/);
    const mine = html.match(/\/shared\/js\/wo-demo\.js\?v=([^"]+)"/);
    assert.equal(mine[1], travel[1], 'mismo ?v= que /artist/travel');
    assert.equal((html.match(/\/shared\/js\/wo-demo\.js/g) || []).length, 1, 'un solo include de wo-demo.js');
});

test('HTML: head con fuentes, DS, organismos y supabase-js en orden', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    const order = [
        '/shared/js/wo-demo.js',
        'fonts.googleapis.com/css2',
        '/shared/css/ds/tokens.css',
        '/shared/css/ds/components.css',
        '/shared/css/ds/organisms.css',
        '/shared/css/artist-store-ds.css',
        '/shared/js/wo-icons.js',
        '/shared/js/ds/organisms.js',
        '@supabase/supabase-js@2'
    ].map((needle) => indexOfOrFail(head, needle, 'head'));
    assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'orden del head');
    assert.match(head, /<script src="\/shared\/js\/wo-icons\.js" defer><\/script>/);
    assert.match(head, /<script src="\/shared\/js\/ds\/organisms\.js" defer><\/script>/);
    assert.match(head, /<title>We Ötzi · Store<\/title>/);
});

test('HTML: scripts del body en el orden del contrato y wo-artist-menu.js con defer', () => {
    const body = html.slice(html.indexOf('<body'));
    const order = [
        '/shared/js/config-manager.js',
        '/shared/js/data/postgrest-client.js',
        '/shared/js/data/artists-repo.js',
        '/shared/js/currency-utils.js',
        '/shared/js/store-model.js',
        '/shared/js/store-watermark.js',
        'heic2any@0.0.4/dist/heic2any.min.js',
        '/shared/js/heic-converter.js',
        '/shared/js/data/store-repo.js',
        '/shared/js/artist-store.js',
        '/shared/js/wo-artist-menu.js'
    ].map((needle) => indexOfOrFail(body, needle, 'body'));
    assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'orden de los scripts del body');
    assert.match(body, /<script src="\/shared\/js\/wo-artist-menu\.js" defer><\/script>/);
    assert.match(body, /https:\/\/cdn\.jsdelivr\.net\/npm\/heic2any@0\.0\.4\/dist\/heic2any\.min\.js/, 'heic2any pineado');
    // Ninguna página de la Store carga client-auth.js ni store-shell.js: usa el shell del artista.
    assert.doesNotMatch(html, /client-auth\.js|store-shell\.js|\/shared\/css\/store-ds\.css/);
});

test('HTML: un único <weotzi-product-nav active="store"> y un único <weotzi-product-footer>', () => {
    const navs = html.match(/<weotzi-product-nav\b[^>]*>/g) || [];
    assert.equal(navs.length, 1);
    const nav = navs[0];
    for (const attr of ['active="store"', 'menu-id="st-mobile-menu"', 'menu-toggle-id="st-mobile-menu-toggle"', 'menu-class="ast-mobile-menu"', 'profile-label="Centro de la cuenta"', 'logout-id="st-logout"']) {
        assert.ok(nav.includes(attr), 'nav con ' + attr);
    }
    assert.equal((html.match(/<weotzi-product-footer\b/g) || []).length, 1);
    assert.doesNotMatch(html, /<header class="[^"]*wo-topbar--artist/, 'sin topbar propia');
    // El componente no cablea el menú móvil ni el logout: lo hace la página.
    assert.match(js, /\$\('st-mobile-menu-toggle'\)/);
    assert.match(js, /\$\('st-mobile-menu'\)/);
    assert.match(js, /\$\('st-logout'\)/);
});

test('HTML: encabezado, botones y tabs del contrato (§8.4)', () => {
    assert.match(html, /<p class="wo-eyebrow">Store<\/p>/);
    assert.match(html, /<h1 class="wo-h1 ast-title"[^>]*>Tu Store<\/h1>/);
    assert.match(html, /Vendé merch y diseños con licencia de uso\./);
    assert.match(html, /id="ast-new-design"[\s\S]*?Nuevo diseño/);
    assert.match(html, /id="ast-new-merch"[\s\S]*?Nuevo producto/);
    assert.match(html, /id="ast-public-link"[^>]*>Ver tu Store pública →<\/a>/);
    assert.match(js, /M\.storeUrl\(state\.username\)/, 'el link público usa WeotziStoreModel.storeUrl');
    for (const label of ['Ventas del mes', 'Pagos por confirmar', 'Pedidos por preparar', 'Productos publicados']) assert.ok(html.includes(label), label);

    assert.match(html, /role="tablist"/);
    const tabs = [['disenos', 'Diseños'], ['merch', 'Merch'], ['pedidos', 'Pedidos'], ['ajustes', 'Ajustes']];
    for (const [key, label] of tabs) {
        const tab = html.match(new RegExp('<button[^>]*id="ast-tab-' + key + '"[^>]*>'));
        assert.ok(tab, 'tab ' + key);
        assert.match(tab[0], /role="tab"/);
        assert.match(tab[0], new RegExp('aria-controls="ast-panel-' + key + '"'));
        assert.match(tab[0], /aria-selected="(true|false)"/);
        assert.ok(html.includes('>' + label + ' <span'), 'texto de la tab ' + label);
        const panel = html.match(new RegExp('<section[^>]*id="ast-panel-' + key + '"[^>]*>'));
        assert.ok(panel, 'panel ' + key);
        assert.match(panel[0], /role="tabpanel"/);
        assert.match(panel[0], new RegExp('aria-labelledby="ast-tab-' + key + '"'));
    }
    assert.match(html, /Indicá cómo pagar el monto exacto en la moneda del producto/);
});

test('HTML: drawers y diálogos con role, aria-modal y título existente; arrancan hidden', () => {
    for (const id of ['ast-editor', 'ast-order', 'ast-dlg-payment', 'ast-dlg-confirm']) {
        const overlay = html.match(new RegExp('<div class="[^"]*wo-overlay[^"]*" id="' + id + '" hidden>\\s*<div[^>]*>'));
        assert.ok(overlay, id + ' arranca hidden y es .wo-overlay');
        const dialog = overlay[0].match(/<div[^>]*>$/)[0];
        assert.match(dialog, /role="(dialog|alertdialog)"/, id + ' role');
        assert.match(dialog, /aria-modal="true"/, id + ' aria-modal');
        assert.match(dialog, /tabindex="-1"/, id + ' enfocable');
        const labelled = dialog.match(/aria-labelledby="([^"]+)"/);
        assert.ok(labelled && html.includes('id="' + labelled[1] + '"'), id + ' aria-labelledby apunta a un id real');
    }
    assert.match(js, /function wireLayers\(\)[\s\S]*?event\.key === 'Escape'[\s\S]*?event\.key !== 'Tab'/, 'focus trap con Escape y Tab');
});

test('HTML: todo control con id tiene un label real (o es un checkbox dentro de su label)', () => {
    const controls = html.match(/<(input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g) || [];
    assert.ok(controls.length > 20);
    const missing = [];
    for (const tag of controls) {
        const id = tag.match(/\bid="([^"]+)"/)[1];
        if (/type="checkbox"/.test(tag)) {
            const before = html.slice(Math.max(0, html.indexOf(tag) - 160), html.indexOf(tag));
            if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
        }
        if (html.includes('for="' + id + '"') || /aria-label="/.test(tag)) continue;
        missing.push(id);
    }
    assert.deepEqual(missing, [], 'controles sin label');
});

test('HTML y JS: copy sin «!» ni «¡» y navegación terminada en →', () => {
    const text = html.replace(/<!DOCTYPE[^>]*>/i, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(text.replace(/<[^>]+>/g, ' '), /[!¡]/);
    const strings = jsNoComments.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
    const offenders = strings.filter((s) => /[¡]|[A-Za-zÁÉÍÓÚáéíóúñ]!/.test(s));
    assert.deepEqual(offenders, [], 'strings con signos de exclamación');
    for (const copy of ['Volver al dashboard →', 'Completar registro →', 'Ir a Ajustes →', 'Ver certificado →']) assert.ok(js.includes(copy), copy);
});

/* ------------------------------ CSS ------------------------------ */

test('CSS: prefijo .ast-, solo tokens (sin hex ni rgb), radius 0 y :not([hidden])', () => {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos');
    assert.doesNotMatch(cssNoComments, /\brgba?\(|\bhsla?\(/, 'sin colores literales');
    assert.doesNotMatch(cssNoComments, /border-radius:(?!var\(--radius-none\))/, 'radius 0');
    assert.match(cssNoComments, /:not\(\[hidden\]\)\{display:flex\}/, 'mostrar por estado con :not([hidden])');
    // Ningún selector muestra un elemento con [hidden] (tests/hidden-overlays.test.js).
    const re = /([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(cssNoComments)) !== null) {
        if (m[1].includes(':not([hidden])')) continue;
        assert.doesNotMatch(m[2], /display\s*:/, 'selector con [hidden]: ' + m[1].trim());
    }
    // Cada selector de la hoja pertenece a la página (.ast-, #ast- o body.ast-).
    const blocks = cssNoComments.replace(/@media[^{]+\{/g, '').split('}');
    const foreign = [];
    for (const block of blocks) {
        const selector = block.split('{')[0].trim();
        if (!selector || !block.includes('{')) continue;
        selector.split(',').forEach((s) => { if (!/ast-/.test(s)) foreign.push(s.trim()); });
    }
    assert.deepEqual(foreign, [], 'selectores sin el prefijo de la página');
    assert.doesNotMatch(cssNoComments, /prefers-color-scheme/, 'sin modo oscuro');
});

/* ------------------------------ JS ------------------------------ */

test('JS: sin CRUD ad-hoc ni red directa (solo WeotziData.Store / WeotziData.Artists)', () => {
    assert.doesNotMatch(js, /\/rest\/v1/);
    assert.doesNotMatch(js, /_supabase\.from\(/);
    assert.doesNotMatch(js, /\.from\(['"]/, 'sin client.from(...) ni storage.from(...)');
    assert.doesNotMatch(js, /\bfetch\(/);
    assert.doesNotMatch(js, /\.rpc\(/);
    assert.doesNotMatch(js, /createClient\(/, 'no crea clientes propios');
    assert.match(js, /window\.WeotziData\.Artists\.getByUserId\(/);
    assert.doesNotMatch(js, /`/, 'sin template literals: todo el HTML dinámico pasa por esc()');
    assert.match(js, /function esc\(value\)/);
});

function storeRepoMethods() {
    const src = read('public/shared/js/data/store-repo.js');
    const start = src.indexOf('const Store = {');
    const end = src.indexOf('\n    };', start);
    assert.ok(start !== -1 && end !== -1, 'objeto Store en store-repo.js');
    const body = src.slice(start, end);
    const names = new Set();
    for (const m of body.matchAll(/^ {8}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
    for (const m of body.matchAll(/^ {8}([A-Za-z_$][\w$]*),\s*$/gm)) names.add(m[1]);
    // Control cruzado: el objeto real que expone el repo.
    const win = { WeotziData: { run() {}, getClient() { return null; } } };
    vm.runInNewContext(src, { window: win, console });
    assert.deepEqual([...names].sort(), Object.keys(win.WeotziData.Store).sort(), 'el parseo coincide con WeotziData.Store');
    return names;
}

test('JS: solo usa métodos que existen en WeotziData.Store', () => {
    const methods = storeRepoMethods();
    const used = new Set([...jsNoComments.matchAll(/\bStore\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    assert.ok(used.size >= 20, 'la página usa el repo');
    const unknown = [...used].filter((name) => !methods.has(name));
    assert.deepEqual(unknown, [], 'métodos inexistentes en WeotziData.Store');
    for (const name of ['featureEnabled', 'isAvailable', 'previewUrl', 'listMyProducts', 'listSellerOrders', 'getSellerSettings', 'getSalesReport',
        'createProduct', 'updateProduct', 'setProductStatus', 'deleteDraftProduct', 'saveVariants', 'adjustStock', 'uploadPreviewImage',
        'removePreviewImage', 'uploadDesignAsset', 'removeDesignAsset', 'saveSellerSettings', 'confirmPayment', 'updateFulfillment',
        'cancelOrder', 'refundOrder', 'getMyProduct']) {
        assert.ok(used.has(name), 'usa Store.' + name);
    }
});

test('JS: solo usa API que existe en WeotziStoreModel y WeotziStoreWatermark', () => {
    const M = require('../public/shared/js/store-model.js');
    const W = require('../public/shared/js/store-watermark.js');
    const modelUsed = [...new Set([...jsNoComments.matchAll(/\bM\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
    assert.deepEqual(modelUsed.filter((n) => !(n in M)), [], 'WeotziStoreModel');
    const wmUsed = [...new Set([...jsNoComments.matchAll(/\bWatermark\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
    assert.deepEqual(wmUsed.filter((n) => !(n in W)), [], 'WeotziStoreWatermark');
    assert.ok(wmUsed.includes('renderPreview') && wmUsed.includes('renderPlain'), 'marca de agua en diseños, imagen plana en merch');
});

test('JS: guard de sesión, registro y gate de la Store', () => {
    assert.match(js, /'\/artist\/login\?returnTo=%2Fartist%2Fstore'/);
    assert.match(js, /registration_status === 'incompleto'/);
    assert.match(js, /Store\.featureEnabled\(\) && await Store\.isAvailable\(\)/);
    assert.ok((js + html).includes('La Store todavía no está habilitada'));
    assert.match(js, /const SELLER_TYPE = 'artist'/);
    assert.match(js, /state\.uid = state\.session\.user\.id/);
    for (const key of ['tab', 'nuevo', 'editar', 'pedido', 'modal']) assert.ok(js.includes("params.get('" + key + "')"), '?' + key + '=');
    assert.match(js, /\['disenos', 'merch', 'pedidos', 'ajustes'\]/);
    assert.match(js, /modal === 'confirmar-pago'/);
    assert.match(js, /collectedBy: order\.expected_collector/);
    assert.match(js, /Confirmá que ya le devolviste el dinero\./);
    assert.match(js, /authorship_attested_at: attested \?/);
    assert.match(js, /MAX_IMAGES = 8/);
});

test('las listas compartidas de páginas del artista incluyen /artist/store/', () => {
    assert.match(read('tests/demo-tour.test.js'), /'public\/artist\/store\/index\.html'/);
    const topbar = read('tests/mobile-topbar-responsive.test.js');
    assert.match(topbar, /parts: \['public', 'artist', 'store', 'index\.html'\], active: 'store', menu: 'st-mobile-menu'/);
    assert.match(topbar, /\['public', 'artist', 'store', 'index\.html'\],\r?\n/);
});

/* ------------------------------ ejecución ------------------------------ */

// DOM mínimo: cada id es un elemento stub. Alcanza para recorrer los caminos de
// render y acciones de la página (los innerHTML se leen como texto).
function stubElement(id) {
    return {
        id, hidden: false, textContent: '', innerHTML: '', value: '', checked: false, disabled: false, required: false,
        maxLength: 0, placeholder: '', tabIndex: 0, files: null, className: '', isConnected: true,
        dataset: {}, style: { setProperty() {} }, attributes: {}, listeners: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
        removeAttribute(k) { delete this.attributes[k]; },
        hasAttribute(k) { return k in this.attributes; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
        matches() { return false; }, contains() { return false; }, focus() {}, getClientRects() { return [1]; }
    };
}

function memoryStorage() {
    const values = new Map();
    return { getItem: (k) => (values.has(k) ? values.get(k) : null), setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}

async function bootPage() {
    const registry = { console };
    registry.self = registry;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/store.js'), registry, { filename: 'demo-fixtures/store.js' });
    const previousSelf = global.self;
    global.self = registry;
    const bootPreview = require('../scripts/release/preview-bootstrap');
    const location = { origin: 'https://preview.weotzi.com', pathname: '/artist/store/', search: '', hash: '', navigations: [] };
    Object.defineProperty(location, 'href', {
        get() { return this.origin + this.pathname + this.search + this.hash; },
        set(value) { this.navigations.push(value); }
    });
    const previewWindow = {
        location, Response, Headers, btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
        document: { addEventListener() {}, body: null },
        localStorage: memoryStorage(), sessionStorage: memoryStorage(),
        WoDemoFixtures: require('../public/shared/js/wo-demo-fixtures'),
        WoDemoPostgrest: require('../public/shared/js/wo-demo-postgrest'),
        navigator: { sendBeacon() { throw new Error('sin beacons'); } },
        fetch: async () => { throw new Error('el preview no sale a la red'); }
    };
    const runtime = bootPreview(previewWindow);
    await runtime.ready;
    global.self = previousSelf;
    const client = previewWindow.supabase.createClient('https://preview.weotzi.invalid', 'preview');

    const elements = new Map();
    const docListeners = {};
    const winListeners = {};
    const errors = [];
    const document = {
        getElementById(id) { if (!elements.has(id)) elements.set(id, stubElement(id)); return elements.get(id); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
        body: stubElement('body'),
        activeElement: null
    };
    class HTMLElement { static [Symbol.hasInstance](value) { return !!value && typeof value === 'object'; } }
    const sandbox = {
        WEOTZI_PREVIEW: true, location, document, HTMLElement, URL, URLSearchParams, Blob, Uint8Array,
        console: { log() {}, info() {}, warn() {}, error(...args) { errors.push(args.map(String).join(' ')); } },
        setTimeout: () => 0, clearTimeout() {},
        requestAnimationFrame: (fn) => { try { fn(); } catch (err) { errors.push('raf: ' + err.message); } },
        history: { state: null, replaceState(state, title, next) { const u = new URL(next, location.origin); location.pathname = u.pathname; location.search = u.search; location.hash = u.hash; } },
        addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
        _supabase: client,
        ConfigManager: { ready: async () => ({}), getSupabaseClient: () => client, getValue: () => null },
        WoIcons: { hydrate() {} },
        CSS: { escape: (s) => String(s) },
        fetch: async () => { throw new Error('la página no hace fetch'); }
    };
    sandbox.window = sandbox;
    const ctx = vm.createContext(sandbox);
    for (const file of ['public/shared/js/data/postgrest-client.js', 'public/shared/js/data/artists-repo.js', 'public/shared/js/store-model.js',
        'public/shared/js/store-watermark.js', 'public/shared/js/data/store-repo.js', JS_PATH]) {
        vm.runInContext(read(file), ctx, { filename: path.basename(file) });
    }
    const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setImmediate(r)); };
    const $ = (id) => document.getElementById(id);
    const page = {
        $, location, errors, runtime, settle,
        text: (id) => $(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        async start() { for (const fn of docListeners.DOMContentLoaded || []) await fn(); await settle(); },
        async go(search) { location.search = search; for (const fn of winListeners.popstate || []) await fn(); await settle(); },
        async key(key) { for (const fn of docListeners.keydown || []) await fn({ key, shiftKey: false, preventDefault() {}, stopPropagation() {} }); await settle(); },
        async submit(id) { for (const fn of $(id).listeners.submit || []) await fn({ preventDefault() {} }); await settle(); }
    };
    return page;
}

const sid = (n) => '0000c0de-0000-4000-8000-57' + String(n).padStart(10, '0');

test('ejecución: carga la Store del preview, el editor y los pedidos sin errores', async () => {
    const page = await bootPage();
    const { $ } = page;
    await page.start();
    assert.equal(page.location.navigations.length, 0, 'no redirige: hay sesión de artista');
    assert.equal($('ast-app').hidden, false, 'muestra la app');
    assert.equal($('ast-gate').hidden, true);
    assert.equal($('ast-loading').hidden, true);

    // Stats y listas con los fixtures (3 diseños, 3 merch, 6 pedidos).
    assert.equal($('ast-stat-payments').textContent, '1');
    assert.match($('ast-stat-payments-sub').textContent, /1 con pago informado/);
    assert.equal($('ast-stat-prepare').textContent, '1');
    assert.equal($('ast-stat-active').textContent, '5');
    assert.match($('ast-stat-sales').textContent, /USD|ARS/);
    assert.equal(($('ast-list-disenos').innerHTML.match(/class="ast-card"/g) || []).length, 3);
    assert.equal(($('ast-list-merch').innerHTML.match(/class="ast-card"/g) || []).length, 3);
    assert.match(page.text('ast-order-chips'), /Por confirmar pago 1 Por preparar 1 Enviados 2 Completados 1 Cancelados 1/);
    assert.match($('ast-list-disenos').innerHTML, /Vendido con licencia exclusiva el/);
    assert.match($('ast-list-disenos').innerHTML, /Reservado/);
    assert.match($('ast-public-link').getAttribute('href'), /^\/store\/\?artist=/);

    // Editor de un diseño: niveles, archivos privados, imágenes y checklist.
    await page.go('?editar=' + sid(101));
    assert.equal($('ast-editor').hidden, false);
    assert.equal($('ast-ed-title').textContent, 'Editar diseño');
    assert.match($('ast-ed-tiers').innerHTML, /Licencia Personal[\s\S]*Licencia Artista[\s\S]*Licencia Exclusiva/);
    assert.match($('ast-ed-files').innerHTML, /golondrina-original\.png/);
    assert.match($('ast-ed-images').innerHTML, /class="ast-img"/);
    assert.match(page.text('ast-ed-checklist'), /Archivo original subido · listo/);
    await page.key('Escape');
    assert.equal($('ast-editor').hidden, true, 'Escape cierra el editor');
    assert.doesNotMatch(page.location.search, /editar=/);

    // Nuevo diseño: sin título no guarda; con título crea el borrador.
    await page.go('?nuevo=diseno');
    $('ast-ed-f-title').value = '';
    await page.submit('ast-ed-form');
    assert.match($('ast-ed-f-title-err').textContent, /entre 2 y 120/);
    $('ast-ed-f-title').value = 'Rosa fine line';
    await page.submit('ast-ed-form');
    assert.match(page.location.search, /editar=/, 'el borrador ya tiene id');
    assert.ok(page.runtime.getStore().rows('store_products').some((p) => p.title === 'Rosa fine line' && p.status === 'draft'));
    await page.key('Escape');

    // Pedido con envío por preparar: pasos de envío y reembolso.
    await page.go('?pedido=' + sid(402));
    assert.equal($('ast-order').hidden, false);
    assert.match($('ast-or-body').innerHTML, /data-or-act="fulfillment"/);
    assert.match($('ast-or-body').innerHTML, /class="ast-stepper"/);
    assert.match($('ast-or-body').innerHTML, /Calle de ejemplo 1234/);
    await page.key('Escape');

    // Pago informado → diálogo «Confirmar pago recibido» → licencia emitida.
    await page.go('?pedido=' + sid(401) + '&modal=confirmar-pago');
    assert.equal($('ast-dlg-payment').hidden, false);
    assert.equal($('ast-pay-reference').value, 'Transferencia · comprobante 0001234');
    await page.submit('ast-pay-form');
    const order = page.runtime.getStore().rows('store_orders').find((o) => o.id === sid(401));
    assert.equal(order.status, 'fulfilled');
    assert.equal(order.payment_collected_by, 'seller');
    assert.match($('ast-or-tags').innerHTML, /Completado/);
    assert.doesNotMatch(page.location.search, /modal=/);
    await page.key('Escape');

    // Ajustes con la declaración de autoría.
    $('ast-set-contact').value = 'WhatsApp de prueba';
    $('ast-set-payment').value = 'Alias de prueba';
    $('ast-set-authorship').checked = true;
    await page.submit('ast-settings-form');
    const settings = page.runtime.getStore().rows('store_seller_settings').find((s) => s.contact_channel === 'WhatsApp de prueba');
    assert.ok(settings && settings.authorship_attested_at, 'guarda los ajustes con autoría');

    assert.deepEqual(page.errors, [], 'sin errores en consola');
});
