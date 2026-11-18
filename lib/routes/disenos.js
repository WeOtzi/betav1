'use strict';

// ===========================================================================
// Rutas de diseños (fase 2 · huellas de imágenes).
// ---------------------------------------------------------------------------
// Se registran desde server.js con una sola línea (la agrega la integración):
//   require('./lib/routes/disenos').register(app, { startJob: require.main === module });
//
// Persona con sesión (Bearer):
//   POST /api/disenos/buscar   cuerpo binario image/jpeg|png|webp, hasta 10 MB.
//        «¿Dónde está este diseño?»: calcula la huella EN MEMORIA y busca
//        imágenes publicadas en We Ötzi con distancia ≤ 12. La foto nunca se
//        guarda (ni en Storage ni en la base): solo queda una fila en
//        design_search_log (usuario, fecha y cantidad de resultados) para el
//        tope de 20 búsquedas por usuario cada 24 h. Además, tope por IP.
//
// Soporte (agente activo de support_users_db o superadmin del backoffice):
//   GET  /api/support/image-alerts/:id   alerta image_duplicate + dueños (datos públicos)
//   POST /api/support/image-alerts/:id   { action: legitimo|retirar|denuncia, note }
//        · legitimo: descarta la alerta.
//        · retirar (nota ≥ 3): quita el ítem del portafolio de quien subió la
//          imagen nueva (service role), marca la huella como borrada, cierra
//          la alerta y le avisa por correo (portfolio_item_removed).
//        · denuncia: cierra la alerta y devuelve el prefill de «Proponer
//          sanción» (motivo plagio_diseno).
//
// Decisión del dueño (2026-11-18): las coincidencias SOLO avisan a soporte.
// Nada se oculta solo; retirar es siempre una acción manual de un agente.
//
// Motor de huellas (equipo T6): lib/image-decode.js, lib/repos/image-fingerprints.js
// y lib/image-fingerprint-job.js. Se cargan de forma perezosa: si faltan o si
// `sharp` no está instalado, el buscador responde 503 «El buscador se habilita
// pronto.» y el servidor sigue andando.
//
// SSRF: este módulo nunca descarga imágenes. Las URL que devuelve solo las
// muestra el navegador, y solo si son https.
// ===========================================================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const { resolveBearerUser, isSuperadminEmail } = require('../auth/supabase-auth');
const { pgrest } = require('../postgrest');
const { SancionesRepo, isMissingSchemaError } = require('../repos/sanciones');
const S = require('../sanciones');
const { applicationBase } = require('../../services/email-request-context');

// --- constantes ------------------------------------------------------------------

const SEARCH_THRESHOLD = 12;
const SEARCH_MAX = 12;
const DAILY_LIMIT = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const NOTE_MAX = 2000;
const RETIRE_NOTE_MIN = 3;
const ACTIONS = ['legitimo', 'retirar', 'denuncia'];
// Solo estas fuentes se pueden retirar desde la alerta (las del motor de T6,
// lib/image-sources.js). Todo lo de la Store (store_preview, store_design y lo
// que venga con el prefijo store_) se gestiona desde la Store.
const PORTFOLIO_KINDS = ['artist_gallery', 'flash', 'studio_feed'];
const REMOVED_ITEMS_MAX = 5;
const DECODE_CONCURRENCY = 3;
const DECODE_QUEUE_MAX = 12;
const EMAIL_EVENT = 'portfolio_item_removed';

const CONFIDENCE_LABELS = { casi_segura: 'Casi segura', posible: 'Posible', parecida: 'Parecida' };
const SOURCE_LABELS = {
    artist_gallery: 'Galería del artista',
    artist_feed: 'Feed del artista',
    flash: 'Flash',
    studio_feed: 'Fotos del estudio',
    store_preview: 'Vista previa de la Store',
    store_design: 'Diseño de la Store'
};

const MSG = {
    login: 'Inicia sesión para buscar un diseño.',
    unavailable: 'El buscador se habilita pronto.',
    limit: `Llegaste al límite de ${DAILY_LIMIT} búsquedas por día. Prueba de nuevo mañana.`,
    ipLimit: 'Hiciste muchas búsquedas seguidas. Espera unos minutos y vuelve a intentarlo.',
    inProgress: 'Ya tienes una búsqueda en curso. Espera a que termine.',
    busy: 'El buscador está ocupado. Prueba de nuevo en un minuto.',
    badType: 'Sube una imagen JPG, PNG o WebP.',
    tooBig: 'La imagen puede pesar hasta 10 MB.',
    badImage: 'No pudimos leer esa imagen. Prueba con otra foto en JPG o PNG.',
    generic: 'No pudimos completar la búsqueda. Inténtalo de nuevo en unos minutos.',
    supportLogin: 'Inicia sesión con tu usuario de soporte.',
    supportOnly: 'Solo el equipo de soporte de We Ötzi gestiona estas alertas.',
    supportCheck: 'No pudimos verificar tu acceso. Inténtalo de nuevo.',
    alertMissing: 'No encontramos esa alerta.',
    alertKind: 'Esta alerta no es de una imagen duplicada.',
    alertClosed: 'Esta alerta ya fue gestionada.',
    action: 'Elige qué hacer: legítimo, retirar o abrir denuncia.',
    retireNote: 'Escribe el motivo del retiro (al menos 3 caracteres). Le llega a quien subió la foto.',
    noteLong: `La nota puede tener hasta ${NOTE_MAX} caracteres.`,
    storeRetire: 'Esta imagen es de la Store: retírala desde la gestión de la Store.',
    kindRetire: 'Esta imagen no es de un portafolio: no se puede retirar desde aquí.',
    itemGone: 'Esa foto ya no está en el portafolio. Cierra la alerta como legítima o abre una denuncia.',
    ownerMissing: 'No encontramos el perfil que subió la imagen.',
    migration: 'Las alertas todavía no están disponibles (falta aplicar una migración).',
    actionFailed: 'No pudimos guardar la acción. Inténtalo de nuevo.'
};

