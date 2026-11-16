'use strict';

// ── verif-artista ── Rutas de la verificación de artistas (beta cerrada).
// Se registran desde server.js con una sola línea:
//   require('./lib/routes/verif-artista').register(app, { resolveBearerUser, getActiveSupportAgent, emailService, applicationBase });
//
//   POST /api/artist/verification/request          (artista, Bearer)
//        Pide la verificación: valida documentos en el servidor (RPC
//        request_artist_verification, service-role), deja historial y avisa a soporte.
//   POST /api/support/artist-verification/notify   (agente de soporte activo, Bearer)
//        { history_id } de la decisión que devolvió support_set_artist_verification_state:
//        avisa al artista por email (profile_verified / profile_verification_denied).
// Lógica en lib/verificacion-artista.js; datos en lib/repos/artist-verification.js.

const Verif = require('../verificacion-artista');
const { ArtistVerificationRepo: Repo } = require('../repos/artist-verification');
const verifEvents = require('../../services/email-events/verif-artista');

// Hasta que el frente de emails cargue services/email-events/*.js, los eventos
// nuevos se suman aquí (solo si faltan) y los server-only se cierran a /api/send-email.
function ensureEmailEvents() {
    try {
        const mapping = require('../../services/email-event-mapping');
        const context = require('../../services/email-request-context');
        for (const [id, def] of Object.entries(verifEvents)) {
            if (mapping.EVENTS && !mapping.EVENTS[id]) mapping.EVENTS[id] = def;
            if (def.serverOnly && context.SERVER_ONLY_EVENTS && typeof context.SERVER_ONLY_EVENTS.add === 'function') {
                context.SERVER_ONLY_EVENTS.add(id);
            }
        }
    } catch (err) {
        console.warn('[verif-artista] no pudimos registrar los eventos de email:', err.message);
    }
}

function register(app, deps = {}) {
    const { resolveBearerUser, getActiveSupportAgent, emailService, applicationBase } = deps;
    if (!app || typeof resolveBearerUser !== 'function' || typeof getActiveSupportAgent !== 'function') {
        throw new Error('[verif-artista] faltan dependencias para registrar las rutas');
    }
    ensureEmailEvents();
    const sendEmail = (eventId, payload, options) => emailService.sendEmail(eventId, payload, options);
    const base = (req) => (typeof applicationBase === 'function' ? applicationBase(req) : '');

    app.post('/api/artist/verification/request', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const user = await Promise.resolve(resolveBearerUser(req)).catch(() => null);
        if (!user || !user.id) return res.status(401).json({ success: false, error: 'Inicia sesión para pedir la verificación.' });
        try {
            const result = await Verif.requestVerification({ userId: user.id }, {
                artistByUserId: (id) => Repo.artistByUserId(id),
                documents: (id) => Repo.documents(id),
                requestVerification: (id) => Repo.requestVerification(id),
                supportEmail: process.env.SUPPORT_EMAIL || '',
                supportEmails: () => Repo.activeSupportEmails(),
                sendEmail,
                baseUrl: base(req),
                log: console
            });
            if (!result.ok) {
                return res.status(result.status || 400).json({ success: false, error: result.error, missing: result.missing || [] });
            }
            return res.json({ success: true, state: result.state, changed: !!result.changed, support_notified: !!result.supportNotified });
        } catch (err) {
            console.error('[verif-artista] solicitud:', err.message);
            return res.status(500).json({ success: false, error: 'No pudimos enviar la solicitud. Prueba de nuevo en unos minutos.' });
        }
    });

    app.post('/api/support/artist-verification/notify', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const agent = await getActiveSupportAgent(req);
        if (!agent.ok) return res.status(agent.status || 403).json({ success: false, error: agent.error });
        try {
            const result = await Verif.notifyVerificationDecision(req.body || {}, {
                historyRow: (id) => Repo.historyRow(id),
                artistById: (id) => Repo.artistById(id),
                isActiveSupportAgent: (id) => Repo.isActiveSupportAgent(id),
                sendEmail,
                baseUrl: base(req)
            });
            if (!result.ok) return res.status(result.status || 400).json({ success: false, error: result.error });
            return res.json({ success: true, sent: result.sent, skipped: result.skipped || null,
                deduplicated: !!result.deduplicated, event: result.eventId || null });
        } catch (err) {
            console.error('[verif-artista] aviso de decisión:', err.message);
            return res.status(500).json({ success: false, error: 'No pudimos avisarle al artista por email.' });
        }
    });
}

module.exports = { register, ensureEmailEvents };
