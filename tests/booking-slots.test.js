'use strict';

// Turnos disponibles (frente "turnos"): modelo puro, servicio, intake con
// apartado, avisos y migración. node --test tests/booking-slots.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../public/shared/js/booking-slots-model.js');
const AV = require('../public/shared/js/account-availability-model.js');
const { createBookingService, alternativesFrom, normalizeHoldSource } = require('../lib/booking-slots');
const { requestedSlot, handleSlotIntake } = require('../lib/turnos-intake');
const notify = require('../lib/turnos-notify');
const { mapDbError } = require('../lib/routes/turnos');
const events = require('../services/email-events/turnos');

const AR = 'America/Argentina/Buenos_Aires';
const ON = { enabled: true };
const WEEKDAYS = { weekly: AV.defaultWeekly() }; // lunes a viernes 10:00–19:00
const SAT_NOON_AR = Date.parse('2026-11-21T15:00:00Z'); // sábado 21/11 12:00 en AR

function day(result, date) {
    return result.days.find((d) => d.date === date) || { slots: [], windows: [] };
}
function starts(d) { return d.slots.map((s) => s.start); }

test('sin horario guardado no hay turnos (reason no_schedule); sin opt-in, disabled', () => {
    const none = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability: null, from: SAT_NOON_AR, to: SAT_NOON_AR + 7 * 864e5 });
    assert.equal(none.reason, 'no_schedule');
    assert.equal(none.days.length, 0);
    const off = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: { enabled: false }, availability: WEEKDAYS });
    assert.equal(off.reason, 'disabled');
    const preview = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: { enabled: false }, availability: WEEKDAYS, ignoreEnabled: true, to: SAT_NOON_AR + 3 * 864e5 });
    assert.equal(preview.reason, null);
    assert.ok(day(preview, '2026-11-23').slots.length > 0);
});

test('Argentina (sin DST): turnos de 3 h cada 60 min dentro del horario', () => {
    const r = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability: WEEKDAYS, from: SAT_NOON_AR, to: SAT_NOON_AR + 4 * 864e5 });
    assert.equal(day(r, '2026-11-21').slots.length, 0, 'sábado deshabilitado');
    assert.equal(day(r, '2026-11-22').slots.length, 0, 'domingo deshabilitado');
    const mon = day(r, '2026-11-23');
    assert.deepEqual(starts(mon), [13, 14, 15, 16, 17, 18, 19].map((h) => `2026-11-23T${h}:00:00.000Z`));
    assert.equal(mon.slots[mon.slots.length - 1].end, '2026-11-23T22:00:00.000Z', 'el último termina al cierre (19:00)');
});

test('un evento corta el día con su margen y la capacidad no cuenta de más', () => {
    const busy = [{ start: '2026-11-23T16:00:00Z', end: '2026-11-23T17:00:00Z', kind: 'event' }]; // 13–14 h local
    const r = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability: WEEKDAYS, busy, from: SAT_NOON_AR, to: SAT_NOON_AR + 3 * 864e5 });
    const mon = day(r, '2026-11-23');
    assert.deepEqual(starts(mon), ['2026-11-23T18:00:00.000Z', '2026-11-23T19:00:00.000Z']);
    assert.deepEqual(mon.windows.map((w) => [new Date(w.s).toISOString(), new Date(w.e).toISOString()]), [
        ['2026-11-23T13:00:00.000Z', '2026-11-23T15:30:00.000Z'],
        ['2026-11-23T17:30:00.000Z', '2026-11-23T22:00:00.000Z'],
    ]);
    // 150 min no alcanza para un turno; 270 min alcanzan para 1 (no 2 superpuestos).
    assert.equal(mon.windows.reduce((n, w) => n + M.windowCapacity(w, ON), 0), 1);
});