// --- helpers puros ---------------------------------------------------------------

// Etiqueta de parecido para el buscador: ≤ 2 casi segura, 3–8 posible, 9–12 parecida.
// Con el sha256 idéntico (si el resultado lo trae) es casi segura.
function searchConfidence(distance, sameSha) {
    const d = Number(distance);
    if (sameSha) return 'casi_segura';
    if (!Number.isFinite(d) || d < 0) return null;
    if (d <= 2) return 'casi_segura';
    if (d <= 8) return 'posible';
    if (d <= SEARCH_THRESHOLD) return 'parecida';
    return null;
}

// Tipo real por los primeros bytes (no confiamos en el Content-Type).
function sniffImageType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

function httpsUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' ? url.href : '';
    } catch (_) {
        return '';
    }
}

function bareUrl(value) {
    return String(value == null ? '' : value).trim().split('#')[0].split('?')[0];
}

// Clave del ítem como la arma el motor de huellas (lib/image-sources.js):
// '<artist|studio>:<owner_id>|<base>', con <base> = 'id:<id>' (flash),
// '<bucket>/<path>' (URL pública de Storage) o 'url:<url sin query>'.
// Aquí se compara solo <base>: el dueño ya lo fija la fila que se edita.
function itemKeyBase(key) {
    return String(key || '').trim().replace(/^(?:artist|studio):[^|]*\|/, '');
}

function itemKeysOf(raw) {
    const keys = [];
    const isObject = raw && typeof raw === 'object';
    if (isObject && raw.id != null && String(raw.id).trim()) keys.push(`id:${String(raw.id).trim()}`);
    const url = bareUrl(isObject ? raw.url : raw);
    if (url) {
        const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        if (m) {
            keys.push(`${m[1]}/${m[2]}`);
            try { keys.push(`${m[1]}/${decodeURIComponent(m[2])}`); } catch (_) { /* path sin escapar */ }
        }
        keys.push(`url:${url}`);
        // Igual que normalizeUrl de lib/image-sources.js: host en minúsculas y con query.
        const full = String(isObject ? raw.url : raw).trim().split('#')[0];
        try {
            const u = new URL(full);
            keys.push(`url:${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`);
        } catch (_) { /* URL relativa o rota */ }
    }
    return keys;
}

// ¿Este ítem del feed es el de la alerta? Por clave o por URL (sin query).
function itemMatches(raw, { itemKey, imageUrl } = {}) {
    const key = itemKeyBase(itemKey);
    if (key && itemKeysOf(raw).includes(key)) return true;
    const wanted = bareUrl(imageUrl);
    if (!wanted) return false;
    const url = bareUrl(raw && typeof raw === 'object' ? raw.url : raw);
    return Boolean(url) && url === wanted;
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
    }
    return [];
}

// → { items, removed, removedItems } (removedItems: los ítems crudos que salen).
function removeMatching(items, match) {
    const list = parseJsonArray(items);
    const kept = [];
    const removedItems = [];
    for (const raw of list) (itemMatches(raw, match) ? removedItems : kept).push(raw);
    return { items: kept, removed: removedItems.length, removedItems };
}

function isStoreKind(kind) {
    return String(kind || '').startsWith('store_');
}

// URL de una imagen de Storage como la guarda el perfil (getPublicUrl de
// supabase-js usa encodeURI): el motor la rearma con encodeURIComponent por
// segmento y no coincidiría con lo guardado si el nombre lleva , + = @ : & $ ;
function storageUrlLikeProfile(value) {
    const url = httpsUrl(value);
    if (!url) return '';
    const m = bareUrl(url).match(/^(https:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\/)(.+)$/);
    if (!m) return url;
    try {
        return m[1] + m[2].split('/').map((seg) => encodeURI(decodeURIComponent(seg))).join('/');
    } catch (_) {
        return url;
    }
}

// Clave del ítem en el formato de lib/denuncias.js (portfolioItemKey: id del
// ítem o nombre del archivo), para que «Denunciar» desde el buscador encuentre
// la foto en el perfil. Del item_key del motor: 'id:<x>' → x; si no, el último
// segmento de la ruta, escrito como en la URL guardada.
function reportKeyOf(itemKey, imageUrl) {
    const base = itemKeyBase(itemKey);
    if (base.startsWith('id:')) return base.slice(3).slice(0, 120);
    const fromUrl = bareUrl(storageUrlLikeProfile(imageUrl) || '').split('/').pop() || '';
    if (fromUrl) return fromUrl.slice(0, 120);
    const fromKey = bareUrl(base.replace(/^url:/, '')).split('/').pop() || '';
    try { return encodeURI(fromKey).slice(0, 120); } catch (_) { return fromKey.slice(0, 120); }
}

