'use strict';

// ===========================================================================
// Repositorio de cotizaciones del lado CLIENTE (servidor) — capa PostgREST.
// ---------------------------------------------------------------------------
// Frente cot-cliente (beta cerrada): vínculo de cotizaciones de invitado y
// decisión del cliente sobre la propuesta del artista. Corre con service-role:
// la autorización (dueño / email verificado / estado) la hace
// lib/routes/cot-cliente.js con lib/cot-cliente.js ANTES de llamar aquí.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { escapeLike } = require('../cot-cliente');

const DECISION_SELECT = [
    'id', 'quote_id', 'quote_status', 'client_user_id', 'client_email', 'client_full_name',
    'artist_id', 'artist_name', 'artist_email', 'artist_budget_amount', 'artist_budget_currency',
    'final_budget_amount', 'final_budget_currency', 'final_sessions', 'tattoo_estimated_sessions',
    'artist_session_minutes', 'artist_responded_at', 'quote_expires_at', 'dispute_status',
    'tattoo_style', 'tattoo_body_part', 'tattoo_size',
].join(',');

const CLAIM_SELECT = 'id,quote_id,quote_status,client_email,client_user_id,artist_responded_at,artist_budget_amount,final_budget_amount';

const ClientQuotationsRepo = {
    getForDecision(quoteId) {
        return pgrest('quotations_db').select(DECISION_SELECT).eq('quote_id', quoteId).limit(1).single().execute();
    },

    // Candidatos sin dueño cuyo email contiene el del usuario (ilike con los
    // comodines escapados). El filtro exacto lo hace lib/cot-cliente.filterClaimable.
    listUnclaimedByEmail(email) {
        return pgrest('quotations_db')
            .select(CLAIM_SELECT)
            .ilike('client_email', `*${escapeLike(String(email || '').trim())}*`)
            .is('client_user_id', null)
            .limit(200)
            .execute();
    },

    // Vincula por id solo las que siguen sin dueño (evita carreras). Devuelve
    // las filas vinculadas.
    async claimIds(ids, userId) {
        if (!Array.isArray(ids) || !ids.length) return [];
        return pgrest('quotations_db')
            .select('id,quote_id')
            .in('id', ids)
            .is('client_user_id', null)
            .patch({ client_user_id: userId });
    },

    // Guarda la decisión solo si la fila sigue en 'responded' (y, si se
    // reclama en el mismo paso, solo si sigue sin dueño o ya es del usuario).
    // Devuelve la fila guardada o null si otro cambio ganó la carrera.
    async decide(id, patch, { userId, claim } = {}) {
        const q = pgrest('quotations_db').select(DECISION_SELECT).eq('id', id).eq('quote_status', 'responded');
        if (claim) q.is('client_user_id', null);
        else q.eq('client_user_id', userId);
        const body = claim ? Object.assign({}, patch, { client_user_id: userId }) : patch;
        const rows = await q.patch(body);
        return rows && rows.length ? rows[0] : null;
    },

    // El trigger fn_quotation_status_change inserta el historial con changed_by
    // null (con service-role no hay JWT). Completamos actor y motivo.
    annotateHistory(quotationId, status, sinceIso, { changedBy, notes }) {
        return pgrest('quotation_status_history')
            .eq('quotation_id', quotationId)
            .eq('new_status', status)
            .is('changed_by', null)
            .gte('changed_at', sinceIso)
            .patch({ changed_by: changedBy, notes: notes || null }, { returning: false });
    },

    getArtist(userId) {
        if (!userId) return Promise.resolve(null);
        return pgrest('artists_db').select('user_id,name,email,username').eq('user_id', userId).limit(1).single().execute();
    },

    listScheduledSessions(quotationId) {
        return pgrest('quotation_sessions')
            .select('id,quotation_id,session_number,session_date,duration_hours,status')
            .eq('quotation_id', quotationId)
            .eq('status', 'scheduled')
            .order('session_date', { ascending: true })
            .limit(30)
            .execute();
    },
};

module.exports = { ClientQuotationsRepo, DECISION_SELECT };
