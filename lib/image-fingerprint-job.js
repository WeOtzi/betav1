'use strict';

// ===========================================================================
// Trabajo de huellas de imágenes (fase 2 · plan §2.1–2.2).
// ---------------------------------------------------------------------------
// Cada minuto toma hasta 20 dueños de image_fingerprint_queue (los marcan los
// triggers private.image_fp_mark_dirty) y reconcilia sus imágenes:
//   1. lee los ítems actuales (artists_db, studios o la tienda del vendedor);
//   2. calcula la huella de las claves nuevas, de las que fallaron al
//      descargarse y de las que cambiaron de imagen sin cambiar de clave (URL
//      distinta o archivo de Storage pisado: content_version);
//   3. marca removed_at en las claves que ya no están (la fila queda como
//      prueba de antigüedad) y actualiza is_public si cambió. Si vuelve una
//      clave que soporte retiró con «Retirar» (alerta image_duplicate
//      'handled' con payload.removal), reabre esa alerta (payload.reappeared_at)
//      y avisa a soporte una sola vez antes de limpiar removed_at;
//   4. por cada huella 'ok' sin match_checked_at (nueva o pendiente de un
//      ciclo anterior), busca coincidencias de OTROS dueños (Hamming ≤
//      MATCH_THRESHOLD, espejo incluido). Salvo el par permitido artista ↔ su
//      estudio, crea UNA alerta security_alerts 'image_duplicate' por par y
//      avisa a soporte por correo (support_security_alert).
//   5. si algo quedó a medias (descarga fallida, fila sin guardar, búsqueda
//      con error), el dueño sigue en la cola con espera creciente hasta
//      MAX_ATTEMPTS; si no, sale de la cola.
//
// Decisión del dueño (2026-11-18): las coincidencias SOLO avisan a soporte.
// Este trabajo nunca oculta, retiene ni modifica el ítem de nadie.
//
// Descargas (SSRF): solo ${SUPABASE_URL}/storage/v1/object/public/
// {artist-gallery|studio-photos|store-previews}/… y URLs firmadas de
// store-design-files (lib/storage-sign.js). 15 s y 10 MB por imagen.
//
// Arranque: startImageFingerprintJob() lo llama lib/routes/disenos.js
// (register(app, { startJob })). IMAGE_FP_JOB=off lo apaga. Sin `sharp`
// instalado queda apagado con un solo aviso.
// ===========================================================================

const FP = require('./image-fingerprint');
const Sources = require('./image-sources');

const BATCH_OWNERS = 20;
const MAX_ALERTS_PER_IMAGE = 5;
const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 10 * 1024 * 1024;
const SIGN_EXPIRES_S = 120;
const SUPPORT_EVENT = 'support_security_alert';
const MAX_STORAGE_PATH = 1024;
const MAX_VERSION = 300;
const SHA_RE = /^[0-9a-f]{64}$/;

const SOURCE_LABELS = {
    artist_gallery: 'Galería del artista',
    flash: 'Flash del artista',
    studio_feed: 'Fotos del estudio',
    store_preview: 'Tienda (vista previa)',
    store_design: 'Tienda (archivo de diseño)'
};
const CONFIDENCE_LABELS = { casi_segura: 'casi segura', posible: 'posible' };

// Texto corto y sin datos para logs y queue.last_error. De un error de
// PostgREST solo queda el estado y el código SQL: el cuerpo puede traer la fila
// rechazada («Failing row contains (…)») con URLs e ids.
function short(err) {
    if (!err) return 'error';
    if (err.status) {
        const m = /"code"\s*:\s*"([0-9A-Z]{5})"/.exec(String(err.message || ''));
        return `postgrest_${Number(err.status) || 0}${m ? `:${m[1]}` : ''}`;
    }
    if (err.code) return String(err.code).replace(/\s+/g, ' ').slice(0, 60);
    const message = String(err.message || err);
    if (/postgrest|failing row/i.test(message)) return 'postgrest_error';
    return message.replace(/\s+/g, ' ').slice(0, 200);
}

