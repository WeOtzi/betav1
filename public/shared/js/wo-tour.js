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
 */
(function () {
    'use strict';

    var KEYS = { state: 'wo_tour_state', voice: 'wo_tour_voice', auto: 'wo_tour_auto' };
    var WAIT_TIMEOUT_MS = 9000;
    var CLEAR_MS = 260;
    var SCROLL_SETTLE_MS = 420;
    var PAD = 8;

    var state = {
        active: false, chapter: 0, step: 0,
        voice: true, auto: true, token: 0,
        target: null, interactive: false, centered: false,
        raf: 0, lastRect: null, timer: null, speaking: false,
        awaitingGesture: false, cleanup: null
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
    state.voice = ls(KEYS.voice) !== '0';
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
    function splitSentences(text) {
        return String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
    }
    function stopSpeech() {
        state.speaking = false;
        try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* sin voz */ }
    }
    // Lee `text`; llama done(ok) al terminar (ok=false si falló o se canceló).
    function speak(text, done) {
        if (!state.voice || !voiceSupported() || !text) { if (done) done(false); return; }
        var synth = window.speechSynthesis;
        synth.cancel();
        var voice = pickVoice();
        var chunks = splitSentences(text);
        var token = ++state.token;
        var i = 0;
        state.speaking = true;
        function finish(ok) {
            if (token !== state.token) return;
            state.speaking = false;
            if (done) done(ok);
        }
        function nextChunk() {
            if (token !== state.token) return;
            if (i >= chunks.length) return finish(true);
            var u = new SpeechSynthesisUtterance(chunks[i++]);
            u.lang = voice ? voice.lang : 'es-AR';
            if (voice) u.voice = voice;
            u.rate = 1; u.pitch = 1; u.volume = 1;
            var guard = setTimeout(function () { if (token === state.token) nextChunk(); }, Math.max(4000, u.text.length * 95));
            u.onend = function () { clearTimeout(guard); nextChunk(); };
            u.onerror = function (ev) {
                clearTimeout(guard);
                if (ev && ev.error === 'not-allowed') { state.awaitingGesture = true; renderGestureHint(); finish(false); return; }
                if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
                finish(false);
            };
            synth.speak(u);
        }
        // Chrome/Safari bloquean la voz hasta la primera interacción del documento.
        if (!hasUserActivation()) { state.awaitingGesture = true; renderGestureHint(); finish(false); return; }
        state.awaitingGesture = false;
        nextChunk();
    }

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

    function renderCard(step, opts) {
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
            if (skip.classList.contains('wo-tour-card__exit') && window.WoDemo) { api.stop({ silent: true }); window.WoDemo.disable(); }
            else api.stop();
        });
        els.card.querySelector('.wo-tour-card__voice').addEventListener('click', function () {
            state.voice = !state.voice; ls(KEYS.voice, state.voice ? '1' : '0');
            if (!state.voice) stopSpeech();
            renderCard(step, { keep: true });
            if (state.voice) narrate(step);
        });
        els.card.querySelector('.wo-tour-card__auto').addEventListener('click', function () {
            state.auto = !state.auto; ls(KEYS.auto, state.auto ? '1' : '0');
            clearTimeout(state.timer);
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
    function narrate(step) {
        clearTimeout(state.timer);
        var text = step.speech || (Array.isArray(step.text) ? step.text.join(' ') : step.text) || '';
        var token = state.token + 1;
        speak(text, function (ok) {
            if (!state.active || state.token !== token) return;
            if (ok && state.auto && !step.interactive && !isLastStep()) {
                state.timer = setTimeout(function () { if (state.active && state.token === token) api.next(); }, 900);
            }
        });
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
        clearTimeout(state.timer);
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
        state.active = true; state.chapter = idx; state.step = 0;
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
    function onKey(e) {
        if (!state.active) return;
        if (e.key === 'Escape') { e.preventDefault(); api.stop(); }
        else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(e.target && /^(input|textarea|select)$/i.test(e.target.tagName)))) { e.preventDefault(); api.next(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); api.prev(); }
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
            clearTimeout(state.timer);
            if (!state.active) return;
            if (isLastStep()) return goToChapter(state.chapter + 1);
            return show(state.chapter, state.step + 1, { dir: 1 });
        },
        prev: function () {
            clearTimeout(state.timer);
            if (!state.active) return;
            if (state.step > 0) return show(state.chapter, state.step - 1, { dir: -1 });
            if (state.chapter > 0) {
                var prevCh = chapters()[state.chapter - 1];
                if (chapterMatches(prevCh, window.location)) return show(state.chapter - 1, prevCh.steps.length - 1, { dir: -1 });
                state.chapter -= 1; state.step = Math.max(0, prevCh.steps.length - 1); persist({ resume: true }); stopSpeech();
                var url = new URL(chapterPath(prevCh), window.location.origin); url.searchParams.set('demo', '1');
                window.location.href = url.pathname + url.search;
            }
        },
        goTo: function (chapterIdx, stepIdx) { return show(chapterIdx, stepIdx || 0, {}); },
        stop: function (opts) {
            opts = opts || {};
            state.token++;
            clearTimeout(state.timer);
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
        // Al cargar una página con el demo activo: retoma si el recorrido venía
        // de otra página, o arranca si la URL trae ?tour=1.
        autoResume: function (opts) {
            opts = opts || {};
            var saved = loadPersisted();
            var idx = chapterIndexForLocation();
            var run = function () {
                if (saved && saved.active && saved.fresh) { return api.start({ chapter: 0, step: 0 }); }
                if (saved && saved.active && typeof saved.chapter === 'number') {
                    var ch = chapters()[saved.chapter];
                    if (ch && chapterMatches(ch, window.location)) return api.start({ chapter: saved.chapter, step: saved.step || 0 });
                    return; // el usuario navegó a otro lado: la barra ofrece retomar
                }
                if (opts.wantsTour) return api.start({ chapter: idx >= 0 ? idx : 0 });
            };
            // Pequeño margen para que la página pinte sus datos antes del primer paso.
            setTimeout(run, 700);
        }
    };
    window.WoTour = api;
})();
