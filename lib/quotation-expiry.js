'use strict';

// ===========================================================================
// Vencimiento de cotizaciones (ronda 3 · P10, chip VENCIDA del listado 801:555
// y la notificación "Cotización vencida" del panel 801:558).
// ---------------------------------------------------------------------------
// Decisión del dueño (13 nov 2026): el vencimiento es OPCIONAL y por
// cotización. El artista lo activa en cada una (quotations_db.
// quote_expiry_enabled) y elige los días (quote_expiry_days, 1–365). Nada vence
// por defecto.
//
// La transición la hace la RPC `expire_stale_quotations(p_limit,
// p_opt_in_only)` (migración 20261113100000, solo service_role), que solo
// toca respuestas con el vencimiento activado. Este módulo:
//   - lee la configuración del job;
//   - corre la RPC y avisa al cliente por email (evento server-only
//     `quotation_expired`, con clave de idempotencia por cotización);
//   - programa el job interno: prendido por defecto (como solo afecta a
//     quien lo activó), cada hora; se apaga con QUOTATION_EXPIRY_JOB=off.
//     También se puede disparar con POST /api/quotations/maintenance/expire.
// Nunca borra datos: solo cambia quote_status a 'expired' (queda historial).
// ===========================================================================

const DEFAULT_VALIDITY_DAYS = 14; // valor sugerido en la UI al activar el vencimiento
const DEFAULT_INTERVAL_MINUTES = 60;
const EXPIRY_MIN_DAYS = 1;
const EXPIRY_MAX_DAYS = 365;
const DAY_MS = 86400000;
const MIGRATION = '20261113100000';

function boundedInt(value, { min, max, fallback }) {
    const n = Number.parseInt(String(value == null ? '' : value).trim(), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** Configuración del job a partir de variables de entorno. */
function expiryConfig(env = process.env) {
    return {
        limit: boundedInt(env.QUOTATION_EXPIRY_BATCH, { min: 1, max: 2000, fallback: 500 }),
        // Prendido por defecto: ya no vence nada que el artista no haya activado.
        jobEnabled: !/^(0|off|false|no)$/i.test(String(env.QUOTATION_EXPIRY_JOB || '').trim()),
        intervalMinutes: boundedInt(env.QUOTATION_EXPIRY_INTERVAL_MIN, { min: 5, max: 1440, fallback: DEFAULT_INTERVAL_MINUTES }),
        emailEnabled: !/^(0|off|false|no)$/i.test(String(env.QUOTATION_EXPIRY_EMAIL || '').trim())
    };
}

/**
 * Cuerpo de la RPC. `p_opt_in_only` hace que la firma no coincida con la vieja
 * (20261112160000, que vencía todo a los 14 días): contra una base sin la
 * migración nueva la llamada falla cerrada (PGRST202) en vez de vencer todo.
 */
function rpcBody(config) {
    return { p_limit: config.limit, p_opt_in_only: true };
}

function toTime(value) {
    if (!value) return null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
}

/** Días válidos (entero 1–365) o null. */
function normalizeExpiryDays(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    return n >= EXPIRY_MIN_DAYS && n <= EXPIRY_MAX_DAYS ? n : null;
}

function expiryEnabled(quote) {
    return !!(quote && quote.quote_expiry_enabled === true && normalizeExpiryDays(quote.quote_expiry_days) != null);
}

/**
 * Fecha de vencimiento de una respuesta ('responded') con el vencimiento
 * activado. Misma regla que la RPC: quote_expires_at (lo calcula el trigger
 * al activarlo) o respuesta + quote_expiry_days. null si no aplica.
 */
function offerExpiresAt(quote) {
    if (!quote || quote.quote_status !== 'responded' || !expiryEnabled(quote)) return null;
    const explicit = toTime(quote.quote_expires_at);
    if (explicit != null) return new Date(explicit);
    const base = toTime(quote.artist_responded_at) ?? toTime(quote.updated_at) ?? toTime(quote.created_at);
    if (base == null) return null;
    return new Date(base + normalizeExpiryDays(quote.quote_expiry_days) * DAY_MS);
}

function isOfferExpired(quote, now = new Date()) {
    const at = offerExpiresAt(quote);
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
 * Corre un ciclo: RPC + avisos. `deps.rpc(body)` devuelve las filas vencidas
 * (solo cotizaciones con el vencimiento activado); `deps.sendEmail(eventId,
 * payload, options)` es emailService.sendEmail.
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

/** Error esperable mientras la migración no esté aplicada (RPC inexistente o firma vieja). */
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
                if (!warnedMissing) log.warn(`[quotations] expire_stale_quotations(p_limit, p_opt_in_only) no existe todavía (aplicar ${MIGRATION}).`);
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
    EXPIRY_MIN_DAYS,
    EXPIRY_MAX_DAYS,
    MIGRATION,
    expiryConfig,
    rpcBody,
    normalizeExpiryDays,
    expiryEnabled,
    offerExpiresAt,
    isOfferExpired,
    expiredNoticePayload,
    runExpiryCycle,
    isMissingRpcError,
    startExpiryJob
};
