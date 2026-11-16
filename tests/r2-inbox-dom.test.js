'use strict';

// Ronda 2 · frente Inbox — pruebas de humo de los módulos de interfaz
// (wo-voice.js, wo-quick-replies.js, artist-inbox-automations.js) sobre un DOM
// mínimo de prueba: grabar (pulsar y mantener), vista previa, cancelar/enviar,
// fallbacks de micrófono, reproductor, mensajes rápidos (insertar y gestionar)
// y configuración de respuestas automáticas. No hay navegador: el DOM, el
// MediaRecorder, el micrófono y el reloj son dobles de prueba.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const X = require(path.join(root, 'public', 'shared', 'js', 'inbox-extras-model.js'));
const flush = () => new Promise((resolve) => setImmediate(resolve));

/* ------------------------------ DOM mínimo ------------------------------ */

class FakeEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.bubbles = init.bubbles !== false;
        this.defaultPrevented = false;
        this.stopped = false;
        Object.assign(this, init);
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
}

function matcher(selector) {
    const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean).map(compound);
    return (node) => parts.some((test) => test(node));
}

function compound(selector) {
    const tests = [];
    let rest = selector;
    const token = /^([a-zA-Z][\w-]*)|^\.([\w-]+)|^\[([\w-]+)(?:="([^"]*)")?\]|^:not\(((?:[^()]|\([^()]*\))*)\)|^:(disabled)/;
    while (rest) {
        const m = token.exec(rest);
        if (!m) throw new Error('selector no soportado en el DOM de prueba: ' + selector);
        if (m[1]) { const tag = m[1].toLowerCase(); tests.push((n) => n.localName === tag); }
        else if (m[2]) { const cls = m[2]; tests.push((n) => n.classList.contains(cls)); }
        else if (m[3]) {
            const name = m[3]; const value = m[4];
            tests.push((n) => n.hasAttribute(name) && (value === undefined || n.getAttribute(name) === value));
        } else if (m[5] !== undefined) { const inner = matcher(m[5]); tests.push((n) => !inner(n)); }
        else if (m[6]) tests.push((n) => n.disabled === true);
        rest = rest.slice(m[0].length);
    }
    return (node) => tests.every((t) => t(node));
}

const REFLECTED = { id: 'id', className: 'class', title: 'title', type: 'type', htmlFor: 'for', href: 'href', placeholder: 'placeholder', name: 'name' };
const BOOLEAN = { hidden: 'hidden', disabled: 'disabled' };

