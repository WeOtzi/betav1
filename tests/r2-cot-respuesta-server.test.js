'use strict';

// Ronda 2 · frente cot-respuesta: lógica del servidor (lib/cot-respuesta.js)
// con dependencias inyectadas, rutas (lib/routes/cot-respuesta.js) y el
// evento de email del frente. Sin red ni base.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const logic = require('../lib/cot-respuesta');
const routes = require('../lib/routes/cot-respuesta');
const B = require('../public/shared/js/booking-slots-model.js');

const TZ = 'America/Argentina/Buenos_Aires';
const NOW = Date.parse('2026-11-16T15:00:00Z');
const ARTIST = '22222222-2222-4222-8222-222222222222';
const WEEKLY = B.DAY_KEYS.map((day, i) => ({ day, enabled: i < 5, start: '10:00', end: '18:00' }));
const REQ = { headers: { authorization: 'Bearer token' } };

function quoteRow(extra = {}) {
    return Object.assign({
        id: 77, quote_id: 'QT-ABCD-XYZ-0077', quote_status: 'pending', is_archived: false, dispute_status: 'none',
        artist_id: ARTIST, artist_name: 'Mateo Rivas', artist_email: 'mateo@example.com',
        client_user_id: 'c-1', client_email: 'lucia@example.com', client_full_name: 'Lucía Fernández',
        tattoo_idea_description: 'Golondrina tradicional', artist_studio_name: null,
    }, extra);
}

function body(extra = {}) {
    return Object.assign({
        amount: '410.000', currency: 'ARS', sessions: '2', minutes: 180, deposit_pct: '30',
        expiry_enabled: false, expiry_days: '', location: 'Estudio Norte', complexity: '',
        availability_note: '', message: 'Hola Lucía, te espero.',
        offered: [{ kind: 'slot', start: '2026-11-17T13:00:00Z', end: '2026-11-17T16:00:00Z' }],
        extras: { items: [], discount_pct: 0, tax_pct: 0, policy: '', client_notes: '', extra_terms: '' },
    }, extra);
}

// Dependencias falsas: registran cada escritura.
function fakeDeps(options = {}) {
    const calls = { saves: [], manualInserts: [], manualPatches: [], history: [], annotations: [], emails: [], blocking: [] };
    const quote = options.quote === undefined ? quoteRow() : options.quote;
    const repo = {
        isMissingColumn: (error) => /PGRST204/.test(String(error && error.message)),
        getQuote: async () => quote,
        saveProposal: async (id, artistId, expected, patch) => {
            calls.saves.push({ id, artistId, expected, patch });
            if (options.saveError && calls.saves.length === 1) throw options.saveError;
            if (options.race) return null;
            return Object.assign({}, quote, patch, { quote_status: patch.quote_status || quote.quote_status });
        },
        getManualByQuoteId: async () => {
            if (options.manualError) throw new Error('boom');
            return options.manual || null;
        },
        insertManual: async (row) => { calls.manualInserts.push(row); return row; },
        patchManual: async (id, artistId, patch) => { calls.manualPatches.push({ id, artistId, patch }); return patch; },
        annotateHistory: async (...args) => { calls.annotations.push(args); },
        insertHistory: async (row) => { calls.history.push(row); },
        listOwnIntervals: async () => options.own || [],
        listBlocking: async (artistId, from, to) => {
            calls.blocking.push({ artistId, from, to });
            if (options.blockingError) throw new Error('rpc caída');
            return options.blocking || [];
        },
        getArtist: async () => ({ user_id: ARTIST, name: 'Mateo Rivas', username: 'mateo.ink', email: 'mateo@example.com' }),
    };
    return {
        calls,
        deps: {
            useDefaults: false,
            repo,
            booking: { context: async () => ({ tz: TZ, settings: B.normalizeSettings({}), availability: { weekly: WEEKLY }, locations: [] }) },
            resolveUser: async () => (options.user === undefined ? { id: ARTIST, email: 'mateo@example.com' } : options.user),
            sendEmail: async (eventId, payload, opts) => { calls.emails.push({ eventId, payload, opts }); return { ok: true }; },
            applicationBase: () => 'https://beta.weotzi.com',
            withLinks: (payload, base, role) => Object.assign({}, payload, { quotation_url: `${base}/${role}/dashboard?quote=${payload.quote_id}` }),
            now: () => NOW,
            log: { log() {}, warn() {}, error() {} },
        },
    };
}

