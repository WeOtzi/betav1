// ============================================
// We Ötzi — Backoffice: verificaciones de estudios
// window.WeOtziBackofficeStudioVerifications · también exportable a Node (tests).
//
// Migración: supabase/migrations/20261102120000_studio_verification.sql.
//   - Lista las solicitudes `pending` (GET /api/admin/studio-verifications)
//     con la ficha del estudio, los estudios con los que coincidió en el
//     registro, la evidencia y los enlaces que mandó el dueño, el contacto,
//     el email de la cuenta dueña (auth.users, resuelto en el servidor; nunca
//     studios.email) y el estado del Instagram.
//   - Aprobar / Rechazar con nota → POST /api/admin/studio-verifications/:id/decide
//     {decision, note, confirm_instagram}. El servidor llama a
//     decide_studio_verification con el JWT del caller (la RPC exige soporte
//     activo). Rechazar pide un motivo (≥ 3 caracteres) que ve el estudio.
//     Al aprobar se puede confirmar también el Instagram del estudio si
//     todavía no está validado.
//   - Auth y textos de error: los mismos que backoffice-studio-claims.js.
//   - Sin la migración el servidor responde {requests: [], migration_pending}.
//
// Montaje: #bo-studio-verifications-root dentro de la sección Revisiones;
// carga cada vez que la sección se activa (MutationObserver, como reclamos).
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) {
        window.WeOtziBackofficeStudioVerifications = api;
        api.autoInit();
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const ENDPOINT = '/api/admin/studio-verifications';
    const ROOT_ID = 'bo-studio-verifications-root';
    const STYLE_ID = 'bo-studio-verifications-styles';
    const PENDING_KEY = 'studio_verifications';
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
    const DECISIONS = ['approve', 'reject'];
    const NOTE_MAX = 1000;
    const REASON_MIN = 3;
    const EVIDENCE_PREVIEW = 220;
    const PREFETCH_DELAY_MS = 1700;
    const PREFETCH_RETRY_MS = 4000;
    const PREFETCH_RETRIES = 3;

    const REASON_LABELS = {
        name_match: 'Nombre parecido a otro estudio',
        instagram_match: 'Mismo Instagram que otro estudio',
        owner_request: 'Pedido del estudio'
    };

    // Mismos textos que backoffice-studio-claims.js.
    const MISSING_SCHEMA_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';
    const NETWORK_MESSAGE = 'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.';
    const NO_SESSION_MESSAGE = 'No hay sesión de superadmin activa. Iniciá sesión de nuevo en /backoffice/login.';
    const NOT_DEPLOYED_MESSAGE = 'El servidor todavía no tiene esta función: actualizá el deploy.';
    const GENERIC_MESSAGE = 'No pudimos completar la acción. Intentá de nuevo.';
    const SUPPORT_HINT = 'Para decidir verificaciones tu cuenta tiene que estar activa en Super Admin → Usuarios Soporte.';

    const state = { requests: [], loading: false, loaded: false, error: null, migrationPending: false, seq: 0 };
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
    // Formato
    // -------------------------------------------------------------
    function esc(v) {
        const k = kit();
        if (k && typeof k.escapeHtml === 'function') return k.escapeHtml(v);
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // Solo http(s): todo lo demás (javascript:, data:, mailto:…) queda como texto.
    function safeUrl(u) {
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
    // Mismo criterio que el servidor: "@Estudio.Ink" o la URL del perfil → "estudio.ink".
    function normalizeHandle(value) {
        let s = String(value == null ? '' : value).trim();
        const fromUrl = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)/i.exec(s);
        if (fromUrl) s = fromUrl[1];
        s = s.replace(/^@+/, '');
        return HANDLE_RE.test(s) ? s.toLowerCase() : null;
    }
    function reasonLabel(code) {
        return REASON_LABELS[code] || String(code || '');
    }
    function profileHref(slug) {
        const ref = textOrNull(slug);
        return ref ? '/studio/profile/?studio=' + encodeURIComponent(ref) : null;
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
                ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(raw) + '</a>'
                : esc(raw);
            last = end;
            re.lastIndex = end;
        }
        return out + esc(s.slice(last));
    }

    // -------------------------------------------------------------
    // HTTP (Bearer de la sesión, como backoffice-studio-claims.js)
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
    function normalizeRequests(payload) {
        const list = payload && Array.isArray(payload.requests) ? payload.requests : [];
        return list.filter(r => r && typeof r === 'object' && r.id && (!r.status || r.status === 'pending'));
    }

    function requestView(request) {
        const r = request || {};
        const studio = (r.studio && typeof r.studio === 'object' ? r.studio : null)
            || (r.studios && typeof r.studios === 'object' && !Array.isArray(r.studios) ? r.studios : null) || {};
        const studioName = textOrNull(studio.name) || 'Estudio sin nombre';
        const location = [textOrNull(studio.city), textOrNull(studio.country)].filter(Boolean).join(', ');
        const igHandle = normalizeHandle(studio.instagram);
        const igVerifiedHandle = normalizeHandle(studio.instagram_verified_handle);
        const igVerified = !!(igHandle && igVerifiedHandle === igHandle && studio.instagram_verified_at);
        const pendingCode = r.instagram_pending_code && typeof r.instagram_pending_code === 'object' ? r.instagram_pending_code : null;
        const links = (Array.isArray(r.links) ? r.links : [])
            .map(textOrNull).filter(Boolean)
            .map(raw => ({ raw, href: safeUrl(raw) }));
        const reasons = (Array.isArray(r.reasons) ? r.reasons : []).filter(Boolean).map(String);
        const matched = (Array.isArray(r.matched_studios) ? r.matched_studios : [])
            .filter(s => s && typeof s === 'object')
            .map(s => ({
                id: textOrNull(s.id),
                name: textOrNull(s.name) || 'Estudio sin nombre',
                slug: textOrNull(s.slug),
                city: textOrNull(s.city),
                href: profileHref(s.slug)
            }));
        return {
            id: String(r.id || ''),
            status: r.status || 'pending',
            studioId: textOrNull(r.studio_id || studio.id),
            studioName,
            studioSlug: textOrNull(studio.slug),
            location,
            logo: safeUrl(studio.logo_image),
            profileHref: profileHref(studio.slug),
            reasons,
            reasonLabels: reasons.map(reasonLabel),
            matched,
            evidence: textOrNull(r.evidence) || '',
            links,
            contactName: textOrNull(r.contact_name),
            contactPhone: textOrNull(r.contact_phone),
            ownerEmail: textOrNull(r.owner_email),
            ownerName: textOrNull(r.owner_name),
            ownerEmailConfirmed: !!r.owner_email_confirmed,
            igHandle,
            igVerified,
            igVerifiedHandle,
            igPendingCode: !!(pendingCode && (!igHandle || normalizeHandle(pendingCode.handle) === igHandle)),
            canConfirmInstagram: !!(igHandle && !igVerified),
            createdAt: r.created_at || null
        };
    }

    function buildDecideRequest(requestId, decision, note, confirmInstagram) {
        const id = String(requestId || '').trim();
        if (!UUID_RE.test(id)) throw new Error('ID de solicitud inválido.');
        if (!DECISIONS.includes(decision)) throw new Error('Decisión inválida: usá approve o reject.');
        const clean = note == null ? '' : String(note).trim().slice(0, NOTE_MAX);
        if (decision === 'reject' && clean.length < REASON_MIN) throw new Error('Escribí el motivo del rechazo.');
        const body = { decision, note: clean || null };
        if (decision === 'approve' && confirmInstagram === true) body.confirm_instagram = true;
        return {
            url: ENDPOINT + '/' + encodeURIComponent(id) + '/decide',
            options: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        };
    }

    // POST de la decisión. Nunca lanza: {ok, status, data, message}.
    async function decideRequest(requestId, decision, note, confirmInstagram, deps) {
        let req;
        try {
            req = buildDecideRequest(requestId, decision, note, confirmInstagram);
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
        if (!text) return '<span class="bo-muted">Sin información adicional</span>';
        if (text.length <= EVIDENCE_PREVIEW) return '<p class="bo-verif-evidence">' + linkify(text) + '</p>';
        const preview = text.slice(0, EVIDENCE_PREVIEW).replace(/\s+\S*$/, '') + '…';
        return '<details class="bo-verif-evidence-more"><summary><span class="bo-verif-evidence">' + esc(preview)
            + '</span> <span class="bo-verif-evidence-toggle">Ver todo</span></summary>'
            + '<p class="bo-verif-evidence">' + linkify(text) + '</p></details>';
    }

    function linksHtml(links) {
        const list = Array.isArray(links) ? links : [];
        if (!list.length) return '';
        return '<ul class="bo-verif-links">' + list.map(l => '<li>' + (l.href
            ? '<a href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer">' + esc(l.raw) + '</a>'
            : '<span class="bo-muted">' + esc(l.raw) + '</span>') + '</li>').join('') + '</ul>';
    }

    function matchedHtml(matched) {
        const list = Array.isArray(matched) ? matched : [];
        if (!list.length) return '';
        return '<div class="bo-verif-matched"><span class="bo-muted">Coincide con:</span> ' + list.map(s => {
            const label = esc(s.name) + (s.city ? ' <span class="bo-muted">(' + esc(s.city) + ')</span>' : '');
            return s.href
                ? '<a href="' + esc(appUrl(s.href)) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
                : '<span>' + label + '</span>';
        }).join(', ') + '</div>';
    }

    function instagramHtml(view) {
        if (!view.igHandle) return '<span class="bo-muted">Sin Instagram en la ficha</span>';
        const handle = '<span class="bo-verif-ig">@' + esc(view.igHandle) + '</span>';
        if (view.igVerified) return handle + ' ' + badge('Validado', 'approved');
        if (view.igPendingCode) return handle + ' ' + badge('Código pedido, falta el DM', 'pending');
        return handle + ' ' + badge('Sin validar', 'none');
    }

    function requestRowHtml(view) {
        const v = view;
        const id = esc(v.id);
        const avatar = v.logo ? '<img src="' + esc(v.logo) + '" alt="">' : esc(initials(v.studioName));
        const sub = [v.studioSlug ? '/' + v.studioSlug : null, v.location || null].filter(Boolean).join(' · ') || '—';
        const reasons = v.reasonLabels.length
            ? '<div class="bo-verif-flags">' + v.reasonLabels.map(label => badge(label, 'pending')).join(' ') + '</div>'
            : '';
        const contact = [
            v.contactName ? '<span><i class="fa-solid fa-user" aria-hidden="true"></i> ' + esc(v.contactName) + '</span>' : '',
            v.ownerEmail
                ? '<span title="' + esc(v.ownerEmail) + '"><i class="fa-solid fa-envelope" aria-hidden="true"></i> ' + esc(v.ownerEmail) + '</span>'
                : '<span class="bo-muted">No pudimos leer el email de la cuenta</span>',
            v.contactPhone ? '<span><i class="fa-solid fa-phone" aria-hidden="true"></i> ' + esc(v.contactPhone) + '</span>' : ''
        ].filter(Boolean).join('');
        const emailFlag = v.ownerEmail && !v.ownerEmailConfirmed ? badge('Email sin confirmar', 'pending') : '';
        return '<tr data-verification-row="' + id + '">'
            + '<td><div class="artist-cell-identity"><span class="avatar">' + avatar + '</span>'
            + '<div class="artist-meta"><strong title="' + esc(v.studioName) + '">' + esc(v.studioName) + '</strong>'
            + '<small title="' + esc(sub) + '">' + esc(sub) + '</small></div></div>'
            + reasons
            + matchedHtml(v.matched)
            + (v.profileHref ? '<a class="bo-verif-link" href="' + esc(appUrl(v.profileHref)) + '" target="_blank" rel="noopener noreferrer">Ver perfil público <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>' : '')
            + '</td>'
            + '<td class="bo-verif-evidence-cell">' + evidenceHtml(v.evidence) + linksHtml(v.links) + '</td>'
            + '<td><div class="artist-cell-contact">' + contact + '</div>' + (emailFlag ? '<div class="bo-verif-flags">' + emailFlag + '</div>' : '') + '</td>'
            + '<td>' + instagramHtml(v) + '</td>'
            + '<td><span title="' + esc(fmtDateTime(v.createdAt)) + '">' + esc(fmtRelative(v.createdAt)) + '</span>'
            + '<small class="bo-muted bo-block">' + esc(fmtDate(v.createdAt)) + '</small></td>'
            + '<td><div class="action-buttons bo-verif-actions">'
            + '<button type="button" class="btn btn-primary btn-sm" data-verification-action="approve" data-verification-id="' + id + '" title="Marcar el estudio como verificado">'
            + '<i class="fa-solid fa-check" aria-hidden="true"></i> Aprobar</button>'
            + '<button type="button" class="btn btn-secondary btn-sm danger-hover" data-verification-action="reject" data-verification-id="' + id + '">'
            + '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Rechazar</button>'
            + '</div></td></tr>';
    }

    function emptyHtml(icon, title, desc) {
        return '<div class="empty-state-box"><i class="fa-solid ' + esc(icon) + '" aria-hidden="true"></i>'
            + '<span class="empty-title">' + esc(title) + '</span>'
            + (desc ? '<span class="empty-desc">' + esc(desc) + '</span>' : '') + '</div>';
    }

    // HTML del listado según el estado ({requests, loading, error, migrationPending}).
    function renderVerificationsHtml(input) {
        const s = input || {};
        if (s.loading) {
            return '<div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando verificaciones…</span></div>';
        }
        if (s.error) {
            return '<div class="error-state-box"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'
                + '<span class="error-title">No pudimos cargar las verificaciones</span>'
                + '<span class="error-desc">' + esc(s.error) + '</span>'
                + '<button type="button" class="btn btn-secondary btn-sm" data-verifications-action="reload">Reintentar</button></div>';
        }
        if (s.migrationPending) {
            return emptyHtml('fa-database', 'Verificaciones todavía no disponibles', MISSING_SCHEMA_MESSAGE);
        }
        const requests = Array.isArray(s.requests) ? s.requests : [];
        if (!requests.length) {
            return emptyHtml('fa-circle-check', 'No hay verificaciones pendientes',
                'Cuando un estudio pida la verificación o su registro coincida con otro estudio, aparece acá.');
        }
        return '<div class="table-container bo-table-scroll"><table class="data-table data-table-compact bo-verifications-table">'
            + '<thead><tr><th scope="col">Estudio</th><th scope="col">Información</th><th scope="col">Contacto</th>'
            + '<th scope="col">Instagram</th><th scope="col">Recibido</th><th scope="col">Acciones</th></tr></thead>'
            + '<tbody>' + requests.map(r => requestRowHtml(requestView(r))).join('') + '</tbody></table></div>';
    }

    function metaHtml(requests) {
        const list = Array.isArray(requests) ? requests : [];
        if (!list.length) return '';
        const oldest = list.reduce((acc, r) => (!acc || (r.created_at && r.created_at < acc) ? (r.created_at || acc) : acc), null);
        const matches = list.filter(r => requestView(r).matched.length > 0).length;
        return '<span><strong>' + list.length + '</strong> ' + (list.length === 1 ? 'verificación pendiente' : 'verificaciones pendientes') + '</span>'
            + (oldest ? '<span>La más antigua: <strong>' + esc(fmtRelative(oldest)) + '</strong></span>' : '')
            + (matches ? '<span><strong>' + matches + '</strong> con coincidencias en el registro</span>' : '');
    }

    function shellHtml() {
        return '<div class="bo-review-block" aria-labelledby="bo-verifications-title">'
            + '<div class="bo-review-head"><div>'
            + '<h3 id="bo-verifications-title" class="bo-review-title"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verificaciones de estudios</h3>'
            + '<p class="section-description">Estudios que pidieron la verificación o que se registraron con un nombre o Instagram parecido a otro. Al aprobar, el estudio queda verificado.</p>'
            + '</div><button type="button" class="btn btn-secondary btn-sm" data-verifications-action="reload">'
            + '<i class="fa-solid fa-refresh" aria-hidden="true"></i> Actualizar</button></div>'
            + '<div class="artists-table-meta" data-verifications-meta aria-live="polite"></div>'
            + '<div data-verifications-list aria-live="polite"></div></div>';
    }

    const STYLES = [
        '.bo-review-block{margin-bottom:36px}',
        '.bo-review-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:12px}',
        '.bo-review-title{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:1rem;font-weight:600;color:var(--text-primary)}',
        '.bo-table-scroll{overflow-x:auto}',
        '.bo-muted{color:var(--text-muted);font-size:.8rem}',
        '.bo-block{display:block}',
        '.bo-verif-flags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
        '.bo-verif-matched{margin-top:6px;font-size:.78rem;color:var(--text-secondary)}',
        '.bo-verif-matched a{color:var(--primary-color);text-decoration:underline}',
        '.bo-verif-link{display:inline-flex;gap:4px;align-items:center;margin-top:6px;font-size:.75rem;color:var(--text-muted)}',
        '.bo-verif-link:hover{color:var(--primary-color)}',
        '.bo-verif-evidence-cell{min-width:220px;max-width:380px}',
        '.bo-verif-evidence{margin:0;white-space:pre-line;overflow-wrap:anywhere;font-size:.8rem;color:var(--text-secondary)}',
        '.bo-verif-evidence a,.bo-verif-links a{color:var(--primary-color);text-decoration:underline}',
        '.bo-verif-evidence-more summary{cursor:pointer;list-style:none}',
        '.bo-verif-evidence-more summary::-webkit-details-marker{display:none}',
        '.bo-verif-evidence-more[open] summary{display:none}',
        '.bo-verif-evidence-toggle{font-size:.75rem;color:var(--primary-color)}',
        '.bo-verif-links{margin:6px 0 0 16px;padding:0;font-size:.78rem;overflow-wrap:anywhere}',
        '.bo-verif-ig{font-size:.85rem;color:var(--text-primary)}',
        '.bo-verif-actions{gap:6px;flex-wrap:wrap}',
        '.bo-decision-modal .modal-content{max-width:520px}',
        '.bo-decision-modal .form-group textarea{width:100%;min-height:96px;resize:vertical}',
        '.bo-dialog-list{margin:8px 0 16px 18px;color:var(--text-secondary);font-size:.85rem;line-height:1.5}',
        '.bo-dialog-error{margin:6px 0 0;color:var(--error-color);font-size:.8rem}',
        '.bo-dialog-error[hidden]{display:none}',
        '.bo-dialog-check{display:flex;gap:8px;align-items:flex-start;margin:4px 0 12px;font-size:.85rem;color:var(--text-secondary)}',
        '.bo-dialog-check input{margin-top:3px}'
    ].join('\n');

    function injectStyles(doc) {
        if (!doc || doc.getElementById(STYLE_ID) || !doc.head) return;
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        doc.head.appendChild(style);
    }

    // -------------------------------------------------------------
    // Pendientes en la entrada del menú (compartido con reclamos y Supplies)
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
        if (typeof console !== 'undefined') console.log('[backoffice-studio-verifications]', message);
        return null;
    }

    // Modal con el markup del backoffice. Resuelve con {note, confirmInstagram}
    // o null si se cancela.
    function openDecisionDialog(cfg) {
        const doc = getDoc();
        if (!doc || !doc.body) return Promise.resolve(null);
        const c = cfg || {};
        const n = ++dialogSeq;
        const titleId = 'bo-verif-dialog-title-' + n;
        const noteId = 'bo-verif-dialog-note-' + n;
        const errorId = 'bo-verif-dialog-error-' + n;
        const checkId = 'bo-verif-dialog-ig-' + n;
        return new Promise(resolve => {
            const prevFocus = doc.activeElement;
            const wrap = doc.createElement('div');
            wrap.className = 'modal active bo-decision-modal';
            wrap.innerHTML = '<div class="modal-overlay" data-dialog-cancel></div>'
                + '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">'
                + '<div class="modal-header"><h3 id="' + titleId + '">' + esc(c.title) + '</h3>'
                + '<button type="button" class="modal-close" data-dialog-cancel aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>'
                + '<div class="modal-body">' + (c.bodyHtml || '')
                + (c.instagramHandle
                    ? '<label class="bo-dialog-check" for="' + checkId + '"><input type="checkbox" id="' + checkId + '" data-dialog-instagram> '
                        + '<span>Confirmar también el Instagram @' + esc(c.instagramHandle) + '</span></label>'
                    : '')
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
            const checkbox = wrap.querySelector('[data-dialog-instagram]');
            let done = false;

            function focusables() {
                return Array.prototype.slice.call(wrap.querySelectorAll('button, textarea, input, a[href]'))
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
                close({ note: note.slice(0, NOTE_MAX), confirmInstagram: !!(checkbox && checkbox.checked) });
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
        const list = el.querySelector('[data-verifications-list]');
        const meta = el.querySelector('[data-verifications-meta]');
        if (list) {
            list.setAttribute('aria-busy', state.loading ? 'true' : 'false');
            list.innerHTML = renderVerificationsHtml(state);
        }
        if (meta) meta.innerHTML = state.loading || state.error ? '' : metaHtml(state.requests);
    }

    async function load(deps) {
        const seq = ++state.seq;
        state.loading = true;
        renderList();
        const res = await fetchAdminJson(ENDPOINT + '?status=pending', { method: 'GET' }, deps);
        if (seq !== state.seq) return state;
        state.loading = false;
        state.loaded = true;
        state.migrationPending = !!(res.data && res.data.migration_pending);
        if (res.ok) {
            state.requests = normalizeRequests(res.data);
            state.error = null;
        } else {
            state.requests = [];
            state.error = state.migrationPending ? null : describeFailure(res);
        }
        renderList();
        reportPending(PENDING_KEY, state.requests.length);
        return state;
    }

    function findRequest(id) {
        return state.requests.find(r => String(r.id) === String(id)) || null;
    }

    function setRowBusy(id, busy) {
        const el = getRootEl();
        if (!el) return;
        el.querySelectorAll('[data-verification-id]').forEach(btn => {
            if (btn.getAttribute('data-verification-id') !== String(id)) return;
            if (busy) {
                btn.dataset.wasDisabled = btn.disabled ? 'true' : 'false';
                btn.disabled = true;
            } else {
                btn.disabled = btn.dataset.wasDisabled === 'true';
            }
        });
        const row = el.querySelector('[data-verification-row="' + String(id).replace(/["\\]/g, '') + '"]');
        if (row) row.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function dialogConfig(view, decision) {
        const who = view.ownerEmail || view.contactName || 'la cuenta dueña';
        if (decision === 'approve') {
            return {
                title: 'Aprobar verificación',
                bodyHtml: '<p>Vas a marcar <strong>' + esc(view.studioName) + '</strong> como estudio verificado.</p>'
                    + '<ul class="bo-dialog-list">'
                    + '<li>La ficha pasa a mostrarse como verificada.</li>'
                    + '<li>Le avisamos a <strong>' + esc(who) + '</strong> por email.</li></ul>',
                instagramHandle: view.canConfirmInstagram ? view.igHandle : null,
                noteLabel: 'Nota interna (opcional)',
                placeholder: 'Ej.: verificado por llamada al teléfono del estudio',
                required: false,
                confirmLabel: 'Aprobar verificación',
                confirmClass: 'btn-primary'
            };
        }
        return {
            title: 'Rechazar verificación',
            bodyHtml: '<p>La verificación de <strong>' + esc(view.studioName) + '</strong> queda rechazada. '
                + 'Le avisamos a <strong>' + esc(who) + '</strong> por email, con el motivo, para que pueda mandar más información.</p>',
            instagramHandle: null,
            noteLabel: 'Motivo (se lo mostramos al estudio)',
            placeholder: 'Ej.: no pudimos confirmar que el estudio funcione en esa dirección',
            required: true,
            requiredMessage: 'Escribí el motivo del rechazo (al menos 3 caracteres).',
            confirmLabel: 'Rechazar verificación',
            confirmClass: 'btn-secondary danger-hover'
        };
    }

    function successMessage(view, decision, data) {
        let base = decision === 'approve'
            ? 'Verificación aprobada: ' + view.studioName + ' ya está verificado.'
            : 'Verificación rechazada: le avisamos a ' + view.studioName + '.';
        if (decision === 'approve' && data && data.instagram_confirmed === true && data.instagram_handle) {
            base += ' También validamos el Instagram @' + data.instagram_handle + '.';
        }
        const emailSent = data && Object.prototype.hasOwnProperty.call(data, 'email_sent') ? data.email_sent : true;
        return emailSent === false ? base + ' No pudimos enviar el aviso por email: avisale por otro medio.' : base;
    }

    async function startDecision(requestId, decision) {
        const request = findRequest(requestId);
        if (!request || !DECISIONS.includes(decision)) return null;
        const view = requestView(request);
        const answer = await openDecisionDialog(dialogConfig(view, decision));
        if (answer == null) return null;
        setRowBusy(view.id, true);
        const res = await decideRequest(view.id, decision, answer.note, decision === 'approve' && answer.confirmInstagram === true);
        setRowBusy(view.id, false);
        if (res.ok) {
            toast(successMessage(view, decision, res.data), 'success');
            await load();
        } else {
            toast(res.message || GENERIC_MESSAGE, 'error');
            if (res.status === 409 || res.status === 400) await load();
        }
        return res;
    }

    function onRootClick(e) {
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        const reload = t.closest('[data-verifications-action="reload"]');
        if (reload) {
            e.preventDefault();
            load();
            return;
        }
        const btn = t.closest('[data-verification-action]');
        if (btn && !btn.disabled) {
            e.preventDefault();
            startDecision(btn.getAttribute('data-verification-id'), btn.getAttribute('data-verification-action'));
        }
    }

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
            if (isActive && becameActive(records, wasActive)) load();
            wasActive = isActive;
        }).observe(section, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
        return wasActive;
    }

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
        REASON_LABELS,
        // flujo
        autoInit, mount, load, decideRequest, startDecision, prefetch,
        getState: () => state,
        // puras (tests)
        normalizeRequests, requestView, buildDecideRequest, describeFailure, renderVerificationsHtml, requestRowHtml,
        metaHtml, linkify, linksHtml, instagramHtml, reasonLabel, normalizeHandle, safeUrl, fetchAdminJson, reportPending,
        dialogConfig, successMessage, becameActive,
        MISSING_SCHEMA_MESSAGE, NO_SESSION_MESSAGE, SUPPORT_HINT
    };
});
