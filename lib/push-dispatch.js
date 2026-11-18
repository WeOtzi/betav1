'use strict';

// ===========================================================================
// Avisos al usuario: push + in-app (frente "push" · P24)
// ---------------------------------------------------------------------------
// Un solo camino para avisarle a un usuario REGISTRADO que pasó algo:
//
//   notifyUser()  →  fila en user_notifications (la app abierta la recibe por
//                    Realtime: toast + sonido)  →  Web Push a sus navegadores
//                    suscriptos (app cerrada), si hay claves VAPID.
//
// Quién lo dispara:
//   · services/email-service.js → onEmailEvent(): cada correo que sale a un
//     usuario registrado dispara también su aviso (título, texto y destino
//     salen del render spec del correo: asunto, preheader y CTA).
//   · lib/routes/emails.js → onMessageEvent(): los mensajes de chat e inbox
//     avisan al instante, aunque su correo vaya agrupado (15 min) o diferido.
//   · cualquier módulo del servidor → notifyUser() directo.
//
// Reglas:
//   - Solo corre si lib/routes/push.js lo habilitó (enable()): los tests y
//     scripts que cargan email-service sueltos no tocan la red.
//   - Respeta la columna "Push" de la matriz de notificaciones de la cuenta
//     (lib/notification-prefs.js). El email apagado NO apaga el push.
//   - Nunca viajan códigos, contraseñas ni datos de salud: solo los eventos
//     de actividad (cotizaciones, mensajes, calendario, sesiones, estudios y
//     decisiones de verificación), con el asunto y el preheader del correo.
//   - dedupe_key (índice único por usuario) evita repetir un aviso cuando el
//     mismo evento se reintenta (jobs de recordatorios, correo diferido).
//   - Todo es mejor esfuerzo: un fallo aquí nunca rompe ni demora el correo.
// ===========================================================================

const crypto = require('node:crypto');
const webPush = require('./web-push');
const notificationPrefs = require('./notification-prefs');
const { safeUrl, publicBaseUrl, truncate } = require('./email-format');

const ROLES = new Set(['artist', 'client', 'studio']);
const PUSH_CATEGORIES = new Set(['quotations', 'messages', 'calendar', 'studios']);
// Sesiones (ronda 2 · P28): sus correos son 'transactional' (salen siempre),
// pero para la otra parte son actividad: agendar, confirmar, pedir un cambio,
// resolverlo, disputar, calificar o registrar una ausencia también avisan por
// push / in-app, igual que la resolución de la disputa por soporte.
// session_dispute_support queda afuera (va a soporte).
const SESSION_ACTIVITY_EVENTS = new Set([
    'session_confirmation_requested', 'session_confirmed_by_client', 'session_change_requested',
    'session_change_resolved', 'session_dispute_opened', 'session_dispute_resolved',
    'session_feedback_received', 'session_no_show'
]);
// Eventos de otras categorías que sí son actividad para el usuario.
const PUSH_EXTRA_EVENTS = new Set([
    'profile_verified', 'profile_verification_denied', 'artist_support_decision',
    'ambassador_status_updated', 'dispute_artist_response',
    // Sanciones (2.7.0): al cliente, su cotización se canceló por un cierre de cuenta.
    'quotation_cancelled_profile_removed',
    ...SESSION_ACTIVITY_EVENTS
]);
// Comprobantes de una acción que el propio usuario acaba de hacer: no se avisan.
const PUSH_SKIP_EVENTS = new Set([
    'client_quotation_submitted', 'client_quotation_accepted_receipt',
    'client_quotation_rejected_receipt', 'job_board_request_created'
]);
const MESSAGE_EVENTS = new Set(['chat_message_to_artist', 'chat_message_to_client', 'inbox_message_received']);