function fetchError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/**
 * Descarga una imagen permitida (host y bucket en la lista blanca), con
 * tiempo máximo y tope de tamaño. Sin redirecciones.
 */
async function fetchImageBytes(url, { supabaseUrl, fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
    if (!Sources.isAllowedFetchUrl(url, supabaseUrl)) throw fetchError('FETCH_NOT_ALLOWED', 'URL fuera de la lista permitida');
    if (typeof fetchImpl !== 'function') throw fetchError('FETCH_UNAVAILABLE', 'fetch no disponible');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let res;
        try {
            res = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal });
        } catch (err) {
            throw fetchError(err && err.name === 'AbortError' ? 'FETCH_TIMEOUT' : 'FETCH_FAILED', 'no se pudo descargar');
        }
        if (!res || !res.ok) throw fetchError('FETCH_FAILED', `respuesta ${res ? res.status : 'vacía'}`);
        const declared = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0);
        if (declared && declared > maxBytes) throw fetchError('FETCH_TOO_LARGE', 'imagen de más de 10 MB');
        if (res.body && typeof res.body.getReader === 'function') {
            const reader = res.body.getReader();
            const chunks = [];
            let total = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > maxBytes) {
                    try { await reader.cancel(); } catch (_) { /* nada */ }
                    throw fetchError('FETCH_TOO_LARGE', 'imagen de más de 10 MB');
                }
                chunks.push(Buffer.from(value));
            }
            return Buffer.concat(chunks, total);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > maxBytes) throw fetchError('FETCH_TOO_LARGE', 'imagen de más de 10 MB');
        return buf;
    } finally {
        clearTimeout(timer);
    }
}

function defaultDeps() {
    return {
        repo: require('./repos/image-fingerprints').ImageFingerprintsRepo,
        decoder: require('./image-decode'),
        signUrl: (bucket, path) => require('./storage-sign').signStorageObject(bucket, path, { expiresIn: SIGN_EXPIRES_S }),
        sendEmail: (...args) => require('../services/email-service').sendEmail(...args),
        fetchImpl: globalThis.fetch,
        supabaseUrl: () => process.env.SUPABASE_URL || '',
        baseUrl: () => require('./email-format').publicBaseUrl(),
        env: () => process.env,
        now: () => new Date(),
        log: console
    };
}

function resolveDeps(deps) {
    const d = { ...defaultDeps(), ...(deps || {}) };
    if (typeof d.supabaseUrl !== 'function') {
        const value = d.supabaseUrl;
        d.supabaseUrl = () => value || '';
    }
    return d;
}

// ---- dueños -------------------------------------------------------------------

async function loadOwner(d, entry) {
    const supabaseUrl = d.supabaseUrl();
    const ownerId = entry.owner_id;
    if (entry.source_table === 'artists_db') {
        const row = await d.repo.loadArtist(ownerId);
        return { sourceKinds: Sources.SOURCE_KINDS_BY_TABLE.artists_db, sources: row ? Sources.artistSources(row, { supabaseUrl }) : [] };
    }
    if (entry.source_table === 'studios') {
        const row = await d.repo.loadStudio(ownerId);
        return { sourceKinds: Sources.SOURCE_KINDS_BY_TABLE.studios, sources: row ? Sources.studioSources(row, { supabaseUrl }) : [] };
    }
    if (entry.source_table === 'store_products') {
        const store = await d.repo.loadStoreSeller(ownerId);
        return {
            sourceKinds: Sources.SOURCE_KINDS_BY_TABLE.store_products,
            sources: store && store.sellerType ? Sources.storeSources(store, { supabaseUrl }) : []
        };
    }
    throw new Error(`source_table desconocida: ${String(entry.source_table).slice(0, 40)}`);
}