function isPublicArtistRow(row) {
    if (!row) return false;
    if (String(row.registration_status == null ? '' : row.registration_status).toLowerCase() === 'incompleto') return false;
    return (row.sanction_state == null || row.sanction_state === '' ? 'none' : row.sanction_state) === 'none';
}

function isPublicStudioRow(row) {
    if (!row || row.is_active === false) return false;
    return (row.sanction_state == null || row.sanction_state === '' ? 'none' : row.sanction_state) === 'none';
}

function artistOwner(row) {
    const username = S.cleanLine(row.username, 80);
    return {
        kind: 'artist',
        id: row.user_id || row.id,
        name: S.cleanLine(row.name || row.username, 120) || 'Artista',
        username,
        profile_url: username ? `/artist/profile?artist=${encodeURIComponent(username)}` : ''
    };
}

function studioOwner(row) {
    const slug = S.cleanLine(row.slug, 80);
    return {
        kind: 'studio',
        id: row.id,
        name: S.cleanLine(row.name, 120) || 'Estudio',
        slug,
        profile_url: `/studio/profile?studio=${encodeURIComponent(slug || String(row.id))}`
    };
}

function ownerKindOf(row) {
    if (row && (row.owner_kind === 'studio' || row.owner_kind === 'artist')) return row.owner_kind;
    if (row && row.source_kind === 'studio_feed') return 'studio';
    if (row && row.studio_id && !row.artist_id) return 'studio';
    return 'artist';
}

// --- dependencias (reemplazables desde los tests) ------------------------------------

