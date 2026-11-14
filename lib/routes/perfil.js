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
// ===========================================================================

const fs = require('node:fs');
const path = require('node:path');
const PublicUrl = require('../../public/shared/js/artist-public-url.js');
const ProfileMeta = require('../profile-meta');
const { reservedHandles, existsInPublic } = require('../reserved-handles');
const { ArtistsPublicRepo } = require('../repos/artists-public');

const PROFILE_HTML = path.join('artist', 'profile', 'index.html');
const FOUND_TTL_MS = 60 * 1000;
const MISSING_TTL_MS = 30 * 1000;
const CACHE_MAX = 500;

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

function createProfileRoutes(deps = {}) {
    const publicDir = deps.publicDir || path.join(__dirname, '..', '..', 'public');
    const repo = deps.repo || ArtistsPublicRepo;
    const env = deps.env || process.env;
    const now = deps.now || Date.now;
    const loadTemplate = deps.loadTemplate || createTemplateLoader(path.join(publicDir, PROFILE_HTML));
    const cache = createLookupCache(now);

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
        const prefs = await loadPrefs(artist.user_id);
        const canonicalUrl = PublicUrl.publicProfileUrl(artist.username, base, { reserved });
        const meta = ProfileMeta.buildArtistMeta({
            artist,
            prefs,
            canonicalUrl,
            defaultImage: base + ProfileMeta.DEFAULT_IMAGE_PATH
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

    return { serveProfile, serveShortUrl, clearCache: () => cache.clear() };
}

/**
 * Registra las rutas. Tiene que ir ANTES de express.static: si no, el
 * estático sirve el HTML sin meta (y redirige /artist/profile a /artist/profile/).
 */
function register(app, deps = {}) {
    const routes = createProfileRoutes(deps);
    app.get(['/artist/profile', '/artist/profile/', '/artist/profile/index.html'], routes.serveProfile);
    app.get('/:handle', routes.serveShortUrl);
    return routes;
}

module.exports = { register, createProfileRoutes, resolveAppBase };
