/**
 * WE OTZI - Store pública: vitrina del artista y ficha de producto
 * ----------------------------------------------------------------
 *   /store/?artist=<username>[&tipo=disenos|merch]   body[data-stc-page="storefront"]
 *   /store/item/?id=<uuid>[&license=&variant=&qty=]   body[data-stc-page="item"]
 *
 * Contrato: docs/plans/2026-10-30-store-artista.md (§8.3 y §8.4). Datos SOLO
 * vía window.WeotziData.Store (getStorefront / getPublicProduct: RPC públicas
 * que devuelven null ante cualquier error). Topbar, sesión, diálogos y helpers
 * de UI en WeotziStoreShell; reglas, copy, precios y rutas en
 * WeotziStoreModel. Estilos .stc-* en shared/css/store-catalog.css.
 *
 *   - Los montos van siempre en la moneda del producto con su código ISO
 *     (Model.formatMoney) y nunca se convierten.
 *   - Todo dato que llega del servidor entra al HTML escapado con Shell.esc.
 *   - Gate: Shell.isStoreEnabled() (feature + tablas desplegadas).
 *
 * Alias de dependencias (los fija tests/store-catalog-page.test.js): Model,
 * Shell y Repo. Expone window.WeotziStoreCatalog con los helpers puros y los
 * armadores de HTML; el arranque depende de body[data-stc-page].
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root) root.WeotziStoreCatalog = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    var Model = root.WeotziStoreModel || null;
    var Shell = root.WeotziStoreShell || null;

    function storeRepo() { return (root.WeotziData && root.WeotziData.Store) || null; }

    var LIMITS = (Model && Model.LIMITS) || {};
    var MAX_QTY = LIMITS.MAX_QUANTITY || 20;
    var LOW_STOCK = LIMITS.LOW_STOCK || 5;
    var FILTERS = { todo: null, disenos: 'design', merch: 'merch' };
    var FILTER_ORDER = ['todo', 'disenos', 'merch'];
    var FILTER_LABELS = { todo: 'Todo', disenos: 'Diseños', merch: 'Merch' };
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var LAST_FRONT_KEY = 'wo_store_last_front';
    var INCLUDE_ICONS = { original: 'image', stencil: 'printer', certificate: 'award' };
    var MARKETPLACE = '/marketplace';

    /* ------------------------------------------------------------------ */
    /* Utilidades                                                          */
    /* ------------------------------------------------------------------ */

    function num(value) {
        if (value === null || value === undefined || value === '') return NaN;
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isFinite(n) ? n : NaN;
    }
    function round2(n) { return Math.round(n * 100) / 100; }
    function list(value) { return Array.isArray(value) ? value : []; }
    function text(value) { return value == null ? '' : String(value).trim(); }
    function esc(value) { return Shell.esc(value); }
    function money(amount, currency) { return Model.formatMoney(amount, currency); }
    function currencyOf(product) { return text(product && product.currency).toUpperCase() || 'USD'; }
    function countLabel(n) { return n === 1 ? '1 producto' : n + ' productos'; }
    function sameId(a, b) { return a != null && b != null && String(a) === String(b); }

    function profileUrl(handle) { return Model.appPath('/artist/profile/?artist=' + encodeURIComponent(text(handle))); }
    function editUrl(productId) { return Model.appPath('/artist/store/?editar=' + encodeURIComponent(text(productId))); }
    function manageUrl() { return Model.appPath('/artist/store/'); }

    // Avatar del vendedor: solo https, data:image o rutas propias (nunca otros
    // esquemas). Sin URL válida se pintan las iniciales.
    function avatarUrl(url) {
        var s = text(url);
        if (!s) return '';
        if (/^https:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
        if (s.charAt(0) === '/' && s.charAt(1) !== '/') return Model.appPath(s);
        return '';
    }

    function placeText(seller) {
        var s = seller || {};
        return [text(s.city), text(s.country)].filter(Boolean).join(', ');
    }

    // ISO-2 → nombre en español («AR» → «Argentina»); si no se puede, el código.
    var regionNames = null;
    function countryName(code) {
        var c = text(code).toUpperCase();
        if (!/^[A-Z]{2}$/.test(c)) return c;
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
    // «Argentina», «Argentina y Uruguay», «Chile, España e Italia».
    function joinList(items) {
        var xs = list(items).filter(Boolean);
        if (xs.length <= 1) return xs.join('');
        var last = xs[xs.length - 1];
        var y = /^(i|hi)(?![aeoué])/i.test(last) ? ' e ' : ' y ';
        return xs.slice(0, -1).join(', ') + y + last;
    }
    function countryList(codes) { return joinList(list(codes).map(countryName)); }

    // 9 → «9» · 7.5 → «7,5».
    function formatCm(value) {
        var n = num(value);
        if (!(n > 0)) return '';
        return String(Math.round(n * 10) / 10).replace('.', ',');
    }
    function sizeLabel(product) {
        var p = product || {};
        var w = formatCm(p.design_width_cm);
        var h = formatCm(p.design_height_cm);
        if (w && h) return w + ' × ' + h + ' cm';
        if (w) return w + ' cm de ancho';
        if (h) return h + ' cm de alto';
        return '';
    }

    /* ------------------------------------------------------------------ */
    /* Vitrina: filtros                                                    */
    /* ------------------------------------------------------------------ */

    function kindCounts(products) {
        var out = { all: 0, design: 0, merch: 0 };
        list(products).forEach(function (p) {
            if (!p) return;
            out.all++;
            if (p.kind === 'design') out.design++;
            else if (p.kind === 'merch') out.merch++;
        });
        return out;
    }

    // Los chips solo tienen sentido si hay diseños y merch a la vez.
    function showFilters(products) {
        var c = kindCounts(products);
        return c.design > 0 && c.merch > 0;
    }

    // ?tipo= válido y útil (hay productos de ese tipo y de otro); si no, 'todo'.
    function normalizeFilter(value, products) {
        var key = text(value).toLowerCase();
        if (key === 'diseños' || key === 'diseno' || key === 'diseño') key = 'disenos';
        if (!Object.prototype.hasOwnProperty.call(FILTERS, key) || !FILTERS[key]) return 'todo';
        return showFilters(products) ? key : 'todo';
    }

    function filterProducts(products, key) {
        var kind = FILTERS[key] || null;
        return list(products).filter(function (p) { return p && (!kind || p.kind === kind); });
    }

    /* ------------------------------------------------------------------ */
    /* Precios                                                             */
    /* ------------------------------------------------------------------ */

    // Precio base del merch. La ficha pública trae price_from y el override de
    // cada variante, pero no siempre price_amount: si falta, se deduce cuando
    // es exacto (ninguna variante con override por debajo de price_from).
    // exact = false → el precio de las variantes que heredan es «desde».
    function merchPricing(product) {
        var p = product || {};
        var base = num(p.price_amount);
        if (base > 0) return { base: round2(base), exact: true };
        var variants = list(p.variants);
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

    // Copia del producto con price_amount resuelto, para orderTotals.
    function pricedProduct(product) {
        if (!product || product.kind !== 'merch' || num(product.price_amount) > 0) return product;
        var pricing = merchPricing(product);
        if (pricing.base == null) return product;
        return Object.assign({}, product, { price_amount: pricing.base });
    }

    function variantPrice(product, variant) {
        var o = num(variant && variant.price_amount);
        if (o > 0) return { amount: round2(o), approx: false };
        var pricing = merchPricing(product);
        return { amount: pricing.base, approx: pricing.base != null && !pricing.exact };
    }

    // «Desde USD 35» si hay varios precios posibles; si no, el precio solo.
    function priceSummary(product) {
        var p = product || {};
        var prices = [];
        var approx = false;
        if (p.kind === 'design') {
            list(Model.LICENSE_TIERS).forEach(function (tier) {
                var v = num(p[tier.priceField]);
                if (v > 0) prices.push(round2(v));
            });
        } else {
            var variants = list(p.variants);
            if (variants.length) {
                variants.forEach(function (v) {
                    var vp = variantPrice(p, v);
                    if (vp.amount == null) return;
                    prices.push(vp.amount);
                    if (vp.approx) approx = true;
                });
            } else {
                var base = merchPricing(p).base;
                if (base != null) prices.push(base);
            }
        }
        if (!prices.length) {
            var from = Model.priceFrom(p);
            return from == null
                ? { amount: null, from: false, label: '' }
                : { amount: from, from: true, label: 'Desde ' + money(from, currencyOf(p)) };
        }
        var min = Math.min.apply(null, prices);
        var several = approx || prices.some(function (x) { return x !== min; });
        return { amount: min, from: several, label: (several ? 'Desde ' : '') + money(min, currencyOf(p)) };
    }

    // «Diseño · Fine line» / «Merch · Remeras».
    function kindLine(product) {
        var p = product || {};
        var detail = p.kind === 'design' ? text(p.design_style) || text(p.category) : text(p.category);
        return [(Model.KIND_LABELS && Model.KIND_LABELS[p.kind]) || '', detail].filter(Boolean).join(' · ');
    }

    /* ------------------------------------------------------------------ */
    /* Merch: variantes, cantidad y entrega                                */
    /* ------------------------------------------------------------------ */

    function findVariant(product, variantId) {
        if (variantId == null || variantId === '') return null;
        var vs = list(product && product.variants);
        for (var i = 0; i < vs.length; i++) if (vs[i] && sameId(vs[i].id, variantId)) return vs[i];
        return null;
    }

    function variantName(variant) {
        var v = variant || {};
        return text(v.label) || [text(v.size), text(v.color)].filter(Boolean).join(' · ') || 'Variante';
    }

    // { available, max, note } de una variante pública (in_stock / low_stock)
    // o de una fila del vendedor (stock / active).
    function variantState(variant) {
        var v = variant || {};
        var soldOut = v.active === false || v.in_stock === false || (v.stock != null && !(num(v.stock) > 0));
        var low = NaN;
        if (v.low_stock != null) low = num(v.low_stock);
        else if (v.stock != null && num(v.stock) <= LOW_STOCK) low = num(v.stock);
        if (soldOut || (isFinite(low) && low <= 0)) return { available: false, max: 0, note: 'Sin stock' };
        var stock = v.stock != null ? num(v.stock) : (isFinite(low) ? low : Infinity);
        return {
            available: true,
            max: Math.max(1, Math.min(MAX_QTY, Math.floor(stock))),
            note: isFinite(low) ? (low === 1 ? 'Queda 1' : 'Quedan ' + low) : ''
        };
    }

    function variantLegend(variants) {
        var vs = list(variants).filter(Boolean);
        if (vs.length && vs.every(function (v) { return text(v.size); })) return { label: 'Talle', prompt: 'Elegí un talle' };
        if (vs.length && vs.every(function (v) { return text(v.color) && !text(v.size); })) return { label: 'Color', prompt: 'Elegí un color' };
        return { label: 'Variante', prompt: 'Elegí una variante' };
    }

    function variantPricesVary(product) {
        var seen = {};
        var count = 0;
        list(product && product.variants).forEach(function (v) {
            var vp = variantPrice(product, v);
            var key = vp.amount == null ? 'x' : String(vp.amount);
            if (!seen[key]) { seen[key] = true; count++; }
        });
        return count > 1;
    }

    function colorsVary(variants) {
        var colors = {};
        list(variants).forEach(function (v) { if (v && text(v.color)) colors[text(v.color).toLowerCase()] = true; });
        return Object.keys(colors).length > 1;
    }

    function clampQty(value, max) {
        var n = Math.floor(num(value));
        if (!(n >= 1)) n = 1;
        var m = max > 0 ? Math.min(max, MAX_QTY) : 1;
        return Math.min(n, m);
    }

    function qtyHelp(max) {
        if (max > 0 && max < MAX_QTY) return 'Podés pedir hasta ' + max + (max === 1 ? ' unidad' : ' unidades') + ' de esta variante.';
        return 'Hasta ' + MAX_QTY + ' unidades por pedido.';
    }

    // Métodos de entrega que ofrece el producto. El envío exige precio de
    // envío cargado (la RPC rechaza shipping sin shipping_price_amount).
    function deliveryMethods(product) {
        var p = product || {};
        var out = [];
        if (p.shipping_price_amount != null && p.shipping_price_amount !== '' && num(p.shipping_price_amount) >= 0) out.push('shipping');
        if (p.pickup_available === true) out.push('pickup');
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* Visitante y niveles de licencia                                     */
    /* ------------------------------------------------------------------ */

    function viewerFlags(seller, viewer) {
        var v = viewer || {};
        var s = seller || {};
        var userId = v.user && v.user.id ? String(v.user.id) : '';
        return {
            role: v.role || 'anon',
            isArtist: v.role === 'artist' && v.artistReady === true,
            isSeller: !!userId && s.type === 'artist' && sameId(s.id, userId)
        };
    }

    // Las tres tarjetas de nivel con resumen, bullets y, para el nivel Artista
    // de quien no es artista, el link de ingreso de artista.
    function tierOptions(product, flags) {
        var f = flags || {};
        var rows = Model.availableTiers(product, { viewerIsArtist: !!f.isArtist, viewerIsSeller: !!f.isSeller });
        return rows.map(function (row) {
            var meta = Model.tierById(row.id) || {};
            var out = Object.assign({}, row, { summary: meta.summary || '', bullets: list(meta.bullets).slice(), link: null });
            if (row.code === 'artist_tier_requires_artist') {
                if (f.role === 'artist') {
                    out.reason = 'Completá tu registro de artista para comprar esta licencia.';
                    out.link = { label: 'Ir a tu dashboard →', href: Model.appPath('/artist/dashboard') };
                } else {
                    out.link = { label: 'Ingresá como artista →', href: Shell.loginLinks().artist };
                }
            }
            return out;
        });
    }

    function defaultTier(tiers, requested) {
        var rows = list(tiers);
        for (var i = 0; i < rows.length; i++) if (rows[i].available && rows[i].id === requested) return rows[i].id;
        for (var j = 0; j < rows.length; j++) if (rows[j].available) return rows[j].id;
        return null;
    }
    function firstOfferedTier(tiers) {
        var rows = list(tiers);
        for (var i = 0; i < rows.length; i++) if (rows[i].price != null) return rows[i].id;
        return null;
    }

    // Selección inicial de la ficha. params = { license, variant, qty } de la URL.
    function initialItemState(product, flags, params) {
        var p = product || {};
        var prm = params || {};
        var state = { tier: null, termsTier: 'personal', variantId: null, quantity: 1 };
        if (p.kind === 'design') {
            var tiers = tierOptions(p, flags);
            state.tier = defaultTier(tiers, prm.license);
            state.termsTier = state.tier || firstOfferedTier(tiers) || 'personal';
            return state;
        }
        var variants = list(p.variants);
        var requested = findVariant(p, prm.variant);
        if (requested && !variantState(requested).available) requested = null;
        var inStock = variants.filter(function (v) { return variantState(v).available; });
        var chosen = requested || (inStock.length === 1 ? inStock[0] : null);
        state.variantId = chosen ? chosen.id : null;
        state.quantity = clampQty(prm.qty, chosen ? variantState(chosen).max : MAX_QTY);
        return state;
    }

    function errorCopy(code) { return Model.errorMessage({ message: 'store:' + code }); }

    function blockedDesignHint(tiers) {
        var rows = list(tiers);
        if (rows.some(function (t) { return t.code === 'product_reserved'; })) return errorCopy('product_reserved');
        var offered = rows.filter(function (t) { return t.price != null; });
        if (offered.length && offered.every(function (t) { return t.code === 'artist_tier_requires_artist' || t.code === 'exclusive_unavailable'; }) &&
            offered.some(function (t) { return t.code === 'artist_tier_requires_artist'; })) {
            return 'La licencia disponible es solo para cuentas de artista.';
        }
        return 'Este diseño no tiene licencias disponibles en este momento.';
    }

    /* ------------------------------------------------------------------ */
    /* Bloque de compra                                                    */
    /* ------------------------------------------------------------------ */

    // Estado del bloque de compra para la selección actual.
    //   mode: 'buy' (CTA activo) | 'blocked' (CTA deshabilitado con hint) |
    //         'own' (el visitante es el vendedor: link para editar).
    function buyState(product, selection, flags) {
        var p = pricedProduct(product) || {};
        var s = selection || {};
        var f = flags || {};
        var currency = currencyOf(p);
        var out = {
            mode: f.isSeller ? 'own' : 'blocked', eyebrow: '', amount: '', caption: '', rows: [], note: '', hint: '',
            href: null, editHref: f.isSeller ? editUrl(p.id) : null, approx: false, quantity: 1, maxQuantity: MAX_QTY, currency: currency
        };
        var own = out.mode === 'own';

        if (p.kind === 'design') {
            var tiers = tierOptions(p, f);
            var tier = null;
            tiers.forEach(function (t) { if (t.available && t.id === s.tier) tier = t; });
            if (!tier) {
                out.eyebrow = 'Licencias';
                out.amount = priceSummary(p).label;
                if (!own) out.hint = blockedDesignHint(tiers);
                return out;
            }
            var totals = Model.orderTotals(p, { tier: tier.id });
            out.eyebrow = 'Licencia ' + tier.label;
            out.amount = money(totals.total, currency);
            out.caption = 'Pago único · Descarga digital';
            if (own) return out;
            if (!totals.valid) { out.hint = errorCopy(totals.error || 'tier_unavailable'); return out; }
            out.mode = 'buy';
            out.href = Model.checkoutUrl({ item: p.id, license: tier.id });
            return out;
        }

        var variants = list(p.variants);
        var variant = findVariant(p, s.variantId);
        var methods = deliveryMethods(p);
        var max = variant ? variantState(variant).max : MAX_QTY;
        var qty = clampQty(s.quantity, max);
        out.quantity = qty;
        out.maxQuantity = max;

        if (!variants.length) {
            out.eyebrow = 'Precio';
            out.amount = priceSummary(p).label;
            if (!own) out.hint = 'Este producto no está disponible para comprar en este momento.';
            return out;
        }
        if (!variant) {
            out.eyebrow = 'Precio';
            out.amount = priceSummary(p).label;
            if (!own) {
                var anyInStock = variants.some(function (v) { return variantState(v).available; });
                out.hint = anyInStock ? variantLegend(variants).prompt + ' para continuar.' : 'Agotado por ahora. Volvé a mirarlo más tarde.';
            }
            return out;
        }

        // Sobre el producto original: pricedProduct ya fijó una base y perdería
        // la marca de precio aproximado.
        var vp = variantPrice(product, variant);
        out.approx = !!vp.approx;
        var prefix = out.approx ? 'Desde ' : '';
        var base = { variantId: variant.id, quantity: qty };
        var byMethod = (methods.length ? methods : ['shipping']).map(function (m) {
            return { method: m, totals: Model.orderTotals(p, Object.assign({ method: m }, base)) };
        });
        var first = byMethod[0].totals;
        out.eyebrow = qty > 1 ? 'Subtotal' : 'Precio';
        out.amount = first.subtotal != null ? prefix + money(first.subtotal, currency) : priceSummary(p).label;
        out.caption = qty > 1 && first.unitPrice != null
            ? variantName(variant) + ' · ' + prefix + money(first.unitPrice, currency) + ' × ' + qty
            : variantName(variant);
        if (methods.length) {
            byMethod.forEach(function (row) {
                if (row.totals.total == null) return;
                var shipping = row.method === 'shipping';
                out.rows.push({
                    label: methods.length === 1 ? 'Total' : (shipping ? 'Total con envío' : 'Total con retiro'),
                    detail: shipping
                        ? (row.totals.shipping > 0 ? 'Envío ' + money(row.totals.shipping, currency) : 'Envío sin costo')
                        : 'Retiro en el estudio sin costo',
                    value: prefix + money(row.totals.total, currency)
                });
            });
        }
        if (out.approx) out.note = 'El precio final de esta variante se confirma en el checkout.';
        if (own) return out;
        if (!methods.length) { out.hint = 'Por ahora este producto no tiene envío ni retiro disponibles.'; return out; }
        if (first.error) { out.hint = errorCopy(first.error); return out; }
        out.mode = 'buy';
        out.href = Model.checkoutUrl({ item: p.id, variant: variant.id, qty: qty });
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* HTML: piezas comunes                                                */
    /* ------------------------------------------------------------------ */

    function icon(name, extra) {
        return '<i data-wo-icon="' + esc(name) + '" class="wo-icon-18' + (extra ? ' ' + extra : '') + '" aria-hidden="true"></i>';
    }

    function avatarHtml(seller, className) {
        var s = seller || {};
        var url = avatarUrl(s.avatar_url);
        var inner = url
            ? '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async">'
            : esc(Shell.initials(text(s.name) || text(s.handle)));
        return '<span class="wo-avatar wo-avatar--bordered ' + className + '" aria-hidden="true">' + inner + '</span>';
    }

    function badgeHtml(badge) {
        return '<span class="' + esc(badge.tag || 'wo-tag') + ' sts-tag-s">' + esc(badge.label) + '</span>';
    }

    function fold(title, body, extraClass) {
        return '<details class="stc-fold' + (extraClass ? ' ' + extraClass : '') + '">' +
            '<summary class="stc-fold-summary"><span>' + esc(title) + '</span>' + icon('chevron-down', 'stc-fold-icon') + '</summary>' +
            '<div class="stc-fold-body"><p>' + esc(body) + '</p></div></details>';
    }

    function policyFolds(settings) {
        var s = settings || {};
        var folds = [];
        if (text(s.shipping_policy)) folds.push(fold('Envíos', s.shipping_policy));
        if (text(s.return_policy)) folds.push(fold('Cambios y devoluciones', s.return_policy));
        return folds.length ? '<div class="stc-folds">' + folds.join('') + '</div>' : '';
    }

    // Mensaje de página completa (con h1: la página no tiene otro título).
    function messageHtml(opts) {
        var o = opts || {};
        return '<div class="sts-empty stc-message">' +
            (o.icon ? '<i data-wo-icon="' + esc(o.icon) + '" class="sts-empty-icon" aria-hidden="true"></i>' : '') +
            '<h1 class="sts-empty-title">' + esc(o.title) + '</h1>' +
            (o.text ? '<p class="sts-empty-text">' + esc(o.text) + '</p>' : '') +
            (o.actionLabel && o.actionHref ? '<a class="wo-btn wo-btn--ghost wo-btn--s wo-btn--hard" href="' + esc(Model.appPath(o.actionHref)) + '">' + esc(o.actionLabel) + '</a>' : '') +
            '</div>';
    }

    function disabledMessage() {
        return {
            icon: 'shopping-bag',
            title: 'La Store todavía no está disponible.',
            text: 'Mientras tanto, podés explorar artistas y pedir tu cotización.',
            actionLabel: 'Explorá artistas →',
            actionHref: MARKETPLACE
        };
    }

    /* ------------------------------------------------------------------ */
    /* HTML: vitrina                                                       */
    /* ------------------------------------------------------------------ */

    function cardHtml(product) {
        var p = product || {};
        var img = list(p.images).filter(function (i) { return i && text(i.path); })[0] || null;
        var badges = Model.productBadges(p).map(badgeHtml).join('');
        var kind = kindLine(p);
        var price = priceSummary(p);
        // La imagen es decorativa: el título de la card ya nombra el producto.
        return '<a class="sts-card stc-card" href="' + esc(Model.itemUrl(p.id)) + '" data-stc-product="' + esc(p.id) + '">' +
            '<div class="sts-card-media">' + Shell.previewImg(img && img.path, { alt: '' }) +
            (badges ? '<div class="sts-card-badges">' + badges + '</div>' : '') + '</div>' +
            '<div class="sts-card-body">' +
            (kind ? '<p class="sts-card-kind">' + esc(kind) + '</p>' : '') +
            '<h3 class="sts-card-title">' + esc(p.title) + '</h3>' +
            (price.label ? '<p class="sts-card-price">' + esc(price.label) + '</p>' : '') +
            '</div></a>';
    }

    function filtersHtml(products, filter) {
        if (!showFilters(products)) return '';
        var counts = kindCounts(products);
        return '<div class="sts-chips stc-filters" role="group" aria-label="Filtrar por tipo">' +
            FILTER_ORDER.map(function (key) {
                var n = key === 'todo' ? counts.all : counts[FILTERS[key]];
                return '<button type="button" class="wo-chip stc-chip" data-stc-filter="' + key + '" aria-pressed="' + (key === filter ? 'true' : 'false') + '">' +
                    esc(FILTER_LABELS[key]) + ' <span class="stc-chip-count">' + n + '</span></button>';
            }).join('') + '</div>';
    }

    function catalogHtml(products, seller, filter) {
        var s = seller || {};
        var counts = kindCounts(products);
        if (!counts.all) {
            return '<section class="stc-catalog" aria-labelledby="stc-catalog-title">' +
                '<h2 class="sts-section-title" id="stc-catalog-title">Diseños y merch</h2>' +
                Shell.emptyState({
                    icon: 'image',
                    title: 'Todavía no hay productos',
                    text: 'Este artista todavía no publicó diseños ni merch.',
                    actionLabel: text(s.handle) ? 'Mirá su portafolio →' : '',
                    actionHref: text(s.handle) ? profileUrl(s.handle) : ''
                }) + '</section>';
        }
        var title = counts.design && counts.merch ? 'Diseños y merch' : (counts.merch ? 'Merch' : 'Diseños');
        var shown = filterProducts(products, filter);
        return '<section class="stc-catalog" aria-labelledby="stc-catalog-title">' +
            '<div class="stc-catalog-head"><h2 class="sts-section-title" id="stc-catalog-title">' + esc(title) + '</h2>' +
            '<p class="stc-count" id="stc-count" aria-live="polite">' + esc(countLabel(shown.length)) + '</p></div>' +
            filtersHtml(products, filter) +
            '<div class="sts-grid stc-grid" id="stc-grid">' + shown.map(cardHtml).join('') + '</div>' +
            '</section>';
    }

    // front = resultado de getStorefront: { seller, settings, products, allow_search_indexing }.
    function storefrontHtml(front, flags, filter) {
        var f = front || {};
        var seller = f.seller || {};
        var settings = f.settings || {};
        var products = list(f.products).filter(Boolean);
        var handle = text(seller.handle);
        var name = text(seller.name) || (handle ? '@' + handle : 'Store');
        var meta = [];
        if (handle) meta.push('<span class="stc-handle">@' + esc(handle) + '</span>');
        var place = placeText(seller);
        if (place) meta.push('<span>' + esc(place) + '</span>');
        var actions = [];
        if (seller.type === 'artist' && handle) {
            actions.push('<a class="wo-btn wo-btn--ghost wo-btn--s wo-btn--hard" href="' + esc(profileUrl(handle)) + '">Ver perfil →</a>');
        }
        if (flags && flags.isSeller) {
            actions.push('<a class="wo-btn wo-btn--secondary wo-btn--s stc-manage-link" href="' + esc(manageUrl()) + '">Gestionar tu Store →</a>');
        }
        var folds = policyFolds(settings);
        return '<section class="stc-hero" aria-labelledby="stc-seller-name">' +
            '<div class="stc-hero-main">' + avatarHtml(seller, 'stc-avatar') +
            '<div class="stc-hero-text"><p class="sts-eyebrow">Store</p>' +
            '<h1 class="sts-title stc-hero-title" id="stc-seller-name">' + esc(name) + '</h1>' +
            (meta.length ? '<p class="stc-hero-meta">' + meta.join('<span class="wo-sep" aria-hidden="true"></span>') + '</p>' : '') +
            '</div></div>' +
            (text(settings.tagline) ? '<p class="sts-sub stc-tagline">' + esc(settings.tagline) + '</p>' : '') +
            (actions.length ? '<div class="sts-header-actions">' + actions.join('') + '</div>' : '') +
            (folds ? '<div class="stc-policies"><p class="sts-eyebrow">Políticas de la Store</p>' + folds + '</div>' : '') +
            '</section>' +
            catalogHtml(products, seller, filter);
    }

    function storefrontSkeletonHtml() {
        return '<p class="wo-sr-only" role="status">Cargando la Store</p>' +
            '<div class="stc-hero" aria-hidden="true"><div class="stc-hero-main"><span class="wo-skeleton stc-avatar"></span>' +
            '<div class="stc-hero-text"><span class="wo-skeleton sts-skel-line sts-skel-line--short"></span>' +
            '<span class="wo-skeleton stc-skel-title"></span><span class="wo-skeleton sts-skel-line"></span></div></div></div>' +
            '<div class="stc-catalog" aria-hidden="true"><div class="sts-grid">' + Shell.skeletonCards(8) + '</div></div>';
    }

    /* ------------------------------------------------------------------ */
    /* HTML: ficha                                                         */
    /* ------------------------------------------------------------------ */

    function productImages(product) {
        return list(product && product.images).filter(function (i) { return i && text(i.path); });
    }
    function imageAlt(product, image) { return text(image && image.alt) || text(product && product.title); }

    function galleryHtml(product) {
        var images = productImages(product);
        var first = images[0] || null;
        var main = '<div class="stc-gallery-main" id="stc-gallery-main">' +
            Shell.previewImg(first && first.path, { alt: imageAlt(product, first), loading: 'eager' }) + '</div>';
        var thumbs = images.length > 1
            ? '<div class="stc-thumbs" role="group" aria-label="Elegí una imagen">' + images.map(function (img, i) {
                var label = 'Ver imagen ' + (i + 1) + ' de ' + images.length + (text(img.alt) ? ': ' + text(img.alt) : '');
                return '<button type="button" class="stc-thumb" data-stc-thumb="' + i + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '"' +
                    ' aria-controls="stc-gallery-main" aria-label="' + esc(label) + '">' + Shell.previewImg(img.path, { alt: '' }) + '</button>';
            }).join('') + '</div>'
            : '';
        return '<section class="stc-gallery" aria-label="Imágenes del producto">' + main + thumbs + '</section>';
    }

    function bylineHtml(seller) {
        var s = seller || {};
        var handle = text(s.handle);
        var storeHref = s.type === 'artist' && handle ? Model.storeUrl(handle) : '';
        var name = text(s.name) || (handle ? '@' + handle : 'El vendedor');
        return '<div class="stc-byline">' + avatarHtml(s, 'wo-avatar--s') +
            '<p class="stc-byline-text">Por <span class="stc-byline-name">' + esc(name) + '</span>' +
            (handle ? ' <span class="stc-handle">@' + esc(handle) + '</span>' : '') + '</p>' +
            (storeHref ? '<a class="stc-byline-link" href="' + esc(storeHref) + '">Ver su Store →</a>' : '') +
            '</div>';
    }

    function specsHtml(product) {
        var p = product || {};
        var rows = [];
        var size = sizeLabel(p);
        if (size) rows.push(['Medidas', size]);
        if (text(p.design_style)) rows.push(['Estilo', p.design_style]);
        if (text(p.placement_suggestion)) rows.push(['Ubicación sugerida', p.placement_suggestion]);
        if (text(p.category) && text(p.category) !== text(p.design_style)) rows.push(['Categoría', p.category]);
        if (!rows.length) return '';
        return '<dl class="sts-kv stc-specs">' + rows.map(function (r) {
            return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
        }).join('') + '</dl>';
    }

    function tiersHtml(product, tiers, state) {
        var currency = currencyOf(product);
        return '<fieldset class="stc-fieldset stc-tiers"><legend class="stc-legend">Elegí la licencia</legend><div class="stc-tier-list">' +
            list(tiers).map(function (t) {
                var id = 'stc-tier-' + esc(t.id);
                var checked = t.available && state && state.tier === t.id;
                var describedBy = id + '-summary' + (t.reason ? ' ' + id + '-reason' : '');
                return '<div class="stc-tier' + (t.available ? '' : ' is-disabled') + (checked ? ' is-checked' : '') + '" data-stc-tier="' + esc(t.id) + '">' +
                    '<input class="stc-tier-input" type="radio" name="stc-tier" id="' + id + '" value="' + esc(t.id) + '"' +
                    (checked ? ' checked' : '') + (t.available ? '' : ' disabled') + ' aria-describedby="' + describedBy + '">' +
                    '<label class="stc-tier-label" for="' + id + '"><span class="stc-tier-name">' + esc(t.label) + '</span>' +
                    (t.price != null ? '<span class="stc-tier-price">' + esc(money(t.price, currency)) + '</span>' : '') + '</label>' +
                    '<p class="stc-tier-summary" id="' + id + '-summary">' + esc(t.summary) + '</p>' +
                    (t.reason
                        ? '<p class="stc-tier-reason" id="' + id + '-reason">' + icon('lock') + '<span>' + esc(t.reason) + '</span>' +
                            (t.link ? '<a href="' + esc(t.link.href) + '">' + esc(t.link.label) + '</a>' : '') + '</p>'
                        : '') +
                    '</div>';
            }).join('') + '</div></fieldset>';
    }

    function tierDetailHtml(tierId) {
        var meta = Model.tierById(tierId);
        if (!meta) return '';
        return '<p class="stc-tier-detail-title">Con la licencia ' + esc(meta.label) + '</p>' +
            '<ul class="stc-bullets">' + list(meta.bullets).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
    }

    function termsTitle(tierId) {
        var meta = Model.tierById(tierId);
        var t = Model.termsFor(tierId);
        return 'Términos de la licencia ' + (meta ? meta.label : '') + ' · v' + ((t && t.version) || Model.TERMS_VERSION);
    }

    function termsBodyHtml(tierId) {
        var t = Model.termsFor(tierId);
        if (!t) return '';
        var li = function (c) { return '<li>' + esc(c) + '</li>'; };
        return '<p>' + esc(t.intro) + '</p>' +
            '<h3 class="stc-terms-title">' + esc(t.title) + '</h3><ol class="stc-terms-list">' + list(t.clauses).map(li).join('') + '</ol>' +
            '<h3 class="stc-terms-title">' + esc(t.commonTitle) + '</h3><ol class="stc-terms-list">' + list(t.common).map(li).join('') + '</ol>';
    }

    function termsHtml(tierId) {
        return '<details class="stc-fold stc-terms" id="stc-terms">' +
            '<summary class="stc-fold-summary"><span id="stc-terms-title">' + esc(termsTitle(tierId)) + '</span>' + icon('chevron-down', 'stc-fold-icon') + '</summary>' +
            '<div class="stc-fold-body" id="stc-terms-body">' + termsBodyHtml(tierId) + '</div></details>';
    }

    function lineHtml(iconName, title, texts) {
        return '<li class="stc-line"><i data-wo-icon="' + esc(iconName) + '" class="stc-line-icon" aria-hidden="true"></i>' +
            '<div class="stc-line-body"><p class="stc-line-title">' + esc(title) + '</p>' +
            list(texts).filter(Boolean).map(function (t) { return '<p class="stc-line-text">' + esc(t) + '</p>'; }).join('') +
            '</div></li>';
    }

    function includesHtml() {
        return '<section class="stc-block" aria-labelledby="stc-includes-title">' +
            '<h2 class="stc-block-title" id="stc-includes-title">Qué incluye</h2>' +
            '<ul class="stc-lines">' + list(Model.DESIGN_INCLUDES).map(function (i) {
                return lineHtml(INCLUDE_ICONS[i.key] || 'check', i.label, [i.detail]);
            }).join('') + '</ul>' +
            '<p class="wo-help">Los archivos se habilitan en tus compras cuando se confirma el pago.</p>' +
            '</section>';
    }

    function variantsHtml(product, state) {
        var p = product || {};
        var variants = list(p.variants).filter(Boolean);
        if (!variants.length) return '';
        var legend = variantLegend(variants);
        var showPrice = variantPricesVary(p);
        var showColor = colorsVary(variants);
        return '<fieldset class="stc-fieldset stc-variants"><legend class="stc-legend">' + esc(legend.label) + '</legend><div class="stc-variant-list">' +
            variants.map(function (v, i) {
                var st = variantState(v);
                var id = 'stc-variant-' + i;
                var name = variantName(v);
                var color = text(v.color);
                if (showColor && color && name.toLowerCase().indexOf(color.toLowerCase()) === -1) name += ' · ' + color;
                var notes = [];
                if (showPrice) {
                    var vp = variantPrice(p, v);
                    if (vp.amount != null) notes.push((vp.approx ? 'Desde ' : '') + money(vp.amount, currencyOf(p)));
                }
                if (st.note) notes.push(st.note);
                var checked = st.available && state && sameId(state.variantId, v.id);
                return '<span class="stc-variant">' +
                    '<input class="stc-variant-input wo-sr-only" type="radio" name="stc-variant" id="' + id + '" value="' + esc(v.id) + '"' +
                    (checked ? ' checked' : '') + (st.available ? '' : ' disabled') + '>' +
                    '<label class="stc-variant-label" for="' + id + '"><span class="stc-variant-name">' + esc(name) + '</span>' +
                    (notes.length ? '<span class="stc-variant-note">' + esc(notes.join(' · ')) + '</span>' : '') + '</label></span>';
            }).join('') + '</div></fieldset>';
    }

    function qtyHtml(product, state) {
        var v = findVariant(product, state && state.variantId);
        var max = v ? variantState(v).max : MAX_QTY;
        var qty = clampQty(state && state.quantity, max);
        return '<div class="stc-qty"><label class="stc-legend" for="stc-qty-input">Cantidad</label>' +
            '<div class="stc-stepper">' +
            '<button type="button" class="stc-step" data-stc-step="-1" aria-controls="stc-qty-input" aria-label="Restar una unidad"' + (qty <= 1 ? ' aria-disabled="true"' : '') + '>' + icon('minus') + '</button>' +
            '<input class="stc-qty-input" id="stc-qty-input" type="number" inputmode="numeric" min="1" max="' + max + '" step="1" value="' + qty + '" aria-describedby="stc-qty-help">' +
            '<button type="button" class="stc-step" data-stc-step="1" aria-controls="stc-qty-input" aria-label="Sumar una unidad"' + (qty >= max ? ' aria-disabled="true"' : '') + '>' + icon('plus') + '</button>' +
            '</div><p class="wo-help stc-qty-help" id="stc-qty-help">' + esc(qtyHelp(max)) + '</p></div>';
    }

    function deliveryHtml(product, settings) {
        var p = product || {};
        var methods = deliveryMethods(p);
        var items = [];
        if (methods.indexOf('shipping') !== -1) {
            var price = num(p.shipping_price_amount);
            var countries = list(p.ships_to_countries).filter(function (c) { return text(c); });
            items.push(lineHtml('truck', 'Envío a domicilio', [
                price > 0 ? 'Costo de envío: ' + money(price, currencyOf(p)) + ' por pedido.' : 'Envío sin costo.',
                countries.length ? 'Hace envíos a ' + countryList(countries) + '.' : 'Hace envíos a todos los países.',
                text(p.ships_to_note)
            ]));
        }
        if (methods.indexOf('pickup') !== -1) {
            items.push(lineHtml('map-pin', 'Retiro en el estudio', [
                'Sin costo.',
                text(p.pickup_note),
                'El vendedor te pasa la dirección exacta cuando confirma tu pago.'
            ]));
        }
        var folds = policyFolds(settings);
        return '<section class="stc-block" aria-labelledby="stc-delivery-title">' +
            '<h2 class="stc-block-title" id="stc-delivery-title">Entrega</h2>' +
            (items.length ? '<ul class="stc-lines">' + items.join('') + '</ul>' : '<p class="stc-line-text">Por ahora este producto no tiene envío ni retiro disponibles.</p>') +
            folds + '</section>';
    }

    function buyPanelHtml(product, flags) {
        var p = product || {};
        var own = !!(flags && flags.isSeller);
        return '<section class="sts-panel stc-buy" aria-labelledby="stc-buy-title">' +
            '<h2 class="wo-sr-only" id="stc-buy-title">Precio y compra</h2>' +
            '<div class="stc-buy-live" id="stc-buy-live" aria-live="polite" aria-atomic="true"></div>' +
            '<p class="stc-buy-hint" id="stc-buy-hint" hidden></p>' +
            (own
                ? '<div class="stc-own"><p class="stc-own-title">Este producto es tuyo</p>' +
                    '<a class="wo-btn wo-btn--ink wo-btn--block wo-btn--hard stc-own-link" href="' + esc(editUrl(p.id)) + '">Editarlo en tu Store →</a></div>'
                : '<a class="wo-btn wo-btn--accent wo-btn--block wo-btn--hard stc-cta" id="stc-buy-cta" role="link" aria-disabled="true" tabindex="0">Comprar →</a>') +
            '<p class="wo-help stc-buy-note">Pagás en ' + esc(currencyOf(p)) + ', la moneda que eligió el vendedor. No convertimos el precio.</p>' +
            '</section>';
    }

    function buyLiveHtml(b) {
        var s = b || {};
        return (s.eyebrow ? '<p class="sts-eyebrow">' + esc(s.eyebrow) + '</p>' : '') +
            (s.amount ? '<p class="sts-price sts-price--lg stc-buy-amount">' + esc(s.amount) + '</p>' : '') +
            (s.caption ? '<p class="stc-buy-caption">' + esc(s.caption) + '</p>' : '') +
            (list(s.rows).length
                ? '<dl class="stc-buy-rows">' + s.rows.map(function (r) {
                    return '<div class="stc-buy-row"><dt>' + esc(r.label) + (r.detail ? '<span class="stc-buy-detail">' + esc(r.detail) + '</span>' : '') + '</dt>' +
                        '<dd>' + esc(r.value) + '</dd></div>';
                }).join('') + '</dl>'
                : '') +
            (s.note ? '<p class="wo-help">' + esc(s.note) + '</p>' : '');
    }

    // data = resultado de getPublicProduct: { seller, settings, product, allow_search_indexing }.
    function itemHtml(data, flags, state) {
        var d = data || {};
        var p = d.product || {};
        var seller = d.seller || {};
        var settings = d.settings || {};
        var f = flags || {};
        var st = state || {};
        var handle = text(seller.handle);
        var storeHref = seller.type === 'artist' && handle ? Model.storeUrl(handle) : '';
        var sellerName = text(seller.name) || (handle ? '@' + handle : '');
        var badges = Model.productBadges(p).map(badgeHtml).join('');
        var kind = kindLine(p);
        var tags = list(p.tags).map(text).filter(Boolean);

        var crumbs = '<nav class="stc-crumbs" aria-label="Ruta">' +
            (storeHref ? '<a href="' + esc(storeHref) + '">Store de ' + esc(sellerName) + '</a>' : '<span>Store</span>') +
            '<span class="wo-sep" aria-hidden="true"></span><span aria-current="page">' + esc(p.title) + '</span></nav>';

        var head = '<header class="stc-item-head">' +
            (kind ? '<p class="sts-eyebrow">' + esc(kind) + '</p>' : '') +
            '<h1 class="sts-title stc-item-title">' + esc(p.title) + '</h1>' +
            bylineHtml(seller) +
            (badges ? '<div class="sts-tags">' + badges + '</div>' : '') +
            '</header>' +
            (text(p.description) ? '<p class="stc-desc">' + esc(p.description) + '</p>' : '') +
            (tags.length ? '<ul class="sts-tags stc-tags" aria-label="Etiquetas">' + tags.map(function (t) {
                return '<li class="wo-tag wo-tag--soft sts-tag-s">' + esc(t) + '</li>';
            }).join('') + '</ul>' : '');

        var body;
        if (p.kind === 'design') {
            var tiers = tierOptions(p, f);
            body = specsHtml(p) +
                tiersHtml(p, tiers, st) +
                '<div class="sts-panel sts-panel--flat stc-tier-detail" id="stc-tier-detail"' + (st.tier ? '' : ' hidden') + '>' + (st.tier ? tierDetailHtml(st.tier) : '') + '</div>' +
                buyPanelHtml(p, f) +
                termsHtml(st.termsTier || st.tier || firstOfferedTier(tiers) || 'personal') +
                includesHtml() +
                (policyFolds(settings)
                    ? '<section class="stc-block" aria-labelledby="stc-policies-title"><h2 class="stc-block-title" id="stc-policies-title">Políticas del vendedor</h2>' + policyFolds(settings) + '</section>'
                    : '');
        } else {
            body = variantsHtml(p, st) + qtyHtml(p, st) + buyPanelHtml(p, f) + deliveryHtml(p, settings);
        }

        return crumbs + '<div class="stc-item">' + galleryHtml(p) + '<div class="stc-info">' + head + body + '</div></div>';
    }

    function itemSkeletonHtml() {
        return '<p class="wo-sr-only" role="status">Cargando el producto</p>' +
            '<div class="stc-item" aria-hidden="true">' +
            '<div class="stc-gallery"><div class="stc-gallery-main"><span class="wo-skeleton stc-skel-fill"></span></div></div>' +
            '<div class="stc-info"><span class="wo-skeleton sts-skel-line sts-skel-line--short"></span>' +
            '<span class="wo-skeleton stc-skel-title"></span><span class="wo-skeleton sts-skel-line"></span>' +
            '<span class="wo-skeleton sts-skel-line"></span><span class="wo-skeleton sts-skel-line sts-skel-line--short"></span></div></div>';
    }

    /* ------------------------------------------------------------------ */
    /* DOM                                                                 */
    /* ------------------------------------------------------------------ */

    function byId(id) { return root.document.getElementById(id); }

    function markBusy(main, busy) {
        if (main) main.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function renderMessage(mount, main, opts) {
        mount.innerHTML = messageHtml(opts);
        Shell.hydrateIcons(mount);
        markBusy(main, false);
    }

    function setMetaDescription(value) {
        var meta = root.document.querySelector('meta[name="description"]');
        var s = text(value).replace(/\s+/g, ' ');
        if (!meta || !s) return;
        meta.setAttribute('content', s.length > 160 ? s.slice(0, 157) + '…' : s);
    }

    function currentHref() {
        var loc = root.location;
        return loc ? loc.pathname + (loc.search || '') : '/store/';
    }

    // Última vitrina vista: permite ofrecer «Volver a la Store de X» si el
    // producto ya no está disponible.
    function rememberFront(seller, products) {
        try {
            root.sessionStorage.setItem(LAST_FRONT_KEY, JSON.stringify({
                handle: text(seller && seller.handle) || null,
                name: text(seller && seller.name) || null,
                ids: list(products).map(function (p) { return String(p.id); }).slice(0, 200)
            }));
        } catch (e) { /* storage bloqueado: sin memoria */ }
    }
    function knownFrontFor(productId) {
        try {
            var raw = JSON.parse(root.sessionStorage.getItem(LAST_FRONT_KEY) || 'null');
            if (raw && raw.handle && list(raw.ids).indexOf(String(productId)) !== -1) return { handle: raw.handle, name: raw.name || null };
        } catch (e) { /* sin storage */ }
        try {
            var ref = root.document.referrer;
            if (ref) {
                var u = new root.URL(ref);
                var path = Shell.stripBase(u.pathname);
                if (u.origin === root.location.origin && /^\/store\/?$/.test(path) && u.searchParams.get('artist')) {
                    return { handle: u.searchParams.get('artist'), name: null };
                }
            }
        } catch (e) { /* referrer ilegible */ }
        return null;
    }

    function guard(fn) {
        return function () {
            Promise.resolve().then(fn).catch(function (err) {
                if (root.console) root.console.error('[store-catalog]', err);
                var mount = byId('stc-root');
                if (!mount) return;
                renderMessage(mount, byId('stc-main'), {
                    icon: 'alert-triangle',
                    title: 'No pudimos cargar la Store',
                    text: 'Probá de nuevo en unos minutos.',
                    actionLabel: 'Volver a intentar →',
                    actionHref: currentHref()
                });
            });
        };
    }

    /* ------------------------------ vitrina ------------------------------ */

    async function initStorefront() {
        var mount = byId('stc-root');
        var main = byId('stc-main');
        if (!mount) return;
        markBusy(main, true);
        mount.innerHTML = storefrontSkeletonHtml();
        // La topbar y la página comparten la misma sesión (viewer() queda cacheado).
        Shell.mountStoreTopbar('store-topbar', {});
        var enabled = await Shell.isStoreEnabled();
        if (!enabled) {
            Shell.setTitle('');
            return renderMessage(mount, main, disabledMessage());
        }
        var handle = text(Shell.param('artist'));
        if (!handle) {
            Shell.setTitle('');
            return renderMessage(mount, main, {
                icon: 'users',
                title: 'Elegí un artista para ver su Store',
                text: 'Cada artista tiene su Store con diseños con licencia de uso y merch.',
                actionLabel: 'Explorá artistas →',
                actionHref: MARKETPLACE
            });
        }
        var Repo = storeRepo();
        var front = Repo ? await Repo.getStorefront('artist', handle) : null;
        if (!front || !front.seller) {
            Shell.setRobots(false);
            Shell.setTitle('Store no encontrada');
            return renderMessage(mount, main, {
                icon: 'search',
                title: 'No encontramos esta Store',
                text: 'Revisá el link o buscá al artista en el marketplace.',
                actionLabel: 'Explorá artistas →',
                actionHref: MARKETPLACE
            });
        }
        var viewer = await Shell.viewer();
        renderStorefront(mount, front, viewer);
        markBusy(main, false);
    }

    function renderStorefront(mount, front, viewer) {
        var seller = front.seller || {};
        var products = list(front.products).filter(Boolean);
        var flags = viewerFlags(seller, viewer);
        var filter = normalizeFilter(Shell.param('tipo'), products);
        mount.innerHTML = storefrontHtml(front, flags, filter);
        Shell.hydrateIcons(mount);
        Shell.setRobots(front.allow_search_indexing === true);
        Shell.setTitle(text(seller.name) || (text(seller.handle) ? '@' + text(seller.handle) : ''));
        setMetaDescription(text(front.settings && front.settings.tagline) ||
            'Diseños con licencia de uso y merch de ' + (text(seller.name) || 'este artista') + ' en We Ötzi.');
        rememberFront(seller, products);
        var params = { tipo: filter === 'todo' ? null : filter };
        if (text(seller.handle)) params.artist = text(seller.handle);
        Shell.setParams(params);
        wireFilters(mount, products);
    }

    function wireFilters(mount, products) {
        mount.addEventListener('click', function (e) {
            var chip = e.target && e.target.closest ? e.target.closest('[data-stc-filter]') : null;
            if (!chip) return;
            var key = normalizeFilter(chip.getAttribute('data-stc-filter'), products);
            mount.querySelectorAll('[data-stc-filter]').forEach(function (c) {
                c.setAttribute('aria-pressed', c.getAttribute('data-stc-filter') === key ? 'true' : 'false');
            });
            var shown = filterProducts(products, key);
            var grid = mount.querySelector('#stc-grid');
            if (grid) { grid.innerHTML = shown.map(cardHtml).join(''); Shell.hydrateIcons(grid); }
            var count = mount.querySelector('#stc-count');
            if (count) count.textContent = countLabel(shown.length);
            Shell.setParams({ tipo: key === 'todo' ? null : key });
        });
    }

    /* ------------------------------ ficha ------------------------------ */

    async function initItem() {
        var mount = byId('stc-root');
        var main = byId('stc-main');
        if (!mount) return;
        markBusy(main, true);
        mount.innerHTML = itemSkeletonHtml();
        // La topbar y la página comparten la misma sesión (viewer() queda cacheado).
        Shell.mountStoreTopbar('store-topbar', {});
        var enabled = await Shell.isStoreEnabled();
        if (!enabled) {
            Shell.setTitle('');
            return renderMessage(mount, main, disabledMessage());
        }
        var id = text(Shell.param('id'));
        var Repo = storeRepo();
        var data = Repo && UUID_RE.test(id) ? await Repo.getPublicProduct(id) : null;
        if (!data || !data.product) {
            Shell.setRobots(false);
            Shell.setTitle('Producto no disponible');
            var known = id ? knownFrontFor(id) : null;
            return renderMessage(mount, main, {
                icon: 'package',
                title: 'Este producto ya no está disponible.',
                text: 'Puede que se haya vendido con licencia exclusiva o que el artista lo haya pausado.',
                actionLabel: known ? (known.name ? 'Volver a la Store de ' + known.name + ' →' : 'Volver a la Store →') : 'Explorá artistas →',
                actionHref: known ? Model.storeUrl(known.handle) : MARKETPLACE
            });
        }
        var viewer = await Shell.viewer();
        renderItem(mount, data, viewer);
        markBusy(main, false);
    }

    function renderItem(mount, data, viewer) {
        var p = data.product;
        var seller = data.seller || {};
        var flags = viewerFlags(seller, viewer);
        var state = initialItemState(p, flags, { license: Shell.param('license'), variant: Shell.param('variant'), qty: Shell.param('qty') });
        mount.innerHTML = itemHtml(data, flags, state);
        Shell.hydrateIcons(mount);
        Shell.setRobots(data.allow_search_indexing === true);
        Shell.setTitle(text(p.title) + (text(seller.name) ? ' · ' + text(seller.name) : ''));
        setMetaDescription(text(p.description) || text(p.title));
        var update = function () {
            renderBuy(mount, p, flags, state);
            syncItemParams(p, state);
        };
        wireGallery(mount, p);
        if (p.kind === 'design') wireTiers(mount, state, update);
        else wireMerch(mount, p, state, update);
        wireCta(mount);
        update();
    }

    function renderBuy(mount, product, flags, state) {
        var b = buyState(product, state, flags);
        var live = mount.querySelector('#stc-buy-live');
        if (live) live.innerHTML = buyLiveHtml(b);
        var hint = mount.querySelector('#stc-buy-hint');
        if (hint) { hint.textContent = b.hint || ''; hint.hidden = !b.hint; }
        var cta = mount.querySelector('#stc-buy-cta');
        if (!cta) return b;
        if (b.mode === 'buy' && b.href) {
            cta.setAttribute('href', b.href);
            ['aria-disabled', 'role', 'tabindex', 'aria-describedby'].forEach(function (a) { cta.removeAttribute(a); });
        } else {
            cta.removeAttribute('href');
            cta.setAttribute('role', 'link');
            cta.setAttribute('aria-disabled', 'true');
            cta.setAttribute('tabindex', '0');
            if (b.hint) cta.setAttribute('aria-describedby', 'stc-buy-hint');
            else cta.removeAttribute('aria-describedby');
        }
        return b;
    }

    // La selección queda en la URL (mismos nombres que el checkout) para que
    // volver desde el checkout la conserve.
    function syncItemParams(product, state) {
        if (product.kind === 'design') Shell.setParams({ license: state.tier });
        else Shell.setParams({ variant: state.variantId, qty: state.quantity > 1 ? state.quantity : null });
    }

    function wireGallery(mount, product) {
        var images = productImages(product);
        if (images.length < 2) return;
        mount.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-stc-thumb]') : null;
            if (!btn) return;
            var img = images[Number(btn.getAttribute('data-stc-thumb'))];
            if (!img) return;
            var main = mount.querySelector('#stc-gallery-main');
            if (main) {
                main.innerHTML = Shell.previewImg(img.path, { alt: imageAlt(product, img), loading: 'eager' });
                Shell.hydrateIcons(main);
            }
            mount.querySelectorAll('[data-stc-thumb]').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
        });
    }

    function wireTiers(mount, state, update) {
        mount.addEventListener('change', function (e) {
            var input = e.target;
            if (!input || input.name !== 'stc-tier' || !input.checked) return;
            state.tier = input.value;
            state.termsTier = input.value;
            mount.querySelectorAll('.stc-tier').forEach(function (card) {
                card.classList.toggle('is-checked', card.getAttribute('data-stc-tier') === state.tier);
            });
            var detail = mount.querySelector('#stc-tier-detail');
            if (detail) { detail.innerHTML = tierDetailHtml(state.tier); detail.hidden = false; }
            var title = mount.querySelector('#stc-terms-title');
            if (title) title.textContent = termsTitle(state.termsTier);
            var body = mount.querySelector('#stc-terms-body');
            if (body) body.innerHTML = termsBodyHtml(state.termsTier);
            update();
        });
    }

    function wireMerch(mount, product, state, update) {
        var input = mount.querySelector('#stc-qty-input');
        var currentMax = function () {
            var v = findVariant(product, state.variantId);
            return v ? variantState(v).max : MAX_QTY;
        };
        var syncQty = function (rewriteInput) {
            var max = currentMax();
            state.quantity = clampQty(state.quantity, max);
            if (input) {
                input.max = String(max);
                if (rewriteInput !== false) input.value = String(state.quantity);
            }
            var minus = mount.querySelector('[data-stc-step="-1"]');
            var plus = mount.querySelector('[data-stc-step="1"]');
            if (minus) { if (state.quantity <= 1) minus.setAttribute('aria-disabled', 'true'); else minus.removeAttribute('aria-disabled'); }
            if (plus) { if (state.quantity >= max) plus.setAttribute('aria-disabled', 'true'); else plus.removeAttribute('aria-disabled'); }
            var help = mount.querySelector('#stc-qty-help');
            if (help) help.textContent = qtyHelp(max);
        };
        mount.addEventListener('change', function (e) {
            var t = e.target;
            if (t && t.name === 'stc-variant' && t.checked) {
                state.variantId = t.value;
                syncQty();
                update();
            } else if (input && t === input) {
                state.quantity = clampQty(input.value, currentMax());
                syncQty();
                update();
            }
        });
        if (input) {
            input.addEventListener('input', function () {
                var n = Math.floor(num(input.value));
                if (!(n >= 1)) return;
                state.quantity = clampQty(n, currentMax());
                syncQty(false);
                update();
            });
        }
        mount.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-stc-step]') : null;
            if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
            state.quantity = clampQty(state.quantity + Number(btn.getAttribute('data-stc-step')), currentMax());
            syncQty();
            update();
        });
        syncQty();
    }

    // Con el CTA deshabilitado, un clic o Enter explica qué falta.
    function wireCta(mount) {
        var cta = mount.querySelector('#stc-buy-cta');
        if (!cta) return;
        var blocked = function (e) {
            if (cta.getAttribute('aria-disabled') !== 'true') return;
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            var hint = mount.querySelector('#stc-buy-hint');
            if (hint && hint.textContent) Shell.notify(hint.textContent, 'info');
        };
        cta.addEventListener('click', blocked);
        cta.addEventListener('keydown', blocked);
    }

    /* ------------------------------ arranque ------------------------------ */

    function boot() {
        var doc = root.document;
        if (!doc || !doc.body) return;
        if (!Model || !Shell) {
            if (root.console) root.console.error('[store-catalog] Cargá store-model.js y store-shell.js antes.');
            return;
        }
        var page = doc.body.getAttribute('data-stc-page');
        if (page === 'storefront') guard(initStorefront)();
        else if (page === 'item') guard(initItem)();
    }

    if (root.document && typeof root.document.addEventListener === 'function') {
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }

    return {
        FILTERS: FILTERS,
        LAST_FRONT_KEY: LAST_FRONT_KEY,
        kindCounts: kindCounts,
        showFilters: showFilters,
        normalizeFilter: normalizeFilter,
        filterProducts: filterProducts,
        merchPricing: merchPricing,
        pricedProduct: pricedProduct,
        variantPrice: variantPrice,
        priceSummary: priceSummary,
        kindLine: kindLine,
        variantName: variantName,
        variantState: variantState,
        variantLegend: variantLegend,
        clampQty: clampQty,
        deliveryMethods: deliveryMethods,
        countryName: countryName,
        countryList: countryList,
        sizeLabel: sizeLabel,
        avatarUrl: avatarUrl,
        profileUrl: profileUrl,
        editUrl: editUrl,
        viewerFlags: viewerFlags,
        tierOptions: tierOptions,
        defaultTier: defaultTier,
        initialItemState: initialItemState,
        buyState: buyState,
        cardHtml: cardHtml,
        storefrontHtml: storefrontHtml,
        itemHtml: itemHtml,
        buyLiveHtml: buyLiveHtml,
        messageHtml: messageHtml
    };
}));