async function downloadSource(d, source) {
    if (source.storage_bucket === Sources.DESIGN_BUCKET) {
        const signed = await d.signUrl(source.storage_bucket, source.storage_path);
        return fetchImageBytes(signed, { supabaseUrl: d.supabaseUrl(), fetchImpl: d.fetchImpl });
    }
    return fetchImageBytes(source.url, { supabaseUrl: d.supabaseUrl(), fetchImpl: d.fetchImpl });
}

function baseRow(source) {
    return {
        source_kind: source.source_kind,
        artist_id: source.artist_id,
        studio_id: source.studio_id,
        owner_user_id: source.owner_user_id,
        item_key: source.item_key,
        image_url: source.image_url !== undefined ? source.image_url : Sources.storableUrl(source.url),
        storage_bucket: source.storage_bucket,
        storage_path: source.storage_path,
        sha256: null,
        phash: null,
        phash_mirror: null,
        dhash: null,
        width: null,
        height: null,
        status: 'ok',
        is_public: Boolean(source.is_public),
        claimed_at: source.claimed_at,
        removed_at: null,
        content_version: null,
        match_checked_at: null
    };
}

async function fingerprintSource(d, source) {
    const row = baseRow(source);
    if (source.skip_reason) return { ...row, status: 'skipped_external' };
    let bytes;
    try {
        bytes = await downloadSource(d, source);
    } catch (err) {
        return { ...row, status: 'fetch_failed', _error: short(err) };
    }
    try {
        const fp = await d.decoder.fingerprintBuffer(bytes);
        return {
            ...row,
            sha256: fp.sha256,
            phash: fp.phash,
            phash_mirror: fp.phash_mirror,
            dhash: fp.dhash,
            width: fp.width || null,
            height: fp.height || null
        };
    } catch (err) {
        if (err && err.code === 'DECODER_UNAVAILABLE') throw err;
        return { ...row, status: 'decode_failed', _error: short(err) };
    }
}

/**
 * Ajusta la fila a los CHECK de la tabla antes de guardarla, para que una
 * fila rara no rechace el lote entero del dueño. false = no se puede guardar.
 */
function fitsColumns(row) {
    if (!row.item_key || row.item_key.length > Sources.MAX_KEY) return false;
    if (row.image_url && row.image_url.length > Sources.MAX_URL) row.image_url = null;
    if (!row.storage_bucket || !row.storage_path || row.storage_path.length > MAX_STORAGE_PATH) {
        row.storage_bucket = null;
        row.storage_path = null;
    }
    if (row.content_version && row.content_version.length > MAX_VERSION) row.content_version = row.content_version.slice(0, MAX_VERSION);
    if (!(Number(row.width) > 0)) row.width = null;
    if (!(Number(row.height) > 0)) row.height = null;
    if (row.status === 'ok') {
        const hashesOk = SHA_RE.test(String(row.sha256 || ''))
            && FP.isHash(String(row.phash || '')) && FP.isHash(String(row.phash_mirror || '')) && FP.isHash(String(row.dhash || ''));
        if (!hashesOk) Object.assign(row, { status: 'decode_failed', sha256: null, phash: null, phash_mirror: null, dhash: null });
    }
    return true;
}

// ---- Storage: fechas y versión del contenido -----------------------------------------

function objectKey(bucket, path) {
    return `${bucket}/${path}`;
}

/**
 * Map('<bucket>/<path>' → { created_at, updated_at, version }) de las fuentes
 * que se descargan de Storage. Si la RPC falla, lanza: el dueño se reintenta
 * (sin la fecha de Storage, first_seen_at quedaría mal).
 */
