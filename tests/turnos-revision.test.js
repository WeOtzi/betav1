'use strict';

// Turnos (revisión): errores sin detalles de la base, fecha precargada desde la
// URL aunque no haya turno, liberación del apartado al responder sin reservarlo
// y acuerdo que reserva el turno apartado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function fakeRes() {
    return {
        statusCode: 200, headers: {}, headersSent: false,
        set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; this.headersSent = true; return this; },
    };
}

test('rutas de turnos: un error crudo de PostgREST no llega al cliente', async () => {
    const { register, mapDbError } = require('../lib/routes/turnos');
    const routes = {};
    const app = { get: (p, h) => { routes['GET ' + p] = h; }, put: (p, h) => { routes['PUT ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
    const raw = Object.assign(new Error('PostgREST GET artists_db failed (400): {"code":"22P02","details":"columna secreta"}'), { status: 400 });
    const repo = { getPublicArtistByUsername: async () => { throw raw; } };
    const origError = console.error;
    console.error = () => {};
    try {
        register(app, { repo, service: { context: async () => ({}) }, startJob: false, emailService: { sendEmail: async () => ({ ok: true }) } });
        const res = fakeRes();
        await routes['GET /api/public/artists/:username/slots']({ params: { username: 'ana' }, query: {} }, res);
        assert.equal(res.statusCode, 500);
        assert.doesNotMatch(JSON.stringify(res.body), /PostgREST|secreta|22P02/);
        assert.equal(res.body.error, 'No pudimos cargar los turnos del artista.');
    } finally {
        console.error = origError;
    }
    assert.equal(mapDbError(raw).expose, undefined, 'el error crudo no se expone');
    assert.equal(mapDbError(new Error('{"code":"23P01","message":"SLOT_TAKEN"}')).status, 409);
});

test('intake con turno: un fallo de la base responde 502 genérico, sin el texto de PostgREST', async () => {
    const { handleSlotIntake } = require('../lib/turnos-intake');
    const service = {
        validateRequestedSlot: async () => ({ ok: true, ctx: { tz: 'UTC' }, start: '2099-01-05T10:00:00.000Z', minutes: 180 }),
        invalidate() {},
    };
    const repo = {
        saveWithSlot: async () => {
            throw Object.assign(new Error('PostgREST POST rpc/save_web_quotation_with_slot failed (409): {"code":"23505","details":"Key (quotation_id)=(1)"}'), { status: 409 });
        },
    };
    const res = fakeRes();
    await handleSlotIntake(res, { q: { quote_id: 'QN1' }, extras: {}, slot: { start: '2099-01-05T10:00:00.000Z', minutes: 180 }, artist: { user_id: 'a1' } },
        { service, repo, log: { warn() {}, error() {} } });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'quote_error');
    assert.doesNotMatch(JSON.stringify(res.body), /PostgREST|23505|quotation_id/);
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

test('quotation-slot: ?date= precarga el día aunque el artista no tome reservas online (CC-10)', async () => {
    const w = loadQuotationSlot(async () => ({ enabled: false, timezone: 'UTC' }));
    w.WoQuotationSlot.captureFromUrl(new URLSearchParams('artist=ana&date=2099-11-23&time=10:00'));
    const fd = { artist_username: 'ana.wo' };
    await w.WoQuotationSlot.onArtist(fd);
    assert.equal(fd.requested_slot, undefined);
    assert.equal(fd._preferred_date_iso, '2099-11-23');
    assert.equal(fd.client_preferred_date, '23 nov 2099');
    assert.equal(fd.client_flexible_dates, false);
});

test('quotation-slot: sin servidor igual precarga el día; nunca una fecha pasada', async () => {
    const w = loadQuotationSlot(async () => { throw new Error('offline'); });
    w.WoQuotationSlot.captureFromUrl(new URLSearchParams('date=2099-02-01'));
    const fd = { artist_username: 'ana.wo' };
    await w.WoQuotationSlot.onArtist(fd);
    assert.equal(fd._preferred_date_iso, '2099-02-01');
    const past = loadQuotationSlot(async () => ({ enabled: false, timezone: 'UTC' }));
    past.WoQuotationSlot.captureFromUrl(new URLSearchParams('date=2001-02-01'));
    const fd2 = { artist_username: 'ana.wo' };
    await past.WoQuotationSlot.onArtist(fd2);
    assert.equal(fd2._preferred_date_iso, undefined);
});

test('detalle: responder sin reservar libera el apartado y el acuerdo reserva el turno apartado', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    assert.match(js, /data\.reserve_slot_offered === '1' && data\.reserve_slot !== '1'/);
    assert.match(js, /WoSlotHold\.releaseFor\(q, 'artist_declined'\)/);
    assert.match(js, /WoSlotHold\.pendingStart\(q\)/);
    // La reserva va antes de aprobar: si el turno choca, no queda un acuerdo a medias.
    const agreement = js.slice(js.indexOf('function openAgreementDialog'));
    const reserve = agreement.indexOf('confirmFor(q, { starts_at: first, minutes })');
    assert.ok(reserve > 0);
    assert.ok(reserve < agreement.indexOf('await updateQuote(patch);'));
    const hold = read('public/shared/js/quotation-slot-hold.js');
    assert.match(hold, /name="reserve_slot_offered"/);
    assert.match(hold, /releaseFor: function/);
    assert.match(hold, /pendingStart: function/);
});

test('migración: un borrador que se reenvía reemplaza su apartado anterior (sin choque del índice único)', () => {
    const sql = read('supabase/migrations/20261115160000_turnos_reservas_online.sql');
    const fn = sql.slice(sql.indexOf('create or replace function public.save_web_quotation_with_slot'),
        sql.indexOf('create or replace function public.confirm_artist_slot_hold'));
    assert.match(fn, /released_reason = 'resubmitted'/);
    assert.ok(fn.indexOf("'resubmitted'") < fn.indexOf('insert into public.artist_booking_holds'));
});