function loadOptional(relPath) {
    try {
        return require(relPath);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message || '').includes(relPath.replace(/^\.\.\//, ''))) return null;
        console.warn(`[disenos] no se pudo cargar ${relPath}:`, String(err && err.message || err).slice(0, 200));
        return null;
    }
}

// El repo de T6 puede exportar las funciones sueltas o dentro de un objeto.
function pickRepo(mod) {
    if (!mod) return null;
    if (typeof mod.searchSimilar === 'function') return mod;
    for (const value of Object.values(mod)) {
        if (value && typeof value === 'object' && typeof value.searchSimilar === 'function') return value;
    }
    return null;
}

const ARTIST_PUBLIC_SELECT = 'id,user_id,name,username,registration_status,sanction_state';
const STUDIO_PUBLIC_SELECT = 'id,user_id,name,slug,is_active,sanction_state';

const DefaultOwners = {
    async artistsByIds(ids) {
        const list = [...new Set((ids || []).filter(S.isUuid))];
        if (!list.length) return [];
        return (await pgrest('artists_db').select(ARTIST_PUBLIC_SELECT).in('id', list).limit(100).execute()) || [];
    },
    async artistsByUserIds(ids) {
        const list = [...new Set((ids || []).filter(S.isUuid))];
        if (!list.length) return [];
        return (await pgrest('artists_db').select(ARTIST_PUBLIC_SELECT).in('user_id', list).limit(100).execute()) || [];
    },
    async studiosByIds(ids) {
        const list = [...new Set((ids || []).filter(S.isUuid))];
        if (!list.length) return [];
        return (await pgrest('studios').select(STUDIO_PUBLIC_SELECT).in('id', list).limit(100).execute()) || [];
    }
};

// Portafolio del dueño (service role). gallery_images es DERIVADA: el trigger
// sync_artist_gallery_feed_items la rehace desde gallery_feed_items. Se manda
// gallery_images: [] para que, si el feed queda vacío, el trigger no
// reconstruya el feed desde la columna vieja (devolvería la foto retirada).
const DefaultPortfolio = {
    async getArtist(ownerId, fallbackUserId) {
        const select = 'id,user_id,name,username,gallery_feed_items';
        if (S.isUuid(ownerId)) {
            const rows = await pgrest('artists_db').select(select)
                .or([{ col: 'id', op: 'eq', val: ownerId }, { col: 'user_id', op: 'eq', val: ownerId }]).limit(1).execute();
            if (rows && rows[0]) return rows[0];
        }
        if (S.isUuid(fallbackUserId)) {
            return pgrest('artists_db').select(select).eq('user_id', fallbackUserId).limit(1).single().execute();
        }
        return null;
    },
    async saveArtistFeed(artistRowId, items) {
        return pgrest('artists_db').select('id').eq('id', artistRowId)
            .patch({ gallery_feed_items: items, gallery_images: [] });
    },
    async getStudio(studioId) {
        if (!S.isUuid(studioId)) return null;
        return pgrest('studios').select('id,user_id,name,slug,photo_feed_items').eq('id', studioId).limit(1).single().execute();
    },
    async saveStudioFeed(studioId, items) {
        return pgrest('studios').select('id').eq('id', studioId).patch({ photo_feed_items: items });
    }
};

// Registro de búsquedas (design_search_log, service role). La fila se RESERVA
// antes de procesar la foto (con result_count 0) y después se completa con la
// cantidad de resultados: así el tope de 20 por día no se puede saltar con
// pedidos en paralelo. Si no se puede reservar, no se busca (falla cerrado).
const DefaultSearchLog = {
    async reserve(userId) {
        if (!S.isUuid(userId)) throw new Error('usuario inválido');
        const out = await pgrest('design_search_log').select('id').insert([{ user_id: userId, result_count: 0 }]);
        const row = Array.isArray(out) ? out[0] : out;
        if (!row || !row.id) throw new Error('la reserva no devolvió id');
        return row.id;
    },
    async complete(id, resultCount) {
        if (!S.isUuid(id)) return false;
        const count = Math.max(0, Math.min(100, Number(resultCount) || 0));
        await pgrest('design_search_log').eq('id', id).patch({ result_count: count }, { returning: false });
        return true;
    }
};

const deps = {
    resolveBearerUser,
    isSuperadminEmail,
    alerts: SancionesRepo,           // getAlert, updateAlert, getActiveSupportUser
    owners: DefaultOwners,
    portfolio: DefaultPortfolio,
    decoder: undefined,              // lib/image-decode.js (undefined = se carga al usarlo)
    fingerprints: undefined,         // lib/repos/image-fingerprints.js
    searchLog: DefaultSearchLog,     // reserve(userId) → id, complete(id, n)
    getAuthUser: (id) => require('../auth/supabase-admin').getAuthUser(id),
    sendEmail: (...args) => require('../../services/email-service').sendEmail(...args),
    applicationBase,
    now: () => new Date()
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

function decoder() {
    if (deps.decoder === undefined) deps.decoder = loadOptional('../image-decode');
    return deps.decoder;
}

function fingerprints() {
    if (deps.fingerprints === undefined) deps.fingerprints = pickRepo(loadOptional('../repos/image-fingerprints'));
    return deps.fingerprints;
}

function decoderReady() {
    const d = decoder();
    if (!d || typeof d.fingerprintBuffer !== 'function') return false;
    try {
        return typeof d.isAvailable === 'function' ? Boolean(d.isAvailable()) : true;
    } catch (_) {
        return false;
    }
}

function short(err) {
    return String(err && err.message || err).slice(0, 200);
}

// --- buscador --------------------------------------------------------------------

// Una búsqueda a la vez por usuario (el servidor corre en un solo proceso, PM2
// fork con instances: 1): el conteo de las últimas 24 h y la reserva de la fila
// quedan juntos, sin carreras entre pedidos en paralelo del mismo usuario.
const inflightUsers = new Set();

function holdUser(userId, res) {
    if (inflightUsers.has(userId)) return false;
    inflightUsers.add(userId);
    let released = false;
    const release = () => { if (!released) { released = true; inflightUsers.delete(userId); } };
    res.on('finish', release);
    res.on('close', release);
    return true;
}

// Tope de decodificaciones simultáneas en todo el proceso (memoria de sharp).
let decodeActive = 0;
const decodeQueue = [];

function acquireDecode() {
    if (decodeActive < DECODE_CONCURRENCY) { decodeActive += 1; return Promise.resolve(true); }
    if (decodeQueue.length >= DECODE_QUEUE_MAX) return Promise.resolve(false);
    return new Promise((resolve) => decodeQueue.push(resolve));
}

function releaseDecode() {
    const next = decodeQueue.shift();
    if (next) next(true); else decodeActive = Math.max(0, decodeActive - 1);
}

// 1) sesión obligatoria → 401; 2) motor apagado → 503; 3) otra búsqueda del
// mismo usuario en curso → 429; 4) tope diario → 429. Todo ANTES de leer el
// cuerpo (hasta 10 MB).
async function searchGate(req, res, next) {
    res.set('Cache-Control', 'no-store');
    let user = null;
    try { user = await deps.resolveBearerUser(req); } catch (_) { user = null; }
    if (!user || !user.id) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: MSG.login });
    const repo = fingerprints();
    if (!decoderReady() || !repo) return res.status(503).json({ success: false, code: 'SEARCH_UNAVAILABLE', error: MSG.unavailable });
    if (!holdUser(String(user.id), res)) {
        return res.status(429).json({ success: false, code: 'SEARCH_IN_PROGRESS', error: MSG.inProgress });
    }
    let used = 0;
    try {
        used = Number(await repo.countSearchesLast24h(user.id)) || 0;
    } catch (err) {
        if (isMissingSchemaError(err)) return res.status(503).json({ success: false, code: 'SEARCH_UNAVAILABLE', error: MSG.unavailable });
        console.error('[disenos] conteo de búsquedas falló:', short(err));
        return res.status(500).json({ success: false, error: MSG.generic });
    }
    if (used >= DAILY_LIMIT) {
        return res.status(429).json({ success: false, code: 'DAILY_LIMIT', error: MSG.limit, limits: { daily: DAILY_LIMIT, remaining: 0 } });
    }
    req.disenos = { user, used };
    return next();
}

const rawImage = express.raw({ type: IMAGE_TYPES, limit: '10mb' });

// express.raw en ESTA ruta solamente; sus errores salen en JSON.
function readImage(req, res, next) {
    rawImage(req, res, (err) => {
        if (!err) return next();
        if (err.status === 413 || err.type === 'entity.too.large') {
            return res.status(413).json({ success: false, code: 'TOO_LARGE', error: MSG.tooBig });
        }
        return res.status(400).json({ success: false, code: 'INVALID_IMAGE', error: MSG.badImage });
    });
}