// ------------------------------------------------------------------ permisos
test('solo el artista dueño de la cotización puede enviar la propuesta', async () => {
    assert.equal((await logic.handleProposal(REQ, 'QT bad id', body(), fakeDeps().deps)).status, 400);
    assert.equal((await logic.handleProposal(REQ, 'QT-1', body(), fakeDeps({ user: null }).deps)).status, 401);
    assert.equal((await logic.handleProposal(REQ, 'QT-1', body(), fakeDeps({ quote: null }).deps)).status, 404);
    const other = fakeDeps({ user: { id: 'otro-artista' } });
    const res = await logic.handleProposal(REQ, 'QT-1', body(), other.deps);
    assert.equal(res.status, 403);
    assert.equal(other.calls.saves.length, 0);
    for (const handler of ['handleContext', 'handleAgreementSync']) {
        assert.equal((await logic[handler](REQ, 'QT-1', fakeDeps({ user: { id: 'otro' } }).deps)).status, 403, handler);
    }
    assert.equal((await logic.handleAvailability(REQ, 'QT-1', {}, fakeDeps({ user: { id: 'otro' } }).deps)).status, 403);
});

test('P25: una cotización aprobada por ambas partes ya no admite propuesta', async () => {
    for (const status of ['client_approved', 'artist_completed', 'completed', 'cancelled']) {
        const f = fakeDeps({ quote: quoteRow({ quote_status: status }) });
        const res = await logic.handleProposal(REQ, 'QT-1', body(), f.deps);
        assert.equal(res.status, 409, status);
        assert.equal(f.calls.saves.length, 0, status);
    }
    const archived = await logic.handleProposal(REQ, 'QT-1', body(), fakeDeps({ quote: quoteRow({ is_archived: true }) }).deps);
    assert.equal(archived.code, 'archived');
});

test('P23: una cotización rechazada por el cliente quedó finalizada — el servidor no la reabre', async () => {
    const f = fakeDeps({ quote: quoteRow({ quote_status: 'client_rejected', artist_responded_at: '2026-11-10T12:00:00Z' }) });
    const res = await logic.handleProposal(REQ, 'QT-1', body(), f.deps);
    assert.equal(res.status, 409);
    assert.equal(res.code, 'client_rejected');
    assert.match(res.error, /quedó finalizada/);
    assert.equal(f.calls.saves.length, 0, 'saveProposal (service-role) no se llama');
    assert.equal(f.calls.emails.length, 0, 'el cliente no recibe otra propuesta');
    // Tampoco con validate_only ni por el contexto del diálogo (?modal=responder).
    const dry = await logic.handleProposal(REQ, 'QT-1', body({ validate_only: true }), f.deps);
    assert.equal(dry.status, 409);
    const ctx = await logic.handleContext(REQ, 'QT-1', f.deps);
    assert.equal(ctx.editable, false);
    assert.equal(ctx.code, 'client_rejected');
    assert.equal(f.calls.saves.length, 0);
});

