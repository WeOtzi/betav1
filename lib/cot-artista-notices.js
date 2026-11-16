'use strict';

// ===========================================================================
// Avisos de cotizaciones del artista (beta cerrada, 15 nov 2026)
// ---------------------------------------------------------------------------
// COT-A-03  artist_new_quotation: el artista recibe un email cuando entra una
//           solicitud nueva (lo dispara services/quotation-intake.js).
// COT-A-05  session_*: el calendario y el detalle avisan sesiones agendadas,
//           reprogramadas, canceladas y realizadas.
// COT-A-11  artist_confirmed_agreement: el CLIENTE recibe el acuerdo que
//           registró el artista (antes le llegaba al propio artista).
// COT-A-12  quotation_completed_summary: cuando el cliente aprueba la entrega
//           (POST /api/client/quotations/:quoteId/complete).
// COT-A-20  Los emails que reciben cliente Y artista salen en dos copias, una
//           por rol, cada una con sus enlaces (quotation_url, dashboard_url,
//           login_url). Antes el artista recibía los del panel del cliente.
//
// Todo se resuelve desde lo GUARDADO (service-role vía lib/postgrest.js):
// el navegador solo dice qué cotización/sesión. Las dependencias se inyectan
// (deps) para testear sin red. Ningún aviso rompe la acción que lo origina.
// ===========================================================================

const SESSION_EVENTS = Object.freeze(['session_scheduled', 'session_rescheduled', 'session_cancelled', 'session_completed', 'session_no_show']);
const QUOTE_ID_RE = /^[A-Za-z0-9-]{3,64}$/;
// ── sesiones (ronda 2 · N12) ── quotation_sessions.id es un uuid. El aviso
// exigía /^\d{1,12}$/ y respondía 400 a TODAS las sesiones reales: por eso el
// cliente no recibía el correo al reprogramar ni al cancelar (ni al agendar).
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id de sesión válido (uuid en minúsculas, o entero de datos viejos) o null. */
function normalizeSessionId(value) {
    const text = String(value == null ? '' : value).trim();
    if (SESSION_UUID_RE.test(text)) return text.toLowerCase();
    if (/^\d{1,12}$/.test(text)) return Number(text);
    return null;
}

function sesiones() {
    // require diferido (lógica pura del frente "sesiones").
    return require('./sesiones');
}

function context() {
    // require diferido: los tests puros no cargan la capa de datos.
    return require('../services/email-request-context');
}

function fail(status, error) {
    return { ok: false, status, error };
}

function same(left, right) {
    return !!left && !!right && String(left).toLowerCase() === String(right).toLowerCase();
}

// tattoo_style es jsonb ({ style_name } | [..] | texto).
function styleName(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        const raw = value.trim();
        if (raw.startsWith('{') || raw.startsWith('[')) {
            try { return styleName(JSON.parse(raw)); } catch (_) { return raw; }
        }
        return raw;
    }
    if (Array.isArray(value)) return value.map(styleName).filter(Boolean).join(', ');
    if (typeof value === 'object') return String(value.style_name || value.name || value.label || '');
    return String(value);
}

