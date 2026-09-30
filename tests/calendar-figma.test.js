const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('public/calendar/index.html');
const css = read('public/shared/css/calendar-figma.css');
const calendarJs = read('public/shared/js/calendar.js');
const repo = read('public/shared/js/data/calendar-repo.js');
const migration = read('supabase/migrations/20260829145232_artist_calendar_events.sql');
const privilegeMigration = read('supabase/migrations/20260830114500_lock_down_artist_calendar_privileges.sql');
const seed = read('supabase/seeds/20260829_isainaz_calendar_demo.sql');

test('calendar keeps the exact Figma view hierarchy and editor categories', () => {
  assert.match(html, /Tu agenda, en un solo mural\./);
  assert.match(html, /Calendario · Gestión profesional/);
  assert.match(html, /data-view="month"[\s\S]*data-view="week"[\s\S]*data-view="day"[\s\S]*data-view="agenda"/);
  assert.match(html, /Buscar evento o cliente…/);
  assert.match(html, /Agregar al calendario/);

  const types = [...html.matchAll(/data-type="([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(types, [
    'confirmed_session', 'reservation', 'availability', 'blocked_day',
    'guest_spot', 'convention', 'reminder', 'personal',
  ]);
  assert.match(html, /Resumen del evento/);
  assert.match(html, /Posible superposición/);
});