// ------------------------------------------------------------- primera respuesta
test('P4: primera respuesta — guarda la propuesta, las fechas y completa el historial', async () => {
    const f = fakeDeps();
    const res = await logic.handleProposal(REQ, 'QT-ABCD-XYZ-0077', body(), f.deps);
    assert.equal(res.ok, true);
    assert.equal(res.first_response, true);
    assert.equal(res.updated, false);
    assert.equal(res.degraded, false);
    assert.equal(res.extras_saved, true);
    assert.equal(f.calls.saves.length, 1);
    const save = f.calls.saves[0];
    assert.equal(save.id, 77);
    assert.equal(save.artistId, ARTIST);
    assert.equal(save.expected, 'pending', 'guardia de carrera por estado');
    assert.equal(save.patch.quote_status, 'responded');
    assert.equal(save.patch.artist_budget_amount, 410000);
    assert.equal(save.patch.artist_deposit_amount, 123000);
    assert.equal(save.patch.artist_responded_at, '2026-11-16T15:00:00.000Z');
    assert.deepEqual(save.patch.offered_slots, [{
        kind: 'slot', start: '2026-11-17T13:00:00.000Z', end: '2026-11-17T16:00:00.000Z', label: 'mar 17 nov 2026 · 10:00–13:00', tz: TZ,
    }]);
    assert.equal(save.patch.artist_availability, 'mar 17 nov 2026 · 10:00–13:00', 'resumen legible para el cliente y los correos');
    assert.equal(save.patch.proposal_message, 'Hola Lucía, te espero.');
    assert.equal(save.patch.artist_studio_name, 'Estudio Norte');
    assert.deepEqual(res.quotation.offered_slots, save.patch.offered_slots);
    // Historial: el trigger crea la fila; el servidor completa el actor.
    assert.equal(f.calls.annotations.length, 1);
    assert.deepEqual(f.calls.annotations[0].slice(0, 2), [77, 'responded']);
    assert.equal(f.calls.annotations[0][3].changedBy, ARTIST);
    assert.equal(f.calls.history.length, 0);
    // La primera respuesta sigue avisándose por artist_responded_quotation (la dispara el detalle).
    assert.equal(f.calls.emails.length, 0);
    assert.equal(f.calls.manualInserts.length, 0, 'sin campos de la manual no se crea fila');
    // La agenda se pidió para el artista, con un día de margen.
    assert.equal(f.calls.blocking[0].artistId, ARTIST);
    assert.ok(f.calls.blocking[0].from < '2026-11-17' && f.calls.blocking[0].to > '2026-11-18');
});

test('P4: el servidor rechaza las fechas ocupadas (409 slot_conflict) y no guarda nada', async () => {
    const f = fakeDeps({ blocking: [{ starts_at: '2026-11-17T14:00:00Z', ends_at: '2026-11-17T17:00:00Z', kind: 'session' }] });
    const res = await logic.handleProposal(REQ, 'QT-1', body(), f.deps);
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.equal(res.code, 'slot_conflict');
    assert.deepEqual(res.conflicts.map((c) => [c.index, c.label]), [[0, 'mar 17 nov 2026 · 10:00–13:00']]);
    assert.match(res.error, /ya está ocupada en tu agenda: mar 17 nov 2026 · 10:00–13:00/);
    assert.equal(f.calls.saves.length, 0);

    // Un apartado pendiente de otro cliente no es un turno confirmado: se puede ofrecer.
    const hold = fakeDeps({ blocking: [{ starts_at: '2026-11-17T14:00:00Z', ends_at: '2026-11-17T17:00:00Z', kind: 'hold' }] });
    assert.equal((await logic.handleProposal(REQ, 'QT-1', body(), hold.deps)).ok, true);
    // La sesión que ya tiene ESTA cotización tampoco choca consigo misma.
    const own = fakeDeps({
        blocking: [{ starts_at: '2026-11-17T13:00:00Z', ends_at: '2026-11-17T16:00:00Z', kind: 'session' }],
        own: [{ start: '2026-11-17T13:00:00.000Z', end: '2026-11-17T16:00:00.000Z' }],
    });
    assert.equal((await logic.handleProposal(REQ, 'QT-1', body(), own.deps)).ok, true);
    // Rango con un día ocupado por un viaje.
    const trip = fakeDeps({ blocking: [{ starts_at: '2026-11-25T03:00:00Z', ends_at: '2026-11-26T03:00:00Z', kind: 'trip' }] });
    const ranged = await logic.handleProposal(REQ, 'QT-1', body({ offered: [{ kind: 'range', from: '2026-11-23', to: '2026-11-27' }] }), trip.deps);
    assert.equal(ranged.code, 'slot_conflict');
    assert.match(ranged.conflicts[0].reason, /25 nov/);
});

