/**
 * WE OTZI - Recorrido guiado del artista (motor)
 * ----------------------------------------------
 * Tutorial narrado por secciones sobre el modo demo (wo-demo.js). Para cada
 * paso: oscurece toda la pantalla salvo la sección enfocada (cuatro paneles
 * de velo + marco), muestra una tarjeta con el texto y lo lee en voz alta con
 * la Web Speech API (voz en español si el navegador la tiene). Entre paso y
 * paso el velo se retira, se hace scroll a la sección siguiente y vuelve a
 * cerrarse, como pide el guion ("vuelve a mostrarse toda la pantalla").
 *
 * Los capítulos y pasos viven en wo-tour-steps.js (window.WoTourSteps). El
 * estado (capítulo/paso) se guarda en sessionStorage para continuar al
 * cambiar de página. Atajos: → / Enter siguiente, ← anterior, Esc salir.
 *
 * Voz: los navegadores exigen una interacción del usuario antes de hablar en
 * cada documento nuevo; al retomar el recorrido en otra página, el primer
 * paso muestra "ESCUCHAR ▶" hasta ese click.
 *
 * Narrador: `window.WoTour.narrator` es el motor de voz, usable sin recorrido
 * y sin WoTourSteps (lo usa también el panel del modo asistido). Velocidad
 * 1× a 2× (botón de la tarjeta, teclas + y -), guardada en wo_tour_rate.
 */
