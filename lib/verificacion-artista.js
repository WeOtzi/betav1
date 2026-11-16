'use strict';

// ── verif-artista ── Verificación de artistas de punta a punta (beta cerrada).
//
// Lógica pura + orquestación con dependencias inyectadas (testeable sin red):
//   · requestVerification   POST /api/artist/verification/request
//       el artista pide la verificación; el servidor (service-role) llama a la
//       RPC request_artist_verification, que valida identidad + domicilio
//       cargados y no rechazados, pasa a 'Requested' y deja 'pending_review' en
//       verification_history. Después avisa a soporte por email
//       (artist_verification_requested, server-only).
//   · notifyVerificationDecision  POST /api/support/artist-verification/notify
//       soporte decidió con support_set_artist_verification_state (RPC con su
//       JWT). El servidor relee la fila de verification_history, exige que la
//       haya escrito un agente activo y que sea reciente (15 min), y avisa al
//       artista: profile_verified / profile_verification_denied / (revocada)
//       artist_support_decision. Una decisión = un email (idempotencyKey).
//       El aviso in-app sale de la misma fila (support-decision-model.js).
//   · verificationStatusForUser  herramienta get_verification_status del chat.
//
// Estados de artists_db.verification_state: 'No' | 'Requested' | 'Yes' | 'Denied'
// (legados que pueden aparecer: 'In Progress', 'In Analysis', 'Canceled', 'rejected').

const Model = require('../public/shared/js/support-decision-model.js');
const neutralEs = require('../public/shared/js/neutral-es.js');

const REQUIRED_DOCS = [
    ['identidad', 'tu documento de identidad'],
    ['domicilio', 'tu comprobante de domicilio']
];
const DOC_LABELS = {
    identidad: 'Documento de identidad',
    domicilio: 'Comprobante de domicilio',
    bioseguridad: 'Certificado de bioseguridad'
};
const STATE_LABELS = {
    Yes: 'Verificado',
    Requested: 'En revisión',
    'In Progress': 'En revisión',
    'In Analysis': 'En revisión',
    Denied: 'Denegada',
    rejected: 'Denegada',
    Canceled: 'Sin solicitar',
    No: 'Sin solicitar'
};
const IN_REVIEW = ['Requested', 'In Progress', 'In Analysis'];
const CAN_REQUEST = ['No', 'Denied', 'rejected', 'Canceled'];
const DECISION_EVENTS = { approved: 'profile_verified', rejected: 'profile_verification_denied', revoked: 'artist_support_decision' };
const SUPPORT_EVENT = 'artist_verification_requested';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(v) { return v == null ? '' : String(v).trim(); }
function baseUrl(raw) { return text(raw).replace(/\/+$/, ''); }

function normalizeState(raw) {
    const s = text(raw);
    return s || 'No';
}

// 'pendiente' | 'verificado' | 'rechazado' → 'pending' | 'verified' | 'rejected'; sin fila → 'missing'.
function docStatus(doc) {
    if (!doc) return 'missing';
    const s = text(doc.status).toLowerCase();
    if (s.startsWith('verific') || s.startsWith('aprob')) return 'verified';
    if (s.startsWith('rechaz') || s.startsWith('deneg')) return 'rejected';
    return 'pending';
}

/** Obligatorios que faltan (sin cargar o rechazados), con su texto para el mensaje. */
function missingRequiredDocs(docs) {
    const list = Array.isArray(docs) ? docs : [];
    return REQUIRED_DOCS.filter(([type]) => {
        const st = docStatus(list.find((d) => d && d.doc_type === type) || null);
        return st === 'missing' || st === 'rejected';
    }).map(([, label]) => label);
}

/** ¿El artista puede pedir la verificación? Misma regla que la RPC y el guard. */
function requestEligibility(artist, docs) {
    if (!artist) return { ok: false, status: 404, error: 'No encontramos tu perfil de artista.' };
    const state = normalizeState(artist.verification_state);
    if (state === 'Yes') return { ok: false, status: 409, error: 'Tu perfil ya está verificado.' };
    if (IN_REVIEW.includes(state)) return { ok: true, alreadyRequested: true, state };
    if (!CAN_REQUEST.includes(state)) return { ok: false, status: 409, error: 'No puedes solicitar la verificación en este momento.' };
    const missing = missingRequiredDocs(docs);
    if (missing.length) {
        return { ok: false, status: 409, error: `Antes de solicitarla, sube ${missing.join(' y ')}.`, missing };
    }
    return { ok: true, alreadyRequested: false, state };
}

// Mensaje de la RPC (raise exception … using errcode 22023) → respuesta HTTP.
// La función ya aplicada levanta el texto en voseo y la capa pgrest lo pasa a
// tuteo: se reconocen las dos formas y se devuelve en tuteo.
function mapRpcError(err) {
    const raw = text(err && err.message);
    const json = raw.indexOf('{') >= 0 ? raw.slice(raw.indexOf('{')) : '';
    let message = '';
    try { message = text(JSON.parse(json).message); } catch (_) { message = ''; }
    if (/request_artist_verification/.test(raw) && /PGRST202|Could not find the function/i.test(raw)) {
        return { status: 503, error: 'Falta aplicar la migración 20261115190000 (verificación de artistas).' };
    }
    if (message && /22023|Antes de solicitarla|ya está verificado|No (?:podés|puedes)|No encontramos/.test(raw)) {
        return { status: /No encontramos/.test(message) ? 404 : 409, error: neutralEs.neutralize(message) };
    }
    return { status: 500, error: 'No pudimos enviar la solicitud. Prueba de nuevo en unos minutos.' };
}

