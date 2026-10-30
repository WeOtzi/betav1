/**
 * WE OTZI - Checkout de la Store (/store/checkout/?item=&license=&variant=&qty=)
 * ------------------------------------------------------------------------------
 * Contrato: docs/plans/2026-10-30-store-artista.md (§8.3 y §8.4, fila checkout).
 *
 *   - Carga el producto con WeotziData.Store.getPublicProduct (RPC pública).
 *   - Sin sesión: ingreso inline con email y contraseña (supabase.auth, que es
 *     auth y no datos) y links de registro e ingreso de artista con returnTo.
 *     Los parámetros quedan en sessionStorage (wo_store_checkout) para volver.
 *   - Con sesión (cliente o artista): resumen, nivel o variante, titular, entrega,
 *     nota y aceptación de términos (también para merch: la RPC exige
 *     p_terms_version). createOrder con una idempotency_key por combinación de
 *     parámetros, guardada en sessionStorage.
 *   - Pedido creado: número, total con código ISO, plazo, instrucciones y
 *     contacto (snapshots del pedido), «Ya pagué →» (reportPayment) y
 *     «Ver mis compras →». ?pedido=<id> vuelve a mostrar esa pantalla.
 *
 * Datos: SOLO WeotziData.Store y WeotziStoreShell (nada de /rest/v1 inline).
 * No carga client-auth.js.
 */
