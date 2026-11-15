'use strict';

// ===========================================================================
// Preferencias de notificaciones (Cuenta 801:572) aplicadas a los envíos
// ---------------------------------------------------------------------------
// La matriz Evento × Email/Push/SMS se guarda en
// user_preferences.notification_prefs = { <kind>: { email, push, sms } }.
// Este módulo es la ÚNICA fuente de verdad del lado servidor para decidir si
// un aviso se envía. Uso típico:
//
//   const { shouldNotify } = require('./lib/notification-prefs');
//   if (await shouldNotify({ id: artistUserId }, 'invitaciones', 'email')) { ... }
//   if (await shouldNotify({ email: artistEmail }, 'spots', 'email')) { ... }
//
// Reglas:
//   - Sin fila / sin clave / valor no booleano → default del Figma (NOTIF_DEFAULTS).
//   - "Promociones por email" cae a artists_db.subscribed_newsletter si la
//     matriz nunca se tocó (mismo criterio que artist-account.js).
//   - Si no se puede leer la preferencia (red, sin env), se ENVÍA (fail-open):
//     un aviso transaccional perdido es peor que uno no deseado.
//   - Kinds o canales desconocidos → se envía (no bloquear avisos nuevos que
//     todavía no tienen fila en la matriz).
// ===========================================================================

// kind → [email, push, sms] por defecto (ref 801:572, igual a NOTIF_EVENTS de
// public/shared/js/artist-account.js).
const NOTIF_DEFAULTS = Object.freeze({
    mensajes: Object.freeze({ email: true, push: true, sms: false }),
    cotizaciones: Object.freeze({ email: true, push: true, sms: true }),
    invitaciones: Object.freeze({ email: true, push: true, sms: false }),
    spots: Object.freeze({ email: true, push: false, sms: false }),
    job_board: Object.freeze({ email: false, push: true, sms: false }),
    calendario: Object.freeze({ email: true, push: true, sms: false }),
    promociones: Object.freeze({ email: false, push: false, sms: false })
});

const NOTIF_KINDS = Object.freeze(Object.keys(NOTIF_DEFAULTS));

// Matriz del cliente (public/shared/js/client-profile.js NOTIF_EVENTS): el
// email viene prendido por defecto; push/SMS todavía no existen.
const CLIENT_NOTIF_DEFAULTS = Object.freeze({
    postulaciones: Object.freeze({ email: true, push: false, sms: false }),
    mensajes: Object.freeze({ email: true, push: false, sms: false }),
    cotizaciones: Object.freeze({ email: true, push: false, sms: false })
});
const NOTIF_CHANNELS = Object.freeze(['email', 'push', 'sms']);

// eventId de services/email-event-mapping.js → kind de la matriz, SOLO para
// los correos que recibe el ARTISTA. Los transaccionales (registro, reset de
// contraseña, verificación, código de Instagram) no se filtran nunca.
const EMAIL_EVENT_KINDS = Object.freeze({
    studio_roster_invite: 'invitaciones',
    studio_spot_decision: 'spots',
    artist_new_quotation: 'cotizaciones',
    client_approved_quotation: 'cotizaciones',
    client_rejected_quotation: 'cotizaciones',
    client_left_rating: 'cotizaciones',
    quotation_completed_summary: 'cotizaciones',
    job_board_application_accepted: 'job_board',
    job_board_application_rejected: 'job_board',
    chat_message_to_artist: 'mensajes',
    session_scheduled: 'calendario',
    session_rescheduled: 'calendario',
    session_completed: 'calendario',
    session_cancelled: 'calendario',
    session_reminder_24h: 'calendario',
    artist_calendar_reminder: 'calendario',
    inbox_message_received: 'mensajes'
});

// eventId → kind de la matriz del CLIENTE (EM-N3). Las confirmaciones
// transaccionales (solicitud enviada, registro, sesiones agendadas) no se
// filtran: el cliente las necesita para saber qué pasó con su pedido.
const CLIENT_EMAIL_EVENT_KINDS = Object.freeze({
    chat_message_to_client: 'mensajes',
    inbox_message_received: 'mensajes',
    artist_responded_quotation: 'cotizaciones',
    artist_rejected_quotation: 'cotizaciones',
    quotation_ready_for_client: 'cotizaciones',
    quotation_expired: 'cotizaciones',
    request_rating: 'cotizaciones',
    quotation_completed_summary: 'cotizaciones',
    job_board_application_received: 'postulaciones'
});

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Decide con la matriz ya cargada (función pura).
 * @param {object|null} prefs   user_preferences.notification_prefs
 * @param {string} kind
 * @param {string} channel      email | push | sms
 * @param {{ subscribedNewsletter?: boolean|null }} [extra]
 * @returns {boolean}
 */
