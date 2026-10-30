// Agenda del estudio (W-AGENDA): studio-dashboard-agenda.js (vistas Día /
// Semana / Lista, bloques "Ocupado", modal con disponibilidad en vivo y
// acciones), studio-agenda.css y la proyección de citas de estudios en el
// calendario del artista (calendar-repo.js + calendar.js + /calendar).
// Funciones puras y render HTML en una VM, acciones con repos falsos.
process.env.TZ = 'America/Argentina/Buenos_Aires';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const kit = require(path.join(root, 'public/shared/js/studio-admin-kit.js'));
const source = read('public/shared/js/studio-dashboard-agenda.js');
const css = read('public/shared/css/studio-agenda.css');
const calendarRepo = read('public/shared/js/data/calendar-repo.js');
const calendarJs = read('public/shared/js/calendar.js');
const calendarHtml = read('public/calendar/index.html');
const plain = (s) => String(s).replace(/ /g, ' ');
// Los valores creados en la VM tienen otros prototipos: se comparan por JSON.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const withMessage = (re) => (err) => re.test(String((err && err.message) || ''));

const EXPOSED = [
    'rangeFor', 'shiftAnchor', 'rangeLabel', 'mondayOf', 'timeRange', 'normalizeRoster', 'normalizeBooking',
    'toneMap', 'mergeBusy', 'assignLanes', 'clip', 'filterBookings', 'visibleArtists', 'bookingActions',
    'slotFromValues', 'bookingPayload', 'withoutExtras', 'hasExtras', 'interpretAvailability',
    'newBookingDefaults', 'valuesFromBooking', 'renderDayView', 'renderWeekView', 'renderListView',
    'renderSummary', 'renderBookingForm', 'renderBookingDetail', 'createActions', 'emitJobsChanged',
    'actionError', 'createAgenda'
];

function fakeEl() {
    const el = {
        innerHTML: '', textContent: '', hidden: false, value: '', attrs: {}, listeners: {},
        classList: {
            set: new Set(),
            add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }
        },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelectorAll() { return []; },
        querySelector() { return null; }
    };
    return el;
}
function fakeRoot() {
    const el = fakeEl();
    const cache = new Map();
    el.querySelector = (sel) => { if (!cache.has(sel)) cache.set(sel, fakeEl()); return cache.get(sel); };
    el.part = (sel) => el.querySelector(sel);
    return el;
}

// Corre el módulo en una VM con un shell falso y expone sus funciones internas.
function load(options = {}) {
    const registered = [];
    const dispatched = [];
    class CustomEvent {
        constructor(type, init) { this.type = type; this.detail = init ? init.detail : undefined; }
    }
    const window = {
        WeOtziStudioKit: options.kit || kit,
        WeOtziStudioAdmin: { register(tab, def) { registered.push([tab, def]); return true; } },
        WeotziData: options.data || {}
    };
    if (options.localStorage) window.localStorage = options.localStorage;
    const document = {
        dispatchEvent(event) { dispatched.push(event); return true; },
        createElement(tag) { return options.createElement ? options.createElement(tag) : fakeEl(); }
    };
    const exposed = source.replace(/\}\)\(\);\s*$/, 'globalThis.__agenda = { ' + EXPOSED.join(', ') + ' }; })();');
    const context = {
        window, document, CustomEvent, console: { warn() {}, error() {}, log() {} },
        setTimeout, clearTimeout, Promise, Date, Intl, Map, Set, URL, JSON
    };
    vm.runInNewContext(exposed, context, { filename: 'studio-dashboard-agenda.js' });
    return { api: context.__agenda, registered, dispatched, window };
}

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...args) => at(...args).toISOString();
const tick = () => new Promise((resolve) => setImmediate(resolve));

function booking(id, over = {}) {
    return Object.assign({
        id, studio_id: 'st', artist_user_id: 'ana', location_id: 'loc1', client_name: 'Cliente ' + id,
        client_email: null, starts_at: iso(2026, 10, 30, 10), ends_at: iso(2026, 10, 30, 12),
        amount: 1000, currency: 'ARS', status: 'confirmed', notes: null,
        artists_db: { name: 'Ana', username: 'ana' }, studio_locations: { label: 'Centro' }
    }, over);
}

/* -------------------------------- registro -------------------------------- */
test('se registra en la pestaña agenda con mount y show, sin CRUD ad-hoc', () => {
    const { registered } = load();
    assert.equal(registered.length, 1);
    assert.equal(registered[0][0], 'agenda');
    assert.equal(typeof registered[0][1].mount, 'function');
    assert.equal(typeof registered[0][1].show, 'function');
    assert.equal((source.match(/\}\)\(\);\s*$/) || []).length, 1, 'IIFE que termina en })();');
    assert.doesNotMatch(source, /fetch\(|\.rpc\(|_supabase|\bfrom\('studio_bookings'\)/, 'datos solo vía WeotziData');
    for (const method of ['listBookingsRange', 'listArtistBusyBlocks', 'checkBookingAvailability', 'saveBooking', 'completeBooking', 'listActiveRosterWithArtists', 'listActiveByStudio']) {
        assert.match(source, new RegExp('\\.' + method + '\\('), method);
    }
    assert.match(source, /const AVAILABILITY_DEBOUNCE_MS = 400;/);
    assert.match(source, /K\.debounce\(runCheck, AVAILABILITY_DEBOUNCE_MS\)/);
    assert.match(source, /document\.dispatchEvent\(new CustomEvent\('weotzi:studio-jobs-changed'/);
    assert.match(source, /kind: 'booking_created', booking_id: row\.id/);
    assert.match(source, /kind: 'booking_cancelled', booking_id: b\.id/);
});

test('sin el shell (WeOtziStudioAdmin) avisa y no rompe', () => {
    const warnings = [];
    const context = { window: { WeOtziStudioKit: kit }, console: { warn: (m) => warnings.push(m) }, document: {} };
    vm.runInNewContext(source, context);
    assert.equal(warnings.length, 1);
});

/* ------------------------------ fechas y rangos ------------------------------ */
test('rangos de Día, Semana (lunes a domingo) y Lista de 30 días, con navegación', () => {
    const { api } = load();
    const anchor = at(2026, 10, 30, 15);
    const day = api.rangeFor('day', anchor);
    assert.equal(day.from.getTime(), at(2026, 10, 30).getTime());
    assert.equal(day.to.getTime(), at(2026, 10, 31).getTime());
    assert.equal(api.rangeLabel(day), 'Viernes 30 de octubre de 2026');

    const week = api.rangeFor('week', anchor);
    assert.equal(week.from.getTime(), at(2026, 10, 26).getTime(), 'arranca el lunes');
    assert.equal(week.to.getTime(), at(2026, 11, 2).getTime());
    assert.equal(week.days.length, 7);
    assert.equal(api.rangeLabel(week), 'Semana del 26/10 al 01/11/2026');
    assert.equal(api.mondayOf(at(2026, 11, 1)).getTime(), at(2026, 10, 26).getTime(), 'el domingo es de la semana anterior');

    const list = api.rangeFor('list', anchor);
    assert.equal(Math.round((list.to - list.from) / 86400000), 30);
    assert.equal(api.rangeLabel(list), 'Del 30/10/2026 al 28/11/2026');

    assert.equal(api.shiftAnchor('day', anchor, -1).getTime(), at(2026, 10, 29).getTime());
    assert.equal(api.shiftAnchor('week', anchor, 1).getTime(), at(2026, 11, 6).getTime());
    assert.equal(api.shiftAnchor('list', anchor, 1).getTime(), at(2026, 11, 29).getTime());
    assert.equal(api.rangeFor('nada', anchor).view, 'day');
    // Las fronteras del día se marcan como "Todo el día" o 24:00.
    const ds = at(2026, 10, 30).getTime();
    const de = at(2026, 10, 31).getTime();
    assert.equal(api.timeRange(at(2026, 10, 29, 20).getTime(), at(2026, 11, 1).getTime(), ds, de), 'Todo el día');
    assert.equal(api.timeRange(at(2026, 10, 30, 22).getTime(), at(2026, 10, 31, 2).getTime(), ds, de), '22:00–24:00');
});

/* ------------------------------- modelo ------------------------------- */
test('roster sin duplicados, ordenado, con un color estable por artista', () => {
    const { api } = load();
    const roster = api.normalizeRoster([
        { artist_user_id: 'zoe', location_id: 'loc2', role: 'guest', artists_db: { name: 'Zoe' } },
        { artist_user_id: 'ana', location_id: 'loc1', role: 'resident', artists_db: { name: 'Ana' } },
        { artist_user_id: 'ana', location_id: 'loc9', role: 'guest', artists_db: { name: 'Ana' } },
        { artist_user_id: 'bo', location_id: null, artists_db: { name: '', username: 'bo.ink' } },
        null
    ]);
    same(roster.map((a) => [a.id, a.name, a.locationId]), [['ana', 'Ana', 'loc1'], ['bo', '@bo.ink', null], ['zoe', 'Zoe', 'loc2']]);
    const tones = api.toneMap(roster, [booking('b1', { artist_user_id: 'ex' })]);
    same([...tones.entries()], [['ana', 0], ['bo', 1], ['zoe', 2], ['ex', 3]]);
    const many = api.toneMap(Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i })), []);
    assert.equal(many.get('a8'), 0, 'se repite cada 8');
});