async function loadStorageObjects(d, sources) {
    const byBucket = new Map();
    for (const s of sources) {
        if (s.skip_reason || !s.storage_bucket || !s.storage_path) continue;
        if (!byBucket.has(s.storage_bucket)) byBucket.set(s.storage_bucket, []);
        byBucket.get(s.storage_bucket).push(s.storage_path);
    }
    const found = new Map();
    for (const [bucket, paths] of byBucket) {
        const map = await d.repo.storageObjects(bucket, paths);
        for (const [path, obj] of map || []) found.set(objectKey(bucket, path), obj);
    }
    return found;
}

function objectFor(objects, source) {
    if (source.skip_reason || !source.storage_bucket || !source.storage_path) return null;
    return objects.get(objectKey(source.storage_bucket, source.storage_path)) || null;
}

function objectIdOf(version) {
    return String(version || '').split('|')[0];
}

/**
 * ¿Hay que (re)calcular la huella? La clave no siempre cambia con la imagen:
 * un flash conserva su id aunque cambie la URL, y un archivo de Storage se
 * puede pisar o borrar y volver a subir en la misma ruta.
 */
function needsFingerprint(row, source, obj) {
    if (!row) return 'new';
    if (row.status === 'fetch_failed') return 'retry';
    const url = source.image_url !== undefined ? source.image_url : Sources.storableUrl(source.url);
    if ((row.image_url || null) !== (url || null)) return 'url_changed';
    if (obj && obj.version && obj.version !== (row.content_version || null)) return 'content_changed';
    return null;
}

/**
 * first_seen_at de una huella (re)calculada:
 *   - objeto de Storage pisado en la misma ruta (mismo id): updated_at;
 *   - objeto de Storage nuevo: created_at (lo fija Storage, no el cliente);
 *   - reintento de una descarga fallida sin dato de Storage: la fecha que ya tenía;
 *   - lo demás: ahora.
 */
function firstSeenFor({ reason, previous, obj }, nowIso) {
    if (obj && obj.created_at) {
        if (reason === 'content_changed' && previous && objectIdOf(previous.content_version) === objectIdOf(obj.version)) {
            return obj.updated_at || obj.created_at;
        }
        return obj.created_at;
    }
    if (reason === 'retry' && previous && previous.first_seen_at) return previous.first_seen_at;
    return nowIso;
}

/**
 * Guarda en bloque; si el bloque falla, de a una fila, para que una fila mala
 * no deje sin huellas al resto del dueño. Lanza solo si no se guardó ninguna.
 */
async function saveRows(d, rows) {
    try {
        return { saved: (await d.repo.upsertFingerprints(rows)) || [], failed: 0 };
    } catch (err) {
        if (rows.length === 1) throw err;
        d.log.warn('[huellas] guardado en bloque falló; se reintenta de a una:', short(err));
    }
    const saved = [];
    let failed = 0;
    let lastErr = null;
    for (const row of rows) {
        try {
            saved.push(...((await d.repo.upsertFingerprints([row])) || []));
        } catch (err) {
            failed += 1;
            lastErr = err;
            d.log.warn(`[huellas] no se pudo guardar una huella de ${row.source_kind}:`, short(err));
        }
    }
    if (!saved.length && lastErr) throw lastErr;
    return { saved, failed };
}

// ---- coincidencias ------------------------------------------------------------------

function ownerOf(fp) {
    if (fp.studio_id && !fp.artist_id) return { kind: 'studio', id: fp.studio_id };
    return { kind: 'artist', id: fp.artist_id };
}

function describe(fp) {
    const owner = ownerOf(fp);
    return {
        fp_id: fp.id,
        source_kind: fp.source_kind,
        item_key: fp.item_key,
        image_url: fp.image_url || null,
        owner_kind: owner.kind,
        owner_id: owner.id,
        first_seen_at: fp.first_seen_at
    };
}

function sameOwner(a, b) {
    if (a.owner_user_id && b.owner_user_id && a.owner_user_id === b.owner_user_id) return true;
    const oa = ownerOf(a);
    const ob = ownerOf(b);
    return oa.kind === ob.kind && oa.id === ob.id;
}

