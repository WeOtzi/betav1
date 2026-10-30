// ============================================
// We Ötzi Wallet · /artist/account#cobros
// Figma final oct 2026: 801:568 (wallet y movimientos), 801:569 (agregar
// destino de retiro) y 801:570 (We Ötzi Card · aviso de disponibilidad).
//
// Datos (window.WeotziData, account-repo.js):
//   - PayoutDestinations / WalletMovements / CardWaitlist: tablas nuevas de la
//     migración NO aplicada 20261028150000_artist_wallet.sql. Si no existen,
//     la sección degrada al "modo derivado".
//   - Modo derivado: movimientos calculados desde artist_financial_entries (si
//     existe) y las cotizaciones del artista (reservas aprobadas / terminadas).
//     Sin backend de pagos no se pueden pedir retiros.
//   - Billing (artist_billing_profiles): "Ver datos fiscales".
// Lógica pura en wallet-model.js (WoWalletModel). Estados por URL para QA:
//   ?modal=agregar-destino · ?modal=card · ?modal=datos-fiscales  (con #cobros)
// ============================================

(function () {
    'use strict';

    const M = window.WoWalletModel;
    const LIST_LIMIT = { releases: 3, activity: 5 };
    const AVATAR_TONES = ['yellow', 'blue', 'ink'];

    let ctx = null;
    let D = null;
    let state = {
        mode: 'live',             // live | derived
        movements: [],
        destinations: [],
        destinationsAvailable: false,
        currency: 'USD',
        filter: 'todos',
        showAllReleases: false,
        showAllActivity: false,
        waitlist: null,
        selectedMethod: 'lemon',
        pendingWithdrawal: null
    };

    const $ = (id) => document.getElementById(id);

    function esc(value) { return ctx.esc(value); }
    function toast(msg, ok) { ctx.toast(msg, ok); }

    // Modo asistido (wo-assist.js): el paso "retiro" se refresca al cambiar destinos.
    function assistRefresh() {
        try {
            document.dispatchEvent(new CustomEvent('wo:assist-refresh', { detail: { section: 'cobros' } }));
        } catch (err) { console.warn('[wallet] wo:assist-refresh:', err); }
    }

    async function init(context) {
        ctx = context;
        D = ctx.D;
        if (!M) { console.error('[wallet] wallet-model.js no cargado'); return; }
        wire();
        await reload();
        openFromQuery();
    }

    async function reload() {
        await Promise.all([loadDestinations(), loadMovements(), loadWaitlist()]);
        render();
    }

    /* ------------------------------ datos ------------------------------ */

    async function loadDestinations() {
        try {
            state.destinationsAvailable = !!(D.PayoutDestinations && await D.PayoutDestinations.isAvailable());
            state.destinations = state.destinationsAvailable ? await D.PayoutDestinations.list(ctx.user.id) : [];
        } catch (err) {
            console.warn('[wallet] destinos:', err);
            state.destinations = [];
        }
    }

    async function loadMovements() {
        const preferred = ctx.artist.preferred_display_currency || ctx.artist.session_price_currency || 'USD';
        try {
            const live = D.WalletMovements && await D.WalletMovements.isAvailable();
            if (live) {
                state.mode = 'live';
                state.movements = (await D.WalletMovements.list(ctx.user.id)).map(M.normalizeMovement);
            } else {
                state.mode = 'derived';
                let finance = [];
                if (D.FinancialLedger && await D.FinancialLedger.isAvailable().catch(() => false)) {
                    finance = M.fromFinancialEntries(await D.FinancialLedger.list(ctx.user.id, 100).catch(() => []));
                }
                const quotes = await D.Quotations.listForArtist(ctx.user.id, {
                    select: 'quote_id, quote_status, final_budget_amount, final_budget_currency, artist_budget_amount, artist_budget_currency, client_full_name, client_preferred_date, artist_completed_at, client_completed_at, updated_at, created_at'
                }).catch(() => []);
                state.movements = finance.concat(M.fromQuotations(quotes || [], { includeCompleted: !finance.length, currency: preferred }));
            }
        } catch (err) {
            console.error('[wallet] movimientos:', err);
            state.movements = [];
        }
        state.currency = M.primaryCurrency(state.movements, preferred);
    }

    async function loadWaitlist() {
        state.waitlist = null;
        try {
            if (D.CardWaitlist && await D.CardWaitlist.isAvailable()) {
                state.waitlist = await D.CardWaitlist.get(ctx.user.id);
            }
        } catch (err) { console.warn('[wallet] lista de espera:', err); }
        if (!state.waitlist) {
            const saved = ctx.appSettings().waitlists && ctx.appSettings().waitlists.we_otzi_card;
            if (saved && saved.email) state.waitlist = saved;
        }
    }

    /* ------------------------------ render ------------------------------ */

    function render() {
        const summary = M.summarize(state.movements, state.currency);
        state.summary = summary;
        renderStatus(summary);
        renderBalances(summary);
        renderReleases();
        renderActivity();
        renderQuick();
        renderBlocked(summary);
        renderDestinations();
        renderCardState();
    }

    function setStatus(id, cls, text) {
        const el = $(id);
        if (!el) return;
        el.className = 'wal-status-item ' + cls;
        el.querySelector('span').textContent = text;
    }

    function renderStatus(summary) {
        const verified = ctx.isVerified();
        setStatus('wal-status-verified', verified ? 'is-ok' : 'is-muted', verified ? 'Cuenta verificada' : 'Cuenta sin verificar');
        const n = summary.activeDisputes;
        setStatus('wal-status-disputes', n ? 'is-alert' : 'is-muted', n ? `${n} ${n === 1 ? 'disputa activa' : 'disputas activas'}` : 'Sin disputas activas');
        setStatus('wal-status-release', summary.nextReleaseHours != null ? 'is-info' : 'is-muted',
            summary.nextReleaseHours != null ? `Próxima liberación en ${M.formatHours(summary.nextReleaseHours)}` : 'Sin liberaciones pendientes');

        const note = $('wal-mode');
        if (state.mode === 'derived') {
            note.hidden = false;
            note.textContent = 'Mostramos tus cobros a partir de tus cotizaciones. Los retiros y destinos se habilitan cuando el Wallet esté activo en tu cuenta.';
        } else {
            note.hidden = true;
        }
    }

    function renderBalances(summary) {
        const cur = summary.currency;
        $('wal-available').textContent = M.formatMoney(summary.available, cur);
        $('wal-pending').textContent = M.formatMoney(summary.pendingService, cur);
        $('wal-awaiting').textContent = M.formatMoney(summary.awaitingRelease, cur);
        $('wal-awaiting-sub').textContent = summary.nextReleaseHours != null
            ? `Liberación automática en ${M.formatHours(summary.nextReleaseHours)}`
            : 'Sin liberaciones programadas';
        $('wal-blocked-total').textContent = M.formatMoney(summary.blocked, cur);
        $('wal-blocked-sub').textContent = summary.activeDisputes ? 'Por disputa activa' : 'Sin disputas activas';
        $('wal-withdrawing').textContent = M.formatMoney(summary.inWithdrawal, cur);
        $('wal-withdraw-open').disabled = !(summary.available > 0);
    }

    function renderReleases() {
        const wrap = $('wal-releases');
        const list = M.upcomingReleases(state.movements);
        const visible = state.showAllReleases ? list : list.slice(0, LIST_LIMIT.releases);
        const allBtn = $('wal-releases-all');
        allBtn.hidden = list.length <= LIST_LIMIT.releases;
        allBtn.textContent = state.showAllReleases ? 'Ver menos ←' : 'Ver todas →';
        allBtn.setAttribute('aria-expanded', String(state.showAllReleases));
        if (!list.length) {
            wrap.innerHTML = '<p class="wal-empty">No tenés reservas con fondos pendientes de liberar.</p>';
            return;
        }
        wrap.innerHTML = visible.map((m, i) => {
            const view = M.releaseView(m);
            const tone = AVATAR_TONES[i % AVATAR_TONES.length];
            const ref = m.booking ? `Reserva ${m.booking.startsWith('#') ? m.booking : '#' + m.booking}` : (m.quoteId ? `Reserva ${m.quoteId}` : 'Reserva');
            const toneCls = view.tone === 'info' ? ' is-info' : view.tone === 'danger' ? ' is-danger' : '';
            return `<div class="wal-release">
                <span class="wal-avatar wal-avatar--${tone}" aria-hidden="true">${esc(M.initials(m.counterparty || m.title))}</span>
                <div class="wal-release-who"><strong>${esc(m.counterparty || m.title)}</strong><span class="wal-mono-s">${esc(ref)}</span></div>
                <div class="wal-release-amount"><span class="wal-eyebrow">Recibirás</span><strong>${esc(M.formatMoney(m.amount, m.currency))}</strong></div>
                <div class="wal-release-state"><strong class="${toneCls.trim()}">${esc(view.label)}</strong><span class="wal-mono-s">${esc(view.meta)}</span></div>
            </div>`;
        }).join('');
    }

    function movementMeta(m) {
        const date = M.formatShortDate(m.occurredAt);
        let extra = '';
        if (m.kind === 'withdrawal') {
            const dest = state.destinations.find((d) => d.id === m.destinationId);
            extra = dest ? `${dest.label} ${M.maskIdentifier(dest.account_identifier)}` : 'Transferencia a tu destino';
        } else if (m.kind === 'fee') {
            extra = m.detail || 'Comisión por servicio';
        } else if (m.booking || m.quoteId) {
            const b = m.booking || m.quoteId;
            extra = `Reserva ${b.startsWith('#') || b.startsWith('DEMO') ? b : '#' + b}`;
        }
        return [date, extra].filter(Boolean).join(' · ');
    }

    function renderActivity() {
        const wrap = $('wal-activity');
        const list = M.activity(state.movements, state.filter);
        const visible = state.showAllActivity ? list : list.slice(0, LIST_LIMIT.activity);
        const more = $('wal-activity-all');
        more.hidden = list.length <= LIST_LIMIT.activity;
        more.textContent = state.showAllActivity ? 'Ver menos actividad ←' : 'Ver toda la actividad →';
        more.setAttribute('aria-expanded', String(state.showAllActivity));
        document.querySelectorAll('[data-wal-filter]').forEach((tab) => {
            const on = tab.dataset.walFilter === state.filter;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', String(on));
        });
        if (!list.length) {
            wrap.innerHTML = '<p class="wal-empty">Todavía no hay movimientos en esta categoría.</p>';
            return;
        }
        wrap.innerHTML = visible.map((m) => {
            const v = M.movementView(m);
            const sign = v.sign ? v.sign + ' ' : '';
            return `<div class="wal-move">
                <span class="wal-move-icon wal-tone-${v.tone}" aria-hidden="true">${esc(v.icon)}</span>
                <div class="wal-move-main"><strong>${esc(m.title)}</strong><span class="wal-mono-s">${esc(movementMeta(m))}</span></div>
                <div class="wal-move-side"><span class="wal-move-amount wal-tone-${v.tone}">${esc(sign + M.formatMoney(m.amount, m.currency))}</span><span class="wal-move-status">${esc(v.statusLabel)}</span></div>
            </div>`;
        }).join('');
    }

    function destinationLine(d) {
        const method = M.DESTINATION_METHODS[d.method] || {};
        const last = M.last4(d.account_identifier);
        if (d.method === 'bank_international') return `IBAN ${d.currency} · Terminado en ${last}`;
        return `${d.rail || method.rail || 'ACH'} · Terminada en ${last}`;
    }
    function destinationType(d) {
        const method = M.DESTINATION_METHODS[d.method] || {};
        return (d.metadata_json && d.metadata_json.account_type) || (d.method === 'bank_international' ? `Transferencia ${d.rail || 'SEPA'}` : method.detail) || '';
    }
    function quickLabel(d) {
        return `${d.label} · ${d.rail || (M.DESTINATION_METHODS[d.method] || {}).rail || 'ACH'} · Terminada en ${M.last4(d.account_identifier)}`;
    }

    function renderQuick() {
        const select = $('wal-quick-dest');
        const current = select.value;
        const usable = state.destinations;
        const def = usable.find((d) => d.is_default) || usable[0] || null;
        if (!usable.length) {
            select.innerHTML = `<option value="">${state.mode === 'derived' ? 'Wallet no activo todavía' : 'Agregá un destino de retiro'}</option>`;
        } else {
            select.innerHTML = usable.map((d) => `<option value="${esc(d.id)}">${esc(quickLabel(d))}</option>`).join('');
            // Sigue al destino predeterminado salvo que el artista haya elegido otro a mano.
            const keepManual = state.quickManual && usable.some((d) => d.id === current);
            select.value = keepManual ? current : (def ? def.id : '');
        }
        updateQuickMeta();
        const disabled = state.mode !== 'live' || !usable.length;
        select.disabled = !usable.length;
        $('wal-quick-amount').disabled = disabled;
        $('wal-quick-submit').disabled = disabled;
    }

    function selectedDestination() {
        const id = $('wal-quick-dest').value;
        return state.destinations.find((d) => d.id === id) || null;
    }

    function availableFor(currency) {
        return M.summarize(state.movements, currency).available;
    }

    function updateQuickMeta() {
        const dest = selectedDestination();
        const cur = dest ? dest.currency : state.currency;
        $('wal-quick-cur').textContent = cur;
        $('wal-quick-dest-hint').textContent = dest ? destinationType(dest) : '';
        $('wal-quick-available').textContent = `Disponible: ${M.formatMoney(availableFor(cur), cur)}`;
    }

    function renderBlocked(summary) {
        const box = $('wal-blocked');
        if (!summary.activeDisputes) { box.hidden = true; return; }
        box.hidden = false;
        const n = summary.activeDisputes;
        $('wal-blocked-count').textContent = `${n} ${n === 1 ? 'disputa activa' : 'disputas activas'}`;
        $('wal-blocked-value').textContent = M.formatMoney(summary.blocked, summary.currency);
        const who = summary.blockedCounterparty;
        $('wal-blocked-text').textContent = who ? `Retenidos hasta resolver la disputa con ${who}.` : 'Retenidos hasta resolver la disputa.';
        const dispute = summary.blockedDispute;
        $('wal-blocked-link').href = dispute && dispute.quoteId
            ? `/my-quotations/detail?id=${encodeURIComponent(dispute.quoteId)}`
            : '/artist/inbox';
    }

    function renderDestinations() {
        const wrap = $('wal-dest-list');
        $('wal-dest-add').disabled = !state.destinationsAvailable;
        if (!state.destinationsAvailable) {
            wrap.innerHTML = '<p class="wal-dest-note">Los destinos de retiro se habilitan cuando el Wallet esté activo en tu cuenta.</p>';
            return;
        }
        const rows = state.destinations.map((d) => {
            const method = M.DESTINATION_METHODS[d.method] || {};
            const logoTone = d.method === 'lemon' ? '' : d.method === 'bank_usd' ? ' wal-logo--sand' : ' wal-logo--red';
            const badge = d.method === 'lemon' ? 'LEMON' : d.method === 'bank_usd' ? 'BANK' : String(d.label || method.badge || 'BANK').replace(/^banco\s+/i, '').slice(0, 4).toUpperCase();
            const ver = d.verification_status === 'verified'
                ? '<span class="wal-verified"><i data-wo-icon="check" aria-hidden="true"></i>Verificada</span>'
                : d.verification_status === 'rejected'
                    ? '<span class="wal-verified is-rejected"><i data-wo-icon="x" aria-hidden="true"></i>Rechazada</span>'
                    : '<span class="wal-verified is-pending"><i data-wo-icon="clock" aria-hidden="true"></i>Verificación pendiente</span>';
            const def = d.is_default
                ? '<span class="wal-default-tag">Predeterminada</span>'
                : `<button type="button" class="wal-text-link" data-dest-default="${esc(d.id)}">Hacer predeterminada</button>`;
            return `<div class="wal-dest-row${d.is_default ? ' is-default' : ''}">
                <span class="wal-logo${logoTone}" aria-hidden="true">${esc(badge)}</span>
                <div class="wal-dest-info">
                    <div class="wal-dest-name"><strong>${esc(d.label)}</strong><span>${esc(destinationType(d))}</span><span class="wal-mono-s">${esc(destinationLine(d))}</span></div>
                    ${ver}
                    ${def}
                </div>
                <div class="wal-dest-actions">
                    <button type="button" data-dest-view="${esc(d.id)}">Ver detalles</button>
                    <button type="button" data-dest-edit="${esc(d.id)}">Editar</button>
                    <button type="button" data-dest-delete="${esc(d.id)}">Eliminar</button>
                </div>
            </div>`;
        });
        rows.push(`<button type="button" class="wal-dest-add" data-dest-new>
            <span class="wal-dest-add-box" aria-hidden="true">+</span>
            <span><strong>Agregar nuevo destino</strong><span>Más billeteras y bancos próximamente</span></span>
        </button>`);
        wrap.innerHTML = rows.join('');
    }

    function renderCardState() {
        const done = $('wal-card-done');
        const btn = $('wal-card-submit');
        const promoBtn = $('wal-card-open');
        if (state.waitlist && state.waitlist.email) {
            done.hidden = false;
            done.textContent = `Listo: te avisamos a ${state.waitlist.email} cuando la We Ötzi Card esté disponible.`;
            btn.textContent = 'Actualizar correo';
            promoBtn.textContent = 'Ya estás en la lista';
        } else {
            done.hidden = true;
            btn.textContent = 'Avisame cuando esté disponible';
            promoBtn.textContent = 'Conocer más';
        }
    }

    /* ------------------------------ eventos ------------------------------ */

    function wire() {
        document.querySelectorAll('[data-wal-filter]').forEach((tab) => tab.addEventListener('click', () => {
            state.filter = tab.dataset.walFilter;
            state.showAllActivity = false;
            renderActivity();
        }));
        $('wal-releases-all').addEventListener('click', () => { state.showAllReleases = !state.showAllReleases; renderReleases(); });
        $('wal-activity-all').addEventListener('click', () => { state.showAllActivity = !state.showAllActivity; renderActivity(); });

        $('wal-withdraw-open').addEventListener('click', () => {
            const amount = $('wal-quick-amount');
            const dest = selectedDestination();
            const cur = dest ? dest.currency : state.currency;
            const avail = availableFor(cur);
            if (avail > 0 && !amount.disabled) amount.value = M.formatMoney(avail, cur).replace(/^[A-Z]+\s/, '');
            $('wal-quick-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => (amount.disabled ? $('wal-quick-dest') : amount).focus(), 250);
            if (state.mode !== 'live') toast('Los retiros se habilitan cuando el Wallet esté activo en tu cuenta', false);
        });
        $('wal-quick-dest').addEventListener('change', () => { state.quickManual = true; updateQuickMeta(); });
        $('wal-quick-form').addEventListener('submit', onQuickSubmit);
        $('wal-withdraw-form').addEventListener('submit', onWithdrawConfirm);

        $('wal-dest-add').addEventListener('click', () => openDestinationDialog());
        $('wal-dest-list').addEventListener('click', onDestinationListClick);
        $('wal-dest-form').addEventListener('submit', onDestinationSubmit);

        $('wal-card-open').addEventListener('click', openCardDialog);
        $('wal-card-form').addEventListener('submit', onCardSubmit);

        document.querySelectorAll('[data-open-fiscal]').forEach((btn) => btn.addEventListener('click', openFiscalDialog));
        $('wal-fiscal-form').addEventListener('submit', onFiscalSubmit);
    }

    function showError(id, msg) {
        const el = $(id);
        if (!el) return;
        el.textContent = msg || '';
        el.hidden = !msg;
    }

    function onQuickSubmit(event) {
        event.preventDefault();
        showError('wal-quick-error', '');
        if (state.mode !== 'live') { showError('wal-quick-error', 'Los retiros se habilitan cuando el Wallet esté activo en tu cuenta.'); return; }
        const dest = selectedDestination();
        const amount = M.parseAmount($('wal-quick-amount').value);
        const available = dest ? availableFor(dest.currency) : 0;
        const error = M.validateWithdrawal(amount, available, dest);
        if (error) { showError('wal-quick-error', error); return; }
        state.pendingWithdrawal = { destination: dest, amount };
        $('wal-withdraw-amount').textContent = M.formatMoney(amount, dest.currency);
        $('wal-withdraw-dest').textContent = `A ${dest.label} ${M.maskIdentifier(dest.account_identifier)} · ${destinationType(dest)}`;
        $('wal-withdraw-dialog').showModal();
    }

    async function onWithdrawConfirm(event) {
        event.preventDefault();
        const pending = state.pendingWithdrawal;
        if (!pending) return;
        const btn = $('wal-withdraw-confirm');
        btn.disabled = true;
        try {
            await D.WalletMovements.requestWithdrawal({
                destinationId: pending.destination.id,
                amount: pending.amount,
                currency: pending.destination.currency
            });
            $('wal-withdraw-dialog').close();
            $('wal-quick-amount').value = '';
            state.pendingWithdrawal = null;
            await loadMovements();
            render();
            toast(`Retiro de ${M.formatMoney(pending.amount, pending.destination.currency)} en proceso`);
        } catch (err) {
            console.error('[wallet] retiro:', err);
            const msg = /insufficient/i.test(err && err.message) ? 'El monto supera tu saldo disponible.'
                : /not verified/i.test(err && err.message) ? 'El destino todavía no está verificado.'
                : 'No pudimos registrar el retiro. Probá de nuevo.';
            $('wal-withdraw-dialog').close();
            showError('wal-quick-error', msg);
            toast(msg, false);
        } finally { btn.disabled = false; }
    }

    /* -------- destinos -------- */

    function renderMethods() {
        const available = Object.keys(M.DESTINATION_METHODS).filter((k) => M.DESTINATION_METHODS[k].available);
        $('wal-methods').innerHTML = available.map((key) => {
            const m = M.DESTINATION_METHODS[key];
            const tone = m.tone === 'ink' ? '' : m.tone === 'sand' ? ' wal-logo--sand' : ' wal-logo--blue';
            const on = state.selectedMethod === key;
            return `<button type="button" class="wal-method" role="radio" aria-checked="${on}" data-method="${key}">
                <span class="wal-logo wal-logo--s${tone}" aria-hidden="true">${esc(m.badge)}</span>
                <span class="wal-method-text"><strong>${esc(m.label)}</strong><span>${esc(m.detail)}</span></span>
                <span class="wal-method-state">Disponible</span>
            </button>`;
        }).join('');
        $('wal-methods').querySelectorAll('[data-method]').forEach((btn) => btn.addEventListener('click', () => {
            state.selectedMethod = btn.dataset.method;
            const def = M.DESTINATION_METHODS[state.selectedMethod];
            if (!$('wal-dest-id').value && def && def.currency) $('wal-dest-currency').value = def.currency;
            renderMethods();
        }));
    }

    function openDestinationDialog(dest) {
        if (!state.destinationsAvailable) { toast('Los destinos se habilitan cuando el Wallet esté activo en tu cuenta', false); return; }
        showError('wal-dest-error', '');
        $('wal-dest-id').value = dest ? dest.id : '';
        state.selectedMethod = dest ? dest.method : 'lemon';
        $('wal-dest-holder').value = dest ? dest.holder_name : (ctx.profileFullName() || ctx.artist.name || '');
        $('wal-dest-currency').value = dest ? dest.currency : M.DESTINATION_METHODS[state.selectedMethod].currency;
        $('wal-dest-identifier').value = dest ? dest.account_identifier : '';
        $('wal-dest-dialog-title').textContent = dest ? 'Editar destino de retiro' : 'Agregar destino de retiro';
        $('wal-dest-submit').textContent = dest ? 'Guardar destino' : 'Agregar destino';
        renderMethods();
        $('wal-dest-dialog').showModal();
    }

    async function onDestinationSubmit(event) {
        event.preventDefault();
        showError('wal-dest-error', '');
        const input = {
            id: $('wal-dest-id').value || null,
            method: state.selectedMethod,
            holderName: $('wal-dest-holder').value,
            currency: $('wal-dest-currency').value,
            accountIdentifier: $('wal-dest-identifier').value
        };
        const check = M.validateDestination(input);
        if (!check.ok) { showError('wal-dest-error', Object.values(check.errors)[0]); return; }
        const method = M.DESTINATION_METHODS[input.method];
        const btn = $('wal-dest-submit');
        btn.disabled = true;
        try {
            const existing = input.id ? state.destinations.find((d) => d.id === input.id) : null;
            // Si cambió el método, el nombre del método anterior ya no corresponde.
            const keepLabel = existing && existing.method === input.method && existing.label;
            await D.PayoutDestinations.save(ctx.user.id, {
                id: input.id,
                method: input.method,
                label: keepLabel || method.label,
                holderName: input.holderName,
                currency: input.currency,
                accountIdentifier: input.accountIdentifier,
                rail: method.rail,
                isDefault: !state.destinations.length
            });
            $('wal-dest-dialog').close();
            await loadDestinations();
            render();
            toast(input.id ? 'Destino actualizado' : 'Destino agregado · lo verificamos antes del primer retiro');
            assistRefresh();
        } catch (err) {
            console.error('[wallet] destino:', err);
            showError('wal-dest-error', /tarjeta/.test(err && err.message)
                ? 'No ingreses números de tarjeta. Usá el CBU, IBAN o alias de la cuenta.'
                : 'No pudimos guardar el destino. Revisá los datos y probá de nuevo.');
        } finally { btn.disabled = false; }
    }

    async function onDestinationListClick(event) {
        const btn = event.target.closest('button');
        if (!btn) return;
        if (btn.hasAttribute('data-dest-new')) { openDestinationDialog(); return; }
        const find = (id) => state.destinations.find((d) => d.id === id);
        if (btn.dataset.destView) { openDestinationDetails(find(btn.dataset.destView)); return; }
        if (btn.dataset.destEdit) { openDestinationDialog(find(btn.dataset.destEdit)); return; }
        if (btn.dataset.destDefault) {
            btn.disabled = true;
            try {
                state.destinations = await D.PayoutDestinations.setDefault(ctx.user.id, btn.dataset.destDefault);
                state.quickManual = false; // Retiro rápido pasa al nuevo predeterminado
                render();
                toast('Destino predeterminado actualizado');
                assistRefresh();
            } catch (err) {
                console.error('[wallet] predeterminar:', err);
                toast('No pudimos actualizar el destino predeterminado', false);
            } finally { btn.disabled = false; }
            return;
        }
        if (btn.dataset.destDelete) {
            const dest = find(btn.dataset.destDelete);
            if (!dest || !window.confirm(`¿Querés eliminar ${dest.label} de tus destinos de retiro?`)) return;
            btn.disabled = true;
            try {
                await D.PayoutDestinations.remove(ctx.user.id, dest.id);
                await loadDestinations();
                if (dest.is_default && state.destinations[0]) {
                    state.destinations = await D.PayoutDestinations.setDefault(ctx.user.id, state.destinations[0].id).catch(() => state.destinations);
                }
                render();
                toast('Destino eliminado');
                assistRefresh();
            } catch (err) {
                console.error('[wallet] eliminar destino:', err);
                toast('No pudimos eliminar el destino', false);
            } finally { btn.disabled = false; }
        }
    }

    function openDestinationDetails(dest) {
        if (!dest) return;
        const method = M.DESTINATION_METHODS[dest.method] || {};
        const status = { verified: 'Verificada', pending: 'Verificación pendiente', rejected: 'Rechazada' }[dest.verification_status] || 'Pendiente';
        const rows = [
            ['Método', method.label || dest.method],
            ['Titular', dest.holder_name],
            ['Moneda', dest.currency],
            ['Cuenta', `${destinationLine(dest)}`],
            ['Identificador', M.maskIdentifier(dest.account_identifier)],
            ['Estado', status],
            ['Predeterminada', dest.is_default ? 'Sí' : 'No'],
            ['Agregada', M.formatShortDate(dest.created_at)]
        ];
        $('wal-dest-details-title').textContent = dest.label;
        $('wal-dest-details-body').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('');
        $('wal-dest-details').showModal();
    }

    /* -------- We Ötzi Card -------- */

    function openCardDialog() {
        showError('wal-card-error', '');
        $('wal-card-email').value = (state.waitlist && state.waitlist.email) || ctx.user.email || '';
        renderCardState();
        $('wal-card-dialog').showModal();
    }

    async function onCardSubmit(event) {
        event.preventDefault();
        showError('wal-card-error', '');
        const email = $('wal-card-email').value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('wal-card-error', 'Ingresá un correo válido.'); return; }
        const btn = $('wal-card-submit');
        btn.disabled = true;
        try {
            let saved = null;
            if (D.CardWaitlist && await D.CardWaitlist.isAvailable()) {
                saved = await D.CardWaitlist.join(ctx.user.id, email);
            }
            // Respaldo en preferencias: el interés queda registrado aunque la
            // tabla wallet_card_waitlist todavía no exista.
            const waitlists = Object.assign({}, ctx.appSettings().waitlists || {}, {
                we_otzi_card: { email, joined_at: new Date().toISOString(), synced: !!saved }
            });
            await ctx.savePrefs('app_settings', { waitlists });
            state.waitlist = saved || waitlists.we_otzi_card;
            renderCardState();
            toast('Listo, te avisamos cuando la We Ötzi Card esté disponible');
        } catch (err) {
            console.error('[wallet] lista de espera:', err);
            showError('wal-card-error', 'No pudimos registrar tu interés. Probá de nuevo.');
        } finally { btn.disabled = false; }
    }

    /* -------- Datos fiscales -------- */

    async function openFiscalDialog() {
        try {
            const row = await D.Billing.get(ctx.user.id);
            $('aac-legal-name').value = (row && row.legal_name) || '';
            $('aac-tax-id').value = (row && row.tax_id) || '';
        } catch (err) { console.warn('[wallet] datos fiscales:', err); }
        $('wal-fiscal-dialog').showModal();
    }

    async function onFiscalSubmit(event) {
        event.preventDefault();
        const btn = $('aac-billing-save');
        btn.disabled = true;
        try {
            await D.Billing.upsert(ctx.user.id, {
                legalName: $('aac-legal-name').value.trim() || null,
                taxId: $('aac-tax-id').value.trim() || null
            });
            $('wal-fiscal-dialog').close();
            toast('Datos fiscales guardados');
        } catch (err) {
            console.error('[wallet] guardar fiscales:', err);
            toast('No pudimos guardar los datos fiscales', false);
        } finally { btn.disabled = false; }
    }

    /* -------- estados por URL (QA) -------- */

    function openFromQuery() {
        const modal = new URLSearchParams(window.location.search).get('modal');
        if (!modal || (window.location.hash || '').replace('#', '') !== 'cobros') return;
        if (modal === 'agregar-destino') openDestinationDialog();
        else if (modal === 'card') openCardDialog();
        else if (modal === 'datos-fiscales') openFiscalDialog();
    }

    function refreshStatus() {
        if (ctx && state.summary) renderStatus(state.summary);
    }

    window.AacWallet = { init, reload, openFromQuery, refreshStatus };
})();
