'use strict';

// ===========================================================================
// Google Calendar · servicio de conexión y sincronización (grupo "gcal").
// ---------------------------------------------------------------------------
// createGcalService({ cfg, google, db, now, log }) concentra el flujo:
//   authorize(userId)            → URL de consentimiento + nonce de la cookie
//   callback(query, cookieNonce) → guarda el refresh token cifrado
//   disconnect(userId)           → revoca en Google y borra (cascada)
//   status(userId)               → estado visible para el artista
//   syncUser(userId) / runAll()  → push (solo de ida: We Ötzi → Google)
//
// Push: artist_calendar_events (tipos que ocupan horario) y quotation_sessions
// → eventos de Google. La tabla artist_google_calendar_event_links guarda
// source_key → google_event_id + hash del contenido: solo se crea, actualiza o
// borra lo que cambió. También se escribe google_event_id en la fila de origen.
// Solo de ida (20261114100000): nunca se lee el calendario de Google del
// artista; solo se crean, actualizan y borran los eventos que publicamos.
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
const CANCELLED_SESSION = new Set(['cancelled', 'canceled', 'cancelada']);
const PAST_DAYS = 30;          // push: eventos que terminaron hace menos de 30 días
const MAX_WRITES_PER_RUN = 150;
const MANUAL_SYNC_MIN_MS = 20 * 1000;

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

/* ------------------------------- fuentes --------------------------------- */

