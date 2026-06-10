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

const APIFY_ACTOR = process.env.APIFY_INSTAGRAM_ACTOR || 'apify/instagram-profile-scraper';
const APIFY_HOST = 'https://api.apify.com';

function envPositiveInt(name, fallback) {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const IG_MEDIA_DOWNLOAD_TIMEOUT_MS = envPositiveInt('IG_MEDIA_DOWNLOAD_TIMEOUT_MS', 10000);
const IG_STORAGE_UPLOAD_TIMEOUT_MS = envPositiveInt('IG_STORAGE_UPLOAD_TIMEOUT_MS', 10000);
const previewCache = new Map(); // payload_id -> { payload, expiresAt }

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

function sanitizeLimit(input) {
    const n = Number(input);
    if (![12, 24, 50].includes(n)) throw err('INVALID_LIMIT', 400, 'Limit must be 12, 24 or 50');
    return n;
}

// --- Apify ----------------------------------------------------------------

async function callApifyActor(token, handle, resultsLimit) {
    const actorPath = APIFY_ACTOR.replace('/', '~');
    const url = `${APIFY_HOST}/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const t0 = Date.now();
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [handle], resultsLimit })
    });
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

function transformProfile(rawItems, handle) {
    const profile = rawItems[0] || null;
    if (!profile) throw err('PROFILE_NOT_FOUND', 404, `Could not retrieve profile @${handle}`);
    if (profile.error || profile.errorDescription) {
        throw err('PROFILE_NOT_FOUND', 404, `Apify returned error: ${profile.error || profile.errorDescription}`);
    }
    if (profile.private === true || profile.isPrivate === true) {
        throw err('PROFILE_PRIVATE', 422, 'The Instagram profile is private — switch to public to import.');
    }

    const posts = collectPosts(profile, rawItems);
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
            caption: typeof p.caption === 'string' ? p.caption.slice(0, 2200) : null,
            timestamp: p.timestamp || p.takenAt || null,
            dimensions: extractDimensions(p)
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

    return {
        username: profile.username || handle,
        full_name: profile.fullName || profile.name || null,
        bio,
        bio_link: externalUrl,
        profile_pic: profilePic,
        location_guess: locationGuess,
        location_source: locFromBio ? 'bio' : (topGeotag ? 'geotag' : null),
        photos,
        reels
    };
}

function summarizePayload(payload) {
    return {
        username: payload.username,
        full_name: payload.full_name,
        profile_pic: payload.profile_pic,
        bio_present: Boolean(payload.bio),
        bio_link_present: Boolean(payload.bio_link),
        location_guess: payload.location_guess,
        location_source: payload.location_source,
        photos_count: payload.photos.length,
        reels_count: payload.reels.length
    };
}

// --- Public API -----------------------------------------------------------

async function getApifyToken() {
    const token = await appSettings.getSetting('apify_token', { envFallback: 'APIFY_TOKEN' });
    if (!token) throw err('APIFY_NOT_CONFIGURED', 503, 'Apify token is not configured. Set it in /backoffice/ → APIs.');
    return token;
}

async function preview({ handle, limit }) {
    const cleanHandle = sanitizeHandle(handle);
    const cleanLimit = sanitizeLimit(limit);
    const token = await getApifyToken();

    const { items, elapsedMs } = await callApifyActor(token, cleanHandle, cleanLimit);
    const payload = transformProfile(items, cleanHandle);

    const payloadId = crypto.randomUUID();
    previewCache.set(payloadId, {
        payload,
        expiresAt: Date.now() + PREVIEW_TTL_MS
    });

    return {
        payload_id: payloadId,
        elapsed_ms: elapsedMs,
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

// Selected categories from the UI (bio, bio_link, location, photos, reels).
//
// mode='signup' returns prefill data without writing to DB or Storage. The
// caller is unauthenticated (signup is pre-auth), so target_user_id is
// optional and audit logging is skipped — the audit will be recorded later
// if the same user does a dashboard sync.
//
// mode='dashboard' downloads media to Storage, patches the user's row, and
// records an audit entry. Requires target_user_id.
async function commit({ payload_id, selection, target_user_id, target, mode, allowed_permalinks }) {
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
    const mediaToImport = permalinkFilter
        ? allMedia.filter(m => m.permalink && permalinkFilter.has(m.permalink))
        : allMedia;

    const skipped = [];
    const newItems = [];
    const errors = []; // {permalink, kind, code, message} — visible in response

    for (const media of mediaToImport) {
        if (media.permalink && existingPermalinks.has(media.permalink)) {
            skipped.push(media.permalink);
            continue;
        }
        const ext = inferExtension(media.cdn_url, media.kind);
        const filename = `${permalinkHash(media.permalink || media.cdn_url)}.${ext}`;
        const storagePath = `instagram-import/${target_user_id}/${filename}`;
        let uploaded;
        try {
            uploaded = await downloadAndUpload(media.cdn_url, cfg.bucket, storagePath);
        } catch (e) {
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
            continue;
        }
        newItems.push({
            url: uploaded.public_url,
            category: media.category,
            kind: media.kind === 'reel' ? 'video' : 'image',
            created_at: media.timestamp || new Date().toISOString(),
            caption: media.caption || null,
            permalink: media.permalink || null
        });
    }

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
                reels: reelsImported
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
          ]
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
        errors: errors.slice(0, 20), // cap to keep response small
        // Signup mode: caller may use these to pre-fill wizard fields.
        prefill: {
            handle: payload.username || null,
            bio: wantsBio ? payload.bio : null,
            bio_link: wantsBioLink ? payload.bio_link : null,
            location_guess: wantsLocation ? payload.location_guess : null,
            media: signupMedia // CDN urls + permalinks for later finalize
        }
    };
}

module.exports = {
    preview,
    commit,
    sanitizeHandle,
    sanitizeLimit,
    // Exposed for tests / introspection
    _internal: { transformProfile, guessLocationFromBio, mostFrequentGeotag, classifyMedia, previewCache }
};
