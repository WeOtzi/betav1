const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Narrador del recorrido guiado (wo-tour.js, oct 2026): motor de voz que no se
// corta ni avanza antes de tiempo, velocidad 1× a 2× y guion troceado en frases
// cortas. El script se carga en un sandbox de node:vm con un speechSynthesis
// falso y un reloj propio, así el test decide cada onstart/onend/onerror y el
// paso del tiempo.

const root = path.resolve(__dirname, '..');
const TOUR_SRC = fs.readFileSync(path.join(root, 'public/shared/js/wo-tour.js'), 'utf8');
const STEPS_SRC = fs.readFileSync(path.join(root, 'public/shared/js/wo-tour-steps.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(root, 'public/shared/css/wo-tour.css'), 'utf8');
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const EDGE_UA = CHROME_UA + ' Edg/130.0.0.0';
// Los objetos del sandbox tienen otro Object.prototype: se comparan como JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ------------------------------ dobles ------------------------------ */

// Reloj virtual: setTimeout/setInterval/Date.now del sandbox.
function makeClock() {
    let now = 0;
    let seq = 0;
    const timers = new Map();
    const add = (fn, ms, repeat) => {
        const id = ++seq;
        const delay = Math.max(0, Number(ms) || 0);
        timers.set(id, { fn, at: now + delay, every: Math.max(1, delay), repeat });
        return id;
    };
    return {
        get now() { return now; },
        setTimeout: (fn, ms) => add(fn, ms, false),
        setInterval: (fn, ms) => add(fn, ms, true),
        clearTimeout: (id) => { timers.delete(id); },
        clearInterval: (id) => { timers.delete(id); },
        tick(ms) {
            const end = now + ms;
            for (;;) {
                let nextId = null;
                let next = null;
                for (const [id, t] of timers) {
                    if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && id < nextId))) { next = t; nextId = id; }
                }
                if (!next) break;
                now = next.at;
                if (next.repeat) next.at += next.every; else timers.delete(nextId);
                next.fn();
            }
            now = end;
        },
    };
}

class FakeUtterance {
    constructor(text) {
        this.text = text;
        this.lang = '';
        this.voice = null;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        this.onboundary = null;
    }
}

// speechSynthesis controlado por el test: speak() solo encola; start/end/fail
// simulan lo que haría el navegador con la utterance de adelante.
function makeSynth(voices = []) {
    return {
        speaking: false,
        pending: false,
        paused: false,
        queue: [],
        spoken: [],
        cancels: 0,
        pauses: 0,
        getVoices() { return voices; },
        addEventListener() {},
        speak(u) { this.spoken.push(u); this.queue.push(u); this.pending = true; },
        cancel() {
            this.cancels += 1;
            const dropped = this.queue.splice(0);
            this.speaking = false;
            this.pending = false;
            // Como Chrome: lo cortado recibe un error (acá sincrónico, el caso más exigente).
            dropped.forEach((u) => { if (u.onerror) u.onerror({ error: 'interrupted' }); });
        },
        pause() { this.pauses += 1; this.paused = true; },
        resume() { this.paused = false; },
        start() {
            const u = this.queue[0];
            this.speaking = true;
            this.pending = this.queue.length > 1;
            if (u.onstart) u.onstart({});
            return u;
        },
        end({ silent = false } = {}) {
            const u = this.queue.shift();
            this.speaking = false;
            this.pending = this.queue.length > 0;
            if (!silent && u.onend) u.onend({});
            return u;
        },
        fail(error) {
            const u = this.queue.shift();
            this.speaking = false;
            this.pending = this.queue.length > 0;
            if (u.onerror) u.onerror({ error });
            return u;
        },
        say() { this.start(); return this.end(); },
        texts() { return this.spoken.map((u) => u.text); },
    };
}

// Como Blink (Chrome): speaking es true desde speak() mientras haya una
// utterance en curso, aunque el motor todavía no la haya empezado; onstart
// llega recién cuando el test llama start() (con la demora que quiera);
// pending es true solo con frases esperando detrás de la actual; cancel()
// vacía la cola sin eventos y el 'interrupted' de la actual llega asincrónico;
// una frase que el navegador descarta (página oculta en Android) llega como
// 'end' sin 'start' (end() sin start()).
function makeBlinkSynth(clock, voices = []) {
    const s = {
        queue: [],
        spoken: [],
        cancels: 0,
        pauses: 0,
        paused: false,
        get speaking() { return s.queue.length > 0; },
        get pending() { return s.queue.length > 1; },
        getVoices() { return voices; },
        addEventListener() {},
        speak(u) { s.spoken.push(u); s.queue.push(u); },
        cancel() {
            s.cancels += 1;
            const cur = s.queue[0];
            s.queue = [];
            if (cur) clock.setTimeout(() => { if (cur.onerror) cur.onerror({ error: 'interrupted' }); }, 5);
        },
        pause() { s.pauses += 1; },
        resume() {},
        start() { const u = s.queue[0]; if (u && u.onstart) u.onstart({}); return u; },
        // Blink saca la utterance de la cola antes de disparar onend.
        end() { const u = s.queue.shift(); if (u && u.onend) u.onend({}); return u; },
        say() { s.start(); return s.end(); },
        texts() { return s.spoken.map((u) => u.text); },
    };
    return s;
}

