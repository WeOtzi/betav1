'use strict';

// ===========================================================================
// Google Calendar · servicio de conexión y sincronización (grupo "gcal").
// ---------------------------------------------------------------------------
// createGcalService({ cfg, google, db, now, log, baseUrl, sources }):
//   authorize(userId)                 → URL de consentimiento + nonce de la cookie
//   callback(query, cookieNonce)      → guarda el refresh token cifrado
//   disconnect(userId, {removeEvents})→ (opcional) quita de Google los eventos
//                                       que todavía no pasaron, revoca y borra
//   status(userId)                    → estado visible para el artista
//   syncUser(userId) / runAll()       → push (solo de ida: We Ötzi → Google)
//   requestSync(userId)               → pedido de la UI (freno + corrida diferida)
//   syncSoon(userId)                  → pedido del servidor (debounce corto)
//   runDirty()                        → artistas marcados "sucios" por la base
//
// SOLO DE IDA (20261114100000): nunca se lee el calendario de Google del
// artista. Solo se crean, actualizan y borran los eventos que publicamos.
//
// Fuentes (todo lo que se crea en We Ötzi y ocupa o marca la agenda):
//   event:<uuid>     artist_calendar_events de los tipos que ocupan horario
//                    (turno, reserva, día bloqueado, guest spot, convención,
//                    personal), con repetición semanal.
//   session:<uuid>   quotation_sessions (sesiones de cotización); no se publican
//                    las canceladas / no_show ni las de cotizaciones cerradas.
//   trip:<uuid>      artist_trips (viajes de Travel), días completos.
//   reminder:<uuid>  artist_reminders (recordatorios, con aviso emergente).
//   booking:<uuid>   studio_bookings (citas que un estudio le agenda).
//   hold:<uuid>      artist_booking_holds (solicitudes con turno apartado, las
//                    crea el frente "turnos"); provisorias (tentative).
//   vacation:<uuid>  artists_db.vacation_start/_end (vacaciones), días completos.
//   Los días de "disponibilidad" no se publican: son el horario de atención,
//   no eventos (en Google taparían la agenda entera).
//
// CÓMO SE SUMA UNA FUENTE: agregar un objeto a DEFAULT_SOURCES (o pasarlo en
// `sources` al crear el servicio) con
//   { kind, idOf(row), list(db, userId, ctx), fetchByIds(db, userId, ids),
//     normalize(row, ctx), writeBack? }
// · kind: prefijo del source_key (sumarlo también al CHECK de
//   artist_google_calendar_event_links_source_key_check por migración).
// · list: filas vigentes (ctx.since = hace PAST_DAYS días; ctx.now, ctx.tz).
// · fetchByIds: filas por id, para decidir si un vínculo que ya no aparece en
//   `list` se borró/canceló (se quita de Google) o solo quedó fuera de la
//   ventana (se deja en Google como historial). Sin fetchByIds no se borra.
// · normalize: fila → { key, kind, id, title, description, location, startsAt,
//   endsAt, allDay, weekly, recurrenceUntil, status?, transparency?, reminders? }
//   o null si no se publica (cancelada, vencida…).
// · El repo (lib/repos/google-calendar.js) implementa las consultas, y la tabla
//   nueva necesita el trigger de "sucio" para que el cambio llegue en segundos:
//   select private.gcal_attach_dirty_trigger('public.<tabla>', '<col artista>');
//
// Rapidez: la UI llama a /api/google-calendar/sync al escribir (syncSoon del
// front); la base marca artist_google_calendar_connections.dirty_at con
// triggers en todas las tablas fuente (RPC, estudio, backoffice, triggers) y
// el poller (cada GCAL_DIRTY_POLL_MS, 30 s) sincroniza solo a esos artistas.
// El job completo de 15 min queda de respaldo.
//
// Historial: lo que sale de la ventana de PAST_DAYS NO se borra de Google
// (source_ends_at en el vínculo). Solo se borra lo que se borró o canceló.
// Reconexión: ids de evento determinísticos por (artista, fuente) y vínculos
// que sobreviven a la desconexión → reconectar no duplica.
//
// `db` y `google` se inyectan: server.js usa lib/repos/google-calendar.js y
// lib/gcal-oauth.createGoogleClient; los tests usan dobles en memoria.
// ===========================================================================

const crypto = require('crypto');
const oauth = require('./gcal-oauth');

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';
const DAY_MS = 24 * 60 * 60 * 1000;
const PUSH_TYPES = ['confirmed_session', 'reservation', 'blocked_day', 'guest_spot', 'convention', 'personal'];
const TYPE_LABELS = {
    confirmed_session: 'Turno confirmado',
    reservation: 'Reserva',
    blocked_day: 'Día bloqueado',
    guest_spot: 'Guest spot',
    convention: 'Convención',
    personal: 'Evento personal',
};
// COT-A-15: no_show tampoco se publica (no ocupa la agenda).
const CANCELLED_SESSION = new Set(['cancelled', 'canceled', 'cancelada', 'no_show']);
// CAL-12: sesiones de cotizaciones cerradas no se publican.
const CLOSED_QUOTE = new Set(['cancelled', 'expired', 'client_rejected']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRIP_STATUS_LABELS = {
    planificado: 'Planificado',
    pendiente: 'Pendiente de confirmar',
    confirmado: 'Confirmado',
    finalizado: 'Finalizado',
};
const PAST_DAYS = 30;          // ventana de lectura: lo que terminó hace menos de 30 días
const MAX_WRITES_PER_RUN = 150;
const MANUAL_SYNC_MIN_MS = 20 * 1000;
const SOON_DELAY_MS = 2 * 1000;
const DIRTY_RETRY_MS = 5 * 60 * 1000;
const REMINDER_MINUTES = 30;   // igual que el calendario (calendar-repo.js)
const MAX_REMOVE_ON_DISCONNECT = 400;
const LINK_KINDS = ['event', 'session', 'trip', 'reminder', 'booking', 'hold', 'vacation'];

/* ------------------------------ zona horaria ------------------------------ */

function validTimeZone(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; }
}

