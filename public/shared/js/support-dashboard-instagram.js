// ============================================
// WE ÖTZI - Support Dashboard · pestaña VALIDACIONES IG
// Cola de validaciones de Instagram del modo asistido: el artista pide un
// código WO-XXXXXX y lo manda por mensaje directo a @weotzi. Si la
// automatización de DMs no lo valida, soporte lo hace desde acá.
// Módulo aparte de support-dashboard.js (no se edita): envuelve
// window.switchTab, pinta su propio panel (#igq-panel), cuenta los pendientes
// en la pestaña y usa el drawer del dashboard para el detalle.
// Datos: SOLO por los endpoints de soporte del servidor. La tabla
// artist_instagram_verifications es service_role: el navegador nunca la lee
// ni la escribe.
//   GET  /api/support/instagram-verifications?status=pending|verified|all
//   POST /api/support/instagram-verifications/:id/confirm  { code?, force?, note? }
//   POST /api/support/instagram-verifications/:id/reject   { note }
// En Node (tests) solo exporta los helpers puros; en el navegador arranca solo.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'instagram';
    const API = '/api/support/instagram-verifications';
    const STATUS_FILTERS = ['pending', 'verified', 'all'];
    // Mismo alfabeto que el servidor (sin I, O, 0, 1); se acepta con o sin guion.
    const CODE_RE = /^WO-?([A-HJ-NP-Z2-9]{6})$/;
    const CODE_IN_TEXT_RE = /\bWO-?[A-HJ-NP-Z2-9]{6}\b/g;
    const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
    const NOTE_MAX = 500;
    const COLUMNS = 'minmax(0, 2fr) minmax(0, 1.4fr) 120px 100px 100px 120px';
    const HEADERS = ['Artista', 'Instagram', 'Estado', 'Creado', 'Vence', 'Fotos pendientes'];

    const STATUS_META = {
        pending: { label: 'Pendiente', tone: 'pending' },
        expired: { label: 'Vencida', tone: 'muted' },
        verified: { label: 'Validada', tone: 'verified' },
        rejected: { label: 'Rechazada', tone: 'rejected' },
        cancelled: { label: 'Cancelada', tone: 'muted' }
    };
    const VIA_LABELS = { dm_webhook: 'Mensaje directo automático', support: 'Soporte' };

    const MSG = {
        loading: 'Cargando validaciones…',
        sending: 'Enviando…',
        emptyPending: 'No hay validaciones pendientes.',
        emptyVerified: 'Todavía no hay validaciones aprobadas.',
        emptyAll: 'Todavía no hay solicitudes de validación.',
        emptySearch: 'Ninguna validación coincide con la búsqueda.',
        unavailable: 'La validación de Instagram todavía no está disponible en este entorno: falta aplicar la migración.',
        session: 'Tu sesión de soporte venció. Volvé a iniciar sesión.',
        forbidden: 'Tu usuario no tiene acceso de soporte para validar Instagram.',
        notFound: 'No encontramos esta solicitud. Refrescá la lista.',
        conflict: 'Esta solicitud ya no está pendiente. Refrescá la lista.',
        rate: 'Hiciste muchos intentos seguidos. Esperá un momento y probá de nuevo.',
        network: 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.',
        generic: 'No pudimos completar la acción. Probá de nuevo.',
        codeInvalid: 'Ingresá el código con el formato WO-XXXXXX.',
        noteForce: 'Escribí una nota para validar sin código.',
        noteReject: 'Escribí una nota con el motivo del rechazo.',
        notPending: 'Esta solicitud ya no está pendiente.',
        expiredHint: 'El código venció. Pedile al artista que genere uno nuevo desde su cuenta, o validá sin código y dejá una nota.',
        codeExpired: 'El código venció y ya no sirve para validar. Validá sin código y dejá una nota, o rechazá la solicitud.'
    };

    // ---------------- helpers puros (testeados en Node) ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function normalizeHandle(value) {
        return String(value == null ? '' : value).trim().replace(/^@+/, '').toLowerCase();
    }

    // Devuelve 'WO-XXXXXX' o '' si no hay un código válido. Acepta el código
    // suelto (con o sin guion, en minúsculas, con espacios) o el mensaje entero
    // pegado desde el DM, siempre que tenga un solo código.
    function normalizeCode(raw) {
        const text = String(raw == null ? '' : raw).toUpperCase().replace(/[‐-―−]/g, '-');
        const compact = text.replace(/\s+/g, '');
        const direct = compact.match(CODE_RE);
        if (direct) return 'WO-' + direct[1];
        const found = text.match(CODE_IN_TEXT_RE) || [];
        if (found.length === 1) return 'WO-' + found[0].replace(/^WO-?/, '');
        return '';
    }

    function toTime(iso) {
        const t = iso ? Date.parse(iso) : NaN;
        return Number.isFinite(t) ? t : null;
    }

    // Estado a mostrar: un pendiente con el vencimiento cumplido se ve "Vencida".
    function displayStatus(item, now) {
        const raw = String((item && item.status) || '').toLowerCase();
        if (raw === 'pending') {
            const expires = toTime(item.expires_at);
            if (expires !== null && expires <= (now == null ? Date.now() : now)) return 'expired';
        }
        return raw;
    }

    function statusMeta(status) {
        return STATUS_META[status] || { label: status ? status : 'Sin estado', tone: 'muted' };
    }

    function pendingCount(items, now) {
        return (Array.isArray(items) ? items : []).filter((item) => displayStatus(item, now) === 'pending').length;
    }

    // Acciones que soporte puede hacer sobre una solicitud ('code' · 'force' ·
    // 'reject'). El servidor acepta confirmar o rechazar tanto 'pending' como
    // 'expired', pero a una vencida (guardada como 'expired' o pendiente con el
    // plazo cumplido) le responde 409 si llega un código sin force: ahí solo
    // quedan validar sin código (con nota) y rechazar.
    function availableActions(item, now) {
        const raw = String((item && item.status) || '').toLowerCase();
        if (raw !== 'pending' && raw !== 'expired') return [];
        return displayStatus(item, now) === 'expired' ? ['force', 'reject'] : ['code', 'force', 'reject'];
    }

    function toCount(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    }

    function basePath(win) {
        const w = win || root || {};
        if (w.WEOTZI_BASE_PATH) return String(w.WEOTZI_BASE_PATH).replace(/\/+$/, '');
        const pathname = (w.location && w.location.pathname) || '';
        return /^\/beta(?:\/|$)/.test(pathname) ? '/beta' : '';
    }

    function listPath(status) {
        const value = STATUS_FILTERS.indexOf(status) >= 0 ? status : 'pending';
        return API + '?status=' + encodeURIComponent(value);
    }

    function actionPath(id, action) {
        return API + '/' + encodeURIComponent(String(id)) + '/' + (action === 'reject' ? 'reject' : 'confirm');
    }

    // mode: 'code' (VALIDAR CON CÓDIGO) · 'force' (VALIDAR SIN CÓDIGO) · 'reject'.
    // Devuelve { action, body } listo para el POST, o { error, field }.
    function buildActionRequest(mode, code, note) {
        const cleanNote = String(note == null ? '' : note).trim().slice(0, NOTE_MAX);
        if (mode === 'code') {
            const normalized = normalizeCode(code);
            if (!normalized) return { error: MSG.codeInvalid, field: 'code' };
            const body = { code: normalized };
            if (cleanNote) body.note = cleanNote;
            return { action: 'confirm', body };
        }
        if (mode === 'force') {
            if (!cleanNote) return { error: MSG.noteForce, field: 'note' };
            return { action: 'confirm', body: { force: true, note: cleanNote } };
        }
        if (mode === 'reject') {
            if (!cleanNote) return { error: MSG.noteReject, field: 'note' };
            return { action: 'reject', body: { note: cleanNote } };
        }
        return { error: MSG.generic };
    }

    function makeError(status, json) {
        const serverMessage = json && (json.error || json.message) ? String(json.error || json.message).slice(0, 300) : '';
        const err = new Error(serverMessage || ('HTTP ' + status));
        err.status = status;
        err.code = (json && json.code) || null;
        err.serverMessage = serverMessage;
        return err;
    }

    function errorMessage(err) {
        if (!err) return MSG.generic;
        if (err.code === 'IG_VERIFICATION_UNAVAILABLE') return MSG.unavailable;
        if (err.status === 0) return MSG.network;
        if (err.status === 401) return MSG.session;
        if (err.status === 403) return MSG.forbidden;
        if (err.status === 404) return MSG.notFound;
        if (err.status === 429) return MSG.rate;
        if (err.serverMessage) return err.serverMessage;
        if (err.status === 409) return MSG.conflict;
        return MSG.generic;
    }

    // ---------------- estado ----------------

    const state = {
        items: [],
        loaded: false,
        loading: false,
        error: null,
        seq: 0,
        filter: { status: 'pending', search: '' },
        detail: null,
        detailDirty: false,
        flash: null,
        busy: false
    };
    let active = false;
    let previousSwitch = null;
    const hiddenSiblings = new Map();

    const $ = (id) => root.document.getElementById(id);

    function closest(node, selector) {
        return node && typeof node.closest === 'function' ? node.closest(selector) : null;
    }

    // ---------------- red ----------------

    async function getToken() {
        const clients = [root._supabase];
        try {
            if (root.ConfigManager && typeof root.ConfigManager.getSupabaseClient === 'function') {
                clients.push(root.ConfigManager.getSupabaseClient());
            }
        } catch (_) { /* sin ConfigManager seguimos con window._supabase */ }
        for (const client of clients) {
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') continue;
            try {
                const { data } = await client.auth.getSession();
                const token = data && data.session && data.session.access_token;
                if (token) return token;
            } catch (_) { /* probamos el siguiente cliente */ }
        }
        return null;
    }

    async function request(path, options) {
        const opts = options || {};
        const token = await getToken();
        if (!token) throw makeError(401, null);
        const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await root.fetch(basePath() + path, {
                method: opts.method || 'GET',
                headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                credentials: 'same-origin',
                cache: 'no-store'
            });
        } catch (_) {
            throw makeError(0, null);
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok || (json && json.success === false)) throw makeError(res.status, json);
        return json || {};
    }

    // ---------------- estilos ----------------
    // La página de soporte no carga ds/tokens.css: cada token lleva un
    // respaldo en palabras clave de CSS (Canvas, CanvasText, GrayText, Mark)
    // para que el panel se lea igual, sin hex sueltos. radius 0, sin sombras.
    const CSS = `
.igq-panel[hidden]{display:none}
.igq-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 var(--space-1,4px);margin-left:var(--space-1,4px);background:var(--action-danger,CanvasText);color:var(--action-danger-fg,Canvas);font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;line-height:1}
.igq-count[hidden]{display:none}
.igq-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.igq-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3,12px);padding:var(--space-4,16px) 0}
.igq-search-wrap{flex:1 1 220px;min-width:0}
.igq-input,.igq-select{width:100%;box-sizing:border-box;min-height:var(--control-h-md,44px);padding:var(--space-2,8px) var(--space-3,12px);border:var(--border-strong-width,2px) solid var(--border-strong,currentColor);border-radius:var(--radius-none,0);background:var(--surface-input,Canvas);color:var(--text-body,CanvasText);font-family:var(--font-body,Inter,sans-serif);font-size:16px}
.igq-select{width:auto;flex:0 1 auto;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:var(--meta-m-track,.08em);text-transform:uppercase;cursor:pointer}
.igq-input:focus-visible,.igq-select:focus-visible,.igq-btn:focus-visible,.igq-row:focus-visible,.igq-link:focus-visible{outline:var(--border-strong-width,2px) solid var(--border-focus,Highlight);outline-offset:2px}
.igq-input[aria-invalid="true"]{border-color:var(--action-danger,currentColor)}
.igq-input--code{font-family:var(--font-mono,'Space Mono',monospace);letter-spacing:.12em;text-transform:uppercase}
textarea.igq-input{min-height:88px;resize:vertical}
.igq-intro{margin:0 0 var(--space-4,16px);font-size:var(--body-s-size,14px);line-height:1.5;color:var(--text-muted,GrayText)}
.igq-table{border:var(--border-hairline,1px) solid var(--border-strong,currentColor);background:var(--surface-card,Canvas)}
.igq-table .header-cell{padding:var(--space-3,12px);font-family:var(--font-mono,'Space Mono',monospace);font-size:10px;letter-spacing:var(--meta-m-track,.08em);text-transform:uppercase;color:var(--text-muted,GrayText)}
.igq-row{padding:var(--space-3,12px) 0;border-bottom:var(--border-hairline,1px) solid var(--border-subtle,GrayText);cursor:pointer}
.igq-row:last-child{border-bottom:0}
.igq-row:hover{background:var(--neutral-100,transparent)}
.igq-row>.igq-cell{padding:0 var(--space-3,12px);min-width:0;overflow-wrap:anywhere}
.igq-name{display:block;font-weight:700}
.igq-muted{display:block;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:var(--text-muted,GrayText)}
.igq-mono{font-family:var(--font-mono,'Space Mono',monospace);font-size:12px}
.igq-empty{padding:var(--space-10,40px) var(--space-4,16px);text-align:center;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:var(--text-muted,GrayText)}
.igq-empty.is-error{color:var(--system-error,CanvasText)}
.igq-badge{display:inline-block;padding:var(--space-1,4px) var(--space-2,8px);border:var(--border-strong-width,2px) solid currentColor;border-radius:var(--radius-none,0);font-family:var(--font-mono,'Space Mono',monospace);font-size:10px;font-weight:700;letter-spacing:var(--meta-s-track,.08em);text-transform:uppercase}
.igq-badge.igq-badge--pending{background:var(--accent,Mark);color:var(--accent-fg,MarkText);border-color:var(--accent,currentColor)}
.igq-badge.igq-badge--verified{background:var(--system-success,CanvasText);color:var(--white,Canvas);border-color:var(--system-success,CanvasText)}
.igq-badge.igq-badge--rejected{background:var(--action-danger,transparent);color:var(--action-danger-fg,CanvasText);border-color:var(--action-danger,currentColor)}
.igq-badge.igq-badge--muted{background:transparent;color:var(--text-muted,GrayText);border-color:currentColor}
/* El drawer usa --space-6 de padding cuando hay tokens; sin tokens el panel pone el suyo. */
.igq-detail{min-height:100%;box-sizing:border-box;padding:calc(24px - var(--space-6,0px));background:var(--surface-card,Canvas);color:var(--text-body,CanvasText)}
.igq-eyebrow{margin:0 0 var(--space-2,8px);font-family:var(--font-mono,'Space Mono',monospace);font-size:var(--meta-m-size,12px);letter-spacing:var(--meta-m-track,.08em);text-transform:uppercase;color:var(--text-muted,GrayText)}
.igq-title{margin:0 0 var(--space-2,8px);font-family:var(--font-display,'Archivo Black',sans-serif);font-size:24px;line-height:1.15;overflow-wrap:anywhere}
.igq-title:focus{outline:none}
.igq-sub{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2,8px);margin:0 0 var(--space-4,16px);font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;overflow-wrap:anywhere}
.igq-section{margin:var(--space-4,16px) 0;padding:var(--space-4,16px);border:var(--border-strong-width,2px) solid var(--border-strong,currentColor);background:transparent}
.igq-section-title{margin:0 0 var(--space-3,12px);font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;font-weight:700;letter-spacing:var(--meta-m-track,.08em);text-transform:uppercase}
.igq-text{margin:0 0 var(--space-3,12px);font-size:var(--body-m-size,16px);line-height:1.5;overflow-wrap:anywhere}
.igq-links{display:flex;flex-wrap:wrap;gap:var(--space-2,8px) var(--space-4,16px);margin:0}
.igq-link{font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:var(--action-direct,LinkText);text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
.igq-facts{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3,12px) var(--space-4,16px);margin:0}
.igq-facts dt{margin:0 0 var(--space-1,4px);font-family:var(--font-mono,'Space Mono',monospace);font-size:10px;letter-spacing:var(--meta-s-track,.08em);text-transform:uppercase;color:var(--text-muted,GrayText)}
.igq-facts dd{margin:0;font-size:14px;overflow-wrap:anywhere}
.igq-field{margin:0 0 var(--space-4,16px)}
.igq-field label{display:block;margin:0 0 var(--space-2,8px);font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:var(--meta-m-track,.08em);text-transform:uppercase}
.igq-help{margin:var(--space-1,4px) 0 0;font-size:var(--body-s-size,14px);color:var(--text-muted,GrayText)}
.igq-feedback{margin:0 0 var(--space-4,16px);padding:var(--space-3,12px);border-left:var(--border-rule-width,3px) solid currentColor;font-size:14px;line-height:1.45;overflow-wrap:anywhere}
.igq-feedback[hidden]{display:none}
.igq-feedback.is-error{color:var(--system-error,CanvasText);background:var(--red-100,transparent)}
.igq-feedback.is-success{border-left-color:var(--system-success,currentColor);background:var(--surface-page,transparent)}
.igq-actions{display:flex;flex-direction:column;gap:var(--space-2,8px)}
.igq-btn{display:inline-flex;align-items:center;justify-content:center;min-height:var(--control-h-md,44px);padding:var(--space-2,8px) var(--space-4,16px);border:var(--border-strong-width,2px) solid var(--border-strong,currentColor);border-radius:var(--radius-none,0);background:var(--surface-card,Canvas);color:var(--text-body,CanvasText);font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;font-weight:700;letter-spacing:var(--button-s-track,.08em);box-shadow:none;cursor:pointer}
.igq-btn:hover{background:var(--action-ghost-hover,Canvas)}
.igq-btn.igq-btn--accent{background:var(--action-accent,Mark);border-color:var(--action-accent,currentColor);color:var(--action-accent-fg,MarkText)}
.igq-btn.igq-btn--accent:hover{background:var(--action-accent-hover,Mark)}
.igq-btn.igq-btn--danger{background:var(--action-danger,CanvasText);border-color:var(--action-danger,CanvasText);color:var(--action-danger-fg,Canvas)}
.igq-btn.igq-btn--danger:hover{background:var(--action-danger-hover,CanvasText)}
.igq-btn:disabled{cursor:not-allowed;opacity:.55}
@media (max-width:768px){
.igq-row{display:flex;flex-wrap:wrap;gap:var(--space-2,8px) var(--space-4,16px);padding:var(--space-4,16px) var(--space-3,12px)}
.igq-row>.igq-cell{padding:0}
.igq-row>.igq-artist{flex:1 1 100%}
.igq-cell[data-label]::before{content:attr(data-label) " · ";font-family:var(--font-mono,'Space Mono',monospace);font-size:10px;letter-spacing:var(--meta-s-track,.08em);text-transform:uppercase;color:var(--text-muted,GrayText)}
.igq-select{flex:1 1 auto}
.igq-facts{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
.igq-panel *,.igq-detail *{transition:none !important;animation:none !important}
}`;

    function injectStyles() {
        const doc = root.document;
        if ($('igq-style')) return;
        const style = doc.createElement('style');
        style.id = 'igq-style';
        style.textContent = CSS;
        (doc.head || doc.documentElement || doc.body).appendChild(style);
    }

    // ---------------- montaje del panel ----------------

    function panelHtml() {
        return `
            <div class="igq-toolbar">
                <div class="igq-search-wrap">
                    <label class="igq-sr" for="igq-search">Buscar validación</label>
                    <input type="search" id="igq-search" class="igq-input" placeholder="Buscar artista o @usuario" autocomplete="off" spellcheck="false">
                </div>
                <label class="igq-sr" for="igq-status">Estado de la validación</label>
                <select id="igq-status" class="igq-select">
                    <option value="pending">Pendientes</option>
                    <option value="verified">Validadas</option>
                    <option value="all">Todas</option>
                </select>
                <button type="button" id="igq-refresh" class="action-btn igq-btn">REFRESCAR</button>
            </div>
            <p class="igq-intro">Cada artista manda su código WO-XXXXXX por mensaje directo a @weotzi. Si la automatización no lo validó, revisalo acá.</p>
            <div class="table-container igq-table" style="--table-columns:${COLUMNS}">
                <div class="table-header">${HEADERS.map((label) => `<div class="header-cell"><span>${label}</span></div>`).join('')}</div>
                <div id="igq-body" aria-live="polite" aria-busy="true"><div class="igq-empty">${MSG.loading}</div></div>
            </div>`;
    }

    function ensurePanel() {
        let panel = $('igq-panel');
        if (panel) return panel;
        const table = $('table-container');
        if (!table || !table.parentNode) return null;
        panel = root.document.createElement('section');
        panel.id = 'igq-panel';
        panel.className = 'igq-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Validaciones de Instagram');
        panel.innerHTML = panelHtml();
        table.insertAdjacentElement('afterend', panel);

        const status = $('igq-status');
        if (status) {
            status.value = state.filter.status;
            status.addEventListener('change', (e) => {
                state.filter.status = STATUS_FILTERS.indexOf(e.target.value) >= 0 ? e.target.value : 'pending';
                // Sin filas del filtro anterior mientras llega la respuesta.
                state.items = [];
                state.loaded = false;
                state.error = null;
                load();
            });
        }
        const search = $('igq-search');
        if (search) search.addEventListener('input', (e) => { state.filter.search = e.target.value || ''; renderRows(); });
        const refresh = $('igq-refresh');
        if (refresh) refresh.addEventListener('click', () => load());
        const body = $('igq-body');
        if (body) {
            body.addEventListener('click', (e) => {
                const row = closest(e.target, '[data-igq-id]');
                if (row) openDetail(row.dataset.igqId);
            });
            body.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const row = closest(e.target, '[data-igq-id]');
                if (!row) return;
                e.preventDefault();
                openDetail(row.dataset.igqId);
            });
        }
        return panel;
    }

    // Todo lo que viene después de la barra de pestañas (toolbar, tabla y los
    // paneles de otras pestañas, p. ej. #sdt-panel de tickets) se oculta
    // mientras esta pestaña está activa, y vuelve a su estado al salir.
    function siblingsAfterTabs() {
        const nav = root.document.querySelector('.tab-navigation');
        const out = [];
        let el = nav ? nav.nextElementSibling : null;
        while (el) {
            out.push(el);
            el = el.nextElementSibling;
        }
        return out;
    }

    function markActive() {
        root.document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === TAB));
        root.document.querySelectorAll('.nav-menu-item').forEach((item) => item.classList.toggle('active', item.dataset.tab === TAB));
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
        if (!state.loaded && !state.loading) load();
        else renderRows();
    }

    function leave() {
        if (!active) return;
        active = false;
        const panel = $('igq-panel');
        if (panel) panel.hidden = true;
        hiddenSiblings.forEach((display, el) => { el.style.display = display; });
        hiddenSiblings.clear();
    }

    function switchTab(tabName) {
        if (tabName === TAB) {
            // La pestaña Tickets (otro módulo) también pinta su panel propio:
            // como esta pestaña no delega en el switchTab anterior, se oculta acá.
            const tickets = root.SupportDashboardTickets;
            if (tickets && typeof tickets.hide === 'function') tickets.hide();
            enter();
            return undefined;
        }
        leave();
        return previousSwitch ? previousSwitch.apply(this, arguments) : undefined;
    }

    // Los botones de esta pestaña no llevan onclick inline: se escuchan acá.
    // En captura, para salir del panel antes de que otra pestaña (que quizás
    // envolvió switchTab antes que este módulo) pinte el suyo.
    function onTabClick(e) {
        const trigger = closest(e.target, '[data-tab]');
        if (!trigger || !trigger.classList) return;
        if (!trigger.classList.contains('tab-btn') && !trigger.classList.contains('nav-menu-item')) return;
        if (trigger.dataset.tab === TAB) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            root.switchTab(TAB);
        } else {
            leave();
        }
    }

    // ---------------- datos ----------------

    async function load() {
        const seq = ++state.seq;
        state.loading = true;
        renderRows();
        try {
            const json = await request(listPath(state.filter.status));
            if (seq !== state.seq) return;
            state.items = Array.isArray(json.items) ? json.items : [];
            state.error = null;
        } catch (err) {
            if (seq !== state.seq) return;
            console.warn('[support-instagram] cola:', err.status || '', err.message);
            state.items = [];
            state.error = err;
        }
        state.loading = false;
        state.loaded = true;
        renderRows();
        if (state.error) setBadge(0);
        else if (state.filter.status === 'verified') refreshBadge();
        else setBadge(pendingCount(state.items, Date.now()));
        // El detalle abierto se repinta tras una acción o si cambió el estado;
        // un REFRESCAR sin cambios no pisa lo que soporte está escribiendo.
        if (state.detail) {
            const prev = state.detail.item;
            const fresh = findItem(state.detail.id);
            if (fresh) state.detail.item = fresh;
            if (state.detailDirty || (fresh && String(fresh.status) !== String(prev && prev.status))) rerenderDetail();
        }
        state.detailDirty = false;
    }

    function setBadge(count) {
        const n = toCount(count);
        root.document.querySelectorAll('.igq-count').forEach((el) => {
            el.textContent = n ? String(n) : '';
            el.title = n ? (n === 1 ? '1 validación pendiente' : n + ' validaciones pendientes') : '';
            el.hidden = !n;
        });
    }

    async function refreshBadge() {
        try {
            const json = await request(listPath('pending'));
            setBadge(pendingCount(json.items, Date.now()));
        } catch (_) {
            setBadge(0);
        }
    }

    function findItem(id) {
        return state.items.find((item) => String(item.id) === String(id)) || null;
    }

    function replaceItem(next) {
        const idx = state.items.findIndex((item) => String(item.id) === String(next.id));
        if (idx >= 0) state.items[idx] = next;
    }

    function matches(item, query) {
        if (!query) return true;
        const hay = [item.artist_name, item.username, item.ig_handle, item.email_masked]
            .map((v) => String(v == null ? '' : v).toLowerCase()).join(' ');
        return hay.indexOf(query) >= 0;
    }

    // Pendientes primero, el que vence antes arriba; el resto, lo más nuevo arriba.
    function sortItems(items, now) {
        return items.slice().sort((a, b) => {
            const pa = displayStatus(a, now) === 'pending' ? 0 : 1;
            const pb = displayStatus(b, now) === 'pending' ? 0 : 1;
            if (pa !== pb) return pa - pb;
            const never = Number.MAX_SAFE_INTEGER;
            if (pa === 0) return (toTime(a.expires_at) || never) - (toTime(b.expires_at) || never);
            return (toTime(b.created_at) || 0) - (toTime(a.created_at) || 0);
        });
    }

    // ---------------- render ----------------

    function fmtDate(iso) {
        const t = toTime(iso);
        if (t === null) return '-';
        return new Date(t).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }

    function fmtDateTime(iso) {
        const t = toTime(iso);
        if (t === null) return '-';
        return new Date(t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function badgeHtml(status) {
        const meta = statusMeta(status);
        return `<span class="status-badge igq-badge igq-badge--${meta.tone}">${esc(meta.label)}</span>`;
    }

    function at(value) {
        const handle = normalizeHandle(value);
        return handle ? '@' + handle : '';
    }

    function rowHtml(item, now) {
        const status = displayStatus(item, now);
        const handle = at(item.ig_handle);
        const user = at(item.username);
        const name = item.artist_name || user || 'Sin nombre';
        const showExpiry = status === 'pending' || status === 'expired';
        const label = 'Revisar la validación de ' + name + (handle ? ' · ' + handle : '') + ' · ' + statusMeta(status).label;
        return `
            <div class="quote-row data-row igq-row" role="button" tabindex="0" data-igq-id="${esc(item.id)}" aria-label="${esc(label)}">
                <div class="igq-cell igq-artist"><span class="igq-name">${esc(name)}</span>${user ? `<span class="igq-muted">${esc(user)}</span>` : ''}</div>
                <div class="igq-cell igq-mono" data-label="Instagram">${esc(handle || '-')}</div>
                <div class="igq-cell" data-label="Estado">${badgeHtml(status)}</div>
                <div class="igq-cell igq-mono" data-label="Creado">${esc(fmtDate(item.created_at))}</div>
                <div class="igq-cell igq-mono" data-label="Vence">${esc(showExpiry ? fmtDate(item.expires_at) : '-')}</div>
                <div class="igq-cell igq-mono" data-label="Fotos pendientes">${toCount(item.pending_items)}</div>
            </div>`;
    }

    function renderRows() {
        const body = $('igq-body');
        if (!body) return;
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        if (state.loading && !state.loaded) {
            body.innerHTML = `<div class="igq-empty">${esc(MSG.loading)}</div>`;
            return;
        }
        if (state.error) {
            body.innerHTML = `<div class="igq-empty is-error" role="alert">${esc(errorMessage(state.error))}</div>`;
            return;
        }
        const query = normalizeHandle(state.filter.search);
        const now = Date.now();
        const rows = sortItems(state.items.filter((item) => matches(item, query)), now);
        if (!rows.length) {
            const empty = query ? MSG.emptySearch
                : state.filter.status === 'verified' ? MSG.emptyVerified
                : state.filter.status === 'all' ? MSG.emptyAll : MSG.emptyPending;
            body.innerHTML = `<div class="igq-empty">${esc(empty)}</div>`;
            return;
        }
        body.innerHTML = rows.map((item) => rowHtml(item, now)).join('');
    }

    function fact(label, value) {
        return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    }

    function detailHtml(item, flash) {
        const now = Date.now();
        const status = displayStatus(item, now);
        const rawHandle = normalizeHandle(item.ig_handle);
        const handle = at(item.ig_handle);
        const user = at(item.username);
        const name = item.artist_name || user || 'Sin nombre';
        const actions = availableActions(item, now);
        const canCode = actions.indexOf('code') >= 0;
        const profileLink = HANDLE_RE.test(rawHandle)
            ? `<a class="igq-link" href="https://www.instagram.com/${encodeURIComponent(rawHandle)}/" target="_blank" rel="noopener noreferrer">Ver perfil de ${esc(handle)} →</a>`
            : '';
        const facts = [
            fact('Instagram', handle || '-'),
            fact('Fotos pendientes', String(toCount(item.pending_items))),
            fact('Creada', fmtDateTime(item.created_at)),
            fact('Vence', fmtDateTime(item.expires_at)),
            item.email_masked ? fact('Código enviado a', item.email_masked) : '',
            item.verified_at ? fact('Validada', fmtDateTime(item.verified_at)) : '',
            item.verified_via ? fact('Validada por', VIA_LABELS[item.verified_via] || item.verified_via) : ''
        ].join('');
        const feedback = flash && String(flash.id) === String(item.id) ? flash : null;
        const feedbackHtml = `<p id="igq-feedback" class="igq-feedback${feedback ? ' is-' + esc(feedback.kind) : ''}" role="${feedback && feedback.kind === 'error' ? 'alert' : 'status'}" aria-live="polite"${feedback ? '' : ' hidden'}>${feedback ? esc(feedback.text) : ''}</p>`;

        // Vencida: sin campo ni botón de código (el servidor lo rechaza sin
        // force); VALIDAR SIN CÓDIGO pasa a ser la acción principal.
        const codeField = canCode ? `
                <div class="igq-field">
                    <label for="igq-code">Código del mensaje</label>
                    <input id="igq-code" name="code" type="text" class="igq-input igq-input--code" placeholder="WO-XXXXXX" pattern="[Ww][Oo]-?[A-HJ-NP-Za-hj-np-z2-9]{6}" maxlength="64" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="igq-code-help">
                    <p id="igq-code-help" class="igq-help">Formato WO-XXXXXX. Podés pegar el mensaje entero: tomamos el código.</p>
                </div>` : '';
        const codeButton = canCode
            ? '<button type="submit" id="igq-act-code" class="action-btn igq-btn igq-btn--accent" data-igq-action="code">VALIDAR CON CÓDIGO</button>'
            : '';
        const howTo = status === 'expired'
            ? 'Si el mensaje llegó desde la cuenta del artista, validá sin código y dejá una nota con lo que viste.'
            : 'Pegalo abajo y tocá VALIDAR CON CÓDIGO. Si el artista no puede mandar el mensaje, validá sin código y dejá una nota.';

        const form = actions.length ? `
            <form id="igq-form" class="drawer-section igq-section" data-igq-form="${esc(item.id)}" novalidate>
                <p class="igq-section-title">Validar</p>
                ${status === 'expired' ? `<p class="igq-text">${esc(MSG.expiredHint)}</p>` : ''}
                ${codeField}
                <div class="igq-field">
                    <label for="igq-note">Nota interna</label>
                    <textarea id="igq-note" name="note" class="igq-input" rows="3" maxlength="${NOTE_MAX}" aria-describedby="igq-note-help"></textarea>
                    <p id="igq-note-help" class="igq-help">Obligatoria para validar sin código o rechazar. La ve solo soporte.</p>
                </div>
                ${feedbackHtml}
                <div class="igq-actions">
                    ${codeButton}
                    <button type="button" id="igq-act-force" class="action-btn igq-btn${canCode ? '' : ' igq-btn--accent'}" data-igq-action="force">VALIDAR SIN CÓDIGO</button>
                    <button type="button" id="igq-act-reject" class="action-btn igq-btn igq-btn--danger" data-igq-action="reject">RECHAZAR</button>
                </div>
            </form>` : `
            <div class="drawer-section igq-section">
                ${feedbackHtml}
                <p class="igq-text">${esc(MSG.notPending)}</p>
            </div>`;

        return `
            <div id="igq-detail" class="igq-detail" data-igq-id="${esc(item.id)}">
                <div class="shape-decor"></div>
                <p class="igq-eyebrow">Validación de Instagram</p>
                <h2 id="igq-detail-title" class="igq-title" tabindex="-1">${esc(name)}</h2>
                <p class="igq-sub">${user ? `<span>${esc(user)}</span><span aria-hidden="true">·</span>` : ''}${badgeHtml(status)}</p>

                <div class="drawer-section igq-section">
                    <p class="igq-section-title">Cómo validar</p>
                    <p class="igq-text">Abrí los mensajes directos de @weotzi, buscá el mensaje de ${esc(handle || 'la cuenta del artista')}${status === 'expired' ? '.' : ' y copiá el código.'}</p>
                    <p class="igq-text">${esc(howTo)}</p>
                    <p class="igq-links">
                        <a class="igq-link" href="https://www.instagram.com/direct/inbox/" target="_blank" rel="noopener noreferrer">Abrir mensajes directos →</a>
                        ${profileLink}
                    </p>
                </div>

                <div class="drawer-section igq-section">
                    <p class="igq-section-title">Solicitud</p>
                    <dl class="igq-facts">${facts}</dl>
                </div>
                ${form}
            </div>`;
    }

    function openDetail(id) {
        const item = findItem(id);
        const content = $('drawer-content');
        const toggle = $('drawer-toggle');
        if (!item || !content || !toggle) return;
        state.detail = { id: item.id, item };
        state.flash = null;
        content.innerHTML = detailHtml(item, null);
        toggle.checked = true;
        const title = $('igq-detail-title');
        if (title && typeof title.focus === 'function') {
            try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); }
        }
    }

    // Repinta el detalle solo si el drawer todavía muestra esta solicitud
    // (otra pestaña puede haberlo reutilizado mientras esperábamos al servidor).
    function rerenderDetail() {
        if (!state.detail) return;
        const shown = $('igq-detail');
        const content = $('drawer-content');
        if (!shown || !content || String(shown.dataset.igqId) !== String(state.detail.id)) return;
        content.innerHTML = detailHtml(state.detail.item, state.flash);
    }

    function setFeedback(kind, text) {
        const el = $('igq-feedback');
        if (!el) return;
        el.className = 'igq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    function setBusy(busy) {
        state.busy = busy;
        const form = $('igq-form');
        if (form) form.setAttribute('aria-busy', busy ? 'true' : 'false');
        ['igq-act-code', 'igq-act-force', 'igq-act-reject'].forEach((id) => {
            const btn = $(id);
            if (btn) btn.disabled = busy;
        });
    }

    function fieldValue(id) {
        const el = $(id);
        return el ? el.value : '';
    }

    function markInvalid(field) {
        ['igq-code', 'igq-note'].forEach((id) => {
            const el = $(id);
            if (!el) return;
            if (field && id === 'igq-' + field) el.setAttribute('aria-invalid', 'true');
            else el.removeAttribute('aria-invalid');
        });
        const target = field ? $('igq-' + field) : null;
        if (target && typeof target.focus === 'function') target.focus();
    }

    async function runAction(id, mode) {
        if (state.busy) return;
        const item = (state.detail && String(state.detail.id) === String(id) && state.detail.item) || findItem(id);
        if (!item) return;
        // Si el código venció con el detalle abierto, no se manda: el servidor
        // respondería 409 sin force.
        const now = Date.now();
        if (availableActions(item, now).indexOf(mode) < 0) {
            setFeedback('error', mode === 'code' && displayStatus(item, now) === 'expired' ? MSG.codeExpired : MSG.notPending);
            return;
        }
        const req = buildActionRequest(mode, fieldValue('igq-code'), fieldValue('igq-note'));
        if (req.error) {
            markInvalid(req.field);
            setFeedback('error', req.error);
            return;
        }
        markInvalid(null);
        setBusy(true);
        setFeedback('info', MSG.sending);
        try {
            const json = await request(actionPath(item.id, req.action), { method: 'POST', body: req.body });
            const nextStatus = req.action === 'reject' ? 'rejected' : 'verified';
            const fromServer = json && json.item && typeof json.item === 'object' ? json.item : {};
            const next = Object.assign({}, item, fromServer);
            if (!fromServer.status) next.status = nextStatus;
            if (nextStatus === 'verified') {
                if (!next.verified_at) next.verified_at = new Date().toISOString();
                if (!next.verified_via) next.verified_via = 'support';
            }
            const handle = at(item.ig_handle) || 'la cuenta';
            state.detail = { id: item.id, item: next };
            state.flash = {
                id: item.id,
                kind: 'success',
                text: nextStatus === 'verified'
                    ? `Validaste ${handle}. Las fotos importadas de esa cuenta ya se ven en el perfil público.`
                    : `Rechazaste la solicitud de ${handle}. Sus fotos de Instagram siguen ocultas hasta que valide la cuenta.`
            };
            replaceItem(next);
            state.busy = false;
            rerenderDetail();
            renderRows();
            state.detailDirty = true;
            await load();
        } catch (err) {
            console.warn('[support-instagram] acción:', mode, err.status || '', err.message);
            setBusy(false);
            setFeedback('error', errorMessage(err));
        } finally {
            state.busy = false;
        }
    }

    function onDrawerClick(e) {
        const btn = closest(e.target, '[data-igq-action]');
        if (!btn) return;
        const mode = btn.dataset.igqAction;
        if (mode === 'code') return; // es type=submit: lo atiende onDrawerSubmit
        const detail = $('igq-detail');
        if (!detail || !detail.dataset.igqId) return;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        runAction(detail.dataset.igqId, mode);
    }

    function onDrawerSubmit(e) {
        const form = closest(e.target, '[data-igq-form]');
        if (!form) return;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        runAction(form.dataset.igqForm, 'code');
    }

    // Al pegar o salir del campo, el código queda en su forma canónica.
    function onCodeSettle(e) {
        const input = e && e.target;
        if (!input || input.id !== 'igq-code') return;
        const apply = () => {
            const code = normalizeCode(input.value);
            if (code) input.value = code;
        };
        if (e.type === 'paste') root.setTimeout(apply, 0);
        else apply();
    }

    // ---------------- arranque ----------------

    function boot() {
        const doc = root.document;
        if (!doc || root.__igqBooted) return;
        root.__igqBooted = true;
        injectStyles();
        previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = switchTab;
        doc.addEventListener('click', onTabClick, true);
        const drawer = $('drawer-content');
        if (drawer) {
            drawer.addEventListener('click', onDrawerClick);
            drawer.addEventListener('submit', onDrawerSubmit);
            drawer.addEventListener('paste', onCodeSettle);
            drawer.addEventListener('change', onCodeSettle);
        }
        // Contador de la pestaña al iniciar, sin abrirla (como la de tickets).
        const scheduleBadge = () => root.setTimeout(() => { if (!state.loaded) refreshBadge(); }, 1200);
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', scheduleBadge);
        else scheduleBadge();
        root.SupportInstagramQueue = { refresh: load, refreshBadge, open: openDetail, isActive: () => active };
    }

    return {
        boot,
        _internal: {
            MSG,
            STATUS_META,
            esc,
            normalizeHandle,
            normalizeCode,
            displayStatus,
            statusMeta,
            pendingCount,
            availableActions,
            basePath,
            listPath,
            actionPath,
            buildActionRequest,
            makeError,
            errorMessage
        }
    };
}));
