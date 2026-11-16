'use strict';

// ===========================================================================
// Disputas en el panel de soporte — lógica pura (ronda 2 · P28, REQ-15).
// ---------------------------------------------------------------------------
// Una disputa es un ticket de soporte (support_tickets kind = 'disputa'). Las
// de sesión las abre POST /api/sesiones/:id/dispute (RPC sesiones_open_dispute)
// y quedan vinculadas a la sesión en quotation_session_disputes. Mientras el
// ticket está abierto, el trigger de la base deja la cotización "En disputa"
// (quotations_db.dispute_status = 'open') y el trabajo no se puede completar ni
// cambiar el acuerdo. Soporte la destraba al resolver o cerrar el ticket.
//
// Aquí: validación de la cola y del cambio de estado, y las vistas que viajan
// al navegador. Datos en lib/repos/soporte-disputas.js; rutas en
// lib/routes/soporte-disputas.js.
// ===========================================================================

const { isUuid, cleanLine, cleanMultiline, ticketCode } = require('./denuncias');
const SessionModel = require('../public/shared/js/wo-session-model.js');
const { visibleCode } = require('./quote-code');

const TICKET_STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
const ACTIVE_STATUSES = ['open', 'in_progress', 'waiting_user'];
// 'open' no se elige a mano: una disputa cerrada se reabre pasándola a "En revisión".
const SETTABLE_STATUSES = ['in_progress', 'waiting_user', 'resolved', 'closed'];
const STATUS_LABELS = {
    open: 'Abierta', in_progress: 'En revisión', waiting_user: 'Esperando a las partes', resolved: 'Resuelta', closed: 'Cerrada',
};
const OUTCOMES = ['a_favor_cliente', 'a_favor_artista', 'acuerdo', 'sin_accion', 'resuelto'];
const OUTCOME_LABELS = {
    a_favor_cliente: 'A favor del cliente', a_favor_artista: 'A favor del artista', acuerdo: 'Acuerdo entre las partes',
    sin_accion: 'Sin acción', resuelto: 'Resuelta',
};
// Motivos de support_tickets.dispute_reason que no son de sesión (centro de soporte).
const EXTRA_REASON_LABELS = { diseno: 'Diseño' };
const ROLE_LABELS = { client: 'Cliente', artist: 'Artista' };
const PRIORITY_LABELS = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const RESOLUTION_MIN = 10;
const RESOLUTION_MAX = 4000;
const NOTE_MAX = 4000;

function reasonLabel(reason) {
    return SessionModel.disputeReasonLabel(reason) || EXTRA_REASON_LABELS[reason] || cleanLine(reason, 60);
}

// ?status=active|open|in_progress|waiting_user|resolved|closed|all
function parseListQuery(query) {
    const q = query && typeof query === 'object' ? query : {};
    const status = String(q.status || 'active').trim();
    if (status === 'active') return { ok: true, value: { status, statuses: ACTIVE_STATUSES.slice() } };
    if (status === 'all') return { ok: true, value: { status, statuses: null } };
    if (!TICKET_STATUSES.includes(status)) return { ok: false, status: 400, error: 'Estado inválido.' };
    return { ok: true, value: { status, statuses: [status] } };
}

// { status, resolution, outcome }. `current` es el ticket guardado: cerrar una
// disputa que nunca se resolvió también pide explicar por qué.
function parseStatusInput(body, current) {
    const b = body && typeof body === 'object' ? body : {};
    const ticket = current && typeof current === 'object' ? current : {};
    const status = String(b.status || '').trim();
    if (!SETTABLE_STATUSES.includes(status)) return { ok: false, status: 400, field: 'status', error: 'Elige un estado válido.' };
    const closing = status === 'resolved' || status === 'closed';
    if (!closing) return { ok: true, value: { status, resolution: '', outcome: '' } };

    const resolution = cleanMultiline(b.resolution, RESOLUTION_MAX + 1);
    if (resolution.length > RESOLUTION_MAX) {
        return { ok: false, status: 400, field: 'resolution', error: `La resolución puede tener hasta ${RESOLUTION_MAX} caracteres.` };
    }
    let outcome = String(b.outcome || '').trim();
    if (outcome && !OUTCOMES.includes(outcome)) return { ok: false, status: 400, field: 'outcome', error: 'Elige un resultado válido.' };
    const alreadyResolved = ticket.status === 'resolved' && String(ticket.resolution || '').trim() !== '';
    if (status === 'resolved') {
        if (!outcome) return { ok: false, status: 400, field: 'outcome', error: 'Indica cómo se resolvió la disputa.' };
        if (resolution.length < RESOLUTION_MIN) {
            return { ok: false, status: 400, field: 'resolution', error: `Escribe qué se resolvió (mínimo ${RESOLUTION_MIN} caracteres): las dos partes lo reciben por correo.` };
        }
    } else if (!alreadyResolved) {
        if (resolution.length < RESOLUTION_MIN) {
            return { ok: false, status: 400, field: 'resolution', error: `Escribe por qué se cierra sin resolver (mínimo ${RESOLUTION_MIN} caracteres): las dos partes lo reciben por correo.` };
        }
        if (!outcome) outcome = 'sin_accion';
    }
    return { ok: true, value: { status, resolution, outcome } };
}

function parseNoteInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const note = cleanMultiline(b.note != null ? b.note : b.body, NOTE_MAX + 1);
    if (!note) return { ok: false, status: 400, field: 'note', error: 'Escribe la nota antes de guardarla.' };
    if (note.length > NOTE_MAX) return { ok: false, status: 400, field: 'note', error: `La nota puede tener hasta ${NOTE_MAX} caracteres.` };
    return { ok: true, value: { note } };
}

// ¿El cambio de estado se le avisa a las partes? Solo cuando la disputa deja
// de estar activa: resolverla, o cerrarla sin haberla resuelto antes.
function closingNotice(previousStatus, nextStatus) {
    if (!ACTIVE_STATUSES.includes(previousStatus)) return null;
    if (nextStatus === 'resolved') return 'resolved';
    if (nextStatus === 'closed') return 'closed';
    return null;
}

function partyView(role, quote) {
    const q = quote || {};
    if (role === 'artist') {
        return { role, role_label: ROLE_LABELS.artist, name: cleanLine(q.artist_name, 120), username: cleanLine(q.artist_username, 60), email: cleanLine(q.artist_email, 200), user_id: q.artist_id || null };
    }
    return { role: 'client', role_label: ROLE_LABELS.client, name: cleanLine(q.client_full_name, 120), username: '', email: cleanLine(q.client_email, 200), user_id: q.client_user_id || null };
}

function sessionSummary(session) {
    if (!session) return null;
    return {
        id: session.id,
        session_number: session.session_number != null ? session.session_number : null,
        session_date: session.session_date || null,
        duration_hours: session.duration_hours != null ? Number(session.duration_hours) : null,
        status: session.status || '',
        client_confirmation: session.client_confirmation || '',
        location: cleanLine(session.location, 300),
    };
}

// Fila de la cola. row: { ticket, link (quotation_session_disputes), session, quote }
function summarizeDispute(row) {
    const r = row || {};
    const t = r.ticket || {};
    const q = r.quote || null;
    const openerRole = t.requester_role === 'artist' ? 'artist' : 'client';
    const otherRole = openerRole === 'artist' ? 'client' : 'artist';
    return {
        ticket_id: t.id,
        code: ticketCode(t.ticket_number),
        ticket_number: t.ticket_number != null ? Number(t.ticket_number) : null,
        status: t.status,
        status_label: STATUS_LABELS[t.status] || '',
        priority: t.priority || 'normal',
        subject: cleanLine(t.subject, 160),
        reason: t.dispute_reason || (r.link && r.link.reason) || '',
        reason_label: reasonLabel(t.dispute_reason || (r.link && r.link.reason) || ''),
        scope: r.link ? 'session' : 'quotation',
        quote_id: (q && q.quote_id) || t.quote_id || '',
        quote_code: q ? visibleCode(q) : (t.quote_id || ''),
        quote_status: (q && q.quote_status) || '',
        dispute_status: (q && q.dispute_status) || '',
        opened_by: partyView(openerRole, q),
        counterpart: partyView(otherRole, q),
        session: sessionSummary(r.session),
        assigned: !!t.assigned_support_user_id,
        created_at: t.created_at || null,
        last_activity_at: t.last_activity_at || null,
        resolved_at: t.resolved_at || null,
        closed_at: t.closed_at || null,
    };
}

module.exports = {
    TICKET_STATUSES,
    ACTIVE_STATUSES,
    SETTABLE_STATUSES,
    STATUS_LABELS,
    OUTCOMES,
    OUTCOME_LABELS,
    ROLE_LABELS,
    PRIORITY_LABELS,
    RESOLUTION_MIN,
    RESOLUTION_MAX,
    NOTE_MAX,
    isUuid,
    cleanLine,
    ticketCode,
    reasonLabel,
    parseListQuery,
    parseStatusInput,
    parseNoteInput,
    closingNotice,
    summarizeDispute,
};