// Elemento mínimo para que el recorrido pinte su tarjeta en el sandbox.
// Reasignar innerHTML descarta los hijos, como en el DOM real.
function fakeElement(tag) {
    const kids = new Map();
    const classes = new Set();
    const listeners = {};
    let html = '';
    const el = {
        tagName: String(tag || 'div').toUpperCase(),
        style: {},
        hidden: false,
        textContent: '',
        offsetWidth: 0,
        offsetHeight: 0,
        get innerHTML() { return html; },
        set innerHTML(v) { html = String(v); kids.clear(); },
        classList: {
            add: (...c) => c.forEach((x) => classes.add(x)),
            remove: (...c) => c.forEach((x) => classes.delete(x)),
            toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); return want; },
            contains: (c) => classes.has(c),
        },
        setAttribute() {},
        getAttribute() { return null; },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {},
        click() { (listeners.click || []).slice().forEach((fn) => fn({ target: el })); },
        querySelector(sel) { if (!kids.has(sel)) kids.set(sel, fakeElement()); return kids.get(sel); },
        querySelectorAll() { return []; },
        appendChild(c) { return c; },
        contains() { return false; },
        closest() { return null; },
        focus() {},
        getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
        getClientRects() { return []; },
    };
    return el;
}

function makeListeners() {
    const map = {};
    return {
        add(type, fn) { (map[type] = map[type] || []).push(fn); },
        remove(type, fn) { if (map[type]) map[type] = map[type].filter((f) => f !== fn); },
        emit(type) { (map[type] || []).slice().forEach((fn) => fn({ type })); },
    };
}

function makeStorage(data) {
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
    };
}

function loadTour(opts = {}) {
    const clock = opts.clock || makeClock();
    const synth = opts.synth || (opts.blink ? makeBlinkSynth(clock, opts.voices) : makeSynth(opts.voices));
    const local = opts.local || {};
    const session = opts.session || {};
    const winEvents = makeListeners();
    const docEvents = makeListeners();
    const win = {
        console,
        URL,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
        requestAnimationFrame: (fn) => clock.setTimeout(fn, 16),
        cancelAnimationFrame: clock.clearTimeout,
        Date: { now: () => clock.now },
        innerWidth: 1280,
        innerHeight: 800,
        localStorage: makeStorage(local),
        sessionStorage: makeStorage(session),
        navigator: { userAgent: opts.ua || CHROME_UA, userActivation: { hasBeenActive: opts.activated !== false } },
        location: { pathname: opts.path || '/artist/dashboard', search: '', origin: 'http://localhost' },
        matchMedia: () => ({ matches: false }),
        addEventListener: (type, fn) => winEvents.add(type, fn),
        removeEventListener: (type, fn) => winEvents.remove(type, fn),
        document: {
            hidden: false,
            addEventListener: (type, fn) => docEvents.add(type, fn),
            removeEventListener: (type, fn) => docEvents.remove(type, fn),
            querySelector: opts.querySelector || (() => null),
            querySelectorAll: () => [],
            createElement: (tag) => fakeElement(tag),
            body: fakeElement('body'),
            documentElement: { classList: { add() {}, remove() {} } },
        },
    };
    if (opts.speech !== false) {
        win.speechSynthesis = synth;
        win.SpeechSynthesisUtterance = FakeUtterance;
    }
    win.window = win;
    vm.createContext(win);
    vm.runInContext(TOUR_SRC, win, { filename: 'wo-tour.js' });
    if (opts.withSteps) vm.runInContext(STEPS_SRC, win, { filename: 'wo-tour-steps.js' });
    // Pantalla bloqueada / otra app: document.hidden pasa a true y llega visibilitychange.
    const hide = () => { win.document.hidden = true; docEvents.emit('visibilitychange'); };
    const show = () => { win.document.hidden = false; docEvents.emit('visibilitychange'); };
    const fireWindow = (type) => winEvents.emit(type);
    // Avanza el reloj de a poco dejando correr las promesas del recorrido (doShow es async).
    const run = async (ms, step = 20) => {
        for (let t = 0; t < ms; t += step) {
            await new Promise((r) => setImmediate(r));
            clock.tick(Math.min(step, ms - t));
        }
        await new Promise((r) => setImmediate(r));
    };
    return { win, synth, clock, local, session, narrator: win.WoTour.narrator, internal: win.WoTour._internal, hide, show, fireWindow, run };
}

// Recorrido corto de un capítulo con pasos centrados (sin objetivo en la página).
function miniTour(t, texts) {
    t.win.WoTourSteps = {
        chapters: [{
            id: 'dashboard', title: 'Inicio', path: '/artist/dashboard',
            steps: texts.map((text, i) => ({ id: 'p' + i, target: null, title: 'Paso ' + (i + 1), text })),
        }],
    };
    return t.win.WoTour;
}

function recorder() {
    const calls = [];
    const fn = (ok, reason) => { calls.push([ok, reason]); };
    fn.calls = calls;
    return fn;
}

const stepText = (st) => (Array.isArray(st.text) ? st.text.join(' ') : st.text);

/* ------------------------------ troceado ------------------------------ */