function resolvePreference(prefs, kind, channel, extra = {}) {
    const k = String(kind || '').trim();
    const ch = String(channel || '').trim().toLowerCase();
    const defaults = extra.defaults || NOTIF_DEFAULTS;
    if (!defaults[k] || !NOTIF_CHANNELS.includes(ch)) return true;
    const saved = isPlainObject(prefs) && isPlainObject(prefs[k]) ? prefs[k] : null;
    if (saved && typeof saved[ch] === 'boolean') return saved[ch];
    // cliente-panel (ronda 2): el registro del cliente guarda su toggle "Email"
    // en formato plano (email_updates). Apagado vale para toda la matriz del
    // cliente mientras no elija por evento en /client/profile#notificaciones.
    if (defaults === CLIENT_NOTIF_DEFAULTS && ch === 'email' && isPlainObject(prefs) && prefs.email_updates === false) return false;
    if (k === 'promociones' && ch === 'email' && typeof extra.subscribedNewsletter === 'boolean') {
        return extra.subscribedNewsletter;
    }
    return defaults[k][ch];
}

/** kind de la matriz para un eventId de email dirigido al artista, o null. */
function kindForEmailEvent(eventId) {
    return EMAIL_EVENT_KINDS[eventId] || null;
}

/** kind según el rol del destinatario ('artist' | 'client'), o null. */
function kindForRecipient(eventId, role) {
    if (role === 'client') return CLIENT_EMAIL_EVENT_KINDS[eventId] || null;
    if (role === 'artist') return EMAIL_EVENT_KINDS[eventId] || null;
    return null;
}

function normalizeUser(user) {
    if (!user) return {};
    if (typeof user === 'string') {
        return user.includes('@') ? { email: user.trim().toLowerCase() } : { id: user.trim() };
    }
    return {
        id: user.id || user.user_id || null,
        email: user.email ? String(user.email).trim().toLowerCase() : null
    };
}

function defaultQuery() {
    // require diferido: los tests puros no necesitan SUPABASE_URL.
    return require('./postgrest').pgrest;
}

/**
 * Carga lo necesario para decidir: { userId, prefs, subscribedNewsletter }.
 * Busca el artista por user_id o por email (artists_db).
 */
async function loadUserNotificationPrefs(user, deps = {}, role = 'artist') {
    const query = deps.query || defaultQuery();
    const u = normalizeUser(user);
    let userId = u.id || null;
    let subscribedNewsletter = null;

    if (role === 'client') {
        // Cliente: user_preferences por user_id; sin id, se busca en clients_db.
        if (!userId && u.email) {
            const client = await query('clients_db').select('user_id').limit(1).single()
                .ilike('email', u.email.replace(/[\\%_]/g, (c) => `\\${c}`)).execute();
            userId = client && client.user_id ? client.user_id : null;
        }
    } else if (u.email || userId) {
        const q = query('artists_db').select('user_id,subscribed_newsletter').limit(1).single();
        // ilike sin comodines: se escapan % y _ para que un email no matchee a otro.
        const artist = await (userId
            ? q.eq('user_id', userId)
            : q.ilike('email', u.email.replace(/[\\%_]/g, (c) => `\\${c}`))).execute();
        if (artist) {
            userId = userId || artist.user_id || null;
            if (typeof artist.subscribed_newsletter === 'boolean') subscribedNewsletter = artist.subscribed_newsletter;
        }
    }
    if (!userId) return { userId: null, prefs: null, subscribedNewsletter };

    const row = await query('user_preferences').select('user_id,notification_prefs')
        .eq('user_id', userId).limit(1).single().execute();
    return { userId, prefs: row ? row.notification_prefs || null : null, subscribedNewsletter };
}

/**
 * ¿Hay que avisarle a este usuario por este canal?
 * @param {{id?:string,email?:string}|string} user  user_id, email o ambos
 * @param {string} kind     mensajes | cotizaciones | invitaciones | spots | job_board | calendario | promociones
 * @param {string} channel  email | push | sms
 * @param {{ query?: Function, onError?: Function }} [deps]
 * @returns {Promise<boolean>}
 */
