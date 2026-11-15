/**
 * Ronda 2 · Inbox [P8] — mensajes de voz.
 *
 * Grabador (MediaRecorder) y reproductor inline accesible, compartidos por
 * /artist/inbox y /client/chats. Este módulo no sabe de hilos ni de Supabase:
 * la página le pasa cómo enviar (onSend) y cómo conseguir la URL firmada del
 * audio (getUrl). Todo el DOM se arma con createElement (sin innerHTML).
 *
 *   WoVoice.isSupported()
 *   WoVoice.attachRecorder({ form, button, canRecord, onSend, onError })
 *       → { reset(), isBusy() }
 *     · Botón de micrófono: un toque empieza a grabar y "Detener" termina;
 *       mantener pulsado graba mientras se sostiene y al soltar queda la
 *       vista previa. Después: escuchar, descartar o enviar.
 *     · Sin soporte del navegador o sin permiso de micrófono: mensaje claro
 *       por onError (la página decide dónde mostrarlo).
 *   WoVoice.player(key, { durationMs, getUrl | src, className }) → HTMLElement
 *   WoVoice.hydrate(host, getUrl)   reemplaza [data-wo-voice-path] por reproductores
 *   WoVoice.resetPlayers()          corta la reproducción y vacía la caché
 *
 * Topes y formatos: inbox-extras-model.js (los mismos que valida la base).
 */