const KIND_BY_CATEGORY = {
    artist: { quotations: 'cotizaciones', messages: 'mensajes', calendar: 'calendario', studios: 'invitaciones' },
    client: { quotations: 'cotizaciones', messages: 'mensajes' }
};
const DEFAULT_PATH = { artist: '/artist/dashboard', client: '/client/dashboard', studio: '/studio/dashboard' };

// Parte de la pantalla de destino que se resalta al llegar (?ver=…, lo lee
// public/shared/js/wo-notify.js). Solo en los detalles de cotización.
const FOCUS_BY_EVENT = {
    artist_responded_quotation: 'propuesta',
    quotation_ready_for_client: 'propuesta',
    quotation_expired: 'propuesta',
    artist_confirmed_agreement: 'propuesta',
    artist_rejected_quotation: 'propuesta',
    booking_slot_confirmed: 'sesiones',
    client_approved_quotation: 'acuerdo',
    client_rejected_quotation: 'historial',
    dispute_artist_response: 'disputa',
    session_scheduled: 'sesiones',
    session_rescheduled: 'sesiones',
    session_cancelled: 'sesiones',
    session_completed: 'sesiones',
    session_reminder_24h: 'sesiones'
};
const QUOTE_DETAIL_PATHS = new Set(['/client/dashboard', '/my-quotations/detail']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_RETENTION_DAYS = 60;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURES = 8;

const state = { enabled: false, deps: {}, lastPruneAt: 0 };

function enable(deps = {}) {
    state.enabled = true;
    state.deps = deps || {};
}

function disable() {
    state.enabled = false;
    state.deps = {};
}

function isEnabled() {
    return state.enabled;
}

function repo(deps) {
    return (deps && deps.repo) || state.deps.repo || require('./repos/push').PushRepo;
}

function log(deps, ...args) {
    const fn = (deps && deps.log) || state.deps.log || ((...a) => console.warn(...a));
    fn(...args);
}

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// ---------------------------------------------------------------- clasificación (pura)

function specFor(eventId) {
    try { return require('./email-render').getSpec(eventId); } catch (_) { return null; }
}

/** ¿Este evento se avisa por push / in-app a este rol? */
function isPushEvent(eventId, role, spec = specFor(eventId)) {
    if (!eventId || !ROLES.has(role) || PUSH_SKIP_EVENTS.has(eventId)) return false;
    if (PUSH_EXTRA_EVENTS.has(eventId)) return true;
    return !!spec && PUSH_CATEGORIES.has(spec.category);
}

/** Fila de la matriz de preferencias que gobierna el aviso (o null = siempre). */
function pushKind(eventId, role, spec = specFor(eventId)) {
    if (role === 'studio') return null;
    const explicit = notificationPrefs.kindForRecipient(eventId, role);
    if (explicit) return explicit;
    // Los avisos de sesiones del artista los gobierna "Calendario → Push"; el
    // cliente no tiene esa fila (se avisa siempre, igual que session_scheduled).
    if (role === 'artist' && SESSION_ACTIVITY_EVENTS.has(eventId)) return 'calendario';
    const byCategory = KIND_BY_CATEGORY[role] || {};
    return (spec && byCategory[spec.category]) || null;
}

/**
 * Ruta interna (sin host ni base path) a partir de un link absoluto del correo.
 * Devuelve '' si el link no es de esta app.
 */
function toAppPath(url, bases = []) {
    const target = safeUrl(String(url || ''));
    if (!target) return '';
    let parsed;
    try { parsed = new URL(target); } catch (_) { return ''; }
    for (const base of bases) {
        let root;
        try { root = new URL(String(base || '')); } catch (_) { continue; }
        if (root.origin !== parsed.origin) continue;
        const prefix = root.pathname.replace(/\/+$/, '');
        let path = parsed.pathname;
        if (prefix) {
            if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
            path = path.slice(prefix.length) || '/';
        }
        const full = `${path}${parsed.search}${parsed.hash}`;
        return isInternalPath(full) ? full : '';
    }
    return '';
}

function isInternalPath(path) {
    return typeof path === 'string' && path.length <= 600 && /^\/([^/\\]|$)/.test(path);
}

/** Agrega ?ver=<zona> a los detalles de cotización (se resalta al llegar). */
function withFocus(path, eventId) {
    const focus = FOCUS_BY_EVENT[eventId];
    if (!focus || !path) return path;
    const hashAt = path.indexOf('#');
    const hash = hashAt === -1 ? '' : path.slice(hashAt);
    const rest = hashAt === -1 ? path : path.slice(0, hashAt);
    const queryAt = rest.indexOf('?');
    const pathname = (queryAt === -1 ? rest : rest.slice(0, queryAt)).replace(/\/+$/, '') || '/';
    if (!QUOTE_DETAIL_PATHS.has(pathname) || /[?&]ver=/.test(rest)) return path;
    return `${rest}${queryAt === -1 ? '?' : '&'}ver=${focus}${hash}`;
}

/**
 * Destino exacto (P26): algunos correos llevan un CTA general (el panel, el
 * calendario). Con los datos del evento, el aviso apunta a la cotización, a
 * la sesión en el calendario o a la postulación.
 */
function refinePath(eventId, payload, role, path) {
    const d = payload || {};
    const enc = (value) => encodeURIComponent(String(value));
    const pathname = String(path || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    const bare = pathname === path || `${pathname}/` === path;
    if (role === 'artist' && pathname === '/calendar' && bare && /^session_/.test(eventId) && d.session_id) {
        // El calendario carga el mes de ?date= (y varios más): el evento se abre
        // aunque el día local del artista difiera en uno del día UTC.
        const day = /^\d{4}-\d{2}-\d{2}/.exec(String(d.session_date || ''));
        if (day && eventId !== 'session_cancelled') return `/calendar?date=${day[0]}&event=${enc(`session:${d.session_id}`)}`;
        if (day) return `/calendar?date=${day[0]}`;
    }
    if (role === 'client' && pathname === '/client/dashboard' && bare && d.quote_id) {
        return `/client/dashboard?quote=${enc(d.quote_id)}`;
    }
    if (role === 'artist' && pathname === '/artist/dashboard' && bare && d.quote_id && eventId === 'client_left_rating') {
        return `/my-quotations/detail?quote=${enc(d.quote_id)}`;
    }
    if (role === 'client' && pathname === '/client/requests' && bare && d.request_id) {
        return `/client/requests?id=${enc(d.request_id)}${d.application_id ? `&view=postulacion&app=${enc(d.application_id)}` : ''}`;
    }
    return path;
}

/** Etiqueta que agrupa avisos de la misma conversación / cotización / sesión. */
function tagFor(eventId, payload = {}) {
    const clean = (value) => String(value || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80);
    if (eventId === 'inbox_message_received' && payload.thread_id) return `inbox:${clean(payload.thread_id)}`;
    if (MESSAGE_EVENTS.has(eventId) && payload.quote_id) return `chat:${clean(payload.quote_id)}`;
    if (/^session_/.test(eventId) && payload.session_id) return `session:${clean(payload.session_id)}`;
    if (payload.quote_id) return `quote:${clean(payload.quote_id)}:${clean(eventId)}`.slice(0, 120);
    return clean(eventId);
}

/**
 * Clave de deduplicación por usuario. Los mensajes usan su id (un aviso por
 * mensaje, llegue por el camino inmediato o por el correo diferido).
 */
function dedupeKeyFor(eventId, payload = {}, { idempotencyKey, role } = {}) {
    if (MESSAGE_EVENTS.has(eventId) && payload.message_id) {
        return `msg:${String(payload.message_id).slice(0, 80)}`;
    }
    if (!idempotencyKey) return null;
    const hash = crypto.createHash('sha256').update(`${eventId}:${idempotencyKey}`).digest('hex').slice(0, 40);
    return `ev:${hash}:${role || ''}`;
}

/**
 * Título, texto y destino del aviso a partir del render spec del correo
 * (asunto, preheader y CTA). Nunca incluye el cuerpo de un mensaje ni datos
 * que el correo no lleve. Devuelve null si no hay nada que mostrar.
 */
function buildNotification(eventId, payload, target, deps = {}) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const role = target && target.role;
    const render = deps.renderEmail || require('./email-render').renderEmail;
    let rendered;
    try {
        rendered = render(eventId, data, { role, timezone: target && target.timezone });
    } catch (_) {
        return null;
    }
    let title = truncate(rendered && rendered.subject, 110);
    if (!title) return null;
    // Un asunto que quedó en un marcador ("-") no sirve como título del aviso.
    if (title.replace(/[^\p{L}\p{N}]/gu, '').length < 3) title = 'Tienes una novedad en We Ötzi';
    const bases = [data.app_base_url, publicBaseUrl()].filter(Boolean);
    const path = toAppPath(rendered.cta && rendered.cta.url, bases) || DEFAULT_PATH[role] || '/';
    const exact = refinePath(eventId, data, role, path);
    return {
        title,
        body: truncate(rendered.preheader, 180),
        url: withFocus(isInternalPath(exact) ? exact : path, eventId),
        tag: tagFor(eventId, data)
    };
}

/** Destinatarios del evento con su rol (misma resolución que el relé de correo). */
function resolveTargets(eventId, payload, deps = {}) {
    const mapping = deps.eventMapping || require('../services/email-event-mapping');
    const data = payload || {};
    const spec = deps.spec || specFor(eventId);
    const roles = mapping.resolveRecipientRoles(eventId, data);
    if (roles.length) return roles.map(entry => ({ role: entry.role, email: entry.email, user_id: entry.user_id || null }));
    const emails = mapping.resolveRecipients(eventId, data);
    const role = data.recipient_role || (spec && spec.audience) || '';
    return emails.map(email => ({
        role, email,
        user_id: emails.length === 1 && data.recipient_user_id ? data.recipient_user_id : null
    }));
}

/** user_id del destinatario: el del payload si coincide su email; si no, por email y rol. */
async function resolveUserId(target, payload, deps = {}) {
    const data = payload || {};
    const email = normalizeEmail(target.email);
    let userId = target.user_id || null;
    if (!userId && target.role === 'artist' && data.artist_user_id && email && email === normalizeEmail(data.artist_email)) {
        userId = data.artist_user_id;
    }
    if (!userId && target.role === 'client' && data.client_user_id && email && email === normalizeEmail(data.client_email)) {
        userId = data.client_user_id;
    }
    if (!userId && email) userId = await repo(deps).findUserIdByEmail(target.role, email);
    return userId && UUID_RE.test(String(userId)) ? String(userId) : null;
}

// ---------------------------------------------------------------- envío

function pushPayload(row, notification) {
    return {
        id: row && row.id ? row.id : null,
        title: notification.title,
        body: notification.body || '',
        url: notification.url || '/',
        tag: notification.tag || '',
        kind: notification.kind || '',
        ts: Date.now()
    };
}

/**
 * ¿El envío falló por algo que no habla de la suscripción? Sin respuesta del
 * servicio de push (red caída o timeout → status 0), límite de envíos (429) o
 * error del servicio (5xx). Esos fallos no cuentan para el borrado: una caída
 * de la red del servidor no puede dejar a todos los usuarios sin push (EP-04).
 */
function isTransientFailure(result) {
    if (!result || result.ok || result.gone) return false;
    const status = Number(result.status) || 0;
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * Web Push a todos los navegadores del usuario. Borra las suscripciones que
 * ya no existen (404 / 410) y las que el servicio rechaza MAX_FAILURES veces
 * seguidas (400 / 401 / 403 / 413); los fallos transitorios no se cuentan.
 */
async function sendToUser(userId, payload, options = {}, deps = {}) {
    const send = deps.sendNotification || state.deps.sendNotification || webPush.sendNotification;
    const configured = deps.isConfigured || state.deps.isConfigured || webPush.isConfigured;
    const summary = { attempted: 0, sent: 0, removed: 0 };
    if (!configured()) return summary;
    const R = repo(deps);
    const subscriptions = await R.listSubscriptions(userId);
    await Promise.all((subscriptions || []).map(async (sub) => {
        summary.attempted += 1;
        try {
            const result = await send(sub, payload, options);
            if (result.ok) {
                summary.sent += 1;
                await R.markSuccess(sub.id);
            } else if (isTransientFailure(result)) {
                log(deps, '[push] envío sin respuesta del servicio:', result.error || `HTTP ${result.status}`);
            } else if (result.gone || (Number(sub.failure_count) || 0) + 1 >= MAX_FAILURES) {
                summary.removed += 1;
                await R.deleteById(sub.id);
            } else {
                await R.markFailure(sub.id, sub.failure_count);
            }
        } catch (error) {
            log(deps, '[push] envío:', error && error.message);
        }
    }));
    return summary;
}

function maybePrune(deps = {}) {
    const now = Date.now();
    if (state.lastPruneAt + PRUNE_EVERY_MS > now) return;
    state.lastPruneAt = now;
    const before = new Date(now - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    Promise.resolve().then(() => repo(deps).pruneNotifications(before))
        .catch(error => log(deps, '[push] limpieza:', error && error.message));
}

/**
 * Avisa a un usuario: guarda el aviso (in-app, Realtime) y lo manda por Web Push.
 * @param {{ userId: string, role?: string, kind?: string|null, eventId?: string,
 *           title: string, body?: string, url?: string, tag?: string, dedupeKey?: string|null,
 *           urgency?: string, ttl?: number }} input
 * @returns {Promise<{ ok: boolean, duplicate?: boolean, stored?: boolean, id?: string, push?: object, reason?: string }>}
 */
async function notifyUser(input, deps = {}) {
    const userId = input && input.userId;
    if (!userId || !UUID_RE.test(String(userId))) return { ok: false, reason: 'invalid_user' };
    const title = truncate(input.title, 160);
    if (!title) return { ok: false, reason: 'empty_title' };
    const role = ROLES.has(input.role) ? input.role : 'client';
    const url = isInternalPath(input.url) ? input.url : DEFAULT_PATH[role];
    const notification = {
        title,
        body: truncate(input.body, 400),
        url,
        tag: String(input.tag || '').slice(0, 120),
        kind: input.kind || ''
    };
    const R = repo(deps);
    let row = null;
    let stored = false;
    try {
        row = await R.insertNotification({
            user_id: userId,
            role,
            kind: input.kind ? String(input.kind).slice(0, 40) : null,
            event_id: input.eventId ? String(input.eventId).slice(0, 100) : null,
            title: notification.title,
            body: notification.body || null,
            url: notification.url,
            tag: notification.tag || null,
            dedupe_key: input.dedupeKey ? String(input.dedupeKey).slice(0, 200) : null
        });
        // null = ya existía un aviso con esa clave: no se repite (ni su push).
        if (!row && input.dedupeKey) return { ok: true, duplicate: true };
        stored = !!row;
    } catch (error) {
        // Sin la tabla (migración pendiente) el aviso in-app se pierde, pero el
        // push igual sale; sin clave de dedupe confiable solo si no la pedían.
        log(deps, '[push] no se pudo guardar el aviso:', error && error.message);
        if (input.dedupeKey) return { ok: false, reason: 'store_failed' };
    }
    maybePrune(deps);
    let push = { attempted: 0, sent: 0, removed: 0 };
    try {
        push = await sendToUser(userId, pushPayload(row, notification), {
            topic: notification.tag,
            urgency: input.urgency || (input.kind === 'mensajes' ? 'high' : 'normal'),
            ttl: input.ttl
        }, deps);
    } catch (error) {
        log(deps, '[push] envío al usuario:', error && error.message);
    }
    return { ok: true, stored, id: row && row.id ? row.id : undefined, push };
}

/** Avisos de un evento de correo: uno por destinatario registrado que lo tenga encendido. */
async function notifyForEvent(eventId, payload, options = {}, deps = {}) {
    const spec = specFor(eventId);
    const results = [];
    let targets = [];
    try { targets = resolveTargets(eventId, payload, { ...deps, spec }); } catch (_) { targets = []; }
    for (const target of targets) {
        if (!isPushEvent(eventId, target.role, spec)) continue;
        try {
            const userId = await resolveUserId(target, payload, deps);
            if (!userId) continue;
            // Quien hizo la acción ya lo sabe: no se le avisa su propia acción.
            if (options.actorUserId && String(options.actorUserId).toLowerCase() === userId.toLowerCase()) continue;
            const kind = pushKind(eventId, target.role, spec);
            if (kind) {
                const shouldNotify = deps.shouldNotify || state.deps.shouldNotify || notificationPrefs.shouldNotify;
                const allowed = await shouldNotify({ id: userId }, kind, 'push', deps.prefsDeps || state.deps.prefsDeps || {}, target.role);
                if (!allowed) { results.push({ ok: true, skipped: true, role: target.role }); continue; }
            }
            const notification = buildNotification(eventId, payload, target, deps);
            if (!notification) continue;
            const result = await notifyUser({
                userId, role: target.role, kind, eventId,
                ...notification,
                dedupeKey: dedupeKeyFor(eventId, payload, { idempotencyKey: options.idempotencyKey, role: target.role })
            }, deps);
            results.push({ ...result, role: target.role });
        } catch (error) {
            log(deps, `[push] ${eventId}:`, error && error.message);
        }
    }
    return results;
}

function fireAndForget(promise, deps) {
    return Promise.resolve(promise).catch((error) => {
        log(deps, '[push] aviso:', error && error.message);
        return [];
    });
}

/**
 * Enganche de services/email-service.js: se llama una vez por sendEmail().
 * No bloquea: devuelve la promesa solo para los tests.
 */
function onEmailEvent(eventId, payload, options = {}) {
    if (!state.enabled || !options || options.push === false || options.claimed) return null;
    // Envíos de prueba del backoffice (canal forzado, datos ficticios): solo correo.
    if (options.forceChannel) return null;
    return fireAndForget(notifyForEvent(eventId, payload, {
        idempotencyKey: options.idempotencyKey,
        actorUserId: options.actorUserId
    }));
}

/**
 * Enganche de POST /api/email/:eventId para chat e inbox: avisa YA, aunque el
 * correo quede en cola o agrupado. `context` es el de resolveEmailContext.
 */
function onMessageEvent(eventId, context) {
    if (!state.enabled || !MESSAGE_EVENTS.has(eventId)) return null;
    if (!context || !context.ok || context.skip || !context.payload) return null;
    return fireAndForget(notifyForEvent(eventId, context.payload, {}));
}

module.exports = {
    enable,
    disable,
    isEnabled,
    isPushEvent,
    pushKind,
    toAppPath,
    isInternalPath,
    withFocus,
    refinePath,
    tagFor,
    dedupeKeyFor,
    buildNotification,
    resolveTargets,
    resolveUserId,
    isTransientFailure,
    sendToUser,
    notifyUser,
    notifyForEvent,
    onEmailEvent,
    onMessageEvent,
    MESSAGE_EVENTS,
    PUSH_SKIP_EVENTS,
    PUSH_EXTRA_EVENTS,
    SESSION_ACTIVITY_EVENTS,
    FOCUS_BY_EVENT,
    DEFAULT_PATH,
    MAX_FAILURES
};
