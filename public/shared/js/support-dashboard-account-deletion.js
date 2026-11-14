// ============================================
// WE ÖTZI - Support Dashboard · pestaña BAJAS DE CUENTA (ronda 3c · "borrado")
// Cola de solicitudes de baja (clientes, artistas y dueños de estudio) con el
// checklist de bloqueos EN VIVO (RPC account_deletion_blockers), notas y
// decisiones (RPC support_review_account_deletion: en revisión, bloqueada,
// aprobada, rechazada). "Ejecutar borrado" solo con la solicitud aprobada y
// cero bloqueos: lo hace el servidor con service-role
// (POST /api/support/account-deletions/:id/execute), que vuelve a calcular
// los bloqueos y deja auditoría. Sin frame en el Figma: mismo lenguaje que la
// pestaña VERIFICACIONES. Módulo aparte: envuelve window.switchTab, pinta
// #adq-panel y usa el drawer de la página.
// En Node (tests) solo exporta los helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'bajas';
    const CONFIRM_WORD = 'ELIMINAR';
    const NOTE_MIN = 5;
    const NOTE_MAX = 2000;
    const OPEN = ['pending', 'in_review', 'blocked', 'approved'];
    const FILTERS = ['open', 'pending', 'in_review', 'blocked', 'approved', 'completed', 'rejected', 'cancelled', 'all'];
    const FILTER_LABELS = {
        open: 'Abiertas', pending: 'Recibidas', in_review: 'En revisión', blocked: 'Bloqueadas', approved: 'Aprobadas',
        completed: 'Completadas', rejected: 'Rechazadas', cancelled: 'Canceladas', all: 'Todas'
    };
    const STATUS_LABELS = {
        pending: 'Recibida', in_review: 'En revisión', blocked: 'Bloqueada', approved: 'Aprobada',
        completed: 'Completada', rejected: 'Rechazada', cancelled: 'Cancelada'
    };
    const ROLE_LABELS = { client: 'Cliente', artist: 'Artista', studio: 'Estudio' };
    const ACTION_LABELS = {
        requested: 'Solicitud creada', cancelled: 'Cancelada por el usuario', in_review: 'En revisión', blocked: 'Marcada bloqueada',
        approved: 'Aprobada', rejected: 'Rechazada', note: 'Nota guardada', refresh: 'Bloqueos recalculados',
        execute_started: 'Ejecución iniciada', executed: 'Cuenta eliminada', execute_failed: 'Ejecución fallida', execute_blocked: 'Ejecución frenada por bloqueos'
    };
    const MSG = {
        loading: 'Cargando…',
        empty: 'No hay solicitudes de baja en este estado.',
        emptySearch: 'Nada coincide con la búsqueda.',
        unavailable: 'No pudimos leer la cola. Revisá que tu usuario tenga acceso de soporte y que la migración 20261113103000 esté aplicada.',
        noteRequired: 'Escribí una nota para el usuario (mínimo ' + NOTE_MIN + ' caracteres). La recibe por email.',
        noteLong: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.',
        blocked: 'Todavía hay bloqueos: no se puede aprobar.',
        confirm: 'Escribí ' + CONFIRM_WORD + ' para ejecutar el borrado.',
        generic: 'No pudimos completar la acción. Probá de nuevo.',
        rpcMissing: 'Falta aplicar la migración 20261113103000 (bajas de cuenta).'
    };

    // ---------------- helpers puros ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function isOpen(status) { return OPEN.indexOf(status) >= 0; }
    function blocking(items) { return (Array.isArray(items) ? items : []).filter((i) => i && i.code && i.severity !== 'warn'); }

    // { action, note } | { error, field }
    function buildReview(action, note, liveBlockers) {
        const clean = String(note == null ? '' : note).trim();
        if (['in_review', 'blocked', 'approved', 'rejected', 'note', 'refresh'].indexOf(action) < 0) return { error: MSG.generic };
        if (clean.length > NOTE_MAX) return { error: MSG.noteLong, field: 'note' };
        if ((action === 'rejected' || action === 'blocked') && clean.length < NOTE_MIN) return { error: MSG.noteRequired, field: 'note' };
        if (action === 'note' && !clean) return { error: 'Escribí la nota antes de guardarla.', field: 'note' };
        if (action === 'approved' && (!Array.isArray(liveBlockers) || blocking(liveBlockers).length)) return { error: MSG.blocked };
        return { action, note: clean || null };
    }

    // ¿Se muestra / habilita "Ejecutar borrado"?
    function canExecute(request, liveBlockers) {
        return !!request && request.status === 'approved' && Array.isArray(liveBlockers) && blocking(liveBlockers).length === 0;
    }
    function isConfirmText(text) { return String(text == null ? '' : text).trim().toUpperCase() === CONFIRM_WORD; }

    function matchesSearch(item, term) {
        const t = String(term || '').trim().toLowerCase();
        if (!t) return true;
        return [item.name_snapshot, item.email_snapshot, item.user_id, ROLE_LABELS[item.role], item.reason]
            .some((v) => String(v || '').toLowerCase().indexOf(t) >= 0);
    }

    function errorText(err) {
        const cause = (err && err.cause) || {};
        const msg = String(cause.message || (err && err.message) || '').replace(/^\[[^\]]+\]\s*/, '');
        if (/could not find the function|PGRST202/i.test(msg) || cause.code === 'PGRST202') return MSG.rpcMissing;
        if (/Solo soporte|42501|permission denied/i.test(msg) || cause.code === '42501') return 'Tu usuario no tiene acceso de soporte para esta acción.';
        if (msg && /[áéíóúñ]|Escribí|No encontramos|Todavía|Esta solicitud|Acción/i.test(msg)) return msg;
        return MSG.generic;
    }

    function fmtDateTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // ---------------- estado ----------------

    const state = { status: 'open', search: '', items: [], loaded: false, loading: false, error: null, seq: 0, detail: null, busy: false };
    let active = false;
    let previousSwitch = null;
    const hiddenSiblings = new Map();
    const $ = (id) => root.document.getElementById(id);
    function repo() { return root.WeotziData && root.WeotziData.AccountDeletion; }

    // La página de soporte no carga ds/tokens.css: cada token lleva respaldo.
    const CSS = `
.adq-panel[hidden]{display:none}
.adq-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;margin-left:4px;background:var(--action-danger,CanvasText);color:var(--action-danger-fg,Canvas);font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;line-height:1}
.adq-count[hidden]{display:none}
.adq-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.adq-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px 0}
.adq-search{flex:1 1 220px;min-width:0}
.adq-input,.adq-select{width:100%;box-sizing:border-box;min-height:44px;padding:8px 12px;border:2px solid currentColor;border-radius:0;background:Canvas;color:CanvasText;font-family:var(--font-body,Inter,sans-serif);font-size:16px}
.adq-select{width:auto;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
textarea.adq-input{min-height:88px;resize:vertical}
.adq-input:focus-visible,.adq-select:focus-visible,.adq-btn:focus-visible,.adq-row:focus-visible,.adq-link:focus-visible{outline:2px solid Highlight;outline-offset:2px}
.adq-input[aria-invalid="true"]{border-color:var(--action-danger,currentColor)}
.adq-intro{margin:0 0 16px;font-size:14px;line-height:1.5;color:GrayText}
.adq-table{border:1px solid currentColor;background:Canvas}
.adq-head{display:grid;padding:12px 0;border-bottom:2px solid currentColor}
.adq-head span{padding:0 12px;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.adq-row{display:grid;align-items:center;padding:12px 0;border-bottom:1px solid GrayText;cursor:pointer}
.adq-row:last-child{border-bottom:0}
.adq-row>.adq-cell{padding:0 12px;min-width:0;overflow-wrap:anywhere}
.adq-name{display:block;font-weight:700}
.adq-muted{display:block;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:GrayText}
.adq-empty{padding:40px 16px;text-align:center;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:GrayText}
.adq-empty.is-error{color:var(--system-error,CanvasText)}
.adq-badge{display:inline-block;padding:4px 8px;border:2px solid currentColor;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.adq-badge--pending,.adq-badge--in_review{background:var(--accent,Mark);color:var(--accent-fg,MarkText);border-color:var(--accent,currentColor)}
.adq-badge--approved,.adq-badge--completed{background:var(--system-success,CanvasText);color:var(--white,Canvas);border-color:var(--system-success,CanvasText)}
.adq-badge--blocked,.adq-badge--rejected{color:var(--action-danger,CanvasText);border-color:var(--action-danger,currentColor)}
.adq-badge--cancelled{color:GrayText;border-color:GrayText}
.adq-detail{min-height:100%;box-sizing:border-box;background:Canvas;color:CanvasText}
.adq-eyebrow{margin:0 0 8px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.adq-title{margin:0 0 8px;font-family:var(--font-display,'Archivo Black',sans-serif);font-size:24px;line-height:1.15;overflow-wrap:anywhere}
.adq-title:focus{outline:none}
.adq-sub{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px}
.adq-section{margin:16px 0;padding:16px;border:2px solid currentColor}
.adq-section--danger{border-color:var(--action-danger,currentColor)}
.adq-section-title{margin:0 0 12px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.adq-text{margin:0 0 12px;font-size:15px;line-height:1.5;overflow-wrap:anywhere}
.adq-facts{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin:0}
.adq-facts dt{margin:0 0 4px;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.adq-facts dd{margin:0;font-size:14px;overflow-wrap:anywhere}
.adq-checklist{list-style:none;margin:0;padding:0}
.adq-checklist li{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;padding:8px 0;border-bottom:1px solid GrayText;font-size:14px}
.adq-checklist li:last-child{border-bottom:0}
.adq-mark{grid-row:span 2;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.adq-mark--block,.adq-mark--check{color:var(--action-danger,CanvasText)}
.adq-mark--warn{color:GrayText}
.adq-ok{margin:0;font-size:14px;color:var(--system-success,CanvasText);font-weight:700}
.adq-field label{display:block;margin:0 0 8px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.adq-help{margin:4px 0 0;font-size:14px;color:GrayText}
.adq-feedback{margin:12px 0;padding:12px;border-left:3px solid currentColor;font-size:14px;line-height:1.45}
.adq-feedback[hidden]{display:none}
.adq-feedback.is-error{color:var(--system-error,CanvasText)}
.adq-feedback.is-success{border-left-color:var(--system-success,currentColor)}
.adq-actions{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.adq-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 16px;border:2px solid currentColor;border-radius:0;background:Canvas;color:CanvasText;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;font-weight:700;letter-spacing:.08em;cursor:pointer}
.adq-btn--accent{background:var(--action-accent,Mark);color:var(--action-accent-fg,MarkText)}
.adq-btn--danger{background:var(--action-danger,CanvasText);border-color:var(--action-danger,CanvasText);color:var(--action-danger-fg,Canvas)}
.adq-btn:disabled{cursor:not-allowed;opacity:.55}
.adq-link{padding:0;border:0;background:none;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:LinkText;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.adq-log{list-style:none;margin:0;padding:0;font-size:13px}
.adq-log li{padding:6px 0;border-bottom:1px solid GrayText}
.adq-log li:last-child{border-bottom:0}
@media (max-width:768px){
.adq-head{display:none}
.adq-row{display:flex;flex-wrap:wrap;gap:8px 16px;padding:16px 12px}
.adq-row>.adq-cell{padding:0}
.adq-row>.adq-user{flex:1 1 100%}
.adq-cell[data-label]::before{content:attr(data-label) " · ";font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.adq-facts{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.adq-panel *,.adq-detail *{transition:none !important;animation:none !important}}`;

    const COLS = 'minmax(0,2.2fr) 100px 130px 110px 140px';

    function injectStyles() {
        if ($('adq-style')) return;
        const style = root.document.createElement('style');
        style.id = 'adq-style';
        style.textContent = CSS;
        (root.document.head || root.document.documentElement).appendChild(style);
    }

    function badge(status) {
        return '<span class="adq-badge adq-badge--' + esc(status) + '">' + esc(STATUS_LABELS[status] || status || '-') + '</span>';
    }
    function fact(label, value) { return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value == null || value === '' ? '-' : value) + '</dd></div>'; }

    // ---------------- panel ----------------

    function panelHtml() {
        const opts = FILTERS.map((f) => '<option value="' + f + '"' + (f === state.status ? ' selected' : '') + '>' + FILTER_LABELS[f] + '</option>').join('');
        return `
            <div class="adq-toolbar">
                <label class="adq-sr" for="adq-status">Estado</label>
                <select id="adq-status" class="adq-select">${opts}</select>
                <div class="adq-search">
                    <label class="adq-sr" for="adq-search">Buscar</label>
                    <input type="search" id="adq-search" class="adq-input" placeholder="Buscar por nombre, email o ID" autocomplete="off">
                </div>
                <button type="button" class="action-btn adq-btn" id="adq-refresh">ACTUALIZAR</button>
            </div>
            <p class="adq-intro">Antes de aprobar, el checklist tiene que quedar sin bloqueos: disputas, wallet (saldo y retiros), trabajos y sesiones en curso, pedidos de la Store y membresías o contratos de estudio. Nada se borra hasta que tocás "Ejecutar borrado".</p>
            <div class="adq-table" role="table" aria-label="Solicitudes de baja">
                <div class="adq-head" role="row" style="grid-template-columns:${COLS}">
                    <span role="columnheader">Usuario</span><span role="columnheader">Tipo</span><span role="columnheader">Estado</span><span role="columnheader">Bloqueos</span><span role="columnheader">Pedida</span>
                </div>
                <div id="adq-body" aria-live="polite" aria-busy="true"><div class="adq-empty">${MSG.loading}</div></div>
            </div>`;
    }

    function ensurePanel() {
        let panel = $('adq-panel');
        if (panel) return panel;
        const table = $('table-container');
        if (!table || !table.parentNode) return null;
        panel = root.document.createElement('section');
        panel.id = 'adq-panel';
        panel.className = 'adq-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Bajas de cuenta');
        panel.innerHTML = panelHtml();
        table.insertAdjacentElement('afterend', panel);
        $('adq-status').addEventListener('change', (e) => {
            state.status = FILTERS.indexOf(e.target.value) >= 0 ? e.target.value : 'open';
            state.items = []; state.loaded = false; load();
        });
        $('adq-search').addEventListener('input', (e) => { state.search = e.target.value || ''; renderRows(); });
        $('adq-refresh').addEventListener('click', () => load());
        const body = $('adq-body');
        body.addEventListener('click', (e) => {
            const row = e.target.closest('[data-adq-id]');
            if (row) openDetail(row.dataset.adqId);
        });
        body.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('[data-adq-id]');
            if (!row) return;
            e.preventDefault();
            openDetail(row.dataset.adqId);
        });
        return panel;
    }

    function renderRows() {
        const body = $('adq-body');
        if (!body) return;
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        if (state.loading && !state.items.length) { body.innerHTML = '<div class="adq-empty">' + MSG.loading + '</div>'; return; }
        if (state.error) { body.innerHTML = '<div class="adq-empty is-error" role="alert">' + esc(MSG.unavailable) + '</div>'; return; }
        const rows = state.items.filter((i) => matchesSearch(i, state.search));
        if (!rows.length) { body.innerHTML = '<div class="adq-empty">' + (state.items.length ? MSG.emptySearch : MSG.empty) + '</div>'; return; }
        body.innerHTML = rows.map((i) => {
            const n = blocking(i.blockers).length;
            return `<div class="adq-row" role="row" tabindex="0" data-adq-id="${esc(i.id)}" style="grid-template-columns:${COLS}" aria-label="Abrir solicitud de ${esc(i.name_snapshot || i.email_snapshot || 'usuario')}">
                <div class="adq-cell adq-user" role="cell"><span class="adq-name">${esc(i.name_snapshot || 'Sin nombre')}</span><span class="adq-muted">${esc(i.email_snapshot || i.user_id)}</span></div>
                <div class="adq-cell" role="cell" data-label="Tipo">${esc(ROLE_LABELS[i.role] || i.role)}</div>
                <div class="adq-cell" role="cell" data-label="Estado">${badge(i.status)}</div>
                <div class="adq-cell" role="cell" data-label="Bloqueos">${isOpen(i.status) ? (n ? esc(n + ' pendiente' + (n > 1 ? 's' : '')) : 'Ninguno') : '-'}</div>
                <div class="adq-cell adq-muted" role="cell" data-label="Pedida">${esc(fmtDateTime(i.requested_at))}</div>
            </div>`;
        }).join('');
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
        // Otras pestañas modulares (VERIFICACIONES, IG) ocultan sus paneles al salir.
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
        const panel = $('adq-panel');
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
            // Después de que las otras pestañas modulares (VERIFICACIONES, IG)
            // terminen de salir y restaurar lo que ocultaron.
            root.setTimeout(() => root.switchTab(TAB), 0);
        } else {
            // Escucha en window (captura): sale ANTES de que otra pestaña modular entre.
            leave();
        }
    }

    // ---------------- datos ----------------

    async function load() {
        const R = repo();
        const seq = ++state.seq;
        state.loading = true;
        renderRows();
        try {
            if (!R) throw new Error('repo');
            const items = await R.list(state.status);
            if (seq !== state.seq) return;
            state.items = items;
            state.error = null;
        } catch (err) {
            if (seq !== state.seq) return;
            console.warn('[support-bajas] cola:', err && err.message);
            state.items = [];
            state.error = err;
        }
        state.loading = false;
        state.loaded = true;
        renderRows();
        refreshBadge();
    }

    async function refreshBadge() {
        const R = repo();
        let n = 0;
        try { n = R ? await R.countOpen() : 0; } catch (_) { n = 0; }
        root.document.querySelectorAll('.adq-count').forEach((el) => {
            el.textContent = String(n);
            el.hidden = !n;
            el.setAttribute('aria-label', n + ' solicitudes de baja sin revisar');
        });
    }

    // ---------------- detalle ----------------

    function checklistHtml(live, liveError) {
        if (liveError) return '<p class="adq-text" role="alert">No pudimos calcular los bloqueos en vivo. No ejecutes la baja hasta que se puedan revisar.</p>';
        if (!Array.isArray(live)) return '<p class="adq-text">' + MSG.loading + '</p>';
        if (!live.length) return '<p class="adq-ok">Sin bloqueos ni avisos.</p>';
        const marks = { block: 'Bloquea', check: 'Revisar', warn: 'Aviso' };
        return '<ul class="adq-checklist">' + live.map((i) => {
            const sev = marks[i.severity] ? i.severity : 'block';
            return `<li><span class="adq-mark adq-mark--${sev}">${marks[sev]}</span><strong>${esc(i.label)}</strong><span>${esc(i.detail || '')}${i.href ? ' <span class="adq-muted">' + esc(i.href) + '</span>' : ''}</span></li>`;
        }).join('') + '</ul>' + (blocking(live).length ? '' : '<p class="adq-ok">Sin bloqueos: se puede aprobar.</p>');
    }

    function eventsHtml(events) {
        if (!events || !events.length) return '<p class="adq-text">Sin movimientos.</p>';
        return '<ul class="adq-log">' + events.map((e) => {
            const note = e.detail && e.detail.note ? ' · ' + e.detail.note : (e.detail && e.detail.error ? ' · ' + e.detail.error : '');
            return '<li><span class="adq-muted">' + esc(fmtDateTime(e.created_at)) + ' · ' + esc(e.actor_role === 'support' ? 'Soporte' : e.actor_role === 'user' ? 'Usuario' : 'Sistema') + '</span>'
                + esc(ACTION_LABELS[e.action] || e.action) + esc(note) + '</li>';
        }).join('') + '</ul>';
    }

    function detailHtml() {
        const d = state.detail;
        const item = d.item;
        const open = isOpen(item.status);
        const live = d.live;
        const nBlock = Array.isArray(live) ? blocking(live).length : null;
        const execOk = canExecute(item, live);
        const reviewForm = open ? `<form class="drawer-section adq-section" data-adq-form novalidate>
                <p class="adq-section-title">Decisión</p>
                <div class="adq-field">
                    <label for="adq-note">Nota para el usuario</label>
                    <textarea id="adq-note" class="adq-input" rows="3" maxlength="${NOTE_MAX}" aria-describedby="adq-note-help">${esc(item.support_notes || '')}</textarea>
                    <p class="adq-help" id="adq-note-help">Obligatoria para rechazar o marcar bloqueada: la recibe por email y la ve en su cuenta.</p>
                </div>
                <p id="adq-feedback" class="adq-feedback" role="status" aria-live="polite" hidden></p>
                <div class="adq-actions">
                    ${item.status === 'pending' ? '<button type="button" class="action-btn adq-btn" data-adq-action="in_review">PASAR A REVISIÓN</button>' : ''}
                    <button type="button" class="action-btn adq-btn adq-btn--accent" data-adq-action="approved" ${nBlock === 0 && item.status !== 'approved' ? '' : 'disabled'} aria-describedby="adq-approve-help">APROBAR BAJA</button>
                    <p class="adq-help" id="adq-approve-help">${item.status === 'approved' ? 'Ya está aprobada.' : nBlock === 0 ? 'Sin bloqueos en vivo.' : 'Se habilita cuando no quedan bloqueos.'}</p>
                    <button type="button" class="action-btn adq-btn" data-adq-action="blocked">MARCAR BLOQUEADA</button>
                    <button type="button" class="action-btn adq-btn" data-adq-action="note">GUARDAR NOTA</button>
                    <button type="button" class="action-btn adq-btn adq-btn--danger" data-adq-action="rejected">RECHAZAR</button>
                </div>
            </form>` : `<p id="adq-feedback" class="adq-feedback" role="status" aria-live="polite" hidden></p>`;
        const execute = item.status === 'approved' ? `<div class="drawer-section adq-section adq-section--danger">
                <p class="adq-section-title">Ejecutar borrado</p>
                <p class="adq-text">Borra el perfil (artista, cliente y/o estudio), anonimiza el soporte y elimina el acceso. Es permanente. El servidor vuelve a calcular los bloqueos antes de borrar.</p>
                <div class="adq-field">
                    <label for="adq-confirm">Escribí ${CONFIRM_WORD} para confirmar</label>
                    <input type="text" id="adq-confirm" class="adq-input" autocomplete="off" spellcheck="false" ${execOk ? '' : 'disabled'}>
                </div>
                <p id="adq-exec-feedback" class="adq-feedback" role="status" aria-live="polite" hidden></p>
                <div class="adq-actions">
                    <button type="button" class="action-btn adq-btn adq-btn--danger" data-adq-execute disabled>EJECUTAR BORRADO</button>
                    ${execOk ? '' : '<p class="adq-help">Se habilita con la solicitud aprobada y sin bloqueos en vivo.</p>'}
                </div>
            </div>` : '';
        return `<div id="adq-detail" class="adq-detail" data-adq-id="${esc(item.id)}">
            <p class="adq-eyebrow">Baja de cuenta · ${esc(ROLE_LABELS[item.role] || item.role)}</p>
            <h2 id="adq-detail-title" class="adq-title" tabindex="-1">${esc(item.name_snapshot || item.email_snapshot || 'Usuario')}</h2>
            <p class="adq-sub">${badge(item.status)}<span aria-hidden="true">·</span><span>Pedida ${esc(fmtDateTime(item.requested_at))}</span></p>
            <div class="drawer-section adq-section">
                <p class="adq-section-title">Cuenta</p>
                <dl class="adq-facts">
                    ${fact('Email', item.email_snapshot)}
                    ${fact('ID de usuario', item.user_id)}
                    ${fact('Tipo', ROLE_LABELS[item.role] || item.role)}
                    ${fact('Última revisión', fmtDateTime(item.reviewed_at))}
                    ${item.completed_at ? fact('Eliminada', fmtDateTime(item.completed_at)) : ''}
                    ${item.cancelled_at ? fact('Cancelada', fmtDateTime(item.cancelled_at)) : ''}
                </dl>
                ${item.reason ? '<p class="adq-text"><strong>Motivo:</strong> ' + esc(item.reason) + '</p>' : ''}
            </div>
            <div class="drawer-section adq-section">
                <p class="adq-section-title">Checklist de bloqueos (en vivo)</p>
                ${open ? checklistHtml(live, d.liveError) : '<p class="adq-text">La solicitud está cerrada.</p>'}
                ${open ? '<button type="button" class="adq-link" data-adq-action="refresh">Recalcular y guardar en la solicitud →</button>' : ''}
            </div>
            ${reviewForm}
            ${execute}
            <div class="drawer-section adq-section">
                <p class="adq-section-title">Historial</p>
                ${eventsHtml(d.events)}
            </div>
        </div>`;
    }

    function paint(keepFocus) {
        const content = $('drawer-content');
        if (!content || !state.detail) return;
        content.innerHTML = detailHtml();
        if (!keepFocus) {
            const title = $('adq-detail-title');
            if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
        }
    }

    async function loadLive() {
        const d = state.detail;
        if (!d || !isOpen(d.item.status)) return;
        try { d.live = await repo().blockers(d.item.user_id); d.liveError = false; } catch (err) {
            console.warn('[support-bajas] bloqueos:', err && err.message);
            d.live = null; d.liveError = true;
        }
    }

    async function loadEvents() {
        const d = state.detail;
        if (!d) return;
        try { d.events = await repo().events(d.item.id); } catch (_) { d.events = []; }
    }

    async function openDetail(id) {
        const item = state.items.find((i) => String(i.id) === String(id));
        const toggle = $('drawer-toggle');
        if (!item || !toggle) return;
        state.detail = { item, live: null, liveError: false, events: [] };
        paint();
        toggle.checked = true;
        await Promise.all([loadLive(), loadEvents()]);
        if (state.detail && state.detail.item === item) paint(true);
    }

    function feedback(id, kind, text) {
        const el = $(id);
        if (!el) return;
        el.className = 'adq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    function notifyText(result) {
        if (!result || !result.ok) return ' (no pudimos confirmar el email al usuario).';
        const j = result.json || {};
        if (j.sent) return ' Le avisamos al usuario por email.';
        if (j.deduplicated) return ' El usuario ya tenía el aviso.';
        return '';
    }

    async function runReview(action) {
        const d = state.detail;
        if (!d || state.busy) return;
        const note = $('adq-note');
        const req = buildReview(action, note ? note.value : '', action === 'approved' ? d.live : []);
        if (req.error) {
            if (req.field === 'note' && note) { note.setAttribute('aria-invalid', 'true'); note.focus(); }
            feedback('adq-feedback', 'error', req.error);
            return;
        }
        state.busy = true;
        root.document.querySelectorAll('[data-adq-action]').forEach((b) => { b.disabled = true; });
        feedback('adq-feedback', 'info', 'Guardando…');
        try {
            const row = await repo().review(d.item.id, req.action, req.note);
            if (row && typeof row === 'object') Object.assign(d.item, row);
            let notified = null;
            if (d.item.status === 'approved' || d.item.status === 'rejected') notified = await repo().notify(d.item.id);
            await Promise.all([loadLive(), loadEvents()]);
            paint(true);
            const done = { in_review: 'Solicitud en revisión.', blocked: 'Solicitud marcada bloqueada.', approved: 'Baja aprobada.',
                rejected: 'Solicitud rechazada.', note: 'Nota guardada.', refresh: 'Bloqueos recalculados y guardados.' }[req.action];
            feedback('adq-feedback', 'success', done + (notified ? notifyText(notified) : ''));
            load();
        } catch (err) {
            console.warn('[support-bajas] revisión:', err && err.message);
            feedback('adq-feedback', 'error', errorText(err));
            root.document.querySelectorAll('[data-adq-action]').forEach((b) => { b.disabled = false; });
        } finally {
            state.busy = false;
        }
    }

    async function runExecute() {
        const d = state.detail;
        if (!d || state.busy) return;
        const input = $('adq-confirm');
        if (!canExecute(d.item, d.live)) { feedback('adq-exec-feedback', 'error', 'Hay bloqueos o la solicitud no está aprobada.'); return; }
        if (!input || !isConfirmText(input.value)) {
            if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
            feedback('adq-exec-feedback', 'error', MSG.confirm);
            return;
        }
        state.busy = true;
        const btn = root.document.querySelector('[data-adq-execute]');
        if (btn) btn.disabled = true;
        feedback('adq-exec-feedback', 'info', 'Ejecutando… no cierres esta ventana.');
        const res = await repo().execute(d.item.id, input.value);
        state.busy = false;
        if (res && res.ok) {
            Object.assign(d.item, res.json.request || { status: 'completed' });
            await loadEvents();
            paint(true);
            feedback('adq-feedback', 'success', 'Cuenta eliminada.' + (res.json.notified && res.json.notified.sent ? ' Le avisamos al usuario por email.' : ''));
            load();
            return;
        }
        const msg = (res && res.json && res.json.error) || MSG.generic;
        await Promise.all([loadLive(), loadEvents()]);
        paint(true);
        feedback('adq-exec-feedback', 'error', msg);
    }

    function onDrawerClick(e) {
        if (!$('adq-detail')) return;
        const action = e.target.closest('[data-adq-action]');
        if (action) { e.preventDefault(); runReview(action.dataset.adqAction); return; }
        const exec = e.target.closest('[data-adq-execute]');
        if (exec) { e.preventDefault(); runExecute(); }
    }

    function onDrawerInput(e) {
        if (e.target && e.target.id === 'adq-confirm') {
            const btn = root.document.querySelector('[data-adq-execute]');
            if (btn) btn.disabled = !(isConfirmText(e.target.value) && state.detail && canExecute(state.detail.item, state.detail.live));
        }
    }

    // ---------------- arranque ----------------

    function boot() {
        const doc = root.document;
        if (!doc || root.__adqBooted) return;
        root.__adqBooted = true;
        injectStyles();
        previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = switchTab;
        root.addEventListener('click', onTabClick, true);
        const drawer = $('drawer-content');
        if (drawer) {
            drawer.addEventListener('click', onDrawerClick);
            drawer.addEventListener('input', onDrawerInput);
            drawer.addEventListener('submit', (e) => { if (e.target.closest('[data-adq-form]')) e.preventDefault(); });
        }
        const schedule = () => root.setTimeout(() => { if (!state.loaded) refreshBadge(); }, 1800);
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedule); else schedule();
        root.SupportAccountDeletionQueue = { refresh: load, open: openDetail, isActive: () => active };
    }

    return {
        boot,
        _internal: { MSG, TAB, CONFIRM_WORD, FILTERS, STATUS_LABELS, ROLE_LABELS, esc, isOpen, blocking, buildReview, canExecute,
            isConfirmText, matchesSearch, errorText, checklistHtml }
    };
}));
