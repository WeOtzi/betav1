'use strict';

// Ronda 3 · grupo "calendario" (output/figma-v3/reports/funciones-b.md, P1 punto 7):
// solicitud pendiente en el mural, guest spot/convención → Travel, recordatorio
// unificado con aviso, días ocupados para el cotizador, varios días y fin de
// repetición.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const Model = require('../public/shared/js/calendar-model.js');
const Reminders = require('../lib/calendar-reminders.js');
const ReminderModel = require('../public/shared/js/data/reminders-repo.js');

const MIGRATION = 'supabase/migrations/20261112190000_calendar_reminders_busy_days.sql';
const ROLLBACK = 'supabase/rollbacks/20261112190000_calendar_reminders_busy_days.down.sql';

/* ------------------------------ solicitudes ------------------------------ */

test('parsePreferredDate entiende los formatos reales de client_preferred_date', () => {
    assert.deepEqual(Model.parsePreferredDate('2026-09-26'), { start: '2026-09-26', end: '2026-09-26' });
    assert.deepEqual(Model.parsePreferredDate('9 Oct 2026'), { start: '2026-10-09', end: '2026-10-09' });
    assert.deepEqual(Model.parsePreferredDate('01 Ago 2026 a 30 Ago 2026'), { start: '2026-08-01', end: '2026-08-30' });
    assert.deepEqual(Model.parsePreferredDate('12 de noviembre de 2026'), { start: '2026-11-12', end: '2026-11-12' });
    for (const text of ['Lo antes posible', 'Flexible', 'Este mes', 'Sin fecha', 'Flexible durante Junio 2026', '', null, '31 Feb 2026']) {
        assert.equal(Model.parsePreferredDate(text), null, `"${text}" no tiene un día concreto`);
    }
});

test('solicitud pendiente: proyección de solo lectura que abre la cotización', () => {
    const quote = {
        id: 77, quote_id: 'COT-077', quote_status: 'pending', client_full_name: 'Bruno Aquino',
        project_description: 'Mandala en el antebrazo', client_preferred_date: '14 Nov 2026', is_archived: false,
    };
    const event = Model.pendingRequestEvent(quote);
    assert.equal(event.type, 'pending_request');
    assert.equal(event.readonly, true);
    assert.equal(event.allDay, true);
    assert.equal(event.href, '/my-quotations/detail?id=COT-077');
    assert.equal(event.title, 'Bruno Aquino — Mandala en el antebrazo');
    assert.equal(Model.isoDate(new Date(event.start)), '2026-11-14');
    assert.equal(Model.isoDate(new Date(event.end)), '2026-11-15');

    assert.equal(Model.pendingRequestEvent({ ...quote, quote_status: 'in_progress' }), null);
    assert.equal(Model.pendingRequestEvent({ ...quote, is_archived: true }), null);
    assert.equal(Model.pendingRequestEvent({ ...quote, client_preferred_date: 'Flexible' }), null);

    // Rango largo → solo el primer día (no tapa el mes entero).
    const long = Model.pendingRequestEvent({ ...quote, client_preferred_date: '01 Dic 2026 a 30 Dic 2026' });
    assert.equal(Model.isoDate(new Date(long.end)), '2026-12-02');
    assert.match(long.notes, /1 dic al 30 dic/);

    const list = Model.pendingRequestEvents([quote, { ...quote, id: 78, client_preferred_date: '2027-03-01' }],
        new Date(2026, 10, 1), new Date(2026, 11, 1));
    assert.deepEqual(list.map((e) => e.sourceId), ['77']);
});

/* ------------------------------ recordatorios ------------------------------ */

