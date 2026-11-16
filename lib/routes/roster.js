'use strict';

// ===========================================================================
// Rutas del roster de estudios (beta cerrada · frente roster).
// ---------------------------------------------------------------------------
// Se registran con UNA línea en server.js: require('./lib/routes/roster').register(app)
//
//   Estudio (dueño o soporte, Bearer):
//     POST   /api/studio/invite-links            genera un enlace (token en claro UNA vez)
//     GET    /api/studio/invite-links?studio_id= lista sin token, con usos y estado
//     DELETE /api/studio/invite-links/:id?studio_id=  revoca
//     POST   /api/studio/invite-email            invitación personal por email (ROSTER-06)
//     POST   /api/studio/roster-notify           aviso de la decisión sobre una solicitud
//   Público:
//     GET    /api/studio-invite/:token           preview del enlace (no-store)
//   Artista (Bearer):
//     POST   /api/studio-invite/:token/join      canje con cuenta
//     POST   /api/artist/studio-notify           aviso al estudio (solicitud / respuesta)
//     POST   /api/artist/studio-sync             alinea estudio, work_type y ubicación
//
// La lógica vive en lib/roster-service.js; los datos en lib/repos/studio-roster.js.
// ===========================================================================

const rateLimit = require('express-rate-limit');
const studioInvite = require('../studio-invite');
const { createStudioRosterRepo } = require('../repos/studio-roster');
const { createRosterService } = require('../roster-service');

let _service = null;
let _repo = null;

async function fetchAuthUserEmail(userId) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !userId) return null;
    const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    const user = body && (body.user || body);
    return user && user.email ? String(user.email).toLowerCase() : null;
}

function repo() {
    if (!_repo) _repo = createStudioRosterRepo();
    return _repo;
}

function service() {
    if (!_service) {
        const emailService = require('../../services/email-service');
        _service = createRosterService({
            repo: repo(),
            sendEmail: (eventId, payload, options) => emailService.sendEmail(eventId, payload, options),
            getAuthUserEmail: fetchAuthUserEmail
        });
    }
    return _service;
}

