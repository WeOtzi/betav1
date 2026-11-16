'use strict';

// ===========================================================================
// Negociación de la cotización (ronda 2 · frente "negociacion") — lógica del
// servidor, sin I/O. La usan lib/routes/negociacion.js y los tests.
// ---------------------------------------------------------------------------
//   P23 · contrapropuesta del cliente sobre la propuesta del artista.
//   P25 · enmiendas del acuerdo aprobado, propuestas por cualquiera de las dos
//         partes y vigentes solo cuando la otra las aprueba.
//
// El modelo (campos, validación, antes → después, permisos) es el mismo que
// usa el navegador: public/shared/js/quotation-negotiation.js. Aquí se suma lo
// propio del servidor: lectura del pedido, permisos con mensajes, el estado
// que ve cada parte, la traducción de los errores de la base (NEG_*) y los
// avisos por email a la contraparte.
//
// La base es la que aplica (negociacion_propose / negociacion_resolve,
// migración 20261116140000): bloquea la cotización, revalida y cambia todo en
// una transacción.
// ===========================================================================

const Model = require('../public/shared/js/quotation-negotiation.js');
const { visibleCode } = require('./quote-code');

const KINDS = Object.freeze(['counter', 'amendment']);
const ACTIONS = Object.freeze(['accept', 'reject', 'withdraw']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function roleHint(value) {
    return value === 'artist' ? 'artist' : value === 'client' ? 'client' : null;
}

function cleanQuoteId(value) {
    const id = String(value == null ? '' : value).trim();
    return id && id.length <= 64 ? id : '';
}

function isUuid(value) {
    return UUID_RE.test(String(value == null ? '' : value));
}

function deny(status, code, error, extra) {
    return Object.assign({ ok: false, status, code, error }, extra || {});
}

function normalizeProposeBody(body) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const kind = String(b.kind || '').trim().toLowerCase();
    if (!KINDS.includes(kind)) return deny(400, 'kind', 'Indica qué quieres proponer.');
    if (!b.changes || typeof b.changes !== 'object' || Array.isArray(b.changes)) {
        return deny(400, 'changes', 'No recibimos los cambios.');
    }
    return { ok: true, kind, changes: b.changes, note: Model.normalizeNote(b.note), hint: roleHint(b.as) };
}

function normalizeResolveBody(action, body) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const act = String(action || '').trim().toLowerCase();
    if (!ACTIONS.includes(act)) return deny(400, 'action', 'Indica qué quieres hacer con la propuesta.');
    return { ok: true, action: act, note: Model.normalizeNote(b.note), hint: roleHint(b.as) };
}

// Por qué no se puede contraproponer / enmendar en el estado actual.
const COUNTER_BLOCK = {
    pending: 'El artista todavía no te envió su propuesta.',
    client_approved: 'Esta cotización ya tiene un acuerdo: propón un cambio al acuerdo.',
    in_progress: 'Esta cotización ya tiene un acuerdo: propón un cambio al acuerdo.',
    en_progreso: 'Esta cotización ya tiene un acuerdo: propón un cambio al acuerdo.',
    artist_completed: 'Esta cotización ya tiene un acuerdo: propón un cambio al acuerdo.',
    client_rejected: 'Rechazaste esta cotización y quedó finalizada. Para retomar la idea, inicia una nueva.',
    completed: 'Esta cotización ya terminó.',
    cancelled: 'El artista canceló esta solicitud.',
    expired: 'La propuesta venció.',
};
const AMEND_BLOCK = {
    pending: 'Todavía no hay un acuerdo aprobado por ambas partes.',
    responded: 'Todavía no hay un acuerdo aprobado por ambas partes.',
    completed: 'El trabajo ya está completado: el acuerdo no se puede cambiar.',
    client_rejected: 'Esta cotización fue rechazada y quedó finalizada.',
    cancelled: 'Esta cotización está cancelada.',
    expired: 'La propuesta venció.',
};

