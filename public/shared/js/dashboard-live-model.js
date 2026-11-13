/**
 * WE ÖTZI — Dashboard del artista · lógica pura de la capa viva (sin DOM)
 * ----------------------------------------------------------------------
 * Figma final w3JA83CcP5ISKjyOu87mx1 · 24:1425 (ronda 3, 12 nov 2026).
 *
 *   · Agenda del día   → turnos de quotation_sessions + eventos propios del
 *                        calendario (artist_calendar_events) en una sola lista.
 *   · Diseños          → etapa (boceto / entintado / final) y fecha límite
 *                        guardadas en quotations_db.design_stage/design_due_date.
 *   · Actividad        → cotizaciones + turnos + reseñas + fuentes registradas
 *                        por otros módulos (p. ej. "Pago recibido").
 *
 * UMD: `window.DashboardLiveModel` en el navegador y `require` en Node
 * (tests/r3-dashboard.test.js).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DashboardLiveModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DAY = 24 * 60 * 60 * 1000;
    var WEEKDAYS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

    function pad2(n) { return String(n).padStart(2, '0'); }
    function toDate(value) {
        if (!value) return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : new Date(value.getTime());
        var raw = String(value);
        var d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T12:00:00') : new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }
    function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function sameLocalDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function isoDateLocal(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function firstName(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        return parts[0] || '';
    }

    /* ===================================================================== *
     *  AGENDA DEL DÍA                                                         *
     * ===================================================================== */
    // Tipos de artist_calendar_events (migración 20260829145232). La
    // disponibilidad no es un compromiso: no entra en la agenda.
    var EVENT_TYPE_LABELS = {
        confirmed_session: 'Turno',
        pending_request: 'Solicitud',
        reservation: 'Reserva',
        blocked_day: 'Día bloqueado',
        guest_spot: 'Guest spot',
        convention: 'Convención',
        reminder: 'Recordatorio',
        personal: 'Evento personal'
    };
    // Cuentan como "sesiones programadas" del saludo: compromisos con clientes.
    var CLIENT_EVENT_TYPES = ['confirmed_session', 'pending_request', 'reservation'];

    function sessionState(status) {
        var s = String(status || '').toLowerCase();
        if (s === 'confirmed' || s === 'scheduled') return { cls: 'is-ok', txt: 'CONFIRMADO' };
        if (s === 'completed') return { cls: 'is-ok', txt: 'COMPLETADO' };
        if (s === 'pending' || s === 'tentative' || s === 'pending_confirmation' || s === 'rescheduled') return { cls: 'is-warn', txt: 'POR CONFIRMAR' };
        if (s === 'no_show') return { cls: 'is-warn', txt: 'NO ASISTIÓ' };
        return { cls: 'is-warn', txt: (status || 'POR CONFIRMAR').toString().toUpperCase() };
    }

    function eventState(event) {
        var type = event.type || event.event_type;
        var status = String(event.status || 'scheduled').toLowerCase();
        if (CLIENT_EVENT_TYPES.indexOf(type) > -1) {
            if (type === 'pending_request' || status === 'pending') return { cls: 'is-warn', txt: 'POR CONFIRMAR' };
            if (status === 'completed') return { cls: 'is-ok', txt: 'COMPLETADO' };
            return { cls: 'is-ok', txt: 'CONFIRMADO' };
        }
        return { cls: 'is-own', txt: String(EVENT_TYPE_LABELS[type] || 'Evento').toUpperCase() };
    }

    // Normaliza una ocurrencia de WeotziData.Calendar.listManualRange (o una
    // fila cruda de artist_calendar_events) a una fila de la agenda.
    function eventAgendaItem(event) {
        if (!event) return null;
        var type = event.type || event.event_type;
        if (!type || type === 'availability') return null;
        if (String(event.status || '').toLowerCase() === 'cancelled') return null;
        var start = toDate(event.start || event.starts_at);
        var end = toDate(event.end || event.ends_at);
        if (!start) return null;
        var allDay = !!(event.allDay != null ? event.allDay : event.all_day);
        var client = String(event.clientName || event.client_name || '').trim();
        var title = String(event.title || '').trim();
        var typeLabel = EVENT_TYPE_LABELS[type] || 'Evento';
        var detail = [];
        if (client) {
            // "Tomás Vega — reserva" → "Reserva"; si el título dice algo más, va.
            var cleanTitle = title.replace(new RegExp('^' + client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[—–-]\\s*', 'i'), '');
            detail.push(typeLabel);
            if (cleanTitle && cleanTitle.toLowerCase() !== typeLabel.toLowerCase()) detail.push(cleanTitle);
        } else if (title.toLowerCase() !== typeLabel.toLowerCase()) {
            detail.push(typeLabel);
        }
        if (event.notes && !client) detail.push(String(event.notes).split('\n')[0]);
        if (event.location) detail.push(String(event.location));
        var hours = !allDay && end ? Math.max(0, (end - start) / 3600000) : null;
        return {
            kind: 'event',
            id: 'event:' + (event.id || event.sourceId || start.toISOString()),
            start: start,
            end: end,
            allDay: allDay,
            who: client || title || typeLabel,
            detail: detail.filter(Boolean).slice(0, 3).join(' · '),
            state: eventState(event),
            durationHours: hours,
            countsAsSession: CLIENT_EVENT_TYPES.indexOf(type) > -1,
            href: '/calendar'
        };
    }

    // "Sesión 2/3" (Figma 24:1425); sin número, "Sesión"; sin total, "Sesión 2".
    function sessionLabel(number, total) {
        var n = parseInt(number, 10);
        var t = parseInt(total, 10);
        if (!isFinite(n) || n <= 0) return 'Sesión';
        return 'Sesión ' + n + (isFinite(t) && t >= n && t > 1 ? '/' + t : '');
    }

    function sessionAgendaItem(s, styleOf) {
        if (!s) return null;
        if (String(s.status || '').toLowerCase() === 'cancelled') return null;
        var start = toDate(s.session_date);
        if (!start) return null;
        var q = s.quotations_db || {};
        var detail = [];
        if (s.notes) {
            detail.push(s.notes);
        } else {
            detail.push(sessionLabel(s.session_number, q.final_sessions || q.tattoo_estimated_sessions));
            var style = typeof styleOf === 'function' ? styleOf(q.tattoo_style) : null;
            if (style) detail.push(style);
            if (q.tattoo_body_part) detail.push(q.tattoo_body_part);
        }
        var h = parseFloat(s.duration_hours);
        return {
            kind: 'session',
            id: 'session:' + s.id,
            start: start,
            allDay: false,
            who: q.client_full_name || 'Cliente',
            detail: detail.join(' · '),
            state: sessionState(s.status),
            durationHours: isFinite(h) && h > 0 ? h : null,
            countsAsSession: true,
            quoteId: q.quote_id || null,
            href: q.quote_id ? '/my-quotations/detail?id=' + encodeURIComponent(q.quote_id) : null
        };
    }

    // Une turnos y eventos propios. Devuelve { items, todayCount }:
    //  · items: los de HOY ordenados (todo el día primero); si hoy no hay nada,
    //    el próximo turno como orientación (como hacía la agenda original).
    //  · todayCount: compromisos con clientes de hoy (saludo del hero).
    function mergeAgenda(sessionRows, eventRows, now, styleOf) {
        now = toDate(now) || new Date();
        var sessions = (sessionRows || []).map(function (s) { return sessionAgendaItem(s, styleOf); }).filter(Boolean);
        var events = (eventRows || []).map(eventAgendaItem).filter(Boolean);
        var all = sessions.concat(events);
        var dayStart = startOfDay(now);
        var dayEnd = new Date(dayStart.getTime() + DAY);
        // Los eventos de todo el día que abarcan varios días (guest spot, día
        // bloqueado) se muestran mientras duren.
        var today = all.filter(function (it) {
            if (it.allDay && it.end) return it.start < dayEnd && it.end > dayStart;
            return sameLocalDay(it.start, now);
        });
        var seen = {};
        today = today.filter(function (it) { if (seen[it.id]) return false; seen[it.id] = true; return true; });
        today.sort(function (a, b) {
            if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
            return a.start - b.start;
        });
        var todayCount = today.filter(function (it) { return it.countsAsSession; }).length;
        if (today.length) return { items: today, todayCount: todayCount, fallback: false };
        var upcoming = sessions.filter(function (it) { return it.start >= startOfDay(now); })
            .sort(function (a, b) { return a.start - b.start; });
        return { items: upcoming.slice(0, 1), todayCount: 0, fallback: upcoming.length > 0 };
    }

    // Duración: 3H / 90M. Sin dato, vacío.
    function durationLabel(hours) {
        var h = parseFloat(hours);
        if (!isFinite(h) || h <= 0) return '';
        if (h < 1) return Math.round(h * 60) + 'M';
        if (Math.abs(h - Math.round(h)) < 0.01) return Math.round(h) + 'H';
        return Math.round(h * 60) + 'M';
    }

    function agendaTime(item, now) {
        now = toDate(now) || new Date();
        var d = item.start;
        if (item.allDay) return { hour: 'DÍA', day: 'COMPLETO' };
        var hour = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        var day = sameLocalDay(d, now) ? '' : WEEKDAYS[d.getDay()] + ' ' + pad2(d.getDate());
        return { hour: hour, day: day };
    }

    /* ===================================================================== *
     *  DISEÑOS EN PROCESO · etapa y fecha límite                             *
     * ===================================================================== */
    var DESIGN_STAGES = [
        { key: 'boceto', label: 'Boceto' },
        { key: 'entintado', label: 'Entintado' },
        { key: 'final', label: 'Final' }
    ];
    var STATUS_STAGE_FALLBACK = { client_approved: 'CONFIRMADA', artist_completed: 'LISTA PARA CLIENTE' };
    // Estados donde existe un diseño en proceso (los que lista el dashboard).
    var DESIGN_STATUSES = ['client_approved', 'artist_completed'];

    function normalizeStage(value) {
        var v = String(value == null ? '' : value).trim().toLowerCase();
        for (var i = 0; i < DESIGN_STAGES.length; i++) if (DESIGN_STAGES[i].key === v) return v;
        return null;
    }

    // Etapa visible de la tarjeta. Solo lee design_stage: current_step es el
    // paso del wizard del cliente y no se reutiliza.
    function designStageInfo(q) {
        q = q || {};
        var key = normalizeStage(q.design_stage);
        var ready = q.quote_status === 'artist_completed';
        if (key) {
            var stage = DESIGN_STAGES.filter(function (s) { return s.key === key; })[0];
            return { key: key, label: stage.label.toUpperCase(), cls: ' is-' + key, editable: true };
        }
        return {
            key: null,
            label: STATUS_STAGE_FALLBACK[q.quote_status] || String(q.quote_status || '').toUpperCase(),
            cls: ready ? ' is-final' : '',
            editable: DESIGN_STATUSES.indexOf(q.quote_status) > -1
        };
    }

    // Fecha del pie: LÍMITE (design_due_date) o, sin límite cargado, PRÓXIMA
    // sesión agendada. client_preferred_date es la preferencia del cliente y no
    // un límite del diseño.
    function designDeadline(q, sessions, now) {
        now = toDate(now) || new Date();
        var due = toDate(q && q.design_due_date);
        if (due) return { kind: 'limit', label: 'LÍMITE', date: due, overdue: startOfDay(due) < startOfDay(now) };
        var next = (sessions || [])
            .filter(function (s) { return String(s.status || '').toLowerCase() !== 'cancelled'; })
            .map(function (s) { return toDate(s.session_date); })
            .filter(function (d) { return d && d >= now; })
            .sort(function (a, b) { return a - b; })[0];
        if (next) return { kind: 'next', label: 'PRÓXIMA', date: next, overdue: false };
        return null;
    }

    // Validación del editor de etapa (la RPC repite los mismos chequeos).
    function validateDesignStage(input, now) {
        input = input || {};
        now = toDate(now) || new Date();
        var raw = input.stage == null ? '' : String(input.stage).trim();
        var stage = raw ? normalizeStage(raw) : null;
        if (raw && !stage) return { ok: false, error: 'Elegí una etapa: boceto, entintado o final.' };
        var dueRaw = input.due == null ? '' : String(input.due).trim();
        var due = null;
        if (dueRaw) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dueRaw) || !toDate(dueRaw)) return { ok: false, error: 'Revisá la fecha límite.' };
            var d = toDate(dueRaw);
            var max = new Date(now.getTime() + 5 * 365 * DAY);
            if (d.getFullYear() < 2000 || d > max) return { ok: false, error: 'La fecha límite está fuera de rango.' };
            due = dueRaw;
        }
        return { ok: true, stage: stage, due: due };
    }

    /* ===================================================================== *
     *  ACTIVIDAD RECIENTE                                                     *
     * ===================================================================== */
    var ACTIVITY_ICONS = {
        confirmation: 'check-circle', payment: 'dollar-sign', quote: 'mail', review: 'star',
        session: 'calendar', message: 'message-circle'
    };
    var ACTIVITY_WINDOW_DAYS = 14;

    function quoteActivity(q) {
        var name = q.client_full_name || q.client_name || 'Cliente';
        var s = String(q.quote_status || '').toLowerCase();
        var when = q.responded_at || q.updated_at || q.created_at;
        var href = q.quote_id ? '/my-quotations/detail?id=' + encodeURIComponent(q.quote_id) : null;
        if (s === 'pending') return { type: 'quote', icon: 'mail', txt: 'Nueva cotización de ' + name, when: q.created_at, href: href };
        if (s === 'responded' || s === 'artist_completed') return { type: 'quote', icon: 'corner-up-left', txt: 'Respondiste a ' + name, when: when, href: href };
        if (s === 'client_approved' || s === 'completed') return { type: 'confirmation', icon: 'check-circle', txt: name + ' aprobó tu cotización', when: when, href: href };
        if (s === 'client_rejected') return { type: 'quote', icon: 'x-circle', txt: name + ' rechazó tu cotización', when: when, href: href };
        return null;
    }

    // Turnos: confirmado por el cliente, agendado o completado en la ventana.
    function sessionActivity(s, quotesById, since) {
        if (!s) return null;
        var q = (quotesById && quotesById[s.quotation_id]) || s.quotations_db || {};
        var name = firstName(q.client_full_name) || 'Tu cliente';
        var status = String(s.status || '').toLowerCase();
        var href = q.quote_id ? '/my-quotations/detail?id=' + encodeURIComponent(q.quote_id) : null;
        var updated = toDate(s.updated_at) || toDate(s.created_at);
        var created = toDate(s.created_at);
        since = toDate(since);
        if (status === 'confirmed' && updated && (!since || updated >= since)) {
            return { type: 'confirmation', icon: ACTIVITY_ICONS.confirmation, txt: name + ' confirmó su turno', when: updated.toISOString(), href: href };
        }
        if (status === 'completed' && updated && (!since || updated >= since)) {
            return { type: 'session', icon: ACTIVITY_ICONS.session, txt: 'Completaste la ' + sessionLabel(s.session_number).toLowerCase() + ' con ' + name, when: updated.toISOString(), href: href };
        }
        if ((status === 'scheduled' || status === 'rescheduled') && created && (!since || created >= since)) {
            var d = toDate(s.session_date);
            var day = d ? ' · ' + pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) : '';
            return { type: 'session', icon: ACTIVITY_ICONS.session, txt: 'Turno agendado con ' + name + day, when: created.toISOString(), href: href };
        }
        return null;
    }

    // href: el panel de reseñas del perfil público (lo arma el dashboard con el
    // username del artista); sin username, la fila no es link.
    function reviewActivity(r, href) {
        if (!r) return null;
        var rating = parseInt(r.rating, 10);
        var who = String(r.reviewer_display_name || '').trim() || 'un cliente';
        var stars = isFinite(rating) && rating > 0 ? rating + '★' : '';
        return {
            type: 'review', icon: ACTIVITY_ICONS.review,
            txt: 'Reseña ' + (stars ? stars + ' ' : '') + 'de ' + who,
            when: r.approved_at || r.created_at,
            href: href || null
        };
    }

    // Ítems de fuentes externas (user_preferences.dashboard_activity del demo o
    // loaders registrados con WeotziData.DashboardActivity.registerSource).
    function externalActivity(item) {
        if (!item || !item.text) return null;
        return {
            type: item.type || 'other',
            icon: ACTIVITY_ICONS[item.type] || item.icon || 'circle',
            txt: item.text,
            when: item.created_at || item.when || new Date().toISOString(),
            href: item.href || null
        };
    }

    // Une, deduplica (mismo texto + mismo minuto) y ordena por fecha desc.
    function mergeActivity(lists, limit) {
        var seen = {};
        var out = [];
        (lists || []).forEach(function (list) {
            (list || []).forEach(function (ev) {
                if (!ev || !ev.txt) return;
                var t = toDate(ev.when);
                var key = ev.txt + '|' + (t ? Math.floor(t.getTime() / 60000) : '');
                if (seen[key]) return;
                seen[key] = true;
                out.push(ev);
            });
        });
        out.sort(function (a, b) { return (toDate(b.when) || 0) - (toDate(a.when) || 0); });
        return typeof limit === 'number' ? out.slice(0, limit) : out;
    }

    function activitySince(now, days) {
        now = toDate(now) || new Date();
        return new Date(now.getTime() - (days || ACTIVITY_WINDOW_DAYS) * DAY).toISOString();
    }

    return {
        // agenda
        EVENT_TYPE_LABELS: EVENT_TYPE_LABELS, CLIENT_EVENT_TYPES: CLIENT_EVENT_TYPES,
        sessionState: sessionState, eventState: eventState, sessionLabel: sessionLabel,
        eventAgendaItem: eventAgendaItem, sessionAgendaItem: sessionAgendaItem, mergeAgenda: mergeAgenda,
        durationLabel: durationLabel, agendaTime: agendaTime,
        // diseños
        DESIGN_STAGES: DESIGN_STAGES, DESIGN_STATUSES: DESIGN_STATUSES, normalizeStage: normalizeStage,
        designStageInfo: designStageInfo, designDeadline: designDeadline, validateDesignStage: validateDesignStage,
        // actividad
        ACTIVITY_ICONS: ACTIVITY_ICONS, ACTIVITY_WINDOW_DAYS: ACTIVITY_WINDOW_DAYS,
        quoteActivity: quoteActivity, sessionActivity: sessionActivity, reviewActivity: reviewActivity,
        externalActivity: externalActivity, mergeActivity: mergeActivity, activitySince: activitySince,
        // utilidades
        toDate: toDate, isoDateLocal: isoDateLocal, sameLocalDay: sameLocalDay
    };
}));
