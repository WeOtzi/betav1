'use strict';

const { pgrest } = require('../lib/postgrest');
const { resolveBearerUser, verifyAdminCaller } = require('../lib/auth/supabase-auth');
const { deliveryKey } = require('./email-delivery-ledger');
const { serverOnlyEventIds } = require('./email-event-mapping');
const { DEFAULT_PUBLIC_BASE, safeUrl } = require('../lib/email-format');

const ADMIN_EVENTS = new Set(['ambassador_status_updated', 'platform_update', 'password_reset_temp']);
const ARTIST_EVENTS = new Set(['artist_responded_quotation', 'chat_message_to_client', 'session_scheduled', 'session_rescheduled', 'session_completed', 'session_cancelled',
    'artist_rejected_quotation', 'quotation_ready_for_client', 'dispute_artist_response']);
// Avisos al cliente (ronda 3 · P8): solo salen si la cotización guardada está
// en el estado que anuncian (no se puede avisar un rechazo que no ocurrió).
const REQUIRED_QUOTE_STATUS = {
    artist_rejected_quotation: ['cancelled'],
    quotation_ready_for_client: ['artist_completed']
};
const CLIENT_EVENTS = new Set(['client_approved_quotation', 'client_rejected_quotation', 'client_left_rating', 'chat_message_to_artist']);
// Sent only by trusted server routes (they carry secrets such as verification codes,
// or are triggered by a server-side state change). Without this guard they would
// fall through to the quotation branch below. Los archivos de
// services/email-events/*.js suman los suyos con `serverOnly: true`.
const SERVER_ONLY_EVENTS = new Set(['instagram_verification_code', 'quotation_expired', 'artist_calendar_reminder', 'artist_support_decision',
    // ── borrado ── bajas de cuenta: solo el servidor (lib/account-deletion.js).
    'account_deletion_received', 'account_deletion_approved', 'account_deletion_rejected', 'account_deletion_completed',
    // ── emails ── estudios (POST /api/studio/notify), verificación (POST
    // /api/support/artist-verification-notify) y cierre por el cliente
    // (POST /api/client/quotations/:id/complete).
    'studio_roster_invite', 'studio_spot_decision', 'profile_verified', 'profile_verification_denied',
    'quotation_completed_summary', 'request_rating',
    ...serverOnlyEventIds()]);

// Chat e inbox: como mucho un correo cada 15 min por conversación y
// destinatario (INB-03 / EM-08), y se espera un rato antes de enviarlo para
// no avisar de mensajes que ya se leyeron.
const MESSAGE_EMAIL_WINDOW_MS = Math.max(60 * 1000, Number(process.env.CHAT_EMAIL_WINDOW_MS) || 15 * 60 * 1000);
const MESSAGE_EMAIL_DELAY_MS = Math.max(0, Number.isFinite(Number(process.env.CHAT_EMAIL_DELAY_MS)) && process.env.CHAT_EMAIL_DELAY_MS !== ''
    && process.env.CHAT_EMAIL_DELAY_MS !== undefined ? Number(process.env.CHAT_EMAIL_DELAY_MS) : 2 * 60 * 1000);

// Columnas de la cotización que NUNCA viajan al payload de un correo (EM-17).
const PRIVATE_QUOTE_COLUMNS = ['client_health_conditions', 'client_allergies', 'client_birth_date', 'client_age',
    'client_whatsapp', 'client_instagram', 'client_contact_preference', 'notes', 'fields_completed', 'missing_fields',
    'validation_errors', 'session_id'];

const fail = (status, error, reason) => ({ ok: false, status, error, reason: reason || `http_${status}` });
const same = (left, right) => !!left && !!right && String(left).toLowerCase() === String(right).toLowerCase();

async function read(table, fields) {
    let query = pgrest(table).select('*');
    for (const [column, value] of Object.entries(fields)) query = query.eq(column, value);
    return (await query.limit(1).execute())[0] || null;
}

