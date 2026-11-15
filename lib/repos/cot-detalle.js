'use strict';

// ===========================================================================
// Repositorio del frente cot-detalle (servidor) — capa PostgREST unificada.
// ---------------------------------------------------------------------------
// Corre con service-role: la autorización (artista dueño de la cotización,
// regla de contacto, estado del enlace, cuenta que vincula) la resuelven
// lib/routes/cot-detalle.js y lib/cot-detalle.js ANTES de leer o escribir.
//
// Claves de relación:
//   quotation_sessions.quotation_id / quotation_share_links.quotation_id
//       → quotations_db.id (int)
//   artist_manual_quotes.quote_id → quotations_db.quote_id (text)
// ===========================================================================

const { pgrest } = require('../postgrest');

const QUOTE_SELECT = [
    'id', 'quote_id', 'quote_status', 'source', 'quotation_medium', 'created_at', 'updated_at',
    'artist_id', 'artist_name', 'artist_username', 'artist_email', 'artist_current_city', 'artist_studio_name',
    'client_user_id', 'client_full_name', 'client_email', 'client_whatsapp', 'client_instagram',
    'client_contact_preference', 'client_city_residence',
    'project_description', 'tattoo_idea_description', 'tattoo_style', 'tattoo_body_part', 'tattoo_body_side',
    'tattoo_size', 'tattoo_color_type', 'tattoo_is_cover_up', 'tattoo_estimated_sessions',
    'artist_budget_amount', 'artist_budget_currency', 'client_budget_currency',
    'final_budget_amount', 'final_budget_currency', 'final_sessions',
    'artist_session_minutes', 'artist_availability', 'artist_responded_at',
    'artist_deposit_pct', 'artist_deposit_amount',
    'quote_expires_at', 'quote_expiry_enabled', 'quote_expiry_days'
].join(',');

const ARTIST_SELECT = 'user_id,name,username,email,verification_state,profile_picture,city,ubicacion,estudios';
const MANUAL_SELECT = 'quote_id,status,project,line_items,currency,discount_pct,tax_pct,deposit_pct,subtotal,total,deposit_amount,validity_days,cancellation_policy,client_notes,extra_terms';
const LINK_SELECT = 'id,quotation_id,quote_id,artist_id,created_at,expires_at,revoked_at,view_count,last_viewed_at,claimed_by,claimed_at';

function createRepo({ query = pgrest } = {}) {
    return {
        getQuote(quoteId) {
            return query('quotations_db').select(QUOTE_SELECT).eq('quote_id', quoteId).limit(1).single().execute();
        },

        getQuoteById(id) {
            return query('quotations_db').select(QUOTE_SELECT).eq('id', id).limit(1).single().execute();
        },

        getArtist(userId) {
            if (!userId) return Promise.resolve(null);
            return query('artists_db').select(ARTIST_SELECT).eq('user_id', userId).limit(1).single().execute();
        },

        // Detalle de la cotización manual ya enviada (desglose y términos).
        getManualQuote(quoteId) {
            return query('artist_manual_quotes').select(MANUAL_SELECT)
                .eq('quote_id', quoteId).eq('status', 'sent').limit(1).single().execute();
        },

        listSessions(quotationId) {
            return query('quotation_sessions')
                .select('id,quotation_id,session_number,session_date,status')
                .eq('quotation_id', quotationId)
                .order('session_date', { ascending: true })
                .limit(50)
                .execute();
        },

        // ---------------------------------------------------- perfil del cliente
        getClient(userId) {
            return query('clients_db')
                .select('user_id,full_name,profile_picture,city_residence,country,created_at,public_username')
                .eq('user_id', userId).limit(1).single().execute();
        },

        getClientProfile(userId) {
            return query('client_profiles')
                .select('client_user_id,username,first_name,last_name,country,photo_url')
                .eq('client_user_id', userId).limit(1).single().execute();
        },

        async isClientAccount(userId) {
            const row = await query('clients_db').select('user_id').eq('user_id', userId).limit(1).single().execute();
            return !!row;
        },

        listQuotesBetween(artistId, clientUserId) {
            return query('quotations_db')
                .select('id,quote_id,quote_status,created_at,artist_responded_at,artist_budget_amount,final_budget_amount')
                .eq('artist_id', artistId).eq('client_user_id', clientUserId)
                .order('created_at', { ascending: true })
                .limit(200)
                .execute();
        },

        listSessionsForQuotations(ids) {
            if (!Array.isArray(ids) || !ids.length) return Promise.resolve([]);
            return query('quotation_sessions').select('id,quotation_id,status,session_date')
                .in('quotation_id', ids).limit(1000).execute();
        },

        // Reseñas públicas y aprobadas que dejó el cliente. { rows, count }.
        listClientReviews(clientUserId) {
            return query('verified_reviews')
                .select('id,rating,comment,reviewee_type,reviewee_display_name,created_at')
                .eq('reviewer_user_id', clientUserId)
                .eq('reviewer_type', 'client')
                .eq('moderation_status', 'approved')
                .eq('is_public', true)
                .order('created_at', { ascending: false })
                .range(0, 4)
                .count()
                .execute();
        },

        // ---------------------------------------------------- enlaces públicos
        listLinks(quotationId) {
            return query('quotation_share_links').select(LINK_SELECT)
                .eq('quotation_id', quotationId)
                .order('created_at', { ascending: false })
                .limit(50)
                .execute();
        },

        findLinkByHash(tokenHash) {
            return query('quotation_share_links').select(LINK_SELECT)
                .eq('token_hash', tokenHash).limit(1).single().execute();
        },

        async insertLink(row) {
            const rows = await query('quotation_share_links').select(LINK_SELECT).insert(row);
            return rows && rows.length ? rows[0] : null;
        },

        // Revoca los enlaces todavía sin revocar (todos, o uno por id).
        revokeLinks(quotationId, { id = null, at = new Date().toISOString() } = {}) {
            const q = query('quotation_share_links').select('id').eq('quotation_id', quotationId).is('revoked_at', null);
            if (id) q.eq('id', id);
            return q.patch({ revoked_at: at });
        },

        touchLink(tokenHash) {
            return query.raw('rpc/touch_quotation_share_link', { method: 'POST', body: { p_token_hash: tokenHash } });
        },

        markLinkClaimed(id, userId, at = new Date().toISOString()) {
            return query('quotation_share_links').eq('id', id).is('claimed_at', null)
                .patch({ claimed_by: userId, claimed_at: at }, { returning: false });
        },

        // Vincula la cotización solo si sigue sin dueño (evita carreras).
        // Devuelve la fila vinculada o null si otra cuenta ganó.
        async claimQuote(id, userId, extra = {}) {
            const rows = await query('quotations_db').select('id,quote_id,client_user_id')
                .eq('id', id).is('client_user_id', null)
                .patch(Object.assign({}, extra, { client_user_id: userId }));
            return rows && rows.length ? rows[0] : null;
        }
    };
}

module.exports = { createRepo, CotDetalleRepo: createRepo(), QUOTE_SELECT, ARTIST_SELECT, MANUAL_SELECT, LINK_SELECT };