// Si la consulta falla, lanza: la huella queda pendiente y se reintenta.
async function isAllowedPair(d, a, b) {
    const oa = ownerOf(a);
    const ob = ownerOf(b);
    if (oa.kind === ob.kind) return false;
    const artist = oa.kind === 'artist' ? oa.id : ob.id;
    const studio = oa.kind === 'studio' ? oa.id : ob.id;
    return Boolean(await d.repo.isAllowedArtistStudio(artist, studio));
}

function pairKey(a, b) {
    return [String(a.id), String(b.id)].sort().join(':');
}

function laterOf(fresh, other) {
    const tf = Date.parse(fresh.first_seen_at);
    const to = Date.parse(other.first_seen_at);
    // Empate o fecha rara: la imagen recién procesada es la «nueva».
    if (Number.isFinite(tf) && Number.isFinite(to) && to > tf) return { newer: other, older: fresh };
    return { newer: fresh, older: other };
}

async function supportRecipients(d) {
    const env = d.env() || {};
    const single = String(env.SUPPORT_EMAIL || '').trim();
    if (single) return { support_email: single, support_emails: [] };
    const list = d.repo.activeSupportEmails ? await d.repo.activeSupportEmails().catch(() => []) : [];
    return { support_email: '', support_emails: list };
}

function supportPayload(d, alert, to) {
    const payload = alert.payload || {};
    const newer = payload.new || {};
    const older = payload.existing || {};
    const confidence = CONFIDENCE_LABELS[payload.confidence] || '';
    const distance = Number(payload.distance);
    return {
        app_base_url: d.baseUrl(),
        ...to,
        alert_id: alert.id,
        alert_kind: 'image_duplicate',
        kind_label: 'Posible copia de imagen',
        flow_label: SOURCE_LABELS[newer.source_kind] || '',
        existing_flow_label: SOURCE_LABELS[older.source_kind] || '',
        match_kinds_label: `imagen (${confidence || 'posible'}, distancia ${Number.isFinite(distance) ? distance : '?'})`,
        confidence_label: confidence,
        distance: Number.isFinite(distance) ? String(distance) : '',
        new_owner_kind: newer.owner_kind || '',
        existing_owner_kind: older.owner_kind || '',
        subject_user_id: alert.subject_user_id || '',
        related_user_id: alert.related_user_id || '',
        created_at: alert.created_at || d.now().toISOString()
    };
}

async function notifySupport(d, alert) {
    try {
        const payload = alert.payload || {};
        const to = await supportRecipients(d);
        if (!to.support_email && !to.support_emails.length) return false;
        const result = await d.sendEmail(SUPPORT_EVENT, supportPayload(d, alert, to),
            { idempotencyKey: `image_duplicate:${payload.pair_key}`, ignorePreferences: true });
        return Boolean(result && result.ok);
    } catch (err) {
        d.log.warn('[huellas] aviso a soporte no enviado:', short(err));
        return false;
    }
}

// Una imagen retirada por soporte volvió a publicarse: un solo correo por alerta.
async function notifyReappeared(d, alert) {
    try {
        const to = await supportRecipients(d);
        if (!to.support_email && !to.support_emails.length) return false;
        const result = await d.sendEmail(SUPPORT_EVENT, { ...supportPayload(d, alert, to), reappeared: true },
            { idempotencyKey: `image_duplicate_reappeared:${alert.id}`, ignorePreferences: true });
        return Boolean(result && result.ok);
    } catch (err) {
        d.log.warn('[huellas] aviso de reaparición no enviado:', short(err));
        return false;
    }
}

/**
 * Huellas con removed_at cuya clave volvió al portafolio. Si alguna era la
 * imagen nueva de una alerta que soporte cerró con «Retirar», reabre la alerta
 * (condicional: solo si sigue 'handled') y avisa a soporte. Los errores de la
 * consulta o de la reapertura se propagan: removed_at sigue puesto y el dueño
 * se reintenta, así la reaparición no se pierde.
 */