(function () {
    'use strict';

    var M = window.WeotziStoreModel;
    var S = window.WeotziStoreShell;
    var Store = window.WeotziData && window.WeotziData.Store;

    var PARAMS_KEY = 'wo_store_checkout';
    var IDEM_KEY = 'wo_store_checkout_keys';
    var PARAMS_TTL_MS = 24 * 3600000;
    var MAX_QTY = 20;

    // Todos los códigos ISO 3166-1 alfa-2 asignados. Se usan cuando el
    // vendedor no restringe la lista: la ficha promete «Hace envíos a todos
    // los países» y el modelo acepta cualquier ISO-2. Los nombres salen de
    // Intl.DisplayNames en español.
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

    var state = {
        params: { item: null, license: null, variant: null, qty: null },
        viewer: null,
        bundle: null,
        product: null,
        tiers: [],
        tier: null,
        variantId: null,
        quantity: 1,
        method: null,
        order: null,
        busy: false
    };

    function $(id) { return document.getElementById(id); }
    function esc(v) { return S.esc(v); }
    function app(p) { return S.appPath(p); }

    /* ------------------------------------------------------------------ */
    /* Estados de página                                                   */
    /* ------------------------------------------------------------------ */

    var STATES = ['stb-loading', 'stb-message', 'stb-auth', 'stb-checkout', 'stb-done'];
    function showState(id, opts) {
        STATES.forEach(function (s) { var el = $(s); if (el) el.hidden = s !== id; });
        S.hydrateIcons($(id));
        if (opts && opts.focus) {
            var title = $('stb-title');
            if (title) { try { title.focus({ preventScroll: false }); } catch (e) { title.focus(); } }
        }
    }

    function setHeader(eyebrow, title, sub) {
        $('stb-eyebrow').textContent = eyebrow;
        $('stb-title').textContent = title;
        var subEl = $('stb-sub');
        subEl.textContent = sub || '';
        subEl.hidden = !sub;
    }

    function showMessage(opts) {
        setHeader(opts.eyebrow || 'Store · Checkout', opts.heading || 'Checkout', null);
        var box = $('stb-message');
        box.innerHTML = '<div class="sts-panel">' + S.emptyState({
            icon: opts.icon || 'shopping-bag',
            title: opts.title,
            text: opts.text,
            actionLabel: opts.actionLabel,
            actionHref: opts.actionHref
        }) + '</div>';
        showState('stb-message', { focus: true });
    }

    /* ------------------------------------------------------------------ */
    /* sessionStorage: parámetros e idempotencia                           */
    /* ------------------------------------------------------------------ */

    function ssGet(key) {
        try { var raw = window.sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function ssSet(key, value) {
        try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sin storage: sigue sin recordar */ }
    }
    function ssDel(key) {
        try { window.sessionStorage.removeItem(key); } catch (e) { /* sin storage */ }
    }

    function cleanParams(p) {
        p = p || {};
        var qty = parseInt(p.qty, 10);
        return {
            item: p.item ? String(p.item).trim() : null,
            license: p.license ? String(p.license).trim().toLowerCase() : null,
            variant: p.variant ? String(p.variant).trim() : null,
            qty: isFinite(qty) && qty > 0 ? Math.min(qty, MAX_QTY) : null
        };
    }

    function readParams() {
        var fromUrl = cleanParams({ item: S.param('item'), license: S.param('license'), variant: S.param('variant'), qty: S.param('qty') });
        if (fromUrl.item) {
            saveParams(fromUrl);
            return fromUrl;
        }
        var saved = ssGet(PARAMS_KEY);
        if (saved && saved.item && (!saved.savedAt || Date.now() - saved.savedAt < PARAMS_TTL_MS)) {
            var restored = cleanParams(saved);
            S.setParams({ item: restored.item, license: restored.license, variant: restored.variant, qty: restored.qty });
            return restored;
        }
        return fromUrl;
    }

    function saveParams(p) {
        ssSet(PARAMS_KEY, { item: p.item, license: p.license, variant: p.variant, qty: p.qty, savedAt: Date.now() });
    }

    // Refleja la selección en la URL y en sessionStorage (así el returnTo del
    // login y la clave de idempotencia siguen la combinación elegida).
    function syncParams() {
        var isDesign = state.product && state.product.kind === 'design';
        state.params = cleanParams({
            item: state.params.item,
            license: isDesign ? state.tier : null,
            variant: isDesign ? null : state.variantId,
            qty: isDesign ? null : state.quantity
        });
        S.setParams({ item: state.params.item, license: state.params.license, variant: state.params.variant, qty: state.params.qty });
        saveParams(state.params);
    }

    function comboKey(p) {
        return [p.item || '', p.license || '', p.variant || '', p.qty || 1].join('|');
    }
    function newUuid() {
        try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); } catch (e) { /* sigue */ }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }
    // Una clave por combinación: un doble clic o un reintento tras un corte
    // devuelven el mismo pedido en lugar de crear otro.
    function idempotencyKey(p) {
        var map = ssGet(IDEM_KEY) || {};
        var key = comboKey(p);
        if (!map[key]) { map[key] = newUuid(); ssSet(IDEM_KEY, map); }
        return map[key];
    }
    function forgetIdempotencyKey(p) {
        var map = ssGet(IDEM_KEY) || {};
        delete map[comboKey(p)];
        ssSet(IDEM_KEY, map);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers de producto                                                 */
    /* ------------------------------------------------------------------ */

    function variants() { return (state.product && Array.isArray(state.product.variants)) ? state.product.variants : []; }
    function findVariant(id) {
        var list = variants();
        for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
        return null;
    }
    // Unidades pedibles de una variante pública (in_stock / low_stock).
    function variantMax(v) {
        if (!v || v.in_stock === false) return 0;
        if (v.low_stock != null && isFinite(Number(v.low_stock))) return Math.max(0, Math.min(MAX_QTY, Number(v.low_stock)));
        return MAX_QTY;
    }
    function shippingOffered(p) { return p && p.kind === 'merch' && p.shipping_price_amount != null && p.shipping_price_amount !== ''; }
    function pickupOffered(p) { return !!(p && p.kind === 'merch' && p.pickup_available); }
    function seller() { return (state.bundle && state.bundle.seller) || {}; }
    function sellerSettings() { return (state.bundle && state.bundle.settings) || {}; }
    function tierMeta(id) { return M.tierById(id); }
    function viewerIsSeller() {
        var v = state.viewer;
        var s = seller();
        return !!(v && v.user && s.type === 'artist' && s.id && String(s.id) === String(v.user.id));
    }
    function buyerName() {
        var v = state.viewer || {};
        if (v.role === 'artist' && v.artist && v.artist.name) return v.artist.name;
        var meta = (v.user && v.user.user_metadata) || {};
        return meta.full_name || meta.name || '';
    }

    function totals() {
        return M.orderTotals(state.product, {
            tier: state.tier,
            variantId: state.variantId,
            quantity: state.quantity,
            method: state.method
        });
    }

    var countryNames = null;
    function countryLabel(code) {
        try {
            if (!countryNames && window.Intl && typeof Intl.DisplayNames === 'function') countryNames = new Intl.DisplayNames(['es'], { type: 'region' });
            return (countryNames && countryNames.of(code)) || code;
        } catch (e) { return code; }
    }
    function countryOptions(p) {
        var allowed = (p && Array.isArray(p.ships_to_countries) ? p.ships_to_countries : []).map(function (c) { return String(c).toUpperCase(); })
            .filter(function (c) { return /^[A-Z]{2}$/.test(c); });
        var codes = allowed.length ? allowed : COUNTRY_CODES.slice();
        return codes.map(function (c) { return { code: c, label: countryLabel(c) }; })
            .sort(function (a, b) { return a.label.localeCompare(b.label, 'es'); });
    }

    /* ------------------------------------------------------------------ */
    /* Resumen                                                             */
    /* ------------------------------------------------------------------ */

    function productSummaryHtml(p, opts) {
        opts = opts || {};
        var img = p.images && p.images[0];
        var s = seller();
        var line = M.KIND_LABELS[p.kind] || '';
        if (p.kind === 'design' && opts.tier && tierMeta(opts.tier)) line += ' · Licencia ' + tierMeta(opts.tier).label;
        if (p.kind === 'merch' && opts.variantLabel) line += ' · ' + opts.variantLabel;
        var by = s.name ? '<p class="stb-summary-line">De ' + esc(s.name) + (s.handle ? ' · <a class="stb-link" href="' + esc(M.storeUrl(s.handle)) + '">Ver su Store →</a>' : '') + '</p>' : '';
        // Miniatura decorativa: el título visible de al lado ya nombra el producto.
        return '<div class="stb-summary">' +
            '<div class="stb-thumb">' + S.previewImg(img && img.path, { alt: '', loading: 'eager' }) + '</div>' +
            '<div class="stb-summary-body">' +
                '<p class="stb-meta">' + esc(line) + '</p>' +
                '<p class="stb-summary-title">' + esc(p.title) + '</p>' + by +
            '</div></div>';
    }

    function renderAuthSummary() {
        var p = state.product;
        var t = M.orderTotals(p, { tier: state.params.license, variantId: state.params.variant, quantity: state.params.qty || 1, method: 'shipping' });
        var v = state.params.variant ? findVariant(state.params.variant) : null;
        var price = t.unitPrice != null ? M.formatMoney(t.subtotal != null ? t.subtotal : t.unitPrice, p.currency) : (M.priceFrom(p) != null ? 'Desde ' + M.formatMoney(M.priceFrom(p), p.currency) : '');
        $('stb-auth-summary').innerHTML = '<div class="stb-block">' + productSummaryHtml(p, { tier: state.params.license, variantLabel: v && v.label }) + '</div>' +
            (price ? '<div class="stb-block"><dl class="stb-totals"><div class="stb-total-row stb-total-row--grand"><dt>' +
                (p.kind === 'merch' ? 'Subtotal' : 'Precio') + '</dt><dd>' + esc(price) + '</dd></div></dl></div>' : '');
    }

    function renderSummary() {
        var p = state.product;
        var t = totals();
        var v = state.variantId ? findVariant(state.variantId) : null;
        var rows = [];
        if (p.kind === 'design') {
            var meta = tierMeta(state.tier);
            rows.push([meta ? 'Licencia ' + meta.label : 'Licencia', t.subtotal != null ? M.formatMoney(t.subtotal, t.currency) : '—']);
        } else {
            rows.push([(v ? v.label : 'Producto') + ' × ' + (t.quantity >= 1 ? t.quantity : 1), t.subtotal != null ? M.formatMoney(t.subtotal, t.currency) : '—']);
            if (state.method === 'pickup') rows.push(['Retiro en el estudio', 'Sin cargo']);
            else if (state.method === 'shipping') rows.push(['Envío', t.shipping > 0 ? M.formatMoney(t.shipping, t.currency) : 'Sin cargo']);
        }
        var rowsHtml = rows.map(function (r) { return '<div class="stb-total-row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
        // Merch sin método elegido: el envío todavía no se sabe, no hay total.
        var needsMethod = p.kind === 'merch' && !state.method;
        var grand = '<div class="stb-total-row stb-total-row--grand"><dt>Total</dt><dd>' + esc(t.total != null && t.valid && !needsMethod ? M.formatMoney(t.total, t.currency) : '—') + '</dd></div>';
        var hint = '';
        if (!t.valid && t.error) hint = '<p class="stb-text stb-text--s stb-muted">' + esc(summaryHint(t.error)) + '</p>';
        else if (needsMethod) hint = '<p class="stb-text stb-text--s stb-muted">Elegí cómo querés recibirlo para ver el total.</p>';
        $('stb-summary').innerHTML =
            '<div class="stb-block">' + productSummaryHtml(p, { tier: state.tier, variantLabel: v && v.label }) + '</div>' +
            '<div class="stb-block"><dl class="stb-totals">' + rowsHtml + grand + '</dl>' + hint +
            '<p class="stb-text stb-text--s stb-muted">El precio está en ' + esc(t.currency) + ' y no se convierte a otra moneda.</p></div>';
        setTotalLive(totalLiveText(t, needsMethod));
    }

    // El resumen no es región viva (y en escritorio va antes del formulario):
    // el total se anuncia aparte, en #stb-total-live, solo cuando cambia.
    function totalLiveText(t, needsMethod) {
        var p = state.product;
        if (needsMethod) return 'Elegí cómo querés recibirlo para ver el total.';
        if (!t.valid && t.error) return summaryHint(t.error);
        if (t.total == null) return '';
        var total = 'Total: ' + M.formatMoney(t.total, t.currency);
        if (p.kind === 'design') {
            var meta = tierMeta(state.tier);
            return (meta ? 'Licencia ' + meta.label + '. ' : '') + total + '.';
        }
        if (state.method === 'shipping') return total + (t.shipping > 0 ? ', con envío de ' + M.formatMoney(t.shipping, t.currency) : ', con envío sin cargo') + '.';
        if (state.method === 'pickup') return total + ', con retiro en el estudio.';
        return total + '.';
    }
    function setTotalLive(text) {
        var live = $('stb-total-live');
        if (!live || live.textContent === text) return;
        live.textContent = text;
    }

    function summaryHint(code) {
        if (code === 'tier_unavailable') return 'Elegí un nivel de licencia para ver el total.';
        if (code === 'variant_required') return 'Elegí una opción para ver el total.';
        return M.errorMessage({ message: 'store:' + code });
    }

    /* ------------------------------------------------------------------ */
    /* Formulario                                                          */
    /* ------------------------------------------------------------------ */

    function errorSlot(id) { return '<p class="wo-error-msg" id="' + id + '-error" hidden></p>'; }

    function inputField(o) {
        return '<div class="wo-field' + (o.wide ? ' stb-span-2' : '') + '">' +
            '<label class="wo-label" for="' + o.id + '">' + esc(o.label) + '</label>' +
            '<input class="wo-input" id="' + o.id + '" name="' + esc(o.name || o.id) + '" type="' + (o.type || 'text') + '"' +
            (o.autocomplete ? ' autocomplete="' + esc(o.autocomplete) + '"' : '') +
            (o.maxlength ? ' maxlength="' + Number(o.maxlength) + '"' : '') +
            (o.required ? ' required' : '') +
            (o.inputmode ? ' inputmode="' + esc(o.inputmode) + '"' : '') +
            (o.value ? ' value="' + esc(o.value) + '"' : '') +
            (o.help ? ' aria-describedby="' + o.id + '-help"' : '') + '>' +
            (o.help ? '<p class="wo-help" id="' + o.id + '-help">' + esc(o.help) + '</p>' : '') +
            errorSlot(o.id) + '</div>';
    }

    function tierFieldset() {
        var options = state.tiers.map(function (t) {
            var meta = tierMeta(t.id);
            var selected = state.tier === t.id && t.available;
            return '<label class="stb-option' + (selected ? ' is-selected' : '') + (t.available ? '' : ' is-disabled') + '">' +
                '<input type="radio" name="tier" value="' + esc(t.id) + '"' + (selected ? ' checked' : '') + (t.available ? '' : ' disabled') +
                ' aria-describedby="stb-tier-' + esc(t.id) + '-text">' +
                '<span class="stb-option-body">' +
                    '<span class="stb-option-title">Licencia ' + esc(t.label) + '</span>' +
                    '<span class="stb-option-text" id="stb-tier-' + esc(t.id) + '-text">' + esc(meta ? meta.summary : '') + '</span>' +
                    (!t.available && t.reason ? '<span class="stb-option-reason">' + esc(t.reason) + '</span>' : '') +
                '</span>' +
                '<span class="stb-option-price">' + esc(t.price != null ? M.formatMoney(t.price, state.product.currency) : '—') + '</span>' +
            '</label>';
        }).join('');
        return '<fieldset class="stb-fieldset" id="stb-tier-group" aria-describedby="stb-tier-error">' +
            '<legend class="stb-legend">Nivel de licencia</legend>' +
            '<div class="stb-options">' + options + '</div>' + errorSlot('stb-tier') + '</fieldset>';
    }

    function holderFieldset() {
        var v = state.viewer || {};
        var artistName = (v.artist && (v.artist.name || v.artist.username)) || buyerName() || 'Tu perfil de artista';
        return '<fieldset class="stb-fieldset" id="stb-holder-group">' +
            '<legend class="stb-legend">Titular de la licencia</legend>' +
            '<div id="stb-holder-edit">' +
                inputField({ id: 'stb-holder', label: 'Nombre de quien se tatúa', autocomplete: 'name', maxlength: 120, value: buyerName(),
                    help: 'Por defecto sos vos. Si es un regalo, poné el nombre de quien lo recibe: figura en el certificado.' }) +
            '</div>' +
            '<div id="stb-holder-fixed" hidden>' +
                '<div class="stb-readonly" aria-describedby="stb-holder-fixed-help"><span class="stb-meta">Titular</span><span>' + esc(artistName) + '</span></div>' +
                '<p class="wo-help" id="stb-holder-fixed-help">La licencia Artista sale a nombre de tu perfil de artista y no se puede cambiar.</p>' +
            '</div>' +
        '</fieldset>';
    }

    function digitalInfoBlock() {
        return '<div class="stb-fieldset">' +
            '<p class="stb-legend">Entrega</p>' +
            '<p class="stb-text stb-text--s">Descarga digital. Cuando el vendedor confirme tu pago, vas a poder bajar el original, el stencil y el certificado desde Mis compras.</p>' +
        '</div>';
    }

    function variantFieldset() {
        var list = variants();
        var opts = '';
        if (list.length !== 1) opts += '<option value="">Elegí una opción</option>';
        list.forEach(function (v) {
            var max = variantMax(v);
            var price = v.price_amount != null && Number(v.price_amount) > 0 ? ' · ' + M.formatMoney(v.price_amount, state.product.currency) : '';
            var stock = max <= 0 ? ' · Sin stock' : (v.low_stock != null ? ' · Quedan ' + v.low_stock : '');
            opts += '<option value="' + esc(v.id) + '"' + (String(state.variantId) === String(v.id) ? ' selected' : '') + (max <= 0 ? ' disabled' : '') + '>' +
                esc(v.label + price + stock) + '</option>';
        });
        var current = findVariant(state.variantId);
        var max = current ? variantMax(current) : MAX_QTY;
        return '<fieldset class="stb-fieldset">' +
            '<legend class="stb-legend">Producto</legend>' +
            '<div class="stb-field-row">' +
                '<div class="wo-field">' +
                    '<label class="wo-label" for="stb-variant">Opción</label>' +
                    '<select class="wo-select" id="stb-variant" name="variant" required>' + opts + '</select>' +
                    errorSlot('stb-variant') +
                '</div>' +
                '<div class="wo-field stb-qty">' +
                    '<label class="wo-label" for="stb-qty">Cantidad</label>' +
                    '<input class="wo-input" id="stb-qty" name="qty" type="number" inputmode="numeric" min="1" max="' + Math.max(1, max) + '" step="1" value="' + esc(state.quantity) + '" required>' +
                    errorSlot('stb-qty') +
                '</div>' +
            '</div>' +
        '</fieldset>';
    }

    function methodFieldset() {
        var p = state.product;
        var cur = p.currency;
        var opts = [];
        if (shippingOffered(p)) {
            var ship = Number(p.shipping_price_amount);
            opts.push({ id: 'shipping', title: 'Envío a domicilio', text: p.ships_to_note || 'El vendedor te lo despacha con seguimiento cuando confirme el pago.',
                price: ship > 0 ? M.formatMoney(ship, cur) : 'Sin cargo' });
        }
        if (pickupOffered(p)) {
            opts.push({ id: 'pickup', title: 'Retiro en el estudio', text: (p.pickup_note ? p.pickup_note + '. ' : '') + 'La dirección exacta te llega cuando se confirme el pago.',
                price: 'Sin cargo' });
        }
        var html = opts.map(function (o) {
            var selected = state.method === o.id;
            return '<label class="stb-option' + (selected ? ' is-selected' : '') + '">' +
                '<input type="radio" name="method" value="' + o.id + '"' + (selected ? ' checked' : '') + ' aria-describedby="stb-method-' + o.id + '-text">' +
                '<span class="stb-option-body"><span class="stb-option-title">' + esc(o.title) + '</span>' +
                '<span class="stb-option-text" id="stb-method-' + o.id + '-text">' + esc(o.text) + '</span></span>' +
                '<span class="stb-option-price">' + esc(o.price) + '</span></label>';
        }).join('');
        return '<fieldset class="stb-fieldset" id="stb-method-group" aria-describedby="stb-method-error">' +
            '<legend class="stb-legend">Entrega</legend>' +
            '<div class="stb-options">' + html + '</div>' + errorSlot('stb-method') + '</fieldset>';
    }

    function addressFieldset() {
        var p = state.product;
        var countries = countryOptions(p);
        var countryOpts = (countries.length === 1 ? '' : '<option value="">Elegí el país</option>') + countries.map(function (c) {
            return '<option value="' + esc(c.code) + '">' + esc(c.label) + '</option>';
        }).join('');
        var shipsHelp = Array.isArray(p.ships_to_countries) && p.ships_to_countries.length
            ? 'El vendedor envía a: ' + countries.map(function (c) { return c.label; }).join(', ') + '.'
            : null;
        return '<fieldset class="stb-fieldset" id="stb-address" hidden>' +
            '<legend class="stb-legend">Dirección de envío</legend>' +
            '<div class="stb-grid">' +
                inputField({ id: 'stb-recipient', name: 'recipient', label: 'Quién recibe', autocomplete: 'name', maxlength: 120, required: true, value: buyerName(), wide: true }) +
                inputField({ id: 'stb-line1', name: 'line1', label: 'Calle y número', autocomplete: 'address-line1', maxlength: 200, required: true, wide: true }) +
                inputField({ id: 'stb-line2', name: 'line2', label: 'Piso, depto. o referencia (opcional)', autocomplete: 'address-line2', maxlength: 200, wide: true }) +
                inputField({ id: 'stb-city', name: 'city', label: 'Ciudad', autocomplete: 'address-level2', maxlength: 120, required: true }) +
                inputField({ id: 'stb-region', name: 'region', label: 'Provincia o estado (opcional)', autocomplete: 'address-level1', maxlength: 120 }) +
                inputField({ id: 'stb-postal', name: 'postal_code', label: 'Código postal (opcional)', autocomplete: 'postal-code', maxlength: 20 }) +
                '<div class="wo-field">' +
                    '<label class="wo-label" for="stb-country">País</label>' +
                    '<select class="wo-select" id="stb-country" name="country" autocomplete="country" required' + (shipsHelp ? ' aria-describedby="stb-country-help"' : '') + '>' + countryOpts + '</select>' +
                    (shipsHelp ? '<p class="wo-help" id="stb-country-help">' + esc(shipsHelp) + '</p>' : '') +
                    errorSlot('stb-country') +
                '</div>' +
                inputField({ id: 'stb-phone', name: 'phone', type: 'tel', label: 'Teléfono (opcional)', autocomplete: 'tel', inputmode: 'tel', maxlength: 40, wide: true,
                    help: 'Para que el vendedor o el correo te contacten por la entrega.' }) +
            '</div>' +
        '</fieldset>';
    }

    function noteFieldset() {
        var isDesign = state.product.kind === 'design';
        return '<div class="wo-field">' +
            '<label class="wo-label" for="stb-note">' + (isDesign ? 'Nota para el artista (opcional)' : 'Nota para el vendedor (opcional)') + '</label>' +
            '<textarea class="wo-textarea" id="stb-note" name="note" maxlength="1000" rows="3" aria-describedby="stb-note-help"></textarea>' +
            '<p class="wo-help" id="stb-note-help">' + (isDesign ? 'Por ejemplo, en qué zona del cuerpo lo pensás tatuar.' : 'Por ejemplo, un horario para recibir el envío.') + '</p>' +
        '</div>';
    }

    function clausesHtml(list) {
        return '<ol class="stb-clauses">' + (list || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ol>';
    }

    // Condiciones de compra de merch, con la misma versión de términos que
    // valida la RPC (p_terms_version). Revisión legal pendiente.
    function purchaseConditions() {
        return [
            'Pagás con las instrucciones que vas a ver al confirmar el pedido, por el monto exacto y en la moneda del producto. Tenés 24 horas para pagar o informar el pago; si no, el pedido vence y el stock se libera.',
            'El vendedor confirma el pago y después prepara el pedido: te lo despacha con seguimiento o lo deja listo para retirar en el estudio.',
            'Cuando lo recibas, confirmalo desde Mis compras. Si no lo confirmás, se marca como entregado de forma automática unos días después del envío o de que quedó listo para retirar.',
            'Para cambios, devoluciones o problemas con el pedido, hablá primero con el vendedor por el contacto que figura en el pedido. Si no se resuelve, escribile a soporte de We Ötzi.'
        ];
    }

    // Aviso cuando un cambio de nivel desmarca los términos que ya se habían aceptado.
    function termsChangedCopy() {
        var meta = tierMeta(state.tier);
        return 'Cambiaste a la licencia ' + (meta ? meta.label : '') + ': leé y aceptá sus términos.';
    }

    function termsInnerHtml(opts) {
        opts = opts || {};
        var p = state.product;
        var version = M.TERMS_VERSION;
        var body;
        var summary;
        var label;
        if (p.kind === 'design') {
            var terms = state.tier ? M.termsFor(state.tier, version) : null;
            if (!terms) {
                return '<p class="stb-text stb-text--s stb-muted">Elegí un nivel de licencia para ver sus términos.</p>';
            }
            summary = 'Leer la licencia ' + tierMeta(state.tier).label + ' · v' + version;
            body = '<p>' + esc(terms.intro) + '</p><h3>' + esc(terms.title) + '</h3>' + clausesHtml(terms.clauses) +
                '<h3>' + esc(terms.commonTitle) + '</h3>' + clausesHtml(terms.common);
            label = M.termsAcceptanceLabel(state.tier, version);
        } else {
            summary = 'Leer las condiciones de compra · v' + version;
            body = clausesHtml(purchaseConditions());
            label = 'Leí y acepto las condiciones de compra (v' + version + ')';
        }
        var st = sellerSettings();
        var policies = '';
        if (st.shipping_policy || st.return_policy) {
            policies = '<details class="stb-terms"><summary>Políticas del vendedor</summary><div class="stb-terms-body">' +
                (st.shipping_policy ? '<h3>Envíos</h3><p class="stb-pre">' + esc(st.shipping_policy) + '</p>' : '') +
                (st.return_policy ? '<h3>Cambios y devoluciones</h3><p class="stb-pre">' + esc(st.return_policy) + '</p>' : '') +
            '</div></details>';
        }
        var notice = opts.reaccept && p.kind === 'design'
            ? '<p class="wo-help" id="stb-terms-notice">' + esc(termsChangedCopy()) + '</p>'
            : '';
        return '<details class="stb-terms"><summary>' + esc(summary) + '</summary><div class="stb-terms-body">' + body + '</div></details>' + policies +
            '<label class="stb-check" for="stb-terms-accept">' +
                '<input type="checkbox" id="stb-terms-accept" name="terms" required aria-describedby="' + (notice ? 'stb-terms-notice ' : '') + 'stb-terms-accept-error">' +
                '<span>' + esc(label) + '</span>' +
            '</label>' + notice + errorSlot('stb-terms-accept');
    }

    function termsFieldset() {
        return '<fieldset class="stb-fieldset">' +
            '<legend class="stb-legend">' + (state.product.kind === 'design' ? 'Licencia de uso' : 'Condiciones') + '</legend>' +
            '<div class="stb-terms-stack" id="stb-terms">' + termsInnerHtml() + '</div>' +
        '</fieldset>';
    }

    function renderFields() {
        var p = state.product;
        var parts = [];
        if (state.notice) {
            parts.push('<p class="wo-alert wo-alert--info" role="status">' + esc(state.notice) + '</p>');
        }
        if (p.kind === 'design') {
            parts.push(tierFieldset(), holderFieldset(), digitalInfoBlock());
        } else {
            parts.push(variantFieldset(), methodFieldset(), addressFieldset());
        }
        parts.push(noteFieldset(), termsFieldset());
        $('stb-fields').innerHTML = parts.join('');
        if (p.kind === 'merch') {
            var countries = countryOptions(p);
            if (countries.length === 1) $('stb-country').value = countries[0].code;
        }
        refreshDynamic();
        S.hydrateIcons($('stb-fields'));
    }

    // Partes que dependen de la selección, sin volver a pintar los inputs.
    function refreshDynamic() {
        var p = state.product;
        if (p.kind === 'design') {
            var meta = tierMeta(state.tier);
            var fixed = !!(meta && !meta.holderEditable);
            $('stb-holder-edit').hidden = fixed;
            $('stb-holder-fixed').hidden = !fixed;
            document.querySelectorAll('#stb-tier-group .stb-option').forEach(function (label) {
                var input = label.querySelector('input');
                label.classList.toggle('is-selected', !!(input && input.checked));
            });
        } else {
            var address = $('stb-address');
            if (address) address.hidden = state.method !== 'shipping';
            document.querySelectorAll('#stb-method-group .stb-option').forEach(function (label) {
                var input = label.querySelector('input');
                label.classList.toggle('is-selected', !!(input && input.checked));
            });
            var qty = $('stb-qty');
            var v = findVariant(state.variantId);
            if (qty) qty.max = String(Math.max(1, v ? variantMax(v) : MAX_QTY));
        }
        var help = $('stb-submit-help');
        if (help) {
            help.textContent = p.kind === 'merch'
                ? 'Al confirmar, apartamos el stock durante 24 horas mientras pagás.'
                : state.tier === 'exclusive'
                    ? 'Al confirmar, la exclusiva queda reservada para vos durante 24 horas mientras pagás.'
                    : 'Al confirmar se crea el pedido. Tenés 24 horas para pagarlo.';
        }
        renderSummary();
    }

    function onFieldsChange(e) {
        var t = e.target;
        if (!t || !t.name) return;
        if (t.name === 'tier') {
            var accepted = $('stb-terms-accept');
            var wasAccepted = !!(accepted && accepted.checked);
            state.tier = t.value;
            // Términos nuevos: hay que volver a aceptarlos. Si ya estaban
            // aceptados, se avisa en pantalla y al lector.
            $('stb-terms').innerHTML = termsInnerHtml({ reaccept: wasAccepted });
            if (wasAccepted) S.announce(termsChangedCopy());
            clearFieldError('stb-tier');
            syncParams();
        } else if (t.name === 'variant') {
            state.variantId = t.value || null;
            var v = findVariant(state.variantId);
            var max = v ? variantMax(v) : MAX_QTY;
            if (state.quantity > max && max > 0) { state.quantity = max; $('stb-qty').value = String(max); }
            clearFieldError('stb-variant');
            syncParams();
        } else if (t.name === 'qty') {
            var q = parseInt(t.value, 10);
            state.quantity = isFinite(q) ? q : 0;
            if (state.quantity >= 1) { clearFieldError('stb-qty'); syncParams(); }
        } else if (t.name === 'method') {
            state.method = t.value;
            clearFieldError('stb-method');
        } else if (t.name === 'terms' && t.checked) {
            clearFieldError('stb-terms-accept');
            var notice = $('stb-terms-notice');
            if (notice) notice.hidden = true;
        }
        refreshDynamic();
    }

    /* ------------------------------ errores ------------------------------ */

    function setFieldError(id, message) {
        var input = $(id);
        var slot = $(id + '-error');
        if (slot) { slot.textContent = message; slot.hidden = false; }
        if (input && input.matches && input.matches('input:not([type="radio"]):not([type="checkbox"]), select, textarea')) {
            input.classList.add('wo-input--error');
        }
        if (input) {
            input.setAttribute('aria-invalid', 'true');
            var described = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
            if (described.indexOf(id + '-error') === -1) described.push(id + '-error');
            input.setAttribute('aria-describedby', described.join(' '));
        }
    }
    function clearFieldError(id) {
        var input = $(id);
        var slot = $(id + '-error');
        if (slot) { slot.textContent = ''; slot.hidden = true; }
        if (input) { input.classList.remove('wo-input--error'); input.removeAttribute('aria-invalid'); }
    }
    function clearAllErrors() {
        document.querySelectorAll('#stb-fields .wo-error-msg').forEach(function (slot) {
            var id = slot.id.replace(/-error$/, '');
            clearFieldError(id);
        });
        var box = $('stb-form-errors');
        box.hidden = true;
        box.innerHTML = '';
    }
    function showFormErrors(list, intro) {
        var box = $('stb-form-errors');
        var items = list.map(function (e) {
            return '<li>' + (e.id ? '<a class="stb-link" href="#' + esc(e.id) + '" data-stb-focus="' + esc(e.id) + '">' + esc(e.message) + '</a>' : esc(e.message)) + '</li>';
        }).join('');
        box.innerHTML = '<i data-wo-icon="alert-circle" class="wo-icon-18" aria-hidden="true"></i>' +
            '<div><p class="stb-text stb-text--s stb-strong">' + esc(intro || 'Revisá estos datos antes de confirmar:') + '</p><ul>' + items + '</ul></div>';
        box.hidden = false;
        S.hydrateIcons(box);
        try { box.focus({ preventScroll: false }); } catch (e) { box.focus(); }
    }

    function showServerError(err) {
        var code = M.errorCode(err);
        var message = M.errorMessage(err, 'No pudimos crear el pedido. Probá de nuevo en unos minutos.');
        var box = $('stb-form-errors');
        var extra = '';
        if (code === 'pending_order_exists' || code === 'too_many_pending') {
            extra = ' <a class="stb-link" href="' + esc(M.purchasesUrl()) + '">Ver mis compras →</a>';
        } else if (code === 'email_unconfirmed') {
            extra = ' Después de confirmarlo, volvé a esta página.';
        } else if (code === 'terms_version_mismatch') {
            extra = ' <button type="button" class="stb-linkbtn" data-stb-reload>Recargar la página</button>';
        }
        box.innerHTML = '<i data-wo-icon="alert-circle" class="wo-icon-18" aria-hidden="true"></i><p class="stb-text stb-text--s">' + esc(message) + extra + '</p>';
        box.hidden = false;
        S.hydrateIcons(box);
        try { box.focus({ preventScroll: false }); } catch (e) { box.focus(); }
    }

    /* ------------------------------ envío del pedido ------------------------------ */

    function collectAddress() {
        function val(id) { var el = $(id); return el ? el.value : ''; }
        return {
            recipient: val('stb-recipient'), line1: val('stb-line1'), line2: val('stb-line2'), city: val('stb-city'),
            region: val('stb-region'), postal_code: val('stb-postal'), country: val('stb-country'), phone: val('stb-phone')
        };
    }

    var ADDRESS_FIELDS = { recipient: 'stb-recipient', line1: 'stb-line1', line2: 'stb-line2', city: 'stb-city', region: 'stb-region',
        postal_code: 'stb-postal', country: 'stb-country', phone: 'stb-phone' };

    function validate() {
        var p = state.product;
        var errors = [];
        var out = { holderName: null, shippingAddress: null };
        if (p.kind === 'design') {
            var tier = state.tiers.filter(function (t) { return t.id === state.tier; })[0];
            if (!tier || !tier.available) {
                errors.push({ id: 'stb-tier', message: tier && tier.reason ? tier.reason : 'Elegí un nivel de licencia.' });
            }
            var meta = tierMeta(state.tier);
            if (meta && meta.holderEditable) {
                var holder = String(($('stb-holder') || {}).value || '').trim();
                if (holder.length > 120) errors.push({ id: 'stb-holder', message: 'El nombre del titular puede tener hasta 120 caracteres.' });
                out.holderName = holder || null;
            }
        } else {
            if (!state.variantId) errors.push({ id: 'stb-variant', message: 'Elegí una opción del producto.' });
            var v = findVariant(state.variantId);
            var max = v ? variantMax(v) : MAX_QTY;
            if (!(state.quantity >= 1 && state.quantity <= MAX_QTY)) errors.push({ id: 'stb-qty', message: M.ERROR_COPY.invalid_quantity });
            else if (v && state.quantity > max) errors.push({ id: 'stb-qty', message: max > 0 ? 'Quedan ' + max + ' unidades de esta opción.' : M.ERROR_COPY.out_of_stock });
            if (state.method !== 'shipping' && state.method !== 'pickup') errors.push({ id: 'stb-method', message: 'Elegí cómo querés recibirlo.' });
            if (state.method === 'shipping') {
                var check = M.validateShippingAddress(collectAddress(), p);
                Object.keys(check.errors).forEach(function (key) {
                    if (ADDRESS_FIELDS[key]) errors.push({ id: ADDRESS_FIELDS[key], message: check.errors[key] });
                });
                out.shippingAddress = check.value;
            }
        }
        var terms = $('stb-terms-accept');
        if (!terms || !terms.checked) {
            errors.push({ id: 'stb-terms-accept', message: p.kind === 'design' ? 'Aceptá los términos de la licencia para seguir.' : 'Aceptá las condiciones de compra para seguir.' });
        }
        var t = totals();
        if (!errors.length && !t.valid && t.error) errors.push({ id: null, message: M.errorMessage({ message: 'store:' + t.error }) });
        out.errors = errors;
        return out;
    }

    function onSubmit(e) {
        e.preventDefault();
        if (state.busy) return;
        clearAllErrors();
        var check = validate();
        if (check.errors.length) {
            check.errors.forEach(function (err) { if (err.id) setFieldError(err.id, err.message); });
            showFormErrors(check.errors);
            return;
        }
        var p = state.product;
        var btn = $('stb-submit');
        state.busy = true;
        S.setBusy(btn, true, 'Creando el pedido…');
        var combo = state.params;
        var note = String(($('stb-note') || {}).value || '').trim();
        Store.createOrder({
            productId: p.id,
            tier: p.kind === 'design' ? state.tier : null,
            holderName: check.holderName,
            variantId: p.kind === 'merch' ? state.variantId : null,
            quantity: p.kind === 'merch' ? state.quantity : 1,
            method: p.kind === 'design' ? 'digital' : state.method,
            shippingAddress: p.kind === 'merch' && state.method === 'shipping' ? check.shippingAddress : null,
            buyerNote: note || null,
            termsVersion: M.TERMS_VERSION,
            idempotencyKey: idempotencyKey(combo)
        }).then(function (order) {
            if (!order || !order.id) throw new Error('Pedido sin datos');
            forgetIdempotencyKey(combo);
            ssDel(PARAMS_KEY);
            state.order = order;
            S.setParams({ item: null, license: null, variant: null, qty: null, pedido: order.id });
            renderDone(order);
        }).catch(function (err) {
            if (window.console) console.warn('[store-checkout] createOrder:', err && err.message);
            showServerError(err);
        }).then(function () {
            state.busy = false;
            S.setBusy(btn, false);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Pedido creado                                                       */
    /* ------------------------------------------------------------------ */

    function orderSummaryHtml(order, view) {
        var item = view.item;
        var p = state.product;
        var title = (item && item.title) || (p && p.title) || 'Tu pedido';
        var imagePath = (item && item.imagePath) || (p && p.images && p.images[0] && p.images[0].path) || null;
        var line = M.KIND_LABELS[(item && item.kind) || (p && p.kind)] || '';
        if (item && item.tierLabel) line += ' · Licencia ' + item.tierLabel;
        else if (!item && p && p.kind === 'design' && tierMeta(state.tier)) line += ' · Licencia ' + tierMeta(state.tier).label;
        if (item && item.variantLabel) line += ' · ' + item.variantLabel;
        var rows = '<div class="stb-total-row"><dt>Subtotal</dt><dd>' + esc(view.totals.subtotalLabel) + '</dd></div>';
        if (view.method === 'shipping') rows += '<div class="stb-total-row"><dt>Envío</dt><dd>' + esc(view.totals.shipping > 0 ? view.totals.shippingLabel : 'Sin cargo') + '</dd></div>';
        if (view.method === 'pickup') rows += '<div class="stb-total-row"><dt>Retiro en el estudio</dt><dd>Sin cargo</dd></div>';
        rows += '<div class="stb-total-row stb-total-row--grand"><dt>Total</dt><dd>' + esc(view.totals.totalLabel) + '</dd></div>';
        return '<div class="stb-block"><div class="stb-summary">' +
                '<div class="stb-thumb">' + S.previewImg(imagePath, { alt: '' }) + '</div>' +
                '<div class="stb-summary-body"><p class="stb-meta">' + esc(line) + '</p><p class="stb-summary-title">' + esc(title) + '</p>' +
                '<p class="stb-summary-line">' + esc(view.methodLabel) + '</p></div>' +
            '</div></div>' +
            '<div class="stb-block"><dl class="stb-totals">' + rows + '</dl></div>';
    }

    function paymentBlockHtml(order, view) {
        var manual = !order.payment_provider || order.payment_provider === 'manual';
        if (!manual) {
            // TODO(store-pagos): con un proveedor real (Stripe, Mercado Pago) hay
            // que llamar a POST /api/store/orders/:id/checkout con Bearer y seguir
            // el redirectUrl o las instrucciones del adaptador. WeotziData.Store
            // todavía no expone ese método (pedido en el reporte del agente);
            // mientras tanto se muestra un mensaje genérico.
            return '<div class="stb-block"><h2 class="stb-block-title">Pago</h2>' +
                '<p class="stb-text">Estamos preparando el pago de este pedido. Lo vas a poder completar desde Mis compras en unos minutos.</p></div>';
        }
        var payTo = view.collector === 'platform' ? 'Le pagás a We Ötzi' : 'Le pagás directo al vendedor';
        var instructions = order.payment_instructions
            ? '<p class="stb-pre">' + esc(order.payment_instructions) + '</p>'
            : '<p class="stb-text">El vendedor todavía no cargó las instrucciones. Escribile por el contacto de abajo.</p>';
        var contact = order.seller_contact
            ? '<div class="stb-block"><h3 class="stb-block-title">Contacto del vendedor</h3><p class="stb-text">' + esc(order.seller_contact) + '</p>' +
              '<p class="stb-text stb-text--s stb-muted">Escribile con el número de pedido si tenés dudas sobre el pago o la entrega.</p></div>'
            : '';
        return '<div class="stb-block"><h2 class="stb-block-title">Cómo pagar</h2>' +
                '<p class="stb-block-sub">' + esc(payTo) + '. Pagá el monto exacto: ' + esc(view.totals.totalLabel) + '.</p>' + instructions +
            '</div>' + contact;
    }

    function reportBlockHtml(order, view) {
        var manual = !order.payment_provider || order.payment_provider === 'manual';
        if (!manual || view.collector === 'provider' || view.status !== 'pending_payment') return '';
        if (view.paymentReported) {
            var next = view.nextAction && view.nextAction.kind === 'info' ? view.nextAction.label : 'Informaste el pago.';
            return '<div class="stb-block" id="stb-report-block"><h2 class="stb-block-title">Pago informado</h2>' +
                '<p class="stb-text">' + esc(next) + '</p>' +
                (view.paymentReference ? '<p class="stb-text stb-text--s stb-muted">Referencia: ' + esc(view.paymentReference) + '</p>' : '') +
                (order.expires_at ? '<p class="stb-text stb-text--s stb-muted">El pedido queda reservado hasta el ' + esc(view.expiresLabel) + '.</p>' : '') +
            '</div>';
        }
        if (view.overdue) {
            return '<div class="stb-block" id="stb-report-block"><p class="wo-alert wo-alert--warning">Venció el plazo para pagar este pedido.</p></div>';
        }
        return '<div class="stb-block" id="stb-report-block">' +
            '<h2 class="stb-block-title">Informá tu pago</h2>' +
            '<p class="stb-block-sub">Cuando pagues, dejá la referencia del comprobante para que el vendedor lo encuentre rápido.</p>' +
            '<form class="stb-form" id="stb-report-form" novalidate>' +
                '<div class="wo-field">' +
                    '<label class="wo-label" for="stb-report-ref">Referencia del comprobante</label>' +
                    '<input class="wo-input" id="stb-report-ref" name="reference" type="text" maxlength="200" required aria-describedby="stb-report-ref-help">' +
                    '<p class="wo-help" id="stb-report-ref-help">Por ejemplo, el número de operación de la transferencia o el nombre de quien pagó.</p>' +
                    '<p class="wo-error-msg" id="stb-report-ref-error" hidden></p>' +
                '</div>' +
                '<div class="stb-actions"><button class="wo-btn wo-btn--hard" type="submit" id="stb-report-submit">Ya pagué →</button></div>' +
            '</form>' +
        '</div>';
    }

    function renderDone(order) {
        state.order = order;
        var view = M.orderView(order, { role: 'buyer' });
        var pending = view.status === 'pending_payment';
        setHeader('Store · ' + view.numberLabel, 'Pedido creado',
            pending ? 'Pagalo con las instrucciones de abajo y, cuando lo hagas, informá el comprobante.' : null);
        var head = '<div class="stb-block"><div class="stb-done-head">' +
                '<span class="wo-marks stb-done-marks" aria-hidden="true"><span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span></span>' +
                '<p class="stb-meta">' + esc(view.numberLabel) + ' · <span class="' + esc(view.statusTag) + ' sts-tag-s">' + esc(view.statusLabel) + '</span></p>' +
                '<p class="stb-text">Total del pedido: <span class="stb-strong">' + esc(view.totals.totalLabel) + '</span></p>' +
                (pending && view.deadlineLabel && !view.paymentReported ? '<p class="stb-deadline">' + esc(view.deadlineLabel) + '</p>' : '') +
            '</div></div>';
        var links = '<div class="stb-block"><div class="stb-inline-actions">' +
                '<a class="wo-btn wo-btn--ghost wo-btn--hard" href="' + esc(M.purchasesUrl(order.id)) + '">Ver mis compras →</a>' +
                (seller().handle ? '<a class="stb-link" href="' + esc(M.storeUrl(seller().handle)) + '">Seguir mirando la Store →</a>' : '') +
            '</div></div>';
        var html = '<div class="stb-layout">' +
            '<aside class="stb-aside" aria-label="Resumen del pedido"><div class="sts-panel">' + orderSummaryHtml(order, view) + '</div></aside>' +
            '<div class="stb-main"><div class="sts-panel">' + head + (pending ? paymentBlockHtml(order, view) + reportBlockHtml(order, view) : '') + links + '</div></div>' +
        '</div>';
        $('stb-done').innerHTML = html;
        S.setTitle('Pedido creado');
        showState('stb-done', { focus: true });
        var form = $('stb-report-form');
        if (form) form.addEventListener('submit', onReport);
    }

    function onReport(e) {
        e.preventDefault();
        var input = $('stb-report-ref');
        var slot = $('stb-report-ref-error');
        var ref = String(input.value || '').trim();
        slot.hidden = true;
        input.classList.remove('wo-input--error');
        input.removeAttribute('aria-invalid');
        if (!ref) {
            slot.textContent = 'Ingresá la referencia del comprobante.';
            slot.hidden = false;
            input.classList.add('wo-input--error');
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', 'stb-report-ref-help stb-report-ref-error');
            input.focus();
            return;
        }
        var btn = $('stb-report-submit');
        S.setBusy(btn, true, 'Informando…');
        Store.reportPayment(state.order.id, ref).then(function (order) {
            S.notify('Pago informado. El vendedor lo va a confirmar.', 'success');
            renderDone(Object.assign({}, state.order, order || {}, { buyer_payment_reference: (order && order.buyer_payment_reference) || ref }));
        }).catch(function (err) {
            S.setBusy(btn, false);
            S.notifyError(err, 'No pudimos informar el pago. Probá de nuevo.');
        });
    }

    /* ------------------------------------------------------------------ */
    /* Sesión                                                              */
    /* ------------------------------------------------------------------ */

    function wireAuthLinks() {
        var links = S.loginLinks();
        $('stb-link-register').href = links.register;
        $('stb-link-artist').href = links.artist;
        $('stb-link-recover').href = app('/recover?from=client');
    }

    function loginErrorCopy(error) {
        var msg = String((error && error.message) || '');
        if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
        if (/email not confirmed/i.test(msg)) return 'Confirmá tu email antes de ingresar. Revisá tu bandeja de entrada.';
        if (/rate limit|too many/i.test(msg)) return 'Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo.';
        return 'No pudimos iniciar sesión. Probá de nuevo.';
    }

    function onLogin(e) {
        e.preventDefault();
        var email = String($('stb-login-email').value || '').trim().toLowerCase();
        var password = $('stb-login-password').value || '';
        var errorEl = $('stb-login-error');
        errorEl.hidden = true;
        if (!email || !password) {
            errorEl.textContent = 'Ingresá tu email y tu contraseña.';
            errorEl.hidden = false;
            (email ? $('stb-login-password') : $('stb-login-email')).focus();
            return;
        }
        var client = S.getClient();
        if (!client || !client.auth || typeof client.auth.signInWithPassword !== 'function') {
            errorEl.textContent = 'No pudimos conectar con tu cuenta. Probá de nuevo en unos minutos.';
            errorEl.hidden = false;
            return;
        }
        var btn = $('stb-login-submit');
        S.setBusy(btn, true, 'Ingresando…');
        // Auth (no datos): cualquier cuenta sirve, también la de artista.
        Promise.resolve(client.auth.signInWithPassword({ email: email, password: password })).then(function (res) {
            if (res && res.error) throw res.error;
            return S.viewer({ refresh: true });
        }).then(function (v) {
            state.viewer = v;
            S.mountStoreTopbar('store-topbar', {});
            S.notify('Sesión iniciada.', 'success');
            // El botón donde estaba el foco queda oculto con #stb-auth: el foco
            // pasa al título del formulario del pedido.
            startCheckout({ focus: true });
        }).catch(function (err) {
            errorEl.textContent = loginErrorCopy(err);
            errorEl.hidden = false;
            $('stb-login-password').focus();
        }).then(function () { S.setBusy(btn, false); });
    }

    /* ------------------------------------------------------------------ */
    /* Arranque                                                            */
    /* ------------------------------------------------------------------ */

    // opts.focus: mover el foco al título (después del ingreso inline). En la
    // carga normal de la página no se mueve.
    function startCheckout(opts) {
        var p = state.product;
        if (viewerIsSeller()) {
            showMessage({ icon: 'slash', title: 'No podés comprar tus propios productos.', text: 'Este producto es de tu Store. Lo podés editar desde Mi Store.',
                actionLabel: 'Ir a Mi Store →', actionHref: '/artist/store/' });
            return;
        }
        var v = state.viewer || {};
        if (p.kind === 'design') {
            state.tiers = M.availableTiers(p, { viewerIsArtist: v.role === 'artist' && !!v.artistReady });
            var wanted = state.tiers.filter(function (t) { return t.id === state.params.license; })[0];
            var firstAvailable = state.tiers.filter(function (t) { return t.available; })[0];
            // Un nivel pedido que no se puede comprar no se preselecciona: se
            // explica arriba y la persona elige otro.
            state.notice = null;
            if (wanted && !wanted.available) {
                state.tier = null;
                state.notice = (M.ERROR_COPY[wanted.code] || ('La licencia ' + wanted.label + ' no está disponible.')) + ' Elegí otro nivel.';
            } else {
                state.tier = wanted ? wanted.id : (firstAvailable ? firstAvailable.id : null);
            }
            if (!state.tiers.some(function (t) { return t.available; })) {
                showMessage({ icon: 'lock', title: 'Este diseño no está disponible para comprar ahora.',
                    text: (state.tiers[0] && state.tiers[0].reason) || M.ERROR_COPY.product_unavailable,
                    actionLabel: 'Volver al diseño →', actionHref: M.itemUrl(p.id) });
                return;
            }
        } else {
            var list = variants();
            var wantedVariant = state.params.variant ? findVariant(state.params.variant) : null;
            if (wantedVariant && variantMax(wantedVariant) > 0) state.variantId = wantedVariant.id;
            else {
                var inStock = list.filter(function (x) { return variantMax(x) > 0; });
                state.variantId = inStock.length === 1 ? inStock[0].id : null;
            }
            state.quantity = state.params.qty || 1;
            var methods = [];
            if (shippingOffered(p)) methods.push('shipping');
            if (pickupOffered(p)) methods.push('pickup');
            if (!methods.length) {
                showMessage({ icon: 'truck', title: 'Este producto no tiene envío ni retiro disponibles.', text: 'Escribile al vendedor desde su Store para coordinar.',
                    actionLabel: 'Volver al producto →', actionHref: M.itemUrl(p.id) });
                return;
            }
            state.method = methods.length === 1 ? methods[0] : null;
        }
        setHeader('Store · Checkout', 'Confirmá tu compra', 'Revisá el pedido y confirmalo. Después vas a ver cómo pagarlo.');
        S.setTitle('Checkout');
        renderFields();
        showState('stb-checkout', { focus: !!(opts && opts.focus) });
    }

    function showAuth() {
        setHeader('Store · Checkout', 'Confirmá tu compra', 'Tu pedido, tu licencia y tus descargas quedan guardados en tu cuenta.');
        renderAuthSummary();
        wireAuthLinks();
        showState('stb-auth');
    }

    function loadExistingOrder(orderId) {
        return S.requireSession({ returnTo: S.stripBase(window.location.pathname) + window.location.search }).then(function (session) {
            if (!session) {
                showMessage({ icon: 'lock', title: 'Ingresá para ver tu pedido.', text: 'Tus pedidos están en tu cuenta.',
                    actionLabel: 'Ingresá →', actionHref: S.stripBase(S.loginLinks(M.purchasesUrl(orderId)).client) });
                return;
            }
            return Store.getMyOrder(orderId).then(function (order) {
                if (!order) {
                    showMessage({ icon: 'search', title: 'No encontramos ese pedido.', text: 'Puede que sea de otra cuenta. Revisá tus compras.',
                        actionLabel: 'Ver mis compras →', actionHref: '/store/purchases/' });
                    return;
                }
                if (order.status !== 'pending_payment') { window.location.replace(M.purchasesUrl(order.id)); return; }
                renderDone(order);
            });
        });
    }

    function init() {
        if (!M || !S || !Store) {
            if (window.console) console.error('[store-checkout] Faltan store-model.js, store-shell.js o data/store-repo.js.');
            return;
        }
        $('stb-login-form').addEventListener('submit', onLogin);
        $('stb-checkout-form').addEventListener('submit', onSubmit);
        $('stb-fields').addEventListener('change', onFieldsChange);
        $('stb-fields').addEventListener('input', function (e) { if (e.target && e.target.name === 'qty') onFieldsChange(e); });
        document.addEventListener('click', function (e) {
            var focusLink = e.target.closest && e.target.closest('[data-stb-focus]');
            if (focusLink) {
                e.preventDefault();
                var focusId = focusLink.getAttribute('data-stb-focus');
                var target = $(focusId) || $(focusId + '-group');
                if (target) {
                    var input = target.matches('input,select,textarea') ? target : target.querySelector('input:not([disabled]),select,textarea');
                    (input || target).focus();
                }
                return;
            }
            if (e.target.closest && e.target.closest('[data-stb-reload]')) window.location.reload();
        });

        S.mountStoreTopbar('store-topbar', {});
        S.isStoreEnabled().then(function (enabled) {
            if (!enabled) {
                showMessage({ icon: 'clock', title: 'La Store todavía no está disponible.', text: 'Estamos terminando de prepararla. Volvé a mirarla en unos días.',
                    actionLabel: 'Explorá artistas →', actionHref: '/marketplace' });
                return null;
            }
            var orderId = S.param('pedido');
            if (orderId) return loadExistingOrder(orderId);
            state.params = readParams();
            if (!state.params.item) {
                showMessage({ icon: 'shopping-bag', title: 'No encontramos qué querés comprar.', text: 'Elegí un diseño o un producto en la Store de un artista y tocá «Comprar».',
                    actionLabel: 'Explorá artistas →', actionHref: '/marketplace' });
                return null;
            }
            return Promise.all([Store.getPublicProduct(state.params.item), S.viewer()]).then(function (res) {
                var bundle = res[0];
                state.viewer = res[1];
                if (!bundle || !bundle.product) {
                    ssDel(PARAMS_KEY);
                    showMessage({ icon: 'package', title: 'Este producto ya no está disponible.', text: 'Puede que el artista lo haya pausado o que ya se haya vendido.',
                        actionLabel: 'Explorá artistas →', actionHref: '/marketplace' });
                    return;
                }
                state.bundle = bundle;
                state.product = bundle.product;
                if (!state.viewer || !state.viewer.session) showAuth();
                else startCheckout();
            });
        }).catch(function (err) {
            if (window.console) console.error('[store-checkout]', err);
            showMessage({ icon: 'alert-circle', title: 'No pudimos cargar el checkout.', text: 'Probá de nuevo en unos minutos.',
                actionLabel: 'Explorá artistas →', actionHref: '/marketplace' });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
