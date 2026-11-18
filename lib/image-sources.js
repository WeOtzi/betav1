'use strict';

// ===========================================================================
// Fuentes de imágenes para las huellas (puro).
// ---------------------------------------------------------------------------
// Convierte las filas de la base en la lista de imágenes de un dueño:
//
//   artistSources(artistRow, { supabaseUrl })      gallery_feed_items (galería y flashes)
//   studioSources(studioRow, { supabaseUrl })      photo_feed_items
//   storeSources({ sellerType, sellerId, ownerUserId, products, assets }, { supabaseUrl })
//
// Cada fuente:
//   { source_kind, item_key, url, image_url, storage_bucket, storage_path, is_public,
//     claimed_at, owner_kind, owner_id, owner_user_id, artist_id, studio_id,
//     skip_reason }
//
// item_key es estable y queda atado al dueño ('<artist|studio>:<id>|<base>'):
// así dos dueños que muestran la misma URL tienen filas distintas (la copia
// enlazada también se detecta) y nadie pisa la huella de otro. <base>:
//   - flash con id:                    'id:<id>'
//   - URL pública de Storage:          '<bucket>/<path>' (sin query)
//   - archivo privado de diseño:       'store-design-files/<path>'
//   - cualquier otra URL:              'url:<url normalizada>'
//   - clave muy larga (> MAX_KEY):     'sha256:<hex de la base>' (la columna
//     item_key admite hasta 1200 caracteres; una URL de 2000 no debe tumbar
//     las demás imágenes del dueño)
// url es la que se descarga; image_url la que se guarda (null si pasa de
// MAX_URL caracteres: el CHECK de la columna es 2048).
// Videos: se omiten. URL relativa o de otro host: skip_reason
// 'skipped_external' (nunca se descarga: SSRF).
// ===========================================================================

const crypto = require('node:crypto');
const GalleryVisibility = require('../public/shared/js/gallery-visibility');
const { isPublicArtist } = require('./artist-visibility');

const PUBLIC_BUCKETS = Object.freeze(['artist-gallery', 'studio-photos', 'store-previews']);
const DESIGN_BUCKET = 'store-design-files';
const SOURCE_KINDS = Object.freeze(['artist_gallery', 'flash', 'studio_feed', 'store_preview', 'store_design']);
const SOURCE_KINDS_BY_TABLE = Object.freeze({
    artists_db: Object.freeze(['artist_gallery', 'flash']),
    studios: Object.freeze(['studio_feed']),
    store_products: Object.freeze(['store_preview', 'store_design'])
});

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;
const MAX_URL = 2048;
const MAX_KEY = 1200;
const MAX_ITEMS = 300;

function text(value) {
    return value == null ? '' : String(value).trim();
}

function baseUrl(supabaseUrl) {
    return text(supabaseUrl).replace(/\/+$/, '');
}

function cleanPath(path) {
    const p = text(path).replace(/^\/+/, '');
    if (!p || p.length > 1024 || p.includes('..') || p.includes('\\') || /[\u0000-\u001f]/.test(p)) return null;
    return p;
}

/**
 * URL pública de Storage de ESTE proyecto → { bucket, path } (sin query).
 * null si es de otro host, relativa, de otro tipo de ruta o con una ruta rara.
 */
function parseStorageUrl(url, supabaseUrl) {
    const base = baseUrl(supabaseUrl);
    const value = text(url).split('#')[0].split('?')[0];
    if (!base || !value) return null;
    const prefix = `${base}/storage/v1/object/public/`;
    if (!value.startsWith(prefix)) return null;
    const rest = value.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 1) return null;
    const bucket = rest.slice(0, slash);
    let path;
    try { path = decodeURIComponent(rest.slice(slash + 1)); } catch (_) { return null; }
    path = cleanPath(path);
    if (!/^[a-z0-9-]{2,63}$/.test(bucket) || !path) return null;
    return { bucket, path };
}

function publicObjectUrl(supabaseUrl, bucket, path) {
    const base = baseUrl(supabaseUrl);
    if (!base) return null;
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}

function normalizeUrl(url) {
    const value = text(url).split('#')[0];
    if (!value) return '';
    try {
        const u = new URL(value);
        u.hash = '';
        return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
    } catch (_) {
        return value;
    }
}

function isVideoItem(item) {
    if (!item || typeof item !== 'object') return false;
    const kind = text(item.kind).toLowerCase();
    if (kind === 'video' || kind === 'reel') return true;
    if (text(item.category).toLowerCase() === 'instagram-reel') return true;
    const path = text(item.url).split('?')[0];
    return VIDEO_EXT_RE.test(path);
}

function claimedAt(item) {
    for (const key of ['created_at', 'imported_at']) {
        const raw = item && item[key];
        if (!raw) continue;
        const t = Date.parse(raw);
        if (Number.isFinite(t)) return new Date(t).toISOString();
    }
    return null;
}