function applicationBase(req) {
    const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL;
    if (configured && safeUrl(configured)) return configured.replace(/\/$/, '');
    const host = String(req?.get?.('host') || req?.headers?.host || '');
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}${req.weotziBasePath || ''}`;
    // Producción es beta.weotzi.com (weotzi.com es el sitio corporativo
    // estático). Nunca se usa el header Host para los links de email.
    return DEFAULT_PUBLIC_BASE;
}

/** Ventana de 15 min (número) para la clave de idempotencia de mensajes. */
function messageWindow(at, windowMs = MESSAGE_EMAIL_WINDOW_MS) {
    const time = Date.parse(at || '') || Date.now();
    return Math.floor(time / windowMs);
}

function withLinks(payload, base, role) {
    const output = { ...payload };
    // Email links always come from trusted application configuration, never caller input.
    for (const key of Object.keys(output)) {
        if (/(?:_url|_link)$/.test(key)) delete output[key];
    }
    const quote = encodeURIComponent(payload.quote_id || '');
    const artist = encodeURIComponent(payload.username || payload.artist_username || '');
    return { ...output,
        app_base_url: base,
        dashboard_url: `${base}/${role}/dashboard`,
        login_url: `${base}/${role}/login`,
        register_url: `${base}/client/register`,
        profile_url: `${base}/artist/profile?artist=${artist}`,
        portfolio_url: `${base}/artist/profile?artist=${artist}`,
        quotation_url: role === 'client' ? `${base}/client/dashboard${quote ? `?quote=${quote}` : ''}`
            : `${base}/my-quotations/detail?quote=${quote}`,
        chat_url: role === 'client' ? `${base}/client/chats${quote ? `?quote=${quote}` : ''}`
            : `${base}/artist/inbox${quote ? `?quote=${quote}` : ''}`,
        calendar_url: `${base}/calendar`,
        account_url: role === 'client' ? `${base}/client/profile` : `${base}/artist/account#verificacion`,
        review_url: `${base}/client/dashboard${quote ? `?quote=${quote}&review=1` : ''}`,
        preferences_url: role === 'client' ? `${base}/client/profile#notificaciones` : `${base}/artist/account#notificaciones`
    };
}

function publicQuote(quote) {
    const out = { ...quote };
    for (const column of PRIVATE_QUOTE_COLUMNS) delete out[column];
    return out;
}

async function latestChatMessage(quoteId, senderId, deps) {
    if (deps.latestMessage) return deps.latestMessage(quoteId, senderId);
    return (await pgrest('chat_messages').select('*').eq('quotation_id', quoteId).eq('sender_id', senderId)
        .order('created_at', { ascending: false }).limit(1).execute())[0] || null;
}

/** Quién es quién: rol y datos de contacto de un user_id (artista, cliente o estudio). */
async function identifyUser(userId, lookup) {
    if (!userId) return null;
    const artist = await lookup('artists_db', { user_id: userId });
    if (artist) return { role: 'artist', user_id: userId, email: artist.email, name: artist.name || artist.username || '' };
    const client = await lookup('clients_db', { user_id: userId });
    if (client) return { role: 'client', user_id: userId, email: client.email, name: client.full_name || '' };
    const studio = await lookup('studios', { user_id: userId });
    if (studio) return { role: 'studio', user_id: userId, email: studio.email, name: studio.name || '' };
    return null;
}

