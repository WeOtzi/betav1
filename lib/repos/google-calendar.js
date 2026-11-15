'use strict';

// Repositorio de Google Calendar (servidor, service-role vía lib/postgrest.js).
// Tablas de la migración 20261113102000_google_calendar_sync.sql:
//   - artist_google_calendar_connections (refresh token cifrado; SOLO service_role)
//   - artist_google_calendar_event_links (source_key → google_event_id)
// 20261115150000_gcal_fuentes_y_marca.sql suma: links.source_ends_at y
// links.google_email (los vínculos ya no se borran al desconectar),
// connections.dirty_at (marca de cambios que ponen los triggers de la base).
// Es el `db` que consume lib/gcal-sync.createGcalService: cada fuente de
// lib/gcal-sync.DEFAULT_SOURCES tiene su list* y su get*ByIds acá.

const { pgrest } = require('../postgrest');

const CONNECTIONS = 'artist_google_calendar_connections';
const LINKS = 'artist_google_calendar_event_links';
const LIST_LIMIT = 2000;
const IDS_CHUNK = 150;

// La migración 20261115150000 todavía no aplicada (columna o tabla nueva que
// PostgREST no conoce): se degrada al comportamiento anterior sin romper.
function isMissingSchema(err) {
    const text = String((err && err.message) || '');
    return /42703|PGRST204|PGRST205|PGRST200|42P01|does not exist|schema cache|Could not find/i.test(text);
}

async function withLegacy(modern, legacy) {
    try {
        return await modern();
    } catch (err) {
        if (!isMissingSchema(err)) throw err;
        return legacy();
    }
}