test('calendar is mobile-first and contains its own responsive reflow', () => {
  assert.doesNotMatch(css, /@media\s*\(max-width/i);
  assert.match(css, /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 48rem\)/);
  assert.match(css, /@media \(min-width: 64rem\)/);
  assert.match(css, /\.cal-editor-layout\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.cal-agenda-event/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
});

test('calendar expands proportionally beyond the Figma desktop width', () => {
  assert.match(css, /@media \(min-width: 90\.0625rem\)/);
  assert.match(css, /@media \(min-width: 90\.0625rem\)\s*\{\s*\.cal-shell\s*\{\s*max-width:\s*none;/);
  assert.match(css, /\.cal-board\s*\{[\s\S]*container-type:\s*inline-size/);
  assert.match(css, /\.cal-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 49fr\) minmax\(0, 15fr\);\s*gap:\s*3\.030303%/);
  assert.match(css, /\.cal-month-weekday\s*\{[\s\S]*aspect-ratio:\s*5\s*\/\s*1/);
  assert.match(css, /\.cal-month-day\s*\{[\s\S]*aspect-ratio:\s*14\s*\/\s*13;[\s\S]*min-height:\s*0/);
  assert.match(css, /\.cal-time-grid\s*\{[\s\S]*--hour-height:\s*5\.306122cqw/);
  assert.match(css, /\.cal-time-grid\.cal-time-grid--day\s*\{[\s\S]*--hour-height:\s*6\.938776cqw/);
  assert.match(css, /\.cal-editor-shell\s*\{[\s\S]*max-width:\s*none/);
  assert.match(css, /\.cal-editor-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 2\.428fr\) minmax\(0, 1fr\);\s*gap:\s*3\.114877%/);
});

test('calendar controller renders all views and wires real CRUD plus conflict preview', () => {
  assert.match(calendarJs, /function renderMonth\(/);
  assert.match(calendarJs, /function renderTimeGrid\(columns\)/);
  assert.match(calendarJs, /eventsForDay\(date, visible\)\.filter\(\(event\) => !event\.allDay\)/);
  assert.match(calendarJs, /function renderAgenda\(/);
  assert.match(calendarJs, /Calendar\.listRange/);
  assert.match(calendarJs, /Calendar\.create/);
  assert.match(calendarJs, /Calendar\.update/);
  assert.match(calendarJs, /Calendar\.remove/);
  assert.match(calendarJs, /Calendar\.checkConflicts/);
  assert.match(calendarJs, /event-recurring/);
  assert.match(calendarJs, /state\.search/);
  assert.doesNotMatch(calendarJs, /state\.view === 'week' \? mondayOfWeek\(state\.currentDate\) : startOfDay\(state\.currentDate\)/);
});

test('calendar reproduces the Figma desktop geometry and every named editor state', () => {
  assert.match(css, /@media \(min-width: 80rem\)[\s\S]*\.cal-shell\s*\{[\s\S]*max-width:\s*1408px;[\s\S]*padding:\s*44px 44px 110px/);
  assert.match(css, /\.cal-shell\[data-view="week"\],[\s\S]*\.cal-shell\[data-view="day"\][\s\S]*padding-right:\s*64px;\s*padding-left:\s*24px/);
  assert.match(css, /\.cal-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 980px\) minmax\(0, 300px\);\s*gap:\s*40px/);
  assert.match(css, /\.cal-month-day\s*\{\s*min-height:\s*130px/);
  assert.match(css, /\.cal-editor-layout\s*\{\s*grid-template-columns:\s*881\.28px 362\.88px;\s*gap:\s*40px/);
  assert.match(css, /\.cal-type-picker button\s*\{\s*height:\s*65\.6px/);
  assert.match(calendarJs, /class="cal-day-board-title"/);
  assert.match(calendarJs, /columns === 1/);
  assert.match(calendarJs, /timeLabel = isDayView \? `\$\{time\} · \$\{eventType\}`/);
  assert.match(calendarJs, /isDayView && event\.clientName/);
  assert.match(calendarJs, /La reserva ya está confirmada por el cliente/);
  assert.match(calendarJs, /data-wo-icon="calendar"/);
  assert.match(calendarJs, /data-date-display/);
  assert.match(calendarJs, /function timeSelect\(value\)/);
  assert.match(calendarJs, /a\. m\./);
  assert.match(calendarJs, /p\. m\./);
  assert.match(calendarJs, /textInput\('event-client',[\s\S]*'user'\)/);
  assert.match(calendarJs, /textInput\('event-title',[\s\S]*'briefcase'\)/);
  assert.match(calendarJs, /if \(state\.selectedType\) payload = readFormPayload\(\)/);
  assert.doesNotMatch(calendarJs, /function localProjectedConflicts\(payload\)\s*\{\s*if \(!BLOCKING_TYPES/);
  assert.match(css, /\.cal-time-grid\.cal-time-grid--day\s*\{\s*--hour-height:\s*68px;\s*grid-template-rows:/);
});

test('calendar editor heading belongs to the main column while the summary starts beside it', () => {
  assert.match(html, /<div class="cal-editor-layout">\s*<section class="cal-editor-main">\s*<button[^>]+id="editor-back"[\s\S]*?<header class="cal-editor-heading">/);
  assert.match(html, /<\/section>\s*<aside class="cal-editor-aside">/);
});

test('date helpers keep Monday-first navigation and half-open overlap semantics', () => {
  const sandbox = {
    window: {
      location: { pathname: '/calendar', search: '' },
      setTimeout,
      clearTimeout,
    },
    document: { addEventListener() {} },
    console,
    Date,
    Intl,
    URLSearchParams,
    Set,
    Map,
  };
  vm.runInNewContext(calendarJs, sandbox, { filename: 'calendar.js' });
  const api = sandbox.window.WeotziCalendar;
  const monday = api.mondayOfWeek(new Date(2026, 6, 9));
  assert.equal(api.dateKey(monday), '2026-07-06');
  assert.equal(api.dateKey(api.parseLocalDate('2026-07-09')), '2026-07-09');
  assert.equal(api.formatLongDate(new Date(2026, 6, 9)), '9 de julio, 2026');

  const source = { start: '2026-07-09T10:00:00.000Z', end: '2026-07-09T12:00:00.000Z' };
  assert.equal(api.overlaps(source, new Date('2026-07-09T11:00:00.000Z'), new Date('2026-07-09T13:00:00.000Z')), true);
  assert.equal(api.overlaps(source, new Date('2026-07-09T12:00:00.000Z'), new Date('2026-07-09T13:00:00.000Z')), false);
});

test('calendar repository projects sessions and trips without inserting copies', () => {
  assert.match(repo, /sourceType:\s*'quotation_session'/);
  assert.match(repo, /sourceType:\s*'artist_trip'/);
  assert.match(repo, /listSessionsProjection/);
  assert.match(repo, /listTripsProjection/);
  assert.match(repo, /const unique = new Map\(\)/);
  assert.doesNotMatch(repo, /from\(['"]quotation_sessions['"]\)\.insert/);
  assert.doesNotMatch(repo, /from\(['"]artist_trips['"]\)\.insert/);
});

test('calendar migration has explicit grants, owner RLS and server-side overlap protection', () => {
  assert.match(migration, /create table if not exists public\.artist_calendar_events/);
  assert.match(migration, /alter table public\.artist_calendar_events enable row level security/);
  assert.match(migration, /grant select, insert, update, delete on table public\.artist_calendar_events to authenticated/);
  assert.match(migration, /artist_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /with check \(artist_user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /check_artist_calendar_conflicts/);
  assert.match(migration, /trg_prevent_artist_calendar_overlap/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /errcode = '23P01'/);
  assert.match(migration, /revoke execute on function public\.check_artist_calendar_conflicts[\s\S]*from public, anon/);
  assert.match(privilegeMigration, /revoke all on table public\.artist_calendar_events from public, anon, authenticated/);
  assert.match(privilegeMigration, /grant select, insert, update, delete on table public\.artist_calendar_events to authenticated/);
  assert.doesNotMatch(privilegeMigration, /grant[\s\S]*(truncate|trigger|references)/i);
});

test('isainaz calendar seed is scoped, complete and idempotent', () => {
  assert.match(seed, /\[PRUEBA\]\[CALENDAR-ISAINAZ-20260829\]/);
  assert.match(seed, /lower\(username\) = 'isainazartattoo\.wo'/);
  assert.match(seed, /on conflict \(id\) do update/);
  assert.match(seed, /'weekly', date '2026-08-20'/);
  assert.match(seed, /Nueva solicitud — Matías Silva/);
  assert.match(seed, /Nadia Ruiz — seña confirmada/);
  assert.match(seed, /'convention', 'Flash Day'/);
  const typeSet = new Set([...seed.matchAll(/'(confirmed_session|pending_request|reservation|blocked_day|availability|guest_spot|convention|reminder|personal)'/g)].map((match) => match[1]));
  assert.equal(typeSet.size, 9);
  assert.match(seed, /Rollback acotado/);
});
