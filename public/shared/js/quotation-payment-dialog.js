/**
 * WE OTZI - Modal «Registrar pago» (diseño propio sobre el DS)
 * ------------------------------------------------------------
 * Ronda 3 · grupo "pagos". El Figma (24:1425) tiene la acción rápida REGISTRAR
 * PAGO pero no el modal: copia el lenguaje del modal de recordatorios
 * (801:560: cabecera tinta con eyebrow amarillo, labels mono, segmentados,
 * pie con CANCELAR + acción accent). Estilos: /shared/css/quotation-payments.css.
 *
 * Uso:
 *   WoPaymentDialog.open({ user, quotationId?, trigger?, onSaved?(row), toast?(msg, kind) })
 *     · sin quotationId muestra el selector de cotizaciones activas (dashboard);
 *     · con quotationId la deja fija (detalle de cotización).
 * Al guardar emite `weotzi:payments-changed` en document ({ detail: { payment } }).
 *
 * Datos: WeotziData.QuotationPayments (quotation-payments-repo.js) y
 * WoPaymentsModel (quotation-payments-model.js). Montos > 0, hasta 2 decimales,
 * moneda de las 24 de CurrencyUtils.COUNTRY_CURRENCIES, fecha no futura; la RPC
 * vuelve a validar todo en la base.
 */
