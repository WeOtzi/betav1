// ============================================
// We Ötzi — Backoffice: vendors Supplies
// window.WeOtziBackofficeSupplies · también exportable a Node (tests).
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Backoffice".
//   - Lista los vendors (GET /api/admin/supply-vendors, los más nuevos primero;
//     acá se ordenan "En revisión" → verificados → inactivos).
//   - Verificar / quitar verificación y activar / desactivar →
//     PATCH /api/admin/supply-vendors/:id con {is_verified} o {is_active}
//     (booleanos; el servidor ignora cualquier otra clave).
//   - Un vendor es visible para los estudios solo si está activo y verificado
//     (RLS de supply_vendors): los textos de confirmación lo explican.
//   - Auth: el mismo Bearer de la sesión de Supabase que usa admin.js
//     (_getApifyAuthHeaders / _fetchAdminJson).
//   - Sin la migración M5 aplicada el servidor responde {vendors: [],
//     migration_pending: true}: la lista queda vacía con el aviso estándar.
//
// Montaje: busca #bo-supply-vendors-root dentro de su .content-section y carga
// cada vez que la sección se activa (MutationObserver sobre la clase `active`
// que alterna showSection de admin.js). Nada se resuelve en el nivel superior
// salvo window/globalThis/module.
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) {
        window.WeOtziBackofficeSupplies = api;
        api.autoInit();
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const ENDPOINT = '/api/admin/supply-vendors';
    const ROOT_ID = 'bo-supply-vendors-root';
    const STYLE_ID = 'bo-supplies-styles';
    const PENDING_KEY = 'supply_vendors';
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const FLAG_KEYS = ['is_verified', 'is_active'];
    const FILTERS = ['all', 'review', 'verified', 'inactive'];
    const STATUS_RANK = { unverified: 0, verified: 1, inactive: 2 };
    const PREFETCH_DELAY_MS = 1800;
    const PREFETCH_RETRY_MS = 4000;
    const PREFETCH_RETRIES = 3;

    const VENDOR_STATUS_LABELS = { verified: 'Verificado', unverified: 'En revisión', inactive: 'Inactivo' };
    const FILTER_LABELS = { all: 'Todos', review: 'En revisión', verified: 'Verificados', inactive: 'Inactivos' };
    const ACTIONS = {
        verify: { is_verified: true },
        unverify: { is_verified: false },
        activate: { is_active: true },
        deactivate: { is_active: false }
    };

    const MISSING_SCHEMA_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';
    const NETWORK_MESSAGE = 'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.';
    const NO_SESSION_MESSAGE = 'No hay sesión de superadmin activa. Iniciá sesión de nuevo en /backoffice/login.';
    const NOT_DEPLOYED_MESSAGE = 'El servidor todavía no tiene esta función: actualizá el deploy.';
    const GENERIC_MESSAGE = 'No pudimos completar la acción. Intentá de nuevo.';

    const state = {
        vendors: [], loading: false, loaded: false, error: null, migrationPending: false, seq: 0,
        filters: { search: '', status: 'all' }
    };

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
    function fmtPercent(n) {
        const k = kit();
        if (k && typeof k.fmtPercent === 'function') return k.fmtPercent(n);
        const v = Number(n);
        return n == null || n === '' || !Number.isFinite(v) ? '—' : String(v) + ' %';
    }
    function vendorStatusLabel(status) {
        const k = kit();
        const dict = k && k.LABELS && k.LABELS.vendorStatus;
        return (dict && dict[status]) || VENDOR_STATUS_LABELS[status] || 'En revisión';
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

    function describeFailure(res) {
        if (!res) return GENERIC_MESSAGE;
        if (res.error === 'no_session') return NO_SESSION_MESSAGE;
        if (res.error === 'network') return NETWORK_MESSAGE;
        const data = res.data && typeof res.data === 'object' ? res.data : {};
        if (data.migration_pending) return MISSING_SCHEMA_MESSAGE;
        const msg = typeof data.error === 'string' ? data.error.trim() : '';
        if (res.status === 401) return NO_SESSION_MESSAGE;
        if (res.status === 403) return msg || 'No tenés permiso para esta acción.';
        if (res.status === 404 && !msg) return NOT_DEPLOYED_MESSAGE;
        return msg || GENERIC_MESSAGE;
    }

    // -------------------------------------------------------------
    // Datos
    // -------------------------------------------------------------
    function normalizeVendors(payload) {
        const list = payload && Array.isArray(payload.vendors) ? payload.vendors : [];
        return list.filter(v => v && typeof v === 'object' && v.id);
    }

    // inactive (is_active=false) | verified | unverified ("En revisión").
    function vendorStatus(vendor) {
        const v = vendor || {};
        if (v.is_active === false) return 'inactive';
        return v.is_verified === true ? 'verified' : 'unverified';
    }

    function isVisibleToStudios(vendor) {
        return !!vendor && vendor.is_active !== false && vendor.is_verified === true;
    }

    function vendorCounts(vendors) {
        const list = Array.isArray(vendors) ? vendors : [];
        const counts = { total: list.length, review: 0, verified: 0, inactive: 0 };
        list.forEach(v => {
            const s = vendorStatus(v);
            if (s === 'unverified') counts.review += 1;
            else if (s === 'verified') counts.verified += 1;
            else counts.inactive += 1;
        });
        return counts;
    }

    // Filtro + orden estable: En revisión → Verificados → Inactivos.
    function filterVendors(vendors, filters) {
        const list = Array.isArray(vendors) ? vendors : [];
        const f = filters || {};
        const status = FILTERS.includes(f.status) ? f.status : 'all';
        const term = String(f.search || '').trim().toLowerCase();
        return list
            .map((v, i) => ({ v, i }))
            .filter(({ v }) => {
                const s = vendorStatus(v);
                if (status === 'review' && s !== 'unverified') return false;
                if (status === 'verified' && s !== 'verified') return false;
                if (status === 'inactive' && s !== 'inactive') return false;
                if (!term) return true;
                const haystack = [v.name, v.slug, v.email, v.city, v.country, v.currency]
                    .filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(term);
            })
            .sort((a, b) => (STATUS_RANK[vendorStatus(a.v)] - STATUS_RANK[vendorStatus(b.v)]) || (a.i - b.i))
            .map(({ v }) => v);
    }

    // Solo is_verified / is_active, y solo booleanos.
    function buildPatchRequest(vendorId, patch) {
        const id = String(vendorId || '').trim();
        if (!UUID_RE.test(id)) throw new Error('ID de vendor inválido.');
        const body = {};
        FLAG_KEYS.forEach(key => {
            if (!patch || !Object.prototype.hasOwnProperty.call(patch, key)) return;
            if (typeof patch[key] !== 'boolean') throw new Error(key + ' debe ser true o false.');
            body[key] = patch[key];
        });
        if (!Object.keys(body).length) throw new Error('No hay cambios para guardar.');
        return {
            url: ENDPOINT + '/' + encodeURIComponent(id),
            options: { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        };
    }

    // PATCH de los flags. Nunca lanza: {ok, status, data, message, vendor}.
    async function setVendorFlags(vendorId, patch, deps) {
        let req;
        try {
            req = buildPatchRequest(vendorId, patch);
        } catch (err) {
            return { ok: false, status: 0, data: null, vendor: null, message: err.message };
        }
        const res = await fetchAdminJson(req.url, req.options, deps);
        const vendor = res.ok && res.data && res.data.vendor && typeof res.data.vendor === 'object' ? res.data.vendor : null;
        return Object.assign({}, res, { vendor, message: res.ok ? null : describeFailure(res) });
    }

    // Texto de confirmación (null = no hace falta confirmar).
    function confirmText(vendor, action) {
        const name = textOrNull(vendor && vendor.name) || 'este vendor';
        if (action === 'verify') {
            return vendor && vendor.profile_complete === false
                ? name + ' todavía no completó su perfil. ¿Verificarlo igual? Si está activo, los estudios van a ver su catálogo y podrán hacerle pedidos.'
                : '¿Verificar a ' + name + '? Si está activo, los estudios van a ver su catálogo y podrán hacerle pedidos.';
        }
        if (action === 'unverify') return '¿Quitar la verificación de ' + name + '? Los estudios dejan de ver su catálogo hasta que lo vuelvas a verificar.';
        if (action === 'deactivate') return '¿Desactivar a ' + name + '? Su catálogo deja de estar visible para los estudios.';
        return null;
    }

    function successMessage(vendor, action) {
        const v = vendor || {};
        const name = textOrNull(v.name) || 'El vendor';
        if (action === 'verify') {
            return v.is_active === false
                ? name + ' quedó verificado. Activalo para que los estudios vean su catálogo.'
                : name + ' quedó verificado: los estudios ya ven su catálogo.';
        }
        if (action === 'unverify') return name + ' volvió a revisión: los estudios ya no ven su catálogo.';
        if (action === 'activate') {
            return v.is_verified === true
                ? name + ' quedó activo: los estudios ya ven su catálogo.'
                : name + ' quedó activo. Verificalo para que los estudios vean su catálogo.';
        }
        if (action === 'deactivate') return name + ' quedó inactivo: los estudios ya no ven su catálogo.';
        return 'Cambios guardados.';
    }

    // -------------------------------------------------------------
    // Render
    // -------------------------------------------------------------
    function badge(text, cls) {
        return '<span class="status-badge ' + esc(cls) + '">' + esc(text) + '</span>';
    }

    function vendorRowHtml(vendor) {
        const v = vendor || {};
        const id = esc(v.id);
        const name = textOrNull(v.name) || 'Vendor sin nombre';
        const logo = safeUrl(v.logo_image);
        const avatar = logo ? '<img src="' + esc(logo) + '" alt="">' : esc(initials(name));
        const location = [textOrNull(v.city), textOrNull(v.country)].filter(Boolean).join(', ');
        const status = vendorStatus(v);
        const verification = v.is_verified === true ? badge(vendorStatusLabel('verified'), 'verified') : badge(vendorStatusLabel('unverified'), 'pending');
        const activity = v.is_active === false ? badge(vendorStatusLabel('inactive'), 'error') : badge('Activo', 'success');
        const flags = [
            v.profile_complete === false ? badge('Perfil incompleto', 'none') : '',
            isVisibleToStudios(v) ? '' : '<span class="bo-muted bo-block">No visible para los estudios</span>'
        ].filter(Boolean).join('');
        const account = [
            textOrNull(v.email)
                ? '<span title="' + esc(v.email) + '"><i class="fa-solid fa-envelope" aria-hidden="true"></i> ' + esc(v.email) + '</span>'
                : '<span class="bo-muted">Sin email de acceso</span>',
            v.user_id ? '' : badge('Sin cuenta vinculada', 'none')
        ].filter(Boolean).join('');
        const verifyBtn = v.is_verified === true
            ? '<button type="button" class="btn btn-secondary btn-sm" data-vendor-action="unverify" data-vendor-id="' + id + '">Quitar verificación</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-vendor-action="verify" data-vendor-id="' + id + '"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verificar</button>';
        const activeBtn = v.is_active === false
            ? '<button type="button" class="btn btn-secondary btn-sm" data-vendor-action="activate" data-vendor-id="' + id + '">Activar</button>'
            : '<button type="button" class="btn btn-secondary btn-sm danger-hover" data-vendor-action="deactivate" data-vendor-id="' + id + '">Desactivar</button>';
        return '<tr data-vendor-row="' + id + '" data-vendor-status="' + esc(status) + '">'
            + '<td><div class="artist-cell-identity"><span class="avatar">' + avatar + '</span>'
            + '<div class="artist-meta"><strong title="' + esc(name) + '">' + esc(name) + '</strong>'
            + '<small title="' + esc(v.slug || '') + '">' + (v.slug ? '/' + esc(v.slug) : '—') + '</small></div></div></td>'
            + '<td><div class="artist-cell-contact">' + account + '</div></td>'
            + '<td><span class="truncate-text" title="' + esc(location) + '">' + esc(location || '—') + '</span></td>'
            + '<td><span class="bo-block">' + esc(textOrNull(v.currency) || '—') + '</span>'
            + '<small class="bo-muted">We Ötzi: ' + esc(fmtPercent(v.platform_discount_pct)) + '</small></td>'
            + '<td><div class="bo-vendor-badges">' + verification + ' ' + activity + '</div>' + flags + '</td>'
            + '<td>' + esc(fmtDate(v.created_at)) + '</td>'
            + '<td><div class="action-buttons bo-vendor-actions">' + verifyBtn + activeBtn + '</div></td>'
            + '</tr>';
    }

    function emptyHtml(icon, title, desc) {
        return '<div class="empty-state-box"><i class="fa-solid ' + esc(icon) + '" aria-hidden="true"></i>'
            + '<span class="empty-title">' + esc(title) + '</span>'
            + (desc ? '<span class="empty-desc">' + esc(desc) + '</span>' : '') + '</div>';
    }

    // HTML del listado según el estado ({vendors, filters, loading, error, migrationPending}).
    function renderVendorsHtml(input) {
        const s = input || {};
        if (s.loading) {
            return '<div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando vendors…</span></div>';
        }
        if (s.error) {
            return '<div class="error-state-box"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'
                + '<span class="error-title">No pudimos cargar los vendors</span>'
                + '<span class="error-desc">' + esc(s.error) + '</span>'
                + '<button type="button" class="btn btn-secondary btn-sm" data-vendors-action="reload">Reintentar</button></div>';
        }
        if (s.migrationPending) return emptyHtml('fa-database', 'Supplies todavía no disponible', MISSING_SCHEMA_MESSAGE);
        const all = Array.isArray(s.vendors) ? s.vendors : [];
        if (!all.length) {
            return emptyHtml('fa-boxes-stacked', 'Todavía no hay vendors Supplies',
                'Cuando una tienda de insumos se registre en /supplies/register, aparece acá para verificarla.');
        }
        const rows = filterVendors(all, s.filters);
        if (!rows.length) return emptyHtml('fa-filter', 'Ningún vendor coincide con el filtro', 'Probá con otra búsqueda o cambiá el estado.');
        return '<div class="table-container bo-table-scroll"><table class="data-table data-table-compact bo-vendors-table">'
            + '<thead><tr><th scope="col">Vendor</th><th scope="col">Cuenta</th><th scope="col">Ubicación</th>'
            + '<th scope="col">Condiciones</th><th scope="col">Estado</th><th scope="col">Alta</th><th scope="col">Acciones</th></tr></thead>'
            + '<tbody>' + rows.map(vendorRowHtml).join('') + '</tbody></table></div>';
    }

    function metaHtml(vendors) {
        const c = vendorCounts(vendors);
        if (!c.total) return '';
        return '<span><strong>' + c.total + '</strong> vendors</span>'
            + '<span><strong>' + c.review + '</strong> en revisión</span>'
            + '<span><strong>' + c.verified + '</strong> verificados</span>'
            + '<span><strong>' + c.inactive + '</strong> inactivos</span>';
    }

    function shellHtml() {
        const options = FILTERS.map(f => '<option value="' + f + '"' + (f === state.filters.status ? ' selected' : '') + '>'
            + esc(FILTER_LABELS[f]) + '</option>').join('');
        return '<div class="bo-review-block" aria-labelledby="bo-vendors-title">'
            + '<div class="bo-review-head"><div>'
            + '<h3 id="bo-vendors-title" class="bo-review-title"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i> Vendors Supplies</h3>'
            + '<p class="section-description">Tiendas de insumos. Los estudios ven el catálogo de un vendor solo si está verificado y activo.</p>'
            + '</div></div>'
            + '<div class="section-toolbar bo-vendors-toolbar">'
            + '<div class="search-box"><i class="fa-solid fa-search" aria-hidden="true"></i>'
            + '<input type="search" data-vendors-search placeholder="Buscar por nombre, slug, email o ciudad" aria-label="Buscar vendors"></div>'
            + '<div class="filter-group"><select data-vendors-filter aria-label="Filtrar por estado">' + options + '</select>'
            + '<button type="button" class="btn btn-secondary" data-vendors-action="reload"><i class="fa-solid fa-refresh" aria-hidden="true"></i> Actualizar</button></div>'
            + '</div>'
            + '<div class="artists-table-meta" data-vendors-meta aria-live="polite"></div>'
            + '<div data-vendors-list aria-live="polite"></div></div>';
    }

    const STYLES = [
        '.bo-review-block{margin-bottom:36px}',
        '.bo-review-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:12px}',
        '.bo-review-title{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:1rem;font-weight:600;color:var(--text-primary)}',
        '.bo-table-scroll{overflow-x:auto}',
        '.bo-muted{color:var(--text-muted);font-size:.8rem}',
        '.bo-block{display:block}',
        '.bo-vendors-toolbar{margin-bottom:12px}',
        '.bo-vendor-badges{display:flex;flex-wrap:wrap;gap:4px}',
        '.bo-vendor-actions{gap:6px;flex-wrap:wrap}',
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
    // Pendientes en la entrada del menú (compartido con backoffice-studio-claims.js)
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
    // UI
    // -------------------------------------------------------------
    function toast(message, type) {
        // showToast de admin.js inserta HTML: siempre le pasamos texto escapado.
        if (root && typeof root.showToast === 'function') return root.showToast(esc(message), type || 'info');
        const k = kit();
        if (k && typeof k.toast === 'function') return k.toast(message, type === 'error' ? 'danger' : (type || 'info'));
        if (typeof console !== 'undefined') console.log('[backoffice-supplies]', message);
        return null;
    }

    function askConfirm(text) {
        if (!text) return true;
        if (root && typeof root.confirm === 'function') return !!root.confirm(text);
        return false;
    }

    function getRootEl() {
        const doc = getDoc();
        return doc && typeof doc.getElementById === 'function' ? doc.getElementById(ROOT_ID) : null;
    }

    function renderList() {
        const el = getRootEl();
        if (!el) return;
        const list = el.querySelector('[data-vendors-list]');
        const meta = el.querySelector('[data-vendors-meta]');
        if (list) {
            list.setAttribute('aria-busy', state.loading ? 'true' : 'false');
            list.innerHTML = renderVendorsHtml(state);
        }
        if (meta) meta.innerHTML = state.loading || state.error ? '' : metaHtml(state.vendors);
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
            state.vendors = normalizeVendors(res.data);
            state.error = null;
        } else {
            state.vendors = [];
            state.error = state.migrationPending ? null : describeFailure(res);
        }
        renderList();
        reportPending(PENDING_KEY, vendorCounts(state.vendors).review);
        return state;
    }

    function setRowBusy(id, busy) {
        const el = getRootEl();
        if (!el) return;
        el.querySelectorAll('[data-vendor-id]').forEach(btn => {
            if (btn.getAttribute('data-vendor-id') === String(id)) btn.disabled = !!busy;
        });
    }

    async function runAction(vendorId, action, deps) {
        const patch = ACTIONS[action];
        const vendor = state.vendors.find(v => String(v.id) === String(vendorId));
        if (!patch || !vendor) return null;
        if (!askConfirm(confirmText(vendor, action))) return null;
        setRowBusy(vendorId, true);
        const res = await setVendorFlags(vendorId, patch, deps);
        if (res.ok) {
            const merged = Object.assign({}, vendor, patch, res.vendor || {});
            state.vendors = state.vendors.map(v => (String(v.id) === String(vendorId) ? merged : v));
            renderList();
            reportPending(PENDING_KEY, vendorCounts(state.vendors).review);
            toast(successMessage(merged, action), 'success');
        } else {
            setRowBusy(vendorId, false);
            toast(res.message || GENERIC_MESSAGE, 'error');
            if (res.status === 404) await load(deps);
        }
        return res;
    }

    let searchTimer = null;
    function onRootInput(e) {
        const t = e.target;
        if (!t || !t.matches) return;
        if (t.matches('[data-vendors-search]')) {
            const value = t.value;
            const ct = typeof clearTimeout === 'function' ? clearTimeout : (root && root.clearTimeout);
            if (searchTimer != null && typeof ct === 'function') ct(searchTimer);
            searchTimer = later(() => { state.filters.search = value; renderList(); }, 200);
        } else if (t.matches('[data-vendors-filter]')) {
            state.filters.status = FILTERS.includes(t.value) ? t.value : 'all';
            renderList();
        }
    }

    function onRootClick(e) {
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        if (t.closest('[data-vendors-action="reload"]')) {
            e.preventDefault();
            load();
            return;
        }
        const btn = t.closest('[data-vendor-action]');
        if (btn && !btn.disabled) {
            e.preventDefault();
            runAction(btn.getAttribute('data-vendor-id'), btn.getAttribute('data-vendor-action'));
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
        el.addEventListener('input', onRootInput);
        el.addEventListener('change', onRootInput);
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
        ACTIONS,
        // flujo
        autoInit, mount, load, setVendorFlags, runAction, prefetch,
        getState: () => state,
        // puras (tests)
        normalizeVendors, vendorStatus, isVisibleToStudios, vendorCounts, filterVendors, buildPatchRequest,
        describeFailure, confirmText, successMessage, renderVendorsHtml, vendorRowHtml, metaHtml,
        fetchAdminJson, reportPending, becameActive, MISSING_SCHEMA_MESSAGE, NO_SESSION_MESSAGE
    };
});
