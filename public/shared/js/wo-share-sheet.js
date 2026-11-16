/* ============================================================================
   WE ÖTZI — Hoja "Compartir" (perfil público del artista)
   ----------------------------------------------------------------------------
   Diálogo nativo (<dialog>, foco atrapado y Escape) con las formas de
   compartir un enlace: copiar, menú nativo del teléfono (navigator.share),
   WhatsApp, historia de Instagram, Facebook, X y código QR descargable. Lo usa
   el perfil público (dueño y visitantes). Ronda 2 (nota N8): sin Mail,
   Telegram ni LinkedIn, e Instagram arma una historia.

   Uso:
     WoShareSheet.open({
       url, title, text,            // qué se comparte
       name,                        // nombre visible en la vista previa
       heading,                     // título del diálogo ("Compartir perfil")
       trigger,                     // botón que lo abrió (vuelve el foco)
       story: { artist, prefs },    // datos para la historia (wo-share-cards.js)
       onShare(channel),            // telemetría / onboarding (opcional)
       extra: { label, href }       // enlace secundario (opcional)
     });

   Instagram no acepta enlaces por URL. Con `story` y wo-share-cards.js se
   compone una imagen vertical 1080×1920 al abrir la hoja; al tocar Instagram:
     · teléfono con navigator.canShare({ files }): se comparte la imagen directo
       a Instagram u otra app (el enlace queda copiado para el sticker);
     · escritorio: se descarga la imagen, se copia el enlace y se muestran los
       pasos para subirla a la historia.
   navigator.share, window.open y la copia se llaman dentro del mismo click
   (Safari iOS bloquea los que llegan después de una promesa): por eso la
   imagen se prepara antes, al abrir.
   ============================================================================ */
