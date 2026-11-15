'use strict';

// ===========================================================================
// Rutas de denuncias → tickets de soporte (ronda 2 · frente "denuncias", P33).
// ---------------------------------------------------------------------------
// Se registran desde server.js con una sola línea:
//   require('./lib/routes/denuncias').register(app);
//
// Persona con sesión (Bearer):
//   GET  /api/reports/eligibility?kind=quotation|artist|studio&id=<ref>
//        ¿Puede denunciar esto? Devuelve los motivos del tipo. La usa
//        public/shared/js/wo-report.js para mostrar u ocultar el botón.
//   POST /api/reports   { kind, target_id, reason, description, links[], attachments[], page_context }
//        Valida quién denuncia qué, arma el expediente con service-role y
//        crea el ticket (RPC create_support_report: deduplica denuncias
//        abiertas iguales y aplica el tope diario). Avisa a soporte y manda
//        el acuse al denunciante.
//
// Soporte (agente activo de support_users_db o superadmin del backoffice):
//   GET  /api/support/reports?status=active|open|in_progress|waiting_user|resolved|closed|all&kind=all|quotation|artist|studio
//   GET  /api/support/reports/:ticketId            expediente completo + evidencia firmada + notas
//   POST /api/support/reports/:ticketId/status     { status, resolution, outcome }
//   POST /api/support/reports/:ticketId/notes      { note }   (nota interna)
//
// Reglas de quién denuncia qué:
//   · cotización → solo el artista que la recibió (quotations_db.artist_id).
//   · artista    → solo otro artista (artists_db del denunciante).
//   · estudio    → solo el dueño o un manager activo de OTRO estudio.
//   · nadie se denuncia a sí mismo.
// El denunciado nunca queda como counterpart del ticket: no ve la denuncia.
// Lógica pura en lib/denuncias.js; datos en lib/repos/denuncias.js; emails en
// services/email-events/denuncias.js.
// ===========================================================================

const rateLimit = require('express-rate-limit');
const { resolveBearerUser, isSuperadminEmail } = require('../auth/supabase-auth');
const { DenunciasRepo, isMissingSchemaError, pgErrorCode, pgErrorMessage } = require('../repos/denuncias');
const D = require('../denuncias');
const { applicationBase } = require('../../services/email-request-context');

const EVENT_SUPPORT = 'report_ticket_created_support';
const EVENT_RECEIPT = 'report_ticket_received';
const MIGRATION_PENDING_ERROR = 'Las denuncias todavía no están disponibles (falta aplicar una migración).';
const PRIORITY_LABELS = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const DOSSIER_MAX_BYTES = 480 * 1024;
const SIGNED_CHAT_ATTACHMENTS_MAX = 20;

