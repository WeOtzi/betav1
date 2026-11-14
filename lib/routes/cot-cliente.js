'use strict';

// ===========================================================================
// Rutas del frente cot-cliente (beta cerrada).
// ---------------------------------------------------------------------------
//   POST /api/client/quotations/claim
//        Vincula a la cuenta las cotizaciones de invitado hechas con su email
//        VERIFICADO (CC-02 / ACC-12). Lo llaman el login, el registro, el
//        cotizador y el dashboard del cliente en cada carga. Idempotente.
//
//   POST /api/client/quotations/:quoteId/decision   { decision, reason? }
//        El cliente acepta ('approve') o rechaza ('reject') la propuesta del
//        artista (CC-01). Valida dueño, estado 'responded', disputa y
//        vencimiento; guarda con guardia de carrera; avisa por email a ambas
//        partes y dispara el hook onClientDecision (frente turnos).
//
// Se registra desde server.js con una línea:
//   require('./lib/routes/cot-cliente').register(app);
// ===========================================================================

const logic = require('../cot-cliente');

const ARTIST_EVENT = { approve: 'client_approved_quotation', reject: 'client_rejected_quotation' };
const CLIENT_EVENT = { approve: 'client_quotation_accepted_receipt', reject: 'client_quotation_rejected_receipt' };

// Dependencias por defecto, cargadas solo si el llamador no las inyecta (tests).
const DEFAULTS = {
    resolveBearerUser: () => require('../auth/supabase-auth').resolveBearerUser,
    repo: () => require('../repos/client-quotations').ClientQuotationsRepo,
    emailService: () => require('../../services/email-service'),
    applicationBase: () => require('../../services/email-request-context').applicationBase,
    logger: () => console,
    now: () => () => Date.now(),
};

function createHandlers(overrides = {}) {
    const deps = {};
    for (const key of Object.keys(DEFAULTS)) deps[key] = overrides[key] !== undefined ? overrides[key] : DEFAULTS[key]();
    const log = deps.logger || console;

    async function claim(req, res) {
        try {
            const user = await deps.resolveBearerUser(req);
            if (!user) return res.status(401).json({ success: false, error: 'Iniciá sesión para ver tus cotizaciones.' });
            if (!logic.isEmailVerified(user)) {
                return res.status(403).json({ success: false, code: 'email_unverified', error: 'Confirmá tu email para vincular las cotizaciones que hiciste sin cuenta.' });
            }
            const candidates = await deps.repo.listUnclaimedByEmail(user.email);
            const claimable = logic.filterClaimable(candidates, user);
            const linked = claimable.length ? await deps.repo.claimIds(claimable.map((q) => q.id), user.id) : [];
            const quoteIds = (linked || []).map((q) => q.quote_id).filter(Boolean);
            if (quoteIds.length) log.log(`[cot-cliente] ${user.id} vinculó ${quoteIds.length} cotizaciones por email verificado`);
            return res.json({ success: true, linked: quoteIds.length, quote_ids: quoteIds });
        } catch (err) {
            log.error('[cot-cliente] claim:', err && err.message);
            return res.status(500).json({ success: false, error: 'No pudimos vincular tus cotizaciones. Probá de nuevo en un momento.' });
        }
    }

    async function notify(eventId, payload, idempotencyKey) {
        try {
            const result = await deps.emailService.sendEmail(eventId, payload, { idempotencyKey });
            return { event: eventId, ok: !!(result && result.ok), skipped: !!(result && result.skipped) };
        } catch (err) {
            log.warn(`[cot-cliente] email ${eventId} falló:`, err && err.message);
            return { event: eventId, ok: false };
        }
    }

    async function decision(req, res) {
        const quoteId = String((req.params && req.params.quoteId) || '').trim();
        if (!quoteId || quoteId.length > 64) return res.status(400).json({ success: false, error: 'Falta la cotización.' });
        const body = logic.normalizeDecisionBody(req.body);
        if (!body.ok) return res.status(body.status).json({ success: false, error: body.error });

        try {
            const user = await deps.resolveBearerUser(req);
            if (!user) return res.status(401).json({ success: false, error: 'Iniciá sesión para responder la propuesta.' });
            const quotation = await deps.repo.getForDecision(quoteId);
            const now = deps.now();
            const verdict = logic.evaluateDecision({ user, quotation, decision: body.decision, now });
            if (!verdict.ok) return res.status(verdict.status).json({ success: false, code: verdict.code, error: verdict.error });
            if (verdict.already) {
                return res.json({ success: true, already: true, quote_id: quotation.quote_id, quote_status: verdict.targetStatus });
            }

            const startedIso = new Date(now - 60 * 1000).toISOString();
            const patch = logic.decisionPatch(quotation, body.decision);
            const saved = await deps.repo.decide(quotation.id, patch, { userId: user.id, claim: verdict.claim });
            if (!saved) {
                return res.status(409).json({ success: false, code: 'race', error: 'El estado de la cotización cambió mientras respondías. Actualizá la página.' });
            }

            await Promise.resolve(deps.repo.annotateHistory(quotation.id, verdict.targetStatus, startedIso, {
                changedBy: user.id,
                notes: body.decision === 'reject' && body.reason ? `Motivo del cliente: ${body.reason}` : (body.decision === 'approve' ? 'El cliente aceptó la propuesta.' : 'El cliente rechazó la propuesta.'),
            })).catch((err) => log.warn('[cot-cliente] historial:', err && err.message));

            const artist = await Promise.resolve(deps.repo.getArtist(saved.artist_id || quotation.artist_id)).catch(() => null);
            const payloads = logic.decisionEmailPayloads({
                quotation, saved, decision: body.decision, reason: body.reason, base: deps.applicationBase(req), artist,
            });
            const keyBase = `cot-cliente:decision:${saved.quote_id}:${verdict.targetStatus}`;
            const emails = await Promise.all([
                notify(ARTIST_EVENT[body.decision], payloads.artist, `${keyBase}:artist`),
                notify(CLIENT_EVENT[body.decision], payloads.client, `${keyBase}:client`),
            ]);

            // Hook del frente turnos: no bloquea ni cambia la respuesta.
            let sessions = [];
            if (body.decision === 'approve') {
                sessions = await Promise.resolve(deps.repo.listScheduledSessions(saved.id)).catch(() => []) || [];
            }
            await logic.runClientDecisionHooks({
                decision: body.decision, status: verdict.targetStatus, quotation: saved, userId: user.id, sessions,
            }, log);

            log.log(`[cot-cliente] ${user.id} ${body.decision === 'approve' ? 'aceptó' : 'rechazó'} ${saved.quote_id}`);
            return res.json({
                success: true,
                quote_id: saved.quote_id,
                quote_status: saved.quote_status,
                claimed: !!verdict.claim,
                quotation: saved,
                emails,
            });
        } catch (err) {
            const msg = String((err && err.message) || '');
            log.error('[cot-cliente] decision:', msg);
            if (/Invalid status transition/i.test(msg)) {
                return res.status(409).json({ success: false, code: 'status', error: 'El estado de la cotización cambió. Actualizá la página.' });
            }
            return res.status(500).json({ success: false, error: 'No pudimos guardar tu respuesta. Probá de nuevo en un momento.' });
        }
    }

    return { claim, decision };
}

function register(app, overrides) {
    const handlers = createHandlers(overrides);
    app.post('/api/client/quotations/claim', handlers.claim);
    app.post('/api/client/quotations/:quoteId/decision', handlers.decision);
    return handlers;
}

module.exports = { register, createHandlers, ARTIST_EVENT, CLIENT_EVENT };
