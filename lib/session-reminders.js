'use strict';

// ===========================================================================
// Recordatorio de sesión 24 h antes (evento session_reminder_24h)
// ---------------------------------------------------------------------------
// Busca las sesiones agendadas (quotation_sessions.status = 'scheduled') que
// empiezan entre 23 y 25 horas desde ahora y le manda un correo al cliente y
// otro al artista (envío por destinatario del relé). La clave de idempotencia
// incluye la fecha de la sesión: si se reprograma, sale un recordatorio nuevo.
// Lo corren POST /api/sessions/reminders/dispatch (cron, X-Cron-Token) y un
// intervalo interno (SESSION_REMINDERS_JOB=off lo apaga). Ver lib/routes/emails.js.
// ===========================================================================

const EVENT_ID = 'session_reminder_24h';
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const WINDOW_START_MS = 23 * 60 * 60 * 1000;
const WINDOW_END_MS = 25 * 60 * 60 * 1000;

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

/**
 * @param {{ query: Function, sendEmail: Function, baseUrl?: string, now?: number, limit?: number, log?: object }} deps
 */
async function dispatchSessionReminders(deps) {
    const { query, sendEmail, baseUrl, log = console } = deps;
    const now = deps.now || Date.now();
    const limit = Math.min(200, Math.max(1, deps.limit || 100));
    const { from, to } = reminderWindow(now);
    const sessions = await query('quotation_sessions')
        .select('id,quotation_id,session_number,session_date,duration_hours,location,status')
        .eq('status', 'scheduled').gte('session_date', from).lte('session_date', to)
        .order('session_date', { ascending: true }).limit(limit).execute();
    const summary = { found: (sessions || []).length, sent: 0, skipped: 0, failed: 0 };
    for (const session of sessions || []) {
        try {
            const quote = await query('quotations_db')
                .select('quote_id,quote_status,client_email,client_full_name,client_user_id,artist_id,artist_email,artist_name')
                .eq('id', session.quotation_id).limit(1).single().execute();
            if (!quote || ['cancelled', 'rejected', 'expired'].includes(quote.quote_status)) { summary.skipped += 1; continue; }
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
    dispatchSessionReminders,
    intervalFromEnv
};
