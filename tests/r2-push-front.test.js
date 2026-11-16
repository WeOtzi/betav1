'use strict';

// Ronda 2 · frente push · front
//   P24: wo-notify.js (toast + sonido + Web Push), service worker wo-sw.js,
//        cargador en config-manager.js y toggles "Push" de la cuenta.
//   P26: destinos exactos de la actividad y de las notificaciones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const FM = require('../public/shared/js/notification-feed-model.js');
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- DOM mínimo
function matches(el, selector) {
    const m = /^([a-z]+)?(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)\])?$/i.exec(selector.trim());
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    const classes = String(el.className || '').split(/\s+/);
    for (const cls of (m[3] || '').split('.').filter(Boolean)) if (!classes.includes(cls)) return false;
    if (m[4] && !(m[4] in el.attributes)) return false;
    return true;
}

class El {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.listeners = {};
        this.className = '';
        this.id = '';
        this.hidden = false;
        this.dataset = {};
        this._text = '';
        this.style = { setProperty(key, value) { this[key] = value; } };
        const self = this;
        this.classList = {
            add(c) { if (!self.className.split(/\s+/).includes(c)) self.className = `${self.className} ${c}`.trim(); },
            remove(c) { self.className = self.className.split(/\s+/).filter(x => x !== c).join(' '); },
            contains(c) { return self.className.split(/\s+/).includes(c); },
            toggle(c, force) { if (force === undefined ? !this.contains(c) : force) this.add(c); else this.remove(c); }
        };
    }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; }
    hasAttribute(key) { return key in this.attributes; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    insertBefore(child, ref) {
        child.parentNode = this;
        const at = ref ? this.children.indexOf(ref) : -1;
        if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
        return child;
    }
    removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; return child; }
    contains(node) { return node === this || this.children.some(c => c.contains && c.contains(node)); }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    emit(type, event = {}) { (this.listeners[type] || []).forEach(fn => fn(event)); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
    get firstChild() { return this.children[0] || null; }
    get offsetParent() { return this.parentNode; }
    getBoundingClientRect() { return { top: 0, bottom: 60, height: 60 }; }
    scrollIntoView() { this.scrolled = true; }
    focus() {}
    all() { return this.children.flatMap(c => (c instanceof El ? [c, ...c.all()] : [])); }
    querySelectorAll(selector) { return this.all().filter(el => selector.split(',').some(s => matches(el, s))); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

// `session` = id del usuario con sesión iniciada (sin él la página corre como vista previa, sin red).
// `local` / `tab` = localStorage / sessionStorage: pasar el mismo Map simula otra carga de página
// en la misma pestaña; un `tab` nuevo, otra pestaña. `server` registra lo que recibe el servidor.
function browser({ pathname = '/client/dashboard', search = '', push = false, permission = 'default', session = null, local = new Map(), tab = new Map(), server = null } = {}) {
    const store = local;
    const api = server || { subscribed: [], tests: 0, testResults: [], failSubscribe: false };
    const head = new El('head');
    const body = new El('body');
    const docListeners = {};
    const events = [];
    const permissionRequests = [];
    const audio = { oscillators: 0 };
    const window = {
        WEOTZI_PREVIEW: !session, // sin sesión de prueba no hay red: no se resuelve la sesión
        // tab: null → sessionStorage bloqueado por el navegador (leerlo lanza).
        sessionStorage: tab
            ? { getItem: k => (tab.has(k) ? tab.get(k) : null), setItem: (k, v) => tab.set(k, String(v)), removeItem: k => tab.delete(k) }
            : { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {} },
        location: { pathname, search, origin: 'https://beta.weotzi.com', href: `https://beta.weotzi.com${pathname}${search}` },
        localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
        history: { state: null, replaced: [], replaceState(state, title, url) { this.replaced.push(url); } },
        matchMedia: () => ({ matches: false }),
        setTimeout: (fn, ms) => { if (!ms || ms <= 10) setImmediate(fn); return 1; },
        clearTimeout: () => {},
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        isSecureContext: push,
        Notification: {
            permission,
            requestPermission() { permissionRequests.push(Date.now()); this.permission = 'granted'; return Promise.resolve('granted'); }
        }
    };
    if (push) window.PushManager = function PushManager() {};
    if (session) {
        window._supabase = { auth: {
            getSession: async () => ({ data: { session: { user: { id: session }, access_token: 'token-de-prueba' } } }),
            onAuthStateChange() {}
        } };
    }
    window.AudioContext = function AudioContext() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
        this.resume = () => Promise.resolve();
        this.createOscillator = () => { audio.oscillators += 1; return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; };
        this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
    };
    const document = {
        readyState: 'complete',
        visibilityState: 'visible',
        head, body,
        documentElement: new El('html'),
        hasFocus: () => true,
        createElement: (tag) => new El(tag),
        createTextNode: (text) => ({ textContent: String(text) }),
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
        dispatchEvent(event) { events.push(event); (docListeners[event.type] || []).forEach(fn => fn(event)); return true; },
        querySelectorAll: (selector) => [...head.querySelectorAll(selector), ...body.querySelectorAll(selector)],
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
    // Las <script> que pide wo-notify.js (capa de datos) "cargan" al instante con dobles.
    const realAppend = head.appendChild.bind(head);
    head.appendChild = (el) => {
        realAppend(el);
        if (el.tagName === 'SCRIPT') {
            if (/postgrest-client\.js$/.test(el.src)) window.WeotziData = { getClient: () => null };
            if (/notifications-repo\.js$/.test(el.src)) {
                window.WeotziData.Notifications = {
                    Push: {
                        config: async () => ({ enabled: true, publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8' }),
                        subscribe: async (token, subscription) => {
                            if (api.failSubscribe) throw new Error('sin red');
                            api.subscribed.push({ token, endpoint: subscription.endpoint });
                            return { success: true };
                        },
                        test: async () => { api.tests += 1; return api.testResults.shift() || { success: true, stored: true, push_enabled: true, devices: 1, delivered: 1 }; },
                        unsubscribe: async () => ({ success: true })
                    },
                    markRead: async () => {}, listRecent: async () => [], subscribe: () => ({}), unsubscribe() {}
                };
            }
            setImmediate(() => el.onload && el.onload());
        }
        return el;
    };
    const navigator = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 };
    if (push) navigator.serviceWorker = { addEventListener() {}, getRegistration: async () => null, register: async () => ({}), ready: new Promise(() => {}) };
    if (push && session) {
        // Navegador ya suscrito: el service worker responde y devuelve la suscripción vigente.
        const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/dispositivo-1', options: {}, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; }, unsubscribe: async () => true };
        const registration = { pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } };
        navigator.serviceWorker = { addEventListener() {}, getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) };
    }
    class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
    const context = vm.createContext({ window, document, navigator, console, URL, URLSearchParams, CustomEvent, Promise, JSON, Date, Math, Uint8Array, Buffer, setImmediate });
    vm.runInContext(read('public', 'shared', 'js', 'wo-notify.js'), context, { filename: 'wo-notify.js' });
    const unlock = () => (docListeners.pointerdown || []).forEach(fn => fn({}));
    return { window, document, body, head, events, permissionRequests, audio, unlock, local, tab, server: api, emit: (type, ev) => (docListeners[type] || []).forEach(fn => fn(ev || {})) };
}

const toasts = (b) => b.body.querySelectorAll('.wo-ntf-toast');

// ---------------------------------------------------------------- P24 · wo-notify.js
test('WoNotify.ping muestra un toast con enlace real al destino, sin interpretar HTML', async () => {
    const b = browser();
    assert.equal(typeof b.window.WoNotify.ping, 'function');
    const shown = b.window.WoNotify.ping({ title: '<img src=x onerror=alert(1)> Mateo te escribió', body: 'Tienes un mensaje <b>nuevo</b>', url: '/client/chats?quote=WO-1', tag: 'chat:WO-1', kind: 'mensajes' });
    assert.equal(shown, true);
    await tick();
    const list = toasts(b);
    assert.equal(list.length, 1);
    const link = list[0].querySelector('.wo-ntf-link');
    assert.equal(link.tagName, 'A', 'el aviso es un enlace real');
    assert.equal(link.href, '/client/chats?quote=WO-1');
    assert.equal(list[0].querySelector('.wo-ntf-title').textContent, '<img src=x onerror=alert(1)> Mateo te escribió');
    assert.equal(list[0].querySelector('.wo-ntf-body').textContent, 'Tienes un mensaje <b>nuevo</b>');
    assert.equal(list[0].getAttribute('role'), 'status');
    const close = list[0].querySelector('.wo-ntf-close');
    assert.equal(close.tagName, 'BUTTON');
    assert.equal(close.getAttribute('aria-label'), 'Cerrar aviso');
    // Evento para que los dashboards refresquen su actividad.
    const event = b.events.find(e => e.type === 'wo:notify');
    assert.equal(event.detail.url, '/client/chats?quote=WO-1');
    assert.equal(event.detail.kind, 'mensajes');
    // El código nunca arma HTML con datos del aviso.
    assert.doesNotMatch(read('public', 'shared', 'js', 'wo-notify.js'), /innerHTML|insertAdjacentHTML|document\.write/);
});

// CF-10: la conversación a la vista se reconoce por ?quote= / ?thread= de la dirección.
test('el aviso de la conversación que ya está en pantalla no muestra toast; el de otra sí', async () => {
    const chat = (id) => ({ title: `Mensaje de ${id}`, url: `/artist/inbox?quote=${id}`, tag: `chat:${id}`, kind: 'mensajes' });
    const b = browser({ pathname: '/artist/inbox', search: '?quote=Q1' });
    assert.equal(b.window.WoNotify.ping(chat('Q1')), true, 'el aviso se procesa igual (evento wo:notify)');
    await tick();
    assert.equal(toasts(b).length, 0, 'Q1 está abierta: sin toast');
    assert.ok(b.events.some(e => e.type === 'wo:notify' && e.detail.tag === 'chat:Q1'));
    b.window.WoNotify.ping(chat('Q2'));
    await tick();
    assert.deepEqual(toasts(b).map(t => t.querySelector('.wo-ntf-title').textContent), ['Mensaje de Q2']);

    // Hilos de inbox: mismo criterio con ?thread=, también en /client/chats.
    const inbox = (id, base) => ({ title: `Inbox ${id}`, url: `${base}?thread=${id}`, tag: `inbox:${id}`, kind: 'mensajes' });
    for (const base of ['/artist/inbox', '/client/chats']) {
        const t = browser({ pathname: base, search: '?thread=th-1' });
        t.window.WoNotify.ping(inbox('th-1', base));
        t.window.WoNotify.ping(inbox('th-2', base));
        await tick();
        assert.deepEqual(toasts(t).map(x => x.querySelector('.wo-ntf-title').textContent), ['Inbox th-2'], base);
    }

    // Sin hilo en la dirección (lista del inbox) o en otra página, el toast se muestra.
    for (const where of [{ pathname: '/artist/inbox' }, { pathname: '/artist/dashboard', search: '?quote=Q1' }]) {
        const other = browser(where);
        other.window.WoNotify.ping(chat('Q1'));
        await tick();
        assert.equal(toasts(other).length, 1, where.pathname);
    }
});

test('un destino que no es una ruta interna de la app nunca se vuelve enlace', async () => {
    for (const url of ['https://evil.example/login', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'client/dashboard', '']) {
        const b = browser();
        b.window.WoNotify.ping({ title: 'Aviso', url });
        await tick();
        const link = toasts(b)[0].querySelector('.wo-ntf-link');
        assert.equal(link.tagName, 'DIV', url);
        assert.equal(link.href, undefined, url);
    }
});

test('respeta el prefijo /beta y no repite el mismo aviso (Realtime + push)', async () => {
    const b = browser({ pathname: '/beta/client/dashboard' });
    const n = { id: '0f0f0f0f-0000-4000-8000-000000000001', title: 'Nueva propuesta', url: '/client/dashboard?quote=WO-1&ver=propuesta' };
    assert.equal(b.window.WoNotify.ping(n), true);
    assert.equal(b.window.WoNotify.ping(n), false, 'mismo id: una sola vez');
    await tick();
    assert.equal(toasts(b).length, 1);
    assert.equal(toasts(b)[0].querySelector('.wo-ntf-link').href, '/beta/client/dashboard?quote=WO-1&ver=propuesta');
    assert.equal(b.window.WoNotify.ping({ title: '   ' }), false, 'sin título no hay aviso');
});

test('como mucho tres avisos a la vista; el más nuevo arriba', async () => {
    const b = browser();
    for (let i = 1; i <= 5; i++) b.window.WoNotify.ping({ title: `Aviso ${i}`, tag: `t${i}` });
    await tick();
    assert.deepEqual(toasts(b).map(t => t.querySelector('.wo-ntf-title').textContent), ['Aviso 5', 'Aviso 4', 'Aviso 3']);
});

test('sonido: solo después de un gesto del usuario y respetando la preferencia', async () => {
    const b = browser();
    b.window.WoNotify.ping({ title: 'Antes del gesto', tag: 'a' });
    await tick();
    assert.equal(b.audio.oscillators, 0, 'sin gesto previo el navegador no deja sonar: no se intenta');
    b.unlock();
    assert.equal(b.window.WoNotify.playSound(), true);
    assert.equal(b.audio.oscillators, 2, 'dos notas cortas');

    const quiet = browser();
    quiet.unlock();
    quiet.window.WoNotify.setSound(false);
    assert.equal(quiet.window.WoNotify.soundEnabled(), false);
    quiet.window.WoNotify.ping({ title: 'En silencio', tag: 'b' });
    await tick();
    assert.equal(quiet.audio.oscillators, 0, 'sonido apagado en este dispositivo');
    assert.equal(toasts(quiet).length, 1, 'el aviso visual igual aparece');
    quiet.window.WoNotify.ping({ title: 'Silencioso', tag: 'c', silent: true });

    const loud = browser();
    loud.unlock();
    loud.window.WoNotify.ping({ title: 'Con sonido', tag: 'd' });
    await tick();
    assert.equal(loud.audio.oscillators, 2);
    loud.window.WoNotify.ping({ title: 'Pidió silencio', tag: 'e', silent: true });
    await tick();
    assert.equal(loud.audio.oscillators, 2, 'silent:true no suena');
});

test('el permiso de notificaciones se pide SOLO desde "Activar avisos", nunca al cargar', async () => {
    const b = browser({ push: true });
    const host = new El('div');
    host.setAttribute('data-wo-notify-settings', '');
    b.body.appendChild(host);
    b.window.WoNotify.mountSettings(host);
    await tick(30);
    assert.equal(b.permissionRequests.length, 0, 'cargar la página y pintar la tarjeta no pide permiso');

    const card = host.querySelector('.wo-ntf-card');
    assert.ok(card);
    assert.equal(card.querySelector('.wo-ntf-card-title').textContent, 'Avisos en este dispositivo');
    const buttons = card.querySelectorAll('button');
    const enable = buttons.find(btn => btn.textContent === 'Activar avisos');
    assert.ok(enable, 'botón claro "Activar avisos"');
    assert.equal(enable.hidden, false);
    assert.equal(buttons.find(btn => btn.textContent === 'Desactivar en este dispositivo').hidden, true);
    const sound = card.querySelector('input');
    assert.equal(sound.type, 'checkbox');
    assert.equal(sound.checked, true);

    enable.emit('click');
    await tick(30);
    assert.equal(b.permissionRequests.length, 1, 'el click del usuario dispara el pedido de permiso');
    assert.equal(b.window.WoNotify.mountSettings(host), null, 'la tarjeta no se monta dos veces');

    // En el código, requestPermission vive solo dentro de enablePush().
    const src = read('public', 'shared', 'js', 'wo-notify.js');
    const enableFn = src.slice(src.indexOf('function enablePush()'), src.indexOf('function disablePush()'));
    assert.equal(src.split('requestPermission(').length - 1, enableFn.split('requestPermission(').length - 1);
    assert.doesNotMatch(src.slice(src.indexOf('function syncPush('), src.indexOf('function enablePush()')), /requestPermission/);
});

// CF-11: la matriz de la cuenta emite 'wo:notif-pref-changed' al guardar un toggle; antes nadie
// lo escuchaba y "Push" quedaba encendido sin ningún dispositivo suscripto.
test('CF-11: prender un toggle "Push" de la matriz suscribe este dispositivo; email o apagar, no', async () => {
    const USER = '11111111-1111-4111-8111-111111111111';
    const change = (b, detail) => b.document.dispatchEvent({ type: 'wo:notif-pref-changed', detail: Object.assign({ role: 'client', kind: 'mensajes' }, detail) });
    const titles = (b) => toasts(b).map(t => t.textContent);

    const b = browser({ push: true, session: USER, pathname: '/client/profile' });
    await tick(40);
    assert.equal(b.permissionRequests.length, 0, 'cargar la página no pide permiso');
    change(b, { channel: 'email', value: true });
    change(b, { channel: 'push', value: false });
    change(b, { channel: 'sms', value: true });
    await tick(40);
    assert.equal(b.permissionRequests.length, 0, 'solo cuenta prender Push');
    assert.equal(b.server.subscribed.length, 0);

    change(b, { channel: 'push', value: true });
    await tick(60);
    assert.equal(b.permissionRequests.length, 1, 'el clic sobre el toggle dispara el pedido de permiso');
    assert.equal(b.server.subscribed.length, 1, 'y el dispositivo queda registrado en el servidor');
    assert.equal((await b.window.WoNotify.status()).subscribed, true);
    assert.ok(titles(b).some(t => /Avisos activados/.test(t)));

    change(b, { kind: 'cotizaciones', channel: 'push', value: true });
    await tick(60);
    assert.equal(b.permissionRequests.length, 1, 'con el dispositivo ya suscripto no se repite');
    assert.equal(b.server.subscribed.length, 1);

    // Permiso bloqueado en el navegador: no se pide de nuevo, se explica.
    const denied = browser({ push: true, session: USER, permission: 'denied', pathname: '/client/profile' });
    await tick(40);
    change(denied, { channel: 'push', value: true });
    await tick(60);
    assert.equal(denied.permissionRequests.length, 0);
    assert.equal(denied.server.subscribed.length, 0);
    assert.ok(titles(denied).some(t => /El navegador bloqueó los avisos/.test(t)));

    // "Desactivar en este dispositivo" es una elección de la persona: el toggle no la pisa.
    const off = browser({ push: true, session: USER, permission: 'granted', pathname: '/client/profile', local: new Map([['wo_notify_push_off', '1']]) });
    await tick(40);
    change(off, { channel: 'push', value: true });
    await tick(60);
    assert.equal(off.permissionRequests.length, 0);
    assert.equal(off.server.subscribed.length, 0);
    assert.equal(off.local.get('wo_notify_push_off'), '1');
    assert.ok(titles(off).some(t => /apagados en este dispositivo/.test(t)));

    // Sin soporte de push o sin sesión no hay nada que suscribir.
    const unsupported = browser({ push: false, session: USER, pathname: '/client/profile' });
    await tick(40);
    change(unsupported, { channel: 'push', value: true });
    await tick(60);
    assert.equal(unsupported.permissionRequests.length, 0);
    const anon = browser({ push: true, pathname: '/client/profile' });
    change(anon, { channel: 'push', value: true });
    await tick(60);
    assert.equal(anon.permissionRequests.length, 0);

    // El emisor sigue siendo la matriz del cliente, después de guardar.
    assert.match(read('public', 'shared', 'js', 'client-profile.js'), /new CustomEvent\('wo:notif-pref-changed', \{\s*detail: \{ role: 'client', kind, channel, value \}/);
});

test('CF-11: el registro del cliente ya no dice que el push es "Próximamente" ni lo guarda apagado', () => {
    const html = read('public', 'client', 'register', 'index.html');
    assert.match(html, /<input type="checkbox" id="cw-notif-push" checked>/);
    assert.doesNotMatch(html, /Próximamente|próximamente/);
    assert.doesNotMatch(html, /push: false, \/\/ sin backend de push/);
    assert.match(html, /bindToggle\('cw-notif-push', 'notifPush'\);/);
    // Apagado se guarda por evento (formato de la matriz); prendido no escribe la clave.
    assert.match(html, /if \(state\.notifPush === false\) \{\s*\['postulaciones', 'mensajes', 'cotizaciones'\]\.forEach\(function \(kind\) \{ notifPrefs\[kind\] = \{ push: false \}; \}\);/);
    const prefs = require('../lib/notification-prefs');
    assert.deepEqual(Object.keys(prefs.CLIENT_NOTIF_DEFAULTS), ['postulaciones', 'mensajes', 'cotizaciones']);
    const client = { defaults: prefs.CLIENT_NOTIF_DEFAULTS };
    assert.equal(prefs.resolvePreference({ email_updates: true }, 'mensajes', 'push', client), true, 'sin la clave vale el valor por defecto');
    assert.equal(prefs.resolvePreference({ mensajes: { push: false } }, 'mensajes', 'push', client), false);
    assert.equal(prefs.resolvePreference({ mensajes: { push: false } }, 'mensajes', 'email', client), true, 'apagar push no toca el email');
    // El formato plano viejo (push:false fijo de todos los registros anteriores) no apaga nada.
    assert.equal(prefs.resolvePreference({ push: false }, 'cotizaciones', 'push', client), true);
});

// EP-04: si el servidor perdió la suscripción, el navegador la repone al próximo ingreso
// (antes esperaba 3 días, con la tarjeta diciendo que los avisos seguían activos).
test('la suscripción se reenvía una vez por pestaña aunque el marcador de 3 días esté vigente', async () => {
    const USER = '11111111-1111-4111-8111-111111111111';
    const open = (extra) => browser(Object.assign({ push: true, permission: 'granted', session: USER }, extra));

    const first = open();
    await tick(40);
    assert.equal(first.server.subscribed.length, 1, 'primer ingreso: la suscripción llega al servidor');
    assert.equal(first.server.subscribed[0].endpoint, 'https://fcm.googleapis.com/fcm/send/dispositivo-1');
    assert.equal((await first.window.WoNotify.status()).subscribed, true);
    const marker = JSON.parse(first.local.get('wo_notify_sync_v1'));
    assert.ok(marker.m && Date.now() - marker.t < 5000, 'queda el marcador de 3 días');

    // Otra página en la MISMA pestaña: no se repite el envío.
    const samePage = open({ local: first.local, tab: first.tab, server: first.server });
    await tick(40);
    assert.equal(first.server.subscribed.length, 1, 'navegar dentro de la pestaña no reenvía');
    assert.equal((await samePage.window.WoNotify.status()).subscribed, true);

    // Pestaña NUEVA con el marcador vigente: se reenvía (repara un borrado del lado del servidor).
    const newTab = open({ local: first.local, server: first.server });
    await tick(40);
    assert.equal(first.server.subscribed.length, 2, 'una pestaña nueva vuelve a registrar el dispositivo');
    assert.equal((await newTab.window.WoNotify.status()).subscribed, true);
    const again = open({ local: first.local, tab: newTab.tab, server: first.server });
    await tick(40);
    assert.equal(first.server.subscribed.length, 2, 'y después no insiste en esa pestaña');
    assert.equal((await again.window.WoNotify.status()).subscribed, true);

    // Sin red en ese reenvío de rutina: el push sigue activo (el servidor ya conocía el dispositivo)
    // y se reintenta en la próxima carga.
    const offline = open({ local: first.local, server: Object.assign(first.server, { failSubscribe: true }) });
    await tick(40);
    assert.equal((await offline.window.WoNotify.status()).subscribed, true);
    assert.equal(first.server.subscribed.length, 2);
    first.server.failSubscribe = false;
    open({ local: first.local, tab: offline.tab, server: first.server });
    await tick(40);
    assert.equal(first.server.subscribed.length, 3, 'la carga siguiente lo consigue');

    // Sin sessionStorage (bloqueado) queda la regla de los 3 días: no se reenvía en cada carga.
    const blocked = open({ local: first.local, tab: null, server: first.server });
    await tick(40);
    assert.equal(first.server.subscribed.length, 3, 'sin sessionStorage no reenvía en cada carga');
    assert.equal((await blocked.window.WoNotify.status()).subscribed, true);
});

test('"Probar": si el servidor no tiene ningún dispositivo de la cuenta, se registra otra vez y se repite la prueba', async () => {
    const USER = '11111111-1111-4111-8111-111111111111';
    const b = browser({ push: true, permission: 'granted', session: USER, pathname: '/client/profile' });
    const host = new El('div');
    b.body.appendChild(host);
    b.window.WoNotify.mountSettings(host);
    await tick(40);
    assert.equal(b.server.subscribed.length, 1);
    const testButton = host.querySelectorAll('button').find(btn => /prob/i.test(btn.textContent));
    assert.ok(testButton, 'la tarjeta tiene el botón de prueba');

    // El servidor perdió la suscripción: push encendido, cero dispositivos.
    b.server.testResults.push({ success: true, stored: true, push_enabled: true, devices: 0, delivered: 0 });
    testButton.emit('click');
    await tick(60);
    assert.equal(b.server.subscribed.length, 2, 'vuelve a registrar el dispositivo');
    assert.equal(b.server.tests, 2, 'y repite la prueba una sola vez');
    assert.match(host.querySelector('.wo-ntf-card').textContent, /enviamos un aviso de prueba a este dispositivo/);

    // Caso normal: una sola llamada, sin reenvío.
    testButton.emit('click');
    await tick(60);
    assert.equal(b.server.tests, 3);
    assert.equal(b.server.subscribed.length, 2);

    // Con el push apagado en el servidor (sin claves) no hay nada que reponer.
    b.server.testResults.push({ success: true, stored: true, push_enabled: false, devices: 0, delivered: 0 });
    testButton.emit('click');
    await tick(60);
    assert.equal(b.server.tests, 4);
    assert.equal(b.server.subscribed.length, 2);
});

test('sin soporte de push la tarjeta lo explica y no ofrece el botón', async () => {
    const b = browser({ push: false });
    delete b.window.Notification;
    const host = new El('div');
    b.body.appendChild(host);
    b.window.WoNotify.mountSettings(host);
    await tick(30);
    const card = host.querySelector('.wo-ntf-card');
    assert.match(card.querySelector('.wo-ntf-card-status').textContent, /no admite avisos push/);
    assert.match(card.querySelector('.wo-ntf-card-help').textContent, /verás los avisos dentro de la app/);
    assert.equal(card.querySelectorAll('button').find(btn => btn.textContent === 'Activar avisos').hidden, true);
    assert.deepEqual(JSON.parse(JSON.stringify(await b.window.WoNotify.enablePush())), { ok: false, reason: 'unsupported' });
});

test('llegada: ?ver=<zona> resalta el bloque y consume el parámetro', async () => {
    const b0 = browser();
    // Todas las zonas del modelo tienen selectores en wo-notify.js.
    assert.deepEqual(Object.keys(b0.window.WoNotify.ARRIVAL_TARGETS).sort(), [...FM.FOCUS_ZONES].sort());
    assert.equal(b0.window.WoNotify.focusArrival('zona-inventada'), false);

    const chat = new El('section');
    chat.className = 'qd-messages';
    b0.body.appendChild(chat);
    assert.equal(b0.window.WoNotify.focusArrival('chat'), true);
    await tick();
    assert.ok(chat.classList.contains('wo-arrival-flash'));
    assert.equal(chat.scrolled, true);

    // Al cargar con ?ver= y ?wo_n=, la URL queda limpia (recargar no vuelve a resaltar).
    const source = read('public', 'shared', 'js', 'wo-notify.js');
    assert.match(source, /url\.searchParams\.delete\('ver'\)/);
    assert.match(source, /url\.searchParams\.delete\('wo_n'\)/);
    const b1 = browser({ pathname: '/client/dashboard', search: '?quote=WO-1&ver=propuesta&wo_n=0f0f0f0f-0000-4000-8000-000000000001' });
    assert.deepEqual(b1.window.history.replaced, ['/client/dashboard?quote=WO-1']);
    // El aviso que se abrió desde la notificación del sistema no se repite como toast.
    assert.equal(b1.window.WoNotify.ping({ id: '0f0f0f0f-0000-4000-8000-000000000001', title: 'Ya visto' }), false);
});

test('textos nuevos de la interfaz en español neutro (tuteo, sin voseo)', () => {
    const voseo = /\b(tenés|querés|podés|sabés|hacé|probá|activá|activalos|iniciá|ingresá|revisá|respondé|elegí|mirá|volvé|permití|agregá|intentá|esperá|contanos|escribinos|avisanos|enterate|recibí|vas a)\b/i;
    const notify = read('public', 'shared', 'js', 'wo-notify.js');
    const strings = [...notify.matchAll(/'([^'\n]{14,})'/g)].map(m => m[1]).join('\n');
    assert.doesNotMatch(strings, voseo);
    for (const copy of ['Activar avisos', 'Probar aviso', 'Desactivar en este dispositivo', 'Sonido al recibir un aviso', 'Avisos en este dispositivo', 'Ahora no']) {
        assert.ok(notify.includes(`'${copy}'`), copy);
    }
    assert.match(notify, /Actívalos para enterarte al instante/);
    assert.match(read('public', 'artist', 'account', 'index.html'), /Push son los avisos dentro de We Ötzi y en tus dispositivos con los avisos activados\./);
    assert.match(read('public', 'client', 'profile', 'index.html'), /Los avisos push llegan a los dispositivos en los que actives las notificaciones de We Ötzi\./);
});

// ---------------------------------------------------------------- P24 · cargador y cuenta
test('config-manager.js inyecta wo-notify.js una sola vez desde /shared/ (con o sin /beta)', () => {
    const src = read('public', 'shared', 'js', 'config-manager.js');
    const start = src.indexOf('// Avisos push / in-app (frente push)');
    const block = src.slice(src.indexOf('(function () {', start), src.indexOf('})();', start) + 5);
    assert.ok(start > 0 && block.includes('wo-notify.js'));

    function run(scriptSrc, { off = false, already = false } = {}) {
        const added = [];
        const window = already ? { __woNotifyLoader: true } : {};
        const document = {
            currentScript: scriptSrc ? { src: scriptSrc } : null,
            documentElement: { getAttribute: (name) => (off && name === 'data-wo-notify' ? 'off' : null) },
            head: { appendChild: (el) => added.push(el) },
            createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } })
        };
        vm.runInNewContext(block, { window, document });
        return added;
    }
    const added = run('https://beta.weotzi.com/shared/js/config-manager.js?v=20261116');
    assert.equal(added.length, 1);
    assert.equal(added[0].tag, 'script');
    assert.equal(added[0].src, 'https://beta.weotzi.com/shared/js/wo-notify.js');
    assert.equal(added[0].defer, true);
    assert.ok('data-wo-notify' in added[0].attrs, 'wo-notify.js se ubica a sí mismo con este atributo');
    assert.equal(run('https://x.example/beta/shared/js/config-manager.js')[0].src, 'https://x.example/beta/shared/js/wo-notify.js');
    assert.equal(run(null).length, 0, 'sin currentScript (tests, bundles) no hace nada');
    assert.equal(run('https://beta.weotzi.com/shared/js/config-manager.js', { off: true }).length, 0, 'opt-out por página');
    assert.equal(run('https://beta.weotzi.com/shared/js/config-manager.js', { already: true }).length, 0);

    // Ningún HTML se tocó a mano para cargarlo.
    for (const page of [['public', 'client', 'dashboard', 'index.html'], ['public', 'artist', 'dashboard', 'index.html'], ['public', 'artist', 'inbox', 'index.html']]) {
        assert.doesNotMatch(read(...page), /wo-notify\.js/);
    }
});

test('los toggles "Push" de la matriz funcionan en la cuenta del artista y del cliente', () => {
    const artist = read('public', 'shared', 'js', 'artist-account.js');
    assert.match(artist, /const soon = \(channel\) => channel === 'sms';/, 'solo SMS sigue deshabilitado');
    assert.doesNotMatch(artist, /channel === 'push' \|\| channel === 'sms'/);
    assert.match(artist, /await savePrefs\('notification_prefs', notifMatrix\)/);
    const artistHtml = read('public', 'artist', 'account', 'index.html');
    assert.match(artistHtml, /<div data-wo-notify-settings><\/div>\s*<div class="aac-matrix-head"/);
    assert.doesNotMatch(artistHtml, /avisos por push y SMS llegan próximamente/);

    const clientHtml = read('public', 'client', 'profile', 'index.html');
    assert.match(clientHtml, /<div data-wo-notify-settings><\/div>/);
    for (const key of ['postulaciones', 'mensajes', 'cotizaciones']) {
        // La matriz del cliente la pinta client-profile.js (frente cliente-panel): el HTML trae el
        // esqueleto deshabilitado hasta que llegan las preferencias y los defaults del servidor.
        assert.ok(new RegExp(`<input type="checkbox" data-notif="${key}" data-channel="push"[^>]*aria-label="[^"]+ por push">`).test(clientHtml), key);
    }
    assert.doesNotMatch(clientHtml, /próximamente|Próximamente|cpa-soon"/);
    const client = read('public', 'shared', 'js', 'client-profile.js');
    assert.ok(client.includes('Notif.matrix(localNotif, notifDefaults)'));
    assert.ok(client.includes('Notif.patchFor(localNotif, kind, channel, value)'));
    const NotifModel = require('../public/shared/js/client-notif-model.js');
    // Sin preferencia guardada el push se ve encendido (igual que CLIENT_NOTIF_DEFAULTS del servidor).
    assert.equal(NotifModel.matrix({}, NotifModel.normalizeDefaults(null)).every((row) => row.push === true), true);
    assert.deepEqual(NotifModel.patchFor({}, 'mensajes', 'email', false), { mensajes: { email: false } }, 'tocar email no escribe push');
    assert.doesNotMatch(client, /push: prev\[eventKey\]\?\.push === true/, 'ya no se guarda push:false sin que el cliente lo elija');
});

// ---------------------------------------------------------------- P24 · service worker
const UA_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA_SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
// App instalada en iPhone: WebKit sin "Safari" ni "Version" en el user agent.
const UA_IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
function serviceWorker({ scope = 'https://beta.weotzi.com/', windows = [], assetOk = false, userAgent = UA_CHROME, getNotifications = true } = {}) {
    const listeners = {};
    const shown = [];
    const closed = [];
    const opened = [];
    const fetched = [];
    const timers = [];
    const self = {
        navigator: userAgent === null ? undefined : { userAgent },
        registration: { scope, showNotification: async (title, options) => { shown.push({ title, options }); }, pushManager: { subscribe: async () => null } },
        clients: { matchAll: async () => windows, openWindow: async (url) => { opened.push(url); }, claim: async () => {} },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        skipWaiting() {}
    };
    // Las notificaciones a la vista, por etiqueta (lo que devuelve el navegador).
    if (getNotifications) {
        self.registration.getNotifications = async ({ tag } = {}) => shown
            .filter((n) => !closed.includes(n) && (!tag || n.options.tag === tag))
            .map((n) => ({ tag: n.options.tag, close() { closed.push(n); } }));
    }
    const context = { self, URL, Promise, JSON, Date, Number, String, console,
        setTimeout: (fn, ms) => { timers.push(ms); setImmediate(fn); return timers.length; },
        fetch: async (url, opts) => { fetched.push({ url, opts }); return { ok: assetOk }; } };
    vm.runInNewContext(read('public', 'wo-sw.js'), context, { filename: 'wo-sw.js' });
    async function fire(type, event) {
        let pending = Promise.resolve();
        listeners[type]({ ...event, waitUntil(p) { pending = Promise.resolve(p); } });
        await pending;
    }
    const push = (data) => fire('push', { data: { json: () => data, text: () => JSON.stringify(data) } });
    return { listeners, shown, closed, timers, opened, fetched, fire, push };
}
const windowClient = (extra = {}) => {
    const posted = [];
    return { url: 'https://beta.weotzi.com/client/dashboard', visibilityState: 'visible', focused: true, posted, postMessage: (m) => posted.push(m), focus: async function () { this.wasFocused = true; }, ...extra };
};

test('service worker: con la app cerrada muestra la notificación del sistema', async () => {
    const sw = serviceWorker();
    assert.deepEqual(Object.keys(sw.listeners).sort(), ['activate', 'install', 'notificationclick', 'push', 'pushsubscriptionchange']);
    assert.equal(sw.listeners.fetch, undefined, 'no intercepta la red ni cachea nada');
    await sw.push({ id: '0f0f0f0f-0000-4000-8000-000000000001', title: 'Mateo te escribió', body: 'Tienes un mensaje nuevo', url: '/client/chats?quote=WO-1', tag: 'chat:WO-1', kind: 'mensajes' });
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].title, 'Mateo te escribió');
    assert.equal(sw.shown[0].options.body, 'Tienes un mensaje nuevo');
    assert.equal(sw.shown[0].options.tag, 'chat:WO-1');
    assert.equal(sw.shown[0].options.renotify, true);
    assert.deepEqual({ ...sw.shown[0].options.data }, { url: '/client/chats?quote=WO-1', id: '0f0f0f0f-0000-4000-8000-000000000001' });
    assert.equal(sw.shown[0].options.icon, undefined, 'si el ícono todavía no existe, el aviso sale sin él');

    const withIcon = serviceWorker({ assetOk: true });
    await withIcon.push({ title: 'Hola' });
    assert.equal(withIcon.shown[0].options.icon, 'https://beta.weotzi.com/shared/assets/ronda2/push/icon-192.webp');
    assert.equal(withIcon.shown[0].options.badge, 'https://beta.weotzi.com/shared/assets/ronda2/push/badge-96.webp');

    // Un push vacío o con un destino externo nunca abre otra cosa que la app.
    const odd = serviceWorker();
    await odd.push({ url: 'https://evil.example/x' });
    assert.equal(odd.shown[0].title, 'We Ötzi');
    assert.equal(odd.shown[0].options.data.url, '/');
});

