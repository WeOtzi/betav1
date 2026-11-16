'use strict';

// ===========================================================================
// Rutas de disputas para el panel de soporte (ronda 2 · P28, REQ-15).
// ---------------------------------------------------------------------------
// Se registran desde server.js con una sola línea:
//   require('./lib/routes/soporte-disputas').register(app);
//
// Una disputa es un ticket de soporte kind = 'disputa'. Las de sesión las abre
// POST /api/sesiones/:id/dispute; mientras el ticket está abierto la cotización
// queda "En disputa" y no se puede completar ni cambiar el acuerdo. Estas rutas
// son la cola de soporte y su cierre:
//
// Soporte (agente activo de support_users_db o superadmin del backoffice):
//   GET  /api/support/disputes?status=active|open|in_progress|waiting_user|resolved|closed|all
//   GET  /api/support/disputes/:ticketId           reclamo, partes, sesión, cotización y actividad
//   POST /api/support/disputes/:ticketId/status    { status, resolution, outcome }
//   POST /api/support/disputes/:ticketId/notes     { note }   (nota interna)
//
// Al resolver o cerrar, el trigger de la base recalcula
// quotations_db.dispute_status y la cotización se destraba. Las dos partes
// reciben session_dispute_resolved con la resolución que escribió soporte.
// Lógica pura en lib/soporte-disputas.js; datos en lib/repos/soporte-disputas.js.
// ===========================================================================

const { resolveBearerUser, isSuperadminEmail } = require('../auth/supabase-auth');
const { DisputasRepo, isMissingSchemaError } = require('../repos/soporte-disputas');
const D = require('../soporte-disputas');
const Sesiones = require('../sesiones');
const { applicationBase } = require('../../services/email-request-context');

const EVENT_RESOLVED = 'session_dispute_resolved';

// Dependencias reemplazables desde los tests.
const deps = {
    repo: DisputasRepo,
    resolveBearerUser,
    isSuperadminEmail,
    sendEmail: (...args) => require('../../services/email-service').sendEmail(...args),
    applicationBase,
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

// Superadmin del backoffice o agente de soporte activo.
async function authorizeReviewer(req) {
    const user = await deps.resolveBearerUser(req);
    if (!user || !user.id) return { ok: false, status: 401, error: 'Inicia sesión para revisar disputas.' };
    if (deps.isSuperadminEmail(user.email)) {
        return { ok: true, role: 'superadmin', userId: user.id, email: user.email, name: 'Backoffice' };
    }
    try {
        const agent = await deps.repo.getActiveSupportUser(user.id);
        if (agent) return { ok: true, role: 'support', userId: user.id, email: agent.email || user.email, name: agent.full_name || '' };
    } catch (err) {
        console.warn('[disputas] support lookup failed:', err.message);
        return { ok: false, status: 500, error: 'No pudimos verificar tu acceso. Inténtalo de nuevo.' };
    }
    return { ok: false, status: 403, error: 'Solo el equipo de soporte de We Ötzi revisa disputas.' };
}

function failure(res, err, tag, fallback) {
    if (isMissingSchemaError(err)) {
        return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: 'Las disputas todavía no están disponibles (falta aplicar una migración).' });
    }
    console.error(`[disputas] ${tag} failed:`, String((err && err.message) || err).slice(0, 300));
    return res.status(500).json({ success: false, error: fallback });
}

function ticketIdOf(req) {
    const id = String((req.params && req.params.ticketId) || '');
    return D.isUuid(id) ? id : null;
}

