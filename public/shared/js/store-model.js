/**
 * WE OTZI - Modelo puro de la Store del artista (merch y diseños con licencia)
 * ---------------------------------------------------------------------------
 * Sin DOM ni red. Lo usan las páginas /artist/store y /store/*, el repo
 * (data/store-repo.js), el emulador del demo y tests/store-model.test.js.
 * Contrato: docs/plans/2026-10-30-store-artista.md (§3 licencias, §4 errores,
 * §6 RPCs y §8.1 lógica pura).
 *
 * Reglas que espeja de la migración 20261030150000_store_core.sql:
 *   - publishChecklist ≡ guard store_products_guard al pasar a `active`, más
 *     la dirección de retiro que exige create_store_order (merch con retiro);
 *   - isReserved ≡ `reserved` de store_public_product_json
 *     (reserved_order_id is not null, la condición de product_reserved);
 *   - canTransitionFulfillment ≡ update_store_order_fulfillment +
 *     confirm_store_order_received + run_store_maintenance;
 *   - usesWallet ≡ store_order_uses_wallet(o);
 *   - FILES ≡ límites y MIME de los buckets store-previews / store-design-files.
 *
 * Montos: siempre en la moneda del producto y con el código ISO visible
 * («USD 50», «ARS 65.000»). Nunca se convierten según la preferencia del
 * visitante: el comprador paga exactamente lo que dice el pedido.
 *
 * Los textos de licencia (TERMS) están versionados. Antes de producción tienen
 * que pasar por revisión legal; una versión nueva se agrega como clave nueva y
 * se sube TERMS_VERSION (y store_current_terms_version() en SQL).
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root) root.WeotziStoreModel = api;
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function (root) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Constantes                                                          */
    /* ------------------------------------------------------------------ */

    var TERMS_VERSION = '2026-10';
    var VERIFY_PARAM = 'verificar';
    var HOUR = 3600000;
    var DAY = 24 * HOUR;

    // Plazos del servidor (solo para mostrar; la base es la que decide).
    var LIMITS = {
        ORDER_TTL_HOURS: 24,
        REPORTED_EXTENSION_DAYS: 7,
        RELEASE_HOURS: 72,
        AUTO_DELIVER_SHIPPED_DAYS: 14,
        AUTO_DELIVER_PICKUP_DAYS: 7,
        EXCLUSIVE_COOLDOWN_DAYS: 7,
        MAX_PENDING_PER_DAY: 5,
        MAX_QUANTITY: 20,
        MAX_IMAGES: 8,
        MAX_TAGS: 12,
        LOW_STOCK: 5,
        DOWNLOADS_PER_DAY: 50,
        MAX_PRICE: 9999999999.99
    };

    var ORDER_STATUSES = ['pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded', 'expired'];
    var FULFILLMENT_STATUSES = ['unfulfilled', 'preparing', 'shipped', 'ready_for_pickup', 'delivered'];
    var PRODUCT_STATUSES = ['draft', 'active', 'paused', 'retired'];
    var FULFILLMENT_METHODS = ['digital', 'shipping', 'pickup'];
    var ACTORS = ['seller', 'buyer', 'support', 'auto'];

    // Copy fijo del contrato (§8.1). Las claves no se repiten entre grupos,
    // así que un único mapa sirve para pedidos, envíos y productos.
    var STATUS_LABELS = {
        pending_payment: 'Esperando pago',
        paid: 'Pago confirmado',
        fulfilled: 'Completado',
        cancelled: 'Cancelado',
        refunded: 'Reembolsado',
        expired: 'Vencido',
        unfulfilled: 'Por preparar',
        preparing: 'En preparación',
        shipped: 'Enviado',
        ready_for_pickup: 'Listo para retirar',
        delivered: 'Entregado',
        draft: 'Borrador',
        active: 'Publicado',
        paused: 'Pausado',
        retired: 'Retirado'
    };

    // Clase completa del tag del DS para cada estado.
    var STATUS_TAGS = {
        pending_payment: 'wo-tag wo-tag--highlight',
        paid: 'wo-tag wo-tag--info',
        fulfilled: 'wo-tag wo-tag--active',
        cancelled: 'wo-tag wo-tag--archived',
        refunded: 'wo-tag wo-tag--archived',
        expired: 'wo-tag wo-tag--archived',
        unfulfilled: 'wo-tag wo-tag--highlight',
        preparing: 'wo-tag wo-tag--info',
        shipped: 'wo-tag wo-tag--info',
        ready_for_pickup: 'wo-tag wo-tag--info',
        delivered: 'wo-tag wo-tag--active',
        draft: 'wo-tag wo-tag--soft',
        active: 'wo-tag wo-tag--active',
        paused: 'wo-tag wo-tag--highlight',
        retired: 'wo-tag wo-tag--archived'
    };

    var METHOD_LABELS = {
        digital: 'Descarga digital',
        shipping: 'Envío a domicilio',
        pickup: 'Retiro en el estudio'
    };

    var KIND_LABELS = { design: 'Diseño', merch: 'Merch' };

    /* ------------------------------ licencias ------------------------------ */

    var LICENSE_TIERS = [
        {
            id: 'personal',
            label: 'Personal',
            priceField: 'license_personal_price',
            requiresArtist: false,
            holderEditable: true,
            summary: 'Para tatuarte el diseño una vez, en tu cuerpo o en el de la persona a quien se lo regales.',
            bullets: [
                'Un tatuaje, una sola vez, en el cuerpo del titular.',
                'Elegís el tatuador que quieras.',
                'Podés compartir el stencil con el tatuador que te va a tatuar, solo para esa sesión.',
                'Sin reventa, merch ni uso comercial.'
            ]
        },
        {
            id: 'artist',
            label: 'Artista',
            priceField: 'license_artist_price',
            requiresArtist: true,
            holderEditable: false,
            summary: 'Para tatuadores: tatuás el diseño una vez a un cliente y cobrás esa sesión.',
            bullets: [
                'Un tatuaje, una sola vez, a un cliente tuyo.',
                'Cobrás la sesión como cualquier trabajo.',
                'Publicás el resultado dando crédito al autor.',
                'No es exclusiva: el autor puede seguir vendiendo el diseño.',
                'Solo para cuentas de artista con el registro completo.'
            ]
        },
        {
            id: 'exclusive',
            label: 'Exclusiva',
            priceField: 'license_exclusive_price',
            requiresArtist: false,
            holderEditable: true,
            summary: 'Venta única: cuando se confirma tu pago, el diseño se retira para siempre y nadie más lo puede comprar.',
            bullets: [
                'Venta única: el diseño se retira para siempre.',
                'Un tatuaje, una sola vez, al titular o, si comprás como artista, a tu cliente.',
                'Podés compartir el stencil con el tatuador que te va a tatuar, solo para esa sesión.',
                'El autor conserva la autoría y puede mostrarlo en su portafolio.'
            ]
        }
    ];
    var TIER_IDS = LICENSE_TIERS.map(function (t) { return t.id; });

    // Textos completos por versión. Revisión legal pendiente antes de producción.
    var TERMS = {
        '2026-10': {
            version: '2026-10',
            title: 'Licencias de uso de diseños · v2026-10',
            legalReviewPending: true,
            intro: 'Al comprar un diseño en la Store de un artista de We Ötzi no comprás el diseño: comprás un permiso de uso con las condiciones de tu nivel de licencia. El autor sigue siendo el dueño de su obra.',
            personal: {
                title: 'Licencia Personal',
                clauses: [
                    'Esta licencia te permite tatuar el diseño una sola vez, en el cuerpo de la persona titular.',
                    'La persona titular es quien se tatúa. Por defecto es quien compra, pero la podés regalar: en ese caso, el titular es la persona que recibe el regalo y su nombre figura en el certificado.',
                    'El titular elige libremente al tatuador o la tatuadora que va a hacer el trabajo.',
                    'Podés compartir el stencil con el tatuador que te va a tatuar, solo para esa sesión. Ese tatuador no puede guardar, reutilizar ni volver a compartir los archivos.',
                    'No permite reventa, merch, impresiones para vender ni ningún otro uso comercial del diseño.',
                    'La licencia no se puede transferir a otra persona después de emitida.'
                ]
            },
            artist: {
                title: 'Licencia Artista',
                clauses: [
                    'Esta licencia es solo para cuentas de artista con el registro completo en We Ötzi. El titular es el artista que compra, con el nombre de su perfil, y no se puede cambiar ni transferir.',
                    'Te permite tatuar el diseño una sola vez a un cliente y cobrar esa sesión como cualquier trabajo.',
                    'Podés publicar fotos del tatuaje terminado en tu portafolio y en tus redes, siempre dando crédito al autor del diseño.',
                    'El original y el stencil son para preparar esa sesión. No podés compartirlos con otros tatuadores ni usarlos con otro cliente.',
                    'No es exclusiva: el autor puede seguir vendiendo el diseño a otras personas.',
                    'No permite reventa, merch ni otros usos comerciales del diseño fuera de esa sesión.'
                ]
            },
            exclusive: {
                title: 'Licencia Exclusiva',
                clauses: [
                    'Es una venta única. Solo se ofrece mientras el diseño no tenga licencias vigentes ni pedidos pendientes. Cuando se confirma el pago, el diseño se retira de la Store para siempre y no se vuelve a vender.',
                    'El titular es la persona que figura en la licencia. Por defecto es quien compra, y se puede cambiar al hacer el pedido.',
                    'Te permite tatuar el diseño una sola vez: en el cuerpo del titular o, si comprás con una cuenta de artista, a tu cliente. En ese caso podés cobrar esa sesión.',
                    'Podés compartir el stencil con el tatuador que te va a tatuar, solo para esa sesión. Ese tatuador no puede guardar, reutilizar ni volver a compartir los archivos.',
                    'Exclusiva quiere decir que el autor no vuelve a vender el diseño. El autor conserva la autoría y puede seguir mostrándolo en su portafolio.',
                    'No permite reventa, merch ni ningún otro uso comercial del diseño más allá de esa sesión.'
                ]
            },
            common: {
                title: 'Reglas para todas las licencias',
                clauses: [
                    'La autoría y los derechos morales del diseño son del artista que lo creó. La licencia es un permiso de uso: no transfiere la propiedad intelectual.',
                    'El autor puede seguir mostrando el diseño en su portafolio y en sus redes.',
                    'Uso único: cada licencia cubre un solo tatuaje. Cuando lo hagas, marcá la licencia como usada; la verificación pública va a mostrar la fecha de uso.',
                    'Si publicás fotos del tatuaje, dale crédito al autor del diseño, por ejemplo con su usuario de We Ötzi.',
                    'Está prohibido revender, sublicenciar o redistribuir los archivos (original y stencil), compartirlos más allá de lo que permite tu nivel y usarlos para entrenar o alimentar modelos de inteligencia artificial.',
                    'Cada licencia tiene un código WOL-XXXX-XXXX que cualquiera puede verificar en We Ötzi. Si el pedido se reembolsa, la licencia se revoca y deja de ser válida.',
                    'Los archivos se descargan desde tu cuenta con enlaces temporales. Guardalos en un lugar seguro: son para tu uso, no para publicarlos.'
                ]
            }
        }
    };

    // Lo que trae cada compra de diseño (§3).
    var DESIGN_INCLUDES = [
        { key: 'original', label: 'Original', detail: 'El archivo del diseño a calidad completa.' },
        { key: 'stencil', label: 'Stencil', detail: 'Listo para imprimir. Si el diseño tiene medidas, lo podés imprimir a escala real.' },
        { key: 'certificate', label: 'Certificado', detail: 'Imprimible, con el código de verificación de la licencia.' }
    ];

    var AUTHORSHIP_ATTESTATION = 'Confirmo que los diseños son de mi autoría y no infringen derechos de terceros.';

    /* ------------------------------ archivos ------------------------------ */

    // IDÉNTICOS a la migración (los fija tests/store-schema.test.js).
    var FILES = {
        PREVIEW_BUCKET: 'store-previews',
        DESIGN_BUCKET: 'store-design-files',
        PREVIEW_MAX_BYTES: 3145728,      // 3 MB
        ORIGINAL_MAX_BYTES: 52428800,    // 50 MB
        STENCIL_MAX_BYTES: 20971520,     // 20 MB
        SOURCE_MAX_BYTES: 26214400,      // 25 MB: foto de origen antes de la marca de agua
        PREVIEW_MIME: ['image/jpeg', 'image/webp', 'image/png'],
        ORIGINAL_MIME: ['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'application/pdf', 'image/vnd.adobe.photoshop', 'application/postscript', 'application/zip'],
        STENCIL_MIME: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
        SOURCE_MIME: ['image/jpeg', 'image/webp', 'image/png', 'image/heic', 'image/heif'],
        // Stencils que se pueden «Imprimir a escala real» (si hay medidas en cm).
        PRINTABLE_MIME: ['image/png', 'image/jpeg', 'image/webp'],
        EXTENSION_MIME: {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            tif: 'image/tiff', tiff: 'image/tiff',
            pdf: 'application/pdf',
            psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop',
            ai: 'application/postscript', eps: 'application/postscript', ps: 'application/postscript',
            procreate: 'application/zip', zip: 'application/zip',
            heic: 'image/heic', heif: 'image/heif',
            gif: 'image/gif', svg: 'image/svg+xml'
        }
    };

    // MIME que los navegadores reportan con otros nombres.
    var MIME_ALIASES = {
        'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg',
        'image/x-png': 'image/png',
        'image/x-tiff': 'image/tiff',
        'image/psd': 'image/vnd.adobe.photoshop', 'image/x-photoshop': 'image/vnd.adobe.photoshop',
        'application/photoshop': 'image/vnd.adobe.photoshop', 'application/x-photoshop': 'image/vnd.adobe.photoshop',
        'application/psd': 'image/vnd.adobe.photoshop',
        'application/illustrator': 'application/postscript', 'application/eps': 'application/postscript',
        'image/eps': 'application/postscript', 'image/x-eps': 'application/postscript',
        'application/x-zip-compressed': 'application/zip', 'application/x-zip': 'application/zip'
    };

    /* ------------------------------- errores ------------------------------- */

    // Un copy por cada código `store:<código>` de la §4.
    var ERROR_COPY = {
        not_authenticated: 'Ingresá a tu cuenta para continuar.',
        forbidden: 'No tenés permiso para hacer esto.',
        not_found: 'No encontramos lo que buscás. Puede que ya no exista.',
        product_unavailable: 'Este producto ya no está disponible.',
        product_reserved: 'Este diseño está reservado por un pedido de exclusiva en curso. Volvé a mirarlo más tarde.',
        exclusive_unavailable: 'La licencia exclusiva ya no está disponible para este diseño.',
        tier_unavailable: 'Este nivel de licencia no está disponible para este diseño.',
        artist_tier_requires_artist: 'La licencia Artista es solo para cuentas de artista con el registro completo.',
        own_product: 'No podés comprar tus propios productos.',
        design_no_longer_available: 'Este diseño ya no está disponible: se vendió con licencia exclusiva.',
        email_unconfirmed: 'Confirmá tu email antes de comprar. Revisá tu bandeja de entrada.',
        too_many_pending: 'Tenés demasiados pedidos esperando pago. Pagá o cancelá alguno antes de crear otro.',
        pending_order_exists: 'Ya tenés un pedido de este producto esperando pago. Lo encontrás en Mis compras.',
        exclusive_cooldown: 'Hace poco dejaste vencer o cancelaste una reserva de este diseño. Vas a poder reservarlo de nuevo en unos días.',
        variant_required: 'Elegí una variante: talle, color o modelo.',
        variant_unavailable: 'Esa variante ya no está disponible.',
        out_of_stock: 'No hay stock suficiente para esa cantidad.',
        invalid_quantity: 'Elegí una cantidad entre 1 y 20.',
        pickup_unavailable: 'Este producto no se puede retirar en el estudio.',
        shipping_address_invalid: 'Revisá la dirección de envío: faltan datos o el país no es válido.',
        ships_to_unsupported: 'El vendedor no hace envíos a ese país.',
        seller_not_ready: 'El vendedor todavía no terminó de configurar su Store. Probá más tarde.',
        terms_version_mismatch: 'Los términos de la licencia se actualizaron. Recargá la página y volvé a aceptarlos.',
        invalid_status: 'El pedido cambió de estado. Recargá la página para ver la información actualizada.',
        order_not_payable: 'Este pedido ya no se puede pagar: venció o se canceló.',
        collector_mismatch: 'Este pago lo tiene que confirmar quien lo cobra. Revisá quién cobra el pedido.',
        payment_reported: 'Ya hay un pago informado para este pedido. Para cancelarlo, escribile a soporte.',
        cannot_reopen: 'No se puede reabrir el pedido: el stock o la reserva ya no están disponibles.',
        tracking_required: 'Cargá el código de seguimiento para marcar el pedido como enviado.',
        invalid_tracking_url: 'El link de seguimiento tiene que empezar con https://.',
        stock_changed: 'El stock cambió mientras lo editabas. Recargá y volvé a intentarlo.',
        checklist_incomplete: 'Completá el checklist de publicación antes de publicar.',
        asset_licensed: 'No podés borrar este archivo: el diseño ya tiene licencias vendidas.',
        asset_missing: 'No encontramos el archivo subido. Volvé a subirlo.',
        invalid_image_path: 'Una de las imágenes no es válida. Volvé a subirla.',
        download_limit: 'Llegaste al límite de descargas de hoy para esta licencia. Probá de nuevo mañana.',
        license_revoked: 'Esta licencia fue revocada y ya no es válida.',
        license_used: 'Esta licencia ya se marcó como usada.'
    };
    var ERROR_CODES = Object.keys(ERROR_COPY);
    var DEFAULT_ERROR = 'No pudimos completar la acción. Probá de nuevo en unos minutos.';

    /* ------------------------------------------------------------------ */
    /* Utilidades                                                          */
    /* ------------------------------------------------------------------ */

    function num(value) {
        if (value === null || value === undefined || value === '') return NaN;
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isFinite(n) ? n : NaN;
    }
    function isPositive(value) { var n = num(value); return isFinite(n) && n > 0; }
    function round2(n) { return Math.round(n * 100) / 100; }
    function upper(code, fallback) { return String(code || fallback || 'USD').trim().toUpperCase(); }
    function hasText(value) { return typeof value === 'string' ? value.trim().length > 0 : value != null && String(value).trim().length > 0; }
    function asArray(value) { return Array.isArray(value) ? value : []; }
    function text(value) { return value == null ? '' : String(value).trim(); }
    function time(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return value;
        if (value instanceof Date) return value.getTime();
        var t = Date.parse(value);
        return isNaN(t) ? null : t;
    }
    function nowMs(now) { var t = time(now); return t == null ? Date.now() : t; }
    function globalValue(name) {
        if (root && root[name]) return root[name];
        if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
        return null;
    }

    function tierById(id) {
        for (var i = 0; i < LICENSE_TIERS.length; i++) if (LICENSE_TIERS[i].id === id) return LICENSE_TIERS[i];
        return null;
    }
    function tierPrice(product, tier) {
        var meta = tierById(tier);
        if (!meta || !product) return null;
        var n = num(product[meta.priceField]);
        return isFinite(n) && n > 0 ? round2(n) : null;
    }
    function statusLabel(status) { return STATUS_LABELS[status] || ''; }
    function statusTag(status) { return STATUS_TAGS[status] || 'wo-tag'; }

    /* ------------------------------ fechas ------------------------------ */

    var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function toDate(value) {
        if (value == null || value === '') return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
        var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    // "12 nov 2026"
    function formatDate(value) {
        var d = toDate(value);
        return d ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : '';
    }
    // "12 nov 2026 · 14:30"
    function formatDateTime(value) {
        var d = toDate(value);
        if (!d) return '';
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        return formatDate(d) + ' · ' + hh + ':' + mm;
    }

    /* ------------------------------ montos ------------------------------ */

    // Decimales de la moneda: los toma del catálogo de WeOtziCurrency si está
    // cargado (CLP = 0); si no, 2. No usa convert/formatForDisplay a propósito.
    function currencyDecimals(code) {
        var C = globalValue('WeOtziCurrency');
        if (C && typeof C.get === 'function') {
            try {
                var meta = C.get(code);
                if (meta && typeof meta.decimals === 'number' && meta.decimals >= 0 && meta.decimals <= 4) return meta.decimals;
            } catch (e) { /* catálogo no listo */ }
        }
        return 2;
    }

    // 50 → "USD 50" · 65000 → "ARS 65.000" · 1240.5 → "USD 1.240,50".
    function formatMoney(amount, currency) {
        var n = num(amount);
        if (!isFinite(n)) return '—';
        var code = upper(currency);
        var decimals = currencyDecimals(code);
        var factor = Math.pow(10, decimals);
        var negative = n < 0;
        var abs = Math.round(Math.abs(n) * factor) / factor;
        var whole = Math.floor(abs);
        var frac = Math.round((abs - whole) * factor);
        var grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        var body = grouped + (decimals && frac ? ',' + String(frac).padStart(decimals, '0') : '');
        return code + ' ' + (negative ? '−' : '') + body;
    }

    // "1.240,50" | "1240.5" | "1,240.50" → 1240.5 · "-5" → -5 (NaN si no es
    // válido). El signo se conserva para que la validación rechace negativos.
    function parseAmount(input) {
        if (typeof input === 'number') return isFinite(input) ? round2(input) : NaN;
        var negative = /^\s*[-−]/.test(String(input == null ? '' : input));
        var n = parseUnsigned(input);
        return negative && isFinite(n) ? -n : n;
    }
    function parseUnsigned(input) {
        var s = String(input == null ? '' : input).replace(/[^\d.,]/g, '');
        if (!s || !/\d/.test(s)) return NaN;
        var hasComma = s.indexOf(',') !== -1, hasDot = s.indexOf('.') !== -1;
        var normalized = s;
        if (hasComma && hasDot) {
            var dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
            normalized = s.replace(dec === ',' ? /\./g : /,/g, '').replace(dec, '.');
        } else if (hasComma) {
            normalized = s.match(/,/g).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (hasDot) {
            var parts = s.split('.');
            normalized = (parts.length > 2 || parts[parts.length - 1].length === 3) ? s.replace(/\./g, '') : s;
        }
        var n = parseFloat(normalized);
        return isFinite(n) ? round2(n) : NaN;
    }

    /* ------------------------------------------------------------------ */
    /* Precios y niveles                                                   */
    /* ------------------------------------------------------------------ */

    function findVariant(product, variantId) {
        if (!variantId) return null;
        var list = asArray(product && product.variants);
        for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(variantId)) return list[i];
        return null;
    }

    // Precio unitario desde los datos del producto (la RPC recalcula igual).
    // Diseño: precio del nivel (null si no se ofrece). Merch: override de la
    // variante o precio base (null si la variante no existe).
    function unitPriceFor(product, opts) {
        opts = opts || {};
        if (!product) return null;
        if (product.kind === 'design') return tierPrice(product, opts.tier);
        if (opts.variantId) {
            var variant = findVariant(product, opts.variantId);
            if (!variant) return null;
            var override = num(variant.price_amount);
            if (isFinite(override) && override > 0) return round2(override);
        }
        var base = num(product.price_amount);
        return isFinite(base) && base > 0 ? round2(base) : null;
    }

    // Unidades que se pueden pedir de una variante: stock (fila del vendedor),
    // low_stock (RPC pública, solo si ≤5) o sin límite.
    function variantAvailable(variant) {
        if (!variant || variant.active === false || variant.in_stock === false) return 0;
        if (variant.stock != null) return Math.max(0, num(variant.stock) || 0);
        if (variant.low_stock != null) return Math.max(0, num(variant.low_stock) || 0);
        return Infinity;
    }

    // Totales del pedido que va a crear el checkout. El envío es por pedido
    // (no por unidad) y solo cuenta con el método `shipping`. `error` es el
    // código store:* que devolvería create_store_order con esos datos.
    function orderTotals(product, opts) {
        opts = opts || {};
        var p = product || {};
        var isDesign = p.kind === 'design';
        var method = isDesign ? 'digital' : (opts.method === 'pickup' ? 'pickup' : 'shipping');
        var quantity = isDesign ? 1 : Math.floor(num(opts.quantity == null ? 1 : opts.quantity));
        var unit = unitPriceFor(p, opts);
        var out = {
            currency: upper(p.currency),
            method: method,
            unitPrice: unit,
            quantity: quantity,
            subtotal: null,
            shipping: 0,
            total: null,
            valid: false,
            error: null
        };
        var error = null;
        if (isDesign) {
            if (unit == null) error = 'tier_unavailable';
        } else {
            var variant = opts.variantId ? findVariant(p, opts.variantId) : null;
            if (!opts.variantId && asArray(p.variants).length) error = 'variant_required';
            else if (opts.variantId && (!variant || variant.active === false)) error = 'variant_unavailable';
            else if (unit == null) error = 'product_unavailable';
            else if (!(quantity >= 1 && quantity <= LIMITS.MAX_QUANTITY)) error = 'invalid_quantity';
            else if (variant && quantity > variantAvailable(variant)) error = 'out_of_stock';
            else if (method === 'pickup' && !p.pickup_available) error = 'pickup_unavailable';
        }
        if (unit != null && quantity >= 1) {
            if (method === 'shipping') {
                var ship = num(p.shipping_price_amount);
                out.shipping = isFinite(ship) && ship > 0 ? round2(ship) : 0;
            }
            out.subtotal = round2(unit * quantity);
            out.total = round2(out.subtotal + out.shipping);
        }
        out.error = error;
        out.valid = !error && out.total != null;
        return out;
    }

    // «Desde …»: usa price_from de la RPC pública si viene; si no, el mínimo
    // entre niveles ofrecidos (diseño) o variantes activas (merch).
    function priceFrom(product) {
        if (!product) return null;
        var given = num(product.price_from);
        if (isFinite(given) && given > 0) return round2(given);
        var prices = [];
        if (product.kind === 'design') {
            TIER_IDS.forEach(function (t) { var v = tierPrice(product, t); if (v != null) prices.push(v); });
        } else {
            var base = num(product.price_amount);
            var variants = asArray(product.variants).filter(function (v) { return v && v.active !== false; });
            if (variants.length) {
                variants.forEach(function (v) {
                    var o = num(v.price_amount);
                    var price = isFinite(o) && o > 0 ? o : base;
                    if (isFinite(price) && price > 0) prices.push(round2(price));
                });
            } else if (isFinite(base) && base > 0) prices.push(round2(base));
        }
        return prices.length ? Math.min.apply(null, prices) : null;
    }

    // Precio base del merch. La ficha pública trae price_from y el override de
    // cada variante, pero no siempre price_amount: si falta, se deduce cuando
    // es exacto (ninguna variante con override por debajo de price_from).
    // exact = false → el precio de las variantes que heredan es «desde».
    // Variantes vendibles: la ficha pública solo trae activas; en la fila del
    // vendedor se descartan las que tienen active = false (como priceFrom).
    function activeVariants(p) {
        return asArray(p && p.variants).filter(function (v) { return v && v.active !== false; });
    }
    function merchPricing(product) {
        var p = product || {};
        var base = num(p.price_amount);
        if (base > 0) return { base: round2(base), exact: true };
        var variants = activeVariants(p);
        var overrides = [];
        var inherits = !variants.length;
        variants.forEach(function (v) {
            var o = num(v && v.price_amount);
            if (o > 0) overrides.push(o);
            else inherits = true;
        });
        if (!inherits) return { base: null, exact: true };
        var from = num(p.price_from);
        if (!(from > 0)) return { base: null, exact: false };
        var minOverride = overrides.length ? Math.min.apply(null, overrides) : Infinity;
        return { base: round2(from), exact: minOverride > from };
    }

    function currencyOf(product) { return text(product && product.currency).toUpperCase() || 'USD'; }

    // Precio de cards y bandas: { amount, from, label }. «Desde USD 35» solo si
    // hay varios precios posibles (niveles o variantes) o alguno es aproximado;
    // si no, el precio solo («USD 400»). Sin precios: «Desde» + priceFrom.
    // Misma lógica que la vitrina (store-catalog priceSummary).
    function priceLabel(product) {
        var p = product || {};
        var prices = [];
        var approx = false;
        if (p.kind === 'design') {
            LICENSE_TIERS.forEach(function (tier) {
                var v = num(p[tier.priceField]);
                if (v > 0) prices.push(round2(v));
            });
        } else {
            var variants = activeVariants(p);
            if (variants.length) {
                var pricing = null;
                variants.forEach(function (v) {
                    var o = num(v && v.price_amount);
                    if (o > 0) { prices.push(round2(o)); return; }
                    pricing = pricing || merchPricing(p);
                    if (pricing.base == null) return;
                    prices.push(pricing.base);
                    if (!pricing.exact) approx = true;
                });
            } else {
                var base = merchPricing(p).base;
                if (base != null) prices.push(base);
            }
        }
        if (!prices.length) {
            var from = priceFrom(p);
            return from == null
                ? { amount: null, from: false, label: '' }
                : { amount: from, from: true, label: 'Desde ' + formatMoney(from, currencyOf(p)) };
        }
        var min = Math.min.apply(null, prices);
        var several = approx || prices.some(function (x) { return x !== min; });
        return { amount: min, from: several, label: (several ? 'Desde ' : '') + formatMoney(min, currencyOf(p)) };
    }

    // Reservado: `reserved` de la RPC pública o reserved_order_id en la fila
    // del vendedor. Misma condición que frena la compra (create_store_order →
    // product_reserved): la reserva se libera al cerrar o confirmar el pedido,
    // no al pasar reserved_until (un pago informado la extiende). Un segundo
    // argumento (el `now` de antes) se ignora.
    function isReserved(product) {
        if (!product) return false;
        if (product.reserved === true) return true;
        return product.reserved_order_id != null && product.reserved_order_id !== '';
    }

    // Niveles para la ficha: siempre los tres, en orden, con motivo si no se
    // pueden comprar. `code` es el error store:* que daría la RPC.
    function availableTiers(product, opts) {
        opts = opts || {};
        var p = product || {};
        var inactive = p.status && p.status !== 'active';
        var reserved = isReserved(p);
        var licensed = num(p.licenses_issued) > 0;
        return LICENSE_TIERS.map(function (tier) {
            var price = tierPrice(p, tier.id);
            var row = { id: tier.id, label: tier.label, price: price, available: false, reason: null, code: null };
            if (price == null) { row.code = 'tier_unavailable'; row.reason = 'El artista no ofrece este nivel.'; return row; }
            if (inactive) { row.code = 'product_unavailable'; row.reason = 'Este diseño no está a la venta.'; return row; }
            if (opts.viewerIsSeller) { row.code = 'own_product'; row.reason = 'Es un diseño de tu Store.'; return row; }
            if (reserved) { row.code = 'product_reserved'; row.reason = 'Reservado: hay un pedido de exclusiva en curso.'; return row; }
            if (tier.id === 'exclusive' && (licensed || p.exclusive_available === false || p.exclusive_sold_at)) {
                row.code = 'exclusive_unavailable';
                row.reason = licensed ? 'Ya no está disponible: el diseño tiene licencias vendidas.' : 'La exclusiva ya no está disponible.';
                return row;
            }
            if (tier.requiresArtist && !opts.viewerIsArtist) { row.code = 'artist_tier_requires_artist'; row.reason = 'Solo para cuentas de artista'; return row; }
            row.available = true;
            return row;
        });
    }

    // Badges de las cards de la vitrina.
    function productBadges(product, opts) {
        var p = product || {};
        var out = [];
        if (p.kind === 'design') {
            if (isReserved(p)) out.push({ key: 'reserved', label: 'Reservado', tag: 'wo-tag wo-tag--highlight' });
            else if (p.exclusive_available === true || (p.exclusive_available == null && tierPrice(p, 'exclusive') != null && !(num(p.licenses_issued) > 0))) {
                out.push({ key: 'exclusive', label: 'Exclusiva disponible', tag: 'wo-tag wo-tag--filled' });
            }
        } else {
            var variants = asArray(p.variants).filter(function (v) { return v && v.active !== false; });
            var inStock = variants.filter(function (v) { return v.in_stock !== false && !(v.stock != null && num(v.stock) <= 0); });
            if (variants.length && !inStock.length) out.push({ key: 'sold_out', label: 'Agotado', tag: 'wo-tag wo-tag--archived' });
            else if (inStock.length) {
                var counts = inStock.map(function (v) {
                    if (v.low_stock != null) return num(v.low_stock);
                    if (v.stock != null && num(v.stock) <= LIMITS.LOW_STOCK) return num(v.stock);
                    return NaN;
                });
                if (counts.every(function (c) { return isFinite(c) && c > 0; })) {
                    var total = counts.reduce(function (a, b) { return a + b; }, 0);
                    out.push({ key: 'low_stock', label: total === 1 ? 'Última unidad' : 'Últimas ' + total + ' unidades', tag: 'wo-tag wo-tag--urgent' });
                }
            }
        }
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* Envío (§6 update_store_order_fulfillment)                           */
    /* ------------------------------------------------------------------ */

    var FLOWS = {
        digital: ['unfulfilled', 'delivered'],
        shipping: ['unfulfilled', 'preparing', 'shipped', 'delivered'],
        pickup: ['unfulfilled', 'preparing', 'ready_for_pickup', 'delivered']
    };

    var STEP_ACTIONS = {
        preparing: 'Marcar en preparación',
        shipped: 'Marcar enviado',
        ready_for_pickup: 'Marcar listo para retirar',
        delivered: 'Marcar entregado'
    };

    // Predicado store_order_uses_wallet(o): vendedor artista y cobro de la
    // plataforma o de un proveedor. Antes del pago, el cobrador esperado.
    function usesWallet(order) {
        if (!order || order.seller_type !== 'artist') return false;
        var collector = order.payment_collected_by || order.expected_collector;
        return collector === 'platform' || collector === 'provider';
    }

    // ¿Puede `actor` mover el envío de `from` a `to`?
    //   - siempre hacia adelante dentro del flujo del método;
    //   - pasos intermedios: vendedor o soporte, con el pedido `paid`;
    //   - `delivered`: comprador o mantenimiento solo desde enviado / listo
    //     para retirar; soporte siempre; el vendedor solo si NO usa wallet;
    //   - digital: solo el sistema (`auto`) al confirmar el pago.
    function canTransitionFulfillment(method, from, to, opts) {
        opts = opts || {};
        var actor = opts.actor || 'seller';
        var flow = FLOWS[method];
        if (!flow || ACTORS.indexOf(actor) === -1) return false;
        var i = flow.indexOf(from), j = flow.indexOf(to);
        if (i === -1 || j === -1 || j <= i) return false;
        if (method === 'digital') return actor === 'auto';
        if (opts.orderStatus && opts.orderStatus !== 'paid') return false;
        if (to === 'delivered') {
            var handOff = method === 'pickup' ? 'ready_for_pickup' : 'shipped';
            if (actor === 'buyer' || actor === 'auto') return from === handOff;
            if (actor === 'support') return true;
            return actor === 'seller' && !opts.usesWallet;
        }
        return actor === 'seller' || actor === 'support';
    }

    // Pasar a `shipped` exige tracking solo si el pedido acredita el wallet.
    function requiresTracking(to, opts) { return to === 'shipped' && !!(opts && opts.usesWallet); }

    // Pasos posibles desde el estado actual. Acepta (method, from, opts) o
    // (order, opts), en cuyo caso deriva método, estado y wallet del pedido.
    function nextFulfillmentSteps(methodOrOrder, fromOrOpts, maybeOpts) {
        var method, from, opts;
        if (methodOrOrder && typeof methodOrOrder === 'object') {
            var order = methodOrOrder;
            opts = Object.assign({ usesWallet: usesWallet(order), orderStatus: order.status }, fromOrOpts || {});
            method = order.fulfillment_method;
            from = order.fulfillment_status || 'unfulfilled';
        } else {
            method = methodOrOrder; from = fromOrOpts; opts = maybeOpts || {};
        }
        var flow = FLOWS[method] || [];
        var actor = opts.actor || 'seller';
        return flow.filter(function (to) { return canTransitionFulfillment(method, from, to, opts); }).map(function (to) {
            var label = to === 'delivered' && actor === 'buyer' ? 'Ya lo recibí →' : STEP_ACTIONS[to];
            return { status: to, label: STATUS_LABELS[to], actionLabel: label, requiresTracking: requiresTracking(to, opts) };
        });
    }

    /* ------------------------------------------------------------------ */
    /* Validación                                                          */
    /* ------------------------------------------------------------------ */

    function isHttpsUrl(value) {
        var s = text(value);
        if (!s || s.length > 500 || !/^https:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(s) || /\s/.test(s)) return false;
        var U = globalValue('URL');
        if (typeof U === 'function') {
            try { return new U(s).protocol === 'https:'; } catch (e) { return false; }
        }
        return true;
    }

    // Checklist de publicación. ESPEJO del guard store_products_guard: si
    // cambia una regla en SQL, cambia acá (y en el test).
    function publishChecklist(product, ctx) {
        ctx = ctx || {};
        var p = product || {};
        var settings = ctx.settings || {};
        var images = asArray(p.images).filter(function (img) { return img && hasText(img.path); });
        var sellerItems = [
            { key: 'payment_instructions', ok: hasText(settings.payment_instructions), label: 'Instrucciones de pago en Ajustes' },
            { key: 'contact_channel', ok: hasText(settings.contact_channel), label: 'Canal de contacto en Ajustes' }
        ];
        var list;
        if (p.kind === 'design') {
            var assets = asArray(ctx.assets || p.assets);
            var hasAsset = function (kind) { return assets.some(function (a) { return a && a.kind === kind; }); };
            list = [
                { key: 'license_price', ok: TIER_IDS.some(function (t) { return tierPrice(p, t) != null; }), label: 'Al menos un nivel de licencia con precio' },
                { key: 'images', ok: images.length > 0, label: 'Al menos una imagen de vista previa' },
                { key: 'original', ok: hasAsset('original'), label: 'Archivo original subido' },
                { key: 'stencil', ok: hasAsset('stencil'), label: 'Stencil subido' }
            ].concat(sellerItems, [
                { key: 'authorship', ok: !!settings.authorship_attested_at, label: 'Declaración de autoría en Ajustes' }
            ]);
        } else {
            var variants = asArray(ctx.variants || p.variants);
            list = [
                { key: 'price', ok: isPositive(p.price_amount), label: 'Precio base' },
                { key: 'variants', ok: variants.some(function (v) { return v && v.active !== false; }), label: 'Al menos una variante activa' },
                { key: 'images', ok: images.length > 0, label: 'Al menos una imagen' }
            ].concat(sellerItems);
            // Retiro: create_store_order exige pickup_address (pickup_unavailable)
            // y la ficha pública no ofrece retiro sin dirección. Es requisito para
            // publicar con retiro: se resuelve cargando la dirección o
            // desactivando el retiro.
            if (p.pickup_available === true) {
                list.push({
                    key: 'pickup_address', ok: hasText(settings.pickup_address), label: 'Dirección de retiro en Ajustes',
                    scope: 'pickup', hint: 'Ofrecés retiro en el estudio: cargá la dirección en Ajustes o desactivá el retiro.'
                });
            }
        }
        return list;
    }
    function checklistComplete(list) { return asArray(list).length > 0 && asArray(list).every(function (i) { return i.ok; }); }

    /* ------------------------------ países ------------------------------ */

    // Todos los códigos ISO 3166-1 alfa-2 asignados (249). Se usan cuando el
    // vendedor no restringe la lista (ships_to_countries vacío = todos) y en el
    // editor para restringirla. Los nombres salen de Intl.DisplayNames('es').
    var COUNTRY_CODES = [
        'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
        'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
        'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
        'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
        'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
        'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP',
        'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
        'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
        'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM',
        'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
        'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
        'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
        'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
    ];

    var COUNTRY_INDEX = {};
    COUNTRY_CODES.forEach(function (c) { COUNTRY_INDEX[c] = true; });

    // ISO-2 → nombre en español («AR» → «Argentina»). Sin Intl.DisplayNames,
    // con un código que no resuelve o que no es un país asignado (Intl también
    // nombra ZZ «Región desconocida», EU, UN, XA…), devuelve el código.
    var regionNames = null;
    function countryName(code) {
        var c = text(code).toUpperCase();
        if (!COUNTRY_INDEX[c]) return c;
        try {
            if (!regionNames && typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
                regionNames = new Intl.DisplayNames(['es'], { type: 'region' });
            }
            var name = regionNames ? regionNames.of(c) : '';
            return name && name !== c ? name : c;
        } catch (e) {
            return c;
        }
    }

    // Opciones para un <select> o una lista de casillas: [{ code, label }]
    // ordenadas por nombre. Sin códigos (o con una lista vacía), los 249.
    function countryOptions(codes) {
        var list = normalizeCountries(codes || []).filter(function (c) { return /^[A-Z]{2}$/.test(c); });
        return (list.length ? list : COUNTRY_CODES.slice()).map(function (c) { return { code: c, label: countryName(c) }; })
            .sort(function (a, b) { return a.label.localeCompare(b.label, 'es'); });
    }

    function normalizeCountries(value) {
        var list = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\s,;]+/);
        var out = [];
        list.forEach(function (c) {
            var code = text(c).toUpperCase();
            if (code && out.indexOf(code) === -1) out.push(code);
        });
        return out;
    }

    // Valida y limpia el formulario del editor. Devuelve { ok, errors, value }
    // donde value es el patch listo para el repo (números parseados, null para
    // vacíos y campos ajenos al tipo anulados, como piden los checks de forma).
    function validateProductDraft(form) {
        var f = form || {};
        var errors = {};
        var value = {};
        var kind = f.kind === 'design' || f.kind === 'merch' ? f.kind : null;
        if (!kind) errors.kind = 'Elegí si es un diseño o un producto de merch.';
        value.kind = kind;

        function str(key, max, opts) {
            var s = text(f[key]);
            if (opts && opts.required && s.length < (opts.min || 1)) errors[key] = opts.message;
            else if (s.length > max) errors[key] = 'Usá hasta ' + max + ' caracteres.';
            value[key] = s || null;
        }
        function money(key, opts) {
            var raw = f[key];
            if (raw === null || raw === undefined || raw === '') { value[key] = null; if (opts.required) errors[key] = opts.message; return; }
            var n = parseAmount(raw);
            if (!isFinite(n)) { errors[key] = 'Ingresá un monto válido.'; value[key] = null; return; }
            if (opts.allowZero ? n < 0 : n <= 0) errors[key] = opts.allowZero ? 'El monto no puede ser negativo.' : 'El precio tiene que ser mayor a cero.';
            else if (n > LIMITS.MAX_PRICE) errors[key] = 'El monto es demasiado alto.';
            value[key] = n;
        }

        var title = text(f.title);
        if (title.length < 2 || title.length > 120) errors.title = 'El título tiene que tener entre 2 y 120 caracteres.';
        value.title = title;
        str('description', 4000);
        str('category', 40);

        var tags = [];
        (Array.isArray(f.tags) ? f.tags : String(f.tags == null ? '' : f.tags).split(',')).forEach(function (t) {
            var tag = text(t).replace(/^#+/, '');
            if (tag && tags.indexOf(tag) === -1) tags.push(tag);
        });
        if (tags.length > LIMITS.MAX_TAGS) errors.tags = 'Usá hasta ' + LIMITS.MAX_TAGS + ' etiquetas.';
        else if (tags.some(function (t) { return t.length > 40; })) errors.tags = 'Cada etiqueta puede tener hasta 40 caracteres.';
        value.tags = tags;

        var currency = upper(f.currency);
        if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Elegí una moneda.';
        value.currency = currency;

        var images = asArray(f.images).filter(function (img) { return img && hasText(img.path); }).map(function (img) {
            return { path: text(img.path), alt: text(img.alt) };
        });
        if (images.length > LIMITS.MAX_IMAGES) errors.images = 'Podés subir hasta ' + LIMITS.MAX_IMAGES + ' imágenes.';
        else if (images.some(function (img) { return img.alt.length > 200; })) errors.images = 'El texto alternativo puede tener hasta 200 caracteres.';
        value.images = images;

        if (kind === 'design') {
            TIER_IDS.forEach(function (t) { money(tierById(t).priceField, { required: false }); });
            ['design_width_cm', 'design_height_cm'].forEach(function (key) {
                var raw = f[key];
                if (raw === null || raw === undefined || raw === '') { value[key] = null; return; }
                var n = parseAmount(raw);
                if (!isFinite(n) || n < 1 || n > 200) { errors[key] = 'Ingresá una medida entre 1 y 200 cm.'; value[key] = null; return; }
                value[key] = Math.round(n * 10) / 10;
            });
            str('design_style', 60);
            str('placement_suggestion', 120);
            // Checks de forma: un diseño no tiene precio base, envío ni retiro.
            value.price_amount = null;
            value.shipping_price_amount = null;
            value.ships_to_countries = [];
            value.ships_to_note = null;
            value.pickup_available = false;
            value.pickup_note = null;
        } else if (kind === 'merch') {
            money('price_amount', { required: false });
            money('shipping_price_amount', { allowZero: true });
            if (value.shipping_price_amount == null) value.shipping_price_amount = 0;
            var countries = normalizeCountries(f.ships_to_countries);
            if (countries.some(function (c) { return !/^[A-Z]{2}$/.test(c); })) errors.ships_to_countries = 'Usá códigos de país de 2 letras, por ejemplo AR, MX o ES.';
            value.ships_to_countries = countries;
            str('ships_to_note', 200);
            value.pickup_available = !!f.pickup_available;
            str('pickup_note', 300);
            // Un merch no tiene precios de licencia ni medidas de diseño.
            TIER_IDS.forEach(function (t) { value[tierById(t).priceField] = null; });
            value.design_width_cm = null;
            value.design_height_cm = null;
            value.design_style = null;
            value.placement_suggestion = null;
        }
        return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
    }

    // Dirección del checkout. Misma regla que create_store_order (recipient,
    // line1, city y país ISO-2 en ships_to_countries si la lista no está vacía).
    function validateShippingAddress(addr, product) {
        var a = addr || {};
        var errors = {};
        var value = {};
        var fields = [
            ['recipient', 120, 'Ingresá quién recibe el envío.'],
            ['line1', 200, 'Ingresá la calle y el número.'],
            ['line2', 200, null],
            ['city', 120, 'Ingresá la ciudad.'],
            ['region', 120, null],
            ['postal_code', 20, null],
            ['phone', 40, null]
        ];
        fields.forEach(function (row) {
            var s = text(a[row[0]]);
            if (!s && row[2]) errors[row[0]] = row[2];
            else if (s.length > row[1]) errors[row[0]] = 'Usá hasta ' + row[1] + ' caracteres.';
            value[row[0]] = s || null;
        });
        var country = text(a.country).toUpperCase();
        value.country = country || null;
        var code = null;
        if (!/^[A-Z]{2}$/.test(country)) errors.country = 'Elegí el país.';
        else {
            var allowed = normalizeCountries(product && product.ships_to_countries);
            if (allowed.length && allowed.indexOf(country) === -1) {
                errors.country = ERROR_COPY.ships_to_unsupported;
                code = 'ships_to_unsupported';
            }
        }
        var ok = Object.keys(errors).length === 0;
        if (!ok && !code) code = 'shipping_address_invalid';
        return { ok: ok, errors: errors, value: value, code: ok ? null : code };
    }

    // Tracking del formulario de envío. Con { required } (pedido con wallet que
    // pasa a enviado) alcanza el código o el link, como en la RPC.
    function validateTracking(input, opts) {
        var t = input || {};
        var errors = {};
        var value = { tracking_carrier: text(t.carrier || t.tracking_carrier) || null, tracking_code: text(t.code || t.tracking_code) || null, tracking_url: text(t.url || t.tracking_url) || null };
        if (value.tracking_carrier && value.tracking_carrier.length > 60) errors.carrier = 'Usá hasta 60 caracteres.';
        if (value.tracking_code && value.tracking_code.length > 80) errors.code = 'Usá hasta 80 caracteres.';
        if (value.tracking_url && !isHttpsUrl(value.tracking_url)) errors.url = ERROR_COPY.invalid_tracking_url;
        if (opts && opts.required && !value.tracking_code && !value.tracking_url) errors.code = ERROR_COPY.tracking_required;
        return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
    }

    /* ------------------------------------------------------------------ */
    /* Errores                                                             */
    /* ------------------------------------------------------------------ */

    var CODE_RE = /store:([a-z_]+)/;

    // Busca `store:<código>` en el mensaje del error, en err.cause (el `run`
    // de postgrest-client envuelve el error original ahí), details y hint.
    function errorCode(err) {
        var seen = 0;
        var unknown = null;
        var queue = [err];
        while (queue.length && seen < 12) {
            var item = queue.shift();
            seen += 1;
            if (item == null) continue;
            var sources = typeof item === 'string' ? [item] : [item.message, item.details, item.hint, item.code, item.error_description];
            for (var i = 0; i < sources.length; i++) {
                var m = CODE_RE.exec(String(sources[i] == null ? '' : sources[i]));
                if (m) {
                    if (ERROR_COPY[m[1]]) return m[1];
                    unknown = unknown || m[1];
                }
            }
            if (typeof item === 'object') {
                if (item.cause) queue.push(item.cause);
                if (item.error) queue.push(item.error);
            }
        }
        return unknown;
    }

    function errorMessage(err, fallback) {
        var code = errorCode(err);
        if (code && ERROR_COPY[code]) return ERROR_COPY[code];
        return fallback || DEFAULT_ERROR;
    }

    /* ------------------------------------------------------------------ */
    /* Vistas                                                              */
    /* ------------------------------------------------------------------ */

    function orderItems(order) { return asArray(order && (order.items || order.store_order_items)); }
    function orderLicenses(order) { return asArray(order && (order.licenses || order.store_licenses)); }

    var FULFILLMENT_RANK = { unfulfilled: 0, preparing: 1, shipped: 2, ready_for_pickup: 2, delivered: 3 };

    function buildTimeline(order, method) {
        var o = order || {};
        var status = o.status;
        var rank = FULFILLMENT_RANK[o.fulfillment_status] || 0;
        var paid = !!o.paid_at || status === 'paid' || status === 'fulfilled';
        var steps = [{ key: 'created', label: 'Pedido creado', at: o.created_at || null, done: true }];
        if (o.buyer_payment_reported_at) steps.push({ key: 'reported', label: 'Pago informado', at: o.buyer_payment_reported_at, done: true });
        steps.push({ key: 'paid', label: 'Pago confirmado', at: o.paid_at || null, done: paid });
        if (method === 'digital') {
            steps.push({ key: 'delivered', label: 'Licencia emitida', at: o.delivered_at || null, done: o.fulfillment_status === 'delivered' });
        } else {
            steps.push({ key: 'preparing', label: 'En preparación', at: null, done: paid && rank >= 1 });
            if (method === 'pickup') steps.push({ key: 'ready_for_pickup', label: 'Listo para retirar', at: o.ready_at || null, done: paid && rank >= 2 });
            else steps.push({ key: 'shipped', label: 'Enviado', at: o.shipped_at || null, done: paid && rank >= 2 });
            steps.push({ key: 'delivered', label: 'Entregado', at: o.delivered_at || null, done: o.fulfillment_status === 'delivered' });
        }
        var terminal = null;
        if (status === 'cancelled') terminal = { key: 'cancelled', label: 'Cancelado', at: o.cancelled_at || null };
        else if (status === 'expired') terminal = { key: 'expired', label: 'Vencido', at: o.expires_at || null };
        else if (status === 'refunded') terminal = { key: 'refunded', label: 'Reembolsado', at: o.refunded_at || null };
        var marked = false;
        steps.forEach(function (s) {
            s.current = false;
            s.skipped = !!terminal && !s.done;
            if (!terminal && !s.done && !marked) { s.current = true; marked = true; }
        });
        if (terminal) { terminal.done = true; terminal.current = true; terminal.terminal = true; terminal.skipped = false; steps.push(terminal); }
        return steps.map(function (s) { s.atLabel = s.at ? formatDateTime(s.at) : ''; return s; });
    }

    function action(key, label, extra) { return Object.assign({ key: key, label: label, kind: 'action', tone: 'primary' }, extra || {}); }
    function info(key, label) { return { key: key, label: label, kind: 'info', tone: 'info' }; }

    // Vista de un pedido para comprador, vendedor o soporte: labels, tags,
    // timeline, acciones permitidas y la próxima acción sugerida.
    function orderView(order, opts) {
        opts = opts || {};
        var o = order || {};
        var role = opts.role === 'seller' || opts.role === 'support' ? opts.role : 'buyer';
        var now = nowMs(opts.now);
        var item = orderItems(o)[0] || null;
        var license = orderLicenses(o)[0] || null;
        var method = o.fulfillment_method || (item && item.kind === 'design' ? 'digital' : 'shipping');
        var wallet = usesWallet(o);
        var reported = !!o.buyer_payment_reported_at;
        var pending = o.status === 'pending_payment';
        var paid = o.status === 'paid';
        var expiresAt = time(o.expires_at);
        var collector = o.expected_collector || 'seller';
        var currency = upper(o.currency);
        var fulfillment = o.fulfillment_status || 'unfulfilled';
        var tier = item && tierById(item.license_tier);

        var view = {
            id: o.id || null,
            number: o.order_number || '',
            numberLabel: o.order_number ? 'Pedido #' + o.order_number : 'Pedido',
            role: role,
            status: o.status || null,
            statusLabel: statusLabel(o.status),
            statusTag: statusTag(o.status),
            method: method,
            methodLabel: METHOD_LABELS[method] || '',
            fulfillmentStatus: fulfillment,
            fulfillmentLabel: method === 'digital' ? '' : statusLabel(fulfillment),
            fulfillmentTag: statusTag(fulfillment),
            kind: item ? item.kind : null,
            item: item ? {
                title: item.title || '',
                kind: item.kind,
                variantLabel: item.variant_label || null,
                tier: item.license_tier || null,
                tierLabel: tier ? tier.label : null,
                holderName: item.license_holder_name || null,
                quantity: item.quantity || 1,
                unitPrice: num(item.unit_price),
                lineTotal: num(item.line_total),
                imagePath: item.image_path || null,
                termsVersion: item.terms_version || null
            } : null,
            license: license ? licenseView(license, { now: now }) : null,
            currency: currency,
            totals: {
                subtotal: num(o.subtotal_amount),
                shipping: num(o.shipping_amount),
                total: num(o.total_amount),
                subtotalLabel: formatMoney(o.subtotal_amount, currency),
                shippingLabel: formatMoney(o.shipping_amount || 0, currency),
                totalLabel: formatMoney(o.total_amount, currency)
            },
            usesWallet: wallet,
            collector: collector,
            paymentReported: reported,
            paymentReference: o.buyer_payment_reference || null,
            expiresAt: o.expires_at || null,
            expiresLabel: o.expires_at ? formatDateTime(o.expires_at) : '',
            overdue: pending && expiresAt != null && expiresAt < now,
            deadlineLabel: pending && o.expires_at ? 'Tenés hasta el ' + formatDateTime(o.expires_at) + ' para pagar.' : '',
            needsSupport: !!(o.metadata_json && o.metadata_json.needs_support),
            fundsHold: !!o.funds_hold,
            tracking: (o.tracking_code || o.tracking_url || o.tracking_carrier) ? { carrier: o.tracking_carrier || null, code: o.tracking_code || null, url: isHttpsUrl(o.tracking_url) ? o.tracking_url : null } : null,
            timeline: buildTimeline(o, method),
            actions: [],
            nextAction: null
        };

        var actions = view.actions;
        var steps = paid && method !== 'digital' ? nextFulfillmentSteps(method, fulfillment, { actor: role, usesWallet: wallet, orderStatus: o.status }) : [];

        if (role === 'buyer') {
            if (pending) {
                // report_store_payment rechaza un pedido vencido (order_not_payable),
                // con o sin pago informado: no se ofrece informar ni actualizar.
                if (!view.overdue) actions.push(action('report_payment', reported ? 'Actualizar comprobante →' : 'Ya pagué →'));
                if (!reported) actions.push(action('cancel', 'Cancelar pedido', { tone: 'ghost' }));
            }
            steps.forEach(function (s) { if (s.status === 'delivered') actions.push(action('confirm_received', 'Ya lo recibí →')); });
            if (method === 'digital' && license && !view.license.revoked) {
                actions.push(action('view_license', 'Ver certificado →', { tone: 'ghost' }));
                if (view.license.canMarkUsed) actions.push(action('mark_license_used', 'Marcar licencia como usada', { tone: 'ghost' }));
            }
            if (pending && !reported && view.overdue) view.nextAction = info('payment_overdue', 'Venció el plazo para pagar este pedido.');
            else if (pending && !reported) view.nextAction = actions[0];
            else if (pending) view.nextAction = info('awaiting_confirmation', collector === 'seller' ? 'Informaste el pago. El vendedor lo tiene que confirmar.' : 'Informaste el pago. We Ötzi lo tiene que confirmar.');
            else if (paid && steps.length) view.nextAction = actions.filter(function (a) { return a.key === 'confirm_received'; })[0] || null;
            else if (paid && method !== 'digital') view.nextAction = info('preparing', 'El vendedor está preparando tu pedido.');
            else if (o.status === 'fulfilled' && license && view.license.canMarkUsed) view.nextAction = actions.filter(function (a) { return a.key === 'view_license'; })[0] || null;
        } else {
            // Vencido sin pago informado: store_apply_order_payment lo rechaza
            // (order_not_payable), así que no se ofrece confirmar; queda cancelar.
            var canConfirm = pending && !(view.overdue && !reported) && (role === 'support' ? collector !== 'provider' : collector === 'seller');
            if (canConfirm) actions.push(action('confirm_payment', 'Confirmar pago recibido'));
            if (role === 'support' && o.status === 'expired' && collector !== 'provider') actions.push(action('confirm_payment', 'Reabrir y confirmar pago', { tone: 'ghost' }));
            if (pending && (!reported || role === 'support')) actions.push(action('cancel', 'Cancelar pedido', { tone: 'ghost' }));
            // cancel_store_order: con pago informado, el vendedor que cobra directo
            // puede cancelar cuando venció el plazo («no recibí el pago»).
            else if (pending && role === 'seller' && collector === 'seller' && view.overdue) {
                actions.push(action('cancel', 'No recibí el pago', { tone: 'ghost', reason: 'payment_not_received' }));
            }
            steps.forEach(function (s) { actions.push(action('fulfillment', s.actionLabel, { status: s.status, requiresTracking: s.requiresTracking })); });
            // La RPC acepta repetir `shipped` para corregir el seguimiento.
            if (paid && method === 'shipping' && fulfillment === 'shipped') actions.push(action('edit_tracking', 'Editar seguimiento', { tone: 'ghost', status: 'shipped' }));
            var refundable = o.status === 'paid' || o.status === 'fulfilled';
            if (refundable && role === 'support') actions.push(action('refund', 'Reembolsar', { tone: 'danger' }));
            if (refundable && role === 'seller' && o.payment_collected_by === 'seller' && (method === 'digital' || fulfillment === 'unfulfilled' || fulfillment === 'preparing')) {
                actions.push(action('refund', 'Reembolsar', { tone: 'danger', confirm: 'Confirmá que ya le devolviste el dinero.' }));
            }
            if (role === 'support' && wallet && refundable && !o.funds_released_at) {
                actions.push(action('funds_hold', o.funds_hold ? 'Liberar retención' : 'Retener fondos', { tone: 'ghost', hold: !o.funds_hold }));
            }
            if (pending && canConfirm) view.nextAction = actions[0];
            else if (pending && role === 'seller' && collector !== 'seller') view.nextAction = info('platform_confirms', 'We Ötzi confirma este pago cuando lo recibe.');
            else if (steps.length) view.nextAction = actions.filter(function (a) { return a.key === 'fulfillment'; })[0] || null;
            else if (paid && wallet && (fulfillment === 'shipped' || fulfillment === 'ready_for_pickup')) view.nextAction = info('awaiting_delivery', 'Esperando que el comprador confirme la entrega.');
            if (role === 'support' && view.needsSupport && !view.nextAction) view.nextAction = info('needs_support', 'Pedido marcado para revisión de soporte.');
        }
        return view;
    }

    // Vista de una licencia: fila de store_licenses o resultado público de
    // verify_store_license (que trae holder_initials en lugar del nombre).
    function licenseView(license, opts) {
        var l = license || {};
        var tier = tierById(l.tier);
        var revoked = !!(l.revoked_at || l.revoked === true);
        var usedAt = l.used_at || null;
        var used = !!(usedAt || l.used === true);
        var notFound = l.valid === false && !revoked;
        var code = l.verification_code || l.code || null;
        var status;
        if (revoked) status = { key: 'revoked', label: 'Revocada', tag: 'wo-tag wo-tag--urgent' };
        else if (notFound) status = { key: 'invalid', label: 'Código no válido', tag: 'wo-tag wo-tag--urgent' };
        else if (used) status = { key: 'used', label: usedAt ? 'Usada el ' + formatDate(usedAt) : 'Usada', tag: 'wo-tag wo-tag--archived' };
        else status = { key: 'available', label: 'Uso disponible', tag: 'wo-tag wo-tag--active' };
        var username = l.seller_username || null;
        var version = l.terms_version || TERMS_VERSION;
        return {
            id: l.id || null,
            code: code,
            tier: l.tier || null,
            tierLabel: tier ? tier.label : '',
            tierSummary: tier ? tier.summary : '',
            holderName: l.holder_name || l.holder_initials || '',
            holderInitials: l.holder_initials || initials(l.holder_name),
            designTitle: l.design_title || '',
            sellerName: l.seller_display_name || '',
            sellerUsername: username,
            sellerHandle: username ? '@' + username.replace(/^@+/, '') : '',
            issuedAt: l.issued_at || null,
            issuedLabel: formatDate(l.issued_at),
            termsVersion: version,
            termsLabel: 'Licencia v' + version,
            used: used,
            usedAt: usedAt,
            usedLabel: usedAt ? formatDate(usedAt) : '',
            usedNote: l.used_note || null,
            revoked: revoked,
            revokeReason: l.revoke_reason || null,
            valid: !revoked && !notFound,
            status: status.key,
            statusLabel: status.label,
            statusTag: status.tag,
            canMarkUsed: !revoked && !notFound && !used,
            verifyUrl: code ? verifyUrl(code) : null,
            storeUrl: username ? storeUrl(username) : null,
            terms: termsFor(l.tier, version)
        };
    }

    function initials(name) {
        return String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(function (p) { return p.charAt(0).toUpperCase() + '.'; }).join(' ');
    }

    // Textos de un nivel en una versión: { title, clauses, common, version }.
    function termsFor(tier, version) {
        var v = TERMS[version || TERMS_VERSION] || TERMS[TERMS_VERSION];
        var t = v[tier];
        if (!t) return null;
        return { version: v.version, title: t.title, intro: v.intro, clauses: t.clauses.slice(), common: v.common.clauses.slice(), commonTitle: v.common.title };
    }

    // «Leí y acepto la licencia Personal (v2026-10)».
    function termsAcceptanceLabel(tier, version) {
        var meta = tierById(tier);
        return 'Leí y acepto la licencia ' + (meta ? meta.label : '') + ' (v' + (version || TERMS_VERSION) + ')';
    }

    /* ------------------------------------------------------------------ */
    /* Archivos y rutas                                                    */
    /* ------------------------------------------------------------------ */

    function extOf(fileName) {
        var m = /\.([A-Za-z0-9]+)$/.exec(String(fileName || '').trim());
        return m ? m[1].toLowerCase() : '';
    }

    // Content-Type que se manda a Storage. La extensión manda para los formatos
    // que los navegadores no reconocen (psd, ai, eps, procreate llegan con
    // type vacío u octet-stream); después, el type normalizado.
    function contentTypeFor(fileName, fileType) {
        var ext = extOf(fileName);
        if (ext && FILES.EXTENSION_MIME[ext]) return FILES.EXTENSION_MIME[ext];
        var t = String(fileType || '').trim().toLowerCase().split(';')[0];
        if (MIME_ALIASES[t]) return MIME_ALIASES[t];
        return t || 'application/octet-stream';
    }

    var FILE_RULES = {
        preview: { mime: FILES.PREVIEW_MIME, max: FILES.PREVIEW_MAX_BYTES, size: '3 MB', typeError: 'La imagen tiene que ser JPG, PNG o WebP.' },
        original: { mime: FILES.ORIGINAL_MIME, max: FILES.ORIGINAL_MAX_BYTES, size: '50 MB', typeError: 'Formato no admitido. Subí PNG, JPG, WebP, TIFF, PDF, PSD, AI, EPS o Procreate.' },
        stencil: { mime: FILES.STENCIL_MIME, max: FILES.STENCIL_MAX_BYTES, size: '20 MB', typeError: 'El stencil tiene que ser PNG, JPG, WebP o PDF.' },
        source: { mime: FILES.SOURCE_MIME, max: FILES.SOURCE_MAX_BYTES, size: '25 MB', typeError: 'Subí una imagen JPG, PNG, WebP o HEIC.' }
    };

    // kind: preview (blob final a store-previews) | original | stencil |
    // source (foto elegida por el artista, antes de la marca de agua).
    function validateFile(kind, file) {
        var rule = FILE_RULES[kind];
        if (!rule) return { ok: false, code: 'invalid_kind', error: 'Tipo de archivo desconocido.', contentType: null };
        if (!file) return { ok: false, code: 'empty', error: 'Elegí un archivo.', contentType: null };
        var contentType = contentTypeFor(file.name, file.type);
        var size = num(file.size);
        if (!(size > 0)) return { ok: false, code: 'empty', error: 'El archivo está vacío.', contentType: contentType };
        if (rule.mime.indexOf(contentType) === -1) return { ok: false, code: 'invalid_type', error: rule.typeError, contentType: contentType };
        if (size > rule.max) return { ok: false, code: 'too_large', error: 'El archivo pesa más de ' + rule.size + '.', contentType: contentType };
        return { ok: true, code: null, error: null, contentType: contentType };
    }

    // "Mi Diseño Final (v2).PSD" → "Mi-Diseno-Final-v2.psd". Sin barras, sin
    // puntos al inicio ni repetidos, ≤120 caracteres conservando la extensión.
    function sanitizeFilename(name) {
        var s = String(name == null ? '' : name).trim();
        if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
        s = s.replace(/[\\/]+/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-');
        s = s.replace(/^[.\-_]+/, '').replace(/[.\-_]+$/, '');
        var ext = extOf(s);
        var base = ext ? s.slice(0, -(ext.length + 1)) : s;
        base = base.replace(/[.\-_]+$/, '');
        var maxBase = 120 - (ext ? ext.length + 1 : 0);
        if (base.length > maxBase) base = base.slice(0, maxBase).replace(/[.\-_]+$/, '');
        if (!base) base = 'archivo';
        return ext ? base + '.' + ext : base;
    }

    function cleanSegment(value, label) {
        var s = String(value == null ? '' : value).trim();
        if (!s || /[\/\\]/.test(s) || s === '.' || s === '..') throw new Error('store-model: ' + label + ' inválido');
        return s;
    }
    function cleanTs(value) {
        var n = value == null ? Date.now() : Math.floor(num(value));
        if (!isFinite(n) || n < 0) throw new Error('store-model: ts inválido');
        return String(n);
    }

    // <seller_id>/<product_id>/<original|stencil>/<ts>-<nombre>
    function buildAssetPath(sellerId, productId, kind, fileName, ts) {
        if (kind !== 'original' && kind !== 'stencil') throw new Error('store-model: kind de asset inválido');
        return cleanSegment(sellerId, 'sellerId') + '/' + cleanSegment(productId, 'productId') + '/' + kind + '/' + cleanTs(ts) + '-' + sanitizeFilename(fileName);
    }

    var EXT_FOR_MIME = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

    // <seller_id>/<product_id>/<ts>-<n>.<jpg|jpeg|webp|png>
    function buildPreviewPath(sellerId, productId, ts, n, ext) {
        var e = String(ext || '').trim().toLowerCase().replace(/^\./, '');
        if (EXT_FOR_MIME[e]) e = EXT_FOR_MIME[e];
        if (!/^(jpe?g|webp|png)$/.test(e)) throw new Error('store-model: extensión de vista previa inválida');
        var index = Math.floor(num(n == null ? 0 : n));
        if (!isFinite(index) || index < 0) throw new Error('store-model: índice de imagen inválido');
        return cleanSegment(sellerId, 'sellerId') + '/' + cleanSegment(productId, 'productId') + '/' + cleanTs(ts) + '-' + index + '.' + e;
    }

    function extForContentType(contentType) { return EXT_FOR_MIME[String(contentType || '').toLowerCase()] || null; }

    // Igual que artist-profile.js (normalizeUsernameFromUrl): agrega .wo si falta.
    function normalizeUsername(username) {
        var s = String(username == null ? '' : username).trim().replace(/^@+/, '').replace(/\s+/g, '');
        if (!s) return '';
        return /\.wo$/i.test(s) ? s : s + '.wo';
    }

    // Rutas del producto con el base path (/beta, preview). Idempotente.
    function appPath(path) {
        var base = String(globalValue('WEOTZI_BASE_PATH') || '').replace(/\/$/, '');
        var s = String(path || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }

    function query(params) {
        var parts = [];
        Object.keys(params).forEach(function (key) {
            var v = params[key];
            if (v === null || v === undefined || v === '') return;
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
        });
        return parts.length ? '?' + parts.join('&') : '';
    }

    function storeUrl(handle) { return appPath('/store/' + query({ artist: normalizeUsername(handle) })); }
    function itemUrl(id) { return appPath('/store/item/' + query({ id: id })); }
    function checkoutUrl(input) {
        var i = input || {};
        return appPath('/store/checkout/' + query({
            item: i.item || i.productId || i.id,
            license: i.license || i.tier,
            variant: i.variant || i.variantId,
            qty: i.qty || i.quantity
        }));
    }
    function purchasesUrl(orderId) { return appPath('/store/purchases/' + query({ pedido: orderId })); }
    function licenseUrl(id) { return appPath('/store/license/' + query({ id: id })); }
    function verifyUrl(code) {
        var q = {};
        q[VERIFY_PARAM] = normalizeLicenseCode(code) || code;
        return appPath('/store/license/' + query(q));
    }

    var LICENSE_CODE_RE = /^WOL-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    // " wol abcd 1234 " → "WOL-ABCD-1234" (null si no tiene la forma).
    function normalizeLicenseCode(input) {
        var raw = String(input == null ? '' : input).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (raw.indexOf('WOL') === 0) raw = raw.slice(3);
        if (raw.length !== 8) return null;
        var code = 'WOL-' + raw.slice(0, 4) + '-' + raw.slice(4);
        return LICENSE_CODE_RE.test(code) ? code : null;
    }

    /* ------------------------------------------------------------------ */

    return {
        TERMS_VERSION: TERMS_VERSION,
        VERIFY_PARAM: VERIFY_PARAM,
        LIMITS: LIMITS,
        ORDER_STATUSES: ORDER_STATUSES,
        FULFILLMENT_STATUSES: FULFILLMENT_STATUSES,
        PRODUCT_STATUSES: PRODUCT_STATUSES,
        FULFILLMENT_METHODS: FULFILLMENT_METHODS,
        FULFILLMENT_FLOWS: FLOWS,
        STATUS_LABELS: STATUS_LABELS,
        STATUS_TAGS: STATUS_TAGS,
        METHOD_LABELS: METHOD_LABELS,
        KIND_LABELS: KIND_LABELS,
        LICENSE_TIERS: LICENSE_TIERS,
        TIER_IDS: TIER_IDS,
        TERMS: TERMS,
        DESIGN_INCLUDES: DESIGN_INCLUDES,
        AUTHORSHIP_ATTESTATION: AUTHORSHIP_ATTESTATION,
        FILES: FILES,
        ERROR_COPY: ERROR_COPY,
        ERROR_CODES: ERROR_CODES,
        DEFAULT_ERROR: DEFAULT_ERROR,
        LICENSE_CODE_RE: LICENSE_CODE_RE,
        COUNTRY_CODES: COUNTRY_CODES,

        statusLabel: statusLabel,
        statusTag: statusTag,
        tierById: tierById,
        formatMoney: formatMoney,
        parseAmount: parseAmount,
        formatDate: formatDate,
        formatDateTime: formatDateTime,
        unitPriceFor: unitPriceFor,
        orderTotals: orderTotals,
        priceFrom: priceFrom,
        merchPricing: merchPricing,
        priceLabel: priceLabel,
        isReserved: isReserved,
        availableTiers: availableTiers,
        productBadges: productBadges,
        usesWallet: usesWallet,
        canTransitionFulfillment: canTransitionFulfillment,
        nextFulfillmentSteps: nextFulfillmentSteps,
        requiresTracking: requiresTracking,
        publishChecklist: publishChecklist,
        checklistComplete: checklistComplete,
        validateProductDraft: validateProductDraft,
        validateShippingAddress: validateShippingAddress,
        validateTracking: validateTracking,
        isHttpsUrl: isHttpsUrl,
        countryName: countryName,
        countryOptions: countryOptions,
        orderView: orderView,
        licenseView: licenseView,
        termsFor: termsFor,
        termsAcceptanceLabel: termsAcceptanceLabel,
        errorCode: errorCode,
        errorMessage: errorMessage,
        contentTypeFor: contentTypeFor,
        validateFile: validateFile,
        sanitizeFilename: sanitizeFilename,
        buildAssetPath: buildAssetPath,
        buildPreviewPath: buildPreviewPath,
        extForContentType: extForContentType,
        normalizeUsername: normalizeUsername,
        normalizeLicenseCode: normalizeLicenseCode,
        appPath: appPath,
        storeUrl: storeUrl,
        itemUrl: itemUrl,
        checkoutUrl: checkoutUrl,
        purchasesUrl: purchasesUrl,
        licenseUrl: licenseUrl,
        verifyUrl: verifyUrl
    };
}));
