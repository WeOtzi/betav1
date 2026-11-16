'use strict';

// ── sesiones ── Confirmación del cliente, cambios acordados, ubicación, registro
// y disputas de sesiones (ronda 2 · P28 y P27-sesión).
// Registro: require('./lib/routes/sesiones').register(app, { gcalService }) en server.js.
//
// Cliente o artista de la cotización (Bearer):
//   GET  /api/sesiones/quotations/:quoteId            sesiones con su estado y lo que cada uno puede hacer
//   POST /api/sesiones/:sessionId/change-requests     pedir un cambio { proposed_date, note, [duration_hours, location…] }
//   POST /api/sesiones/change-requests/:id/respond    la OTRA parte acepta o rechaza { decision, note }
//   POST /api/sesiones/change-requests/:id/withdraw   quien lo pidió lo retira
//   POST /api/sesiones/:sessionId/feedback            calificación + registro de una sesión pasada { rating, note }
//   POST /api/sesiones/:sessionId/dispute             pedir una disputa a soporte { reason, description }
// Cliente:
//   GET  /api/sesiones/mine                           todas sus sesiones (panel "Mis sesiones")
//   POST /api/sesiones/:sessionId/confirm             confirmar la sesión propuesta
// Artista:
//   GET  /api/sesiones/locations[?quote=<quote_id>]   dónde puede hacerse la sesión (sedes, propias, la del cliente)
//
// El servidor identifica al actor por el Bearer y llama a las RPC service-role
// de la migración 20261116150000 (que vuelven a validar rol, 3 días, sesiones
// pasadas y acuerdo). Los correos salen después de guardar y nunca rompen la
// acción. Límite propio para las escrituras (no comparte authLimiter): 120 cada
// 15 min por IP; pedir o retirar un cambio, que avisa por correo y push a la
// otra parte, 20. La base además corta en 6 pedidos por sesión, por persona y
// por día (CHANGE_LIMIT).

const Sesiones = require('../sesiones');
const { SessionsRepo } = require('../repos/sesiones');
const { resolveBearerUser } = require('../auth/supabase-auth');

const { Model, httpError } = Sesiones;

const CHANGE_REQUESTS_PER_WINDOW = 20;

function writeLimiter(max = 120) {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiadas acciones seguidas. Prueba de nuevo en unos minutos.' },
    });
}

// Solo los errores propios (expose) llegan al navegador con su texto.
function sendError(res, err, fallback) {
    const mapped = Sesiones.mapDbError(err);
    const exposed = !!(mapped && mapped.expose);
    const status = exposed && mapped.status >= 400 && mapped.status < 600 ? mapped.status : 500;
    if (!exposed || (status >= 500 && status !== 503)) console.error('[sesiones]', fallback, mapped && (mapped.code || mapped.message));
    return res.status(status).json({
        success: false,
        code: exposed && mapped.code ? mapped.code : undefined,
        error: exposed ? mapped.message : fallback,
    });
}

