'use strict';

// Frente gcal (beta cerrada): todas las fuentes de We Ötzi llegan a Google,
// rápido, sin borrar el historial y sin duplicar al reconectar. Solo de ida.
// Con Google y base simulados: ningún test sale a la red.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const oauth = require('../lib/gcal-oauth');
const sync = require('../lib/gcal-sync');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const ENV = {
    GOOGLE_OAUTH_CLIENT_ID: 'cliente-demo.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secreto-demo',
    GCAL_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const CFG = oauth.gcalConfig(ENV);
const USER = '11111111-2222-4333-8444-555555555555';
const TZ = 'America/Argentina/Buenos_Aires';
const NOW = Date.parse('2026-11-15T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const silent = { warn() {}, error() {}, log() {} };

/* ------------------------------ dobles ---------------------------------- */

function memoryDb(seed = {}) {
    const state = {
        connections: new Map(),
        links: new Map(),
        manual: seed.manual || [],
        sessions: seed.sessions || [],
        trips: seed.trips || [],
        reminders: seed.reminders || [],
        bookings: seed.bookings || [],
        holds: seed.holds || [],
        vacation: seed.vacation || null,
        cleared: [],
        failList: new Set(seed.failList || []),
        limit: seed.limit || Infinity,
        connCalls: 0,
    };
    const since = (s) => Date.parse(s);
    const take = (rows) => rows.slice(0, state.limit);
    const pick = (rows, ids, idOf = (r) => r.id) => rows.filter((r) => ids.includes(String(idOf(r))));
    const maybeFail = (kind) => { if (state.failList.has(kind)) throw new Error(`PostgREST GET ${kind} failed (500)`); };
    return {
        state,
        async isArtist() { return true; },
        async getConnection(uid) { state.connCalls += 1; return state.connections.has(uid) ? { ...state.connections.get(uid) } : null; },
        async listActiveConnections() { return [...state.connections.values()].filter((c) => !c.needs_reauth).map((c) => ({ user_id: c.user_id })); },
        async listDirtyConnections() { return [...state.connections.values()].filter((c) => c.dirty_at && !c.needs_reauth).map((c) => ({ user_id: c.user_id, dirty_at: c.dirty_at })); },
        async clearDirty(uid, at) { state.cleared.push(at); const c = state.connections.get(uid); if (c && c.dirty_at === at) c.dirty_at = null; },
        async saveConnection(row) { state.connections.set(row.user_id, { ...(state.connections.get(row.user_id) || {}), ...row }); },
        async updateConnection(uid, patch) { if (state.connections.has(uid)) state.connections.set(uid, { ...state.connections.get(uid), ...patch }); },
        async deleteConnection(uid) { state.connections.delete(uid); },
        async deleteAllLinks(uid) { [...state.links.keys()].filter((k) => k.startsWith(`${uid}|`)).forEach((k) => state.links.delete(k)); },
        async listLinks(uid) { return [...state.links.entries()].filter(([k]) => k.startsWith(`${uid}|`)).map(([, v]) => ({ ...v })); },
        async upsertLink(row) { state.links.set(`${row.user_id}|${row.source_key}`, { ...row }); },
        async deleteLink(uid, key) { state.links.delete(`${uid}|${key}`); },
        async listManualEvents(uid, s) { maybeFail('event'); return take(state.manual.filter((r) => r.recurrence_rule === 'weekly' || Date.parse(r.ends_at) >= since(s))); },
        async getManualEventsByIds(uid, ids) { return pick(state.manual, ids); },
        async listSessions(uid, s) { maybeFail('session'); return take(state.sessions.filter((r) => Date.parse(r.session.session_date) >= since(s))); },
        async getSessionsByIds(uid, ids) { return pick(state.sessions, ids, (r) => r.session.id); },
        async listTrips(uid, d) { maybeFail('trip'); return take(state.trips.filter((r) => r.end_date >= d)); },
        async getTripsByIds(uid, ids) { return pick(state.trips, ids); },
        async listReminders() { maybeFail('reminder'); return take(state.reminders.filter((r) => !r.completed_at)); },
        async getRemindersByIds(uid, ids) { return pick(state.reminders, ids); },
        async listStudioBookings(uid, s) { maybeFail('booking'); return take(state.bookings.filter((r) => Date.parse(r.ends_at) >= since(s) && ['confirmed', 'completed'].includes(r.status))); },
        async getStudioBookingsByIds(uid, ids) { return pick(state.bookings, ids); },
        async listHolds(uid, s) { maybeFail('hold'); return take(state.holds.filter((r) => r.status === 'pending' && Date.parse(r.ends_at) >= since(s))); },
        async getHoldsByIds(uid, ids) { return pick(state.holds, ids); },
        async getVacation() { return state.vacation; },
        async setSourceGoogleId() {},
        async getTimezone() { return TZ; },
    };
}

function fakeGoogle() {
    const calls = [];
    let n = 0;
    const g = {
        calls,
        events: new Map(),
        tomb: new Set(),
        async exchangeCode() {
            const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
            return {
                access_token: 'ya29.A', refresh_token: '1//R', expires_in: 3599,
                scope: `openid email ${oauth.CALENDAR_SCOPE}`,
                id_token: `${enc({})}.${enc({ iss: 'https://accounts.google.com', aud: ENV.GOOGLE_OAUTH_CLIENT_ID, email: g.email || 'artista@gmail.com' })}.x`,
            };
        },
        async refreshAccessToken() { return { access_token: 'ya29.B', expires_in: 3599 }; },
        async revoke() { calls.push(['revoke']); return true; },
        async insertEvent(token, cal, body) {
            n += 1;
            const id = body.id || `g${n}`;
            if (body.id && (g.events.has(id) || g.tomb.has(id))) { calls.push(['conflict', id]); throw new oauth.GcalError('duplicate', 'x', 409); }
            const stored = { ...body };
            delete stored.id;
            g.events.set(id, stored);
            calls.push(['insert', id, body.extendedProperties.private.weotzi_source]);
            return { id };
        },
        async updateEvent(token, cal, id, body) {
            calls.push(['update', id]);
            if (g.tomb.has(id)) { g.tomb.delete(id); g.events.set(id, body); return { id }; }
            if (!g.events.has(id)) throw new oauth.GcalError('notFound', 'x', 404);
            g.events.set(id, body);
            return { id };
        },
        async deleteEvent(token, cal, id) { calls.push(['delete', id]); if (g.events.delete(id)) g.tomb.add(id); },
    };
    return g;
}

async function connected(seed = {}, opts = {}) {
    const db = memoryDb(seed);
    const google = opts.google || fakeGoogle();
    const clock = { now: opts.now || NOW };
    const svc = sync.createGcalService({ cfg: CFG, google, db, now: () => clock.now, log: silent, baseUrl: 'https://beta.weotzi.com' });
    const { url, nonce } = await svc.authorize(USER);
    await svc.callback({ code: 'c', state: new URL(url).searchParams.get('state') }, nonce);
    return { db, google, svc, clock };
}

const writes = (google) => google.calls.filter((c) => ['insert', 'update', 'delete'].includes(c[0])).length;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------- normalizadores ----------------------------- */

test('recordatorio con hora: 30 min, aviso emergente, no ocupa horario y repite semanal', () => {
    const r = sync.normalizeReminder({ id: 'r1', title: 'Pedir tinta', detail: 'Proveedor', due_at: '2026-11-20T18:00:00Z', recurrence_rule: 'weekly', recurrence_until: '2026-12-31' }, TZ, 'https://beta.weotzi.com');
    assert.equal(r.key, 'reminder:r1');
    assert.equal(Date.parse(r.endsAt) - Date.parse(r.startsAt), 30 * 60 * 1000);
    const body = sync.buildGoogleEvent(r, { tz: TZ });
    assert.equal(body.transparency, 'transparent');
    assert.deepEqual(body.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
    assert.match(body.recurrence[0], /^RRULE:FREQ=WEEKLY;UNTIL=/);
    assert.match(body.description, /Proveedor/);
});

test('recordatorio de solo fecha: todo el día; completado o sin fecha: no se publica', () => {
    const r = sync.normalizeReminder({ id: 'r2', title: 'Pagar alquiler', due_date: '2026-11-21', recurrence_rule: 'none' }, TZ);
    const body = sync.buildGoogleEvent(r, { tz: TZ });
    assert.deepEqual(body.start, { date: '2026-11-21' });
    assert.deepEqual(body.end, { date: '2026-11-22' });
    assert.equal(body.reminders, undefined);
    assert.equal(sync.normalizeReminder({ id: 'r3', title: 'x', due_date: '2026-11-21', completed_at: '2026-11-10' }, TZ), null);
    assert.equal(sync.normalizeReminder({ id: 'r4', title: 'x' }, TZ), null);
});

test('cita de estudio: título con estudio y cliente, dirección de la sede, sin email ni teléfono', () => {
    const b = sync.normalizeBooking({
        id: 'b1', status: 'confirmed', starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T18:00:00Z',
        client_name: 'Lucía', client_email: 'lucia@mail.com', client_phone: '+54 11 5555',
        service_description: 'Brazo completo', studios: { name: 'Tinta Sur' },
        studio_locations: { label: 'Palermo', formatted_address: 'Gorriti 1234, CABA' },
    }, 'https://beta.weotzi.com');
    assert.equal(b.key, 'booking:b1');
    assert.equal(b.title, 'Cita en Tinta Sur · Lucía');
    assert.equal(b.location, 'Palermo · Gorriti 1234, CABA');
    const text = JSON.stringify(sync.buildGoogleEvent(b, { tz: TZ }));
    assert.ok(!text.includes('lucia@mail.com') && !text.includes('5555'), 'sin datos de contacto del cliente');
    assert.ok(sync.normalizeBooking({ id: 'b2', status: 'completed', starts_at: '2026-11-01T15:00:00Z', ends_at: '2026-11-01T16:00:00Z' }));
    assert.equal(sync.normalizeBooking({ id: 'b3', status: 'cancelled', starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T18:00:00Z' }), null);
    assert.equal(sync.normalizeBooking({ id: 'b4', status: 'no_show', starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T18:00:00Z' }), null);
});

test('turno apartado (hold): provisorio mientras está pendiente y sin vencer', () => {
    const row = { id: 'h1', quotation_id: 42, status: 'pending', starts_at: '2026-11-25T15:00:00Z', ends_at: '2026-11-25T18:00:00Z', expires_at: iso(NOW + 2 * DAY), quotations_db: { quote_id: 'WO-42', client_full_name: 'Mara' } };
    const h = sync.normalizeHold(row, { now: NOW, baseUrl: 'https://beta.weotzi.com' });
    assert.equal(h.key, 'hold:h1');
    assert.equal(h.title, 'Solicitud de turno · Mara');
    const body = sync.buildGoogleEvent(h, { tz: TZ });
    assert.equal(body.status, 'tentative');
    assert.match(body.description, /my-quotations\/detail\?id=42/);
    assert.equal(sync.normalizeHold({ ...row, expires_at: iso(NOW - 1) }, { now: NOW }), null, 'vencido');
    assert.equal(sync.normalizeHold({ ...row, status: 'confirmed' }, { now: NOW }), null, 'confirmado: entra la sesión');
    assert.equal(sync.normalizeHold({ ...row, status: 'released' }, { now: NOW }), null);
});

test('vacaciones: días completos en la zona del artista', () => {
    const v = sync.normalizeVacation({ user_id: USER, vacation_start: '2026-12-20', vacation_end: '2026-12-31' }, 'Europe/Madrid');
    assert.equal(v.key, `vacation:${USER}`);
    const body = sync.buildGoogleEvent(v, { tz: 'Europe/Madrid' });
    assert.deepEqual(body.start, { date: '2026-12-20' });
    assert.deepEqual(body.end, { date: '2027-01-01' });
    assert.equal(sync.normalizeVacation({ user_id: USER, vacation_start: null }, TZ), null);
});

test('vacaciones: mismo criterio que artist-vacation.js (una fecha, fechas invertidas) y sin publicar las viejas', () => {
    const onlyEnd = sync.buildGoogleEvent(sync.normalizeVacation({ user_id: USER, vacation_start: null, vacation_end: '2026-12-24' }, TZ), { tz: TZ });
    assert.deepEqual([onlyEnd.start, onlyEnd.end], [{ date: '2026-12-24' }, { date: '2026-12-25' }]);
    const swapped = sync.buildGoogleEvent(sync.normalizeVacation({ user_id: USER, vacation_start: '2026-12-20', vacation_end: '2026-12-01' }, TZ), { tz: TZ });
    assert.deepEqual([swapped.start, swapped.end], [{ date: '2026-12-01' }, { date: '2026-12-21' }]);
    const ctx = { since: iso(NOW - 30 * DAY) };
    assert.equal(sync.normalizeVacation({ user_id: USER, vacation_start: '2026-08-01', vacation_end: '2026-08-15' }, TZ, ctx), null, 'terminó hace meses');
    assert.ok(sync.normalizeVacation({ user_id: USER, vacation_start: '2026-11-01', vacation_end: '2026-11-05' }, TZ, ctx), 'dentro de la ventana');
});

test('revisión: vínculos sin fin anotado que siguen en la lista se completan sin escribir en Google', async () => {
    const manual = [{ id: 'past', event_type: 'personal', title: 'Pasado', starts_at: iso(NOW - 5 * DAY), ends_at: iso(NOW - 5 * DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }];
    const { db, google, svc } = await connected({ manual });
    await svc.syncUser(USER);
    const link = db.state.links.get(`${USER}|event:past`);
    // Como quedó antes de 20261115150000: sin fin ni cuenta.
    link.source_ends_at = null;
    link.google_email = null;
    const before = writes(google);
    await svc.syncUser(USER);
    assert.equal(writes(google), before, 'sin escrituras en Google');
    assert.equal(db.state.links.get(`${USER}|event:past`).source_ends_at, iso(NOW - 5 * DAY + 3600e3));
    assert.equal(db.state.links.get(`${USER}|event:past`).google_email, 'artista@gmail.com');
    // Y por eso "quitar los eventos próximos" respeta el pasado.
    const res = await svc.disconnect(USER, { removeEvents: true });
    assert.equal(res.removedEvents, 0);
    assert.equal(google.events.size, 1);
});

test('revisión: el fin que devuelve PostgREST (+00:00) no fuerza reescrituras del vínculo', async () => {
    const manual = [{ id: 'e1', event_type: 'personal', title: 'E', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }];
    const { db, svc } = await connected({ manual });
    await svc.syncUser(USER);
    const link = db.state.links.get(`${USER}|event:e1`);
    link.source_ends_at = link.source_ends_at.replace('.000Z', '+00:00');
    let upserts = 0;
    const original = db.upsertLink;
    db.upsertLink = async (row) => { upserts += 1; return original(row); };
    await svc.syncUser(USER);
    assert.equal(upserts, 0);
});

test('revisión: desconectar espera la sincronización en curso y borra la conexión antes de quitar eventos', async () => {
    const manual = [{ id: 'next', event_type: 'personal', title: 'Próximo', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }];
    const { db, google, svc } = await connected({ manual });
    const order = [];
    const originalDelete = db.deleteConnection;
    db.deleteConnection = async (uid) => { order.push('deleteConnection'); return originalDelete(uid); };
    const originalDeleteEvent = google.deleteEvent;
    google.deleteEvent = async (...args) => { order.push('deleteEvent'); return originalDeleteEvent(...args); };
    const running = svc.syncUser(USER);
    const res = await svc.disconnect(USER, { removeEvents: true });
    await running;
    assert.equal(res.removedEvents, 1, 'la sync en curso terminó antes y su evento también se quitó');
    assert.equal(google.events.size, 0);
    assert.deepEqual(order, ['deleteConnection', 'deleteEvent']);
    // Ninguna corrida posterior vuelve a publicar: no hay conexión.
    assert.deepEqual(await svc.syncUser(USER), { skipped: 'not_connected' });
});

test('sesiones: no_show (COT-A-15) y cotizaciones cerradas (CAL-12) no se publican', () => {
    const s = { id: 's1', quotation_id: 3, session_date: '2026-11-19T17:00:00Z', duration_hours: 2, status: 'scheduled' };
    assert.ok(sync.normalizeSession(s, { quote_status: 'client_approved' }));
    assert.equal(sync.normalizeSession({ ...s, status: 'no_show' }, null), null);
    for (const st of ['cancelled', 'expired', 'client_rejected']) {
        assert.equal(sync.normalizeSession(s, { quote_status: st }), null, st);
    }
});

test('el cuerpo de las fuentes de antes no cambia (sin updates masivos tras el deploy)', () => {
    const manual = sync.normalizeManual({ id: 'a1', event_type: 'personal', title: 'Dentista', starts_at: '2026-11-18T15:00:00Z', ends_at: '2026-11-18T16:00:00Z', status: 'scheduled', recurrence_rule: 'none' });
    const body = sync.buildGoogleEvent(manual, { tz: TZ, baseUrl: 'https://beta.weotzi.com' });
    assert.deepEqual(Object.keys(body), ['summary', 'description', 'start', 'end', 'extendedProperties', 'source']);
});

test('id de evento determinístico: base32hex, 64 caracteres, por artista y fuente', () => {
    const a = sync.googleEventIdFor(USER, 'event:a1');
    assert.match(a, /^[0-9a-v]{64}$/);
    assert.equal(a, sync.googleEventIdFor(USER, 'event:a1'));
    assert.notEqual(a, sync.googleEventIdFor(USER, 'event:a2'));
    assert.notEqual(a, sync.googleEventIdFor('99999999-2222-4333-8444-555555555555', 'event:a1'));
});

/* ------------------------------ servicio -------------------------------- */

test('syncUser publica todas las fuentes de We Ötzi', async () => {
    const seed = {
        manual: [{ id: 'e1', event_type: 'blocked_day', title: 'Bloqueo', starts_at: '2026-11-20T03:00:00Z', ends_at: '2026-11-21T03:00:00Z', all_day: true, status: 'scheduled', recurrence_rule: 'none' }],
        sessions: [{ session: { id: 's1', quotation_id: 3, session_date: '2026-11-19T17:00:00Z', duration_hours: 2, status: 'scheduled' }, quote: { quote_id: 'WO-3', client_full_name: 'Lucía', quote_status: 'client_approved' } }],
        trips: [{ id: 't1', trip_type: 'convencion', status: 'planificado', city: 'Lima', event_name: 'Tattoo Fest', start_date: '2026-12-01', end_date: '2026-12-03' }],
        reminders: [{ id: 'r1', title: 'Pedir tinta', due_at: '2026-11-20T18:00:00Z', recurrence_rule: 'none' }],
        bookings: [{ id: 'b1', status: 'confirmed', starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T18:00:00Z', client_name: 'Ana', studios: { name: 'Tinta Sur' } }],
        holds: [{ id: 'h1', quotation_id: 9, status: 'pending', starts_at: '2026-11-25T15:00:00Z', ends_at: '2026-11-25T18:00:00Z', expires_at: iso(NOW + DAY) }],
        vacation: { user_id: USER, vacation_start: '2026-12-20', vacation_end: '2026-12-31' },
    };
    const { db, google, svc } = await connected(seed);
    const r = await svc.syncUser(USER);
    assert.deepEqual(r.pushed, { created: 7, updated: 0, removed: 0, failed: 0, deferred: 0 });
    const kinds = [...db.state.links.keys()].map((k) => k.split('|')[1].split(':')[0]).sort();
    assert.deepEqual(kinds, ['booking', 'event', 'hold', 'reminder', 'session', 'trip', 'vacation']);
    const link = db.state.links.get(`${USER}|session:s1`);
    assert.equal(link.google_event_id, sync.googleEventIdFor(USER, 'session:s1'));
    assert.equal(link.source_ends_at, '2026-11-19T19:00:00.000Z');
    assert.equal(link.google_email, 'artista@gmail.com');
    assert.ok(!google.calls.some((c) => c[0] === 'list'), 'solo de ida');

    // El hold vence: sale de Google. La cotización se cierra: la sesión sale.
    db.state.holds[0].expires_at = iso(NOW - 1);
    db.state.sessions[0].quote.quote_status = 'cancelled';
    const r2 = await svc.syncUser(USER);
    assert.equal(r2.pushed.removed, 2);
    assert.ok(!db.state.links.has(`${USER}|hold:h1`));
    assert.ok(!db.state.links.has(`${USER}|session:s1`));
});

test('CAL-01: lo que sale de la ventana de 30 días queda en Google (historial)', async () => {
    const session = { session: { id: 's-old', quotation_id: 3, session_date: '2026-11-10T17:00:00Z', duration_hours: 2, status: 'completed' }, quote: { client_full_name: 'Lucía', quote_status: 'completed' } };
    const { db, google, svc, clock } = await connected({ sessions: [session] }, { now: Date.parse('2026-11-12T12:00:00Z') });
    assert.equal((await svc.syncUser(USER)).pushed.created, 1);
    clock.now = Date.parse('2026-12-25T12:00:00Z'); // 45 días después
    const r = await svc.syncUser(USER);
    assert.deepEqual(r.pushed, { created: 0, updated: 0, removed: 0, failed: 0, deferred: 0 });
    assert.equal(google.events.size, 1);
    assert.ok(db.state.links.has(`${USER}|session:s-old`));
});

test('CAL-01: vínculo viejo sin source_ends_at: se verifica la fila antes de borrar', async () => {
    const trip = { id: 't-old', trip_type: 'guest_spot', status: 'finalizado', city: 'Lima', start_date: '2026-09-01', end_date: '2026-09-05' };
    const { db, google, svc } = await connected({ trips: [trip] });
    // Vínculo de antes de la migración: sin fin anotado.
    await db.upsertLink({ user_id: USER, source_key: 'trip:t-old', google_event_id: 'legacy-1', content_hash: 'h'.repeat(64) });
    google.events.set('legacy-1', {});
    const r = await svc.syncUser(USER);
    assert.equal(r.pushed.removed, 0, 'la fila sigue viva: no se borra de Google');
    assert.ok(google.events.has('legacy-1'));
    assert.ok(db.state.links.get(`${USER}|trip:t-old`).source_ends_at, 'se completa su fin');
    // Si se borra la fila, sí se quita de Google.
    db.state.links.get(`${USER}|trip:t-old`).source_ends_at = null;
    db.state.trips = [];
    assert.equal((await svc.syncUser(USER)).pushed.removed, 1);
    assert.ok(!google.events.has('legacy-1'));
});

test('CAL-01: lista cortada por el límite de filas no borra nada vivo', async () => {
    const manual = Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, event_type: 'personal', title: `E${i}`, starts_at: iso(NOW + (i + 1) * DAY), ends_at: iso(NOW + (i + 1) * DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }));
    const { db, svc } = await connected({ manual });
    assert.equal((await svc.syncUser(USER)).pushed.created, 4);
    db.state.limit = 2;
    const r = await svc.syncUser(USER);
    assert.equal(r.pushed.removed, 0);
    assert.equal(db.state.links.size, 4);
});

test('una fuente que falla al leerse no borra sus eventos de Google', async () => {
    const { db, google, svc } = await connected({ bookings: [{ id: 'b1', status: 'confirmed', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), studios: { name: 'X' } }] });
    await svc.syncUser(USER);
    db.state.failList.add('booking');
    const r = await svc.syncUser(USER);
    assert.equal(r.pushed.removed, 0);
    assert.equal(google.events.size, 1);
});

test('CAL-13: desconectar y reconectar la misma cuenta no duplica', async () => {
    const manual = [{ id: 'e1', event_type: 'personal', title: 'Dentista', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }];
    const { db, google, svc } = await connected({ manual });
    await svc.syncUser(USER);
    await svc.disconnect(USER);
    const { url, nonce } = await svc.authorize(USER);
    await svc.callback({ code: 'c', state: new URL(url).searchParams.get('state') }, nonce);
    const before = writes(google);
    const r = await svc.syncUser(USER);
    assert.deepEqual(r.pushed, { created: 0, updated: 0, removed: 0, failed: 0, deferred: 0 });
    assert.equal(writes(google), before);
    assert.equal(google.events.size, 1);
    assert.ok(db.state.links.size === 1);
});

test('CAL-13: aunque se pierdan los vínculos, el id determinístico adopta el evento (409)', async () => {
    const manual = [{ id: 'e1', event_type: 'personal', title: 'Dentista', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }];
    const { db, google, svc } = await connected({ manual });
    await svc.syncUser(USER);
    await db.deleteAllLinks(USER);
    const r = await svc.syncUser(USER);
    assert.equal(r.pushed.created, 1);
    assert.ok(google.calls.some((c) => c[0] === 'conflict'), 'Google respondió 409');
    assert.equal(google.events.size, 1, 'sin duplicado');
});

test('CAL-13: otra cuenta de Google → los vínculos viejos se descartan y se publica en la nueva', async () => {
    const manual = [{ id: 'e1', event_type: 'personal', title: 'Dentista', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }];
    const { db, svc } = await connected({ manual });
    await svc.syncUser(USER);
    await svc.disconnect(USER);
    const other = fakeGoogle();
    other.email = 'otra@gmail.com';
    const svc2 = sync.createGcalService({ cfg: CFG, google: other, db, now: () => NOW, log: silent });
    const { url, nonce } = await svc2.authorize(USER);
    await svc2.callback({ code: 'c', state: new URL(url).searchParams.get('state') }, nonce);
    const r = await svc2.syncUser(USER);
    assert.equal(r.pushed.created, 1);
    assert.equal(other.events.size, 1);
    assert.equal(db.state.links.get(`${USER}|event:e1`).google_email, 'otra@gmail.com');
});

test('desconectar con removeEvents quita de Google solo lo que no pasó', async () => {
    const manual = [
        { id: 'past', event_type: 'personal', title: 'Pasado', starts_at: iso(NOW - 5 * DAY), ends_at: iso(NOW - 5 * DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' },
        { id: 'next', event_type: 'personal', title: 'Próximo', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' },
    ];
    const { db, google, svc } = await connected({ manual });
    await svc.syncUser(USER);
    const res = await svc.disconnect(USER, { removeEvents: true });
    assert.equal(res.removedEvents, 1);
    assert.equal(google.events.size, 1);
    assert.ok(google.events.has(sync.googleEventIdFor(USER, 'event:past')));
    assert.ok(!db.state.links.has(`${USER}|event:next`));
    assert.equal(db.state.connections.size, 0);
});

test('CAL-04: pedido frenado → se agenda una corrida al cumplirse el freno', async () => {
    const { db, google, svc, clock } = await connected({});
    await svc.requestSync(USER);
    db.state.manual.push({ id: 'e9', event_type: 'personal', title: 'Nuevo', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' });
    clock.now += 20 * 1000 - 15;
    assert.deepEqual(await svc.requestSync(USER), { throttled: true, scheduled: true });
    assert.deepEqual(await svc.requestSync(USER), { throttled: true, scheduled: true }, 'uno solo agendado');
    await sleep(80);
    assert.equal(google.calls.filter((c) => c[0] === 'insert').length, 1, 'la corrida diferida publicó el evento');
    svc.dispose();
});

test('CAL-04: un pedido durante una sincronización en curso la repite al terminar', async () => {
    const { db, google, svc } = await connected({});
    const original = db.listManualEvents;
    let calls = 0;
    db.listManualEvents = async (...args) => { calls += 1; await sleep(20); return original(...args); };
    const first = svc.syncUser(USER);
    db.state.manual.push({ id: 'e7', event_type: 'personal', title: 'Durante', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' });
    const second = svc.syncUser(USER);
    assert.equal(first, second, 'misma promesa');
    await first;
    await sleep(80);
    assert.equal(calls, 2, 'se repitió una vez');
    assert.ok(google.events.has(sync.googleEventIdFor(USER, 'event:e7')));
});

test('CAL-04: runDirty sincroniza los marcados por la base y limpia la marca', async () => {
    const { db, svc } = await connected({ manual: [{ id: 'e1', event_type: 'personal', title: 'X', starts_at: iso(NOW + DAY), ends_at: iso(NOW + DAY + 3600e3), status: 'scheduled', recurrence_rule: 'none' }] });
    await db.updateConnection(USER, { dirty_at: '2026-11-15T11:59:59.123456+00:00' });
    const summary = await svc.runDirty();
    assert.deepEqual(summary, { users: 1, ok: 1, failed: 0, skipped: 0 });
    assert.deepEqual(db.state.cleared, ['2026-11-15T11:59:59.123456+00:00']);
    assert.equal(db.state.connections.get(USER).dirty_at, null);
    assert.deepEqual(await svc.runDirty(), { users: 0, ok: 0, failed: 0, skipped: 0 });
});

test('CAL-04: si la sincronización falla, el poller espera antes de reintentar', async () => {
    const { db, svc } = await connected({});
    await db.updateConnection(USER, { dirty_at: '2026-11-15T11:00:00+00:00' });
    db.listLinks = async () => { throw Object.assign(new Error('x'), { code: 'boom' }); };
    assert.equal((await svc.runDirty()).failed, 1);
    assert.equal((await svc.runDirty()).skipped, 1);
});

test('notifyChange usa el servicio compartido; dirtyPollMs y el job', () => {
    const seen = [];
    sync.setSharedService({ syncSoon: (uid) => { seen.push(uid); return true; } });
    assert.equal(sync.notifyChange(USER), true);
    assert.deepEqual(seen, [USER]);
    sync.setSharedService(null);
    assert.equal(sync.notifyChange(USER), false);
    assert.equal(sync.dirtyPollMs({}), 30000);
    assert.equal(sync.dirtyPollMs({ GCAL_DIRTY_POLL_MS: '0' }), 0);
    assert.equal(sync.dirtyPollMs({ GCAL_DIRTY_POLL_MS: '1000' }), 5000, 'mínimo 5 s');
    const stop = sync.startSyncJob({ runAll: async () => ({ users: 0 }), runDirty: async () => ({}) }, { log: silent });
    assert.equal(typeof stop, 'function');
    stop();
});

test('status informa la zona horaria usada y las fuentes', async () => {
    const { svc } = await connected({});
    const st = await svc.status(USER);
    assert.equal(st.timezone, TZ);
    assert.equal(st.timezone_saved, true);
    assert.deepEqual(st.sources, ['event', 'session', 'trip', 'reminder', 'booking', 'hold', 'vacation']);
});

/* --------------------------- contrato estático -------------------------- */

test('migración 20261115150000: fuentes, historial, vínculos sin cascada, marca y CAL-12', () => {
    const sql = read('supabase/migrations/20261115150000_gcal_fuentes_y_marca.sql');
    assert.ok(sql.includes("'^(event|session|trip|reminder|booking|hold|vacation):[A-Za-z0-9-]{1,64}$'"));
    assert.match(sql, /add column if not exists source_ends_at timestamptz/);
    assert.match(sql, /add column if not exists google_email text/);
    assert.match(sql, /foreign key \(user_id\) references auth\.users \(id\) on delete cascade/);
    assert.match(sql, /add column if not exists dirty_at timestamptz/);
    assert.match(sql, /create or replace function private\.gcal_mark_dirty\(\)[\s\S]*security definer[\s\S]*set search_path = ''/);
    assert.match(sql, /create or replace function private\.gcal_attach_dirty_trigger/);
    for (const table of ['artist_calendar_events', 'quotation_sessions', 'artist_trips', 'artist_reminders', 'studio_bookings']) {
        assert.ok(sql.includes(`gcal_attach_dirty_trigger('public.${table}'`), table);
    }
    assert.match(sql, /on public\.quotations_db\s+for each row execute function private\.gcal_mark_dirty\('artist_id', 'direct'\)/);
    assert.match(sql, /update of vacation_start, vacation_end\s+on public\.artists_db/);
    assert.match(sql, /to_regclass\('public\.artist_booking_holds'\)/);
    assert.ok(!/'google_event_id'/.test(sql.slice(sql.indexOf("gcal_attach_dirty_trigger('public.artist_calendar_events'"))), 'google_event_id no dispara (sin bucles)');
    assert.match(sql, /new\.quote_status in \('cancelled', 'expired', 'client_rejected'\)/);
    assert.match(sql, /revoke all on function private\.gcal_mark_dirty\(\) from public, anon, authenticated/);
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /^commit;$/m);
    const down = read('supabase/rollbacks/20261115150000_gcal_fuentes_y_marca.down.sql');
    assert.match(down, /drop function if exists private\.gcal_mark_dirty\(\)/);
    assert.match(down, /drop column if exists dirty_at/);
    assert.match(down, /references public\.artist_google_calendar_connections \(user_id\) on delete cascade/);
    assert.ok(down.includes("check (source_key ~ '^(event|session|trip):[A-Za-z0-9-]{1,64}$')"));
});

test('repo: sesiones en un pedido con la cotización, citas sin datos de contacto, holds tolerantes', () => {
    const src = read('lib/repos/google-calendar.js');
    assert.match(src, /quotations_db!inner\(id,quote_id,client_full_name,quote_status,artist_id\)/);
    assert.match(src, /eq\('quotations_db\.artist_id', userId\)/);
    const booking = src.match(/const BOOKING_SELECT = '([^']+)'/)[1];
    assert.ok(!/client_email|client_phone/.test(booking));
    assert.match(src, /listHolds\(userId, sinceIso\)[\s\S]*isMissingSchema\(err\)\) return \[\]/);
    for (const m of ['getManualEventsByIds', 'getSessionsByIds', 'getTripsByIds', 'getRemindersByIds', 'getStudioBookingsByIds', 'getHoldsByIds', 'getVacation', 'listDirtyConnections', 'clearDirty']) {
        assert.ok(src.includes(`${m}(`), m);
    }
    const { isMissingSchema } = require('../lib/repos/google-calendar');
    assert.equal(isMissingSchema(new Error('PostgREST GET x failed (400): {"code":"42703"}')), true);
    assert.equal(isMissingSchema(new Error('PostgREST GET x failed (500): boom')), false);
});

test('server.js: servicio compartido y desconexión con removeEvents', () => {
    const src = read('server.js');
    const block = src.slice(src.indexOf('// ── gcal ──'), src.indexOf('// ── fin gcal ──'));
    assert.match(block, /gcalSync\.setSharedService\(gcalService\)/);
    assert.match(block, /gcalService\.disconnect\(userId, \{ removeEvents: req\.body\?\.removeEvents === true \}\)/);
});

test('front: las páginas que escriben la agenda piden la sincronización', () => {
    const repo = read('public/shared/js/data/google-calendar-repo.js');
    assert.match(repo, /wrapWrites\(D\.QuotationDetail, \['createSession', 'updateSession', 'updateQuote'\]/);
    assert.match(repo, /wrapWrites\(D\.Quotations, \['createManual'\]\)/);
    assert.match(repo, /removeEvents: options\.removeEvents === true/);
    assert.match(repo, /ensureTimezone\(\)/);
    const detail = read('public/my-quotations/detail/index.html');
    assert.ok(detail.indexOf('google-calendar-repo.js') > detail.indexOf('quotation-detail-repo.js'));
    const created = read('public/my-quotations/new/index.html');
    assert.ok(created.indexOf('google-calendar-repo.js') > created.indexOf('quotations-repo.js'));
    const cal = read('public/shared/js/data/calendar-repo.js');
    assert.match(cal, /'saveReminder', 'removeReminder'\]\.forEach/);
});

test('front: wrapWrites pide sync después de escribir y filtra updateQuote', async () => {
    const synced = [];
    const sandbox = {
        console: { error() {}, warn() {}, log() {} },
        setTimeout: (fn) => { synced.push('timer'); return 1; }, clearTimeout() {},
        document: { readyState: 'complete', addEventListener() {} },
        location: { pathname: '/' },
        Intl, Promise, Object, Array, String, JSON, Error,
    };
    sandbox.window = sandbox;
    const writesLog = [];
    sandbox.WeotziData = {
        run: async () => ({ data: null }),
        getClient: () => null,
        QuotationDetail: {
            async updateQuote(id, patch) { writesLog.push(['updateQuote', patch]); return {}; },
            async createSession() { writesLog.push(['createSession']); return { id: 1 }; },
        },
    };
    vm.runInNewContext(read('public/shared/js/data/google-calendar-repo.js'), sandbox, { filename: 'google-calendar-repo.js' });
    const GC = sandbox.WeotziData.GoogleCalendar;
    let calls = 0;
    GC.syncSoon = () => { calls += 1; };
    await sandbox.WeotziData.QuotationDetail.updateQuote(1, { notes: 'x' });
    assert.equal(calls, 0, 'una nota no dispara');
    await sandbox.WeotziData.QuotationDetail.updateQuote(1, { quote_status: 'cancelled' });
    await sandbox.WeotziData.QuotationDetail.createSession({});
    assert.equal(calls, 2);
    assert.equal(GC.wrapWrites(sandbox.WeotziData.QuotationDetail, ['createSession']), 0, 'no envuelve dos veces');
});

test('CAL-15: el calendario muestra las citas de estudio como turno confirmado de solo lectura', () => {
    const sandbox = {
        console: { error() {}, warn() {}, log() {} },
        Date, Map, Set, Promise, Number, String, Object, RegExp, Math, Array, JSON, encodeURIComponent,
    };
    sandbox.window = sandbox;
    sandbox.WeotziData = { run: async () => ({ data: [] }) };
    vm.runInNewContext(read('public/shared/js/data/calendar-repo.js'), sandbox, { filename: 'calendar-repo.js' });
    const { normalizeStudioBooking } = sandbox.WeotziData.Calendar._internal;
    const ev = normalizeStudioBooking({ id: 'b1', status: 'confirmed', starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T18:00:00Z', client_name: 'Ana', studios: { name: 'Tinta Sur' }, studio_locations: { label: 'Palermo' } });
    assert.equal(ev.type, 'confirmed_session');
    assert.equal(ev.readonly, true);
    assert.equal(ev.title, 'Cita en Tinta Sur: Ana');
    assert.match(ev.readonlyNote, /La gestiona el estudio/);
    assert.equal(normalizeStudioBooking({ id: 'b2', status: 'cancelled', starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T18:00:00Z' }), null);
    assert.match(read('public/shared/js/data/calendar-repo.js'), /client\.from\('studio_bookings'\)[\s\S]*\.eq\('artist_user_id', artistUserId\)/);
});

test('CAL-14 y CAL-13 en Cuenta: zona horaria guardada y diálogo de desconexión', () => {
    const js = read('public/shared/js/artist-account.js');
    assert.match(js, /if \(!appSettings\(\)\.timezone\) \{\s+savePrefs\('app_settings', \{ timezone: tzSel\.value \}\)/);
    assert.match(js, /D\.GoogleCalendar\.disconnect\(\{ removeEvents \}\)/);
    assert.ok(!js.includes("window.confirm('¿Querés desconectar Google Calendar? Dejamos de sincronizar"), 'ya no usa confirm como flujo principal');
    const html = read('public/artist/account/index.html');
    assert.match(html, /<dialog class="aac-dialog" id="av-gcal-disconnect-dialog" aria-labelledby="av-gcal-disconnect-title"/);
    assert.match(html, /<input type="checkbox" id="av-gcal-remove-events">/);
    assert.match(html, /<label class="aac-check" for="av-gcal-remove-events">/);
});

test('COT-A-15: no_show no cuenta como sesión activa y queda en el historial', () => {
    const M = require('../public/shared/js/quotation-detail-model.js');
    const sessions = [
        { id: 1, session_number: 1, status: 'completed', session_date: '2026-11-01T15:00:00Z' },
        { id: 2, session_number: 2, status: 'no_show', session_date: '2026-11-08T15:00:00Z' },
        { id: 3, session_number: 3, status: 'cancelled', session_date: '2026-11-09T15:00:00Z' },
    ];
    const list = M.orderedSessions(sessions);
    assert.deepEqual(list.map((s) => s.id), [1]);
    assert.equal(M.isActiveSession(sessions[1]), false);
    // Integración (cot-artista): una sola entrada de historial por no_show / cancelada.
    const texts = M.historyEvents({ quote_id: 'Q1', quote_status: 'in_progress', created_at: '2026-10-30T12:00:00Z' }, [], sessions, [], new Date('2026-11-10T12:00:00Z'))
        .map((e) => e.text);
    assert.equal(texts.filter((t) => /no se presentó/i.test(t)).length, 1);
    assert.equal(texts.filter((t) => /cancelada/i.test(t)).length, 1);
});

test('docs: cómo se suma una fuente', () => {
    const doc = read('docs/GCAL_SINCRONIZACION.md');
    assert.match(doc, /Cómo se suma una fuente nueva/);
    assert.match(doc, /gcal_attach_dirty_trigger/);
    assert.match(read('.env.example'), /\nGCAL_DIRTY_POLL_MS=\n/);
});