(function () {
    'use strict';

    const X = window.WeotziInboxExtras;
    if (!X) {
        console.error('[wo-voice] inbox-extras-model.js debe cargarse antes.');
        return;
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const HOLD_MS = 600;
    const ICONS = {
        play: { fill: true, shapes: [['path', { d: 'M8 5.5v13l10.5-6.5z' }]] },
        pause: { fill: true, shapes: [['rect', { x: 6, y: 5, width: 4, height: 14 }], ['rect', { x: 14, y: 5, width: 4, height: 14 }]] },
        stop: { fill: true, shapes: [['rect', { x: 6, y: 6, width: 12, height: 12 }]] },
        trash: {
            fill: false,
            shapes: [
                ['polyline', { points: '3 6 5 6 21 6' }],
                ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
            ],
        },
    };

    function h(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function icon(name) {
        const def = ICONS[name];
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('data-icon', name);
        svg.setAttribute('fill', def.fill ? 'currentColor' : 'none');
        if (!def.fill) {
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
        }
        def.shapes.forEach(function (shape) {
            const node = document.createElementNS(SVG_NS, shape[0]);
            Object.keys(shape[1]).forEach(function (key) { node.setAttribute(key, String(shape[1][key])); });
            svg.appendChild(node);
        });
        return svg;
    }

    function setIcon(button, name) {
        const current = button.querySelector('svg');
        if (current && current.getAttribute('data-icon') === name) return;
        const next = icon(name);
        if (current) current.replaceWith(next);
        else button.insertBefore(next, button.firstChild);
    }

    /* ------------------------------------------------------------ reproductor */

    const players = new Map();
    let activePlayer = null;

    function createPlayer(options) {
        const opts = options || {};
        const totalMs = X.clampVoiceDuration(opts.durationMs);
        const root = h('div', 'wo-voice' + (opts.className ? ' ' + opts.className : ''));
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', X.VOICE_LABEL + (totalMs ? ', ' + X.spokenDuration(totalMs) : ''));

        const toggle = h('button', 'wo-voice-toggle');
        toggle.type = 'button';
        toggle.appendChild(icon('play'));
        toggle.setAttribute('aria-label', 'Reproducir mensaje de voz');

        const seek = h('input', 'wo-voice-seek');
        seek.type = 'range';
        seek.min = '0';
        seek.max = '1000';
        seek.step = '1';
        seek.value = '0';
        seek.setAttribute('aria-label', 'Posición del mensaje de voz');

        const time = h('span', 'wo-voice-time');
        time.setAttribute('aria-hidden', 'true');

        const note = h('span', 'wo-voice-note');
        note.setAttribute('role', 'status');
        note.hidden = true;

        const open = h('button', 'wo-voice-open', 'Abrir audio');
        open.type = 'button';
        open.hidden = true;

        root.appendChild(toggle);
        root.appendChild(seek);
        root.appendChild(time);
        root.appendChild(note);
        root.appendChild(open);

        let audio = null;
        let pendingUrl = null;      // promesa de la URL firmada en curso
        let url = opts.src || null; // URL lista para usar (blob: local o https: firmada)
        let state = 'idle';         // idle | loading | playing | paused | error
        let pendingRatio = null;
        let destroyed = false;
        let scrubbing = false;
        let observer = null;

        function totalSeconds() {
            if (totalMs) return totalMs / 1000;
            return audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        }

        function currentSeconds() {
            return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        }

        function paint() {
            const total = totalSeconds();
            const current = total ? Math.min(currentSeconds(), total) : currentSeconds();
            const playing = state === 'playing';
            setIcon(toggle, playing ? 'pause' : 'play');
            toggle.setAttribute('aria-label', playing ? 'Pausar mensaje de voz' : 'Reproducir mensaje de voz');
            // Sin `disabled` mientras carga: el botón no pierde el foco.
            if (state === 'loading') toggle.setAttribute('aria-busy', 'true');
            else toggle.removeAttribute('aria-busy');
            root.classList.toggle('is-playing', playing);
            root.classList.toggle('is-loading', state === 'loading');
            root.classList.toggle('is-error', state === 'error');
            // Mientras se arrastra, la posición la manda el dedo o el mouse.
            if (!scrubbing) seek.value = String(total ? Math.round((current / total) * 1000) : 0);
            seek.setAttribute('aria-valuetext', X.formatDuration(current * 1000) + ' de ' + X.formatDuration(total * 1000));
            time.textContent = (state === 'idle' && !current)
                ? X.formatDuration(total * 1000)
                : X.formatDuration(current * 1000) + ' / ' + X.formatDuration(total * 1000);
        }

        function fail(message) {
            state = 'error';
            const failed = audio;
            audio = null;
            if (failed) {
                try { failed.pause(); } catch (_) { /* noop */ }
            }
            if (activePlayer === api) activePlayer = null;
            note.textContent = message;
            note.hidden = false;
            // Un audio ya enviado se puede abrir o descargar en otra pestaña
            // (la vista previa local no: todavía no se subió).
            open.hidden = Boolean(opts.src) || typeof opts.getUrl !== 'function';
            // Las URL firmadas vencen: al reintentar se pide otra.
            if (!opts.src) url = null;
            paint();
        }

        function resolveUrl() {
            if (url) return Promise.resolve(url);
            if (pendingUrl) return pendingUrl;
            if (typeof opts.getUrl !== 'function') return Promise.reject(new Error('sin URL'));
            pendingUrl = Promise.resolve().then(function () { return opts.getUrl(); }).then(function (value) {
                pendingUrl = null;
                if (!value || !/^https:/i.test(String(value))) throw new Error('sin URL');
                url = String(value);
                return url;
            }, function (error) {
                pendingUrl = null;
                throw error;
            });
            return pendingUrl;
        }

        // La URL se pide cuando el reproductor entra en pantalla: así, al tocar
        // "Reproducir", el play() ocurre dentro del gesto (Safari lo exige).
        function prefetch() {
            if (url || destroyed || state === 'error') return;
            resolveUrl().catch(function () { /* se reintenta al reproducir */ });
        }

        function buildAudio(source) {
            if (!/^(https:|blob:)/i.test(String(source || ''))) throw new Error('sin URL');
            const element = new Audio();
            element.preload = 'metadata';
            element.addEventListener('timeupdate', paint);
            element.addEventListener('loadedmetadata', paint);
            element.addEventListener('play', function () {
                if (audio !== element) return;
                state = 'playing';
                paint();
            });
            element.addEventListener('pause', function () {
                if (audio !== element || state === 'error') return;
                state = 'paused';
                paint();
            });
            element.addEventListener('ended', function () {
                if (audio !== element) return;
                try { element.currentTime = 0; } catch (_) { /* noop */ }
                state = 'idle';
                if (activePlayer === api) activePlayer = null;
                paint();
            });
            element.addEventListener('error', function () {
                if (audio === element) fail('No se pudo reproducir en este navegador.');
            });
            element.src = String(source);
            audio = element;
            return element;
        }

        function startPlayback(element) {
            if (activePlayer && activePlayer !== api) activePlayer.pause();
            activePlayer = api;
            if (pendingRatio !== null) {
                applySeek(pendingRatio);
                pendingRatio = null;
            }
            let started;
            try {
                started = element.play();
            } catch (_) {
                fail('No se pudo reproducir en este navegador.');
                return;
            }
            if (started && typeof started.catch === 'function') {
                started.catch(function (error) {
                    if (audio !== element) return;
                    const name = error && error.name;
                    if (name === 'AbortError') return; // se pausó mientras cargaba
                    if (name === 'NotAllowedError') {
                        // El navegador pidió otro gesto (la URL tardó en llegar):
                        // el audio queda listo y el próximo toque lo reproduce.
                        state = 'paused';
                        paint();
                        return;
                    }
                    fail('No se pudo reproducir en este navegador.');
                });
            }
        }

        function play() {
            if (destroyed || state === 'loading') return;
            if (state === 'error') state = 'idle'; // reintento
            note.hidden = true;
            open.hidden = true;
            if (audio || url) {
                let element = audio;
                if (!element) {
                    try {
                        element = buildAudio(url);
                    } catch (_) {
                        fail('No pudimos cargar el audio. Vuelve a intentarlo.');
                        return;
                    }
                }
                startPlayback(element);
                return;
            }
            state = 'loading';
            paint();
            resolveUrl().then(function (value) {
                if (destroyed) return;
                state = 'paused';
                startPlayback(buildAudio(value));
            }).catch(function () {
                if (!destroyed) fail('No pudimos cargar el audio. Vuelve a intentarlo.');
            });
        }

        function pause() {
            if (audio && !audio.paused) audio.pause();
        }

        function applySeek(ratio) {
            const total = totalSeconds();
            if (!audio || !total) return;
            try { audio.currentTime = Math.max(0, Math.min(total, ratio * total)); } catch (_) { /* webm sin índice */ }
            paint();
        }

        // La pestaña se abre en el gesto del usuario (los bloqueadores de
        // pop-ups cortan window.open después de un await) y recién ahí se le
        // carga la URL firmada.
        function openExternal() {
            if (typeof opts.getUrl !== 'function') return;
            const popup = window.open('', '_blank');
            Promise.resolve().then(function () { return opts.getUrl(); }).then(function (target) {
                if (!target || !/^https:/i.test(String(target))) throw new Error('sin URL');
                if (popup) {
                    popup.opener = null;
                    popup.location.href = String(target);
                } else {
                    window.location.assign(String(target));
                }
            }).catch(function () {
                if (popup) popup.close();
            });
        }

        toggle.addEventListener('click', function () {
            if (state === 'playing') pause();
            else play();
        });
        toggle.addEventListener('pointerenter', prefetch);
        toggle.addEventListener('focus', prefetch);
        seek.addEventListener('input', function () {
            const ratio = Number(seek.value) / 1000;
            if (audio) applySeek(ratio);
            else pendingRatio = ratio;
        });
        seek.addEventListener('pointerdown', function () {
            scrubbing = true;
            const release = function () {
                scrubbing = false;
                window.removeEventListener('pointerup', release);
                window.removeEventListener('pointercancel', release);
                paint();
            };
            window.addEventListener('pointerup', release);
            window.addEventListener('pointercancel', release);
        });
        open.addEventListener('click', openExternal);

        if (!opts.src && typeof window.IntersectionObserver === 'function') {
            observer = new window.IntersectionObserver(function (entries) {
                if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
                prefetch();
                observer.disconnect();
                observer = null;
            });
            observer.observe(root);
        }

        const api = {
            el: root,
            pause: pause,
            destroy: function () {
                destroyed = true;
                if (observer) observer.disconnect();
                observer = null;
                const element = audio;
                audio = null;
                if (element) {
                    try { element.pause(); } catch (_) { /* noop */ }
                    element.removeAttribute('src');
                    try { element.load(); } catch (_) { /* noop */ }
                }
                if (activePlayer === api) activePlayer = null;
            },
        };
        paint();
        return api;
    }

    // Reproductor en caché por clave: un re-render del hilo reutiliza el mismo
    // nodo y el audio que estaba sonando no se corta.
    function player(key, options) {
        if (key && players.has(key)) return players.get(key).el;
        const api = createPlayer(options);
        if (key) players.set(key, api);
        return api.el;
    }

    function resetPlayers() {
        players.forEach(function (api) { api.destroy(); });
        players.clear();
        activePlayer = null;
    }

    function hydrate(host, getUrl) {
        if (!host) return;
        host.querySelectorAll('[data-wo-voice-path]').forEach(function (slot) {
            const source = slot.getAttribute('data-wo-voice-source') || 'inbox';
            const path = slot.getAttribute('data-wo-voice-path');
            if (!path) return;
            slot.replaceWith(player(source + ':' + path, {
                durationMs: Number(slot.getAttribute('data-wo-voice-ms')) || 0,
                getUrl: function () { return getUrl(source, path); },
            }));
        });
    }

    /* --------------------------------------------------------------- grabador */

    function recorderMime() {
        if (typeof window.MediaRecorder !== 'function' || typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
        return X.pickRecorderMime(function (type) { return window.MediaRecorder.isTypeSupported(type); });
    }

    function isSupported() {
        return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && recorderMime());
    }

    function stopTracks(stream) {
        if (!stream || typeof stream.getTracks !== 'function') return;
        stream.getTracks().forEach(function (track) {
            try { track.stop(); } catch (_) { /* noop */ }
        });
    }

    function attachRecorder(options) {
        const opts = options || {};
        const form = opts.form;
        const button = opts.button;
        if (!form || !button) return { reset: function () {}, isBusy: function () { return false; } };

        const bar = h('div', 'wo-voice-bar');
        bar.hidden = true;
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Grabación de mensaje de voz');

        const cancelBtn = h('button', 'wo-voice-cancel');
        cancelBtn.type = 'button';
        cancelBtn.appendChild(icon('trash'));
        cancelBtn.setAttribute('aria-label', 'Descartar mensaje de voz');
        cancelBtn.title = 'Descartar';

        const body = h('div', 'wo-voice-body');
        const live = h('div', 'wo-voice-live');
        const dot = h('span', 'wo-voice-dot');
        dot.setAttribute('aria-hidden', 'true');
        const liveLabel = h('span', 'wo-voice-live-label', 'Grabando');
        const clock = h('span', 'wo-voice-clock', '0:00');
        const limit = h('span', 'wo-voice-limit', 'máx. ' + X.formatDuration(X.VOICE_MAX_MS));
        live.appendChild(dot);
        live.appendChild(liveLabel);
        live.appendChild(clock);
        live.appendChild(limit);
        const previewSlot = h('div', 'wo-voice-preview');
        previewSlot.hidden = true;
        body.appendChild(live);
        body.appendChild(previewSlot);

        const stopBtn = h('button', 'wo-voice-stop');
        stopBtn.type = 'button';
        stopBtn.appendChild(icon('stop'));
        stopBtn.appendChild(h('span', '', 'Detener'));
        stopBtn.setAttribute('aria-label', 'Detener grabación');

        const sendBtn = h('button', 'wo-btn wo-voice-send', 'Enviar');
        sendBtn.type = 'button';
        sendBtn.setAttribute('aria-label', 'Enviar mensaje de voz');

        const status = h('span', 'wo-sr-only');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        bar.appendChild(cancelBtn);
        bar.appendChild(body);
        bar.appendChild(stopBtn);
        bar.appendChild(sendBtn);
        bar.appendChild(status);
        form.appendChild(bar);

        let state = 'idle'; // idle | requesting | recording | preview | sending
        let session = null; // { recorder, stream, chunks, discard, startedAt, stoppedAt, byLimit }
        let clip = null;    // { blob, mime, durationMs, url }
        let previewPlayer = null;
        let tickTimer = null;
        let maxTimer = null;
        let pressing = false;
        let pressAt = 0;
        let startedByPointer = false;

        if (!isSupported()) {
            button.classList.add('is-unsupported');
            button.title = 'La grabación de voz no está disponible en este navegador';
        }

        function announce(text) { status.textContent = text || ''; }

        function fail(message) {
            announce(message);
            if (typeof opts.onError === 'function') opts.onError(message);
        }

        function setState(next) {
            state = next;
            const idle = state === 'idle';
            bar.hidden = idle;
            form.classList.toggle('is-voice', !idle);
            bar.dataset.state = state;
            live.hidden = !(state === 'requesting' || state === 'recording');
            previewSlot.hidden = !(state === 'preview' || state === 'sending');
            stopBtn.hidden = state !== 'recording';
            sendBtn.hidden = !(state === 'preview' || state === 'sending');
            sendBtn.disabled = state === 'sending';
            sendBtn.textContent = state === 'sending' ? 'Enviando…' : 'Enviar';
            cancelBtn.disabled = state === 'sending';
            liveLabel.textContent = state === 'requesting' ? 'Esperando el micrófono…' : 'Grabando';
            dot.hidden = state !== 'recording';
            clock.hidden = state !== 'recording';
            limit.hidden = state !== 'recording';
        }

        function clearTimers() {
            window.clearInterval(tickTimer);
            window.clearTimeout(maxTimer);
            tickTimer = null;
            maxTimer = null;
        }

        function tick() {
            if (!session) return;
            clock.textContent = X.formatDuration(Math.min(performance.now() - session.startedAt, X.VOICE_MAX_MS));
        }

        function disposeClip() {
            if (previewPlayer) previewPlayer.destroy();
            previewPlayer = null;
            if (clip && clip.url) {
                try { URL.revokeObjectURL(clip.url); } catch (_) { /* noop */ }
            }
            clip = null;
            previewSlot.textContent = '';
        }

        function focusButton() {
            if (button.disabled || button.hidden) return;
            try { button.focus(); } catch (_) { /* noop */ }
        }

        async function start() {
            if (state !== 'idle') return;
            if (typeof opts.canRecord === 'function' && !opts.canRecord()) return;
            if (!isSupported()) {
                fail(X.VOICE_UNSUPPORTED);
                return;
            }
            setState('requesting');
            // El botón del micrófono queda oculto: con teclado el foco pasa a la barra.
            if (!pressing) {
                try { cancelBtn.focus(); } catch (_) { /* noop */ }
            }
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                });
            } catch (error) {
                if (state === 'requesting') {
                    setState('idle');
                    focusButton();
                }
                fail(X.recorderErrorMessage(error));
                return;
            }
            if (state !== 'requesting') {
                // Se descartó mientras el navegador pedía el permiso.
                stopTracks(stream);
                return;
            }

            const preferred = recorderMime();
            let recorder;
            try {
                recorder = new window.MediaRecorder(stream, { mimeType: preferred, audioBitsPerSecond: 48000 });
            } catch (_) {
                try {
                    recorder = new window.MediaRecorder(stream);
                } catch (error) {
                    stopTracks(stream);
                    setState('idle');
                    fail(X.recorderErrorMessage(error));
                    return;
                }
            }

            const current = {
                recorder: recorder, stream: stream, chunks: [], discard: false, done: false,
                startedAt: 0, stoppedAt: 0, byLimit: false, preferred: preferred,
            };
            session = current;
            recorder.addEventListener('dataavailable', function (event) {
                if (event.data && event.data.size) current.chunks.push(event.data);
            });
            recorder.addEventListener('stop', function () { onRecorderStop(current); });
            recorder.addEventListener('error', function () {
                current.discard = true;
                stopTracks(current.stream);
                if (session === current) {
                    clearTimers();
                    session = null;
                    setState('idle');
                    fail('La grabación se interrumpió. Vuelve a intentarlo.');
                }
            });
            try {
                recorder.start(250);
            } catch (error) {
                current.discard = true;
                stopTracks(stream);
                session = null;
                setState('idle');
                fail(X.recorderErrorMessage(error));
                return;
            }
            current.startedAt = performance.now();
            clock.textContent = '0:00';
            setState('recording');
            announce('Grabando mensaje de voz.');
            tickTimer = window.setInterval(tick, 200);
            maxTimer = window.setTimeout(function () { stop(true); }, X.VOICE_MAX_MS);
            if (!pressing) {
                try { stopBtn.focus(); } catch (_) { /* noop */ }
            }
        }

        function stop(byLimit) {
            if (state !== 'recording' || !session) return;
            const current = session;
            current.stoppedAt = performance.now();
            current.byLimit = Boolean(byLimit);
            clearTimers();
            try {
                current.recorder.stop();
            } catch (_) {
                onRecorderStop(current);
            }
        }

        function onRecorderStop(current) {
            stopTracks(current.stream);
            if (current.done) return;
            current.done = true;
            if (session === current) session = null;
            if (current.discard) return;
            const mime = X.baseMime(current.recorder.mimeType || (current.chunks[0] && current.chunks[0].type) || current.preferred);
            const durationMs = X.clampVoiceDuration((current.stoppedAt || performance.now()) - current.startedAt);
            const blob = new Blob(current.chunks, { type: mime });
            current.chunks = [];
            const check = X.validateVoice({ type: mime, size: blob.size, durationMs: durationMs });
            if (!check.ok) {
                setState('idle');
                fail(check.error);
                focusButton();
                return;
            }
            disposeClip();
            clip = { blob: blob, mime: mime, durationMs: durationMs, url: URL.createObjectURL(blob) };
            previewPlayer = createPlayer({ durationMs: durationMs, src: clip.url, className: 'wo-voice--preview' });
            previewSlot.appendChild(previewPlayer.el);
            setState('preview');
            announce('Grabación lista: ' + X.spokenDuration(durationMs) + '. Puedes escucharla, enviarla o descartarla.'
                + (current.byLimit ? ' Llegaste al máximo de 3 minutos.' : ''));
            try { sendBtn.focus(); } catch (_) { /* noop */ }
        }

        function cancel(silent) {
            if (state === 'idle' || state === 'sending') return;
            clearTimers();
            if (session) {
                const current = session;
                session = null;
                current.discard = true;
                try { current.recorder.stop(); } catch (_) { /* ya estaba detenido */ }
                stopTracks(current.stream);
            }
            disposeClip();
            setState('idle');
            if (!silent) {
                announce('Mensaje de voz descartado.');
                focusButton();
            }
        }

        async function send() {
            if (state !== 'preview' || !clip) return;
            if (previewPlayer) previewPlayer.pause();
            setState('sending');
            const name = X.voiceFileName(clip.mime, Date.now());
            let file;
            try {
                file = new File([clip.blob], name, { type: clip.mime });
            } catch (_) {
                file = clip.blob;
                try { file.name = name; } catch (__) { /* Blob sin nombre */ }
            }
            try {
                await opts.onSend({ file: file, durationMs: clip.durationMs, mime: clip.mime });
                disposeClip();
                setState('idle');
                announce('Mensaje de voz enviado.');
                focusButton();
            } catch (error) {
                console.error('[wo-voice] enviar', error);
                setState('preview');
                fail('No pudimos enviar el mensaje de voz. Tu grabación sigue aquí para reintentar.');
            }
        }

        function onRelease() {
            window.removeEventListener('pointerup', onRelease);
            window.removeEventListener('pointercancel', onRelease);
            if (!pressing) return;
            pressing = false;
            // El click de este mismo gesto (si llega) no debe volver a empezar.
            window.setTimeout(function () { startedByPointer = false; }, 400);
            // Mantener y soltar: termina la grabación. Un toque corto sigue
            // grabando hasta "Detener".
            if (performance.now() - pressAt >= HOLD_MS && state === 'recording') stop(false);
        }

        button.addEventListener('pointerdown', function (event) {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (state !== 'idle' || button.disabled) return;
            pressing = true;
            pressAt = performance.now();
            startedByPointer = true;
            window.addEventListener('pointerup', onRelease);
            window.addEventListener('pointercancel', onRelease);
            start();
        });
        button.addEventListener('click', function () {
            if (startedByPointer) {
                startedByPointer = false;
                return;
            }
            start(); // teclado o lectores de pantalla
        });
        button.addEventListener('contextmenu', function (event) {
            if (pressing) event.preventDefault();
        });

        stopBtn.addEventListener('click', function () { stop(false); });
        cancelBtn.addEventListener('click', function () { cancel(false); });
        sendBtn.addEventListener('click', send);
        bar.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && state !== 'sending') {
                event.preventDefault();
                cancel(false);
            }
        });
        window.addEventListener('pagehide', function () { cancel(true); });

        setState('idle');

        return {
            reset: function () { cancel(true); },
            isBusy: function () { return state !== 'idle'; },
        };
    }

    window.WoVoice = {
        isSupported: isSupported,
        attachRecorder: attachRecorder,
        player: player,
        hydrate: hydrate,
        resetPlayers: resetPlayers,
    };
})();