function zonedParts(ms, tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

function pad(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM-DD' del instante en la zona dada.
function zonedDate(value, tz) {
    const p = zonedParts(new Date(value).getTime(), tz);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function tzOffsetMs(ms, tz) {
    const whole = ms - (((ms % 1000) + 1000) % 1000);
    const p = zonedParts(whole, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - whole;
}

// Medianoche local de 'YYYY-MM-DD' en tz → ISO UTC.
function zonedMidnightUtc(dateStr, tz) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d);
    const off = tzOffsetMs(guess, tz);
    let t = guess - off;
    const off2 = tzOffsetMs(t, tz);
    if (off2 !== off) t = guess - off2;
    return new Date(t).toISOString();
}

function addDays(dateStr, n) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function basicUtc(iso) {
    return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function zoneOr(tz) {
    return validTimeZone(tz) ? tz : DEFAULT_TZ;
}

/* ------------------------------- fuentes --------------------------------- */

function cleanText(value, max) {
    const text = String(value == null ? '' : value).trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function dateOnly(value) {
    const text = String(value == null ? '' : value).slice(0, 10);
    return DATE_RE.test(text) ? text : null;
}

function baseSource(kind, id, fields) {
    return Object.assign({
        key: `${kind}:${id}`,
        kind,
        id,
        title: '',
        description: '',
        location: '',
        startsAt: null,
        endsAt: null,
        allDay: false,
        weekly: false,
        recurrenceUntil: null,
    }, fields);
}

function normalizeManual(row) {
    if (!row || !row.id || !PUSH_TYPES.includes(row.event_type) || row.status === 'cancelled') return null;
    const start = Date.parse(row.starts_at);
    const end = Date.parse(row.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const label = TYPE_LABELS[row.event_type];
    const details = [label, row.client_name ? `Cliente: ${row.client_name}` : '', row.notes || ''].filter(Boolean);
    return baseSource('event', row.id, {
        title: cleanText(row.title || label, 180),
        description: cleanText(details.join('\n'), 2000),
        location: row.location ? cleanText(row.location, 300) : '',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        allDay: !!row.all_day,
        weekly: row.recurrence_rule === 'weekly',
        recurrenceUntil: row.recurrence_rule === 'weekly' && row.recurrence_until ? String(row.recurrence_until).slice(0, 10) : null,
    });
}

function normalizeSession(session, quote, baseUrl) {
    if (!session || session.id == null) return null;
    if (CANCELLED_SESSION.has(String(session.status || '').toLowerCase())) return null;
    if (quote && CLOSED_QUOTE.has(String(quote.quote_status || '').toLowerCase())) return null;
    const start = Date.parse(session.session_date);
    if (!Number.isFinite(start)) return null;
    const hours = Number(session.duration_hours) > 0 ? Number(session.duration_hours) : 1;
    const client = quote?.client_full_name ? String(quote.client_full_name).trim() : 'Cliente';
    const lines = [];
    if (quote?.quote_id) lines.push(`Cotización ${quote.quote_id}`);
    if (baseUrl && session.quotation_id != null) lines.push(`${baseUrl}/my-quotations/detail?id=${encodeURIComponent(session.quotation_id)}`);
    if (session.notes) lines.push(String(session.notes));
    // ── sesiones (ronda 2 · P28) ── mientras el cliente no la confirma va como
    // tentativa en el título. `location` ya trae la dirección completa
    // ("Estudio X - Av. Corrientes 2151, Buenos Aires, Argentina").
    const tentative = ['pending', 'change_requested'].includes(String(session.client_confirmation || ''));
    if (tentative) lines.unshift('Pendiente de confirmación del cliente.');
    return baseSource('session', session.id, {
        title: cleanText(tentative ? `Sesión (por confirmar) — ${client}` : `Sesión — ${client}`, 180),
        description: cleanText(lines.join('\n'), 2000),
        location: session.location ? cleanText(session.location, 300) : '',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + hours * 3600 * 1000).toISOString(),
    });
}

// Viaje de Travel (guest spot, convención, estudio invitado): todo el día,
// del primer al último día inclusive. Los cancelados no se publican.
function normalizeTrip(trip, tz, baseUrl) {
    if (!trip || !trip.id || trip.status === 'cancelado' || trip.cancelled_at) return null;
    const startDate = dateOnly(trip.start_date);
    const endDate = dateOnly(trip.end_date);
    if (!startDate || !endDate || endDate < startDate) return null;
    const zone = zoneOr(tz);
    const convention = trip.trip_type === 'convencion';
    const city = trip.city ? String(trip.city).trim() : '';
    const place = trip.studio_name_hint || trip.event_name || city;
    const title = convention
        ? (trip.event_name || (city ? `Convención · ${city}` : 'Convención'))
        : (place ? `Guest spot en ${place}` : 'Guest spot');
    const lines = [convention ? 'Convención' : 'Guest spot'];
    if (TRIP_STATUS_LABELS[trip.status]) lines.push(`Estado: ${TRIP_STATUS_LABELS[trip.status]}`);
    if (baseUrl) lines.push(`${baseUrl}/artist/travel?trip=${encodeURIComponent(trip.id)}`);
    return baseSource('trip', trip.id, {
        title: cleanText(title, 180),
        description: cleanText(lines.join('\n'), 2000),
        location: cleanText([city, trip.country].filter(Boolean).join(', '), 300),
        startsAt: zonedMidnightUtc(startDate, zone),
        endsAt: zonedMidnightUtc(addDays(endDate, 1), zone),
        allDay: true,
    });
}

// Recordatorio (artist_reminders): con hora → evento de 30 min con aviso
// emergente a la hora; solo con fecha → todo el día. Repetición semanal.
// Los completados no se publican. No ocupan horario (transparent).
function normalizeReminder(row, tz, baseUrl) {
    if (!row || !row.id || row.completed_at) return null;
    const zone = zoneOr(tz);
    const weekly = row.recurrence_rule === 'weekly';
    const until = weekly ? dateOnly(row.recurrence_until) : null;
    const dueAt = Date.parse(row.due_at);
    const dueDate = dateOnly(row.due_date);
    let startsAt;
    let endsAt;
    let allDay = false;
    if (Number.isFinite(dueAt)) {
        startsAt = new Date(dueAt).toISOString();
        endsAt = new Date(dueAt + REMINDER_MINUTES * 60 * 1000).toISOString();
    } else if (dueDate) {
        startsAt = zonedMidnightUtc(dueDate, zone);
        endsAt = zonedMidnightUtc(addDays(dueDate, 1), zone);
        allDay = true;
    } else {
        return null;
    }
    const lines = ['Recordatorio'];
    if (row.detail) lines.push(String(row.detail));
    if (baseUrl) lines.push(`${baseUrl}/calendar`);
    return baseSource('reminder', row.id, {
        title: cleanText(row.title || 'Recordatorio', 180),
        description: cleanText(lines.join('\n'), 2000),
        startsAt,
        endsAt,
        allDay,
        weekly,
        recurrenceUntil: until,
        transparency: 'transparent',
        reminders: allDay ? null : { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    });
}

// Cita que un estudio le agendó al artista (studio_bookings). Sin email ni
// teléfono del cliente: solo el nombre (como las sesiones).
function normalizeBooking(row, baseUrl) {
    if (!row || !row.id) return null;
    if (row.status !== 'confirmed' && row.status !== 'completed') return null;
    const start = Date.parse(row.starts_at);
    const end = Date.parse(row.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const studio = row.studios?.name || row.studio_name || 'un estudio';
    const client = row.client_name ? String(row.client_name).trim() : '';
    const loc = row.studio_locations || {};
    const address = loc.formatted_address
        || [[loc.street, loc.street_number].filter(Boolean).join(' '), loc.city].filter(Boolean).join(', ')
        || row.studios?.formatted_address || row.studios?.city || '';
    const lines = [`Cita agendada por ${studio}`];
    if (row.service_description) lines.push(String(row.service_description));
    if (baseUrl) lines.push(`${baseUrl}/calendar`);
    return baseSource('booking', row.id, {
        title: cleanText(`Cita en ${studio}${client ? ` · ${client}` : ''}`, 180),
        description: cleanText(lines.join('\n'), 2000),
        location: cleanText([loc.label && loc.label !== address ? loc.label : '', address].filter(Boolean).join(' · '), 300),
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
    });
}

// Solicitud con turno apartado (artist_booking_holds, frente "turnos"):
// provisoria en Google mientras está 'pending' y no venció. Al confirmarse,
// sale el hold y entra la sesión (session:<uuid>).
function normalizeHold(row, ctx = {}) {
    if (!row || !row.id || row.status !== 'pending') return null;
    const nowMs = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const expires = Date.parse(row.expires_at);
    if (Number.isFinite(expires) && expires <= nowMs) return null;
    const start = Date.parse(row.starts_at);
    const end = Date.parse(row.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const quote = row.quote || row.quotations_db || {};
    const client = quote.client_full_name ? String(quote.client_full_name).trim() : 'Cliente';
    const lines = ['Solicitud de turno: el cliente pidió este horario y está apartado hasta que respondas.'];
    if (quote.quote_id) lines.push(`Cotización ${quote.quote_id}`);
    if (ctx.baseUrl && row.quotation_id != null) lines.push(`${ctx.baseUrl}/my-quotations/detail?id=${encodeURIComponent(row.quotation_id)}`);
    return baseSource('hold', row.id, {
        title: cleanText(`Solicitud de turno · ${client}`, 180),
        description: cleanText(lines.join('\n'), 2000),
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        status: 'tentative',
    });
}

// Vacaciones del artista (artists_db.vacation_start/_end), días completos.
// Mismo criterio que public/shared/js/artist-vacation.js (range): con una sola
// fecha es un día; con las fechas invertidas se ordenan. Unas vacaciones que
// terminaron antes de la ventana (ctx.since) no se publican por primera vez;
// si ya estaban publicadas quedan en Google como historial (resolveMissing).
function normalizeVacation(row, tz, ctx = {}) {
    if (!row || !row.user_id) return null;
    let startDate = dateOnly(row.vacation_start);
    let endDate = dateOnly(row.vacation_end);
    if (!startDate && !endDate) return null;
    if (!startDate) startDate = endDate;
    if (!endDate) endDate = startDate;
    if (endDate < startDate) { const t = startDate; startDate = endDate; endDate = t; }
    const zone = zoneOr(tz);
    const endsAt = zonedMidnightUtc(addDays(endDate, 1), zone);
    const since = Date.parse(ctx && ctx.since);
    if (Number.isFinite(since) && Date.parse(endsAt) < since) return null;
    return baseSource('vacation', row.user_id, {
        title: 'Vacaciones',
        description: 'Vacaciones: tu agenda de We Ötzi está en pausa.',
        startsAt: zonedMidnightUtc(startDate, zone),
        endsAt,
        allDay: true,
    });
}

// Dos instantes iguales aunque PostgREST y toISOString los escriban distinto
// ('…+00:00' vs '….000Z').
function sameInstant(a, b) {
    if (a == null || b == null) return a == null && b == null;
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : String(a) === String(b);
}

// Último instante en que la fuente ocupa la agenda (para no borrarla de
// Google cuando sale de la ventana). null = repetición sin fin.
function sourceEndsAt(source, tz) {
    if (!source) return null;
    if (source.weekly) {
        if (!source.recurrenceUntil) return null;
        return zonedMidnightUtc(addDays(source.recurrenceUntil, 1), zoneOr(tz));
    }
    return source.endsAt || null;
}

// Cuerpo del evento de Google. Determinístico (para el hash). Los campos
// opcionales (status, transparency, reminders) solo aparecen si la fuente los
// define: así el hash de las fuentes de antes no cambia.
function buildGoogleEvent(source, { tz, baseUrl } = {}) {
    const zone = zoneOr(tz);
    const event = {
        summary: source.title,
        description: [source.description, 'Sincronizado desde We Ötzi.'].filter(Boolean).join('\n\n'),
    };
    if (source.location) event.location = source.location;
    if (source.allDay) {
        const startDate = zonedDate(source.startsAt, zone);
        // ends_at puede ser la medianoche siguiente o el último instante del día.
        let endDate = addDays(zonedDate(Date.parse(source.endsAt) - 1, zone), 1);
        if (endDate <= startDate) endDate = addDays(startDate, 1);
        event.start = { date: startDate };
        event.end = { date: endDate };
    } else {
        event.start = { dateTime: source.startsAt, timeZone: zone };
        event.end = { dateTime: source.endsAt, timeZone: zone };
    }
    if (source.weekly) {
        let rule = 'RRULE:FREQ=WEEKLY';
        if (source.recurrenceUntil) {
            rule += source.allDay
                ? `;UNTIL=${source.recurrenceUntil.replace(/-/g, '')}`
                : `;UNTIL=${basicUtc(Date.parse(zonedMidnightUtc(addDays(source.recurrenceUntil, 1), zone)) - 1000)}`;
        }
        event.recurrence = [rule];
    }
    if (source.status) event.status = source.status;
    if (source.transparency) event.transparency = source.transparency;
    if (source.reminders) event.reminders = source.reminders;
    event.extendedProperties = { private: { weotzi: '1', weotzi_source: source.key } };
    if (baseUrl && /^https?:\/\//.test(baseUrl)) event.source = { title: 'We Ötzi', url: `${baseUrl}/calendar` };
    return event;
}

function hashEvent(event) {
    return crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

// Id de evento de Google determinístico por (artista, fuente): base32hex
// (0-9a-v) de 64 caracteres. Si el evento ya existe en el calendario (por
// ejemplo tras desconectar y reconectar), Google responde 409 y lo adoptamos
// con un update: nunca se duplica y nunca se lee el calendario.
function googleEventIdFor(userId, sourceKey) {
    return crypto.createHash('sha256').update(`weotzi:v1:${userId}:${sourceKey}`).digest('hex');
}

function kindOf(sourceKey) {
    const idx = String(sourceKey || '').indexOf(':');
    return idx > 0 ? sourceKey.slice(0, idx) : '';
}

function idOfKey(sourceKey) {
    const idx = String(sourceKey || '').indexOf(':');
    return idx > 0 ? sourceKey.slice(idx + 1) : '';
}

// sources: [{ key, body, hash }] · links: [{ source_key, google_event_id, content_hash }]
// `remove` son los vínculos cuya fuente no apareció en la lista: el servicio
// los verifica (resolveMissing) antes de borrar nada en Google.
function planPush(sources, links) {
    const byKey = new Map((links || []).map((link) => [link.source_key, link]));
    const seen = new Set();
    const create = [];
    const update = [];
    sources.forEach((source) => {
        seen.add(source.key);
        const link = byKey.get(source.key);
        if (!link) create.push(source);
        else if (link.content_hash !== source.hash) update.push(Object.assign({}, source, { googleEventId: link.google_event_id }));
    });
    const remove = (links || []).filter((link) => !seen.has(link.source_key));
    return { create, update, remove };
}

// Mensaje corto y seguro para last_error (sin tokens ni cuerpos de Google).
function safeErrorMessage(err) {
    const code = String(err?.code || '').slice(0, 60);
    if (code === 'invalid_grant') return 'Google revocó el acceso. Volvé a conectar tu cuenta.';
    if (err?.status === 403 || code === 'rateLimitExceeded' || code === 'quotaExceeded') {
        return 'Google limitó los pedidos por un rato. Reintentamos en la próxima sincronización.';
    }
    if (code === 'token_corrupt') return 'No pudimos leer la conexión guardada. Volvé a conectar tu cuenta.';
    return `No pudimos sincronizar con Google${code ? ` (${code})` : ''}.`;
}

/* --------------------------- registro de fuentes -------------------------- */

function callDb(db, method, ...args) {
    return db && typeof db[method] === 'function' ? db[method](...args) : null;
}

const DEFAULT_SOURCES = [
    {
        kind: 'event',
        writeBack: true,
        idOf: (row) => row && row.id,
        list: (db, userId, ctx) => callDb(db, 'listManualEvents', userId, ctx.since, PUSH_TYPES),
        fetchByIds: (db, userId, ids) => callDb(db, 'getManualEventsByIds', userId, ids),
        normalize: (row) => normalizeManual(row),
    },
    {
        kind: 'session',
        writeBack: true,
        idOf: (row) => row && row.session && row.session.id,
        list: (db, userId, ctx) => callDb(db, 'listSessions', userId, ctx.since),
        fetchByIds: (db, userId, ids) => callDb(db, 'getSessionsByIds', userId, ids),
        normalize: (row, ctx) => normalizeSession(row && row.session, row && row.quote, ctx.baseUrl),
    },
    {
        kind: 'trip',
        idOf: (row) => row && row.id,
        list: (db, userId, ctx) => callDb(db, 'listTrips', userId, ctx.sinceDate),
        fetchByIds: (db, userId, ids) => callDb(db, 'getTripsByIds', userId, ids),
        normalize: (row, ctx) => normalizeTrip(row, ctx.tz, ctx.baseUrl),
    },
    {
        kind: 'reminder',
        idOf: (row) => row && row.id,
        list: (db, userId, ctx) => callDb(db, 'listReminders', userId, ctx.since),
        fetchByIds: (db, userId, ids) => callDb(db, 'getRemindersByIds', userId, ids),
        normalize: (row, ctx) => normalizeReminder(row, ctx.tz, ctx.baseUrl),
    },
    {
        kind: 'booking',
        idOf: (row) => row && row.id,
        list: (db, userId, ctx) => callDb(db, 'listStudioBookings', userId, ctx.since),
        fetchByIds: (db, userId, ids) => callDb(db, 'getStudioBookingsByIds', userId, ids),
        normalize: (row, ctx) => normalizeBooking(row, ctx.baseUrl),
    },
    {
        kind: 'hold',
        idOf: (row) => row && row.id,
        list: (db, userId, ctx) => callDb(db, 'listHolds', userId, ctx.since),
        fetchByIds: (db, userId, ids) => callDb(db, 'getHoldsByIds', userId, ids),
        normalize: (row, ctx) => normalizeHold(row, ctx),
    },
    {
        kind: 'vacation',
        idOf: (row) => row && row.user_id,
        list: async (db, userId) => {
            const row = await callDb(db, 'getVacation', userId);
            return row ? [row] : [];
        },
        fetchByIds: async (db, userId) => {
            const row = await callDb(db, 'getVacation', userId);
            return row ? [row] : [];
        },
        normalize: (row, ctx) => normalizeVacation(row, ctx.tz, ctx),
    },
];

/* ------------------------------- servicio -------------------------------- */

function createGcalService({
    cfg, google, db, now = () => Date.now(), log = console, baseUrl = '', sources = DEFAULT_SOURCES,
} = {}) {
    const tokenCache = new Map();   // userId → { token, exp } (solo en memoria)
    const running = new Map();      // userId → Promise (una sync por artista)
    const rerun = new Set();        // pedidos que llegaron con una sync en curso
    const lastManual = new Map();   // userId → ms del último sync pedido por la UI
    const trailing = new Map();     // userId → timer de la corrida diferida
    const soonTimers = new Map();   // userId → timer de syncSoon (servidor)
    const dirtyFailedAt = new Map(); // userId → ms del último intento fallido del poller
    const sourceDefs = (sources || []).filter((def) => def && def.kind && typeof def.list === 'function' && typeof def.normalize === 'function');
    const defsByKind = new Map(sourceDefs.map((def) => [def.kind, def]));

    function requireConfigured() {
        if (!cfg || !cfg.configured) throw new oauth.GcalError('not_configured', oauth.NOT_CONFIGURED_MESSAGE, 503);
    }

    function unrefTimer(timer) {
        if (timer && typeof timer.unref === 'function') timer.unref();
        return timer;
    }

    async function authorize(userId) {
        requireConfigured();
        if (!userId) throw new oauth.GcalError('unauthorized', 'Iniciá sesión para conectar Google Calendar.', 401);
        if (db.isArtist && !(await db.isArtist(userId))) {
            throw new oauth.GcalError('forbidden', 'Solo los artistas pueden conectar Google Calendar.', 403);
        }
        const { state, nonce, codeChallenge } = oauth.createState(cfg, userId, { now: now() });
        return { url: oauth.buildAuthorizeUrl(cfg, { state, codeChallenge }), nonce };
    }

    // Devuelve { ok, reason?, userId? }. Nunca lanza: el callback siempre redirige.
    async function callback(query, cookieNonce) {
        try {
            requireConfigured();
        } catch (_) {
            return { ok: false, reason: 'config' };
        }
        const q = query || {};
        if (q.error) return { ok: false, reason: q.error === 'access_denied' ? 'denied' : 'google' };
        if (!q.code || !q.state) return { ok: false, reason: 'state' };
        let st;
        try {
            st = oauth.verifyState(cfg, q.state, cookieNonce, { now: now() });
        } catch (err) {
            return { ok: false, reason: err.code === 'state_expired' ? 'expired' : 'state' };
        }
        let tokens;
        try {
            tokens = await google.exchangeCode(q.code, st.codeVerifier);
        } catch (err) {
            log.warn?.('[gcal] intercambio de código falló:', err.code || err.status || 'error');
            return { ok: false, reason: 'token', userId: st.userId };
        }
        if (!oauth.hasCalendarScope(tokens.scope)) {
            // Consentimiento granular: el artista destildó el calendario.
            await google.revoke(tokens.refresh_token || tokens.access_token).catch(() => null);
            return { ok: false, reason: 'scope', userId: st.userId };
        }
        if (!tokens.refresh_token) return { ok: false, reason: 'token', userId: st.userId };
        const email = oauth.emailFromIdToken(tokens.id_token, cfg.clientId);
        try {
            const existing = await db.getConnection(st.userId);
            if (existing && existing.google_email && email && existing.google_email !== email) {
                // Cambió de cuenta de Google: revocamos la anterior y empezamos de
                // cero en la nueva (los vínculos de la otra cuenta no sirven).
                try {
                    const oldToken = oauth.decryptToken(existing.refresh_token_enc, cfg.key, st.userId);
                    await google.revoke(oldToken);
                } catch (_) { /* best effort */ }
                await db.deleteConnection(st.userId);
                if (db.deleteAllLinks) await db.deleteAllLinks(st.userId).catch(() => null);
            }
            const iso = new Date(now()).toISOString();
            await db.saveConnection({
                user_id: st.userId,
                google_email: email,
                refresh_token_enc: oauth.encryptToken(tokens.refresh_token, cfg.key, st.userId),
                scope: String(tokens.scope || '').slice(0, 500),
                calendar_id: 'primary',
                connected_at: iso,
                last_error: null,
                needs_reauth: false,
            });
            tokenCache.set(st.userId, tokens.access_token
                ? { token: tokens.access_token, exp: now() + (Number(tokens.expires_in) || 3600) * 1000 }
                : null);
            if (db.markIntegration) await db.markIntegration(st.userId, 'connected', email).catch(() => null);
        } catch (err) {
            log.error?.('[gcal] no se pudo guardar la conexión:', err.message);
            await google.revoke(tokens.refresh_token).catch(() => null);
            return { ok: false, reason: 'server', userId: st.userId };
        }
        return { ok: true, userId: st.userId, email };
    }

    // El vínculo es de otra cuenta de Google (el artista cambió de cuenta
    // mientras estaba desconectado): no sirve para esta conexión.
    function staleLink(link, conn) {
        return !!(link && link.google_email && conn && conn.google_email && link.google_email !== conn.google_email);
    }

    // Quita de Google los eventos publicados que todavía no terminaron (lo
    // pasado queda como historial). Escrituras en paralelo con tope.
    async function removePublishedEvents(userId, conn) {
        const token = await accessTokenFor(userId, conn);
        const calendarId = conn.calendar_id || 'primary';
        const links = ((await db.listLinks(userId)) || [])
            .filter((link) => !staleLink(link, conn))
            .filter((link) => !link.source_ends_at || Date.parse(link.source_ends_at) >= now());
        const batch = links.slice(0, MAX_REMOVE_ON_DISCONNECT);
        let removed = 0;
        for (let i = 0; i < batch.length; i += 8) {
            const chunk = batch.slice(i, i + 8);
            const results = await Promise.allSettled(chunk.map(async (link) => {
                await google.deleteEvent(token, calendarId, link.google_event_id);
                await db.deleteLink(userId, link.source_key);
            }));
            removed += results.filter((r) => r.status === 'fulfilled').length;
        }
        return { removed, remaining: links.length - removed };
    }

    async function disconnect(userId, { removeEvents = false } = {}) {
        requireConfigured();
        // Corridas pendientes fuera, y la que esté en curso se espera: si no,
        // podría volver a crear en Google lo que quitamos acá.
        clearTimeout(trailing.get(userId));
        trailing.delete(userId);
        clearTimeout(soonTimers.get(userId));
        soonTimers.delete(userId);
        rerun.delete(userId);
        if (running.has(userId)) await Promise.resolve(running.get(userId)).catch(() => null);
        const existing = await db.getConnection(userId);
        let revoked = false;
        let removal = null;
        if (existing) {
            // Primero se borra la conexión: desde acá ninguna sincronización
            // nueva arranca (doSync sale con not_connected). Los vínculos
            // sobreviven (FK a auth.users, 20261115150000): si el artista
            // vuelve a conectar la misma cuenta, no se duplica nada.
            await db.deleteConnection(userId);
            rerun.delete(userId);
            if (running.has(userId)) await Promise.resolve(running.get(userId)).catch(() => null);
            if (removeEvents) {
                try {
                    removal = await removePublishedEvents(userId, existing);
                } catch (err) {
                    log.warn?.('[gcal] no se pudieron quitar los eventos al desconectar:', err.code || err.status || 'error');
                    removal = { removed: 0, remaining: null, error: true };
                }
            }
            try {
                const token = oauth.decryptToken(existing.refresh_token_enc, cfg.key, userId);
                revoked = await google.revoke(token);
            } catch (err) {
                log.warn?.('[gcal] revocación falló:', err.code || err.status || 'error');
            }
        }
        tokenCache.delete(userId);
        clearTimeout(trailing.get(userId));
        trailing.delete(userId);
        if (db.markIntegration) await db.markIntegration(userId, 'disconnected', null).catch(() => null);
        const out = { disconnected: true, revoked, hadConnection: !!existing };
        if (removeEvents) {
            out.removedEvents = removal ? removal.removed : 0;
            if (removal && removal.remaining) out.remainingEvents = removal.remaining;
            if (removal && removal.error) out.removeError = true;
        }
        return out;
    }

    async function status(userId) {
        requireConfigured();
        const row = await db.getConnection(userId);
        if (!row) return { connected: false };
        let timezone = null;
        try { timezone = db.getTimezone ? await db.getTimezone(userId) : null; } catch (_) { timezone = null; }
        return {
            connected: true,
            google_email: row.google_email || null,
            calendar_id: row.calendar_id || 'primary',
            connected_at: row.connected_at || null,
            last_sync_at: row.last_sync_at || null,
            last_error: row.last_error || null,
            needs_reauth: !!row.needs_reauth,
            timezone: validTimeZone(timezone) ? timezone : DEFAULT_TZ,
            timezone_saved: validTimeZone(timezone),
            sources: sourceDefs.map((def) => def.kind),
        };
    }

    async function accessTokenFor(userId, conn) {
        const cached = tokenCache.get(userId);
        if (cached && cached.exp - 60 * 1000 > now()) return cached.token;
        const refresh = oauth.decryptToken(conn.refresh_token_enc, cfg.key, userId);
        const res = await google.refreshAccessToken(refresh);
        if (!res || !res.access_token) throw new oauth.GcalError('token_error', 'Google no devolvió un token de acceso.');
        tokenCache.set(userId, { token: res.access_token, exp: now() + (Number(res.expires_in) || 3600) * 1000 });
        return res.access_token;
    }

    function contextFor(tz) {
        const nowMs = now();
        const since = new Date(nowMs - PAST_DAYS * DAY_MS).toISOString();
        return { now: nowMs, nowIso: new Date(nowMs).toISOString(), since, sinceDate: since.slice(0, 10), tz, baseUrl };
    }

    function finalize(source, ctx) {
        const body = buildGoogleEvent(source, { tz: ctx.tz, baseUrl: ctx.baseUrl });
        return Object.assign(source, { body, hash: hashEvent(body), endsAtForLink: sourceEndsAt(source, ctx.tz) });
    }

    // Lee todas las fuentes. Una fuente que falla (p. ej. la tabla de holds
    // todavía no existe) no frena a las demás y sus vínculos no se tocan.
    async function collectSources(userId, ctx) {
        const results = await Promise.allSettled(sourceDefs.map((def) => Promise.resolve(def.list(db, userId, ctx))));
        const out = [];
        const failedKinds = new Set();
        results.forEach((result, index) => {
            const def = sourceDefs[index];
            if (result.status === 'rejected') {
                failedKinds.add(def.kind);
                log.warn?.(`[gcal] no se pudo leer la fuente ${def.kind}:`, result.reason && (result.reason.code || result.reason.status || result.reason.message));
                return;
            }
            (result.value || []).forEach((row) => {
                let source = null;
                try { source = def.normalize(row, ctx); } catch (_) { source = null; }
                if (source && source.key) out.push(finalize(source, ctx));
            });
        });
        // Una misma clave no puede aparecer dos veces (filas duplicadas).
        const unique = new Map();
        out.forEach((source) => { if (!unique.has(source.key)) unique.set(source.key, source); });
        return { sources: [...unique.values()], failedKinds };
    }

    // Vínculos cuya fuente no apareció en la lista: se borran de Google solo si
    // la fila ya no existe o ya no se publica (cancelada, vencida, completada).
    // Si sigue viva (salió de la ventana o quedó fuera del límite de filas),
    // queda en Google como historial y se completa su source_ends_at.
    async function resolveMissing(userId, missing, ctx, failedKinds) {
        const remove = [];
        const keep = [];
        const byKind = new Map();
        missing.forEach((link) => {
            const kind = kindOf(link.source_key);
            const def = defsByKind.get(kind);
            const endsAt = Date.parse(link.source_ends_at);
            if (!def || failedKinds.has(kind) || typeof def.fetchByIds !== 'function') { keep.push(link); return; }
            // Terminó antes de la ventana: historial congelado, no se consulta.
            if (Number.isFinite(endsAt) && endsAt < Date.parse(ctx.since)) { keep.push(link); return; }
            if (!byKind.has(kind)) byKind.set(kind, []);
            byKind.get(kind).push(link);
        });
        const backfill = [];
        for (const [kind, links] of byKind) {
            const def = defsByKind.get(kind);
            let rows;
            try {
                rows = await def.fetchByIds(db, userId, links.map((link) => idOfKey(link.source_key)));
            } catch (err) {
                log.warn?.(`[gcal] no se pudo verificar la fuente ${kind}:`, err && (err.code || err.status || err.message));
                links.forEach((link) => keep.push(link));
                continue;
            }
            if (!Array.isArray(rows)) { links.forEach((link) => keep.push(link)); continue; }
            const byId = new Map();
            rows.forEach((row) => {
                const id = def.idOf ? def.idOf(row) : row && row.id;
                if (id != null) byId.set(String(id), row);
            });
            links.forEach((link) => {
                const row = byId.get(idOfKey(link.source_key));
                let source = null;
                if (row) {
                    try { source = def.normalize(row, ctx); } catch (_) { source = null; }
                }
                if (!row || !source) { remove.push(link); return; }
                keep.push(link);
                const endsAt = sourceEndsAt(source, ctx.tz);
                if (endsAt && !sameInstant(link.source_ends_at, endsAt)) backfill.push(Object.assign({}, link, { source_ends_at: endsAt }));
            });
        }
        return { remove, keep, backfill };
    }

    function isFatal(err) {
        return err && (err.code === 'invalid_grant' || err.status === 401 || err.status === 403 || err.status === 429);
    }

    async function push(userId, token, conn, tz) {
        const calendarId = conn.calendar_id || 'primary';
        const ctx = contextFor(tz);
        const { sources, failedKinds } = await collectSources(userId, ctx);
        const allLinks = (await db.listLinks(userId)) || [];
        const links = [];
        for (const link of allLinks) {
            if (staleLink(link, conn)) await db.deleteLink(userId, link.source_key).catch(() => null);
            else links.push(link);
        }
        const plan = planPush(sources, links);
        const verdict = await resolveMissing(userId, plan.remove, ctx, failedKinds);
        // Vínculos sin cambios en Google pero sin fin anotado (anteriores a
        // 20261115150000) o con otro fin: solo se completa la fila del vínculo
        // (sin escribir en Google). Así "quitar los eventos próximos" al
        // desconectar no toca lo que ya pasó.
        const linkByKey = new Map(links.map((link) => [link.source_key, link]));
        const updating = new Set(plan.update.map((source) => source.key));
        sources.forEach((source) => {
            const link = linkByKey.get(source.key);
            if (!link || updating.has(source.key) || link.content_hash !== source.hash) return;
            const endsAt = source.endsAtForLink || null;
            if (sameInstant(link.source_ends_at, endsAt) && (link.google_email || !conn.google_email)) return;
            verdict.backfill.push(Object.assign({}, link, { source_ends_at: endsAt }));
        });
        const out = { created: 0, updated: 0, removed: 0, failed: 0, deferred: 0 };
        let budget = MAX_WRITES_PER_RUN;
        const syncedAt = () => new Date(now()).toISOString();

        function linkRow(source, googleEventId) {
            return {
                user_id: userId,
                source_key: source.key,
                google_event_id: googleEventId,
                content_hash: source.hash,
                synced_at: syncedAt(),
                source_ends_at: source.endsAtForLink || null,
                google_email: conn.google_email || null,
            };
        }

        async function insertOrAdopt(source) {
            const id = googleEventIdFor(userId, source.key);
            try {
                const created = await google.insertEvent(token, calendarId, Object.assign({ id }, source.body));
                return (created && created.id) || id;
            } catch (err) {
                if (err.status !== 409) throw err;
            }
            // 409: el evento ya existe con ese id (reconexión, o lo borramos y
            // Google lo guarda cancelado). Lo adoptamos y lo dejamos al día.
            try {
                const body = Object.assign({}, source.body, { status: source.body.status || 'confirmed' });
                await google.updateEvent(token, calendarId, id, body);
                return id;
            } catch (err) {
                if (err.status !== 404 && err.status !== 410) throw err;
            }
            const created = await google.insertEvent(token, calendarId, source.body);
            return created.id;
        }

        async function createOne(source) {
            const googleEventId = await insertOrAdopt(source);
            try {
                await db.upsertLink(linkRow(source, googleEventId));
            } catch (err) {
                // Sin vínculo la próxima corrida lo volvería a crear (duplicado):
                // se deshace en Google y cuenta como fallido.
                await google.deleteEvent(token, calendarId, googleEventId).catch(() => null);
                throw err;
            }
            const def = defsByKind.get(source.kind);
            if (db.setSourceGoogleId && def && def.writeBack) await db.setSourceGoogleId(source, googleEventId).catch(() => null);
            return googleEventId;
        }

        for (const link of verdict.remove) {
            if (budget <= 0) { out.deferred += 1; continue; }
            budget -= 1;
            try {
                await google.deleteEvent(token, calendarId, link.google_event_id);
                await db.deleteLink(userId, link.source_key);
                out.removed += 1;
            } catch (err) {
                if (isFatal(err)) throw err;
                out.failed += 1;
            }
        }
        for (const source of plan.update) {
            if (budget <= 0) { out.deferred += 1; continue; }
            budget -= 1;
            try {
                try {
                    await google.updateEvent(token, calendarId, source.googleEventId, source.body);
                    await db.upsertLink(linkRow(source, source.googleEventId));
                } catch (err) {
                    // Lo borraron en Google: lo volvemos a crear.
                    if (err.status !== 404 && err.status !== 410) throw err;
                    await createOne(source);
                }
                out.updated += 1;
            } catch (err) {
                if (isFatal(err)) throw err;
                out.failed += 1;
            }
        }
        for (const source of plan.create) {
            if (budget <= 0) { out.deferred += 1; continue; }
            budget -= 1;
            try {
                await createOne(source);
                out.created += 1;
            } catch (err) {
                if (isFatal(err)) throw err;
                out.failed += 1;
            }
        }
        // Vínculos que siguen vivos fuera de la ventana: solo se anota su fin.
        const backfillRows = verdict.backfill.map((link) => ({
            user_id: userId,
            source_key: link.source_key,
            google_event_id: link.google_event_id,
            content_hash: link.content_hash,
            synced_at: link.synced_at || syncedAt(),
            source_ends_at: link.source_ends_at || null,
            google_email: link.google_email || conn.google_email || null,
        }));
        if (backfillRows.length && typeof db.upsertLinks === 'function') {
            for (let i = 0; i < backfillRows.length; i += 200) {
                await db.upsertLinks(backfillRows.slice(i, i + 200)).catch(() => null);
            }
        } else {
            for (const row of backfillRows) await db.upsertLink(row).catch(() => null);
        }
        return out;
    }

    async function doSync(userId) {
        requireConfigured();
        const conn = await db.getConnection(userId);
        if (!conn) return { skipped: 'not_connected' };
        if (conn.needs_reauth) return { skipped: 'needs_reauth' };
        let tz = DEFAULT_TZ;
        try {
            const pref = db.getTimezone ? await db.getTimezone(userId) : null;
            if (validTimeZone(pref)) tz = pref;
        } catch (_) { /* default */ }
        try {
            const token = await accessTokenFor(userId, conn);
            const pushed = await push(userId, token, conn, tz);
            const lastError = pushed.failed
                ? `${pushed.failed} evento${pushed.failed === 1 ? '' : 's'} no se pudo sincronizar. Reintentamos en la próxima.`
                : null;
            await db.updateConnection(userId, { last_sync_at: new Date(now()).toISOString(), last_error: lastError });
            // La marca de la base se limpia solo si nadie volvió a escribir
            // mientras corría la sincronización (si no, queda para el poller).
            if (conn.dirty_at && db.clearDirty) await db.clearDirty(userId, conn.dirty_at).catch(() => null);
            if (pushed.deferred) syncSoon(userId, 5000);
            return { pushed };
        } catch (err) {
            tokenCache.delete(userId);
            const patch = { last_error: safeErrorMessage(err) };
            if (err.code === 'invalid_grant' || err.code === 'token_corrupt') patch.needs_reauth = true;
            await db.updateConnection(userId, patch).catch(() => null);
            log.warn?.('[gcal] sincronización falló:', err.code || err.status || 'error');
            return { error: err.code || 'error' };
        }
    }

    // Una sincronización por artista. Si llega otro pedido mientras corre, se
    // vuelve a correr una vez al terminar (el cambio pudo quedar afuera).
    function syncUser(userId) {
        if (running.has(userId)) {
            rerun.add(userId);
            return running.get(userId);
        }
        const p = doSync(userId).finally(() => {
            running.delete(userId);
            if (rerun.delete(userId)) syncUser(userId).catch(() => null);
        });
        running.set(userId, p);
        return p;
    }

    // Sync pedido desde la UI al guardar: con freno de 20 s por artista. Si
    // llega dentro del freno, se agenda UNA corrida al cumplirse (no se pierde).
    async function requestSync(userId) {
        requireConfigured();
        const last = lastManual.get(userId) || 0;
        const wait = MANUAL_SYNC_MIN_MS - (now() - last);
        if (wait > 0) {
            if (!trailing.has(userId)) {
                trailing.set(userId, unrefTimer(setTimeout(() => {
                    trailing.delete(userId);
                    lastManual.set(userId, now());
                    syncUser(userId).catch(() => null);
                }, wait)));
            }
            return { throttled: true, scheduled: true };
        }
        lastManual.set(userId, now());
        return syncUser(userId);
    }

    // Pedido del servidor (otra ruta escribió algo del artista): debounce corto.
    function syncSoon(userId, delayMs = SOON_DELAY_MS) {
        if (!userId || !cfg || !cfg.configured) return false;
        clearTimeout(soonTimers.get(userId));
        soonTimers.set(userId, unrefTimer(setTimeout(() => {
            soonTimers.delete(userId);
            syncUser(userId).catch(() => null);
        }, Math.max(0, Number(delayMs) || 0))));
        return true;
    }

    async function runAll() {
        requireConfigured();
        const conns = await db.listActiveConnections();
        const summary = { users: 0, ok: 0, failed: 0 };
        for (const conn of conns || []) {
            summary.users += 1;
            const result = await syncUser(conn.user_id);
            if (result && result.error) summary.failed += 1;
            else summary.ok += 1;
        }
        return summary;
    }

    // Artistas con cambios marcados por la base (dirty_at). Un artista que
    // falló se reintenta recién a los 5 min (el job completo sigue igual).
    async function runDirty() {
        requireConfigured();
        if (!db.listDirtyConnections) return { users: 0, ok: 0, failed: 0, skipped: 0 };
        const conns = (await db.listDirtyConnections()) || [];
        const summary = { users: 0, ok: 0, failed: 0, skipped: 0 };
        for (const conn of conns) {
            const failedAt = dirtyFailedAt.get(conn.user_id) || 0;
            if (now() - failedAt < DIRTY_RETRY_MS) { summary.skipped += 1; continue; }
            summary.users += 1;
            const result = await syncUser(conn.user_id);
            if (result && result.error) {
                dirtyFailedAt.set(conn.user_id, now());
                summary.failed += 1;
            } else {
                dirtyFailedAt.delete(conn.user_id);
                summary.ok += 1;
            }
        }
        return summary;
    }

    function dispose() {
        trailing.forEach((timer) => clearTimeout(timer));
        soonTimers.forEach((timer) => clearTimeout(timer));
        trailing.clear();
        soonTimers.clear();
    }

    return { authorize, callback, disconnect, status, syncUser, requestSync, syncSoon, runAll, runDirty, dispose };
}

/* ------------------------- servicio compartido ---------------------------- */
// server.js registra la instancia; cualquier módulo del servidor que escriba
// algo de la agenda de un artista puede pedir la sincronización sin depender
// de server.js: require('./gcal-sync').notifyChange(artistUserId).
let sharedService = null;

function setSharedService(service) {
    sharedService = service || null;
}

function notifyChange(userId, delayMs) {
    try {
        return !!(sharedService && sharedService.syncSoon && sharedService.syncSoon(userId, delayMs));
    } catch (_) {
        return false;
    }
}

/* ---------------------------------- jobs ---------------------------------- */

// Job opt-out (GCAL_SYNC_JOB=off). Completo cada 15 min (arranca 1 min después
// del boot) + poller de cambios marcados por la base cada GCAL_DIRTY_POLL_MS
// (30 s por defecto; 0 lo apaga).
function syncJobEnabled(env = process.env) {
    return String(env.GCAL_SYNC_JOB || '').trim().toLowerCase() !== 'off';
}

function dirtyPollMs(env = process.env) {
    const raw = String(env.GCAL_DIRTY_POLL_MS == null ? '' : env.GCAL_DIRTY_POLL_MS).trim();
    if (raw === '') return 30 * 1000;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(5 * 1000, Math.min(10 * 60 * 1000, Math.round(n)));
}

function startSyncJob(service, {
    intervalMs = 15 * 60 * 1000, firstDelayMs = 60 * 1000, dirtyIntervalMs = dirtyPollMs(), log = console,
} = {}) {
    let active = false;
    let dirtyActive = false;
    const tick = async () => {
        if (active) return;
        active = true;
        try {
            const summary = await service.runAll();
            if (summary.users) log.log?.('[gcal] sincronización:', JSON.stringify(summary));
        } catch (err) {
            log.warn?.('[gcal] job de sincronización:', err.code || err.message);
        } finally {
            active = false;
        }
    };
    const dirtyTick = async () => {
        if (dirtyActive || active || typeof service.runDirty !== 'function') return;
        dirtyActive = true;
        try {
            await service.runDirty();
        } catch (err) {
            log.warn?.('[gcal] cambios pendientes:', err.code || err.message);
        } finally {
            dirtyActive = false;
        }
    };
    const timers = [setTimeout(tick, firstDelayMs), setInterval(tick, intervalMs)];
    if (dirtyIntervalMs > 0) timers.push(setInterval(dirtyTick, dirtyIntervalMs));
    timers.forEach((timer) => { if (timer.unref) timer.unref(); });
    return () => {
        clearTimeout(timers[0]);
        timers.slice(1).forEach((timer) => clearInterval(timer));
    };
}

module.exports = {
    DEFAULT_TZ,
    PUSH_TYPES,
    PAST_DAYS,
    MAX_WRITES_PER_RUN,
    LINK_KINDS,
    DEFAULT_SOURCES,
    validTimeZone,
    zonedDate,
    zonedMidnightUtc,
    addDays,
    normalizeManual,
    normalizeSession,
    normalizeTrip,
    normalizeReminder,
    normalizeBooking,
    normalizeHold,
    normalizeVacation,
    sourceEndsAt,
    buildGoogleEvent,
    hashEvent,
    googleEventIdFor,
    planPush,
    safeErrorMessage,
    createGcalService,
    setSharedService,
    notifyChange,
    syncJobEnabled,
    dirtyPollMs,
    startSyncJob,
};
