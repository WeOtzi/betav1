// ============================================
// We Ötzi — Panel de estudio · Tienda (W-HOME, placeholder)
// Pestaña 'tienda'.
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Módulos › Tienda"
// (fase final). La tienda real (merch, aftercare y joyería sobre el modelo
// store_* compartido con Store de artistas) llega con M6, cuando Store
// commitee su store_core.
//   - Sin window.WeotziData.Store: empty state con el camino de hoy (registrar
//     las ventas de merch en Finanzas → Ingreso → Merch (manual)) y un botón a
//     Finanzas.
//   - Con WeotziData.Store cargado: todavía no monta nada; avisa
//     "Tienda en preparación". El módulo real reemplaza este archivo.
// No lee ni escribe datos.
// ============================================

(function () {
    'use strict';

    const TAB = 'tienda';
    const FINANCE_TAB = 'finanzas';

    const COPY = {
        pending: {
            title: 'La Tienda llega en la próxima fase',
            body: 'Mientras tanto, registrá ventas de merch en Finanzas → Ingreso → Merch (manual).'
        },
        preparing: {
            title: 'Tienda en preparación',
            body: 'Estamos conectando la tienda del estudio para merch, aftercare y joyería. '
                + 'Mientras tanto, registrá ventas de merch en Finanzas → Ingreso → Merch (manual).'
        },
        action: 'Ir a Finanzas'
    };

    // 'pending' mientras no exista WeotziData.Store; 'preparing' cuando ya está.
    function storeState(data) {
        return data && data.Store ? 'preparing' : 'pending';
    }

    function storeHtml(state, kit) {
        const copy = state === 'preparing' ? COPY.preparing : COPY.pending;
        const actionHtml = '<button type="button" class="studio-btn studio-btn-primary" data-nav="' + FINANCE_TAB + '">'
            + kit.escapeHtml(COPY.action) + '</button>';
        return '<div data-store-state="' + kit.escapeAttr(state) + '">'
            + kit.emptyState({ icon: 'fa-solid fa-store', title: copy.title, body: copy.body, actionHtml })
            + '</div>';
    }

    let rendered = null;

    function render(root, ctx) {
        const kit = (ctx && ctx.kit) || window.WeOtziStudioKit;
        if (!kit) throw new Error('No pudimos cargar las herramientas del panel. Recargá la página.');
        const state = storeState((ctx && ctx.data) || window.WeotziData);
        if (state === rendered) return;
        rendered = state;
        root.innerHTML = storeHtml(state, kit);
    }

    function onClick(event, root, ctx) {
        const target = event && event.target && typeof event.target.closest === 'function' ? event.target : null;
        const btn = target && target.closest('[data-nav]');
        if (!btn || (typeof root.contains === 'function' && !root.contains(btn))) return;
        if (!ctx || typeof ctx.navigate !== 'function') return;
        event.preventDefault();
        ctx.navigate(FINANCE_TAB);
    }

    function mount(root, ctx) {
        render(root, ctx);
        root.addEventListener('click', event => onClick(event, root, ctx));
    }

    // En cada visita: si Store apareció después, pasa a "en preparación".
    function show(root, ctx) {
        render(root, ctx);
    }

    const admin = window.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') admin.register(TAB, { mount, show });
    else console.warn('[studio-store] falta window.WeOtziStudioAdmin (studio-dashboard.js debe cargarse antes).');
})();
