/**
 * WE OTZI - Franja "Estado · Prioridad · Propuesta" del expediente
 * ---------------------------------------------------------------
 * Ronda 2 · frente cot-respuesta (P5 / P25). Módulo satélite de
 * /my-quotations/detail: se monta debajo de la identidad cada vez que
 * quotation-detail-figma.js emite `wo:quotation-detail-rendered`
 * ({ quote, stage, readOnly, user }).
 *
 *   Estado      selector con el estado actual y SOLO las transiciones que el
 *               artista puede hacer (WoQuotationsViewModel.statusOptions, que
 *               replica el trigger vivo fn_quotation_status_change). El cambio
 *               lo aplica WoQuotationDetailActions.changeStatus: las
 *               transiciones que piden datos abren su diálogo (propuesta,
 *               acuerdo) y las que avisan al cliente pasan por su acción.
 *   Prioridad   alta / media / baja (quotations_db.priority, ya visible en
 *               el listado /my-quotations).
 *   Propuesta   "Modificar propuesta" mientras la cotización no esté aprobada
 *               por ambas partes: dispara el contrato entre frentes
 *               CustomEvent('wo:quote-respond', { detail: { quoteId } }).
 *
 * Sin este módulo el expediente funciona igual (acciones de la barra).
 */
(function () {
    'use strict';

    var STATUS_LABELS = {
        pending: 'Pendiente', responded: 'Respondida', client_approved: 'Confirmada', in_progress: 'En progreso',
        en_progreso: 'En progreso', artist_completed: 'Lista para cliente', completed: 'Completada',
        client_rejected: 'Rechazada por el cliente', cancelled: 'Cancelada', expired: 'Vencida'
    };
    // Lo que pasa al elegir cada destino (texto de la opción).
    var TARGET_LABELS = {
        responded: 'Respondida · enviar propuesta',
        client_approved: 'Confirmada · registrar acuerdo',
        in_progress: 'En progreso',
        artist_completed: 'Lista para cliente',
        cancelled: 'Cancelada'
    };
    var PRIORITIES = [['high', 'Alta'], ['medium', 'Media'], ['low', 'Baja']];
    var last = null;
    var working = false;

    function VM() { return window.WoQuotationsViewModel || null; }
    function RM() { return window.WoQuoteRespondModel || null; }
    function actions() { return window.WoQuotationDetailActions || null; }
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function statusOptions(quote) {
        var vm = VM();
        var current = quote.quote_status;
        var list = vm ? vm.statusOptions(current).map(function (o) { return o.value; }) : [current];
        if (list.indexOf(current) === -1) list.unshift(current);
        return list.map(function (value) {
            var label = value === current ? (STATUS_LABELS[value] || value) : (TARGET_LABELS[value] || STATUS_LABELS[value] || value);
            if (value === 'cancelled' && current === 'responded') label = 'Cancelada · retirar propuesta';
            if (value === 'cancelled' && current === 'pending') label = 'Cancelada · rechazar solicitud';
            if (value === 'responded' && current === 'expired') label = 'Respondida · volver a cotizar';
            if (value === 'in_progress' && current === 'client_approved') label = 'En progreso · iniciar trabajo';
            if (value === 'in_progress' && current === 'artist_completed') label = 'En progreso · reabrir trabajo';
            return { value: value, label: label };
        });
    }

    function noteFor(detail) {
        var model = RM();
        var quote = detail.quote;
        if (detail.readOnly) return 'Vista de estado simulada: los cambios están deshabilitados.';
        if (detail.stage === 'dispute') return 'Hay una disputa abierta: el estado no cambia hasta que se resuelva.';
        if (model && model.approvedByBoth(quote)) return 'Aprobada por ambas partes: el saldo acordado ya está activo.';
        if (quote.quote_status === 'responded') return 'Puedes modificar la propuesta mientras no esté aprobada por ambas partes. El saldo acordado se activa recién cuando el cliente la aprueba.';
        if (quote.quote_status === 'pending') return 'Responde con tu presupuesto y las fechas que ofreces para que el cliente pueda aprobar la propuesta.';
        // P23: el rechazo del cliente es definitivo, no se ofrece volver a cotizar.
        if (quote.quote_status === 'client_rejected') return 'El cliente rechazó la propuesta y la cotización quedó finalizada.';
        return '';
    }

    function proposeLabel(detail) {
        var model = RM();
        var quote = detail.quote;
        if (!model || detail.readOnly || !model.canPropose(quote).ok || quote.is_archived) return '';
        // Pendiente y vencida ya tienen su botón en la barra de comandos.
        if (quote.quote_status === 'responded') return 'Modificar propuesta';
        return '';
    }

    function html(detail) {
        var quote = detail.quote;
        var options = statusOptions(quote);
        var locked = detail.readOnly || detail.stage === 'dispute' || !!quote.is_archived || !actions();
        var priority = quote.priority || 'medium';
        var priorities = PRIORITIES.slice();
        if (!priorities.some(function (p) { return p[0] === priority; })) priorities.unshift([priority, priority === 'critical' ? 'Crítica' : priority]);
        var note = noteFor(detail);
        var propose = proposeLabel(detail);
        return '<div class="qsp-field"><label class="qsp-label" for="qsp-status">Estado</label>'
            + '<select class="qsp-select wo-select" id="qsp-status" aria-describedby="qsp-note"' + (locked || options.length < 2 ? ' disabled' : '') + '>'
            + options.map(function (o) {
                return '<option value="' + esc(o.value) + '"' + (o.value === quote.quote_status ? ' selected' : '') + '>' + esc(o.label) + '</option>';
            }).join('')
            + '</select></div>'
            + '<div class="qsp-field"><label class="qsp-label" for="qsp-priority">Prioridad</label>'
            + '<select class="qsp-select wo-select" id="qsp-priority"' + (detail.readOnly || !actions() ? ' disabled' : '') + '>'
            + priorities.map(function (p) {
                return '<option value="' + esc(p[0]) + '"' + (p[0] === priority ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
            }).join('')
            + '</select></div>'
            + '<p class="qsp-note" id="qsp-note" aria-live="polite">' + esc(note) + '</p>'
            + (propose ? '<button type="button" class="qsp-btn" data-qsp-propose>' + esc(propose) + '</button>' : '');
    }

    function mount(detail) {
        var root = document.getElementById('quotation-detail-root');
        var identity = root && root.querySelector('.qd-identity');
        if (!identity || !detail || !detail.quote) return;
        var box = root.querySelector('#qsp');
        if (!box) {
            box = document.createElement('section');
            box.id = 'qsp';
            box.className = 'qsp';
            box.setAttribute('aria-label', 'Estado, prioridad y propuesta de la cotización');
            identity.insertAdjacentElement('afterend', box);
        }
        box.innerHTML = html(detail);
    }

    async function onStatus(select) {
        var api = actions();
        if (!api || !last || working) return;
        var current = last.quote.quote_status;
        var next = select.value;
        if (next === current) return;
        working = true;
        select.disabled = true;
        var changed = false;
        try { changed = await api.changeStatus(next); } catch (error) { console.error('[quote-status-priority] estado', error); }
        working = false;
        // Si el cambio se aplicó, el expediente se volvió a pintar (y esta franja con él).
        // Si abrió un diálogo o se canceló, el selector vuelve al estado real.
        var live = document.getElementById('qsp-status');
        if (live && !changed) {
            live.value = last.quote.quote_status;
            live.disabled = false;
        }
    }

    async function onPriority(select) {
        var api = actions();
        if (!api || !last || working) return;
        var previous = last.quote.priority || 'medium';
        var next = select.value;
        if (next === previous) return;
        working = true;
        select.disabled = true;
        var ok = false;
        try { ok = await api.changePriority(next); } catch (error) { console.error('[quote-status-priority] prioridad', error); }
        working = false;
        select.disabled = false;
        if (!ok) select.value = previous;
        else select.focus();
    }

    document.addEventListener('wo:quotation-detail-rendered', function (event) {
        last = event.detail || null;
        try { mount(last); } catch (error) { console.error('[quote-status-priority]', error); }
    });

    document.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || !target.id) return;
        if (target.id === 'qsp-status') onStatus(target);
        else if (target.id === 'qsp-priority') onPriority(target);
    });

    document.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-qsp-propose]') : null;
        if (!button || !last || !last.quote) return;
        document.dispatchEvent(new CustomEvent('wo:quote-respond', {
            detail: { quoteId: last.quote.quote_id || last.quote.id, prefill: {} }
        }));
    });

    window.WoQuoteStatusPriority = { statusOptions: statusOptions, noteFor: noteFor, proposeLabel: proposeLabel };
}());
