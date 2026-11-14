'use strict';

// Repositorio de turnos / reservas online (servidor, service-role vía
// lib/postgrest.js). Tablas y RPC de la migración
// 20261115160000_turnos_reservas_online.sql:
//   - artist_booking_settings (reglas de turno + opt-in)
//   - artist_booking_holds    (apartados y turnos confirmados)
//   - list_artist_blocking_intervals / save_web_quotation_with_slot /
//     confirm_artist_slot_hold / release_artist_slot_hold / expire_artist_slot_holds
// Es el `repo` que consume lib/booking-slots.js y lib/routes/turnos.js.

const { pgrest } = require('../postgrest');

const SETTINGS = 'artist_booking_settings';
const HOLDS = 'artist_booking_holds';
const SETTINGS_COLUMNS = 'artist_user_id,enabled,slot_minutes,slot_step_minutes,buffer_minutes,min_notice_hours,horizon_days,hold_hours,public_note,updated_at';
const HOLD_COLUMNS = 'id,artist_user_id,quotation_id,starts_at,ends_at,status,expires_at,session_id,released_reason,confirmed_at,created_at';

function rpc(name, body) {
    return pgrest.raw(`rpc/${name}`, { method: 'POST', body });
}

// Solo usuarios con forma de username de We Ötzi (evita comodines de ilike).
function safeUsername(value) {
    const u = String(value || '').trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(u) ? u : '';
}

const BookingRepo = {
    getSettings(artistId) {
        return pgrest(SETTINGS).select(SETTINGS_COLUMNS).eq('artist_user_id', artistId).limit(1).single().execute();
    },

    async upsertSettings(artistId, value) {
        const rows = await pgrest(SETTINGS).upsert([Object.assign({}, value, { artist_user_id: artistId })], {
            onConflict: 'artist_user_id',
        });
        return (rows && rows[0]) || null;
    },

    // Solo lo que el cálculo necesita del app_settings (horario y zona).
    async getPrefs(artistId) {
        const row = await pgrest('user_preferences').select('app_settings').eq('user_id', artistId).limit(1).single().execute();
        const s = (row && row.app_settings) || {};
        return { availability: s.availability || null, timezone: typeof s.timezone === 'string' ? s.timezone : null };
    },

    listLocations(artistId) {
        return pgrest('artist_tattoo_locations')
            .select('id,period_type,agenda_status,start_date,end_date,sort_order,city,country,studio_name')
            .eq('artist_user_id', artistId).order('sort_order', { ascending: true }).limit(100).execute();
    },

    async listBlocking(artistId, fromIso, toIso) {
        const rows = await rpc('list_artist_blocking_intervals', { p_artist: artistId, p_from: fromIso, p_to: toIso });
        return Array.isArray(rows) ? rows : [];
    },

    getArtistById(artistId) {
        return pgrest('artists_db').select('user_id,username,name,email,profile_picture,city,ubicacion,country,registration_status')
            .eq('user_id', artistId).limit(1).single().execute();
    },

    async getPublicArtistByUsername(username) {
        const u = safeUsername(username);
        if (!u) return null;
        const candidates = u.endsWith('.wo') ? [u] : [u, `${u}.wo`];
        // ilike exacto (sin comodines: '_' escapado) para no depender de mayúsculas.
        const rows = await pgrest('artists_db')
            .select('user_id,username,name,profile_picture,city,ubicacion,country,registration_status')
            .or(candidates.map((c) => ({ col: 'username', op: 'ilike', val: c.replace(/_/g, '\\_') })))
            .limit(2).execute();
        const row = (rows || []).find((r) => String(r.username || '').toLowerCase() === u)
            || (rows || [])[0] || null;
        if (!row || !row.user_id || row.registration_status === 'incompleto') return null;
        return row;
    },

    async saveWithSlot(quote, extras, slot) {
        return rpc('save_web_quotation_with_slot', { p_quote: quote, p_extras: extras, p_slot: slot });
    },

    async confirmHold(holdId, actorId, startsAt, minutes) {
        return rpc('confirm_artist_slot_hold', {
            p_hold: holdId, p_actor: actorId, p_starts: startsAt || null, p_minutes: minutes || null,
        });
    },

    async releaseHold(holdId, actorId, reason) {
        return rpc('release_artist_slot_hold', { p_hold: holdId, p_actor: actorId, p_reason: reason || null });
    },

    async expireHolds(limit = 200) {
        const rows = await rpc('expire_artist_slot_holds', { p_limit: limit });
        return Array.isArray(rows) ? rows : [];
    },

    getHold(holdId) {
        return pgrest(HOLDS).select(HOLD_COLUMNS).eq('id', holdId).limit(1).single().execute();
    },

    getLatestHoldForQuotation(quotationId) {
        return pgrest(HOLDS).select(HOLD_COLUMNS).eq('quotation_id', quotationId)
            .order('created_at', { ascending: false }).limit(1).single().execute();
    },

    // Apartados pendientes vigentes del artista (para su calendario).
    listPendingHolds(artistId, fromIso, toIso) {
        return pgrest(HOLDS).select(HOLD_COLUMNS).eq('artist_user_id', artistId).eq('status', 'pending')
            .gt('expires_at', new Date().toISOString()).lt('starts_at', toIso).gt('ends_at', fromIso)
            .order('starts_at', { ascending: true }).limit(200).execute();
    },

    // Reintento de un envío que ya creó su apartado (respuesta perdida).
    async findActiveHoldByQuoteId(quoteId) {
        const quote = await pgrest('quotations_db').select('id,quote_id,quote_status')
            .eq('quote_id', quoteId).limit(1).single().execute();
        if (!quote || quote.quote_status === 'in_progress') return null;
        const hold = await pgrest(HOLDS).select(HOLD_COLUMNS).eq('quotation_id', quote.id)
            .in('status', ['pending', 'confirmed']).limit(1).single().execute();
        return hold ? { quote, hold } : null;
    },

    getQuotation(quotationId) {
        return pgrest('quotations_db')
            .select('id,quote_id,quote_status,artist_id,artist_name,client_user_id,client_email,client_full_name,requested_slot_start,requested_slot_minutes')
            .eq('id', quotationId).limit(1).single().execute();
    },

    async listQuotationsByIds(ids) {
        if (!ids.length) return [];
        return pgrest('quotations_db').select('id,quote_id,client_full_name').in('id', ids).limit(200).execute();
    },
};

module.exports = { BookingRepo, safeUsername };
