/**
 * WE OTZI - Modelo de vista de Cotizaciones (listado + resumen lateral)
 * --------------------------------------------------------------------
 * Lógica pura (sin DOM ni red) que comparten /my-quotations, el resumen
 * lateral y /my-quotations/new. Figma final "We Otzi Pantallas final"
 * (frames 801:555 listado, 801:564 resumen lateral).
 *
 * Navegador: window.WoQuotationsViewModel. Node (tests): require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoQuotationsViewModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Familias de color del Figma: pendiente / respondida / confirmada / rechazada / vencida.
    var STATUS_VIEW = {
        pending:          { label: 'Pendiente',          tone: 'pending' },
        responded:        { label: 'Respondida',         tone: 'responded' },
        client_approved:  { label: 'Confirmada',         tone: 'confirmed' },
        in_progress:      { label: 'En progreso',        tone: 'confirmed' },
        artist_completed: { label: 'Lista para cliente', tone: 'confirmed' },
        completed:        { label: 'Completada',         tone: 'confirmed' },
        client_rejected:  { label: 'Rechazada',          tone: 'rejected' },
        cancelled:        { label: 'Rechazada',          tone: 'rejected' },
        expired:          { label: 'Vencida',            tone: 'expired' },
        draft:            { label: 'Borrador',           tone: 'expired' }
    };

    var PRIORITY_VIEW = {
        high:   { label: 'Alta',  tone: 'high' },
        medium: { label: 'Media', tone: 'medium' },
        low:    { label: 'Baja',  tone: 'low' }
    };

    var CONFIRMED_STATUSES = ['client_approved', 'in_progress', 'artist_completed', 'completed'];
    var ANSWERED_STATUSES = ['responded', 'client_approved', 'in_progress', 'artist_completed', 'completed', 'client_rejected'];
    var CLOSED_STATUSES = ['completed', 'client_rejected', 'cancelled', 'expired'];

    // Alcances del selector "Cotizaciones" del hero. "archivadas" reemplaza a /archive
    // y "borradores" muestra las cotizaciones manuales sin enviar.
    var SCOPES = [
        { value: 'all', label: 'Todas las cotizaciones', param: 'todas' },
        { value: 'open', label: 'Solo las abiertas', param: 'abiertas' },
        { value: 'closed', label: 'Solo las cerradas', param: 'cerradas' },
        { value: 'drafts', label: 'Borradores', param: 'borradores' },
        { value: 'archived', label: 'Archivadas', param: 'archivadas' }
    ];

    var MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    var MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    function statusView(status) {
        return STATUS_VIEW[status] || { label: status || 'Sin estado', tone: 'expired' };
    }

    // Badge del listado: la leyenda del Figma tiene cinco familias, así que la tarjeta
    // muestra la familia ("Confirmada" para en progreso / lista / completada) y el
    // estado fino queda en el título del badge, el filtro "Estado" y el resumen lateral.
    var FAMILY_LABEL = {
        pending: 'Pendiente', responded: 'Respondida', confirmed: 'Confirmada',
        rejected: 'Rechazada', expired: 'Vencida'
    };

    function statusBadge(status) {
        var view = statusView(status);
        if (status === 'draft') return { label: view.label, detail: view.label, tone: view.tone };
        var family = FAMILY_LABEL[view.tone] || view.label;
        return { label: family, detail: view.label, tone: view.tone };
    }

    function priorityView(priority) {
        return PRIORITY_VIEW[priority] || PRIORITY_VIEW.medium;
    }

    function scopeFromParam(param) {
        var value = String(param || '').toLowerCase();
        var hit = SCOPES.find(function (s) { return s.param === value || s.value === value; });
        return hit ? hit.value : 'all';
    }

    function paramForScope(scope) {
        var hit = SCOPES.find(function (s) { return s.value === scope; });
        return hit ? hit.param : 'todas';
    }

    function matchesScope(quote, scope) {
        if (scope === 'open') return CLOSED_STATUSES.indexOf(quote.quote_status) === -1;
        if (scope === 'closed') return CLOSED_STATUSES.indexOf(quote.quote_status) !== -1;
        return true;
    }

    function matchesQuick(quote, quick) {
        switch (quick) {
            case 'pending': return quote.quote_status === 'pending';
            case 'high': return (quote.priority || 'medium') === 'high';
            case 'confirmed': return CONFIRMED_STATUSES.indexOf(quote.quote_status) !== -1;
            default: return true;
        }
    }

    // tattoo_style llega en tres formas: texto, objeto del wizard
    // ({ style_name, substyle_name, styles: [...] }) o arreglo JSON (["Realismo"]).
    function styleName(tattooStyle) {
        if (!tattooStyle) return '';
        if (typeof tattooStyle === 'string') {
            var trimmed = tattooStyle.trim();
            if (trimmed.charAt(0) === '[' || trimmed.charAt(0) === '{') {
                try { return styleName(JSON.parse(trimmed)); } catch (e) { return trimmed; }
            }
            return trimmed === 'TBD' ? '' : trimmed;
        }
        if (Array.isArray(tattooStyle)) {
            return tattooStyle.map(styleName).filter(Boolean).join(' · ');
        }
        if (typeof tattooStyle === 'object') {
            if (tattooStyle.style_name) {
                return tattooStyle.substyle_name ? tattooStyle.style_name + ' · ' + tattooStyle.substyle_name : tattooStyle.style_name;
            }
            if (Array.isArray(tattooStyle.styles)) return styleName(tattooStyle.styles);
            return tattooStyle.name || '';
        }
        return '';
    }

    function shortRef(quote) {
        if (quote && quote.quote_id) return String(quote.quote_id);
        return 'COT-' + String(quote && quote.id != null ? quote.id : '').slice(-4).toUpperCase();
    }

    function shortDate(isoString) {
        var date = new Date(isoString);
        if (isNaN(date.getTime())) return '—';
        return String(date.getDate()).padStart(2, '0') + ' ' + MONTH_SHORT[date.getMonth()];
    }

    function timeLabel(isoString) {
        var date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }

    function startOfWeek(date) {
        var day = new Date(date);
        day.setHours(0, 0, 0, 0);
        var offset = (day.getDay() + 6) % 7; // lunes = 0
        day.setDate(day.getDate() - offset);
        return day;
    }

    function periodLabel(createdAt, now) {
        var created = new Date(createdAt);
        if (isNaN(created.getTime())) return 'Sin fecha';
        var thisWeek = startOfWeek(now || new Date());
        if (created >= thisWeek) return 'Esta semana';
        var lastWeek = new Date(thisWeek);
        lastWeek.setDate(lastWeek.getDate() - 7);
        if (created >= lastWeek) return 'Semana pasada';
        return MONTH_NAMES[created.getMonth()] + ' ' + created.getFullYear();
    }

    function groupByPeriod(list, now) {
        var groups = [];
        var index = {};
        (list || []).forEach(function (quote) {
            var label = periodLabel(quote.created_at, now);
            if (!index[label]) {
                index[label] = { label: label, quotes: [] };
                groups.push(index[label]);
            }
            index[label].quotes.push(quote);
        });
        return groups;
    }

    // Orden del listado. valueOf(quote) devuelve { amount, currency } comparable (ya
    // convertido a la moneda de "Mostrar en" cuando hay tipo de cambio). Por presupuesto:
    // primero los importes en la moneda principal (la más frecuente), después los que
    // quedaron en otra moneda (sin tipo de cambio no se mezclan) y al final los sin importe.
    function sortQuotes(list, sortConfig, valueOf) {
        var field = sortConfig && sortConfig.field;
        var asc = sortConfig && sortConfig.direction === 'asc';
        var dateOf = function (q) { return new Date(q.created_at).getTime() || 0; };
        var items = (list || []).slice();
        if (field !== 'budget') {
            return items.sort(function (a, b) { return asc ? dateOf(a) - dateOf(b) : dateOf(b) - dateOf(a); });
        }
        var keyOf = typeof valueOf === 'function' ? valueOf : function (q) { return amountEntry(q); };
        var keys = new Map();
        var tally = {};
        items.forEach(function (q) {
            var k = keyOf(q) || {};
            var amount = toNumber(k.amount);
            var key = { amount: amount, currency: String(k.currency || 'USD').toUpperCase(), has: isFinite(amount) && amount > 0 };
            keys.set(q, key);
            if (key.has) tally[key.currency] = (tally[key.currency] || 0) + 1;
        });
        var primary = Object.keys(tally).sort(function (x, y) { return tally[y] - tally[x]; })[0];
        var rank = function (k) { return !k.has ? 2 : k.currency === primary ? 0 : 1; };
        return items.sort(function (a, b) {
            var ka = keys.get(a);
            var kb = keys.get(b);
            var ra = rank(ka);
            var rb = rank(kb);
            if (ra !== rb) return ra - rb;
            if (ra === 1 && ka.currency !== kb.currency) return ka.currency < kb.currency ? -1 : 1;
            if (ra !== 2 && ka.amount !== kb.amount) return asc ? ka.amount - kb.amount : kb.amount - ka.amount;
            return dateOf(b) - dateOf(a);
        });
    }

    // Grupos del listado: por período cuando se ordena por fecha (Figma) y un único
    // grupo cuando se ordena por presupuesto (agrupar por fecha rompería el orden).
    function groupForList(list, sortConfig, now) {
        if (sortConfig && sortConfig.field === 'budget') {
            if (!list || !list.length) return [];
            return [{
                label: sortConfig.direction === 'asc' ? 'De menor a mayor presupuesto' : 'De mayor a menor presupuesto',
                quotes: list.slice()
            }];
        }
        return groupByPeriod(list, now);
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === '') return NaN;
        if (typeof value === 'number') return value;
        var n = parseFloat(String(value).replace(/[^0-9.,\-]/g, '').replace(',', '.'));
        return isFinite(n) ? n : NaN;
    }

    // "$185.000" (Figma): es-AR, sin decimales y sin espacio tras el símbolo.
    function formatMoney(amount, currency, opts) {
        opts = opts || {};
        var n = toNumber(amount);
        if (!isFinite(n)) return opts.empty == null ? '—' : opts.empty;
        var code = String(currency || 'ARS').toUpperCase();
        var decimals = typeof opts.decimals === 'number' ? opts.decimals : 0;
        var out;
        try {
            out = new Intl.NumberFormat('es-AR', {
                style: 'currency', currency: code,
                minimumFractionDigits: decimals, maximumFractionDigits: decimals
            }).format(n);
        } catch (e) {
            out = code + ' ' + n.toFixed(decimals);
        }
        return out.replace(/[\s ]+/g, ' ').replace(/^([^\d\s-]+)\s(?=[\d-])/, '$1');
    }

    // Tile del resumen económico: "$185K" para que entre en 410px.
    function formatCompactMoney(amount, currency) {
        var n = toNumber(amount);
        if (!isFinite(n)) return '—';
        var symbol = formatMoney(0, currency).replace(/[\d.,\s-]/g, '') || '$';
        var abs = Math.abs(n);
        var body;
        if (abs >= 1e6) body = (Math.round(n / 1e5) / 10).toString().replace('.', ',') + 'M';
        else if (abs >= 1e4) body = Math.round(n / 1e3) + 'K';
        else if (abs >= 1e3) body = (Math.round(n / 100) / 10).toString().replace('.', ',') + 'K';
        else body = String(Math.round(n));
        return symbol + body;
    }

    function initials(name) {
        // Ignora separadores sueltos ("Valentina · Preview" → "VP").
        var parts = String(name || '').trim().split(/\s+/).filter(function (p) { return /[0-9A-Za-zÀ-ÿ]/.test(p); });
        if (!parts.length) return '··';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    // Timeline del resumen lateral (Figma 801:564): NUEVA → REVISANDO → ACEPTADA → AGENDADA.
    var TIMELINE = [
        { key: 'new', label: 'Nueva' },
        { key: 'review', label: 'Revisando' },
        { key: 'accepted', label: 'Aceptada' },
        { key: 'scheduled', label: 'Agendada' }
    ];

    function timelineIndex(quote, sessions) {
        var status = quote && quote.quote_status;
        var hasSession = (sessions || []).some(function (s) { return s && s.status !== 'cancelled'; });
        if (['in_progress', 'artist_completed', 'completed'].indexOf(status) !== -1) return 3;
        if (status === 'client_approved') return hasSession ? 3 : 2;
        if (status === 'responded' || status === 'client_rejected') return 1;
        return 0;
    }

    function timelineSteps(quote, sessions) {
        var current = timelineIndex(quote, sessions);
        var status = quote && quote.quote_status;
        var terminal = ['client_rejected', 'cancelled', 'expired'].indexOf(status) !== -1;
        return TIMELINE.map(function (step, i) {
            var state = i < current ? 'done' : i === current ? (terminal ? 'stopped' : 'current') : 'future';
            return { key: step.key, label: step.label, state: state };
        });
    }

    // Badge de la cabecera del resumen: etapa del timeline o el cierre.
    function stageBadge(quote, sessions) {
        var status = quote && quote.quote_status;
        if (status === 'client_rejected' || status === 'cancelled') return { label: 'Rechazada', tone: 'rejected' };
        if (status === 'expired') return { label: 'Vencida', tone: 'expired' };
        if (status === 'completed') return { label: 'Completada', tone: 'done' };
        var step = TIMELINE[timelineIndex(quote, sessions)];
        return { label: step.label, tone: step.key };
    }

    // Transiciones que el artista puede elegir desde el selector de estado.
    // Mismas reglas que el detalle (aceptar → responded / iniciar; rechazar → cancelled / client_rejected).
    var STATUS_TRANSITIONS = {
        pending: ['responded', 'cancelled', 'expired'],
        responded: ['client_approved', 'client_rejected', 'expired'],
        client_approved: ['in_progress', 'expired'],
        client_rejected: ['responded'],
        cancelled: [],
        in_progress: ['artist_completed'],
        artist_completed: ['in_progress', 'completed'],
        completed: [],
        expired: []
    };

    function statusOptions(status) {
        var list = [status].concat(STATUS_TRANSITIONS[status] || []);
        return list.filter(function (v, i) { return v && list.indexOf(v) === i; })
            .map(function (value) { return { value: value, label: statusView(value).label }; });
    }

    // Acciones del pie del resumen según el estado (equivalen a las del detalle).
    function summaryActions(quote) {
        var status = quote && quote.quote_status;
        var archived = !!(quote && quote.is_archived);
        if (archived) return { accept: null, reject: null, archived: true };
        var accept = null;
        if (status === 'pending') accept = { label: 'Aceptar', patch: { quote_status: 'responded' } };
        else if (status === 'client_approved') accept = { label: 'Iniciar trabajo', patch: { quote_status: 'in_progress' } };
        var reject = null;
        if (status === 'pending') reject = { label: 'Rechazar', patch: { quote_status: 'cancelled' } };
        else if (status === 'responded') reject = { label: 'Rechazar', patch: { quote_status: 'client_rejected' } };
        return { accept: accept, reject: reject, archived: false };
    }

    // Importe de la fila: el final si cerró, el del artista si respondió, si no el del cliente.
    function amountEntry(quote) {
        if (quote.final_budget_amount && ['completed', 'client_approved', 'in_progress', 'artist_completed'].indexOf(quote.quote_status) !== -1) {
            return { amount: quote.final_budget_amount, currency: quote.final_budget_currency || 'USD' };
        }
        if (quote.artist_budget_amount) return { amount: quote.artist_budget_amount, currency: quote.artist_budget_currency || 'USD' };
        return { amount: quote.client_budget_amount, currency: quote.client_budget_currency || 'USD' };
    }

    // Copy del hero: "4 cotizaciones esperan tu respuesta esta semana."
    function heroCopy(pendingThisWeek) {
        var n = Math.max(0, Number(pendingThisWeek) || 0);
        return {
            highlight: n + ' ' + (n === 1 ? 'cotización' : 'cotizaciones'),
            rest: (n === 1 ? 'espera' : 'esperan') + ' tu respuesta esta semana.'
        };
    }

    function countLabel(shown, total) {
        return 'Mostrando ' + shown + ' de ' + total + ' ' + (total === 1 ? 'cotización' : 'cotizaciones');
    }

    // quotations_db usa in_progress para dos cosas: el borrador del wizard del
    // cliente (sin respuesta del artista) y el trabajo iniciado. El listado
    // muestra solo el segundo.
    function isClientWizardDraft(quote) {
        return !!quote && quote.quote_status === 'in_progress'
            && !quote.artist_responded_at && !quote.artist_budget_amount && !quote.final_budget_amount;
    }

    function detailUrl(quote) {
        return '/my-quotations/detail?id=' + encodeURIComponent(quote.quote_id || quote.id);
    }

    return {
        STATUS_VIEW: STATUS_VIEW,
        PRIORITY_VIEW: PRIORITY_VIEW,
        CONFIRMED_STATUSES: CONFIRMED_STATUSES,
        ANSWERED_STATUSES: ANSWERED_STATUSES,
        CLOSED_STATUSES: CLOSED_STATUSES,
        SCOPES: SCOPES,
        TIMELINE: TIMELINE,
        STATUS_TRANSITIONS: STATUS_TRANSITIONS,
        MONTH_NAMES: MONTH_NAMES,
        MONTH_SHORT: MONTH_SHORT,
        statusView: statusView,
        statusBadge: statusBadge,
        priorityView: priorityView,
        scopeFromParam: scopeFromParam,
        paramForScope: paramForScope,
        matchesScope: matchesScope,
        matchesQuick: matchesQuick,
        styleName: styleName,
        shortRef: shortRef,
        shortDate: shortDate,
        timeLabel: timeLabel,
        startOfWeek: startOfWeek,
        periodLabel: periodLabel,
        groupByPeriod: groupByPeriod,
        sortQuotes: sortQuotes,
        groupForList: groupForList,
        toNumber: toNumber,
        formatMoney: formatMoney,
        formatCompactMoney: formatCompactMoney,
        initials: initials,
        timelineIndex: timelineIndex,
        timelineSteps: timelineSteps,
        stageBadge: stageBadge,
        statusOptions: statusOptions,
        summaryActions: summaryActions,
        amountEntry: amountEntry,
        heroCopy: heroCopy,
        isClientWizardDraft: isClientWizardDraft,
        countLabel: countLabel,
        detailUrl: detailUrl
    };
}));