test('P4: validaciones — campos, fechas inválidas, agenda caída y validate_only', async () => {
    const invalid = fakeDeps();
    const bad = await logic.handleProposal(REQ, 'QT-1', body({ amount: '', sessions: '0' }), invalid.deps);
    assert.equal(bad.status, 400);
    assert.equal(bad.code, 'invalid');
    assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'sessions']);
    assert.equal(invalid.calls.saves.length, 0);

    const past = await logic.handleProposal(REQ, 'QT-1', body({ offered: [{ kind: 'slot', start: '2026-11-10T13:00:00Z', end: '2026-11-10T16:00:00Z' }] }), fakeDeps().deps);
    assert.equal(past.code, 'invalid_offer');
    assert.deepEqual(past.offer_errors.map((e) => e.index), [0]);

    const down = fakeDeps({ blockingError: true });
    const agenda = await logic.handleProposal(REQ, 'QT-1', body(), down.deps);
    assert.equal(agenda.status, 503, 'sin agenda no se puede garantizar que no choque');
    assert.equal(down.calls.saves.length, 0);
    // Sin fechas ofrecidas no hace falta la agenda.
    const noDates = fakeDeps({ blockingError: true });
    assert.equal((await logic.handleProposal(REQ, 'QT-1', body({ offered: [] }), noDates.deps)).ok, true);
    assert.equal(noDates.calls.saves[0].patch.artist_availability, null);
    assert.deepEqual(noDates.calls.saves[0].patch.offered_slots, []);

    const dry = fakeDeps();
    const validated = await logic.handleProposal(REQ, 'QT-1', body({ validate_only: true }), dry.deps);
    assert.deepEqual(validated, { ok: true, validated: true, mode: 'respond' });
    assert.equal(dry.calls.saves.length, 0);
});

// ------------------------------------------------------------- propuesta reenviada
test('P25: propuesta actualizada — sin cambio de estado, con historial y aviso al cliente', async () => {
    const f = fakeDeps({ quote: quoteRow({ quote_status: 'responded', artist_responded_at: '2026-11-10T10:00:00Z' }) });
    const res = await logic.handleProposal(REQ, 'QT-1', body({ sessions: '3', expiry_enabled: true, expiry_days: '7' }), f.deps);
    assert.equal(res.ok, true);
    assert.equal(res.updated, true);
    assert.equal(res.first_response, false);
    const save = f.calls.saves[0];
    assert.equal(save.expected, 'responded');
    assert.equal('quote_status' in save.patch, false);
    assert.equal(save.patch.tattoo_estimated_sessions, 3);
    assert.equal(save.patch.artist_responded_at, '2026-11-16T15:00:00.000Z', 'nueva versión de la propuesta');
    assert.deepEqual(f.calls.history, [{
        quotation_id: 77, quote_id: 'QT-ABCD-XYZ-0077', old_status: 'responded', new_status: 'responded',
        changed_by: ARTIST, notes: 'El artista actualizó la propuesta.',
    }]);
    assert.equal(f.calls.annotations.length, 0);
    assert.equal(f.calls.emails.length, 1);
    const mail = f.calls.emails[0];
    assert.equal(mail.eventId, 'artist_updated_quotation_proposal');
    assert.equal(mail.opts.idempotencyKey, 'cot-respuesta:update:QT-ABCD-XYZ-0077:2026-11-16T15:00:00.000Z');
    assert.equal(mail.payload.client_email, 'lucia@example.com');
    assert.equal(mail.payload.recipient_role, 'client');
    assert.equal(mail.payload.budget_text, '410.000 ARS');
    assert.equal(mail.payload.deposit_text, '30 % · 123.000 ARS');
    assert.equal(mail.payload.sessions_text, '3 sesiones');
    assert.equal(mail.payload.duration_text, '3 h');
    assert.equal(mail.payload.offered_text, 'mar 17 nov 2026 · 10:00–13:00');
    assert.equal(mail.payload.expiry_text, '7 días');
    assert.equal(mail.payload.message_preview, 'Hola Lucía, te espero.');
    assert.match(mail.payload.quotation_url, /^https:\/\/beta\.weotzi\.com\/client\/dashboard\?quote=QT-ABCD-XYZ-0077$/);
    assert.equal(mail.payload.artist_email, undefined, 'el correo es solo para el cliente');
    assert.deepEqual(res.email, { ok: true, skipped: false });

    // Sin email del cliente no se intenta el envío.
    const guest = fakeDeps({ quote: quoteRow({ quote_status: 'responded', client_email: null }) });
    await logic.handleProposal(REQ, 'QT-1', body(), guest.deps);
    assert.equal(guest.calls.emails.length, 0);
});