(function () {
    'use strict';

    // Una sola instancia aunque lo carguen el demo y el panel asistido.
    if (window.WoTour && window.WoTour.narrator) return;

    var KEYS = { state: 'wo_tour_state', voice: 'wo_tour_voice', auto: 'wo_tour_auto', rate: 'wo_tour_rate' };
    var WAIT_TIMEOUT_MS = 9000;
    var CLEAR_MS = 260;
    var SCROLL_SETTLE_MS = 420;
    var AUTO_ADVANCE_MS = 900;
    var PAD = 8;

    var state = {
        active: false, chapter: 0, step: 0,
        voice: true, auto: true, token: 0,
        target: null, interactive: false, centered: false,
        raf: 0, lastRect: null, timer: null,
        awaitingGesture: false, cleanup: null,
        // Página oculta: narration identifica cada narración del recorrido,
        // shown es el token del paso ya pintado y suspended el del paso que se
        // vuelve a narrar al volver a estar visible.
        narration: 0, narrating: false, autoPending: false, shown: null, suspended: null
    };
    var els = null;
    var reduced = false;
    try { reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* sin matchMedia */ }

    /* ------------------------------ utils ------------------------------ */
    function ss(key, value) {
        try {
            if (value === undefined) return sessionStorage.getItem(key);
            if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
        } catch (e) { return null; }
        return value;
    }
    function ls(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        } catch (e) { return null; }
        return value;
    }
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function icon(name) {
        return '<i data-wo-icon="' + name + '" class="wo-icon-18" aria-hidden="true"></i>';
    }
    function hydrate(node) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') { try { window.WoIcons.hydrate(node); } catch (e) { /* opcional */ } }
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function chapters() { return (window.WoTourSteps && window.WoTourSteps.chapters) || []; }
    function normPath(p) { return String(p || '').replace(/\/+$/, '') || '/'; }
    function chapterPath(ch) {
        var p = typeof ch.path === 'function' ? ch.path(window.WoDemo && window.WoDemo.identity) : ch.path;
        return p || '/artist/dashboard';
    }
    function chapterMatches(ch, loc) {
        if (typeof ch.match === 'function') return !!ch.match(loc);
        var base = chapterPath(ch).split('?')[0];
        return normPath(loc.pathname) === normPath(base);
    }
    function chapterIndexForLocation() {
        var list = chapters();
        for (var i = 0; i < list.length; i++) if (chapterMatches(list[i], window.location)) return i;
        return -1;
    }
    function hasUserActivation() {
        try {
            if (navigator.userActivation) return !!navigator.userActivation.hasBeenActive;
        } catch (e) { /* no soportado */ }
        return state.gestureSeen === true;
    }
    document.addEventListener('pointerdown', function () { state.gestureSeen = true; }, true);
    document.addEventListener('keydown', function () { state.gestureSeen = true; }, true);

    /* ------------------------------ estado ------------------------------ */
    function persist(extra) {
        ss(KEYS.state, JSON.stringify(Object.assign({ active: state.active, chapter: state.chapter, step: state.step }, extra || {})));
    }
    function loadPersisted() {
        try { return JSON.parse(ss(KEYS.state) || 'null'); } catch (e) { return null; }
    }
    state.auto = ls(KEYS.auto) !== '0';

    /* -------------------------------- voz -------------------------------- */
    var voices = [];
    var voiceReady = false;
    function refreshVoices() {
        try { voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; } catch (e) { voices = []; }
        voiceReady = voices.length > 0;
    }
    if (window.speechSynthesis) {
        refreshVoices();
        try { window.speechSynthesis.addEventListener('voiceschanged', refreshVoices); } catch (e) { window.speechSynthesis.onvoiceschanged = refreshVoices; }
    }
    function pickVoice() {
        if (!voices.length) refreshVoices();
        var prefs = ['es-AR', 'es-UY', 'es-MX', 'es-US', 'es-419', 'es-CL', 'es-CO', 'es-ES', 'es'];
        var lower = function (v) { return String(v.lang || '').toLowerCase().replace('_', '-'); };
        for (var p = 0; p < prefs.length; p++) {
            var want = prefs[p].toLowerCase();
            var natural = voices.filter(function (v) { return lower(v).indexOf(want) === 0 && /natural|neural|premium|enhanced|google/i.test(v.name); });
            if (natural.length) return natural[0];
            var any = voices.filter(function (v) { return lower(v).indexOf(want) === 0; });
            if (any.length) return any[0];
        }
        return null;
    }
    function voiceSupported() { return !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'; }

    /* ------------------------------ narrador ------------------------------ */
    // Lee un texto frase por frase (una utterance por vez) y solo da por
    // terminada la narración cuando el navegador dejó de hablar. Cubre los
    // cortes conocidos de la Web Speech API:
    //  · cada utterance se asienta una sola vez: un onend tardío, el error de
    //    nuestro propio cancel() o el watchdog no avanzan dos veces;
    //  · referencia fuerte a la utterance activa (Chrome recolecta las sueltas
    //    y nunca dispara onend);
    //  · watchdog: onend perdido = arrancó y speaking/pending llevan ≥700 ms en
    //    false; nunca mientras speaking sea true;
    //  · "arrancó" lo dicen solo onstart/onboundary: Chrome pone speaking en
    //    true dentro de speak() aunque el motor nunca empiece la frase;
    //  · si una frase no arranca en 5 s con el motor quieto, o en 20 s con
    //    speaking en true y sin onstart, un reintento y después se salta (una
    //    frase que disparó onstart nunca se corta);
    //  · página oculta (pantalla bloqueada, otra app o pestaña): Chrome Android
    //    corta la voz y da por terminadas frases que nadie oyó; la narración se
    //    corta con motivo 'hidden', no habla con la página oculta y el
    //    recorrido vuelve a narrar el paso desde el principio al volver;
    //  · 'interrupted'/'canceled' que no pedimos o cualquier otro error: un
    //    reintento y después se salta solo esa frase;
    //  · 120 ms entre cancel() y el primer speak() (Chrome descarta o interrumpe
    //    la utterance nueva);
    //  · frases de hasta 160 caracteres y keep-alive pause()/resume() cada 10 s
    //    para las voces remotas de Chrome, que se callan a los ~15 s.
    var RATES = [1, 1.25, 1.5, 1.75, 2];
    var MAX_CHUNK = 160;
    var CANCEL_GAP_MS = 120;
    var RETRY_GAP_MS = 150;
    var WATCHDOG_MS = 250;
    var LOST_END_MS = 700;
    var START_TIMEOUT_MS = 5000;
    var STUCK_START_MS = 20000;
    var KEEPALIVE_MS = 10000;
    var SENTENCE_END = '.!?…';
    var CLAUSE_END = ',;:';

    function now() { return Date.now(); }
    function normalizeText(text) {
        if (Array.isArray(text)) text = text.join(' ');
        return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    }
    // Corta `s` (ya normalizado) en cada espacio precedido por uno de `marks`.
    // Sin lookbehind en regex: es un error de sintaxis en Safari < 16.4 y
    // tumbaba el archivo entero.
    function splitAfter(s, marks) {
        var out = [], start = 0;
        for (var i = 1; i < s.length; i++) {
            if (s.charAt(i) === ' ' && marks.indexOf(s.charAt(i - 1)) !== -1) { out.push(s.slice(start, i)); start = i + 1; }
        }
        out.push(s.slice(start));
        return out.filter(Boolean);
    }
    // Une piezas consecutivas (separadas por un espacio) sin pasar de `max`.
    function pack(pieces, max) {
        var out = [], cur = '';
        for (var i = 0; i < pieces.length; i++) {
            if (!cur) cur = pieces[i];
            else if (cur.length + 1 + pieces[i].length <= max) cur += ' ' + pieces[i];
            else { out.push(cur); cur = pieces[i]; }
        }
        if (cur) out.push(cur);
        return out;
    }
    // Frases de hasta `max` caracteres: primero por . ! ? …, las largas por
    // ", " "; " ": " y, como último recurso, por palabras. chunks.join(' ')
    // reproduce el texto normalizado.
    function chunkText(text, max) {
        max = max || MAX_CHUNK;
        var out = [];
        splitAfter(normalizeText(text), SENTENCE_END).forEach(function (sentence) {
            if (sentence.length <= max) { out.push(sentence); return; }
            var clauses = [];
            splitAfter(sentence, CLAUSE_END).forEach(function (c) {
                if (c.length <= max) clauses.push(c); else clauses.push.apply(clauses, pack(c.split(' '), max));
            });
            out.push.apply(out, pack(clauses, max));
        });
        return out;
    }

    function snapRate(rate) {
        var r = Number(rate), best = RATES[0];
        if (!isFinite(r) || r <= 0) return best;
        for (var i = 1; i < RATES.length; i++) if (Math.abs(RATES[i] - r) < Math.abs(best - r)) best = RATES[i];
        return best;
    }
    function rateIndex(rate) { return RATES.indexOf(snapRate(rate)); }
    function nextRate(rate) { return RATES[(rateIndex(rate) + 1) % RATES.length]; }
    function prevRate(rate) { return RATES[(rateIndex(rate) + RATES.length - 1) % RATES.length]; }
    // Teclas + y -: sin dar la vuelta en los extremos.
    function stepRate(rate, dir) { return RATES[Math.min(RATES.length - 1, Math.max(0, rateIndex(rate) + dir))]; }
    function formatRate(rate) {
        var r = Number(rate);
        if (!isFinite(r) || r <= 0) r = 1;
        return String(Math.round(r * 100) / 100).replace('.', ',') + '×';
    }

    var prefs = { voice: ls(KEYS.voice) !== '0', rate: snapRate(ls(KEYS.rate) || 1) };
    // wo_tour_voice se comparte con el panel asistido: se relee por si lo cambió otro script.
    function voiceOn() {
        var v = ls(KEYS.voice);
        if (v === '0' || v === '1') prefs.voice = v === '1';
        return prefs.voice;
    }
    state.voice = prefs.voice;

    var nar = { seq: 0, session: null, rec: null, keep: [], timer: null, watchdog: null, keepAlive: null, lastCancelAt: -Infinity, blocked: false };
    // pagehide llega antes de que document.hidden pase a true: se marca aparte.
    var page = { gone: false };
    function pageHidden() {
        if (page.gone) return true;
        try { return document.hidden === true; } catch (e) { return false; }
    }
    function synth() { return window.speechSynthesis || null; }
    function synthFlag(name) { var s = synth(); try { return !!(s && s[name]); } catch (e) { return false; } }
    function cancelSynth(force) {
        var s = synth();
        if (!s) return;
        var busy = synthFlag('speaking') || synthFlag('pending');
        try { s.cancel(); } catch (e) { /* sin voz */ }
        if (busy || force) nar.lastCancelAt = now();
    }
    function isChromiumNotEdge() {
        var nav = window.navigator || {};
        var ua = String(nav.userAgent || '');
        if (/\bEdg(e|A|iOS)?\//.test(ua)) return false;
        var brands = (nav.userAgentData && nav.userAgentData.brands) || [];
        for (var i = 0; i < brands.length; i++) if (/edge/i.test(brands[i].brand)) return false;
        for (var j = 0; j < brands.length; j++) if (/chromium/i.test(brands[j].brand)) return true;
        return /\bChrome\//.test(ua);
    }
    function needsKeepAlive(voice) { return !!voice && voice.localService === false && isChromiumNotEdge(); }
    function keepAlive() {
        var s = synth();
        if (!s || !nar.session || !synthFlag('speaking') || synthFlag('paused')) return;
        try { s.pause(); s.resume(); } catch (e) { /* sin voz */ }
    }
    function teardown() {
        if (nar.rec) nar.rec.settled = true;
        nar.rec = null; nar.keep = []; nar.session = null;
        clearTimeout(nar.timer); nar.timer = null;
        clearInterval(nar.watchdog); nar.watchdog = null;
        clearInterval(nar.keepAlive); nar.keepAlive = null;
    }
    function callDone(s, ok, reason, async) {
        if (s.doneCalled) return;
        s.doneCalled = true;
        var fn = s.done;
        if (typeof fn !== 'function') return;
        var run = function () { try { fn(ok, reason); } catch (e) { if (window.console) console.warn('[wo-tour] callback de voz falló', e); } };
        if (async) setTimeout(run, 0); else run();
    }
    function finishSession(s, ok, reason) {
        if (nar.session !== s) return;
        teardown();
        callDone(s, ok, reason, false);
    }
    function stopNarration(reason) {
        var s = nar.session;
        teardown();
        cancelSynth(false);
        if (s) callDone(s, false, reason || 'stopped', true);
    }
    function stopSpeech() { stopNarration('stopped'); }
    function notifyBlocked(opts) {
        nar.blocked = true;
        if (opts && typeof opts.onBlocked === 'function') { try { opts.onBlocked(); } catch (e) { /* hook ajeno */ } }
    }
    function speakChunk(s, index, attempt) {
        if (nar.session !== s) return;
        nar.timer = null;
        // Con la página oculta el navegador descarta la frase y la reporta como 'end'.
        if (pageHidden()) return stopNarration('hidden');
        if (index >= s.chunks.length) return drain(s);
        s.index = index;
        var u = new window.SpeechSynthesisUtterance(s.chunks[index]);
        u.lang = s.voice ? s.voice.lang : 'es-AR';
        if (s.voice) u.voice = s.voice;
        u.rate = prefs.rate; u.pitch = 1; u.volume = 1;
        // started: solo onstart/onboundary. busy: el motor se vio ocupado con la frase.
        var rec = { u: u, session: s, index: index, attempt: attempt, settled: false, started: false, busy: false, queuedAt: now(), quietSince: null };
        nar.rec = rec;
        nar.keep = [u];
        u.onstart = function () { if (!rec.settled) { rec.started = true; rec.quietSince = null; } };
        u.onboundary = u.onstart;
        u.onend = function () { settle(rec, 'end'); };
        u.onerror = function (ev) { settle(rec, 'error', ev && ev.error); };
        try { synth().speak(u); } catch (e) { settle(rec, 'error', 'synthesis-failed'); }
    }
    function settle(rec, how, error) {
        if (rec.settled) return;
        rec.settled = true;
        if (nar.rec === rec) { nar.rec = null; nar.keep = []; }
        var s = rec.session;
        if (nar.session !== s) return;
        // 'end' o error con la página oculta: no cuenta como oída y no se sigue.
        if (pageHidden()) { stopNarration('hidden'); return; }
        if (how === 'end' || how === 'lost') { s.spoke++; speakChunk(s, rec.index + 1, 0); return; }
        if (how === 'error' && error === 'not-allowed') { notifyBlocked(s.opts); finishSession(s, false, 'gesture'); return; }
        // 'interrupted'/'canceled' que no pedimos, cualquier otro error o una
        // frase que nunca arrancó: un reintento; si vuelve a fallar se salta solo esa.
        var retry = rec.attempt < 1;
        if (!retry) s.failed++;
        var index = retry ? rec.index : rec.index + 1;
        var attempt = retry ? rec.attempt + 1 : 0;
        if (how === 'nostart') cancelSynth(true);
        nar.timer = setTimeout(function () { respeak(s, index, attempt); }, how === 'nostart' ? CANCEL_GAP_MS : RETRY_GAP_MS);
    }
    function respeak(s, index, attempt) {
        if (nar.session !== s) return;
        nar.timer = null;
        if (synthFlag('speaking') || synthFlag('pending')) {
            cancelSynth(true);
            nar.timer = setTimeout(function () { speakChunk(s, index, attempt); }, CANCEL_GAP_MS);
            return;
        }
        speakChunk(s, index, attempt);
    }
    // Ya salieron todas las frases: se cierra recién cuando el navegador se calla.
    function drain(s) {
        s.draining = true;
        if (!synthFlag('speaking')) finishSession(s, s.spoke > 0, s.spoke > 0 ? 'end' : 'error');
    }
    function watchdog() {
        var s = nar.session;
        if (!s) return;
        if (pageHidden()) { stopNarration('hidden'); return; }
        var speaking = synthFlag('speaking');
        if (s.draining) { if (!speaking) finishSession(s, s.spoke > 0, s.spoke > 0 ? 'end' : 'error'); return; }
        var rec = nar.rec;
        if (!rec || rec.settled) return;
        var t = now();
        if (speaking) {
            // speaking=true no prueba que arrancó (Chrome lo pone dentro de speak()):
            // sin onstart en 20 s la frase quedó colgada. Con onstart no se corta nunca.
            rec.busy = true; rec.quietSince = null;
            if (!rec.started && t - rec.queuedAt >= STUCK_START_MS) settle(rec, 'nostart');
            return;
        }
        // Arrancó, o el motor estuvo ocupado con ella y se calló sin eventos: onend perdido.
        if (rec.started || rec.busy) {
            if (synthFlag('pending')) { rec.quietSince = null; return; }
            if (rec.quietSince === null) rec.quietSince = t;
            else if (t - rec.quietSince >= LOST_END_MS) settle(rec, 'lost');
            return;
        }
        if (t - rec.queuedAt >= START_TIMEOUT_MS) settle(rec, 'nostart');
    }
    // Lee `text` (string o lista de párrafos). done(ok, motivo) se llama una sola
    // vez: ok=true al terminar, con el navegador ya callado; ok=false si se cortó
    // o se reemplazó, si fallaron todas las frases, si no hay voz, si la página
    // está o quedó oculta ('hidden') o si hace falta un gesto del usuario
    // (opts.onBlocked avisa ese caso). Devuelve true si arrancó.
    function speak(text, done, opts) {
        opts = opts || {};
        if (nar.session) stopNarration('replaced');
        var chunks = chunkText(text);
        var reason = !voiceSupported() ? 'unsupported' : !voiceOn() ? 'off' : !chunks.length ? 'empty' : pageHidden() ? 'hidden' : null;
        // Chrome/Safari bloquean la voz hasta la primera interacción del documento.
        if (!reason && !hasUserActivation()) { reason = 'gesture'; notifyBlocked(opts); }
        var s = { done: done, opts: opts, chunks: chunks, index: 0, spoke: 0, failed: 0, draining: false, doneCalled: false };
        if (reason) { callDone(s, false, reason, true); return false; }
        nar.blocked = false;
        s.id = ++nar.seq;
        s.voice = pickVoice();
        nar.session = s;
        nar.watchdog = setInterval(watchdog, WATCHDOG_MS);
        if (needsKeepAlive(s.voice)) nar.keepAlive = setInterval(keepAlive, KEEPALIVE_MS);
        if (synthFlag('speaking') || synthFlag('pending')) cancelSynth(true);
        var gap = Math.max(0, CANCEL_GAP_MS - (now() - nar.lastCancelAt));
        if (gap > 0) nar.timer = setTimeout(function () { speakChunk(s, 0, 0); }, gap);
        else speakChunk(s, 0, 0);
        return true;
    }
    // Cambiar u.rate en vuelo no tiene efecto: se corta la frase actual y se
    // retoma desde su inicio a la nueva velocidad (no desde el principio del texto).
    function setRate(rate) {
        var r = snapRate(rate);
        var changed = r !== prefs.rate;
        prefs.rate = r;
        ls(KEYS.rate, String(r));
        var s = nar.session, rec = nar.rec;
        if (changed && s && !s.draining && rec && !rec.settled) {
            rec.settled = true;
            nar.rec = null; nar.keep = [];
            clearTimeout(nar.timer);
            cancelSynth(true);
            nar.timer = setTimeout(function () { speakChunk(s, rec.index, 0); }, CANCEL_GAP_MS);
        }
        return r;
    }
    function setVoiceEnabled(on) {
        prefs.voice = !!on;
        ls(KEYS.voice, prefs.voice ? '1' : '0');
        if (!prefs.voice) stopNarration('off');
        return prefs.voice;
    }
    var narrator = {
        RATES: RATES.slice(),
        supported: voiceSupported,
        speak: speak,
        stop: function () { stopNarration('stopped'); },
        isSpeaking: function () { return !!nar.session; },
        getRate: function () { return prefs.rate; },
        setRate: setRate,
        formatRate: formatRate,
        voiceEnabled: voiceOn,
        setVoiceEnabled: setVoiceEnabled,
        needsGesture: function () { return nar.blocked; }
    };

    // Al ocultarse la página se corta la narración (y el recorrido se suspende);
    // al volver a verse, el recorrido narra otra vez el paso desde el principio.
    function onPageHidden() {
        tourHidden();
        if (nar.session) stopNarration('hidden');
    }
    function onPageVisible() { if (!pageHidden()) tourShown(); }
    document.addEventListener('visibilitychange', function () { if (pageHidden()) onPageHidden(); else onPageVisible(); });
    document.addEventListener('freeze', onPageHidden);
    window.addEventListener('pagehide', function () { page.gone = true; onPageHidden(); });
    window.addEventListener('pageshow', function () { page.gone = false; onPageVisible(); });

    /* -------------------------------- DOM -------------------------------- */
    function ensureDom() {
        if (els) return els;
        var root = document.createElement('div');
        root.className = 'wo-tour-root';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Recorrido guiado');
        root.innerHTML =
            '<div class="wo-tour-dim" data-side="top"></div><div class="wo-tour-dim" data-side="bottom"></div>' +
            '<div class="wo-tour-dim" data-side="left"></div><div class="wo-tour-dim" data-side="right"></div>' +
            '<div class="wo-tour-hole"></div><div class="wo-tour-ring" data-step=""></div>' +
            '<section class="wo-tour-card" aria-live="polite"></section>';
        document.body.appendChild(root);
        els = {
            root: root,
            dims: {
                top: root.querySelector('[data-side="top"]'), bottom: root.querySelector('[data-side="bottom"]'),
                left: root.querySelector('[data-side="left"]'), right: root.querySelector('[data-side="right"]')
            },
            hole: root.querySelector('.wo-tour-hole'),
            ring: root.querySelector('.wo-tour-ring'),
            card: root.querySelector('.wo-tour-card')
        };
        root.querySelector('[data-side="top"]').addEventListener('click', onDimClick);
        root.querySelector('[data-side="bottom"]').addEventListener('click', onDimClick);
        root.querySelector('[data-side="left"]').addEventListener('click', onDimClick);
        root.querySelector('[data-side="right"]').addEventListener('click', onDimClick);
        return els;
    }
    function onDimClick() { /* el velo absorbe el click; no navega */ }

    function px(n) { return Math.round(n) + 'px'; }
    function setBox(node, x, y, w, h) {
        node.style.left = px(x); node.style.top = px(y); node.style.width = px(Math.max(0, w)); node.style.height = px(Math.max(0, h));
    }
    function targetRect() {
        if (!state.target) return null;
        var r = state.target.getBoundingClientRect();
        return { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    }
    function layout() {
        if (!els || !state.active) return;
        var vw = window.innerWidth, vh = window.innerHeight;
        if (state.centered || !state.target) {
            setBox(els.dims.top, 0, 0, vw, vh);
            setBox(els.dims.bottom, 0, vh, vw, 0); setBox(els.dims.left, 0, 0, 0, 0); setBox(els.dims.right, 0, 0, 0, 0);
            setBox(els.hole, 0, 0, 0, 0); els.ring.style.display = 'none';
            els.card.style.left = ''; els.card.style.top = '';
            return;
        }
        var r = targetRect();
        var key = [r.left, r.top, r.width, r.height, vw, vh].join(',');
        if (key === state.lastRect) return;
        state.lastRect = key;
        setBox(els.dims.top, 0, 0, vw, Math.max(0, r.top));
        setBox(els.dims.bottom, 0, r.top + r.height, vw, Math.max(0, vh - (r.top + r.height)));
        setBox(els.dims.left, 0, r.top, Math.max(0, r.left), r.height);
        setBox(els.dims.right, r.left + r.width, r.top, Math.max(0, vw - (r.left + r.width)), r.height);
        setBox(els.hole, r.left, r.top, r.width, r.height);
        els.ring.style.display = '';
        setBox(els.ring, r.left, r.top, r.width, r.height);
        placeCard(r, vw, vh);
    }
    function placeCard(r, vw, vh) {
        var card = els.card;
        if (vw < 768) { card.style.left = ''; card.style.top = ''; return; }
        var cw = card.offsetWidth || 440, chh = card.offsetHeight || 260, gap = 16, margin = 16;
        var left, top;
        var below = vh - (r.top + r.height), above = r.top, right = vw - (r.left + r.width), leftSpace = r.left;
        if (below >= chh + gap + margin) { top = r.top + r.height + gap; left = r.left; }
        else if (above >= chh + gap + margin) { top = r.top - chh - gap; left = r.left; }
        else if (right >= cw + gap + margin) { left = r.left + r.width + gap; top = r.top; }
        else if (leftSpace >= cw + gap + margin) { left = r.left - cw - gap; top = r.top; }
        else { left = vw - cw - margin; top = vh - chh - margin; }
        left = Math.min(Math.max(margin, left), vw - cw - margin);
        top = Math.min(Math.max(margin, top), vh - chh - margin);
        card.style.left = px(left); card.style.top = px(top);
    }
    // Relayout por eventos (scroll/resize) + un latido lento como red de
    // seguridad para cambios de DOM; evita un rAF continuo.
    function scheduleLayout() {
        if (state.raf) return;
        state.raf = requestAnimationFrame(function () { state.raf = 0; layout(); });
    }
    function watchLayout() {
        if (state.watching) return;
        state.watching = true;
        window.addEventListener('scroll', scheduleLayout, true);
        window.addEventListener('resize', scheduleLayout);
        state.pulse = setInterval(function () { if (state.active) layout(); }, 300);
    }
    function unwatchLayout() {
        if (!state.watching) return;
        state.watching = false;
        window.removeEventListener('scroll', scheduleLayout, true);
        window.removeEventListener('resize', scheduleLayout);
        clearInterval(state.pulse); state.pulse = null;
        if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    }

    /* ----------------------------- selección ----------------------------- */
    function isVisible(node) {
        if (!node || !node.getClientRects().length) return false;
        if (node.closest('[hidden]')) return false;
        var cs = window.getComputedStyle(node);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
        var r = node.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
    }
    function resolveTarget(spec) {
        if (!spec) return null;
        if (typeof spec === 'function') { try { return spec() || null; } catch (e) { return null; } }
        var list = Array.isArray(spec) ? spec : [spec];
        for (var i = 0; i < list.length; i++) {
            var candidates;
            try { candidates = document.querySelectorAll(list[i]); } catch (e) { continue; }
            for (var j = 0; j < candidates.length; j++) if (isVisible(candidates[j])) return candidates[j];
        }
        return null;
    }
    function waitForTarget(step, timeout) {
        return new Promise(function (resolve) {
            var spec = step.waitFor || step.target;
            var found = resolveTarget(spec);
            if (found) return resolve(found);
            var deadline = Date.now() + (timeout || WAIT_TIMEOUT_MS);
            var obs = null;
            var timer = setInterval(check, 200);
            function stop(val) { clearInterval(timer); if (obs) obs.disconnect(); resolve(val); }
            function check() {
                var el = resolveTarget(spec);
                if (el) return stop(el);
                if (Date.now() > deadline) return stop(null);
            }
            try {
                obs = new MutationObserver(check);
                obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
            } catch (e) { /* sin observer: polling */ }
        });
    }
    function scrollTo(node) {
        try { node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch (e) { node.scrollIntoView(); }
        return wait(reduced ? 40 : SCROLL_SETTLE_MS);
    }

    /* ------------------------------ tarjeta ------------------------------ */
    function currentChapter() { return chapters()[state.chapter] || null; }
    function currentStep() { var ch = currentChapter(); return ch && ch.steps[state.step] || null; }
    function isLastStep() { var ch = currentChapter(); return !!ch && state.step >= ch.steps.length - 1; }
    function isLastChapter() { return state.chapter >= chapters().length - 1; }
    function nextLabel(step) {
        if (step.nextLabel) return step.nextLabel;
        if (isLastStep()) {
            if (isLastChapter()) return 'TERMINAR →';
            var nx = chapters()[state.chapter + 1];
            return 'IR A ' + String(nx.title || 'LA SIGUIENTE SECCIÓN').toUpperCase() + ' →';
        }
        return 'SIGUIENTE →';
    }

    function rateLabel() { return 'Velocidad de la voz: ' + formatRate(prefs.rate); }
    // Cambia la velocidad sin rearmar la tarjeta (el foco queda en el botón);
    // la narración en curso sigue desde la frase actual.
    function changeRate(rate) {
        narrator.setRate(rate);
        var btn = els && els.card.querySelector('.wo-tour-card__rate');
        if (btn) { btn.textContent = formatRate(prefs.rate); btn.setAttribute('aria-label', rateLabel()); }
    }

    function renderCard(step, opts) {
        state.voice = voiceOn();
        var ch = currentChapter();
        var total = chapters().length;
        var eyebrow = 'Capítulo ' + (state.chapter + 1) + '/' + total + ' · ' + (ch.title || '') + ' · paso ' + (state.step + 1) + '/' + ch.steps.length;
        var paragraphs = (Array.isArray(step.text) ? step.text : [step.text]).map(function (t) { return '<p class="wo-tour-card__text">' + esc(t) + '</p>'; }).join('');
        var pct = Math.round(((state.step + 1) / ch.steps.length) * 100);
        var first = state.chapter === 0 && state.step === 0;
        var html =
            '<div class="wo-tour-card__head">' +
            '<p class="wo-tour-card__eyebrow">' + esc(eyebrow) + '</p>' +
            '<button type="button" class="wo-iconbtn wo-iconbtn--s wo-tour-card__close" aria-label="Cerrar recorrido">' + icon('x') + '</button>' +
            '</div>' +
            (step.title ? '<h2 class="wo-tour-card__title">' + esc(step.title) + '</h2>' : '') +
            paragraphs +
            (step.hint ? '<p class="wo-tour-card__hint">' + esc(step.hint) + '</p>' : '') +
            (!voiceSupported() && first ? '<p class="wo-alert wo-alert--info wo-tour-card__novoice">Tu navegador no tiene voz en español: el recorrido se lee en pantalla.</p>' : '') +
            '<div class="wo-progress wo-progress--accent wo-tour-card__progress" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
            '<div class="wo-tour-card__foot">' +
            '<div class="wo-tour-card__tools">' +
            '<button type="button" class="wo-iconbtn wo-iconbtn--s wo-tour-card__voice' + (state.voice ? '' : ' is-off') + '" aria-pressed="' + (state.voice ? 'true' : 'false') + '" title="Narración por voz" aria-label="Narración por voz">' + icon(state.voice ? 'volume-2' : 'volume-x') + '</button>' +
            '<button type="button" class="wo-iconbtn wo-iconbtn--s wo-tour-card__auto' + (state.auto ? '' : ' is-off') + '" aria-pressed="' + (state.auto ? 'true' : 'false') + '" title="Avanzar solo al terminar la narración" aria-label="Avance automático">' + icon(state.auto ? 'play' : 'pause') + '</button>' +
            (voiceSupported() ? '<button type="button" class="wo-iconbtn wo-iconbtn--s wo-tour-card__rate" title="Velocidad de la voz" aria-label="' + esc(rateLabel()) + '">' + esc(formatRate(prefs.rate)) + '</button>' : '') +
            (state.awaitingGesture && state.voice && voiceSupported() ? '<button type="button" class="wo-btn wo-btn--s wo-btn--accent wo-tour-card__listen">ESCUCHAR ▶</button>' : '') +
            '</div>' +
            '<div class="wo-tour-card__nav">' +
            '<button type="button" class="wo-btn wo-btn--s wo-btn--ghost wo-tour-card__prev"' + (first ? ' disabled' : '') + '>← ANTERIOR</button>' +
            '<button type="button" class="wo-btn wo-btn--s wo-btn--ink wo-tour-card__next">' + esc(nextLabel(step)) + '</button>' +
            '</div></div>' +
            (step.exitLabel ? '<button type="button" class="wo-tour-card__skip wo-tour-card__exit">' + esc(step.exitLabel) + '</button>' : '<button type="button" class="wo-tour-card__skip">Saltar el recorrido</button>');
        els.card.innerHTML = html;
        hydrate(els.card);
        els.card.querySelector('.wo-tour-card__close').addEventListener('click', function () { api.stop(); });
        els.card.querySelector('.wo-tour-card__prev').addEventListener('click', function () { api.prev(); });
        els.card.querySelector('.wo-tour-card__next').addEventListener('click', function () { api.next(); });
        var skip = els.card.querySelector('.wo-tour-card__skip');
        if (skip) skip.addEventListener('click', function () {
            if (skip.classList.contains('wo-tour-card__exit') && window.WoDemo) {
                api.stop({ silent: true });
                ls('wo_tour_seen', '1');
                // Paso final: sale del demo y entrega al modo asistido (configurar el perfil).
                if (step.exitAssist) window.WoDemo.disable({ assist: true }); else window.WoDemo.disable();
            }
            else api.stop();
        });
        els.card.querySelector('.wo-tour-card__voice').addEventListener('click', function () {
            state.voice = narrator.setVoiceEnabled(!state.voice);
            renderCard(step, { keep: true });
            if (state.voice) narrate(step);
        });
        var rateBtn = els.card.querySelector('.wo-tour-card__rate');
        if (rateBtn) rateBtn.addEventListener('click', function () { changeRate(nextRate(prefs.rate)); });
        els.card.querySelector('.wo-tour-card__auto').addEventListener('click', function () {
            state.auto = !state.auto; ls(KEYS.auto, state.auto ? '1' : '0');
            clearAdvance();
            renderCard(step, { keep: true });
        });
        var listen = els.card.querySelector('.wo-tour-card__listen');
        if (listen) listen.addEventListener('click', function () { state.gestureSeen = true; state.awaitingGesture = false; renderCard(step, { keep: true }); narrate(step); });
        try { els.card.querySelector('.wo-tour-card__next').focus({ preventScroll: true }); } catch (e) { /* foco opcional */ }
        state.lastRect = null;
    }
    function renderGestureHint() {
        var step = currentStep();
        if (step && els) renderCard(step, { keep: true });
    }
    function clearAdvance() { clearTimeout(state.timer); state.autoPending = false; }
    // Avance automático 900 ms después de terminar la narración, y nunca con el
    // navegador hablando (si habla, vuelve a mirar en un rato) ni con la página oculta.
    function scheduleAdvance(token) {
        clearAdvance();
        state.autoPending = true;
        state.timer = setTimeout(function check() {
            if (!state.active || state.token !== token || !state.auto) { state.autoPending = false; return; }
            if (pageHidden()) { suspendTour(token); return; }
            if (narrator.isSpeaking() || synthFlag('speaking')) { state.timer = setTimeout(check, 300); return; }
            state.autoPending = false;
            api.next();
        }, AUTO_ADVANCE_MS);
    }
    // Página oculta con el paso narrándose o por avanzar: no se avanza y, al
    // volver a verse, el paso se narra otra vez desde el principio (lo que el
    // navegador dio por leído con la página oculta no se oyó).
    function suspendTour(token) {
        clearAdvance();
        if (!state.active || state.token !== token || state.shown !== token) return;
        if (pageHidden()) { state.suspended = token; return; }
        // El aviso llegó con la página ya visible otra vez: se narra ahora.
        var step = currentStep();
        if (step) narrate(step);
    }
    function tourHidden() {
        if (!state.active || state.shown !== state.token) return;
        if (state.narrating || state.autoPending) { clearAdvance(); state.suspended = state.token; }
    }
    function tourShown() {
        var token = state.suspended;
        state.suspended = null;
        if (token === null || !state.active || token !== state.token || state.shown !== token) return;
        var step = currentStep();
        if (step) narrate(step);
    }
    function narrate(step) {
        clearAdvance();
        state.suspended = null;
        var text = step.speech || (Array.isArray(step.text) ? step.text.join(' ') : step.text) || '';
        var token = state.token;
        var id = ++state.narration;
        state.narrating = true;
        var started = narrator.speak(text, function (ok, reason) {
            if (state.narration !== id) return;
            state.narrating = false;
            if (!state.active || state.token !== token) return;
            if (reason === 'hidden' || (ok && pageHidden())) { suspendTour(token); return; }
            if (!ok) return;
            if (state.auto && !step.interactive && !isLastStep()) scheduleAdvance(token);
        }, {
            onBlocked: function () {
                if (!state.active || state.token !== token) return;
                state.awaitingGesture = true; renderGestureHint();
            }
        });
        if (started) state.awaitingGesture = false;
    }

    /* ------------------------------ mostrar ------------------------------ */
    var showing = null;
    function show(chapterIdx, stepIdx, opts) {
        opts = opts || {};
        var list = chapters();
        var ch = list[chapterIdx];
        if (!ch) return Promise.resolve(false);
        if (stepIdx < 0) stepIdx = 0;
        if (stepIdx >= ch.steps.length) stepIdx = ch.steps.length - 1;
        var step = ch.steps[stepIdx];
        var run = (showing || Promise.resolve()).then(function () { return doShow(ch, chapterIdx, step, stepIdx, opts); });
        showing = run.catch(function (e) { if (window.console) console.warn('[wo-tour] paso falló', e); });
        return run;
    }
    async function doShow(ch, chapterIdx, step, stepIdx, opts) {
        var dom = ensureDom();
        var localToken = ++state.token;
        clearAdvance();
        state.suspended = null;
        stopSpeech();
        // Cierra el paso anterior (hooks `after`).
        if (state.cleanup) { try { await state.cleanup(); } catch (e) { /* hook ajeno */ } state.cleanup = null; }
        state.active = true; state.chapter = chapterIdx; state.step = stepIdx;
        persist();
        document.documentElement.classList.add('wo-tour-active');
        dom.root.hidden = false;
        dom.root.classList.add('is-clear');
        if (!reduced) await wait(CLEAR_MS);
        if (localToken !== state.token) return false;

        if (typeof step.before === 'function') {
            var ok;
            try { ok = await step.before({ step: step, chapter: ch }); } catch (e) { ok = false; }
            if (ok === false) return skipStep(chapterIdx, stepIdx, opts.dir || 1);
        }
        var target = null;
        if (step.target) {
            target = await waitForTarget(step, step.timeout);
            if (localToken !== state.token) return false;
            if (!target) {
                if (window.console) console.warn('[wo-tour] sin objetivo para el paso', ch.id + '/' + (step.id || stepIdx));
                return skipStep(chapterIdx, stepIdx, opts.dir || 1);
            }
        }
        state.target = target;
        state.centered = !target;
        state.interactive = !!step.interactive;
        state.cleanup = typeof step.after === 'function' ? function () { return step.after({ step: step, chapter: ch }); } : null;
        dom.root.classList.toggle('is-centered', state.centered);
        dom.root.classList.toggle('is-interactive', state.interactive);
        dom.ring.setAttribute('data-step', (stepIdx + 1) + '/' + ch.steps.length);
        if (target) await scrollTo(target);
        if (localToken !== state.token) return false;
        state.lastRect = null;
        renderCard(step, {});
        watchLayout();
        layout();
        dom.root.classList.remove('is-clear');
        state.shown = localToken;
        if (!opts.silent) narrate(step);
        return true;
    }
    function skipStep(chapterIdx, stepIdx, dir) {
        var ch = chapters()[chapterIdx];
        var nextIdx = stepIdx + (dir < 0 ? -1 : 1);
        if (nextIdx < 0) return show(chapterIdx, 0, { dir: 1 });
        if (nextIdx >= ch.steps.length) return goToChapter(chapterIdx + 1);
        return show(chapterIdx, nextIdx, { dir: dir });
    }
    function goToChapter(idx) {
        var list = chapters();
        if (idx >= list.length) { return finish(); }
        if (idx < 0) idx = 0;
        var ch = list[idx];
        if (chapterMatches(ch, window.location)) return show(idx, 0, {});
        // Otra página: guardar estado y navegar; el recorrido se retoma al cargar.
        state.active = true; state.chapter = idx; state.step = 0; state.shown = null;
        persist({ resume: true });
        stopSpeech();
        var url = new URL(chapterPath(ch), window.location.origin);
        url.searchParams.set('demo', '1');
        window.location.href = url.pathname + url.search;
        return Promise.resolve(true);
    }
    function finish() {
        var cb = window.WoTourSteps && window.WoTourSteps.onFinish;
        api.stop({ silent: true });
        ls('wo_tour_seen', '1');
        if (typeof cb === 'function') { try { cb(); } catch (e) { /* hook ajeno */ } }
        return Promise.resolve(true);
    }

    /* -------------------------------- API -------------------------------- */
    function isTyping(e) {
        var t = e.target;
        return !!t && (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable === true);
    }
    // Enter sobre un botón de la tarjeta lo activa a él (velocidad, voz, anterior…), no "siguiente".
    function onCardButton(e) {
        var btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
        return !!(btn && els && els.card.contains(btn));
    }
    function onKey(e) {
        if (!state.active) return;
        if (e.key === 'Escape') { e.preventDefault(); api.stop(); }
        else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !isTyping(e) && !onCardButton(e))) { e.preventDefault(); api.next(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); api.prev(); }
        else if ((e.key === '+' || e.key === '=' || e.key === '-') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e)) {
            e.preventDefault();
            changeRate(stepRate(prefs.rate, e.key === '-' ? -1 : 1));
        }
    }
    var api = {
        state: state,
        isActive: function () { return state.active; },
        start: function (opts) {
            opts = opts || {};
            var idx = typeof opts.chapter === 'number' ? opts.chapter : chapterIndexForLocation();
            if (idx < 0) return goToChapter(0);
            document.addEventListener('keydown', onKey);
            window.addEventListener('beforeunload', stopSpeech);
            return show(idx, typeof opts.step === 'number' ? opts.step : 0, { silent: !!opts.silent });
        },
        next: function () {
            clearAdvance();
            if (!state.active) return;
            if (isLastStep()) return goToChapter(state.chapter + 1);
            return show(state.chapter, state.step + 1, { dir: 1 });
        },
        prev: function () {
            clearAdvance();
            if (!state.active) return;
            if (state.step > 0) return show(state.chapter, state.step - 1, { dir: -1 });
            if (state.chapter > 0) {
                var prevCh = chapters()[state.chapter - 1];
                if (chapterMatches(prevCh, window.location)) return show(state.chapter - 1, prevCh.steps.length - 1, { dir: -1 });
                state.chapter -= 1; state.step = Math.max(0, prevCh.steps.length - 1); state.shown = null; persist({ resume: true }); stopSpeech();
                var url = new URL(chapterPath(prevCh), window.location.origin); url.searchParams.set('demo', '1');
                window.location.href = url.pathname + url.search;
            }
        },
        goTo: function (chapterIdx, stepIdx) { return show(chapterIdx, stepIdx || 0, {}); },
        stop: function (opts) {
            opts = opts || {};
            state.token++;
            clearAdvance();
            state.suspended = null; state.shown = null;
            stopSpeech();
            if (state.cleanup) { try { state.cleanup(); } catch (e) { /* hook ajeno */ } state.cleanup = null; }
            state.active = false; state.target = null;
            unwatchLayout();
            document.documentElement.classList.remove('wo-tour-active');
            document.removeEventListener('keydown', onKey);
            if (els) { els.root.hidden = true; }
            ss(KEYS.state, null);
            if (!opts.silent) ls('wo_tour_seen', '1');
        },
        speak: speak,
        narrator: narrator,
        _internal: { chunkText: chunkText, nextRate: nextRate, prevRate: prevRate, formatRate: formatRate },
        // Al cargar una página con el demo activo: retoma si el recorrido venía
        // de otra página, o arranca si la URL trae ?tour=1.
        autoResume: function (opts) {
            opts = opts || {};
            var saved = loadPersisted();
            var run = function () {
                var idx = chapterIndexForLocation();
                if (saved && saved.active && saved.fresh) { return api.start({ chapter: 0, step: 0 }); }
                if (saved && saved.active && typeof saved.chapter === 'number') {
                    var ch = chapters()[saved.chapter];
                    if (ch && chapterMatches(ch, window.location)) return api.start({ chapter: saved.chapter, step: saved.step || 0 });
                    // Estado viejo de otra página: sin ?tour=1 la barra ofrece retomar;
                    // con ?tour=1 no bloquea el arranque pedido.
                    if (!opts.wantsTour) return;
                }
                // Fuera de las páginas del guion, start() lleva al primer capítulo.
                if (opts.wantsTour) return api.start(idx >= 0 ? { chapter: idx } : {});
            };
            // Pequeño margen para que la página pinte sus datos antes del primer paso.
            setTimeout(run, 700);
        }
    };
    window.WoTour = api;
})();