async function resolveResultOwners(rows) {
    const artistIds = [];
    const userIds = [];
    const studioIds = [];
    for (const r of rows) {
        if (ownerKindOf(r) === 'studio') { if (r.studio_id) studioIds.push(r.studio_id); }
        else {
            if (r.owner_user_id) userIds.push(r.owner_user_id);
            if (r.artist_id) artistIds.push(r.artist_id);
        }
    }
    const [byId, byUser, studios] = await Promise.all([
        deps.owners.artistsByIds(artistIds).catch(() => []),
        deps.owners.artistsByUserIds([...userIds, ...artistIds]).catch(() => []),
        deps.owners.studiosByIds(studioIds).catch(() => [])
    ]);
    const artists = new Map();
    for (const a of [...(byId || []), ...(byUser || [])]) {
        if (!a) continue;
        if (a.id) artists.set(String(a.id), a);
        if (a.user_id) artists.set(String(a.user_id), a);
    }
    const studioMap = new Map((studios || []).filter(Boolean).map((s) => [String(s.id), s]));
    return { artists, studios: studioMap };
}

// Fila de searchSimilar → resultado público (o null si el dueño no es público).
function mapResult(row, owners, querySha) {
    const confidence = searchConfidence(row.distance, Boolean(querySha && row.sha256 && row.sha256 === querySha));
    if (!confidence) return null;
    let owner = null;
    if (ownerKindOf(row) === 'studio') {
        const studio = owners.studios.get(String(row.studio_id || ''));
        if (!isPublicStudioRow(studio)) return null;
        owner = studioOwner(studio);
    } else {
        const artist = owners.artists.get(String(row.artist_id || '')) || owners.artists.get(String(row.owner_user_id || ''));
        if (!isPublicArtistRow(artist)) return null;
        owner = artistOwner(artist);
    }
    return {
        distance: Number(row.distance),
        confidence,
        confidence_label: CONFIDENCE_LABELS[confidence],
        source_kind: row.source_kind || null,
        item_key: S.cleanLine(row.item_key, 300) || null,
        image_url: httpsUrl(row.image_url) || null,
        // Para WoReport (lib/denuncias.js findPortfolioItem): clave y URL como
        // las guarda el perfil, no como las normaliza el motor.
        report_key: S.cleanLine(reportKeyOf(row.item_key, row.image_url), 120) || null,
        report_image_url: storageUrlLikeProfile(row.image_url) || null,
        first_seen_at: row.first_seen_at || null,
        owner
    };
}

async function searchHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const ctx = req.disenos || {};
    const user = ctx.user;
    if (!user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: MSG.login });
    let buffer = Buffer.isBuffer(req.body) ? req.body : null;
    req.body = null; // la foto no queda colgada del request
    if (!buffer || !buffer.length) return res.status(400).json({ success: false, code: 'INVALID_IMAGE', error: MSG.badType });
    if (buffer.length > MAX_BYTES) return res.status(413).json({ success: false, code: 'TOO_LARGE', error: MSG.tooBig });
    if (!sniffImageType(buffer)) return res.status(400).json({ success: false, code: 'INVALID_IMAGE', error: MSG.badType });

    // Turno de decodificación primero (si el servidor está saturado no se gasta
    // la búsqueda); después se reserva el lugar ANTES de decodificar, que es lo
    // caro. Sin reserva no hay búsqueda: falla cerrado.
    if (!(await acquireDecode())) {
        buffer = null;
        return res.status(503).json({ success: false, code: 'SEARCH_BUSY', error: MSG.busy });
    }
    const remaining = Math.max(0, DAILY_LIMIT - (Number(ctx.used) || 0) - 1);
    let slot = null;
    let fp = null;
    try {
        try {
            slot = await deps.searchLog.reserve(user.id);
        } catch (err) {
            buffer = null;
            if (isMissingSchemaError(err)) return res.status(503).json({ success: false, code: 'SEARCH_UNAVAILABLE', error: MSG.unavailable });
            console.error('[disenos] no se pudo reservar la búsqueda:', short(err));
            return res.status(503).json({ success: false, code: 'SEARCH_UNAVAILABLE', error: MSG.generic });
        }
        try {
            fp = await decoder().fingerprintBuffer(buffer);
        } catch (_) {
            fp = null;
        }
    } finally {
        buffer = null; // se descarta: solo vive la huella
        releaseDecode();
    }
    if (!fp || !fp.phash) return res.status(400).json({ success: false, code: 'INVALID_IMAGE', error: MSG.badImage, limits: { daily: DAILY_LIMIT, remaining } });

    const repo = fingerprints();
    let rows;
    try {
        rows = await repo.searchSimilar({ phash: fp.phash, phashMirror: fp.phash_mirror || null, max: SEARCH_MAX, threshold: SEARCH_THRESHOLD });
    } catch (err) {
        if (isMissingSchemaError(err)) return res.status(503).json({ success: false, code: 'SEARCH_UNAVAILABLE', error: MSG.unavailable });
        console.error('[disenos] búsqueda falló:', short(err));
        return res.status(500).json({ success: false, error: MSG.generic });
    }
    const list = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && Number.isFinite(Number(r.distance)) && Number(r.distance) <= SEARCH_THRESHOLD)
        .sort((a, b) => Number(a.distance) - Number(b.distance))
        .slice(0, SEARCH_MAX);

    let results = [];
    if (list.length) {
        const owners = await resolveResultOwners(list);
        results = list.map((r) => mapResult(r, owners, fp.sha256)).filter(Boolean);
    }

    try {
        await deps.searchLog.complete(slot, results.length);
    } catch (err) {
        // La fila ya cuenta para el tope; solo falta la cantidad de resultados.
        console.warn('[disenos] no se pudo completar el registro de la búsqueda:', short(err));
    }
    return res.json({ success: true, results, limits: { daily: DAILY_LIMIT, remaining } });
}

