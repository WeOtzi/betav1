const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Demo para cuentas nuevas, sugerencia persistente, cargador del modo asistido
// y accesos del menú Ö (oct 2026). wo-demo.js y wo-artist-menu.js corren en un
// sandbox node:vm con window/document/storages/location falsos.

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const DEMO_SRC = read('public/shared/js/wo-demo.js');
const MENU_SRC = read('public/shared/js/wo-artist-menu.js');
const DAY = 86400000;
const UID = '22222222-2222-4222-8222-222222222222';
const MIRROR = 'wo_onb_' + UID;
// Objetos creados dentro del vm tienen otro Object.prototype: se comparan planos.
const plain = (value) => JSON.parse(JSON.stringify(value));

/* ------------------------------ sandbox ------------------------------ */

function storage(init) {
    const map = new Map(Object.entries(init || {}));
    return {
        get length() { return map.size; },
        key(i) { const keys = Array.from(map.keys()); return i < keys.length ? keys[i] : null; },
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
    };
}

function classList() {
    const set = new Set();
    return {
        add(...c) { c.forEach((x) => set.add(x)); },
        remove(...c) { c.forEach((x) => set.delete(x)); },
        contains(c) { return set.has(c); },
        toggle(c, force) { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; },
    };
}

// Elemento mínimo: querySelector devuelve un stub memorizado por selector (el
// memo se limpia al asignar innerHTML, como cuando el DOM real se reemplaza).
function element(tag, hooks) {
    return {
        tagName: String(tag).toUpperCase(),
        className: '', id: '', textContent: '', hidden: false, _html: '',
        style: { setProperty() {} }, dataset: {}, attributes: {}, children: [], parentNode: null, listeners: {}, queried: {},
        classList: classList(),
        get innerHTML() { return this._html; },
        set innerHTML(value) { this._html = String(value); this.queried = {}; },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        removeAttribute(k) { delete this.attributes[k]; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        removeEventListener() {},
        appendChild(child) { child.parentNode = this; this.children.push(child); if (hooks.onAppend) hooks.onAppend(child, this); return child; },
        insertBefore(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; },
        remove() { if (this.parentNode) this.parentNode.removeChild(this); },
        querySelector(sel) { return this.queried[sel] || (this.queried[sel] = element('stub', hooks)); },
        querySelectorAll() { return []; },
        closest() { return null; },
        contains(other) { return other === this; },
        focus() {},
        getBoundingClientRect() { return { top: 0, bottom: 40, left: 1200, right: 1240, width: 40, height: 40 }; },
    };
}

function makeDocument(hooks) {
    const listeners = {};
    const doc = {
        readyState: 'loading',
        activeElement: null,
        createElement: (tag) => element(tag, hooks),
        getElementById: () => null,
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
        dispatchEvent(ev) { (listeners[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; },
        querySelector(sel) {
            if (sel.charAt(0) !== '.') return null;
            const cls = sel.slice(1);
            const walk = (node) => {
                for (const child of node.children) {
                    if (String(child.className).split(/\s+/).includes(cls)) return child;
                    const found = walk(child);
                    if (found) return found;
                }
                return null;
            };
            return walk(doc.body);
        },
    };
    doc.documentElement = element('html', hooks);
    doc.head = element('head', hooks);
    doc.body = element('body', hooks);
    return doc;
}

class FakeCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

function sessionFor(daysOld, extra) {
    const created = new Date(Date.now() - daysOld * DAY).toISOString();
    return Object.assign({
        'sb-testref-auth-token': JSON.stringify({
            access_token: 'tok-' + daysOld,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: { id: UID, email: 'nueva@weotzi.test', created_at: created, user_metadata: { username: 'nueva.wo' } },
        }),
    }, extra || {});
}

function runDemo(opts = {}) {
    const requested = [];
    const fetchCalls = [];
    const timers = [];
    const events = [];
    let win = null;
    const hooks = {
        onAppend(child) {
            if (child.tagName === 'SCRIPT') {
                requested.push(child.src);
                const hit = Object.keys(opts.scripts || {}).find((k) => child.src.includes(k));
                if (hit) Promise.resolve().then(() => { opts.scripts[hit](win); if (child.onload) child.onload(); });
            } else if (child.tagName === 'LINK') {
                requested.push(child.href);
                Promise.resolve().then(() => { if (child.onload) child.onload(); });
            }
        },
    };
    const document = makeDocument(hooks);
    const pathname = opts.pathname || '/artist/dashboard';
    const search = opts.search || '';
    const hash = opts.hash || '';
    const origin = 'https://app.weotzi.test';
    const local = storage(opts.local);
    const session = storage(opts.session);
    const replaced = [];
    const nativeFetch = async (url, init) => {
        fetchCalls.push({ url, init: init || {} });
        const reply = opts.reply ? await opts.reply(url, init || {}) : { status: 200, body: { success: true } };
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    };
    // History API mínima: replaceState actualiza location como el navegador.
    const history = {
        state: opts.historyState === undefined ? null : opts.historyState,
        replaceState(state, title, url) {
            replaced.push({ state, url: String(url) });
            const u = new URL(String(url), origin + win.location.pathname);
            Object.assign(win.location, { pathname: u.pathname, search: u.search, hash: u.hash, href: u.href });
            this.state = state;
        },
    };
    win = {
        location: { pathname, search, hash, origin, href: origin + pathname + search + hash },
        history,
        document, localStorage: local, sessionStorage: session, fetch: nativeFetch,
        console: { warn() {}, debug() {}, log() {}, error() {} },
        URL, URLSearchParams, Headers, Response, atob, CustomEvent: FakeCustomEvent,
        setTimeout: (fn, ms) => { timers.push({ fn, ms: ms || 0 }); return timers.length; },
        clearTimeout() {},
    };
    win.window = win;
    if (opts.setup) opts.setup(win);
    document.addEventListener('wo:demo-suggestions-changed', (e) => events.push({ type: e.type, detail: plain(e.detail) }));
    document.addEventListener('wo:assist-changed', (e) => events.push({ type: e.type, detail: plain(e.detail) }));
    vm.createContext(win);
    vm.runInContext(DEMO_SRC, win);
    const h = {
        win, document, local, session, fetchCalls, requested, timers, events, nativeFetch, replaced,
        mirror: () => JSON.parse(local.getItem(MIRROR) || 'null'),
        posts: () => fetchCalls.filter((c) => c.init.method === 'POST').map((c) => ({ url: c.url, body: JSON.parse(c.init.body) })),
        async flush() {
            for (let round = 0; round < 8; round++) {
                await settle();
                const due = timers.splice(0).sort((a, b) => a.ms - b.ms);
                if (!due.length) break;
                due.forEach((t) => t.fn());
            }
            await settle();
        },
        async ready() {
            document.readyState = 'interactive';
            document.dispatchEvent({ type: 'DOMContentLoaded' });
            await h.flush();
        },
    };
    return h;
}

function fakeAssist(active) {
    return {
        boots: [], opened: 0, closed: 0, active: !!active,
        boot(o) { this.boots.push({ start: o.start, userId: o.identity && o.identity.userId }); },
        open() { this.opened += 1; },
        close() { this.closed += 1; },
        refresh() {},
        isActive() { return this.active; },
        state() { return null; },
    };
}

/* ------------------------- decisiones puras ------------------------- */

const I = runDemo({ pathname: '/artist/inbox' }).win.WoDemo._internal;

test('parseFlags: ?tour implica el demo y ?asistido=1 gana sobre demo y tour', () => {
    assert.deepEqual(plain(I.parseFlags('?demo=1')), { demo: true, tour: false, assist: null });
    assert.deepEqual(plain(I.parseFlags('?tour=1')), { demo: true, tour: true, assist: null });
    assert.deepEqual(plain(I.parseFlags('?demo=0&tour=1')), { demo: false, tour: true, assist: null });
    assert.deepEqual(plain(I.parseFlags('?asistido=1&demo=1&tour=1')), { demo: false, tour: false, assist: true });
    assert.deepEqual(plain(I.parseFlags('?asistido=0')), { demo: null, tour: false, assist: false });
    assert.deepEqual(plain(I.parseFlags('?demo=off')), { demo: false, tour: false, assist: null });
    assert.deepEqual(plain(I.parseFlags('')), { demo: null, tour: false, assist: null });
});

test('isDashboardPath reconoce el dashboard con y sin base path', () => {
    for (const [p, base] of [['/artist/dashboard', ''], ['/artist/dashboard/', ''], ['/artist/dashboard/index.html', ''],
        ['/beta/artist/dashboard', ''], ['/beta/artist/dashboard/', '/beta'], ['/preview/abc123/artist/dashboard', '/preview/abc123']]) {
        assert.equal(I.isDashboardPath(p, base), true, p);
    }
    for (const p of ['/artist/account', '/artist/dashboard-old', '/beta/artist/dashboards', '/artist/dashboard/visitors', '/my-quotations', '']) {
        assert.equal(I.isDashboardPath(p, ''), false, p);
    }
});

test('shouldAutoStart: sesión, cuenta de 14 días como máximo, espejo limpio y dashboard', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const s = (days) => ({ user: { id: UID, created_at: new Date(now - days * DAY).toISOString() } });
    const base = { mirror: {}, pathname: '/artist/dashboard', now };
    assert.equal(I.shouldAutoStart({ ...base, session: s(3) }), true);
    assert.equal(I.shouldAutoStart({ ...base, session: s(14) }), true, 'el día 14 todavía cuenta');
    assert.equal(I.shouldAutoStart({ ...base, session: s(15) }), false);
    assert.equal(I.shouldAutoStart({ ...base, session: s(60) }), false);
    assert.equal(I.shouldAutoStart({ ...base, session: null }), false, 'sin sesión');
    assert.equal(I.shouldAutoStart({ ...base, session: { user: { id: UID, created_at: 'no-es-fecha' } } }), false);
    assert.equal(I.shouldAutoStart({ ...base, session: s(3), mirror: { demo_auto_started: true } }), false);
    assert.equal(I.shouldAutoStart({ ...base, session: s(3), pathname: '/my-quotations' }), false);
    assert.equal(I.shouldAutoStart({ ...base, session: s(3), pathname: '/beta/artist/dashboard' }), true);
    assert.equal(I.shouldAutoStart({ ...base, session: s(3), flags: { demo: false } }), false, '?demo=0 manda');
    assert.equal(I.shouldAutoStart({ ...base, session: s(3), flags: { assist: true } }), false, '?asistido=1 manda');
    assert.equal(I.shouldAutoStart({ ...base, session: s(3), mirror: { demo_suggestions: false } }), false, 'sugerencia apagada');
    assert.equal(I.shouldAutoStart({ ...base, session: s(3), mirror: { assisted_active: true } }), false, 'en modo asistido');
});

test('shouldShowSuggestion, shouldSync y assistTarget', () => {
    const base = { enabled: false, mirror: {}, dismissed: false, pathname: '/artist/dashboard' };
    assert.equal(I.shouldShowSuggestion(base), true);
    assert.equal(I.shouldShowSuggestion({ ...base, pathname: '/beta/artist/dashboard' }), true);
    assert.equal(I.shouldShowSuggestion({ ...base, enabled: true }), false, 'con el demo prendido no se sugiere');
    assert.equal(I.shouldShowSuggestion({ ...base, mirror: { demo_suggestions: false } }), false);
    assert.equal(I.shouldShowSuggestion({ ...base, dismissed: true }), false, '"AHORA NO" en esta sesión');
    assert.equal(I.shouldShowSuggestion({ ...base, pathname: '/calendar' }), false);

    assert.equal(I.assistTarget(''), '/artist/account?asistido=1#perfil');
    assert.equal(I.assistTarget('/beta'), '/beta/artist/account?asistido=1#perfil');
    assert.equal(I.joinBase('/beta', '/beta/artist/account'), '/beta/artist/account', 'no duplica el prefijo');

    const now = Date.now();
    const sync = { userId: UID, enabled: false, pathname: '/calendar', now };
    assert.equal(I.shouldSync({ ...sync, userId: null }), false);
    assert.equal(I.shouldSync({ ...sync, enabled: true }), false);
    assert.equal(I.shouldSync({ ...sync, flags: { assist: true } }), false, 'el POST del flag ya trae el estado');
    assert.equal(I.shouldSync({ ...sync, mirror: null }), true, 'sin espejo');
    assert.equal(I.shouldSync({ ...sync, mirror: { synced_at: new Date(now - 60000).toISOString() } }), false, 'espejo fresco');
    assert.equal(I.shouldSync({ ...sync, mirror: { synced_at: new Date(now - 3600000).toISOString() } }), true, 'espejo viejo');
    assert.equal(I.shouldSync({ ...sync, pathname: '/artist/dashboard', mirror: { synced_at: new Date(now).toISOString() } }), true);
    assert.equal(I.shouldSync({ ...sync, mirror: { assisted_active: true, synced_at: new Date(now).toISOString() } }), true);
    assert.deepEqual(plain(I.parseMirror('{"demo_suggestions":false}')), { demo_suggestions: false });
    assert.deepEqual(plain(I.parseMirror('roto')), {});
    assert.equal(I.mirrorKey(UID), MIRROR);
});

test('shouldMarkDemoSeen: una cuenta nueva que ya está en el demo por otro camino', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const created = (days) => new Date(now - days * DAY).toISOString();
    const seen = { enabled: true, autoStarted: false, userId: UID, createdAt: created(3), mirror: {}, now };
    assert.equal(I.shouldMarkDemoSeen(seen), true);
    assert.equal(I.shouldMarkDemoSeen({ ...seen, createdAt: created(14) }), true, 'el día 14 todavía cuenta');
    assert.equal(I.shouldMarkDemoSeen({ ...seen, enabled: false }), false, 'sin demo no hay nada que marcar');
    assert.equal(I.shouldMarkDemoSeen({ ...seen, autoStarted: true }), false, 'el arranque automático ya marca');
    assert.equal(I.shouldMarkDemoSeen({ ...seen, userId: null }), false);
    assert.equal(I.shouldMarkDemoSeen({ ...seen, mirror: { demo_auto_started: true } }), false, 'ya marcada: sin POST de más');
    assert.equal(I.shouldMarkDemoSeen({ ...seen, createdAt: created(15) }), false, 'cuenta vieja');
    assert.equal(I.shouldMarkDemoSeen({ ...seen, createdAt: null }), false);
});

test('withoutParam saca un parámetro sin re-codificar los demás', () => {
    assert.equal(I.withoutParam('?asistido=1', 'asistido'), '');
    assert.equal(I.withoutParam('?asistido', 'asistido'), '');
    assert.equal(I.withoutParam('?ref=mail&asistido=0&utm=a%20b+c', 'asistido'), '?ref=mail&utm=a%20b+c');
    assert.equal(I.withoutParam('?a=1&asistido=1&asistido=0', 'asistido'), '?a=1');
    assert.equal(I.withoutParam('?%61sistido=1&a=1', 'asistido'), '?a=1', 'compara el nombre decodificado');
    assert.equal(I.withoutParam('?asistidos=1', 'asistido'), '?asistidos=1');
    assert.equal(I.withoutParam('', 'asistido'), '');
});

/* ------------------- demo para cuentas nuevas (vm) ------------------- */

test('una cuenta de 3 días prende el demo en el lugar en el dashboard y avisa al servidor', async () => {
    const h = runDemo({
        pathname: '/artist/dashboard', local: sessionFor(3),
        reply: () => ({ status: 200, body: { success: true, onboarding: { demo_suggestions: true, demo_auto_started_at: new Date().toISOString(), assisted: { active: false } } } }),
    });
    assert.equal(h.win.WoDemo.enabled, true);
    assert.ok(h.win.WoDemo.identity.createdAt, 'identity.createdAt sale de la sesión');
    assert.equal(h.session.getItem('wo_demo_mode'), '1');
    assert.deepEqual(JSON.parse(h.session.getItem('wo_tour_state')), { active: true, chapter: 0, step: 0, fresh: true });
    assert.equal(h.mirror().demo_auto_started, true, 'el espejo se marca antes del POST: una recarga no lo repite');
    assert.notEqual(h.win.fetch, h.nativeFetch, 'el parche de fetch quedó instalado');
    assert.equal(h.win.__woDemoFetchInstalled, true);
    assert.ok(h.document.documentElement.classList.contains('wo-demo-on'));
    assert.ok(h.requested.some((src) => src.startsWith('/shared/js/wo-demo-postgrest.js')), 'arranca el emulador sin recargar');
    assert.equal(h.posts().length, 0, 'el POST espera a DOMContentLoaded');

    await h.ready();
    assert.deepEqual(h.posts(), [{ url: '/api/artist/onboarding', body: { demo_auto_started: true } }]);
    assert.equal(h.fetchCalls[0].init.headers.Authorization, 'Bearer tok-3');
    assert.ok(h.document.querySelector('.wo-demo-bar'), 'barra del demo');
    assert.equal(h.document.querySelector('.wo-demo-suggest'), null, 'sin sugerencia con el demo prendido');
});

test('bajo /beta el demo automático también arranca y el POST respeta el base path', async () => {
    const h = runDemo({ pathname: '/beta/artist/dashboard', local: sessionFor(1) });
    assert.equal(h.win.WoDemo.enabled, true);
    assert.ok(h.requested.some((src) => src.startsWith('/beta/shared/js/wo-demo-postgrest.js')));
    await h.ready();
    assert.equal(h.posts()[0].url, '/beta/api/artist/onboarding');
    assert.equal(h.win.WoDemo.appPath('/artist/account'), '/beta/artist/account');
});

test('sin demo automático: cuenta de 60 días, otra página o espejo con demo_auto_started', async () => {
    const old = runDemo({ pathname: '/artist/dashboard', local: sessionFor(60) });
    assert.equal(old.win.WoDemo.enabled, false);
    assert.equal(old.win.fetch, old.nativeFetch, 'sin parche de fetch');
    assert.equal(old.session.getItem('wo_demo_mode'), null);

    const other = runDemo({ pathname: '/my-quotations', local: sessionFor(3) });
    assert.equal(other.win.WoDemo.enabled, false);
    await other.ready();
    assert.equal(other.document.querySelector('.wo-demo-suggest'), null, 'la sugerencia es solo del dashboard');

    const seen = runDemo({ pathname: '/artist/dashboard', local: sessionFor(3, { [MIRROR]: JSON.stringify({ demo_auto_started: true }) }) });
    assert.equal(seen.win.WoDemo.enabled, false);
    assert.equal(seen.session.getItem('wo_tour_state'), null);
});

test('una cuenta nueva que entra al demo por otro camino queda marcada: el demo forzado no vuelve después de salir', async () => {
    // Menú Ö desde el Centro de Cuenta: /artist/dashboard?demo=1&tour=1 (o un link con ?demo=1 en otra página).
    const h = runDemo({ pathname: '/artist/account', search: '?demo=1&tour=1', local: sessionFor(3) });
    assert.equal(h.win.WoDemo.enabled, true);
    assert.equal(h.mirror().demo_auto_started, true, 'el espejo se marca en <head>, como el arranque automático');
    assert.equal(h.posts().length, 0, 'el POST espera a DOMContentLoaded');
    await h.ready();
    assert.deepEqual(h.posts(), [{ url: '/api/artist/onboarding', body: { demo_auto_started: true } }]);

    // Salió con SALIR DEL DEMO y más tarde abre el dashboard sin parámetros.
    const later = runDemo({ pathname: '/artist/dashboard', local: sessionFor(3, { [MIRROR]: h.local.getItem(MIRROR) }) });
    assert.equal(later.win.WoDemo.enabled, false, 'sin demo forzado');
    assert.equal(later.session.getItem('wo_tour_state'), null, 'sin recorrido desde el capítulo 0');

    // Ya marcada, o cuenta vieja: ni marca ni POST de más.
    const marked = runDemo({ pathname: '/calendar', search: '?demo=1', local: sessionFor(3, { [MIRROR]: JSON.stringify({ demo_auto_started: true }) }) });
    await marked.ready();
    assert.equal(marked.posts().length, 0);
    const old = runDemo({ pathname: '/calendar', search: '?demo=1', local: sessionFor(60) });
    await old.ready();
    assert.equal(old.posts().length, 0);
    assert.equal(old.mirror(), null, 'el espejo de una cuenta vieja no se toca');
});

/* ---------------------- sugerencia persistente ---------------------- */

test('con el demo apagado el dashboard muestra la sugerencia en cada visita y "AHORA NO" la oculta por la sesión', async () => {
    const h = runDemo({ pathname: '/artist/dashboard', local: sessionFor(60) });
    await h.ready();
    const card = h.document.querySelector('.wo-demo-suggest');
    assert.ok(card, 'tarjeta .wo-demo-suggest');
    assert.ok(h.requested.some((href) => href.startsWith('/shared/css/wo-onboarding.css')), 'CSS lazy');
    assert.match(card.innerHTML, /Modo demo/);
    assert.match(card.innerHTML, /Probá We Ötzi con datos de ejemplo/);
    assert.match(card.innerHTML, /Podés desactivar esta sugerencia desde el menú Ö\./);
    assert.match(card.innerHTML, /ACTIVAR MODO DEMO →/);
    assert.match(card.innerHTML, /AHORA NO/);
    assert.doesNotMatch(card.innerHTML, /[!¡]/);
    assert.doesNotMatch(card.innerHTML, /wo-btn--accent/, 'el accent queda para la vista');

    card.querySelector('.wo-demo-suggest__later').listeners.click[0]();
    assert.equal(h.session.getItem('wo_demo_suggest_dismissed'), '1');
    assert.equal(h.document.querySelector('.wo-demo-suggest'), null);

    // Otra visita en la misma sesión: sigue oculta. Una sesión nueva: vuelve.
    const again = runDemo({ pathname: '/artist/dashboard', local: sessionFor(60), session: { wo_demo_suggest_dismissed: '1' } });
    await again.ready();
    assert.equal(again.document.querySelector('.wo-demo-suggest'), null);
    const fresh = runDemo({ pathname: '/artist/dashboard', local: sessionFor(60) });
    await fresh.ready();
    assert.ok(fresh.document.querySelector('.wo-demo-suggest'));
});

test('"ACTIVAR MODO DEMO →" prende el demo con el recorrido desde el dashboard', async () => {
    const h = runDemo({ pathname: '/beta/artist/dashboard', local: sessionFor(60) });
    await h.ready();
    h.document.querySelector('.wo-demo-suggest').querySelector('.wo-demo-suggest__go').listeners.click[0]();
    assert.equal(h.session.getItem('wo_demo_mode'), '1');
    assert.equal(JSON.parse(h.session.getItem('wo_tour_state')).fresh, true);
    assert.equal(h.win.location.href, '/beta/artist/dashboard?demo=1&tour=1');
});

test('si el servidor dice demo_suggestions=false la tarjeta se va y el espejo se actualiza', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = runDemo({
        pathname: '/artist/dashboard', local: sessionFor(60),
        reply: async (url, init) => {
            if ((init.method || 'GET') === 'GET') await gate;
            return { status: 200, body: { success: true, onboarding: { demo_suggestions: false, demo_auto_started_at: null, assisted: { active: false } } } };
        },
    });
    await h.ready();
    assert.ok(h.document.querySelector('.wo-demo-suggest'), 'se muestra con el espejo por defecto');
    assert.equal(h.fetchCalls[0].url, '/api/artist/onboarding');
    release();
    await h.flush();
    assert.equal(h.document.querySelector('.wo-demo-suggest'), null);
    assert.equal(h.mirror().demo_suggestions, false);
    assert.ok(h.mirror().synced_at);
    assert.ok(h.events.some((e) => e.type === 'wo:demo-suggestions-changed' && e.detail.enabled === false));
    assert.equal(h.win.WoDemo.suggestionsEnabled(), false);
});

