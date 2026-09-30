'use strict';

const { pgrest } = require('../lib/postgrest');
const { resolveBearerUser, verifyAdminCaller } = require('../lib/auth/supabase-auth');
const { deliveryKey } = require('./email-delivery-ledger');

const ADMIN_EVENTS = new Set(['profile_verified', 'profile_verification_denied', 'ambassador_status_updated', 'platform_update', 'password_reset_temp']);
const ARTIST_EVENTS = new Set(['artist_responded_quotation', 'chat_message_to_client', 'request_rating', 'session_scheduled', 'session_rescheduled', 'session_completed', 'session_cancelled']);
const CLIENT_EVENTS = new Set(['client_approved_quotation', 'client_rejected_quotation', 'client_left_rating', 'chat_message_to_artist']);
const fail = (status, error) => ({ ok: false, status, error });
const same = (left, right) => !!left && !!right && String(left).toLowerCase() === String(right).toLowerCase();

async function read(table, fields) {
    let query = pgrest(table).select('*');
    for (const [column, value] of Object.entries(fields)) query = query.eq(column, value);
    return (await query.limit(1).execute())[0] || null;
}

function applicationBase(req) {
    const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL;
    if (configured) return configured.replace(/\/$/, '');
    const host = String(req.get?.('host') || req.headers?.host || '');
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}${req.weotziBasePath || ''}`;
    return `https://weotzi.com${req.weotziBasePath || '/beta'}`;
}

function withLinks(payload, base, role) {
    const output = { ...payload };
    // Email links always come from trusted application configuration, never caller input.
    for (const key of Object.keys(output)) {
        if (/(?:_url|_link)$/.test(key)) delete output[key];
    }
    return { ...output,
        dashboard_url: `${base}/${role}/dashboard`,
        login_url: `${base}/${role}/login`,
        register_url: `${base}/client/register`,
        profile_url: `${base}/artist/profile?artist=${encodeURIComponent(payload.username || payload.artist_username || '')}`,
        portfolio_url: `${base}/artist/profile?artist=${encodeURIComponent(payload.username || payload.artist_username || '')}`,
        quotation_url: role === 'client' ? `${base}/client/dashboard`
            : `${base}/my-quotations/detail?quote=${encodeURIComponent(payload.quote_id || '')}`
    };
}

/** Resolve trusted recipients and ownership from persisted business records. */
async function resolveEmailContext(req, eventId, input, deps = {}) {
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

    if (eventId === 'artist_registration_completed' || eventId === 'client_registration_completed') {
        if (!user) return fail(401, 'Iniciá sesión para confirmar el correo de bienvenida.');
        const artist = eventId.startsWith('artist_');
        const row = await lookup(artist ? 'artists_db' : 'clients_db', { user_id: user.id });
        if (!row) return fail(403, 'No se encontró tu perfil para enviar el correo.');
        return { ok: true, idempotencyKey: `registration:${user.id}`, payload: withLinks({
            ...row, email: user.email, full_name: row.full_name || row.name,
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
            client_email: client?.email, client_name: client?.full_name,
            artist_email: artist?.email, artist_name: artist?.name,
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
    let entity = quote.quote_id;
    let persisted = {};
    if (eventId.startsWith('chat_message_')) {
        const message = payload.message_id ? await lookup('chat_messages', { id: payload.message_id, quotation_id: quote.quote_id, sender_id: user.id })
            : deps.latestMessage ? await deps.latestMessage(quote.quote_id, user.id)
            : (await pgrest('chat_messages').select('*').eq('quotation_id', quote.quote_id).eq('sender_id', user.id).order('created_at', { ascending: false }).limit(1).execute())[0];
        if (!message) return fail(409, 'Guardá el mensaje antes de enviar la notificación.');
        entity += `:message:${message.id}`;
        persisted.message_preview = String(message.message || '').slice(0, 100);
    } else if (eventId.startsWith('session_')) {
        if (!payload.session_id) return fail(400, 'Falta la sesión asociada al correo.');
        const session = await lookup('quotation_sessions', { id: payload.session_id, quotation_id: quote.id });
        if (!session) return fail(409, 'Guardá la sesión antes de enviar la notificación.');
        const expectedStatus = eventId.slice('session_'.length);
        if (session.status !== expectedStatus) return fail(409, 'El estado de la sesión cambió. No se envió una notificación anterior.');
        entity += `:session:${session.id}:${session.updated_at || session.session_date}`;
        persisted = { ...session, duration_hours: session.duration_hours };
    } else if (eventId !== 'client_quotation_submitted') entity += `:${quote.quote_status}:${quote.artist_responded_at || ''}:${quote.rating || ''}`;
    return { ok: true, idempotencyKey: entity, payload: withLinks({
        ...quote, ...persisted, quote_id: quote.quote_id,
        client_name: quote.client_full_name, artist_name: artist?.name || quote.artist_name,
        artist_email: artist?.email || quote.artist_email,
        recipient_name: quote.client_full_name, recipient_email: quote.client_email,
        estimated_sessions: quote.tattoo_estimated_sessions,
        tattoo_description: quote.tattoo_idea_description, tattoo_location: quote.tattoo_body_part,
        client_budget: `${quote.client_budget_amount || ''} ${quote.client_budget_currency || ''}`.trim(),
        artist_budget: `${quote.artist_budget_amount || ''} ${quote.artist_budget_currency || ''}`.trim()
    }, base, CLIENT_EVENTS.has(eventId) ? 'artist' : 'client') };
}

module.exports = { resolveEmailContext, applicationBase, withLinks };
