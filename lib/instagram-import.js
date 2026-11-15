'use strict';

// Instagram profile import via Apify.
//
// Two-stage flow:
//   1) preview(handle, limit) — calls Apify, transforms response, caches a
//      payload keyed by uuid. Returns a summary the UI shows for confirmation.
//   2) commit(payload_id, selection, target_user_id, target='artist'|'studio')
//      — downloads the selected media to Supabase Storage, upserts the user's
//      gallery_feed_items / photo_feed_items, optionally updates bio / bio_link
//      / location columns, and records an audit row.
//
// Token resolution: reads `apify_token` from app_settings (managed by the
// backoffice) with a fallback to process.env.APIFY_TOKEN for local dev.

const crypto = require('crypto');
const appSettings = require('./app-settings');
const igConsent = require('./dashboard-ig-consent');

const galleryCaption = require('../public/shared/js/gallery-caption.js');
const profileContact = require('./instagram-profile-contact');

const APIFY_ACTOR = process.env.APIFY_INSTAGRAM_ACTOR || 'apify/instagram-profile-scraper';
// Ronda 2 (N2): el actor de PERFIL solo devuelve las ~12 últimas publicaciones
// (`latestPosts`), sin importar `resultsLimit`: por eso "traía 10". Para llegar
// a 50 se corre además un actor de PUBLICACIONES sobre el mismo perfil.
// APIFY_INSTAGRAM_POSTS_ACTOR=off lo desactiva (queda solo el perfil).
const APIFY_POSTS_ACTOR = process.env.APIFY_INSTAGRAM_POSTS_ACTOR || 'apify/instagram-scraper';
const APIFY_HOST = 'https://api.apify.com';

function envPositiveInt(name, fallback) {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const IG_MEDIA_DOWNLOAD_TIMEOUT_MS = envPositiveInt('IG_MEDIA_DOWNLOAD_TIMEOUT_MS', 10000);
const IG_STORAGE_UPLOAD_TIMEOUT_MS = envPositiveInt('IG_STORAGE_UPLOAD_TIMEOUT_MS', 10000);
// Por debajo de los 60 s que suele dar el proxy del hosting a cada request: si
// el actor de publicaciones no llega a tiempo, se sigue con las del perfil.
const APIFY_PROFILE_TIMEOUT_MS = envPositiveInt('APIFY_PROFILE_TIMEOUT_MS', 50000);
const APIFY_POSTS_TIMEOUT_MS = envPositiveInt('APIFY_POSTS_TIMEOUT_MS', 45000);
// Descargas en paralelo del commit: 50 publicaciones de a una tardaban más que
// el timeout del proxy.
const IG_COMMIT_CONCURRENCY = Math.min(8, envPositiveInt('IG_COMMIT_CONCURRENCY', 4));
const previewCache = new Map(); // payload_id -> { payload, expiresAt }
// Último perfil traído por handle. El registro vuelve a pedir el preview al
// final (ya con sesión) para descargar las publicaciones elegidas: con
// `reuse: true` se reutiliza este resultado en vez de pagar otra corrida de
// Apify y hacer esperar ~30 s más a quien acaba de confirmar su email.
const RECENT_PROFILE_TTL_MS = 45 * 60 * 1000;
const recentProfiles = new Map(); // handle (minúsculas) -> { payload, at }

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const LOCATION_REGEX = /[\u{1F4CD}\u{1F30D}\u{1F30E}\u{1F30F}\u{1F5FA}\u{FE0F}]\s*([^|\n]+?)(?:[\n|]|$)/u;

function supabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }
    return { url, serviceRoleKey };
}

function serviceHeaders(extra = {}) {
    const { serviceRoleKey } = supabaseConfig();
    return {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        ...extra
    };
}

function err(code, status, message) {
    const e = new Error(message || code);
    e.code = code;
    e.status = status;
    return e;
}

function sanitizeHandle(input) {
    if (typeof input !== 'string') throw err('INVALID_HANDLE', 400, 'Handle must be a string');
    const cleaned = input.trim().replace(/^@/, '');
    if (!HANDLE_RE.test(cleaned)) throw err('INVALID_HANDLE', 400, 'Invalid Instagram handle');
    return cleaned;
}

// Revision 12 nov 2026 (pag. 8): el preview trae SIEMPRE hasta 50
// publicaciones y el commit acepta hasta 50. sanitizeLimit queda por
// compatibilidad (el admin "test" y clientes viejos todavia mandan 12/24/50).
const IG_PREVIEW_LIMIT = 50;
const IG_MAX_COMMIT_MEDIA = 50;

