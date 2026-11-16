'use strict';

// ===========================================================================
// Repositorio del feedback de la beta (servidor) — capa PostgREST.
// ---------------------------------------------------------------------------
// Tabla public.beta_feedback (migración 20261117120000) y lecturas livianas de
// artists_db, clients_db, studios y studio_artist_memberships para saber el
// tipo de cuenta y el nombre visible. Todo con service-role: la autorización
// (dueño del envío, agente de soporte activo o superadmin) la hace
// lib/routes/feedback.js ANTES de llamar a estos métodos.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { signStorageObject } = require('../storage-sign');
const { StudioVerificationRepo, isMissingSchemaError, pgErrorCode } = require('./studio-verification');
const { isUuid, ATTACHMENTS_BUCKET, EXPORT_MAX } = require('../feedback');

const TABLE = 'beta_feedback';
const SIGNED_TTL_SECONDS = 10 * 60;
const ROW_SELECT = 'id,user_id,role,kind,survey_key,rating,dismissed,message,page_path,page_title,context,attachments,'
    + 'status,support_note,handled_by,created_at,updated_at';
const LIST_SELECT = 'id,user_id,role,kind,survey_key,rating,dismissed,message,page_path,page_title,context,attachments,'
    + 'status,support_note,created_at,updated_at';
const SUMMARY_SELECT = 'role,kind,status,survey_key,rating,dismissed';
const SUMMARY_MAX = 20000;

function first(rows) {
    return Array.isArray(rows) ? (rows[0] || null) : (rows || null);
}

