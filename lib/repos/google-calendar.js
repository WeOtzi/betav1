'use strict';

// Repositorio de Google Calendar (servidor, service-role vía lib/postgrest.js).
// Tablas de la migración 20261113102000_google_calendar_sync.sql:
//   - artist_google_calendar_connections (refresh token cifrado; SOLO service_role)
//   - artist_google_calendar_event_links (source_key → google_event_id)
// Es el `db` que consume lib/gcal-sync.createGcalService.

const { pgrest } = require('../postgrest');

const CONNECTIONS = 'artist_google_calendar_connections';
const LINKS = 'artist_google_calendar_event_links';

const GoogleCalendarRepo = {
    async isArtist(userId) {
        const row = await pgrest('artists_db').select('user_id').eq('user_id', userId).limit(1).single().execute();
        return !!row;
    },

    getConnection(userId) {
        return pgrest(CONNECTIONS)
            .select('user_id,google_email,refresh_token_enc,scope,calendar_id,connected_at,last_sync_at,last_error,needs_reauth')
            .eq('user_id', userId).limit(1).single().execute();
    },

    listActiveConnections() {
        return pgrest(CONNECTIONS).select('user_id')
            .eq('needs_reauth', false)
            .order('last_sync_at', { ascending: true })
            .limit(500).execute();
    },

    saveConnection(row) {
        return pgrest(CONNECTIONS).upsert([row], { onConflict: 'user_id', returning: false });
    },

    updateConnection(userId, patch) {
        return pgrest(CONNECTIONS).eq('user_id', userId).patch(patch, { returning: false });
    },

    // Borra en cascada los vínculos y los bloques importados.
    deleteConnection(userId) {
        return pgrest(CONNECTIONS).eq('user_id', userId).delete();
    },

    listLinks(userId) {
        return pgrest(LINKS).select('source_key,google_event_id,content_hash')
            .eq('user_id', userId).limit(5000).execute();
    },

    upsertLink(row) {
        return pgrest(LINKS).upsert([row], { onConflict: 'user_id,source_key', returning: false });
    },

    deleteLink(userId, sourceKey) {
        return pgrest(LINKS).eq('user_id', userId).eq('source_key', sourceKey).delete();
    },

    listManualEvents(userId, sinceIso, types) {
        return pgrest('artist_calendar_events')
            .select('id,event_type,title,client_name,starts_at,ends_at,all_day,location,notes,status,recurrence_rule,recurrence_until')
            .eq('artist_user_id', userId)
            .neq('status', 'cancelled')
            .in('event_type', types)
            .or([{ col: 'ends_at', op: 'gte', val: sinceIso }, { col: 'recurrence_rule', op: 'eq', val: 'weekly' }])
            .order('starts_at', { ascending: true })
            .limit(500).execute();
    },

    async listSessions(userId, sinceIso) {
        const quotes = await pgrest('quotations_db').select('id,quote_id,client_full_name')
            .eq('artist_id', userId).limit(1000).execute();
        if (!quotes || !quotes.length) return [];
        const byId = new Map(quotes.map((q) => [String(q.id), q]));
        const sessions = await pgrest('quotation_sessions').select('*')
            .in('quotation_id', quotes.map((q) => q.id))
            .gte('session_date', sinceIso)
            .order('session_date', { ascending: true })
            .limit(500).execute();
        return (sessions || []).map((session) => ({ session, quote: byId.get(String(session.quotation_id)) || null }));
    },

    // Viajes de Travel que no terminaron antes de sinceDate (YYYY-MM-DD).
    listTrips(userId, sinceDate) {
        return pgrest('artist_trips')
            .select('id,trip_type,status,cancelled_at,city,country,event_name,studio_name_hint,start_date,end_date')
            .eq('artist_user_id', userId)
            .neq('status', 'cancelado')
            .gte('end_date', sinceDate)
            .order('start_date', { ascending: true })
            .limit(500).execute();
    },

    // Compatibilidad: google_event_id también queda en la fila de origen.
    setSourceGoogleId(source, googleEventId) {
        const table = source.kind === 'session' ? 'quotation_sessions' : 'artist_calendar_events';
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

module.exports = { GoogleCalendarRepo };
