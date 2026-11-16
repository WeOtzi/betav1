'use strict';

// ===========================================================================
// Repositorio de denuncias (servidor) — capa PostgREST.
// ---------------------------------------------------------------------------
// Tablas: support_tickets (kind 'denuncia'), support_ticket_reports
// (expediente), support_ticket_messages (notas internas), y lecturas de
// artists_db, clients_db, studios, studio_artist_memberships, quotations_db,
// chat_messages y quotations_attachments para armar el expediente.
// RPC: create_support_report (migración 20261116210000, solo service_role).
// Buckets privados: `support-attachments` (evidencia de la denuncia) y
// `chat-attachments` (adjuntos del chat de la cotización), con URLs firmadas.
//
// Todo corre con service-role: la autorización (quién puede denunciar qué,
// agente de soporte activo o superadmin) la hace lib/routes/denuncias.js ANTES
// de llamar a estos métodos. El email de las personas sale SIEMPRE de
// auth.users (Admin API), nunca de una columna editable del perfil.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { signStorageObject } = require('../storage-sign');
const {
    StudioVerificationRepo,
    isMissingSchemaError,
    pgErrorCode,
    pgErrorMessage
} = require('./studio-verification');
const { isUuid, ACTIVE_STATUSES, ATTACHMENTS_BUCKET, DOSSIER_MESSAGES_MAX } = require('../denuncias');

const CHAT_BUCKET = 'chat-attachments';
const SIGNED_TTL_SECONDS = 10 * 60;
const LIST_LIMIT = 200;

const ARTIST_SELECT = 'id,user_id,name,username,email,instagram,whatsapp_number,city,country,studio_id,estudios,'
    + 'styles_array,verification_state,instagram_verified_handle,registration_status,profile_picture';
const CLIENT_SELECT = 'user_id,email,full_name,instagram,whatsapp,city_residence,country,public_username,email_verified,created_at';
const STUDIO_SELECT = 'id,name,slug,user_id,email,phone,contact_phone,whatsapp,website,instagram,city,country,'
    + 'formatted_address,is_verified,verification_status,is_active,created_at';
// Sin salud, alergias ni fecha de nacimiento del cliente.
const QUOTATION_SELECT = 'id,quote_id,quote_status,source,created_at,updated_at,artist_id,artist_name,artist_username,'
    + 'artist_email,client_user_id,client_full_name,client_email,client_instagram,client_whatsapp,client_city_residence,'
    + 'tattoo_idea_description,project_description,tattoo_references,tattoo_body_part,tattoo_size,reference_images,drive_folder_url';
const MESSAGE_SELECT = 'id,sender_type,sender_id,message,message_kind,attachment_path,attachment_name,attachment_mime,created_at';
const QUOTE_ATTACHMENT_SELECT = 'id,file_name,mime_type,attachment_type,google_drive_url,created_at';
const TICKET_SELECT = 'id,ticket_number,kind,category,status,priority,subject,description,requester_user_id,requester_role,'
    + 'quotation_id,quote_id,attachments,page_context,assigned_support_user_id,resolution,resolution_outcome,'
    + 'last_activity_at,resolved_at,closed_at,created_at,updated_at';
const TICKET_SUMMARY_SELECT = 'id,ticket_number,status,priority,subject,assigned_support_user_id,created_at,last_activity_at,resolved_at';
const REPORT_COLUMNS = 'id,ticket_id,target_kind,target_key,reason,reporter_user_id,reporter_role,reporter_studio_id,'
    + 'reported_user_id,reported_role,reported_studio_id,quotation_id,quote_id,created_at';
const TICKET_MESSAGE_SELECT = 'id,author_user_id,author_role,body,is_internal,created_at';

function single(rows) {
    return Array.isArray(rows) ? (rows[0] || null) : (rows || null);
}

