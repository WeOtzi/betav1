// ============================================
// WE ÖTZI - Support Dashboard · pestaña FEEDBACK (beta cerrada)
// Lo que mandan tatuadores, clientes y estudios con el botón "Comentarios" y
// las encuestas cortas (public.beta_feedback). Arriba el resumen (por tipo de
// cuenta, por tipo y promedios por encuesta); abajo la lista filtrable, el
// detalle con capturas, el cambio de estado con nota interna y la exportación
// a CSV. Datos SOLO por WeotziData.SupportFeedback (/api/support/feedback…,
// lib/routes/feedback.js): el servidor autoriza al agente y firma las capturas.
// Mismo patrón que DENUNCIAS: envuelve window.switchTab, pinta #fbq-panel y usa
// el drawer de la página. Estilos: reutiliza los de support-dashboard-reports.css
// (rpq-*) y suma /shared/css/support-dashboard-feedback.css.
// /support/dashboard#feedback abre la pestaña. En Node (tests) solo exporta los
// helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'feedback';
    const ROLES = ['artist', 'client', 'studio'];
    const ROLE_LABELS = { artist: 'Tatuador', client: 'Cliente', studio: 'Estudio' };
    const KINDS = ['bug', 'idea', 'comment', 'survey'];
    const KIND_LABELS = { bug: 'Error', idea: 'Idea', comment: 'Comentario', survey: 'Encuesta' };
    const STATUSES = ['new', 'seen', 'in_progress', 'done', 'wontfix'];
    const STATUS_LABELS = { new: 'Nuevo', seen: 'Visto', in_progress: 'En curso', done: 'Resuelto', wontfix: 'No se hará' };
    const SURVEY_LABELS = {
        registro_tatuador: 'Registro de tatuador',
        registro_cliente: 'Registro de cliente',
        registro_estudio: 'Registro de estudio',
        cotizacion_enviada: 'Cotización enviada',
        propuesta_enviada: 'Propuesta enviada',
        primera_sesion_agendada: 'Primera sesión agendada',
        primer_tatuador_equipo: 'Primer tatuador en el equipo'
    };
    const NOTE_MAX = 4000;
    const PAGE_SIZE = 25;
    const MSG = {
        loading: 'Cargando…',
        empty: 'No hay feedback con estos filtros.',
        unavailable: 'No pudimos leer el feedback. Revisa que tu usuario tenga acceso de soporte.',
        migration: 'El feedback todavía no está disponible: falta aplicar la migración 20261117120000.',
        generic: 'No pudimos completar la acción. Inténtalo de nuevo.',
        noteLong: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.',
        exportEmpty: 'No pudimos exportar el CSV.'
    };

    // ---------------- helpers puros ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function safeUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
        } catch (_) { return ''; }
    }

    function fmtDateTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function excerpt(text, max) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
    }

    function stars(rating) {
        const n = Number(rating);
        return Number.isInteger(n) && n >= 1 && n <= 5 ? n + ' / 5' : '';
    }

    function badge(status) {
        const s = STATUSES.indexOf(status) >= 0 ? status : 'new';
        return '<span class="fbq-badge fbq-badge--' + s + '">' + esc(STATUS_LABELS[s]) + '</span>';
    }

    function kindTag(kind) {
        const k = KINDS.indexOf(kind) >= 0 ? kind : 'comment';
        return '<span class="fbq-kind fbq-kind--' + k + '">' + esc(KIND_LABELS[k]) + '</span>';
    }

    // Filtros del panel → filtros del repositorio (sin vacíos).
    function cleanFilters(f) {
        const src = f || {};
        const out = {};
        if (ROLES.indexOf(src.role) >= 0) out.role = src.role;
        if (KINDS.indexOf(src.kind) >= 0) out.kind = src.kind;
        if (STATUSES.indexOf(src.status) >= 0) out.status = src.status;
        if (SURVEY_LABELS[src.survey_key]) out.survey_key = src.survey_key;
        const q = String(src.q || '').trim().slice(0, 80);
        if (q) out.q = q;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(src.from || ''))) out.from = src.from;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(src.to || ''))) out.to = src.to;
        out.page = Math.max(1, Number(src.page) || 1);
        out.page_size = PAGE_SIZE;
        return out;
    }

    function pageInfo(total, page, size) {
        const t = Math.max(0, Number(total) || 0);
        const pages = Math.max(1, Math.ceil(t / (size || PAGE_SIZE)));
        const p = Math.min(Math.max(1, Number(page) || 1), pages);
        return { total: t, pages, page: p, hasPrev: p > 1, hasNext: p < pages };
    }

    function countList(obj, labels) {
        return Object.keys(labels).map((k) => '<li><span>' + esc(labels[k]) + '</span><strong>' + esc((obj && obj[k]) || 0) + '</strong></li>').join('');
    }

    function summaryHtml(summary) {
        const s = summary && typeof summary === 'object' ? summary : null;
        if (!s) return '<p class="rpq-text rpq-muted">' + esc(MSG.loading) + '</p>';
        const surveys = Array.isArray(s.surveys) ? s.surveys : [];
        const ease = s.ease || {};
        const rows = surveys.map((sv) => '<tr><th scope="row">' + esc(SURVEY_LABELS[sv.key] || sv.key)
            + '<span class="rpq-muted">' + esc(sv.question || '') + '</span></th>'
            + '<td>' + esc(sv.answered || 0) + '</td>'
            + '<td>' + esc(sv.average == null ? '—' : String(sv.average).replace('.', ',')) + '</td>'
            + '<td>' + esc(sv.dismissed || 0) + '</td></tr>').join('');
        return '<div class="fbq-cards">'
            + '<div class="fbq-card"><p class="fbq-card-title">Total</p><p class="fbq-big">' + esc(s.total || 0) + '</p>'
            + '<p class="rpq-muted">Facilidad promedio: ' + esc(ease.average == null ? '—' : String(ease.average).replace('.', ',') + ' / 5') + '</p></div>'
            + '<div class="fbq-card"><p class="fbq-card-title">Por tipo de cuenta</p><ul class="fbq-counts">' + countList(s.by_role, ROLE_LABELS) + '</ul></div>'
            + '<div class="fbq-card"><p class="fbq-card-title">Por tipo</p><ul class="fbq-counts">' + countList(s.by_kind, KIND_LABELS) + '</ul></div>'
            + '<div class="fbq-card"><p class="fbq-card-title">Por estado</p><ul class="fbq-counts">' + countList(s.by_status, STATUS_LABELS) + '</ul></div>'
            + '</div>'
            + '<div class="fbq-surveys"><table class="fbq-table"><caption>Encuestas</caption>'
            + '<thead><tr><th scope="col">Encuesta</th><th scope="col">Respuestas</th><th scope="col">Promedio (1–5)</th><th scope="col">“Ahora no”</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>';
    }

    function rowHtml(item) {
        const i = item || {};
        const what = i.kind === 'survey'
            ? (SURVEY_LABELS[i.survey_key] || i.survey_key || 'Encuesta') + (i.rating ? ' · ' + stars(i.rating) : '') + (i.message ? ' · ' + excerpt(i.message, 80) : '')
            : excerpt(i.message, 120);
        return '<div class="rpq-row fbq-row" role="row" tabindex="0" data-fbq-id="' + esc(i.id) + '" aria-label="Abrir feedback de ' + esc((i.user && i.user.name) || 'Sin nombre') + '">'
            + '<div class="rpq-cell rpq-muted" role="cell" data-label="Recibido">' + esc(fmtDateTime(i.created_at)) + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Tipo">' + kindTag(i.kind)
            + (i.kind !== 'survey' && i.rating ? '<span class="rpq-muted">Facilidad ' + esc(stars(i.rating)) + '</span>' : '') + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Cuenta"><span class="rpq-name">' + esc((i.user && i.user.name) || 'Sin nombre') + '</span>'
            + '<span class="rpq-muted">' + esc(i.role_label || ROLE_LABELS[i.role] || '') + '</span></div>'
            + '<div class="rpq-cell fbq-msg" role="cell" data-label="Mensaje">' + esc(what || '—')
            + (i.attachments_count ? '<span class="rpq-muted"> · ' + esc(i.attachments_count) + (i.attachments_count === 1 ? ' captura' : ' capturas') + '</span>' : '') + '</div>'
            + '<div class="rpq-cell rpq-muted" role="cell" data-label="Página">' + esc(i.page_path || '—') + '</div>'
            + '<div class="rpq-cell" role="cell" data-label="Estado">' + badge(i.status) + '</div>'
            + '</div>';
    }

    function fact(label, value) {
        if (value == null || value === '') return '';
        return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    function mailLink(email) {
        const e = String(email || '').trim();
        if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e)) return esc(e);
        return '<a class="rpq-a" href="mailto:' + esc(e) + '">' + esc(e) + '</a>';
    }

    function capturesHtml(list) {
        const files = Array.isArray(list) ? list : [];
        if (!files.length) return '<p class="rpq-text rpq-muted">Sin capturas.</p>';
        return '<ul class="rpq-thumbs">' + files.map((f, i) => {
            const href = safeUrl(f && f.url);
            const name = (f && f.name) || ('Captura ' + (i + 1));
            if (!href) return '<li class="rpq-thumb rpq-thumb--missing">' + esc(name) + ' · no disponible</li>';
            return '<li class="rpq-thumb"><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir ' + esc(name) + '">'
                + '<img src="' + esc(href) + '" alt="" loading="lazy" decoding="async"><span>' + esc(name) + '</span></a></li>';
        }).join('') + '</ul>';
    }

    function detailHtml(item) {
        const i = item || {};
        const user = i.user || {};
        const ctx = i.context || {};
        const options = STATUSES.map((s) => '<option value="' + s + '"' + (s === i.status ? ' selected' : '') + '>' + esc(STATUS_LABELS[s]) + '</option>').join('');
        const title = i.kind === 'survey' ? (SURVEY_LABELS[i.survey_key] || 'Encuesta') : (KIND_LABELS[i.kind] || 'Feedback');
        return '<div id="fbq-detail" class="rpq-detail" data-fbq-item="' + esc(i.id) + '">'
            + '<p class="rpq-eyebrow">Feedback de la beta · ' + esc(KIND_LABELS[i.kind] || '') + '</p>'
            + '<h2 id="fbq-detail-title" class="rpq-title" tabindex="-1">' + esc(title) + '</h2>'
            + '<p class="rpq-sub">' + badge(i.status) + '<span>Recibido ' + esc(fmtDateTime(i.created_at)) + '</span></p>'
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">Mensaje</p>'
            + (i.kind === 'survey' ? '<p class="rpq-label">Pregunta</p><p class="rpq-text">' + esc(i.survey_question || '') + '</p>' : '')
            + '<dl class="rpq-facts">'
            + fact(i.kind === 'survey' ? 'Calificación' : 'Facilidad', stars(i.rating) || 'Sin calificar')
            + (i.dismissed ? fact('Respuesta', '“Ahora no”') : '')
            + '</dl>'
            + (i.message ? '<p class="rpq-label">Texto</p><p class="rpq-text rpq-pre">' + esc(i.message) + '</p>' : '<p class="rpq-text rpq-muted">Sin comentario.</p>')
            + '<p class="rpq-label">Capturas</p>' + capturesHtml(i.attachments)
            + '</div>'
            + '<div class="drawer-section rpq-section"><p class="rpq-section-title">Quién y dónde</p><dl class="rpq-facts">'
            + fact('Nombre', user.name) + fact('Tipo de cuenta', i.role_label || ROLE_LABELS[i.role] || '')
            + (user.email ? '<div><dt>Correo</dt><dd>' + mailLink(user.email) + '</dd></div>' : '')
            + fact('ID de usuario', user.id)
            + fact('Página', i.page_path) + fact('Título de la página', i.page_title)
            + fact('Idioma', ctx.lang) + fact('Pantalla', ctx.viewport ? ctx.viewport.w + ' × ' + ctx.viewport.h : '')
            + fact('Navegador', ctx.ua)
            + '</dl></div>'
            + '<form class="drawer-section rpq-section" data-fbq-form novalidate>'
            + '<p class="rpq-section-title">Gestión</p>'
            + '<div class="rpq-field"><label for="fbq-new-status">Estado</label>'
            + '<select id="fbq-new-status" class="rpq-select rpq-select--block">' + options + '</select></div>'
            + '<div class="rpq-field"><label for="fbq-note">Nota interna</label>'
            + '<textarea id="fbq-note" class="rpq-input" rows="3" maxlength="' + NOTE_MAX + '" aria-describedby="fbq-note-help">' + esc(i.support_note || '') + '</textarea>'
            + '<p class="rpq-help" id="fbq-note-help">Solo la ve el equipo de soporte. Por ejemplo: a qué tarea pasó o por qué no se hará.</p></div>'
            + '<p id="fbq-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-actions"><button type="submit" class="action-btn rpq-btn rpq-btn--accent">GUARDAR</button></div>'
            + '</form>'
            + '</div>';
    }

    // { payload } | { error }
    function buildUpdate(status, note) {
        const s = String(status || '');
        if (STATUSES.indexOf(s) < 0) return { error: MSG.generic };
        const text = String(note == null ? '' : note).trim();
        if (text.length > NOTE_MAX) return { error: MSG.noteLong };
        return { payload: { status: s, support_note: text } };
    }

    const pure = {
        TAB, ROLES, ROLE_LABELS, KINDS, KIND_LABELS, STATUSES, STATUS_LABELS, SURVEY_LABELS, MSG, PAGE_SIZE,
        esc, safeUrl, fmtDateTime, excerpt, stars, cleanFilters, pageInfo, summaryHtml, rowHtml, detailHtml, capturesHtml, buildUpdate
    };

    if (!root || !root.document) return { boot() {}, _internal: pure };

    // ---------------- estado ----------------

    const state = {
        filters: { role: '', kind: '', status: '', survey_key: '', q: '', from: '', to: '', page: 1 },
        items: [], total: 0, loaded: false, loading: false, error: null, migration: false, seq: 0,
        summary: null, detail: null, busy: false
    };
    let active = false;
    let previousSwitch = null;
    let searchTimer = null;
    const hiddenSiblings = new Map();
    const $ = (id) => root.document.getElementById(id);
    function repo() { return root.WeotziData && root.WeotziData.SupportFeedback; }

    // ---------------- panel ----------------

    function options(values, labels, all) {
        return '<option value="">' + esc(all) + '</option>' + values.map((v) => '<option value="' + v + '">' + esc(labels[v]) + '</option>').join('');
    }

    function panelHtml() {
        return '<section class="fbq-summary" id="fbq-summary" aria-label="Resumen del feedback">' + summaryHtml(null) + '</section>'
            + '<div class="rpq-toolbar fbq-toolbar">'
            + '<label class="rpq-sr" for="fbq-role">Tipo de cuenta</label><select id="fbq-role" class="rpq-select">' + options(ROLES, ROLE_LABELS, 'Todas las cuentas') + '</select>'
            + '<label class="rpq-sr" for="fbq-kind">Tipo</label><select id="fbq-kind" class="rpq-select">' + options(KINDS, KIND_LABELS, 'Todos los tipos') + '</select>'
            + '<label class="rpq-sr" for="fbq-status">Estado</label><select id="fbq-status" class="rpq-select">' + options(STATUSES, STATUS_LABELS, 'Todos los estados') + '</select>'
            + '<label class="rpq-sr" for="fbq-survey">Encuesta</label><select id="fbq-survey" class="rpq-select">' + options(Object.keys(SURVEY_LABELS), SURVEY_LABELS, 'Todas las encuestas') + '</select>'
            + '<label class="fbq-date">Desde <input type="date" id="fbq-from" class="rpq-input"></label>'
            + '<label class="fbq-date">Hasta <input type="date" id="fbq-to" class="rpq-input"></label>'
            + '<div class="rpq-search"><label class="rpq-sr" for="fbq-search">Buscar</label>'
            + '<input type="search" id="fbq-search" class="rpq-input" placeholder="Buscar en el mensaje, la página o la nota" autocomplete="off"></div>'
            + '<button type="button" class="action-btn rpq-btn" id="fbq-refresh">ACTUALIZAR</button>'
            + '<button type="button" class="action-btn rpq-btn" id="fbq-export">EXPORTAR CSV</button>'
            + '</div>'
            + '<p id="fbq-export-feedback" class="rpq-feedback" role="status" aria-live="polite" hidden></p>'
            + '<div class="rpq-table" role="table" aria-label="Feedback de la beta">'
            + '<div class="rpq-head fbq-head" role="row">'
            + ['Recibido', 'Tipo', 'Cuenta', 'Mensaje', 'Página', 'Estado'].map((h) => '<span role="columnheader">' + h + '</span>').join('')
            + '</div>'
            + '<div id="fbq-body" aria-live="polite" aria-busy="true"><div class="rpq-empty">' + MSG.loading + '</div></div>'
            + '</div>'
            + '<nav class="fbq-pager" aria-label="Páginas del feedback">'
            + '<button type="button" class="action-btn rpq-btn" id="fbq-prev">ANTERIOR</button>'
            + '<span id="fbq-page-info" class="rpq-muted" aria-live="polite"></span>'
            + '<button type="button" class="action-btn rpq-btn" id="fbq-next">SIGUIENTE</button>'
            + '</nav>';
    }

    function setFilter(key, value) {
        state.filters[key] = value;
        state.filters.page = 1;
        load();
    }

    function ensurePanel() {
        let panel = $('fbq-panel');
        if (panel) return panel;
        const table = $('table-container');
        if (!table || !table.parentNode) return null;
        panel = root.document.createElement('section');
        panel.id = 'fbq-panel';
        panel.className = 'rpq-panel fbq-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Feedback de la beta');
        panel.innerHTML = panelHtml();
        table.insertAdjacentElement('afterend', panel);
        [['fbq-role', 'role'], ['fbq-kind', 'kind'], ['fbq-status', 'status'], ['fbq-survey', 'survey_key'], ['fbq-from', 'from'], ['fbq-to', 'to']]
            .forEach(([id, key]) => $(id).addEventListener('change', (e) => setFilter(key, e.target.value || '')));
        $('fbq-search').addEventListener('input', (e) => {
            const value = e.target.value || '';
            root.clearTimeout(searchTimer);
            searchTimer = root.setTimeout(() => setFilter('q', value), 400);
        });
        $('fbq-refresh').addEventListener('click', () => { load(); loadSummary(); });
        $('fbq-export').addEventListener('click', exportCsv);
        $('fbq-prev').addEventListener('click', () => { if (state.filters.page > 1) { state.filters.page -= 1; load(); } });
        $('fbq-next').addEventListener('click', () => {
            if (pageInfo(state.total, state.filters.page, PAGE_SIZE).hasNext) { state.filters.page += 1; load(); }
        });
        const body = $('fbq-body');
        body.addEventListener('click', (e) => {
            const row = e.target.closest('[data-fbq-id]');
            if (row) openDetail(row.dataset.fbqId);
        });
        body.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('[data-fbq-id]');
            if (!row) return;
            e.preventDefault();
            openDetail(row.dataset.fbqId);
        });
        return panel;
    }

    function renderRows() {
        const body = $('fbq-body');
        if (!body) return;
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        const info = pageInfo(state.total, state.filters.page, PAGE_SIZE);
        const pager = $('fbq-page-info');
        if (pager) pager.textContent = 'Página ' + info.page + ' de ' + info.pages + ' · ' + info.total + (info.total === 1 ? ' resultado' : ' resultados');
        if ($('fbq-prev')) $('fbq-prev').disabled = !info.hasPrev || state.loading;
        if ($('fbq-next')) $('fbq-next').disabled = !info.hasNext || state.loading;
        if (state.loading && !state.items.length) { body.innerHTML = '<div class="rpq-empty">' + MSG.loading + '</div>'; return; }
        if (state.error) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(state.error) + '</div>'; return; }
        if (state.migration) { body.innerHTML = '<div class="rpq-empty is-error" role="alert">' + esc(MSG.migration) + '</div>'; return; }
        if (!state.items.length) { body.innerHTML = '<div class="rpq-empty">' + MSG.empty + '</div>'; return; }
        body.innerHTML = state.items.map(rowHtml).join('');
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
        siblingsAfterTabs().forEach((el) => {
            if (el === panel) return;
            if (!hiddenSiblings.has(el)) hiddenSiblings.set(el, el.style.display || '');
            el.style.display = 'none';
        });
        panel.hidden = false;
        active = true;
        markActive();
        if (!state.loaded && !state.loading) { load(); loadSummary(); } else renderRows();
    }

    function leave() {
        if (!active) return;
        active = false;
        const panel = $('fbq-panel');
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
            root.setTimeout(() => root.switchTab(TAB), 0);
        } else {
            leave();
        }
    }

    // ---------------- datos ----------------

    function setBadge(n) {
        const count = Number(n) || 0;
        root.document.querySelectorAll('.fbq-count').forEach((el) => {
            el.textContent = String(count);
            el.hidden = !count;
            el.setAttribute('aria-label', count + ' sin revisar');
        });
    }

    async function load() {
        const R = repo();
        const seq = ++state.seq;
        state.loading = true;
        renderRows();
        let res = null;
        try { res = R ? await R.list(cleanFilters(state.filters)) : null; } catch (_) { res = null; }
        if (seq !== state.seq) return;
        state.loading = false;
        state.loaded = true;
        if (res && res.ok) {
            state.items = Array.isArray(res.json.items) ? res.json.items : [];
            state.total = Number(res.json.total) || 0;
            state.error = null;
            state.migration = res.json.migration_pending === true;
        } else {
            state.items = [];
            state.total = 0;
            state.migration = false;
            state.error = (res && res.json && res.json.error && res.status !== 0 && res.status !== 500) ? res.json.error : MSG.unavailable;
        }
        renderRows();
    }

    async function loadSummary() {
        const R = repo();
        const box = $('fbq-summary');
        let res = null;
        try { res = R ? await R.summary() : null; } catch (_) { res = null; }
        if (res && res.ok && res.json.summary) {
            state.summary = res.json.summary;
            if (box) box.innerHTML = summaryHtml(state.summary);
            setBadge(state.summary.by_status && state.summary.by_status.new);
        } else if (box) {
            box.innerHTML = '<p class="rpq-text rpq-muted" role="alert">' + esc((res && res.json && res.json.error) || MSG.unavailable) + '</p>';
        }
    }

    function exportFeedback(kind, text) {
        const el = $('fbq-export-feedback');
        if (!el) return;
        el.className = 'rpq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    async function exportCsv() {
        const btn = $('fbq-export');
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        exportFeedback('info', 'Preparando el CSV…');
        let res = null;
        try { res = await repo().exportCsv(cleanFilters(state.filters)); } catch (_) { res = null; }
        btn.disabled = false;
        if (!res || !res.ok || !res.blob) {
            exportFeedback('error', (res && res.json && res.json.error) || MSG.exportEmpty);
            return;
        }
        const url = root.URL.createObjectURL(res.blob);
        const a = root.document.createElement('a');
        a.href = url;
        a.download = res.filename || 'feedback-beta.csv';
        root.document.body.appendChild(a);
        a.click();
        a.remove();
        root.setTimeout(() => root.URL.revokeObjectURL(url), 2000);
        exportFeedback('success', 'CSV descargado.');
    }

    // ---------------- detalle ----------------

    function paint(keepFocus) {
        const content = $('drawer-content');
        if (!content || !state.detail) return;
        content.innerHTML = state.detail.item
            ? detailHtml(state.detail.item)
            : '<div id="fbq-detail" class="rpq-detail"><p class="rpq-eyebrow">Feedback de la beta</p>'
                + '<h2 id="fbq-detail-title" class="rpq-title" tabindex="-1">Feedback</h2>'
                + '<p class="rpq-text' + (state.detail.error ? ' is-error" role="alert' : '') + '">' + esc(state.detail.error || MSG.loading) + '</p></div>';
        if (!keepFocus) {
            const title = $('fbq-detail-title');
            if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
        }
    }

    async function openDetail(id) {
        const toggle = $('drawer-toggle');
        if (!toggle || !id) return;
        const detail = { id: String(id), item: null, error: null };
        state.detail = detail;
        paint();
        toggle.checked = true;
        const res = await repo().get(detail.id);
        if (state.detail !== detail) return;
        if (res && res.ok && res.json.item) detail.item = res.json.item;
        else detail.error = (res && res.json && res.json.error) || MSG.generic;
        paint(true);
    }

    function formFeedback(kind, text) {
        const el = $('fbq-feedback');
        if (!el) return;
        el.className = 'rpq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    async function save() {
        const d = state.detail;
        if (!d || !d.item || state.busy) return;
        const built = buildUpdate($('fbq-new-status').value, $('fbq-note').value);
        if (built.error) { formFeedback('error', built.error); return; }
        state.busy = true;
        formFeedback('info', 'Guardando…');
        const res = await repo().update(d.id, built.payload);
        state.busy = false;
        if (state.detail !== d) return;
        if (!res || !res.ok) { formFeedback('error', (res && res.json && res.json.error) || MSG.generic); return; }
        Object.assign(d.item, { status: res.json.item.status, support_note: res.json.item.support_note });
        paint(true);
        formFeedback('success', 'Guardado: ' + (STATUS_LABELS[d.item.status] || d.item.status) + '.');
        load();
        loadSummary();
    }

    function onDrawerSubmit(e) {
        if (!$('fbq-detail')) return;
        if (e.target.closest('[data-fbq-form]')) { e.preventDefault(); save(); }
    }

    // ---------------- arranque ----------------

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
        if (!doc || root.__fbqBooted) return;
        root.__fbqBooted = true;
        previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = switchTab;
        root.addEventListener('click', onTabClick, true);
        const drawer = $('drawer-content');
        if (drawer) drawer.addEventListener('submit', onDrawerSubmit);
        const start = () => {
            openFromHash();
            // Contador de la pestaña (feedback nuevo): una lectura liviana cuando ya hay sesión.
            root.setTimeout(async () => {
                const R = repo();
                if (state.summary || !R || !(await R.hasSession())) return;
                const res = await R.summary();
                if (res && res.ok && res.json.summary) setBadge(res.json.summary.by_status && res.json.summary.by_status.new);
            }, 2600);
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
        root.SupportFeedbackQueue = { refresh: load, open: openDetail, isActive: () => active };
    }

    return { boot, _internal: pure };
}));