function register(app, deps = {}) {
    const repo = deps.repo || SessionsRepo;
    const resolveUser = deps.resolveUser || resolveBearerUser;
    const gcalService = deps.gcalService || null;
    const limiter = typeof deps.limiter === 'function' ? deps.limiter : writeLimiter();
    const changeLimiter = typeof deps.changeLimiter === 'function' ? deps.changeLimiter
        : (typeof deps.limiter === 'function' ? deps.limiter : writeLimiter(CHANGE_REQUESTS_PER_WINDOW));
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const log = deps.log || console;
    const sendEmail = typeof deps.sendEmail === 'function'
        ? deps.sendEmail
        : (eventId, payload, options) => (deps.emailService || require('../../services/email-service')).sendEmail(eventId, payload, options);
    const baseOf = (req) => deps.baseUrl || require('../../services/email-request-context').applicationBase(req);

    async function requireUser(req) {
        const user = await resolveUser(req);
        if (!user || !user.id) throw httpError(401, 'Inicia sesión para continuar.', 'unauthenticated');
        return user;
    }

    // Sesión + cotización + rol del usuario. 404 si no existe, 403 si no es parte.
    async function sessionContext(req, sessionId) {
        const user = await requireUser(req);
        if (!Sesiones.isUuid(sessionId)) throw httpError(400, 'Sesión no válida.', 'invalid_session');
        const session = await repo.getSession(sessionId);
        if (!session) throw httpError(404, 'No encontramos esa sesión.', 'not_found');
        const quote = await repo.getQuoteById(session.quotation_id);
        const role = Sesiones.roleFor(quote, user.id);
        if (!role) throw httpError(403, 'Esta sesión no corresponde a tu cuenta.', 'forbidden');
        return { user, session, quote, role };
    }

    function requestGcalSync(artistId) {
        if (!artistId || !gcalService || typeof gcalService.requestSync !== 'function') return;
        Promise.resolve().then(() => gcalService.requestSync(artistId)).catch(() => null);
    }

    // Corre un aviso sin bloquear la respuesta ni romper la acción ya guardada.
    function inBackground(label, task) {
        Promise.resolve().then(task).then((result) => {
            if (result && result.ok === false && !result.skipped) log.warn?.(`[sesiones] ${label}:`, result.error || 'no enviado');
        }).catch((error) => log.warn?.(`[sesiones] ${label}:`, error && error.message));
    }

    async function payloadFor(req, quote, session, extra) {
        // El código corto se pide aparte (la columna puede no existir todavía): los
        // correos muestran ese código y no el quote_id interno (CF-03).
        const [artist, shortCode] = await Promise.all([
            quote && quote.artist_id ? Promise.resolve(repo.getArtist(quote.artist_id)).catch(() => null) : null,
            quote && quote.id != null && !quote.short_code && typeof repo.getShortCode === 'function'
                ? Promise.resolve().then(() => repo.getShortCode(quote.id)).catch(() => null) : null,
        ]);
        const coded = shortCode ? Object.assign({}, quote, { short_code: shortCode }) : quote;
        return Sesiones.emailPayload(coded, artist, session, Object.assign({ app_base_url: baseOf(req) }, extra || {}));
    }

    // Pedidos de cambio, registros y disputas de un lote de sesiones (4 consultas en total).
    async function relatedFor(sessions) {
        const ids = (sessions || []).map((s) => s.id);
        if (!ids.length) return { pending: [], recent: [], feedback: [], disputes: [] };
        const [pending, recent, feedback, disputes] = await Promise.all([
            repo.listPendingRequests(ids), repo.listRecentRequests(ids), repo.listFeedback(ids), repo.listDisputes(ids),
        ]);
        return { pending, recent, feedback, disputes };
    }

    function viewsFor(quote, sessions, role, related) {
        if (!sessions || !sessions.length) return [];
        return Sesiones.buildSessionViews(Object.assign({}, related, {
            sessions, quote, role, now: now(),
            disputeActive: (quote.dispute_status || 'none') === 'open',
        }));
    }

    // ---------------------------------------------------------------- lecturas
    app.get('/api/sesiones/mine', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await requireUser(req);
            const quotes = (await repo.listQuotesForClient(user.id)) || [];
            const sessions = quotes.length ? await repo.listSessionsByQuotationIds(quotes.map((q) => q.id)) : [];
            const byQuote = new Map();
            for (const session of sessions) {
                const key = String(session.quotation_id);
                if (!byQuote.has(key)) byQuote.set(key, []);
                byQuote.get(key).push(session);
            }
            const related = await relatedFor(sessions);
            const out = [];
            for (const quote of quotes) {
                const own = byQuote.get(String(quote.id));
                if (!own || !own.length) continue;
                const summary = Sesiones.quoteView(quote, 'client');
                for (const view of viewsFor(quote, own, 'client', related)) out.push(Object.assign(view, { quote: summary }));
            }
            return res.json({
                success: true, role: 'client', edit_window_days: Model.EDIT_WINDOW_DAYS,
                sessions: Model.sortForPanel(out, now()),
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos cargar tus sesiones.');
        }
    });

    app.get('/api/sesiones/quotations/:quoteId', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await requireUser(req);
            if (!Sesiones.QUOTE_ID_RE.test(String(req.params.quoteId || ''))) throw httpError(400, 'Cotización no válida.', 'invalid_quote');
            const quote = await repo.getQuoteByQuoteId(req.params.quoteId);
            if (!quote) throw httpError(404, 'No encontramos esa cotización.', 'not_found');
            const role = Sesiones.roleFor(quote, user.id);
            if (!role) throw httpError(403, 'Esta cotización no corresponde a tu cuenta.', 'forbidden');
            const sessions = (await repo.listSessionsByQuotation(quote.id)) || [];
            return res.json({
                success: true, role, edit_window_days: Model.EDIT_WINDOW_DAYS,
                quote: Sesiones.quoteView(quote, role),
                sessions: viewsFor(quote, sessions, role, await relatedFor(sessions)),
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos cargar las sesiones.');
        }
    });

    app.get('/api/sesiones/locations', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await requireUser(req);
            const artist = await repo.getArtist(user.id);
            if (!artist) throw httpError(403, 'Esta sección es para artistas.', 'forbidden');
            let rawQuote = null;
            const quoteId = String(req.query.quote || '').trim();
            if (quoteId) {
                if (!Sesiones.QUOTE_ID_RE.test(quoteId)) throw httpError(400, 'Cotización no válida.', 'invalid_quote');
                const quote = await repo.getQuoteByQuoteId(quoteId);
                if (!quote || Sesiones.roleFor(quote, user.id) !== 'artist') throw httpError(403, 'Esta cotización no corresponde a tu cuenta.', 'forbidden');
                rawQuote = await repo.getQuoteRaw(quote.id).catch(() => null);
            }
            const [roster, artistLocations] = await Promise.all([
                repo.listRoster(user.id).catch(() => []),
                repo.listArtistLocations(user.id).catch(() => []),
            ]);
            const preferred = Sesiones.clientPreferredLocation(rawQuote);
            // preferred.id = la sede que eligió el cliente (preferred_location_ref de cot-form
            // cuando el tipo es 'studio_location'). Los otros tipos no son sedes: no se buscan aquí.
            const isSede = preferred && preferred.id && (!preferred.kind || preferred.kind === 'studio_location');
            const preferredLocation = isSede ? await repo.getStudioLocation(preferred.id).catch(() => null) : null;
            const studioIds = [...new Set([
                ...(roster || []).map((r) => r.studio_id),
                ...(artistLocations || []).map((l) => l.studio_id),
                preferredLocation && preferredLocation.studio_id,
                preferred && preferred.studio_id,
            ].filter(Boolean).map(String))];
            const [studios, studioLocations] = studioIds.length
                ? await Promise.all([repo.listStudios(studioIds), repo.listStudioLocations(studioIds)])
                : [[], []];
            const options = Sesiones.buildLocationOptions({
                roster, studios, studioLocations, artistLocations, artist,
                quote: rawQuote, preferredStudioLocation: preferredLocation,
            });
            return res.json({ success: true, options, default_key: options.length ? options[0].key : null });
        } catch (err) {
            return sendError(res, err, 'No pudimos cargar tus ubicaciones.');
        }
    });

    // ---------------------------------------------------------------- cliente
    app.post('/api/sesiones/:sessionId/confirm', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { user, quote } = await sessionContext(req, req.params.sessionId);
            const result = await repo.confirm(req.params.sessionId, user.id);
            if (!result || !result.already) {
                const fresh = await repo.getSession(req.params.sessionId);
                const payload = await payloadFor(req, quote, fresh);
                inBackground('session_confirmed_by_client', () => sendEmail('session_confirmed_by_client', payload,
                    { idempotencyKey: `sesion:${fresh.id}:confirmed:${fresh.client_confirmed_at || ''}`, actorUserId: user.id }));
                requestGcalSync(quote.artist_id);
            }
            return res.json({ success: true, already: !!(result && result.already), client_confirmation: 'confirmed' });
        } catch (err) {
            return sendError(res, err, 'No pudimos confirmar la sesión.');
        }
    });

    // ---------------------------------------------------------------- ambas partes
    app.post('/api/sesiones/:sessionId/change-requests', changeLimiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { user, quote, role } = await sessionContext(req, req.params.sessionId);
            const proposal = Sesiones.parseChangeBody(req.body, role, now());
            const result = await repo.requestChange(req.params.sessionId, user.id, proposal);
            const [request, fresh] = await Promise.all([
                repo.getRequest(result.request_id), repo.getSession(req.params.sessionId),
            ]);
            const payload = await payloadFor(req, quote, fresh, {
                requested_by_role: role,
                proposed_date: request && request.proposed_date,
                proposed_duration_hours: request && request.proposed_duration_hours,
                proposed_location: request && request.proposed_location,
                change_note: request && request.note,
            });
            inBackground('session_change_requested', () => sendEmail('session_change_requested', payload,
                { idempotencyKey: `sesion:${fresh.id}:change:${result.request_id}`, actorUserId: user.id }));
            return res.status(201).json({
                success: true, request_id: result.request_id, client_confirmation: result.client_confirmation,
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos enviar el pedido de cambio.');
        }
    });

    async function requestContext(req) {
        const user = await requireUser(req);
        if (!Sesiones.isUuid(req.params.requestId)) throw httpError(400, 'Solicitud no válida.', 'invalid_request');
        const request = await repo.getRequest(req.params.requestId);
        if (!request) throw httpError(404, 'No encontramos esa solicitud.', 'not_found');
        const quote = await repo.getQuoteById(request.quotation_id);
        const role = Sesiones.roleFor(quote, user.id);
        if (!role) throw httpError(403, 'Esta solicitud no corresponde a tu cuenta.', 'forbidden');
        return { user, request, quote, role };
    }

    app.post('/api/sesiones/change-requests/:requestId/respond', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { user, request, quote } = await requestContext(req);
            const decision = Sesiones.parseRespondBody(req.body);
            const result = await repo.respondChange(request.id, user.id, decision.accept, decision.note);
            const fresh = await repo.getSession(request.session_id);
            const payload = await payloadFor(req, quote, fresh, {
                decision: decision.accept ? 'accepted' : 'rejected',
                requested_by_role: request.requested_by_role,
                response_note: decision.note,
            });
            inBackground('session_change_resolved', () => sendEmail('session_change_resolved', payload,
                { idempotencyKey: `sesion:${request.session_id}:change:${request.id}:resolved`, actorUserId: user.id }));
            if (decision.accept) requestGcalSync(quote.artist_id);
            return res.json({
                success: true, accepted: decision.accept,
                client_confirmation: result && result.client_confirmation, date_changed: !!(result && result.date_changed),
            });
        } catch (err) {
            return sendError(res, err, 'No pudimos guardar tu respuesta.');
        }
    });

    app.post('/api/sesiones/change-requests/:requestId/withdraw', changeLimiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { user, request, quote } = await requestContext(req);
            const result = await repo.withdrawChange(request.id, user.id);
            const fresh = await repo.getSession(request.session_id);
            const payload = await payloadFor(req, quote, fresh, { decision: 'withdrawn', requested_by_role: request.requested_by_role });
            inBackground('session_change_resolved', () => sendEmail('session_change_resolved', payload,
                { idempotencyKey: `sesion:${request.session_id}:change:${request.id}:resolved`, actorUserId: user.id }));
            return res.json({ success: true, client_confirmation: result && result.client_confirmation });
        } catch (err) {
            return sendError(res, err, 'No pudimos retirar el pedido.');
        }
    });

    app.post('/api/sesiones/:sessionId/feedback', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { user, session, quote, role } = await sessionContext(req, req.params.sessionId);
            const feedback = Sesiones.parseFeedbackBody(req.body);
            const result = await repo.saveFeedback(session.id, user.id, feedback.rating, feedback.note);
            if (result && result.created) {
                const payload = await payloadFor(req, quote, session, { author_role: role });
                inBackground('session_feedback_received', () => sendEmail('session_feedback_received', payload,
                    { idempotencyKey: `sesion:${session.id}:feedback:${role}`, actorUserId: user.id }));
            }
            return res.json({ success: true, created: !!(result && result.created), rating: feedback.rating });
        } catch (err) {
            return sendError(res, err, 'No pudimos guardar tu registro.');
        }
    });

    app.post('/api/sesiones/:sessionId/dispute', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const { user, session, quote, role } = await sessionContext(req, req.params.sessionId);
            const parsed = Sesiones.parseDisputeBody(req.body);
            const texts = Sesiones.disputeTexts(session, quote, parsed, role);
            const result = await repo.openDispute(session.id, user.id, {
                reason: parsed.reason, subject: texts.subject, description: texts.description, desired_outcome: 'mediacion',
            });
            const base = baseOf(req);
            const payload = await payloadFor(req, quote, session, {
                opened_by_role: role,
                dispute_reason_label: Model.disputeReasonLabel(parsed.reason),
                ticket_number: result && result.ticket_number,
            });
            const key = `sesion:${session.id}:dispute:${(result && result.ticket_id) || ''}`;
            inBackground('session_dispute_opened', () => sendEmail('session_dispute_opened', payload, { idempotencyKey: key, actorUserId: user.id }));
            inBackground('session_dispute_support', async () => {
                const supportEmail = process.env.SUPPORT_EMAIL || '';
                const supportEmails = supportEmail || typeof repo.activeSupportEmails !== 'function' ? [] : await repo.activeSupportEmails();
                if (!supportEmail && !supportEmails.length) return { ok: true, skipped: true };
                return sendEmail('session_dispute_support', Object.assign({}, payload, {
                    support_email: supportEmail, support_emails: supportEmails,
                    dispute_description: parsed.description, queue_url: `${base}/support/dashboard#disputas`,
                }), { idempotencyKey: `${key}:support` });
            });
            return res.status(201).json({ success: true, ticket_number: result && result.ticket_number });
        } catch (err) {
            return sendError(res, err, 'No pudimos registrar la disputa.');
        }
    });
}

module.exports = { register, sendError };
