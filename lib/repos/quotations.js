'use strict';

// ===========================================================================
// Repositorio de Cotizaciones (servidor) — sobre la capa PostgREST unificada.
// ---------------------------------------------------------------------------
// Metodos con nombre para las operaciones server-side del dominio cotizaciones
// (los endpoints /hide, /complete, job-board accept, analytics y el tool del
// chatbot). Reemplazan a los `fetch('${url}/rest/v1/quotations_db...')` inline.
// Todo corre con service-role (salta RLS): la autorizacion la hacen los
// endpoints (ownership / verifyAdminCaller) ANTES de llamar a estos metodos.
//
// Recordatorio de claves de relacion (encapsuladas en los repos de hijas):
//   quotation_notes/quotation_sessions.quotation_id  -> quotations_db.id   (int)
//   quotations_attachments/chat_messages.quotation_id -> quotations_db.quote_id (text)
// ===========================================================================

const { pgrest } = require('../postgrest');

const QuotationsRepo = {
    // Lee una cotizacion por su quote_id textual. Devuelve la fila o null.
    getByQuoteId(quoteId, { select = '*' } = {}) {
        return pgrest('quotations_db').select(select).eq('quote_id', quoteId).limit(1).single().execute();
    },

    // Reclama una cotizacion para un cliente (auto-link por email) seteando
    // client_user_id. Best-effort (no devuelve representacion).
    claimForClient(id, clientUserId) {
        return pgrest('quotations_db').eq('id', id).patch({ client_user_id: clientUserId }, { returning: false });
    },

    // Soft-delete del lado cliente: marca client_deleted_at = ahora.
    softDeleteForClient(id) {
        return pgrest('quotations_db').eq('id', id).patch({ client_deleted_at: new Date().toISOString() });
    },

    // Cierre verificado por el cliente: artist_completed -> completed.
    markCompletedByClient(id, clientUserId, completedAt = new Date().toISOString()) {
        return pgrest('quotations_db').eq('id', id).patch({
            quote_status: 'completed',
            client_completed_at: completedAt,
            completed_by_client_user_id: clientUserId,
        });
    },

    // Inserta una cotizacion (usado por el flujo de job board). Devuelve la fila.
    async createFromJobBoard(payload) {
        const rows = await pgrest('quotations_db').insert(payload);
        return rows.length ? rows[0] : null;
    },

    // Chatbot get_quotation_status: cotizaciones donde el usuario es cliente o
    // artista. FIX (doc §4-E): usa columnas reales (antes pedia status/
    // service_type/user_id inexistentes y la query fallaba).
    listForUser({ userId, quoteId } = {}) {
        const q = pgrest('quotations_db')
            .select('id,quote_id,quote_status,created_at,updated_at,artist_id,client_user_id')
            .order('created_at', { ascending: false })
            .limit(10);
        if (quoteId) q.eq('id', quoteId);
        if (userId) {
            q.or([
                { col: 'client_user_id', op: 'eq', val: userId },
                { col: 'artist_id', op: 'eq', val: userId },
            ]);
        }
        return q.execute();
    },

    // Analytics de cotizaciones desde una fecha. FIX (doc §4-A): service-role
    // (el default de pgrest), no anon key; el endpoint exige verifyAdminCaller.
    fetchAnalyticsSince(sinceIso) {
        return pgrest('quotations_db')
            .select('quote_id,quote_status,tattoo_style,artist_id,artist_name,created_at,sent_to_artist_at,artist_responded_at')
            .gte('created_at', sinceIso)
            .execute();
    },
};

module.exports = { QuotationsRepo };
