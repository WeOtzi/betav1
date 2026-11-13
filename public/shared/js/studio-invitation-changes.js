/**
 * Solicitudes de cambio de invitaciones · pestaña "Equipo" de /studio/dashboard.
 *
 * El artista pide cambios desde 801:1101 (RPC request_studio_invitation_changes).
 * Acá el estudio los ve y responde: "Actualizar invitación" (rol, sede, split,
 * fechas, duración, mensaje) o "Mantener condiciones" con una respuesta.
 * Todo pasa por la RPC respond_studio_invitation_change_request, que valida
 * dueño, estado pendiente y campos; la respuesta queda en el hilo del Inbox.
 * Diseño propio (no hay frame del estudio): componentes del DS del panel.
 */
(function () {
    'use strict';

    const D = window.WeotziData || {};
    const M = window.WoStudioInboxModel;
    const state = { studio: null, requests: [], locations: [], loading: null, open: null };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        const auth = window.WeOtziStudioAuth;
        const host = el('roster-change-requests');
        if (!auth || !host || !D.StudioInbox || !M) return;
        await auth.ready();
        state.studio = auth.getCurrent() || await auth.check();
        if (!state.studio) return;
        host.addEventListener('click', onClick);
        host.addEventListener('submit', onSubmit);
        window.addEventListener('studio:tabchange', event => {
            if (event.detail && event.detail.tab === 'roster') load();
        });
        window.addEventListener('studio:focus-change-request', async event => {
            await load();
            focusRequest(event.detail && event.detail.requestId);
        });
        await load();
    }

    function load() {
        if (!state.studio) return Promise.resolve();
        if (!state.loading) state.loading = fetchAndRender().finally(() => { state.loading = null; });
        return state.loading;
    }

    async function fetchAndRender() {
        const host = el('roster-change-requests');
        host.setAttribute('aria-busy', 'true');
        try {
            const [requests, locations] = await Promise.all([
                D.StudioInbox.listChangeRequests(state.studio.id),
                loadLocations(),
            ]);
            state.requests = requests;
            state.locations = locations;
            render();
        } catch (error) {
            console.error('[studio-changes] cargar', error);
            host.innerHTML = '<div class="studio-status studio-status-error" role="alert">No pudimos cargar las solicitudes de cambio. Volvé a abrir Equipo para intentar nuevamente.</div>';
        } finally {
            host.setAttribute('aria-busy', 'false');
        }
    }

    async function loadLocations() {
        if (!D.StudioLocations || typeof D.StudioLocations.listActiveByStudio !== 'function') return [];
        const { data } = await D.StudioLocations.listActiveByStudio(state.studio.id, 'id, label, is_primary');
        return data || [];
    }

    function render() {
        const host = el('roster-change-requests');
        const pending = state.requests.filter(r => r.status === 'pending');
        const resolved = state.requests.filter(r => r.status !== 'pending').slice(0, 5);
        if (!state.requests.length) { host.innerHTML = ''; host.hidden = true; return; }
        host.hidden = false;
        host.innerHTML =
            '<h3 class="studio-h2 si-cr-title">Solicitudes de <span class="accent">cambio</span>' +
                (pending.length ? ' <span class="wo-badge wo-badge--s si-cr-count">' + pending.length + '</span>' : '') + '</h3>' +
            '<p class="studio-help">Los artistas invitados pueden pedir cambios antes de aceptar. Actualizá la invitación o contales por qué mantenés las condiciones: la respuesta les llega a su Inbox.</p>' +
            (pending.length ? '<div class="si-cr-list">' + pending.map(cardHtml).join('') + '</div>'
                : '<p class="studio-help">No tenés solicitudes pendientes.</p>') +
            (resolved.length ? '<details class="si-cr-history"><summary>Respondidas recientemente (' + resolved.length + ')</summary><ul>' +
                resolved.map(r => '<li><strong>' + esc(artistName(r)) + '</strong> · ' + esc(statusLabel(r.status)) +
                    (r.resolved_at ? ' · ' + esc(M.shortDate(r.resolved_at)) : '') + '</li>').join('') + '</ul></details>' : '');
        refreshIcons();
        if (state.open) {
            const card = host.querySelector('[data-change-request="' + cssEscape(state.open.id) + '"]');
            if (card) openForm(card, state.open.mode, false);
        }
    }

    function cardHtml(r) {
        const name = artistName(r);
        const summary = M.changeRequestSummary(r) || 'Sin condiciones cargadas todavía';
        const contract = r.membership && r.membership.has_contract
            ? '<p class="wo-help si-cr-note">Hay un contrato en curso: el rol y el reparto se cambian con una nueva versión del contrato.</p>' : '';
        return '<article class="studio-location-row si-cr-card" data-change-request="' + esc(r.id) + '" tabindex="-1" aria-labelledby="si-cr-name-' + esc(r.id) + '">' +
            '<div class="si-cr-head">' +
                '<span class="si-avatar si-avatar--invitation" aria-hidden="true">' + esc(M.initials(name)) + '</span>' +
                '<div class="si-cr-who"><h4 class="studio-item-title" id="si-cr-name-' + esc(r.id) + '">' + esc(name) + '</h4>' +
                    '<p class="wo-help">' + (r.artist && r.artist.username ? '@' + esc(r.artist.username) + ' · ' : '') + 'Pidió cambios el ' + esc(M.shortDate(r.created_at)) + '</p></div>' +
                '<span class="si-tag is-alert">Cambios pedidos</span>' +
            '</div>' +
            '<blockquote class="si-cr-quote">' + esc(r.message) + '</blockquote>' +
            '<p class="wo-help"><strong>Invitación vigente:</strong> ' + esc(summary) + '</p>' + contract +
            '<div class="studio-actions si-cr-actions">' +
                '<button type="button" class="wo-btn" data-cr-action="update"><i data-wo-icon="edit-2" aria-hidden="true"></i>Actualizar invitación</button>' +
                '<button type="button" class="wo-btn wo-btn--secondary" data-cr-action="decline">Mantener condiciones</button>' +
                (r.thread_id ? '<button type="button" class="wo-btn wo-btn--secondary" data-cr-action="thread" data-thread="' + esc(r.thread_id) + '"><i data-wo-icon="message-circle" aria-hidden="true"></i>Ver conversación</button>' : '') +
            '</div>' +
            '<div class="si-cr-form-host"></div>' +
        '</article>';
    }

    function updateFormHtml(r) {
        const m = r.membership || {};
        const d = r.details || {};
        const id = esc(r.id);
        const locked = !!m.has_contract;
        const roleOptions = Object.keys(M.ROLE_LABELS).map(role =>
            '<option value="' + role + '"' + (role === m.role ? ' selected' : '') + '>' + esc(M.ROLE_LABELS[role]) + '</option>').join('');
        const locationOptions = '<option value="">Sin asignar</option>' + state.locations.map(l =>
            '<option value="' + esc(l.id) + '"' + (l.id === m.location_id ? ' selected' : '') + '>' + esc(l.label || 'Sede') + (l.is_primary ? ' (principal)' : '') + '</option>').join('');
        return '<form class="studio-form si-cr-form" data-cr-form="update" novalidate>' +
            '<fieldset class="si-cr-fieldset"><legend class="studio-label">Condiciones de la invitación</legend>' +
            '<div class="si-cr-grid">' +
                field('Rol', '<select class="wo-select" id="cr-role-' + id + '" name="role"' + (locked ? ' disabled' : '') + '>' + roleOptions + '</select>', 'cr-role-' + id) +
                field('Sede', '<select class="wo-select" id="cr-location-' + id + '" name="location_id">' + locationOptions + '</select>', 'cr-location-' + id) +
                field('Split del artista (%)', '<input class="wo-input" id="cr-split-' + id + '" name="revenue_split_pct" type="number" min="0" max="100" step="1" inputmode="numeric" value="' + (m.revenue_split_pct == null ? '' : esc(Number(m.revenue_split_pct))) + '"' + (locked ? ' disabled' : '') + '>', 'cr-split-' + id) +
                field('Duración', '<input class="wo-input" id="cr-duration-' + id + '" name="duration_label" maxlength="80" placeholder="Ej.: 2 semanas" value="' + esc(d.duration_label || '') + '">', 'cr-duration-' + id) +
                field('Inicio', '<input class="wo-input" id="cr-start-' + id + '" name="proposed_start_date" type="date" value="' + esc(d.proposed_start_date || '') + '">', 'cr-start-' + id) +
                field('Fin', '<input class="wo-input" id="cr-end-' + id + '" name="proposed_end_date" type="date" value="' + esc(d.proposed_end_date || '') + '">', 'cr-end-' + id) +
            '</div>' +
            field('Mensaje de la invitación', '<textarea class="wo-textarea" id="cr-message-' + id + '" name="message" maxlength="2000" rows="3">' + esc(d.message || '') + '</textarea>', 'cr-message-' + id) +
            '</fieldset>' +
            field('Respuesta para el artista (opcional)', '<textarea class="wo-textarea" id="cr-reply-' + id + '" name="reply" maxlength="2000" rows="3" placeholder="Contale qué cambiaste."></textarea>', 'cr-reply-' + id) +
            '<p class="si-cr-error studio-status studio-status-error" role="alert" hidden></p>' +
            '<div class="studio-actions"><button type="submit" class="wo-btn">Guardar y responder</button>' +
            '<button type="button" class="wo-btn wo-btn--secondary" data-cr-action="cancel">Cancelar</button></div>' +
        '</form>';
    }

    function declineFormHtml(r) {
        const id = esc(r.id);
        return '<form class="studio-form si-cr-form" data-cr-form="decline" novalidate>' +
            field('Respuesta para el artista', '<textarea class="wo-textarea" id="cr-decline-' + id + '" name="reply" minlength="10" maxlength="2000" rows="3" required placeholder="Ej.: Por ahora mantenemos las fechas porque la agenda del estudio ya está cerrada."></textarea>', 'cr-decline-' + id) +
            '<p class="wo-help">La invitación sigue igual y el artista puede aceptarla o rechazarla.</p>' +
            '<p class="si-cr-error studio-status studio-status-error" role="alert" hidden></p>' +
            '<div class="studio-actions"><button type="submit" class="wo-btn">Enviar respuesta</button>' +
            '<button type="button" class="wo-btn wo-btn--secondary" data-cr-action="cancel">Cancelar</button></div>' +
        '</form>';
    }

    function field(label, control, id) {
        return '<div class="studio-field wo-field"><label class="studio-label wo-label" for="' + id + '">' + esc(label) + '</label>' + control + '</div>';
    }

    function openForm(card, mode, focus = true) {
        const request = findRequest(card.dataset.changeRequest);
        if (!request) return;
        state.open = { id: request.id, mode };
        const hostForm = card.querySelector('.si-cr-form-host');
        hostForm.innerHTML = mode === 'update' ? updateFormHtml(request) : declineFormHtml(request);
        card.querySelectorAll('[data-cr-action="update"],[data-cr-action="decline"]').forEach(b => {
            b.setAttribute('aria-expanded', String(b.dataset.crAction === mode));
        });
        if (focus) {
            const first = hostForm.querySelector('select:not([disabled]), input:not([disabled]), textarea');
            if (first) first.focus();
        }
    }

    function closeForm(card) {
        state.open = null;
        card.querySelector('.si-cr-form-host').innerHTML = '';
        card.querySelectorAll('[aria-expanded]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        const trigger = card.querySelector('[data-cr-action="update"]');
        if (trigger) trigger.focus();
    }

    function onClick(event) {
        const button = event.target.closest('[data-cr-action]');
        if (!button) return;
        const card = button.closest('[data-change-request]');
        const action = button.dataset.crAction;
        if (action === 'cancel') { if (card) closeForm(card); return; }
        if (action === 'thread') {
            window.location.hash = 'mensajes';
            const threadId = button.dataset.thread;
            window.setTimeout(() => {
                if (window.WeOtziStudioInbox) window.WeOtziStudioInbox.open(threadId);
            }, 60);
            return;
        }
        if (card && (action === 'update' || action === 'decline')) openForm(card, action);
    }

    async function onSubmit(event) {
        const form = event.target.closest('[data-cr-form]');
        if (!form) return;
        event.preventDefault();
        const card = form.closest('[data-change-request]');
        const request = findRequest(card && card.dataset.changeRequest);
        if (!request) return;
        const decision = form.dataset.crForm === 'update' ? 'accepted' : 'declined';
        const data = new FormData(form);
        const reply = String(data.get('reply') || '').trim();
        let changes = {};
        if (decision === 'accepted') {
            const values = {};
            M.CHANGE_FIELDS.forEach(key => {
                const control = form.elements.namedItem(key);
                if (control && !control.disabled) values[key] = control.value;
            });
            changes = M.buildChanges(values, request);
        }
        const problem = M.validateResponse(decision, reply, changes, request);
        const errorNode = form.querySelector('.si-cr-error');
        if (problem) { showFormError(errorNode, problem); return; }
        errorNode.hidden = true;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Enviando…';
        try {
            await D.StudioInbox.respondChangeRequest({ requestId: request.id, decision, reply: reply || null, changes });
            state.open = null;
            showStatus('success', decision === 'accepted'
                ? 'Invitación actualizada. Le avisamos a ' + artistName(request) + ' en su Inbox.'
                : 'Respuesta enviada. La invitación sigue con las mismas condiciones.');
            window.dispatchEvent(new CustomEvent('studio:change-request-resolved', { detail: { requestId: request.id, decision } }));
            await load();
        } catch (error) {
            console.error('[studio-changes] responder', error);
            showFormError(errorNode, M.friendlyError(error));
            submit.disabled = false;
            submit.textContent = decision === 'accepted' ? 'Guardar y responder' : 'Enviar respuesta';
        }
    }

    function showFormError(node, message) {
        node.textContent = message;
        node.hidden = false;
    }

    function focusRequest(requestId) {
        if (!requestId) return;
        const card = el('roster-change-requests').querySelector('[data-change-request="' + cssEscape(requestId) + '"]');
        if (!card) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        card.focus({ preventScroll: true });
    }

    function showStatus(kind, message) {
        const node = el('roster-status');
        if (!node) return;
        node.className = 'studio-status studio-status-' + kind;
        node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        node.textContent = message;
        node.hidden = false;
        window.setTimeout(() => { node.hidden = true; }, 6000);
    }

    function findRequest(id) { return state.requests.find(r => r.id === id) || null; }
    function artistName(r) { return (r.artist && (r.artist.name || (r.artist.username ? '@' + r.artist.username : ''))) || 'Artista'; }
    function statusLabel(status) {
        return ({ accepted: 'Invitación actualizada', declined: 'Condiciones mantenidas', superseded: 'Cerrada al responder la invitación' })[status] || status;
    }
    function refreshIcons() { if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') window.WoIcons.hydrate(document); }
    function cssEscape(value) { return window.CSS && CSS.escape ? CSS.escape(String(value || '')) : String(value || ''); }
    function el(id) { return document.getElementById(id); }
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
})();