/**
 * Valida una propuesta nueva. extras = { paid, sessionsUsed, manualDepositPct }.
 *   { ok:false, status, code, error, field? }
 *   { ok:true, role, changes }   (changes ya normalizados, solo lo que cambia)
 */
function evaluatePropose({ user, quotation, kind, changes, hint, extras = {}, now = Date.now() }) {
    if (!user) return deny(401, 'auth', 'Inicia sesión para continuar.');
    if (!quotation) return deny(404, 'not_found', 'No encontramos esa cotización.');
    const role = Model.roleOf(quotation, user.id, hint);
    if (!role) return deny(403, 'not_party', 'Esta cotización no corresponde a tu cuenta.');
    const permissions = Model.can(quotation, role, now);

    if (kind === 'counter') {
        if (role !== 'client') return deny(403, 'role', 'Solo el cliente propone cambios sobre la propuesta. Si quieres ajustarla, envía otra propuesta.');
        if (!permissions.counter) {
            if ((quotation.dispute_status || 'none') === 'open') return deny(409, 'dispute', permissions.reason);
            if (Model.isExpired(quotation, now)) return deny(410, 'expired', COUNTER_BLOCK.expired);
            return deny(409, 'status', COUNTER_BLOCK[quotation.quote_status] || 'La cotización cambió de estado. Actualiza la página.');
        }
    } else if (kind === 'amendment') {
        if (!permissions.amend) {
            if ((quotation.dispute_status || 'none') === 'open') return deny(409, 'dispute', permissions.reason);
            if (Model.isAgreed(quotation) && Model.AMENDABLE_STATUSES.includes(quotation.quote_status)) {
                return deny(409, 'no_counterparty', permissions.reason || DB_ERRORS.NEG_NO_COUNTERPARTY[2]);
            }
            return deny(409, 'status', AMEND_BLOCK[quotation.quote_status] || 'Todavía no hay un acuerdo aprobado por ambas partes.');
        }
    } else {
        return deny(400, 'kind', 'Indica qué quieres proponer.');
    }

    const current = Model.currentValues(kind, quotation, extras);
    const checked = Model.normalizeChanges(kind, changes, current, {
        paid: kind === 'amendment' ? extras.paid : null,
        currency: Model.agreementCurrency(quotation),
        sessionsUsed: kind === 'amendment' ? extras.sessionsUsed : null,
    });
    if (!checked.ok) return checked;
    return { ok: true, role, changes: checked.changes };
}

// Lo que ve el navegador de una propuesta (sin ids de usuarios).
function publicProposal(row) {
    if (!row) return null;
    return {
        id: row.id,
        kind: row.kind,
        proposed_by: row.proposed_by,
        status: row.status,
        changes: row.changes && typeof row.changes === 'object' ? row.changes : {},
        currency: row.currency || '',
        note: row.note || '',
        response_note: row.response_note || '',
        base_agreement_version: row.base_agreement_version || 0,
        created_at: row.created_at || null,
        resolved_at: row.resolved_at || null,
    };
}

/**
 * Estado de la negociación para quien mira (GET).
 *   { ok:false, status, code, error } | { ok:true, state }
 */
function stateFor({ user, quotation, proposals, hint, extras = {}, now = Date.now() }) {
    if (!user) return deny(401, 'auth', 'Inicia sesión para continuar.');
    if (!quotation) return deny(404, 'not_found', 'No encontramos esa cotización.');
    const role = Model.roleOf(quotation, user.id, hint);
    if (!role) return deny(403, 'not_party', 'Esta cotización no corresponde a tu cuenta.');
    const permissions = Model.can(quotation, role, now);
    const list = (Array.isArray(proposals) ? proposals : []).map(publicProposal).filter(Boolean);
    return {
        ok: true,
        state: {
            available: true,
            role,
            quote_id: quotation.quote_id,
            quote_status: quotation.quote_status,
            names: { client: quotation.client_full_name || '', artist: quotation.artist_name || '' },
            // P4-saldo: aprobada por ambas partes = agreement.approved.
            agreement: Model.agreementOf(quotation),
            can: { counter: permissions.counter, amend: permissions.amend },
            reason: permissions.reason || '',
            currency: { counter: Model.counterCurrency(quotation), amendment: Model.agreementCurrency(quotation) },
            current: {
                counter: Model.currentValues('counter', quotation, extras),
                amendment: Model.currentValues('amendment', quotation, extras),
            },
            limits: { paid: Number(extras.paid) || 0, sessions_used: Number(extras.sessionsUsed) || 0 },
            pending: list.find((p) => p.status === 'pending') || null,
            proposals: list,
        },
    };
}