test('el script no usa lookbehind (rompe Safari < 16.4) y expone narrador e internos', () => {
    assert.ok(!TOUR_SRC.includes('(?<='), 'sin (?<= en wo-tour.js');
    assert.ok(!TOUR_SRC.includes('(?<!'), 'sin (?<! en wo-tour.js');
    const { win, narrator, internal } = loadTour();
    for (const fn of ['supported', 'speak', 'stop', 'isSpeaking', 'getRate', 'setRate', 'formatRate']) {
        assert.equal(typeof narrator[fn], 'function', 'narrator.' + fn);
    }
    assert.deepEqual(plain(narrator.RATES), [1, 1.25, 1.5, 1.75, 2]);
    assert.deepEqual(Object.keys(internal).sort(), ['chunkText', 'formatRate', 'nextRate', 'prevRate']);
    assert.equal(narrator.supported(), true);
    assert.equal(win.WoTourSteps, undefined, 'el narrador funciona sin el guion cargado');
});

test('chunkText trocea cada paso del guion en frases de hasta 160 caracteres sin perder texto', () => {
    const { win, internal } = loadTour({ withSteps: true });
    let chunks = 0;
    let longest = 0;
    for (const ch of win.WoTourSteps.chapters) {
        for (const st of ch.steps) {
            for (const text of [stepText(st), st.speech].filter(Boolean)) {
                const parts = plain(internal.chunkText(text));
                const id = ch.id + '/' + st.id;
                assert.ok(parts.length > 0, id + ' tiene frases');
                for (const p of parts) assert.ok(p.length <= 160, id + ': frase de ' + p.length + ' caracteres');
                assert.equal(parts.join(' '), text.replace(/\s+/g, ' ').trim(), id + ': unir las frases reproduce el texto');
                chunks += parts.length;
                longest = Math.max(longest, ...parts.map((p) => p.length));
            }
        }
    }
    assert.ok(chunks > 100, 'se trocearon ' + chunks + ' frases');
    assert.ok(longest <= 160);
});

test('chunkText corta por frase, después por coma/punto y coma/dos puntos y en último caso por palabras', () => {
    const { internal } = loadTour();
    assert.deepEqual(plain(internal.chunkText('Hola.  Chau…   ¿Seguimos?  Sí')), ['Hola.', 'Chau…', '¿Seguimos?', 'Sí']);
    assert.deepEqual(plain(internal.chunkText('Subí 1.5 veces más. Listo.')), ['Subí 1.5 veces más.', 'Listo.'], 'un punto sin espacio no corta');
    assert.deepEqual(plain(internal.chunkText(['Primer párrafo.', 'Segundo párrafo.'])), ['Primer párrafo.', 'Segundo párrafo.']);
    const a = 'a'.repeat(100);
    const b = 'b'.repeat(100);
    assert.deepEqual(plain(internal.chunkText(a + ', ' + b + '.')), [a + ',', b + '.']);
    assert.deepEqual(plain(internal.chunkText(a + '; ' + b + ': fin.')), [a + ';', b + ': fin.']);
    const words = Array.from({ length: 60 }, (_, i) => 'palabra' + i).join(' ');
    const parts = plain(internal.chunkText(words));
    assert.ok(parts.length > 1 && parts.every((p) => p.length <= 160));
    assert.equal(parts.join(' '), words);
    assert.deepEqual(plain(internal.chunkText('   ')), []);
});

/* ------------------------------ velocidad ------------------------------ */

test('nextRate/prevRate recorren 1× → 2× en ciclo y formatRate usa coma decimal', () => {
    const { internal, narrator } = loadTour();
    const { nextRate, prevRate, formatRate } = internal;
    assert.deepEqual([1, 1.25, 1.5, 1.75, 2].map(nextRate), [1.25, 1.5, 1.75, 2, 1]);
    assert.deepEqual([1, 1.25, 1.5, 1.75, 2].map(prevRate), [2, 1, 1.25, 1.5, 1.75]);
    assert.equal(nextRate(1.1), 1.25, 'un valor suelto se ajusta al más cercano');
    assert.deepEqual([1, 1.25, 1.5, 1.75, 2].map(formatRate), ['1×', '1,25×', '1,5×', '1,75×', '2×']);
    assert.equal(narrator.formatRate(1.25), '1,25×');
    assert.equal(formatRate('x'), '1×');
});

test('la velocidad arranca en 1×, se guarda en wo_tour_rate y se aplica a cada utterance', () => {
    const fresh = loadTour();
    assert.equal(fresh.narrator.getRate(), 1);
    assert.equal(fresh.narrator.setRate(1.3), 1.25, 'setRate ajusta a RATES');
    assert.equal(fresh.local.wo_tour_rate, '1.25');

    const saved = loadTour({ local: { wo_tour_rate: '1.75' } });
    assert.equal(saved.narrator.getRate(), 1.75);
    saved.narrator.speak('Una frase para probar la velocidad.', recorder());
    assert.equal(saved.synth.spoken[0].rate, 1.75);

    const broken = loadTour({ local: { wo_tour_rate: 'rapidísimo' } });
    assert.equal(broken.narrator.getRate(), 1);
});