class FakeElement {
    constructor(doc, tag) {
        this.ownerDocument = doc;
        this.localName = String(tag).toLowerCase();
        this.tagName = this.localName.toUpperCase();
        this.childNodes = [];
        this.parentNode = null;
        this.attrs = new Map();
        this.listeners = new Map();
        this.style = {};
        this.text = '';
        this.value = '';
        this.checked = false;
        const el = this;
        this.classList = {
            list: () => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean),
            contains: (c) => el.classList.list().includes(c),
            add: (c) => { if (!el.classList.contains(c)) el.setAttribute('class', el.classList.list().concat(c).join(' ')); },
            remove: (c) => el.setAttribute('class', el.classList.list().filter((x) => x !== c).join(' ')),
            toggle: (c, force) => {
                const want = force === undefined ? !el.classList.contains(c) : Boolean(force);
                if (want) el.classList.add(c); else el.classList.remove(c);
                return want;
            },
        };
        this.dataset = new Proxy({}, {
            get: (_t, key) => el.getAttribute('data-' + String(key).replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase())) ?? undefined,
            set: (_t, key, value) => { el.setAttribute('data-' + String(key).replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase()), String(value)); return true; },
        });
    }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    removeAttribute(name) { this.attrs.delete(name); }
    hasAttribute(name) { return this.attrs.has(name); }
    get children() { return this.childNodes.filter((n) => n instanceof FakeElement); }
    get firstChild() { return this.childNodes[0] || null; }
    get textContent() { return this.childNodes.length ? this.childNodes.map((n) => n.textContent).join('') : this.text; }
    set textContent(value) { this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; this.text = String(value == null ? '' : value); }
    appendChild(node) { node.remove(); node.parentNode = this; this.childNodes.push(node); this.text = ''; return node; }
    insertBefore(node, ref) {
        node.remove();
        node.parentNode = this;
        const at = ref ? this.childNodes.indexOf(ref) : -1;
        if (at === -1) this.childNodes.push(node); else this.childNodes.splice(at, 0, node);
        return node;
    }
    remove() {
        if (!this.parentNode) return;
        this.parentNode.childNodes = this.parentNode.childNodes.filter((n) => n !== this);
        this.parentNode = null;
    }
    replaceWith(node) {
        const parent = this.parentNode;
        if (!parent) return;
        node.remove();
        parent.childNodes[parent.childNodes.indexOf(this)] = node;
        node.parentNode = parent;
        this.parentNode = null;
    }
    contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
    closest(selector) { const test = matcher(selector); for (let n = this; n; n = n.parentNode) if (n instanceof FakeElement && test(n)) return n; return null; }
    querySelectorAll(selector) {
        const test = matcher(selector);
        const out = [];
        const walk = (node) => node.children.forEach((child) => { if (test(child)) out.push(child); walk(child); });
        walk(this);
        return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get offsetParent() {
        for (let n = this; n; n = n.parentNode) if (n.hidden) return null;
        return this.ownerDocument.body.contains(this) ? (this.parentNode || this.ownerDocument.body) : null;
    }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((f) => f !== fn)); }
    dispatchEvent(event) {
        if (!event.target) event.target = this;
        for (let n = this; n && !event.stopped; n = n.parentNode) {
            (n.listeners.get(event.type) || []).slice().forEach((fn) => fn.call(n, event));
            if (!event.bubbles) return true;
        }
        if (!event.stopped) this.ownerDocument.emit(event);
        return true;
    }
    focus() {
        this.ownerDocument.activeElement = this;
        this.dispatchEvent(new FakeEvent('focus', { bubbles: false }));
        this.dispatchEvent(new FakeEvent('focusin'));
    }
    blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
    setSelectionRange() {}
}
Object.keys(REFLECTED).forEach((prop) => Object.defineProperty(FakeElement.prototype, prop, {
    get() { return this.getAttribute(REFLECTED[prop]) || ''; },
    set(value) { this.setAttribute(REFLECTED[prop], value); },
}));
Object.keys(BOOLEAN).forEach((prop) => Object.defineProperty(FakeElement.prototype, prop, {
    get() { return this.hasAttribute(BOOLEAN[prop]); },
    set(value) { if (value) this.setAttribute(BOOLEAN[prop], ''); else this.removeAttribute(BOOLEAN[prop]); },
}));

function createEnvironment(options = {}) {
    const timers = new Map();
    let timerSeq = 0;
    const clock = { now: 1000 };
    const windowListeners = new Map();
    const documentListeners = new Map();
    const document = {
        activeElement: null,
        createElement: (tag) => new FakeElement(document, tag),
        createElementNS: (_ns, tag) => new FakeElement(document, tag),
        addEventListener: (type, fn) => { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(fn); },
        removeEventListener: (type, fn) => documentListeners.set(type, (documentListeners.get(type) || []).filter((f) => f !== fn)),
        contains: (node) => document.body.contains(node),
        emit(event) {
            (documentListeners.get(event.type) || []).slice().forEach((fn) => fn(event));
            (windowListeners.get(event.type) || []).slice().forEach((fn) => fn(event));
        },
    };
    document.body = new FakeElement(document, 'body');
    document.activeElement = document.body;

    const sandbox = {
        document,
        console: { log() {}, warn() {}, error() {} },
        navigator: options.navigator || {},
        performance: { now: () => clock.now },
        Blob, File, URL,
        Event: FakeEvent,
        Promise, Map, Set, Array, Object, Number, String, Boolean, Math, JSON, Error, RegExp, Date,
        setTimeout: (fn) => { timers.set(++timerSeq, fn); return timerSeq; },
        clearTimeout: (id) => timers.delete(id),
        setInterval: (fn) => { timers.set(++timerSeq, fn); return timerSeq; },
        clearInterval: (id) => timers.delete(id),
        addEventListener: (type, fn) => { if (!windowListeners.has(type)) windowListeners.set(type, []); windowListeners.get(type).push(fn); },
        removeEventListener: (type, fn) => windowListeners.set(type, (windowListeners.get(type) || []).filter((f) => f !== fn)),
        open: () => null,
        location: { assign() {} },
        WeotziInboxExtras: X,
        WeotziData: options.data || {},
    };
    if (options.MediaRecorder) sandbox.MediaRecorder = options.MediaRecorder;
    if (options.Audio) sandbox.Audio = options.Audio;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    (options.scripts || []).forEach((file) => vm.runInContext(source(file), sandbox, { filename: file }));
    const emitWindow = (type, init) => (windowListeners.get(type) || []).slice().forEach((fn) => fn(new FakeEvent(type, init)));
    return { window: sandbox, document, clock, timers, emitWindow };
}

