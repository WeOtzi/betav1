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
