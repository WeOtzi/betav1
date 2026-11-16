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

    var state = { artist: null, panel: null, dest: 'profile', qr: null, cardBlob: null, cardBlobUrl: '', story: null };
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
    // URL pública: la corta (beta.weotzi.com/<handle>, artist-public-url.js) o,
    // si el handle no admite URL corta, /artist/profile?artist=. La galería es
    // el bloque #block-gallery del mismo perfil (la ruta aparte se eliminó).
    function shareUrl(dest) {
        var u = username();
        if (!u) return '';
        var hash = dest === 'gallery' ? 'block-gallery' : '';
        // Turnos (frente turnos): página pública /turnos con los turnos libres.
        // Va antes de la URL corta: si no, la pestaña TURNOS compartía el perfil.
        if (dest === 'turnos') return base() + '/turnos?artist=' + encodeURIComponent(u);
        if (window.WoArtistPublicUrl) return window.WoArtistPublicUrl.publicProfileUrl(u, base(), { hash: hash });
        var url = base() + '/artist/profile?artist=' + encodeURIComponent(u);
        return hash ? url + '#' + hash : url;
    }

    /* ------------------- onboarding: paso "Comparte tu perfil" ------------------- */
    // Auditoría PP-07: copiar marca 'compartir.enlace'; compartir por una red,
    // el menú nativo o descargar la tarjeta marca 'compartir'. Una vez por id.
    var acked = {};
    function appPath(p) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') {
            try { return window.WoDemo.appPath(p); } catch (e) { /* respaldo local */ }
        }
        return String(window.WEOTZI_BASE_PATH || '').replace(/\/$/, '') + p;
    }
    function accessToken() {
        var client = (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function' && window.ConfigManager.getSupabaseClient()) || window._supabase;
        if (!client || !client.auth || typeof client.auth.getSession !== 'function') return Promise.resolve(null);
        return Promise.resolve(client.auth.getSession()).then(function (r) {
            return (r && r.data && r.data.session && r.data.session.access_token) || null;
        }).catch(function () { return null; });
    }
    function ack(id) {
        if (acked[id]) return;
        acked[id] = true;
        var body = { assisted: { acknowledge: id } };
        var done = function () {
            try { document.dispatchEvent(new CustomEvent('wo:assist-refresh', { detail: { section: 'compartir' } })); } catch (e) { /* noop */ }
        };
        var fail = function () { acked[id] = false; };
        if (window.WoDemo && typeof window.WoDemo.api === 'function') {
            Promise.resolve().then(function () { return window.WoDemo.api('/api/artist/onboarding', { method: 'POST', body: body }); })
                .then(done, fail);
            return;
        }
        accessToken().then(function (token) {
            if (!token) throw new Error('Sin sesión');
            return fetch(appPath('/api/artist/onboarding'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify(body)
            });
        }).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); done(); }).catch(fail);
    }
    function isTouch() {
        try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
    }

    /* ------------- ronda 2: compartidos, historia y tarjeta OG ------------- */
    // Registra cada compartido del perfil (POST /api/artist/profile-share; el
    // servidor cuenta una vez por persona, canal y hora). Los que salen de este
    // panel van con la sesión del artista: quedan guardados para estadísticas
    // (is_owner) pero NO puntúan en Most Wanted, donde nadie suma a su propio
    // perfil. Nunca frena la UI.
    function trackShare(channel) {
        var u = username();
        if (!u || (window.WoDemo && window.WoDemo.enabled)) return;
        accessToken().then(function (token) {
            var headers = { 'Content-Type': 'application/json' };
            if (token) headers.Authorization = 'Bearer ' + token;
            return fetch(appPath('/api/artist/profile-share'), {
                method: 'POST', headers: headers, keepalive: true,
                body: JSON.stringify({ artist_username: u, channel: channel })
            });
        }).catch(function () { /* telemetría opcional */ });
    }

    // Compositor de tarjetas (wo-share-cards.js): se carga a demanda, una vez.
    var cardsLoading = null;
    function ensureCards() {
        if (window.WoShareCards) return Promise.resolve(window.WoShareCards);
        if (!cardsLoading) {
            cardsLoading = new Promise(function (resolve) {
                var s = document.createElement('script');
                s.src = appPath('/shared/js/wo-share-cards.js');
                s.async = true;
                s.onload = function () { resolve(window.WoShareCards || null); };
                s.onerror = function () { cardsLoading = null; resolve(null); };
                document.head.appendChild(s);
            });
        }
        return cardsLoading;
    }
    // Datos de la tarjeta: el artista del dashboard + su privacidad pública
    // (para no dibujar la ciudad si la tiene oculta).
    function cardInput(C) {
        var artist = state.artist || window.artistData || {};
        var url = shareUrl('profile');
        return Promise.resolve(typeof C.loadPrefs === 'function' ? C.loadPrefs(artist.user_id) : null)
            .catch(function () { return null; })
            .then(function (prefs) { return { artist: artist, prefs: prefs || {}, url: url }; });
    }

    // Historia vertical 1080×1920: se prepara al abrir el panel para poder
    // compartirla dentro del mismo click (Safari iOS exige el gesto).
    function prepareStory() {
        var url = shareUrl('profile');
        // El panel se vuelve a pintar al cambiar de pestaña: la imagen se reutiliza.
        if (state.story && state.story.url === url) return;
        var story = { url: url, blob: null, file: null, ready: false, promise: null };
        state.story = story;
        story.promise = ensureCards().then(function (C) {
            if (!C) return story;
            return cardInput(C).then(function (input) { return C.storyBlob(input); }).then(function (blob) {
                story.blob = blob;
                try { story.file = new File([blob], C.storyFileName(username()), { type: 'image/jpeg' }); } catch (e) { story.file = null; }
                story.ready = true;
                return story;
            });
        }).catch(function () { return story; });
    }
    function canShareStory(story) {
        if (!story || !story.ready || !story.file || !navigator.share || !navigator.canShare) return false;
        try { return navigator.canShare({ files: [story.file] }) === true; } catch (e) { return false; }
    }
    function downloadStory(story) {
        var href = URL.createObjectURL(story.blob);
        var name = window.WoShareCards ? window.WoShareCards.storyFileName(username()) : 'historia.jpg';
        download(href, name);
        setTimeout(function () { URL.revokeObjectURL(href); }, 2000);
    }
    function shareStory() {
        var story = state.story;
        var url = shareUrl('profile');
        ack('compartir');
        trackShare('story');
        // El enlace va al portapapeles en el mismo click: se pega en el sticker de enlace.
        var copied = copy(url);
        if (isTouch() && canShareStory(story)) {
            navigator.share({ files: [story.file], title: displayName() + ' · We Ötzi' })
                .then(function () { toast('Agrega el sticker de enlace en tu historia y pega tu enlace: ya está copiado.'); })
                .catch(function (e) { if (e && e.name !== 'AbortError') toast('No pudimos abrir el menú para compartir.', 'error'); });
            copied.catch(function () { /* el enlace sigue visible en el panel */ });
            return;
        }
        if (isTouch() && navigator.share && (!story || !story.ready)) {
            // La imagen todavía no está: se comparte el enlace por el menú del sistema.
            nativeShare(false);
            return;
        }
        var finish = function (done) {
            if (!done || !done.ready || !done.blob) {
                copied.then(function () { toast('No pudimos crear la imagen. Copiamos tu enlace: pégalo en tu historia.'); })
                    .catch(function () { toast('No pudimos crear la imagen. Copia tu enlace y pégalo en tu historia.', 'error'); });
                return;
            }
            downloadStory(done);
            copied.then(function () { toast('Descargamos la imagen y copiamos tu enlace: sube la imagen a tu historia y pega el enlace.'); })
                .catch(function () { toast('Descargamos la imagen: súbela a tu historia y pega tu enlace.'); });
        };
        if (story && story.ready) finish(story);
        else if (story && story.promise) { toast('Preparando tu historia…'); story.promise.then(finish); }
        else finish(null);
    }

    // Tarjeta Open Graph 1200×630: se regenera sola si cambió algo del perfil.
    // `auto`: chequeo al abrir el dashboard (espaciado); al compartir no espera.
    function syncOgCard(auto) {
        if (!username() || (window.WoDemo && window.WoDemo.enabled)) return;
        ensureCards().then(function (C) {
            if (!C || typeof C.syncOgCard !== 'function') return null;
            return cardInput(C).then(function (input) {
                input.auto = auto === true;
                return C.syncOgCard(input);
            });
        }).catch(function () { /* la vista previa usa la foto de perfil */ });
    }
    function prettyUrl(url) { return String(url || '').replace(/^https?:\/\//, ''); }
    function shareText(dest) {
        if (dest === 'turnos') return 'Elige uno de mis turnos disponibles y pídeme tu cotización en We Ötzi';
        return dest === 'gallery'
            ? 'Mira mi galería de trabajos en We Ötzi'
            : 'Mira mi perfil de artista en We Ötzi';
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
            ack('compartir.enlace');
            trackShare('copy');
            if (btn && okLabel) {
                var original = btn.getAttribute('data-label') || btn.textContent;
                btn.setAttribute('data-label', original);
                btn.classList.add('is-done');
                var label = btn.querySelector('span') || btn;
                label.textContent = okLabel;
                setTimeout(function () { label.textContent = original.trim(); btn.classList.remove('is-done'); }, 2000);
            }
        }).catch(function () { toast('No pudimos copiar el enlace. Cópialo a mano.', 'error'); });
    }

    function nativeShare(withCard) {
        var url = shareUrl(state.dest);
        var data = { title: displayName() + ' · We Ötzi', text: shareText(state.dest), url: url };
        if (!navigator.share) {
            return copy(url).then(function () { toast('Tu navegador no comparte directo: copiamos el enlace.'); })
                .catch(function () { toast('No pudimos compartir el enlace.', 'error'); });
        }
        // Auditoría PP-08: navigator.share se llama en el mismo click (Safari iOS
        // descarta el gesto si antes se espera una promesa). La tarjeta va solo
        // si ya está generada (paintQr la prepara al abrir el panel QR).
        if (withCard && state.cardBlob && state.cardBlobUrl === url) {
            try {
                var file = new File([state.cardBlob], fileName('png'), { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
            } catch (e) { /* sin archivo */ }
        }
        return navigator.share(data).then(function () { ack('compartir'); trackShare('native'); })
            .catch(function (e) { if (e && e.name !== 'AbortError') toast('No pudimos compartir.', 'error'); });
    }

    // Prepara la tarjeta en PNG apenas se pinta el QR, para compartirla sin esperas.
    function prepareCardBlob() {
        var url = shareUrl(state.dest);
        state.cardBlob = null;
        state.cardBlobUrl = url;
        cardBlob().then(function (blob) {
            if (state.cardBlobUrl === url) state.cardBlob = blob;
        }).catch(function () { /* se comparte sin archivo */ });
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
        return 'tarjeta-qr-' + (username() || 'perfil').replace(/[^a-z0-9._-]/gi, '') + (state.dest === 'gallery' ? '-galeria' : state.dest === 'turnos' ? '-turnos' : '') + '.' + ext;
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
        try { download(cardCanvas().toDataURL('image/png'), fileName('png')); toast('Descargamos tu tarjeta QR.'); ack('compartir'); trackShare('qr'); }
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
        ack('compartir');
        trackShare('qr');
    }

    /* ------------------------------ render ------------------------------ */
    function tabsHtml() {
        return '<p class="wod-label">QUÉ QUIERES COMPARTIR</p>' +
            '<div class="wod-seg wod-seg--3 wod-share-tabs" role="tablist">' +
                ['profile', 'gallery', 'turnos'].map(function (d) {
                    var on = state.dest === d;
                    return '<button type="button" role="tab" aria-selected="' + on + '" class="wod-seg-btn' + (on ? ' is-on' : '') + '" data-dest="' + d + '">' +
                        (d === 'profile' ? 'PERFIL' : d === 'gallery' ? 'GALERÍA' : 'TURNOS') + '</button>';
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
                    '<small>' + esc(prettyUrl(url)) + ' · ' + (state.dest === 'gallery' ? 'Galería' : state.dest === 'turnos' ? 'Turnos disponibles' : 'Perfil público') + '</small></span>' +
                '</div>' +
            '</div>' +
            '<label class="wod-label wod-share-gap" for="wod-share-url">ENLACE PÚBLICO</label>' +
            '<div class="wod-share-link"><input id="wod-share-url" class="wod-share-input" readonly value="' + esc(url) + '">' +
                '<button type="button" class="wod-share-copyic" data-copy-icon aria-label="Copiar enlace">' + icon('copy') + '</button></div>' +
            '<button type="button" class="wod-btn is-ghost is-block wod-share-copy" data-copy><span>COPIAR ENLACE</span></button>' +
            '<button type="button" class="wod-btn is-ink is-block wod-share-main" data-share>' + icon('share-2') + '<span>COMPARTIR</span></button>' +
            // Ronda 2 (nota N8): sin Mail, Telegram ni LinkedIn; Instagram arma
            // una historia vertical con tu foto, estilos, ciudad y enlace.
            '<p class="wod-label wod-share-gap2">COMPARTIR EN</p>' +
            '<div class="wod-share-nets">' +
                '<a class="wod-net" data-net="whatsapp" href="#" target="_blank" rel="noopener">' + icon('message-circle') + '<span>WHATSAPP</span></a>' +
                '<button type="button" class="wod-net" data-net="instagram" aria-label="Compartir en una historia de Instagram" title="Crea una historia con tu perfil">' + icon('instagram') + '<span>INSTAGRAM</span></button>' +
                netLink('facebook', 'facebook', 'FACEBOOK') +
                netLink('x', 'twitter', 'X') +
                '<button type="button" class="wod-net" data-net="qr" style="grid-column: 1 / -1;">' + icon('grid') + '<span>CÓDIGO QR</span></button>' +
            '</div>';
    }

    function netLink(net, ic, label) {
        return '<a class="wod-net" data-net="' + net + '" href="#" target="_blank" rel="noopener noreferrer">' + icon(ic) + '<span>' + label + '</span></a>';
    }

    // Enlaces de cada red para compartir el perfil.
    function networkUrls(url, text) {
        var u = encodeURIComponent(url);
        var t = encodeURIComponent(text);
        return {
            whatsapp: 'https://wa.me/?text=' + encodeURIComponent(text + ': ' + url),
            facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
            x: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t
        };
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
            if (canvas) canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'wod-view-empty', textContent: 'Completa tu usuario para generar el QR.' }));
            return;
        }
        drawQr(canvas, qr, 560);
        prepareCardBlob();
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
        var nets = networkUrls(url, shareText(state.dest));
        ['whatsapp', 'facebook', 'x'].forEach(function (net) {
            var a = p.querySelector('[data-net="' + net + '"]');
            if (!a) return;
            a.href = nets[net];
            a.addEventListener('click', function () { ack('compartir'); trackShare(net); });
        });
        // Instagram: historia con la imagen ya preparada (shareStory la comparte
        // o la descarga dentro del mismo click y copia el enlace).
        var ig = p.querySelector('[data-net="instagram"]');
        if (ig) {
            prepareStory();
            ig.addEventListener('click', shareStory);
        }
        var qrBtn = p.querySelector('[data-net="qr"]');
        if (qrBtn) qrBtn.addEventListener('click', function () { open('qr', state.dest); });
    }

    function open(panel, dest, trigger) {
        ensureShell();
        state.artist = window.artistData || state.artist;
        if (!username()) {
            toast('Completa tu usuario en el perfil para compartirlo.', 'error');
            return;
        }
        if (trigger) els.trigger = trigger;
        state.panel = panel === 'qr' ? 'qr' : 'share';
        state.dest = dest === 'gallery' || dest === 'turnos' ? dest : 'profile';
        placeDrawer();
        render();
        // Al compartir, la vista previa del enlace (og:image) tiene que estar al día.
        syncOgCard(false);
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
        open(panel === 'qr' ? 'qr' : 'share', params.get('destino') === 'galeria' ? 'gallery' : params.get('destino') === 'turnos' ? 'turnos' : 'profile');
    }

    var booted = false;
    function boot(detail) {
        if (booted) return;
        booted = true;
        state.artist = (detail && detail.artistData) || window.artistData || null;
        wireButtons();
        applyUrlState();
        // Tarjeta OG al día sin estorbar la carga del dashboard.
        setTimeout(function () { syncOgCard(true); }, 4000);
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