test('P25: carrera y transición rechazada por la base', async () => {
    const race = await logic.handleProposal(REQ, 'QT-1', body(), fakeDeps({ race: true }).deps);
    assert.equal(race.status, 409);
    assert.equal(race.code, 'race');
    const transition = fakeDeps({ saveError: new Error('PostgREST PATCH failed (400): Invalid status transition: x -> responded') });
    const res = await logic.handleProposal(REQ, 'QT-1', body(), transition.deps);
    assert.equal(res.code, 'transition');
    await assert.rejects(() => logic.handleProposal(REQ, 'QT-1', body(), fakeDeps({ saveError: new Error('network down') }).deps), /network down/);
});

test('migración sin aplicar: la propuesta se guarda igual sin las columnas nuevas', async () => {
    const f = fakeDeps({ saveError: new Error("PostgREST PATCH quotations_db failed (400): PGRST204 Could not find the 'offered_slots' column") });
    const res = await logic.handleProposal(REQ, 'QT-1', body(), f.deps);
    assert.equal(res.ok, true);
    assert.equal(res.degraded, true);
    assert.equal(f.calls.saves.length, 2);
    assert.equal('offered_slots' in f.calls.saves[1].patch, false);
    assert.equal('proposal_message' in f.calls.saves[1].patch, false);
    assert.equal(f.calls.saves[1].patch.artist_availability, 'mar 17 nov 2026 · 10:00–13:00', 'las fechas viajan en el resumen');
    assert.equal('offered_slots' in res.quotation, false);
});

// ---------------------------------------------------- P29 · campos de la manual
test('P29: los campos de la cotización manual se guardan como fila "sent" del artista', async () => {
    const extras = { items: [{ name: 'Sesión de tatuaje', qty: 2, price: 205000 }], discount_pct: 0, tax_pct: 0, policy: 'no-reembolsable-48', client_notes: 'Trae ropa cómoda.', extra_terms: 'Un retoque incluido.' };
    const f = fakeDeps();
    const res = await logic.handleProposal(REQ, 'QT-1', body({ complexity: 'Alta', extras }), f.deps);
    assert.equal(res.extras_saved, true);
    assert.equal(f.calls.manualInserts.length, 1);
    const row = f.calls.manualInserts[0];
    assert.equal(row.artist_id, ARTIST);
    assert.equal(row.status, 'sent');
    assert.equal(row.quote_id, 'QT-ABCD-XYZ-0077');
    assert.match(row.quote_ref, /^COT-[A-Z0-9]{4,12}$/);
    assert.equal(row.total, 410000);
    assert.equal(row.cancellation_policy, 'no-reembolsable-48');
    assert.equal(row.client_notes, 'Trae ropa cómoda.');
    assert.equal(row.project.complexity, 'Alta');
    assert.equal(f.calls.saves[0].patch.artist_budget_amount, 410000, 'el presupuesto es el total del desglose');

    // Fila existente (cotización manual o respuesta anterior): se actualiza.
    const existing = fakeDeps({ manual: { id: 'm-1', artist_id: ARTIST, validity_days: 30, project: { title: 'Manga' } } });
    await logic.handleProposal(REQ, 'QT-1', body({ extras }), existing.deps);
    assert.equal(existing.calls.manualInserts.length, 0);
    assert.equal(existing.calls.manualPatches[0].id, 'm-1');
    assert.equal(existing.calls.manualPatches[0].artistId, ARTIST);
    assert.equal(existing.calls.manualPatches[0].patch.project.title, 'Manga');

    // Una fila de otra cuenta nunca se toca.
    const foreign = fakeDeps({ manual: { id: 'm-9', artist_id: 'otro' } });
    const blocked = await logic.handleProposal(REQ, 'QT-1', body({ extras }), foreign.deps);
    assert.equal(foreign.calls.manualPatches.length + foreign.calls.manualInserts.length, 0);
    assert.equal(blocked.extras_saved, false);

    // Si la fila manual falla, la propuesta ya guardada no se pierde: se avisa.
    const broken = fakeDeps({ manualError: true });
    const partial = await logic.handleProposal(REQ, 'QT-1', body({ extras }), broken.deps);
    assert.equal(partial.ok, true);
    assert.equal(partial.extras_saved, false);
    assert.equal(broken.calls.saves.length, 1);
});

