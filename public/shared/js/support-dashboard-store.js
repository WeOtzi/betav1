/**
 * WE OTZI - Support Dashboard · pestaña STORE
 * -------------------------------------------
 * Plugin del dashboard de soporte (support-dashboard.js) para la Store del
 * artista. Contrato: docs/plans/2026-10-30-store-artista.md §8.5.
 *
 *   Lista: pedidos que cobra We Ötzi por confirmar (expected_collector
 *   'platform', WeotziData.Store.listPendingPlatformOrders), pedidos marcados
 *   needs_support o con fondos retenidos (listFlaggedOrders) y, si el repo lo
 *   ofrece, los vencidos recientes (listRecentExpiredOrders) para reabrirlos.
 *   Drawer: detalle del pedido con confirmar pago (collectedBy = el
 *   expected_collector), cancelar (también con pago informado), reembolsar y
 *   retener / liberar fondos (solo en pedidos que pasan por el wallet).
 *
 * Se activa solo con el gate de la Store:
 *   WeotziData.Store.featureEnabled() && await WeotziData.Store.isAvailable()
 * Sin el gate no agrega nada a la página.
 *
 * Integración sin tocar support-dashboard.js: suma columnConfigs.store y
 * envuelve switchTab, renderFilters y applyFiltersAndSort solo para la pestaña
 * 'store'; las demás pestañas siguen por el código original.
 *
 * Carga: después de support-dashboard.js, store-model.js y data/store-repo.js.
 */
