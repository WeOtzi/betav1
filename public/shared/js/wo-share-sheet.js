/* ============================================================================
   WE ÖTZI — Hoja "Compartir" (perfil público del artista)
   ----------------------------------------------------------------------------
   Diálogo nativo (<dialog>, foco atrapado y Escape) con todas las formas de
   compartir un enlace: copiar, menú nativo del teléfono (navigator.share),
   WhatsApp, Instagram / historias, Facebook, X, Telegram, LinkedIn, mail y
   código QR descargable. Lo usa el perfil público (dueño y visitantes).

   Uso:
     WoShareSheet.open({
       url, title, text,            // qué se comparte
       name,                        // nombre visible en la vista previa
       heading,                     // título del diálogo ("Compartir perfil")
       trigger,                     // botón que lo abrió (vuelve el foco)
       onShare(channel),            // telemetría / onboarding (opcional)
       extra: { label, href }       // enlace secundario (opcional)
     });

   Instagram no acepta enlaces por URL: en el teléfono se abre el menú nativo
   (ahí aparecen Instagram e Historias); en la compu se copia el enlace y se
   abre Instagram. window.open y navigator.share se llaman dentro del mismo
   click (Safari iOS bloquea los que llegan después de una promesa).
   ============================================================================ */
(function (root) {
    'use strict';

    var state = { opts: null, dialog: null, qrOpen: false };

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

    /** Enlaces de cada red (función pura, se testea en Node). */
    function networkLinks(url, text, title) {
        var u = encodeURIComponent(url || '');
        var t = encodeURIComponent(text || '');
        var msg = encodeURIComponent((text ? text + ': ' : '') + (url || ''));
        return {
            whatsapp: 'https://wa.me/?text=' + msg,
            facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
            x: 'https://twitter.com/intent/tweet?url=' + u + (text ? '&text=' + t : ''),
            telegram: 'https://t.me/share/url?url=' + u + (text ? '&text=' + t : ''),
            linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + u,
            mail: 'mailto:?subject=' + encodeURIComponent(title || 'We Ötzi') + '&body=' + encodeURIComponent((text ? text + ':\n' : '') + (url || ''))
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
    function downloadQr() {
        var canvas = state.dialog.querySelector('.wss-qr-canvas');
        if (!canvas) return;
        try {
            var a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = 'qr-' + fileSlug() + '.png';
            a.rel = 'noopener';
            document.body.appendChild(a); a.click(); a.remove();
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
            var ok = drawQr(panel.querySelector('.wss-qr-canvas'), state.opts.url, 480);
            panel.querySelector('[data-qr-fallback]').hidden = ok;
            panel.querySelector('[data-qr-download]').hidden = !ok;
            track('qr');
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

    function shareInstagram() {
        if (isTouch() && nativeShare()) { track('instagram'); return; }
        // Escritorio: se pide la copia y se abre Instagram en el mismo click.
        var pending = copy(state.opts.url);
        try { root.open('https://www.instagram.com/', '_blank', 'noopener'); } catch (e) { /* bloqueado */ }
        pending.then(function () {
            announce('Copiamos el enlace: pegalo en tu bio, en una historia o en un mensaje de Instagram.');
        }).catch(function () { announce('Copiá el enlace de arriba y pegalo en Instagram.'); });
        track('instagram');
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
            }).catch(function () { announce('No pudimos copiar. Seleccioná el enlace y copialo a mano.'); });
            return;
        }
        if (act === 'native') { nativeShare(); return; }
        if (act === 'qr-download') { downloadQr(); return; }
        if (net === 'instagram') { e.preventDefault(); shareInstagram(); return; }
        if (net === 'qr') { e.preventDefault(); toggleQr(); return; }
        if (net) track(net); // los <a> de redes navegan solos
    }

    /* ------------------------------ render ------------------------------ */
    function render() {
        var o = state.opts;
        var links = networkLinks(o.url, o.text, o.title);
        var nets = [
            ['whatsapp', 'WhatsApp', 'message-circle', links.whatsapp],
            ['instagram', 'Instagram', 'instagram', null],
            ['facebook', 'Facebook', 'facebook', links.facebook],
            ['x', 'X', 'twitter', links.x],
            ['telegram', 'Telegram', 'send', links.telegram],
            ['linkedin', 'LinkedIn', 'linkedin', links.linkedin],
            ['mail', 'Mail', 'mail', links.mail],
            ['qr', 'Código QR', 'grid', null]
        ];
        var netsHtml = nets.map(function (n) {
            var label = '<span>' + esc(n[1]) + '</span>';
            if (!n[3]) {
                var extra = n[0] === 'qr' ? ' aria-expanded="false" aria-controls="wss-qr"' : '';
                return '<li><button type="button" class="wss-net" data-net="' + n[0] + '"' + extra + '>' + icon(n[2]) + label + '</button></li>';
            }
            var target = n[0] === 'mail' ? '' : ' target="_blank" rel="noopener noreferrer"';
            var sr = n[0] === 'mail' ? '' : '<span class="wo-sr-only"> (se abre en otra pestaña)</span>';
            return '<li><a class="wss-net" data-net="' + n[0] + '" href="' + esc(n[3]) + '"' + target + '>' + icon(n[2]) + label + sr + '</a></li>';
        }).join('');
        var initials = String(o.name || 'WÖ').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase() || 'Ö';

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
        var d = ensureDialog();
        render();
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

    var api = { open: open, close: close, networkLinks: networkLinks, copy: copy };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WoShareSheet = api;
}(typeof self !== 'undefined' ? self : this));