// Dependencias reemplazables desde los tests.
const deps = {
    repo: DenunciasRepo,
    resolveBearerUser,
    isSuperadminEmail,
    sendEmail: (...args) => require('../../services/email-service').sendEmail(...args),
    applicationBase,
    now: () => new Date()
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

// --- Autorización del denunciante -------------------------------------------------

function deny(status, code, error) {
    return { ok: false, status, code, error };
}

// Resuelve quién denuncia y a quién. { ok:true, … } | { ok:false, status, code, error }
async function resolveReportContext(user, kind, target) {
    const repo = deps.repo;
    // Primero quién denuncia: la mayoría de las visitas (clientes, público con
    // sesión) se descarta acá sin leer el objetivo.
    if (kind === 'quotation') {
        const artist = await repo.getArtistByUserId(user.id);
        if (!artist) return deny(403, 'NOT_ALLOWED', 'Solo el artista que recibió la cotización puede denunciarla.');
        const quotation = await repo.findQuotation(target);
        // La misma respuesta si no existe o si es de otro artista: no revela cotizaciones ajenas.
        if (!quotation || quotation.artist_id !== user.id) {
            return deny(404, 'NOT_FOUND', 'No encontramos esa cotización entre las tuyas.');
        }
        if (quotation.client_user_id && quotation.client_user_id === user.id) {
            return deny(409, 'SELF_REPORT', 'No puedes denunciar una cotización que creaste tú.');
        }
        return {
            ok: true,
            kind,
            reporterRole: 'artist',
            requesterRole: 'artist',
            reporterArtist: artist,
            reporterStudio: null,
            quotation,
            targetKey: D.targetKey('quotation', quotation.id),
            targetLabel: `Cotización ${D.cleanLine(quotation.quote_id, 60)}`
        };
    }

    if (kind === 'artist') {
        const artist = await repo.getArtistByUserId(user.id);
        if (!artist) return deny(403, 'NOT_ALLOWED', 'Solo los artistas pueden denunciar el perfil de otro artista.');
        const reported = await repo.findArtist(target);
        if (!reported) return deny(404, 'NOT_FOUND', 'No encontramos ese perfil de artista.');
        if (reported.user_id === user.id || reported.id === artist.id) {
            return deny(409, 'SELF_REPORT', 'No puedes denunciar tu propio perfil.');
        }
        return {
            ok: true,
            kind,
            reporterRole: 'artist',
            requesterRole: 'artist',
            reporterArtist: artist,
            reporterStudio: null,
            reportedArtist: reported,
            targetKey: D.targetKey('artist', reported.user_id || reported.id),
            targetLabel: D.cleanLine(reported.name || reported.username, 120) || 'Artista'
        };
    }

    if (kind === 'studio') {
        const administered = await repo.listAdministeredStudios(user.id);
        if (!administered.length) {
            return deny(403, 'NOT_ALLOWED', 'Solo quienes administran un estudio pueden denunciar a otro estudio.');
        }
        const [reported, artist] = await Promise.all([repo.findStudio(target), repo.getArtistByUserId(user.id)]);
        if (!reported) return deny(404, 'NOT_FOUND', 'No encontramos ese estudio.');
        if (reported.user_id === user.id || administered.some((entry) => entry.studio.id === reported.id)) {
            return deny(409, 'SELF_REPORT', 'No puedes denunciar un estudio que administras.');
        }
        const own = administered.find((entry) => entry.role === 'studio_owner') || administered[0];
        return {
            ok: true,
            kind,
            reporterRole: own.role,
            // support_tickets.requester_role solo admite artist | client.
            requesterRole: artist ? 'artist' : 'client',
            reporterArtist: artist || null,
            reporterStudio: own.studio,
            reportedStudio: reported,
            targetKey: D.targetKey('studio', reported.id),
            targetLabel: D.cleanLine(reported.name, 120) || 'Estudio'
        };
    }

    return deny(400, 'INVALID_KIND', 'No reconocemos qué quieres denunciar.');
}

async function authContact(userId) {
    if (!D.isUuid(userId)) return null;
    try { return await deps.repo.getAuthUserContact(userId); } catch (err) {
        console.warn('[denuncias] auth lookup failed:', err.message);
        return null;
    }
}

// Ficha del denunciante para el expediente.
async function buildReporter(user, ctx) {
    const contact = await authContact(user.id);
    const artist = D.pickArtist(ctx.reporterArtist);
    const studio = D.pickStudio(ctx.reporterStudio);
    const isStudio = ctx.reporterRole !== 'artist';
    const personName = D.cleanLine((artist && artist.name) || (contact && contact.full_name), 160);
    return {
        user_id: user.id,
        role: ctx.reporterRole,
        role_label: D.REPORTER_ROLE_LABELS[ctx.reporterRole] || '',
        name: isStudio ? (D.cleanLine(studio && studio.name, 160) || personName) : personName,
        contact_name: personName,
        email: D.cleanLine((contact && contact.email) || user.email, 200).toLowerCase(),
        email_confirmed: Boolean(contact && contact.email_confirmed_at),
        profile_path: isStudio ? ((studio && studio.profile_path) || '') : ((artist && artist.profile_path) || ''),
        artist,
        studio
    };
}

// Ficha del denunciado para el expediente.
async function buildReported(ctx) {
    if (ctx.kind === 'quotation') {
        const q = ctx.quotation;
        const [contact, clientRow] = q.client_user_id
            ? await Promise.all([authContact(q.client_user_id), deps.repo.getClientByUserId(q.client_user_id).catch(() => null)])
            : [null, null];
        const client = D.pickClient(clientRow);
        return {
            user_id: q.client_user_id || null,
            role: 'client',
            role_label: D.REPORTED_ROLE_LABELS.client,
            name: D.cleanLine((client && client.name) || q.client_full_name, 160) || 'Cliente sin nombre',
            email: D.cleanLine((contact && contact.email) || (client && client.email) || q.client_email, 200).toLowerCase(),
            has_account: Boolean(q.client_user_id),
            profile_path: '',
            client
        };
    }
    if (ctx.kind === 'artist') {
        const row = ctx.reportedArtist;
        const contact = await authContact(row.user_id);
        const artist = D.pickArtist(row);
        return {
            user_id: row.user_id || null,
            role: 'artist',
            role_label: D.REPORTED_ROLE_LABELS.artist,
            name: artist.name || artist.username || 'Artista',
            email: D.cleanLine((contact && contact.email) || artist.email, 200).toLowerCase(),
            has_account: Boolean(row.user_id),
            profile_path: artist.profile_path,
            artist
        };
    }
    const row = ctx.reportedStudio;
    const contact = await authContact(row.user_id);
    const studio = D.pickStudio(row);
    return {
        user_id: row.user_id || null,
        role: 'studio',
        role_label: D.REPORTED_ROLE_LABELS.studio,
        name: studio.name || 'Estudio',
        contact_name: D.cleanLine(contact && contact.full_name, 160),
        email: D.cleanLine((contact && contact.email) || studio.email, 200).toLowerCase(),
        has_account: Boolean(row.user_id),
        profile_path: studio.profile_path,
        studio
    };
}

async function buildQuotationSnapshot(ctx) {
    if (ctx.kind !== 'quotation') return null;
    const quoteId = ctx.quotation.quote_id;
    const [chat, attachments] = await Promise.all([
        deps.repo.listQuotationMessages(quoteId).catch((err) => {
            console.warn('[denuncias] chat no disponible para el expediente:', err.message);
            return { messages: [], total: 0 };
        }),
        deps.repo.listQuotationAttachments(quoteId).catch(() => [])
    ]);
    return D.pickQuotation(ctx.quotation, { messages: chat.messages, attachments, messagesTotal: chat.total });
}

// El expediente tiene tope de tamaño (CHECK de la tabla): si el chat es muy
// largo se conservan los mensajes más recientes.
function fitDossier(dossier) {
    let size = Buffer.byteLength(JSON.stringify(dossier));
    while (size > DOSSIER_MAX_BYTES && dossier.quotation && dossier.quotation.messages.length > 5) {
        const keep = Math.ceil(dossier.quotation.messages.length / 2);
        dossier.quotation.messages = dossier.quotation.messages.slice(-keep);
        dossier.quotation.messages_truncated = true;
        size = Buffer.byteLength(JSON.stringify(dossier));
    }
    return dossier;
}

function ticketView(result) {
    return {
        id: result.ticket_id || null,
        number: result.ticket_number || null,
        code: D.ticketCode(result.ticket_number),
        status: result.status || 'open',
        created_at: result.created_at || null
    };
}

function receiptRole(reporterRole) {
    return reporterRole === 'artist' ? 'artist' : 'studio';
}

// Aviso a soporte + acuse al denunciante. Nunca rompe la respuesta.
async function notify(req, { ticket, input, reporter, reported, quotation }) {
    const out = { support_notified: false, receipt_sent: false };
    const base = deps.applicationBase(req);
    const common = {
        app_base_url: base,
        ticket_code: ticket.code,
        report_kind_label: D.KIND_LABELS[input.kind] || '',
        reason_label: D.reasonLabel(input.kind, input.reason),
        reported_name: reported.name || '',
        reported_role_label: reported.role_label || '',
        reported_at: ticket.created_at || deps.now().toISOString()
    };
    const tasks = [];

    tasks.push((async () => {
        let supportEmail = String(process.env.SUPPORT_EMAIL || '').trim();
        let supportEmails = [];
        if (!supportEmail) supportEmails = await deps.repo.activeSupportEmails();
        if (!supportEmail && !supportEmails.length) return;
        const result = await deps.sendEmail(EVENT_SUPPORT, {
            ...common,
            support_email: supportEmail,
            support_emails: supportEmails,
            reporter_name: reporter.name || '',
            reporter_role_label: reporter.role_label || '',
            report_quote_id: quotation ? quotation.quote_id : '',
            priority_label: PRIORITY_LABELS[D.priorityFor(input.reason)] || '',
            queue_url: `${base}/support/dashboard#denuncias`
        }, { idempotencyKey: `${EVENT_SUPPORT}:${ticket.id}` });
        out.support_notified = Boolean(result && result.ok);
    })().catch((err) => console.warn('[denuncias] aviso a soporte no enviado:', err.message)));

    if (reporter.email) {
        tasks.push((async () => {
            const result = await deps.sendEmail(EVENT_RECEIPT, {
                ...common,
                recipient_email: reporter.email,
                recipient_name: reporter.contact_name || reporter.name || '',
                recipient_role: receiptRole(reporter.role)
            }, { idempotencyKey: `${EVENT_RECEIPT}:${ticket.id}` });
            out.receipt_sent = Boolean(result && result.ok);
        })().catch((err) => console.warn('[denuncias] acuse no enviado:', err.message)));
    }

    await Promise.all(tasks);
    return out;
}

// --- Handlers del denunciante ------------------------------------------------------

async function eligibilityHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const user = await deps.resolveBearerUser(req);
    if (!user || !user.id) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para enviar una denuncia.' });
    const kind = String((req.query && req.query.kind) || '').trim();
    if (!D.KINDS.includes(kind)) return res.status(400).json({ success: false, code: 'INVALID_KIND', error: 'No reconocemos qué quieres denunciar.' });
    const target = D.parseTargetRef(kind, req.query && req.query.id);
    if (!target) return res.status(400).json({ success: false, code: 'INVALID_TARGET', error: 'No encontramos lo que quieres denunciar.' });
    try {
        const ctx = await resolveReportContext(user, kind, target);
        if (!ctx.ok) {
            return res.json({ success: true, eligible: false, code: ctx.code, message: ctx.error, kind, reasons: [] });
        }
        return res.json({
            success: true,
            eligible: true,
            kind,
            target_label: ctx.targetLabel,
            reporter_role: ctx.reporterRole,
            reasons: D.reasonsFor(kind),
            limits: { description_min: D.DESCRIPTION_MIN, description_max: D.DESCRIPTION_MAX, links: D.MAX_LINKS, images: D.MAX_IMAGES }
        });
    } catch (err) {
        console.error('[denuncias] eligibility failed:', String(err && err.message || err).slice(0, 300));
        return res.status(500).json({ success: false, error: 'No pudimos comprobar si puedes enviar esta denuncia. Inténtalo de nuevo.' });
    }
}

