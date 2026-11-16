'use strict';

// ===========================================================================
// Rutas del frente "negociacion" (ronda 2).
// ---------------------------------------------------------------------------
//   GET  /api/negociacion/quotations/:quoteId[?as=client|artist]
//        Estado de la negociación para quien mira: permisos, valores
//        vigentes, propuesta pendiente, historial y si el acuerdo está
//        aprobado por ambas partes (agreement.approved).
//
//   POST /api/negociacion/quotations/:quoteId/proposals
//        { kind: 'counter' | 'amendment', changes: { campo: valor }, note?, as? }
//        counter   (P23) el CLIENTE propone cambios sobre la propuesta del
//                  artista: presupuesto, zona, tamaño, estilo, color, idea.
//        amendment (P25) cliente o artista proponen cambiar el acuerdo
//                  aprobado: precio, sesiones, anticipo, condiciones.
//        Reemplaza a la propuesta pendiente anterior y avisa a la contraparte.
//
//   POST /api/negociacion/quotations/:quoteId/proposals/:proposalId/:action
//        action = accept | reject | withdraw      { note?, as? }
//        accept   lo hace la contraparte: la base aplica los cambios en una
//                 transacción (contrapropuesta → cotización aprobada por
//                 ambas partes; enmienda → acuerdo actualizado, versión +1).
//        reject   la contraparte: no cambia nada.
//        withdraw quien propuso: no cambia nada.
//
// Todas exigen sesión (Bearer) y que el usuario sea parte de la cotización.
// Se registra con una línea en server.js:
//   require('./lib/routes/negociacion').register(app);
// ===========================================================================

const logic = require('../negociacion');

const Model = logic.Model;

// Dependencias por defecto, cargadas solo si el llamador no las inyecta (tests).
const DEFAULTS = {
    resolveBearerUser: () => require('../auth/supabase-auth').resolveBearerUser,
    repo: () => require('../repos/negotiation').NegotiationRepo,
    emailService: () => require('../../services/email-service'),
    applicationBase: () => require('../../services/email-request-context').applicationBase,
    runDecisionHooks: () => require('../cot-cliente').runClientDecisionHooks,
    logger: () => console,
    now: () => () => Date.now(),
};

// Límite propio para las escrituras (no comparte authLimiter): negociar son
// pocas acciones, pero cada una manda un correo.
function writeLimiter() {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 40,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiados cambios seguidos. Inténtalo de nuevo en unos minutos.' },
    });
}