function sanitizeLimit(input) {
    const n = Number(input);
    if (![12, 24, 50].includes(n)) throw err('INVALID_LIMIT', 400, 'Limit must be 12, 24 or 50');
    return n;
}

// --- Apify ----------------------------------------------------------------

// Entrada del actor de publicaciones según cuál esté configurado.
function buildPostsActorInput(actor, handle, limit) {
    if (/instagram-post-scraper/i.test(String(actor || ''))) {
        return { username: [handle], resultsLimit: limit };
    }
    // apify/instagram-scraper (y compatibles): publicaciones del perfil.
    return {
        directUrls: [`https://www.instagram.com/${handle}/`],
        resultsType: 'posts',
        resultsLimit: limit,
        addParentData: false
    };
}

function postsActorEnabled() {
    return !/^(off|none|false|0)$/i.test(String(APIFY_POSTS_ACTOR || '').trim());
}

async function callApifyActor(token, handle, resultsLimit) {
    return runApifyActor(token, APIFY_ACTOR, { usernames: [handle], resultsLimit }, APIFY_PROFILE_TIMEOUT_MS);
}

// Publicaciones del perfil (hasta `limit`). Devuelve solo filas que parecen
// una publicación: los actores responden filas de error/"sin resultados".
async function callApifyPostsActor(token, handle, limit) {
    const { items, elapsedMs } = await runApifyActor(
        token, APIFY_POSTS_ACTOR, buildPostsActorInput(APIFY_POSTS_ACTOR, handle, limit), APIFY_POSTS_TIMEOUT_MS
    );
    const posts = items.filter(isPostRow);
    return { items: posts, elapsedMs };
}

function isPostRow(row) {
    if (!row || typeof row !== 'object' || row.error || row.errorDescription) return false;
    return Boolean(row.url || row.permalink || row.shortCode || row.displayUrl || row.videoUrl);
}

async function runApifyActor(token, actor, input, timeoutMs) {
    const actorPath = String(actor).replace('/', '~');
    const url = `${APIFY_HOST}/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || APIFY_PROFILE_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: controller.signal
        });
    } catch (e) {
        if (e && e.name === 'AbortError') throw err('APIFY_TIMEOUT', 504, 'Instagram tardó demasiado en responder. Prueba de nuevo en unos minutos.');
        throw e;
    } finally {
        clearTimeout(timer);
    }
    const elapsedMs = Date.now() - t0;

    if (res.status === 401 || res.status === 403) {
        throw err('APIFY_TOKEN_REJECTED', 502, 'Apify rejected the configured token');
    }
    if (res.status === 429) {
        throw err('APIFY_RATE_LIMITED', 429, 'Apify rate limit hit, try again shortly');
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw err('APIFY_ERROR', 502, `Apify HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const items = await res.json();
    return { items: Array.isArray(items) ? items : [], elapsedMs };
}

// --- Transform ------------------------------------------------------------

function classifyMedia(post) {
    const productType = String(post.productType || '').toLowerCase();
    const type = String(post.type || '').toLowerCase();
    const mediaType = String(post.mediaType || post.media_type || '').toLowerCase();
    if (productType.includes('reel')) return 'reel';
    if (type === 'video' || mediaType.includes('video')) return 'reel';
    if (post.isVideo === true || post.videoUrl || post.video_url) return 'reel';
    return 'image';
}