async function reopenReappeared(d, reappeared, stats) {
    if (!reappeared.length || typeof d.repo.findRemovalAlerts !== 'function') return;
    const alerts = await d.repo.findRemovalAlerts(reappeared.map((r) => r.id));
    for (const alert of alerts || []) {
        const payload = (alert && alert.payload) || {};
        const nw = payload.new || {};
        const row = reappeared.find((r) => r.id === nw.fp_id);
        if (!row || !payload.removal) continue;
        const reopened = await d.repo.reopenRemovalAlert(alert.id, { ...payload, reappeared_at: d.now().toISOString() });
        if (!reopened) continue; // otro agente la cambió
        stats.reopened += 1;
        d.log.warn(`[huellas] alerta ${alert.id} reabierta: la imagen retirada volvió a publicarse.`);
        // Sin esperar: el correo nunca frena ni rompe el ciclo.
        notifyReappeared(d, { ...alert, ...reopened, payload: reopened.payload || { ...payload } });
    }
}

/**
 * Busca copias de una huella 'ok' y crea una alerta por par. Los errores de la
 * búsqueda, del par permitido o de la alerta se propagan: la huella queda sin
 * match_checked_at y se vuelve a revisar (el índice por pair_key evita
 * duplicar alertas y correos).
 */
async function detectMatches(d, fresh, stats) {
    const candidates = await d.repo.findCandidates({
        phash: fresh.phash,
        phashMirror: fresh.phash_mirror,
        threshold: FP.MATCH_THRESHOLD,
        excludeOwner: fresh.owner_user_id || fresh.artist_id || fresh.studio_id
    });
    let created = 0;
    for (const cand of candidates || []) {
        if (created >= MAX_ALERTS_PER_IMAGE) break;
        if (!cand || !cand.id || cand.id === fresh.id || sameOwner(fresh, cand)) continue;
        const sameSha = Boolean(fresh.sha256 && cand.sha256 && fresh.sha256 === cand.sha256);
        let distance = Number(cand.distance);
        if (!Number.isFinite(distance) && cand.phash) distance = FP.hamming(fresh.phash, cand.phash);
        const confidence = FP.confidenceFor(distance, sameSha);
        if (!confidence) continue;
        if (await isAllowedPair(d, fresh, cand)) {
            stats.allowed += 1;
            continue;
        }
        const { newer, older } = laterOf(fresh, cand);
        const payload = {
            pair_key: pairKey(fresh, cand),
            distance: sameSha ? 0 : distance,
            confidence,
            new: describe(newer),
            existing: describe(older)
        };
        const alert = await d.repo.recordAlert({
            subject_user_id: newer.owner_user_id || null,
            related_user_id: older.owner_user_id || null,
            payload
        });
        if (!alert) continue; // el par ya tenía alerta (aunque soporte la haya descartado)
        created += 1;
        stats.alerts += 1;
        // Sin esperar: el correo nunca frena ni rompe el ciclo.
        notifySupport(d, alert);
    }
}

// ---- reconciliación de un dueño ----------------------------------------------------

/**
 * Reconcilia las imágenes de un dueño. Devuelve { retry } con un motivo si el
 * dueño debe seguir en la cola (descargas fallidas o filas sin guardar); lanza
 * si algo falló del todo.
 */
