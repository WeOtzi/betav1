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

test('calendar controller renders all views and wires real CRUD plus conflict preview', () => {
  assert.match(calendarJs, /function renderMonth\(/);
  assert.match(calendarJs, /function renderTimeGrid\(columns\)/);
  assert.match(calendarJs, /function renderAgenda\(/);
  assert.match(calendarJs, /Calendar\.listRange/);
  assert.match(calendarJs, /Calendar\.create/);
  assert.match(calendarJs, /Calendar\.update/);
  assert.match(calendarJs, /Calendar\.remove/);
  assert.match(calendarJs, /Calendar\.checkConflicts/);
  assert.match(calendarJs, /event-recurring/);
  assert.match(calendarJs, /state\.search/);
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
});

test('isainaz calendar seed is scoped, complete and idempotent', () => {
  assert.match(seed, /\[PRUEBA\]\[CALENDAR-ISAINAZ-20260829\]/);
  assert.match(seed, /lower\(username\) = 'isainazartattoo\.wo'/);
  assert.match(seed, /on conflict \(id\) do update/);
  assert.match(seed, /'weekly', date '2026-07-30'/);
  const typeSet = new Set([...seed.matchAll(/'(confirmed_session|pending_request|reservation|blocked_day|availability|guest_spot|convention|reminder|personal)'/g)].map((match) => match[1]));
  assert.equal(typeSet.size, 9);
  assert.match(seed, /Rollback acotado/);
});
