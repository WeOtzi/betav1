'use strict';

// ===========================================================================
// Repositorio de la negociación de cotizaciones (servidor) — capa PostgREST.
// ---------------------------------------------------------------------------
// Frente "negociacion" (ronda 2): contrapropuestas del cliente y enmiendas del
// acuerdo. Corre con service-role: la autorización (parte de la cotización,
// estado, rol) la hace lib/routes/negociacion.js con lib/negociacion.js ANTES
// de llamar aquí, y las funciones de la base la revalidan con la fila bloqueada.
//
// Claves de relación:
//   quotation_proposals.quotation_id → quotations_db.id (int)
//   quotation_proposals.quote_id     = quotations_db.quote_id (text, copia)
//   quotation_payments / quotation_sessions.quotation_id → quotations_db.id
//   artist_manual_quotes.quote_id    = quotations_db.quote_id (text)
// ===========================================================================

const { pgrest } = require('../postgrest');

// Solo lo que la negociación necesita (nunca salud, alergias ni contacto).
// short_code (20261116110000) va en la lectura principal: este frente ya
// depende de columnas posteriores (agreement_*, 20261116140000).
const QUOTE_SELECT = [
    'id', 'quote_id', 'short_code', 'quote_status', 'client_user_id', 'client_email', 'client_full_name',
    'artist_id', 'artist_name', 'artist_email', 'artist_responded_at',
    'artist_budget_amount', 'artist_budget_currency',
    'final_budget_amount', 'final_budget_currency', 'final_sessions', 'final_comment',
    'tattoo_estimated_sessions', 'artist_deposit_pct', 'artist_deposit_amount',
    'tattoo_body_part', 'tattoo_size', 'tattoo_style', 'tattoo_color_type', 'tattoo_idea_description',
    'quote_expires_at', 'dispute_status', 'agreement_approved_at', 'agreement_version',
    'support_closed_reason',
].join(',');

const PROPOSAL_SELECT = [
    'id', 'quotation_id', 'quote_id', 'kind', 'proposed_by', 'proposer_user_id', 'status', 'changes',
    'currency', 'note', 'response_note', 'resolved_by', 'resolved_at', 'base_agreement_version',
    'created_at', 'updated_at',
].join(',');

const INACTIVE_SESSION = ['cancelled', 'canceled', 'no_show'];

const NegotiationRepo = {
    getQuotation(quoteId) {
        return pgrest('quotations_db').select(QUOTE_SELECT).eq('quote_id', quoteId).limit(1).single().execute();
    },

    // Más reciente primero: la pendiente (si hay) y el historial.
    listProposals(quotationId, limit = 30) {
        return pgrest('quotation_proposals')
            .select(PROPOSAL_SELECT)
            .eq('quotation_id', quotationId)
            .order('created_at', { ascending: false })
            .limit(limit)
            .execute();
    },

    getProposal(id) {
        return pgrest('quotation_proposals').select(PROPOSAL_SELECT).eq('id', id).limit(1).single().execute();
    },

    // Alta atómica (public.negociacion_propose). Devuelve la fila creada.
    // Lanza con el código NEG_* en el mensaje si la base la rechaza.
    propose({ quotationId, actor, role, kind, changes, note }) {
        return pgrest.raw('rpc/negociacion_propose', {
            method: 'POST',
            body: {
                p_quotation_id: quotationId,
                p_actor: actor,
                p_role: role,
                p_kind: kind,
                p_changes: changes,
                p_note: note || null,
            },
        });
    },

    // Resolución atómica (public.negociacion_resolve): accept aplica los
    // cambios a la cotización; reject / withdraw no la tocan.
    // Devuelve { already, proposal }.
    resolve({ proposalId, actor, action, note }) {
        return pgrest.raw('rpc/negociacion_resolve', {
            method: 'POST',
            body: { p_proposal_id: proposalId, p_actor: actor, p_action: action, p_note: note || null },
        });
    },

    // Lo ya registrado como pagado en la moneda del acuerdo (piso del precio).
    async paidTotal(quotationId, currency) {
        const code = String(currency || '').trim().toUpperCase();
        if (!code) return 0;
        const rows = await pgrest('quotation_payments')
            .select('amount,currency')
            .eq('quotation_id', quotationId)
            .limit(200)
            .execute();
        const total = (rows || []).reduce((sum, row) => (
            String(row.currency || '').toUpperCase() === code ? sum + (Number(row.amount) || 0) : sum
        ), 0);
        return Math.round(total * 100) / 100;
    },

    // Sesiones que ocupan un lugar del acuerdo (piso de las sesiones).
    async activeSessions(quotationId) {
        const rows = await pgrest('quotation_sessions')
            .select('id,status')
            .eq('quotation_id', quotationId)
            .limit(200)
            .execute();
        return (rows || []).filter((s) => !INACTIVE_SESSION.includes(String(s.status || '').toLowerCase())).length;
    },

    // Anticipo de la cotización manual enviada (si la hay): el panel de pagos lo
    // prefiere a quotations_db.artist_deposit_*.
    async manualDepositPct(quoteId) {
        const row = await pgrest('artist_manual_quotes')
            .select('deposit_pct,deposit_amount,status')
            .eq('quote_id', quoteId)
            .eq('status', 'sent')
            .limit(1)
            .single()
            .execute();
        if (!row || !(Number(row.deposit_amount) > 0)) return null;
        const pct = Number(row.deposit_pct);
        return Number.isFinite(pct) && pct > 0 ? pct : null;
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

module.exports = { NegotiationRepo, QUOTE_SELECT, PROPOSAL_SELECT };
