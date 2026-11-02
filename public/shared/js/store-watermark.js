/**
 * WE OTZI - Marca de agua y exportación de vistas previas de la Store
 * -------------------------------------------------------------------
 * Las imágenes públicas de un diseño (bucket store-previews, ≤3 MB, sin SVG)
 * se generan en el navegador: se reduce el lado mayor a 1600 px y se dibuja
 * una marca diagonal repetida «WE ÖTZI · @usuario». El original nunca sale de
 * store-design-files (privado). El merch usa renderPlain, sin marca.
 *
 * Partes puras (testeables en Node): fitWithin, tilePositions, watermarkLabel
 * y encodePlan. Partes de navegador: renderPreview y renderPlain, que aceptan
 * dependencias inyectables (createCanvas, loadImage, convertHeic) para poder
 * probar la cadena de exportación con un canvas falso:
 *   1. convertIfHEIC (heic-converter.js) si está cargado;
 *   2. toBlob('image/webp', q). Si el blob no es webp (Safari) o es null, se
 *      exporta como image/jpeg con la misma calidad y no se vuelve a probar webp;
 *   3. mientras el resultado pase de 3 MB baja la calidad y, después, el lado.
 * Devuelve { blob, ext, contentType, width, height, quality, attempts }.
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root) root.WeotziStoreWatermark = api;
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function (root) {
    'use strict';

    var DEFAULTS = {
        maxSide: 1600,
        maxBytes: 3145728,          // = FILES.PREVIEW_MAX_BYTES de store-model.js
        minSide: 480,
        qualities: [0.82, 0.72, 0.62, 0.52],
        sideSteps: [0.8, 0.64, 0.5, 0.4],
        angle: -Math.PI / 6,        // -30°
        // Colores del canvas (no hay tokens CSS acá): neutral-100, blanco y
        // neutral-500 del DS con transparencia.
        background: 'rgb(250, 248, 243)',
        markFill: 'rgba(252, 252, 252, 0.46)',
        markStroke: 'rgba(36, 33, 29, 0.34)'
    };
    var MAX_TILES = 600;

    var READ_ERROR = 'No pudimos leer la imagen. Subí un JPG, PNG, WebP o HEIC.';
    var CANVAS_ERROR = 'Tu navegador no pudo preparar la imagen. Probá con otro navegador.';
    var TOO_LARGE_ERROR = 'No pudimos dejar la imagen por debajo de 3 MB. Probá con una imagen más liviana.';

    function num(value) {
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isFinite(n) ? n : NaN;
    }

    /* ------------------------------ puras ------------------------------ */

    // Escala (w, h) para que el lado mayor no pase de `max`. Nunca agranda.
    function fitWithin(w, h, max) {
        var W = num(w), H = num(h), M = num(max);
        if (!(W > 0 && H > 0)) return { width: 0, height: 0, scale: 0 };
        var scale = M > 0 ? Math.min(1, M / Math.max(W, H)) : 1;
        return {
            width: Math.max(1, Math.round(W * scale)),
            height: Math.max(1, Math.round(H * scale)),
            scale: scale
        };
    }

    // Centros de las marcas en coordenadas del canvas: filas cada step·0,55,
    // columnas cada `step`, filas impares corridas medio paso (patrón ladrillo).
    // Arranca y termina fuera del canvas para que la diagonal cubra los bordes.
    // Si el paso daría demasiadas marcas, se agranda hasta MAX_TILES.
    function tilePositions(w, h, step) {
        var W = num(w), H = num(h), s = num(step);
        if (!(W > 0 && H > 0)) return [];
        if (!(s > 0)) s = Math.max(W, H) / 4;
        var rowGap = s * 0.55;
        while (Math.ceil((W + 2 * s) / s + 1) * Math.ceil((H + 2 * rowGap) / rowGap + 1) > MAX_TILES) {
            s *= 1.25;
            rowGap = s * 0.55;
        }
        var out = [];
        var row = 0;
        for (var y = -rowGap; y <= H + rowGap; y += rowGap, row++) {
            var offset = row % 2 ? s / 2 : 0;
            for (var x = -s + offset; x <= W + s; x += s) out.push({ x: Math.round(x), y: Math.round(y) });
        }
        return out;
    }

    // «WE ÖTZI · @usuario» (o «WE ÖTZI» sin usuario).
    function watermarkLabel(handle) {
        var h = String(handle == null ? '' : handle).trim().replace(/^@+/, '').replace(/\s+/g, '');
        return h ? 'WE ÖTZI · @' + h : 'WE ÖTZI';
    }

    // Secuencia de intentos { quality, side } hasta quedar ≤ maxBytes: primero
    // baja la calidad al lado completo; después achica el lado con la última
    // calidad, sin bajar de minSide (ni repetir lados).
    function encodePlan(opts) {
        opts = opts || {};
        var side = Math.round(num(opts.side || opts.maxSide || DEFAULTS.maxSide));
        if (!(side > 0)) side = DEFAULTS.maxSide;
        var minSide = Math.min(side, Math.round(num(opts.minSide || DEFAULTS.minSide)) || DEFAULTS.minSide);
        var qualities = Array.isArray(opts.qualities) && opts.qualities.length ? opts.qualities : DEFAULTS.qualities;
        var steps = Array.isArray(opts.sideSteps) ? opts.sideSteps : DEFAULTS.sideSteps;
        var plan = qualities.map(function (q) { return { quality: q, side: side }; });
        var last = qualities[qualities.length - 1];
        var seen = {};
        seen[side] = true;
        steps.forEach(function (factor) {
            var s = Math.max(minSide, Math.round(side * factor));
            if (seen[s]) return;
            seen[s] = true;
            plan.push({ quality: last, side: s });
        });
        return plan;
    }

    /* ---------------------------- navegador ---------------------------- */

    function defaultCreateCanvas(width, height) {
        if (root && root.document && typeof root.document.createElement === 'function') {
            var canvas = root.document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            return canvas;
        }
        if (root && typeof root.OffscreenCanvas === 'function') return new root.OffscreenCanvas(width, height);
        throw new Error(CANVAS_ERROR);
    }

    function loadWithImageElement(file) {
        return new Promise(function (resolve, reject) {
            var URLApi = root && (root.URL || root.webkitURL);
            if (!URLApi || typeof root.Image !== 'function') { reject(new Error(READ_ERROR)); return; }
            var url = URLApi.createObjectURL(file);
            var img = new root.Image();
            img.decoding = 'async';
            img.onload = function () {
                resolve({
                    source: img,
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height,
                    close: function () { URLApi.revokeObjectURL(url); }
                });
            };
            img.onerror = function () { URLApi.revokeObjectURL(url); reject(new Error(READ_ERROR)); };
            img.src = url;
        });
    }

    // createImageBitmap respeta la orientación EXIF; si falla (formato raro o
    // navegador viejo) se intenta con <img>.
    function defaultLoadImage(file) {
        if (root && typeof root.createImageBitmap === 'function') {
            return root.createImageBitmap(file).then(function (bmp) {
                return { source: bmp, width: bmp.width, height: bmp.height, close: function () { if (bmp.close) bmp.close(); } };
            }, function () { return loadWithImageElement(file); });
        }
        return loadWithImageElement(file);
    }

    function closeImage(image) {
        try { if (image && typeof image.close === 'function') image.close(); } catch (e) { /* ya liberada */ }
    }

    // toBlob (HTMLCanvasElement) o convertToBlob (OffscreenCanvas) como promesa.
    // Nunca rechaza: null significa «este tipo no salió».
    function canvasToBlob(canvas, type, quality) {
        return new Promise(function (resolve) {
            try {
                if (canvas && typeof canvas.toBlob === 'function') {
                    canvas.toBlob(function (blob) { resolve(blob || null); }, type, quality);
                    return;
                }
                if (canvas && typeof canvas.convertToBlob === 'function') {
                    canvas.convertToBlob({ type: type, quality: quality }).then(function (blob) { resolve(blob || null); }, function () { resolve(null); });
                    return;
                }
            } catch (e) { /* canvas manchado o tipo inválido */ }
            resolve(null);
        });
    }

    var EXT_FOR_TYPE = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

    // WebP primero; si el navegador entrega otro tipo o nada, JPEG con la misma
    // calidad, y el resto de los intentos ya van directo a JPEG.
    function encodeCanvas(canvas, quality, state) {
        var first = state.noWebp ? Promise.resolve(null) : canvasToBlob(canvas, 'image/webp', quality);
        return first.then(function (blob) {
            if (blob && blob.type === 'image/webp') return { blob: blob, contentType: 'image/webp', ext: 'webp' };
            state.noWebp = true;
            return canvasToBlob(canvas, 'image/jpeg', quality).then(function (jpeg) {
                if (!jpeg) throw new Error(CANVAS_ERROR);
                var type = jpeg.type || 'image/jpeg';
                if (!EXT_FOR_TYPE[type]) throw new Error(CANVAS_ERROR);
                return { blob: jpeg, contentType: type, ext: EXT_FOR_TYPE[type] };
            });
        });
    }

    // Marca diagonal repetida. Devuelve la cantidad de marcas dibujadas.
    function drawWatermark(ctx, width, height, label, opts) {
        opts = Object.assign({}, DEFAULTS, opts || {});
        var side = Math.max(width, height);
        var fontSize = Math.max(14, Math.round(side * 0.026));
        ctx.save();
        ctx.font = '700 ' + fontSize + 'px "JetBrains Mono", ui-monospace, monospace';
        var measured = typeof ctx.measureText === 'function' ? num(ctx.measureText(label).width) : NaN;
        var textWidth = measured > 0 ? measured : label.length * fontSize * 0.62;
        var positions = tilePositions(width, height, Math.round(textWidth + fontSize * 4));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, fontSize / 8);
        ctx.strokeStyle = opts.markStroke;
        ctx.fillStyle = opts.markFill;
        positions.forEach(function (p) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(opts.angle);
            ctx.strokeText(label, 0, 0);
            ctx.fillText(label, 0, 0);
            ctx.restore();
        });
        ctx.restore();
        return positions.length;
    }

    function drawFrame(deps, image, width, height, label, opts) {
        var canvas = deps.createCanvas(width, height);
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx) throw new Error(CANVAS_ERROR);
        // Fondo crema: un PNG transparente exportado a JPEG no queda negro.
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image.source, 0, 0, width, height);
        if (label) drawWatermark(ctx, width, height, label, opts);
        return canvas;
    }

    function releaseCanvas(canvas) {
        try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch (e) { /* OffscreenCanvas transferido */ }
    }

    function render(file, options, label) {
        var opts = Object.assign({}, DEFAULTS, options || {});
        var heic = opts.convertHeic || (root && typeof root.convertIfHEIC === 'function' ? root.convertIfHEIC : null);
        var deps = {
            createCanvas: opts.createCanvas || defaultCreateCanvas,
            loadImage: opts.loadImage || defaultLoadImage
        };
        if (!file) return Promise.reject(new Error('Elegí una imagen.'));
        var image = null;
        return Promise.resolve()
            .then(function () { return heic ? heic(file) : file; })
            .then(function (converted) { return converted || file; }, function () { return file; })
            .then(function (source) { return deps.loadImage(source); })
            .then(function (img) {
                image = img;
                if (!(img && img.width > 0 && img.height > 0)) throw new Error(READ_ERROR);
                var fit = fitWithin(img.width, img.height, opts.maxSide);
                var plan = encodePlan({ side: Math.max(fit.width, fit.height), minSide: opts.minSide, qualities: opts.qualities, sideSteps: opts.sideSteps });
                var state = { noWebp: false };
                var current = { key: null, canvas: null };
                var i = 0;
                function attempt() {
                    if (i >= plan.length) { releaseCanvas(current.canvas); throw new Error(TOO_LARGE_ERROR); }
                    var step = plan[i++];
                    var size = fitWithin(img.width, img.height, step.side);
                    var key = size.width + 'x' + size.height;
                    if (current.key !== key) {
                        releaseCanvas(current.canvas);
                        current = { key: key, canvas: drawFrame(deps, img, size.width, size.height, label, opts) };
                    }
                    return encodeCanvas(current.canvas, step.quality, state).then(function (out) {
                        if (out.blob.size <= opts.maxBytes) {
                            return { blob: out.blob, ext: out.ext, contentType: out.contentType, width: size.width, height: size.height, quality: step.quality, attempts: i };
                        }
                        return attempt();
                    });
                }
                return attempt();
            })
            .then(function (result) { closeImage(image); return result; }, function (err) { closeImage(image); throw err; });
    }

    // Vista previa de un diseño, con marca de agua. opts: { maxSide, label,
    // handle, maxBytes, createCanvas, loadImage, convertHeic }.
    function renderPreview(file, opts) {
        opts = opts || {};
        return render(file, opts, opts.label || watermarkLabel(opts.handle));
    }

    // Imagen de merch: misma reducción y exportación, sin marca.
    function renderPlain(file, opts) {
        return render(file, opts || {}, null);
    }

    return {
        DEFAULTS: DEFAULTS,
        MAX_TILES: MAX_TILES,
        fitWithin: fitWithin,
        tilePositions: tilePositions,
        watermarkLabel: watermarkLabel,
        encodePlan: encodePlan,
        canvasToBlob: canvasToBlob,
        encodeCanvas: encodeCanvas,
        drawWatermark: drawWatermark,
        renderPreview: renderPreview,
        renderPlain: renderPlain
    };
}));