test('setSuggestions guarda en el servidor, actualiza el espejo y avisa con un evento', async () => {
    const h = runDemo({ pathname: '/artist/dashboard', local: sessionFor(60) });
    await h.ready();
    assert.ok(h.document.querySelector('.wo-demo-suggest'));
    assert.equal(h.win.WoDemo.suggestionsEnabled(), true, 'por defecto sugiere');
    const result = await h.win.WoDemo.setSuggestions(false);
    assert.equal(result, false);
    assert.equal(h.win.WoDemo.suggestionsEnabled(), false);
    assert.equal(h.mirror().demo_suggestions, false);
    assert.deepEqual(h.posts().pop(), { url: '/api/artist/onboarding', body: { demo_suggestions: false } });
    assert.deepEqual(h.events.pop(), { type: 'wo:demo-suggestions-changed', detail: { enabled: false } });
    assert.equal(h.document.querySelector('.wo-demo-suggest'), null, 'apagarla desde el menú la saca al instante');
});

// Oct 2026 (revisión): antes el toggle quedaba en el espejo aunque el POST
// fallara y el siguiente GET lo revertía sin aviso. Ahora vuelve atrás y rechaza.
test('si el POST del switch responde 403 el cambio se deshace y setSuggestions rechaza; el GET sigue rechazando con el status', async () => {
    const h = runDemo({ pathname: '/calendar', local: sessionFor(60), reply: () => ({ status: 403, body: { success: false, error: 'Artist profile required' } }) });
    await h.ready();
    await assert.rejects(h.win.WoDemo.setSuggestions(false), (err) => err.status === 403);
    assert.equal(h.win.WoDemo.suggestionsEnabled(), true, 'el espejo vuelve al valor anterior');
    await assert.rejects(h.win.WoDemo.onboarding({ fresh: true }), (err) => err.status === 403);
});