function bestUrl(post, kind) {
    const candidates = kind === 'reel'
        ? [
            post.videoUrl,
            post.video_url,
            post.videoDownloadUrl,
            post.video_download_url,
            post.displayUrl,
            post.display_url,
            post.imageUrl,
            post.image_url,
            post.thumbnailUrl,
            post.thumbnail_url,
            post.thumbnail
        ]
        : [
            post.displayUrl,
            post.display_url,
            post.imageUrl,
            post.image_url,
            post.thumbnailUrl,
            post.thumbnail_url,
            post.thumbnail,
            post.videoUrl,
            post.video_url
        ];
    return candidates.find(url => typeof url === 'string' && /^https?:\/\//i.test(url)) || null;
}

function thumbnailUrl(post) {
    const candidates = [
        post.displayUrl,
        post.display_url,
        post.imageUrl,
        post.image_url,
        post.thumbnailUrl,
        post.thumbnail_url,
        post.thumbnail
    ];
    return candidates.find(url => typeof url === 'string' && /^https?:\/\//i.test(url)) || null;
}

// Clave estable de una publicación: su shortcode (el perfil y el actor de
// publicaciones no siempre escriben la URL igual: con o sin barra final, /p/ o
// /reel/).
function postKey(post) {
    if (!post || typeof post !== 'object') return '';
    const link = String(post.url || post.permalink || '');
    const m = link.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/?#]+)/i);
    if (m) return 'sc:' + m[1];
    if (post.shortCode) return 'sc:' + post.shortCode;
    return String(link || post.id || post.displayUrl || post.videoUrl || '');
}

function postTime(post) {
    const t = Date.parse(post && (post.timestamp || post.takenAt) || '');
    return Number.isFinite(t) ? t : 0;
}

// Une las publicaciones del perfil con las del actor de publicaciones, sin
// repetir, de la más nueva a la más vieja y con tope `limit`.
function mergePosts(profilePosts, extraPosts, limit) {
    const byKey = new Map();
    const order = [];
    const add = (post) => {
        if (!post || typeof post !== 'object') return;
        const key = postKey(post);
        if (!key) { order.push(post); return; }
        if (byKey.has(key)) return;
        byKey.set(key, post);
        order.push(post);
    };
    // Las del actor de publicaciones primero: traen más datos (pie completo,
    // duración del video); las del perfil completan lo que falte.
    (Array.isArray(extraPosts) ? extraPosts : []).forEach(add);
    (Array.isArray(profilePosts) ? profilePosts : []).forEach(add);
    const sorted = order
        .map((post, index) => ({ post, index, time: postTime(post) }))
        .sort((a, b) => (b.time - a.time) || (a.index - b.index))
        .map(entry => entry.post);
    return typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
}

function collectPosts(profile, rawItems) {
    const seen = new Set();
    const posts = [];
    const arrays = [
        profile.latestPosts,
        profile.posts,
        profile.latestReels,
        profile.reels,
        profile.latestVideos,
        profile.videos,
        profile.latestIgtvVideos,
        profile.igtv
    ];

    function pushPost(post) {
        if (!post || typeof post !== 'object') return;
        const key = post.url || post.permalink || post.shortCode || post.id || post.displayUrl || post.videoUrl;
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        posts.push(post);
    }

    arrays.forEach(list => {
        if (Array.isArray(list)) list.forEach(pushPost);
    });

    // Some Apify actors can return the profile as the first item and media as
    // subsequent dataset rows. Keep this fallback so bio/profile imports do
    // not work while media silently stays empty.
    if (posts.length === 0 && Array.isArray(rawItems) && rawItems.length > 1) {
        rawItems.slice(1).forEach(pushPost);
    }

    return posts;
}

function extractDimensions(post) {
    const w = post.dimensionsWidth || post.width || null;
    const h = post.dimensionsHeight || post.height || null;
    return (w || h) ? { w, h } : null;
}

function inferExtension(urlString, mediaKind) {
    try {
        const u = new URL(urlString);
        const m = u.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
        if (m) return m[1].toLowerCase();
    } catch (_) {}
    return mediaKind === 'reel' ? 'mp4' : 'jpg';
}

function permalinkHash(permalink) {
    return crypto.createHash('sha1').update(permalink || '').digest('hex').slice(0, 12);
}

function guessLocationFromBio(bio) {
    if (!bio) return null;
    const m = bio.match(LOCATION_REGEX);
    if (!m) return null;
    return m[1].trim().slice(0, 80) || null;
}

function mostFrequentGeotag(posts) {
    const tally = new Map();
    for (const p of posts || []) {
        const name = p && (p.locationName || (p.location && p.location.name));
        if (!name) continue;
        tally.set(name, (tally.get(name) || 0) + 1);
    }
    if (!tally.size) return null;
    const entries = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    return { name: entries[0][0], count: entries[0][1] };
}

function transformProfile(rawItems, handle, options = {}) {
    const profile = rawItems[0] || null;
    if (!profile) throw err('PROFILE_NOT_FOUND', 404, `Could not retrieve profile @${handle}`);
    if (profile.error || profile.errorDescription) {
        throw err('PROFILE_NOT_FOUND', 404, `Apify returned error: ${profile.error || profile.errorDescription}`);
    }
    if (profile.private === true || profile.isPrivate === true) {
        throw err('PROFILE_PRIVATE', 422, 'The Instagram profile is private — switch to public to import.');
    }

    const posts = mergePosts(collectPosts(profile, rawItems), options.extraPosts, options.limit || IG_PREVIEW_LIMIT);
    const photos = [];
    const reels = [];

    for (const p of posts) {
        const kind = classifyMedia(p);
        const cdnUrl = bestUrl(p, kind);
        if (!cdnUrl) continue;
        const item = {
            permalink: p.url || p.permalink || null,
            kind,
            cdn_url: cdnUrl,
            thumbnail_url: thumbnailUrl(p),
            // Pie de la publicación (N3): texto plano saneado, tope 2200.
            caption: galleryCaption.sanitizeCaption(p.caption) || null,
            timestamp: p.timestamp || p.takenAt || null,
            dimensions: extractDimensions(p),
            video_duration: kind === 'reel' && Number.isFinite(Number(p.videoDuration)) ? Math.round(Number(p.videoDuration)) : null
        };
        if (kind === 'reel') reels.push(item);
        else photos.push(item);
    }

    const bio = (profile.biography || profile.bio || '').slice(0, 1000);
    const externalUrl = profile.externalUrl || profile.website || null;
    const profilePic = profile.profilePicUrl || profile.profilePicture || null;

    const locFromBio = guessLocationFromBio(bio);
    const topGeotag = mostFrequentGeotag(posts);
    const locationGuess = locFromBio || (topGeotag ? topGeotag.name : null);
    // P3: email y ciudad/país que el perfil expone (cuenta profesional) o que
    // se pueden inferir con prudencia de la bio; el registro los precarga
    // marcados "traído de Instagram" y siempre editables.
    const contact = profileContact.extractProfileContact(profile, {
        bio,
        locationGuess,
        locationSource: locFromBio ? 'bio' : (topGeotag ? 'geotag' : null)
    });

    return {
        username: profile.username || handle,
        full_name: profileContact.cleanFullName(profile.fullName || profile.full_name || profile.name) || null,
        contact,
        bio,
        bio_link: externalUrl,
        profile_pic: profilePic,
        location_guess: locationGuess,
        location_source: locFromBio ? 'bio' : (topGeotag ? 'geotag' : null),
        photos,
        reels
    };
}

// El preview muestra todo lo que devolvio Apify (pedido de 50 publicaciones +
// reels); el tope de lo que se importa lo pone IG_MAX_COMMIT_MEDIA.
const MAX_PREVIEW_MEDIA = 100;

function summarizePayload(payload) {
    return {
        username: payload.username,
        full_name: payload.full_name,
        profile_pic: payload.profile_pic,
        bio_present: Boolean(payload.bio),
        bio_link_present: Boolean(payload.bio_link),
        location_guess: payload.location_guess,
        location_source: payload.location_source,
        // P3: qué datos de contacto se detectaron (el detalle viaja en el
        // prefill del commit de registro, no en el resumen del panel).
        contact_present: {
            email: Boolean(payload.contact && payload.contact.email),
            city: Boolean(payload.contact && payload.contact.city),
            country: Boolean(payload.contact && payload.contact.country)
        },
        photos_count: payload.photos.length,
        reels_count: payload.reels.length,
        // Selección por publicación en el diálogo (Figma final, 2003:1902):
        // el cliente elige y el commit recibe esos permalinks en
        // allowed_permalinks. Solo metadatos públicos del post, sin cdn_url.
        media: payload.photos.concat(payload.reels)
            .filter(item => item.permalink)
            .slice(0, MAX_PREVIEW_MEDIA)
            .map(item => ({
                permalink: item.permalink,
                kind: item.kind,
                thumbnail_url: item.thumbnail_url || null,
                video_duration: item.video_duration || null,
                timestamp: item.timestamp || null,
                // Comienzo del pie: nombre accesible de la publicación en la
                // grilla de selección (el pie completo va en el commit).
                caption: item.caption ? Array.from(item.caption).slice(0, 140).join('') : null
            }))
    };
}

function pruneCaches(now = Date.now()) {
    for (const [id, entry] of previewCache) {
        if (entry.expiresAt < now) previewCache.delete(id);
    }
    for (const [handle, entry] of recentProfiles) {
        if (now - entry.at > RECENT_PROFILE_TTL_MS) recentProfiles.delete(handle);
    }
}

// --- Public API -----------------------------------------------------------

async function getApifyToken() {
    const token = await appSettings.getSetting('apify_token', { envFallback: 'APIFY_TOKEN' });
    if (!token) throw err('APIFY_NOT_CONFIGURED', 503, 'Apify token is not configured. Set it in /backoffice/ → APIs.');
    return token;
}

async function preview({ handle, reuse = false } = {}) {
    const cleanHandle = sanitizeHandle(handle);
    const cleanLimit = IG_PREVIEW_LIMIT;
    pruneCaches();

    const handleKey = cleanHandle.toLowerCase();
    const recent = reuse ? recentProfiles.get(handleKey) : null;
    let payload;
    let elapsedMs = 0;
    let postsSource = 'profile';
    if (recent && Date.now() - recent.at <= RECENT_PROFILE_TTL_MS) {
        payload = recent.payload;
        postsSource = 'cache';
    } else {
        const token = await getApifyToken();
        // Perfil y publicaciones en paralelo. Si el actor de publicaciones
        // falla, el import sigue con las ~12 del perfil (nunca bloquea).
        const postsPromise = postsActorEnabled()
            ? callApifyPostsActor(token, cleanHandle, cleanLimit).catch((e) => {
                console.warn('[instagram-import] posts actor failed, using profile posts only:', e.code || '', e.message);
                return { items: [], elapsedMs: 0, failed: true };
            })
            : Promise.resolve({ items: [], elapsedMs: 0, disabled: true });
        const [profileRun, postsRun] = await Promise.all([
            callApifyActor(token, cleanHandle, cleanLimit),
            postsPromise
        ]);
        elapsedMs = Math.max(profileRun.elapsedMs, postsRun.elapsedMs || 0);
        payload = transformProfile(profileRun.items, cleanHandle, { extraPosts: postsRun.items, limit: cleanLimit });
        if (postsRun.items.length) postsSource = 'posts';
        recentProfiles.set(handleKey, { payload, at: Date.now() });
    }

    const payloadId = crypto.randomUUID();
    previewCache.set(payloadId, {
        payload,
        expiresAt: Date.now() + PREVIEW_TTL_MS
    });

    return {
        payload_id: payloadId,
        elapsed_ms: elapsedMs,
        posts_source: postsSource,
        max_posts: cleanLimit,
        summary: summarizePayload(payload)
    };
}

function readCachedPayload(payloadId) {
    const entry = previewCache.get(payloadId);
    if (!entry) throw err('PAYLOAD_EXPIRED', 410, 'Preview expired — please re-fetch the profile');
    if (entry.expiresAt < Date.now()) {
        previewCache.delete(payloadId);
        throw err('PAYLOAD_EXPIRED', 410, 'Preview expired — please re-fetch the profile');
    }
    return entry.payload;
}

// --- Storage upload -------------------------------------------------------

const TARGET_CONFIG = {
    artist: { bucket: 'artist-gallery', table: 'artists_db', items_column: 'gallery_feed_items' },
    studio: { bucket: 'studio-photos',  table: 'studios',    items_column: 'photo_feed_items' }
};

// IG CDN (scontent.cdninstagram.com, *.fbcdn.net) returns 403 for the default
// Node fetch User-Agent. We mirror the headers the /api/instagram/proxy-thumb
// endpoint already uses so the download path matches the thumbnail path.
const IG_CDN_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; WeOtziProxy/1.0)',
    'Accept': 'image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

async function downloadAndUpload(cdnUrl, bucket, storagePath) {
    const cdnController = new AbortController();
    const cdnTimeout = setTimeout(() => cdnController.abort(), IG_MEDIA_DOWNLOAD_TIMEOUT_MS);
    let arrayBuffer;
    let contentType;
    try {
        const cdnRes = await fetch(cdnUrl, {
            redirect: 'follow',
            headers: IG_CDN_HEADERS,
            signal: cdnController.signal
        });
        if (!cdnRes.ok) {
            throw err('MEDIA_DOWNLOAD_FAILED', 502, `Could not download media (${cdnRes.status})`);
        }
        arrayBuffer = await cdnRes.arrayBuffer();
        contentType = cdnRes.headers.get('content-type') || 'application/octet-stream';
    } catch (e) {
        if (e && e.name === 'AbortError') {
            throw err('MEDIA_DOWNLOAD_TIMEOUT', 504, `Media download timed out after ${IG_MEDIA_DOWNLOAD_TIMEOUT_MS}ms`);
        }
        throw e;
    } finally {
        clearTimeout(cdnTimeout);
    }

    const { url } = supabaseConfig();
    const uploadUrl = `${url}/storage/v1/object/${bucket}/${encodeURI(storagePath)}`;
    const uploadController = new AbortController();
    const uploadTimeout = setTimeout(() => uploadController.abort(), IG_STORAGE_UPLOAD_TIMEOUT_MS);
    let uploadRes;
    try {
        uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: serviceHeaders({
                'Content-Type': contentType,
                'x-upsert': 'true'
            }),
            body: Buffer.from(arrayBuffer),
            signal: uploadController.signal
        });
    } catch (e) {
        if (e && e.name === 'AbortError') {
            throw err('STORAGE_UPLOAD_TIMEOUT', 504, `Storage upload timed out after ${IG_STORAGE_UPLOAD_TIMEOUT_MS}ms`);
        }
        throw e;
    } finally {
        clearTimeout(uploadTimeout);
    }
    if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => '');
        throw err('STORAGE_UPLOAD_FAILED', 502, `Storage upload failed (${uploadRes.status}): ${body.slice(0, 200)}`);
    }
    const publicUrl = `${url}/storage/v1/object/public/${bucket}/${encodeURI(storagePath)}`;
    return { public_url: publicUrl, content_type: contentType, bytes: arrayBuffer.byteLength };
}