async function listHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const parsed = D.parseListQuery(req.query);
    if (!parsed.ok) return res.status(parsed.status).json({ success: false, error: parsed.error });
    try {
        const [rows, active] = await Promise.all([
            deps.repo.listDisputeTickets({ statuses: parsed.value.statuses }),
            deps.repo.countActiveDisputes().catch(() => null),
        ]);
        return res.json({
            success: true,
            status: parsed.value.status,
            reviewer: { role: auth.role },
            active_count: active,
            disputes: (rows || []).map(D.summarizeDispute),
        });
    } catch (err) {
        if (isMissingSchemaError(err)) {
            return res.json({ success: true, status: parsed.value.status, disputes: [], active_count: 0, migration_pending: true });
        }
        return failure(res, err, 'list', 'No pudimos cargar las disputas.');
    }
}

async function detailHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const ticketId = ticketIdOf(req);
    if (!ticketId) return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
    try {
        const row = await deps.repo.getDisputeTicket(ticketId);
        if (!row || !row.ticket) return res.status(404).json({ success: false, error: 'No encontramos esa disputa.' });
        const messages = await deps.repo.listTicketMessages(ticketId);
        const names = await deps.repo.supportNamesByIds((messages || []).map((m) => m.author_user_id)).catch(() => new Map());
        const ticket = row.ticket;
        return res.json({
            success: true,
            dispute: {
                ...D.summarizeDispute(row),
                description: ticket.description || '',
                desired_outcome: ticket.desired_outcome || null,
                resolution: ticket.resolution || null,
                resolution_outcome: ticket.resolution_outcome || null,
                messages: (messages || []).map((m) => ({
                    id: m.id,
                    author_role: m.author_role,
                    is_internal: m.is_internal === true,
                    author_name: m.author_role === 'support' ? D.cleanLine(names.get(m.author_user_id), 120) : '',
                    mine: Boolean(m.author_user_id && m.author_user_id === auth.userId),
                    body: m.body || '',
                    created_at: m.created_at,
                })),
            },
        });
    } catch (err) {
        return failure(res, err, 'detail', 'No pudimos abrir la disputa.');
    }
}

// Correo a las dos partes con lo que decidió soporte. Nunca rompe el guardado.
async function notifyParties(req, row, updated, { notice, resolution, outcome }) {
    const quote = row.quote;
    if (!quote) return { ok: true, skipped: true };
    const [artist, shortCode] = await Promise.all([
        quote.artist_id ? Promise.resolve().then(() => deps.repo.getArtist(quote.artist_id)).catch(() => null) : null,
        quote.id != null ? Promise.resolve().then(() => deps.repo.getShortCode(quote.id)).catch(() => null) : null,
    ]);
    const coded = shortCode ? Object.assign({}, quote, { short_code: shortCode }) : quote;
    const payload = Sesiones.emailPayload(coded, artist, row.session || {}, {
        app_base_url: deps.applicationBase(req),
        dispute_decision: notice,
        dispute_scope: row.link ? 'session' : 'quotation',
        dispute_reason_label: D.reasonLabel(row.ticket.dispute_reason || (row.link && row.link.reason) || ''),
        dispute_outcome_label: D.OUTCOME_LABELS[outcome] || '',
        dispute_resolution: resolution,
        opened_by_role: row.ticket.requester_role === 'artist' ? 'artist' : 'client',
        ticket_number: row.ticket.ticket_number,
    });
    const stamp = (notice === 'resolved' ? updated.resolved_at : updated.closed_at) || updated.updated_at || '';
    return deps.sendEmail(EVENT_RESOLVED, payload, { idempotencyKey: `disputa:${row.ticket.id}:${notice}:${stamp}` });
}

