'use strict';

// ===========================================================================
// Rutas de la verificación de estudios (frente verif-estudio).
// ---------------------------------------------------------------------------
// Dueño del estudio (Bearer del dueño):
//   GET  /api/studio/verification            estado + sedes + última solicitud
//   GET  /api/studio/verification/documents  URLs firmadas de sus documentos
//   POST /api/studio/verification/instagram  código de Instagram por email
//   (la solicitud se envía desde el navegador con la RPC
//    submit_studio_verification: WeotziData.StudioVerification.submit)
//
// Revisión (superadmin del backoffice o agente de soporte activo). Mismos
// handlers bajo /api/admin/… (backoffice) y /api/support/… (panel de soporte):
//   GET  …/studio-verifications?status=pending|approved|rejected|cancelled|all
//   GET  …/studio-verifications/:id/documents
//   POST …/studio-verifications/:id/decide          {decision, note, confirm_instagram}
//        aprobar exige el Instagram del estudio validado; confirm_instagram
//        lo confirma ANTES de aplicar la decisión (409 si no cargó Instagram)
//   POST …/studio-verifications/studios/:studioId/revoke   {note}
//
// La decisión la aplica decide_studio_verification_as con service_role
// (migración 20261115220000) DESPUÉS de autorizar al caller aquí: el
// superadmin no necesita estar en support_users_db ni mandar otro JWT.
// Email al dueño: evento studio_verification_decision
// (services/email-events/verif-estudio.js).
// ===========================================================================

const rateLimit = require('express-rate-limit');
const { resolveBearerUser, isSuperadminEmail } = require('../auth/supabase-auth');
const {
    StudioVerificationRepo,
    isMissingSchemaError,
    pgErrorCode,
    pgErrorMessage
} = require('../repos/studio-verification');
const studioVerification = require('../../services/studio-verification');
const igVerification = require('../../services/instagram-verification');
const { applicationBase } = require('../../services/email-request-context');

const EMAIL_EVENT = 'studio_verification_decision';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATION_PENDING_ERROR = 'La verificación de estudios todavía no está disponible (falta aplicar una migración).';
const NO_HANDLE_ERROR = 'El estudio no cargó su Instagram.';
const IG_BLOCKED_ERROR = 'No podemos validar esta cuenta de Instagram. Si crees que es un error, escribe a soporte.';
// Mensaje de private.apply_studio_verification_decision al aprobar sin el
// Instagram validado (migración 20261118100000).
const IG_REQUIRED_RE = /valida el Instagram del estudio/i;