function click(node) {
    if (node.disabled) return;
    node.dispatchEvent(new FakeEvent('click'));
}

function byClass(rootNode, cls) { return rootNode.querySelector('.' + cls); }

/* ------------------------------ dobles de audio ------------------------------ */

function fakeRecorderClass(supported) {
    return class FakeRecorder {
        static isTypeSupported(type) { return supported.includes(type); }
        constructor(stream, opts) {
            this.stream = stream;
            this.mimeType = (opts && opts.mimeType) || 'audio/webm';
            this.handlers = {};
            this.state = 'inactive';
            FakeRecorder.last = this;
        }
        addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
        emit(type, event) { (this.handlers[type] || []).forEach((fn) => fn(event || {})); }
        start() { this.state = 'recording'; }
        stop() {
            if (this.state === 'inactive') throw new Error('InvalidStateError');
            this.state = 'inactive';
            this.emit('dataavailable', { data: new Blob(['x'.repeat(4096)], { type: this.mimeType }) });
            this.emit('stop');
        }
    };
}

function fakeMicrophone(behaviour = {}) {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    return {
        tracks,
        mediaDevices: {
            getUserMedia: async () => {
                if (behaviour.error) { const error = new Error(behaviour.error); error.name = behaviour.error; throw error; }
                return { getTracks: () => tracks };
            },
        },
    };
}

class FakeAudio {
    constructor() { this.handlers = {}; this.paused = true; this.currentTime = 0; this.duration = NaN; FakeAudio.instances.push(this); }
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
    emit(type) { (this.handlers[type] || []).forEach((fn) => fn({})); }
    play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
    pause() { if (this.paused) return; this.paused = true; this.emit('pause'); }
    removeAttribute() {}
    load() {}
}
FakeAudio.instances = [];

function mountComposer(env) {
    const form = env.document.createElement('form');
    const button = env.document.createElement('button');
    button.id = 'mic';
    form.appendChild(button);
    env.document.body.appendChild(form);
    return { form, button };
}

function voiceEnvironment(mic, supported = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    const Recorder = fakeRecorderClass(supported);
    const env = createEnvironment({
        navigator: mic ? { mediaDevices: mic.mediaDevices } : {},
        MediaRecorder: Recorder,
        Audio: FakeAudio,
        scripts: ['public/shared/js/wo-voice.js'],
    });
    return Object.assign(env, { Recorder });
}

/* ------------------------------ P8 · voz ------------------------------ */

test('P8 grabar con un toque: grabando → detener → vista previa → enviar', async () => {
    const mic = fakeMicrophone();
    const env = voiceEnvironment(mic);
    const { form, button } = mountComposer(env);
    const sent = [];
    const errors = [];
    const recorder = env.window.WoVoice.attachRecorder({
        form, button,
        canRecord: () => true,
        onSend: async (voice) => { sent.push(voice); },
        onError: (message) => errors.push(message),
    });
    assert.equal(env.window.WoVoice.isSupported(), true);
    const bar = byClass(form, 'wo-voice-bar');
    assert.equal(bar.hidden, true);

    click(button); // teclado o lector de pantalla
    assert.equal(recorder.isBusy(), true);
    assert.equal(form.classList.contains('is-voice'), true);
    await flush();
    assert.equal(bar.getAttribute('data-state'), 'recording');
    assert.equal(env.Recorder.last.mimeType, 'audio/mp4', 'prefiere el formato más compatible');
    assert.equal(byClass(bar, 'wo-voice-stop').hidden, false);
    assert.equal(byClass(bar, 'wo-voice-send').hidden, true);
    assert.equal(env.document.activeElement, byClass(bar, 'wo-voice-stop'), 'el foco pasa a "Detener"');

    env.clock.now += 5200;
    click(byClass(bar, 'wo-voice-stop'));
    assert.equal(bar.getAttribute('data-state'), 'preview');
    assert.equal(mic.tracks[0].stopped, true, 'se libera el micrófono');
    const preview = byClass(bar, 'wo-voice-preview');
    assert.equal(preview.hidden, false);
    assert.match(byClass(preview, 'wo-voice').getAttribute('aria-label'), /Mensaje de voz, 5 segundos/);
    assert.equal(byClass(preview, 'wo-voice-time').textContent, '0:05');
    assert.match(byClass(bar, 'wo-sr-only').textContent, /Grabación lista: 5 segundos/);

    // La vista previa se puede escuchar antes de enviar.
    click(byClass(preview, 'wo-voice-toggle'));
    assert.equal(FakeAudio.instances.at(-1).paused, false);
    assert.match(FakeAudio.instances.at(-1).src, /^blob:/);
    assert.equal(byClass(preview, 'wo-voice-toggle').getAttribute('aria-label'), 'Pausar mensaje de voz');

    click(byClass(bar, 'wo-voice-send'));
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].file.type, 'audio/mp4');
    assert.match(sent[0].file.name, /^voz-\d+\.m4a$/);
    assert.equal(sent[0].durationMs, 5200);
    assert.equal(sent[0].file.size, 4096);
    assert.equal(recorder.isBusy(), false);
    assert.equal(bar.hidden, true);
    assert.equal(form.classList.contains('is-voice'), false);
    assert.deepEqual(errors, []);
});

