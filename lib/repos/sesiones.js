'use strict';

// ===========================================================================
// Repositorio de sesiones (servidor, service-role vía lib/postgrest.js).
// ---------------------------------------------------------------------------
// Frente "sesiones" (ronda 2 · P28 y P27-sesión). Tablas y RPC de la migración
// 20261116150000_sesiones_confirmacion_ubicacion.sql:
//   - quotation_sessions (client_confirmation, location_kind/_ref/_place_id)
//   - quotation_session_change_requests / _feedback / _disputes
//   - sesiones_confirm / _request_change / _respond_change / _withdraw_change
//     / _save_feedback / _open_dispute  (solo service-role, con p_actor)
// La autorización (quién es el actor) la resuelve lib/routes/sesiones.js con
// el Bearer; las reglas de negocio se validan otra vez dentro de cada RPC.
// ===========================================================================

const { pgrest } = require('../postgrest');

const SESSION_COLUMNS = [
    'id', 'quotation_id', 'session_number', 'session_date', 'duration_hours', 'status',
    'location', 'location_kind', 'location_ref', 'location_place_id',
    'client_confirmation', 'client_confirmed_at', 'created_at', 'updated_at',
].join(',');

const QUOTE_COLUMNS = [
    'id', 'quote_id', 'quote_status', 'client_user_id', 'client_email', 'client_full_name',
    'artist_id', 'artist_email', 'artist_name', 'artist_username', 'artist_studio_name',
    'artist_current_city', 'tattoo_body_part', 'tattoo_size', 'dispute_status', 'client_deleted_at',
].join(',');

const REQUEST_COLUMNS = [
    'id', 'session_id', 'quotation_id', 'requested_by', 'requested_by_role', 'previous_date',
    'proposed_date', 'proposed_duration_hours', 'proposed_location', 'proposed_location_kind',
    'proposed_location_place_id', 'note', 'status', 'responded_at', 'response_note', 'created_at',
].join(',');

const FEEDBACK_COLUMNS = 'id,session_id,quotation_id,author_user_id,author_role,rating,note,created_at,updated_at';

function rpc(name, body) {
    return pgrest.raw(`rpc/${name}`, { method: 'POST', body });
}

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

async function byIds(ids, run, size = 80) {
    const unique = [...new Set((ids || []).filter((id) => id != null && id !== ''))];
    const rows = [];
    for (const part of chunk(unique, size)) rows.push(...((await run(part)) || []));
    return rows;
}