function ownerPrefix(ownerKind, ownerId) {
    return `${ownerKind}:${ownerId}|`;
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// Clave del ítem: '<prefijo><base>' o, si no entra en la columna, el sha256
// de la base (estable y sin chocar con las demás formas).
function ownerKey(prefix, base) {
    const key = prefix + base;
    return key.length <= MAX_KEY ? key : `${prefix}sha256:${sha256Hex(base)}`;
}

// La URL que se guarda en image_fingerprints.image_url (≤ MAX_URL o null).
function storableUrl(url) {
    return url && url.length <= MAX_URL ? url : null;
}

// Clave base y datos de Storage de una URL de feed.
function describeUrl(url, supabaseUrl) {
    const storage = parseStorageUrl(url, supabaseUrl);
    if (storage) {
        const fetchable = PUBLIC_BUCKETS.includes(storage.bucket) && !VIDEO_EXT_RE.test(storage.path);
        return {
            base: `${storage.bucket}/${storage.path}`,
            url: publicObjectUrl(supabaseUrl, storage.bucket, storage.path),
            storage_bucket: storage.bucket,
            storage_path: storage.path,
            skip_reason: fetchable ? null : 'skipped_external'
        };
    }
    const normalized = normalizeUrl(url);
    return {
        base: `url:${normalized}`,
        url: storableUrl(normalized),
        storage_bucket: null,
        storage_path: null,
        skip_reason: 'skipped_external'
    };
}

function finish(list, seen, source) {
    if (!source || seen.has(source.item_key)) return;
    seen.add(source.item_key);
    list.push(source);
}

function artistVisibilityState(row) {
    return {
        enforced: true,
        verified: Boolean(row && row.instagram_verified_at),
        handle: text(row && row.instagram_verified_handle) || null
    };
}

/** gallery_feed_items de una fila de artists_db (dueño = user_id). */
function artistSources(row, { supabaseUrl } = {}) {
    if (!row || !row.user_id) return [];
    const ownerId = String(row.user_id);
    const items = Array.isArray(row.gallery_feed_items) ? row.gallery_feed_items.slice(0, MAX_ITEMS) : [];
    const state = artistVisibilityState(row);
    const profilePublic = isPublicArtist(row);
    const prefix = ownerPrefix('artist', ownerId);
    const out = [];
    const seen = new Set();
    for (const item of items) {
        if (!item || typeof item !== 'object' || !text(item.url) || isVideoItem(item)) continue;
        const isFlash = text(item.category).toLowerCase() === 'flash';
        const described = describeUrl(item.url, supabaseUrl);
        const flashId = isFlash ? text(item.id).slice(0, 80) : '';
        finish(out, seen, {
            source_kind: isFlash ? 'flash' : 'artist_gallery',
            item_key: ownerKey(prefix, flashId ? `id:${flashId}` : described.base),
            url: described.url,
            image_url: storableUrl(described.url),
            storage_bucket: described.storage_bucket,
            storage_path: described.storage_path,
            is_public: profilePublic && GalleryVisibility.isPubliclyVisible(item, state),
            claimed_at: claimedAt(item),
            owner_kind: 'artist',
            owner_id: ownerId,
            owner_user_id: ownerId,
            artist_id: ownerId,
            studio_id: null,
            skip_reason: described.skip_reason
        });
    }
    return out;
}

function studioIsPublic(row) {
    if (!row) return false;
    const state = row.sanction_state == null || row.sanction_state === '' ? 'none' : String(row.sanction_state);
    return row.is_active !== false && state === 'none';
}

/** photo_feed_items de una fila de studios (dueño = studios.id). */
function studioSources(row, { supabaseUrl } = {}) {
    if (!row || !row.id) return [];
    const ownerId = String(row.id);
    const items = Array.isArray(row.photo_feed_items) ? row.photo_feed_items.slice(0, MAX_ITEMS) : [];
    const prefix = ownerPrefix('studio', ownerId);
    const isPublic = studioIsPublic(row);
    const out = [];
    const seen = new Set();
    for (const item of items) {
        const url = typeof item === 'string' ? item : item && item.url;
        if (!text(url)) continue;
        if (item && typeof item === 'object' && isVideoItem(item)) continue;
        if (typeof item === 'string' && VIDEO_EXT_RE.test(item.split('?')[0])) continue;
        const described = describeUrl(url, supabaseUrl);
        finish(out, seen, {
            source_kind: 'studio_feed',
            item_key: ownerKey(prefix, described.base),
            url: described.url,
            image_url: storableUrl(described.url),
            storage_bucket: described.storage_bucket,
            storage_path: described.storage_path,
            is_public: isPublic,
            claimed_at: typeof item === 'object' ? claimedAt(item) : null,
            owner_kind: 'studio',
            owner_id: ownerId,
            owner_user_id: row.user_id ? String(row.user_id) : null,
            artist_id: null,
            studio_id: ownerId,
            skip_reason: described.skip_reason
        });
    }
    return out;
}

/**
 * Vistas previas (store_products.images, bucket store-previews) y archivos de
 * diseño (store_design_assets, bucket privado store-design-files) de un
 * vendedor. sellerType 'artist' (sellerId = user_id) o 'studio' (studios.id).
 */
function storeSources({ sellerType, sellerId, ownerUserId = null, sellerPublic = true, products = [], assets = [] } = {}, { supabaseUrl } = {}) {
    if (!sellerId || (sellerType !== 'artist' && sellerType !== 'studio')) return [];
    const ownerId = String(sellerId);
    const isArtist = sellerType === 'artist';
    const owner = {
        owner_kind: sellerType,
        owner_id: ownerId,
        owner_user_id: isArtist ? ownerId : (ownerUserId ? String(ownerUserId) : null),
        artist_id: isArtist ? ownerId : null,
        studio_id: isArtist ? null : ownerId
    };
    const prefix = ownerPrefix(sellerType, ownerId);
    const out = [];
    const seen = new Set();
    const productById = new Map();
    for (const product of Array.isArray(products) ? products : []) {
        if (!product || String(product.seller_id) !== ownerId) continue;
        productById.set(String(product.id), product);
        const images = Array.isArray(product.images) ? product.images.slice(0, 8) : [];
        for (const image of images) {
            const path = cleanPath(image && typeof image === 'object' ? image.path : image);
            if (!path || VIDEO_EXT_RE.test(path)) continue;
            const url = publicObjectUrl(supabaseUrl, 'store-previews', path);
            finish(out, seen, {
                source_kind: 'store_preview',
                item_key: ownerKey(prefix, `store-previews/${path}`),
                url,
                image_url: storableUrl(url),
                storage_bucket: 'store-previews',
                storage_path: path,
                is_public: Boolean(sellerPublic) && product.status === 'active',
                claimed_at: null,
                ...owner,
                skip_reason: null
            });
        }
    }
    for (const asset of Array.isArray(assets) ? assets : []) {
        if (!asset || !productById.has(String(asset.product_id))) continue;
        const path = cleanPath(asset.storage_path);
        if (!path) continue;
        const mime = text(asset.mime_type).toLowerCase();
        const looksImage = mime ? mime.startsWith('image/') : IMAGE_EXT_RE.test(path);
        if (!looksImage) continue;
        finish(out, seen, {
            source_kind: 'store_design',
            item_key: ownerKey(prefix, `${DESIGN_BUCKET}/${path}`),
            url: null,
            image_url: null,
            storage_bucket: DESIGN_BUCKET,
            storage_path: path,
            is_public: false,
            claimed_at: claimedAt(asset),
            ...owner,
            skip_reason: null
        });
    }
    return out;
}

/**
 * ¿Se puede descargar esta URL? Solo objetos públicos de los buckets de
 * imágenes de ESTE proyecto, o una URL firmada de store-design-files.
 */
function isAllowedFetchUrl(url, supabaseUrl) {
    const base = baseUrl(supabaseUrl);
    if (!base) return false;
    let u;
    let b;
    try {
        u = new URL(String(url));
        b = new URL(base);
    } catch (_) {
        return false;
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && b.protocol === 'http:')) return false;
    if (u.protocol !== b.protocol || u.host.toLowerCase() !== b.host.toLowerCase()) return false;
    if (u.username || u.password) return false;
    let pathname;
    try { pathname = decodeURIComponent(u.pathname); } catch (_) { return false; }
    if (pathname.includes('..') || pathname.includes('\\')) return false;
    const publicMatch = /^\/storage\/v1\/object\/public\/([a-z0-9-]+)\/.+/.exec(pathname);
    if (publicMatch) return PUBLIC_BUCKETS.includes(publicMatch[1]) && !u.search;
    const signMatch = /^\/storage\/v1\/object\/sign\/([a-z0-9-]+)\/.+/.exec(pathname);
    if (signMatch) return signMatch[1] === DESIGN_BUCKET && u.searchParams.has('token');
    return false;
}

module.exports = {
    artistSources,
    studioSources,
    storeSources,
    parseStorageUrl,
    publicObjectUrl,
    normalizeUrl,
    isVideoItem,
    isAllowedFetchUrl,
    studioIsPublic,
    ownerKey,
    storableUrl,
    MAX_KEY,
    MAX_URL,
    PUBLIC_BUCKETS,
    DESIGN_BUCKET,
    SOURCE_KINDS,
    SOURCE_KINDS_BY_TABLE
};
