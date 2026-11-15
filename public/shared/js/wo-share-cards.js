/* ============================================================================
   WE ÖTZI — Tarjetas para compartir el perfil del artista (ronda 2, frente perfil)
   ----------------------------------------------------------------------------
   Compone en el navegador, con <canvas> y sin dependencias:
     · la HISTORIA vertical 1080×1920 (Instagram y otras apps): foto o portada
       del artista, nombre, estilos, ciudad, enlace corto y marca We Ötzi;
     · la TARJETA Open Graph 1200×630 que se ve al pegar el enlace del perfil
       en WhatsApp, Instagram, Facebook o X.

   La tarjeta OG la sube el propio artista (con su sesión) al bucket público
   profile-pictures, dentro de su carpeta, y la ruta queda en
   public.artist_share_cards; lib/routes/perfil.js la usa como og:image.
   Se vuelve a generar cuando cambian sus datos: al guardar el perfil en el
   centro de la cuenta (evento wo:assist-refresh), al abrir el dashboard, al
   ver su propio perfil y al compartir.

   API (window.WoShareCards):
     cardData({ artist, prefs, url, name })   datos ya saneados de la tarjeta
     renderStory(input) / renderOg(input)     Promise<HTMLCanvasElement>
     storyBlob(input) / ogBlob(input)         Promise<Blob> (JPEG)
     syncOgCard({ artist, prefs, url, force }) Promise<{ uploaded, reason }>
     loadPrefs(userId)                        privacidad pública del artista
     storyFileName(handle)                    nombre del archivo a descargar
   Las funciones de layout (coverRect, wrapLines, fitText, signature…) son
   puras y se testean en Node (tests/r2-perfil.test.js).
   ============================================================================ */