test('si el POST del switch falla, la tarjeta y el espejo vuelven atrás con su evento y la promesa rechaza', async () => {
    const h = runDemo({
        pathname: '/artist/dashboard', local: sessionFor(60),
        reply: (url, init) => (init.method === 'POST'
            ? { status: 500, body: { success: false, error: 'No pudimos guardar tu progreso' } }
            : { status: 200, body: { success: true, onboarding: { demo_suggestions: true, demo_auto_started_at: null, assisted: { active: false } } } }),
    });
    await h.ready();
    assert.ok(h.document.querySelector('.wo-demo-suggest'));
    h.events.length = 0;
    const saving = h.win.WoDemo.setSuggestions(false);
    assert.equal(h.document.querySelector('.wo-demo-suggest'), null, 'el cambio se ve al instante');
    assert.equal(h.mirror().demo_suggestions, false);
    await assert.rejects(saving, (err) => err.status === 500);
    assert.equal(h.mirror().demo_suggestions, true, 'el espejo vuelve al valor anterior');
    assert.equal(h.win.WoDemo.suggestionsEnabled(), true);
    assert.deepEqual(h.events.filter((e) => e.type === 'wo:demo-suggestions-changed').map((e) => e.detail.enabled), [false, true]);
    await h.flush();
    assert.ok(h.document.querySelector('.wo-demo-suggest'), 'la tarjeta vuelve');

    // Dos toggles seguidos que fallan: el fallo del primero (ya superado) no
    // pisa al segundo, y el segundo vuelve al último valor confirmado (true),
    // no al valor sin guardar del primero.
    h.events.length = 0;
    const first = h.win.WoDemo.setSuggestions(false);
    const second = h.win.WoDemo.setSuggestions(true);
    await assert.rejects(first);
    assert.equal(h.mirror().demo_suggestions, true, 'el fallo del primero no pisa al segundo');
    await assert.rejects(second);
    assert.equal(h.mirror().demo_suggestions, true, 'queda en el último valor que guardó el servidor');
    assert.deepEqual(h.events.map((e) => e.detail.enabled), [false, true], 'sin eventos de rollback de más');
});