test('setRate a mitad de la narración retoma la frase actual a la nueva velocidad, no el texto entero', () => {
    const { narrator, synth, clock, local } = loadTour();
    const done = recorder();
    narrator.speak('Primera frase de prueba. Segunda frase de prueba. Tercera frase de prueba.', done);
    synth.say();
    assert.deepEqual(synth.texts(), ['Primera frase de prueba.', 'Segunda frase de prueba.']);
    synth.start();
    const cancelsBefore = synth.cancels;
    narrator.setRate(1.5);
    assert.equal(synth.cancels, cancelsBefore + 1, 'corta la frase en curso');
    assert.equal(synth.spoken.length, 2, 'espera antes de volver a hablar');
    clock.tick(119);
    assert.equal(synth.spoken.length, 2, '120 ms entre cancel() y speak()');
    clock.tick(1);
    assert.equal(synth.spoken.length, 3);
    assert.equal(synth.spoken[2].text, 'Segunda frase de prueba.', 'repite la frase actual');
    assert.equal(synth.spoken[2].rate, 1.5);
    synth.say();
    assert.equal(synth.spoken[3].text, 'Tercera frase de prueba.');
    assert.equal(synth.spoken[3].rate, 1.5);
    synth.say();
    assert.deepEqual(done.calls, [[true, 'end']]);
    assert.equal(synth.spoken.length, 4, 'la primera frase no se repitió');
    assert.equal(local.wo_tour_rate, '1.5');
    assert.equal(narrator.getRate(), 1.5);
});

/* ------------------------------ robustez ------------------------------ */

test('sin onend en la última frase, done espera a que speechSynthesis deje de hablar', () => {
    const { narrator, synth, clock } = loadTour();
    const done = recorder();
    assert.equal(narrator.speak('Primera frase. Última frase sin onend.', done), true);
    synth.say();
    synth.start();
    // onend nunca llega y el navegador sigue hablando un buen rato.
    clock.tick(20000);
    assert.deepEqual(done.calls, [], 'no termina mientras speaking es true');
    assert.equal(narrator.isSpeaking(), true);
    assert.equal(synth.spoken.length, 2, 'no adelanta frases');
    assert.equal(synth.cancels, 0, 'no corta el audio');
    // Termina el audio, pero el evento se perdió.
    synth.speaking = false;
    synth.queue.shift();
    clock.tick(650);
    assert.deepEqual(done.calls, [], 'necesita ≥700 ms en silencio');
    clock.tick(400);
    assert.deepEqual(done.calls, [[true, 'end']]);
    assert.equal(narrator.isSpeaking(), false);
});

test('un onend tardío después del watchdog no avanza dos veces', () => {
    const { narrator, synth, clock } = loadTour();
    const done = recorder();
    narrator.speak('Uno de tres. Dos de tres. Tres de tres.', done);
    synth.start();
    const first = synth.end({ silent: true }); // onend perdido
    clock.tick(1000);
    assert.deepEqual(synth.texts(), ['Uno de tres.', 'Dos de tres.'], 'el watchdog pasó a la segunda');
    first.onend({}); // llega tarde
    assert.equal(synth.spoken.length, 2, 'no se salteó la segunda frase');
    synth.say();
    synth.say();
    assert.deepEqual(synth.texts(), ['Uno de tres.', 'Dos de tres.', 'Tres de tres.']);
    assert.deepEqual(done.calls, [[true, 'end']]);
});

test("un 'interrupted' en una utterance recién creada (no pedido por nosotros) se reintenta", () => {
    const { narrator, synth, clock } = loadTour();
    const done = recorder();
    narrator.speak('Una sola frase para la prueba del narrador.', done);
    synth.fail('interrupted');
    assert.equal(synth.spoken.length, 1);
    clock.tick(200);
    assert.deepEqual(synth.texts(), ['Una sola frase para la prueba del narrador.', 'Una sola frase para la prueba del narrador.']);
    synth.say();
    assert.deepEqual(done.calls, [[true, 'end']]);
});

test('otros errores se reintentan una vez y después se salta solo esa frase', () => {
    const { narrator, synth, clock } = loadTour();
    const done = recorder();
    narrator.speak('Frase que falla. Frase que sí sale.', done);
    synth.fail('synthesis-failed');
    clock.tick(200);
    synth.fail('synthesis-failed');
    clock.tick(200);
    assert.deepEqual(synth.texts(), ['Frase que falla.', 'Frase que falla.', 'Frase que sí sale.']);
    synth.say();
    assert.deepEqual(done.calls, [[true, 'end']], 'la narración sigue y termina');
});

test('con el motor quieto (speaking en false), una frase que nunca arranca se reintenta a los 5 s y después se salta', () => {
    const { narrator, synth, clock } = loadTour();
    narrator.speak('Frase colgada. Frase siguiente.', recorder());
    clock.tick(4900);
    assert.equal(synth.spoken.length, 1);
    clock.tick(300);
    assert.deepEqual(synth.texts(), ['Frase colgada.', 'Frase colgada.']);
    clock.tick(5300);
    assert.deepEqual(synth.texts(), ['Frase colgada.', 'Frase colgada.', 'Frase siguiente.']);
});