test('recordatorio con hora: ocurrencias semanales con fin y aviso a la hora', () => {
    const base = new Date(2026, 10, 2, 9, 30); // lunes 2 nov 09:30
    const weekly = { id: 'r1', due_at: base.toISOString(), recurrence_rule: 'weekly', recurrence_until: '2026-11-20', completed_at: null };
    const occ = Model.reminderOccurrences(weekly, new Date(2026, 10, 1), new Date(2026, 11, 31));
    assert.deepEqual(occ.map((d) => Model.isoDate(d)), ['2026-11-02', '2026-11-09', '2026-11-16']);
    assert.equal(Model.reminderOccurrences({ due_date: '2026-11-02' }, new Date(2026, 10, 1), new Date(2026, 11, 1)), null,
        'sin due_at es un recordatorio de solo fecha');

    const now = new Date(2026, 10, 9, 9, 45);
    assert.equal(Model.currentReminderOccurrence(weekly, now).getTime(), new Date(2026, 10, 9, 9, 30).getTime());
    assert.equal(Model.nextReminderOccurrence(weekly, now).getTime(), new Date(2026, 10, 16, 9, 30).getTime());
    assert.equal(Model.nextReminderOccurrence(weekly, new Date(2026, 10, 17)), null, 'después del fin no hay próxima');
    assert.equal(Model.currentReminderOccurrence({ ...weekly, completed_at: '2026-11-03' }, now), null);

    const alerts = Model.dueReminderAlerts([weekly, { id: 'r2', due_at: new Date(2026, 10, 9, 12).toISOString() }], now);
    assert.deepEqual(alerts.map((a) => a.reminder.id), ['r1'], 'solo avisa lo que ya llegó a su hora');
    assert.deepEqual(Model.dueReminderAlerts([weekly], new Date(2026, 10, 11, 10)), [], 'fuera de la ventana de 24 h');
});

test('reminders-repo acepta hora y repetición solo cuando vienen (dashboard sin migración)', () => {
    const plain = ReminderModel.toRow({ title: 'Pedir tinta', due_date: '2026-11-12' });
    assert.ok(!('due_at' in plain) && !('recurrence_rule' in plain), 'el dashboard no manda columnas nuevas');
    const timed = ReminderModel.toRow({
        title: 'Pedir tinta', due_date: '2026-11-12', due_at: '2026-11-12T13:30:00.000Z',
        recurrence_rule: 'weekly', recurrence_until: '2026-12-31',
    });
    assert.equal(timed.due_at, '2026-11-12T13:30:00.000Z');
    assert.equal(timed.recurrence_rule, 'weekly');
    assert.equal(timed.recurrence_until, '2026-12-31');
    assert.throws(() => ReminderModel.toRow({ title: 'x', due_at: 'mañana' }), /hora válida/);
    const row = ReminderModel.normalize({ id: 'a', title: 'x', due_at: '2026-11-12T13:30:00Z', recurrence_rule: 'weekly' });
    assert.equal(row.recurrence_rule, 'weekly');
    assert.equal(row.due_at, '2026-11-12T13:30:00.000Z');
});

test('email del recordatorio: payload, idempotencia y despacho con dependencias inyectadas', async () => {
    const row = {
        reminder_id: 'rem-1', artist_user_id: 'u1', title: 'Pedir cartuchos', detail: '3RL',
        occurrence_at: '2026-11-12T13:30:00.000Z', artist_email: 'artista@example.test',
        artist_name: 'Lu', artist_timezone: 'America/Argentina/Buenos_Aires',
    };
    const payload = Reminders.buildReminderEmailPayload(row, { baseUrl: 'https://weotzi.com/beta/' });
    assert.equal(payload.reminder_title, 'Pedir cartuchos');
    assert.match(payload.reminder_when, /12 de noviembre, 10:30/);
    assert.equal(payload.dashboard_url, 'https://weotzi.com/beta/calendar?view=day&date=2026-11-12&event=reminder%3Arem-1');
    assert.equal(Reminders.reminderIdempotencyKey(row), 'artist_calendar_reminder:rem-1:2026-11-12T13:30:00.000Z');
    assert.equal(Reminders.validTimezone('Marte/Olympus'), 'America/Argentina/Buenos_Aires');

    const sent = [];
    const summary = await Reminders.dispatchDueReminders({
        claim: async (limit) => { assert.equal(limit, 10); return [row, { ...row, reminder_id: 'rem-2', artist_email: null }, { ...row, reminder_id: 'rem-3' }]; },
        send: async (eventId, body, options) => {
            sent.push([eventId, body.reminder_title, options.idempotencyKey]);
            if (sent.length === 2) throw new Error('n8n caído');
            return { ok: true };
        },
        limit: 10,
        log: { warn() {} },
    });
    assert.deepEqual(summary, { claimed: 3, sent: 1, skipped: 1, failed: 1 });
    assert.equal(sent[0][0], 'artist_calendar_reminder');

    assert.equal(Reminders.intervalFromEnv({}), 0, 'sin configuración no corre nada');
    assert.equal(Reminders.intervalFromEnv({ CALENDAR_REMINDERS_INTERVAL_MS: '1000' }), 0, 'mínimo un minuto');
    assert.equal(Reminders.intervalFromEnv({ CALENDAR_REMINDERS_INTERVAL_MS: '300000' }), 300000);
});

