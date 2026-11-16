'use strict';

// Ronda 2 · frente cot-respuesta: modelo puro de la propuesta del artista
// (public/shared/js/quote-respond-model.js) y contratos de los archivos del
// frente (HTML, expediente, migración, saldo acordado, panel del cliente).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const M = require('../public/shared/js/quote-respond-model.js');
const B = require('../public/shared/js/booking-slots-model.js');
const PM = require('../public/shared/js/quotation-payments-model.js');
const VM = require('../public/shared/js/quotations-view-model.js');
const CQP = require('../public/shared/js/client-quote-proposal.js');

const TZ = 'America/Argentina/Buenos_Aires';
const NOW = Date.parse('2026-11-16T15:00:00Z'); // lunes 16 nov 2026, 12:00 en Buenos Aires
const WEEKLY = B.DAY_KEYS.map((day, i) => ({ day, enabled: i < 5, start: '10:00', end: '18:00' }));

const VOSEO = /\b(querés|podés|tenés|sabés|elegí|ingresá|contanos|contame|escribí|escribile|revisá|revisala|probá|hacé|mirá|usá|agregá|guardá|iniciá|indicá|subí|sumá|quitá|quitala|editá|abrí|contale|mandale|pagala|avisá|fijate|destildás|activalo|aprobala|respondele|coordiná|confirmá|actualizá|desarchivá|dejá|vos)\b/i;

function agenda(extra = {}) {
    return M.computeAgenda(Object.assign({
        tz: TZ, from: '2026-11-15', to: '2026-11-27', now: NOW, minutes: 180, settings: {},
        availability: { weekly: WEEKLY }, locations: [],
        busy: M.confirmedBusy([
            { starts_at: '2026-11-18T13:00:00Z', ends_at: '2026-11-18T21:00:00Z', kind: 'session' }, // mié: todo el horario
            { starts_at: '2026-11-19T16:00:00Z', ends_at: '2026-11-19T19:00:00Z', kind: 'event' }, // jue 13–16
            { starts_at: '2026-11-20T16:00:00Z', ends_at: '2026-11-20T19:00:00Z', kind: 'hold' }, // apartado pendiente
            { starts_at: '2026-11-24T03:00:00Z', ends_at: '2026-11-27T03:00:00Z', kind: 'trip' }, // viaje 24–26
        ], []),
    }, extra));
}
const statusOf = (a, date) => a.days.find((d) => d.date === date).status;

// --------------------------------------------------------------- P25 · estados
test('P25: se puede (re)enviar la propuesta mientras no esté aprobada por ambas partes', () => {
    assert.deepEqual(M.canPropose({ quote_status: 'pending' }), { ok: true, mode: 'respond' });
    assert.deepEqual(M.canPropose({ quote_status: 'responded' }), { ok: true, mode: 'update' });
    assert.equal(M.canPropose({ quote_status: 'expired' }).mode, 'requote');
    // P23: el rechazo del cliente es definitivo; el artista no vuelve a cotizar sobre esa cotización.
    const rejected = M.canPropose({ quote_status: 'client_rejected' });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'client_rejected');
    assert.match(rejected.reason, /quedó finalizada/);
    assert.equal(rejected.mode, undefined);
    assert.equal(M.proposalMode({ quote_status: 'client_rejected' }), 'respond', 'requote queda solo para las vencidas');
    // Un estado nuevo de la negociación no queda afuera (lista de bloqueo).
    assert.equal(M.canPropose({ quote_status: 'client_counter_proposal' }).ok, true);
    for (const status of ['client_approved', 'artist_completed', 'completed']) {
        const res = M.canPropose({ quote_status: status });
        assert.equal(res.ok, false, status);
        assert.equal(res.code, 'approved');
        assert.match(res.reason, /aprobada por ambas partes/);
    }
    assert.equal(M.canPropose({ quote_status: 'in_progress', artist_responded_at: '2026-11-01T10:00:00Z' }).code, 'approved');
    assert.equal(M.canPropose({ quote_status: 'in_progress' }).code, 'draft', 'in_progress sin respuesta es el borrador del cliente');
    assert.equal(M.canPropose({ quote_status: 'cancelled' }).code, 'cancelled');
    assert.equal(M.canPropose({ quote_status: 'responded', dispute_status: 'open' }).code, 'dispute');
    assert.equal(M.canPropose(null).ok, false);
});