const DenunciasRepo = {
    ATTACHMENTS_BUCKET,
    CHAT_BUCKET,

    // ---- identidad ------------------------------------------------------------

    getAuthUserContact: StudioVerificationRepo.getAuthUserContact,

    getActiveSupportUser(userId) {
        return StudioVerificationRepo.getActiveSupportUser(userId);
    },

    // Destinatarios del aviso a soporte cuando no hay SUPPORT_EMAIL.
    async activeSupportEmails() {
        const rows = await pgrest('support_users_db').select('email').eq('is_active', true).limit(20).execute();
        return (rows || []).map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean);
    },

    // Nombre visible de los agentes que escribieron notas: Map<user_id, nombre>.
    async supportNamesByIds(userIds) {
        const ids = [...new Set((userIds || []).filter(isUuid))];
        if (!ids.length) return new Map();
        const rows = await pgrest('support_users_db').select('user_id,full_name,email').in('user_id', ids).execute();
        return new Map((rows || []).map((r) => [r.user_id, String(r.full_name || r.email || '').trim()]));
    },

    // ---- perfiles -------------------------------------------------------------

    getArtistByUserId(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('artists_db').select(ARTIST_SELECT).eq('user_id', userId).limit(1).single().execute();
    },

    // ref: { by: 'uuid' | 'username', value }. El uuid puede ser el user_id o
    // el id de la fila (las pantallas usan cualquiera de los dos).
    async findArtist(ref) {
        if (!ref || !ref.value) return null;
        if (ref.by === 'uuid') {
            if (!isUuid(ref.value)) return null;
            const rows = await pgrest('artists_db').select(ARTIST_SELECT)
                .or([{ col: 'user_id', op: 'eq', val: ref.value }, { col: 'id', op: 'eq', val: ref.value }])
                .limit(2).execute();
            const list = Array.isArray(rows) ? rows : [];
            return list.find((a) => a.user_id === ref.value) || list[0] || null;
        }
        const exact = await pgrest('artists_db').select(ARTIST_SELECT).eq('username', ref.value).limit(1).single().execute();
        if (exact) return exact;
        const lower = String(ref.value).toLowerCase();
        if (lower === ref.value) return null;
        return pgrest('artists_db').select(ARTIST_SELECT).eq('username', lower).limit(1).single().execute();
    },

    getClientByUserId(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('clients_db').select(CLIENT_SELECT).eq('user_id', userId).limit(1).single().execute();
    },

    // ref: { by: 'id' | 'slug', value }
    findStudio(ref) {
        if (!ref || !ref.value) return Promise.resolve(null);
        if (ref.by === 'id' && !isUuid(ref.value)) return Promise.resolve(null);
        return pgrest('studios').select(STUDIO_SELECT).eq(ref.by === 'id' ? 'id' : 'slug', ref.value).limit(1).single().execute();
    },

    // Estudios que la persona administra: los propios (studios.user_id) y los
    // que gestiona como manager activo (mismo criterio que private.studio_inbox_access:
    // role = 'manager' y status = 'active'). [{ studio, role: 'studio_owner' | 'studio_manager' }]
    async listAdministeredStudios(userId) {
        if (!isUuid(userId)) return [];
        const [owned, memberships] = await Promise.all([
            pgrest('studios').select(STUDIO_SELECT).eq('user_id', userId).limit(10).execute(),
            pgrest('studio_artist_memberships').select('studio_id,role,status')
                .eq('artist_user_id', userId).eq('role', 'manager').eq('status', 'active')
                .limit(20).execute()
        ]);
        const out = (owned || []).map((studio) => ({ studio, role: 'studio_owner' }));
        const ownedIds = new Set(out.map((entry) => entry.studio.id));
        const managedIds = [...new Set((memberships || []).map((m) => m.studio_id).filter((id) => isUuid(id) && !ownedIds.has(id)))];
        if (managedIds.length) {
            const managed = await pgrest('studios').select(STUDIO_SELECT).in('id', managedIds).execute();
            for (const studio of managed || []) out.push({ studio, role: 'studio_manager' });
        }
        return out;
    },

    // ---- cotización -----------------------------------------------------------

    // ref: { by: 'id' | 'quote_id', value }
    findQuotation(ref) {
        if (!ref || ref.value == null || ref.value === '') return Promise.resolve(null);
        return pgrest('quotations_db').select(QUOTATION_SELECT)
            .eq(ref.by === 'id' ? 'id' : 'quote_id', ref.value).limit(1).single().execute();
    },

    // Últimos mensajes del chat de la cotización, en orden cronológico.
    async listQuotationMessages(quoteId) {
        if (!quoteId) return { messages: [], total: 0 };
        const { rows, count } = await pgrest('chat_messages').select(MESSAGE_SELECT)
            .eq('quotation_id', String(quoteId))
            .order('created_at', { ascending: false })
            .limit(DOSSIER_MESSAGES_MAX)
            .count()
            .execute();
        const messages = (rows || []).slice().reverse();
        return { messages, total: Number.isFinite(count) ? count : messages.length };
    },

    async listQuotationAttachments(quoteId) {
        if (!quoteId) return [];
        const rows = await pgrest('quotations_attachments').select(QUOTE_ATTACHMENT_SELECT)
            .eq('quotation_id', String(quoteId))
            .order('created_at', { ascending: true })
            .limit(40)
            .execute();
        return rows || [];
    },

    // ---- alta -----------------------------------------------------------------

    // RPC create_support_report → { duplicate, ticket_id, ticket_number, report_id, status, created_at }
    createReport(report) {
        return pgrest.raw('rpc/create_support_report', { method: 'POST', body: { p_report: report } });
    },

    // ---- panel de soporte -------------------------------------------------------

    // Cola de denuncias con el resumen del denunciante y del denunciado (sin
    // el expediente completo). `statuses`: null = todas.
    async listReports({ statuses = ACTIVE_STATUSES, kind = 'all' } = {}) {
        const run = (columns, limit) => {
            let query = pgrest('support_ticket_reports')
                .select(`${REPORT_COLUMNS},${columns},support_tickets!inner(${TICKET_SUMMARY_SELECT})`);
            if (Array.isArray(statuses) && statuses.length) query = query.in('support_tickets.status', statuses);
            if (kind && kind !== 'all') query = query.eq('target_kind', kind);
            return query.order('created_at', { ascending: false }).limit(limit).execute();
        };
        let rows;
        try {
            // Solo las fichas resumidas del expediente (el chat no viaja en la cola).
            rows = await run('reporter_snapshot:dossier->reporter,reported_snapshot:dossier->reported', LIST_LIMIT);
        } catch (err) {
            // Un PostgREST que no acepte la ruta JSON en el select: se lee el expediente entero, en menos filas.
            if (err.status !== 400 || isMissingSchemaError(err)) throw err;
            rows = (await run('dossier', 50) || []).map(({ dossier, ...row }) => ({
                ...row,
                reporter_snapshot: dossier && dossier.reporter,
                reported_snapshot: dossier && dossier.reported
            }));
        }
        return (rows || []).map(({ reporter_snapshot: reporter, reported_snapshot: reported, support_tickets: ticket, ...row }) => ({
            ...row,
            ticket: ticket || null,
            dossier: { reporter: reporter || null, reported: reported || null }
        }));
    },

    async countActiveReports() {
        const { count } = await pgrest('support_tickets').select('id')
            .eq('kind', 'denuncia').in('status', ACTIVE_STATUSES)
            .limit(1).count().execute();
        return Number.isFinite(count) ? count : 0;
    },

    // Expediente completo de un ticket de denuncia o null.
    async getReportByTicket(ticketId) {
        if (!isUuid(ticketId)) return null;
        const rows = await pgrest('support_ticket_reports')
            .select(`${REPORT_COLUMNS},evidence_links,dossier,support_tickets!inner(${TICKET_SELECT})`)
            .eq('ticket_id', ticketId)
            .limit(1)
            .execute();
        const row = single(rows);
        if (!row) return null;
        const { support_tickets: ticket, ...report } = row;
        return { ...report, ticket: ticket || null };
    },

    async listTicketMessages(ticketId) {
        if (!isUuid(ticketId)) return [];
        const rows = await pgrest('support_ticket_messages').select(TICKET_MESSAGE_SELECT)
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true })
            .limit(200)
            .execute();
        return rows || [];
    },

    // Solo tickets de denuncia: el filtro por kind evita tocar consultas o disputas.
    async updateReportTicket(ticketId, patch) {
        if (!isUuid(ticketId)) return null;
        const rows = await pgrest('support_tickets').eq('id', ticketId).eq('kind', 'denuncia').patch(patch);
        return single(rows);
    },

    async addTicketMessage({ ticketId, authorUserId, authorRole = 'support', body, isInternal = true }) {
        const rows = await pgrest('support_ticket_messages').insert({
            ticket_id: ticketId,
            author_user_id: isUuid(authorUserId) ? authorUserId : null,
            author_role: authorRole,
            body,
            is_internal: isInternal === true
        });
        return single(rows);
    },

    // URL firmada (10 min) o null si el archivo no se puede firmar.
    async signObject(bucket, path) {
        try {
            const url = await signStorageObject(bucket, path, { expiresIn: SIGNED_TTL_SECONDS });
            return typeof url === 'string' ? url : null;
        } catch (_) {
            return null;
        }
    }
};

module.exports = { DenunciasRepo, isMissingSchemaError, pgErrorCode, pgErrorMessage };
