'use strict';

// Turnos (frente "turnos"): contratos de páginas, scripts y rutas públicas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const order = (html, a, b) => html.indexOf(a) !== -1 && html.indexOf(b) !== -1 && html.indexOf(a) < html.indexOf(b);

test('página pública /turnos: DS, modelos, repo y script propio; sin supabase-js', () => {
    const html = read('public/turnos/index.html');
    assert.match(html, /<html lang="es">/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /\/shared\/css\/booking\.css/);
    assert.ok(order(html, 'account-availability-model.js', 'booking-slots-model.js'));
    assert.ok(order(html, 'data/booking-repo.js', 'public-slots.js'));
    assert.doesNotMatch(html, /supabase-js/);
    const js = read('public/shared/js/public-slots.js');
    assert.match(js, /\/quotation\?artist=/);
    assert.match(js, /&slot=' \+ encodeURIComponent\(slot\.start\) \+ '&dur='/);
    assert.match(js, /function esc\(/);
    assert.match(js, /aria-pressed/);
});

test('/quotation carga el turno elegido antes de script.js y script.js usa los hooks', () => {
    const html = read('public/quotation/index.html');
    assert.ok(order(html, '/shared/js/quotation-slot.js', '/shared/js/script.js'));
    assert.ok(order(html, 'data/booking-repo.js', '/shared/js/quotation-slot.js'));
    const js = read('public/shared/js/script.js');
    for (const hook of ['captureFromUrl(initialUrlParams)', 'WoQuotationSlot.onArtist(formData)', 'WoQuotationSlot.cardHtml(formData)',
        'WoQuotationSlot.daySlotsHtml(formData)', 'WoQuotationSlot.busyIndex(formData, year, month)', 'WoQuotationSlot.payload(formData, mode)',
        'WoQuotationSlot.precheck(formData)', 'WoQuotationSlot.handleSubmitError(error']) {
        assert.ok(js.includes(hook), hook);
    }
    // Integración (script.js de cot-form): el error del intake expone code y payload.
    const intakeError = js.slice(js.indexOf('function intakeError('), js.indexOf('function intakeError(') + 600);
    assert.match(intakeError, /if \(data && data\.code\) error\.code = data\.code;/);
    assert.match(intakeError, /error\.payload = data \|\| \{\};/);
    assert.ok(js.indexOf('WoQuotationSlot.payload(formData, mode)') !== -1);
});

function loadQuotationSlot(publicSlots) {
    const window = {
        WeotziData: { Booking: { publicSlots } },
        location: { pathname: '/quotation', origin: 'https://x' },
        persistAnswer() {}, renderInlineCalendar() {}, showToastMessage(msg) { window._toast = msg; },
    };
    const context = vm.createContext({ window, document: { getElementById: () => null }, URLSearchParams, Date, Number, String, Math, Object, Array, Promise, console });
    vm.runInContext(read('public/shared/js/quotation-slot.js'), context);
    return window;
}

test('quotation-slot: valida el turno de la URL y solo lo envía en el envío final', async () => {
    const slot = { start: '2099-11-23T13:00:00.000Z', end: '2099-11-23T16:00:00.000Z', label: '10:00' };
    const w = loadQuotationSlot(async () => ({ enabled: true, slot_minutes: 180, timezone: 'America/Argentina/Buenos_Aires', days: [{ date: '2099-11-23', slots: [slot] }] }));
    const S = w.WoQuotationSlot;
    S.captureFromUrl(new URLSearchParams('artist=ana&slot=2099-11-23T13:00:00Z&dur=180'));
    const fd = { artist_username: 'ana.wo' };
    await S.onArtist(fd);
    assert.equal(fd.requested_slot.start, slot.start);
    assert.equal(fd.requested_slot.minutes, 180);
    assert.equal(fd._preferred_date_iso, '2099-11-23');
    assert.equal(fd.client_flexible_dates, false);
    assert.deepEqual(JSON.parse(JSON.stringify(S.payload(fd, 'draft'))), {});
    assert.deepEqual(JSON.parse(JSON.stringify(S.payload(fd, 'submit'))), { requested_slot: { start: slot.start, minutes: 180 } });
    assert.match(S.cardHtml(fd), /Turno elegido/);
    S.onDatePicked('2099-11-24');
    assert.equal(fd.requested_slot, undefined, 'otro día descarta el turno');
});

test('quotation-slot: turno tomado → aviso y sin turno; artista sin reservas → undefined para la RPC de días', async () => {
    const w = loadQuotationSlot(async () => ({ enabled: true, slot_minutes: 180, timezone: 'UTC', days: [] }));
    w.WoQuotationSlot.captureFromUrl(new URLSearchParams('slot=2099-11-23T13:00:00Z&dur=180'));
    const fd = { artist_username: 'ana.wo' };
    await w.WoQuotationSlot.onArtist(fd);
    assert.equal(fd.requested_slot, undefined);
    assert.match(w._toast, /ya no está disponible/);
    const off = loadQuotationSlot(async () => ({ enabled: false, timezone: 'UTC' }));
    const fd2 = { artist_username: 'otro.wo' };
    await off.WoQuotationSlot.onArtist(fd2);
    assert.equal(off.WoQuotationSlot.busyIndex(fd2, 2099, 10), undefined);
});

test('dashboard, calendario y cuenta montan turnos con sus scripts', () => {
    const dash = read('public/artist/dashboard/index.html');
    assert.match(dash, /data-booking-summary="dashboard"/);
    assert.ok(order(dash, 'data/booking-repo.js', 'booking-summary.js'));
    assert.ok(order(dash, 'dashboard-share.js', 'booking-summary.js'));
    const cal = read('public/calendar/index.html');
    assert.match(cal, /data-booking-summary="calendar"/);
    assert.ok(order(cal, 'data/booking-repo.js', 'data/calendar-repo.js'));
    const acc = read('public/artist/account/index.html');
    assert.match(acc, /<section data-booking-settings id="reservas-online"><\/section>/);
    assert.ok(order(acc, 'id="aac-disponibilidad"', 'data-booking-settings'));
    assert.ok(order(acc, 'data/booking-repo.js', 'booking-settings-panel.js'));
    const summary = read('public/shared/js/booking-summary.js');
    for (const s of ['Semana', 'Mes', '3 meses', 'Año', 'Compartir turnos', 'Configurar horario', 'Reservas online apagadas', 'Reintentar']) assert.ok(summary.includes(s), s);
    assert.match(read('public/shared/js/calendar.js'), /WoBookingSummary\.monthPhrase/);
    assert.match(read('public/shared/js/data/calendar-repo.js'), /listHoldsProjection\(rangeStart, rangeEnd\)/);
});

test('compartir: destino Turnos en el panel del dashboard', () => {
    const js = read('public/shared/js/dashboard-share.js');
    assert.match(js, /\[\x27profile\x27, \x27gallery\x27, \x27turnos\x27\]/);
    assert.match(js, /\/turnos\?artist=/);
    assert.match(js, /wod-seg--3/);
});

test('perfil público: sección #turnos oculta por defecto y "Reservar sesión" a /turnos con reservas activas', () => {
    const html = read('public/artist/profile/index.html');
    assert.match(html, /<section class="profile-band bk-profile-band" id="turnos" aria-labelledby="turnos-title" hidden>/);
    assert.ok(order(html, '/shared/js/artist-profile.js', 'profile-turnos.js'));
    assert.match(read('public/shared/js/artist-profile.js'), /window\.WoProfileTurnos && window\.WoProfileTurnos\.reserveUrl/);
});

test('detalle de cotización: tarjeta del turno, reserva al aceptar y acuerdo sin pedir otra primera sesión', () => {
    const html = read('public/my-quotations/detail/index.html');
    assert.ok(order(html, 'quotation-slot-hold.js', 'quotation-detail-figma.js'));
    const js = read('public/shared/js/quotation-detail-figma.js');
    assert.match(js, /qd-slot-hold-slot/);
    assert.match(js, /data\.reserve_slot === '1' && window\.WoSlotHold\) await window\.WoSlotHold\.confirmFor\(q\)/);
    assert.ok(js.indexOf('WoSlotHold.confirmFor(q)') < js.indexOf('await updateQuote(patch);\n') || /confirmFor\(q\);\s*\n\s*await updateQuote\(patch\)/.test(js));
    assert.match(js, /CALENDAR_OVERLAP\|SLOT_TAKEN/);
    assert.match(js, /holdSession \? holdSession\.session_date/);
});

test('server.js registra las rutas de turnos antes del manejador 404', () => {
    const src = read('server.js');
    const reg = src.indexOf("require('./lib/routes/turnos').register(app");
    assert.ok(reg > 0);
    assert.ok(reg < src.indexOf("app.get('*'"));
    const intake = read('services/quotation-intake.js');
    assert.match(intake, /const body = req\.body \|\| \{\};/);
    assert.match(intake, /const slot = turnosIntake\.requestedSlot\(body\);\s*\n\s*if \(slot\) return await handleSlotSubmit\(/);
});

test('API pública de turnos: solo inicio/fin/etiqueta, nunca ids ni datos de eventos', async () => {
    const { register } = require('../lib/routes/turnos');
    const routes = {};
    const app = { get: (p, h) => { routes['GET ' + p] = h; }, put: (p, h) => { routes['PUT ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
    const repo = {
        getPublicArtistByUsername: async () => ({ user_id: 'secret-uuid', username: 'ana.wo', name: 'Ana', profile_picture: null, city: 'CABA', email: 'no@x' }),
    };
    const ctx = { settings: { enabled: true, slot_minutes: 180, horizon_days: 365, min_notice_hours: 24, public_note: null }, tz: 'UTC' };
    const service = {
        context: async () => ctx,
        getSlots: async () => ({ ctx, result: { reason: null, days: [{ date: '2099-01-05', open: { s: 1, e: 2 }, windows: [{ s: 1, e: 2 }], slots: [{ start: '2099-01-05T10:00:00.000Z', end: '2099-01-05T13:00:00.000Z' }] }] } }),
    };
    register(app, { repo, service, startJob: false, emailService: { sendEmail: async () => ({ ok: true }) } });
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await routes['GET /api/public/artists/:username/slots']({ params: { username: 'ana' }, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'public, max-age=60');
    const text = JSON.stringify(res.body);
    assert.doesNotMatch(text, /secret-uuid|no@x|windows|"open"/);
    assert.deepEqual(res.body.days, [{ date: '2099-01-05', slots: [{ start: '2099-01-05T10:00:00.000Z', end: '2099-01-05T13:00:00.000Z', label: '10:00' }] }]);
    for (const r of ['GET /api/calendar/availability', 'PUT /api/calendar/booking-settings', 'GET /api/calendar/booking-holds',
        'POST /api/turnos/holds/:id/confirm', 'POST /api/turnos/holds/:id/release', 'GET /api/turnos/quotations/:id/hold', 'POST /api/turnos/maintenance/expire']) {
        assert.equal(typeof routes[r], 'function', r);
    }
});