async function shouldNotify(user, kind, channel = 'email', deps = {}, role = 'artist') {
    const defaults = role === 'client' ? CLIENT_NOTIF_DEFAULTS : NOTIF_DEFAULTS;
    if (!defaults[kind] || !NOTIF_CHANNELS.includes(String(channel).toLowerCase())) return true;
    try {
        const loaded = await loadUserNotificationPrefs(user, deps, role);
        return resolvePreference(loaded.prefs, kind, channel, { subscribedNewsletter: loaded.subscribedNewsletter, defaults });
    } catch (err) {
        if (typeof deps.onError === 'function') deps.onError(err);
        else console.warn('[notification-prefs] no se pudo leer la preferencia; se envía:', err.message);
        return true;
    }
}

/**
 * Filtro para services/email-service.js. Si el evento va al artista y el
 * artista apagó ese aviso por email:
 *   - destinatario único → { skip: true }
 *   - varios destinatarios (cliente + artista) → payload sin artist_email y
 *     con notify_artist=false (n8n y BillionMail resuelven sin el artista).
 * @returns {Promise<{ skip: boolean, payload: object, kind: string|null, reason?: string }>}
 */
async function applyEmailPreferences(eventId, payload, deps = {}) {
    let data = payload || {};
    const artistKind = kindForEmailEvent(eventId);
    const clientKind = CLIENT_EMAIL_EVENT_KINDS[eventId] || null;
    // inbox_message_received: un solo destinatario con rol explícito.
    if (data.recipient_role && data.recipient_email && (artistKind || clientKind)) {
        const role = data.recipient_role === 'client' ? 'client' : data.recipient_role === 'artist' ? 'artist' : null;
        const kind = role ? kindForRecipient(eventId, role) : null;
        if (!kind) return { skip: false, payload: data, kind: null };
        const allowed = await shouldNotify({ id: data.recipient_user_id, email: data.recipient_email }, kind, 'email', deps, role);
        return allowed ? { skip: false, payload: data, kind } : { skip: true, payload: data, kind, reason: 'notification_pref' };
    }
    if (!artistKind && !clientKind) return { skip: false, payload: data, kind: null };
    const recipients = deps.resolveRecipients ? deps.resolveRecipients(eventId, data) : null;
    let reason;
    let kind = artistKind || clientKind;

    const removals = [];
    if (artistKind) {
        const artistEmail = data.artist_email || (eventId.startsWith('studio_') ? data.to : null);
        const artistUserId = data.artist_user_id || data.meta?.artist_user_id || null;
        if ((artistEmail || artistUserId) && !(await shouldNotify({ id: artistUserId, email: artistEmail }, artistKind, 'email', deps))) {
            removals.push({ key: String(artistEmail || '').trim().toLowerCase(), patch: { artist_email: '', notify_artist: false }, kind: artistKind, reason: 'artist_pref_removed' });
        }
    }
    if (clientKind && data.client_email) {
        if (!(await shouldNotify({ id: data.client_user_id, email: data.client_email }, clientKind, 'email', deps, 'client'))) {
            removals.push({ key: String(data.client_email).trim().toLowerCase(), patch: { client_email: '', notify_client: false }, kind: clientKind, reason: 'client_pref_removed' });
        }
    }
    if (!removals.length) return { skip: false, payload: data, kind };

    const removedKeys = new Set(removals.map((r) => r.key));
    const others = Array.isArray(recipients) ? recipients.filter((r) => !removedKeys.has(r)) : [];
    kind = removals[0].kind;
    if (!others.length) {
        return { skip: true, payload: data, kind, reason: 'notification_pref' };
    }
    for (const removal of removals) {
        data = { ...data, ...removal.patch };
        reason = removal.reason;
    }
    return { skip: false, payload: data, kind, reason };
}

/**
 * ¿Le llega este evento a este destinatario? (envío por destinatario del relé)
 * @param {{ role: string, email?: string, user_id?: string }} recipient
 * @returns {Promise<{ allowed: boolean, kind: string|null }>}
 */
async function allowRecipient(eventId, recipient, deps = {}) {
    const role = recipient && recipient.role;
    const kind = kindForRecipient(eventId, role);
    if (!kind) return { allowed: true, kind: null };
    const allowed = await shouldNotify({ id: recipient.user_id || null, email: recipient.email || null }, kind, 'email', deps, role);
    return { allowed, kind };
}

module.exports = {
    NOTIF_DEFAULTS,
    CLIENT_NOTIF_DEFAULTS,
    NOTIF_KINDS,
    NOTIF_CHANNELS,
    EMAIL_EVENT_KINDS,
    CLIENT_EMAIL_EVENT_KINDS,
    resolvePreference,
    kindForEmailEvent,
    kindForRecipient,
    allowRecipient,
    loadUserNotificationPrefs,
    shouldNotify,
    applyEmailPreferences
};
