/**
 * WE OTZI - Repositorio de Supplies (frontend)
 * --------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js)
 * para las cuentas Supplies (tiendas de insumos) y la reposicion de los
 * estudios (docs/plans/2026-10-30-estudios-plataforma.md, M5).
 *
 * Tablas: supply_vendors, supply_vendor_private, supply_products,
 * supply_discount_tiers, supply_orders, supply_order_items,
 * supply_order_events (pedidos: solo lectura, se escriben por RPC).
 * Vistas: supply_vendor_sales_monthly, supply_vendor_customers.
 * RPCs: complete_supply_vendor_registration, submit_supply_order,
 * cancel_supply_order, vendor_update_supply_order, receive_supply_order.
 *
 * Contrato: igual que studios-repo.js. Son WRAPPERS FINOS que devuelven el
 * builder o la RPC sin resolver (`{ data, error }`) y nunca lanzan. Las
 * lecturas que corren al cargar una pantalla tragan la "migracion pendiente"
 * y devuelven `{ data: [] | null, error: null, unavailable: true }`.
 *
 * `estimateOrder(vendor, tiers, lines)` es pura: calcula el estimado del
 * carrito en centavos enteros con la misma regla que submit_supply_order. El
 * servidor siempre recalcula. Se exporta tambien a Node (module.exports) para
 * los tests.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.Supplies.
 */