async function submitHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const user = await deps.resolveBearerUser(req);
    if (!user || !user.id) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para enviar una denuncia.' });

    const parsed = D.parseReportInput(req.body, { userId: user.id });
    if (!parsed.ok) return res.status(parsed.status).json({ success: false, code: 'INVALID_INPUT', field: parsed.field, error: parsed.error });
    const input = parsed.value;

    let ctx;
    let reporter;
    let reported;
    let quotation;
    try {
        ctx = await resolveReportContext(user, input.kind, input.target);
        if (!ctx.ok) return res.status(ctx.status).json({ success: false, code: ctx.code, error: ctx.error });
        [reporter, reported, quotation] = await Promise.all([buildReporter(user, ctx), buildReported(ctx), buildQuotationSnapshot(ctx)]);
    } catch (err) {
        console.error('[denuncias] context failed:', String(err && err.message || err).slice(0, 300));
        return res.status(500).json({ success: false, error: 'No pudimos preparar tu denuncia. Inténtalo de nuevo en unos minutos.' });
    }

    const dossier = fitDossier(D.buildDossier({ input, reporter, reported, quotation, now: deps.now() }));
    const report = {
        reporter_user_id: user.id,
        requester_role: ctx.requesterRole,
        reporter_role: ctx.reporterRole,
        reporter_studio_id: ctx.reporterStudio ? ctx.reporterStudio.id : null,
        target_kind: input.kind,
        target_key: ctx.targetKey,
        reason: input.reason,
        reported_user_id: reported.user_id || null,
        reported_role: reported.role,
        reported_studio_id: ctx.reportedStudio ? ctx.reportedStudio.id : null,
        quotation_id: ctx.quotation ? ctx.quotation.id : null,
        quote_id: ctx.quotation ? ctx.quotation.quote_id : null,
        subject: D.buildSubject({ kind: input.kind, reason: input.reason, targetLabel: ctx.targetLabel }),
        description: input.description,
        priority: D.priorityFor(input.reason),
        attachments: input.attachments,
        evidence_links: input.links,
        page_context: input.pageContext,
        dossier
    };

    let result;
    try {
        result = await deps.repo.createReport(report);
    } catch (err) {
        if (isMissingSchemaError(err)) {
            return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
        }
        const code = pgErrorCode(err);
        const message = pgErrorMessage(err);
        if (code === 'WR429') {
            return res.status(429).json({ success: false, code: 'REPORT_DAILY_LIMIT', error: message || 'Llegaste al máximo de denuncias por hoy.' });
        }
        if (code === '22023') {
            return res.status(400).json({ success: false, code: 'INVALID_INPUT', field: /im[aá]gen|adjunt/i.test(message || '') ? 'attachments' : null, error: message || 'Revisa los datos de la denuncia.' });
        }
        console.error('[denuncias] create failed:', String(err && err.message || err).slice(0, 300));
        return res.status(500).json({ success: false, error: 'No pudimos registrar tu denuncia. Inténtalo de nuevo en unos minutos.' });
    }
    if (!result || !result.ticket_id) {
        console.error('[denuncias] create returned no ticket');
        return res.status(500).json({ success: false, error: 'No pudimos registrar tu denuncia. Inténtalo de nuevo en unos minutos.' });
    }

    const ticket = ticketView(result);
    if (result.duplicate) {
        return res.json({
            success: true,
            duplicate: true,
            ticket,
            message: `Ya tienes una denuncia abierta por este mismo motivo (${ticket.code}). Nuestro equipo la está revisando.`
        });
    }

    const emails = await notify(req, { ticket, input, reporter, reported, quotation });
    console.log(`[denuncias] ticket ${ticket.code} (${input.kind}/${input.reason}) creado por ${ctx.reporterRole} ${user.id}`);
    return res.status(201).json({
        success: true,
        duplicate: false,
        ticket,
        receipt_sent: emails.receipt_sent,
        message: `Recibimos tu denuncia. Tu número de ticket es ${ticket.code}.`
    });
}