test('P4: el saldo acordado solo está activo con la cotización aprobada por ambas partes', () => {
    for (const status of ['pending', 'responded', 'expired', 'client_rejected', 'cancelled']) {
        assert.equal(M.agreementActive({ quote_status: status }), false, status);
        assert.equal(PM.agreementActive({ quote_status: status }), false, status);
    }
    for (const status of ['client_approved', 'artist_completed', 'completed']) {
        assert.equal(M.agreementActive({ quote_status: status }), true, status);
        assert.equal(PM.agreementActive({ quote_status: status }), true, status);
    }
    assert.equal(PM.agreementActive({ quote_status: 'in_progress' }), false, 'borrador');
    assert.equal(PM.agreementActive({ quote_status: 'in_progress', artist_responded_at: '2026-11-01T10:00:00Z' }), true);
    assert.deepEqual(M.APPROVED_STATUSES, PM.AGREED_STATUSES, 'una sola definición de "aprobada por ambos"');

    const proposed = PM.summarize({ quote_status: 'responded', artist_budget_amount: 500, artist_budget_currency: 'USD' }, null, []);
    assert.equal(proposed.active, false);
    assert.equal(proposed.total, 500, 'el presupuesto propuesto se sigue informando');
    const agreed = PM.summarize({ quote_status: 'client_approved', final_budget_amount: 500, final_budget_currency: 'USD' }, null, []);
    assert.equal(agreed.active, true);
    assert.equal(agreed.balance, 500);

    const panel = read('public/shared/js/quotation-payments-panel.js');
    assert.match(panel, /var proposed = s\.active === false;/);
    assert.match(panel, /else if \(proposed\) title = 'Presupuesto propuesto '/);
    assert.match(panel, /\(proposed \? 'Propuesto' : 'Acordado'\)/);
    assert.match(panel, /Se activa cuando el cliente aprueba la propuesta/);
    assert.match(panel, /s\.total && !proposed \? '<div class="qpp-bar"/, 'sin barra de cobro antes del acuerdo');
    const dialog = read('public/shared/js/quotation-payment-dialog.js');
    assert.match(dialog, /\(proposed \? 'Propuesto' : 'Acordado'\)/);
    assert.match(dialog, /!proposed && s\.balance != null/);
});

// ------------------------------------------------------- P4 · respuestas rápidas
test('P4: variables de las respuestas rápidas y mensaje resuelto', () => {
    assert.deepEqual(M.VARIABLES.map((v) => v.key), ['cliente', 'presupuesto', 'moneda', 'sesiones', 'duracion', 'seña', 'fechas', 'estudio', 'artista']);
    const vars = M.templateVars({
        clientName: 'Ana Pérez', artistName: 'Mateo Rivas', amount: '410.000', currency: 'ars', sessions: 2, minutes: 150,
        depositPct: 30, offerLabels: ['sáb 5 dic 2026 · 14:00–17:00', '10 al 15 dic 2026'], location: 'Estudio Norte',
    });
    assert.deepEqual(vars, {
        cliente: 'Ana', presupuesto: '410.000', moneda: 'ARS', sesiones: '2 sesiones', duracion: '2 h 30 min',
        'seña': '30 % (123.000 ARS)', fechas: 'sáb 5 dic 2026 · 14:00–17:00; 10 al 15 dic 2026',
        estudio: 'Estudio Norte', artista: 'Mateo Rivas',
    });
    const out = M.resolveTemplate('Hola {{cliente}}: {{presupuesto}} {{moneda}}, {{ SENA }}, {{Duración}}, {{fechas}}. {{otra}}', vars);
    assert.equal(out.text, 'Hola Ana: 410.000 ARS, 30 % (123.000 ARS), 2 h 30 min, sáb 5 dic 2026 · 14:00–17:00; 10 al 15 dic 2026. {{otra}}');
    assert.deepEqual(out.unknown, ['{{otra}}']);
    assert.deepEqual(out.empty, []);

    // Sin datos: nada de "undefined" ni huecos antes de la puntuación.
    const empty = M.resolveTemplate('Hola {{cliente}}, te ofrezco {{fechas}} con {{seña}} en {{estudio}}.', M.templateVars({}));
    assert.equal(empty.text, 'Hola, te ofrezco a coordinar con sin anticipo en a confirmar.');
    assert.deepEqual(empty.empty, ['cliente']);
    assert.equal(M.templateVars({ sessions: 1, minutes: 60 }).sesiones, '1 sesión');
    assert.equal(M.templateVars({ minutes: 45 }).duracion, '45 min');
});

test('P4: set por defecto en español neutro, solo con variables conocidas', () => {
    assert.ok(M.DEFAULT_TEMPLATES.length >= 3);
    for (const t of M.DEFAULT_TEMPLATES) {
        assert.ok(t.id && t.title && t.body, 'plantilla completa');
        assert.doesNotMatch(t.body + ' ' + t.title, VOSEO, t.id);
        assert.deepEqual(M.resolveTemplate(t.body, M.templateVars({ clientName: 'Ana' })).unknown, [], t.id);
        assert.ok(M.validateTemplate(t).ok, t.id);
    }
});

test('P4: insertar una variable en el cursor y validar una respuesta rápida', () => {
    assert.deepEqual(M.insertVariable('Hola', 'cliente', 4, 4), { text: 'Hola {{cliente}}', caret: 16 });
    assert.deepEqual(M.insertVariable('Hola , gracias', 'cliente', 5, 5), { text: 'Hola {{cliente}}, gracias', caret: 16 });
    assert.equal(M.insertVariable('Total: XX aprox', 'presupuesto', 7, 9).text, 'Total: {{presupuesto}} aprox');
    assert.equal(M.insertVariable('', 'fechas').text, '{{fechas}}');
    assert.equal(M.validateTemplate({ title: '', body: 'x' }).errors.title, 'Ponle un nombre a la respuesta rápida.');
    assert.equal(M.validateTemplate({ title: 'a', body: ' ' }).errors.body, 'Escribe el mensaje antes de guardarlo.');
    assert.equal(M.validateTemplate({ title: 'x'.repeat(81), body: 'ok' }).ok, false);
    assert.deepEqual(M.validateTemplate({ title: ' Anticipo ', body: ' Hola {{cliente}} ' }).value, { title: 'Anticipo', body: 'Hola {{cliente}}' });
});

// ----------------------------------------------------------- P4 · fechas ofrecidas
test('P4: una fecha ofrecida es un turno con horario o un rango de días', () => {
    const slot = M.normalizeOffer({ kind: 'slot', start: '2026-12-05T17:00:00Z', end: '2026-12-05T20:00:00Z' }, { tz: TZ, now: NOW });
    assert.deepEqual(slot, { ok: true, value: { kind: 'slot', start: '2026-12-05T17:00:00.000Z', end: '2026-12-05T20:00:00.000Z' } });
    assert.equal(M.offerLabel(slot.value, TZ), 'sáb 5 dic 2026 · 14:00–17:00');

    const range = M.normalizeOffer({ kind: 'range', from: '2026-12-10', to: '2026-12-15' }, { tz: TZ, now: NOW });
    assert.equal(range.ok, true);
    assert.equal(range.value.start, '2026-12-10T03:00:00.000Z', 'medianoche local del primer día');
    assert.equal(range.value.end, '2026-12-16T03:00:00.000Z', 'fin del último día');
    assert.equal(M.offerLabel(range.value, TZ), '10 al 15 dic 2026');
    assert.equal(M.rangeLabel('2026-11-28', '2026-12-03'), '28 nov al 3 dic 2026');
    assert.equal(M.rangeLabel('2026-12-28', '2027-01-03'), '28 dic 2026 al 3 ene 2027');
    assert.equal(M.rangeLabel('2026-12-05', '2026-12-05'), 'sáb 5 dic 2026');

    const bad = (raw) => M.normalizeOffer(raw, { tz: TZ, now: NOW });
    assert.match(bad({ kind: 'slot', start: '2026-11-10T17:00:00Z', end: '2026-11-10T20:00:00Z' }).error, /ya pasó/);
    assert.match(bad({ kind: 'slot', start: '2026-12-05T20:00:00Z', end: '2026-12-05T17:00:00Z' }).error, /termina antes/);
    assert.match(bad({ kind: 'slot', start: '2026-12-05T17:00:00Z', end: '2026-12-05T17:10:00Z' }).error, /15 minutos/);
    assert.match(bad({ kind: 'slot', start: 'x', end: 'y' }).error, /no es válido/);
    assert.match(bad({ kind: 'slot', start: '2028-12-05T17:00:00Z', end: '2028-12-05T20:00:00Z' }).error, /12 meses/);
    assert.match(bad({ kind: 'range', from: '2026-11-01', to: '2026-11-20' }).error, /ya pasó/);
    assert.match(bad({ kind: 'range', from: '2026-12-10', to: '2026-12-01' }).error, /antes de empezar/);
    assert.match(bad({ kind: 'range', from: '2026-12-01', to: '2027-01-15' }).error, /hasta 31 días/);
    assert.match(bad({ kind: 'range', from: '2026-02-30', to: '2026-03-01' }).error, /no es válido/);
    assert.equal(bad(null).ok, false);
});

test('P4: varias fechas — sin duplicados, ordenadas y con tope', () => {
    const list = [
        { kind: 'range', from: '2026-12-10', to: '2026-12-15' },
        { kind: 'slot', start: '2026-12-05T17:00:00Z', end: '2026-12-05T20:00:00Z' },
        { kind: 'slot', start: '2026-12-05T17:00:00.000Z', end: '2026-12-05T20:00:00.000Z' },
    ];
    const res = M.normalizeOffers(list, { tz: TZ, now: NOW });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value.map((o) => [o.kind, o.index]), [['slot', 1], ['range', 0]]);
    const tooMany = Array.from({ length: M.MAX_OFFERS + 1 }, (_, i) => ({ kind: 'range', from: B.addDays('2026-12-01', i), to: B.addDays('2026-12-01', i) }));
    assert.match(M.normalizeOffers(tooMany, { tz: TZ, now: NOW }).errors[0].error, /hasta 12 fechas/);
    const mixed = M.normalizeOffers([list[0], { kind: 'slot', start: 'x', end: 'y' }], { tz: TZ, now: NOW });
    assert.equal(mixed.ok, false);
    assert.deepEqual(mixed.errors.map((e) => e.index), [1]);
    assert.deepEqual(M.normalizeOffers(undefined, { tz: TZ, now: NOW }), { ok: true, value: [], errors: [] });
});

