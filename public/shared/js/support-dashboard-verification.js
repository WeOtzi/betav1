// ============================================
// WE ÖTZI - Support Dashboard · pestaña VERIFICACIONES (ronda 3 · grupo pagos)
// funciones-b P1 puntos 3 y 4 (Figma 801:568/569 destinos de retiro, 801:573
// documentos). Dos colas en una pestaña:
//   · Destinos de retiro en 'pending': VERIFICAR / RECHAZAR con nota. Sin
//     destino verificado, request_artist_wallet_withdrawal rechaza el retiro.
//   · Documentos de verificación del artista: APROBAR / RECHAZAR con nota (la
//     nota la ve el artista en Cuenta · Verificación).
//   · ── verif-artista ── Solicitudes de artistas (cola por ARTISTA, no por
//     documento): ficha, documentos, historial y la decisión final MARCAR
//     VERIFICADO / DENEGAR / REVOCAR con motivo. La RPC deja historial y el
//     servidor le avisa al artista por email (profile_verified /
//     profile_verification_denied); el aviso in-app sale de la misma fila.
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
    // ── verif-artista ── 'requests': solicitudes de verificación por artista.
    const KINDS = ['requests', 'destinations', 'documents', 'withdrawals'];
    const REQUEST_FILTER_LABELS = { pending: 'Por revisar', verified: 'Verificados', rejected: 'Denegados', all: 'Todos' };
    const IN_REVIEW_STATES = ['Requested', 'In Progress', 'In Analysis'];
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
        Denied: 'Denegado', rejected: 'Denegado', Canceled: 'Sin solicitar', No: 'Sin solicitar'
    };
    // Estado del artista → tono del badge (Por revisar / Verificado / Denegado / Sin solicitar).
    const ARTIST_STATE_TONES = {
        Yes: 'verified', Requested: 'pending', 'In Progress': 'pending', 'In Analysis': 'pending',
        Denied: 'rejected', rejected: 'rejected'
    };
    const HISTORY_LABELS = {
        approved: 'Verificado', rejected: 'Denegado', pending_review: 'Solicitud del artista', revoked: 'Verificación revocada'
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
        unavailable: 'No pudimos leer la cola. Revisa que tu usuario tenga acceso de soporte.',
        noteReject: 'Escribe el motivo del rechazo (mínimo ' + NOTE_MIN + ' caracteres). Lo ve el artista.',
        noteLong: 'La nota puede tener hasta ' + NOTE_MAX + ' caracteres.',
        generic: 'No pudimos completar la acción. Prueba de nuevo.',
        rpcMissing: 'Falta aplicar la migración 20261112170000 (RPC de soporte).',
        emptyWd: 'No hay retiros en este estado.',
        refRequired: 'Escribe la referencia de la transferencia (mínimo ' + REF_MIN + ' caracteres).',
        refLong: 'La referencia puede tener hasta ' + REF_MAX + ' caracteres.',
        noteFail: 'Escribe el motivo del fallo (mínimo ' + NOTE_MIN + ' caracteres). Lo ve el artista.',
        rpcMissingWd: 'Falta aplicar la migración 20261112220000 (liquidar retiros).',
        rpcMissingVerif: 'Falta aplicar la migración 20261115190000 (verificación de artistas).',
        emptyRequests: 'No hay solicitudes de verificación en este estado.',
        noteDeny: 'Escribe el motivo para denegar (mínimo ' + NOTE_MIN + ' caracteres). Lo ve el artista.',
        noteRevoke: 'Escribe el motivo para revocar la verificación (mínimo ' + NOTE_MIN + ' caracteres). Lo ve el artista.',
        missingDocs: 'Faltan documentos obligatorios aprobados. Toca de nuevo para verificar igual.'
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
    // ── cifrado ── El panel recibe solo los últimos 4 (account_identifier_last4).
    function maskDestination(dest) {
        return maskIdentifier((dest && (dest.account_identifier_last4 || dest.account_identifier)) || '');
    }
    // Número completo: botón que lo pide al servidor (auditado, con motivo).
    function revealFact(destId, purpose) {
        if (!destId) return fact('Cuenta (CBU / IBAN / alias)', '-');
        return `<div><dt>Cuenta (CBU / IBAN / alias)</dt><dd><span class="svq-mono" id="svq-account-value" aria-live="polite">${esc(maskDestination(state.revealSource && state.revealSource[destId]))}</span>
            <button type="button" class="svq-link" data-svq-reveal="${esc(destId)}" data-svq-purpose="${esc(purpose)}">Ver número completo</button></dd></div>`;
    }
    function rememberDest(dest) {
        state.revealSource = state.revealSource || {};
        if (dest && dest.id) state.revealSource[dest.id] = dest;
        return true;
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

    // ── verif-artista ── decisión final sobre el artista: { state, note } o { error, field }.
    //   'Yes'    → verificar (nota opcional).
    //   'Denied' → denegar, motivo obligatorio (lo ve el artista).
    //   'No'     → revocar una verificación ('Yes') o cerrar la solicitud; motivo obligatorio si estaba verificado.
    function buildStateDecision(target, note, previousState) {
        const clean = String(note == null ? '' : note).trim();
        if (['Yes', 'Denied', 'No'].indexOf(target) === -1) return { error: MSG.generic };
        if (clean.length > NOTE_MAX) return { error: MSG.noteLong, field: 'note' };
        if (target === 'Denied' && clean.length < NOTE_MIN) return { error: MSG.noteDeny, field: 'note' };
        if (target === 'No' && previousState === 'Yes' && clean.length < NOTE_MIN) return { error: MSG.noteRevoke, field: 'note' };
        return { state: target, note: clean || null };
    }

    // Botones de decisión según el estado actual del artista.
    function stateActions(currentState) {
        return currentState === 'Yes'
            ? [{ state: 'No', label: 'REVOCAR VERIFICACIÓN', tone: 'danger' }]
            : [{ state: 'Yes', label: 'MARCAR ARTISTA VERIFICADO', tone: 'accent' }, { state: 'Denied', label: 'DENEGAR VERIFICACIÓN', tone: 'danger' }];
    }

    function artistStateMeta(raw) {
        const s = String(raw || 'No');
        return { label: ARTIST_STATE_LABELS[s] || s, tone: ARTIST_STATE_TONES[s] || 'muted' };
    }

    // Filas de support_list_verification_requests → ítems de la cola (id = user_id).
    function requestItems(rows) {
        return (Array.isArray(rows) ? rows : []).filter((r) => r && r.user_id).map((r) => Object.assign({}, r, {
            id: String(r.user_id),
            artist_user_id: String(r.user_id),
            documents: (Array.isArray(r.documents) ? r.documents : []).map((d) => Object.assign({ artist_user_id: String(r.user_id) }, d))
        }));
    }

    function docStatusOf(docs, type) {
        const doc = (docs || []).find((d) => d && d.doc_type === type);
        return doc ? normalizeStatus(doc.status) : 'missing';
    }

    // Texto que escribe la base: las funciones ya aplicadas siguen en voseo y neutral-es.js
    // lo pasa a tuteo antes de mostrarlo. Sin el módulo cargado el texto queda como vino.
    function neutral(value) {
        const N = root && root.WoNeutralEs;
        return N && typeof N.neutralize === 'function' ? N.neutralize(value) : value;
    }

    function errorText(err) {
        const cause = (err && err.cause) || {};
        const msg = String(cause.message || (err && err.message) || '').replace(/^\[[^\]]+\]\s*/, '');
        if (/support_list_verification_requests|support_set_artist_verification_state|p_note/i.test(msg) && (/could not find the function|PGRST202/i.test(msg) || cause.code === 'PGRST202')) return MSG.rpcMissingVerif;
        if (/support_settle_artist_withdrawal/i.test(msg) && (/could not find the function|PGRST202/i.test(msg) || cause.code === 'PGRST202')) return MSG.rpcMissingWd;
        if (/could not find the function|PGRST202/i.test(msg) || cause.code === 'PGRST202') return MSG.rpcMissing;
        if (/Ese retiro|referencia/i.test(msg)) return neutral(msg);
        if (/Solo soporte|42501|permission denied/i.test(msg) || cause.code === '42501') return 'Tu usuario no tiene acceso de soporte para esta acción.';
        // Se reconocen el voseo de la base ya aplicada y el tuteo.
        if (msg && /[áéíóúñ]|Escribí|Escribe|No encontramos|Decisión|Estado/i.test(msg)) return neutral(msg);
        return MSG.generic;
    }

    // ---------------- estado ----------------

    const state = {
        kind: 'requests', status: 'pending', search: '',
        items: [], artists: {}, destinations: {}, loaded: false, loading: false, error: null, seq: 0,
        detail: null, busy: false
    };
    let active = false;
    let previousSwitch = null;
    const hiddenSiblings = new Map();
    const $ = (id) => root.document.getElementById(id);
    function repo() { return root.WeotziData && root.WeotziData.SupportVerification; }
    // Rutas internas respetando el base path (/beta en producción).
    function appPath(path) {
        const loc = String((root.location && root.location.pathname) || '');
        const base = root.WEOTZI_BASE_PATH ? String(root.WEOTZI_BASE_PATH).replace(/\/$/, '') : (/^\/beta(?:\/|$)/.test(loc) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }

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
.svq-badge--muted{background:transparent;color:GrayText;border-color:currentColor}
.svq-doclist .svq-docrow{flex-wrap:wrap;align-items:center}
.svq-docname{flex:1 1 180px;min-width:0;overflow-wrap:anywhere}
.svq-docname small{display:block;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;color:GrayText}
.svq-docside{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.svq-history{list-style:none;margin:0;padding:0}
.svq-history li{padding:8px 0;border-bottom:1px solid GrayText;font-size:14px;line-height:1.45;overflow-wrap:anywhere}
.svq-history li:last-child{border-bottom:0}
.svq-history time{display:block;font-family:var(--font-mono,'Space Mono',monospace);font-size:11px;color:GrayText}
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
        const labels = state.kind === 'withdrawals' ? WD_FILTER_LABELS : state.kind === 'requests' ? REQUEST_FILTER_LABELS : QUEUE_FILTER_LABELS;
        Array.prototype.forEach.call(select.options, (opt) => { if (labels[opt.value]) opt.textContent = labels[opt.value]; });
    }

    function columns() {
        if (state.kind === 'requests') {
            return { tpl: 'minmax(0,2fr) 140px 110px 110px 110px 100px', heads: ['Artista', 'Estado', 'Identidad', 'Domicilio', 'Bioseguridad', 'Pedido'] };
        }
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
                    <option value="requests">Solicitudes de artistas</option>
                    <option value="documents">Documentos</option>
                    <option value="destinations">Destinos de retiro</option>
                    <option value="withdrawals">Retiros</option>
                </select>
                <label class="svq-sr" for="svq-status">Estado</label>
                <select id="svq-status" class="svq-select">
                    <option value="pending">Por revisar</option>
                    <option value="verified">Verificados</option>
                    <option value="rejected">Denegados</option>
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
            state.kind = KINDS.indexOf(e.target.value) >= 0 ? e.target.value : 'requests';
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
            const items = state.kind === 'requests' ? requestItems(await R.listRequests(state.status))
                : state.kind === 'destinations' ? await R.listDestinations(state.status)
                    : state.kind === 'withdrawals' ? await R.listWithdrawals(state.status)
                        : await R.listDocuments(state.status);
            // La cola por artista ya trae la ficha (RPC de soporte): no hace falta otra lectura.
            const artists = state.kind === 'requests' ? items
                : await R.artistsByUserIds(items.map((i) => i.artist_user_id)).catch(() => []);
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
        try { const c = await R.countPending(); n = c.destinations + c.documents + (c.withdrawals || 0) + (c.requests || 0); } catch (_) { n = 0; }
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

    function artistBadge(raw) {
        const m = artistStateMeta(raw);
        return `<span class="status-badge svq-badge svq-badge--${m.tone}">${esc(m.label)}</span>`;
    }

    // Estado de un documento obligatorio/opcional en la cola por artista.
    function docCell(docs, type) {
        const st = docStatusOf(docs, type);
        if (st === 'missing') return '<span class="svq-badge svq-badge--muted">Sin cargar</span>';
        return badge(st);
    }

    function rowHtml(item) {
        const a = artistOf(item);
        const name = a.name || (a.username ? '@' + a.username : 'Artista sin perfil');
        const sub = a.username ? '@' + a.username : (a.email || '');
        if (state.kind === 'requests') {
            return `<div class="quote-row data-row svq-row" role="button" tabindex="0" data-svq-id="${esc(item.id)}" aria-label="${esc('Revisar la verificación de ' + name)}">
                <div class="svq-cell svq-artist"><span class="svq-name">${esc(name)}</span><span class="svq-muted">${esc(sub)}</span></div>
                <div class="svq-cell" data-label="Estado">${artistBadge(item.verification_state)}</div>
                <div class="svq-cell" data-label="Identidad">${docCell(item.documents, 'identidad')}</div>
                <div class="svq-cell" data-label="Domicilio">${docCell(item.documents, 'domicilio')}</div>
                <div class="svq-cell" data-label="Bioseguridad">${docCell(item.documents, 'bioseguridad')}</div>
                <div class="svq-cell svq-mono" data-label="Pedido">${esc(fmtDate(item.requested_at || item.last_decision_at))}</div>
            </div>`;
        }
        if (state.kind === 'withdrawals') {
            const dest = state.destinations[item.destination_id] || {};
            const amount = formatAmount(item.amount, item.currency);
            return `<div class="quote-row data-row svq-row" role="button" tabindex="0" data-svq-id="${esc(item.id)}" aria-label="${esc('Revisar retiro de ' + amount + ' de ' + name)}">
                <div class="svq-cell svq-artist"><span class="svq-name">${esc(name)}</span><span class="svq-muted">${esc(sub)}</span></div>
                <div class="svq-cell svq-mono" data-label="Monto">${esc(amount)}</div>
                <div class="svq-cell" data-label="Destino"><span class="svq-name">${esc(dest.label || item.title || 'Destino')}</span><span class="svq-muted">${esc(METHOD_LABELS[dest.method] || dest.method || '')}</span></div>
                <div class="svq-cell svq-mono" data-label="Cuenta">${esc(maskDestination(dest))}</div>
                <div class="svq-cell" data-label="Estado">${badge(item.status, 'withdrawals')}</div>
                <div class="svq-cell svq-mono" data-label="Pedido">${esc(fmtDate(item.occurred_at || item.created_at))}</div>
            </div>`;
        }
        if (state.kind === 'destinations') {
            return `<div class="quote-row data-row svq-row" role="button" tabindex="0" data-svq-id="${esc(item.id)}" aria-label="${esc('Revisar destino ' + item.label + ' de ' + name)}">
                <div class="svq-cell svq-artist"><span class="svq-name">${esc(name)}</span><span class="svq-muted">${esc(sub)}</span></div>
                <div class="svq-cell" data-label="Destino"><span class="svq-name">${esc(item.label)}</span><span class="svq-muted">${esc(METHOD_LABELS[item.method] || item.method)}</span></div>
                <div class="svq-cell svq-mono" data-label="Moneda">${esc(item.currency)}</div>
                <div class="svq-cell svq-mono" data-label="Cuenta">${esc(maskDestination(item))}</div>
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
        if (intro) intro.textContent = state.kind === 'requests'
            ? 'Artistas que pidieron la verificación. Revisa sus documentos y decide: el artista recibe el resultado por email y en su panel.'
            : state.kind === 'destinations'
            ? 'Verifica que el titular coincida con el artista (y con su documento de identidad) antes de habilitar retiros a ese destino.'
            : state.kind === 'withdrawals'
                ? 'Cuando la transferencia salga, marca el retiro como pagado con su referencia. Si falla, el monto vuelve al saldo del artista y le llega tu nota.'
                : 'Revisa cada documento. Si lo rechazas, la nota le llega al artista en Cuenta · Verificación.';
        body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
        if (state.loading && !state.loaded) { body.innerHTML = `<div class="svq-empty">${MSG.loading}</div>`; return; }
        if (state.error) { body.innerHTML = `<div class="svq-empty is-error" role="alert">${esc(MSG.unavailable)}</div>`; return; }
        const q = String(state.search || '').trim().toLowerCase().replace(/^@/, '');
        const rows = state.items.filter((i) => matches(i, q));
        if (!rows.length) {
            body.innerHTML = `<div class="svq-empty">${esc(q ? MSG.emptySearch : state.kind === 'requests' ? MSG.emptyRequests : state.kind === 'destinations' ? MSG.emptyDest : state.kind === 'withdrawals' ? MSG.emptyWd : MSG.emptyDocs)}</div>`;
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
                    ${rememberDest(item) && revealFact(item.id, 'verification')}
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
                    ${rememberDest(dest) && revealFact(dest.id, 'withdrawal_settlement')}
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
                <div class="svq-actions">
                    <button type="button" class="action-btn svq-btn" data-svq-artist="${esc(item.artist_user_id)}">VER SOLICITUD DEL ARTISTA →</button>
                </div>
            </div>
        </div>`;
    }

    // ── verif-artista ── ficha de la solicitud: documentos, historial y decisión final.
    function requestDetail(item, history) {
        const a = Object.assign({}, item, artistOf(item));
        const current = a.verification_state || 'No';
        const docs = item.documents || [];
        const req = requiredDocsStatus(docs);
        const name = a.name || (a.username ? '@' + a.username : 'Artista');
        const docRows = ['identidad', 'domicilio', 'bioseguridad'].map((type) => {
            const doc = docs.find((d) => d && d.doc_type === type);
            const required = REQUIRED_DOCS.indexOf(type) >= 0;
            if (!doc) {
                return `<li class="svq-docrow"><span class="svq-docname">${esc(DOC_LABELS[type])}<small>${required ? 'Obligatorio' : 'Opcional'} · sin cargar</small></span>
                    <span class="svq-docside"><span class="svq-badge svq-badge--muted">Sin cargar</span></span></li>`;
            }
            const pending = normalizeStatus(doc.status) === 'pending';
            return `<li class="svq-docrow"><span class="svq-docname">${esc(DOC_LABELS[type])}<small>${required ? 'Obligatorio' : 'Opcional'} · subido ${esc(fmtDate(doc.uploaded_at))}${doc.reviewer_notes ? ' · ' + esc(doc.reviewer_notes) : ''}</small></span>
                <span class="svq-docside">${badge(doc.status)}
                    <button type="button" class="svq-link" data-svq-open="${esc(doc.storage_path)}" aria-label="${esc('Abrir ' + DOC_LABELS[type] + ' (enlace de 2 minutos)')}">Abrir</button>
                    <button type="button" class="svq-link" data-svq-doc="${esc(doc.id)}" aria-label="${esc((pending ? 'Revisar ' : 'Cambiar la revisión de ') + DOC_LABELS[type])}">${pending ? 'Revisar' : 'Cambiar'}</button></span></li>`;
        }).join('');
        const hist = (history || []).map((h) => `<li><time datetime="${esc(h.created_at)}">${esc(fmtDateTime(h.created_at))}</time>
            <strong>${esc(HISTORY_LABELS[h.action] || h.action)}</strong>${h.notes ? ' · ' + esc(h.notes) : ''}</li>`).join('')
            || '<li>Sin movimientos registrados.</li>';
        const actions = stateActions(current).map((act) => `<button type="button" class="action-btn svq-btn svq-btn--${act.tone}" data-svq-state="${esc(act.state)}"${act.state === 'Yes' ? ` data-svq-ok="${req.ok ? '1' : '0'}"` : ''}>${esc(act.label)}</button>`).join('');
        const helpText = current === 'Yes'
            ? 'Si revocas la verificación, el perfil deja de mostrar la insignia. El motivo es obligatorio y lo ve el artista.'
            : 'Obligatorio para denegar (lo ve el artista por email y en su cuenta). Opcional al verificar.';
        return `<div id="svq-detail" class="svq-detail" data-svq-id="${esc(item.id)}" data-svq-kind="requests">
            <p class="svq-eyebrow">Solicitud de verificación</p>
            <h2 id="svq-detail-title" class="svq-title" tabindex="-1">${esc(name)}</h2>
            <p class="svq-sub">${a.username ? `<span>@${esc(String(a.username).replace(/^@+/, ''))}</span><span aria-hidden="true">·</span>` : ''}${artistBadge(current)}</p>
            <div class="drawer-section svq-section">
                <p class="svq-section-title">Artista</p>
                <dl class="svq-facts">
                    ${fact('Email', a.email || '-')}
                    ${fact('Ubicación', [a.city, a.country].filter(Boolean).join(', ') || '-')}
                    ${fact('Instagram validado', a.instagram_verified_at ? (a.instagram_verified_handle ? '@' + String(a.instagram_verified_handle).replace(/^@+/, '') : 'Sí') : 'No')}
                    ${fact('Pedido', fmtDateTime(a.requested_at))}
                </dl>
                ${a.username ? `<p class="svq-text"><a class="svq-link" href="${esc(appPath('/artist/profile?artist=' + encodeURIComponent(String(a.username).replace(/^@+/, ''))))}" target="_blank" rel="noopener">Ver perfil público →</a></p>` : ''}
            </div>
            <div class="drawer-section svq-section">
                <p class="svq-section-title">Documentos</p>
                <ul class="svq-doclist">${docRows}</ul>
                <p class="svq-help">${req.ok ? 'Identidad y domicilio aprobados.' : 'Faltan aprobar: ' + esc(req.missing.join(' y ')) + '.'}</p>
            </div>
            <form class="drawer-section svq-section" id="svq-state-form" data-svq-form="${esc(item.id)}" novalidate>
                <p class="svq-section-title">Decisión</p>
                <div class="svq-field">
                    <label for="svq-state-note">Motivo para el artista</label>
                    <textarea id="svq-state-note" class="svq-input" rows="3" maxlength="${NOTE_MAX}" aria-describedby="svq-state-note-help"></textarea>
                    <p class="svq-help" id="svq-state-note-help">${esc(helpText)}</p>
                </div>
                <p id="svq-state-feedback" class="svq-feedback" role="status" aria-live="polite" hidden></p>
                <div class="svq-actions">${actions}</div>
            </form>
            <div class="drawer-section svq-section">
                <p class="svq-section-title">Historial</p>
                <ul class="svq-history">${hist}</ul>
            </div>
        </div>`;
    }

    async function renderRequest(item) {
        const content = $('drawer-content');
        const toggle = $('drawer-toggle');
        if (!item || !content || !toggle) return;
        let history = [];
        try { history = await repo().listHistory(item.artist_id); } catch (err) { console.warn('[support-verification] historial:', err && err.message); }
        state.detail = { id: item.id, kind: 'requests', item, docs: item.documents || [], history };
        content.innerHTML = requestDetail(item, history);
        toggle.checked = true;
        const title = $('svq-detail-title');
        if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
    }

    // Abre la solicitud de un artista desde cualquier lado (cola de documentos,
    // ficha del artista en support-dashboard.js). Relee la fila de la RPC.
    async function openArtist(userId) {
        const R = repo();
        if (!R || !userId) return;
        let row = state.kind === 'requests' ? state.items.find((i) => String(i.user_id) === String(userId)) : null;
        try {
            const fresh = requestItems([await R.requestForArtist(userId)])[0];
            if (fresh) row = fresh;
        } catch (err) {
            console.warn('[support-verification] solicitud del artista:', err && err.message);
            if (!row) {
                const content = $('drawer-content');
                if (content && $('svq-detail')) feedback('svq-feedback', 'error', errorText(err));
                return;
            }
        }
        if (!row) return;
        state.artists[row.user_id] = Object.assign({}, state.artists[row.user_id], row);
        await renderRequest(row);
    }

    // Revisar un documento desde la ficha de la solicitud.
    async function openDocument(docId) {
        const d = state.detail;
        const doc = d && (d.docs || []).find((x) => String(x.id) === String(docId));
        const content = $('drawer-content');
        if (!doc || !content) return;
        let docs = d.docs;
        try { docs = await repo().listDocumentsForArtist(doc.artist_user_id); } catch (_) { /* usa la lista de la cola */ }
        const fresh = docs.find((x) => String(x.id) === String(docId)) || doc;
        state.detail = { id: fresh.id, kind: 'documents', item: fresh, docs };
        content.innerHTML = documentDetail(fresh, docs);
        const title = $('svq-detail-title');
        if (title) { try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); } }
    }

    async function openDetail(id) {
        const item = state.items.find((i) => String(i.id) === String(id));
        const content = $('drawer-content');
        const toggle = $('drawer-toggle');
        if (!item || !content || !toggle) return;
        if (state.kind === 'requests') { await renderRequest(item); return; }
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

    // ── verif-artista ── aviso al artista por email después de la decisión final.
    async function notifyVerification(historyId) {
        if (!historyId) return null;
        try {
            const token = await supportToken();
            if (!token || typeof root.fetch !== 'function') return null;
            const res = await root.fetch(appPath('/api/support/artist-verification/notify'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ history_id: historyId }),
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const json = await res.json().catch(() => ({}));
            return res.ok && json && json.success ? json : null;
        } catch (err) {
            console.warn('[support-verification] aviso de verificación:', err && err.message);
            return null;
        }
    }

    function stateSuccessText(target, previous) {
        if (target === 'Yes') return 'Artista verificado: su perfil público ya muestra la insignia.';
        if (target === 'Denied') return 'Verificación denegada. El artista ve el motivo en su cuenta.';
        return previous === 'Yes' ? 'Verificación revocada: el perfil deja de mostrar la insignia.' : 'Solicitud cerrada.';
    }

    async function runArtistState(btn) {
        const d = state.detail;
        if (!d || state.busy || d.kind !== 'requests') return;
        const target = btn.dataset.svqState;
        const userId = d.item.artist_user_id;
        const previous = (state.artists[userId] && state.artists[userId].verification_state) || d.item.verification_state || 'No';
        const noteEl = $('svq-state-note');
        const decision = buildStateDecision(target, noteEl ? noteEl.value : '', previous);
        if (noteEl) noteEl.removeAttribute('aria-invalid');
        if (decision.error) {
            if (noteEl && decision.field === 'note') { noteEl.setAttribute('aria-invalid', 'true'); noteEl.focus(); }
            feedback('svq-state-feedback', 'error', decision.error);
            return;
        }
        if (target === 'Yes' && btn.dataset.svqOk !== '1' && btn.dataset.svqConfirm !== '1') {
            btn.dataset.svqConfirm = '1';
            feedback('svq-state-feedback', 'error', MSG.missingDocs);
            return;
        }
        state.busy = true;
        root.document.querySelectorAll('[data-svq-state]').forEach((b) => { b.disabled = true; });
        feedback('svq-state-feedback', 'info', 'Guardando…');
        try {
            const result = await repo().setArtistVerification(userId, decision.state, decision.note);
            const changed = !result || result.changed !== false;
            const notified = changed ? await notifyVerification(result && result.history_id) : null;
            const fresh = Object.assign({}, d.item, { verification_state: decision.state });
            state.artists[userId] = Object.assign({}, state.artists[userId], { verification_state: decision.state });
            await renderRequest(fresh);
            feedback('svq-state-feedback', 'success', changed
                ? stateSuccessText(decision.state, previous) + notifyText(notified)
                : 'El artista ya estaba en ese estado: no hubo cambios.');
            load();
        } catch (err) {
            console.warn('[support-verification] decisión del artista:', err && err.message);
            feedback('svq-state-feedback', 'error', errorText(err));
        } finally {
            state.busy = false;
            root.document.querySelectorAll('[data-svq-state]').forEach((b) => { b.disabled = false; });
        }
    }

    // Feedback del detalle abierto (los formularios usan ids distintos).
    function detailFeedback(kind, text) {
        feedback($('svq-feedback') ? 'svq-feedback' : 'svq-state-feedback', kind, text);
    }

    // ── cifrado ── ver el número completo (se oculta a los 60 s).
    let revealTimer = null;
    async function runReveal(btn) {
        const out = $('svq-account-value');
        const id = btn.dataset.svqReveal;
        if (btn.dataset.revealed) {
            clearTimeout(revealTimer);
            if (out) out.textContent = maskDestination(state.revealSource[id]);
            btn.textContent = 'Ver número completo';
            btn.dataset.revealed = '';
            return;
        }
        btn.disabled = true;
        try {
            const res = await repo().revealDestination(id, btn.dataset.svqPurpose);
            if (!res.available) { feedback('svq-feedback', 'error', 'No disponible en la vista previa: el número completo solo lo entrega el servidor.'); return; }
            if (out) out.textContent = res.value;
            btn.textContent = 'Ocultar';
            btn.dataset.revealed = '1';
            clearTimeout(revealTimer);
            revealTimer = setTimeout(() => { if (btn.dataset.revealed) runReveal(btn); }, 60000);
        } catch (err) {
            feedback('svq-feedback', 'error', (err && err.message) || MSG.generic);
        } finally { btn.disabled = false; }
    }

    async function onDrawerClick(e) {
        if (!$('svq-detail')) return;
        const action = e.target.closest('[data-svq-action]');
        if (action) { e.preventDefault(); runReview(action.dataset.svqAction); return; }
        const settle = e.target.closest('[data-svq-settle]');
        if (settle) { e.preventDefault(); runSettle(settle.dataset.svqSettle); return; }
        const st = e.target.closest('[data-svq-state]');
        if (st) { e.preventDefault(); runArtistState(st); return; }
        const artist = e.target.closest('[data-svq-artist]');
        if (artist) { e.preventDefault(); openArtist(artist.dataset.svqArtist); return; }
        const docBtn = e.target.closest('[data-svq-doc]');
        if (docBtn) { e.preventDefault(); openDocument(docBtn.dataset.svqDoc); return; }
        const reveal = e.target.closest('[data-svq-reveal]');
        if (reveal) { e.preventDefault(); runReveal(reveal); return; }
        const open = e.target.closest('[data-svq-open]');
        if (open) {
            e.preventDefault();
            try { root.open(await repo().documentUrl(open.dataset.svqOpen), '_blank', 'noopener'); }
            catch (err) { detailFeedback('error', err.message || MSG.generic); }
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
        // openArtist: la ficha del artista (support-dashboard.js) abre su solicitud aquí.
        root.SupportVerificationQueue = { refresh: load, open: openDetail, openArtist, isActive: () => active };
    }

    return {
        boot,
        _internal: { MSG, DOC_LABELS, normalizeStatus, statusMeta, maskIdentifier, maskDestination, buildReview, requiredDocsStatus, errorText, esc,
            buildSettlement, formatAmount, notifyText, KINDS,
            buildStateDecision, stateActions, artistStateMeta, requestItems, docStatusOf, ARTIST_STATE_LABELS, HISTORY_LABELS, IN_REVIEW_STATES }
    };
}));
