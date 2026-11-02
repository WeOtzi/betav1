// ============================================
// We Ötzi — Panel de Supplies (/supplies/dashboard)
// Pestañas: Inicio, Pedidos, Catálogo, Beneficios, Clientes, Reportes,
// Perfil y Cuenta (docs/plans/2026-10-30-estudios-plataforma.md → Supplies).
//
// Datos solo vía window.WeotziData.Supplies (supplies-repo.js); UI con
// window.WeOtziStudioKit (modales, drawer, tablas, toasts, CSV, postNotify).
// Cada acción sobre un pedido llama a vendor_update_supply_order y después a
// POST /api/supplies/notify {kind:'order_*', order_id}: si el aviso falla, el
// cambio guardado no se revierte.
//
// Los helpers puros (acciones por estado, validaciones, agregados de
// reportes) se exportan a Node (module.exports) para los tests y quedan en
// window.WeOtziSuppliesDashboard. El arranque solo corre en el navegador.
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) {
        window.WeOtziSuppliesDashboard = api;
        if (window.document && typeof window.document.addEventListener === 'function') {
            window.document.addEventListener('DOMContentLoaded', () => api.boot());
        }
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    // -------------------------------------------------------------
    // Constantes
    // -------------------------------------------------------------
    const TABS = ['inicio', 'pedidos', 'catalogo', 'beneficios', 'clientes', 'reportes', 'perfil', 'cuenta'];
    const DEFAULT_TAB = 'inicio';
    const TAB_PATTERN = /^[a-z]+$/;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const NOTIFY_PATH = '/api/supplies/notify';
    const PHOTO_BUCKET = 'supply-photos';
    const ORDER_FILTERS = ['all', 'submitted', 'confirmed', 'shipped', 'delivered', 'received', 'rejected', 'cancelled'];
    const SALE_STATUSES = ['confirmed', 'shipped', 'delivered', 'received'];
    const ACTIONS_BY_STATUS = { submitted: ['confirm', 'reject'], confirmed: ['ship', 'cancel'], shipped: ['deliver'] };
    const ACTION_KIND = {
        confirm: 'order_confirmed',
        reject: 'order_rejected',
        ship: 'order_shipped',
        deliver: 'order_delivered',
        cancel: 'order_cancelled'
    };
    const ACTION_DONE = {
        confirm: 'Pedido confirmado.',
        reject: 'Pedido rechazado.',
        ship: 'Pedido despachado.',
        deliver: 'Pedido marcado como entregado.',
        cancel: 'Pedido cancelado. El stock reservado volvió a tu catálogo.'
    };
    const CATEGORIES = ['inks', 'needles_cartridges', 'gloves', 'paper_film', 'hygiene', 'aftercare', 'machines', 'power_supplies', 'furniture', 'piercing', 'other'];
    const REPORT_PRESETS = ['this_month', 'last_month', 'last_3_months', 'last_6_months', 'last_12_months', 'this_year'];
    const TOP_PRODUCTS_ORDER_CAP = 60;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // -------------------------------------------------------------
    // Helpers puros
    // -------------------------------------------------------------
    function text(v) { return String(v == null ? '' : v).trim(); }
    function isBlank(v) { return v == null || text(v) === ''; }

    // '1.234,50' / '1234.5' / 12 → número; '' / null → null; basura → NaN.
    function parseAmount(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
        const raw = text(v);
        if (!raw) return null;
        const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
        const n = Number(normalized);
        return Number.isFinite(n) ? n : NaN;
    }
    function round2(n) { return Math.round(n * 100) / 100; }
    function toCents(v) {
        const n = Number(v);
        return Number.isFinite(n) ? Math.round(n * 100) : 0;
    }
    function addTotals(map, currency, amount) {
        const cur = text(currency).toUpperCase() || 'ARS';
        map[cur] = (map[cur] || 0) + toCents(amount);
        return map;
    }
    function centsMapToUnits(map) {
        const out = {};
        Object.keys(map).sort().forEach(cur => { out[cur] = map[cur] / 100; });
        return out;
    }
    function httpUrl(v) {
        const s = text(v);
        if (!s) return null;
        const kit = root && root.WeOtziStudioKit;
        if (kit && typeof kit.safeUrl === 'function') return kit.safeUrl(s);
        return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s) ? s : null;
    }
    function parseCountries(value) {
        const list = Array.isArray(value) ? value : text(value).split(/[\s,;]+/);
        const items = [];
        const invalid = [];
        list.map(text).filter(Boolean).forEach(part => {
            const code = part.toUpperCase();
            if (!/^[A-Z]{2}$/.test(code)) invalid.push(part);
            else if (!items.includes(code)) items.push(code);
        });
        return { items, invalid };
    }

    // Acciones del proveedor según el estado del pedido.
    function orderActions(status) { return (ACTIONS_BY_STATUS[status] || []).slice(); }
    function notifyKind(action) { return ACTION_KIND[action] || null; }

    function orderDate(order) {
        return (order && (order.confirmed_at || order.submitted_at || order.created_at)) || null;
    }

    // filterOrders(orders, {status:'all'|estado, query}) → pedidos filtrados.
    function filterOrders(orders, opts) {
        const o = opts || {};
        const status = o.status && o.status !== 'all' ? o.status : null;
        const q = text(o.query).toLowerCase();
        return (Array.isArray(orders) ? orders : []).filter(order => {
            if (!order) return false;
            if (status && order.status !== status) return false;
            if (!q) return true;
            const studio = order.studios || {};
            const haystack = [order.order_number, studio.name, studio.city, order.tracking_code].map(v => text(v).toLowerCase()).join(' ');
            return haystack.includes(q);
        });
    }

    function countByStatus(orders) {
        const counts = { all: 0 };
        (Array.isArray(orders) ? orders : []).forEach(order => {
            if (!order) return;
            counts.all += 1;
            counts[order.status] = (counts[order.status] || 0) + 1;
        });
        return counts;
    }

    // ¿El pedido entra en envío gratis? Misma regla que vendor_update_supply_order.
    function freeShippingApplies(order, vendor) {
        const threshold = vendor && vendor.free_shipping_threshold;
        if (threshold == null || threshold === '') return false;
        const net = toCents(order && order.subtotal) - toCents(order && order.discount_amount);
        return net >= toCents(threshold);
    }

    // Líneas cuyo producto controla stock y no alcanza (chequeo blando: el
    // servidor vuelve a validarlo con FOR UPDATE al confirmar).
    function stockWarnings(order, productsById) {
        const byId = productsById || {};
        return ((order && order.supply_order_items) || []).reduce((out, item) => {
            const product = item && item.product_id ? byId[item.product_id] : null;
            if (!product || product.stock_quantity == null) return out;
            if (Number(product.stock_quantity) < Number(item.quantity)) {
                out.push({ name: item.product_name || product.name, stock: Number(product.stock_quantity), quantity: Number(item.quantity) });
            }
            return out;
        }, []);
    }

    // Valida el formulario de producto → {errors:{campo: mensaje}, payload}.
    function validateProduct(values, vendor) {
        const v = values || {};
        const errors = {};
        const name = text(v.name);
        if (!name) errors.name = 'Escribí el nombre del producto.';
        else if (name.length > 160) errors.name = 'El nombre puede tener hasta 160 caracteres.';
        const brand = text(v.brand);
        if (brand.length > 120) errors.brand = 'La marca puede tener hasta 120 caracteres.';
        const sku = text(v.sku);
        if (sku.length > 80) errors.sku = 'El SKU puede tener hasta 80 caracteres.';
        const category = text(v.category);
        if (!CATEGORIES.includes(category)) errors.category = 'Elegí una categoría.';
        const description = text(v.description);
        if (description.length > 2000) errors.description = 'La descripción puede tener hasta 2000 caracteres.';
        const unit = text(v.unit_label) || 'unidad';
        if (unit.length > 40) errors.unit_label = 'La unidad puede tener hasta 40 caracteres.';

        const price = parseAmount(v.price);
        if (price == null) errors.price = 'Ingresá el precio.';
        else if (Number.isNaN(price) || price < 0) errors.price = 'El precio tiene que ser un número mayor o igual a 0.';
        const compare = parseAmount(v.compare_at_price);
        if (compare != null && (Number.isNaN(compare) || compare < 0)) errors.compare_at_price = 'El precio de lista tiene que ser mayor o igual a 0.';
        const pack = parseAmount(v.pack_size);
        if (pack != null && (Number.isNaN(pack) || pack <= 0)) errors.pack_size = 'Las unidades por pack tienen que ser mayores a 0.';
        const minQty = parseAmount(v.min_order_qty);
        if (minQty != null && (Number.isNaN(minQty) || minQty <= 0)) errors.min_order_qty = 'La compra mínima tiene que ser mayor a 0.';
        let stock = null;
        if (v.track_stock) {
            stock = parseAmount(v.stock_quantity);
            if (stock == null) errors.stock_quantity = 'Ingresá el stock disponible o desactivá el control de stock.';
            else if (Number.isNaN(stock) || stock < 0) errors.stock_quantity = 'El stock tiene que ser mayor o igual a 0.';
        }
        const imageRaw = text(v.image_url);
        const image = imageRaw ? httpUrl(imageRaw) : null;
        if (imageRaw && !image) errors.image_url = 'La imagen tiene que ser un enlace http:// o https://.';

        const payload = {
            name,
            brand: brand || null,
            sku: sku || null,
            category,
            description: description || null,
            unit_label: unit,
            pack_size: pack == null || Number.isNaN(pack) ? null : round2(pack),
            price: price == null || Number.isNaN(price) ? null : round2(price),
            compare_at_price: compare == null || Number.isNaN(compare) ? null : round2(compare),
            stock_quantity: stock == null || Number.isNaN(stock) ? null : round2(stock),
            min_order_qty: minQty == null || Number.isNaN(minQty) ? 1 : round2(minQty),
            image_url: image,
            currency: (vendor && vendor.currency) || undefined
        };
        return { errors, payload, ok: Object.keys(errors).length === 0 };
    }

    // Escalón de descuento por volumen. tiers: los existentes (para evitar
    // montos repetidos); editingId: el que se edita.
    function validateTier(values, tiers, vendor, editingId) {
        const v = values || {};
        const errors = {};
        const min = parseAmount(v.min_subtotal);
        if (min == null) errors.min_subtotal = 'Ingresá desde qué subtotal aplica.';
        else if (Number.isNaN(min) || min < 0) errors.min_subtotal = 'El subtotal mínimo tiene que ser mayor o igual a 0.';
        const pct = parseAmount(v.discount_pct);
        if (pct == null) errors.discount_pct = 'Ingresá el porcentaje de descuento.';
        else if (Number.isNaN(pct) || pct <= 0 || pct > 60) errors.discount_pct = 'El descuento tiene que ser mayor a 0 y de hasta 60%.';
        const labelText = text(v.label);
        if (labelText.length > 120) errors.label = 'La etiqueta puede tener hasta 120 caracteres.';
        if (!errors.min_subtotal && Array.isArray(tiers) && tiers.some(t => t && t.id !== editingId && toCents(t.min_subtotal) === toCents(min))) {
            errors.min_subtotal = 'Ya tenés un escalón con ese subtotal mínimo.';
        }
        const platform = Number((vendor && vendor.platform_discount_pct) || 0);
        const warnings = [];
        if (!errors.discount_pct && platform + pct > 60) {
            warnings.push('Con el descuento We Ötzi (' + platform + '%) supera el tope: los pedidos se calculan con 60%.');
        }
        return {
            errors,
            warnings,
            ok: Object.keys(errors).length === 0,
            payload: {
                min_subtotal: min == null || Number.isNaN(min) ? null : round2(min),
                discount_pct: pct == null || Number.isNaN(pct) ? null : round2(pct),
                label: labelText || null,
                currency: (vendor && vendor.currency) || undefined
            }
        };
    }

    // Condiciones comerciales de Beneficios (% We Ötzi, mínimo, envío gratis, textos).
    function validateConditions(values) {
        const v = values || {};
        const errors = {};
        const pct = parseAmount(v.platform_discount_pct);
        if (pct != null && (Number.isNaN(pct) || pct < 0 || pct > 60)) errors.platform_discount_pct = 'El descuento We Ötzi tiene que estar entre 0 y 60%.';
        const min = parseAmount(v.min_order_amount);
        if (min != null && (Number.isNaN(min) || min < 0)) errors.min_order_amount = 'La compra mínima tiene que ser mayor o igual a 0.';
        const free = parseAmount(v.free_shipping_threshold);
        if (free != null && (Number.isNaN(free) || free < 0)) errors.free_shipping_threshold = 'El envío gratis tiene que ser un monto mayor o igual a 0.';
        const benefits = (Array.isArray(v.benefits) ? v.benefits : []).map(text).filter(Boolean);
        if (benefits.length > 10) errors.benefits = 'Podés cargar hasta 10 beneficios.';
        else if (benefits.some(b => b.length > 160)) errors.benefits = 'Cada beneficio puede tener hasta 160 caracteres.';
        return {
            errors,
            ok: Object.keys(errors).length === 0,
            payload: {
                platform_discount_pct: pct == null || Number.isNaN(pct) ? 0 : round2(pct),
                min_order_amount: min == null || Number.isNaN(min) ? null : round2(min),
                free_shipping_threshold: free == null || Number.isNaN(free) ? null : round2(free),
                benefits: benefits.slice(0, 10)
            }
        };
    }

    // Perfil público del vendor (+ si queda "completo").
    function validateProfile(values) {
        const v = values || {};
        const errors = {};
        const name = text(v.name);
        if (name.length < 2 || name.length > 160) errors.name = 'El nombre tiene que tener entre 2 y 160 caracteres.';
        const description = text(v.description);
        if (description.length > 2000) errors.description = 'La descripción puede tener hasta 2000 caracteres.';
        const urls = {};
        [['logo_image', 'El logo'], ['cover_image', 'La portada'], ['website', 'El sitio web']].forEach(([key, labelText]) => {
            const raw = text(v[key]);
            urls[key] = raw ? httpUrl(raw) : null;
            if (raw && !urls[key]) errors[key] = labelText + ' tiene que ser un enlace http:// o https://.';
        });
        const contact = text(v.contact_email);
        if (contact && (!EMAIL_RE.test(contact) || contact.length > 254)) errors.contact_email = 'El email de contacto no parece válido.';
        [['phone', 40, 'El teléfono'], ['whatsapp', 40, 'El WhatsApp'], ['instagram', 120, 'El Instagram'], ['country', 120, 'El país'], ['city', 120, 'La ciudad']]
            .forEach(([key, max, labelText]) => { if (text(v[key]).length > max) errors[key] = labelText + ' puede tener hasta ' + max + ' caracteres.'; });
        const countries = parseCountries(v.ships_to_countries);
        if (countries.invalid.length) errors.ships_to_countries = 'Usá códigos de país de 2 letras separados por coma (por ejemplo AR, UY).';
        const lead = parseAmount(v.lead_time_days);
        if (lead != null && (Number.isNaN(lead) || !Number.isInteger(lead) || lead < 0 || lead > 365)) errors.lead_time_days = 'El plazo de entrega va en días enteros, de 0 a 365.';
        const payload = {
            name,
            description: description || null,
            logo_image: urls.logo_image,
            cover_image: urls.cover_image,
            website: urls.website,
            contact_email: contact || null,
            phone: text(v.phone) || null,
            whatsapp: text(v.whatsapp) || null,
            instagram: text(v.instagram) || null,
            country: text(v.country) || null,
            city: text(v.city) || null,
            ships_to_countries: countries.items,
            lead_time_days: lead == null || Number.isNaN(lead) ? null : lead
        };
        if (v.currency !== undefined && v.currency !== null && text(v.currency)) {
            const currency = text(v.currency).toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Elegí una moneda válida.';
            else payload.currency = currency;
        }
        payload.profile_complete = !!(payload.name && payload.description && payload.logo_image
            && (payload.contact_email || payload.phone || payload.whatsapp) && payload.country);
        return { errors, ok: Object.keys(errors).length === 0, payload };
    }

    function validatePrivate(values) {
        const v = values || {};
        const errors = {};
        [['legal_name', 200, 'La razón social'], ['tax_id', 60, 'La identificación fiscal'], ['fiscal_address', 500, 'El domicilio fiscal'], ['notes', 2000, 'Las notas']]
            .forEach(([key, max, labelText]) => { if (text(v[key]).length > max) errors[key] = labelText + ' puede tener hasta ' + max + ' caracteres.'; });
        const billing = text(v.billing_email);
        if (billing && (!EMAIL_RE.test(billing) || billing.length > 254)) errors.billing_email = 'El email de facturación no parece válido.';
        return {
            errors,
            ok: Object.keys(errors).length === 0,
            payload: {
                legal_name: text(v.legal_name) || null,
                tax_id: text(v.tax_id) || null,
                fiscal_address: text(v.fiscal_address) || null,
                billing_email: billing || null,
                notes: text(v.notes) || null
            }
        };
    }

    // supply_vendor_customers trae una fila por (estudio, moneda): se agrupa
    // por estudio con los totales por moneda.
    function aggregateCustomers(rows) {
        const byStudio = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            if (!row || !row.studio_id) return;
            const entry = byStudio.get(row.studio_id) || {
                studio_id: row.studio_id, studio_name: row.studio_name || null, orders: 0, last_order_at: null, cents: {}
            };
            entry.orders += Number(row.orders) || 0;
            if (!entry.studio_name && row.studio_name) entry.studio_name = row.studio_name;
            if (row.last_order_at && (!entry.last_order_at || String(row.last_order_at) > String(entry.last_order_at))) entry.last_order_at = row.last_order_at;
            addTotals(entry.cents, row.currency, row.total);
            byStudio.set(row.studio_id, entry);
        });
        return Array.from(byStudio.values())
            .map(entry => ({ studio_id: entry.studio_id, studio_name: entry.studio_name, orders: entry.orders, last_order_at: entry.last_order_at, totals: centsMapToUnits(entry.cents) }))
            .sort((a, b) => String(b.last_order_at || '').localeCompare(String(a.last_order_at || '')) || text(a.studio_name).localeCompare(text(b.studio_name)));
    }

    // Top productos a partir de pedidos con sus líneas (supply_order_items).
    // Solo pedidos vendidos (confirmados en adelante). Orden: unidades.
    function aggregateTopProducts(orders, limit) {
        const byKey = new Map();
        (Array.isArray(orders) ? orders : []).forEach(order => {
            if (!order || !SALE_STATUSES.includes(order.status)) return;
            (order.supply_order_items || []).forEach(item => {
                if (!item) return;
                const key = item.product_id || ('name:' + text(item.product_name).toLowerCase() + '|' + text(item.sku).toLowerCase());
                const entry = byKey.get(key) || {
                    key, product_id: item.product_id || null, name: item.product_name || 'Producto', sku: item.sku || null,
                    unit_label: item.unit_label || null, units: 0, orderIds: new Set(), cents: {}
                };
                entry.units = round2(entry.units + (Number(item.quantity) || 0));
                entry.orderIds.add(order.id);
                addTotals(entry.cents, order.currency, item.line_total);
                byKey.set(key, entry);
            });
        });
        const list = Array.from(byKey.values())
            .map(entry => ({ key: entry.key, product_id: entry.product_id, name: entry.name, sku: entry.sku, unit_label: entry.unit_label, units: entry.units, orders: entry.orderIds.size, totals: centsMapToUnits(entry.cents) }))
            .sort((a, b) => (b.units - a.units) || (b.orders - a.orders) || text(a.name).localeCompare(text(b.name)));
        return limit ? list.slice(0, limit) : list;
    }

    // Resumen de supply_vendor_sales_monthly: totales por moneda + conteos.
    function salesSummary(rows) {
        const cents = { gross: {}, discounts: {}, shipping: {}, net: {} };
        let orders = 0;
        let units = 0;
        (Array.isArray(rows) ? rows : []).forEach(row => {
            if (!row) return;
            orders += Number(row.orders) || 0;
            units = round2(units + (Number(row.units) || 0));
            Object.keys(cents).forEach(key => addTotals(cents[key], row.currency, row[key]));
        });
        return {
            orders,
            units,
            gross: centsMapToUnits(cents.gross),
            discounts: centsMapToUnits(cents.discounts),
            shipping: centsMapToUnits(cents.shipping),
            net: centsMapToUnits(cents.net)
        };
    }

    // Lo mínimo para que los estudios confíen en la tienda.
    function profileChecklist(vendor, products) {
        const v = vendor || {};
        const active = (Array.isArray(products) ? products : []).filter(p => p && p.is_active !== false);
        return [
            { id: 'identity', label: 'Logo y descripción de la tienda', done: !!(v.logo_image && v.description), tab: 'perfil' },
            { id: 'contact', label: 'Un dato de contacto (email, teléfono o WhatsApp)', done: !!(v.contact_email || v.phone || v.whatsapp), tab: 'perfil' },
            { id: 'coverage', label: 'País y ciudad desde donde enviás', done: !!(v.country && v.city), tab: 'perfil' },
            { id: 'catalog', label: 'Al menos un producto activo en el catálogo', done: active.length > 0, tab: 'catalogo' },
            { id: 'benefits', label: 'Descuento We Ötzi o beneficios para estudios', done: Number(v.platform_discount_pct) > 0 || (Array.isArray(v.benefits) && v.benefits.length > 0), tab: 'beneficios' }
        ];
    }

    function inPeriod(order, range) {
        const date = orderDate(order);
        if (!date || !range) return false;
        const d = new Date(date);
        if (Number.isNaN(d.getTime())) return false;
        return d >= new Date(range.fromIso) && d < new Date(range.toIso);
    }

    // Ejecuta una acción del vendor y avisa al estudio. Sin DOM: lo usan el
    // panel y los tests. env = {data: WeotziData, kit, client}.
    // → {order, notify} · lanza si la RPC falla (el aviso nunca lanza).
    async function runOrderAction(env, orderId, action, params) {
        const kind = notifyKind(action);
        if (!kind) throw new Error('Acción inválida.');
        if (!UUID_RE.test(String(orderId || ''))) throw new Error('Pedido inválido.');
        const { data, kit, client } = env || {};
        const res = await data.Supplies.vendorUpdateOrder(orderId, action, params || {});
        const order = kit.unwrap(res);
        const notify = await kit.postNotify(NOTIFY_PATH, { kind, order_id: orderId }, client);
        return { order, notify };
    }

    // -------------------------------------------------------------
    // Estado y utilidades de UI
    // -------------------------------------------------------------
    const S = {
        auth: null,
        client: null,
        vendor: null,
        tab: null,
        tabKey: null,
        params: {},
        seq: 0,
        orders: null,
        products: null,
        tiers: null,
        orderDetails: new Map(),
        orderFilter: { status: 'all', query: '' },
        productFilter: { query: '', category: '', archived: false },
        reportPreset: 'last_6_months',
        drawer: null
    };

    function doc() { return root.document; }
    function K() { return root.WeOtziStudioKit; }
    function Sup() { return root.WeotziData && root.WeotziData.Supplies; }
    function h(v) { return K().escapeHtml(v); }
    function ha(v) { return K().escapeAttr(v); }
    function money(n, cur) { return K().fmtMoney(n, cur || (S.vendor && S.vendor.currency)); }
    function fmtPct(n) { return K().fmtPercent(n); }
    function friendly(err, fallback) { return K().friendlyError(err, fallback); }
    function toast(msg, tone, opts) { return K().toast(msg, tone, opts); }
    function label(dict, value) { return K().label(dict, value); }
    function env() { return { data: root.WeotziData, kit: K(), client: S.client }; }

    function loadingHtml(msg) { return '<p class="studio-help" data-module-loading>' + h(msg || 'Cargando…') + '</p>'; }
    function errorHtml(err, fallback) {
        return '<div class="studio-status studio-status-error" role="alert">' + h(friendly(err, fallback || 'No pudimos cargar esta sección. Intentá nuevamente.')) + '</div>';
    }
    function panelRoot(tab) {
        const panel = doc().querySelector('.studio-dash-panel[data-panel="' + tab + '"]');
        return panel ? panel.querySelector('[data-module-root]') : null;
    }
    function fieldHtml(opts) {
        const o = opts || {};
        const id = o.id || ('sp-f-' + o.name);
        const attrs = K().htmlAttrs(Object.assign({ id, name: o.name }, o.attrs || {}));
        let control;
        if (o.type === 'textarea') control = '<textarea class="studio-textarea"' + attrs + '>' + h(o.value == null ? '' : o.value) + '</textarea>';
        else if (o.type === 'select') control = '<select class="studio-input"' + attrs + '>' + (o.optionsHtml || '') + '</select>';
        else control = '<input class="studio-input" type="' + ha(o.type || 'text') + '"' + attrs + ' value="' + ha(o.value == null ? '' : o.value) + '">';
        return '<div class="sk-field' + (o.span ? ' sk-span-2' : '') + '" data-field-wrap="' + ha(o.name) + '">'
            + '<label for="' + ha(id) + '">' + h(o.label) + '</label>' + control
            + (o.help ? '<span class="studio-help">' + h(o.help) + '</span>' : '')
            + '</div>';
    }
    // Marca los campos con error y devuelve el primer mensaje.
    function markErrors(container, errors) {
        container.querySelectorAll('[aria-invalid="true"]').forEach(node => node.removeAttribute('aria-invalid'));
        const keys = Object.keys(errors || {});
        keys.forEach(key => {
            const node = container.querySelector('[name="' + key + '"]');
            if (node) node.setAttribute('aria-invalid', 'true');
        });
        if (keys.length) {
            const first = container.querySelector('[name="' + keys[0] + '"]');
            if (first && typeof first.focus === 'function') first.focus();
            return errors[keys[0]];
        }
        return '';
    }
    function amountInput(v) { return v == null || v === '' ? '' : String(v); }
    async function mapLimit(items, limit, fn) {
        const out = new Array(items.length);
        let next = 0;
        async function worker() {
            while (next < items.length) {
                const i = next++;
                try { out[i] = await fn(items[i], i); } catch (err) { out[i] = null; }
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
        return out;
    }

    // -------------------------------------------------------------
    // Carga de datos
    // -------------------------------------------------------------
    async function loadOrders(force) {
        if (S.orders && !force) return S.orders;
        const res = await Sup().listOrdersForVendor(S.vendor.id);
        if (res && res.error) throw res.error;
        S.orders = (res && res.data) || [];
        S.ordersUnavailable = !!(res && res.unavailable);
        updateOrdersBadge();
        return S.orders;
    }
    async function loadProducts(force) {
        if (S.products && !force) return S.products;
        const res = await Sup().listProducts(S.vendor.id, { includeInactive: true });
        if (res && res.error) throw res.error;
        S.products = (res && res.data) || [];
        return S.products;
    }
    async function loadTiers(force) {
        if (S.tiers && !force) return S.tiers;
        const res = await Sup().listTiers(S.vendor.id);
        if (res && res.error) throw res.error;
        S.tiers = (res && res.data) || [];
        return S.tiers;
    }
    async function loadOrderDetail(id, force) {
        if (!force && S.orderDetails.has(id)) return S.orderDetails.get(id);
        const res = await Sup().getOrder(id);
        if (res && res.error) throw res.error;
        const order = (res && res.data) || null;
        if (order) S.orderDetails.set(id, order);
        return order;
    }
    function productsById() {
        return (S.products || []).reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
    }

    function updateOrdersBadge() {
        const pending = (S.orders || []).filter(o => o.status === 'submitted').length;
        const tab = doc().querySelector('.studio-dash-tab[data-tab="pedidos"]');
        if (!tab) return;
        let badge = tab.querySelector('.sk-tab-badge');
        if (!badge) {
            if (!pending) return;
            badge = doc().createElement('span');
            badge.className = 'sk-tab-badge';
            tab.appendChild(badge);
        }
        badge.textContent = pending > 99 ? '99+' : String(pending);
        badge.title = pending === 1 ? '1 pedido por confirmar' : pending + ' pedidos por confirmar';
        badge.hidden = pending === 0;
    }

    // -------------------------------------------------------------
    // Navegación
    // -------------------------------------------------------------
    function showTab(tab) {
        doc().querySelectorAll('.studio-dash-tab').forEach(node => {
            const on = node.dataset.tab === tab;
            node.classList.toggle('is-active', on);
            if (on) node.setAttribute('aria-current', 'page');
            else node.removeAttribute('aria-current');
        });
        doc().querySelectorAll('.studio-dash-panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.panel === tab));
    }

    function activate(tab, params) {
        const want = TABS.includes(tab) ? tab : DEFAULT_TAB;
        const clean = params && typeof params === 'object' ? params : {};
        const key = want + JSON.stringify(clean);
        if (S.tab === want && S.tabKey === key) return;
        S.tab = want;
        S.tabKey = key;
        S.params = clean;
        showTab(want);
        render(want, clean);
    }

    function navigate(tab, params) {
        activate(tab, params);
        try { root.history.replaceState(root.history.state, '', '#' + S.tab); } catch (_) { /* sin history */ }
    }

    async function render(tab, params) {
        const host = panelRoot(tab);
        if (!host) return;
        const token = ++S.seq;
        const renderer = RENDERERS[tab];
        if (!renderer) return;
        try {
            await renderer(host, params || {}, token);
        } catch (err) {
            console.error('[supplies-dashboard] render', tab, err);
            if (token === S.seq || S.tab === tab) host.innerHTML = errorHtml(err);
        }
    }

    function stale(token) { return token !== S.seq; }

    function wireTabs() {
        doc().querySelectorAll('.studio-dash-tab').forEach(tab => {
            tab.href = '#' + tab.dataset.tab;
            tab.addEventListener('click', () => activate(tab.dataset.tab));
        });
        root.addEventListener('hashchange', () => {
            const hash = root.location.hash.slice(1);
            if (!hash) activate(DEFAULT_TAB);
            else if (TAB_PATTERN.test(hash)) activate(hash);
        });
        // Enlaces internos del panel: data-nav="pestaña".
        doc().addEventListener('click', event => {
            const target = event.target && event.target.closest ? event.target.closest('[data-nav]') : null;
            if (!target || !doc().querySelector('.supplies-dashboard').contains(target)) return;
            event.preventDefault();
            navigate(target.getAttribute('data-nav'));
        });
    }

    // -------------------------------------------------------------
    // Piezas compartidas
    // -------------------------------------------------------------
    function verificationBanner(compact) {
        const v = S.vendor || {};
        if (v.is_active === false) {
            return '<div class="sp-banner sp-banner--danger" role="status"><i class="fa-solid fa-circle-pause" aria-hidden="true"></i><div>'
                + '<p class="sp-banner__title">Tu cuenta está desactivada</p>'
                + (compact ? '' : '<p>Los estudios no ven tu catálogo ni pueden hacerte pedidos. Si creés que es un error, escribinos a soporte.</p>')
                + '</div></div>';
        }
        if (!v.is_verified) {
            return '<div class="sp-banner" role="status"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i><div>'
                + '<p class="sp-banner__title">Tu cuenta está en revisión: los estudios todavía no ven tu catálogo</p>'
                + (compact ? '' : '<p>Mientras tanto completá tu perfil y cargá tus productos. Te avisamos cuando el equipo de We Ötzi te apruebe.</p>')
                + '</div></div>';
        }
        return '';
    }

    function studioCell(order) {
        const studio = order.studios || {};
        const place = [studio.city, studio.country].filter(Boolean).join(', ');
        return '<strong>' + h(studio.name || 'Estudio') + '</strong>' + (place ? '<small>' + h(place) + '</small>' : '');
    }

    function ordersTable(rows, opts) {
        const o = opts || {};
        return K().renderTable({
            rows,
            emptyText: o.emptyText || 'No hay pedidos para mostrar.',
            columns: [
                { label: 'Pedido', render: r => '<strong>' + h(r.order_number || '—') + '</strong><small>' + h(K().fmtDateTime(r.submitted_at)) + '</small>' },
                { label: 'Estudio', render: studioCell },
                { label: 'Estado', badge: 'supplyOrderStatus', key: 'status' },
                { label: 'Total', align: 'right', render: r => h(money(r.total, r.currency)) },
                { label: 'Acciones', render: r => '<div class="sk-row-actions"><button type="button" class="studio-btn studio-btn-ghost" data-open-order="' + ha(r.id) + '">Ver detalle</button></div>' }
            ]
        });
    }

    function wireOpenOrder(container) {
        container.querySelectorAll('[data-open-order]').forEach(btn => {
            btn.addEventListener('click', () => openOrder(btn.getAttribute('data-open-order')));
        });
    }

    // -------------------------------------------------------------
    // Inicio
    // -------------------------------------------------------------
    async function renderInicio(host, params, token) {
        host.innerHTML = loadingHtml();
        const [ordersRes, productsRes, salesRes] = await Promise.allSettled([
            loadOrders(true),
            loadProducts(),
            (async () => {
                const range = K().periodRange('this_month');
                const res = await Sup().vendorSalesMonthly(S.vendor.id, range.fromMonth, range.toMonth);
                if (res && res.error) throw res.error;
                return (res && res.data) || [];
            })()
        ]);
        if (stale(token)) return;
        const orders = ordersRes.status === 'fulfilled' ? ordersRes.value : null;
        const products = productsRes.status === 'fulfilled' ? productsRes.value : null;
        const sales = salesRes.status === 'fulfilled' ? salesSummary(salesRes.value) : null;
        [ordersRes, productsRes, salesRes].forEach(r => { if (r.status === 'rejected') console.warn('[supplies-dashboard] inicio:', r.reason); });

        const parts = [verificationBanner(false)];

        const checklist = profileChecklist(S.vendor, products || []);
        if (products && checklist.some(item => !item.done)) {
            const done = checklist.filter(item => item.done).length;
            parts.push('<section class="sk-section"><div class="sk-section-head"><h2 class="studio-h2">Completá tu tienda</h2>'
                + '<span class="sk-muted">' + h(done + ' de ' + checklist.length) + '</span></div>'
                + '<ul class="sp-checklist">' + checklist.map(item => '<li class="sp-checklist__item' + (item.done ? ' is-done' : '') + '">'
                    + '<i class="fa-solid ' + (item.done ? 'fa-circle-check' : 'fa-circle') + '" aria-hidden="true"></i>'
                    + '<span>' + h(item.label) + '<span class="sp-visually-hidden">' + (item.done ? ' (listo)' : ' (pendiente)') + '</span></span>'
                    + (item.done ? '' : '<a href="#' + ha(item.tab) + '" class="sp-link" data-nav="' + ha(item.tab) + '">Completar</a>')
                    + '</li>').join('') + '</ul></section>');
        }

        const kpis = [];
        if (orders) {
            const counts = countByStatus(orders);
            kpis.push({ label: 'Por confirmar', value: String(counts.submitted || 0), tone: counts.submitted ? 'warning' : null, hint: 'Pedidos nuevos de estudios' });
            kpis.push({ label: 'En curso', value: String((counts.confirmed || 0) + (counts.shipped || 0)), hint: 'Confirmados o despachados' });
        }
        if (sales) {
            kpis.push({ label: 'Ventas del mes', valueHtml: K().fmtTotalsHtml(sales.net, { empty: 'Sin ventas' }), hint: sales.orders + (sales.orders === 1 ? ' pedido' : ' pedidos') + ' · neto por moneda' });
        }
        if (products) {
            const active = products.filter(p => p.is_active !== false);
            const out = active.filter(p => p.stock_quantity != null && Number(p.stock_quantity) <= 0).length;
            kpis.push({ label: 'Productos activos', value: String(active.length), tone: out ? 'danger' : null, hint: out ? out + ' sin stock' : 'Visibles para estudios' + (S.vendor.is_verified ? '' : ' cuando te aprobemos') });
        }
        if (kpis.length) parts.push(K().kpis(kpis));

        if (orders) {
            const submitted = orders.filter(o => o.status === 'submitted');
            const confirmed = orders.filter(o => o.status === 'confirmed');
            parts.push('<section class="sk-section"><div class="sk-section-head"><h2 class="studio-h2">Pedidos por confirmar</h2>'
                + (submitted.length > 5 ? '<a href="#pedidos" class="sp-link" data-nav="pedidos">Ver todos</a>' : '') + '</div>'
                + (submitted.length
                    ? ordersTable(submitted.slice(0, 5))
                    : K().emptyState({ title: 'No tenés pedidos nuevos', body: 'Cuando un estudio te haga un pedido lo vas a ver acá y te llega un email.', compact: true }))
                + '</section>');
            if (confirmed.length) {
                parts.push('<section class="sk-section"><div class="sk-section-head"><h2 class="studio-h2">Por despachar</h2></div>'
                    + ordersTable(confirmed.slice(0, 5)) + '</section>');
            }
        } else if (ordersRes.status === 'rejected') {
            parts.push(errorHtml(ordersRes.reason, 'No pudimos cargar tus pedidos.'));
        }

        host.innerHTML = parts.filter(Boolean).join('');
        wireOpenOrder(host);
    }

    // -------------------------------------------------------------
    // Pedidos
    // -------------------------------------------------------------
    async function renderPedidos(host, params, token) {
        if (params.status && ORDER_FILTERS.includes(params.status)) S.orderFilter.status = params.status;
        if (params.query != null) S.orderFilter.query = String(params.query);
        host.innerHTML = loadingHtml('Cargando pedidos…');
        await loadOrders(true);
        if (stale(token)) return;
        host.innerHTML = '<div class="sk-toolbar"><div class="sk-chips" role="group" aria-label="Filtrar por estado" data-order-chips></div></div>'
            + '<div class="sk-toolbar">'
            + '<div class="sk-field"><label for="sp-orders-search">Buscar</label>'
            + '<input type="search" id="sp-orders-search" placeholder="N° de pedido, estudio o seguimiento" value="' + ha(S.orderFilter.query) + '" autocomplete="off"></div>'
            + '<span class="sk-toolbar-spacer"></span>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-action="orders-refresh"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Actualizar</button>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-action="orders-csv"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Exportar CSV</button>'
            + '</div>'
            + (S.ordersUnavailable ? '<div class="studio-status studio-status-info">' + h(K().MISSING_SCHEMA_MESSAGE) + '</div>' : '')
            + '<div data-orders-table></div>';
        const paint = () => {
            const counts = countByStatus(S.orders);
            host.querySelector('[data-order-chips]').innerHTML = ORDER_FILTERS.map(status => {
                const text0 = status === 'all' ? 'Todos' : (status === 'submitted' ? 'Por confirmar' : label('supplyOrderStatus', status));
                const pressed = S.orderFilter.status === status;
                return '<button type="button" class="sk-chip" aria-pressed="' + (pressed ? 'true' : 'false') + '" data-status="' + ha(status) + '">'
                    + h(text0) + ' <span class="sk-chip-count">' + h(counts[status] || 0) + '</span></button>';
            }).join('');
            host.querySelectorAll('[data-status]').forEach(chip => chip.addEventListener('click', () => {
                S.orderFilter.status = chip.getAttribute('data-status');
                paint();
            }));
            const rows = filterOrders(S.orders, S.orderFilter);
            const table = host.querySelector('[data-orders-table]');
            table.innerHTML = ordersTable(rows, {
                emptyText: S.orders.length ? 'Ningún pedido coincide con el filtro.' : 'Todavía no recibiste pedidos. Cuando un estudio te compre, aparece acá.'
            });
            wireOpenOrder(table);
        };
        paint();
        const search = host.querySelector('#sp-orders-search');
        search.addEventListener('input', K().debounce(() => { S.orderFilter.query = search.value; paint(); }, 200));
        host.querySelector('[data-action="orders-refresh"]').addEventListener('click', event => K().guarded(event.currentTarget, async () => {
            await loadOrders(true);
            paint();
        }));
        host.querySelector('[data-action="orders-csv"]').addEventListener('click', () => exportOrdersCsv(filterOrders(S.orders, S.orderFilter)));
        if (params.order && UUID_RE.test(String(params.order))) openOrder(String(params.order));
    }

    function exportOrdersCsv(rows) {
        K().downloadCsv('pedidos-' + (S.vendor.slug || 'supplies'), [
            { label: 'Pedido', key: 'order_number' },
            { label: 'Fecha', value: r => K().fmtDateTime(r.submitted_at) },
            { label: 'Estudio', value: r => (r.studios && r.studios.name) || '' },
            { label: 'Ciudad', value: r => (r.studios && r.studios.city) || '' },
            { label: 'Estado', value: r => label('supplyOrderStatus', r.status) },
            { label: 'Moneda', key: 'currency' },
            { label: 'Subtotal', value: r => Number(r.subtotal) || 0 },
            { label: 'Descuento', value: r => Number(r.discount_amount) || 0 },
            { label: 'Envío', value: r => Number(r.shipping_amount) || 0 },
            { label: 'Total', value: r => Number(r.total) || 0 },
            { label: 'Seguimiento', key: 'tracking_code' },
            { label: 'Entrega estimada', value: r => (r.estimated_delivery ? K().fmtDate(r.estimated_delivery) : '') }
        ], rows);
    }

    // ---- detalle (drawer) ----
    function orderDetailHtml(order) {
        const studio = order.studios || {};
        const location = order.studio_locations || {};
        const items = order.supply_order_items || [];
        const events = order.supply_order_events || [];
        const cur = order.currency;
        const pct = (Number(order.platform_discount_pct) || 0) + (Number(order.tier_discount_pct) || 0);
        const parts = [];
        parts.push('<div class="sp-order-status">' + K().statusBadge('supplyOrderStatus', order.status)
            + '<span class="sk-muted">Recibido el ' + h(K().fmtDateTime(order.submitted_at)) + '</span></div>');
        const place = [location.formatted_address, location.city, location.country].filter(Boolean).join(' · ');
        parts.push('<dl class="sp-meta">'
            + '<div><dt>Estudio</dt><dd>' + h(studio.name || '—') + (studio.city ? '<small>' + h([studio.city, studio.country].filter(Boolean).join(', ')) + '</small>' : '') + '</dd></div>'
            + '<div><dt>Entrega en</dt><dd>' + h(location.label || 'Sede sin indicar') + (place ? '<small>' + h(place) + '</small>' : '') + '</dd></div>'
            + '<div><dt>Entrega estimada</dt><dd>' + h(order.estimated_delivery ? K().fmtDate(order.estimated_delivery, { style: 'long' }) : 'Sin fecha') + '</dd></div>'
            + '<div><dt>Seguimiento</dt><dd>' + h(order.tracking_code || '—') + '</dd></div>'
            + '</dl>');
        if (text(order.notes)) parts.push('<div class="sp-note"><p class="sp-note__title">Nota del estudio</p><p>' + h(order.notes) + '</p></div>');
        if (text(order.vendor_note)) parts.push('<div class="sp-note sp-note--vendor"><p class="sp-note__title">Tu nota</p><p>' + h(order.vendor_note) + '</p></div>');

        const received = order.status === 'received';
        parts.push('<h3 class="sp-subtitle">Productos</h3>' + K().renderTable({
            rows: items,
            emptyText: 'El pedido no tiene líneas.',
            columns: [
                { label: 'Producto', render: i => '<strong>' + h(i.product_name) + '</strong>' + (i.sku ? '<small>SKU ' + h(i.sku) + '</small>' : '') },
                { label: 'Cantidad', align: 'right', render: i => h(K().fmtNumber(i.quantity)) + ' <small>' + h(i.unit_label || '') + (i.pack_size ? ' × ' + h(K().fmtNumber(i.pack_size)) : '') + '</small>' },
                received ? { label: 'Recibido', align: 'right', render: i => {
                    const got = i.received_quantity == null ? null : Number(i.received_quantity);
                    if (got == null) return '<span class="sk-muted">—</span>';
                    return h(K().fmtNumber(got)) + (got < Number(i.quantity) ? ' ' + K().badge('Faltante', 'warning') : '');
                } } : null,
                { label: 'Precio', align: 'right', render: i => h(money(i.unit_price, cur)) },
                { label: 'Descuento', align: 'right', render: i => h(money(i.line_discount, cur)) },
                { label: 'Total', align: 'right', render: i => '<strong>' + h(money(i.line_total, cur)) + '</strong>' }
            ]
        }));

        const shippingText = order.status === 'submitted'
            ? (freeShippingApplies(order, S.vendor) ? 'Gratis (supera ' + money(S.vendor.free_shipping_threshold, cur) + ')' : 'Lo definís al confirmar')
            : money(order.shipping_amount, cur);
        parts.push('<dl class="sp-totals">'
            + '<div><dt>Subtotal</dt><dd>' + h(money(order.subtotal, cur)) + '</dd></div>'
            + '<div><dt>Descuentos' + (pct ? ' (' + h(fmtPct(Math.min(60, pct))) + ')' : '') + '</dt><dd>− ' + h(money(order.discount_amount, cur)) + '</dd></div>'
            + (Number(order.tier_discount_pct) ? '<div class="sp-totals__detail"><dt>We Ötzi ' + h(fmtPct(order.platform_discount_pct)) + ' + volumen ' + h(fmtPct(order.tier_discount_pct)) + '</dt><dd></dd></div>' : '')
            + '<div><dt>Envío</dt><dd>' + h(shippingText) + '</dd></div>'
            + '<div class="sp-totals__grand"><dt>Total</dt><dd>' + h(money(order.total, cur)) + '</dd></div>'
            + '</dl>');

        if (events.length) {
            parts.push('<h3 class="sp-subtitle">Historial</h3><ol class="sp-timeline">' + events.map(ev => '<li class="sp-timeline__item">'
                + '<span class="sp-timeline__when">' + h(K().fmtDateTime(ev.created_at)) + '</span>'
                + '<span class="sp-timeline__what">' + h(ev.from_status ? label('supplyOrderStatus', ev.from_status) + ' → ' : '') + h(label('supplyOrderStatus', ev.to_status))
                + (ev.actor_role ? ' · <span class="sk-muted">' + h(label('supplyActorRole', ev.actor_role)) + '</span>' : '') + '</span>'
                + (text(ev.note) ? '<span class="sp-timeline__note">' + h(ev.note) + '</span>' : '')
                + '</li>').join('') + '</ol>');
        }
        return '<div class="sp-order">' + parts.join('') + '</div>';
    }

    function actionButtonsHtml(order) {
        const actions = orderActions(order.status);
        if (!actions.length) {
            const done = { delivered: 'Esperando que el estudio confirme la recepción.', received: 'El estudio recibió el pedido.', rejected: 'Rechazaste este pedido.', cancelled: 'El pedido está cancelado.' };
            return '<p class="studio-help sp-drawer-note">' + h(done[order.status] || '') + '</p>';
        }
        const labels = { confirm: 'Confirmar pedido', reject: 'Rechazar', ship: 'Despachar', deliver: 'Marcar entregado', cancel: 'Cancelar pedido' };
        const primary = { confirm: true, ship: true, deliver: true };
        return actions.slice().sort((a, b) => (primary[a] ? 1 : 0) - (primary[b] ? 1 : 0))
            .map(action => '<button type="button" class="studio-btn ' + (primary[action] ? 'studio-btn-primary' : 'studio-btn-ghost') + '" data-order-action="' + ha(action) + '">'
                + h(labels[action]) + '</button>').join('');
    }

    async function openOrder(id) {
        if (!UUID_RE.test(String(id || ''))) return;
        if (S.drawer && S.drawer.api) S.drawer.api.close();
        const api = K().openDrawer({ title: 'Pedido', body: loadingHtml('Cargando pedido…'), width: 'lg', onClose: () => { if (S.drawer && S.drawer.api === api) S.drawer = null; } });
        S.drawer = { api, id };
        await paintOrderDrawer(true);
    }

    async function paintOrderDrawer(force) {
        const current = S.drawer;
        if (!current || !current.api || !current.api.body) return;
        const { api, id } = current;
        let order;
        try {
            order = await loadOrderDetail(id, force);
        } catch (err) {
            api.body.innerHTML = errorHtml(err, 'No pudimos cargar el pedido.');
            return;
        }
        if (S.drawer !== current) return;
        if (!order) {
            api.body.innerHTML = K().emptyState({ title: 'No encontramos el pedido', body: 'Puede que ya no esté disponible para tu cuenta.', compact: true });
            api.footer.hidden = true;
            return;
        }
        api.setTitle('Pedido ' + (order.order_number || ''));
        api.body.innerHTML = orderDetailHtml(order);
        api.footer.innerHTML = actionButtonsHtml(order);
        api.footer.hidden = false;
        api.footer.querySelectorAll('[data-order-action]').forEach(btn => {
            btn.addEventListener('click', () => startAction(order, btn.getAttribute('data-order-action'), btn));
        });
    }

    // Ejecuta la acción, avisa al estudio y refresca lista + drawer.
    async function commitAction(order, action, params) {
        const result = await runOrderAction(env(), order.id, action, params);
        S.orderDetails.delete(order.id);
        const notify = result.notify || {};
        if (notify.ok) toast(ACTION_DONE[action] + (notify.sent ? ' Le avisamos al estudio por email.' : ''), 'success');
        else {
            toast(ACTION_DONE[action], 'success');
            toast('No pudimos avisarle al estudio por email. El cambio quedó guardado.', 'warning');
        }
        if (action === 'confirm' || action === 'cancel') S.products = null; // el stock cambió
        await afterOrderChange();
        return result;
    }

    async function afterOrderChange() {
        try { await loadOrders(true); } catch (err) { console.warn('[supplies-dashboard] reload orders:', err); }
        if (S.drawer) await paintOrderDrawer(true);
        if (S.tab === 'pedidos' || S.tab === 'inicio') {
            const tab = S.tab;
            S.tabKey = null;
            activate(tab, tab === 'pedidos' ? {} : S.params);
        }
    }

    function startAction(order, action, btn) {
        if (action === 'confirm') return confirmFlow(order);
        if (action === 'ship') return shipFlow(order);
        if (action === 'deliver') {
            return K().guarded(btn, async () => {
                const ok = await K().confirmDialog({
                    title: 'Marcar como entregado',
                    body: '<p class="sk-overlay__text">¿El pedido ' + h(order.order_number) + ' ya llegó al estudio? El estudio después confirma la recepción y repone su inventario.</p>',
                    confirmLabel: 'Marcar entregado'
                });
                if (ok) await commitAction(order, 'deliver', {});
            });
        }
        if (action === 'reject' || action === 'cancel') {
            return K().guarded(btn, async () => {
                const reject = action === 'reject';
                const note = await K().promptDialog({
                    title: reject ? 'Rechazar pedido ' + order.order_number : 'Cancelar pedido ' + order.order_number,
                    body: reject ? 'El estudio recibe el motivo por email.' : 'El stock que reservaste vuelve a tu catálogo y el estudio recibe el motivo por email.',
                    label: 'Motivo',
                    placeholder: reject ? 'Ej. No tenemos stock de esa tinta hasta el mes próximo' : 'Ej. No llegamos con la entrega',
                    multiline: true,
                    required: true,
                    maxLength: 1000,
                    confirmLabel: reject ? 'Rechazar pedido' : 'Cancelar pedido',
                    cancelLabel: 'Volver',
                    tone: 'danger'
                });
                if (note == null) return;
                await commitAction(order, action, { note });
            });
        }
        return null;
    }

    function confirmFlow(order) {
        const cur = order.currency;
        const free = freeShippingApplies(order, S.vendor);
        const warnings = stockWarnings(order, productsById());
        const today = K().toDateInput(new Date());
        const body = '<form class="sp-form" novalidate>'
            + (warnings.length ? '<div class="sp-banner sp-banner--danger" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><div>'
                + '<p class="sp-banner__title">Stock insuficiente</p><ul>' + warnings.map(w => '<li>' + h(w.name) + ': pidieron ' + h(K().fmtNumber(w.quantity)) + ', tenés ' + h(K().fmtNumber(w.stock)) + '</li>').join('')
                + '</ul><p>Actualizá el stock en Catálogo o rechazá el pedido.</p></div></div>' : '')
            + '<div class="sk-grid-2">'
            + (free
                ? '<div class="sk-field"><span>Envío</span><p class="sp-free-shipping"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i> Gratis: el pedido supera ' + h(money(S.vendor.free_shipping_threshold, cur)) + '</p></div>'
                : fieldHtml({ name: 'shipping_amount', label: 'Costo de envío (' + cur + ')', type: 'number', value: '0', attrs: { min: '0', step: '0.01', inputmode: 'decimal' }, help: 'Se suma al total. Dejalo en 0 si no cobrás envío.' }))
            + fieldHtml({ name: 'estimated_delivery', label: 'Entrega estimada', type: 'date', value: order.estimated_delivery || '', attrs: { min: today } })
            + fieldHtml({ name: 'note', label: 'Nota para el estudio (opcional)', type: 'textarea', span: true, attrs: { maxlength: '1000', placeholder: 'Ej. Sale mañana por la mañana' } })
            + '</div>'
            + '<p class="sp-total-preview" data-total-preview></p>'
            + '</form>';
        const modal = K().openModal({
            title: 'Confirmar pedido ' + order.order_number,
            body,
            size: 'md',
            actions: [
                { label: 'Volver', variant: 'ghost', value: null },
                {
                    label: 'Confirmar pedido',
                    variant: 'primary',
                    onClick: async m => {
                        const form = m.body.querySelector('form');
                        const values = K().readForm(form);
                        const shipping = free ? null : parseAmount(values.shipping_amount);
                        if (!free && shipping != null && (Number.isNaN(shipping) || shipping < 0)) {
                            m.setError(markErrors(form, { shipping_amount: 'El envío tiene que ser un monto mayor o igual a 0.' }));
                            return false;
                        }
                        if (values.estimated_delivery && values.estimated_delivery < today) {
                            m.setError(markErrors(form, { estimated_delivery: 'La entrega estimada no puede ser anterior a hoy.' }));
                            return false;
                        }
                        await commitAction(order, 'confirm', {
                            shippingAmount: free || shipping == null ? null : round2(shipping),
                            estimatedDelivery: values.estimated_delivery || null,
                            note: values.note || null
                        });
                        return true;
                    }
                }
            ]
        });
        const preview = modal.body && modal.body.querySelector('[data-total-preview]');
        const shippingInput = modal.body && modal.body.querySelector('[name="shipping_amount"]');
        const paintPreview = () => {
            if (!preview) return;
            const shipping = shippingInput ? parseAmount(shippingInput.value) : 0;
            const shipCents = shipping == null || Number.isNaN(shipping) || shipping < 0 ? 0 : toCents(shipping);
            const total = (toCents(order.subtotal) - toCents(order.discount_amount) + shipCents) / 100;
            preview.textContent = 'Total para el estudio: ' + money(total, cur) + (shipCents ? ' (incluye ' + money(shipCents / 100, cur) + ' de envío)' : '');
        };
        if (shippingInput) shippingInput.addEventListener('input', paintPreview);
        paintPreview();
        return modal.closed;
    }

    function shipFlow(order) {
        const today = K().toDateInput(new Date());
        const body = '<form class="sp-form" novalidate><div class="sk-grid-2">'
            + fieldHtml({ name: 'tracking_code', label: 'Código de seguimiento', value: order.tracking_code || '', attrs: { maxlength: '120', autocomplete: 'off', placeholder: 'Ej. OCA 123456789' } })
            + fieldHtml({ name: 'estimated_delivery', label: 'Entrega estimada', type: 'date', value: order.estimated_delivery || '', attrs: { min: today } })
            + fieldHtml({ name: 'note', label: 'Nota para el estudio (opcional)', type: 'textarea', span: true, attrs: { maxlength: '1000', placeholder: 'Ej. Va por moto, llega entre las 14 y las 18' } })
            + '</div></form>';
        const modal = K().openModal({
            title: 'Despachar pedido ' + order.order_number,
            body,
            size: 'md',
            actions: [
                { label: 'Volver', variant: 'ghost', value: null },
                {
                    label: 'Marcar despachado',
                    variant: 'primary',
                    onClick: async m => {
                        const form = m.body.querySelector('form');
                        const values = K().readForm(form);
                        if (values.estimated_delivery && values.estimated_delivery < today) {
                            m.setError(markErrors(form, { estimated_delivery: 'La entrega estimada no puede ser anterior a hoy.' }));
                            return false;
                        }
                        await commitAction(order, 'ship', {
                            trackingCode: values.tracking_code || null,
                            estimatedDelivery: values.estimated_delivery || null,
                            note: values.note || null
                        });
                        return true;
                    }
                }
            ]
        });
        return modal.closed;
    }

    // -------------------------------------------------------------
    // Catálogo
    // -------------------------------------------------------------
    function productThumb(p) {
        const src = httpUrl(p.image_url);
        return src
            ? '<img class="sp-thumb" src="' + ha(src) + '" alt="" loading="lazy">'
            : '<span class="sp-thumb sp-thumb--empty" aria-hidden="true"><i class="fa-solid fa-box"></i></span>';
    }

    function filterProducts(products, filter) {
        const q = text(filter.query).toLowerCase();
        return (products || []).filter(p => {
            if (!filter.archived && p.is_active === false) return false;
            if (filter.category && p.category !== filter.category) return false;
            if (!q) return true;
            return [p.name, p.brand, p.sku].map(v => text(v).toLowerCase()).join(' ').includes(q);
        });
    }

    async function renderCatalogo(host, params, token) {
        host.innerHTML = loadingHtml('Cargando catálogo…');
        await loadProducts(true);
        if (stale(token)) return;
        const f = S.productFilter;
        host.innerHTML = verificationBanner(true)
            + '<div class="sk-toolbar">'
            + '<div class="sk-field"><label for="sp-cat-search">Buscar</label><input type="search" id="sp-cat-search" placeholder="Nombre, marca o SKU" value="' + ha(f.query) + '" autocomplete="off"></div>'
            + '<div class="sk-field"><label for="sp-cat-category">Categoría</label><select id="sp-cat-category">' + K().optionsHtml('supplyCategory', f.category, { empty: 'Todas' }) + '</select></div>'
            + '<label class="sk-field sk-field--inline sp-inline-check"><input type="checkbox" id="sp-cat-archived"' + (f.archived ? ' checked' : '') + '> Ver archivados</label>'
            + '<span class="sk-toolbar-spacer"></span>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-action="products-csv"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Exportar CSV</button>'
            + '<button type="button" class="studio-btn studio-btn-primary" data-action="product-new"><i class="fa-solid fa-plus" aria-hidden="true"></i> Nuevo producto</button>'
            + '</div>'
            + '<p class="studio-help" data-catalog-summary></p>'
            + '<div data-products-table></div>';
        const paint = () => {
            const rows = filterProducts(S.products, f);
            const active = S.products.filter(p => p.is_active !== false).length;
            host.querySelector('[data-catalog-summary]').textContent = active + (active === 1 ? ' producto activo' : ' productos activos')
                + ' · ' + (S.products.length - active) + ' archivados · precios en ' + S.vendor.currency;
            const table = host.querySelector('[data-products-table]');
            table.innerHTML = K().renderTable({
                rows,
                emptyText: S.products.length ? 'Ningún producto coincide con el filtro.' : 'Todavía no cargaste productos. Empezá con "Nuevo producto".',
                rowClass: p => (p.is_active === false ? 'sp-row-archived' : ''),
                columns: [
                    { label: 'Producto', render: p => '<div class="sp-product-cell">' + productThumb(p) + '<div><strong>' + h(p.name) + '</strong><small>'
                        + h([p.brand, p.sku ? 'SKU ' + p.sku : null].filter(Boolean).join(' · ') || '—') + '</small></div></div>' },
                    { label: 'Categoría', render: p => h(label('supplyCategory', p.category)) },
                    { label: 'Presentación', render: p => h(p.unit_label || 'unidad') + (p.pack_size ? ' <small>× ' + h(K().fmtNumber(p.pack_size)) + ' por pack</small>' : '') },
                    { label: 'Precio', align: 'right', render: p => '<strong>' + h(money(p.price, p.currency)) + '</strong>'
                        + (p.compare_at_price != null && Number(p.compare_at_price) > Number(p.price) ? '<small class="sp-strike">' + h(money(p.compare_at_price, p.currency)) + '</small>' : '') },
                    { label: 'Stock', align: 'right', render: p => (p.stock_quantity == null
                        ? '<span class="sk-muted">Sin control</span>'
                        : (Number(p.stock_quantity) <= 0 ? K().badge('Sin stock', 'danger') : h(K().fmtNumber(p.stock_quantity)))) },
                    { label: 'Mínimo', align: 'right', render: p => h(K().fmtNumber(p.min_order_qty)) },
                    { label: 'Estado', render: p => (p.is_active === false ? K().badge('Archivado', 'neutral') : K().badge('Activo', 'success')) },
                    { label: 'Acciones', render: p => '<div class="sk-row-actions">'
                        + '<button type="button" class="studio-btn studio-btn-ghost" data-edit-product="' + ha(p.id) + '">Editar</button>'
                        + (p.is_active === false
                            ? '<button type="button" class="studio-btn studio-btn-ghost" data-restore-product="' + ha(p.id) + '">Reactivar</button>'
                            : '<button type="button" class="studio-btn studio-btn-ghost" data-archive-product="' + ha(p.id) + '">Archivar</button>')
                        + '</div>' }
                ]
            });
            table.querySelectorAll('[data-edit-product]').forEach(btn => btn.addEventListener('click', () => {
                const product = S.products.find(p => p.id === btn.getAttribute('data-edit-product'));
                if (product) openProductEditor(product, paint);
            }));
            table.querySelectorAll('[data-archive-product]').forEach(btn => btn.addEventListener('click', event => K().guarded(event.currentTarget, async () => {
                const product = S.products.find(p => p.id === btn.getAttribute('data-archive-product'));
                if (!product) return;
                const ok = await K().confirmDialog({
                    title: 'Archivar ' + product.name,
                    body: '<p class="sk-overlay__text">Los estudios dejan de verlo en el catálogo. Los pedidos ya hechos conservan sus datos y podés reactivarlo cuando quieras.</p>',
                    confirmLabel: 'Archivar'
                });
                if (!ok) return;
                const row = K().unwrap(await Sup().archiveProduct(product.id));
                replaceProduct(row || Object.assign({}, product, { is_active: false }));
                toast('Producto archivado.', 'success');
                paint();
            })));
            table.querySelectorAll('[data-restore-product]').forEach(btn => btn.addEventListener('click', event => K().guarded(event.currentTarget, async () => {
                const id = btn.getAttribute('data-restore-product');
                const row = K().unwrap(await Sup().saveProduct({ id, is_active: true }));
                replaceProduct(row || Object.assign({}, S.products.find(p => p.id === id), { is_active: true }));
                toast('Producto reactivado.', 'success');
                paint();
            })));
        };
        paint();
        const search = host.querySelector('#sp-cat-search');
        search.addEventListener('input', K().debounce(() => { f.query = search.value; paint(); }, 200));
        host.querySelector('#sp-cat-category').addEventListener('change', event => { f.category = event.currentTarget.value; paint(); });
        host.querySelector('#sp-cat-archived').addEventListener('change', event => { f.archived = event.currentTarget.checked; paint(); });
        host.querySelector('[data-action="product-new"]').addEventListener('click', () => openProductEditor(null, paint));
        host.querySelector('[data-action="products-csv"]').addEventListener('click', () => exportProductsCsv(filterProducts(S.products, f)));
    }

    function replaceProduct(row) {
        if (!row || !row.id) return;
        const i = S.products.findIndex(p => p.id === row.id);
        if (i >= 0) S.products[i] = row;
        else S.products.unshift(row);
    }

    function exportProductsCsv(rows) {
        K().downloadCsv('catalogo-' + (S.vendor.slug || 'supplies'), [
            { label: 'SKU', key: 'sku' },
            { label: 'Nombre', key: 'name' },
            { label: 'Marca', key: 'brand' },
            { label: 'Categoría', value: p => label('supplyCategory', p.category) },
            { label: 'Unidad', key: 'unit_label' },
            { label: 'Unidades por pack', value: p => (p.pack_size == null ? null : Number(p.pack_size)) },
            { label: 'Precio', value: p => Number(p.price) || 0 },
            { label: 'Moneda', key: 'currency' },
            { label: 'Precio de lista', value: p => (p.compare_at_price == null ? null : Number(p.compare_at_price)) },
            { label: 'Stock', value: p => (p.stock_quantity == null ? 'Sin control' : Number(p.stock_quantity)) },
            { label: 'Compra mínima', value: p => Number(p.min_order_qty) || 1 },
            { label: 'Estado', value: p => (p.is_active === false ? 'Archivado' : 'Activo') }
        ], rows);
    }

    function openProductEditor(product, onSaved) {
        const p = product || {};
        const tracks = product ? p.stock_quantity != null : false;
        const body = '<form class="sp-form" novalidate><div class="sk-grid-2">'
            + fieldHtml({ name: 'name', label: 'Nombre', value: p.name, span: true, attrs: { maxlength: '160', required: true, placeholder: 'Ej. Cartuchos RL 0.35 mm' } })
            + fieldHtml({ name: 'brand', label: 'Marca', value: p.brand, attrs: { maxlength: '120' } })
            + fieldHtml({ name: 'sku', label: 'SKU (opcional)', value: p.sku, attrs: { maxlength: '80', autocomplete: 'off' } })
            + fieldHtml({ name: 'category', label: 'Categoría', type: 'select', optionsHtml: K().optionsHtml('supplyCategory', p.category || '', { empty: 'Elegí una categoría', only: CATEGORIES }) })
            + fieldHtml({ name: 'unit_label', label: 'Unidad de venta', value: p.unit_label || 'unidad', attrs: { maxlength: '40', placeholder: 'unidad, caja, frasco…' } })
            + fieldHtml({ name: 'pack_size', label: 'Unidades por pack (opcional)', type: 'number', value: amountInput(p.pack_size), attrs: { min: '0.01', step: '0.01', inputmode: 'decimal' }, help: 'Ej. una caja de 20 cartuchos: unidad "caja", 20 por pack.' })
            + fieldHtml({ name: 'price', label: 'Precio (' + S.vendor.currency + ')', type: 'number', value: amountInput(p.price), attrs: { min: '0', step: '0.01', inputmode: 'decimal', required: true } })
            + fieldHtml({ name: 'compare_at_price', label: 'Precio de lista (opcional)', type: 'number', value: amountInput(p.compare_at_price), attrs: { min: '0', step: '0.01', inputmode: 'decimal' }, help: 'Se muestra tachado si es mayor al precio.' })
            + fieldHtml({ name: 'min_order_qty', label: 'Compra mínima', type: 'number', value: amountInput(p.min_order_qty == null ? 1 : p.min_order_qty), attrs: { min: '0.01', step: '0.01', inputmode: 'decimal' } })
            + '<div class="sk-field"><span>Stock</span>'
            + '<label class="sk-field--inline sp-inline-check"><input type="checkbox" name="track_stock"' + (tracks ? ' checked' : '') + '> Controlar stock</label>'
            + '<input class="studio-input" type="number" name="stock_quantity" id="sp-f-stock_quantity" aria-label="Stock disponible" min="0" step="0.01" inputmode="decimal" value="' + ha(amountInput(p.stock_quantity)) + '"' + (tracks ? '' : ' disabled') + '>'
            + '<span class="studio-help">Si no lo controlás, los estudios pueden pedir sin límite.</span></div>'
            + '<div class="sk-field sk-span-2"><label for="sp-f-image_url">Imagen</label>'
            + '<input type="url" id="sp-f-image_url" name="image_url" value="' + ha(httpUrl(p.image_url) || '') + '">'
            + '<span class="studio-help">JPG, PNG o WebP de hasta 10 MB.</span></div>'
            + fieldHtml({ name: 'description', label: 'Descripción', type: 'textarea', span: true, value: p.description, attrs: { maxlength: '2000' } })
            + '</div></form>';
        const modal = K().openModal({
            title: product ? 'Editar producto' : 'Nuevo producto',
            body,
            size: 'lg',
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                {
                    label: product ? 'Guardar cambios' : 'Crear producto',
                    variant: 'primary',
                    onClick: async m => {
                        const form = m.body.querySelector('form');
                        const values = K().readForm(form);
                        const result = validateProduct(values, S.vendor);
                        if (!result.ok) { m.setError(markErrors(form, result.errors)); return false; }
                        const payload = Object.assign({}, result.payload, product ? { id: product.id } : { vendor_id: S.vendor.id });
                        if (product) {
                            // No pisar el stock que movieron confirmaciones o cancelaciones
                            // mientras el formulario estaba abierto: solo se envía si cambió.
                            const before = product.stock_quantity == null ? null : Number(product.stock_quantity);
                            if (payload.stock_quantity === before) delete payload.stock_quantity;
                        }
                        const res = await Sup().saveProduct(payload);
                        if (res && res.error && String(res.error.code) === '23505') {
                            m.setError(markErrors(form, { sku: 'Ya tenés un producto con ese SKU.' }));
                            return false;
                        }
                        const row = K().unwrap(res);
                        replaceProduct(row);
                        toast(product ? 'Producto actualizado.' : 'Producto creado.', 'success');
                        if (typeof onSaved === 'function') onSaved();
                        return true;
                    }
                }
            ]
        });
        if (!modal.body) return modal.closed;
        const track = modal.body.querySelector('[name="track_stock"]');
        const stock = modal.body.querySelector('[name="stock_quantity"]');
        if (track && stock) track.addEventListener('change', () => { stock.disabled = !track.checked; if (track.checked) stock.focus(); });
        const imageInput = modal.body.querySelector('[name="image_url"]');
        if (imageInput && root.WeOtziUploader && typeof root.WeOtziUploader.attach === 'function') {
            root.WeOtziUploader.attach(imageInput, {
                supabase: S.client,
                bucket: PHOTO_BUCKET,
                pathPrefix: S.vendor.id,
                accept: 'image/jpeg,image/png,image/webp',
                placeholder: 'o pegá una URL https://'
            });
        }
        return modal.closed;
    }

    // -------------------------------------------------------------
    // Beneficios
    // -------------------------------------------------------------
    function previewCardHtml(vendor, tiers) {
        const v = vendor || {};
        const cur = v.currency;
        const logo = httpUrl(v.logo_image);
        const benefits = Array.isArray(v.benefits) ? v.benefits : [];
        const sortedTiers = (tiers || []).slice().sort((a, b) => Number(a.min_subtotal) - Number(b.min_subtotal));
        return '<article class="sp-preview-card" aria-label="Vista previa para estudios">'
            + '<header class="sp-preview-card__head">' + (logo ? '<img src="' + ha(logo) + '" alt="" class="sp-preview-card__logo">' : '<span class="sp-preview-card__logo sp-thumb--empty" aria-hidden="true"><i class="fa-solid fa-store"></i></span>')
            + '<div><p class="sp-preview-card__name">' + h(v.name || 'Tu tienda') + '</p>'
            + '<p class="sk-muted">' + h([v.city, v.country].filter(Boolean).join(', ') || 'Ubicación sin cargar') + '</p></div></header>'
            + (Number(v.platform_discount_pct) > 0 ? '<p class="sp-preview-card__discount">−' + h(fmtPct(v.platform_discount_pct)) + ' We Ötzi</p>' : '<p class="sk-muted">Sin descuento We Ötzi</p>')
            + (benefits.length ? '<ul class="sk-chips sp-preview-card__benefits">' + benefits.map(b => '<li class="sk-chip">' + h(b) + '</li>').join('') + '</ul>' : '')
            + '<dl class="sp-preview-card__terms">'
            + '<div><dt>Envío gratis</dt><dd>' + h(v.free_shipping_threshold != null ? 'Desde ' + money(v.free_shipping_threshold, cur) : 'No ofrecés') + '</dd></div>'
            + '<div><dt>Compra mínima</dt><dd>' + h(v.min_order_amount != null && Number(v.min_order_amount) > 0 ? money(v.min_order_amount, cur) : 'Sin mínimo') + '</dd></div>'
            + (sortedTiers.length ? '<div><dt>Por volumen</dt><dd>' + sortedTiers.map(t => h('Desde ' + money(t.min_subtotal, cur) + ': +' + fmtPct(t.discount_pct))).join('<br>') + '</dd></div>' : '')
            + '</dl></article>';
    }

    async function renderBeneficios(host, params, token) {
        host.innerHTML = loadingHtml();
        await loadTiers(true);
        if (stale(token)) return;
        const v = S.vendor;
        const cur = v.currency;
        host.innerHTML = '<div class="sp-benefits-layout"><div class="sp-benefits-main">'
            + '<section class="sk-section"><h2 class="studio-h2">Condiciones para estudios</h2>'
            + '<form class="sp-form" id="sp-conditions-form" novalidate><div class="sk-grid-2">'
            + fieldHtml({ name: 'platform_discount_pct', label: 'Descuento We Ötzi (%)', type: 'number', value: amountInput(v.platform_discount_pct), attrs: { min: '0', max: '60', step: '0.5', inputmode: 'decimal' }, help: 'Lo ven los estudios en todo tu catálogo y se aplica a cada pedido.' })
            + fieldHtml({ name: 'min_order_amount', label: 'Compra mínima (' + cur + ')', type: 'number', value: amountInput(v.min_order_amount), attrs: { min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Sin mínimo' } })
            + fieldHtml({ name: 'free_shipping_threshold', label: 'Envío gratis desde (' + cur + ')', type: 'number', value: amountInput(v.free_shipping_threshold), attrs: { min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Sin envío gratis' }, help: 'Se compara con el total después de descuentos.' })
            + '<div class="sk-field sk-span-2"><span id="sp-benefits-label">Beneficios (hasta 10)</span><div data-benefits aria-labelledby="sp-benefits-label"></div></div>'
            + '</div><div class="sp-form-actions"><button type="submit" class="studio-btn studio-btn-primary">Guardar condiciones</button></div></form></section>'
            + '<section class="sk-section"><div class="sk-section-head"><h2 class="studio-h2">Descuentos por volumen</h2>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-action="tier-new"><i class="fa-solid fa-plus" aria-hidden="true"></i> Agregar escalón</button></div>'
            + '<p class="studio-help">Se suman al descuento We Ötzi según el subtotal del pedido; aplica el escalón más alto alcanzado. El descuento total tiene un tope de 60%.</p>'
            + '<div data-tiers></div></section>'
            + '</div><aside class="sp-benefits-side">'
            + '<section class="sk-section"><h2 class="studio-h2">Así te ven</h2><div data-preview></div></section>'
            + '<section class="sk-section"><h2 class="studio-h2">Simulador</h2>'
            + '<div class="sk-field"><label for="sp-sim-subtotal">Subtotal de un pedido (' + h(cur) + ')</label>'
            + '<input type="number" id="sp-sim-subtotal" min="0" step="0.01" inputmode="decimal" placeholder="Ej. 150000"></div>'
            + '<p class="sp-sim-result" data-sim-result aria-live="polite"></p></section>'
            + '</aside></div>';

        const editor = K().listEditor({ items: v.benefits || [], max: 10, maxLen: 160, placeholder: 'Ej. Muestras gratis de tintas nuevas', label: 'Agregar beneficio' });
        if (editor.el) host.querySelector('[data-benefits]').appendChild(editor.el);

        const paintPreview = () => { host.querySelector('[data-preview]').innerHTML = previewCardHtml(S.vendor, S.tiers); paintSim(); };
        const simInput = host.querySelector('#sp-sim-subtotal');
        const paintSim = () => {
            const out = host.querySelector('[data-sim-result]');
            const amount = parseAmount(simInput.value);
            if (amount == null || Number.isNaN(amount) || amount <= 0) { out.textContent = 'Escribí un subtotal para ver cuánto ahorra el estudio.'; return; }
            const est = Sup().estimateOrder(S.vendor, S.tiers, [{ unit_price: amount, quantity: 1 }]);
            out.textContent = 'Descuento ' + fmtPct(est.pct) + ': ahorra ' + money(est.discount, cur) + ' y paga ' + money(est.total, cur)
                + (est.freeShipping ? ', con envío gratis.' : ' más el envío.')
                + (est.belowMinimum ? ' No llega a la compra mínima.' : '');
        };
        simInput.addEventListener('input', paintSim);

        const paintTiers = () => {
            const container = host.querySelector('[data-tiers]');
            const platform = Number(S.vendor.platform_discount_pct) || 0;
            container.innerHTML = K().renderTable({
                rows: S.tiers,
                emptyText: 'Sin escalones: todos los pedidos llevan solo el descuento We Ötzi.',
                columns: [
                    { label: 'Desde', align: 'right', render: t => h(money(t.min_subtotal, t.currency || cur)) },
                    { label: 'Adicional', align: 'right', render: t => h('+' + fmtPct(t.discount_pct)) },
                    { label: 'Total con We Ötzi', align: 'right', render: t => h(fmtPct(Math.min(60, platform + Number(t.discount_pct)))) },
                    { label: 'Etiqueta', render: t => (t.label ? h(t.label) : '<span class="sk-muted">—</span>') },
                    { label: 'Acciones', render: t => '<div class="sk-row-actions">'
                        + '<button type="button" class="studio-btn studio-btn-ghost" data-edit-tier="' + ha(t.id) + '">Editar</button>'
                        + '<button type="button" class="studio-btn studio-btn-ghost" data-delete-tier="' + ha(t.id) + '">Eliminar</button></div>' }
                ]
            });
            container.querySelectorAll('[data-edit-tier]').forEach(btn => btn.addEventListener('click', () => {
                const tier = S.tiers.find(t => t.id === btn.getAttribute('data-edit-tier'));
                if (tier) openTierEditor(tier, () => { paintTiers(); paintPreview(); });
            }));
            container.querySelectorAll('[data-delete-tier]').forEach(btn => btn.addEventListener('click', event => K().guarded(event.currentTarget, async () => {
                const tier = S.tiers.find(t => t.id === btn.getAttribute('data-delete-tier'));
                if (!tier) return;
                const ok = await K().confirmDialog({
                    title: 'Eliminar escalón',
                    body: '<p class="sk-overlay__text">Los pedidos desde ' + h(money(tier.min_subtotal, cur)) + ' dejan de llevar el ' + h(fmtPct(tier.discount_pct)) + ' adicional. Los pedidos ya enviados no cambian.</p>',
                    confirmLabel: 'Eliminar',
                    tone: 'danger'
                });
                if (!ok) return;
                K().unwrap(await Sup().deleteTier(tier.id));
                S.tiers = S.tiers.filter(t => t.id !== tier.id);
                toast('Escalón eliminado.', 'success');
                paintTiers();
                paintPreview();
            })));
        };
        host.querySelector('[data-action="tier-new"]').addEventListener('click', () => openTierEditor(null, () => { paintTiers(); paintPreview(); }));

        const form = host.querySelector('#sp-conditions-form');
        form.addEventListener('submit', event => {
            event.preventDefault();
            const btn = form.querySelector('button[type="submit"]');
            K().guarded(btn, async () => {
                const values = Object.assign(K().readForm(form), { benefits: editor.getItems() });
                const result = validateConditions(values);
                if (!result.ok) { toast(markErrors(form, result.errors), 'danger'); return; }
                markErrors(form, {});
                const row = K().unwrap(await Sup().updateVendor(S.vendor.id, result.payload));
                setVendor(Object.assign({}, S.vendor, result.payload, row || {}));
                editor.setItems(S.vendor.benefits || []);
                toast('Condiciones guardadas.', 'success');
                paintTiers();
                paintPreview();
            });
        });

        paintTiers();
        paintPreview();
    }

    function openTierEditor(tier, onSaved) {
        const t = tier || {};
        const cur = S.vendor.currency;
        const body = '<form class="sp-form" novalidate><div class="sk-grid-2">'
            + fieldHtml({ name: 'min_subtotal', label: 'Desde un subtotal de (' + cur + ')', type: 'number', value: amountInput(t.min_subtotal), attrs: { min: '0', step: '0.01', inputmode: 'decimal', required: true } })
            + fieldHtml({ name: 'discount_pct', label: 'Descuento adicional (%)', type: 'number', value: amountInput(t.discount_pct), attrs: { min: '0.5', max: '60', step: '0.5', inputmode: 'decimal', required: true } })
            + fieldHtml({ name: 'label', label: 'Etiqueta (opcional)', value: t.label, span: true, attrs: { maxlength: '120', placeholder: 'Ej. Compra mayorista' } })
            + '</div><p class="studio-help" data-tier-warning></p></form>';
        const modal = K().openModal({
            title: tier ? 'Editar escalón' : 'Nuevo escalón',
            body,
            size: 'sm',
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                {
                    label: 'Guardar escalón',
                    variant: 'primary',
                    onClick: async m => {
                        const form = m.body.querySelector('form');
                        const result = validateTier(K().readForm(form), S.tiers, S.vendor, tier ? tier.id : null);
                        if (!result.ok) { m.setError(markErrors(form, result.errors)); return false; }
                        const payload = Object.assign({}, result.payload, tier ? { id: tier.id } : { vendor_id: S.vendor.id });
                        const res = await Sup().saveTier(payload);
                        if (res && res.error && String(res.error.code) === '23505') {
                            m.setError(markErrors(form, { min_subtotal: 'Ya tenés un escalón con ese subtotal mínimo.' }));
                            return false;
                        }
                        const row = K().unwrap(res);
                        if (tier) S.tiers = S.tiers.map(x => (x.id === tier.id ? (row || Object.assign({}, x, payload)) : x));
                        else if (row) S.tiers.push(row);
                        S.tiers.sort((a, b) => Number(a.min_subtotal) - Number(b.min_subtotal));
                        toast('Escalón guardado.', 'success');
                        if (typeof onSaved === 'function') onSaved();
                        return true;
                    }
                }
            ]
        });
        if (modal.body) {
            const warn = modal.body.querySelector('[data-tier-warning]');
            const pctInput = modal.body.querySelector('[name="discount_pct"]');
            const paintWarn = () => {
                const result = validateTier(K().readForm(modal.body.querySelector('form')), [], S.vendor, null);
                warn.textContent = result.warnings.join(' ');
            };
            pctInput.addEventListener('input', paintWarn);
            paintWarn();
        }
        return modal.closed;
    }

    // -------------------------------------------------------------
    // Clientes
    // -------------------------------------------------------------
    async function renderClientes(host, params, token) {
        host.innerHTML = loadingHtml('Cargando clientes…');
        const res = await Sup().vendorCustomers(S.vendor.id);
        if (res && res.error) throw res.error;
        if (stale(token)) return;
        const rows = aggregateCustomers((res && res.data) || []);
        host.innerHTML = '<div class="sk-toolbar"><p class="studio-help sp-toolbar-note">Cuentan los pedidos confirmados, despachados, entregados o recibidos.</p>'
            + '<span class="sk-toolbar-spacer"></span>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-action="customers-csv"' + (rows.length ? '' : ' disabled') + '><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Exportar CSV</button></div>'
            + K().kpis([
                { label: 'Estudios clientes', value: String(rows.length) },
                { label: 'Pedidos vendidos', value: String(rows.reduce((sum, r) => sum + r.orders, 0)) },
                { label: 'Total vendido', valueHtml: K().fmtTotalsHtml(rows.reduce((acc, r) => K().mergeTotals(acc, r.totals), {}), { empty: 'Sin ventas' }) }
            ])
            + K().renderTable({
                rows,
                emptyText: 'Todavía no tenés estudios clientes. Aparecen cuando confirmás su primer pedido.',
                columns: [
                    { label: 'Estudio', render: r => '<strong>' + h(r.studio_name || 'Estudio') + '</strong>' },
                    { label: 'Pedidos', align: 'right', render: r => h(r.orders) },
                    { label: 'Total comprado', align: 'right', render: r => K().fmtTotalsHtml(r.totals) },
                    { label: 'Último pedido', render: r => h(K().fmtDate(r.last_order_at)) + '<small>' + h(K().fmtRelative(r.last_order_at)) + '</small>' },
                    { label: 'Acciones', render: r => '<div class="sk-row-actions"><button type="button" class="studio-btn studio-btn-ghost" data-customer-orders="' + ha(r.studio_name || '') + '">Ver pedidos</button></div>' }
                ]
            });
        host.querySelectorAll('[data-customer-orders]').forEach(btn => btn.addEventListener('click', () => {
            navigate('pedidos', { status: 'all', query: btn.getAttribute('data-customer-orders') });
        }));
        const csv = host.querySelector('[data-action="customers-csv"]');
        if (csv) csv.addEventListener('click', () => K().downloadCsv('clientes-' + (S.vendor.slug || 'supplies'), [
            { label: 'Estudio', key: 'studio_name' },
            { label: 'Pedidos', key: 'orders' },
            { label: 'Total comprado', value: r => K().fmtTotals(r.totals) },
            { label: 'Último pedido', value: r => K().fmtDate(r.last_order_at) }
        ], rows));
    }

    // -------------------------------------------------------------
    // Reportes
    // -------------------------------------------------------------
    async function renderReportes(host, params, token) {
        const preset = REPORT_PRESETS.includes(params.preset) ? params.preset : S.reportPreset;
        S.reportPreset = preset;
        const range = K().periodRange(preset);
        host.innerHTML = '<div class="sk-toolbar"><div class="sk-chips" role="group" aria-label="Período">'
            + REPORT_PRESETS.map(id => '<button type="button" class="sk-chip" data-preset="' + ha(id) + '" aria-pressed="' + (id === preset ? 'true' : 'false') + '">' + h(label('periodPreset', id)) + '</button>').join('')
            + '</div></div><div data-report-body>' + loadingHtml('Calculando ventas…') + '</div>'
            + '<section class="sk-section"><div class="sk-section-head"><h2 class="studio-h2">Productos más vendidos</h2><span data-top-actions></span></div>'
            + '<div data-top-products>' + loadingHtml('Calculando productos…') + '</div></section>';
        host.querySelectorAll('[data-preset]').forEach(chip => chip.addEventListener('click', () => {
            S.tabKey = null;
            activate('reportes', { preset: chip.getAttribute('data-preset') });
        }));

        const bodyEl = host.querySelector('[data-report-body]');
        try {
            const res = await Sup().vendorSalesMonthly(S.vendor.id, range.fromMonth, range.toMonth);
            if (res && res.error) throw res.error;
            if (stale(token)) return;
            const rows = ((res && res.data) || []).slice().sort((a, b) => String(a.month).localeCompare(String(b.month)) || String(a.currency).localeCompare(String(b.currency)));
            const sum = salesSummary(rows);
            const currencies = Array.from(new Set(rows.map(r => r.currency)));
            bodyEl.innerHTML = '<p class="studio-help">' + h(range.label + ' · del ' + K().fmtDate(range.from) + ' al ' + K().fmtDate(range.to)) + '. Cuentan los pedidos confirmados en adelante.</p>'
                + K().kpis([
                    { label: 'Ventas netas', valueHtml: K().fmtTotalsHtml(sum.net, { empty: 'Sin ventas' }), hint: 'Con descuentos y envío' },
                    { label: 'Bruto', valueHtml: K().fmtTotalsHtml(sum.gross) },
                    { label: 'Descuentos otorgados', valueHtml: K().fmtTotalsHtml(sum.discounts) },
                    { label: 'Envíos cobrados', valueHtml: K().fmtTotalsHtml(sum.shipping) },
                    { label: 'Pedidos', value: String(sum.orders) },
                    { label: 'Unidades', value: K().fmtNumber(sum.units) }
                ])
                + '<section class="sk-section"><div class="sk-section-head"><h2 class="studio-h2">Ventas por mes</h2>'
                + '<button type="button" class="studio-btn studio-btn-ghost" data-action="sales-csv"' + (rows.length ? '' : ' disabled') + '><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Exportar CSV</button></div>'
                + K().barChart({
                    items: rows.map(r => ({ label: K().monthLabel(r.month, { short: true }) + (currencies.length > 1 ? ' · ' + r.currency : ''), value: Number(r.net) || 0, currency: r.currency })),
                    format: 'money',
                    ariaLabel: 'Ventas netas por mes',
                    emptyText: 'Sin ventas en el período.'
                })
                + K().renderTable({
                    rows,
                    emptyText: 'Sin ventas en el período.',
                    columns: [
                        { label: 'Mes', format: 'month', key: 'month' },
                        { label: 'Moneda', key: 'currency' },
                        { label: 'Pedidos', format: 'number', key: 'orders' },
                        { label: 'Unidades', format: 'number', key: 'units' },
                        { label: 'Bruto', format: 'money', key: 'gross' },
                        { label: 'Descuentos', format: 'money', key: 'discounts' },
                        { label: 'Envío', format: 'money', key: 'shipping' },
                        { label: 'Neto', format: 'money', key: 'net' }
                    ]
                }) + '</section>';
            const csv = bodyEl.querySelector('[data-action="sales-csv"]');
            if (csv) csv.addEventListener('click', () => K().downloadCsv('ventas-' + (S.vendor.slug || 'supplies') + '-' + range.from + '-' + range.to, [
                { label: 'Mes', value: r => K().monthLabel(r.month) },
                { label: 'Moneda', key: 'currency' },
                { label: 'Pedidos', value: r => Number(r.orders) || 0 },
                { label: 'Unidades', value: r => Number(r.units) || 0 },
                { label: 'Bruto', value: r => Number(r.gross) || 0 },
                { label: 'Descuentos', value: r => Number(r.discounts) || 0 },
                { label: 'Envío', value: r => Number(r.shipping) || 0 },
                { label: 'Neto', value: r => Number(r.net) || 0 }
            ], rows));
        } catch (err) {
            if (stale(token)) return;
            bodyEl.innerHTML = errorHtml(err, 'No pudimos cargar las ventas.');
        }

        await renderTopProducts(host, range, token);
    }

    async function renderTopProducts(host, range, token) {
        const target = host.querySelector('[data-top-products]');
        const actions = host.querySelector('[data-top-actions]');
        try {
            const orders = (await loadOrders(true)).filter(o => SALE_STATUSES.includes(o.status) && inPeriod(o, range));
            const slice = orders.slice(0, TOP_PRODUCTS_ORDER_CAP);
            const details = (await mapLimit(slice, 4, o => loadOrderDetail(o.id))).filter(Boolean);
            if (stale(token)) return;
            const top = aggregateTopProducts(details, 10);
            target.innerHTML = (orders.length > slice.length
                ? '<p class="studio-help">Calculado sobre los ' + h(slice.length) + ' pedidos más recientes del período.</p>' : '')
                + K().renderTable({
                    rows: top,
                    emptyText: 'Sin productos vendidos en el período.',
                    columns: [
                        { label: 'Producto', render: r => '<strong>' + h(r.name) + '</strong>' + (r.sku ? '<small>SKU ' + h(r.sku) + '</small>' : '') },
                        { label: 'Unidades', align: 'right', render: r => h(K().fmtNumber(r.units)) + (r.unit_label ? ' <small>' + h(r.unit_label) + '</small>' : '') },
                        { label: 'Pedidos', align: 'right', render: r => h(r.orders) },
                        { label: 'Ingresos', align: 'right', render: r => K().fmtTotalsHtml(r.totals) }
                    ]
                });
            if (actions && top.length) {
                actions.innerHTML = '<button type="button" class="studio-btn studio-btn-ghost" data-action="top-csv"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Exportar CSV</button>';
                actions.querySelector('[data-action="top-csv"]').addEventListener('click', () => K().downloadCsv('productos-' + (S.vendor.slug || 'supplies') + '-' + range.from + '-' + range.to, [
                    { label: 'Producto', key: 'name' },
                    { label: 'SKU', key: 'sku' },
                    { label: 'Unidades', key: 'units' },
                    { label: 'Unidad', key: 'unit_label' },
                    { label: 'Pedidos', key: 'orders' },
                    { label: 'Ingresos', value: r => K().fmtTotals(r.totals) }
                ], top));
            }
        } catch (err) {
            if (stale(token)) return;
            target.innerHTML = errorHtml(err, 'No pudimos calcular los productos más vendidos.');
        }
    }

    // -------------------------------------------------------------
    // Perfil
    // -------------------------------------------------------------
    async function renderPerfil(host, params, token) {
        host.innerHTML = loadingHtml();
        const [privRes, productsRes, tiersRes] = await Promise.allSettled([
            Sup().getVendorPrivate(S.vendor.id),
            loadProducts(),
            loadTiers()
        ]);
        if (stale(token)) return;
        const priv = privRes.status === 'fulfilled' && privRes.value && !privRes.value.error ? (privRes.value.data || {}) : null;
        const lockCurrency = (productsRes.status !== 'fulfilled' || (productsRes.value || []).length > 0)
            || (tiersRes.status !== 'fulfilled' || (tiersRes.value || []).length > 0);
        const v = S.vendor;
        host.innerHTML = '<section class="sk-section"><h2 class="studio-h2">Perfil público</h2>'
            + '<p class="studio-help">Es lo que ven los estudios en el catálogo de reposición.</p>'
            + '<form class="sp-form" id="sp-profile-form" novalidate><div class="sk-grid-2">'
            + fieldHtml({ name: 'name', label: 'Nombre de la tienda', value: v.name, span: true, attrs: { maxlength: '160', required: true } })
            + fieldHtml({ name: 'description', label: 'Descripción', type: 'textarea', span: true, value: v.description, attrs: { maxlength: '2000' } })
            + '<div class="sk-field"><label for="sp-f-logo_image">Logo</label><input type="url" id="sp-f-logo_image" name="logo_image" value="' + ha(httpUrl(v.logo_image) || '') + '"><span class="studio-help">Cuadrado, JPG, PNG o WebP.</span></div>'
            + '<div class="sk-field"><label for="sp-f-cover_image">Portada</label><input type="url" id="sp-f-cover_image" name="cover_image" value="' + ha(httpUrl(v.cover_image) || '') + '"><span class="studio-help">Horizontal, hasta 10 MB.</span></div>'
            + fieldHtml({ name: 'contact_email', label: 'Email de contacto', type: 'email', value: v.contact_email, attrs: { maxlength: '254' }, help: 'Lo ven los estudios. Los avisos de pedidos llegan a tu email de acceso.' })
            + fieldHtml({ name: 'phone', label: 'Teléfono', type: 'tel', value: v.phone, attrs: { maxlength: '40' } })
            + fieldHtml({ name: 'whatsapp', label: 'WhatsApp', type: 'tel', value: v.whatsapp, attrs: { maxlength: '40' } })
            + fieldHtml({ name: 'instagram', label: 'Instagram', value: v.instagram, attrs: { maxlength: '120', placeholder: '@tutienda' } })
            + fieldHtml({ name: 'website', label: 'Sitio web', type: 'url', value: httpUrl(v.website) || '', attrs: { placeholder: 'https://' } })
            + fieldHtml({ name: 'country', label: 'País', value: v.country, attrs: { maxlength: '120' } })
            + fieldHtml({ name: 'city', label: 'Ciudad', value: v.city, attrs: { maxlength: '120' } })
            + fieldHtml({ name: 'ships_to_countries', label: 'Países a los que enviás', value: (v.ships_to_countries || []).join(', '), attrs: { placeholder: 'AR, UY', autocomplete: 'off' }, help: 'Códigos de 2 letras separados por coma. Vacío: enviás a todos lados.' })
            + fieldHtml({ name: 'lead_time_days', label: 'Plazo de entrega (días)', type: 'number', value: amountInput(v.lead_time_days), attrs: { min: '0', max: '365', step: '1', inputmode: 'numeric' } })
            + fieldHtml({
                name: 'currency', label: 'Moneda', type: 'select', optionsHtml: K().currencyOptionsHtml(v.currency),
                attrs: lockCurrency ? { disabled: true } : {},
                help: lockCurrency ? 'Tus precios ya están cargados en ' + v.currency + '. Para cambiar la moneda escribinos a soporte.' : 'Todo tu catálogo y tus pedidos van en esta moneda.'
            })
            + '</div><div class="sp-form-actions"><button type="submit" class="studio-btn studio-btn-primary">Guardar perfil</button></div></form></section>'
            + '<section class="sk-section"><h2 class="studio-h2">Datos fiscales</h2>'
            + '<p class="studio-help">Solo los ven vos y el equipo de We Ötzi.</p>'
            + (priv === null ? errorHtml(privRes.status === 'fulfilled' ? privRes.value && privRes.value.error : privRes.reason, 'No pudimos cargar tus datos fiscales.') : '')
            + '<form class="sp-form" id="sp-private-form" novalidate' + (priv === null ? ' hidden' : '') + '><div class="sk-grid-2">'
            + fieldHtml({ name: 'legal_name', label: 'Razón social', value: priv && priv.legal_name, attrs: { maxlength: '200' } })
            + fieldHtml({ name: 'tax_id', label: 'CUIT / identificación fiscal', value: priv && priv.tax_id, attrs: { maxlength: '60' } })
            + fieldHtml({ name: 'fiscal_address', label: 'Domicilio fiscal', value: priv && priv.fiscal_address, attrs: { maxlength: '500' } })
            + fieldHtml({ name: 'billing_email', label: 'Email de facturación', type: 'email', value: priv && priv.billing_email, attrs: { maxlength: '254' } })
            + fieldHtml({ name: 'notes', label: 'Notas para el equipo de We Ötzi', type: 'textarea', span: true, value: priv && priv.notes, attrs: { maxlength: '2000' } })
            + '</div><div class="sp-form-actions"><button type="submit" class="studio-btn studio-btn-primary">Guardar datos fiscales</button></div></form></section>';

        const uploader = root.WeOtziUploader;
        if (uploader && typeof uploader.attach === 'function') {
            ['logo_image', 'cover_image'].forEach(name => {
                const input = host.querySelector('[name="' + name + '"]');
                if (input) uploader.attach(input, { supabase: S.client, bucket: PHOTO_BUCKET, pathPrefix: S.vendor.id, accept: 'image/jpeg,image/png,image/webp', placeholder: 'o pegá una URL https://' });
            });
        }

        const profileForm = host.querySelector('#sp-profile-form');
        profileForm.addEventListener('submit', event => {
            event.preventDefault();
            K().guarded(profileForm.querySelector('button[type="submit"]'), async () => {
                const result = validateProfile(K().readForm(profileForm));
                if (!result.ok) { toast(markErrors(profileForm, result.errors), 'danger'); return; }
                markErrors(profileForm, {});
                const row = K().unwrap(await Sup().updateVendor(S.vendor.id, result.payload));
                setVendor(Object.assign({}, S.vendor, result.payload, row || {}));
                toast('Perfil guardado.', 'success');
            });
        });
        const privateForm = host.querySelector('#sp-private-form');
        privateForm.addEventListener('submit', event => {
            event.preventDefault();
            K().guarded(privateForm.querySelector('button[type="submit"]'), async () => {
                const result = validatePrivate(K().readForm(privateForm));
                if (!result.ok) { toast(markErrors(privateForm, result.errors), 'danger'); return; }
                markErrors(privateForm, {});
                K().unwrap(await Sup().saveVendorPrivate(S.vendor.id, result.payload));
                toast('Datos fiscales guardados.', 'success');
            });
        });
    }

    // -------------------------------------------------------------
    // Cuenta
    // -------------------------------------------------------------
    function vendorStatusKey(v) {
        if (v.is_active === false) return 'inactive';
        return v.is_verified ? 'verified' : 'unverified';
    }

    async function renderCuenta(host) {
        host.innerHTML = '<p class="studio-help">Estado de la cuenta: ' + K().statusBadge('vendorStatus', vendorStatusKey(S.vendor)) + '</p>'
            + verificationBanner(false);
        const email = doc().getElementById('account-email');
        if (email && (!email.textContent || email.textContent === '—')) {
            let address = S.vendor.email || '';
            if (!address) {
                try {
                    const { data } = await S.client.auth.getSession();
                    address = (data && data.session && data.session.user && data.session.user.email) || '';
                } catch (_) { address = ''; }
            }
            email.textContent = address || '—';
        }
    }

    function wireAccount() {
        const form = doc().getElementById('account-password-form');
        const status = doc().getElementById('account-status');
        const show = (kind, msg) => {
            status.className = 'studio-status studio-status-' + kind;
            status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
            status.textContent = msg;
            status.hidden = false;
        };
        if (form) {
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const password = doc().getElementById('account-password').value;
                if (password !== doc().getElementById('account-password-confirm').value) {
                    show('error', 'Las contraseñas no coinciden.');
                    return;
                }
                const button = form.querySelector('button[type="submit"]');
                button.disabled = true;
                try {
                    await S.auth.changePassword(password);
                    form.reset();
                    show('success', 'Contraseña actualizada.');
                } catch (err) {
                    show('error', friendly(err, 'No pudimos actualizar la contraseña.'));
                } finally { button.disabled = false; }
            });
        }
        const logout = () => S.auth.logout().catch(err => toast(friendly(err, 'No pudimos cerrar la sesión.'), 'danger'));
        ['logout-btn', 'account-logout-btn'].forEach(id => {
            const btn = doc().getElementById(id);
            if (btn) btn.addEventListener('click', logout);
        });
    }

    // -------------------------------------------------------------
    // Arranque
    // -------------------------------------------------------------
    function setVendor(vendor) {
        S.vendor = vendor;
        if (S.auth && typeof S.auth.remember === 'function') S.auth.remember(vendor);
        paintHeader();
    }

    function paintHeader() {
        const name = doc().getElementById('vendor-name-display');
        if (name) name.innerHTML = 'Panel · <span class="accent">' + h(S.vendor.name || 'Mi tienda') + '</span>';
        const statusLabel = doc().getElementById('vendor-status-label');
        if (statusLabel) statusLabel.textContent = label('vendorStatus', vendorStatusKey(S.vendor));
    }

    function showDashboardStatus(kind, msg) {
        const el = doc().getElementById('dashboard-status');
        if (!el) return;
        el.className = 'studio-status studio-status-' + kind;
        el.textContent = msg;
        el.hidden = false;
    }

    const RENDERERS = {
        inicio: renderInicio,
        pedidos: renderPedidos,
        catalogo: renderCatalogo,
        beneficios: renderBeneficios,
        clientes: renderClientes,
        reportes: renderReportes,
        perfil: renderPerfil,
        cuenta: renderCuenta
    };

    async function boot() {
        const d = doc();
        if (!d || !d.querySelector('.supplies-dashboard')) return;
        const auth = root.WeOtziSuppliesAuth;
        if (!auth || !K() || !Sup()) {
            showDashboardStatus('error', 'No pudimos cargar el panel. Recargá la página e intentá nuevamente.');
            return;
        }
        S.auth = auth;
        try {
            S.client = await auth.ready();
        } catch (err) {
            showDashboardStatus('error', friendly(err));
            return;
        }
        const vendor = auth.getCurrent() || await auth.check();
        if (!vendor) {
            // check() ya redirige (sin sesión o sin cuenta) o mostró el motivo.
            if (typeof auth.isUnavailable === 'function' && auth.isUnavailable()) {
                d.querySelectorAll('.studio-dash-panel [data-module-root]').forEach(node => { node.innerHTML = ''; });
            }
            return;
        }
        S.vendor = vendor;
        paintHeader();
        wireAccount();
        // Las pestañas se cablean recién con la cuenta resuelta: un click
        // anterior solo cambia el hash, que se lee abajo.
        wireTabs();

        const query = new URLSearchParams(root.location.search || '');
        const deepOrder = query.get('pedido');
        const hash = root.location.hash.slice(1);
        if (deepOrder && UUID_RE.test(deepOrder)) {
            navigate('pedidos', { order: deepOrder });
            // El enlace del email ya abrió el pedido: se saca ?pedido= para que
            // recargar o volver a la pestaña no lo reabra.
            query.delete('pedido');
            const rest = query.toString();
            try {
                root.history.replaceState(root.history.state, '', (root.location.pathname || '') + (rest ? '?' + rest : '') + '#pedidos');
            } catch (_) { /* sin history */ }
        } else {
            activate(TAB_PATTERN.test(hash) && TABS.includes(hash) ? hash : DEFAULT_TAB);
        }

        if (S.tab !== 'inicio' && S.tab !== 'pedidos') {
            loadOrders(true).catch(err => console.warn('[supplies-dashboard] badge:', err));
        }
    }

    return {
        boot,
        runOrderAction,
        orderActions,
        notifyKind,
        filterOrders,
        countByStatus,
        freeShippingApplies,
        stockWarnings,
        validateProduct,
        validateTier,
        validateConditions,
        validateProfile,
        validatePrivate,
        aggregateCustomers,
        aggregateTopProducts,
        salesSummary,
        profileChecklist,
        parseAmount,
        parseCountries,
        // HTML del drawer de pedido (necesitan el kit en window).
        orderDetailHtml,
        actionButtonsHtml,
        TABS,
        ACTION_KIND,
        NOTIFY_PATH,
        PHOTO_BUCKET
    };
});