test('P4: lo guardado en offered_slots, el resumen en texto y la vuelta al diálogo', () => {
    const offers = M.normalizeOffers([
        { kind: 'slot', start: '2026-12-05T17:00:00Z', end: '2026-12-05T20:00:00Z' },
        { kind: 'range', from: '2026-12-10', to: '2026-12-15' },
    ], { tz: TZ, now: NOW }).value;
    const stored = M.storedOffers(offers, TZ);
    assert.deepEqual(stored, [
        { kind: 'slot', start: '2026-12-05T17:00:00.000Z', end: '2026-12-05T20:00:00.000Z', label: 'sáb 5 dic 2026 · 14:00–17:00', tz: TZ },
        { kind: 'range', start: '2026-12-10T03:00:00.000Z', end: '2026-12-16T03:00:00.000Z', label: '10 al 15 dic 2026', tz: TZ, from: '2026-12-10', to: '2026-12-15' },
    ]);
    const summary = M.offersSummary(stored, 'Prefiero turnos de tarde', TZ);
    assert.equal(summary, 'Prefiero turnos de tarde; sáb 5 dic 2026 · 14:00–17:00; 10 al 15 dic 2026');
    assert.equal(M.noteFromSummary(summary, stored), 'Prefiero turnos de tarde');
    assert.equal(M.noteFromSummary(M.offersSummary(stored, '', TZ), stored), '');
    assert.equal(M.noteFromSummary('Fines de semana, desde agosto', []), 'Fines de semana, desde agosto');
    assert.equal(M.offersSummary([], '', TZ), '');
    // Reabrir el diálogo: lo que ya pasó no vuelve.
    assert.deepEqual(M.offersFromStored(stored, { now: NOW }).map((o) => o.kind), ['slot', 'range']);
    assert.deepEqual(M.offersFromStored(stored, { now: Date.parse('2026-12-12T00:00:00Z') }).map((o) => o.kind), ['range']);
    assert.deepEqual(M.offersFromStored('nada'), []);
    assert.deepEqual(M.offersSpan(offers, TZ), { from: '2026-12-05', to: '2026-12-15' });
    // Un resumen muy largo se corta con el conteo de lo que falta.
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `Turno muy largo número ${i} con texto de relleno para superar el límite del resumen` }));
    const long = M.offersSummary(many, 'x'.repeat(140), TZ);
    assert.ok(long.length <= 720, String(long.length));
    assert.match(long, /; y \d+ más$/);
});

// ------------------------------------------------------------ P4 · agenda real
test('P4: lo confirmado bloquea; los apartados pendientes y lo propio de la cotización no', () => {
    const busy = M.confirmedBusy([
        { starts_at: '2026-11-18T13:00:00Z', ends_at: '2026-11-18T16:00:00Z', kind: 'session' },
        { starts_at: '2026-11-19T13:00:00Z', ends_at: '2026-11-19T16:00:00Z', kind: 'session' }, // de esta cotización
        { starts_at: '2026-11-20T13:00:00Z', ends_at: '2026-11-20T16:00:00Z', kind: 'hold' },
        { starts_at: '2026-11-21T13:00:00Z', ends_at: '2026-11-21T16:00:00Z', kind: 'studio_booking' },
        { starts_at: '2026-11-22T03:00:00Z', ends_at: '2026-11-23T03:00:00Z', kind: 'vacation' },
        { starts_at: 'x', ends_at: 'y', kind: 'event' },
    ], [{ start: '2026-11-19T13:00:00Z', end: '2026-11-19T16:00:00Z' }]);
    assert.deepEqual(busy.map((b) => b.kind), ['session', 'studio_booking', 'vacation']);
    assert.deepEqual(M.CONFIRMED_KINDS, ['event', 'session', 'studio_booking', 'trip', 'vacation']);
    assert.ok(M.CONFIRMED_KINDS.indexOf('hold') === -1);
});

test('P4: estado de cada día con el horario semanal real', () => {
    const a = agenda();
    assert.equal(a.schedule, 'own');
    assert.equal(statusOf(a, '2026-11-15'), 'past');
    assert.equal(statusOf(a, '2026-11-16'), 'free', 'hoy, con turnos desde ahora');
    assert.equal(statusOf(a, '2026-11-17'), 'free');
    assert.equal(statusOf(a, '2026-11-18'), 'busy', 'la sesión ocupa todo el horario');
    assert.equal(statusOf(a, '2026-11-19'), 'partial');
    assert.equal(statusOf(a, '2026-11-20'), 'free', 'un apartado pendiente no ocupa');
    assert.equal(statusOf(a, '2026-11-21'), 'closed', 'sábado sin horario');
    for (const d of ['2026-11-24', '2026-11-25', '2026-11-26']) assert.equal(statusOf(a, d), 'busy', `viaje ${d}`);
    assert.equal(statusOf(a, '2026-11-27'), 'free');
    const tue = a.days.find((d) => d.date === '2026-11-17');
    assert.deepEqual(tue.slots[0], { start: '2026-11-17T13:00:00.000Z', end: '2026-11-17T16:00:00.000Z' }, '10:00 local, 3 h');
    assert.equal(a.days.find((d) => d.date === '2026-11-16').slots.length, 4, 'hoy solo desde las 12:00');
});

test('P4: sin horario guardado se usa una jornada genérica y se avisa', () => {
    const a = agenda({ availability: null, busy: [] });
    assert.equal(a.schedule, 'default');
    assert.equal(statusOf(a, '2026-11-21'), 'free', 'todos los días abren 09–21');
    const pub = M.publicAgenda(a);
    assert.equal(pub.schedule, 'default');
    assert.equal(pub.days.find((d) => d.date === '2026-11-21').open, '09:00–21:00');
});