function cleanText(value, max) {
    const text = String(value == null ? '' : value).trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeManual(row) {
    if (!row || !row.id || !PUSH_TYPES.includes(row.event_type) || row.status === 'cancelled') return null;
    const start = Date.parse(row.starts_at);
    const end = Date.parse(row.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const label = TYPE_LABELS[row.event_type];
    const details = [label, row.client_name ? `Cliente: ${row.client_name}` : '', row.notes || ''].filter(Boolean);
    return {
        key: `event:${row.id}`,
        kind: 'event',
        id: row.id,
        title: cleanText(row.title || label, 180),
        description: cleanText(details.join('\n'), 2000),
        location: row.location ? cleanText(row.location, 300) : '',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        allDay: !!row.all_day,
        weekly: row.recurrence_rule === 'weekly',
        recurrenceUntil: row.recurrence_rule === 'weekly' && row.recurrence_until ? String(row.recurrence_until).slice(0, 10) : null,
    };
}

function normalizeSession(session, quote, baseUrl) {
    if (!session || session.id == null) return null;
    if (CANCELLED_SESSION.has(String(session.status || '').toLowerCase())) return null;
    const start = Date.parse(session.session_date);
    if (!Number.isFinite(start)) return null;
    const hours = Number(session.duration_hours) > 0 ? Number(session.duration_hours) : 1;
    const client = quote?.client_full_name ? String(quote.client_full_name).trim() : 'Cliente';
    const lines = [];
    if (quote?.quote_id) lines.push(`Cotización ${quote.quote_id}`);
    if (baseUrl && session.quotation_id != null) lines.push(`${baseUrl}/my-quotations/detail?id=${encodeURIComponent(session.quotation_id)}`);
    if (session.notes) lines.push(String(session.notes));
    return {
        key: `session:${session.id}`,
        kind: 'session',
        id: session.id,
        title: cleanText(`Sesión — ${client}`, 180),
        description: cleanText(lines.join('\n'), 2000),
        location: session.location ? cleanText(session.location, 300) : '',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + hours * 3600 * 1000).toISOString(),
        allDay: false,
        weekly: false,
        recurrenceUntil: null,
    };
}

// Cuerpo del evento de Google. Determinístico (para el hash).
function buildGoogleEvent(source, { tz, baseUrl } = {}) {
    const zone = validTimeZone(tz) ? tz : DEFAULT_TZ;
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
    event.extendedProperties = { private: { weotzi: '1', weotzi_source: source.key } };
    if (baseUrl && /^https?:\/\//.test(baseUrl)) event.source = { title: 'We Ötzi', url: `${baseUrl}/calendar` };
    return event;
}

function hashEvent(event) {
    return crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

// sources: [{ key, body, hash }] · links: [{ source_key, google_event_id, content_hash }]
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

/* ------------------------------- servicio -------------------------------- */

function createGcalService({ cfg, google, db, now = () => Date.now(), log = console, baseUrl = '' } = {}) {
    const tokenCache = new Map();   // userId → { token, exp } (solo en memoria)
    const running = new Map();      // userId → Promise (una sync por artista)
    const lastManual = new Map();   // userId → ms del último sync pedido por la UI

    function requireConfigured() {
        if (!cfg || !cfg.configured) throw new oauth.GcalError('not_configured', oauth.NOT_CONFIGURED_MESSAGE, 503);
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
                // Cambió de cuenta de Google: revocamos la anterior y empezamos de cero
                // (borrar la conexión arrastra vínculos y bloques por cascada).
                try {
                    const oldToken = oauth.decryptToken(existing.refresh_token_enc, cfg.key, st.userId);
                    await google.revoke(oldToken);
                } catch (_) { /* best effort */ }
                await db.deleteConnection(st.userId);
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

    async function disconnect(userId) {
        requireConfigured();
        const existing = await db.getConnection(userId);
        let revoked = false;
        if (existing) {
            try {
                const token = oauth.decryptToken(existing.refresh_token_enc, cfg.key, userId);
                revoked = await google.revoke(token);
            } catch (err) {
                log.warn?.('[gcal] revocación falló:', err.code || err.status || 'error');
            }
            await db.deleteConnection(userId);
        }
        tokenCache.delete(userId);
        if (db.markIntegration) await db.markIntegration(userId, 'disconnected', null).catch(() => null);
        return { disconnected: true, revoked, hadConnection: !!existing };
    }

    async function status(userId) {
        requireConfigured();
        const row = await db.getConnection(userId);
        if (!row) return { connected: false };
        return {
            connected: true,
            google_email: row.google_email || null,
            calendar_id: row.calendar_id || 'primary',
            connected_at: row.connected_at || null,
            last_sync_at: row.last_sync_at || null,
            last_error: row.last_error || null,
            needs_reauth: !!row.needs_reauth,
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

    async function collectSources(userId, tz) {
        const since = new Date(now() - PAST_DAYS * DAY_MS).toISOString();
        const [manual, sessions] = await Promise.all([
            db.listManualEvents(userId, since, PUSH_TYPES),
            db.listSessions(userId, since),
        ]);
        const sources = [];
        (manual || []).forEach((row) => {
            const s = normalizeManual(row);
            if (s) sources.push(s);
        });
        (sessions || []).forEach(({ session, quote }) => {
            const s = normalizeSession(session, quote, baseUrl);
            if (s) sources.push(s);
        });
        return sources.map((source) => {
            const body = buildGoogleEvent(source, { tz, baseUrl });
            return Object.assign(source, { body, hash: hashEvent(body) });
        });
    }

    function isFatal(err) {
        return err && (err.code === 'invalid_grant' || err.status === 401 || err.status === 403 || err.status === 429);
    }

    async function push(userId, token, calendarId, tz) {
        const sources = await collectSources(userId, tz);
        const links = await db.listLinks(userId);
        const plan = planPush(sources, links);
        const out = { created: 0, updated: 0, removed: 0, failed: 0, deferred: 0 };
        let budget = MAX_WRITES_PER_RUN;

        async function createOne(source) {
            const created = await google.insertEvent(token, calendarId, source.body);
            await db.upsertLink({ user_id: userId, source_key: source.key, google_event_id: created.id, content_hash: source.hash, synced_at: new Date(now()).toISOString() });
            if (db.setSourceGoogleId) await db.setSourceGoogleId(source, created.id).catch(() => null);
            return created.id;
        }

        for (const link of plan.remove) {
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
                    await db.upsertLink({ user_id: userId, source_key: source.key, google_event_id: source.googleEventId, content_hash: source.hash, synced_at: new Date(now()).toISOString() });
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
            const calendarId = conn.calendar_id || 'primary';
            const pushed = await push(userId, token, calendarId, tz);
            const lastError = pushed.failed
                ? `${pushed.failed} evento${pushed.failed === 1 ? '' : 's'} no se pudo sincronizar. Reintentamos en la próxima.`
                : null;
            await db.updateConnection(userId, { last_sync_at: new Date(now()).toISOString(), last_error: lastError });
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

    function syncUser(userId) {
        if (running.has(userId)) return running.get(userId);
        const p = doSync(userId).finally(() => running.delete(userId));
        running.set(userId, p);
        return p;
    }

    // Sync pedido desde la UI al guardar un evento: con freno por artista.
    async function requestSync(userId) {
        requireConfigured();
        const last = lastManual.get(userId) || 0;
        if (now() - last < MANUAL_SYNC_MIN_MS) return Promise.resolve({ throttled: true });
        lastManual.set(userId, now());
        return syncUser(userId);
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

    return { authorize, callback, disconnect, status, syncUser, requestSync, runAll };
}

// Job opt-out (GCAL_SYNC_JOB=off). Cada 15 min; arranca 1 min después del boot.
function syncJobEnabled(env = process.env) {
    return String(env.GCAL_SYNC_JOB || '').trim().toLowerCase() !== 'off';
}

function startSyncJob(service, { intervalMs = 15 * 60 * 1000, firstDelayMs = 60 * 1000, log = console } = {}) {
    let active = false;
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
    const first = setTimeout(tick, firstDelayMs);
    const every = setInterval(tick, intervalMs);
    if (first.unref) first.unref();
    if (every.unref) every.unref();
    return () => { clearTimeout(first); clearInterval(every); };
}

module.exports = {
    DEFAULT_TZ,
    PUSH_TYPES,
    MAX_WRITES_PER_RUN,
    validTimeZone,
    zonedDate,
    zonedMidnightUtc,
    addDays,
    normalizeManual,
    normalizeSession,
    buildGoogleEvent,
    hashEvent,
    planPush,
    safeErrorMessage,
    createGcalService,
    syncJobEnabled,
    startSyncJob,
};
