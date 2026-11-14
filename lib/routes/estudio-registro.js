'use strict';

// ===========================================================================
// Rutas del frente estudio-registro (beta cerrada, nov 2026).
// ---------------------------------------------------------------------------
//   GET  /api/admin/studio-claims              Cola de reclamos pendientes.
//   POST /api/admin/studio-claims/:id/decide   Aprobar / rechazar un reclamo.
//   POST /api/studio/registration/welcome      Email de bienvenida del estudio.
//
// Backoffice: superadmin o agente de soporte activo. La decisión viaja con el
// JWT del caller (decide_studio_claim exige is_support_user() y registra quién
// decidió). Al decidir se avisa por email al reclamante (best-effort, una sola
// vez por reclamo y estado).
//
// Bienvenida: la pide el navegador del dueño después de completar el alta. El
// servidor no confía en nada del body: busca el estudio del usuario del token,
// arma los links con applicationBase y envía una sola vez por cuenta
// (idempotencyKey 'registration:studio:<user_id>').
//
// Se registra desde server.js con una línea:
//   require('./lib/routes/estudio-registro').register(app, { applicationBase });
// ===========================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = ['approve', 'reject'];
const MIGRATION_PENDING = 'Esta función todavía no está disponible (falta aplicar una migración).';

function cleanText(value, max) {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : '';
}

function defaultApplicationBase(req) {
    return require('../../services/email-request-context').applicationBase(req);
}

function resolveDeps(deps = {}) {
    const auth = deps.auth || require('../auth/supabase-auth');
    const repoModule = deps.repoModule || require('../repos/studio-claims');
    return {
        verifyAdminCaller: deps.verifyAdminCaller || auth.verifyAdminCaller,
        resolveBearerUser: deps.resolveBearerUser || auth.resolveBearerUser,
        bearerToken: deps.bearerToken || auth.bearerToken,
        applicationBase: deps.applicationBase || defaultApplicationBase,
        sendEmail: deps.sendEmail || ((...args) => require('../../services/email-service').sendEmail(...args)),
        repo: deps.repo || repoModule.StudioClaimsRepo,
        pgErrorCode: repoModule.pgErrorCode,
        pgErrorMessage: repoModule.pgErrorMessage,
        isMissingSchemaError: repoModule.isMissingSchemaError,
        logger: deps.logger || console,
    };
}

// Superadmin o agente de soporte activo.
async function verifyBackofficeOrSupport(req, d) {
    const admin = await d.verifyAdminCaller(req);
    if (admin.ok) return { ok: true, role: 'superadmin', userId: admin.userId };
    if (admin.status === 401) return admin;
    const user = await d.resolveBearerUser(req);
    if (!user) return { ok: false, status: 401, error: 'Iniciá sesión de nuevo.' };
    try {
        if (await d.repo.isActiveSupportUser(user.id)) return { ok: true, role: 'support', userId: user.id };
    } catch (err) {
        d.logger.warn('[estudio-registro] support lookup failed:', err.message);
        return { ok: false, status: 500, error: 'No pudimos verificar tu acceso de soporte.' };
    }
    return { ok: false, status: 403, error: 'Esta acción requiere el superadmin o un agente de soporte activo.' };
}

// Error de una RPC → respuesta HTTP (errcodes del contrato).
function rpcFailure(res, err, d, label) {
    const code = d.pgErrorCode(err);
    const message = cleanText(d.pgErrorMessage(err), 300);
    if (code === 'PGRST202' || d.isMissingSchemaError(err)) {
        return res.status(503).json({ success: false, migration_pending: true, error: MIGRATION_PENDING });
    }
    if (code === '42501') return res.status(403).json({ success: false, error: message || 'No tenés permiso para esta acción.' });
    if (code === '22023' || code === '22P02') return res.status(400).json({ success: false, error: message || 'Datos inválidos.' });
    if (code === '23514' || code === 'P0001' || code === 'P0002') {
        return res.status(409).json({ success: false, error: message || 'El estado cambió. Recargá y probá de nuevo.' });
    }
    d.logger.error(`[estudio-registro] ${label} failed:`, err && err.message);
    return res.status(502).json({ success: false, error: 'No se pudo completar la acción.' });
}

// Payload del email de la decisión (destinatario de auth.users).
function claimDecisionPayload(claim, base) {
    if (!claim || !['approved', 'rejected'].includes(claim.status)) return null;
    const user = claim.user;
    if (!user || !user.email) return null;
    const approved = claim.status === 'approved';
    return {
        email: user.email,
        contact_name: cleanText(claim.contact_name || user.full_name, 120),
        studio_name: cleanText(claim.studios && claim.studios.name, 120) || 'tu estudio',
        status: claim.status,
        decision_note: cleanText(claim.decision_note, 300),
        cta_url: approved ? `${base}/studio/dashboard` : `${base}/studio/register`,
    };
}