// --- DB helpers -----------------------------------------------------------

async function fetchExistingItems(table, items_column, userId) {
    const { url } = supabaseConfig();
    const res = await fetch(
        `${url}/rest/v1/${table}?user_id=eq.${userId}&select=${items_column}`,
        { headers: serviceHeaders() }
    );
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw err('DB_READ_FAILED', 502, `Could not read existing items: ${body.slice(0, 200)}`);
    }
    const rows = await res.json();
    if (!rows || rows.length === 0) return [];
    return Array.isArray(rows[0][items_column]) ? rows[0][items_column] : [];
}

async function patchRow(table, userId, patch) {
    const { url } = supabaseConfig();
    const res = await fetch(
        `${url}/rest/v1/${table}?user_id=eq.${userId}`,
        {
            method: 'PATCH',
            headers: serviceHeaders({ 'Prefer': 'return=minimal' }),
            body: JSON.stringify(patch)
        }
    );
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw err('DB_WRITE_FAILED', 502, `Could not update row: ${body.slice(0, 200)}`);
    }
    return true;
}

async function insertAuditRow({ userId, target, handle, importedFields, costEstimate }) {
    const { url } = supabaseConfig();
    const res = await fetch(
        `${url}/rest/v1/instagram_imports`,
        {
            method: 'POST',
            headers: serviceHeaders({ 'Prefer': 'return=minimal' }),
            body: JSON.stringify({
                user_id: userId,
                target,
                ig_handle: handle,
                imported_fields: importedFields,
                cost_estimate_usd: costEstimate
            })
        }
    );
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Audit failures should not block the user-visible commit.
        console.warn('[instagram-import] audit insert failed:', body.slice(0, 200));
    }
}

