'use strict';

// ===========================================================================
// Repositorio de sanciones (servidor) — capa PostgREST, service-role.
// ---------------------------------------------------------------------------
// Tablas de la migración 20261118130000: account_sanctions, security_alerts,
// y las columnas artists_db.sanction_state/sanction_id,
// studios.sanction_state/sanction_id, quotations_db.support_closed_reason.
// Además lee y escribe artist_wallet_movements, store_orders,
// quotation_payments, clients_db y support_users_db.
//
// La autorización (agente de soporte activo o superadmin) la hace
// lib/routes/sanciones.js ANTES de llamar a estos métodos. Las escrituras son
// condicionales para que un reintento no pise lo que ya cambió.
// ===========================================================================

const { pgrest } = require('../postgrest');
const {
    StudioVerificationRepo,
    isMissingSchemaError,
    pgErrorCode,
    pgErrorMessage
} = require('./studio-verification');
const S = require('../sanciones');

const SANCTION_SELECT = 'id,user_id,kind,reason_code,summary,ticket_id,proposed_by,confirmed_by,starts_at,ends_at,status,'
    + 'appeal_text,appeal_submitted_at,appeal_decided_by,appeal_decided_at,appeal_outcome,side_effects,created_at,updated_at';
const ALERT_SELECT = 'id,kind,status,subject_user_id,related_user_id,payload,resolution,handled_by,handled_at,created_at';
const ARTIST_SELECT = 'id,user_id,name,username,instagram,whatsapp_number,country,sanction_state,sanction_id';
const CLIENT_SELECT = 'user_id,full_name,public_username,instagram,whatsapp,country';
const STUDIO_SELECT = 'id,name,slug,user_id,instagram,whatsapp,contact_phone,phone,country,is_active,sanction_state,sanction_id';
const QUOTE_SELECT = 'id,quote_id,quote_status,artist_id,artist_name,client_user_id,client_email,client_full_name,support_closed_reason';
const LIST_LIMIT = 200;
const SEARCH_LIMIT = 8;

function isUuid(value) {
    return S.isUuid(value);
}

function single(rows) {
    return Array.isArray(rows) ? (rows[0] || null) : (rows || null);
}

function ilikeTerm(q) {
    return `*${String(q || '').replace(/[*%,()\\]/g, ' ').trim()}*`;
}

