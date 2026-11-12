/**
 * WE OTZI - Dashboard del artista · pagos (ronda 3 · grupo "pagos")
 * -----------------------------------------------------------------
 * Figma 24:1425:
 *   - Acción rápida REGISTRAR PAGO → abre el modal propio «Registrar pago»
 *     (quotation-payment-dialog.js) en vez de llevar al Wallet.
 *   - Actividad reciente «Pago recibido · Mateo · $180»: fuente 'payments'
 *     registrada en WeotziData.DashboardActivity (dashboard-repo.js), sin tocar
 *     dashboard-redesign.js.
 * QA: /artist/dashboard?modal=registrar-pago abre el modal al cargar.
 */
(function () {
    'use strict';

    var M = window.WoPaymentsModel;

    function repo() { return window.WeotziData && window.WeotziData.QuotationPayments; }

    // Mismo formato que money() del dashboard ("$180"); sin símbolo conocido,
    // el código ("COP 180.000") para no confundir monedas.
    function money(amount, code) {
        var c = window.WeOtziCurrency;
        try {
            var meta = c && typeof c.get === 'function' ? c.get(code) : null;
            if (meta && meta.symbol) return meta.symbol + Math.round(Number(amount) || 0).toLocaleString('es-AR');
        } catch (e) { /* formato por defecto */ }
        return M.formatMoney(amount, code);
    }

    function registerActivity() {
        var A = window.WeotziData && window.WeotziData.DashboardActivity;
        if (!A || typeof A.registerSource !== 'function' || !M) return;
        A.registerSource('payments', async function (ctx) {
            var R = repo();
            if (!R || !ctx || !ctx.artistId) return [];
            if (!(await R.isAvailable())) return [];
            var since = ctx.since ? M.isoDateLocal(new Date(ctx.since)) : null;
            var rows = await R.listForArtist(ctx.artistId, { since: since, limit: 50 });
            return M.activityEvents(rows.map(M.normalize), { money: money }).map(function (ev) {
                return {
                    type: 'payment',
                    text: ev.txt,
                    created_at: ev.when,
                    href: ev.quoteId ? '/my-quotations/detail?id=' + encodeURIComponent(ev.quoteId) : null
                };
            });
        });
    }

    async function currentUser() {
        if (window.currentUser && window.currentUser.id) return window.currentUser;
        try {
            var client = window.WeotziData && window.WeotziData.getClient && window.WeotziData.getClient();
            var res = client ? await client.auth.getSession() : null;
            return res && res.data && res.data.session ? res.data.session.user : null;
        } catch (e) { return null; }
    }

    async function openDialog(trigger) {
        if (!window.WoPaymentDialog) return;
        var user = await currentUser();
        var artist = window.artistData || {};
        window.WoPaymentDialog.open({
            user: user,
            trigger: trigger || document.getElementById('wod-register-payment'),
            currency: artist.preferred_display_currency || artist.session_price_currency || 'USD'
        });
    }

    function wireButton() {
        var btn = document.getElementById('wod-register-payment');
        if (!btn || btn.dataset.wqpWired) return;
        btn.dataset.wqpWired = '1';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            openDialog(btn);
        });
    }

    // Un pago nuevo o anulado refresca la actividad del dashboard.
    document.addEventListener('weotzi:payments-changed', function () {
        try { document.dispatchEvent(new CustomEvent('weotzi:dashboard-activity-refresh', { detail: { source: 'payments' } })); } catch (e) { /* noop */ }
    });

    function openFromQuery() {
        if (new URLSearchParams(window.location.search).get('modal') !== 'registrar-pago') return;
        var tries = 0;
        var t = setInterval(function () {
            if ((window.currentUser && window.currentUser.id) || ++tries > 40) {
                clearInterval(t);
                openDialog();
            }
        }, 250);
    }

    function init() {
        registerActivity();
        wireButton();
        openFromQuery();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
}());