test('Chrome: speaking en true sin onstart no cuenta como arranque; a los 20 s se cancela, se reintenta una vez y después se salta', () => {
    const { narrator, synth, clock } = loadTour({ blink: true });
    const done = recorder();
    narrator.speak('Frase colgada. Frase siguiente.', done);
    assert.equal(synth.speaking, true, 'Blink pone speaking en true dentro de speak()');
    clock.tick(19900);
    assert.equal(synth.spoken.length, 1, 'el corte de 5 s es solo para el motor quieto');
    assert.equal(synth.cancels, 0, 'no corta antes de 20 s');
    assert.deepEqual(done.calls, []);
    clock.tick(300);
    assert.equal(synth.cancels, 1, 'cancela la frase colgada');
    assert.deepEqual(synth.texts(), ['Frase colgada.', 'Frase colgada.'], 'un reintento, 120 ms después del cancel');
    clock.tick(19700);
    assert.equal(synth.spoken.length, 2, 'el reintento también espera 20 s');
    clock.tick(700);
    assert.equal(synth.cancels, 2);
    assert.deepEqual(synth.texts(), ['Frase colgada.', 'Frase colgada.', 'Frase siguiente.'], 'después del reintento se salta solo esa frase');
    synth.say();
    assert.deepEqual(done.calls, [[true, 'end']], 'la narración sigue y termina');
});

test('Chrome: una frase que disparó onstart nunca se corta, aunque el onstart llegue tarde o suene más de 20 s', () => {
    const { narrator, synth, clock } = loadTour({ blink: true });
    const done = recorder();
    narrator.speak('Una frase larga con una voz remota. Otra frase.', done);
    clock.tick(6000); // voz remota: el onstart llega a los 6 s, con speaking en true desde speak()
    assert.equal(synth.cancels, 0, 'no se reintenta a los 5 s con el motor ocupado');
    synth.start();
    clock.tick(60000);
    assert.equal(synth.cancels, 0, 'no corta una frase que arrancó');
    assert.equal(synth.spoken.length, 1, 'no adelanta frases mientras suena');
    assert.deepEqual(done.calls, []);
    synth.end();
    assert.deepEqual(synth.texts(), ['Una frase larga con una voz remota.', 'Otra frase.']);
    synth.say();
    assert.deepEqual(done.calls, [[true, 'end']]);
});

test('un motor sin eventos que estuvo ocupado y se calla cuenta como onend perdido, sin repetir la frase', () => {
    const { narrator, synth, clock } = loadTour();
    const done = recorder();
    narrator.speak('Frase sin eventos. Segunda frase.', done);
    synth.speaking = true; // suena sin onstart ni onboundary
    clock.tick(3000);
    synth.speaking = false;
    synth.pending = false;
    synth.queue.shift(); // y termina sin onend
    clock.tick(1000);
    assert.deepEqual(synth.texts(), ['Frase sin eventos.', 'Segunda frase.'], 'pasa a la siguiente');
    assert.equal(synth.cancels, 0, 'no la cancela ni la repite');
    synth.say();
    assert.deepEqual(done.calls, [[true, 'end']]);
});

test('stop() corta sin reintentar y avisa done(false); una narración nueva reemplaza a la anterior', () => {
    const { narrator, synth, clock } = loadTour();
    const first = recorder();
    narrator.speak('Frase que se corta. Frase que nunca suena.', first);
    synth.start();
    narrator.stop();
    clock.tick(1000);
    assert.equal(synth.spoken.length, 1, 'el interrupted de nuestro propio cancel no se reintenta');
    assert.deepEqual(first.calls, [[false, 'stopped']]);
    assert.equal(narrator.isSpeaking(), false);

    const a = recorder();
    const b = recorder();
    narrator.speak('Narración A.', a);
    synth.start();
    narrator.speak('Narración B.', b);
    assert.equal(synth.spoken.length, 2, 'B espera 120 ms después del cancel');
    clock.tick(120);
    assert.equal(synth.spoken[2].text, 'Narración B.');
    synth.say();
    clock.tick(1);
    assert.deepEqual(a.calls, [[false, 'replaced']]);
    assert.deepEqual(b.calls, [[true, 'end']]);
});

test('si algo ya estaba sonando, cancela y espera 120 ms antes del primer speak()', () => {
    const { narrator, synth, clock } = loadTour();
    synth.speaking = true;
    narrator.speak('Frase después de cancelar.', recorder());
    assert.equal(synth.cancels, 1);
    assert.equal(synth.spoken.length, 0);
    clock.tick(119);
    assert.equal(synth.spoken.length, 0);
    clock.tick(1);
    assert.equal(synth.spoken.length, 1);
});

test('keep-alive pause()/resume() cada 10 s solo con voces remotas en Chromium que no es Edge', () => {
    const remote = [{ name: 'Google español', lang: 'es-ES', localService: false }];
    const chrome = loadTour({ voices: remote });
    chrome.narrator.speak('Una frase larga que suena con una voz remota.', recorder());
    assert.equal(chrome.synth.spoken[0].voice.name, 'Google español');
    chrome.synth.start();
    chrome.clock.tick(10000);
    assert.equal(chrome.synth.pauses, 1);
    chrome.clock.tick(10000);
    assert.equal(chrome.synth.pauses, 2);

    const edge = loadTour({ voices: remote, ua: EDGE_UA });
    edge.narrator.speak('Una frase larga que suena con una voz remota.', recorder());
    edge.synth.start();
    edge.clock.tick(20000);
    assert.equal(edge.synth.pauses, 0, 'Edge no lo necesita');

    const local = loadTour({ voices: [{ name: 'Microsoft Sabina', lang: 'es-MX', localService: true }] });
    local.narrator.speak('Una frase larga que suena con una voz local.', recorder());
    local.synth.start();
    local.clock.tick(20000);
    assert.equal(local.synth.pauses, 0, 'las voces locales no se cortan');
});