test('P29: tras el acuerdo la seña de la fila manual se alinea', async () => {
    const none = await logic.handleAgreementSync(REQ, 'QT-1', fakeDeps().deps);
    assert.deepEqual(none, { ok: true, synced: false });
    const f = fakeDeps({
        quote: quoteRow({ quote_status: 'client_approved', artist_deposit_pct: 50, artist_deposit_amount: 400 }),
        manual: { id: 'm-1', artist_id: ARTIST, deposit_pct: 30, deposit_amount: 300 },
    });
    assert.deepEqual(await logic.handleAgreementSync(REQ, 'QT-1', f.deps), { ok: true, synced: true });
    assert.equal(f.calls.manualPatches[0].patch.deposit_pct, 50);
    assert.equal(f.calls.manualPatches[0].patch.deposit_amount, 400);
    const same = fakeDeps({ quote: quoteRow({ artist_deposit_pct: 30, artist_deposit_amount: 300 }), manual: { id: 'm-1', artist_id: ARTIST, deposit_pct: 30, deposit_amount: 300 } });
    assert.deepEqual(await logic.handleAgreementSync(REQ, 'QT-1', same.deps), { ok: true, synced: false });
});

// ---------------------------------------------------------- contexto y agenda
test('contexto del diálogo: editable, zona horaria y campos guardados', async () => {
    const f = fakeDeps({
        quote: quoteRow({ quote_status: 'responded', offered_slots: [{ kind: 'slot', label: 'x' }], proposal_message: 'Hola' }),
        manual: { id: 'm-1', artist_id: ARTIST, line_items: [{ name: 'Sesión', qty: 1, price: 100 }], cancellation_policy: 'sin-sena', client_notes: 'Nota', project: { complexity: 'Media' } },
    });
    const res = await logic.handleContext(REQ, 'QT-1', f.deps);
    assert.equal(res.ok, true);
    assert.equal(res.editable, true);
    assert.equal(res.mode, 'update');
    assert.equal(res.timezone, TZ);
    assert.equal(res.has_schedule, true);
    assert.equal(res.has_manual, true);
    assert.equal(res.extras.policy, 'sin-sena');
    assert.equal(res.extras.complexity, 'Media');
    assert.deepEqual(res.extras.items.map((it) => it.name), ['Sesión']);
    assert.deepEqual(res.quotation.offered_slots, [{ kind: 'slot', label: 'x' }]);
    assert.equal(res.quotation.client_email, undefined, 'sin datos del cliente');

    const approved = await logic.handleContext(REQ, 'QT-1', fakeDeps({ quote: quoteRow({ quote_status: 'client_approved' }) }).deps);
    assert.equal(approved.editable, false);
    assert.equal(approved.code, 'approved');
    // La fila manual de otra cuenta no se expone.
    const foreign = await logic.handleContext(REQ, 'QT-1', fakeDeps({ manual: { id: 'm', artist_id: 'otro', client_notes: 'secreto' } }).deps);
    assert.equal(foreign.has_manual, false);
    assert.equal(foreign.extras.clientNotes, '');
});