test('service worker: con la app a la vista el aviso va a la página (toast) y no duplica', async () => {
    const focused = windowClient();
    const sw = serviceWorker({ windows: [focused, windowClient({ visibilityState: 'hidden', focused: false })] });
    await sw.push({ title: 'Nueva propuesta', url: '/client/dashboard?quote=WO-1' });
    assert.equal(sw.shown.length, 0, 'con foco en la app no hay notificación del sistema');
    assert.equal(sw.timers.length, 0);
    assert.equal(focused.posted.length, 1);
    assert.equal(focused.posted[0].type, 'wo-push');
    assert.equal(focused.posted[0].shown, false);
    assert.equal(focused.posted[0].notification.title, 'Nueva propuesta');
    // Firefox y un service worker sin navigator se comportan igual que Chrome.
    for (const userAgent of ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', null]) {
        const other = serviceWorker({ windows: [windowClient()], userAgent });
        await other.push({ title: 'Nueva propuesta' });
        assert.equal(other.shown.length, 0, String(userAgent));
    }

    // Visible pero sin foco (otra app encima): notificación del sistema + toast sin sonido.
    const visible = windowClient({ focused: false });
    const sw2 = serviceWorker({ windows: [visible] });
    await sw2.push({ title: 'Nueva propuesta' });
    assert.equal(sw2.shown.length, 1);
    assert.equal(visible.posted[0].shown, true);
    assert.match(read('public', 'shared', 'js', 'wo-notify.js'), /data\.type === 'wo-push'\) present\(data\.notification, \{ shown: data\.shown === true \}\)/);
});