(function () {
    'use strict';

    var TAB = 'store';
    var REASONS = {
        platform: { label: 'Cobra We Ötzi', badge: 'requested' },
        support: { label: 'Necesita soporte', badge: 'open' },
        hold: { label: 'Fondos retenidos', badge: 'in-progress' },
        expired: { label: 'Vencido', badge: 'closed' }
    };
    // Los vencidos no son trabajo pendiente: no suman al contador ni entran en
    // «Todos los motivos»; se ven con el filtro «Vencidos».
    var PASSIVE_REASONS = ['expired'];
    var EXPIRED_DAYS = 7;
    var SUPPORT_REASONS = {
        duplicate_payment: 'Pago duplicado',
        payment_reported_expired: 'Pago informado y vencido'
    };
    var STATUS_BADGES = {
        pending_payment: 'pending',
        paid: 'in-progress',
        fulfilled: 'quote-completed',
        cancelled: 'closed',
        expired: 'closed',
        refunded: 'denied'
    };
    var COLLECTOR_LABELS = { seller: 'El vendedor', platform: 'We Ötzi', provider: 'Proveedor de pagos' };
    var PAYMENT_STATUS = { pending: 'Pendiente', succeeded: 'Confirmado', failed: 'Fallido', refunded: 'Reembolsado', duplicate: 'Duplicado' };
    var BAG_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">'
        + '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';

    var state = {
        enabled: false,
        loaded: false,
        loading: null,
        error: null,
        rows: [],
        reason: 'all',
        sort: 'desc',
        openId: null,
        busy: false
    };

    /* ------------------------------ utilidades ------------------------------ */
    function repo() { return window.WeotziData && window.WeotziData.Store ? window.WeotziData.Store : null; }
    function model() { return window.WeotziStoreModel || null; }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function byId(id) { return document.getElementById(id); }
    function currentTab() {
        try { return typeof activeTab !== 'undefined' ? activeTab : null; } catch (e) { return null; }
    }
    function searchTerm() {
        try { return typeof filterConfig !== 'undefined' && filterConfig && filterConfig.search ? String(filterConfig.search) : ''; }
        catch (e) { return ''; }
    }
    function money(amount, currency) {
        var M = model();
        if (M && typeof M.formatMoney === 'function') return M.formatMoney(amount, currency);
        var n = Number(amount);
        return isFinite(n) ? String(currency || '').toUpperCase() + ' ' + n : '—';
    }
    function dateTime(value) {
        if (!value) return '—';
        var M = model();
        if (M && typeof M.formatDateTime === 'function') return M.formatDateTime(value) || '—';
        var d = new Date(value);
        return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-AR');
    }
    function shortDate(value) {
        var d = new Date(value);
        return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }
    function statusLabel(status) {
        var M = model();
        return (M && typeof M.statusLabel === 'function' && M.statusLabel(status)) || status || '—';
    }
    function errorText(err, fallback) {
        var M = model();
        if (M && typeof M.errorMessage === 'function') return M.errorMessage(err, fallback);
        return fallback;
    }
    function orderNumber(o) {
        var n = String((o && o.order_number) || '').replace(/^#/, '');
        return n || String((o && o.id) || '').slice(0, 8).toUpperCase();
    }
    function firstItem(o) { return (o && o.items && o.items[0]) || null; }
    function meta(o) { return (o && o.metadata_json && typeof o.metadata_json === 'object') ? o.metadata_json : {}; }

    function sellerLabel(o) {
        if (!o) return '—';
        if (o.seller_type === 'artist') {
            var list = null;
            try { list = typeof artists !== 'undefined' ? artists : null; } catch (e) { list = null; }
            var a = Array.isArray(list) ? list.find(function (x) { return x && x.user_id === o.seller_id; }) : null;
            if (a) return (a.name || a.username || 'Artista') + (a.username ? ' · @' + String(a.username).replace(/^@/, '') : '');
            return 'Artista ' + String(o.seller_id || '').slice(0, 8);
        }
        return 'Estudio ' + String(o.seller_id || '').slice(0, 8);
    }

    function itemLabel(o) {
        var item = firstItem(o);
        if (!item) return 'Sin ítems';
        var M = model();
        var parts = [item.title || 'Producto'];
        if (item.kind === 'design' && item.license_tier) {
            var tier = M && Array.isArray(M.LICENSE_TIERS) ? M.LICENSE_TIERS.find(function (t) { return t.id === item.license_tier; }) : null;
            parts.push('Licencia ' + (tier ? tier.label : item.license_tier));
        }
        if (item.variant_label) parts.push(item.variant_label);
        if (item.quantity > 1) parts.push('× ' + item.quantity);
        return parts.join(' · ');
    }

    /* ------------------------------ gate y datos ------------------------------ */
    function gate() {
        var S = repo();
        if (!S || typeof S.featureEnabled !== 'function' || typeof S.isAvailable !== 'function') return Promise.resolve(false);
        var CM = window.ConfigManager;
        var ready = CM && typeof CM.ready === 'function' ? Promise.resolve(CM.ready()).catch(function () {}) : Promise.resolve();
        return ready.then(function () {
            if (!S.featureEnabled()) return false;
            return Promise.resolve(S.isAvailable()).then(function (ok) { return ok === true; });
        }).catch(function () { return false; });
    }

    // Une las listas sin repetir pedidos y anota por qué está cada uno. La marca
    // «pago informado y vencido» deja de contar cuando el pedido salió de
    // pending_payment (soporte lo confirmó o lo canceló). Los vencidos de
    // proveedor no se reabren desde acá (los confirma el webhook).
    function mergeRows(pending, flagged, expired) {
        var map = new Map();
        function add(o, reason) {
            if (!o || !o.id) return;
            var row = map.get(o.id);
            if (!row) { row = { order: o, reasons: [] }; map.set(o.id, row); }
            else row.order = o;
            if (row.reasons.indexOf(reason) === -1) row.reasons.push(reason);
        }
        (pending || []).forEach(function (o) { add(o, 'platform'); });
        (flagged || []).forEach(function (o) {
            var m = meta(o);
            var stale = m.needs_support_reason === 'payment_reported_expired' && o.status !== 'pending_payment';
            if (m.needs_support === true && !stale) add(o, 'support');
            if (o.funds_hold === true) add(o, 'hold');
        });
        (expired || []).forEach(function (o) {
            if (o && o.status === 'expired' && o.expected_collector !== 'provider') add(o, 'expired');
        });
        return Array.from(map.values());
    }

    function isActionable(row) {
        return row.reasons.some(function (r) { return PASSIVE_REASONS.indexOf(r) === -1; });
    }

    function hasExpiredList() {
        var S = repo();
        return !!S && typeof S.listRecentExpiredOrders === 'function';
    }

    // Si la lista de vencidos falla, la pestaña sigue con el resto.
    function loadExpired(S) {
        if (!hasExpiredList()) return Promise.resolve([]);
        return Promise.resolve().then(function () {
            return S.listRecentExpiredOrders({ days: EXPIRED_DAYS });
        }).catch(function (err) {
            console.warn('[support-store] vencidos:', err && err.message);
            return [];
        });
    }

    function load(force) {
        if (state.loading && !force) return state.loading;
        var S = repo();
        state.error = null;
        state.loading = Promise.all([S.listPendingPlatformOrders(), S.listFlaggedOrders(), loadExpired(S)]).then(function (res) {
            state.rows = mergeRows(res[0], res[1], res[2]);
            state.loaded = true;
        }).catch(function (err) {
            console.warn('[support-store] pedidos:', err && err.message);
            state.error = errorText(err, 'No pudimos cargar los pedidos de la Store. Probá de nuevo.');
            state.loaded = true;
        }).then(function () {
            state.loading = null;
            updateBadges();
            if (currentTab() === TAB) renderTable();
        });
        return state.loading;
    }

    /* ------------------------------ navegación ------------------------------ */
    function injectNav() {
        var tabs = document.querySelector('.tab-navigation');
        if (tabs && !tabs.querySelector('[data-tab="' + TAB + '"]')) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tab-btn';
            btn.dataset.tab = TAB;
            btn.innerHTML = BAG_SVG + ' STORE <span class="sds-count" id="tab-store-badge" hidden></span>';
            btn.addEventListener('click', function () { window.switchTab(TAB); });
            tabs.appendChild(btn);
        }
        var aside = document.querySelector('.monolith-wrapper aside');
        if (aside && !aside.querySelector('.nav-menu-item[data-tab="' + TAB + '"]')) {
            var link = document.createElement('a');
            link.href = '#';
            link.className = 'nav-item nav-menu-item';
            link.dataset.tab = TAB;
            link.innerHTML = BAG_SVG + ' STORE <span class="sds-count" id="nav-store-badge" hidden></span>';
            link.addEventListener('click', function (e) { e.preventDefault(); window.switchTab(TAB); });
            aside.insertBefore(link, aside.querySelector('.nav-divider'));
        }
    }

    function updateBadges() {
        var n = state.rows.filter(isActionable).length;
        ['tab-store-badge', 'nav-store-badge'].forEach(function (id) {
            var el = byId(id);
            if (!el) return;
            el.textContent = n > 99 ? '99+' : String(n);
            el.hidden = n <= 0;
            if (n > 0) el.setAttribute('aria-label', n + (n === 1 ? ' pedido para revisar' : ' pedidos para revisar'));
        });
    }

    function installHooks() {
        if (typeof columnConfigs !== 'undefined' && columnConfigs && !columnConfigs[TAB]) {
            columnConfigs[TAB] = [
                { id: 'date', label: 'FECHA', width: '100px' },
                { id: 'order', label: 'PEDIDO', width: '130px' },
                { id: 'buyer', label: 'COMPRADOR', width: '1.5fr' },
                { id: 'seller', label: 'VENDEDOR', width: '1.5fr' },
                { id: 'total', label: 'TOTAL', width: '1fr' },
                { id: 'status', label: 'ESTADO', width: '1.2fr' },
                { id: 'reasons', label: 'MOTIVO', width: '1.5fr' },
                { id: 'action', label: 'ACCIÓN', width: '110px' }
            ];
        }

        var baseSwitch = window.switchTab;
        window.switchTab = function (tabName) {
            var out = baseSwitch.apply(this, arguments);
            if (tabName === TAB) {
                var create = byId('create-new-btn');
                if (create) create.style.display = 'none';
                if (!state.loaded) load();
            }
            return out;
        };

        var baseFilters = window.renderFilters;
        if (typeof baseFilters === 'function') {
            window.renderFilters = function () {
                if (currentTab() !== TAB) return baseFilters.apply(this, arguments);
                renderFilters();
            };
        }

        var baseApply = window.applyFiltersAndSort;
        if (typeof baseApply === 'function') {
            window.applyFiltersAndSort = function () {
                if (currentTab() !== TAB) return baseApply.apply(this, arguments);
                renderTable();
            };
        }

        var body = byId('table-body');
        if (body) body.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('[data-sds-open]');
            if (btn) openDrawer(btn.getAttribute('data-sds-open'));
        });

        var drawer = byId('drawer-content');
        if (drawer) drawer.addEventListener('submit', onDrawerSubmit);
    }

    /* ------------------------------ tabla ------------------------------ */
    function renderFilters() {
        var box = byId('toolbar-filters');
        if (!box) return;
        var opts = [['all', 'TODOS LOS MOTIVOS'], ['platform', 'COBRA WE ÖTZI'], ['support', 'NECESITA SOPORTE'], ['hold', 'FONDOS RETENIDOS']];
        if (hasExpiredList()) opts.push(['expired', 'VENCIDOS (' + EXPIRED_DAYS + ' DÍAS)']);
        box.innerHTML =
            '<label class="sds-sr" for="sds-reason-filter">Motivo</label>'
            + '<select id="sds-reason-filter" class="toolbar-select">'
            + opts.map(function (o) { return '<option value="' + o[0] + '"' + (state.reason === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
            + '</select>'
            + '<label class="sds-sr" for="sds-sort-select">Orden</label>'
            + '<select id="sds-sort-select" class="toolbar-select">'
            + '<option value="desc"' + (state.sort === 'desc' ? ' selected' : '') + '>MÁS RECIENTES</option>'
            + '<option value="asc"' + (state.sort === 'asc' ? ' selected' : '') + '>MÁS ANTIGUOS</option>'
            + '</select>'
            + '<button type="button" class="action-btn small-btn" id="sds-refresh">ACTUALIZAR</button>';
        byId('sds-reason-filter').addEventListener('change', function (e) { state.reason = e.target.value; renderTable(); });
        byId('sds-sort-select').addEventListener('change', function (e) { state.sort = e.target.value; renderTable(); });
        byId('sds-refresh').addEventListener('click', function () { load(true); });
    }

    function visibleRows() {
        var term = searchTerm().toLowerCase();
        return state.rows.filter(function (row) {
            if (state.reason === 'all' ? !isActionable(row) : row.reasons.indexOf(state.reason) === -1) return false;
            if (!term) return true;
            var o = row.order;
            var haystack = [o.order_number, o.buyer_name, o.buyer_email, o.status, sellerLabel(o), itemLabel(o), o.buyer_payment_reference].join(' ').toLowerCase();
            return haystack.indexOf(term) !== -1;
        }).sort(function (a, b) {
            var ta = new Date(a.order.created_at).getTime() || 0;
            var tb = new Date(b.order.created_at).getTime() || 0;
            return state.sort === 'asc' ? ta - tb : tb - ta;
        });
    }

    function reasonBadges(row) {
        var o = row.order;
        return row.reasons.map(function (r) {
            var info = REASONS[r];
            var extra = r === 'support' && SUPPORT_REASONS[meta(o).needs_support_reason] ? ' · ' + SUPPORT_REASONS[meta(o).needs_support_reason] : '';
            return '<span class="status-badge ' + info.badge + '">' + esc(info.label + extra) + '</span>';
        }).join(' ');
    }

    function statusBadge(status) {
        return '<span class="status-badge ' + (STATUS_BADGES[status] || 'none') + '">' + esc(statusLabel(status)) + '</span>';
    }

    function renderTable() {
        var body = byId('table-body');
        if (!body) return;
        if (!state.loaded) {
            body.innerHTML = '<div class="loading-placeholder sds-loading" role="status">Cargando pedidos de la Store…</div>';
            return;
        }
        if (state.error) {
            body.innerHTML = '<div class="empty-state sds-error" role="alert"><p>' + esc(state.error) + '</p>'
                + '<button type="button" class="action-btn" data-sds-retry>Reintentar</button></div>';
            var retry = body.querySelector('[data-sds-retry]');
            if (retry) retry.addEventListener('click', function () { load(true); });
            return;
        }
        var rows = visibleRows();
        if (!rows.length) {
            body.innerHTML = '<div class="empty-state">'
                + (state.reason === 'expired'
                    ? 'No hay pedidos vencidos en los últimos ' + EXPIRED_DAYS + ' días.'
                    : state.rows.some(isActionable) ? 'Ningún pedido coincide con el filtro.' : 'No hay pedidos de la Store para revisar. Cuando uno necesite soporte, aparece acá.')
                + '</div>';
            return;
        }
        body.innerHTML = rows.map(function (row, index) {
            var o = row.order;
            return '<div class="quote-row data-row sds-row" style="transition-delay:' + (index * 0.03) + 's">'
                + '<div class="sds-mono">' + esc(shortDate(o.created_at)) + '</div>'
                + '<div class="sds-mono sds-order">#' + esc(orderNumber(o)) + '</div>'
                + '<div class="client-cell"><span class="client-name">' + esc(o.buyer_name || 'Comprador') + '</span>'
                + (o.buyer_email ? '<span class="sds-sub">' + esc(o.buyer_email) + '</span>' : '') + '</div>'
                + '<div class="sds-cell">' + esc(sellerLabel(o)) + '</div>'
                + '<div class="sds-mono">' + esc(money(o.total_amount, o.currency)) + '</div>'
                + '<div>' + statusBadge(o.status) + '</div>'
                + '<div class="sds-reasons">' + reasonBadges(row) + '</div>'
                + '<div><button type="button" class="action-btn detail-btn" data-sds-open="' + esc(o.id) + '" aria-label="Ver el pedido #' + esc(orderNumber(o)) + '">VER</button></div>'
                + '</div>';
        }).join('');
    }

    /* ------------------------------ drawer ------------------------------ */
    function findRow(id) {
        return state.rows.find(function (r) { return r.order && String(r.order.id) === String(id); }) || null;
    }

    // store_order_uses_wallet(o): vendedor artista y cobro de We Ötzi o de un
    // proveedor (el modelo es la fuente; el fallback repite el predicado).
    function usesWallet(o) {
        var M = model();
        if (M && typeof M.usesWallet === 'function') return M.usesWallet(o);
        if (!o || o.seller_type !== 'artist') return false;
        var c = o.payment_collected_by || o.expected_collector;
        return c === 'platform' || c === 'provider';
    }

    function capabilities(o) {
        var collector = o.expected_collector || 'platform';
        var paid = o.status === 'paid' || o.status === 'fulfilled';
        return {
            collector: collector,
            // Soporte confirma pagos que cobra We Ötzi o el vendedor; los de
            // proveedor los confirma el webhook. Un vencido se puede reabrir
            // (la RPC devuelve cannot_reopen si ya no hay stock o reserva).
            confirm: collector !== 'provider' && (o.status === 'pending_payment' || o.status === 'expired'),
            // Solo soporte cancela con un pago informado (cancel_store_order):
            // es la salida de un pago que nunca llegó, para liberar stock y reserva.
            cancel: o.status === 'pending_payment',
            refund: paid,
            // Retener solo frena algo si el pedido pasa por el wallet y los
            // fondos no se liberaron; una retención puesta siempre se puede levantar.
            hold: o.funds_hold === true || (paid && usesWallet(o) && !o.funds_released_at)
        };
    }

    function kv(label, value) {
        return '<div class="info-block"><label>' + esc(label) + '</label><p>' + esc(value == null || value === '' ? '—' : value) + '</p></div>';
    }

    function renderDrawer(row) {
        var o = row.order;
        var M = model();
        var m = meta(o);
        var can = capabilities(o);
        var item = firstItem(o);
        var method = M && M.METHOD_LABELS ? M.METHOD_LABELS[o.fulfillment_method] : o.fulfillment_method;
        var payments = (o.payments || []).map(function (p) {
            return '<li>' + esc([PAYMENT_STATUS[p.status] || p.status, money(p.amount, p.currency), COLLECTOR_LABELS[p.collected_by] || p.collected_by, p.reference, dateTime(p.created_at)].filter(Boolean).join(' · ')) + '</li>';
        }).join('');

        var flags = '';
        if (m.needs_support === true || o.funds_hold === true || m.maintenance_error) {
            flags = '<div class="drawer-section sds-flags">'
                + '<div class="drawer-section-title">Marcas de soporte</div>'
                + (m.needs_support === true ? kv('Necesita soporte', (SUPPORT_REASONS[m.needs_support_reason] || 'Revisar el pedido') + (m.needs_support_at ? ' · ' + dateTime(m.needs_support_at) : '')) : '')
                + (o.funds_hold === true ? kv('Fondos retenidos', (m.funds_hold_note || 'Sin nota') + (m.funds_hold_at ? ' · ' + dateTime(m.funds_hold_at) : '')) : '')
                + (m.maintenance_error ? kv('Error del mantenimiento', m.maintenance_error) : '')
                + '</div>';
        }

        var actions = '';
        if (can.confirm) {
            var who = can.collector === 'platform' ? 'We Ötzi recibió' : 'el vendedor recibió';
            var reopen = o.status === 'expired';
            actions += '<form class="sds-form" data-sds-form="confirm">'
                + '<p class="sds-form-title">' + (reopen ? 'Reabrir y confirmar pago' : 'Confirmar pago') + '</p>'
                + '<p class="sds-help">Confirmalo solo si ' + esc(who) + ' ' + esc(money(o.total_amount, o.currency)) + '. Se emite la licencia o el pedido pasa a preparación.'
                + (reopen ? ' Si ya no hay stock o el diseño se reservó para otro pedido, no se puede reabrir.' : '') + '</p>'
                + '<div class="form-group"><label for="sds-confirm-ref">Referencia del pago</label>'
                + '<input type="text" id="sds-confirm-ref" name="reference" maxlength="200" value="' + esc(o.buyer_payment_reference || '') + '"></div>'
                + '<div class="form-group"><label for="sds-confirm-note">Nota interna (opcional)</label>'
                + '<textarea id="sds-confirm-note" name="note" rows="2" maxlength="500"></textarea></div>'
                + '<button type="submit" class="action-btn save-btn">Confirmar pago recibido</button>'
                + '</form>';
        }
        if (can.cancel) {
            actions += '<form class="sds-form" data-sds-form="cancel">'
                + '<p class="sds-form-title">Cancelar pedido</p>'
                + '<p class="sds-help">' + (o.buyer_payment_reported_at
                    ? 'El comprador informó un pago. Cancelalo solo si verificaste que no llegó: se devuelve el stock y se libera la reserva del diseño.'
                    : 'Se devuelve el stock y se libera la reserva del diseño.') + '</p>'
                + '<div class="form-group"><label for="sds-cancel-reason">Motivo de la cancelación</label>'
                + '<textarea id="sds-cancel-reason" name="reason" rows="2" maxlength="300" required></textarea></div>'
                + '<button type="submit" class="action-btn danger-btn">Cancelar pedido</button>'
                + '</form>';
        }
        if (can.refund) {
            actions += '<form class="sds-form" data-sds-form="refund">'
                + '<p class="sds-form-title">Reembolsar</p>'
                + '<p class="sds-help">Revoca las licencias y devuelve el stock si no se despachó. Confirmá que el dinero ya se devolvió.</p>'
                + '<div class="form-group"><label for="sds-refund-reason">Motivo del reembolso</label>'
                + '<textarea id="sds-refund-reason" name="reason" rows="2" maxlength="300" required></textarea></div>'
                + '<button type="submit" class="action-btn danger-btn">Reembolsar pedido</button>'
                + '</form>';
        }
        if (can.hold) {
            actions += '<form class="sds-form" data-sds-form="hold">'
                + '<p class="sds-form-title">' + (o.funds_hold ? 'Liberar fondos' : 'Retener fondos') + '</p>'
                + '<p class="sds-help">' + (o.funds_hold
                    ? 'Los fondos vuelven a liberarse en la fecha prevista.'
                    : 'Frena la liberación de los fondos al artista mientras revisás el caso.') + '</p>'
                + '<div class="form-group"><label for="sds-hold-note">Nota (opcional)</label>'
                + '<input type="text" id="sds-hold-note" name="note" maxlength="500"></div>'
                + '<button type="submit" class="action-btn">' + (o.funds_hold ? 'Liberar fondos' : 'Retener fondos') + '</button>'
                + '</form>';
        }
        if (!actions) actions = '<p class="sds-help">Este pedido no tiene acciones disponibles para soporte.</p>';

        return '<div class="shape-decor"></div>'
            + '<p class="sds-eyebrow">PEDIDO_ID: ' + esc(String(o.id).slice(0, 12)) + '…</p>'
            + '<h2 class="sds-title" id="sds-drawer-title" tabindex="-1">Pedido #' + esc(orderNumber(o)) + '</h2>'
            + '<div class="sds-reasons">' + statusBadge(o.status) + ' ' + reasonBadges(row) + '</div>'
            + '<div class="drawer-section">'
            + '<div class="drawer-section-title">Pedido</div>'
            + '<div class="info-grid">'
            + kv('Producto', itemLabel(o))
            + kv('Entrega', [method, o.fulfillment_status && o.fulfillment_method !== 'digital' ? statusLabel(o.fulfillment_status) : ''].filter(Boolean).join(' · '))
            + kv('Comprador', [o.buyer_name, o.buyer_email].filter(Boolean).join(' · '))
            + kv('Vendedor', sellerLabel(o))
            + kv('Creado', dateTime(o.created_at))
            + kv(o.status === 'expired' ? 'Venció' : 'Vence', o.status === 'pending_payment' || o.status === 'expired' ? dateTime(o.expires_at) : '—')
            + '</div>'
            + (item && item.license_holder_name ? kv('Titular de la licencia', item.license_holder_name) : '')
            + '</div>'
            + '<div class="drawer-section">'
            + '<div class="drawer-section-title">Montos</div>'
            + '<dl class="sds-totals">'
            + '<div><dt>Subtotal</dt><dd>' + esc(money(o.subtotal_amount, o.currency)) + '</dd></div>'
            + '<div><dt>Envío</dt><dd>' + esc(money(o.shipping_amount || 0, o.currency)) + '</dd></div>'
            + '<div><dt>Comisión We Ötzi</dt><dd>' + esc(money(o.platform_fee_amount || 0, o.currency)) + '</dd></div>'
            + '<div class="sds-total"><dt>Total</dt><dd>' + esc(money(o.total_amount, o.currency)) + '</dd></div>'
            + '</dl></div>'
            + '<div class="drawer-section">'
            + '<div class="drawer-section-title">Pago</div>'
            + '<div class="info-grid">'
            + kv('Cobra', COLLECTOR_LABELS[o.expected_collector] || o.expected_collector)
            + kv('Referencia informada', o.buyer_payment_reference)
            + kv('Informado el', o.buyer_payment_reported_at ? dateTime(o.buyer_payment_reported_at) : '—')
            + kv('Confirmado el', o.paid_at ? dateTime(o.paid_at) : '—')
            + kv('Liberación de fondos', o.funds_released_at ? 'Liberados el ' + dateTime(o.funds_released_at) : (o.funds_release_at ? 'Prevista para el ' + dateTime(o.funds_release_at) : '—'))
            + '</div>'
            + (payments ? '<p class="sds-sub">Registros de pago</p><ul class="sds-payments">' + payments + '</ul>' : '')
            + '</div>'
            + flags
            + '<div class="drawer-section sds-actions">'
            + '<div class="drawer-section-title">Acciones</div>'
            + actions
            + '<p class="sds-feedback" id="sds-feedback" role="status" aria-live="polite"></p>'
            + '</div>';
    }

    function openDrawer(id) {
        var row = findRow(id);
        var content = byId('drawer-content');
        if (!content) return;
        state.openId = id;
        if (!row) {
            content.innerHTML = '<div class="shape-decor"></div>'
                + '<h2 class="sds-title" id="sds-drawer-title" tabindex="-1">Listo</h2>'
                + '<p class="sds-help">El pedido ya no necesita acciones de soporte.</p>'
                + '<p class="sds-feedback" id="sds-feedback" role="status" aria-live="polite"></p>';
        } else {
            content.innerHTML = renderDrawer(row);
        }
        var toggle = byId('drawer-toggle');
        if (toggle) toggle.checked = true;
        var title = byId('sds-drawer-title');
        if (title) setTimeout(function () { try { title.focus(); } catch (e) { /* sin foco */ } }, 50);
    }

    function feedback(text, tone) {
        var el = byId('sds-feedback');
        if (!el) return;
        el.textContent = text || '';
        el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        el.dataset.tone = tone || '';
    }

    function setBusy(form, busy) {
        state.busy = busy;
        Array.prototype.forEach.call(document.querySelectorAll('#drawer-content .sds-form button, #drawer-content .sds-form input, #drawer-content .sds-form textarea'), function (el) {
            el.disabled = busy;
        });
        if (form) form.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function onDrawerSubmit(e) {
        var form = e.target && e.target.closest && e.target.closest('[data-sds-form]');
        if (!form) return;
        e.preventDefault();
        if (state.busy) return;
        var row = findRow(state.openId);
        var S = repo();
        if (!row || !S) return;
        var o = row.order;
        var can = capabilities(o);
        var kind = form.getAttribute('data-sds-form');
        var data = new FormData(form);
        var value = function (k) { return String(data.get(k) || '').trim(); };
        var number = '#' + orderNumber(o);
        var task = null;
        var done = '';

        if (kind === 'confirm' && can.confirm) {
            if (!window.confirm('¿Confirmás el pago de ' + money(o.total_amount, o.currency) + ' del pedido ' + number + '?')) return;
            task = function () { return S.confirmPayment(o.id, { collectedBy: can.collector, reference: value('reference'), note: value('note') }); };
            done = 'Pago confirmado.';
        } else if (kind === 'cancel' && can.cancel) {
            var cancelReason = value('reason');
            if (!cancelReason) { feedback('Contá el motivo de la cancelación.', 'error'); return; }
            if (!window.confirm('¿Cancelar el pedido ' + number + '? Se devuelve el stock y se libera la reserva.')) return;
            task = function () { return S.cancelOrder(o.id, cancelReason); };
            done = 'Pedido cancelado.';
        } else if (kind === 'refund' && can.refund) {
            var reason = value('reason');
            if (!reason) { feedback('Contá el motivo del reembolso.', 'error'); return; }
            if (!window.confirm('¿Reembolsar el pedido ' + number + '? Las licencias quedan revocadas.')) return;
            task = function () { return S.refundOrder(o.id, reason); };
            done = 'Pedido reembolsado.';
        } else if (kind === 'hold' && can.hold) {
            var hold = !o.funds_hold;
            if (!window.confirm(hold ? '¿Retener los fondos del pedido ' + number + '?' : '¿Liberar los fondos del pedido ' + number + '?')) return;
            task = function () { return S.setFundsHold(o.id, hold, value('note')); };
            done = hold ? 'Fondos retenidos.' : 'Fondos liberados.';
        }
        if (!task) return;

        setBusy(form, true);
        feedback('Guardando…');
        task().then(function () {
            return load(true).then(function () {
                state.busy = false;
                openDrawer(o.id);
                feedback(done, 'success');
            });
        }).catch(function (err) {
            console.warn('[support-store] acción:', err && err.message);
            setBusy(form, false);
            feedback(errorText(err, 'No pudimos completar la acción. Probá de nuevo.'), 'error');
        });
    }

    /* ------------------------------ init ------------------------------ */
    function init() {
        if (typeof window.switchTab !== 'function' || !repo()) return;
        gate().then(function (on) {
            if (!on || state.enabled) return;
            state.enabled = true;
            installHooks();
            injectNav();
            load();
        });
    }

    window.WeotziSupportStore = {
        mergeRows: mergeRows,
        capabilities: capabilities,
        isActionable: isActionable,
        refresh: function () { return state.enabled ? load(true) : Promise.resolve(); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
