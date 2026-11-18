'use strict';

// ===========================================================================
// Sanciones de cuentas (fase 1 · 2.7.0) — lógica pura, sin red ni base.
// ---------------------------------------------------------------------------
// Tipos:
//   · warning    (advertencia): solo queda registrada y se avisa por correo.
//                Se aplica al proponerla.
//   · suspension (suspensión): oculta el perfil y bloquea cotizaciones nuevas
//                (sanction_state 'suspended'). No cancela cotizaciones, no
//                bloquea el ingreso ni guarda huellas. Exige fecha de fin.
//   · ban        (cierre permanente): perfil oculto, cotizaciones abiertas
//                canceladas, saldo retenido, huellas de correo/teléfono/
//                Instagram, ingreso bloqueado en Auth y sesiones cerradas.
//
// Dos agentes: un `ban` lo propone un agente y lo confirma OTRO (también lo
// exige un CHECK de account_sanctions). El superadmin del backoffice cuenta
// como agente. Hoy hay un solo agente activo en support_users_db: el segundo
// para confirmar un cierre es el superadmin hasta que el dueño cree otro.
// La suspensión también se confirma (puede hacerlo el mismo agente: es una
// medida urgente y reversible); la advertencia se aplica al proponerla.
//
// Apelación: una sola, dentro de 30 días desde starts_at, con un enlace
// firmado (HMAC con una subclave de BAN_HMAC_KEY, etiqueta 'appeal'). La
// decide un agente que no propuso ni confirmó la sanción.
//
// planApply / planLift: pasos ordenados e idempotentes. Cada paso hecho queda
// en account_sanctions.side_effects ({ steps: {…}, lift: {…} }), así un
// reintento retoma donde quedó y el levantamiento revierte solo lo registrado.
// ===========================================================================

const crypto = require('crypto');
const { deriveKey } = require('./ban-identifiers');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KINDS = ['warning', 'suspension', 'ban'];
const KIND_LABELS = { warning: 'Advertencia', suspension: 'Suspensión', ban: 'Cierre permanente' };
const STATUSES = ['proposed', 'active', 'appealed', 'lifted', 'rejected'];
const STATUS_LABELS = { proposed: 'Propuesta', active: 'Activa', appealed: 'Apelada', lifted: 'Levantada', rejected: 'Descartada' };
// Sanciones que siguen surtiendo efecto (una apelada sigue vigente hasta la decisión).
const EFFECTIVE_STATUSES = ['active', 'appealed'];

// Los 5 motivos de denuncia de perfil + mala fe + otro.
const REASON_CODES = [
    'suplantacion_identidad', 'plagio_diseno', 'robo_propiedad_intelectual', 'difamacion', 'estafa',
    'denuncia_mala_fe', 'otro'
];
const REASON_LABELS = {
    suplantacion_identidad: 'Suplantación de identidad',
    plagio_diseno: 'Plagio de diseños',
    robo_propiedad_intelectual: 'Robo de propiedad intelectual',
    difamacion: 'Difamación',
    estafa: 'Estafa',
    denuncia_mala_fe: 'Denuncia de mala fe',
    otro: 'Otro motivo'
};

const APPEAL_OUTCOMES = ['upheld', 'lifted'];
const APPEAL_OUTCOME_LABELS = { upheld: 'Se mantiene la sanción', lifted: 'Se levanta la sanción' };
// account_sanctions.appeal_outcome guarda si la apelación prosperó:
// 'accepted' (se levanta) o 'rejected' (se mantiene).
const APPEAL_OUTCOME_DB = { upheld: 'rejected', lifted: 'accepted' };
const APPEAL_OUTCOME_API = { rejected: 'upheld', accepted: 'lifted' };

const ALERT_KINDS = ['reentry_blocked', 'image_duplicate', 'refund_needed'];
const ALERT_KIND_LABELS = {
    reentry_blocked: 'Reingreso bloqueado',
    image_duplicate: 'Posible copia de imagen',
    refund_needed: 'Devolución de anticipo'
};
const ALERT_STATUSES = ['open', 'handled', 'dismissed'];
const ALERT_STATUS_LABELS = { open: 'Abierta', handled: 'Gestionada', dismissed: 'Descartada' };

