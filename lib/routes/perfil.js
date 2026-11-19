'use strict';

// ===========================================================================
// Rutas del perfil público del artista (frente "perfil", beta cerrada).
// ---------------------------------------------------------------------------
//   GET /artist/profile?artist=<usuario>   (también ?u=, ?username=, ?id=<uuid>)
//   GET /<handle>                          URL corta: /lauumarth, /@lauumarth, /lauumarth.wo
//
// Las dos sirven public/artist/profile/index.html con los meta OG / Twitter /
// canonical / robots del artista ya escritos (lib/profile-meta.js), para que
// WhatsApp, Instagram, Facebook, X, Telegram y LinkedIn muestren la vista
// previa con nombre, descripción y foto. El resto de la página la sigue
// pintando artist-profile.js en el navegador.
//
// /<handle> solo actúa si el segmento tiene forma de handle, no es una ruta
// reservada ni una carpeta/archivo de public/ y el artista existe; si no, pasa
// al siguiente handler (estático y 404 de siempre). /@lau y /lau.wo redirigen
// con 301 a /lau.
//
// Ante cualquier error se sirve el HTML original con noindex: compartir nunca
// rompe el perfil. Se registra antes de express.static desde server.js.
//
// Ronda 2 (frente "perfil"):
//   - og:image / twitter:image usan la tarjeta Open Graph 1200x630 que el
//     artista compone en su navegador (public.artist_share_cards), con sus
//     medidas; sin tarjeta, la foto de perfil de siempre.
//   POST /api/artist/profile-share              registra un compartido del perfil
//   POST /api/perfil/most-wanted/recalculate    recalcula Most Wanted (X-Cron-Token)
//   Con deps.startJob, además recalcula solo cada MOST_WANTED_INTERVAL_HOURS
//   (12 por defecto, 0 lo apaga) y le avisa por correo a quien gana la insignia
//   (MOST_WANTED_EMAILS=off lo apaga).
// ===========================================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const PublicUrl = require('../../public/shared/js/artist-public-url.js');
const ProfileMeta = require('../profile-meta');
const { clientIp: edgeClientIp } = require('../edge-http');
const { reservedHandles, existsInPublic } = require('../reserved-handles');
const { ArtistsPublicRepo } = require('../repos/artists-public');
const { PerfilTrendingRepo, normalizeChannel } = require('../repos/perfil-trending');

const PROFILE_HTML = path.join('artist', 'profile', 'index.html');
const FOUND_TTL_MS = 60 * 1000;
const MISSING_TTL_MS = 30 * 1000;
const CACHE_MAX = 500;
const SHARE_DEDUPE_MS = 60 * 60 * 1000;
const SHARE_WINDOW_MS = 10 * 60 * 1000;
const SHARE_MAX_PER_WINDOW = 40;
const MOST_WANTED_FIRST_RUN_MS = 3 * 60 * 1000;
const MOST_WANTED_DEFAULT_HOURS = 12;
const MOST_WANTED_NOTICE_BATCH = 25;

function createTemplateLoader(file) {
    let cached = { mtimeMs: -1, html: '' };
    return function load() {
        const stat = fs.statSync(file);
        if (stat.mtimeMs !== cached.mtimeMs) cached = { mtimeMs: stat.mtimeMs, html: fs.readFileSync(file, 'utf8') };
        return cached.html;
    };
}

function createLookupCache(now) {
    const map = new Map();
    return {
        get(key) {
            const hit = map.get(key);
            if (!hit) return undefined;
            if (now() - hit.at > (hit.value ? FOUND_TTL_MS : MISSING_TTL_MS)) { map.delete(key); return undefined; }
            return hit.value;
        },
        set(key, value) {
            if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
            map.set(key, { at: now(), value });
        },
        clear() { map.clear(); }
    };
}

const SAFE_HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const FALLBACK_HOST = 'beta.weotzi.com';
// En producción solo se confía en hosts propios: el HTML del perfil se cachea
// (max-age=300) y un Host falso no puede terminar en el canonical / og:url.
const OWN_HOST_RE = /^([a-z0-9-]+\.)*weotzi\.com(:\d{1,5})?$/i;

/**
 * Origen + base path absolutos de la app. PUBLIC_APP_URL manda; sin ella se
 * arma con el host de la request (solo para estos meta, nunca para emails).
 */