const SessionsRepo = {
    SESSION_COLUMNS,

    // ---------------------------------------------------------------- lecturas
    getSession(sessionId) {
        return pgrest('quotation_sessions').select(SESSION_COLUMNS).eq('id', sessionId).limit(1).single().execute();
    },

    listSessionsByQuotation(quotationId) {
        return pgrest('quotation_sessions').select(SESSION_COLUMNS).eq('quotation_id', quotationId)
            .order('session_date', { ascending: true }).limit(100).execute();
    },

    listSessionsByQuotationIds(quotationIds) {
        return byIds(quotationIds, (part) => pgrest('quotation_sessions').select(SESSION_COLUMNS)
            .in('quotation_id', part).order('session_date', { ascending: true }).limit(500).execute());
    },

    getQuoteByQuoteId(quoteId) {
        return pgrest('quotations_db').select(QUOTE_COLUMNS).eq('quote_id', quoteId).limit(1).single().execute();
    },

    getQuoteById(quotationId) {
        return pgrest('quotations_db').select(QUOTE_COLUMNS).eq('id', quotationId).limit(1).single().execute();
    },

    // Fila completa: solo para leer la sede que eligió el cliente al cotizar
    // (preferred_location_*, del frente cot-form) sin depender de que exista.
    getQuoteRaw(quotationId) {
        return pgrest('quotations_db').select('*').eq('id', quotationId).limit(1).single().execute();
    },

    // Cotizaciones del cliente con trabajo acordado o en curso (las que pueden tener sesiones).
    listQuotesForClient(userId) {
        return pgrest('quotations_db').select(QUOTE_COLUMNS).eq('client_user_id', userId)
            .is('client_deleted_at', null).order('updated_at', { ascending: false }).limit(200).execute();
    },

    getArtist(userId) {
        if (!userId) return Promise.resolve(null);
        return pgrest('artists_db')
            .select('user_id,name,email,username,estudios,studio_id,city,country,formatted_address,ubicacion')
            .eq('user_id', userId).limit(1).single().execute();
    },

    listPendingRequests(sessionIds) {
        return byIds(sessionIds, (part) => pgrest('quotation_session_change_requests').select(REQUEST_COLUMNS)
            .in('session_id', part).eq('status', 'pending').limit(part.length).execute());
    },

    // Últimas solicitudes resueltas (para contar qué pasó con el último pedido).
    listRecentRequests(sessionIds) {
        return byIds(sessionIds, (part) => pgrest('quotation_session_change_requests').select(REQUEST_COLUMNS)
            .in('session_id', part).in('status', ['accepted', 'rejected', 'withdrawn'])
            .order('created_at', { ascending: false }).limit(200).execute());
    },

    getRequest(requestId) {
        return pgrest('quotation_session_change_requests').select(REQUEST_COLUMNS).eq('id', requestId).limit(1).single().execute();
    },

    listFeedback(sessionIds) {
        return byIds(sessionIds, (part) => pgrest('quotation_session_feedback').select(FEEDBACK_COLUMNS)
            .in('session_id', part).limit(part.length * 2).execute());
    },

    // Disputas de sesión con el estado de su ticket.
    listDisputes(sessionIds) {
        return byIds(sessionIds, (part) => pgrest('quotation_session_disputes')
            .select('id,session_id,ticket_id,opened_by_role,reason,created_at,support_tickets(ticket_number,status)')
            .in('session_id', part).order('created_at', { ascending: false }).limit(200).execute());
    },

    async hasActiveDispute(quotationId) {
        const rows = await pgrest('support_tickets').select('id').eq('quotation_id', quotationId).eq('kind', 'disputa')
            .in('status', ['open', 'in_progress', 'waiting_user']).limit(1).execute();
        return !!(rows && rows.length);
    },

    // Destinatarios del aviso de disputa cuando no hay SUPPORT_EMAIL.
    async activeSupportEmails() {
        const rows = await pgrest('support_users_db').select('email').eq('is_active', true).limit(20).execute();
        return (rows || []).map((r) => String(r.email || '').trim()).filter(Boolean);
    },

    // ---------------------------------------------------------------- ubicaciones
    listRoster(artistId) {
        return pgrest('studio_public_roster').select('membership_id,studio_id,location_id,role,ends_on')
            .eq('artist_user_id', artistId).limit(50).execute();
    },

    listStudios(studioIds) {
        return byIds(studioIds, (part) => pgrest('studios')
            .select('id,name,city,country,formatted_address,primary_location_id,is_active')
            .in('id', part).limit(part.length).execute());
    },

    listStudioLocations(studioIds) {
        return byIds(studioIds, (part) => pgrest('studio_locations')
            .select('id,studio_id,label,is_primary,is_active,sort_order,country,state_province,city,locality,street,street_number,formatted_address,google_place_id')
            .in('studio_id', part).eq('is_active', true).order('sort_order', { ascending: true }).limit(200).execute());
    },

    getStudioLocation(locationId) {
        return pgrest('studio_locations')
            .select('id,studio_id,label,country,state_province,city,locality,street,street_number,formatted_address,google_place_id')
            .eq('id', locationId).limit(1).single().execute();
    },

    listArtistLocations(artistId) {
        return pgrest('artist_tattoo_locations')
            .select('id,studio_id,studio_name,city,country,period_type,agenda_status,start_date,end_date,sort_order')
            .eq('artist_user_id', artistId).order('sort_order', { ascending: true }).limit(50).execute();
    },

    // ---------------------------------------------------------------- escrituras (RPC)
    confirm(sessionId, actorId) {
        return rpc('sesiones_confirm', { p_session: sessionId, p_actor: actorId });
    },

    requestChange(sessionId, actorId, proposal) {
        const p = proposal || {};
        return rpc('sesiones_request_change', {
            p_session: sessionId,
            p_actor: actorId,
            p_proposed_date: p.proposed_date || null,
            p_duration_hours: p.duration_hours != null ? p.duration_hours : null,
            p_location: p.location || null,
            p_location_kind: p.location_kind || null,
            p_location_ref: p.location_ref || null,
            p_location_place_id: p.location_place_id || null,
            p_note: p.note || null,
        });
    },

    respondChange(requestId, actorId, accept, note) {
        return rpc('sesiones_respond_change', { p_request: requestId, p_actor: actorId, p_accept: !!accept, p_note: note || null });
    },

    withdrawChange(requestId, actorId) {
        return rpc('sesiones_withdraw_change', { p_request: requestId, p_actor: actorId });
    },

    saveFeedback(sessionId, actorId, rating, note) {
        return rpc('sesiones_save_feedback', { p_session: sessionId, p_actor: actorId, p_rating: rating, p_note: note || null });
    },

    openDispute(sessionId, actorId, input) {
        return rpc('sesiones_open_dispute', {
            p_session: sessionId,
            p_actor: actorId,
            p_reason: input.reason,
            p_subject: input.subject,
            p_description: input.description,
            p_desired_outcome: input.desired_outcome || 'mediacion',
        });
    },
};

module.exports = { SessionsRepo, SESSION_COLUMNS, QUOTE_COLUMNS, REQUEST_COLUMNS };