// Cotizaciones que se cancelan al cerrar una cuenta. Quedan fuera
// artist_completed (el trabajo está hecho: decide soporte), completed,
// cancelled y client_rejected (la transición a cancelled no está permitida).
const OPEN_QUOTE_STATUSES = ['pending', 'responded', 'client_approved', 'in_progress', 'en_progreso', 'expired'];
const SUPPORT_CLOSED_REASON = 'El perfil fue dado de baja por soporte.';

const APPEAL_WINDOW_DAYS = 30;
const APPEAL_WINDOW_MS = APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const APPEAL_MIN = 20;
const APPEAL_MAX = 3000;
const SUMMARY_MIN = 10;
const SUMMARY_MAX = 2000;
const NOTE_MIN = 10;
const NOTE_MAX = 2000;
const RESOLUTION_MAX = 2000;
const SUSPENSION_MAX_DAYS = 365;
const APPEAL_TOKEN_LABEL = 'appeal';

const BLOCKED_MESSAGE = 'No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.';

// Pasos por tipo, en orden. Cada nombre es la clave en side_effects.steps.
const APPLY_STEPS = {
    warning: ['activate', 'notice'],
    suspension: ['activate', 'profile', 'notice'],
    ban: ['activate', 'profile', 'quotations', 'client_notices', 'wallet', 'refund_alerts', 'identifiers', 'auth_ban', 'sessions', 'notice'],
    // Cuenta nueva que coincidió con una baneada (blockNewAccount): la crea el
    // sistema ya activa (proposed_by null), sin correo ni huellas nuevas.
    reentry: ['profile', 'auth_ban', 'sessions']
};
const REENTRY_SOURCE = 'reentry';
// Reversión: solo lo que el apply dejó registrado. Las cotizaciones canceladas
// y las alertas de devolución se quedan como están.
const LIFT_STEPS = [
    { step: 'profile', requires: 'profile' },
    { step: 'wallet', requires: 'wallet' },
    { step: 'identifiers', requires: 'identifiers' },
    { step: 'auth_unban', requires: 'auth_ban' },
    { step: 'deactivate', requires: null },
    { step: 'lifted_notice', requires: null }
];

// --- helpers --------------------------------------------------------------------

function isUuid(value) {
    return UUID_RE.test(String(value || ''));
}

function cleanLine(value, max) {
    const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return max ? text.slice(0, max) : text;
}

function cleanText(value, max) {
    const text = String(value == null ? '' : value)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return max ? text.slice(0, max) : text;
}

function fail(field, error, status = 400) {
    return { ok: false, status, field, error };
}

function toDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (value == null || value === '') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function reasonLabel(code) {
    return REASON_LABELS[code] || REASON_LABELS.otro;
}

function sideEffects(sanction) {
    const se = sanction && sanction.side_effects && typeof sanction.side_effects === 'object' ? sanction.side_effects : {};
    return {
        ...se,
        steps: se.steps && typeof se.steps === 'object' ? { ...se.steps } : {},
        lift: se.lift && typeof se.lift === 'object' ? { ...se.lift } : {}
    };
}

// --- entradas -------------------------------------------------------------------