function resolveAppBase(req, env = process.env) {
    const configured = env.PUBLIC_APP_URL || env.APP_URL;
    if (configured) return String(configured).replace(/\/+$/, '');
    const rawHost = String((req.get && req.get('host')) || (req.headers && req.headers.host) || '');
    let host = SAFE_HOST_RE.test(rawHost) ? rawHost : FALLBACK_HOST;
    if (env.NODE_ENV === 'production' && !OWN_HOST_RE.test(host)) host = FALLBACK_HOST;
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    const proto = local ? (req.protocol || 'http') : 'https';
    return `${proto}://${host}${req.weotziBasePath || ''}`;
}

function searchOf(req) {
    const url = String(req.originalUrl || req.url || '');
    const index = url.indexOf('?');
    return index === -1 ? '' : url.slice(index);
}

function clientIp(req) {
    // La que agregó el proxy propio; el primer X-Forwarded-For lo elige el cliente (lib/edge-http.js).
    return edgeClientIp(req);
}

// Mismo hash que las visitas al perfil (server.js hashProfileVisitIp): nunca
// se guarda la IP, solo su huella con sal del servidor.
function hashIp(ip, env = process.env) {
    if (!ip) return null;
    const salt = env.PROFILE_VISIT_HASH_SALT
        || env.CRON_API_TOKEN
        || String(env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
    if (!salt) return null;
    return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

function safeTokenEqual(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function publicAppBase(env = process.env) {
    const configured = String(env.PUBLIC_APP_URL || env.APP_URL || '').trim().replace(/\/+$/, '');
    return /^https:\/\//i.test(configured) ? configured : `https://${FALLBACK_HOST}`;
}

function mostWantedIntervalMs(env = process.env) {
    const raw = env.MOST_WANTED_INTERVAL_HOURS;
    if (raw === undefined || raw === null || String(raw).trim() === '') return MOST_WANTED_DEFAULT_HOURS * 60 * 60 * 1000;
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    return Math.min(Math.max(hours, 1), 168) * 60 * 60 * 1000;
}

function createProfileRoutes(deps = {}) {
    const publicDir = deps.publicDir || path.join(__dirname, '..', '..', 'public');
    const repo = deps.repo || ArtistsPublicRepo;
    const env = deps.env || process.env;
    const now = deps.now || Date.now;
    const loadTemplate = deps.loadTemplate || createTemplateLoader(path.join(publicDir, PROFILE_HTML));
    const cache = createLookupCache(now);
    const trending = deps.trending || PerfilTrendingRepo;
    const resolveUser = deps.resolveUser || ((req) => require('../auth/supabase-auth').resolveBearerUser(req));
    const sendEmail = deps.sendEmail
        || ((eventId, payload, options) => require('../../services/email-service').sendEmail(eventId, payload, options));
    const log = deps.log || console;

    async function cached(key, fetcher) {
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        const value = (await fetcher()) || null;
        cache.set(key, value);
        return value;
    }

    async function loadArtist({ username, userId }) {
        if (userId) return cached(`id:${userId.toLowerCase()}`, () => repo.findPublicByUserId(userId));
        const normalized = PublicUrl.normalizeUsername(username);
        if (!normalized) return null;
        return cached(`u:${normalized}`, () => repo.findPublicByUsername(normalized));
    }

    async function loadPrefs(userId) {
        return cached(`p:${userId}`, () => repo.getPublicPrefs(userId));
    }

    // Tarjeta Open Graph (si el repo la conoce y la migración está aplicada).
    async function loadShareCard(userId) {
        if (typeof repo.getShareCard !== 'function') return null;
        return cached(`c:${userId}`, () => repo.getShareCard(userId));
    }

    function send(res, status, html, cacheControl) {
        res.status(status);
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', cacheControl);
        return res.send(html);
    }

    function sendFallback(req, res, status) {
        const base = resolveAppBase(req, env);
        const html = ProfileMeta.injectMeta(loadTemplate(), ProfileMeta.buildFallbackMeta({
            defaultImage: base + ProfileMeta.DEFAULT_IMAGE_PATH
        }));
        return send(res, status, html, 'no-store');
    }

    async function renderArtist(req, res, artist) {
        const base = resolveAppBase(req, env);
        const reserved = reservedHandles(publicDir);
        const [prefs, shareCard] = await Promise.all([
            loadPrefs(artist.user_id),
            loadShareCard(artist.user_id).catch(() => null)
        ]);
        const canonicalUrl = PublicUrl.publicProfileUrl(artist.username, base, { reserved });
        const meta = ProfileMeta.buildArtistMeta({
            artist,
            prefs,
            canonicalUrl,
            defaultImage: base + ProfileMeta.DEFAULT_IMAGE_PATH,
            shareCard,
            supabaseUrl: env.SUPABASE_URL
        });
        return send(res, 200, ProfileMeta.injectMeta(loadTemplate(), meta), 'public, max-age=300');
    }

    /** GET /artist/profile?artist=<usuario> (y alias). */
    async function serveProfile(req, res) {
        try {
            const search = searchOf(req);
            const params = new URLSearchParams(search);
            const username = PublicUrl.usernameFromSearch(search);
            const id = params.get('id') || '';
            const ref = username ? { username } : (PublicUrl.isUuid(id) ? { userId: id } : null);
            if (!ref) return sendFallback(req, res, 200);
            const artist = await loadArtist(ref);
            // La página igual se pinta (muestra "Artista no encontrado"); el 404
            // le dice a los bots que no hay nada que indexar.
            if (!artist) return sendFallback(req, res, 404);
            return await renderArtist(req, res, artist);
        } catch (err) {
            console.warn('[perfil] meta del perfil sin datos:', err.message);
            try { return sendFallback(req, res, 200); } catch (_) { return res.status(500).end(); }
        }
    }

    /** GET /<handle>: URL corta del perfil. */
    async function serveShortUrl(req, res, next) {
        let parsed;
        try {
            parsed = PublicUrl.parsePathHandle(req.params.handle, reservedHandles(publicDir));
        } catch (_) {
            parsed = null;
        }
        if (!parsed || existsInPublic(publicDir, parsed.handle)) return next();
        try {
            const artist = await loadArtist({ username: parsed.username });
            if (!artist) return next();
            if (!parsed.canonical) {
                return res.redirect(301, `${req.weotziBasePath || ''}/${parsed.handle}${searchOf(req)}`);
            }
            return await renderArtist(req, res, artist);
        } catch (err) {
            console.warn('[perfil] URL corta sin datos:', err.message);
            return next();
        }
    }

    /**
     * POST /api/artist/profile-share  { artist_username | artist_id, channel }
     * Cuenta una vez por persona, canal y hora. Es anónimo (el Bearer, si
     * viene, solo sirve para saber si comparte el propio artista).
     */
    async function recordShare(req, res) {
        res.set('Cache-Control', 'no-store');
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const username = typeof body.artist_username === 'string' ? body.artist_username.trim().slice(0, 80) : '';
        const artistId = typeof body.artist_id === 'string' ? body.artist_id.trim() : '';
        const ref = username ? { username } : (PublicUrl.isUuid(artistId) ? { userId: artistId } : null);
        if (!ref) return res.status(400).json({ success: false, error: 'Falta el artista.' });
        try {
            const artist = await loadArtist(ref);
            if (!artist || !artist.user_id) return res.status(404).json({ success: false, error: 'No encontramos ese perfil.' });

            let user = null;
            try { user = await resolveUser(req); } catch (_) { user = null; }
            const channel = normalizeChannel(body.channel);
            const person = hashIp(clientIp(req), env) || (user && user.id ? `user:${user.id}` : null);
            if (person) {
                const sinceIso = new Date(now() - SHARE_DEDUPE_MS).toISOString();
                if (await trending.hasRecentShare({ artistId: artist.user_id, ipHash: person, channel, sinceIso })) {
                    return res.json({ success: true, recorded: false, reason: 'deduplicated' });
                }
            }
            await trending.insertShare({
                artistId: artist.user_id,
                channel,
                sharerUserId: user && user.id ? user.id : null,
                isOwner: Boolean(user && user.id && user.id === artist.user_id),
                ipHash: person
            });
            return res.status(201).json({ success: true, recorded: true });
        } catch (err) {
            log.warn('[perfil] no se registró el compartido:', err.message);
            return res.status(502).json({ success: false, error: 'No pudimos registrar el compartido.' });
        }
    }

    function awardEmailsEnabled() {
        return !/^(off|0|false|no)$/i.test(String(env.MOST_WANTED_EMAILS || '').trim());
    }

    /** Avisa (una vez por racha) a quienes ganaron la insignia. */
    async function notifyPendingAwards() {
        if (!awardEmailsEnabled()) return 0;
        const pending = await trending.listPendingAwards(MOST_WANTED_NOTICE_BATCH);
        const base = publicAppBase(env);
        let sent = 0;
        for (const award of pending) {
            const artistUserId = award && award.artist_user_id;
            // El reclamo es atómico: con dos procesos, solo uno manda el correo.
            if (!artistUserId || !(await trending.claimAward(artistUserId, new Date(now()).toISOString()))) continue;
            try {
                const artist = await trending.getArtistContact(artistUserId);
                if (!artist || !artist.email) continue;
                const result = await sendEmail('artist_most_wanted_awarded', {
                    app_base_url: base,
                    artist_email: artist.email,
                    artist_name: artist.name || String(artist.username || '').replace(/\.wo$/i, '') || 'Artista',
                    artist_user_id: artistUserId,
                    recipient_user_id: artistUserId,
                    recipient_role: 'artist',
                    zone_label: award.zone_label || '',
                    rank: award.rank || '',
                    profile_url: PublicUrl.publicProfileUrl(artist.username, base, { reserved: reservedHandles(publicDir) })
                }, { idempotencyKey: `most-wanted:${artistUserId}:${award.awarded_at || ''}` });
                if (result && result.ok === false && !result.skipped) {
                    await trending.releaseAward(artistUserId);
                } else if (!result || !result.skipped) {
                    sent += 1;
                }
            } catch (err) {
                log.warn('[perfil] aviso Most Wanted sin enviar:', err.message);
                try { await trending.releaseAward(artistUserId); } catch (_) { /* se reintenta en el próximo ciclo */ }
            }
        }
        return sent;
    }

    /** Recalcula puntajes y ganadores, y después avisa a los nuevos. */
    async function runMostWantedCycle() {
        const summary = await trending.recalculate({});
        let notified = 0;
        try {
            notified = await notifyPendingAwards();
        } catch (err) {
            log.warn('[perfil] avisos Most Wanted:', err.message);
        }
        return { ...summary, notified };
    }

    /** POST /api/perfil/most-wanted/recalculate (cron, X-Cron-Token). */
    async function recalculateMostWanted(req, res) {
        res.set('Cache-Control', 'no-store');
        const expected = env.CRON_API_TOKEN;
        if (typeof expected !== 'string' || !expected.trim()) {
            return res.status(503).json({ success: false, error: 'El recálculo de Most Wanted no está configurado.' });
        }
        if (!safeTokenEqual(req.headers['x-cron-token'], expected)) {
            return res.status(401).json({ success: false, error: 'El token de cron no es válido.' });
        }
        try {
            return res.json({ success: true, ...(await runMostWantedCycle()) });
        } catch (err) {
            log.warn('[perfil] recálculo Most Wanted:', err.message);
            return res.status(502).json({ success: false, error: 'No pudimos recalcular Most Wanted.' });
        }
    }

    /** Job en proceso: primer ciclo a los minutos de arrancar y después periódico. */
    function startMostWantedJob() {
        const every = mostWantedIntervalMs(env);
        if (!every) return () => {};
        const tick = () => {
            runMostWantedCycle().catch((err) => log.warn('[perfil] job Most Wanted:', err.message));
        };
        const first = setTimeout(tick, MOST_WANTED_FIRST_RUN_MS);
        const timer = setInterval(tick, every);
        for (const handle of [first, timer]) if (handle && typeof handle.unref === 'function') handle.unref();
        return () => { clearTimeout(first); clearInterval(timer); };
    }

    return {
        serveProfile,
        serveShortUrl,
        recordShare,
        recalculateMostWanted,
        runMostWantedCycle,
        notifyPendingAwards,
        startMostWantedJob,
        clearCache: () => cache.clear()
    };
}

/**
 * Registra las rutas. Tiene que ir ANTES de express.static: si no, el
 * estático sirve el HTML sin meta (y redirige /artist/profile a /artist/profile/).
 */
function register(app, deps = {}) {
    const routes = createProfileRoutes(deps);
    // Una ruta por path (no un array): el banner de arranque y otras herramientas
    // asumen que layer.route.path es un string.
    for (const p of ['/artist/profile', '/artist/profile/', '/artist/profile/index.html']) {
        app.get(p, routes.serveProfile);
    }
    const shareLimiter = rateLimit({
        windowMs: SHARE_WINDOW_MS,
        limit: SHARE_MAX_PER_WINDOW,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, rate_limited: true, error: 'Demasiados compartidos seguidos. Intenta de nuevo en unos minutos.' }
    });
    app.post('/api/artist/profile-share', shareLimiter, express.json({ limit: '4kb' }), routes.recordShare);
    app.post('/api/perfil/most-wanted/recalculate', routes.recalculateMostWanted);
    app.get('/:handle', routes.serveShortUrl);
    // Solo el proceso principal arranca el job (los tests registran sin él).
    if (deps.startJob === true) routes.stopMostWantedJob = routes.startMostWantedJob();
    return routes;
}

module.exports = { register, createProfileRoutes, resolveAppBase, hashIp, mostWantedIntervalMs };
