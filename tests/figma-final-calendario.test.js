// Figma final del flujo de artista (oct 2026) · área calendario.
// Frames 801:542 (mes), 801:544 (semana), 801:545 (día), 801:546 (elegir tipo)
// y 801:547…801:554 (formularios). Cubre los enlaces profundos, el vínculo
// turno ↔ cotización, el repo con degradación sin la migración nueva, las
// fixtures del preview y la migración/rollback no aplicadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const Links = require(path.join(root, 'public/shared/js/calendar-links.js'));

const html = read('public/calendar/index.html');
const calendarJs = read('public/shared/js/calendar.js');
const css = read('public/shared/css/calendar-figma.css');
const repoSource = read('public/shared/js/data/calendar-repo.js');
const migration = read('supabase/migrations/20261028140000_calendar_quote_links.sql');
const rollback = read('supabase/rollbacks/20261028140000_calendar_quote_links.down.sql');

/* ------------------------------ URL / estados ------------------------------ */
test('parseUrlState exposes every Figma state as a capturable URL', () => {
    assert.deepEqual(Links.parseUrlState('?view=week').view, 'week');
    assert.equal(Links.parseUrlState('?view=semana').view, 'week');
    assert.equal(Links.parseUrlState('?view=dia').view, 'day');
    assert.equal(Links.parseUrlState('?view=nada').view, null);
    assert.equal(Links.parseUrlState('?date=2026-07-09').date, '2026-07-09');
    assert.equal(Links.parseUrlState('?date=2026-02-31').date, null);

    const empty = Links.parseUrlState('?new');
    assert.equal(empty.editor, true);
    assert.equal(empty.type, null, '801:546 elige tipo sin preselección');

    const expectations = {
        turno: 'confirmed_session',
        appointment: 'confirmed_session',
        reserva: 'reservation',
        disponibilidad: 'availability',
        bloqueo: 'blocked_day',
        'guest-spot': 'guest_spot',
        convencion: 'convention',
        'convención': 'convention',
        recordatorio: 'reminder',
        personal: 'personal',
    };
    Object.entries(expectations).forEach(([alias, type]) => {
        assert.equal(Links.parseUrlState(`?new=${encodeURIComponent(alias)}`).type, type, alias);
    });

    // Contrato con el detalle de cotización: ?quote=<id>&new=appointment.
    const fromQuote = Links.parseUrlState('?quote=COT-056&new=appointment&date=2026-07-09');
    assert.equal(fromQuote.editor, true);
    assert.equal(fromQuote.type, 'confirmed_session');
    assert.equal(fromQuote.quote, 'COT-056');
    assert.equal(fromQuote.date, '2026-07-09');
    assert.equal(Links.parseUrlState('?quote=990005').type, 'confirmed_session', 'quote sola abre el turno');

    const picker = Links.parseUrlState('?new=turno&picker=open');
    assert.equal(picker.picker, true);
    assert.equal(Links.parseUrlState('?new=turno&picker=0').picker, false);
    assert.equal(Links.parseUrlState('?event=session:abc').event, 'session:abc');
});

test('buildUrlState writes canonical URLs that parse back to the same state', () => {
    assert.equal(Links.buildUrlState({ view: 'month' }), '');
    assert.equal(Links.buildUrlState({ view: 'week', date: '2026-07-06' }), '?view=week&date=2026-07-06');
    assert.equal(Links.buildUrlState({ view: 'month', editor: true }), '?new=tipo');
    const url = Links.buildUrlState({ view: 'day', date: '2026-07-09', editor: true, type: 'confirmed_session', quote: 'COT-056' });
    assert.equal(url, '?view=day&date=2026-07-09&new=turno&quote=COT-056');
    const parsed = Links.parseUrlState(url);
    assert.equal(parsed.type, 'confirmed_session');
    assert.equal(parsed.quote, 'COT-056');
    assert.equal(Links.buildUrlState({ editor: true, event: 'session:1', type: 'confirmed_session' }), '?event=session%3A1');
    for (const type of Links.EDITOR_TYPES) {
        assert.equal(Links.resolveType(Links.TYPE_SLUGS[type]), type);
    }
});