// EP-07: WebKit revoca la suscripción a los tres push sin notificación visible
// (userVisibleOnly). Con la app en foco no se mostraba ninguna.
test('EP-07: en Safari el push con la app en foco también muestra la notificación, muda, y la retira', async () => {
    for (const userAgent of [UA_SAFARI_MAC, UA_IOS_APP]) {
        const focused = windowClient();
        const sw = serviceWorker({ windows: [focused], userAgent });
        await sw.push({ id: '0f0f0f0f-0000-4000-8000-000000000002', title: 'Mateo te escribió', body: 'Hola', url: '/client/chats?quote=WO-1', tag: 'chat:WO-1' });
        assert.equal(sw.shown.length, 1, 'la notificación del sistema sale igual');
        assert.equal(sw.shown[0].title, 'Mateo te escribió');
        assert.equal(sw.shown[0].options.silent, true, 'muda: el sonido lo pone la página');
        assert.equal(sw.shown[0].options.renotify, false);
        assert.equal(sw.shown[0].options.tag, 'chat:WO-1');
        assert.deepEqual({ ...sw.shown[0].options.data }, { url: '/client/chats?quote=WO-1', id: '0f0f0f0f-0000-4000-8000-000000000002' });
        assert.deepEqual(sw.timers, [4000], 'se retira sola a los 4 s, dentro de waitUntil');
        assert.equal(sw.closed.length, 1);
        // La página conserva su toast y su sonido.
        assert.equal(focused.posted.length, 1);
        assert.equal(focused.posted[0].shown, false);

        // Cuatro mensajes seguidos con foco: cuatro notificaciones (ninguna silenciosa para WebKit).
        for (let i = 0; i < 3; i += 1) await sw.push({ title: 'Otro mensaje', tag: 'chat:WO-1' });
        assert.equal(sw.shown.length, 4);
        assert.equal(sw.closed.length, 4);

        // Sin etiqueta se usa una propia para poder retirarla; no toca otras notificaciones.
        const untagged = serviceWorker({ windows: [windowClient()], userAgent });
        await untagged.push({ id: 'abc', title: 'Sin etiqueta' });
        assert.equal(untagged.shown[0].options.tag, 'wo-focus:abc');
        assert.equal(untagged.closed.length, 1);

        // Sin foco (app cerrada o de fondo) Safari se comporta como el resto: con sonido y sin retirarla.
        const away = serviceWorker({ windows: [windowClient({ focused: false })], userAgent });
        await away.push({ title: 'Nueva propuesta', tag: 'quote:1' });
        assert.equal(away.shown.length, 1);
        assert.equal(away.shown[0].options.silent, undefined);
        assert.equal(away.shown[0].options.renotify, true);
        assert.equal(away.timers.length, 0);
        assert.equal(away.closed.length, 0);

        // Un WebKit sin getNotifications muestra igual la notificación (no se puede retirar).
        const old = serviceWorker({ windows: [windowClient()], userAgent, getNotifications: false });
        await old.push({ title: 'Hola' });
        assert.equal(old.shown.length, 1);
    }
    // Chrome en iPhone también es WebKit; Chrome, Edge y Android no.
    const ios = serviceWorker({ windows: [windowClient()], userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1' });
    await ios.push({ title: 'Hola' });
    assert.equal(ios.shown.length, 1);
    for (const userAgent of [UA_CHROME,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36']) {
        const other = serviceWorker({ windows: [windowClient()], userAgent });
        await other.push({ title: 'Hola' });
        assert.equal(other.shown.length, 0, userAgent);
    }
});

test('service worker: tocar la notificación abre el destino exacto dentro de la app', async () => {
    const click = (sw, data) => sw.fire('notificationclick', { notification: { close() { this.closed = true; }, data } });
    const sw = serviceWorker();
    await click(sw, { url: '/client/dashboard?quote=WO-1&ver=propuesta', id: '0f0f0f0f-0000-4000-8000-000000000001' });
    assert.deepEqual(sw.opened, ['https://beta.weotzi.com/client/dashboard?quote=WO-1&ver=propuesta&wo_n=0f0f0f0f-0000-4000-8000-000000000001']);

    const beta = serviceWorker({ scope: 'https://weotzi.example/beta/' });
    await click(beta, { url: '/artist/inbox?quote=WO-1' });
    assert.deepEqual(beta.opened, ['https://weotzi.example/beta/artist/inbox?quote=WO-1']);

    for (const url of ['https://evil.example/phish', '//evil.example', '/\\evil.example', undefined]) {
        const safe = serviceWorker();
        await click(safe, { url });
        assert.deepEqual(safe.opened, ['https://beta.weotzi.com/'], String(url));
    }

    // Si ya hay una pestaña en ese destino, se enfoca en vez de abrir otra.
    const open = windowClient({ url: 'https://beta.weotzi.com/calendar?view=day', focused: false });
    const reuse = serviceWorker({ windows: [open] });
    await click(reuse, { url: '/calendar?view=day' });
    assert.equal(open.wasFocused, true);
    assert.deepEqual(reuse.opened, []);
});

test('service worker: la rotación de la suscripción avisa al servidor', async () => {
    const sw = serviceWorker();
    const fresh = { endpoint: 'https://fcm.googleapis.com/fcm/send/nuevo', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; } };
    await sw.fire('pushsubscriptionchange', {
        oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/viejo', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'vp', auth: 'secreto-viejo' } }; } },
        newSubscription: fresh
    });
    const call = sw.fetched.find(f => /api\/push\/refresh$/.test(f.url));
    assert.equal(call.url, 'https://beta.weotzi.com/api/push/refresh');
    assert.deepEqual(JSON.parse(call.opts.body), {
        old_endpoint: 'https://fcm.googleapis.com/fcm/send/viejo', old_auth: 'secreto-viejo',
        subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/nuevo', keys: { p256dh: 'p', auth: 'a' } }
    });
    // Sin el secreto de la suscripción anterior no se llama al servidor (lo resuelve la app al abrirse).
    const blind = serviceWorker();
    await blind.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/viejo' }, newSubscription: fresh });
    assert.equal(blind.fetched.some(f => /api\/push\/refresh$/.test(f.url)), false);
    // El service worker vive en la raíz pública y lo registra wo-notify.js con el base path.
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'wo-sw.js')));
    assert.match(read('public', 'shared', 'js', 'wo-notify.js'), /navigator\.serviceWorker\.register\(appPath\('\/wo-sw\.js'\)\)/);
});