async function inboxContext(user, payload, base, lookup, deps) {
    if (!user) return fail(401, 'Iniciá sesión para enviar esta notificación.');
    if (!payload.message_id) return fail(400, 'Falta el mensaje asociado al correo.');
    const message = await lookup('inbox_messages', { id: payload.message_id, sender_user_id: user.id });
    if (!message) return fail(409, 'Guardá el mensaje antes de enviar la notificación.');
    const thread = await lookup('inbox_threads', { id: message.thread_id });
    if (!thread) return fail(404, 'No se encontró la conversación.');
    const participants = deps.listParticipants
        ? await deps.listParticipants(thread.id)
        : await pgrest('inbox_thread_participants').select('user_id,participant_role,last_read_at').eq('thread_id', thread.id).execute();
    const members = new Set([thread.artist_user_id, thread.counterparty_user_id, ...(participants || []).map(p => p.user_id)].filter(Boolean).map(String));
    if (!members.has(String(user.id))) return fail(403, 'Esta conversación no corresponde a tu cuenta.');
    const others = [...members].filter(id => id !== String(user.id));
    if (!others.length) return fail(409, 'La conversación no tiene otro participante.');
    // Hilos 1 a 1: el destinatario es el otro participante (artista primero).
    const recipientId = others.includes(String(thread.artist_user_id)) ? String(thread.artist_user_id) : others[0];
    const recipient = await identifyUser(recipientId, lookup);
    if (!recipient || !recipient.email) return fail(409, 'El destinatario no tiene un email guardado.');
    const sender = await identifyUser(user.id, lookup);
    const threadParam = encodeURIComponent(thread.id);
    const chatUrl = recipient.role === 'client' ? `${base}/client/chats`
        : recipient.role === 'studio' ? `${base}/studio/dashboard?thread=${threadParam}`
            : `${base}/artist/inbox?thread=${threadParam}`;
    const window = messageWindow(message.created_at);
    return {
        ok: true,
        idempotencyKey: `inbox:${thread.id}:${recipientId}:${window}`,
        payload: {
            app_base_url: base,
            thread_id: thread.id,
            message_id: message.id,
            recipient_email: recipient.email,
            recipient_name: recipient.name,
            recipient_role: recipient.role,
            recipient_user_id: recipientId,
            sender_name: (sender && sender.name) || thread.counterparty_name || '',
            thread_subject: String(thread.subject || '').slice(0, 120),
            message_preview: String(message.body || (message.attachment_name ? `Adjunto: ${message.attachment_name}` : '')).slice(0, 280),
            chat_url: chatUrl
        },
        defer: {
            delayMs: MESSAGE_EMAIL_DELAY_MS,
            // Si el destinatario ya abrió el hilo después del mensaje, no se avisa.
            stillPending: async () => {
                const rows = deps.listParticipants
                    ? await deps.listParticipants(thread.id)
                    : await pgrest('inbox_thread_participants').select('user_id,last_read_at').eq('thread_id', thread.id).eq('user_id', recipientId).execute();
                const row = (rows || []).find(p => String(p.user_id) === recipientId);
                return !(row && row.last_read_at && Date.parse(row.last_read_at) >= Date.parse(message.created_at));
            }
        }
    };
}

