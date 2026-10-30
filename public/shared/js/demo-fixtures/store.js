/**
 * Fixtures de preview/demo · área "store" (Store del artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Contrato: docs/plans/2026-10-30-store-artista.md (§5 esquema, §6 RPCs y §8.6
 * demo). Las tablas replican la migración NO aplicada 20261030150000_store_core.sql.
 *
 *   - El usuario demo es vendedor: 3 diseños (uno con exclusiva disponible, uno
 *     reservado por un pedido con pago informado y uno retirado por venta
 *     exclusiva) y 3 merch (remera con talles, print y stickers), con pedidos
 *     recibidos en cada estado.
 *   - Y es comprador: le compró un diseño (licencia personal con archivos) y una
 *     tote a «Mara Ink», un vendedor ficticio que vive solo en la pseudo-tabla
 *     store_demo_sellers (nunca en artists_db).
 *   - Las RPC replican las validaciones principales del SQL con los mismos
 *     códigos: throw new Error('store:<código>'), que el emulador responde como
 *     400 P0001. Validan todo antes de mutar y mutan con store.update/insert
 *     (así el demo persiste los cambios entre páginas).
 *   - Simplificaciones: cobra siempre el vendedor (manual), así que ningún
 *     pedido toca el wallet; el email se da por confirmado; soporte solo con
 *     rpcCtx.isSupport (lo usan los tests).
 *
 * Montos en USD y ARS; fechas relativas a "hoy"; ids estables con el prefijo
 * 0000c0de-0000-4000-8000-57.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['store'] = function (ctx) {
        var tables = ctx.tables;
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var HOUR = 3600000;
        var now = Date.now();
        var identity = ctx.identity || {};
        var artistId = identity.userId || null;
        var clients = Array.isArray(ctx.clients) ? ctx.clients : [];
        // Versión vigente de los términos (store-model.js si ya está cargado).
        function termsVersion() { return (root.WeotziStoreModel && root.WeotziStoreModel.TERMS_VERSION) || '2026-10'; }
        var TERMS = termsVersion();

        function id(n) { return '0000c0de-0000-4000-8000-57' + String(n).padStart(10, '0'); }
        function daysAgo(n) { return new Date(now - n * DAY).toISOString(); }
        function hoursAgo(n) { return new Date(now - n * HOUR).toISOString(); }
        function inDays(n) { return new Date(now + n * DAY).toISOString(); }
        // Identidad viva: el demo completa username y nombre después de build().
        function myName() { return identity.name || 'Artista demo'; }
        function myHandle() { return identity.username || 'artista.wo'; }

        ['store_products', 'store_product_variants', 'store_design_assets', 'store_seller_settings', 'store_orders',
            'store_order_items', 'store_payments', 'store_licenses', 'store_download_events', 'store_demo_sellers'
        ].forEach(function (t) { if (ctx.TABLES.indexOf(t) === -1) ctx.TABLES.push(t); });

        /* ------------------------------ relaciones ------------------------------ */
        function rel(table, localKey, foreignKey, many) { return { table: table, localKey: localKey, foreignKey: foreignKey, many: !!many }; }
        var R = ctx.relations;
        R.store_products = Object.assign({}, R.store_products, {
            store_product_variants: rel('store_product_variants', 'id', 'product_id', true),
            store_design_assets: rel('store_design_assets', 'id', 'product_id', true)
        });
        R.store_orders = Object.assign({}, R.store_orders, {
            store_order_items: rel('store_order_items', 'id', 'order_id', true),
            store_licenses: rel('store_licenses', 'id', 'order_id', true),
            store_payments: rel('store_payments', 'id', 'order_id', true)
        });
        R.store_order_items = Object.assign({}, R.store_order_items, {
            store_orders: rel('store_orders', 'order_id', 'id', false),
            store_licenses: rel('store_licenses', 'id', 'order_item_id', false)
        });
        R.store_licenses = Object.assign({}, R.store_licenses, {
            store_orders: rel('store_orders', 'order_id', 'id', false),
            store_order_items: rel('store_order_items', 'order_item_id', 'id', false)
        });

        /* ------------------------------ moldes ------------------------------ */
        // Todas las columnas de §5, así las selects explícitas del repo resuelven.
        function product(p) {
            return Object.assign({
                id: null, seller_type: 'artist', seller_id: artistId, kind: 'design', status: 'active',
                title: '', description: null, category: null, tags: [], currency: 'USD', price_amount: null,
                license_personal_price: null, license_artist_price: null, license_exclusive_price: null,
                design_width_cm: null, design_height_cm: null, design_style: null, placement_suggestion: null,
                images: [], shipping_price_amount: null, ships_to_countries: [], ships_to_note: null,
                pickup_available: false, pickup_note: null, sales_count: 0, licenses_issued: 0,
                reserved_order_id: null, reserved_until: null, exclusive_sold_at: null, published_at: daysAgo(30),
                retired_at: null, metadata_json: {}, created_at: daysAgo(35), updated_at: daysAgo(2)
            }, p);
        }
        function variant(v) {
            return Object.assign({ id: null, product_id: null, label: '', size: null, color: null, sku: null, price_amount: null,
                stock: null, active: true, sort_order: 0, created_at: daysAgo(35), updated_at: daysAgo(2) }, v);
        }
        function asset(productId, n, kind, file, mime, bytes) {
            return { id: id(300 + n), product_id: productId, kind: kind, storage_path: 'demo/' + productId + '/' + kind + '/1761400000000-' + file,
                file_name: file, mime_type: mime, size_bytes: bytes, created_at: daysAgo(34) };
        }
        function order(o) {
            return Object.assign({
                id: null, order_number: null, seller_type: 'artist', seller_id: artistId, channel: 'online',
                buyer_user_id: null, buyer_role: 'client', buyer_name: '', buyer_email: null, buyer_phone: null,
                status: 'pending_payment', fulfillment_method: 'digital', fulfillment_status: 'unfulfilled',
                shipping_address: null, pickup_details: null, tracking_carrier: null, tracking_code: null, tracking_url: null,
                currency: 'USD', subtotal_amount: 0, shipping_amount: 0, total_amount: 0, platform_fee_pct: 0, platform_fee_amount: 0,
                payment_provider: 'manual', expected_collector: 'seller', payment_instructions: null, seller_contact: null,
                buyer_payment_reference: null, buyer_payment_reported_at: null, paid_at: null, payment_collected_by: null,
                payment_confirmed_by: null, expires_at: null, shipped_at: null, ready_at: null, delivered_at: null, delivered_by: null,
                cancelled_at: null, cancel_reason: null, refunded_at: null, funds_release_at: null, funds_released_at: null,
                funds_hold: false, buyer_note: null, seller_message: null, idempotency_key: null, metadata_json: {},
                created_at: null, updated_at: null
            }, o);
        }
        function item(it) {
            return Object.assign({ id: null, order_id: null, product_id: null, variant_id: null, kind: 'design', title: '',
                variant_label: null, image_path: null, license_tier: null, license_holder_name: null, terms_version: TERMS,
                terms_accepted_at: null, unit_price: 0, quantity: 1, line_total: 0, created_at: null }, it);
        }
        function payment(p) {
            return Object.assign({ id: null, order_id: null, provider: 'manual', status: 'succeeded', amount: 0, currency: 'USD',
                collected_by: 'seller', reference: null, note: null, confirmed_by: null, provider_payload: null, created_at: null }, p);
        }
        function license(l) {
            return Object.assign({ id: null, order_id: null, order_item_id: null, product_id: null, tier: 'personal',
                holder_user_id: null, holder_name: '', seller_type: 'artist', seller_id: artistId, seller_display_name: null,
                seller_username: null, design_title: '', terms_version: TERMS, verification_code: null, used_at: null,
                used_note: null, issued_at: null, revoked_at: null, revoke_reason: null, metadata_json: {}, created_at: null }, l);
        }
        function img(file, alt) { return [{ path: 'demo/store/' + file, alt: alt }]; }
        function buyer(i, fallback, fallbackCity) {
            var c = clients[i] || {};
            return { id: c.user_id || id(880 + i), name: c.name || fallback, email: c.email || null, city: c.city || fallbackCity };
        }

        /* ------------------------------ vendedores ------------------------------ */
        var MARA = id(901);
        tables.store_demo_sellers = [{
            id: MARA, seller_type: 'artist', handle: 'mara-ink.wo', name: 'Mara Ink',
            avatar_url: (ctx.helpers && ctx.helpers.ASSETS ? ctx.helpers.ASSETS : '/shared/assets/demo/') + 'store/mara-avatar.svg',
            city: 'Córdoba', country: 'Argentina', allow_search_indexing: false, created_at: daysAgo(200)
        }];
        var MY_SETTINGS = {
            seller_type: 'artist', seller_id: artistId,
            store_tagline: 'Flash propio, prints y merch del estudio. Datos de ejemplo del modo demo.',
            contact_channel: 'WhatsApp +54 9 11 5555-0100 · respondo en el día',
            payment_instructions: 'Transferí el monto exacto, en la moneda del producto, al alias de ejemplo DEMO.STORE.WO y mandame el comprobante por WhatsApp.',
            shipping_policy: 'Despacho en 3 días hábiles por correo con seguimiento.',
            return_policy: 'Cambios de talle dentro de los 10 días, con la prenda sin uso. Los diseños digitales no tienen devolución una vez descargados.',
            pickup_address: 'Dirección de ejemplo · Palermo, Buenos Aires',
            authorship_attested_at: daysAgo(36), created_at: daysAgo(40), updated_at: daysAgo(5)
        };
        tables.store_seller_settings = [MY_SETTINGS, {
            seller_type: 'artist', seller_id: MARA,
            store_tagline: 'Blackwork y ornamental desde Córdoba.',
            contact_channel: '@mara.ink en Instagram',
            payment_instructions: 'Transferencia al alias de ejemplo MARA.INK.DEMO. Escribime con el número de pedido.',
            shipping_policy: 'Envíos a todo el país en 5 días hábiles.', return_policy: 'Sin devoluciones en diseños digitales.',
            pickup_address: null, authorship_attested_at: daysAgo(120), created_at: daysAgo(150), updated_at: daysAgo(20)
        }];

        /* ------------------------------ productos ------------------------------ */
        var D1 = id(101), D2 = id(102), D3 = id(103), M1 = id(104), M2 = id(105), M3 = id(106);
        var MD1 = id(151), MD2 = id(152), MM1 = id(153);
        var O1 = id(401), O2 = id(402), O3 = id(403), O4 = id(404), O5 = id(405), O6 = id(406), P1 = id(451), P2 = id(452);
        var DESIGN_DESC = ' Incluye el original en alta, el stencil listo para imprimir y el certificado de licencia.';
        var PICKUP_NOTE = 'Palermo, Buenos Aires · martes a sábado de 12 a 19 h';

        tables.store_products = [
            product({ id: D1, title: 'Golondrina fine line', category: 'Flash', tags: ['fine line', 'aves', 'tradicional'],
                description: 'Golondrina en línea fina, pensada para antebrazo, tobillo o clavícula.' + DESIGN_DESC,
                license_personal_price: 35, license_artist_price: 90, license_exclusive_price: 420,
                design_width_cm: 9, design_height_cm: 7, design_style: 'Fine line', placement_suggestion: 'Antebrazo interno o tobillo',
                images: img('golondrina.svg', 'Golondrina en línea fina con sol rojo'), published_at: daysAgo(30) }),
            product({ id: D2, currency: 'ARS', title: 'Serpiente y peonías', category: 'Pieza grande', tags: ['ornamental', 'botánico'],
                description: 'Serpiente entre peonías para muslo o espalda. Se adapta al tamaño en la sesión.' + DESIGN_DESC,
                license_personal_price: 45000, license_artist_price: 120000, license_exclusive_price: 380000,
                design_width_cm: 18, design_height_cm: 26, design_style: 'Ornamental', placement_suggestion: 'Muslo o espalda alta',
                images: img('serpiente-peonias.svg', 'Serpiente entre dos peonías'), published_at: daysAgo(25),
                reserved_order_id: O1, reserved_until: inDays(6) }),
            product({ id: D3, status: 'retired', title: 'Polilla lunar', category: 'Flash', tags: ['blackwork', 'luna'],
                description: 'Polilla con luna creciente, vendida con licencia exclusiva.' + DESIGN_DESC,
                license_personal_price: 30, license_artist_price: 80, license_exclusive_price: 420,
                design_width_cm: 12, design_height_cm: 10, design_style: 'Blackwork', placement_suggestion: 'Esternón o espalda',
                images: img('polilla-lunar.svg', 'Polilla con luna creciente'), published_at: daysAgo(40),
                sales_count: 1, licenses_issued: 1, exclusive_sold_at: daysAgo(12), retired_at: daysAgo(12), updated_at: daysAgo(12) }),
            product({ id: M1, kind: 'merch', currency: 'ARS', title: 'Remera Golondrina', category: 'Remeras', tags: ['remera', 'algodón'],
                description: 'Remera de algodón peinado con la golondrina estampada en el pecho y la espalda.',
                price_amount: 28000, shipping_price_amount: 6500, ships_to_countries: ['AR', 'UY'], ships_to_note: 'Argentina y Uruguay',
                pickup_available: true, pickup_note: PICKUP_NOTE, sales_count: 1,
                images: [{ path: 'demo/store/remera-golondrina.svg', alt: 'Remera negra con la golondrina, frente' },
                    { path: 'demo/store/remera-golondrina-espalda.svg', alt: 'Remera negra con la golondrina, espalda' }] }),
            product({ id: M2, kind: 'merch', title: 'Print «Serpiente»', category: 'Prints', tags: ['print', 'giclée'],
                description: 'Impresión giclée sobre papel de algodón, firmada y numerada.',
                price_amount: 40, shipping_price_amount: 15, ships_to_note: 'Envíos a todo el mundo', pickup_available: true,
                pickup_note: PICKUP_NOTE, sales_count: 1, images: img('print-serpiente.svg', 'Print enmarcado de la serpiente') }),
            product({ id: M3, kind: 'merch', currency: 'ARS', title: 'Pack de stickers', category: 'Stickers', tags: ['stickers'],
                description: 'Seis stickers de vinilo con los flash del estudio.',
                price_amount: 6000, shipping_price_amount: 2500, ships_to_countries: ['AR'], ships_to_note: 'Solo Argentina',
                pickup_available: true, pickup_note: PICKUP_NOTE, sales_count: 1, images: img('stickers.svg', 'Plancha de seis stickers') }),
            product({ id: MD1, seller_id: MARA, title: 'Ojo que todo lo ve', category: 'Flash', tags: ['blackwork', 'símbolos'],
                description: 'Ojo dentro de un triángulo con rayos, en blackwork.' + DESIGN_DESC,
                license_personal_price: 30, license_artist_price: 75, license_exclusive_price: 350,
                design_width_cm: 8, design_height_cm: 8, design_style: 'Blackwork', placement_suggestion: 'Mano o nuca',
                images: img('mara-ojo.svg', 'Ojo dentro de un triángulo'), sales_count: 1, licenses_issued: 1, published_at: daysAgo(60) }),
            product({ id: MD2, seller_id: MARA, title: 'Calavera floral', category: 'Flash', tags: ['ornamental', 'calavera'],
                description: 'Calavera geométrica con flores a los costados.' + DESIGN_DESC,
                license_personal_price: 25, license_artist_price: 60, license_exclusive_price: 300,
                design_width_cm: 10, design_height_cm: 12, design_style: 'Ornamental', placement_suggestion: 'Pantorrilla',
                images: img('mara-calavera.svg', 'Calavera con flores'), published_at: daysAgo(45) }),
            product({ id: MM1, seller_id: MARA, kind: 'merch', currency: 'ARS', title: 'Tote «Ojo»', category: 'Bolsas', tags: ['tote'],
                description: 'Tote de lienzo natural con el ojo estampado.',
                price_amount: 18000, shipping_price_amount: 4000, ships_to_countries: ['AR'], ships_to_note: 'Solo Argentina',
                sales_count: 1, images: img('mara-tote.svg', 'Tote de lienzo con el ojo'), published_at: daysAgo(50) })
        ];

        tables.store_product_variants = [
            variant({ id: id(201), product_id: M1, label: 'Talle S', size: 'S', color: 'Negro', sku: 'REM-GOL-S', stock: 4, sort_order: 0 }),
            variant({ id: id(202), product_id: M1, label: 'Talle M', size: 'M', color: 'Negro', sku: 'REM-GOL-M', stock: 9, sort_order: 1 }),
            variant({ id: id(203), product_id: M1, label: 'Talle L', size: 'L', color: 'Negro', sku: 'REM-GOL-L', stock: 0, sort_order: 2 }),
            variant({ id: id(204), product_id: M1, label: 'Talle XL', size: 'XL', color: 'Negro', sku: 'REM-GOL-XL', stock: 6, sort_order: 3 }),
            variant({ id: id(205), product_id: M1, label: 'Talle XXL', size: 'XXL', color: 'Negro', sku: 'REM-GOL-XXL', stock: 0, active: false, sort_order: 4 }),
            variant({ id: id(206), product_id: M2, label: 'A3', size: 'A3', sku: 'PRT-SER-A3', stock: 12, sort_order: 0 }),
            variant({ id: id(207), product_id: M2, label: 'A4', size: 'A4', sku: 'PRT-SER-A4', price_amount: 28, stock: null, sort_order: 1 }),
            variant({ id: id(208), product_id: M3, label: 'Pack x6', sku: 'STK-6', stock: 3, sort_order: 0 }),
            variant({ id: id(251), product_id: MM1, label: 'Natural', color: 'Crudo', sku: 'MARA-TOTE', stock: 7, sort_order: 0 })
        ];

        tables.store_design_assets = [
            asset(D1, 1, 'original', 'golondrina-original.png', 'image/png', 2481220),
            asset(D1, 2, 'stencil', 'golondrina-stencil.png', 'image/png', 412330),
            asset(D2, 3, 'original', 'serpiente-peonias.psd', 'image/vnd.adobe.photoshop', 18220000),
            asset(D2, 4, 'stencil', 'serpiente-stencil.pdf', 'application/pdf', 640000),
            asset(D3, 5, 'original', 'polilla-lunar-original.png', 'image/png', 1983400),
            asset(D3, 6, 'stencil', 'polilla-lunar-stencil.png', 'image/png', 356120),
            asset(MD1, 51, 'original', 'ojo-original.png', 'image/png', 1520300),
            asset(MD1, 52, 'stencil', 'ojo-stencil.png', 'image/png', 298400),
            asset(MD2, 53, 'original', 'calavera-floral.tif', 'image/tiff', 9400000),
            asset(MD2, 54, 'stencil', 'calavera-stencil.png', 'image/png', 330200)
        ];

        /* ------------------------------ pedidos ------------------------------ */
        var camila = buyer(0, 'Camila Soto', 'Buenos Aires'), nicolas = buyer(1, 'Nicolás Duarte', 'Rosario');
        var sofia = buyer(3, 'Sofía Martínez', 'Buenos Aires'), mateo = buyer(4, 'Mateo Ruiz', 'Córdoba');
        var lucia = buyer(5, 'Lucía Beltrán', 'Montevideo'), julia = buyer(6, 'Julia Ferrer', 'Buenos Aires');
        var mara = tables.store_seller_settings[1];
        function mine(o) { return Object.assign({ payment_instructions: MY_SETTINGS.payment_instructions, seller_contact: MY_SETTINGS.contact_channel }, o); }
        function fromMara(o) {
            return Object.assign({ seller_id: MARA, buyer_user_id: artistId, buyer_role: 'artist', buyer_name: myName(), buyer_email: identity.email || null,
                payment_instructions: mara.payment_instructions, seller_contact: mara.contact_channel }, o);
        }

        tables.store_orders = [
            // Pendiente con pago informado: reserva la exclusiva de D2 (vence en 6 días).
            order(mine({ id: O1, order_number: 'ST-5E2A91C0', buyer_user_id: camila.id, buyer_name: camila.name, buyer_email: camila.email,
                currency: 'ARS', subtotal_amount: 380000, total_amount: 380000, buyer_payment_reference: 'Transferencia · comprobante 0001234',
                buyer_payment_reported_at: hoursAgo(26), expires_at: inDays(6), buyer_note: 'La quiero para la espalda alta.',
                idempotency_key: 'demo-o1', created_at: hoursAgo(30), updated_at: hoursAgo(26) })),
            // Pagado, por preparar (envío a Rosario).
            order(mine({ id: O2, order_number: 'ST-7B30D4E8', buyer_user_id: nicolas.id, buyer_name: nicolas.name, buyer_email: nicolas.email,
                status: 'paid', fulfillment_method: 'shipping', currency: 'ARS', subtotal_amount: 28000, shipping_amount: 6500, total_amount: 34500,
                shipping_address: { recipient: nicolas.name, line1: 'Calle de ejemplo 1234', line2: 'Piso 3 B', city: 'Rosario', region: 'Santa Fe', postal_code: '2000', country: 'AR', phone: '+54 9 341 555-0101' },
                paid_at: daysAgo(1), payment_collected_by: 'seller', payment_confirmed_by: artistId, expires_at: daysAgo(1),
                idempotency_key: 'demo-o2', created_at: daysAgo(2), updated_at: daysAgo(1) })),
            // Enviado con seguimiento (Montevideo).
            order(mine({ id: O3, order_number: 'ST-91C4F2A7', buyer_user_id: lucia.id, buyer_name: lucia.name, buyer_email: lucia.email,
                status: 'paid', fulfillment_method: 'shipping', fulfillment_status: 'shipped', currency: 'USD',
                subtotal_amount: 40, shipping_amount: 15, total_amount: 55,
                shipping_address: { recipient: lucia.name, line1: 'Avenida de ejemplo 456', line2: null, city: 'Montevideo', region: null, postal_code: '11200', country: 'UY', phone: null },
                tracking_carrier: 'Correo de ejemplo', tracking_code: 'CE123456789UY', tracking_url: 'https://seguimiento.example.com/CE123456789UY',
                seller_message: 'Salió hoy por correo. Te llega en 5 a 7 días hábiles.',
                paid_at: daysAgo(4), payment_collected_by: 'seller', payment_confirmed_by: artistId, shipped_at: daysAgo(2), expires_at: daysAgo(4),
                idempotency_key: 'demo-o3', created_at: daysAgo(5), updated_at: daysAgo(2) })),
            // Digital completado: exclusiva de D3 con licencia emitida.
            order(mine({ id: O4, order_number: 'ST-3FA8B6D1', buyer_user_id: sofia.id, buyer_name: sofia.name, buyer_email: sofia.email,
                status: 'fulfilled', fulfillment_status: 'delivered', currency: 'USD', subtotal_amount: 420, total_amount: 420,
                paid_at: daysAgo(12), payment_collected_by: 'seller', payment_confirmed_by: artistId, delivered_at: daysAgo(12), delivered_by: 'auto',
                buyer_payment_reference: 'Transferencia 88213', buyer_payment_reported_at: daysAgo(12), expires_at: daysAgo(11),
                idempotency_key: 'demo-o4', created_at: daysAgo(13), updated_at: daysAgo(12) })),
            // Cancelado por el comprador (el stock ya se restituyó).
            order(mine({ id: O5, order_number: 'ST-C04E7A55', buyer_user_id: mateo.id, buyer_name: mateo.name, buyer_email: mateo.email,
                status: 'cancelled', fulfillment_method: 'shipping', currency: 'ARS', subtotal_amount: 12000, shipping_amount: 2500, total_amount: 14500,
                shipping_address: { recipient: mateo.name, line1: 'Bulevar de ejemplo 789', line2: null, city: 'Córdoba', region: 'Córdoba', postal_code: '5000', country: 'AR', phone: null },
                cancelled_at: daysAgo(3), cancel_reason: 'Me equivoqué de cantidad.', expires_at: daysAgo(3),
                idempotency_key: 'demo-o5', created_at: daysAgo(4), updated_at: daysAgo(3) })),
            // Pagado, listo para retirar en el estudio.
            order(mine({ id: O6, order_number: 'ST-AD62E019', buyer_user_id: julia.id, buyer_name: julia.name, buyer_email: julia.email,
                status: 'paid', fulfillment_method: 'pickup', fulfillment_status: 'ready_for_pickup', currency: 'ARS',
                subtotal_amount: 6000, total_amount: 6000, pickup_details: MY_SETTINGS.pickup_address,
                seller_message: 'Ya está listo. Pasá de martes a sábado de 12 a 19 h.',
                paid_at: daysAgo(2), payment_collected_by: 'seller', payment_confirmed_by: artistId, ready_at: hoursAgo(5), expires_at: daysAgo(2),
                idempotency_key: 'demo-o6', created_at: daysAgo(3), updated_at: hoursAgo(5) })),
            // Compras del usuario demo a Mara Ink.
            order(fromMara({ id: P1, order_number: 'ST-0D9E4B7C', status: 'fulfilled', fulfillment_status: 'delivered', currency: 'USD',
                subtotal_amount: 30, total_amount: 30, paid_at: daysAgo(9), payment_collected_by: 'seller', payment_confirmed_by: MARA,
                delivered_at: daysAgo(9), delivered_by: 'auto', buyer_payment_reference: 'Transferencia 55120', buyer_payment_reported_at: daysAgo(9),
                expires_at: daysAgo(9), idempotency_key: 'demo-p1', created_at: daysAgo(10), updated_at: daysAgo(9) })),
            order(fromMara({ id: P2, order_number: 'ST-62B1A8F3', status: 'paid', fulfillment_method: 'shipping', fulfillment_status: 'shipped',
                currency: 'ARS', subtotal_amount: 18000, shipping_amount: 4000, total_amount: 22000,
                shipping_address: { recipient: myName(), line1: 'Dirección de ejemplo 100', line2: null, city: 'Buenos Aires', region: 'CABA', postal_code: '1414', country: 'AR', phone: null },
                tracking_carrier: 'Correo de ejemplo', tracking_code: 'CE987654321AR', tracking_url: 'https://seguimiento.example.com/CE987654321AR',
                seller_message: 'Despachada. Cualquier cosa escribime por Instagram.',
                paid_at: daysAgo(3), payment_collected_by: 'seller', payment_confirmed_by: MARA, shipped_at: daysAgo(1), expires_at: daysAgo(3),
                idempotency_key: 'demo-p2', created_at: daysAgo(4), updated_at: daysAgo(1) }))
        ];

        tables.store_order_items = [
            item({ id: id(501), order_id: O1, product_id: D2, title: 'Serpiente y peonías', image_path: 'demo/store/serpiente-peonias.svg',
                license_tier: 'exclusive', license_holder_name: camila.name, terms_accepted_at: hoursAgo(30), unit_price: 380000, line_total: 380000, created_at: hoursAgo(30) }),
            item({ id: id(502), order_id: O2, product_id: M1, variant_id: id(202), kind: 'merch', title: 'Remera Golondrina', variant_label: 'Talle M',
                image_path: 'demo/store/remera-golondrina.svg', terms_version: null, unit_price: 28000, line_total: 28000, created_at: daysAgo(2) }),
            item({ id: id(503), order_id: O3, product_id: M2, variant_id: id(206), kind: 'merch', title: 'Print «Serpiente»', variant_label: 'A3',
                image_path: 'demo/store/print-serpiente.svg', terms_version: null, unit_price: 40, line_total: 40, created_at: daysAgo(5) }),
            item({ id: id(504), order_id: O4, product_id: D3, title: 'Polilla lunar', image_path: 'demo/store/polilla-lunar.svg',
                license_tier: 'exclusive', license_holder_name: sofia.name, terms_accepted_at: daysAgo(13), unit_price: 420, line_total: 420, created_at: daysAgo(13) }),
            item({ id: id(505), order_id: O5, product_id: M3, variant_id: id(208), kind: 'merch', title: 'Pack de stickers', variant_label: 'Pack x6',
                image_path: 'demo/store/stickers.svg', terms_version: null, unit_price: 6000, quantity: 2, line_total: 12000, created_at: daysAgo(4) }),
            item({ id: id(506), order_id: O6, product_id: M3, variant_id: id(208), kind: 'merch', title: 'Pack de stickers', variant_label: 'Pack x6',
                image_path: 'demo/store/stickers.svg', terms_version: null, unit_price: 6000, line_total: 6000, created_at: daysAgo(3) }),
            item({ id: id(551), order_id: P1, product_id: MD1, title: 'Ojo que todo lo ve', image_path: 'demo/store/mara-ojo.svg',
                license_tier: 'personal', license_holder_name: myName(), terms_accepted_at: daysAgo(10), unit_price: 30, line_total: 30, created_at: daysAgo(10) }),
            item({ id: id(552), order_id: P2, product_id: MM1, variant_id: id(251), kind: 'merch', title: 'Tote «Ojo»', variant_label: 'Natural',
                image_path: 'demo/store/mara-tote.svg', terms_version: null, unit_price: 18000, line_total: 18000, created_at: daysAgo(4) })
        ];

        tables.store_payments = [
            payment({ id: id(601), order_id: O2, amount: 34500, currency: 'ARS', reference: 'Transferencia 77410', confirmed_by: artistId, created_at: daysAgo(1) }),
            payment({ id: id(602), order_id: O3, amount: 55, currency: 'USD', reference: 'Transferencia 77102', confirmed_by: artistId, created_at: daysAgo(4) }),
            payment({ id: id(603), order_id: O4, amount: 420, currency: 'USD', reference: 'Transferencia 88213', confirmed_by: artistId, created_at: daysAgo(12) }),
            payment({ id: id(604), order_id: O6, amount: 6000, currency: 'ARS', reference: 'Efectivo en el estudio', confirmed_by: artistId, created_at: daysAgo(2) }),
            payment({ id: id(651), order_id: P1, amount: 30, currency: 'USD', reference: 'Transferencia 55120', confirmed_by: MARA, created_at: daysAgo(9) }),
            payment({ id: id(652), order_id: P2, amount: 22000, currency: 'ARS', reference: 'Transferencia 55388', confirmed_by: MARA, created_at: daysAgo(3) })
        ];

        tables.store_licenses = [
            license({ id: id(701), order_id: O4, order_item_id: id(504), product_id: D3, tier: 'exclusive', holder_user_id: sofia.id, holder_name: sofia.name,
                seller_display_name: myName(), seller_username: myHandle(), design_title: 'Polilla lunar', verification_code: 'WOL-3F8A-B6D1',
                used_at: daysAgo(4), used_note: 'Tatuada en el estudio, sesión de 3 h.', issued_at: daysAgo(12), created_at: daysAgo(12) }),
            license({ id: id(751), order_id: P1, order_item_id: id(551), product_id: MD1, tier: 'personal', holder_user_id: artistId, holder_name: myName(),
                seller_id: MARA, seller_display_name: 'Mara Ink', seller_username: 'mara-ink.wo', design_title: 'Ojo que todo lo ve',
                verification_code: 'WOL-0D9E-4B7C', issued_at: daysAgo(9), created_at: daysAgo(9) })
        ];
        tables.store_download_events = [];

        /* ------------------------------ helpers de RPC ------------------------------ */
        function fail(code) { throw new Error('store:' + code); }
        function isoNow() { return new Date().toISOString(); }
        function ms(value) { var t = value ? Date.parse(value) : NaN; return isNaN(t) ? null : t; }
        function expired(value) { var t = ms(value); return t !== null && t < Date.now(); }
        function round2(n) { return Math.round(Number(n) * 100) / 100; }
        function text(value, max) { var s = value == null ? '' : String(value).trim(); return s ? (max ? s.slice(0, max) : s) : null; }
        function same(a, b) { return a != null && b != null && String(a) === String(b); }
        // Leer una tabla ajena sin crearla (rows() crea la tabla vacía y el demo
        // dejaría de leerla del backend real).
        function rowsOf(store, name) { return store.has(name) ? store.rows(name) : []; }
        function find(store, table, rowId) {
            if (rowId == null) return null;
            return rowsOf(store, table).find(function (r) { return same(r.id, rowId); }) || null;
        }
        function patch(store, table, rowId, values) {
            return store.update(table, [{ col: 'id', op: 'eq', value: String(rowId), negated: false }], values)[0] || null;
        }
        function userOf(rpcCtx) { var u = rpcCtx && rpcCtx.userId; if (!u) fail('not_authenticated'); return u; }
        function isSupport(rpcCtx) { return !!(rpcCtx && rpcCtx.isSupport === true); }
        function canManage(store, sellerType, sellerId, uid) {
            if (sellerType === 'artist') return same(sellerId, uid);
            if (sellerType === 'studio') return rowsOf(store, 'studios').some(function (s) { return same(s.id, sellerId) && same(s.user_id, uid); });
            return false;
        }
        function itemsOf(store, orderId) {
            return rowsOf(store, 'store_order_items').filter(function (i) { return same(i.order_id, orderId); })
                .sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
        }
        function itemOf(store, orderId) { return itemsOf(store, orderId)[0] || null; }
        function pendingOfProduct(store, productId, exceptOrderId) {
            return rowsOf(store, 'store_orders').filter(function (o) {
                return o.status === 'pending_payment' && !same(o.id, exceptOrderId)
                    && itemsOf(store, o.id).some(function (i) { return same(i.product_id, productId); });
            });
        }
        function settingsOf(store, sellerType, sellerId) {
            return rowsOf(store, 'store_seller_settings').find(function (s) { return s.seller_type === sellerType && same(s.seller_id, sellerId); }) || null;
        }
        function usesWallet(o) { return o.seller_type === 'artist' && (o.payment_collected_by === 'platform' || o.payment_collected_by === 'provider'); }
        function randomHex(n) {
            var out = '';
            for (var i = 0; i < n; i++) out += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
            return out;
        }
        function newOrderNumber(store) {
            var code;
            do { code = 'ST-' + randomHex(8); } while (rowsOf(store, 'store_orders').some(function (o) { return o.order_number === code; }));
            return code;
        }
        function newLicenseCode(store) {
            var code;
            do { code = 'WOL-' + randomHex(4) + '-' + randomHex(4); } while (rowsOf(store, 'store_licenses').some(function (l) { return l.verification_code === code; }));
            return code;
        }
        function initialsOf(name) {
            return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map(function (w) { return w.charAt(0).toUpperCase() + '.'; }).join(' ') || null;
        }

        // Vendedor público: la identidad, Mara (store_demo_sellers) o, en el
        // preview, un perfil de artists_db.
        function sellerInfo(store, sellerType, sellerId) {
            if (sellerId == null) return null;
            var profile = rowsOf(store, 'artists_db').find(function (a) { return same(a.user_id, sellerId) && a.registration_status !== 'incompleto'; }) || null;
            if (sellerType === 'artist' && same(sellerId, artistId)) {
                return { name: (profile && profile.name) || myName(), handle: (profile && profile.username) || myHandle(),
                    avatar: (profile && profile.profile_picture) || null, city: (profile && profile.city) || null, country: (profile && profile.country) || null, index: null };
            }
            var demo = rowsOf(store, 'store_demo_sellers').find(function (s) { return same(s.id, sellerId) && s.seller_type === sellerType; });
            if (demo) return { name: demo.name, handle: demo.handle, avatar: demo.avatar_url || null, city: demo.city || null, country: demo.country || null, index: !!demo.allow_search_indexing };
            if (sellerType === 'artist' && profile) {
                return { name: profile.name || profile.username, handle: profile.username || null, avatar: profile.profile_picture || null, city: profile.city || null, country: profile.country || null, index: null };
            }
            if (sellerType === 'studio') {
                var studio = rowsOf(store, 'studios').find(function (s) { return same(s.id, sellerId); });
                if (studio) return { name: studio.name, handle: null, avatar: null, city: null, country: null, index: false };
            }
            return null;
        }
        function sellerBundle(store, sellerType, sellerId) {
            var info = sellerInfo(store, sellerType, sellerId);
            if (!info) return null;
            var prefs = rowsOf(store, 'user_preferences').find(function (p) { return same(p.user_id, sellerId); });
            var privacy = (prefs && prefs.privacy) || {};
            var settings = settingsOf(store, sellerType, sellerId) || {};
            return {
                seller: { type: sellerType, id: sellerId, handle: info.handle, name: info.name, avatar_url: info.avatar,
                    city: privacy.show_city === false ? null : info.city, country: info.country },
                allow_search_indexing: info.index != null ? info.index : privacy.allow_search_indexing === true,
                settings: { tagline: settings.store_tagline || null, shipping_policy: settings.shipping_policy || null, return_policy: settings.return_policy || null }
            };
        }
        // Espejo de store_public_product_json.
        function publicProduct(store, p) {
            var variants = rowsOf(store, 'store_product_variants').filter(function (v) { return same(v.product_id, p.id) && v.active; })
                .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')); });
            var priceFrom;
            if (p.kind === 'design') {
                var tiers = [p.license_personal_price, p.license_artist_price, p.license_exclusive_price].filter(function (x) { return x != null; });
                priceFrom = tiers.length ? Math.min.apply(null, tiers) : null;
            } else {
                var prices = variants.map(function (v) { return v.price_amount != null ? v.price_amount : p.price_amount; }).filter(function (x) { return x != null; });
                priceFrom = prices.length ? Math.min.apply(null, prices) : p.price_amount;
            }
            return {
                id: p.id, kind: p.kind, title: p.title, description: p.description, category: p.category, tags: p.tags || [], currency: p.currency,
                price_amount: p.price_amount != null ? p.price_amount : null,
                price_from: priceFrom,
                license_personal_price: p.license_personal_price, license_artist_price: p.license_artist_price, license_exclusive_price: p.license_exclusive_price,
                exclusive_available: p.kind === 'design' && p.license_exclusive_price != null && p.reserved_order_id == null
                    && !(Number(p.licenses_issued) > 0) && !p.exclusive_sold_at && !pendingOfProduct(store, p.id, null).length,
                reserved: p.reserved_order_id != null && !expired(p.reserved_until) && p.reserved_until != null,
                licenses_issued: p.licenses_issued || 0,
                design_width_cm: p.design_width_cm, design_height_cm: p.design_height_cm, design_style: p.design_style, placement_suggestion: p.placement_suggestion,
                images: (p.images || []).map(function (i) { return { path: i.path, alt: i.alt == null ? null : i.alt }; }),
                shipping_price_amount: p.shipping_price_amount, ships_to_countries: p.ships_to_countries || [], ships_to_note: p.ships_to_note,
                pickup_available: !!p.pickup_available, pickup_note: p.pickup_note,
                variants: variants.map(function (v) {
                    return { id: v.id, label: v.label, size: v.size, color: v.color, price_amount: v.price_amount,
                        in_stock: v.stock == null || v.stock > 0, low_stock: v.stock != null && v.stock <= 5 ? v.stock : null };
                }),
                published_at: p.published_at
            };
        }
        function buyerOf(store, uid) {
            var isArtist = same(uid, artistId);
            var artistName = isArtist ? myName() : null;
            var email = isArtist ? (identity.email || null) : null;
            var profile = rowsOf(store, 'artists_db').find(function (a) { return same(a.user_id, uid) && a.registration_status !== 'incompleto'; });
            if (profile) { isArtist = true; artistName = artistName || profile.name || profile.username || null; email = email || profile.email || null; }
            var customer = clients.find(function (c) { return same(c.user_id, uid); })
                || rowsOf(store, 'clients_db').find(function (c) { return same(c.user_id, uid); }) || null;
            var clientName = customer ? (customer.name || customer.full_name || null) : null;
            email = email || (customer && customer.email) || null;
            var name = (isArtist ? artistName : null) || clientName || (email ? email.split('@')[0] : null) || 'Comprador';
            return { isArtist: isArtist, role: isArtist ? 'artist' : 'client', name: String(name).slice(0, 120), email: email, artistName: artistName };
        }

        // store_close_unpaid_order: cierra un pending_payment, restituye stock y
        // libera la reserva condicionada a este pedido.
        function closeUnpaid(store, order, status, reason) {
            if (!order || order.status !== 'pending_payment') return false;
            patch(store, 'store_orders', order.id, status === 'cancelled'
                ? { status: 'cancelled', cancelled_at: isoNow(), cancel_reason: text(reason, 300) }
                : { status: 'expired' });
            itemsOf(store, order.id).forEach(function (i) {
                var v = find(store, 'store_product_variants', i.variant_id);
                if (v && v.stock != null) patch(store, 'store_product_variants', v.id, { stock: Number(v.stock) + Number(i.quantity || 0) });
                var p = find(store, 'store_products', i.product_id);
                if (p && same(p.reserved_order_id, order.id)) patch(store, 'store_products', p.id, { reserved_order_id: null, reserved_until: null });
            });
            return true;
        }
        // store_finish_delivery: merch paid → fulfilled / delivered.
        function finishDelivery(store, order, by) {
            if (order.status !== 'paid' || (order.fulfillment_method !== 'shipping' && order.fulfillment_method !== 'pickup')) fail('invalid_status');
            var values = { status: 'fulfilled', fulfillment_status: 'delivered', delivered_at: isoNow(), delivered_by: by };
            if (usesWallet(order)) values.funds_release_at = new Date(Date.now() + 72 * HOUR).toISOString();
            return patch(store, 'store_orders', order.id, values);
        }
        function lockedOrder(store, orderId) { var o = find(store, 'store_orders', orderId); if (!o) fail('not_found'); return o; }

        // store_apply_order_payment (sin wallet: en el demo cobra el vendedor).
        function applyPayment(store, order, collectedBy, provider, ref, note, actor, support) {
            var it = itemOf(store, order.id);
            if (!it) fail('not_found');
            var p = find(store, 'store_products', it.product_id);
            if (order.paid_at) {
                var repeated = rowsOf(store, 'store_payments').some(function (sp) {
                    return same(sp.order_id, order.id) && (sp.status === 'succeeded' || sp.status === 'duplicate') && (sp.reference || null) === (ref || null);
                });
                if (repeated) return order;
                store.insert('store_payments', [payment({ order_id: order.id, provider: provider, status: 'duplicate', amount: order.total_amount,
                    currency: order.currency, collected_by: collectedBy, reference: ref, note: note, confirmed_by: actor })]);
                return patch(store, 'store_orders', order.id, { metadata_json: Object.assign({}, order.metadata_json,
                    { needs_support: true, needs_support_reason: 'duplicate_payment', needs_support_at: isoNow() }) });
            }
            var reopen = null;
            if (order.status === 'pending_payment') {
                if (expired(order.expires_at) && !order.buyer_payment_reported_at && collectedBy !== 'provider') fail('order_not_payable');
            } else if (order.status === 'expired') {
                if (!support) fail('order_not_payable');
                if (it.kind === 'merch') {
                    var v = find(store, 'store_product_variants', it.variant_id);
                    if (!v || (v.stock != null && v.stock < it.quantity)) fail('cannot_reopen');
                    reopen = function () { if (v.stock != null) patch(store, 'store_product_variants', v.id, { stock: v.stock - it.quantity }); };
                } else {
                    if (!p || p.exclusive_sold_at || (p.reserved_order_id != null && !same(p.reserved_order_id, order.id))) fail('cannot_reopen');
                    if (it.license_tier === 'exclusive') {
                        if (Number(p.licenses_issued) > 0 || pendingOfProduct(store, p.id, order.id).length) fail('cannot_reopen');
                        reopen = function () { patch(store, 'store_products', p.id, { reserved_order_id: order.id, reserved_until: new Date(Date.now() + 24 * HOUR).toISOString() }); };
                    }
                }
            } else {
                fail('order_not_payable');
            }
            if (it.kind === 'design') {
                if (!p) fail('design_no_longer_available');
                if (it.license_tier === 'exclusive') {
                    var reservedHere = same(p.reserved_order_id, order.id) || (reopen && p.reserved_order_id == null);
                    if (!reservedHere || p.exclusive_sold_at || Number(p.licenses_issued) > 0) fail('design_no_longer_available');
                } else if (p.exclusive_sold_at) {
                    fail('design_no_longer_available');
                }
            }
            // Validado: a partir de acá se muta.
            if (reopen) {
                reopen();
                order = patch(store, 'store_orders', order.id, { status: 'pending_payment',
                    metadata_json: Object.assign({}, order.metadata_json, { reopened_at: isoNow(), reopened_by: actor }) });
            }
            var at = isoNow();
            store.insert('store_payments', [payment({ order_id: order.id, provider: provider, status: 'succeeded', amount: order.total_amount,
                currency: order.currency, collected_by: collectedBy, reference: ref, note: note, confirmed_by: actor })]);
            if (it.kind === 'design') {
                var seller = sellerInfo(store, order.seller_type, order.seller_id) || {};
                store.insert('store_licenses', [license({
                    order_id: order.id, order_item_id: it.id, product_id: p.id, tier: it.license_tier, holder_user_id: order.buyer_user_id,
                    holder_name: (text(it.license_holder_name, 120) || order.buyer_name).slice(0, 120), seller_type: order.seller_type,
                    seller_id: order.seller_id, seller_display_name: seller.name || seller.handle || null, seller_username: seller.handle || null,
                    design_title: it.title, terms_version: it.terms_version || termsVersion(), verification_code: newLicenseCode(store), issued_at: at
                })]);
                var productPatch = { licenses_issued: (Number(p.licenses_issued) || 0) + 1, sales_count: (Number(p.sales_count) || 0) + it.quantity };
                if (it.license_tier === 'exclusive') {
                    Object.assign(productPatch, { status: 'retired', retired_at: p.retired_at || at, exclusive_sold_at: at, reserved_order_id: null, reserved_until: null });
                }
                patch(store, 'store_products', p.id, productPatch);
                if (it.license_tier === 'exclusive') {
                    pendingOfProduct(store, p.id, order.id).forEach(function (other) { closeUnpaid(store, other, 'cancelled', 'exclusive_sold'); });
                }
                var done = { status: 'fulfilled', fulfillment_status: 'delivered', delivered_at: at, delivered_by: 'auto', paid_at: at,
                    payment_collected_by: collectedBy, payment_confirmed_by: actor };
                if (usesWallet(Object.assign({}, order, done))) done.funds_release_at = new Date(Date.now() + 72 * HOUR).toISOString();
                return patch(store, 'store_orders', order.id, done);
            }
            if (p) patch(store, 'store_products', p.id, { sales_count: (Number(p.sales_count) || 0) + it.quantity });
            var settings = settingsOf(store, order.seller_type, order.seller_id) || {};
            var paid = { status: 'paid', paid_at: at, payment_collected_by: collectedBy, payment_confirmed_by: actor };
            if (order.fulfillment_method === 'pickup') paid.pickup_details = text(settings.pickup_address, 300);
            return patch(store, 'store_orders', order.id, paid);
        }

        var RANK = { unfulfilled: 0, preparing: 1, shipped: 2, ready_for_pickup: 2, delivered: 3 };

        /* ------------------------------ RPCs ------------------------------ */
        var rpcs = ctx.rpcs;

        rpcs.create_store_order = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var key = text(args.p_idempotency_key, 80);
            // 1. Idempotencia.
            if (key) {
                var existing = rowsOf(store, 'store_orders').find(function (o) { return same(o.buyer_user_id, uid) && o.idempotency_key === key && o.channel === 'online'; });
                if (existing) return existing;
            }
            // 2. Términos vigentes (el email se da por confirmado en el demo).
            if (args.p_terms_version !== termsVersion()) fail('terms_version_mismatch');
            // 3. Producto activo; una reserva exclusiva vencida se vence acá.
            var p = find(store, 'store_products', args.p_product_id);
            if (!p || p.status !== 'active') fail('product_unavailable');
            if (p.reserved_order_id != null && expired(p.reserved_until)) {
                var old = find(store, 'store_orders', p.reserved_order_id);
                if (!old || old.status !== 'pending_payment') patch(store, 'store_products', p.id, { reserved_order_id: null, reserved_until: null });
                else if (!old.buyer_payment_reported_at && expired(old.expires_at)) closeUnpaid(store, old, 'expired', null);
            }
            // 4. Vendedor.
            if (canManage(store, p.seller_type, p.seller_id, uid)) fail('own_product');
            var settings = settingsOf(store, p.seller_type, p.seller_id);
            if (!settings || !text(settings.contact_channel) || !text(settings.payment_instructions)) fail('seller_not_ready');
            // 5. Límites anti-acaparamiento.
            var pending = rowsOf(store, 'store_orders').filter(function (o) { return same(o.buyer_user_id, uid) && o.status === 'pending_payment'; });
            if (pending.some(function (o) { return itemsOf(store, o.id).some(function (i) { return same(i.product_id, p.id); }); })) fail('pending_order_exists');
            if (pending.filter(function (o) { return ms(o.created_at) > Date.now() - 24 * HOUR; }).length >= 5) fail('too_many_pending');
            var tier = text(args.p_license_tier) ? String(args.p_license_tier).trim().toLowerCase() : null;
            if (p.kind === 'design' && tier === 'exclusive') {
                var holding = rowsOf(store, 'store_products').some(function (x) {
                    var o = x.reserved_order_id != null && find(store, 'store_orders', x.reserved_order_id);
                    return o && same(o.buyer_user_id, uid) && o.status === 'pending_payment';
                });
                if (holding) fail('too_many_pending');
                var cooldown = rowsOf(store, 'store_orders').some(function (o) {
                    if (!same(o.buyer_user_id, uid) || (o.status !== 'expired' && o.status !== 'cancelled')) return false;
                    var at = ms(o.cancelled_at || o.expires_at || o.updated_at);
                    return at !== null && at > Date.now() - 7 * DAY && itemsOf(store, o.id).some(function (i) { return same(i.product_id, p.id) && i.license_tier === 'exclusive'; });
                });
                if (cooldown) fail('exclusive_cooldown');
            }
            var who = buyerOf(store, uid);
            var unit, qty, method, holder = null, variantRow = null, address = null, shipping = 0;
            if (p.kind === 'design') {
                // 6. Diseño.
                if (['personal', 'artist', 'exclusive'].indexOf(tier) === -1) fail('tier_unavailable');
                unit = tier === 'personal' ? p.license_personal_price : tier === 'artist' ? p.license_artist_price : p.license_exclusive_price;
                if (unit == null) fail('tier_unavailable');
                if (tier === 'artist' && !who.isArtist) fail('artist_tier_requires_artist');
                if (p.exclusive_sold_at) fail('design_no_longer_available');
                if (p.reserved_order_id != null) fail('product_reserved');
                if (tier === 'exclusive' && (Number(p.licenses_issued) > 0 || pendingOfProduct(store, p.id, null).length)) fail('exclusive_unavailable');
                if (args.p_variant_id) fail('variant_unavailable');
                if (args.p_quantity != null && Number(args.p_quantity) !== 1) fail('invalid_quantity');
                qty = 1;
                method = 'digital';
                // 7. Titular: 'artist' usa el nombre del perfil; el resto, el indicado o el del comprador.
                holder = (tier === 'artist' ? (who.artistName || who.name) : (text(args.p_license_holder_name) || who.name)).slice(0, 120);
            } else {
                // 8. Merch.
                if (tier) fail('tier_unavailable');
                if (!args.p_variant_id) fail('variant_required');
                variantRow = find(store, 'store_product_variants', args.p_variant_id);
                if (!variantRow || !same(variantRow.product_id, p.id) || !variantRow.active) fail('variant_unavailable');
                qty = args.p_quantity == null ? 1 : Number(args.p_quantity);
                if (!(qty >= 1 && qty <= 20) || Math.floor(qty) !== qty) fail('invalid_quantity');
                var pendingUnits = pending.reduce(function (sum, o) {
                    return sum + itemsOf(store, o.id).filter(function (i) { return same(i.variant_id, variantRow.id); })
                        .reduce(function (s, i) { return s + (Number(i.quantity) || 0); }, 0);
                }, 0);
                if (pendingUnits + qty > 20) fail('invalid_quantity');
                if (variantRow.stock != null && variantRow.stock < qty) fail('out_of_stock');
                method = text(args.p_fulfillment_method) ? String(args.p_fulfillment_method).trim().toLowerCase() : '';
                if (method === 'pickup') {
                    if (!p.pickup_available) fail('pickup_unavailable');
                } else if (method === 'shipping') {
                    var a = args.p_shipping_address;
                    if (!a || typeof a !== 'object' || Array.isArray(a)) fail('shipping_address_invalid');
                    var country = String(a.country || '').trim().toUpperCase();
                    if (!text(a.recipient) || !text(a.line1) || !text(a.city) || !/^[A-Z]{2}$/.test(country)) fail('shipping_address_invalid');
                    var list = p.ships_to_countries || [];
                    if (p.shipping_price_amount == null || (list.length && list.indexOf(country) === -1)) fail('ships_to_unsupported');
                    address = { recipient: text(a.recipient, 120), line1: text(a.line1, 200), line2: text(a.line2, 200), city: text(a.city, 120),
                        region: text(a.region, 120), postal_code: text(a.postal_code, 20), country: country, phone: text(a.phone, 40) };
                    shipping = Number(p.shipping_price_amount) || 0;
                } else {
                    fail('shipping_address_invalid');
                }
                unit = variantRow.price_amount != null ? variantRow.price_amount : p.price_amount;
                if (unit == null) fail('product_unavailable');
            }
            // 9 a 11. Precios desde la base, snapshots y vencimiento a 24 h.
            var subtotal = round2(unit * qty);
            var at = isoNow();
            var expires = new Date(Date.now() + 24 * HOUR).toISOString();
            if (variantRow && variantRow.stock != null) patch(store, 'store_product_variants', variantRow.id, { stock: variantRow.stock - qty });
            var created = store.insert('store_orders', [order({
                order_number: newOrderNumber(store), seller_type: p.seller_type, seller_id: p.seller_id, buyer_user_id: uid,
                buyer_role: who.role, buyer_name: who.name, buyer_email: who.email, fulfillment_method: method, shipping_address: address,
                currency: p.currency, subtotal_amount: subtotal, shipping_amount: shipping, total_amount: round2(subtotal + shipping),
                payment_instructions: text(settings.payment_instructions, 4000), seller_contact: text(settings.contact_channel, 200),
                expires_at: expires, buyer_note: text(args.p_buyer_note, 1000), idempotency_key: key, metadata_json: {},
                created_at: at, updated_at: at
            })])[0];
            store.insert('store_order_items', [item({
                order_id: created.id, product_id: p.id, variant_id: variantRow ? variantRow.id : null, kind: p.kind, title: String(p.title).slice(0, 120),
                variant_label: variantRow ? variantRow.label : null, image_path: (p.images && p.images[0] && p.images[0].path) || null,
                license_tier: p.kind === 'design' ? tier : null, license_holder_name: holder, terms_version: args.p_terms_version,
                terms_accepted_at: at, unit_price: unit, quantity: qty, line_total: subtotal, created_at: at
            })]);
            if (tier === 'exclusive') patch(store, 'store_products', p.id, { reserved_order_id: created.id, reserved_until: expires });
            return created;
        };

        rpcs.report_store_payment = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var o = find(store, 'store_orders', args.p_order_id);
            if (!o || !same(o.buyer_user_id, uid)) fail('not_found');
            if (o.expected_collector === 'provider') fail('collector_mismatch');
            if (o.status !== 'pending_payment' || expired(o.expires_at)) fail('order_not_payable');
            var values = { buyer_payment_reference: text(args.p_reference, 200) || o.buyer_payment_reference };
            if (!o.buyer_payment_reported_at) {
                values.buyer_payment_reported_at = isoNow();
                values.expires_at = new Date(Math.max(ms(o.expires_at) || 0, Date.now() + 7 * DAY)).toISOString();
            }
            o = patch(store, 'store_orders', o.id, values);
            itemsOf(store, o.id).forEach(function (i) {
                var p = find(store, 'store_products', i.product_id);
                if (p && same(p.reserved_order_id, o.id)) patch(store, 'store_products', p.id, { reserved_until: o.expires_at });
            });
            return o;
        };

        rpcs.cancel_store_order = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var o = lockedOrder(store, args.p_order_id);
            var support = isSupport(rpcCtx);
            if (!(same(o.buyer_user_id, uid) || canManage(store, o.seller_type, o.seller_id, uid) || support)) fail('not_found');
            if (o.status !== 'pending_payment') fail('invalid_status');
            if (o.buyer_payment_reported_at && !support) fail('payment_reported');
            closeUnpaid(store, o, 'cancelled', args.p_reason);
            return find(store, 'store_orders', o.id);
        };

        rpcs.confirm_store_order_payment = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var o = lockedOrder(store, args.p_order_id);
            var support = isSupport(rpcCtx);
            if (!(canManage(store, o.seller_type, o.seller_id, uid) || support)) fail('forbidden');
            if (args.p_collected_by !== o.expected_collector) fail('collector_mismatch');
            if (args.p_collected_by === 'provider' || (args.p_collected_by === 'platform' && !support)) fail('forbidden');
            return applyPayment(store, o, args.p_collected_by, o.payment_provider, text(args.p_reference, 200), text(args.p_note, 500), uid, support);
        };

        rpcs.update_store_order_fulfillment = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var o = lockedOrder(store, args.p_order_id);
            var support = isSupport(rpcCtx);
            var seller = canManage(store, o.seller_type, o.seller_id, uid);
            if (!(seller || support)) fail('forbidden');
            if (o.status !== 'paid' || o.fulfillment_method === 'digital') fail('invalid_status');
            var url = text(args.p_tracking_url);
            if (url && (!/^https:\/\/\S+$/.test(url) || url.length > 500)) fail('invalid_tracking_url');
            var from = o.fulfillment_status;
            var to = text(args.p_status) ? String(args.p_status).trim().toLowerCase() : '';
            var rf = RANK[from], rt = RANK[to];
            if (rt == null || rf == null || from === 'delivered' || rt < rf || (rt === rf && to !== from) || (to === from && to === 'unfulfilled')
                || (o.fulfillment_method === 'shipping' && to === 'ready_for_pickup') || (o.fulfillment_method === 'pickup' && to === 'shipped')) fail('invalid_status');
            var wallet = usesWallet(o);
            if (to === 'delivered' && wallet && !support) fail('forbidden');
            var code = text(args.p_tracking_code, 80);
            if (to === 'shipped' && wallet && !(code || o.tracking_code || url || o.tracking_url)) fail('tracking_required');
            var values = {
                tracking_carrier: text(args.p_tracking_carrier, 60) || o.tracking_carrier,
                tracking_code: code || o.tracking_code,
                tracking_url: url || o.tracking_url,
                seller_message: text(args.p_seller_message, 1000) || o.seller_message
            };
            if (to !== 'delivered') values.fulfillment_status = to;
            if (to === 'shipped') values.shipped_at = o.shipped_at || isoNow();
            if (to === 'ready_for_pickup') values.ready_at = o.ready_at || isoNow();
            o = patch(store, 'store_orders', o.id, values);
            if (to === 'delivered') o = finishDelivery(store, o, seller && !wallet ? 'seller' : 'support');
            return o;
        };

        rpcs.confirm_store_order_received = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var o = find(store, 'store_orders', args.p_order_id);
            if (!o || !same(o.buyer_user_id, uid)) fail('not_found');
            if (o.status !== 'paid' || (o.fulfillment_method !== 'shipping' && o.fulfillment_method !== 'pickup')
                || (o.fulfillment_status !== 'shipped' && o.fulfillment_status !== 'ready_for_pickup')) fail('invalid_status');
            return finishDelivery(store, o, 'buyer');
        };

        rpcs.refund_store_order = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var o = lockedOrder(store, args.p_order_id);
            var support = isSupport(rpcCtx);
            if (!(canManage(store, o.seller_type, o.seller_id, uid) || support)) fail('forbidden');
            if (o.status !== 'paid' && o.status !== 'fulfilled') fail('invalid_status');
            if (!support) {
                if (o.payment_collected_by !== 'seller') fail('forbidden');
                if (o.fulfillment_method !== 'digital' && o.fulfillment_status !== 'unfulfilled' && o.fulfillment_status !== 'preparing') fail('invalid_status');
            }
            var reason = text(args.p_reason, 300);
            var it = itemOf(store, o.id);
            var dispatched = o.fulfillment_method !== 'digital' && (o.fulfillment_status === 'shipped' || o.fulfillment_status === 'delivered');
            var at = isoNow();
            o = patch(store, 'store_orders', o.id, { status: 'refunded', refunded_at: at,
                metadata_json: Object.assign({}, o.metadata_json, { refund_reason: reason, refunded_by: uid }) });
            rowsOf(store, 'store_licenses').filter(function (l) { return same(l.order_id, o.id) && !l.revoked_at; })
                .forEach(function (l) { patch(store, 'store_licenses', l.id, { revoked_at: at, revoke_reason: reason || 'Reembolso' }); });
            var p = it && find(store, 'store_products', it.product_id);
            if (p) {
                var values = { sales_count: Math.max((Number(p.sales_count) || 0) - it.quantity, 0) };
                if (it.kind === 'merch' && !dispatched) {
                    var v = find(store, 'store_product_variants', it.variant_id);
                    if (v && v.stock != null) patch(store, 'store_product_variants', v.id, { stock: v.stock + it.quantity });
                }
                if (it.kind === 'design') {
                    values.licenses_issued = rowsOf(store, 'store_licenses').filter(function (l) { return same(l.product_id, p.id) && !l.revoked_at; }).length;
                    if (it.license_tier === 'exclusive' && p.exclusive_sold_at) Object.assign(values, { exclusive_sold_at: null, status: 'paused', retired_at: null });
                }
                patch(store, 'store_products', p.id, values);
            }
            store.insert('store_payments', [payment({ order_id: o.id, provider: o.payment_provider, status: 'refunded', amount: o.total_amount,
                currency: o.currency, collected_by: o.payment_collected_by, reference: null, note: reason, confirmed_by: uid })]);
            return o;
        };

        rpcs.adjust_store_variant_stock = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var v = find(store, 'store_product_variants', args.p_variant_id);
            if (!v) fail('not_found');
            var p = find(store, 'store_products', v.product_id);
            if (!p) fail('not_found');
            if (!(canManage(store, p.seller_type, p.seller_id, uid) || isSupport(rpcCtx))) fail('forbidden');
            var expected = args.p_expected_stock == null ? null : Number(args.p_expected_stock);
            var current = v.stock == null ? null : Number(v.stock);
            if (current !== expected) fail('stock_changed');
            var next = args.p_new_stock == null ? null : Number(args.p_new_stock);
            if (next !== null && (!(next >= 0) || Math.floor(next) !== next)) fail('invalid_quantity');
            return patch(store, 'store_product_variants', v.id, { stock: next });
        };

        rpcs.mark_store_license_used = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            var l = find(store, 'store_licenses', args.p_license_id);
            if (!l || !same(l.holder_user_id, uid)) fail('not_found');
            if (l.revoked_at) fail('license_revoked');
            if (l.used_at) fail('license_used');
            return patch(store, 'store_licenses', l.id, { used_at: isoNow(), used_note: text(args.p_note, 160) });
        };

        rpcs.get_store_sales_report = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            if (!(canManage(store, args.p_seller_type, args.p_seller_id, uid) || isSupport(rpcCtx))) fail('forbidden');
            var from = args.p_from ? Date.parse(String(args.p_from).slice(0, 10) + 'T00:00:00Z') : null;
            var to = args.p_to ? Date.parse(String(args.p_to).slice(0, 10) + 'T00:00:00Z') + DAY : null;
            var groups = {};
            rowsOf(store, 'store_orders').forEach(function (o) {
                if (o.seller_type !== args.p_seller_type || !same(o.seller_id, args.p_seller_id)) return;
                if ((o.status !== 'paid' && o.status !== 'fulfilled') || !o.paid_at) return;
                var t = ms(o.paid_at);
                if ((from !== null && t < from) || (to !== null && t >= to)) return;
                var month = new Date(t).toISOString().slice(0, 7) + '-01';
                itemsOf(store, o.id).forEach(function (i) {
                    var key = [i.product_id, month, o.currency].join('|');
                    var g = groups[key] || (groups[key] = { product_id: i.product_id, title: i.title, kind: i.kind, month: month, currency: o.currency,
                        units: 0, gross_amount: 0, orders: 0, _orders: {}, _paid: 0 });
                    if (t >= g._paid) { g._paid = t; g.title = i.title; g.kind = i.kind; }
                    g.units += Number(i.quantity) || 0;
                    g.gross_amount = round2(g.gross_amount + (Number(i.line_total) || 0));
                    if (!g._orders[o.id]) { g._orders[o.id] = true; g.orders += 1; }
                });
            });
            return Object.keys(groups).map(function (k) {
                var g = groups[k];
                return { product_id: g.product_id, title: g.title, kind: g.kind, month: g.month, currency: g.currency, units: g.units, gross_amount: g.gross_amount, orders: g.orders };
            }).sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : b.gross_amount - a.gross_amount; });
        };

        rpcs.set_store_order_funds_hold = function (args, store, rpcCtx) {
            var uid = userOf(rpcCtx);
            if (!isSupport(rpcCtx)) fail('forbidden');
            var o = lockedOrder(store, args.p_order_id);
            return patch(store, 'store_orders', o.id, { funds_hold: !!args.p_hold, metadata_json: Object.assign({}, o.metadata_json,
                { funds_hold_note: text(args.p_note, 500), funds_hold_by: uid, funds_hold_at: isoNow() }) });
        };

        // Vitrina: solo el handle de la identidad y los de store_demo_sellers.
        rpcs.get_public_storefront = function (args, store) {
            var handle = String(args.p_handle || '').trim().toLowerCase();
            if (args.p_seller_type !== 'artist' || !handle) return null;
            var sellerId = null;
            if (artistId && myHandle().toLowerCase() === handle) sellerId = artistId;
            else {
                var matches = rowsOf(store, 'store_demo_sellers').filter(function (s) { return s.seller_type === 'artist' && String(s.handle || '').toLowerCase() === handle; });
                if (matches.length === 1) sellerId = matches[0].id;
            }
            if (!sellerId) return null;
            var bundle = sellerBundle(store, 'artist', sellerId);
            if (!bundle) return null;
            bundle.products = rowsOf(store, 'store_products').filter(function (p) { return p.seller_type === 'artist' && same(p.seller_id, sellerId) && p.status === 'active'; })
                .sort(function (a, b) { return String(b.published_at || '').localeCompare(String(a.published_at || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')); })
                .map(function (p) { return publicProduct(store, p); });
            return bundle;
        };

        rpcs.get_public_store_product = function (args, store) {
            var p = find(store, 'store_products', args.p_product_id);
            if (!p || p.status !== 'active') return null;
            var bundle = sellerBundle(store, p.seller_type, p.seller_id);
            if (!bundle) return null;
            bundle.product = publicProduct(store, p);
            return bundle;
        };

        rpcs.verify_store_license = function (args, store) {
            var code = String(args.p_code || '').trim().toUpperCase();
            if (!/^WOL-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return { valid: false, found: false };
            var l = rowsOf(store, 'store_licenses').find(function (x) { return x.verification_code === code; });
            if (!l) return { valid: false, found: false };
            return {
                found: true, valid: !l.revoked_at, revoked: !!l.revoked_at, used: !!l.used_at, used_at: l.used_at || null,
                tier: l.tier, design_title: l.design_title, seller_id: l.seller_id, seller_display_name: l.seller_display_name,
                seller_username: l.seller_username, holder_initials: initialsOf(l.holder_name), issued_at: l.issued_at,
                terms_version: l.terms_version
            };
        };
    };
}(typeof self !== 'undefined' ? self : this));