function profileUrl(base, artist) {
    const username = text(artist && artist.username);
    return username ? `${baseUrl(base)}/artist/profile?artist=${encodeURIComponent(username)}` : `${baseUrl(base)}/artist/dashboard`;
}

/** Payload del aviso a soporte (artist_verification_requested). */
function supportRequestPayload(artist, docs, opts = {}) {
    const a = artist || {};
    const base = baseUrl(opts.baseUrl);
    const list = Array.isArray(docs) ? docs : [];
    const docsText = ['identidad', 'domicilio', 'bioseguridad'].map((type) => {
        const st = docStatus(list.find((d) => d && d.doc_type === type) || null);
        const label = { missing: 'sin cargar', pending: 'pendiente', verified: 'aprobado', rejected: 'rechazado' }[st];
        return `${DOC_LABELS[type]}: ${label}`;
    }).join(' · ');
    return {
        support_email: text(opts.supportEmail) || null,
        artist_user_id: a.user_id || null,
        artist_name: text(a.name) || text(a.username) || 'Artista',
        artist_username: text(a.username) ? '@' + text(a.username).replace(/^@+/, '') : '-',
        documents_summary: docsText,
        requested_at: opts.requestedAt || new Date().toISOString(),
        queue_url: `${base}/support/dashboard#verificacion`,
        profile_url: profileUrl(base, a)
    };
}

/** Payload del email al artista según la decisión de soporte. */
function decisionEmail(decision, artist, opts = {}) {
    if (!decision || !DECISION_EVENTS[decision.outcome]) return null;
    const a = artist || {};
    const base = baseUrl(opts.baseUrl);
    const eventId = DECISION_EVENTS[decision.outcome];
    const name = text(a.name) || text(a.username) || 'artista';
    const email = text(a.email) || null;
    const accountUrl = `${base}/artist/account#verificacion`;
    if (decision.outcome === 'approved') {
        return { eventId, payload: { artist_email: email, artist_user_id: decision.artistUserId, artist_name: name,
            profile_url: profileUrl(base, a), dashboard_url: accountUrl } };
    }
    if (decision.outcome === 'rejected') {
        return { eventId, payload: { artist_email: email, artist_user_id: decision.artistUserId, artist_name: name,
            reason: decision.note || 'Revisa tus documentos en Cuenta · Verificación.', dashboard_url: accountUrl } };
    }
    // Revocada / solicitud cerrada: aviso genérico de soporte (misma plantilla que documentos y retiros).
    const payload = Model.emailPayload(decision, a, { baseUrl: base });
    return payload ? { eventId, payload } : null;
}

function idempotencyKey(historyId) { return `artist_state:${historyId}`; }

/**
 * El artista pide la verificación.
 * @param {{ userId: string }} input
 * @param {{ artistByUserId, documents, requestVerification, sendEmail, supportEmail?, supportEmails?, baseUrl?, log? }} deps
 */
async function requestVerification(input, deps) {
    const userId = text(input && input.userId);
    if (!UUID_RE.test(userId)) return { ok: false, status: 401, error: 'Inicia sesión para pedir la verificación.' };
    const artist = await deps.artistByUserId(userId);
    const docs = artist ? await deps.documents(userId) : [];
    const check = requestEligibility(artist, docs);
    if (!check.ok) return check;
    if (check.alreadyRequested) return { ok: true, state: check.state, changed: false, supportNotified: false };

    let result;
    try {
        result = await deps.requestVerification(userId);
    } catch (err) {
        const mapped = mapRpcError(err);
        return { ok: false, ...mapped };
    }
    const row = Array.isArray(result) ? result[0] : result;
    const state = text(row && row.state) || 'Requested';
    const historyId = row && row.history_id ? String(row.history_id) : null;
    if (!row || row.changed === false || !historyId) return { ok: true, state, changed: false, supportNotified: false };

    // Aviso a soporte: no frena la solicitud (la cola de soporte la muestra igual).
    let supportNotified = false;
    if (typeof deps.sendEmail === 'function') {
        try {
            const supportEmail = text(deps.supportEmail);
            const supportEmails = supportEmail ? [] : (deps.supportEmails ? await deps.supportEmails() : []);
            if (supportEmail || supportEmails.length) {
                const payload = supportRequestPayload(artist, docs, { baseUrl: deps.baseUrl, supportEmail });
                payload.support_emails = supportEmails;
                const sent = await deps.sendEmail(SUPPORT_EVENT, payload,
                    { idempotencyKey: `artist_verification_requested:${historyId}`, ignorePreferences: true });
                supportNotified = Boolean(sent && sent.ok && !sent.skipped);
            }
        } catch (err) {
            if (deps.log) deps.log.warn('[verif-artista] aviso a soporte:', err && err.message);
        }
    }
    return { ok: true, state, changed: true, historyId, supportNotified };
}

