/**
 * WE OTZI - Repositorio del calendario profesional
 * ------------------------------------------------
 * Persiste solo eventos manuales en artist_calendar_events. Las sesiones de
 * cotizacion y los viajes se normalizan como proyecciones de solo lectura; no
 * se duplican filas entre dominios.
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

    function normalizeSession(session, quotation) {
        const start = asDate(session.session_date);
        if (!start) return null;
        const durationHours = Number(session.duration_hours) > 0 ? Number(session.duration_hours) : 1;
        const end = new Date(start.getTime() + (durationHours * 60 * 60 * 1000));
        const clientName = quotation?.client_full_name || 'Cliente';
        return {
            id: `quotation_session:${session.id}`,
            baseId: null,
            sourceType: 'quotation_session',
            sourceId: String(session.id),
            readonly: true,
            type: session.status === 'scheduled' || session.status === 'completed'
                ? 'confirmed_session'
                : 'reservation',
            title: `Sesion — ${clientName}`,
            clientName,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay: false,
            location: quotation?.tattoo_body_part || 'Estudio propio',
            notes: session.notes || quotation?.tattoo_idea_description || '',
            status: session.status === 'cancelled' ? 'cancelled' : 'scheduled',
            recurrenceRule: 'none',
            recurrenceUntil: null,
            raw: { session, quotation },
        };
    }

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
            type: convention ? 'convention' : 'guest_spot',
            title: convention
                ? (trip.event_name || `Convencion · ${trip.city}`)
                : `Guest en ${place}`,
            clientName: '',
            start: start.toISOString(),
            end: end.toISOString(),
            allDay: true,
            location: `${trip.city}, ${trip.country}`,
            notes: trip.personal_notes || '',
            status: trip.status === 'pendiente' ? 'pending' : 'scheduled',
            recurrenceRule: 'none',
            recurrenceUntil: null,
            raw: trip,
        };
    }

    async function listSessionsProjection(artistUserId, rangeStart, rangeEnd) {
        if (!D.Quotations || !D.Sessions) return [];
        const quotations = await D.Quotations.listForArtist(artistUserId, {
            excludeArchived: false,
            excludeInProgress: false,
            select: 'id, client_full_name, tattoo_body_part, tattoo_idea_description',
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
        return {
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
    }

    const Calendar = {
        async listRange(artistUserId, rangeStartValue, rangeEndValue) {
            const rangeStart = asDate(rangeStartValue);
            const rangeEnd = asDate(rangeEndValue);
            if (!rangeStart || !rangeEnd) throw new Error('Rango de calendario invalido.');

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
            ]);
            projectionResults.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.warn(`[calendar] No se pudo cargar la proyeccion ${index + 1}:`, result.reason);
                }
            });

            const events = [
                ...expandManualRows(rows || [], rangeStart, rangeEnd),
                ...(projectionResults[0].status === 'fulfilled' ? projectionResults[0].value : []),
                ...(projectionResults[1].status === 'fulfilled' ? projectionResults[1].value : []),
            ];

            const unique = new Map();
            events.forEach((event) => {
                const key = `${event.sourceType}:${event.sourceId}:${event.start}`;
                if (!unique.has(key)) unique.set(key, event);
            });
            return [...unique.values()].sort((a, b) => asDate(a.start) - asDate(b.start));
        },

        async create(artistUserId, payload) {
            const row = cleanPayload(artistUserId, payload);
            const { data } = await run('calendar.create', (client) =>
                client.from(TABLE).insert([row]).select().single()
            );
            return data;
        },

        async update(eventId, artistUserId, payload) {
            const row = cleanPayload(artistUserId, payload);
            delete row.artist_user_id;
            const { data } = await run('calendar.update', (client) =>
                client.from(TABLE)
                    .update(row)
                    .eq('id', eventId)
                    .eq('artist_user_id', artistUserId)
                    .select()
                    .single()
            );
            return data;
        },

        async remove(eventId, artistUserId) {
            await run('calendar.remove', (client) =>
                client.from(TABLE).delete().eq('id', eventId).eq('artist_user_id', artistUserId)
            );
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

    D.Calendar = Calendar;
})();
