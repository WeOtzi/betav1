'use strict';

// ===========================================================================
// Rutas del frente cot-detalle (ronda 2): información del detalle de la
// cotización del artista, exportación y enlace público.
// Se registran con UNA línea en server.js (antes de la URL corta de perfiles
// y de express.static):
//   require('./lib/routes/cot-detalle').register(app, { publicDir });
//
// Artista (Bearer; siempre se verifica que la cotización sea suya):
//   GET    /api/cot-detalle/quotations/:quoteId/info
//          Contacto del cliente según la regla [P20/P23] (verificado y no
//          rechazada; manual siempre), si el cliente está registrado y el
//          estado de los enlaces públicos.
//   GET    /api/cot-detalle/quotations/:quoteId/client-profile   [P6]
//   GET    /api/cot-detalle/quotations/:quoteId/sheet            [P30] hoja para PDF / imagen
//   POST   /api/cot-detalle/quotations/:quoteId/share  { days }  [P30] crea un enlace
//   DELETE /api/cot-detalle/quotations/:quoteId/share[?id=]      [P30] revoca
//
// Público (token en la ruta, límite propio):
//   GET    /api/cot-detalle/public/:token          hoja de la cotización
//   POST   /api/cot-detalle/public/:token/claim    vincula la cotización a la cuenta (Bearer)
//   GET    /cotizacion/:token                      página pública
//
// La lógica vive en lib/cot-detalle.js; los datos, en lib/repos/cot-detalle.js.
// ===========================================================================

const path = require('node:path');
const logic = require('../cot-detalle');

const LINKED_EVENT = 'shared_quotation_linked';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Dependencias por defecto, cargadas solo si el llamador no las inyecta (tests).
const DEFAULTS = {
    resolveBearerUser: () => require('../auth/supabase-auth').resolveBearerUser,
    repo: () => require('../repos/cot-detalle').CotDetalleRepo,
    emailService: () => require('../../services/email-service'),
    applicationBase: () => require('../../services/email-request-context').applicationBase,
    reservedHandles: () => {
        const { reservedHandles } = require('../reserved-handles');
        return (publicDir) => reservedHandles(publicDir);
    },
    logger: () => console,
    now: () => () => Date.now()
};

function publicLimiter() {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiados intentos. Vuelve a probar en unos minutos.' }
    });
}

function shareLimiter() {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 40,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Creaste muchos enlaces seguidos. Vuelve a probar en unos minutos.' }
    });
}

function isMissingRelation(error) {
    const text = String((error && error.message) || '');
    return /42P01|PGRST205|PGRST202|does not exist|schema cache|Could not find/i.test(text);
}