test('bloques ocupados se unen por artista y los carriles reparten el ancho', () => {
    const { api } = load();
    const merged = api.mergeBusy([
        { artist_user_id: 'ana', starts_at: iso(2026, 10, 30, 10), ends_at: iso(2026, 10, 30, 12), source: 'agenda_personal' },
        { artist_user_id: 'ana', starts_at: iso(2026, 10, 30, 11), ends_at: iso(2026, 10, 30, 13), source: 'otro_estudio' },
        { artist_user_id: 'ana', starts_at: iso(2026, 10, 30, 15), ends_at: iso(2026, 10, 30, 16), source: 'agenda_personal' },
        { artist_user_id: 'bo', starts_at: iso(2026, 10, 30, 11), ends_at: iso(2026, 10, 30, 12), source: 'agenda_personal' },
        { artist_user_id: 'bo', starts_at: iso(2026, 10, 30, 12), ends_at: iso(2026, 10, 30, 11) },
        { starts_at: iso(2026, 10, 30, 9), ends_at: iso(2026, 10, 30, 10) }
    ]);
    same(merged.map((b) => [b.artistId, new Date(b.startMs).getHours(), new Date(b.endMs).getHours()]),
        [['ana', 10, 13], ['bo', 11, 12], ['ana', 15, 16]]);
    assert.ok(merged.every((b) => !('source' in b)), 'sin detalle de la fuente');

    const h = (n) => at(2026, 10, 30, n).getTime();
    const laid = api.assignLanes([
        { id: 'A', startMs: h(10), endMs: h(12) },
        { id: 'B', startMs: h(11), endMs: h(13) },
        { id: 'D', startMs: h(12), endMs: h(13) },
        { id: 'C', startMs: h(13), endMs: h(14) }
    ]);
    const byId = Object.fromEntries(laid.map((i) => [i.id, [i.lane, i.lanes]]));
    same(byId, { A: [0, 2], B: [1, 2], D: [0, 2], C: [0, 1] });
    same({ ...api.clip(h(7), h(9), h(8), h(24)) }, { startMs: h(8), endMs: h(9) });
    assert.equal(api.clip(h(6), h(7), h(8), h(24)), null);
});

test('filtros por artista, sede y estado; las columnas incluyen a quien ya no está activo', () => {
    const { api } = load();
    const roster = [{ id: 'ana', name: 'Ana', locationId: 'loc1' }, { id: 'bo', name: 'Bo', locationId: 'loc2' }, { id: 'cy', name: 'Cy', locationId: null }];
    const bookings = [
        api.normalizeBooking(booking('b1')),
        api.normalizeBooking(booking('b2', { artist_user_id: 'bo', location_id: 'loc1', artists_db: { name: 'Bo' } })),
        api.normalizeBooking(booking('b3', { artist_user_id: 'ex', status: 'completed', artists_db: { name: 'Ex' } })),
        api.normalizeBooking(booking('b4', { status: 'cancelled' }))
    ];
    same(api.filterBookings(bookings, { statuses: ['confirmed', 'completed', 'no_show'] }).map((b) => b.id), ['b1', 'b2', 'b3']);
    same(api.filterBookings(bookings, { artistId: 'ana' }).map((b) => b.id), ['b1', 'b4']);
    same(api.filterBookings(bookings, { locationId: 'loc1', statuses: ['confirmed'] }).map((b) => b.id), ['b1', 'b2']);
    const all = api.visibleArtists(roster, bookings, {});
    same(all.map((a) => a.id), ['ana', 'bo', 'cy', 'ex']);
    assert.equal(all[3].inactive, true);
    // Sede loc1: los de esa sede, los sin sede fija y los que tienen citas ahí.
    same(api.visibleArtists(roster, bookings, { locationId: 'loc1' }).map((a) => a.id), ['ana', 'bo', 'cy', 'ex']);
    same(api.visibleArtists(roster, bookings, { locationId: 'loc2' }).map((a) => a.id), ['bo', 'cy', 'ex'].filter((id) => id !== 'ex'));
    same(api.visibleArtists(roster, bookings, { artistId: 'bo' }).map((a) => a.id), ['bo']);
    assert.equal(api.normalizeBooking({ id: 'x', starts_at: 'nada', ends_at: null }), null);
});

test('acciones por estado: completar y "no asistió" solo cuando empezó; sin M3 no hay "no asistió"', () => {
    const { api } = load();
    const now = at(2026, 10, 30, 11).getTime();
    const future = api.normalizeBooking(booking('f', { starts_at: iso(2026, 10, 30, 15), ends_at: iso(2026, 10, 30, 16) }));
    const started = api.normalizeBooking(booking('s'));
    same([...api.bookingActions(future, now, {})], ['edit', 'cancel']);
    same([...api.bookingActions(started, now, {})], ['edit', 'complete', 'no_show', 'cancel']);
    same([...api.bookingActions(started, now, { m3: false })], ['edit', 'complete', 'cancel']);
    for (const status of ['completed', 'cancelled', 'no_show']) {
        same([...api.bookingActions(api.normalizeBooking(booking('x', { status })), now, {})], [], status);
    }
});