test('el rollback vuelve al último valor que el servidor confirmó', async () => {
    let fail = false;
    const h = runDemo({
        pathname: '/calendar', local: sessionFor(60, { [MIRROR]: JSON.stringify({ demo_suggestions: true, synced_at: new Date().toISOString() }) }),
        reply: () => (fail ? { status: 500, body: { success: false, error: 'boom' } } : { status: 200, body: { success: true } }),
    });
    await h.ready();
    assert.equal(await h.win.WoDemo.setSuggestions(false), false, 'el primero se guarda');
    fail = true;
    await assert.rejects(h.win.WoDemo.setSuggestions(true));
    assert.equal(h.win.WoDemo.suggestionsEnabled(), false, 'vuelve al false guardado, no al true de antes');
});

/* ------------------------ modo asistido (vm) ------------------------ */

test('?asistido=1 con el demo prendido sale del demo y arranca el modo asistido con datos reales', async () => {
    const assist = fakeAssist(true);
    const h = runDemo({
        pathname: '/artist/account', search: '?asistido=1', local: sessionFor(60),
        session: { wo_demo_mode: '1', wo_demo_store: '{}', wo_tour_state: '{"active":true,"chapter":3}' },
        scripts: { 'wo-tour.js': () => {}, 'wo-assist.js': (w) => { w.WoAssist = assist; } },
        reply: () => ({ status: 200, body: { success: true, onboarding: { demo_suggestions: true, assisted: { active: true } } } }),
    });
    assert.equal(h.win.WoDemo.enabled, false);
    assert.equal(h.session.getItem('wo_demo_mode'), null);
    assert.equal(h.session.getItem('wo_demo_store'), null);
    assert.equal(h.session.getItem('wo_tour_state'), null);
    assert.equal(h.win.fetch, h.nativeFetch, 'la página corre con el fetch real');
    assert.equal(h.mirror().assisted_active, true);

    await h.ready();
    assert.deepEqual(h.posts(), [{ url: '/api/artist/onboarding', body: { assisted: { active: true } } }]);
    const tourAt = h.requested.findIndex((src) => src.startsWith('/shared/js/wo-tour.js'));
    const assistAt = h.requested.findIndex((src) => src.startsWith('/shared/js/wo-assist.js'));
    assert.ok(tourAt !== -1 && assistAt !== -1 && tourAt < assistAt, 'narrador antes del panel');
    assert.ok(h.requested.some((href) => href.startsWith('/shared/css/wo-assist.css')));
    assert.ok(!h.requested.some((src) => src.includes('wo-tour-steps.js')), 'no carga el guion: no hay recorrido');
    assert.deepEqual(assist.boots, [{ start: true, userId: UID }]);
    assert.ok(h.events.some((e) => e.type === 'wo:assist-changed' && e.detail.active === true));
    // El primer onboarding() del panel reusa la respuesta del POST.
    const state = await h.win.WoDemo.onboarding();
    assert.equal(state.onboarding.assisted.active, true);
    assert.equal(h.fetchCalls.length, 1);
});