test('capacidad: 9 h libres con turnos de 3 h y margen de 30 min = 2 turnos', () => {
    assert.equal(M.windowCapacity({ s: 0, e: 9 * 3600e3 }, ON), 2);
    assert.equal(M.windowCapacity({ s: 0, e: 6.5 * 3600e3 }, ON), 2);
    assert.equal(M.windowCapacity({ s: 0, e: 6.4 * 3600e3 }, ON), 1);
    assert.equal(M.windowCapacity({ s: 0, e: 2 * 3600e3 }, ON), 0);
});

test('Madrid: el cambio de horario de octubre mueve la hora UTC de apertura', () => {
    const tz = 'Europe/Madrid';
    const now = Date.parse('2026-10-19T00:00:00Z');
    const r = M.computeDays({ tz, now, settings: ON, availability: WEEKDAYS, from: now, to: now + 9 * 864e5 });
    assert.equal(day(r, '2026-10-23').slots[0].start, '2026-10-23T08:00:00.000Z', 'viernes en CEST (+2)');
    assert.equal(day(r, '2026-10-26').slots[0].start, '2026-10-26T09:00:00.000Z', 'lunes en CET (+1)');
    assert.equal(M.wallToUtc('2026-03-29', 10 * 60, tz), Date.parse('2026-03-29T08:00:00Z'), 'día del cambio de primavera');
});

test('Ciudad de México (sin DST desde 2022): misma hora UTC en julio y noviembre', () => {
    const tz = 'America/Mexico_City';
    assert.equal(M.wallToUtc('2026-07-06', 600, tz), Date.parse('2026-07-06T16:00:00Z'));
    assert.equal(M.wallToUtc('2026-11-23', 600, tz), Date.parse('2026-11-23T16:00:00Z'));
});

test('vacaciones y viajes confirmados tapan el día; un destino Travel con horario propio no', () => {
    const fullMonday = { start: '2026-11-23T03:00:00Z', end: '2026-11-24T03:00:00Z' };
    const vac = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability: WEEKDAYS, busy: [Object.assign({ kind: 'vacation' }, fullMonday)], to: SAT_NOON_AR + 4 * 864e5 });
    assert.equal(day(vac, '2026-11-23').slots.length, 0);
    assert.ok(day(vac, '2026-11-24').slots.length > 0, 'el martes sigue libre (sin margen extra de días completos)');

    const base = { id: 'base', period_type: 'current', sort_order: 0, agenda_status: 'open' };
    const travel = { id: 'trv', period_type: 'upcoming', start_date: '2026-11-23', end_date: '2026-11-24', agenda_status: 'open' };
    const availability = { weekly: AV.defaultWeekly(), locations: { trv: { weekly: AV.defaultWeekly().map((r) => Object.assign({}, r, { enabled: r.day === 'lunes', start: '12:00', end: '18:00' })) } } };
    const trip = [Object.assign({ kind: 'trip' }, fullMonday)];
    const onlyBase = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability, locations: [base], busy: trip, to: SAT_NOON_AR + 4 * 864e5 });
    assert.equal(day(onlyBase, '2026-11-23').slots.length, 0, 'viaje confirmado sin destino Travel: sin turnos');
    const withTravel = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability, locations: [base, travel], busy: trip, to: SAT_NOON_AR + 4 * 864e5 });
    assert.deepEqual(day(withTravel, '2026-11-23').slots.map((s) => M.zonedTime(s.start, AR)), ['12:00', '13:00', '14:00', '15:00']);
    assert.equal(day(withTravel, '2026-11-24').slots.length, 0, 'el destino solo abre los lunes');
    assert.ok(day(withTravel, '2026-11-25').slots.length > 0, 'fuera del destino vuelve el horario base');

    const closed = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability, locations: [base, Object.assign({}, travel, { agenda_status: 'closed' })], to: SAT_NOON_AR + 4 * 864e5 });
    assert.equal(day(closed, '2026-11-23').slots.length, 0, 'ubicación pausada: sin turnos');
});