(function () {
    'use strict';

    // ===================== estimateOrder (pura) =====================

    // Monto decimal (numeric(12,2)) -> centavos enteros.
    function toCents(value) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.round(n * 100) : 0;
    }
    // Redondeo half-up de a/b para enteros a >= 0 y b > 0, igual a round() de
    // numeric con valores positivos. Solo aritmetica entera (exacta < 2^53).
    function divRound(a, b) {
        const n = a + Math.floor(b / 2);
        return (n - (n % b)) / b;
    }
    function fromCents(cents) {
        return cents / 100;
    }

    /**
     * Estimado de un pedido a un vendor Supplies.
     *  - line_subtotal = round(unit_price * quantity, 2); subtotal = suma.
     *  - pct = least(60, platform_discount_pct + mejor tier con
     *    min_subtotal <= subtotal) (tiers de la moneda del vendor).
     *  - discount = round(subtotal * pct / 100, 2). line_discount =
     *    round(line_subtotal * pct / 100, 2) y la diferencia de redondeo la
     *    absorbe la linea de mayor subtotal (la primera si empatan), acotada
     *    a [0, line_subtotal]; el resto pasa a la siguiente linea.
     *  - total = subtotal - discount (el envio lo suma el vendor al confirmar).
     *  - freeShipping: total >= free_shipping_threshold (si hay umbral).
     *  - belowMinimum: subtotal < min_order_amount (si hay minimo).
     * lines: [{ unit_price | price | product.price, quantity | qty, ... }].
     * Los importes vuelven en unidades de la moneda (no centavos).
     */
    function estimateOrder(vendor, tiers, lines) {
        const v = vendor || {};
        const currency = v.currency || null;
        const source = Array.isArray(lines) ? lines : [];

        const priced = source.map((line) => {
            const item = line || {};
            const price = item.unit_price != null ? item.unit_price
                : item.price != null ? item.price
                    : item.product && item.product.price != null ? item.product.price : null;
            const qty = item.quantity != null ? item.quantity : item.qty;
            const priceCents = toCents(price);
            const qtyHundredths = toCents(qty);
            const valid = price != null && priceCents >= 0 && qtyHundredths > 0;
            return { line: item, valid, subtotal: valid ? divRound(priceCents * qtyHundredths, 100) : 0 };
        });
        const subtotal = priced.reduce((sum, row) => sum + row.subtotal, 0);

        const platformPct = Math.max(0, toCents(v.platform_discount_pct));
        let tierPct = 0;
        for (const tier of Array.isArray(tiers) ? tiers : []) {
            if (!tier) continue;
            if (currency && tier.currency && tier.currency !== currency) continue;
            if (toCents(tier.min_subtotal) <= subtotal) tierPct = Math.max(tierPct, toCents(tier.discount_pct));
        }
        // pct en centesimos de punto (15.5% -> 1550), tope 60%.
        const pct = Math.min(6000, platformPct + tierPct);

        const discount = divRound(subtotal * pct, 10000);
        const lineDiscounts = priced.map((row) => divRound(row.subtotal * pct, 10000));
        // Diferencia de redondeo: como submit_supply_order, la absorbe la linea
        // de mayor subtotal (empate: orden de carga) sin pasar de 0 ni de su
        // subtotal; lo que no entra sigue por la siguiente.
        let remainder = discount - lineDiscounts.reduce((sum, value) => sum + value, 0);
        if (remainder !== 0) {
            const order = priced
                .map((row, index) => index)
                .filter((index) => priced[index].valid)
                .sort((a, b) => (priced[b].subtotal - priced[a].subtotal) || (a - b));
            for (const index of order) {
                if (remainder === 0) break;
                const adjust = Math.max(-lineDiscounts[index], Math.min(priced[index].subtotal - lineDiscounts[index], remainder));
                lineDiscounts[index] += adjust;
                remainder -= adjust;
            }
        }
        const total = subtotal - discount;

        const threshold = v.free_shipping_threshold == null || v.free_shipping_threshold === '' ? null : toCents(v.free_shipping_threshold);
        const minimum = v.min_order_amount == null || v.min_order_amount === '' ? null : toCents(v.min_order_amount);
        const freeShipping = threshold !== null && total >= threshold;
        const belowMinimum = minimum !== null && subtotal < minimum;

        return {
            currency,
            subtotal: fromCents(subtotal),
            pct: pct / 100,
            platformPct: Math.min(6000, platformPct) / 100,
            tierPct: tierPct / 100,
            discount: fromCents(discount),
            total: fromCents(total),
            freeShipping,
            freeShippingThreshold: threshold === null ? null : fromCents(threshold),
            missingForFreeShipping: threshold === null ? null : fromCents(Math.max(0, threshold - total)),
            belowMinimum,
            minimum: minimum === null ? null : fromCents(minimum),
            missingForMinimum: minimum === null ? 0 : fromCents(Math.max(0, minimum - subtotal)),
            lines: priced.map((row, index) => ({
                ...row.line,
                valid: row.valid,
                line_subtotal: fromCents(row.subtotal),
                line_discount: fromCents(row.valid ? lineDiscounts[index] : 0),
                line_total: fromCents(row.valid ? row.subtotal - lineDiscounts[index] : 0),
            })),
        };
    }

    if (typeof module !== 'undefined' && module && module.exports) {
        module.exports = { estimateOrder };
    }

    // ===================== repositorio (navegador) =====================

    const W = typeof window !== 'undefined' ? window : null;
    if (!W) return;
    const D = W.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[supplies-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;
    const client = () => D.getClient();
    const orValue = typeof D.orValue === 'function'
        ? D.orValue
        : (value) => '"' + String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

    // Codigos de "falta aplicar una migracion" (Reglas transversales §5).
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    function isMissingSchema(error) {
        if (!error) return false;
        return MISSING_SCHEMA_CODES.indexOf(String(error.code || (error.cause && error.cause.code) || '')) !== -1;
    }
    function guard(build) {
        try {
            return build();
        } catch (error) {
            return Promise.resolve({ data: null, error });
        }
    }
    function rpc(name, args) {
        return guard(() => client().rpc(name, args));
    }
    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }
    async function soft(build, empty) {
        const result = await settle(build);
        if (result.error && isMissingSchema(result.error)) return { data: empty, error: null, unavailable: true };
        return result;
    }
    async function allRows(buildQuery) {
        const rows = [];
        for (let offset = 0; ; offset += 500) {
            const result = await buildQuery().range(offset, offset + 499);
            if (result.error) return result;
            rows.push(...(result.data || []));
            if ((result.data || []).length < 500) return { data: rows, error: null };
        }
    }
    // string -> eq, array -> in, vacio -> sin filtro.
    function byValue(query, column, value) {
        if (Array.isArray(value)) return value.length ? query.in(column, value) : query;
        return value ? query.eq(column, value) : query;
    }
    function monthStart(value) {
        const text = String(value || '');
        return /^\d{4}-\d{2}/.test(text) ? `${text.slice(0, 7)}-01` : value;
    }
    function pick(obj, keys) {
        const out = {};
        for (const key of keys) {
            if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) out[key] = obj[key];
        }
        return out;
    }

    // Columnas publicas del vendor (sin user_id ni el email de login).
    const VENDOR_PUBLIC_COLS =
        'id, name, slug, description, logo_image, cover_image, contact_email, phone, whatsapp, website, instagram, ' +
        'country, city, ships_to_countries, lead_time_days, currency, min_order_amount, platform_discount_pct, ' +
        'free_shipping_threshold, benefits, is_verified, is_active';
    // Vendor embebido en el catalogo (condiciones para el carrito).
    const CATALOG_VENDOR_COLS =
        'id, name, slug, logo_image, currency, platform_discount_pct, benefits, free_shipping_threshold, ' +
        'min_order_amount, ships_to_countries, is_verified, is_active';
    // El dueno no puede cambiar is_verified, is_active, user_id, email ni slug
    // (guard private.guard_supply_vendor_write): no se envian.
    const VENDOR_EDITABLE = [
        'name', 'description', 'logo_image', 'cover_image', 'contact_email', 'phone', 'whatsapp', 'website',
        'instagram', 'country', 'city', 'ships_to_countries', 'lead_time_days', 'currency', 'min_order_amount',
        'platform_discount_pct', 'free_shipping_threshold', 'benefits', 'profile_complete',
    ];
    const PRIVATE_EDITABLE = ['legal_name', 'tax_id', 'fiscal_address', 'billing_email', 'notes'];
    const PRODUCT_EDITABLE = [
        'sku', 'name', 'brand', 'description', 'category', 'unit_label', 'pack_size', 'price', 'currency',
        'compare_at_price', 'stock_quantity', 'min_order_qty', 'image_url', 'images', 'is_active',
    ];
    const TIER_EDITABLE = ['min_subtotal', 'currency', 'discount_pct', 'label'];

    const ORDER_STUDIO_EMBED = 'studios ( id, name, slug, logo_image, city, country )';
    const ORDER_LOCATION_EMBED = 'studio_locations ( id, label, formatted_address, city, country )';
    const ORDER_VENDOR_EMBED = 'supply_vendors ( id, name, slug, logo_image, currency, contact_email, phone, whatsapp )';

    function byText(a, b) {
        return String(a || '').localeCompare(String(b || ''));
    }

    const Supplies = {
        estimateOrder,

        // --- vendors ---

        // Vendor del usuario autenticado (panel Supplies), fila completa o null.
        // Corre al cargar la sesion: sin la migracion -> null + `unavailable`.
        getVendorByUserId(uid) {
            return soft(() => from('supply_vendors').select('*').eq('user_id', uid).maybeSingle(), null);
        },

        // Vendor por id (columnas publicas por defecto). .maybeSingle().
        getVendor(id, columns = VENDOR_PUBLIC_COLS) {
            return guard(() => from('supply_vendors').select(columns).eq('id', id).maybeSingle());
        },

        // Vendor por slug (columnas publicas por defecto). .maybeSingle().
        getVendorBySlug(slug, columns = VENDOR_PUBLIC_COLS) {
            return guard(() => from('supply_vendors').select(columns).eq('slug', slug).maybeSingle());
        },

        // Vendors verificados y activos, opcionalmente por nombre.
        listVendors({ search = '' } = {}) {
            const text = String(search || '').trim();
            return soft(() => allRows(() => {
                let query = from('supply_vendors')
                    .select(VENDOR_PUBLIC_COLS)
                    .eq('is_active', true)
                    .eq('is_verified', true);
                if (text) query = query.ilike('name', `%${text}%`);
                return query.order('name').order('id');
            }), []);
        },

        // Guarda el perfil publico del vendor (solo columnas editables).
        updateVendor(id, patch) {
            return guard(() => from('supply_vendors').update(pick(patch, VENDOR_EDITABLE)).eq('id', id).select().single());
        },

        // Datos fiscales privados (dueno y soporte). .maybeSingle().
        getVendorPrivate(id) {
            return guard(() => from('supply_vendor_private').select('*').eq('vendor_id', id).maybeSingle());
        },

        // Actualiza los datos privados; si la fila no existe todavia, la crea.
        async saveVendorPrivate(id, patch) {
            const payload = pick(patch, PRIVATE_EDITABLE);
            const updated = await settle(() => from('supply_vendor_private').update(payload).eq('vendor_id', id).select().maybeSingle());
            if (updated.error || updated.data) return updated;
            return settle(() => from('supply_vendor_private').insert({ ...payload, vendor_id: id }).select().single());
        },

        // Alta idempotente de la cuenta Supplies tras confirmar el email.
        // Devuelve la fila completa de supply_vendors.
        completeRegistration(profile) {
            return rpc('complete_supply_vendor_registration', { p_profile: profile || {} });
        },

        // --- productos ---

        // Catalogo del vendor (panel). includeInactive suma los archivados.
        listProducts(vendorId, { includeInactive = false } = {}) {
            return soft(() => allRows(() => {
                let query = from('supply_products').select('*').eq('vendor_id', vendorId);
                if (!includeInactive) query = query.eq('is_active', true);
                return query.order('name').order('id');
            }), []);
        },

        // Catalogo para estudios: productos activos de vendors verificados y
        // activos, con el vendor embebido (supply_vendors). search busca en
        // nombre, marca y SKU; category: string o array. Con limit no pagina.
        searchCatalog({ search = '', category = null, vendorId = null, limit = null } = {}) {
            const text = String(search || '').trim();
            const build = () => {
                let query = from('supply_products')
                    .select(`*, supply_vendors!inner ( ${CATALOG_VENDOR_COLS} )`)
                    .eq('is_active', true)
                    .eq('supply_vendors.is_active', true)
                    .eq('supply_vendors.is_verified', true);
                query = byValue(query, 'category', category);
                if (vendorId) query = query.eq('vendor_id', vendorId);
                if (text) {
                    const pattern = orValue(`%${text}%`);
                    query = query.or(`name.ilike.${pattern},brand.ilike.${pattern},sku.ilike.${pattern}`);
                }
                return query.order('name').order('id');
            };
            if (limit) return soft(() => build().limit(limit), []);
            return soft(() => allRows(build), []);
        },

        // Crea (sin obj.id; exige obj.vendor_id) o edita un producto. Devuelve
        // la fila. .select().single().
        saveProduct(obj) {
            const product = obj || {};
            const payload = pick(product, PRODUCT_EDITABLE);
            if (product.id) {
                return guard(() => from('supply_products').update(payload).eq('id', product.id).select().single());
            }
            return guard(() => from('supply_products').insert({ ...payload, vendor_id: product.vendor_id }).select().single());
        },

        // Archiva un producto (is_active=false): los pedidos guardan su snapshot.
        archiveProduct(id) {
            return guard(() => from('supply_products').update({ is_active: false }).eq('id', id).select().single());
        },

        // --- tiers de descuento ---

        listTiers(vendorId) {
            return soft(() => from('supply_discount_tiers')
                .select('*')
                .eq('vendor_id', vendorId)
                .order('min_subtotal', { ascending: true })
                .order('id'), []);
        },

        // Crea (sin obj.id; exige obj.vendor_id) o edita un tier.
        saveTier(obj) {
            const tier = obj || {};
            const payload = pick(tier, TIER_EDITABLE);
            if (tier.id) {
                return guard(() => from('supply_discount_tiers').update(payload).eq('id', tier.id).select().single());
            }
            return guard(() => from('supply_discount_tiers').insert({ ...payload, vendor_id: tier.vendor_id }).select().single());
        },

        deleteTier(id) {
            return guard(() => from('supply_discount_tiers').delete().eq('id', id));
        },

        // --- pedidos ---

        // Pedidos del estudio con vendor y sede. status: string o array.
        listOrdersForStudio(studioId, { status = null } = {}) {
            return soft(() => allRows(() => byValue(from('supply_orders')
                .select(`*, supply_vendors ( id, name, slug, logo_image ), ${ORDER_LOCATION_EMBED}`)
                .eq('studio_id', studioId), 'status', status)
                .order('created_at', { ascending: false })
                .order('id')), []);
        },

        // Pedidos recibidos por el vendor con estudio y sede. status: string o array.
        listOrdersForVendor(vendorId, { status = null } = {}) {
            return soft(() => allRows(() => byValue(from('supply_orders')
                .select(`*, ${ORDER_STUDIO_EMBED}, ${ORDER_LOCATION_EMBED}`)
                .eq('vendor_id', vendorId), 'status', status)
                .order('created_at', { ascending: false })
                .order('id')), []);
        },

        // Pedido completo: items (en el orden de carga: sort_order), eventos
        // (cronologicos), estudio, sede y vendor. data null si no existe o la
        // RLS no lo deja ver.
        async getOrder(id) {
            const result = await settle(() => from('supply_orders')
                .select(`*, supply_order_items ( * ), supply_order_events ( * ), ${ORDER_STUDIO_EMBED}, ${ORDER_LOCATION_EMBED}, ${ORDER_VENDOR_EMBED}`)
                .eq('id', id)
                .maybeSingle());
            if (result.error || !result.data) return result;
            const order = result.data;
            return {
                ...result,
                data: {
                    ...order,
                    supply_order_items: (order.supply_order_items || []).slice().sort((a, b) => ((Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)) || byText(a.id, b.id)),
                    supply_order_events: (order.supply_order_events || []).slice().sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id)),
                },
            };
        },

        // Envia un pedido. items: [{ product_id, quantity, inventory_item_id? }]
        // (acepta productId / inventoryItemId). El servidor recalcula importes.
        submitOrder({ studioId, vendorId, locationId = null, items = [], notes = null } = {}) {
            const lines = (Array.isArray(items) ? items : []).map((item) => {
                const line = {
                    product_id: item.product_id != null ? item.product_id : item.productId,
                    quantity: Number(item.quantity),
                };
                const inventoryItemId = item.inventory_item_id != null ? item.inventory_item_id : item.inventoryItemId;
                if (inventoryItemId) line.inventory_item_id = inventoryItemId;
                return line;
            });
            return rpc('submit_supply_order', {
                p_studio_id: studioId,
                p_vendor_id: vendorId,
                p_location_id: locationId || null,
                p_items: lines,
                p_notes: notes || null,
            });
        },

        // El estudio cancela un pedido submitted o confirmed.
        cancelOrder(id, note) {
            return rpc('cancel_supply_order', { p_order_id: id, p_note: note || null });
        },

        // Recibe un pedido shipped/delivered. lines: [{ item_id,
        // received_quantity }] (acepta itemId / receivedQuantity); null =
        // todo lo pedido. Devuelve receive_result.
        receiveOrder(id, lines) {
            const payload = Array.isArray(lines)
                ? lines.map((line) => ({
                    item_id: line.item_id != null ? line.item_id : line.itemId,
                    received_quantity: Number(line.received_quantity != null ? line.received_quantity : line.receivedQuantity),
                }))
                : null;
            return rpc('receive_supply_order', { p_order_id: id, p_lines: payload });
        },

        // Acciones del vendor: confirm | reject | ship | deliver | cancel.
        vendorUpdateOrder(id, action, { shippingAmount = null, trackingCode = null, estimatedDelivery = null, note = null } = {}) {
            return rpc('vendor_update_supply_order', {
                p_order_id: id,
                p_action: action,
                p_shipping_amount: shippingAmount === null || shippingAmount === undefined || shippingAmount === '' ? null : Number(shippingAmount),
                p_tracking_code: trackingCode || null,
                p_estimated_delivery: estimatedDelivery || null,
                p_note: note || null,
            });
        },

        // --- reportes ---

        // Ventas mensuales por moneda (from/to 'YYYY-MM-DD'; el inicio se
        // lleva al dia 1 de su mes).
        vendorSalesMonthly(vendorId, fromDate, toDate) {
            return soft(() => allRows(() => {
                let query = from('supply_vendor_sales_monthly').select('*').eq('vendor_id', vendorId);
                if (fromDate) query = query.gte('month', monthStart(fromDate));
                if (toDate) query = query.lte('month', toDate);
                return query.order('month').order('currency');
            }), []);
        },

        // Estudios clientes del vendor, del pedido mas reciente al mas viejo.
        vendorCustomers(vendorId) {
            return soft(() => allRows(() => from('supply_vendor_customers')
                .select('*')
                .eq('vendor_id', vendorId)
                .order('last_order_at', { ascending: false })
                .order('studio_id')
                .order('currency')), []);
        },
    };

    D.Supplies = Supplies;
})();