/** Resolve trusted recipients and ownership from persisted business records. */
async function resolveEmailContext(req, eventId, input, deps = {}) {
    if (SERVER_ONLY_EVENTS.has(eventId)) return fail(403, 'Este correo lo envía solo el servidor.', 'server_only');
    const lookup = deps.read || read;
    const user = await (deps.resolveUser || resolveBearerUser)(req);
    const base = applicationBase(req);
    const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

    if (ADMIN_EVENTS.has(eventId)) {
        const admin = await (deps.verifyAdmin || verifyAdminCaller)(req);
        if (!admin.ok) return admin;
        return { ok: true, payload: withLinks(payload, base, payload.user_type || 'artist'),
            idempotencyKey: `admin:${admin.userId}:${deliveryKey(eventId, JSON.stringify(payload))}` };
    }

    if (eventId === 'inbox_message_received') return inboxContext(user, payload, base, lookup, deps);

    if (eventId === 'artist_registration_completed' || eventId === 'client_registration_completed') {
        if (!user) return fail(401, 'Iniciá sesión para confirmar el correo de bienvenida.');
        const artist = eventId.startsWith('artist_');
        const row = await lookup(artist ? 'artists_db' : 'clients_db', { user_id: user.id });
        if (!row) return fail(403, 'No se encontró tu perfil para enviar el correo.');
        const safeRow = { ...row };
        for (const column of ['health_conditions', 'allergies', 'birth_date', 'password']) delete safeRow[column];
        return { ok: true, idempotencyKey: `registration:${user.id}`, payload: withLinks({
            ...safeRow, email: user.email, full_name: row.full_name || row.name,
            artistic_name: row.name, city: row.city || row.city_residence,
            studio: row.estudios, styles_text: Array.isArray(row.styles_array) ? row.styles_array.join(', ') : row.estilo
        }, base, artist ? 'artist' : 'client') };
    }

    if (eventId.startsWith('job_board_')) {
        if (!user) return fail(401, 'Iniciá sesión para enviar esta notificación.');
        let application = payload.application_id ? await lookup('job_board_applications', { id: payload.application_id }) : null;
        const requestId = application?.request_id || payload.request_id;
        const request = requestId ? await lookup('job_board_requests', { id: requestId })
            : payload.request_code ? await lookup('job_board_requests', { request_code: payload.request_code }) : null;
        if (!request) return fail(404, 'No se encontró la solicitud.');
        if (!application && eventId !== 'job_board_request_created') {
            let artistId = eventId === 'job_board_application_received' ? user.id : request.accepted_artist_id;
            if (!artistId && payload.artist_email) artistId = (await lookup('artists_db', { email: payload.artist_email }))?.user_id;
            if (artistId) application = await lookup('job_board_applications', { request_id: request.id, artist_id: artistId });
        }
        if (eventId !== 'job_board_request_created' && !application) return fail(404, 'No se encontró la postulación.');
        const isApplicationSender = eventId === 'job_board_application_received';
        if (isApplicationSender ? application.artist_id !== user.id : request.client_user_id !== user.id) {
            return fail(403, 'Esta notificación no corresponde a tu cuenta.');
        }
        if (eventId.endsWith('_accepted') && application.status !== 'accepted') return fail(409, 'La postulación aún no fue aceptada.');
        if (eventId.endsWith('_rejected') && application.status !== 'rejected') return fail(409, 'La postulación aún no fue rechazada.');
        const client = await lookup('clients_db', { user_id: request.client_user_id });
        const artist = application ? await lookup('artists_db', { user_id: application.artist_id }) : null;
        return { ok: true, idempotencyKey: `job:${request.id}:${application?.id || 'created'}`, payload: withLinks({
            ...request, ...application, request_id: request.id, application_id: application?.id,
            client_email: client?.email, client_name: client?.full_name, client_user_id: request.client_user_id,
            artist_email: artist?.email, artist_name: artist?.name, artist_user_id: application?.artist_id,
            quote_id: request.resulting_quote_id, budget_min: request.client_budget_min,
            budget_max: request.client_budget_max, budget_currency: request.client_budget_currency,
            message_preview: application?.message
        }, base, isApplicationSender || eventId === 'job_board_request_created' ? 'client' : 'artist') };
    }

    if (!payload.quote_id) return fail(400, 'Falta la cotización asociada al correo.');
    let quote = await lookup('quotations_db', { quote_id: payload.quote_id });
    if (!quote && /^\d+$/.test(String(payload.quote_id))) quote = await lookup('quotations_db', { id: payload.quote_id });
    if (!quote) return fail(404, 'No se encontró la cotización.');
    const artist = quote.artist_id ? await lookup('artists_db', { user_id: quote.artist_id }) : null;
    const isArtist = user && (same(quote.artist_id, user.id) || same(artist?.user_id, user.id) || same(quote.artist_email, user.email));
    const isClient = user && (same(quote.client_user_id, user.id) || same(quote.client_email, user.email));
    if (eventId === 'client_quotation_submitted') {
        // Public quote creation has no login. It can only send the saved record to
        // its saved recipients once, during the creation window.
        if (!user && (!same(payload.client_email, quote.client_email) || Date.now() - Date.parse(quote.created_at) > 30 * 60 * 1000)) {
            return fail(403, 'No se puede enviar esta confirmación.');
        }
        if (user && !isArtist && !isClient) return fail(403, 'Esta cotización no corresponde a tu cuenta.');
    } else {
        if (!user) return fail(401, 'Iniciá sesión para enviar esta notificación.');
        // Artists can record an agreement reached offline in the existing panel.
        // Its persisted status, ownership, and recipients remain authoritative.
        const offlineDecision = isArtist && ['client_approved_quotation', 'client_rejected_quotation'].includes(eventId)
            && quote.quote_status === (eventId === 'client_approved_quotation' ? 'client_approved' : 'client_rejected');
        if (ARTIST_EVENTS.has(eventId) ? !isArtist : CLIENT_EVENTS.has(eventId) ? !isClient && !offlineDecision : !isArtist && !isClient) {
            return fail(403, 'Esta cotización no corresponde a tu cuenta.');
        }
    }
    if (REQUIRED_QUOTE_STATUS[eventId] && !REQUIRED_QUOTE_STATUS[eventId].includes(quote.quote_status)) {
        return fail(409, 'El estado de la cotización cambió. No se envió el aviso.');
    }
    let entity = quote.quote_id;
    let persisted = {};
    let defer = null;
    if (eventId === 'client_left_rating') {
        // Reseña verificada (verified_reviews) del cliente sobre esta cotización.
        const review = await lookup('verified_reviews', { quotation_id: quote.id, reviewer_user_id: user.id });
        if (!review) return fail(409, 'Guardá la reseña antes de enviar el aviso.');
        entity += `:review:${review.id}`;
        persisted = { rating: review.rating, rating_comment: String(review.comment || '').slice(0, 500) };
    } else if (eventId === 'dispute_artist_response') {
        if (!payload.dispute_id) return fail(400, 'Falta la disputa asociada al correo.');
        const dispute = await lookup('quotation_disputes', { id: payload.dispute_id, quotation_id: quote.id });
        if (!dispute || !String(dispute.artist_response || '').trim()) return fail(409, 'Guardá la respuesta antes de enviar el aviso.');
        entity += `:dispute:${dispute.id}:${dispute.artist_responded_at || ''}`;
        persisted = {
            dispute_id: dispute.id, dispute_title: dispute.title || '',
            artist_response: String(dispute.artist_response).slice(0, 1000),
            support_email: process.env.SUPPORT_EMAIL || ''
        };
    } else if (eventId.startsWith('chat_message_')) {
        const message = payload.message_id ? await lookup('chat_messages', { id: payload.message_id, quotation_id: quote.quote_id, sender_id: user.id })
            : await latestChatMessage(quote.quote_id, user.id, deps);
        if (!message) return fail(409, 'Guardá el mensaje antes de enviar la notificación.');
        if (message.is_read === true) return { ok: true, skip: true, reason: 'already_read' };
        // Un correo por conversación, destinatario y ventana de 15 min.
        const recipientRole = eventId === 'chat_message_to_client' ? 'client' : 'artist';
        entity = `chat:${quote.quote_id}:${recipientRole}:${messageWindow(message.created_at)}`;
        persisted.message_preview = String(message.message || '').slice(0, 280);
        persisted.message_id = message.id;
        defer = {
            delayMs: MESSAGE_EMAIL_DELAY_MS,
            stillPending: async () => {
                const fresh = deps.reloadMessage ? await deps.reloadMessage(message.id) : await lookup('chat_messages', { id: message.id });
                return !(fresh && fresh.is_read === true);
            }
        };
    } else if (eventId.startsWith('session_')) {
        if (!payload.session_id) return fail(400, 'Falta la sesión asociada al correo.');
        const session = await lookup('quotation_sessions', { id: payload.session_id, quotation_id: quote.id });
        if (!session) return fail(409, 'Guardá la sesión antes de enviar la notificación.');
        const expectedStatus = eventId.slice('session_'.length);
        if (session.status !== expectedStatus) return fail(409, 'El estado de la sesión cambió. No se envió una notificación anterior.');
        entity += `:session:${session.id}:${session.updated_at || session.session_date}`;
        const { notes, photo_urls, google_event_id, ...publicSession } = session;
        persisted = { ...publicSession, session_id: session.id, duration_hours: session.duration_hours };
    } else if (eventId === 'artist_responded_quotation') {
        // EM-N7: el mensaje del artista viaja como extracto en este aviso
        // (el chat no manda un segundo correo por la misma acción).
        entity += `:${quote.quote_status}:${quote.artist_responded_at || ''}:${quote.rating || ''}`;
        const latest = isArtist ? await latestChatMessage(quote.quote_id, user.id, deps).catch(() => null) : null;
        const recent = latest && (!quote.artist_responded_at || Math.abs(Date.parse(latest.created_at) - Date.parse(quote.artist_responded_at)) < 10 * 60 * 1000);
        if (recent) persisted.message_preview = String(latest.message || '').slice(0, 400);
    } else if (eventId !== 'client_quotation_submitted') entity += `:${quote.quote_status}:${quote.artist_responded_at || ''}:${quote.rating || ''}`;
    const context = { ok: true, idempotencyKey: entity, payload: buildQuotationEmailPayload(quote, artist, persisted, base, CLIENT_EVENTS.has(eventId) ? 'artist' : 'client') };
    if (defer) context.defer = defer;
    return context;
}