test('agenda para el calendario: rango acotado, estados y turnos sugeridos', async () => {
    const f = fakeDeps({ blocking: [{ starts_at: '2026-11-18T13:00:00Z', ends_at: '2026-11-18T21:00:00Z', kind: 'session' }] });
    const res = await logic.handleAvailability(REQ, 'QT-1', { from: '2026-11-01', to: '2026-11-30', minutes: '180' }, f.deps);
    assert.equal(res.ok, true);
    assert.equal(res.from, '2026-11-16', 'nunca antes de hoy');
    assert.equal(res.to, '2026-11-30');
    assert.equal(res.today, '2026-11-16');
    assert.equal(res.timezone, TZ);
    assert.equal(res.days.length, 15);
    assert.equal(res.days.find((d) => d.date === '2026-11-18').status, 'busy');
    assert.equal(res.days.find((d) => d.date === '2026-11-17').slots[0].label, '10:00–13:00');
    // Tope de 62 días por pedido y minutos por defecto de la cotización.
    const wide = await logic.handleAvailability(REQ, 'QT-1', { from: '2026-12-01', to: '2027-06-30' }, fakeDeps({ quote: quoteRow({ artist_session_minutes: 120 }) }).deps);
    assert.equal(wide.days.length, logic.MAX_CALENDAR_DAYS);
    assert.equal(wide.minutes, 120);
    const far = await logic.handleAvailability(REQ, 'QT-1', { from: '2029-01-01' }, fakeDeps().deps);
    assert.equal(far.status, 400);
});

// ------------------------------------------------------------------- rutas
test('rutas: cuatro endpoints, sin caché y sin errores crudos de la base', async () => {
    const registered = [];
    const app = { get: (p, ...h) => registered.push(['GET', p, h]), post: (p, ...h) => registered.push(['POST', p, h]) };
    const pass = (req, res, next) => next && next();
    const f = fakeDeps();
    routes.register(app, { readLimiter: pass, writeLimiter: pass, logicDeps: f.deps, log: { error() {} } });
    assert.deepEqual(registered.map(([m, p]) => `${m} ${p}`), [
        'GET /api/cot-respuesta/quotations/:quoteId/proposal',
        'GET /api/cot-respuesta/quotations/:quoteId/availability',
        'POST /api/cot-respuesta/quotations/:quoteId/proposal',
        'POST /api/cot-respuesta/quotations/:quoteId/agreement-sync',
    ]);
    const call = async (index, req) => {
        const out = { headers: {}, status: 200, body: null };
        const res = { set: (k, v) => { out.headers[k] = v; }, status(code) { out.status = code; return this; }, json(payload) { out.body = payload; return this; } };
        const handlers = registered[index][2];
        await handlers[handlers.length - 1](Object.assign({ params: { quoteId: 'QT-1' }, query: {}, body: {} }, REQ, req), res);
        return out;
    };
    const ok = await call(2, { body: body() });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.ok, undefined);
    assert.equal(ok.headers['Cache-Control'], 'no-store');
    const invalid = await call(2, { body: body({ amount: '' }) });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.success, false);
    assert.equal(invalid.body.code, 'invalid');
    assert.ok(invalid.body.errors.amount);

    // Un error inesperado nunca filtra el texto de PostgREST.
    const broken = fakeDeps({ saveError: new Error('PostgREST PATCH quotations_db failed (500): secret detail') });
    const registered2 = [];
    routes.register({ get() {}, post: (p, ...h) => registered2.push(h) }, { readLimiter: pass, writeLimiter: pass, logicDeps: broken.deps, log: { error() {} } });
    const out = { status: 200, body: null };
    await registered2[0][registered2[0].length - 1](Object.assign({ params: { quoteId: 'QT-1' }, body: body() }, REQ), { set() {}, status(c) { out.status = c; return this; }, json(p) { out.body = p; return this; } });
    assert.equal(out.status, 500);
    assert.equal(out.body.error, 'No pudimos guardar la propuesta. Intenta de nuevo.');
    assert.doesNotMatch(JSON.stringify(out.body), /PostgREST|secret/);
});