// --- soporte: alertas de imagen duplicada ------------------------------------------------

async function authorizeReviewer(req) {
    let user = null;
    try { user = await deps.resolveBearerUser(req); } catch (_) { user = null; }
    if (!user || !user.id) return { ok: false, status: 401, error: MSG.supportLogin };
    if (deps.isSuperadminEmail(user.email)) return { ok: true, role: 'superadmin', userId: user.id };
    try {
        const agent = await deps.alerts.getActiveSupportUser(user.id);
        if (agent) return { ok: true, role: 'support', userId: user.id };
    } catch (err) {
        console.warn('[disenos] support lookup failed:', short(err));
        return { ok: false, status: 500, error: MSG.supportCheck };
    }
    return { ok: false, status: 403, error: MSG.supportOnly };
}

async function guard(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) { res.status(auth.status).json({ success: false, error: auth.error }); return null; }
    return auth;
}

// { ok, value: { action, note } } | { ok:false, status, field, error }
function parseActionInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const action = S.cleanLine(b.action, 20);
    if (!ACTIONS.includes(action)) return { ok: false, status: 400, field: 'action', error: MSG.action };
    const note = S.cleanText(b.note);
    if (note.length > NOTE_MAX) return { ok: false, status: 400, field: 'note', error: MSG.noteLong };
    if (action === 'retirar' && note.length < RETIRE_NOTE_MIN) return { ok: false, status: 400, field: 'note', error: MSG.retireNote };
    return { ok: true, value: { action, note } };
}

function side(payload, key) {
    const p = payload && typeof payload === 'object' ? payload : {};
    return p[key] && typeof p[key] === 'object' ? p[key] : {};
}

function fmtDay(iso) {
    const d = new Date(iso || '');
    return Number.isNaN(d.getTime()) ? 'fecha desconocida' : d.toISOString().slice(0, 10);
}

// Resumen para el formulario «Proponer sanción» (10–2000 caracteres).
function denunciaSummary(alert, note) {
    const p = alert.payload || {};
    const nw = side(p, 'new');
    const ex = side(p, 'existing');
    const label = CONFIDENCE_LABELS[p.confidence] || 'sin dato';
    const parts = [
        `Posible copia de imagen (alerta ${alert.id}). Distancia ${p.distance == null ? '?' : p.distance} de 64, confianza ${label.toLowerCase()}.`,
        `Imagen nueva (${SOURCE_LABELS[nw.source_kind] || 'portafolio'}) vista por primera vez el ${fmtDay(nw.first_seen_at)}; la anterior (${SOURCE_LABELS[ex.source_kind] || 'portafolio'}) es de la cuenta ${alert.related_user_id || ex.owner_id || 'desconocida'} desde el ${fmtDay(ex.first_seen_at)}.`
    ];
    if (note) parts.push(`Nota del agente: ${note}`);
    return parts.join(' ').slice(0, 2000);
}

async function closeAlert(id, auth, status, resolution) {
    return deps.alerts.updateAlert(id, {
        status, resolution: resolution.slice(0, NOTE_MAX), handled_by: auth.userId, handled_at: deps.now().toISOString()
    }, { expectStatus: 'open' });
}

// ¿Se puede retirar el ítem de la alerta? (antes de tocar nada)
// → { ok: true, kind, match } | { ok:false, status, code, error }
function retirePlan(alert) {
    const nw = side(alert.payload, 'new');
    const kind = String(nw.source_kind || '');
    if (isStoreKind(kind)) return { ok: false, status: 409, code: 'STORE_ITEM', error: MSG.storeRetire };
    if (!PORTFOLIO_KINDS.includes(kind)) return { ok: false, status: 409, code: 'UNSUPPORTED_SOURCE', error: MSG.kindRetire };
    const match = { itemKey: nw.item_key, imageUrl: nw.image_url };
    if (!match.itemKey && !match.imageUrl) return { ok: false, status: 409, code: 'NO_ITEM', error: MSG.ownerMissing };
    return { ok: true, kind, match };
}

// Quita el ítem del portafolio del dueño de la imagen NUEVA.
// → { ok, removed, removedItems, source, owner } | { ok:false, status, code, error }
// removed === 0 → ITEM_NOT_FOUND (no se guardó nada).
async function retirePortfolioItem(alert, plan) {
    const nw = side(alert.payload, 'new');
    const { match } = plan;
    if (plan.kind === 'studio_feed' || ownerKindOf(nw) === 'studio') {
        const studio = await deps.portfolio.getStudio(nw.owner_id || nw.studio_id);
        if (!studio) return { ok: false, status: 404, code: 'OWNER_NOT_FOUND', error: MSG.ownerMissing };
        const out = removeMatching(studio.photo_feed_items, match);
        if (!out.removed) return { ok: false, status: 409, code: 'ITEM_NOT_FOUND', error: MSG.itemGone };
        await deps.portfolio.saveStudioFeed(studio.id, out.items);
        return {
            ok: true, removed: out.removed, removedItems: out.removedItems, source: 'studios.photo_feed_items',
            owner: { kind: 'studio', id: studio.id, name: S.cleanLine(studio.name, 120), userId: studio.user_id || alert.subject_user_id }
        };
    }
    const artist = await deps.portfolio.getArtist(nw.owner_id || nw.artist_id, alert.subject_user_id);
    if (!artist) return { ok: false, status: 404, code: 'OWNER_NOT_FOUND', error: MSG.ownerMissing };
    const out = removeMatching(artist.gallery_feed_items, match);
    if (!out.removed) return { ok: false, status: 409, code: 'ITEM_NOT_FOUND', error: MSG.itemGone };
    await deps.portfolio.saveArtistFeed(artist.id, out.items);
    return {
        ok: true, removed: out.removed, removedItems: out.removedItems, source: 'artists_db.gallery_feed_items',
        owner: { kind: 'artist', id: artist.user_id || artist.id, name: S.cleanLine(artist.name || artist.username, 120), userId: artist.user_id || alert.subject_user_id }
    };
}