// Payload de la bienvenida (estudio del usuario del token).
function welcomePayload(studio, email, base) {
    const locations = Array.isArray(studio.locations) ? studio.locations : [];
    const active = locations.filter((l) => l && l.is_active !== false);
    const names = active.map((l) => [cleanText(l.label, 60) || 'Sede', cleanText(l.city, 60)].filter(Boolean).join(' · '));
    const slug = studio.slug || studio.id;
    return {
        email,
        studio_name: cleanText(studio.name, 160) || 'Tu estudio',
        locations_count: active.length,
        locations_text: names.slice(0, 5).join(', ') + (names.length > 5 ? ` y ${names.length - 5} más` : ''),
        verification_required: Boolean(studio.verification_required),
        dashboard_url: `${base}/studio/dashboard`,
        profile_url: `${base}/studio/profile/?studio=${encodeURIComponent(slug)}`,
        locations_url: `${base}/studio/dashboard#sedes`,
        team_url: `${base}/studio/dashboard#roster`,
        verification_url: `${base}/studio/dashboard#verificacion`,
    };
}

function register(app, deps = {}) {
    const d = resolveDeps(deps);

    app.get('/api/admin/studio-claims', async (req, res) => {
        const auth = await verifyBackofficeOrSupport(req, d);
        if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
        try {
            const claims = await d.repo.listPendingClaims();
            return res.json({ success: true, claims });
        } catch (err) {
            if (d.isMissingSchemaError(err)) return res.json({ success: true, claims: [], migration_pending: true });
            d.logger.error('[estudio-registro] studio-claims list failed:', err.message);
            return res.status(500).json({ success: false, error: 'No se pudieron cargar los reclamos.' });
        }
    });

    app.post('/api/admin/studio-claims/:id/decide', async (req, res) => {
        const auth = await verifyBackofficeOrSupport(req, d);
        if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
        const id = String(req.params.id || '');
        if (!UUID_RE.test(id)) return res.status(400).json({ success: false, error: 'ID de reclamo inválido.' });
        const { decision, note } = req.body || {};
        if (!DECISIONS.includes(decision)) {
            return res.status(400).json({ success: false, error: 'Decisión inválida: usá approve o reject.' });
        }
        const cleanNote = note == null ? null : (String(note).trim().slice(0, 1000) || null);
        if (decision === 'reject' && (!cleanNote || cleanNote.length < 3)) {
            return res.status(400).json({ success: false, error: 'Escribí el motivo del rechazo.' });
        }

        let result;
        try {
            result = await d.repo.decideClaimAsCaller(id, decision, cleanNote, d.bearerToken(req));
        } catch (err) {
            return rpcFailure(res, err, d, 'decide_studio_claim');
        }

        let email = { sent: false, delivery_status: 'skipped' };
        try {
            const claim = await d.repo.getClaimWithParties(id);
            const payload = claimDecisionPayload(claim, d.applicationBase(req));
            if (!payload) email = { sent: false, delivery_status: 'no_recipient' };
            else {
                const sent = await d.sendEmail('studio_claim_decided', payload, {
                    idempotencyKey: `studio_claim_decided:${id}:${claim.status}`,
                });
                email = { sent: Boolean(sent && sent.ok), delivery_status: (sent && sent.delivery_status) || (sent && sent.ok ? 'accepted' : 'failed') };
            }
        } catch (notifyErr) {
            d.logger.warn('[estudio-registro] claim decision email not sent:', notifyErr.message);
            email = { sent: false, delivery_status: 'failed' };
        }
        return res.json({ success: true, result, email });
    });

    app.post('/api/studio/registration/welcome', async (req, res) => {
        const user = await d.resolveBearerUser(req);
        if (!user || !user.id) return res.status(401).json({ success: false, error: 'Iniciá sesión para enviar la bienvenida.' });
        if (!user.email) return res.status(409).json({ success: false, error: 'Tu cuenta no tiene email.' });
        let studio;
        try {
            studio = await d.repo.getOwnedStudioForWelcome(user.id);
        } catch (err) {
            d.logger.error('[estudio-registro] welcome studio lookup failed:', err.message);
            return res.status(500).json({ success: false, error: 'No pudimos leer tu estudio.' });
        }
        if (!studio) return res.status(404).json({ success: false, error: 'Tu cuenta todavía no tiene un estudio.' });
        try {
            const result = await d.sendEmail('studio_registration_completed',
                welcomePayload(studio, user.email, d.applicationBase(req)),
                { idempotencyKey: `registration:studio:${user.id}` });
            return res.json({ success: Boolean(result && result.ok), delivery_status: (result && result.delivery_status) || null,
                skipped: Boolean(result && result.skipped) });
        } catch (err) {
            d.logger.warn('[estudio-registro] welcome email failed:', err.message);
            return res.status(502).json({ success: false, error: 'No pudimos enviar el email de bienvenida.' });
        }
    });
}

module.exports = { register, claimDecisionPayload, welcomePayload, verifyBackofficeOrSupport };