test('el espejo con assisted_active carga el panel sin start; ?asistido=0 lo apaga sin cargarlo', async () => {
    const assist = fakeAssist(true);
    const on = runDemo({
        pathname: '/calendar', local: sessionFor(60, { [MIRROR]: JSON.stringify({ assisted_active: true, synced_at: new Date().toISOString() }) }),
        scripts: { 'wo-assist.js': (w) => { w.WoAssist = assist; }, 'wo-tour.js': () => {} },
    });
    await on.ready();
    assert.deepEqual(assist.boots, [{ start: false, userId: UID }]);

    const off = runDemo({
        pathname: '/calendar', search: '?asistido=0',
        local: sessionFor(60, { [MIRROR]: JSON.stringify({ assisted_active: true }) }),
    });
    assert.equal(off.mirror().assisted_active, false);
    assert.deepEqual(off.replaced.map((r) => r.url), ['/calendar'], '?asistido=0 también es de un solo uso');
    await off.ready();
    assert.deepEqual(off.posts(), [{ url: '/api/artist/onboarding', body: { assisted: { active: false } } }]);
    assert.ok(!off.requested.some((src) => src.includes('wo-assist')), 'no carga el panel');
});

test('?asistido=1 es de un solo uso: sale de la URL con el hash y el resto de los parámetros, y recargar no lo vuelve a prender', async () => {
    const assist = fakeAssist(true);
    const h = runDemo({
        pathname: '/artist/account', search: '?ref=mail&asistido=1&utm=a%20b', hash: '#perfil', local: sessionFor(60),
        historyState: { keep: 1 },
        scripts: { 'wo-tour.js': () => {}, 'wo-assist.js': (w) => { w.WoAssist = assist; } },
        reply: () => ({ status: 200, body: { success: true, onboarding: { demo_suggestions: true, assisted: { active: true } } } }),
    });
    assert.deepEqual(h.replaced.map((r) => r.url), ['/artist/account?ref=mail&utm=a%20b#perfil'], 'se saca en <head>');
    assert.deepEqual(plain(h.replaced[0].state), { keep: 1 }, 'conserva history.state');
    assert.equal(h.mirror().assisted_active, true);
    await h.ready();
    assert.deepEqual(h.posts(), [{ url: '/api/artist/onboarding', body: { assisted: { active: true } } }], 'el flag ya capturado manda el POST');
    assert.deepEqual(assist.boots, [{ start: true, userId: UID }]);

    // El artista sale (SALIR o × de la bienvenida) y recarga la URL que quedó.
    const reload = runDemo({
        pathname: h.win.location.pathname, search: h.win.location.search, hash: h.win.location.hash,
        local: sessionFor(60, { [MIRROR]: JSON.stringify({ assisted_active: false, synced_at: new Date().toISOString() }) }),
    });
    await reload.ready();
    assert.equal(reload.posts().length, 0, 'sin POST active:true');
    assert.ok(!reload.requested.some((src) => src.includes('wo-assist')), 'el panel no vuelve');
    assert.equal(reload.replaced.length, 0, 'sin el flag no toca la URL');

    // Sin History API la página sigue funcionando con el flag en la URL.
    const legacy = runDemo({ pathname: '/artist/account', search: '?asistido=1', local: sessionFor(60), setup: (w) => { delete w.history; } });
    assert.equal(legacy.mirror().assisted_active, true);
    await legacy.ready();
    assert.deepEqual(legacy.posts().map((p) => p.body), [{ assisted: { active: true } }]);
});