test('sin voz, con la voz apagada o sin gesto previo, done(false) y no se encola nada', () => {
    const none = loadTour({ speech: false });
    const d1 = recorder();
    assert.equal(none.narrator.supported(), false);
    assert.equal(none.narrator.speak('Texto sin motor de voz.', d1), false);
    none.clock.tick(1);
    assert.deepEqual(d1.calls, [[false, 'unsupported']]);

    const off = loadTour({ local: { wo_tour_voice: '0' } });
    const d2 = recorder();
    assert.equal(off.narrator.speak('Texto con la voz apagada.', d2), false);
    off.clock.tick(1);
    assert.deepEqual(d2.calls, [[false, 'off']]);
    assert.equal(off.synth.spoken.length, 0);

    const blocked = loadTour({ activated: false });
    const d3 = recorder();
    let hinted = 0;
    assert.equal(blocked.narrator.speak('Texto antes del primer click.', d3, { onBlocked: () => { hinted += 1; } }), false);
    blocked.clock.tick(1);
    assert.equal(hinted, 1);
    assert.deepEqual(d3.calls, [[false, 'gesture']]);
});

/* --------------------------- página oculta --------------------------- */

test('con la página oculta el narrador se corta con motivo hidden y no habla hasta que vuelve a verse', () => {
    const t = loadTour({ blink: true });
    const done = recorder();
    t.narrator.speak('Primera frase que suena. Segunda frase que se corta. Tercera frase.', done);
    t.synth.say();
    t.synth.start();
    t.hide(); // pantalla bloqueada a mitad de la segunda frase
    assert.equal(t.synth.cancels, 1, 'corta la voz');
    assert.equal(t.narrator.isSpeaking(), false);
    t.clock.tick(1);
    assert.deepEqual(done.calls, [[false, 'hidden']]);
    t.clock.tick(60000);
    assert.equal(t.synth.spoken.length, 2, 'no encola el resto con la página oculta');
    assert.deepEqual(done.calls, [[false, 'hidden']], 'el interrupted del cancel no se cuenta ni se reintenta');

    const hiddenTry = recorder();
    assert.equal(t.narrator.speak('Otro paso.', hiddenTry), false, 'oculta no arranca');
    t.clock.tick(1);
    assert.deepEqual(hiddenTry.calls, [[false, 'hidden']]);
    assert.equal(t.synth.spoken.length, 2);

    t.show();
    const back = recorder();
    assert.equal(t.narrator.speak('De vuelta.', back), true, 'visible otra vez, habla como siempre');
    t.synth.say();
    assert.deepEqual(back.calls, [[true, 'end']]);
});

test("las frases que el navegador da por terminadas con la página oculta no cuentan como oídas", () => {
    // Chrome Android: el 'end' de una frase descartada puede llegar antes que visibilitychange.
    const t = loadTour({ blink: true });
    const done = recorder();
    t.narrator.speak('Primera frase. Segunda frase. Tercera frase.', done);
    t.synth.say();
    t.win.document.hidden = true; // todavía sin el evento
    t.synth.end(); // la segunda llega como 'end' sin 'start'
    t.clock.tick(1);
    assert.deepEqual(done.calls, [[false, 'hidden']], 'no termina como si se hubiera oído');
    assert.equal(t.synth.spoken.length, 2, 'no sigue con la tercera');

    // pagehide llega antes de que document.hidden sea true.
    const p = loadTour({ blink: true });
    const d2 = recorder();
    p.narrator.speak('Frase que suena. Frase que no.', d2);
    p.synth.start();
    p.fireWindow('pagehide');
    p.clock.tick(1);
    assert.deepEqual(d2.calls, [[false, 'hidden']]);
    assert.equal(p.narrator.speak('Con la página yéndose.', recorder()), false);
    p.fireWindow('pageshow');
    assert.equal(p.narrator.speak('Volvió desde el historial.', recorder()), true);
});

test('recorrido: con la página visible, termina de narrar y avanza solo como siempre', async () => {
    const t = loadTour({ blink: true });
    const tour = miniTour(t, ['Uno a. Uno b.', 'Dos.', 'Tres.']);
    tour.start();
    await t.run(300);
    assert.equal(tour.state.step, 0);
    assert.deepEqual(t.synth.texts(), ['Uno a.']);
    t.synth.say();
    t.synth.say();
    await t.run(800);
    assert.equal(tour.state.step, 0, 'espera 900 ms después de la narración');
    await t.run(500);
    assert.equal(tour.state.step, 1);
    assert.deepEqual(t.synth.texts(), ['Uno a.', 'Uno b.', 'Dos.']);
    tour.stop({ silent: true });
});

