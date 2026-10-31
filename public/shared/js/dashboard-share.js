/* ============================================================================
   WE ÖTZI — Dashboard del artista · Compartir perfil y tarjeta QR
   ----------------------------------------------------------------------------
   Figma final (oct 2026): 801:562 "Compartir perfil - Enlace y redes sociales"
   y 801:561 "Compartir perfil - Generar tarjeta QR". Paneles laterales que se
   abren desde las acciones rápidas del rail. QR con qrcode-generator.js.

   QA / estados por URL:  ?panel=compartir · ?panel=qr  (+ &destino=galeria)
   ============================================================================ */
(function () {
    'use strict';

    var state = { artist: null, panel: null, dest: 'profile', qr: null };
    var els = {};
    // Canvas/SVG no leen custom properties: se resuelven los tokens del DS al
    // generar (los literales son solo respaldo si tokens.css no cargó).
    function tok(name, fallback) {
        try {
            var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return v || fallback;
        } catch (e) { return fallback; }
    }
    var INK = '#24211D', PAPER = '#FFFFFF', MUTED = '#5A5449';
    var MARK = { square: '#E42121', circle: '#F2B519', triangle: '#0055FF', text: '#001125' };
    function loadPalette() {
        INK = tok('--neutral-500', INK);
        PAPER = tok('--figma-white', PAPER);
        MUTED = tok('--neutral-400', MUTED);
        MARK = {
            square: tok('--bauhaus-square', MARK.square), circle: tok('--bauhaus-circle', MARK.circle),
            triangle: tok('--bauhaus-triangle', MARK.triangle), text: tok('--ink', MARK.text)
        };
    }

    function $(id) { return document.getElementById(id); }
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function icon(name) { return '<i data-wo-icon="' + esc(name) + '" aria-hidden="true"></i>'; }
    function hydrate(root) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
            try { window.WoIcons.hydrate(root); } catch (e) { /* íconos opcionales */ }
        }
    }
    function toast(msg, tone) {
        if (typeof window.WodToast === 'function') window.WodToast(msg, tone);
    }

    /* ------------------------------ datos ------------------------------ */
    function username() {
        var a = state.artist || window.artistData || {};
        return String(a.username || '').replace(/^@/, '').trim();
    }
    function displayName() {
        var a = state.artist || window.artistData || {};
        // Figma 801:562 / 801:561: "LAUUMARTH" (sin el sufijo .wo del usuario).
        return String(a.username || a.name || 'Tu perfil').replace(/^@/, '').replace(/\.wo$/i, '').toUpperCase();
    }
    function initials() {
        return displayName().replace(/[^A-Z0-9ÁÉÍÓÚÑÜ]/g, '').slice(0, 2) || 'Ö';
    }
    function base() {
        return window.location.origin + String(window.WEOTZI_BASE_PATH || '').replace(/\/$/, '');
    }
    // URL pública real (parámetro ?artist= de /artist/profile). La galería es el
    // bloque #block-gallery del mismo perfil (la ruta de galería aparte se elimina).
    function shareUrl(dest) {
        var u = username();
        if (!u) return '';
        var url = base() + '/artist/profile?artist=' + encodeURIComponent(u);
        return dest === 'gallery' ? url + '#block-gallery' : url;
    }
    function prettyUrl(url) { return String(url || '').replace(/^https?:\/\//, ''); }
    function shareText(dest) {
        return dest === 'gallery'
            ? 'Mirá mi galería de trabajos en We Ötzi'
            : 'Mirá mi perfil de artista en We Ötzi';
    }

    /* ------------------------------ copiar ------------------------------ */
    function copy(text) {
        if (!text) return Promise.reject(new Error('Sin enlace'));
        if (navigator.clipboard && window.isSecureContext) {
            // Sin foco o sin permiso la API rechaza: se reintenta con execCommand.
            return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
        }
        return legacyCopy(text);
    }
    function legacyCopy(text) {
        return new Promise(function (resolve, reject) {
            var input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', '');
            input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:-9999px';
            document.body.appendChild(input);
            input.select();
            try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); }
            catch (e) { reject(e); }
            finally { document.body.removeChild(input); }
        });
    }
    function copyWithFeedback(btn, okLabel) {
        var url = shareUrl(state.dest);
        return copy(url).then(function () {
            toast('Enlace copiado.');
            if (btn && okLabel) {
                var original = btn.getAttribute('data-label') || btn.textContent;
                btn.setAttribute('data-label', original);
                btn.classList.add('is-done');
                var label = btn.querySelector('span') || btn;
                label.textContent = okLabel;
                setTimeout(function () { label.textContent = original.trim(); btn.classList.remove('is-done'); }, 2000);
            }
        }).catch(function () { toast('No pudimos copiar el enlace. Copialo a mano.', 'error'); });
    }

    function nativeShare(withCard) {
        var url = shareUrl(state.dest);
        var data = { title: displayName() + ' · We Ötzi', text: shareText(state.dest), url: url };
        if (!navigator.share) {
            return copy(url).then(function () { toast('Tu navegador no comparte directo: copiamos el enlace.'); })
                .catch(function () { toast('No pudimos compartir el enlace.', 'error'); });
        }
        var withFile = withCard ? cardBlob().then(function (blob) {
            var file = new File([blob], fileName('png'), { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
            return data;
        }).catch(function () { return data; }) : Promise.resolve(data);
        return withFile.then(function (payload) { return navigator.share(payload); })
            .catch(function (e) { if (e && e.name !== 'AbortError') toast('No pudimos compartir.', 'error'); });
    }

    /* ------------------------------- QR ------------------------------- */
    function buildQr(url) {
        if (typeof window.qrcode !== 'function' || !url) return null;
        loadPalette();
        var qr = window.qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        return qr;
    }
    function drawQr(canvas, qr, size) {
        var n = qr.getModuleCount();
        var quiet = 2;
        var cell = Math.floor(size / (n + quiet * 2));
        var px = cell * (n + quiet * 2);
        canvas.width = px;
        canvas.height = px;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, px, px);
        ctx.fillStyle = INK;
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
            }
        }
    }
    function fileName(ext) {
        return 'tarjeta-qr-' + (username() || 'perfil').replace(/[^a-z0-9._-]/gi, '') + (state.dest === 'gallery' ? '-galeria' : '') + '.' + ext;
    }
    // Tarjeta completa (QR + marcas Bauhaus + WE ÖTZI + URL) como en el Figma.
    function cardCanvas() {
        var qr = buildQr(shareUrl(state.dest));
        if (!qr) throw new Error('No pudimos generar el QR.');
        var scale = 3;
        var W = 340 * scale, pad = 30 * scale, qrSize = 280 * scale;
        var H = pad + qrSize + 54 * scale + pad / 2;
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = INK; ctx.lineWidth = 2 * scale; ctx.strokeRect(scale, scale, W - 2 * scale, H - 2 * scale);
        var qrCanvas = document.createElement('canvas');
        drawQr(qrCanvas, qr, qrSize);
        ctx.drawImage(qrCanvas, (W - qrCanvas.width) / 2, pad, qrCanvas.width, qrCanvas.height);
        var y = pad + qrSize + 18 * scale, s = 11 * scale;
        ctx.font = 'bold ' + (12 * scale) + 'px "Archivo Black", Arial, sans-serif';
        var text = 'WE ÖTZI';
        var tw = ctx.measureText(text).width;
        var total = s * 3 + 8 * scale * 3 + tw;
        var x = (W - total) / 2;
        ctx.fillStyle = MARK.square; ctx.fillRect(x, y, s, s); x += s + 8 * scale;
        ctx.fillStyle = MARK.circle; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); ctx.fill(); x += s + 8 * scale;
        ctx.fillStyle = MARK.triangle; ctx.beginPath(); ctx.moveTo(x + s / 2, y); ctx.lineTo(x + s, y + s); ctx.lineTo(x, y + s); ctx.closePath(); ctx.fill(); x += s + 8 * scale;
        ctx.fillStyle = MARK.text; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + s / 2 + scale);
        ctx.font = (10 * scale) + 'px "JetBrains Mono", monospace';
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'center';
        ctx.fillText(prettyUrl(shareUrl(state.dest)), W / 2, y + s + 18 * scale);
        return canvas;
    }
    function cardBlob() {
        return new Promise(function (resolve, reject) {
            try { cardCanvas().toBlob(function (b) { b ? resolve(b) : reject(new Error('blob')); }, 'image/png'); }
            catch (e) { reject(e); }
        });
    }
    function download(href, name) {
        var a = document.createElement('a');
        a.href = href; a.download = name; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
    }
    function downloadPng() {
        try { download(cardCanvas().toDataURL('image/png'), fileName('png')); toast('Descargamos tu tarjeta QR.'); }
        catch (e) { toast(e.message || 'No pudimos generar la tarjeta.', 'error'); }
    }
    function downloadSvg() {
        var url = shareUrl(state.dest);
        var qr = buildQr(url);
        if (!qr) { toast('No pudimos generar el QR.', 'error'); return; }
        var n = qr.getModuleCount(), cell = 8, quiet = 2, size = (n + quiet * 2) * cell;
        var W = size + 60, H = size + 120, ox = 30, oy = 30;
        var cells = '';
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
            if (qr.isDark(r, c)) cells += '<rect x="' + (ox + (c + quiet) * cell) + '" y="' + (oy + (r + quiet) * cell) + '" width="' + cell + '" height="' + cell + '"/>';
        }
        var my = oy + size + 22, mx = W / 2 - 62;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
            '<rect width="' + W + '" height="' + H + '" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2"/>' +
            '<g fill="' + INK + '">' + cells + '</g>' +
            '<rect x="' + mx + '" y="' + my + '" width="11" height="11" fill="' + MARK.square + '"/>' +
            '<circle cx="' + (mx + 24.5) + '" cy="' + (my + 5.5) + '" r="5.5" fill="' + MARK.circle + '"/>' +
            '<path d="M' + (mx + 43.5) + ' ' + my + 'L' + (mx + 49) + ' ' + (my + 11) + 'H' + (mx + 38) + 'Z" fill="' + MARK.triangle + '"/>' +
            '<text x="' + (mx + 58) + '" y="' + (my + 10) + '" font-family="Archivo Black, Arial, sans-serif" font-size="13" fill="' + MARK.text + '">WE ÖTZI</text>' +
            '<text x="' + (W / 2) + '" y="' + (my + 40) + '" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="' + MUTED + '">' + esc(prettyUrl(url)) + '</text>' +
            '</svg>';
        var href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        download(href, fileName('svg'));
        setTimeout(function () { URL.revokeObjectURL(href); }, 1500);
        toast('Descargamos tu tarjeta QR en SVG.');
    }

    /* ------------------------------ render ------------------------------ */
    function tabsHtml() {
        return '<p class="wod-label">QUÉ QUERÉS COMPARTIR</p>' +
            '<div class="wod-seg wod-seg--2 wod-share-tabs" role="tablist">' +
                ['profile', 'gallery'].map(function (d) {
                    var on = state.dest === d;
                    return '<button type="button" role="tab" aria-selected="' + on + '" class="wod-seg-btn' + (on ? ' is-on' : '') + '" data-dest="' + d + '">' +
                        (d === 'profile' ? 'PERFIL' : 'GALERÍA') + '</button>';
                }).join('') +
            '</div>';
    }

    function shareBodyHtml() {
        var url = shareUrl(state.dest);
        var a = state.artist || window.artistData || {};
        var pic = a.profile_picture || '';
        return tabsHtml() +
            '<p class="wod-label wod-share-gap">VISTA PREVIA</p>' +
            '<div class="wod-share-card">' +
                '<div class="wod-share-card-band"><span class="wod-marks" aria-hidden="true"><i></i><i></i><i></i></span></div>' +
                '<div class="wod-share-card-body">' +
                    '<span class="wod-share-avatar">' + (pic ? '<img src="' + esc(pic) + '" alt="">' : esc(initials())) + '</span>' +
                    '<span class="wod-share-id"><strong>' + esc(displayName()) + '</strong>' +
                    '<small>' + esc(prettyUrl(url)) + ' · ' + (state.dest === 'gallery' ? 'Galería' : 'Perfil público') + '</small></span>' +
                '</div>' +
            '</div>' +
            '<label class="wod-label wod-share-gap" for="wod-share-url">ENLACE PÚBLICO</label>' +
            '<div class="wod-share-link"><input id="wod-share-url" class="wod-share-input" readonly value="' + esc(url) + '">' +
                '<button type="button" class="wod-share-copyic" data-copy-icon aria-label="Copiar enlace">' + icon('copy') + '</button></div>' +
            '<button type="button" class="wod-btn is-ghost is-block wod-share-copy" data-copy><span>COPIAR ENLACE</span></button>' +
            '<button type="button" class="wod-btn is-ink is-block wod-share-main" data-share>' + icon('share-2') + '<span>COMPARTIR</span></button>' +
            '<p class="wod-label wod-share-gap2">COMPARTIR EN</p>' +
            '<div class="wod-share-nets">' +
                '<a class="wod-net" data-net="whatsapp" href="#" target="_blank" rel="noopener">' + icon('message-circle') + '<span>WHATSAPP</span></a>' +
                '<button type="button" class="wod-net" data-net="instagram">' + icon('instagram') + '<span>INSTAGRAM</span></button>' +
                '<a class="wod-net" data-net="mail" href="#">' + icon('mail') + '<span>MAIL</span></a>' +
                '<button type="button" class="wod-net" data-net="qr">' + icon('grid') + '<span>CÓDIGO QR</span></button>' +
            '</div>';
    }

    function qrBodyHtml() {
        var url = shareUrl(state.dest);
        return tabsHtml() +
            '<div class="wod-qr-card">' +
                '<canvas class="wod-qr-canvas" width="280" height="280" role="img" aria-label="Código QR de ' + esc(prettyUrl(url)) + '"></canvas>' +
                '<p class="wod-qr-brand"><span class="wod-marks wod-marks--s" aria-hidden="true"><i></i><i></i><i></i></span>WE ÖTZI</p>' +
            '</div>' +
            '<p class="wod-qr-url">' + esc(url) + '</p>' +
            '<div class="wod-qr-dl">' +
                '<button type="button" class="wod-btn is-accent" data-png>↓ DESCARGAR PNG</button>' +
                '<button type="button" class="wod-btn is-ghost" data-svg>↓ DESCARGAR SVG</button>' +
            '</div>' +
            '<button type="button" class="wod-btn is-ghost is-block wod-qr-copy" data-copy>' + icon('copy') + '<span>COPIAR URL</span></button>' +
            '<button type="button" class="wod-btn is-ink is-block wod-qr-share" data-share>' + icon('share-2') + '<span>COMPARTIR</span></button>';
    }

    function ensureShell() {
        if (els.panel) return;
        els.scrim = document.createElement('div');
        els.scrim.className = 'wod-drawer-scrim';
        els.scrim.hidden = true;
        els.scrim.addEventListener('click', close);
        els.panel = document.createElement('aside');
        els.panel.className = 'wod-drawer';
        els.panel.setAttribute('role', 'dialog');
        els.panel.setAttribute('aria-modal', 'true');
        els.panel.setAttribute('tabindex', '-1');
        els.panel.hidden = true;
        document.body.appendChild(els.scrim);
        document.body.appendChild(els.panel);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.panel) close(); });
        window.addEventListener('resize', function () { if (state.panel) placeDrawer(); });
    }

    // El panel nace debajo de la topbar (Figma: y = 84 sobre el frame).
    function placeDrawer() {
        var bar = document.querySelector('weotzi-product-nav .wo-org-product-nav') || document.querySelector('weotzi-product-nav');
        var bottom = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
        document.documentElement.style.setProperty('--wod-drawer-top', Math.round(bottom) + 'px');
    }

    function render() {
        var isQr = state.panel === 'qr';
        els.panel.setAttribute('aria-label', isQr ? 'QR de perfil' : 'Compartir mi perfil');
        els.panel.innerHTML =
            '<header class="wod-drawer-head"><h2 class="wod-drawer-title">' + (isQr ? 'QR de perfil' : 'Compartir mi perfil') + '</h2>' +
            '<button type="button" class="wod-drawer-x" data-close aria-label="Cerrar">' + icon('x') + '</button></header>' +
            '<div class="wod-drawer-body">' + (isQr ? qrBodyHtml() : shareBodyHtml()) + '</div>';
        hydrate(els.panel);
        wire();
        if (isQr) paintQr();
    }

    function paintQr() {
        var canvas = els.panel.querySelector('.wod-qr-canvas');
        var qr = buildQr(shareUrl(state.dest));
        if (!canvas || !qr) {
            if (canvas) canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'wod-view-empty', textContent: 'Completá tu usuario para generar el QR.' }));
            return;
        }
        drawQr(canvas, qr, 560);
    }

    function wire() {
        var p = els.panel;
        p.querySelector('[data-close]').addEventListener('click', close);
        p.querySelectorAll('[data-dest]').forEach(function (b) {
            b.addEventListener('click', function () { state.dest = b.getAttribute('data-dest'); render(); });
        });
        var url = shareUrl(state.dest);
        p.querySelectorAll('[data-copy]').forEach(function (b) {
            b.addEventListener('click', function () { copyWithFeedback(b, state.panel === 'qr' ? 'URL COPIADA' : 'ENLACE COPIADO'); });
        });
        var copyIc = p.querySelector('[data-copy-icon]');
        if (copyIc) copyIc.addEventListener('click', function () { copyWithFeedback(null); });
        var input = p.querySelector('.wod-share-input');
        if (input) input.addEventListener('focus', function () { input.select(); });
        p.querySelectorAll('[data-share]').forEach(function (b) {
            b.addEventListener('click', function () { nativeShare(state.panel === 'qr'); });
        });
        var png = p.querySelector('[data-png]'); if (png) png.addEventListener('click', downloadPng);
        var svg = p.querySelector('[data-svg]'); if (svg) svg.addEventListener('click', downloadSvg);
        var wa = p.querySelector('[data-net="whatsapp"]');
        if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent(shareText(state.dest) + ': ' + url);
        var mail = p.querySelector('[data-net="mail"]');
        if (mail) mail.href = 'mailto:?subject=' + encodeURIComponent(displayName() + ' · We Ötzi') +
            '&body=' + encodeURIComponent(shareText(state.dest) + ':\n' + url);
        var ig = p.querySelector('[data-net="instagram"]');
        if (ig) ig.addEventListener('click', function () {
            // Instagram no acepta enlaces por URL: copiamos y abrimos la app/web.
            copy(url).then(function () {
                toast('Copiamos tu enlace: pegalo en tu bio o en una historia.');
            }).catch(function () { /* igual abrimos Instagram */ }).then(function () {
                window.open('https://www.instagram.com/', '_blank', 'noopener');
            });
        });
        var qrBtn = p.querySelector('[data-net="qr"]');
        if (qrBtn) qrBtn.addEventListener('click', function () { open('qr', state.dest); });
    }

    function open(panel, dest, trigger) {
        ensureShell();
        state.artist = window.artistData || state.artist;
        if (!username()) {
            toast('Completá tu usuario en el perfil para compartirlo.', 'error');
            return;
        }
        if (trigger) els.trigger = trigger;
        state.panel = panel === 'qr' ? 'qr' : 'share';
        state.dest = dest === 'gallery' ? 'gallery' : 'profile';
        placeDrawer();
        render();
        els.scrim.hidden = false;
        els.panel.hidden = false;
        document.body.classList.add('wod-drawer-open');
        // Foco en el diálogo (lectores de pantalla anuncian el título); Tab entra a los controles.
        setTimeout(function () { try { els.panel.focus(); } catch (e) { /* noop */ } }, 30);
    }

    function close() {
        if (!els.panel) return;
        state.panel = null;
        els.panel.hidden = true;
        els.scrim.hidden = true;
        document.body.classList.remove('wod-drawer-open');
        if (els.trigger && document.contains(els.trigger)) { try { els.trigger.focus(); } catch (e) { /* noop */ } }
        els.trigger = null;
    }

    window.WodShare = { open: open, close: close, url: shareUrl };
    // El botón oculto #qr-profile-btn (hook legacy de dashboard.js) abre el panel nuevo.
    window.openQRModal = function () { open('qr', 'profile'); };

    function wireButtons() {
        var share = $('wod-share-profile');
        if (share && !share._wod) { share._wod = true; share.addEventListener('click', function () { open('share', 'profile', share); }); }
        var qr = $('wod-qr-card');
        if (qr && !qr._wod) { qr._wod = true; qr.addEventListener('click', function () { open('qr', 'profile', qr); }); }
    }

    function applyUrlState() {
        var params = new URLSearchParams(window.location.search);
        var panel = params.get('panel');
        if (panel !== 'compartir' && panel !== 'qr') return;
        open(panel === 'qr' ? 'qr' : 'share', params.get('destino') === 'galeria' ? 'gallery' : 'profile');
    }

    var booted = false;
    function boot(detail) {
        if (booted) return;
        booted = true;
        state.artist = (detail && detail.artistData) || window.artistData || null;
        wireButtons();
        applyUrlState();
    }
    window.addEventListener('wo:dashboard-ready', function (ev) { boot(ev && ev.detail); });
    var tries = 0;
    var poll = setInterval(function () {
        if (booted) { clearInterval(poll); return; }
        if (window.artistData && window.artistData.username) { clearInterval(poll); boot({ artistData: window.artistData }); }
        else if (++tries > 80) clearInterval(poll);
    }, 250);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButtons);
    else wireButtons();
})();
