// ============================================
// WE ÖTZI - Support Dashboard · pestaña DISPUTAS (ronda 2 · P28, REQ-15)
// Cola de tickets de disputa (support_tickets kind='disputa'): las que piden
// el cliente o el artista sobre una sesión (cambio sin acuerdo, sesión pasada,
// ausencia…). Mientras el ticket está abierto la cotización figura "En
// disputa" y no se puede completar ni cambiar el acuerdo: soporte la destraba
// al resolver o cerrar acá. La resolución les llega por correo a las dos partes.
// Datos SOLO por WeotziData.SupportDisputes (/api/support/disputes…,
// lib/routes/soporte-disputas.js): el servidor autoriza al agente.
// Mismo patrón que DENUNCIAS: envuelve window.switchTab, pinta #dsq-panel y
// usa el drawer de la página. Reusa los estilos .rpq-* de
// /shared/css/support-dashboard-reports.css. /support/dashboard#disputas abre
// la pestaña (enlace del email a soporte).
// En Node (tests) solo exporta los helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'disputas';
    const STATUS_FILTERS = ['active', 'open', 'in_progress', 'waiting_user', 'resolved', 'closed', 'all'];
    const STATUS_FILTER_LABELS = {
        active: 'Activas', open: 'Abiertas', in_progress: 'En revisión', waiting_user: 'Esperando a las partes',
        resolved: 'Resueltas', closed: 'Cerradas', all: 'Todas'
    };
    const STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
    // 'open' no se elige a mano: una disputa cerrada se reabre pasándola a "En revisión".
    const SETTABLE = ['in_progress', 'waiting_user', 'resolved', 'closed'];
    const STATUS_LABELS = {
        open: 'Abierta', in_progress: 'En revisión', waiting_user: 'Esperando a las partes', resolved: 'Resuelta', closed: 'Cerrada'
    };
    const OUTCOME_LABELS = {
        a_favor_cliente: 'A favor del cliente', a_favor_artista: 'A favor del artista', acuerdo: 'Acuerdo entre las partes',
        sin_accion: 'Sin acción', resuelto: 'Resuelta'
    };
    const DESIRED_LABELS = {
        correccion: 'Corrección', reembolso_parcial: 'Reembolso parcial', reembolso_total: 'Reembolso total', mediacion: 'Mediación', otro: 'Otro'
    };
    const SCOPE_LABELS = { session: 'Sesión', quotation: 'Cotización' };
    const SESSION_STATUS_LABELS = {
        scheduled: 'Agendada', rescheduled: 'Reprogramada', completed: 'Realizada', cancelled: 'Cancelada', no_show: 'El cliente no se presentó'
    };
    const CONFIRMATION_LABELS = { pending: 'Sin confirmar por el cliente', confirmed: 'Confirmada por el cliente', change_requested: 'El cliente pidió un cambio' };
    const PRIORITY_LABELS = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
    const NOTE_MAX = 4000;
    const RESOLUTION_MIN = 10;
    const RESOLUTION_MAX = 4000;
    const MSG = {
        loading: 'Cargando…',
        empty: 'No hay disputas en este estado.',
        emptySearch: 'Nada coincide con la búsqueda.',
        unavailable: 'No pudimos leer las disputas. Revisa que tu usuario tenga acceso de soporte.',
        migration: 'Las disputas todavía no están disponibles: falta aplicar una migración.',
        generic: 'No pudimos completar la acción. Inténtalo de nuevo.',
        noteRequired: 'Escribe la nota antes de guardarla.',
        noteLong: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.',
        outcomeRequired: 'Indica cómo se resolvió la disputa.',
        resolutionRequired: 'Escribe qué se resolvió (mínimo ' + RESOLUTION_MIN + ' caracteres): las dos partes lo reciben por correo.',
        closeReasonRequired: 'Escribe por qué se cierra sin resolver (mínimo ' + RESOLUTION_MIN + ' caracteres): las dos partes lo reciben por correo.',
        resolutionLong: 'La resolución puede tener hasta ' + RESOLUTION_MAX + ' caracteres.'
    };

    // ---------------- helpers puros ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtDateTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function matchesSearch(item, term) {
        const t = String(term || '').trim().toLowerCase();
        if (!t) return true;
        const i = item || {};
        const a = i.opened_by || {};
        const b = i.counterpart || {};
        return [i.code, i.subject, i.reason_label, i.quote_id, i.quote_code, a.name, a.email, b.name, b.email]
            .some((v) => String(v || '').toLowerCase().indexOf(t) >= 0);
    }

    // { payload } | { error, field }. `current` es la disputa abierta en el drawer.
    function buildStatusPayload(status, outcome, resolution, current) {
        const s = String(status || '');
        if (SETTABLE.indexOf(s) < 0) return { error: MSG.generic, field: 'status' };
        if (s !== 'resolved' && s !== 'closed') return { payload: { status: s } };
        const c = current || {};
        const text = String(resolution == null ? '' : resolution).trim();
        const out = String(outcome || '');
        if (text.length > RESOLUTION_MAX) return { error: MSG.resolutionLong, field: 'resolution' };
        if (out && !OUTCOME_LABELS[out]) return { error: MSG.outcomeRequired, field: 'outcome' };
        const alreadyResolved = c.status === 'resolved' && String(c.resolution || '').trim() !== '';
        if (s === 'resolved') {
            if (!out) return { error: MSG.outcomeRequired, field: 'outcome' };
            if (text.length < RESOLUTION_MIN) return { error: MSG.resolutionRequired, field: 'resolution' };
        } else if (!alreadyResolved && text.length < RESOLUTION_MIN) {
            return { error: MSG.closeReasonRequired, field: 'resolution' };
        }
        const payload = { status: s };
        if (out) payload.outcome = out;
        if (text) payload.resolution = text;
        return { payload };
    }

    // { note } | { error }
    function buildNote(text) {
        const note = String(text == null ? '' : text).trim();
        if (!note) return { error: MSG.noteRequired };
        if (note.length > NOTE_MAX) return { error: MSG.noteLong };
        return { note };
    }

    function badge(status) {
        const s = STATUSES.indexOf(status) >= 0 ? status : 'open';
        return '<span class="rpq-badge rpq-badge--' + s + '">' + esc(STATUS_LABELS[s]) + '</span>';
    }

    function priorityTag(priority) {
        if (priority !== 'urgent') return '';
        return '<span class="rpq-badge rpq-badge--urgent">' + esc(PRIORITY_LABELS.urgent) + '</span>';
    }

    function fact(label, value) {
        if (value == null || value === '') return '';
        return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    function factHtml(label, html) {
        return html ? '<div><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>' : '';
    }

    function mailLink(email) {
        const e = String(email || '').trim();
        if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e)) return esc(e);
        return '<a class="rpq-a" href="mailto:' + esc(e) + '">' + esc(e) + '</a>';
    }

    function partyHtml(party) {
        const p = party && typeof party === 'object' ? party : {};
        return '<dl class="rpq-facts">'
            + fact('Nombre', p.name || 'Sin nombre') + fact('Rol', p.role_label)
            + factHtml('Email', p.email ? mailLink(p.email) : '')
            + fact('Usuario', p.username ? '@' + p.username : '')
            + fact('Tiene cuenta', p.user_id ? 'Sí' : 'No')
            + fact('ID de usuario', p.user_id)
            + '</dl>';
    }

    function sessionHtml(session) {
        const s = session && typeof session === 'object' ? session : null;
        if (!s) return '';
        return '<div class="drawer-section rpq-section"><p class="rpq-section-title">Sesión en disputa</p>'
            + '<dl class="rpq-facts">'
            + fact('Sesión', s.session_number != null ? 'N.º ' + s.session_number : '')
            + fact('Fecha', s.session_date ? fmtDateTime(s.session_date) : '')
            + fact('Duración', s.duration_hours ? String(s.duration_hours).replace('.', ',') + ' h' : '')
            + fact('Estado', SESSION_STATUS_LABELS[s.status] || s.status)
            + fact('Confirmación', CONFIRMATION_LABELS[s.client_confirmation] || '')
            + fact('Lugar', s.location)
            + '</dl></div>';
    }

    function logHtml(messages) {
        const list = Array.isArray(messages) ? messages : [];
        if (!list.length) return '<p class="rpq-text rpq-muted">Todavía no hay notas ni actividad.</p>';
        return '<ul class="rpq-log">' + list.map((m) => {
            const who = m.author_role === 'support'
                ? 'Soporte' + (m.author_name ? ' · ' + m.author_name : '') + (m.mine ? ' (tú)' : '')
                : m.author_role === 'system' ? 'Sistema' : m.author_role === 'artist' ? 'Artista' : 'Cliente';
            return '<li><span class="rpq-muted">' + esc(fmtDateTime(m.created_at)) + ' · ' + esc(who)
                + (m.is_internal ? ' · nota interna' : '') + '</span><p class="rpq-text rpq-pre">' + esc(m.body) + '</p></li>';
        }).join('') + '</ul>';
    }

    function statusFormHtml(dispute) {
        const current = STATUSES.indexOf(dispute.status) >= 0 ? dispute.status : 'open';
        const closing = current === 'resolved' || current === 'closed';
        const selected = SETTABLE.indexOf(current) >= 0 ? current : 'in_progress';
        const options = SETTABLE.map((s) => '<option value="' + s + '"' + (s === selected ? ' selected' : '') + '>' + esc(STATUS_LABELS[s]) + '</option>').join('');
        const outcomes = '<option value="">Elige un resultado</option>' + Object.keys(OUTCOME_LABELS).map((o) =>
            '<option value="' + o + '"' + (dispute.resolution_outcome === o ? ' selected' : '') + '>' + esc(OUTCOME_LABELS[o]) + '</option>').join('');
        return '<form class="drawer-section rpq-section" data-dsq-status-form novalidate>'
            + '<p class="rpq-section-title">Gestión</p>'
            + (current === 'open'
                ? '<div class="rpq-actions"><button type="button" class="action-btn rpq-btn" data-dsq-take>TOMAR LA DISPUTA</button></div>'
                : '')
            + '<div class="rpq-field"><label for="dsq-new-status">Estado</label>'
            + '<select id="dsq-new-status" class="rpq-select rpq-select--block">' + options + '</select></div>'
            + '<div class="rpq-field" id="dsq-outcome-field"' + (closing ? '' : ' hidden') + '><label for="dsq-outcome">Resultado</label>'
            + '<select id="dsq-outcome" class="rpq-select rpq-select--block">' + outcomes + '</select></div>'
            + '<div class="rpq-field" id="dsq-resolution-field"' + (closing ? '' : ' hidden') + '><label for="dsq-resolution">Resolución</label>'
            + '<textarea id="dsq-resolution" class="rpq-input" rows="4" maxlength="' + RESOLUTION_MAX + '" aria-describedby="dsq-resolution-help">'
            + esc(dispute.resolution || '') + '</textarea>'
            + '<p class="rpq-help" id="dsq-resolution-help">Qué se decidió y cómo siguen. Al resolver o cerrar, las dos partes reciben este texto por correo y la cotización deja de figurar en disputa.</p></div>'
            + '<p id="dsq-status-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn rpq-btn--accent">GUARDAR ESTADO</button></div>'
            + '</form>';
    }

    function detailHtml(dispute) {
        const d = dispute && typeof dispute === 'object' ? dispute : {};
        const scope = SCOPE_LABELS[d.scope] || 'Disputa';
        return '<div id="dsq-detail" class="rpq-detail" data-dsq-ticket="' + esc(d.ticket_id) + '">'
            + '<p class="rpq-eyebrow">Disputa · ' + esc(scope) + (d.code ? ' · ' + esc(d.code) : '') + '</p>'
            + '<h2 id="dsq-detail-title" class="rpq-title" tabindex="-1">' + esc(d.reason_label || d.subject || 'Disputa') + '</h2>'
            + '<p class="rpq-sub">' + badge(d.status) + priorityTag(d.priority)
            + '<span>Abierta ' + esc(fmtDateTime(d.created_at)) + '</span></p>'
            + '<div class="drawer-section rpq-section">'
            + '<p class="rpq-section-title">Reclamo</p>'
            + '<dl class="rpq-facts">'
            + fact('Ticket', d.code) + fact('Motivo', d.reason_label) + fact('Prioridad', PRIORITY_LABELS[d.priority] || '')
            + fact('Qué pide', DESIRED_LABELS[d.desired_outcome] || '')
            + fact('Cotización', d.quote_code || d.quote_id)
            + (d.quote_id && d.quote_code && d.quote_id !== d.quote_code ? fact('Referencia interna', d.quote_id) : '')
            + fact('La cotización figura', d.dispute_status === 'open' ? 'En disputa' : d.dispute_status === 'resolved' ? 'Disputa resuelta' : '')
            + (d.resolved_at ? fact('Resuelta', fmtDateTime(d.resolved_at)) : '')
            + (d.closed_at ? fact('Cerrada', fmtDateTime(d.closed_at)) : '')
            + (d.resolution_outcome ? fact('Resultado', OUTCOME_LABELS[d.resolution_outcome] || d.resolution_outcome) : '')
            + '</dl>'
            + (d.subject ? '<p class="rpq-label">Asunto</p><p class="rpq-text">' + esc(d.subject) + '</p>' : '')
            + '<p class="rpq-label">Descripción</p><p class="rpq-text rpq-pre">' + esc(d.description || '') + '</p>'
            + '</div>'
            + sessionHtml(d.session)
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">Abrió la disputa</p>' + partyHtml(d.opened_by) + '</div>'
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">La otra parte</p>' + partyHtml(d.counterpart) + '</div>'
            + statusFormHtml(d)
            + '<form class="drawer-section rpq-section" data-dsq-note-form novalidate>'
            + '<p class="rpq-section-title">Notas internas y actividad</p>'
            + logHtml(d.messages)
            + '<div class="rpq-field"><label for="dsq-note">Nueva nota interna</label>'
            + '<textarea id="dsq-note" class="rpq-input" rows="3" maxlength="' + NOTE_MAX + '" aria-describedby="dsq-note-help"></textarea>'
            + '<p class="rpq-help" id="dsq-note-help">Solo la ve el equipo de soporte. Las partes no la reciben.</p></div>'
            + '<p id="dsq-note-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn">GUARDAR NOTA</button></div>'
            + '</form>'
            + '</div>';
    }

    function rowHtml(item) {
        const i = item || {};
        const a = i.opened_by || {};
        const b = i.counterpart || {};
        const about = [SCOPE_LABELS[i.scope] || '', i.quote_code || i.quote_id || ''].filter(Boolean).join(' · ');
        return '<div class="rpq-row" role="row" tabindex="0" data-dsq-id="' + esc(i.ticket_id) + '" aria-label="Abrir disputa ' + esc(i.code || '') + '">'
            + '<div class="rpq-cell rpq-ticket" role="cell"><span class="rpq-name">' + esc(i.code || '-') + '</span>' + priorityTag(i.priority) + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Motivo"><span class="rpq-name">' + esc(i.reason_label || '-') + '</span>'
            + '<span class="rpq-muted">' + esc(about) + '</span></div>'
            + '<div class="rpq-cell" role="cell" data-label="Abrió"><span class="rpq-name">' + esc(a.name || 'Sin nombre') + '</span>'
            + '<span class="rpq-muted">' + esc(a.role_label || '') + '</span></div>'
            + '<div class="rpq-cell" role="cell" data-label="La otra parte"><span class="rpq-name">' + esc(b.name || 'Sin nombre') + '</span>'
            + '<span class="rpq-muted">' + esc(b.role_label || '') + '</span></div>'
            + '<div class="rpq-cell" role="cell" data-label="Estado">' + badge(i.status) + '</div>'
            + '<div class="rpq-cell rpq-muted" role="cell" data-label="Abierta">' + esc(fmtDateTime(i.created_at)) + '</div>'
            + '</div>';
    }

    const pure = {
        TAB, MSG, STATUSES, SETTABLE, STATUS_LABELS, STATUS_FILTERS, OUTCOME_LABELS,
        esc, fmtDateTime, matchesSearch, buildStatusPayload, buildNote,
        partyHtml, sessionHtml, logHtml, statusFormHtml, detailHtml, rowHtml
    };

    if (!root || !root.document) return { boot() {}, _internal: pure };

    // ---------------- estado ----------------

    const state = { status: 'active', search: '', items: [], loaded: false, loading: false, error: null, migration: false, seq: 0, detail: null, busy: false };
    let active = false;
    let previousSwitch = null;
    const hiddenSiblings = new Map();
    const $ = (id) => root.document.getElementById(id);
    function repo() { return root.WeotziData && root.WeotziData.SupportDisputes; }

    // ---------------- panel ----------------

    function panelHtml() {
        const statusOpts = STATUS_FILTERS.map((f) => '<option value="' + f + '"' + (f === state.status ? ' selected' : '') + '>' + esc(STATUS_FILTER_LABELS[f]) + '</option>').join('');
        return '<div class="rpq-toolbar">'
            + '<label class="rpq-sr" for="dsq-status">Estado</label><select id="dsq-status" class="rpq-select">' + statusOpts + '</select>'
            + '<div class="rpq-search"><label class="rpq-sr" for="dsq-search">Buscar</label>'
            + '<input type="search" id="dsq-search" class="rpq-input" placeholder="Buscar por ticket, nombre, email o cotización" autocomplete="off"></div>'
            + '<button type="button" class="action-btn rpq-btn" id="dsq-refresh">ACTUALIZAR</button>'
            + '</div>'
            + '<p class="rpq-intro">Mientras una disputa está activa, la cotización figura “En disputa”: no se puede completar ni cambiar el acuerdo. Se destraba cuando la resuelves o la cierras, y las dos partes reciben tu resolución por correo.</p>'
            + '<div class="rpq-table" role="table" aria-label="Disputas">'
            + '<div class="rpq-head" role="row">'
            + ['Ticket', 'Motivo', 'Abrió', 'La otra parte', 'Estado', 'Abierta'].map((h) => '<span role="columnheader">' + h + '</span>').join('')
            + '</div>'
            + '<div id="dsq-body" aria-live="polite" aria-busy="true"><div class="rpq-empty">' + MSG.loading + '</div></div>'
            + '</div>';
    }

    function ensurePanel() {
        let panel = $('dsq-panel');
        if (panel) return panel;
        const table = $('table-container');
        if (!table || !table.parentNode) return null;
        panel = root.document.createElement('section');
        panel.id = 'dsq-panel';
        panel.className = 'rpq-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Disputas');
        panel.innerHTML = panelHtml();
        table.insertAdjacentElement('afterend', panel);
        $('dsq-status').addEventListener('change', (e) => {
            state.status = STATUS_FILTERS.indexOf(e.target.value) >= 0 ? e.target.value : 'active';
            state.items = []; state.loaded = false; load();
        });
        $('dsq-search').addEventListener('input', (e) => { state.search = e.target.value || ''; renderRows(); });
        $('dsq-refresh').addEventListener('click', () => load());
        const body = $('dsq-body');
        body.addEventListener('click', (e) => {
            const row = e.target.closest('[data-dsq-id]');
            if (row) openDetail(row.dataset.dsqId);
        });
        body.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('[data-dsq-id]');
            if (!row) return;
            e.preventDefault();
            openDetail(row.dataset.dsqId);
        });
        return panel;
    }

    function renderRows() {
        const body = $('dsq-body');
        if (!body) return;
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        if (state.loading && !state.items.length) { body.innerHTML = '<div class="rpq-empty">' + MSG.loading + '</div>'; return; }
        if (state.error) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(state.error) + '</div>'; return; }
        if (state.migration) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(MSG.migration) + '</div>'; return; }
        const rows = state.items.filter((i) => matchesSearch(i, state.search));
        if (!rows.length) { body.innerHTML = '<div class="rpq-empty">' + (state.items.length ? MSG.emptySearch : MSG.empty) + '</div>'; return; }
        body.innerHTML = rows.map(rowHtml).join('');
    }

    function siblingsAfterTabs() {
        const nav = root.document.querySelector('.tab-navigation');
        const out = [];
        let el = nav ? nav.nextElementSibling : null;
        while (el) { out.push(el); el = el.nextElementSibling; }
        return out;
    }

    function markActive() {
        root.document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === TAB));
        root.document.querySelectorAll('.nav-menu-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === TAB));
    }

    function enter() {
        const panel = ensurePanel();
        if (!panel) return;
        // Las otras pestañas modulares ocultan sus paneles al salir.
        siblingsAfterTabs().forEach((el) => {
            if (el === panel) return;
            if (!hiddenSiblings.has(el)) hiddenSiblings.set(el, el.style.display || '');
            el.style.display = 'none';
        });
        panel.hidden = false;
        active = true;
        markActive();
        if (!state.loaded && !state.loading) load(); else renderRows();
    }

    function leave() {
        if (!active) return;
        active = false;
        const panel = $('dsq-panel');
        if (panel) panel.hidden = true;
        hiddenSiblings.forEach((display, el) => { el.style.display = display; });
        hiddenSiblings.clear();
    }

    function switchTab(tabName) {
        if (tabName === TAB) {
            const tickets = root.SupportDashboardTickets;
            if (tickets && typeof tickets.hide === 'function') tickets.hide();
            enter();
            return undefined;
        }
        leave();
        return previousSwitch ? previousSwitch.apply(this, arguments) : undefined;
    }

    function onTabClick(e) {
        const trigger = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
        if (!trigger || !trigger.classList) return;
        if (!trigger.classList.contains('tab-btn') && !trigger.classList.contains('nav-menu-item')) return;
        if (trigger.dataset.tab === TAB) {
            e.preventDefault();
            // Después de que las otras pestañas modulares terminen de salir.
            root.setTimeout(() => root.switchTab(TAB), 0);
        } else {
            // Captura en window: sale ANTES de que otra pestaña modular entre.
            leave();
        }
    }

    // ---------------- datos ----------------

    function setBadge(n) {
        const count = Number(n) || 0;
        root.document.querySelectorAll('.dsq-count').forEach((el) => {
            el.textContent = String(count);
            el.hidden = !count;
            el.setAttribute('aria-label', count + ' disputas activas');
        });
    }

    async function load() {
        const R = repo();
        const seq = ++state.seq;
        state.loading = true;
        renderRows();
        let res = null;
        try { res = R ? await R.list({ status: state.status }) : null; } catch (_) { res = null; }
        if (seq !== state.seq) return;
        state.loading = false;
        state.loaded = true;
        if (res && res.ok) {
            state.items = Array.isArray(res.json.disputes) ? res.json.disputes : [];
            state.error = null;
            state.migration = res.json.migration_pending === true;
            if (res.json.active_count != null) setBadge(res.json.active_count);
        } else {
            state.items = [];
            state.migration = false;
            state.error = (res && res.json && res.json.error && res.status !== 0 && res.status !== 500) ? res.json.error : MSG.unavailable;
        }
        renderRows();
    }

    // ---------------- detalle ----------------

    function paint(keepFocus) {
        const content = $('drawer-content');
        if (!content || !state.detail) return;
        content.innerHTML = state.detail.dispute
            ? detailHtml(state.detail.dispute)
            : '<div id="dsq-detail" class="rpq-detail"><p class="rpq-eyebrow">Disputa</p>'
                + '<h2 id="dsq-detail-title" class="rpq-title" tabindex="-1">' + esc(state.detail.code || 'Disputa') + '</h2>'
                + '<p class="rpq-text' + (state.detail.error ? ' is-error" role="alert' : '') + '">' + esc(state.detail.error || MSG.loading) + '</p></div>';
        if (!keepFocus) {
            const title = $('dsq-detail-title');
            if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
        }
    }

    async function openDetail(ticketId) {
        const toggle = $('drawer-toggle');
        const item = state.items.find((i) => String(i.ticket_id) === String(ticketId));
        if (!toggle || !ticketId) return;
        const detail = { ticketId: String(ticketId), code: item ? item.code : '', dispute: null, error: null };
        state.detail = detail;
        paint();
        toggle.checked = true;
        const res = await repo().get(detail.ticketId);
        if (state.detail !== detail) return;
        if (res && res.ok && res.json.dispute) detail.dispute = res.json.dispute;
        else detail.error = (res && res.json && res.json.error) || MSG.generic;
        paint(true);
    }

    function feedback(id, kind, text) {
        const el = $(id);
        if (!el) return;
        el.className = 'rpq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    function toggleClosingFields() {
        const select = $('dsq-new-status');
        if (!select) return;
        const closing = select.value === 'resolved' || select.value === 'closed';
        ['dsq-outcome-field', 'dsq-resolution-field'].forEach((id) => { const el = $(id); if (el) el.hidden = !closing; });
    }

    async function sendStatus(payload) {
        const d = state.detail;
        state.busy = true;
        feedback('dsq-status-feedback', 'info', 'Guardando…');
        const res = await repo().setStatus(d.ticketId, payload);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) {
            feedback('dsq-status-feedback', 'error', (res && res.json && res.json.error) || MSG.generic);
            return;
        }
        const fresh = await repo().get(d.ticketId);
        if (state.detail !== d) return;
        if (fresh && fresh.ok && fresh.json.dispute) d.dispute = fresh.json.dispute;
        else Object.assign(d.dispute, { status: res.json.ticket.status, resolution: res.json.ticket.resolution, resolution_outcome: res.json.ticket.resolution_outcome });
        paint(true);
        const closed = d.dispute.status === 'resolved' || d.dispute.status === 'closed';
        feedback('dsq-status-feedback', 'success', 'Estado guardado: ' + (STATUS_LABELS[d.dispute.status] || d.dispute.status) + '.'
            + (closed ? (res.json.parties_notified ? ' Les avisamos a las dos partes por correo.' : ' No pudimos confirmar el correo a las partes: escríbeles con la resolución.') : ''));
        load();
    }

    function saveStatus() {
        const d = state.detail;
        if (!d || !d.dispute || state.busy) return;
        const built = buildStatusPayload($('dsq-new-status').value, $('dsq-outcome').value, $('dsq-resolution').value, d.dispute);
        if (built.error) {
            const field = { outcome: 'dsq-outcome', resolution: 'dsq-resolution', status: 'dsq-new-status' }[built.field];
            const el = field && $(field);
            if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
            feedback('dsq-status-feedback', 'error', built.error);
            return;
        }
        sendStatus(built.payload);
    }

    function take() {
        const d = state.detail;
        if (!d || !d.dispute || state.busy) return;
        sendStatus({ status: 'in_progress' });
    }

    async function saveNote() {
        const d = state.detail;
        if (!d || !d.dispute || state.busy) return;
        const input = $('dsq-note');
        const built = buildNote(input ? input.value : '');
        if (built.error) {
            if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
            feedback('dsq-note-feedback', 'error', built.error);
            return;
        }
        state.busy = true;
        feedback('dsq-note-feedback', 'info', 'Guardando…');
        const res = await repo().addNote(d.ticketId, built.note);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) {
            feedback('dsq-note-feedback', 'error', (res && res.json && res.json.error) || MSG.generic);
            return;
        }
        if (res.json.message) d.dispute.messages = (d.dispute.messages || []).concat(res.json.message);
        paint(true);
        feedback('dsq-note-feedback', 'success', 'Nota guardada.');
    }

    function onDrawerSubmit(e) {
        if (!$('dsq-detail')) return;
        if (e.target.closest('[data-dsq-status-form]')) { e.preventDefault(); saveStatus(); return; }
        if (e.target.closest('[data-dsq-note-form]')) { e.preventDefault(); saveNote(); }
    }

    function onDrawerClick(e) {
        if (!$('dsq-detail') || !e.target || !e.target.closest) return;
        if (e.target.closest('[data-dsq-take]')) { e.preventDefault(); take(); }
    }

    function onDrawerChange(e) {
        if (!$('dsq-detail') || !e.target) return;
        if (e.target.id === 'dsq-new-status') toggleClosingFields();
        if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
    }

    // ---------------- arranque ----------------

    // /support/dashboard#disputas (enlace del email a soporte): abre la pestaña
    // cuando el panel ya validó la sesión del agente.
    function openFromHash() {
        if (String(root.location.hash || '').toLowerCase() !== '#' + TAB) return;
        let tries = 0;
        const timer = root.setInterval(async () => {
            tries += 1;
            const R = repo();
            const ready = R && typeof root.switchTab === 'function' && $('table-container') && await R.hasSession();
            if (ready) { root.clearInterval(timer); if (!active) root.switchTab(TAB); } else if (tries >= 40) root.clearInterval(timer);
        }, 300);
    }

    function boot() {
        const doc = root.document;
        if (!doc || root.__dsqBooted) return;
        root.__dsqBooted = true;
        previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = switchTab;
        root.addEventListener('click', onTabClick, true);
        const drawer = $('drawer-content');
        if (drawer) {
            drawer.addEventListener('submit', onDrawerSubmit);
            drawer.addEventListener('click', onDrawerClick);
            drawer.addEventListener('change', onDrawerChange);
            drawer.addEventListener('input', (e) => { if ($('dsq-detail') && e.target && e.target.removeAttribute) e.target.removeAttribute('aria-invalid'); });
        }
        const start = () => {
            openFromHash();
            // Contador de la pestaña: una lectura liviana cuando ya hay sesión.
            root.setTimeout(async () => {
                const R = repo();
                if (state.loaded || state.loading || !R || !(await R.hasSession())) return;
                const res = await R.list({ status: 'active' });
                if (res && res.ok && res.json.active_count != null) setBadge(res.json.active_count);
            }, 2600);
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
        root.SupportDisputesQueue = { refresh: load, open: openDetail, isActive: () => active };
    }

    return { boot, _internal: pure };
}));