test('server.js registra las rutas del frente antes de las redirecciones legacy y del estático', () => {
    const src = read('server.js');
    const line = "require('./lib/routes/cot-respuesta').register(app);";
    const at = src.indexOf(line);
    assert.ok(at > 0, 'registro de una línea');
    assert.equal(src.split(line).length - 1, 1, 'una sola vez');
    assert.ok(at < src.indexOf('legacyRedirectFor(req.path'), 'antes de las redirecciones legacy');
    assert.ok(at < src.indexOf("app.use(express.static(path.join(__dirname, 'public')))"), 'antes de express.static');
    const repo = read('lib/repos/cot-respuesta.js');
    assert.match(repo, /require\('\.\.\/postgrest'\)/, 'acceso a datos por la capa PostgREST');
    assert.doesNotMatch(repo + read('lib/cot-respuesta.js'), /\/rest\/v1\/|fetch\(/);
    assert.match(repo, /\.eq\('id', id\)\.eq\('artist_id', artistId\)\.eq\('quote_status', expectedStatus\)/, 'guardia de dueño y estado en la escritura');
});

// ------------------------------------------------------------------- email
test('email: artist_updated_quotation_proposal es solo-servidor, al cliente y con CTA absoluto', () => {
    const events = require('../services/email-events/cot-respuesta.js');
    assert.deepEqual(Object.keys(events), ['artist_updated_quotation_proposal']);
    const def = events.artist_updated_quotation_proposal;
    assert.equal(def.serverOnly, true);
    assert.equal(def.recipient({ client_email: 'c@example.com', artist_email: 'a@example.com' }), 'c@example.com');
    assert.equal(def.render.audience, 'client');
    assert.equal(def.render.category, 'quotations');
    const attribs = def.attribs({ quote_id: 'QT-1', client_whatsapp: '+54', budget_text: '410.000 ARS' });
    assert.equal(attribs.client_whatsapp, undefined, 'lista blanca de variables');
    assert.equal(attribs.budget_text, '410.000 ARS');

    const { EVENTS } = require('../services/email-event-mapping');
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
    assert.ok(EVENTS.artist_updated_quotation_proposal, 'cargado por el mapeo');
    assert.ok(SERVER_ONLY_EVENTS.has('artist_updated_quotation_proposal'), 'el navegador no puede dispararlo');
    assert.equal(logic.UPDATE_EVENT, 'artist_updated_quotation_proposal');

    const { renderEmail } = require('../lib/email-render');
    const out = renderEmail('artist_updated_quotation_proposal', {
        app_base_url: 'https://beta.weotzi.com', quote_id: 'QT-1', client_email: 'c@example.com', client_name: 'Lucía Fernández', artist_name: 'Mateo Rivas',
        budget_text: '410.000 ARS', deposit_text: '30 % · 123.000 ARS', sessions_text: '2 sesiones', duration_text: '3 h',
        offered_text: 'sáb 5 dic 2026 · 14:00–17:00; 10 al 15 dic 2026', location: 'Estudio Norte<script>alert(1)</script>',
        message_preview: 'Hola Lucía, te espero.', quotation_url: 'https://beta.weotzi.com/client/dashboard?quote=QT-1',
    }, { role: 'client' });
    assert.equal(out.subject, 'Mateo Rivas actualizó su propuesta');
    assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110);
    assert.equal(out.cta.url, 'https://beta.weotzi.com/client/dashboard?quote=QT-1');
    assert.match(out.text, /Fechas ofrecidas: sáb 5 dic 2026 · 14:00–17:00; 10 al 15 dic 2026/);
    assert.match(out.text, /Seña: 30 % · 123\.000 ARS/);
    assert.match(out.text, /Hola Lucía, te espero\./);
    assert.doesNotMatch(out.html, /<script>alert/);
    // Sin quotation_url cae al panel del cliente (nunca queda sin botón).
    const fallback = renderEmail('artist_updated_quotation_proposal', { app_base_url: 'https://beta.weotzi.com', quote_id: 'QT-1', client_email: 'c@example.com' }, { role: 'client' });
    assert.equal(fallback.cta.url, 'https://beta.weotzi.com/client/dashboard?quote=QT-1');
});