// --- Soporte -------------------------------------------------------------------------

// Superadmin del backoffice o agente de soporte activo.
async function authorizeReviewer(req) {
    const user = await deps.resolveBearerUser(req);
    if (!user || !user.id) return { ok: false, status: 401, error: 'Inicia sesión para revisar denuncias.' };
    if (deps.isSuperadminEmail(user.email)) {
        return { ok: true, role: 'superadmin', userId: user.id, email: user.email, name: 'Backoffice' };
    }
    try {
        const agent = await deps.repo.getActiveSupportUser(user.id);
        if (agent) return { ok: true, role: 'support', userId: user.id, email: agent.email || user.email, name: agent.full_name || '' };
    } catch (err) {
        console.warn('[denuncias] support lookup failed:', err.message);
        return { ok: false, status: 500, error: 'No pudimos verificar tu acceso. Inténtalo de nuevo.' };
    }
    return { ok: false, status: 403, error: 'Solo el equipo de soporte de We Ötzi revisa denuncias.' };
}

function schemaFailure(res, err, tag, fallback) {
    if (isMissingSchemaError(err)) {
        return res.status(503).json({ success: false, code: 'MIGRATION_PENDING', error: MIGRATION_PENDING_ERROR });
    }
    console.error(`[denuncias] ${tag} failed:`, String(err && err.message || err).slice(0, 300));
    return res.status(500).json({ success: false, error: fallback });
}