async function statusHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const ticketId = ticketIdOf(req);
    if (!ticketId) return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
    try {
        const row = await deps.repo.getDisputeTicket(ticketId);
        if (!row || !row.ticket) return res.status(404).json({ success: false, error: 'No encontramos esa disputa.' });
        const parsed = D.parseStatusInput(req.body, row.ticket);
        if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
        const { status, resolution, outcome } = parsed.value;
        const previous = row.ticket.status;
        const patch = { status };
        if (resolution) patch.resolution = resolution;
        if (outcome) patch.resolution_outcome = outcome;
        if (!row.ticket.assigned_support_user_id) patch.assigned_support_user_id = auth.userId;
        const updated = await deps.repo.updateDisputeTicket(ticketId, patch);
        if (!updated) return res.status(404).json({ success: false, error: 'No encontramos esa disputa.' });

        if (previous !== status || resolution) {
            const lines = [];
            if (previous !== status) lines.push(`Estado: ${D.STATUS_LABELS[previous] || previous} → ${D.STATUS_LABELS[status] || status}.`);
            if (resolution) lines.push(`Resolución${outcome ? ` (${D.OUTCOME_LABELS[outcome]})` : ''}: ${resolution}`);
            await deps.repo.addTicketMessage({
                ticketId, authorUserId: auth.userId, authorRole: 'support', body: lines.join('\n').slice(0, 6000), isInternal: true,
            }).catch((err) => console.warn('[disputas] no se guardó la nota de estado:', err.message));
        }

        // Aviso a las partes solo cuando la disputa deja de estar activa.
        const notice = D.closingNotice(previous, status);
        let notified = false;
        if (notice) {
            try {
                const result = await notifyParties(req, row, updated, { notice, resolution: resolution || row.ticket.resolution || '', outcome: outcome || row.ticket.resolution_outcome || '' });
                notified = !!(result && result.ok && !result.skipped);
                if (result && result.ok === false) console.warn('[disputas] aviso a las partes no enviado:', result.error || '');
            } catch (err) {
                console.warn('[disputas] aviso a las partes falló:', err && err.message);
            }
        }
        console.log(`[disputas] ticket ${D.ticketCode(updated.ticket_number)} ${previous} → ${status} por ${auth.role} ${auth.userId}`);
        return res.json({
            success: true,
            parties_notified: notified,
            ticket: {
                id: updated.id,
                code: D.ticketCode(updated.ticket_number),
                status: updated.status,
                status_label: D.STATUS_LABELS[updated.status] || '',
                resolution: updated.resolution || null,
                resolution_outcome: updated.resolution_outcome || null,
                assigned: !!updated.assigned_support_user_id,
                last_activity_at: updated.last_activity_at || null,
                resolved_at: updated.resolved_at || null,
                closed_at: updated.closed_at || null,
            },
        });
    } catch (err) {
        return failure(res, err, 'status', 'No pudimos guardar el estado.');
    }
}

async function noteHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const ticketId = ticketIdOf(req);
    if (!ticketId) return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
    const parsed = D.parseNoteInput(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
    try {
        const row = await deps.repo.getDisputeTicket(ticketId);
        if (!row || !row.ticket) return res.status(404).json({ success: false, error: 'No encontramos esa disputa.' });
        const message = await deps.repo.addTicketMessage({
            ticketId, authorUserId: auth.userId, authorRole: 'support', body: parsed.value.note, isInternal: true,
        });
        return res.status(201).json({
            success: true,
            message: message ? {
                id: message.id, author_role: message.author_role, is_internal: true, mine: true,
                body: message.body, created_at: message.created_at,
            } : null,
        });
    } catch (err) {
        return failure(res, err, 'note', 'No pudimos guardar la nota.');
    }
}

function register(app, overrides) {
    if (!app) throw new Error('[disputas] falta la app de Express');
    if (overrides && typeof overrides === 'object') {
        for (const key of Object.keys(deps)) {
            if (overrides[key] !== undefined) deps[key] = overrides[key];
        }
    }
    app.get('/api/support/disputes', listHandler);
    app.get('/api/support/disputes/:ticketId', detailHandler);
    app.post('/api/support/disputes/:ticketId/status', statusHandler);
    app.post('/api/support/disputes/:ticketId/notes', noteHandler);
}

module.exports = {
    register,
    authorizeReviewer,
    _internal: { setDeps, deps, listHandler, detailHandler, statusHandler, noteHandler, notifyParties, EVENT_RESOLVED },
};