/* ------------------------------ formulario ------------------------------ */
test('payload de la cita: horario local, studio_id solo al crear y validaciones en español', () => {
    const { api } = load();
    const values = {
        artist_user_id: 'ana', location_id: 'loc1', date: '2026-10-30', start: '10:00', end: '12:30',
        client_name: '  Juli   Sosa ', client_email: 'juli@example.test', client_phone: '+54 11 5555-5555',
        service_description: 'Fine line', amount: 50000, deposit_amount: 10000, currency: 'ars', notes: ' Traer referencia '
    };
    const created = api.bookingPayload(values, { studioId: 'st' });
    assert.equal(created.error, undefined);
    same({ ...created.payload }, {
        artist_user_id: 'ana', location_id: 'loc1', client_name: 'Juli Sosa', client_email: 'juli@example.test',
        client_phone: '+54 11 5555-5555', service_description: 'Fine line', starts_at: iso(2026, 10, 30, 10),
        ends_at: iso(2026, 10, 30, 12, 30), amount: 50000, deposit_amount: 10000, currency: 'ARS',
        notes: 'Traer referencia', studio_id: 'st'
    });
    assert.equal(created.payload.starts_at, '2026-10-30T13:00:00.000Z', 'hora de Buenos Aires → UTC');
    const edited = api.bookingPayload(values, { studioId: 'st', existing: { id: 'b1' } });
    assert.equal('studio_id' in edited.payload, false);
    const nulls = api.bookingPayload({ ...values, client_email: null, client_phone: null, service_description: null, amount: null, deposit_amount: null, notes: null, location_id: null }, { studioId: 'st' });
    assert.equal(nulls.payload.amount, 0);
    assert.equal(nulls.payload.deposit_amount, null);
    assert.equal(nulls.payload.location_id, null);

    const errors = [
        [{ artist_user_id: '' }, 'Elegí el artista de la cita.'],
        [{ date: '2026-02-31' }, 'Elegí la fecha de la cita.'],
        [{ start: '' }, 'Indicá la hora de inicio y la de fin.'],
        [{ end: '09:00' }, 'La hora de fin tiene que ser posterior a la de inicio.'],
        [{ client_name: '   ' }, 'Escribí el nombre del cliente.'],
        [{ client_email: 'juli@' }, 'Revisá el email del cliente.'],
        [{ amount: -1 }, 'El importe tiene que ser un número mayor o igual a 0.'],
        [{ deposit_amount: 60000 }, 'La seña no puede superar el importe.'],
        [{ deposit_amount: -5 }, 'La seña tiene que ser un número mayor o igual a 0.'],
        [{ currency: 'pesos' }, 'Elegí la moneda.']
    ];
    for (const [patch, message] of errors) assert.equal(api.bookingPayload({ ...values, ...patch }, { studioId: 'st' }).error, message, message);
    same(Object.keys(api.withoutExtras(created.payload)).filter((k) => ['client_phone', 'service_description', 'deposit_amount'].includes(k)), []);
    assert.equal(api.hasExtras(created.payload), true);
    assert.equal(api.hasExtras(nulls.payload), false);
    assert.equal(api.slotFromValues({ artist_user_id: 'ana', date: '2026-10-30', start: '10:00', end: '11:00' }).artistId, 'ana');
});

test('disponibilidad en vivo: disponible, motivos y RPC ausente', () => {
    const { api } = load();
    same({ ...api.interpretAvailability({ data: { available: true, reason: null }, error: null }, 'Ana') },
        { state: 'ok', reason: null, text: 'Ana está disponible en ese horario.' });
    const reasons = {
        agenda_personal: 'Ana no está disponible: tiene ocupada su agenda personal en ese horario.',
        otro_estudio: 'Ana no está disponible: tiene una cita en otro estudio en ese horario.',
        mismo_estudio: 'Ana no está disponible: ya tiene otra cita en este estudio en ese horario.',
        raro: 'Ana no está disponible: el horario está ocupado.'
    };
    for (const [reason, text] of Object.entries(reasons)) {
        const info = api.interpretAvailability({ data: { available: false, reason }, error: null }, 'Ana');
        assert.equal(info.state, 'busy');
        assert.equal(info.text, text);
    }
    for (const code of ['42883', 'PGRST202']) {
        const missing = api.interpretAvailability({ data: null, error: { code, message: 'x' } }, 'Ana');
        assert.equal(missing.state, 'unknown');
        assert.match(missing.text, /falta aplicar una migración/);
    }
    const denied = api.interpretAvailability({ data: null, error: { code: '42501', message: 'El artista no está activo en este estudio' } }, 'Ana');
    assert.equal(denied.text, 'No pudimos verificar la disponibilidad: El artista no está activo en este estudio');
});

test('defaults de una cita nueva: próximo tramo de hoy, artista único y moneda reciente', () => {
    const { api } = load();
    const roster = [{ id: 'ana', name: 'Ana', locationId: 'loc1' }];
    const now = at(2026, 10, 30, 10, 7);
    const d = api.newBookingDefaults({ now, anchor: at(2026, 10, 30), roster, currency: 'ARS' }, {});
    same([d.artist_user_id, d.location_id, d.date, d.start, d.end, d.currency], ['ana', 'loc1', '2026-10-30', '10:30', '11:30', 'ARS']);
    const slot = api.newBookingDefaults({ now, anchor: at(2026, 10, 30), roster: [...roster, { id: 'bo', name: 'Bo' }], primaryLocationId: 'main' }, { date: '2026-11-02', start: '23:30', artist: 'bo' });
    same([slot.artist_user_id, slot.location_id, slot.date, slot.start, slot.end, slot.currency], ['bo', 'main', '2026-11-02', '23:00', '23:59', 'USD']);
    const other = api.newBookingDefaults({ now, anchor: at(2026, 11, 3), roster: [...roster, { id: 'bo', name: 'Bo' }] }, {});
    same([other.artist_user_id, other.start], ['', '10:00'], 'con varios artistas obliga a elegir');
    const back = api.valuesFromBooking(api.normalizeBooking(booking('b1', { deposit_amount: 300, client_phone: '123' })));
    same([back.date, back.start, back.end, back.deposit_amount, back.client_phone], ['2026-10-30', '10:00', '12:00', 300, '123']);
});

/* --------------------------------- render --------------------------------- */
function modelFor(api, over = {}) {
    const roster = over.roster || [{ id: 'ana', name: 'Ana <b>', locationId: 'loc1' }, { id: 'bo', name: 'Bo', locationId: null }];
    const bookings = (over.bookings || [
        booking('b1', { client_name: '<img src=x onerror=alert(1)>', service_description: 'Fine line' }),
        booking('b2', { artist_user_id: 'bo', starts_at: iso(2026, 10, 30, 11), ends_at: iso(2026, 10, 30, 12), status: 'completed', artists_db: { name: 'Bo' } }),
        booking('b3', { starts_at: iso(2026, 10, 30, 6), ends_at: iso(2026, 10, 30, 7), client_name: 'Madrugador' })
    ]).map(api.normalizeBooking);
    const busy = api.mergeBusy(over.busy || [
        { artist_user_id: 'ana', starts_at: iso(2026, 10, 30, 11), ends_at: iso(2026, 10, 30, 13), source: 'agenda_personal' },
        { artist_user_id: 'bo', starts_at: iso(2026, 10, 29, 9), ends_at: iso(2026, 11, 1, 0), source: 'otro_estudio' }
    ]);
    return {
        range: api.rangeFor(over.view || 'day', at(2026, 10, 30)),
        artists: roster,
        bookings,
        busy,
        tones: api.toneMap(roster, bookings),
        nowMs: (over.now || at(2026, 10, 30, 12)).getTime(),
        m3: over.m3 === undefined ? true : over.m3,
        listStatus: over.listStatus || 'all'
    };
}

test('vista Día: columnas por artista 08–24, posiciones en %, carriles, ocupado sin detalle y todo escapado', () => {
    const { api } = load();
    const html = api.renderDayView(modelFor(api));
    assert.match(html, /style="--sa-cols:2"/);
    assert.equal((html.match(/class="sa-day__col"/g) || []).length, 2);
    assert.equal((html.match(/class="sa-day__hour"/g) || []).length, 16, '08:00…23:00');
    assert.match(html, />08:00</);
    assert.match(html, />23:00</);
    assert.ok(!html.includes('<img'), 'el cliente se escapa');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('Ana &lt;b&gt;'));
    // 10–12 sobre 08–24: top 12,5 % y alto 12,5 %; comparte carril con el ocupado de 11–13.
    assert.match(html, /data-sa-booking="b1"[^>]*style="top:12\.5%;height:12\.5%;left:calc\(0% \+ 2px\);width:calc\(50% - 4px\)"/);
    assert.match(html, /<div class="sa-busy" title="Ocupado" style="top:18\.75%;height:12\.5%;left:calc\(50% \+ 2px\);width:calc\(50% - 4px\)"><span class="sa-busy__label">Ocupado<\/span><span class="sa-busy__time">11:00–13:00<\/span>/);
    // El ocupado de varios días cubre toda la columna de Bo.
    assert.match(html, /style="top:0%;height:100%;[^"]*"><span class="sa-busy__label">Ocupado<\/span><span class="sa-busy__time">Todo el día<\/span>/);
    assert.match(html, /is-completed/);
    assert.match(html, /Completada/);
    // Lo que queda fuera de 08–24 se lista arriba; la línea de "ahora" aparece hoy.
    assert.match(html, /Fuera de la grilla \(08–24\): <button type="button" class="sa-link" data-sa-booking="b3">06:00 · Madrugador · Ana<\/button>/);
    assert.match(html, /class="sa-day__now" style="top:25%"/);
    assert.match(html, /data-sa-artist="ana" data-sa-date="2026-10-30"/);
    assert.match(html, /sa-tone-0/);
    assert.match(html, /sa-tone-1/);
    assert.doesNotMatch(html, /agenda_personal|otro_estudio/, 'los bloques no dicen de dónde vienen');
    assert.match(api.renderDayView({ ...modelFor(api), artists: [] }), /Todavía no tenés artistas activos/);
});

