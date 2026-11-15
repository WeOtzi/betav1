/**
 * WE OTZI - "Mis sesiones" del panel del cliente (ronda 2 · frente "sesiones")
 * ---------------------------------------------------------------------------
 * P28: el cliente ve cada sesión que le agenda el artista y puede
 *   · confirmarla o pedir otra fecha (mientras está "por confirmar");
 *   · pedir un cambio de una sesión confirmada hasta 3 días antes, o
 *     aceptar / rechazar el que pide el artista;
 *   · pedir una disputa a soporte si no hay acuerdo o la sesión ya pasó;
 *   · calificar y dejar un registro de las sesiones pasadas.
 * P27: cada sesión muestra el lugar con la dirección completa y su enlace a
 * Google Maps.
 *
 * Se monta con una línea desde client-dashboard.js:
 *   window.WoClientSessions.mount({ onOpenQuote })
 * sobre <section id="mis-sesiones">. Sin sesiones (o si el servidor todavía
 * no tiene las rutas) la sección queda oculta y el panel sigue como antes.
 *
 * Requiere wo-session-model.js, wo-session-ui.js y data/sessions-flow-repo.js.
 */
(function () {
    'use strict';

    const M = window.WoSessionModel;
    const UI = window.WoSessionUI;
    if (!M || !UI) {
        console.error('[client-sessions] faltan wo-session-model.js / wo-session-ui.js.');
        return;
    }
    const esc = UI.esc;

    const state = {
        root: null,
        sessions: [],
        tab: 'upcoming',
        loading: false,
        loaded: false,
        onOpenQuote: null,
        focusId: null,
        focused: false,
    };

    function repo() {
        return window.WeotziData && window.WeotziData.SessionFlow;
    }

    function byId(id) {
        return state.sessions.find((s) => String(s.id) === String(id)) || null;
    }

    function isUpcoming(session) {
        return session.phase === 'upcoming';
    }

    function needsAction(session) {
        const can = session.can || {};
        return isUpcoming(session) && (can.confirm || can.respond);
    }

    function counterpart(session) {
        return (session.quote && session.quote.counterpart_name) || 'tu artista';
    }

    /* ------------------------------------ render ------------------------------------ */
    function actionButton(action, session, label, className) {
        return `<button class="${className}" type="button" data-ws-action="${esc(action)}" data-ws-id="${esc(session.id)}">${esc(label)}</button>`;
    }

    function requestBlock(session) {
        const r = session.request;
        if (!r) {
            const last = session.last_request;
            if (last && last.status === 'rejected' && isUpcoming(session)) {
                return `<p class="ws-card-note">${esc(last.mine ? `${counterpart(session)} no aceptó tu pedido de cambio.` : 'Rechazaste el pedido de cambio.')}${last.response_note ? ` “${esc(last.response_note)}”` : ''}</p>`;
            }
            return '';
        }
        const who = r.mine ? 'Pediste' : `${counterpart(session)} pidió`;
        return `<div class="ws-card-request">
            <strong>${esc(who)} un cambio</strong>
            <span>${esc(M.proposalSummary(r) || 'Cambio de sesión')}</span>
            ${r.note ? `<span class="ws-card-quote">“${esc(r.note)}”</span>` : ''}
            ${r.mine ? `<span class="ws-card-wait">Esperando la respuesta de ${esc(counterpart(session))}.</span>` : ''}
        </div>`;
    }

    function feedbackBlock(session) {
        const f = session.feedback || {};
        if (!f.mine && !f.other) return '';
        const parts = [];
        if (f.mine) parts.push(`Tu registro: ${M.stars(f.mine.rating)}`);
        if (f.other) parts.push(`${counterpart(session)}: ${M.stars(f.other.rating)}`);
        return `<p class="ws-card-note ws-card-note--stars">${esc(parts.join(' · '))}</p>`;
    }

    function actionsHtml(session) {
        const can = session.can || {};
        const out = [];
        if (can.confirm) out.push(actionButton('confirm', session, 'Confirmar sesión', 'wo-btn wo-btn--s wo-btn--accent'));
        if (can.respond) out.push(actionButton('respond', session, 'Responder pedido', 'wo-btn wo-btn--s wo-btn--accent'));
        if (can.request_change && !session.request) {
            out.push(actionButton('change', session, session.client_confirmation === 'confirmed' ? 'Pedir cambio' : 'Pedir otra fecha', 'wo-btn wo-btn--s wo-btn--ghost'));
        }
        if (can.withdraw) out.push(actionButton('withdraw', session, 'Retirar pedido', 'wo-btn wo-btn--s wo-btn--ghost'));
        if (can.rate) out.push(actionButton('rate', session, session.feedback && session.feedback.mine ? 'Ver mi registro' : 'Calificar y registrar', 'wo-btn wo-btn--s wo-btn--ghost'));
        const links = [];
        const disputeUseful = can.dispute && !session.dispute
            && (session.locked === 'window' || !isUpcoming(session) || (session.last_request && session.last_request.status === 'rejected'));
        if (disputeUseful) links.push(actionButton('dispute', session, 'Pedir disputa a soporte', 'ws-link'));
        if (session.quote && session.quote.quote_id) links.push(actionButton('quote', session, 'Ver cotización', 'ws-link'));
        return `${out.length ? `<div class="ws-card-actions">${out.join('')}</div>` : ''}${links.length ? `<div class="ws-card-links">${links.join('')}</div>` : ''}`;
    }

    function cardHtml(session) {
        const quote = session.quote || {};
        const meta = [
            session.session_number ? `Sesión N.º ${session.session_number}` : 'Sesión',
            quote.tattoo_body_part || '',
        ].filter(Boolean).join(' · ');
        const lock = isUpcoming(session) && session.locked === 'window' ? M.lockCopy('window') : '';
        const dispute = session.dispute
            ? `<p class="ws-card-note ws-card-note--lock">${esc(session.dispute.active ? 'Disputa abierta' : 'Disputa cerrada')}${session.dispute.ticket_number ? ` · ticket N.º ${esc(session.dispute.ticket_number)}` : ''}</p>`
            : '';
        return `
            <article class="ws-card${needsAction(session) ? ' is-action' : ''}" data-ws-session="${esc(session.id)}" tabindex="-1">
                <header class="ws-card-head">
                    <span class="ws-card-meta">${esc(meta)}</span>
                    ${UI.badgeHtml(session.badge)}
                </header>
                <h3 class="ws-card-date">${esc(M.dateTimeLabel(session.session_date) || 'Fecha por definir')}</h3>
                <p class="ws-card-with">Con ${esc(counterpart(session))}${session.duration_hours ? ` · ${esc(M.durationLabel(session.duration_hours))}` : ''}</p>
                <p class="ws-card-place">${UI.locationLineHtml(session)}</p>
                ${requestBlock(session)}
                ${lock ? `<p class="ws-card-note ws-card-note--lock">${esc(lock)}</p>` : ''}
                ${dispute}
                ${feedbackBlock(session)}
                ${actionsHtml(session)}
            </article>`;
    }

    function render() {
        const root = state.root;
        if (!root) return;
        if (!state.sessions.length) {
            root.hidden = true;
            root.innerHTML = '';
            return;
        }
        const upcoming = state.sessions.filter(isUpcoming);
        const past = state.sessions.filter((s) => !isUpcoming(s));
        if (state.tab === 'upcoming' && !upcoming.length && past.length) state.tab = 'past';
        if (state.tab === 'past' && !past.length) state.tab = 'upcoming';
        const list = state.tab === 'past' ? past : upcoming;
        const pending = upcoming.filter(needsAction).length;
        const tab = (key, label, count) => `<button class="ws-tab${state.tab === key ? ' is-active' : ''}" type="button" role="tab" id="ws-tab-${key}" aria-selected="${state.tab === key ? 'true' : 'false'}" aria-controls="ws-panel" data-ws-tab="${key}"${count ? '' : ' disabled'}>${esc(label)} <span class="ws-tab-count">${count}</span></button>`;
        root.hidden = false;
        root.innerHTML = `
            <header class="client-section-head ws-panel-head">
                <div>
                    <h2 class="wo-h2" id="ws-panel-title">Mis sesiones</h2>
                    <p class="ws-panel-sub">${pending
                        ? esc(`${pending === 1 ? 'Tienes 1 sesión que espera' : `Tienes ${pending} sesiones que esperan`} tu respuesta.`)
                        : 'Confirma tus sesiones, pide cambios hasta 3 días antes y deja tu registro cuando pasen.'}</p>
                </div>
                <div class="ws-tabs" role="tablist" aria-label="Sesiones">
                    ${tab('upcoming', 'Próximas', upcoming.length)}
                    ${tab('past', 'Pasadas', past.length)}
                </div>
            </header>
            <div class="ws-cards" id="ws-panel" role="tabpanel" aria-labelledby="ws-tab-${state.tab}">
                ${list.map(cardHtml).join('') || '<p class="ws-empty">No hay sesiones en esta lista.</p>'}
            </div>`;
        focusFromUrl();
    }

    // ?session=<id> (correos): abre la pestaña de esa sesión y la resalta una vez.
    function focusFromUrl() {
        if (state.focused || !state.focusId) return;
        const session = byId(state.focusId);
        if (!session) return;
        const wanted = isUpcoming(session) ? 'upcoming' : 'past';
        if (state.tab !== wanted) { state.tab = wanted; render(); return; }
        state.focused = true;
        const selector = window.CSS && CSS.escape ? CSS.escape(String(session.id)) : String(session.id).replace(/"/g, '');
        const card = state.root.querySelector(`[data-ws-session="${selector}"]`);
        if (!card) return;
        card.classList.add('ws-highlight');
        window.setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.focus({ preventScroll: true });
        }, 60);
        window.setTimeout(() => card.classList.remove('ws-highlight'), 4500);
    }

    /* ------------------------------------- datos ------------------------------------- */
    async function load() {
        const flow = repo();
        if (!flow || !state.root || state.loading) return;
        state.loading = true;
        try {
            const json = await flow.mine();
            state.sessions = Array.isArray(json.sessions) ? json.sessions : [];
            state.loaded = true;
            render();
        } catch (error) {
            // Sin las rutas o sin la migración: el panel no aparece (y no molesta).
            if (!flow.isUnavailable(error)) console.warn('[client-sessions] no se pudieron cargar las sesiones:', error && error.message);
            if (!state.loaded) { state.root.hidden = true; state.root.innerHTML = ''; }
        } finally {
            state.loading = false;
        }
    }

    async function done(message) {
        if (message) UI.toast(message);
        await load();
        // La tarjeta "Próxima cita" del panel se recalcula con el dato nuevo.
        try { if (typeof window.loadNextAppointment === 'function') window.loadNextAppointment(); } catch (_) { /* opcional */ }
    }

    async function handle(action, id) {
        const session = byId(id);
        const flow = repo();
        if (!session || !flow) return;
        try {
            if (action === 'quote') {
                if (typeof state.onOpenQuote === 'function' && session.quote && session.quote.quote_id) state.onOpenQuote(session.quote.quote_id);
            } else if (action === 'confirm') {
                const ok = await UI.confirmDialog({
                    title: '¿Confirmar la sesión?',
                    message: `${M.dateTimeLabel(session.session_date)}${session.location ? ` · ${session.location}` : ''}. Queda agendada para ambos. Después, los cambios se acuerdan con ${counterpart(session)} hasta ${M.EDIT_WINDOW_DAYS} días antes.`,
                    confirmLabel: 'Confirmar sesión',
                });
                if (!ok) return;
                await flow.confirm(session.id);
                await done('Sesión confirmada. Quedó agendada para ambos.');
            } else if (action === 'change') {
                const result = await UI.changeDialog(session, { role: 'client', counterpart: counterpart(session) });
                if (result) await done(`Enviamos tu pedido a ${counterpart(session)}. Te avisamos cuando responda.`);
            } else if (action === 'respond') {
                const result = await UI.respondDialog(session, { counterpart: counterpart(session) });
                if (result) await done(result.accepted ? 'Cambio aceptado: la sesión quedó confirmada con los datos nuevos.' : 'Rechazaste el cambio. La sesión sigue como estaba.');
            } else if (action === 'withdraw') {
                if (!session.request) return;
                const ok = await UI.confirmDialog({ title: '¿Retirar tu pedido de cambio?', message: 'La sesión sigue en la fecha y el lugar actuales.', confirmLabel: 'Retirar pedido' });
                if (!ok) return;
                await flow.withdraw(session.request.id);
                await done('Retiraste tu pedido de cambio.');
            } else if (action === 'rate') {
                const result = await UI.feedbackDialog(session, { counterpart: counterpart(session) });
                if (result) await done('Registro guardado.');
            } else if (action === 'dispute') {
                const result = await UI.disputeDialog(session);
                if (result) await done(`Disputa registrada${result.ticket_number ? ` (ticket N.º ${result.ticket_number})` : ''}. Soporte revisa el caso.`);
            }
        } catch (error) {
            console.error('[client-sessions]', action, error);
            UI.toast((error && error.userMessage) || 'No pudimos completar la acción. Prueba de nuevo.', { error: true });
            // El estado pudo cambiar del otro lado (por ejemplo, ya respondieron).
            load();
        }
    }

    function onClick(event) {
        const tab = event.target.closest('[data-ws-tab]');
        if (tab) {
            state.tab = tab.getAttribute('data-ws-tab') === 'past' ? 'past' : 'upcoming';
            render();
            const active = state.root.querySelector('.ws-tab.is-active');
            if (active) active.focus();
            return;
        }
        const target = event.target.closest('[data-ws-action]');
        if (!target) return;
        event.preventDefault();
        handle(target.getAttribute('data-ws-action'), target.getAttribute('data-ws-id'));
    }

    function mount(options = {}) {
        const root = document.getElementById(options.rootId || 'mis-sesiones');
        if (!root) return;
        if (typeof options.onOpenQuote === 'function') state.onOpenQuote = options.onOpenQuote;
        if (state.root !== root) {
            state.root = root;
            root.setAttribute('data-ws-client', '');
            root.addEventListener('click', onClick);
            try { state.focusId = new URLSearchParams(window.location.search).get('session') || null; } catch (_) { state.focusId = null; }
        }
        load();
    }

    window.WoClientSessions = { mount, refresh: load, _cardHtml: cardHtml };
})();
