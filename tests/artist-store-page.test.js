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
        '/shared/js/data/store-repo.js',
        '/shared/js/artist-store.js',
        '/shared/js/wo-artist-menu.js'
    ].map((needle) => indexOfOrFail(body, needle, 'body'));
    assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'orden de los scripts del body');
    assert.match(body, /<script src="\/shared\/js\/wo-artist-menu\.js" defer><\/script>/);
});

test('HEIC a demanda: la página no carga heic2any ni heic-converter.js al abrir (los inyecta artist-store.js)', () => {
    // heic2any arma un worker blob: apenas carga y el CSP del preview lo bloquea.
    const scripts = html.match(/<script\b[^>]*>/g) || [];
    assert.deepEqual(scripts.filter((s) => /heic/i.test(s)), [], 'ningún <script> de HEIC en el HTML');
    // Mismos dos scripts, en orden y con heic2any pineado, pero desde el JS.
    const list = js.match(/const HEIC_SCRIPTS = \[([\s\S]*?)\];/);
    assert.ok(list, 'HEIC_SCRIPTS');
    assert.deepEqual(list[1].match(/'[^']+'/g), ["'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js'", "'/shared/js/heic-converter.js'"]);
    assert.match(js, /function isHeicFile\(file\)[\s\S]*?\\\.\(heic\|heif\)\$/, 'detecta HEIC/HEIF por extensión');
    assert.match(js, /image\/heic' \|\| type === 'image\/heif'/, 'y por MIME');
    assert.match(js, /isHeicFile\(file\) \? await loadHeicSupport\(\) : null/, 'solo se carga con un HEIC/HEIF');
    assert.match(js, /loadScriptOnce\(appPath\(src\)\)/, 'respeta WEOTZI_BASE_PATH');
    assert.equal((jsNoComments.match(/createElement\('script'\)/g) || []).length, 1, 'un solo punto que inyecta scripts');
    // El input sigue aceptando HEIC/HEIF.
    assert.match(html, /id="ast-ed-images-input" accept="[^"]*image\/heic,image\/heif,\.heic,\.heif/);
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

test('HTML y JS: las grillas de productos no son aria-live; el contador de pedidos solo se reescribe si cambia', () => {
    for (const id of ['ast-list-disenos', 'ast-list-merch']) {
        const grid = html.match(new RegExp('<div[^>]*id="' + id + '"[^>]*>'));
        assert.ok(grid, id);
        assert.doesNotMatch(grid[0], /aria-live/, id + ' se repinta entera: el resultado de cada acción se anuncia por las regiones vivas');
    }
    assert.match(html, /id="ast-order-count" aria-live="polite"/);
    assert.doesNotMatch(jsNoComments, /setText\('ast-order-count'/, 'el contador usa setLiveText');
    assert.match(js, /function setLiveText\(id, text\)[\s\S]*?el\.textContent !== next/);
});

test('avisos accesibles: regiones vivas persistentes (status y alert) y toast solo visual, como store-shell.js', () => {
    const status = html.match(/<div[^>]*id="ast-live-status"[^>]*>/);
    const alert = html.match(/<div[^>]*id="ast-live-alert"[^>]*>/);
    assert.ok(status && alert, 'las dos regiones están en el HTML desde la carga');
    for (const [tag, role, live] of [[status[0], 'status', 'polite'], [alert[0], 'alert', 'assertive']]) {
        assert.match(tag, /class="wo-sr-only"/, 'solo para lectores de pantalla');
        assert.match(tag, new RegExp('role="' + role + '"'));
        assert.match(tag, new RegExp('aria-live="' + live + '"'));
        assert.match(tag, /aria-atomic="true"/);
        assert.doesNotMatch(tag, /\bhidden\b/, 'nunca ocultas');
    }
    const toast = html.match(/<div[^>]*id="ast-toast"[^>]*>/)[0];
    assert.match(toast, /aria-hidden="true"/, 'el toast es visual');
    assert.doesNotMatch(toast, /role=|aria-live/, 'el toast no es región viva');
    // JS: announce vacía la región y escribe después (se anuncia aunque se repita).
    assert.match(js, /function announce\(message, tone\)[\s\S]*?\$\(tone === 'error' \? 'ast-live-alert' : 'ast-live-status'\)[\s\S]*?region\.textContent = '';[\s\S]*?setTimeout\(\(\) => \{ region\.textContent = text; \}, ANNOUNCE_DELAY_MS\)/);
    assert.match(js, /function notify\(message, tone = 'info'\)[\s\S]*?announce\(message, kind\);[\s\S]*?toast\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(js, /kind === 'error' \? TOAST_ERROR_MS : TOAST_MS/);
    const ms = (name) => Number(js.match(new RegExp('const ' + name + ' = (\\d+);'))[1]);
    assert.ok(ms('TOAST_ERROR_MS') > ms('TOAST_MS'), 'los errores duran más');
    assert.doesNotMatch(jsNoComments, /'ast-live-(status|alert)'\)\.hidden|region\.hidden/, 'el JS nunca oculta las regiones');
});

test('imágenes: las miniaturas de las cards van con alt vacío y una imagen nueva arranca sin descripción', () => {
    assert.match(js, /function productMedia\(product\)[\s\S]*?'" alt="" loading="lazy">'/);
    assert.doesNotMatch(js, /image\.alt \|\| product\.title/, 'la card no repite el título como alt');
    assert.match(js, /ed\.images\.concat\(\{ path: upload\.path, alt: '' \}\)/, 'alt por defecto vacío');
    assert.doesNotMatch(js, /alt: title \?/);
});

test('editor de merch: los 249 países de WeotziStoreModel, con buscador y los más elegidos primero', () => {
    assert.doesNotMatch(js, /const COUNTRIES = \[|COUNTRY_NAMES/, 'sin la lista fija de 22 países');
    assert.match(js, /M\.COUNTRY_CODES/);
    assert.match(js, /M\.countryName\(code\)/);
    const common = js.match(/const COMMON_COUNTRIES = \[([\s\S]*?)\];/)[1].match(/'([A-Z]{2})'/g).map((s) => s.slice(1, 3));
    for (const code of ['AR', 'MX', 'CL', 'UY', 'BR', 'ES', 'US']) assert.ok(common.includes(code), code + ' entre los más elegidos');
    const M = require('../public/shared/js/store-model.js');
    assert.deepEqual(common.filter((c) => !M.COUNTRY_CODES.includes(c)), [], 'todos son códigos ISO de la lista');
    // Buscador con label y región viva propia; la lista está agrupada con <fieldset>/<legend>.
    assert.match(html, /<label class="wo-label" for="ast-ed-countries-search">Buscar país<\/label>/);
    assert.match(html, /<input type="search"[^>]*id="ast-ed-countries-search"[^>]*aria-controls="ast-ed-countries"[^>]*aria-describedby="ast-ed-countries-count"/);
    assert.match(html, /id="ast-ed-countries-count" aria-live="polite"/);
    assert.match(html, /id="ast-ed-countries-clear" hidden>Desmarcar todos<\/button>/);
    assert.match(js, /'<fieldset class="ast-country-group"[\s\S]*?'<legend class="ast-country-group-title">'/);
    // Lo marcado vive en el estado (una búsqueda no lo pierde) y el buscador no ensucia el editor.
    assert.match(js, /form\.ships_to_countries = shipOn \? ed\.countries\.slice\(\) : \[\]/);
    assert.match(js, /matches\('input\[type="file"\], #ast-ed-countries-search'\)\) return;/);
    assert.match(cssNoComments, /\.ast-countries\{[^}]*overflow-y:auto/, 'la lista larga scrollea dentro del editor');
});

test('pedido vencido: copy sin prometer cierre automático y «No recibí el pago» con pago informado', () => {
    assert.ok(js.includes('Venció el plazo de pago y no hay pago informado. Si no vas a recibirlo, cancelá el pedido.'));
    assert.doesNotMatch(js, /se va a cerrar solo/);
    assert.match(js, /action\.reason === 'payment_not_received'/);
    assert.match(js, /title: 'No recibí el pago'/);
    assert.match(js, /\(action\.reason \? ' data-reason="' \+ esc\(action\.reason\) \+ '"' : ''\)/);
    // ?modal=confirmar-pago no abre el diálogo si el modelo no ofrece confirmar.
    assert.match(js, /function openPaymentDialog\(order\)[\s\S]*?\.some\(\(a\) => a\.key === 'confirm_payment'\)/);
});

test('checklist: «Dirección de retiro en Ajustes» para merch con retiro, con su ayuda y link al campo', () => {
    assert.match(js, /draft\.pickup_available = \$\('ast-ed-pickup-on'\)\.checked === true/);
    assert.match(js, /const SETTINGS_FIELDS = \{[\s\S]*?pickup_address: 'ast-set-pickup'[\s\S]*?\};/);
    assert.match(js, /data-goto="ajustes" data-field="'/);
    assert.match(js, /item\.hint \? '<p class="ast-check-hint">'/);
    assert.match(js, /gotoSettingsFromEditor\(goto\.dataset\.field\)/);
    assert.match(html, /id="ast-set-pickup-help">[^<]*Es obligatoria para publicar productos con retiro\./);
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
    // Timers registrados: no corren solos (page.runTimers los dispara).
    const timers = [];
    // <script> inyectados en <head>. page.onScript decide si cargan o fallan;
    // por defecto cargan y heic-converter.js define convertIfHEIC.
    const injected = [];
    let sandbox = null;
    const page = {};
    page.onScript = (el) => {
        setImmediate(() => {
            if (/heic-converter\.js$/.test(el.src)) sandbox.convertIfHEIC = page.fakeConvert;
            if (el.onload) el.onload();
        });
    };
    page.fakeConvert = async (file) => file;
    const document = {
        getElementById(id) { if (!elements.has(id)) elements.set(id, stubElement(id)); return elements.get(id); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
        createElement(tag) { const el = stubElement(''); el.tagName = String(tag).toUpperCase(); return el; },
        head: { appendChild(el) { injected.push(el); page.onScript(el); return el; } },
        body: stubElement('body'),
        activeElement: null
    };
    class HTMLElement { static [Symbol.hasInstance](value) { return !!value && typeof value === 'object'; } }
    sandbox = {
        WEOTZI_PREVIEW: true, location, document, HTMLElement, URL, URLSearchParams, Blob, Uint8Array,
        console: { log() {}, info() {}, warn() {}, error(...args) { errors.push(args.map(String).join(' ')); } },
        setTimeout: (fn, ms) => { timers.push({ fn, ms: Number(ms) || 0, done: false }); return timers.length; },
        clearTimeout: (id) => { const t = timers[id - 1]; if (t) t.done = true; },
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
    Object.assign(page, {
        $, location, errors, runtime, settle, win: sandbox, timers, injected,
        text: (id) => $(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        async start() { for (const fn of docListeners.DOMContentLoaded || []) await fn(); await settle(); },
        async go(search) { location.search = search; for (const fn of winListeners.popstate || []) await fn(); await settle(); },
        async key(key, target) { for (const fn of docListeners.keydown || []) await fn({ key, target, shiftKey: false, preventDefault() {}, stopPropagation() {} }); await settle(); },
        async submit(id) { for (const fn of $(id).listeners.submit || []) await fn({ preventDefault() {} }); await settle(); },
        async click(id, event) { for (const fn of $(id).listeners.click || []) await fn(event); await settle(); },
        async fire(id, type, event) { for (const fn of $(id).listeners[type] || []) await fn(event || {}); await settle(); },
        // Dispara los timers pendientes de hasta maxMs (los anuncios usan 50 ms).
        runTimers(maxMs) { timers.filter((t) => !t.done && t.ms <= maxMs).forEach((t) => { t.done = true; t.fn(); }); }
    });
    return page;
}

// Evento de formulario cuyo target coincide con un selector exacto.
function formEvent(selector, props) {
    return { target: Object.assign({ matches: (s) => s === selector, closest: () => null }, props || {}) };
}

// Click en un elemento con data-* que el handler busca con closest(selector).
function closestEvent(selector, dataset) {
    const el = { dataset: dataset || {} };
    return { target: { closest: (s) => (s === selector ? el : null) } };
}

// Cuenta las escrituras de textContent de un stub (cada una se anuncia si es aria-live).
function countWrites(el) {
    let text = el.textContent;
    const counter = { writes: 0 };
    Object.defineProperty(el, 'textContent', {
        configurable: true,
        get: () => text,
        set: (value) => { counter.writes += 1; text = String(value); }
    });
    return counter;
}

// Click en un botón de imagen del editor ([data-img-act]) sin DOM real.
function imageAction(act, index) {
    const button = { dataset: { imgAct: act, index: String(index) } };
    return { target: { closest: (selector) => (selector === '[data-img-act]' ? button : null) } };
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

test('ejecución: «Ventas del mes» pide el reporte desde el 1 del mes local y sin tope', async () => {
    const page = await bootPage();
    const Store = page.win.WeotziData.Store;
    const calls = [];
    const original = Store.getSalesReport;
    Store.getSalesReport = function (...args) { calls.push(args); return original.apply(this, args); };
    await page.start();
    assert.equal(calls.length, 1, 'un pedido de reporte al cargar');
    const [sellerType, , from, to] = calls[0];
    assert.equal(sellerType, 'artist');
    const now = new Date();
    assert.equal(Object.prototype.toString.call(from), '[object Date]');
    assert.deepEqual([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes()],
        [now.getFullYear(), now.getMonth(), 1, 0, 0], 'desde la medianoche local del 1');
    // Con tope, la RPC corta el día en medianoche UTC y deja afuera la noche local.
    assert.equal(to, null, 'el mes en curso va sin p_to');
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

test('ejecución: quitar una imagen que un pedido usa de miniatura no borra el objeto', async () => {
    const page = await bootPage();
    const { $ } = page;
    await page.start();
    const Store = page.win.WeotziData.Store;
    const removed = [];
    Store.removePreviewImage = async (p) => { removed.push(p); return true; };
    const orderCount = countWrites($('ast-order-count'));
    const stats = countWrites($('ast-stat-sales'));
    const countText = $('ast-order-count').textContent;
    assert.match(countText, /pedido/, 'el contador arranca con texto');

    // Remera Golondrina: la portada es la miniatura del pedido O2. Se le suma una
    // vista sin pedidos para poder quitar dos y que siga publicada.
    const FRONT = 'demo/store/remera-golondrina.svg';
    const BACK = 'demo/store/remera-golondrina-espalda.svg';
    const row = () => page.runtime.getStore().rows('store_products').find((p) => p.id === sid(104));
    row().images.push({ path: 'demo/store/remera-golondrina-detalle.svg', alt: 'Detalle del estampado' });
    assert.ok(page.runtime.getStore().rows('store_order_items').some((i) => i.image_path === FRONT), 'fixture: un pedido usa la portada');
    assert.ok(!page.runtime.getStore().rows('store_order_items').some((i) => i.image_path === BACK), 'fixture: ningún pedido usa la espalda');

    await page.go('?editar=' + sid(104));
    assert.equal($('ast-editor').hidden, false);

    // 1) La portada: se quita del producto, pero el objeto queda para el pedido.
    await page.click('ast-ed-form', imageAction('remove', 0));
    assert.equal($('ast-dlg-confirm').hidden, false, 'pide confirmación');
    await page.submit('ast-confirm-form');
    assert.deepEqual(row().images.map((i) => i.path), [BACK, 'demo/store/remera-golondrina-detalle.svg'], 'la portada sale del producto');
    assert.deepEqual(removed, [], 'no borra un objeto que usa un pedido');

    // 2) La espalda no está en ningún pedido: se borra.
    await page.click('ast-ed-form', imageAction('remove', 0));
    await page.submit('ast-confirm-form');
    assert.deepEqual(row().images.map((i) => i.path), ['demo/store/remera-golondrina-detalle.svg']);
    assert.deepEqual(removed, [BACK], 'borra el objeto sin pedidos');

    // Cada baja repinta todo (renderAll), pero el contador aria-live no cambió de texto.
    assert.ok(stats.writes >= 2, 'renderAll corrió después de cada baja');
    assert.equal(orderCount.writes, 0, 'el contador de pedidos no se reescribe con el mismo texto');
    assert.equal($('ast-order-count').textContent, countText);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

const orderRow = (page, id) => page.runtime.getStore().rows('store_orders').find((o) => o.id === id);
const productRow = (page, id) => page.runtime.getStore().rows('store_products').find((p) => p.id === id);

test('ejecución: los avisos se anuncian por las regiones vivas y el toast queda aria-hidden', async () => {
    const page = await bootPage();
    const { $ } = page;
    await page.start();
    const status = $('ast-live-status');
    const alert = $('ast-live-alert');

    // Éxito: guardar los ajustes.
    await page.submit('ast-settings-form');
    const toast = $('ast-toast');
    assert.equal(toast.hidden, false, 'el toast se ve');
    assert.equal(toast.getAttribute('aria-hidden'), 'true', 'el toast es solo visual');
    assert.equal(toast.getAttribute('role'), null);
    assert.equal(toast.getAttribute('aria-live'), null);
    assert.match(toast.className, /is-success/);
    const message = toast.textContent;
    assert.match(message, /Guardaste/);
    assert.equal(status.textContent, '', 'la región se vacía antes de escribir');
    page.runTimers(100);
    assert.equal(status.textContent, message, 'el texto llega a role=status');
    assert.equal(alert.textContent, '');

    // El mismo aviso otra vez: se vacía y se vuelve a escribir (se anuncia de nuevo).
    await page.submit('ast-settings-form');
    assert.equal(status.textContent, '');
    page.runTimers(100);
    assert.equal(status.textContent, message);
    const successTimer = page.timers.filter((t) => t.ms > 100).pop();

    // Error: un pedido que no existe → role=alert y más tiempo en pantalla.
    await page.go('?pedido=no-existe');
    assert.match(toast.className, /is-error/);
    page.runTimers(100);
    assert.match(alert.textContent, /No encontramos ese pedido/);
    const errorTimer = page.timers.filter((t) => t.ms > 100).pop();
    assert.equal(successTimer.ms, 4200);
    assert.equal(errorTimer.ms, 9000, 'el error dura más que el éxito');

    // Las regiones nunca se ocultan; el toast se oculta al vencer su timer.
    page.runTimers(10000);
    assert.equal(toast.hidden, true);
    assert.equal(status.hidden, false);
    assert.equal(alert.hidden, false);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

test('ejecución: miniaturas de cards con alt vacío', async () => {
    const page = await bootPage();
    const { $ } = page;
    await page.start();
    for (const id of ['ast-list-disenos', 'ast-list-merch']) {
        const imgs = $(id).innerHTML.match(/<img\b[^>]*>/g) || [];
        assert.ok(imgs.length > 0, id + ' tiene miniaturas');
        for (const img of imgs) assert.match(img, /\salt=""/, id + ': ' + img);
    }
    assert.deepEqual(page.errors, []);
});

test('ejecución: países de envío con los 249 códigos, grupos, buscador y lo marcado en el estado', async () => {
    const page = await bootPage();
    const { $ } = page;
    await page.start();
    const REMERA = sid(104); // ships_to_countries: ['AR', 'UY']
    await page.go('?editar=' + REMERA);
    assert.equal($('ast-editor').hidden, false);
    const box = () => $('ast-ed-countries').innerHTML;
    const codes = () => [...box().matchAll(/value="([A-Z]{2})" data-country/g)].map((m) => m[1]);
    assert.equal(codes().length, 249, 'todos los países');
    assert.ok(box().indexOf('data-group="common"') < box().indexOf('data-group="rest"'), 'los más elegidos primero');
    assert.match(box(), /<legend class="ast-country-group-title">Latinoamérica, España y Estados Unidos<\/legend>/);
    assert.match(box(), /<legend class="ast-country-group-title">Resto del mundo<\/legend>/);
    const common = box().slice(0, box().indexOf('data-group="rest"'));
    for (const name of ['Argentina', 'México', 'España', 'Estados Unidos']) assert.ok(common.includes('<span>' + name + '</span>'), name + ' en el primer grupo');
    assert.ok(!common.includes('Japón'), 'Japón va en el resto');
    assert.match(box(), /<span>Japón<\/span>/);
    assert.match(box(), /value="AR" data-country checked/);
    assert.match(box(), /value="UY" data-country checked/);
    assert.doesNotMatch(box(), /value="JP" data-country checked/);
    assert.equal($('ast-ed-countries-summary').textContent, 'Marcaste 2 países: Argentina, Uruguay.');
    assert.equal($('ast-ed-countries-clear').hidden, false);

    // Buscar sin tildes; el conteo va a la región viva del buscador.
    const search = $('ast-ed-countries-search');
    search.value = 'japon';
    await page.fire('ast-ed-countries-search', 'input');
    assert.deepEqual(codes(), ['JP']);
    assert.equal($('ast-ed-countries-count').textContent, '1 país coincide con «japon».');
    search.value = 'zzzz';
    await page.fire('ast-ed-countries-search', 'input');
    assert.deepEqual(codes(), []);
    assert.equal($('ast-ed-countries-count').textContent, 'Ningún país coincide con «zzzz».');

    // Escape con texto en el buscador lo vacía y no cierra el editor.
    await page.key('Escape', search);
    assert.equal(search.value, '');
    assert.equal(codes().length, 249);
    assert.equal($('ast-editor').hidden, false, 'el editor sigue abierto');
    // Buscar no ensucia el editor: Escape lo cierra sin pedir confirmación.
    await page.key('Escape');
    assert.equal($('ast-editor').hidden, true, 'cerró sin «Tenés cambios sin guardar»');

    // Marcar Japón filtrando, limpiar la búsqueda y guardar.
    await page.go('?editar=' + REMERA);
    search.value = 'jap';
    await page.fire('ast-ed-countries-search', 'input');
    await page.fire('ast-ed-form', 'change', formEvent('[data-country]', { value: 'JP', checked: true }));
    assert.equal($('ast-ed-countries-summary').textContent, 'Marcaste 3 países: Argentina, Uruguay, Japón.');
    search.value = '';
    await page.fire('ast-ed-countries-search', 'input');
    assert.match(box(), /value="JP" data-country checked/, 'lo marcado sobrevive a la búsqueda');
    assert.match(box(), /value="AR" data-country checked/);
    await page.submit('ast-ed-form');
    assert.deepEqual(productRow(page, REMERA).ships_to_countries.slice().sort(), ['AR', 'JP', 'UY']);

    // Desmarcar todos = envía a cualquier país.
    await page.click('ast-ed-countries-clear');
    assert.equal($('ast-ed-countries-summary').textContent, 'Sin países marcados: enviás a cualquier país.');
    assert.equal($('ast-ed-countries-clear').hidden, true);
    assert.doesNotMatch(box(), /data-country checked/);
    await page.submit('ast-ed-form');
    assert.deepEqual(productRow(page, REMERA).ships_to_countries, []);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

test('ejecución: pedido vencido sin pago informado → cancelar, sin confirmar ni prometer cierre automático', async () => {
    const page = await bootPage();
    const { $ } = page;
    const O1 = sid(401);
    Object.assign(orderRow(page, O1), { buyer_payment_reported_at: null, buyer_payment_reference: null, expires_at: new Date(Date.now() - 3600e3).toISOString() });
    await page.start();
    await page.go('?pedido=' + O1);
    const body = $('ast-or-body').innerHTML;
    assert.ok(body.includes('Venció el plazo de pago y no hay pago informado. Si no vas a recibirlo, cancelá el pedido.'));
    assert.doesNotMatch(body, /se va a cerrar solo/);
    assert.doesNotMatch(body, /data-or-act="confirm_payment"/, 'la RPC ya no acepta confirmarlo');
    assert.match(body, /data-or-act="cancel">Cancelar pedido</);
    assert.doesNotMatch(body, /No recibí el pago/);
    await page.key('Escape');

    // ?modal=confirmar-pago no abre el diálogo y avisa por qué.
    $('ast-dlg-payment').hidden = true;
    await page.go('?pedido=' + O1 + '&modal=confirmar-pago');
    assert.equal($('ast-dlg-payment').hidden, true, 'no abre el diálogo de pago');
    assert.doesNotMatch(page.location.search, /modal=/);
    page.runTimers(100);
    assert.match($('ast-live-status').textContent, /ya no se puede confirmar/);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

test('ejecución: pago informado y plazo vencido → «No recibí el pago» cancela el pedido', async () => {
    const page = await bootPage();
    const { $ } = page;
    const O1 = sid(401);
    orderRow(page, O1).expires_at = new Date(Date.now() - 3600e3).toISOString();
    await page.start();
    await page.go('?pedido=' + O1);
    const body = $('ast-or-body').innerHTML;
    assert.match(body, /Si no llegó, usá «No recibí el pago»\./);
    assert.match(body, /data-or-act="confirm_payment"/, 'si llegó, todavía lo puede confirmar');
    assert.match(body, /data-or-act="cancel" data-reason="payment_not_received">No recibí el pago<\/button>/);

    await page.click('ast-or-body', closestEvent('[data-or-act]', { orAct: 'cancel', reason: 'payment_not_received' }));
    assert.equal($('ast-dlg-confirm').hidden, false, 'pide confirmación');
    assert.equal($('ast-confirm-title').textContent, 'No recibí el pago');
    assert.match($('ast-confirm-message').textContent, /venció el plazo/);
    assert.equal($('ast-confirm-input').value, 'No recibí el pago.');
    await page.submit('ast-confirm-form');
    const order = orderRow(page, O1);
    assert.equal(order.status, 'cancelled');
    assert.equal(order.cancel_reason, 'No recibí el pago.');
    page.runTimers(100);
    assert.match($('ast-live-status').textContent, /Cancelaste el pedido #ST-5E2A91C0/);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

test('ejecución: heic2any y heic-converter.js se inyectan recién con el primer HEIC/HEIF', async () => {
    const page = await bootPage();
    await page.start();
    assert.deepEqual(page.injected, [], 'nada de HEIC al abrir la página');
    const Store = page.win.WeotziData.Store;
    const Watermark = page.win.WeotziStoreWatermark;
    const renders = [];
    Watermark.renderPlain = async (file, opts) => {
        renders.push({ name: file.name, opts: opts || {} });
        return { blob: new Blob(['x'], { type: 'image/webp' }), ext: 'webp', contentType: 'image/webp' };
    };
    let n = 0;
    Store.uploadPreviewImage = async () => ({ path: 'demo/store/subida-' + (n += 1) + '.webp' });
    const REMERA = sid(104);
    await page.go('?editar=' + REMERA);
    const pick = (files) => page.fire('ast-ed-form', 'change', formEvent('#ast-ed-images-input', { files }));

    // Un JPG no carga nada.
    await pick([{ name: 'foto.jpg', type: 'image/jpeg', size: 2048 }]);
    assert.deepEqual(page.injected, []);
    assert.equal(renders.length, 1);
    assert.equal(renders[0].opts.convertHeic, undefined);

    // El primer HEIC (sin MIME, como en Chrome) inyecta los dos scripts en orden.
    await pick([{ name: 'IMG_0001.HEIC', type: '', size: 4096 }]);
    assert.deepEqual(page.injected.map((s) => s.src), ['https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js', '/shared/js/heic-converter.js']);
    assert.ok(page.injected.every((s) => s.tagName === 'SCRIPT' && s.async === false));
    assert.equal(renders.length, 2);
    assert.equal(renders[1].opts.convertHeic, page.fakeConvert, 'pasa convertIfHEIC a la marca de agua');

    // Un HEIF después no vuelve a inyectar.
    await pick([{ name: 'foto.heif', type: 'image/heif', size: 4096 }]);
    assert.equal(page.injected.length, 2);
    assert.equal(renders[2].opts.convertHeic, page.fakeConvert);

    // Las imágenes nuevas arrancan sin descripción (alt vacío).
    const images = productRow(page, REMERA).images;
    assert.deepEqual(images.slice(-3).map((i) => i.alt), ['', '', '']);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

test('ejecución: si heic2any no carga, la imagen sigue sin convertir y el próximo HEIC lo reintenta', async () => {
    const page = await bootPage();
    let fail = true;
    const load = page.onScript;
    page.onScript = (el) => {
        if (fail && /heic2any/.test(el.src)) { setImmediate(() => el.onerror && el.onerror()); return; }
        load(el);
    };
    await page.start();
    const renders = [];
    page.win.WeotziStoreWatermark.renderPlain = async (file, opts) => {
        renders.push(opts || {});
        return { blob: new Blob(['x'], { type: 'image/webp' }), ext: 'webp', contentType: 'image/webp' };
    };
    let n = 0;
    page.win.WeotziData.Store.uploadPreviewImage = async () => ({ path: 'demo/store/reintento-' + (n += 1) + '.webp' });
    await page.go('?editar=' + sid(104));
    const pick = (files) => page.fire('ast-ed-form', 'change', formEvent('#ast-ed-images-input', { files }));
    await pick([{ name: 'a.heic', type: 'image/heic', size: 4096 }]);
    assert.equal(renders.length, 1, 'la imagen se procesa igual');
    assert.equal(renders[0].convertHeic, undefined, 'sin conversión');
    assert.deepEqual(page.injected.map((s) => s.src), ['https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js'], 'no sigue con heic-converter.js');
    fail = false;
    await pick([{ name: 'b.heic', type: 'image/heic', size: 4096 }]);
    assert.equal(page.injected.length, 3, 'reintenta heic2any y carga heic-converter.js');
    assert.equal(renders[1].convertHeic, page.fakeConvert);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});

test('ejecución: merch con retiro sin dirección → el checklist la pide y lleva al campo de Ajustes', async () => {
    const page = await bootPage();
    const { $ } = page;
    const mine = page.runtime.getStore().rows('store_seller_settings').find((s) => s.pickup_address);
    mine.pickup_address = null;
    await page.start();
    await page.go('?editar=' + sid(104)); // pickup_available: true
    const checklist = () => $('ast-ed-checklist').innerHTML;
    assert.match(page.text('ast-ed-checklist'), /Dirección de retiro en Ajustes · pendiente/);
    assert.match(checklist(), /<p class="ast-check-hint">Ofrecés retiro en el estudio: cargá la dirección en Ajustes o desactivá el retiro\.<\/p>/);
    assert.match(checklist(), /data-goto="ajustes" data-field="pickup_address" aria-describedby="ast-ed-check-pickup_address">Ir a Ajustes →<\/button>/);
    assert.match(checklist(), /id="ast-ed-check-pickup_address"/);

    // Sin retiro, el ítem desaparece; con retiro, vuelve.
    $('ast-ed-pickup-on').checked = false;
    await page.fire('ast-ed-form', 'change', formEvent('#ast-ed-ship-on, #ast-ed-pickup-on'));
    assert.doesNotMatch(checklist(), /pickup_address/);
    $('ast-ed-pickup-on').checked = true;
    await page.fire('ast-ed-form', 'change', formEvent('#ast-ed-ship-on, #ast-ed-pickup-on'));
    assert.match(checklist(), /data-field="pickup_address"/);

    // «Ir a Ajustes →» (con cambios sin guardar pide confirmar) y enfoca la dirección de retiro.
    let focused = null;
    $('ast-set-pickup').focus = () => { focused = 'ast-set-pickup'; };
    await page.click('ast-ed-form', closestEvent('[data-goto="ajustes"]', { field: 'pickup_address' }));
    assert.equal($('ast-confirm-title').textContent, 'Tenés cambios sin guardar');
    await page.submit('ast-confirm-form');
    assert.equal($('ast-editor').hidden, true);
    assert.equal($('ast-panel-ajustes').hidden, false, 'abre la pestaña Ajustes');
    assert.equal(focused, 'ast-set-pickup');

    // Un diseño no pide dirección de retiro.
    await page.go('?editar=' + sid(101));
    assert.doesNotMatch(checklist(), /pickup_address/);
    assert.deepEqual(page.errors, [], 'sin errores en consola');
});
