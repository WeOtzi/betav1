'use strict';

// ===========================================================================
// Repositorio de huellas de imágenes (servidor) — capa PostgREST, service-role.
// ---------------------------------------------------------------------------
// Tablas y RPC de la migración 20261118140000_image_fingerprints.sql:
// image_fingerprints, image_fingerprint_queue, design_search_log,
// search_image_fingerprints, image_fp_candidates, image_fp_storage_created_at
// e image_fp_record_alert (todas solo service_role).
//
// Lo usan lib/image-fingerprint-job.js (cola, huellas, alertas; reabre las
// alertas «Retirar» de security_alerts si la imagen vuelve) y
// lib/routes/disenos.js (buscador: searchSimilar, logSearch,
// countSearchesLast24h; soporte: markRemoved).
//
// Los hashes viajan como hex de 16 caracteres; a la base van como literal de
// bit(64) ('x<hex>').
// ===========================================================================

const { pgrest } = require('../postgrest');
const FP = require('../image-fingerprint');
const { SOURCE_KINDS } = require('../image-sources');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 5;
const FP_SELECT = 'id,source_kind,artist_id,studio_id,owner_user_id,item_key,image_url,storage_bucket,storage_path,'
    + 'sha256,phash,phash_mirror,status,is_public,first_seen_at,claimed_at,removed_at,content_version,match_checked_at';
const QUEUE_SELECT = 'source_table,owner_id,dirty_at,attempts';
const ALERT_SELECT = 'id,kind,status,subject_user_id,related_user_id,payload,resolution,handled_by,handled_at,created_at';
const UPSERT_COLUMNS = ['source_kind', 'artist_id', 'studio_id', 'owner_user_id', 'item_key', 'image_url',
    'storage_bucket', 'storage_path', 'sha256', 'phash', 'phash_mirror', 'dhash', 'width', 'height', 'status',
    'is_public', 'first_seen_at', 'claimed_at', 'removed_at', 'content_version', 'match_checked_at'];
const STORAGE_CHUNK = 200;
// Espera antes de reintentar un dueño que falló: 2, 4, 8, 16… minutos (tope 30).
const BACKOFF_MAX_MIN = 30;

function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

function rows(value) {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
}

function bitOrNull(hex) {
    return hex && FP.isHash(String(hex).toLowerCase()) ? FP.hexToBitLiteral(hex) : null;
}

// bit(64) llega de PostgREST como texto de 64 ceros y unos: se pasa a hex.
function normalizeFp(row) {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row };
    if ('phash' in out) out.phash = out.phash == null ? null : FP.bitStringToHex(out.phash);
    if ('phash_mirror' in out) out.phash_mirror = out.phash_mirror == null ? null : FP.bitStringToHex(out.phash_mirror);
    return out;
}

function fpRows(value) {
    return rows(value).map(normalizeFp);
}

function backoffIso(attempts, now = new Date()) {
    const minutes = Math.min(BACKOFF_MAX_MIN, 2 ** Math.max(1, Number(attempts) || 1));
    return new Date(now.getTime() + minutes * 60000).toISOString();
}

function rpc(name, body) {
    return pgrest.raw(`rpc/${name}`, { method: 'POST', body });
}

function shortError(message) {
    return String(message || 'error').replace(/\s+/g, ' ').slice(0, 480);
}

