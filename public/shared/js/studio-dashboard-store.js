// ============================================
// We Ötzi — Panel de estudio · Tienda
// Pestaña 'tienda'.
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Módulos › Tienda"
// y docs/plans/2026-10-30-store-artista.md (modelo store_* compartido).
//   - Sin window.WeotziData.Store o sin la migración store_core: empty state
//     con el camino de hoy (registrar la merch en Finanzas → Ingreso → Merch
//     (manual)) y un botón a Finanzas.
//   - Con Store: ajustes de la tienda (contacto, cobro y dirección de retiro),
//     productos físicos del estudio (merch, aftercare, joyería) con variantes y
//     stock, publicación, pedidos online y venta en mostrador
//     (create_store_pos_order vía StudioOps.createStorePosOrder).
// WeotziData.Store lanza errores (estilo run); los métodos de StudioOps
// devuelven {data, error}.
// ============================================

(function () {
    'use strict';

    const TAB = 'tienda';
    const FINANCE_TAB = 'finanzas';
    const CATEGORIES = { merch: 'Merch', aftercare: 'Aftercare y cuidado', jewelry: 'Joyería y piercing', other: 'Otros' };
    const PRODUCT_STATUS = { draft: 'Borrador', active: 'Publicado', paused: 'Pausado', retired: 'Retirado' };
    const PRODUCT_TONE = { draft: 'neutral', active: 'success', paused: 'warning', retired: 'neutral' };
    const ORDER_STATUS = { pending_payment: 'Pago pendiente', paid: 'Pagado', fulfilled: 'Entregado', cancelled: 'Cancelado', refunded: 'Reembolsado', expired: 'Vencido' };
    const ORDER_TONE = { pending_payment: 'warning', paid: 'info', fulfilled: 'success', cancelled: 'neutral', refunded: 'neutral', expired: 'neutral' };
    const PAY_METHODS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };

    const COPY = {
        pending: {
            title: 'La Tienda llega en la próxima fase',
            body: 'Mientras tanto, registrá ventas de merch en Finanzas → Ingreso → Merch (manual).'
        },
        action: 'Ir a Finanzas'
    };

    const S = { products: [], orders: [], settings: null, ready: false };

    function K(ctx) { return (ctx && ctx.kit) || window.WeOtziStudioKit; }
    function Store(ctx) { const d = (ctx && ctx.data) || window.WeotziData; return d && d.Store; }
    function Ops(ctx) { const d = (ctx && ctx.data) || window.WeotziData; return d && d.StudioOps; }

    async function storeAvailable(ctx) {
        const store = Store(ctx);
        if (!store) return false;
        if (typeof store.isAvailable !== 'function') return true;
        try { return (await store.isAvailable()) !== false; } catch (_) { return false; }
    }

    function placeholderHtml(kit) {
        const actionHtml = '<button type="button" class="studio-btn studio-btn-primary" data-nav="' + FINANCE_TAB + '">'
            + kit.escapeHtml(COPY.action) + '</button>';
        return '<div data-store-state="pending">'
            + kit.emptyState({ icon: 'fa-solid fa-store', title: COPY.pending.title, body: COPY.pending.body, actionHtml })
            + '</div>';
    }

    function money(kit, amount, currency) { return kit.fmtMoney(Number(amount) || 0, currency || 'ARS'); }
    function stockOf(product) {
        const vs = (product.variants || []).filter(v => v.active !== false);
        if (!vs.length) return '—';
        if (vs.some(v => v.stock == null)) return 'Sin límite';
        return String(vs.reduce((acc, v) => acc + (Number(v.stock) || 0), 0));
    }
    function errorText(kit, err) {
        const M = window.WeotziStoreModel;
        if (M && typeof M.errorMessage === 'function') return M.errorMessage(err, kit.friendlyError(err));
        return kit.friendlyError(err);
    }

    function layoutHtml(kit, ctx) {
        const studio = ctx.studio || {};
        const vitrina = studio.slug ? '/studio/profile/?studio=' + encodeURIComponent(studio.slug) + '#studio-store' : null;
        return '<p class="studio-help">Vendé online desde el perfil del estudio y registrá las ventas de mostrador. '
            + 'Cada venta suma a Reportes.' + (vitrina ? ' <a href="' + kit.escapeAttr(vitrina) + '" target="_blank" rel="noopener">Ver la vitrina pública →</a>' : '') + '</p>'
            + '<div data-store-kpis></div>'
            + '<div class="sk-toolbar"><button type="button" class="studio-btn studio-btn-primary" data-act="new-product">+ Nuevo producto</button>'
            + '<button type="button" class="studio-btn" data-act="pos">Venta en mostrador</button>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-act="settings">Ajustes de la tienda</button></div>'
            + '<div data-store-alert></div>'
            + '<h2 class="sk-section-title">Productos</h2><div data-store-products></div>'
            + '<h2 class="sk-section-title">Pedidos</h2><div data-store-orders></div>';
    }

    function renderAll(root, ctx) {
        const kit = K(ctx);
        const active = S.products.filter(p => p.status === 'active').length;
        const openOrders = S.orders.filter(o => o.channel !== 'pos' && (o.status === 'pending_payment' || (o.status === 'paid' && o.fulfillment_status !== 'delivered'))).length;
        const month = new Date().toISOString().slice(0, 7);
        const monthSales = kit.sumByCurrency(S.orders.filter(o => (o.status === 'paid' || o.status === 'fulfilled') && String(o.paid_at || o.created_at).slice(0, 7) === month), 'total_amount', 'currency');
        root.querySelector('[data-store-kpis]').innerHTML = kit.kpis([
            { label: 'Productos publicados', value: active },
            { label: 'Pedidos por atender', value: openOrders, tone: openOrders ? 'warning' : null },
            { label: 'Ventas del mes', valueHtml: kit.fmtTotalsHtml(monthSales) }
        ]);
        const s = S.settings || {};
        const missing = [];
        if (!(s.contact_channel || '').trim()) missing.push('un canal de contacto');
        if (!(s.payment_instructions || '').trim()) missing.push('cómo te pagan');
        if (!(s.pickup_address || '').trim()) missing.push('la dirección de retiro');
        root.querySelector('[data-store-alert]').innerHTML = missing.length
            ? '<p class="studio-help" role="status">' + kit.badge('Falta completar', 'warning') + ' Para publicar productos y ofrecer retiro en el estudio completá '
                + kit.escapeHtml(missing.join(', ')) + ' en <button type="button" class="studio-btn studio-btn-ghost" data-act="settings">Ajustes de la tienda</button></p>'
            : '';
        root.querySelector('[data-store-products]').innerHTML = kit.renderTable({
            emptyText: 'Todavía no cargaste productos. Sumá remeras, cremas de cuidado o joyería.',
            rows: S.products.filter(p => p.status !== 'retired'),
            columns: [
                { label: 'Producto', render: p => '<strong>' + kit.escapeHtml(p.title) + '</strong><br><small>' + kit.escapeHtml(CATEGORIES[p.category] || p.category || 'Merch') + '</small>' },
                { label: 'Precio', align: 'right', render: p => p.price_amount != null ? kit.escapeHtml(money(kit, p.price_amount, p.currency)) : '—' },
                { label: 'Stock', align: 'right', render: p => kit.escapeHtml(stockOf(p)) },
                { label: 'Vendidos', align: 'right', render: p => kit.escapeHtml(String(p.sales_count || 0)) },
                { label: 'Estado', render: p => kit.badge(PRODUCT_STATUS[p.status] || p.status, PRODUCT_TONE[p.status] || 'neutral') },
                { label: '', render: p => '<button type="button" class="studio-btn studio-btn-ghost" data-act="edit" data-id="' + kit.escapeAttr(p.id) + '">Editar</button>'
                    + (p.status === 'active'
                        ? '<button type="button" class="studio-btn studio-btn-ghost" data-act="pause" data-id="' + kit.escapeAttr(p.id) + '">Pausar</button>'
                        : '<button type="button" class="studio-btn studio-btn-ghost" data-act="publish" data-id="' + kit.escapeAttr(p.id) + '">Publicar</button>')
                    + ((p.status === 'active' || p.status === 'paused') ? '<button type="button" class="studio-btn studio-btn-ghost" data-act="pos" data-id="' + kit.escapeAttr(p.id) + '">Vender</button>' : '') }
            ]
        });
        root.querySelector('[data-store-orders]').innerHTML = kit.renderTable({
            emptyText: 'Sin pedidos todavía.',
            rows: S.orders.slice(0, 100),
            columns: [
                { label: 'Pedido', render: o => '<strong>' + kit.escapeHtml(o.order_number) + '</strong><br><small>' + kit.escapeHtml(kit.fmtDateTime(o.created_at)) + '</small>' },
                { label: 'Canal', render: o => kit.escapeHtml(o.channel === 'pos' ? 'Mostrador' : 'Online') },
                { label: 'Cliente', render: o => kit.escapeHtml(o.buyer_name || '—') },
                { label: 'Producto', render: o => { const it = (o.items || [])[0] || {}; return kit.escapeHtml((it.title || '—') + (it.variant_label ? ' · ' + it.variant_label : '') + (it.quantity > 1 ? ' ×' + it.quantity : '')); } },
                { label: 'Total', align: 'right', render: o => kit.escapeHtml(money(kit, o.total_amount, o.currency)) },
                { label: 'Estado', render: o => kit.badge(ORDER_STATUS[o.status] || o.status, ORDER_TONE[o.status] || 'neutral') },
                { label: '', render: o => orderActionsHtml(kit, o) }
            ]
        });
    }

    function orderActionsHtml(kit, o) {
        if (o.channel === 'pos') return '';
        const id = kit.escapeAttr(o.id);
        if (o.status === 'pending_payment') {
            return '<button type="button" class="studio-btn studio-btn-ghost" data-act="order-paid" data-id="' + id + '">Confirmar pago</button>'
                + '<button type="button" class="studio-btn studio-btn-ghost" data-act="order-cancel" data-id="' + id + '">Cancelar</button>';
        }
        if (o.status === 'paid' && o.fulfillment_method === 'pickup' && o.fulfillment_status !== 'ready_for_pickup') {
            return '<button type="button" class="studio-btn studio-btn-ghost" data-act="order-ready" data-id="' + id + '">Listo para retirar</button>';
        }
        if (o.status === 'paid') {
            return '<button type="button" class="studio-btn studio-btn-ghost" data-act="order-delivered" data-id="' + id + '">Marcar entregado</button>';
        }
        return '';
    }

    async function load(root, ctx) {
        const store = Store(ctx);
        const studioId = ctx.studioId;
        const [products, orders, settings] = await Promise.all([
            store.listMyProducts('studio', studioId).catch(() => []),
            store.listSellerOrders('studio', studioId).catch(() => []),
            store.getSellerSettings('studio', studioId).catch(() => null)
        ]);
        S.products = (products || []).filter(p => p.kind === 'merch');
        S.orders = orders || [];
        S.settings = settings;
        renderAll(root, ctx);
    }

    function field(kit, name, labelText, inputHtml, hint) {
        return '<label class="sk-field"><span>' + kit.escapeHtml(labelText) + '</span>' + inputHtml
            + (hint ? '<small>' + kit.escapeHtml(hint) + '</small>' : '') + '</label>';
    }

    function openSettings(root, ctx) {
        const kit = K(ctx), s = S.settings || {};
        const area = (name, value, max) => '<textarea name="' + name + '" rows="3" maxlength="' + max + '">' + kit.escapeHtml(value || '') + '</textarea>';
        const body = '<form class="sk-grid-2">'
            + field(kit, 'store_tagline', 'Frase de la tienda', '<input name="store_tagline" maxlength="160" value="' + kit.escapeAttr(s.store_tagline || '') + '">')
            + field(kit, 'contact_channel', 'Canal de contacto', '<input name="contact_channel" maxlength="200" placeholder="WhatsApp +54 9 11… o @estudio" value="' + kit.escapeAttr(s.contact_channel || '') + '">')
            + field(kit, 'payment_instructions', 'Cómo te pagan', area('payment_instructions', s.payment_instructions, 2000), 'Alias, CBU o link de pago. Se lo mostramos al cliente al hacer el pedido.')
            + field(kit, 'pickup_address', 'Dirección de retiro', area('pickup_address', s.pickup_address, 300), 'Privada: el cliente la recibe cuando confirmás el pago.')
            + field(kit, 'shipping_policy', 'Envíos', area('shipping_policy', s.shipping_policy, 2000))
            + field(kit, 'return_policy', 'Cambios y devoluciones', area('return_policy', s.return_policy, 2000))
            + '</form>';
        kit.openModal({
            title: 'Ajustes de la tienda', size: 'l', body,
            actions: [{ label: 'Guardar', variant: 'primary', onClick: async m => {
                const values = kit.readForm(m.body.querySelector('form'));
                S.settings = await Store(ctx).saveSellerSettings('studio', ctx.studioId, values);
                kit.toast('Ajustes guardados.', 'success');
                renderAll(root, ctx);
            } }]
        });
    }

    function variantRowHtml(kit, v) {
        return '<div class="sk-grid-2" data-variant data-id="' + kit.escapeAttr(v.id || '') + '">'
            + '<input aria-label="Variante" name="label" maxlength="60" placeholder="Talle M, 50 ml, acero…" value="' + kit.escapeAttr(v.label || '') + '">'
            + '<input aria-label="Stock inicial" name="stock" type="number" min="0" placeholder="Stock (vacío = sin límite)" value="' + kit.escapeAttr(v.stock == null ? '' : v.stock) + '"' + (v.id ? ' disabled title="El stock de una variante existente se ajusta desde la venta o el pedido"' : '') + '>'
            + '</div>';
    }

    function openEditor(root, ctx, product) {
        const kit = K(ctx), p = product || {};
        const variants = (p.variants && p.variants.length ? p.variants.filter(v => v.active !== false) : [{ label: 'Única' }]);
        const body = '<form>'
            + '<div class="sk-grid-2">'
            + field(kit, 'title', 'Nombre', '<input name="title" required minlength="2" maxlength="120" value="' + kit.escapeAttr(p.title || '') + '">')
            + field(kit, 'category', 'Categoría', '<select name="category">' + kit.optionsHtml(CATEGORIES, p.category || 'merch') + '</select>')
            + field(kit, 'price_amount', 'Precio', '<input name="price_amount" type="number" min="0.01" step="0.01" required value="' + kit.escapeAttr(p.price_amount == null ? '' : p.price_amount) + '">')
            + field(kit, 'currency', 'Moneda', '<select name="currency">' + kit.currencyOptionsHtml(p.currency || 'ARS') + '</select>')
            + '</div>'
            + field(kit, 'description', 'Descripción', '<textarea name="description" rows="3" maxlength="4000">' + kit.escapeHtml(p.description || '') + '</textarea>')
            + '<label class="sk-field sk-field--inline"><input type="checkbox" name="pickup_available"' + (p.pickup_available !== false ? ' checked' : '') + '> Retiro en el estudio</label>'
            + field(kit, 'image', p.images && p.images.length ? 'Agregar foto (ya tiene ' + p.images.length + ')' : 'Foto (obligatoria para publicar)', '<input name="image" type="file" accept="image/jpeg,image/png,image/webp">')
            + '<fieldset class="sk-section"><legend>Variantes</legend><div data-variants>' + variants.map(v => variantRowHtml(kit, v)).join('') + '</div>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-add-variant>+ Variante</button></fieldset>'
            + '</form>';
        const modal = kit.openModal({
            title: product ? 'Editar producto' : 'Nuevo producto', size: 'l', body,
            actions: [{ label: product ? 'Guardar cambios' : 'Crear producto', variant: 'primary', onClick: async m => {
                const form = m.body.querySelector('form');
                const values = kit.readForm(form);
                const price = Number(values.price_amount);
                if (!values.title || String(values.title).trim().length < 2) { m.setError('Poné un nombre de al menos 2 caracteres.'); return false; }
                if (!(price > 0)) { m.setError('Poné un precio mayor a 0.'); return false; }
                const rows = Array.from(form.querySelectorAll('[data-variant]')).map(el => ({
                    id: el.getAttribute('data-id') || undefined,
                    label: el.querySelector('[name=label]').value.trim(),
                    stock: el.querySelector('[name=stock]').value === '' ? null : Number(el.querySelector('[name=stock]').value)
                })).filter(v => v.label);
                if (!rows.length) { m.setError('Sumá al menos una variante (por ejemplo «Única»).'); return false; }
                const store = Store(ctx);
                const fields = {
                    title: String(values.title).trim(), category: values.category || 'merch', description: values.description || null,
                    price_amount: price, currency: values.currency || 'ARS', pickup_available: !!form.querySelector('[name=pickup_available]').checked
                };
                let saved = product
                    ? await store.updateProduct(product.id, fields)
                    : await store.createProduct(Object.assign({ seller_type: 'studio', seller_id: ctx.studioId, kind: 'merch' }, fields));
                await store.saveVariants(saved.id, rows);
                const file = form.querySelector('[name=image]').files[0];
                if (file) {
                    const images = (saved.images || p.images || []).slice();
                    const up = await store.uploadPreviewImage(ctx.studioId, saved.id, file, images.length, file.type);
                    images.push({ path: up.path, alt: fields.title });
                    saved = await store.updateProduct(saved.id, { images });
                }
                kit.toast(product ? 'Producto actualizado.' : 'Producto creado como borrador. Publicalo cuando esté listo.', 'success');
                await load(root, ctx);
            } }]
        });
        const el = modal && modal.el;
        if (el) el.addEventListener('click', e => {
            if (!e.target.closest('[data-add-variant]')) return;
            el.querySelector('[data-variants]').insertAdjacentHTML('beforeend', variantRowHtml(kit, {}));
        });
    }

    function openPos(root, ctx, productId) {
        const kit = K(ctx);
        const sellable = S.products.filter(p => p.status === 'active' || p.status === 'paused');
        if (!sellable.length) { kit.toast('Publicá o pausá un producto para venderlo en mostrador.', 'warning'); return; }
        const first = sellable.find(p => p.id === productId) || sellable[0];
        const variantOptions = p => (p.variants || []).filter(v => v.active !== false).map(v =>
            '<option value="' + kit.escapeAttr(v.id) + '">' + kit.escapeHtml(v.label + (v.stock != null ? ' · stock ' + v.stock : '')) + '</option>').join('');
        const body = '<form><div class="sk-grid-2">'
            + field(kit, 'product', 'Producto', '<select name="product">' + sellable.map(p => '<option value="' + kit.escapeAttr(p.id) + '"' + (p.id === first.id ? ' selected' : '') + '>' + kit.escapeHtml(p.title) + '</option>').join('') + '</select>')
            + field(kit, 'variant', 'Variante', '<select name="variant">' + variantOptions(first) + '</select>')
            + field(kit, 'quantity', 'Cantidad', '<input name="quantity" type="number" min="1" max="20" value="1">')
            + field(kit, 'method', 'Cobro', '<select name="method">' + kit.optionsHtml(PAY_METHODS, 'cash') + '</select>')
            + field(kit, 'buyer_name', 'Cliente (opcional)', '<input name="buyer_name" maxlength="120">')
            + field(kit, 'buyer_email', 'Email (opcional)', '<input name="buyer_email" type="email" maxlength="254">')
            + '</div><p class="sk-hint" data-pos-total></p></form>';
        const key = 'pos-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10);
        const modal = kit.openModal({
            title: 'Venta en mostrador', body,
            actions: [{ label: 'Registrar venta', variant: 'primary', onClick: async m => {
                const values = kit.readForm(m.body.querySelector('form'));
                const res = await Ops(ctx).createStorePosOrder({
                    studioId: ctx.studioId, productId: values.product, variantId: values.variant || null,
                    quantity: Number(values.quantity) || 1, paymentMethod: values.method,
                    buyerName: values.buyer_name, buyerEmail: values.buyer_email, idempotencyKey: key
                });
                if (res && res.error) { m.setError(errorText(kit, res.error)); return false; }
                const out = (Array.isArray(res.data) ? res.data[0] : res.data) || {};
                kit.toast('Venta registrada: ' + (out.order_number || '') + ' · ' + money(kit, out.total, out.currency), 'success');
                await load(root, ctx);
            } }]
        });
        const el = modal && modal.el;
        if (!el) return;
        const total = () => {
            const p = sellable.find(x => x.id === el.querySelector('[name=product]').value) || first;
            const v = (p.variants || []).find(x => x.id === el.querySelector('[name=variant]').value);
            const unit = Number((v && v.price_amount) || p.price_amount) || 0;
            el.querySelector('[data-pos-total]').textContent = 'Total: ' + money(kit, unit * (Number(el.querySelector('[name=quantity]').value) || 1), p.currency);
        };
        el.addEventListener('change', e => {
            if (e.target.name === 'product') {
                const p = sellable.find(x => x.id === e.target.value);
                el.querySelector('[name=variant]').innerHTML = p ? variantOptions(p) : '';
            }
            total();
        });
        total();
    }

    async function orderAction(root, ctx, act, id) {
        const kit = K(ctx), store = Store(ctx);
        if (act === 'order-paid') await store.confirmPayment(id, { collectedBy: 'seller' });
        else if (act === 'order-ready') await store.updateFulfillment(id, { status: 'ready_for_pickup' });
        else if (act === 'order-delivered') await store.updateFulfillment(id, { status: 'delivered' });
        else if (act === 'order-cancel') {
            if (!(await kit.confirmDialog({ title: 'Cancelar pedido', body: 'El cliente recibe el aviso y el stock vuelve a quedar disponible.', confirmLabel: 'Cancelar pedido' }))) return;
            await store.cancelOrder(id, 'Cancelado por el estudio');
        }
        kit.toast('Pedido actualizado.', 'success');
        await load(root, ctx);
    }

    function onClick(event, root, ctx) {
        const btn = event.target && event.target.closest && event.target.closest('[data-act],[data-nav]');
        if (!btn || !root.contains(btn)) return;
        const kit = K(ctx);
        if (btn.hasAttribute('data-nav')) { event.preventDefault(); if (ctx && ctx.navigate) ctx.navigate(FINANCE_TAB); return; }
        const act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
        const product = S.products.find(p => p.id === id);
        const run = fn => kit.guarded(btn, async () => { try { await fn(); } catch (err) { kit.toast(errorText(kit, err), 'danger'); } });
        if (act === 'settings') return openSettings(root, ctx);
        if (act === 'new-product') return openEditor(root, ctx, null);
        if (act === 'edit') return openEditor(root, ctx, product);
        if (act === 'pos') return openPos(root, ctx, id);
        if (act === 'publish') return run(async () => { await Store(ctx).setProductStatus(id, 'active'); kit.toast('Producto publicado.', 'success'); await load(root, ctx); });
        if (act === 'pause') return run(async () => { await Store(ctx).setProductStatus(id, 'paused'); kit.toast('Producto pausado.', 'success'); await load(root, ctx); });
        if (act.indexOf('order-') === 0) return run(() => orderAction(root, ctx, act, id));
    }

    async function render(root, ctx) {
        const kit = K(ctx);
        if (!kit) throw new Error('No pudimos cargar las herramientas del panel. Recargá la página.');
        if (!(await storeAvailable(ctx))) {
            S.ready = false;
            root.innerHTML = placeholderHtml(kit);
            return;
        }
        if (!S.ready) { root.innerHTML = layoutHtml(kit, ctx); S.ready = true; }
        await load(root, ctx);
    }

    function mount(root, ctx) {
        root.addEventListener('click', event => onClick(event, root, ctx));
        return render(root, ctx);
    }

    function show(root, ctx) {
        return render(root, ctx);
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = { CATEGORIES, stockOf, orderActionsHtml, placeholderHtml };
    }
    const admin = typeof window !== 'undefined' && window.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') admin.register(TAB, { mount, show });
    else if (typeof window !== 'undefined') console.warn('[studio-store] falta window.WeOtziStudioAdmin (studio-dashboard.js debe cargarse antes).');
})();