async function reconcileOwner(d, entry, stats) {
    const { sourceKinds, sources } = await loadOwner(d, entry);
    const existing = await d.repo.listByOwner(entry.owner_id, sourceKinds);
    const byKey = new Map(existing.map((r) => [r.item_key, r]));
    const currentKeys = new Set(sources.map((s) => s.item_key));
    const objects = await loadStorageObjects(d, sources);
    const nowIso = d.now().toISOString();

    // Antes de limpiar removed_at: ¿volvió algo que soporte retiró?
    await reopenReappeared(d, existing.filter((r) => r.removed_at && currentKeys.has(r.item_key)), stats);

    const toFingerprint = [];
    for (const source of sources) {
        const row = byKey.get(source.item_key);
        const obj = objectFor(objects, source);
        const reason = needsFingerprint(row, source, obj);
        if (reason) {
            toFingerprint.push({ source, previous: row || null, obj, reason });
            continue;
        }
        const patch = {};
        if (row.removed_at) patch.removed_at = null;
        if (Boolean(row.is_public) !== Boolean(source.is_public)) patch.is_public = Boolean(source.is_public);
        if (Object.keys(patch).length) {
            await d.repo.patchFingerprint(row.id, patch);
            stats.updated += 1;
        }
    }

    const gone = existing.filter((r) => !currentKeys.has(r.item_key) && !r.removed_at).map((r) => r.id);
    if (gone.length) {
        await d.repo.markRemovedIds(gone, nowIso);
        stats.removed += gone.length;
    }

    let retry = null;
    const refreshedKeys = new Set(toFingerprint.map((t) => t.source.item_key));
    const fresh = [];
    if (toFingerprint.length) {
        const rows = [];
        for (const item of toFingerprint) {
            const row = await fingerprintSource(d, item.source);
            if (row._error) {
                d.log.warn(`[huellas] ${row.status} en ${item.source.source_kind}:`, row._error);
                delete row._error;
            }
            row.content_version = item.obj && item.obj.version ? item.obj.version : null;
            row.first_seen_at = firstSeenFor(item, nowIso);
            row.match_checked_at = null;
            if (!fitsColumns(row)) {
                stats.failed_items += 1;
                d.log.warn(`[huellas] ítem de ${item.source.source_kind} omitido: no entra en la tabla.`);
                continue;
            }
            rows.push(row);
        }
        if (rows.length) {
            const { saved, failed } = await saveRows(d, rows);
            const computedByKey = new Map(rows.map((r) => [r.item_key, r]));
            stats.fingerprinted += saved.filter((r) => r && r.status === 'ok').length;
            stats.failed_items += rows.filter((r) => r.status === 'fetch_failed' || r.status === 'decode_failed').length + failed;
            if (failed) retry = 'save_failed';
            else if (rows.some((r) => r.status === 'fetch_failed')) retry = 'fetch_failed';
            for (const fp of saved) {
                if (!fp) continue;
                const computed = computedByKey.get(fp.item_key) || {};
                fresh.push({
                    ...fp,
                    phash: fp.phash || computed.phash,
                    phash_mirror: fp.phash_mirror || computed.phash_mirror,
                    sha256: fp.sha256 || computed.sha256
                });
            }
        }
    }

    // Búsqueda de copias: las huellas nuevas y las que quedaron pendientes de
    // un ciclo anterior (la búsqueda falló o el proceso se reinició).
    const pending = fresh.filter((fp) => fp.status === 'ok' && !fp.match_checked_at);
    for (const row of existing) {
        if (refreshedKeys.has(row.item_key) || !currentKeys.has(row.item_key)) continue;
        if (row.status === 'ok' && !row.match_checked_at) pending.push(row);
    }
    const checked = [];
    let detectErr = null;
    for (const fp of pending) {
        if (!FP.isHash(String(fp.phash || '')) || !fp.id) continue;
        try {
            await detectMatches(d, fp, stats);
            checked.push(fp.id);
        } catch (err) {
            detectErr = err;
            break;
        }
    }
    if (checked.length) await d.repo.markMatchChecked(checked, d.now().toISOString());
    if (detectErr) throw detectErr;
    return { retry };
}

/**
 * Un ciclo: hasta BATCH_OWNERS dueños de la cola. Nunca lanza por un dueño:
 * el error queda en la cola (attempts, last_error, reintento con espera) y
 * sigue con el próximo. Un dueño con descargas fallidas también queda en la
 * cola (hasta MAX_ATTEMPTS) para reintentarlas sin esperar otra edición.
 */