/** Payload de un correo de cotización a partir de los registros guardados. */
function buildQuotationEmailPayload(quote, artist, persisted, base, role) {
    const clean = publicQuote(quote);
    return withLinks({
        ...clean, ...persisted, quote_id: quote.quote_id,
        drive_folder: safeUrl(quote.drive_folder_url || '') || '',
        client_name: quote.client_full_name, artist_name: artist?.name || quote.artist_name,
        artist_email: artist?.email || quote.artist_email,
        artist_user_id: quote.artist_id,
        recipient_name: quote.client_full_name, recipient_email: quote.client_email,
        estimated_sessions: quote.tattoo_estimated_sessions,
        tattoo_description: quote.tattoo_idea_description, tattoo_location: quote.tattoo_body_part,
        client_budget: `${quote.client_budget_amount || ''} ${quote.client_budget_currency || ''}`.trim(),
        artist_budget: `${quote.artist_budget_amount || ''} ${quote.artist_budget_currency || ''}`.trim()
    }, base, role);
}

/**
 * Contexto de un correo de cotización que dispara el SERVIDOR (sin usuario
 * del navegador): cierre por el cliente → quotation_completed_summary y
 * request_rating. Relee la cotización guardada.
 */
async function serverQuotationContext(eventId, quoteId, deps = {}) {
    const lookup = deps.read || read;
    const quote = await lookup('quotations_db', { quote_id: quoteId });
    if (!quote) return fail(404, 'No se encontró la cotización.');
    if (['quotation_completed_summary', 'request_rating'].includes(eventId) && quote.quote_status !== 'completed') {
        return fail(409, 'La cotización todavía no está completada.');
    }
    const artist = quote.artist_id ? await lookup('artists_db', { user_id: quote.artist_id }) : null;
    const base = deps.baseUrl || applicationBase({ headers: {} });
    return { ok: true, idempotencyKey: `${quote.quote_id}:${eventId}:${quote.client_completed_at || quote.quote_status}`,
        payload: buildQuotationEmailPayload(quote, artist, {}, base, 'client') };
}

module.exports = {
    resolveEmailContext,
    serverQuotationContext,
    buildQuotationEmailPayload,
    applicationBase,
    withLinks,
    messageWindow,
    SERVER_ONLY_EVENTS,
    PRIVATE_QUOTE_COLUMNS,
    MESSAGE_EMAIL_WINDOW_MS,
    MESSAGE_EMAIL_DELAY_MS
};