/* ------------------------- cotización a vincular ------------------------- */
const quotes = [
    { id: 56, quote_id: 'COT-056', quote_status: 'client_approved', client_full_name: 'Julieta Sosa', project_description: 'Ola fine line en costilla', final_sessions: 1 },
    { id: 41, quote_id: 'COT-041', quote_status: 'in_progress', client_full_name: 'Camila Ortiz', project_description: 'Retrato realista en pierna', final_sessions: 3, sent_to_artist_at: '2026-06-01T00:00:00Z' },
    { id: 38, quote_id: 'COT-038', quote_status: 'client_approved', client_full_name: 'Diego Palma', project_description: 'Cover-up geométrico en hombro' },
    { id: 58, quote_id: 'COT-058', quote_status: 'pending', client_full_name: 'Marina Ibáñez', tattoo_idea_description: 'Jaguar blackwork en antebrazo' },
    { id: 57, quote_id: 'COT-057', quote_status: 'responded', client_full_name: 'Tomás Reyes', project_description: 'Retrato realista', tattoo_estimated_sessions: 2 },
    { id: 49, quote_id: 'COT-049', quote_status: 'client_rejected', client_full_name: 'Renata Duarte', project_description: 'Golondrina old school' },
    { id: 46, quote_id: 'COT-046', quote_status: 'expired', client_full_name: 'Ezequiel Farías', project_description: 'Cobertura blackwork' },
    { id: 99, quote_id: 'DRAFT-1', quote_status: 'in_progress', client_full_name: 'Borrador del cliente' },
];
const now = new Date(2026, 6, 1, 9, 0);
const sessions = new Map([
    ['56', [{ id: 's1', quotation_id: 56, session_date: new Date(2026, 6, 9, 10).toISOString(), status: 'scheduled' }]],
    ['41', [
        { id: 's2', quotation_id: 41, session_date: new Date(2026, 5, 20, 10).toISOString(), status: 'completed' },
        { id: 's3', quotation_id: 41, session_date: new Date(2026, 6, 14, 12).toISOString(), status: 'scheduled' },
    ]],
    ['38', [
        { id: 's4', quotation_id: 38, session_date: new Date(2026, 6, 23, 10).toISOString(), status: 'scheduled' },
        { id: 's5', quotation_id: 38, session_date: new Date(2026, 6, 25, 10).toISOString(), status: 'cancelled' },
    ]],
]);

test('quotes are grouped exactly like the 801:547 listbox', () => {
    const groups = Links.buildQuoteOptions(quotes, sessions, '', now);
    assert.deepEqual(groups.map((group) => group.label), [
        'Aprobadas y en progreso',
        'Sin aprobar · solo como reserva pendiente',
        'No disponibles para agendar',
    ]);
    const [approved, unapproved, unavailable] = groups;
    assert.deepEqual(approved.options.map((o) => [o.name, o.badge, o.meta]), [
        ['Julieta Sosa', 'Confirmada', 'COT-056 · Sesión 1 de 1 agendada · 9 jul'],
        ['Camila Ortiz', 'En progreso', 'COT-041 · Sesión 2 de 3 agendada · 14 jul'],
        ['Diego Palma', 'Confirmada', 'COT-038 · 1 turno agendado · 23 jul'],
    ]);
    assert.deepEqual(unapproved.options.map((o) => [o.name, o.badge, o.project, o.meta]), [
        ['Marina Ibáñez', 'Pendiente', 'Jaguar blackwork en antebrazo', 'COT-058 · Sin turnos agendados'],
        ['Tomás Reyes', 'Respondida', 'Retrato realista', 'COT-057 · 2 sesiones · ninguna agendada'],
    ]);
    assert.deepEqual(unavailable.options.map((o) => [o.badge, o.meta, o.disabled]), [
        ['Rechazada', 'COT-049 · No se puede agendar: rechazada', true],
        ['Vencida', 'COT-046 · No se puede agendar: vencida', true],
    ]);
    assert.ok(!groups.flatMap((g) => g.options).some((o) => o.code === 'DRAFT-1'), 'borradores in_progress quedan fuera');
    assert.deepEqual(approved.options.map((o) => o.tone), ['confirmed', 'progress', 'confirmed']);
});