test('vista Semana: 7 días con tarjetas por artista, hoy marcado y ocupado con nombre', () => {
    const { api } = load();
    const html = api.renderWeekView(modelFor(api, { view: 'week' }));
    assert.equal((html.match(/<section class="sa-week__day/g) || []).length, 7);
    assert.match(html, /<section class="sa-week__day is-today" aria-label="Viernes 30\/10 \(hoy\)">/);
    assert.match(html, /data-sa-goto-day="2026-10-26"/);
    assert.match(html, /data-sa-new-on="2026-11-01" aria-label="Nueva cita el Dom 01\/11"/);
    assert.match(html, /Ocupado · Bo<\/span><span class="sa-busy__time">Todo el día/);
    assert.match(html, /Ocupado · Bo<\/span><span class="sa-busy__time">09:00–24:00/, 'el primer día del bloque se recorta');
    assert.match(html, /<span class="sa-card__meta">Ana &lt;b&gt; · Fine line<\/span>/);
    assert.match(html, /<p class="sa-week__empty">Sin citas<\/p>/);
    const friday = html.split('<section').find((s) => s.includes('is-today'));
    assert.ok(friday.indexOf('data-sa-booking="b3"') < friday.indexOf('data-sa-booking="b1"'), 'ordenado por hora');
});

test('vista Lista: chips por estado, estados en español, importes por moneda y acciones solo en confirmadas', () => {
    const { api } = load();
    const bookings = [
        booking('b1', { starts_at: iso(2026, 10, 30, 10), ends_at: iso(2026, 10, 30, 11), client_phone: '+54 9 11', deposit_amount: 200 }),
        booking('b2', { status: 'cancelled', currency: 'USD', amount: 50 }),
        booking('b3', { status: 'no_show' }),
        booking('b4', { status: 'completed', location_id: null, studio_locations: null })
    ];
    const html = plain(api.renderListView(modelFor(api, { view: 'list', bookings })));
    assert.match(html, /data-sa-status="all" aria-pressed="true">Todas <span class="sk-chip-count">4<\/span>/);
    assert.match(html, /data-sa-status="cancelled" aria-pressed="false">Cancelada <span class="sk-chip-count">1<\/span>/);
    assert.match(html, /No asistió/);
    assert.match(html, /\$ 1\.000<small>Seña \$ 200<\/small>/);
    assert.match(html, /US\$ 50/);
    assert.match(html, /Sin sede/);
    assert.match(html, /\+54 9 11/);
    same([...html.matchAll(/data-sa-row-action="([a-z_]+)" data-sa-id="([a-z0-9]+)"/g)].map((m) => m[2] + ':' + m[1]),
        ['b1:edit', 'b1:complete', 'b1:no_show', 'b1:cancel']);
    const onlyCancelled = api.renderListView(modelFor(api, { view: 'list', bookings, listStatus: 'cancelled' }));
    assert.equal((onlyCancelled.match(/data-sa-booking="/g) || []).length, 1);
    const empty = api.renderListView(modelFor(api, { view: 'list', bookings: [] }));
    assert.match(empty, /data-sa-action="csv" disabled/);
    assert.match(empty, /No hay citas en este período\./);
});

test('resumen: importe y señas por moneda, sin mezclar ni contar canceladas', () => {
    const { api } = load();
    const rows = [
        booking('a', { amount: 1000, currency: 'ARS', deposit_amount: 300 }),
        booking('b', { amount: 2500.5, currency: 'ARS', status: 'completed' }),
        booking('c', { amount: 40, currency: 'USD' }),
        booking('d', { amount: 999, currency: 'USD', status: 'cancelled' })
    ].map(api.normalizeBooking);
    const html = plain(api.renderSummary(rows));
    assert.match(html, /<strong>3 citas<\/strong>/);
    assert.match(html, /2 confirmadas · 1 completada/);
    assert.match(html, /Importe acordado: \$ 3\.500,50 · US\$ 40/);
    assert.match(html, /Señas: \$ 300/);
    assert.equal(api.renderSummary([]), '<p class="sa-summary">Sin citas confirmadas en este período.</p>');
});

test('formulario: campos del contrato, valores escapados y extras deshabilitados sin M3', () => {
    const { api } = load();
    const existing = api.normalizeBooking(booking('b1', { artist_user_id: 'ex', artists_db: { name: 'Ex' }, location_id: 'old', studio_locations: { label: 'Sede vieja' } }));
    const html = api.renderBookingForm({
        values: { ...api.valuesFromBooking(existing), client_name: '"><script>x</script>', currency: 'ARS' },
        roster: [{ id: 'ana', name: 'Ana' }], locations: [{ id: 'loc1', label: 'Centro' }], m3: false, existing
    });
    for (const name of ['artist_user_id', 'location_id', 'date', 'start', 'end', 'client_name', 'client_email', 'client_phone', 'service_description', 'amount', 'deposit_amount', 'currency', 'notes']) {
        assert.match(html, new RegExp('name="' + name + '"'), name);
    }
    assert.ok(!html.includes('<script>x'), 'escapa el valor');
    assert.match(html, /value="&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/);
    assert.match(html, /Ex \(ya no está activo\)/);
    assert.match(html, /<option value="old" selected>Sede vieja<\/option>/);
    assert.match(html, /name="client_phone"[^>]* disabled aria-describedby="sa-f-extras-hint"/);
    assert.match(html, /name="deposit_amount"[^>]* disabled/);
    assert.match(html, /Teléfono, servicio y seña se habilitan cuando se aplique la migración de agenda\./);
    assert.match(html, /<option value="ARS" selected>ARS<\/option>/);
    assert.match(html, /data-sa-availability data-state="idle" role="status" aria-live="polite"/);
    const full = api.renderBookingForm({ values: {}, roster: [{ id: 'ana', name: 'Ana' }], locations: [], m3: true });
    assert.doesNotMatch(full, /disabled/);
    const detail = api.renderBookingDetail(api.normalizeBooking(booking('b9', { client_name: '<i>Juli</i>', notes: 'Línea 1\nLínea 2', created_by_role: 'support', deposit_amount: 100 })));
    assert.ok(detail.includes('&lt;i&gt;Juli&lt;/i&gt;'));
    assert.match(detail, /Cargada por<\/dt><dd>Soporte/);
    assert.match(plain(detail), /\$ 1\.000 · Seña \$ 100/);
});

/* --------------------------------- acciones --------------------------------- */
function actionsHarness({ saveResults = [], completeResult, confirm = true, notifyOk = true } = {}) {
    const calls = [];
    const toasts = [];
    const notified = [];
    const ops = {
        saveBooking: async (id, body) => { calls.push(['save', id, { ...body }]); return saveResults.shift() || { data: { id: id || 'new-1', ...body }, error: null }; },
        completeBooking: async (id) => { calls.push(['complete', id]); return completeResult || { data: { id, status: 'completed', job_log_id: 'job-1' }, error: null }; }
    };
    const fakeKit = Object.assign({}, kit, {
        toast: (msg, tone) => toasts.push([msg, tone]),
        confirmDialog: async (opts) => { calls.push(['confirm', opts.title]); return confirm; }
    });
    const loaded = load({ kit: fakeKit });
    const ctx = { studioId: 'st', notify: async (payload) => { notified.push(payload); return { ok: notifyOk }; } };
    const actions = loaded.api.createActions({ ctx, data: { StudioOps: ops }, kit: fakeKit });
    return { ...loaded, actions, calls, toasts, notified };
}

test('crear una cita guarda con studio_id y notifica booking_created; editar no notifica', async () => {
    const h = actionsHarness();
    const payload = h.api.bookingPayload({ artist_user_id: 'ana', date: '2026-10-30', start: '10:00', end: '11:00', client_name: 'Juli', currency: 'ARS', client_phone: '123' }, { studioId: 'st' }).payload;
    const result = await h.actions.save(null, payload, { m3: true });
    assert.equal(result.row.id, 'new-1');
    assert.equal(result.degraded, false);
    assert.equal(await result.notified, true);
    same(h.notified, [{ kind: 'booking_created', booking_id: 'new-1' }]);
    assert.equal(h.calls[0][1], null);
    assert.equal(h.calls[0][2].studio_id, 'st');
    assert.equal(h.calls[0][2].client_phone, '123');

    const edit = await h.actions.save({ id: 'b1' }, { ...payload, studio_id: undefined }, { m3: true });
    assert.equal(await edit.notified, null);
    assert.equal(h.notified.length, 1);
    assert.equal(h.calls[1][1], 'b1');

    const failing = actionsHarness({ notifyOk: false });
    await (await failing.actions.save(null, payload, {})).notified;
    same(failing.toasts, [['La cita quedó agendada, pero no pudimos avisarle al artista por email.', 'warning']]);
});

test('sin las columnas de M3 reintenta sin teléfono, servicio ni seña y avisa', async () => {
    const h = actionsHarness({ saveResults: [{ data: null, error: { code: 'PGRST204', message: "Could not find the 'client_phone' column" } }] });
    const payload = h.api.bookingPayload({ artist_user_id: 'ana', date: '2026-10-30', start: '10:00', end: '11:00', client_name: 'Juli', currency: 'ARS', service_description: 'Fine line' }, { studioId: 'st' }).payload;
    const result = await h.actions.save(null, payload, { m3: null });
    assert.equal(result.degraded, true);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0][2].service_description, 'Fine line');
    for (const key of ['client_phone', 'service_description', 'deposit_amount']) assert.equal(key in h.calls[1][2], false, key);

    // Sabiendo que M3 falta, el primer intento ya va sin extras.
    const known = actionsHarness();
    const r2 = await known.actions.save(null, payload, { m3: false });
    assert.equal(known.calls.length, 1);
    assert.equal('service_description' in known.calls[0][2], false);
    assert.equal(r2.degraded, true);

    // Otros errores suben tal cual (los muestra el modal con friendlyError).
    const busy = actionsHarness({ saveResults: [{ data: null, error: { code: '23514', message: 'Ana no está disponible en ese horario (agenda personal)' } }] });
    await assert.rejects(busy.actions.save(null, payload, {}), /Ana no está disponible en ese horario \(agenda personal\)/);
});

test('cancelar confirma, pasa a cancelled y notifica booking_cancelled', async () => {
    const h = actionsHarness();
    const b = h.api.normalizeBooking(booking('b1'));
    assert.equal(await h.actions.cancel(b), true);
    same(h.calls.map((c) => c[0]), ['confirm', 'save']);
    same(h.calls[1], ['save', 'b1', { status: 'cancelled' }]);
    same(h.notified, [{ kind: 'booking_cancelled', booking_id: 'b1' }]);
    same(h.toasts, [['Cita cancelada. Le avisamos al artista.', 'success']]);
    const no = actionsHarness({ confirm: false });
    assert.equal(await no.actions.cancel(b), false);
    same(no.calls.map((c) => c[0]), ['confirm']);
    same(no.notified, []);
});

test('completar dispara weotzi:studio-jobs-changed; "no asistió" sin M3 avisa la migración', async () => {
    const h = actionsHarness();
    const b = h.api.normalizeBooking(booking('b1'));
    assert.equal(await h.actions.complete(b), true);
    same(h.calls[1], ['complete', 'b1']);
    assert.equal(h.dispatched.length, 1);
    assert.equal(h.dispatched[0].type, 'weotzi:studio-jobs-changed');
    same({ ...h.dispatched[0].detail }, { studioId: 'st', bookingId: 'b1', jobId: 'job-1' });
    same(h.toasts, [['Cita completada: el trabajo quedó registrado en Operaciones.', 'success']]);

    const early = actionsHarness({ completeResult: { data: null, error: { code: 'P0001', message: 'La reserva todavía no comenzó' } } });
    await assert.rejects(early.actions.complete(b), withMessage(/La reserva todavía no comenzó/));
    assert.equal(early.dispatched.length, 0);

    const noShow = actionsHarness();
    assert.equal(await noShow.actions.noShow(b), true);
    same(noShow.calls[1], ['save', 'b1', { status: 'no_show' }]);
    const legacy = actionsHarness({ saveResults: [{ data: null, error: { code: '23514', message: 'new row for relation "studio_bookings" violates check constraint "studio_bookings_status_check"' } }] });
    await assert.rejects(legacy.actions.noShow(b), withMessage(/falta aplicar una migración/));
});

/* ------------------------------ pantalla completa ------------------------------ */
function screenHarness({ busyResult, bookings, roster } = {}) {
    const calls = [];
    const modals = [];
    const data = {
        StudioMemberships: {
            listActiveRosterWithArtists: async (id) => { calls.push(['roster', id]); return { data: roster || [{ artist_user_id: 'ana', location_id: 'loc1', role: 'resident', artists_db: { name: 'Ana' } }], error: null }; }
        },
        StudioLocations: { listActiveByStudio: async (id, cols) => { calls.push(['locations', id, cols]); return { data: [{ id: 'loc1', label: 'Centro' }, { id: 'loc2', label: 'Norte' }], error: null }; } },
        StudioOps: {
            listBookingsRange: async (id, from, to) => { calls.push(['bookings', id, from, to]); return { data: bookings || [booking('b1')], error: null }; },
            listArtistBusyBlocks: async (id, from, to) => { calls.push(['busy', id, from, to]); return busyResult || { data: [{ artist_user_id: 'ana', starts_at: iso(2026, 10, 30, 15), ends_at: iso(2026, 10, 30, 16), source: 'agenda_personal' }], error: null }; }
        }
    };
    const fakeKit = Object.assign({}, kit, {
        openModal: (opts) => { modals.push(opts); return { closed: Promise.resolve(null), footer: null }; },
        toast() {}
    });
    const throwingStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
    const loaded = load({ kit: fakeKit, data, localStorage: throwingStorage });
    const rootEl = fakeRoot();
    const ctx = { studioId: 'st', studio: { id: 'st' }, data, navigate() {}, notify: async () => ({ ok: true }) };
    const agenda = loaded.api.createAgenda(rootEl, ctx);
    return { ...loaded, agenda, root: rootEl, calls, modals };
}

test('show carga el rango del día, el roster, las sedes y los bloques ocupados y pinta la grilla', async () => {
    const h = screenHarness();
    await h.agenda.show({ view: 'day', date: '2026-10-30' });
    same(h.calls.find((c) => c[0] === 'bookings'), ['bookings', 'st', iso(2026, 10, 30), iso(2026, 10, 31)]);
    same(h.calls.find((c) => c[0] === 'busy'), ['busy', 'st', iso(2026, 10, 30), iso(2026, 10, 31)]);
    same(h.calls.find((c) => c[0] === 'locations'), ['locations', 'st', 'id, label, is_primary']);
    const body = h.root.part('[data-sa-body]');
    assert.match(body.innerHTML, /class="sa-day"/);
    assert.match(body.innerHTML, /data-sa-booking="b1"/);
    assert.match(body.innerHTML, /Ocupado/);
    assert.equal(h.root.part('[data-sa-range]').textContent, 'Viernes 30 de octubre de 2026');
    assert.equal(h.root.part('[data-sa-date]').value, '2026-10-30');
    assert.equal(h.root.part('[data-sa-location-filter]').hidden, false, 'con dos sedes se muestra el filtro');
    assert.match(h.root.part('[data-sa-filter="artist"]').innerHTML, /Todos los artistas[\s\S]*value="ana"/);
    assert.equal(h.root.part('[data-sa-note]').hidden, true);
    assert.equal(h.agenda.state.m3, true);
    assert.equal(body.hasAttribute('aria-busy'), false);
});

test('sin M3: sin bloques ocupados, aviso de migración y "no asistió" oculto; la lista no pide bloques', async () => {
    const h = screenHarness({ busyResult: { data: [], error: null, unavailable: true } });
    await h.agenda.show({ view: 'week', date: '2026-10-30' });
    assert.equal(h.agenda.state.m3, false);
    const note = h.root.part('[data-sa-note]');
    assert.equal(note.hidden, false);
    assert.match(note.textContent, /se activan cuando se aplique la migración de agenda/);
    assert.match(h.root.part('[data-sa-body]').innerHTML, /class="sa-week"/);
    h.calls.length = 0;
    await h.agenda.show({ view: 'list' });
    assert.ok(!h.calls.some((c) => c[0] === 'busy'), 'la lista no consulta bloques');
    assert.match(h.root.part('[data-sa-body]').innerHTML, /sk-table/);
    assert.doesNotMatch(h.root.part('[data-sa-body]').innerHTML, /data-sa-row-action="no_show"/);
});

test('show con booking abre el detalle; con error de carga ofrece reintentar', async () => {
    const h = screenHarness();
    await h.agenda.show({ view: 'day', date: '2026-10-30', booking: 'b1' });
    await tick();
    assert.equal(h.modals.length, 1);
    assert.equal(h.modals[0].title, 'Cita de Cliente b1');
    same(h.modals[0].actions.map((a) => a.label), ['Cerrar', 'Cancelar cita', 'No asistió', 'Completar', 'Editar']);

    const broken = screenHarness();
    broken.agenda.state.view = 'day';
    const data = broken.window.WeotziData;
    data.StudioOps.listBookingsRange = async () => ({ data: null, error: { code: '42501', message: 'No tenés acceso a este estudio' } });
    await broken.agenda.show({ date: '2026-10-30' });
    const body = broken.root.part('[data-sa-body]').innerHTML;
    assert.match(body, /No pudimos cargar la agenda: No tenés acceso a este estudio/);
    assert.match(body, /data-sa-action="retry"/);

    const empty = screenHarness({ roster: [], bookings: [] });
    await empty.agenda.show({ view: 'day', date: '2026-10-30' });
    assert.match(empty.root.part('[data-sa-body]').innerHTML, /data-sa-action="roster"/);
});

/* ------------------------------ modal de cita ------------------------------ */
// Formulario falso: parsea el HTML real de renderBookingForm en campos que
// kit.readForm puede leer (name, type, value, disabled, options).
function unescapeHtml(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#96;/g, '`')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function tagAttr(attrs, name) {
    const m = new RegExp('\\s' + name + '="([^"]*)"').exec(attrs);
    return m ? unescapeHtml(m[1]) : null;
}
function fakeForm() {
    const form = fakeEl();
    const byName = new Map();
    const availability = fakeEl();
    let html = '';
    form.elements = [];
    Object.defineProperty(form, 'innerHTML', {
        get() { return html; },
        set(value) {
            html = String(value);
            form.elements = [];
            byName.clear();
            // El cierre se ata a la misma etiqueta: un <input> no tiene y no
            // puede "tragarse" lo que sigue hasta el próximo </textarea>.
            const re = /<(input|select|textarea)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/g;
            let m;
            while ((m = re.exec(html))) {
                const [, tag, attrs, inner = ''] = m;
                const el = fakeEl();
                el.tagName = tag.toUpperCase();
                el.name = tagAttr(attrs, 'name');
                el.disabled = /\sdisabled(?=[\s>]|$)/.test(attrs);
                if (tag === 'input') {
                    el.type = tagAttr(attrs, 'type') || 'text';
                    el.value = tagAttr(attrs, 'value') || '';
                } else if (tag === 'select') {
                    el.type = 'select-one';
                    el.options = [...inner.matchAll(/<option value="([^"]*)"( selected)?>/g)].map((o) => ({ value: unescapeHtml(o[1]), selected: !!o[2] }));
                    el.value = (el.options.find((o) => o.selected) || el.options[0] || { value: '' }).value;
                } else {
                    el.type = 'textarea';
                    el.value = unescapeHtml(inner);
                }
                form.elements.push(el);
                if (el.name) byName.set(el.name, el);
            }
        }
    });
    form.querySelector = (sel) => {
        if (sel === '[data-sa-availability]') return availability;
        const m = /^\[name="([^"]+)"\]$/.exec(sel);
        return m ? byName.get(m[1]) || null : null;
    };
    form.field = (name) => byName.get(name);
    form.availability = availability;
    // Simula lo que hace el navegador: cambia el valor y dispara el evento.
    form.set = (name, value, type = 'change') => {
        const el = byName.get(name);
        el.value = value;
        (form.listeners[type] || []).forEach((fn) => fn({ target: el }));
    };
    return form;
}

function fakeModal(opts) {
    let resolveClosed;
    const api = {
        opts,
        errors: [],
        closed: new Promise((resolve) => { resolveClosed = resolve; }),
        setError(msg) { if (msg) api.errors.push(String(msg)); },
        close(value) { resolveClosed(value === undefined ? null : value); },
        // Click en la acción principal (la última del pie).
        submit() { return opts.actions[opts.actions.length - 1].onClick(api); }
    };
    api.footer = { lastChild: { click() { api.submit(); } } };
    return api;
}

function editorHarness({ roster, bookings, checks = [], hasCheck = true, saveResult } = {}) {
    const calls = [];
    const modals = [];
    const forms = [];
    const toasts = [];
    const notified = [];
    const debounceWaits = [];
    const ops = {
        listBookingsRange: async () => ({ data: bookings || [booking('b1')], error: null }),
        listArtistBusyBlocks: async () => ({ data: [], error: null }),
        saveBooking: async (id, body) => {
            calls.push(['save', id, { ...body }]);
            return saveResult || { data: { id: id || 'new-1', ...body }, error: null };
        }
    };
    if (hasCheck) {
        ops.checkBookingAvailability = async (studioId, artistId, starts, ends, exclude) => {
            calls.push(['check', studioId, artistId, starts, ends, exclude]);
            return checks.shift() || { data: { available: true, reason: null }, error: null };
        };
    }
    const data = {
        StudioMemberships: {
            listActiveRosterWithArtists: async () => ({
                data: roster || [{ artist_user_id: 'ana', location_id: 'loc1', role: 'resident', artists_db: { name: 'Ana' } }],
                error: null
            })
        },
        StudioLocations: { listActiveByStudio: async () => ({ data: [{ id: 'loc1', label: 'Centro' }, { id: 'loc2', label: 'Norte' }], error: null }) },
        StudioOps: ops
    };
    const fakeKit = Object.assign({}, kit, {
        openModal: (opts) => { const m = fakeModal(opts); modals.push(m); return m; },
        toast: (msg, tone) => toasts.push([msg, tone]),
        // El debounce real con una espera corta; se registra la pedida.
        debounce: (fn, wait) => { debounceWaits.push(wait); return kit.debounce(fn, 5); }
    });
    const loaded = load({
        kit: fakeKit,
        data,
        createElement: (tag) => { const el = tag === 'form' ? fakeForm() : fakeEl(); if (tag === 'form') forms.push(el); return el; }
    });
    const rootEl = fakeRoot();
    const ctx = {
        studioId: 'st', studio: { id: 'st' }, data, navigate() {},
        notify: async (payload) => { notified.push(payload); return { ok: true }; }
    };
    const agenda = loaded.api.createAgenda(rootEl, ctx);
    return { ...loaded, agenda, root: rootEl, calls, modals, forms, toasts, notified, debounceWaits };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checksOf = (calls) => calls.filter((c) => c[0] === 'check');

test('nueva cita: chequeo inicial, debounce de 400 ms al cambiar el horario y guardado con aviso booking_created', async () => {
    const h = editorHarness();
    await h.agenda.show({ view: 'day', date: '2026-10-30', new: true, start: '10:00' });
    await tick();
    assert.equal(h.modals.length, 1);
    assert.equal(h.modals[0].opts.title, 'Nueva cita');
    const form = h.forms[0];
    // Un solo artista activo: queda elegido y se consulta enseguida.
    assert.equal(form.field('artist_user_id').value, 'ana');
    assert.equal(form.field('location_id').value, 'loc1', 'la sede del artista');
    assert.equal(form.field('currency').value, 'ARS', 'la moneda de la cita más reciente');
    same(checksOf(h.calls), [['check', 'st', 'ana', iso(2026, 10, 30, 10), iso(2026, 10, 30, 11), null]]);
    assert.equal(form.availability.getAttribute('data-state'), 'ok');
    assert.equal(form.availability.textContent, 'Ana está disponible en ese horario.');

    // Varios cambios seguidos → una sola consulta, después de la espera.
    assert.ok(h.debounceWaits.includes(400), 'debounce de 400 ms');
    form.set('end', '12:00', 'input');
    form.set('end', '12:30', 'input');
    form.set('end', '13:00');
    assert.equal(checksOf(h.calls).length, 1, 'todavía no consultó');
    await sleep(30);
    same(checksOf(h.calls).slice(1), [['check', 'st', 'ana', iso(2026, 10, 30, 10), iso(2026, 10, 30, 13), null]]);

    // Al guardar se vuelve a consultar y recién después se escribe.
    form.set('client_name', '  Juli  ', 'input');
    form.set('client_phone', '+54 11 5555', 'input');
    assert.equal(await h.modals[0].submit(), true);
    same(h.modals[0].errors, []);
    assert.equal(checksOf(h.calls).length, 3, 'revalida al guardar');
    const save = h.calls.find((c) => c[0] === 'save');
    assert.equal(save[1], null);
    assert.equal(save[2].studio_id, 'st');
    assert.equal(save[2].client_name, 'Juli');
    assert.equal(save[2].client_phone, '+54 11 5555');
    assert.equal(save[2].starts_at, iso(2026, 10, 30, 10));
    assert.equal(save[2].ends_at, iso(2026, 10, 30, 13));
    await tick();
    same(h.notified, [{ kind: 'booking_created', booking_id: 'new-1' }]);
    assert.ok(h.toasts.some(([msg, tone]) => msg === 'Cita agendada.' && tone === 'success'));
});

test('nueva cita: si el artista está ocupado no guarda; sin RPC avisa la migración y guarda igual', async () => {
    const busy = editorHarness({
        checks: [
            { data: { available: true, reason: null }, error: null },
            { data: { available: false, reason: 'otro_estudio' }, error: null }
        ]
    });
    await busy.agenda.show({ view: 'day', date: '2026-10-30', new: true, start: '10:00' });
    await tick();
    busy.forms[0].set('client_name', 'Juli', 'input');
    assert.equal(await busy.modals[0].submit(), false);
    same(busy.modals[0].errors, ['Ana no está disponible: tiene una cita en otro estudio en ese horario.']);
    assert.equal(busy.forms[0].availability.getAttribute('data-state'), 'busy');
    assert.ok(!busy.calls.some((c) => c[0] === 'save'), 'no escribe');
    same(busy.notified, []);

    // Validación del formulario: ni consulta ni escribe.
    const invalid = editorHarness();
    await invalid.agenda.show({ view: 'day', date: '2026-10-30', new: true, start: '10:00' });
    await tick();
    const before = invalid.calls.length;
    assert.equal(await invalid.modals[0].submit(), false);
    same(invalid.modals[0].errors, ['Escribí el nombre del cliente.']);
    assert.equal(invalid.calls.length, before);

    // Sin check_studio_booking_availability (M3 sin aplicar): aviso y guarda.
    const legacy = editorHarness({ hasCheck: false });
    await legacy.agenda.show({ view: 'day', date: '2026-10-30', new: true, start: '10:00' });
    await tick();
    assert.equal(legacy.forms[0].availability.getAttribute('data-state'), 'unknown');
    assert.match(legacy.forms[0].availability.textContent, /falta aplicar una migración/);
    legacy.forms[0].set('client_name', 'Juli', 'input');
    assert.equal(await legacy.modals[0].submit(), true);
    assert.ok(legacy.calls.some((c) => c[0] === 'save'));
});

test('editar una cita: excluye la propia en el chequeo, no manda studio_id y no notifica', async () => {
    const h = editorHarness();
    await h.agenda.show({ view: 'day', date: '2026-10-30', booking: 'b1' });
    await tick();
    assert.equal(h.modals[0].opts.title, 'Cita de Cliente b1');
    h.modals[0].close('edit');
    await tick();
    await tick();
    assert.equal(h.modals.length, 2);
    assert.equal(h.modals[1].opts.title, 'Editar cita');
    const form = h.forms[0];
    assert.equal(form.field('client_name').value, 'Cliente b1');
    assert.equal(form.field('start').value, '10:00');
    assert.equal(form.field('end').value, '12:00');
    same(checksOf(h.calls), [['check', 'st', 'ana', iso(2026, 10, 30, 10), iso(2026, 10, 30, 12), 'b1']]);
    form.set('client_name', 'Juli Sosa', 'input');
    assert.equal(await h.modals[1].submit(), true);
    const save = h.calls.find((c) => c[0] === 'save');
    assert.equal(save[1], 'b1');
    assert.equal('studio_id' in save[2], false);
    assert.equal(save[2].client_name, 'Juli Sosa');
    await tick();
    same(h.notified, [], 'editar no notifica');
    assert.ok(h.toasts.some(([msg]) => msg === 'Cita actualizada.'));
});

test('modal: elegir artista propone su sede hasta que se toca la sede; el inicio empuja el fin', async () => {
    const h = editorHarness({
        roster: [
            { artist_user_id: 'ana', location_id: 'loc1', role: 'resident', artists_db: { name: 'Ana' } },
            { artist_user_id: 'bo', location_id: 'loc2', role: 'guest', artists_db: { name: 'Bo' } }
        ]
    });
    await h.agenda.show({ view: 'day', date: '2026-10-30', new: true, start: '10:00' });
    await tick();
    const form = h.forms[0];
    assert.equal(form.field('artist_user_id').value, '', 'con varios artistas obliga a elegir');
    same(checksOf(h.calls), [], 'sin artista no consulta');
    form.set('artist_user_id', 'bo');
    assert.equal(form.field('location_id').value, 'loc2');
    form.set('location_id', 'loc1');
    form.set('artist_user_id', 'ana');
    assert.equal(form.field('location_id').value, 'loc1', 'respeta la sede elegida a mano');
    form.set('start', '12:00');
    assert.equal(form.field('end').value, '13:00', 'el fin pasa a una hora después del inicio');
});

test('vista Día: click en un horario libre abre "Nueva cita" con ese artista, día y tramo', async () => {
    const h = editorHarness();
    await h.agenda.show({ view: 'day', date: '2026-10-30' });
    const col = fakeEl();
    col.attrs = { 'data-sa-artist': 'ana', 'data-sa-date': '2026-10-31' };
    col.getBoundingClientRect = () => ({ top: 100, height: 832 });
    const target = { closest: (sel) => (sel === '[data-sa-col]' ? col : null) };
    // 26 px por tramo de 30 min desde las 08: 4 tramos más abajo → 10:00.
    h.root.listeners.click.forEach((fn) => fn({ target, clientY: 100 + 4 * 26 + 3 }));
    await tick();
    assert.equal(h.modals.length, 1);
    const form = h.forms[0];
    same(['artist_user_id', 'date', 'start', 'end'].map((n) => form.field(n).value), ['ana', '2026-10-31', '10:00', '11:00']);
    // Sobre un bloque "Ocupado" no abre nada.
    const busyTarget = { closest: (sel) => (sel === '[data-sa-col]' ? col : sel === '.sa-busy' ? {} : null) };
    h.root.listeners.click.forEach((fn) => fn({ target: busyTarget, clientY: 300 }));
    assert.equal(h.modals.length, 1);
});

/* --------------------------------- CSS --------------------------------- */
test('CSS de la agenda: prefijo sa-, tokens del panel, radio 0 y responsive', () => {
    for (const cls of ['.sa-agenda', '.sa-toolbar', '.sa-day__grid', '.sa-day__col', '.sa-day__hours', '.sa-day__now', '.sa-card', '.sa-busy', '.sa-week', '.sa-week__day', '.sa-list-tools', '.sa-availability', '.sa-form__money', '.sa-detail', '.sa-legend', '.sa-dot']) {
        assert.ok(css.includes(cls), cls);
    }
    for (let i = 0; i < 8; i++) assert.match(css, new RegExp('\\.sa-tone-' + i + ' \\{ --sa-tone: var\\(--sa-tone-' + i + '\\); \\}'));
    assert.match(css, /--sa-slots: 32;/);
    assert.match(css, /\.sa-availability\[data-state="busy"\]/);
    assert.match(css, /\.sa-agenda \[hidden\][\s\S]*display: none !important/);
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    // El lookahead va pegado a los dos puntos: con `\s*(?!0)` el motor
    // retrocede y "border-radius: 0;" también contaba como radio distinto de 0.
    assert.doesNotMatch(css, /border-radius:(?!\s*0\s*;)[^;]+;/, 'radio 0');
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|\})\s*([^{}@]+)\{/g) || [];
    selectors.forEach((block) => {
        const sel = block.replace(/^\}?\s*/, '').replace(/\{$/, '');
        // Se parte por comas de nivel superior: ":where(.studio-page, .sk-overlay)" es un solo selector.
        const parts = [];
        let depth = 0;
        let current = '';
        for (const ch of sel) {
            if (ch === '(') depth += 1;
            if (ch === ')') depth -= 1;
            if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
        }
        parts.push(current);
        parts.map((s) => s.trim()).filter(Boolean).forEach((s) => {
            assert.ok(/\.sa-|:where\(\.studio-page|\[data-theme="dark"\]/.test(s), 'selector sin prefijo: ' + s);
        });
    });
});

/* --------------------------- calendario del artista --------------------------- */
function loadCalendarRepo(extra = {}) {
    const sandbox = {
        console: { error() {}, warn() {}, log() {} },
        Date, Map, Set, Promise, Number, String, Object, RegExp, encodeURIComponent
    };
    sandbox.window = sandbox;
    sandbox.WeotziData = Object.assign({ run: async () => ({ data: [] }) }, extra);
    vm.runInNewContext(calendarRepo, sandbox, { filename: 'calendar-repo.js' });
    return sandbox.WeotziData.Calendar;
}

test('calendario del artista: proyecta solo las citas confirmadas de estudios, en solo lectura', async () => {
    const asked = [];
    const StudioOps = {
        async listBookingsForArtist(artistId, from, to) {
            asked.push([artistId, from, to]);
            return {
                data: [
                    { id: 'sb1', studio_id: 's1', artist_user_id: 'artist-1', client_name: 'Juli', starts_at: iso(2026, 10, 30, 10), ends_at: iso(2026, 10, 30, 12), status: 'confirmed', studios: { name: 'Fierro Negro', slug: 'fierro' } },
                    { id: 'sb2', studio_id: 's1', artist_user_id: 'artist-1', client_name: 'Tomi', starts_at: iso(2026, 10, 30, 14), ends_at: iso(2026, 10, 30, 15), status: 'cancelled', studios: { name: 'Fierro Negro' } },
                    { id: 'sb3', studio_id: 's2', artist_user_id: 'artist-1', client_name: 'Caro', starts_at: iso(2026, 10, 31, 10), ends_at: iso(2026, 10, 31, 11), status: 'completed', studios: { name: 'Otro' } }
                ],
                error: null
            };
        }
    };
    const Calendar = loadCalendarRepo({ StudioOps });
    const events = await Calendar.listRange('artist-1', at(2026, 10, 26), at(2026, 11, 2));
    same(asked, [['artist-1', iso(2026, 10, 26), iso(2026, 11, 2)]]);
    assert.equal(events.length, 1);
    const [event] = events;
    same({
        id: event.id, type: event.type, sourceType: event.sourceType, sourceId: event.sourceId,
        readonly: event.readonly, href: event.href, title: event.title, clientName: event.clientName, start: event.start
    }, {
        id: 'studio_booking:sb1', type: 'confirmed_session', sourceType: 'studio_booking', sourceId: 'sb1',
        readonly: true, href: null, title: 'Cita en Fierro Negro: Juli', clientName: 'Juli', start: iso(2026, 10, 30, 10)
    });
    assert.equal(Calendar._internal.normalizeStudioBooking({ id: 'x', status: 'confirmed', starts_at: iso(2026, 10, 30, 10), ends_at: iso(2026, 10, 30, 11), client_name: null }).title, 'Cita en un estudio: Cliente');
});

test('calendario del artista: sin StudioOps o con error la página sigue con sus eventos', async () => {
    const manual = [{ id: 'm1', event_type: 'personal', title: 'Gym', starts_at: iso(2026, 10, 30, 8), ends_at: iso(2026, 10, 30, 9), status: 'scheduled' }];
    const run = async () => ({ data: manual });
    const without = loadCalendarRepo({ run });
    same((await without.listRange('artist-1', at(2026, 10, 26), at(2026, 11, 2))).map((e) => e.sourceType), ['manual']);
    const noMethod = loadCalendarRepo({ run, StudioOps: {} });
    assert.equal((await noMethod.listRange('artist-1', at(2026, 10, 26), at(2026, 11, 2))).length, 1);
    const failing = loadCalendarRepo({ run, StudioOps: { listBookingsForArtist: async () => ({ data: null, error: { code: 'XX000', message: 'boom' } }) } });
    same((await failing.listRange('artist-1', at(2026, 10, 26), at(2026, 11, 2))).map((e) => e.sourceType), ['manual']);
    assert.match(calendarRepo, /if \(typeof D\.StudioOps\?\.listBookingsForArtist !== 'function'\) return \[\];/);
});

test('calendario del artista: /calendar carga studios-repo.js antes del repo y el toast "la gestiona el estudio"', () => {
    const order = ['/shared/js/data/postgrest-client.js', '/shared/js/data/studios-repo.js', '/shared/js/data/calendar-repo.js'].map((src) => calendarHtml.indexOf(src));
    order.forEach((index) => assert.ok(index > 0));
    same([...order].sort((a, b) => a - b), order);
    assert.equal((calendarHtml.match(/studios-repo\.js/g) || []).length, 1);
    assert.match(calendarJs, /function openEventById\(id\) \{[\s\S]*?if \(event\.readonly\) \{[\s\S]*?event\.sourceType === 'studio_booking'[\s\S]*?showToast\(`\$\{event\.title\} · la gestiona el estudio`\);\s*return;/);
});