test('P4: forma pública del calendario (lo que recibe el navegador)', () => {
    const pub = M.publicAgenda(agenda());
    assert.equal(pub.timezone, TZ);
    assert.equal(pub.minutes, 180);
    const thu = pub.days.find((d) => d.date === '2026-11-19');
    assert.deepEqual(thu, {
        date: '2026-11-19', status: 'partial', open: '10:00–18:00', slots: [],
        busy: [{ start: '2026-11-19T16:00:00.000Z', end: '2026-11-19T19:00:00.000Z', kind: 'event', label: 'Evento del calendario · 13:00–16:00' }],
    });
    const trip = pub.days.find((d) => d.date === '2026-11-25');
    assert.equal(trip.busy[0].label, 'Viaje confirmado · todo el día');
    assert.deepEqual(Object.keys(pub.days[0]).sort(), ['busy', 'date', 'open', 'slots', 'status'], 'sin datos internos');
    assert.equal(pub.days.find((d) => d.date === '2026-11-17').slots[0].label, '10:00–13:00');
});

test('P4: el servidor rechaza las fechas que chocan con algo confirmado', () => {
    const a = agenda();
    const offers = M.normalizeOffers([
        { kind: 'slot', start: '2026-11-18T14:00:00Z', end: '2026-11-18T17:00:00Z' }, // choca con la sesión
        { kind: 'slot', start: '2026-11-19T13:00:00Z', end: '2026-11-19T15:30:00Z' }, // antes del evento: libre
        { kind: 'slot', start: '2026-11-20T16:00:00Z', end: '2026-11-20T19:00:00Z' }, // sobre un apartado pendiente: libre
        { kind: 'slot', start: '2026-11-21T14:00:00Z', end: '2026-11-21T17:00:00Z' }, // sábado sin horario: se puede ofrecer
        { kind: 'range', from: '2026-11-23', to: '2026-11-26' }, // incluye el viaje
        { kind: 'range', from: '2026-11-20', to: '2026-11-23' }, // limpio (cruza el fin de semana)
    ], { tz: TZ, now: NOW });
    assert.equal(offers.ok, true);
    const conflicts = M.findConflicts(offers.value, a);
    assert.deepEqual(conflicts.map((c) => [c.index, c.kind]), [[0, 'slot'], [4, 'range']]);
    assert.equal(conflicts[0].reason, 'Se superpone con una sesión agendada.');
    assert.equal(conflicts[0].label, 'mié 18 nov 2026 · 11:00–14:00');
    assert.match(conflicts[1].reason, /Incluye días ocupados en tu agenda: 24 nov, 25 nov, 26 nov\./);
    assert.deepEqual(conflicts[1].dates, ['2026-11-24', '2026-11-25', '2026-11-26']);
    assert.deepEqual(M.findConflicts([], a), []);
});

test('P4: un rango que cruza días ocupados se parte alrededor de ellos', () => {
    const a = agenda();
    const split = M.splitRange('2026-11-20', '2026-11-27', (date) => statusOf(a, date));
    assert.deepEqual(split.ranges, [
        { kind: 'range', from: '2026-11-20', to: '2026-11-23' },
        { kind: 'range', from: '2026-11-27', to: '2026-11-27' },
    ]);
    assert.deepEqual(split.skipped, ['2026-11-24', '2026-11-25', '2026-11-26']);
    assert.deepEqual(M.splitRange('2026-11-24', '2026-11-26', (date) => statusOf(a, date)).ranges, []);
    // Lo que el diálogo parte, el servidor lo acepta.
    const ok = M.normalizeOffers(split.ranges, { tz: TZ, now: NOW });
    assert.deepEqual(M.findConflicts(ok.value, a), []);
});

// ---------------------------------------------------------------- P4/P29 · propuesta
const VALID = {
    amount: '410.000', currency: 'ars', sessions: '2', minutes: 180, deposit_pct: '30',
    expiry_enabled: true, expiry_days: '14', location: 'Estudio Norte', complexity: 'Alta',
    availability_note: 'Prefiero tardes', message: 'Hola Ana',
    extras: { items: [], discount_pct: 0, tax_pct: 0, policy: '', client_notes: '', extra_terms: '' },
};

test('P4: validación de la propuesta (mensajes en español neutro)', () => {
    const ok = M.validateProposal(VALID);
    assert.equal(ok.ok, true);
    assert.equal(ok.firstError, null);
    assert.equal(ok.value.amount, 410000);
    assert.equal(ok.value.currency, 'ARS');
    assert.equal(ok.value.depositAmount, 123000);
    assert.equal(ok.value.balance, 287000);
    assert.deepEqual(ok.value.expiry, { enabled: true, days: 14 });
    assert.equal(ok.value.hasBreakdown, false);
    assert.equal(ok.value.hasExtras, true, 'la complejidad ya es un campo de la manual');

    const bad = M.validateProposal({ amount: '0', currency: 'pesos', sessions: '0', minutes: 5, deposit_pct: '150', expiry_enabled: true, expiry_days: '', complexity: 'Extrema', message: 'x'.repeat(2001) });
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'complexity', 'currency', 'deposit_pct', 'expiry_days', 'message', 'minutes', 'sessions']);
    assert.deepEqual(bad.firstError, { field: 'amount', message: 'Ingresa un presupuesto válido.' });
    for (const text of Object.values(bad.errors)) assert.doesNotMatch(text, VOSEO, text);
    for (const field of Object.keys(bad.errors)) assert.ok(M.FIELD_TAB[field], `pestaña para ${field}`);

    // "El mensaje se guarda ya resuelto": una variable cruda no se envía al cliente.
    assert.match(M.validateProposal(Object.assign({}, VALID, { message: 'Hola {{cliente}}, {{otra}}' })).errors.message, /variables sin resolver/);
    const resolved = M.resolveTemplate('Hola {{cliente}}, te ofrezco {{fechas}}.', M.templateVars({ clientName: 'Ana' })).text;
    assert.equal(M.validateProposal(Object.assign({}, VALID, { message: resolved })).ok, true);

    const noDeposit = M.validateProposal(Object.assign({}, VALID, { deposit_pct: '', expiry_enabled: false, complexity: '' }));
    assert.equal(noDeposit.value.depositPct, null);
    assert.equal(noDeposit.value.depositAmount, null);
    assert.deepEqual(noDeposit.value.expiry, { enabled: false, days: null });
    assert.equal(noDeposit.value.hasExtras, false);
    assert.equal(M.validateProposal(Object.assign({}, VALID, { deposit_pct: '0' })).value.depositPct, null);
    assert.equal(M.parseMoney('1.240,50'), 1240.5);
    assert.equal(M.parseMoney('1,240'), 1240);
    assert.equal(M.formatAmount(1240.5), '1.240,50');
    assert.ok(Number.isNaN(M.parseMoney('-5')));
});