// Dependencias reemplazables desde los tests.
const deps = {
    repo: StudioVerificationRepo,
    resolveBearerUser,
    isSuperadminEmail,
    service: studioVerification,
    sendEmail: (...args) => require('../../services/email-service').sendEmail(...args),
    applicationBase
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

// --- Helpers -------------------------------------------------------------------

function cleanText(value, max = 160) {
    return String(value == null ? '' : value)
        .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function greeting(name) {
    const clean = cleanText(name, 80);
    return `Hola${clean ? ' ' + clean : ''},\n\n`;
}

function locationLabel(location) {
    if (!location) return '';
    return cleanText([location.label, location.city].filter(Boolean).join(' · '), 160);
}

// Superadmin del backoffice o agente de soporte activo.
// { ok, role, userId, email } | { ok:false, status, error }
async function authorizeReviewer(req) {
    const user = await deps.resolveBearerUser(req);
    if (!user || !user.id) return { ok: false, status: 401, error: 'Inicia sesión para revisar verificaciones.' };
    if (deps.isSuperadminEmail(user.email)) {
        return { ok: true, role: 'superadmin', userId: user.id, email: user.email };
    }
    try {
        const agent = await deps.repo.getActiveSupportUser(user.id);
        if (agent) return { ok: true, role: 'support', userId: user.id, email: agent.email || user.email };
    } catch (err) {
        console.warn('[verif-estudio] support lookup failed:', err.message);
        return { ok: false, status: 500, error: 'No pudimos verificar tu acceso. Prueba de nuevo.' };
    }
    return { ok: false, status: 403, error: 'Solo el equipo de soporte de We Ötzi revisa verificaciones de estudios.' };
}

// Errores de las RPC (raise exception de Postgres) → HTTP con el mensaje.
function rpcFailure(res, err, fallback) {
    if (isMissingSchemaError(err)) {
        return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
    }
    const code = pgErrorCode(err);
    const message = pgErrorMessage(err);
    const status = code === '42501' ? 403
        : code === 'P0002' ? 404
            : (code === '23514' || code === '22023') ? 409
                : 500;
    if (status === 500) console.error('[verif-estudio] rpc failed:', String(err && err.message || err).slice(0, 300));
    const outCode = code === '22023' && IG_REQUIRED_RE.test(message || '') ? 'IG_REQUIRED' : (code || null);
    return res.status(status).json({ success: false, code: outCode, error: status === 500 ? fallback : (message || fallback) });
}

// Arma el aviso al dueño. Exportado para los tests.
function buildDecisionEmail({ request, owner, base, decision, note }) {
    const studioName = cleanText((request && request.studios && request.studios.name) || (owner && owner.studio_name), 120) || 'tu estudio';
    const slug = (request && request.studios && request.studios.slug) || (owner && owner.studio_slug) || '';
    const dashboardUrl = `${base}/studio/dashboard#verificacion`;
    const profileUrl = slug ? `${base}/studio/profile?studio=${encodeURIComponent(slug)}` : '';
    const cleanNote = cleanText(note, 300);
    let subject;
    let body;
    if (decision === 'approved') {
        subject = `${studioName} ya está verificado en We Ötzi`;
        body = `${greeting(owner && owner.name)}Revisamos la información de ${studioName} y ya figura como estudio verificado. `
            + 'El sello aparece en tu perfil público y donde se listan estudios.'
            + (cleanNote ? `\n\nNota de soporte: ${cleanNote}` : '');
    } else if (decision === 'revoked') {
        subject = `Retiramos el sello de verificación de ${studioName}`;
        body = `${greeting(owner && owner.name)}Retiramos el sello de estudio verificado de ${studioName}.`
            + (cleanNote ? ` Motivo: ${cleanNote}.` : '')
            + '\n\nPuedes volver a pedir la verificación desde tu panel.';
    } else {
        subject = `Necesitamos una corrección para verificar ${studioName}`;
        body = `${greeting(owner && owner.name)}Revisamos la verificación de ${studioName} y necesitamos una corrección.`
            + (cleanNote ? ` ${cleanNote}` : '')
            + '\n\nActualiza los datos o el documento desde tu panel y vuelve a enviarlos.';
    }
    return {
        recipient_email: owner ? owner.email : null,
        recipient_name: (owner && owner.name) || studioName,
        studio_name: studioName,
        subject,
        body_text: body,
        dashboard_url: dashboardUrl,
        public_profile_url: profileUrl,
        decision,
        decision_note: cleanNote,
        location_label: locationLabel(request && request.location)
    };
}

async function notifyOwner(req, { studioId, request, decision, note, idempotencyKey }) {
    try {
        const owner = await deps.repo.getStudioOwnerContact(studioId);
        if (!owner || !owner.email) return { sent: false, delivery_status: 'no_recipient' };
        let location = null;
        if (request && UUID_RE.test(String(request.location_id || ''))) {
            const locations = await deps.repo.listStudioLocations(studioId).catch(() => []);
            location = (locations || []).find((l) => l.id === request.location_id) || null;
        }
        const payload = buildDecisionEmail({
            request: request ? { ...request, location } : null,
            owner,
            base: deps.applicationBase(req),
            decision,
            note
        });
        const result = await deps.sendEmail(EMAIL_EVENT, payload, { idempotencyKey });
        return { sent: Boolean(result && result.ok), delivery_status: (result && result.delivery_status) || (result && result.error ? 'failed' : null) };
    } catch (err) {
        console.warn('[verif-estudio] decision email not sent:', err.message);
        return { sent: false, delivery_status: 'failed' };
    }
}

// --- Handlers de revisión --------------------------------------------------------

async function listHandler(req, res) {
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const status = deps.service.parseAdminStatus(req.query && req.query.status);
    if (!status) return res.status(400).json({ success: false, error: 'Estado inválido (pending | approved | rejected | cancelled | all).' });
    try {
        const requests = await deps.repo.listVerificationRequests({ status });
        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            status,
            reviewer: { role: auth.role },
            requests: requests.map((r) => ({
                ...r,
                // Las rutas de Storage no viajan: los archivos se piden firmados.
                documents: (r.documents || []).map(({ path, ...doc }) => doc)
            }))
        });
    } catch (err) {
        if (isMissingSchemaError(err)) {
            return res.json({ success: true, status, requests: [], migration_pending: true });
        }
        console.error('[verif-estudio] list failed:', err.message);
        return res.status(500).json({ success: false, error: 'No pudimos cargar las solicitudes.' });
    }
}

async function documentsHandler(req, res) {
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const id = String((req.params && req.params.id) || '');
    if (!UUID_RE.test(id)) return res.status(400).json({ success: false, error: 'ID de solicitud inválido.' });
    try {
        const request = await deps.repo.getVerificationRequestWithStudio(id);
        if (!request) return res.status(404).json({ success: false, error: 'No encontramos esa solicitud.' });
        const documents = await deps.repo.signDocuments(request.documents, request.studio_id);
        res.set('Cache-Control', 'no-store');
        return res.json({ success: true, documents: documents.map(({ path, ...doc }) => doc) });
    } catch (err) {
        if (isMissingSchemaError(err)) return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
        console.error('[verif-estudio] documents failed:', err.message);
        return res.status(500).json({ success: false, error: 'No pudimos abrir los documentos.' });
    }
}