test('si el POST de salida falla, stopAssist restaura el espejo, vuelve a montar el panel y rechaza', async () => {
    const assist = fakeAssist(true);
    const h = runDemo({
        pathname: '/calendar', local: sessionFor(60, { [MIRROR]: JSON.stringify({ assisted_active: true, synced_at: new Date().toISOString() }) }),
        scripts: { 'wo-assist.js': (w) => { w.WoAssist = assist; }, 'wo-tour.js': () => {} },
        reply: (url, init) => (init.method === 'POST'
            ? { status: 503, body: { success: false, error: 'Sin conexión' } }
            : { status: 200, body: { success: true, onboarding: { demo_suggestions: true, assisted: { active: true } } } }),
    });
    await h.ready();
    assert.deepEqual(assist.boots, [{ start: false, userId: UID }]);
    h.events.length = 0;
    const leaving = h.win.WoDemo.stopAssist();
    assert.equal(assist.closed, 1, 'cierra al instante');
    assert.equal(h.mirror().assisted_active, false);
    await assert.rejects(leaving, (err) => err.status === 503);
    assert.equal(h.mirror().assisted_active, true, 'el espejo vuelve a activo');
    assert.deepEqual(h.events.filter((e) => e.type === 'wo:assist-changed').map((e) => e.detail.active), [false, true]);
    assert.deepEqual(assist.boots, [{ start: false, userId: UID }, { start: false, userId: UID }], 'vuelve a montar leyendo el estado real');
});

test('startAssist con el demo prendido sale del demo hacia el Centro de Cuenta; stopAssist lo apaga', async () => {
    const demo = runDemo({ pathname: '/beta/calendar', search: '?demo=1', local: sessionFor(60) });
    assert.equal(demo.win.WoDemo.enabled, true);
    await demo.win.WoDemo.startAssist();
    assert.equal(demo.win.location.href, '/beta/artist/account?asistido=1#perfil');
    assert.equal(demo.session.getItem('wo_demo_mode'), null);
    assert.equal(demo.mirror().assisted_active, true);

    const assist = fakeAssist(true);
    const h = runDemo({ pathname: '/calendar', local: sessionFor(60), scripts: { 'wo-assist.js': (w) => { w.WoAssist = assist; }, 'wo-tour.js': () => {} } });
    await h.ready();
    const started = h.win.WoDemo.startAssist();
    await h.flush();
    await started;
    assert.deepEqual(assist.boots, [{ start: true, userId: UID }]);
    assert.ok(assist.opened >= 1, 'abre el panel');
    assert.deepEqual(h.posts().pop().body, { assisted: { active: true } });

    await h.win.WoDemo.stopAssist();
    assert.equal(assist.closed, 1);
    assert.equal(h.mirror().assisted_active, false);
    assert.deepEqual(h.posts().pop().body, { assisted: { active: false } });
    assert.deepEqual(h.events.filter((e) => e.type === 'wo:assist-changed').pop().detail, { active: false });
});

test('WoDemo.api usa el fetch nativo aunque el parche del demo esté instalado', async () => {
    const h = runDemo({
        pathname: '/calendar', search: '?demo=1', local: sessionFor(60),
        reply: (url) => (url.includes('forbidden') ? { status: 403, body: { success: false, error: 'Artist profile required' } } : { status: 200, body: { success: true, ok: 1 } }),
    });
    assert.equal(h.win.WoDemo.enabled, true);
    const patched = h.win.fetch;
    assert.notEqual(patched, h.nativeFetch);
    let patchedCalls = 0;
    h.win.fetch = function (...args) { patchedCalls += 1; return patched.apply(this, args); };

    const data = await h.win.WoDemo.api('/api/artist/onboarding');
    assert.equal(data.ok, 1);
    assert.equal(patchedCalls, 0, 'nunca pasa por window.fetch');
    assert.equal(h.fetchCalls[0].url, '/api/artist/onboarding');
    assert.equal(h.fetchCalls[0].init.method, 'GET');
    assert.equal(h.fetchCalls[0].init.headers.Authorization, 'Bearer tok-60');

    await h.win.WoDemo.api('/api/artist/onboarding', { method: 'POST', body: { demo_suggestions: true } });
    assert.equal(h.fetchCalls[1].init.headers['Content-Type'], 'application/json');
    assert.equal(h.fetchCalls[1].init.body, '{"demo_suggestions":true}');

    await assert.rejects(h.win.WoDemo.api('/api/forbidden'), (err) => err.status === 403 && /Artist profile required/.test(err.message));
    assert.equal(await h.win.WoDemo.getAccessToken(), 'tok-60');
});

test('un 403 de la sincronización de fondo sella el espejo: un cliente logueado no repite el GET en cada perfil público', async () => {
    const forbidden = () => ({ status: 403, body: { success: false, error: 'Artist profile required' } });
    const first = runDemo({ pathname: '/artist/profile', search: '?artist=laura', local: sessionFor(60), reply: forbidden });
    await first.ready();
    assert.equal(first.fetchCalls.length, 1, 'un GET');
    const stamped = first.mirror();
    assert.ok(stamped && Date.parse(stamped.synced_at) > 0, 'synced_at sellado');
    assert.equal(stamped.assisted_active, undefined, 'no inventa estado');
    assert.equal(stamped.demo_suggestions, undefined);

    const next = runDemo({ pathname: '/artist/profile', search: '?artist=otra', local: sessionFor(60, { [MIRROR]: first.local.getItem(MIRROR) }), reply: forbidden });
    await next.ready();
    assert.equal(next.fetchCalls.length, 0, 'dentro de los 15 minutos no vuelve a pedir');

    // Otros errores (5xx, red) siguen en silencio y sin sellar: se reintenta en la próxima página.
    const flaky = runDemo({ pathname: '/artist/profile', local: sessionFor(60), reply: () => ({ status: 500, body: { success: false, error: 'boom' } }) });
    await flaky.ready();
    assert.equal(flaky.fetchCalls.length, 1);
    assert.equal(flaky.mirror(), null);
});

test('si el emulador del demo falla, ninguna escritura llega al backend real (503) y las lecturas sí', async () => {
    const h = runDemo({
        pathname: '/calendar', search: '?demo=1', local: sessionFor(60),
        // Los scripts cargan pero no registran sus módulos: buildStore falla.
        scripts: { 'wo-demo-postgrest.js': () => {}, 'wo-demo-fixtures.js': () => {} },
    });
    assert.equal(h.win.WoDemo.enabled, true);
    await assert.rejects(h.win.WoDemo.ready);
    const rest = 'https://ref.supabase.co/rest/v1/';
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        const res = await h.win.fetch(rest + 'quotations_db?quote_id=eq.1', { method, body: '{"quote_status":"completed"}' });
        assert.equal(res.status, 503, method);
        const body = await res.json();
        assert.equal(body.code, 'DEMO_UNAVAILABLE');
        assert.match(body.message, /^Modo demo: .*nada se guardó/);
        assert.doesNotMatch(body.message, /[!¡]/);
    }
    const rpc = await h.win.fetch(rest + 'rpc/send_inbox_message', { method: 'POST', body: '{}' });
    assert.equal(rpc.status, 503, 'tampoco las RPC');
    const viaRequest = await h.win.fetch(new Request(rest + 'artists_db?user_id=eq.' + UID, { method: 'PATCH', body: '{}' }));
    assert.equal(viaRequest.status, 503, 'el método también se lee de un Request');
    assert.equal(h.fetchCalls.length, 0, 'nada salió por el fetch nativo');

    const read = await h.win.fetch(rest + 'quotations_db?select=*', { method: 'GET' });
    assert.equal(read.status, 200);
    const head = await h.win.fetch(rest + 'quotations_db?select=*', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.deepEqual(h.fetchCalls.map((c) => c.url), [rest + 'quotations_db?select=*', rest + 'quotations_db?select=*'], 'GET y HEAD caen al backend real');
});