(function (root) {
    'use strict';

    var STORY = Object.freeze({ width: 1080, height: 1920 });
    var OG = Object.freeze({ width: 1200, height: 630 });
    // Cambiar el diseño de la tarjeta sube esta versión y fuerza a regenerarla.
    var LAYOUT_VERSION = 'r2a';
    var BUCKET = 'profile-pictures';
    var IMAGE_TIMEOUT_MS = 7000;
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Respaldo de los tokens del DS (canvas no lee custom properties).
    var COLORS = {
        ink: '#001125', paper: '#FAF8F3', white: '#FCFCFC', muted: '#5A5449',
        red: '#E42121', yellow: '#F2B519', blue: '#0055FF'
    };
    var FONTS = {
        display: '"Archivo Black", "Arial Black", Impact, sans-serif',
        mono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
        body: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
    };

    /* ============================ funciones puras ============================ */

    // Caracteres de control e invisibles (C0, DEL, ancho cero, separadores de
    // línea y BOM). Se arma por código para no dejar invisibles en el fuente.
    var INVISIBLE_RE = (function () {
        var c = String.fromCharCode;
        return new RegExp('[' + c(0) + '-' + c(31) + c(127) + c(0x200b) + '-' + c(0x200f) + c(0x2028) + '-' + c(0x202f) + c(0xfeff) + ']+', 'g');
    }());

    function clean(value, max) {
        var text = String(value == null ? '' : value)
            .replace(INVISIBLE_RE, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return max && text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
    }

    function parseList(value) {
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string' || !value.trim()) return [];
        try {
            var parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [value];
        } catch (e) {
            return [value];
        }
    }

    function httpUrl(value) {
        var raw = String(value == null ? '' : value).trim();
        return /^https?:\/\/[^\s"'<>]+$/i.test(raw) ? raw : '';
    }

    function isVideoUrl(url) {
        return /\.(mp4|mov|webm|m4v)$/i.test(String(url || '').split('?')[0]);
    }

    // Sin protocolo ni ancla. La query se conserva: el alias largo del perfil
    // (/artist/profile?artist=…) no sirve sin ella.
    function prettyUrl(url) {
        return String(url || '').replace(/^https?:\/\//i, '').replace(/#.*$/, '').replace(/\/+$/, '');
    }

    function handleOf(username) {
        return String(username == null ? '' : username).trim().replace(/^@+/, '').replace(/\.wo$/i, '');
    }

    function initialsOf(name, handle) {
        var words = clean(name).split(' ').filter(Boolean);
        var letters = words.length
            ? words.slice(0, 2).map(function (w) { return Array.from(w)[0]; }).join('')
            : Array.from(String(handle || '')).slice(0, 2).join('');
        return (letters || 'WÖ').toUpperCase();
    }

    /**
     * Foto de la tarjeta: retrato → portada → primer trabajo que sea imagen.
     * Los trabajos salen de gallery_images (ya filtrada en la base por la
     * validación de Instagram), nunca del feed crudo: así la tarjeta no muestra
     * una foto que el perfil público todavía oculta.
     */
    function pickPhoto(artist, prefs) {
        var profile = (prefs && prefs.profile) || {};
        var direct = httpUrl(artist && artist.profile_picture) || httpUrl(profile.banner_url);
        if (direct && !isVideoUrl(direct)) return direct;
        var list = parseList(artist && artist.gallery_images);
        for (var i = 0; i < list.length; i++) {
            var entry = list[i];
            if (entry && typeof entry === 'object' && entry.kind === 'video') continue;
            var url = httpUrl(typeof entry === 'string' ? entry : entry && entry.url);
            if (url && !isVideoUrl(url)) return url;
        }
        return '';
    }

    /**
     * Datos de la tarjeta, ya saneados. La ciudad solo entra si el artista la
     * muestra en su perfil (privacidad show_city).
     */
    function cardData(input) {
        var o = input || {};
        var artist = o.artist || {};
        var prefs = o.prefs || {};
        var privacy = prefs.privacy || {};
        var profile = prefs.profile || {};
        var handle = clean(handleOf(artist.username), 40);
        var name = clean(o.name || artist.name || profile.full_name || handle || 'Artista', 60);
        var styles = parseList(artist.styles_array)
            .map(function (s) { return clean(s, 28); })
            .filter(Boolean)
            .slice(0, 3);
        var showCity = privacy.show_city !== false;
        var city = showCity ? clean(artist.city, 40) : '';
        var url = httpUrl(o.url);
        return {
            name: name,
            handle: handle,
            styles: styles,
            city: city,
            url: url,
            link: prettyUrl(url),
            photo: pickPhoto(artist, prefs),
            initials: initialsOf(name, handle)
        };
    }

    /** Recorte tipo object-fit: cover (con el foco un poco arriba: caras). */
    function coverRect(sw, sh, dw, dh, focusY) {
        if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
        var scale = Math.max(dw / sw, dh / sh);
        var w = Math.min(sw, dw / scale);
        var h = Math.min(sh, dh / scale);
        var fy = typeof focusY === 'number' ? Math.min(Math.max(focusY, 0), 1) : 0.35;
        return { sx: (sw - w) / 2, sy: (sh - h) * fy, sw: w, sh: h };
    }

    /**
     * Parte `text` en hasta `maxLines` líneas que entren en `maxWidth` según
     * `measure(texto) -> ancho`. La última línea se corta con "…".
     */
    function wrapLines(measure, text, maxWidth, maxLines) {
        var words = clean(text).split(' ').filter(Boolean);
        var limit = Math.max(1, maxLines || 1);
        var lines = [];
        var line = '';
        for (var i = 0; i < words.length; i++) {
            var probe = line ? line + ' ' + words[i] : words[i];
            if (!line || measure(probe) <= maxWidth) line = probe;
            else { lines.push(line); line = words[i]; }
        }
        if (line) lines.push(line);
        if (lines.length <= limit) return lines;
        var kept = lines.slice(0, limit);
        var last = kept[limit - 1] + ' ' + lines.slice(limit).join(' ');
        while (last.length > 1 && measure(last + '…') > maxWidth) last = last.slice(0, -1).trim();
        kept[limit - 1] = last + '…';
        return kept;
    }

    /** Corta una sola línea con "…" si no entra. */
    function ellipsize(measure, text, maxWidth) {
        var value = clean(text);
        if (measure(value) <= maxWidth) return value;
        while (value.length > 1 && measure(value + '…') > maxWidth) value = value.slice(0, -1).trim();
        return value + '…';
    }

    /**
     * Mayor tamaño de fuente (entre max y min) con el que el texto entra en
     * `maxLines` líneas sin cortar palabras. measureAt(size, texto) -> ancho.
     */
    function fitText(measureAt, text, opts) {
        var o = opts || {};
        var step = o.step || 4;
        var value = clean(text);
        for (var size = o.max; size >= o.min; size -= step) {
            var measure = (function (s) { return function (t) { return measureAt(s, t); }; }(size));
            var lines = wrapLines(measure, value, o.maxWidth, 99);
            var fits = lines.length <= o.maxLines && lines.every(function (l) { return measure(l) <= o.maxWidth; });
            if (fits) return { size: size, lines: lines };
        }
        var atMin = function (t) { return measureAt(o.min, t); };
        return {
            size: o.min,
            lines: wrapLines(atMin, value, o.maxWidth, o.maxLines).map(function (l) { return ellipsize(atMin, l, o.maxWidth); })
        };
    }

    /** FNV-1a de 32 bits en hexadecimal (firma corta, no criptográfica). */
    function hash(text) {
        var h = 0x811c9dc5;
        var value = String(text);
        for (var i = 0; i < value.length; i++) {
            h ^= value.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    /** Cambia cuando cambia algo de lo que se dibuja: decide si hay que regenerar. */
    function signature(data) {
        var d = data || {};
        return LAYOUT_VERSION + '-' + hash([d.name, d.handle, (d.styles || []).join('|'), d.city, d.photo, d.link].join('\n'));
    }

    /** Ruta de la tarjeta OG dentro del bucket: <user_id>/og-card-<ms>.jpg */
    function ogObjectPath(userId, stamp) {
        var id = String(userId || '').trim().toLowerCase();
        if (!UUID_RE.test(id)) return '';
        var ms = Math.floor(Number(stamp));
        if (!(ms > 1000000000000 && ms < 100000000000000)) return '';
        return id + '/og-card-' + ms + '.jpg';
    }

    function fileSlug(value) {
        return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil';
    }
    function storyFileName(handle) { return 'historia-' + fileSlug(handleOf(handle)) + '.jpg'; }

    function eyebrowText(data) {
        return data.city ? 'TATUADOR · ' + data.city.toUpperCase() : 'TATUADOR';
    }

    /* ================================ canvas ================================= */

    function palette() {
        var out = {};
        var map = { ink: '--ink', paper: '--neutral-100', white: '--white', muted: '--neutral-400', red: '--bauhaus-square', yellow: '--bauhaus-circle', blue: '--bauhaus-triangle' };
        var style = null;
        try { style = root.getComputedStyle(root.document.documentElement); } catch (e) { style = null; }
        Object.keys(COLORS).forEach(function (key) {
            var v = '';
            try { v = style ? style.getPropertyValue(map[key]).trim() : ''; } catch (e) { v = ''; }
            out[key] = /^#[0-9a-f]{3,8}$/i.test(v) ? v : COLORS[key];
        });
        return out;
    }

    function ensureFonts() {
        var fonts = root.document && root.document.fonts;
        if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
        var wanted = ['400 64px "Archivo Black"', '700 32px "JetBrains Mono"', '500 32px "JetBrains Mono"', '700 32px Inter'];
        var loading = Promise.all(wanted.map(function (f) { return fonts.load(f).catch(function () { return null; }); }));
        var timeout = new Promise(function (resolve) { setTimeout(resolve, 2500); });
        return Promise.race([loading, timeout]).catch(function () { return null; });
    }

    /** Carga la foto con CORS (para poder exportar el canvas). null si falla. */
    function loadImage(url) {
        return new Promise(function (resolve) {
            if (!url || typeof root.Image !== 'function') { resolve(null); return; }
            var img = new root.Image();
            var done = false;
            var finish = function (value) { if (!done) { done = true; resolve(value); } };
            var timer = setTimeout(function () { finish(null); }, IMAGE_TIMEOUT_MS);
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.onload = function () { clearTimeout(timer); finish(img.naturalWidth > 0 ? img : null); };
            img.onerror = function () { clearTimeout(timer); finish(null); };
            // Parámetro propio: no reutiliza la copia en caché pedida sin CORS por la página.
            img.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'wo_card=1';
        });
    }

    function font(weight, size, family) { return weight + ' ' + size + 'px ' + family; }
    function setSpacing(ctx, px) { try { ctx.letterSpacing = px + 'px'; } catch (e) { /* navegador sin letterSpacing */ } }

    function measurer(ctx, weight, family) {
        return function (size, text) {
            ctx.font = font(weight, size, family);
            return ctx.measureText(text).width;
        };
    }

    function drawMarks(ctx, c, x, y, s, gap) {
        ctx.fillStyle = c.red; ctx.fillRect(x, y, s, s); x += s + gap;
        ctx.fillStyle = c.yellow; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); ctx.fill(); x += s + gap;
        ctx.fillStyle = c.blue; ctx.beginPath(); ctx.moveTo(x + s / 2, y); ctx.lineTo(x + s, y + s); ctx.lineTo(x, y + s); ctx.closePath(); ctx.fill();
        return x + s + gap;
    }

    function drawBrand(ctx, c, x, y, s, color) {
        var after = drawMarks(ctx, c, x, y, s, Math.round(s * 0.5));
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = font('400', Math.round(s * 1.25), FONTS.display);
        setSpacing(ctx, 1);
        ctx.fillText('WE ÖTZI', after + Math.round(s * 0.2), y + s / 2 + 1);
        setSpacing(ctx, 0);
        return after + Math.round(s * 0.2) + ctx.measureText('WE ÖTZI').width;
    }

    function drawPhotoBlock(ctx, c, data, img, x, y, w, h) {
        if (img) {
            var r = coverRect(img.naturalWidth || img.width, img.naturalHeight || img.height, w, h);
            ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, x, y, w, h);
            return;
        }
        // Sin foto: bloque tinta con las iniciales y formas Bauhaus.
        ctx.fillStyle = c.ink;
        ctx.fillRect(x, y, w, h);
        var unit = Math.min(w, h);
        ctx.fillStyle = c.red;
        ctx.fillRect(x + w - unit * 0.34, y, unit * 0.34, unit * 0.34);
        ctx.fillStyle = c.blue;
        ctx.beginPath();
        ctx.moveTo(x, y + h); ctx.lineTo(x + unit * 0.42, y + h); ctx.lineTo(x, y + h - unit * 0.42);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = c.white;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = font('400', Math.round(unit * 0.36), FONTS.display);
        ctx.fillText(data.initials, x + w / 2, y + h / 2);
        ctx.textAlign = 'left';
    }

    function drawStory(ctx, c, data, img) {
        var W = STORY.width, H = STORY.height;
        var photoH = 1000, pad = 72, maxW = W - pad * 2;
        ctx.fillStyle = c.paper;
        ctx.fillRect(0, 0, W, H);
        drawPhotoBlock(ctx, c, data, img, 0, 0, W, photoH);
        ctx.fillStyle = c.ink;
        ctx.fillRect(0, photoH, W, 8);

        // Marca: debajo de la franja que tapa la interfaz de Instagram (≈ 250 px).
        ctx.font = font('400', 40, FONTS.display);
        var pillW = 40 + (32 + 16) * 3 + 6 + ctx.measureText('WE ÖTZI').width + 44;
        ctx.fillStyle = c.paper;
        ctx.fillRect(pad, 270, pillW, 88);
        ctx.strokeStyle = c.ink; ctx.lineWidth = 4;
        ctx.strokeRect(pad + 2, 272, pillW - 4, 84);
        drawBrand(ctx, c, pad + 28, 298, 32, c.ink);

        // Círculo amarillo a caballo del borde de la foto.
        ctx.fillStyle = c.yellow;
        ctx.beginPath(); ctx.arc(W - 150, photoH + 4, 96, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = c.ink; ctx.lineWidth = 6; ctx.stroke();

        var y = photoH + 96;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = c.red;
        ctx.fillRect(pad, y - 14, 44, 4);
        ctx.font = font('700', 30, FONTS.mono);
        setSpacing(ctx, 4);
        ctx.fillText(ellipsize(function (t) { return ctx.measureText(t).width; }, eyebrowText(data), maxW - 320), pad + 62, y);
        setSpacing(ctx, 0);

        var name = fitText(measurer(ctx, '400', FONTS.display), data.name.toUpperCase(), { max: 124, min: 64, step: 4, maxWidth: maxW, maxLines: 2 });
        ctx.fillStyle = c.ink;
        ctx.font = font('400', name.size, FONTS.display);
        y += 34;
        name.lines.forEach(function (line) {
            y += Math.round(name.size * 0.96);
            ctx.fillText(line, pad, y);
        });

        if (data.styles.length) {
            y += 62;
            ctx.fillStyle = c.muted;
            ctx.font = font('500', 32, FONTS.mono);
            setSpacing(ctx, 2);
            ctx.fillText(ellipsize(function (t) { return ctx.measureText(t).width; }, data.styles.join(' · ').toUpperCase(), maxW), pad, y);
            setSpacing(ctx, 0);
        }

        // Enlace corto: caja tinta, siempre por encima de la barra inferior de Instagram.
        var boxY = Math.max(y + 46, 1470), boxH = 112;
        ctx.fillStyle = c.ink;
        ctx.fillRect(pad, boxY, maxW, boxH);
        ctx.fillStyle = c.yellow;
        ctx.fillRect(pad, boxY, 14, boxH);
        if (data.link) {
            var link = fitText(measurer(ctx, '700', FONTS.mono), data.link, { max: 42, min: 24, step: 2, maxWidth: maxW - 84, maxLines: 1 });
            ctx.fillStyle = c.white;
            ctx.textBaseline = 'middle';
            ctx.font = font('700', link.size, FONTS.mono);
            ctx.fillText(link.lines[0] || '', pad + 46, boxY + boxH / 2 + 2);
            ctx.textBaseline = 'alphabetic';
        }

        // Cierre decorativo (queda detrás de la barra de respuesta de la historia).
        ctx.fillStyle = c.blue;
        ctx.beginPath(); ctx.moveTo(pad, H - 96); ctx.lineTo(pad + 96, H - 96); ctx.lineTo(pad, H - 192); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c.red;
        ctx.fillRect(W - pad - 96, H - 192, 96, 96);
    }

    function drawOg(ctx, c, data, img) {
        var W = OG.width, H = OG.height;
        var split = 690, pad = 64, maxW = split - pad * 2;
        ctx.fillStyle = c.paper;
        ctx.fillRect(0, 0, W, H);
        drawPhotoBlock(ctx, c, data, img, split, 0, W - split, H);
        ctx.fillStyle = c.ink;
        ctx.fillRect(split - 6, 0, 6, H);

        drawBrand(ctx, c, pad, 60, 22, c.ink);

        var y = 178;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = c.red;
        ctx.fillRect(pad, y - 9, 30, 3);
        ctx.font = font('700', 20, FONTS.mono);
        setSpacing(ctx, 3);
        ctx.fillText(ellipsize(function (t) { return ctx.measureText(t).width; }, eyebrowText(data), maxW - 44), pad + 44, y);
        setSpacing(ctx, 0);

        var name = fitText(measurer(ctx, '400', FONTS.display), data.name.toUpperCase(), { max: 88, min: 44, step: 4, maxWidth: maxW, maxLines: 2 });
        ctx.fillStyle = c.ink;
        ctx.font = font('400', name.size, FONTS.display);
        y += 18;
        name.lines.forEach(function (line) {
            y += Math.round(name.size * 0.98);
            ctx.fillText(line, pad, y);
        });

        if (data.styles.length) {
            y += 46;
            ctx.fillStyle = c.muted;
            ctx.font = font('500', 21, FONTS.mono);
            setSpacing(ctx, 1.5);
            ctx.fillText(ellipsize(function (t) { return ctx.measureText(t).width; }, data.styles.join(' · ').toUpperCase(), maxW), pad, y);
            setSpacing(ctx, 0);
        }

        // Llamado a cotizar + enlace corto, anclados abajo.
        var label = 'Pide tu cotización';
        ctx.font = font('700', 24, FONTS.body);
        var pillW = ctx.measureText(label).width + 76;
        var pillY = H - 148;
        ctx.fillStyle = c.ink;
        ctx.fillRect(pad + 6, pillY + 6, pillW, 58);
        ctx.fillStyle = c.yellow;
        ctx.fillRect(pad, pillY, pillW, 58);
        ctx.strokeStyle = c.ink; ctx.lineWidth = 3;
        ctx.strokeRect(pad + 1.5, pillY + 1.5, pillW - 3, 55);
        ctx.fillStyle = c.ink;
        ctx.textBaseline = 'middle';
        ctx.fillText(label + ' →', pad + 24, pillY + 30);
        ctx.textBaseline = 'alphabetic';
        if (data.link) {
            ctx.fillStyle = c.muted;
            ctx.font = font('500', 20, FONTS.mono);
            ctx.fillText(ellipsize(function (t) { return ctx.measureText(t).width; }, data.link, maxW), pad, H - 46);
        }

        ctx.fillStyle = c.yellow;
        ctx.beginPath(); ctx.arc(split - 3, H - 92, 54, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = c.ink; ctx.lineWidth = 5; ctx.stroke();
    }

    function render(size, draw, input) {
        var doc = root.document;
        if (!doc || typeof doc.createElement !== 'function') return Promise.reject(new Error('Sin canvas'));
        var data = input && input.name !== undefined && input.styles ? input : cardData(input);
        return Promise.all([loadImage(data.photo), ensureFonts()]).then(function (res) {
            var paint = function (img) {
                var canvas = doc.createElement('canvas');
                canvas.width = size.width;
                canvas.height = size.height;
                var ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Sin canvas');
                draw(ctx, palette(), data, img);
                return canvas;
            };
            var canvas = paint(res[0]);
            // Foto sin permiso CORS: el canvas queda "contaminado" y no se puede
            // exportar. Se detecta y se vuelve a pintar sin la foto.
            if (res[0]) {
                try { canvas.getContext('2d').getImageData(0, 0, 1, 1); }
                catch (e) { canvas = paint(null); }
            }
            return canvas;
        });
    }

    function renderStory(input) { return render(STORY, drawStory, input); }
    function renderOg(input) { return render(OG, drawOg, input); }

    function toBlob(canvas, type, quality) {
        return new Promise(function (resolve, reject) {
            try {
                canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('No se pudo exportar la imagen')); }, type || 'image/jpeg', quality || 0.9);
            } catch (e) { reject(e); }
        });
    }

    function storyBlob(input) { return renderStory(input).then(function (canvas) { return toBlob(canvas, 'image/jpeg', 0.92); }); }
    function ogBlob(input) { return renderOg(input).then(function (canvas) { return toBlob(canvas, 'image/jpeg', 0.88); }); }

    /* ====================== tarjeta OG: subir y registrar ===================== */

    var REPO_SRC = '/shared/js/data/profile-public-repo.js';
    var PUBLIC_URL_SRC = '/shared/js/artist-public-url.js';
    // Entre dos subidas automáticas de la misma tarjeta (no aplica a `force`).
    var RESYNC_MIN_MS = 10 * 60 * 1000;
    var scriptLoading = Object.create(null);
    var syncing = Object.create(null);
    var lastSync = Object.create(null);

    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        try { return /^\/beta(\/|$)/.test(root.location.pathname || '') ? '/beta' : ''; } catch (e) { return ''; }
    }

    // Carga a demanda un script propio (una vez). Resuelve lo que devuelva `probe`.
    function ensureScript(src, probe) {
        if (probe()) return Promise.resolve(probe());
        if (!root.document || typeof root.document.createElement !== 'function') return Promise.resolve(null);
        if (!scriptLoading[src]) {
            scriptLoading[src] = new Promise(function (resolve) {
                var s = root.document.createElement('script');
                s.src = basePath() + src;
                s.async = true;
                s.onload = function () { resolve(probe()); };
                s.onerror = function () { delete scriptLoading[src]; resolve(null); };
                root.document.head.appendChild(s);
            });
        }
        return scriptLoading[src];
    }

    function repo() {
        var P = root.WeotziData && root.WeotziData.ProfilePublic;
        return P && typeof P.saveShareCard === 'function' && typeof P.getShareCard === 'function' ? P : null;
    }

    // El repo del perfil no está en todas las páginas del artista: se carga a demanda.
    function ensureRepo() {
        if (!root.WeotziData) return Promise.resolve(null);
        return ensureScript(REPO_SRC, repo);
    }

    // Misma regla de URL corta en todas las páginas: si no, la tarjeta cambiaría
    // de enlace (y se volvería a subir) según desde dónde se genere.
    function ensurePublicUrl() {
        return ensureScript(PUBLIC_URL_SRC, function () { return root.WoArtistPublicUrl || null; });
    }

    /** Preferencias públicas del artista (privacidad de la ciudad, portada). {} si fallan. */
    var prefsCache = Object.create(null);
    function loadPrefs(userId) {
        var id = String(userId || '').toLowerCase();
        if (!UUID_RE.test(id)) return Promise.resolve({});
        if (!prefsCache[id]) {
            prefsCache[id] = ensureRepo().then(function (P) {
                return P && typeof P.getPreferences === 'function' ? P.getPreferences(id) : null;
            }).then(function (prefs) {
                return prefs && typeof prefs === 'object' ? prefs : {};
            }).catch(function () { return {}; });
        }
        return prefsCache[id];
    }

    function remember(key, value) {
        try {
            if (value === undefined) return root.localStorage.getItem(key);
            root.localStorage.setItem(key, value);
        } catch (e) { /* storage bloqueado */ }
        return null;
    }

    function sessionUserId() {
        var client = (root.ConfigManager && typeof root.ConfigManager.getSupabaseClient === 'function' && root.ConfigManager.getSupabaseClient()) || root._supabase;
        if (!client || !client.auth || typeof client.auth.getSession !== 'function') return Promise.resolve(null);
        return Promise.resolve(client.auth.getSession()).then(function (r) {
            return (r && r.data && r.data.session && r.data.session.user && r.data.session.user.id) || null;
        }).catch(function () { return null; });
    }

    /**
     * Genera y sube la tarjeta OG del artista con sesión, solo si cambió algo
     * de lo que muestra. Nunca lanza: devuelve { uploaded, reason }.
     */
    function syncOgCard(opts) {
        var o = opts || {};
        var artist = o.artist || {};
        var userId = String(artist.user_id || '').toLowerCase();
        if (!UUID_RE.test(userId)) return Promise.resolve({ uploaded: false, reason: 'sin-artista' });
        if (root.WoDemo && root.WoDemo.enabled) return Promise.resolve({ uploaded: false, reason: 'demo' });
        if (syncing[userId]) return syncing[userId];

        var data = cardData(o);
        if (!data.handle || !data.url) return Promise.resolve({ uploaded: false, reason: 'sin-enlace' });
        var sig = signature(data);
        var memoKey = 'wo_og_card_' + userId;
        if (!o.force && (lastSync[userId] === sig || remember(memoKey) === sig)) {
            return Promise.resolve({ uploaded: false, reason: 'al-dia' });
        }

        var run = sessionUserId().then(function (sessionId) {
            // Solo el dueño: la política de Storage y la RLS lo exigen igual.
            if (!sessionId || String(sessionId).toLowerCase() !== userId) return { uploaded: false, reason: 'sin-sesion' };
            return ensureRepo().then(function (P) {
                if (!P) return { uploaded: false, reason: 'sin-repo' };
                return P.getShareCard(userId).then(function (row) {
                    if (!o.force && row && row.signature === sig) {
                        lastSync[userId] = sig; remember(memoKey, sig);
                        return { uploaded: false, reason: 'al-dia' };
                    }
                    // Chequeos automáticos (abrir el dashboard o el perfil): como
                    // mucho una subida cada 10 minutos. Guardar y compartir no esperan.
                    var stampKey = memoKey + '_at';
                    if (o.auto && !o.force && row && Date.now() - Number(remember(stampKey) || 0) < RESYNC_MIN_MS) {
                        return { uploaded: false, reason: 'reciente' };
                    }
                    remember(stampKey, String(Date.now()));
                    return ogBlob(data).then(function (blob) {
                        var path = ogObjectPath(userId, Date.now());
                        return P.saveShareCard(userId, blob, {
                            path: path, bucket: BUCKET, signature: sig,
                            width: OG.width, height: OG.height,
                            previousPath: row && row.og_path
                        });
                    }).then(function (saved) {
                        if (!saved) return { uploaded: false, reason: 'no-guardada' };
                        lastSync[userId] = sig; remember(memoKey, sig);
                        return { uploaded: true, reason: 'ok', path: saved.og_path };
                    });
                });
            });
        }).catch(function (err) {
            try { root.console && root.console.warn('[WoShareCards] tarjeta OG sin actualizar:', err && err.message); } catch (e) { /* sin consola */ }
            return { uploaded: false, reason: 'error' };
        }).then(function (result) {
            delete syncing[userId];
            return result;
        });
        syncing[userId] = run;
        return run;
    }

    /**
     * Centro de la cuenta: al guardar "Mi perfil" se regenera la tarjeta con los
     * datos nuevos del artista (se leen por la capa de datos, con su sesión).
     */
    function syncForSession() {
        var D = root.WeotziData;
        if (!D || !D.Artists || typeof D.Artists.getPublicByUserId !== 'function') return Promise.resolve({ uploaded: false, reason: 'sin-datos' });
        return sessionUserId().then(function (userId) {
            if (!userId) return { uploaded: false, reason: 'sin-sesion' };
            return Promise.all([ensureRepo(), ensurePublicUrl()]).then(function (mods) {
                var P = mods[0];
                var PublicUrl = mods[1];
                // Sin la regla de URL corta no se genera: quedaría otro enlace en la tarjeta.
                if (!P || !PublicUrl) return { uploaded: false, reason: 'sin-repo' };
                var columns = 'user_id,username,name,profile_picture,styles_array,city,country,gallery_images';
                return Promise.all([
                    D.Artists.getPublicByUserId(userId, columns),
                    typeof P.getPreferences === 'function' ? P.getPreferences(userId) : null
                ]).then(function (res) {
                    var artist = res[0] && res[0].data;
                    if (!artist || !artist.username) return { uploaded: false, reason: 'sin-artista' };
                    var url = PublicUrl.publicProfileUrl(artist.username, root.location.origin + basePath());
                    return syncOgCard({ artist: artist, prefs: res[1] || {}, url: url });
                });
            });
        }).catch(function () { return { uploaded: false, reason: 'error' }; });
    }

    var refreshTimer = null;
    function wireAccountRefresh() {
        if (!root.document || typeof root.document.addEventListener !== 'function') return;
        root.document.addEventListener('wo:assist-refresh', function (event) {
            var section = event && event.detail && event.detail.section;
            if (section !== 'perfil' && section !== 'portafolio') return;
            // Varias guardadas seguidas (foto + datos) generan una sola tarjeta.
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(function () { syncForSession(); }, 2500);
        });
    }

    var api = {
        STORY: STORY,
        OG: OG,
        LAYOUT_VERSION: LAYOUT_VERSION,
        BUCKET: BUCKET,
        cardData: cardData,
        coverRect: coverRect,
        wrapLines: wrapLines,
        ellipsize: ellipsize,
        fitText: fitText,
        hash: hash,
        signature: signature,
        ogObjectPath: ogObjectPath,
        storyFileName: storyFileName,
        prettyUrl: prettyUrl,
        eyebrowText: eyebrowText,
        renderStory: renderStory,
        renderOg: renderOg,
        storyBlob: storyBlob,
        ogBlob: ogBlob,
        toBlob: toBlob,
        loadPrefs: loadPrefs,
        syncOgCard: syncOgCard,
        syncForSession: syncForSession
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.WoShareCards = api;
        wireAccountRefresh();
    }
}(typeof self !== 'undefined' ? self : this));