test('P29: el desglose económico manda sobre el presupuesto (misma cuenta que la cotización manual)', () => {
    const res = M.validateProposal(Object.assign({}, VALID, {
        amount: '1', deposit_pct: '50',
        extras: {
            items: [{ name: 'Diseño personalizado', qty: 1, price: '100.000' }, { name: 'Sesión de tatuaje', qty: 2, price: '150000' }, { name: '', qty: 1, price: '' }],
            discount_pct: 10, tax_pct: 21, policy: 'no-reembolsable-48', client_notes: 'Trae ropa cómoda.', extra_terms: 'Un retoque incluido.',
        },
    }));
    assert.equal(res.ok, true);
    assert.equal(res.value.hasBreakdown, true);
    assert.equal(res.value.extras.subtotal, 400000);
    assert.equal(res.value.amount, 435600, '400.000 − 10 % + 21 %');
    assert.equal(res.value.depositAmount, 217800);
    assert.deepEqual(res.value.extras.items.map((it) => it.total), [100000, 300000]);
    assert.equal(res.value.extras.policy, 'no-reembolsable-48');

    assert.match(M.validateProposal(Object.assign({}, VALID, { extras: { items: [{ name: '', qty: 1, price: 500 }] } })).errors.items, /nombre a cada concepto/);
    assert.match(M.validateProposal(Object.assign({}, VALID, { extras: { policy: 'inventada' } })).errors.policy, /política de la lista/);
    assert.match(M.validateProposal(Object.assign({}, VALID, { extras: { client_notes: 'x'.repeat(4001) } })).errors.client_notes, /4000/);
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ name: `c${i}`, qty: 1, price: 10 }));
    assert.match(M.validateProposal(Object.assign({}, VALID, { extras: { items: tooMany } })).errors.items, /hasta 20 conceptos/);
    assert.deepEqual(M.POLICY_OPTIONS.map((p) => p.value), ['', 'no-reembolsable-48', 'no-reembolsable-24', 'reembolsable-72', 'sin-sena']);
    assert.deepEqual(M.COMPLEXITY_OPTIONS, ['Baja', 'Media', 'Alta']);
});

test('P4/P25: patch de quotations_db — el estado solo viaja si cambia', () => {
    const value = M.validateProposal(VALID).value;
    const ctx = { nowIso: '2026-11-16T15:00:00.000Z', offers: [{ kind: 'range', label: '10 al 15 dic 2026' }], summary: 'Prefiero tardes; 10 al 15 dic 2026' };
    const first = M.quotePatch(value, Object.assign({ status: 'pending' }, ctx));
    assert.deepEqual(first, {
        artist_budget_amount: 410000, artist_budget_currency: 'ARS', tattoo_estimated_sessions: 2, artist_session_minutes: 180,
        artist_availability: 'Prefiero tardes; 10 al 15 dic 2026', artist_responded_at: '2026-11-16T15:00:00.000Z',
        artist_deposit_pct: 30, artist_deposit_amount: 123000, quote_expiry_enabled: true, quote_expiry_days: 14,
        offered_slots: [{ kind: 'range', label: '10 al 15 dic 2026' }], proposal_message: 'Hola Ana',
        quote_status: 'responded', artist_studio_name: 'Estudio Norte',
    });
    const update = M.quotePatch(value, Object.assign({ status: 'responded' }, ctx));
    assert.equal('quote_status' in update, false, 'la propuesta reenviada sigue respondida');
    assert.equal(update.artist_responded_at, ctx.nowIso, 'se renueva la versión de la propuesta');
    const noPlace = M.quotePatch(M.validateProposal(Object.assign({}, VALID, { location: '' })).value, Object.assign({ status: 'expired' }, ctx));
    assert.equal('artist_studio_name' in noPlace, false, 'sin lugar escrito no se pisa el guardado');
    assert.equal(noPlace.quote_status, 'responded');
    assert.deepEqual(M.OPTIONAL_QUOTE_COLUMNS, ['offered_slots', 'proposal_message']);
    // Transiciones que acepta el trigger vivo para llegar a "responded".
    for (const from of ['pending', 'expired', 'client_rejected']) assert.ok(VM.DB_STATUS_TRANSITIONS[from].includes('responded'), from);
});

test('P29: fila de artist_manual_quotes para una solicitud de cliente', () => {
    const quote = { id: 1234, quote_id: 'QT-ABCD-XYZ-0001', client_full_name: 'Ana Pérez', tattoo_idea_description: 'Golondrina tradicional', project_description: '' };
    const value = M.validateProposal(Object.assign({}, VALID, {
        extras: { items: [{ name: 'Sesión de tatuaje', qty: 2, price: 100 }], discount_pct: 0, tax_pct: 0, policy: 'reembolsable-72', client_notes: 'Nota', extra_terms: '' },
    })).value;
    const record = M.manualRecord(value, { quote, existing: null, artistId: 'artist-1', nowIso: '2026-11-16T15:00:00.000Z' });
    assert.equal(record.mode, 'insert');
    assert.equal(record.row.status, 'sent', 'la policy del cliente exige status sent');
    assert.equal(record.row.origin, 'cliente');
    assert.equal(record.row.quote_id, 'QT-ABCD-XYZ-0001');
    assert.equal(record.row.artist_id, 'artist-1');
    assert.match(record.row.quote_ref, /^COT-[A-Z0-9]{4,12}$/, 'cumple el CHECK de quote_ref');
    assert.equal(record.row.quote_ref, 'COT-RSP0000YA');
    assert.equal(M.manualRef(2 ** 31).length <= 16, true);
    assert.match(M.manualRef(2 ** 31), /^COT-[A-Z0-9]{4,12}$/);
    assert.deepEqual(record.row.client, { name: 'Ana Pérez' }, 'sin datos de contacto duplicados');
    assert.equal(record.row.total, 200);
    assert.equal(record.row.subtotal, 200);
    assert.equal(record.row.deposit_pct, 30);
    assert.equal(record.row.deposit_amount, 60);
    assert.equal(record.row.validity_days, 14);
    assert.equal(record.row.cancellation_policy, 'reembolsable-72');
    assert.equal(record.row.client_notes, 'Nota');
    assert.equal(record.row.extra_terms, null);
    assert.equal(record.row.project.complexity, 'Alta');
    assert.equal(record.row.project.expiry_enabled, true);
    assert.equal(record.row.project.title, 'Golondrina tradicional');
    assert.deepEqual(record.row.line_items, [{ name: 'Sesión de tatuaje', description: null, qty: 2, price: 100, total: 200 }]);

    // Sin campos de la manual y sin fila previa: no se crea nada.
    const plain = M.validateProposal(Object.assign({}, VALID, { complexity: '' })).value;
    assert.equal(M.manualRecord(plain, { quote, existing: null, artistId: 'artist-1', nowIso: 'x' }), null);
    // Con fila previa (cotización manual o respuesta anterior) siempre se actualiza, sin tocar su identidad.
    const patch = M.manualRecord(plain, { quote, existing: { id: 'm-1', validity_days: 30, project: { title: 'Manga', priority: 'high' } }, artistId: 'artist-1', nowIso: 'ahora' });
    assert.equal(patch.mode, 'patch');
    assert.equal(patch.id, 'm-1');
    assert.equal(patch.patch.project.title, 'Manga');
    assert.equal(patch.patch.project.priority, 'high');
    assert.equal(patch.patch.validity_days, 14);
    assert.equal('quote_ref' in patch.patch, false);
    assert.equal('status' in patch.patch, false);
    assert.deepEqual(patch.patch.line_items, []);
});

