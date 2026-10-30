// ============================================
// We Ötzi — Panel de estudio · Reposición (pestaña `reposicion`)
// Pedidos a usuarios Supplies (tiendas de insumos verificadas por We Ötzi).
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Reposición".
//   - Sugerencias: StudioOps.listRestockCandidates; ítems en o por debajo del
//     punto de reposición (misma regla que la vista de salud de inventario).
//   - Catálogo: Supplies.searchCatalog (solo vendors verificados y activos).
//     Si el vendor tiene ships_to_countries, se exige el país de la sede.
//   - Carrito: uno por proveedor (un pedido por proveedor), guardado en
//     sessionStorage, con el estimado de Supplies.estimateOrder y los avisos
//     de mínimo y envío gratis. "Enviar pedido" → submitOrder → postNotify
//     order_submitted.
//   - Mis pedidos: drawer con líneas, importes y eventos; "Total actualizado
//     por el proveedor"; cancelar (submitted o confirmed) y recibir (shipped o
//     delivered) con cantidades por línea y el resultado de la recepción.
//   - navigate('reposicion', {order}) abre el drawer de ese pedido;
//     {view: 'sugerencias'|'catalogo'|'carrito'|'pedidos'} elige la sección y
//     {filter: 'active'|'to_receive'|'received'|'closed'|'all'} el filtro.
//   - Eventos en `document`: al recibir despacha
//     'weotzi:studio-inventory-changed' y 'weotzi:studio-finance-changed'
//     ({detail: {source: 'restock', order_id}}); escucha el primero (de otros
//     módulos) para recargar las sugerencias en la próxima visita.
//
// Sin la migración M5 la pestaña degrada: sugerencias sin vínculo a Supplies
// y avisos de "falta aplicar una migración" en catálogo, carrito y pedidos.
// Las funciones puras se exportan a Node (module.exports) para los tests.
// ============================================