async function runFingerprintCycle(deps) {
    const d = resolveDeps(deps);
    const stats = { owners: 0, fingerprinted: 0, updated: 0, removed: 0, alerts: 0, reopened: 0, allowed: 0, failed_items: 0, failed_owners: 0, retried_owners: 0 };
    if (!d.decoder || typeof d.decoder.isAvailable !== 'function' || !d.decoder.isAvailable()) {
        return { ...stats, skipped: 'decoder_unavailable' };
    }
    const entries = await d.repo.claimDirty(BATCH_OWNERS, d.now());
    for (const entry of entries || []) {
        stats.owners += 1;
        try {
            const result = await reconcileOwner(d, entry, stats);
            if (result && result.retry) {
                stats.retried_owners += 1;
                await d.repo.failDirty(entry, result.retry, d.now());
            } else {
                await d.repo.ackDirty(entry);
            }
        } catch (err) {
            stats.failed_owners += 1;
            d.log.warn(`[huellas] dueño ${entry.source_table} no procesado:`, short(err));
            try { await d.repo.failDirty(entry, short(err), d.now()); } catch (_) { /* nada */ }
            if (err && err.code === 'DECODER_UNAVAILABLE') break;
        }
    }
    return stats;
}

// ---- arranque -----------------------------------------------------------------

let current = null;

function jobEnabled(env = process.env) {
    return String((env && env.IMAGE_FP_JOB) || '').toLowerCase() !== 'off';
}

/**
 * Arranca el ciclo periódico. Devuelve una función para detenerlo, o null si
 * quedó apagado (IMAGE_FP_JOB=off o sin decodificador).
 */
function startImageFingerprintJob({
    intervalMs = 60000,
    firstMs = 90000,
    timers = { setTimeout, setInterval, clearTimeout, clearInterval },
    deps = null,
    env = process.env
} = {}) {
    const d = resolveDeps(deps);
    const log = d.log || console;
    if (!jobEnabled(env)) {
        log.log('[huellas] trabajo apagado (IMAGE_FP_JOB=off).');
        return null;
    }
    if (!d.decoder || typeof d.decoder.isAvailable !== 'function' || !d.decoder.isAvailable()) {
        log.warn('[huellas] sharp no está instalado: el trabajo de huellas de imágenes queda apagado.');
        return null;
    }
    if (current) return current.stop;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runFingerprintCycle(d);
            if (r.owners) {
                log.log(`[huellas] dueños: ${r.owners}, huellas: ${r.fingerprinted}, borradas: ${r.removed}, alertas: ${r.alerts}, fallidos: ${r.failed_owners}`);
            }
        } catch (err) {
            log.error('[huellas] ciclo falló:', short(err));
        } finally {
            running = false;
        }
    };
    const first = timers.setTimeout(tick, firstMs);
    const every = timers.setInterval(tick, intervalMs);
    if (first && typeof first.unref === 'function') first.unref();
    if (every && typeof every.unref === 'function') every.unref();
    const stop = () => {
        timers.clearTimeout(first);
        timers.clearInterval(every);
        if (current && current.stop === stop) current = null;
    };
    current = { stop, tick };
    return stop;
}

function stopImageFingerprintJob() {
    if (current) current.stop();
}

module.exports = {
    runFingerprintCycle,
    startImageFingerprintJob,
    stopImageFingerprintJob,
    fetchImageBytes,
    jobEnabled,
    BATCH_OWNERS,
    FETCH_TIMEOUT_MS,
    MAX_BYTES,
    _internal: { reconcileOwner, detectMatches, pairKey, laterOf, notifySupport, notifyReappeared, reopenReappeared, isAllowedPair, needsFingerprint, firstSeenFor, fitsColumns, short, current: () => current }
};