test('P8 mantener pulsado: al soltar termina la grabación; un toque corto sigue grabando', async () => {
    const env = voiceEnvironment(fakeMicrophone());
    const { form, button } = mountComposer(env);
    env.window.WoVoice.attachRecorder({ form, button, canRecord: () => true, onSend: async () => {}, onError: () => {} });
    const bar = byClass(form, 'wo-voice-bar');

    button.dispatchEvent(new FakeEvent('pointerdown', { pointerType: 'touch', button: 0 }));
    await flush();
    assert.equal(bar.getAttribute('data-state'), 'recording');
    env.clock.now += 2500;
    env.emitWindow('pointerup');
    assert.equal(bar.getAttribute('data-state'), 'preview', 'soltar después de mantener deja la vista previa');
    click(byClass(bar, 'wo-voice-cancel'));
    assert.equal(bar.hidden, true);

    // Toque corto: no termina al soltar.
    env.timers.forEach((fn) => fn()); // vence la espera que ignora el click del gesto anterior
    button.dispatchEvent(new FakeEvent('pointerdown', { pointerType: 'mouse', button: 0 }));
    await flush();
    env.clock.now += 150;
    env.emitWindow('pointerup');
    assert.equal(bar.getAttribute('data-state'), 'recording');
    click(byClass(bar, 'wo-voice-cancel'));
    assert.equal(bar.hidden, true);
});

test('P8 fallbacks: sin soporte, permiso denegado, grabación muy corta y cancelar', async () => {
    // Navegador sin MediaRecorder / micrófono.
    const bare = createEnvironment({ navigator: {}, scripts: ['public/shared/js/wo-voice.js'] });
    const first = mountComposer(bare);
    const errors = [];
    bare.window.WoVoice.attachRecorder({ form: first.form, button: first.button, canRecord: () => true, onSend: async () => {}, onError: (m) => errors.push(m) });
    assert.equal(bare.window.WoVoice.isSupported(), false);
    assert.equal(first.button.classList.contains('is-unsupported'), true);
    click(first.button);
    await flush();
    assert.deepEqual(errors, [X.VOICE_UNSUPPORTED]);
    assert.equal(byClass(first.form, 'wo-voice-bar').hidden, true);

    // Permiso de micrófono denegado.
    const denied = voiceEnvironment(fakeMicrophone({ error: 'NotAllowedError' }));
    const second = mountComposer(denied);
    const deniedErrors = [];
    denied.window.WoVoice.attachRecorder({ form: second.form, button: second.button, canRecord: () => true, onSend: async () => {}, onError: (m) => deniedErrors.push(m) });
    click(second.button);
    await flush();
    assert.equal(deniedErrors.length, 1);
    assert.match(deniedErrors[0], /No tenemos permiso para usar tu micrófono/);
    assert.equal(byClass(second.form, 'wo-voice-bar').hidden, true);
    assert.equal(second.form.classList.contains('is-voice'), false);

    // Grabación de menos de un segundo: se descarta con aviso.
    const mic = fakeMicrophone();
    const env = voiceEnvironment(mic);
    const third = mountComposer(env);
    const shortErrors = [];
    let sends = 0;
    const recorder = env.window.WoVoice.attachRecorder({ form: third.form, button: third.button, canRecord: () => true, onSend: async () => { sends += 1; }, onError: (m) => shortErrors.push(m) });
    const bar = byClass(third.form, 'wo-voice-bar');
    click(third.button);
    await flush();
    env.clock.now += 300;
    click(byClass(bar, 'wo-voice-stop'));
    assert.match(shortErrors[0], /muy corta/);
    assert.equal(bar.hidden, true);

    // Cancelar a mitad de la grabación: no envía nada y suelta el micrófono.
    mic.tracks[0].stopped = false;
    click(third.button);
    await flush();
    env.clock.now += 4000;
    click(byClass(bar, 'wo-voice-cancel'));
    assert.equal(recorder.isBusy(), false);
    assert.equal(mic.tracks[0].stopped, true);
    assert.equal(sends, 0);

    // Hilo donde no se puede grabar (cerrado o enviando).
    const blocked = voiceEnvironment(fakeMicrophone());
    const fourth = mountComposer(blocked);
    const blockedRecorder = blocked.window.WoVoice.attachRecorder({ form: fourth.form, button: fourth.button, canRecord: () => false, onSend: async () => {}, onError: () => {} });
    click(fourth.button);
    await flush();
    assert.equal(blockedRecorder.isBusy(), false);
});