(function () {
    'use strict';

    const W = typeof window !== 'undefined' ? window : null;

    const TAB = 'reposicion';
    const VIEWS = ['sugerencias', 'catalogo', 'carrito', 'pedidos'];
    const VIEW_LABELS = { sugerencias: 'Sugerencias', catalogo: 'Catálogo', carrito: 'Carrito', pedidos: 'Mis pedidos' };
    const STORAGE_PREFIX = 'weotzi:studio-restock:v1:';
    const NOTIFY_PATH = '/api/supplies/notify';
    const MAX_CARTS = 20;
    const MAX_LINES = 100;          // tope de submit_supply_order
    const NOTES_MAX = 1000;
    const CATALOG_LIMIT = 120;
    const CATALOG_TTL_MS = 60000;
    const RELOAD_TTL_MS = 30000;
    const CANCELLABLE = ['submitted', 'confirmed'];
    const RECEIVABLE = ['shipped', 'delivered'];
    const UPDATED_TOTAL_STATUSES = ['confirmed', 'shipped', 'delivered'];
    const ORDER_FILTERS = {
        active: ['submitted', 'confirmed', 'shipped', 'delivered'],
        to_receive: ['shipped', 'delivered'],
        received: ['received'],
        closed: ['cancelled', 'rejected'],
        all: null
    };
    const ORDER_FILTER_LABELS = {
        active: 'En curso',
        to_receive: 'Por recibir',
        received: 'Recibidos',
        closed: 'Cancelados y rechazados',
        all: 'Todos'
    };
    const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
    const MIGRATION_MESSAGE = 'La reposición con proveedores Supplies todavía no está disponible (falta aplicar una migración).';
    const UNLINKED_LABEL = 'Sin vincular (se resuelve al recibir)';

    // -------------------------------------------------------------
    // Utilidades puras
    // -------------------------------------------------------------
    function num(v) {
        if (v == null || v === '' || typeof v === 'boolean') return null;
        const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
        return Number.isFinite(n) ? n : null;
    }
    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    function cleanId(v) {
        const s = String(v == null ? '' : v).trim();
        return ID_RE.test(s) ? s : null;
    }
    function cleanText(v, max) {
        return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    }
    function cleanNotes(v) {
        return String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, NOTES_MAX);
    }
    function cleanCurrency(v) {
        const s = String(v == null ? '' : v).trim().toUpperCase();
        return /^[A-Z]{3}$/.test(s) ? s : null;
    }
    function plural(n, one, many) { return Math.abs(Number(n)) === 1 ? one : many; }

    // -------------------------------------------------------------
    // Sugerencias
    // -------------------------------------------------------------
    // En o por debajo del punto de reposición (= needs_reorder de la vista
    // studio_inventory_health). Sin punto cargado no hay sugerencia.
    function needsRestock(item) {
        const level = num(item && item.reorder_level);
        if (level == null) return false;
        const onHand = num(item && item.quantity_on_hand);
        return (onHand == null ? 0 : onHand) <= level;
    }
    function restockRatio(item) {
        const level = num(item.reorder_level) || 0;
        const onHand = Math.max(0, num(item.quantity_on_hand) || 0);
        if (level > 0) return onHand / level;
        return onHand > 0 ? 1 : 0;
    }
    // Los más urgentes primero (menor stock relativo), después por nombre.
    function restockSuggestions(items) {
        return (Array.isArray(items) ? items : [])
            .filter(item => item && needsRestock(item))
            .sort((a, b) => (restockRatio(a) - restockRatio(b)) || String(a.name || '').localeCompare(String(b.name || '')));
    }
    // Cantidad sugerida en unidades del producto: lo que falta para llegar al
    // doble del punto de reposición, en packs (pack_size unidades por pack),
    // al menos 1 y al menos el mínimo de compra del producto.
    function suggestQuantity(item, product) {
        const level = Math.max(0, num(item && item.reorder_level) || 0);
        const onHand = Math.max(0, num(item && item.quantity_on_hand) || 0);
        const packRaw = num(product && product.pack_size);
        const pack = packRaw != null && packRaw > 0 ? packRaw : 1;
        const missing = Math.max(level * 2 - onHand, 0);
        let qty = Math.ceil(missing / pack - 1e-9);
        if (!(qty >= 1)) qty = 1;
        const min = num(product && product.min_order_qty);
        if (min != null && min > qty) qty = round2(Math.ceil(min * 100 - 1e-9) / 100);
        return qty;
    }

    // -------------------------------------------------------------
    // Cobertura de envío (ships_to_countries, ISO-2)
    // -------------------------------------------------------------
    function normalizeCountry(v) {
        const s = String(v == null ? '' : v).trim().toUpperCase();
        return /^[A-Z]{2}$/.test(s) ? s : null;
    }
    // País de la sede de entrega. Sin sede (el estudio no cargó sedes) se usa
    // el del estudio; una sede sin país devuelve null (no se adivina).
    function locationCountry(location, studio) {
        if (location) return normalizeCountry(location.country_code) || normalizeCountry(location.country);
        return studio ? (normalizeCountry(studio.country_code) || normalizeCountry(studio.country)) : null;
    }
    function shipsToList(vendor) {
        const list = Array.isArray(vendor && vendor.ships_to_countries) ? vendor.ships_to_countries : [];
        return list.map(normalizeCountry).filter(Boolean);
    }
    // Lista vacía = envía a todos lados. Con lista, exige el país de la sede.
    function shipsTo(vendor, country) {
        const list = shipsToList(vendor);
        if (!list.length) return true;
        const code = normalizeCountry(country);
        return !!code && list.includes(code);
    }
    function filterCatalogByShipping(products, country) {
        const visible = [];
        const hidden = [];
        (Array.isArray(products) ? products : []).forEach(p => {
            if (!p) return;
            const vendor = p.supply_vendors || {};
            if (vendor.is_verified === false || vendor.is_active === false) return;
            (shipsTo(vendor, country) ? visible : hidden).push(p);
        });
        return { visible, hidden };
    }
    let regionNames = null;
    function countryName(code) {
        const c = normalizeCountry(code);
        if (!c) return '';
        try {
            if (regionNames === null) {
                regionNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
                    ? new Intl.DisplayNames(['es'], { type: 'region' })
                    : false;
            }
            const name = regionNames ? regionNames.of(c) : null;
            return name && name !== c ? name : c;
        } catch (_) {
            return c;
        }
    }

    // -------------------------------------------------------------
    // Carrito (un carrito por proveedor) y sessionStorage
    // -------------------------------------------------------------
    function vendorSnapshot(v) {
        const src = v || {};
        return {
            id: cleanId(src.id),
            name: cleanText(src.name, 160) || 'Proveedor',
            slug: cleanText(src.slug, 160) || null,
            logo_image: typeof src.logo_image === 'string' ? src.logo_image.slice(0, 2000) : null,
            currency: cleanCurrency(src.currency),
            platform_discount_pct: Math.max(0, Math.min(60, num(src.platform_discount_pct) || 0)),
            free_shipping_threshold: num(src.free_shipping_threshold),
            min_order_amount: num(src.min_order_amount),
            ships_to_countries: shipsToList(src),
            benefits: (Array.isArray(src.benefits) ? src.benefits : []).map(b => cleanText(b, 160)).filter(Boolean).slice(0, 10)
        };
    }
    function lineFromProduct(product) {
        const p = product || {};
        const min = num(p.min_order_qty);
        const pack = num(p.pack_size);
        const stock = num(p.stock_quantity);
        const price = num(p.price);
        return {
            product_id: cleanId(p.id || p.product_id),
            name: cleanText(p.name, 160) || 'Producto',
            sku: cleanText(p.sku, 80) || null,
            brand: cleanText(p.brand, 120) || null,
            category: cleanText(p.category, 40) || null,
            unit_label: cleanText(p.unit_label, 40) || 'unidad',
            pack_size: pack != null && pack > 0 ? pack : null,
            price: price != null && price >= 0 ? price : 0,
            currency: cleanCurrency(p.currency),
            min_order_qty: min != null && min > 0 ? min : 1,
            stock_quantity: stock != null && stock >= 0 ? stock : null,
            image_url: typeof p.image_url === 'string' ? p.image_url.slice(0, 2000) : null
        };
    }
    function emptyCartState() { return { locationId: null, carts: {} }; }

    // Lo que viene de sessionStorage no es confiable: se reconstruye campo por
    // campo, con ids válidos, cantidades > 0 y los topes del pedido.
    function sanitizeCartState(raw) {
        const out = emptyCartState();
        if (!raw || typeof raw !== 'object') return out;
        out.locationId = cleanId(raw.locationId);
        const carts = raw.carts && typeof raw.carts === 'object' ? raw.carts : {};
        Object.keys(carts).slice(0, MAX_CARTS * 2).forEach(key => {
            if (Object.keys(out.carts).length >= MAX_CARTS) return;
            const cart = carts[key];
            const vendorId = cleanId(key);
            if (!vendorId || !cart || typeof cart !== 'object') return;
            const vendor = vendorSnapshot(Object.assign({}, cart.vendor || {}, { id: vendorId }));
            const seen = new Set();
            const lines = [];
            (Array.isArray(cart.lines) ? cart.lines : []).forEach(rawLine => {
                if (!rawLine || typeof rawLine !== 'object' || lines.length >= MAX_LINES) return;
                const line = lineFromProduct(rawLine);
                if (!line.product_id || seen.has(line.product_id)) return;
                seen.add(line.product_id);
                const qty = num(rawLine.quantity);
                line.quantity = qty != null && qty > 0 ? round2(qty) : line.min_order_qty;
                line.inventory_item_id = cleanId(rawLine.inventory_item_id);
                lines.push(line);
            });
            if (!lines.length) return;
            out.carts[vendorId] = {
                vendorId,
                vendor,
                locationId: cleanId(cart.locationId),
                notes: cleanNotes(cart.notes),
                lines,
                updatedAt: num(cart.updatedAt) || 0
            };
        });
        return out;
    }
    function loadCartState(storage, key) {
        if (!storage || typeof storage.getItem !== 'function') return emptyCartState();
        try {
            const raw = storage.getItem(key);
            return raw ? sanitizeCartState(JSON.parse(raw)) : emptyCartState();
        } catch (_) {
            return emptyCartState();
        }
    }
    function saveCartState(storage, key, state) {
        if (!storage || typeof storage.setItem !== 'function') return false;
        try {
            const clean = sanitizeCartState(state);
            if (!clean.locationId && !Object.keys(clean.carts).length) storage.removeItem(key);
            else storage.setItem(key, JSON.stringify(clean));
            return true;
        } catch (_) {
            return false;
        }
    }
    // Suma el producto al carrito de su proveedor (crea el carrito si hace
    // falta). Si ya estaba, suma la cantidad. Lanza con un mensaje en español.
    function addToCart(state, product, opts) {
        const o = opts || {};
        const vendorRaw = (product && product.supply_vendors) || o.vendor || {};
        const vendorId = cleanId(vendorRaw.id || (product && product.vendor_id));
        const line = lineFromProduct(product);
        if (!vendorId || !line.product_id) throw new Error('No pudimos identificar el producto. Recargá el catálogo.');
        const qty = num(o.quantity);
        if (!(qty > 0)) throw new Error('Ingresá una cantidad mayor a 0.');
        let cart = state.carts[vendorId];
        if (!cart) {
            if (Object.keys(state.carts).length >= MAX_CARTS) throw new Error('Tenés demasiados carritos abiertos. Enviá o vaciá alguno antes de seguir.');
            cart = state.carts[vendorId] = {
                vendorId,
                vendor: vendorSnapshot(Object.assign({}, vendorRaw, { id: vendorId })),
                locationId: cleanId(o.locationId) || cleanId(state.locationId),
                notes: '',
                lines: [],
                updatedAt: 0
            };
        } else if (product && product.supply_vendors) {
            cart.vendor = vendorSnapshot(Object.assign({}, product.supply_vendors, { id: vendorId }));
        }
        const linkId = cleanId(o.inventoryItemId);
        let existing = cart.lines.find(l => l.product_id === line.product_id);
        const merged = !!existing;
        if (existing) {
            Object.assign(existing, line, { quantity: round2((num(existing.quantity) || 0) + qty), inventory_item_id: existing.inventory_item_id || linkId });
            delete existing.unavailable;
        } else {
            if (cart.lines.length >= MAX_LINES) throw new Error('Un pedido puede tener hasta ' + MAX_LINES + ' productos.');
            existing = Object.assign(line, { quantity: round2(qty), inventory_item_id: linkId });
            cart.lines.push(existing);
        }
        cart.updatedAt = Date.now();
        return { cart, line: existing, merged };
    }
    function cartLineCount(state) {
        return Object.keys((state && state.carts) || {}).reduce((sum, id) => sum + (state.carts[id].lines || []).length, 0);
    }
    // Actualiza las líneas con el catálogo vigente del proveedor. Las que ya no
    // están quedan `unavailable`; las que cambiaron de precio, `priceChanged`.
    function refreshCartFromCatalog(cart, products, vendorRow) {
        if (!cart) return cart;
        const map = products instanceof Map ? products : new Map((Array.isArray(products) ? products : []).map(p => [p.id, p]));
        let vendorFromCatalog = null;
        cart.lines.forEach(line => {
            const product = map.get(line.product_id);
            if (!product || product.is_active === false) {
                line.unavailable = true;
                delete line.priceChanged;
                return;
            }
            if (product.supply_vendors) vendorFromCatalog = product.supply_vendors;
            const fresh = lineFromProduct(product);
            const priceChanged = num(line.price) !== fresh.price;
            Object.assign(line, fresh);
            delete line.unavailable;
            if (priceChanged) line.priceChanged = true; else delete line.priceChanged;
        });
        const vendor = vendorFromCatalog || vendorRow || null;
        if (vendor) cart.vendor = vendorSnapshot(Object.assign({}, vendor, { id: cart.vendorId }));
        cart.vendorUnavailable = !vendor;
        return cart;
    }
    // Payload de submit_supply_order: [{product_id, quantity, inventory_item_id?}].
    function orderItemsPayload(cart) {
        return ((cart && cart.lines) || [])
            .filter(line => line && !line.unavailable && cleanId(line.product_id) && num(line.quantity) > 0)
            .map(line => {
                const item = { product_id: line.product_id, quantity: round2(line.quantity) };
                const link = cleanId(line.inventory_item_id);
                if (link) item.inventory_item_id = link;
                return item;
            });
    }

    // Avisos por línea (bloquean el envío).
    function lineIssuesFor(line, kit) {
        const msgs = [];
        const unit = line.unit_label || 'unidad';
        if (line.unavailable) {
            msgs.push('Ya no está disponible en el catálogo: quitalo del carrito.');
            return msgs;
        }
        const qty = num(line.quantity);
        if (!(qty > 0)) {
            msgs.push('Ingresá una cantidad mayor a 0.');
            return msgs;
        }
        const min = num(line.min_order_qty) || 1;
        if (qty < min) msgs.push('El mínimo es ' + kit.fmtNumber(min) + ' ' + unit + '.');
        const stock = num(line.stock_quantity);
        if (stock != null && qty > stock) {
            msgs.push(stock <= 0 ? 'Sin stock por ahora.' : 'Stock disponible: ' + kit.fmtNumber(stock) + ' ' + unit + '.');
        }
        return msgs;
    }
    // Próximo tier que de verdad mejora el descuento: el % total tiene tope
    // de 60 (least(60, We Ötzi + tier) en submit_supply_order).
    function nextTier(tiers, estimate, currency) {
        const platform = num(estimate.platformPct) || 0;
        const pct = num(estimate.pct) || 0;
        return (Array.isArray(tiers) ? tiers : [])
            .filter(t => t && (!currency || !t.currency || t.currency === currency))
            .filter(t => num(t.min_subtotal) > estimate.subtotal && Math.min(60, platform + (num(t.discount_pct) || 0)) > pct)
            .sort((a, b) => num(a.min_subtotal) - num(b.min_subtotal))[0] || null;
    }
    // % de volumen efectivo (el que guarda el servidor: pct total − We Ötzi).
    function effectiveTierPct(estimate) {
        if (!estimate) return 0;
        return round2(Math.max(0, (num(estimate.pct) || 0) - (num(estimate.platformPct) || 0)));
    }

    // Estimado + validaciones del carrito de un proveedor.
    // opts: {kit, estimate (Supplies.estimateOrder), tiers, country,
    //        locationMissing (el estudio tiene sedes y el carrito no eligió una)}
    function cartSummary(cart, opts) {
        const o = opts || {};
        const kit = o.kit;
        const estimate = typeof o.estimate === 'function' ? o.estimate : null;
        const vendor = (cart && cart.vendor) || {};
        const lines = (cart && cart.lines) || [];
        const name = vendor.name || 'El proveedor';
        const currency = vendor.currency || (lines[0] && lines[0].currency) || null;
        const active = lines.filter(l => !l.unavailable);
        const est = estimate
            ? estimate(vendor, o.tiers || [], active.map(l => ({ product_id: l.product_id, unit_price: l.price, quantity: num(l.quantity) || 0 })))
            : null;
        const money = v => kit.fmtMoney(v, currency);

        const lineIssues = {};
        lines.forEach(line => {
            const msgs = lineIssuesFor(line, kit);
            if (msgs.length) lineIssues[line.product_id] = msgs;
        });

        const issues = [];
        if (!active.length) issues.push('Agregá al menos un producto disponible.');
        if (Object.keys(lineIssues).length) issues.push('Revisá las líneas marcadas antes de enviar.');
        if (active.length > MAX_LINES) issues.push('Un pedido puede tener hasta ' + MAX_LINES + ' productos.');
        if (cart && cart.vendorUnavailable) issues.push(name + ' no está recibiendo pedidos en este momento.');
        if (est && est.belowMinimum) {
            issues.push('El pedido mínimo de ' + name + ' es ' + money(est.minimum) + ': te faltan ' + money(est.missingForMinimum) + '.');
        }
        if (o.locationMissing) {
            issues.push('Elegí la sede de entrega del pedido.');
        } else if (!shipsTo(vendor, o.country)) {
            const list = shipsToList(vendor).map(countryName).join(', ');
            issues.push(normalizeCountry(o.country)
                ? name + ' no envía a ' + countryName(o.country) + '. Elegí otra sede de entrega.'
                : name + ' solo envía a ' + list + '. Cargá el país de la sede de entrega en Sedes.');
        }

        const notices = [];
        if (est) {
            const tier = nextTier(o.tiers, est, currency);
            if (tier) {
                notices.push({
                    tone: 'info',
                    text: 'Con ' + money(round2(num(tier.min_subtotal) - est.subtotal)) + ' más llegás a un descuento por volumen del ' + kit.fmtPercent(tier.discount_pct) + '.'
                });
            }
            if (est.freeShippingThreshold != null) {
                notices.push(est.freeShipping
                    ? { tone: 'success', text: 'Envío gratis: el pedido supera ' + money(est.freeShippingThreshold) + '.' }
                    : { tone: 'info', text: 'Te faltan ' + money(est.missingForFreeShipping) + ' para el envío gratis (desde ' + money(est.freeShippingThreshold) + '). Si no llegás, el proveedor suma el envío al confirmar.' });
            } else {
                notices.push({ tone: 'neutral', text: 'El proveedor suma el envío al confirmar el pedido.' });
            }
        }
        return { estimate: est, currency, lineIssues, issues, notices, canSubmit: issues.length === 0 && !!est };
    }

    // -------------------------------------------------------------
    // Pedidos
    // -------------------------------------------------------------
    function orderIdFrom(data) {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || typeof row !== 'object') return null;
        return cleanId(row.order_id || row.id);
    }
    function canCancel(order) { return !!order && CANCELLABLE.includes(order.status); }
    function canReceive(order) { return !!order && RECEIVABLE.includes(order.status); }
    function hasUpdatedTotal(order) {
        return !!order && UPDATED_TOTAL_STATUSES.includes(order.status) && (num(order.shipping_amount) || 0) > 0;
    }
    // "Total actualizado por el proveedor: X (envío Y)" cuando el proveedor
    // confirmó con envío. null si no corresponde.
    function updatedTotalNotice(order, kit) {
        if (!hasUpdatedTotal(order)) return null;
        return 'Total actualizado por el proveedor: ' + kit.fmtMoney(order.total, order.currency)
            + ' (envío ' + kit.fmtMoney(order.shipping_amount, order.currency) + ')';
    }
    // Parámetros de navigate('reposicion', …): {order} abre el drawer del
    // pedido; {view} elige la sección; {filter} el filtro de Mis pedidos.
    // Lo que no es válido se ignora.
    function parseShowParams(params) {
        const p = params && typeof params === 'object' ? params : {};
        const view = typeof p.view === 'string' && VIEWS.includes(p.view) ? p.view : null;
        const filter = typeof p.filter === 'string' && Object.prototype.hasOwnProperty.call(ORDER_FILTERS, p.filter) ? p.filter : null;
        return { orderId: cleanId(p.order), view, filter };
    }
    function filterOrders(orders, filter) {
        const statuses = Object.prototype.hasOwnProperty.call(ORDER_FILTERS, filter) ? ORDER_FILTERS[filter] : ORDER_FILTERS.active;
        const list = Array.isArray(orders) ? orders : [];
        return statuses ? list.filter(o => o && statuses.includes(o.status)) : list.slice();
    }
    // Valida las cantidades recibidas (0 ≤ q ≤ pedido) y arma p_lines.
    // values: {item_id: texto del input}.
    function receiveLinesPayload(items, values) {
        const lines = [];
        const errors = {};
        let partial = false;
        let received = 0;
        (Array.isArray(items) ? items : []).forEach(item => {
            if (!item || !item.id) return;
            const ordered = num(item.quantity) || 0;
            const raw = values && Object.prototype.hasOwnProperty.call(values, item.id) ? values[item.id] : ordered;
            const q = num(raw);
            if (q == null || q < 0) { errors[item.id] = 'Ingresá una cantidad de 0 o más.'; return; }
            const qty = round2(q);
            if (qty > ordered) { errors[item.id] = 'No puede superar lo pedido (' + String(ordered).replace('.', ',') + ').'; return; }
            if (qty < ordered) partial = true;
            received += qty;
            lines.push({ item_id: item.id, received_quantity: qty });
        });
        return { lines, errors, partial, nothing: received === 0 && !Object.keys(errors).length };
    }
    function summarizeReceiveResult(result) {
        const r = result && typeof result === 'object' ? result : {};
        const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
        const shortages = list(r.shortages);
        return {
            orderId: r.order_id || null,
            orderNumber: r.order_number || null,
            receivedAt: r.received_at || null,
            partial: r.partial === true || shortages.length > 0,
            items: list(r.items),
            shortages,
            mismatches: list(r.currency_mismatches),
            expense: r.expense && typeof r.expense === 'object' && num(r.expense.amount) != null ? r.expense : null
        };
    }

    // -------------------------------------------------------------
    // HTML (todo lo que viene de datos se escapa; href/src por safeUrl)
    // -------------------------------------------------------------
    function unitText(kit, qty, unit) {
        return kit.fmtNumber(qty) + ' ' + (unit || 'unidad');
    }
    function packText(kit, line) {
        const pack = num(line && line.pack_size);
        return pack ? (line.unit_label || 'pack') + ' × ' + kit.fmtNumber(pack) : '';
    }

    function catalogCardHtml(product, kit, opts) {
        const o = opts || {};
        const E = kit.escapeHtml, A = kit.escapeAttr;
        const v = product.supply_vendors || {};
        const id = cleanId(product.id) || '';
        const currency = product.currency || v.currency;
        const img = kit.safeUrl(product.image_url);
        const logo = kit.safeUrl(v.logo_image);
        const price = num(product.price);
        const compare = num(product.compare_at_price);
        const pct = num(v.platform_discount_pct) || 0;
        const benefits = (Array.isArray(v.benefits) ? v.benefits : []).filter(Boolean).slice(0, 3);
        const free = num(v.free_shipping_threshold);
        const minOrder = num(v.min_order_amount);
        const stock = num(product.stock_quantity);
        const out = stock != null && stock <= 0;
        const minQty = num(product.min_order_qty) || 1;
        const unit = product.unit_label || 'unidad';
        const pack = packText(kit, product);
        const meta = [product.brand, product.sku ? 'SKU ' + product.sku : null, product.category ? kit.label('supplyCategory', product.category) : null].filter(Boolean);
        const facts = [];
        if (free != null) facts.push('<li>Envío gratis desde ' + E(kit.fmtMoney(free, v.currency || currency)) + '</li>');
        if (minOrder != null && minOrder > 0) facts.push('<li>Pedido mínimo ' + E(kit.fmtMoney(minOrder, v.currency || currency)) + '</li>');
        if (minQty > 1) facts.push('<li>Mínimo ' + E(unitText(kit, minQty, unit)) + '</li>');
        if (out) facts.push('<li class="is-warning">Sin stock por ahora</li>');
        else if (stock != null && stock <= 10) facts.push('<li>Quedan ' + E(unitText(kit, stock, unit)) + '</li>');
        const inCart = num(o.inCartQty);
        const qtyValue = num(o.quantity) || minQty;
        return '<article class="rs-card' + (out ? ' is-out' : '') + '" data-rs-product="' + A(id) + '">'
            + '<div class="rs-card__media">'
            + (img ? '<img src="' + A(img) + '" alt="" loading="lazy" decoding="async">' : '<i class="fa-solid fa-box-open" aria-hidden="true"></i>')
            + (pct > 0 ? '<span class="rs-card__flag">−' + E(kit.fmtPercent(pct)) + ' We Ötzi</span>' : '')
            + '</div>'
            + '<div class="rs-card__body">'
            + '<p class="rs-card__vendor">' + (logo ? '<img class="rs-card__logo" src="' + A(logo) + '" alt="" loading="lazy">' : '') + '<span>' + E(v.name || 'Proveedor') + '</span></p>'
            + '<h3 class="rs-card__title">' + E(product.name || 'Producto') + '</h3>'
            + (meta.length ? '<p class="rs-card__meta">' + meta.map(E).join(' · ') + '</p>' : '')
            + '<p class="rs-card__price"><strong>' + E(kit.fmtMoney(price, currency)) + '</strong> <span>/ ' + E(unit) + (pack ? ' (' + E(pack) + ')' : '') + '</span>'
            + (compare != null && price != null && compare > price ? ' <s>' + E(kit.fmtMoney(compare, currency)) + '</s>' : '') + '</p>'
            + (facts.length ? '<ul class="rs-card__facts">' + facts.join('') + '</ul>' : '')
            + (benefits.length ? '<div class="sk-chips rs-card__benefits">' + benefits.map(b => '<span class="sk-chip">' + E(b) + '</span>').join('') + '</div>' : '')
            + '</div>'
            + '<div class="rs-card__buy">'
            + '<label class="rs-card__qty"><span>Cantidad</span><input type="number" class="studio-input" inputmode="decimal" min="' + A(minQty) + '" step="any" value="' + A(qtyValue) + '" data-rs-qty aria-label="Cantidad de ' + A(product.name || 'producto') + '"' + (out ? ' disabled' : '') + '></label>'
            + '<button type="button" class="studio-btn studio-btn-primary sk-btn-sm" data-rs-action="add" data-product="' + A(id) + '"' + (out ? ' disabled' : '') + '>Agregar</button>'
            + '</div>'
            + '<p class="rs-card__incart" data-rs-incart' + (inCart > 0 ? '' : ' hidden') + '>' + (inCart > 0 ? 'En el carrito: ' + E(unitText(kit, inCart, unit)) : '') + '</p>'
            + '</article>';
    }

    function noticesHtml(kit, issues, notices) {
        const E = kit.escapeHtml;
        const rows = (issues || []).map(text => '<li class="rs-notice rs-notice--danger">' + E(text) + '</li>')
            .concat((notices || []).map(n => '<li class="rs-notice rs-notice--' + E(n.tone || 'info') + '">' + E(n.text) + '</li>'));
        return rows.length ? '<ul class="rs-notices">' + rows.join('') + '</ul>' : '';
    }

    // Bloque de totales + avisos del carrito (se repinta en cada cambio).
    function cartSummaryHtml(summary, kit) {
        const E = kit.escapeHtml;
        const est = summary.estimate;
        if (!est) return '<p class="studio-help">No pudimos calcular el estimado. El servidor recalcula al enviar.</p>';
        const money = v => E(kit.fmtMoney(v, summary.currency));
        const pctParts = [];
        const tierPct = effectiveTierPct(est);
        if (est.platformPct > 0) pctParts.push('We Ötzi ' + kit.fmtPercent(est.platformPct));
        if (tierPct > 0) pctParts.push('volumen ' + kit.fmtPercent(tierPct));
        const shipping = est.freeShippingThreshold != null && est.freeShipping ? 'Gratis' : 'A confirmar por el proveedor';
        return '<dl class="rs-totals">'
            + '<div><dt>Subtotal</dt><dd>' + money(est.subtotal) + '</dd></div>'
            + (est.discount > 0 ? '<div class="rs-totals__discount"><dt>Descuento' + (pctParts.length ? ' (' + E(pctParts.join(' + ')) + ')' : '') + '</dt><dd>−' + money(est.discount) + '</dd></div>' : '')
            + '<div><dt>Envío</dt><dd>' + E(shipping) + '</dd></div>'
            + '<div class="rs-totals__total"><dt>Total estimado</dt><dd>' + money(est.total) + '</dd></div>'
            + '</dl>'
            + noticesHtml(kit, summary.issues, summary.notices)
            + '<p class="studio-help">Es un estimado: el servidor recalcula los importes al enviar.</p>';
    }

    function cartLineHtml(cart, line, summary, kit, items) {
        const E = kit.escapeHtml, A = kit.escapeAttr;
        const issues = summary.lineIssues[line.product_id] || [];
        const estLine = summary.estimate ? (summary.estimate.lines || []).find(l => l.product_id === line.product_id) : null;
        const unit = line.unit_label || 'unidad';
        const pack = packText(kit, line);
        const link = cleanId(line.inventory_item_id);
        const linked = link ? (items || []).find(i => i.id === link) : null;
        const currency = summary.currency;
        const mismatch = linked && linked.currency && currency && cleanCurrency(linked.currency) !== currency;
        const options = '<option value="">' + E(UNLINKED_LABEL) + '</option>'
            + (items || []).map(i => '<option value="' + A(i.id) + '"' + (i.id === link ? ' selected' : '') + '>' + E(i.name || 'Ítem') + (i.sku ? ' (' + E(i.sku) + ')' : '') + '</option>').join('');
        const lineId = 'rs-line-' + (cart.vendorId + '-' + line.product_id).replace(/[^A-Za-z0-9-]/g, '');
        return '<div class="rs-line' + (line.unavailable ? ' is-unavailable' : '') + (issues.length ? ' has-issue' : '') + '" data-rs-line="' + A(line.product_id) + '">'
            + '<div class="rs-line__product"><strong>' + E(line.name) + '</strong>'
            + '<small>' + [line.sku ? 'SKU ' + line.sku : null, kit.fmtMoney(line.price, line.currency || currency) + ' / ' + unit + (pack ? ' (' + pack + ')' : '')].filter(Boolean).map(E).join(' · ') + '</small>'
            + (line.priceChanged ? '<span class="sk-badge sk-badge--warning">Precio actualizado</span>' : '')
            + '</div>'
            + '<div class="rs-line__qty sk-field"><label for="' + A(lineId) + '-q">Cantidad</label>'
            + '<input id="' + A(lineId) + '-q" type="number" inputmode="decimal" min="' + A(num(line.min_order_qty) || 1) + '" step="any" value="' + A(num(line.quantity) == null ? '' : line.quantity) + '" data-rs-field="quantity"' + (line.unavailable ? ' disabled' : '') + '></div>'
            + '<div class="rs-line__link sk-field"><label for="' + A(lineId) + '-i">Ítem de inventario</label>'
            + '<select id="' + A(lineId) + '-i" data-rs-field="inventory_item_id"' + (line.unavailable ? ' disabled' : '') + '>' + options + '</select>'
            + '<small class="rs-line__hint" data-rs-line-hint>' + (mismatch ? E('El ítem está en ' + linked.currency + ' y el pedido en ' + currency + ': el costo no se va a cargar al recibir.') : '') + '</small></div>'
            + '<span class="rs-line__total sk-num" data-rs-line-total>' + E(estLine && estLine.valid ? kit.fmtMoney(estLine.line_subtotal, currency) : '—') + '</span>'
            + '<button type="button" class="rs-line__remove" data-rs-action="remove-line" aria-label="Quitar ' + A(line.name) + ' del carrito">×</button>'
            + '<p class="rs-line__issue" data-rs-line-issue role="status"' + (issues.length ? '' : ' hidden') + '>' + E(issues.join(' ')) + '</p>'
            + '</div>';
    }

    // opts: {items, locations, locationLabel(loc), meta: {loading, refreshError}}
    function cartHtml(cart, summary, kit, opts) {
        const o = opts || {};
        const E = kit.escapeHtml, A = kit.escapeAttr;
        const vendor = cart.vendor || {};
        const logo = kit.safeUrl(vendor.logo_image);
        const id = 'rs-cart-' + String(cart.vendorId).replace(/[^A-Za-z0-9-]/g, '');
        const locations = o.locations || [];
        const locationField = locations.length
            ? '<div class="sk-field"><label for="' + A(id) + '-loc">Sede de entrega</label><select id="' + A(id) + '-loc" data-rs-field="locationId">'
                + (!locations.some(l => l.id === cart.locationId) ? '<option value="" selected>Elegí una sede</option>' : '')
                + locations.map(l => '<option value="' + A(l.id) + '"' + (l.id === cart.locationId ? ' selected' : '') + '>' + E(o.locationLabel ? o.locationLabel(l) : (l.label || 'Sede')) + '</option>').join('')
                + '</select></div>'
            : '<p class="studio-help">Sin sedes cargadas: el pedido se entrega en la dirección del estudio.</p>';
        const meta = o.meta || {};
        const lines = cart.lines.length;
        return '<section class="rs-cart sk-section" data-rs-cart="' + A(cart.vendorId) + '" aria-labelledby="' + A(id) + '-title">'
            + '<header class="rs-cart__head">'
            + '<h2 class="sk-section-title rs-cart__vendor" id="' + A(id) + '-title">' + (logo ? '<img src="' + A(logo) + '" alt="" loading="lazy">' : '') + E(vendor.name || 'Proveedor') + '</h2>'
            + '<span class="rs-cart__count">' + E(lines + ' ' + plural(lines, 'producto', 'productos')) + (summary.currency ? ' · ' + E(summary.currency) : '') + '</span>'
            + '</header>'
            + (meta.loading ? '<p class="studio-help">Actualizando precios del catálogo…</p>' : '')
            + (meta.refreshError ? '<p class="studio-status studio-status-info">No pudimos actualizar los precios del catálogo. El servidor recalcula al enviar.</p>' : '')
            + (vendor.benefits && vendor.benefits.length ? '<div class="sk-chips rs-cart__benefits">' + vendor.benefits.slice(0, 4).map(b => '<span class="sk-chip">' + E(b) + '</span>').join('') + '</div>' : '')
            + '<div class="rs-cart__lines">' + cart.lines.map(line => cartLineHtml(cart, line, summary, kit, o.items)).join('') + '</div>'
            + '<div class="rs-cart__foot">'
            + '<div class="rs-cart__fields">' + locationField
            + '<div class="sk-field"><label for="' + A(id) + '-notes">Notas para el proveedor</label><textarea id="' + A(id) + '-notes" maxlength="' + NOTES_MAX + '" rows="3" placeholder="Horario de entrega, aclaraciones…" data-rs-field="notes">' + E(cart.notes || '') + '</textarea></div>'
            + '</div>'
            + '<div class="rs-cart__summary" data-rs-cart-summary>' + cartSummaryHtml(summary, kit) + '</div>'
            + '</div>'
            + '<div class="rs-cart__actions">'
            + '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-action="clear-cart">Vaciar carrito</button>'
            + '<button type="button" class="studio-btn studio-btn-primary" data-rs-action="submit"' + (summary.canSubmit ? '' : ' disabled aria-disabled="true"') + '>Enviar pedido</button>'
            + '</div>'
            + '</section>';
    }

    function receiveResultHtml(result, kit) {
        const E = kit.escapeHtml;
        const r = summarizeReceiveResult(result);
        const rows = r.items.map(it => {
            const received = num(it.received_quantity) || 0;
            return '<tr>'
                + '<td data-label="Producto">' + E(it.product_name || 'Producto') + '</td>'
                + '<td class="sk-num" data-label="Recibido">' + E(kit.fmtNumber(received) + ' / ' + kit.fmtNumber(it.quantity)) + '</td>'
                + '<td data-label="Inventario">' + (it.inventory_item_name ? E(it.inventory_item_name) : '<span class="sk-muted">—</span>')
                + (it.created_item ? ' <span class="sk-badge sk-badge--info">Ítem nuevo</span>' : '') + '</td>'
                + '<td class="sk-num" data-label="Suma al stock">' + E(num(it.units_added) ? '+' + kit.fmtNumber(it.units_added) : '—') + '</td>'
                + '<td class="sk-num" data-label="Costo unitario">' + (it.currency_mismatch ? '<span class="sk-badge sk-badge--warning">Sin costo</span>' : E(num(it.unit_cost) != null ? kit.fmtNumber(it.unit_cost) : '—')) + '</td>'
                + '</tr>';
        }).join('');
        const shortages = r.shortages.map(s => '<li>Faltaron ' + E(kit.fmtNumber(s.missing)) + ' de ' + E(s.product_name || 'un producto') + ' (recibiste ' + E(kit.fmtNumber(s.received_quantity)) + ' de ' + E(kit.fmtNumber(s.quantity)) + ').</li>').join('');
        const mismatches = r.mismatches.map(m => '<li>' + E(m.inventory_item_name || 'Un ítem') + ' está en ' + E(m.item_currency || '—') + ' y el pedido en ' + E(m.order_currency || '—') + ': el stock se sumó, pero el costo unitario no se cargó.</li>').join('');
        return '<div class="rs-result" data-rs-result>'
            + '<p class="studio-status ' + (r.partial ? 'studio-status-info' : 'studio-status-success') + ' rs-result__status" role="status">'
            + E(r.partial ? 'Recepción parcial: el inventario se repuso con lo que llegó.' : 'Pedido recibido: el inventario quedó repuesto.') + '</p>'
            + (rows ? '<div class="sk-table-wrap"><table class="sk-table rs-result__table"><thead><tr><th scope="col">Producto</th><th scope="col" class="sk-num">Recibido</th><th scope="col">Inventario</th><th scope="col" class="sk-num">Suma al stock</th><th scope="col" class="sk-num">Costo unitario</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '')
            + (shortages ? '<div class="rs-result__block"><h3 class="rs-subtitle">Faltantes</h3><ul class="rs-list">' + shortages + '</ul></div>' : '')
            + (mismatches ? '<div class="rs-result__block"><h3 class="rs-subtitle">Monedas distintas</h3><ul class="rs-list">' + mismatches + '</ul></div>' : '')
            + (r.expense
                ? '<p class="rs-result__expense">Gasto registrado en Finanzas: <strong>' + E(kit.fmtMoney(r.expense.amount, r.expense.currency)) + '</strong> (compra de inventario).</p>'
                : '<p class="studio-help">No se registró un gasto porque no se recibió nada.</p>')
            + '</div>';
    }

    // Detalle del pedido para el drawer. opts: {itemNames: Map(id → nombre)}
    function orderDetailHtml(order, kit, opts) {
        const o = opts || {};
        const E = kit.escapeHtml;
        const cur = order.currency;
        const money = v => E(kit.fmtMoney(v, cur));
        const vendor = order.supply_vendors || {};
        const loc = order.studio_locations || null;
        const items = Array.isArray(order.supply_order_items) ? order.supply_order_items : [];
        const events = Array.isArray(order.supply_order_events) ? order.supply_order_events : [];
        const names = o.itemNames instanceof Map ? o.itemNames : new Map();
        const updated = updatedTotalNotice(order, kit);
        const showReceived = order.status === 'received' || items.some(i => i.received_quantity != null);
        const pctParts = [];
        if (num(order.platform_discount_pct) > 0) pctParts.push('We Ötzi ' + kit.fmtPercent(order.platform_discount_pct));
        if (num(order.tier_discount_pct) > 0) pctParts.push('volumen ' + kit.fmtPercent(order.tier_discount_pct));
        const shipping = num(order.shipping_amount) || 0;
        const shippingText = shipping > 0 ? money(shipping)
            : (order.status === 'submitted' ? 'A confirmar por el proveedor' : (['rejected', 'cancelled'].includes(order.status) ? '—' : 'Gratis'));
        const meta = [
            ['Proveedor', E(vendor.name || 'Proveedor')],
            ['Sede de entrega', loc ? E(loc.label || 'Sede') + (loc.city ? ' · ' + E(loc.city) : '') : '<span class="sk-muted">Dirección del estudio</span>'],
            ['Enviado', E(kit.fmtDateTime(order.submitted_at || order.created_at))],
            order.confirmed_at ? ['Confirmado', E(kit.fmtDateTime(order.confirmed_at))] : null,
            order.shipped_at ? ['Despachado', E(kit.fmtDateTime(order.shipped_at))] : null,
            order.delivered_at ? ['Entregado', E(kit.fmtDateTime(order.delivered_at))] : null,
            order.received_at ? ['Recibido', E(kit.fmtDateTime(order.received_at))] : null,
            order.cancelled_at ? ['Cancelado', E(kit.fmtDateTime(order.cancelled_at))] : null,
            order.rejected_at ? ['Rechazado', E(kit.fmtDateTime(order.rejected_at))] : null,
            order.estimated_delivery ? ['Entrega estimada', E(kit.fmtDate(order.estimated_delivery))] : null,
            order.tracking_code ? ['Seguimiento', E(order.tracking_code)] : null,
            vendor.contact_email || vendor.phone || vendor.whatsapp
                ? ['Contacto', [vendor.contact_email, vendor.phone, vendor.whatsapp ? 'WhatsApp ' + vendor.whatsapp : null].filter(Boolean).map(E).join(' · ')]
                : null
        ].filter(Boolean);
        const actions = [];
        if (canReceive(order)) actions.push('<button type="button" class="studio-btn studio-btn-primary sk-btn-sm" data-rs-action="receive-order">Recibir pedido</button>');
        if (canCancel(order)) actions.push('<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-action="cancel-order">Cancelar pedido</button>');
        if (order.status === 'received' && order.receive_result && order.receive_result.expense) actions.push('<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-action="go-finance">Ver gasto en Finanzas</button>');

        const lineRows = items.map(it => {
            const link = it.inventory_item_id ? names.get(it.inventory_item_id) : null;
            const pack = packText(kit, it);
            return '<tr>'
                + '<td data-label="Producto"><strong>' + E(it.product_name || 'Producto') + '</strong>'
                + '<small>' + [it.sku ? 'SKU ' + it.sku : null, pack || null, link ? 'Inventario: ' + link : null].filter(Boolean).map(E).join(' · ') + '</small></td>'
                + '<td class="sk-num" data-label="Cantidad">' + E(unitText(kit, it.quantity, it.unit_label)) + '</td>'
                + (showReceived ? '<td class="sk-num" data-label="Recibido">' + E(it.received_quantity == null ? '—' : kit.fmtNumber(it.received_quantity)) + '</td>' : '')
                + '<td class="sk-num" data-label="Precio">' + money(it.unit_price) + '</td>'
                + '<td class="sk-num" data-label="Descuento">' + (num(it.line_discount) > 0 ? '−' + money(it.line_discount) : '<span class="sk-muted">—</span>') + '</td>'
                + '<td class="sk-num" data-label="Total">' + money(it.line_total) + '</td>'
                + '</tr>';
        }).join('');
        const eventRows = events.map(ev => '<li>'
            + '<span class="rs-timeline__when">' + E(kit.fmtDateTime(ev.created_at)) + '</span>'
            + '<span class="rs-timeline__what">' + (ev.from_status ? E(kit.label('supplyOrderStatus', ev.from_status)) + ' → ' : '') + '<strong>' + E(kit.label('supplyOrderStatus', ev.to_status)) + '</strong>'
            + (ev.actor_role ? ' · ' + E(kit.label('supplyActorRole', ev.actor_role)) : '') + '</span>'
            + (ev.note ? '<span class="rs-timeline__note">' + E(ev.note) + '</span>' : '')
            + '</li>').join('');

        return '<div class="rs-detail">'
            + '<div class="rs-detail__head">' + kit.statusBadge('supplyOrderStatus', order.status)
            + '<span class="rs-detail__number">' + E(order.order_number || '') + '</span></div>'
            + (updated ? '<p class="studio-status studio-status-success rs-detail__updated" role="status">' + E(updated) + '</p>' : '')
            + (order.status === 'rejected' ? '<p class="studio-status studio-status-error" role="status">' + E('El proveedor rechazó el pedido.' + (order.vendor_note ? ' Motivo: ' + order.vendor_note : '')) + '</p>' : '')
            + (order.vendor_note && order.status !== 'rejected' ? '<p class="rs-detail__note"><span>Nota del proveedor</span>' + E(order.vendor_note) + '</p>' : '')
            + (actions.length ? '<div class="rs-detail__actions">' + actions.join('') + '</div>' : '')
            + '<dl class="rs-detail__meta">' + meta.map(([k, v]) => '<div><dt>' + E(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>'
            + (order.notes ? '<p class="rs-detail__note"><span>Tus notas</span>' + E(order.notes) + '</p>' : '')
            + '<h3 class="rs-subtitle">Productos</h3>'
            + (lineRows
                ? '<div class="sk-table-wrap"><table class="sk-table rs-detail__lines"><thead><tr><th scope="col">Producto</th><th scope="col" class="sk-num">Cantidad</th>'
                    + (showReceived ? '<th scope="col" class="sk-num">Recibido</th>' : '')
                    + '<th scope="col" class="sk-num">Precio</th><th scope="col" class="sk-num">Descuento</th><th scope="col" class="sk-num">Total</th></tr></thead><tbody>' + lineRows + '</tbody></table></div>'
                : kit.emptyState({ body: 'El pedido no tiene líneas.', compact: true }))
            + '<dl class="rs-totals">'
            + '<div><dt>Subtotal</dt><dd>' + money(order.subtotal) + '</dd></div>'
            + (num(order.discount_amount) > 0 ? '<div class="rs-totals__discount"><dt>Descuento' + (pctParts.length ? ' (' + E(pctParts.join(' + ')) + ')' : '') + '</dt><dd>−' + money(order.discount_amount) + '</dd></div>' : '')
            + '<div><dt>Envío</dt><dd>' + shippingText + '</dd></div>'
            + '<div class="rs-totals__total"><dt>Total</dt><dd>' + money(order.total) + '</dd></div>'
            + '</dl>'
            + (order.status === 'received' && order.receive_result ? '<h3 class="rs-subtitle">Recepción</h3>' + receiveResultHtml(order.receive_result, kit) : '')
            + (eventRows ? '<h3 class="rs-subtitle">Historial</h3><ol class="rs-timeline">' + eventRows + '</ol>' : '')
            + '</div>';
    }

    function receiveFormHtml(order, kit, itemNames) {
        const E = kit.escapeHtml, A = kit.escapeAttr;
        const names = itemNames instanceof Map ? itemNames : new Map();
        const items = Array.isArray(order.supply_order_items) ? order.supply_order_items : [];
        const rows = items.map((it, i) => {
            const q = num(it.quantity) || 0;
            const pack = num(it.pack_size);
            const target = it.inventory_item_id && names.get(it.inventory_item_id)
                ? 'Repone: ' + names.get(it.inventory_item_id)
                : 'Se busca por producto o SKU, o se crea un ítem nuevo';
            const fieldId = 'rs-receive-' + i;
            return '<div class="rs-receive__row">'
                + '<div class="rs-receive__product"><strong>' + E(it.product_name || 'Producto') + '</strong>'
                + '<small>' + E('Pedido: ' + unitText(kit, q, it.unit_label) + (pack ? ' · ' + kit.fmtNumber(pack) + ' por ' + (it.unit_label || 'pack') : '')) + '</small>'
                + '<small>' + E(target) + '</small></div>'
                + '<div class="sk-field rs-receive__qty"><label for="' + A(fieldId) + '">Recibido</label>'
                + '<input id="' + A(fieldId) + '" type="number" inputmode="decimal" min="0" max="' + A(q) + '" step="any" value="' + A(q) + '" data-rs-receive="' + A(it.id) + '"></div>'
                + '</div>';
        }).join('');
        return '<div class="rs-receive">'
            + '<p class="sk-overlay__text">Cargá lo que llegó de cada producto. Lo recibido suma stock al inventario (por las unidades de cada pack) y el gasto se registra en Finanzas. Lo que falte queda como faltante.</p>'
            + '<div class="rs-receive__fill"><button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-fill="all">Llegó todo</button>'
            + '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-fill="none">Poner todo en 0</button></div>'
            + '<div class="rs-receive__rows">' + rows + '</div>'
            + '</div>';
    }

    // -------------------------------------------------------------
    // Controlador: estado del carrito + acciones con el servidor (sin DOM)
    // -------------------------------------------------------------
    function isSent(res) { return !!(res && res.ok && res.sent !== false); }

    function createController(ctx, deps) {
        const d = deps || {};
        const kit = d.kit || ctx.kit;
        const storage = d.storage || null;
        const D = ctx.data || {};
        const key = STORAGE_PREFIX + (ctx.studioId || 'sin-estudio');
        let state = loadCartState(storage, key);
        const supplies = () => {
            if (!D.Supplies) throw new Error(MIGRATION_MESSAGE);
            return D.Supplies;
        };
        const persist = () => saveCartState(storage, key, state);
        const notify = (kind, orderId) => (orderId
            ? Promise.resolve(kit.postNotify(NOTIFY_PATH, { kind, order_id: orderId }, ctx.client)).catch(() => null)
            : Promise.resolve(null));

        return {
            get state() { return state; },
            storageKey: key,
            persist,
            reload() { state = loadCartState(storage, key); return state; },
            setLocation(id) {
                state.locationId = cleanId(id);
                persist();
            },
            // Sedes vigentes: los carritos con una sede que ya no existe quedan
            // con la elegida arriba (o null).
            reconcileLocations(ids, fallbackId) {
                const valid = new Set((ids || []).map(cleanId).filter(Boolean));
                if (!valid.has(state.locationId)) state.locationId = valid.has(cleanId(fallbackId)) ? cleanId(fallbackId) : null;
                Object.keys(state.carts).forEach(vid => {
                    const cart = state.carts[vid];
                    if (cart.locationId && !valid.has(cart.locationId)) cart.locationId = state.locationId;
                    if (!cart.locationId && valid.size) cart.locationId = state.locationId;
                });
                persist();
            },
            add(product, opts) {
                const result = addToCart(state, product, opts);
                persist();
                return result;
            },
            cart(vendorId) { return state.carts[vendorId] || null; },
            updateLine(vendorId, productId, patch) {
                const cart = state.carts[vendorId];
                const line = cart && cart.lines.find(l => l.product_id === productId);
                if (!line) return null;
                if (Object.prototype.hasOwnProperty.call(patch, 'quantity')) {
                    const q = num(patch.quantity);
                    line.quantity = q != null ? round2(q) : null;
                }
                if (Object.prototype.hasOwnProperty.call(patch, 'inventory_item_id')) line.inventory_item_id = cleanId(patch.inventory_item_id);
                cart.updatedAt = Date.now();
                persist();
                return line;
            },
            removeLine(vendorId, productId) {
                const cart = state.carts[vendorId];
                if (!cart) return;
                cart.lines = cart.lines.filter(l => l.product_id !== productId);
                if (!cart.lines.length) delete state.carts[vendorId];
                persist();
            },
            clearCart(vendorId) {
                delete state.carts[vendorId];
                persist();
            },
            setCartField(vendorId, field, value) {
                const cart = state.carts[vendorId];
                if (!cart) return;
                if (field === 'locationId') cart.locationId = cleanId(value);
                else if (field === 'notes') cart.notes = cleanNotes(value);
                persist();
            },
            refreshCart(vendorId, products, vendorRow) {
                const cart = state.carts[vendorId];
                if (!cart) return null;
                refreshCartFromCatalog(cart, products, vendorRow);
                persist();
                return cart;
            },
            // Envía el carrito del proveedor (el servidor recalcula y valida) y
            // avisa al dueño del vendor. El aviso nunca revierte el pedido.
            async submit(vendorId) {
                const cart = state.carts[vendorId];
                if (!cart) throw new Error('Ese carrito ya no existe.');
                const items = orderItemsPayload(cart);
                if (!items.length) throw new Error('Agregá al menos un producto al pedido.');
                const res = await supplies().submitOrder({
                    studioId: ctx.studioId,
                    vendorId,
                    locationId: cart.locationId || null,
                    items,
                    notes: String(cart.notes || '').trim() || null
                });
                const order = kit.unwrap(res) || {};
                const orderId = orderIdFrom(order);
                delete state.carts[vendorId];
                persist();
                const notice = await notify('order_submitted', orderId);
                return { order, orderId, notified: isSent(notice), notice };
            },
            async cancel(orderId, note) {
                const res = await supplies().cancelOrder(orderId, String(note || '').trim() || null);
                const order = kit.unwrap(res);
                const notice = await notify('order_cancelled', orderId);
                return { order, notified: isSent(notice), notice };
            },
            async receive(orderId, lines) {
                const res = await supplies().receiveOrder(orderId, lines);
                const result = kit.unwrap(res) || {};
                const notice = await notify('order_received', orderId);
                return { result, notified: isSent(notice), notice };
            }
        };
    }

    const api = {
        TAB, VIEWS, STORAGE_PREFIX, NOTIFY_PATH, MAX_LINES, CANCELLABLE, RECEIVABLE, ORDER_FILTERS,
        needsRestock, restockSuggestions, suggestQuantity,
        normalizeCountry, locationCountry, shipsTo, shipsToList, filterCatalogByShipping, countryName,
        sanitizeCartState, loadCartState, saveCartState, addToCart, cartLineCount, refreshCartFromCatalog,
        orderItemsPayload, lineIssuesFor, cartSummary, nextTier, effectiveTierPct,
        orderIdFrom, canCancel, canReceive, hasUpdatedTotal, updatedTotalNotice, filterOrders, parseShowParams,
        receiveLinesPayload, summarizeReceiveResult,
        catalogCardHtml, cartHtml, cartSummaryHtml, orderDetailHtml, receiveFormHtml, receiveResultHtml,
        createController
    };
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (!W) return;

    // =============================================================
    // UI (navegador)
    // =============================================================
    function sessionStore() {
        try {
            const s = W.sessionStorage;
            if (!s) return null;
            const probe = '__rs_probe__';
            s.setItem(probe, '1');
            s.removeItem(probe);
            return s;
        } catch (_) {
            return null;
        }
    }
    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    function createRestockUi(root, ctx) {
        const kit = ctx.kit || W.WeOtziStudioKit;
        if (!kit) throw new Error('Falta el kit del panel (studio-admin-kit.js).');
        const D = ctx.data || W.WeotziData || {};
        const E = kit.escapeHtml, A = kit.escapeAttr;
        const controller = createController(ctx, { kit, storage: sessionStore() });
        const studio = ctx.studio || {};
        const ui = {
            view: 'sugerencias',
            locations: [],
            items: [], itemsError: null, itemsLegacy: false, itemsLoaded: false, itemsStale: false,
            vendors: [], vendorsById: new Map(), suppliesUnavailable: !D.Supplies, vendorsError: null,
            orders: [], ordersError: null, ordersLoaded: false, orderFilter: 'active',
            catalog: { search: '', category: '', vendorId: '', linkItemId: null, raw: [], products: [], hidden: 0, loading: false, error: null, loaded: false, token: 0 },
            productsById: new Map(),
            vendorCatalog: new Map(),   // vendorId → {at, products: Map}
            tiers: new Map(),           // vendorId → {at, rows}
            cartMeta: new Map(),        // vendorId → {loading, refreshError}
            loadedAt: 0,
            drawer: null
        };

        // ---------- datos ----------
        async function loadLocations() {
            const S = D.StudioLocations;
            if (!S || typeof S.listActiveByStudio !== 'function') { ui.locations = []; return; }
            const res = await settle(() => S.listActiveByStudio(ctx.studioId, 'id, label, city, country, country_code, formatted_address, is_primary'));
            ui.locations = res.error ? [] : (res.data || []).filter(l => cleanId(l.id));
        }
        async function loadItems() {
            const ops = D.StudioOps;
            if (!ops || typeof ops.listRestockCandidates !== 'function') { ui.items = []; ui.itemsLoaded = true; return; }
            const res = await settle(() => ops.listRestockCandidates(ctx.studioId));
            ui.itemsLoaded = true;
            ui.itemsStale = false;
            if (res.error) {
                ui.itemsError = kit.isMissingSchema(res.error) ? null : res.error;
                ui.items = [];
                return;
            }
            ui.itemsError = null;
            ui.itemsLegacy = !!res.legacy;
            ui.items = (res.data || []).filter(i => cleanId(i.id));
        }
        async function loadVendors() {
            if (!D.Supplies || typeof D.Supplies.listVendors !== 'function') { ui.suppliesUnavailable = true; return; }
            const res = await settle(() => D.Supplies.listVendors());
            if (res.unavailable || (res.error && kit.isMissingSchema(res.error))) { ui.suppliesUnavailable = true; ui.vendors = []; }
            else if (res.error) { ui.vendorsError = res.error; ui.vendors = []; }
            else { ui.suppliesUnavailable = false; ui.vendorsError = null; ui.vendors = res.data || []; }
            ui.vendorsById = new Map(ui.vendors.map(v => [v.id, v]));
        }
        async function loadOrders() {
            if (!D.Supplies || typeof D.Supplies.listOrdersForStudio !== 'function') { ui.orders = []; ui.ordersLoaded = true; return; }
            const res = await settle(() => D.Supplies.listOrdersForStudio(ctx.studioId));
            ui.ordersLoaded = true;
            if (res.unavailable || (res.error && kit.isMissingSchema(res.error))) { ui.suppliesUnavailable = true; ui.orders = []; ui.ordersError = null; }
            else if (res.error) { ui.ordersError = res.error; }
            else { ui.ordersError = null; ui.orders = res.data || []; }
            updateBadge();
        }
        function updateBadge() {
            const n = ui.orders.filter(o => RECEIVABLE.includes(o.status)).length;
            if (typeof ctx.setBadge === 'function') ctx.setBadge(TAB, n);
        }
        async function vendorProducts(vendorId, force) {
            const cached = ui.vendorCatalog.get(vendorId);
            if (cached && !force && Date.now() - cached.at < CATALOG_TTL_MS) return cached;
            const res = await settle(() => D.Supplies.searchCatalog({ vendorId }));
            if (res.error) throw res.error;
            const products = new Map();
            (res.data || []).forEach(p => { if (cleanId(p.id)) { products.set(p.id, p); ui.productsById.set(p.id, p); } });
            const entry = { at: Date.now(), products, unavailable: !!res.unavailable };
            ui.vendorCatalog.set(vendorId, entry);
            return entry;
        }
        async function vendorTiers(vendorId) {
            const cached = ui.tiers.get(vendorId);
            if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.rows;
            const res = await settle(() => D.Supplies.listTiers(vendorId));
            const rows = res.error ? [] : (res.data || []);
            ui.tiers.set(vendorId, { at: Date.now(), rows });
            return rows;
        }
        function itemNameMap() {
            return new Map(ui.items.map(i => [i.id, i.name || 'Ítem']));
        }
        function defaultLocationId() {
            const primary = ui.locations.find(l => l.is_primary);
            return (primary || ui.locations[0] || {}).id || null;
        }
        function locationById(id) { return ui.locations.find(l => l.id === id) || null; }
        function countryFor(locationId) {
            if (!ui.locations.length) return locationCountry(null, studio);
            const loc = locationById(locationId);
            return loc ? locationCountry(loc, studio) : null;
        }
        function locationLabel(l) {
            const where = [l.city, countryName(locationCountry(l, studio))].filter(Boolean).join(', ');
            return (l.label || 'Sede') + (where ? ' · ' + where : '');
        }
        function summarize(cart) {
            const tiersEntry = ui.tiers.get(cart.vendorId);
            return cartSummary(cart, {
                kit,
                estimate: D.Supplies && D.Supplies.estimateOrder,
                tiers: tiersEntry ? tiersEntry.rows : [],
                country: countryFor(cart.locationId),
                locationMissing: ui.locations.length > 0 && !locationById(cart.locationId)
            });
        }
        // Avisa en el momento si el proveedor no envía a la sede del carrito
        // (el carrito igual lo bloquea al enviar).
        function warnShipping(cart) {
            if (!cart || (ui.locations.length && !locationById(cart.locationId))) return;
            const country = countryFor(cart.locationId);
            if (shipsTo(cart.vendor, country)) return;
            kit.toast((cart.vendor.name || 'El proveedor') + ' no envía a '
                + (normalizeCountry(country) ? countryName(country) : 'la sede elegida') + '. Revisá la sede de entrega en el carrito.', 'warning');
        }
        // Vuelve a pintar sin perder el foco ni el cursor del campo que se
        // estaba editando (los campos del carrito tienen ids estables).
        function keepFocus(paint) {
            const doc = W.document;
            const active = doc && doc.activeElement;
            const id = active && active.id && root.contains(active) ? active.id : null;
            let start = null;
            let end = null;
            try { if (id && typeof active.selectionStart === 'number') { start = active.selectionStart; end = active.selectionEnd; } } catch (_) { /* number input */ }
            paint();
            if (!id || typeof doc.getElementById !== 'function') return;
            const next = doc.getElementById(id);
            if (!next || next === active || !root.contains(next) || typeof next.focus !== 'function') return;
            next.focus();
            try { if (start != null && typeof next.setSelectionRange === 'function') next.setSelectionRange(start, end); } catch (_) { /* number input */ }
        }
        function announce(type, detail) {
            try {
                const doc = W.document;
                if (doc && typeof doc.dispatchEvent === 'function' && typeof W.CustomEvent === 'function') {
                    doc.dispatchEvent(new W.CustomEvent(type, { detail }));
                }
            } catch (_) { /* el aviso es opcional */ }
        }
        // Inventario o Materiales cambiaron el stock: las sugerencias se
        // recargan en la próxima visita a la pestaña.
        function onInventoryChanged(event) {
            const detail = event && event.detail;
            if (detail && detail.source === 'restock') return;
            ui.itemsStale = true;
        }
        function cartQtyFor(productId) {
            const product = ui.productsById.get(productId);
            const vid = product && (product.vendor_id || (product.supply_vendors && product.supply_vendors.id));
            const cart = vid ? controller.cart(vid) : null;
            const line = cart && cart.lines.find(l => l.product_id === productId);
            return line ? num(line.quantity) : null;
        }

        // Primero lo que espera una acción: pedidos por recibir, sugerencias,
        // carritos armados; si no hay nada, el catálogo.
        function initialView() {
            if (ui.suppliesUnavailable) return 'sugerencias';
            if (ui.orders.some(o => RECEIVABLE.includes(o.status))) return 'pedidos';
            if (restockSuggestions(ui.items).length) return 'sugerencias';
            if (cartLineCount(controller.state)) return 'carrito';
            return 'catalogo';
        }

        async function reloadAll() {
            await Promise.all([loadLocations(), loadItems(), loadVendors(), loadOrders()]);
            controller.reconcileLocations(ui.locations.map(l => l.id), controller.state.locationId || defaultLocationId());
            if (!controller.state.locationId) controller.setLocation(defaultLocationId());
            ui.loadedAt = Date.now();
        }

        // ---------- shell del módulo ----------
        function renderFrame() {
            root.innerHTML = '<div class="rs-module">'
                + '<div class="rs-head">'
                + '<p class="studio-help rs-head__intro">Pedí insumos a proveedores verificados por We Ötzi, con su descuento. Armamos un pedido por proveedor; al recibirlo, el inventario se repone y el gasto queda en Finanzas.</p>'
                + '<div class="rs-head__location" data-rs-region="location"></div>'
                + '</div>'
                + '<div class="sk-subtabs rs-tabs" role="group" aria-label="Secciones de reposición" data-rs-region="tabs"></div>'
                + '<div data-rs-region="banner"></div>'
                + '<div class="rs-view" data-rs-region="view"></div>'
                + '</div>';
            root.addEventListener('click', onRootClick);
            root.addEventListener('input', onRootInput);
            root.addEventListener('change', onRootChange);
        }
        function region(name) { return root.querySelector('[data-rs-region="' + name + '"]'); }

        function renderLocation() {
            const host = region('location');
            if (!host) return;
            if (!ui.locations.length) {
                host.innerHTML = '<p class="studio-help">Sin sedes cargadas: los pedidos se entregan en la dirección del estudio.</p>';
                return;
            }
            const selected = controller.state.locationId;
            host.innerHTML = '<div class="sk-field"><label for="rs-global-location">Sede de entrega</label>'
                + '<select id="rs-global-location" data-rs-global-location>'
                + ui.locations.map(l => '<option value="' + A(l.id) + '"' + (l.id === selected ? ' selected' : '') + '>' + E(locationLabel(l)) + '</option>').join('')
                + '</select></div>';
        }
        function renderTabs() {
            const host = region('tabs');
            if (!host) return;
            const counts = {
                sugerencias: restockSuggestions(ui.items).length,
                carrito: cartLineCount(controller.state),
                pedidos: ui.orders.filter(o => RECEIVABLE.includes(o.status)).length
            };
            host.innerHTML = VIEWS.map(view => '<button type="button" class="sk-subtab" data-rs-action="view" data-view="' + view + '" aria-pressed="' + (ui.view === view ? 'true' : 'false') + '">'
                + E(VIEW_LABELS[view]) + (counts[view] ? ' <span class="sk-chip-count">(' + E(counts[view]) + ')</span>' : '') + '</button>').join('');
        }
        function renderBanner() {
            const host = region('banner');
            if (!host) return;
            host.innerHTML = ui.suppliesUnavailable
                ? '<p class="studio-status studio-status-info rs-banner" role="status">' + E(MIGRATION_MESSAGE) + '</p>'
                : '';
        }
        function setView(view) {
            if (!VIEWS.includes(view)) return;
            ui.view = view;
            renderTabs();
            renderView();
        }
        function renderView() {
            const host = region('view');
            if (!host) return;
            if (ui.view === 'catalogo') renderCatalog(host);
            else if (ui.view === 'carrito') renderCarts(host);
            else if (ui.view === 'pedidos') renderOrders(host);
            else renderSuggestions(host);
        }
        function refreshAllRegions() {
            renderLocation();
            renderTabs();
            renderBanner();
            renderView();
        }

        // ---------- Sugerencias ----------
        function renderSuggestions(host) {
            if (ui.itemsError) {
                host.innerHTML = '<p class="studio-status studio-status-error" role="alert">' + E(kit.friendlyError(ui.itemsError)) + '</p>';
                return;
            }
            const rows = restockSuggestions(ui.items);
            if (!rows.length) {
                host.innerHTML = kit.emptyState({
                    icon: 'fa-solid fa-circle-check',
                    title: 'Todo en orden',
                    body: ui.items.length
                        ? 'Ningún ítem está por debajo de su punto de reposición. Igual podés pedir desde el Catálogo.'
                        : 'Todavía no hay ítems con punto de reposición. Cargalo en Inventario para recibir sugerencias.',
                    actionHtml: '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-action="go-inventory">Ir a Inventario</button>'
                        + (ui.suppliesUnavailable ? '' : ' <button type="button" class="studio-btn sk-btn-sm" data-rs-action="view" data-view="catalogo">Ver catálogo</button>')
                });
                return;
            }
            const out = rows.filter(i => (num(i.quantity_on_hand) || 0) <= 0).length;
            const table = kit.renderTable({
                className: 'rs-suggestions',
                rows,
                columns: [
                    {
                        label: 'Ítem',
                        render: i => '<strong>' + E(i.name || 'Ítem') + '</strong><small>' + [i.sku ? 'SKU ' + i.sku : null, i.studio_suppliers && i.studio_suppliers.name ? 'Proveedor: ' + i.studio_suppliers.name : null].filter(Boolean).map(E).join(' · ') + '</small>'
                    },
                    {
                        label: 'Stock', align: 'right',
                        render: i => {
                            const onHand = num(i.quantity_on_hand) || 0;
                            return '<span class="' + (onHand <= 0 ? 'rs-stock is-empty' : 'rs-stock') + '">' + E(unitText(kit, onHand, i.unit)) + '</span>'
                                + '<small>Reponer en ' + E(kit.fmtNumber(i.reorder_level)) + '</small>';
                        }
                    },
                    {
                        label: 'Producto Supplies',
                        render: i => {
                            const p = i.supply_products;
                            if (!p) return '<span class="sk-muted">' + E(ui.itemsLegacy ? 'Vínculo no disponible' : 'Sin vincular') + '</span>';
                            const vendor = ui.vendorsById.get(p.vendor_id);
                            return E(p.name || 'Producto') + '<small>' + E([vendor ? vendor.name : 'Proveedor no disponible', kit.fmtMoney(p.price, p.currency) + ' / ' + (p.unit_label || 'unidad')].join(' · ')) + '</small>';
                        }
                    },
                    {
                        label: 'Sugerido', align: 'right',
                        render: i => {
                            const p = i.supply_products;
                            const qty = suggestQuantity(i, p);
                            return E(unitText(kit, qty, p ? p.unit_label : i.unit));
                        }
                    },
                    {
                        label: '',
                        render: i => {
                            const p = i.supply_products;
                            const available = p && !ui.suppliesUnavailable && ui.vendorsById.has(p.vendor_id);
                            if (available) return '<button type="button" class="studio-btn studio-btn-primary" data-rs-action="suggest-add" data-item="' + A(i.id) + '">Agregar al carrito</button>';
                            return ui.suppliesUnavailable ? '' : '<button type="button" class="studio-btn studio-btn-ghost" data-rs-action="suggest-search" data-item="' + A(i.id) + '">Buscar en el catálogo</button>';
                        }
                    }
                ]
            });
            host.innerHTML = kit.kpis([
                { label: 'Para reponer', value: String(rows.length), tone: 'warning' },
                { label: 'Sin stock', value: String(out), tone: out ? 'danger' : null }
            ])
                + '<p class="studio-help rs-hint">Sugerimos reponer hasta el doble del punto de reposición, en packs del proveedor y respetando su mínimo. Podés ajustar la cantidad en el carrito.</p>'
                + table;
        }
        async function addFromSuggestion(itemId, btn) {
            const item = ui.items.find(i => i.id === itemId);
            const link = item && item.supply_products;
            if (!item || !link) return;
            await kit.guarded(btn, async () => {
                const entry = await vendorProducts(link.vendor_id);
                const product = entry.products.get(link.id);
                if (!product) throw new Error('Este producto ya no está disponible en el catálogo del proveedor. Buscá una alternativa en el Catálogo.');
                const qty = suggestQuantity(item, product);
                const { cart, merged } = controller.add(product, { quantity: qty, inventoryItemId: item.id, locationId: controller.state.locationId });
                kit.toast((merged ? 'Sumamos ' : 'Agregamos ') + unitText(kit, qty, product.unit_label) + ' de ' + (product.name || 'producto') + ' al carrito de ' + (cart.vendor.name || 'el proveedor') + '.', 'success');
                warnShipping(cart);
                renderTabs();
            });
        }
        function searchForItem(itemId) {
            const item = ui.items.find(i => i.id === itemId);
            if (!item) return;
            ui.catalog.search = String(item.name || '').slice(0, 80);
            ui.catalog.linkItemId = item.id;
            ui.catalog.loaded = false;
            setView('catalogo');
        }

        // ---------- Catálogo ----------
        function renderCatalog(host) {
            if (ui.suppliesUnavailable) {
                host.innerHTML = kit.emptyState({ title: 'Catálogo no disponible', body: MIGRATION_MESSAGE });
                return;
            }
            if (ui.vendorsError) {
                host.innerHTML = '<p class="studio-status studio-status-error" role="alert">' + E(kit.friendlyError(ui.vendorsError)) + '</p>';
                return;
            }
            if (!ui.vendors.length) {
                host.innerHTML = kit.emptyState({
                    icon: 'fa-solid fa-store',
                    title: 'Todavía no hay proveedores verificados',
                    body: 'Cuando se sumen tiendas de insumos a We Ötzi vas a ver su catálogo acá. Mientras tanto, registrá tus compras en Inventario.'
                });
                return;
            }
            const c = ui.catalog;
            host.innerHTML = '<div class="sk-toolbar rs-catalog__toolbar">'
                + '<div class="sk-field rs-catalog__search"><label for="rs-catalog-search">Buscar</label><input id="rs-catalog-search" type="search" placeholder="Producto, marca o SKU" autocomplete="off" maxlength="80" value="' + A(c.search) + '" data-rs-catalog="search"></div>'
                + '<div class="sk-field"><label for="rs-catalog-category">Categoría</label><select id="rs-catalog-category" data-rs-catalog="category">' + kit.optionsHtml('supplyCategory', c.category, { empty: 'Todas las categorías' }) + '</select></div>'
                + '<div class="sk-field"><label for="rs-catalog-vendor">Proveedor</label><select id="rs-catalog-vendor" data-rs-catalog="vendor"><option value="">Todos los proveedores</option>'
                + ui.vendors.map(v => '<option value="' + A(v.id) + '"' + (v.id === c.vendorId ? ' selected' : '') + '>' + E(v.name || 'Proveedor') + '</option>').join('') + '</select></div>'
                + '</div>'
                + '<div data-rs-region="link-banner"></div>'
                + '<div data-rs-region="catalog-results" aria-live="polite"></div>';
            renderLinkBanner();
            if (!c.loaded && !c.loading) loadCatalog();
            else renderCatalogResults();
        }
        function renderLinkBanner() {
            const host = region('link-banner');
            if (!host) return;
            const item = ui.catalog.linkItemId ? ui.items.find(i => i.id === ui.catalog.linkItemId) : null;
            host.innerHTML = item
                ? '<p class="studio-status studio-status-info rs-link-banner">Buscando para <strong>' + E(item.name || 'el ítem') + '</strong>: lo que agregues queda vinculado a ese ítem de inventario. '
                    + '<button type="button" class="rs-link-banner__clear" data-rs-action="clear-link">Quitar vínculo</button></p>'
                : '';
        }
        async function loadCatalog() {
            const c = ui.catalog;
            const token = ++c.token;
            c.loading = true;
            c.error = null;
            renderCatalogResults();
            const res = await settle(() => D.Supplies.searchCatalog({ search: c.search, category: c.category || null, vendorId: c.vendorId || null, limit: CATALOG_LIMIT }));
            if (token !== c.token) return;
            c.loading = false;
            c.loaded = true;
            if (res.unavailable) {
                ui.suppliesUnavailable = true;
                renderBanner();
                renderView();
                return;
            }
            if (res.error) {
                c.error = res.error;
                c.raw = [];
            } else {
                c.raw = (res.data || []).filter(p => cleanId(p.id));
                c.raw.forEach(p => ui.productsById.set(p.id, p));
            }
            applyShippingFilter();
            renderCatalogResults();
        }
        function applyShippingFilter() {
            const split = filterCatalogByShipping(ui.catalog.raw, countryFor(controller.state.locationId));
            ui.catalog.products = split.visible;
            ui.catalog.hidden = split.hidden.length;
        }
        function renderCatalogResults() {
            const host = region('catalog-results');
            if (!host) return;
            const c = ui.catalog;
            if (c.loading) { host.innerHTML = '<p class="studio-help">Buscando productos…</p>'; return; }
            if (c.error) { host.innerHTML = '<p class="studio-status studio-status-error" role="alert">' + E(kit.friendlyError(c.error)) + '</p>'; return; }
            const country = countryFor(controller.state.locationId);
            const hiddenNote = c.hidden
                ? '<p class="studio-help rs-hidden-note">' + E(c.hidden + ' ' + plural(c.hidden, 'producto oculto', 'productos ocultos') + ' porque su proveedor no envía '
                    + (country ? 'a ' + countryName(country) : 'a la sede elegida (no tiene país cargado)') + '.') + '</p>'
                : '';
            if (!c.products.length) {
                host.innerHTML = kit.emptyState({
                    compact: true,
                    title: 'Sin resultados',
                    body: c.search || c.category || c.vendorId ? 'Probá con otra búsqueda o sacá algún filtro.' : 'Los proveedores todavía no cargaron productos.'
                }) + hiddenNote;
                return;
            }
            host.innerHTML = '<div class="rs-grid">' + c.products.map(p => catalogCardHtml(p, kit, { inCartQty: cartQtyFor(p.id) })).join('') + '</div>'
                + hiddenNote
                + (c.raw.length >= CATALOG_LIMIT ? '<p class="studio-help">Mostramos los primeros ' + CATALOG_LIMIT + ' resultados: afiná la búsqueda para ver más.</p>' : '');
        }
        const debouncedCatalog = kit.debounce(() => { ui.catalog.loaded = false; loadCatalog(); }, 350);
        function addFromCatalog(btn) {
            const productId = btn.getAttribute('data-product');
            const product = ui.productsById.get(productId);
            const card = btn.closest('[data-rs-product]');
            const input = card && card.querySelector('[data-rs-qty]');
            if (!product) return;
            try {
                const qty = num(input && input.value);
                const linkId = ui.catalog.linkItemId || (ui.items.find(i => i.supply_product_id === productId) || {}).id || null;
                const { cart, line, merged } = controller.add(product, { quantity: qty, inventoryItemId: linkId, locationId: controller.state.locationId });
                kit.toast((merged ? 'Sumamos ' : 'Agregamos ') + unitText(kit, qty, product.unit_label) + ' de ' + (product.name || 'producto') + ' al carrito de ' + (cart.vendor.name || 'el proveedor') + '.', 'success');
                if (ui.catalog.linkItemId) { ui.catalog.linkItemId = null; renderLinkBanner(); }
                const incart = card && card.querySelector('[data-rs-incart]');
                if (incart) {
                    incart.textContent = 'En el carrito: ' + unitText(kit, line.quantity, line.unit_label);
                    incart.hidden = false;
                }
                renderTabs();
            } catch (err) {
                kit.toast(kit.friendlyError(err), 'warning');
                if (input && typeof input.focus === 'function') input.focus();
            }
        }

        // ---------- Carrito ----------
        function sortedCarts() {
            const carts = controller.state.carts;
            return Object.keys(carts).map(id => carts[id]).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        }
        function renderCarts(host) {
            if (ui.suppliesUnavailable) {
                host.innerHTML = kit.emptyState({ title: 'Carrito no disponible', body: MIGRATION_MESSAGE });
                return;
            }
            const carts = sortedCarts();
            if (!carts.length) {
                host.innerHTML = kit.emptyState({
                    icon: 'fa-solid fa-cart-shopping',
                    title: 'Tu carrito está vacío',
                    body: 'Agregá productos desde Sugerencias o el Catálogo. Armamos un pedido por proveedor.',
                    actionHtml: '<button type="button" class="studio-btn sk-btn-sm" data-rs-action="view" data-view="catalogo">Ver catálogo</button>'
                });
                return;
            }
            host.innerHTML = '<p class="studio-help rs-hint">Cada proveedor recibe su propio pedido. Vinculá cada línea a un ítem de inventario para que la recepción reponga ese ítem.</p>'
                + carts.map(cart => cartHtml(cart, summarize(cart), kit, {
                    items: ui.items, locations: ui.locations, locationLabel, meta: ui.cartMeta.get(cart.vendorId)
                })).join('');
            revalidateCarts(carts.map(c => c.vendorId));
        }
        // Precios, mínimos y stock vigentes + tiers, una vez por minuto.
        async function revalidateCarts(vendorIds) {
            // Una vez por minuto por proveedor, también si falló (sin reintentos en loop).
            const pending = vendorIds.filter(vid => {
                const meta = ui.cartMeta.get(vid);
                if (meta && meta.loading) return false;
                return !(meta && meta.checkedAt && Date.now() - meta.checkedAt < CATALOG_TTL_MS);
            });
            if (!pending.length) return;
            pending.forEach(vid => ui.cartMeta.set(vid, { loading: true }));
            await Promise.all(pending.map(async vid => {
                let refreshError = null;
                try {
                    const [entry] = await Promise.all([vendorProducts(vid, true), vendorTiers(vid)]);
                    controller.refreshCart(vid, entry.products, ui.vendorsById.get(vid));
                } catch (err) {
                    refreshError = err;
                }
                ui.cartMeta.set(vid, { loading: false, checkedAt: Date.now(), refreshError });
            }));
            if (ui.view === 'carrito') {
                const host = region('view');
                if (host) keepFocus(() => renderCarts(host));
            }
        }
        function cartContext(el) {
            const section = el.closest('[data-rs-cart]');
            if (!section) return null;
            const vendorId = section.getAttribute('data-rs-cart');
            const lineEl = el.closest('[data-rs-line]');
            return { section, vendorId, lineEl, productId: lineEl ? lineEl.getAttribute('data-rs-line') : null, cart: controller.cart(vendorId) };
        }
        // Repinta solo totales, avisos y la línea tocada (sin perder el foco).
        function refreshCartSummary(c) {
            const cart = controller.cart(c.vendorId);
            if (!cart) { renderView(); renderTabs(); return; }
            const summary = summarize(cart);
            const box = c.section.querySelector('[data-rs-cart-summary]');
            if (box) box.innerHTML = cartSummaryHtml(summary, kit);
            const submit = c.section.querySelector('[data-rs-action="submit"]');
            if (submit) {
                submit.disabled = !summary.canSubmit;
                if (summary.canSubmit) submit.removeAttribute('aria-disabled'); else submit.setAttribute('aria-disabled', 'true');
            }
            c.section.querySelectorAll('[data-rs-line]').forEach(lineEl => {
                const pid = lineEl.getAttribute('data-rs-line');
                const line = cart.lines.find(l => l.product_id === pid);
                if (!line) return;
                const issues = summary.lineIssues[pid] || [];
                const issueEl = lineEl.querySelector('[data-rs-line-issue]');
                if (issueEl) { issueEl.textContent = issues.join(' '); issueEl.hidden = !issues.length; }
                lineEl.classList.toggle('has-issue', issues.length > 0);
                const est = summary.estimate ? (summary.estimate.lines || []).find(l => l.product_id === pid) : null;
                const totalEl = lineEl.querySelector('[data-rs-line-total]');
                if (totalEl) totalEl.textContent = est && est.valid ? kit.fmtMoney(est.line_subtotal, summary.currency) : '—';
                const hint = lineEl.querySelector('[data-rs-line-hint]');
                if (hint) {
                    const linked = line.inventory_item_id ? ui.items.find(i => i.id === line.inventory_item_id) : null;
                    const mismatch = linked && linked.currency && summary.currency && cleanCurrency(linked.currency) !== summary.currency;
                    hint.textContent = mismatch ? 'El ítem está en ' + linked.currency + ' y el pedido en ' + summary.currency + ': el costo no se va a cargar al recibir.' : '';
                }
            });
        }
        async function submitCart(vendorId, btn) {
            const cart = controller.cart(vendorId);
            if (!cart) return;
            const summary = summarize(cart);
            if (!summary.canSubmit) {
                kit.toast(summary.issues[0] || 'Revisá el carrito antes de enviar.', 'warning');
                return;
            }
            const count = orderItemsPayload(cart).length;
            const ok = await kit.confirmDialog({
                title: 'Enviar pedido a ' + (cart.vendor.name || 'el proveedor'),
                body: '<p class="sk-overlay__text">' + E('Vas a pedir ' + count + ' ' + plural(count, 'producto', 'productos') + ' por un total estimado de '
                    + kit.fmtMoney(summary.estimate.total, summary.currency) + '. El proveedor lo confirma y, si corresponde, suma el envío.') + '</p>',
                confirmLabel: 'Enviar pedido'
            });
            if (!ok) return;
            const target = btn && btn.isConnected !== false ? btn : null;
            await kit.guarded(target, async () => {
                const r = await controller.submit(vendorId);
                const number = r.order && r.order.order_number ? r.order.order_number + ' ' : '';
                kit.toast('Pedido ' + number + 'enviado a ' + (cart.vendor.name || 'el proveedor') + '.', 'success');
                if (!r.notified) kit.toast('El pedido quedó enviado, pero no pudimos avisarle al proveedor por email. Lo va a ver en su panel.', 'warning', { timeout: 8000 });
                ui.cartMeta.delete(vendorId);
                await loadOrders();
                ui.orderFilter = 'active';
                setView('pedidos');
            }, {
                busyLabel: 'Enviando…',
                onError: err => {
                    // Precio, stock o mínimo pudieron cambiar: la próxima vista revalida.
                    ui.vendorCatalog.delete(vendorId);
                    ui.cartMeta.delete(vendorId);
                    kit.toast(kit.friendlyError(err), 'danger');
                }
            });
        }

        // ---------- Mis pedidos ----------
        function renderOrders(host) {
            if (ui.suppliesUnavailable) {
                host.innerHTML = kit.emptyState({ title: 'Pedidos no disponibles', body: MIGRATION_MESSAGE });
                return;
            }
            if (ui.ordersError) {
                host.innerHTML = '<p class="studio-status studio-status-error" role="alert">' + E(kit.friendlyError(ui.ordersError)) + '</p>'
                    + '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-action="reload-orders">Reintentar</button>';
                return;
            }
            const all = ui.orders;
            const active = filterOrders(all, 'active');
            const toReceive = filterOrders(all, 'to_receive');
            const received = filterOrders(all, 'received');
            const rows = filterOrders(all, ui.orderFilter);
            const chips = Object.keys(ORDER_FILTERS).map(key => {
                const n = filterOrders(all, key).length;
                return '<button type="button" class="sk-chip" data-rs-action="order-filter" data-filter="' + key + '" aria-pressed="' + (ui.orderFilter === key ? 'true' : 'false') + '">'
                    + E(ORDER_FILTER_LABELS[key]) + ' <span class="sk-chip-count">' + E(n) + '</span></button>';
            }).join('');
            const table = kit.renderTable({
                className: 'rs-orders__table',
                rows,
                emptyText: all.length ? 'No hay pedidos con este filtro.' : 'Todavía no hiciste pedidos. Armá uno desde Sugerencias o el Catálogo.',
                columns: [
                    { label: 'Pedido', render: o => '<button type="button" class="rs-link" data-rs-action="open-order" data-order="' + A(o.id) + '">' + E(o.order_number || 'Pedido') + '</button><small>' + E(kit.fmtDate(o.submitted_at || o.created_at)) + '</small>' },
                    { label: 'Proveedor', render: o => E((o.supply_vendors && o.supply_vendors.name) || 'Proveedor') },
                    { label: 'Sede', render: o => (o.studio_locations ? E(o.studio_locations.label || 'Sede') : '<span class="sk-muted">Estudio</span>') },
                    {
                        label: 'Estado',
                        render: o => kit.statusBadge('supplyOrderStatus', o.status)
                            + (o.status === 'confirmed' && hasUpdatedTotal(o) ? '<small class="rs-updated">Total actualizado por el proveedor</small>' : '')
                    },
                    {
                        label: 'Total', align: 'right',
                        render: o => E(kit.fmtMoney(o.total, o.currency)) + (hasUpdatedTotal(o) ? '<small>' + E('envío ' + kit.fmtMoney(o.shipping_amount, o.currency)) + '</small>' : '')
                    },
                    {
                        label: '',
                        render: o => '<span class="sk-row-actions">'
                            + (canReceive(o) ? '<button type="button" class="studio-btn studio-btn-primary" data-rs-action="receive-order" data-order="' + A(o.id) + '">Recibir</button>' : '')
                            + '<button type="button" class="studio-btn studio-btn-ghost" data-rs-action="open-order" data-order="' + A(o.id) + '">Ver</button></span>'
                    }
                ]
            });
            host.innerHTML = kit.kpis([
                { label: 'En curso', value: String(active.length) },
                { label: 'Por recibir', value: String(toReceive.length), tone: toReceive.length ? 'warning' : null },
                { label: 'Comprometido en curso', valueHtml: kit.fmtTotalsHtml(kit.sumByCurrency(active, 'total', 'currency')) },
                { label: 'Recibido', valueHtml: kit.fmtTotalsHtml(kit.sumByCurrency(received, 'total', 'currency')) }
            ])
                + '<div class="sk-toolbar rs-orders__toolbar"><div class="sk-chips" role="group" aria-label="Filtrar pedidos">' + chips + '</div>'
                + '<span class="sk-toolbar-spacer"></span>'
                + (all.length ? '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-rs-action="export-orders">Exportar CSV</button>' : '')
                + '</div>'
                + table;
        }
        function exportOrders() {
            const rows = filterOrders(ui.orders, ui.orderFilter);
            kit.downloadCsv('pedidos-reposicion', [
                { label: 'Pedido', key: 'order_number' },
                { label: 'Proveedor', value: o => (o.supply_vendors && o.supply_vendors.name) || '' },
                { label: 'Sede', value: o => (o.studio_locations && o.studio_locations.label) || '' },
                { label: 'Estado', value: o => kit.label('supplyOrderStatus', o.status) },
                { label: 'Fecha', value: o => kit.toDateInput(o.submitted_at || o.created_at) },
                { label: 'Moneda', key: 'currency' },
                { label: 'Subtotal', value: o => num(o.subtotal) },
                { label: 'Descuento', value: o => num(o.discount_amount) },
                { label: 'Envío', value: o => num(o.shipping_amount) },
                { label: 'Total', value: o => num(o.total) }
            ], rows);
        }

        // ---------- Drawer del pedido ----------
        function closeDrawer() {
            if (ui.drawer && ui.drawer.api) ui.drawer.api.close();
            ui.drawer = null;
        }
        async function openOrderDrawer(orderId) {
            const id = cleanId(orderId);
            if (!id || !D.Supplies) return;
            if (ui.drawer && ui.drawer.orderId === id) { await refreshDrawer(); return; }
            closeDrawer();
            const drawer = kit.openDrawer({
                title: 'Pedido',
                width: 'lg',
                className: 'rs-order-drawer',
                body: '<div class="rs-drawer" data-rs-drawer><p class="studio-help">Cargando pedido…</p></div>',
                onClose: () => { if (ui.drawer && ui.drawer.api === drawer) ui.drawer = null; }
            });
            if (!drawer || !drawer.body) return;
            ui.drawer = { api: drawer, orderId: id, order: null };
            drawer.body.addEventListener('click', onDrawerClick);
            await refreshDrawer();
        }
        async function refreshDrawer() {
            const d = ui.drawer;
            if (!d) return;
            const res = await settle(() => D.Supplies.getOrder(d.orderId));
            if (ui.drawer !== d) return;
            const host = d.api.body.querySelector('[data-rs-drawer]');
            if (!host) return;
            if (res.error || !res.data) {
                d.order = null;
                host.innerHTML = '<p class="studio-status studio-status-error" role="alert">'
                    + E(res.error ? kit.friendlyError(res.error) : 'No encontramos el pedido o no tenés acceso.') + '</p>';
                return;
            }
            d.order = res.data;
            d.api.setTitle('Pedido ' + (res.data.order_number || ''));
            host.innerHTML = orderDetailHtml(res.data, kit, { itemNames: itemNameMap() });
        }
        function onDrawerClick(event) {
            const btn = event.target && event.target.closest ? event.target.closest('[data-rs-action]') : null;
            const d = ui.drawer;
            if (!btn || !d || !d.order) return;
            const action = btn.getAttribute('data-rs-action');
            if (action === 'cancel-order') cancelOrder(d.order, btn);
            else if (action === 'receive-order') openReceive(d.order);
            else if (action === 'go-finance') { closeDrawer(); ctx.navigate('finanzas'); }
        }
        async function cancelOrder(order, btn) {
            const note = await kit.promptDialog({
                title: 'Cancelar pedido ' + (order.order_number || ''),
                body: order.status === 'confirmed'
                    ? 'El proveedor ya lo confirmó: al cancelar se le devuelve el stock reservado y recibe un aviso.'
                    : 'El proveedor recibe un aviso de la cancelación.',
                label: 'Motivo (opcional)',
                placeholder: 'Ej.: lo conseguimos en otro lado',
                multiline: true,
                maxLength: NOTES_MAX,
                confirmLabel: 'Cancelar pedido',
                cancelLabel: 'Volver',
                tone: 'danger'
            });
            if (note === null) return;
            await kit.guarded(btn && btn.isConnected !== false ? btn : null, async () => {
                const r = await controller.cancel(order.id, note);
                kit.toast('Cancelaste el pedido ' + (order.order_number || '') + '.', 'success');
                if (!r.notified) kit.toast('No pudimos avisarle al proveedor por email. Lo va a ver en su panel.', 'warning');
                await Promise.all([loadOrders(), refreshDrawer()]);
                if (ui.view === 'pedidos') renderView();
                renderTabs();
            });
        }
        async function startReceive(orderId, btn) {
            const id = cleanId(orderId);
            if (!id) return;
            await kit.guarded(btn, async () => {
                const order = kit.unwrap(await D.Supplies.getOrder(id));
                if (!order) throw new Error('No encontramos el pedido o no tenés acceso.');
                openReceive(order);
            });
        }
        function openReceive(order) {
            if (!canReceive(order)) {
                kit.toast('Este pedido ya no se puede recibir (está ' + kit.label('supplyOrderStatus', order.status).toLowerCase() + ').', 'warning');
                return;
            }
            const items = Array.isArray(order.supply_order_items) ? order.supply_order_items : [];
            let zeroConfirmed = false;  // recibir todo en 0 pide un segundo click
            const modal = kit.openModal({
                title: 'Recibir pedido ' + (order.order_number || ''),
                size: 'lg',
                className: 'rs-receive-modal',
                body: receiveFormHtml(order, kit, itemNameMap()),
                actions: [
                    { label: 'Volver', variant: 'ghost', value: null },
                    {
                        label: 'Confirmar recepción',
                        variant: 'primary',
                        onClick: async m => {
                            const inputs = Array.from(m.body.querySelectorAll('[data-rs-receive]'));
                            const values = {};
                            inputs.forEach(input => { values[input.getAttribute('data-rs-receive')] = input.value; });
                            const check = receiveLinesPayload(items, values);
                            inputs.forEach(input => {
                                if (check.errors[input.getAttribute('data-rs-receive')]) input.setAttribute('aria-invalid', 'true');
                                else input.removeAttribute('aria-invalid');
                            });
                            const firstError = Object.keys(check.errors)[0];
                            if (firstError) {
                                m.setError(check.errors[firstError]);
                                return false;
                            }
                            if (check.nothing && !zeroConfirmed) {
                                zeroConfirmed = true;
                                m.setError('No cargaste nada recibido: el pedido se cierra con todo como faltante y el proveedor recibe el aviso. Si es así, confirmá de nuevo.');
                                return false;
                            }
                            return controller.receive(order.id, check.lines);
                        }
                    }
                ]
            });
            if (!modal || !modal.body) return;
            modal.body.addEventListener('click', event => {
                const fill = event.target && event.target.closest ? event.target.closest('[data-rs-fill]') : null;
                if (!fill) return;
                const all = fill.getAttribute('data-rs-fill') === 'all';
                modal.body.querySelectorAll('[data-rs-receive]').forEach(input => {
                    input.value = all ? input.getAttribute('max') : '0';
                    input.removeAttribute('aria-invalid');
                });
                zeroConfirmed = false;
                modal.setError('');
            });
            modal.body.addEventListener('input', () => { zeroConfirmed = false; });
            modal.closed.then(async r => {
                if (!r || !r.result) return;
                if (!r.notified) kit.toast('No pudimos avisarle al proveedor por email. Lo va a ver en su panel.', 'warning');
                showReceiveResult(r.result);
                await Promise.all([loadOrders(), loadItems(), ui.drawer && ui.drawer.orderId === order.id ? refreshDrawer() : null]);
                // Inventario/Materiales repintan el stock; Finanzas/Reportes, el gasto nuevo.
                announce('weotzi:studio-inventory-changed', { source: 'restock', order_id: order.id });
                const expense = summarizeReceiveResult(r.result).expense;
                if (expense) announce('weotzi:studio-finance-changed', { source: 'restock', order_id: order.id, entry_id: expense.entry_id || null });
                renderTabs();
                if (ui.view === 'pedidos' || ui.view === 'sugerencias') renderView();
            });
        }
        function showReceiveResult(result) {
            const summary = summarizeReceiveResult(result);
            const actions = [];
            actions.push({ label: 'Ver inventario', variant: 'ghost', onClick: () => { closeDrawer(); ctx.navigate('inventory'); } });
            if (summary.expense) actions.push({ label: 'Ver en Finanzas', variant: 'ghost', onClick: () => { closeDrawer(); ctx.navigate('finanzas'); } });
            actions.push({ label: 'Listo', variant: 'primary', value: true });
            kit.openModal({
                title: summary.partial ? 'Recepción parcial' : 'Pedido recibido',
                size: 'lg',
                body: receiveResultHtml(result, kit),
                actions
            });
        }

        // ---------- eventos ----------
        function onRootClick(event) {
            const btn = event.target && event.target.closest ? event.target.closest('[data-rs-action]') : null;
            if (!btn || !root.contains(btn)) return;
            const action = btn.getAttribute('data-rs-action');
            const c = cartContext(btn);
            switch (action) {
                case 'view': setView(btn.getAttribute('data-view')); break;
                case 'suggest-add': addFromSuggestion(btn.getAttribute('data-item'), btn); break;
                case 'suggest-search': searchForItem(btn.getAttribute('data-item')); break;
                case 'add': addFromCatalog(btn); break;
                case 'clear-link': ui.catalog.linkItemId = null; renderLinkBanner(); break;
                case 'remove-line':
                    if (c && c.productId) {
                        controller.removeLine(c.vendorId, c.productId);
                        renderView();
                        renderTabs();
                    }
                    break;
                case 'clear-cart':
                    if (c && c.cart) {
                        kit.confirmDialog({
                            title: 'Vaciar carrito',
                            body: '<p class="sk-overlay__text">' + E('Se quitan los productos de ' + (c.cart.vendor.name || 'este proveedor') + '.') + '</p>',
                            confirmLabel: 'Vaciar',
                            tone: 'danger'
                        }).then(ok => {
                            if (!ok) return;
                            controller.clearCart(c.vendorId);
                            renderTabs();
                            renderView();
                        });
                    }
                    break;
                case 'submit': if (c) submitCart(c.vendorId, btn); break;
                case 'order-filter':
                    if (Object.prototype.hasOwnProperty.call(ORDER_FILTERS, btn.getAttribute('data-filter'))) {
                        ui.orderFilter = btn.getAttribute('data-filter');
                        renderView();
                    }
                    break;
                case 'open-order': openOrderDrawer(btn.getAttribute('data-order')); break;
                case 'receive-order': startReceive(btn.getAttribute('data-order'), btn); break;
                case 'export-orders': exportOrders(); break;
                case 'reload-orders': kit.guarded(btn, async () => { await loadOrders(); renderView(); }); break;
                case 'go-inventory': ctx.navigate('inventory'); break;
                default: break;
            }
        }
        function onRootInput(event) {
            const el = event.target;
            if (!el || !el.getAttribute) return;
            if (el.getAttribute('data-rs-catalog') === 'search') {
                ui.catalog.search = String(el.value || '').slice(0, 80);
                debouncedCatalog();
                return;
            }
            const field = el.getAttribute('data-rs-field');
            if (!field) return;
            const c = cartContext(el);
            if (!c || !c.cart) return;
            if (field === 'quantity' && c.productId) {
                controller.updateLine(c.vendorId, c.productId, { quantity: el.value });
                refreshCartSummary(c);
            } else if (field === 'notes') {
                controller.setCartField(c.vendorId, 'notes', el.value);
            }
        }
        function onRootChange(event) {
            const el = event.target;
            if (!el || !el.getAttribute) return;
            if (el.hasAttribute('data-rs-global-location')) {
                controller.setLocation(el.value);
                if (ui.catalog.loaded) applyShippingFilter();
                if (ui.view === 'catalogo') renderCatalogResults();
                return;
            }
            const catalogField = el.getAttribute('data-rs-catalog');
            if (catalogField === 'category' || catalogField === 'vendor') {
                if (catalogField === 'category') ui.catalog.category = String(el.value || '');
                else ui.catalog.vendorId = cleanId(el.value) || '';
                debouncedCatalog.cancel();
                ui.catalog.loaded = false;
                loadCatalog();
                return;
            }
            const field = el.getAttribute('data-rs-field');
            const c = field ? cartContext(el) : null;
            if (!c || !c.cart) return;
            if (field === 'inventory_item_id' && c.productId) {
                controller.updateLine(c.vendorId, c.productId, { inventory_item_id: el.value });
                refreshCartSummary(c);
            } else if (field === 'locationId') {
                controller.setCartField(c.vendorId, 'locationId', el.value);
                refreshCartSummary(c);
            } else if (field === 'quantity' && c.productId) {
                controller.updateLine(c.vendorId, c.productId, { quantity: el.value });
                refreshCartSummary(c);
            }
        }

        return {
            async init() {
                renderFrame();
                const doc = W.document;
                if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('weotzi:studio-inventory-changed', onInventoryChanged);
                region('view').innerHTML = '<p class="studio-help">Cargando…</p>';
                try {
                    await reloadAll();
                } catch (err) {
                    // Las lecturas ya tragan sus errores; esto es solo por las dudas.
                    if (W.console) W.console.error('[studio-restock] carga inicial', err);
                }
                ui.view = initialView();
                refreshAllRegions();
            },
            async show(params) {
                const p = parseShowParams(params);
                if (Date.now() - ui.loadedAt > RELOAD_TTL_MS) {
                    controller.reload();
                    await reloadAll();
                    refreshAllRegions();
                } else if (ui.itemsStale) {
                    await loadItems();
                    refreshAllRegions();
                }
                if (p.filter) ui.orderFilter = p.filter;
                if (p.orderId) {
                    // Si el filtro actual no muestra el pedido (p. ej. uno ya
                    // recibido, desde Finanzas), la tabla pasa a "Todos".
                    const row = ui.orders.find(o => o.id === p.orderId);
                    if (!p.filter && row && !filterOrders([row], ui.orderFilter).length) ui.orderFilter = 'all';
                    setView('pedidos');
                    await openOrderDrawer(p.orderId);
                } else if (p.view || p.filter) {
                    setView(p.view || 'pedidos');
                }
            }
        };
    }

    // -------------------------------------------------------------
    // Registro en el shell
    // -------------------------------------------------------------
    let instance = null;
    let badgeChecked = false;

    // Badge "por recibir" al iniciar, aunque la pestaña no se haya abierto.
    async function initialBadge(ctx) {
        if (badgeChecked || instance || !ctx) return;
        badgeChecked = true;
        try {
            const S = ctx.data && ctx.data.Supplies;
            if (!S || typeof S.listOrdersForStudio !== 'function') return;
            const res = await S.listOrdersForStudio(ctx.studioId, { status: RECEIVABLE });
            if (instance || !res || res.error || !Array.isArray(res.data)) return;
            ctx.setBadge(TAB, res.data.length);
        } catch (_) { /* el badge es opcional */ }
    }

    const admin = W.WeOtziStudioAdmin;
    if (!admin || typeof admin.register !== 'function') {
        if (W.console) W.console.warn('[studio-restock] falta WeOtziStudioAdmin (studio-dashboard.js debe cargarse antes).');
        return;
    }
    admin.register(TAB, {
        async mount(root, ctx) {
            instance = createRestockUi(root, ctx);
            await instance.init();
        },
        async show(root, ctx, params) {
            if (instance) await instance.show(params);
        }
    });
    if (typeof admin.getContext === 'function') {
        Promise.resolve(admin.getContext()).then(initialBadge).catch(() => {});
    }
})();
