'use strict';

// Avisos por email de turnos y job de vencimiento de apartados.
// Eventos (server-only) en services/email-events/turnos.js:
//   booking_slot_requested   → artista (entró una solicitud con turno)
//   booking_slot_confirmed   → cliente (el artista aceptó el turno)
//   booking_slot_hold_expired → cliente (el apartado venció sin respuesta)
// Los destinatarios salen SIEMPRE de la base (artists_db / quotations_db),
// nunca del navegador. Idempotencia por apartado.

const Model = require('../public/shared/js/booking-slots-model.js');

const MIGRATION = '20261115160000_turnos_reservas_online.sql';

function trimBase(baseUrl) {
    return String(baseUrl || '').replace(/\/$/, '');
}

function expiresLabel(iso, tz) {
    if (!iso || !Number.isFinite(Date.parse(iso))) return '';
    return Model.slotLabel(iso, tz);
}

function slotsUrl(baseUrl, username) {
    const u = String(username || '').trim();
    return u ? `${trimBase(baseUrl)}/turnos?artist=${encodeURIComponent(u)}` : '';
}

function requestedPayload({ artist, quote, hold, tz, baseUrl }) {
    return {
        artist_name: (artist && artist.name) || '',
        artist_email: (artist && artist.email) || '',
        client_name: (quote && quote.client_full_name) || '',
        quote_id: (quote && quote.quote_id) || '',
        slot_label: Model.slotLabel(hold.starts_at, tz, hold.ends_at),
        slot_timezone: tz || '',
        hold_expires_label: expiresLabel(hold.expires_at, tz),
        quotation_url: quote && quote.id != null ? `${trimBase(baseUrl)}/my-quotations/detail?id=${encodeURIComponent(quote.id)}` : '',
        // Flash Tattoos: solicitud de un flash publicado en la galería.
        is_flash: !!(quote && quote.flash_title),
        flash_title: (quote && quote.flash_title) || '',
        flash_price: (quote && quote.flash_title && quote.flash_price) || '',
    };
}

function confirmedPayload({ artist, quote, startsAt, endsAt, tz, baseUrl }) {
    return {
        artist_name: (artist && artist.name) || '',
        client_name: (quote && quote.client_full_name) || '',
        client_email: (quote && quote.client_email) || '',
        quote_id: (quote && quote.quote_id) || '',
        slot_label: Model.slotLabel(startsAt, tz, endsAt),
        slot_timezone: tz || '',
        // La cotización del cliente vive en su dashboard (no en /client/requests,
        // que es el Job Board) — EMAIL-NEW-02.
        quotation_url: quote && quote.quote_id
            ? `${trimBase(baseUrl)}/client/dashboard?quote=${encodeURIComponent(quote.quote_id)}`
            : `${trimBase(baseUrl)}/client/dashboard`,
    };
}

function expiredPayload(row, baseUrl) {
    return {
        artist_name: row.artist_name || '',
        client_name: row.client_full_name || '',
        client_email: row.client_email || '',
        quote_id: row.quote_id || '',
        slot_label: Model.slotLabel(row.starts_at, row.timezone, row.ends_at),
        slots_url: slotsUrl(baseUrl, row.artist_username),
    };
}

function isMissingRpcError(error) {
    return /PGRST20[25]|42883|42P01|Could not find the function|does not exist/i.test(String((error && error.message) || error || ''));
}

// Un ciclo: vence apartados y avisa a cada cliente (una vez por apartado).
async function runHoldExpiryCycle(deps) {
    const rows = (await deps.repo.expireHolds(deps.limit || 200)) || [];
    let notified = 0;
    let failed = 0;
    for (const row of rows) {
        if (deps.invalidate && row.artist_user_id) deps.invalidate(row.artist_user_id);
        if (!row.client_email || typeof deps.sendEmail !== 'function') continue;
        try {
            const result = await deps.sendEmail('booking_slot_hold_expired', expiredPayload(row, deps.baseUrl), {
                idempotencyKey: `booking_slot_hold_expired:${row.hold_id}`,
            });
            if (result && result.ok) notified += 1; else failed += 1;
        } catch (_) {
            failed += 1;
        }
    }
    return { expired: rows.length, notified, failed };
}

function holdJobEnabled(env = process.env) {
    return String(env.TURNOS_HOLD_JOB || '').toLowerCase() !== 'off';
}

function startHoldExpiryJob(deps, { intervalMs = 15 * 60 * 1000, firstDelayMs = 90 * 1000 } = {}, timers = { setTimeout, setInterval, clearTimeout, clearInterval }) {
    const log = deps.log || console;
    let running = false;
    let warnedMissing = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const result = await runHoldExpiryCycle(deps);
            if (result.expired) log.log(`[turnos] apartados vencidos: ${result.expired} (avisos: ${result.notified}, fallidos: ${result.failed})`);
        } catch (error) {
            if (isMissingRpcError(error)) {
                if (!warnedMissing) log.warn(`[turnos] expire_artist_slot_holds no existe todavía (aplicar ${MIGRATION}).`);
                warnedMissing = true;
            } else {
                log.error('[turnos] vencimiento de apartados falló:', error && error.message);
            }
        } finally {
            running = false;
        }
    };
    const first = timers.setTimeout(tick, firstDelayMs);
    const every = timers.setInterval(tick, intervalMs);
    if (first && typeof first.unref === 'function') first.unref();
    if (every && typeof every.unref === 'function') every.unref();
    return () => { timers.clearTimeout(first); timers.clearInterval(every); };
}

module.exports = {
    MIGRATION,
    requestedPayload,
    confirmedPayload,
    expiredPayload,
    slotsUrl,
    isMissingRpcError,
    runHoldExpiryCycle,
    holdJobEnabled,
    startHoldExpiryJob,
};