const SancionesRepo = {
    // ---- identidad de soporte -------------------------------------------------

    getActiveSupportUser(userId) {
        return StudioVerificationRepo.getActiveSupportUser(userId);
    },

    async activeSupportEmails() {
        const rows = await pgrest('support_users_db').select('email').eq('is_active', true).limit(20).execute();
        return (rows || []).map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean);
    },

    async supportNamesByIds(userIds) {
        const ids = [...new Set((userIds || []).filter(isUuid))];
        if (!ids.length) return new Map();
        const rows = await pgrest('support_users_db').select('user_id,full_name,email').in('user_id', ids).execute();
        return new Map((rows || []).map((r) => [r.user_id, String(r.full_name || r.email || '').trim()]));
    },

    // ---- sanciones ------------------------------------------------------------

    getSanction(id) {
        if (!isUuid(id)) return Promise.resolve(null);
        return pgrest('account_sanctions').select(SANCTION_SELECT).eq('id', id).limit(1).single().execute();
    },

    async listSanctions({ status = 'all', user = null } = {}) {
        let q = pgrest('account_sanctions').select(SANCTION_SELECT);
        if (status && status !== 'all') q = q.eq('status', status);
        if (user) q = q.eq('user_id', user);
        const rows = await q.order('created_at', { ascending: false }).limit(LIST_LIMIT).execute();
        return Array.isArray(rows) ? rows : [];
    },

    async countByStatus() {
        const rows = await pgrest('account_sanctions').select('status').in('status', ['proposed', 'appealed']).limit(500).execute();
        const out = { proposed: 0, appealed: 0 };
        for (const r of rows || []) if (out[r.status] !== undefined) out[r.status] += 1;
        return out;
    },

    // Sanciones vigentes (activa o apelada) de una persona, más nuevas primero.
    async listEffectiveSanctions(userId) {
        if (!isUuid(userId)) return [];
        const rows = await pgrest('account_sanctions').select(SANCTION_SELECT)
            .eq('user_id', userId).in('status', S.EFFECTIVE_STATUSES)
            .order('created_at', { ascending: false }).limit(20).execute();
        return Array.isArray(rows) ? rows : [];
    },

    // Suspensiones vigentes cuyo plazo ya terminó.
    async listExpiredSuspensions(nowIso) {
        const rows = await pgrest('account_sanctions').select(SANCTION_SELECT)
            .eq('kind', 'suspension').in('status', S.EFFECTIVE_STATUSES).lt('ends_at', nowIso)
            .limit(50).execute();
        return Array.isArray(rows) ? rows : [];
    },

    async createSanction(row) {
        return single(await pgrest('account_sanctions').select(SANCTION_SELECT).insert(row));
    },

    // PATCH condicional: { expectStatus } evita pisar un cambio concurrente.
    // Devuelve la fila actualizada o null si ya no estaba en ese estado.
    async updateSanction(id, patch, { expectStatus = null, appealPending = false } = {}) {
        if (!isUuid(id)) return null;
        let q = pgrest('account_sanctions').select(SANCTION_SELECT).eq('id', id);
        if (expectStatus) q = Array.isArray(expectStatus) ? q.in('status', expectStatus) : q.eq('status', expectStatus);
        if (appealPending) q = q.is('appeal_submitted_at', 'null');
        return single(await q.patch(patch));
    },

    // Guarda side_effects. Con { expectUpdatedAt } es un compare-and-set: solo
    // escribe si la fila no cambió desde que se leyó (el trigger
    // trg_account_sanctions_updated_at mueve updated_at en cada UPDATE).
    // Devuelve la fila o null si otro la cambió entre medio.
    async saveSideEffects(id, sideEffects, { expectUpdatedAt = null } = {}) {
        if (!isUuid(id)) return null;
        let q = pgrest('account_sanctions').select('id,status,side_effects,updated_at').eq('id', id);
        if (expectUpdatedAt) q = q.eq('updated_at', expectUpdatedAt);
        return single(await q.patch({ side_effects: sideEffects }));
    },

    // ---- perfiles ---------------------------------------------------------------

    getArtistByUserId(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('artists_db').select(ARTIST_SELECT).eq('user_id', userId).limit(1).single().execute();
    },

    getClientByUserId(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('clients_db').select(CLIENT_SELECT).eq('user_id', userId).limit(1).single().execute();
    },

    async listOwnedStudios(userId) {
        if (!isUuid(userId)) return [];
        const rows = await pgrest('studios').select(STUDIO_SELECT).eq('user_id', userId).limit(20).execute();
        return Array.isArray(rows) ? rows : [];
    },

    async setArtistSanctionState(userId, state, sanctionId, { onlyIfSanction = null } = {}) {
        if (!isUuid(userId)) return [];
        let q = pgrest('artists_db').select('id,user_id,sanction_state,sanction_id').eq('user_id', userId);
        if (onlyIfSanction) q = q.eq('sanction_id', onlyIfSanction);
        return (await q.patch({ sanction_state: state, sanction_id: sanctionId || null })) || [];
    },

    // Estudios del dueño: estado de sanción (+ is_active si se pasa).
    async setStudiosSanctionState(ids, { state, sanctionId, isActive, onlyIfSanction = null } = {}) {
        const list = (ids || []).filter(isUuid);
        if (!list.length) return [];
        const patch = { sanction_state: state, sanction_id: sanctionId || null };
        if (typeof isActive === 'boolean') patch.is_active = isActive;
        let q = pgrest('studios').select('id,is_active,sanction_state,sanction_id').in('id', list);
        if (onlyIfSanction) q = q.eq('sanction_id', onlyIfSanction);
        return (await q.patch(patch)) || [];
    },

    // ---- cotizaciones -------------------------------------------------------------

    // Ids de las cotizaciones abiertas del artista (las que una sanción va a
    // cancelar). El servicio guarda esta lista en side_effects antes de cancelar.
    async listOpenQuotationIds(artistUserId) {
        if (!isUuid(artistUserId)) return [];
        const rows = await pgrest('quotations_db').select('id').eq('artist_id', artistUserId)
            .in('quote_status', S.OPEN_QUOTE_STATUSES).order('id', { ascending: true }).limit(500).execute();
        return (rows || []).map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
    },

    // Cancela esas cotizaciones si siguen abiertas (PATCH condicional) y
    // devuelve las que, de esa lista, quedaron canceladas por soporte (también
    // las de un intento anterior interrumpido de la MISMA sanción). Nunca
    // devuelve las canceladas por otra sanción ya levantada.
    async cancelOpenQuotations(artistUserId, ids) {
        const list = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (!isUuid(artistUserId) || !list.length) return [];
        await pgrest('quotations_db').select('id').eq('artist_id', artistUserId).in('id', list)
            .in('quote_status', S.OPEN_QUOTE_STATUSES)
            .patch({ quote_status: 'cancelled', support_closed_reason: S.SUPPORT_CLOSED_REASON });
        const rows = await pgrest('quotations_db').select(QUOTE_SELECT).eq('artist_id', artistUserId).in('id', list)
            .eq('quote_status', 'cancelled').eq('support_closed_reason', S.SUPPORT_CLOSED_REASON)
            .limit(500).execute();
        return Array.isArray(rows) ? rows : [];
    },

    async getQuotationsByIds(ids) {
        const list = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (!list.length) return [];
        const rows = await pgrest('quotations_db').select(QUOTE_SELECT).in('id', list).limit(500).execute();
        return Array.isArray(rows) ? rows : [];
    },

    // Anticipos registrados en esas cotizaciones (quotation_payments kind deposit).
    async listDepositsForQuotations(quotationIds) {
        const list = (quotationIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (!list.length) return [];
        const rows = await pgrest('quotation_payments').select('id,quotation_id,quote_id,amount,currency,paid_on,method')
            .in('quotation_id', list).eq('kind', 'deposit').limit(500).execute();
        return Array.isArray(rows) ? rows : [];
    },

    // ---- billetera y Store ------------------------------------------------------------

    // Retiros en proceso y liberaciones pendientes → 'blocked' (con el estado
    // anterior en metadata_json para poder volver). Devuelve [{ id, status }]
    // con el estado anterior de cada movimiento retenido por ESTA sanción.
    async blockWalletMovements(userId, sanctionId) {
        if (!isUuid(userId)) return [];
        const pending = await pgrest('artist_wallet_movements').select('id,kind,status,metadata_json')
            .eq('artist_user_id', userId)
            .in('kind', ['withdrawal', 'release'])
            .in('status', ['processing', 'pending_service', 'awaiting_release'])
            .limit(500).execute();
        const targets = (pending || []).filter((m) => (m.kind === 'withdrawal' && m.status === 'processing')
            || (m.kind === 'release' && (m.status === 'pending_service' || m.status === 'awaiting_release')));
        for (const m of targets) {
            const meta = m.metadata_json && typeof m.metadata_json === 'object' ? m.metadata_json : {};
            await pgrest('artist_wallet_movements').eq('id', m.id).eq('status', m.status).patch({
                status: 'blocked',
                metadata_json: { ...meta, sanction_id: sanctionId, sanction_blocked_from: m.status }
            }, { returning: false });
        }
        const blocked = await pgrest('artist_wallet_movements').select('id,status,metadata_json')
            .eq('artist_user_id', userId).eq('status', 'blocked').eq('metadata_json->>sanction_id', sanctionId)
            .limit(500).execute();
        return (blocked || []).map((m) => ({ id: m.id, status: (m.metadata_json && m.metadata_json.sanction_blocked_from) || 'processing' }));
    },

    async unblockWalletMovements(records, sanctionId) {
        let restored = 0;
        for (const r of records || []) {
            if (!isUuid(r && r.id)) continue;
            const current = await pgrest('artist_wallet_movements').select('id,status,metadata_json').eq('id', r.id).limit(1).single().execute();
            if (!current || current.status !== 'blocked') continue;
            const meta = { ...(current.metadata_json || {}) };
            if (meta.sanction_id && meta.sanction_id !== sanctionId) continue;
            delete meta.sanction_id;
            delete meta.sanction_blocked_from;
            const rows = await pgrest('artist_wallet_movements').select('id').eq('id', r.id).eq('status', 'blocked')
                .patch({ status: r.status || 'processing', metadata_json: meta });
            restored += (rows || []).length;
        }
        return restored;
    },

    // Pedidos de la Store cobrados y no liberados del usuario (como artista)
    // o de sus estudios → funds_hold = true. Devuelve los ids retenidos por
    // ESTA sanción (marcados en metadata_json.sanction_hold).
    async holdStoreOrders(userId, studioIds, sanctionId) {
        const conditions = [];
        if (isUuid(userId)) conditions.push({ col: 'seller_id', op: 'eq', val: userId });
        for (const id of (studioIds || []).filter(isUuid)) conditions.push({ col: 'seller_id', op: 'eq', val: id });
        if (!conditions.length) return [];
        const rows = await pgrest('store_orders').select('id,seller_type,seller_id,funds_hold,metadata_json')
            .eq('status', 'paid').is('funds_released_at', 'null').or(conditions).limit(500).execute();
        const studios = new Set((studioIds || []).filter(isUuid));
        const mine = (rows || []).filter((o) => (o.seller_type === 'artist' && o.seller_id === userId)
            || (o.seller_type === 'studio' && studios.has(o.seller_id)));
        const out = [];
        for (const o of mine) {
            const meta = o.metadata_json && typeof o.metadata_json === 'object' ? o.metadata_json : {};
            if (o.funds_hold === true && meta.sanction_hold !== sanctionId) continue; // ya retenido por otra razón
            if (o.funds_hold !== true || meta.sanction_hold !== sanctionId) {
                await pgrest('store_orders').eq('id', o.id).patch({ funds_hold: true, metadata_json: { ...meta, sanction_hold: sanctionId } }, { returning: false });
            }
            out.push(o.id);
        }
        return out;
    },

    async releaseStoreOrders(ids, sanctionId) {
        let released = 0;
        for (const id of (ids || []).filter(isUuid)) {
            const o = await pgrest('store_orders').select('id,funds_hold,metadata_json').eq('id', id).limit(1).single().execute();
            if (!o || !o.metadata_json || o.metadata_json.sanction_hold !== sanctionId) continue;
            const meta = { ...o.metadata_json };
            delete meta.sanction_hold;
            await pgrest('store_orders').eq('id', id).patch({ funds_hold: false, metadata_json: meta }, { returning: false });
            released += 1;
        }
        return released;
    },

    // ---- alertas de seguridad -------------------------------------------------------------

    async createAlert(row) {
        return single(await pgrest('security_alerts').select(ALERT_SELECT).insert(row));
    },

    getAlert(id) {
        if (!isUuid(id)) return Promise.resolve(null);
        return pgrest('security_alerts').select(ALERT_SELECT).eq('id', id).limit(1).single().execute();
    },

    async listAlerts({ status = 'open', kind = 'all' } = {}) {
        let q = pgrest('security_alerts').select(ALERT_SELECT);
        if (status && status !== 'all') q = q.eq('status', status);
        if (kind && kind !== 'all') q = q.eq('kind', kind);
        const rows = await q.order('created_at', { ascending: false }).limit(LIST_LIMIT).execute();
        return Array.isArray(rows) ? rows : [];
    },

    async countOpenAlerts() {
        const rows = await pgrest('security_alerts').select('id').eq('status', 'open').limit(500).execute();
        return Array.isArray(rows) ? rows.length : 0;
    },

    // Alertas de un tipo ligadas a una sanción (payload.sanction_id).
    async listAlertsForSanction(kind, sanctionId) {
        if (!isUuid(sanctionId)) return [];
        const rows = await pgrest('security_alerts').select(ALERT_SELECT)
            .eq('kind', kind).eq('payload->>sanction_id', sanctionId).limit(200).execute();
        return Array.isArray(rows) ? rows : [];
    },

    // Alerta abierta reciente con la misma huella (evita repetirla en cada login).
    async findRecentOpenAlert({ kind, subjectUserId = null, fingerprint = null, sinceIso }) {
        let q = pgrest('security_alerts').select(ALERT_SELECT).eq('kind', kind).eq('status', 'open').gte('created_at', sinceIso);
        if (subjectUserId) q = q.eq('subject_user_id', subjectUserId);
        else if (fingerprint) q = q.eq('payload->>fingerprint', fingerprint);
        else return null;
        return single(await q.order('created_at', { ascending: false }).limit(1).execute());
    },

    async updateAlert(id, patch, { expectStatus = null } = {}) {
        if (!isUuid(id)) return null;
        let q = pgrest('security_alerts').select(ALERT_SELECT).eq('id', id);
        if (expectStatus) q = q.eq('status', expectStatus);
        return single(await q.patch(patch));
    },

    // ---- buscador del formulario de soporte -------------------------------------------------

    // Busca cuentas por correo, usuario o nombre en los tres perfiles.
    // [{ user_id, role, name, username, email }]
    async searchAccounts(term) {
        const q = String(term || '').trim();
        if (q.length < 3) return [];
        const like = ilikeTerm(q);
        const [artists, clients, studios] = await Promise.all([
            pgrest('artists_db').select('user_id,name,username,email')
                .or([{ col: 'username', op: 'ilike', val: like }, { col: 'name', op: 'ilike', val: like }, { col: 'email', op: 'ilike', val: like }])
                .limit(SEARCH_LIMIT).execute().catch(() => []),
            pgrest('clients_db').select('user_id,full_name,public_username,email')
                .or([{ col: 'email', op: 'ilike', val: like }, { col: 'full_name', op: 'ilike', val: like }, { col: 'public_username', op: 'ilike', val: like }])
                .limit(SEARCH_LIMIT).execute().catch(() => []),
            pgrest('studios').select('user_id,name,slug,email')
                .or([{ col: 'name', op: 'ilike', val: like }, { col: 'slug', op: 'ilike', val: like }, { col: 'email', op: 'ilike', val: like }])
                .limit(SEARCH_LIMIT).execute().catch(() => [])
        ]);
        const out = [];
        const seen = new Set();
        const push = (row, role, name, username) => {
            if (!row || !isUuid(row.user_id)) return;
            const key = `${row.user_id}:${role}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ user_id: row.user_id, role, name: S.cleanLine(name, 120), username: S.cleanLine(username, 80), email: S.cleanLine(row.email, 200).toLowerCase() });
        };
        (artists || []).forEach((r) => push(r, 'artist', r.name, r.username));
        (studios || []).forEach((r) => push(r, 'studio', r.name, r.slug));
        (clients || []).forEach((r) => push(r, 'client', r.full_name, r.public_username));
        return out.slice(0, SEARCH_LIMIT * 2);
    },

    // Perfiles de una cuenta para el detalle de la sanción.
    async accountProfiles(userId) {
        if (!isUuid(userId)) return { artist: null, client: null, studios: [] };
        const [artist, client, studios] = await Promise.all([
            this.getArtistByUserId(userId).catch(() => null),
            this.getClientByUserId(userId).catch(() => null),
            this.listOwnedStudios(userId).catch(() => [])
        ]);
        return { artist, client, studios };
    }
};

module.exports = { SancionesRepo, isMissingSchemaError, pgErrorCode, pgErrorMessage };