async function decideHandler(req, res) {
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const input = deps.service.parseDecisionInput(req.params, req.body);
    if (!input.ok) return res.status(input.status).json({ success: false, error: input.error });

    // Aprobar exige el Instagram del estudio validado (la RPC lo rechaza con
    // 22023 si no está). Si soporte lo confirma, se confirma ANTES de la RPC:
    // así la aprobación ve el Instagram ya validado.
    let instagram = null;
    if (input.confirmInstagram) {
        let pending;
        try {
            pending = await deps.repo.getVerificationRequestWithStudio(input.id);
        } catch (err) {
            return rpcFailure(res, err, 'No pudimos guardar la decisión.');
        }
        if (!pending || !pending.studio_id) return res.status(404).json({ success: false, error: 'No encontramos esa solicitud.' });
        if (pending.status && pending.status !== 'pending') {
            return res.status(409).json({ success: false, code: '23514', error: 'La solicitud ya fue resuelta.' });
        }
        try {
            instagram = await deps.service.confirmInstagramBySupport({ studioId: pending.studio_id, verifiedBy: auth.userId });
        } catch (err) {
            console.warn('[verif-estudio] instagram confirm failed:', err.message);
            return res.status(500).json({ success: false, error: 'No pudimos confirmar el Instagram del estudio. Prueba de nuevo.' });
        }
        if (!instagram || !instagram.confirmed) {
            const reason = (instagram && instagram.reason) || null;
            if (reason === 'no_handle') return res.status(409).json({ success: false, code: 'IG_NO_HANDLE', error: NO_HANDLE_ERROR });
            if (reason === 'blocked') return res.status(409).json({ success: false, code: 'IG_BLOCKED', error: IG_BLOCKED_ERROR });
            if (reason === 'studio_not_found') return res.status(404).json({ success: false, error: 'No encontramos el estudio de esa solicitud.' });
            return res.status(409).json({ success: false, code: 'IG_NOT_CONFIRMED', error: 'No pudimos confirmar el Instagram del estudio.' });
        }
    }

    let result;
    try {
        result = await deps.repo.decideVerification(input.id, input.decision, input.note, auth.userId);
    } catch (err) {
        return rpcFailure(res, err, 'No pudimos guardar la decisión.');
    }
    const studioId = (result && result.studio_id) || null;

    let request = null;
    try { request = await deps.repo.getVerificationRequestWithStudio(input.id); } catch (_) { request = null; }
    const decision = input.decision === 'approve' ? 'approved' : 'rejected';
    const email = studioId
        ? await notifyOwner(req, {
            studioId,
            request,
            decision,
            note: input.note,
            idempotencyKey: `${EMAIL_EVENT}:${input.id}:${decision}`
        })
        : { sent: false, delivery_status: 'skipped' };

    console.log(`[verif-estudio] request ${input.id} ${decision}${input.confirmInstagram ? ' +instagram' : ''} by ${auth.role} ${auth.userId}`);
    return res.json({
        success: true,
        result,
        instagram_confirmed: Boolean(instagram && instagram.confirmed),
        instagram_handle: (instagram && instagram.handle) || null,
        email_sent: Boolean(email.sent),
        delivery_status: email.delivery_status || null
    });
}

async function revokeHandler(req, res) {
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const input = deps.service.parseRevokeInput(req.params, req.body);
    if (!input.ok) return res.status(input.status).json({ success: false, error: input.error });
    let result;
    try {
        result = await deps.repo.revokeVerification(input.studioId, input.note, auth.userId);
    } catch (err) {
        return rpcFailure(res, err, 'No pudimos retirar el sello.');
    }
    const email = await notifyOwner(req, {
        studioId: input.studioId,
        request: null,
        decision: 'revoked',
        note: input.note,
        idempotencyKey: `${EMAIL_EVENT}:${(result && result.id) || input.studioId}:revoked`
    });
    console.log(`[verif-estudio] studio ${input.studioId} verification revoked by ${auth.role} ${auth.userId}`);
    return res.json({ success: true, result, email_sent: Boolean(email.sent), delivery_status: email.delivery_status || null });
}

// --- Registro --------------------------------------------------------------------

// Cada pedido de código manda un email: 5 por hora por IP.
const studioIgVerifyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'IG_VERIFY_RATE_LIMITED', error: 'Pediste varios códigos seguidos. Espera un rato y prueba de nuevo.' }
});

function register(app) {
    // Webhook de DMs: si el código no es de un artista, se prueba con estudios.
    if (typeof igVerification.setStudioInboundHandler === 'function') {
        igVerification.setStudioInboundHandler(studioVerification.handleInboundCodes);
    }

    app.get('/api/studio/verification', studioVerification.getStudioVerification);
    app.get('/api/studio/verification/documents', studioVerification.getStudioDocuments);
    app.post('/api/studio/verification/instagram', studioIgVerifyLimiter, studioVerification.requestInstagramCode);

    for (const scope of ['admin', 'support']) {
        const base = `/api/${scope}/studio-verifications`;
        app.get(base, listHandler);
        app.get(`${base}/:id/documents`, documentsHandler);
        app.post(`${base}/:id/decide`, decideHandler);
        app.post(`${base}/studios/:studioId/revoke`, revokeHandler);
    }
}

module.exports = {
    register,
    authorizeReviewer,
    buildDecisionEmail,
    _internal: { setDeps, listHandler, documentsHandler, decideHandler, revokeHandler, rpcFailure, EMAIL_EVENT }
};