function createHandlers(overrides = {}) {
    const deps = {};
    for (const key of Object.keys(DEFAULTS)) deps[key] = overrides[key] !== undefined ? overrides[key] : DEFAULTS[key]();
    const log = deps.logger || console;

    function send(res, verdict) {
        const body = { success: false, code: verdict.code || null, error: verdict.error };
        if (verdict.field) body.field = verdict.field;
        return res.status(verdict.status || 400).json(body);
    }

    // Pisos de una enmienda: lo ya cobrado, las sesiones ya agendadas y el
    // anticipo de la cotización manual. Solo se consultan con el acuerdo aprobado.
    async function loadExtras(quotation) {
        if (!Model.isAgreed(quotation)) return { paid: 0, sessionsUsed: 0, manualDepositPct: null };
        const [paid, sessionsUsed, manualDepositPct] = await Promise.all([
            Promise.resolve(deps.repo.paidTotal(quotation.id, Model.agreementCurrency(quotation))).catch(() => 0),
            Promise.resolve(deps.repo.activeSessions(quotation.id)).catch(() => 0),
            Promise.resolve(deps.repo.manualDepositPct(quotation.quote_id)).catch(() => null),
        ]);
        return { paid: paid || 0, sessionsUsed: sessionsUsed || 0, manualDepositPct };
    }

    async function notify(step, proposal, quotation, req) {
        try {
            const artist = await Promise.resolve(deps.repo.getArtist(quotation.artist_id)).catch(() => null);
            const mail = logic.emailFor({ step, proposal, quotation, artist, base: deps.applicationBase(req) });
            if (!mail) return { event: null, ok: false, skipped: true };
            const result = await deps.emailService.sendEmail(mail.eventId, mail.payload, { idempotencyKey: mail.idempotencyKey });
            return { event: mail.eventId, ok: !!(result && result.ok), skipped: !!(result && result.skipped) };
        } catch (err) {
            log.warn(`[negociacion] aviso ${step} falló:`, err && err.message);
            return { event: null, ok: false };
        }
    }

    async function state(req, res) {
        res.set('Cache-Control', 'no-store');
        const quoteId = logic.cleanQuoteId(req.params && req.params.quoteId);
        if (!quoteId) return res.status(400).json({ success: false, error: 'Falta la cotización.' });
        try {
            const user = await deps.resolveBearerUser(req);
            if (!user) return res.status(401).json({ success: false, code: 'auth', error: 'Inicia sesión para continuar.' });
            let quotation;
            let proposals;
            try {
                quotation = await deps.repo.getQuotation(quoteId);
                proposals = quotation ? await deps.repo.listProposals(quotation.id) : [];
            } catch (err) {
                // Migración sin aplicar: el panel no se muestra (no es un error para la persona).
                if (logic.isMissingSchema(err)) return res.json({ success: true, available: false });
                throw err;
            }
            const extras = quotation ? await loadExtras(quotation) : {};
            const verdict = logic.stateFor({
                user, quotation, proposals, extras, hint: logic.roleHint(req.query && req.query.as), now: deps.now(),
            });
            if (!verdict.ok) return send(res, verdict);
            return res.json(Object.assign({ success: true }, verdict.state));
        } catch (err) {
            log.error('[negociacion] estado:', err && err.message);
            return res.status(500).json({ success: false, error: 'No pudimos cargar la negociación. Inténtalo de nuevo en un momento.' });
        }
    }

    async function propose(req, res) {
        res.set('Cache-Control', 'no-store');
        const quoteId = logic.cleanQuoteId(req.params && req.params.quoteId);
        if (!quoteId) return res.status(400).json({ success: false, error: 'Falta la cotización.' });
        const body = logic.normalizeProposeBody(req.body);
        if (!body.ok) return send(res, body);
        try {
            const user = await deps.resolveBearerUser(req);
            if (!user) return res.status(401).json({ success: false, code: 'auth', error: 'Inicia sesión para continuar.' });
            const quotation = await deps.repo.getQuotation(quoteId);
            const extras = quotation ? await loadExtras(quotation) : {};
            const verdict = logic.evaluatePropose({
                user, quotation, kind: body.kind, changes: body.changes, hint: body.hint, extras, now: deps.now(),
            });
            if (!verdict.ok) return send(res, verdict);

            let proposal;
            try {
                proposal = await deps.repo.propose({
                    quotationId: quotation.id, actor: user.id, role: verdict.role, kind: body.kind,
                    changes: verdict.changes, note: body.note,
                });
            } catch (err) {
                const mapped = logic.dbError(err);
                if (!mapped.known) throw err;
                return send(res, mapped);
            }
            if (!proposal || !proposal.id) throw new Error('la base no devolvió la propuesta');

            const email = await notify('proposed', proposal, quotation, req);
            log.log(`[negociacion] ${user.id} (${verdict.role}) propuso ${body.kind} en ${quotation.quote_id}`);
            return res.json({
                success: true,
                proposal: logic.publicProposal(proposal),
                quote_id: quotation.quote_id,
                quote_status: quotation.quote_status,
                emails: [email],
            });
        } catch (err) {
            log.error('[negociacion] propuesta:', err && err.message);
            const mapped = logic.dbError(err);
            return res.status(mapped.status).json({ success: false, code: mapped.code, error: mapped.error });
        }
    }

    async function resolve(req, res) {
        res.set('Cache-Control', 'no-store');
        const quoteId = logic.cleanQuoteId(req.params && req.params.quoteId);
        const proposalId = String((req.params && req.params.proposalId) || '').trim();
        if (!quoteId || !logic.isUuid(proposalId)) return res.status(400).json({ success: false, error: 'Falta la propuesta.' });
        const body = logic.normalizeResolveBody(req.params && req.params.action, req.body);
        if (!body.ok) return send(res, body);
        try {
            const user = await deps.resolveBearerUser(req);
            if (!user) return res.status(401).json({ success: false, code: 'auth', error: 'Inicia sesión para continuar.' });
            const quotation = await deps.repo.getQuotation(quoteId);
            if (!quotation) return res.status(404).json({ success: false, code: 'not_found', error: 'No encontramos esa cotización.' });
            const role = Model.roleOf(quotation, user.id, body.hint);
            if (!role) return res.status(403).json({ success: false, code: 'not_party', error: 'Esta cotización no corresponde a tu cuenta.' });
            const proposal = await deps.repo.getProposal(proposalId);
            const verdict = Model.evaluateResolve({ proposal, quotation, role, action: body.action });
            if (!verdict.ok) return send(res, verdict);
            if (verdict.already) {
                return res.json({
                    success: true, already: true, proposal: logic.publicProposal(proposal),
                    quote_id: quotation.quote_id, quote_status: quotation.quote_status, agreement: Model.agreementOf(quotation),
                });
            }

            let result;
            try {
                result = await deps.repo.resolve({ proposalId, actor: user.id, action: body.action, note: body.note });
            } catch (err) {
                const mapped = logic.dbError(err);
                if (!mapped.known) throw err;
                return send(res, mapped);
            }
            const saved = (result && result.proposal) || null;
            if (!saved) throw new Error('la base no devolvió la propuesta');

            // Al aceptar cambia la cotización: se relee para el aviso y la respuesta.
            const fresh = body.action === 'accept'
                ? (await Promise.resolve(deps.repo.getQuotation(quoteId)).catch(() => null)) || quotation
                : quotation;

            let email = null;
            if (!result.already) {
                const step = body.action === 'accept' ? 'accepted' : body.action === 'reject' ? 'rejected' : 'withdrawn';
                email = await notify(step, saved, fresh, req);
                // Contrapropuesta aceptada = cotización aprobada: mismo hook que
                // la aceptación del cliente (frente turnos). No cambia la respuesta.
                if (body.action === 'accept' && saved.kind === 'counter') {
                    const sessions = await Promise.resolve(deps.repo.listScheduledSessions(fresh.id)).catch(() => []) || [];
                    await Promise.resolve(deps.runDecisionHooks({
                        decision: 'approve', status: fresh.quote_status, quotation: fresh,
                        userId: fresh.client_user_id, sessions, via: 'counter_accepted',
                    }, log)).catch((err) => log.warn('[negociacion] hooks:', err && err.message));
                }
            }

            log.log(`[negociacion] ${user.id} (${role}) ${body.action} ${saved.kind} ${saved.id} en ${quotation.quote_id}`);
            return res.json({
                success: true,
                already: !!result.already,
                proposal: logic.publicProposal(saved),
                quote_id: fresh.quote_id,
                quote_status: fresh.quote_status,
                agreement: Model.agreementOf(fresh),
                emails: email ? [email] : [],
            });
        } catch (err) {
            log.error('[negociacion] resolución:', err && err.message);
            const mapped = logic.dbError(err);
            return res.status(mapped.status).json({ success: false, code: mapped.code, error: mapped.error });
        }
    }

    return { state, propose, resolve };
}

function register(app, overrides = {}) {
    const handlers = createHandlers(overrides);
    const limiter = typeof overrides.limiter === 'function' ? overrides.limiter : writeLimiter();
    app.get('/api/negociacion/quotations/:quoteId', handlers.state);
    app.post('/api/negociacion/quotations/:quoteId/proposals', limiter, handlers.propose);
    app.post('/api/negociacion/quotations/:quoteId/proposals/:proposalId/:action', limiter, handlers.resolve);
    return handlers;
}

module.exports = { register, createHandlers };