// Filtros de la lista y del CSV sobre una consulta de beta_feedback.
function applyFilters(query, f) {
    const filters = f || {};
    if (filters.role) query.eq('role', filters.role);
    if (filters.kind) query.eq('kind', filters.kind);
    if (filters.status) query.eq('status', filters.status);
    if (filters.survey_key) query.eq('survey_key', filters.survey_key);
    if (!filters.include_dismissed) query.eq('dismissed', false);
    if (filters.from) query.gte('created_at', `${filters.from}T00:00:00Z`);
    if (filters.to) query.lt('created_at', new Date(Date.parse(`${filters.to}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString());
    if (filters.q) {
        const term = `*${filters.q}*`;
        query.or([
            { col: 'message', op: 'ilike', val: term },
            { col: 'page_path', op: 'ilike', val: term },
            { col: 'page_title', op: 'ilike', val: term },
            { col: 'support_note', op: 'ilike', val: term }
        ]);
    }
    return query;
}

const FeedbackRepo = {
    ATTACHMENTS_BUCKET,

    // ---- tipo de cuenta -------------------------------------------------------

    async getArtist(userId) {
        if (!isUuid(userId)) return null;
        return pgrest('artists_db').select('user_id,name,username').eq('user_id', userId).limit(1).single().execute();
    },

    async getClient(userId) {
        if (!isUuid(userId)) return null;
        return pgrest('clients_db').select('user_id,full_name,public_username').eq('user_id', userId).limit(1).single().execute();
    },

    // Estudios que administra: dueño (studios.user_id) o manager activo
    // (mismo criterio que lib/repos/denuncias.js · listAdministeredStudios).
    async listAdministeredStudios(userId) {
        if (!isUuid(userId)) return [];
        const [owned, memberships] = await Promise.all([
            pgrest('studios').select('id,name,user_id').eq('user_id', userId).limit(10).execute(),
            pgrest('studio_artist_memberships').select('studio_id')
                .eq('artist_user_id', userId).eq('role', 'manager').eq('status', 'active')
                .limit(20).execute()
        ]);
        const out = (owned || []).map((studio) => ({ studio, role: 'studio_owner' }));
        const ownedIds = new Set(out.map((entry) => entry.studio.id));
        const managedIds = [...new Set((memberships || []).map((m) => m.studio_id).filter((id) => isUuid(id) && !ownedIds.has(id)))];
        if (managedIds.length) {
            const managed = await pgrest('studios').select('id,name,user_id').in('id', managedIds).execute();
            for (const studio of managed || []) out.push({ studio, role: 'studio_manager' });
        }
        return out;
    },

    // { artist, client, studio } booleanos.
    async resolveRoles(userId) {
        const [artist, client, studios] = await Promise.all([
            this.getArtist(userId).catch(() => null),
            this.getClient(userId).catch(() => null),
            this.listAdministeredStudios(userId).catch(() => [])
        ]);
        return { artist: Boolean(artist), client: Boolean(client), studio: Boolean(studios && studios.length) };
    },

    // ---- envíos de la persona ---------------------------------------------------

    // Envíos con contenido desde `sinceIso` (los descartes de encuesta no cuentan).
    async countSince(userId, sinceIso) {
        const res = await pgrest(TABLE).select('id').eq('user_id', userId).eq('dismissed', false)
            .gte('created_at', sinceIso).limit(1).count('exact').execute();
        return res && typeof res.count === 'number' ? res.count : (Array.isArray(res && res.rows) ? res.rows.length : 0);
    },

    async findSurvey(userId, key) {
        return pgrest(TABLE).select('id,survey_key,dismissed,rating,created_at')
            .eq('user_id', userId).eq('kind', 'survey').eq('survey_key', key).limit(1).single().execute();
    },

    async listSurveyKeys(userId) {
        const rows = await pgrest(TABLE).select('survey_key,dismissed')
            .eq('user_id', userId).eq('kind', 'survey').limit(100).execute();
        return Array.isArray(rows) ? rows : [];
    },

    async insert(row) {
        return first(await pgrest(TABLE).insert(row));
    },

    // ---- soporte ------------------------------------------------------------------

    getActiveSupportUser(userId) {
        return StudioVerificationRepo.getActiveSupportUser(userId);
    },

    getAuthUserContact: StudioVerificationRepo.getAuthUserContact,

    async list(filters) {
        const f = filters || {};
        const query = pgrest(TABLE).select(LIST_SELECT).order('created_at', { ascending: false })
            .range(f.offset || 0, (f.offset || 0) + (f.page_size || 25) - 1).count('exact');
        applyFilters(query, f);
        const res = await query.execute();
        return { rows: Array.isArray(res && res.rows) ? res.rows : [], total: res && typeof res.count === 'number' ? res.count : null };
    },

    async listForExport(filters) {
        const query = pgrest(TABLE).select(LIST_SELECT).order('created_at', { ascending: false }).limit(EXPORT_MAX);
        applyFilters(query, filters);
        const rows = await query.execute();
        return Array.isArray(rows) ? rows : [];
    },

    async summaryRows() {
        const rows = await pgrest(TABLE).select(SUMMARY_SELECT).limit(SUMMARY_MAX).execute();
        return Array.isArray(rows) ? rows : [];
    },

    async getById(id) {
        if (!isUuid(id)) return null;
        return pgrest(TABLE).select(ROW_SELECT).eq('id', id).limit(1).single().execute();
    },

    async update(id, patch) {
        if (!isUuid(id)) return null;
        return first(await pgrest(TABLE).eq('id', id).patch(patch));
    },

    // Map<user_id, { artist, client, studio }> con el nombre visible de cada tipo de cuenta.
    async namesFor(userIds) {
        const ids = [...new Set((userIds || []).filter(isUuid))];
        const out = new Map(ids.map((id) => [id, {}]));
        if (!ids.length) return out;
        const [artists, clients, studios] = await Promise.all([
            pgrest('artists_db').select('user_id,name,username').in('user_id', ids).execute().catch(() => []),
            pgrest('clients_db').select('user_id,full_name,public_username').in('user_id', ids).execute().catch(() => []),
            pgrest('studios').select('user_id,name').in('user_id', ids).execute().catch(() => [])
        ]);
        for (const a of artists || []) {
            const entry = out.get(a.user_id);
            if (entry && !entry.artist) entry.artist = String(a.name || a.username || '').trim();
        }
        for (const c of clients || []) {
            const entry = out.get(c.user_id);
            if (entry && !entry.client) entry.client = String(c.full_name || c.public_username || '').trim();
        }
        for (const s of studios || []) {
            const entry = out.get(s.user_id);
            if (entry && !entry.studio) entry.studio = String(s.name || '').trim();
        }
        return out;
    },

    // URL firmada (10 min) o null si el archivo no se puede firmar.
    async signObject(path) {
        try {
            const url = await signStorageObject(ATTACHMENTS_BUCKET, path, { expiresIn: SIGNED_TTL_SECONDS });
            return typeof url === 'string' ? url : null;
        } catch (_) {
            return null;
        }
    }
};

module.exports = { FeedbackRepo, applyFilters, isMissingSchemaError, pgErrorCode };
