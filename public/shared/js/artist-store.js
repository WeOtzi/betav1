// ============================================
// Store del artista (DS Bauhaus) — /artist/store/
// Contrato: docs/plans/2026-10-30-store-artista.md (§8.4 y §8.7).
// Gestión de la Store: diseños con licencia y merch (editor en drawer con
// checklist de publicación en vivo), pedidos recibidos (confirmar pago,
// envío con tracking, cancelar, reembolsar) y ajustes del vendedor.
// Datos SOLO vía window.WeotziData.Store y WeotziData.Artists; lógica pura en
// WeotziStoreModel y marca de agua en WeotziStoreWatermark.
//
// Estados direccionables:
//   ?tab=disenos|merch|pedidos|ajustes
//   ?nuevo=diseno|merch            → editor vacío
//   ?editar=<id>                   → editor del producto
//   ?pedido=<id>                   → detalle del pedido
//   ?pedido=<id>&modal=confirmar-pago
// ============================================

(function () {
    'use strict';

    const LOGIN_URL = '/artist/login?returnTo=%2Fartist%2Fstore';
    const REGISTER_URL = '/register-artist?returnTo=%2Fartist%2Fstore';
    const DASHBOARD_URL = '/artist/dashboard';
    const SELLER_TYPE = 'artist';
    const TABS = ['disenos', 'merch', 'pedidos', 'ajustes'];
    const TAB_KIND = { disenos: 'design', merch: 'merch' };
    const NEW_KIND = { diseno: 'design', merch: 'merch' };
    const KIND_NEW_PARAM = { design: 'diseno', merch: 'merch' };
    const MAX_IMAGES = 8;
    const CONFIG_TIMEOUT_MS = 6000;
    // Tope de filas de WeotziData.Store.listSellerOrders.
    const SELLER_ORDERS_LIMIT = 300;

    // Monedas del catálogo de currency-utils (la base valida contra currencies).
    const CURRENCIES = [
        ['USD', 'Dólar estadounidense'], ['ARS', 'Peso argentino'], ['EUR', 'Euro'], ['MXN', 'Peso mexicano'],
        ['CLP', 'Peso chileno'], ['COP', 'Peso colombiano'], ['UYU', 'Peso uruguayo'], ['PEN', 'Sol peruano'],
        ['BRL', 'Real brasileño']
    ];

    // Países de envío (ISO-2): Latinoamérica, España y Estados Unidos.
    const COUNTRIES = [
        ['AR', 'Argentina'], ['BO', 'Bolivia'], ['BR', 'Brasil'], ['CL', 'Chile'], ['CO', 'Colombia'],
        ['CR', 'Costa Rica'], ['CU', 'Cuba'], ['EC', 'Ecuador'], ['SV', 'El Salvador'], ['GT', 'Guatemala'],
        ['HN', 'Honduras'], ['MX', 'México'], ['NI', 'Nicaragua'], ['PA', 'Panamá'], ['PY', 'Paraguay'],
        ['PE', 'Perú'], ['PR', 'Puerto Rico'], ['DO', 'República Dominicana'], ['UY', 'Uruguay'],
        ['VE', 'Venezuela'], ['ES', 'España'], ['US', 'Estados Unidos']
    ];
    const COUNTRY_NAMES = Object.fromEntries(COUNTRIES);

    const ORDER_FILTERS = [
        { key: 'por_confirmar', label: 'Por confirmar pago', empty: 'No tenés pagos por confirmar.', match: (o) => o.status === 'pending_payment' },
        { key: 'por_preparar', label: 'Por preparar', empty: 'No hay pedidos por preparar.', match: (o) => o.status === 'paid' && ['unfulfilled', 'preparing'].includes(o.fulfillment_status || 'unfulfilled') },
        { key: 'enviados', label: 'Enviados', empty: 'No hay pedidos en camino ni listos para retirar.', match: (o) => o.status === 'paid' && ['shipped', 'ready_for_pickup'].includes(o.fulfillment_status) },
        { key: 'completados', label: 'Completados', empty: 'Todavía no completaste pedidos.', match: (o) => o.status === 'fulfilled' },
        { key: 'cancelados', label: 'Cancelados', empty: 'No hay pedidos cancelados, vencidos ni reembolsados.', match: (o) => ['cancelled', 'expired', 'refunded'].includes(o.status) }
    ];

    const PAYMENT_STATUS = { pending: 'Pendiente', succeeded: 'Confirmado', failed: 'Fallido', refunded: 'Reembolsado', duplicate: 'Duplicado' };
    const COLLECTOR_COPY = {
        seller: 'Te paga directo a vos con tus instrucciones. Vos confirmás el pago.',
        platform: 'Cobra We Ötzi. Soporte confirma el pago cuando lo recibe.',
        provider: 'Cobro con un proveedor de pagos. Se confirma de forma automática.'
    };
    const MIME_LABELS = {
        'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/tiff': 'TIFF', 'application/pdf': 'PDF',
        'image/vnd.adobe.photoshop': 'PSD', 'application/postscript': 'AI o EPS', 'application/zip': 'ZIP o Procreate'
    };
    const FILE_SLOTS = {
        original: {
            label: 'Original',
            accept: '.png,.jpg,.jpeg,.webp,.tif,.tiff,.pdf,.psd,.ai,.eps,.procreate,.zip',
            help: 'El archivo a calidad completa. PNG, JPG, WebP, TIFF, PDF, PSD, AI, EPS o Procreate · hasta 50 MB.'
        },
        stencil: {
            label: 'Stencil',
            accept: '.png,.jpg,.jpeg,.webp,.pdf',
            help: 'Listo para imprimir. PNG, JPG, WebP o PDF · hasta 20 MB. Con medidas en cm se puede imprimir a escala real.'
        }
    };

    const FOCUSABLE = [
        'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    // Campos del editor ↔ claves de validateProductDraft.
    const ED_FIELDS = {
        title: 'ast-ed-f-title', description: 'ast-ed-f-description', category: 'ast-ed-f-category',
        tags: 'ast-ed-f-tags', currency: 'ast-ed-f-currency', design_width_cm: 'ast-ed-f-width',
        design_height_cm: 'ast-ed-f-height', design_style: 'ast-ed-f-style', placement_suggestion: 'ast-ed-f-placement',
        price_amount: 'ast-ed-f-price', shipping_price_amount: 'ast-ed-f-ship-price', ships_to_countries: 'ast-ed-countries',
        ships_to_note: 'ast-ed-f-ship-note', pickup_note: 'ast-ed-f-pickup-note', images: 'ast-ed-images-input',
        license_personal_price: 'ast-ed-tier-personal-price', license_artist_price: 'ast-ed-tier-artist-price',
        license_exclusive_price: 'ast-ed-tier-exclusive-price', delivery: 'ast-ed-ship-on'
    };

    // ---------- Estado ----------
    let M = null;          // WeotziStoreModel
    let Store = null;      // WeotziData.Store
    let Watermark = null;  // WeotziStoreWatermark

    const state = {
        client: null,
        session: null,
        uid: null,
        artist: null,
        username: '',
        products: [],
        orders: [],
        settings: null,
        sales: [],
        errors: { products: null, orders: null, settings: null, sales: null },
        tab: 'disenos',
        orderFilter: null,
        orderId: null,
        fulfillmentForm: null,
        paymentOrderId: null,
        editor: null,
        checklistSignature: ''
    };

    const layers = [];
    let confirmResolver = null;
    let variantSeq = 0;

    // ---------- Utilidades ----------
    const $ = (id) => document.getElementById(id);

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function hydrateIcons(root) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') window.WoIcons.hydrate(root || document);
    }

    function appPath(path) {
        return M && typeof M.appPath === 'function' ? M.appPath(path) : path;
    }

    function cssEscape(value) {
        return window.CSS && typeof window.CSS.escape === 'function' ? window.CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
    }

    function val(id) {
        const el = $(id);
        return el ? String(el.value == null ? '' : el.value) : '';
    }

    function setText(id, text) {
        const el = $(id);
        if (el) el.textContent = text == null ? '' : String(text);
    }

    // Para regiones aria-live: cada escritura se anuncia aunque el texto sea
    // el mismo, así que solo se escribe cuando cambia.
    function setLiveText(id, text) {
        const el = $(id);
        const next = text == null ? '' : String(text);
        if (el && el.textContent !== next) el.textContent = next;
    }

    function toInput(value) {
        if (value === null || value === undefined || value === '') return '';
        const n = Number(value);
        return Number.isFinite(n) ? String(n) : String(value);
    }

    function formatBytes(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '';
        if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
        return (Math.round((n / (1024 * 1024)) * 10) / 10).toString().replace('.', ',') + ' MB';
    }

    function mimeLabel(mime, fileName) {
        const type = M ? M.contentTypeFor(fileName, mime) : mime;
        return MIME_LABELS[type] || MIME_LABELS[mime] || 'Archivo';
    }

    function plural(n, one, many) { return n === 1 ? one : many; }

    // Copy en español para cualquier error: código store:* → ERROR_COPY;
    // validaciones del repo o de la marca de agua → su propio mensaje.
    function errorText(err, fallback) {
        const code = M ? M.errorCode(err) : null;
        if (code && M.ERROR_COPY[code]) return M.errorMessage(err);
        if (err && err.validation && err.message) return err.message;
        return M ? M.errorMessage(err, fallback) : (fallback || 'No pudimos completar la acción.');
    }

    // Aviso breve y accesible (role=status) para el resultado de una acción.
    function notify(message, tone = 'info') {
        const toast = $('ast-toast');
        if (!toast || !message) return;
        toast.className = 'ast-toast is-' + tone;
        toast.textContent = message;
        toast.hidden = false;
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.hidden = true; }, tone === 'error' ? 6500 : 4200);
    }

    function setBusy(button, busy, label) {
        if (!button) return;
        if (busy) {
            if (!button.dataset.label) button.dataset.label = button.textContent;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            if (label) button.textContent = label;
        } else {
            button.removeAttribute('aria-busy');
            button.disabled = false;
            if (button.dataset.label) { button.textContent = button.dataset.label; delete button.dataset.label; }
        }
    }

    // Repinta un contenedor sin perder el foco del teclado: si el foco estaba
    // en un control de la lista, vuelve al control equivalente del nuevo HTML.
    function focusKey(el) {
        if (!el || typeof el.hasAttribute !== 'function') return null;
        const parts = ['data-order', 'data-filter', 'data-act', 'data-id', 'data-kind']
            .filter((attr) => el.hasAttribute(attr))
            .map((attr) => '[' + attr + '="' + cssEscape(el.getAttribute(attr)) + '"]');
        return parts.length ? parts.join('') : null;
    }

    function setHtml(container, markup) {
        if (!container) return;
        const active = document.activeElement;
        const key = active && active !== container && container.contains(active) ? focusKey(active) : null;
        container.innerHTML = markup;
        if (!key) return;
        const again = container.querySelector(key);
        if (again) again.focus({ preventScroll: true });
    }

    function showFieldError(inputId, message) {
        const input = $(inputId);
        const error = $(inputId + '-err');
        if (error) { error.textContent = message || ''; error.hidden = !message; }
        if (input && input.matches && input.matches('input, select, textarea')) {
            if (message) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
            input.classList.toggle('wo-input--error', !!message);
        }
    }

    function setParams(changes) {
        const url = new URL(window.location.href);
        Object.keys(changes).forEach((key) => {
            const v = changes[key];
            if (v === null || v === undefined || v === '') url.searchParams.delete(key);
            else url.searchParams.set(key, String(v));
        });
        const next = url.pathname + url.search + url.hash;
        if (next !== window.location.pathname + window.location.search + window.location.hash) {
            history.replaceState(history.state, '', next);
        }
    }

    function getClient() {
        const CM = window.ConfigManager;
        if (CM && typeof CM.getSupabaseClient === 'function') {
            try { const c = CM.getSupabaseClient(); if (c) return c; } catch (_) { /* sin config */ }
        }
        if (window.WeotziData && typeof window.WeotziData.getClient === 'function') {
            try { const c = window.WeotziData.getClient(); if (c) return c; } catch (_) { /* sin cliente */ }
        }
        return window._supabase || null;
    }

    async function waitForConfig() {
        const CM = window.ConfigManager;
        if (!CM || typeof CM.ready !== 'function') return;
        try {
            await Promise.race([
                Promise.resolve(CM.ready()).catch(() => null),
                new Promise((resolve) => setTimeout(resolve, CONFIG_TIMEOUT_MS))
            ]);
        } catch (_) { /* sigue con lo que haya */ }
    }

    // ============================================
    // CAPAS (drawers y diálogos con focus trap)
    // ============================================
    function dialogOf(overlay) {
        return overlay ? overlay.querySelector('[role="dialog"], [role="alertdialog"]') : null;
    }

    function openLayer(overlay, opts = {}) {
        if (!overlay) return;
        const existing = layers.find((l) => l.el === overlay);
        if (existing) {
            existing.onRequestClose = opts.onRequestClose || existing.onRequestClose;
            return;
        }
        const active = document.activeElement;
        layers.push({
            el: overlay,
            returnFocus: active instanceof HTMLElement && active !== document.body ? active : null,
            returnSelector: opts.returnSelector || null,
            onRequestClose: opts.onRequestClose || (() => closeLayer(overlay))
        });
        overlay.hidden = false;
        document.body.classList.add('ast-locked');
        closeMobileMenu();
        hydrateIcons(overlay);
        const dialog = dialogOf(overlay);
        requestAnimationFrame(() => {
            const target = opts.initialFocus && opts.initialFocus.isConnected && !opts.initialFocus.closest('[hidden]') && !opts.initialFocus.disabled
                ? opts.initialFocus : dialog;
            if (target) target.focus({ preventScroll: true });
        });
    }

    function closeLayer(overlay, { restoreFocus = true } = {}) {
        if (!overlay) return;
        const index = layers.findIndex((l) => l.el === overlay);
        overlay.hidden = true;
        if (index === -1) return;
        const [layer] = layers.splice(index, 1);
        if (!layers.length) document.body.classList.remove('ast-locked');
        if (!restoreFocus) return;
        requestAnimationFrame(() => {
            let target = layer.returnFocus;
            if (!target || !target.isConnected || target.closest('[hidden]')) {
                target = layer.returnSelector ? document.querySelector(layer.returnSelector) : null;
            }
            if ((!target || target.closest('[hidden]')) && layers.length) target = dialogOf(layers[layers.length - 1].el);
            if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
        });
    }

    function topLayer() { return layers.length ? layers[layers.length - 1] : null; }

    function wireLayers() {
        document.addEventListener('keydown', (event) => {
            const top = topLayer();
            if (!top) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                top.onRequestClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const dialog = dialogOf(top.el);
            if (!dialog) return;
            const focusables = Array.from(dialog.querySelectorAll(FOCUSABLE))
                .filter((el) => el.getClientRects().length > 0 && !el.closest('[hidden]'));
            if (!focusables.length) { event.preventDefault(); dialog.focus(); return; }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const current = document.activeElement;
            if (event.shiftKey && (current === first || current === dialog || !dialog.contains(current))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
                event.preventDefault();
                first.focus();
            }
        }, true);
        ['ast-editor', 'ast-order', 'ast-dlg-payment', 'ast-dlg-confirm'].forEach((id) => {
            const overlay = $(id);
            if (!overlay) return;
            overlay.addEventListener('mousedown', (event) => {
                const top = topLayer();
                if (event.target === overlay && top && top.el === overlay) top.onRequestClose();
            });
        });
    }

    // Confirmación genérica. Devuelve { confirmed, value }.
    function confirmDialog(opts) {
        const o = opts || {};
        if (confirmResolver) confirmResolver({ confirmed: false, value: '' });
        return new Promise((resolve) => {
            const overlay = $('ast-dlg-confirm');
            const field = $('ast-confirm-field');
            const input = $('ast-confirm-input');
            const ok = $('ast-confirm-ok');
            const cancel = $('ast-confirm-cancel');
            setText('ast-confirm-title', o.title || '¿Confirmás?');
            setText('ast-confirm-message', o.message || '');
            const error = $('ast-confirm-error');
            error.hidden = true;
            error.textContent = '';
            if (o.input) {
                field.hidden = false;
                setText('ast-confirm-label', o.input.label || 'Motivo');
                input.value = o.input.value || '';
                input.maxLength = o.input.maxLength || 300;
                input.placeholder = o.input.placeholder || '';
                input.required = !!o.input.required;
            } else {
                field.hidden = true;
                input.value = '';
                input.required = false;
            }
            ok.textContent = o.confirmLabel || 'Confirmar';
            ok.className = 'wo-btn ' + (o.tone === 'danger' ? 'wo-btn--danger' : 'wo-btn--direct');
            cancel.textContent = o.cancelLabel || 'Volver';
            confirmResolver = (result) => {
                confirmResolver = null;
                closeLayer(overlay);
                resolve(result);
            };
            openLayer(overlay, {
                initialFocus: o.input ? input : cancel,
                onRequestClose: () => { if (confirmResolver) confirmResolver({ confirmed: false, value: '' }); }
            });
        });
    }

    function wireConfirmDialog() {
        $('ast-confirm-cancel').addEventListener('click', () => {
            if (confirmResolver) confirmResolver({ confirmed: false, value: '' });
        });
        $('ast-confirm-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const input = $('ast-confirm-input');
            const value = $('ast-confirm-field').hidden ? '' : input.value.trim();
            if (!$('ast-confirm-field').hidden && input.required && !value) {
                const error = $('ast-confirm-error');
                error.textContent = 'Completá este campo para continuar.';
                error.hidden = false;
                input.focus();
                return;
            }
            if (confirmResolver) confirmResolver({ confirmed: true, value });
        });
    }

    // ============================================
    // CHROME (menú móvil y logout del componente)
    // ============================================
    function closeMobileMenu() {
        const toggle = $('st-mobile-menu-toggle');
        const menu = $('st-mobile-menu');
        if (!toggle || !menu || menu.hidden) return;
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    }

    function wireChrome() {
        const toggle = $('st-mobile-menu-toggle');
        const menu = $('st-mobile-menu');
        if (toggle && menu) {
            menu.hidden = true;
            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
                const open = toggle.getAttribute('aria-expanded') !== 'true';
                menu.hidden = !open;
                toggle.setAttribute('aria-expanded', String(open));
            });
            document.addEventListener('click', (event) => {
                if (menu.hidden || menu.contains(event.target) || toggle.contains(event.target)) return;
                closeMobileMenu();
            });
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || menu.hidden || layers.length) return;
                closeMobileMenu();
                toggle.focus();
            });
        }
        const logout = $('st-logout');
        if (logout) {
            logout.addEventListener('click', async () => {
                const client = state.client || getClient();
                try { if (client) await client.auth.signOut(); } catch (err) { console.warn('[store] logout:', err); }
                window.location.href = appPath('/artist/login');
            });
        }
    }

    // ============================================
    // ARRANQUE
    // ============================================
    document.addEventListener('DOMContentLoaded', boot);

    async function boot() {
        M = window.WeotziStoreModel || null;
        Store = (window.WeotziData && window.WeotziData.Store) || null;
        Watermark = window.WeotziStoreWatermark || null;
        wireChrome();
        wireLayers();
        if (!M || !Store || !window.WeotziData || !window.WeotziData.Artists) {
            showGate('error');
            return;
        }
        wireStatic();

        await waitForConfig();
        state.client = getClient();
        if (!state.client || !state.client.auth) { showGate('error'); return; }

        try {
            const { data } = await state.client.auth.getSession();
            state.session = (data && data.session) || null;
        } catch (err) {
            console.warn('[store] no pudimos leer la sesión:', err);
            state.session = null;
        }
        if (!state.session || !state.session.user) {
            window.location.href = appPath(LOGIN_URL);
            return;
        }
        state.uid = state.session.user.id;

        try {
            const res = await window.WeotziData.Artists.getByUserId(state.uid, 'user_id, name, username, registration_status');
            if (res && res.error) throw res.error;
            state.artist = (res && res.data) || null;
        } catch (err) {
            console.warn('[store] no pudimos leer el perfil de artista:', err);
            showGate('error');
            return;
        }
        if (!state.artist || state.artist.registration_status === 'incompleto') {
            showGate('incomplete');
            return;
        }
        state.username = String(state.artist.username || '').trim();

        let enabled = false;
        try {
            enabled = Store.featureEnabled() && await Store.isAvailable();
        } catch (err) {
            console.warn('[store] gate:', err);
            enabled = false;
        }
        if (!enabled) { showGate('disabled'); return; }

        await loadAll();
        showApp();
        renderAll();
        await routeFromUrl();
        window.addEventListener('popstate', () => { if (!layers.length) routeFromUrl(); });
    }

    function showGate(kind) {
        const copy = {
            incomplete: {
                title: 'Completá tu registro para abrir tu Store',
                text: 'Tu perfil de artista todavía está incompleto. Terminá el registro y volvé para vender merch y diseños con licencia.',
                action: 'Completar registro →',
                href: appPath(REGISTER_URL)
            },
            disabled: {
                title: 'La Store todavía no está habilitada',
                text: 'Estamos terminando de prepararla. Cuando esté lista, vas a poder vender merch y diseños con licencia desde acá.',
                action: 'Volver al dashboard →',
                href: appPath(DASHBOARD_URL)
            },
            error: {
                title: 'No pudimos abrir tu Store',
                text: 'Revisá tu conexión y recargá la página en unos segundos.',
                action: 'Recargar la página →',
                href: window.location.pathname + window.location.search
            }
        }[kind] || null;
        if (!copy) return;
        $('ast-loading').hidden = true;
        $('ast-app').hidden = true;
        setText('ast-gate-title', copy.title);
        setText('ast-gate-text', copy.text);
        const action = $('ast-gate-action');
        action.textContent = copy.action;
        action.setAttribute('href', copy.href);
        $('ast-gate').hidden = false;
        $('ast-gate').dataset.gate = kind;
        document.body.dataset.storeState = kind;
    }

    function showApp() {
        $('ast-loading').hidden = true;
        $('ast-gate').hidden = true;
        $('ast-app').hidden = false;
        document.body.dataset.storeState = 'ready';
        const link = $('ast-public-link');
        if (state.username) {
            link.setAttribute('href', M.storeUrl(state.username));
            link.hidden = false;
        } else {
            link.hidden = true;
        }
        setText('ast-set-authorship-label', M.AUTHORSHIP_ATTESTATION);
        hydrateIcons($('ast-main'));
    }

    // ============================================
    // DATOS
    // ============================================
    // Mes en curso: sin tope (to = null). Un tope de hoy viaja como fecha y la
    // RPC lo corta a medianoche UTC, lo que deja afuera las ventas de la noche
    // local (21 a 24 h en UTC-3). El inicio todavía viaja como fecha.
    function monthRange() {
        const now = new Date();
        return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    }

    async function refresh(parts) {
        const p = parts || { products: true, orders: true, settings: true, sales: true };
        const jobs = [];
        if (p.products) {
            jobs.push(Store.listMyProducts(SELLER_TYPE, state.uid).then(
                (rows) => { state.products = rows || []; state.errors.products = null; },
                (err) => { console.warn('[store] productos:', err); state.errors.products = err; }
            ));
        }
        if (p.orders) {
            jobs.push(Store.listSellerOrders(SELLER_TYPE, state.uid).then(
                (rows) => { state.orders = rows || []; state.errors.orders = null; },
                (err) => { console.warn('[store] pedidos:', err); state.errors.orders = err; }
            ));
        }
        if (p.settings) {
            jobs.push(Store.getSellerSettings(SELLER_TYPE, state.uid).then(
                (row) => { state.settings = row || null; state.errors.settings = null; },
                (err) => { console.warn('[store] ajustes:', err); state.errors.settings = err; }
            ));
        }
        if (p.sales) {
            const range = monthRange();
            jobs.push(Store.getSalesReport(SELLER_TYPE, state.uid, range.from, range.to).then(
                (rows) => { state.sales = rows || []; state.errors.sales = null; },
                (err) => { console.warn('[store] reporte de ventas:', err); state.errors.sales = err; }
            ));
        }
        await Promise.all(jobs);
    }

    async function loadAll() {
        await refresh({ products: true, orders: true, settings: true, sales: true });
    }

    function settingsMissing() {
        const s = state.settings || {};
        const missing = [];
        if (!String(s.payment_instructions || '').trim()) missing.push('las instrucciones de pago');
        if (!String(s.contact_channel || '').trim()) missing.push('el canal de contacto');
        return missing;
    }

    function productsOf(kind) { return state.products.filter((p) => p.kind === kind); }

    // ============================================
    // RENDER GENERAL
    // ============================================
    function renderAll() {
        renderSetupAlert();
        renderStats();
        renderTabCounts();
        renderProducts('design');
        renderProducts('merch');
        renderOrders();
        fillSettingsForm();
        hydrateIcons($('ast-app'));
    }

    function renderSetupAlert() {
        const missing = state.errors.settings ? [] : settingsMissing();
        const alert = $('ast-setup-alert');
        if (missing.length) {
            setText('ast-setup-alert-text', 'Te ' + (missing.length > 1 ? 'faltan ' : 'falta ') + missing.join(' y ') + '. Sin eso no podés publicar productos.');
            alert.hidden = false;
        } else {
            alert.hidden = true;
        }
        const settingsAlert = $('ast-settings-alert');
        if (missing.length) {
            setText('ast-settings-alert-text', 'Para publicar necesitás completar ' + missing.join(' y ') + '.');
            settingsAlert.hidden = false;
        } else {
            settingsAlert.hidden = true;
        }
        const flag = document.querySelector('[data-count="ajustes"]');
        if (flag) flag.hidden = !missing.length;
    }

    function renderStats() {
        // Ventas del mes: una suma por moneda (nunca se convierte).
        if (state.errors.sales) {
            setText('ast-stat-sales', '—');
            setText('ast-stat-sales-sub', 'No pudimos cargar el reporte.');
        } else {
            const byCurrency = {};
            let orders = 0;
            state.sales.forEach((row) => {
                const code = String(row.currency || 'USD').toUpperCase();
                byCurrency[code] = (byCurrency[code] || 0) + (Number(row.gross_amount) || 0);
                orders += Number(row.orders) || 0;
            });
            const codes = Object.keys(byCurrency).filter((c) => byCurrency[c] > 0);
            setText('ast-stat-sales', codes.length ? codes.map((c) => M.formatMoney(byCurrency[c], c)).join(' · ') : '0');
            setText('ast-stat-sales-sub', orders ? orders + ' ' + plural(orders, 'pedido pagado', 'pedidos pagados') : 'Todavía no vendiste este mes.');
        }

        if (state.errors.orders) {
            ['ast-stat-payments', 'ast-stat-prepare'].forEach((id) => setText(id, '—'));
            setText('ast-stat-payments-sub', 'No pudimos cargar los pedidos.');
            setText('ast-stat-prepare-sub', '');
        } else {
            const pending = state.orders.filter((o) => o.status === 'pending_payment');
            const reported = pending.filter((o) => o.buyer_payment_reported_at).length;
            setText('ast-stat-payments', String(pending.length));
            setText('ast-stat-payments-sub', pending.length ? reported + ' con pago informado' : 'Nada pendiente.');
            const prepare = state.orders.filter(ORDER_FILTERS[1].match).length;
            setText('ast-stat-prepare', String(prepare));
            setText('ast-stat-prepare-sub', prepare ? 'Despachalos o dejalos listos para retirar.' : 'Todo al día.');
        }

        if (state.errors.products) {
            setText('ast-stat-active', '—');
            setText('ast-stat-active-sub', 'No pudimos cargar tus productos.');
        } else {
            const active = state.products.filter((p) => p.status === 'active').length;
            const drafts = state.products.filter((p) => p.status === 'draft').length;
            const paused = state.products.filter((p) => p.status === 'paused').length;
            setText('ast-stat-active', String(active));
            const parts = [];
            if (drafts) parts.push(drafts + ' ' + plural(drafts, 'borrador', 'borradores'));
            if (paused) parts.push(paused + ' ' + plural(paused, 'pausado', 'pausados'));
            setText('ast-stat-active-sub', parts.length ? parts.join(' · ') : (state.products.length ? 'Sin borradores.' : 'Todavía no cargaste productos.'));
        }
    }

    function renderTabCounts() {
        const counts = { disenos: productsOf('design').length, merch: productsOf('merch').length, pedidos: state.orders.length };
        Object.keys(counts).forEach((key) => {
            const el = document.querySelector('.ast-tabcount[data-count="' + key + '"]');
            if (el) el.textContent = String(counts[key]);
        });
    }

    // ============================================
    // TABS
    // ============================================
    function selectTab(tab, { updateUrl = true, focus = false } = {}) {
        const next = TABS.includes(tab) ? tab : 'disenos';
        state.tab = next;
        document.querySelectorAll('#ast-tabs [role="tab"]').forEach((btn) => {
            const on = btn.dataset.tab === next;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', String(on));
            btn.tabIndex = on ? 0 : -1;
            if (on && focus) btn.focus();
        });
        TABS.forEach((t) => { const panel = $('ast-panel-' + t); if (panel) panel.hidden = t !== next; });
        if (updateUrl) setParams({ tab: next });
    }

    function wireTabs() {
        const list = $('ast-tabs');
        list.addEventListener('click', (event) => {
            const btn = event.target.closest('[role="tab"]');
            if (btn) selectTab(btn.dataset.tab);
        });
        list.addEventListener('keydown', (event) => {
            const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            const index = TABS.indexOf(state.tab);
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
            if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = TABS.length - 1;
            selectTab(TABS[next], { focus: true });
        });
    }

    // ============================================
    // PRODUCTOS (cards)
    // ============================================
    function productMedia(product) {
        const image = (product.images || [])[0];
        const url = image ? Store.previewUrl(image.path) : '';
        if (url) return '<img src="' + esc(url) + '" alt="' + esc(image.alt || product.title) + '" loading="lazy">';
        return '<span class="ast-media-ph" aria-hidden="true"><i data-wo-icon="' + (product.kind === 'design' ? 'pen-tool' : 'package') + '"></i></span>';
    }

    function designPrices(product) {
        const rows = M.LICENSE_TIERS.map((tier) => {
            const price = product[tier.priceField];
            if (price === null || price === undefined || !(Number(price) > 0)) return '';
            return '<li><span>' + esc(tier.label) + '</span><span class="wo-mono-num">' + esc(M.formatMoney(price, product.currency)) + '</span></li>';
        }).filter(Boolean);
        return rows.length ? '<ul class="ast-prices">' + rows.join('') + '</ul>' : '<p class="ast-card-note">Todavía no tiene niveles con precio.</p>';
    }

    function merchSummary(product) {
        const variants = (product.variants || []).filter((v) => v.active !== false);
        const price = M.priceFrom(product);
        const priceLine = price != null
            ? '<ul class="ast-prices"><li><span>' + (variants.some((v) => Number(v.price_amount) > 0) ? 'Desde' : 'Precio') + '</span><span class="wo-mono-num">' + esc(M.formatMoney(price, product.currency)) + '</span></li></ul>'
            : '<p class="ast-card-note">Todavía no tiene precio.</p>';
        let stock = 'Sin variantes activas';
        if (variants.length) {
            const unlimited = variants.some((v) => v.stock === null || v.stock === undefined);
            const total = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
            stock = variants.length + ' ' + plural(variants.length, 'variante', 'variantes') + ' · ' + (unlimited ? 'stock sin límite' : total + ' ' + plural(total, 'unidad', 'unidades'));
        }
        return priceLine + '<p class="ast-card-meta">' + esc(stock) + '</p>';
    }

    function productCard(product) {
        const isDesign = product.kind === 'design';
        const status = product.status || 'draft';
        const tags = ['<span class="' + esc(M.statusTag(status)) + ' ast-tag-s">' + esc(M.statusLabel(status)) + '</span>'];
        if (isDesign && status !== 'retired' && M.isReserved(product)) tags.push('<span class="wo-tag wo-tag--highlight ast-tag-s">Reservado</span>');
        const sales = Number(product.sales_count) || 0;
        const meta = [sales + ' ' + plural(sales, 'venta', 'ventas')];
        if (isDesign) {
            const licenses = Number(product.licenses_issued) || 0;
            meta.push(licenses + ' ' + plural(licenses, 'licencia emitida', 'licencias emitidas'));
        }
        let note = '';
        if (status === 'retired') {
            note = product.exclusive_sold_at
                ? 'Vendido con licencia exclusiva el ' + M.formatDate(product.exclusive_sold_at) + '.'
                : 'Retirado' + (product.retired_at ? ' el ' + M.formatDate(product.retired_at) : '') + '. Ya no se puede volver a publicar.';
        }
        const id = esc(product.id);
        const title = esc(product.title);
        const actions = [];
        if (status !== 'retired') {
            actions.push('<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-act="edit" data-id="' + id + '" aria-label="Editar «' + title + '»">Editar</button>');
            if (status === 'active') actions.push('<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-act="pause" data-id="' + id + '" aria-label="Pausar «' + title + '»">Pausar</button>');
            else actions.push('<button type="button" class="wo-btn wo-btn--direct wo-btn--s" data-act="publish" data-id="' + id + '" aria-label="Publicar «' + title + '»">Publicar</button>');
            if (status === 'draft') actions.push('<button type="button" class="wo-btn wo-btn--ghost wo-btn--s ast-btn-danger" data-act="delete" data-id="' + id + '" aria-label="Borrar el borrador «' + title + '»">Borrar borrador</button>');
            else actions.push('<button type="button" class="wo-btn wo-btn--ghost wo-btn--s ast-btn-danger" data-act="retire" data-id="' + id + '" aria-label="Retirar «' + title + '»">Retirar</button>');
        }
        return '<article class="ast-card" data-card="' + id + '" aria-labelledby="ast-card-title-' + id + '">' +
            '<div class="ast-card-media">' + productMedia(product) + '<span class="ast-card-tags">' + tags.join('') + '</span></div>' +
            '<div class="ast-card-body">' +
            '<p class="ast-card-kind">' + esc(M.KIND_LABELS[product.kind] || '') + (product.category ? ' · ' + esc(product.category) : '') + '</p>' +
            '<h3 class="ast-card-title" id="ast-card-title-' + id + '">' + title + '</h3>' +
            (isDesign ? designPrices(product) : merchSummary(product)) +
            '<p class="ast-card-meta">' + esc(meta.join(' · ')) + '</p>' +
            (note ? '<p class="ast-card-note">' + esc(note) + '</p>' : '') +
            (actions.length ? '<div class="ast-card-actions">' + actions.join('') + '</div>' : '') +
            '</div></article>';
    }

    function renderProducts(kind) {
        const box = $(kind === 'design' ? 'ast-list-disenos' : 'ast-list-merch');
        if (!box) return;
        if (state.errors.products) {
            setHtml(box, '<div class="wo-alert wo-alert--error ast-panel-error" role="alert"><i data-wo-icon="alert-triangle" class="wo-icon-18" aria-hidden="true"></i>' +
                '<span>No pudimos cargar tus productos. <button type="button" class="ast-linkbtn" data-act="reload">Volver a intentar →</button></span></div>');
            return;
        }
        const list = productsOf(kind);
        if (!list.length) {
            const isDesign = kind === 'design';
            box.innerHTML = '<div class="wo-empty ast-empty">' +
                '<i data-wo-icon="' + (isDesign ? 'pen-tool' : 'package') + '" aria-hidden="true"></i>' +
                '<p class="wo-empty-title">' + (isDesign ? 'Todavía no subiste diseños' : 'Todavía no cargaste merch') + '</p>' +
                '<p>' + (isDesign
                    ? 'Subí tu flash, elegí qué licencias ofrecés y publicalo en tu Store.'
                    : 'Cargá remeras, prints o stickers con sus variantes y stock.') + '</p>' +
                '<button type="button" class="wo-btn wo-btn--ghost" data-act="new" data-kind="' + kind + '"><i data-wo-icon="plus" class="wo-icon-18" aria-hidden="true"></i>' +
                (isDesign ? 'Nuevo diseño' : 'Nuevo producto') + '</button></div>';
            return;
        }
        setHtml(box, list.map(productCard).join(''));
    }

    function wireProductLists() {
        ['ast-list-disenos', 'ast-list-merch'].forEach((id) => {
            $(id).addEventListener('click', (event) => {
                const btn = event.target.closest('[data-act]');
                if (!btn) return;
                const act = btn.dataset.act;
                if (act === 'reload') { reloadEverything(); return; }
                if (act === 'new') { openEditor({ kind: btn.dataset.kind }); return; }
                const product = state.products.find((p) => String(p.id) === String(btn.dataset.id));
                if (!product) return;
                if (act === 'edit') openEditor({ id: product.id });
                else if (act === 'publish') publishFromCard(product);
                else if (act === 'pause') changeStatus(product, 'paused');
                else if (act === 'retire') retireProduct(product);
                else if (act === 'delete') deleteDraft(product);
            });
        });
    }

    async function reloadEverything() {
        await loadAll();
        renderAll();
    }

    function focusCard(id, act) {
        requestAnimationFrame(() => {
            const card = document.querySelector('[data-card="' + cssEscape(id) + '"]');
            let target = card && (card.querySelector('[data-act="' + act + '"]') || card.querySelector('[data-act]'));
            // Una card retirada ya no tiene acciones: el foco vuelve al panel activo.
            if (!target) target = $('ast-panel-' + state.tab);
            if (target) target.focus({ preventScroll: true });
        });
    }

    async function publishFromCard(product) {
        const list = M.publishChecklist(product, { variants: product.variants, assets: product.assets, settings: state.settings || {} });
        if (!M.checklistComplete(list)) {
            notify(M.ERROR_COPY.checklist_incomplete, 'error');
            openEditor({ id: product.id });
            return;
        }
        await changeStatus(product, 'active');
    }

    async function changeStatus(product, status) {
        try {
            await Store.setProductStatus(product.id, status);
            await refresh({ products: true });
            renderAll();
            const title = '«' + product.title + '»';
            if (status === 'active') notify('Publicaste ' + title + '. Ya se ve en tu Store pública.', 'success');
            else if (status === 'paused') notify('Pausaste ' + title + '. No se ve en tu Store hasta que lo vuelvas a publicar.', 'success');
            else if (status === 'retired') notify('Retiraste ' + title + '.', 'success');
            focusCard(product.id, status === 'active' ? 'pause' : 'edit');
        } catch (err) {
            const code = M.errorCode(err);
            notify(errorText(err, 'No pudimos cambiar el estado. Probá de nuevo.'), 'error');
            if (code === 'checklist_incomplete') openEditor({ id: product.id });
        }
    }

    async function retireProduct(product) {
        const { confirmed } = await confirmDialog({
            title: 'Retirar «' + product.title + '»',
            message: 'Deja de estar a la venta para siempre y no se puede volver a publicar. Quien ya compró conserva su licencia o su pedido.',
            confirmLabel: 'Retirar',
            cancelLabel: 'Volver',
            tone: 'danger'
        });
        if (confirmed) await changeStatus(product, 'retired');
    }

    async function deleteDraft(product) {
        const { confirmed } = await confirmDialog({
            title: 'Borrar el borrador',
            message: 'Se borra «' + product.title + '» con sus imágenes y archivos. No se puede deshacer.',
            confirmLabel: 'Borrar borrador',
            cancelLabel: 'Volver',
            tone: 'danger'
        });
        if (!confirmed) return;
        try {
            await Store.deleteDraftProduct(product.id);
            await refresh({ products: true });
            renderAll();
            notify('Borraste el borrador «' + product.title + '».', 'success');
            requestAnimationFrame(() => {
                const panel = $(product.kind === 'design' ? 'ast-panel-disenos' : 'ast-panel-merch');
                if (panel && !panel.hidden) panel.focus({ preventScroll: true });
            });
        } catch (err) {
            notify(errorText(err, 'No pudimos borrar el borrador. Probá de nuevo.'), 'error');
        }
    }

    // ============================================
    // EDITOR DE PRODUCTO
    // ============================================
    function newVariantRow(v) {
        variantSeq += 1;
        const source = v || {};
        return {
            key: 'v' + variantSeq,
            id: source.id || null,
            label: source.label || '',
            size: source.size || '',
            color: source.color || '',
            sku: source.sku || '',
            price: toInput(source.price_amount),
            stock: source.id ? (source.stock === undefined ? null : source.stock) : null,
            stockInput: source.stock === null || source.stock === undefined ? '' : String(source.stock),
            active: source.active !== false
        };
    }

    function defaultCurrency() {
        const counts = {};
        state.products.forEach((p) => { if (p.currency) counts[p.currency] = (counts[p.currency] || 0) + 1; });
        const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        return best || 'USD';
    }

    async function openEditor({ id = null, kind = 'design' } = {}) {
        if (state.editor) {
            const top = topLayer();
            if (top && top.el === $('ast-editor')) return;
        }
        if (state.orderId) closeOrder({ restoreFocus: false });
        let product = null;
        if (id) {
            try {
                product = await Store.getMyProduct(id);
            } catch (err) {
                notify(errorText(err, 'No pudimos abrir el producto. Probá de nuevo.'), 'error');
                setParams({ editar: null });
                return;
            }
            if (!product || String(product.seller_id) !== String(state.uid)) {
                notify('No encontramos ese producto. Puede que ya no exista.', 'error');
                setParams({ editar: null });
                return;
            }
            if (product.settings !== undefined) state.settings = product.settings || state.settings;
        }
        const editorKind = product ? product.kind : (kind === 'merch' ? 'merch' : 'design');
        state.editor = {
            id: product ? product.id : null,
            kind: editorKind,
            status: product ? product.status : 'draft',
            product,
            images: (product && Array.isArray(product.images) ? product.images : []).map((img) => ({ path: img.path, alt: img.alt || '' })),
            assets: product ? (product.assets || []).slice() : [],
            variants: product ? (product.variants || []).map(newVariantRow) : [],
            dirty: false,
            busy: false,
            uploading: 0
        };
        if (editorKind === 'merch' && !state.editor.variants.length) state.editor.variants = [newVariantRow()];
        state.checklistSignature = '';
        fillEditor();
        selectTab(editorKind === 'design' ? 'disenos' : 'merch', { updateUrl: false });
        openLayer($('ast-editor'), {
            initialFocus: $('ast-ed-f-title'),
            onRequestClose: requestCloseEditor,
            returnSelector: product ? '[data-card="' + cssEscape(product.id) + '"] [data-act="edit"]' : (editorKind === 'design' ? '#ast-new-design' : '#ast-new-merch')
        });
        setParams(product
            ? { editar: product.id, nuevo: null, pedido: null, modal: null, tab: editorKind === 'design' ? 'disenos' : 'merch' }
            : { nuevo: KIND_NEW_PARAM[editorKind], editar: null, pedido: null, modal: null, tab: editorKind === 'design' ? 'disenos' : 'merch' });
    }

    function fillEditor() {
        const ed = state.editor;
        const p = ed.product || {};
        const isDesign = ed.kind === 'design';
        setText('ast-ed-eyebrow', isDesign ? 'Diseño con licencia' : 'Merch');
        setText('ast-ed-title', ed.id ? (isDesign ? 'Editar diseño' : 'Editar producto') : (isDesign ? 'Nuevo diseño' : 'Nuevo producto'));
        renderEditorStatus();
        document.querySelectorAll('#ast-ed-form [data-only]').forEach((el) => { el.hidden = el.dataset.only !== ed.kind; });

        $('ast-ed-f-title').value = p.title || '';
        $('ast-ed-f-description').value = p.description || '';
        $('ast-ed-f-category').value = p.category || '';
        $('ast-ed-f-tags').value = Array.isArray(p.tags) ? p.tags.join(', ') : '';
        const currency = String(p.currency || defaultCurrency()).toUpperCase();
        const options = CURRENCIES.slice();
        if (!options.some((c) => c[0] === currency)) options.push([currency, currency]);
        $('ast-ed-f-currency').innerHTML = options.map((c) => '<option value="' + esc(c[0]) + '"' + (c[0] === currency ? ' selected' : '') + '>' + esc(c[0] + ' · ' + c[1]) + '</option>').join('');
        $('ast-ed-f-width').value = toInput(p.design_width_cm);
        $('ast-ed-f-height').value = toInput(p.design_height_cm);
        $('ast-ed-f-style').value = p.design_style || '';
        $('ast-ed-f-placement').value = p.placement_suggestion || '';
        $('ast-ed-f-price').value = toInput(p.price_amount);

        renderTiers();

        const shipOn = ed.id ? (p.shipping_price_amount !== null && p.shipping_price_amount !== undefined) : true;
        $('ast-ed-ship-on').checked = !isDesign && shipOn;
        $('ast-ed-f-ship-price').value = toInput(p.shipping_price_amount);
        $('ast-ed-f-ship-note').value = p.ships_to_note || '';
        $('ast-ed-pickup-on').checked = !!p.pickup_available;
        $('ast-ed-f-pickup-note').value = p.pickup_note || '';
        renderCountries(Array.isArray(p.ships_to_countries) ? p.ships_to_countries : []);
        syncDeliveryFields();

        renderFiles();
        renderImages();
        renderVariants();
        clearEditorErrors();

        const readOnly = ed.status === 'retired';
        document.querySelectorAll('#ast-ed-form fieldset').forEach((fs) => { fs.disabled = readOnly; });
        if (readOnly) showEditorError('Este producto está retirado: ya no se puede editar ni volver a publicar.');
        updateEditorFooter();
    }

    function renderEditorStatus() {
        const ed = state.editor;
        const tag = $('ast-ed-status');
        tag.className = M.statusTag(ed.status) + ' ast-tag-s';
        tag.textContent = M.statusLabel(ed.status);
    }

    function renderTiers() {
        const ed = state.editor;
        const p = ed.product || {};
        const licensed = Number(p.licenses_issued) > 0;
        $('ast-ed-tiers').innerHTML = M.LICENSE_TIERS.map((tier) => {
            const base = 'ast-ed-tier-' + tier.id;
            const price = p[tier.priceField];
            const on = price !== null && price !== undefined && Number(price) > 0;
            let note = '';
            if (tier.requiresArtist) note = 'Solo la pueden comprar cuentas de artista con el registro completo.';
            if (tier.id === 'exclusive') note = licensed ? 'Ya no se puede vender: el diseño tiene licencias emitidas.' : 'Venta única: al confirmarse el pago, el diseño se retira de tu Store.';
            return '<div class="ast-tier' + (on ? ' is-on' : '') + '" data-tier="' + esc(tier.id) + '">' +
                '<label class="ast-switch">' +
                '<span class="wo-toggle"><input type="checkbox" id="' + base + '-on" role="switch" data-tier-toggle="' + esc(tier.id) + '" aria-describedby="' + base + '-summary"' + (on ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></span>' +
                '<span class="ast-switch-label">Licencia ' + esc(tier.label) + '</span></label>' +
                '<p class="wo-help" id="' + base + '-summary">' + esc(tier.summary) + '</p>' +
                '<div class="wo-field">' +
                '<label class="wo-label" for="' + base + '-price">Precio · ' + esc(tier.label) + '</label>' +
                '<input type="text" inputmode="decimal" class="wo-input" id="' + base + '-price" data-tier-price="' + esc(tier.id) + '" value="' + esc(toInput(price)) + '" placeholder="Ej: 35" aria-describedby="' + base + '-price-err"' + (on ? '' : ' disabled') + '>' +
                '<p class="wo-error-msg" id="' + base + '-price-err" hidden></p>' +
                '</div>' +
                (note ? '<p class="wo-meta-s wo-muted ast-tier-note">' + esc(note) + '</p>' : '') +
                '</div>';
        }).join('');
    }

    function renderCountries(selected) {
        const chosen = (selected || []).map((c) => String(c).toUpperCase());
        const list = COUNTRIES.slice();
        chosen.forEach((code) => { if (!COUNTRY_NAMES[code]) list.push([code, code]); });
        $('ast-ed-countries').innerHTML = list.map((c) =>
            '<label class="wo-check ast-country"><input type="checkbox" value="' + esc(c[0]) + '" data-country' +
            (chosen.includes(c[0]) ? ' checked' : '') + ' aria-describedby="ast-ed-countries-help"><span>' + esc(c[1]) + '</span></label>'
        ).join('');
    }

    function syncDeliveryFields() {
        const shipOn = $('ast-ed-ship-on').checked;
        const pickupOn = $('ast-ed-pickup-on').checked;
        $('ast-ed-ship-fields').hidden = !shipOn;
        $('ast-ed-pickup-fields').hidden = !pickupOn;
    }

    function syncTierInputs() {
        document.querySelectorAll('[data-tier-toggle]').forEach((toggle) => {
            const input = $('ast-ed-tier-' + toggle.dataset.tierToggle + '-price');
            const card = toggle.closest('.ast-tier');
            if (input) input.disabled = !toggle.checked || (state.editor && state.editor.status === 'retired');
            if (card) card.classList.toggle('is-on', toggle.checked);
        });
    }

    function renderFiles() {
        const ed = state.editor;
        const box = $('ast-ed-files');
        if (ed.kind !== 'design') { box.innerHTML = ''; return; }
        const licensed = ed.product && Number(ed.product.licenses_issued) > 0;
        box.innerHTML = ['original', 'stencil'].map((kind) => {
            const slot = FILE_SLOTS[kind];
            const asset = ed.assets.find((a) => a.kind === kind);
            const base = 'ast-ed-file-' + kind;
            if (asset) {
                return '<div class="ast-file" data-kind="' + kind + '">' +
                    '<p class="ast-file-kind">' + esc(slot.label) + '</p>' +
                    '<p class="ast-file-name"><i data-wo-icon="file" class="wo-icon-18" aria-hidden="true"></i><span>' + esc(asset.file_name) + '</span></p>' +
                    '<p class="wo-meta-s wo-muted">' + esc([mimeLabel(asset.mime_type, asset.file_name), formatBytes(asset.size_bytes)].filter(Boolean).join(' · ')) + '</p>' +
                    (licensed
                        ? '<p class="wo-meta-s wo-muted">Con licencias emitidas no se puede quitar.</p>'
                        : '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-file-remove="' + esc(asset.id) + '" aria-label="Quitar el ' + esc(slot.label.toLowerCase()) + ' ' + esc(asset.file_name) + '">Quitar</button>') +
                    '</div>';
            }
            return '<div class="ast-file ast-file--empty" data-kind="' + kind + '">' +
                '<label class="ast-file-kind" for="' + base + '">' + esc(slot.label) + '</label>' +
                '<input type="file" class="ast-file-input" id="' + base + '" data-file-kind="' + kind + '" accept="' + esc(slot.accept) + '" aria-describedby="' + base + '-help ' + base + '-status">' +
                '<p class="wo-help" id="' + base + '-help">' + esc(slot.help) + '</p>' +
                '<p class="wo-meta-s ast-upload-status" id="' + base + '-status" aria-live="polite"></p>' +
                '</div>';
        }).join('');
        hydrateIcons(box);
    }

    function renderImages() {
        const ed = state.editor;
        const list = $('ast-ed-images');
        const isDesign = ed.kind === 'design';
        if (!ed.images.length) {
            list.innerHTML = '<li class="ast-images-empty">Todavía no hay imágenes.</li>';
        } else {
            list.innerHTML = ed.images.map((img, i) => {
                const url = Store.previewUrl(img.path);
                const n = i + 1;
                return '<li class="ast-img" data-index="' + i + '">' +
                    '<div class="ast-img-media">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="ast-media-ph" aria-hidden="true"><i data-wo-icon="image"></i></span>') +
                    (i === 0 ? '<span class="ast-img-cover">Portada</span>' : '') + '</div>' +
                    '<div class="wo-field ast-img-alt">' +
                    '<label class="wo-label" for="ast-ed-img-alt-' + i + '">Descripción de la imagen ' + n + '</label>' +
                    '<input type="text" class="wo-input" id="ast-ed-img-alt-' + i + '" data-img-alt="' + i + '" maxlength="200" value="' + esc(img.alt) + '" placeholder="Qué se ve en la imagen">' +
                    '</div>' +
                    '<div class="ast-img-actions">' +
                    '<button type="button" class="ast-iconbtn" data-img-act="up" data-index="' + i + '" aria-label="Mover la imagen ' + n + ' antes"' + (i === 0 ? ' disabled' : '') + '><i data-wo-icon="arrow-up" class="wo-icon-18" aria-hidden="true"></i></button>' +
                    '<button type="button" class="ast-iconbtn" data-img-act="down" data-index="' + i + '" aria-label="Mover la imagen ' + n + ' después"' + (i === ed.images.length - 1 ? ' disabled' : '') + '><i data-wo-icon="arrow-down" class="wo-icon-18" aria-hidden="true"></i></button>' +
                    '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-img-act="remove" data-index="' + i + '" aria-label="Quitar la imagen ' + n + '">Quitar</button>' +
                    '</div></li>';
            }).join('');
        }
        const count = ed.images.length;
        setText('ast-ed-images-help', count + ' de ' + MAX_IMAGES + ' · La primera es la portada.' +
            (isDesign ? ' Les agregamos la marca de agua «' + (Watermark ? Watermark.watermarkLabel(state.username) : 'WE ÖTZI') + '» automáticamente.' : ''));
        const input = $('ast-ed-images-input');
        input.disabled = count >= MAX_IMAGES || ed.status === 'retired' || ed.uploading > 0;
        hydrateIcons(list);
    }

    function syncImageAlts() {
        const ed = state.editor;
        if (!ed) return;
        document.querySelectorAll('#ast-ed-images [data-img-alt]').forEach((input) => {
            const i = Number(input.dataset.imgAlt);
            if (ed.images[i]) ed.images[i].alt = input.value.trim().slice(0, 200);
        });
    }

    function renderVariants() {
        const ed = state.editor;
        const box = $('ast-ed-variants');
        if (ed.kind !== 'merch') { box.innerHTML = ''; return; }
        if (!ed.variants.length) {
            box.innerHTML = '<p class="ast-variants-empty">Sin variantes. Agregá al menos una para poder publicar.</p>';
            return;
        }
        box.innerHTML = ed.variants.map((v, i) => {
            const base = 'ast-ed-v-' + v.key;
            const field = (name, label, value, attrs) => '<div class="wo-field">' +
                '<label class="wo-label" for="' + base + '-' + name + '">' + label + '</label>' +
                '<input type="text" class="wo-input" id="' + base + '-' + name + '" data-v-field="' + name + '" value="' + esc(value) + '"' + (attrs || '') + '>' +
                '</div>';
            const saved = v.id ? 'Guardado: ' + (v.stock === null || v.stock === undefined ? 'sin límite' : v.stock + ' ' + plural(Number(v.stock), 'unidad', 'unidades')) : '';
            return '<fieldset class="ast-variant" data-key="' + esc(v.key) + '">' +
                '<legend class="ast-variant-legend">Variante ' + (i + 1) + (v.id ? '' : ' · nueva') + (v.active ? '' : ' · inactiva') + '</legend>' +
                '<div class="ast-variant-grid">' +
                field('label', 'Nombre <span class="req" aria-hidden="true">*</span>', v.label, ' maxlength="60" placeholder="Ej: Talle M"') +
                field('size', 'Talle', v.size, ' maxlength="20"') +
                field('color', 'Color', v.color, ' maxlength="30"') +
                field('sku', 'SKU', v.sku, ' maxlength="40"') +
                field('price', 'Precio propio', v.price, ' inputmode="decimal" placeholder="Usa el precio base"') +
                '<div class="wo-field">' +
                '<label class="wo-label" for="' + base + '-stock">Stock</label>' +
                '<input type="text" class="wo-input" id="' + base + '-stock" data-v-field="stockInput" inputmode="numeric" value="' + esc(v.stockInput) + '" placeholder="Sin límite"' + (saved ? ' aria-describedby="' + base + '-saved"' : '') + '>' +
                (saved ? '<p class="wo-meta-s wo-muted" id="' + base + '-saved">' + esc(saved) + '</p>' : '') +
                '</div>' +
                '</div>' +
                '<div class="ast-variant-foot">' +
                '<label class="wo-check"><input type="checkbox" data-v-field="active"' + (v.active ? ' checked' : '') + '><span>Activa</span></label>' +
                '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-v-remove="' + esc(v.key) + '" aria-label="Quitar la variante ' + (i + 1) + (v.label ? ' ' + esc(v.label) : '') + '">Quitar</button>' +
                '</div>' +
                '<p class="wo-error-msg" id="' + base + '-err" role="alert" hidden></p>' +
                '</fieldset>';
        }).join('');
    }

    function syncVariantsFromDom() {
        const ed = state.editor;
        if (!ed || ed.kind !== 'merch') return;
        document.querySelectorAll('#ast-ed-variants [data-key]').forEach((row) => {
            const v = ed.variants.find((item) => item.key === row.dataset.key);
            if (!v) return;
            row.querySelectorAll('[data-v-field]').forEach((input) => {
                const key = input.dataset.vField;
                if (key === 'active') v.active = input.checked;
                else v[key] = input.value;
            });
        });
    }

    // Variantes listas para saveVariants + ajustes de stock de las guardadas.
    function collectVariants() {
        const ed = state.editor;
        syncVariantsFromDom();
        const list = [];
        const stockChanges = [];
        const errors = {};
        ed.variants.forEach((v) => {
            const label = String(v.label || '').trim();
            const isEmpty = !v.id && !label && !String(v.size || '').trim() && !String(v.color || '').trim() &&
                !String(v.sku || '').trim() && !String(v.price || '').trim() && !String(v.stockInput || '').trim();
            if (isEmpty) return;
            const problems = [];
            if (!label) problems.push('Poné un nombre, por ejemplo «Talle M».');
            let price = null;
            if (String(v.price || '').trim()) {
                price = M.parseAmount(v.price);
                if (!Number.isFinite(price) || price <= 0) { problems.push('El precio propio tiene que ser mayor a cero.'); price = null; }
            }
            let stock = null;
            const rawStock = String(v.stockInput || '').trim();
            if (rawStock) {
                if (!/^\d+$/.test(rawStock)) problems.push('El stock tiene que ser un número entero: 0 o más.');
                else stock = Number(rawStock);
            }
            if (problems.length) { errors[v.key] = problems.join(' '); return; }
            list.push({
                id: v.id || undefined,
                label,
                size: String(v.size || '').trim() || null,
                color: String(v.color || '').trim() || null,
                sku: String(v.sku || '').trim() || null,
                price_amount: price,
                active: v.active !== false,
                sort_order: list.length,
                stock
            });
            const current = v.stock === undefined ? null : v.stock;
            if (v.id && (current === null ? stock !== null : Number(current) !== stock)) {
                stockChanges.push({ id: v.id, newStock: stock, expected: current });
            }
        });
        return { list, stockChanges, errors };
    }

    function readTierToggles() {
        const out = {};
        M.LICENSE_TIERS.forEach((tier) => {
            const toggle = $('ast-ed-tier-' + tier.id + '-on');
            out[tier.id] = !!(toggle && toggle.checked);
        });
        return out;
    }

    // Formulario completo → { ok, errors, value, variants }.
    function collectEditor() {
        const ed = state.editor;
        syncImageAlts();
        const isDesign = ed.kind === 'design';
        const form = {
            kind: ed.kind,
            title: val('ast-ed-f-title'),
            description: val('ast-ed-f-description'),
            category: val('ast-ed-f-category'),
            tags: val('ast-ed-f-tags'),
            currency: val('ast-ed-f-currency'),
            images: ed.images
        };
        const toggles = readTierToggles();
        const shipOn = $('ast-ed-ship-on').checked;
        const pickupOn = $('ast-ed-pickup-on').checked;
        if (isDesign) {
            M.LICENSE_TIERS.forEach((tier) => { form[tier.priceField] = toggles[tier.id] ? val('ast-ed-tier-' + tier.id + '-price') : ''; });
            form.design_width_cm = val('ast-ed-f-width');
            form.design_height_cm = val('ast-ed-f-height');
            form.design_style = val('ast-ed-f-style');
            form.placement_suggestion = val('ast-ed-f-placement');
        } else {
            form.price_amount = val('ast-ed-f-price');
            form.shipping_price_amount = shipOn ? val('ast-ed-f-ship-price') : '';
            form.ships_to_countries = shipOn ? Array.from(document.querySelectorAll('#ast-ed-countries [data-country]:checked')).map((el) => el.value) : [];
            form.ships_to_note = shipOn ? val('ast-ed-f-ship-note') : '';
            form.pickup_available = pickupOn;
            form.pickup_note = pickupOn ? val('ast-ed-f-pickup-note') : '';
        }
        const result = M.validateProductDraft(form);
        const errors = Object.assign({}, result.errors);
        const value = result.value;
        if (isDesign) {
            M.LICENSE_TIERS.forEach((tier) => {
                if (toggles[tier.id] && value[tier.priceField] == null && !errors[tier.priceField]) {
                    errors[tier.priceField] = 'Poné el precio de la licencia ' + tier.label + ' o desactivala.';
                }
            });
        } else {
            if (!shipOn) {
                // Sin envío: el producto solo se retira (null = no se ofrece envío).
                value.shipping_price_amount = null;
                value.ships_to_countries = [];
                value.ships_to_note = null;
            }
            if (!shipOn && !pickupOn) errors.delivery = 'Ofrecé envío, retiro en el estudio o las dos opciones.';
        }
        let variants = { list: [], stockChanges: [], errors: {} };
        if (!isDesign) variants = collectVariants();
        const ok = !Object.keys(errors).length && !Object.keys(variants.errors).length;
        return { ok, errors, value, variants };
    }

    function clearEditorErrors() {
        Object.keys(ED_FIELDS).forEach((key) => showFieldError(ED_FIELDS[key], ''));
        document.querySelectorAll('#ast-ed-variants .wo-error-msg').forEach((el) => { el.hidden = true; el.textContent = ''; });
        showEditorError('');
    }

    function showEditorError(message) {
        const box = $('ast-ed-error');
        box.textContent = message || '';
        box.hidden = !message;
    }

    function showEditorErrors(result) {
        clearEditorErrors();
        let first = null;
        Object.keys(result.errors).forEach((key) => {
            const id = ED_FIELDS[key];
            if (!id) return;
            showFieldError(id, result.errors[key]);
            const el = $(id);
            if (!first && el && !el.closest('[hidden]')) first = el.matches('input, select, textarea') ? el : el.querySelector('input, select, textarea');
        });
        Object.keys(result.variants.errors).forEach((key) => {
            const err = $('ast-ed-v-' + key + '-err');
            if (err) { err.textContent = result.variants.errors[key]; err.hidden = false; }
            const input = $('ast-ed-v-' + key + '-label');
            if (!first && input) first = input;
        });
        return first;
    }

    // Checklist de publicación en vivo, sobre el estado del formulario.
    function editorChecklist() {
        const ed = state.editor;
        syncImageAlts();
        const toggles = readTierToggles();
        const draft = { kind: ed.kind, images: ed.images, price_amount: M.parseAmount(val('ast-ed-f-price')) };
        M.LICENSE_TIERS.forEach((tier) => {
            draft[tier.priceField] = ed.kind === 'design' && toggles[tier.id] ? M.parseAmount(val('ast-ed-tier-' + tier.id + '-price')) : null;
        });
        let variants = [];
        if (ed.kind === 'merch') {
            syncVariantsFromDom();
            variants = ed.variants.filter((v) => String(v.label || '').trim()).map((v) => ({ active: v.active }));
        }
        return M.publishChecklist(draft, { variants, assets: ed.assets, settings: state.settings || {} });
    }

    const SETTINGS_KEYS = ['payment_instructions', 'contact_channel', 'authorship'];

    function renderChecklist(list) {
        const signature = JSON.stringify(list.map((i) => [i.key, i.ok]));
        if (signature === state.checklistSignature) return;
        state.checklistSignature = signature;
        $('ast-ed-checklist').innerHTML = list.map((item) =>
            '<li class="ast-check' + (item.ok ? ' is-ok' : '') + '">' +
            '<i data-wo-icon="' + (item.ok ? 'check-square' : 'square') + '" class="wo-icon-18" aria-hidden="true"></i>' +
            '<span class="ast-check-label">' + esc(item.label) + '<span class="wo-sr-only">' + (item.ok ? ' · listo' : ' · pendiente') + '</span></span>' +
            (!item.ok && SETTINGS_KEYS.includes(item.key) ? '<button type="button" class="ast-linkbtn" data-goto="ajustes">Ir a Ajustes →</button>' : '') +
            '</li>'
        ).join('');
        hydrateIcons($('ast-ed-checklist'));
    }

    function updateEditorFooter() {
        const ed = state.editor;
        if (!ed) return;
        const list = editorChecklist();
        renderChecklist(list);
        const complete = M.checklistComplete(list);
        const status = ed.status;
        const save = $('ast-ed-save');
        const publish = $('ast-ed-publish');
        const working = ed.busy || ed.uploading > 0;
        if (!save.hasAttribute('aria-busy')) save.textContent = status === 'draft' ? 'Guardar borrador' : 'Guardar cambios';
        if (!publish.hasAttribute('aria-busy')) publish.textContent = status === 'paused' ? 'Volver a publicar' : 'Publicar';
        save.hidden = status === 'retired';
        publish.hidden = status === 'active' || status === 'retired';
        if (!save.hasAttribute('aria-busy')) save.disabled = working;
        if (!publish.hasAttribute('aria-busy')) publish.disabled = !complete || working;
        let hint = complete ? 'Todo listo para publicar.' : 'Completá el checklist para publicar.';
        if (status === 'active') hint = 'Publicado: los cambios se ven en tu Store al guardar.';
        if (status === 'retired') hint = 'Este producto está retirado.';
        if (ed.uploading > 0) hint = 'Subiendo archivos…';
        setText('ast-ed-publish-hint', hint);
    }

    function markDirty() {
        if (!state.editor) return;
        state.editor.dirty = true;
        updateEditorFooter();
    }

    async function requestCloseEditor() {
        const ed = state.editor;
        if (!ed) { closeLayer($('ast-editor')); return; }
        if (ed.uploading > 0) { notify('Esperá a que termine de subir el archivo.', 'info'); return; }
        if (ed.busy) return;
        if (ed.dirty) {
            const { confirmed } = await confirmDialog({
                title: 'Tenés cambios sin guardar',
                message: 'Si cerrás ahora, se pierden los cambios que no guardaste.',
                confirmLabel: 'Cerrar sin guardar',
                cancelLabel: 'Seguir editando',
                tone: 'danger'
            });
            if (!confirmed) return;
        }
        closeEditor();
    }

    function closeEditor() {
        closeLayer($('ast-editor'));
        state.editor = null;
        setParams({ editar: null, nuevo: null });
    }

    async function saveEditor({ publish = false, reason = null } = {}) {
        const ed = state.editor;
        if (!ed || ed.busy || ed.status === 'retired') return false;
        if (ed.uploading > 0 && reason !== 'upload') {
            notify('Esperá a que termine de subir el archivo para guardar.', 'info');
            return false;
        }
        const result = collectEditor();
        const first = showEditorErrors(result);
        if (!result.ok) {
            const message = reason === 'upload'
                ? 'Completá los datos marcados para guardar el borrador antes de subir archivos.'
                : 'Revisá los campos marcados.';
            showEditorError(message);
            if (first) first.focus();
            return false;
        }
        ed.busy = true;
        const button = publish ? $('ast-ed-publish') : $('ast-ed-save');
        setBusy(button, true, publish ? 'Publicando…' : 'Guardando…');
        updateEditorFooter();
        let stockError = null;
        try {
            let product;
            if (!ed.id) {
                product = await Store.createProduct(Object.assign({ seller_type: SELLER_TYPE, seller_id: state.uid }, result.value, { kind: ed.kind }));
                ed.id = product.id;
                ed.status = product.status || 'draft';
                setParams({ editar: product.id, nuevo: null });
                setText('ast-ed-title', ed.kind === 'design' ? 'Editar diseño' : 'Editar producto');
            } else {
                product = await Store.updateProduct(ed.id, result.value);
            }
            if (ed.kind === 'merch') {
                await Store.saveVariants(ed.id, result.variants.list);
                for (const change of result.variants.stockChanges) {
                    try {
                        await Store.adjustStock(change.id, change.newStock, change.expected);
                    } catch (err) {
                        stockError = err;
                        break;
                    }
                }
            }
            if (publish && !stockError) await Store.setProductStatus(ed.id, 'active');
            await reloadEditorProduct();
            if (stockError) throw stockError;
            ed.dirty = false;
            if (publish) {
                // La lista se repinta antes de cerrar: así el foco vuelve a la card nueva.
                await refresh({ products: true });
                renderAll();
                notify('Publicaste «' + (product && product.title ? product.title : 'tu producto') + '». Ya se ve en tu Store pública.', 'success');
                ed.busy = false;
                setBusy(button, false);
                if (state.editor === ed) closeEditor();
                return true;
            }
            refresh({ products: true }).then(() => renderAll());
            if (reason !== 'upload') notify(ed.status === 'draft' ? 'Guardaste el borrador.' : 'Guardaste los cambios.', 'success');
            return true;
        } catch (err) {
            const message = errorText(err, 'No pudimos guardar. Probá de nuevo.');
            showEditorError(message);
            notify(message, 'error');
            if (M.errorCode(err) === 'stock_changed') renderVariants();
            return false;
        } finally {
            if (state.editor === ed) {
                ed.busy = false;
                setBusy(button, false);
                updateEditorFooter();
            }
        }
    }

    // Relee el producto (variantes con id, assets, imágenes) sin pisar lo que
    // el artista está escribiendo en los campos de texto.
    async function reloadEditorProduct() {
        const ed = state.editor;
        if (!ed || !ed.id) return;
        const product = await Store.getMyProduct(ed.id);
        if (!product || state.editor !== ed) return;
        ed.product = product;
        ed.status = product.status;
        ed.assets = (product.assets || []).slice();
        ed.images = (product.images || []).map((img) => ({ path: img.path, alt: img.alt || '' }));
        ed.variants = (product.variants || []).map(newVariantRow);
        if (ed.kind === 'merch' && !ed.variants.length) ed.variants = [newVariantRow()];
        if (product.settings !== undefined) state.settings = product.settings || state.settings;
        renderEditorStatus();
        renderImages();
        renderFiles();
        renderVariants();
        state.checklistSignature = '';
        updateEditorFooter();
    }

    async function ensureSaved() {
        const ed = state.editor;
        if (!ed) return null;
        if (ed.id) return ed.id;
        const ok = await saveEditor({ reason: 'upload' });
        return ok && state.editor === ed ? ed.id : null;
    }

    async function persistImages(nextImages) {
        const ed = state.editor;
        const saved = await Store.updateProduct(ed.id, { images: nextImages });
        ed.images = ((saved && saved.images) || nextImages).map((img) => ({ path: img.path, alt: img.alt || '' }));
    }

    async function renderImage(file) {
        try {
            if (!Watermark) throw new Error('No pudimos preparar la imagen.');
            return state.editor.kind === 'design'
                ? await Watermark.renderPreview(file, { handle: state.username })
                : await Watermark.renderPlain(file);
        } catch (err) {
            const error = new Error((err && err.message) || 'No pudimos leer la imagen. Probá con otra.');
            error.validation = true;
            throw error;
        }
    }

    async function addImages(fileList) {
        const ed = state.editor;
        const input = $('ast-ed-images-input');
        const files = Array.from(fileList || []);
        input.value = '';
        if (!ed || !files.length) return;
        const room = MAX_IMAGES - ed.images.length;
        if (room <= 0) { notify('Ya tenés ' + MAX_IMAGES + ' imágenes. Quitá alguna para agregar otra.', 'error'); return; }
        const id = await ensureSaved();
        if (!id || state.editor !== ed) return;
        const queue = files.slice(0, room);
        if (files.length > room) notify('Solo se agregan ' + room + ' ' + plural(room, 'imagen', 'imágenes') + ': el máximo es ' + MAX_IMAGES + '.', 'info');
        ed.uploading += 1;
        renderImages();
        updateEditorFooter();
        let added = 0;
        try {
            for (let i = 0; i < queue.length; i += 1) {
                const file = queue[i];
                setText('ast-ed-images-status', 'Procesando ' + (i + 1) + ' de ' + queue.length + ': ' + file.name + '…');
                const check = M.validateFile('source', file);
                if (!check.ok) { notify(file.name + ': ' + check.error, 'error'); continue; }
                const rendered = await renderImage(file);
                syncImageAlts();
                const upload = await Store.uploadPreviewImage(state.uid, id, rendered.blob, ed.images.length, rendered.contentType);
                const title = val('ast-ed-f-title').trim();
                const next = ed.images.concat({ path: upload.path, alt: title ? title.slice(0, 200) : '' });
                try {
                    await persistImages(next);
                } catch (err) {
                    Store.removePreviewImage(upload.path).catch(() => null);
                    throw err;
                }
                added += 1;
                renderImages();
            }
            setText('ast-ed-images-status', '');
            if (added) {
                notify(added === 1 ? 'Agregaste una imagen.' : 'Agregaste ' + added + ' imágenes.', 'success');
                refresh({ products: true }).then(() => renderAll());
            }
        } catch (err) {
            const message = errorText(err, 'No pudimos subir la imagen. Probá de nuevo.');
            setText('ast-ed-images-status', message);
            notify(message, 'error');
        } finally {
            if (state.editor === ed) {
                ed.uploading -= 1;
                renderImages();
                state.checklistSignature = '';
                updateEditorFooter();
            }
        }
    }

    async function moveImage(index, delta) {
        const ed = state.editor;
        const target = index + delta;
        if (!ed || target < 0 || target >= ed.images.length || ed.uploading) return;
        syncImageAlts();
        const next = ed.images.slice();
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        try {
            if (ed.id) await persistImages(next);
            else ed.images = next;
            renderImages();
            updateEditorFooter();
            const btn = document.querySelector('#ast-ed-images [data-img-act="' + (delta < 0 ? 'up' : 'down') + '"][data-index="' + target + '"]');
            const fallback = document.querySelector('#ast-ed-images [data-img-act="remove"][data-index="' + target + '"]');
            const focusTarget = btn && !btn.disabled ? btn : fallback;
            if (focusTarget) focusTarget.focus();
        } catch (err) {
            notify(errorText(err, 'No pudimos reordenar las imágenes. Probá de nuevo.'), 'error');
        }
    }

    // Cada pedido guarda el path de la portada como miniatura
    // (store_order_items.image_path): Mis compras, el checkout y el detalle del
    // pedido la pintan desde ese objeto. Por eso el objeto se borra solo si
    // ningún pedido lo usa. Los pedidos se leen después de guardar las
    // imágenes, así entra cualquier pedido creado con la portada anterior. Si
    // no se pueden leer, o la lista llega al tope de listSellerOrders y puede
    // estar cortada, el objeto se conserva.
    async function releasePreviewImage(path) {
        if (!path) return;
        let orders;
        try {
            orders = await Store.listSellerOrders(SELLER_TYPE, state.uid);
        } catch (err) {
            console.warn('[store] no se pudo revisar si un pedido usa la imagen:', err);
            return;
        }
        const list = Array.isArray(orders) ? orders : [];
        if (list.length >= SELLER_ORDERS_LIMIT) return;
        const used = list.some((order) => (order.items || order.store_order_items || []).some((item) => item && item.image_path === path));
        if (used) return;
        try {
            await Store.removePreviewImage(path);
        } catch (err) {
            console.warn('[store] no se pudo borrar la imagen:', err);
        }
    }

    async function removeImage(index) {
        const ed = state.editor;
        if (!ed || !ed.images[index] || ed.uploading) return;
        syncImageAlts();
        const image = ed.images[index];
        const { confirmed } = await confirmDialog({
            title: 'Quitar la imagen ' + (index + 1),
            message: 'La imagen deja de verse en tu Store.',
            confirmLabel: 'Quitar imagen',
            cancelLabel: 'Volver',
            tone: 'danger'
        });
        if (!confirmed || state.editor !== ed) return;
        const next = ed.images.filter((_, i) => i !== index);
        try {
            if (ed.id) await persistImages(next);
            else ed.images = next;
            renderImages();
            state.checklistSignature = '';
            updateEditorFooter();
            releasePreviewImage(image.path);
            notify('Quitaste la imagen.', 'success');
            refresh({ products: true }).then(() => renderAll());
            requestAnimationFrame(() => $('ast-ed-images-input').focus());
        } catch (err) {
            notify(errorText(err, 'No pudimos quitar la imagen. Probá de nuevo.'), 'error');
        }
    }

    function setFileStatus(kind, message, isError) {
        const el = $('ast-ed-file-' + kind + '-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('is-error', !!isError);
    }

    async function uploadAsset(kind, input) {
        const ed = state.editor;
        const file = input.files && input.files[0];
        if (!ed || !file) return;
        const check = M.validateFile(kind, file);
        if (!check.ok) { setFileStatus(kind, check.error, true); input.value = ''; return; }
        const id = await ensureSaved();
        if (!id || state.editor !== ed) { input.value = ''; return; }
        ed.uploading += 1;
        updateEditorFooter();
        // ensureSaved puede volver a pintar los archivos: se usa el input vivo.
        const liveInput = () => $('ast-ed-file-' + kind);
        if (liveInput()) liveInput().disabled = true;
        setFileStatus(kind, 'Subiendo ' + file.name + ' · ' + formatBytes(file.size) + '…', false);
        try {
            const asset = await Store.uploadDesignAsset(state.uid, id, kind, file);
            ed.assets = ed.assets.filter((a) => a.kind !== kind).concat(asset);
            renderFiles();
            notify(kind === 'original' ? 'Subiste el original.' : 'Subiste el stencil.', 'success');
            const remove = document.querySelector('#ast-ed-files [data-kind="' + kind + '"] [data-file-remove]');
            if (remove) remove.focus();
            refresh({ products: true }).then(() => renderAll());
        } catch (err) {
            const live = liveInput();
            if (live) { live.disabled = false; live.value = ''; }
            setFileStatus(kind, errorText(err, 'No pudimos subir el archivo. Probá de nuevo.'), true);
        } finally {
            if (state.editor === ed) {
                ed.uploading -= 1;
                state.checklistSignature = '';
                updateEditorFooter();
            }
        }
    }

    async function removeAsset(assetId) {
        const ed = state.editor;
        const asset = ed && ed.assets.find((a) => String(a.id) === String(assetId));
        if (!asset) return;
        const label = asset.kind === 'original' ? 'el original' : 'el stencil';
        const { confirmed } = await confirmDialog({
            title: 'Quitar ' + label,
            message: 'Se borra «' + asset.file_name + '». Para publicar el diseño vas a tener que subir otro.',
            confirmLabel: 'Quitar archivo',
            cancelLabel: 'Volver',
            tone: 'danger'
        });
        if (!confirmed || state.editor !== ed) return;
        try {
            await Store.removeDesignAsset(asset);
            ed.assets = ed.assets.filter((a) => a.id !== asset.id);
            renderFiles();
            state.checklistSignature = '';
            updateEditorFooter();
            notify('Quitaste ' + label + '.', 'success');
            const input = $('ast-ed-file-' + asset.kind);
            if (input) input.focus();
            refresh({ products: true }).then(() => renderAll());
        } catch (err) {
            notify(errorText(err, 'No pudimos quitar el archivo. Probá de nuevo.'), 'error');
        }
    }

    function wireEditor() {
        const form = $('ast-ed-form');
        form.addEventListener('submit', (event) => { event.preventDefault(); saveEditor(); });
        form.addEventListener('input', (event) => {
            if (event.target.matches('input[type="file"]')) return;
            markDirty();
        });
        form.addEventListener('change', (event) => {
            const target = event.target;
            if (target.matches('#ast-ed-images-input')) { addImages(target.files); return; }
            if (target.matches('[data-file-kind]')) { uploadAsset(target.dataset.fileKind, target); return; }
            if (target.matches('[data-tier-toggle]')) {
                syncTierInputs();
                const input = $('ast-ed-tier-' + target.dataset.tierToggle + '-price');
                if (target.checked && input) input.focus();
            }
            if (target.matches('#ast-ed-ship-on, #ast-ed-pickup-on')) syncDeliveryFields();
            markDirty();
        });
        form.addEventListener('click', (event) => {
            const imgBtn = event.target.closest('[data-img-act]');
            if (imgBtn) {
                const index = Number(imgBtn.dataset.index);
                if (imgBtn.dataset.imgAct === 'up') moveImage(index, -1);
                else if (imgBtn.dataset.imgAct === 'down') moveImage(index, 1);
                else removeImage(index);
                return;
            }
            const fileBtn = event.target.closest('[data-file-remove]');
            if (fileBtn) { removeAsset(fileBtn.dataset.fileRemove); return; }
            const removeVariant = event.target.closest('[data-v-remove]');
            if (removeVariant) {
                const ed = state.editor;
                syncVariantsFromDom();
                const index = ed.variants.findIndex((v) => v.key === removeVariant.dataset.vRemove);
                ed.variants = ed.variants.filter((v) => v.key !== removeVariant.dataset.vRemove);
                renderVariants();
                markDirty();
                const rows = document.querySelectorAll('#ast-ed-variants [data-key]');
                const focusRow = rows[Math.min(index, rows.length - 1)];
                const target = focusRow ? focusRow.querySelector('[data-v-field="label"]') : $('ast-ed-variant-add');
                if (target) target.focus();
                return;
            }
            const goto = event.target.closest('[data-goto="ajustes"]');
            if (goto) gotoSettingsFromEditor();
        });
        $('ast-ed-variant-add').addEventListener('click', () => {
            const ed = state.editor;
            if (!ed) return;
            syncVariantsFromDom();
            const row = newVariantRow();
            ed.variants.push(row);
            renderVariants();
            markDirty();
            const input = $('ast-ed-v-' + row.key + '-label');
            if (input) input.focus();
        });
        $('ast-ed-close').addEventListener('click', requestCloseEditor);
        $('ast-ed-cancel').addEventListener('click', requestCloseEditor);
        $('ast-ed-publish').addEventListener('click', () => saveEditor({ publish: true }));
    }

    async function gotoSettingsFromEditor() {
        const ed = state.editor;
        if (ed && ed.dirty) {
            const { confirmed } = await confirmDialog({
                title: 'Tenés cambios sin guardar',
                message: 'Guardá el producto antes de ir a Ajustes o se pierden los cambios.',
                confirmLabel: 'Ir sin guardar',
                cancelLabel: 'Seguir editando',
                tone: 'danger'
            });
            if (!confirmed) return;
        }
        closeEditor();
        selectTab('ajustes');
        requestAnimationFrame(() => {
            const missing = !String((state.settings || {}).payment_instructions || '').trim() ? $('ast-set-payment')
                : !String((state.settings || {}).contact_channel || '').trim() ? $('ast-set-contact') : $('ast-set-authorship');
            if (missing) missing.focus();
        });
    }

    // ============================================
    // PEDIDOS
    // ============================================
    function filterCounts() {
        const counts = {};
        ORDER_FILTERS.forEach((f) => { counts[f.key] = state.orders.filter(f.match).length; });
        return counts;
    }

    function renderOrders() {
        renderOrdersContent();
        hydrateIcons($('ast-panel-pedidos'));
    }

    function renderOrdersContent() {
        const chips = $('ast-order-chips');
        const list = $('ast-order-list');
        if (state.errors.orders) {
            chips.innerHTML = '';
            setLiveText('ast-order-count', '');
            list.innerHTML = '<div class="wo-alert wo-alert--error ast-panel-error" role="alert"><i data-wo-icon="alert-triangle" class="wo-icon-18" aria-hidden="true"></i>' +
                '<span>No pudimos cargar tus pedidos. <button type="button" class="ast-linkbtn" data-act="reload">Volver a intentar →</button></span></div>';
            return;
        }
        const counts = filterCounts();
        if (!state.orderFilter) {
            const firstWithOrders = ORDER_FILTERS.find((f) => counts[f.key] > 0);
            state.orderFilter = firstWithOrders ? firstWithOrders.key : ORDER_FILTERS[0].key;
        }
        setHtml(chips, ORDER_FILTERS.map((f) => {
            const on = f.key === state.orderFilter;
            return '<button type="button" class="wo-chip' + (on ? ' is-active' : '') + '" data-filter="' + f.key + '" aria-pressed="' + on + '">' +
                esc(f.label) + ' <span class="ast-chipcount">' + counts[f.key] + '</span></button>';
        }).join(''));

        if (!state.orders.length) {
            setLiveText('ast-order-count', '');
            list.innerHTML = '<div class="wo-empty ast-empty">' +
                '<i data-wo-icon="shopping-bag" aria-hidden="true"></i>' +
                '<p class="wo-empty-title">Todavía no recibiste pedidos</p>' +
                '<p>Cuando alguien compre en tu Store, lo vas a ver acá para confirmar el pago y prepararlo.</p>' +
                (state.username ? '<a class="wo-btn wo-btn--ghost" href="' + esc(M.storeUrl(state.username)) + '">Ver tu Store pública →</a>' : '') +
                '</div>';
            return;
        }
        const filter = ORDER_FILTERS.find((f) => f.key === state.orderFilter) || ORDER_FILTERS[0];
        const rows = state.orders.filter(filter.match);
        setLiveText('ast-order-count', rows.length + ' ' + plural(rows.length, 'pedido', 'pedidos') + ' · ' + filter.label.toLowerCase());
        if (!rows.length) {
            setHtml(list, '<p class="ast-order-empty">' + esc(filter.empty) + '</p>');
            return;
        }
        setHtml(list, '<ul class="ast-orders">' + rows.map(orderRow).join('') + '</ul>');
    }

    function orderRow(order) {
        const v = M.orderView(order, { role: 'seller' });
        const item = v.item;
        let title = item ? item.title : 'Pedido';
        if (item && item.variantLabel) title += ' · ' + item.variantLabel;
        if (item && item.quantity > 1) title += ' × ' + item.quantity;
        const detail = item && item.tierLabel ? 'Licencia ' + item.tierLabel : v.methodLabel;
        const tags = ['<span class="' + esc(v.statusTag) + ' ast-tag-s">' + esc(v.statusLabel) + '</span>'];
        if (order.status === 'paid' && v.method !== 'digital' && v.fulfillmentLabel) tags.push('<span class="' + esc(v.fulfillmentTag) + ' ast-tag-s">' + esc(v.fulfillmentLabel) + '</span>');
        if (order.status === 'pending_payment' && v.paymentReported) tags.push('<span class="wo-tag wo-tag--info ast-tag-s">Pago informado</span>');
        if (v.overdue) tags.push('<span class="wo-tag wo-tag--urgent ast-tag-s">Plazo vencido</span>');
        const image = item && item.imagePath ? Store.previewUrl(item.imagePath) : '';
        const next = v.nextAction && v.nextAction.label ? v.nextAction.label + (v.nextAction.kind === 'action' ? ' →' : '') : '';
        return '<li><button type="button" class="ast-order" data-order="' + esc(order.id) + '">' +
            '<span class="ast-order-media" aria-hidden="true">' + (image ? '<img src="' + esc(image) + '" alt="" loading="lazy">' : '<i data-wo-icon="' + (v.kind === 'design' ? 'pen-tool' : 'package') + '"></i>') + '</span>' +
            '<span class="ast-order-main">' +
            '<span class="ast-order-num">' + esc(v.numberLabel) + '</span>' +
            '<span class="ast-order-title">' + esc(title) + '</span>' +
            '<span class="ast-order-meta">' + esc([order.buyer_name, M.formatDate(order.created_at), detail].filter(Boolean).join(' · ')) + '</span>' +
            '</span>' +
            '<span class="ast-order-side">' +
            '<span class="ast-order-total">' + esc(v.totals.totalLabel) + '</span>' +
            '<span class="ast-order-tags">' + tags.join('') + '</span>' +
            (next ? '<span class="ast-order-next">' + esc(next) + '</span>' : '') +
            '</span>' +
            '</button></li>';
    }

    function wireOrders() {
        $('ast-order-chips').addEventListener('click', (event) => {
            const chip = event.target.closest('[data-filter]');
            if (!chip) return;
            state.orderFilter = chip.dataset.filter;
            renderOrders();
            hydrateIcons($('ast-panel-pedidos'));
            const again = document.querySelector('#ast-order-chips [data-filter="' + cssEscape(chip.dataset.filter) + '"]');
            if (again) again.focus();
        });
        $('ast-order-list').addEventListener('click', (event) => {
            const reload = event.target.closest('[data-act="reload"]');
            if (reload) { reloadEverything(); return; }
            const row = event.target.closest('[data-order]');
            if (row) openOrder(row.dataset.order);
        });
    }

    function currentOrder() {
        return state.orders.find((o) => String(o.id) === String(state.orderId)) || null;
    }

    function openOrder(id, { modal = null } = {}) {
        const order = state.orders.find((o) => String(o.id) === String(id));
        if (!order) {
            notify('No encontramos ese pedido. Puede que ya no exista.', 'error');
            setParams({ pedido: null, modal: null });
            return;
        }
        if (state.editor) return;
        state.orderId = order.id;
        state.fulfillmentForm = null;
        selectTab('pedidos', { updateUrl: false });
        const filter = ORDER_FILTERS.find((f) => f.match(order));
        if (filter && filter.key !== state.orderFilter) { state.orderFilter = filter.key; renderOrders(); }
        renderOrderDrawer();
        openLayer($('ast-order'), {
            onRequestClose: () => closeOrder(),
            returnSelector: '[data-order="' + cssEscape(order.id) + '"]'
        });
        setParams({ pedido: order.id, tab: 'pedidos', modal: null, editar: null, nuevo: null });
        if (modal === 'confirmar-pago') openPaymentDialog(order);
    }

    function closeOrder({ restoreFocus = true } = {}) {
        closeLayer($('ast-order'), { restoreFocus });
        state.orderId = null;
        state.fulfillmentForm = null;
        setParams({ pedido: null, modal: null });
    }

    function kv(label, valueHtml) {
        if (!valueHtml) return '';
        return '<div class="ast-kv-row"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
    }

    function addressHtml(address) {
        const a = address || {};
        const lines = [
            a.recipient,
            a.line1,
            a.line2,
            [a.postal_code, a.city].filter(Boolean).join(' '),
            a.region,
            a.country ? (COUNTRY_NAMES[String(a.country).toUpperCase()] || a.country) : '',
            a.phone ? 'Tel. ' + a.phone : ''
        ].filter((line) => String(line || '').trim());
        return lines.map((line) => esc(line)).join('<br>');
    }

    function actionButton(action, extraClass) {
        const tone = action.tone === 'danger' ? ' wo-btn--danger' : action.tone === 'ghost' ? ' wo-btn--ghost' : ' wo-btn--direct';
        return '<button type="button" class="wo-btn wo-btn--s' + tone + (extraClass ? ' ' + extraClass : '') + '" data-or-act="' + esc(action.key) + '"' +
            (action.status ? ' data-status="' + esc(action.status) + '"' : '') +
            (action.requiresTracking ? ' data-tracking="1"' : '') + '>' + esc(action.label) + '</button>';
    }

    function fulfillmentFormHtml(order, form) {
        const isShip = form.status === 'shipped';
        const label = form.edit ? 'Editar seguimiento' : 'Pasar a «' + M.statusLabel(form.status) + '»';
        const req = form.requiresTracking ? ' <span class="req" aria-hidden="true">*</span>' : '';
        let fields = '';
        if (isShip) {
            fields += '<div class="ast-grid2">' +
                '<div class="wo-field"><label class="wo-label" for="ast-ful-carrier">Empresa de envío</label>' +
                '<input type="text" class="wo-input" id="ast-ful-carrier" maxlength="60" value="' + esc(order.tracking_carrier || '') + '" placeholder="Ej: Correo Argentino" aria-describedby="ast-ful-carrier-err">' +
                '<p class="wo-error-msg" id="ast-ful-carrier-err" hidden></p></div>' +
                '<div class="wo-field"><label class="wo-label" for="ast-ful-code">Código de seguimiento' + req + '</label>' +
                '<input type="text" class="wo-input" id="ast-ful-code" maxlength="80" value="' + esc(order.tracking_code || '') + '" aria-describedby="ast-ful-code-err">' +
                '<p class="wo-error-msg" id="ast-ful-code-err" hidden></p></div>' +
                '</div>' +
                '<div class="wo-field"><label class="wo-label" for="ast-ful-url">Link de seguimiento</label>' +
                '<input type="url" class="wo-input" id="ast-ful-url" maxlength="500" value="' + esc(order.tracking_url || '') + '" placeholder="https://" aria-describedby="ast-ful-url-help ast-ful-url-err">' +
                '<p class="wo-help" id="ast-ful-url-help">' + (form.requiresTracking ? 'Necesitás el código o el link para marcarlo como enviado. ' : '') + 'El link tiene que empezar con https://.</p>' +
                '<p class="wo-error-msg" id="ast-ful-url-err" hidden></p></div>';
        }
        fields += '<div class="wo-field"><label class="wo-label" for="ast-ful-message">Mensaje para quien compra (opcional)</label>' +
            '<textarea class="wo-textarea" id="ast-ful-message" maxlength="1000" rows="3" placeholder="' + (isShip ? 'Ej: Salió hoy por correo, llega en 5 días hábiles.' : form.status === 'ready_for_pickup' ? 'Ej: Ya está listo. Pasá de martes a sábado de 12 a 19 h.' : 'Ej: Lo estoy preparando, sale esta semana.') + '" aria-describedby="ast-ful-message-help"></textarea>' +
            '<p class="wo-help" id="ast-ful-message-help">Lo ve quien compra en el detalle de su pedido.</p></div>';
        return '<form class="ast-ful-form" id="ast-ful-form" novalidate aria-labelledby="ast-ful-title">' +
            '<h4 class="ast-ful-title" id="ast-ful-title">' + esc(label) + '</h4>' + fields +
            '<p class="wo-error-msg" id="ast-ful-error" role="alert" hidden></p>' +
            '<div class="ast-form-actions">' +
            '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-or-act="ful-cancel">Cancelar</button>' +
            '<button type="submit" class="wo-btn wo-btn--direct wo-btn--s" id="ast-ful-submit">Confirmar</button>' +
            '</div></form>';
    }

    function renderOrderDrawer() {
        const order = currentOrder();
        const body = $('ast-or-body');
        if (!order) { body.innerHTML = ''; return; }
        const v = M.orderView(order, { role: 'seller' });
        setText('ast-or-title', v.numberLabel);
        const headTags = ['<span class="' + esc(v.statusTag) + ' ast-tag-s">' + esc(v.statusLabel) + '</span>'];
        if (order.status === 'paid' && v.method !== 'digital' && v.fulfillmentLabel) headTags.push('<span class="' + esc(v.fulfillmentTag) + ' ast-tag-s">' + esc(v.fulfillmentLabel) + '</span>');
        $('ast-or-tags').innerHTML = headTags.join('');

        const actions = v.actions || [];
        const byKey = (key) => actions.filter((a) => a.key === key);
        const sections = [];

        // Aviso principal
        const alerts = [];
        // platform_confirms y awaiting_delivery se explican dentro de Pago y Envío.
        const contextual = ['platform_confirms', 'awaiting_delivery'];
        if (v.nextAction && v.nextAction.kind === 'info' && !contextual.includes(v.nextAction.key)) alerts.push('<div class="wo-alert wo-alert--info"><i data-wo-icon="info" class="wo-icon-18" aria-hidden="true"></i><span>' + esc(v.nextAction.label) + '</span></div>');
        if (v.overdue) alerts.push('<div class="wo-alert wo-alert--warning"><i data-wo-icon="clock" class="wo-icon-18" aria-hidden="true"></i><span>' + esc(v.paymentReported ? 'Venció el plazo de pago, pero quien compra informó un pago. Si lo recibiste, confirmalo.' : 'Venció el plazo de pago y no hay pago informado. El pedido se va a cerrar solo.') + '</span></div>');
        if (v.needsSupport) alerts.push('<div class="wo-alert wo-alert--warning"><i data-wo-icon="alert-triangle" class="wo-icon-18" aria-hidden="true"></i><span>Soporte está revisando este pedido.</span></div>');
        if (alerts.length) sections.push('<div class="ast-or-alerts">' + alerts.join('') + '</div>');

        // Ítem
        const item = v.item;
        if (item) {
            const image = item.imagePath ? Store.previewUrl(item.imagePath) : '';
            const lines = [];
            if (item.variantLabel) lines.push(esc(item.variantLabel));
            lines.push(esc(item.quantity + ' × ' + M.formatMoney(item.unitPrice, v.currency)));
            let license = '';
            if (item.tierLabel) {
                license = '<p class="ast-or-license">Licencia ' + esc(item.tierLabel) + (item.holderName ? ' · titular: ' + esc(item.holderName) : '') + '</p>';
            }
            if (v.license) {
                license += '<p class="ast-or-license"><span class="wo-mono-num">' + esc(v.license.code || '') + '</span> · <span class="' + esc(v.license.statusTag) + ' ast-tag-s">' + esc(v.license.statusLabel) + '</span></p>' +
                    (v.license.id ? '<p><a class="ast-link" href="' + esc(M.licenseUrl(v.license.id)) + '">Ver certificado →</a></p>' : '');
            }
            sections.push('<section class="ast-or-section" aria-labelledby="ast-or-item-h"><h3 class="ast-or-h" id="ast-or-item-h" tabindex="-1">' + (item.kind === 'design' ? 'Diseño' : 'Producto') + '</h3>' +
                '<div class="ast-or-item">' +
                '<span class="ast-or-thumb" aria-hidden="true">' + (image ? '<img src="' + esc(image) + '" alt="" loading="lazy">' : '<i data-wo-icon="' + (item.kind === 'design' ? 'pen-tool' : 'package') + '"></i>') + '</span>' +
                '<div><p class="ast-or-item-title">' + esc(item.title) + '</p><p class="ast-or-item-meta">' + lines.join(' · ') + '</p>' + license + '</div>' +
                '</div>' +
                '<dl class="ast-kv">' +
                kv('Subtotal', esc(v.totals.subtotalLabel)) +
                (v.method !== 'digital' ? kv('Envío', esc(v.totals.shippingLabel)) : '') +
                kv('Total', '<strong class="wo-mono-num">' + esc(v.totals.totalLabel) + '</strong>') +
                '</dl></section>');
        }

        // Comprador
        sections.push('<section class="ast-or-section" aria-labelledby="ast-or-buyer-h"><h3 class="ast-or-h" id="ast-or-buyer-h" tabindex="-1">Quien compra</h3><dl class="ast-kv">' +
            kv('Nombre', esc(order.buyer_name || '—')) +
            kv('Email', order.buyer_email ? '<a class="ast-link" href="mailto:' + esc(order.buyer_email) + '">' + esc(order.buyer_email) + '</a>' : '') +
            kv('Teléfono', order.buyer_phone ? esc(order.buyer_phone) : '') +
            kv('Pedido creado', esc(M.formatDateTime(order.created_at))) +
            '</dl>' +
            (order.buyer_note ? '<div class="ast-or-note"><p class="ast-or-note-label">Nota de quien compra</p><p class="ast-pre">' + esc(order.buyer_note) + '</p></div>' : '') +
            '</section>');

        // Entrega
        let delivery = '';
        if (v.method === 'shipping') delivery = order.shipping_address ? '<p class="ast-address">' + addressHtml(order.shipping_address) + '</p>' : '<p>Sin dirección cargada.</p>';
        else if (v.method === 'pickup') {
            const pickup = order.pickup_details || ((state.settings || {}).pickup_address) || '';
            delivery = '<p>' + esc(order.pickup_details ? 'Retira en: ' + pickup : (pickup ? 'Retira en tu dirección de retiro: ' + pickup + '. Se la mostramos a quien compra cuando confirmás el pago.' : 'Retira en el estudio. Cargá la dirección de retiro en Ajustes.')) + '</p>';
        } else delivery = '<p>Descarga digital: quien compra baja el original, el stencil y el certificado desde su cuenta cuando confirmás el pago.</p>';
        sections.push('<section class="ast-or-section" aria-labelledby="ast-or-delivery-h"><h3 class="ast-or-h" id="ast-or-delivery-h" tabindex="-1">Entrega · ' + esc(v.methodLabel) + '</h3>' + delivery + '</section>');

        // Pago
        const payments = (order.payments || order.store_payments || []).map((p) =>
            '<li><span class="wo-mono-num">' + esc(M.formatMoney(p.amount, p.currency)) + '</span> · ' + esc(PAYMENT_STATUS[p.status] || p.status) +
            (p.reference ? ' · ' + esc(p.reference) : '') + ' · ' + esc(M.formatDateTime(p.created_at)) + '</li>').join('');
        const confirm = byKey('confirm_payment');
        let paymentBody = '<p class="ast-or-collector">' + esc(COLLECTOR_COPY[v.collector] || COLLECTOR_COPY.seller) + '</p>';
        if (order.status === 'pending_payment') {
            paymentBody += '<dl class="ast-kv">' +
                kv('Pago informado', v.paymentReported
                    ? esc(M.formatDateTime(order.buyer_payment_reported_at)) + (v.paymentReference ? '<br><span class="wo-mono-num">' + esc(v.paymentReference) + '</span>' : '')
                    : 'Todavía no lo informó.') +
                kv('Plazo para pagar', v.expiresLabel ? esc(v.expiresLabel) : '') +
                '</dl>';
        } else if (order.paid_at) {
            paymentBody += '<dl class="ast-kv">' + kv('Pago confirmado', esc(M.formatDateTime(order.paid_at))) +
                (order.buyer_payment_reference ? kv('Referencia informada', '<span class="wo-mono-num">' + esc(order.buyer_payment_reference) + '</span>') : '') + '</dl>';
        }
        if (order.payment_instructions) {
            paymentBody += '<details class="ast-details"><summary>Instrucciones de pago que recibió</summary><p class="ast-pre">' + esc(order.payment_instructions) + '</p></details>';
        }
        if (payments) paymentBody += '<p class="ast-or-note-label">Registro de pagos</p><ul class="ast-payments">' + payments + '</ul>';
        if (confirm.length) paymentBody += '<div class="ast-or-actions">' + confirm.map((a) => actionButton(a)).join('') + '</div>';
        else if (order.status === 'pending_payment' && v.collector !== 'seller') paymentBody += '<p class="wo-help">Lo confirma soporte de We Ötzi cuando recibe el pago.</p>';
        sections.push('<section class="ast-or-section" aria-labelledby="ast-or-pay-h"><h3 class="ast-or-h" id="ast-or-pay-h" tabindex="-1">Pago</h3>' + paymentBody + '</section>');

        // Envío (merch pagado o completado)
        if (v.method !== 'digital' && (order.status === 'paid' || order.status === 'fulfilled')) {
            const flow = (M.FULFILLMENT_FLOWS && M.FULFILLMENT_FLOWS[v.method]) || [];
            const current = flow.indexOf(v.fulfillmentStatus);
            const stepper = '<ol class="ast-stepper" aria-label="Estado del envío">' + flow.map((s, i) =>
                '<li class="ast-step' + (i < current ? ' is-done' : '') + (i === current ? ' is-current' : '') + '"' + (i === current ? ' aria-current="step"' : '') + '>' +
                '<span class="ast-step-dot" aria-hidden="true">' + (i < current ? '<i data-wo-icon="check" class="wo-icon-18"></i>' : (i + 1)) + '</span>' +
                '<span class="ast-step-label">' + esc(M.statusLabel(s)) + '</span></li>').join('') + '</ol>';
            let shipBody = stepper;
            if (v.tracking) {
                shipBody += '<dl class="ast-kv">' +
                    kv('Empresa', v.tracking.carrier ? esc(v.tracking.carrier) : '') +
                    kv('Código', v.tracking.code ? '<span class="wo-mono-num">' + esc(v.tracking.code) + '</span>' : '') +
                    kv('Seguimiento', v.tracking.url ? '<a class="ast-link" href="' + esc(v.tracking.url) + '" target="_blank" rel="noopener noreferrer">Abrir seguimiento →</a>' : '') +
                    '</dl>';
            }
            if (order.seller_message) shipBody += '<div class="ast-or-note"><p class="ast-or-note-label">Tu último mensaje</p><p class="ast-pre">' + esc(order.seller_message) + '</p></div>';
            const steps = byKey('fulfillment').concat(byKey('edit_tracking'));
            if (state.fulfillmentForm) shipBody += fulfillmentFormHtml(order, state.fulfillmentForm);
            else if (steps.length) shipBody += '<div class="ast-or-actions">' + steps.map((a) => actionButton(a)).join('') + '</div>';
            else if (order.status === 'paid' && v.usesWallet && (v.fulfillmentStatus === 'shipped' || v.fulfillmentStatus === 'ready_for_pickup')) shipBody += '<p class="wo-help">Esperando que quien compra confirme la entrega. Si no lo hace, se marca como entregado solo.</p>';
            sections.push('<section class="ast-or-section" aria-labelledby="ast-or-ship-h"><h3 class="ast-or-h" id="ast-or-ship-h" tabindex="-1">Envío</h3>' + shipBody + '</section>');
        }

        // Historial
        sections.push('<section class="ast-or-section" aria-labelledby="ast-or-tl-h"><h3 class="ast-or-h" id="ast-or-tl-h" tabindex="-1">Historial</h3><ol class="ast-timeline">' +
            v.timeline.map((step) => '<li class="ast-tl-step' + (step.done ? ' is-done' : '') + (step.current ? ' is-current' : '') + (step.skipped ? ' is-skipped' : '') + (step.terminal ? ' is-terminal' : '') + '">' +
                '<span class="ast-tl-dot" aria-hidden="true"></span><span class="ast-tl-text"><span class="ast-tl-label">' + esc(step.label) + '</span>' +
                (step.atLabel ? '<span class="ast-tl-at">' + esc(step.atLabel) + '</span>' : (step.skipped ? '<span class="ast-tl-at">No sucedió</span>' : (!step.done ? '<span class="ast-tl-at">Pendiente</span>' : ''))) +
                '</span></li>').join('') + '</ol>' +
            (order.cancel_reason ? '<div class="ast-or-note"><p class="ast-or-note-label">Motivo</p><p class="ast-pre">' + esc(order.cancel_reason) + '</p></div>' : '') +
            '</section>');

        // Otras acciones
        const other = byKey('cancel').concat(byKey('refund'));
        if (other.length) {
            sections.push('<section class="ast-or-section" aria-labelledby="ast-or-more-h"><h3 class="ast-or-h" id="ast-or-more-h" tabindex="-1">Otras acciones</h3>' +
                (byKey('refund').length ? '<p class="wo-help">Reembolsá solo si ya le devolviste el dinero a quien compra' + (v.kind === 'design' ? ': la licencia se revoca.' : '.') + '</p>' : '') +
                '<div class="ast-or-actions">' + other.map((a) => actionButton(a)).join('') + '</div></section>');
        }

        body.innerHTML = sections.join('');
        hydrateIcons($('ast-order'));
    }

    async function afterOrderChange(message, focusSelector) {
        await refresh({ orders: true, products: true, sales: true });
        renderAll();
        if (state.orderId && !currentOrder()) {
            closeOrder({ restoreFocus: false });
            notify(message, 'success');
            return;
        }
        renderOrderDrawer();
        notify(message, 'success');
        requestAnimationFrame(() => {
            const target = (focusSelector && document.querySelector(focusSelector)) || dialogOf($('ast-order'));
            if (target && !$('ast-order').hidden) target.focus({ preventScroll: true });
        });
    }

    function wireOrderDrawer() {
        $('ast-or-close').addEventListener('click', () => closeOrder());
        const body = $('ast-or-body');
        body.addEventListener('click', async (event) => {
            const btn = event.target.closest('[data-or-act]');
            if (!btn) return;
            const order = currentOrder();
            if (!order) return;
            const act = btn.dataset.orAct;
            if (act === 'confirm_payment') { openPaymentDialog(order); return; }
            if (act === 'fulfillment' || act === 'edit_tracking') {
                const status = btn.dataset.status;
                const view = M.orderView(order, { role: 'seller' });
                const requiresTracking = act === 'edit_tracking'
                    ? M.requiresTracking('shipped', { usesWallet: view.usesWallet })
                    : btn.dataset.tracking === '1';
                state.fulfillmentForm = { status, requiresTracking, edit: act === 'edit_tracking' };
                renderOrderDrawer();
                requestAnimationFrame(() => {
                    const first = $('ast-ful-carrier') || $('ast-ful-message');
                    if (first) first.focus();
                });
                return;
            }
            if (act === 'ful-cancel') {
                state.fulfillmentForm = null;
                renderOrderDrawer();
                requestAnimationFrame(() => {
                    const again = body.querySelector('[data-or-act="fulfillment"], [data-or-act="edit_tracking"]');
                    if (again) again.focus();
                });
                return;
            }
            if (act === 'cancel') { cancelOrder(order); return; }
            if (act === 'refund') refundOrder(order);
        });
        body.addEventListener('submit', (event) => {
            if (event.target.id !== 'ast-ful-form') return;
            event.preventDefault();
            submitFulfillment();
        });
    }

    async function submitFulfillment() {
        const order = currentOrder();
        const form = state.fulfillmentForm;
        if (!order || !form) return;
        const isShip = form.status === 'shipped';
        ['ast-ful-carrier', 'ast-ful-code', 'ast-ful-url'].forEach((id) => showFieldError(id, ''));
        const errorBox = $('ast-ful-error');
        errorBox.hidden = true;
        let tracking = { tracking_carrier: null, tracking_code: null, tracking_url: null };
        if (isShip) {
            const check = M.validateTracking({ carrier: val('ast-ful-carrier'), code: val('ast-ful-code'), url: val('ast-ful-url') }, { required: form.requiresTracking });
            if (!check.ok) {
                if (check.errors.carrier) showFieldError('ast-ful-carrier', check.errors.carrier);
                if (check.errors.code) showFieldError('ast-ful-code', check.errors.code);
                if (check.errors.url) showFieldError('ast-ful-url', check.errors.url);
                const first = ['ast-ful-carrier', 'ast-ful-code', 'ast-ful-url'].map($).find((el) => el && el.getAttribute('aria-invalid') === 'true');
                if (first) first.focus();
                return;
            }
            tracking = check.value;
        }
        const submit = $('ast-ful-submit');
        setBusy(submit, true, 'Guardando…');
        try {
            await Store.updateFulfillment(order.id, {
                status: form.status,
                trackingCarrier: tracking.tracking_carrier,
                trackingCode: tracking.tracking_code,
                trackingUrl: tracking.tracking_url,
                sellerMessage: val('ast-ful-message').trim() || null
            });
            state.fulfillmentForm = null;
            const label = form.edit ? 'Actualizaste el seguimiento' : 'Pasaste el pedido a «' + M.statusLabel(form.status) + '»';
            await afterOrderChange(label + ' · ' + (order.order_number ? 'Pedido #' + order.order_number : 'pedido') + '.', '#ast-or-ship-h');
        } catch (err) {
            if (submit.isConnected) setBusy(submit, false);
            const message = errorText(err, 'No pudimos actualizar el envío. Probá de nuevo.');
            if (errorBox.isConnected) { errorBox.textContent = message; errorBox.hidden = false; }
            notify(message, 'error');
        }
    }

    async function cancelOrder(order) {
        const { confirmed, value } = await confirmDialog({
            title: 'Cancelar el pedido',
            message: 'El pedido se cancela y el stock o la reserva vuelven a quedar disponibles. Contale a quien compra el motivo.',
            confirmLabel: 'Cancelar pedido',
            cancelLabel: 'Volver',
            tone: 'danger',
            input: { label: 'Motivo (opcional)', maxLength: 300, placeholder: 'Ej: No recibí el pago a tiempo.' }
        });
        if (!confirmed) return;
        try {
            await Store.cancelOrder(order.id, value || null);
            await afterOrderChange('Cancelaste el pedido #' + order.order_number + '.');
        } catch (err) {
            notify(errorText(err, 'No pudimos cancelar el pedido. Probá de nuevo.'), 'error');
        }
    }

    async function refundOrder(order) {
        const view = M.orderView(order, { role: 'seller' });
        const action = (view.actions || []).find((a) => a.key === 'refund');
        const { confirmed, value } = await confirmDialog({
            title: 'Reembolsar el pedido',
            message: (action && action.confirm) || 'Confirmá que ya le devolviste el dinero.',
            confirmLabel: 'Ya lo devolví · reembolsar',
            cancelLabel: 'Volver',
            tone: 'danger',
            input: { label: 'Motivo (opcional)', maxLength: 300, placeholder: view.kind === 'design' ? 'Ej: Quien compra se arrepintió antes de usar la licencia.' : 'Ej: Me quedé sin stock del talle.' }
        });
        if (!confirmed) return;
        try {
            await Store.refundOrder(order.id, value || null);
            await afterOrderChange('Registraste el reembolso del pedido #' + order.order_number + '.');
        } catch (err) {
            notify(errorText(err, 'No pudimos registrar el reembolso. Probá de nuevo.'), 'error');
        }
    }

    // ---------- Confirmar pago ----------
    function openPaymentDialog(order) {
        if (!order) return;
        if (order.status !== 'pending_payment') {
            notify('Este pedido ya no está esperando pago.', 'info');
            setParams({ modal: null });
            return;
        }
        if (order.expected_collector !== 'seller') {
            notify('Este pago lo confirma soporte de We Ötzi cuando lo recibe.', 'info');
            setParams({ modal: null });
            return;
        }
        const view = M.orderView(order, { role: 'seller' });
        state.paymentOrderId = order.id;
        $('ast-pay-summary').innerHTML =
            kv('Pedido', esc(view.numberLabel)) +
            kv('Total', '<strong class="wo-mono-num">' + esc(view.totals.totalLabel) + '</strong>') +
            kv('Quien compra', esc(order.buyer_name || '—')) +
            kv('Pago informado', view.paymentReported
                ? esc(M.formatDateTime(order.buyer_payment_reported_at)) + (view.paymentReference ? ' · ' + esc(view.paymentReference) : '')
                : 'Todavía no lo informó.');
        $('ast-pay-reference').value = order.buyer_payment_reference || '';
        $('ast-pay-note').value = '';
        const error = $('ast-pay-error');
        error.hidden = true;
        error.textContent = '';
        openLayer($('ast-dlg-payment'), {
            initialFocus: $('ast-pay-reference'),
            onRequestClose: closePaymentDialog,
            returnSelector: '#ast-or-body [data-or-act="confirm_payment"]'
        });
        setParams({ pedido: order.id, modal: 'confirmar-pago' });
    }

    function closePaymentDialog() {
        closeLayer($('ast-dlg-payment'));
        state.paymentOrderId = null;
        setParams({ modal: null });
    }

    function wirePaymentDialog() {
        $('ast-pay-cancel').addEventListener('click', closePaymentDialog);
        $('ast-pay-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const order = state.orders.find((o) => String(o.id) === String(state.paymentOrderId));
            if (!order) { closePaymentDialog(); return; }
            const submit = $('ast-pay-submit');
            const error = $('ast-pay-error');
            error.hidden = true;
            setBusy(submit, true, 'Confirmando…');
            try {
                await Store.confirmPayment(order.id, {
                    collectedBy: order.expected_collector,
                    reference: val('ast-pay-reference').trim() || null,
                    note: val('ast-pay-note').trim() || null
                });
                setBusy(submit, false);
                closeLayer($('ast-dlg-payment'), { restoreFocus: false });
                state.paymentOrderId = null;
                setParams({ modal: null });
                const isDesign = (order.items || order.store_order_items || []).some((i) => i.kind === 'design');
                await afterOrderChange('Confirmaste el pago del pedido #' + order.order_number + '.' +
                    (isDesign ? ' La licencia ya está emitida.' : ' Ahora preparalo para el envío.'), '#ast-or-pay-h');
            } catch (err) {
                setBusy(submit, false);
                const message = errorText(err, 'No pudimos confirmar el pago. Probá de nuevo.');
                error.textContent = message;
                error.hidden = false;
                notify(message, 'error');
            }
        });
    }

    // ============================================
    // AJUSTES
    // ============================================
    function fillSettingsForm() {
        const form = $('ast-settings-form');
        if (!form || form.dataset.dirty === '1') return;
        const s = state.settings || {};
        $('ast-set-tagline').value = s.store_tagline || '';
        $('ast-set-contact').value = s.contact_channel || '';
        $('ast-set-payment').value = s.payment_instructions || '';
        $('ast-set-shipping').value = s.shipping_policy || '';
        $('ast-set-returns').value = s.return_policy || '';
        $('ast-set-pickup').value = s.pickup_address || '';
        $('ast-set-authorship').checked = !!s.authorship_attested_at;
        setText('ast-set-authorship-help', s.authorship_attested_at
            ? 'Confirmada el ' + M.formatDate(s.authorship_attested_at) + '. Es obligatoria para publicar diseños con licencia.'
            : 'Es obligatoria para publicar diseños con licencia.');
        const error = $('ast-settings-error');
        if (state.errors.settings) {
            error.textContent = 'No pudimos cargar tus ajustes. Recargá la página antes de guardar.';
            error.dataset.kind = 'load';
            error.hidden = false;
        } else if (error.dataset.kind === 'load') {
            error.textContent = '';
            delete error.dataset.kind;
            error.hidden = true;
        }
    }

    function wireSettings() {
        const form = $('ast-settings-form');
        form.addEventListener('input', () => { form.dataset.dirty = '1'; });
        form.addEventListener('change', () => { form.dataset.dirty = '1'; });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const error = $('ast-settings-error');
            error.hidden = true;
            showFieldError('ast-set-contact', '');
            showFieldError('ast-set-payment', '');
            const attested = $('ast-set-authorship').checked;
            const current = state.settings || {};
            const patch = {
                store_tagline: val('ast-set-tagline'),
                contact_channel: val('ast-set-contact'),
                payment_instructions: val('ast-set-payment'),
                shipping_policy: val('ast-set-shipping'),
                return_policy: val('ast-set-returns'),
                pickup_address: val('ast-set-pickup'),
                // Cualquier valor no nulo vale como «confirmo»; la fecha la pone el servidor.
                authorship_attested_at: attested ? (current.authorship_attested_at || new Date().toISOString()) : null
            };
            const button = $('ast-settings-save');
            setBusy(button, true, 'Guardando…');
            try {
                const saved = await Store.saveSellerSettings(SELLER_TYPE, state.uid, patch);
                state.settings = saved || Object.assign({}, current, patch);
                state.errors.settings = null;
                form.dataset.dirty = '';
                renderAll();
                const missing = settingsMissing();
                notify(missing.length ? 'Guardaste tus ajustes. Para publicar todavía falta ' + missing.join(' y ') + '.' : 'Guardaste los ajustes de tu Store.', 'success');
                if (missing.length) {
                    if (missing.includes('las instrucciones de pago')) showFieldError('ast-set-payment', 'Requerido para publicar.');
                    if (missing.includes('el canal de contacto')) showFieldError('ast-set-contact', 'Requerido para publicar.');
                }
            } catch (err) {
                const message = errorText(err, 'No pudimos guardar tus ajustes. Probá de nuevo.');
                error.textContent = message;
                error.hidden = false;
                notify(message, 'error');
            } finally {
                setBusy(button, false);
            }
        });
    }

    // ============================================
    // CABLEADO Y RUTEO
    // ============================================
    function wireStatic() {
        wireTabs();
        wireProductLists();
        wireOrders();
        wireOrderDrawer();
        wireEditor();
        wirePaymentDialog();
        wireConfirmDialog();
        wireSettings();
        $('ast-new-design').addEventListener('click', () => openEditor({ kind: 'design' }));
        $('ast-new-merch').addEventListener('click', () => openEditor({ kind: 'merch' }));
        $('ast-setup-alert-go').addEventListener('click', () => {
            selectTab('ajustes');
            requestAnimationFrame(() => {
                const s = state.settings || {};
                const target = !String(s.payment_instructions || '').trim() ? $('ast-set-payment') : $('ast-set-contact');
                target.focus();
            });
        });
    }

    async function routeFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const orderId = params.get('pedido');
        let tab = params.get('tab');
        if (!TABS.includes(tab)) tab = orderId ? 'pedidos' : (TABS.includes(state.tab) ? state.tab : 'disenos');
        selectTab(tab, { updateUrl: false });
        const editId = params.get('editar');
        const nuevo = params.get('nuevo');
        if (editId) await openEditor({ id: editId });
        else if (NEW_KIND[nuevo]) await openEditor({ kind: NEW_KIND[nuevo] });
        else if (orderId) openOrder(orderId, { modal: params.get('modal') });
        else if (params.get('modal')) setParams({ modal: null });
    }
})();