// Copia de lo retirado dentro de la alerta, para que soporte pueda volver a
// publicarlo (el correo lo promete). Los ítems del feed no llevan datos
// personales: URL, categoría, texto y datos del flash.
function removalRecord(retired, auth, atIso) {
    return {
        at: atIso,
        by: auth.userId,
        source: retired.source,
        owner_kind: retired.owner.kind,
        owner_id: retired.owner.id,
        items: (retired.removedItems || []).slice(0, REMOVED_ITEMS_MAX)
    };
}

async function notifyRemoved(alert, owner, note, req) {
    const userId = owner.userId || alert.subject_user_id;
    if (!S.isUuid(userId)) return false;
    try {
        const auth = await deps.getAuthUser(userId);
        if (!auth || !auth.email) return false;
        const base = deps.applicationBase(req);
        const result = await deps.sendEmail(EMAIL_EVENT, {
            app_base_url: base,
            recipient_email: auth.email,
            recipient_name: owner.name || '',
            recipient_role: owner.kind === 'studio' ? 'studio' : 'artist',
            reason_note: note,
            source_label: SOURCE_LABELS[side(alert.payload, 'new').source_kind] || '',
            removed_at: deps.now().toISOString()
        }, { idempotencyKey: `${EMAIL_EVENT}:${alert.id}`, ignorePreferences: true });
        return Boolean(result && result.ok);
    } catch (err) {
        console.warn(`[disenos] correo ${EMAIL_EVENT} no enviado:`, short(err));
        return false;
    }
}

async function loadImageAlert(req, res) {
    const id = String((req.params && req.params.id) || '');
    if (!S.isUuid(id)) { res.status(400).json({ success: false, error: 'ID de alerta inválido.' }); return null; }
    const alert = await deps.alerts.getAlert(id);
    if (!alert) { res.status(404).json({ success: false, error: MSG.alertMissing }); return null; }
    if (alert.kind !== 'image_duplicate') { res.status(409).json({ success: false, code: 'WRONG_KIND', error: MSG.alertKind }); return null; }
    return alert;
}

function schemaFailure(res, err, tag) {
    if (isMissingSchemaError(err)) return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MSG.migration });
    console.error(`[disenos] ${tag} failed:`, short(err));
    return res.status(500).json({ success: false, error: MSG.actionFailed });
}

// Dueños de las dos imágenes (datos públicos) para el panel.
async function alertOwners(alert) {
    const p = alert.payload || {};
    const out = {};
    for (const key of ['new', 'existing']) {
        const s = side(p, key);
        const fallbackUser = key === 'new' ? alert.subject_user_id : alert.related_user_id;
        try {
            if (ownerKindOf(s) === 'studio') {
                const rows = await deps.owners.studiosByIds([s.owner_id || s.studio_id]);
                const row = rows && rows[0];
                out[key] = row ? { ...studioOwner(row), sanction_state: row.sanction_state || 'none', is_public: isPublicStudioRow(row) } : null;
            } else {
                const ids = [s.owner_id || s.artist_id].filter(Boolean);
                let rows = await deps.owners.artistsByIds(ids);
                if (!rows || !rows.length) rows = await deps.owners.artistsByUserIds([...ids, fallbackUser].filter(Boolean));
                const row = rows && rows[0];
                out[key] = row ? { ...artistOwner(row), sanction_state: row.sanction_state || 'none', is_public: isPublicArtistRow(row) } : null;
            }
        } catch (_) {
            out[key] = null;
        }
    }
    return out;
}

async function imageAlertDetailHandler(req, res) {
    const auth = await guard(req, res);
    if (!auth) return undefined;
    try {
        const alert = await loadImageAlert(req, res);
        if (!alert) return undefined;
        const owners = await alertOwners(alert);
        return res.json({ success: true, alert: S.summarizeAlert(alert), owners });
    } catch (err) {
        return schemaFailure(res, err, 'image-alert');
    }
}

