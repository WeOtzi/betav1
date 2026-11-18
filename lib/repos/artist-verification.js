'use strict';

// Repositorio de verificación de artistas (servidor, service-role vía lib/postgrest.js).
// Frente verif-artista (beta cerrada). Tablas: artists_db, artist_verification_documents,
// verification_history y support_users_db; RPC request_artist_verification
// (migración 20261115190000, ejecutable solo por service_role).
// Es el `deps` de lib/verificacion-artista.js.

const { pgrest } = require('../postgrest');

const ARTIST_COLUMNS = 'id,user_id,name,username,email,verification_state,instagram,instagram_verified_at,instagram_verified_handle';
const DOC_COLUMNS = 'id,doc_type,status,reviewed_at,reviewer_notes';
const HISTORY_COLUMNS = 'id,artist_id,action,notes,reviewed_by,created_at';

const ArtistVerificationRepo = {
    async artistByUserId(userId) {
        return pgrest('artists_db').select(ARTIST_COLUMNS).eq('user_id', userId).limit(1).single().execute();
    },

    async artistById(id) {
        return pgrest('artists_db').select(ARTIST_COLUMNS).eq('id', id).limit(1).single().execute();
    },

    async documents(userId) {
        return pgrest('artist_verification_documents').select(DOC_COLUMNS)
            .eq('artist_user_id', userId).order('doc_type').limit(10).execute();
    },

    async historyRow(id) {
        return pgrest('verification_history').select(HISTORY_COLUMNS).eq('id', id).limit(1).single().execute();
    },

    async lastDecision(artistId) {
        return pgrest('verification_history').select(HISTORY_COLUMNS)
            .eq('artist_id', artistId).neq('action', 'pending_review')
            .order('created_at', { ascending: false }).limit(1).single().execute();
    },

    // Pasa al artista a 'Requested' (valida documentos y deja historial en SQL).
    async requestVerification(userId) {
        return pgrest.raw('rpc/request_artist_verification', {
            method: 'POST', body: { p_artist_user_id: userId }
        });
    },

    // Destinatarios del aviso "un artista pidió la verificación" cuando no hay SUPPORT_EMAIL.
    async activeSupportEmails() {
        const rows = await pgrest('support_users_db').select('email')
            .eq('is_active', true).limit(20).execute();
        return (rows || []).map((r) => String(r.email || '').trim()).filter(Boolean);
    },

    async isActiveSupportAgent(userId) {
        if (!userId) return false;
        const row = await pgrest('support_users_db').select('user_id')
            .eq('user_id', userId).eq('is_active', true).limit(1).single().execute();
        return !!row;
    }
};

module.exports = { ArtistVerificationRepo, ARTIST_COLUMNS, DOC_COLUMNS, HISTORY_COLUMNS };