test('sin sesión api() rechaza con 401 sin tocar la red', async () => {
    const h = runDemo({ pathname: '/artist/dashboard' });
    await assert.rejects(h.win.WoDemo.api('/api/artist/onboarding'), (err) => err.status === 401);
    await h.ready();
    assert.equal(h.fetchCalls.length, 0);
});

/* ---------------------------- menú Ö (vm) ---------------------------- */

function runMenu(opts = {}) {
    const hooks = {};
    const document = makeDocument(hooks);
    document.readyState = 'complete';
    const tile = element('span', hooks);
    tile.className = 'wo-o-tile';
    element('div', hooks).appendChild(tile);
    const find = document.querySelector;
    document.querySelector = (sel) => (sel === '.wo-o-tile' ? tile : find(sel));
    const win = {
        document, location: { pathname: opts.pathname || '/artist/dashboard', search: '' }, localStorage: storage(),
        console: { warn() {}, debug() {}, log() {}, error() {} },
        URLSearchParams, CustomEvent: FakeCustomEvent, innerWidth: 1280,
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, addEventListener() {},
        // La sesión nunca resuelve: el menú queda montado con su primer render.
        WeotziData: { getClient: () => ({ auth: { getSession: () => new Promise(() => {}) } }) },
        WoDemo: opts.WoDemo, WoAssist: opts.WoAssist,
    };
    win.window = win;
    vm.createContext(win);
    vm.runInContext(MENU_SRC, win);
    const drop = document.body.children.find((c) => c.className === 'wo-oam-drop');
    const click = (sel) => {
        const ev = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
        const handlers = drop.querySelector(sel).listeners.click || [];
        handlers.forEach((fn) => fn(ev));
        return { ev, handled: handlers.length > 0 };
    };
    const open = () => tile.listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
    return { win, document, drop, click, open };
}

function fakeDemo(enabled) {
    const calls = [];
    const W = {
        enabled, suggest: true, calls, doc: null,
        suggestionsEnabled() { return this.suggest; },
        setSuggestions(next) {
            calls.push(['setSuggestions', next]);
            this.suggest = next;
            this.doc.dispatchEvent(new FakeCustomEvent('wo:demo-suggestions-changed', { detail: { enabled: next } }));
            return Promise.resolve(next);
        },
        startAssist() { calls.push(['startAssist']); return Promise.resolve(null); },
        startTour() { calls.push(['startTour']); return Promise.resolve(); },
        disable(o) { calls.push(['disable', o]); },
    };
    return W;
}

test('menú Ö sin WoDemo (preview local): modo asistido como link plano y sin switch', () => {
    const m = runMenu({ pathname: '/beta/artist/dashboard' });
    const html = m.drop.innerHTML;
    assert.match(html, /<a class="wo-oam-link" id="wo-oam-assist" href="\/beta\/artist\/account\?asistido=1#perfil">/);
    assert.match(html, /data-wo-icon="check-square"/);
    assert.match(html, /Modo asistido · configurá tu perfil/);
    assert.match(html, /id="wo-oam-tour" href="\/beta\/artist\/dashboard\?demo=1&amp;tour=1"/, 'el recorrido siempre está');
    assert.match(html, /Recorrido guiado · modo demo/);
    assert.doesNotMatch(html, /wo-oam-suggest|Sugerir el modo demo/);
    assert.doesNotMatch(html, /Salir del modo demo/);
    assert.equal(m.click('#wo-oam-assist').handled, false, 'navega con el href');
});

test('menú Ö con el demo prendido: recorrido sin navegar, salida del demo y switch que no cierra el menú', () => {
    const W = fakeDemo(true);
    const m = runMenu({ WoDemo: W });
    W.doc = m.document;
    let html = m.drop.innerHTML;
    assert.match(html, /Salir del modo demo/);
    assert.match(html, /id="wo-oam-suggest" role="switch" aria-checked="true"/);
    assert.match(html, /Sugerir el modo demo/);
    assert.match(html, /Modo asistido · configurá tu perfil/);

    m.open();
    assert.equal(m.drop.hidden, false);
    m.drop.querySelector('#wo-oam-suggest').setAttribute('aria-checked', 'true');
    const sw = m.click('#wo-oam-suggest');
    assert.ok(sw.ev.prevented && sw.ev.stopped, 'el click del switch no llega al document');
    assert.deepEqual(W.calls.pop(), ['setSuggestions', false]);
    assert.equal(m.drop.hidden, false, 'el menú queda abierto');
    html = m.drop.innerHTML;
    assert.match(html, /role="switch" aria-checked="false"/, 'se re-renderiza con el evento');

    const tour = m.click('#wo-oam-tour');
    assert.ok(tour.ev.prevented);
    assert.deepEqual(W.calls.pop(), ['startTour']);
    assert.equal(m.drop.hidden, true);

    m.click('#wo-oam-demo-exit');
    assert.equal(W.calls.pop()[0], 'disable');

    m.click('#wo-oam-assist');
    assert.deepEqual(W.calls.pop(), ['startAssist']);
});

test('menú Ö con el modo asistido activo: "ver mis pasos" abre el panel y re-render con wo:assist-changed', () => {
    const W = fakeDemo(false);
    const A = fakeAssist(false);
    const m = runMenu({ WoDemo: W, WoAssist: A });
    W.doc = m.document;
    assert.match(m.drop.innerHTML, /Modo asistido · configurá tu perfil/);
    assert.doesNotMatch(m.drop.innerHTML, /Salir del modo demo/);
    assert.equal(m.click('#wo-oam-tour').handled, false, 'con el demo apagado el recorrido navega');

    A.active = true;
    m.document.dispatchEvent(new FakeCustomEvent('wo:assist-changed', { detail: { active: true } }));
    assert.match(m.drop.innerHTML, /Modo asistido · ver mis pasos/);
    m.click('#wo-oam-assist');
    assert.equal(A.opened, 1);
    assert.equal(W.calls.length, 0, 'no vuelve a arrancar el modo asistido');
});

