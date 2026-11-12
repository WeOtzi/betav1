/*
 * WE ÖTZI · Modelo puro del calendario (ronda 3, grupo "calendario").
 * Sin DOM ni red: lo usan calendar-repo.js (mural), wo-artist-menu.js (aviso
 * in-app de recordatorios), script.js (cotizador: días ocupados) y los tests
 * (tests/r3-calendario.test.js).
 *
 *   - parsePreferredDate(): fecha preferida del cliente (texto libre de
 *     quotations_db.client_preferred_date) → { start, end } ISO o null.
 *   - pendingRequestEvents(): "Solicitud pendiente" del mural (801:542), una
 *     proyección de solo lectura de las cotizaciones pendientes con fecha.
 *   - reminderOccurrences() / currentReminderOccurrence(): recordatorios de
 *     artist_reminders con hora (due_at) y repetición semanal con fin.
 *   - busyDaysIndex() / dayAvailability(): respuesta de la RPC pública
 *     list_artist_public_busy_days para el selector de fecha del cotizador.
 *   - tripPayloadFromEvent(): guest spot / convención del calendario → viaje
 *     de Travel (create_artist_trip).
 *
 * Expone window.WeotziCalendarModel; en Node, module.exports.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root) root.WeotziCalendarModel = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEK_MS = 7 * DAY_MS;
    const MAX_OCCURRENCES = 104;
    // Abreviaturas que escribe el cotizador (script.js MONTHS_SHORT_ES) y
    // variantes comunes ("Set", "Sept", nombres completos).
    const MONTH_INDEX = {
        ene: 0, enero: 0, feb: 1, febrero: 1, mar: 2, marzo: 2, abr: 3, abril: 3,
        may: 4, mayo: 4, jun: 5, junio: 5, jul: 6, julio: 6, ago: 7, agosto: 7,
        sep: 8, sept: 8, set: 8, septiembre: 8, setiembre: 8, oct: 9, octubre: 9,
        nov: 10, noviembre: 10, dic: 11, diciembre: 11,
    };
    // Estados en los que la cotización espera respuesta del artista.
    const PENDING_STATUSES = new Set(['pending', 'pendiente', 'new', 'nueva']);
    const BUSY_STATUSES = new Set(['unavailable', 'full', 'available']);

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function isoDate(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function validYmd(year, month, day) {
        const date = new Date(year, month, day);
        return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
            ? isoDate(date)
            : null;
    }

    function asDate(value) {
        if (value == null || value === '') return null;
        const date = value instanceof Date ? new Date(value) : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function localDate(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!match) return null;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function addDays(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
    }

    function normalize(text) {
        return String(text == null ? '' : text)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().trim();
    }

    // "2026-09-26" · "9 Oct 2026" · "01 Ago 2026 a 30 Ago 2026".
    // Textos sin fecha ("Lo antes posible", "Flexible", "Este mes", "Sin
    // fecha", "Flexible durante Junio 2026") → null: no se inventa un día.
    function parseOneDate(text) {
        const value = normalize(text);
        let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (match) return validYmd(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        match = /^(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?\s*(?:de\s+)?(\d{4})$/.exec(value);
        if (!match || MONTH_INDEX[match[2]] == null) return null;
        return validYmd(Number(match[3]), MONTH_INDEX[match[2]], Number(match[1]));
    }

    function parsePreferredDate(text) {
        const value = String(text == null ? '' : text).trim();
        if (!value) return null;
        const parts = value.split(/\s+(?:a|al|-|–|hasta)\s+/i);
        if (parts.length === 2) {
            const start = parseOneDate(parts[0]);
            const end = parseOneDate(parts[1]);
            if (start && end) return start <= end ? { start, end } : { start: end, end: start };
            return null;
        }
        const single = parseOneDate(value);
        return single ? { start: single, end: single } : null;
    }

    function quoteCode(quote) {
        if (!quote) return '';
        if (quote.quote_id) return String(quote.quote_id);
        return `COT-${String(quote.id).slice(-4).toUpperCase()}`;
    }

    function quoteProject(quote) {
        const text = String(quote?.project_description || quote?.tattoo_idea_description || '').trim();
        return text.length > 48 ? `${text.slice(0, 47).trim()}…` : text;
    }

    function formatShortRange(range) {
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        const label = (iso) => {
            const date = localDate(iso);
            return date ? `${date.getDate()} ${months[date.getMonth()]}` : iso;
        };
        return range.start === range.end ? label(range.start) : `${label(range.start)} al ${label(range.end)}`;
    }

    function isPendingQuote(quote) {
        if (!quote || quote.is_archived) return false;
        return PENDING_STATUSES.has(String(quote.quote_status || '').toLowerCase());
    }

    // Cotización pendiente con fecha → evento de solo lectura en el mural.
    // Un rango corto (≤ 7 días) se dibuja completo; uno más largo solo en su
    // primer día (con el rango en las notas) para no cubrir el mes entero.
    function pendingRequestEvent(quote) {
        if (!isPendingQuote(quote)) return null;
        const range = parsePreferredDate(quote.client_preferred_date);
        if (!range) return null;
        const start = localDate(range.start);
        const last = localDate(range.end);
        if (!start || !last) return null;
        const spanDays = Math.round((last - start) / DAY_MS) + 1;
        const end = addDays(spanDays <= 7 ? last : start, 1);
        const client = String(quote.client_full_name || '').trim() || 'Cliente';
        const project = quoteProject(quote);
        const code = quoteCode(quote);
        const flexible = String(quote.client_flexible_dates) === 'true' || spanDays > 1;
        const note = flexible
            ? `Fecha preferida: ${formatShortRange(range)} (flexible).`
            : `Fecha preferida: ${formatShortRange(range)}.`;
        return {
            id: `pending_request:${quote.id}`,
            baseId: null,
            sourceType: 'pending_request',
            sourceId: String(quote.id),
            readonly: true,
            href: `/my-quotations/detail?id=${encodeURIComponent(quote.quote_id || quote.id)}`,
            type: 'pending_request',
            title: project ? `${client} — ${project}` : `${client} — solicitud`,
            clientName: client,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay: true,
            location: '',
            notes: note,
            status: 'pending',
            recurrenceRule: 'none',
            recurrenceUntil: null,
            quotationId: String(quote.id),
            quoteCode: code,
            raw: quote,
        };
    }

    function pendingRequestEvents(quotes, rangeStart, rangeEnd) {
        const from = asDate(rangeStart);
        const to = asDate(rangeEnd);
        return (quotes || [])
            .map(pendingRequestEvent)
            .filter((event) => event && (!from || !to
                || (asDate(event.start) < to && asDate(event.end) > from)));
    }

    /* ------------------------------ recordatorios ------------------------------ */

    function reminderUntilLimit(reminder) {
        const until = reminder && reminder.recurrence_until ? localDate(reminder.recurrence_until) : null;
        return until ? addDays(until, 1) : null;
    }

    // Ocurrencias de un recordatorio con hora dentro de [rangeStart, rangeEnd).
    // Sin due_at (recordatorio de solo fecha del dashboard) → null: lo maneja
    // la proyección de "todo el día".
    function reminderOccurrences(reminder, rangeStart, rangeEnd) {
        const base = asDate(reminder && reminder.due_at);
        if (!base) return null;
        const from = asDate(rangeStart);
        const to = asDate(rangeEnd);
        if (!from || !to) return [];
        const weekly = reminder.recurrence_rule === 'weekly';
        if (!weekly) return base >= from && base < to ? [base] : [];
        const limit = reminderUntilLimit(reminder) || new Date(base.getTime() + 730 * DAY_MS);
        const first = Math.max(0, Math.ceil((from.getTime() - base.getTime()) / WEEK_MS));
        const occurrences = [];
        for (let index = first; index < MAX_OCCURRENCES; index += 1) {
            const occurrence = new Date(base.getTime() + index * WEEK_MS);
            if (occurrence >= to || occurrence >= limit) break;
            if (occurrence >= from) occurrences.push(occurrence);
        }
        return occurrences;
    }

    // Última ocurrencia ya vencida (<= now) de un recordatorio abierto, o null.
    function currentReminderOccurrence(reminder, now) {
        if (!reminder || reminder.completed_at) return null;
        const base = asDate(reminder.due_at);
        const current = asDate(now) || new Date();
        if (!base || base > current) return null;
        if (reminder.recurrence_rule !== 'weekly') return base;
        const index = Math.floor((current.getTime() - base.getTime()) / WEEK_MS);
        const occurrence = new Date(base.getTime() + index * WEEK_MS);
        const limit = reminderUntilLimit(reminder);
        if (limit && occurrence >= limit) return null;
        return index < MAX_OCCURRENCES ? occurrence : null;
    }

    // Próxima ocurrencia futura (> now), para programar el aviso in-app.
    function nextReminderOccurrence(reminder, now) {
        if (!reminder || reminder.completed_at) return null;
        const base = asDate(reminder.due_at);
        const current = asDate(now) || new Date();
        if (!base) return null;
        if (base > current) return base;
        if (reminder.recurrence_rule !== 'weekly') return null;
        const index = Math.floor((current.getTime() - base.getTime()) / WEEK_MS) + 1;
        const occurrence = new Date(base.getTime() + index * WEEK_MS);
        const limit = reminderUntilLimit(reminder);
        if ((limit && occurrence >= limit) || index >= MAX_OCCURRENCES) return null;
        return occurrence;
    }

    // Recordatorios cuyo horario ya llegó dentro de la ventana (por defecto
    // 24 h): son los que el menú muestra como aviso "Ahora".
    function dueReminderAlerts(reminders, now, windowMs) {
        const current = asDate(now) || new Date();
        const windowSize = Number(windowMs) > 0 ? Number(windowMs) : DAY_MS;
        return (reminders || []).map((reminder) => {
            const occurrence = currentReminderOccurrence(reminder, current);
            if (!occurrence || current.getTime() - occurrence.getTime() > windowSize) return null;
            return { reminder, occurrence };
        }).filter(Boolean);
    }

    /* ---------------------------- días ocupados ---------------------------- */

    // Filas de list_artist_public_busy_days → { 'YYYY-MM-DD': estado }.
    function busyDaysIndex(rows) {
        const index = {};
        (rows || []).forEach((row) => {
            const day = String(row && (row.busy_date || row.day) || '').slice(0, 10);
            const status = String(row && (row.busy_status || row.status) || '');
            if (/^\d{4}-\d{2}-\d{2}$/.test(day) && BUSY_STATUSES.has(status)) index[day] = status;
        });
        return index;
    }

    // Estado de un día para el selector del cliente.
    function dayAvailability(index, iso) {
        const status = index && index[iso];
        if (status === 'unavailable') return { status, selectable: false, label: 'Sin agenda ese día' };
        if (status === 'full') return { status, selectable: false, label: 'Agenda completa ese día' };
        if (status === 'available') return { status, selectable: true, label: 'Tiene turnos disponibles' };
        return { status: 'unknown', selectable: true, label: '' };
    }

    // Primer y último día del mes visible (para pedir la RPC por mes).
    function monthRange(year, month) {
        return {
            from: isoDate(new Date(year, month, 1)),
            to: isoDate(new Date(year, month + 1, 0)),
        };
    }

    /* ------------------------------ Travel ------------------------------ */

    // Guest spot / convención del calendario → argumentos de create_artist_trip.
    function tripPayloadFromEvent(input) {
        const data = input || {};
        const type = data.type === 'convention' ? 'convencion' : 'guest_spot';
        const city = String(data.city || '').trim();
        const country = String(data.country || '').trim();
        if (!city || !country) {
            const error = new Error('Para sumarlo a Travel completá ciudad y país.');
            error.code = 'VALIDATION';
            throw error;
        }
        const startDate = String(data.startDate || '').slice(0, 10);
        const endDate = String(data.endDate || data.startDate || '').slice(0, 10);
        if (!localDate(startDate) || !localDate(endDate) || endDate < startDate) {
            const error = new Error('Revisá las fechas: la fecha de fin no puede ser anterior al inicio.');
            error.code = 'VALIDATION';
            throw error;
        }
        const name = String(data.name || '').replace(/^Guest en\s+/i, '').trim();
        return {
            city: city.slice(0, 120),
            country: country.slice(0, 120),
            region: null,
            start_date: startDate,
            end_date: endDate,
            trip_type: type,
            studio_name_hint: type === 'guest_spot' && name ? name.slice(0, 120) : null,
            personal_notes: data.notes ? String(data.notes).trim().slice(0, 5000) : null,
            event_name: type === 'convencion' && name ? name.slice(0, 160) : null,
        };
    }

    // Fin exclusivo de un evento de todo el día que va de startIso a endIso
    // (ambos inclusive). endIso vacío o anterior → un solo día.
    function allDayRange(startIso, endIso) {
        const start = localDate(startIso);
        if (!start) return null;
        const last = localDate(endIso);
        const finalDay = last && last >= start ? last : start;
        return { start, end: addDays(finalDay, 1), days: Math.round((finalDay - start) / DAY_MS) + 1 };
    }

    return {
        DAY_MS,
        WEEK_MS,
        parsePreferredDate,
        isPendingQuote,
        pendingRequestEvent,
        pendingRequestEvents,
        reminderOccurrences,
        currentReminderOccurrence,
        nextReminderOccurrence,
        dueReminderAlerts,
        busyDaysIndex,
        dayAvailability,
        monthRange,
        tripPayloadFromEvent,
        allDayRange,
        isoDate,
        localDate,
    };
});