// POST /api/support/sanctions
function parseProposeInput(body, { now = new Date() } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const userId = cleanLine(b.user_id, 64);
    if (!isUuid(userId)) return fail('user_id', 'Elige la cuenta que quieres sancionar.');
    const kind = cleanLine(b.kind, 20);
    if (!KINDS.includes(kind)) return fail('kind', 'Elige el tipo de sanción.');
    const reason = cleanLine(b.reason_code, 40);
    if (!REASON_CODES.includes(reason)) return fail('reason_code', 'Elige el motivo de la sanción.');
    const summary = cleanText(b.summary);
    if (summary.length < SUMMARY_MIN) return fail('summary', `Resume el caso en al menos ${SUMMARY_MIN} caracteres.`);
    if (summary.length > SUMMARY_MAX) return fail('summary', `El resumen puede tener hasta ${SUMMARY_MAX} caracteres.`);
    let ticketId = null;
    if (b.ticket_id != null && b.ticket_id !== '') {
        ticketId = cleanLine(b.ticket_id, 64);
        if (!isUuid(ticketId)) return fail('ticket_id', 'El ticket de la denuncia no es válido.');
    }
    let endsAt = null;
    if (kind === 'suspension') {
        const end = toDate(b.ends_at);
        if (!end) return fail('ends_at', 'Indica hasta cuándo dura la suspensión.');
        const start = toDate(now) || new Date();
        if (end.getTime() <= start.getTime() + 60 * 60 * 1000) return fail('ends_at', 'La suspensión tiene que terminar al menos una hora después de ahora.');
        if (end.getTime() > start.getTime() + SUSPENSION_MAX_DAYS * 24 * 60 * 60 * 1000) {
            return fail('ends_at', `Una suspensión dura como máximo ${SUSPENSION_MAX_DAYS} días. Para más, propón un cierre permanente.`);
        }
        endsAt = end.toISOString();
    }
    return { ok: true, value: { user_id: userId, kind, reason_code: reason, summary, ticket_id: ticketId, ends_at: endsAt } };
}

// POST /api/support/sanctions/:id/confirm  { note? }
function parseConfirmInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const note = cleanText(b.note);
    if (note.length > NOTE_MAX) return fail('note', `La nota puede tener hasta ${NOTE_MAX} caracteres.`);
    return { ok: true, value: { note } };
}

// POST /api/support/sanctions/:id/lift  { note }
function parseLiftInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const note = cleanText(b.note);
    if (note.length < NOTE_MIN) return fail('note', `Explica en al menos ${NOTE_MIN} caracteres por qué se levanta.`);
    if (note.length > NOTE_MAX) return fail('note', `La nota puede tener hasta ${NOTE_MAX} caracteres.`);
    return { ok: true, value: { note } };
}

// POST /api/sanctions/appeal  { t, text }
function parseAppealInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const token = cleanLine(b.t, 600);
    if (!token) return fail('t', 'El enlace de apelación no es válido.');
    const text = cleanText(b.text);
    if (text.length < APPEAL_MIN) return fail('text', `Cuéntanos tu versión en al menos ${APPEAL_MIN} caracteres.`);
    if (text.length > APPEAL_MAX) return fail('text', `Tu apelación puede tener hasta ${APPEAL_MAX} caracteres.`);
    return { ok: true, value: { token, text } };
}

// POST /api/support/sanctions/:id/appeal-decision  { outcome, note }
function parseAppealDecisionInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const outcome = cleanLine(b.outcome, 20);
    if (!APPEAL_OUTCOMES.includes(outcome)) return fail('outcome', 'Elige si la sanción se mantiene o se levanta.');
    const note = cleanText(b.note);
    if (note.length < NOTE_MIN) return fail('note', `Explica la decisión en al menos ${NOTE_MIN} caracteres.`);
    if (note.length > NOTE_MAX) return fail('note', `La nota puede tener hasta ${NOTE_MAX} caracteres.`);
    return { ok: true, value: { outcome, note } };
}

// GET /api/support/sanctions?status=&user=
function parseListQuery(query) {
    const q = query && typeof query === 'object' ? query : {};
    const status = cleanLine(q.status, 20) || 'all';
    if (status !== 'all' && !STATUSES.includes(status)) return fail('status', 'Filtro de estado inválido.');
    const user = cleanLine(q.user, 64);
    if (user && !isUuid(user)) return fail('user', 'ID de usuario inválido.');
    return { ok: true, value: { status, user: user || null } };
}

// GET /api/support/security-alerts?status=&kind=
function parseAlertListQuery(query) {
    const q = query && typeof query === 'object' ? query : {};
    const status = cleanLine(q.status, 20) || 'open';
    if (status !== 'all' && !ALERT_STATUSES.includes(status)) return fail('status', 'Filtro de estado inválido.');
    const kind = cleanLine(q.kind, 30) || 'all';
    if (kind !== 'all' && !ALERT_KINDS.includes(kind)) return fail('kind', 'Filtro de tipo inválido.');
    return { ok: true, value: { status, kind } };
}