test('menú Ö: si el servidor no guarda el switch, vuelve al valor anterior y avisa en línea un rato', async () => {
    const W = fakeDemo(false);
    // Como WoDemo.setSuggestions: cambia ya, y si el POST falla vuelve atrás, avisa y rechaza.
    W.setSuggestions = function (next) {
        this.calls.push(['setSuggestions', next]);
        const prev = this.suggest;
        this.suggest = next;
        this.doc.dispatchEvent(new FakeCustomEvent('wo:demo-suggestions-changed', { detail: { enabled: next } }));
        return Promise.resolve().then(() => {
            this.suggest = prev;
            this.doc.dispatchEvent(new FakeCustomEvent('wo:demo-suggestions-changed', { detail: { enabled: prev } }));
            const err = new Error('HTTP 500');
            err.status = 500;
            throw err;
        });
    };
    const m = runMenu({ WoDemo: W });
    W.doc = m.document;
    m.open();
    m.drop.querySelector('#wo-oam-suggest').setAttribute('aria-checked', 'true');
    m.click('#wo-oam-suggest');
    assert.match(m.drop.innerHTML, /id="wo-oam-suggest" role="switch" aria-checked="false"/, 'el cambio se ve al instante');
    assert.doesNotMatch(m.drop.innerHTML, /No pudimos guardar/);
    await settle();
    const html = m.drop.innerHTML;
    assert.match(html, /id="wo-oam-suggest" role="switch" aria-checked="true" aria-describedby="wo-oam-suggest-err"/, 'el switch vuelve a prendido');
    assert.match(html, /<p class="wo-oam-err" id="wo-oam-suggest-err" role="alert">No pudimos guardar el cambio\. Probá de nuevo\.<\/p>/);
    assert.doesNotMatch(html, /[!¡]/);
    assert.equal(m.drop.hidden, false, 'el menú sigue abierto');
    assert.match(MENU_SRC, /\.wo-oam-err\{[^}]*color:var\(--status-error-fg\)/, 'color por token');

    // Probar de nuevo saca el aviso; cerrar el menú también.
    W.setSuggestions = function (next) { this.suggest = next; this.doc.dispatchEvent(new FakeCustomEvent('wo:demo-suggestions-changed', { detail: { enabled: next } })); return Promise.resolve(next); };
    m.drop.querySelector('#wo-oam-suggest').setAttribute('aria-checked', 'true');
    m.click('#wo-oam-suggest');
    await settle();
    assert.doesNotMatch(m.drop.innerHTML, /wo-oam-err|aria-describedby/);
    assert.match(m.drop.innerHTML, /aria-checked="false"/);
});

test('menú Ö: cerrar el menú saca el aviso del switch', async () => {
    const W = fakeDemo(false);
    W.setSuggestions = function () { return Promise.reject(new Error('Sin conexión')); };
    const m = runMenu({ WoDemo: W });
    W.doc = m.document;
    m.open();
    m.click('#wo-oam-suggest');
    await settle();
    assert.match(m.drop.innerHTML, /No pudimos guardar el cambio/);
    m.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(m.drop.hidden, true);
    assert.doesNotMatch(m.drop.innerHTML, /No pudimos guardar el cambio/);
});

test('menú Ö: sus capas quedan sobre el dock del modo asistido y debajo de la bienvenida y del recorrido', () => {
    const zOf = (src, sel) => {
        const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*z-index:\\s*(\\d+)').exec(src);
        assert.ok(m, sel + ' tiene z-index');
        return Number(m[1]);
    };
    const assistCss = read('public/shared/css/wo-assist.css');
    const tourCss = read('public/shared/css/wo-tour.css');
    const dock = Math.max(zOf(assistCss, '.wo-assist'), zOf(assistCss, '.wo-assist-ring'));
    const welcome = zOf(assistCss, '.wo-assist-welcome');
    const tour = zOf(tourCss, '.wo-tour-root');
    const z = {};
    for (const sel of ['.wo-oam-drop', '.wo-oam-scrim', '.wo-oam-panel']) {
        z[sel] = zOf(MENU_SRC, sel);
        assert.ok(z[sel] > dock, sel + ' sobre el dock (' + z[sel] + ' > ' + dock + ')');
        assert.ok(z[sel] < welcome && z[sel] < tour, sel + ' debajo de la bienvenida y del recorrido');
    }
    assert.ok(z['.wo-oam-scrim'] < z['.wo-oam-panel'], 'el velo queda debajo del panel de notificaciones');
    assert.match(MENU_SRC, /'\.wo-oam-drop\[hidden\],\.wo-oam-panel\[hidden\],\.wo-oam-scrim\[hidden\]\{display:none !important\}'/, 'la guarda [hidden] sigue intacta');
});

/* ------------------------------ CSS ------------------------------ */

test('wo-onboarding.css: tokens, mobile primero, bottombar, dock y movimiento reducido', () => {
    const css = read('public/shared/css/wo-onboarding.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin hex');
    assert.doesNotMatch(css, /border-radius\s*:\s*(?!var\(--radius-none\)|0)/, 'radius 0');
    assert.doesNotMatch(css, /@media \(max-width/, 'mobile primero');
    assert.match(css, /body\.wod-body \.wo-demo-suggest\{[^}]*bottom:calc\(var\(--space-16\)/, 'sobre la bottombar de 64 px');
    assert.match(css, /html\.wo-assist-on \.wo-demo-suggest\{display:none\}/);
    assert.match(css, /@media \(min-width:48rem\)\{[\s\S]*left:var\(--space-6\);right:auto/, 'abajo a la izquierda desde 768 px');
    assert.match(css, /prefers-reduced-motion:reduce/);
});

test('wo-onboarding.css: desde 768 px la tarjeta nunca queda debajo del dock del modo asistido', () => {
    const css = read('public/shared/css/wo-onboarding.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const space = {};
    for (const m of read('public/shared/css/ds/tokens.css').matchAll(/--space-(\d+):(\d+)(?:px)?;/g)) space[m[1]] = Number(m[2]);
    const media = css.slice(css.indexOf('@media (min-width:48rem){'));
    assert.match(media, /left:var\(--space-6\);right:auto/, 'la tarjeta arranca en --space-6');
    const capped = /html\.wo-assist-on \.wo-demo-suggest\{\s*width:(min\([^;}]+\));?\s*\}/.exec(media);
    assert.ok(capped, 'ancho propio con el dock montado');
    assert.ok(media.indexOf(capped[0]) > media.indexOf('width:min(360px,calc(100vw - var(--space-12)))'), 'va después del ancho base (misma especificidad)');
    // Geometría del dock que asume la regla (wo-assist.css, desde 768 px).
    assert.match(read('public/shared/css/wo-assist.css'), /\.wo-assist\{left:auto;right:var\(--space-4\);width:min\(380px,calc\(100vw - var\(--space-8\)\)\)/);
    const widthAt = (vw) => Function('return ' + capped[1]
        .replace(/var\(--space-(\d+)\)/g, (_, n) => String(space[n]))
        .replace(/100vw/g, String(vw)).replace(/px/g, '').replace(/calc/g, '').replace(/min/g, 'Math.min'))();
    for (const vw of [768, 780, 799, 800, 1024, 1440]) {
        const width = widthAt(vw);
        const dockLeft = vw - space[4] - Math.min(380, vw - space[8]);
        assert.ok(space[6] + width + space[2] <= dockLeft, vw + ' px: la tarjeta termina antes del dock (' + (space[6] + width) + ' vs ' + dockLeft + ')');
        assert.ok(width >= 320 && width <= 360, vw + ' px: la tarjeta sigue legible (' + width + ' px)');
    }
});
