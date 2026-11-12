'use strict';

// ===========================================================================
// Vencimiento de cotizaciones (ronda 3 · P10, Figma 801:556 "Vigencia de la
// cotización 14 días", chip VENCIDA del listado 801:555 y la notificación
// "Cotización vencida" del panel 801:558).
// ---------------------------------------------------------------------------
// La transición la hace la RPC `expire_stale_quotations` (migración
// 20261112160000, solo service_role). Este módulo:
//   - lee la configuración (vigencia por defecto, vencer pendientes o no);
//   - corre la RPC y avisa al cliente por email (evento server-only
//     `quotation_expired`, con clave de idempotencia por cotización);
//   - programa el job interno (opt-in con QUOTATION_EXPIRY_JOB=on) — también
//     se puede disparar desde n8n con POST /api/quotations/maintenance/expire.
// Nunca borra datos: solo cambia quote_status a 'expired' (queda historial).
// ===========================================================================

const DEFAULT_VALIDITY_DAYS = 14;
const DEFAULT_INTERVAL_MINUTES = 60;
const DAY_MS = 86400000;

function boundedInt(value, { min, max, fallback }) {
    const n = Number.parseInt(String(value == null ? '' : value).trim(), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** Configuración del vencimiento a partir de variables de entorno. */
function expiryConfig(env = process.env) {
    const pendingRaw = String(env.QUOTATION_PENDING_EXPIRY_DAYS || '').trim();
    return {
        defaultDays: boundedInt(env.QUOTATION_VALIDITY_DAYS, { min: 1, max: 365, fallback: DEFAULT_VALIDITY_DAYS }),
        // Vencer solicitudes sin respuesta es decisión de producto: apagado salvo que se configure.
        pendingDays: pendingRaw ? boundedInt(pendingRaw, { min: 1, max: 365, fallback: null }) : null,
        limit: boundedInt(env.QUOTATION_EXPIRY_BATCH, { min: 1, max: 2000, fallback: 500 }),
        jobEnabled: /^(1|on|true|yes)$/i.test(String(env.QUOTATION_EXPIRY_JOB || '').trim()),
        intervalMinutes: boundedInt(env.QUOTATION_EXPIRY_INTERVAL_MIN, { min: 5, max: 1440, fallback: DEFAULT_INTERVAL_MINUTES }),
        emailEnabled: !/^(0|off|false|no)$/i.test(String(env.QUOTATION_EXPIRY_EMAIL || '').trim())
    };
}

function rpcBody(config) {
    return { p_default_days: config.defaultDays, p_pending_days: config.pendingDays, p_limit: config.limit };
}

function toTime(value) {
    if (!value) return null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
}

/**
 * Fecha de vencimiento de una respuesta ('responded'). Misma regla que la RPC:
 * quote_expires_at, o respuesta + validity_days de la cotización manual, o
 * respuesta + vigencia por defecto. null si no aplica.
 */
function offerExpiresAt(quote, { defaultDays = DEFAULT_VALIDITY_DAYS, validityDays = null } = {}) {
    if (!quote || quote.quote_status !== 'responded') return null;
    const explicit = toTime(quote.quote_expires_at);
    if (explicit != null) return new Date(explicit);
    const base = toTime(quote.artist_responded_at) ?? toTime(quote.updated_at) ?? toTime(quote.created_at);
    if (base == null) return null;
    const days = Number(validityDays) > 0 ? Number(validityDays) : defaultDays;
    return new Date(base + days * DAY_MS);
}

function isOfferExpired(quote, now = new Date(), opts = {}) {
    const at = offerExpiresAt(quote, opts);
    return !!at && at.getTime() <= new Date(now).getTime();
}

/** Payload del aviso al cliente (evento server-only `quotation_expired`). */
function expiredNoticePayload(row, { baseUrl = '' } = {}) {
    return {
        quote_id: row.quote_id,
        client_email: row.client_email,
        client_name: row.client_full_name || '',
        artist_name: row.artist_name || 'El artista',
        old_status: row.old_status,
        expired_at: row.expired_at,
        dashboard_url: `${String(baseUrl).replace(/\/$/, '')}/client/dashboard`
    };
}

/**
 * Corre un ciclo: RPC + avisos. `deps.rpc(body)` devuelve las filas vencidas;
 * `deps.sendEmail(eventId, payload, options)` es emailService.sendEmail.
 */
async function runExpiryCycle(deps, config = expiryConfig()) {
    const rows = (await deps.rpc(rpcBody(config))) || [];
    const list = Array.isArray(rows) ? rows : [];
    let notified = 0;
    let failed = 0;
    if (config.emailEnabled && typeof deps.sendEmail === 'function') {
        for (const row of list) {
            // Solo las respuestas vencidas tienen un cliente esperando una propuesta.
            if (!row || !row.client_email || row.old_status !== 'responded') continue;
            try {
                const result = await deps.sendEmail('quotation_expired', expiredNoticePayload(row, { baseUrl: deps.baseUrl }), {
                    idempotencyKey: `quotation_expired:${row.quote_id || row.id}`
                });
                if (result && result.ok) notified += 1; else failed += 1;
            } catch (_) {
                failed += 1;
            }
        }
    }
    return { expired: list.length, notified, failed, ids: list.map((r) => r.quote_id || r.id) };
}

/** Error esperable mientras la migración no esté aplicada (RPC inexistente). */
function isMissingRpcError(error) {
    return /PGRST202|42883|Could not find the function|does not exist/i.test(String((error && error.message) || error || ''));
}

/**
 * Programa el job interno. Devuelve stop(). No hace nada si está apagado.
 * Si la RPC no existe (migración sin aplicar) lo avisa una vez y sigue
 * intentando en el próximo ciclo sin ensuciar el log.
 */
function startExpiryJob(deps, config = expiryConfig(), timers = { setTimeout, setInterval, clearTimeout, clearInterval }) {
    if (!config.jobEnabled) return () => {};
    const log = deps.log || console;
    let warnedMissing = false;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const result = await runExpiryCycle(deps, config);
            if (result.expired) log.log(`[quotations] vencidas: ${result.expired} (avisos: ${result.notified}, fallidos: ${result.failed})`);
        } catch (error) {
            if (isMissingRpcError(error)) {
                if (!warnedMissing) log.warn('[quotations] expire_stale_quotations no existe todavía (aplicar 20261112160000).');
                warnedMissing = true;
            } else {
                log.error('[quotations] vencimiento falló:', error && error.message);
            }
        } finally {
            running = false;
        }
    };
    const first = timers.setTimeout(tick, 2 * 60 * 1000);
    const every = timers.setInterval(tick, config.intervalMinutes * 60 * 1000);
    if (first && typeof first.unref === 'function') first.unref();
    if (every && typeof every.unref === 'function') every.unref();
    return () => { timers.clearTimeout(first); timers.clearInterval(every); };
}

module.exports = {
    DEFAULT_VALIDITY_DAYS,
    expiryConfig,
    rpcBody,
    offerExpiresAt,
    isOfferExpired,
    expiredNoticePayload,
    runExpiryCycle,
    isMissingRpcError,
    startExpiryJob
};