test('un apartado pendiente no se ofrece a otros (con margen)', () => {
    const hold = [{ start: '2026-11-23T19:00:00Z', end: '2026-11-23T22:00:00Z', kind: 'hold' }]; // 16–19 h local
    const r = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability: WEEKDAYS, busy: hold, to: SAT_NOON_AR + 3 * 864e5 });
    assert.deepEqual(day(r, '2026-11-23').slots.map((s) => M.zonedTime(s.start, AR)), ['10:00', '11:00', '12:00']);
});

test('anticipación mínima y horizonte', () => {
    const mondayNine = Date.parse('2026-11-23T12:00:00Z');
    const r = M.computeDays({ tz: AR, now: mondayNine, settings: ON, availability: WEEKDAYS, to: mondayNine + 3 * 864e5 });
    assert.equal(day(r, '2026-11-23').slots.length, 0, 'hoy con 24 h de anticipación: nada');
    assert.equal(day(r, '2026-11-24').slots[0].start, '2026-11-24T13:00:00.000Z', 'mañana desde la apertura');
    const short = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: { enabled: true, horizon_days: 7 }, availability: WEEKDAYS, to: SAT_NOON_AR + 20 * 864e5 });
    assert.ok(day(short, '2026-11-27').slots.length > 0);
    assert.equal(day(short, '2026-12-01').slots.length, 0, 'fuera del horizonte');
});

test('resumen: semana, mes, 3 meses y año con capacidad real y próximo turno', () => {
    const r = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability: WEEKDAYS, to: SAT_NOON_AR + 366 * 864e5 });
    const s = M.summarize({ days: r.days, now: SAT_NOON_AR, tz: AR, settings: ON });
    assert.deepEqual(s.week, { turnos: 0, horasLibres: 0 }, 'lo que queda de la semana es fin de semana');
    assert.deepEqual(s.month, { turnos: 12, horasLibres: 54 }, '6 días hábiles × 2 turnos');
    assert.ok(s.next3Months.turnos > s.month.turnos);
    assert.ok(s.year.turnos > s.next3Months.turnos);
    assert.equal(s.nextSlot.start, '2026-11-23T13:00:00.000Z');
});

test('isOffered, etiquetas y vista pública sin datos de eventos', () => {
    const r = M.computeDays({ tz: AR, now: SAT_NOON_AR, settings: ON, availability: WEEKDAYS, to: SAT_NOON_AR + 3 * 864e5 });
    assert.equal(M.isOffered(r.days, '2026-11-23T13:00:00Z', 180, ON), true);
    assert.equal(M.isOffered(r.days, '2026-11-23T13:00:00Z', 120, ON), false, 'otra duración');
    assert.equal(M.isOffered(r.days, '2026-11-23T13:30:00Z', 180, ON), false, 'fuera del paso');
    assert.equal(M.slotLabel('2026-11-23T13:00:00Z', AR, '2026-11-23T16:00:00Z'), 'lun 23 nov 2026 · 10:00–13:00');
    const pub = M.publicDays(r.days, AR);
    assert.deepEqual(Object.keys(pub[0]).sort(), ['date', 'slots']);
    assert.deepEqual(Object.keys(pub[0].slots[0]).sort(), ['end', 'label', 'start']);
    assert.deepEqual(M.dayCounts(r.days)[0], { date: '2026-11-23', count: 7 });
});

test('validación de reglas: mismos rangos que los CHECK de la base', () => {
    const ok = M.validateSettings({ enabled: true });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value, { enabled: true, slot_minutes: 180, slot_step_minutes: 60, buffer_minutes: 30, min_notice_hours: 24, horizon_days: 365, hold_hours: 72, public_note: null });
    const bad = M.validateSettings({ slot_minutes: 10, slot_step_minutes: 45, hold_hours: 0, public_note: 'x'.repeat(281) });
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['hold_hours', 'public_note', 'slot_minutes', 'slot_step_minutes']);
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261115160000_turnos_reservas_online.sql'), 'utf8');
    assert.match(migration, /slot_minutes between 30 and 720/);
    assert.match(migration, /slot_step_minutes in \(15, 30, 60, 90, 120, 180, 240\)/);
    assert.match(migration, /hold_hours integer not null default 72/);
});