/**
 * Aviso al artista después de que soporte decidió.
 * @param {{ history_id: string }} input
 * @param {{ historyRow, artistById, isActiveSupportAgent, sendEmail, baseUrl?, now? }} deps
 */
async function notifyVerificationDecision(input, deps) {
    const id = text(input && (input.history_id || input.id));
    if (!UUID_RE.test(id)) return { ok: false, status: 400, error: 'Identificador inválido.' };
    const row = await deps.historyRow(id);
    if (!row) return { ok: false, status: 404, error: 'No encontramos esa decisión.' };
    // Solo filas que escribió un agente de soporte activo (la RPC pone su auth.uid()).
    if (!(await deps.isActiveSupportAgent(text(row.reviewed_by)))) {
        return { ok: true, sent: false, skipped: 'not_support' };
    }
    const artist = await deps.artistById(row.artist_id);
    if (!artist) return { ok: true, sent: false, skipped: 'no_artist' };
    const decision = Model.fromRow('verification', { ...row, artist_user_id: artist.user_id });
    if (!decision) return { ok: true, sent: false, skipped: 'no_decision' };
    if (!Model.isRecent(decision, deps.now || new Date())) return { ok: true, sent: false, skipped: 'stale' };
    if (!artist.email) return { ok: true, sent: false, skipped: 'no_email' };
    const mail = decisionEmail(decision, artist, { baseUrl: deps.baseUrl });
    if (!mail) return { ok: true, sent: false, skipped: 'no_decision' };
    // Cambio de estado de la cuenta: transaccional, no lo filtran las preferencias.
    const result = await deps.sendEmail(mail.eventId, mail.payload, { idempotencyKey: idempotencyKey(id), ignorePreferences: true });
    return {
        ok: true,
        eventId: mail.eventId,
        sent: Boolean(result && result.ok && !result.skipped),
        deduplicated: Boolean(result && result.deduplicated),
        channel: result && result.channel,
        error: result && !result.ok ? result.error || null : null
    };
}

/** Resumen legible para la herramienta del chat de soporte. */
function summarizeForChat(artist, docs, lastDecision) {
    const state = normalizeState(artist && artist.verification_state);
    const list = Array.isArray(docs) ? docs : [];
    const documentos = ['identidad', 'domicilio', 'bioseguridad'].map((type) => {
        const doc = list.find((d) => d && d.doc_type === type) || null;
        const st = docStatus(doc);
        return {
            tipo: DOC_LABELS[type],
            obligatorio: type !== 'bioseguridad',
            estado: { missing: 'sin cargar', pending: 'en revisión', verified: 'aprobado', rejected: 'rechazado' }[st],
            motivo_rechazo: st === 'rejected' ? (text(doc.reviewer_notes) || null) : null
        };
    });
    const faltan = missingRequiredDocs(list);
    let siguiente;
    if (state === 'Yes') siguiente = 'El perfil ya está verificado y muestra la insignia.';
    else if (IN_REVIEW.includes(state)) siguiente = 'Soporte está revisando la solicitud; el artista recibe un email con el resultado.';
    else if (faltan.length) siguiente = `Subir ${faltan.join(' y ')} en Cuenta · Verificación y después tocar «Solicitar verificación».`;
    else siguiente = 'Tocar «Solicitar verificación» en Cuenta · Verificación.';
    const decision = lastDecision && lastDecision.action && lastDecision.action !== 'pending_review' ? lastDecision : null;
    return {
        artista: text(artist && artist.name) || text(artist && artist.username) || null,
        estado: STATE_LABELS[state] || state,
        estado_codigo: state,
        verificado: state === 'Yes',
        instagram_validado: Boolean(artist && artist.instagram_verified_at),
        documentos,
        faltan_obligatorios: faltan,
        ultima_decision: decision ? { accion: decision.action, motivo: text(decision.notes) || null, fecha: decision.created_at || null } : null,
        siguiente_paso: siguiente
    };
}

/**
 * @param {string} userId
 * @param {{ artistByUserId, documents, lastDecision? }} deps
 */
async function verificationStatusForUser(userId, deps) {
    const artist = await deps.artistByUserId(userId);
    if (!artist) return { error: 'Este usuario no es un artista.' };
    const [docs, last] = await Promise.all([
        deps.documents(userId).catch(() => []),
        deps.lastDecision && artist.id ? deps.lastDecision(artist.id).catch(() => null) : Promise.resolve(null)
    ]);
    return { verificacion: summarizeForChat(artist, docs, last) };
}

module.exports = {
    REQUIRED_DOCS, DOC_LABELS, STATE_LABELS, IN_REVIEW, CAN_REQUEST, DECISION_EVENTS, SUPPORT_EVENT,
    normalizeState, docStatus, missingRequiredDocs, requestEligibility, mapRpcError,
    supportRequestPayload, decisionEmail, idempotencyKey,
    requestVerification, notifyVerificationDecision, summarizeForChat, verificationStatusForUser
};
