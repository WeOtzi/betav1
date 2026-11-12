/**
 * WE OTZI - Bloque «Pagos del proyecto» del expediente de cotización
 * -------------------------------------------------------------------
 * Ronda 3 · grupo "pagos". Diseño propio (el Figma 801:580–583 no tiene pagos):
 * mismo esquema que «Sesiones del proyecto» (eyebrow mono, titular, barra de
 * avance y filas con regla). Muestra el saldo pendiente REAL (acordado −
 * cobrado), la seña requerida de la cotización manual (801:556) como
 * pendiente/parcial/pagada, la lista de pagos (ver comprobante · anular) y la
 * acción REGISTRAR PAGO (abre WoPaymentDialog con la cotización fija).
 *
 * Se monta en #qd-payments-slot cuando quotation-detail-figma.js emite
 * `wo:quotation-detail-rendered` ({ quote, stage, readOnly, user }). Si la
 * tabla quotation_payments no existe todavía (migración sin aplicar), el
 * bloque no se muestra.
 */
(function () {
    'use strict';

    var M = window.WoPaymentsModel;
    var STAGES = ['responded', 'approved', 'in_progress', 'ready', 'delivered', 'completed', 'dispute'];
    var cache = { key: null, payments: [], manual: null, loading: null, available: null };
    var last = null;

    function repo() { return window.WeotziData && window.WeotziData.QuotationPayments; }
    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function convertFn() {
        var c = window.WeOtziCurrency || window.CurrencyUtils;
        return c && typeof c.convert === 'function' ? function (a, f, t) { return c.convert(a, f, t); } : null;
    }
    function toast(msg, error) {
        var el = document.getElementById('qd-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('is-error', !!error);
        el.hidden = false;
        clearTimeout(toast.t);
        toast.t = setTimeout(function () { el.hidden = true; }, 4200);
    }

    async function load(quote, force) {
        var R = repo();
        var key = String(quote.id);
        if (!force && cache.key === key && !cache.loading) return;
        if (cache.available === null) cache.available = R ? await R.isAvailable() : false;
        if (!cache.available) return;
        cache.key = key;
        cache.loading = (async function () {
            var payments = [];
            var manual = null;
            try { payments = await R.listForQuotation(quote.id); } catch (e) { console.warn('[pagos] lista:', e && e.message); }
            try {
                var rows = await R.manualQuotesFor([quote.quote_id]);
                manual = rows[0] || null;
            } catch (e) { /* sin seña */ }
            cache.payments = payments.map(M.normalize);
            cache.manual = manual;
        }());
        await cache.loading;
        cache.loading = null;
    }

    function rowHtml(p, readOnly) {
        var meta = [M.formatDate(p.paidOn), M.METHOD_LABELS[p.method]].concat(p.note ? [p.note] : []).join(' · ');
        var actions = [];
        if (p.receiptPath) actions.push('<button type="button" class="qpp-link" data-qpp-receipt="' + esc(p.id) + '">Ver comprobante</button>');
        if (!readOnly) actions.push('<button type="button" class="qpp-link is-danger" data-qpp-void="' + esc(p.id) + '" aria-label="Anular el pago de ' + esc(M.formatMoney(p.amount, p.currency)) + '">Anular</button>');
        return '<li class="qpp-row">' +
            '<div class="qpp-row-main"><p class="qpp-row-kind">' + esc(M.KIND_LABELS[p.kind]) + '</p>' +
            '<p class="qpp-row-title">' + esc(M.KIND_EVENT[p.kind] || 'Pago recibido') + '</p>' +
            '<p class="qpp-row-meta">' + esc(meta) + '</p></div>' +
            '<span class="qpp-row-amount">' + esc(M.formatMoney(p.amount, p.currency)) + '</span>' +
            '<div class="qpp-row-actions">' + actions.join('') + '</div>' +
        '</li>';
    }

    function blockHtml(quote, readOnly) {
        var s = M.summarize(quote, cache.manual, cache.payments, { convert: convertFn() });
        var money = M.formatMoney;
        var title;
        if (s.total == null) title = s.count ? 'Pagos registrados' : 'Sin pagos registrados';
        else if (s.balance > 0) title = 'Saldo pendiente ' + money(s.balance, s.currency);
        else title = 'Pagado en su totalidad';
        var countTxt = s.count ? s.count + (s.count === 1 ? ' pago' : ' pagos') + ' · último ' + M.formatDate(s.lastPaidOn) : 'Todavía no registraste pagos';
        var depositCell = s.deposit
            ? '<div><dt>Seña requerida</dt><dd>' + esc(money(s.deposit.required, s.deposit.currency)) +
              '<small><span class="wqp-chip wqp-chip--' + esc(s.deposit.status) + '">' + esc(M.depositLabel(s.deposit.status)) + '</span></small></dd></div>'
            : '<div><dt>Seña requerida</dt><dd>—<small>Sin seña pactada</small></dd></div>';
        var others = s.others.length
            ? '<p class="qpp-note">Además cobraste ' + esc(s.others.map(function (o) { return money(o.amount, o.currency); }).join(' · ')) + ': sin tipo de cambio, no se descuenta del saldo.</p>'
            : '';
        var over = s.overpaid ? '<p class="qpp-note">Lo registrado supera lo acordado por ' + esc(money(s.overpaid, s.currency)) + '.</p>' : '';
        return '<section class="qpp" id="qd-payments" aria-labelledby="qpp-title">' +
            '<div class="qpp-head"><div>' +
                '<p class="qpp-eyebrow">Pagos del proyecto</p>' +
                '<h2 class="qpp-title" id="qpp-title">' + esc(title) + '</h2>' +
                '<p class="qpp-summary">' + esc(countTxt) + '</p>' +
            '</div><div class="qpp-actions">' +
                '<button type="button" class="wqp-btn is-ink" data-qpp-add aria-haspopup="dialog"' + (readOnly ? ' disabled title="Vista de estado simulada"' : '') + '>Registrar pago</button>' +
            '</div></div>' +
            (s.total ? '<div class="qpp-bar" role="progressbar" aria-label="Cobrado del total acordado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + s.percent + '"><span class="' + (s.percent >= 100 ? 'is-done' : '') + '" style="width:' + s.percent + '%"></span></div>' : '') +
            '<dl class="qpp-facts">' +
                '<div><dt>Acordado</dt><dd>' + esc(s.total != null ? money(s.total, s.currency) : '—') + '</dd></div>' +
                '<div><dt>Cobrado</dt><dd>' + esc(money(s.paid, s.currency)) + '</dd></div>' +
                '<div><dt>Saldo pendiente</dt><dd class="' + (s.balance ? 'is-due' : '') + '">' + esc(s.balance != null ? money(s.balance, s.currency) : '—') + '</dd></div>' +
                depositCell +
            '</dl>' +
            (s.count ? '<ul class="qpp-list">' + s.payments.map(function (p) { return rowHtml(p, readOnly); }).join('') + '</ul>' : '') +
            others + over +
            '<p class="qpp-note">Los pagos que registrás son cobros tuyos por fuera de We Ötzi: los ves en tu Wallet como «Cobrado por fuera» y no suman a tu saldo retirable.</p>' +
        '</section>';
    }

    function render() {
        var slot = document.getElementById('qd-payments-slot');
        if (!slot || !last) return;
        var quote = last.quote;
        if (!quote || STAGES.indexOf(last.stage) === -1 || !cache.available || cache.key !== String(quote.id)) {
            slot.innerHTML = '';
            return;
        }
        slot.innerHTML = blockHtml(quote, last.readOnly);
        wire(slot);
        // Tras guardar/anular, el foco vuelve al bloque (el botón original se repintó).
        if (refocus) {
            refocus = false;
            var title = slot.querySelector('#qpp-title');
            if (title) { title.setAttribute('tabindex', '-1'); try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); } }
        }
    }
    var refocus = false;

    function wire(slot) {
        var add = slot.querySelector('[data-qpp-add]');
        if (add) add.addEventListener('click', function () {
            if (!window.WoPaymentDialog) return;
            window.WoPaymentDialog.open({
                user: last.user, quotationId: last.quote.id, quote: last.quote, trigger: add,
                toast: function (msg, kind) { toast(msg, kind === 'error'); }
            });
        });
        slot.querySelectorAll('[data-qpp-receipt]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var p = cache.payments.find(function (x) { return x.id === btn.getAttribute('data-qpp-receipt'); });
                if (!p) return;
                try { window.open(await repo().receiptUrl(p.receiptPath), '_blank', 'noopener'); }
                catch (e) { toast(e.message || 'No pudimos abrir el comprobante.', true); }
            });
        });
        slot.querySelectorAll('[data-qpp-void]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                if (btn.getAttribute('data-confirm') !== '1') {
                    btn.setAttribute('data-confirm', '1');
                    btn.textContent = 'Confirmar anulación';
                    setTimeout(function () {
                        if (document.contains(btn)) { btn.removeAttribute('data-confirm'); btn.textContent = 'Anular'; }
                    }, 4000);
                    return;
                }
                btn.disabled = true;
                try {
                    await repo().void(btn.getAttribute('data-qpp-void'));
                    toast('Pago anulado. En tu Wallet queda como cancelado.');
                    try { document.dispatchEvent(new CustomEvent('weotzi:payments-changed', { detail: { voided: true } })); } catch (e) { /* noop */ }
                } catch (e) {
                    toast((repo().friendly && repo().friendly(e, 'No pudimos anular el pago.')) || 'No pudimos anular el pago.', true);
                    btn.disabled = false;
                }
            });
        });
    }

    document.addEventListener('wo:quotation-detail-rendered', async function (e) {
        if (!M) return;
        last = e.detail || null;
        if (!last || !last.quote) return;
        render();
        if (STAGES.indexOf(last.stage) === -1) return;
        await load(last.quote, false);
        render();
        openFromQuery();
    });

    // ?modal=registrar-pago abre el modal (QA), una sola vez y con el bloque listo.
    var qaDone = false;
    function openFromQuery() {
        if (qaDone) return;
        qaDone = true;
        if (new URLSearchParams(window.location.search).get('modal') !== 'registrar-pago') return;
        var add = document.querySelector('[data-qpp-add]');
        if (add && !add.disabled) add.click();
    }

    document.addEventListener('weotzi:payments-changed', async function () {
        if (!last || !last.quote) return;
        await load(last.quote, true);
        refocus = true;
        render();
    });
}());
