/**
 * WE OTZI - Repositorio del calendario profesional
 * ------------------------------------------------
 * Figma final w3JA83CcP5ISKjyOu87mx1 · 801:542…801:554.
 *
 * Fuentes del mural (sin duplicar filas entre dominios):
 *   - artist_calendar_events: eventos manuales (reserva, disponibilidad, día
 *     bloqueado, guest spot y convención propios, recordatorio, personal) y
 *     reservas pendientes vinculadas a una cotización sin aprobar.
 *   - quotation_sessions: los turnos con cliente vinculados a una cotización
 *     aprobada SON sesiones de esa cotización. El calendario las crea, edita y
 *     borra en su tabla de origen, así el detalle de la cotización las ve igual.
 *   - artist_trips: guest spots y convenciones de Travel, solo lectura.
 *   - artist_reminders: recordatorios del dashboard con fecha, solo lectura
 *     (si reminders-repo.js está cargado).
 *
 * Columnas opcionales (migración 20261028140000_calendar_quote_links, no
 * aplicada todavía): artist_calendar_events.quotation_id y
 * quotation_sessions.location. Si el backend aún no las tiene, las escrituras
 * reintentan sin ellas y la página sigue funcionando.
 *
 * Carga: postgrest-client.js, quotations-repo.js y travel-repo.js primero.
 * Expone window.WeotziData.Calendar.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[calendar-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const run = D.run;
    const TABLE = 'artist_calendar_events';
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const QUOTE_SELECT = [
        'id', 'quote_id', 'quote_status', 'client_full_name', 'project_description',
        'tattoo_idea_description', 'tattoo_body_part', 'final_sessions',
        'tattoo_estimated_sessions', 'is_archived', 'sent_to_artist_at',
        'artist_responded_at', 'updated_at',
    ].join(', ');

    function asDate(value) {
        const date = value instanceof Date ? new Date(value) : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function localDate(value) {
        const date = new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function addDays(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
    }

    function overlaps(start, end, rangeStart, rangeEnd) {
        return start < rangeEnd && end > rangeStart;
    }

    // PostgREST responde PGRST204 ("Could not find the 'x' column … in the
    // schema cache") o 42703 (undefined_column) cuando la migración opcional
    // todavía no está aplicada.
    function isMissingColumn(error, column) {
        if (!error) return false;
        const code = error.code || error.cause?.code;
        const text = `${error.message || ''} ${error.cause?.message || ''}`;
        if (code !== 'PGRST204' && code !== '42703' && !/column/i.test(text)) return false;
        return new RegExp(`['"\\s.]${column}['"\\s]|${column}\\b`, 'i').test(text);
    }

    function quoteCode(quote) {
        if (!quote) return '';
        if (quote.quote_id) return String(quote.quote_id);
        return `COT-${String(quote.id).slice(-4).toUpperCase()}`;
    }

    function manualEvent(row, occurrenceStart, occurrenceEnd, occurrenceIndex) {
        return {
            id: `manual:${row.id}:${occurrenceIndex}`,
            baseId: row.id,
            sourceType: 'manual',
            sourceId: row.id,
            readonly: false,
            type: row.event_type,
            title: row.title,
            clientName: row.client_name || '',
            start: occurrenceStart.toISOString(),
            end: occurrenceEnd.toISOString(),
            allDay: !!row.all_day,
            location: row.location || '',
            notes: row.notes || '',
            status: row.status || 'scheduled',
            recurrenceRule: row.recurrence_rule || 'none',
            recurrenceUntil: row.recurrence_until || null,
            quotationId: row.quotation_id != null ? String(row.quotation_id) : null,
            raw: row,
        };
    }

    function expandManualRows(rows, rangeStart, rangeEnd) {
        const expanded = [];
        (rows || []).forEach((row) => {
            const baseStart = asDate(row.starts_at);
            const baseEnd = asDate(row.ends_at);
            if (!baseStart || !baseEnd || row.status === 'cancelled') return;

            const weekly = row.recurrence_rule === 'weekly';
            const until = row.recurrence_until
                ? addDays(localDate(row.recurrence_until), 1)
                : addDays(baseStart, 730);
            const last = weekly ? until : baseEnd;
            const firstIndex = weekly
                ? Math.max(0, Math.floor((rangeStart.getTime() - baseEnd.getTime()) / WEEK_MS))
                : 0;

            for (let index = firstIndex; index < 104; index += 1) {
                const occurrenceStart = new Date(baseStart.getTime() + (index * WEEK_MS));
                const occurrenceEnd = new Date(baseEnd.getTime() + (index * WEEK_MS));
                if (occurrenceStart >= last || occurrenceStart >= rangeEnd) break;
                if (overlaps(occurrenceStart, occurrenceEnd, rangeStart, rangeEnd)) {
                    expanded.push(manualEvent(row, occurrenceStart, occurrenceEnd, index));
                }
                if (!weekly) break;
            }
        });
        return expanded;
    }

    // Un turno con cliente vinculado a una cotización aprobada es una fila de
    // quotation_sessions: se edita y borra desde el calendario en su origen.
    function normalizeSession(session, quotation) {
        const start = asDate(session.session_date);
        if (!start) return null;
        const durationHours = Number(session.duration_hours) > 0 ? Number(session.duration_hours) : 1;
        const end = new Date(start.getTime() + (durationHours * 60 * 60 * 1000));
        const clientName = quotation?.client_full_name || 'Cliente';
        return {
            id: `quotation_session:${session.id}`,
            baseId: session.id,
            sourceType: 'quotation_session',
            sourceId: String(session.id),
            readonly: false,
            type: 'confirmed_session',
            title: `Sesión — ${clientName}`,
            clientName,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay: false,
            location: session.location || 'Estudio propio',
            notes: session.notes || '',
            status: session.status === 'cancelled' ? 'cancelled' : 'scheduled',
            sessionStatus: session.status || 'scheduled',
            recurrenceRule: 'none',
            recurrenceUntil: null,
            quotationId: quotation ? String(quotation.id) : String(session.quotation_id),
            quoteCode: quoteCode(quotation),
            raw: { session, quotation },
        };
    }

    // Travel es la fuente de los viajes: el calendario solo los muestra y
    // enlaza al itinerario (/artist/travel?trip=<id>).
    function normalizeTrip(trip) {
        const start = localDate(trip.start_date);
        const inclusiveEnd = localDate(trip.end_date);
        if (!start || !inclusiveEnd || trip.status === 'cancelado') return null;
        const end = addDays(inclusiveEnd, 1);
        const convention = trip.trip_type === 'convencion';
        const place = trip.studio_name_hint || trip.event_name || trip.city;
        return {
            id: `artist_trip:${trip.id}`,
            baseId: null,
            sourceType: 'artist_trip',
            sourceId: String(trip.id),
            readonly: true,
            href: `/artist/travel?trip=${encodeURIComponent(trip.id)}`,
            type: convention ? 'convention' : 'guest_spot',
            title: convention
                ? (trip.event_name || `Convención · ${trip.city}`)
                : `Guest en ${place}`,
            clientName: '',
            start: start.toISOString(),
            end: end.toISOString(),
            allDay: true,
            location: [trip.city, trip.country].filter(Boolean).join(', '),
            notes: trip.personal_notes || '',
            status: trip.status === 'pendiente' ? 'pending' : 'scheduled',
            recurrenceRule: 'none',
            recurrenceUntil: null,
            quotationId: null,
            raw: trip,
        };
    }

    // Recordatorios del dashboard (artist_reminders, reminders-repo.js) con
    // fecha: se muestran como "Recordatorio" de todo el día y se editan en el
    // dashboard. Los recordatorios con hora y repetición del calendario siguen
    // en artist_calendar_events (ver reporte: unificación propuesta).
    function normalizeDashboardReminder(reminder) {
        if (!reminder || reminder.completed_at || !reminder.due_date) return null;
        const start = localDate(String(reminder.due_date).slice(0, 10));
        if (!start) return null;
        return {
            id: `artist_reminder:${reminder.id}`,
            baseId: null,
            sourceType: 'artist_reminder',
            sourceId: String(reminder.id),
            readonly: true,
            href: `/artist/dashboard?modal=recordatorio&id=${encodeURIComponent(reminder.id)}`,
            type: 'reminder',
            title: reminder.title || 'Recordatorio',
            clientName: '',
            start: start.toISOString(),
            end: addDays(start, 1).toISOString(),
            allDay: true,
            location: '',
            notes: reminder.detail || '',
            status: 'scheduled',
            recurrenceRule: 'none',
            recurrenceUntil: null,
            quotationId: null,
            raw: reminder,
        };
    }

    async function listRemindersProjection(artistUserId, rangeStart, rangeEnd) {
        if (!D.Reminders || typeof D.Reminders.list !== 'function') return [];
        const reminders = await D.Reminders.list(artistUserId);
        return (reminders || [])
            .map(normalizeDashboardReminder)
            .filter((event) => event
                && overlaps(asDate(event.start), asDate(event.end), rangeStart, rangeEnd));
    }

    async function listSessionsProjection(artistUserId, rangeStart, rangeEnd) {
        if (!D.Quotations || !D.Sessions) return [];
        const quotations = await D.Quotations.listForArtist(artistUserId, {
            excludeArchived: false,
            excludeInProgress: false,
            select: QUOTE_SELECT,
            order: null,
        });
        if (!quotations.length) return [];
        const byId = new Map(quotations.map((quote) => [quote.id, quote]));
        const sessions = await D.Sessions.listByQuotationIds([...byId.keys()]);
        return sessions
            .map((session) => normalizeSession(session, byId.get(session.quotation_id)))
            .filter((event) => event && event.status !== 'cancelled'
                && overlaps(asDate(event.start), asDate(event.end), rangeStart, rangeEnd));
    }

    async function listTripsProjection(artistUserId, rangeStart, rangeEnd) {
        if (!D.Travel) return [];
        const trips = await D.Travel.listForArtist(artistUserId, '*');
        return trips
            .map(normalizeTrip)
            .filter((event) => event
                && overlaps(asDate(event.start), asDate(event.end), rangeStart, rangeEnd));
    }

    function cleanPayload(artistUserId, payload) {
        const row = {
            artist_user_id: artistUserId,
            event_type: payload.event_type,
            title: String(payload.title || '').trim(),
            client_name: payload.client_name ? String(payload.client_name).trim() : null,
            starts_at: payload.starts_at,
            ends_at: payload.ends_at,
            all_day: !!payload.all_day,
            location: payload.location ? String(payload.location).trim() : null,
            notes: payload.notes ? String(payload.notes).trim() : null,
            status: payload.status || 'scheduled',
            recurrence_rule: payload.recurrence_rule === 'weekly' ? 'weekly' : 'none',
            recurrence_until: payload.recurrence_until || null,
        };
        if (payload.quotation_id != null && payload.quotation_id !== '') {
            row.quotation_id = Number.isNaN(Number(payload.quotation_id))
                ? payload.quotation_id
                : Number(payload.quotation_id);
        } else if (Object.prototype.hasOwnProperty.call(payload, 'quotation_id')) {
            row.quotation_id = null;
        }
        return row;
    }

    // Sin la columna quotation_id la reserva se guarda igual y conserva la
    // referencia a la cotización en las notas.
    function withoutQuotationColumn(row, payload) {
        const copy = { ...row };
        delete copy.quotation_id;
        if (payload.quote_code) {
            const reference = `Cotización ${payload.quote_code}`;
            copy.notes = copy.notes && !copy.notes.includes(reference)
                ? `${copy.notes}\n${reference}`
                : (copy.notes || reference);
        }
        return copy;
    }

    async function writeManual(label, row, payload, execute) {
        try {
            return await execute(row);
        } catch (error) {
            if (!('quotation_id' in row) || !isMissingColumn(error, 'quotation_id')) throw error;
            console.warn(`[calendar] ${label}: falta artist_calendar_events.quotation_id; se guarda sin vínculo.`);
            return execute(withoutQuotationColumn(row, payload));
        }
    }

    function sessionPatch(payload) {
        const start = asDate(payload.starts_at);
        const end = asDate(payload.ends_at);
        const hours = start && end ? Math.max(0.25, (end - start) / 3600000) : 1;
        const patch = {
            quotation_id: Number.isNaN(Number(payload.quotation_id)) ? payload.quotation_id : Number(payload.quotation_id),
            session_date: payload.starts_at,
            duration_hours: Math.round(hours * 100) / 100,
            notes: payload.notes ? String(payload.notes).trim() : null,
        };
        if (payload.location) patch.location = String(payload.location).trim();
        return patch;
    }

    async function writeSession(label, patch, execute) {
        try {
            return await execute(patch);
        } catch (error) {
            if (!('location' in patch) || !isMissingColumn(error, 'location')) throw error;
            console.warn(`[calendar] ${label}: falta quotation_sessions.location; se guarda sin ubicación.`);
            const copy = { ...patch };
            delete copy.location;
            return execute(copy);
        }
    }

    function requireSessions() {
        if (!D.Sessions) throw new Error('No se pudo conectar con las sesiones de tus cotizaciones.');
        return D.Sessions;
    }

    const Calendar = {
        async listRange(artistUserId, rangeStartValue, rangeEndValue) {
            const rangeStart = asDate(rangeStartValue);
            const rangeEnd = asDate(rangeEndValue);
            if (!rangeStart || !rangeEnd) throw new Error('Rango de calendario inválido.');

            const { data: rows } = await run('calendar.listManual', (client) =>
                client.from(TABLE)
                    .select('*')
                    .eq('artist_user_id', artistUserId)
                    .neq('status', 'cancelled')
                    .order('starts_at', { ascending: true })
            );

            const projectionResults = await Promise.allSettled([
                listSessionsProjection(artistUserId, rangeStart, rangeEnd),
                listTripsProjection(artistUserId, rangeStart, rangeEnd),
                listRemindersProjection(artistUserId, rangeStart, rangeEnd),
            ]);
            projectionResults.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.warn(`[calendar] No se pudo cargar la proyección ${index + 1}:`, result.reason);
                }
            });

            const events = [
                ...expandManualRows(rows || [], rangeStart, rangeEnd),
                ...(projectionResults[0].status === 'fulfilled' ? projectionResults[0].value : []),
                ...(projectionResults[1].status === 'fulfilled' ? projectionResults[1].value : []),
                ...(projectionResults[2].status === 'fulfilled' ? projectionResults[2].value : []),
            ];

            const unique = new Map();
            events.forEach((event) => {
                const key = `${event.sourceType}:${event.sourceId}:${event.start}`;
                if (!unique.has(key)) unique.set(key, event);
            });
            return [...unique.values()].sort((a, b) => asDate(a.start) - asDate(b.start));
        },

        // Cotizaciones del artista + sus sesiones, para "Cotización a vincular".
        async listLinkableQuotes(artistUserId) {
            if (!D.Quotations) return { quotes: [], sessionsByQuoteId: new Map() };
            const quotes = await D.Quotations.listForArtist(artistUserId, {
                excludeArchived: true,
                excludeInProgress: false,
                select: QUOTE_SELECT,
                order: { column: 'updated_at', ascending: false },
            });
            const sessionsByQuoteId = new Map();
            if (quotes.length && D.Sessions) {
                const sessions = await D.Sessions.listByQuotationIds(quotes.map((quote) => quote.id));
                sessions.forEach((session) => {
                    const key = String(session.quotation_id);
                    if (!sessionsByQuoteId.has(key)) sessionsByQuoteId.set(key, []);
                    sessionsByQuoteId.get(key).push(session);
                });
            }
            return { quotes, sessionsByQuoteId };
        },

        async create(artistUserId, payload) {
            const row = cleanPayload(artistUserId, payload);
            return writeManual('create', row, payload, async (body) => {
                const { data } = await run('calendar.create', (client) =>
                    client.from(TABLE).insert([body]).select().single()
                );
                return data;
            });
        },

        async update(eventId, artistUserId, payload) {
            const row = cleanPayload(artistUserId, payload);
            delete row.artist_user_id;
            return writeManual('update', row, payload, async (body) => {
                const { data } = await run('calendar.update', (client) =>
                    client.from(TABLE)
                        .update(body)
                        .eq('id', eventId)
                        .eq('artist_user_id', artistUserId)
                        .select()
                        .single()
                );
                return data;
            });
        },

        async remove(eventId, artistUserId) {
            await run('calendar.remove', (client) =>
                client.from(TABLE).delete().eq('id', eventId).eq('artist_user_id', artistUserId)
            );
        },

        // Turno con cliente → nueva sesión de la cotización (session_number lo
        // asigna el trigger trg_set_quotation_session_number).
        async createQuoteSession(payload) {
            const Sessions = requireSessions();
            const patch = { ...sessionPatch(payload), session_number: null, status: 'scheduled' };
            return writeSession('createQuoteSession', patch, (body) => Sessions.create(body));
        },

        async updateQuoteSession(sessionId, payload) {
            const Sessions = requireSessions();
            return writeSession('updateQuoteSession', sessionPatch(payload), (body) => Sessions.update(sessionId, body));
        },

        async removeQuoteSession(sessionId) {
            const Sessions = requireSessions();
            await Sessions.delete(sessionId);
        },

        async checkConflicts(payload, excludeEventId = null) {
            const params = {
                p_starts_at: payload.starts_at,
                p_ends_at: payload.ends_at,
                p_recurrence_rule: payload.recurrence_rule === 'weekly' ? 'weekly' : 'none',
                p_recurrence_until: payload.recurrence_until || null,
                p_exclude_event_id: excludeEventId || null,
            };
            const { data } = await run('calendar.checkConflicts', (client) =>
                client.rpc('check_artist_calendar_conflicts', params)
            );
            return data || [];
        },
    };

    Calendar._internal = { isMissingColumn, cleanPayload, sessionPatch, normalizeSession, normalizeTrip, normalizeDashboardReminder };
    D.Calendar = Calendar;
})();