test('P8 si el envío falla, la grabación queda en vista previa para reintentar', async () => {
    const env = voiceEnvironment(fakeMicrophone());
    const { form, button } = mountComposer(env);
    const errors = [];
    let attempts = 0;
    env.window.WoVoice.attachRecorder({
        form, button, canRecord: () => true,
        onSend: async () => { attempts += 1; if (attempts === 1) throw new Error('sin red'); },
        onError: (m) => errors.push(m),
    });
    const bar = byClass(form, 'wo-voice-bar');
    click(button);
    await flush();
    env.clock.now += 3000;
    click(byClass(bar, 'wo-voice-stop'));
    click(byClass(bar, 'wo-voice-send'));
    await flush();
    assert.equal(bar.getAttribute('data-state'), 'preview');
    assert.match(errors[0], /Tu grabación sigue aquí para reintentar/);
    click(byClass(bar, 'wo-voice-send'));
    await flush();
    assert.equal(attempts, 2);
    assert.equal(bar.hidden, true);
});

test('P8 reproductor: pide la URL firmada, reproduce, pausa, uno a la vez y avisa si no puede', async () => {
    FakeAudio.instances = [];
    const env = voiceEnvironment(fakeMicrophone());
    const requested = [];
    const host = env.document.createElement('div');
    env.document.body.appendChild(host);
    ['a.webm', 'b.webm'].forEach((name) => {
        const slot = env.document.createElement('div');
        slot.setAttribute('data-wo-voice-path', 'Q-1/u-1/' + name);
        slot.setAttribute('data-wo-voice-source', 'chat');
        slot.setAttribute('data-wo-voice-ms', '83000');
        host.appendChild(slot);
    });
    const getUrl = (sourceName, filePath) => { requested.push(sourceName + ':' + filePath); return Promise.resolve('https://storage.example/' + filePath); };
    env.window.WoVoice.hydrate(host, getUrl);
    const players = host.querySelectorAll('.wo-voice');
    assert.equal(players.length, 2);
    assert.equal(host.querySelectorAll('[data-wo-voice-path]').length, 0);
    assert.match(players[0].getAttribute('aria-label'), /Mensaje de voz, 1 minuto y 23 segundos/);
    assert.equal(byClass(players[0], 'wo-voice-time').textContent, '1:23');
    assert.equal(byClass(players[0], 'wo-voice-seek').getAttribute('aria-label'), 'Posición del mensaje de voz');
    assert.deepEqual(requested, [], 'la URL no se pide hasta que hace falta');

    click(byClass(players[0], 'wo-voice-toggle'));
    await flush();
    assert.deepEqual(requested, ['chat:Q-1/u-1/a.webm']);
    const first = FakeAudio.instances[0];
    assert.equal(first.src, 'https://storage.example/Q-1/u-1/a.webm');
    assert.equal(first.paused, false);
    assert.equal(players[0].classList.contains('is-playing'), true);

    // Reproducir el segundo pausa el primero.
    click(byClass(players[1], 'wo-voice-toggle'));
    await flush();
    assert.equal(first.paused, true);
    assert.equal(FakeAudio.instances[1].paused, false);

    // Un re-render reutiliza el mismo reproductor (el audio no se corta).
    const again = env.document.createElement('div');
    again.setAttribute('data-wo-voice-path', 'Q-1/u-1/b.webm');
    again.setAttribute('data-wo-voice-source', 'chat');
    host.appendChild(again);
    env.window.WoVoice.hydrate(host, getUrl);
    assert.equal(host.querySelectorAll('.wo-voice').at(-1), players[1]);

    // Formato que el navegador no reproduce: aviso y opción de abrirlo aparte.
    FakeAudio.instances[1].emit('error');
    assert.equal(players[1].classList.contains('is-error'), true);
    assert.equal(byClass(players[1], 'wo-voice-note').textContent, 'No se pudo reproducir en este navegador.');
    assert.equal(byClass(players[1], 'wo-voice-open').hidden, false);

    // URL que no es https: no se usa.
    const unsafe = env.window.WoVoice.player('x', { durationMs: 1000, getUrl: () => Promise.resolve('javascript:alert(1)') });
    host.appendChild(unsafe);
    const before = FakeAudio.instances.length;
    click(byClass(unsafe, 'wo-voice-toggle'));
    await flush();
    assert.equal(FakeAudio.instances.length, before);
    assert.equal(unsafe.classList.contains('is-error'), true);

    env.window.WoVoice.resetPlayers();
    assert.equal(FakeAudio.instances[0].paused, true);
});