function estimateCost(photosImported, reelsImported) {
    // Rough: $0.0005 per media returned (Apify Instagram API Scraper pricing).
    return Number(((photosImported + reelsImported) * 0.0005).toFixed(4));
}

// One gallery_feed_items entry for an uploaded media. Besides the display
// fields it records where the photo came from (source / ig_handle /
// imported_at): the Instagram validation keeps imported items hidden from
// clients until that account is validated (public/shared/js/gallery-visibility.js).
function buildFeedItem(media, publicUrl, { igHandle, importedAt } = {}) {
    const when = importedAt || new Date().toISOString();
    const handle = String(igHandle || '').trim().replace(/^@+/, '').toLowerCase();
    return {
        url: publicUrl,
        category: media.category,
        kind: media.kind === 'reel' ? 'video' : 'image',
        created_at: media.timestamp || when,
        // Pie de foto (N3): el de Instagram o el que el artista editó en el
        // registro. Siempre texto plano saneado.
        caption: galleryCaption.sanitizeCaption(media.caption) || null,
        permalink: media.permalink || null,
        source: 'instagram',
        ig_handle: handle || null,
        imported_at: when
    };
}

// Ejecuta `worker` sobre `items` con hasta `limit` en paralelo y devuelve los
// resultados en el orden de entrada.
async function mapWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const results = new Array(list.length);
    const size = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
    let next = 0;
    async function run() {
        while (next < list.length) {
            const index = next++;
            results[index] = await worker(list[index], index);
        }
    }
    await Promise.all(Array.from({ length: size }, run));
    return results;
}