function chunks(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

async function byIds(ids, query) {
    const clean = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    if (!clean.length) return [];
    const parts = await Promise.all(chunks(clean, IDS_CHUNK).map((part) => query(part)));
    return parts.flat().filter(Boolean);
}

const SESSION_SELECT_LEGACY = 'id,quotation_id,session_number,session_date,duration_hours,status,notes,location,quotations_db!inner(id,quote_id,client_full_name,quote_status,artist_id)';
// ── sesiones (ronda 2 · P28) ── client_confirmation: una sesión que el cliente
// todavía no confirmó va a Google como "por confirmar". Sin la migración
// 20261116150000 se usa el select anterior (withLegacy).
const SESSION_SELECT = SESSION_SELECT_LEGACY.replace('status,notes,location,', 'status,notes,location,client_confirmation,');
const MANUAL_SELECT = 'id,event_type,title,client_name,starts_at,ends_at,all_day,location,notes,status,recurrence_rule,recurrence_until';
const TRIP_SELECT = 'id,trip_type,status,cancelled_at,city,country,event_name,studio_name_hint,start_date,end_date';
const REMINDER_SELECT = 'id,title,detail,due_date,due_at,recurrence_rule,recurrence_until,completed_at';
// Sin client_email ni client_phone: a Google solo va el nombre.
const BOOKING_SELECT = 'id,studio_id,location_id,starts_at,ends_at,status,client_name,service_description,studios(name,city,formatted_address),studio_locations(label,formatted_address,street,street_number,city)';
const HOLD_SELECT = 'id,quotation_id,starts_at,ends_at,status,expires_at,quotations_db(quote_id,client_full_name)';

function sessionPair(row) {
    if (!row) return null;
    const quote = row.quotations_db || null;
    const session = Object.assign({}, row);
    delete session.quotations_db;
    return { session, quote };
}

const GoogleCalendarRepo = {
    isMissingSchema,

    async isArtist(userId) {
        const row = await pgrest('artists_db').select('user_id').eq('user_id', userId).limit(1).single().execute();
        return !!row;
    },

    getConnection(userId) {
        const base = 'user_id,google_email,refresh_token_enc,scope,calendar_id,connected_at,last_sync_at,last_error,needs_reauth';
        return withLegacy(
            () => pgrest(CONNECTIONS).select(`${base},dirty_at`).eq('user_id', userId).limit(1).single().execute(),
            () => pgrest(CONNECTIONS).select(base).eq('user_id', userId).limit(1).single().execute()
        );
    },

    listActiveConnections() {
        return pgrest(CONNECTIONS).select('user_id')
            .eq('needs_reauth', false)
            .order('last_sync_at', { ascending: true })
            .limit(500).execute();
    },

    // Artistas con cambios marcados por los triggers (20261115150000).
    async listDirtyConnections() {
        try {
            return await pgrest(CONNECTIONS).select('user_id,dirty_at')
                .eq('needs_reauth', false)
                .gt('dirty_at', '1970-01-01T00:00:00Z')
                .order('dirty_at', { ascending: true })
                .limit(100).execute();
        } catch (err) {
            if (isMissingSchema(err)) return [];
            throw err;
        }
    },

    // Limpia la marca solo si nadie volvió a escribir durante la sincronización.
    async clearDirty(userId, dirtyAt) {
        if (!dirtyAt) return;
        try {
            await pgrest(CONNECTIONS).eq('user_id', userId).eq('dirty_at', dirtyAt).patch({ dirty_at: null }, { returning: false });
        } catch (err) {
            if (!isMissingSchema(err)) throw err;
        }
    },

    saveConnection(row) {
        return pgrest(CONNECTIONS).upsert([row], { onConflict: 'user_id', returning: false });
    },

    updateConnection(userId, patch) {
        return pgrest(CONNECTIONS).eq('user_id', userId).patch(patch, { returning: false });
    },

    // Desde 20261115150000 los vínculos NO se borran en cascada con la conexión
    // (cuelgan de auth.users): reconectar la misma cuenta no duplica eventos.
    deleteConnection(userId) {
        return pgrest(CONNECTIONS).eq('user_id', userId).delete();
    },

    listLinks(userId) {
        const base = 'source_key,google_event_id,content_hash,synced_at';
        return withLegacy(
            () => pgrest(LINKS).select(`${base},source_ends_at,google_email`).eq('user_id', userId).limit(10000).execute(),
            () => pgrest(LINKS).select(base).eq('user_id', userId).limit(10000).execute()
        );
    },

    upsertLink(row) {
        return withLegacy(
            () => pgrest(LINKS).upsert([row], { onConflict: 'user_id,source_key', returning: false }),
            () => {
                const legacy = Object.assign({}, row);
                delete legacy.source_ends_at;
                delete legacy.google_email;
                return pgrest(LINKS).upsert([legacy], { onConflict: 'user_id,source_key', returning: false });
            }
        );
    },

    // Varios vínculos en un pedido (solo filas completas; lo usa el relleno de
    // source_ends_at). Sin la migración aplicada no hay nada que rellenar.
    async upsertLinks(rows) {
        if (!Array.isArray(rows) || !rows.length) return [];
        try {
            return await pgrest(LINKS).upsert(rows, { onConflict: 'user_id,source_key', returning: false });
        } catch (err) {
            if (isMissingSchema(err)) return [];
            throw err;
        }
    },

    deleteLink(userId, sourceKey) {
        return pgrest(LINKS).eq('user_id', userId).eq('source_key', sourceKey).delete();
    },

    deleteAllLinks(userId) {
        return pgrest(LINKS).eq('user_id', userId).delete();
    },

    /* ------------------------------ fuentes ------------------------------ */

    // event:<uuid>
    listManualEvents(userId, sinceIso, types) {
        return pgrest('artist_calendar_events')
            .select(MANUAL_SELECT)
            .eq('artist_user_id', userId)
            .neq('status', 'cancelled')
            .in('event_type', types)
            .or([{ col: 'ends_at', op: 'gte', val: sinceIso }, { col: 'recurrence_rule', op: 'eq', val: 'weekly' }])
            .order('starts_at', { ascending: true })
            .limit(LIST_LIMIT).execute();
    },

    getManualEventsByIds(userId, ids) {
        return byIds(ids, (part) => pgrest('artist_calendar_events').select(MANUAL_SELECT)
            .eq('artist_user_id', userId).in('id', part).limit(part.length).execute());
    },

    // session:<uuid> — un solo pedido con la cotización embebida (antes:
    // 1000 cotizaciones sin orden + 500 sesiones; lo que quedaba afuera se
    // borraba de Google, CAL-01).
    async listSessions(userId, sinceIso) {
        const list = (select) => pgrest('quotation_sessions').select(select)
            .eq('quotations_db.artist_id', userId)
            .gte('session_date', sinceIso)
            .order('session_date', { ascending: true })
            .limit(LIST_LIMIT).execute();
        const rows = await withLegacy(() => list(SESSION_SELECT), () => list(SESSION_SELECT_LEGACY));
        return (rows || []).map(sessionPair).filter(Boolean);
    },

    async getSessionsByIds(userId, ids) {
        const get = (select) => byIds(ids, (part) => pgrest('quotation_sessions').select(select)
            .eq('quotations_db.artist_id', userId).in('id', part).limit(part.length).execute());
        const rows = await withLegacy(() => get(SESSION_SELECT), () => get(SESSION_SELECT_LEGACY));
        return rows.map(sessionPair).filter(Boolean);
    },

    // trip:<uuid> — viajes de Travel que no terminaron antes de sinceDate.
    listTrips(userId, sinceDate) {
        return pgrest('artist_trips')
            .select(TRIP_SELECT)
            .eq('artist_user_id', userId)
            .neq('status', 'cancelado')
            .gte('end_date', sinceDate)
            .order('start_date', { ascending: true })
            .limit(LIST_LIMIT).execute();
    },

    getTripsByIds(userId, ids) {
        return byIds(ids, (part) => pgrest('artist_trips').select(TRIP_SELECT)
            .eq('artist_user_id', userId).in('id', part).limit(part.length).execute());
    },

    // reminder:<uuid> — pendientes con hora o fecha dentro de la ventana, o
    // semanales (la repetición los mantiene vigentes).
    listReminders(userId, sinceIso) {
        return pgrest('artist_reminders')
            .select(REMINDER_SELECT)
            .eq('artist_user_id', userId)
            .is('completed_at', 'null')
            .or([
                { col: 'due_at', op: 'gte', val: sinceIso },
                { col: 'due_date', op: 'gte', val: String(sinceIso).slice(0, 10) },
                { col: 'recurrence_rule', op: 'eq', val: 'weekly' },
            ])
            .order('created_at', { ascending: true })
            .limit(LIST_LIMIT).execute();
    },

    getRemindersByIds(userId, ids) {
        return byIds(ids, (part) => pgrest('artist_reminders').select(REMINDER_SELECT)
            .eq('artist_user_id', userId).in('id', part).limit(part.length).execute());
    },

    // booking:<uuid> — citas que un estudio le agendó (confirmadas o hechas).
    listStudioBookings(userId, sinceIso) {
        return pgrest('studio_bookings')
            .select(BOOKING_SELECT)
            .eq('artist_user_id', userId)
            .in('status', ['confirmed', 'completed'])
            .gte('ends_at', sinceIso)
            .order('starts_at', { ascending: true })
            .limit(LIST_LIMIT).execute();
    },

    getStudioBookingsByIds(userId, ids) {
        return byIds(ids, (part) => pgrest('studio_bookings').select(BOOKING_SELECT)
            .eq('artist_user_id', userId).in('id', part).limit(part.length).execute());
    },

    // hold:<uuid> — solicitudes con turno apartado (tabla del frente "turnos",
    // artist_booking_holds). Si la tabla todavía no existe, no hay holds.
    async listHolds(userId, sinceIso) {
        try {
            return await pgrest('artist_booking_holds')
                .select(HOLD_SELECT)
                .eq('artist_user_id', userId)
                .eq('status', 'pending')
                .gte('ends_at', sinceIso)
                .order('starts_at', { ascending: true })
                .limit(LIST_LIMIT).execute();
        } catch (err) {
            if (isMissingSchema(err)) return [];
            throw err;
        }
    },

    async getHoldsByIds(userId, ids) {
        try {
            return await byIds(ids, (part) => pgrest('artist_booking_holds').select(HOLD_SELECT)
                .eq('artist_user_id', userId).in('id', part).limit(part.length).execute());
        } catch (err) {
            // Sin tabla no se puede verificar: null = no tocar esos vínculos.
            if (isMissingSchema(err)) return null;
            throw err;
        }
    },

    // vacation:<user_id> — vacaciones de Cuenta → Disponibilidad.
    async getVacation(userId) {
        const row = await pgrest('artists_db').select('user_id,vacation_start,vacation_end')
            .eq('user_id', userId).limit(1).single().execute();
        return row && (row.vacation_start || row.vacation_end) ? row : null;
    },

    // Compatibilidad: google_event_id también queda en la fila de origen (solo
    // las tablas que tienen la columna: eventos manuales y sesiones).
    setSourceGoogleId(source, googleEventId) {
        const table = source.kind === 'session' ? 'quotation_sessions'
            : source.kind === 'event' ? 'artist_calendar_events' : null;
        if (!table) return Promise.resolve();
        return pgrest(table).eq('id', source.id).patch({ google_event_id: googleEventId }, { returning: false });
    },

    async getTimezone(userId) {
        const row = await pgrest('user_preferences').select('app_settings').eq('user_id', userId).limit(1).single().execute();
        return row && row.app_settings && typeof row.app_settings.timezone === 'string' ? row.app_settings.timezone : null;
    },

    // Mantiene al día artist_integration_connections (lo que leía la UI vieja)
    // y resuelve el viejo pedido 'pending'. Nunca guarda secretos ahí.
    markIntegration(userId, status, email) {
        const connected = status === 'connected';
        return pgrest('artist_integration_connections').upsert([{
            artist_user_id: userId,
            provider: 'google_calendar',
            status: connected ? 'connected' : 'disconnected',
            account_label: connected ? (email || null) : null,
            provider_reference: null,
            scopes: connected ? ['calendar.events'] : [],
            metadata_json: { source: 'oauth' },
            connected_at: connected ? new Date().toISOString() : null,
        }], { onConflict: 'artist_user_id,provider', returning: false });
    },
};

module.exports = { GoogleCalendarRepo, isMissingSchema };