// POST /api/support/security-alerts/:id  { status, resolution }
function parseAlertUpdateInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const status = cleanLine(b.status, 20);
    if (status !== 'handled' && status !== 'dismissed') return fail('status', 'Elige si la alerta quedó gestionada o descartada.');
    const resolution = cleanText(b.resolution);
    if (resolution.length < 3) return fail('resolution', 'Anota qué se hizo con la alerta.');
    if (resolution.length > RESOLUTION_MAX) return fail('resolution', `La nota puede tener hasta ${RESOLUTION_MAX} caracteres.`);
    return { ok: true, value: { status, resolution } };
}

// --- reglas -----------------------------------------------------------------------

// ¿Este agente puede confirmar (aplicar) la sanción? { ok } | { ok:false, status, code, error }
function canConfirm(sanction, agentId) {
    if (!sanction) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'No encontramos esa sanción.' };
    if (!isUuid(agentId)) return { ok: false, status: 403, code: 'NO_AGENT', error: 'No pudimos identificar al agente.' };
    if (sanction.status !== 'proposed') {
        return { ok: false, status: 409, code: 'NOT_PROPOSED', error: 'Esta sanción ya no está pendiente de confirmación.' };
    }
    if (sanction.kind === 'ban' && sanction.proposed_by && sanction.proposed_by === agentId) {
        return { ok: false, status: 403, code: 'SAME_AGENT', error: 'Un cierre permanente lo confirma un agente distinto del que lo propuso.' };
    }
    return { ok: true };
}

// ¿Este agente puede decidir la apelación? (ni quien propuso ni quien confirmó)
function canDecideAppeal(sanction, agentId) {
    if (!sanction) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'No encontramos esa sanción.' };
    if (sanction.status !== 'appealed') return { ok: false, status: 409, code: 'NOT_APPEALED', error: 'Esta sanción no tiene una apelación pendiente.' };
    if (!isUuid(agentId)) return { ok: false, status: 403, code: 'NO_AGENT', error: 'No pudimos identificar al agente.' };
    if (agentId === sanction.proposed_by || agentId === sanction.confirmed_by) {
        return { ok: false, status: 403, code: 'SAME_AGENT', error: 'La apelación la decide un agente que no propuso ni confirmó la sanción.' };
    }
    return { ok: true };
}

function canLift(sanction) {
    if (!sanction) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'No encontramos esa sanción.' };
    if (sanction.status === 'proposed') return { ok: true, discard: true };
    if (!EFFECTIVE_STATUSES.includes(sanction.status)) {
        return { ok: false, status: 409, code: 'NOT_ACTIVE', error: 'Esta sanción ya no está vigente.' };
    }
    return { ok: true, discard: false };
}

function appealDeadline(sanction) {
    const start = toDate(sanction && (sanction.starts_at || sanction.created_at));
    return start ? new Date(start.getTime() + APPEAL_WINDOW_MS) : null;
}

// Una sola apelación, dentro de 30 días desde starts_at, de una sanción vigente.
function appealWindowOpen(sanction, now = new Date()) {
    if (!sanction || sanction.status !== 'active') return false;
    if (sanction.appeal_submitted_at || sanction.appeal_text || sanction.appeal_outcome) return false;
    const deadline = appealDeadline(sanction);
    return Boolean(deadline) && toDate(now).getTime() <= deadline.getTime();
}

// Estado de la apelación para la página pública.
function appealState(sanction, now = new Date()) {
    if (!sanction) return 'invalid';
    if (sanction.appeal_submitted_at || sanction.appeal_text) return 'already_appealed';
    if (sanction.status === 'lifted' || sanction.status === 'rejected') return 'closed';
    if (sanction.status !== 'active') return 'closed';
    return appealWindowOpen(sanction, now) ? 'open' : 'expired';
}

// ¿La sanción sigue surtiendo efecto en este momento?
function isEffective(sanction, now = new Date()) {
    if (!sanction || !EFFECTIVE_STATUSES.includes(sanction.status)) return false;
    const end = toDate(sanction.ends_at);
    return !end || end.getTime() > toDate(now).getTime();
}