/* ------------------------------ servidor ------------------------------ */

function fakeRepo(overrides = {}) {
    return Object.assign({
        getSettings: async () => ({ enabled: true }),
        getPrefs: async () => ({ availability: WEEKDAYS, timezone: AR }),
        listLocations: async () => [],
        listBlocking: async () => [],
    }, overrides);
}

function fakeRes() {
    return {
        statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test('servicio: valida el turno pedido contra lo ofrecido, sin caché', async () => {
    let busy = [];
    const service = createBookingService({ repo: fakeRepo({ listBlocking: async () => busy }), now: () => SAT_NOON_AR });
    const ok = await service.validateRequestedSlot('a1', { start: '2026-11-23T13:00:00Z', minutes: 180 });
    assert.equal(ok.ok, true);
    busy = [{ starts_at: '2026-11-23T13:00:00Z', ends_at: '2026-11-23T16:00:00Z', kind: 'hold' }];
    const taken = await service.validateRequestedSlot('a1', { start: '2026-11-23T13:00:00Z', minutes: 180 });
    assert.equal(taken.code, 'slot_taken');
    const summary = await service.getSummary('a1');
    assert.ok(summary.summary.month.turnos > 0);
    const off = createBookingService({ repo: fakeRepo({ getSettings: async () => null }), now: () => SAT_NOON_AR });
    assert.equal((await off.validateRequestedSlot('a1', { start: '2026-11-23T13:00:00Z', minutes: 180 })).code, 'booking_disabled');
});

test('intake: solo el envío final con turno crea apartado; los borradores no', () => {
    assert.equal(requestedSlot({ mode: 'draft', requested_slot: { start: '2026-11-23T13:00:00Z', minutes: 180 } }), null);
    assert.equal(requestedSlot({ mode: 'submit' }), null);
    assert.deepEqual(requestedSlot({ mode: 'submit', requested_slot: { start: '2026-11-23T13:00:00Z', minutes: 180 } }), { start: '2026-11-23T13:00:00.000Z', minutes: 180 });
    assert.deepEqual(requestedSlot({ mode: 'submit', requested_slot: { start: 'mañana', minutes: 180 } }), { invalid: true });
});

test('intake: dos clientes, mismo turno → el segundo recibe 409 slot_taken con alternativas', async () => {
    const service = createBookingService({ repo: fakeRepo(), now: () => SAT_NOON_AR });
    const artist = { user_id: 'a1', name: 'Ana', email: 'ana@example.test', username: 'ana.wo' };
    const q = { quote_id: 'QN' + 'a'.repeat(32), client_full_name: 'Cliente' };
    const slot = { start: '2026-11-23T13:00:00.000Z', minutes: 180 };
    const sent = [];
    let calls = 0;
    const repo = {
        saveWithSlot: async () => (++calls === 1
            ? { quote_id: q.quote_id, id: 10, status: 'pending', slot_status: 'held', hold_id: '11111111-1111-4111-8111-111111111111', expires_at: '2026-11-24T15:00:00Z' }
            : { quote_id: q.quote_id, status: 'in_progress', slot_status: 'taken' }),
    };
    const deps = { service, repo, sendEmail: async (...a) => { sent.push(a); return { ok: true }; }, baseUrl: 'https://beta.weotzi.com', log: { warn() {}, error() {} } };
    const first = fakeRes();
    await handleSlotIntake(first, { q, extras: {}, slot, artist }, deps);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.slot.status, 'held');
    assert.equal(first.body.slot.label, 'lun 23 nov 2026 · 10:00–13:00');
    await new Promise((r) => setImmediate(r));
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'booking_slot_requested');
    assert.equal(sent[0][1].artist_email, 'ana@example.test', 'destinatario desde artists_db');
    assert.equal(sent[0][2].idempotencyKey, 'booking_slot_requested:11111111-1111-4111-8111-111111111111');
    const second = fakeRes();
    await handleSlotIntake(second, { q, extras: {}, slot, artist }, deps);
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.code, 'slot_taken');
    assert.ok(Array.isArray(second.body.alternatives) && second.body.alternatives.length > 0);
    assert.ok(second.body.alternatives.every((s) => s.start !== slot.start));
});

