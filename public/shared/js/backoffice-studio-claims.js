// ============================================
// We Ötzi — Backoffice: reclamos de estudios
// window.WeOtziBackofficeStudioClaims · también exportable a Node (tests).
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Backoffice".
//   - Lista los reclamos `pending` (GET /api/admin/studio-claims) con la ficha
//     del estudio y la cuenta que reclama (email de auth.users, resuelto en el
//     servidor; nunca studios.email).
//   - Aprobar / Rechazar con nota → POST /api/admin/studio-claims/:id/decide
//     {decision: 'approve'|'reject', note}. El servidor llama a
//     decide_studio_claim con el JWT del caller: la RPC exige soporte activo
//     (is_support_user()) y, al aprobar, rechaza los otros reclamos pendientes
//     de esa ficha. Por eso, después de decidir, se recarga la lista.
//   - Auth: el mismo Bearer de la sesión de Supabase que usa admin.js
//     (_getApifyAuthHeaders / _fetchAdminJson), resuelto acá para leer también
//     el status HTTP y `migration_pending`.
//   - Sin la migración M1 aplicada el servidor responde {claims: [],
//     migration_pending: true}: la lista queda vacía con el aviso estándar.
//
// Montaje: busca #bo-studio-claims-root dentro de su .content-section y carga
// cada vez que la sección se activa (showSection de admin.js solo alterna la
// clase `active`; un MutationObserver lo detecta sin tocar admin.js). Nada se
// resuelve en el nivel superior salvo window/globalThis/module.
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) {
        window.WeOtziBackofficeStudioClaims = api;
        api.autoInit();
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const ENDPOINT = '/api/admin/studio-claims';
    const ROOT_ID = 'bo-studio-claims-root';
    const STYLE_ID = 'bo-studio-claims-styles';
    const PENDING_KEY = 'studio_claims';
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const DECISIONS = ['approve', 'reject'];
    const NOTE_MAX = 1000;
    const REASON_MIN = 3;
    const EVIDENCE_PREVIEW = 220;
    const PREFETCH_DELAY_MS = 1500;
    const PREFETCH_RETRY_MS = 4000;
    const PREFETCH_RETRIES = 3;

    const MISSING_SCHEMA_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';
    const NETWORK_MESSAGE = 'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.';
    const NO_SESSION_MESSAGE = 'No hay sesión de superadmin activa. Iniciá sesión de nuevo en /backoffice/login.';
    const NOT_DEPLOYED_MESSAGE = 'El servidor todavía no tiene esta función: actualizá el deploy.';
    const GENERIC_MESSAGE = 'No pudimos completar la acción. Intentá de nuevo.';
    const SUPPORT_HINT = 'Para decidir reclamos tu cuenta tiene que estar activa en Super Admin → Usuarios Soporte.';

    const state = { claims: [], loading: false, loaded: false, error: null, migrationPending: false, seq: 0 };
    let dialogSeq = 0;

    // -------------------------------------------------------------
    // Entorno (resuelto al usarse)
    // -------------------------------------------------------------
    function getDoc() {
        if (typeof document !== 'undefined' && document) return document;
        return (root && root.document) || null;
    }
    function kit() { return (root && root.WeOtziStudioKit) || null; }
    function later(fn, ms) {
        const st = typeof setTimeout === 'function' ? setTimeout : (root && root.setTimeout);
        return typeof st === 'function' ? st(fn, ms) : null;
    }
    function appUrl(path) {
        const k = kit();
        return k && typeof k.appUrl === 'function' ? k.appUrl(path) : path;
    }

    // -------------------------------------------------------------
    // Formato (el kit si está; si no, equivalentes mínimos)
    // -------------------------------------------------------------
    function esc(v) {
        const k = kit();
        if (k && typeof k.escapeHtml === 'function') return k.escapeHtml(v);
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function safeUrl(u) {
        const k = kit();
        if (k && typeof k.safeUrl === 'function') return k.safeUrl(u);
        if (u == null) return null;
        const s = String(u).trim();
        return /^https?:\/\/[^\s/?#<>"'`]+[^\s<>"'`]*$/i.test(s) ? s : null;
    }
    function fmtDate(d) {
        const k = kit();
        if (k && typeof k.fmtDate === 'function') return k.fmtDate(d);
        const date = d ? new Date(d) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('es-AR') : '—';
    }
    function fmtDateTime(d) {
        const k = kit();
        if (k && typeof k.fmtDateTime === 'function') return k.fmtDateTime(d);
        const date = d ? new Date(d) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('es-AR') : '—';
    }
    function fmtRelative(d) {
        const k = kit();
        return k && typeof k.fmtRelative === 'function' ? k.fmtRelative(d) : fmtDate(d);
    }
    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return ((parts[0][0] || '') + (parts.length > 1 ? (parts[parts.length - 1][0] || '') : '')).toUpperCase();
    }
    function textOrNull(v) {
        if (v == null) return null;
        const s = String(v).trim();
        return s || null;
    }

    // Texto libre con links http(s) clickeables (todo lo demás, escapado).
    function linkify(text) {
        const s = String(text == null ? '' : text);
        const re = /https?:\/\/[^\s<>"'`]+/gi;
        let out = '';
        let last = 0;
        let m;
        while ((m = re.exec(s)) !== null) {
            const raw = m[0].replace(/[),.;:!?\]]+$/, '');
            const start = m.index;
            const end = start + raw.length;
            out += esc(s.slice(last, start));
            const href = safeUrl(raw);
            out += href
                ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(raw) + '</a>'
                : esc(raw);
            last = end;
            re.lastIndex = end;
        }
        return out + esc(s.slice(last));
    }

    // -------------------------------------------------------------
    // HTTP (Bearer de la sesión, como _fetchAdminJson de admin.js)
    // -------------------------------------------------------------
    function getClient() {
        const cm = root && root.ConfigManager;
        let client = null;
        if (cm && typeof cm.getSupabaseClient === 'function') {
            try { client = cm.getSupabaseClient(); } catch (_) { client = null; }
        }
        return client || (root && (root.supabaseClient || root.__backofficeGuardClient || root._supabase)) || null;
    }
    async function authHeaders(client) {
        if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
        try {
            const res = await client.auth.getSession();
            const token = res && res.data && res.data.session && res.data.session.access_token;
            return token ? { Authorization: 'Bearer ' + token } : null;
        } catch (_) {
            return null;
        }
    }
    // Nunca lanza: {ok, status, data, error?}. error: 'no_session' | 'network'.
    async function fetchAdminJson(url, options, deps) {
        const d = deps || {};
        const opts = options || {};
        const headers = await authHeaders(Object.prototype.hasOwnProperty.call(d, 'client') ? d.client : getClient());
        if (!headers) return { ok: false, status: 0, data: null, error: 'no_session' };
        const fetchFn = d.fetch || (root && root.fetch) || (typeof fetch === 'function' ? fetch : null);
        if (typeof fetchFn !== 'function') return { ok: false, status: 0, data: null, error: 'network' };
        let res;
        try {
            res = await fetchFn.call(root, appUrl(url), Object.assign({}, opts, {
                headers: Object.assign({}, opts.headers || {}, headers)
            }));
        } catch (_) {
            return { ok: false, status: 0, data: null, error: 'network' };
        }
        let data = null;
        try {
            const text = typeof res.text === 'function' ? await res.text() : '';
            data = text ? JSON.parse(text) : null;
        } catch (_) {
            data = null;
        }
        const status = Number(res && res.status) || 0;
        const ok = !!(res && res.ok) && !(data && data.success === false);
        return { ok, status, data };
    }

    // Mensaje en español para una respuesta fallida de fetchAdminJson.
    function describeFailure(res, opts) {
        if (!res) return GENERIC_MESSAGE;
        if (res.error === 'no_session') return NO_SESSION_MESSAGE;
        if (res.error === 'network') return NETWORK_MESSAGE;
        const data = res.data && typeof res.data === 'object' ? res.data : {};
        if (data.migration_pending) return MISSING_SCHEMA_MESSAGE;
        const msg = typeof data.error === 'string' ? data.error.trim() : '';
        if (res.status === 401) return NO_SESSION_MESSAGE;
        if (res.status === 403) {
            const base = msg || 'No tenés permiso para esta acción.';
            return opts && opts.supportHint ? base + ' ' + SUPPORT_HINT : base;
        }
        if (res.status === 404 && !msg) return NOT_DEPLOYED_MESSAGE;
        return msg || GENERIC_MESSAGE;
    }

    // -------------------------------------------------------------
    // Datos
    // -------------------------------------------------------------
    function normalizeClaims(payload) {
        const list = payload && Array.isArray(payload.claims) ? payload.claims : [];
        return list.filter(c => c && typeof c === 'object' && c.id && (!c.status || c.status === 'pending'));
    }

    function claimView(claim) {
        const c = claim || {};
        const studio = (c.studios && typeof c.studios === 'object' && !Array.isArray(c.studios) ? c.studios : null)
            || (c.studio && typeof c.studio === 'object' ? c.studio : null) || {};
        const user = c.user && typeof c.user === 'object' ? c.user : {};
        const studioName = textOrNull(studio.name) || 'Estudio sin nombre';
        const location = [textOrNull(studio.city), textOrNull(studio.country)].filter(Boolean).join(', ');
        const ref = textOrNull(studio.slug) || textOrNull(studio.id || c.studio_id);
        return {
            id: String(c.id || ''),
            studioId: textOrNull(c.studio_id || studio.id),
            studioName,
            studioSlug: textOrNull(studio.slug),
            location,
            logo: safeUrl(studio.logo_image),
            profileHref: ref ? '/studio/profile?studio=' + encodeURIComponent(ref) : null,
            studioOwned: !!studio.user_id,
            studioInactive: studio.is_active === false,
            claimantName: textOrNull(c.contact_name) || textOrNull(user.full_name),
            claimantEmail: textOrNull(user.email),
            emailConfirmed: !!user.email_confirmed_at,
            userKnown: !!user.id,
            phone: textOrNull(c.contact_phone),
            evidence: textOrNull(c.evidence) || '',
            createdAt: c.created_at || null
        };
    }

    function buildDecideRequest(claimId, decision, note) {
        const id = String(claimId || '').trim();
        if (!UUID_RE.test(id)) throw new Error('ID de reclamo inválido.');
        if (!DECISIONS.includes(decision)) throw new Error('Decisión inválida: usá approve o reject.');
        const clean = note == null ? '' : String(note).trim().slice(0, NOTE_MAX);
        if (decision === 'reject' && clean.length < REASON_MIN) throw new Error('Escribí el motivo del rechazo.');
        return {
            url: ENDPOINT + '/' + encodeURIComponent(id) + '/decide',
            options: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision, note: clean || null })
            }
        };
    }

    // POST de la decisión. Nunca lanza: {ok, status, data, message}.
    async function decideClaim(claimId, decision, note, deps) {
        let req;
        try {
            req = buildDecideRequest(claimId, decision, note);
        } catch (err) {
            return { ok: false, status: 0, data: null, message: err.message };
        }
        const res = await fetchAdminJson(req.url, req.options, deps);
        return Object.assign({}, res, { message: res.ok ? null : describeFailure(res, { supportHint: true }) });
    }

    // -------------------------------------------------------------
    // Render
    // -------------------------------------------------------------
    function badge(text, cls) {
        return '<span class="status-badge ' + esc(cls) + '">' + esc(text) + '</span>';
    }

    function evidenceHtml(text) {
        if (!text) return '<span class="bo-muted">Sin evidencia</span>';
        if (text.length <= EVIDENCE_PREVIEW) return '<p class="bo-claim-evidence">' + linkify(text) + '</p>';
        const preview = text.slice(0, EVIDENCE_PREVIEW).replace(/\s+\S*$/, '') + '…';
        return '<details class="bo-claim-evidence-more"><summary><span class="bo-claim-evidence">' + esc(preview)
            + '</span> <span class="bo-claim-evidence-toggle">Ver todo</span></summary>'
            + '<p class="bo-claim-evidence">' + linkify(text) + '</p></details>';
    }

    function claimRowHtml(view) {
        const v = view;
        const id = esc(v.id);
        const avatar = v.logo ? '<img src="' + esc(v.logo) + '" alt="">' : esc(initials(v.studioName));
        const sub = [v.studioSlug ? '/' + v.studioSlug : null, v.location || null].filter(Boolean).join(' · ') || '—';
        const flags = [
            v.studioOwned ? badge('Ya tiene dueño', 'denied') : '',
            v.studioInactive ? badge('Ficha inactiva', 'none') : ''
        ].filter(Boolean).join(' ');
        const contact = [
            v.claimantName ? '<span><i class="fa-solid fa-user" aria-hidden="true"></i> ' + esc(v.claimantName) + '</span>' : '',
            v.claimantEmail
                ? '<span title="' + esc(v.claimantEmail) + '"><i class="fa-solid fa-envelope" aria-hidden="true"></i> ' + esc(v.claimantEmail) + '</span>'
                : '<span class="bo-muted">' + esc(v.userKnown ? 'La cuenta no tiene email' : 'No pudimos leer la cuenta') + '</span>',
            v.phone ? '<span><i class="fa-solid fa-phone" aria-hidden="true"></i> ' + esc(v.phone) + '</span>' : ''
        ].filter(Boolean).join('');
        const emailFlag = v.claimantEmail && !v.emailConfirmed ? badge('Email sin confirmar', 'pending') : '';
        const approveAttrs = v.studioOwned
            ? ' disabled title="La ficha ya tiene dueño: rechazá este reclamo."'
            : ' title="Asignar la ficha a esta cuenta"';
        return '<tr data-claim-row="' + id + '">'
            + '<td><div class="artist-cell-identity"><span class="avatar">' + avatar + '</span>'
            + '<div class="artist-meta"><strong title="' + esc(v.studioName) + '">' + esc(v.studioName) + '</strong>'
            + '<small title="' + esc(sub) + '">' + esc(sub) + '</small></div></div>'
            + (flags ? '<div class="bo-claim-flags">' + flags + '</div>' : '')
            + (v.profileHref ? '<a class="bo-claim-link" href="' + esc(appUrl(v.profileHref)) + '" target="_blank" rel="noopener">Ver perfil público <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>' : '')
            + '</td>'
            + '<td><div class="artist-cell-contact">' + contact + '</div>' + (emailFlag ? '<div class="bo-claim-flags">' + emailFlag + '</div>' : '') + '</td>'
            + '<td class="bo-claim-evidence-cell">' + evidenceHtml(v.evidence) + '</td>'
            + '<td><span title="' + esc(fmtDateTime(v.createdAt)) + '">' + esc(fmtRelative(v.createdAt)) + '</span>'
            + '<small class="bo-muted bo-block">' + esc(fmtDate(v.createdAt)) + '</small></td>'
            + '<td><div class="action-buttons bo-claim-actions">'
            + '<button type="button" class="btn btn-primary btn-sm" data-claim-action="approve" data-claim-id="' + id + '"' + approveAttrs + '>'
            + '<i class="fa-solid fa-check" aria-hidden="true"></i> Aprobar</button>'
            + '<button type="button" class="btn btn-secondary btn-sm danger-hover" data-claim-action="reject" data-claim-id="' + id + '">'
            + '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Rechazar</button>'
            + '</div></td></tr>';
    }

    function emptyHtml(icon, title, desc, actionHtml) {
        return '<div class="empty-state-box"><i class="fa-solid ' + esc(icon) + '" aria-hidden="true"></i>'
            + '<span class="empty-title">' + esc(title) + '</span>'
            + (desc ? '<span class="empty-desc">' + esc(desc) + '</span>' : '')
            + (actionHtml || '') + '</div>';
    }

    // HTML del listado según el estado ({claims, loading, error, migrationPending}).
    function renderClaimsHtml(input) {
        const s = input || {};
        if (s.loading) {
            return '<div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando reclamos…</span></div>';
        }
        if (s.error) {
            return '<div class="error-state-box"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'
                + '<span class="error-title">No pudimos cargar los reclamos</span>'
                + '<span class="error-desc">' + esc(s.error) + '</span>'
                + '<button type="button" class="btn btn-secondary btn-sm" data-claims-action="reload">Reintentar</button></div>';
        }
        if (s.migrationPending) {
            return emptyHtml('fa-database', 'Reclamos todavía no disponibles', MISSING_SCHEMA_MESSAGE);
        }
        const claims = Array.isArray(s.claims) ? s.claims : [];
        if (!claims.length) {
            return emptyHtml('fa-flag', 'No hay reclamos pendientes',
                'Cuando un estudio reclame su ficha desde el registro, aparece acá para que lo revises.');
        }
        return '<div class="table-container bo-table-scroll"><table class="data-table data-table-compact bo-claims-table">'
            + '<thead><tr><th scope="col">Estudio</th><th scope="col">Quién reclama</th><th scope="col">Evidencia</th>'
            + '<th scope="col">Recibido</th><th scope="col">Acciones</th></tr></thead>'
            + '<tbody>' + claims.map(c => claimRowHtml(claimView(c))).join('') + '</tbody></table></div>';
    }

    function metaHtml(claims) {
        const list = Array.isArray(claims) ? claims : [];
        if (!list.length) return '';
        const oldest = list.reduce((acc, c) => (!acc || (c.created_at && c.created_at < acc) ? (c.created_at || acc) : acc), null);
        const owned = list.filter(c => claimView(c).studioOwned).length;
        return '<span><strong>' + list.length + '</strong> ' + (list.length === 1 ? 'reclamo pendiente' : 'reclamos pendientes') + '</span>'
            + (oldest ? '<span>El más antiguo: <strong>' + esc(fmtRelative(oldest)) + '</strong></span>' : '')
            + (owned ? '<span><strong>' + owned + '</strong> sobre fichas que ya tienen dueño</span>' : '');
    }

    function shellHtml() {
        return '<div class="bo-review-block" aria-labelledby="bo-claims-title">'
            + '<div class="bo-review-head"><div>'
            + '<h3 id="bo-claims-title" class="bo-review-title"><i class="fa-solid fa-flag" aria-hidden="true"></i> Reclamos de estudios</h3>'
            + '<p class="section-description">Estudios reales que piden administrar su ficha del catálogo. Al aprobar, esa cuenta pasa a ser la dueña del estudio.</p>'
            + '</div><button type="button" class="btn btn-secondary btn-sm" data-claims-action="reload">'
            + '<i class="fa-solid fa-refresh" aria-hidden="true"></i> Actualizar</button></div>'
            + '<div class="artists-table-meta" data-claims-meta aria-live="polite"></div>'
            + '<div data-claims-list aria-live="polite"></div></div>';
    }

    const STYLES = [
        '.bo-review-block{margin-bottom:36px}',
        '.bo-review-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:12px}',
        '.bo-review-title{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:1rem;font-weight:600;color:var(--text-primary)}',
        '.bo-table-scroll{overflow-x:auto}',
        '.bo-muted{color:var(--text-muted);font-size:.8rem}',
        '.bo-block{display:block}',
        '.bo-claim-flags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
        '.bo-claim-link{display:inline-flex;gap:4px;align-items:center;margin-top:6px;font-size:.75rem;color:var(--text-muted)}',
        '.bo-claim-link:hover{color:var(--primary-color)}',
        '.bo-claim-evidence-cell{min-width:220px;max-width:380px}',
        '.bo-claim-evidence{margin:0;white-space:pre-line;overflow-wrap:anywhere;font-size:.8rem;color:var(--text-secondary)}',
        '.bo-claim-evidence a{color:var(--primary-color);text-decoration:underline}',
        '.bo-claim-evidence-more summary{cursor:pointer;list-style:none}',
        '.bo-claim-evidence-more summary::-webkit-details-marker{display:none}',
        '.bo-claim-evidence-more[open] summary{display:none}',
        '.bo-claim-evidence-toggle{font-size:.75rem;color:var(--primary-color)}',
        '.bo-claim-actions{gap:6px;flex-wrap:wrap}',
        '.bo-decision-modal .modal-content{max-width:520px}',
        '.bo-decision-modal .form-group textarea{width:100%;min-height:96px;resize:vertical}',
        '.bo-dialog-list{margin:8px 0 16px 18px;color:var(--text-secondary);font-size:.85rem;line-height:1.5}',
        '.bo-dialog-error{margin:6px 0 0;color:var(--error-color);font-size:.8rem}',
        '.bo-dialog-error[hidden]{display:none}',
        '.nav-item [data-bo-pending-count]{margin-left:auto;background:var(--warning-color);color:var(--bg-color)}',
        '.nav-item [data-bo-pending-count][hidden]{display:none}'
    ].join('\n');

    function injectStyles(doc) {
        if (!doc || doc.getElementById(STYLE_ID) || !doc.head) return;
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        doc.head.appendChild(style);
    }

    // -------------------------------------------------------------
    // Pendientes en la entrada del menú (compartido con backoffice-supplies.js)
    // -------------------------------------------------------------
    function reportPending(key, count) {
        const store = root.__weotziBoPendingCounts || (root.__weotziBoPendingCounts = {});
        store[key] = Math.max(0, Number(count) || 0);
        const total = Object.keys(store).reduce((sum, k) => sum + store[k], 0);
        const doc = getDoc();
        if (doc && typeof doc.querySelectorAll === 'function') {
            doc.querySelectorAll('[data-bo-pending-count]').forEach(el => {
                el.textContent = total > 99 ? '99+' : String(total);
                el.hidden = total === 0;
                el.setAttribute('aria-label', total === 1 ? '1 pendiente de revisión' : total + ' pendientes de revisión');
            });
        }
        return total;
    }

    // -------------------------------------------------------------
    // UI: toasts y diálogo de nota
    // -------------------------------------------------------------
    function toast(message, type) {
        // showToast de admin.js inserta HTML: siempre le pasamos texto escapado.
        if (root && typeof root.showToast === 'function') return root.showToast(esc(message), type || 'info');
        const k = kit();
        if (k && typeof k.toast === 'function') return k.toast(message, type === 'error' ? 'danger' : (type || 'info'));
        if (typeof console !== 'undefined') console.log('[backoffice-studio-claims]', message);
        return null;
    }

    // Modal con el markup del backoffice (.modal > .modal-overlay + .modal-content).
    // Resuelve con la nota (string, puede ser '') o null si se cancela.
    function openNoteDialog(cfg) {
        const doc = getDoc();
        if (!doc || !doc.body) return Promise.resolve(null);
        const c = cfg || {};
        const n = ++dialogSeq;
        const titleId = 'bo-claim-dialog-title-' + n;
        const noteId = 'bo-claim-dialog-note-' + n;
        const errorId = 'bo-claim-dialog-error-' + n;
        return new Promise(resolve => {
            const prevFocus = doc.activeElement;
            const wrap = doc.createElement('div');
            wrap.className = 'modal active bo-decision-modal';
            wrap.innerHTML = '<div class="modal-overlay" data-dialog-cancel></div>'
                + '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">'
                + '<div class="modal-header"><h3 id="' + titleId + '">' + esc(c.title) + '</h3>'
                + '<button type="button" class="modal-close" data-dialog-cancel aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>'
                + '<div class="modal-body">' + (c.bodyHtml || '')
                + '<div class="form-group"><label for="' + noteId + '">' + esc(c.noteLabel) + (c.required ? ' *' : '') + '</label>'
                + '<textarea id="' + noteId + '" maxlength="' + NOTE_MAX + '"' + (c.required ? ' required aria-required="true"' : '')
                + ' aria-describedby="' + errorId + '" placeholder="' + esc(c.placeholder || '') + '"></textarea>'
                + '<p class="bo-dialog-error" id="' + errorId + '" role="alert" hidden></p></div></div>'
                + '<div class="modal-footer"><button type="button" class="btn btn-secondary" data-dialog-cancel>Cancelar</button>'
                + '<button type="button" class="btn ' + esc(c.confirmClass || 'btn-primary') + '" data-dialog-confirm>' + esc(c.confirmLabel || 'Confirmar') + '</button></div>'
                + '</div>';
            doc.body.appendChild(wrap);
            const textarea = wrap.querySelector('textarea');
            const errorEl = wrap.querySelector('.bo-dialog-error');
            let done = false;

            function focusables() {
                return Array.prototype.slice.call(wrap.querySelectorAll('button, textarea, a[href]'))
                    .filter(el => !el.disabled && el.offsetParent !== null);
            }
            function close(value) {
                if (done) return;
                done = true;
                doc.removeEventListener('keydown', onKey, true);
                if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                if (prevFocus && typeof prevFocus.focus === 'function') {
                    try { prevFocus.focus(); } catch (_) { /* el foco previo ya no existe */ }
                }
                resolve(value);
            }
            function submit() {
                const note = String(textarea.value || '').trim();
                if (c.required && note.length < REASON_MIN) {
                    errorEl.textContent = c.requiredMessage || 'Escribí un motivo (al menos 3 caracteres).';
                    errorEl.hidden = false;
                    textarea.setAttribute('aria-invalid', 'true');
                    textarea.focus();
                    return;
                }
                close(note.slice(0, NOTE_MAX));
            }
            function onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close(null);
                } else if (e.key === 'Tab') {
                    const els = focusables();
                    if (!els.length) return;
                    const first = els[0];
                    const lastEl = els[els.length - 1];
                    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); lastEl.focus(); }
                    else if (!e.shiftKey && doc.activeElement === lastEl) { e.preventDefault(); first.focus(); }
                }
            }
            wrap.addEventListener('click', e => {
                const t = e.target;
                if (t && t.closest && t.closest('[data-dialog-cancel]')) close(null);
                else if (t && t.closest && t.closest('[data-dialog-confirm]')) submit();
            });
            textarea.addEventListener('input', () => {
                if (!errorEl.hidden) { errorEl.hidden = true; textarea.removeAttribute('aria-invalid'); }
            });
            doc.addEventListener('keydown', onKey, true);
            textarea.focus();
        });
    }

    // -------------------------------------------------------------
    // Flujo
    // -------------------------------------------------------------
    function getRootEl() {
        const doc = getDoc();
        return doc && typeof doc.getElementById === 'function' ? doc.getElementById(ROOT_ID) : null;
    }

    function renderList() {
        const el = getRootEl();
        if (!el) return;
        const list = el.querySelector('[data-claims-list]');
        const meta = el.querySelector('[data-claims-meta]');
        if (list) {
            list.setAttribute('aria-busy', state.loading ? 'true' : 'false');
            list.innerHTML = renderClaimsHtml(state);
        }
        if (meta) meta.innerHTML = state.loading || state.error ? '' : metaHtml(state.claims);
    }

    async function load(deps) {
        const seq = ++state.seq;
        state.loading = true;
        renderList();
        const res = await fetchAdminJson(ENDPOINT, { method: 'GET' }, deps);
        if (seq !== state.seq) return state;
        state.loading = false;
        state.loaded = true;
        state.migrationPending = !!(res.data && res.data.migration_pending);
        if (res.ok) {
            state.claims = normalizeClaims(res.data);
            state.error = null;
        } else {
            state.claims = [];
            state.error = state.migrationPending ? null : describeFailure(res);
        }
        renderList();
        reportPending(PENDING_KEY, state.claims.length);
        return state;
    }

    function findClaim(id) {
        return state.claims.find(c => String(c.id) === String(id)) || null;
    }

    function setRowBusy(id, busy) {
        const el = getRootEl();
        if (!el) return;
        el.querySelectorAll('[data-claim-id]').forEach(btn => {
            if (btn.getAttribute('data-claim-id') !== String(id)) return;
            if (busy) {
                btn.dataset.wasDisabled = btn.disabled ? 'true' : 'false';
                btn.disabled = true;
            } else {
                btn.disabled = btn.dataset.wasDisabled === 'true';
            }
        });
        const row = el.querySelector('[data-claim-row="' + String(id).replace(/["\\]/g, '') + '"]');
        if (row) row.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function dialogConfig(view, decision) {
        const who = view.claimantEmail || view.claimantName || 'la cuenta que reclamó';
        if (decision === 'approve') {
            return {
                title: 'Aprobar reclamo',
                bodyHtml: '<p>Vas a asignar <strong>' + esc(view.studioName) + '</strong> a <strong>' + esc(who) + '</strong>.</p>'
                    + '<ul class="bo-dialog-list">'
                    + '<li>Esa cuenta pasa a administrar la ficha desde /studio/dashboard y tiene que completar el perfil.</li>'
                    + '<li>Los otros reclamos pendientes de este estudio quedan rechazados.</li>'
                    + '<li>Le avisamos por email.</li></ul>'
                    + (view.claimantEmail && !view.emailConfirmed ? '<p class="bo-muted">Ojo: el email de esta cuenta todavía no está confirmado.</p>' : ''),
                noteLabel: 'Nota interna (opcional)',
                placeholder: 'Ej.: verificado por Instagram y llamada al teléfono del estudio',
                required: false,
                confirmLabel: 'Aprobar reclamo',
                confirmClass: 'btn-primary'
            };
        }
        return {
            title: 'Rechazar reclamo',
            bodyHtml: '<p>El reclamo de <strong>' + esc(view.studioName) + '</strong> queda rechazado y la ficha sigue sin dueño. '
                + 'Le avisamos a <strong>' + esc(who) + '</strong> por email, con el motivo.</p>',
            noteLabel: 'Motivo (se lo mostramos a quien reclamó)',
            placeholder: 'Ej.: no pudimos verificar que administres este estudio',
            required: true,
            requiredMessage: 'Escribí el motivo del rechazo (al menos 3 caracteres).',
            confirmLabel: 'Rechazar reclamo',
            confirmClass: 'btn-secondary danger-hover'
        };
    }

    function successMessage(view, decision, data) {
        const base = decision === 'approve'
            ? 'Reclamo aprobado: ' + view.studioName + ' ya tiene dueño.'
            : 'Reclamo rechazado: ' + view.studioName + ' sigue sin dueño.';
        const emailSent = data && Object.prototype.hasOwnProperty.call(data, 'email_sent') ? data.email_sent : true;
        return emailSent === false ? base + ' No pudimos enviar el aviso por email: avisale por otro medio.' : base;
    }

    async function startDecision(claimId, decision) {
        const claim = findClaim(claimId);
        if (!claim || !DECISIONS.includes(decision)) return null;
        const view = claimView(claim);
        if (decision === 'approve' && view.studioOwned) {
            toast('La ficha ya tiene dueño: rechazá este reclamo.', 'warning');
            return null;
        }
        const note = await openNoteDialog(dialogConfig(view, decision));
        if (note == null) return null;
        setRowBusy(view.id, true);
        const res = await decideClaim(view.id, decision, note);
        setRowBusy(view.id, false);
        if (res.ok) {
            toast(successMessage(view, decision, res.data), 'success');
            await load();
        } else {
            toast(res.message || GENERIC_MESSAGE, 'error');
            // 409: el estado cambió (otro soporte decidió, la ficha ya tiene dueño…).
            if (res.status === 409 || res.status === 400) await load();
        }
        return res;
    }

    function onRootClick(e) {
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        const reload = t.closest('[data-claims-action="reload"]');
        if (reload) {
            e.preventDefault();
            load();
            return;
        }
        const btn = t.closest('[data-claim-action]');
        if (btn && !btn.disabled) {
            e.preventDefault();
            startDecision(btn.getAttribute('data-claim-id'), btn.getAttribute('data-claim-action'));
        }
    }

    function syncTitle(section) {
        const doc = getDoc();
        const titleEl = doc && doc.getElementById('section-title');
        const title = section && section.getAttribute && section.getAttribute('data-title');
        if (titleEl && title) titleEl.textContent = title;
    }

    // ¿La sección acaba de (re)activarse? showSection de admin.js saca `active`
    // de todas las secciones y se la pone a la elegida: un click en la misma
    // entrada del menú deja un registro cuyo oldValue no tiene `active`.
    function becameActive(records, wasActive) {
        if (!Array.isArray(records) || !records.length) return !wasActive;
        return records.some(r => r && typeof r.oldValue === 'string' && !/(^|\s)active(\s|$)/.test(r.oldValue))
            || (!wasActive && records.some(r => r && r.oldValue == null));
    }

    function watchSection(section) {
        const MO = root && root.MutationObserver;
        if (!section || typeof MO !== 'function') return false;
        let wasActive = section.classList.contains('active');
        new MO(records => {
            const isActive = section.classList.contains('active');
            // showSection deja el título vacío para secciones que no conoce.
            if (isActive) syncTitle(section);
            if (isActive && becameActive(records, wasActive)) load();
            wasActive = isActive;
        }).observe(section, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
        return wasActive;
    }

    // Precarga liviana para el contador del menú. Si la sesión todavía no está
    // lista (ConfigManager tarda en crear el cliente), reintenta unas veces.
    function prefetch(attempt) {
        const n = Number(attempt) || 0;
        if (state.loading) return;
        if (state.loaded && state.error !== NO_SESSION_MESSAGE) return;
        load().then(s => {
            if (s && s.error === NO_SESSION_MESSAGE && n < PREFETCH_RETRIES) later(() => prefetch(n + 1), PREFETCH_RETRY_MS);
        });
    }

    function mount() {
        const el = getRootEl();
        if (!el || el.getAttribute('data-bo-mounted') === 'true') return false;
        el.setAttribute('data-bo-mounted', 'true');
        injectStyles(getDoc());
        el.innerHTML = shellHtml();
        el.addEventListener('click', onRootClick);
        const section = typeof el.closest === 'function' ? el.closest('.content-section') : null;
        if (watchSection(section)) {
            syncTitle(section);
            load();
            return true;
        }
        later(() => prefetch(0), PREFETCH_DELAY_MS);
        return true;
    }

    function autoInit() {
        const doc = getDoc();
        if (!doc || typeof doc.addEventListener !== 'function') return;
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
        else mount();
    }

    return {
        ENDPOINT,
        ROOT_ID,
        // flujo
        autoInit, mount, load, decideClaim, startDecision, prefetch,
        getState: () => state,
        // puras (tests)
        normalizeClaims, claimView, buildDecideRequest, describeFailure, renderClaimsHtml, claimRowHtml,
        metaHtml, linkify, fetchAdminJson, reportPending, dialogConfig, successMessage, becameActive,
        MISSING_SCHEMA_MESSAGE, NO_SESSION_MESSAGE, SUPPORT_HINT
    };
});