test('quote search is accent-insensitive across client, project and code', () => {
    const byAccent = Links.buildQuoteOptions(quotes, sessions, 'ibanez', now).flatMap((g) => g.options);
    assert.deepEqual(byAccent.map((o) => o.code), ['COT-058']);
    const byCode = Links.buildQuoteOptions(quotes, sessions, 'cot-04', now).flatMap((g) => g.options);
    assert.deepEqual(byCode.map((o) => o.code), ['COT-041', 'COT-049', 'COT-046']);
    const byProject = Links.buildQuoteOptions(quotes, sessions, 'geometrico', now).flatMap((g) => g.options);
    assert.deepEqual(byProject.map((o) => o.code), ['COT-038']);
    assert.deepEqual(Links.buildQuoteOptions(quotes, sessions, 'zzz', now), []);
});

test('turno save target: approved → quotation session, unapproved → pending reservation', () => {
    const byCode = Object.fromEntries(quotes.map((q) => [q.quote_id, q]));
    assert.equal(Links.saveTarget('confirmed_session', byCode['COT-056']), 'session');
    assert.equal(Links.saveTarget('confirmed_session', byCode['COT-041']), 'session');
    assert.equal(Links.saveTarget('confirmed_session', byCode['COT-058']), 'reservation');
    assert.equal(Links.saveTarget('confirmed_session', byCode['COT-057']), 'reservation');
    assert.equal(Links.saveTarget('confirmed_session', byCode['COT-049']), 'blocked');
    assert.equal(Links.saveTarget('confirmed_session', null), 'manual');
    assert.equal(Links.saveTarget('personal', byCode['COT-056']), 'manual');
    assert.ok(Links.matchesQuoteParam(byCode['COT-056'], 'COT-056'));
    assert.ok(Links.matchesQuoteParam(byCode['COT-056'], '56'));
    assert.ok(!Links.matchesQuoteParam(byCode['COT-056'], '5'));
    assert.equal(Links.quoteCode({ id: 123456 }), 'COT-3456');
});

