// Contrato de las páginas del comprador de la Store (docs/plans/2026-10-30-store-artista.md
// §8.3 y §8.4): /store/checkout/, /store/purchases/ y /store/license/, su CSS
// (store-buyer.css, .stb-*) y el returnTo de client-auth.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const PAGES = {
    checkout: { html: 'public/store/checkout/index.html', js: 'public/shared/js/store-checkout.js' },
    purchases: { html: 'public/store/purchases/index.html', js: 'public/shared/js/store-purchases.js' },
    license: { html: 'public/store/license/index.html', js: 'public/shared/js/store-license.js' }
};
const CSS_PATH = 'public/shared/css/store-buyer.css';

function scriptSrcs(html) {
    return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((m) => m[1]);
}
function firstScriptTag(html) {
    const m = html.match(/<script\b[^>]*>/);
    return m ? m[0] : '';
}
function stripComments(js) {
    return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

/* ------------------------------------------------------------------ */
/* APIs reales de los módulos base                                     */
/* ------------------------------------------------------------------ */

const Model = require(path.join(root, 'public/shared/js/store-model.js'));
const Shell = require(path.join(root, 'public/shared/js/store-shell.js'));

function loadStoreRepo() {
    const window = { WeotziData: { run: async () => ({ data: null }), getClient: () => null } };
    vm.runInNewContext(read('public/shared/js/data/store-repo.js'), { window, console });
    return window.WeotziData.Store;
}
const Repo = loadStoreRepo();

/* ------------------------------------------------------------------ */
/* Páginas                                                             */
/* ------------------------------------------------------------------ */

const travelHtml = read('public/artist/travel/index.html');
const travelDemo = (travelHtml.match(/\/shared\/js\/wo-demo\.js\?v=[^"]+/) || [])[0];

for (const [name, page] of Object.entries(PAGES)) {
    const html = read(page.html);

    test(`${name}: wo-demo.js es el primer script, con el mismo ?v= que travel`, () => {
        assert.ok(travelDemo, 'travel carga wo-demo.js con ?v=');
        assert.match(firstScriptTag(html), new RegExp('src="' + travelDemo.replace(/[.?]/g, '\\$&') + '"'));
    });

    test(`${name}: no carga client-auth.js y trae los estilos del DS en orden`, () => {
        assert.doesNotMatch(html, /client-auth\.js/);
        const css = ['/shared/css/ds/tokens.css', '/shared/css/ds/components.css', '/shared/css/store-ds.css', '/shared/css/store-buyer.css'];
        let last = -1;
        for (const href of css) {
            const at = html.indexOf('href="' + href + '"');
            assert.ok(at > last, `${href} después del anterior`);
            last = at;
        }
        assert.match(html, /fonts\.googleapis\.com\/css2\?family=Archivo\+Black/);
        assert.match(html, /<script src="\/shared\/js\/wo-icons\.js" defer><\/script>/);
        assert.match(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/);
        assert.match(html, /<html lang="es">/);
        assert.match(html, /<body class="wo-app sts-page">/);
        assert.match(html, /<div id="store-topbar"><\/div>/);
        assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    });

    test(`${name}: scripts de datos y de página en el orden del contrato`, () => {
        const srcs = scriptSrcs(html);
        const order = ['/shared/js/config-manager.js', '/shared/js/data/postgrest-client.js', '/shared/js/data/artists-repo.js',
            '/shared/js/currency-utils.js', '/shared/js/store-model.js', '/shared/js/data/store-repo.js', '/shared/js/store-shell.js',
            '/' + page.js.replace(/^public\//, '')];
        let last = -1;
        for (const src of order) {
            const at = srcs.indexOf(src);
            assert.ok(at > last, `${src} en orden (encontrado en ${at})`);
            last = at;
        }
        assert.equal(srcs[srcs.length - 1], order[order.length - 1], 'el JS de la página va último');
    });

    test(`${name}: el JS monta la topbar, respeta el gate y solo usa la capa de datos`, () => {
        const js = read(page.js);
        assert.match(js, /S\.mountStoreTopbar\('store-topbar'/);
        assert.match(js, /S\.isStoreEnabled\(\)/);
        const code = stripComments(js);
        assert.doesNotMatch(code, /\/rest\/v1\//, 'sin PostgREST inline');
        assert.doesNotMatch(code, /_supabase/, 'sin _supabase disperso');
        assert.doesNotMatch(code, /\.from\(/, 'sin .from( (CRUD ad-hoc)');
        assert.doesNotMatch(code, /\.rpc\(/, 'las RPC van por WeotziData.Store');
        assert.doesNotMatch(code, /\bfetch\(/, 'sin fetch directo: el servidor lo llama el repo');
        assert.doesNotMatch(code, /localStorage/, 'nada de estado persistente en localStorage');
    });

    test(`${name}: solo llama métodos existentes de WeotziData.Store, WeotziStoreShell y WeotziStoreModel`, () => {
        const code = stripComments(read(page.js));
        const repoCalls = [...code.matchAll(/\bStore\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
        const shellCalls = [...code.matchAll(/\bS\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
        const modelCalls = [...code.matchAll(/\bM\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
        assert.ok(repoCalls.length && shellCalls.length && modelCalls.length);
        for (const n of new Set(repoCalls)) assert.equal(typeof Repo[n], 'function', `WeotziData.Store.${n}`);
        for (const n of new Set(shellCalls)) assert.ok(n in Shell, `WeotziStoreShell.${n}`);
        for (const n of new Set(modelCalls)) assert.ok(n in Model, `WeotziStoreModel.${n}`);
        // Propiedades anidadas que se leen del modelo.
        if (/M\.FILES\.PRINTABLE_MIME/.test(code)) assert.ok(Array.isArray(Model.FILES.PRINTABLE_MIME));
    });

    test(`${name}: copy sin signos de exclamación`, () => {
        const visible = html.replace(/<!DOCTYPE[^>]*>/i, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
        assert.doesNotMatch(visible, /[!¡]/);
        const strings = [...read(page.js).matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]).filter((s) => /\s/.test(s));
        for (const s of strings) assert.doesNotMatch(s, /[¡]|[a-záéíóúñ]!(\s|$)/i, s);
    });
}

test('checkout: ingreso inline con auth (no datos), links con returnTo y estado en sessionStorage', () => {
    const js = read(PAGES.checkout.js);
    const html = read(PAGES.checkout.html);
    assert.match(js, /S\.getClient\(\)/);
    assert.match(js, /\.auth\.signInWithPassword\(/);
    assert.match(js, /S\.loginLinks\(\)/);
    assert.match(js, /'wo_store_checkout'/);
    assert.match(js, /sessionStorage/);
    assert.match(html, /Ingresá para comprar/);
    assert.match(html, /Creá tu cuenta →/);
    assert.match(html, /¿Sos artista\? Ingresá →/);
    assert.match(html, /Confirmar pedido →/);
});

test('checkout: pedido con términos, idempotencia por combinación y pantalla de pedido creado', () => {
    const js = read(PAGES.checkout.js);
    assert.match(js, /Store\.getPublicProduct\(/);
    assert.match(js, /Store\.createOrder\(\{/);
    assert.match(js, /termsVersion: M\.TERMS_VERSION/);
    assert.match(js, /idempotencyKey: idempotencyKey\(combo\)/);
    assert.match(js, /M\.termsAcceptanceLabel\(/);
    assert.match(js, /condiciones de compra \(v' \+ version \+ '\)/, 'merch también acepta con la versión vigente');
    assert.match(js, /M\.validateShippingAddress\(/);
    assert.match(js, /M\.orderTotals\(/);
    assert.match(js, /M\.errorMessage\(/);
    assert.match(js, /'Pedido creado'/);
    assert.match(js, /Ver mis compras →/);
    assert.match(js, /Ya pagué →/);
    assert.match(js, /Store\.reportPayment\(/);
    assert.match(js, /TODO\(store-pagos\)/, 'TODO del checkout del proveedor, solo en código');
    assert.match(js, /payment_provider/);
});

test('purchases: lista, detalle por ?pedido=, descargas con la ventana abierta antes del await', () => {
    const js = read(PAGES.purchases.js);
    assert.match(js, /Store\.listMyPurchases\(/);
    assert.match(js, /M\.orderView\(order, \{ role: 'buyer' \}\)/);
    assert.match(js, /S\.param\('pedido'\)/);
    assert.match(js, /Store\.listLicenseAssets\(/);
    assert.match(js, /Store\.cancelOrder\(/);
    assert.match(js, /Store\.confirmReceived\(/);
    assert.match(js, /Store\.markLicenseUsed\(/);
    assert.match(js, /M\.licenseUrl\(/);
    assert.match(js, /Todavía no compraste nada\./);
    assert.match(js, /Explorá artistas →/);
    assert.match(js, /¿Problemas con tu pedido\?/);
    assert.match(js, /a soporte →/);
    assert.match(js, /rel="noopener noreferrer"/);
    for (const fn of ['onDownload', 'onPrintScale']) {
        const start = js.indexOf('function ' + fn + '(');
        assert.ok(start !== -1, fn);
        const body = js.slice(start, js.indexOf('\n    }\n', start));
        const open = body.indexOf("window.open('', '_blank')");
        const opener = body.indexOf('popup.opener = null');
        const url = body.indexOf('Store.getDownloadUrl(');
        assert.ok(open !== -1 && opener > open && url > opener, fn + ': open → opener = null → getDownloadUrl');
    }
    assert.match(js, /M\.FILES\.PRINTABLE_MIME/);
    assert.match(js, /design_width_cm/);
    assert.match(js, /'cm'/);
});

test('license: certificado con requireSession y verificación pública con VERIFY_PARAM (nunca ?code=)', () => {
    const js = read(PAGES.license.js);
    const html = read(PAGES.license.html);
    assert.match(js, /S\.requireSession\(/);
    assert.match(js, /Store\.getLicense\(/);
    assert.match(js, /Store\.verifyLicense\(/);
    assert.match(js, /M\.licenseView\(/);
    assert.match(js, /S\.param\(M\.VERIFY_PARAM\)/);
    assert.match(js, /window\.print\(\)/);
    assert.doesNotMatch(stripComments(js), /[?&]code=|param\('code'\)/);
    assert.match(html, /name="verificar"/);
    assert.doesNotMatch(html, /name="code"/);
    assert.equal(Model.VERIFY_PARAM, 'verificar');
    assert.match(html, /class="stb-state stb-printable" id="stb-cert"/);
});

/* ------------------------------------------------------------------ */
/* CSS                                                                 */
/* ------------------------------------------------------------------ */

test('store-buyer.css: solo tokens, prefijo .stb-, :not([hidden]) y sin modo oscuro', () => {
    const raw = read(CSS_PATH);
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos');
    assert.doesNotMatch(css, /rgba?\(|hsla?\(/, 'colores solo por token');
    assert.doesNotMatch(css, /prefers-color-scheme/, 'sin modo oscuro');
    assert.match(css, /:not\(\[hidden\]\)/);
    // Nunca .x[hidden]{display:…}: contradice el atributo (tests/hidden-overlays).
    for (const m of css.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g)) {
        if (!m[1].includes(':not([hidden])')) assert.doesNotMatch(m[2], /display\s*:/, m[1]);
    }
    for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
        assert.match(m[1].trim(), /^var\(--radius-(none|circle)\)$/, 'radius 0 (círculo solo para el radio)');
    }
    // Selectores propios: .stb-* (más .sts-page al imprimir).
    const selectors = [];
    css.replace(/(^|})\s*([^{}@]+)\{/g, (all, _b, sel) => { selectors.push(...sel.split(',').map((s) => s.trim()).filter(Boolean)); return all; });
    assert.ok(selectors.length > 20);
    for (const sel of selectors) {
        if (/^(from|to|\d+%)$/.test(sel)) continue;
        assert.match(sel, /^(\.stb-|\.wo-app a\.stb-|a\.stb-|\.sts-page$)/, sel);
    }
    assert.match(raw, /@media print/);
    assert.match(raw, /@page/);
});

/* ------------------------------------------------------------------ */
/* client-auth.js · returnTo                                           */
/* ------------------------------------------------------------------ */

function loadClientAuth(opts = {}) {
    const listeners = {};
    const window = {
        location: { pathname: opts.pathname || '/client/login', search: opts.search || '', hash: '', origin: 'https://beta.weotzi.com' }
    };
    if (opts.basePath) window.WEOTZI_BASE_PATH = opts.basePath;
    const context = {
        window,
        console,
        URLSearchParams,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); } },
        supabase: { createClient: () => ({ auth: {} }) }
    };
    vm.runInNewContext(read('public/shared/js/client-auth.js'), context);
    return { context, window, listeners };
}

test('client-auth: normalizeReturnTo acepta solo paths del mismo origen bajo /store/', () => {
    const { context } = loadClientAuth();
    const n = context.normalizeReturnTo;
    assert.equal(typeof n, 'function');
    assert.equal(n('/store/checkout/?item=1&license=personal'), '/store/checkout/?item=1&license=personal');
    assert.equal(n('/store/purchases/'), '/store/purchases/');
    assert.equal(n('  /store/license/?verificar=WOL-ABCD-1234  '), '/store/license/?verificar=WOL-ABCD-1234');
    assert.equal(n('/store'), '/store/');
    assert.equal(n('/store?artist=mara-ink.wo'), '/store/?artist=mara-ink.wo');
    assert.equal(n('/store/item/?id=1#galeria'), '/store/item/?id=1#galeria');
    for (const bad of [null, undefined, '', '   ', 'store/checkout/', 'https://evil.example/store/', 'http://beta.weotzi.com/store/',
        '//evil.example/store/', '/\\evil.example/store/', '\\\\evil.example', 'javascript:alert(1)', 'data:text/html,hola',
        '/client/dashboard', '/storefront', '/stores/x', '/store/../client/dashboard', '/store/./../x', '/store/%2e%2e/client',
        '/store/%2F%2Fevil', '/store/\nx', '/store/ x', '/artist/dashboard?next=/store/']) {
        assert.equal(n(bad), null, String(bad));
    }
    assert.equal(n('/store/' + 'a'.repeat(2100)), null, 'tope de largo');
    assert.equal(typeof context.window.ClientAuth.normalizeReturnTo, 'function');
});

test('client-auth: el base path se quita al leer y se aplica al redirigir', () => {
    const { context } = loadClientAuth({ basePath: '/beta', pathname: '/beta/client/login', search: '?returnTo=%2Fstore%2Fcheckout%2F%3Fitem%3D9' });
    assert.equal(context.normalizeReturnTo('/beta/store/purchases/'), '/store/purchases/');
    assert.equal(context.readReturnTo(), '/store/checkout/?item=9');
    assert.equal(context.postAuthDestination(), '/beta/store/checkout/?item=9');
    assert.equal(context.clientAppPath('/beta/store/x'), '/beta/store/x', 'idempotente');
});

test('client-auth: sin returnTo (o con uno inválido) se mantiene /client/dashboard', () => {
    assert.equal(loadClientAuth().context.postAuthDestination(), '/client/dashboard');
    assert.equal(loadClientAuth({ search: '?returnTo=https%3A%2F%2Fevil.example%2Fstore%2F' }).context.postAuthDestination(), '/client/dashboard');
    assert.equal(loadClientAuth({ search: '?returnTo=%2Fclient%2Fprofile' }).context.postAuthDestination(), '/client/dashboard');
    assert.equal(loadClientAuth({ search: '?returnTo=%2Fstore%2Fpurchases%2F' }).context.postAuthDestination(), '/store/purchases/');
});

test('client-auth: los links entre login y registro conservan ?returnTo=', () => {
    const { context, listeners } = loadClientAuth({ search: '?returnTo=%2Fstore%2Fcheckout%2F%3Fitem%3D1' });
    assert.equal(context.withReturnTo('/client/register', '/store/checkout/?item=1'), '/client/register?returnTo=%2Fstore%2Fcheckout%2F%3Fitem%3D1');
    assert.equal(context.withReturnTo('/client/login?x=1#top', '/store/'), '/client/login?x=1&returnTo=%2Fstore%2F#top');
    assert.equal(context.isClientAuthLink('/client/login'), true);
    assert.equal(context.isClientAuthLink('/client/register/'), true);
    assert.equal(context.isClientAuthLink('/client/dashboard'), false);
    assert.equal(context.isClientAuthLink('https://otro.example/client/login'), false);
    assert.ok((listeners.DOMContentLoaded || []).length >= 1);
    assert.ok((listeners.click || []).length >= 1, 'también los links insertados después');

    // Reescritura de hrefs y del CTA de éxito del registro.
    const attrs = (map) => ({ getAttribute: (k) => (k in map ? map[k] : null), setAttribute(k, v) { map[k] = v; } });
    const loginLink = { a: { href: '/client/login' } };
    const dashLink = { a: { href: '/client/dashboard' } };
    const textNode = { nodeType: 3, textContent: '\n  Ir a tu panel\n' };
    const cta = { a: { href: '/client/dashboard', 'data-ca-return-label': 'Volver a la Store' } };
    const doc = {
        querySelectorAll(sel) {
            if (sel === 'a[href]') return [Object.assign(attrs(loginLink.a)), Object.assign(attrs(dashLink.a))];
            if (sel === '[data-ca-return-link]') return [Object.assign(attrs(cta.a), { childNodes: [textNode] })];
            return [];
        }
    };
    context.propagateReturnTo(doc);
    assert.equal(loginLink.a.href, '/client/login?returnTo=%2Fstore%2Fcheckout%2F%3Fitem%3D1');
    assert.equal(dashLink.a.href, '/client/dashboard', 'el resto de los links no cambia');
    assert.equal(cta.a.href, '/store/checkout/?item=1');
    assert.equal(textNode.textContent.trim(), 'Volver a la Store');
});

test('client-auth: returnTo en el login, el signUp y Google; artistas aceptados', () => {
    const src = read('public/shared/js/client-auth.js');
    assert.match(src, /emailRedirectTo: window\.location\.origin \+ postAuthDestination\(\)/);
    assert.match(src, /withReturnTo\(clientAppPath\('\/client\/login'\), returnTo\)/, 'Google vuelve al login con returnTo');
    assert.match(src, /: window\.location\.origin \+ '\/client\/dashboard';/, 'Google sin returnTo, igual que antes');
    const login = src.slice(src.indexOf('async function handleClientLogin'), src.indexOf('async function handleGoogleLogin'));
    assert.doesNotMatch(login, /window\.location\.href = '\/client\/dashboard'/);
    assert.equal((login.match(/window\.location\.href = postAuthDestination\(\)/g) || []).length, 3);
    assert.match(login, /if \(!returnTo\) await ensureClientMode\(data\.session\)/, 'con returnTo el artista no cambia de modo');
    const register = read('public/client/register/index.html');
    assert.match(register, /data-ca-return-link data-ca-return-label="Volver a la Store"/);
});

test('client-auth: normalizeReturnTo coincide con el de WeotziStoreShell', () => {
    const { context } = loadClientAuth();
    for (const v of ['/store/checkout/?item=1', '/store', '/store/purchases/?pedido=2', '/client/dashboard', '//evil.example/store/',
        'https://evil.example/store/', '/store/../client', '/store/%2e%2e/client', 'javascript:alert(1)']) {
        assert.equal(context.normalizeReturnTo(v), Shell.normalizeReturnTo(v), v);
    }
    // loginLinks del shell manda paths que client-auth acepta tal cual.
    const links = Shell.loginLinks('/store/checkout/?item=1&license=artist');
    const rt = new URLSearchParams(links.client.split('?')[1]).get('returnTo');
    assert.equal(context.normalizeReturnTo(rt), '/store/checkout/?item=1&license=artist');
});

/* ------------------------------------------------------------------ */
/* Páginas corriendo con un DOM mínimo                                 */
/* ------------------------------------------------------------------ */

// DOM de juguete: los ids del HTML estático existen desde el arranque y cada
// innerHTML crea los ids que trae (con hidden/checked). querySelectorAll
// devuelve lo que el test cargue en `el.queryFn`.
function fakeDocument(staticHtml) {
    const byId = new Map();
    const doc = { readyState: 'complete', activeElement: null, title: '', listeners: {} };
    function makeEl(tag, id) {
        const attrs = {};
        const classes = new Set();
        let html = '';
        const el = {
            tagName: String(tag || 'div').toUpperCase(),
            hidden: false, textContent: '', value: '', disabled: false, checked: false,
            children: [], listeners: {}, adjacent: '', queryFn: null,
            classList: {
                add: (...c) => c.forEach((x) => classes.add(x)),
                remove: (...c) => c.forEach((x) => classes.delete(x)),
                toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; },
                contains: (c) => classes.has(c)
            },
            get className() { return [...classes].join(' '); },
            set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
            get id() { return attrs.id || ''; },
            set id(v) { attrs.id = String(v); byId.set(String(v), el); },
            get innerHTML() { return html; },
            set innerHTML(v) { html = String(v); registerIds(html); },
            setAttribute(k, v) { if (k === 'id') el.id = v; else attrs[k] = String(v); },
            getAttribute(k) { return k in attrs ? attrs[k] : null; },
            hasAttribute(k) { return k in attrs; },
            removeAttribute(k) { delete attrs[k]; },
            addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
            focus() { doc.activeElement = el; },
            appendChild(child) { el.children.push(child); return child; },
            insertBefore(child) { el.children.unshift(child); return child; },
            insertAdjacentHTML(_pos, more) { el.adjacent += more; registerIds(more); },
            querySelector(sel) { return (el.queryFn ? el.queryFn(sel) : [])[0] || null; },
            querySelectorAll(sel) { return el.queryFn ? el.queryFn(sel) : []; },
            matches: () => false,
            closest: () => null,
            getClientRects: () => [1]
        };
        if (id) el.id = id;
        return el;
    }
    function registerIds(markup) {
        for (const m of String(markup).matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
            const id = /\sid="([^"]+)"/.exec(m[2]);
            if (!id) continue;
            const el = makeEl(m[1], id[1]);
            el.hidden = /\shidden(?=[\s=>]|$)/.test(m[2]);
            el.checked = /\schecked(?=[\s=>]|$)/.test(m[2]);
        }
    }
    Object.assign(doc, {
        body: makeEl('body'),
        head: makeEl('head'),
        createElement: (tag) => makeEl(tag),
        getElementById: (id) => byId.get(id) || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); }
    });
    registerIds(staticHtml || '');
    return doc;
}

const flush = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Corre store-model, store-shell y el JS de la página en un contexto con el
// DOM de juguete. `shell` reemplaza las partes del shell que tocan red o sesión.
function runPage(name, opts = {}) {
    const html = name ? read(PAGES[name].html) : '<body></body>';
    const doc = fakeDocument(html.slice(html.indexOf('<body')));
    const storage = new Map();
    const delays = [];
    const window = {
        document: doc,
        location: Object.assign({ origin: 'https://beta.weotzi.com', pathname: '/store/' + (name || '') + '/', search: '', hash: '',
            reload() { window.reloaded = true; } }, opts.location || {}),
        history: { replaceState() {}, pushState() {} },
        sessionStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
        crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
        URL, URLSearchParams, console, clearTimeout,
        setTimeout: (fn, ms) => { delays.push(ms); const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
        addEventListener() {},
        open: () => null,
        WeotziData: { Store: opts.store || {} }
    };
    window.location.href = window.location.origin + window.location.pathname + window.location.search;
    window.window = window;
    const ctx = vm.createContext(window);
    vm.runInContext(read('public/shared/js/store-model.js'), ctx, { filename: 'store-model.js' });
    vm.runInContext(read('public/shared/js/store-shell.js'), ctx, { filename: 'store-shell.js' });
    const S = window.WeotziStoreShell;
    let current = opts.viewer || { role: 'anon', session: null, user: null, artist: null, artistReady: false };
    Object.assign(S, {
        mountStoreTopbar: () => Promise.resolve(current),
        isStoreEnabled: () => Promise.resolve(true),
        viewer: () => Promise.resolve(current),
        requireSession: () => Promise.resolve(current.session || null),
        setViewer: (v) => { current = v; }
    }, opts.shell || {});
    if (name) vm.runInContext(read(PAGES[name].js), ctx, { filename: PAGES[name].js });
    return { window, doc, S, delays };
}

const BUYER = { role: 'client', session: {}, user: { id: 'buyer-1', user_metadata: { full_name: 'Ana Pérez' } }, artist: null, artistReady: false };
const SELLER = { role: 'artist', session: {}, user: { id: 'seller-1' }, artist: { name: 'Mara Ink' }, artistReady: true };
const SUPPORT = { role: 'client', session: {}, user: { id: 'support-1' }, artist: null, artistReady: false };
const SELLER_INFO = { type: 'artist', id: 'seller-1', name: 'Mara Ink', handle: 'mara-ink.wo' };
const DESIGN = {
    id: 'p1', kind: 'design', status: 'active', title: 'Golondrina', currency: 'USD', licenses_issued: 0, exclusive_available: true,
    license_personal_price: 25, license_artist_price: 60, license_exclusive_price: 300,
    images: [{ path: 's/p1/1-0.webp', alt: 'Golondrina en línea fina' }]
};
const MERCH = {
    id: 'm1', kind: 'merch', status: 'active', title: 'Remera Ö', currency: 'ARS', price_amount: 18000, shipping_price_amount: 2000,
    ships_to_countries: [], pickup_available: false, images: [],
    variants: [{ id: 'v1', label: 'Talle M', price_amount: null, in_stock: true, active: true }]
};
const storeFor = (product, extra) => Object.assign({
    previewUrl: (p) => 'https://cdn.test/' + p,
    getPublicProduct: async () => ({ seller: SELLER_INFO, settings: {}, product })
}, extra || {});

test('shell: notify anuncia por regiones vivas fijas y el toast es solo visual', async () => {
    const { doc, S, delays } = runPage(null);
    const status = doc.getElementById('sts-live-status');
    const alert = doc.getElementById('sts-live-alert');
    assert.ok(status && alert, 'las regiones existen desde que carga el shell');
    assert.ok(doc.body.children.includes(status) && doc.body.children.includes(alert));
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(alert.getAttribute('role'), 'alert');
    assert.equal(alert.getAttribute('aria-live'), 'assertive');
    assert.match(status.className, /wo-sr-only/);
    assert.equal(status.hidden, false);

    const toast = S.notify('Pago informado. El vendedor lo va a confirmar.', 'success');
    assert.equal(toast.getAttribute('aria-hidden'), 'true');
    assert.equal(toast.getAttribute('role'), null, 'el toast no es región viva');
    assert.equal(status.textContent, '', 'se vacía antes de escribir');
    await wait(80);
    assert.equal(status.textContent, 'Pago informado. El vendedor lo va a confirmar.');
    assert.equal(status.hidden, false, 'la región nunca se oculta');

    const errorToast = S.notify('No pudimos cancelar el pedido.', 'error');
    await wait(80);
    assert.equal(alert.textContent, 'No pudimos cancelar el pedido.');
    assert.equal(errorToast.className, 'sts-toast is-error');
    assert.equal(errorToast.getAttribute('aria-hidden'), 'true');
    assert.ok(Math.max(...delays) >= 8000, 'los errores quedan más tiempo en pantalla');

    // Mismo texto dos veces: se vuelve a anunciar (vacía y escribe).
    S.announce('Sesión iniciada.');
    await wait(80);
    S.announce('Sesión iniciada.');
    assert.equal(status.textContent, '');
    await wait(80);
    assert.equal(status.textContent, 'Sesión iniciada.');
});

test('shell: previewImg con alt "" deja el placeholder fuera del lector', () => {
    const { S } = runPage(null);
    assert.match(S.previewImg('', { alt: '' }), /^<span class="sts-media-ph" aria-hidden="true">/);
    assert.match(S.previewImg('', { alt: 'Golondrina' }), /role="img" aria-label="Golondrina"/);
});

test('checkout: tras el ingreso inline el foco va al título del pedido; el total se anuncia; miniatura con alt ""', async () => {
    const page = runPage('checkout', {
        location: { pathname: '/store/checkout/', search: '?item=p1&license=personal' },
        store: storeFor(DESIGN),
        shell: {
            getClient: () => ({ auth: { signInWithPassword: async () => { page.S.setViewer(BUYER); return { data: {}, error: null }; } } })
        }
    });
    const { doc } = page;
    await flush();
    assert.equal(doc.getElementById('stb-auth').hidden, false, 'sin sesión: ingreso inline');
    assert.equal(doc.activeElement, null, 'la carga no mueve el foco');
    doc.getElementById('stb-login-email').value = 'ana@test.com';
    doc.getElementById('stb-login-password').value = 'secreta';
    doc.getElementById('stb-login-form').listeners.submit[0]({ preventDefault() {} });
    await flush();
    assert.equal(doc.getElementById('stb-checkout').hidden, false);
    assert.equal(doc.getElementById('stb-auth').hidden, true);
    assert.equal(doc.activeElement, doc.getElementById('stb-title'), 'el foco no queda en el body');
    assert.equal(doc.getElementById('stb-title').textContent, 'Confirmá tu compra');

    const live = doc.getElementById('stb-total-live');
    assert.equal(live.textContent, 'Licencia Personal. Total: USD 25.');
    const summary = doc.getElementById('stb-summary').innerHTML;
    assert.match(summary, /<img class="sts-img" src="https:\/\/cdn\.test\/s\/p1\/1-0\.webp" alt=""/, 'la miniatura no repite el título');
    assert.doesNotMatch(summary, /alt="Golondrina/);

    // Cambiar de nivel con los términos aceptados: aviso visible y anunciado.
    doc.getElementById('stb-terms-accept').checked = true;
    doc.getElementById('stb-fields').listeners.change[0]({ target: { name: 'tier', value: 'exclusive' } });
    const terms = doc.getElementById('stb-terms').innerHTML;
    assert.match(terms, /<p class="wo-help" id="stb-terms-notice">Cambiaste a la licencia Exclusiva: leé y aceptá sus términos\.<\/p>/);
    assert.match(terms, /aria-describedby="stb-terms-notice stb-terms-accept-error"/);
    assert.equal(doc.getElementById('stb-terms-accept').checked, false, 'los términos nuevos se aceptan de nuevo');
    assert.equal(live.textContent, 'Licencia Exclusiva. Total: USD 300.');
    await wait(80);
    assert.equal(doc.getElementById('sts-live-status').textContent, 'Cambiaste a la licencia Exclusiva: leé y aceptá sus términos.');
    // Al aceptarlos, el aviso se va.
    doc.getElementById('stb-terms-accept').checked = true;
    doc.getElementById('stb-fields').listeners.change[0]({ target: { name: 'terms', checked: true } });
    assert.equal(doc.getElementById('stb-terms-notice').hidden, true);

    // Sin términos aceptados antes, no hay aviso.
    doc.getElementById('stb-terms-accept').checked = false;
    doc.getElementById('stb-fields').listeners.change[0]({ target: { name: 'tier', value: 'personal' } });
    assert.doesNotMatch(doc.getElementById('stb-terms').innerHTML, /stb-terms-notice/);
});

test('checkout: los países salen del modelo (M.COUNTRY_CODES / M.countryName), sin lista local', async () => {
    const code = stripComments(read(PAGES.checkout.js));
    assert.doesNotMatch(code, /COUNTRY_CODES\s*=/, 'sin copia local de los 249 códigos');
    assert.doesNotMatch(code, /Intl\.DisplayNames/, 'los nombres los da M.countryName');
    assert.match(code, /M\.countryOptions\(/);
    assert.equal(Model.COUNTRY_CODES.length, 249, 'ISO 3166-1 alfa-2 completo en el modelo');

    const open = runPage('checkout', { location: { pathname: '/store/checkout/', search: '?item=m1&variant=v1&qty=1' }, store: storeFor(MERCH), viewer: BUYER });
    await flush();
    const fields = open.doc.getElementById('stb-fields').innerHTML;
    const values = [...fields.matchAll(/<option value="([A-Z]{2})">/g)].map((m) => m[1]);
    assert.equal(values.length, 249, 'sin restricción: los 249 del modelo');
    assert.deepEqual(values.slice().sort(), Model.COUNTRY_CODES.slice(), 'los mismos códigos que M.COUNTRY_CODES');
    for (const c of ['TR', 'SG', 'AR', 'MX']) {
        assert.match(fields, new RegExp('<option value="' + c + '">' + Model.countryName(c) + '</option>'), c + ' con el nombre de M.countryName');
    }
    assert.match(fields, /<option value="TR">Turquía<\/option>/);
    assert.match(fields, /<option value="SG">Singapur<\/option>/);
    assert.doesNotMatch(fields, /stb-country-help/, 'sin restricción no hay lista de países en la ayuda');
    assert.equal(open.doc.getElementById('stb-total-live').textContent, 'Total: ARS 20.000, con envío de ARS 2.000.');
    assert.match(open.doc.getElementById('stb-summary').innerHTML, /<span class="sts-media-ph" aria-hidden="true">/);

    // Con restricción: solo esos, sin repetidos (minúsculas incluidas) y ordenados por nombre.
    const closed = runPage('checkout', {
        location: { pathname: '/store/checkout/', search: '?item=m1&variant=v1&qty=1' },
        store: storeFor(Object.assign({}, MERCH, { ships_to_countries: ['pt', 'ES', 'ES'] })), viewer: BUYER
    });
    await flush();
    const only = closed.doc.getElementById('stb-fields').innerHTML;
    assert.deepEqual([...only.matchAll(/<option value="([A-Z]{2})">/g)].map((m) => m[1]), ['ES', 'PT']);
    assert.match(only, /<option value="">Elegí el país<\/option>/);
    assert.match(only, /El vendedor envía a: España, Portugal\./);

    // Un solo país: queda elegido y sin opción vacía.
    const single = runPage('checkout', {
        location: { pathname: '/store/checkout/', search: '?item=m1&variant=v1&qty=1' },
        store: storeFor(Object.assign({}, MERCH, { ships_to_countries: ['UY'] })), viewer: BUYER
    });
    await flush();
    assert.doesNotMatch(single.doc.getElementById('stb-fields').innerHTML, /Elegí el país/);
    assert.equal(single.doc.getElementById('stb-country').value, 'UY');
});

/* ---------------------------- pedidos vencidos ---------------------------- */

const HOUR = 3600000;
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
function pendingDesignOrder(extra) {
    return Object.assign({
        id: 'o7', order_number: 'ST-0000A007', status: 'pending_payment', fulfillment_method: 'digital', currency: 'USD', buyer_user_id: 'buyer-1',
        subtotal_amount: 25, shipping_amount: 0, total_amount: 25, created_at: isoIn(-30 * HOUR), expires_at: isoIn(-6 * HOUR),
        payment_provider: 'manual', expected_collector: 'seller', payment_instructions: 'Transferencia al alias mara.ink.pagos',
        seller_contact: 'Instagram @mara.ink',
        store_order_items: [{ id: 'i7', order_id: 'o7', product_id: 'p1', kind: 'design', title: 'Golondrina', license_tier: 'personal',
            unit_price: 25, quantity: 1, line_total: 25, image_path: null }],
        store_licenses: []
    }, extra || {});
}
async function checkoutDone(order) {
    const page = runPage('checkout', {
        location: { pathname: '/store/checkout/', search: '?pedido=' + order.id },
        viewer: BUYER,
        store: { getMyOrder: async () => order, reportPayment: async () => order }
    });
    await flush();
    return page;
}

test('purchases: un pedido vencido no ofrece «Ya pagué →», ni el form, ni instrucciones para pagar', async () => {
    // En plazo: instrucciones y form de «Ya pagué →».
    const live = await purchasesDetail(pendingDesignOrder({ expires_at: isoIn(20 * HOUR) }), DESIGN);
    const liveHtml = live.doc.getElementById('stb-detail').innerHTML;
    assert.match(liveHtml, /id="stb-report-form"/);
    assert.match(liveHtml, />Ya pagué →<\/button>/);
    assert.match(liveHtml, /Cómo pagar/);
    assert.match(liveHtml, /Tenés hasta el /);

    // Vencido sin pago informado: aviso, contacto y cancelar; nada para pagar ni informar.
    const overdue = await purchasesDetail(pendingDesignOrder(), DESIGN);
    const html = overdue.doc.getElementById('stb-detail').innerHTML;
    assert.match(html, /<h2 class="stb-block-title">Venció el plazo para pagar<\/h2>/);
    assert.match(html, /Venció el plazo para pagar este pedido\. Si ya pagaste, escribile al vendedor con el número de pedido\./);
    assert.doesNotMatch(html, /Ya pagué/);
    assert.doesNotMatch(html, /stb-report-form|stb-report-ref/);
    assert.doesNotMatch(html, /Cómo pagar|Pagá el monto exacto|mara\.ink\.pagos/, 'sin instrucciones para pagar un pedido vencido');
    assert.doesNotMatch(html, /Tenés hasta el /);
    assert.match(html, /Instagram @mara\.ink/, 'queda el contacto del vendedor');
    assert.match(html, /data-stb-action="cancel"/, 'sin pago informado se puede cancelar');
    assert.equal(overdue.doc.getElementById('stb-report-form'), null);

    // Vencido con pago informado: tampoco se actualiza el comprobante.
    const reported = await purchasesDetail(pendingDesignOrder({ buyer_payment_reported_at: isoIn(-26 * HOUR), buyer_payment_reference: 'TR-77' }), DESIGN);
    const repHtml = reported.doc.getElementById('stb-detail').innerHTML;
    assert.match(repHtml, /Informaste el pago, pero el vendedor no lo confirmó a tiempo\./);
    assert.doesNotMatch(repHtml, /Ya pagué|Actualizar comprobante|Actualizá el comprobante|stb-report-form/);
    assert.doesNotMatch(repHtml, /Cómo pagar/);
    assert.doesNotMatch(repHtml, /data-stb-action="cancel"/, 'con pago informado cancela soporte');
    assert.match(repHtml, /para cancelar el pedido, escribile a soporte/);
    const platform = await purchasesDetail(pendingDesignOrder({ expected_collector: 'platform', buyer_payment_reported_at: isoIn(-26 * HOUR) }), DESIGN);
    assert.match(platform.doc.getElementById('stb-detail').innerHTML, /Informaste el pago, pero We Ötzi no lo confirmó a tiempo\./);
});

test('purchases: la card del pedido vencido avisa el plazo y el detalle vencido explica por qué', async () => {
    const list = runPage('purchases', { location: { pathname: '/store/purchases/', search: '' }, viewer: BUYER,
        store: { listMyPurchases: async () => [pendingDesignOrder()] } });
    await flush();
    const cards = list.doc.getElementById('stb-orders').innerHTML;
    assert.match(cards, /<span class="stb-order-next">Venció el plazo para pagar<\/span>/);
    assert.doesNotMatch(cards, /Ya pagué|Pagalo antes/);

    const expired = await purchasesDetail(pendingDesignOrder({ status: 'expired' }), DESIGN);
    const html = expired.doc.getElementById('stb-detail').innerHTML;
    assert.match(html, /Este pedido venció porque no se informó el pago a tiempo\./);
    assert.doesNotMatch(html, /Ya pagué|stb-report-form|Cómo pagar/);

    const lapsed = await purchasesDetail(pendingDesignOrder({ status: 'expired', buyer_payment_reported_at: isoIn(-8 * 24 * HOUR) }), DESIGN);
    const lapsedHtml = lapsed.doc.getElementById('stb-detail').innerHTML;
    assert.match(lapsedHtml, /Este pedido venció porque nadie confirmó el pago a tiempo\. Si pagaste, escribile a soporte con el número de pedido\./);
    assert.doesNotMatch(lapsedHtml, /no se informó el pago/);
});

test('checkout ?pedido=: un pedido vencido no muestra «Ya pagué →» ni instrucciones; en plazo sí', async () => {
    const live = await checkoutDone(pendingDesignOrder({ expires_at: isoIn(20 * HOUR) }));
    const liveHtml = live.doc.getElementById('stb-done').innerHTML;
    assert.match(liveHtml, />Ya pagué →<\/button>/);
    assert.match(liveHtml, /Cómo pagar/);
    assert.match(liveHtml, /<p class="stb-deadline">Tenés hasta el /);
    assert.equal(live.doc.getElementById('stb-sub').hidden, false);

    const overdue = await checkoutDone(pendingDesignOrder());
    const html = overdue.doc.getElementById('stb-done').innerHTML;
    assert.match(html, /Venció el plazo para pagar este pedido\. Si ya pagaste, escribile al vendedor con el número de pedido\./);
    assert.doesNotMatch(html, /Ya pagué|stb-report-form|stb-report-ref/);
    assert.doesNotMatch(html, /Cómo pagar|Pagá el monto exacto|mara\.ink\.pagos/);
    assert.doesNotMatch(html, /stb-deadline|Tenés hasta el /, 'sin plazo vencido como si siguiera vigente');
    assert.match(html, /Instagram @mara\.ink/);
    assert.match(html, /Ver mis compras →/);
    assert.ok(html.indexOf('Venció el plazo') < html.indexOf('Contacto del vendedor'), 'el aviso va antes del contacto');
    assert.equal(overdue.doc.getElementById('stb-sub').hidden, true, 'sin «Pagalo con las instrucciones de abajo»');
    assert.equal(overdue.doc.getElementById('stb-report-form'), null);

    const reported = await checkoutDone(pendingDesignOrder({ buyer_payment_reported_at: isoIn(-26 * HOUR), buyer_payment_reference: 'TR-77' }));
    const repHtml = reported.doc.getElementById('stb-done').innerHTML;
    assert.match(repHtml, /Informaste el pago, pero el vendedor no lo confirmó a tiempo\./);
    assert.doesNotMatch(repHtml, /Ya pagué|queda reservado hasta|stb-report-form/);
});

/* ------------------------------ retiro y envío ------------------------------ */

function merchOrder(extra) {
    return Object.assign({
        id: 'o8', order_number: 'ST-0000A008', status: 'paid', fulfillment_method: 'pickup', fulfillment_status: 'preparing', currency: 'ARS',
        buyer_user_id: 'buyer-1', subtotal_amount: 18000, shipping_amount: 0, total_amount: 18000, created_at: isoIn(-48 * HOUR),
        paid_at: isoIn(-24 * HOUR), expires_at: isoIn(-24 * HOUR), payment_provider: 'manual', expected_collector: 'seller',
        seller_contact: 'Instagram @mara.ink', pickup_details: null, shipping_address: null,
        store_order_items: [{ id: 'i8', order_id: 'o8', product_id: 'm1', variant_id: 'v1', kind: 'merch', title: 'Remera Ö', variant_label: 'Talle M',
            unit_price: 18000, quantity: 1, line_total: 18000, image_path: null }],
        store_licenses: []
    }, extra || {});
}
const detailOf = async (order) => (await purchasesDetail(order, MERCH)).doc.getElementById('stb-detail').innerHTML;

test('purchases: retiro pagado sin pickup_details → «Coordiná el retiro con el vendedor ({contacto}).»', async () => {
    const paid = await detailOf(merchOrder());
    assert.match(paid, /<p class="stb-text">Coordiná el retiro con el vendedor \(Instagram @mara\.ink\)\.<\/p>/);
    assert.doesNotMatch(paid, /te llega cuando el vendedor confirme el pago/, 'ya pagado: no se promete que llegue la dirección');

    const noContact = await detailOf(merchOrder({ seller_contact: null }));
    assert.match(noContact, /<p class="stb-text">Coordiná el retiro con el vendedor\.<\/p>/);

    const ready = await detailOf(merchOrder({ status: 'fulfilled', fulfillment_status: 'delivered', delivered_at: isoIn(-HOUR) }));
    assert.match(ready, /Coordiná el retiro con el vendedor \(Instagram @mara\.ink\)\./);

    const escaped = await detailOf(merchOrder({ seller_contact: '<b>@mara</b>' }));
    assert.match(escaped, /Coordiná el retiro con el vendedor \(&lt;b&gt;@mara&lt;\/b&gt;\)\./);

    // Con la dirección del pedido: se muestra y no hace falta coordinar.
    const withAddress = await detailOf(merchOrder({ pickup_details: 'Av. de ejemplo 123 · Palermo' }));
    assert.match(withAddress, /Dirección de retiro<\/p><p class="stb-pre">Av\. de ejemplo 123 · Palermo<\/p>/);
    assert.doesNotMatch(withAddress, /Coordiná el retiro/);

    // Pendiente: la dirección llega con la confirmación del pago.
    const pending = await detailOf(merchOrder({ status: 'pending_payment', paid_at: null, fulfillment_status: 'unfulfilled', expires_at: isoIn(20 * HOUR) }));
    assert.match(pending, /La dirección exacta del estudio te llega cuando el vendedor confirme el pago\./);
    assert.doesNotMatch(pending, /Coordiná el retiro/);

    // Cancelado: ni promesa ni coordinación.
    const cancelled = await detailOf(merchOrder({ status: 'cancelled', paid_at: null, fulfillment_status: 'unfulfilled', cancelled_at: isoIn(-HOUR) }));
    assert.doesNotMatch(cancelled, /te llega cuando el vendedor confirme el pago|Coordiná el retiro/);
});

test('purchases: la dirección de envío muestra el país con M.countryName', async () => {
    const html = await detailOf(merchOrder({ fulfillment_method: 'shipping', shipping_amount: 2000, total_amount: 20000,
        shipping_address: { recipient: 'Ana Pérez', line1: 'Calle 1', city: 'Montevideo', postal_code: '11200', country: 'UY', phone: null } }));
    assert.match(html, /<address class="stb-address">Ana Pérez<br>Calle 1<br>Montevideo, 11200<br>Uruguay<\/address>/);
    const odd = await detailOf(merchOrder({ fulfillment_method: 'shipping', shipping_address: { recipient: 'Ana', line1: 'Calle 1', city: 'X', country: 'ZZ' } }));
    assert.match(odd, /<br>ZZ<\/address>/, 'un código que no es país queda tal cual');
});

test('checkout: «Olvidé mi contraseña →» termina en flecha y el total tiene su región viva', () => {
    const html = read(PAGES.checkout.html);
    assert.match(html, /id="stb-link-recover" href="\/recover\?from=client">Olvidé mi contraseña →<\/a>/);
    assert.match(html, /<p class="wo-sr-only" id="stb-total-live" aria-live="polite" aria-atomic="true"><\/p>/);
});

const LICENSE_BASE = {
    id: 'l1', order_id: 'o1', order_item_id: 'i1', product_id: 'p1', tier: 'exclusive', holder_user_id: 'buyer-1', holder_name: 'Ana Pérez',
    seller_type: 'artist', seller_id: 'seller-1', seller_display_name: 'Mara Ink', seller_username: 'mara-ink.wo', design_title: 'Golondrina',
    terms_version: Model.TERMS_VERSION, verification_code: 'WOL-ABCD-1234', issued_at: '2026-10-20T13:00:00Z', used_at: null, revoked_at: null,
    metadata_json: {}
};
function paidDesignOrder(licenseExtra) {
    return {
        id: 'o1', order_number: 1042, status: 'paid', fulfillment_method: 'digital', currency: 'USD', buyer_user_id: 'buyer-1',
        subtotal_amount: 300, shipping_amount: 0, total_amount: 300, created_at: '2026-10-20T12:00:00Z', paid_at: '2026-10-20T13:00:00Z',
        store_order_items: [{ id: 'i1', order_id: 'o1', product_id: 'p1', kind: 'design', title: 'Golondrina', license_tier: 'exclusive',
            unit_price: 300, quantity: 1, line_total: 300, image_path: null }],
        store_licenses: [Object.assign({}, LICENSE_BASE, licenseExtra || {})]
    };
}
const ASSETS = [
    { id: 'a1', product_id: 'p1', kind: 'original', mime_type: 'image/png', file_name: 'golondrina.png' },
    { id: 'a2', product_id: 'p1', kind: 'stencil', mime_type: 'image/png', file_name: 'golondrina-stencil.png' }
];
async function purchasesDetail(order, publicProduct, extraStore) {
    const page = runPage('purchases', {
        location: { pathname: '/store/purchases/', search: '?pedido=' + order.id },
        viewer: BUYER,
        store: Object.assign({
            listMyPurchases: async () => [order],
            getMyOrder: async () => order,
            getPublicProduct: async () => (publicProduct ? { seller: SELLER_INFO, settings: {}, product: publicProduct } : null),
            listLicenseAssets: async () => ASSETS.slice()
        }, extraStore || {})
    });
    await flush();
    return page;
}

test('purchases: «Imprimir a escala real» usa las medidas de la licencia aunque la exclusiva ya no sea pública', async () => {
    // Exclusiva vendida: get_public_store_product devuelve null (producto retirado).
    const withMeta = await purchasesDetail(paidDesignOrder({ metadata_json: { design_width_cm: 9, design_height_cm: 7 } }), null);
    const html = withMeta.doc.getElementById('stb-detail').innerHTML;
    assert.match(html, /data-stb-action="print-scale"/);
    assert.match(html, /El stencil se imprime a 9 × 7 cm\./);
    assert.match(html, /<div class="stb-thumb"><span class="sts-media-ph" aria-hidden="true">/, 'aside: miniatura decorativa');

    // Sin medidas en la licencia, se usan las de la ficha pública si está activa.
    const fromProduct = await purchasesDetail(paidDesignOrder(), Object.assign({}, DESIGN, { design_width_cm: 12.5, design_height_cm: 10 }));
    assert.match(fromProduct.doc.getElementById('stb-detail').innerHTML, /El stencil se imprime a 12,5 × 10 cm\./);

    // Sin medidas en ningún lado: no se ofrece.
    const none = await purchasesDetail(paidDesignOrder(), null);
    const plainHtml = none.doc.getElementById('stb-detail').innerHTML;
    assert.doesNotMatch(plainHtml, /print-scale/);
    assert.match(plainHtml, /Bajar stencil/, 'las descargas siguen');
});

test('purchases: designSize lee de la licencia las mismas claves que escriben el SQL y la fixture', async () => {
    // SQL (store_apply_order_payment): la licencia nace con las medidas del producto.
    const sql = read('supabase/migrations/20261030150000_store_core.sql');
    const apply = sql.slice(sql.indexOf('create or replace function public.store_apply_order_payment('));
    const at = apply.indexOf('insert into public.store_licenses');
    assert.ok(at > 0, 'store_apply_order_payment emite la licencia');
    const insert = apply.slice(at, apply.indexOf(');', apply.indexOf('jsonb_strip_nulls', at)) + 2);
    assert.match(insert, /metadata_json\s*\)\s*values/, 'store_licenses recibe metadata_json');
    assert.match(insert, /jsonb_strip_nulls\(jsonb_build_object\(\s*'design_width_cm', v_product\.design_width_cm,\s*'design_height_cm', v_product\.design_height_cm\s*\)\)/);
    // La página lee esas claves de metadata_json y, si faltan, de la ficha pública.
    const code = stripComments(read(PAGES.purchases.js));
    assert.match(code, /Number\(src\.design_width_cm\)/);
    assert.match(code, /Number\(src\.design_height_cm\)/);
    assert.match(code, /sizeFrom\(raw && raw\.metadata_json\) \|\| sizeFrom\(bundle && bundle\.product\)/);

    // Fixture: una exclusiva pagada en el emulador deja el producto retirado
    // (sin ficha pública) y la licencia con las medidas: igual se imprime.
    const prevSelf = global.self;
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/store-model.js'), sandbox, { filename: 'store-model.js' });
    vm.runInNewContext(read('public/shared/js/demo-fixtures/store.js'), sandbox, { filename: 'demo-fixtures/store.js' });
    global.self = sandbox;
    let fx;
    let emu;
    try {
        const Postgrest = require('../public/shared/js/wo-demo-postgrest.js');
        const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');
        fx = Fixtures.build({ userId: '11111111-1111-4111-8111-111111111111', username: 'demo.wo', name: 'Demo Artist', email: 'demo@weotzi.test' });
        emu = Postgrest.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views });
    } finally {
        global.self = prevSelf;
    }
    const SELLER_ID = '11111111-1111-4111-8111-111111111111';
    const D1 = '0000c0de-0000-4000-8000-57' + String(101).padStart(10, '0');
    const buyerId = fx.clients[2].user_id;
    const call = (method, p, search, body, userId) => {
        const res = emu.handle({ method, path: p, search: search || '', headers: {}, body: body == null ? null : JSON.stringify(body), ctx: { userId } });
        assert.ok(res.status >= 200 && res.status < 300, p + ' → ' + res.status + ' ' + res.body);
        return res.body == null ? null : JSON.parse(res.body);
    };
    const rpc = (fn, args, userId) => call('POST', 'rpc/' + fn, '', args, userId);
    const created = rpc('create_store_order', {
        p_product_id: D1, p_variant_id: null, p_quantity: 1, p_license_tier: 'exclusive', p_license_holder_name: null, p_fulfillment_method: null,
        p_shipping_address: null, p_buyer_note: null, p_terms_version: Model.TERMS_VERSION, p_idempotency_key: 'k-size-1'
    }, buyerId);
    rpc('report_store_payment', { p_order_id: created.id, p_reference: 'TR-SIZE' }, buyerId);
    rpc('confirm_store_order_payment', { p_order_id: created.id, p_collected_by: 'seller', p_reference: 'TR-SIZE', p_note: null }, SELLER_ID);
    assert.equal(rpc('get_public_store_product', { p_product_id: D1 }, buyerId), null, 'exclusiva vendida: sin ficha pública');
    const rows = call('GET', 'store_orders', '?select=' + encodeURIComponent(Repo.STORE_SELECTS.orderFull) + '&id=eq.' + created.id, null, buyerId);
    const order = rows[0];
    assert.deepEqual(order.store_licenses[0].metadata_json, { design_width_cm: 9, design_height_cm: 7 }, 'la licencia trae las medidas');
    const assets = emu.rows('store_design_assets').filter((a) => a.product_id === D1).map((a) => JSON.parse(JSON.stringify(a)));
    const page = await purchasesDetail(order, null, { listLicenseAssets: async () => assets });
    const html = page.doc.getElementById('stb-detail').innerHTML;
    assert.match(html, /data-stb-action="print-scale"/);
    assert.match(html, /El stencil se imprime a 9 × 7 cm\./);

    // Solo una medida en la licencia (jsonb_strip_nulls sacó la otra): se usa la ficha pública.
    const half = JSON.parse(JSON.stringify(order));
    half.store_licenses[0].metadata_json = { design_width_cm: 9 };
    const fallback = await purchasesDetail(half, Object.assign({}, DESIGN, { design_width_cm: 11, design_height_cm: 8.5 }), { listLicenseAssets: async () => assets });
    assert.match(fallback.doc.getElementById('stb-detail').innerHTML, /El stencil se imprime a 11 × 8,5 cm\./);
});

test('purchases: si falla el refresco después de una acción, avisa y deshabilita las acciones del detalle', async () => {
    const order = {
        id: 'o2', order_number: 1043, status: 'pending_payment', fulfillment_method: 'digital', currency: 'USD', buyer_user_id: 'buyer-1',
        subtotal_amount: 25, shipping_amount: 0, total_amount: 25, created_at: '2026-10-30T12:00:00Z',
        expires_at: new Date(Date.now() + 20 * 3600000).toISOString(), payment_provider: 'manual', expected_collector: 'seller',
        store_order_items: [{ id: 'i2', order_id: 'o2', product_id: 'p1', kind: 'design', title: 'Golondrina', license_tier: 'personal',
            unit_price: 25, quantity: 1, line_total: 25, image_path: null }],
        store_licenses: []
    };
    let cancelled = 0;
    const page = await purchasesDetail(order, DESIGN, {
        cancelOrder: async () => { cancelled++; return {}; },
        getMyOrder: async () => { throw new Error('network'); }
    });
    const { doc, S } = page;
    assert.match(doc.getElementById('stb-detail').innerHTML, /data-stb-action="cancel"/);
    S.confirmDialog = () => Promise.resolve({ confirmed: true, value: null });
    const buttons = [{ disabled: false }, { disabled: false }].map((b) => Object.assign(b, {
        removeAttribute() {}, getAttribute: () => null, setAttribute() {}
    }));
    doc.getElementById('stb-detail').queryFn = (sel) => (/data-stb-action="cancel"/.test(sel) ? buttons : []);
    const cancelBtn = { getAttribute: (k) => (k === 'data-stb-action' ? 'cancel' : null) };
    doc.listeners.click[0]({ button: 0, target: { closest: (sel) => (sel === '[data-stb-action]' ? cancelBtn : null) } });
    await flush();
    assert.equal(cancelled, 1);
    assert.ok(buttons.every((b) => b.disabled), 'acciones deshabilitadas hasta recargar');
    await wait(80);
    assert.equal(doc.getElementById('sts-live-alert').textContent, 'Actualizamos tu pedido, pero no pudimos recargar la vista. Recargá la página.');
    assert.equal(doc.getElementById('sts-live-status').textContent, 'Cancelaste el pedido.');
});

test('license: la salida del certificado depende de quién lo mira', async () => {
    const license = Object.assign({}, LICENSE_BASE, { store_orders: { id: 'o1', order_number: 1042, status: 'paid', buyer_user_id: 'buyer-1' } });
    const certFor = async (viewer) => {
        const page = runPage('license', { location: { pathname: '/store/license/', search: '?id=l1' }, viewer, store: { getLicense: async () => license } });
        await flush();
        const html = page.doc.getElementById('stb-cert').innerHTML;
        return html.slice(0, html.indexOf('<article'));
    };
    assert.match(await certFor(SELLER), /<a class="stb-back" href="\/artist\/store\/\?tab=pedidos&amp;pedido=o1">← Pedido en tu Store<\/a>/);
    assert.match(await certFor(BUYER), /<a class="stb-back" href="\/store\/purchases\/\?pedido=o1">← Mis compras<\/a>/);
    const other = await certFor(SUPPORT);
    assert.match(other, /<a class="stb-link" href="\/store\/license\/">Verificá un código →<\/a>/);
    assert.doesNotMatch(other, /Mis compras/);
});

test('store-buyer.css: el nivel deshabilitado no usa opacity y el motivo va a contraste pleno', () => {
    const css = read(CSS_PATH).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]*\.stb-option\.is-disabled[^{}]*)\{([^}]*)\}/g)) {
        assert.doesNotMatch(m[2], /opacity/, m[1].trim());
    }
    assert.match(css, /\.stb-option-reason\{[^}]*color:var\(--text-danger\)/);
    assert.match(css, /\.stb-option\.is-disabled \.stb-option-title,\.stb-option\.is-disabled \.stb-option-price\{color:var\(--text-muted\)\}/);
});
