'use strict';

// ===========================================================================
// Calendario · aviso de recordatorios por email (ronda 3, grupo "calendario")
// ---------------------------------------------------------------------------
// Los recordatorios del artista viven en artist_reminders (due_at + repetición
// semanal, migración 20261112190000). El aviso in-app lo arma el menú del
// artista en el navegador; este módulo resuelve el EMAIL:
//
//   1. claim_due_artist_reminders() (RPC solo service_role) marca de forma
//      atómica las ocurrencias vencidas que todavía no se avisaron
//      (last_notified_at) y las devuelve con el email del artista.
//   2. Por cada una se envía el evento `artist_calendar_reminder` con
//      services/email-service.js (respeta notification_prefs → "calendario"
//      y deduplica con el ledger por reminder + ocurrencia).
//
// Disparo: POST /api/calendar/reminders/dispatch con X-Cron-Token (cron de
// n8n, como /api/store/maintenance) o, si se configura
// CALENDAR_REMINDERS_INTERVAL_MS (>= 60000), un intervalo en el proceso.
// Sin token ni intervalo no corre nada: no se envían correos en pruebas.
// ===========================================================================

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_LIMIT = 50;
const MIN_INTERVAL_MS = 60 * 1000;
const EVENT_ID = 'artist_calendar_reminder';

function validTimezone(tz) {
    if (!tz || typeof tz !== 'string') return DEFAULT_TIMEZONE;
    try {
        new Intl.DateTimeFormat('es-AR', { timeZone: tz }).format(new Date(0));
        return tz;
    } catch (_) {
        return DEFAULT_TIMEZONE;
    }
}

// "jueves 12 de noviembre, 10:30" en la zona del artista.
function formatOccurrence(value, timezone) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const tz = validTimezone(timezone);
    const day = new Intl.DateTimeFormat('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
    }).format(date);
    const time = new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(date);
    return `${day}, ${time}`;
}

function trimText(value, max) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function calendarUrl(baseUrl, occurrence, reminderId) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const date = new Date(occurrence);
    const params = new URLSearchParams({ view: 'day' });
    if (!Number.isNaN(date.getTime())) params.set('date', date.toISOString().slice(0, 10));
    if (reminderId) params.set('event', `reminder:${reminderId}`);
    return `${base}/calendar?${params.toString()}`;
}

// Fila de claim_due_artist_reminders → payload del evento de email.
function buildReminderEmailPayload(row, options = {}) {
    const r = row || {};
    const name = trimText(r.artist_name, 80) || 'artista';
    return {
        artist_email: r.artist_email ? String(r.artist_email).trim() : null,
        artist_user_id: r.artist_user_id || null,
        artist_name: name,
        recipient_name: name,
        reminder_title: trimText(r.title, 140) || 'Recordatorio',
        reminder_when: formatOccurrence(r.occurrence_at, r.artist_timezone),
        reminder_detail: trimText(r.detail, 600) || '-',
        dashboard_url: calendarUrl(options.baseUrl, r.occurrence_at, r.reminder_id),
    };
}

function reminderIdempotencyKey(row) {
    const at = new Date(row && row.occurrence_at);
    const stamp = Number.isNaN(at.getTime()) ? String(row && row.occurrence_at) : at.toISOString();
    return `${EVENT_ID}:${row && row.reminder_id}:${stamp}`;
}

/**
 * Reclama y envía. Dependencias inyectadas (testeable sin red):
 *   claim(limit) → Promise<rows[]>
 *   send(eventId, payload, { idempotencyKey }) → Promise<{ ok, skipped? }>
 */
async function dispatchDueReminders({ claim, send, limit = DEFAULT_LIMIT, baseUrl = '', log = console } = {}) {
    if (typeof claim !== 'function' || typeof send !== 'function') {
        throw new Error('dispatchDueReminders necesita claim() y send().');
    }
    const rows = (await claim(limit)) || [];
    const summary = { claimed: rows.length, sent: 0, skipped: 0, failed: 0 };
    for (const row of rows) {
        const payload = buildReminderEmailPayload(row, { baseUrl });
        if (!payload.artist_email) {
            summary.skipped += 1;
            continue;
        }
        try {
            const result = await send(EVENT_ID, payload, { idempotencyKey: reminderIdempotencyKey(row) });
            if (result && result.ok && !result.skipped) summary.sent += 1;
            else if (result && result.skipped) summary.skipped += 1;
            else summary.failed += 1;
        } catch (error) {
            summary.failed += 1;
            if (log && typeof log.warn === 'function') {
                log.warn('[calendar-reminders] envío falló:', error && error.message);
            }
        }
    }
    return summary;
}

function intervalFromEnv(env = process.env) {
    const value = Number(env && env.CALENDAR_REMINDERS_INTERVAL_MS);
    return Number.isFinite(value) && value >= MIN_INTERVAL_MS ? Math.floor(value) : 0;
}

// Cablea la RPC real (service-role vía lib/postgrest.js) y el email-service.
function createReminderDispatcher({ pgrest, emailService, baseUrl = '', log = console } = {}) {
    return {
        run(limit = DEFAULT_LIMIT) {
            return dispatchDueReminders({
                limit,
                baseUrl,
                log,
                claim: (max) => pgrest.raw('rpc/claim_due_artist_reminders', {
                    method: 'POST',
                    body: { p_limit: max },
                }),
                send: (eventId, payload, options) => emailService.sendEmail(eventId, payload, options),
            });
        },
    };
}

module.exports = {
    EVENT_ID,
    DEFAULT_TIMEZONE,
    validTimezone,
    formatOccurrence,
    calendarUrl,
    buildReminderEmailPayload,
    reminderIdempotencyKey,
    dispatchDueReminders,
    intervalFromEnv,
    createReminderDispatcher,
};