function numberOrNull(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/** "30 % · 150 USD" · "Sin seña" (COT-A-09). */
function depositText(quote) {
    const q = quote || {};
    const pct = numberOrNull(q.artist_deposit_pct);
    const amount = numberOrNull(q.artist_deposit_amount);
    const parts = [];
    if (pct != null && pct > 0) parts.push(`${String(pct).replace('.', ',')} %`);
    if (amount != null && amount > 0) {
        const currency = q.final_budget_currency || q.artist_budget_currency || '';
        parts.push(`${amount} ${currency}`.trim());
    }
    return parts.length ? parts.join(' · ') : 'Sin seña';
}

/** Primera sesión activa (no cancelada ni ausente), o null. */
function firstActiveSession(sessions) {
    const list = (Array.isArray(sessions) ? sessions : [])
        .filter((s) => s && s.session_date && !['cancelled', 'canceled', 'no_show'].includes(String(s.status || '').toLowerCase()))
        .sort((a, b) => Date.parse(a.session_date) - Date.parse(b.session_date));
    return list[0] || null;
}

/**
 * Copias por rol de un email que reciben cliente y artista (COT-A-20).
 * La copia del cliente no lleva artist_email (y viceversa), así el mapeo
 * resuelve un solo destinatario por copia y cada una lleva sus enlaces.
 * recipient_* queda fijado al rol de la copia (EMAIL-NEW-01): antes la copia
 * del artista salía con recipient_email del cliente y las preferencias se
 * evaluaban contra el cliente.
 */
function rolePayloads(payload, base) {
    const { withLinks } = context();
    const data = { ...(payload || {}) };
    return {
        client: withLinks({
            ...data,
            artist_email: '',
            recipient_role: 'client',
            recipient_email: data.client_email || '',
            recipient_user_id: data.client_user_id || null,
            recipient_name: data.client_name || data.client_full_name || ''
        }, base, 'client'),
        artist: withLinks({
            ...data,
            client_email: '',
            recipient_role: 'artist',
            recipient_email: data.artist_email || '',
            recipient_user_id: data.artist_user_id || data.artist_id || null,
            recipient_name: data.artist_name || ''
        }, base, 'artist')
    };
}

/**
 * Envía las dos copias (cliente y artista) con claves de idempotencia propias.
 * La copia del artista sale solo por el relé (smtp_relay): los flujos n8n de
 * session_* y quotation_completed_summary son de un solo destinatario (el
 * cliente) y la copia del artista llegaba mal o le llegaba otra vez al cliente
 * (EMAIL-NEW-01). Sin deps.resolveChannel se mandan las dos (tests puros).
 *
 * Aviso push / in-app (lib/push-dispatch.js vía email-service): `actorUserId`
 * es quien hizo la acción (no recibe el aviso de su propio comprobante) y
 * `push: false` manda solo el correo (otro evento del mismo acto ya avisó).
 */
async function sendPerRole(eventId, payload, { base, key, actorUserId, push }, deps) {
    const copies = rolePayloads(payload, base);
    const results = {};
    const extra = {};
    if (actorUserId) extra.actorUserId = actorUserId;
    if (push === false) extra.push = false;
    let channel = null;
    if (typeof deps.resolveChannel === 'function') {
        try { channel = await deps.resolveChannel(eventId); } catch (_) { channel = 'unknown'; }
    }
    for (const role of ['client', 'artist']) {
        const address = role === 'client' ? payload.client_email : payload.artist_email;
        if (!address) {
            results[role] = { ok: false, skipped: true, reason: 'sin_destinatario' };
            continue;
        }
        if (role === 'artist' && channel !== null && channel !== 'smtp_relay') {
            results[role] = { ok: false, skipped: true, reason: 'canal_sin_copia_artista' };
            continue;
        }
        try {
            results[role] = await deps.sendEmail(eventId, copies[role], { idempotencyKey: `${key}:${role}`, ...extra });
        } catch (error) {
            results[role] = { ok: false, error: 'No se pudo enviar el correo.' };
        }
    }
    return results;
}

function defaultDeps() {
    const { pgrest } = require('./postgrest');
    const { resolveBearerUser } = require('./auth/supabase-auth');
    return {
        readQuote: (quoteId) => pgrest('quotations_db').select('*').eq('quote_id', quoteId).limit(1).single().execute(),
        readSessions: (quotationId) => pgrest('quotation_sessions')
            .select('id,session_date,status,session_number,duration_hours')
            .eq('quotation_id', quotationId).order('session_date', { ascending: true }).limit(50).execute(),
        // Fila completa de la sesión (select * tolera que falten columnas nuevas).
        readSession: (sessionId, quotationId) => pgrest('quotation_sessions').select('*')
            .eq('id', sessionId).eq('quotation_id', quotationId).limit(1).single().execute(),
        sendEmail: (eventId, payload, options) => require('../services/email-service').sendEmail(eventId, payload, options),
        resolveChannel: async (eventId) => {
            const service = require('../services/email-service');
            return service.resolveChannel(eventId, await service.getRoutingForEvent(eventId));
        },
        resolveUser: resolveBearerUser
    };
}

function withDefaults(deps) {
    const base = deps && deps.useDefaults === false ? {} : defaultDeps();
    return { ...base, ...(deps || {}) };
}

// ---------------------------------------------------------------- COT-A-03

/** Payload del aviso al artista (enlaces del panel del ARTISTA). */
function newQuotationPayload(row, base) {
    const { withLinks } = context();
    return withLinks({
        ...row,
        client_name: row.client_full_name || '',
        tattoo_description: row.tattoo_idea_description || '',
        tattoo_style: styleName(row.tattoo_style)
    }, base, 'artist');
}

/**
 * Avisa al artista que entró una solicitud nueva. Solo si la cotización
 * guardada está 'pending', tiene artista y email del artista. Una sola vez
 * por cotización (idempotencia 'newquote:<quote_id>').
 */
async function notifyArtistNewQuotation(quoteId, deps = {}) {
    const d = withDefaults(deps);
    if (!quoteId || !QUOTE_ID_RE.test(String(quoteId))) return { ok: false, skipped: true, reason: 'cotizacion_invalida' };
    const row = await d.readQuote(quoteId);
    if (!row) return { ok: false, skipped: true, reason: 'no_encontrada' };
    if (row.quote_status !== 'pending' || !row.artist_id) return { ok: false, skipped: true, reason: 'estado' };
    if (!row.artist_email) return { ok: false, skipped: true, reason: 'sin_email_artista' };
    const base = d.baseUrl || context().applicationBase({ headers: {}, get: () => '' });
    return d.sendEmail('artist_new_quotation', newQuotationPayload(row, base), { idempotencyKey: `newquote:${row.quote_id}` });
}

// ---------------------------------------------------------------- COT-A-12

/**
 * Resumen de cotización completada, a cliente y artista (una copia por rol).
 * Solo si la cotización guardada está 'completed'.
 */
async function notifyQuotationCompleted(quoteId, deps = {}) {
    const d = withDefaults(deps);
    if (!quoteId || !QUOTE_ID_RE.test(String(quoteId))) return { ok: false, skipped: true, reason: 'cotizacion_invalida' };
    const row = await d.readQuote(quoteId);
    if (!row) return { ok: false, skipped: true, reason: 'no_encontrada' };
    if (row.quote_status !== 'completed') return { ok: false, skipped: true, reason: 'estado' };
    const sessions = d.readSessions ? await d.readSessions(row.id).catch(() => []) : [];
    const first = firstActiveSession(sessions);
    const base = d.baseUrl || context().applicationBase({ headers: {}, get: () => '' });
    const payload = {
        ...row,
        client_name: row.client_full_name || '',
        tattoo_style: styleName(row.tattoo_style),
        final_budget_amount: row.final_budget_amount != null ? row.final_budget_amount : row.artist_budget_amount,
        final_budget_currency: row.final_budget_currency || row.artist_budget_currency || '',
        final_sessions: row.final_sessions || row.tattoo_estimated_sessions || '',
        first_session_date: first ? first.session_date : ''
    };
    const results = await sendPerRole('quotation_completed_summary', payload, { base, key: `completed:${row.quote_id}` }, d);
    return { ok: true, results };
}

// ---------------------------------------------------------------- COT-A-05 / 20

/**
 * Aviso de sesión pedido por el artista desde el detalle o el calendario.
 * Reusa resolveEmailContext (dueño, sesión guardada y su estado) y manda una
 * copia por rol.
 */
async function handleSessionNotice(req, quoteId, body, deps = {}) {
    const d = withDefaults(deps);
    const eventId = String((body && body.event) || '');
    if (!SESSION_EVENTS.includes(eventId)) return fail(400, 'Aviso de sesión no válido.');
    if (!QUOTE_ID_RE.test(String(quoteId || ''))) return fail(400, 'Cotización no válida.');
    const sessionId = normalizeSessionId(body && body.session_id);
    if (sessionId == null) return fail(400, 'Falta la sesión asociada al correo.');
    if (eventId === 'session_no_show') return noShowNotice(req, quoteId, sessionId, d);
    const resolve = d.resolveEmailContext || context().resolveEmailContext;
    const ctx = await resolve(req, eventId, { quote_id: quoteId, session_id: sessionId });
    if (!ctx.ok) return ctx;
    const base = d.baseUrl || context().applicationBase(req);
    const plan = sessionNoticePlan(eventId, ctx.payload, ctx.idempotencyKey);
    // Quien agendó, movió o cerró la sesión no recibe el aviso push de su propia acción.
    let actor = null;
    if (typeof d.resolveUser === 'function') {
        try { actor = await d.resolveUser(req); } catch (_) { actor = null; }
    }
    const results = await sendPerRole(plan.eventId, plan.payload, { base, key: plan.key, actorUserId: actor && actor.id }, d);
    return { ok: true, event: plan.eventId, results };
}

/**
 * ── sesiones (P28) ── Qué correo sale por una sesión agendada o reprogramada.
 * Si el cliente todavía la tiene que confirmar (client_confirmation 'pending'
 * en una cotización con cuenta de cliente) sale session_confirmation_requested
 * ("confírmala o pide otra fecha") en vez de "quedó agendada". El resto de
 * los avisos (y las bases sin la migración) siguen igual.
 */
function sessionNoticePlan(eventId, payload, idempotencyKey) {
    const p = payload || {};
    const proposal = (eventId === 'session_scheduled' || eventId === 'session_rescheduled')
        && p.client_confirmation === 'pending' && !!p.client_user_id;
    if (!proposal) return { eventId, payload: p, key: idempotencyKey };
    const { Model } = sesiones();
    return {
        eventId: 'session_confirmation_requested',
        key: `${idempotencyKey}:confirm`,
        payload: {
            ...p,
            session_id: p.session_id || p.id,
            proposal_changed: eventId === 'session_rescheduled',
            location_maps: p.location ? Model.mapsUrl(p.location, p.location_place_id) : '',
            edit_window_days: Model.EDIT_WINDOW_DAYS
        }
    };
}

/**
 * ── sesiones ── El artista registró que el cliente no se presentó. El cliente
 * recibe el aviso (puede pedir una disputa si no es correcto) y el artista su
 * copia. Evento server-only: se resuelve acá desde lo guardado.
 */
async function noShowNotice(req, quoteId, sessionId, d) {
    const user = await d.resolveUser(req);
    if (!user) return fail(401, 'Inicia sesión para enviar esta notificación.');
    const quote = await d.readQuote(quoteId);
    if (!quote) return fail(404, 'No se encontró la cotización.');
    const isArtist = same(quote.artist_id, user.id) || (!quote.artist_id && same(quote.artist_email, user.email));
    if (!isArtist) return fail(403, 'Esta cotización no corresponde a tu cuenta.');
    const session = typeof d.readSession === 'function' ? await d.readSession(sessionId, quote.id) : null;
    if (!session) return fail(409, 'Guarda la sesión antes de enviar la notificación.');
    if (session.status !== 'no_show') return fail(409, 'El estado de la sesión cambió. No se envió el aviso.');
    const base = d.baseUrl || context().applicationBase(req);
    const payload = sesiones().emailPayload(quote, null, session);
    const results = await sendPerRole('session_no_show', payload,
        { base, key: `${quote.quote_id}:session:${session.id}:no_show`, actorUserId: user.id }, d);
    return { ok: true, event: 'session_no_show', results };
}

// ---------------------------------------------------------------- COT-A-11

/**
 * Aviso al cliente de que el artista registró el acuerdo. Solo el artista de
 * la cotización y solo con la cotización guardada en 'client_approved'.
 */
async function handleAgreementNotice(req, quoteId, deps = {}) {
    const d = withDefaults(deps);
    if (!QUOTE_ID_RE.test(String(quoteId || ''))) return fail(400, 'Cotización no válida.');
    const user = await d.resolveUser(req);
    if (!user) return fail(401, 'Iniciá sesión para enviar esta notificación.');
    const quote = await d.readQuote(quoteId);
    if (!quote) return fail(404, 'No se encontró la cotización.');
    const isArtist = same(quote.artist_id, user.id) || (!quote.artist_id && same(quote.artist_email, user.email));
    if (!isArtist) return fail(403, 'Esta cotización no corresponde a tu cuenta.');
    if (quote.quote_status !== 'client_approved') return fail(409, 'El estado de la cotización cambió. No se envió el aviso.');
    if (!quote.client_email) return { ok: true, skipped: true, reason: 'sin_email_cliente' };
    const sessions = d.readSessions ? await d.readSessions(quote.id).catch(() => []) : [];
    const first = firstActiveSession(sessions);
    const base = d.baseUrl || context().applicationBase(req);
    const { withLinks } = context();
    const payload = withLinks({
        ...quote,
        artist_email: '',
        client_name: quote.client_full_name || '',
        tattoo_style: styleName(quote.tattoo_style),
        first_session_date: first ? first.session_date : '',
        deposit_text: depositText(quote)
    }, base, 'client');
    const result = await d.sendEmail('artist_confirmed_agreement', payload, { idempotencyKey: `agreement:${quote.quote_id}` });
    // ── sesiones (P28) ── la primera sesión del acuerdo la confirma el cliente:
    // además del acuerdo recibe el pedido de confirmación (con su botón).
    let confirmation = null;
    if (first && quote.client_user_id && typeof d.readSession === 'function') {
        try {
            const full = await d.readSession(first.id, quote.id);
            if (full && full.client_confirmation === 'pending' && ['scheduled', 'rescheduled'].includes(full.status)) {
                // push:false → artist_confirmed_agreement ya avisó al cliente en este mismo acto:
                // el pedido de confirmación sale solo por correo (sin dos push seguidos).
                confirmation = await sendPerRole('session_confirmation_requested', sesiones().emailPayload(quote, null, full),
                    { base, key: `${quote.quote_id}:session:${full.id}:${full.updated_at || full.session_date}:confirm`, push: false }, d);
            }
        } catch (_) { /* el acuerdo ya salió: el pedido de confirmación no lo rompe */ }
    }
    return { ok: true, results: { client: result }, confirmation };
}

/** Corre un aviso sin bloquear la respuesta HTTP ni romper la acción. */
function inBackground(label, task) {
    Promise.resolve()
        .then(task)
        .then((result) => {
            if (result && result.ok === false && !result.skipped) console.warn(`[cot-artista] ${label}:`, result.error || 'no enviado');
        })
        .catch((error) => console.warn(`[cot-artista] ${label}:`, error && error.message));
}

module.exports = {
    SESSION_EVENTS,
    styleName,
    depositText,
    firstActiveSession,
    rolePayloads,
    sendPerRole,
    newQuotationPayload,
    notifyArtistNewQuotation,
    notifyQuotationCompleted,
    normalizeSessionId,
    sessionNoticePlan,
    handleSessionNotice,
    handleAgreementNotice,
    inBackground
};