(function (root) {
    'use strict';

    var state = { opts: null, dialog: null, qrOpen: false, storyOpen: false, story: null };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function icon(name) { return '<i data-wo-icon="' + esc(name) + '" aria-hidden="true"></i>'; }
    function hydrate(node) {
        if (root.WoIcons && typeof root.WoIcons.hydrate === 'function') {
            try { root.WoIcons.hydrate(node); } catch (e) { /* íconos opcionales */ }
        }
    }
    function prettyUrl(url) { return String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, ''); }
    function canNativeShare() { return typeof root.navigator !== 'undefined' && typeof root.navigator.share === 'function'; }
    function isTouch() {
        try { return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
    }

    /** Redes con enlace directo (función pura, se testea en Node). */
    var NETWORKS = ['whatsapp', 'instagram', 'facebook', 'x', 'qr'];
    function networkLinks(url, text) {
        var u = encodeURIComponent(url || '');
        var t = encodeURIComponent(text || '');
        var msg = encodeURIComponent((text ? text + ': ' : '') + (url || ''));
        return {
            whatsapp: 'https://wa.me/?text=' + msg,
            facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
            x: 'https://twitter.com/intent/tweet?url=' + u + (text ? '&text=' + t : '')
        };
    }

    /* ------------------------------ copiar ------------------------------ */
    function legacyCopy(text) {
        return new Promise(function (resolve, reject) {
            var input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', '');
            input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:-9999px';
            (state.dialog || document.body).appendChild(input);
            input.select();
            try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); }
            catch (e) { reject(e); }
            finally { input.parentNode.removeChild(input); }
        });
    }
    function copy(text) {
        if (!text) return Promise.reject(new Error('Sin enlace'));
        var clip = root.navigator && root.navigator.clipboard;
        if (clip && typeof clip.writeText === 'function' && root.isSecureContext !== false) {
            return clip.writeText(text).catch(function () { return legacyCopy(text); });
        }
        return legacyCopy(text);
    }

    function announce(msg) {
        var live = state.dialog && state.dialog.querySelector('[data-share-status]');
        if (!live) return;
        live.textContent = '';
        setTimeout(function () { live.textContent = msg; }, 30);
    }
    function track(channel) {
        var fn = state.opts && state.opts.onShare;
        if (typeof fn === 'function') { try { fn(channel); } catch (e) { /* noop */ } }
    }

    /* ------------------------------- QR -------------------------------- */
    function inkColor() {
        try { return getComputedStyle(document.documentElement).getPropertyValue('--neutral-500').trim() || '#24211D'; }
        catch (e) { return '#24211D'; }
    }
    function drawQr(canvas, url, size) {
        if (typeof root.qrcode !== 'function' || !canvas || !url) return false;
        var qr = root.qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        var n = qr.getModuleCount(), quiet = 2;
        var cell = Math.max(1, Math.floor(size / (n + quiet * 2)));
        var px = cell * (n + quiet * 2);
        canvas.width = px;
        canvas.height = px;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, px, px);
        ctx.fillStyle = inkColor();
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
        }
        return true;
    }
    function fileSlug() {
        var o = state.opts || {};
        return String(o.fileName || o.name || 'perfil').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil';
    }
    function download(href, name) {
        var a = document.createElement('a');
        a.href = href;
        a.download = name;
        a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
    }
    function downloadQr() {
        var canvas = state.dialog.querySelector('.wss-qr-canvas');
        if (!canvas) return;
        try {
            download(canvas.toDataURL('image/png'), 'qr-' + fileSlug() + '.png');
            announce('Descargamos el código QR.');
            track('qr_download');
        } catch (e) { announce('No pudimos descargar el código QR.'); }
    }
    function toggleQr(force) {
        var panel = state.dialog.querySelector('[data-share-qr]');
        var btn = state.dialog.querySelector('[data-net="qr"]');
        if (!panel) return;
        state.qrOpen = typeof force === 'boolean' ? force : !state.qrOpen;
        panel.hidden = !state.qrOpen;
        if (btn) btn.setAttribute('aria-expanded', String(state.qrOpen));
        if (state.qrOpen) {
            if (state.storyOpen) toggleStory(false);
            var ok = drawQr(panel.querySelector('.wss-qr-canvas'), state.opts.url, 480);
            panel.querySelector('[data-qr-fallback]').hidden = ok;
            panel.querySelector('[data-qr-download]').hidden = !ok;
            track('qr');
        }
    }

    /* ---------------------- historia de Instagram ----------------------- */
    function cards() { return root.WoShareCards || null; }
    function hasStory() { return !!(state.opts && state.opts.story && cards()); }

    // Compone la imagen apenas se abre la hoja: al tocar Instagram ya está lista.
    function prepareStory() {
        var C = cards();
        var o = state.opts;
        if (!C || !o || !o.story) { state.story = null; return; }
        var s = { status: 'loading', blob: null, file: null, canvas: null, downloaded: false, promise: null };
        state.story = s;
        var input = {};
        Object.keys(o.story).forEach(function (key) { input[key] = o.story[key]; });
        input.url = o.url;
        s.promise = C.renderStory(input).then(function (canvas) {
            return C.toBlob(canvas, 'image/jpeg', 0.92).then(function (blob) {
                s.canvas = canvas;
                s.blob = blob;
                try { s.file = new File([blob], C.storyFileName(o.fileName || o.name), { type: 'image/jpeg' }); }
                catch (e) { s.file = null; }
                s.status = 'ready';
            });
        }).catch(function () {
            s.status = 'error';
        }).then(function () {
            if (state.story === s) paintStory();
            return s;
        });
    }

    function canShareStoryFile() {
        var s = state.story;
        var nav = root.navigator;
        if (!s || s.status !== 'ready' || !s.file || !nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
        try { return nav.canShare({ files: [s.file] }) === true; } catch (e) { return false; }
    }

    function setStoryNote(msg) {
        var note = state.dialog && state.dialog.querySelector('[data-story-note]');
        if (note) { note.textContent = msg || ''; note.hidden = !msg; }
        if (msg) announce(msg);
    }

    function paintStory() {
        var panel = state.dialog && state.dialog.querySelector('[data-share-story]');
        var s = state.story;
        if (!panel || !s) return;
        var canvas = panel.querySelector('.wss-story-canvas');
        var wait = panel.querySelector('[data-story-wait]');
        var shareBtn = panel.querySelector('[data-share-act="story-share"]');
        var saveBtn = panel.querySelector('[data-share-act="story-download"]');
        var ready = s.status === 'ready';
        if (wait) {
            wait.hidden = ready;
            wait.textContent = s.status === 'error'
                ? 'No pudimos crear la imagen en este navegador. Copia el enlace y pégalo en tu historia.'
                : 'Preparando tu historia…';
        }
        if (canvas) {
            canvas.hidden = !ready;
            if (ready && s.canvas) {
                try { canvas.getContext('2d').drawImage(s.canvas, 0, 0, canvas.width, canvas.height); }
                catch (e) { canvas.hidden = true; }
            }
        }
        if (saveBtn) saveBtn.disabled = !ready;
        if (shareBtn) shareBtn.hidden = !(ready && isTouch() && canShareStoryFile());
    }

    function toggleStory(force) {
        var panel = state.dialog && state.dialog.querySelector('[data-share-story]');
        var btn = state.dialog && state.dialog.querySelector('[data-net="instagram"]');
        if (!panel) return;
        state.storyOpen = typeof force === 'boolean' ? force : !state.storyOpen;
        panel.hidden = !state.storyOpen;
        if (btn) btn.setAttribute('aria-expanded', String(state.storyOpen));
        if (state.storyOpen) {
            if (state.qrOpen) toggleQr(false);
            paintStory();
        }
    }

    // Tiene que correr dentro del click (gesto del usuario).
    function shareStoryFile() {
        var s = state.story;
        root.navigator.share({ files: [s.file], title: (state.opts && state.opts.title) || '' }).then(function () {
            track('story');
            setStoryNote('Listo. Agrega el sticker de enlace en tu historia y pega el enlace: ya está copiado.');
        }).catch(function (e) {
            if (e && e.name !== 'AbortError') setStoryNote('No pudimos abrir el menú para compartir. Descarga la imagen y súbela a tu historia.');
        });
    }

    function downloadStory() {
        var s = state.story;
        if (!s || s.status !== 'ready' || !s.blob) return false;
        var C = cards();
        try {
            var href = URL.createObjectURL(s.blob);
            download(href, C ? C.storyFileName((state.opts && (state.opts.fileName || state.opts.name)) || '') : 'historia.jpg');
            setTimeout(function () { URL.revokeObjectURL(href); }, 2000);
            s.downloaded = true;
            track('story');
            return true;
        } catch (e) {
            return false;
        }
    }

    function shareInstagram() {
        var o = state.opts;
        track('instagram');
        // El enlace va al portapapeles en el mismo click: se pega en el sticker de enlace.
        var copied = copy(o.url);
        var copiedNote = function (ok, extra) {
            return (ok ? 'Copiamos el enlace. ' : 'Copia el enlace de arriba. ') + extra;
        };

        if (!hasStory()) {
            // Sin compositor de historias: se abre Instagram con el enlace copiado.
            try { root.open('https://www.instagram.com/', '_blank', 'noopener'); } catch (e) { /* bloqueado */ }
            copied.then(function () { announce(copiedNote(true, 'Pégalo en tu historia, en tu bio o en un mensaje de Instagram.')); })
                .catch(function () { announce(copiedNote(false, 'Pégalo en tu historia, en tu bio o en un mensaje de Instagram.')); });
            return;
        }

        // Teléfono: la imagen ya está lista → menú del sistema (Instagram, historias, otras apps).
        if (isTouch() && canShareStoryFile()) {
            shareStoryFile();
            toggleStory(true);
            copied.catch(function () { /* el enlace sigue visible arriba */ });
            return;
        }

        toggleStory(true);
        var s = state.story;
        var touch = isTouch();
        var steps = touch
            ? 'Toca "Compartir historia" o guarda la imagen y súbela a tu historia.'
            : 'Sube la imagen a tu historia y pega el enlace con el sticker de enlace.';
        copied.then(function () { setStoryNote(copiedNote(true, steps)); })
            .catch(function () { setStoryNote(copiedNote(false, steps)); });

        // Escritorio: la imagen se descarga sola (una vez) en cuanto está lista.
        if (!touch && s && !s.downloaded) {
            if (s.status === 'ready') downloadStory();
            else if (s.promise) {
                s.promise.then(function (done) {
                    if (state.story === done && state.storyOpen && done.status === 'ready' && !done.downloaded) downloadStory();
                });
            }
        }
    }

    /* ------------------------------ acciones ----------------------------- */
    function nativeShare() {
        var o = state.opts;
        if (!canNativeShare()) return false;
        var data = { title: o.title || '', text: o.text || '', url: o.url };
        // Se llama sin esperar nada antes: así Safari iOS conserva el gesto del click.
        root.navigator.share(data).then(function () { track('native'); }).catch(function (e) {
            if (e && e.name !== 'AbortError') announce('No pudimos abrir el menú para compartir.');
        });
        return true;
    }

    function onClick(e) {
        var t = e.target.closest('[data-share-act], [data-net]');
        if (!t || !state.dialog.contains(t)) return;
        var act = t.getAttribute('data-share-act');
        var net = t.getAttribute('data-net');
        if (act === 'close') { close(); return; }
        if (act === 'copy') {
            copy(state.opts.url).then(function () {
                announce('Enlace copiado.');
                var label = t.querySelector('[data-label]');
                if (label) {
                    label.textContent = 'Copiado';
                    setTimeout(function () { label.textContent = 'Copiar enlace'; }, 2000);
                }
                track('copy');
            }).catch(function () { announce('No pudimos copiar. Selecciona el enlace y cópialo a mano.'); });
            return;
        }
        if (act === 'native') { nativeShare(); return; }
        if (act === 'qr-download') { downloadQr(); return; }
        if (act === 'story-share') {
            if (canShareStoryFile()) shareStoryFile();
            return;
        }
        if (act === 'story-download') {
            if (downloadStory()) setStoryNote('Descargamos la imagen. Súbela a tu historia y pega el enlace con el sticker de enlace.');
            else setStoryNote('La imagen todavía no está lista. Intenta de nuevo en unos segundos.');
            return;
        }
        if (net === 'instagram') { e.preventDefault(); shareInstagram(); return; }
        if (net === 'qr') { e.preventDefault(); toggleQr(); return; }
        if (net) track(net); // los <a> de redes navegan solos
    }

    /* ------------------------------ render ------------------------------ */
    function render() {
        var o = state.opts;
        var links = networkLinks(o.url, o.text);
        var story = hasStory();
        var nets = [
            ['whatsapp', 'WhatsApp', 'message-circle', links.whatsapp],
            ['instagram', story ? 'Historia' : 'Instagram', 'instagram', null],
            ['facebook', 'Facebook', 'facebook', links.facebook],
            ['x', 'X', 'twitter', links.x],
            ['qr', 'Código QR', 'grid', null]
        ];
        var netsHtml = nets.map(function (n) {
            var label = '<span>' + esc(n[1]) + '</span>';
            if (!n[3]) {
                var extra = n[0] === 'qr'
                    ? ' aria-expanded="false" aria-controls="wss-qr"'
                    : (story ? ' aria-expanded="false" aria-controls="wss-story" aria-label="Compartir en una historia de Instagram"' : '');
                return '<li><button type="button" class="wss-net" data-net="' + n[0] + '"' + extra + '>' + icon(n[2]) + label + '</button></li>';
            }
            return '<li><a class="wss-net" data-net="' + n[0] + '" href="' + esc(n[3]) + '" target="_blank" rel="noopener noreferrer">'
                + icon(n[2]) + label + '<span class="wo-sr-only"> (se abre en otra pestaña)</span></a></li>';
        }).join('');
        var initials = String(o.name || 'WÖ').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase() || 'Ö';
        var storyHtml = !story ? '' :
            '<div class="wss-story" id="wss-story" data-share-story hidden>' +
                '<div class="wss-story-preview">' +
                    '<canvas class="wss-story-canvas" width="270" height="480" role="img" aria-label="Vista previa de la historia de ' + esc(o.name || 'este perfil') + '" hidden></canvas>' +
                    '<p class="wss-story-wait" data-story-wait>Preparando tu historia…</p>' +
                '</div>' +
                '<div class="wss-story-side">' +
                    '<p class="wss-story-title">Historia de Instagram</p>' +
                    '<ol class="wss-story-steps">' +
                        '<li>Guarda o comparte la imagen.</li>' +
                        '<li>Súbela a tu historia.</li>' +
                        '<li>Agrega el sticker de enlace y pega el enlace.</li>' +
                    '</ol>' +
                    '<p class="wss-story-note" data-story-note hidden></p>' +
                    '<div class="wss-story-actions">' +
                        '<button type="button" class="wo-btn wo-btn--accent wo-btn--hard wo-btn--s" data-share-act="story-share" hidden>' + icon('share-2') + '<span>Compartir historia</span></button>' +
                        '<button type="button" class="wo-btn wo-btn--ghost wo-btn--hard wo-btn--s" data-share-act="story-download" disabled>' + icon('download') + '<span>Descargar imagen</span></button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        state.dialog.innerHTML =
            '<div class="wss-head">' +
                '<h2 class="wss-title" id="wss-title">' + esc(o.heading || 'Compartir') + '</h2>' +
                '<button type="button" class="wss-x" data-share-act="close" aria-label="Cerrar">' + icon('x') + '</button>' +
            '</div>' +
            '<div class="wss-body">' +
                '<div class="wss-card">' +
                    '<span class="wss-avatar" aria-hidden="true">' + (o.image ? '<img src="' + esc(o.image) + '" alt="">' : esc(initials.slice(0, 2))) + '</span>' +
                    '<span class="wss-id"><strong>' + esc(o.name || '') + '</strong><small>' + esc(prettyUrl(o.url)) + '</small></span>' +
                '</div>' +
                '<label class="wss-label" for="wss-url">Enlace</label>' +
                '<div class="wss-link">' +
                    '<input id="wss-url" class="wss-input" readonly value="' + esc(o.url) + '">' +
                    '<button type="button" class="wo-btn wo-btn--hard wo-btn--s wss-copy" data-share-act="copy">' + icon('copy') + '<span data-label>Copiar enlace</span></button>' +
                '</div>' +
                (canNativeShare()
                    ? '<button type="button" class="wo-btn wo-btn--accent wo-btn--hard wss-native" data-share-act="native">' + icon('share-2') + '<span>Más opciones para compartir</span></button>'
                    : '') +
                '<p class="wss-label" id="wss-nets-label">Compartir en</p>' +
                '<ul class="wss-nets" aria-labelledby="wss-nets-label">' + netsHtml + '</ul>' +
                storyHtml +
                '<div class="wss-qr" id="wss-qr" data-share-qr hidden>' +
                    '<canvas class="wss-qr-canvas" width="240" height="240" role="img" aria-label="Código QR de ' + esc(prettyUrl(o.url)) + '"></canvas>' +
                    '<p class="wss-qr-note" data-qr-fallback hidden>No pudimos generar el código QR en este navegador.</p>' +
                    '<button type="button" class="wo-btn wo-btn--ghost wo-btn--hard wo-btn--s" data-share-act="qr-download" data-qr-download>' + icon('download') + '<span>Descargar PNG</span></button>' +
                '</div>' +
                (o.extra && o.extra.href
                    ? '<a class="wss-extra" href="' + esc(o.extra.href) + '">' + esc(o.extra.label || 'Más opciones') + ' →</a>'
                    : '') +
                '<p class="wo-sr-only" role="status" aria-live="polite" data-share-status></p>' +
            '</div>';
        hydrate(state.dialog);
        var input = state.dialog.querySelector('.wss-input');
        if (input) input.addEventListener('focus', function () { input.select(); });
    }

    function ensureDialog() {
        if (state.dialog) return state.dialog;
        var d = document.createElement('dialog');
        d.className = 'wss-dialog';
        d.setAttribute('aria-labelledby', 'wss-title');
        d.addEventListener('click', function (e) {
            // Click en el fondo (fuera de la caja) cierra.
            if (e.target === d) { close(); return; }
            onClick(e);
        });
        d.addEventListener('close', function () {
            document.documentElement.classList.remove('wss-open');
            var trigger = state.opts && state.opts.trigger;
            if (trigger && document.contains(trigger)) { try { trigger.focus(); } catch (e) { /* noop */ } }
        });
        document.body.appendChild(d);
        state.dialog = d;
        return d;
    }

    function open(opts) {
        if (!opts || !opts.url) return;
        state.opts = opts;
        state.qrOpen = false;
        state.storyOpen = false;
        state.story = null;
        var d = ensureDialog();
        render();
        prepareStory();
        document.documentElement.classList.add('wss-open');
        if (typeof d.showModal === 'function') {
            if (!d.open) d.showModal();
        } else {
            d.setAttribute('open', '');
        }
        var first = d.querySelector('.wss-copy');
        if (first) setTimeout(function () { try { first.focus(); } catch (e) { /* noop */ } }, 20);
        if (opts.qr) toggleQr(true);
    }

    function close() {
        if (!state.dialog) return;
        if (typeof state.dialog.close === 'function' && state.dialog.open) state.dialog.close();
        else { state.dialog.removeAttribute('open'); document.documentElement.classList.remove('wss-open'); }
    }

    var api = { open: open, close: close, networkLinks: networkLinks, copy: copy, NETWORKS: NETWORKS };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WoShareSheet = api;
}(typeof self !== 'undefined' ? self : this));