/* --------------------------------- página --------------------------------- */
test('calendar page loads its repos in order and uses Feather icons instead of glyphs', () => {
    const order = [
        '/shared/js/config-manager.js',
        '/shared/js/data/postgrest-client.js',
        '/shared/js/data/quotations-repo.js',
        '/shared/js/data/travel-repo.js',
        '/shared/js/data/account-repo.js',
        '/shared/js/data/reminders-repo.js',
        '/shared/js/data/calendar-repo.js',
        '/shared/js/calendar-links.js',
        '/shared/js/calendar.js',
    ].map((src) => html.indexOf(src));
    order.forEach((index) => assert.ok(index > 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    for (const icon of ['plus', 'chevron-left', 'chevron-right', 'search', 'arrow-left', 'arrow-right', 'alert-triangle']) {
        assert.match(html, new RegExp(`data-wo-icon="${icon}"`), icon);
    }
    assert.doesNotMatch(html, /[‹›⌕△＋]/);
});

test('turno form renders the quote combobox, hint and manual-quote link of 801:547', () => {
    assert.match(calendarJs, /Cotización a vincular/);
    assert.match(calendarJs, /Buscá por cliente, proyecto o número de cotización/);
    assert.match(calendarJs, /Elegí una cotización para asociar este turno al cliente y a su proyecto\./);
    assert.match(calendarJs, /¿Todavía no cargaste este trabajo\? <a href="\$\{escapeAttr\(manualQuoteHref\(\)\)\}">Crear cotización manual<\/a>/);
    // La hoja abre como cita con la fecha elegida en el calendario.
    assert.match(calendarJs, /new URLSearchParams\(\{ origen: 'cita', fecha: dateKey\(state\.selectedDate \|\| new Date\(\)\) \}\)/);
    assert.doesNotMatch(calendarJs, /escapeAttr\(appUrl\(MANUAL_QUOTE_PATH\)\)/);
    assert.match(calendarJs, /const MANUAL_QUOTE_PATH = '\/my-quotations\/new'/);
    assert.match(calendarJs, /role="combobox"/);
    assert.match(calendarJs, /role="listbox"/);
    assert.match(calendarJs, /aria-activedescendant/);
    assert.match(calendarJs, /Calendar\.createQuoteSession/);
    assert.match(calendarJs, /Calendar\.updateQuoteSession/);
    assert.match(calendarJs, /Calendar\.removeQuoteSession/);
    assert.match(calendarJs, /parseUrlState\(window\.location\.search\)/);
    assert.match(calendarJs, /window\.history\.replaceState/);
    // Los viajes de Travel se abren en su itinerario (solo lectura).
    assert.match(calendarJs, /window\.location\.href = appUrl\(event\.href\)/);
    assert.match(css, /\.cal-quote-listbox\s*\{[\s\S]*max-height:\s*383\.2px/);
    assert.match(css, /\.cal-quote-option\.is-active,[\s\S]*border-left-color:\s*var\(--yellow-300\);\s*background:\s*var\(--figma-sand\)/);
    assert.match(css, /\.cal-quote-option\[aria-disabled="true"\]\s*\{\s*opacity:\s*var\(--opacity-disabled\)/);
    assert.match(css, /\.cal-date-nav::before/);
    assert.match(css, /\.cal-month-day\.is-outside\s*\{\s*background:\s*var\(--neutral-100\);\s*opacity:\s*var\(--opacity-disabled\)/);
});

/* ---------------------------------- repo ---------------------------------- */
function loadRepo(runImpl, extra = {}) {
    const calls = [];
    const sandbox = {
        console: { error() {}, warn() {}, log() {} },
        Date, Map, Set, Promise, Number, String, Object, RegExp,
        encodeURIComponent,
    };
    sandbox.window = sandbox;
    sandbox.WeotziData = Object.assign({
        run: async (label, builder) => {
            calls.push(label);
            return runImpl(label, builder, calls);
        },
    }, extra);
    vm.runInNewContext(repoSource, sandbox, { filename: 'calendar-repo.js' });
    return { Calendar: sandbox.WeotziData.Calendar, calls };
}

function fakeClient(recorder) {
    const chain = {
        insert(rows) { recorder.push(['insert', rows[0]]); return chain; },
        update(row) { recorder.push(['update', row]); return chain; },
        select() { return chain; },
        single() { return chain; },
        eq() { return chain; },
    };
    return { from() { return chain; } };
}

test('repo retries without quotation_id when the migration is not applied yet', async () => {
    const recorded = [];
    let attempts = 0;
    const { Calendar } = loadRepo(async (label, builder) => {
        builder(fakeClient(recorded));
        attempts += 1;
        if (attempts === 1) {
            const error = new Error("[calendar.create] Could not find the 'quotation_id' column of 'artist_calendar_events' in the schema cache");
            error.code = 'PGRST204';
            throw error;
        }
        return { data: { id: 'row-1' } };
    });
    const row = await Calendar.create('artist-1', {
        event_type: 'reservation', title: 'Marina — reserva', client_name: 'Marina',
        starts_at: '2026-07-10T13:00:00.000Z', ends_at: '2026-07-10T15:00:00.000Z',
        status: 'pending', quotation_id: 58, quote_code: 'COT-058', notes: 'Primera charla',
    });
    assert.equal(row.id, 'row-1');
    assert.equal(recorded.length, 2);
    assert.equal(recorded[0][1].quotation_id, 58);
    assert.ok(!('quotation_id' in recorded[1][1]));
    assert.equal(recorded[1][1].notes, 'Primera charla\nCotización COT-058');
});

test('repo stores turnos of approved quotes as quotation_sessions and degrades without location', async () => {
    const created = [];
    let failOnce = true;
    const Sessions = {
        async create(body) {
            if (failOnce && 'location' in body) {
                failOnce = false;
                const error = new Error("Could not find the 'location' column of 'quotation_sessions' in the schema cache");
                error.code = 'PGRST204';
                throw error;
            }
            created.push(body);
            return { id: 'session-9', ...body };
        },
        async update() {},
        async delete() {},
    };
    const { Calendar } = loadRepo(async () => ({ data: null }), { Sessions });
    const session = await Calendar.createQuoteSession({
        quotation_id: '56', starts_at: '2026-07-09T13:00:00.000Z', ends_at: '2026-07-09T16:00:00.000Z',
        location: 'Estudio propio', notes: '  Traer referencia  ',
    });
    assert.equal(session.id, 'session-9');
    assert.equal(created.length, 1);
    assert.deepEqual({ ...created[0] }, {
        quotation_id: 56, session_date: '2026-07-09T13:00:00.000Z', duration_hours: 3,
        notes: 'Traer referencia', session_number: null, status: 'scheduled',
    });

    const internal = Calendar._internal;
    const event = internal.normalizeSession(
        { id: 's1', quotation_id: 56, session_date: '2026-07-09T13:00:00.000Z', duration_hours: 3, status: 'rescheduled', location: 'A domicilio' },
        { id: 56, quote_id: 'COT-056', client_full_name: 'Julieta Sosa' }
    );
    assert.equal(event.title, 'Sesión — Julieta Sosa');
    assert.equal(event.type, 'confirmed_session');
    assert.equal(event.readonly, false, 'las sesiones se editan desde el calendario');
    assert.equal(event.location, 'A domicilio');
    assert.equal(event.quoteCode, 'COT-056');

    const trip = internal.normalizeTrip({ id: 't1', start_date: '2026-07-13', end_date: '2026-07-14', trip_type: 'guest_spot', status: 'confirmado', studio_name_hint: 'Fierro Negro Tattoo', city: 'Rosario', country: 'Argentina' });
    assert.equal(trip.readonly, true);
    assert.equal(trip.href, '/artist/travel?trip=t1');
    assert.equal(trip.title, 'Guest en Fierro Negro Tattoo');

    const reminder = internal.normalizeDashboardReminder({ id: 'r1', title: 'Pedir tinta', due_date: '2026-07-15', completed_at: null });
    assert.equal(reminder.type, 'reminder');
    assert.equal(reminder.href, '/artist/dashboard?modal=recordatorio&id=r1');
    assert.equal(internal.normalizeDashboardReminder({ id: 'r2', title: 'Hecho', due_date: '2026-07-15', completed_at: '2026-07-01' }), null);

    assert.ok(internal.isMissingColumn({ code: '42703', message: 'column "location" does not exist' }, 'location'));
    assert.ok(!internal.isMissingColumn({ code: '23P01', message: 'CALENDAR_OVERLAP' }, 'location'));
});

/* -------------------------------- fixtures -------------------------------- */
test('preview fixtures fill the mural with every manual event type and a quote-linked reservation', () => {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.runInNewContext(read('public/shared/js/demo-fixtures/calendario.js'), sandbox);
    const ctx = {
        tables: {
            artist_calendar_events: [],
            quotations_db: [{ id: 990001, quote_id: 'DEMO-P01', quote_status: 'pending', client_full_name: 'Camila Soto' }],
        },
        TABLES: ['quotations_db', 'artist_calendar_events'],
        identity: { userId: 'artist-1' },
        helpers: { DAY: 86400000 },
    };
    sandbox.WoDemoFixtureExtensions.calendario(ctx);
    const rows = ctx.tables.artist_calendar_events;
    const types = new Set(rows.map((row) => row.event_type));
    for (const type of ['blocked_day', 'availability', 'reminder', 'pending_request', 'guest_spot', 'convention', 'reservation']) {
        assert.ok(types.has(type), type);
    }
    assert.ok(rows.every((row) => row.artist_user_id === 'artist-1' && Date.parse(row.ends_at) > Date.parse(row.starts_at)));
    const linked = rows.find((row) => row.quotation_id === 990001);
    assert.equal(linked.event_type, 'reservation');
    assert.equal(linked.status, 'pending');
    assert.ok(rows.some((row) => row.recurrence_rule === 'weekly'));
    // Idempotente: aplicar dos veces no duplica filas.
    sandbox.WoDemoFixtureExtensions.calendario(ctx);
    assert.equal(ctx.tables.artist_calendar_events.length, rows.length);
});

/* ------------------------------ migración ------------------------------ */
test('quote-link migration is additive, idempotent, owner-scoped and reversible', () => {
    assert.match(migration, /alter table public\.artist_calendar_events\s+add column if not exists quotation_id integer/);
    assert.match(migration, /references public\.quotations_db \(id\) on delete set null/);
    assert.match(migration, /create index if not exists idx_artist_calendar_events_quotation/);
    assert.match(migration, /alter table public\.quotation_sessions\s+add column if not exists location text/);
    assert.match(migration, /q\.artist_id::text = \(select auth\.uid\(\)\)::text/);
    assert.equal((migration.match(/drop policy if exists/g) || []).length, 2);
    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
    assert.match(rollback, /drop column if exists quotation_id/);
    assert.match(rollback, /drop column if exists location/);
    assert.match(rollback, /with check \(artist_user_id = \(select auth\.uid\(\)\)\);/);
    assert.match(rollback, /'Cotización ' \|\| coalesce\(q\.quote_id/);
});

/* --------------------- correcciones de la auditoría (ronda 1) --------------------- */
function loadCalendarApi(pathname = '/calendar') {
    const sandbox = {
        window: { location: { pathname, search: '' }, setTimeout, clearTimeout },
        document: { addEventListener() {} },
        console, Date, Intl, URLSearchParams, Set, Map, encodeURIComponent,
    };
    vm.runInNewContext(calendarJs, sandbox, { filename: 'calendar.js' });
    return sandbox.window.WeotziCalendar;
}

test('month cell counts every hidden event (+N) and agenda groups ongoing events on the first visible day', () => {
    const api = loadCalendarApi();
    // 28/10 del preview: 1 recordatorio de todo el día + 4 sesiones → 3 barras y "+2".
    assert.equal(api.hiddenEventCount(5), 2);
    assert.equal(api.hiddenEventCount(4), 1);
    assert.equal(api.hiddenEventCount(3), 0);
    assert.equal(api.hiddenEventCount(0), 0);
    assert.match(calendarJs, /const dayEvents = eventsForDay\(date\);/);
    assert.doesNotMatch(calendarJs, /eventsForDay\(date\)\.slice\(0, 4\)/);

    // Guest spot que empezó el 26/9: en la agenda de octubre va bajo el 1/10.
    const from = new Date(2026, 9, 1);
    assert.equal(api.dateKey(api.agendaGroupDate(new Date(2026, 8, 26, 10).toISOString(), from)), '2026-10-01');
    assert.equal(api.dateKey(api.agendaGroupDate(new Date(2026, 9, 7, 11).toISOString(), from)), '2026-10-07');
    assert.equal(api.capitalize('sábado, 26 de septiembre'), 'Sábado, 26 de septiembre');
});

test('calendar redirects to the canonical artist login and has no account-specific start date', () => {
    const api = loadCalendarApi();
    assert.equal(api.buildArtistLoginUrl('/calendar'), '/artist/login?returnTo=%2Fcalendar');
    assert.equal(loadCalendarApi('/beta/calendar').buildArtistLoginUrl('/calendar'), '/beta/artist/login?returnTo=%2Fcalendar');
    assert.doesNotMatch(calendarJs, /registerclosedbeta/);
    assert.doesNotMatch(calendarJs, /isainazartattoo/);
});

test('all-day events get their own row in week/day instead of covering the 09:00 slot', () => {
    assert.match(calendarJs, /class="cal-time-allday-label">Todo el día</);
    assert.match(calendarJs, /hasAllDay \? ' has-allday' : ''/);
    assert.doesNotMatch(css, /\.cal-time-allday\s*\{[^}]*position:\s*absolute/);
    assert.match(css, /\.cal-time-grid\.has-allday\s*\{\s*grid-template-rows:\s*var\(--time-head-row\) auto calc\(var\(--hour-height\) \* 12\)/);
    assert.match(css, /\.cal-time-grid\.cal-time-grid--day\.has-allday\s*\{\s*grid-template-rows:\s*auto calc\(var\(--hour-height\) \* 12\)/);
    assert.match(css, /\.cal-time-allday \.cal-event\s*\{[^}]*display:\s*block;[^}]*text-overflow:\s*ellipsis/);
});

test('audit fixes keep the Figma details of 801:542…554', () => {
    // Página: sin ocultar la barra de scroll; fondo arena de borde a borde en el editor.
    assert.doesNotMatch(css, /scrollbar-width:\s*none/);
    assert.match(css, /body\.cal-app:has\(#calendar-editor:not\(\[hidden\]\)\)\s*\{\s*background:\s*var\(--neutral-100\)/);
    // Hoy: número en tinta + barra amarilla de 2,4 px.
    assert.doesNotMatch(css, /is-today \.cal-day-number\s*\{[^}]*blue/);
    assert.match(css, /\.cal-month-day\.is-today \.cal-day-number::before\s*\{[^}]*height:\s*2\.4px;[^}]*background:\s*var\(--yellow-300\)/);
    // Columna de horas con separador tinta de 1,6 px; "Nuevo evento" con tracking 1,12 px.
    assert.match(css, /\.cal-time-hours\s*\{\s*border-right:\s*1\.6px solid var\(--ink\)/);
    assert.match(css, /\.cal-new-event\s*\{[^}]*color:\s*var\(--neutral-100\);[^}]*letter-spacing:\s*1\.12px/);
    // Minicalendario: las semanas reparten la caja de 326 px.
    assert.match(css, /\.cal-mini-calendar\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;\s*height:\s*326px/);
    assert.match(css, /\.cal-mini-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(0, 1fr\)/);
    assert.doesNotMatch(css, /\.cal-mini-grid button\s*\{\s*min-height:\s*35px/);
    // Formulario: resumen claro, fecha 14 px con ícono tinta, bordes de 1 px, sin resize, superposición de 83 px.
    assert.match(css, /\.cal-event-summary h2\s*\{[^}]*color:\s*var\(--neutral-300\)/);
    assert.match(css, /\.cal-date-control button\s*\{[^}]*font-size:\s*14px/);
    assert.match(css, /\.cal-date-control > i\s*\{\s*color:\s*var\(--ink\)/);
    assert.match(css, /\.cal-form-actions \.wo-btn\s*\{[^}]*border-width:\s*1px/);
    assert.match(css, /\.cal-field textarea\s*\{\s*min-height:\s*100px;[^}]*resize:\s*none/);
    assert.match(css, /\.cal-conflict\s*\{\s*min-height:\s*83px/);
    assert.match(css, /\.cal-quote-label em\s*\{\s*color:\s*inherit/);
    // 801:547 cerrado: sin ayuda genérica ni acceso fijo a "Crear cotización manual".
    assert.match(calendarJs, /<p class="cal-quote-hint" id="quote-hint" hidden>/);
    assert.match(calendarJs, /<p class="cal-quote-create" hidden>/);
    assert.match(calendarJs, /hint\.hidden = !isVisibleQuoteNotice\(text, tone\)/);
    assert.match(calendarJs, /<p class="cal-quote-empty">\$\{escapeHtml\(message\)\}\$\{errorHasLink \? '' : ` \$\{manualQuoteLink\(\)\}`\}<\/p>/);
    // Guardar sin cotización con una búsqueda vacía: el link queda solo en el aviso de error.
    assert.match(calendarJs, /updateQuoteCreate\(\);\s*renderQuoteListbox\(\);\s*document\.getElementById\('event-quote-search'\)\?\.focus\(\);/);
});

/* ------------------------------ ronda 2 de auditoría ------------------------------ */
test('short timed blocks pick a layout that fits instead of clipping the title (801:544/545)', () => {
    const api = loadCalendarApi();
    const week = { padding: 8, timeLine: 11, titleGap: 1, titleLine: 13 };
    const day = { padding: 16, timeLine: 12, titleGap: 2, titleLine: 17, clientLine: 13 };
    // Semana 1440: 30 min = 26,4 px → una sola línea "09:30 Título…".
    assert.deepEqual({ ...api.timedEventLayout({ ...week, height: 26.4 }) }, { compact: true, titleLines: 1, showClient: false });
    // 45 min = 39,6 px → hora + una línea de título (antes cortaba la segunda).
    assert.deepEqual({ ...api.timedEventLayout({ ...week, height: 39.6 }) }, { compact: false, titleLines: 1, showClient: false });
    // 1 h = 52,8 px → dos líneas, como "Sesión — Tomás Reyes" en el Figma.
    assert.equal(api.timedEventLayout({ ...week, height: 52.8 }).titleLines, 2);
    // Día 1440: 30 min = 32,8 px compacto; 45 min sin cliente; 1 h con cliente.
    assert.equal(api.timedEventLayout({ ...day, height: 32.8 }).compact, true);
    assert.deepEqual({ ...api.timedEventLayout({ ...day, height: 49.2 }) }, { compact: false, titleLines: 1, showClient: false });
    assert.deepEqual({ ...api.timedEventLayout({ ...day, height: 65.6 }) }, { compact: false, titleLines: 1, showClient: true });
    assert.equal(api.timedEventLayout({ ...day, height: 196.8 }).titleLines, 9);
    assert.equal(api.timedEventLayout({}).compact, true, 'sin medidas no rompe');

    assert.match(calendarJs, /<span class="cal-event-time">\$\{escapeHtml\(startLabel\)\}<span class="cal-event-time-rest">/);
    assert.match(calendarJs, /fitTimedEvents\(\);\n    \}/, 'se mide al final de renderTimeGrid');
    assert.match(calendarJs, /new ResizeObserver\(\(\) => fitTimedEvents\(\)\)/);
    assert.match(css, /\.cal-time-column \.cal-event strong\s*\{[^}]*-webkit-line-clamp:\s*var\(--title-lines, none\)/);
    assert.match(css, /\.cal-time-column \.cal-event\.is-compact\s*\{[^}]*flex-direction:\s*row/);
    assert.match(css, /\.cal-time-column \.cal-event\.is-compact strong\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/);
    assert.match(css, /\.cal-time-column \.cal-event\.is-client-hidden small\s*\{\s*display:\s*none/);
});

test('801:547 closed combobox shows the manual-quote link once and hides it after choosing a quote', () => {
    // El estado "mostrar link fijo" ya no existe: el link va dentro del error.
    assert.doesNotMatch(calendarJs, /quoteCreateVisible/);
    assert.match(calendarJs, /const errorHasLink = !!el\['event-form-error'\]\?\.querySelector\?\.\('a'\);\n\s*create\.hidden = !nothingToLink \|\| errorHasLink;/);
    // Elegir una cotización limpia el error (y su link) antes de recalcular.
    assert.match(calendarJs, /function selectQuote\(id\) \{[\s\S]*?el\['event-form-error'\]\.textContent = '';\n\s*closeQuotePicker\(\);\n\s*updateQuoteHint\(\);/);
    // Con la lista cerrada solo se ven avisos que piden atención.
    assert.match(calendarJs, /function isVisibleQuoteNotice\(text, tone\) \{\n\s*if \(text === QUOTE_HINT\) return false;\n\s*return tone === 'warning' \|\| tone === 'error' \|\| isLegacyManualTurno\(\);/);
});
