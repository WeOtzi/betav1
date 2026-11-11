/**
 * WE OTZI - Repositorio de la Store del artista (frontend)
 * --------------------------------------------------------
 * Único acceso a datos de la Store (merch y diseños con licencia de uso) sobre
 * la capa PostgREST unificada. Contrato: docs/plans/2026-10-30-store-artista.md
 * (§5 esquema, §6 RPCs, §8.2 repo y §8.6 demo). Migración NO aplicada:
 * supabase/migrations/20261030150000_store_core.sql.
 *
 *   - Columnas explícitas en todas las selects (STORE_SELECTS; un test las corre
 *     contra el emulador del demo). Sin filtros sobre recursos embebidos ni
 *     `overlaps` / `textSearch`.
 *   - Escrituras con run(): el error lleva etiqueta y el `store:<código>` del
 *     SQL viaja en err.cause; lo traduce WeotziStoreModel.errorMessage(err).
 *   - Lecturas públicas (vitrina, ficha y verificación) por RPC: no lanzan,
 *     devuelven null y dejan un warning.
 *   - Preview o demo (isPreviewEnv): ningún método llama a Storage ni al
 *     servidor. Las imágenes quedan como data URL, los archivos de diseño con
 *     path `demo/<producto>/<tipo>/<ts>-<nombre>` y las descargas salen de
 *     /shared/assets/demo/store/.
 *
 * Carga: DESPUÉS de postgrest-client.js y store-model.js (paths, MIME y
 * validaciones). Expone window.WeotziData.Store.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[store-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    function model() { return window.WeotziStoreModel || null; }
    function requireModel() {
        const M = model();
        if (!M) throw new Error('[store-repo] store-model.js debe cargarse antes.');
        return M;
    }

    const PREVIEW_BUCKET = 'store-previews';
    const DESIGN_BUCKET = 'store-design-files';
    const PRODUCT_STATUSES = ['draft', 'active', 'paused', 'retired'];
    const PREVIEW_IMAGE_MAX_SIDE = 900;
    const DEMO_ASSETS = '/shared/assets/demo/store/';
    const RASTER_MIME = ['image/png', 'image/jpeg', 'image/webp'];
    const DAY_MS = 86400000;

    /* ------------------------------ columnas ------------------------------ */
    // Espejo de §5. store_payments solo con las columnas del grant a authenticated.
    const COLS = {
        product: 'id, seller_type, seller_id, kind, status, title, description, category, tags, currency, ' +
            'price_amount, license_personal_price, license_artist_price, license_exclusive_price, ' +
            'design_width_cm, design_height_cm, design_style, placement_suggestion, images, ' +
            'shipping_price_amount, ships_to_countries, ships_to_note, pickup_available, pickup_note, ' +
            'sales_count, licenses_issued, reserved_order_id, reserved_until, exclusive_sold_at, ' +
            'published_at, retired_at, metadata_json, created_at, updated_at',
        variant: 'id, product_id, label, size, color, sku, price_amount, stock, active, sort_order, created_at, updated_at',
        asset: 'id, product_id, kind, storage_path, file_name, mime_type, size_bytes, created_at',
        settings: 'seller_type, seller_id, store_tagline, contact_channel, payment_instructions, shipping_policy, ' +
            'return_policy, pickup_address, authorship_attested_at, created_at, updated_at',
        order: 'id, order_number, seller_type, seller_id, channel, buyer_user_id, buyer_role, buyer_name, buyer_email, ' +
            'buyer_phone, status, fulfillment_method, fulfillment_status, shipping_address, pickup_details, ' +
            'tracking_carrier, tracking_code, tracking_url, currency, subtotal_amount, shipping_amount, total_amount, ' +
            'platform_fee_pct, platform_fee_amount, payment_provider, expected_collector, payment_instructions, ' +
            'seller_contact, buyer_payment_reference, buyer_payment_reported_at, paid_at, payment_collected_by, ' +
            'payment_confirmed_by, expires_at, shipped_at, ready_at, delivered_at, delivered_by, cancelled_at, ' +
            'cancel_reason, refunded_at, funds_release_at, funds_released_at, funds_hold, buyer_note, ' +
            'seller_message, idempotency_key, metadata_json, created_at, updated_at',
        orderBrief: 'id, order_number, status, buyer_user_id, buyer_name, seller_type, seller_id, currency, total_amount, paid_at, created_at',
        item: 'id, order_id, product_id, variant_id, kind, title, variant_label, image_path, license_tier, ' +
            'license_holder_name, terms_version, terms_accepted_at, unit_price, quantity, line_total, created_at',
        payment: 'id, order_id, provider, status, amount, currency, collected_by, reference, created_at',
        license: 'id, order_id, order_item_id, product_id, tier, holder_user_id, holder_name, seller_type, seller_id, ' +
            'seller_display_name, seller_username, design_title, terms_version, verification_code, used_at, used_note, ' +
            'issued_at, revoked_at, revoke_reason, metadata_json, created_at',
        // Notas internas (RLS: solo soporte). Las escriben las RPC.
        supportNote: 'id, order_id, kind, note, actor_id, created_at'
    };
    const STORE_SELECTS = Object.freeze({
        product: COLS.product,
        productWithChildren: `${COLS.product}, store_product_variants(${COLS.variant}), store_design_assets(${COLS.asset})`,
        variant: COLS.variant,
        asset: COLS.asset,
        settings: COLS.settings,
        order: COLS.order,
        orderFull: `${COLS.order}, store_order_items(${COLS.item}), store_licenses(${COLS.license}), store_payments(${COLS.payment})`,
        item: COLS.item,
        payment: COLS.payment,
        license: COLS.license,
        licenseWithOrder: `${COLS.license}, store_orders(${COLS.orderBrief})`,
        supportNote: COLS.supportNote
    });
    // Tabla de cada select (la usa el test que las corre contra el emulador).
    const STORE_SELECT_TABLES = Object.freeze({
        product: 'store_products', productWithChildren: 'store_products', variant: 'store_product_variants',
        asset: 'store_design_assets', settings: 'store_seller_settings', order: 'store_orders',
        orderFull: 'store_orders', item: 'store_order_items', payment: 'store_payments',
        license: 'store_licenses', licenseWithOrder: 'store_licenses', supportNote: 'store_order_support_notes'
    });
    const SEL = STORE_SELECTS;

    // Campos que el vendedor edita. seller_*, kind, status y los campos del
    // servidor (sales_count, reservas, published_at…) quedan afuera.
    const PRODUCT_FIELDS = ['title', 'description', 'category', 'tags', 'currency', 'price_amount',
        'license_personal_price', 'license_artist_price', 'license_exclusive_price', 'design_width_cm',
        'design_height_cm', 'design_style', 'placement_suggestion', 'images', 'shipping_price_amount',
        'ships_to_countries', 'ships_to_note', 'pickup_available', 'pickup_note'];
    const VARIANT_FIELDS = ['label', 'size', 'color', 'sku', 'price_amount', 'active', 'sort_order'];
    const SETTINGS_FIELDS = ['store_tagline', 'contact_channel', 'payment_instructions', 'shipping_policy',
        'return_policy', 'pickup_address', 'authorship_attested_at'];

    // El emulador del demo no aplica los defaults de la base: en el preview se
    // completan acá para que las páginas lean filas con la forma real.
    const PREVIEW_PRODUCT_DEFAULTS = {
        status: 'draft', description: null, category: null, tags: [], currency: 'USD', price_amount: null,
        license_personal_price: null, license_artist_price: null, license_exclusive_price: null,
        design_width_cm: null, design_height_cm: null, design_style: null, placement_suggestion: null, images: [],
        shipping_price_amount: null, ships_to_countries: [], ships_to_note: null, pickup_available: false,
        pickup_note: null, sales_count: 0, licenses_issued: 0, reserved_order_id: null, reserved_until: null,
        exclusive_sold_at: null, published_at: null, retired_at: null, metadata_json: {}, updated_at: null
    };
    const PREVIEW_VARIANT_DEFAULTS = { size: null, color: null, sku: null, price_amount: null, stock: null, active: true, sort_order: 0, updated_at: null };

    /* ------------------------------ entorno ------------------------------ */
    function isPreviewEnv() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }

    // features.store en app-config.json (ConfigManager no expone `.features`:
    // se lee con getValue; se acepta también un objeto `features` directo).
    function featureEnabled() {
        if (isPreviewEnv()) return true;
        const CM = window.ConfigManager;
        if (!CM) return false;
        try {
            if (CM.features && CM.features.store === true) return true;
            return typeof CM.getValue === 'function' && CM.getValue('features.store', false) === true;
        } catch (_) {
            return false;
        }
    }

    // HEAD a store_products, cacheado. Solo «no existe» apaga la Store: 404,
    // PGRST205 (tabla) o PGRST202 (función). postgrest-js reescribe el 404 sin
    // cuerpo de un HEAD como 204 sin error, así que el status manda. Un 401/403
    // (anon no tiene grants) significa que la tabla existe.
    let available = null;
    let probing = null;
    async function isAvailable() {
        if (available !== null) return available;
        if (probing) return probing;
        probing = (async () => {
            const client = D.getClient();
            if (!client) return false;
            try {
                const res = await client.from('store_products').select('id', { count: 'exact', head: true });
                const code = res && res.error && res.error.code;
                if (code === 'PGRST205' || code === 'PGRST202') return false;
                if (res && (res.status === 404 || res.status === 204)) return false;
                return true;
            } catch (error) {
                console.warn('[store-repo] store_products no disponible:', error && error.message);
                return false;
            }
        })().then((value) => { available = value; probing = null; return value; });
        return probing;
    }

    function appPath(path) {
        const M = model();
        if (M && typeof M.appPath === 'function') return M.appPath(path);
        const base = String(window.WEOTZI_BASE_PATH || '').replace(/\/$/, '');
        const s = String(path || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s === base || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }

    // Igual que quotations-repo (Api.basePath): WEOTZI_BASE_PATH o /beta.
    function basePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (window.location && window.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    function isDemoPath(path) { return /^(demo\/|data:)/.test(String(path || '')); }

    // demo/… → asset de demo; data:image/… tal cual (preview); el resto es un
    // path del bucket público store-previews. En el preview no se toca Storage.
    function previewUrl(path) {
        const p = String(path == null ? '' : path).trim();
        if (!p) return '';
        if (/^data:image\//i.test(p)) return p;
        if (p.indexOf('demo/') === 0) return appPath('/shared/assets/' + p);
        if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.indexOf('//') === 0 || isPreviewEnv()) return '';
        const client = D.getClient();
        if (!client || !client.storage) return '';
        try {
            const res = client.storage.from(PREVIEW_BUCKET).getPublicUrl(p);
            return (res && res.data && res.data.publicUrl) || '';
        } catch (_) {
            return '';
        }
    }

    /* ------------------------------ helpers ------------------------------ */
    function storeError(code, label) {
        const err = new Error(`[${label}] store:${code}`);
        err.code = 'store:' + code;
        return err;
    }
    function validationError(message, code) {
        const err = new Error(message);
        err.validation = true;
        if (code) err.code = code;
        return err;
    }
    function asList(value) { return Array.isArray(value) ? value : value ? [value] : []; }
    function firstRow(data) { return Array.isArray(data) ? (data[0] || null) : (data || null); }
    function textOrNull(value, max) {
        const s = value == null ? '' : String(value).trim();
        if (!s) return null;
        return max ? s.slice(0, max) : s;
    }
    function money(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return isFinite(n) ? Math.round(n * 100) / 100 : null;
    }
    function intOrNull(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Math.floor(Number(value));
        return isFinite(n) ? n : null;
    }
    function pick(source, fields) {
        const out = {};
        fields.forEach((key) => { if (source && Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key]; });
        return out;
    }
    function sameValue(a, b) {
        if (a == null && b == null) return true;
        if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
        return JSON.stringify(a) === JSON.stringify(b);
    }
    function byOrder(a, b) {
        const s = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
        return s !== 0 ? s : String(a.created_at || '').localeCompare(String(b.created_at || ''));
    }
    function isoDate(value) {
        if (value == null || value === '') return null;
        if (value instanceof Date) {
            if (isNaN(value.getTime())) return null;
            const pad = (n) => String(n).padStart(2, '0');
            return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
        }
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
        return m ? m[1] : null;
    }
    function newKey() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // [{path, alt}] sin url, hasta 8 (el guard valida el path real).
    function cleanImages(images) {
        return asList(images).filter((img) => img && img.path).slice(0, 8).map((img) => ({
            path: String(img.path).trim(),
            alt: String(img.alt == null ? '' : img.alt).trim().slice(0, 200)
        }));
    }
    function cleanProductPatch(source) {
        const out = pick(source, PRODUCT_FIELDS);
        if ('images' in out) out.images = cleanImages(out.images);
        if ('tags' in out) out.tags = asList(out.tags).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
        if ('ships_to_countries' in out) {
            out.ships_to_countries = asList(out.ships_to_countries).map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
        }
        if ('currency' in out) out.currency = String(out.currency || 'USD').trim().toUpperCase();
        ['price_amount', 'license_personal_price', 'license_artist_price', 'license_exclusive_price', 'shipping_price_amount',
            'design_width_cm', 'design_height_cm'].forEach((key) => { if (key in out) out[key] = money(out[key]); });
        if ('pickup_available' in out) out.pickup_available = !!out.pickup_available;
        return out;
    }

    function normalizeProduct(row) {
        if (!row) return null;
        const out = Object.assign({}, row);
        const variants = asList(row.store_product_variants).slice().sort(byOrder);
        const assets = asList(row.store_design_assets).slice();
        delete out.store_product_variants;
        delete out.store_design_assets;
        out.images = Array.isArray(row.images) ? row.images : [];
        out.variants = variants;
        out.assets = assets;
        return out;
    }
    // PostgREST puede devolver el ítem como objeto (uno a uno): siempre arrays.
    function normalizeOrder(row) {
        if (!row) return null;
        const items = asList(row.store_order_items);
        const licenses = asList(row.store_licenses);
        const payments = asList(row.store_payments).slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        return Object.assign({}, row, {
            store_order_items: items, store_licenses: licenses, store_payments: payments,
            items, licenses, payments
        });
    }

    function storageBucket(bucket) {
        const client = D.getClient();
        if (!client || !client.storage) throw new Error('No pudimos conectar con el almacenamiento.');
        return client.storage.from(bucket);
    }
    function uploadError(error, label) {
        const err = new Error('No pudimos subir el archivo. Probá de nuevo.');
        err.cause = error;
        err.label = label;
        return err;
    }

    function readBlobAsDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
            reader.readAsDataURL(blob);
        });
    }
    async function blobBase64(blob) {
        const buffer = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode.apply(null, buffer.subarray(i, i + 0x8000));
        return btoa(binary);
    }
    // Preview: la imagen se reduce a ≤900 px y queda en el navegador como data
    // URL (mismo criterio que la galería del dashboard en el preview).
    async function previewDataUrl(blob, contentType) {
        try {
            if (typeof createImageBitmap === 'function' && typeof document !== 'undefined' && document.createElement) {
                const bitmap = await createImageBitmap(blob);
                const scale = Math.min(1, PREVIEW_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                if (typeof bitmap.close === 'function') bitmap.close();
                return canvas.toDataURL('image/jpeg', 0.78);
            }
        } catch (_) { /* formato que createImageBitmap no decodifica: se guarda tal cual */ }
        try {
            if (typeof FileReader === 'function') return await readBlobAsDataUrl(blob);
        } catch (_) { /* sigue con el siguiente intento */ }
        try {
            if (blob && typeof blob.arrayBuffer === 'function' && typeof btoa === 'function') {
                return 'data:' + contentType + ';base64,' + await blobBase64(blob);
            }
        } catch (_) { /* sin lector de blobs */ }
        return 'data:' + contentType + ';base64,';
    }

    // Archivo de demo para una descarga del preview, según tipo y MIME.
    function demoDownloadUrl(asset) {
        const kind = asset && asset.kind === 'stencil' ? 'stencil' : 'original';
        const ext = RASTER_MIME.indexOf(String(asset && asset.mime_type || '').toLowerCase()) !== -1 ? 'png' : 'svg';
        return appPath(DEMO_ASSETS + kind + '.' + ext);
    }

    async function accessToken() {
        const client = D.getClient();
        if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
        const res = await client.auth.getSession();
        const session = res && res.data && res.data.session;
        return (session && session.access_token) || null;
    }

    const HTTP_CODES = { 401: 'not_authenticated', 403: 'forbidden', 404: 'not_found', 410: 'license_revoked', 429: 'download_limit' };
    function httpError(status, message, label) {
        const err = new Error(message || `[${label}] HTTP ${status}`);
        err.status = status;
        if (HTTP_CODES[status]) err.code = 'store:' + HTTP_CODES[status];
        return err;
    }

    async function rpc(label, fn, args) {
        const { data } = await run(label, (c) => c.rpc(fn, args));
        return data;
    }
    async function publicRpc(label, fn, args) {
        try {
            const data = await rpc(label, fn, args);
            return data == null ? null : data;
        } catch (error) {
            console.warn(`[store-repo] ${label}:`, error && error.message);
            return null;
        }
    }

    /* ------------------------------ vendedor ------------------------------ */
    const Store = {
        STORE_SELECTS,
        STORE_SELECT_TABLES,
        isAvailable,
        isPreviewEnv,
        featureEnabled,
        previewUrl,

        // ---------------- productos ----------------
        async listMyProducts(sellerType, sellerId) {
            if (!sellerType || !sellerId) return [];
            const { data } = await run('store.listMyProducts', (c) =>
                c.from('store_products').select(SEL.productWithChildren)
                    .eq('seller_type', sellerType).eq('seller_id', sellerId)
                    .order('created_at', { ascending: false }).limit(300)
            );
            return asList(data).map(normalizeProduct);
        },

        // Producto con variantes, assets y los ajustes del vendedor.
        async getMyProduct(id) {
            if (!id) return null;
            const { data } = await run('store.getMyProduct', (c) =>
                c.from('store_products').select(SEL.productWithChildren).eq('id', id).maybeSingle()
            );
            const product = normalizeProduct(data);
            if (!product) return null;
            product.settings = await Store.getSellerSettings(product.seller_type, product.seller_id);
            return product;
        },

        async createProduct(fields) {
            const f = fields || {};
            const sellerType = f.seller_type || f.sellerType;
            const sellerId = f.seller_id || f.sellerId;
            const kind = f.kind;
            if (sellerType !== 'artist' && sellerType !== 'studio') throw validationError('store.createProduct: vendedor inválido');
            if (!sellerId) throw validationError('store.createProduct: falta el vendedor');
            if (kind !== 'merch' && kind !== 'design') throw validationError('store.createProduct: tipo inválido');
            const patch = cleanProductPatch(f);
            if (!textOrNull(patch.title)) throw validationError('Poné un título de al menos 2 caracteres.');
            let row = Object.assign({ seller_type: sellerType, seller_id: sellerId, kind, status: 'draft' }, patch);
            if (isPreviewEnv()) row = Object.assign({}, PREVIEW_PRODUCT_DEFAULTS, row, { status: 'draft' });
            const { data } = await run('store.createProduct', (c) =>
                c.from('store_products').insert([row]).select(SEL.product).single()
            );
            return normalizeProduct(data);
        },

        async updateProduct(id, patch) {
            if (!id) throw validationError('store.updateProduct: falta el producto');
            const clean = cleanProductPatch(patch || {});
            if (!Object.keys(clean).length) {
                const { data } = await run('store.updateProduct.read', (c) =>
                    c.from('store_products').select(SEL.product).eq('id', id).maybeSingle()
                );
                return normalizeProduct(data);
            }
            const { data } = await run('store.updateProduct', (c) =>
                c.from('store_products').update(clean).eq('id', id).select(SEL.product).single()
            );
            return normalizeProduct(data);
        },

        // El guard del SQL valida el checklist al pasar a active y que retired
        // sea final. El emulador no tiene guard: en el preview se espeja acá.
        async setProductStatus(id, status) {
            if (!id) throw validationError('store.setProductStatus: falta el producto');
            if (PRODUCT_STATUSES.indexOf(status) === -1) throw validationError('store.setProductStatus: estado inválido');
            const patch = { status };
            if (isPreviewEnv()) {
                const current = await Store.getMyProduct(id);
                if (!current) throw storeError('not_found', 'store.setProductStatus');
                if (current.status === 'retired' && status !== 'retired') throw storeError('invalid_status', 'store.setProductStatus');
                const M = model();
                if (status === 'active' && M && typeof M.publishChecklist === 'function') {
                    const list = M.publishChecklist(current, { variants: current.variants, assets: current.assets, settings: current.settings });
                    if (!M.checklistComplete(list)) throw storeError('checklist_incomplete', 'store.setProductStatus');
                }
                const at = new Date().toISOString();
                if (status === 'active' && !current.published_at) patch.published_at = at;
                if (status === 'retired' && !current.retired_at) patch.retired_at = at;
            }
            const { data } = await run('store.setProductStatus', (c) =>
                c.from('store_products').update(patch).eq('id', id).select(SEL.product).single()
            );
            return normalizeProduct(data);
        },

        // Solo borradores (la policy además exige que no tenga ítems de pedido).
        // Fuera del preview limpia después las imágenes y archivos subidos.
        async deleteDraftProduct(id) {
            if (!id) throw validationError('store.deleteDraftProduct: falta el producto');
            const current = await Store.getMyProduct(id);
            if (!current) throw storeError('not_found', 'store.deleteDraftProduct');
            if (current.status !== 'draft') throw storeError('invalid_status', 'store.deleteDraftProduct');
            const { data } = await run('store.deleteDraftProduct', (c) =>
                c.from('store_products').delete().eq('id', id).eq('status', 'draft').select('id')
            );
            if (!asList(data).length) throw storeError('invalid_status', 'store.deleteDraftProduct');
            if (!isPreviewEnv()) {
                const previews = current.images.map((img) => img.path).filter((p) => p && !isDemoPath(p));
                const files = current.assets.map((a) => a.storage_path).filter((p) => p && !isDemoPath(p));
                try { if (previews.length) await storageBucket(PREVIEW_BUCKET).remove(previews); } catch (_) { /* limpieza best-effort */ }
                try { if (files.length) await storageBucket(DESIGN_BUCKET).remove(files); } catch (_) { /* limpieza best-effort */ }
            }
            return true;
        },

        // ---------------- variantes ----------------
        async listVariants(productId) {
            if (!productId) return [];
            const { data } = await run('store.listVariants', (c) =>
                c.from('store_product_variants').select(SEL.variant).eq('product_id', productId)
                    .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
            );
            return asList(data).slice().sort(byOrder);
        },

        // Upsert por id que manda solo los cambios: PATCH de los campos que
        // cambiaron en las existentes e INSERT de las nuevas (el stock solo se
        // fija al crear; después va por adjustStock). Las que faltan en la lista
        // se borran si ningún pedido las referencia; si no, se desactivan.
        // Nunca reemplaza todo.
        async saveVariants(productId, variants) {
            if (!productId) throw validationError('store.saveVariants: falta el producto');
            const desired = asList(variants);
            const current = await Store.listVariants(productId);
            const byId = new Map(current.map((v) => [String(v.id), v]));
            const keep = new Set();
            const updates = [];
            const inserts = [];
            desired.forEach((v, index) => {
                const label = textOrNull(v && v.label, 60);
                if (!label) throw validationError('Cada variante necesita un nombre, por ejemplo «Talle M».');
                const clean = {
                    label,
                    size: textOrNull(v.size, 20),
                    color: textOrNull(v.color, 30),
                    sku: textOrNull(v.sku, 40),
                    price_amount: money(v.price_amount),
                    active: v.active !== false,
                    sort_order: v.sort_order != null ? intOrNull(v.sort_order) || 0 : index
                };
                const existing = v.id != null ? byId.get(String(v.id)) : null;
                if (existing) {
                    keep.add(String(existing.id));
                    const diff = {};
                    VARIANT_FIELDS.forEach((key) => { if (!sameValue(existing[key], clean[key])) diff[key] = clean[key]; });
                    if (Object.keys(diff).length) updates.push({ id: existing.id, diff });
                } else {
                    const stock = intOrNull(v.stock);
                    if (stock !== null && stock < 0) throw storeError('invalid_quantity', 'store.saveVariants');
                    let row = Object.assign({ product_id: productId, stock }, clean);
                    if (isPreviewEnv()) row = Object.assign({}, PREVIEW_VARIANT_DEFAULTS, row);
                    inserts.push(row);
                }
            });
            // Cambios y altas primero: así una baja no deja al producto sin
            // variante activa a mitad de camino.
            for (const u of updates) {
                await run('store.saveVariants.update', (c) =>
                    c.from('store_product_variants').update(u.diff).eq('id', u.id).eq('product_id', productId).select(SEL.variant).single()
                );
            }
            if (inserts.length) {
                await run('store.saveVariants.insert', (c) => c.from('store_product_variants').insert(inserts).select(SEL.variant));
            }
            const removed = current.filter((v) => !keep.has(String(v.id)) && v.active !== false);
            for (const v of removed) await retireVariant(productId, v);
            return Store.listVariants(productId);
        },

        async adjustStock(variantId, newStock, expectedStock) {
            if (!variantId) throw validationError('store.adjustStock: falta la variante');
            const next = intOrNull(newStock);
            if (next !== null && next < 0) throw storeError('invalid_quantity', 'store.adjustStock');
            const data = await rpc('store.adjustStock', 'adjust_store_variant_stock', {
                p_variant_id: variantId, p_new_stock: next, p_expected_stock: intOrNull(expectedStock)
            });
            return firstRow(data);
        },

        // ---------------- imágenes (store-previews, público) ----------------
        // blob: la salida de WeotziStoreWatermark (renderPreview / renderPlain).
        async uploadPreviewImage(sellerId, productId, blob, index, contentType) {
            const M = requireModel();
            const type = String(contentType || (blob && blob.type) || '').trim().toLowerCase();
            const ext = M.extForContentType(type) || 'bin';
            const check = M.validateFile('preview', { name: 'vista.' + ext, type, size: blob && blob.size });
            if (!check.ok) throw validationError(check.error, check.code);
            if (isPreviewEnv()) return { path: await previewDataUrl(blob, check.contentType) };
            const path = M.buildPreviewPath(sellerId, productId, Date.now(), index, check.contentType);
            const { error } = await storageBucket(PREVIEW_BUCKET).upload(path, blob, {
                contentType: check.contentType, upsert: false, cacheControl: '31536000'
            });
            if (error) throw uploadError(error, 'store.uploadPreviewImage');
            return { path };
        },

        async removePreviewImage(path) {
            if (!path || isPreviewEnv() || isDemoPath(path)) return true;
            const { error } = await storageBucket(PREVIEW_BUCKET).remove([path]);
            if (error) {
                const err = new Error('No pudimos borrar la imagen. Probá de nuevo.');
                err.cause = error;
                throw err;
            }
            return true;
        },

        // ---------------- archivos de diseño (store-design-files, privado) ----------------
        // Sube primero y después inserta la fila (el trigger valida que el
        // objeto exista y toma de él el MIME y el tamaño). Si la fila falla, se
        // borra el archivo subido.
        async uploadDesignAsset(sellerId, productId, kind, file) {
            const M = requireModel();
            if (kind !== 'original' && kind !== 'stencil') throw validationError('Tipo de archivo desconocido.', 'invalid_kind');
            if (!productId) throw validationError('store.uploadDesignAsset: falta el producto');
            const check = M.validateFile(kind, file);
            if (!check.ok) throw validationError(check.error, check.code);
            const fileName = textOrNull(file.name, 200) || kind;
            const ts = Date.now();
            const insertRow = (path) => run('store.uploadDesignAsset', (c) =>
                c.from('store_design_assets').insert([{
                    product_id: productId, kind, storage_path: path, file_name: fileName,
                    mime_type: check.contentType, size_bytes: Number(file.size) || 0
                }]).select(SEL.asset).single()
            ).then((res) => res.data);
            if (isPreviewEnv()) return insertRow(M.buildAssetPath('demo', productId, kind, fileName, ts));
            const path = M.buildAssetPath(sellerId, productId, kind, fileName, ts);
            const bucket = storageBucket(DESIGN_BUCKET);
            const uploaded = await bucket.upload(path, file, { contentType: check.contentType, upsert: false, cacheControl: '3600' });
            if (uploaded && uploaded.error) throw uploadError(uploaded.error, 'store.uploadDesignAsset');
            try {
                return await insertRow(path);
            } catch (error) {
                try { await bucket.remove([path]); } catch (_) { /* compensación best-effort */ }
                throw error;
            }
        },

        // Borra la fila (el guard frena si hay licencias o deja un producto
        // publicado sin original/stencil) y después el archivo.
        async removeDesignAsset(asset) {
            const id = asset && asset.id;
            if (!id) throw validationError('store.removeDesignAsset: falta el archivo');
            let path = asset.storage_path || null;
            if (!path && !isPreviewEnv()) {
                const { data } = await run('store.removeDesignAsset.read', (c) =>
                    c.from('store_design_assets').select(SEL.asset).eq('id', id).maybeSingle()
                );
                path = data ? data.storage_path : null;
            }
            const { data } = await run('store.removeDesignAsset', (c) =>
                c.from('store_design_assets').delete().eq('id', id).select('id')
            );
            if (!asList(data).length) throw storeError('not_found', 'store.removeDesignAsset');
            if (!isPreviewEnv() && path && !isDemoPath(path)) {
                try {
                    const res = await storageBucket(DESIGN_BUCKET).remove([path]);
                    if (res && res.error) console.warn('[store-repo] no se pudo borrar el archivo:', res.error.message);
                } catch (error) {
                    console.warn('[store-repo] no se pudo borrar el archivo:', error && error.message);
                }
            }
            return true;
        },

        // ---------------- ajustes ----------------
        async getSellerSettings(sellerType, sellerId) {
            if (!sellerType || !sellerId) return null;
            const { data } = await run('store.getSellerSettings', (c) =>
                c.from('store_seller_settings').select(SEL.settings)
                    .eq('seller_type', sellerType).eq('seller_id', sellerId).maybeSingle()
            );
            return data || null;
        },

        // authorship_attested_at: el trigger lo fecha en el servidor (cualquier
        // valor no nulo vale como «confirmo»).
        async saveSellerSettings(sellerType, sellerId, patch) {
            if (!sellerType || !sellerId) throw validationError('store.saveSellerSettings: falta el vendedor');
            const clean = pick(patch || {}, SETTINGS_FIELDS);
            const limits = { store_tagline: 160, contact_channel: 200, payment_instructions: 2000, shipping_policy: 2000, return_policy: 2000, pickup_address: 300 };
            Object.keys(limits).forEach((key) => { if (key in clean) clean[key] = textOrNull(clean[key], limits[key]); });
            if ('authorship_attested_at' in clean) {
                const v = clean.authorship_attested_at;
                clean.authorship_attested_at = v ? (typeof v === 'string' ? v : new Date().toISOString()) : null;
            }
            const row = Object.assign({ seller_type: sellerType, seller_id: sellerId }, clean);
            const { data } = await run('store.saveSellerSettings', (c) =>
                c.from('store_seller_settings').upsert([row], { onConflict: 'seller_type,seller_id' }).select(SEL.settings).single()
            );
            return data || null;
        },

        // ---------------- pedidos del vendedor ----------------
        async listSellerOrders(sellerType, sellerId) {
            if (!sellerType || !sellerId) return [];
            const { data } = await run('store.listSellerOrders', (c) =>
                c.from('store_orders').select(SEL.orderFull)
                    .eq('seller_type', sellerType).eq('seller_id', sellerId)
                    .order('created_at', { ascending: false }).limit(300)
            );
            return asList(data).map(normalizeOrder);
        },

        async confirmPayment(orderId, opts) {
            const o = opts || {};
            const data = await rpc('store.confirmPayment', 'confirm_store_order_payment', {
                p_order_id: orderId,
                p_collected_by: o.collectedBy || 'seller',
                p_reference: textOrNull(o.reference, 200),
                p_note: textOrNull(o.note, 500)
            });
            return firstRow(data);
        },

        // opts: { status, trackingCarrier, trackingCode, trackingUrl, sellerMessage }
        async updateFulfillment(orderId, opts) {
            const o = opts || {};
            const url = textOrNull(o.trackingUrl || o.tracking_url, 500);
            const M = model();
            if (url && M && typeof M.isHttpsUrl === 'function' && !M.isHttpsUrl(url)) throw storeError('invalid_tracking_url', 'store.updateFulfillment');
            const data = await rpc('store.updateFulfillment', 'update_store_order_fulfillment', {
                p_order_id: orderId,
                p_status: o.status,
                p_tracking_carrier: textOrNull(o.trackingCarrier || o.tracking_carrier, 60),
                p_tracking_code: textOrNull(o.trackingCode || o.tracking_code, 80),
                p_tracking_url: url,
                p_seller_message: textOrNull(o.sellerMessage || o.seller_message, 1000)
            });
            return firstRow(data);
        },

        // Compartido: comprador (sin pago informado), vendedor o soporte.
        async cancelOrder(orderId, reason) {
            const data = await rpc('store.cancelOrder', 'cancel_store_order', { p_order_id: orderId, p_reason: textOrNull(reason, 300) });
            return firstRow(data);
        },

        async refundOrder(orderId, reason) {
            const data = await rpc('store.refundOrder', 'refund_store_order', { p_order_id: orderId, p_reason: textOrNull(reason, 300) });
            return firstRow(data);
        },

        // from/to: Date o 'YYYY-MM-DD' (inclusive). Filas por producto, mes y moneda.
        async getSalesReport(sellerType, sellerId, from, to) {
            const data = await rpc('store.getSalesReport', 'get_store_sales_report', {
                p_seller_type: sellerType, p_seller_id: sellerId, p_from: isoDate(from), p_to: isoDate(to)
            });
            return asList(data);
        },

        /* ------------------------------ público ------------------------------ */
        async getStorefront(sellerType, handle) {
            const type = sellerType || 'artist';
            const M = model();
            const h = type === 'artist' && M ? M.normalizeUsername(handle) : textOrNull(handle, 120);
            if (!h) return null;
            return publicRpc('store.getStorefront', 'get_public_storefront', { p_seller_type: type, p_handle: h });
        },

        async getPublicProduct(id) {
            if (!id) return null;
            return publicRpc('store.getPublicProduct', 'get_public_store_product', { p_product_id: id });
        },

        // Un código con otra forma ni llega a la base (mismo resultado que el SQL).
        async verifyLicense(code) {
            const M = model();
            const normalized = M ? M.normalizeLicenseCode(code) : textOrNull(code, 20);
            if (!normalized) return { found: false, valid: false };
            return publicRpc('store.verifyLicense', 'verify_store_license', { p_code: normalized });
        },

        /* ------------------------------ comprador ------------------------------ */
        // input: { productId, variantId, quantity, tier, holderName, method,
        // shippingAddress, buyerNote, termsVersion, idempotencyKey }. Acepta
        // también los nombres de checkoutUrl (item, license, variant, qty).
        async createOrder(input) {
            const i = input || {};
            const M = model();
            const productId = i.productId || i.product_id || i.item;
            if (!productId) throw validationError('store.createOrder: falta el producto');
            const qty = intOrNull(i.quantity != null ? i.quantity : i.qty);
            const data = await rpc('store.createOrder', 'create_store_order', {
                p_product_id: productId,
                p_variant_id: i.variantId || i.variant_id || i.variant || null,
                p_quantity: qty === null ? 1 : qty,
                p_license_tier: i.tier || i.license || i.license_tier || null,
                p_license_holder_name: textOrNull(i.holderName || i.license_holder_name, 120),
                p_fulfillment_method: i.method || i.fulfillmentMethod || i.fulfillment_method || null,
                p_shipping_address: i.shippingAddress || i.shipping_address || null,
                p_buyer_note: textOrNull(i.buyerNote || i.buyer_note, 1000),
                p_terms_version: i.termsVersion || i.terms_version || (M && M.TERMS_VERSION) || null,
                p_idempotency_key: textOrNull(i.idempotencyKey || i.idempotency_key, 80) || newKey()
            });
            return firstRow(data);
        },

        async getMyOrder(id) {
            if (!id) return null;
            const { data } = await run('store.getMyOrder', (c) =>
                c.from('store_orders').select(SEL.orderFull).eq('id', id).maybeSingle()
            );
            return normalizeOrder(data);
        },

        async listMyPurchases(userId) {
            if (!userId) return [];
            const { data } = await run('store.listMyPurchases', (c) =>
                c.from('store_orders').select(SEL.orderFull).eq('buyer_user_id', userId)
                    .order('created_at', { ascending: false }).limit(200)
            );
            return asList(data).map(normalizeOrder);
        },

        async reportPayment(orderId, reference) {
            const data = await rpc('store.reportPayment', 'report_store_payment', { p_order_id: orderId, p_reference: textOrNull(reference, 200) });
            return firstRow(data);
        },

        async confirmReceived(orderId) {
            const data = await rpc('store.confirmReceived', 'confirm_store_order_received', { p_order_id: orderId });
            return firstRow(data);
        },

        // Titular, comprador o vendedor (RLS). Incluye el pedido resumido.
        async getLicense(id) {
            if (!id) return null;
            const { data } = await run('store.getLicense', (c) =>
                c.from('store_licenses').select(SEL.licenseWithOrder).eq('id', id).maybeSingle()
            );
            if (!data) return null;
            return Object.assign({}, data, { store_orders: firstRow(data.store_orders) });
        },

        async markLicenseUsed(id, note) {
            const data = await rpc('store.markLicenseUsed', 'mark_store_license_used', { p_license_id: id, p_note: textOrNull(note, 160) });
            return firstRow(data);
        },

        // Metadata de original y stencil (policy licensee_read); las descargas
        // van por getDownloadUrl.
        async listLicenseAssets(productId) {
            if (!productId) return [];
            const { data } = await run('store.listLicenseAssets', (c) =>
                c.from('store_design_assets').select(SEL.asset).eq('product_id', productId).order('kind', { ascending: true })
            );
            return asList(data);
        },

        // URL firmada (300 s) que emite el servidor. En el preview, el archivo de
        // demo que corresponde al tipo y al MIME.
        async getDownloadUrl(licenseId, asset) {
            if (!licenseId || !asset || !asset.id) throw validationError('store.getDownloadUrl: falta el archivo');
            if (isPreviewEnv()) return demoDownloadUrl(asset);
            const token = await accessToken();
            if (!token) throw storeError('not_authenticated', 'store.getDownloadUrl');
            const res = await fetch(`${basePath()}/api/store/licenses/${encodeURIComponent(licenseId)}/assets/${encodeURIComponent(asset.id)}/url`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.success === false || !body.url) throw httpError(res.status, body.error, 'store.getDownloadUrl');
            return body.url;
        },

        /* ------------------------------ soporte ------------------------------ */
        async listPendingPlatformOrders() {
            const { data } = await run('store.listPendingPlatformOrders', (c) =>
                c.from('store_orders').select(SEL.orderFull)
                    .eq('status', 'pending_payment').eq('expected_collector', 'platform')
                    .order('created_at', { ascending: true }).limit(300)
            );
            return asList(data).map(normalizeOrder);
        },

        // Marcados needs_support (pago duplicado o informado y vencido) y con
        // funds_hold. El emulador del demo no filtra jsonb: ahí se filtra acá.
        async listFlaggedOrders() {
            const preview = isPreviewEnv();
            const [held, flagged] = await Promise.all([
                run('store.listFlaggedOrders.hold', (c) =>
                    c.from('store_orders').select(SEL.orderFull).eq('funds_hold', true)
                        .order('updated_at', { ascending: false }).limit(300)
                ),
                run('store.listFlaggedOrders.support', (c) => {
                    let q = c.from('store_orders').select(SEL.orderFull);
                    if (!preview) q = q.eq('metadata_json->>needs_support', 'true');
                    return q.order('updated_at', { ascending: false }).limit(300);
                })
            ]);
            const seen = new Set();
            const out = [];
            asList(held.data).concat(asList(flagged.data).filter((o) => o && o.metadata_json && o.metadata_json.needs_support === true))
                .forEach((o) => { if (o && !seen.has(o.id)) { seen.add(o.id); out.push(normalizeOrder(o)); } });
            return out.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        },

        async setFundsHold(orderId, hold, note) {
            const data = await rpc('store.setFundsHold', 'set_store_order_funds_hold', {
                p_order_id: orderId, p_hold: !!hold, p_note: textOrNull(note, 500)
            });
            return firstRow(data);
        },

        // Da por revisada la marca needs_support (pago duplicado, o informado y
        // vencido): el pedido sale de la cola. Idempotente; solo soporte
        // (store:forbidden). La nota queda en store_order_support_notes.
        async resolveOrderFlag(orderId, note) {
            if (!orderId) throw validationError('store.resolveOrderFlag: falta el pedido');
            const data = await rpc('store.resolveOrderFlag', 'resolve_store_order_flag', {
                p_order_id: orderId, p_note: textOrNull(note, 500)
            });
            return firstRow(data);
        },

        // Notas internas de un pedido (retención, reembolso, reapertura, marca
        // resuelta, error del mantenimiento), la más reciente primero. Solo las
        // lee soporte: ante cualquier error devuelve [] y deja un warning.
        async listSupportNotes(orderId) {
            if (!orderId) return [];
            try {
                const { data } = await run('store.listSupportNotes', (c) =>
                    c.from('store_order_support_notes').select(SEL.supportNote).eq('order_id', orderId)
                        .order('created_at', { ascending: false }).limit(100)
                );
                return asList(data);
            } catch (error) {
                console.warn('[store-repo] store.listSupportNotes:', error && error.message);
                return [];
            }
        },

        // Vencidos de los últimos `days` días (1 a 90; por defecto 7), para que
        // soporte los reabra. El más reciente primero.
        async listRecentExpiredOrders({ days = 7 } = {}) {
            const n = Number(days);
            const span = isFinite(n) && n > 0 ? Math.min(n, 90) : 7;
            const since = new Date(Date.now() - span * DAY_MS).toISOString();
            const { data } = await run('store.listRecentExpiredOrders', (c) =>
                c.from('store_orders').select(SEL.orderFull).eq('status', 'expired').gte('expires_at', since)
                    .order('expires_at', { ascending: false }).limit(300)
            );
            return asList(data).map(normalizeOrder);
        }
    };

    // Baja de una variante quitada del editor: se borra si ningún pedido la
    // referencia (FK restrict); si no, o si el borrado falla, se desactiva.
    async function retireVariant(productId, variant) {
        const { data: refs } = await run('store.saveVariants.refs', (c) =>
            c.from('store_order_items').select('id').eq('variant_id', variant.id).limit(1)
        );
        if (!asList(refs).length) {
            try {
                await run('store.saveVariants.delete', (c) =>
                    c.from('store_product_variants').delete().eq('id', variant.id).eq('product_id', productId).select('id')
                );
                return;
            } catch (error) {
                const M = model();
                if (M && M.errorCode(error) === 'checklist_incomplete') throw error;
            }
        }
        await run('store.saveVariants.deactivate', (c) =>
            c.from('store_product_variants').update({ active: false }).eq('id', variant.id).eq('product_id', productId).select(SEL.variant).single()
        );
    }

    D.Store = Store;
})();