test('recorrido: con la pantalla bloqueada no avanza solo y al volver narra el paso desde el principio', async () => {
    const t = loadTour({ blink: true });
    const tour = miniTour(t, ['Uno a. Uno b. Uno c.', 'Dos.', 'Tres.']);
    tour.start();
    await t.run(300);
    t.synth.say(); // se oyó la primera frase
    t.synth.start();
    t.hide(); // bloqueo a mitad de la segunda
    await t.run(60000, 250);
    assert.equal(tour.state.step, 0, 'no avanzó con la página oculta');
    assert.deepEqual(t.synth.texts(), ['Uno a.', 'Uno b.'], 'no habló con la página oculta');

    t.show();
    await t.run(200);
    assert.deepEqual(t.synth.texts(), ['Uno a.', 'Uno b.', 'Uno a.'], 'vuelve a narrar el paso desde la primera frase');
    t.synth.say();
    t.synth.say();
    t.synth.say();
    await t.run(1500);
    assert.equal(tour.state.step, 1, 'después de oírlo entero avanza como siempre');
    assert.equal(t.synth.texts().at(-1), 'Dos.');
    tour.stop({ silent: true });
});

test('recorrido: si el navegador da la frase por terminada antes de avisar que se ocultó, el paso no avanza', async () => {
    const t = loadTour({ blink: true });
    const tour = miniTour(t, ['Uno a. Uno b. Uno c.', 'Dos.']);
    tour.start();
    await t.run(300);
    t.synth.say();
    t.synth.start();
    // Chrome Android: corta la segunda y la reporta como 'end' antes de visibilitychange.
    t.win.document.hidden = true;
    t.synth.end();
    await t.run(50);
    t.hide();
    await t.run(30000, 250);
    assert.equal(tour.state.step, 0);
    assert.deepEqual(t.synth.texts(), ['Uno a.', 'Uno b.'], 'la tercera no se encoló como si la segunda se hubiera oído');
    t.show();
    await t.run(200);
    assert.deepEqual(t.synth.texts(), ['Uno a.', 'Uno b.', 'Uno a.'], 'vuelve a narrar desde el principio');
    tour.stop({ silent: true });
});

test('recorrido: si se oculta mientras espera para avanzar, no avanza y al volver vuelve a narrar el paso', async () => {
    const t = loadTour({ blink: true });
    const tour = miniTour(t, ['Uno.', 'Dos.']);
    tour.start();
    await t.run(300);
    t.synth.say(); // narración completa: arranca la espera de 900 ms
    await t.run(300);
    t.hide();
    await t.run(30000, 250);
    assert.equal(tour.state.step, 0, 'la espera no se cumple con la página oculta');
    t.show();
    await t.run(200);
    assert.deepEqual(t.synth.texts(), ['Uno.', 'Uno.'], 'narra el paso otra vez');
    assert.equal(tour.state.step, 0);
    t.synth.say();
    await t.run(1500);
    assert.equal(tour.state.step, 1);
    tour.stop({ silent: true });
});

test('recorrido: ocultar y volver antes de que corran los timers narra una sola vez', async () => {
    const t = loadTour({ blink: true });
    const tour = miniTour(t, ['Uno a. Uno b.', 'Dos.']);
    tour.start();
    await t.run(300);
    t.synth.start();
    t.hide();
    t.show(); // el aviso 'hidden' del narrador todavía no llegó (timers frenados en segundo plano)
    await t.run(1000);
    assert.deepEqual(t.synth.texts(), ['Uno a.', 'Uno a.'], 'una sola narración nueva');
    t.synth.say();
    t.synth.say();
    await t.run(1500);
    assert.equal(tour.state.step, 1);
    assert.deepEqual(t.synth.texts(), ['Uno a.', 'Uno a.', 'Uno b.', 'Dos.']);
    tour.stop({ silent: true });
});

/* ------------------------------ recorrido ------------------------------ */

test('autoResume: un wo_tour_state viejo de otra página no bloquea ?tour=1', () => {
    const stale = JSON.stringify({ active: true, chapter: 5, step: 2 });
    const run = (opts, wantsTour) => {
        const t = loadTour(Object.assign({ withSteps: true }, opts));
        const calls = [];
        t.win.WoTour.start = (o) => { calls.push(plain(o || {})); };
        t.win.WoTour.autoResume({ wantsTour });
        t.clock.tick(700);
        return calls;
    };
    assert.deepEqual(run({ session: { wo_tour_state: stale }, path: '/artist/dashboard' }, true), [{ chapter: 0 }]);
    assert.deepEqual(run({ session: { wo_tour_state: stale }, path: '/artist/inbox' }, true), [{ chapter: 10 }]);
    assert.deepEqual(run({ session: { wo_tour_state: stale }, path: '/artist/dashboard' }, false), [], 'sin ?tour=1 la barra ofrece retomar');
    assert.deepEqual(run({ session: { wo_tour_state: stale }, path: '/studio-spots' }, false), [{ chapter: 5, step: 2 }], 'en la página del capítulo guardado retoma');
    assert.deepEqual(run({ path: '/artist/settings' }, true), [{}], 'fuera del guion arranca desde el primer capítulo');
});

