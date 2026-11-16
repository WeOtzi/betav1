'use strict';

// ===========================================================================
// Repositorio de disputas para el panel de soporte (servidor) — capa PostgREST.
// ---------------------------------------------------------------------------
// Tablas: support_tickets (SOLO kind = 'disputa'), support_ticket_messages,
// quotation_session_disputes (vínculo con la sesión, migración
// 20261116150000), quotation_sessions y quotations_db.
//
// Todo corre con service-role: la autorización (agente de soporte activo o
// superadmin) la hace lib/routes/soporte-disputas.js ANTES de llamar acá.
// Cada escritura filtra por kind = 'disputa': desde estas rutas no se tocan
// consultas ni denuncias. Al cambiar el estado, el trigger vivo
// trg_support_tickets_sync_dispute recalcula quotations_db.dispute_status.
//
// Las lecturas se hacen en consultas separadas (sin embeber relaciones) para
// no depender de que PostgREST ya conozca quotation_session_disputes: sin la
// migración, la cola sigue mostrando las disputas, sin el dato de la sesión.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { StudioVerificationRepo, isMissingSchemaError, pgErrorCode } = require('./studio-verification');
const { readShortCode } = require('./quote-code');
const { isUuid, ACTIVE_STATUSES } = require('../soporte-disputas');

const LIST_LIMIT = 200;
const TICKET_SELECT = 'id,ticket_number,kind,category,status,priority,subject,description,requester_user_id,requester_role,'
    + 'counterpart_user_id,counterpart_role,quotation_id,quote_id,dispute_reason,desired_outcome,page_context,'
    + 'assigned_support_user_id,resolution,resolution_outcome,last_activity_at,resolved_at,closed_at,created_at,updated_at';
const LINK_SELECT = 'id,session_id,quotation_id,ticket_id,opened_by,opened_by_role,reason,created_at';
// select('*'): client_confirmation y location_* llegan con 20261116150000.
const SESSION_SELECT = '*';
// Sin salud, alergias ni fecha de nacimiento del cliente.
const QUOTE_SELECT = 'id,quote_id,quote_status,dispute_status,client_user_id,client_email,client_full_name,'
    + 'artist_id,artist_email,artist_name,artist_username,tattoo_body_part,tattoo_size,created_at';
const MESSAGE_SELECT = 'id,author_user_id,author_role,body,is_internal,created_at';

function single(rows) {
    return Array.isArray(rows) ? (rows[0] || null) : (rows || null);
}

function unique(values) {
    return [...new Set((values || []).filter((v) => v != null && v !== ''))];
}

async function sessionLinks(ticketIds) {
    const ids = unique(ticketIds);
    if (!ids.length) return [];
    try {
        return (await pgrest('quotation_session_disputes').select(LINK_SELECT).in('ticket_id', ids).limit(ids.length).execute()) || [];
    } catch (err) {
        // Base sin la migración de sesiones: las disputas se listan sin la sesión.
        if (isMissingSchemaError(err)) return [];
        throw err;
    }
}

async function hydrate(tickets) {
    const list = tickets || [];
    if (!list.length) return [];
    const links = await sessionLinks(list.map((t) => t.id));
    const sessionIds = unique(links.map((l) => l.session_id));
    const quotationIds = unique(list.map((t) => t.quotation_id));
    const [sessions, quotes] = await Promise.all([
        sessionIds.length
            ? pgrest('quotation_sessions').select(SESSION_SELECT).in('id', sessionIds).limit(sessionIds.length).execute()
            : [],
        quotationIds.length
            ? pgrest('quotations_db').select(QUOTE_SELECT).in('id', quotationIds).limit(quotationIds.length).execute()
            : [],
    ]);
    const linkByTicket = new Map(links.map((l) => [l.ticket_id, l]));
    const sessionById = new Map((sessions || []).map((s) => [s.id, s]));
    const quoteById = new Map((quotes || []).map((q) => [String(q.id), q]));
    return list.map((ticket) => {
        const link = linkByTicket.get(ticket.id) || null;
        return {
            ticket,
            link,
            session: link ? (sessionById.get(link.session_id) || null) : null,
            quote: ticket.quotation_id != null ? (quoteById.get(String(ticket.quotation_id)) || null) : null,
        };
    });
}

const DisputasRepo = {
    getActiveSupportUser(userId) {
        return StudioVerificationRepo.getActiveSupportUser(userId);
    },

    // Nombre visible de los agentes que escribieron en el ticket: Map<user_id, nombre>.
    async supportNamesByIds(userIds) {
        const ids = unique(userIds).filter(isUuid);
        if (!ids.length) return new Map();
        const rows = await pgrest('support_users_db').select('user_id,full_name,email').in('user_id', ids).execute();
        return new Map((rows || []).map((r) => [r.user_id, String(r.full_name || r.email || '').trim()]));
    },

    // Cola de disputas con su sesión y su cotización. `statuses`: null = todas.
    async listDisputeTickets({ statuses = ACTIVE_STATUSES } = {}) {
        let query = pgrest('support_tickets').select(TICKET_SELECT).eq('kind', 'disputa');
        if (Array.isArray(statuses) && statuses.length) query = query.in('status', statuses);
        const tickets = await query.order('last_activity_at', { ascending: false }).limit(LIST_LIMIT).execute();
        return hydrate(tickets || []);
    },

    async countActiveDisputes() {
        const { count } = await pgrest('support_tickets').select('id')
            .eq('kind', 'disputa').in('status', ACTIVE_STATUSES)
            .limit(1).count().execute();
        return Number.isFinite(count) ? count : 0;
    },

    // { ticket, link, session, quote } de un ticket de disputa, o null.
    async getDisputeTicket(ticketId) {
        if (!isUuid(ticketId)) return null;
        const rows = await pgrest('support_tickets').select(TICKET_SELECT)
            .eq('id', ticketId).eq('kind', 'disputa').limit(1).execute();
        const ticket = single(rows);
        if (!ticket) return null;
        return single(await hydrate([ticket]));
    },

    async listTicketMessages(ticketId) {
        if (!isUuid(ticketId)) return [];
        const rows = await pgrest('support_ticket_messages').select(MESSAGE_SELECT)
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true })
            .limit(200)
            .execute();
        return rows || [];
    },

    // Solo tickets de disputa: el filtro por kind evita tocar consultas o denuncias.
    async updateDisputeTicket(ticketId, patch) {
        if (!isUuid(ticketId)) return null;
        const rows = await pgrest('support_tickets').eq('id', ticketId).eq('kind', 'disputa').patch(patch);
        return single(rows);
    },

    async addTicketMessage({ ticketId, authorUserId, authorRole = 'support', body, isInternal = true }) {
        const rows = await pgrest('support_ticket_messages').insert({
            ticket_id: ticketId,
            author_user_id: isUuid(authorUserId) ? authorUserId : null,
            author_role: authorRole,
            body,
            is_internal: isInternal === true,
        });
        return single(rows);
    },

    // Email vigente del artista (el de la cotización puede haber quedado viejo).
    getArtist(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('artists_db').select('user_id,name,email,username').eq('user_id', userId).limit(1).single().execute();
    },

    // Código corto visible para el correo; nunca lanza.
    getShortCode(quotationId) {
        return readShortCode({ id: quotationId });
    },
};

module.exports = { DisputasRepo, isMissingSchemaError, pgErrorCode };