// Mensaje legible de un error de RPC (PostgREST devuelve el JSON del error en
// el texto). Solo se muestran los mensajes en español que escriben nuestras
// funciones; el resto se reemplaza por uno genérico.
function rpcErrorMessage(error, fallback) {
    const raw = String((error && error.message) || '');
    const match = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const message = match ? match[1].replace(/\\"/g, '"') : '';
    if (message && /[áéíóúñ¿]|Elegí|Probá|estudio|enlace|sede|dueño|email/i.test(message) && message.length < 200) return message;
    return fallback;
}

function rpcErrorStatus(error) {
    const raw = String((error && error.message) || '');
    if (/42501/.test(raw)) return 403;
    if (/22023|23514/.test(raw)) return 400;
    return 500;
}

// Tope en memoria por estudio para invitaciones por email (además del tope
// diario de la RPC). Suficiente para un solo proceso PM2.
const EMAIL_INVITES_PER_DAY = 20;
const _emailInviteLog = new Map();
function takeEmailInviteSlot(studioId, now = Date.now()) {
    const since = now - 24 * 60 * 60 * 1000;
    const list = (_emailInviteLog.get(studioId) || []).filter((t) => t > since);
    if (list.length >= EMAIL_INVITES_PER_DAY) {
        _emailInviteLog.set(studioId, list);
        return false;
    }
    list.push(now);
    _emailInviteLog.set(studioId, list);
    return true;
}

function register(app, deps = {}) {
    const resolveBearerUser = deps.resolveBearerUser || require('../auth/supabase-auth').resolveBearerUser;
    const applicationBase = deps.applicationBase || require('../../services/email-request-context').applicationBase;
    const svc = () => deps.service || service();
    const data = () => deps.repo || repo();

    const ownerLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiadas acciones seguidas. Prueba de nuevo en unos minutos.' }
    });
    const previewLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Demasiadas consultas. Prueba de nuevo en unos minutos.' }
    });

    async function requireUser(req, res) {
        let user = null;
        try { user = await resolveBearerUser(req); } catch (_) { user = null; }
        if (!user || !user.id) {
            res.status(401).json({ success: false, error: 'Inicia sesión para continuar.' });
            return null;
        }
        return user;
    }

    // Dueño del estudio (o soporte activo). Los managers no generan enlaces ni
    // deciden altas (la RPC y la RLS solo autorizan al dueño y a soporte).
    async function requireStudioOwner(req, res, studioId) {
        const user = await requireUser(req, res);
        if (!user) return null;
        if (!studioInvite.isUuid(String(studioId || ''))) {
            res.status(400).json({ success: false, error: 'Falta el estudio.' });
            return null;
        }
        const studio = await data().getStudio(studioId);
        if (!studio) {
            res.status(404).json({ success: false, error: 'No encontramos el estudio.' });
            return null;
        }
        const isOwner = studio.user_id && String(studio.user_id) === String(user.id);
        if (!isOwner && !(await data().isActiveSupportUser(user.id))) {
            res.status(403).json({ success: false, error: 'Solo el dueño del estudio puede hacer esto.' });
            return null;
        }
        return { user, studio };
    }

    // ---------------- enlaces de invitación (estudio) ----------------
    app.post('/api/studio/invite-links', ownerLimiter, async (req, res) => {
        try {
            const body = req.body || {};
            const ctx = await requireStudioOwner(req, res, body.studio_id);
            if (!ctx) return;
            const parsed = studioInvite.normalizeIssueInput(body);
            if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
            const link = await svc().issueInviteLink({
                studio: ctx.studio,
                createdBy: ctx.user.id,
                input: parsed.value,
                appBase: applicationBase(req)
            });
            res.set('Cache-Control', 'no-store');
            return res.json({ success: true, link });
        } catch (error) {
            console.error('[roster] invite-links POST:', error.message);
            return res.status(rpcErrorStatus(error)).json({
                success: false,
                error: rpcErrorMessage(error, 'No pudimos generar el enlace. Prueba de nuevo.')
            });
        }
    });

    app.get('/api/studio/invite-links', ownerLimiter, async (req, res) => {
        try {
            const ctx = await requireStudioOwner(req, res, req.query.studio_id);
            if (!ctx) return;
            const rows = await data().listInviteLinks(ctx.studio.id);
            res.set('Cache-Control', 'no-store');
            return res.json({ success: true, links: rows.map((row) => studioInvite.publicLinkRow(row)) });
        } catch (error) {
            console.error('[roster] invite-links GET:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos cargar los enlaces.' });
        }
    });

    app.delete('/api/studio/invite-links/:id', ownerLimiter, async (req, res) => {
        try {
            const ctx = await requireStudioOwner(req, res, req.query.studio_id || (req.body && req.body.studio_id));
            if (!ctx) return;
            if (!studioInvite.isUuid(String(req.params.id || ''))) {
                return res.status(400).json({ success: false, error: 'Enlace inválido.' });
            }
            const row = await data().revokeInviteLink(req.params.id, ctx.studio.id);
            if (!row) return res.status(404).json({ success: false, error: 'El enlace no existe o ya estaba desactivado.' });
            return res.json({ success: true, link: studioInvite.publicLinkRow(row) });
        } catch (error) {
            console.error('[roster] invite-links DELETE:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos desactivar el enlace.' });
        }
    });

    // Invitación personal por email. Respuesta idéntica haya o no una cuenta
    // con ese email (anti-enumeración).
    app.post('/api/studio/invite-email', ownerLimiter, async (req, res) => {
        try {
            const body = req.body || {};
            const ctx = await requireStudioOwner(req, res, body.studio_id);
            if (!ctx) return;
            const parsed = studioInvite.normalizeEmailInviteInput(body);
            if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
            if (!takeEmailInviteSlot(ctx.studio.id)) {
                return res.status(429).json({ success: false, error: 'Enviaste muchas invitaciones hoy. Prueba de nuevo mañana.' });
            }
            await svc().inviteByEmail({
                studio: ctx.studio,
                createdBy: ctx.user.id,
                input: parsed.value,
                appBase: applicationBase(req)
            });
            return res.json({ success: true, message: `Le enviamos la invitación a ${parsed.value.email}.` });
        } catch (error) {
            console.error('[roster] invite-email:', error.message);
            return res.status(rpcErrorStatus(error)).json({
                success: false,
                error: rpcErrorMessage(error, 'No pudimos enviar la invitación. Prueba de nuevo.')
            });
        }
    });

    // Aviso al tatuador de la decisión del estudio sobre su solicitud. La
    // decisión ya la tomó la RPC decide_studio_membership_request (cliente).
    app.post('/api/studio/roster-notify', ownerLimiter, async (req, res) => {
        try {
            const body = req.body || {};
            if (body.kind !== 'membership_request_decision') {
                return res.status(400).json({ success: false, error: 'kind inválido (esperado: membership_request_decision).' });
            }
            const user = await requireUser(req, res);
            if (!user) return;
            if (!studioInvite.isUuid(String(body.membership_id || ''))) {
                return res.status(400).json({ success: false, error: 'Falta la solicitud.' });
            }
            const membership = await data().getMembershipWithParties(body.membership_id);
            if (!membership) return res.status(404).json({ success: false, error: 'No encontramos esa solicitud.' });
            const studio = Array.isArray(membership.studios) ? membership.studios[0] : membership.studios;
            const isOwner = studio && studio.user_id && String(studio.user_id) === String(user.id);
            if (!isOwner && !(await data().isActiveSupportUser(user.id))) {
                return res.status(403).json({ success: false, error: 'Solo el dueño del estudio puede hacer esto.' });
            }
            if (membership.initiated_by !== 'artist' || !['active', 'rejected'].includes(membership.status)) {
                return res.status(409).json({ success: false, sent: false, error: 'La solicitud todavía no tiene una decisión.' });
            }
            if (membership.status === 'active') {
                await svc().syncArtistStudio(membership.artist_user_id).catch((error) => console.warn('[roster] sync:', error.message));
            }
            const result = await svc().notify('studio_membership_request_decision', membership.id, { base: applicationBase(req) });
            return res.status(result.ok || result.skipped ? 200 : 502).json({
                success: !!result.ok, sent: !!result.sent, skipped: !!result.skipped, error: result.ok ? undefined : result.error
            });
        } catch (error) {
            console.error('[roster] roster-notify:', error.message);
            return res.status(503).json({ success: false, sent: false, error: 'La decisión quedó guardada, pero no se pudo confirmar el correo.' });
        }
    });

    // ---------------- enlace (público / artista) ----------------
    app.get('/api/studio-invite/:token', previewLimiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const preview = await svc().previewInvite(String(req.params.token || ''));
            const status = studioInvite.previewHttpStatus(preview.status);
            if (status !== 200) {
                return res.status(status).json({ success: false, status: preview.status, error: studioInvite.statusMessage(preview.status) });
            }
            return res.json({ success: true, ...preview });
        } catch (error) {
            console.error('[roster] invite preview:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos validar el enlace.' });
        }
    });

    app.post('/api/studio-invite/:token/join', previewLimiter, async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const token = String(req.params.token || '');
            const result = await svc().redeemInvite(token, user.id);
            if (!result || !['requested', 'active', 'pending_acceptance', 'pending_invite', 'paused'].includes(result.status)) {
                const status = result && result.status ? result.status : 'invalid';
                const http = status === 'not_artist' ? 403 : studioInvite.previewHttpStatus(status);
                return res.status(http).json({ success: false, status, error: studioInvite.statusMessage(status) });
            }
            svc().afterRedeem(result, { base: applicationBase(req), artistUserId: user.id })
                .catch((error) => console.warn('[roster] aviso tras el canje falló:', error.message));
            return res.json({
                success: true,
                status: result.status,
                membership_id: result.membership_id,
                studio_id: result.studio_id,
                already_member: !!result.already_member
            });
        } catch (error) {
            console.error('[roster] invite join:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos sumarte al estudio. Prueba de nuevo.' });
        }
    });

    // Avisos que dispara el artista después de una acción suya (la acción ya
    // la hizo una RPC con su sesión): el servidor verifica que la membresía
    // sea suya y esté en el estado que corresponde.
    app.post('/api/artist/studio-notify', ownerLimiter, async (req, res) => {
        try {
            const body = req.body || {};
            if (!['membership_request_created', 'invitation_response'].includes(body.kind)) {
                return res.status(400).json({ success: false, error: 'kind inválido (esperado: membership_request_created | invitation_response).' });
            }
            const user = await requireUser(req, res);
            if (!user) return;
            if (!studioInvite.isUuid(String(body.membership_id || ''))) {
                return res.status(400).json({ success: false, error: 'Falta el vínculo.' });
            }
            const membership = await data().getMembershipWithParties(body.membership_id);
            if (!membership || String(membership.artist_user_id) !== String(user.id)) {
                return res.status(404).json({ success: false, error: 'No encontramos ese vínculo.' });
            }
            const base = applicationBase(req);
            let result;
            if (body.kind === 'membership_request_created') {
                if (membership.status !== 'requested' || membership.initiated_by !== 'artist') {
                    return res.status(409).json({ success: false, sent: false, error: 'La solicitud ya no está pendiente.' });
                }
                result = await svc().notify('studio_membership_request_created', membership.id, { base });
            } else {
                if (membership.initiated_by === 'artist' || !['active', 'rejected'].includes(membership.status)) {
                    return res.status(409).json({ success: false, sent: false, error: 'La invitación todavía no tiene respuesta.' });
                }
                if (membership.status === 'active') {
                    await svc().syncArtistStudio(user.id).catch((error) => console.warn('[roster] sync:', error.message));
                }
                result = await svc().notify('studio_invitation_response', membership.id, { base });
            }
            return res.status(result.ok || result.skipped ? 200 : 502).json({
                success: !!result.ok, sent: !!result.sent, skipped: !!result.skipped, error: result.ok ? undefined : result.error
            });
        } catch (error) {
            console.error('[roster] artist studio-notify:', error.message);
            return res.status(503).json({ success: false, sent: false, error: 'Tu respuesta quedó guardada, pero no pudimos avisar al estudio.' });
        }
    });

    app.post('/api/artist/studio-sync', ownerLimiter, async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const result = await svc().syncArtistStudio(user.id);
            return res.json({ success: true, ...result });
        } catch (error) {
            console.error('[roster] studio-sync:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos actualizar tu estudio.' });
        }
    });
}

module.exports = { register, service, repo, rpcErrorMessage, takeEmailInviteSlot, EMAIL_INVITES_PER_DAY };