function createHandlers(overrides = {}) {
    const deps = {};
    for (const key of Object.keys(DEFAULTS)) deps[key] = overrides[key] !== undefined ? overrides[key] : DEFAULTS[key]();
    const publicDir = overrides.publicDir || path.join(__dirname, '..', '..', 'public');
    const log = deps.logger || console;
    const repo = deps.repo;

    function send(res, status, body) {
        res.set('Cache-Control', 'no-store');
        return res.status(status).json(body);
    }

    function fail(res, verdict) {
        return send(res, verdict.status || 400, { success: false, code: verdict.code || null, error: verdict.error });
    }

    function baseOf(req) {
        try { return String(deps.applicationBase(req) || '').replace(/\/+$/, ''); } catch (_) { return ''; }
    }

    function reserved() {
        try { return deps.reservedHandles(publicDir); } catch (_) { return undefined; }
    }

    /** Usuario + cotización del artista que llama, o responde el error. */
    async function artistQuote(req, res) {
        const quoteId = String((req.params && req.params.quoteId) || '').trim();
        if (!logic.isValidQuoteId(quoteId)) {
            send(res, 400, { success: false, code: 'quote_id', error: 'La cotización no es válida.' });
            return null;
        }
        const user = await Promise.resolve(deps.resolveBearerUser(req)).catch(() => null);
        if (!user || !user.id) {
            send(res, 401, { success: false, code: 'auth', error: 'Inicia sesión para ver esta cotización.' });
            return null;
        }
        const quote = await repo.getQuote(quoteId);
        if (!quote || String(quote.artist_id || '').toLowerCase() !== String(user.id).toLowerCase()) {
            send(res, 404, { success: false, code: 'not_found', error: 'No encontramos esa cotización en tu cuenta.' });
            return null;
        }
        return { user, quote };
    }

    async function loadLinks(quotationId) {
        try {
            return { available: true, rows: (await repo.listLinks(quotationId)) || [] };
        } catch (error) {
            // Migración 20261116130000 sin aplicar: el resto del detalle sigue andando.
            if (isMissingRelation(error)) return { available: false, rows: [] };
            throw error;
        }
    }

    async function sheetFor(req, quote, link) {
        const [manual, artist, sessions] = await Promise.all([
            logic.isManual(quote) ? Promise.resolve(repo.getManualQuote(quote.quote_id)).catch(() => null) : null,
            Promise.resolve(repo.getArtist(quote.artist_id)).catch(() => null),
            Promise.resolve(repo.listSessions(quote.id)).catch(() => [])
        ]);
        return logic.buildSheet({ quote, manual, artist, sessions, link, base: baseOf(req), reserved: reserved(), now: deps.now() });
    }

    // ------------------------------------------------------------ artista

    async function info(req, res) {
        try {
            const ctx = await artistQuote(req, res);
            if (!ctx) return undefined;
            const [artist, links] = await Promise.all([repo.getArtist(ctx.user.id), loadLinks(ctx.quote.id)]);
            const now = deps.now();
            return send(res, 200, {
                success: true,
                quote_id: ctx.quote.quote_id,
                manual: logic.isManual(ctx.quote),
                contact: logic.contactResponse({ quote: ctx.quote, artist }),
                client: { registered: !!ctx.quote.client_user_id },
                share: {
                    available: links.available,
                    shareable: logic.shareVerdict({ user: ctx.user, quote: ctx.quote }).ok,
                    links: logic.activeLinks(links.rows, now).map((l) => logic.linkSummary(l, now)),
                    max_active: logic.MAX_ACTIVE_LINKS,
                    days: logic.SHARE_DAYS,
                    default_days: logic.DEFAULT_SHARE_DAYS
                }
            });
        } catch (error) {
            log.error('[cot-detalle] info:', error && error.message);
            return send(res, 500, { success: false, error: 'No pudimos cargar los datos de la cotización.' });
        }
    }

    async function clientProfile(req, res) {
        try {
            const ctx = await artistQuote(req, res);
            if (!ctx) return undefined;
            const clientId = ctx.quote.client_user_id;
            if (!clientId) {
                return send(res, 404, { success: false, code: 'not_registered', error: 'Este cliente todavía no tiene cuenta en We Ötzi.' });
            }
            const soft = (promise, fallback) => Promise.resolve(promise).catch((error) => {
                log.warn('[cot-detalle] perfil del cliente (parcial):', error && error.message);
                return fallback;
            });
            const [client, profile, quotes, reviews] = await Promise.all([
                soft(repo.getClient(clientId), null),
                soft(repo.getClientProfile(clientId), null),
                soft(repo.listQuotesBetween(ctx.user.id, clientId), []),
                soft(repo.listClientReviews(clientId), { rows: [], count: 0 })
            ]);
            const sessions = await soft(repo.listSessionsForQuotations((quotes || []).map((q) => q.id)), []);
            return send(res, 200, {
                success: true,
                profile: logic.clientProfile({
                    client, profile, quote: ctx.quote, quotes, sessions,
                    reviews: reviews && reviews.rows, reviewsCount: reviews && reviews.count
                })
            });
        } catch (error) {
            log.error('[cot-detalle] client-profile:', error && error.message);
            return send(res, 500, { success: false, error: 'No pudimos cargar el perfil del cliente.' });
        }
    }

    async function sheet(req, res) {
        try {
            const ctx = await artistQuote(req, res);
            if (!ctx) return undefined;
            const verdict = logic.shareVerdict({ user: ctx.user, quote: ctx.quote });
            if (!verdict.ok) return fail(res, verdict);
            return send(res, 200, { success: true, sheet: await sheetFor(req, ctx.quote, null) });
        } catch (error) {
            log.error('[cot-detalle] sheet:', error && error.message);
            return send(res, 500, { success: false, error: 'No pudimos preparar la cotización para exportar.' });
        }
    }

    async function createShare(req, res) {
        try {
            const ctx = await artistQuote(req, res);
            if (!ctx) return undefined;
            const verdict = logic.shareVerdict({ user: ctx.user, quote: ctx.quote });
            if (!verdict.ok) return fail(res, verdict);
            const now = deps.now();
            const links = await loadLinks(ctx.quote.id);
            if (!links.available) {
                return send(res, 503, { success: false, code: 'unavailable', error: 'Los enlaces públicos todavía no están disponibles.' });
            }
            if (logic.activeLinks(links.rows, now).length >= logic.MAX_ACTIVE_LINKS) {
                return send(res, 409, {
                    success: false, code: 'too_many',
                    error: `Ya tienes ${logic.MAX_ACTIVE_LINKS} enlaces activos para esta cotización. Desactívalos desde «Gestionar enlace» para crear uno nuevo.`
                });
            }
            const token = logic.newShareToken();
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const saved = await repo.insertLink({
                quotation_id: ctx.quote.id,
                quote_id: ctx.quote.quote_id,
                artist_id: ctx.user.id,
                token_hash: logic.hashToken(token),
                created_at: new Date(now).toISOString(),
                expires_at: logic.shareExpiry(body.days, now)
            });
            if (!saved) throw new Error('El enlace no se guardó.');
            log.log(`[cot-detalle] ${ctx.user.id} creó un enlace público de ${ctx.quote.quote_id}`);
            // El token solo viaja en esta respuesta: en la base queda su hash.
            return send(res, 201, { success: true, url: logic.shareUrl(baseOf(req), token), link: logic.linkSummary(saved, now) });
        } catch (error) {
            log.error('[cot-detalle] share:', error && error.message);
            return send(res, 500, { success: false, error: 'No pudimos crear el enlace. Vuelve a intentarlo.' });
        }
    }

    async function revokeShare(req, res) {
        try {
            const ctx = await artistQuote(req, res);
            if (!ctx) return undefined;
            const id = String((req.query && req.query.id) || '').trim();
            if (id && !UUID_RE.test(id)) return send(res, 400, { success: false, code: 'link_id', error: 'El enlace no es válido.' });
            const rows = await repo.revokeLinks(ctx.quote.id, { id: id || null, at: new Date(deps.now()).toISOString() });
            const revoked = Array.isArray(rows) ? rows.length : 0;
            if (revoked) log.log(`[cot-detalle] ${ctx.user.id} revocó ${revoked} enlace(s) de ${ctx.quote.quote_id}`);
            return send(res, 200, { success: true, revoked });
        } catch (error) {
            if (isMissingRelation(error)) return send(res, 200, { success: true, revoked: 0 });
            log.error('[cot-detalle] revoke:', error && error.message);
            return send(res, 500, { success: false, error: 'No pudimos revocar el enlace. Vuelve a intentarlo.' });
        }
    }

    // ------------------------------------------------------------ público

    const GONE = {
        expired: 'Este enlace venció. Pídele uno nuevo a tu artista.',
        revoked: 'Tu artista desactivó este enlace. Pídele uno nuevo.'
    };

    /** Enlace vigente + su cotización, o responde 404 / 410. */
    async function publicContext(req, res) {
        const token = String((req.params && req.params.token) || '');
        const notFound = () => {
            send(res, 404, { success: false, code: 'not_found', error: 'No encontramos esta cotización. Revisa que el enlace esté completo.' });
            return null;
        };
        if (!logic.isValidToken(token)) return notFound();
        const tokenHash = logic.hashToken(token);
        let link;
        try {
            link = await repo.findLinkByHash(tokenHash);
        } catch (error) {
            if (isMissingRelation(error)) return notFound();
            throw error;
        }
        if (!link) return notFound();
        const state = logic.linkState(link, deps.now());
        if (state !== 'active') {
            send(res, 410, { success: false, code: state, error: GONE[state] });
            return null;
        }
        const quote = await repo.getQuoteById(link.quotation_id);
        // El enlace muere si la cotización cambió de artista o volvió a borrador.
        if (!quote || !quote.artist_id || String(quote.artist_id).toLowerCase() !== String(link.artist_id).toLowerCase()
            || logic.isWizardDraft(quote)) return notFound();
        return { token, tokenHash, link, quote };
    }

    async function viewerOf(req, ctx) {
        const header = req.headers && (req.headers.authorization || req.headers.Authorization);
        if (!header) return { signed_in: false };
        const user = await Promise.resolve(deps.resolveBearerUser(req)).catch(() => null);
        if (!user || !user.id) return { signed_in: false };
        const isClientAccount = await Promise.resolve(repo.isClientAccount(user.id)).catch(() => false);
        const verdict = logic.claimVerdict({ user, quote: ctx.quote, link: ctx.link, isClientAccount, now: deps.now() });
        return {
            signed_in: true,
            linked: !!(verdict.ok && verdict.already),
            can_claim: !!(verdict.ok && verdict.claim),
            reason: verdict.ok ? null : verdict.code,
            message: verdict.ok ? null : verdict.error
        };
    }

    async function publicSheet(req, res) {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        try {
            const ctx = await publicContext(req, res);
            if (!ctx) return undefined;
            const [sheetData, viewer] = await Promise.all([sheetFor(req, ctx.quote, ctx.link), viewerOf(req, ctx)]);
            // La vista se cuenta sin bloquear ni romper la respuesta.
            Promise.resolve().then(() => repo.touchLink(ctx.tokenHash)).catch(() => {});
            return send(res, 200, { success: true, sheet: sheetData, viewer });
        } catch (error) {
            log.error('[cot-detalle] public:', error && error.message);
            return send(res, 500, { success: false, error: 'No pudimos cargar la cotización. Vuelve a intentarlo.' });
        }
    }

    async function notifyLinked(req, quote, user) {
        if (!quote.artist_email) return;
        try {
            const base = baseOf(req);
            await deps.emailService.sendEmail(LINKED_EVENT, {
                quote_id: quote.quote_id,
                artist_name: quote.artist_name || '',
                artist_email: quote.artist_email,
                client_name: quote.client_full_name || '',
                recipient_role: 'artist',
                recipient_email: quote.artist_email,
                recipient_user_id: quote.artist_id,
                recipient_name: quote.artist_name || '',
                quotation_url: `${base}/my-quotations/detail?quote=${encodeURIComponent(quote.quote_id)}`,
                chat_url: `${base}/artist/inbox?quote=${encodeURIComponent(quote.quote_id)}`
            }, { idempotencyKey: `cot-detalle:linked:${quote.quote_id}:${user.id}` });
        } catch (error) {
            log.warn('[cot-detalle] aviso de vínculo:', error && error.message);
        }
    }

    async function claim(req, res) {
        try {
            const ctx = await publicContext(req, res);
            if (!ctx) return undefined;
            const user = await Promise.resolve(deps.resolveBearerUser(req)).catch(() => null);
            const isClientAccount = user && user.id ? await repo.isClientAccount(user.id) : false;
            const verdict = logic.claimVerdict({ user, quote: ctx.quote, link: ctx.link, isClientAccount, now: deps.now() });
            if (!verdict.ok) return fail(res, verdict);
            const done = (already) => send(res, 200, {
                success: true, already, quote_id: ctx.quote.quote_id,
                dashboard_path: `/client/dashboard?quote=${encodeURIComponent(ctx.quote.quote_id)}`
            });
            if (verdict.already) return done(true);

            const extra = verdict.setEmail ? { client_email: String(user.email).trim().toLowerCase() } : {};
            const saved = await repo.claimQuote(ctx.quote.id, user.id, extra);
            if (!saved) {
                // Otra pestaña (o el vínculo por email) ganó la carrera.
                const fresh = await Promise.resolve(repo.getQuoteById(ctx.quote.id)).catch(() => null);
                if (fresh && String(fresh.client_user_id || '').toLowerCase() === String(user.id).toLowerCase()) return done(true);
                return send(res, 409, { success: false, code: 'claimed', error: 'Esta cotización ya está vinculada a otra cuenta.' });
            }
            await Promise.resolve(repo.markLinkClaimed(ctx.link.id, user.id, new Date(deps.now()).toISOString()))
                .catch((error) => log.warn('[cot-detalle] marca del enlace:', error && error.message));
            await notifyLinked(req, ctx.quote, user);
            log.log(`[cot-detalle] ${user.id} vinculó ${ctx.quote.quote_id} desde el enlace público`);
            return done(false);
        } catch (error) {
            log.error('[cot-detalle] claim:', error && error.message);
            return send(res, 500, { success: false, error: 'No pudimos vincular la cotización. Vuelve a intentarlo.' });
        }
    }

    /** GET /cotizacion/:token → página pública (el token lo lee el navegador). */
    function page(req, res) {
        res.set('Cache-Control', 'no-store');
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.set('Referrer-Policy', 'no-referrer');
        const valid = logic.isValidToken(String((req.params && req.params.token) || ''));
        return res.status(valid ? 200 : 404).sendFile(path.join(publicDir, 'cotizacion', 'index.html'));
    }

    return { info, clientProfile, sheet, createShare, revokeShare, publicSheet, claim, page };
}

function register(app, overrides = {}) {
    const handlers = createHandlers(overrides);
    const pub = typeof overrides.publicLimiter === 'function' ? overrides.publicLimiter : publicLimiter();
    const share = typeof overrides.shareLimiter === 'function' ? overrides.shareLimiter : shareLimiter();

    app.get('/api/cot-detalle/quotations/:quoteId/info', handlers.info);
    app.get('/api/cot-detalle/quotations/:quoteId/client-profile', handlers.clientProfile);
    app.get('/api/cot-detalle/quotations/:quoteId/sheet', handlers.sheet);
    app.post('/api/cot-detalle/quotations/:quoteId/share', share, handlers.createShare);
    app.delete('/api/cot-detalle/quotations/:quoteId/share', handlers.revokeShare);

    app.get('/api/cot-detalle/public/:token', pub, handlers.publicSheet);
    app.post('/api/cot-detalle/public/:token/claim', pub, handlers.claim);

    app.get('/cotizacion/:token', handlers.page);
    return handlers;
}

module.exports = { register, createHandlers, LINKED_EVENT };