(function () {
    'use strict';

    var M = window.WoPaymentsModel;
    var ICON = {
        x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
        paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
    };
    var STATUS_LABELS = {
        responded: 'Respondida', client_approved: 'Aprobada', in_progress: 'En progreso', en_progreso: 'En progreso',
        artist_completed: 'Lista para cliente', completed: 'Completada'
    };

    var state = null;
    var els = { overlay: null, toast: null };

    function repo() { return window.WeotziData && window.WeotziData.QuotationPayments; }
    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function svg(name) {
        return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICON[name] || '') + '</svg>';
    }
    function convertFn() {
        var c = window.WeOtziCurrency || window.CurrencyUtils;
        return c && typeof c.convert === 'function' ? function (a, f, t) { return c.convert(a, f, t); } : null;
    }
    function currencyList() {
        var c = window.WeOtziCurrency || window.CurrencyUtils;
        var list = c && Array.isArray(c.COUNTRY_CURRENCIES) ? c.COUNTRY_CURRENCIES : null;
        if (list && list.length) return list.map(function (x) { return { code: x.code, name: x.name }; });
        return M.CURRENCY_CODES.map(function (code) { return { code: code, name: code }; });
    }

    function toast(msg, kind) {
        if (state && typeof state.opts.toast === 'function') { state.opts.toast(msg, kind); return; }
        if (!els.toast) {
            els.toast = document.createElement('div');
            els.toast.className = 'wqp-toast';
            els.toast.setAttribute('role', 'status');
            els.toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(els.toast);
        }
        els.toast.textContent = msg;
        els.toast.classList.toggle('is-error', kind === 'error');
        els.toast.hidden = false;
        clearTimeout(els.toastTimer);
        els.toastTimer = setTimeout(function () { if (els.toast) els.toast.hidden = true; }, 4200);
    }

    /* ------------------------------ overlay ------------------------------ */
    function ensureOverlay() {
        if (els.overlay) return els.overlay;
        var ov = document.createElement('div');
        ov.className = 'wqp-ov';
        ov.hidden = true;
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
        ov.addEventListener('keydown', onKeydown);
        document.body.appendChild(ov);
        els.overlay = ov;
        return ov;
    }

    function onKeydown(e) {
        if (!state) return;
        if (e.key === 'Escape') {
            // El calendario/listado propio de wo-controls cierra primero.
            if (e.defaultPrevented) return;
            e.preventDefault();
            close();
            return;
        }
        if (e.key !== 'Tab') return;
        var focusables = Array.prototype.filter.call(
            els.overlay.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'),
            function (el) { return !el.disabled && el.offsetParent !== null; }
        );
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function placeBelowTopbar() {
        var bar = document.querySelector('weotzi-product-nav .wo-org-product-nav') || document.querySelector('weotzi-product-nav');
        var bottom = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
        document.documentElement.style.setProperty('--wqp-top', Math.round(bottom) + 'px');
    }

    function close() {
        if (!els.overlay) return;
        els.overlay.hidden = true;
        els.overlay.innerHTML = '';
        document.body.classList.remove('wqp-open');
        var trigger = state && state.opts.trigger;
        state = null;
        if (trigger && document.contains(trigger)) { try { trigger.focus(); } catch (e) { /* noop */ } }
    }

    /* ------------------------------ render ------------------------------ */
    function segHtml(name, options, current, label) {
        return '<div class="wqp-seg wqp-seg--' + options.length + '" role="radiogroup" aria-label="' + esc(label) + '" data-seg="' + name + '">' +
            options.map(function (o) {
                var on = o[0] === current;
                return '<button type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on ? '0' : '-1') + '" class="wqp-seg-btn' + (on ? ' is-on' : '') +
                    '" data-value="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
            }).join('') + '</div>';
    }

    function quoteLabel(q) {
        var who = q.client_full_name || 'Cliente';
        var ref = q.quote_id ? ' · ' + q.quote_id : '';
        var st = STATUS_LABELS[q.quote_status] ? ' · ' + STATUS_LABELS[q.quote_status] : '';
        return who + ref + st;
    }

    function summaryHtml() {
        var s = state.summary;
        if (!s) return '';
        var money = M.formatMoney;
        var rows = [];
        rows.push('<div><dt>Acordado</dt><dd>' + esc(s.total != null ? money(s.total, s.currency) : 'Sin monto') + '</dd></div>');
        rows.push('<div><dt>Cobrado</dt><dd>' + esc(money(s.paid, s.currency)) + '</dd></div>');
        rows.push('<div><dt>Saldo</dt><dd class="is-strong">' + esc(s.balance != null ? money(s.balance, s.currency) : '—') + '</dd></div>');
        var dep = s.deposit
            ? '<p class="wqp-sum-dep">Seña requerida ' + esc(money(s.deposit.required, s.deposit.currency)) +
              (s.deposit.pct ? ' (' + esc(String(s.deposit.pct).replace('.', ',')) + '%)' : '') +
              ' · <span class="wqp-chip wqp-chip--' + esc(s.deposit.status) + '">' + esc(M.depositLabel(s.deposit.status)) + '</span></p>'
            : '';
        var others = s.others && s.others.length
            ? '<p class="wqp-sum-note">Además: ' + esc(s.others.map(function (o) { return money(o.amount, o.currency); }).join(' · ')) + ' (sin tipo de cambio)</p>'
            : '';
        return '<dl class="wqp-sum-grid">' + rows.join('') + '</dl>' + dep + others;
    }

    function formHtml() {
        var o = state.opts;
        var today = M.isoDateLocal(new Date());
        var quotePart;
        if (state.fixedQuote) {
            quotePart = '<p class="wqp-label">COTIZACIÓN</p><p class="wqp-fixed">' + esc(quoteLabel(state.fixedQuote)) + '</p>';
        } else {
            quotePart = '<label class="wqp-label" for="wqp-quote">COTIZACIÓN</label>' +
                '<select class="wqp-input" id="wqp-quote" name="quotationId" required data-autofocus>' +
                '<option value="" disabled' + (state.quotationId ? '' : ' selected') + '>Elegí la cotización</option>' +
                state.quotes.map(function (q) {
                    return '<option value="' + esc(q.id) + '"' + (String(q.id) === String(state.quotationId) ? ' selected' : '') + '>' + esc(quoteLabel(q)) + '</option>';
                }).join('') +
                '</select>';
        }
        var currencies = currencyList();
        return '<form class="wqp-body" novalidate>' +
            quotePart +
            '<div class="wqp-sum" id="wqp-sum" aria-live="polite">' + summaryHtml() + '</div>' +
            '<p class="wqp-label" id="wqp-kind-l">TIPO DE PAGO</p>' +
            segHtml('kind', M.KINDS.map(function (k) { return [k, M.KIND_LABELS[k]]; }), state.kind, 'Tipo de pago') +
            '<div class="wqp-row">' +
                '<div class="wqp-col wqp-col--grow"><label class="wqp-label" for="wqp-amount">MONTO</label>' +
                '<input class="wqp-input wqp-input--num" id="wqp-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" aria-describedby="wqp-err-amount"' +
                (state.fixedQuote ? ' data-autofocus' : '') + ' value="' + esc(state.amountDraft || '') + '">' +
                '<p class="wqp-field-err" id="wqp-err-amount" hidden></p></div>' +
                '<div class="wqp-col"><label class="wqp-label" for="wqp-currency">MONEDA</label>' +
                '<select class="wqp-input" id="wqp-currency" name="currency">' +
                currencies.map(function (c) { return '<option value="' + esc(c.code) + '"' + (c.code === state.currency ? ' selected' : '') + '>' + esc(c.code) + '</option>'; }).join('') +
                '</select></div>' +
            '</div>' +
            '<label class="wqp-label" for="wqp-date">FECHA DEL PAGO</label>' +
            '<input class="wqp-input" type="date" id="wqp-date" name="paidOn" max="' + esc(today) + '" min="2015-01-01" value="' + esc(today) + '" aria-describedby="wqp-err-paidOn">' +
            '<p class="wqp-field-err" id="wqp-err-paidOn" hidden></p>' +
            '<p class="wqp-label">MEDIO</p>' +
            segHtml('method', M.METHODS.map(function (m) { return [m, M.METHOD_LABELS[m]]; }), state.method, 'Medio de pago') +
            '<label class="wqp-label" for="wqp-note">NOTA <span class="wqp-opt">· opcional</span></label>' +
            '<textarea class="wqp-input wqp-textarea" id="wqp-note" name="note" rows="3" maxlength="' + M.MAX_NOTE + '" placeholder="Ej.: seña en efectivo, en el estudio"></textarea>' +
            '<p class="wqp-label">COMPROBANTE <span class="wqp-opt">· opcional</span></p>' +
            '<label class="wqp-attach">' + svg('paperclip') + '<span id="wqp-file-name">ADJUNTAR IMAGEN O PDF</span>' +
                '<input type="file" name="file" id="wqp-file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" class="wo-sr-only"></label>' +
            '<p class="wqp-field-err" id="wqp-err-file" hidden></p>' +
            '<p class="wqp-info">' + svg('info') + '<span>Es un registro tuyo de lo que cobraste por fuera: no pasa por We Ötzi y no suma a tu saldo retirable del Wallet.</span></p>' +
            '<p class="wqp-error" role="alert" hidden></p>' +
            '<footer class="wqp-foot">' +
                '<button type="button" class="wqp-btn is-ghost" data-cancel>CANCELAR</button>' +
                '<button type="submit" class="wqp-btn is-accent" data-submit>GUARDAR PAGO</button>' +
            '</footer>' +
        '</form>';
    }

    function shellHtml(inner, label) {
        return '<div class="wqp-modal" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="wqp-title">' +
            '<header class="wqp-head"><p class="wqp-cap" id="wqp-title">' + esc(label) + '</p>' +
            '<button type="button" class="wqp-x" data-close aria-label="Cerrar">' + svg('x') + '</button></header>' +
            inner + '</div>';
    }

    function messageHtml(text) {
        return '<div class="wqp-body"><p class="wqp-empty">' + esc(text) + '</p>' +
            '<footer class="wqp-foot"><button type="button" class="wqp-btn is-ink" data-cancel>CERRAR</button></footer></div>';
    }

    function mount(inner) {
        placeBelowTopbar();
        var ov = ensureOverlay();
        ov.innerHTML = shellHtml(inner, 'REGISTRAR PAGO');
        ov.hidden = false;
        document.body.classList.add('wqp-open');
        ov.querySelectorAll('[data-close], [data-cancel]').forEach(function (b) { b.addEventListener('click', close); });
        if (window.WoControls && typeof window.WoControls.enhance === 'function') {
            try { window.WoControls.enhance(ov); } catch (e) { /* controles nativos */ }
        }
        var first = ov.querySelector('[data-autofocus]') || ov.querySelector('.wqp-modal');
        setTimeout(function () { try { first.focus(); } catch (e) { /* noop */ } }, 30);
        return ov.firstChild;
    }

    /* ------------------------------ lógica ------------------------------ */
    function recompute() {
        var q = state.fixedQuote || state.quotes.find(function (x) { return String(x.id) === String(state.quotationId); }) || null;
        state.quote = q;
        if (!q) { state.summary = null; return; }
        var manual = state.manualByQuote[String(q.quote_id)] || null;
        var payments = (state.paymentsByQuote[String(q.id)] || []).map(M.normalize);
        state.summary = M.summarize(q, manual, payments, { convert: convertFn() });
    }

    function applySuggestion(form, touchCurrency) {
        var s = state.summary;
        if (!s) return;
        if (touchCurrency) {
            state.currency = s.deposit && state.kind === 'deposit' ? s.deposit.currency : s.currency;
            var sel = form.querySelector('#wqp-currency');
            if (sel) { sel.value = state.currency; if (window.WoControls && window.WoControls.refresh) try { window.WoControls.refresh(sel); } catch (e) { /* noop */ } }
        }
        var amountEl = form.querySelector('#wqp-amount');
        if (amountEl && !state.amountTouched) {
            var sug = M.suggestAmount(s, state.kind);
            amountEl.value = sug ? String(sug).replace('.', ',') : '';
        }
    }

    async function loadQuoteData(ids, quoteIds) {
        var R = repo();
        var payments = [];
        var manual = [];
        try {
            payments = await R.listForArtist(state.opts.user.id, { quotationIds: ids, limit: 500 });
        } catch (e) { console.warn('[pagos] pagos:', e && e.message); }
        try {
            manual = await R.manualQuotesFor(quoteIds);
        } catch (e) { console.warn('[pagos] cotización manual:', e && e.message); }
        state.paymentsByQuote = {};
        payments.forEach(function (p) { (state.paymentsByQuote[String(p.quotation_id)] = state.paymentsByQuote[String(p.quotation_id)] || []).push(p); });
        state.manualByQuote = {};
        manual.forEach(function (m) { state.manualByQuote[String(m.quote_id)] = m; });
    }

    function setSeg(form, name, value) {
        form.querySelectorAll('[data-seg="' + name + '"] .wqp-seg-btn').forEach(function (b) {
            var on = b.getAttribute('data-value') === value;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', String(on));
            b.setAttribute('tabindex', on ? '0' : '-1');
        });
    }

    function wireSeg(form, name, onChange) {
        var group = form.querySelector('[data-seg="' + name + '"]');
        if (!group) return;
        group.addEventListener('click', function (e) {
            var b = e.target.closest('.wqp-seg-btn');
            if (!b) return;
            onChange(b.getAttribute('data-value'));
            setSeg(form, name, b.getAttribute('data-value'));
        });
        group.addEventListener('keydown', function (e) {
            if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].indexOf(e.key) === -1) return;
            e.preventDefault();
            var btns = Array.prototype.slice.call(group.querySelectorAll('.wqp-seg-btn'));
            var idx = btns.findIndex(function (b) { return b.classList.contains('is-on'); });
            var next = btns[(idx + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length];
            onChange(next.getAttribute('data-value'));
            setSeg(form, name, next.getAttribute('data-value'));
            next.focus();
        });
    }

    function showErrors(form, errors) {
        ['amount', 'paidOn', 'file'].forEach(function (f) {
            var el = form.querySelector('#wqp-err-' + f);
            if (!el) return;
            el.textContent = errors[f] || '';
            el.hidden = !errors[f];
        });
        var amount = form.querySelector('#wqp-amount');
        if (amount) amount.setAttribute('aria-invalid', errors.amount ? 'true' : 'false');
        var general = form.querySelector('.wqp-error');
        var other = errors.quotationId || errors.kind || errors.method || errors.currency || errors.note || errors.general || '';
        general.textContent = other;
        general.hidden = !other;
    }

    function wireForm(modal) {
        var form = modal.querySelector('form');
        var quoteSel = form.querySelector('#wqp-quote');
        if (quoteSel) {
            quoteSel.addEventListener('change', function () {
                state.quotationId = quoteSel.value;
                state.confirmOver = false;
                recompute();
                state.kind = M.suggestKind(state.summary);
                setSeg(form, 'kind', state.kind);
                form.querySelector('#wqp-sum').innerHTML = summaryHtml();
                applySuggestion(form, true);
            });
        }
        wireSeg(form, 'kind', function (v) {
            state.kind = v;
            state.confirmOver = false;
            applySuggestion(form, false);
        });
        wireSeg(form, 'method', function (v) { state.method = v; });
        form.querySelector('#wqp-amount').addEventListener('input', function () { state.amountTouched = true; state.confirmOver = false; });
        form.querySelector('#wqp-currency').addEventListener('change', function (e) { state.currency = e.target.value; state.confirmOver = false; });
        var file = form.querySelector('#wqp-file');
        file.addEventListener('change', function () {
            var f = file.files && file.files[0];
            var err = M.validateFile(f);
            form.querySelector('#wqp-file-name').textContent = f ? f.name : 'ADJUNTAR IMAGEN O PDF';
            showErrors(form, err ? { file: err } : {});
        });
        form.addEventListener('submit', function (e) { e.preventDefault(); submit(form); });
        applySuggestion(form, false);
    }

    async function submit(form) {
        if (state.busy) return;
        var fileInput = form.querySelector('#wqp-file');
        var input = {
            quotationId: state.quote ? state.quote.id : null,
            kind: state.kind,
            method: state.method,
            amount: form.querySelector('#wqp-amount').value,
            currency: form.querySelector('#wqp-currency').value,
            paidOn: form.querySelector('#wqp-date').value,
            note: form.querySelector('#wqp-note').value,
            file: fileInput.files && fileInput.files[0] || null
        };
        var check = M.validate(input, {});
        if (!check.ok) {
            showErrors(form, check.errors);
            var firstBad = form.querySelector('[aria-invalid="true"]') || (check.errors.quotationId && form.querySelector('#wqp-quote'));
            if (firstBad) firstBad.focus();
            return;
        }
        var v = check.value;
        // Más que el saldo en la misma moneda: se confirma con un segundo toque.
        var s = state.summary;
        if (s && s.balance != null && v.currency === s.currency && v.amount - s.balance > 0.005 && !state.confirmOver) {
            state.confirmOver = true;
            showErrors(form, { general: 'El monto supera el saldo pendiente (' + M.formatMoney(s.balance, s.currency) + '). Si es correcto, tocá GUARDAR PAGO otra vez.' });
            return;
        }
        showErrors(form, {});
        state.busy = true;
        var btn = form.querySelector('[data-submit]');
        btn.disabled = true;
        btn.textContent = 'GUARDANDO…';
        var R = repo();
        var receipt = null;
        try {
            if (input.file) receipt = await R.uploadReceipt(state.opts.user.id, v.quotationId, input.file);
            var row = await R.record(Object.assign({}, v, { receipt: receipt }));
            var saved = row || v;
            try { document.dispatchEvent(new CustomEvent('weotzi:payments-changed', { detail: { payment: saved } })); } catch (e) { /* noop */ }
            var cb = state.opts.onSaved;
            toast((v.kind === 'deposit' ? 'Seña registrada: ' : 'Pago registrado: ') + M.formatMoney(v.amount, v.currency) + '.');
            close();
            if (typeof cb === 'function') cb(saved);
        } catch (err) {
            if (receipt && receipt.path) R.removeReceipt(receipt.path).catch(function () { /* best-effort */ });
            console.warn('[pagos] registrar:', err && err.message);
            showErrors(form, { general: (R.friendly ? R.friendly(err) : (err && err.message)) || 'No pudimos guardar el pago.' });
            btn.disabled = false;
            btn.textContent = 'GUARDAR PAGO';
        } finally {
            if (state) state.busy = false;
        }
    }

    /**
     * opts: { user, quotationId?, quote?, trigger?, onSaved?, toast?, currency? }
     */
    async function open(opts) {
        opts = opts || {};
        if (!M) { console.error('[pagos] quotation-payments-model.js no cargó.'); return; }
        state = {
            opts: opts, quotes: [], fixedQuote: null, quotationId: opts.quotationId || null,
            kind: 'deposit', method: 'cash', currency: String(opts.currency || 'USD').toUpperCase(),
            paymentsByQuote: {}, manualByQuote: {}, busy: false, amountTouched: false, confirmOver: false
        };
        var R = repo();
        if (!opts.user || !R) { mount(messageHtml('No pudimos abrir el registro de pagos. Recargá la página.')); return; }
        mount('<div class="wqp-body"><p class="wqp-empty">Cargando…</p></div>');
        var available = await R.isAvailable();
        if (!state) return;
        if (!available) {
            mount(messageHtml('El registro de pagos todavía no está activo en tu cuenta. Pronto vas a poder anotar señas y pagos de tus clientes desde acá.'));
            return;
        }
        try {
            if (opts.quotationId) {
                var q = opts.quote || await R.getQuote(opts.quotationId);
                if (!q || !M.isPayable(q)) {
                    mount(messageHtml('Podés registrar pagos cuando la cotización está respondida o tiene un acuerdo.'));
                    return;
                }
                state.fixedQuote = q;
                state.quotationId = q.id;
            } else {
                state.quotes = (await R.listPayableQuotes(opts.user.id)).filter(M.isPayable);
                if (!state.quotes.length) {
                    mount(messageHtml('Todavía no tenés cotizaciones respondidas o aprobadas para registrar un pago.'));
                    return;
                }
                if (state.quotes.length === 1) state.quotationId = state.quotes[0].id;
            }
            var list = state.fixedQuote ? [state.fixedQuote] : state.quotes;
            await loadQuoteData(list.map(function (x) { return x.id; }), list.map(function (x) { return x.quote_id; }));
        } catch (err) {
            console.warn('[pagos] abrir:', err && err.message);
            if (state) mount(messageHtml('No pudimos cargar tus cotizaciones. Probá de nuevo.'));
            return;
        }
        if (!state) return;
        recompute();
        if (state.summary) {
            state.kind = M.suggestKind(state.summary);
            state.currency = state.summary.deposit && state.kind === 'deposit' ? state.summary.deposit.currency : state.summary.currency;
        }
        var modal = mount(formHtml());
        wireForm(modal);
    }

    window.WoPaymentDialog = { open: open, close: close, isOpen: function () { return !!state; } };
}());
