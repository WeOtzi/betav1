/**
 * WE OTZI - Diálogo "Aceptar y enviar presupuesto" (ronda 2 · cot-respuesta)
 * -------------------------------------------------------------------------
 * Reemplaza al diálogo angosto del expediente (/my-quotations/detail). Mismo
 * diálogo para responder, volver a cotizar y MODIFICAR una propuesta mientras
 * la cotización no esté aprobada por ambas partes (P25).
 *
 * Cuatro secciones en pestañas (entra en 720 px de alto sin scroll de página):
 *   1 Propuesta       presupuesto, moneda, sesiones, duración, anticipo,
 *                     complejidad, estudio o ubicación y vencimiento
 *   2 Disponibilidad  calendario conectado a la agenda real: turnos con
 *                     horario y rangos de fechas (varias fechas). Lo ocupado
 *                     (confirmado) no se puede ofrecer; el servidor lo vuelve
 *                     a comprobar al guardar.
 *   3 Condiciones     campos de la cotización manual (P29): desglose
 *                     económico, política de reserva y cancelación, notas
 *                     para el cliente y términos adicionales
 *   4 Mensaje         respuestas rápidas, variables ({{cliente}},
 *                     {{presupuesto}}, {{fechas}}…) y vista previa resuelta
 *
 * Lo abre quotation-detail-figma.js (openRespondDialog) con un contexto:
 *   WoQuoteRespond.open({ quote, user, prefill, budgetDraft, toast, reload,
 *                         sendChat, notifyResponded, flushNotes })
 * Devuelve true si se hizo cargo (si falta algún módulo devuelve false y el
 * expediente usa su diálogo anterior).
 *
 * Datos: WeotziData.QuoteRespond (servidor) · lógica: WoQuoteRespondModel.
 */