test('intake: reintento del mismo envío con el turno ya apartado responde el apartado (idempotente)', async () => {
    const holdBusy = [{ starts_at: '2026-11-23T13:00:00Z', ends_at: '2026-11-23T16:00:00Z', kind: 'hold' }];
    const service = createBookingService({ repo: fakeRepo({ listBlocking: async () => holdBusy }), now: () => SAT_NOON_AR });
    let saved = 0;
    const repo = {
        saveWithSlot: async () => { saved += 1; return {}; },
        findActiveHoldByQuoteId: async () => ({
            quote: { quote_id: 'QN1', quote_status: 'pending' },
            hold: { id: 'h1', starts_at: '2026-11-23T13:00:00+00:00', ends_at: '2026-11-23T16:00:00+00:00', expires_at: '2026-11-26T15:00:00Z' },
        }),
    };
    const res = fakeRes();
    await handleSlotIntake(res, { q: { quote_id: 'QN1' }, extras: {}, slot: { start: '2026-11-23T13:00:00.000Z', minutes: 180 }, artist: { user_id: 'a1' } }, { service, repo, log: { warn() {}, error() {} } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.slot.hold_id, 'h1');
    assert.equal(saved, 0, 'no se vuelve a guardar ni a avisar');
});

test('errores de la base → respuestas legibles', () => {
    assert.equal(mapDbError(new Error('PostgREST POST rpc failed (409): {"code":"23P01","message":"SLOT_TAKEN"}')).status, 409);
    assert.equal(mapDbError(new Error('{"code":"42501","message":"FORBIDDEN"}')).status, 403);
    assert.equal(mapDbError(new Error('{"code":"PGRST202","message":"Could not find the function"}')).status, 503);
    assert.equal(mapDbError(new Error('{"message":"HOLD_RELEASED"}')).code, 'hold_released');
});

test('job de vencimiento: vence, invalida la caché y avisa una vez por apartado', async () => {
    const sent = [];
    const invalidated = [];
    const result = await notify.runHoldExpiryCycle({
        repo: { expireHolds: async () => [
            { hold_id: 'h1', artist_user_id: 'a1', client_email: 'c@example.test', client_full_name: 'C', quote_id: 'QN1', artist_name: 'Ana', artist_username: 'ana.wo', starts_at: '2026-11-23T13:00:00Z', ends_at: '2026-11-23T16:00:00Z', timezone: AR },
            { hold_id: 'h2', artist_user_id: 'a1', client_email: null },
        ] },
        sendEmail: async (...a) => { sent.push(a); return { ok: true }; },
        invalidate: (id) => invalidated.push(id),
        baseUrl: 'https://beta.weotzi.com/',
    });
    assert.deepEqual(result, { expired: 2, notified: 1, failed: 0 });
    assert.equal(sent[0][0], 'booking_slot_hold_expired');
    assert.equal(sent[0][1].slots_url, 'https://beta.weotzi.com/turnos?artist=ana.wo');
    assert.equal(sent[0][2].idempotencyKey, 'booking_slot_hold_expired:h1');
    assert.deepEqual(invalidated, ['a1', 'a1']);
});

test('emails de turnos: server-only, destinatario y render completo', () => {
    assert.deepEqual(Object.keys(events).sort(), ['booking_slot_confirmed', 'booking_slot_hold_expired', 'booking_slot_requested']);
    const p = { artist_email: 'a@x.test', client_email: 'c@x.test', slot_label: 'lun 23 nov 2026 · 10:00–13:00', quotation_url: 'https://x/q', slots_url: 'https://x/t' };
    for (const [id, ev] of Object.entries(events)) {
        assert.equal(ev.serverOnly, true, id);
        assert.ok(ev.recipient(p), id);
        const r = ev.render;
        assert.ok(['artist', 'client'].includes(r.audience));
        assert.equal(r.category, 'calendar');
        for (const k of ['subject', 'preheader', 'headline', 'intro']) assert.equal(typeof r[k](p), 'string', `${id}.${k}`);
        assert.ok(Array.isArray(r.rows(p)) && r.rows(p).every((row) => row.length === 2));
        assert.ok(r.cta(p) && r.cta(p).url);
    }
    assert.equal(events.booking_slot_requested.recipient(p), 'a@x.test');
    assert.equal(events.booking_slot_confirmed.recipient(p), 'c@x.test');
});

test('alternativas cercanas y fuente de Google Calendar para apartados', () => {
    const days = [{ slots: [{ start: '2026-11-23T13:00:00Z' }, { start: '2026-11-23T14:00:00Z' }, { start: '2026-11-24T13:00:00Z' }] }];
    assert.deepEqual(alternativesFrom(days, '2026-11-23T13:00:00Z', 2).map((s) => s.start), ['2026-11-23T14:00:00Z', '2026-11-24T13:00:00Z']);
    const src = normalizeHoldSource({ id: 'h1', status: 'pending', quotation_id: 9, starts_at: '2099-01-01T13:00:00Z', ends_at: '2099-01-01T16:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, { quote_id: 'QN1', client_full_name: 'Cliente' }, 'https://x');
    assert.equal(src.key, 'hold:h1');
    assert.equal(src.tentative, true);
    assert.equal(normalizeHoldSource({ id: 'h2', status: 'confirmed' }), null, 'confirmado: lo publica la sesión');
});

test('migración y reversa: idempotente, con lock por artista y sin escrituras directas a apartados', () => {
    const dir = path.join(__dirname, '../supabase');
    const up = fs.readFileSync(path.join(dir, 'migrations/20261115160000_turnos_reservas_online.sql'), 'utf8');
    const down = fs.readFileSync(path.join(dir, 'rollbacks/20261115160000_turnos_reservas_online.down.sql'), 'utf8');
    assert.match(up, /create table if not exists public\.artist_booking_holds/);
    assert.match(up, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(v_artist::text, 0\)\)/);
    assert.match(up, /for update skip locked/);
    assert.match(up, /revoke all on table public\.artist_booking_holds from anon, authenticated;\s*grant select on table public\.artist_booking_holds to authenticated;/);
    assert.match(up, /grant execute on function public\.save_web_quotation_with_slot\(jsonb, jsonb, jsonb\) to service_role/);
    assert.doesNotMatch(up, /grant execute on function public\.(confirm|release)_artist_slot_hold[^;]*authenticated/);
    assert.match(down, /drop table if exists public\.artist_booking_holds/);
    assert.match(down, /create or replace function public\.prevent_artist_calendar_overlap\(\)/);
    assert.match(down, /create or replace function public\.list_artist_public_busy_days/);
});

test('EMAIL-NEW-02: el CTA del turno confirmado lleva a la cotización del cliente', () => {
    const p = notify.confirmedPayload({ artist: { name: 'Ana' }, quote: { quote_id: 'QN 1', client_full_name: 'C', client_email: 'c@x.test' }, startsAt: '2026-11-23T13:00:00Z', endsAt: '2026-11-23T16:00:00Z', tz: AR, baseUrl: 'https://beta.weotzi.com/' });
    assert.equal(p.quotation_url, 'https://beta.weotzi.com/client/dashboard?quote=QN%201');
    assert.equal(notify.confirmedPayload({ quote: null, startsAt: '2026-11-23T13:00:00Z', endsAt: '2026-11-23T16:00:00Z', tz: AR, baseUrl: 'https://beta.weotzi.com' }).quotation_url, 'https://beta.weotzi.com/client/dashboard');
});