// ---------------------------------------------------------------------------
// Errores de la base (raise exception 'NEG_*') → respuesta para la persona.
// ---------------------------------------------------------------------------
const DB_ERRORS = {
    NEG_BAD_REQUEST: [400, 'bad_request', 'No pudimos leer la propuesta. Actualiza la página e inténtalo de nuevo.'],
    NEG_NOT_FOUND: [404, 'not_found', 'No encontramos esa cotización o esa propuesta.'],
    NEG_FORBIDDEN: [403, 'forbidden', 'Esta acción no corresponde a tu cuenta.'],
    NEG_DISPUTE: [409, 'dispute', 'Esta cotización tiene un reclamo abierto. Soporte lo está revisando.'],
    NEG_STATUS: [409, 'status', 'La cotización cambió de estado. Actualiza la página.'],
    NEG_EXPIRED: [410, 'expired', 'La propuesta venció.'],
    NEG_FIELD: [400, 'field', 'Hay un dato que no se puede cambiar desde aquí.'],
    NEG_VALUE: [400, 'value', 'Revisa los datos: hay un valor que no es válido.'],
    NEG_CURRENCY: [409, 'currency', 'La cotización no tiene una moneda válida. Escríbele a soporte.'],
    NEG_BELOW_PAID: [409, 'below_paid', (d) => `El precio no puede ser menor a lo que ya está registrado como pagado${d ? ` (${d})` : ''}.`],
    NEG_BELOW_SESSIONS: [409, 'below_sessions', (d) => `Ya hay ${d || 'más'} sesiones agendadas o realizadas: no se pueden acordar menos.`],
    NEG_NO_CHANGES: [400, 'no_changes', 'No hay cambios respecto de lo que ya está guardado.'],
    NEG_NO_COUNTERPARTY: [409, 'no_counterparty', 'La otra parte todavía no tiene cuenta en We Ötzi para aprobar cambios.'],
    NEG_LIMIT: [429, 'limit', 'Esta cotización ya tiene demasiadas propuestas. Cierren el acuerdo por el chat.'],
    NEG_NOT_PENDING: [409, 'not_pending', 'Esta propuesta ya no está pendiente. Actualiza la página.'],
};

function dbError(err) {
    const message = String((err && err.message) || '');
    const code = (/NEG_[A-Z_]+/.exec(message) || [])[0];
    if (code && DB_ERRORS[code]) {
        const [status, slug, text] = DB_ERRORS[code];
        const detail = (/"details"\s*:\s*"([^"\\]{0,80})"/.exec(message) || [])[1] || '';
        return { ok: false, known: true, status, code: slug, error: typeof text === 'function' ? text(detail) : text, field: slug === 'value' || slug === 'field' ? (detail || null) : null };
    }
    // Función, tabla o columna inexistente: la migración todavía no está aplicada.
    if (isMissingSchema(err)) {
        return { ok: false, known: true, status: 503, code: 'unavailable', error: 'La negociación todavía no está disponible. Inténtalo más tarde.' };
    }
    return { ok: false, known: false, status: 500, code: 'error', error: 'No pudimos guardar el cambio. Inténtalo de nuevo en un momento.' };
}

function isMissingSchema(err) {
    return /PGRST202|PGRST204|PGRST205|42703|42P01|42883|Could not find|does not exist/i.test(String((err && err.message) || ''));
}