async function listHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const parsed = D.parseListQuery(req.query);
    if (!parsed.ok) return res.status(parsed.status).json({ success: false, error: parsed.error });
    try {
        const [rows, active] = await Promise.all([
            deps.repo.listReports({ statuses: parsed.value.statuses, kind: parsed.value.kind }),
            deps.repo.countActiveReports().catch(() => null)
        ]);
        return res.json({
            success: true,
            status: parsed.value.status,
            kind: parsed.value.kind,
            reviewer: { role: auth.role },
            active_count: active,
            reports: rows.map(D.summarizeReport)
        });
    } catch (err) {
        if (isMissingSchemaError(err)) {
            return res.json({ success: true, status: parsed.value.status, kind: parsed.value.kind, reports: [], active_count: 0, migration_pending: true });
        }
        return schemaFailure(res, err, 'list', 'No pudimos cargar las denuncias.');
    }
}

// Evidencia del ticket con URL firmada; la ruta de Storage no viaja al navegador.
async function signEvidence(ticket, reporterUserId) {
    const list = Array.isArray(ticket.attachments) ? ticket.attachments : [];
    const prefix = `${reporterUserId}/`;
    return Promise.all(list.filter((a) => a && typeof a.path === 'string' && a.path.startsWith(prefix) && !a.path.includes('..'))
        .map(async (a) => ({
            name: D.cleanLine(a.name, 120) || 'imagen',
            type: D.cleanLine(a.type, 80),
            size: Number(a.size) || 0,
            url: await deps.repo.signObject(deps.repo.ATTACHMENTS_BUCKET, a.path)
        })));
}

