/**
 * WE OTZI - Modelo del expediente de cotización (lógica pura, sin DOM)
 * --------------------------------------------------------------------
 * Figma final del flujo de artista (oct 2026) · área "cotizaciones-detalle".
 * Deriva el estado del expediente (frames 801:576–584), los slots de sesiones,
 * el timeline, el historial de cambios, los formatos de fecha/monto/duración,
 * el escenario solo-preview (?estado=) y las plantillas de notas de trabajo
 * (frames 801:578/579 y 801:1111–1115).
 *
 * UMD: `window.QuotationDetailModel` en el navegador y `require` en Node
 * (tests/figma-final-cotizaciones-detalle.test.js).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.QuotationDetailModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    var DAY = 24 * 60 * 60 * 1000;

    /* ------------------------------ formatos ------------------------------ */
    function pad2(n) { return String(n).padStart(2, '0'); }

    function toDate(value) {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        var raw = String(value);
        var date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T12:00:00') : new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    function dayMonth(value) {
        var d = toDate(value);
        return d ? pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()] : '—';
    }
    function dayMonthYear(value) {
        var d = toDate(value);
        return d ? pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : '—';
    }
    function timeOf(value) {
        var d = toDate(value);
        return d ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '';
    }
    function dateTime(value) {
        var d = toDate(value);
        return d ? dayMonthYear(d) + ' · ' + timeOf(d) : '—';
    }
    function chatStamp(value) {
        var d = toDate(value);
        return d ? dayMonth(d) + ' · ' + timeOf(d) : '';
    }
    function isoDay(value) {
        var d = toDate(value);
        return d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : '';
    }
    function sameDay(a, b) {
        var x = toDate(a), y = toDate(b);
        return !!(x && y && x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate());
    }
    // Valor para <input type="datetime-local"> en hora local.
    function localInputValue(value) {
        var d = toDate(value);
        return d ? isoDay(d) + 'T' + timeOf(d) : '';
    }

    function numberFrom(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        var raw = String(value).trim().replace(/[^0-9,.-]/g, '');
        if (!raw) return null;
        // "410.000" / "1.240,50" (es-AR) · "410000" · "2.5" (decimal simple)
        if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
        else raw = raw.replace(',', '.');
        var parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }
    function groupThousands(amount) {
        var rounded = Math.round(Math.abs(amount));
        var text = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (amount < 0 ? '-' : '') + text;
    }
    function currencySymbol(currency) {
        var code = String(currency || '').toUpperCase();
        if (code === 'EUR') return '€';
        if (code === 'GBP') return '£';
        return '$';
    }
    function money(value, currency) {
        var amount = numberFrom(value);
        if (amount == null) return 'A definir';
        return currencySymbol(currency) + groupThousands(amount);
    }
    function moneyRange(min, max, currency) {
        var a = numberFrom(min), b = numberFrom(max);
        if (a != null && b != null && a !== b) return money(a, currency) + ' – ' + money(b, currency);
        if (a != null) return money(a, currency);
        if (b != null) return money(b, currency);
        return 'A definir';
    }
    function minutesFrom(value) {
        var n = numberFrom(value);
        return n && n > 0 ? Math.round(n) : null;
    }
    function splitMinutes(minutes) {
        var m = Math.max(0, Math.round(minutes || 0));
        return { h: Math.floor(m / 60), m: m % 60 };
    }
    // "2hrs 30min" (panel de evaluación)
    function durationLong(minutes) {
        var mins = minutesFrom(minutes);
        if (!mins) return '';
        var p = splitMinutes(mins);
        if (!p.h) return p.m + 'min';
        return p.h + 'hrs' + (p.m ? ' ' + p.m + 'min' : '');
    }
    // "2h 30m" (acuerdo, historial)
    function durationShort(minutes) {
        var mins = minutesFrom(minutes);
        if (!mins) return '';
        var p = splitMinutes(mins);
        if (!p.h) return p.m + 'm';
        return p.h + 'h' + (p.m ? ' ' + p.m + 'm' : '');
    }
    // "8 horas" (total estimado antes de responder)
    function hoursLabel(minutes) {
        var mins = minutesFrom(minutes);
        if (!mins) return '';
        var hours = Math.round((mins / 60) * 10) / 10;
        var text = String(hours).replace('.', ',');
        return text + (hours === 1 ? ' hora' : ' horas');
    }
    function sessionsLabel(n) {
        var count = intFrom(n);
        if (!count) return '';
        return count + (count === 1 ? ' sesión' : ' sesiones');
    }
    function intFrom(value) {
        var n = parseInt(String(value == null ? '' : value).replace(/[^0-9]/g, ' ').trim().split(/\s+/)[0], 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }
    function initials(name) {
        var words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '··';
        return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
    }
    function styleName(value) {
        if (!value) return 'Sin definir';
        if (Array.isArray(value)) return value.map(styleName).filter(function (s) { return s !== 'Sin definir'; }).join(', ') || 'Sin definir';
        if (typeof value === 'object') return value.substyle_name || value.style_name || value.name || 'Sin definir';
        var raw = String(value).trim();
        if (raw.charAt(0) === '[') {
            try { return styleName(JSON.parse(raw)); } catch (_) { /* texto plano */ }
        }
        return raw || 'Sin definir';
    }
    function bodyZone(quote) {
        return [quote && quote.tattoo_body_part, quote && quote.tattoo_body_side].filter(Boolean).join(' · ');
    }
    function isFlexible(value) {
        if (value === true) return true;
        if (!value) return false;
        return !/^(no|false|0)$/i.test(String(value).trim());
    }
    function preferredDateLabel(quote) {
        var flexible = isFlexible(quote && quote.client_flexible_dates);
        var date = toDate(quote && quote.client_preferred_date);
        if (!date) return flexible ? 'Flexible' : 'Sin fecha';
        return dayMonthYear(date) + (flexible ? ' · flexible' : '');
    }

    /* ------------------------------- estados ------------------------------- */
    var STAGE_META = {
        pending: { tag: 'Pendiente', tone: 'pending' },
        responded: { tag: 'Respondida', tone: 'responded' },
        approved: { tag: 'Aprobado', tone: 'approved' },
        in_progress: { tag: 'En progreso', tone: 'progress' },
        ready: { tag: 'En progreso', tone: 'progress' },
        delivered: { tag: 'Lista para cliente', tone: 'delivered' },
        completed: { tag: 'Completado', tone: 'completed' },
        dispute: { tag: 'En disputa', tone: 'dispute' },
        rejected: { tag: 'Rechazada', tone: 'rejected' },
        cancelled: { tag: 'Rechazada por vos', tone: 'rejected' },
        expired: { tag: 'Vencida', tone: 'expired' },
        draft: { tag: 'Borrador', tone: 'expired' }
    };
    var PRE_AGREEMENT = ['pending', 'responded', 'rejected', 'cancelled', 'expired', 'draft'];
    var WITH_AGREEMENT_PANEL = ['approved', 'in_progress', 'ready'];
    var WITH_SESSIONS = ['approved', 'in_progress', 'ready', 'delivered', 'completed', 'dispute'];

    function openDispute(quote, disputes) {
        var rows = Array.isArray(disputes) ? disputes : [];
        var row = rows.find(function (d) { return d && d.status === 'open'; }) || null;
        if (row) return row;
        if (quote && quote.dispute_status === 'open') return { status: 'open', title: '', description: '', evidence: [], created_at: null, synthetic: true };
        return null;
    }

    function agreedSessions(quote) {
        return intFrom(quote && quote.final_sessions) || intFrom(quote && quote.tattoo_estimated_sessions) || 0;
    }

    function orderedSessions(sessions) {
        return (Array.isArray(sessions) ? sessions : [])
            .filter(function (s) { return s && s.status !== 'cancelled'; })
            .slice()
            .sort(function (a, b) {
                var na = intFrom(a.session_number), nb = intFrom(b.session_number);
                if (na && nb && na !== nb) return na - nb;
                if (na && !nb) return -1;
                if (!na && nb) return 1;
                var da = toDate(a.session_date), db = toDate(b.session_date);
                return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
            });
    }

    // Una fila por sesión acordada (o existente): done | scheduled | unscheduled.
    function sessionSlots(quote, sessions) {
        var list = orderedSessions(sessions);
        var total = Math.max(agreedSessions(quote), list.length);
        var slots = [];
        for (var i = 0; i < total; i += 1) {
            var session = list[i] || null;
            var state = 'unscheduled';
            if (session && session.status === 'completed') state = 'done';
            else if (session && session.session_date) state = 'scheduled';
            slots.push({ number: i + 1, total: total, session: session, state: state, extra: i >= agreedSessions(quote) && agreedSessions(quote) > 0 });
        }
        return slots;
    }
    function slotCounts(slots) {
        var counts = { done: 0, scheduled: 0, pending: 0, total: slots.length, percent: 0 };
        slots.forEach(function (s) {
            if (s.state === 'done') counts.done += 1;
            else if (s.state === 'scheduled') counts.scheduled += 1;
            else counts.pending += 1;
        });
        counts.percent = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
        return counts;
    }

    function deriveStage(quote, sessions, disputes) {
        if (!quote) return 'pending';
        var status = quote.quote_status;
        if (openDispute(quote, disputes) && ['in_progress', 'en_progreso', 'artist_completed', 'completed', 'client_approved'].indexOf(status) !== -1) return 'dispute';
        switch (status) {
            case 'pending': return 'pending';
            case 'responded': return 'responded';
            case 'client_approved': return 'approved';
            case 'in_progress':
            case 'en_progreso': {
                // in_progress también es el borrador del cotizador del cliente.
                if (!quote.artist_responded_at && !quote.final_budget_amount && !quote.final_sessions) return 'draft';
                var slots = sessionSlots(quote, sessions);
                var counts = slotCounts(slots);
                return counts.total > 0 && counts.done >= counts.total ? 'ready' : 'in_progress';
            }
            case 'artist_completed': return 'delivered';
            case 'completed': return 'completed';
            case 'client_rejected': return 'rejected';
            case 'cancelled': return 'cancelled';
            case 'expired': return 'expired';
            default: return 'pending';
        }
    }

    function stageMeta(stage) { return STAGE_META[stage] || STAGE_META.pending; }
    function isPreAgreement(stage) { return PRE_AGREEMENT.indexOf(stage) !== -1; }
    function showsAgreement(stage) { return WITH_AGREEMENT_PANEL.indexOf(stage) !== -1; }
    function showsSessions(stage) { return WITH_SESSIONS.indexOf(stage) !== -1; }

    // Botones de la barra de comandos por estado (frames 801:576–584).
    function commandActions(stage) {
        switch (stage) {
            case 'pending': return ['accept', 'reject', 'schedule', 'contact'];
            case 'responded':
            case 'approved':
            case 'in_progress': return ['schedule', 'contact'];
            case 'ready': return ['markReady', 'contact'];
            case 'dispute': return ['dispute', 'contact'];
            default: return ['contact'];
        }
    }

    // Acciones por fila de sesión. `now` permite registrar en "aprobado" las
    // sesiones cuya fecha ya llegó (eso inicia el trabajo).
    function sessionRowActions(stage, slot, now) {
        var today = toDate(now) || new Date();
        var endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
        if (slot.state === 'done') return ['view'];
        if (slot.state === 'scheduled') {
            // En disputa la sesión de corrección se reprograma y se registra como
            // realizada sin cambiar quote_status (801:584).
            if (stage === 'in_progress' || stage === 'ready' || stage === 'dispute') return ['view', 'reschedule', 'complete'];
            if (stage === 'approved') {
                var date = toDate(slot.session && slot.session.session_date);
                return date && date <= endOfToday ? ['view', 'reschedule', 'complete'] : ['view'];
            }
            return ['view'];
        }
        if (stage === 'in_progress') return ['schedule'];
        if (stage === 'approved') return ['plan'];
        return [];
    }

    /* ------------------------------- timeline ------------------------------- */
    var TIMELINE_STEPS = [
        { status: 'pending', label: 'Pendiente' },
        { status: 'responded', label: 'Respondida' },
        { status: 'client_approved', label: 'Aprobada' },
        { status: 'in_progress', label: 'En progreso' },
        { status: 'artist_completed', label: 'Lista para cliente' },
        { status: 'completed', label: 'Completada' }
    ];
    var STAGE_INDEX = { pending: 0, draft: 0, responded: 1, rejected: 1, expired: 1, cancelled: 0, approved: 2, in_progress: 3, ready: 3, delivered: 4, dispute: 4, completed: 5 };

    function historyRows(history, status) {
        return (history || []).filter(function (h) { return h && h.new_status === status && toDate(h.changed_at); })
            .sort(function (a, b) { return toDate(a.changed_at) - toDate(b.changed_at); });
    }
    // Última vez que la cotización entró en `status`.
    function historyDate(history, status) {
        var rows = historyRows(history, status);
        return rows.length ? rows[rows.length - 1].changed_at : null;
    }
    // Fecha en que una sesión quedó registrada como realizada: su fecha, pero
    // nunca en el futuro ni después de su última modificación (una sesión
    // agendada para mañana que se registra hoy queda fechada hoy).
    function sessionDoneAt(session, now) {
        var s = session || {};
        var date = toDate(s.session_date);
        var updated = toDate(s.updated_at);
        var cap = toDate(now) || new Date();
        if (updated && updated < cap) cap = updated;
        if (!date) return updated ? s.updated_at : null;
        return date > cap ? cap.toISOString() : s.session_date;
    }
    function firstDoneSessionDate(sessions, now) {
        var best = null;
        orderedSessions(sessions).forEach(function (s) {
            if (s.status !== 'completed') return;
            var at = sessionDoneAt(s, now);
            if (at && (!best || toDate(at) < toDate(best))) best = at;
        });
        return best;
    }
    // "Trabajo iniciado" / timeline "En progreso": UNA sola fecha para los dos
    // (801:581: mismo día que la primera sesión realizada). Primera fila
    // in_progress del historial; sin ella (emulador del preview, datos viejos),
    // la primera sesión realizada; y como último recurso updated_at mientras la
    // cotización sigue en in_progress. Persiste en Lista para cliente,
    // Completada y En disputa.
    function workStartedAt(quote, history, sessions, stage, now) {
        var q = quote || {};
        var rows = historyRows(history, 'in_progress');
        if (rows.length) return rows[0].changed_at;
        var index = STAGE_INDEX[stage];
        if (index == null || index < STAGE_INDEX.in_progress) return null;
        var first = firstDoneSessionDate(sessions, now);
        if (first) return first;
        return (q.quote_status === 'in_progress' || q.quote_status === 'en_progreso') ? (q.updated_at || null) : null;
    }
    function stepDate(status, quote, history, sessions, stage, now) {
        var q = quote || {};
        switch (status) {
            case 'pending': return q.created_at;
            case 'responded': return historyDate(history, 'responded') || q.artist_responded_at;
            case 'client_approved': return historyDate(history, 'client_approved') || q.client_approved_at || null;
            case 'in_progress': return workStartedAt(q, history, sessions, stage, now);
            case 'artist_completed': return historyDate(history, 'artist_completed') || q.artist_completed_at;
            case 'completed': return historyDate(history, 'completed') || q.client_completed_at;
            default: return null;
        }
    }
    function timeline(quote, history, stage, sessions, now) {
        var current = STAGE_INDEX[stage] == null ? 0 : STAGE_INDEX[stage];
        return TIMELINE_STEPS.map(function (step, index) {
            var state = index < current ? 'done' : (index === current ? 'current' : 'future');
            var at = state === 'future' ? null : stepDate(step.status, quote, history, sessions, stage, now);
            return {
                status: step.status,
                label: step.label,
                state: state,
                alert: state === 'current' && stage === 'dispute',
                date: state === 'future' ? '—' : (at ? dayMonth(at) : '—')
            };
        });
    }

    /* ------------------------------ historial ------------------------------ */
    var PRIORITY = { high: 'alta', alta: 'alta', medium: 'media', media: 'media', low: 'baja', baja: 'baja' };

    function firstSessionDate(sessions) {
        var withDate = orderedSessions(sessions).filter(function (s) { return toDate(s.session_date); });
        return withDate.length ? withDate[0].session_date : null;
    }
    function responseSummary(quote) {
        var q = quote || {};
        var parts = [];
        var amount = numberFrom(q.artist_budget_amount);
        if (amount != null) parts.push(money(amount, q.artist_budget_currency || q.client_budget_currency));
        var count = intFrom(q.tattoo_estimated_sessions) || intFrom(q.final_sessions);
        if (count) parts.push(sessionsLabel(count));
        var dur = durationShort(q.artist_session_minutes);
        if (dur) parts.push(dur);
        return parts.length ? 'Respuesta enviada: ' + parts.join(' · ') + '.' : 'Respuesta enviada al cliente.';
    }
    function agreementSummary(quote, sessions) {
        var q = quote || {};
        var parts = [];
        var amount = numberFrom(q.final_budget_amount != null ? q.final_budget_amount : q.artist_budget_amount);
        if (amount != null) parts.push(money(amount, q.final_budget_currency || q.artist_budget_currency || q.client_budget_currency));
        var count = agreedSessions(q);
        if (count) parts.push(sessionsLabel(count));
        var first = firstSessionDate(sessions);
        if (first) parts.push('primera ' + dayMonthYear(first));
        return parts.length ? 'Acuerdo confirmado: ' + parts.join(' · ') + '.' : 'Acuerdo confirmado con el cliente.';
    }
    function sessionDoneCopy(session, number) {
        var parts = ['Sesión ' + number + ' registrada como realizada'];
        var hours = numberFrom(session.duration_hours);
        if (hours) parts.push(durationShort(hours * 60));
        var photos = Array.isArray(session.photo_urls) ? session.photo_urls.length : 0;
        if (photos) parts.push(photos + (photos === 1 ? ' foto' : ' fotos'));
        return parts.join(' · ') + '.';
    }
    var STATUS_COPY = {
        client_approved: null, // agreementSummary
        in_progress: 'Trabajo iniciado. Gestión de sesiones habilitada.',
        artist_completed: 'Entrega enviada al cliente para su aprobación.',
        completed: 'Cliente aprobó la entrega. Cotización completada.',
        client_rejected: 'El cliente rechazó la propuesta.',
        cancelled: 'Solicitud rechazada por vos.',
        expired: 'La cotización venció sin respuesta.'
    };

    // Orden del ciclo de vida para eventos del mismo día: la sesión puede
    // guardarse unos ms antes que quote_status (o fecharse por session_date),
    // pero "Trabajo iniciado" va antes que "Sesión N registrada" (801:581) y la
    // entrega después de la última sesión.
    var EVENT_RANK = {
        created: 0, viewed: 1, responded: 2, approved: 3, client_approved: 3,
        client_rejected: 4, cancelled: 4, expired: 4, in_progress: 4,
        session: 5, artist_completed: 6, dispute: 7, 'dispute-resp': 8, 'dispute-res': 9, completed: 10
    };
    function eventRank(key) {
        var k = String(key || '');
        if (EVENT_RANK[k] != null) return EVENT_RANK[k];
        if (/^session-/.test(k)) return EVENT_RANK.session;
        if (/^dispute-resp-/.test(k)) return EVENT_RANK['dispute-resp'];
        if (/^dispute-res-/.test(k)) return EVENT_RANK['dispute-res'];
        if (/^dispute-/.test(k)) return EVENT_RANK.dispute;
        return EVENT_RANK.session;
    }

    function historyEvents(quote, history, sessions, disputes, now) {
        var q = quote || {};
        var stage = deriveStage(q, sessions, disputes);
        var events = [];
        var seen = {};
        function push(at, text, key) {
            if (!toDate(at) || !text) return;
            var k = key + '|' + isoDay(at) + '|' + text;
            if (seen[k]) return;
            seen[k] = true;
            events.push({ at: at, text: text, order: events.length, day: isoDay(at), rank: eventRank(key) });
        }
        push(q.created_at, q.source === 'job_board'
            ? 'Solicitud creada por el cliente desde el job board.'
            : 'Solicitud creada por el cliente desde el cotizador.', 'created');
        if (q.artist_viewed_at) {
            var priority = PRIORITY[String(q.priority || '').toLowerCase()];
            push(q.artist_viewed_at, 'Vista por vos.' + (priority ? ' Prioridad asignada: ' + priority + '.' : ''), 'viewed');
        }

        var rows = (Array.isArray(history) ? history : []).filter(function (h) { return h && h.new_status && h.new_status !== 'pending' && h.new_status !== 'in_progress_draft'; });
        var statusSeen = {};
        rows.forEach(function (h) {
            statusSeen[h.new_status] = true;
            if (h.new_status === 'responded') push(h.changed_at, responseSummary(q), 'responded');
            else if (h.new_status === 'client_approved') push(h.changed_at, agreementSummary(q, sessions), 'approved');
            else if (STATUS_COPY[h.new_status]) push(h.changed_at, STATUS_COPY[h.new_status], h.new_status);
            else if (h.notes) push(h.changed_at, String(h.notes), h.new_status);
        });
        // Fallbacks cuando el historial no registró la transición.
        if (!statusSeen.responded && q.artist_responded_at && q.quote_status !== 'pending') push(q.artist_responded_at, responseSummary(q), 'responded');
        if (!statusSeen.artist_completed && q.artist_completed_at) push(q.artist_completed_at, STATUS_COPY.artist_completed, 'artist_completed');
        if (!statusSeen.completed && q.client_completed_at) push(q.client_completed_at, STATUS_COPY.completed, 'completed');
        // "Trabajo iniciado" sin fila: misma fecha que el paso "En progreso" del
        // timeline, y sigue en el historial después de la entrega.
        if (!statusSeen.in_progress) push(workStartedAt(q, history, sessions, stage, now), STATUS_COPY.in_progress, 'in_progress');
        // Estado actual sin fila en el historial (backend sin trigger): se fecha con updated_at.
        var cur = q.quote_status;
        if (cur && !statusSeen[cur] && q.updated_at && ['client_approved', 'client_rejected', 'cancelled', 'expired'].indexOf(cur) !== -1) {
            push(q.updated_at, cur === 'client_approved' ? agreementSummary(q, sessions) : STATUS_COPY[cur], cur);
        }

        orderedSessions(sessions).forEach(function (s, i) {
            if (s.status === 'completed') push(sessionDoneAt(s, now), sessionDoneCopy(s, intFrom(s.session_number) || i + 1), 'session-' + (s.id || i));
        });
        (Array.isArray(disputes) ? disputes : []).forEach(function (d) {
            push(d.created_at, 'Cliente inició una disputa. Entrega retenida.', 'dispute-' + d.id);
            if (d.artist_responded_at) push(d.artist_responded_at, 'Respondiste la disputa.', 'dispute-resp-' + d.id);
            if (d.status === 'resolved' && d.resolved_at) push(d.resolved_at, 'Disputa resuelta por soporte.', 'dispute-res-' + d.id);
        });

        // Día → etapa del ciclo de vida → hora → orden de alta.
        return events.sort(function (a, b) {
            if (a.day !== b.day) return a.day < b.day ? -1 : 1;
            return (a.rank - b.rank) || (toDate(a.at) - toDate(b.at)) || (a.order - b.order);
        }).map(function (e) { return { date: dayMonth(e.at), text: e.text, at: e.at }; });
    }

    /* ------------------------- escenario solo-preview ------------------------- */
    // ?estado=<clave> en preview/demo: arma en memoria el recorrido de cada frame
    // sobre la cotización real (las acciones quedan deshabilitadas).
    var PREVIEW_STAGES = {
        pendiente: 'pending', respondida: 'responded', aprobada: 'approved',
        'en-progreso': 'in_progress', listo: 'ready', completada: 'completed', disputa: 'dispute'
    };
    var FIGMA_DISPUTE = {
        title: 'El relleno del sector lumbar quedó incompleto',
        description: 'El cliente indica que la zona inferior no coincide con la referencia aprobada y pide una sesión de corrección antes de cerrar el proyecto.',
        evidence: [{ name: 'reclamo-foto-01.jpg', url: '' }, { name: 'referencia-aprobada.jpg', url: '' }]
    };

    function atDay(now, offsetDays, hh, mm) {
        var base = toDate(now) || new Date();
        var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays, hh == null ? 12 : hh, mm || 0, 0, 0);
        return d.toISOString();
    }

    function previewScenario(key, quote, sessionsReal, now, assets) {
        var stage = PREVIEW_STAGES[key];
        if (!stage || !quote) return null;
        var photos = Array.isArray(assets) && assets.length ? assets : [];
        // Los frames muestran 3 sesiones acordadas: el escenario usa al menos 3.
        var count = Math.max(agreedSessions(quote), 3);
        var minutes = minutesFrom(quote.artist_session_minutes) || 150;
        var budget = numberFrom(quote.final_budget_amount) || numberFrom(quote.artist_budget_amount) || numberFrom(quote.client_budget_amount) || 410000;
        var currency = quote.final_budget_currency || quote.artist_budget_currency || quote.client_budget_currency || 'USD';
        var q = Object.assign({}, quote, {
            dispute_status: 'none', artist_completed_at: null, client_completed_at: null,
            priority: quote.priority || 'high', artist_session_minutes: minutes,
            tattoo_estimated_sessions: count, artist_budget_amount: numberFrom(quote.artist_budget_amount) || budget,
            artist_budget_currency: currency
        });
        var history = [];
        var sessions = [];
        var disputes = [];
        function h(status, offset) { history.push({ id: 'pv-' + status, new_status: status, changed_at: atDay(now, offset, 11, 0) }); }
        function sess(n, offset, status, photoCount) {
            sessions.push({
                id: -1000 - n, quotation_id: quote.id, session_number: n,
                session_date: offset == null ? null : atDay(now, offset, 15, 0),
                duration_hours: status === 'completed' ? Math.round((minutes + 10) / 6) / 10 : minutes / 60,
                status: status, notes: null,
                photo_urls: photoCount ? photos.slice(0, photoCount) : []
            });
        }
        var agreed = { final_budget_amount: budget, final_budget_currency: currency, final_sessions: count,
            final_comment: quote.final_comment || 'Va a llevar un amigo. Solicita anestesia.' };

        if (stage === 'pending') {
            Object.assign(q, { quote_status: 'pending', created_at: atDay(now, -1, 10, 0), artist_viewed_at: atDay(now, 0, 9, 0), artist_responded_at: null,
                final_budget_amount: null, final_sessions: null });
        } else if (stage === 'responded') {
            Object.assign(q, { quote_status: 'responded', created_at: atDay(now, -3, 10, 0), artist_viewed_at: atDay(now, -2, 9, 0), artist_responded_at: atDay(now, -1, 11, 0),
                final_budget_amount: null, final_sessions: null });
            h('responded', -1);
        } else {
            var start = stage === 'approved' ? -6 : -42;
            Object.assign(q, agreed, { created_at: atDay(now, start, 10, 0), artist_viewed_at: atDay(now, start + 1, 9, 0), artist_responded_at: atDay(now, start + 2, 11, 0) });
            h('responded', start + 2);
            h('client_approved', start + 4);
            if (stage === 'approved') {
                q.quote_status = 'client_approved';
                sess(1, 20, 'scheduled');
                for (var i = 2; i <= count; i += 1) sess(i, null, 'scheduled');
            } else {
                h('in_progress', -21);
                q.quote_status = 'in_progress';
                sess(1, -21, 'completed', 3);
                if (stage === 'in_progress') {
                    sess(2, 7, 'scheduled');
                    for (var j = 3; j <= count; j += 1) sess(j, null, 'scheduled');
                } else {
                    for (var k = 2; k <= count; k += 1) sess(k, -21 + Math.round((k - 1) * 17 / (count - 1)), 'completed', 3);
                }
                if (stage === 'completed' || stage === 'dispute') {
                    q.quote_status = stage === 'completed' ? 'completed' : 'artist_completed';
                    q.artist_completed_at = atDay(now, -3, 18, 0);
                    h('artist_completed', -3);
                }
                if (stage === 'completed') {
                    q.client_completed_at = atDay(now, -1, 12, 0);
                    h('completed', -1);
                }
                if (stage === 'dispute') {
                    q.dispute_status = 'open';
                    disputes.push(Object.assign({ id: -1, quotation_id: quote.id, quote_id: quote.quote_id, status: 'open', created_at: atDay(now, -2, 10, 0),
                        artist_response: null, artist_responded_at: null }, FIGMA_DISPUTE));
                }
            }
        }
        // Las sesiones sin fecha no tienen session_date: quedan como "sin agendar".
        sessions = sessions.map(function (s) { return s.session_date ? s : Object.assign({}, s, { status: 'scheduled' }); });
        return { stage: stage, quote: q, sessions: sessions, history: history, disputes: disputes, readOnly: true };
    }

    /* --------------------------- notas de trabajo --------------------------- */
    var BLOCK_TYPES = ['text', 'title', 'list', 'checklist', 'quote', 'separator', 'image'];
    var BLOCK_LABELS = { text: 'Texto', title: 'Título', list: 'Lista', checklist: 'Checklist', quote: 'Cita', separator: 'Separador', image: 'Imagen' };
    var blockSeq = 0;
    function blockId() { blockSeq += 1; return 'b' + Date.now().toString(36) + blockSeq.toString(36); }
    function block(type, text, extra) {
        return Object.assign({ id: blockId(), type: type, text: text || '', checked: false, url: '' }, extra || {});
    }
    var NOTE_TEMPLATES = [
        { key: 'brief', label: 'Brief del proyecto', build: function (quote) {
            var q = quote || {};
            var subject = q.project_description || styleName(q.tattoo_style);
            var zone = String(q.tattoo_body_part || '').toLowerCase();
            var summary = [subject !== 'Sin definir' ? subject : '', zone].filter(Boolean).join(', ');
            return [
                block('title', 'Brief del proyecto'),
                block('text', summary ? summary + '.' : ''),
                block('list', 'Referencias aprobadas por el cliente'),
                block('list', 'Stencil en dos partes')
            ];
        } },
        { key: 'preparacion', label: 'Preparación de sesión', build: function () {
            return [block('title', 'Preparación de sesión'), block('checklist', 'Imprimir stencil'), block('checklist', 'Agujas 11RL y 7RS'), block('checklist', 'Confirmar anestesia')];
        } },
        { key: 'seguimiento', label: 'Seguimiento', build: function () {
            return [block('title', 'Seguimiento'), block('text', 'Cicatrización de la primera sesión: sin irritación al día 7.')];
        } },
        { key: 'cuidados', label: 'Cuidados', build: function () {
            return [block('title', 'Cuidados post sesión'), block('list', 'Lavar con jabón neutro dos veces al día'), block('list', 'Sin sol directo por 15 días')];
        } },
        { key: 'pendientes', label: 'Pendientes', build: function () {
            return [block('title', 'Pendientes'), block('checklist', 'Cobrar saldo de la sesión 2'), block('checklist', 'Enviar fotos del avance')];
        } }
    ];
    function templateByKey(key) {
        return NOTE_TEMPLATES.find(function (t) { return t.key === key; }) || null;
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function stripHtml(text) {
        return String(text == null ? '' : text)
            .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    }

    // Contenido guardado en quotation_notes.content (jsonb) con bloques
    // compatibles con EditorJS (el visor legacy del drawer sigue leyéndolos).
    function blocksFromContent(content) {
        var raw = content;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_) { raw = { blocks: [{ type: 'paragraph', data: { text: raw } }] }; }
        }
        var list = raw && Array.isArray(raw.blocks) ? raw.blocks : [];
        var out = [];
        list.forEach(function (b) {
            var data = (b && b.data) || {};
            switch (b && b.type) {
                case 'header': out.push(block('title', stripHtml(data.text))); break;
                case 'paragraph': out.push(block('text', stripHtml(data.text))); break;
                case 'list': (data.items || []).forEach(function (item) {
                    out.push(block('list', stripHtml(typeof item === 'string' ? item : (item && (item.content || item.text)) || '')));
                }); break;
                case 'checklist': (data.items || []).forEach(function (item) {
                    out.push(block('checklist', stripHtml(item && item.text), { checked: !!(item && item.checked) }));
                }); break;
                case 'quote': out.push(block('quote', stripHtml(data.text))); break;
                case 'delimiter': out.push(block('separator')); break;
                case 'image': out.push(block('image', stripHtml(data.caption), { url: (data.file && data.file.url) || data.url || '' })); break;
                default: if (data.text) out.push(block('text', stripHtml(data.text)));
            }
        });
        return out;
    }
    function contentFromBlocks(blocks, tags, template) {
        return {
            time: Date.now(),
            version: 'wo-work-notes-1',
            template: template || null,
            tags: (tags || []).slice(0, 8),
            blocks: (blocks || []).map(function (b) {
                var text = escapeHtml(b.text || '');
                switch (b.type) {
                    case 'title': return { id: b.id, type: 'header', data: { text: text, level: 3 } };
                    case 'list': return { id: b.id, type: 'list', data: { style: 'unordered', items: [text] } };
                    case 'checklist': return { id: b.id, type: 'checklist', data: { items: [{ text: text, checked: !!b.checked }] } };
                    case 'quote': return { id: b.id, type: 'quote', data: { text: text, caption: '', alignment: 'left' } };
                    case 'separator': return { id: b.id, type: 'delimiter', data: {} };
                    case 'image': return { id: b.id, type: 'image', data: { file: { url: b.url || '' }, caption: text } };
                    default: return { id: b.id, type: 'paragraph', data: { text: text } };
                }
            })
        };
    }
    function tagsFromContent(content) {
        var raw = content;
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = null; } }
        return raw && Array.isArray(raw.tags) ? raw.tags.filter(Boolean).map(String) : [];
    }
    function countBlocks(content) { return blocksFromContent(content).length; }
    function blocksLabel(n) { return n + (n === 1 ? ' bloque' : ' bloques'); }
    function isEmptyNote(blocks, tags, title) {
        var hasText = (blocks || []).some(function (b) { return b.type === 'separator' || String(b.text || '').trim() || String(b.url || '').trim(); });
        return !hasText && !(tags || []).length && (!title || title === 'Nueva nota');
    }
    function noteDateLabel(value, now) {
        if (sameDay(value, now || new Date())) return 'HOY';
        return dayMonthYear(value);
    }
    function normalizeTag(value) {
        return String(value || '').trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 24).toLowerCase();
    }
    function noteToMarkdown(note) {
        var blocks = blocksFromContent(note && note.content);
        var tags = tagsFromContent(note && note.content);
        var lines = ['## ' + ((note && note.title) || 'Nota sin título'), '_' + dayMonthYear(note && (note.note_date || note.updated_at || note.created_at)) + '_', ''];
        blocks.forEach(function (b) {
            switch (b.type) {
                case 'title': lines.push('### ' + b.text); break;
                case 'list': lines.push('- ' + b.text); break;
                case 'checklist': lines.push('- [' + (b.checked ? 'x' : ' ') + '] ' + b.text); break;
                case 'quote': lines.push('> ' + b.text); break;
                case 'separator': lines.push('---'); break;
                case 'image': lines.push('![' + (b.text || 'imagen') + '](' + b.url + ')'); break;
                default: lines.push(b.text);
            }
        });
        if (tags.length) lines.push('', 'Etiquetas: ' + tags.join(', '));
        return lines.join('\n');
    }

    return {
        DAY: DAY,
        MONTHS: MONTHS,
        // formatos
        toDate: toDate, dayMonth: dayMonth, dayMonthYear: dayMonthYear, timeOf: timeOf, dateTime: dateTime,
        chatStamp: chatStamp, isoDay: isoDay, sameDay: sameDay, localInputValue: localInputValue,
        numberFrom: numberFrom, intFrom: intFrom, money: money, moneyRange: moneyRange, groupThousands: groupThousands,
        minutesFrom: minutesFrom, splitMinutes: splitMinutes, durationLong: durationLong, durationShort: durationShort,
        hoursLabel: hoursLabel, sessionsLabel: sessionsLabel, initials: initials, styleName: styleName,
        bodyZone: bodyZone, isFlexible: isFlexible, preferredDateLabel: preferredDateLabel,
        // estados
        STAGE_META: STAGE_META, deriveStage: deriveStage, stageMeta: stageMeta, isPreAgreement: isPreAgreement,
        showsAgreement: showsAgreement, showsSessions: showsSessions, commandActions: commandActions,
        openDispute: openDispute, agreedSessions: agreedSessions, orderedSessions: orderedSessions,
        sessionSlots: sessionSlots, slotCounts: slotCounts, sessionRowActions: sessionRowActions,
        firstSessionDate: firstSessionDate,
        // timeline / historial
        TIMELINE_STEPS: TIMELINE_STEPS, timeline: timeline, historyEvents: historyEvents,
        sessionDoneAt: sessionDoneAt, workStartedAt: workStartedAt,
        responseSummary: responseSummary, agreementSummary: agreementSummary,
        // preview
        PREVIEW_STAGES: PREVIEW_STAGES, previewScenario: previewScenario,
        // notas
        BLOCK_TYPES: BLOCK_TYPES, BLOCK_LABELS: BLOCK_LABELS, NOTE_TEMPLATES: NOTE_TEMPLATES, templateByKey: templateByKey,
        block: block, blocksFromContent: blocksFromContent, contentFromBlocks: contentFromBlocks, tagsFromContent: tagsFromContent,
        countBlocks: countBlocks, blocksLabel: blocksLabel, isEmptyNote: isEmptyNote, noteDateLabel: noteDateLabel,
        normalizeTag: normalizeTag, noteToMarkdown: noteToMarkdown, escapeHtml: escapeHtml, stripHtml: stripHtml
    };
}));