test('P29: el anticipo de la fila manual sigue al acuerdo', () => {
    assert.equal(M.agreementManualPatch({ artist_deposit_pct: 30, artist_deposit_amount: 60 }, null), null);
    assert.equal(M.agreementManualPatch({ artist_deposit_pct: 30, artist_deposit_amount: 60 }, { deposit_pct: 30, deposit_amount: 60 }), null);
    assert.deepEqual(M.agreementManualPatch({ artist_deposit_pct: 50, artist_deposit_amount: 400 }, { deposit_pct: 30, deposit_amount: 300 }), { deposit_pct: 50, deposit_amount: 400 });
    assert.deepEqual(M.agreementManualPatch({ artist_deposit_pct: null, artist_deposit_amount: null }, { deposit_pct: 30, deposit_amount: 300 }), { deposit_pct: 0, deposit_amount: 0 });
});

test('P25: el diálogo se reabre precargado (cotización + fila manual + prefill del evento)', () => {
    const quote = {
        quote_status: 'responded', artist_budget_amount: '410000', artist_budget_currency: 'ARS', tattoo_estimated_sessions: '2',
        artist_session_minutes: 150, artist_deposit_pct: 30, artist_studio_name: 'Estudio Norte',
        artist_availability: 'Prefiero tardes; 10 al 15 dic 2099',
        offered_slots: [{ kind: 'range', from: '2099-12-10', to: '2099-12-15', start: '2099-12-10T03:00:00.000Z', end: '2099-12-16T03:00:00.000Z', label: '10 al 15 dic 2099' }],
    };
    const manual = { line_items: [{ name: 'Sesión', qty: 2, price: 205000 }], discount_pct: 0, tax_pct: 0, cancellation_policy: 'sin-sena', client_notes: 'Nota', extra_terms: 'Términos', project: { complexity: 'Media', location: 'Otro lugar' } };
    const init = M.initialValues(quote, manual, null);
    assert.equal(init.amount, '410.000');
    assert.equal(init.currency, 'ARS');
    assert.equal(init.sessions, '2');
    assert.equal(init.minutes, 150);
    assert.equal(init.depositPct, '30');
    assert.equal(init.location, 'Otro lugar');
    assert.equal(init.complexity, 'Media');
    assert.equal(init.availabilityNote, 'Prefiero tardes');
    assert.deepEqual(init.offered.map((o) => [o.kind, o.from, o.to]), [['range', '2099-12-10', '2099-12-15']]);
    assert.equal(init.policy, 'sin-sena');
    assert.equal(init.clientNotes, 'Nota');
    assert.deepEqual(init.items.map((it) => it.name), ['Sesión']);

    // El módulo de negociación pide otro número de sesiones y otro monto.
    const pre = M.initialValues(quote, manual, { sessions: 3, amount: '500000', message: 'Hola {{cliente}}', offered: [], extras: { policy: 'reembolsable-72' }, complexity: 'Alta' });
    assert.equal(pre.sessions, '3');
    assert.equal(pre.amount, '500000');
    assert.equal(pre.message, 'Hola {{cliente}}');
    assert.deepEqual(pre.offered, []);
    assert.equal(pre.policy, 'reembolsable-72');
    assert.equal(pre.complexity, 'Alta');
    // Cotización nueva sin nada guardado.
    const blank = M.initialValues({ quote_status: 'pending', client_budget_currency: 'usd' }, null, null);
    assert.equal(blank.amount, '');
    assert.equal(blank.currency, 'USD');
    assert.equal(blank.sessions, '1');
    assert.equal(blank.minutes, 120);
    assert.equal(blank.policy, '');
    assert.deepEqual(blank.items, []);
});

// ------------------------------------------------------------------ contratos
test('expediente: scripts del frente antes del expediente y CSS propio', () => {
    const html = read('public/my-quotations/detail/index.html');
    const order = ['quotations-view-model.js', 'booking-slots-model.js', 'quotation-new-model.js', 'quote-respond-model.js',
        'data/quote-respond-repo.js', 'quote-respond-dialog.js', 'quote-status-priority.js', 'quotation-detail-figma.js'];
    let last = -1;
    for (const file of order) {
        const at = html.indexOf(`/shared/js/${file}`);
        assert.ok(at > last, `${file} en orden`);
        last = at;
    }
    assert.ok(html.indexOf('data/postgrest-client.js') < html.indexOf('data/quote-respond-repo.js'));
    assert.match(html, /\/shared\/css\/quote-respond\.css\?v=/);
});

