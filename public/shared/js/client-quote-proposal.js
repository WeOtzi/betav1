/**
 * WE OTZI - Propuesta del artista en el panel del cliente (beta cerrada)
 * ---------------------------------------------------------------------
 * Frente cot-cliente · CC-01 / CC-11 / CC-13 / COT-A-10.
 * Lógica pura + HTML (siempre escapado) del bloque "Propuesta del artista" del
 * detalle de cotización del cliente:
 *   - etiqueta clara de cada estado (sin borradores como "En proceso"),
 *   - monto, moneda, sesiones, duración, disponibilidad y vigencia,
 *   - desglose de la cotización manual (artist_manual_quotes, RLS del cliente),
 *   - anticipo y pagos registrados por el artista (quotation_payments, RLS del
 *     cliente) — sin pasarela: el anticipo se coordina con el artista,
 *   - acciones Aceptar / Rechazar / Modificar cuando la propuesta está vigente.
 *     Ronda 2 (negociación · P23/P25): "Modificar" y el panel de cambios los
 *     maneja quotation-negotiation.js, que se monta solo en
 *     [data-wqn-mount]; Rechazar advierte que la cotización queda finalizada.
 * Sin dependencias del DOM: lo usa client-dashboard.js y lo prueban los tests.
 * Expone window.WoClientQuoteProposal (o module.exports en Node).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoClientQuoteProposal = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // key → { label, tone }. tone = clase CSS de .quotation-status.
    var STATUS = {
        draft: { label: 'Borrador sin enviar', tone: 'draft' },
        pending: { label: 'Esperando al artista', tone: 'pending' },
        responded: { label: 'Propuesta recibida', tone: 'responded' },
        client_approved: { label: 'Aceptada', tone: 'client_approved' },
        client_rejected: { label: 'Rechazada', tone: 'client_rejected' },
        in_progress: { label: 'En curso', tone: 'in_progress' },
        artist_completed: { label: 'Por confirmar', tone: 'artist_completed' },
        completed: { label: 'Completada', tone: 'completed' },
        cancelled: { label: 'Cancelada', tone: 'cancelled' },
        expired: { label: 'Vencida', tone: 'expired' },
        unknown: { label: 'En revisión', tone: 'pending' }
    };

    // Filtros del listado del cliente (Todas / Activas / Pendientes / Completadas).
    var ACTIVE_KEYS = ['pending', 'responded', 'client_approved', 'in_progress', 'artist_completed'];

    var POLICIES = {
        'no-reembolsable-48': 'El anticipo no es reembolsable. Reprogramaciones con 48 h de aviso.',
        'no-reembolsable-24': 'El anticipo no es reembolsable. Reprogramaciones con 24 h de aviso.',
        'reembolsable-72': 'El anticipo se devuelve si cancelas con 72 h de aviso.',
        'sin-sena': 'No se pide anticipo. Puedes cancelar sin costo.'
    };

    // P23 (ronda 2): texto pedido por el dueño para la advertencia del rechazo.
    var REJECT_WARNING = 'Esto dará por finalizada la cotización y tendrás que iniciar una nueva.';
    // Estados en los que puede haber negociación o historial que mostrar.
    var NEGOTIATION_KEYS = ['responded', 'client_approved', 'in_progress', 'artist_completed', 'completed', 'client_rejected', 'expired', 'cancelled'];

    var KIND_LABELS = { deposit: 'Anticipo', session: 'Pago de sesión', balance: 'Saldo', other: 'Otro' };
    var METHOD_LABELS = { cash: 'Efectivo', transfer: 'Transferencia', other: 'Otro' };

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function hasValue(v) { return v != null && String(v).trim() !== ''; }

    // "410000", "410.000,50", 410000 → número o null.
    function toNumber(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        var s = String(v).trim().replace(/[^\d.,-]/g, '');
        if (!s) return null;
        if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
        else if (s.indexOf(',') !== -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        var n = Number(s);
        return isFinite(n) ? n : null;
    }

    function money(amount, currency) {
        var n = toNumber(amount);
        var cur = String(currency || '').trim().toUpperCase();
        if (n == null) return hasValue(amount) ? (String(amount).trim() + (cur ? ' ' + cur : '')) : '';
        var txt;
        try { txt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n); } catch (e) { txt = String(n); }
        return txt + (cur ? ' ' + cur : '');
    }

    function duration(minutes) {
        var m = Math.round(Number(minutes));
        if (!isFinite(m) || m <= 0) return '';
        var h = Math.floor(m / 60);
        var r = m % 60;
        if (!h) return r + ' min';
        return h + ' h' + (r ? ' ' + r + ' min' : '');
    }

    function dateLabel(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        try { return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch (e) { return d.toISOString().slice(0, 10); }
    }

    function isDraft(q) {
        return !!q && q.quote_status === 'in_progress' && !q.artist_responded_at
            && !hasValue(q.artist_budget_amount) && !hasValue(q.final_budget_amount);
    }

    function isExpired(q, now) {
        if (!q) return false;
        if (q.quote_status === 'expired') return true;
        if (q.quote_status !== 'responded' || !q.quote_expires_at) return false;
        var at = Date.parse(q.quote_expires_at);
        return isFinite(at) && at <= (now == null ? Date.now() : now);
    }

    function statusKey(q, now) {
        if (!q) return 'unknown';
        if (isDraft(q)) return 'draft';
        if (isExpired(q, now)) return 'expired';
        var s = q.quote_status;
        if (s === 'en_progreso') return 'in_progress';
        return STATUS[s] ? s : 'unknown';
    }

    function statusOf(q, now) {
        var key = statusKey(q, now);
        return { key: key, label: STATUS[key].label, tone: STATUS[key].tone };
    }

    function matchesFilter(q, filter, now) {
        var key = statusKey(q, now);
        if (key === 'draft') return false; // los borradores se muestran aparte
        if (!filter || filter === 'all') return true;
        if (filter === 'active') return ACTIVE_KEYS.indexOf(key) !== -1;
        return key === filter;
    }

    function canDecide(q, now) {
        return !!q && q.quote_status === 'responded' && !isExpired(q, now)
            && (q.dispute_status || 'none') !== 'open';
    }

    // Propuesta vigente: acuerdo (final_*) si existe, si no la respuesta del
    // artista, si no el total de la cotización manual.
    function proposalOf(q, manual) {
        q = q || {};
        var isFinal = hasValue(q.final_budget_amount);
        var amount = isFinal ? q.final_budget_amount : (hasValue(q.artist_budget_amount) ? q.artist_budget_amount : (manual && hasValue(manual.total) ? manual.total : null));
        var currency = isFinal ? (q.final_budget_currency || q.artist_budget_currency) : (hasValue(q.artist_budget_amount) ? q.artist_budget_currency : (manual && manual.currency));
        var sessions = hasValue(q.final_sessions) ? q.final_sessions : q.tattoo_estimated_sessions;
        return {
            amount: amount,
            currency: currency || '',
            amountText: money(amount, currency),
            sessions: hasValue(sessions) ? String(sessions).trim() : '',
            durationText: duration(q.artist_session_minutes),
            availability: hasValue(q.artist_availability) ? String(q.artist_availability).trim() : '',
            comment: hasValue(q.final_comment) ? String(q.final_comment).trim() : '',
            expiresAt: q.quote_expires_at || null,
            isFinal: isFinal,
            hasProposal: hasValue(amount) || !!q.artist_responded_at
        };
    }

    function manualBreakdown(manual) {
        if (!manual) return null;
        var items = (Array.isArray(manual.line_items) ? manual.line_items : []).map(function (it) {
            var qty = toNumber(it && it.qty);
            var price = toNumber(it && it.price);
            var total = toNumber(it && it.total);
            if (total == null && qty != null && price != null) total = Math.round(qty * price * 100) / 100;
            return { name: String((it && it.name) || '').trim(), description: String((it && it.description) || '').trim(), qty: qty, price: price, total: total };
        }).filter(function (it) { return it.name || it.total; });
        var subtotal = toNumber(manual.subtotal);
        if (subtotal == null) subtotal = items.reduce(function (s, it) { return s + (it.total || 0); }, 0);
        var discountPct = toNumber(manual.discount_pct) || 0;
        var taxPct = toNumber(manual.tax_pct) || 0;
        var discount = Math.round(subtotal * discountPct) / 100;
        var tax = Math.round((subtotal - discount) * taxPct) / 100;
        var total = toNumber(manual.total);
        if (total == null) total = Math.round((subtotal - discount + tax) * 100) / 100;
        var depositPct = toNumber(manual.deposit_pct);
        var deposit = toNumber(manual.deposit_amount);
        return {
            currency: String(manual.currency || '').toUpperCase(),
            items: items,
            subtotal: subtotal, discountPct: discountPct, discount: discount,
            taxPct: taxPct, tax: tax, total: total,
            depositPct: depositPct, deposit: deposit && deposit > 0 ? deposit : null,
            balance: deposit && deposit > 0 ? Math.max(0, Math.round((total - deposit) * 100) / 100) : null,
            // Ronda 2 · cot-respuesta: sin vencimiento activado no se anuncia una validez.
            validityDays: manual.project && manual.project.expiry_enabled === false ? null : toNumber(manual.validity_days),
            complexity: String((manual.project && manual.project.complexity) || '').trim(),
            policy: POLICIES[manual.cancellation_policy] || '',
            clientNotes: String(manual.client_notes || '').trim(),
            extraTerms: String(manual.extra_terms || '').trim()
        };
    }

    // Ronda 2 · cot-respuesta: fechas ofrecidas por el artista
    // (quotations_db.offered_slots = [{ kind, start, end, label, tz }]) y la
    // nota libre que queda en artist_availability al quitarle esas etiquetas.
    function offeredOf(q) {
        var labels = (Array.isArray(q && q.offered_slots) ? q.offered_slots : []).map(function (s) {
            return String((s && s.label) || '').trim();
        }).filter(Boolean);
        var text = hasValue(q && q.artist_availability) ? String(q.artist_availability).trim() : '';
        if (!labels.length) return { labels: [], note: text };
        var tail = labels.join('; ');
        var note = '';
        if (text && text !== tail && text.slice(-(tail.length + 2)) === '; ' + tail) note = text.slice(0, text.length - tail.length - 2);
        return { labels: labels, note: note };
    }

    // ------------------------------- HTML -------------------------------
    function row(label, value, cls) {
        return '<div class="cqp-row' + (cls ? ' ' + cls : '') + '"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    }

    function decisionHtml(q, now) {
        if (!canDecide(q, now)) return '';
        var id = esc(q.quote_id);
        return '<div class="cqp-decision" data-quote-id="' + id + '">'
            + '<p class="cqp-decision-copy">¿Te sirve esta propuesta? Si la aceptas, el artista recibe el aviso y coordinan el turno y el anticipo por el chat. Si necesitas ajustar algo, modifícala y el artista te responde.</p>'
            + '<div class="cqp-decision-actions">'
            + '<button type="button" class="wo-btn wo-btn--accent wo-btn--s" data-proposal-action="approve" onclick="handleProposalAction(this)">Aceptar</button>'
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-proposal-action="reject" onclick="handleProposalAction(this)">Rechazar</button>'
            // Modificar (P23): lo habilita quotation-negotiation.js cuando el
            // servidor confirma que se puede contraproponer.
            + '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-wqn-open="counter" data-quote-id="' + id + '" data-role="client" hidden>Modificar</button>'
            + '</div>'
            + '<div class="cqp-confirm" data-proposal-confirm hidden></div>'
            + '<p class="cqp-feedback" role="status" aria-live="polite" data-proposal-feedback></p>'
            + '</div>';
    }

    // Punto de montaje del panel de negociación (quotation-negotiation.js):
    // contrapropuesta pendiente, cambios al acuerdo e historial. Vacío y
    // oculto hasta que el módulo lo llena; si el módulo no cargó, no se ve.
    function negotiationMountHtml(q, key) {
        if (!q || !hasValue(q.quote_id) || NEGOTIATION_KEYS.indexOf(key) === -1) return '';
        return '<div data-wqn-mount data-quote-id="' + esc(q.quote_id) + '" data-role="client" data-status="' + esc(q.quote_status) + '" hidden></div>';
    }

    function confirmHtml(decision, quoteId) {
        var id = esc(quoteId);
        if (decision === 'approve') {
            return '<p class="cqp-confirm-copy">Vas a aceptar la propuesta. El artista recibe el aviso por email.</p>'
                + '<div class="cqp-decision-actions">'
                + '<button type="button" class="wo-btn wo-btn--accent wo-btn--s" data-proposal-action="confirm-approve" data-quote-id="' + id + '" onclick="handleProposalAction(this)">Sí, aceptar</button>'
                + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-proposal-action="cancel" onclick="handleProposalAction(this)">Volver</button>'
                + '</div>';
        }
        var fieldId = 'cqp-reason-' + String(quoteId || '').replace(/[^A-Za-z0-9_-]/g, '');
        // P23: rechazar es definitivo (la base cierra la cotización y el chat del artista).
        return '<p class="cqp-warning" role="alert">' + esc(REJECT_WARNING) + '</p>'
            + '<div class="wo-field"><label class="wo-label" for="' + esc(fieldId) + '">Motivo (opcional)</label>'
            + '<textarea class="wo-textarea cqp-reason" id="' + esc(fieldId) + '" maxlength="500" rows="3" placeholder="Cuéntale al artista por qué no te sirve (precio, fechas, diseño…)"></textarea></div>'
            + '<div class="cqp-decision-actions">'
            + '<button type="button" class="wo-btn wo-btn--danger wo-btn--s" data-proposal-action="confirm-reject" data-quote-id="' + id + '" onclick="handleProposalAction(this)">Sí, rechazar</button>'
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-proposal-action="cancel" onclick="handleProposalAction(this)">Volver</button>'
            + '</div>';
    }

    function stateNote(q, now) {
        var key = statusKey(q, now);
        if (key === 'pending') return 'El artista todavía no respondió. Te avisamos por email cuando mande su propuesta.';
        if (key === 'expired') return 'La propuesta venció sin respuesta. Si te sigue interesando, escríbele al artista por el chat.';
        if (key === 'client_approved') return 'Aceptaste la propuesta. Coordina el turno y el anticipo con el artista por el chat.';
        if (key === 'client_rejected') return 'Rechazaste esta propuesta y la cotización quedó finalizada. Si quieres retomar la idea, inicia una cotización nueva.';
        if (key === 'cancelled') return 'El artista no va a tomar esta solicitud.';
        if (key === 'responded' && (q.dispute_status || 'none') === 'open') return 'Hay un reclamo abierto: no se puede responder hasta que soporte lo resuelva.';
        return '';
    }

    /**
     * Bloque completo. ctx = { manual, payments: { summary, list, available }, now }
     */
    function renderProposal(q, ctx) {
        ctx = ctx || {};
        var now = ctx.now == null ? Date.now() : ctx.now;
        var key = statusKey(q, now);
        if (key === 'draft') {
            return '<div class="detail-section cqp" id="quote-proposal">'
                + '<h3 class="detail-section-title">Propuesta del artista</h3>'
                + '<p class="cqp-note">Esta cotización quedó como borrador y el artista todavía no la recibió. <a class="detail-link" href="/quotation">Continuar cotización →</a></p>'
                + '</div>';
        }
        var p = proposalOf(q, ctx.manual);
        var parts = ['<div class="detail-section cqp" id="quote-proposal">',
            '<h3 class="detail-section-title">' + (p.isFinal ? 'Acuerdo con el artista' : 'Propuesta del artista') + '</h3>'];

        if (!p.hasProposal) {
            var note = stateNote(q, now) || 'Todavía no hay una propuesta del artista.';
            parts.push('<p class="cqp-note">' + esc(note) + '</p></div>');
            return parts.join('');
        }

        parts.push('<dl class="cqp-summary">');
        parts.push(row(p.isFinal ? 'Total acordado' : 'Presupuesto', p.amountText || 'A confirmar', 'cqp-row--total'));
        if (p.sessions) parts.push(row('Sesiones', p.sessions));
        if (p.durationText) parts.push(row('Duración por sesión', p.durationText));
        // Ronda 2 · cot-respuesta: con fechas estructuradas, "Disponibilidad" muestra solo la nota libre.
        var offered = offeredOf(q);
        if (offered.labels.length ? offered.note : p.availability) parts.push(row('Disponibilidad', offered.labels.length ? offered.note : p.availability));
        var b = manualBreakdown(ctx.manual);
        if (b && b.complexity) parts.push(row('Complejidad', b.complexity));
        if (q.quote_status === 'responded' && p.expiresAt) {
            parts.push(row(isExpired(q, now) ? 'Venció el' : 'Válida hasta', dateLabel(p.expiresAt)));
        }
        parts.push('</dl>');
        if (offered.labels.length) {
            parts.push('<div class="cqp-dates"><h4 class="cqp-subtitle">Fechas que te ofrece el artista</h4><ul class="cqp-items">');
            offered.labels.forEach(function (label) { parts.push('<li><span class="cqp-item-name">' + esc(label) + '</span></li>'); });
            parts.push('</ul></div>');
        }
        if (hasValue(q.proposal_message) && !p.isFinal) parts.push('<p class="cqp-comment">' + esc(String(q.proposal_message).trim()) + '</p>');
        if (p.comment) parts.push('<p class="cqp-comment">' + esc(p.comment) + '</p>');

        // El acuerdo puede haber cambiado después (contrapropuesta o enmienda
        // aprobada): el desglose queda como referencia de la propuesta original.
        var agreedTotal = p.isFinal ? toNumber(p.amount) : null;
        var amended = !!(b && agreedTotal != null && b.total != null && Math.abs(b.total - agreedTotal) > 0.005);
        if (b && b.items.length) {
            parts.push('<div class="cqp-breakdown"><h4 class="cqp-subtitle">' + (amended ? 'Desglose de la propuesta original' : 'Desglose') + '</h4><ul class="cqp-items">');
            b.items.forEach(function (it) {
                var qty = it.qty != null && it.qty !== 1 ? ' × ' + it.qty : '';
                parts.push('<li><span class="cqp-item-name">' + esc(it.name) + esc(qty)
                    + (it.description ? '<small>' + esc(it.description) + '</small>' : '') + '</span>'
                    + '<span class="cqp-item-total">' + esc(money(it.total, b.currency)) + '</span></li>');
            });
            parts.push('</ul><dl class="cqp-summary cqp-summary--totals">');
            parts.push(row('Subtotal', money(b.subtotal, b.currency)));
            if (b.discountPct) parts.push(row('Descuento (' + b.discountPct + '%)', '− ' + money(b.discount, b.currency)));
            if (b.taxPct) parts.push(row('Impuestos (' + b.taxPct + '%)', money(b.tax, b.currency)));
            parts.push(row(amended ? 'Total original' : 'Total', money(b.total, b.currency), 'cqp-row--total'));
            parts.push('</dl></div>');
        }

        // Anticipo y pagos (solo lectura). Sin pasarela de pago integrada.
        var summary = ctx.payments && ctx.payments.summary;
        var depositAmount = b && b.deposit ? b.deposit : (summary && summary.deposit ? summary.deposit.required : null);
        var depositCurrency = b && b.deposit ? b.currency : (summary && summary.deposit ? summary.deposit.currency : p.currency);
        var showMoney = depositAmount || (summary && summary.count) || ['client_approved', 'in_progress', 'artist_completed', 'completed'].indexOf(key) !== -1;
        if (showMoney) {
            parts.push('<div class="cqp-payments"><h4 class="cqp-subtitle">Anticipo y pagos</h4><dl class="cqp-summary">');
            if (depositAmount) {
                var depStatus = summary && summary.deposit ? summary.deposit.status : 'pending';
                var depLabel = depStatus === 'paid' ? 'Pagada' : depStatus === 'partial' ? 'Pago parcial' : 'Pendiente';
                parts.push(row('Anticipo' + (b && b.depositPct ? ' (' + b.depositPct + '%)' : ''), money(depositAmount, depositCurrency)));
                parts.push(row('Estado del anticipo', depLabel, 'cqp-row--' + depStatus));
            }
            if (summary && summary.count) {
                parts.push(row('Pagado', money(summary.paid, summary.currency)));
                // El saldo acordado se activa recién con la cotización aprobada por ambas partes.
                if (summary.balance != null && summary.active !== false) parts.push(row('Saldo', money(summary.balance, summary.currency)));
            }
            parts.push('</dl>');
            if (summary && summary.payments && summary.payments.length) {
                parts.push('<ul class="cqp-items cqp-items--payments">');
                summary.payments.slice(0, 10).forEach(function (pay) {
                    parts.push('<li><span class="cqp-item-name">' + esc(KIND_LABELS[pay.kind] || 'Pago')
                        + '<small>' + esc([dateLabel(pay.paidOn), METHOD_LABELS[pay.method] || ''].filter(Boolean).join(' · ')) + '</small></span>'
                        + '<span class="cqp-item-total">' + esc(money(pay.amount, pay.currency)) + '</span></li>');
                });
                parts.push('</ul>');
            }
            parts.push('<p class="cqp-note">We Ötzi todavía no cobra pagos online: coordina el anticipo y el saldo con el artista por el chat y paga solo por los medios que te indique. Los pagos que el artista registre aparecen aquí.</p>');
            parts.push('</div>');
        }

        if (b && (b.policy || b.validityDays || b.clientNotes || b.extraTerms)) {
            parts.push('<div class="cqp-terms"><h4 class="cqp-subtitle">Condiciones del artista</h4>');
            if (b.policy) parts.push('<p>' + esc(b.policy) + '</p>');
            if (b.validityDays && q.quote_status === 'responded' && !p.expiresAt) parts.push('<p>' + esc('Validez indicada por el artista: ' + b.validityDays + ' días.') + '</p>');
            if (b.clientNotes) parts.push('<p class="cqp-pre">' + esc(b.clientNotes) + '</p>');
            if (b.extraTerms) parts.push('<p class="cqp-pre">' + esc(b.extraTerms) + '</p>');
            parts.push('</div>');
        }

        var note2 = stateNote(q, now);
        if (note2 && key !== 'pending') parts.push('<p class="cqp-note">' + esc(note2) + '</p>');
        parts.push(negotiationMountHtml(q, key));
        parts.push(decisionHtml(q, now));
        parts.push('</div>');
        return parts.join('');
    }

    return {
        STATUS: STATUS,
        ACTIVE_KEYS: ACTIVE_KEYS,
        esc: esc,
        toNumber: toNumber,
        money: money,
        duration: duration,
        dateLabel: dateLabel,
        isDraft: isDraft,
        isExpired: isExpired,
        statusKey: statusKey,
        statusOf: statusOf,
        matchesFilter: matchesFilter,
        canDecide: canDecide,
        proposalOf: proposalOf,
        manualBreakdown: manualBreakdown,
        offeredOf: offeredOf,
        renderProposal: renderProposal,
        confirmHtml: confirmHtml,
        negotiationMountHtml: negotiationMountHtml,
        REJECT_WARNING: REJECT_WARNING
    };
}));
