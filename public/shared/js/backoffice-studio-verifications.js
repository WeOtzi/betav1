// ============================================
// We Ötzi — Backoffice: verificaciones de estudios
// window.WeOtziBackofficeStudioVerifications · exportable a Node (tests).
//
// Cola de las solicitudes de verificación (migraciones 20261102120000 y
// 20261115220000):
//   GET  /api/admin/studio-verifications?status=…   lista con estudio, sede,
//        responsable, documentos (sin rutas), coincidencias del registro,
//        email del dueño (auth.users) y estado del Instagram.
//   GET  /api/admin/studio-verifications/:id/documents   URLs firmadas 10 min.
//   POST /api/admin/studio-verifications/:id/decide      {decision, note, confirm_instagram}
//   POST /api/admin/studio-verifications/studios/:id/revoke   {note}
// El servidor autoriza al superadmin o a un agente de soporte activo y aplica
// la decisión con service_role: no hace falta otro JWT de agente.
// Al decidir, el dueño recibe el email studio_verification_decision.
//
// Montaje: #bo-studio-verifications-root en la sección
// #section-studio-verifications; carga cada vez que la sección se activa.
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) {
        window.WeOtziBackofficeStudioVerifications = api;
        api.autoInit();
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const ADMIN_ENDPOINT = '/api/admin/studio-verifications';
    const SUPPORT_ENDPOINT = '/api/support/studio-verifications';
    const SUPPORT_TAB = 'estudios';
    const ROOT_ID = 'bo-studio-verifications-root';
    const SECTION_ID = 'section-studio-verifications';
    const STYLE_ID = 'bo-studio-verifications-styles';
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'all'];
    const STATUS_LABELS = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Corrección pedida', cancelled: 'Cancelada / sello retirado' };
    const REASON_LABELS = {
        name_match: 'Nombre parecido a otro estudio',
        instagram_match: 'Mismo Instagram que otro estudio',
        owner_request: 'Pedido del estudio'
    };
    const NOTE_MIN = 3;
    const NOTE_MAX = 1000;

    const state = { endpoint: ADMIN_ENDPOINT, mount: null, status: 'pending', requests: [], loading: false, error: null, migrationPending: false, docs: {}, seq: 0 };

    // ---------------------------------------------------------------
    // Formato (puro)
    // ---------------------------------------------------------------
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // Solo http(s): javascript:, data:, mailto:… quedan como texto.
    function safeUrl(u) {
        const s = String(u == null ? '' : u).trim();
        return /^https?:\/\/[^\s/?#<>"'`]+[^\s<>"'`]*$/i.test(s) ? s : null;
    }
    function fmtDate(d) {
        const date = d ? new Date(d) : null;
        if (!date || Number.isNaN(date.getTime())) return '—';
        try { return date.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return date.toISOString(); }
    }
    function profileHref(studio) {
        const ref = studio && (studio.slug || studio.id);
        return ref ? '/studio/profile?studio=' + encodeURIComponent(ref) : null;
    }
    function normalizeStatus(value) {
        const s = String(value || 'pending').toLowerCase();
        return STATUSES.indexOf(s) === -1 ? 'pending' : s;
    }

    // Validación del body de /decide (la repite el servidor).
    function validateDecision(decision, note) {
        const n = String(note == null ? '' : note).trim();
        if (decision !== 'approve' && decision !== 'reject') return 'Decisión inválida.';
        if (n.length > NOTE_MAX) return 'La nota admite hasta ' + NOTE_MAX + ' caracteres.';
        if (decision === 'reject' && n.length < NOTE_MIN) return 'Cuéntale al estudio qué tiene que corregir (al menos 3 caracteres).';
        return null;
    }

    function docsHtml(request, signed) {
        const docs = Array.isArray(request.documents) ? request.documents : [];
        if (!docs.length) return '<p class="bsv-muted">Sin documentos (solicitud abierta por el registro o anterior al formulario del Figma).</p>';
        const list = signed || docs;
        return '<ul class="bsv-docs">' + list.map(d => {
            const url = signed ? safeUrl(d.url) : null;
            const label = (d.kind === 'space' ? 'Espacio' : 'Representación') + ' · ' + (d.name || 'archivo');
            return '<li>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>' : esc(label)) + '</li>';
        }).join('') + '</ul>'
            + (signed ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-bsv-action="docs" data-id="' + esc(request.id) + '"><i class="fa-solid fa-eye" aria-hidden="true"></i> Ver documentos</button>');
    }

    function dl(rows) {
        return '<dl class="bsv-dl">' + rows.filter(r => r && r[1]).map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>';
    }

    // Usuario de Instagram sin @, sin URL y en minúsculas (normalizeHandle).
    function normHandle(value) {
        return String(value == null ? '' : value).trim()
            .replace(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '')
            .replace(/^@+/, '').toLowerCase();
    }

    // Plan KYC 1.5: aprobar exige el Instagram del estudio validado PARA el
    // Instagram que hoy tiene el perfil (misma regla que verified-badge.js;
    // esta página puede no cargarlo).
    function studioIgValidated(studio) {
        const s = studio || {};
        if (root.WoVerifiedBadge) return root.WoVerifiedBadge.instagramMatches(s);
        if (typeof s.instagram_badge_ok === 'boolean') return s.instagram_badge_ok;
        const handle = normHandle(s.instagram);
        return Boolean(s.instagram_verified_at && handle && handle === normHandle(s.instagram_verified_handle));
    }

    // 'ok' (validado) | 'confirm' (soporte tiene que confirmarlo) | 'no_handle'.
    function studioIgState(studio) {
        if (studioIgValidated(studio)) return 'ok';
        return normHandle(studio && studio.instagram) ? 'confirm' : 'no_handle';
    }

    function cardHtml(request, signedDocs) {
        const r = request || {};
        const studio = r.studio || {};
        const href = profileHref(studio);
        const loc = r.location;
        const igHandle = normHandle(studio.instagram);
        const igVerified = studioIgValidated(studio);
        const igOther = !igVerified && studio.instagram_verified_at && normHandle(studio.instagram_verified_handle)
            ? normHandle(studio.instagram_verified_handle) : '';
        const reasons = (r.reasons || []).map(x => '<span class="bsv-chip">' + esc(REASON_LABELS[x] || x) + '</span>').join('');
        const matched = (r.matched_studios || []).map(m => {
            const mh = profileHref(m);
            return mh ? '<a href="' + esc(mh) + '" target="_blank" rel="noopener">' + esc(m.name || 'Estudio') + (m.city ? ' · ' + esc(m.city) : '') + '</a>' : esc(m.name || 'Estudio');
        }).join(', ');
        const links = (r.links || []).map(l => {
            const u = safeUrl(l);
            return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a>' : esc(l);
        }).join('<br>');
        const ig = igHandle
            ? '@' + esc(igHandle) + (igVerified ? ' · <span class="bsv-ok">validado</span>'
                : igOther ? ' · sin validar (validó @' + esc(igOther) + ', que ya no es el de su perfil)'
                    : (r.instagram_pending_code ? ' · código pendiente' : ' · sin validar'))
            : '<span class="bsv-muted">Sin Instagram en el perfil</span>';
        const pending = r.status === 'pending';
        const canRevoke = r.status === 'approved' && (studio.is_verified || studio.verification_status === 'verified');
        return '<article class="bsv-card" data-id="' + esc(r.id) + '">'
            + '<header class="bsv-card-head">'
            + '<div><h3>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(studio.name || 'Estudio') + '</a>' : esc(studio.name || 'Estudio')) + '</h3>'
            + '<p class="bsv-muted">' + esc([studio.city, studio.country].filter(Boolean).join(', ')) + (r.created_at ? ' · enviada ' + esc(fmtDate(r.created_at)) : '') + '</p></div>'
            + '<span class="status-badge bsv-status bsv-status--' + esc(r.status) + '">' + esc(STATUS_LABELS[r.status] || r.status) + '</span>'
            + '</header>'
            + (reasons ? '<div class="bsv-chips">' + reasons + '</div>' : '')
            + dl([
                ['Nombre legal o comercial', esc(r.legal_name || '')],
                ['Responsable', esc([r.contact_name, r.responsible_role].filter(Boolean).join(' · '))],
                ['Contacto del responsable', esc(r.responsible_contact || r.contact_phone || '')],
                ['Sede a verificar', loc ? esc([loc.label, loc.formatted_address || loc.city].filter(Boolean).join(' · ')) + (loc.is_primary ? ' (principal)' : '') : ''],
                ['Cuenta dueña', r.owner_email ? esc(r.owner_email) + (r.owner_email_confirmed ? '' : ' · email sin confirmar') : '<span class="bsv-muted">Sin dueño con email</span>'],
                ['Instagram', ig],
                ['Coincide con', matched],
                ['Comentario', r.evidence ? esc(r.evidence) : ''],
                ['Enlaces', links],
                ['Nota de la decisión', r.decision_note ? esc(r.decision_note) + (r.decided_at ? ' <span class="bsv-muted">(' + esc(fmtDate(r.decided_at)) + ')</span>' : '') : '']
            ])
            + '<div class="bsv-docs-wrap" data-bsv-docs="' + esc(r.id) + '"><h4>Documentos</h4>' + docsHtml(r, signedDocs) + '</div>'
            + (pending ? decisionFormHtml(r, studioIgState(studio), igHandle) : '')
            + (canRevoke ? revokeFormHtml(r) : '')
            + '</article>';
    }

    // igState: 'ok' | 'confirm' | 'no_handle' (studioIgState). Sin el
    // Instagram validado, aprobar queda deshabilitado hasta marcar la
    // confirmación; sin Instagram en el perfil solo se puede pedir corrección.
    // La casilla NO lleva `required` y el form es novalidate: la validación
    // nativa frenaría también «Pedir corrección». La regla de aprobar la
    // aplican canApprove()/syncApprove() y el servidor.
    function decisionFormHtml(r, igState, igHandle) {
        const id = esc(r.id);
        const state = igState === 'confirm' || igState === 'no_handle' ? igState : 'ok';
        const igBlock = state === 'confirm'
            ? '<label class="bsv-check"><input type="checkbox" name="confirm_instagram" data-bsv-ig-required aria-describedby="bsv-ig-hint-' + id + '"> Confirmo que el Instagram @' + esc(igHandle || '') + ' es del estudio</label>'
                + '<p class="bsv-muted bsv-hint" id="bsv-ig-hint-' + id + '">Para aprobar, el Instagram del estudio tiene que estar validado. No validó el código: confírmalo solo si revisaste que la cuenta es del estudio.</p>'
            : state === 'no_handle'
                ? '<p class="bsv-muted bsv-hint" id="bsv-ig-hint-' + id + '">El estudio no cargó su Instagram y sin él no se puede aprobar. Pídele que lo cargue con «Pedir corrección».</p>'
                : '';
        const approveOff = state === 'ok' ? '' : ' disabled aria-describedby="bsv-ig-hint-' + id + '"';
        return '<form class="bsv-decide" data-bsv-decide="' + id + '" data-bsv-ig="' + state + '" novalidate>'
            + '<label class="bsv-label" for="bsv-note-' + id + '">Nota para el estudio <span class="bsv-muted">(obligatoria para pedir una corrección; la recibe por email)</span></label>'
            + '<textarea id="bsv-note-' + id + '" name="note" rows="3" maxlength="' + NOTE_MAX + '" placeholder="Ej. El documento de representación no muestra el nombre completo del responsable."></textarea>'
            + igBlock
            + '<p class="bsv-error" role="alert" hidden></p>'
            + '<div class="bsv-actions">'
            + '<button type="submit" class="btn btn-primary" value="approve"' + approveOff + '><i class="fa-solid fa-check" aria-hidden="true"></i> Aprobar verificación</button>'
            + '<button type="submit" class="btn btn-secondary" value="reject"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Pedir corrección</button>'
            + '</div></form>';
    }

    function revokeFormHtml(r) {
        const id = esc(r.studio_id);
        return '<details class="bsv-revoke"><summary>Retirar el sello de verificado</summary>'
            + '<form data-bsv-revoke="' + id + '">'
            + '<label class="bsv-label" for="bsv-revoke-' + id + '">Motivo (lo recibe el estudio)</label>'
            + '<textarea id="bsv-revoke-' + id + '" name="note" rows="2" maxlength="' + NOTE_MAX + '" required></textarea>'
            + '<p class="bsv-error" role="alert" hidden></p>'
            + '<div class="bsv-actions"><button type="submit" class="btn btn-danger"><i class="fa-solid fa-ban" aria-hidden="true"></i> Retirar sello</button></div>'
            + '</form></details>';
    }

    function listHtml(st) {
        const s = st || state;
        const toolbar = '<div class="section-toolbar bsv-toolbar">'
            + '<div class="filter-group">'
            + '<label class="bsv-label" for="bsv-status">Estado</label>'
            + '<select id="bsv-status">' + STATUSES.map(v => '<option value="' + v + '"' + (v === s.status ? ' selected' : '') + '>' + esc(v === 'all' ? 'Todas' : STATUS_LABELS[v]) + '</option>').join('') + '</select>'
            + '<button type="button" class="btn btn-secondary" data-bsv-action="refresh"><i class="fa-solid fa-refresh" aria-hidden="true"></i> Actualizar</button>'
            + '</div>'
            + '<p class="bsv-muted bsv-count" role="status">' + (s.loading ? 'Cargando…' : esc(s.requests.length + (s.requests.length === 1 ? ' solicitud' : ' solicitudes'))) + '</p>'
            + '</div>';
        if (s.error) return toolbar + '<div class="empty-state-box"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span class="empty-title">No pudimos cargar la cola</span><span class="empty-desc">' + esc(s.error) + '</span></div>';
        if (s.migrationPending) return toolbar + '<div class="empty-state-box"><i class="fa-solid fa-database" aria-hidden="true"></i><span class="empty-title">Falta aplicar una migración</span><span class="empty-desc">La verificación de estudios todavía no está disponible en la base.</span></div>';
        if (!s.loading && !s.requests.length) return toolbar + '<div class="empty-state-box"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span class="empty-title">Sin solicitudes</span><span class="empty-desc">No hay verificaciones de estudios en este estado.</span></div>';
        return toolbar + '<div class="bsv-list">' + s.requests.map(r => cardHtml(r, s.docs[r.id])).join('') + '</div>';
    }

    // ---------------------------------------------------------------
    // Navegador
    // ---------------------------------------------------------------
    function doc() { return root.document || null; }
    function mountEl() { if (state.mount) return state.mount; const d = doc(); return d && d.getElementById(ROOT_ID); }
    function toast(message, type) {
        if (typeof root.showToast === 'function') root.showToast(message, type || 'info');
    }

    // La sesión vive en el storage del proyecto: se prueba con cada cliente
    // disponible (backoffice: ConfigManager; soporte: window._supabase).
    async function authHeaders() {
        const clients = [];
        try {
            const cm = root.ConfigManager;
            if (cm && typeof cm.getSupabaseClient === 'function') clients.push(cm.getSupabaseClient());
            const data = root.WeotziData;
            if (data && typeof data.getClient === 'function') clients.push(data.getClient());
        } catch (_) { /* seguimos con los que haya */ }
        clients.push(root._supabase, root.supabaseClient);
        for (const client of clients) {
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') continue;
            try {
                const { data } = await client.auth.getSession();
                const token = data && data.session && data.session.access_token;
                if (token) return { Authorization: 'Bearer ' + token };
            } catch (_) { /* probamos el siguiente */ }
        }
        return null;
    }

    async function request(path, opts) {
        const o = opts || {};
        const auth = await authHeaders();
        if (!auth) return { ok: false, status: 401, data: { error: 'No hay sesión de superadmin activa. Inicia sesión de nuevo en /backoffice/login.' } };
        try {
            const res = await root.fetch(path, {
                method: o.method || 'GET',
                headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
                body: o.body ? JSON.stringify(o.body) : undefined
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 404 && !data.error) data.error = 'El servidor todavía no tiene esta función: actualiza el deploy.';
            return { ok: res.ok && data.success !== false, status: res.status, data };
        } catch (_) {
            return { ok: false, status: 0, data: { error: 'No pudimos conectarnos con el servidor. Revisa tu conexión e intenta de nuevo.' } };
        }
    }

    function render() {
        const el = mountEl();
        if (el) el.innerHTML = listHtml(state);
    }

    function updateNavBadge() {
        const d = doc();
        const badge = d && d.getElementById('bsv-nav-count');
        if (!badge) return;
        const n = state.status === 'pending' ? state.requests.length : null;
        if (n == null) return;
        badge.textContent = String(n);
        badge.hidden = n === 0;
    }

    async function load() {
        const seq = ++state.seq;
        state.loading = true;
        state.error = null;
        render();
        const res = await request(state.endpoint + '?status=' + encodeURIComponent(state.status));
        if (seq !== state.seq) return;
        state.loading = false;
        if (!res.ok) {
            state.requests = [];
            state.error = (res.data && res.data.error) || 'No pudimos cargar las solicitudes.';
        } else {
            state.requests = Array.isArray(res.data.requests) ? res.data.requests : [];
            state.migrationPending = Boolean(res.data.migration_pending);
            state.docs = {};
        }
        render();
        updateNavBadge();
    }

    async function showDocs(button) {
        const id = button.dataset.id;
        if (!UUID_RE.test(id || '')) return;
        button.disabled = true;
        const res = await request(state.endpoint + '/' + encodeURIComponent(id) + '/documents');
        button.disabled = false;
        if (!res.ok) { toast((res.data && res.data.error) || 'No pudimos abrir los documentos.', 'error'); return; }
        state.docs[id] = res.data.documents || [];
        const wrap = doc().querySelector('[data-bsv-docs="' + id + '"]');
        const req = state.requests.find(r => r.id === id);
        if (wrap && req) wrap.innerHTML = '<h4>Documentos</h4>' + docsHtml(req, state.docs[id]);
    }

    function formError(form, message) {
        const el = form.querySelector('.bsv-error');
        if (el) { el.textContent = message; el.hidden = !message; }
    }

    // Aprobar se habilita con el Instagram validado o con la confirmación marcada.
    function canApprove(form) {
        const ig = form.dataset.bsvIg || 'ok';
        if (ig === 'no_handle') return false;
        if (ig === 'confirm') {
            const box = form.querySelector('[name="confirm_instagram"]');
            return Boolean(box && box.checked);
        }
        return true;
    }

    function syncApprove(form) {
        const approve = form.querySelector('button[value="approve"]');
        if (approve) approve.disabled = !canApprove(form);
    }

    async function decide(form, decision) {
        const id = form.dataset.bsvDecide;
        const note = form.querySelector('[name="note"]').value;
        const problem = validateDecision(decision, note);
        if (problem) { formError(form, problem); form.querySelector('[name="note"]').focus(); return; }
        if (decision === 'approve' && !canApprove(form)) {
            formError(form, form.dataset.bsvIg === 'no_handle'
                ? 'El estudio no cargó su Instagram: pídele que lo cargue antes de aprobar.'
                : 'Para aprobar, confirma que el Instagram es del estudio.');
            return;
        }
        const igBox = form.querySelector('[name="confirm_instagram"]');
        const confirmText = decision === 'approve' ? '¿Aprobar la verificación de este estudio? El sello aparece en su perfil público.' : '¿Pedir una corrección al estudio? Le llega la nota por email.';
        if (typeof root.confirm === 'function' && !root.confirm(confirmText)) return;
        form.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const res = await request(state.endpoint + '/' + encodeURIComponent(id) + '/decide', {
            method: 'POST',
            body: { decision, note: note.trim() || null, confirm_instagram: Boolean(igBox && igBox.checked) }
        });
        form.querySelectorAll('button').forEach(b => { b.disabled = false; });
        syncApprove(form);
        if (!res.ok) { formError(form, (res.data && res.data.error) || 'No pudimos guardar la decisión.'); return; }
        toast((decision === 'approve' ? 'Estudio verificado' : 'Corrección pedida') + (res.data.email_sent ? ' · email enviado' : ' · el email no salió (revisa Email Routing)'), res.data.email_sent ? 'success' : 'warning');
        load();
    }

    // Retira el sello. `form`: contenedor con [name="note"] y .bsv-error.
    // Devuelve true si el servidor lo retiró.
    async function revokeStudio(form, studioId, endpoint) {
        const note = form.querySelector('[name="note"]').value.trim();
        if (!UUID_RE.test(String(studioId || ''))) { formError(form, 'ID de estudio inválido.'); return false; }
        if (note.length < NOTE_MIN || note.length > NOTE_MAX) { formError(form, 'Escribe el motivo (entre ' + NOTE_MIN + ' y ' + NOTE_MAX + ' caracteres).'); return false; }
        if (typeof root.confirm === 'function' && !root.confirm('¿Retirar el sello de verificado? El estudio deja de mostrarlo y recibe el motivo por email.')) return false;
        formError(form, '');
        const res = await request((endpoint || state.endpoint) + '/studios/' + encodeURIComponent(studioId) + '/revoke', { method: 'POST', body: { note } });
        if (!res.ok) { formError(form, (res.data && res.data.error) || 'No pudimos retirar el sello.'); return false; }
        toast('Sello retirado' + (res.data.email_sent ? ' · email enviado' : ' · el email no salió (revisa Email Routing)'), res.data.email_sent ? 'success' : 'warning');
        return true;
    }

    async function revoke(form) {
        if (await revokeStudio(form, form.dataset.bsvRevoke)) load();
    }

    // ---------------------------------------------------------------
    // Ficha del estudio en el backoffice (#section-studio-detail): el toggle
    // "Verificado" quedó de solo lectura, así que un estudio verificado SIN
    // solicitud aprobada (p. ej. marcado a mano antes de la cola) se puede
    // des-verificar desde aquí. Sin <form> anidado: la ficha ya es un form.
    // ---------------------------------------------------------------
    const detail = { box: null };

    function detailRevokeHtml(studioId) {
        return '<details class="bsv-revoke bsv-sd-revoke-details"><summary>Retirar el sello de verificado</summary>'
            + '<div class="bsv-sd-revoke-body" data-bsv-sd-revoke="' + esc(studioId) + '">'
            + '<label class="bsv-label" for="bsv-sd-revoke-note">Motivo (lo recibe el estudio)</label>'
            + '<textarea id="bsv-sd-revoke-note" name="note" rows="2" maxlength="' + NOTE_MAX + '"></textarea>'
            + '<p class="bsv-error" role="alert" hidden></p>'
            + '<div class="bsv-actions"><button type="button" class="btn btn-danger btn-sm" data-bsv-sd-revoke-submit><i class="fa-solid fa-ban" aria-hidden="true"></i> Retirar sello</button></div>'
            + '</div></details>';
    }

    function syncStudioDetailRevoke() {
        const d = doc();
        const box = detail.box;
        if (!d || !box) return;
        const idEl = d.getElementById('sd-id');
        const verified = d.getElementById('sd-is-verified');
        const studioId = idEl ? String(idEl.value || '').trim() : '';
        if (!verified || !verified.checked || !UUID_RE.test(studioId)) {
            box.hidden = true;
            box.innerHTML = '';
            delete box.dataset.studioId;
            return;
        }
        if (box.dataset.studioId === studioId && !box.hidden) return;
        box.dataset.studioId = studioId;
        box.innerHTML = detailRevokeHtml(studioId);
        box.hidden = false;
    }

    function initStudioDetailRevoke() {
        const d = doc();
        const verified = d && d.getElementById('sd-is-verified');
        const badges = d && d.getElementById('sd-badges');
        if (!verified || !badges || detail.box) return;
        const group = verified.closest('.form-group') || verified.parentNode;
        detail.box = d.createElement('div');
        detail.box.className = 'bsv-sd-revoke';
        detail.box.hidden = true;
        group.appendChild(detail.box);
        detail.box.addEventListener('click', async event => {
            const button = event.target.closest('[data-bsv-sd-revoke-submit]');
            if (!button) return;
            event.preventDefault();
            const body = button.closest('[data-bsv-sd-revoke]');
            if (!body) return;
            button.disabled = true;
            const ok = await revokeStudio(body, body.dataset.bsvSdRevoke, ADMIN_ENDPOINT);
            button.disabled = false;
            if (ok && typeof root.reloadStudioDetail === 'function') root.reloadStudioDetail();
        });
        // admin.js pinta las insignias y, en el mismo tick, carga el toggle.
        if (typeof root.MutationObserver === 'function') {
            new root.MutationObserver(syncStudioDetailRevoke).observe(badges, { childList: true });
        }
    }

    function wire(el) {
        el.addEventListener('change', event => {
            if (event.target && event.target.id === 'bsv-status') {
                state.status = normalizeStatus(event.target.value);
                load();
            }
            const igForm = event.target && event.target.name === 'confirm_instagram' && event.target.closest('[data-bsv-decide]');
            if (igForm) { formError(igForm, ''); syncApprove(igForm); }
        });
        el.addEventListener('click', event => {
            const button = event.target.closest('[data-bsv-action]');
            if (!button) return;
            if (button.dataset.bsvAction === 'refresh') load();
            if (button.dataset.bsvAction === 'docs') showDocs(button);
        });
        el.addEventListener('submit', event => {
            const decideForm = event.target.closest('[data-bsv-decide]');
            const revokeForm = event.target.closest('[data-bsv-revoke]');
            if (!decideForm && !revokeForm) return;
            event.preventDefault();
            if (decideForm) {
                const submitter = event.submitter || decideForm.querySelector('[type="submit"]');
                decide(decideForm, submitter && submitter.value === 'reject' ? 'reject' : 'approve');
            } else {
                revoke(revokeForm);
            }
        });
    }

    function injectStyles() {
        const d = doc();
        if (!d || d.getElementById(STYLE_ID)) return;
        const style = d.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.bsv-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}',
            '.bsv-toolbar .filter-group{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
            '.bsv-list{display:grid;gap:16px;margin-top:16px}',
            '.bsv-card{background:var(--surface-color,transparent);border:1px solid var(--border-color,rgba(127,127,127,.35));border-radius:var(--radius-md,0);padding:20px;display:grid;gap:14px;min-width:0}',
            '.bsv-card-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}',
            '.bsv-card h3{margin:0;font-size:18px}.bsv-card h3 a{color:var(--text-primary,inherit)}',
            '.bsv-card h4{margin:0 0 6px;font-size:13px;color:var(--text-secondary,inherit);text-transform:uppercase;letter-spacing:.04em}',
            '.bsv-muted{color:var(--text-muted,inherit);font-size:13px;margin:2px 0 0}',
            '.bsv-ok{color:var(--success-color,#1E9F74)}',
            '.bsv-chips{display:flex;flex-wrap:wrap;gap:6px}',
            '.bsv-chip{padding:3px 8px;border:1px solid var(--border-color,rgba(127,127,127,.35));border-radius:999px;font-size:12px;color:var(--text-secondary,inherit)}',
            '.bsv-dl{display:grid;grid-template-columns:minmax(140px,220px) minmax(0,1fr);gap:8px 16px;margin:0}',
            '.bsv-dl dt{color:var(--text-secondary,inherit);font-size:13px}.bsv-dl dd{margin:0;overflow-wrap:anywhere}',
            '.bsv-dl a,.bsv-docs a{color:var(--primary-color,inherit)}',
            '.bsv-docs{margin:0 0 8px;padding-left:18px;display:grid;gap:4px}',
            '.bsv-decide,.bsv-revoke form{display:grid;gap:8px;border-top:1px solid var(--border-color,rgba(127,127,127,.35));padding-top:14px}',
            '.bsv-decide textarea,.bsv-revoke textarea{width:100%;background:var(--bg-color,transparent);color:var(--text-primary,inherit);border:1px solid var(--border-color,rgba(127,127,127,.35));border-radius:var(--radius-sm,0);padding:10px;font:inherit}',
            '.bsv-label{font-size:13px;color:var(--text-secondary,inherit)}',
            '.bsv-check{display:flex;gap:8px;align-items:center;font-size:14px}',
            '.bsv-actions{display:flex;flex-wrap:wrap;gap:8px}',
            '.bsv-error{color:var(--error-color,#C82D16);margin:0;font-size:13px}',
            '.bsv-revoke summary{cursor:pointer;color:var(--text-secondary,inherit);font-size:13px}',
            '.bsv-sd-revoke{margin-top:8px}.bsv-sd-revoke-body{display:grid;gap:8px;padding-top:10px}',
            '.bsv-sd-revoke textarea{width:100%;background:var(--bg-color,transparent);color:var(--text-primary,inherit);border:1px solid var(--border-color,rgba(127,127,127,.35));border-radius:var(--radius-sm,0);padding:10px;font:inherit}',
            '.bsv-status--pending{color:var(--warning-color,#A86A00)}.bsv-status--approved{color:var(--success-color,#1E9F74)}.bsv-status--rejected{color:var(--error-color,#C82D16)}',
            '#bsv-nav-count{margin-left:auto;background:var(--primary-color,inherit);color:#000;border-radius:999px;padding:0 7px;font-size:12px;font-weight:700}',
            '@media (max-width:700px){.bsv-dl{grid-template-columns:minmax(0,1fr)}.bsv-dl dt{margin-top:6px}}'
        ].join('\n');
        d.head.appendChild(style);
    }

    function setTitle() {
        const d = doc();
        const title = d && d.getElementById('section-title');
        if (title) title.textContent = 'Verificaciones de estudios';
    }

    function init() {
        const d = doc();
        const el = mountEl();
        const section = d && d.getElementById(SECTION_ID);
        if (!el || !section) return;
        injectStyles();
        initStudioDetailRevoke();
        wire(el);
        render();
        const onActive = () => {
            if (section.classList.contains('active')) { setTitle(); load(); }
        };
        if (typeof root.MutationObserver === 'function') {
            new root.MutationObserver(onActive).observe(section, { attributes: true, attributeFilter: ['class'] });
        }
        // Contador de pendientes en la barra lateral (best effort, sin bloquear).
        root.setTimeout(() => { if (!section.classList.contains('active')) load(); }, 2000);
    }

    // ---------------------------------------------------------------
    // Panel de soporte (/support/dashboard): pestaña "ESTUDIOS" al lado de
    // VERIFICACIONES, con el mismo patrón modular que las otras pestañas
    // (encadena window.switchTab y oculta lo que sigue a .tab-navigation).
    // ---------------------------------------------------------------
    const support = { active: false, hidden: new Map(), panel: null, previousSwitch: null };

    function supportSiblings() {
        const nav = doc().querySelector('.tab-navigation');
        const out = [];
        let el = nav ? nav.nextElementSibling : null;
        while (el) { out.push(el); el = el.nextElementSibling; }
        return out;
    }
    function supportMarkActive() {
        doc().querySelectorAll('.tab-btn, .nav-menu-item').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === SUPPORT_TAB);
        });
    }
    function supportEnter() {
        supportSiblings().forEach(el => {
            if (el === support.panel) return;
            if (!support.hidden.has(el)) support.hidden.set(el, el.style.display || '');
            el.style.display = 'none';
        });
        support.panel.hidden = false;
        support.active = true;
        supportMarkActive();
        load();
    }
    function supportLeave() {
        if (!support.active) return;
        support.active = false;
        support.panel.hidden = true;
        support.hidden.forEach((display, el) => { el.style.display = display; });
        support.hidden.clear();
    }
    function supportTabButton(template, tag) {
        const el = doc().createElement(tag);
        el.className = template.className.replace(/\bactive\b/g, '').trim();
        el.dataset.tab = SUPPORT_TAB;
        if (tag === 'a') el.href = '#';
        else el.type = 'button';
        el.textContent = 'ESTUDIOS';
        const count = doc().createElement('span');
        count.className = 'bsv-support-count';
        count.hidden = true;
        el.appendChild(count);
        return el;
    }
    function initSupport() {
        const d = doc();
        const table = d.getElementById('table-container');
        const tabs = d.querySelector('.tab-navigation');
        if (!table || !tabs || root.__bsvSupportBooted) return false;
        root.__bsvSupportBooted = true;
        state.endpoint = SUPPORT_ENDPOINT;
        // Botones (pestaña y menú lateral) junto a VERIFICACIONES.
        const tabTemplate = d.querySelector('.tab-btn[data-tab="verificacion"]') || d.querySelector('.tab-btn');
        const navTemplate = d.querySelector('.nav-menu-item[data-tab="verificacion"]') || d.querySelector('.nav-menu-item');
        if (tabTemplate) tabTemplate.insertAdjacentElement('afterend', supportTabButton(tabTemplate, 'button'));
        if (navTemplate) navTemplate.insertAdjacentElement('afterend', supportTabButton(navTemplate, 'a'));
        // Panel
        support.panel = d.createElement('section');
        support.panel.className = 'bsv-support-panel';
        support.panel.hidden = true;
        support.panel.setAttribute('aria-label', 'Verificaciones de estudios');
        support.panel.innerHTML = '<h2 class="bsv-support-title">Verificaciones de estudios</h2><div class="bsv-support-root"></div>';
        table.insertAdjacentElement('afterend', support.panel);
        state.mount = support.panel.querySelector('.bsv-support-root');
        injectStyles();
        wire(state.mount);
        // Encadena switchTab y escucha los clics de pestañas (captura).
        support.previousSwitch = typeof root.switchTab === 'function' ? root.switchTab : null;
        root.switchTab = function (tabName) {
            if (tabName === SUPPORT_TAB) { supportEnter(); return undefined; }
            supportLeave();
            return support.previousSwitch ? support.previousSwitch.apply(this, arguments) : undefined;
        };
        root.addEventListener('click', event => {
            const trigger = event.target && event.target.closest ? event.target.closest('[data-tab]') : null;
            if (!trigger || !(trigger.classList.contains('tab-btn') || trigger.classList.contains('nav-menu-item'))) return;
            if (trigger.dataset.tab === SUPPORT_TAB) {
                event.preventDefault();
                root.setTimeout(() => root.switchTab(SUPPORT_TAB), 0);
            } else {
                supportLeave();
            }
        }, true);
        return true;
    }

    function autoInit() {
        const d = doc();
        if (!d) return;
        const start = () => { if (!initSupport()) init(); };
        if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start);
        else start();
    }

    return { autoInit, cardHtml, listHtml, docsHtml, detailRevokeHtml, validateDecision, safeUrl, normalizeStatus, studioIgState, _state: state, _internal: { canApprove } };
});