// Adjuntos del chat de la cotización (bucket privado chat-attachments, ruta `<quote_id>/…`).
async function signChatAttachments(quotation) {
    if (!quotation || !Array.isArray(quotation.messages) || !quotation.quote_id) return quotation;
    const prefix = `${quotation.quote_id}/`;
    let signed = 0;
    const messages = await Promise.all(quotation.messages.map(async (m) => {
        const { attachment_path: path, ...rest } = m || {};
        let url = null;
        if (typeof path === 'string' && path.startsWith(prefix) && !path.includes('..') && signed < SIGNED_CHAT_ATTACHMENTS_MAX) {
            signed += 1;
            url = await deps.repo.signObject(deps.repo.CHAT_BUCKET, path);
        }
        return { ...rest, has_attachment: Boolean(path), attachment_url: url };
    }));
    return { ...quotation, messages };
}

async function detailHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const ticketId = String((req.params && req.params.ticketId) || '');
    if (!D.isUuid(ticketId)) return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
    try {
        const row = await deps.repo.getReportByTicket(ticketId);
        if (!row || !row.ticket) return res.status(404).json({ success: false, error: 'No encontramos esa denuncia.' });
        const ticket = row.ticket;
        const dossier = row.dossier && typeof row.dossier === 'object' ? { ...row.dossier } : {};
        const [evidence, quotation, messages] = await Promise.all([
            signEvidence(ticket, row.reporter_user_id),
            signChatAttachments(dossier.quotation || null),
            deps.repo.listTicketMessages(ticketId)
        ]);
        const authorNames = await deps.repo.supportNamesByIds((messages || []).map((m) => m.author_user_id)).catch(() => new Map());
        // Las rutas de Storage se quedan en el servidor.
        dossier.quotation = quotation;
        dossier.evidence = {
            links: Array.isArray(row.evidence_links) ? row.evidence_links.filter((l) => typeof l === 'string') : [],
            attachments: evidence
        };
        return res.json({
            success: true,
            report: {
                ...D.summarizeReport(row),
                description: ticket.description || '',
                page_context: ticket.page_context || null,
                resolution: ticket.resolution || null,
                resolution_outcome: ticket.resolution_outcome || null,
                closed_at: ticket.closed_at || null,
                dossier,
                messages: (messages || []).map((m) => ({
                    id: m.id,
                    author_role: m.author_role,
                    is_internal: m.is_internal === true,
                    author_name: m.author_role === 'support' ? D.cleanLine(authorNames.get(m.author_user_id), 120) : '',
                    mine: Boolean(m.author_user_id && m.author_user_id === auth.userId),
                    body: m.body || '',
                    created_at: m.created_at
                }))
            }
        });
    } catch (err) {
        return schemaFailure(res, err, 'detail', 'No pudimos abrir la denuncia.');
    }
}