test('expediente: openRespondDialog delega en el diálogo ancho y conserva el anterior de respaldo', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    assert.match(js, /function openRespondDialog\(prefill\) \{\n\s*if \(!guardWrite\(\)\) return;\n(?:\s*\/\/[^\n]*\n)*\s*if \(window\.WoQuoteRespond && window\.WoQuoteRespond\.open\(respondContext\(prefill\)\)\) return;/);
    assert.match(js, /prefill: prefill && typeof prefill === 'object' && !\(prefill instanceof Event\) \? prefill : null/, 'el click del botón no es un prefill');
    assert.match(js, /flushNotes: savePrivateNotes/);
    assert.match(js, /notifyResponded: \(extra\) => notify\('artist_responded_quotation'/);
    // Respaldo intacto (lo siguen probando los tests de la beta).
    assert.match(js, /title: requote \? 'Volver a cotizar' : 'Aceptar y enviar presupuesto'/);
    // Tras el acuerdo se alinea el anticipo de la fila manual.
    assert.match(js, /await updateQuote\(patch\);\n\s*syncAgreementExtras\(\);/);
});

test('P25: contrato wo:quote-respond { quoteId, prefill } para reabrir el diálogo precargado', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    assert.match(js, /document\.addEventListener\('wo:quote-respond', \(event\) => \{/);
    assert.match(js, /String\(detail\.quoteId\) !== String\(q\.quote_id\) && String\(detail\.quoteId\) !== String\(q\.id\)\) return;/);
    assert.match(js, /openRespondDialog\(detail\.prefill && typeof detail\.prefill === 'object' \? detail\.prefill : \{\}\);/);
    const strip = read('public/shared/js/quote-status-priority.js');
    assert.match(strip, /new CustomEvent\('wo:quote-respond', \{\s*detail: \{ quoteId: last\.quote\.quote_id \|\| last\.quote\.id, prefill: \{\} \}/);
    assert.match(strip, /if \(quote\.quote_status === 'responded'\) return 'Modificar propuesta';/);
});

test('P5: estado y prioridad editables en el expediente con las transiciones del trigger vivo', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    assert.match(js, /window\.WoQuotationDetailActions = \{/);
    assert.match(js, /if \(!vm \|\| !next \|\| next === from \|\| !vm\.canTransition\(from, next\)\) \{/);
    assert.match(js, /if \(next === 'responded'\) \{ openRespondDialog\(\{\}\); return false; \}/);
    assert.match(js, /if \(next === 'client_approved'\) \{ openAgreementDialog\(false\); return false; \}/);
    assert.match(js, /if \(cancel\) noticeClient\('cancelled', from\);/, 'cancelar avisa al cliente');
    assert.match(js, /await D\(\)\.Quotations\.updatePriority\(state\.quote\.id, next\);/);
    const strip = read('public/shared/js/quote-status-priority.js');
    assert.match(strip, /document\.addEventListener\('wo:quotation-detail-rendered'/);
    assert.match(strip, /<label class="qsp-label" for="qsp-status">Estado<\/label>/);
    assert.match(strip, /<label class="qsp-label" for="qsp-priority">Prioridad<\/label>/);
    assert.match(strip, /vm\.statusOptions\(current\)/);
    // El artista nunca puede elegir lo que decide el cliente o el servidor.
    for (const from of Object.keys(VM.STATUS_TRANSITIONS)) {
        const options = VM.statusOptions(from).map((o) => o.value);
        for (const banned of ['client_rejected', 'completed']) if (from !== banned) assert.ok(!options.includes(banned), `${from} → ${banned}`);
        for (const to of options) if (to !== from) assert.ok(VM.canTransition(from, to), `${from} → ${to}`);
    }
    // La prioridad ya es visible y filtrable en el listado.
    assert.match(read('public/shared/js/quotations.js'), /VM\.priorityView\(quote\.priority \|\| 'medium'\)/);
    assert.match(read('public/shared/js/data/quotations-repo.js'), /update\(\{ priority: newPriority \}\)/);
});

test('diálogo: pestañas, accesibilidad y escape de datos de usuario', () => {
    const js = read('public/shared/js/quote-respond-dialog.js');
    assert.match(js, /role="dialog" aria-modal="true" aria-labelledby="qr-title"/);
    assert.match(js, /role="tablist"/);
    assert.match(js, /role="tabpanel"/);
    assert.match(js, /if \(event\.key === 'Escape'\)/);
    assert.match(js, /if \(event\.key === 'Tab'\)/, 'el foco no sale del diálogo');
    for (const tab of ['propuesta', 'disponibilidad', 'condiciones', 'mensaje']) assert.match(js, new RegExp(`key: '${tab}'`));
    for (const label of ['Notas para el cliente', 'Términos adicionales', 'Política de reserva y cancelación', 'Desglose económico', 'Estudio o ubicación', 'Complejidad']) {
        assert.ok(js.includes(label), `P29: ${label}`);
    }
    assert.match(js, /Turnos con horario/);
    assert.match(js, /Rango de fechas/);
    assert.match(js, /data-qr-var="/);
    assert.match(js, /Vista previa de lo que recibe el cliente/);
    assert.match(js, /El saldo acordado se activa cuando el cliente aprueba la propuesta, no antes\./);
    assert.match(js, /validate_only: true/, 'antes de reservar el turno pedido se valida todo');
    // Nada de datos crudos en innerHTML: cada interpolación de datos pasa por esc().
    assert.doesNotMatch(js, /innerHTML = [^;]*\+ (?:label|reason|title|name|quote\.[a-z_]+|t\.title|t\.body|b\.label|slot\.label|day\.open) \+/);
    assert.doesNotMatch(js, /fetch\(|\/rest\/v1\//, 'los datos van por WeotziData.QuoteRespond');
    assert.doesNotMatch(js, /\.from\('/, 'sin CRUD ad-hoc');
});

test('CSS del diálogo: ancho, 720 px de alto y responsive con tokens del DS', () => {
    const css = read('public/shared/css/quote-respond.css');
    assert.match(css, /\.qr-dialog \{\n\s*width: min\(1040px, 100%\);/, 'más ancho que el modal de 560');
    assert.match(css, /max-height: min\(688px, calc\(100dvh - var\(--space-8\)\)\);/, 'entra en 720 de alto');
    assert.match(css, /\.qr-body \{ min-height: 0; overflow-y: auto;/);
    assert.match(css, /\.qr-grid \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/, 'campos alineados en grilla');
    assert.match(css, /@media \(max-width: 720px\)/);
    assert.match(css, /@media \(max-width: 420px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /:focus-visible/);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b/, 'sin hex sueltos: tokens del DS');
});

test('datos del front: API del servidor y plantillas por la capa PostgREST', () => {
    const repo = read('public/shared/js/data/quote-respond-repo.js');
    assert.match(repo, /D\.QuoteRespond = QuoteRespond;/);
    assert.match(repo, /`\/api\/cot-respuesta\/quotations\/\$\{encodeURIComponent\(String\(quoteId\)\)\}`/);
    assert.match(repo, /D\.run\('quoteRespond\.listTemplates'/);
    assert.match(repo, /\.eq\('user_id', userId\)\.eq\('kind', KIND\)/);
    assert.match(repo, /const KIND = 'quote';/);
    assert.doesNotMatch(repo, /\/rest\/v1\//);
    // Cada método del front tiene su ruta en el servidor.
    const routes = read('lib/routes/cot-respuesta.js');
    for (const [method, suffix] of [['get', 'proposal'], ['get', 'availability'], ['post', 'proposal'], ['post', 'agreement-sync']]) {
        assert.match(routes, new RegExp(`app\\.${method}\\('/api/cot-respuesta/quotations/:quoteId/${suffix}'`));
        assert.ok(repo.includes(`/${suffix}`), suffix);
    }
});

test('migración: offered_slots, proposal_message y artist_message_templates (idempotente, con rollback)', () => {
    const sql = read('supabase/migrations/20261116120000_cot_respuesta_propuesta.sql');
    assert.match(sql, /add column if not exists offered_slots jsonb default '\[\]'::jsonb/);
    assert.match(sql, /add column if not exists proposal_message text/);
    assert.doesNotMatch(sql, /offered_slots jsonb not null/, 'nullable: hay RPC que insertan desde un registro');
    assert.match(sql, /jsonb_array_length\(offered_slots\) <= 12/);
    assert.match(sql, /create table if not exists public\.artist_message_templates \(/);
    assert.match(sql, /kind text not null check \(kind in \('quote', 'chat'\)\)/, 'compartida con el frente inbox');
    for (const column of ['user_id uuid not null', 'title text not null', 'body text not null', 'sort integer not null default 0']) assert.ok(sql.includes(column), column);
    assert.match(sql, /enable row level security/);
    assert.equal((sql.match(/create policy artist_message_templates_owner_/g) || []).length, 4);
    assert.equal((sql.match(/\(select auth\.uid\(\)\) = user_id/g) || []).length, 5);
    assert.match(sql, /revoke all on public\.artist_message_templates from public, anon, authenticated;/);
    assert.match(sql, /grant select, insert, update, delete on public\.artist_message_templates to authenticated;/);
    assert.doesNotMatch(sql, /grant[^;]*to anon/);
    const down = read('supabase/rollbacks/20261116120000_cot_respuesta_propuesta.down.sql');
    assert.match(down, /drop column if exists offered_slots/);
    assert.match(down, /delete from public\.artist_message_templates where kind = 'quote';/);
    // DB-03: la tabla se va solo si queda vacía Y el inbox (20261116160100) no está instalado.
    assert.match(down, /if not exists \(select 1 from public\.artist_message_templates\)\s*\n\s*and not exists \(\s*\n\s*select 1 from pg_catalog\.pg_constraint c\s*\n\s*where c\.conname = 'artist_message_templates_chat_limits'\s*\n\s*and c\.conrelid = 'public\.artist_message_templates'::regclass\s*\n\s*\) then\s*\n\s*drop table public\.artist_message_templates;/,
        'no borra las plantillas del inbox ni la tabla que el inbox consulta');
    // Un solo índice sobre (user_id, kind, sort): las dos migraciones usan el mismo nombre.
    const INDEX = /create index if not exists artist_message_templates_user_kind_idx\s*\n\s*on public\.artist_message_templates \(user_id, kind, sort\);/;
    assert.match(sql, INDEX);
    const inbox = read('supabase/migrations/20261116160100_inbox_mensajes_rapidos.sql');
    assert.match(inbox, INDEX);
    assert.doesNotMatch(inbox, /idx_artist_message_templates_owner/);
    assert.match(inbox, /add constraint artist_message_templates_chat_limits/, 'la señal que mira la reversa');
    const name = '20261116120000_cot_respuesta_propuesta';
    assert.ok(name >= '20261116120000' && name.slice(0, 14) <= '20261116120999', 'timestamp dentro del rango del frente');
});

test('panel del cliente: fechas ofrecidas, mensaje, complejidad y saldo recién con el acuerdo', () => {
    const quote = {
        quote_id: 'QT-1', quote_status: 'responded', artist_responded_at: '2026-11-16T15:00:00Z', artist_budget_amount: '500', artist_budget_currency: 'USD',
        tattoo_estimated_sessions: '2', artist_availability: 'Prefiero tardes; sáb 5 dic 2026 · 14:00–17:00; 10 al 15 dic 2026',
        offered_slots: [{ kind: 'slot', label: 'sáb 5 dic 2026 · 14:00–17:00' }, { kind: 'range', label: '10 al 15 dic 2026<script>' }],
        proposal_message: 'Hola Ana, <b>te espero</b>',
    };
    const manual = { status: 'sent', currency: 'USD', line_items: [{ name: 'Sesión', qty: 2, price: 250, total: 500 }], subtotal: 500, total: 500, deposit_pct: 0, deposit_amount: 0, validity_days: 14, cancellation_policy: '', project: { complexity: 'Alta', expiry_enabled: false } };
    assert.deepEqual(CQP.offeredOf(quote), { labels: ['sáb 5 dic 2026 · 14:00–17:00', '10 al 15 dic 2026<script>'], note: '' });
    const clean = Object.assign({}, quote, { offered_slots: [{ label: 'sáb 5 dic 2026 · 14:00–17:00' }, { label: '10 al 15 dic 2026' }] });
    assert.deepEqual(CQP.offeredOf(clean).note, 'Prefiero tardes');
    assert.deepEqual(CQP.offeredOf({ artist_availability: 'Fines de semana' }), { labels: [], note: 'Fines de semana' });

    const html = CQP.renderProposal(clean, { manual, now: Date.parse('2026-11-17T00:00:00Z') });
    assert.match(html, /Fechas que te ofrece el artista/);
    assert.match(html, /<li><span class="cqp-item-name">10 al 15 dic 2026<\/span><\/li>/);
    assert.match(html, /<dt>Disponibilidad<\/dt><dd>Prefiero tardes<\/dd>/, 'solo la nota libre, sin repetir las fechas');
    assert.match(html, /<dt>Complejidad<\/dt><dd>Alta<\/dd>/);
    assert.match(html, /Hola Ana, &lt;b&gt;te espero&lt;\/b&gt;/, 'mensaje escapado');
    assert.doesNotMatch(html, /Validez indicada por el artista/, 'sin vencimiento activado no se anuncia validez');
    const evil = CQP.renderProposal(quote, { manual });
    assert.doesNotMatch(evil, /<script>/);
    // Sin fechas estructuradas el panel sigue como antes.
    const legacy = CQP.renderProposal({ quote_id: 'QT-2', quote_status: 'responded', artist_responded_at: '2026-11-16T15:00:00Z', artist_budget_amount: '500', artist_availability: 'Fines de semana' }, {});
    assert.match(legacy, /<dt>Disponibilidad<\/dt><dd>Fines de semana<\/dd>/);
    assert.doesNotMatch(legacy, /Fechas que te ofrece el artista/);
    // Saldo: recién con la cotización aprobada por ambas partes.
    const pay = (status) => CQP.renderProposal(Object.assign({}, clean, { quote_status: status }), {
        manual, payments: { summary: PM.summarize(Object.assign({}, clean, { quote_status: status }), manual, [{ id: 'p', quotation_id: 1, kind: 'deposit', method: 'cash', amount: 100, currency: 'USD', paid_on: '2026-11-16' }]) },
    });
    assert.doesNotMatch(pay('responded'), /<dt>Saldo<\/dt>/);
    assert.match(pay('client_approved'), /<dt>Saldo<\/dt>/);
});

test('textos nuevos en español neutro (sin voseo) y documentación del frente', () => {
    const files = ['public/shared/js/quote-respond-model.js', 'public/shared/js/quote-respond-dialog.js', 'public/shared/js/quote-status-priority.js',
        'public/shared/js/data/quote-respond-repo.js', 'lib/cot-respuesta.js', 'lib/routes/cot-respuesta.js', 'lib/repos/cot-respuesta.js',
        'services/email-events/cot-respuesta.js', 'docs/COT_RESPUESTA.md'];
    for (const file of files) {
        const hit = read(file).split('\n').find((line) => VOSEO.test(line));
        assert.equal(hit, undefined, `${file}: ${hit}`);
    }
    const doc = read('docs/COT_RESPUESTA.md');
    for (const term of ['wo:quote-respond', 'offered_slots', 'artist_manual_quotes', 'artist_message_templates', 'artist_updated_quotation_proposal', '/api/cot-respuesta/quotations/:quoteId/proposal']) {
        assert.ok(doc.includes(term), `doc: ${term}`);
    }
    assert.deepEqual(JSON.parse(read('docs/plans/ronda2-assets/cot-respuesta.json')), [], 'este frente no necesita imágenes');
});