test('la tarjeta suma el botón de velocidad después del avance automático y las teclas + / -', () => {
    assert.match(TOUR_SRC, /wo-tour-card__auto[\s\S]*?wo-tour-card__rate" title="Velocidad de la voz" aria-label="' \+ esc\(rateLabel\(\)\)/);
    assert.match(TOUR_SRC, /return 'Velocidad de la voz: ' \+ formatRate\(prefs\.rate\);/);
    assert.match(TOUR_SRC, /changeRate\(nextRate\(prefs\.rate\)\)/);
    assert.match(TOUR_SRC, /e\.key === '\+' \|\| e\.key === '=' \|\| e\.key === '-'/);
    assert.match(TOUR_SRC, /!e\.ctrlKey && !e\.metaKey/, 'no pisa el zoom del navegador');
    assert.match(TOUR_SRC, /narrator\.isSpeaking\(\) \|\| synthFlag\('speaking'\)/, 'no avanza solo con el navegador hablando');
    const css = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\.wo-tour-card__tools \.wo-tour-card__rate\{([^}]*)\}/);
    assert.ok(rule, 'regla del botón de velocidad');
    assert.match(rule[1], /font-family:var\(--font-mono\)/);
    assert.match(rule[1], /min-width:var\(--tap-target-min\)/);
    assert.doesNotMatch(rule[1], /#[0-9a-fA-F]{3,8}\b/);
});

test('a 320 px la navegación de la tarjeta no desborda: mobile primero, los botones bajan de línea y el label largo parte', () => {
    const css = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
    // Las reglas fuera de cualquier @media son las de móvil.
    const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
    const nav = base.match(/\.wo-tour-card__nav\{([^}]*)\}/);
    assert.ok(nav, 'regla base de la navegación');
    assert.match(nav[1], /display:flex/);
    assert.match(nav[1], /flex-wrap:wrap/);
    assert.match(nav[1], /min-width:0/);
    const btn = base.match(/\.wo-tour-card__nav \.wo-btn\{([^}]*)\}/);
    assert.ok(btn, 'regla base de los botones de la navegación');
    for (const re of [/white-space:normal/, /min-width:0/, /max-width:100%/]) assert.match(btn[1], re);
    // Desde 768 px (min-width, no max-width) los labels vuelven a una sola línea.
    const desk = css.match(/@media \(min-width:48rem\)\{((?:[^{}]*\{[^}]*\})*)[^{}]*\}/);
    assert.ok(desk, '@media (min-width:48rem)');
    assert.match(desk[1], /\.wo-tour-card__nav \.wo-btn\{[^}]*white-space:nowrap/);
    // En ningún ancho la navegación vuelve a ser una fila fija.
    assert.doesNotMatch(css, /\.wo-tour-card__nav\{[^}]*(inline-flex|flex-wrap:nowrap)/);
    for (const rule of [nav[1], btn[1], desk[1]]) assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b/, 'solo tokens');
    assert.match(nav[1], /gap:var\(--space-2\)/);
});

test('el paso final sale del demo hacia el modo asistido', () => {
    assert.match(TOUR_SRC, /if \(step\.exitAssist\) window\.WoDemo\.disable\(\{ assist: true \}\); else window\.WoDemo\.disable\(\);/);
    const { win } = loadTour({ withSteps: true });
    const chapters = win.WoTourSteps.chapters;
    const last = chapters[chapters.length - 1].steps.at(-1);
    assert.equal(last.id, 'end');
    assert.equal(last.target, null);
    assert.equal(last.exitAssist, true);
    assert.equal(last.exitLabel, 'Salir del demo y configurar mi perfil →');
    assert.match(stepText(last), /modo asistido te guía paso a paso para configurar tu perfil/);
});

test('el guion explica velocidad, modo asistido, contacto, validación de Instagram y modalidad', () => {
    const selectors = [];
    const { win } = loadTour({ withSteps: true, querySelector: (sel) => { selectors.push(sel); return null; } });
    const byId = (chapter) => Object.fromEntries(win.WoTourSteps.chapters.find((c) => c.id === chapter).steps.map((s) => [s.id, s]));
    const dash = byId('dashboard');
    assert.match(dash.intro.hint, /Con el botón 1× cambiás la velocidad de la voz\./);
    assert.match(dash.menu.text, /Modo asistido/);
    assert.match(dash.menu.text, /modo demo, lo desactivás desde este mismo menú/);

    const account = win.WoTourSteps.chapters.find((c) => c.id === 'account');
    const ids = account.steps.map((s) => s.id);
    const acc = byId('account');
    assert.match(acc.perfil.text, /WhatsApp y email de contacto/);
    assert.ok(ids.indexOf('ig-verify') === ids.indexOf('portafolio') + 1, 'ig-verify sigue a portafolio');
    assert.equal(acc['ig-verify'].target, '#aac-ig-verify');
    for (const re of [/código por email/, /@weotzi/, /mensaje directo/, /ocultas para los clientes/]) assert.match(acc['ig-verify'].text, re);
    assert.ok(ids.indexOf('modalidad') < ids.indexOf('disponibilidad'), 'modalidad antes de los horarios');
    assert.equal(acc.modalidad.target, '#aac-modalidad');
    for (const re of [/Estudio/, /Independiente/, /Ambos/, /en qué estudio/]) assert.match(acc.modalidad.text, re);

    // Los `before` abren la sección correcta del centro de la cuenta.
    assert.equal(acc['ig-verify'].before(), false, 'sin el link de la sección el paso se salta');
    assert.equal(acc.modalidad.before(), false);
    assert.deepEqual(selectors, ['[data-aac-nav="portafolio"]', '[data-aac-nav="disponibilidad"]']);
});