/* ------------------------------ P9 · mensajes rápidos ------------------------------ */

function quickEnvironment(initial) {
    const rows = initial.map((row) => Object.assign({}, row));
    const calls = [];
    let seq = 100;
    const repo = {
        list: async (role, uid) => { calls.push(['list', role, uid]); return rows.map((row) => Object.assign({}, row)); },
        create: async (role, uid, value) => { calls.push(['create', role, uid, value]); const row = Object.assign({ id: 'new-' + (++seq), created_at: '2026-11-16' }, value); rows.push(row); return row; },
        update: async (role, uid, id, value) => { calls.push(['update', role, uid, id, value]); return Object.assign({ id }, value); },
        remove: async (role, uid, id) => { calls.push(['remove', role, uid, id]); },
        reorder: async (role, uid, changes) => { calls.push(['reorder', role, uid, changes]); },
    };
    const env = createEnvironment({ data: { QuickReplies: repo }, scripts: ['public/shared/js/wo-quick-replies.js'] });
    const form = env.document.createElement('form');
    const trigger = env.document.createElement('button');
    const input = env.document.createElement('input');
    input.setAttribute('maxlength', '2000');
    form.appendChild(trigger);
    form.appendChild(input);
    env.document.body.appendChild(form);
    return Object.assign(env, { form, trigger, input, calls, rows });
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('P9 rápidos: el panel lista las plantillas y un toque inserta el texto en el campo', async () => {
    const env = quickEnvironment([
        { id: 'b', title: 'Precio', body: 'El precio depende del tamaño.', sort: 1 },
        { id: 'a', title: 'Saludo', body: 'Hola, gracias por escribir.', sort: 0 },
    ]);
    const notices = [];
    let usable = false;
    env.window.WoQuickReplies.attach({
        role: 'artist', getUserId: () => 'u-1', button: env.trigger, form: env.form, input: env.input,
        canUse: () => usable, notify: (m) => notices.push(m),
    });
    const panel = byClass(env.form, 'wo-qr-panel');
    assert.equal(env.trigger.getAttribute('aria-controls'), panel.id);

    click(env.trigger);
    assert.equal(panel.hidden, true, 'no abre si el hilo está cerrado');
    usable = true;
    click(env.trigger);
    assert.equal(panel.hidden, false);
    assert.equal(env.trigger.getAttribute('aria-expanded'), 'true');
    await flush();
    assert.deepEqual(plain(env.calls), [['list', 'artist', 'u-1']]);
    const items = panel.querySelectorAll('.wo-qr-item');
    assert.deepEqual(items.map((i) => byClass(i, 'wo-qr-item-title').textContent), ['Saludo', 'Precio']);
    assert.equal(env.document.activeElement, items[0]);

    let inputEvents = 0;
    env.input.addEventListener('input', () => { inputEvents += 1; });
    env.input.value = 'Buen día.';
    click(items[1]);
    assert.equal(env.input.value, 'Buen día. El precio depende del tamaño.');
    assert.equal(inputEvents, 1, 'avisa al composer para habilitar "Enviar"');
    assert.equal(panel.hidden, true);
    assert.equal(env.trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(env.document.activeElement, env.input);

    // Escape cierra y devuelve el foco al botón.
    click(env.trigger);
    await flush();
    env.document.emit(new FakeEvent('keydown', { key: 'Escape' }));
    assert.equal(panel.hidden, true);
    assert.equal(env.document.activeElement, env.trigger);
});

test('P9 rápidos: gestión — crear, editar, ordenar y borrar con confirmación', async () => {
    const env = quickEnvironment([
        { id: 'a', title: 'Saludo', body: 'Hola.', sort: 0 },
        { id: 'b', title: 'Precio', body: 'Depende del tamaño.', sort: 1 },
    ]);
    const notices = [];
    const quick = env.window.WoQuickReplies.attach({
        role: 'client', getUserId: () => 'c-1', button: env.trigger, form: env.form, input: env.input,
        canUse: () => true, notify: (m) => notices.push(m),
    });
    quick.openManager();
    await flush();
    const dialog = byClass(env.document.body, 'wo-qr-modal');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    const rowsOf = () => dialog.querySelectorAll('.wo-qr-manage-row').map((r) => byClass(r, 'wo-qr-manage-title').textContent);
    assert.deepEqual(rowsOf(), ['Saludo', 'Precio']);
    assert.equal(byClass(dialog, 'wo-qr-count').textContent, '2 de 30');
    const form = byClass(dialog, 'wo-qr-form');
    const [titleInput] = form.querySelectorAll('input');
    const [bodyInput] = form.querySelectorAll('textarea');
    const submit = () => form.dispatchEvent(new FakeEvent('submit'));

    // Validación: sin nombre no guarda.
    bodyInput.value = 'Texto';
    submit();
    await flush();
    assert.equal(byClass(dialog, 'wo-qr-error').hidden, false);
    assert.equal(env.calls.filter((c) => c[0] === 'create').length, 0);

    // Crear.
    titleInput.value = '  Cuidados ';
    bodyInput.value = 'Lava con agua tibia.\nNo te rasques.';
    submit();
    await flush();
    assert.deepEqual(plain(env.calls.at(-1)), ['create', 'client', 'c-1', { sort: 2, title: 'Cuidados', body: 'Lava con agua tibia. No te rasques.' }]);
    assert.deepEqual(rowsOf(), ['Saludo', 'Precio', 'Cuidados']);
    assert.equal(titleInput.value, '', 'el formulario queda listo para otro');
    assert.deepEqual(notices, ['Mensaje rápido guardado.']);

    // Editar.
    click(dialog.querySelectorAll('.wo-qr-manage-row')[1].querySelector('[data-action="edit"]'));
    assert.equal(titleInput.value, 'Precio');
    assert.equal(byClass(dialog, 'wo-qr-form-title').textContent, 'Editar mensaje');
    bodyInput.value = 'Te paso el precio cuando vea la referencia.';
    submit();
    await flush();
    assert.deepEqual(plain(env.calls.at(-1)), ['update', 'client', 'c-1', 'b', { title: 'Precio', body: 'Te paso el precio cuando vea la referencia.' }]);
    assert.equal(byClass(dialog.querySelectorAll('.wo-qr-manage-row')[1], 'wo-qr-manage-body').textContent, 'Te paso el precio cuando vea la referencia.');

    // Ordenar: subir el último.
    const last = dialog.querySelectorAll('.wo-qr-manage-row')[2];
    assert.equal(dialog.querySelectorAll('.wo-qr-manage-row')[0].querySelector('[data-action="up"]').disabled, true);
    click(last.querySelector('[data-action="up"]'));
    await flush();
    assert.deepEqual(rowsOf(), ['Saludo', 'Cuidados', 'Precio']);
    assert.equal(env.calls.at(-1)[0], 'reorder');
    assert.deepEqual(plain(env.calls.at(-1)[3]).map((c) => c.sort).sort(), [1, 2]);

    // Borrar pide confirmación.
    click(dialog.querySelectorAll('.wo-qr-manage-row')[0].querySelector('[data-action="delete"]'));
    assert.equal(env.calls.filter((c) => c[0] === 'remove').length, 0);
    assert.equal(byClass(dialog, 'wo-qr-confirm').textContent, '¿Borrar?');
    click(dialog.querySelector('[data-action="cancel-delete"]'));
    assert.deepEqual(rowsOf(), ['Saludo', 'Cuidados', 'Precio']);
    click(dialog.querySelectorAll('.wo-qr-manage-row')[0].querySelector('[data-action="delete"]'));
    click(dialog.querySelector('[data-action="confirm-delete"]'));
    await flush();
    assert.deepEqual(plain(env.calls.at(-1)), ['remove', 'client', 'c-1', 'a']);
    assert.deepEqual(rowsOf(), ['Cuidados', 'Precio']);

    // Escape cierra el diálogo.
    dialog.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    assert.equal(byClass(env.document.body, 'wo-qr-modal'), null);
});

/* ------------------------------ P9 · automáticos ------------------------------ */

function automationsEnvironment(row, status) {
    const calls = [];
    const repo = {
        get: async (uid) => { calls.push(['get', uid]); return row; },
        save: async (uid, value) => { calls.push(['save', uid, value]); return value; },
        status: async () => status,
    };
    const env = createEnvironment({ data: { InboxAutomations: repo }, scripts: ['public/shared/js/artist-inbox-automations.js'] });
    return Object.assign(env, { calls });
}

test('P9 automáticos: el diálogo carga la configuración, valida y guarda', async () => {
    const env = automationsEnvironment(
        { greeting_enabled: true, greeting_body: 'Hola, te respondo pronto.', away_enabled: false, away_off_hours: true, away_vacation: true, away_body: '', away_vacation_body: '' },
        { away: true, reason: 'vacation', vacation_end: '2026-11-18', has_schedule: true }
    );
    const notices = [];
    env.window.WoInboxAutomations.open({ getUserId: () => 'u-1', notify: (m) => notices.push(m), accountHref: '/beta/artist/account#disponibilidad' });
    await flush();
    const dialog = byClass(env.document.body, 'wo-ia-modal');
    assert.equal(dialog.getAttribute('role'), 'dialog');
    const find = (id) => dialog.querySelectorAll('input, textarea').find((n) => n.id === id);
    const greetingOn = find('wo-ia-greeting-on');
    const awayOn = find('wo-ia-away-on');
    assert.equal(greetingOn.getAttribute('role'), 'switch');
    assert.equal(greetingOn.checked, true);
    assert.equal(find('wo-ia-greeting-body').value, 'Hola, te respondo pronto.');
    assert.equal(awayOn.checked, false);
    assert.equal(find('wo-ia-away-body').value, X.AUTO_DEFAULTS.away_body, 'sugiere un texto para la ausencia');
    assert.equal(find('wo-ia-away-hours').disabled, true, 'los momentos se eligen al activar la ausencia');
    assert.equal(byClass(dialog, 'wo-ia-status-text').textContent, 'Ahora: de vacaciones hasta el 18 de noviembre.');
    assert.equal(byClass(dialog, 'wo-ia-status').classList.contains('is-away'), true);
    assert.equal(byClass(dialog, 'wo-ia-status-link').href, '/beta/artist/account#disponibilidad');

    const form = byClass(dialog, 'wo-ia-form');
    const submit = () => form.dispatchEvent(new FakeEvent('submit'));

    // Ausencia activada sin texto: no guarda y marca el campo.
    awayOn.checked = true;
    awayOn.dispatchEvent(new FakeEvent('change'));
    assert.equal(find('wo-ia-away-hours').disabled, false);
    find('wo-ia-away-body').value = '   ';
    submit();
    await flush();
    assert.equal(env.calls.filter((c) => c[0] === 'save').length, 0);
    assert.equal(find('wo-ia-away-body').getAttribute('aria-invalid'), 'true');

    // Con texto, guarda la fila normalizada y cierra.
    find('wo-ia-away-body').value = ' Estoy fuera de mi horario. ';
    find('wo-ia-away-vacation').checked = false;
    submit();
    await flush();
    assert.deepEqual(plain(env.calls.at(-1)), ['save', 'u-1', {
        greeting_enabled: true, greeting_body: 'Hola, te respondo pronto.',
        away_enabled: true, away_off_hours: true, away_vacation: false,
        away_body: 'Estoy fuera de mi horario.', away_vacation_body: '',
    }]);
    assert.deepEqual(notices, ['Respuestas automáticas guardadas.']);
    assert.equal(byClass(env.document.body, 'wo-ia-modal'), null);
});

test('P9 automáticos: sin fila guardada arranca apagado y con textos sugeridos', async () => {
    const env = automationsEnvironment(null, { away: false, reason: 'no_schedule', has_schedule: false });
    env.window.WoInboxAutomations.open({ getUserId: () => 'u-2' });
    await flush();
    const dialog = byClass(env.document.body, 'wo-ia-modal');
    const find = (id) => dialog.querySelectorAll('input, textarea').find((n) => n.id === id);
    assert.equal(find('wo-ia-greeting-on').checked, false);
    assert.equal(find('wo-ia-away-on').checked, false);
    assert.equal(find('wo-ia-greeting-body').value, X.AUTO_DEFAULTS.greeting_body);
    assert.match(byClass(dialog, 'wo-ia-status-text').textContent, /solo se enviará durante tus vacaciones/);
    // Un segundo open() no duplica el diálogo.
    env.window.WoInboxAutomations.open({ getUserId: () => 'u-2' });
    assert.equal(env.document.body.querySelectorAll('.wo-ia-modal').length, 1);
    click(dialog.querySelectorAll('button').find((b) => b.textContent === 'Cancelar'));
    assert.equal(byClass(env.document.body, 'wo-ia-modal'), null);
});