// --- token de apelación ------------------------------------------------------------

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
    return Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function appealKey(env) {
    return deriveKey(APPEAL_TOKEN_LABEL, env);
}

function signPayload(payloadText, key) {
    return crypto.createHmac('sha256', key).update(payloadText).digest();
}

// Enlace firmado para apelar: vence a los 30 días de starts_at. null sin clave.
function signAppealToken(sanction, { env = process.env, now = new Date() } = {}) {
    if (!sanction || !isUuid(sanction.id) || !isUuid(sanction.user_id)) return null;
    const key = appealKey(env);
    if (!key) return null;
    const start = toDate(sanction.starts_at) || toDate(now);
    const exp = Math.floor((start.getTime() + APPEAL_WINDOW_MS) / 1000);
    const payload = b64url(JSON.stringify({ s: sanction.id, u: sanction.user_id, e: exp }));
    return `${payload}.${b64url(signPayload(payload, key))}`;
}

// { ok:true, sanctionId, userId, exp } | { ok:false, code: 'INVALID'|'EXPIRED'|'NOT_CONFIGURED' }
function verifyAppealToken(token, { env = process.env, now = new Date() } = {}) {
    const key = appealKey(env);
    if (!key) return { ok: false, code: 'NOT_CONFIGURED' };
    const text = String(token || '').trim();
    const parts = text.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{10,400}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{20,100}$/.test(parts[1])) {
        return { ok: false, code: 'INVALID' };
    }
    const expected = signPayload(parts[0], key);
    const given = fromB64url(parts[1]);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, code: 'INVALID' };
    let data;
    try { data = JSON.parse(fromB64url(parts[0]).toString('utf8')); } catch (_) { return { ok: false, code: 'INVALID' }; }
    if (!data || !isUuid(data.s) || !isUuid(data.u) || !Number.isFinite(data.e)) return { ok: false, code: 'INVALID' };
    if (Math.floor(toDate(now).getTime() / 1000) > data.e) return { ok: false, code: 'EXPIRED', sanctionId: data.s };
    return { ok: true, sanctionId: data.s, userId: data.u, exp: data.e };
}

// --- planes -------------------------------------------------------------------------

// Pasos pendientes para aplicar la sanción, en orden. `snapshot` es el
// side_effects guardado (por defecto el de la sanción).
function planApply(sanction, snapshot) {
    if (!sanction || !KINDS.includes(sanction.kind)) return [];
    const se = sideEffects({ side_effects: snapshot !== undefined ? snapshot : sanction.side_effects });
    const done = se.steps;
    const steps = se.source === REENTRY_SOURCE ? APPLY_STEPS.reentry : APPLY_STEPS[sanction.kind];
    return steps.filter((step) => {
        if (step === 'activate' && sanction.status !== 'proposed') return false;
        return !done[step];
    });
}

// Pasos pendientes para levantarla: solo revierte lo que el apply registró.
function planLift(sanction) {
    if (!sanction) return [];
    const se = sideEffects(sanction);
    return LIFT_STEPS
        .filter(({ step, requires }) => !se.lift[step] && (!requires || se.steps[requires]))
        .filter(({ step }) => !(step === 'deactivate' && sanction.status === 'lifted'))
        .map(({ step }) => step);
}

// Duración del bloqueo en Auth: 'permanent' para un cierre; horas hasta
// ends_at para una sanción con fin (no se usa hoy: la suspensión no bloquea Auth).
function authBanDuration(sanction, now = new Date()) {
    if (!sanction) return null;
    if (sanction.kind === 'ban' && !sanction.ends_at) return 'permanent';
    const end = toDate(sanction.ends_at);
    if (!end) return 'permanent';
    const hours = Math.ceil((end.getTime() - toDate(now).getTime()) / 3600000);
    return hours > 0 ? hours : null;
}

function profileState(kind) {
    if (kind === 'ban') return 'banned';
    if (kind === 'suspension') return 'suspended';
    return 'none';
}