test('el evento de email existe, es solo del servidor y respeta la preferencia "calendario"', () => {
    const { EVENTS } = require('../services/email-event-mapping.js');
    const event = EVENTS.artist_calendar_reminder;
    assert.ok(event, 'artist_calendar_reminder mapeado');
    assert.equal(event.templateHint, 'calendar-reminder');
    assert.equal(event.recipient({ artist_email: 'a@b.test' }), 'a@b.test');
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context.js');
    assert.ok(SERVER_ONLY_EVENTS.has('artist_calendar_reminder'), 'no se dispara desde /api/email/:eventId');
    assert.match(read('lib/notification-prefs.js'), /artist_calendar_reminder:\s*'calendario'/);
    for (const file of ['templates/email/calendar-reminder.html', 'templates/email/calendar-reminder.min.html', 'templates/email/billionmail/calendar-reminder.html']) {
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} generado`);
    }
});

test('server.js: dispatch con token de cron y sin intervalo por defecto', () => {
    const server = read('server.js');
    assert.match(server, /\/\/ ── calendario ──/);
    assert.match(server, /app\.post\('\/api\/calendar\/reminders\/dispatch'/);
    assert.match(server, /safeTokenEqual\(req\.headers\['x-cron-token'\], expected\)/);
    assert.match(server, /intervalFromEnv\(process\.env\)/);
});

/* ---------------------------- días ocupados ---------------------------- */

test('días ocupados: índice y estado para el selector del cotizador', () => {
    const index = Model.busyDaysIndex([
        { busy_date: '2026-11-20', busy_status: 'unavailable' },
        { busy_date: '2026-11-25', busy_status: 'full' },
        { busy_date: '2026-11-17', busy_status: 'available' },
        { busy_date: 'basura', busy_status: 'unavailable' },
        { busy_date: '2026-11-18', busy_status: 'secreto' },
    ]);
    assert.deepEqual(index, { '2026-11-20': 'unavailable', '2026-11-25': 'full', '2026-11-17': 'available' });
    assert.equal(Model.dayAvailability(index, '2026-11-20').selectable, false);
    assert.equal(Model.dayAvailability(index, '2026-11-25').label, 'Agenda completa ese día');
    assert.equal(Model.dayAvailability(index, '2026-11-17').selectable, true);
    assert.deepEqual(Model.dayAvailability(index, '2026-11-19'), { status: 'unknown', selectable: true, label: '' });
    assert.deepEqual(Model.monthRange(2026, 1), { from: '2026-02-01', to: '2026-02-28' });
});

test('el cotizador carga la agenda pública y bloquea los días sin agenda', () => {
    const html = read('public/quotation/index.html');
    const model = html.indexOf('/shared/js/calendar-model.js');
    const repo = html.indexOf('/shared/js/data/calendar-public-repo.js');
    assert.ok(model > html.indexOf('postgrest-client.js') && repo > model && repo < html.indexOf('/shared/js/script.js'));
    const script = read('public/shared/js/script.js');
    assert.match(script, /WeotziData\.CalendarPublic/);
    assert.match(script, /dayAvailability\(busyIndex, iso\)/);
    assert.match(read('public/shared/js/data/calendar-public-repo.js'), /rpc\('list_artist_public_busy_days'/);
});

/* -------------------------------- Travel -------------------------------- */

test('guest spot / convención → argumentos de create_artist_trip', () => {
    const guest = Model.tripPayloadFromEvent({
        type: 'guest_spot', name: 'Guest en Fierro Negro', city: ' Rosario ', country: 'Argentina',
        startDate: '2026-11-20', endDate: '2026-11-22', notes: 'Dos días',
    });
    assert.deepEqual(guest, {
        city: 'Rosario', country: 'Argentina', region: null, start_date: '2026-11-20', end_date: '2026-11-22',
        trip_type: 'guest_spot', studio_name_hint: 'Fierro Negro', personal_notes: 'Dos días', event_name: null,
    });
    const convention = Model.tripPayloadFromEvent({ type: 'convention', name: 'Feria Tinta', city: 'CABA', country: 'Argentina', startDate: '2026-12-01' });
    assert.equal(convention.trip_type, 'convencion');
    assert.equal(convention.event_name, 'Feria Tinta');
    assert.equal(convention.end_date, '2026-12-01');
    assert.throws(() => Model.tripPayloadFromEvent({ type: 'guest_spot', city: '', country: 'AR', startDate: '2026-11-20' }), /ciudad y país/);
    assert.throws(() => Model.tripPayloadFromEvent({ type: 'guest_spot', city: 'X', country: 'Y', startDate: '2026-11-20', endDate: '2026-11-19' }), /fecha de fin/);
});

test('varios días: fin exclusivo al final del último día', () => {
    const range = Model.allDayRange('2026-11-20', '2026-11-23');
    assert.equal(range.days, 4);
    assert.equal(Model.isoDate(range.end), '2026-11-24');
    assert.equal(Model.allDayRange('2026-11-20', '2026-11-01').days, 1, 'fin anterior → un solo día');
});

/* ------------------------- repo del calendario ------------------------- */

function loadCalendarRepo(extra = {}) {
    const sandbox = {
        console: { error() {}, warn() {}, log() {} },
        Date, Map, Set, Promise, Number, String, Object, RegExp, Math, Array, JSON, encodeURIComponent,
    };
    sandbox.window = sandbox;
    sandbox.WeotziCalendarModel = Model;
    sandbox.WeotziData = Object.assign({ run: async () => ({ data: [] }) }, extra);
    vm.runInNewContext(read('public/shared/js/data/calendar-repo.js'), sandbox, { filename: 'calendar-repo.js' });
    return sandbox.WeotziData.Calendar;
}

test('calendar-repo: recordatorios editables con hora y solicitudes pendientes en el mural', async () => {
    const Calendar = loadCalendarRepo();
    const events = Calendar._internal.remindersToEvents([
        { id: 'r1', title: 'Pedir tinta', due_date: '2026-11-12', due_at: new Date(2026, 10, 12, 18).toISOString(), recurrence_rule: 'none' },
        { id: 'r2', title: 'Solo fecha', due_date: '2026-11-13' },
        { id: 'r3', title: 'Hecho', due_date: '2026-11-13', completed_at: '2026-11-01' },
    ], new Date(2026, 10, 1), new Date(2026, 11, 1));
    assert.deepEqual(JSON.parse(JSON.stringify(events.map((e) => [e.sourceId, e.allDay, e.readonly]))), [['r1', false, false], ['r2', true, false]]);
    assert.equal(events[0].type, 'reminder');
    assert.equal(new Date(events[0].end) - new Date(events[0].start), 30 * 60000);

    const pending = Calendar._internal.listPendingRequestsProjection([
        { id: 5, quote_id: 'COT-005', quote_status: 'pending', client_full_name: 'Ana', client_preferred_date: '2026-11-15' },
    ], new Date(2026, 10, 1), new Date(2026, 11, 1));
    assert.equal(pending.length, 1);
    assert.equal(pending[0].type, 'pending_request');
});

test('calendar-repo: guest spot a Travel reusa create_artist_trip y guarda el nombre de la convención', async () => {
    const calls = [];
    const Calendar = loadCalendarRepo({
        Travel: {
            async create(payload) { calls.push(['create', payload]); return { id: 'trip-1' }; },
            async update(id, patch) { calls.push(['update', id, patch]); },
        },
    });
    await Calendar.createTripFromEvent({ type: 'convention', name: 'Feria Tinta', city: 'CABA', country: 'Argentina', startDate: '2026-12-01', endDate: '2026-12-03' });
    assert.equal(calls[0][0], 'create');
    assert.equal(calls[0][1].trip_type, 'convencion');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ['update', 'trip-1', { event_name: 'Feria Tinta' }]);
});

test('calendar-repo: sin la migración el recordatorio vuelve a artist_calendar_events', async () => {
    const inserted = [];
    const chain = {
        insert(rows) { inserted.push(rows[0]); return chain; }, select() { return chain; }, single() { return chain; },
    };
    const Calendar = loadCalendarRepo({
        run: async (label, builder) => { builder({ from: () => chain }); return { data: { id: 'legacy-1' } }; },
        Reminders: {
            backend: async () => 'table',
            async create() { const e = new Error("Could not find the 'due_at' column of 'artist_reminders' in the schema cache"); e.code = 'PGRST204'; throw e; },
        },
    });
    const result = await Calendar.saveReminder('u1', null, {
        title: 'Pedir tinta', notes: '', starts_at: '2026-11-12T21:00:00.000Z', ends_at: '2026-11-12T22:00:00.000Z',
        due_date: '2026-11-12', recurrence_rule: 'none', recurrence_until: null,
    });
    assert.equal(result.legacy, true);
    assert.equal(inserted[0].event_type, 'reminder');
});


/* ------------------------------ calendario UI ------------------------------ */

test('editor: fecha de fin, duración, "se repite hasta" y Travel en los formularios', () => {
    const js = read('public/shared/js/calendar.js');
    assert.match(js, /id="event-end-date" name="event-end-date" type="date"/);
    assert.match(js, /id="event-until" name="event-until" type="date"/);
    assert.match(js, /Agregar también a Travel/);
    assert.match(js, /recurrence_until: until \? dateKey\(until\) : null/);
    assert.match(js, /createTripFromEvent\(payload\.travel\)/);
    assert.match(js, /saveReminder\(state\.user\.id/);
    const html = read('public/calendar/index.html');
    assert.ok(html.indexOf('calendar-model.js') > -1 && html.indexOf('calendar-model.js') < html.indexOf('calendar-repo.js'));
    assert.match(read('public/shared/js/wo-artist-menu.js'), /dueReminderAlerts\(timed, new Date\(\)\)/);
});

/* ------------------------------- migración ------------------------------- */

test('migración 20261112190000: aditiva, RLS intacta, RPC pública mínima y claim solo service_role', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /add column if not exists due_at timestamptz/);
    assert.match(sql, /add column if not exists recurrence_until date/);
    assert.match(sql, /add column if not exists last_notified_at timestamptz/);
    assert.match(sql, /create or replace function public\.list_artist_public_busy_days\(/);
    assert.match(sql, /returns table \(busy_date date, busy_status text\)/);
    assert.match(sql, /grant execute on function public\.list_artist_public_busy_days\(uuid, date, date\)\s+to anon, authenticated, service_role/);
    assert.match(sql, /revoke all on function public\.claim_due_artist_reminders\(integer, integer\)\s+from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.claim_due_artist_reminders\(integer, integer\)\s+to service_role/);
    assert.match(sql, /for update of r skip locked/);
    assert.equal((sql.match(/security definer/g) || []).length, 3);
    assert.equal((sql.match(/set search_path = ''/g) || []).length, 4);
    assert.doesNotMatch(sql, /drop table|drop column/i);
    // La RPC pública nunca expone títulos, clientes ni notas.
    const busy = sql.slice(sql.indexOf('list_artist_public_busy_days('));
    assert.doesNotMatch(busy.slice(0, busy.indexOf('$$;')), /\btitle\b|client_name|notes/);
    const down = read(ROLLBACK);
    assert.match(down, /drop function if exists public\.list_artist_public_busy_days/);
    assert.match(down, /drop function if exists public\.claim_due_artist_reminders/);
    assert.match(down, /drop column if exists due_at/);
});
