/**
 * WE ÖTZI — Compartir y exportar una cotización (lado artista)
 * -------------------------------------------------------------
 * Ronda 2 · frente cot-detalle · [P30]. Tres acciones para cotizaciones
 * manuales y recibidas, usadas por el detalle (quotation-detail-info.js) y al
 * terminar una cotización manual (quotation-new.js):
 *   · Copiar enlace      enlace público /cotizacion/<token> (se crea si hace
 *                        falta; revocable y con vencimiento)
 *   · Descargar PDF      vista imprimible → diálogo de impresión del navegador
 *   · Descargar imagen   PNG generado con canvas
 *
 * La hoja la arma el servidor (GET /api/cot-detalle/quotations/:id/sheet): es
 * exactamente lo que ve el cliente, sin salud ni contacto.
 *
 * Requiere quote-share-model.js, quote-share-sheet.js y
 * data/quotation-info-repo.js. Expone window.WoQuoteShare.
 */
(function () {
    'use strict';

    var SM = window.WoQuoteShareModel;
    var Sheet = function () { return window.WoQuoteSheet; };
    var Repo = function () { return (window.WeotziData && window.WeotziData.QuotationInfo) || window.WoQuotationInfoRepo; };
    var DAY_OPTIONS = [7, 30, 90];
    var REVOKE_TEXT = 'Desactivar enlaces';
    var DEFAULT_DAYS = 30;
    var dialogSeq = 0;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function isPreview() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }
    function previewError() {
        return Object.assign(new Error('En la vista de demostración no se comparten cotizaciones.'), { code: 'preview' });
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) { /* se intenta el método clásico */ }
        try {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            var ok = document.execCommand('copy');
            area.remove();
            return !!ok;
        } catch (_) {
            return false;
        }
    }

    /** Enlaces vigentes según el servidor ([] si no se pudo consultar). */
    async function activeLinks(quoteId) {
        try {
            var info = await Repo().info(quoteId);
            return (info && info.share && Array.isArray(info.share.links)) ? info.share.links : [];
        } catch (_) {
            return null;
        }
    }

    /**
     * Enlace público de la cotización: el que este navegador ya creó y sigue
     * vigente, o uno nuevo. { url, expires_at, created }.
     */
    async function ensureLink(quoteId, opts) {
        if (isPreview()) throw previewError();
        var o = opts || {};
        var links = Array.isArray(o.links) ? o.links : await activeLinks(quoteId);
        var cached = Repo().cachedLink(quoteId, links || undefined);
        if (cached && !o.forceNew) return { url: cached.url, expires_at: cached.expires_at, id: cached.id, created: false };
        var body = await Repo().createShareLink(quoteId, o.days || DEFAULT_DAYS);
        return { url: body.url, expires_at: body.link && body.link.expires_at, id: body.link && body.link.id, created: true };
    }

    /** "Copiar enlace". { url, created, copied, expires_at }. */
    async function copyLink(quoteId, opts) {
        var linkPromise = ensureLink(quoteId, opts);
        var copied = false;
        // Safari solo deja escribir en el portapapeles dentro del gesto del
        // usuario: se le pasa la promesa del enlace en vez de esperar la red.
        if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && window.ClipboardItem && window.isSecureContext) {
            var blobPromise = linkPromise.then(function (link) { return new Blob([link.url], { type: 'text/plain' }); });
            blobPromise.catch(function () { /* el error real sale por linkPromise */ });
            try {
                await navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': blobPromise })]);
                copied = true;
            } catch (_) { /* se intenta con writeText / execCommand */ }
        }
        var link = await linkPromise;
        if (!copied) copied = await copyText(link.url);
        return Object.assign({ copied: copied }, link);
    }

    /** Vista de la hoja; incluye el enlace público si este navegador lo tiene. */
    async function sheetView(quoteId) {
        if (isPreview()) throw previewError();
        // El enlace guardado en este navegador solo se imprime si el servidor lo
        // sigue dando por vigente (pudo revocarse desde otro dispositivo).
        var results = await Promise.all([Repo().sheet(quoteId), activeLinks(quoteId)]);
        var body = results[0];
        var cached = Repo().cachedLink(quoteId, results[1] || undefined);
        var sheet = body.sheet || {};
        if (cached) sheet.link = { expires_at: cached.expires_at || null };
        return SM.view(sheet, { url: cached ? cached.url : '' });
    }

    async function downloadPdf(quoteId) {
        var view = await sheetView(quoteId);
        await Sheet().print(view);
        return view;
    }

    async function downloadImage(quoteId) {
        var view = await sheetView(quoteId);
        await Sheet().downloadPng(view);
        return view;
    }

    async function revoke(quoteId) {
        if (isPreview()) throw previewError();
        return Repo().revokeShareLinks(quoteId);
    }

    function linksStatus(links) {
        var list = Array.isArray(links) ? links : [];
        if (!list.length) return 'Todavía no hay un enlace activo.';
        var views = list.reduce(function (sum, l) { return sum + (Number(l.view_count) || 0); }, 0);
        var soonest = list.map(function (l) { return l.expires_at; }).filter(Boolean).sort()[0];
        return (list.length === 1 ? '1 enlace activo' : list.length + ' enlaces activos')
            + (soonest ? ' · vence el ' + SM.dateLong(soonest) : '')
            + ' · ' + (views === 1 ? '1 vista' : views + ' vistas');
    }

    // ------------------------------------------------------------ diálogo
    /**
     * Diálogo "Compartir cotización". opts: { quoteId, clientName, created }
     * (created = recién creada desde la cotización manual).
     */
    function openDialog(opts) {
        var o = opts || {};
        var quoteId = String(o.quoteId || '');
        if (!quoteId) return null;
        dialogSeq += 1;
        var id = 'wqa-' + dialogSeq;
        var returnFocus = document.activeElement;
        var overlay = document.createElement('div');
        overlay.className = 'wo-overlay wqa-overlay';
        var who = o.clientName ? ' a ' + o.clientName : ' a tu cliente';
        overlay.innerHTML =
            '<div class="wo-modal wqa-modal" role="dialog" aria-modal="true" aria-labelledby="' + id + '-title">'
            + '<p class="wqa-eyebrow">' + esc(quoteId) + '</p>'
            + '<h2 class="wo-modal-title" id="' + id + '-title">' + (o.created ? 'Cotización creada. Compártela' : 'Compartir cotización') + '</h2>'
            + '<p class="wqa-copy">Envíale la cotización' + esc(who) + ' aunque no tenga cuenta. Con el enlace puede verla en la web, registrarse y chatear contigo.</p>'
            + '<div class="wqa-block">'
                + '<label class="wo-label" for="' + id + '-url">Enlace público</label>'
                + '<div class="wqa-link-row">'
                    + '<input class="wo-input" id="' + id + '-url" type="text" readonly placeholder="Crea el enlace para copiarlo" aria-describedby="' + id + '-status">'
                    + '<button class="wo-btn wo-btn--accent wo-btn--s" type="button" data-wqa="copy">Copiar enlace</button>'
                + '</div>'
                + '<div class="wqa-link-options">'
                    + '<label class="wqa-inline-label" for="' + id + '-days">Vigencia de un enlace nuevo</label>'
                    + '<select class="wo-select wqa-days" id="' + id + '-days">'
                        + DAY_OPTIONS.map(function (d) { return '<option value="' + d + '"' + (d === DEFAULT_DAYS ? ' selected' : '') + '>' + d + ' días</option>'; }).join('')
                    + '</select>'
                    + '<button class="wqa-text-btn" type="button" data-wqa="revoke" hidden>' + REVOKE_TEXT + '</button>'
                + '</div>'
                + '<p class="wqa-status" id="' + id + '-status" role="status" aria-live="polite">Consultando enlaces…</p>'
            + '</div>'
            + '<div class="wqa-block">'
                + '<p class="wo-label">Enviar como archivo</p>'
                + '<div class="wqa-export">'
                    + '<button class="wo-btn wo-btn--s" type="button" data-wqa="pdf">Descargar PDF</button>'
                    + '<button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-wqa="image">Descargar imagen</button>'
                + '</div>'
                + '<p class="wqa-help">El PDF se guarda desde el diálogo de impresión del navegador: elige «Guardar como PDF». Si ya creaste el enlace, el PDF y la imagen lo incluyen con un código QR.</p>'
            + '</div>'
            + '<p class="wqa-error" role="alert" hidden></p>'
            + '<div class="wo-modal-actions"><button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-wqa="close">Cerrar</button></div>'
            + '</div>';
        document.body.appendChild(overlay);

        var input = overlay.querySelector('#' + id + '-url');
        var status = overlay.querySelector('.wqa-status');
        var errorEl = overlay.querySelector('.wqa-error');
        var revokeBtn = overlay.querySelector('[data-wqa="revoke"]');
        var daysSelect = overlay.querySelector('.wqa-days');
        var links = [];
        var loaded = false;
        var revokeArmed = false;

        function close() {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
            if (typeof o.onClose === 'function') o.onClose();
        }
        function onKey(event) {
            if (event.key === 'Escape') { close(); return; }
            if (event.key !== 'Tab') return;
            // Foco atrapado dentro del diálogo.
            var focusable = Array.prototype.slice.call(overlay.querySelectorAll('button:not([hidden]):not([disabled]), input, select'));
            if (!focusable.length) return;
            var first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        function showError(error) {
            errorEl.textContent = (error && error.message) || 'No pudimos completar la acción.';
            errorEl.hidden = false;
        }
        function setBusy(button, busy) {
            button.disabled = !!busy;
            button.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
        function disarmRevoke() {
            revokeArmed = false;
            revokeBtn.textContent = REVOKE_TEXT;
        }
        function paint() {
            var cached = isPreview() ? null : Repo().cachedLink(quoteId, links);
            input.value = cached ? cached.url : '';
            status.textContent = linksStatus(links) + (links.length && !cached ? ' Se creó desde otro dispositivo: al copiar se genera uno nuevo.' : '');
            revokeBtn.hidden = !links.length;
        }
        async function refresh() {
            if (isPreview()) { status.textContent = 'En la vista de demostración no se crean enlaces.'; return; }
            var fresh = await activeLinks(quoteId);
            links = fresh || [];
            loaded = fresh !== null;
            if (!loaded) status.textContent = 'No pudimos consultar los enlaces. Puedes crear uno igual.';
            else paint();
        }

        async function run(button, task) {
            errorEl.hidden = true;
            setBusy(button, true);
            try { await task(); } catch (error) { showError(error); } finally { setBusy(button, false); }
        }

        overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) close(); });
        overlay.addEventListener('click', function (event) {
            var button = event.target.closest('[data-wqa]');
            if (!button) return;
            var action = button.getAttribute('data-wqa');
            if (action === 'close') { close(); return; }
            if (action !== 'revoke') disarmRevoke();
            if (action === 'copy') {
                run(button, async function () {
                    var result = await copyLink(quoteId, { days: Number(daysSelect.value) || DEFAULT_DAYS, links: loaded ? links : undefined });
                    await refresh();
                    input.value = result.url;
                    input.focus();
                    input.select();
                    status.textContent = (result.copied ? 'Enlace copiado. ' : 'Copia el enlace del campo. ') + linksStatus(links);
                    if (typeof o.onChange === 'function') o.onChange();
                });
            } else if (action === 'revoke') {
                // Dos pasos: los enlaces ya enviados dejan de abrir.
                if (!revokeArmed) {
                    revokeArmed = true;
                    button.textContent = 'Sí, desactivar';
                    status.textContent = 'Los enlaces que ya enviaste dejarán de abrir. Pulsa «Sí, desactivar» para confirmar.';
                    return;
                }
                disarmRevoke();
                run(button, async function () {
                    await revoke(quoteId);
                    await refresh();
                    status.textContent = 'Enlaces desactivados: los que compartiste ya no abren.';
                    if (typeof o.onChange === 'function') o.onChange();
                });
            } else if (action === 'pdf') {
                run(button, function () { return downloadPdf(quoteId); });
            } else if (action === 'image') {
                run(button, function () { return downloadImage(quoteId); });
            }
        });
        document.addEventListener('keydown', onKey);
        window.setTimeout(function () { overlay.querySelector('[data-wqa="copy"]').focus(); }, 30);
        refresh();
        return { close: close, refresh: refresh };
    }

    window.WoQuoteShare = {
        DAY_OPTIONS: DAY_OPTIONS,
        isPreview: isPreview,
        copyText: copyText,
        activeLinks: activeLinks,
        ensureLink: ensureLink,
        copyLink: copyLink,
        sheetView: sheetView,
        downloadPdf: downloadPdf,
        downloadImage: downloadImage,
        revoke: revoke,
        linksStatus: linksStatus,
        openDialog: openDialog
    };
})();