// Una fila de la base → lo que ve soporte en la lista.
function summarizeSanction(row) {
    const r = row || {};
    return {
        id: r.id,
        user_id: r.user_id,
        kind: r.kind,
        kind_label: KIND_LABELS[r.kind] || '',
        reason_code: r.reason_code,
        reason_label: reasonLabel(r.reason_code),
        summary: r.summary || '',
        ticket_id: r.ticket_id || null,
        status: r.status,
        status_label: STATUS_LABELS[r.status] || '',
        proposed_by: r.proposed_by || null,
        confirmed_by: r.confirmed_by || null,
        starts_at: r.starts_at || null,
        ends_at: r.ends_at || null,
        appeal_submitted_at: r.appeal_submitted_at || null,
        appeal_outcome: APPEAL_OUTCOME_API[r.appeal_outcome] || null,
        appeal_outcome_label: APPEAL_OUTCOME_LABELS[APPEAL_OUTCOME_API[r.appeal_outcome]] || '',
        appeal_text: r.appeal_text || '',
        source: (r.side_effects && r.side_effects.source) || 'support',
        appeal_decided_by: r.appeal_decided_by || null,
        appeal_decided_at: r.appeal_decided_at || null,
        created_at: r.created_at || null,
        updated_at: r.updated_at || null
    };
}

// Lo que ve la persona sancionada en /apelacion (sin agentes, ticket ni notas).
function publicSanctionView(row, now = new Date()) {
    const r = row || {};
    const deadline = appealDeadline(r);
    return {
        kind: r.kind,
        kind_label: KIND_LABELS[r.kind] || '',
        reason_label: reasonLabel(r.reason_code),
        starts_at: r.starts_at || null,
        ends_at: r.ends_at || null,
        permanent: !r.ends_at,
        status: r.status === 'appealed' ? 'appealed' : (r.status === 'active' ? 'active' : 'closed'),
        appeal_state: appealState(r, now),
        appeal_deadline: deadline ? deadline.toISOString() : null
    };
}

function summarizeAlert(row) {
    const r = row || {};
    const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
    return {
        id: r.id,
        kind: r.kind,
        kind_label: ALERT_KIND_LABELS[r.kind] || '',
        status: r.status,
        status_label: ALERT_STATUS_LABELS[r.status] || '',
        subject_user_id: r.subject_user_id || null,
        related_user_id: r.related_user_id || null,
        payload,
        resolution: r.resolution || null,
        handled_by: r.handled_by || null,
        handled_at: r.handled_at || null,
        created_at: r.created_at || null
    };
}

module.exports = {
    KINDS,
    KIND_LABELS,
    STATUSES,
    STATUS_LABELS,
    EFFECTIVE_STATUSES,
    REASON_CODES,
    REASON_LABELS,
    APPEAL_OUTCOMES,
    APPEAL_OUTCOME_LABELS,
    APPEAL_OUTCOME_DB,
    APPEAL_OUTCOME_API,
    REENTRY_SOURCE,
    ALERT_KINDS,
    ALERT_KIND_LABELS,
    ALERT_STATUSES,
    ALERT_STATUS_LABELS,
    OPEN_QUOTE_STATUSES,
    SUPPORT_CLOSED_REASON,
    APPEAL_WINDOW_DAYS,
    APPEAL_MIN,
    APPEAL_MAX,
    SUMMARY_MAX,
    NOTE_MAX,
    BLOCKED_MESSAGE,
    APPLY_STEPS,
    isUuid,
    cleanLine,
    cleanText,
    reasonLabel,
    sideEffects,
    parseProposeInput,
    parseConfirmInput,
    parseLiftInput,
    parseAppealInput,
    parseAppealDecisionInput,
    parseListQuery,
    parseAlertListQuery,
    parseAlertUpdateInput,
    canConfirm,
    canDecideAppeal,
    canLift,
    appealDeadline,
    appealWindowOpen,
    appealState,
    isEffective,
    signAppealToken,
    verifyAppealToken,
    planApply,
    planLift,
    authBanDuration,
    profileState,
    summarizeSanction,
    publicSanctionView,
    summarizeAlert
};
