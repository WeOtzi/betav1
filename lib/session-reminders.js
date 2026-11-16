'use strict';

// ===========================================================================
// Recordatorio de sesión 24 h antes (evento session_reminder_24h)
// ---------------------------------------------------------------------------
// Busca las sesiones agendadas (quotation_sessions.status 'scheduled' o
// 'rescheduled') que empiezan entre 23 y 25 horas desde ahora y le manda un
// correo al cliente y otro al artista (envío por destinatario del relé). La
// clave de idempotencia incluye la fecha de la sesión: si se reprograma, sale
// un recordatorio nuevo.
// Ronda 2 (P28): una sesión que el cliente todavía no confirmó, o para la que
// pidió otra fecha (client_confirmation 'pending' / 'change_requested'), no
// está acordada y no se recuerda como agendada.
// Lo corren POST /api/sessions/reminders/dispatch (cron, X-Cron-Token) y un
// intervalo interno (SESSION_REMINDERS_JOB=off lo apaga). Ver lib/routes/emails.js.
// ===========================================================================

const EVENT_ID = 'session_reminder_24h';
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const WINDOW_START_MS = 23 * 60 * 60 * 1000;
const WINDOW_END_MS = 25 * 60 * 60 * 1000;
const SESSION_COLUMNS = 'id,quotation_id,session_number,session_date,duration_hours,location,status';
// Una sesión reprogramada (por el calendario o por un cambio aceptado) sigue agendada.
const REMINDABLE_STATUS = ['scheduled', 'rescheduled'];

function reminderWindow(now = Date.now()) {
    return {
        from: new Date(now + WINDOW_START_MS).toISOString(),
        to: new Date(now + WINDOW_END_MS).toISOString()
    };
}

function reminderKey(session) {
    return `reminder24:${session.id}:${session.session_date}`;
}

function buildReminderPayload(session, quote, artist, baseUrl) {
    return {
        app_base_url: baseUrl || undefined,
        quote_id: quote.quote_id,
        session_id: session.id,
        session_number: session.session_number,
        session_date: session.session_date,
        duration_hours: session.duration_hours,
        location: session.location || '',
        client_email: quote.client_email,
        client_name: quote.client_full_name || '',
        client_user_id: quote.client_user_id || null,
        artist_email: (artist && artist.email) || quote.artist_email,
        artist_name: (artist && artist.name) || quote.artist_name || '',
        artist_user_id: quote.artist_id || null
    };
}

// client_confirmation llega con la migración 20261116150000. Si la base
// todavía no tiene la columna, el job sigue con las columnas de siempre.
function isMissingConfirmationColumn(error) {
    const text = [error && error.code, error && error.message, error && error.details].filter(Boolean).join(' ');
    return /42703|PGRST204|client_confirmation/i.test(text);
}

async function listDueSessions(query, { from, to, limit }) {
    const read = (columns) => query('quotation_sessions').select(columns)
        .in('status', REMINDABLE_STATUS).gte('session_date', from).lte('session_date', to)
        .order('session_date', { ascending: true }).limit(limit).execute();
    try {
        return await read(`${SESSION_COLUMNS},client_confirmation`);
    } catch (error) {
        if (!isMissingConfirmationColumn(error)) throw error;
        return read(SESSION_COLUMNS);
    }
}

// Sin el dato (base anterior a la migración) la sesión cuenta como acordada.
function awaitsClientConfirmation(session) {
    const value = String((session && session.client_confirmation) || '');
    return value !== '' && value !== 'confirmed';
}

/**
 * @param {{ query: Function, sendEmail: Function, baseUrl?: string, now?: number, limit?: number, log?: object }} deps
 */
async function dispatchSessionReminders(deps) {
    const { query, sendEmail, baseUrl, log = console } = deps;
    const now = deps.now || Date.now();
    const limit = Math.min(200, Math.max(1, deps.limit || 100));
    const sessions = await listDueSessions(query, Object.assign(reminderWindow(now), { limit }));
    const summary = { found: (sessions || []).length, sent: 0, skipped: 0, failed: 0 };
    for (const session of sessions || []) {
        try {
            // Sin acordar con el cliente no hay nada que recordar todavía.
            if (awaitsClientConfirmation(session)) { summary.skipped += 1; continue; }
            const quote = await query('quotations_db')
                .select('quote_id,quote_status,client_email,client_full_name,client_user_id,artist_id,artist_email,artist_name')
                .eq('id', session.quotation_id).limit(1).single().execute();
            // Sin recordatorio si la cotización quedó cerrada o rechazada por alguna de las partes.
            if (!quote || ['cancelled', 'rejected', 'expired', 'client_rejected', 'artist_rejected'].includes(quote.quote_status)) { summary.skipped += 1; continue; }
            const artist = quote.artist_id
                ? await query('artists_db').select('user_id,name,email').eq('user_id', quote.artist_id).limit(1).single().execute()
                : null;
            const result = await sendEmail(EVENT_ID, buildReminderPayload(session, quote, artist, baseUrl), { idempotencyKey: reminderKey(session) });
            if (result && result.ok && !result.skipped) summary.sent += 1;
            else if (result && (result.skipped || result.deduplicated)) summary.skipped += 1;
            else summary.failed += 1;
        } catch (error) {
            summary.failed += 1;
            if (log && typeof log.warn === 'function') log.warn('[session-reminders] envío falló:', error && error.message);
        }
    }
    return summary;
}

function intervalFromEnv(env = process.env) {
    if (String(env.SESSION_REMINDERS_JOB || '').toLowerCase() === 'off') return 0;
    const value = Number(env.SESSION_REMINDERS_INTERVAL_MS);
    if (Number.isFinite(value) && value >= MIN_INTERVAL_MS) return Math.floor(value);
    return DEFAULT_INTERVAL_MS;
}

module.exports = {
    EVENT_ID,
    DEFAULT_INTERVAL_MS,
    reminderWindow,
    reminderKey,
    buildReminderPayload,
    awaitsClientConfirmation,
    dispatchSessionReminders,
    intervalFromEnv
};
