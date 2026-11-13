// ============================================
// WE ÖTZI - Support Dashboard · pestaña VERIFICACIONES (ronda 3 · grupo pagos)
// funciones-b P1 puntos 3 y 4 (Figma 801:568/569 destinos de retiro, 801:573
// documentos). Dos colas en una pestaña:
//   · Destinos de retiro en 'pending': VERIFICAR / RECHAZAR con nota. Sin
//     destino verificado, request_artist_wallet_withdrawal rechaza el retiro.
//   · Documentos de verificación del artista: APROBAR / RECHAZAR con nota (la
//     nota la ve el artista en Cuenta · Verificación) + estado general del
//     artista (MARCAR VERIFICADO / DENEGAR).
// Módulo aparte (no edita support-dashboard.js): envuelve window.switchTab
// como support-dashboard-instagram.js, pinta #svq-panel y usa el drawer.
// Datos: WeotziData.SupportVerification (lecturas con RLS is_support_user();
// escrituras por RPC security definer que vuelven a chequear soporte).
// En Node (tests) solo exporta los helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TAB = 'verificacion';
    const NOTE_MIN = 5;
    const NOTE_MAX = 500;
    // ── integracion ── 'withdrawals': liquidar retiros (support_settle_artist_withdrawal).
    const KINDS = ['destinations', 'documents', 'withdrawals'];
    const REF_MIN = 3;
    const REF_MAX = 120;
    const WD_META = {
        pending: { label: 'En proceso', tone: 'pending' },
        verified: { label: 'Pagado', tone: 'verified' },
        rejected: { label: 'Fallido', tone: 'rejected' }
    };
    const WD_FILTER_LABELS = { pending: 'En proceso', verified: 'Pagados', rejected: 'Fallidos', all: 'Todos' };
    const QUEUE_FILTER_LABELS = { pending: 'Pendientes', verified: 'Verificados', rejected: 'Rechazados', all: 'Todos' };
    const STATUS_FILTERS = ['pending', 'verified', 'rejected', 'all'];
    const REQUIRED_DOCS = ['identidad', 'domicilio'];

    const DOC_LABELS = { identidad: 'Documento de identidad', domicilio: 'Comprobante de domicilio', bioseguridad: 'Certificado de bioseguridad' };
    const METHOD_LABELS = {
        lemon: 'Lemon', bank_usd: 'Cuenta bancaria USD', bank_international: 'Banco internacional',
        paypal: 'PayPal', wise: 'Wise', usdt: 'USDT', mercado_pago: 'Mercado Pago'
    };
    const ARTIST_STATE_LABELS = {
        Yes: 'Verificado', Requested: 'Solicitó verificación', 'In Progress': 'En revisión', 'In Analysis': 'En revisión',
        Denied: 'Denegado', No: 'Sin solicitar'
    };
    const STATUS_META = {
        pending: { label: 'Pendiente', tone: 'pending' },
        verified: { label: 'Verificado', tone: 'verified' },
        rejected: { label: 'Rechazado', tone: 'rejected' }
    };

    const MSG = {
        loading: 'Cargando…',
        emptyDest: 'No hay destinos de retiro en este estado.',
        emptyDocs: 'No hay documentos en este estado.',
        emptySearch: 'Nada coincide con la búsqueda.',
        unavailable: 'No pudimos leer la cola. Revisá que tu usuario tenga acceso de soporte.',
        noteReject: 'Escribí el motivo del rechazo (mínimo ' + NOTE_MIN + ' caracteres). Lo ve el artista.',
        noteLong: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.',
        generic: 'No pudimos completar la acción. Probá de nuevo.',
        rpcMissing: 'Falta aplicar la migración 20261112170000 (RPC de soporte).',
        emptyWd: 'No hay retiros en este estado.',
        refRequired: 'Escribí la referencia de la transferencia (mínimo ' + REF_MIN + ' caracteres).',
        refLong: 'La referencia puede tener hasta ' + REF_MAX + ' caracteres.',
        noteFail: 'Escribí el motivo del fallo (mínimo ' + NOTE_MIN + ' caracteres). Lo ve el artista.',
        rpcMissingWd: 'Falta aplicar la migración 20261112220000 (liquidar retiros).'
    };

    // ---------------- helpers puros (testeados en Node) ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 'pendiente' / 'verificado' / 'rechazado' (documentos) → clave común.
    function normalizeStatus(raw) {
        const s = String(raw || '').toLowerCase();
        // Retiros: processing → pending, completed → verified, failed/cancelled → rejected.
        if (s === 'completed') return 'verified';
        if (s === 'failed' || s === 'cancelled') return 'rejected';
        if (s === 'verified' || s.indexOf('verific') === 0 || s.indexOf('aprob') === 0) return 'verified';
        if (s === 'rejected' || s.indexOf('rechaz') === 0 || s.indexOf('deneg') === 0) return 'rejected';
        return 'pending';
    }

    function statusMeta(raw, kind) { return (kind === 'withdrawals' ? WD_META : STATUS_META)[normalizeStatus(raw)]; }

    // ── integracion ── liquidación de un retiro: { outcome, reference, note } o { error, field }.
    //   'paid'   → 'completed', referencia obligatoria (3–120), nota opcional.
    //   'failed' → 'failed', nota obligatoria (5–500, la ve el artista), referencia opcional.
    function buildSettlement(action, reference, note) {
        const ref = String(reference == null ? '' : reference).trim();
        const clean = String(note == null ? '' : note).trim();
        if (action !== 'paid' && action !== 'failed') return { error: MSG.generic };
        if (ref.length > REF_MAX) return { error: MSG.refLong, field: 'reference' };
        if (clean.length > NOTE_MAX) return { error: MSG.noteLong, field: 'note' };
        if (action === 'paid' && ref.length < REF_MIN) return { error: MSG.refRequired, field: 'reference' };
        if (action === 'failed' && clean.length < NOTE_MIN) return { error: MSG.noteFail, field: 'note' };
        return { outcome: action === 'paid' ? 'completed' : 'failed', reference: ref || null, note: clean || null };
    }

    function formatAmount(amount, currency) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return String(currency || '');
        return String(currency || '').toUpperCase() + ' ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function maskIdentifier(value) {
        const clean = String(value || '').replace(/\s+/g, '');
        return clean ? '···· ' + clean.slice(-4) : '—';
    }

    // Arma la decisión: { decision, note } o { error, field }.
    //   kind 'destinations' → 'verified' | 'rejected'
    //   kind 'documents'    → 'verificado' | 'rechazado'
    function buildReview(kind, action, note) {
        const clean = String(note == null ? '' : note).trim();
        if (clean.length > NOTE_MAX) return { error: MSG.noteLong, field: 'note' };
        if (action === 'reject' && clean.length < NOTE_MIN) return { error: MSG.noteReject, field: 'note' };
        if (action !== 'approve' && action !== 'reject') return { error: MSG.generic };
        const decision = kind === 'documents'
            ? (action === 'approve' ? 'verificado' : 'rechazado')
            : (action === 'approve' ? 'verified' : 'rejected');
        return { decision, note: clean || null };
    }

    // ¿Los documentos obligatorios (identidad y domicilio) están aprobados?
    function requiredDocsStatus(docs) {
        const byType = {};
        (docs || []).forEach((d) => { byType[d.doc_type] = normalizeStatus(d.status); });
        const missing = REQUIRED_DOCS.filter((t) => byType[t] !== 'verified');
        return { ok: missing.length === 0, missing: missing.map((t) => DOC_LABELS[t]) };
    }

    function errorText(err) {
        const cause = (err && err.cause) || {};
        const msg = String(cause.message || (err && err.message) || '').replace(/^\[[^\]]+\]\s*/, '');
        if (/support_settle_artist_withdrawal/i.test(msg) && (/could not find the function|PGRST202/i.test(msg) || cause.code === 'PGRST202')) return MSG.rpcMissingWd;
        if (/could not find the function|PGRST202/i.test(msg) || cause.code === 'PGRST202') return MSG.rpcMissing;
        if (/Ese retiro|referencia/i.test(msg)) return msg;
        if (/Solo soporte|42501|permission denied/i.test(msg) || cause.code === '42501') return 'Tu usuario no tiene acceso de soporte para esta acción.';
        if (msg && /[áéíóúñ]|Escribí|No encontramos|Decisión|Estado/i.test(msg)) return msg;
        return MSG.generic;
    }

    // ---------------- estado ----------------

    const state = {
        kind: 'documents', status: 'pending', search: '',
        items: [], artists: {}, destinations: {}, loaded: false, loading: false, error: null, seq: 0,
        detail: null, busy: false
    };
    let active = false;
    let previousSwitch = null;
    const hiddenSiblings = new Map();
    const $ = (id) => root.document.getElementById(id);
    function repo() { return root.WeotziData && root.WeotziData.SupportVerification; }

    // ---------------- estilos ----------------
    // La página de soporte no carga ds/tokens.css: cada token lleva respaldo
    // en palabras clave de CSS (igual que la pestaña de Instagram).
    const CSS = `
.svq-panel[hidden]{display:none}
.svq-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;margin-left:4px;background:var(--action-danger,CanvasText);color:var(--action-danger-fg,Canvas);font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;line-height:1}
.svq-count[hidden]{display:none}
.svq-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.svq-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px 0}
.svq-search{flex:1 1 220px;min-width:0}
.svq-input,.svq-select{width:100%;box-sizing:border-box;min-height:44px;padding:8px 12px;border:2px solid currentColor;border-radius:0;background:Canvas;color:CanvasText;font-family:var(--font-body,Inter,sans-serif);font-size:16px}
.svq-select{width:auto;flex:0 1 auto;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.svq-input:focus-visible,.svq-select:focus-visible,.svq-btn:focus-visible,.svq-row:focus-visible,.svq-link:focus-visible{outline:2px solid Highlight;outline-offset:2px}
.svq-input[aria-invalid="true"]{border-color:var(--action-danger,currentColor)}
textarea.svq-input{min-height:88px;resize:vertical}
.svq-intro{margin:0 0 16px;font-size:14px;line-height:1.5;color:GrayText}
.svq-table{border:1px solid currentColor;background:Canvas}
.svq-table .header-cell{padding:12px;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.svq-row{padding:12px 0;border-bottom:1px solid GrayText;cursor:pointer}
.svq-row:last-child{border-bottom:0}
.svq-row>.svq-cell{padding:0 12px;min-width:0;overflow-wrap:anywhere}
.svq-name{display:block;font-weight:700}
.svq-muted{display:block;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:GrayText}
.svq-mono{font-family:var(--font-mono,'Space Mono',monospace);font-size:12px}
.svq-empty{padding:40px 16px;text-align:center;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:GrayText}
.svq-empty.is-error{color:var(--system-error,CanvasText)}
.svq-badge{display:inline-block;padding:4px 8px;border:2px solid currentColor;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.svq-badge--pending{background:var(--accent,Mark);color:var(--accent-fg,MarkText);border-color:var(--accent,currentColor)}
.svq-badge--verified{background:var(--system-success,CanvasText);color:var(--white,Canvas);border-color:var(--system-success,CanvasText)}
.svq-badge--rejected{background:transparent;color:var(--action-danger,CanvasText);border-color:var(--action-danger,currentColor)}
.svq-detail{min-height:100%;box-sizing:border-box;background:Canvas;color:CanvasText}
.svq-eyebrow{margin:0 0 8px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.svq-title{margin:0 0 8px;font-family:var(--font-display,'Archivo Black',sans-serif);font-size:24px;line-height:1.15;overflow-wrap:anywhere}
.svq-title:focus{outline:none}
.svq-sub{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px}
.svq-section{margin:16px 0;padding:16px;border:2px solid currentColor}
.svq-section-title{margin:0 0 12px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.svq-text{margin:0 0 12px;font-size:15px;line-height:1.5;overflow-wrap:anywhere}
.svq-facts{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin:0}
.svq-facts dt{margin:0 0 4px;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.svq-facts dd{margin:0;font-size:14px;overflow-wrap:anywhere}
.svq-doclist{list-style:none;margin:0;padding:0}
.svq-doclist li{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid GrayText;font-size:14px}
.svq-doclist li:last-child{border-bottom:0}
.svq-field label{display:block;margin:0 0 8px;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.svq-help{margin:4px 0 0;font-size:14px;color:GrayText}
.svq-feedback{margin:12px 0;padding:12px;border-left:3px solid currentColor;font-size:14px;line-height:1.45}
.svq-feedback[hidden]{display:none}
.svq-feedback.is-error{color:var(--system-error,CanvasText)}
.svq-feedback.is-success{border-left-color:var(--system-success,currentColor)}
.svq-actions{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.svq-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 16px;border:2px solid currentColor;border-radius:0;background:Canvas;color:CanvasText;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;font-weight:700;letter-spacing:.08em;cursor:pointer}
.svq-btn--accent{background:var(--action-accent,Mark);color:var(--action-accent-fg,MarkText)}
.svq-btn--danger{background:var(--action-danger,CanvasText);border-color:var(--action-danger,CanvasText);color:var(--action-danger-fg,Canvas)}
.svq-btn:disabled{cursor:not-allowed;opacity:.55}
.svq-link{padding:0;border:0;background:none;font-family:var(--font-mono,'Space Mono',monospace);font-size:12px;color:LinkText;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
@media (max-width:768px){
.svq-row{display:flex;flex-wrap:wrap;gap:8px 16px;padding:16px 12px}
.svq-row>.svq-cell{padding:0}
.svq-row>.svq-artist{flex:1 1 100%}
.svq-cell[data-label]::before{content:attr(data-label) " · ";font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:GrayText}
.svq-facts{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.svq-panel *,.svq-detail *{transition:none !important;animation:none !important}}`;

    function injectStyles() {
        if ($('svq-style')) return;
        const style = root.document.createElement('style');
        style.id = 'svq-style';
        style.textContent = CSS;
        (root.document.head || root.document.documentElement).appendChild(style);
    }

    // ---------------- panel ----------------

    // ── integracion ── el filtro de estado se lee distinto en la cola de retiros.
    function syncStatusLabels() {
        const select = $('svq-status');
        if (!select) return;
        const labels = state.kind === 'withdrawals' ? WD_FILTER_LABELS : QUEUE_FILTER_LABELS;
        Array.prototype.forEach.call(select.options, (opt) => { if (labels[opt.value]) opt.textContent = labels[opt.value]; });
    }

    function columns() {
        if (state.kind === 'withdrawals') {
            return { tpl: 'minmax(0,2fr) 140px minmax(0,1.6fr) 120px 120px 100px', heads: ['Artista', 'Monto', 'Destino', 'Cuenta', 'Estado', 'Pedido'] };
        }
        return state.kind === 'destinations'
            ? { tpl: 'minmax(0,2fr) minmax(0,1.4fr) 90px 120px 120px 100px', heads: ['Artista', 'Destino', 'Moneda', 'Cuenta', 'Estado', 'Alta'] }
            : { tpl: 'minmax(0,2fr) minmax(0,1.6fr) minmax(0,1.2fr) 120px 100px 140px', heads: ['Artista', 'Documento', 'Archivo', 'Estado', 'Subido', 'Artista · estado'] };
    }

    function panelHtml() {
        return `
            <div class="svq-toolbar">
                <label class="svq-sr" for="svq-kind">Cola</label>
                <select id="svq-kind" class="svq-select">
                    <option value="documents">Documentos</option>
                    <option value="destinations">Destinos de retiro</option>
                    <option value="withdrawals">Retiros</option>
                </select>
                <label class="svq-sr" for="svq-status">Estado</label>
                <select id="svq-status" class="svq-select">
                    <option value="pending">Pendientes</option>
                    <option value="verified">Verificados</option>
                    <option value="rejected">Rechazados</option>
                    <option value="all">Todos</option>
                </select>
                <div class="svq-search">
                    <label class="svq-sr" for="svq-search">Buscar</label>
                    <input type="search" id="svq-search" class="svq-input" placeholder="Buscar artista, @usuario o email" autocomplete="off" spellcheck="false">
                </div>
                <button type="button" id="svq-refresh" class="action-btn svq-btn">REFRESCAR</button>
            </div>
            <p class="svq-intro" id="svq-intro"></p>
            <div class="table-container svq-table" id="svq-table">
                <div class="table-header" id="svq-head"></div>
                <div id="svq-body" aria-live="polite" aria-busy="true"><div class="svq-empty">${MSG.loading}</div></div>
            </div>`;
    }

    function ensurePanel() {
        let panel = $('svq-panel');
        if (panel) return panel;
        const table = $('table-container');
        if (!table || !table.parentNode) return null;
        panel = root.document.createElement('section');
        panel.id = 'svq-panel';
        panel.className = 'svq-panel';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Verificaciones');
        panel.innerHTML = panelHtml();
        table.insertAdjacentElement('afterend', panel);
        $('svq-kind').addEventListener('change', (e) => {
            state.kind = KINDS.indexOf(e.target.value) >= 0 ? e.target.value : 'documents';
            syncStatusLabels();
            state.items = []; state.loaded = false; load();
        });
        $('svq-status').addEventListener('change', (e) => {
            state.status = STATUS_FILTERS.indexOf(e.target.value) >= 0 ? e.target.value : 'pending';
            state.items = []; state.loaded = false; load();
        });
        $('svq-search').addEventListener('input', (e) => { state.search = e.target.value || ''; renderRows(); });
        $('svq-refresh').addEventListener('click', () => load());
        const body = $('svq-body');
        body.addEventListener('click', (e) => {
            const row = e.target.closest('[data-svq-id]');
            if (row) openDetail(row.dataset.svqId);
        });
        body.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('[data-svq-id]');
            if (!row) return;
            e.preventDefault();
            openDetail(row.dataset.svqId);
        });
        return panel;
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
        if (!state.loaded && !state.loading) load(); else renderRows();
    }

    function leave() {
        if (!active) return;
        active = false;
        const panel = $('svq-panel');
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
            root.switchTab(TAB);
        } else {
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
            const items = state.kind === 'destinations' ? await R.listDestinations(state.status)
                : state.kind === 'withdrawals' ? await R.listWithdrawals(state.status)
                    : await R.listDocuments(state.status);
            const artists = await R.artistsByUserIds(items.map((i) => i.artist_user_id)).catch(() => []);
            const dests = state.kind === 'withdrawals'
                ? await R.destinationsByIds(items.map((i) => i.destination_id)).catch(() => []) : [];
            if (seq !== state.seq) return;
            state.items = items;
            state.destinations = {};
            dests.forEach((d) => { state.destinations[d.id] = d; });
            state.artists = {};
            artists.forEach((a) => { state.artists[a.user_id] = a; });
            state.error = null;
        } catch (err) {
            if (seq !== state.seq) return;
            console.warn('[support-verification] cola:', err && err.message);
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
        try { const c = await R.countPending(); n = c.destinations + c.documents + (c.withdrawals || 0); } catch (_) { n = 0; }
        root.document.querySelectorAll('.svq-count').forEach((el) => {
            el.textContent = n ? String(n) : '';
            el.title = n ? n + ' pendientes de revisión' : '';
            el.hidden = !n;
        });
    }

    function artistOf(item) { return state.artists[item.artist_user_id] || {}; }

    function matches(item, q) {
        if (!q) return true;
        const a = artistOf(item);
        const dest = state.destinations[item.destination_id] || {};
        return [a.name, a.username, a.email, item.label, item.holder_name, item.file_name, item.title, dest.label, dest.holder_name]
            .map((v) => String(v == null ? '' : v).toLowerCase()).join(' ').indexOf(q) >= 0;
    }

    // ---------------- render ----------------

    function fmtDate(iso) {
        const t = iso ? Date.parse(iso) : NaN;
        return Number.isFinite(t) ? new Date(t).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-';
    }
    function fmtDateTime(iso) {
        const t = iso ? Date.parse(iso) : NaN;
        return Number.isFinite(t) ? new Date(t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
    }
    function badge(raw, kind) {
        const m = statusMeta(raw, kind);
        return `<span class="status-badge svq-badge svq-badge--${m.tone}">${esc(m.label)}</span>`;
    }

    function rowHtml(item) {
        const a = artistOf(item);
        const name = a.name || (a.username ? '@' + a.username : 'Artista sin perfil');
        const sub = a.username ? '@' + a.username : (a.email || '');
        if (state.kind === 'withdrawals') {
            const dest = state.destinations[item.destination_id] || {};
            const amount = formatAmount(item.amount, item.currency);
            return `<div class="quote-row data-row svq-row" role="button" tabindex="0" data-svq-id="${esc(item.id)}" aria-label="${esc('Revisar retiro de ' + amount + ' de ' + name)}">
                <div class="svq-cell svq-artist"><span class="svq-name">${esc(name)}</span><span class="svq-muted">${esc(sub)}</span></div>
                <div class="svq-cell svq-mono" data-label="Monto">${esc(amount)}</div>
                <div class="svq-cell" data-label="Destino"><span class="svq-name">${esc(dest.label || item.title || 'Destino')}</span><span class="svq-muted">${esc(METHOD_LABELS[dest.method] || dest.method || '')}</span></div>
                <div class="svq-cell svq-mono" data-label="Cuenta">${esc(maskIdentifier(dest.account_identifier))}</div>
                <div class="svq-cell" data-label="Estado">${badge(item.status, 'withdrawals')}</div>
                <div class="svq-cell svq-mono" data-label="Pedido">${esc(fmtDate(item.occurred_at || item.created_at))}</div>
            </div>`;
        }
        if (state.kind === 'destinations') {
            return `<div class="quote-row data-row svq-row" role="button" tabindex="0" data-svq-id="${esc(item.id)}" aria-label="${esc('Revisar destino ' + item.label + ' de ' + name)}">
                <div class="svq-cell svq-artist"><span class="svq-name">${esc(name)}</span><span class="svq-muted">${esc(sub)}</span></div>
                <div class="svq-cell" data-label="Destino"><span class="svq-name">${esc(item.label)}</span><span class="svq-muted">${esc(METHOD_LABELS[item.method] || item.method)}</span></div>
                <div class="svq-cell svq-mono" data-label="Moneda">${esc(item.currency)}</div>
                <div class="svq-cell svq-mono" data-label="Cuenta">${esc(maskIdentifier(item.account_identifier))}</div>
                <div class="svq-cell" data-label="Estado">${badge(item.verification_status)}</div>
                <div class="svq-cell svq-mono" data-label="Alta">${esc(fmtDate(item.created_at))}</div>
            </div>`;
        }
        return `<div class="quote-row data-row svq-row" role="button" tabindex="0" data-svq-id="${esc(item.id)}" aria-label="${esc('Revisar ' + (DOC_LABELS[item.doc_type] || item.doc_type) + ' de ' + name)}">
            <div class="svq-cell svq-artist"><span class="svq-name">${esc(name)}</span><span class="svq-muted">${esc(sub)}</span></div>
            <div class="svq-cell" data-label="Documento">${esc(DOC_LABELS[item.doc_type] || item.doc_type)}</div>
            <div class="svq-cell svq-mono" data-label="Archivo">${esc(item.file_name || '-')}</div>
            <div class="svq-cell" data-label="Estado">${badge(item.status)}</div>
            <div class="svq-cell svq-mono" data-label="Subido">${esc(fmtDate(item.uploaded_at))}</div>
            <div class="svq-cell svq-mono" data-label="Artista · estado">${esc(ARTIST_STATE_LABELS[a.verification_state] || a.verification_state || '-')}</div>
        </div>`;
    }

    function renderRows() {
        const body = $('svq-body');
        if (!body) return;
        const cols = columns();
        const table = $('svq-table');
        if (table) table.style.setProperty('--table-columns', cols.tpl);
        const head = $('svq-head');
        if (head) head.innerHTML = cols.heads.map((h) => `<div class="header-cell"><span>${esc(h)}</span></div>`).join('');
        const intro = $('svq-intro');
        if (intro) intro.textContent = state.kind === 'destinations'
            ? 'Verificá que el titular coincida con el artista (y con su documento de identidad) antes de habilitar retiros a ese destino.'
            : state.kind === 'withdrawals'
                ? 'Cuando la transferencia salga, marcá el retiro como pagado con su referencia. Si falla, el monto vuelve al saldo del artista y le llega tu nota.'
                : 'Revisá cada documento. Si lo rechazás, la nota le llega al artista en Cuenta · Verificación.';
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        if (state.loading && !state.loaded) { body.innerHTML = `<div class="svq-empty">${MSG.loading}</div>`; return; }
        if (state.error) { body.innerHTML = `<div class="svq-empty is-error" role="alert">${esc(MSG.unavailable)}</div>`; return; }
        const q = String(state.search || '').trim().toLowerCase().replace(/^@/, '');
        const rows = state.items.filter((i) => matches(i, q));
        if (!rows.length) {
            body.innerHTML = `<div class="svq-empty">${esc(q ? MSG.emptySearch : state.kind === 'destinations' ? MSG.emptyDest : state.kind === 'withdrawals' ? MSG.emptyWd : MSG.emptyDocs)}</div>`;
            return;
        }
        body.innerHTML = rows.map(rowHtml).join('');
    }

    function fact(label, value) { return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`; }

    function reviewForm(item, approveLabel, kindLabel) {
        return `<form class="drawer-section svq-section" id="svq-form" data-svq-form="${esc(item.id)}" novalidate>
            <p class="svq-section-title">Decisión</p>
            <div class="svq-field">
                <label for="svq-note">Nota para el artista</label>
                <textarea id="svq-note" class="svq-input" rows="3" maxlength="${NOTE_MAX}" aria-describedby="svq-note-help"></textarea>
                <p class="svq-help" id="svq-note-help">Obligatoria para rechazar (la ve el artista). Opcional al ${esc(kindLabel)}.</p>
            </div>
            <p id="svq-feedback" class="svq-feedback" role="status" aria-live="polite" hidden></p>
            <div class="svq-actions">
                <button type="button" class="action-btn svq-btn svq-btn--accent" data-svq-action="approve">${esc(approveLabel)}</button>
                <button type="button" class="action-btn svq-btn svq-btn--danger" data-svq-action="reject">RECHAZAR</button>
            </div>
        </form>`;
    }

    function destinationDetail(item) {
        const a = artistOf(item);
        const review = item.metadata_json && item.metadata_json.review;
        return `<div id="svq-detail" class="svq-detail" data-svq-id="${esc(item.id)}" data-svq-kind="destinations">
            <p class="svq-eyebrow">Destino de retiro</p>
            <h2 id="svq-detail-title" class="svq-title" tabindex="-1">${esc(item.label)}</h2>
            <p class="svq-sub"><span>${esc(a.name || 'Artista')}</span><span aria-hidden="true">·</span>${badge(item.verification_status)}</p>
            <div class="drawer-section svq-section">
                <p class="svq-section-title">Datos</p>
                <dl class="svq-facts">
                    ${fact('Titular', item.holder_name)}
                    ${fact('Artista', a.name || '-')}
                    ${fact('Método', METHOD_LABELS[item.method] || item.method)}
                    ${fact('Moneda', item.currency)}
                    ${fact('Riel', item.rail || '-')}
                    ${fact('País', item.country_code || a.country || '-')}
                    ${fact('Cuenta (CBU / IBAN / alias)', item.account_identifier)}
                    ${fact('Alta', fmtDateTime(item.created_at))}
                    ${item.verified_at ? fact('Verificado', fmtDateTime(item.verified_at)) : ''}
                    ${review && review.note ? fact('Nota de la última revisión', review.note) : ''}
                </dl>
            </div>
            ${reviewForm(item, 'VERIFICAR DESTINO', 'verificar')}
        </div>`;
    }

    // ── integracion ── detalle de un retiro (diseño propio: mismo drawer y
    // secciones que los destinos; formulario con referencia + nota).
    function withdrawalDetail(item) {
        const a = artistOf(item);
        const dest = state.destinations[item.destination_id] || {};
        const meta = item.metadata_json || {};
        const settlement = meta.settlement || null;
        const open = item.status === 'processing';
        const amount = formatAmount(item.amount, item.currency);
        const form = open ? `<form class="drawer-section svq-section" id="svq-form" data-svq-form="${esc(item.id)}" novalidate>
                <p class="svq-section-title">Liquidación</p>
                <div class="svq-field">
                    <label for="svq-reference">Referencia de la transferencia</label>
                    <input type="text" id="svq-reference" class="svq-input" maxlength="${REF_MAX}" autocomplete="off" spellcheck="false" aria-describedby="svq-reference-help">
                    <p class="svq-help" id="svq-reference-help">Obligatoria para marcar pagado (número de operación, ID del proveedor). La ve el artista.</p>
                </div>
                <div class="svq-field">
                    <label for="svq-note">Nota para el artista</label>
                    <textarea id="svq-note" class="svq-input" rows="3" maxlength="${NOTE_MAX}" aria-describedby="svq-note-help"></textarea>
                    <p class="svq-help" id="svq-note-help">Obligatoria si el retiro falló (el monto vuelve a su saldo disponible). Opcional al pagar.</p>
                </div>
                <p id="svq-feedback" class="svq-feedback" role="status" aria-live="polite" hidden></p>
                <div class="svq-actions">
                    <button type="button" class="action-btn svq-btn svq-btn--accent" data-svq-settle="paid">MARCAR PAGADO</button>
                    <button type="button" class="action-btn svq-btn svq-btn--danger" data-svq-settle="failed">MARCAR FALLIDO</button>
                </div>
            </form>` : `<p id="svq-feedback" class="svq-feedback" role="status" aria-live="polite" hidden></p>`;
        return `<div id="svq-detail" class="svq-detail" data-svq-id="${esc(item.id)}" data-svq-kind="withdrawals">
            <p class="svq-eyebrow">Retiro del Wallet</p>
            <h2 id="svq-detail-title" class="svq-title" tabindex="-1">${esc(amount)}</h2>
            <p class="svq-sub"><span>${esc(a.name || 'Artista')}</span><span aria-hidden="true">·</span>${badge(item.status, 'withdrawals')}</p>
            <div class="drawer-section svq-section">
                <p class="svq-section-title">Destino</p>
                <dl class="svq-facts">
                    ${fact('Destino', dest.label || item.title || '-')}
                    ${fact('Titular', dest.holder_name || '-')}
                    ${fact('Método', METHOD_LABELS[dest.method] || dest.method || '-')}
                    ${fact('Riel', dest.rail || '-')}
                    ${fact('Cuenta (CBU / IBAN / alias)', dest.account_identifier || '-')}
                    ${fact('Destino verificado', dest.verification_status === 'verified' ? 'Sí' : (dest.verification_status ? 'No' : '-'))}
                    ${fact('Pedido', fmtDateTime(item.occurred_at || item.created_at))}
                    ${fact('Artista', a.email || a.name || '-')}
                </dl>
            </div>
            ${settlement ? `<div class="drawer-section svq-section">
                <p class="svq-section-title">Liquidación</p>
                <dl class="svq-facts">
                    ${fact('Resultado', statusMeta(item.status, 'withdrawals').label)}
                    ${fact('Fecha', fmtDateTime(settlement.settled_at))}
                    ${settlement.reference ? fact('Referencia', settlement.reference) : ''}
                    ${settlement.note ? fact('Nota', settlement.note) : ''}
                </dl>
            </div>` : ''}
            ${form}
        </div>`;
    }

    // ── integracion ── aviso por email al artista (el servidor relee la decisión
    // de la base y respeta sus preferencias). El aviso in-app sale de la fila.
    async function supportToken() {
        const clients = [root._supabase];
        try {
            const D = root.WeotziData;
            if (D && typeof D.getClient === 'function') clients.push(D.getClient());
            if (root.ConfigManager && typeof root.ConfigManager.getSupabaseClient === 'function') clients.push(root.ConfigManager.getSupabaseClient());
        } catch (_) { /* seguimos con los clientes que haya */ }
        for (const client of clients) {
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') continue;
            try {
                const { data } = await client.auth.getSession();
                const token = data && data.session && data.session.access_token;
                if (token) return token;
            } catch (_) { /* probamos el siguiente */ }
        }
        return null;
    }

    async function notifyArtist(subject, id) {
        try {
            const token = await supportToken();
            if (!token || typeof root.fetch !== 'function') return null;
            const res = await root.fetch('/api/support/artist-decision-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ subject, id }),
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const json = await res.json().catch(() => ({}));
            return res.ok && json && json.success ? json : null;
        } catch (err) {
            console.warn('[support-verification] aviso al artista:', err && err.message);
            return null;
        }
    }

    function notifyText(result) {
        if (!result) return ' El artista lo ve en su cuenta (no pudimos confirmar el email).';
        if (result.sent || result.deduplicated) return ' Le avisamos al artista por email y en su panel.';
        if (result.skipped === 'notification_pref') return ' El artista lo ve en su panel (apagó estos avisos por email).';
        return ' El artista lo ve en su panel.';
    }

    async function runSettle(action) {
        const d = state.detail;
        if (!d || state.busy || d.kind !== 'withdrawals') return;
        const ref = $('svq-reference');
        const note = $('svq-note');
        const req = buildSettlement(action, ref ? ref.value : '', note ? note.value : '');
        [ref, note].forEach((el) => { if (el) el.removeAttribute('aria-invalid'); });
        if (req.error) {
            const target = req.field === 'reference' ? ref : note;
            if (target) { target.setAttribute('aria-invalid', 'true'); target.focus(); }
            feedback('svq-feedback', 'error', req.error);
            return;
        }
        state.busy = true;
        root.document.querySelectorAll('[data-svq-settle]').forEach((b) => { b.disabled = true; });
        feedback('svq-feedback', 'info', 'Guardando…');
        try {
            const row = await repo().settleWithdrawal(d.id, req.outcome, req.reference, req.note);
            if (row && typeof row === 'object') Object.assign(d.item, row);
            const notified = await notifyArtist('withdrawal', d.id);
            const content = $('drawer-content');
            if (content && $('svq-detail')) content.innerHTML = withdrawalDetail(d.item);
            feedback('svq-feedback', 'success', (req.outcome === 'completed'
                ? 'Retiro marcado como pagado.'
                : 'Retiro marcado como fallido: el monto volvió al saldo disponible del artista.') + notifyText(notified));
            const title = $('svq-detail-title');
            if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
            await load();
        } catch (err) {
            console.warn('[support-verification] liquidación:', err && err.message);
            feedback('svq-feedback', 'error', errorText(err));
        } finally {
            state.busy = false;
            root.document.querySelectorAll('[data-svq-settle]').forEach((b) => { b.disabled = false; });
        }
    }

    function documentDetail(item, artistDocs) {
        const a = artistOf(item);
        const req = requiredDocsStatus(artistDocs);
        const docs = (artistDocs || []).map((d) => `<li><span>${esc(DOC_LABELS[d.doc_type] || d.doc_type)}</span>${badge(d.status)}</li>`).join('')
            || '<li><span>Sin documentos</span></li>';
        return `<div id="svq-detail" class="svq-detail" data-svq-id="${esc(item.id)}" data-svq-kind="documents">
            <p class="svq-eyebrow">Documento de verificación</p>
            <h2 id="svq-detail-title" class="svq-title" tabindex="-1">${esc(DOC_LABELS[item.doc_type] || item.doc_type)}</h2>
            <p class="svq-sub"><span>${esc(a.name || 'Artista')}</span><span aria-hidden="true">·</span>${badge(item.status)}</p>
            <div class="drawer-section svq-section">
                <p class="svq-section-title">Archivo</p>
                <p class="svq-text">${esc(item.file_name || '-')} · subido ${esc(fmtDateTime(item.uploaded_at))}</p>
                <button type="button" class="svq-link" data-svq-open="${esc(item.storage_path)}">Abrir documento (enlace de 2 minutos) →</button>
                ${item.reviewer_notes ? `<p class="svq-text">Nota anterior: ${esc(item.reviewer_notes)}</p>` : ''}
            </div>
            ${reviewForm(item, 'APROBAR DOCUMENTO', 'aprobar')}
            <div class="drawer-section svq-section">
                <p class="svq-section-title">Estado general del artista</p>
                <p class="svq-text">${esc(a.name || 'El artista')}: <strong>${esc(ARTIST_STATE_LABELS[a.verification_state] || a.verification_state || 'Sin solicitar')}</strong></p>
                <ul class="svq-doclist">${docs}</ul>
                <p class="svq-help">${req.ok ? 'Identidad y domicilio aprobados.' : 'Faltan aprobar: ' + esc(req.missing.join(' y ')) + '.'}</p>
                <p id="svq-state-feedback" class="svq-feedback" role="status" aria-live="polite" hidden></p>
                <div class="svq-actions">
                    <button type="button" class="action-btn svq-btn" data-svq-state="Yes" data-svq-ok="${req.ok ? '1' : '0'}">MARCAR ARTISTA VERIFICADO</button>
                    <button type="button" class="action-btn svq-btn" data-svq-state="Denied">DENEGAR VERIFICACIÓN</button>
                </div>
            </div>
        </div>`;
    }

    async function openDetail(id) {
        const item = state.items.find((i) => String(i.id) === String(id));
        const content = $('drawer-content');
        const toggle = $('drawer-toggle');
        if (!item || !content || !toggle) return;
        state.detail = { id: item.id, kind: state.kind, item, docs: [] };
        if (state.kind === 'documents') {
            try { state.detail.docs = await repo().listDocumentsForArtist(item.artist_user_id); } catch (_) { state.detail.docs = [item]; }
        }
        content.innerHTML = state.kind === 'destinations' ? destinationDetail(item)
            : state.kind === 'withdrawals' ? withdrawalDetail(item) : documentDetail(item, state.detail.docs);
        toggle.checked = true;
        const title = $('svq-detail-title');
        if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
    }

    function feedback(id, kind, text) {
        const el = $(id);
        if (!el) return;
        el.className = 'svq-feedback' + (kind ? ' is-' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.textContent = text || '';
        el.hidden = !text;
    }

    async function runReview(action) {
        const d = state.detail;
        if (!d || state.busy) return;
        const note = $('svq-note');
        const req = buildReview(d.kind, action, note ? note.value : '');
        if (req.error) {
            if (note) { note.setAttribute('aria-invalid', 'true'); note.focus(); }
            feedback('svq-feedback', 'error', req.error);
            return;
        }
        if (note) note.removeAttribute('aria-invalid');
        state.busy = true;
        root.document.querySelectorAll('[data-svq-action]').forEach((b) => { b.disabled = true; });
        feedback('svq-feedback', 'info', 'Guardando…');
        try {
            const row = d.kind === 'destinations'
                ? await repo().reviewDestination(d.id, req.decision, req.note)
                : await repo().reviewDocument(d.id, req.decision, req.note);
            // Repinta el detalle con el estado nuevo (badge y nota).
            if (row && typeof row === 'object') Object.assign(d.item, row);
            // ── integracion ── aviso al artista (email según sus preferencias).
            const notified = await notifyArtist(d.kind === 'destinations' ? 'destination' : 'document', d.id);
            const content = $('drawer-content');
            if (content && $('svq-detail')) {
                if (d.kind === 'documents') {
                    try { d.docs = await repo().listDocumentsForArtist(d.item.artist_user_id); } catch (_) { /* conserva la lista */ }
                    content.innerHTML = documentDetail(d.item, d.docs);
                } else {
                    content.innerHTML = destinationDetail(d.item);
                }
            }
            feedback('svq-feedback', 'success', (action === 'approve'
                ? (d.kind === 'destinations' ? 'Destino verificado: el artista ya puede pedir retiros a esta cuenta.' : 'Documento aprobado.')
                : 'Rechazado. El artista ve tu nota en su cuenta.') + notifyText(notified));
            await load();
        } catch (err) {
            console.warn('[support-verification] revisión:', err && err.message);
            feedback('svq-feedback', 'error', errorText(err));
        } finally {
            state.busy = false;
            root.document.querySelectorAll('[data-svq-action]').forEach((b) => { b.disabled = false; });
        }
    }

    async function runArtistState(btn) {
        const d = state.detail;
        if (!d || state.busy) return;
        const target = btn.dataset.svqState;
        if (target === 'Yes' && btn.dataset.svqOk !== '1' && btn.dataset.svqConfirm !== '1') {
            btn.dataset.svqConfirm = '1';
            feedback('svq-state-feedback', 'error', 'Faltan documentos obligatorios aprobados. Tocá de nuevo para verificar igual.');
            return;
        }
        state.busy = true;
        btn.disabled = true;
        try {
            await repo().setArtistVerification(d.item.artist_user_id, target);
            const a = state.artists[d.item.artist_user_id];
            if (a) a.verification_state = target;
            feedback('svq-state-feedback', 'success', target === 'Yes' ? 'Artista verificado: su perfil muestra la insignia.' : 'Verificación denegada.');
            renderRows();
        } catch (err) {
            feedback('svq-state-feedback', 'error', errorText(err));
        } finally {
            state.busy = false;
            btn.disabled = false;
        }
    }

    async function onDrawerClick(e) {
        if (!$('svq-detail')) return;
        const action = e.target.closest('[data-svq-action]');
        if (action) { e.preventDefault(); runReview(action.dataset.svqAction); return; }
        const settle = e.target.closest('[data-svq-settle]');
        if (settle) { e.preventDefault(); runSettle(settle.dataset.svqSettle); return; }
        const st = e.target.closest('[data-svq-state]');
        if (st) { e.preventDefault(); runArtistState(st); return; }
        const open = e.target.closest('[data-svq-open]');
        if (open) {
            e.preventDefault();
            try { root.open(await repo().documentUrl(open.dataset.svqOpen), '_blank', 'noopener'); }
            catch (err) { feedback('svq-feedback', 'error', err.message || MSG.generic); }
        }
    }

    // ---------------- arranque ----------------

    function boot() {
        const doc = root.document;
        if (!doc || root.__svqBooted) return;
        root.__svqBooted = true;
        injectStyles();
        previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = switchTab;
        doc.addEventListener('click', onTabClick, true);
        const drawer = $('drawer-content');
        if (drawer) {
            drawer.addEventListener('click', onDrawerClick);
            drawer.addEventListener('submit', (e) => { if (e.target.closest('[data-svq-form]')) e.preventDefault(); });
        }
        const schedule = () => root.setTimeout(() => { if (!state.loaded) refreshBadge(); }, 1500);
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedule); else schedule();
        root.SupportVerificationQueue = { refresh: load, open: openDetail, isActive: () => active };
    }

    return {
        boot,
        _internal: { MSG, DOC_LABELS, normalizeStatus, statusMeta, maskIdentifier, buildReview, requiredDocsStatus, errorText, esc,
            buildSettlement, formatAmount, notifyText, KINDS }
    };
}));
