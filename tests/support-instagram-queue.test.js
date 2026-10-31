'use strict';
// Cola "Validaciones IG" del dashboard de soporte
// (public/shared/js/support-dashboard-instagram.js + public/support/dashboard/index.html).
// Contrato: CONTRACT-modo-asistido §3 (endpoints de soporte de validación de Instagram).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const MODULE_PATH = path.join(root, 'public', 'shared', 'js', 'support-dashboard-instagram.js');
const html = read('public', 'support', 'dashboard', 'index.html');
const source = fs.readFileSync(MODULE_PATH, 'utf8');
const { _internal: ig } = require(MODULE_PATH);

// ---------------------------------------------------------------- markup

test('el dashboard de soporte suma la pestaña instagram en el nav y en las tabs', () => {
    const nav = html.match(/<a [^>]*class="nav-item nav-menu-item"[^>]*data-tab="instagram"[^>]*>[\s\S]*?<\/a>/);
    const tab = html.match(/<button [^>]*class="tab-btn"[^>]*data-tab="instagram"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(nav, 'falta el nav-item data-tab="instagram"');
    assert.ok(tab, 'falta el tab-btn data-tab="instagram"');
    assert.match(nav[0], /VALIDACIONES IG/);
    assert.match(tab[0], /VALIDACIONES IG/);
    assert.match(nav[0], /class="igq-count" hidden/);
    assert.match(tab[0], /class="igq-count" hidden/);
    // Sin onclick inline: el módulo escucha los clicks (si no carga, no rompe switchTab).
    assert.doesNotMatch(nav[0], /onclick=/);
    assert.doesNotMatch(tab[0], /onclick=/);
});

test('la pestaña instagram va después de reviews (y de tickets si existe)', () => {
    for (const kind of ['nav-menu-item', 'tab-btn']) {
        const order = [...html.matchAll(new RegExp(`class="[^"]*${kind}[^"]*"[^>]*data-tab="([a-z]+)"`, 'g'))].map((m) => m[1]);
        const ig = order.indexOf('instagram');
        assert.ok(ig > order.indexOf('reviews'), `${kind}: instagram debe ir después de reviews (${order.join(', ')})`);
        if (order.includes('tickets')) assert.ok(ig > order.indexOf('tickets'), `${kind}: instagram debe ir después de tickets`);
    }
});

test('el script del módulo se carga después de support-dashboard.js', () => {
    const base = html.indexOf('<script src="/shared/js/support-dashboard.js"></script>');
    const mine = html.search(/<script src="\/shared\/js\/support-dashboard-instagram\.js(\?v=[^"]+)?"><\/script>/);
    assert.ok(base >= 0, 'support-dashboard.js tiene que seguir en la página');
    assert.ok(mine > base, 'support-dashboard-instagram.js va después de support-dashboard.js');
    assert.equal(html.match(/support-dashboard-instagram\.js/g).length, 1);
});

// ---------------------------------------------------------------- fuente

test('el módulo envuelve window.switchTab y delega las demás pestañas', () => {
    assert.match(source, /previousSwitch = typeof root\.switchTab === 'function' \? root\.switchTab : null;/);
    assert.match(source, /root\.switchTab = switchTab;/);
    assert.match(source, /return previousSwitch \? previousSwitch\.apply\(this, arguments\) : undefined;/);
    assert.match(source, /addEventListener\('click', onTabClick, true\)/);
});

test('usa los tres endpoints de soporte del contrato', () => {
    assert.match(source, /const API = '\/api\/support\/instagram-verifications';/);
    assert.equal(ig.listPath('pending'), '/api/support/instagram-verifications?status=pending');
    assert.equal(ig.listPath('verified'), '/api/support/instagram-verifications?status=verified');
    assert.equal(ig.listPath('all'), '/api/support/instagram-verifications?status=all');
    assert.equal(ig.listPath('nada'), '/api/support/instagram-verifications?status=pending');
    assert.equal(ig.actionPath('a b/1', 'confirm'), '/api/support/instagram-verifications/a%20b%2F1/confirm');
    assert.equal(ig.actionPath('42', 'reject'), '/api/support/instagram-verifications/42/reject');
});