(function () {
    'use strict';

    function M() { return window.WoQuoteRespondModel; }
    function B() { return window.WoBookingSlots; }
    function Repo() { return window.WeotziData && window.WeotziData.QuoteRespond; }

    var TABS = [
        { key: 'propuesta', label: 'Propuesta' },
        { key: 'disponibilidad', label: 'Disponibilidad' },
        { key: 'condiciones', label: 'Condiciones' },
        { key: 'mensaje', label: 'Mensaje' }
    ];
    var STATUS_TEXT = { free: 'libre', partial: 'con turnos tomados', busy: 'ocupado', closed: 'sin horario de atención', past: 'ya pasó' };
    var TITLES = {
        respond: ['Aceptar y enviar presupuesto', 'El cliente recibe tu presupuesto, las fechas que le ofreces y tus condiciones. Puedes modificar la propuesta mientras no esté aprobada por ambas partes.', 'Enviar propuesta'],
        update: ['Modificar propuesta', 'Ajusta lo que necesites y vuelve a enviarla. El cliente recibe un aviso con la propuesta actualizada.', 'Reenviar propuesta'],
        requote: ['Volver a cotizar', 'Envía una propuesta nueva: presupuesto, fechas y condiciones.', 'Enviar propuesta']
    };

    var active = null;
    var seq = 0;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    // Valor seguro dentro de un selector [attr="…"].
    function sel(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
        return String(value).replace(/[^A-Za-z0-9_-]/g, function (ch) { return '\\' + ch; });
    }
    function icon(name) {
        var api = window.QuotationDetailIcons;
        return api && api.ICONS && api.ICONS[name] ? api.svg(name) : '';
    }
    function closeGlyph() { return icon('x') || '<span aria-hidden="true">×</span>'; }

    /* ----------------------------------- estado ----------------------------------- */
    function createState(ctx) {
        var model = M();
        var quote = ctx.quote;
        var prefill = ctx.prefill && typeof ctx.prefill === 'object' ? ctx.prefill : {};
        var init = model.initialValues(quote, null, prefill, { now: Date.now() });
        if ((prefill.amount == null || prefill.amount === '') && String(ctx.budgetDraft || '').trim()) init.amount = String(ctx.budgetDraft).trim();
        var minutes = Math.min(1440, Math.max(15, init.minutes || 120));
        var expiry = expiryDefaults(quote);
        var tz = B().DEFAULT_TZ;
        return {
            ctx: ctx,
            quote: quote,
            mode: model.proposalMode(quote),
            tab: TABS.some(function (t) { return t.key === prefill.tab; }) ? prefill.tab : 'propuesta',
            tz: tz,
            today: B().zonedDate(Date.now(), tz),
            schedule: 'own',
            v: {
                amount: init.amount, currency: init.currency, sessions: init.sessions,
                hours: Math.floor(minutes / 60), mins: minutes % 60 - (minutes % 60) % 15,
                depositPct: init.depositPct, expiryEnabled: expiry.enabled, expiryDays: expiry.days,
                location: init.location, complexity: init.complexity, availabilityNote: init.availabilityNote,
                message: init.message, discountPct: init.discountPct || 0, taxPct: init.taxPct || 0,
                policy: init.policy, clientNotes: init.clientNotes, extraTerms: init.extraTerms
            },
            items: toItems(init.items),
            offered: (init.offered || []).slice(0, model.MAX_OFFERS),
            touched: {},
            prefilled: prefill,
            conflicts: {},
            templates: { saved: [], available: null, status: '', confirmDelete: null },
            cal: { month: '', data: {}, loaded: {}, loading: false, error: '', selected: '', mode: 'slot', rangeStart: '', notice: '', dayError: '' },
            busy: false,
            dirty: false
        };
    }

    function expiryDefaults(quote) {
        var vm = window.WoQuotationsViewModel;
        var enabled = !!(vm ? vm.expiryEnabled(quote) : (quote && quote.quote_expiry_enabled));
        return { enabled: enabled, days: enabled ? Number(quote.quote_expiry_days) : ((vm && vm.DEFAULT_VALIDITY_DAYS) || 14) };
    }

    function toItems(list) {
        return (Array.isArray(list) ? list : []).map(function (it) {
            seq += 1;
            return {
                id: 'qri' + seq, name: String((it && it.name) || ''), description: String((it && it.description) || ''),
                qty: it && it.qty != null && it.qty !== '' ? it.qty : 1, price: it && it.price != null ? it.price : ''
            };
        });
    }

    function minutesOf(state) {
        return (parseInt(state.v.hours, 10) || 0) * 60 + (parseInt(state.v.mins, 10) || 0);
    }

    function totalsOf(state) {
        var model = M();
        var items = model.cleanItems(state.items);
        var priced = items.some(function (it) { return it.name && it.qty * it.price > 0; });
        var totals = model.extrasTotals({ items: priced ? items : [], discountPct: state.v.discountPct, taxPct: state.v.taxPct }, 0);
        var amount = priced ? totals.total : model.parseMoney(state.v.amount);
        var pct = model.parseMoney(state.v.depositPct);
        var hasPct = Number.isFinite(pct) && pct > 0 && pct <= 100;
        var valid = Number.isFinite(amount) && amount > 0;
        var deposit = valid && hasPct ? Math.round(amount * pct) / 100 : null;
        return {
            priced: priced, totals: totals, amount: valid ? amount : null,
            depositPct: hasPct ? pct : null, deposit: deposit,
            balance: valid ? Math.round((amount - (deposit || 0)) * 100) / 100 : null
        };
    }

    function offerLabels(state) {
        var model = M();
        return state.offered.map(function (offer) { return model.offerLabel(offer, state.tz); });
    }

    function variables(state) {
        var model = M();
        var t = totalsOf(state);
        return model.templateVars({
            clientName: state.quote.client_full_name,
            artistName: state.quote.artist_name,
            amount: t.amount, currency: state.v.currency, sessions: state.v.sessions, minutes: minutesOf(state),
            depositPct: t.depositPct, depositAmount: t.deposit,
            offerLabels: offerLabels(state),
            location: state.v.location || state.quote.artist_studio_name
        });
    }

    /* ----------------------------------- HTML ----------------------------------- */
    function field(label, control, cls, helpId, help) {
        return '<label class="wo-field' + (cls ? ' ' + cls : '') + '"><span class="wo-label">' + esc(label) + '</span>' + control
            + (helpId ? '<small class="qr-help" id="' + helpId + '">' + esc(help || '') + '</small>' : '') + '</label>';
    }

    function currencyControl(value) {
        var current = String(value || 'USD').toUpperCase();
        var api = window.WeOtziCurrency;
        if (api && typeof api.countryCurrencyOptionsHtml === 'function') {
            return '<select class="wo-select" name="currency">' + api.countryCurrencyOptionsHtml({ value: current, label: 'code' }) + '</select>';
        }
        var codes = ['USD', 'ARS', 'EUR', current].filter(function (c, i, all) { return all.indexOf(c) === i; });
        return '<select class="wo-select" name="currency">' + codes.map(function (c) {
            return '<option value="' + esc(c) + '"' + (c === current ? ' selected' : '') + '>' + esc(c) + '</option>';
        }).join('') + '</select>';
    }

    function selectOptions(options, value) {
        return options.map(function (o) {
            return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('');
    }

    function proposalPanel(state) {
        var model = M();
        var v = state.v;
        var hold = window.WoSlotHold && typeof window.WoSlotHold.respondFieldHtml === 'function' ? window.WoSlotHold.respondFieldHtml(state.quote) : '';
        var complexity = [{ value: '', label: 'Sin indicar' }].concat(model.COMPLEXITY_OPTIONS.map(function (c) { return { value: c, label: c }; }));
        var mins = [0, 15, 30, 45].map(function (m) { return { value: m, label: m + ' min' }; });
        return '<div class="qr-grid">'
            + field('Presupuesto', '<input class="wo-input" name="amount" inputmode="decimal" autocomplete="off" value="' + esc(v.amount) + '" placeholder="410.000" aria-describedby="qr-amount-help">', 'qr-col-2', 'qr-amount-help', '')
            + field('Moneda', currencyControl(v.currency))
            + field('Sesiones', '<input class="wo-input" name="sessions" type="number" inputmode="numeric" min="1" max="30" step="1" value="' + esc(v.sessions) + '">')
            + field('Horas por sesión', '<input class="wo-input" name="hours" type="number" inputmode="numeric" min="0" max="24" step="1" value="' + esc(v.hours) + '">')
            + field('Minutos', '<select class="wo-select" name="mins">' + selectOptions(mins, v.mins) + '</select>')
            + field('Anticipo (%)', '<input class="wo-input" name="deposit_pct" type="number" inputmode="decimal" min="0" max="100" step="1" value="' + esc(v.depositPct) + '" placeholder="Sin anticipo">')
            + field('Complejidad', '<select class="wo-select" name="complexity">' + selectOptions(complexity, v.complexity) + '</select>')
            + field('Estudio o ubicación', '<input class="wo-input" name="location" maxlength="' + model.MAX_LOCATION + '" autocomplete="off" value="' + esc(v.location) + '" placeholder="Estudio, barrio o ciudad">', 'qr-col-2')
            + '<div class="wo-field qr-col-2" role="group" aria-labelledby="qr-expiry-label">'
            + '<span class="wo-label" id="qr-expiry-label">Vencimiento de la propuesta</span>'
            + '<div class="qr-expiry">'
            + '<label class="qr-switch" for="qr-expiry-enabled"><span class="wo-toggle"><input type="checkbox" role="switch" id="qr-expiry-enabled" name="expiry_enabled" value="1"' + (v.expiryEnabled ? ' checked' : '') + ' aria-describedby="qr-expiry-help"><span class="knob" aria-hidden="true"></span></span><span>Activar</span></label>'
            + '<span class="qr-expiry-days"><input class="wo-input" id="qr-expiry-days" name="expiry_days" type="number" inputmode="numeric" min="1" max="365" step="1" value="' + esc(v.expiryDays) + '" aria-label="Días hasta el vencimiento"' + (v.expiryEnabled ? '' : ' disabled') + '><span aria-hidden="true">días</span></span>'
            + '</div><small class="qr-help" id="qr-expiry-help"></small></div>'
            + (hold ? '<div class="qr-col-4 qr-hold">' + hold + '</div>' : '')
            + '<div class="qr-col-4 qr-money" id="qr-money" aria-live="polite"></div>'
            + '</div>';
    }

    function availabilityPanel(state) {
        var model = M();
        return '<div class="qr-avail">'
            + '<div class="qr-cal-col">'
            + '<div class="qr-cal-head">'
            + '<button type="button" class="qr-icon-btn" data-qr-cal="prev" aria-label="Mes anterior"><span aria-hidden="true">‹</span></button>'
            + '<strong class="qr-cal-title" id="qr-cal-title" aria-live="polite"></strong>'
            + '<button type="button" class="qr-icon-btn" data-qr-cal="next" aria-label="Mes siguiente"><span aria-hidden="true">›</span></button>'
            + '</div>'
            + '<div class="qr-seg" role="radiogroup" aria-label="Qué quieres ofrecer">'
            + '<button type="button" role="radio" class="qr-seg-btn" data-qr-mode="slot" aria-checked="true">Turnos con horario</button>'
            + '<button type="button" role="radio" class="qr-seg-btn" data-qr-mode="range" aria-checked="false">Rango de fechas</button>'
            + '</div>'
            + '<div class="qr-cal" id="qr-cal"></div>'
            + '<ul class="qr-legend" aria-label="Referencias del calendario">'
            + '<li><span class="qr-dot qr-dot--free" aria-hidden="true"></span>Libre</li>'
            + '<li><span class="qr-dot qr-dot--partial" aria-hidden="true"></span>Con turnos tomados</li>'
            + '<li><span class="qr-dot qr-dot--busy" aria-hidden="true"></span>Ocupado</li>'
            + '<li><span class="qr-dot qr-dot--closed" aria-hidden="true"></span>Sin horario</li>'
            + '</ul>'
            + '<p class="qr-help" id="qr-cal-note"></p>'
            + '</div>'
            + '<div class="qr-day-col">'
            + '<div class="qr-day" id="qr-day"></div>'
            + '<div class="qr-offers-box">'
            + '<p class="wo-label">Fechas ofrecidas <span class="qr-count" id="qr-offers-count"></span></p>'
            + '<ul class="qr-offers" id="qr-offers"></ul>'
            + '</div>'
            + field('Nota de disponibilidad (opcional)', '<input class="wo-input" name="availability_note" maxlength="' + model.MAX_AVAILABILITY_NOTE + '" autocomplete="off" value="' + esc(state.v.availabilityNote) + '" placeholder="Prefiero turnos de tarde">')
            + '</div>'
            + '</div>';
    }

    function conditionsPanel(state) {
        var model = M();
        var v = state.v;
        return '<div class="qr-cond">'
            + '<div class="qr-breakdown" role="group" aria-labelledby="qr-breakdown-label">'
            + '<p class="wo-label" id="qr-breakdown-label">Desglose económico (opcional)</p>'
            + '<div class="qr-items-head" aria-hidden="true"><span>Concepto</span><span>Cant.</span><span>Precio</span><span>Total</span><span></span></div>'
            + '<div class="qr-items" id="qr-items"></div>'
            + '<div class="qr-quick" role="group" aria-label="Agregar un concepto">'
            + model.QUICK_CONCEPTS.map(function (c) {
                return '<button type="button" class="qr-chip" data-qr-concept="' + esc(c.label) + '">+ ' + esc(c.label) + '</button>';
            }).join('')
            + '<button type="button" class="qr-chip" data-qr-concept="">+ Otro concepto</button>'
            + '</div>'
            + '<div class="qr-breakdown-foot">'
            + field('Descuento (%)', '<input class="wo-input" name="discount_pct" type="number" inputmode="decimal" min="0" max="100" step="1" value="' + esc(v.discountPct || '') + '" placeholder="0">')
            + field('Impuestos (%)', '<input class="wo-input" name="tax_pct" type="number" inputmode="decimal" min="0" max="100" step="1" value="' + esc(v.taxPct || '') + '" placeholder="0">')
            + '<dl class="qr-totals" id="qr-totals" aria-live="polite"></dl>'
            + '</div>'
            + '</div>'
            + '<div class="qr-terms">'
            + field('Política de reserva y cancelación', '<select class="wo-select" name="policy">' + selectOptions(model.POLICY_OPTIONS, v.policy) + '</select>')
            + field('Notas para el cliente', '<textarea class="wo-textarea" name="client_notes" maxlength="' + model.MAX_LONG_TEXT + '" placeholder="Cuidados previos, qué traer el día de la sesión…">' + esc(v.clientNotes) + '</textarea>')
            + field('Términos adicionales', '<textarea class="wo-textarea" name="extra_terms" maxlength="' + model.MAX_LONG_TEXT + '" placeholder="Retoques, reprogramaciones, condiciones del diseño…">' + esc(v.extraTerms) + '</textarea>')
            + '</div>'
            + '</div>';
    }

    function messagePanel(state) {
        var model = M();
        var channel = state.quote.client_user_id
            ? 'Se envía por el chat de la cotización y acompaña el aviso por correo.'
            : 'El cliente todavía no tiene cuenta: verá el mensaje junto a la propuesta cuando entre a su panel.';
        return '<div class="qr-msg">'
            + '<div class="qr-msg-side">'
            + '<p class="wo-label" id="qr-templates-label">Respuestas rápidas</p>'
            + '<ul class="qr-templates" id="qr-templates" aria-labelledby="qr-templates-label"></ul>'
            + '<div class="qr-template-save">'
            + field('Guardar este mensaje como respuesta rápida', '<input class="wo-input" name="template_title" maxlength="' + model.MAX_TEMPLATE_TITLE + '" autocomplete="off" placeholder="Nombre de la respuesta">')
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-qr-template-save>Guardar</button>'
            + '<p class="qr-help" id="qr-template-status" role="status"></p>'
            + '</div>'
            + '</div>'
            + '<div class="qr-msg-main">'
            + field('Mensaje para el cliente (opcional)', '<textarea class="wo-textarea" id="qr-message" name="message" maxlength="' + model.MAX_MESSAGE + '" placeholder="Cuéntale cómo vas a encarar el diseño." aria-describedby="qr-message-help">' + esc(state.v.message) + '</textarea>', '', 'qr-message-help', channel)
            + '<div class="qr-vars" role="group" aria-label="Insertar una variable en el mensaje">'
            + model.VARIABLES.map(function (variable) {
                return '<button type="button" class="qr-chip qr-chip--var" data-qr-var="' + esc(variable.key) + '" title="' + esc(variable.hint) + '">{{' + esc(variable.key) + '}}</button>';
            }).join('')
            + '</div>'
            + '<div class="qr-preview"><p class="wo-label">Vista previa de lo que recibe el cliente</p>'
            + '<p class="qr-preview-text" id="qr-preview" aria-live="polite"></p>'
            + '<small class="qr-help" id="qr-preview-note"></small></div>'
            + '</div>'
            + '</div>';
    }

    function shellHtml(state) {
        var q = state.quote;
        var copy = TITLES[state.mode] || TITLES.respond;
        var panels = { propuesta: proposalPanel, disponibilidad: availabilityPanel, condiciones: conditionsPanel, mensaje: messagePanel };
        return '<form class="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title" aria-describedby="qr-intro" novalidate>'
            + '<header class="qr-head">'
            + '<div class="qr-head-copy">'
            + '<p class="qr-eyebrow">' + esc((q.quote_id || 'COT-' + q.id) + (q.client_full_name ? ' · ' + q.client_full_name : '')) + '</p>'
            + '<h2 class="qr-title" id="qr-title">' + esc(copy[0]) + '</h2>'
            + '<p class="qr-intro" id="qr-intro">' + esc(copy[1]) + '</p>'
            + '</div>'
            + '<button type="button" class="qr-close" data-qr-close aria-label="Cerrar">' + closeGlyph() + '</button>'
            + '</header>'
            + '<div class="qr-tabs" role="tablist" aria-label="Secciones de la propuesta">'
            + TABS.map(function (tab, i) {
                return '<button type="button" class="qr-tab" role="tab" id="qr-tab-' + tab.key + '" aria-controls="qr-panel-' + tab.key + '" data-qr-tab="' + tab.key + '">'
                    + '<span class="qr-tab-n" aria-hidden="true">' + (i + 1) + '</span>' + esc(tab.label) + '<span class="qr-tab-flag" data-qr-flag="' + tab.key + '" hidden></span></button>';
            }).join('')
            + '</div>'
            + '<div class="qr-body">'
            + TABS.map(function (tab) {
                return '<section class="qr-panel" role="tabpanel" id="qr-panel-' + tab.key + '" aria-labelledby="qr-tab-' + tab.key + '" tabindex="-1" hidden>' + panels[tab.key](state) + '</section>';
            }).join('')
            + '</div>'
            + '<footer class="qr-foot">'
            + '<p class="qr-summary" id="qr-summary" aria-live="polite"></p>'
            + '<p class="qr-error" id="qr-error" role="alert" hidden></p>'
            + '<div class="qr-foot-actions">'
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-qr-close>Cancelar</button>'
            + '<button type="submit" class="wo-btn wo-btn--accent wo-btn--s" id="qr-submit">' + esc(copy[2]) + '</button>'
            + '</div>'
            + '</footer>'
            + '</form>';
    }

    /* ---------------------------------- regiones ---------------------------------- */
    function $(selector) { return active ? active.overlay.querySelector(selector) : null; }
    function $all(selector) { return active ? Array.prototype.slice.call(active.overlay.querySelectorAll(selector)) : []; }

    function setError(message) {
        var el = $('#qr-error');
        if (!el) return;
        el.textContent = message || '';
        el.hidden = !message;
    }

    function renderTabs() {
        var state = active.state;
        TABS.forEach(function (tab) {
            var on = tab.key === state.tab;
            var button = $('#qr-tab-' + tab.key);
            var panel = $('#qr-panel-' + tab.key);
            if (button) {
                button.setAttribute('aria-selected', on ? 'true' : 'false');
                button.tabIndex = on ? 0 : -1;
                button.classList.toggle('is-active', on);
            }
            if (panel) panel.hidden = !on;
        });
        var offers = $('[data-qr-flag="disponibilidad"]');
        if (offers) {
            offers.hidden = !state.offered.length;
            offers.textContent = state.offered.length ? String(state.offered.length) : '';
        }
        if (state.tab === 'disponibilidad') ensureCalendar();
    }

    function setTab(key, focus) {
        if (!active || !TABS.some(function (t) { return t.key === key; })) return;
        active.state.tab = key;
        renderTabs();
        if (focus) { var button = $('#qr-tab-' + key); if (button) button.focus(); }
    }

    function renderMoney() {
        var state = active.state;
        var model = M();
        var t = totalsOf(state);
        var amountInput = $('[name="amount"]');
        var help = $('#qr-amount-help');
        if (amountInput) {
            amountInput.readOnly = t.priced;
            amountInput.classList.toggle('is-computed', t.priced);
            if (t.priced) {
                amountInput.value = model.formatAmount(t.totals.total);
                state.v.amount = amountInput.value;
            }
        }
        if (help) help.textContent = t.priced ? 'Calculado desde el desglose económico (pestaña Condiciones).' : '';
        var box = $('#qr-money');
        if (box) {
            var currency = esc(state.v.currency);
            var cell = function (label, value, strong) {
                return '<div class="qr-money-cell' + (strong ? ' is-strong' : '') + '"><span class="wo-label">' + esc(label) + '</span><strong>' + value + '</strong></div>';
            };
            box.innerHTML = cell('Total propuesto', t.amount != null ? esc(model.formatAmount(t.amount)) + ' ' + currency : '—', true)
                + cell('Anticipo para reservar', t.deposit != null ? esc(model.formatAmount(t.deposit)) + ' ' + currency + ' · ' + esc(String(t.depositPct).replace('.', ',')) + ' %' : 'Sin anticipo')
                + cell('Saldo', t.balance != null ? esc(model.formatAmount(t.balance)) + ' ' + currency : '—')
                + '<p class="qr-money-note">El saldo acordado se activa cuando el cliente aprueba la propuesta, no antes.</p>';
        }
        var summary = $('#qr-summary');
        if (summary) {
            var parts = [];
            if (t.amount != null) parts.push('Total ' + model.formatAmount(t.amount) + ' ' + state.v.currency);
            parts.push(t.deposit != null ? 'Anticipo ' + String(t.depositPct).replace('.', ',') + ' %' : 'Sin anticipo');
            var sessions = model.sessionsText(state.v.sessions);
            var duration = model.durationText(minutesOf(state));
            if (sessions) parts.push(sessions + (duration ? ' de ' + duration : ''));
            parts.push(state.offered.length ? state.offered.length + (state.offered.length === 1 ? ' fecha ofrecida' : ' fechas ofrecidas') : 'Sin fechas ofrecidas');
            summary.textContent = parts.join(' · ');
        }
    }

    function renderExpiry() {
        var state = active.state;
        var days = $('#qr-expiry-days');
        var help = $('#qr-expiry-help');
        if (days) {
            days.disabled = !state.v.expiryEnabled;
            if (state.v.expiryEnabled && !String(state.v.expiryDays == null ? '' : state.v.expiryDays).trim()) {
                state.v.expiryDays = (window.WoQuotationsViewModel && window.WoQuotationsViewModel.DEFAULT_VALIDITY_DAYS) || 14;
                days.value = state.v.expiryDays;
            }
        }
        if (help) {
            help.textContent = state.v.expiryEnabled
                ? 'Si el cliente no responde en ese plazo, la propuesta vence y le avisamos.'
                : 'Apagado: la propuesta no vence.';
        }
    }

    /* --------------------------------- calendario --------------------------------- */
    function monthOf(date) { return String(date).slice(0, 7); }
    function monthStart(month) { return month + '-01'; }
    function monthEnd(month) {
        var p = month.split('-').map(Number);
        return month + '-' + pad(new Date(Date.UTC(p[0], p[1], 0)).getUTCDate());
    }
    function shiftMonth(month, delta) {
        var p = month.split('-').map(Number);
        var d = new Date(Date.UTC(p[0], p[1] - 1 + delta, 1));
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
    }
    function maxMonth(state) { return monthOf(B().addDays(state.today, M().HORIZON_DAYS)); }

    function dayStatus(state, date) {
        if (date < state.today) return 'past';
        var day = state.cal.data[date];
        return day ? day.status : '';
    }

    function offersOn(state, date) {
        var tz = state.tz;
        return state.offered.filter(function (offer) {
            if (offer.kind === 'range') return date >= offer.from && date <= offer.to;
            return B().zonedDate(offer.start, tz) === date;
        });
    }

    function renderCalendar() {
        if (!active) return;
        var state = active.state;
        var model = M();
        var cal = state.cal;
        var title = $('#qr-cal-title');
        if (title) title.textContent = model.monthLabel(cal.month);
        var prev = $('[data-qr-cal="prev"]');
        var next = $('[data-qr-cal="next"]');
        if (prev) prev.disabled = cal.month <= monthOf(state.today);
        if (next) next.disabled = cal.month >= maxMonth(state);
        $all('[data-qr-mode]').forEach(function (button) {
            var on = button.getAttribute('data-qr-mode') === cal.mode;
            button.setAttribute('aria-checked', on ? 'true' : 'false');
            button.tabIndex = on ? 0 : -1;
            button.classList.toggle('is-on', on);
        });
        var grid = $('#qr-cal');
        if (!grid) return;
        var first = monthStart(cal.month);
        var last = monthEnd(cal.month);
        var lead = B().weekdayIndex(first);
        var cells = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(function (d) {
            return '<span class="qr-cal-wd" aria-hidden="true">' + d + '</span>';
        });
        for (var i = 0; i < lead; i++) cells.push('<span class="qr-cal-blank" aria-hidden="true"></span>');
        var focusDate = cal.selected && monthOf(cal.selected) === cal.month ? cal.selected : '';
        var firstEnabled = '';
        for (var date = first; date <= last; date = B().addDays(date, 1)) {
            var status = dayStatus(state, date);
            var day = cal.data[date];
            var offers = offersOn(state, date);
            var disabled = status === 'past' || !status || (cal.mode === 'range' && status === 'busy');
            if (!disabled && !firstEnabled) firstEnabled = date;
            var classes = ['qr-cal-day', status ? 'is-' + status : 'is-loading'];
            if (offers.length) classes.push('has-offer');
            if (cal.mode === 'slot' && cal.selected === date) classes.push('is-selected');
            if (cal.mode === 'range' && cal.rangeStart === date) classes.push('is-selected');
            if (date === state.today) classes.push('is-today');
            var label = model.dayLabelLong(date) + (status ? ', ' + STATUS_TEXT[status] : ', cargando');
            if (day && status !== 'past' && day.slots && day.slots.length) label += ', ' + day.slots.length + (day.slots.length === 1 ? ' turno sugerido' : ' turnos sugeridos');
            if (offers.length) label += ', ya ofrecido';
            cells.push('<button type="button" class="' + classes.join(' ') + '" data-qr-date="' + date + '" aria-label="' + esc(label) + '"'
                + ' aria-pressed="' + (classes.indexOf('is-selected') !== -1 ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') + ' tabindex="-1">'
                + '<span class="qr-cal-num">' + Number(date.slice(8)) + '</span>'
                + (offers.length ? '<span class="qr-cal-mark" aria-hidden="true"></span>' : '') + '</button>');
        }
        grid.innerHTML = cells.join('');
        grid.setAttribute('aria-busy', cal.loading ? 'true' : 'false');
        var tabbable = grid.querySelector('[data-qr-date="' + (focusDate || firstEnabled) + '"]:not([disabled])') || grid.querySelector('.qr-cal-day:not([disabled])');
        if (tabbable) tabbable.tabIndex = 0;

        var note = $('#qr-cal-note');
        if (note) {
            var bits = [];
            if (cal.error) bits.push(cal.error);
            else if (cal.loading) bits.push('Consultando tu agenda…');
            else {
                bits.push('Horarios en tu zona horaria (' + state.tz.replace(/_/g, ' ') + ').');
                if (state.schedule === 'default') bits.push('Todavía no guardaste tu horario semanal: usamos una jornada de 09:00 a 21:00. Configúralo en Cuenta → Disponibilidad.');
            }
            note.innerHTML = esc(bits.join(' ')) + (cal.error ? ' <button type="button" class="qr-link" data-qr-cal="retry">Reintentar</button>' : '');
            note.classList.toggle('is-error', !!cal.error);
        }
        renderDay();
    }

    function slotKey(start, end) { return start + '|' + end; }

    function renderDay() {
        if (!active) return;
        var state = active.state;
        var model = M();
        var cal = state.cal;
        var box = $('#qr-day');
        if (!box) return;
        var notice = cal.notice ? '<p class="qr-notice" role="status">' + esc(cal.notice) + '</p>' : '';
        if (cal.mode === 'range') {
            var copy = cal.rangeStart
                ? 'Desde ' + model.dayLabel(cal.rangeStart) + '. Ahora elige el último día del rango.'
                : 'Elige en el calendario el primer día del rango y después el último. Los días ocupados quedan fuera.';
            box.innerHTML = '<p class="qr-day-title">Rango de fechas</p><p class="qr-day-copy">' + esc(copy) + '</p>'
                + (cal.rangeStart ? '<div class="qr-day-actions"><button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-qr-range="single">Ofrecer solo ese día</button>'
                    + '<button type="button" class="qr-link" data-qr-range="cancel">Cancelar</button></div>' : '')
                + notice;
            return;
        }
        if (!cal.selected) {
            box.innerHTML = '<p class="qr-day-title">Turnos con horario</p><p class="qr-day-copy">Elige un día del calendario para ver tus turnos libres y ofrecerlos.</p>' + notice;
            return;
        }
        var day = cal.data[cal.selected];
        if (!day) {
            box.innerHTML = '<p class="qr-day-title">' + esc(model.dayLabel(cal.selected)) + '</p><p class="qr-day-copy">Consultando tu agenda…</p>';
            return;
        }
        var offered = {};
        state.offered.forEach(function (offer) { if (offer.kind !== 'range') offered[slotKey(offer.start, offer.end)] = true; });
        var chips = (day.slots || []).map(function (slot) {
            var on = !!offered[slotKey(slot.start, slot.end)];
            return '<button type="button" class="qr-chip qr-chip--slot' + (on ? ' is-on' : '') + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
                + ' data-qr-slot="' + esc(slot.start) + '" data-qr-slot-end="' + esc(slot.end) + '">' + esc(slot.label) + '</button>';
        }).join('');
        var busy = (day.busy || []).map(function (b) { return '<li>' + esc(b.label) + '</li>'; }).join('');
        var headline = model.dayLabel(cal.selected) + (day.open ? ' · horario ' + day.open : '');
        var empty = day.status === 'busy'
            ? 'Este día ya está ocupado en tu agenda.'
            : 'No hay turnos sugeridos para este día. Puedes agregar un horario a mano.';
        box.innerHTML = '<p class="qr-day-title">' + esc(headline) + '</p>'
            + (chips ? '<div class="qr-chips" role="group" aria-label="Turnos libres del ' + esc(model.dayLabel(cal.selected)) + '">' + chips + '</div>' : '<p class="qr-day-copy">' + esc(empty) + '</p>')
            + '<div class="qr-custom" role="group" aria-label="Agregar un horario a mano">'
            + '<label class="qr-custom-field"><span class="wo-label">Desde</span><input class="wo-input" type="time" name="custom_start" step="900"></label>'
            + '<label class="qr-custom-field"><span class="wo-label">Hasta</span><input class="wo-input" type="time" name="custom_end" step="900"></label>'
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-qr-add-custom>Agregar horario</button>'
            + '</div>'
            + (cal.dayError ? '<p class="qr-field-error" role="alert">' + esc(cal.dayError) + '</p>' : '')
            + (busy ? '<div class="qr-busy"><p class="wo-label">Ya confirmado ese día</p><ul>' + busy + '</ul></div>' : '')
            + notice;
    }

    function renderOffers() {
        if (!active) return;
        var state = active.state;
        var model = M();
        var list = $('#qr-offers');
        var count = $('#qr-offers-count');
        if (count) count.textContent = state.offered.length + '/' + model.MAX_OFFERS;
        if (list) {
            list.innerHTML = state.offered.length ? state.offered.map(function (offer, index) {
                var label = model.offerLabel(offer, state.tz);
                var reason = state.conflicts[model.offerKey(offer)] || '';
                return '<li class="qr-offer' + (reason ? ' is-conflict' : '') + '">'
                    + '<span class="qr-offer-kind">' + (offer.kind === 'range' ? 'Rango' : 'Turno') + '</span>'
                    + '<span class="qr-offer-label">' + esc(label) + (reason ? '<small>' + esc(reason) + '</small>' : '') + '</span>'
                    + '<button type="button" class="qr-offer-remove" data-qr-remove="' + index + '" aria-label="Quitar ' + esc(label) + '">' + closeGlyph() + '</button>'
                    + '</li>';
            }).join('') : '<li class="qr-offer qr-offer--empty">Todavía no ofreciste fechas. Puedes enviar la propuesta sin fechas y coordinarlas después.</li>';
        }
        renderMoney();
        renderPreview();
        renderTabsFlag();
    }

    function renderTabsFlag() {
        var state = active.state;
        var flag = $('[data-qr-flag="disponibilidad"]');
        if (!flag) return;
        flag.hidden = !state.offered.length;
        flag.textContent = state.offered.length ? String(state.offered.length) : '';
    }

    function sortOffers(state) {
        var tz = state.tz;
        var startOf = function (offer) {
            return offer.kind === 'range' ? B().wallToUtc(offer.from, 0, tz) : Date.parse(offer.start);
        };
        state.offered.sort(function (a, b) { return startOf(a) - startOf(b); });
    }

    function addOffer(offer) {
        var state = active.state;
        var model = M();
        var key = model.offerKey(offer);
        if (state.offered.some(function (o) { return model.offerKey(o) === key; })) return 'duplicate';
        if (state.offered.length >= model.MAX_OFFERS) {
            state.cal.notice = 'Puedes ofrecer hasta ' + model.MAX_OFFERS + ' fechas. Quita alguna para sumar otra.';
            return 'full';
        }
        state.offered.push(offer);
        sortOffers(state);
        state.dirty = true;
        return 'added';
    }

    function removeOffer(index) {
        var state = active.state;
        var removed = state.offered.splice(index, 1)[0];
        if (removed) delete state.conflicts[M().offerKey(removed)];
        state.dirty = true;
        state.cal.notice = '';
        renderCalendar();
        renderOffers();
    }

    function monthKey(state, month) { return month + ':' + minutesOf(state); }

    function loadMonth(month) {
        var state = active.state;
        var repo = Repo();
        var key = monthKey(state, month);
        if (state.cal.loaded[key]) return Promise.resolve(true);
        var from = monthStart(month) < state.today ? state.today : monthStart(month);
        var to = monthEnd(month);
        if (to < from) { state.cal.loaded[key] = true; return Promise.resolve(true); }
        var session = active;
        return repo.availability(state.quote.quote_id || state.quote.id, { from: from, to: to, minutes: minutesOf(state) }).then(function (res) {
            if (active !== session) return false;
            if (res.timezone && B().validTimeZone(res.timezone)) state.tz = res.timezone;
            if (res.today) state.today = res.today;
            state.schedule = res.schedule || 'own';
            (res.days || []).forEach(function (day) { state.cal.data[day.date] = day; });
            state.cal.loaded[key] = true;
            return true;
        });
    }

    function ensureCalendar() {
        if (!active) return;
        var state = active.state;
        var cal = state.cal;
        if (!cal.month) cal.month = monthOf(state.today);
        if (cal.month < monthOf(state.today)) cal.month = monthOf(state.today);
        if (cal.loaded[monthKey(state, cal.month)] || cal.loading) { renderCalendar(); renderOffers(); return; }
        cal.loading = true;
        cal.error = '';
        renderCalendar();
        var session = active;
        loadMonth(cal.month).then(function () {
            if (active !== session) return;
            cal.loading = false;
            if (cal.month < monthOf(state.today)) cal.month = monthOf(state.today);
            // El artista cambió de mes (o de duración) mientras cargaba: se pide lo que falta.
            if (!cal.loaded[monthKey(state, cal.month)]) { ensureCalendar(); return; }
            renderCalendar();
            renderOffers();
        }).catch(function (error) {
            if (active !== session) return;
            cal.loading = false;
            cal.error = (error && error.userMessage) || 'No pudimos consultar tu agenda.';
            renderCalendar();
        });
    }

    function pickDate(date) {
        var state = active.state;
        var model = M();
        var cal = state.cal;
        cal.notice = '';
        cal.dayError = '';
        if (cal.mode === 'slot') {
            cal.selected = date;
            renderCalendar();
            return;
        }
        if (!cal.rangeStart) {
            cal.rangeStart = date;
            renderCalendar();
            return;
        }
        var from = cal.rangeStart < date ? cal.rangeStart : date;
        var to = cal.rangeStart < date ? date : cal.rangeStart;
        if (model.daysBetween(from, to) + 1 > model.MAX_RANGE_DAYS) {
            cal.notice = 'Un rango admite hasta ' + model.MAX_RANGE_DAYS + ' días. Elige un último día más cercano.';
            renderCalendar();
            return;
        }
        commitRange(from, to);
    }

    function commitRange(from, to) {
        var state = active.state;
        var model = M();
        var cal = state.cal;
        var session = active;
        var months = [];
        for (var m = monthOf(from); m <= monthOf(to); m = shiftMonth(m, 1)) months.push(m);
        cal.loading = true;
        renderCalendar();
        Promise.all(months.map(loadMonth)).then(function () {
            if (active !== session) return;
            cal.loading = false;
            var split = model.splitRange(from, to, function (date) { return dayStatus(state, date); });
            var added = 0;
            split.ranges.forEach(function (range) { if (addOffer(range) === 'added') added += 1; });
            cal.rangeStart = '';
            if (!split.ranges.length) cal.notice = 'Todos los días de ese rango ya están ocupados en tu agenda.';
            else if (split.skipped.length) {
                var names = split.skipped.slice(0, 4).map(function (d) { return model.rangeLabel(d, d).replace(/ \d{4}$/, ''); });
                cal.notice = 'Dejamos fuera los días ocupados: ' + names.join(', ') + (split.skipped.length > 4 ? ' y ' + (split.skipped.length - 4) + ' más' : '') + '.';
            } else if (!added && !cal.notice) cal.notice = 'Ese rango ya estaba en tu lista.';
            renderCalendar();
            renderOffers();
        }).catch(function (error) {
            if (active !== session) return;
            cal.loading = false;
            cal.rangeStart = '';
            cal.notice = (error && error.userMessage) || 'No pudimos consultar tu agenda para ese rango.';
            renderCalendar();
        });
    }

    function toggleSlot(start, end) {
        var state = active.state;
        var model = M();
        var key = model.offerKey({ kind: 'slot', start: start, end: end });
        var index = state.offered.findIndex(function (offer) { return model.offerKey(offer) === key; });
        state.cal.notice = '';
        state.cal.dayError = '';
        if (index !== -1) { removeOffer(index); return; }
        addOffer({ kind: 'slot', start: start, end: end });
        renderCalendar();
        renderOffers();
    }

    function addCustomSlot() {
        var state = active.state;
        var model = M();
        var cal = state.cal;
        var startInput = $('[name="custom_start"]');
        var endInput = $('[name="custom_end"]');
        var parse = function (value) {
            var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
            return m ? Number(m[1]) * 60 + Number(m[2]) : null;
        };
        var from = parse(startInput && startInput.value);
        var to = parse(endInput && endInput.value);
        cal.notice = '';
        if (from == null) { cal.dayError = 'Indica desde qué hora ofreces el turno.'; renderDay(); refocus('custom_start'); return; }
        if (to == null) to = from + minutesOf(state);
        if (to <= from) { cal.dayError = 'El horario tiene que terminar después de empezar.'; renderDay(); refocus('custom_end'); return; }
        if (to > 24 * 60) to = 24 * 60;
        var start = new Date(B().wallToUtc(cal.selected, from, state.tz)).toISOString();
        var end = new Date(B().wallToUtc(cal.selected, to, state.tz)).toISOString();
        var checked = model.normalizeOffer({ kind: 'slot', start: start, end: end }, { tz: state.tz, now: Date.now() });
        if (!checked.ok) { cal.dayError = checked.error; renderDay(); refocus('custom_start'); return; }
        var day = cal.data[cal.selected];
        var clash = ((day && day.busy) || []).find(function (b) { return Date.parse(start) < Date.parse(b.end) && Date.parse(end) > Date.parse(b.start); });
        if (clash) { cal.dayError = 'Ese horario se superpone con algo confirmado: ' + clash.label + '.'; renderDay(); refocus('custom_start'); return; }
        cal.dayError = '';
        var result = addOffer({ kind: 'slot', start: checked.value.start, end: checked.value.end });
        if (result === 'duplicate') cal.notice = 'Ese horario ya estaba en tu lista.';
        renderCalendar();
        renderOffers();
    }

    function refocus(name) {
        var el = $('[name="' + name + '"]');
        if (el) el.focus();
    }

    /* --------------------------------- condiciones --------------------------------- */
    function itemRowHtml(item) {
        var model = M();
        var total = model.cleanItems([item])[0];
        var amount = total ? Math.round(total.qty * total.price * 100) / 100 : 0;
        return '<div class="qr-item" data-qr-item="' + esc(item.id) + '">'
            + '<input class="wo-input" name="item_name" maxlength="120" autocomplete="off" value="' + esc(item.name) + '" placeholder="Concepto" aria-label="Concepto">'
            + '<input class="wo-input" name="item_qty" type="number" inputmode="numeric" min="0" max="9999" step="1" value="' + esc(item.qty) + '" aria-label="Cantidad">'
            + '<input class="wo-input" name="item_price" inputmode="decimal" autocomplete="off" value="' + esc(item.price) + '" placeholder="0" aria-label="Precio unitario">'
            + '<span class="qr-item-total" data-qr-item-total>' + esc(amount ? model.formatAmount(amount) : '—') + '</span>'
            + '<button type="button" class="qr-offer-remove" data-qr-item-remove aria-label="Quitar el concepto ' + esc(item.name || 'sin nombre') + '">' + closeGlyph() + '</button>'
            + '</div>';
    }

    function renderItems() {
        var state = active.state;
        var box = $('#qr-items');
        if (!box) return;
        box.innerHTML = state.items.length
            ? state.items.map(itemRowHtml).join('')
            : '<p class="qr-day-copy">Sin desglose: el cliente ve solo el total. Suma conceptos si quieres detallar el precio.</p>';
        renderTotals();
    }

    function renderTotals() {
        var state = active.state;
        var model = M();
        var t = totalsOf(state);
        var box = $('#qr-totals');
        if (box) {
            var currency = ' ' + esc(state.v.currency);
            var row = function (label, value, strong) {
                return '<div class="' + (strong ? 'is-strong' : '') + '"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>';
            };
            box.innerHTML = t.priced
                ? row('Subtotal', esc(model.formatAmount(t.totals.subtotal)) + currency)
                    + (t.totals.discount ? row('Descuento', '− ' + esc(model.formatAmount(t.totals.discount)) + currency) : '')
                    + (t.totals.tax ? row('Impuestos', esc(model.formatAmount(t.totals.tax)) + currency) : '')
                    + row('Total', esc(model.formatAmount(t.totals.total)) + currency, true)
                : row('Total', t.amount != null ? esc(model.formatAmount(t.amount)) + currency : '—', true);
        }
        $all('[data-qr-item]').forEach(function (rowEl) {
            var item = state.items.find(function (it) { return it.id === rowEl.getAttribute('data-qr-item'); });
            var cell = rowEl.querySelector('[data-qr-item-total]');
            if (!item || !cell) return;
            var clean = model.cleanItems([item])[0];
            var amount = clean ? Math.round(clean.qty * clean.price * 100) / 100 : 0;
            cell.textContent = amount ? model.formatAmount(amount) : '—';
        });
        renderMoney();
        renderPreview();
    }

    function addItem(name) {
        var state = active.state;
        var model = M();
        if (state.items.length >= model.MAX_ITEMS) { setError('El desglose admite hasta ' + model.MAX_ITEMS + ' conceptos.'); return; }
        // El primer concepto arranca con el presupuesto ya escrito.
        var seed = '';
        if (!state.items.length) {
            var amount = model.parseMoney(state.v.amount);
            if (Number.isFinite(amount) && amount > 0) seed = model.formatAmount(amount);
        }
        var created = toItems([{ name: name || '', qty: 1, price: seed }])[0];
        state.items.push(created);
        state.dirty = true;
        renderItems();
        var row = $('[data-qr-item="' + created.id + '"]');
        var input = row && row.querySelector(name ? '[name="item_price"]' : '[name="item_name"]');
        if (input) { input.focus(); if (input.select) input.select(); }
    }

    /* ----------------------------------- mensaje ----------------------------------- */
    function allTemplates(state) {
        return M().DEFAULT_TEMPLATES.map(function (t) { return { id: t.id, title: t.title, body: t.body, builtin: true }; })
            .concat(state.templates.saved.map(function (t) { return { id: String(t.id), title: t.title, body: t.body, builtin: false }; }));
    }

    function renderTemplates() {
        if (!active) return;
        var state = active.state;
        var list = $('#qr-templates');
        if (list) {
            list.innerHTML = allTemplates(state).map(function (t) {
                var confirm = state.templates.confirmDelete === t.id;
                return '<li class="qr-template">'
                    + '<button type="button" class="qr-template-use" data-qr-template="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong><span>' + esc(t.body.slice(0, 84)) + (t.body.length > 84 ? '…' : '') + '</span></button>'
                    + (t.builtin ? '' : '<button type="button" class="qr-link' + (confirm ? ' is-danger' : '') + '" data-qr-template-delete="' + esc(t.id) + '" aria-label="' + esc((confirm ? 'Confirmar: eliminar ' : 'Eliminar ') + t.title) + '">' + (confirm ? 'Confirmar' : 'Eliminar') + '</button>')
                    + '</li>';
            }).join('');
        }
        var status = $('#qr-template-status');
        if (status) {
            status.textContent = state.templates.status
                || (state.templates.available === false ? 'Guardar respuestas propias todavía no está disponible. Puedes usar las sugeridas.' : '');
        }
        var save = $('[data-qr-template-save]');
        if (save) save.disabled = state.templates.available === false;
    }

    function renderPreview() {
        if (!active) return;
        var state = active.state;
        var model = M();
        var box = $('#qr-preview');
        var note = $('#qr-preview-note');
        if (!box) return;
        var raw = String(state.v.message || '');
        if (!raw.trim()) {
            box.textContent = 'Sin mensaje: el cliente recibe solo la propuesta.';
            box.classList.add('is-empty');
            if (note) note.textContent = '';
            return;
        }
        var resolved = model.resolveTemplate(raw, variables(state));
        box.textContent = resolved.text;
        box.classList.remove('is-empty');
        if (note) {
            var bits = [];
            if (resolved.unknown.length) bits.push('No reconocemos ' + resolved.unknown.join(', ') + ': corrígelas o quítalas para poder enviar.');
            if (resolved.empty.length) bits.push('Sin valor todavía: ' + resolved.empty.map(function (k) { return '{{' + k + '}}'; }).join(', ') + '.');
            bits.push(resolved.text.length + '/' + model.MAX_MESSAGE + ' caracteres');
            note.textContent = bits.join(' ');
            note.classList.toggle('is-error', resolved.text.length > model.MAX_MESSAGE || resolved.unknown.length > 0);
        }
    }

    function useTemplate(id) {
        var state = active.state;
        var template = allTemplates(state).find(function (t) { return t.id === id; });
        var area = $('#qr-message');
        if (!template || !area) return;
        var current = area.value.trim();
        var next = current ? current + '\n\n' + template.body : template.body;
        area.value = next.slice(0, M().MAX_MESSAGE);
        state.v.message = area.value;
        state.dirty = true;
        renderPreview();
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
    }

    function insertVariable(key) {
        var state = active.state;
        var area = $('#qr-message');
        if (!area) return;
        var result = M().insertVariable(area.value, key, area.selectionStart, area.selectionEnd);
        if (result.text.length > M().MAX_MESSAGE) return;
        area.value = result.text;
        state.v.message = result.text;
        state.dirty = true;
        area.focus();
        area.setSelectionRange(result.caret, result.caret);
        renderPreview();
    }

    function saveTemplate() {
        var state = active.state;
        var model = M();
        var repo = Repo();
        var titleInput = $('[name="template_title"]');
        var checked = model.validateTemplate({ title: titleInput && titleInput.value, body: state.v.message });
        if (!checked.ok) {
            state.templates.status = checked.errors.title || checked.errors.body;
            renderTemplates();
            if (checked.errors.title && titleInput) titleInput.focus();
            return;
        }
        if (state.templates.saved.length >= model.MAX_TEMPLATES) {
            state.templates.status = 'Puedes guardar hasta ' + model.MAX_TEMPLATES + ' respuestas rápidas. Elimina alguna para sumar otra.';
            renderTemplates();
            return;
        }
        var session = active;
        state.templates.status = 'Guardando…';
        renderTemplates();
        repo.saveTemplate(state.ctx.user.id, { title: checked.value.title, body: checked.value.body, sort: state.templates.saved.length + 1 }).then(function (row) {
            if (active !== session) return;
            state.templates.saved.push(row);
            state.templates.status = 'Respuesta rápida guardada.';
            if (titleInput) titleInput.value = '';
            renderTemplates();
        }).catch(function (error) {
            if (active !== session) return;
            if (repo.isMissingSchema(error)) state.templates.available = false;
            state.templates.status = repo.isMissingSchema(error) ? '' : 'No pudimos guardar la respuesta rápida. Intenta de nuevo.';
            renderTemplates();
        });
    }

    function deleteTemplate(id) {
        var state = active.state;
        if (state.templates.confirmDelete !== id) {
            state.templates.confirmDelete = id;
            renderTemplates();
            var again = $('[data-qr-template-delete="' + sel(id) + '"]');
            if (again) again.focus();
            return;
        }
        var session = active;
        state.templates.confirmDelete = null;
        Repo().deleteTemplate(id).then(function () {
            if (active !== session) return;
            state.templates.saved = state.templates.saved.filter(function (t) { return String(t.id) !== id; });
            state.templates.status = 'Respuesta rápida eliminada.';
            renderTemplates();
        }).catch(function () {
            if (active !== session) return;
            state.templates.status = 'No pudimos eliminar la respuesta rápida.';
            renderTemplates();
        });
    }

    /* ---------------------------------- eventos ---------------------------------- */
    var FIELD_STATE = {
        amount: 'amount', currency: 'currency', sessions: 'sessions', hours: 'hours', mins: 'mins', deposit_pct: 'depositPct',
        complexity: 'complexity', location: 'location', expiry_days: 'expiryDays', availability_note: 'availabilityNote',
        discount_pct: 'discountPct', tax_pct: 'taxPct', policy: 'policy', client_notes: 'clientNotes', extra_terms: 'extraTerms',
        message: 'message'
    };
    var durationTimer = null;

    function onInput(event) {
        if (!active) return;
        var state = active.state;
        var target = event.target;
        var name = target.name;
        if (!name) return;
        setError('');
        if (name === 'item_name' || name === 'item_qty' || name === 'item_price') {
            var row = target.closest('[data-qr-item]');
            var item = row && state.items.find(function (it) { return it.id === row.getAttribute('data-qr-item'); });
            if (!item) return;
            item[name === 'item_name' ? 'name' : name === 'item_qty' ? 'qty' : 'price'] = target.value;
            state.dirty = true;
            renderTotals();
            return;
        }
        if (name === 'expiry_enabled') {
            state.v.expiryEnabled = !!target.checked;
            state.touched.expiry = true;
            state.dirty = true;
            renderExpiry();
            return;
        }
        var key = FIELD_STATE[name];
        if (!key) return;
        state.v[key] = target.value;
        state.touched[key] = true;
        state.dirty = true;
        target.removeAttribute('aria-invalid');
        if (name === 'hours' || name === 'mins') {
            // Los turnos sugeridos dependen de la duración: se vuelve a pedir la agenda.
            window.clearTimeout(durationTimer);
            durationTimer = window.setTimeout(function () { if (active && active.state === state && state.tab === 'disponibilidad') ensureCalendar(); }, 400);
        }
        if (name === 'message') { renderPreview(); return; }
        if (name === 'discount_pct' || name === 'tax_pct' || name === 'currency') { renderTotals(); return; }
        renderMoney();
        renderPreview();
    }

    function onClick(event) {
        if (!active) return;
        var state = active.state;
        var target = event.target.closest('button');
        if (!target || !active.overlay.contains(target)) return;
        if (target.hasAttribute('data-qr-close')) { close(); return; }
        if (target.hasAttribute('data-qr-tab')) { setTab(target.getAttribute('data-qr-tab')); return; }
        if (target.hasAttribute('data-qr-cal')) {
            var action = target.getAttribute('data-qr-cal');
            if (action === 'retry') { state.cal.error = ''; ensureCalendar(); return; }
            state.cal.month = shiftMonth(state.cal.month, action === 'prev' ? -1 : 1);
            if (state.cal.month < monthOf(state.today)) state.cal.month = monthOf(state.today);
            if (state.cal.month > maxMonth(state)) state.cal.month = maxMonth(state);
            state.cal.notice = '';
            ensureCalendar();
            var same = $('[data-qr-cal="' + action + '"]');
            if (same && !same.disabled) same.focus();
            return;
        }
        if (target.hasAttribute('data-qr-mode')) {
            state.cal.mode = target.getAttribute('data-qr-mode') === 'range' ? 'range' : 'slot';
            state.cal.rangeStart = '';
            state.cal.notice = '';
            state.cal.dayError = '';
            renderCalendar();
            var modeButton = $('[data-qr-mode="' + state.cal.mode + '"]');
            if (modeButton) modeButton.focus();
            return;
        }
        if (target.hasAttribute('data-qr-date')) {
            var date = target.getAttribute('data-qr-date');
            pickDate(date);
            var again = $('[data-qr-date="' + date + '"]');
            if (again && !again.disabled) again.focus();
            return;
        }
        if (target.hasAttribute('data-qr-range')) {
            if (target.getAttribute('data-qr-range') === 'single' && state.cal.rangeStart) commitRange(state.cal.rangeStart, state.cal.rangeStart);
            else { state.cal.rangeStart = ''; renderCalendar(); }
            return;
        }
        if (target.hasAttribute('data-qr-slot')) {
            var start = target.getAttribute('data-qr-slot');
            toggleSlot(start, target.getAttribute('data-qr-slot-end'));
            var chip = $('[data-qr-slot="' + sel(start) + '"]');
            if (chip) chip.focus();
            return;
        }
        if (target.hasAttribute('data-qr-add-custom')) { addCustomSlot(); return; }
        if (target.hasAttribute('data-qr-remove')) {
            var removedIndex = Number(target.getAttribute('data-qr-remove'));
            removeOffer(removedIndex);
            var nextRemove = $('[data-qr-remove="' + Math.max(0, Math.min(removedIndex, state.offered.length - 1)) + '"]');
            (nextRemove || $('#qr-panel-disponibilidad')).focus();
            return;
        }
        if (target.hasAttribute('data-qr-concept')) { addItem(target.getAttribute('data-qr-concept')); return; }
        if (target.hasAttribute('data-qr-item-remove')) {
            var row = target.closest('[data-qr-item]');
            state.items = state.items.filter(function (it) { return !row || it.id !== row.getAttribute('data-qr-item'); });
            state.dirty = true;
            renderItems();
            var concept = $('[data-qr-concept]');
            if (concept) concept.focus();
            return;
        }
        if (target.hasAttribute('data-qr-template')) { useTemplate(target.getAttribute('data-qr-template')); return; }
        if (target.hasAttribute('data-qr-template-delete')) { deleteTemplate(target.getAttribute('data-qr-template-delete')); return; }
        if (target.hasAttribute('data-qr-template-save')) { saveTemplate(); return; }
        if (target.hasAttribute('data-qr-var')) { insertVariable(target.getAttribute('data-qr-var')); }
    }

    function focusables() {
        return $all('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])').filter(function (el) {
            return !el.disabled && el.type !== 'hidden' && el.offsetParent !== null && el.tabIndex !== -1;
        });
    }

    function onKeydown(event) {
        if (!active) return;
        var state = active.state;
        if (event.key === 'Escape') {
            // Solo cierra este diálogo (no el panel de notas que pueda estar debajo).
            if (event.stopPropagation) event.stopPropagation();
            if (state.busy) return;
            event.preventDefault();
            // Con cambios sin enviar, el primer Esc avisa y el segundo descarta.
            if (state.dirty && !state.escArmed) {
                state.escArmed = true;
                setError('Tienes cambios sin enviar. Presiona Esc otra vez para descartarlos o sigue editando.');
                return;
            }
            close();
            return;
        }
        state.escArmed = false;
        if (event.key === 'Tab') {
            var list = focusables();
            if (!list.length) return;
            var first = list[0];
            var last = list[list.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            else if (!active.overlay.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
            return;
        }
        var target = event.target;
        if (target && target.hasAttribute && target.hasAttribute('data-qr-tab') && (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End')) {
            event.preventDefault();
            var index = TABS.findIndex(function (t) { return t.key === state.tab; });
            var next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
            setTab(TABS[next].key, true);
            return;
        }
        if (target && target.hasAttribute && target.hasAttribute('data-qr-mode') && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
            event.preventDefault();
            var other = $('[data-qr-mode="' + (state.cal.mode === 'slot' ? 'range' : 'slot') + '"]');
            if (other) other.click();
            return;
        }
        if (target && target.hasAttribute && target.hasAttribute('data-qr-date')) {
            var delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
            if (!delta) return;
            event.preventDefault();
            var date = target.getAttribute('data-qr-date');
            for (var step = 0; step < 6; step++) {
                date = B().addDays(date, delta);
                var button = $('[data-qr-date="' + date + '"]');
                if (!button) return;
                if (!button.disabled) { button.focus(); return; }
            }
            return;
        }
        // Enter dentro de un campo de una línea no envía la propuesta por accidente.
        if (event.key === 'Enter' && target && target.tagName === 'INPUT' && target.type !== 'submit' && active.overlay.contains(target)) {
            event.preventDefault();
            if (target.name === 'custom_start' || target.name === 'custom_end') addCustomSlot();
            else if (target.name === 'template_title') saveTemplate();
        }
    }

    /* ----------------------------------- envío ----------------------------------- */
    function buildPayload(state) {
        var model = M();
        var message = String(state.v.message || '').trim();
        return {
            amount: state.v.amount,
            currency: state.v.currency,
            sessions: state.v.sessions,
            minutes: minutesOf(state),
            deposit_pct: state.v.depositPct,
            expiry_enabled: !!state.v.expiryEnabled,
            expiry_days: state.v.expiryDays,
            location: state.v.location,
            complexity: state.v.complexity,
            availability_note: state.v.availabilityNote,
            message: message ? model.resolveTemplate(message, variables(state)).text : '',
            offered: state.offered.map(function (offer) {
                return offer.kind === 'range' ? { kind: 'range', from: offer.from, to: offer.to } : { kind: 'slot', start: offer.start, end: offer.end };
            }),
            extras: {
                items: state.items.map(function (it) { return { name: it.name, description: it.description, qty: it.qty, price: it.price }; }),
                discount_pct: state.v.discountPct,
                tax_pct: state.v.taxPct,
                policy: state.v.policy,
                client_notes: state.v.clientNotes,
                extra_terms: state.v.extraTerms
            }
        };
    }

    var FIELD_INPUT = { minutes: 'hours', items: 'item_name', offered: '' };

    function showFieldError(field, message) {
        var tab = M().FIELD_TAB[field] || 'propuesta';
        setTab(tab);
        setError(message);
        var name = FIELD_INPUT[field] != null ? FIELD_INPUT[field] : field;
        var input = name ? $('[name="' + name + '"]') : null;
        if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        } else {
            var panel = $('#qr-panel-' + tab);
            if (panel) panel.focus();
        }
    }

    function setBusy(busy) {
        if (!active) return;
        active.state.busy = !!busy;
        var submit = $('#qr-submit');
        if (submit) { submit.disabled = !!busy; submit.setAttribute('aria-busy', busy ? 'true' : 'false'); }
        $all('[data-qr-close]').forEach(function (button) { button.disabled = !!busy; });
    }

    function overlapError(error) {
        return !!error && (error.code === '23P01' || error.code === 'slot_taken' || /CALENDAR_OVERLAP|SLOT_TAKEN/.test(String(error.message || '')));
    }

    async function submit(event) {
        event.preventDefault();
        if (!active || active.state.busy) return;
        var session = active;
        var state = session.state;
        var model = M();
        var repo = Repo();
        var ctx = state.ctx;
        var quote = state.quote;
        var quoteId = quote.quote_id || quote.id;
        setError('');
        $all('[aria-invalid="true"]').forEach(function (el) { el.removeAttribute('aria-invalid'); });

        // Sin el contexto (falló al abrir) no se sabe si la propuesta ya tenía desglose
        // y condiciones guardados: se vuelve a pedir antes de enviar nada.
        if (!session.contextLoaded) {
            setBusy(true);
            var loaded = null;
            try {
                loaded = await loadContext(session);
            } catch (error) {
                if (active !== session) return;
                setBusy(false);
                setError('No pudimos cargar los datos guardados de esta propuesta. Revisa tu conexión e intenta de nuevo.');
                return;
            }
            if (active !== session) return;
            setBusy(false);
            if (loaded.has_manual) {
                setTab('condiciones');
                setError('Cargamos el desglose y las condiciones que ya tenía esta propuesta. Revísalos y vuelve a enviarla.');
                return;
            }
        }

        var payload = buildPayload(state);
        var checked = model.validateProposal(payload);
        if (!checked.ok) { showFieldError(checked.firstError.field, checked.firstError.message); return; }
        var offers = model.normalizeOffers(payload.offered, { tz: state.tz, now: Date.now() });
        if (!offers.ok) {
            state.conflicts = {};
            offers.errors.forEach(function (e) { if (e.index >= 0 && state.offered[e.index]) state.conflicts[model.offerKey(state.offered[e.index])] = e.error; });
            renderOffers();
            showFieldError('offered', offers.errors[0].error + ' Quítala de la lista o elige otra.');
            return;
        }

        var form = session.overlay.querySelector('form');
        var reserveOffered = !!form.querySelector('[name="reserve_slot_offered"]');
        var reserveBox = form.querySelector('[name="reserve_slot"]');
        var reserve = !!(reserveBox && reserveBox.checked);
        var hold = window.WoSlotHold;

        setBusy(true);
        try {
            if (typeof ctx.flushNotes === 'function') await Promise.resolve(ctx.flushNotes()).catch(function () {});
            // Turnos: "Reservar el turno pedido" crea la sesión y bloquea el turno antes de
            // responder. Primero se valida todo en el servidor para no reservar en vano.
            if (reserve && reserveOffered && hold) {
                await repo.save(quoteId, Object.assign({}, payload, { validate_only: true }));
                await hold.confirmFor(quote);
            }
            var result = await repo.save(quoteId, payload);
            // Destildado: el turno se libera para otros clientes (no queda apartado hasta que venza).
            if (reserveOffered && !reserve && hold && typeof hold.releaseFor === 'function') {
                await hold.releaseFor(quote, 'artist_declined').catch(function (error) { console.warn('[quote-respond] liberar turno', error); });
            }
            if (payload.message && quote.client_user_id && typeof ctx.sendChat === 'function') {
                // El mensaje ya resuelto va al chat sin correo propio: viaja en el aviso de la propuesta.
                await Promise.resolve(ctx.sendChat(payload.message)).catch(function (error) { console.warn('[quote-respond] mensaje', error); });
            }
            if (result.first_response && typeof ctx.notifyResponded === 'function') {
                ctx.notifyResponded({
                    artist_budget_amount: checked.value.amount,
                    artist_budget_currency: checked.value.currency,
                    estimated_sessions: checked.value.sessions
                });
            }
            if (active === session) close({ silent: true });
            if (typeof ctx.reload === 'function') await Promise.resolve(ctx.reload()).catch(function () {});
            if (typeof ctx.toast === 'function') {
                if (result.extras_saved === false) {
                    ctx.toast('La propuesta se envió, pero no pudimos guardar el desglose y las condiciones. Vuelve a abrirla para intentarlo de nuevo.', { error: true });
                } else {
                    ctx.toast(result.updated ? 'Propuesta actualizada. Le avisamos al cliente.' : 'Propuesta enviada al cliente.');
                }
            }
        } catch (error) {
            console.error('[quote-respond] enviar', error);
            if (active !== session) return;
            setBusy(false);
            var body = (error && error.payload) || {};
            if (error && error.code === 'slot_conflict' && Array.isArray(body.conflicts)) {
                state.conflicts = {};
                body.conflicts.forEach(function (c) {
                    var offer = state.offered[c.index];
                    if (offer) state.conflicts[model.offerKey(offer)] = c.reason;
                });
                state.cal.loaded = {};
                renderOffers();
                showFieldError('offered', error.userMessage || 'Algunas fechas ya están ocupadas en tu agenda.');
                return;
            }
            if (error && error.code === 'invalid' && body.errors) {
                var first = Object.keys(body.errors)[0];
                showFieldError(first, body.errors[first]);
                return;
            }
            if (overlapError(error)) {
                setTab('propuesta');
                setError('El turno pedido se superpone con otra sesión, un evento que bloquea o una cita de estudio. Desmarca la reserva o libera ese horario.');
                return;
            }
            setError((error && error.userMessage) || 'No pudimos enviar la propuesta. Intenta de nuevo.');
        }
    }

    /* --------------------------------- ciclo de vida --------------------------------- */
    function close(options) {
        if (!active) return;
        if (active.state.busy && !(options && options.silent)) return;
        var session = active;
        active = null;
        window.clearTimeout(durationTimer);
        document.removeEventListener('keydown', onKeydown, true);
        session.overlay.remove();
        document.documentElement.classList.remove('qr-open');
        var back = session.returnFocus;
        if (back && back.focus && document.contains(back)) back.focus();
    }

    function applyContext(session, res) {
        if (active !== session) return;
        var state = session.state;
        var model = M();
        if (res.timezone && B().validTimeZone(res.timezone)) {
            state.tz = res.timezone;
            state.today = B().zonedDate(Date.now(), state.tz);
        }
        if (res.editable === false) {
            close({ silent: true });
            if (typeof state.ctx.toast === 'function') state.ctx.toast(res.reason || 'Esta cotización ya no admite propuestas.', { error: true });
            return;
        }
        var extras = res.extras || {};
        var pre = (state.prefilled && state.prefilled.extras) || {};
        var set = function (key, value, name, prefilledKey) {
            if (state.touched[key] || (prefilledKey && pre[prefilledKey] != null)) return;
            if (value == null || value === '') return;
            state.v[key] = value;
            var input = name ? $('[name="' + name + '"]') : null;
            if (input) input.value = value;
        };
        set('policy', extras.policy, 'policy', 'policy');
        set('clientNotes', extras.clientNotes, 'client_notes', 'client_notes');
        set('extraTerms', extras.extraTerms, 'extra_terms', 'extra_terms');
        set('discountPct', extras.discountPct || '', 'discount_pct', 'discount_pct');
        set('taxPct', extras.taxPct || '', 'tax_pct', 'tax_pct');
        if (!state.touched.complexity && state.prefilled.complexity == null && model.COMPLEXITY_OPTIONS.indexOf(extras.complexity) !== -1) {
            state.v.complexity = extras.complexity;
            var complexity = $('[name="complexity"]');
            if (complexity) complexity.value = extras.complexity;
        }
        if (!state.touched.location && !state.v.location && extras.location) {
            state.v.location = extras.location;
            var location = $('[name="location"]');
            if (location) location.value = extras.location;
        }
        if (!state.items.length && !Array.isArray(pre.items) && Array.isArray(extras.items) && extras.items.length) {
            state.items = toItems(extras.items);
        }
        // Las fechas guardadas llegan con la zona del artista ya resuelta.
        if (!Array.isArray(state.prefilled.offered) && !state.dirty && res.quotation && Array.isArray(res.quotation.offered_slots)) {
            state.offered = model.offersFromStored(res.quotation.offered_slots, { now: Date.now() }).slice(0, model.MAX_OFFERS);
        }
        renderItems();
        renderOffers();
        if (state.tab === 'disponibilidad') renderCalendar();
    }

    // Contexto del servidor: zona horaria y campos de la cotización manual ya
    // guardados. Hasta que no llega, la propuesta no se envía (un envío sin el
    // desglose guardado lo pisaría con uno vacío).
    function loadContext(session) {
        var quote = session.state.quote;
        return Repo().context(quote.quote_id || quote.id).then(function (res) {
            session.contextLoaded = true;
            applyContext(session, res || {});
            return res || {};
        });
    }

    // Modo demo / preview estático: las cotizaciones de ejemplo no existen en el
    // servidor, así que el expediente sigue con su diálogo anterior (datos simulados).
    function isPreview() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }

    function open(ctx) {
        if (!M() || !B() || !Repo() || !ctx || !ctx.quote || !ctx.user) return false;
        if (isPreview()) return false;
        var can = M().canPropose(ctx.quote);
        if (!can.ok) {
            if (typeof ctx.toast === 'function') ctx.toast(can.reason, { error: true });
            return true;
        }
        if (active) close({ silent: true });
        var state = createState(ctx);
        var overlay = document.createElement('div');
        overlay.className = 'qr-overlay';
        overlay.innerHTML = shellHtml(state);
        var session = { overlay: overlay, state: state, returnFocus: document.activeElement };
        active = session;
        (document.getElementById('qd-dialog-root') || document.body).appendChild(overlay);
        document.documentElement.classList.add('qr-open');

        var form = overlay.querySelector('form');
        form.addEventListener('submit', submit);
        form.addEventListener('input', onInput);
        form.addEventListener('change', onInput);
        overlay.addEventListener('click', onClick);
        // Con cambios sin enviar, un clic fuera del diálogo no lo cierra.
        overlay.addEventListener('mousedown', function (event) { if (event.target === overlay && !state.dirty && !state.busy) close(); });
        document.addEventListener('keydown', onKeydown, true);

        renderTabs();
        renderExpiry();
        renderItems();
        renderOffers();
        renderTemplates();

        loadContext(session).catch(function (error) {
            console.warn('[quote-respond] contexto', error && error.message);
        });
        Repo().listTemplates(ctx.user.id).then(function (res) {
            if (active !== session) return;
            state.templates.available = res.available;
            state.templates.saved = res.rows || [];
            renderTemplates();
        }).catch(function (error) {
            if (active !== session) return;
            console.warn('[quote-respond] respuestas rápidas', error && error.message);
            renderTemplates();
        });

        window.setTimeout(function () {
            if (active !== session) return;
            var first = state.tab === 'propuesta' ? $('[name="amount"]') : $('#qr-tab-' + state.tab);
            if (first && first.readOnly) first = $('[name="sessions"]');
            if (first) first.focus();
        }, 40);
        return true;
    }

    window.WoQuoteRespond = {
        open: open,
        close: function () { close({ silent: true }); },
        isOpen: function () { return !!active; }
    };
}());