async function imageAlertActionHandler(req, res) {
    const auth = await guard(req, res);
    if (!auth) return undefined;
    const parsed = parseActionInput(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
    const { action, note } = parsed.value;
    try {
        const alert = await loadImageAlert(req, res);
        if (!alert) return undefined;
        if (alert.status !== 'open') return res.status(409).json({ success: false, code: 'NOT_OPEN', error: MSG.alertClosed });

        if (action === 'legitimo') {
            const updated = await closeAlert(alert.id, auth, 'dismissed', note ? `Legítimo: ${note}` : 'Legítimo: se publica sin cambios.');
            if (!updated) return res.status(409).json({ success: false, code: 'NOT_OPEN', error: MSG.alertClosed });
            console.log(`[disenos] alerta ${alert.id} marcada legítima por ${auth.role} ${auth.userId}`);
            return res.json({ success: true, action, alert: S.summarizeAlert(updated) });
        }

        if (action === 'denuncia') {
            const updated = await closeAlert(alert.id, auth, 'handled', note ? `Denuncia abierta: ${note}` : 'Denuncia abierta: se propone una sanción.');
            if (!updated) return res.status(409).json({ success: false, code: 'NOT_OPEN', error: MSG.alertClosed });
            console.log(`[disenos] alerta ${alert.id} pasa a denuncia por ${auth.role} ${auth.userId}`);
            return res.json({
                success: true,
                action,
                alert: S.summarizeAlert(updated),
                prefill: { user_id: alert.subject_user_id || null, reason_code: 'plagio_diseno', summary: denunciaSummary(alert, note) }
            });
        }

        // retirar: 1) validar; 2) tomar la alerta (open → handled, condicional:
        // si otro agente la gestionó en el mismo momento, no se toca nada);
        // 3) quitar el ítem del portafolio; si falla o ya no estaba, la alerta
        // vuelve a quedar abierta; 4) huella, copia de lo retirado y correo.
        const plan = retirePlan(alert);
        if (!plan.ok) return res.status(plan.status).json({ success: false, code: plan.code, error: plan.error });
        const claimed = await closeAlert(alert.id, auth, 'handled', `Retirando: ${note}`);
        if (!claimed) return res.status(409).json({ success: false, code: 'NOT_OPEN', error: MSG.alertClosed });
        const reopen = async () => {
            try {
                await deps.alerts.updateAlert(alert.id, { status: 'open', resolution: null, handled_by: null, handled_at: null }, { expectStatus: 'handled' });
            } catch (err) {
                console.error(`[disenos] alerta ${alert.id} quedó tomada sin retirar:`, short(err));
            }
        };
        let retired;
        try {
            retired = await retirePortfolioItem(alert, plan);
        } catch (err) {
            await reopen();
            throw err;
        }
        if (!retired.ok) {
            await reopen();
            return res.status(retired.status).json({ success: false, code: retired.code, error: retired.error });
        }
        const nw = side(alert.payload, 'new');
        const repo = fingerprints();
        if (repo && typeof repo.markRemoved === 'function') {
            try {
                await repo.markRemoved(nw.source_kind, nw.owner_id || retired.owner.id, nw.item_key);
            } catch (err) {
                console.warn('[disenos] no se pudo marcar la huella como borrada:', short(err));
            }
        }
        const atIso = deps.now().toISOString();
        const payload = { ...(alert.payload || {}), removal: removalRecord(retired, auth, atIso) };
        let updated = null;
        try {
            updated = await deps.alerts.updateAlert(alert.id, {
                resolution: `Retirada: ${note}`.slice(0, NOTE_MAX), payload
            }, { expectStatus: 'handled' });
        } catch (err) {
            console.error(`[disenos] alerta ${alert.id}: no se guardó la copia de lo retirado:`, short(err));
        }
        const emailSent = await notifyRemoved(alert, retired.owner, note, req);
        console.log(`[disenos] alerta ${alert.id}: ${retired.removed} ítem(s) retirado(s) por ${auth.role} ${auth.userId}`);
        return res.json({ success: true, action, alert: S.summarizeAlert(updated || claimed), removed: retired.removed, email_sent: emailSent });
    } catch (err) {
        return schemaFailure(res, err, 'image-alert-action');
    }
}

// --- registro ------------------------------------------------------------------------

const searchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', error: MSG.ipLimit }
});

let jobStarted = false;

function startJob() {
    if (jobStarted) return false;
    const job = loadOptional('../image-fingerprint-job');
    if (!job || typeof job.startImageFingerprintJob !== 'function') {
        console.warn('[disenos] el job de huellas no está disponible; el buscador queda apagado.');
        return false;
    }
    try {
        job.startImageFingerprintJob();
        jobStarted = true;
        return true;
    } catch (err) {
        console.warn('[disenos] no se pudo arrancar el job de huellas:', short(err));
        return false;
    }
}

// opts.startJob: arranca el job de huellas (solo el proceso principal).
// opts.limiter === false: sin tope por IP (tests).
function register(app, opts = {}) {
    if (!app) throw new Error('[disenos] falta la app de Express');
    const o = opts || {};
    if (o.startJob) startJob();
    const limit = o.limiter === false ? [] : [searchLimiter];
    app.post('/api/disenos/buscar', ...limit, searchGate, readImage, searchHandler);
    app.get('/api/support/image-alerts/:id', imageAlertDetailHandler);
    app.post('/api/support/image-alerts/:id', imageAlertActionHandler);
}

module.exports = {
    register,
    setDeps,
    _internal: {
        deps, setDeps, MSG, DAILY_LIMIT, SEARCH_THRESHOLD, SEARCH_MAX, CONFIDENCE_LABELS, SOURCE_LABELS, PORTFOLIO_KINDS,
        searchConfidence, sniffImageType, itemKeyBase, itemKeysOf, itemMatches, removeMatching, parseActionInput, denunciaSummary,
        mapResult, searchGate, searchHandler, imageAlertActionHandler, imageAlertDetailHandler, authorizeReviewer, startJob,
        isStoreKind, retirePlan, reportKeyOf, storageUrlLikeProfile, removalRecord
    }
};