test('no lee ni escribe tablas desde el navegador', () => {
    assert.doesNotMatch(source, /_supabase\.from\(/);
    assert.doesNotMatch(source, /WeotziData\.from\(/);
    assert.doesNotMatch(source, /rest\/v1/);
    assert.doesNotMatch(source, /artist_instagram_verifications'?\)/);
});

test('copy: instrucciones en voseo, botones del contrato y sin signos de exclamación', () => {
    assert.match(source, /Abrí los mensajes directos de @weotzi, buscá el mensaje de \$\{esc\(handle/);
    assert.match(source, /y copiá el código\./);
    for (const label of ['VALIDAR CON CÓDIGO', 'VALIDAR SIN CÓDIGO', 'RECHAZAR']) assert.ok(source.includes(label), label);
    assert.doesNotMatch(source, /¡/);
    for (const [key, text] of Object.entries(ig.MSG)) assert.doesNotMatch(text, /!/, `MSG.${key}`);
    // Ningún literal de texto termina en "!".
    assert.doesNotMatch(source, /[A-Za-zÁÉÍÓÚáéíóúñ.]![`'"<]/);
    assert.doesNotMatch(source, /fa-instagram|data-wo-icon="instagram-emoji"/);
});

test('estilos inyectados: tokens con respaldo, sin hex, radius 0 y movimiento reducido', () => {
    const css = source.slice(source.indexOf('const CSS = `'), source.indexOf('`;', source.indexOf('const CSS = `')));
    assert.ok(css.length > 200);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css, /border-radius:\s*(?!var\(--radius-none,0\))/);
    assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(css, /\.igq-panel\[hidden\]\{display:none\}/);
});

// ---------------------------------------------------------------- helpers puros

test('esc escapa todo lo que viene del usuario', () => {
    assert.equal(ig.esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(ig.esc("O'Neil & co"), 'O&#39;Neil &amp; co');
    assert.equal(ig.esc(null), '');
});

test('normalizeCode acepta el código suelto o el mensaje pegado', () => {
    assert.equal(ig.normalizeCode('WO-4F7K2Q'), 'WO-4F7K2Q');
    assert.equal(ig.normalizeCode('wo4f7k2q'), 'WO-4F7K2Q');
    assert.equal(ig.normalizeCode('  wo - 4f7k2q '), 'WO-4F7K2Q');
    assert.equal(ig.normalizeCode('WO–4F7K2Q'), 'WO-4F7K2Q');
    assert.equal(ig.normalizeCode('hola, te paso el código WO-4F7K2Q gracias'), 'WO-4F7K2Q');
    assert.equal(ig.normalizeCode('WO-4F7K2'), '');
    assert.equal(ig.normalizeCode('WO-4F7K2QX'), '');
    assert.equal(ig.normalizeCode('WO-0O1I2Q'), '', 'el alfabeto no tiene 0, O, 1 ni I');
    assert.equal(ig.normalizeCode('WO-4F7K2Q y WO-AAAAAA'), '', 'con dos códigos no adivina');
    assert.equal(ig.normalizeCode(''), '');
});

test('buildActionRequest: con código, sin código (force + nota) y rechazo (nota)', () => {
    assert.deepEqual(ig.buildActionRequest('code', 'wo-4f7k2q', ''), { action: 'confirm', body: { code: 'WO-4F7K2Q' } });
    assert.deepEqual(ig.buildActionRequest('code', 'WO-4F7K2Q', ' ok '), { action: 'confirm', body: { code: 'WO-4F7K2Q', note: 'ok' } });
    assert.equal(ig.buildActionRequest('code', 'WO-12', '').field, 'code');
    assert.equal(ig.buildActionRequest('code', 'WO-12', '').error, ig.MSG.codeInvalid);

    assert.deepEqual(ig.buildActionRequest('force', '', 'Mandó captura del DM'), { action: 'confirm', body: { force: true, note: 'Mandó captura del DM' } });
    assert.deepEqual(ig.buildActionRequest('force', 'WO-4F7K2Q', '   '), { error: ig.MSG.noteForce, field: 'note' });

    assert.deepEqual(ig.buildActionRequest('reject', '', 'La cuenta no es suya'), { action: 'reject', body: { note: 'La cuenta no es suya' } });
    assert.deepEqual(ig.buildActionRequest('reject', '', ''), { error: ig.MSG.noteReject, field: 'note' });
    assert.equal(ig.buildActionRequest('reject', '', 'x'.repeat(900)).body.note.length, 500);
});

test('estado visible y conteo de pendientes', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const items = [
        { status: 'pending', expires_at: '2026-11-01T12:00:00Z' },
        { status: 'pending', expires_at: '2026-10-29T12:00:00Z' },
        { status: 'verified' },
        { status: 'rejected' }
    ];
    assert.equal(ig.displayStatus(items[0], now), 'pending');
    assert.equal(ig.displayStatus(items[1], now), 'expired');
    assert.equal(ig.displayStatus(items[2], now), 'verified');
    assert.equal(ig.pendingCount(items, now), 1);
    assert.equal(ig.pendingCount(null, now), 0);
    assert.equal(ig.statusMeta('verified').label, 'Validada');
    assert.equal(ig.statusMeta('rejected').label, 'Rechazada');
    assert.equal(ig.statusMeta('raro').label, 'raro');
});

test('acciones por estado: una vencida se valida sin código o se rechaza, nunca con código', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const ALL = ['code', 'force', 'reject'];
    const NO_CODE = ['force', 'reject'];
    assert.deepEqual(ig.availableActions({ status: 'pending', expires_at: '2026-11-01T12:00:00Z' }, now), ALL);
    assert.deepEqual(ig.availableActions({ status: 'pending' }, now), ALL, 'sin vencimiento conocido sigue pendiente');
    // El servidor responde 409 a un código sin force si la fila venció (guardada o por plazo).
    assert.deepEqual(ig.availableActions({ status: 'pending', expires_at: '2026-10-29T12:00:00Z' }, now), NO_CODE);
    assert.deepEqual(ig.availableActions({ status: 'expired', expires_at: '2026-10-29T12:00:00Z' }, now), NO_CODE);
    assert.deepEqual(ig.availableActions({ status: 'EXPIRED' }, now), NO_CODE);
    for (const status of ['verified', 'rejected', 'cancelled', '', 'raro']) {
        assert.deepEqual(ig.availableActions({ status }, now), [], status);
    }
    assert.deepEqual(ig.availableActions(null, now), []);
});

test('base path: respeta WEOTZI_BASE_PATH y el prefijo /beta', () => {
    assert.equal(ig.basePath({ location: { pathname: '/support/dashboard/' } }), '');
    assert.equal(ig.basePath({ location: { pathname: '/beta/support/dashboard/' } }), '/beta');
    assert.equal(ig.basePath({ location: { pathname: '/betamax/' } }), '');
    assert.equal(ig.basePath({ WEOTZI_BASE_PATH: '/staging/', location: { pathname: '/x' } }), '/staging');
});

test('errores del servidor en castellano y en línea', () => {
    const e = (status, json) => ig.makeError(status, json);
    assert.equal(ig.errorMessage(e(503, { success: false, code: 'IG_VERIFICATION_UNAVAILABLE' })), ig.MSG.unavailable);
    assert.equal(ig.errorMessage(e(401, { error: 'Authentication required' })), ig.MSG.session);
    assert.equal(ig.errorMessage(e(403, { error: 'Support agent access required' })), ig.MSG.forbidden);
    assert.equal(ig.errorMessage(e(0, null)), ig.MSG.network);
    assert.equal(ig.errorMessage(e(400, { error: 'El código no coincide.' })), 'El código no coincide.');
    assert.equal(ig.errorMessage(e(409, {})), ig.MSG.conflict);
    assert.equal(ig.errorMessage(e(500, {})), ig.MSG.generic);
});

// ---------------------------------------------------------------- comportamiento (DOM mínimo en vm)

function camel(name) {
    return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function createDom() {
    const byId = new Map();
    const all = [];
    const doc = { readyState: 'complete', listeners: {}, activeElement: null };

    function attached(el) {
        let node = el;
        while (node) {
            if (node === doc.body || node === doc.head) return true;
            node = node.parentNode;
        }
        return false;
    }

    class El {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.children = [];
            this.parentNode = null;
            this.style = {};
            this.dataset = {};
            this.attributes = {};
            this.listeners = {};
            this.hidden = false;
            this.disabled = false;
            this.checked = false;
            this.value = '';
            this.textContent = '';
            this.title = '';
            this._html = '';
            this._classes = new Set();
            this._id = '';
            const self = this;
            this.classList = {
                add: (...c) => c.forEach((x) => self._classes.add(x)),
                remove: (...c) => c.forEach((x) => self._classes.delete(x)),
                contains: (c) => self._classes.has(c),
                toggle(c, force) {
                    const on = force === undefined ? !self._classes.has(c) : Boolean(force);
                    if (on) self._classes.add(c); else self._classes.delete(c);
                    return on;
                }
            };
            all.push(this);
        }
        get id() { return this._id; }
        set id(v) { this._id = String(v); byId.set(this._id, this); }
        get className() { return [...this._classes].join(' '); }
        set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
        setAttribute(n, v) {
            const value = String(v);
            this.attributes[n] = value;
            if (n === 'id') this.id = value;
            else if (n === 'class') this.className = value;
            else if (n === 'hidden') this.hidden = true;
            else if (n.startsWith('data-')) this.dataset[camel(n.slice(5))] = value;
        }
        getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
        hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); }
        removeAttribute(n) { delete this.attributes[n]; }
        appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
        insertAdjacentElement(pos, c) {
            assert.equal(pos, 'afterend');
            const parent = this.parentNode;
            parent.children.splice(parent.children.indexOf(this) + 1, 0, c);
            c.parentNode = parent;
            return c;
        }
        get nextElementSibling() {
            const parent = this.parentNode;
            if (!parent) return null;
            return parent.children[parent.children.indexOf(this) + 1] || null;
        }
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
        dispatch(type, extra) {
            const ev = Object.assign({ type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra);
            let node = this;
            while (node && node.listeners) {
                (node.listeners[type] || []).forEach((fn) => fn(ev));
                node = node.parentNode;
            }
            return ev;
        }
        closest(sel) {
            const m = /^\[([\w-]+)\]$/.exec(sel);
            let node = this;
            while (node && node.hasAttribute) {
                if (m && node.hasAttribute(m[1])) return node;
                node = node.parentNode;
            }
            return null;
        }
        querySelectorAll() { return []; }
        focus() { doc.activeElement = this; }
        get innerHTML() { return this._html; }
        // Parser mínimo: cada etiqueta con id="" se vuelve un hijo directo con sus atributos.
        set innerHTML(markup) {
            this._html = String(markup);
            this.children.forEach((c) => { c.parentNode = null; });
            this.children = [];
            const tagRe = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
            let m;
            while ((m = tagRe.exec(this._html)) !== null) {
                const attrs = {};
                const attrRe = /([\w:-]+)(?:="([^"]*)")?/g;
                let a;
                while ((a = attrRe.exec(m[2])) !== null) attrs[a[1]] = a[2] === undefined ? '' : a[2];
                if (!attrs.id) continue;
                const el = new El(m[1]);
                Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
                this.appendChild(el);
            }
        }
    }

    doc.head = new El('head');
    doc.body = new El('body');
    doc.createElement = (tag) => new El(tag);
    doc.getElementById = (id) => (byId.has(id) && attached(byId.get(id)) ? byId.get(id) : null);
    doc.querySelectorAll = (sel) => {
        const classes = sel.split(',').map((s) => s.trim()).filter((s) => /^\.[\w-]+$/.test(s)).map((s) => s.slice(1));
        return all.filter((el) => attached(el) && classes.some((c) => el._classes.has(c)));
    };
    doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
    doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
    doc.clickOn = (target) => {
        const ev = { type: 'click', target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        (doc.listeners.click || []).forEach((fn) => fn(ev));
        return ev;
    };

    const make = (tag, attrs, parent) => {
        const el = new El(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
        if (parent) parent.appendChild(el);
        return el;
    };
    return { doc, make };
}

function buildPage({ items, routes }) {
    const { doc, make } = createDom();
    const aside = make('aside', {}, doc.body);
    const navArtists = make('a', { class: 'nav-item nav-menu-item active', 'data-tab': 'artists' }, aside);
    const navIg = make('a', { class: 'nav-item nav-menu-item', 'data-tab': 'instagram' }, aside);
    const navBadge = make('span', { class: 'igq-count', hidden: '' }, navIg);
    const main = make('main', {}, doc.body);
    make('div', { class: 'tab-navigation' }, main);
    const tabIg = make('button', { class: 'tab-btn', 'data-tab': 'instagram' }, main.children[0]);
    const tabBadge = make('span', { class: 'igq-count', hidden: '' }, tabIg);
    const toolbar = make('div', { class: 'table-toolbar' }, main);
    const table = make('div', { class: 'table-container', id: 'table-container' }, main);
    const otherPanel = make('section', { id: 'sdt-panel', class: 'sdt-panel' }, main);
    const drawer = make('div', { id: 'drawer-content' }, doc.body);
    const toggle = make('input', { id: 'drawer-toggle' }, doc.body);

    const calls = [];
    const original = [];
    const sandbox = {
        document: doc,
        console: { log() {}, warn() {}, error() {} },
        location: { pathname: '/beta/support/dashboard/' },
        setTimeout: () => 0,
        _supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } },
        switchTab(tab) { original.push(tab); },
        fetch: async (url, opts) => {
            calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
            const handler = (routes || []).find((r) => url.includes(r.match));
            if (handler) return handler.reply(url, opts);
            return { ok: true, status: 200, json: async () => ({ success: true, items: items() }) };
        }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'support-dashboard-instagram.js' });
    return { sandbox, doc, calls, original, navArtists, navIg, navBadge, tabIg, tabBadge, toolbar, table, otherPanel, drawer, toggle };
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const future = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

test('switchTab: delega las demás pestañas y pinta su panel para instagram', async () => {
    const items = () => [
        { id: 'v1', artist_name: '<img src=x onerror=alert(1)>', username: 'laura.wo', ig_handle: 'laura.tattoo', status: 'pending', created_at: future(-2), expires_at: future(48), pending_items: 3 },
        { id: 'v2', artist_name: 'Nico', username: 'nico.wo', ig_handle: '@Nico.Ink', status: 'pending', created_at: future(-1), expires_at: future(10), pending_items: 0 }
    ];
    const page = buildPage({ items });
    const { sandbox, doc } = page;

    sandbox.switchTab('quotes');
    assert.deepEqual(page.original, ['quotes'], 'las otras pestañas van al switchTab original');

    sandbox.switchTab('instagram');
    assert.deepEqual(page.original, ['quotes'], 'instagram no pasa por el switchTab original');
    const panel = doc.getElementById('igq-panel');
    assert.ok(panel, 'crea #igq-panel');
    assert.equal(panel.hidden, false);
    assert.equal(page.toolbar.style.display, 'none');
    assert.equal(page.table.style.display, 'none');
    assert.equal(page.otherPanel.style.display, 'none', 'también oculta paneles de otras pestañas');
    assert.equal(page.navIg.classList.contains('active'), true);
    assert.equal(page.navArtists.classList.contains('active'), false);
    assert.equal(page.tabIg.classList.contains('active'), true);

    await flush();
    const list = page.calls.find((c) => c.url.includes('?status='));
    assert.equal(list.url, '/beta/api/support/instagram-verifications?status=pending');
    assert.equal(list.opts.headers.Authorization, 'Bearer tok-123');
    assert.equal(list.opts.method, 'GET');

    const rows = doc.getElementById('igq-body').innerHTML;
    assert.match(rows, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(rows, /<img src=x/);
    assert.match(rows, /@laura\.tattoo/);
    assert.match(rows, /@nico\.ink/);
    assert.ok(rows.indexOf('data-igq-id="v2"') < rows.indexOf('data-igq-id="v1"'), 'el que vence antes va primero');
    assert.equal(page.navBadge.textContent, '2');
    assert.equal(page.navBadge.hidden, false);
    assert.equal(page.tabBadge.textContent, '2');

    sandbox.switchTab('artists');
    assert.deepEqual(page.original, ['quotes', 'artists']);
    assert.equal(panel.hidden, true);
    assert.equal(page.toolbar.style.display, '');
    assert.equal(page.table.style.display, '');
    assert.equal(page.otherPanel.style.display, '');
});

test('los clicks en el nav y la tab de instagram abren la cola; los de otra pestaña la cierran', async () => {
    const page = buildPage({ items: () => [] });
    const { sandbox, doc } = page;
    const ev = doc.clickOn(page.navIg);
    assert.equal(ev.defaultPrevented, true, 'el <a href="#"> no navega');
    assert.equal(doc.getElementById('igq-panel').hidden, false);
    await flush();
    assert.match(doc.getElementById('igq-body').innerHTML, /No hay validaciones pendientes\./);
    assert.equal(page.navBadge.hidden, true);

    doc.clickOn(page.navArtists);
    assert.equal(doc.getElementById('igq-panel').hidden, true);
    assert.equal(page.table.style.display, '');
    assert.equal(typeof sandbox.SupportInstagramQueue.refresh, 'function');
});

test('el filtro de estado pide validadas o todas al servidor', async () => {
    const page = buildPage({ items: () => [] });
    page.sandbox.switchTab('instagram');
    await flush();
    const select = page.doc.getElementById('igq-status');
    select.value = 'verified';
    select.dispatch('change');
    await flush();
    assert.ok(page.calls.some((c) => c.url === '/beta/api/support/instagram-verifications?status=verified'));
    select.value = 'all';
    select.dispatch('change');
    await flush();
    assert.ok(page.calls.some((c) => c.url === '/beta/api/support/instagram-verifications?status=all'));
});

test('detalle: instrucciones, validación con código, sin código y rechazo contra el servidor', async () => {
    let status = 'pending';
    const items = () => [{ id: 'v1', artist_name: 'Laura', username: 'laura.wo', ig_handle: 'laura"><script>x</script>', status, created_at: future(-2), expires_at: future(48), pending_items: 3, email_masked: 'l***@mail.com' }];
    const routes = [
        { match: '/confirm', reply: async (url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.code === 'WO-AAAAAA') return { ok: false, status: 400, json: async () => ({ success: false, error: 'El código no coincide con el pendiente.' }) };
            status = 'verified';
            return { ok: true, status: 200, json: async () => ({ success: true }) };
        } },
        { match: '/reject', reply: async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) }
    ];
    const page = buildPage({ items, routes });
    const { sandbox, doc } = page;
    sandbox.switchTab('instagram');
    await flush();

    sandbox.SupportInstagramQueue.open('v1');
    assert.equal(page.toggle.checked, true, 'abre el drawer');
    const detail = page.drawer.innerHTML;
    assert.match(detail, /Abrí los mensajes directos de @weotzi, buscá el mensaje de @laura&quot;&gt;&lt;script&gt;x&lt;\/script&gt; y copiá el código\./);
    assert.doesNotMatch(detail, /<script>x/);
    assert.doesNotMatch(detail, /instagram\.com\/laura%22/, 'sin link de perfil para un handle inválido');
    assert.match(detail, /placeholder="WO-XXXXXX"/);
    assert.match(detail, /pattern="\[Ww\]\[Oo\]-\?/);
    assert.match(detail, /VALIDAR CON CÓDIGO/);
    assert.match(detail, /VALIDAR SIN CÓDIGO/);
    assert.match(detail, /RECHAZAR/);

    const form = doc.getElementById('igq-form');
    const feedback = () => doc.getElementById('igq-feedback');

    // REFRESCAR sin cambios de estado no repinta el detalle (no pisa lo que se escribe).
    doc.getElementById('igq-note').value = 'escribiendo…';
    doc.getElementById('igq-refresh').dispatch('click');
    await flush();
    assert.equal(doc.getElementById('igq-note').value, 'escribiendo…');
    assert.equal(doc.getElementById('igq-form'), form);
    doc.getElementById('igq-note').value = '';

    // Código inválido: no llama al servidor.
    doc.getElementById('igq-code').value = 'WO-12';
    const before = page.calls.length;
    form.dispatch('submit');
    await flush();
    assert.equal(page.calls.length, before);
    assert.equal(feedback().textContent, 'Ingresá el código con el formato WO-XXXXXX.');
    assert.equal(feedback().hidden, false);
    assert.equal(doc.getElementById('igq-code').getAttribute('aria-invalid'), 'true');

    // Sin código y sin nota: pide la nota.
    doc.getElementById('igq-act-force').dispatch('click');
    await flush();
    assert.equal(page.calls.length, before);
    assert.equal(feedback().textContent, 'Escribí una nota para validar sin código.');

    // Rechazo sin nota tampoco sale.
    doc.getElementById('igq-act-reject').dispatch('click');
    await flush();
    assert.equal(page.calls.length, before);
    assert.equal(feedback().textContent, 'Escribí una nota con el motivo del rechazo.');

    // Error del servidor: se muestra en línea.
    doc.getElementById('igq-code').value = 'wo-aaaaaa';
    form.dispatch('submit');
    await flush();
    const bad = page.calls[page.calls.length - 1];
    assert.equal(bad.url, '/beta/api/support/instagram-verifications/v1/confirm');
    assert.deepEqual(bad.body, { code: 'WO-AAAAAA' });
    assert.equal(feedback().textContent, 'El código no coincide con el pendiente.');
    assert.equal(feedback().getAttribute('role'), 'alert');

    // Código correcto: POST confirm y refresco de la lista.
    doc.getElementById('igq-code').value = 'hola WO-4F7K2Q';
    doc.getElementById('igq-note').value = 'Visto en DM';
    form.dispatch('submit');
    await flush();
    const ok = page.calls.find((c) => c.body && c.body.code === 'WO-4F7K2Q');
    assert.ok(ok, 'manda el código normalizado');
    assert.deepEqual(ok.body, { code: 'WO-4F7K2Q', note: 'Visto en DM' });
    assert.equal(ok.opts.method, 'POST');
    assert.equal(ok.opts.headers.Authorization, 'Bearer tok-123');
    const lastList = page.calls[page.calls.length - 1];
    assert.match(lastList.url, /\?status=pending$/, 'refresca la lista después de validar');
    assert.match(page.drawer.innerHTML, /Validaste @laura/);
    assert.match(page.drawer.innerHTML, /Esta solicitud ya no está pendiente\./);
    assert.equal(page.navBadge.hidden, true, 'el contador baja a cero');
});

test('validar sin código manda force:true con la nota y rechazar manda la nota', async () => {
    const items = () => [{ id: 'v9', artist_name: 'Ana', username: 'ana.wo', ig_handle: 'ana.ink', status: 'pending', created_at: future(-2), expires_at: future(5), pending_items: 1 }];
    const routes = [
        { match: '/confirm', reply: async () => ({ ok: false, status: 503, json: async () => ({ success: false, code: 'IG_VERIFICATION_UNAVAILABLE' }) }) },
        { match: '/reject', reply: async () => ({ ok: true, status: 200, json: async () => ({ success: true, item: { id: 'v9', status: 'rejected' } }) }) }
    ];
    const page = buildPage({ items, routes });
    const { sandbox, doc } = page;
    sandbox.switchTab('instagram');
    await flush();
    sandbox.SupportInstagramQueue.open('v9');

    doc.getElementById('igq-note').value = 'Mandó captura del DM por mail';
    doc.getElementById('igq-act-force').dispatch('click');
    await flush();
    const force = page.calls.find((c) => c.url.endsWith('/v9/confirm'));
    assert.deepEqual(force.body, { force: true, note: 'Mandó captura del DM por mail' });
    assert.match(doc.getElementById('igq-feedback').textContent, /falta aplicar la migración/);

    doc.getElementById('igq-note').value = 'La cuenta no es del artista';
    doc.getElementById('igq-act-reject').dispatch('click');
    await flush();
    const reject = page.calls.find((c) => c.url.endsWith('/v9/reject'));
    assert.deepEqual(reject.body, { note: 'La cuenta no es del artista' });
    assert.match(page.drawer.innerHTML, /Rechazaste la solicitud de @ana\.ink/);
});

test('vencida (status expired): aviso, VALIDAR SIN CÓDIGO y RECHAZAR, sin campo ni botón de código', async () => {
    const statuses = { v7: 'expired', v8: 'expired' };
    const items = () => [
        { id: 'v7', artist_name: 'Sol', username: 'sol.wo', ig_handle: 'sol.ink', status: statuses.v7, created_at: future(-75), expires_at: future(-3), pending_items: 4 },
        { id: 'v8', artist_name: 'Teo', username: 'teo.wo', ig_handle: 'teo.ink', status: statuses.v8, created_at: future(-80), expires_at: future(-8), pending_items: 2 }
    ];
    const routes = [
        { match: '/confirm', reply: async (url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.force !== true) return { ok: false, status: 409, json: async () => ({ success: false, code: 'IG_CODE_EXPIRED', error: 'El código venció.' }) };
            statuses.v7 = 'verified';
            return { ok: true, status: 200, json: async () => ({ success: true, id: 'v7', status: 'verified' }) };
        } },
        { match: '/reject', reply: async () => {
            statuses.v8 = 'rejected';
            return { ok: true, status: 200, json: async () => ({ success: true, id: 'v8', status: 'rejected' }) };
        } }
    ];
    const page = buildPage({ items, routes });
    const { sandbox, doc } = page;
    sandbox.switchTab('instagram');
    await flush();
    const select = doc.getElementById('igq-status');
    select.value = 'all';
    select.dispatch('change');
    await flush();
    assert.match(doc.getElementById('igq-body').innerHTML, /data-igq-id="v7"[\s\S]*Vencida/);
    assert.equal(page.navBadge.hidden, true, 'las vencidas no suman al contador de pendientes');

    sandbox.SupportInstagramQueue.open('v7');
    const detail = page.drawer.innerHTML;
    assert.ok(detail.includes(ig.MSG.expiredHint), 'muestra el aviso de código vencido');
    assert.match(detail, /buscá el mensaje de @sol\.ink\.<\/p>/, 'no pide copiar un código que ya no sirve');
    assert.doesNotMatch(detail, /VALIDAR CON CÓDIGO/, 'ni el botón ni las instrucciones nombran la validación con código');
    assert.doesNotMatch(detail, /id="igq-code"|id="igq-act-code"|type="submit"/);
    assert.equal(doc.getElementById('igq-code'), null);
    assert.match(detail, /id="igq-act-force" class="action-btn igq-btn igq-btn--accent" data-igq-action="force">VALIDAR SIN CÓDIGO</, 'pasa a ser la acción principal');
    assert.match(detail, /id="igq-act-reject"[^>]*>RECHAZAR</);
    const feedback = () => doc.getElementById('igq-feedback');

    // Un submit (Enter en el formulario) no manda código: el servidor respondería 409.
    const before = page.calls.length;
    doc.getElementById('igq-form').dispatch('submit');
    await flush();
    assert.equal(page.calls.length, before);
    assert.equal(feedback().textContent, ig.MSG.codeExpired);

    // Sin nota tampoco sale.
    doc.getElementById('igq-act-force').dispatch('click');
    await flush();
    assert.equal(page.calls.length, before);
    assert.equal(feedback().textContent, ig.MSG.noteForce);

    doc.getElementById('igq-note').value = 'Mandó el mensaje a tiempo, falló la automatización';
    doc.getElementById('igq-act-force').dispatch('click');
    await flush();
    const force = page.calls.find((c) => c.url.endsWith('/v7/confirm'));
    assert.ok(force, 'POST confirm de la vencida');
    assert.deepEqual(force.body, { force: true, note: 'Mandó el mensaje a tiempo, falló la automatización' });
    assert.match(page.drawer.innerHTML, /Validaste @sol\.ink/);
    assert.match(page.drawer.innerHTML, /Esta solicitud ya no está pendiente\./);

    sandbox.SupportInstagramQueue.open('v8');
    assert.ok(page.drawer.innerHTML.includes(ig.MSG.expiredHint));
    doc.getElementById('igq-note').value = 'La cuenta no es del artista';
    doc.getElementById('igq-act-reject').dispatch('click');
    await flush();
    const reject = page.calls.find((c) => c.url.endsWith('/v8/reject'));
    assert.ok(reject, 'POST reject de la vencida');
    assert.deepEqual(reject.body, { note: 'La cuenta no es del artista' });
    assert.match(page.drawer.innerHTML, /Rechazaste la solicitud de @teo\.ink/);
});

test('pendiente vigente: sigue con código, VALIDAR CON CÓDIGO como acción principal y sin aviso de vencida', async () => {
    const items = () => [{ id: 'v3', artist_name: 'Lu', username: 'lu.wo', ig_handle: 'lu.ink', status: 'pending', created_at: future(-1), expires_at: future(40), pending_items: 1 }];
    const page = buildPage({ items });
    page.sandbox.switchTab('instagram');
    await flush();
    page.sandbox.SupportInstagramQueue.open('v3');
    const detail = page.drawer.innerHTML;
    assert.ok(!detail.includes(ig.MSG.expiredHint));
    assert.match(detail, /buscá el mensaje de @lu\.ink y copiá el código\./);
    assert.match(detail, /Pegalo abajo y tocá VALIDAR CON CÓDIGO\./);
    assert.match(detail, /id="igq-act-code" class="action-btn igq-btn igq-btn--accent" data-igq-action="code">VALIDAR CON CÓDIGO</);
    assert.match(detail, /id="igq-act-force" class="action-btn igq-btn" data-igq-action="force">VALIDAR SIN CÓDIGO</);
    assert.ok(page.doc.getElementById('igq-code'));
});
