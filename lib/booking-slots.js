'use strict';

// Servicio de turnos disponibles (servidor). Arma el contexto del artista
// (reglas, horario semanal, ubicaciones, zona horaria y ocupados) y delega el
// cálculo en el modelo puro public/shared/js/booking-slots-model.js (el mismo
// que usa el navegador para etiquetas). Caché en memoria de 60 s por artista y
// rango; se invalida al reservar o al cambiar la configuración.
//
// El servidor es la única autoridad para OFRECER turnos; la base es la única
// para RESERVARLOS (save_web_quotation_with_slot / confirm_artist_slot_hold,
// con advisory lock por artista).

const Model = require('../public/shared/js/booking-slots-model.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_MAX_DAYS = 93;
const SUMMARY_DAYS = 366;

function createBookingService({ repo, now = () => Date.now(), cacheMs = 60 * 1000 } = {}) {
    if (!repo) throw new Error('booking service: falta repo');
    const cache = new Map();

    function cached(key, loader) {
        const hit = cache.get(key);
        if (hit && hit.exp > now()) return hit.value;
        const value = loader().catch((err) => { cache.delete(key); throw err; });
        cache.set(key, { exp: now() + cacheMs, value });
        if (cache.size > 2000) {
            for (const [k, v] of cache) { if (v.exp <= now()) cache.delete(k); }
        }
        return value;
    }

    function invalidate(artistId) {
        for (const key of cache.keys()) { if (key.startsWith(`${artistId}:`)) cache.delete(key); }
    }

    async function context(artistId) {
        const [settingsRow, prefs, locations] = await Promise.all([
            repo.getSettings(artistId).catch(() => null),
            repo.getPrefs(artistId).catch(() => ({ availability: null, timezone: null })),
            repo.listLocations(artistId).catch(() => []),
        ]);
        const settings = Model.normalizeSettings(settingsRow || {});
        const tz = Model.validTimeZone(prefs && prefs.timezone) ? prefs.timezone : Model.DEFAULT_TZ;
        return {
            settings,
            configured: !!settingsRow,
            tz,
            availability: (prefs && prefs.availability) || null,
            locations: locations || [],
        };
    }

    async function compute(artistId, fromMs, toMs, { ignoreEnabled = false } = {}) {
        const ctx = await context(artistId);
        // Un día de margen a cada lado: los intervalos ocupados con su margen
        // pueden empezar antes del rango pedido.
        const busy = await repo.listBlocking(artistId,
            new Date(fromMs - DAY_MS).toISOString(), new Date(toMs + DAY_MS).toISOString());
        const result = Model.computeDays({
            tz: ctx.tz, from: fromMs, to: toMs, now: now(), settings: ctx.settings,
            availability: ctx.availability, locations: ctx.locations,
            busy: busy.map((b) => ({ start: b.starts_at, end: b.ends_at, kind: b.kind })),
            ignoreEnabled,
        });
        return { ctx, result };
    }

    function clampRange(from, to, maxDays) {
        const t = now();
        let fromMs = Number.isFinite(Date.parse(from)) ? Date.parse(from) : t;
        fromMs = Math.max(fromMs, t);
        let toMs = Number.isFinite(Date.parse(to)) ? Date.parse(to) : fromMs + 31 * DAY_MS;
        toMs = Math.min(toMs, fromMs + maxDays * DAY_MS);
        return { fromMs, toMs: Math.max(toMs, fromMs) };
    }

    // Turnos de un artista en un rango (máx. 93 días).
    function getSlots(artistId, { from, to, ignoreEnabled = false } = {}) {
        const { fromMs, toMs } = clampRange(from, to, PUBLIC_MAX_DAYS);
        const key = `${artistId}:slots:${Math.floor(fromMs / 60000)}:${Math.floor(toMs / 60000)}:${ignoreEnabled ? 1 : 0}`;
        return cached(key, () => compute(artistId, fromMs, toMs, { ignoreEnabled }));
    }

    // Resumen para el artista: semana, mes, 3 meses y año (capacidad real).
    function getSummary(artistId) {
        const t = now();
        const key = `${artistId}:summary:${Math.floor(t / 60000)}`;
        return cached(key, async () => {
            const { ctx, result } = await compute(artistId, t, t + SUMMARY_DAYS * DAY_MS, { ignoreEnabled: true });
            const summary = result.reason === 'no_schedule'
                ? null
                : Model.summarize({ days: result.days, now: t, tz: ctx.tz, settings: ctx.settings });
            return { ctx, result, summary };
        });
    }

    // ¿El turno pedido sigue ofrecido? (antes de crear el apartado)
    async function validateRequestedSlot(artistId, slot) {
        const start = Date.parse(slot && slot.start);
        const minutes = Number(slot && slot.minutes);
        if (!Number.isFinite(start) || !Number.isInteger(minutes)) return { ok: false, code: 'invalid_slot' };
        const ctx = await context(artistId);
        if (!ctx.settings.enabled) return { ok: false, code: 'booking_disabled', ctx };
        // Sin caché: el turno tiene que estar libre ahora.
        const { result } = await compute(artistId, start - DAY_MS, start + DAY_MS);
        if (!Model.isOffered(result.days, new Date(start).toISOString(), minutes, ctx.settings)) {
            return { ok: false, code: 'slot_taken', ctx };
        }
        return { ok: true, ctx, start: new Date(start).toISOString(), minutes };
    }

    return { context, getSlots, getSummary, validateRequestedSlot, invalidate, _cache: cache };
}

// Alternativas cercanas para el modal "ese turno ya no está disponible":
// los turnos libres del mismo día y, si no hay, los siguientes.
function alternativesFrom(days, requestedStartIso, limit = 6) {
    const requested = Date.parse(requestedStartIso);
    const all = [];
    (days || []).forEach((d) => (d.slots || []).forEach((s) => all.push(s)));
    return all
        .filter((s) => Date.parse(s.start) !== requested)
        .sort((a, b) => Math.abs(Date.parse(a.start) - requested) - Math.abs(Date.parse(b.start) - requested))
        .slice(0, limit)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// Fuente para Google Calendar (frente gcal): un apartado pendiente se publica
// como evento 'tentative'. Sin datos sensibles del cliente más allá del nombre.
function normalizeHoldSource(hold, quote, baseUrl) {
    if (!hold || !hold.id || hold.status !== 'pending') return null;
    if (hold.expires_at && Date.parse(hold.expires_at) <= Date.now()) return null;
    const start = Date.parse(hold.starts_at);
    const end = Date.parse(hold.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const client = quote && quote.client_full_name ? String(quote.client_full_name).trim() : 'cliente';
    const lines = ['Solicitud de turno pendiente de respuesta.'];
    if (quote && quote.quote_id) lines.push(`Cotización ${quote.quote_id}`);
    if (baseUrl && hold.quotation_id != null) lines.push(`${baseUrl}/my-quotations/detail?id=${encodeURIComponent(hold.quotation_id)}`);
    return {
        key: `hold:${hold.id}`,
        kind: 'hold',
        id: hold.id,
        title: `Solicitud de turno · ${client}`.slice(0, 180),
        description: lines.join('\n'),
        location: '',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        allDay: false,
        weekly: false,
        recurrenceUntil: null,
        tentative: true,
    };
}

// Instancia compartida del proceso (rutas de turnos + intake de cotizaciones),
// así la caché se invalida en un solo lugar.
let shared = null;
function defaultService() {
    if (!shared) shared = createBookingService({ repo: require('./repos/booking').BookingRepo });
    return shared;
}

module.exports = { createBookingService, defaultService, alternativesFrom, normalizeHoldSource, PUBLIC_MAX_DAYS, SUMMARY_DAYS };