// ---------------------------------------------------------------------------
// Avisos a la contraparte (services/email-events/negociacion.js). El relé
// suma el aviso push de cada correo (frente "push").
// ---------------------------------------------------------------------------
const EVENTS = Object.freeze({
    counter: Object.freeze({
        proposed: 'negotiation_counter_proposed',
        accepted: 'negotiation_counter_accepted',
        rejected: 'negotiation_counter_declined',
        withdrawn: 'negotiation_proposal_withdrawn',
    }),
    amendment: Object.freeze({
        proposed: 'negotiation_amendment_proposed',
        accepted: 'negotiation_amendment_accepted',
        rejected: 'negotiation_amendment_rejected',
        withdrawn: 'negotiation_proposal_withdrawn',
    }),
});

function recipientRole(step, proposal) {
    // Propuesta nueva o retirada → se avisa a quien tiene (o tenía) que responder.
    // Aprobada o rechazada → se avisa a quien la propuso.
    return step === 'proposed' || step === 'withdrawn' ? Model.otherRole(proposal.proposed_by) : proposal.proposed_by;
}

function firstName(value) {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return s ? s.split(' ')[0] : '';
}

/**
 * Evento, payload y clave de idempotencia del aviso de un paso.
 *   step: 'proposed' | 'accepted' | 'rejected' | 'withdrawn'
 *   base: applicationBase(req) — nunca viene del navegador.
 * → { eventId, payload, idempotencyKey } | null (sin destinatario)
 */
function emailFor({ step, proposal, quotation, artist, base }) {
    if (!proposal || !quotation) return null;
    const eventId = EVENTS[proposal.kind] && EVENTS[proposal.kind][step];
    if (!eventId) return null;
    const q = quotation;
    const to = recipientRole(step, proposal);
    const from = Model.otherRole(to);
    const artistName = (artist && artist.name) || q.artist_name || '';
    const artistEmail = (artist && artist.email) || q.artist_email || '';
    const names = { artist: artistName, client: q.client_full_name || '' };
    const recipientEmail = to === 'artist' ? artistEmail : (q.client_email || '');
    if (!recipientEmail) return null;
    const enc = encodeURIComponent(q.quote_id || '');
    const root = String(base || '').replace(/\/+$/, '');
    const total = Model.money(
        Model.agreementOf(q).approved && q.final_budget_amount != null && String(q.final_budget_amount).trim() !== '' ? q.final_budget_amount : q.artist_budget_amount,
        Model.agreementCurrency(q)
    );
    const payload = {
        app_base_url: root,
        quote_id: q.quote_id || '',
        // Lo que lee la persona en el asunto y en la fila "Cotización" (CF-03).
        quote_code: visibleCode(q),
        proposal_id: proposal.id,
        proposal_kind: proposal.kind,
        recipient_role: to,
        recipient_email: recipientEmail,
        recipient_user_id: to === 'artist' ? (q.artist_id || null) : (q.client_user_id || null),
        recipient_name: firstName(names[to]),
        actor_role: from,
        actor_name: firstName(names[from]),
        artist_name: artistName,
        client_name: firstName(names.client),
        changes_rows: Model.diffRows(proposal).map((row) => [row.label, `${clip(row.from, 160)} → ${clip(row.to, 160)}`]),
        changes_text: Model.summaryLine(proposal, 600),
        proposal_note: clip(proposal.note, 600),
        response_note: clip(proposal.response_note, 600),
        agreed_total_text: step === 'accepted' ? total : '',
        quotation_url: to === 'artist' ? `${root}/my-quotations/detail?quote=${enc}` : `${root}/client/dashboard?quote=${enc}`,
    };
    return { eventId, payload, idempotencyKey: `negociacion:${proposal.id}:${step}` };
}

function clip(value, max) {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

module.exports = {
    Model,
    KINDS,
    ACTIONS,
    EVENTS,
    cleanQuoteId,
    isUuid,
    roleHint,
    normalizeProposeBody,
    normalizeResolveBody,
    evaluatePropose,
    publicProposal,
    stateFor,
    dbError,
    isMissingSchema,
    recipientRole,
    emailFor,
};
