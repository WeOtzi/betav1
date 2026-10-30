/**
 * WE OTZI - Mis compras de la Store (/store/purchases/ · ?pedido=<id>)
 * --------------------------------------------------------------------
 * Contrato: docs/plans/2026-10-30-store-artista.md (§8.3 y §8.4, fila purchases).
 *
 *   - requireSession; sin sesión, links de ingreso con returnTo.
 *   - listMyPurchases(userId) → cards con orderView(order, { role: 'buyer' }).
 *   - ?pedido=<id> abre el detalle (sección con historial del navegador):
 *     timeline, instrucciones y contacto (snapshots del pedido), «Ya pagué →»
 *     (reportPayment) mientras esté pendiente, cancelar (sin pago informado),
 *     descargas del diseño pagado (listLicenseAssets + getDownloadUrl con la
 *     ventana abierta ANTES del await), «Imprimir a escala real» (stencil
 *     PNG/JPEG/WebP con medidas: las de la licencia o, si no están, las de la
 *     ficha pública), certificado, «Marcar licencia como usada»,
 *     seguimiento del envío y «Ya lo recibí →» (confirmReceived).
 *
 * Datos: SOLO WeotziData.Store y WeotziStoreShell (nada de /rest/v1 inline).
 */
(function () {
    'use strict';

    var M = window.WeotziStoreModel;
    var S = window.WeotziStoreShell;
    var Store = window.WeotziData && window.WeotziData.Store;

    var LIST_PATH = '/store/purchases/';
    var POPUP_BLOCKED = 'El navegador bloqueó la ventana nueva. Habilitá las ventanas emergentes y probá de nuevo.';
    // Hoja A4 con 10 mm de margen: lo que entra sin cortar.
    var A4_PRINTABLE_CM = { w: 19, h: 27.7 };

    var state = {
        viewer: null,
        orders: [],
        bundles: {},   // product_id → get_public_store_product (o null)
        assets: {},    // product_id → [assets]
        currentId: null,
        lastCardId: null
    };

    function $(id) { return document.getElementById(id); }
    function esc(v) { return S.esc(v); }

    /* ------------------------------------------------------------------ */
    /* Estados de página                                                   */
    /* ------------------------------------------------------------------ */

    var STATES = ['stb-loading', 'stb-message', 'stb-list', 'stb-detail'];
    function showState(id, focusEl) {
        STATES.forEach(function (s) { var el = $(s); if (el) el.hidden = s !== id; });
        S.hydrateIcons($(id));
        if (focusEl) { try { focusEl.focus({ preventScroll: false }); } catch (e) { focusEl.focus(); } }
    }

    function showMessage(opts) {
        var links = opts.links || [];
        var extra = links.length
            ? '<ul class="stb-auth-links">' + links.map(function (l) { return '<li><a class="stb-link" href="' + esc(l.href) + '">' + esc(l.label) + '</a></li>'; }).join('') + '</ul>'
            : '';
        $('stb-message').innerHTML =
            '<header class="sts-header"><p class="sts-eyebrow">Store</p><h1 class="sts-title" id="stb-message-title" tabindex="-1">' + esc(opts.heading || 'Mis compras') + '</h1></header>' +
            '<div class="sts-panel">' + S.emptyState({ icon: opts.icon || 'shopping-bag', title: opts.title, text: opts.text,
                actionLabel: opts.actionLabel, actionHref: opts.actionHref }) +
            (extra ? '<div class="stb-block">' + extra + '</div>' : '') + '</div>';
        showState('stb-message', $('stb-message-title'));
    }

    /* ------------------------------------------------------------------ */
    /* Lista                                                               */
    /* ------------------------------------------------------------------ */

    function itemLine(view) {
        var parts = [];
        if (view.kind) parts.push(M.KIND_LABELS[view.kind] || '');
        if (view.item && view.item.tierLabel) parts.push('Licencia ' + view.item.tierLabel);
        if (view.item && view.item.variantLabel) parts.push(view.item.variantLabel);
        if (view.item && view.item.kind === 'merch' && view.item.quantity > 1) parts.push(view.item.quantity + ' unidades');
        return parts.filter(Boolean).join(' · ');
    }

    // Una línea con lo próximo que tiene que pasar, para la card.
    function nextLine(order, view) {
        if (view.status === 'pending_payment') {
            if (view.overdue) return 'Venció el plazo para pagar';
            if (view.paymentReported) return view.nextAction && view.nextAction.kind === 'info' ? view.nextAction.label : 'Pago informado';
            return view.expiresLabel ? 'Pagalo antes del ' + view.expiresLabel : 'Esperando tu pago';
        }
        if (view.status === 'paid' && view.method !== 'digital') {
            if (view.actions.some(function (a) { return a.key === 'confirm_received'; })) {
                return view.fulfillmentStatus === 'ready_for_pickup' ? 'Listo para retirar · confirmá cuando lo tengas' : 'Enviado · confirmá cuando lo recibas';
            }
            return view.nextAction && view.nextAction.kind === 'info' ? view.nextAction.label : view.fulfillmentLabel;
        }
        if (view.license) {
            if (view.license.revoked) return 'Licencia revocada';
            return 'Licencia · ' + view.license.statusLabel;
        }
        return '';
    }

    function orderCardHtml(order) {
        var view = M.orderView(order, { role: 'buyer' });
        var item = view.item || {};
        var title = item.title || view.numberLabel;
        var next = nextLine(order, view);
        var fulfillmentTag = view.method !== 'digital' && view.status === 'paid'
            ? ' <span class="' + esc(view.fulfillmentTag) + ' sts-tag-s">' + esc(view.fulfillmentLabel) + '</span>' : '';
        return '<li><a class="stb-order-card" href="' + esc(M.purchasesUrl(order.id)) + '" data-stb-order="' + esc(order.id) + '">' +
            '<span class="stb-thumb">' + S.previewImg(item.imagePath, { alt: '' }) + '</span>' +
            '<span class="stb-order-body">' +
                '<span class="stb-order-top"><span class="' + esc(view.statusTag) + ' sts-tag-s">' + esc(view.statusLabel) + '</span>' + fulfillmentTag + '</span>' +
                '<span class="stb-order-title">' + esc(title) + '</span>' +
                '<span class="stb-order-line">' + esc([itemLine(view), view.numberLabel, M.formatDate(order.created_at)].filter(Boolean).join(' · ')) + '</span>' +
                (next ? '<span class="stb-order-next">' + esc(next) + '</span>' : '') +
            '</span>' +
            '<span class="stb-order-total">' + esc(view.totals.totalLabel) + '</span>' +
        '</a></li>';
    }

    function renderList() {
        state.currentId = null;
        S.setTitle('Mis compras');
        var box = $('stb-orders');
        if (!state.orders.length) {
            box.innerHTML = '<div class="sts-panel">' + S.emptyState({
                icon: 'shopping-bag',
                title: 'Todavía no compraste nada.',
                text: 'Cuando compres un diseño o merch en la Store de un artista, lo vas a ver acá.',
                actionLabel: 'Explorá artistas →',
                actionHref: '/marketplace'
            }) + '</div>';
        } else {
            box.innerHTML = '<ul class="stb-orders" aria-label="Pedidos">' + state.orders.map(orderCardHtml).join('') + '</ul>';
        }
        var back = state.lastCardId ? box.querySelector('[data-stb-order="' + cssEscape(state.lastCardId) + '"]') : null;
        showState('stb-list', back || $('stb-list-title'));
    }

    function cssEscape(v) {
        return window.CSS && typeof window.CSS.escape === 'function' ? window.CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&');
    }

    /* ------------------------------------------------------------------ */
    /* Detalle                                                             */
    /* ------------------------------------------------------------------ */

    function findOrder(id) {
        for (var i = 0; i < state.orders.length; i++) if (String(state.orders[i].id) === String(id)) return state.orders[i];
        return null;
    }
    function replaceOrder(order) {
        if (!order) return;
        var found = false;
        state.orders = state.orders.map(function (o) {
            if (String(o.id) === String(order.id)) { found = true; return order; }
            return o;
        });
        if (!found) state.orders.unshift(order);
    }

    function productIdOf(order) {
        var items = order.items || order.store_order_items || [];
        var licenses = order.licenses || order.store_licenses || [];
        return (items[0] && items[0].product_id) || (licenses[0] && licenses[0].product_id) || null;
    }
    function rawLicense(order) {
        var licenses = order.licenses || order.store_licenses || [];
        return licenses[0] || null;
    }

    // Datos públicos del producto (vendedor y medidas) y archivos de la licencia.
    function loadExtras(order) {
        var pid = productIdOf(order);
        var license = rawLicense(order);
        var jobs = [];
        if (pid && !(pid in state.bundles)) {
            jobs.push(Store.getPublicProduct(pid).then(function (b) { state.bundles[pid] = b || null; }, function () { state.bundles[pid] = null; }));
        }
        if (pid && license && !license.revoked_at && !(pid in state.assets)) {
            jobs.push(Store.listLicenseAssets(pid).then(function (list) { state.assets[pid] = list || []; }, function (err) {
                if (window.console) console.warn('[store-purchases] listLicenseAssets:', err && err.message);
                state.assets[pid] = null;
            }));
        }
        return Promise.all(jobs);
    }

    function timelineHtml(view) {
        return '<ol class="sts-timeline">' + view.timeline.map(function (s) {
            var cls = 'sts-timeline-step' + (s.done ? ' is-done' : '') + (s.current ? ' is-current' : '') + (s.skipped ? ' is-skipped' : '');
            var sr = s.current && !s.terminal ? 'En curso: ' : (s.done ? 'Hecho: ' : (s.skipped ? 'No ocurrió: ' : 'Pendiente: '));
            return '<li class="' + cls + '"><span class="sts-timeline-dot" aria-hidden="true"></span><span class="sts-timeline-text">' +
                '<span class="sts-timeline-label"><span class="wo-sr-only">' + esc(sr) + '</span>' + esc(s.label) + '</span>' +
                (s.atLabel ? '<span class="sts-timeline-at">' + esc(s.atLabel) + '</span>' : '') +
            '</span></li>';
        }).join('') + '</ol>';
    }

    function sellerContactHtml(order) {
        if (!order.seller_contact) return '';
        return '<div class="stb-block"><h3 class="stb-block-title">Contacto del vendedor</h3><p class="stb-text">' + esc(order.seller_contact) + '</p>' +
            '<p class="stb-text stb-text--s stb-muted">Escribile con el número de pedido si tenés dudas sobre el pago o la entrega.</p></div>';
    }

    function paymentPanelHtml(order, view) {
        if (view.status !== 'pending_payment') return '';
        var manual = !order.payment_provider || order.payment_provider === 'manual';
        var blocks = [];
        var reportAction = view.actions.filter(function (a) { return a.key === 'report_payment'; })[0];
        var cancelAction = view.actions.filter(function (a) { return a.key === 'cancel'; })[0];
        var head = '<h2 class="stb-block-title">' + (view.paymentReported ? 'Pago informado' : 'Pagá tu pedido') + '</h2>';
        if (view.overdue && view.paymentReported) {
            head += '<p class="wo-alert wo-alert--warning">Informaste el pago, pero el vendedor no lo confirmó a tiempo. Soporte va a revisar el pedido; si querés, escribile.</p>';
        } else if (view.overdue) {
            head += '<p class="wo-alert wo-alert--warning">Venció el plazo para pagar este pedido. Si ya pagaste, escribile al vendedor con el número de pedido.</p>';
        } else if (view.paymentReported) {
            head += '<p class="stb-text">' + esc(view.nextAction && view.nextAction.kind === 'info' ? view.nextAction.label : 'Informaste el pago.') + '</p>' +
                '<p class="stb-text stb-text--s stb-muted">' + esc((view.paymentReference ? 'Referencia: ' + view.paymentReference + ' · ' : '') +
                    'Informado el ' + M.formatDateTime(order.buyer_payment_reported_at) + (view.expiresLabel ? ' · Reservado hasta el ' + view.expiresLabel : '')) + '</p>';
        } else if (view.deadlineLabel) {
            head += '<p class="stb-deadline">' + esc(view.deadlineLabel) + '</p>';
        }
        blocks.push('<div class="stb-block">' + head + '</div>');

        if (!manual) {
            // TODO(store-pagos): con un proveedor real (Stripe, Mercado Pago) hay
            // que llamar a POST /api/store/orders/:id/checkout con Bearer y seguir
            // el redirectUrl o las instrucciones del adaptador. WeotziData.Store
            // todavía no expone ese método; mientras tanto, mensaje genérico.
            blocks.push('<div class="stb-block"><p class="stb-text">Estamos preparando el pago de este pedido. Volvé a mirarlo en unos minutos.</p></div>');
        } else {
            var payTo = view.collector === 'platform' ? 'Le pagás a We Ötzi' : 'Le pagás directo al vendedor';
            blocks.push('<div class="stb-block"><h3 class="stb-block-title">Cómo pagar</h3>' +
                '<p class="stb-block-sub">' + esc(payTo) + '. Pagá el monto exacto: ' + esc(view.totals.totalLabel) + '.</p>' +
                (order.payment_instructions ? '<p class="stb-pre">' + esc(order.payment_instructions) + '</p>'
                    : '<p class="stb-text">El vendedor todavía no cargó las instrucciones. Escribile por el contacto de abajo.</p>') +
            '</div>');
        }
        blocks.push(sellerContactHtml(order));

        if (manual && reportAction && !view.overdue && view.collector !== 'provider') {
            blocks.push('<div class="stb-block">' +
                '<h3 class="stb-block-title">' + (view.paymentReported ? 'Actualizá el comprobante' : 'Informá tu pago') + '</h3>' +
                '<p class="stb-block-sub">Dejá la referencia del comprobante para que el vendedor encuentre tu pago rápido.</p>' +
                '<form class="stb-form" id="stb-report-form" novalidate>' +
                    '<div class="wo-field">' +
                        '<label class="wo-label" for="stb-report-ref">Referencia del comprobante</label>' +
                        '<input class="wo-input" id="stb-report-ref" name="reference" type="text" maxlength="200" required value="' + esc(view.paymentReference || '') + '" aria-describedby="stb-report-ref-help">' +
                        '<p class="wo-help" id="stb-report-ref-help">Por ejemplo, el número de operación de la transferencia o el nombre de quien pagó.</p>' +
                        '<p class="wo-error-msg" id="stb-report-ref-error" hidden></p>' +
                    '</div>' +
                    '<div class="stb-actions"><button class="wo-btn wo-btn--hard" type="submit" id="stb-report-submit">' + esc(reportAction.label) + '</button></div>' +
                '</form></div>');
        }
        if (cancelAction) {
            blocks.push('<div class="stb-block"><div class="stb-inline-actions">' +
                '<button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-stb-action="cancel">' + esc(cancelAction.label) + '</button>' +
                '<p class="stb-text stb-text--s stb-muted">Si no lo vas a pagar, cancelalo y el producto queda libre para otra persona.</p>' +
            '</div></div>');
        } else if (view.paymentReported) {
            blocks.push('<div class="stb-block"><p class="stb-text stb-text--s stb-muted">Ya informaste un pago: para cancelar el pedido, escribile a soporte.</p></div>');
        }
        return '<div class="sts-panel">' + blocks.join('') + '</div>';
    }

    function assetLabel(kind) { return kind === 'stencil' ? 'Bajar stencil' : 'Bajar original'; }

    function sizeFrom(src) {
        if (!src) return null;
        var w = Number(src.design_width_cm);
        var h = Number(src.design_height_cm);
        return w > 0 && h > 0 ? { width: w, height: h } : null;
    }

    // Medidas del diseño para imprimir a escala. Primero las que quedaron en la
    // licencia (metadata_json) o en el ítem al emitirla: siguen ahí aunque el
    // producto ya no sea público (una exclusiva vendida se retira, un diseño
    // pausado no sale en get_public_store_product). Si no están, las de la
    // ficha pública.
    function designSize(order) {
        var raw = rawLicense(order);
        var items = order.items || order.store_order_items || [];
        var pid = productIdOf(order);
        var bundle = pid ? state.bundles[pid] : null;
        return sizeFrom(raw && raw.metadata_json) || sizeFrom(items[0]) || sizeFrom(bundle && bundle.product);
    }

    function printableStencil(order) {
        var pid = productIdOf(order);
        var bundle = pid ? state.bundles[pid] : null;
        var product = bundle && bundle.product;
        var raw = rawLicense(order);
        var items = order.items || order.store_order_items || [];
        var assets = (pid && state.assets[pid]) || [];
        var size = designSize(order);
        if (!size) return null;
        var stencil = assets.filter(function (a) {
            return a.kind === 'stencil' && M.FILES.PRINTABLE_MIME.indexOf(String(a.mime_type || '').toLowerCase()) !== -1;
        })[0];
        var title = (product && product.title) || (raw && raw.design_title) || (items[0] && items[0].title) || 'tu diseño';
        return stencil ? { asset: stencil, width: size.width, height: size.height, title: title } : null;
    }

    function licensePanelHtml(order, view) {
        if (view.method !== 'digital') return '';
        var license = view.license;
        var raw = rawLicense(order);
        if (!license) {
            if (view.status === 'pending_payment') {
                return '<div class="sts-panel"><div class="stb-block"><h2 class="stb-block-title">Licencia y archivos</h2>' +
                    '<p class="stb-text">Cuando el vendedor confirme tu pago, acá vas a poder bajar el original, el stencil y el certificado de tu licencia.</p></div></div>';
            }
            return '';
        }
        if (license.revoked) {
            return '<div class="sts-panel"><div class="stb-block"><h2 class="stb-block-title">Licencia</h2>' +
                '<p class="wo-alert wo-alert--error">' + esc('Esta licencia fue revocada' + (license.revokeReason ? ' (' + license.revokeReason + ')' : '') +
                    '. Ya no es válida y los archivos no se pueden bajar.') + '</p></div></div>';
        }
        var pid = productIdOf(order);
        var assets = pid ? state.assets[pid] : [];
        var isHolder = !!(raw && state.viewer && state.viewer.user && String(raw.holder_user_id) === String(state.viewer.user.id));
        var downloads;
        if (assets === null) {
            downloads = '<p class="stb-text">No pudimos cargar los archivos. Recargá la página para intentar de nuevo.</p>';
        } else if (!assets || !assets.length) {
            downloads = '<p class="stb-text">Los archivos de este diseño ya no están disponibles. Escribile al vendedor.</p>';
        } else {
            var buttons = assets.slice().sort(function (a, b) { return a.kind === b.kind ? 0 : (a.kind === 'original' ? -1 : 1); }).map(function (a) {
                return '<button class="wo-btn wo-btn--ghost wo-btn--hard" type="button" data-stb-action="download" data-asset="' + esc(a.id) + '">' +
                    '<i data-wo-icon="download" class="wo-icon-18" aria-hidden="true"></i>' + esc(assetLabel(a.kind)) +
                    '<span class="wo-sr-only"> (' + esc(a.file_name || '') + ')</span></button>';
            });
            var printable = printableStencil(order);
            if (printable) {
                buttons.push('<button class="wo-btn wo-btn--ghost wo-btn--hard" type="button" data-stb-action="print-scale" aria-describedby="stb-print-help">' +
                    '<i data-wo-icon="printer" class="wo-icon-18" aria-hidden="true"></i>Imprimir a escala real</button>');
            }
            downloads = '<div class="stb-downloads">' + buttons.join('') + '</div>' +
                (printable ? '<p class="stb-text stb-text--s stb-muted" id="stb-print-help">El stencil se imprime a ' + esc(fmtCm(printable.width)) + ' × ' + esc(fmtCm(printable.height)) + ' cm.</p>' : '') +
                '<p class="stb-text stb-text--s stb-muted">Cada enlace de descarga dura 5 minutos. Guardá los archivos en un lugar seguro: son para tu uso, no para publicarlos.</p>';
        }
        var used = license.used
            ? '<p class="stb-text stb-text--s">' + esc('Usada el ' + (license.usedLabel || '') + (license.usedNote ? ' · ' + license.usedNote : '')) + '</p>'
            : '';
        return '<div class="sts-panel">' +
            '<div class="stb-block"><h2 class="stb-block-title">Tu licencia</h2>' +
                '<dl class="sts-kv">' +
                    '<dt>Nivel</dt><dd>Licencia ' + esc(license.tierLabel) + '</dd>' +
                    '<dt>Titular</dt><dd>' + esc(license.holderName) + '</dd>' +
                    '<dt>Código</dt><dd><span class="stb-license-code">' + esc(license.code || '—') + '</span></dd>' +
                    '<dt>Uso</dt><dd><span class="' + esc(license.statusTag) + ' sts-tag-s">' + esc(license.statusLabel) + '</span></dd>' +
                '</dl>' + used +
                '<div class="stb-inline-actions">' +
                    '<a class="wo-btn wo-btn--ghost wo-btn--s" href="' + esc(M.licenseUrl(raw.id)) + '">Ver certificado →</a>' +
                    (license.canMarkUsed && isHolder ? '<button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-stb-action="mark-used">Marcar licencia como usada</button>' : '') +
                '</div>' +
            '</div>' +
            '<div class="stb-block"><h2 class="stb-block-title">Archivos</h2>' + downloads + '</div>' +
        '</div>';
    }

    function fmtCm(n) { return String(Math.round(Number(n) * 10) / 10).replace('.', ','); }

    function addressHtml(a) {
        if (!a) return '';
        var lines = [a.recipient, [a.line1, a.line2].filter(Boolean).join(', '), [a.city, a.region, a.postal_code].filter(Boolean).join(', '), a.country, a.phone ? 'Tel. ' + a.phone : null]
            .filter(Boolean);
        return '<address class="stb-address">' + lines.map(esc).join('<br>') + '</address>';
    }

    function deliveryPanelHtml(order, view) {
        if (view.method === 'digital') return '';
        var blocks = [];
        var title = view.method === 'pickup' ? 'Retiro en el estudio' : 'Envío a domicilio';
        var status = (view.status === 'paid' || view.status === 'fulfilled') ? '<span class="' + esc(view.fulfillmentTag) + ' sts-tag-s">' + esc(view.fulfillmentLabel) + '</span>' : '';
        var body = '';
        if (view.method === 'shipping') {
            body += order.shipping_address ? addressHtml(order.shipping_address) : '';
        } else if (order.pickup_details) {
            body += '<p class="stb-text stb-text--s stb-muted">Dirección de retiro</p><p class="stb-pre">' + esc(order.pickup_details) + '</p>';
        } else {
            body += '<p class="stb-text">La dirección exacta del estudio te llega cuando el vendedor confirme el pago.</p>';
        }
        blocks.push('<div class="stb-block"><div class="stb-inline-actions"><h2 class="stb-block-title">' + esc(title) + '</h2>' + status + '</div>' + body + '</div>');

        if (view.tracking) {
            var t = view.tracking;
            blocks.push('<div class="stb-block"><h3 class="stb-block-title">Seguimiento</h3>' +
                '<dl class="sts-kv">' +
                    (t.carrier ? '<dt>Empresa</dt><dd>' + esc(t.carrier) + '</dd>' : '') +
                    (t.code ? '<dt>Código</dt><dd><span class="stb-license-code">' + esc(t.code) + '</span></dd>' : '') +
                '</dl>' +
                (t.url ? '<a class="wo-btn wo-btn--ghost wo-btn--s" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">Seguir el envío →<span class="wo-sr-only"> (se abre en otra pestaña)</span></a>' : '') +
            '</div>');
        }
        if (order.seller_message) {
            blocks.push('<div class="stb-block"><h3 class="stb-block-title">Mensaje del vendedor</h3><p class="stb-pre">' + esc(order.seller_message) + '</p></div>');
        }
        var confirm = view.actions.filter(function (a) { return a.key === 'confirm_received'; })[0];
        if (confirm) {
            blocks.push('<div class="stb-block"><p class="stb-text stb-text--s">' +
                (view.method === 'pickup' ? 'Cuando lo retires, confirmalo acá.' : 'Cuando lo recibas, confirmalo acá.') + '</p>' +
                '<div class="stb-actions"><button class="wo-btn wo-btn--hard" type="button" data-stb-action="confirm-received">' + esc(confirm.label) + '</button></div></div>');
        } else if (view.status === 'paid' && view.nextAction && view.nextAction.kind === 'info') {
            blocks.push('<div class="stb-block"><p class="stb-text stb-text--s stb-muted">' + esc(view.nextAction.label) + '</p></div>');
        }
        if (order.delivered_at && view.fulfillmentStatus === 'delivered') {
            blocks.push('<div class="stb-block"><p class="stb-text stb-text--s stb-muted">Entregado el ' + esc(M.formatDateTime(order.delivered_at)) + '.</p></div>');
        }
        return '<div class="sts-panel">' + blocks.join('') + '</div>';
    }

    function terminalPanelHtml(order, view) {
        var text = null;
        if (view.status === 'cancelled') text = 'Cancelaste este pedido' + (order.cancel_reason ? ' · Motivo: ' + order.cancel_reason : '') + '.';
        if (view.status === 'cancelled' && order.cancel_reason === 'exclusive_sold') text = 'Este pedido se canceló porque el diseño se vendió con licencia exclusiva.';
        if (view.status === 'expired') text = 'Este pedido venció porque no se informó el pago a tiempo.';
        if (view.status === 'refunded') text = 'Este pedido se reembolsó' + (order.refunded_at ? ' el ' + M.formatDate(order.refunded_at) : '') + '.';
        if (!text) return '';
        return '<div class="sts-panel"><div class="stb-block"><p class="stb-text">' + esc(text) + '</p></div></div>';
    }

    function helpHtml(order) {
        var contact = order.seller_contact
            ? 'Escribile al vendedor (' + esc(order.seller_contact) + ') o '
            : 'Escribile ';
        return '<p class="stb-help">¿Problemas con tu pedido? ' + contact +
            '<button type="button" class="stb-linkbtn" data-stb-action="support">a soporte →</button></p>';
    }

    function summaryAsideHtml(order, view) {
        var item = view.item || {};
        var pid = productIdOf(order);
        var bundle = pid ? state.bundles[pid] : null;
        var raw = rawLicense(order);
        var sellerName = (bundle && bundle.seller && bundle.seller.name) || (raw && raw.seller_display_name) || '';
        var handle = (bundle && bundle.seller && bundle.seller.handle) || (raw && raw.seller_username) || '';
        var rows = '<div class="stb-total-row"><dt>' + esc(item.kind === 'merch' ? (item.variantLabel || 'Producto') + ' × ' + (item.quantity || 1) : 'Licencia ' + (item.tierLabel || '')) + '</dt>' +
            '<dd>' + esc(view.totals.subtotalLabel) + '</dd></div>';
        if (view.method === 'shipping') rows += '<div class="stb-total-row"><dt>Envío</dt><dd>' + esc(view.totals.shipping > 0 ? view.totals.shippingLabel : 'Sin cargo') + '</dd></div>';
        if (view.method === 'pickup') rows += '<div class="stb-total-row"><dt>Retiro</dt><dd>Sin cargo</dd></div>';
        rows += '<div class="stb-total-row stb-total-row--grand"><dt>Total</dt><dd>' + esc(view.totals.totalLabel) + '</dd></div>';
        return '<div class="sts-panel">' +
            '<div class="stb-block"><div class="stb-summary">' +
                '<div class="stb-thumb">' + S.previewImg(item.imagePath, { alt: '' }) + '</div>' +
                '<div class="stb-summary-body"><p class="stb-meta">' + esc(itemLine(view)) + '</p>' +
                    '<p class="stb-summary-title">' + esc(item.title || view.numberLabel) + '</p>' +
                    (sellerName ? '<p class="stb-summary-line">De ' + esc(sellerName) + (handle ? ' · <a class="stb-link" href="' + esc(M.storeUrl(handle)) + '">Ver su Store →</a>' : '') + '</p>' : '') +
                '</div></div></div>' +
            '<div class="stb-block"><dl class="stb-totals">' + rows + '</dl></div>' +
            '<div class="stb-block"><dl class="sts-kv">' +
                '<dt>Pedido</dt><dd>' + esc(view.number || '—') + '</dd>' +
                '<dt>Fecha</dt><dd>' + esc(M.formatDateTime(order.created_at)) + '</dd>' +
                '<dt>Entrega</dt><dd>' + esc(view.methodLabel) + '</dd>' +
                (order.buyer_note ? '<dt>Tu nota</dt><dd>' + esc(order.buyer_note) + '</dd>' : '') +
            '</dl></div>' +
        '</div>';
    }

    function renderDetail(order) {
        var view = M.orderView(order, { role: 'buyer' });
        var item = view.item || {};
        state.currentId = order.id;
        state.lastCardId = order.id;
        var tags = '<span class="' + esc(view.statusTag) + ' sts-tag-s">' + esc(view.statusLabel) + '</span>' +
            (view.method !== 'digital' && (view.status === 'paid' || view.status === 'fulfilled') ? '<span class="' + esc(view.fulfillmentTag) + ' sts-tag-s">' + esc(view.fulfillmentLabel) + '</span>' : '');
        var main = [
            paymentPanelHtml(order, view),
            terminalPanelHtml(order, view),
            licensePanelHtml(order, view),
            deliveryPanelHtml(order, view),
            '<div class="sts-panel"><div class="stb-block"><h2 class="stb-block-title">Historial</h2>' + timelineHtml(view) + '</div></div>',
            helpHtml(order)
        ].filter(Boolean).join('');
        $('stb-detail').innerHTML =
            '<a class="stb-back" href="' + esc(S.appPath(LIST_PATH)) + '" data-stb-back>← Mis compras</a>' +
            '<header class="stb-detail-head">' +
                '<p class="sts-eyebrow">Mis compras · ' + esc(view.numberLabel) + '</p>' +
                '<h1 class="sts-title" id="stb-detail-title" tabindex="-1">' + esc(item.title || view.numberLabel) + '</h1>' +
                '<div class="stb-tags">' + tags + '</div>' +
            '</header>' +
            '<div class="stb-layout">' +
                '<div class="stb-main">' + main + '</div>' +
                '<aside class="stb-aside" aria-label="Resumen del pedido">' + summaryAsideHtml(order, view) + '</aside>' +
            '</div>';
        S.setTitle((item.title || view.numberLabel) + ' · Mis compras');
        var form = $('stb-report-form');
        if (form) form.addEventListener('submit', onReport);
        showState('stb-detail', $('stb-detail-title'));
    }

    function openDetail(id) {
        var cached = findOrder(id);
        var load = cached ? Promise.resolve(cached) : Store.getMyOrder(id).catch(function () { return null; });
        showState('stb-loading');
        return load.then(function (order) {
            if (!order) {
                showMessage({ icon: 'search', heading: 'Mis compras', title: 'No encontramos ese pedido.',
                    text: 'Puede que sea de otra cuenta o que el enlace esté incompleto.', actionLabel: 'Ver todas mis compras →', actionHref: LIST_PATH });
                return;
            }
            replaceOrder(order);
            return loadExtras(order).then(function () { renderDetail(order); });
        });
    }

    // Acciones que cambian el estado del pedido: con la vista desactualizada,
    // un segundo clic daría un error del servidor (invalid_status).
    var STALE_ACTIONS = '[data-stb-action="cancel"],[data-stb-action="confirm-received"],[data-stb-action="mark-used"],#stb-report-submit,#stb-report-ref';
    var STALE_COPY = 'Actualizamos tu pedido, pero no pudimos recargar la vista. Recargá la página.';

    function markDetailStale() {
        var box = $('stb-detail');
        if (!box) return;
        Array.prototype.forEach.call(box.querySelectorAll(STALE_ACTIONS), function (el) {
            el.disabled = true;
            el.removeAttribute('aria-busy');
            var label = el.getAttribute('data-sts-label');
            if (label != null) { el.textContent = label; el.removeAttribute('data-sts-label'); }
        });
        if (!$('stb-detail-stale')) {
            var head = box.querySelector('.stb-detail-head');
            var html = '<p class="wo-alert wo-alert--warning" id="stb-detail-stale">' + esc(STALE_COPY) +
                ' <button type="button" class="stb-linkbtn" data-stb-action="reload">Recargar la página</button></p>';
            if (head && typeof head.insertAdjacentHTML === 'function') head.insertAdjacentHTML('afterend', html);
        }
        S.notify(STALE_COPY, 'error');
    }

    function refreshCurrent() {
        var id = state.currentId;
        if (!id) return Promise.resolve();
        return Store.getMyOrder(id).then(function (order) {
            if (!order) throw new Error('Pedido sin datos');
            replaceOrder(order);
            return loadExtras(order).then(function () { renderDetail(order); });
        }).catch(function (err) {
            if (window.console) console.warn('[store-purchases] getMyOrder:', err && err.message);
            if (String(state.currentId) === String(id)) markDetailStale();
        });
    }

    /* ------------------------------------------------------------------ */
    /* Acciones                                                            */
    /* ------------------------------------------------------------------ */

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
        Store.reportPayment(state.currentId, ref).then(function () {
            S.notify('Pago informado. El vendedor lo va a confirmar.', 'success');
            return refreshCurrent();
        }).catch(function (err) {
            S.setBusy(btn, false);
            S.notifyError(err, 'No pudimos informar el pago. Probá de nuevo.');
        });
    }

    function onCancel() {
        S.confirmDialog({
            title: '¿Cancelar el pedido?',
            message: 'El producto queda libre para otra persona y este pedido ya no se va a poder pagar. No se puede deshacer.',
            confirmLabel: 'Cancelar pedido',
            cancelLabel: 'Volver',
            tone: 'danger',
            input: { label: 'Motivo (opcional)', maxLength: 300, multiline: true }
        }).then(function (res) {
            if (!res.confirmed) return;
            return Store.cancelOrder(state.currentId, res.value || null).then(function () {
                S.notify('Cancelaste el pedido.', 'success');
                return refreshCurrent();
            }).catch(function (err) { S.notifyError(err, 'No pudimos cancelar el pedido. Probá de nuevo.'); });
        });
    }

    function onConfirmReceived() {
        var order = findOrder(state.currentId);
        var pickup = order && order.fulfillment_method === 'pickup';
        S.confirmDialog({
            title: pickup ? '¿Ya retiraste tu pedido?' : '¿Ya recibiste tu pedido?',
            message: 'Confirmalo solo cuando lo tengas en tus manos. Con esto el pedido queda completado.',
            confirmLabel: pickup ? 'Sí, ya lo retiré' : 'Sí, ya lo recibí',
            cancelLabel: 'Todavía no'
        }).then(function (res) {
            if (!res.confirmed) return;
            return Store.confirmReceived(state.currentId).then(function () {
                S.notify('Listo, el pedido quedó completado.', 'success');
                return refreshCurrent();
            }).catch(function (err) { S.notifyError(err, 'No pudimos confirmar la entrega. Probá de nuevo.'); });
        });
    }

    function onMarkUsed() {
        var order = findOrder(state.currentId);
        var license = order && rawLicense(order);
        if (!license) return;
        S.confirmDialog({
            title: '¿Marcar la licencia como usada?',
            message: 'Cada licencia cubre un solo tatuaje. Al marcarla, la verificación pública muestra la fecha de uso. No se puede deshacer.',
            confirmLabel: 'Marcar como usada',
            cancelLabel: 'Volver',
            input: { label: 'Nota (opcional)', placeholder: 'Por ejemplo: tatuado el 12/11 en Estudio X', maxLength: 160 }
        }).then(function (res) {
            if (!res.confirmed) return;
            return Store.markLicenseUsed(license.id, res.value || null).then(function () {
                S.notify('Marcaste la licencia como usada.', 'success');
                return refreshCurrent();
            }).catch(function (err) { S.notifyError(err, 'No pudimos marcar la licencia. Probá de nuevo.'); });
        });
    }

    function absoluteUrl(url) {
        try { return new URL(url, window.location.href).href; } catch (e) { return url; }
    }

    // La ventana se abre en el clic (antes del await) para que el navegador no
    // la bloquee; después se le carga la URL firmada (300 s) del servidor.
    function onDownload(assetId) {
        var order = findOrder(state.currentId);
        var license = order && rawLicense(order);
        var pid = order && productIdOf(order);
        var asset = ((pid && state.assets[pid]) || []).filter(function (a) { return String(a.id) === String(assetId); })[0];
        if (!license || !asset) return;
        var popup = window.open('', '_blank');
        if (!popup) { S.notify(POPUP_BLOCKED, 'error'); return; }
        popup.opener = null;
        Store.getDownloadUrl(license.id, asset).then(function (url) {
            popup.location.href = absoluteUrl(url);
        }).catch(function (err) {
            try { popup.close(); } catch (e) { /* ya cerrada */ }
            S.notifyError(err, 'No pudimos preparar la descarga. Probá de nuevo.');
        });
    }

    // Documento de impresión con la imagen a la medida real del diseño (cm).
    function writePrintShell(popup, info) {
        var d = popup.document;
        d.open();
        d.write('<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>');
        d.close();
        d.title = 'Stencil a escala real · ' + info.title;
        var tokens = d.createElement('link');
        tokens.rel = 'stylesheet';
        tokens.href = absoluteUrl(S.appPath('/shared/css/ds/tokens.css'));
        d.head.appendChild(tokens);
        var style = d.createElement('style');
        style.textContent =
            '@page{size:auto;margin:10mm}' +
            'html,body{margin:0;background:var(--white);color:var(--text-body);font-family:var(--font-body)}' +
            '.bar{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;justify-content:space-between;padding:var(--space-4);border-bottom:var(--border-strong-width) solid var(--border-strong)}' +
            '.bar p{margin:0;max-width:40rem;font-size:var(--body-s-size);line-height:var(--body-s-lh)}' +
            '.bar button{min-height:var(--control-h-md);padding:0 var(--space-5);border:var(--border-strong-width) solid var(--border-strong);background:var(--action-primary);color:var(--action-primary-fg);font-family:var(--font-body);font-weight:var(--weight-bold);text-transform:uppercase;letter-spacing:var(--button-m-track);cursor:pointer}' +
            '.bar button:focus-visible{box-shadow:var(--shadow-focus);outline:none}' +
            '.sheet{padding:var(--space-4)}' +
            '.sheet img{display:block;max-width:none;object-fit:contain}' +
            '@media print{.bar{display:none}.sheet{padding:0}}';
        d.head.appendChild(style);
        var bar = d.createElement('div');
        bar.className = 'bar';
        var p = d.createElement('p');
        var size = fmtCm(info.width) + ' × ' + fmtCm(info.height) + ' cm';
        var tooBig = !((info.width <= A4_PRINTABLE_CM.w && info.height <= A4_PRINTABLE_CM.h) || (info.width <= A4_PRINTABLE_CM.h && info.height <= A4_PRINTABLE_CM.w));
        p.textContent = 'El stencil mide ' + size + '. Imprimilo al 100 %, sin «Ajustar a la página», para que salga a escala real.' +
            (tooBig ? ' Es más grande que una hoja A4: elegí un papel más grande o imprimilo por partes.' : '');
        var status = d.createElement('p');
        status.setAttribute('role', 'status');
        status.textContent = 'Cargando el stencil…';
        var btn = d.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Imprimir';
        btn.addEventListener('click', function () { popup.print(); });
        bar.appendChild(p);
        bar.appendChild(status);
        bar.appendChild(btn);
        var sheet = d.createElement('div');
        sheet.className = 'sheet';
        d.body.appendChild(bar);
        d.body.appendChild(sheet);
        return { sheet: sheet, status: status };
    }

    function onPrintScale() {
        var order = findOrder(state.currentId);
        var license = order && rawLicense(order);
        var info = order && printableStencil(order);
        if (!license || !info) return;
        var popup = window.open('', '_blank');
        if (!popup) { S.notify(POPUP_BLOCKED, 'error'); return; }
        popup.opener = null;
        var shell;
        try { shell = writePrintShell(popup, info); } catch (e) { shell = null; }
        Store.getDownloadUrl(license.id, info.asset).then(function (url) {
            if (!shell) { popup.location.href = absoluteUrl(url); return; }
            var d = popup.document;
            var img = d.createElement('img');
            img.alt = 'Stencil de ' + info.title + ' a escala real';
            img.style.width = info.width + 'cm';
            img.style.height = info.height + 'cm';
            img.addEventListener('load', function () {
                shell.status.textContent = 'Listo para imprimir.';
                setTimeout(function () { try { popup.focus(); popup.print(); } catch (e) { /* el usuario imprime con el botón */ } }, 300);
            });
            img.addEventListener('error', function () { shell.status.textContent = 'No pudimos cargar el stencil. Cerrá esta ventana y probá de nuevo.'; });
            img.src = absoluteUrl(url);
            shell.sheet.appendChild(img);
        }).catch(function (err) {
            try { popup.close(); } catch (e) { /* ya cerrada */ }
            S.notifyError(err, 'No pudimos preparar el stencil. Probá de nuevo.');
        });
    }

    function openSupport() {
        if (window.SupportChat && typeof window.SupportChat.openPanel === 'function') {
            window.SupportChat.openPanel();
            return;
        }
        S.notify('El chat de soporte no está disponible en este momento. Probá en unos minutos o escribile al vendedor.', 'info');
    }

    /* ------------------------------------------------------------------ */
    /* Navegación                                                          */
    /* ------------------------------------------------------------------ */

    function route() {
        var id = S.param('pedido');
        if (id) return openDetail(id);
        renderList();
        return Promise.resolve();
    }

    function onClick(e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var plain = !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) && e.button === 0;
        var card = t.closest('[data-stb-order]');
        if (card && plain) {
            e.preventDefault();
            S.setParams({ pedido: card.getAttribute('data-stb-order') }, { push: true });
            openDetail(card.getAttribute('data-stb-order'));
            return;
        }
        if (t.closest('[data-stb-back]') && plain) {
            e.preventDefault();
            S.setParams({ pedido: null }, { push: true });
            renderList();
            return;
        }
        var btn = t.closest('[data-stb-action]');
        if (!btn) return;
        var act = btn.getAttribute('data-stb-action');
        if (act === 'cancel') onCancel();
        else if (act === 'confirm-received') onConfirmReceived();
        else if (act === 'mark-used') onMarkUsed();
        else if (act === 'download') onDownload(btn.getAttribute('data-asset'));
        else if (act === 'print-scale') onPrintScale();
        else if (act === 'support') openSupport();
        else if (act === 'reload') window.location.reload();
    }

    function init() {
        if (!M || !S || !Store) {
            if (window.console) console.error('[store-purchases] Faltan store-model.js, store-shell.js o data/store-repo.js.');
            return;
        }
        document.addEventListener('click', onClick);
        window.addEventListener('popstate', function () { if (state.viewer && state.viewer.session) route(); });

        S.mountStoreTopbar('store-topbar', { active: 'purchases' });
        S.isStoreEnabled().then(function (enabled) {
            if (!enabled) {
                showMessage({ icon: 'clock', title: 'La Store todavía no está disponible.', text: 'Estamos terminando de prepararla. Volvé a mirarla en unos días.',
                    actionLabel: 'Explorá artistas →', actionHref: '/marketplace' });
                return null;
            }
            var returnTo = LIST_PATH + (window.location.search || '');
            return S.requireSession({ returnTo: returnTo }).then(function (session) {
                if (!session) {
                    var links = S.loginLinks(returnTo);
                    showMessage({ icon: 'lock', title: 'Ingresá para ver tus compras.', text: 'Tus pedidos, licencias y descargas quedan guardados en tu cuenta.',
                        actionLabel: 'Ingresá →', actionHref: links.client,
                        links: [{ label: 'Creá tu cuenta →', href: links.register }, { label: '¿Sos artista? Ingresá →', href: links.artist }] });
                    return null;
                }
                return S.viewer().then(function (v) {
                    state.viewer = v;
                    return Store.listMyPurchases(v.user.id);
                }).then(function (orders) {
                    state.orders = Array.isArray(orders) ? orders : [];
                    return route();
                });
            });
        }).catch(function (err) {
            if (window.console) console.error('[store-purchases]', err);
            showMessage({ icon: 'alert-circle', title: 'No pudimos cargar tus compras.', text: 'Probá de nuevo en unos minutos.',
                actionLabel: 'Volver a intentar →', actionHref: LIST_PATH });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