// Selected categories from the UI (bio, bio_link, location, photos, reels).
//
// mode='signup' returns prefill data without writing to DB or Storage. The
// caller is unauthenticated (signup is pre-auth), so target_user_id is
// optional and audit logging is skipped — the audit will be recorded later
// if the same user does a dashboard sync.
//
// mode='dashboard' downloads media to Storage, patches the user's row, and
// records an audit entry. Requires target_user_id.
// consent (ronda 3 · P17): consentimiento ya normalizado por el servidor
// (lib/dashboard-ig-consent.js). Se guarda en el audit y en cada ítem nuevo.
// captions (ronda 2 · N3): mapa { permalink: pie } con los pies que el artista
// editó en el paso de portfolio; pisa el de Instagram ('' lo quita).
async function commit({ payload_id, selection, target_user_id, target, mode, allowed_permalinks, consent = null, captions = null }) {
    const isSignup = mode === 'signup';
    if (!isSignup && (!target_user_id || typeof target_user_id !== 'string')) {
        throw err('INVALID_TARGET_USER', 400, 'target_user_id is required');
    }
    if (!TARGET_CONFIG[target]) {
        throw err('INVALID_TARGET', 400, 'target must be artist or studio');
    }
    const cfg = TARGET_CONFIG[target];
    const payload = readCachedPayload(payload_id);
    const sel = selection || {};

    // Optional whitelist: when the caller passes a list of IG permalinks,
    // only those media items are downloaded. Everything else in the payload
    // is silently skipped — used by the wizard to honor manual deletions
    // the user made on the portfolio preview screen.
    const permalinkFilter = Array.isArray(allowed_permalinks)
        ? new Set(allowed_permalinks.filter(p => typeof p === 'string'))
        : null;
    if (permalinkFilter && permalinkFilter.size > IG_MAX_COMMIT_MEDIA) {
        throw err('TOO_MANY_MEDIA', 400, `Podés importar hasta ${IG_MAX_COMMIT_MEDIA} publicaciones por vez.`);
    }

    const wantsPhotos = !!sel.photos && !isSignup;  // signup: skip media
    const wantsReels = !!sel.reels && !isSignup;
    const wantsBio = !!sel.bio;
    const wantsBioLink = !!sel.bio_link;
    const wantsLocation = !!sel.location;

    const existing = isSignup
        ? []
        : await fetchExistingItems(cfg.table, cfg.items_column, target_user_id);
    const existingPermalinks = new Set(
        existing.map(it => it && it.permalink).filter(Boolean)
    );

    const allMedia = []
        .concat(wantsPhotos ? payload.photos.map(p => ({ ...p, category: 'instagram' })) : [])
        .concat(wantsReels ? payload.reels.map(p => ({ ...p, category: 'instagram-reel' })) : []);
    // Tope de 50 por commit. Volver a importar está permitido: lo que ya está
    // en la galería (mismo permalink) se saltea y no se duplica.
    const mediaToImport = (permalinkFilter
        ? allMedia.filter(m => m.permalink && permalinkFilter.has(m.permalink))
        : allMedia).slice(0, IG_MAX_COMMIT_MEDIA);
    const seenInBatch = new Set();
    const captionOverrides = galleryCaption.sanitizeCaptionMap(captions, IG_MAX_COMMIT_MEDIA);
    const withCaptionOverride = (media) => (
        media.permalink && Object.prototype.hasOwnProperty.call(captionOverrides, media.permalink)
            ? { ...media, caption: captionOverrides[media.permalink] }
            : media
    );

    const skipped = [];
    const errors = []; // {permalink, kind, code, message} — visible in response
    const importedAt = new Date().toISOString();

    // Lo que ya está en la galería (o repetido en el pedido) se saltea antes
    // de descargar nada.
    const pending = [];
    for (const media of mediaToImport) {
        if (media.permalink && (existingPermalinks.has(media.permalink) || seenInBatch.has(media.permalink))) {
            skipped.push(media.permalink);
            continue;
        }
        if (media.permalink) seenInBatch.add(media.permalink);
        pending.push(media);
    }

    // Descarga + subida en paralelo (IG_COMMIT_CONCURRENCY a la vez) y se
    // conserva el orden del pedido en la galería.
    const uploads = await mapWithConcurrency(pending, IG_COMMIT_CONCURRENCY, async (source) => {
        const ext = inferExtension(source.cdn_url, source.kind);
        const filename = `${permalinkHash(source.permalink || source.cdn_url)}.${ext}`;
        const storagePath = `instagram-import/${target_user_id}/${filename}`;
        try {
            const uploaded = await downloadAndUpload(source.cdn_url, cfg.bucket, storagePath);
            return { media: withCaptionOverride(source), uploaded };
        } catch (e) {
            const media = source;
            console.warn(
                '[instagram-import] skip media due to upload error:',
                e.code || 'ERR',
                e.message,
                'cdn=' + (media.cdn_url || '').slice(0, 120),
                'permalink=' + (media.permalink || '(none)')
            );
            errors.push({
                permalink: media.permalink || null,
                kind: media.kind,
                code: e.code || 'UPLOAD_FAILED',
                message: (e.message || 'Upload failed').slice(0, 200)
            });
            return null;
        }
    });
    const newItems = [];
    for (const done of uploads) {
        if (!done) continue;
        const { media, uploaded } = done;
        newItems.push(buildFeedItem(media, uploaded.public_url, { igHandle: payload.username, importedAt }));
    }

    const consentRecord = igConsent.withHandle(consent, payload.username);
    if (consentRecord) newItems.forEach((item) => { item.consent_at = consentRecord.accepted_at; });

    const merged = existing.concat(newItems);
    const patch = {};
    if (newItems.length > 0) patch[cfg.items_column] = merged;

    if (target === 'artist') {
        if (wantsBio && payload.bio)            patch.bio_description = payload.bio;
        if (wantsBioLink && payload.bio_link)   patch.portafolio = payload.bio_link;
    } else {
        if (wantsBio && payload.bio)            patch.bio = payload.bio;
        if (wantsBioLink && payload.bio_link)   patch.website = payload.bio_link;
    }

    if (Object.keys(patch).length > 0 && !isSignup) {
        await patchRow(cfg.table, target_user_id, patch);
    }

    const photosImported = newItems.filter(it => it.kind === 'image').length;
    const reelsImported = newItems.filter(it => it.kind === 'video').length;
    const costEstimate = estimateCost(photosImported, reelsImported);

    if (!isSignup) {
        await insertAuditRow({
            userId: target_user_id,
            target,
            handle: payload.username,
            importedFields: {
                bio: wantsBio && Boolean(payload.bio),
                bio_link: wantsBioLink && Boolean(payload.bio_link),
                location: wantsLocation && Boolean(payload.location_guess),
                photos: photosImported,
                reels: reelsImported,
                consent: consentRecord
            },
            costEstimate
        });
    }

    // In signup mode, the user is unauthenticated and we did not download
    // anything to Storage. Surface the *raw* IG CDN URLs so the wizard can
    // preview them while the user keeps filling the form. The wizard will
    // re-call commit in dashboard mode after signUp to persist them.
    const signupMedia = isSignup
        ? [
            ...(sel.photos ? payload.photos.map(p => ({ ...p, category: 'instagram' }))      : []),
            ...(sel.reels  ? payload.reels.map(p  => ({ ...p, category: 'instagram-reel' })) : [])
          ].filter(m => !permalinkFilter || (m.permalink && permalinkFilter.has(m.permalink)))
            .slice(0, IG_MAX_COMMIT_MEDIA)
        : [];

    if (!isSignup) previewCache.delete(payload_id);

    return {
        imported: {
            photos: photosImported,
            reels: reelsImported,
            bio: wantsBio && Boolean(payload.bio),
            bio_link: wantsBioLink && Boolean(payload.bio_link),
            location_guess: wantsLocation ? payload.location_guess : null
        },
        skipped_duplicates: skipped.length,
        cost_estimate_usd: costEstimate,
        attempted_media: mediaToImport.length,
        max_media: IG_MAX_COMMIT_MEDIA,
        // Las fotos importadas quedan ocultas para clientes hasta validar la
        // cuenta de Instagram (public/shared/js/gallery-visibility.js).
        hidden_until_instagram_verified: true,
        // P17: el consentimiento quedó en el audit (solo modo dashboard).
        consent_recorded: !isSignup && Boolean(consentRecord),
        errors: errors.slice(0, 20), // cap to keep response small
        // Signup mode: caller may use these to pre-fill wizard fields.
        prefill: {
            handle: payload.username || null,
            bio: wantsBio ? payload.bio : null,
            bio_link: wantsBioLink ? payload.bio_link : null,
            location_guess: wantsLocation ? payload.location_guess : null,
            // P3 (solo registro): nombre completo, email y ciudad/país que el
            // perfil expone. El wizard los precarga en campos vacíos, marcados
            // "traído de Instagram" y siempre editables.
            profile: isSignup ? {
                full_name: payload.full_name || null,
                email: (payload.contact && payload.contact.email) || null,
                email_source: (payload.contact && payload.contact.email_source) || null,
                city: (payload.contact && payload.contact.city) || null,
                country: (payload.contact && payload.contact.country) || null,
                country_code: (payload.contact && payload.contact.country_code) || null,
                location_source: (payload.contact && payload.contact.location_source) || null
            } : null,
            media: signupMedia // CDN urls + permalinks for later finalize
        }
    };
}

module.exports = {
    IG_PREVIEW_LIMIT,
    IG_MAX_COMMIT_MEDIA,
    preview,
    commit,
    sanitizeHandle,
    sanitizeLimit,
    // Exposed for tests / introspection
    _internal: {
        transformProfile, summarizePayload, guessLocationFromBio, mostFrequentGeotag, classifyMedia, previewCache, buildFeedItem,
        // ronda 2 · registro
        buildPostsActorInput, mergePosts, postKey, isPostRow, mapWithConcurrency, recentProfiles, pruneCaches,
        RECENT_PROFILE_TTL_MS, APIFY_POSTS_ACTOR
    }
};