const ImageFingerprintsRepo = {
    MAX_ATTEMPTS,

    // ---- cola -----------------------------------------------------------------

    /**
     * Hasta `limit` dueños sucios, más viejos primero (sin los que fallaron
     * MAX_ATTEMPTS veces ni los que esperan su reintento: dirty_at futuro).
     */
    async claimDirty(limit = 20, now = new Date()) {
        const out = await pgrest('image_fingerprint_queue').select(QUEUE_SELECT)
            .lt('attempts', MAX_ATTEMPTS)
            .lte('dirty_at', now.toISOString())
            .order('dirty_at', { ascending: true })
            .limit(Math.max(1, Math.min(Number(limit) || 20, 100)))
            .execute();
        return rows(out).filter((r) => isUuid(r.owner_id));
    },

    /**
     * Borra el dueño de la cola solo si no se volvió a marcar mientras se
     * procesaba (dirty_at igual al leído).
     */
    async ackDirty(entry) {
        if (!entry || !isUuid(entry.owner_id)) return;
        await pgrest('image_fingerprint_queue')
            .eq('source_table', entry.source_table).eq('owner_id', entry.owner_id).eq('dirty_at', entry.dirty_at)
            .delete();
    },

    /**
     * Deja al dueño en la cola con un intento más y lo reprograma con espera
     * (dirty_at futuro). Si se volvió a marcar mientras se procesaba, gana la
     * marca nueva (no coincide dirty_at).
     */
    async failDirty(entry, message, now = new Date()) {
        if (!entry || !isUuid(entry.owner_id)) return;
        const attempts = (Number(entry.attempts) || 0) + 1;
        await pgrest('image_fingerprint_queue')
            .eq('source_table', entry.source_table).eq('owner_id', entry.owner_id).eq('dirty_at', entry.dirty_at)
            .patch({ attempts, last_error: shortError(message), dirty_at: backoffIso(attempts, now) }, { returning: false });
    },

    /** Marca dueños como sucios (carga inicial). entries: [{ source_table, owner_id }] */
    async enqueueOwners(entries) {
        const list = rows(entries).filter((e) => e && isUuid(e.owner_id)
            && ['artists_db', 'studios', 'store_products'].includes(e.source_table));
        if (!list.length) return 0;
        const now = new Date().toISOString();
        const body = list.map((e) => ({ source_table: e.source_table, owner_id: e.owner_id, dirty_at: now, attempts: 0, last_error: null }));
        await pgrest('image_fingerprint_queue').upsert(body, { onConflict: 'source_table,owner_id', returning: false });
        return body.length;
    },

    async countQueue() {
        const out = await pgrest('image_fingerprint_queue').select('owner_id').lt('attempts', MAX_ATTEMPTS).count().limit(1).execute();
        return Number(out && out.count) || 0;
    },

    /** Dueños con imágenes (carga inicial). */
    async listOwnersWithImages() {
        const [artists, studios, products] = await Promise.all([
            pgrest('artists_db').select('user_id,gallery_feed_items').limit(5000).execute(),
            pgrest('studios').select('id,photo_feed_items').limit(5000).execute(),
            pgrest('store_products').select('seller_id').limit(10000).execute()
        ]);
        const out = [];
        for (const a of rows(artists)) {
            if (isUuid(a.user_id) && Array.isArray(a.gallery_feed_items) && a.gallery_feed_items.length) out.push({ source_table: 'artists_db', owner_id: a.user_id });
        }
        for (const s of rows(studios)) {
            if (isUuid(s.id) && Array.isArray(s.photo_feed_items) && s.photo_feed_items.length) out.push({ source_table: 'studios', owner_id: s.id });
        }
        const sellers = new Set(rows(products).map((p) => p.seller_id).filter(isUuid));
        for (const id of sellers) out.push({ source_table: 'store_products', owner_id: id });
        return out;
    },

    // ---- dueños -----------------------------------------------------------------

    loadArtist(userId) {
        if (!isUuid(userId)) return Promise.resolve(null);
        return pgrest('artists_db')
            .select('id,user_id,studio_id,gallery_feed_items,registration_status,sanction_state,instagram_verified_at,instagram_verified_handle')
            .eq('user_id', userId).limit(1).single().execute();
    },

    loadStudio(studioId) {
        if (!isUuid(studioId)) return Promise.resolve(null);
        return pgrest('studios').select('id,user_id,photo_feed_items,is_active,sanction_state')
            .eq('id', studioId).limit(1).single().execute();
    },

    /** Productos y archivos de diseño de un vendedor (artista o estudio). */
    async loadStoreSeller(sellerId) {
        if (!isUuid(sellerId)) return null;
        const products = rows(await pgrest('store_products').select('id,seller_type,seller_id,status,kind,images')
            .eq('seller_id', sellerId).limit(500).execute());
        if (!products.length) return { sellerType: null, sellerId, ownerUserId: null, sellerPublic: false, products: [], assets: [] };
        const sellerType = products[0].seller_type;
        const ids = products.map((p) => p.id).filter(isUuid);
        const assets = ids.length
            ? rows(await pgrest('store_design_assets').select('id,product_id,kind,storage_path,mime_type,created_at')
                .in('product_id', ids).limit(2000).execute())
            : [];
        let ownerUserId = sellerType === 'artist' ? sellerId : null;
        let sellerPublic = true;
        if (sellerType === 'studio') {
            const studio = await this.loadStudio(sellerId);
            ownerUserId = studio && studio.user_id ? studio.user_id : null;
            sellerPublic = Boolean(studio) && studio.is_active !== false && (studio.sanction_state || 'none') === 'none';
        } else {
            const artist = await this.loadArtist(sellerId);
            sellerPublic = Boolean(artist) && String(artist.registration_status || '').toLowerCase() !== 'incompleto'
                && (artist.sanction_state || 'none') === 'none';
        }
        return { sellerType, sellerId, ownerUserId, sellerPublic, products, assets };
    },

    /** ¿El artista trabaja en ese estudio? (artists_db.studio_id o membresía activa) */
    async isAllowedArtistStudio(artistUserId, studioId) {
        if (!isUuid(artistUserId) || !isUuid(studioId)) return false;
        const direct = await pgrest('artists_db').select('user_id').eq('user_id', artistUserId).eq('studio_id', studioId)
            .limit(1).execute();
        if (rows(direct).length) return true;
        const member = await pgrest('studio_artist_memberships').select('id')
            .eq('studio_id', studioId).eq('artist_user_id', artistUserId).eq('status', 'active').limit(1).execute();
        return rows(member).length > 0;
    },

    async activeSupportEmails() {
        const out = await pgrest('support_users_db').select('email').eq('is_active', true).limit(20).execute();
        return rows(out).map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean);
    },

    // ---- huellas ----------------------------------------------------------------

    async listByOwner(ownerId, sourceKinds = SOURCE_KINDS) {
        if (!isUuid(ownerId)) return [];
        const kinds = rows(sourceKinds).filter((k) => SOURCE_KINDS.includes(k));
        if (!kinds.length) return [];
        const out = await pgrest('image_fingerprints').select(FP_SELECT)
            .or([{ col: 'artist_id', op: 'eq', val: ownerId }, { col: 'studio_id', op: 'eq', val: ownerId }])
            .in('source_kind', kinds)
            .limit(2000)
            .execute();
        return fpRows(out);
    },

    /** Inserta o reemplaza huellas por (source_kind, item_key). Devuelve las filas con id. */
    async upsertFingerprints(list) {
        const body = rows(list).map((r) => {
            const row = {};
            for (const col of UPSERT_COLUMNS) row[col] = r[col] === undefined ? null : r[col];
            row.phash = bitOrNull(r.phash);
            row.phash_mirror = bitOrNull(r.phash_mirror);
            row.dhash = bitOrNull(r.dhash);
            row.is_public = Boolean(r.is_public);
            if (!row.status) row.status = 'ok';
            if (!row.first_seen_at) delete row.first_seen_at;
            return row;
        });
        if (!body.length) return [];
        // Columnas uniformes en un insert masivo de PostgREST.
        const withDate = body.filter((r) => 'first_seen_at' in r);
        const withoutDate = body.filter((r) => !('first_seen_at' in r));
        const out = [];
        if (withDate.length) out.push(...fpRows(await pgrest('image_fingerprints').select(FP_SELECT).upsert(withDate, { onConflict: 'source_kind,item_key' })));
        if (withoutDate.length) out.push(...fpRows(await pgrest('image_fingerprints').select(FP_SELECT).upsert(withoutDate, { onConflict: 'source_kind,item_key' })));
        return out;
    },

    async patchFingerprint(id, patch) {
        if (!isUuid(id)) return null;
        const out = await pgrest('image_fingerprints').select(FP_SELECT).eq('id', id).patch(patch);
        return fpRows(out)[0] || null;
    },

    /** La búsqueda de copias de estas huellas terminó sin errores. */
    async markMatchChecked(ids, atIso = new Date().toISOString()) {
        const list = rows(ids).filter(isUuid);
        if (!list.length) return 0;
        await pgrest('image_fingerprints').in('id', list)
            .patch({ match_checked_at: atIso }, { returning: false });
        return list.length;
    },

    async markRemovedIds(ids, atIso = new Date().toISOString()) {
        const list = rows(ids).filter(isUuid);
        if (!list.length) return 0;
        await pgrest('image_fingerprints').in('id', list).is('removed_at', null)
            .patch({ removed_at: atIso }, { returning: false });
        return list.length;
    },

    /** Marca borrada la huella de un ítem (lo usa soporte al retirar). */
    async markRemoved(sourceKind, ownerId, itemKey) {
        if (!SOURCE_KINDS.includes(sourceKind) || !isUuid(ownerId) || !itemKey) return null;
        const out = await pgrest('image_fingerprints').select(FP_SELECT)
            .eq('source_kind', sourceKind).eq('item_key', String(itemKey))
            .or([{ col: 'artist_id', op: 'eq', val: ownerId }, { col: 'studio_id', op: 'eq', val: ownerId }])
            .is('removed_at', null)
            .patch({ removed_at: new Date().toISOString() });
        return fpRows(out)[0] || null;
    },

    /**
     * Datos de Storage de varias rutas de un bucket →
     * Map(path → { created_at, updated_at, version }). Las rutas sin objeto no
     * aparecen. Lanza si la RPC falla (el trabajo reintenta al dueño).
     */
    async storageObjects(bucket, paths) {
        const list = [...new Set(rows(paths).filter((p) => typeof p === 'string' && p))];
        const map = new Map();
        if (!bucket || !list.length) return map;
        for (let i = 0; i < list.length; i += STORAGE_CHUNK) {
            const out = await rpc('image_fp_storage_created_at', { p_bucket: bucket, p_paths: list.slice(i, i + STORAGE_CHUNK) });
            for (const r of rows(out)) {
                if (!r || !r.path || !r.created_at) continue;
                map.set(r.path, { created_at: r.created_at, updated_at: r.updated_at || null, version: r.version || null });
            }
        }
        return map;
    },

    /** Coincidencias de otros dueños (también no públicas y borradas). */
    async findCandidates({ phash, phashMirror, threshold = FP.MATCH_THRESHOLD, excludeOwner = null }) {
        if (!FP.isHash(String(phash || '').toLowerCase())) return [];
        const out = await rpc('image_fp_candidates', {
            p_phash: FP.hexToBitLiteral(phash),
            p_phash_mirror: bitOrNull(phashMirror) || FP.hexToBitLiteral(phash),
            p_threshold: threshold,
            p_exclude_owner: isUuid(excludeOwner) ? excludeOwner : null
        });
        return rows(out);
    },

    /** Buscador: huellas públicas de perfiles visibles y sin sanción. */
    async searchSimilar({ phash, phashMirror, max = 12, threshold = FP.SEARCH_THRESHOLD }) {
        if (!FP.isHash(String(phash || '').toLowerCase())) return [];
        const out = await rpc('search_image_fingerprints', {
            p_phash: FP.hexToBitLiteral(phash),
            p_phash_mirror: bitOrNull(phashMirror) || FP.hexToBitLiteral(phash),
            p_max: max,
            p_threshold: threshold
        });
        return rows(out).map((r) => ({
            id: r.id,
            source_kind: r.source_kind,
            artist_id: r.artist_id || null,
            studio_id: r.studio_id || null,
            owner_user_id: r.owner_user_id || null,
            item_key: r.item_key,
            image_url: r.image_url || null,
            first_seen_at: r.first_seen_at,
            distance: Number(r.distance)
        }));
    },

    async logSearch(userId, resultCount) {
        if (!isUuid(userId)) return null;
        const count = Math.max(0, Math.min(100, Number(resultCount) || 0));
        await pgrest('design_search_log').insert({ user_id: userId, result_count: count }, { returning: false });
        return true;
    },

    async countSearchesLast24h(userId, now = new Date()) {
        if (!isUuid(userId)) return 0;
        const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const out = await pgrest('design_search_log').select('id').eq('user_id', userId).gte('created_at', since)
            .count().limit(1).execute();
        return Number(out && out.count) || 0;
    },

    // ---- alertas ----------------------------------------------------------------

    /**
     * Alertas image_duplicate que soporte cerró con «Retirar» (status handled y
     * payload.removal) cuya imagen nueva es alguna de estas huellas.
     */
    async findRemovalAlerts(fpIds) {
        const list = [...new Set(rows(fpIds).filter(isUuid))];
        if (!list.length) return [];
        const out = await pgrest('security_alerts').select(ALERT_SELECT)
            .eq('kind', 'image_duplicate').eq('status', 'handled')
            .in('payload->new->>fp_id', list)
            .limit(200)
            .execute();
        return rows(out).filter((a) => a && a.payload && a.payload.removal && typeof a.payload.removal === 'object');
    },

    /**
     * Reabre una alerta retirada cuya imagen volvió a publicarse. Condicional
     * (solo si sigue 'handled'): null si otro agente la cambió antes.
     */
    async reopenRemovalAlert(id, payload) {
        if (!isUuid(id)) return null;
        const out = await pgrest('security_alerts').select(ALERT_SELECT)
            .eq('id', id).eq('status', 'handled')
            .patch({ status: 'open', payload, handled_by: null, handled_at: null });
        return rows(out)[0] || null;
    },

    /** Alerta image_duplicate de un par. null si el par ya tenía alerta. */
    async recordAlert({ subject_user_id = null, related_user_id = null, payload }) {
        const out = await rpc('image_fp_record_alert', {
            p_subject_user_id: isUuid(subject_user_id) ? subject_user_id : null,
            p_related_user_id: isUuid(related_user_id) ? related_user_id : null,
            p_payload: payload
        });
        return rows(out)[0] || null;
    }
};

module.exports = { ImageFingerprintsRepo, MAX_ATTEMPTS, _internal: { normalizeFp, backoffIso } };