async function statusHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const ticketId = String((req.params && req.params.ticketId) || '');
    if (!D.isUuid(ticketId)) return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
    const parsed = D.parseStatusInput(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
    const { status, resolution, outcome } = parsed.value;
    try {
        const row = await deps.repo.getReportByTicket(ticketId);
        if (!row || !row.ticket) return res.status(404).json({ success: false, error: 'No encontramos esa denuncia.' });
        const previous = row.ticket.status;
        const patch = { status };
        if (resolution) patch.resolution = resolution;
        if (outcome) patch.resolution_outcome = outcome;
        if (!row.ticket.assigned_support_user_id && status !== 'open') patch.assigned_support_user_id = auth.userId;
        const updated = await deps.repo.updateReportTicket(ticketId, patch);
        if (!updated) return res.status(404).json({ success: false, error: 'No encontramos esa denuncia.' });

        if (previous !== status || resolution) {
            const lines = [];
            if (previous !== status) {
                lines.push(`Estado: ${D.STATUS_LABELS[previous] || previous} → ${D.STATUS_LABELS[status] || status}.`);
            }
            if (resolution) lines.push(`Resolución${outcome ? ` (${D.OUTCOME_LABELS[outcome]})` : ''}: ${resolution}`);
            await deps.repo.addTicketMessage({
                ticketId, authorUserId: auth.userId, authorRole: 'support', body: lines.join('\n').slice(0, 6000), isInternal: true
            }).catch((err) => console.warn('[denuncias] no se guardó la nota de estado:', err.message));
        }
        console.log(`[denuncias] ticket ${D.ticketCode(updated.ticket_number)} ${previous} → ${status} por ${auth.role} ${auth.userId}`);
        return res.json({
            success: true,
            ticket: {
                id: updated.id,
                code: D.ticketCode(updated.ticket_number),
                status: updated.status,
                status_label: D.STATUS_LABELS[updated.status] || '',
                resolution: updated.resolution || null,
                resolution_outcome: updated.resolution_outcome || null,
                assigned_support_user_id: updated.assigned_support_user_id || null,
                last_activity_at: updated.last_activity_at || null,
                resolved_at: updated.resolved_at || null,
                closed_at: updated.closed_at || null
            }
        });
    } catch (err) {
        return schemaFailure(res, err, 'status', 'No pudimos guardar el estado.');
    }
}

async function noteHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const auth = await authorizeReviewer(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });
    const ticketId = String((req.params && req.params.ticketId) || '');
    if (!D.isUuid(ticketId)) return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
    const parsed = D.parseNoteInput(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ success: false, field: parsed.field, error: parsed.error });
    try {
        const row = await deps.repo.getReportByTicket(ticketId);
        if (!row || !row.ticket) return res.status(404).json({ success: false, error: 'No encontramos esa denuncia.' });
        const message = await deps.repo.addTicketMessage({
            ticketId, authorUserId: auth.userId, authorRole: 'support', body: parsed.value.note, isInternal: true
        });
        return res.status(201).json({
            success: true,
            message: message ? {
                id: message.id, author_role: message.author_role, is_internal: true, mine: true,
                body: message.body, created_at: message.created_at
            } : null
        });
    } catch (err) {
        return schemaFailure(res, err, 'note', 'No pudimos guardar la nota.');
    }
}

// --- Registro --------------------------------------------------------------------------

// Tope por IP además del tope diario por persona de la RPC (10 en 24 h).
const submitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'REPORT_RATE_LIMITED', error: 'Enviaste varias denuncias seguidas. Espera un rato y vuelve a intentarlo.' }
});

const eligibilityLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'REPORT_RATE_LIMITED', error: 'Demasiadas consultas seguidas. Espera un momento.' }
});

function register(app, overrides) {
    if (!app) throw new Error('[denuncias] falta la app de Express');
    if (overrides && typeof overrides === 'object') {
        for (const key of Object.keys(deps)) {
            if (overrides[key] !== undefined) deps[key] = overrides[key];
        }
    }
    app.get('/api/reports/eligibility', eligibilityLimiter, eligibilityHandler);
    app.post('/api/reports', submitLimiter, submitHandler);

    app.get('/api/support/reports', listHandler);
    app.get('/api/support/reports/:ticketId', detailHandler);
    app.post('/api/support/reports/:ticketId/status', statusHandler);
    app.post('/api/support/reports/:ticketId/notes', noteHandler);
}

module.exports = {
    register,
    resolveReportContext,
    authorizeReviewer,
    _internal: {
        setDeps, deps, eligibilityHandler, submitHandler, listHandler, detailHandler, statusHandler, noteHandler,
        buildReporter, buildReported, buildQuotationSnapshot, fitDossier, notify, signEvidence, signChatAttachments,
        EVENT_SUPPORT, EVENT_RECEIPT
    }
};
