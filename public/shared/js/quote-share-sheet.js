/**
 * WE ÖTZI — Hoja de cotización: HTML, PDF (impresión) e imagen PNG
 * -----------------------------------------------------------------
 * Ronda 2 · frente cot-detalle · [P30]. Pinta la vista de
 * WoQuoteShareModel.view(sheet) de tres formas, sin dependencias nuevas:
 *   · html(view)        marcado de la hoja (página pública y vista imprimible)
 *   · print(view)       "Descargar PDF": abre el diálogo de impresión del
 *                       navegador mostrando solo la hoja (@media print en
 *                       quote-share.css)
 *   · downloadPng(view) "Descargar imagen": PNG de 1080 px de ancho dibujado
 *                       con canvas (con código QR si hay enlace público y
 *                       qrcode-generator.js está cargado)
 *
 * Todo dato llega como texto plano y se escapa aquí. Expone window.WoQuoteSheet.
 */
(function () {
    'use strict';

    var SM = window.WoQuoteShareModel;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function safeUrl(value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) return '';
        try {
            var url = new URL(raw, window.location.origin);
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
        } catch (_) {
            return '';
        }
    }

    // ------------------------------------------------------------ código QR
    // Matriz de módulos (true = oscuro) o null si no hay generador o URL.
    function qrMatrix(url) {
        if (!url || typeof window.qrcode !== 'function') return null;
        try {
            var qr = window.qrcode(0, 'M');
            qr.addData(String(url));
            qr.make();
            var count = qr.getModuleCount();
            var rows = [];
            for (var r = 0; r < count; r += 1) {
                var row = [];
                for (var c = 0; c < count; c += 1) row.push(!!qr.isDark(r, c));
                rows.push(row);
            }
            return rows;
        } catch (_) {
            return null;
        }
    }
    function qrSvg(url) {
        var matrix = qrMatrix(url);
        if (!matrix) return '';
        var n = matrix.length;
        var path = '';
        for (var r = 0; r < n; r += 1) {
            for (var c = 0; c < n; c += 1) if (matrix[r][c]) path += 'M' + (c + 2) + ' ' + (r + 2) + 'h1v1h-1z';
        }
        return '<svg class="wqs-qr-code" viewBox="0 0 ' + (n + 4) + ' ' + (n + 4) + '" role="img" aria-label="Código QR del enlace de la cotización" shape-rendering="crispEdges">'
            + '<rect width="100%" height="100%" fill="#fff"></rect><path d="' + path + '" fill="#000"></path></svg>';
    }

    // ------------------------------------------------------------ HTML
    function rowsHtml(rows) {
        if (!rows.length) return '';
        return '<dl class="wqs-rows">' + rows.map(function (row) {
            return '<div><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
        }).join('') + '</dl>';
    }

    function html(view) {
        var v = view || {};
        var a = v.artist || {};
        var photo = safeUrl(a.photoUrl);
        var profile = safeUrl(a.profileUrl);
        var url = safeUrl(v.url);
        var initials = String(a.name || 'WO').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || 'WO';

        var breakdown = v.items && v.items.length ? (
            '<section class="wqs-section wqs-breakdown" aria-label="Desglose">'
            + '<h2 class="wqs-label">Desglose</h2>'
            + '<ul class="wqs-items">' + v.items.map(function (it) {
                return '<li><div class="wqs-item-main"><strong>' + esc(it.name) + '</strong>'
                    + (it.description ? '<span>' + esc(it.description) + '</span>' : '')
                    + '<small>' + esc(it.qtyLine) + '</small></div><span class="wqs-item-total">' + esc(it.total) + '</span></li>';
            }).join('') + '</ul>'
            + '<dl class="wqs-totals">' + v.totals.map(function (row, index) {
                return '<div' + (index === v.totals.length - 1 ? ' class="is-total"' : '') + '><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
            }).join('') + '</dl></section>') : '';

        var sessions = v.sessions && v.sessions.length ? (
            '<section class="wqs-section" aria-label="Sesiones"><h2 class="wqs-label">Sesiones agendadas</h2>'
            + rowsHtml(v.sessions.map(function (s) { return [s.label, s.value]; })) + '</section>') : '';

        var termsParts = '';
        if (v.terms && v.terms.length) termsParts += '<ul class="wqs-terms-list">' + v.terms.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
        if (v.extraTerms) termsParts += '<p class="wqs-pre">' + esc(v.extraTerms) + '</p>';
        var terms = termsParts ? '<section class="wqs-section" aria-label="Términos"><h2 class="wqs-label">Términos</h2>' + termsParts + '</section>' : '';
        var notes = v.clientNotes ? '<section class="wqs-section" aria-label="Notas del artista"><h2 class="wqs-label">Notas del artista</h2><p class="wqs-pre">' + esc(v.clientNotes) + '</p></section>' : '';

        var qr = url ? qrSvg(url) : '';
        var linkBlock = url ? (
            '<div class="wqs-link">' + qr
            + '<div class="wqs-link-copy"><strong>Mira y responde esta cotización en línea</strong>'
            + '<a href="' + esc(url) + '">' + esc(v.urlText) + '</a>'
            + (v.linkExpiry ? '<small>' + esc(v.linkExpiry) + '</small>' : '') + '</div></div>') : '';

        return '<article class="wqs-sheet">'
            + '<header class="wqs-head">'
                + '<div class="wqs-brand"><span class="wqs-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>WE ÖTZI</span></div>'
                + '<div class="wqs-ref"><span class="wqs-ref-id">' + esc(v.ref) + '</span>'
                + '<span class="wqs-status wqs-status--' + esc(v.statusTone) + '">' + esc(v.statusLabel) + '</span></div>'
            + '</header>'
            + '<div class="wqs-intro">'
                + '<p class="wqs-eyebrow">' + esc(v.byline) + '</p>'
                + '<h1 class="wqs-title">' + esc(v.title) + '</h1>'
                + ((v.clientLine || v.dateLine) ? '<p class="wqs-meta">' + esc([v.clientLine, v.dateLine].filter(Boolean).join(' · ')) + '</p>' : '')
                + (v.chips && v.chips.length ? '<ul class="wqs-chips">' + v.chips.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '')
            + '</div>'
            + '<div class="wqs-grid">'
                + '<section class="wqs-section wqs-idea" aria-label="La idea"><h2 class="wqs-label">La idea</h2>'
                    + '<p class="wqs-pre">' + esc(v.idea || 'Sin descripción.') + '</p></section>'
                + '<section class="wqs-section wqs-proposal" aria-label="Propuesta">'
                    + '<h2 class="wqs-label">' + esc(v.totalLabel) + '</h2>'
                    + '<p class="wqs-total">' + esc(v.total) + '</p>'
                    + (v.pendingCopy ? '<p class="wqs-pending">' + esc(v.pendingCopy) + '</p>' : '')
                    + rowsHtml(v.proposalRows || [])
                + '</section>'
            + '</div>'
            + breakdown + sessions + terms + notes
            + '<footer class="wqs-foot">'
                + '<div class="wqs-artist">'
                    + (photo ? '<img class="wqs-artist-photo" src="' + esc(photo) + '" alt="" width="56" height="56" loading="lazy" referrerpolicy="no-referrer">'
                             : '<span class="wqs-artist-photo wqs-artist-photo--initials" aria-hidden="true">' + esc(initials) + '</span>')
                    + '<div><strong>' + esc(a.name) + '</strong>'
                    + (a.verified ? '<span class="wqs-verified">Perfil verificado</span>' : '')
                    + (a.line ? '<span>' + esc(a.line) + '</span>' : '')
                    + (profile ? '<a href="' + esc(profile) + '">Ver perfil del artista</a>' : '')
                    + '</div></div>'
                + linkBlock
                + '<p class="wqs-footer-note">' + esc(v.footer) + '</p>'
            + '</footer>'
        + '</article>';
    }

    // ------------------------------------------------------------ PDF (impresión)
    var PRINT_HOST_ID = 'wo-quote-print';
    var PRINT_CLASS = 'wo-quote-printing';

    function waitImages(root, timeoutMs) {
        var images = Array.prototype.slice.call(root.querySelectorAll('img'));
        var pending = images.filter(function (img) { return !img.complete; });
        if (!pending.length) return Promise.resolve();
        return new Promise(function (resolve) {
            var left = pending.length;
            var timer = window.setTimeout(resolve, timeoutMs);
            function done() {
                left -= 1;
                if (left <= 0) { window.clearTimeout(timer); resolve(); }
            }
            pending.forEach(function (img) {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
            });
        });
    }

    function cleanupPrint() {
        document.documentElement.classList.remove(PRINT_CLASS);
        var host = document.getElementById(PRINT_HOST_ID);
        if (host) host.innerHTML = '';
    }

    /** Abre el diálogo de impresión con la hoja sola ("Guardar como PDF"). */
    async function print(view) {
        var host = document.getElementById(PRINT_HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = PRINT_HOST_ID;
            host.setAttribute('aria-hidden', 'true');
            document.body.appendChild(host);
        }
        host.innerHTML = html(view);
        // Las fotos se cargan ya (no lazy) para que salgan en el PDF.
        host.querySelectorAll('img[loading]').forEach(function (img) { img.removeAttribute('loading'); });
        document.documentElement.classList.add(PRINT_CLASS);
        await waitImages(host, 2000);
        var previousTitle = document.title;
        document.title = SM.fileName({ quote_id: view.ref }, 'pdf').replace(/\.pdf$/, '');
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            window.removeEventListener('afterprint', finish);
            document.title = previousTitle;
            cleanupPrint();
        }
        window.addEventListener('afterprint', finish);
        try {
            window.print();
        } finally {
            // Navegadores sin afterprint (algunos móviles): se limpia al volver el foco.
            window.setTimeout(function () {
                if (finished) return;
                window.addEventListener('focus', finish, { once: true });
                window.setTimeout(finish, 60000);
            }, 1000);
        }
    }

    // ------------------------------------------------------------ PNG (canvas)
    var PNG_WIDTH = 1080;
    var PAD = 72;

    function token(name, fallback) {
        try {
            var value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
            return (value && value.trim()) || fallback;
        } catch (_) {
            return fallback;
        }
    }
    function palette() {
        return {
            paper: token('--neutral-100', '#FAF8F3'),
            ink: token('--ink', '#001125'),
            body: token('--neutral-500', '#24211D'),
            muted: token('--neutral-400', '#5A5449'),
            faint: token('--neutral-300', '#B9AE98'),
            rule: token('--neutral-200', '#E8E3D7'),
            yellow: token('--yellow-300', '#F2B519'),
            red: token('--bauhaus-square', '#E42121'),
            blue: token('--blue-400', '#0055FF'),
            white: token('--white', '#FCFCFC'),
            success: token('--system-success', '#1E9F74')
        };
    }
    var FONT = {
        display: function (size) { return '400 ' + size + 'px "Archivo Black", "Arial Black", Impact, sans-serif'; },
        body: function (size, weight) { return (weight || 400) + ' ' + size + 'px Inter, "Helvetica Neue", Arial, sans-serif'; },
        mono: function (size, weight) { return (weight || 500) + ' ' + size + 'px "JetBrains Mono", "Courier New", monospace'; }
    };

    async function loadFonts() {
        if (!document.fonts || typeof document.fonts.load !== 'function') return;
        try {
            await Promise.race([
                Promise.all([
                    document.fonts.load(FONT.display(40)),
                    document.fonts.load(FONT.body(28, 400)),
                    document.fonts.load(FONT.body(28, 700)),
                    document.fonts.load(FONT.mono(20, 500))
                ]),
                new Promise(function (resolve) { window.setTimeout(resolve, 2500); })
            ]);
        } catch (_) { /* se dibuja con las fuentes de respaldo */ }
    }

    /**
     * Arma la lista de operaciones de dibujo y el alto total. `ctx` se usa
     * para medir; cada operación recibe el contexto definitivo.
     */
    function compose(view, ctx, colors) {
        var ops = [];
        var y = 0;
        var inner = PNG_WIDTH - PAD * 2;

        function measure(font) {
            return function (text) { ctx.font = font; return ctx.measureText(text).width; };
        }
        function text(str, x, yy, font, color, align) {
            ops.push(function (c) {
                c.font = font; c.fillStyle = color; c.textAlign = align || 'left'; c.textBaseline = 'alphabetic';
                c.fillText(str, x, yy);
            });
        }
        function rect(x, yy, w, h, color) {
            ops.push(function (c) { c.fillStyle = color; c.fillRect(x, yy, w, h); });
        }
        function paragraph(str, font, color, lineHeight, maxLines, x, width) {
            var lines = SM.wrapText(measure(font), str, width || inner, maxLines);
            lines.forEach(function (line) {
                y += lineHeight;
                if (line) text(line, x == null ? PAD : x, y, font, color);
            });
            return lines.length;
        }
        function label(str) {
            y += 34;
            text(String(str).toUpperCase(), PAD, y, FONT.mono(20, 700), colors.muted);
            y += 10;
        }
        function rule(color, height) {
            y += 18;
            rect(PAD, y, inner, height || 2, color || colors.rule);
            y += (height || 2);
        }
        function pairRow(left, right) {
            var rightFont = FONT.body(26, 700);
            var leftFont = FONT.mono(20, 500);
            var rightLines = SM.wrapText(measure(rightFont), right, inner * 0.62, 3);
            y += 40;
            text(String(left).toUpperCase(), PAD, y, leftFont, colors.muted);
            rightLines.forEach(function (line, index) {
                if (index) y += 34;
                text(line, PAD + inner, y, rightFont, colors.body, 'right');
            });
            y += 16;
            rect(PAD, y, inner, 1, colors.rule);
        }

        // Encabezado en tinta con la marca y la referencia.
        var headH = 150;
        rect(0, 0, PNG_WIDTH, headH, colors.ink);
        rect(PAD, 55, 26, 26, colors.red);
        ops.push(function (c) { c.fillStyle = colors.yellow; c.beginPath(); c.arc(PAD + 52, 68, 13, 0, Math.PI * 2); c.fill(); });
        ops.push(function (c) {
            c.fillStyle = colors.blue; c.beginPath();
            c.moveTo(PAD + 78, 81); c.lineTo(PAD + 91, 55); c.lineTo(PAD + 104, 81); c.closePath(); c.fill();
        });
        text('WE ÖTZI', PAD + 124, 82, FONT.display(36), colors.paper);
        if (view.ref) text(view.ref, PNG_WIDTH - PAD, 66, FONT.mono(24, 700), colors.yellow, 'right');
        text(String(view.statusLabel || '').toUpperCase(), PNG_WIDTH - PAD, 100, FONT.mono(18, 500), colors.paper, 'right');
        y = headH + 26;

        // Título.
        y += 30;
        paragraph(String(view.byline || '').toUpperCase(), FONT.mono(20, 500), colors.muted, 28, 2);
        y += 14;
        paragraph(view.title, FONT.display(58), colors.ink, 66, 3);
        var meta = [view.clientLine, view.dateLine].filter(Boolean).join(' · ');
        if (meta) { y += 10; paragraph(meta, FONT.body(26, 500), colors.muted, 36, 2); }

        // Chips.
        if (view.chips && view.chips.length) {
            y += 26;
            var chipFont = FONT.mono(20, 700);
            var cx = PAD;
            var chipH = 44;
            view.chips.slice(0, 6).forEach(function (chip) {
                var labelText = String(chip).toUpperCase();
                var fitted = SM.wrapText(measure(chipFont), labelText, inner - 36, 1)[0] || labelText;
                var w = Math.ceil(measure(chipFont)(fitted)) + 36;
                if (cx + w > PAD + inner && cx > PAD) { cx = PAD; y += chipH + 12; }
                rect(cx, y, w, chipH, colors.rule);
                text(fitted, cx + 18, y + 29, chipFont, colors.ink);
                cx += w + 12;
            });
            y += chipH;
        }

        // Idea.
        if (view.idea) {
            y += 18;
            label('La idea');
            paragraph(view.idea, FONT.body(27, 400), colors.body, 40, 7);
        }

        // Propuesta.
        y += 44;
        var boxTop = y;
        var boxH = view.pendingCopy ? 214 : 176;
        rect(PAD, boxTop, inner, boxH, colors.yellow);
        text(String(view.totalLabel || 'Presupuesto').toUpperCase(), PAD + 32, boxTop + 52, FONT.mono(20, 700), colors.body);
        var totalFont = FONT.display(72);
        var totalText = SM.wrapText(measure(totalFont), view.total, inner - 64, 1)[0] || view.total;
        text(totalText, PAD + 32, boxTop + 134, totalFont, colors.ink);
        if (view.pendingCopy) text(view.pendingCopy, PAD + 32, boxTop + 182, FONT.body(24, 500), colors.body);
        y = boxTop + boxH;
        (view.proposalRows || []).forEach(function (row) { pairRow(row[0], row[1]); });

        // Desglose.
        if (view.items && view.items.length) {
            y += 22;
            label('Desglose');
            var shown = view.items.slice(0, 8);
            shown.forEach(function (it) {
                y += 44;
                var nameFont = FONT.body(26, 700);
                var totalW = measure(nameFont)(it.total);
                var name = SM.wrapText(measure(nameFont), it.name, inner - totalW - 32, 1)[0] || it.name;
                text(name, PAD, y, nameFont, colors.body);
                text(it.total, PAD + inner, y, nameFont, colors.body, 'right');
                y += 30;
                text(it.qtyLine, PAD, y, FONT.mono(19, 500), colors.muted);
                y += 16;
                rect(PAD, y, inner, 1, colors.rule);
            });
            if (view.items.length > shown.length) {
                y += 36;
                var extra = view.items.length - shown.length;
                text('+ ' + extra + (extra === 1 ? ' concepto más' : ' conceptos más') + (view.url ? ' en el enlace' : ''), PAD, y, FONT.mono(20, 500), colors.muted);
            }
            (view.totals || []).forEach(function (row, index) {
                var last = index === view.totals.length - 1;
                y += last ? 50 : 40;
                text(String(row[0]).toUpperCase(), PAD, y, FONT.mono(20, last ? 700 : 500), last ? colors.ink : colors.muted);
                text(row[1], PAD + inner, y, last ? FONT.display(32) : FONT.body(26, 600), last ? colors.ink : colors.body, 'right');
            });
            rule(colors.ink, 3);
        }

        // Sesiones.
        if (view.sessions && view.sessions.length) {
            y += 22;
            label('Sesiones agendadas');
            view.sessions.slice(0, 3).forEach(function (s) { pairRow(s.label, s.value); });
        }

        // Términos y notas.
        if ((view.terms && view.terms.length) || view.extraTerms) {
            y += 22;
            label('Términos');
            (view.terms || []).forEach(function (t) { paragraph(t, FONT.body(24, 400), colors.body, 36, 3); y += 6; });
            if (view.extraTerms) paragraph(view.extraTerms, FONT.body(24, 400), colors.body, 36, 5);
        }
        if (view.clientNotes) {
            y += 22;
            label('Notas del artista');
            paragraph(view.clientNotes, FONT.body(24, 400), colors.body, 36, 5);
        }

        // Pie en tinta: artista y enlace con QR.
        y += 56;
        var footTop = y;
        var matrix = view.url ? qrMatrix(view.url) : null;
        var qrSize = 220;
        var artist = view.artist || {};
        var copyWidth = inner - (matrix ? qrSize + 40 : 0);
        var footOps = [];
        var fy = footTop + 64;
        function footText(str, font, color, lineHeight, maxLines) {
            SM.wrapText(measure(font), str, copyWidth, maxLines).forEach(function (line) {
                var yy = fy;
                footOps.push(function (c) { c.font = font; c.fillStyle = color; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(line, PAD, yy); });
                fy += lineHeight;
            });
        }
        footText(String(artist.name || 'Tu artista'), FONT.display(36), colors.paper, 44, 2);
        if (artist.verified) footText('PERFIL VERIFICADO', FONT.mono(18, 700), colors.yellow, 30, 1);
        if (artist.line) footText(artist.line, FONT.body(24, 400), colors.rule, 34, 2);
        if (view.url) {
            fy += 14;
            footText(matrix ? 'Escanea el código o abre el enlace para ver y responder la cotización:' : 'Abre el enlace para ver y responder la cotización:', FONT.body(22, 500), colors.paper, 30, 3);
            footText(view.urlText, FONT.mono(18, 500), colors.yellow, 26, 4);
        }
        var footH = Math.max(fy - footTop + 28, matrix ? qrSize + 88 : 0);
        rect(0, footTop, PNG_WIDTH, footH, colors.ink);
        footOps.forEach(function (op) { ops.push(op); });
        if (matrix) {
            var qx = PNG_WIDTH - PAD - qrSize;
            var qy = footTop + 44;
            var n = matrix.length;
            var quiet = 14;
            var cell = (qrSize - quiet * 2) / n;
            ops.push(function (c) {
                c.fillStyle = '#FFFFFF';
                c.fillRect(qx, qy, qrSize, qrSize);
                c.fillStyle = '#000000';
                for (var r = 0; r < n; r += 1) {
                    for (var col = 0; col < n; col += 1) {
                        if (matrix[r][col]) c.fillRect(qx + quiet + Math.floor(col * cell), qy + quiet + Math.floor(r * cell), Math.ceil(cell), Math.ceil(cell));
                    }
                }
            });
        }
        y = footTop + footH;
        rect(0, y, PNG_WIDTH, 64, colors.paper);
        text(String(view.footer || '').toUpperCase(), PNG_WIDTH / 2, y + 40, FONT.mono(17, 500), colors.muted, 'center');
        y += 64;
        return { ops: ops, height: Math.ceil(y) };
    }

    /** Dibuja la hoja y devuelve el canvas (1080 px de ancho). */
    async function renderCanvas(view) {
        await loadFonts();
        var colors = palette();
        var probe = document.createElement('canvas');
        var layout = compose(view || {}, probe.getContext('2d'), colors);
        var canvas = document.createElement('canvas');
        canvas.width = PNG_WIDTH;
        canvas.height = Math.min(layout.height, 16000);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = colors.paper;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        layout.ops.forEach(function (op) { op(ctx); });
        return canvas;
    }

    function canvasBlob(canvas) {
        return new Promise(function (resolve, reject) {
            if (typeof canvas.toBlob !== 'function') { reject(new Error('Este navegador no puede generar la imagen.')); return; }
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error('No pudimos generar la imagen.'));
            }, 'image/png');
        });
    }

    function saveBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    /** "Descargar imagen": genera el PNG y lo baja con un nombre legible. */
    async function downloadPng(view) {
        var canvas = await renderCanvas(view);
        var blob = await canvasBlob(canvas);
        saveBlob(blob, SM.fileName({ quote_id: view && view.ref }, 'png'));
        return blob;
    }

    window.WoQuoteSheet = { html: html, print: print, renderCanvas: renderCanvas, downloadPng: downloadPng, qrSvg: qrSvg, qrMatrix: qrMatrix, esc: esc, safeUrl: safeUrl };
})();