test('assets pendientes: el ícono de la notificación está listado para generarse', () => {
    const assets = JSON.parse(read('docs', 'plans', 'ronda2-assets', 'push.json'));
    assert.ok(Array.isArray(assets) && assets.length >= 1);
    const sw = read('public', 'wo-sw.js');
    for (const asset of assets) {
        assert.match(asset.path, /^public\/shared\/assets\/ronda2\/push\/[\w-]+\.webp$/);
        assert.ok(asset.prompt.length > 40 && /no text/.test(asset.prompt));
        assert.ok(['1:1', '4:3', '3:4', '16:9'].includes(asset.aspect));
        assert.ok(asset.uso);
        assert.ok(sw.includes(asset.path.replace(/^public\//, '')), `${asset.path} lo lee el service worker`);
    }
});

// ---------------------------------------------------------------- P26 · destinos exactos
test('P26: destino exacto de cada tipo de ítem, por rol', () => {
    assert.equal(FM.quoteHref('artist', 'WO-1'), '/my-quotations/detail?id=WO-1');
    assert.equal(FM.quoteHref('artist', 'WO-1', 'acuerdo'), '/my-quotations/detail?id=WO-1&ver=acuerdo');
    assert.equal(FM.quoteHref('client', 'WO 1/ñ', 'propuesta'), '/client/dashboard?quote=WO%201%2F%C3%B1&ver=propuesta');
    assert.equal(FM.quoteHref('client', '', 'propuesta'), '/client/dashboard#mis-cotizaciones');
    assert.equal(FM.quoteHref('artist', null), '/my-quotations');
    assert.equal(FM.quoteHref('artist', 'WO-1', 'zona-inventada'), '/my-quotations/detail?id=WO-1', 'solo zonas conocidas');

    assert.equal(FM.chatHref('artist', { quoteId: 'WO-1' }), '/artist/inbox?quote=WO-1');
    assert.equal(FM.chatHref('artist', { threadId: 'abc' }), '/artist/inbox?thread=abc');
    assert.equal(FM.chatHref('client', { quoteId: 'WO-1' }), '/client/chats?quote=WO-1');
    assert.equal(FM.chatHref('client', { threadId: 'abc' }), '/client/chats?thread=abc');
    assert.equal(FM.chatHref('studio', { threadId: 'abc' }), '/studio/dashboard?thread=abc');
    assert.equal(FM.chatHref('client', {}), '/client/chats');

    const session = { id: 'sess-1', session_date: new Date(2026, 10, 21, 14, 0).toISOString() };
    assert.equal(FM.sessionHref('artist', session), '/calendar?view=day&date=2026-11-21&event=session%3Asess-1');
    assert.equal(FM.sessionHref('artist', { id: 'x' }), '/calendar', 'sin fecha, el calendario');
    assert.equal(FM.sessionHref('client', session, 'WO-1'), '/client/dashboard?quote=WO-1&ver=sesiones');
    assert.equal(FM.localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(FM.localDateKey('no es fecha'), '');

    assert.equal(FM.applicationHref('spot', 'a1'), '/artist/applications?type=spot&id=a1&from=spots');
    assert.equal(FM.applicationHref('jobboard', 'a1'), '/artist/applications?type=jobboard&id=a1&from=jobboard');
    assert.equal(FM.applicationHref('spot'), '/artist/applications?tab=spots');
    assert.equal(FM.clientRequestHref('r1', 'a1'), '/client/requests?id=r1&view=postulacion&app=a1');
    assert.equal(FM.clientRequestHref('r1'), '/client/requests?id=r1');
    assert.equal(FM.verificationHref('artist'), '/artist/account#verificacion');

    assert.equal(FM.destination('artist', 'quote', { quoteId: 'WO-1', ver: 'historial' }), '/my-quotations/detail?id=WO-1&ver=historial');
    assert.equal(FM.destination('client', 'chat', { quoteId: 'WO-1' }), '/client/chats?quote=WO-1');
    assert.equal(FM.destination('artist', 'session', { session }), '/calendar?view=day&date=2026-11-21&event=session%3Asess-1');
    assert.equal(FM.destination('artist', 'application', { type: 'spot', id: 'a1' }), '/artist/applications?type=spot&id=a1&from=spots');
    assert.equal(FM.destination('client', 'request', { requestId: 'r1', applicationId: 'a1' }), '/client/requests?id=r1&view=postulacion&app=a1');
    assert.equal(FM.destination('artist', 'verification'), '/artist/account#verificacion');
    assert.equal(FM.destination('artist', 'invitation'), '/artist/invitations');
    assert.equal(FM.destination('artist', 'desconocido'), null);

    assert.equal(FM.withVer('/x?a=1#h', 'chat'), '/x?a=1&ver=chat#h');
    assert.equal(FM.withVer('/x?ver=chat', 'pagos'), '/x?ver=chat');
});

test('P26: las páginas de destino leen los parámetros que arma el modelo', () => {
    assert.match(read('public', 'shared', 'js', 'quotation-detail-figma.js'), /identifier: params\.get\('id'\) \|\| params\.get\('quote'\)/);
    assert.match(read('public', 'shared', 'js', 'client-dashboard.js'), /new URLSearchParams\(window\.location\.search\)\.get\('quote'\)/);
    assert.match(read('public', 'shared', 'js', 'artist-inbox.js'), /params\.get\('quote'\)/);
    assert.match(read('public', 'shared', 'js', 'client-chats.js'), /params\.get\('quote'\)/);
    assert.match(read('public', 'shared', 'js', 'calendar.js'), /`session:\$\{event\.sourceId\}` === value/);
    assert.match(read('public', 'shared', 'js', 'client-requests.js'), /if \(v === 'preview'\)[\s\S]*else if \(v === 'postulacion'\) renderApplicationDetail\(req, app\)/);
    // Las zonas a resaltar existen en esas pantallas.
    const detail = read('public', 'shared', 'js', 'quotation-detail-figma.js');
    for (const marker of ['class="qd-messages"', 'id="qd-sessions"', 'class="qd-agreement"', 'class="qd-dossier"', 'id="qd-dispute"', 'qd-timeline-section', 'id="qd-payments-slot"']) {
        assert.ok(detail.includes(marker), marker);
    }
    const clientJs = read('public', 'shared', 'js', 'client-dashboard.js');
    assert.ok(clientJs.includes('id="quote-proposal-slot"'));
    assert.ok(clientJs.includes('class="review-completion-panel"'));
    assert.ok(read('public', 'client', 'dashboard', 'index.html').includes('class="chat-section"'));
});

test('P26: actividad del dashboard del artista con la zona a resaltar', () => {
    const LM = require('../public/shared/js/dashboard-live-model.js');
    const quote = (status) => LM.quoteActivity({ quote_id: 'Q1', quote_status: status, client_full_name: 'Sofía', created_at: '2026-11-10T10:00:00Z' });
    assert.equal(FM.artistActivityHref(quote('pending')), '/my-quotations/detail?id=Q1', 'solicitud nueva: el detalle desde arriba');
    assert.equal(FM.artistActivityHref(quote('responded')), '/my-quotations/detail?id=Q1&ver=propuesta');
    assert.equal(FM.artistActivityHref(quote('client_approved')), '/my-quotations/detail?id=Q1&ver=acuerdo');
    assert.equal(FM.artistActivityHref(quote('client_rejected')), '/my-quotations/detail?id=Q1&ver=historial');
    const session = LM.sessionActivity({ quotation_id: 5, status: 'scheduled', session_date: '2026-11-20T15:00:00Z', created_at: new Date().toISOString() }, { 5: { id: 5, quote_id: 'Q5', client_full_name: 'Sofía' } }, null);
    assert.equal(FM.artistActivityHref(session), '/my-quotations/detail?id=Q5&ver=sesiones');
    assert.equal(FM.artistActivityHref({ type: 'review', href: '/artist/profile?artist=x#artist-reviews-panel' }), '/artist/profile?artist=x#artist-reviews-panel');
    assert.equal(FM.artistActivityHref({ type: 'other', txt: 'sin destino' }), null);

    const redesign = read('public', 'shared', 'js', 'dashboard-redesign.js');
    assert.match(redesign, /var href = activityHref\(ev\);\s*var tag = href \? 'a' : 'div';/);
    assert.match(redesign, /FM\.artistActivityHref\(ev\)/);
    assert.match(redesign, /document\.addEventListener\('wo:notify'/);
});

test('P26: el panel de notificaciones del artista usa enlaces reales al destino exacto', () => {
    const menu = read('public', 'shared', 'js', 'wo-artist-menu.js');
    assert.match(menu, /'<a class="' \+ cls \+ '" data-i="' \+ i \+ '" href="' \+ esc\(appPath\(it\.href\)\) \+ '">'/);
    assert.match(menu, /: '<button type="button" class="' \+ cls \+ '" data-i="' \+ i \+ '">'/, 'sin destino sigue siendo un botón');
    assert.doesNotMatch(menu, /if \(it\.href\) \{ window\.location\.href = appPath\(it\.href\); return; \}/, 'ya no navega por JS');
    assert.match(menu, /href: feedHref\('quote', \{ quoteId: q\.quote_id, ver: 'historial' \}, '\/my-quotations'\)/);
    assert.equal((menu.match(/href: feedHref\('session', \{ session: s \}, '\/calendar'\)/g) || []).length, 2, 'recordatorio y reserva confirmada');
    assert.match(menu, /href: feedHref\('application', \{ type: 'spot', id: a\.id \}, '\/artist\/applications\?tab=spots'\)/);
    assert.match(menu, /href: '\/my-quotations\/detail\?id=' \+ encodeURIComponent\(q\.quote_id\)/);
    assert.match(menu, /href: '\/artist\/inbox\?quote=' \+ encodeURIComponent\(t\.quote_id\)/);
    assert.match(menu, /href: '\/artist\/inbox\?thread=' \+ encodeURIComponent\(t\.id\)/);
    assert.match(menu, /a\.wo-oam-item,\.wo-app a\.wo-oam-item/);
    assert.match(menu, /document\.addEventListener\('wo:notify', function \(\) \{ refresh\(\); \}\)/);
});

// ---------------------------------------------------------------- P26 · "Tu actividad" del cliente
test('P26: enlace y clave de cada fila de "Tu actividad" del cliente', () => {
    const responded = FM.clientActivityLink('status', { quoteId: 'WO-1', status: 'responded', at: '2026-11-15T10:00:00Z' });
    assert.deepEqual(responded, { key: 'st:WO-1:responded:2026-11-15T10:00:00Z', href: '/client/dashboard?quote=WO-1&ver=propuesta', quoteId: 'WO-1', ver: 'propuesta' });
    assert.equal(FM.clientActivityLink('status', { quoteId: 'WO-1', status: 'artist_completed' }).ver, 'cierre');
    assert.equal(FM.clientActivityLink('status', { quoteId: 'WO-1', status: 'expired' }).href, '/client/dashboard?quote=WO-1&ver=propuesta');
    assert.equal(FM.clientActivityLink('dispute', { quoteId: 'WO-1', at: 't' }).href, '/client/dashboard?quote=WO-1&ver=disputa');
    assert.deepEqual(FM.clientActivityLink('message', { quoteId: 'WO-1', at: 't' }), { key: 'msg:WO-1:t', href: '/client/chats?quote=WO-1', quoteId: '', ver: '' });
    assert.equal(FM.clientActivityLink('proposal', { requestId: 'r1', applicationId: 'a1', at: 't' }).href, '/client/requests?id=r1&view=postulacion&app=a1');
    assert.equal(FM.clientActivityLink('otro', {}).href, null);
    // Cada estado que el feed del cliente muestra tiene su zona.
    const client = read('public', 'shared', 'js', 'client-dashboard.js');
    const statuses = [...client.slice(client.indexOf('const FEED_STATUS_EVENTS = {'), client.indexOf('async function loadActivityFeed()')).matchAll(/^\s{4}(\w+): \{ icon:/gm)].map(m => m[1]);
    assert.ok(statuses.length >= 7);
    for (const status of statuses) assert.ok(FM.CLIENT_STATUS_FOCUS[status], status);
});

function clientDashboard() {
    const feed = { innerHTML: '' };
    const context = vm.createContext({
        console, Date, Intl,
        window: { _supabase: { auth: { async getSession() { return { data: { session: null } }; } } }, location: { search: '' } },
        document: { addEventListener() {}, getElementById: id => (id === 'activity-feed' ? feed : null) },
        WeotziData: { channel() { return { on() { return this; }, subscribe() { return this; } }; } }
    });
    vm.runInContext(read('public', 'shared', 'js', 'client-dashboard.js'), context, { filename: 'client-dashboard.js' });
    return { context, feed };
}

test('P26: "Tu actividad" del cliente pinta cada fila como enlace real y escapa los datos', () => {
    const { context, feed } = clientDashboard();
    context.rows = [
        { at: new Date().toISOString(), icon: 'message-square', text: 'Lauu <b>Ink</b> te respondió tu cotización', href: '/client/dashboard?quote=WO-1&ver=propuesta', quoteId: 'WO-1', ver: 'propuesta' },
        { at: new Date(Date.now() - 60000).toISOString(), icon: 'mail', text: 'Nuevo mensaje de Mateo', href: '/client/chats?quote=WO"1' },
        { at: new Date(Date.now() - 120000).toISOString(), icon: 'briefcase', text: 'Sin destino' },
        { at: new Date(Date.now() - 180000).toISOString(), icon: 'x"><script>', text: 'Destino externo', href: 'javascript:alert(1)' }
    ];
    vm.runInContext('renderActivityFeed(rows)', context);
    const html = feed.innerHTML;
    assert.match(html, /<a class="client-feed-row" href="\/client\/dashboard\?quote=WO-1&amp;ver=propuesta" data-feed-quote="WO-1" data-feed-ver="propuesta">/);
    assert.match(html, /Lauu &lt;b&gt;Ink&lt;\/b&gt; te respondió tu cotización/);
    assert.match(html, /<a class="client-feed-row" href="\/client\/chats\?quote=WO&quot;1">/);
    assert.equal((html.match(/<a class="client-feed-row"/g) || []).length, 2);
    assert.equal((html.match(/<div class="client-feed-row">/g) || []).length, 2, 'sin destino válido queda como texto');
    assert.doesNotMatch(html, /javascript:|<script>|<b>Ink/);
    assert.match(html, /data-wo-icon="x&quot;&gt;&lt;script&gt;"/);

    const src = read('public', 'shared', 'js', 'client-dashboard.js');
    assert.match(src, /feedModel\.clientActivityLink\(source, data\)/);
    assert.match(src, /\.\.\.link\('status', \{ quoteId: row\.quote_id, status: row\.new_status, at: row\.changed_at \}\)/);
    assert.match(src, /\.\.\.link\('dispute', /);
    assert.match(src, /\.\.\.link\('message', /);
    assert.match(src, /\.\.\.link\('proposal', \{ requestId: req\.id, applicationId: app\.id, at: app\.created_at \}\)/);
    // Misma página: abre el detalle sin recargar y resalta la zona.
    assert.match(src, /closest\('a\[data-feed-quote\]'\)/);
    assert.match(src, /window\.WoNotify\.focusArrival\(row\.dataset\.feedVer\)/);
    assert.match(src, /document\.addEventListener\('wo:notify'/);
    // La piel del enlace vive en el CSS de la página (no depende de que cargue wo-notify.css).
    const css = read('public', 'shared', 'css', 'client-dashboard-figma.css');
    assert.match(css, /\.client-dashboard-figma a\.client-feed-row,\s*\.client-dashboard-figma a\.client-feed-row:hover \{ color: inherit; text-decoration: none; \}/);
    assert.match(css, /a\.client-feed-row:focus-visible \{ outline: none; box-shadow: var\(--shadow-focus\); \}/);
});

test('wo-notify.css: avisos arriba a la derecha, sin desbordar en el teléfono y sin animación si se pidió', () => {
    const css = read('public', 'shared', 'css', 'wo-notify.css');
    assert.match(css, /\.wo-ntf-stack \{[^}]*position: fixed;[^}]*width: min\(380px, calc\(100vw - 32px\)\);/);
    assert.match(css, /@media \(max-width: 600px\) \{\s*\.wo-ntf-stack \{ left: 12px; right: 12px; width: auto;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.wo-ntf-toast, \.wo-ntf-toast\.is-leaving, \.wo-arrival-flash \{ animation: none; \}/);
    assert.match(css, /\.wo-ntf-link:focus-visible,[\s\S]*?box-shadow: var\(--shadow-focus/);
    assert.doesNotMatch(css, /border-radius: [1-9]/, 'DS Bauhaus: radio 0');
    assert.doesNotMatch(css, /gradient\(/);
    // wo-notify.js pide la hoja al iniciar (el primer aviso ya sale con su piel).
    const js = read('public', 'shared', 'js', 'wo-notify.js');
    assert.match(js, /function init\(\) \{[\s\S]*?ensureStyles\(\);\s*applyArrival\(\);/);
    assert.match(js, /link\.href = sharedUrl\('css\/wo-notify\.css'\)/);
});

test('P26: sin el modelo de destinos, la actividad se muestra igual (sin enlaces)', async () => {
    const { context, feed } = clientDashboard();
    vm.runInContext(`
        feedModelPromise = Promise.resolve(null);
        currentQuotations = [{ id: 1, quote_id: 'WO-1', artist_name: 'Mateo' }];
        jbRequests = [];
        WeotziData.from = function (table) {
            var rows = table === 'quotation_status_history' ? [{ quote_id: 'WO-1', new_status: 'responded', changed_at: new Date().toISOString() }] : [];
            var q = { select: function () { return q; }, in: function () { return q; }, eq: function () { return q; }, not: function () { return q; },
                order: function () { return q; }, limit: function () { return Promise.resolve({ data: rows }); } };
            return q;
        };
    `, context);
    await vm.runInContext('loadActivityFeed()', context);
    assert.match(feed.innerHTML, /<div class="client-feed-row">/);
    assert.match(feed.innerHTML, /Mateo te respondió tu cotización/);

    // Con el modelo cargado, la misma fila es un enlace a la cotización.
    context.window.WoNotificationFeedModel = FM;
    vm.runInContext('feedModelPromise = null;', context);
    await vm.runInContext('loadActivityFeed()', context);
    assert.match(feed.innerHTML, /<a class="client-feed-row" href="\/client\/dashboard\?quote=WO-1&amp;ver=propuesta" data-feed-quote="WO-1" data-feed-ver="propuesta">/);
});

// ---------------------------------------------------------------- EP-08 · avisos guardados en la campana y en "Tu actividad"
const NOTICE_ROWS = () => [
    { id: 'n1', role: 'artist', event_id: 'negotiation_counter_proposed', title: '  Lucía propone cambios\n a tu propuesta AB23CD ', body: 'Revisa <b>los</b> cambios', url: '/my-quotations/detail?quote=WO-1&ver=propuesta', created_at: '2026-11-16T10:00:00Z', read_at: null },
    { id: 'n2', role: 'artist', event_id: 'chat_message_to_artist', title: 'Nuevo mensaje', url: '/artist/inbox?quote=WO-1', created_at: '2026-11-16T10:01:00Z', read_at: null },
    { id: 'n3', role: 'artist', event_id: 'session_change_requested', title: 'Lucía pidió cambiar la sesión', url: 'https://evil.example/x', created_at: '2026-11-16T10:02:00Z', read_at: '2026-11-16T10:03:00Z' },
    { id: 'n4', role: 'client', event_id: 'negotiation_amendment_proposed', title: 'Mateo propone un cambio al acuerdo', url: '/client/dashboard?quote=WO-1&ver=acuerdo', created_at: '2026-11-16T10:04:00Z', read_at: null },
    { id: 'n5', role: 'client', event_id: 'session_confirmation_requested', title: 'Confirma tu sesión con Mateo', url: '/client/dashboard?session=44444444-4444-4444-8444-444444444444#mis-sesiones', created_at: '2026-11-16T10:05:00Z', read_at: null },
    { id: 'n6', role: 'client', event_id: 'artist_responded_quotation', title: 'Mateo respondió', url: '/client/dashboard?quote=WO-1', created_at: '2026-11-16T10:06:00Z', read_at: null },
    { id: 'n7', role: 'artist', event_id: 'session_dispute_opened', title: '   ', url: '/my-quotations/detail?quote=WO-1', created_at: '2026-11-16T10:07:00Z' },
    { id: 'n1', role: 'artist', event_id: 'negotiation_counter_proposed', title: 'Repetida', url: '/my-quotations', created_at: '2026-11-16T10:08:00Z' }
];

test('EP-08: una fila de user_notifications se vuelve un ítem con destino interno; lo que ya tiene fila propia se descarta', () => {
    const items = FM.storedNoticeItems(NOTICE_ROWS(), 'artist');
    assert.deepEqual(items.map((i) => i.key), ['ntf:n1', 'ntf:n3'], 'ni el mensaje (ya tiene su ítem), ni lo del cliente, ni la fila sin título, ni la repetida');
    assert.deepEqual(items[0], {
        key: 'ntf:n1', id: 'n1', type: 'aviso', eventId: 'negotiation_counter_proposed', icon: 'inbox',
        title: 'Lucía propone cambios a tu propuesta AB23CD', desc: 'Revisa <b>los</b> cambios',
        ts: '2026-11-16T10:00:00Z', unread: true, href: '/my-quotations/detail?quote=WO-1&ver=propuesta'
    });
    // Sesiones con su ícono; un destino externo nunca es enlace; leído en la base = leído.
    assert.deepEqual([items[1].icon, items[1].href, items[1].unread], ['calendar', null, false]);
    // Leído desde la campana (user_notification_reads) aunque la fila siga sin read_at.
    assert.equal(FM.storedNoticeItems(NOTICE_ROWS(), 'artist', { seen: new Set(['ntf:n1']) })[0].unread, false);
    // Acepta la respuesta de la capa de datos ({ data }) y entradas vacías.
    assert.equal(FM.storedNoticeItems({ data: NOTICE_ROWS() }, 'artist').length, 2);
    assert.deepEqual(FM.storedNoticeItems(null, 'artist'), []);
    assert.deepEqual(FM.storedNoticeItems(NOTICE_ROWS(), 'studio'), []);

    // Las listas: negociación y sesiones, por rol. Nada que ya se derive de otra tabla.
    const { artist, client } = FM.STORED_NOTICE_EVENTS;
    for (const id of ['negotiation_counter_proposed', 'negotiation_amendment_proposed', 'negotiation_amendment_accepted', 'negotiation_amendment_rejected',
        'negotiation_proposal_withdrawn', 'session_confirmed_by_client', 'session_change_requested', 'session_change_resolved', 'session_dispute_opened', 'session_dispute_resolved', 'session_feedback_received']) {
        assert.ok(artist.includes(id), `artista: ${id}`);
    }
    for (const id of ['artist_updated_quotation_proposal', 'negotiation_counter_accepted', 'negotiation_counter_declined', 'negotiation_amendment_proposed',
        'negotiation_amendment_accepted', 'negotiation_amendment_rejected', 'negotiation_proposal_withdrawn', 'session_confirmation_requested',
        'session_change_requested', 'session_change_resolved', 'session_no_show', 'session_dispute_resolved', 'session_feedback_received']) {
        assert.ok(client.includes(id), `cliente: ${id}`);
    }
    for (const id of [...artist, ...client]) {
        assert.doesNotMatch(id, /^chat_|^inbox_|_message|^client_quotation_submitted$|^artist_responded_quotation$|^quotation_expired$|reminder/, `${id} ya tiene su ítem`);
    }
    // Cada evento de las listas existe y el servidor lo guarda como aviso para ese rol.
    const dispatch = require('../lib/push-dispatch');
    for (const [role, ids] of Object.entries(FM.STORED_NOTICE_EVENTS)) {
        for (const id of ids) assert.equal(dispatch.isPushEvent(id, role), true, `${id} → ${role}`);
    }
    assert.equal(FM.STORED_NOTICE_DAYS, 14);
});

test('EP-08: "Tu actividad" del cliente arma sus filas desde los avisos guardados', () => {
    const events = FM.clientNoticeEvents(NOTICE_ROWS());
    assert.deepEqual(events, [
        { at: '2026-11-16T10:04:00Z', icon: 'message-square', text: 'Mateo propone un cambio al acuerdo', key: 'ntf:n4',
            href: '/client/dashboard?quote=WO-1&ver=acuerdo', quoteId: 'WO-1', ver: 'acuerdo', noticeId: 'n4' },
        // La sesión se abre en "Mis sesiones": enlace normal, no el detalle en la misma página.
        { at: '2026-11-16T10:05:00Z', icon: 'calendar', text: 'Confirma tu sesión con Mateo', key: 'ntf:n5',
            href: '/client/dashboard?session=44444444-4444-4444-8444-444444444444#mis-sesiones', quoteId: '', ver: '', noticeId: 'n5' }
    ]);
    assert.deepEqual(FM.clientQuoteTarget('/client/dashboard?quote=WO%201&ver=propuesta'), { quoteId: 'WO 1', ver: 'propuesta' });
    assert.deepEqual(FM.clientQuoteTarget('/client/dashboard?quote=WO-1&ver=inventada'), { quoteId: 'WO-1', ver: '' });
    for (const href of ['/client/dashboard?quote=WO-1&session=1', '/client/dashboard?quote=WO-1#mis-sesiones', '/client/chats?quote=WO-1', '/client/dashboard', null]) {
        assert.deepEqual(FM.clientQuoteTarget(href), { quoteId: '', ver: '' }, String(href));
    }
});

test('EP-08: "Tu actividad" muestra los avisos guardados como enlaces, y sigue igual si no se pueden leer', async () => {
    const { context, feed } = clientDashboard();
    context.window.WoNotificationFeedModel = FM;
    const asked = [];
    context.notices = NOTICE_ROWS().map((row) => ({ ...row, created_at: new Date().toISOString() }));
    context.asked = asked;
    vm.runInContext(`
        feedModelPromise = null;
        currentClient = { user_id: 'client-1', email: 'lucia@example.com' };
        currentQuotations = [{ id: 1, quote_id: 'WO-1', artist_name: 'Mateo' }];
        jbRequests = [];
        WeotziData.from = function () {
            var q = { select: function () { return q; }, in: function () { return q; }, eq: function () { return q; }, not: function () { return q; },
                order: function () { return q; }, limit: function () { return Promise.resolve({ data: [] }); } };
            return q;
        };
        WeotziData.Notifications = {
            listStored: function (userId, opts) { asked.push([userId, opts]); return Promise.resolve(notices); },
            markRead: function () { return Promise.resolve(); }
        };
    `, context);
    await vm.runInContext('loadActivityFeed()', context);
    assert.equal(asked.length, 1);
    assert.equal(asked[0][0], 'client-1');
    assert.equal(asked[0][1].role, 'client');
    assert.deepEqual(Array.from(asked[0][1].eventIds), FM.STORED_NOTICE_EVENTS.client);
    assert.equal(asked[0][1].days, 14);
    assert.match(feed.innerHTML, /<a class="client-feed-row" href="\/client\/dashboard\?quote=WO-1&amp;ver=acuerdo" data-feed-quote="WO-1" data-feed-ver="acuerdo" data-feed-notice="n4">/);
    assert.match(feed.innerHTML, /Mateo propone un cambio al acuerdo/);
    assert.match(feed.innerHTML, /<a class="client-feed-row" href="\/client\/dashboard\?session=44444444-4444-4444-8444-444444444444#mis-sesiones" data-feed-notice="n5">/);
    assert.doesNotMatch(feed.innerHTML, /Mateo respondió|Nuevo mensaje|propone cambios a tu propuesta/, 'solo los eventos de la lista del cliente');

    // La lectura falla (o falta la tabla): el resto de la actividad se pinta igual.
    vm.runInContext(`
        WeotziData.Notifications.listStored = function () { return Promise.reject(new Error('sin tabla')); };
        WeotziData.from = function (table) {
            var rows = table === 'quotation_status_history' ? [{ quote_id: 'WO-1', new_status: 'responded', changed_at: new Date().toISOString() }] : [];
            var q = { select: function () { return q; }, in: function () { return q; }, eq: function () { return q; }, not: function () { return q; },
                order: function () { return q; }, limit: function () { return Promise.resolve({ data: rows }); } };
            return q;
        };
    `, context);
    const warn = console.warn;
    console.warn = () => {};
    try { await vm.runInContext('loadActivityFeed()', context); } finally { console.warn = warn; }
    assert.match(feed.innerHTML, /Mateo te respondió tu cotización/);
    assert.doesNotMatch(feed.innerHTML, /data-feed-notice/);

    const src = read('public', 'shared', 'js', 'client-dashboard.js');
    assert.match(src, /closest\('a\[data-feed-notice\]'\)/);
    assert.match(src, /repo\.markRead\(notice\.dataset\.feedNotice\)/);
    assert.doesNotMatch(src, /from\('user_notifications'\)/, 'la tabla se lee solo por WeotziData.Notifications');
});

test('EP-08: la campana del artista suma los avisos guardados y los marca leídos al abrirlos', () => {
    const menu = read('public', 'shared', 'js', 'wo-artist-menu.js');
    assert.match(menu, /D\.Notifications\.listStored\(uid, \{\s*role: 'artist', eventIds: NFM\.STORED_NOTICE_EVENTS\.artist, days: NFM\.STORED_NOTICE_DAYS, limit: 20,\s*\}\)\.then\(function \(rows\) \{\s*pushFeed\(NFM\.storedNoticeItems\(rows, 'artist', \{ seen: seen \}\)\);/);
    assert.match(menu, /console\.warn\('\[wo-menu\] avisos guardados:', e && e\.message\)/, 'un fallo no rompe el resto del menú');
    // El repositorio se asegura para la primera pintada (normalmente ya lo cargó wo-notify.js).
    assert.match(menu, /loadCounterRepository\('\/shared\/js\/data\/notifications-repo\.js', function \(\) \{\s*var D = window\.WeotziData;\s*return Boolean\(D && D\.Notifications && typeof D\.Notifications\.listStored === 'function'\);/);
    // Abrir el ítem, o "Marcar todas como leídas", también sella read_at en la fila.
    assert.match(menu, /persistSeen\(\[it\.key\]\);\s*markStoredNoticesRead\(\[it\]\);\s*it\.unread = false;/);
    assert.match(menu, /function markAllRead\(\) \{\s*var seen = loadSeen\(\);\s*markStoredNoticesRead\(state\.feed\);/);
    assert.match(menu, /if \(!it \|\| it\.type !== 'aviso' \|\| !it\.id \|\| !it\.unread\) return;\s*try \{ Promise\.resolve\(N\.markRead\(it\.id\)\)/);
    assert.doesNotMatch(menu, /from\('user_notifications'\)/, 'la tabla se lee solo por WeotziData.Notifications');
    // La página que versiona el script sirve la versión nueva.
    assert.match(read('public', 'artist', 'dashboard', 'index.html'), /wo-artist-menu\.js\?v=20261116-r2b/);
});

test('EP-08: el repositorio filtra por rol y por evento en la base y tolera que falte la tabla', async () => {
    const calls = [];
    let failure = null;
    const D = {
        getClient() { return {}; },
        async run(label, builder) {
            const q = {};
            for (const method of ['select', 'eq', 'gte', 'is', 'in', 'order', 'limit']) {
                q[method] = (...args) => { calls.push([method, ...args]); return q; };
            }
            const client = { from(table) { calls.push(['from', table]); return q; } };
            await builder(client);
            if (failure) throw failure;
            return { data: [{ id: 'n1' }], count: null };
        }
    };
    const context = vm.createContext({ window: { WeotziData: D, location: { pathname: '/' } }, console, Date, Math, Number, String, Array, Promise, Error });
    vm.runInContext(read('public', 'shared', 'js', 'data', 'notifications-repo.js'), context);
    const N = D.Notifications;
    const before = Date.now();
    assert.deepEqual(await N.listStored('u1', { role: 'artist', eventIds: ['a', 'b'], days: 14, limit: 20 }), [{ id: 'n1' }]);
    assert.deepEqual(calls.filter((c) => ['from', 'eq', 'in', 'limit'].includes(c[0])), [
        ['from', 'user_notifications'], ['eq', 'user_id', 'u1'], ['eq', 'role', 'artist'], ['in', 'event_id', ['a', 'b']], ['limit', 20]
    ]);
    const since = new Date(calls.find((c) => c[0] === 'gte')[2]).getTime();
    assert.ok(Math.abs(before - 14 * 86400000 - since) < 5000, 'ventana de 14 días');
    // Sin usuario o sin lista de eventos no consulta.
    calls.length = 0;
    assert.equal((await N.listStored('', { eventIds: ['a'] })).length, 0);
    assert.equal((await N.listStored('u1', { eventIds: [] })).length, 0);
    assert.equal(calls.length, 0);
    // Migración pendiente: [] en silencio. Otro error se propaga a quien llama.
    failure = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    assert.equal((await N.listStored('u1', { role: 'client', eventIds: ['a'] })).length, 0);
    failure = Object.assign(new Error('caída'), { code: '57014' });
    await assert.rejects(() => N.listStored('u1', { role: 'client', eventIds: ['a'] }), /caída/);
    // listRecent sin filtros sigue igual (lo usa wo-notify.js).
    failure = null; calls.length = 0;
    await N.listRecent('u1', { since: '2026-11-16T00:00:00Z', limit: 5, unreadOnly: true });
    assert.deepEqual(calls.map((c) => c[0]), ['from', 'select', 'eq', 'gte', 'is', 'order', 'limit']);
});
