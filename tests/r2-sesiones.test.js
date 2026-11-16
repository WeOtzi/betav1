'use strict';

// Ronda 2 · frente "sesiones" (N12, P28, P27-sesión) — servidor.
// Avisos con dobles (sin red), modelo puro, validación, rutas con una app
// falsa, eventos de email renderizados, Google Calendar y la migración (lectura).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const Model = require('../public/shared/js/wo-session-model.js');
const Sesiones = require('../lib/sesiones');
const notices = require('../lib/cot-artista-notices');
const routes = require('../lib/routes/sesiones');
const EVENTS = require('../services/email-events/sesiones');
const { resolveEmailContext, SERVER_ONLY_EVENTS } = require('../services/email-request-context');
const { renderEmail } = require('../lib/email-render');
const { resolveRecipientRoles, getEvent } = require('../services/email-event-mapping');
const gcal = require('../lib/gcal-sync');

const MIGRATION = 'supabase/migrations/20261116150000_sesiones_confirmacion_ubicacion.sql';
const ROLLBACK = 'supabase/rollbacks/20261116150000_sesiones_confirmacion_ubicacion.down.sql';
const BASE = 'https://beta.weotzi.com';
const ARTIST = '22222222-2222-4222-8222-222222222222';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const SESSION = 'fcdaa6c7-f9d8-408a-9544-56b0385e37db';
const REQUEST = '6aaff33c-4cc4-4633-b6d3-9315b991be44';
const NOW = Date.parse('2026-11-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (days, hours = 0) => new Date(NOW + days * DAY + hours * 3600 * 1000).toISOString();
const FULL_ADDRESS = 'Estudio X - Av. Corrientes 2151, Buenos Aires, Argentina';

function quoteRow(extra) {
    return Object.assign({
        id: 2787, quote_id: 'QN3501', quote_status: 'client_approved', dispute_status: 'none',
        client_user_id: CLIENT, client_email: 'lucia@example.com', client_full_name: 'Lucía Fernández',
        artist_id: ARTIST, artist_email: 'mateo@example.com', artist_name: 'Mateo Rivas', artist_username: 'mateo.ink',
        tattoo_body_part: 'Antebrazo', created_at: iso(-10),
    }, extra || {});
}

function sessionRow(extra) {
    return Object.assign({
        id: SESSION, quotation_id: 2787, session_number: 1, session_date: iso(10), duration_hours: 3,
        status: 'scheduled', location: FULL_ADDRESS, location_kind: 'studio', location_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        client_confirmation: 'pending', client_confirmed_at: null, notes: 'Nota privada del artista',
        photo_urls: ['a/b.jpg'], google_event_id: 'gcal-1', created_at: iso(-1), updated_at: iso(-1),
    }, extra || {});
}

function fakeSend() {
    const sent = [];
    return { sent, sendEmail: async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return { ok: true }; } };
}

// ───────────────────────────────────────────────────────────── N12
test('N12: el aviso de sesión acepta el id real (uuid) y sigue rechazando basura', () => {
    assert.equal(notices.normalizeSessionId(SESSION.toUpperCase()), SESSION);
    assert.equal(notices.normalizeSessionId('3'), 3);
    assert.equal(notices.normalizeSessionId(7), 7);
    for (const bad of [null, undefined, '', 'x', '1 or 1=1', `${SESSION}x`, '12345678901234']) {
        assert.equal(notices.normalizeSessionId(bad), null, String(bad));
    }
    assert.ok(notices.SESSION_EVENTS.includes('session_rescheduled') && notices.SESSION_EVENTS.includes('session_cancelled'));
});

// Camino completo con el resolveEmailContext REAL y lecturas falsas: antes del
// arreglo esto respondía 400 ("Falta la sesión asociada al correo.") porque
// quotation_sessions.id es uuid y el aviso exigía /^\d{1,12}$/.
function realContext(session, quote) {
    const rows = {
        quotations_db: (f) => (f.quote_id === quote.quote_id || String(f.id) === String(quote.id) ? quote : null),
        artists_db: (f) => (f.user_id === ARTIST ? { user_id: ARTIST, name: 'Mateo Rivas', email: 'mateo@example.com' } : null),
        quotation_sessions: (f) => (String(f.id) === String(session.id) && f.quotation_id === quote.id ? session : null),
    };
    return (req, eventId, input) => resolveEmailContext(req, eventId, input, {
        read: async (table, fields) => (rows[table] ? rows[table](fields) : null),
        resolveUser: async () => ({ id: ARTIST, email: 'mateo@example.com' }),
    });
}

test('N12: reprogramar y cancelar mandan el correo al cliente Y al artista por el relé', async () => {
    for (const [eventId, status] of [['session_rescheduled', 'rescheduled'], ['session_cancelled', 'cancelled']]) {
        const quote = quoteRow();
        const session = sessionRow({ status, client_confirmation: 'confirmed' });
        const f = fakeSend();
        const result = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: eventId, session_id: SESSION }, {
            useDefaults: false, baseUrl: BASE, sendEmail: f.sendEmail,
            resolveEmailContext: realContext(session, quote),
            resolveChannel: async () => 'smtp_relay', // app_settings.email_routing = {"*":{"channel":"smtp_relay"}}
        });
        assert.equal(result.ok, true, eventId);
        assert.equal(result.event, eventId);
        assert.deepEqual(f.sent.map((s) => s.eventId), [eventId, eventId]);
        const [client, artist] = f.sent;
        assert.equal(client.payload.client_email, 'lucia@example.com');
        assert.equal(client.payload.artist_email, '', 'la copia del cliente no arrastra al artista');
        assert.equal(client.payload.recipient_role, 'client');
        assert.equal(artist.payload.artist_email, 'mateo@example.com');
        assert.equal(artist.payload.client_email, '');
        assert.equal(artist.payload.recipient_role, 'artist');
        assert.match(client.options.idempotencyKey, new RegExp(`^QN3501:session:${SESSION}:.+:client$`));
        assert.match(artist.options.idempotencyKey, /:artist$/);
        // Lo privado de la sesión no viaja al correo.
        for (const copy of f.sent) {
            assert.equal(copy.payload.notes, undefined);
            assert.equal(copy.payload.photo_urls, undefined);
            assert.equal(copy.payload.google_event_id, undefined);
            assert.equal(copy.payload.location, FULL_ADDRESS, 'la dirección completa viaja al correo');
        }
        // Y el evento sale de verdad con un destinatario por copia.
        assert.deepEqual(resolveRecipientRoles(eventId, client.payload).map((r) => r.role), ['client']);
        assert.deepEqual(resolveRecipientRoles(eventId, artist.payload).map((r) => r.role), ['artist']);
    }
});

test('N12: sin sesión guardada, con otro estado o con un id inválido no sale nada', async () => {
    const quote = quoteRow();
    const f = fakeSend();
    const deps = { useDefaults: false, baseUrl: BASE, sendEmail: f.sendEmail, resolveEmailContext: realContext(sessionRow({ status: 'scheduled' }), quote) };
    const wrongStatus = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_cancelled', session_id: SESSION }, deps);
    assert.equal(wrongStatus.status, 409);
    const unknown = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_scheduled', session_id: '99999999-9999-4999-8999-999999999999' }, deps);
    assert.equal(unknown.status, 409);
    const bad = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_scheduled', session_id: 'nope' }, deps);
    assert.equal(bad.status, 400);
    assert.equal(f.sent.length, 0);
});

// ───────────────────────────────────────────────────────────── P28 · avisos
test('P28: una sesión por confirmar avisa "confírmala o pide otra fecha" (no "quedó agendada")', async () => {
    const quote = quoteRow();
    const f = fakeSend();
    const result = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_scheduled', session_id: SESSION }, {
        useDefaults: false, baseUrl: BASE, sendEmail: f.sendEmail, resolveChannel: async () => 'smtp_relay',
        resolveEmailContext: realContext(sessionRow({ client_confirmation: 'pending' }), quote),
    });
    assert.equal(result.event, 'session_confirmation_requested');
    assert.deepEqual(f.sent.map((s) => s.eventId), ['session_confirmation_requested', 'session_confirmation_requested']);
    assert.match(f.sent[0].options.idempotencyKey, /:confirm:client$/);
    assert.equal(f.sent[0].options.actorUserId, undefined, 'sin resolveUser no se inventa un actor');
    assert.equal(f.sent[0].options.push, undefined, 'el pedido de confirmación sí avisa por push al cliente');
    assert.equal(f.sent[0].payload.proposal_changed, false);
    assert.equal(f.sent[0].payload.session_id, SESSION);
    assert.match(f.sent[0].payload.location_maps, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Estudio%20X/);
    assert.equal(f.sent[0].payload.edit_window_days, 3);

    const plan = notices.sessionNoticePlan('session_rescheduled', { client_confirmation: 'pending', client_user_id: CLIENT, id: SESSION }, 'k');
    assert.equal(plan.eventId, 'session_confirmation_requested');
    assert.equal(plan.payload.proposal_changed, true);

    // EP-01: el artista que agendó viaja como actor (no recibe el push de su propia propuesta).
    const g = fakeSend();
    await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_rescheduled', session_id: SESSION }, {
        useDefaults: false, baseUrl: BASE, sendEmail: g.sendEmail, resolveChannel: async () => 'smtp_relay',
        resolveUser: async () => ({ id: ARTIST, email: 'mateo@example.com' }),
        resolveEmailContext: realContext(sessionRow({ status: 'rescheduled', client_confirmation: 'pending' }), quote),
    });
    assert.deepEqual(g.sent.map((s) => [s.eventId, s.options.actorUserId]), [
        ['session_confirmation_requested', ARTIST], ['session_confirmation_requested', ARTIST],
    ]);
    assert.equal(plan.key, 'k:confirm');
    // Confirmada, sin cuenta de cliente o base sin la migración: el aviso de siempre.
    for (const payload of [
        { client_confirmation: 'confirmed', client_user_id: CLIENT },
        { client_confirmation: 'pending', client_user_id: null },
        { client_user_id: CLIENT },
    ]) {
        const same = notices.sessionNoticePlan('session_scheduled', payload, 'k');
        assert.equal(same.eventId, 'session_scheduled');
        assert.equal(same.key, 'k');
        assert.equal(same.payload, payload);
    }
    assert.equal(notices.sessionNoticePlan('session_cancelled', { client_confirmation: 'pending', client_user_id: CLIENT }, 'k').eventId, 'session_cancelled');
});

test('ausencia: el cliente recibe session_no_show; solo el artista y solo con la sesión en no_show', async () => {
    const quote = quoteRow();
    const base = { useDefaults: false, baseUrl: BASE, readQuote: async () => quote, resolveChannel: async () => 'smtp_relay' };
    const ok = fakeSend();
    const sent = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_no_show', session_id: SESSION }, {
        ...base, sendEmail: ok.sendEmail, resolveUser: async () => ({ id: ARTIST }),
        readSession: async (id, quotationId) => (id === SESSION && quotationId === quote.id ? sessionRow({ status: 'no_show' }) : null),
    });
    assert.equal(sent.ok, true);
    assert.deepEqual(ok.sent.map((s) => `${s.eventId}:${s.payload.recipient_role}`), ['session_no_show:client', 'session_no_show:artist']);
    assert.equal(ok.sent[0].options.idempotencyKey, `QN3501:session:${SESSION}:no_show:client`);
    assert.deepEqual(ok.sent.map((s) => s.options.actorUserId), [ARTIST, ARTIST], 'el artista que registró la ausencia no recibe su propio aviso');
    assert.equal(ok.sent[0].payload.notes, undefined, 'las notas privadas no viajan');

    const none = fakeSend();
    const asClient = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_no_show', session_id: SESSION }, {
        ...base, sendEmail: none.sendEmail, resolveUser: async () => ({ id: CLIENT }), readSession: async () => sessionRow({ status: 'no_show' }),
    });
    assert.equal(asClient.status, 403);
    const notNoShow = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_no_show', session_id: SESSION }, {
        ...base, sendEmail: none.sendEmail, resolveUser: async () => ({ id: ARTIST }), readSession: async () => sessionRow({ status: 'scheduled' }),
    });
    assert.equal(notNoShow.status, 409);
    const anon = await notices.handleSessionNotice({ headers: {} }, quote.quote_id, { event: 'session_no_show', session_id: SESSION }, {
        ...base, sendEmail: none.sendEmail, resolveUser: async () => null, readSession: async () => sessionRow({ status: 'no_show' }),
    });
    assert.equal(anon.status, 401);
    assert.equal(none.sent.length, 0);
});

test('acuerdo: la primera sesión por confirmar suma el pedido de confirmación al cliente', async () => {
    const quote = quoteRow();
    const f = fakeSend();
    const result = await notices.handleAgreementNotice({ headers: {} }, quote.quote_id, {
        useDefaults: false, baseUrl: BASE, sendEmail: f.sendEmail, resolveChannel: async () => 'smtp_relay',
        resolveUser: async () => ({ id: ARTIST }), readQuote: async () => quote,
        readSessions: async () => [{ id: SESSION, session_date: iso(10), status: 'scheduled' }],
        readSession: async () => sessionRow({ client_confirmation: 'pending' }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(f.sent.map((s) => s.eventId), ['artist_confirmed_agreement', 'session_confirmation_requested', 'session_confirmation_requested']);
    // El acuerdo ya avisa por push al cliente: el pedido de confirmación del mismo acto sale solo por correo.
    assert.deepEqual(f.sent.map((s) => s.options.push), [undefined, false, false]);
    // Un turno reservado online ya nace confirmado: sin pedido de confirmación.
    const g = fakeSend();
    await notices.handleAgreementNotice({ headers: {} }, quote.quote_id, {
        useDefaults: false, baseUrl: BASE, sendEmail: g.sendEmail, resolveUser: async () => ({ id: ARTIST }), readQuote: async () => quote,
        readSessions: async () => [{ id: SESSION, session_date: iso(10), status: 'scheduled' }],
        readSession: async () => sessionRow({ client_confirmation: 'confirmed' }),
    });
    assert.deepEqual(g.sent.map((s) => s.eventId), ['artist_confirmed_agreement']);
});

// ───────────────────────────────────────────────────────────── modelo
test('modelo: fases, ventana de 3 días y candados', () => {
    assert.equal(Model.EDIT_WINDOW_DAYS, 3);
    assert.equal(Model.phase(sessionRow(), NOW), 'upcoming');
    assert.equal(Model.phase(sessionRow({ session_date: iso(-1) }), NOW), 'past');
    assert.equal(Model.phase(sessionRow({ status: 'completed' }), NOW), 'done');
    assert.equal(Model.phase(sessionRow({ status: 'no_show' }), NOW), 'no_show');
    assert.equal(Model.phase(sessionRow({ status: 'cancelled' }), NOW), 'cancelled');
    assert.equal(Model.editDeadline(sessionRow({ session_date: iso(10) })).toISOString(), iso(7));
    assert.equal(Model.withinEditWindow(sessionRow({ session_date: iso(3, 1) }), NOW), true);
    assert.equal(Model.withinEditWindow(sessionRow({ session_date: iso(3, -1) }), NOW), false);
    // Filas anteriores a la migración (sin la columna) ya estaban acordadas.
    assert.equal(Model.confirmationOf({}), 'confirmed');
    assert.equal(Model.confirmationOf({ client_confirmation: 'cualquiera' }), 'confirmed');
    assert.match(Model.lockCopy('window'), /menos de 3 días/);
    assert.match(Model.lockCopy('past'), /ya pasó/);
});

function can(session, ctx) {
    const p = Model.permissions(session, Object.assign({ now: NOW, quoteStatus: 'client_approved', hasClientAccount: true }, ctx));
    return Object.keys(p).filter((k) => p[k] === true).sort().join(',') + (p.locked ? ` [${p.locked}]` : '');
}

test('P28: qué puede hacer cada parte según el estado de la sesión', () => {
    const pending = sessionRow({ client_confirmation: 'pending' });
    assert.equal(can(pending, { role: 'client' }), 'confirm,dispute,requestChange');
    assert.equal(can(pending, { role: 'artist' }), 'dispute,editDirect');

    const asked = sessionRow({ client_confirmation: 'change_requested' });
    const byClient = { status: 'pending', requested_by_role: 'client' };
    assert.equal(can(asked, { role: 'client', request: byClient }), 'confirm,dispute,requestChange,withdraw');
    assert.equal(can(asked, { role: 'artist', request: byClient }), 'dispute,editDirect,respond');

    const confirmed = sessionRow({ client_confirmation: 'confirmed', session_date: iso(10) });
    assert.equal(can(confirmed, { role: 'client' }), 'dispute,requestChange');
    assert.equal(can(confirmed, { role: 'artist' }), 'dispute,requestChange', 'confirmada: el artista ya no edita directo');
    const byArtist = { status: 'pending', requested_by_role: 'artist' };
    assert.equal(can(confirmed, { role: 'client', request: byArtist }), 'dispute,respond');
    assert.equal(can(confirmed, { role: 'artist', request: byArtist }), 'dispute,requestChange,withdraw');

    // Menos de 3 días: no se puede pedir cambio; queda la disputa.
    const soon = sessionRow({ client_confirmation: 'confirmed', session_date: iso(2) });
    assert.equal(can(soon, { role: 'client' }), 'dispute [window]');
    assert.equal(can(soon, { role: 'artist' }), 'dispute [window]');
    // …pero un pedido hecho a tiempo todavía se puede responder.
    assert.equal(can(soon, { role: 'client', request: byArtist }), 'dispute,respond [window]');

    // Pasadas: solo registro/calificación y disputa.
    for (const past of [sessionRow({ session_date: iso(-2) }), sessionRow({ status: 'completed' }), sessionRow({ status: 'no_show' })]) {
        assert.equal(can(past, { role: 'client' }), 'dispute,rate [past]');
        assert.equal(can(past, { role: 'artist' }), 'dispute,rate [past]');
    }
    assert.equal(can(sessionRow({ status: 'cancelled' }), { role: 'client' }), 'dispute [closed]');
    // Disputa activa o cotización no disputable: sin botón de disputa.
    assert.equal(can(confirmed, { role: 'client', disputeActive: true }), 'requestChange');
    assert.equal(can(sessionRow({ session_date: iso(-2) }), { role: 'client', quoteStatus: 'responded' }), 'rate [past]');
    // Cotización cerrada: nada sobre sesiones futuras.
    assert.equal(can(confirmed, { role: 'client', quoteStatus: 'cancelled' }), ' [quote]');
    // Sin cuenta de cliente no hay con quién acordar: el artista edita como antes.
    assert.equal(can(confirmed, { role: 'artist', hasClientAccount: false }), 'editDirect');
});

test('modelo: insignias por rol', () => {
    const badge = (session, ctx) => Model.statusBadge(session, Object.assign({ now: NOW, hasClientAccount: true }, ctx)).label;
    assert.equal(badge(sessionRow(), { role: 'client' }), 'Por confirmar');
    assert.equal(badge(sessionRow(), { role: 'artist' }), 'Espera confirmación');
    assert.equal(badge(sessionRow({ client_confirmation: 'change_requested' }), { role: 'artist' }), 'El cliente pidió un cambio');
    assert.equal(badge(sessionRow({ client_confirmation: 'confirmed' }), { role: 'client' }), 'Confirmada');
    assert.equal(badge(sessionRow({ client_confirmation: 'confirmed' }), { role: 'client', request: { requested_by_role: 'artist' } }), 'Te pidieron un cambio');
    assert.equal(badge(sessionRow({ client_confirmation: 'confirmed' }), { role: 'artist', request: { requested_by_role: 'artist' } }), 'Cambio en revisión');
    assert.equal(badge(sessionRow({ status: 'completed' }), { role: 'client' }), 'Realizada');
    assert.equal(badge(sessionRow({ status: 'no_show' }), { role: 'client' }), 'Ausencia registrada');
    assert.equal(badge(sessionRow({ status: 'cancelled' }), { role: 'client' }), 'Cancelada');
    assert.equal(badge(sessionRow(), { role: 'artist', hasClientAccount: false }), 'Agendada');
});

test('P27: dirección completa, origen y enlace a Google Maps', () => {
    assert.equal(Model.fullLocation('Estudio X', 'Av. Corrientes 2151, Buenos Aires, Argentina'), FULL_ADDRESS);
    assert.equal(Model.fullLocation('Estudio X', 'Estudio X, Av. Corrientes 2151'), 'Estudio X, Av. Corrientes 2151', 'no repite el nombre');
    assert.equal(Model.fullLocation('', '  Calle   1  '), 'Calle 1');
    assert.equal(Model.fullLocation('Solo nombre', ''), 'Solo nombre');
    assert.ok(Model.fullLocation('N', 'x'.repeat(400)).length <= Model.LOCATION_MAX);
    assert.equal(Model.studioAddress({ formatted_address: 'Av. Corrientes 2151, C1045 CABA, Argentina' }, {}), 'Av. Corrientes 2151, C1045 CABA, Argentina');
    assert.equal(Model.studioAddress({ street: 'Av. Corrientes', street_number: '2151', city: 'Buenos Aires', locality: 'Buenos Aires', country: 'Argentina' }, {}),
        'Av. Corrientes 2151, Buenos Aires, Argentina');
    assert.equal(Model.studioAddress(null, { city: 'Lima', country: 'Perú' }), 'Lima, Perú');
    assert.equal(Model.mapsUrl('Av. Corrientes 2151', 'ChIJN1t_tDeuEmsRUsoyG83frY4'),
        'https://www.google.com/maps/search/?api=1&query=Av.%20Corrientes%202151&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4');
    assert.equal(Model.mapsUrl('Calle 1', '"><script>'), 'https://www.google.com/maps/search/?api=1&query=Calle%201', 'place_id raro se descarta');
    assert.equal(Model.mapsUrl('', 'x'), '');

    assert.deepEqual(Model.normalizeLocation({}), { ok: true, value: null });
    assert.deepEqual(Model.normalizeLocation({ location: `  ${FULL_ADDRESS} `, location_kind: 'studio', location_ref: 'A1111111-1111-4111-8111-111111111111' }).value, {
        location: FULL_ADDRESS, location_kind: 'studio', location_ref: 'a1111111-1111-4111-8111-111111111111', location_place_id: null,
    });
    assert.equal(Model.normalizeLocation({ location: 'x', location_kind: 'inventado', location_ref: 'no-uuid' }).value.location_kind, 'custom');
    assert.equal(Model.normalizeLocation({ location: 'x', location_kind: 'custom', location_ref: 'a1111111-1111-4111-8111-111111111111' }).value.location_ref, null);
    assert.equal(Model.normalizeLocation({ location: 'x'.repeat(301) }).ok, false);
});

test('modelo: orden del panel y textos auxiliares', () => {
    const sorted = Model.sortForPanel([
        { id: 'p1', session_date: iso(-5), status: 'completed' },
        { id: 'u2', session_date: iso(9), status: 'scheduled' },
        { id: 'p2', session_date: iso(-1), status: 'scheduled' },
        { id: 'u1', session_date: iso(2), status: 'scheduled' },
    ], NOW).map((s) => s.id);
    assert.deepEqual(sorted, ['u1', 'u2', 'p2', 'p1']);
    assert.equal(Model.stars(4), '★★★★☆');
    assert.equal(Model.stars(9), '★★★★★');
    assert.equal(Model.durationLabel(2.5), '2 h 30 min');
    assert.equal(Model.durationLabel(0.25), '15 min');
    assert.equal(Model.disputeReasonLabel('cancelacion'), 'Cambio o cancelación sin acuerdo');
    assert.equal(Model.disputeReasonLabel('inventado'), '');
    assert.match(Model.proposalSummary({ proposed_date: iso(12), proposed_location: 'Otro lugar' }), /^Nueva fecha: .+ · Lugar: Otro lugar$/);
});

// ───────────────────────────────────────────────────────────── validación
test('validación: pedido de cambio (el cliente propone fecha; el artista también duración y lugar)', () => {
    const body = { proposed_date: iso(12), duration_hours: 4, location: FULL_ADDRESS, location_kind: 'studio', note: '  No puedo ese día  ' };
    const client = Sesiones.parseChangeBody(body, 'client', NOW);
    assert.deepEqual(client, { proposed_date: iso(12), duration_hours: null, location: null, location_kind: null, location_ref: null, location_place_id: null, note: 'No puedo ese día' });
    const artist = Sesiones.parseChangeBody(body, 'artist', NOW);
    assert.equal(artist.duration_hours, 4);
    assert.equal(artist.location, FULL_ADDRESS);
    assert.equal(artist.location_kind, 'studio');
    const fails = (b, role) => { try { Sesiones.parseChangeBody(b, role, NOW); return null; } catch (e) { return e; } };
    assert.equal(fails({ proposed_date: iso(-1) }, 'client').status, 400);
    assert.equal(fails({ proposed_date: 'ayer' }, 'client').status, 400);
    assert.equal(fails({ proposed_date: iso(900) }, 'client').status, 400);
    assert.equal(fails({ note: 'solo nota' }, 'client').code, 'invalid_proposal');
    assert.equal(fails({ location: 'x' }, 'client').code, 'invalid_proposal', 'el cliente no cambia el lugar');
    assert.equal(fails({ duration_hours: 30 }, 'artist').status, 400);
    assert.equal(fails({ proposed_date: iso(5), note: 'x'.repeat(1001) }, 'client').status, 400);
    assert.equal(fails(null, 'artist').expose, true);
});

test('validación: respuesta, registro y disputa', () => {
    assert.deepEqual(Sesiones.parseRespondBody({ decision: 'ACCEPT', note: ' ok ' }), { accept: true, note: 'ok' });
    assert.deepEqual(Sesiones.parseRespondBody({ decision: 'reject' }), { accept: false, note: null });
    assert.throws(() => Sesiones.parseRespondBody({ decision: 'quizás' }), /aceptas o rechazas/);
    assert.deepEqual(Sesiones.parseFeedbackBody({ rating: 5, note: ' Todo bien ' }), { rating: 5, note: 'Todo bien' });
    assert.equal(Sesiones.parseFeedbackBody({ rating: '4' }).rating, 4, 'el formulario manda texto');
    for (const rating of [0, 6, 2.5, 'cinco', null]) {
        assert.throws(() => Sesiones.parseFeedbackBody({ rating }), /1 a 5 estrellas/, String(rating));
    }
    assert.throws(() => Sesiones.parseFeedbackBody({ rating: 3, note: 'x'.repeat(2001) }), /2000/);
    assert.deepEqual(Sesiones.parseDisputeBody({ reason: 'cancelacion', description: ' Cambió la fecha sin avisar. ' }), { reason: 'cancelacion', description: 'Cambió la fecha sin avisar.' });
    assert.throws(() => Sesiones.parseDisputeBody({ reason: 'diseno', description: 'Texto suficiente aquí.' }), /motivo/);
    assert.throws(() => Sesiones.parseDisputeBody({ reason: 'otro', description: 'corto' }), /mínimo 10/);

    const texts = Sesiones.disputeTexts(sessionRow({ session_number: 2 }), quoteRow(), { reason: 'cancelacion', description: 'Cambió la fecha sin avisar.' }, 'client');
    assert.equal(texts.subject, 'Sesión 2: Cambio o cancelación sin acuerdo');
    assert.ok(texts.subject.length <= 160);
    assert.match(texts.description, /cotización QN3501\./);
    assert.match(texts.description, /Lugar: Estudio X - Av\. Corrientes 2151/);
    assert.match(texts.description, /Abierta por: el cliente\.\n\nCambió la fecha sin avisar\.$/);
    assert.doesNotMatch(texts.description, /Nota privada/);
});

test('errores de la base → respuestas legibles (sin filtrar detalles)', () => {
    const map = (message) => Sesiones.mapDbError(new Error(`PostgREST POST rpc/x failed (400): {"code":"22023","message":"${message}"}`));
    assert.deepEqual([map('EDIT_WINDOW_CLOSED').status, map('EDIT_WINDOW_CLOSED').code], [409, 'edit_window_closed']);
    assert.match(map('EDIT_WINDOW_CLOSED').message, /menos de 3 días/);
    assert.equal(map('SESSION_PAST').code, 'session_past');
    assert.equal(map('SESSION_NOT_PAST').code, 'session_not_past');
    assert.equal(map('SESSION_CLOSED').code, 'session_closed');
    assert.equal(map('REQUEST_PENDING').code, 'request_pending');
    assert.equal(map('REQUEST_CLOSED').code, 'request_closed');
    assert.equal(map('DIRECT_EDIT').code, 'direct_edit');
    assert.equal(map('DISPUTE_ACTIVE').code, 'dispute_active');
    assert.equal(map('NOT_DISPUTABLE').code, 'not_disputable');
    assert.equal(map('TICKET_LIMIT').status, 429);
    assert.equal(map('FORBIDDEN').status, 403);
    assert.equal(map('SESSION_NOT_FOUND').status, 404);
    assert.equal(Sesiones.mapDbError(new Error('failed (409): {"code":"23P01","message":"CALENDAR_OVERLAP"}')).code, 'overlap');
    // Migración sin aplicar: 503 amable, no un 500.
    assert.equal(Sesiones.mapDbError(new Error('failed (404): {"code":"PGRST202","message":"Could not find the function public.sesiones_confirm"}')).status, 503);
    assert.equal(Sesiones.mapDbError(new Error('failed (400): {"code":"42703","message":"column quotation_sessions.client_confirmation does not exist"}')).code, 'sessions_unavailable');
    // Un error desconocido no se expone.
    assert.equal(Sesiones.mapDbError(new Error('boom')).expose, undefined);
    // Todos los textos nuevos van con tuteo.
    for (const token of ['EDIT_WINDOW_CLOSED', 'SESSION_PAST', 'REQUEST_PENDING', 'DIRECT_EDIT', 'INVALID_PROPOSAL', 'INVALID_FEEDBACK', 'DISPUTE_ACTIVE', 'INVALID_DISPUTE']) {
        assert.doesNotMatch(map(token).message, /\b(podés|querés|pedí|elegí|contanos|probá|respondelo|proponé|editala)\b/i, token);
    }
});

// ───────────────────────────────────────────────────────────── vistas y ubicaciones
test('vista de la sesión: sin notas privadas, fotos ni ids de Google; con permisos y registro', () => {
    const view = Sesiones.sessionView(sessionRow({ client_confirmation: 'confirmed' }), {
        role: 'client', quote: quoteRow(), now: NOW,
        request: { id: REQUEST, session_id: SESSION, requested_by_role: 'artist', status: 'pending', proposed_date: iso(12), note: 'Convención', requested_by: ARTIST },
        feedback: [{ author_role: 'artist', rating: 4, note: 'Bien', updated_at: iso(-1), author_user_id: ARTIST }],
        dispute: { opened_by_role: 'artist', reason: 'otro', created_at: iso(-1), support_tickets: { ticket_number: 12, status: 'open' } },
    });
    const flat = JSON.stringify(view);
    assert.doesNotMatch(flat, /Nota privada|photo_urls|gcal-1|google_event_id|requested_by"|author_user_id/);
    assert.equal(view.location, FULL_ADDRESS);
    assert.match(view.maps_url, /query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4$/);
    assert.equal(view.edit_deadline, iso(7));
    assert.deepEqual(view.request && { mine: view.request.mine, role: view.request.requested_by_role }, { mine: false, role: 'artist' });
    assert.equal(view.can.respond, true);
    assert.equal(view.can.request_change, false);
    assert.deepEqual(view.feedback, { mine: null, other: { rating: 4, note: 'Bien', updated_at: iso(-1) } });
    assert.deepEqual(view.dispute && { n: view.dispute.ticket_number, active: view.dispute.active }, { n: 12, active: true });
    assert.equal(view.badge.label, 'Te pidieron un cambio');

    const quote = Sesiones.quoteView(quoteRow(), 'client');
    assert.equal(quote.counterpart_name, 'Mateo Rivas');
    assert.equal(quote.client_name, '', 'el cliente no recibe su propio nombre de más');
    assert.equal(JSON.stringify(quote).includes('lucia@example.com'), false, 'sin emails en la vista');
    assert.equal(Sesiones.roleFor(quoteRow(), CLIENT.toUpperCase()), 'client');
    assert.equal(Sesiones.roleFor(quoteRow(), ARTIST), 'artist');
    assert.equal(Sesiones.roleFor(quoteRow(), '33333333-3333-4333-8333-333333333333'), null);
});

test('P27: opciones de ubicación (la del cliente, sedes del roster, propias y perfil)', () => {
    const studios = [{ id: 's1', name: 'Estudio X', city: 'Buenos Aires', country: 'Argentina', is_active: true }, { id: 's2', name: 'Otro Estudio', is_active: true, formatted_address: 'Calle 9, Lima, Perú' }];
    const studioLocations = [
        { id: 'l1', studio_id: 's1', label: 'Palermo', is_primary: false, sort_order: 2, formatted_address: 'Thames 1500, Buenos Aires, Argentina', google_place_id: 'ChIJ_palermo_place' },
        { id: 'l2', studio_id: 's1', label: 'Centro', is_primary: true, sort_order: 1, street: 'Av. Corrientes', street_number: '2151', city: 'Buenos Aires', country: 'Argentina' },
    ];
    const options = Sesiones.buildLocationOptions({
        roster: [{ studio_id: 's1', location_id: 'l1' }, { studio_id: 's2', location_id: null }],
        studios, studioLocations,
        artistLocations: [
            { id: 'a1', studio_name: 'Taller propio', city: 'Rosario', country: 'Argentina', period_type: 'current' },
            { id: 'a2', studio_name: 'Guest viejo', city: 'Madrid', country: 'España', period_type: 'upcoming', end_date: '2020-01-01' },
        ],
        artist: { estudios: 'Mateo Ink', formatted_address: 'Calle Falsa 123, Buenos Aires, Argentina' },
        quote: { preferred_location_id: 'A2222222-2222-4222-8222-222222222222', preferred_location_label: 'Estudio X · Centro', preferred_location_address: 'Av. Corrientes 2151, Buenos Aires, Argentina' },
    });
    // La sede "Centro" del roster no se repite: es la misma dirección que eligió el cliente.
    assert.deepEqual(options.map((o) => `${o.kind}|${o.location}`), [
        'client|Estudio X · Centro - Av. Corrientes 2151, Buenos Aires, Argentina',
        'studio|Estudio X · Palermo - Thames 1500, Buenos Aires, Argentina',
        'studio|Otro Estudio - Calle 9, Lima, Perú',
        'own|Taller propio - Rosario, Argentina',
        'own|Mateo Ink - Calle Falsa 123, Buenos Aires, Argentina',
    ]);
    const withoutClient = Sesiones.buildLocationOptions({ roster: [{ studio_id: 's1', location_id: 'l1' }], studios, studioLocations });
    assert.deepEqual(withoutClient.map((o) => o.location), [
        'Estudio X · Palermo - Thames 1500, Buenos Aires, Argentina',
        'Estudio X · Centro - Av. Corrientes 2151, Buenos Aires, Argentina',
    ]);
    assert.equal(options[0].ref, 'a2222222-2222-4222-8222-222222222222');
    assert.equal(options[0].group, 'Elegida por el cliente');
    assert.equal(options[1].ref, 'l1', 'primero la sede del contrato');
    assert.equal(options[1].place_id, 'ChIJ_palermo_place');
    assert.ok(options.every((o) => o.location.length <= Model.LOCATION_MAX && o.key));
    assert.equal(options.some((o) => /Guest viejo/.test(o.location)), false, 'una ubicación futura ya vencida no se ofrece');

    // Sin las columnas del frente cot-form no hay opción del cliente (y no falla).
    assert.equal(Sesiones.clientPreferredLocation(quoteRow()), null);
    assert.equal(Sesiones.clientPreferredLocation(null), null);
    assert.deepEqual(Sesiones.clientPreferredLocation({ preferred_location_name: 'Sede Sur', preferred_location_kind: 'studio' }),
        { label: 'Sede Sur', address: '', kind: 'studio', id: null, ref: null, studio_id: null, place_id: null, city: '', country: '' });
    assert.equal(Sesiones.clientPreferredLocation({ preferred_location_id: 'no-es-uuid' }), null);
    // Solo el estudio elegido: la dirección sale de su sede principal.
    const byStudio = Sesiones.buildLocationOptions({ studios, studioLocations, quote: { preferred_studio_id: 's1'.padEnd(8, '0') } });
    assert.deepEqual(byStudio, [], 'un id que no es uuid se ignora');
    const sid = 'c3333333-3333-4333-8333-333333333333';
    const fromStudio = Sesiones.buildLocationOptions({
        studios: [{ id: sid, name: 'Estudio Sur', is_active: true }],
        studioLocations: [{ id: 'l9', studio_id: sid, is_primary: true, formatted_address: 'Calle 5 123, Montevideo, Uruguay' }],
        quote: { preferred_studio_id: sid },
    });
    assert.deepEqual(fromStudio.map((o) => `${o.kind}|${o.location}`), ['client|Estudio Sur - Calle 5 123, Montevideo, Uruguay']);
    assert.deepEqual(Sesiones.buildLocationOptions({}), []);
});

// REQ-01: contrato cruzado con el frente cot-form. El cotizador guarda la sede elegida en
// preferred_location_type + preferred_location_ref; antes sesiones buscaba el id en columnas
// que no existen y "Elegida por el cliente" salía con la dirección de la sede principal.
test('P27: la sede que eligió el cliente al cotizar llega al agendar con SU dirección (nunca la de la principal)', () => {
    const cotForm = require('../lib/cot-form');
    const STUDIO = '11111111-aaaa-4111-8111-111111111111';
    const CENTRO = '22222222-aaaa-4222-8222-222222222222';
    const TIGRE = '33333333-aaaa-4333-8333-333333333333';
    const studios = [{ id: STUDIO, name: 'Estudio X', city: 'Buenos Aires', country: 'Argentina', is_active: true }];
    const studioLocations = [
        { id: CENTRO, studio_id: STUDIO, label: 'Centro', is_primary: true, is_active: true, formatted_address: 'Av. Corrientes 2151, Buenos Aires, Argentina', city: 'Buenos Aires', country: 'Argentina' },
        { id: TIGRE, studio_id: STUDIO, label: 'Tigre', is_primary: false, is_active: true, formatted_address: 'Av. Cazón 500, Tigre, Argentina', city: 'Tigre', country: 'Argentina', google_place_id: 'ChIJ_tigre_place' },
    ];
    // Lo que de verdad guarda el cotizador cuando el cliente elige la sede Tigre.
    const offered = cotForm.buildLocationOptions({ artist: { studio_id: STUDIO }, studios, studioLocations, memberships: [{ studio_id: STUDIO, role: 'resident' }] }, { today: '2026-11-15' });
    const columns = cotForm.preferredLocationColumns(offered.find((o) => o.ref === TIGRE));
    assert.equal(columns.preferred_location_type, 'studio_location');
    assert.equal(columns.preferred_location_ref, TIGRE);
    const quote = { id: 1, quote_id: 'QN1', ...columns };

    const preferred = Sesiones.clientPreferredLocation(quote);
    assert.equal(preferred.id, TIGRE, 'el id de la sede sale de preferred_location_ref');
    assert.equal(preferred.ref, TIGRE);
    assert.equal(preferred.kind, 'studio_location');
    assert.equal(preferred.studio_id, STUDIO);
    assert.deepEqual([preferred.city, preferred.country], ['Tigre', 'Argentina']);

    // Con la sede cargada por la ruta (repo.getStudioLocation(preferred.id)).
    const loaded = Sesiones.buildLocationOptions({ studios, studioLocations, quote, preferredStudioLocation: studioLocations[1] });
    assert.deepEqual(loaded.map((o) => [o.key, o.location, o.place_id, o.group]), [
        [`client:${TIGRE}`, 'Estudio X · Tigre - Av. Cazón 500, Tigre, Argentina', 'ChIJ_tigre_place', 'Elegida por el cliente'],
    ]);
    assert.equal(loaded[0].ref, TIGRE, 'la sesión guarda location_ref = la sede elegida');
    // Sin preferredStudioLocation: la encuentra entre las sedes del estudio ya cargadas.
    const fromList = Sesiones.buildLocationOptions({ studios, studioLocations, quote, preferredStudioLocation: null });
    assert.equal(fromList[0].location, 'Estudio X · Tigre - Av. Cazón 500, Tigre, Argentina');
    // La sede ya no se puede cargar (desactivada o borrada): ciudad y país de la cotización,
    // NUNCA la dirección de la sede principal.
    const gone = Sesiones.buildLocationOptions({ studios, studioLocations: [studioLocations[0]], quote, preferredStudioLocation: null });
    assert.equal(gone[0].kind, 'client');
    assert.equal(gone[0].location, 'Estudio X · Tigre - Tigre, Argentina');
    assert.doesNotMatch(JSON.stringify(gone[0]), /Corrientes/);
    // El resto de las sedes del roster sigue apareciendo aparte.
    const withRoster = Sesiones.buildLocationOptions({ roster: [{ studio_id: STUDIO, location_id: CENTRO }], studios, studioLocations, quote });
    assert.deepEqual(withRoster.map((o) => `${o.kind}|${o.location}`), [
        'client|Estudio X · Tigre - Av. Cazón 500, Tigre, Argentina',
        'studio|Estudio X · Centro - Av. Corrientes 2151, Buenos Aires, Argentina',
    ]);

    // El cliente eligió el estudio cuando todavía no tenía sedes (ref null): ahí sí vale la principal.
    const noSede = cotForm.buildLocationOptions({ artist: { studio_id: STUDIO }, studios, studioLocations: [] }, { today: '2026-11-15' });
    assert.equal(noSede[0].ref, null);
    const byStudio = Sesiones.buildLocationOptions({ studios, studioLocations, quote: cotForm.preferredLocationColumns(noSede[0]) });
    assert.equal(byStudio[0].location, 'Estudio X · Buenos Aires - Av. Corrientes 2151, Buenos Aires, Argentina');
    assert.equal(byStudio[0].ref, null);

    // Lugar propio del artista: la fila de artist_tattoo_locations con el mismo id.
    const OWN = '44444444-aaaa-4444-8444-444444444444';
    const TRIP = '55555555-aaaa-4555-8555-555555555555';
    const more = cotForm.buildLocationOptions({
        artist: {},
        tattooLocations: [{ id: OWN, period_type: 'current', studio_name: 'Taller Sur', city: 'Rosario', country: 'Argentina', agenda_status: 'open' }],
        trips: [{ id: TRIP, share_enabled: true, status: 'confirmado', city: 'Madrid', country: 'España', start_date: '2027-02-01', end_date: '2027-02-10', event_name: 'Convención' }],
    }, { today: '2026-11-15' });
    const ownQuote = cotForm.preferredLocationColumns(more.find((o) => o.type === 'artist_location'));
    const ownPreferred = Sesiones.clientPreferredLocation(ownQuote);
    assert.equal(ownPreferred.id, null, 'no es una sede: la ruta no la busca en studio_locations');
    assert.equal(ownPreferred.ref, OWN);
    const own = Sesiones.buildLocationOptions({ quote: ownQuote, artistLocations: [{ id: OWN, studio_name: 'Taller Sur', city: 'Rosario', country: 'Argentina', period_type: 'current' }] });
    assert.deepEqual(own.map((o) => [o.kind, o.ref, o.location]), [['client', OWN, 'Taller Sur - Rosario, Argentina']],
        'una sola vez: no se repite abajo en "Mis ubicaciones"');
    // Si la fila ya no está entre las ubicaciones del artista, queda lo guardado en la cotización.
    const ownGone = Sesiones.buildLocationOptions({ quote: ownQuote, artistLocations: [] });
    assert.deepEqual(ownGone.map((o) => [o.kind, o.ref, o.location]), [['client', OWN, 'Taller Sur · Rosario - Rosario, Argentina']]);
    // Viaje publicado: ciudad y país (la etiqueta ya los nombra: no se repiten).
    const tripQuote = cotForm.preferredLocationColumns(more.find((o) => o.type === 'trip'));
    const trip = Sesiones.buildLocationOptions({ quote: tripQuote, studios, studioLocations });
    assert.deepEqual(trip.map((o) => [o.kind, o.ref, o.location]), [['client', TRIP, 'Convención · Madrid · España']]);
});

test('P27: la ruta de ubicaciones solo busca en studio_locations cuando el cliente eligió una sede', async () => {
    const SEDE = '33333333-aaaa-4333-8333-333333333333';
    const STUDIO = '11111111-aaaa-4111-8111-111111111111';
    const sede = { id: SEDE, studio_id: STUDIO, label: 'Tigre', formatted_address: 'Av. Cazón 500, Tigre, Argentina' };
    const studio = { id: STUDIO, name: 'Estudio X', is_active: true };
    const primary = { id: '22222222-aaaa-4222-8222-222222222222', studio_id: STUDIO, label: 'Centro', is_primary: true, formatted_address: 'Av. Corrientes 2151, Buenos Aires, Argentina' };
    const chosen = quoteRow({
        preferred_location_type: 'studio_location', preferred_location_ref: SEDE, preferred_location_label: 'Estudio X · Tigre',
        preferred_location_city: 'Tigre', preferred_location_country: 'Argentina', preferred_location_studio_id: STUDIO,
    });
    const withSede = setup({
        getQuoteRaw: async () => chosen,
        getStudioLocation: async (id) => (id === SEDE ? sede : null),
        listStudios: async () => [studio],
        listStudioLocations: async () => [primary, sede],
    });
    const res = await call(withSede.app, 'GET /api/sesiones/locations', { query: { quote: 'QN3501' }, user: { id: ARTIST } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.options[0].location, 'Estudio X · Tigre - Av. Cazón 500, Tigre, Argentina');
    assert.equal(res.body.options[0].group, 'Elegida por el cliente');
    assert.equal(res.body.default_key, `client:${SEDE}`);
    assert.doesNotMatch(JSON.stringify(res.body.options[0]), /Corrientes/);

    // Un viaje o un lugar propio no son sedes: no se consulta studio_locations por su id.
    const asked = [];
    const trip = setup({
        getQuoteRaw: async () => quoteRow({ preferred_location_type: 'trip', preferred_location_ref: SEDE, preferred_location_label: 'Convención · Madrid', preferred_location_city: 'Madrid', preferred_location_country: 'España' }),
        getStudioLocation: async (id) => { asked.push(id); return sede; },
    });
    const tripRes = await call(trip.app, 'GET /api/sesiones/locations', { query: { quote: 'QN3501' }, user: { id: ARTIST } });
    assert.deepEqual(asked, []);
    assert.equal(tripRes.body.options[0].location, 'Convención · Madrid - Madrid, España');
});

test('payload de email: datos de la sesión, sin claves *_url (withLinks las descarta) ni datos privados', () => {
    const payload = Sesiones.emailPayload(quoteRow({ client_whatsapp: '+54 9 11', client_health_conditions: 'x' }), { email: 'artista@nuevo.example', name: 'Mateo R.' }, sessionRow(), { requested_by_role: 'client' });
    assert.equal(payload.artist_email, 'artista@nuevo.example', 'el email vigente del artista gana');
    assert.equal(payload.location, FULL_ADDRESS);
    assert.match(payload.location_maps, /^https:\/\/www\.google\.com\/maps\//);
    assert.equal(payload.edit_window_days, 3);
    assert.equal(payload.requested_by_role, 'client');
    for (const key of Object.keys(payload)) assert.doesNotMatch(key, /(_url|_link)$/, key);
    assert.doesNotMatch(JSON.stringify(payload), /Nota privada|\+54 9 11|client_health|photo/);
});

// ───────────────────────────────────────────────────────────── emails
const NEW_EVENTS = ['session_confirmation_requested', 'session_confirmed_by_client', 'session_change_requested',
    'session_change_resolved', 'session_dispute_opened', 'session_dispute_support', 'session_feedback_received', 'session_no_show'];

function emailData(extra) {
    return Sesiones.emailPayload(quoteRow(), null, sessionRow(), Object.assign({ app_base_url: BASE }, extra || {}));
}

test('emails: eventos nuevos cargados, server-only y con un correo por rol', () => {
    assert.deepEqual(Object.keys(EVENTS).sort(), NEW_EVENTS.slice().sort());
    for (const id of NEW_EVENTS) {
        assert.ok(getEvent(id), `${id} no está en el mapeo`);
        assert.equal(EVENTS[id].serverOnly, true, id);
        assert.ok(SERVER_ONLY_EVENTS.has(id), `${id} lo podría disparar el navegador`);
        assert.ok(EVENTS[id].render && EVENTS[id].name && EVENTS[id].description, id);
    }
    assert.deepEqual(resolveRecipientRoles('session_confirmation_requested', emailData()).map((r) => r.role), ['client', 'artist']);
    // El registro avisa solo a la OTRA parte.
    assert.deepEqual(resolveRecipientRoles('session_feedback_received', emailData({ author_role: 'client' })).map((r) => r.role), ['artist']);
    assert.deepEqual(resolveRecipientRoles('session_feedback_received', emailData({ author_role: 'artist' })).map((r) => r.role), ['client']);
    // Soporte: SUPPORT_EMAIL o los agentes activos.
    assert.deepEqual(EVENTS.session_dispute_support.recipients({ support_email: 'soporte@weotzi.com' }), ['soporte@weotzi.com']);
    assert.deepEqual(EVENTS.session_dispute_support.recipients({ support_emails: ['a@x.com', 'b@x.com'] }), ['a@x.com', 'b@x.com']);
    assert.deepEqual(EVENTS.session_dispute_support.recipients({}), []);
});

test('emails: cada rol recibe su texto, su enlace y la dirección completa', () => {
    const data = emailData();
    const client = renderEmail('session_confirmation_requested', data, { role: 'client', timezone: 'America/Argentina/Buenos_Aires' });
    const artist = renderEmail('session_confirmation_requested', data, { role: 'artist' });
    assert.equal(client.cta.url, `${BASE}/client/dashboard?session=${SESSION}#mis-sesiones`);
    assert.equal(artist.cta.url, `${BASE}/my-quotations/detail?quote=QN3501&session=${SESSION}#qd-sessions`);
    assert.match(client.subject, /^Confirma tu sesión del /);
    assert.match(client.html, /Hola, Lucía\./);
    assert.match(artist.html, /Hola, Mateo\./);
    assert.ok(client.html.includes('Estudio X - Av. Corrientes 2151, Buenos Aires, Argentina'));
    assert.match(client.html, /Abrir en Google Maps/);
    assert.match(client.text, /hasta 3 días antes/);
    assert.match(artist.text, /por confirmar/);

    const changed = renderEmail('session_confirmation_requested', emailData({ proposal_changed: true }), { role: 'client' });
    assert.match(changed.html, /Tu sesión tiene una nueva propuesta/);

    // Pedido de cambio: quien lo pide recibe el acuse; la otra parte, el pedido.
    const ask = emailData({ requested_by_role: 'client', proposed_date: iso(12), change_note: 'No puedo ese día' });
    const toArtist = renderEmail('session_change_requested', ask, { role: 'artist' });
    const toClient = renderEmail('session_change_requested', ask, { role: 'client' });
    assert.equal(toArtist.subject, 'Lucía Fernández pidió cambiar la sesión');
    assert.equal(toArtist.cta.label, 'Responder el pedido');
    assert.match(toArtist.text, /No puedo ese día/);
    assert.match(toArtist.text, /disputa a soporte/);
    assert.equal(toClient.subject, 'Enviamos tu pedido de cambio de sesión');
    assert.equal(toClient.cta.label, 'Ver la sesión');

    const rejected = emailData({ decision: 'rejected', requested_by_role: 'client', response_note: 'Ese día no atiendo' });
    assert.match(renderEmail('session_change_resolved', rejected, { role: 'client' }).text, /no aceptó el cambio[\s\S]*disputa a soporte/);
    assert.match(renderEmail('session_change_resolved', rejected, { role: 'artist' }).text, /Rechazaste el cambio/);
    assert.match(renderEmail('session_change_resolved', emailData({ decision: 'accepted', requested_by_role: 'artist' }), { role: 'client' }).subject, /^Cambio de sesión aceptado/);
    assert.match(renderEmail('session_change_resolved', emailData({ decision: 'withdrawn', requested_by_role: 'artist' }), { role: 'client' }).text, /retiró su pedido de cambio/);

    const dispute = emailData({ opened_by_role: 'client', dispute_reason_label: 'Cambio o cancelación sin acuerdo', ticket_number: 12 });
    assert.equal(renderEmail('session_dispute_opened', dispute, { role: 'client' }).subject, 'Recibimos tu disputa sobre la sesión');
    assert.equal(renderEmail('session_dispute_opened', dispute, { role: 'artist' }).subject, 'Hay una disputa sobre tu sesión');
    const support = renderEmail('session_dispute_support', Object.assign({}, dispute, { dispute_description: '<b>Cambió la fecha</b>', queue_url: `${BASE}/support/dashboard` }), { role: 'admin' });
    assert.match(support.subject, /ticket N\.º 12 · QN3501$/);
    assert.equal(support.cta.url, `${BASE}/support/dashboard`);
    assert.doesNotMatch(support.html, /<b>Cambió/, 'la descripción del usuario sale escapada');

    assert.match(renderEmail('session_no_show', data, { role: 'client' }).text, /registró que no te presentaste[\s\S]*disputa/);
    assert.match(renderEmail('session_feedback_received', emailData({ author_role: 'artist' }), { role: 'client' }).text, /No es la reseña pública/);
});

test('emails: textos nuevos en español neutro (tuteo), sin datos privados y con fecha legible', () => {
    const VOSEO = /\b(querés|podés|tenés|sabés|necesitás|confirmá|confirmala|pedí|pedile|revisá|elegí|contanos|escribile|guardá|mirá|respondé|aceptá|rechazá|dejá|abrí|entrá|ingresá|probá|vos)\b/i;
    const samples = [
        emailData(), emailData({ proposal_changed: true }),
        emailData({ requested_by_role: 'client', proposed_date: iso(12), change_note: 'x' }),
        emailData({ requested_by_role: 'artist', decision: 'rejected' }), emailData({ decision: 'withdrawn', requested_by_role: 'client' }),
        emailData({ opened_by_role: 'artist', dispute_reason_label: 'Otro motivo', ticket_number: 3, author_role: 'client' }),
    ];
    for (const id of NEW_EVENTS) {
        for (const data of samples) {
            for (const role of ['client', 'artist', 'admin']) {
                const out = renderEmail(id, data, { role });
                const spec = EVENTS[id].render;
                const merged = Object.assign({}, spec, (spec.roles && spec.roles[role]) || {});
                const ctx = { role, f: { date: () => '20 de noviembre', dateTime: () => '20 de noviembre, 15:00 h', value: String, text: (v) => String(v || ''), url: (v) => v }, url: (p) => BASE + p };
                const own = ['subject', 'preheader', 'headline', 'intro'].map((key) => (typeof merged[key] === 'function' ? merged[key](data, ctx) : merged[key] || '')).join(' \n ');
                assert.doesNotMatch(own, VOSEO, `${id}/${role}: voseo`);
                assert.doesNotMatch(out.text, /Nota privada|lucia@example\.com|mateo@example\.com/, `${id}/${role}: dato privado`);
                assert.doesNotMatch(out.text.replace(/https?:\/\/\S+/g, ''), /\d{4}-\d{2}-\d{2}T/, `${id}/${role}: fecha ISO`);
                assert.match(out.cta.url, /^https:\/\/beta\.weotzi\.com\//, `${id}/${role}: CTA`);
            }
        }
    }
});

// ───────────────────────────────────────────────────────────── rutas
function fakeApp() {
    const handlers = {};
    const add = (method) => (route, ...fns) => { handlers[`${method} ${route}`] = fns; };
    return { handlers, get: add('GET'), post: add('POST') };
}

async function call(app, key, { params = {}, query = {}, body = {}, user } = {}) {
    const res = {
        statusCode: 200, body: null, headers: {},
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    const req = { params, query, body, headers: {}, user };
    const fns = app.handlers[key];
    assert.ok(fns, `ruta no registrada: ${key}`);
    for (const fn of fns) {
        let advanced = false;
        await fn(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
}

function fakeRepo(overrides) {
    const calls = [];
    const record = (name, value) => (...args) => { calls.push([name, ...args]); return Promise.resolve(typeof value === 'function' ? value(...args) : value); };
    const session = sessionRow();
    const quote = quoteRow();
    const repo = {
        calls,
        getSession: record('getSession', (id) => (id === SESSION ? session : null)),
        getQuoteById: record('getQuoteById', quote),
        getQuoteByQuoteId: record('getQuoteByQuoteId', (id) => (id === quote.quote_id ? quote : null)),
        getQuoteRaw: record('getQuoteRaw', quote),
        getArtist: record('getArtist', { user_id: ARTIST, name: 'Mateo Rivas', email: 'mateo@example.com', estudios: 'Mateo Ink', city: 'Buenos Aires', country: 'Argentina' }),
        listQuotesForClient: record('listQuotesForClient', [quote]),
        listSessionsByQuotation: record('listSessionsByQuotation', [session, sessionRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', session_number: 2, session_date: iso(-3), status: 'completed' })]),
        listSessionsByQuotationIds: record('listSessionsByQuotationIds', [session]),
        listPendingRequests: record('listPendingRequests', []),
        listRecentRequests: record('listRecentRequests', []),
        listFeedback: record('listFeedback', []),
        listDisputes: record('listDisputes', []),
        getRequest: record('getRequest', (id) => (id === REQUEST ? { id: REQUEST, session_id: SESSION, quotation_id: 2787, requested_by_role: 'artist', proposed_date: iso(12), note: 'Convención', status: 'pending' } : null)),
        listRoster: record('listRoster', []),
        listArtistLocations: record('listArtistLocations', []),
        listStudios: record('listStudios', []),
        listStudioLocations: record('listStudioLocations', []),
        getStudioLocation: record('getStudioLocation', null),
        activeSupportEmails: record('activeSupportEmails', ['agente@weotzi.com']),
        confirm: record('confirm', { already: false }),
        requestChange: record('requestChange', { request_id: REQUEST, client_confirmation: 'change_requested' }),
        respondChange: record('respondChange', { client_confirmation: 'confirmed', date_changed: true }),
        withdrawChange: record('withdrawChange', { client_confirmation: 'pending' }),
        saveFeedback: record('saveFeedback', { created: true }),
        openDispute: record('openDispute', { ticket_id: 't-1', ticket_number: 12 }),
    };
    return Object.assign(repo, overrides || {});
}

function setup(overrides, extra) {
    const app = fakeApp();
    const repo = fakeRepo(overrides);
    const mail = fakeSend();
    const synced = [];
    routes.register(app, Object.assign({
        repo, sendEmail: mail.sendEmail, baseUrl: BASE, now: () => NOW,
        limiter: (req, res, next) => next(),
        resolveUser: async (req) => req.user || null,
        gcalService: { requestSync: async (id) => { synced.push(id); } },
        log: { warn() {} },
    }, extra || {}));
    return { app, repo, mail, synced };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('rutas: todas exigen sesión iniciada y ser parte de la cotización', async () => {
    const { app, repo, mail } = setup();
    assert.deepEqual(Object.keys(app.handlers).sort(), [
        'GET /api/sesiones/locations',
        'GET /api/sesiones/mine',
        'GET /api/sesiones/quotations/:quoteId',
        'POST /api/sesiones/:sessionId/change-requests',
        'POST /api/sesiones/:sessionId/confirm',
        'POST /api/sesiones/:sessionId/dispute',
        'POST /api/sesiones/:sessionId/feedback',
        'POST /api/sesiones/change-requests/:requestId/respond',
        'POST /api/sesiones/change-requests/:requestId/withdraw',
    ]);
    for (const key of Object.keys(app.handlers)) {
        const res = await call(app, key, { params: { sessionId: SESSION, requestId: REQUEST, quoteId: 'QN3501' } });
        assert.equal(res.statusCode, 401, key);
        assert.equal(res.headers['Cache-Control'], 'no-store', key);
    }
    const stranger = { id: '33333333-3333-4333-8333-333333333333' };
    for (const key of ['POST /api/sesiones/:sessionId/confirm', 'POST /api/sesiones/:sessionId/feedback', 'POST /api/sesiones/:sessionId/dispute',
        'POST /api/sesiones/change-requests/:requestId/respond', 'GET /api/sesiones/quotations/:quoteId']) {
        const res = await call(app, key, { params: { sessionId: SESSION, requestId: REQUEST, quoteId: 'QN3501' }, user: stranger, body: { rating: 5, decision: 'accept', reason: 'otro', description: 'Texto suficiente.' } });
        assert.equal(res.statusCode, 403, key);
    }
    const badId = await call(app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: '1; drop table' }, user: { id: CLIENT } });
    assert.equal(badId.statusCode, 400);
    const missing = await call(app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: '99999999-9999-4999-8999-999999999999' }, user: { id: CLIENT } });
    assert.equal(missing.statusCode, 404);
    assert.equal(repo.calls.some((c) => ['confirm', 'requestChange', 'respondChange', 'saveFeedback', 'openDispute'].includes(c[0])), false, 'nada se escribe sin autorización');
    assert.equal(mail.sent.length, 0);
});

test('rutas: el cliente confirma → RPC con su id, correo a ambos y Google Calendar al día', async () => {
    const { app, repo, mail, synced } = setup({
        getSession: async () => sessionRow({ client_confirmation: 'confirmed', client_confirmed_at: iso(0) }),
    });
    const res = await call(app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: SESSION }, user: { id: CLIENT } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, already: false, client_confirmation: 'confirmed' });
    assert.deepEqual(repo.calls.find((c) => c[0] === 'confirm'), ['confirm', SESSION, CLIENT]);
    await settle();
    assert.deepEqual(mail.sent.map((s) => s.eventId), ['session_confirmed_by_client']);
    assert.equal(mail.sent[0].options.idempotencyKey, `sesion:${SESSION}:confirmed:${iso(0)}`);
    assert.equal(mail.sent[0].options.actorUserId, CLIENT, 'quien confirma no recibe el push de su comprobante');
    assert.equal(mail.sent[0].payload.app_base_url, BASE);
    assert.equal(mail.sent[0].payload.location, FULL_ADDRESS);
    assert.equal(mail.sent[0].payload.quote_code, quoteRow().quote_id, 'sin código corto se muestra el quote_id');
    assert.deepEqual(synced, [ARTIST]);

    // CF-03: el código corto se lee aparte y es lo que muestran los correos de sesiones.
    const coded = setup({ getShortCode: async (id) => (id === quoteRow().id ? 'AB23CD' : null) });
    await call(coded.app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: SESSION }, user: { id: CLIENT } });
    await settle();
    assert.equal(coded.mail.sent[0].payload.quote_code, 'AB23CD');
    assert.equal(coded.mail.sent[0].payload.quote_id, quoteRow().quote_id, 'los enlaces siguen por quote_id');
    const broken = setup({ getShortCode: async () => { throw new Error('42703'); } });
    const res3 = await call(broken.app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: SESSION }, user: { id: CLIENT } });
    assert.equal(res3.statusCode, 200, 'un fallo al leer el código no rompe la confirmación');
    await settle();
    assert.equal(broken.mail.sent[0].payload.quote_code, quoteRow().quote_id);

    // Reintento: ya estaba confirmada → sin segundo correo.
    const again = setup({ confirm: async () => ({ already: true }) });
    const res2 = await call(again.app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: SESSION }, user: { id: CLIENT } });
    assert.equal(res2.body.already, true);
    await settle();
    assert.equal(again.mail.sent.length, 0);
});

test('rutas: pedir, responder y retirar un cambio', async () => {
    const { app, repo, mail, synced } = setup();
    const ask = await call(app, 'POST /api/sesiones/:sessionId/change-requests', {
        params: { sessionId: SESSION }, user: { id: CLIENT },
        body: { proposed_date: iso(12), note: 'No puedo ese día', location: 'Mi casa', duration_hours: 9 },
    });
    assert.equal(ask.statusCode, 201);
    const rpc = repo.calls.find((c) => c[0] === 'requestChange');
    assert.equal(rpc[1], SESSION);
    assert.equal(rpc[2], CLIENT);
    assert.deepEqual(rpc[3], { proposed_date: iso(12), duration_hours: null, location: null, location_kind: null, location_ref: null, location_place_id: null, note: 'No puedo ese día' });
    await settle();
    assert.equal(mail.sent[0].eventId, 'session_change_requested');
    assert.equal(mail.sent[0].payload.requested_by_role, 'client');
    assert.equal(mail.sent[0].payload.change_note, 'Convención', 'el motivo sale de lo guardado');
    assert.equal(mail.sent[0].options.idempotencyKey, `sesion:${SESSION}:change:${REQUEST}`);
    assert.equal(mail.sent[0].options.actorUserId, CLIENT);

    const invalid = await call(app, 'POST /api/sesiones/:sessionId/change-requests', { params: { sessionId: SESSION }, user: { id: CLIENT }, body: { proposed_date: iso(-2) } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, 'invalid_proposal');

    const accept = await call(app, 'POST /api/sesiones/change-requests/:requestId/respond', { params: { requestId: REQUEST }, user: { id: CLIENT }, body: { decision: 'accept', note: 'Dale' } });
    assert.equal(accept.statusCode, 200);
    assert.deepEqual(repo.calls.find((c) => c[0] === 'respondChange'), ['respondChange', REQUEST, CLIENT, true, 'Dale']);
    await settle();
    const resolved = mail.sent.find((s) => s.eventId === 'session_change_resolved');
    assert.equal(resolved.payload.decision, 'accepted');
    assert.equal(resolved.payload.requested_by_role, 'artist');
    assert.deepEqual(synced, [ARTIST], 'aceptar reprograma: se actualiza Google');

    const withdraw = await call(app, 'POST /api/sesiones/change-requests/:requestId/withdraw', { params: { requestId: REQUEST }, user: { id: ARTIST } });
    assert.equal(withdraw.statusCode, 200);
    assert.deepEqual(repo.calls.find((c) => c[0] === 'withdrawChange'), ['withdrawChange', REQUEST, ARTIST]);
    await settle();
    assert.equal(mail.sent[mail.sent.length - 1].payload.decision, 'withdrawn');

    const bad = await call(app, 'POST /api/sesiones/change-requests/:requestId/respond', { params: { requestId: REQUEST }, user: { id: CLIENT }, body: { decision: 'tal vez' } });
    assert.equal(bad.statusCode, 400);
});

test('rutas: las reglas de la base llegan como mensajes legibles (3 días, pasada, pedido pendiente)', async () => {
    const dbError = (token, status = 400) => Object.assign(new Error(`PostgREST POST rpc/x failed (${status}): {"code":"22023","message":"${token}"}`), { status });
    const cases = [
        ['EDIT_WINDOW_CLOSED', 409, 'edit_window_closed'],
        ['SESSION_PAST', 409, 'session_past'],
        ['REQUEST_PENDING', 409, 'request_pending'],
        ['DIRECT_EDIT', 409, 'direct_edit'],
    ];
    for (const [token, status, code] of cases) {
        const { app, mail } = setup({ requestChange: async () => { throw dbError(token); } });
        const res = await call(app, 'POST /api/sesiones/:sessionId/change-requests', { params: { sessionId: SESSION }, user: { id: ARTIST }, body: { proposed_date: iso(12) } });
        assert.equal(res.statusCode, status, token);
        assert.equal(res.body.code, code);
        assert.doesNotMatch(res.body.error, /PostgREST|rpc\/|22023/, 'sin detalles de la base');
        await settle();
        assert.equal(mail.sent.length, 0);
    }
    const overlap = setup({ respondChange: async () => { throw dbError('CALENDAR_OVERLAP', 409); } });
    const res = await call(overlap.app, 'POST /api/sesiones/change-requests/:requestId/respond', { params: { requestId: REQUEST }, user: { id: CLIENT }, body: { decision: 'accept' } });
    assert.equal(res.body.code, 'overlap');
    const unknown = setup({ confirm: async () => { throw new Error('ECONNRESET secreto'); } });
    const boom = await call(unknown.app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: SESSION }, user: { id: CLIENT } });
    assert.equal(boom.statusCode, 500);
    assert.equal(boom.body.error, 'No pudimos confirmar la sesión.');
    // Base sin la migración: 503 con código para que el front siga en modo anterior.
    const old = setup({ getSession: async () => { throw new Error('failed (400): {"code":"42703","message":"column quotation_sessions.client_confirmation does not exist"}'); } });
    const unavailable = await call(old.app, 'POST /api/sesiones/:sessionId/confirm', { params: { sessionId: SESSION }, user: { id: CLIENT } });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.body.code, 'sessions_unavailable');
});

test('rutas: registro con calificación y disputa a soporte', async () => {
    const { app, repo, mail } = setup({ getSession: async () => sessionRow({ session_date: iso(-2), status: 'completed', session_number: 2 }) });
    const rate = await call(app, 'POST /api/sesiones/:sessionId/feedback', { params: { sessionId: SESSION }, user: { id: ARTIST }, body: { rating: 4, note: ' Buen cliente ' } });
    assert.equal(rate.statusCode, 200);
    assert.deepEqual(repo.calls.find((c) => c[0] === 'saveFeedback'), ['saveFeedback', SESSION, ARTIST, 4, 'Buen cliente']);
    await settle();
    assert.equal(mail.sent[0].eventId, 'session_feedback_received');
    assert.equal(mail.sent[0].payload.author_role, 'artist');
    assert.equal(mail.sent[0].options.idempotencyKey, `sesion:${SESSION}:feedback:artist`);
    assert.equal((await call(app, 'POST /api/sesiones/:sessionId/feedback', { params: { sessionId: SESSION }, user: { id: ARTIST }, body: { rating: 9 } })).statusCode, 400);

    const saved = process.env.SUPPORT_EMAIL;
    delete process.env.SUPPORT_EMAIL;
    try {
        const dispute = await call(app, 'POST /api/sesiones/:sessionId/dispute', { params: { sessionId: SESSION }, user: { id: CLIENT }, body: { reason: 'trato', description: 'Me trató mal durante la sesión.' } });
        assert.equal(dispute.statusCode, 201);
        assert.deepEqual(dispute.body, { success: true, ticket_number: 12 });
        const rpc = repo.calls.find((c) => c[0] === 'openDispute');
        assert.equal(rpc[2], CLIENT);
        assert.equal(rpc[3].reason, 'trato');
        assert.equal(rpc[3].subject, 'Sesión 2: Trato durante la sesión');
        assert.equal(rpc[3].desired_outcome, 'mediacion');
        assert.match(rpc[3].description, /Abierta por: el cliente\.\n\nMe trató mal durante la sesión\.$/);
        await settle();
        await settle();
        const parties = mail.sent.find((s) => s.eventId === 'session_dispute_opened');
        const support = mail.sent.find((s) => s.eventId === 'session_dispute_support');
        assert.equal(parties.payload.opened_by_role, 'client');
        assert.equal(parties.payload.ticket_number, 12);
        assert.deepEqual(support.payload.support_emails, ['agente@weotzi.com'], 'sin SUPPORT_EMAIL avisa a los agentes activos');
        assert.equal(support.payload.queue_url, `${BASE}/support/dashboard`);
        assert.equal(support.options.idempotencyKey, `sesion:${SESSION}:dispute:t-1:support`);
    } finally {
        if (saved === undefined) delete process.env.SUPPORT_EMAIL; else process.env.SUPPORT_EMAIL = saved;
    }
    const noReason = await call(app, 'POST /api/sesiones/:sessionId/dispute', { params: { sessionId: SESSION }, user: { id: CLIENT }, body: { reason: '', description: 'Texto suficiente.' } });
    assert.equal(noReason.statusCode, 400);
});

test('rutas: lecturas para el expediente del artista y el panel del cliente', async () => {
    const { app } = setup();
    const quote = await call(app, 'GET /api/sesiones/quotations/:quoteId', { params: { quoteId: 'QN3501' }, user: { id: ARTIST } });
    assert.equal(quote.statusCode, 200);
    assert.equal(quote.body.role, 'artist');
    assert.equal(quote.body.edit_window_days, 3);
    assert.equal(quote.body.quote.has_client_account, true);
    assert.deepEqual(quote.body.sessions.map((s) => [s.session_number, s.phase, s.can.edit_direct, s.can.rate]), [[1, 'upcoming', true, false], [2, 'done', false, true]]);
    assert.doesNotMatch(JSON.stringify(quote.body), /Nota privada|gcal-1|example\.com/);
    assert.equal((await call(app, 'GET /api/sesiones/quotations/:quoteId', { params: { quoteId: 'no existe!' }, user: { id: ARTIST } })).statusCode, 400);

    const mine = await call(app, 'GET /api/sesiones/mine', { user: { id: CLIENT } });
    assert.equal(mine.statusCode, 200);
    assert.equal(mine.body.role, 'client');
    assert.equal(mine.body.sessions.length, 1);
    assert.equal(mine.body.sessions[0].quote.counterpart_name, 'Mateo Rivas');
    assert.equal(mine.body.sessions[0].can.confirm, true);
    assert.equal(mine.body.sessions[0].badge.label, 'Por confirmar');

    const locations = await call(app, 'GET /api/sesiones/locations', { query: { quote: 'QN3501' }, user: { id: ARTIST } });
    assert.equal(locations.statusCode, 200);
    assert.deepEqual(locations.body.options.map((o) => o.location), ['Mateo Ink - Buenos Aires, Argentina']);
    assert.equal(locations.body.default_key, locations.body.options[0].key);
    // La cotización de otro artista no entrega nada.
    const other = setup({ getQuoteByQuoteId: async () => quoteRow({ artist_id: '44444444-4444-4444-8444-444444444444' }) });
    assert.equal((await call(other.app, 'GET /api/sesiones/locations', { query: { quote: 'QN3501' }, user: { id: ARTIST } })).statusCode, 403);
    const notArtist = setup({ getArtist: async () => null });
    assert.equal((await call(notArtist.app, 'GET /api/sesiones/locations', { user: { id: CLIENT } })).statusCode, 403);
});

test('server.js registra las rutas con una línea, antes de las redirecciones legacy y del estático', () => {
    const server = read('server.js');
    const line = "require('./lib/routes/sesiones').register(app, { gcalService });";
    assert.equal(server.split(line).length - 1, 1);
    assert.ok(server.indexOf(line) < server.indexOf('// Rutas del artista retiradas por el Figma final'));
    assert.ok(server.indexOf(line) < server.indexOf("app.use(express.static(path.join(__dirname, 'public')));"));
    const repo = read('lib/repos/sesiones.js');
    assert.match(repo, /require\('\.\.\/postgrest'\)/);
    assert.doesNotMatch(repo + read('lib/routes/sesiones.js') + read('lib/sesiones.js'), /\/rest\/v1\/|createClient\(|supabase\.from\(/, 'acceso a datos solo por lib/postgrest');
});

// ───────────────────────────────────────────────────────────── Google Calendar
test('Google Calendar: por confirmar va como tentativa en el título y lleva la dirección completa', () => {
    const quote = { quote_id: 'QN3501', client_full_name: 'Lucía Fernández', quote_status: 'client_approved' };
    const base = { id: SESSION, quotation_id: 2787, session_date: iso(10), duration_hours: 3, status: 'scheduled', location: FULL_ADDRESS };
    const pending = gcal.normalizeSession({ ...base, client_confirmation: 'pending' }, quote, BASE);
    assert.equal(pending.title, 'Sesión (por confirmar) — Lucía Fernández');
    assert.match(pending.description, /^Pendiente de confirmación del cliente\./);
    assert.equal(pending.location, FULL_ADDRESS);
    assert.equal(gcal.normalizeSession({ ...base, client_confirmation: 'change_requested' }, quote, BASE).title, 'Sesión (por confirmar) — Lucía Fernández');
    const confirmed = gcal.normalizeSession({ ...base, client_confirmation: 'confirmed' }, quote, BASE);
    assert.equal(confirmed.title, 'Sesión — Lucía Fernández');
    assert.doesNotMatch(confirmed.description, /Pendiente de confirmación/);
    // Base sin la columna: igual que antes (no cambia el hash de lo ya publicado).
    assert.deepEqual(gcal.normalizeSession(base, quote, BASE), gcal.normalizeSession({ ...base, client_confirmation: 'confirmed' }, quote, BASE));
    const event = gcal.buildGoogleEvent(pending, { tz: 'America/Argentina/Buenos_Aires', baseUrl: BASE });
    assert.equal(event.location, FULL_ADDRESS);
    assert.equal(event.summary, 'Sesión (por confirmar) — Lucía Fernández');

    const repo = read('lib/repos/google-calendar.js');
    assert.match(repo, /const SESSION_SELECT = SESSION_SELECT_LEGACY\.replace\('status,notes,location,', 'status,notes,location,client_confirmation,'\);/);
    assert.equal((repo.match(/withLegacy\(\(\) => (?:list|get)\(SESSION_SELECT\), \(\) => (?:list|get)\(SESSION_SELECT_LEGACY\)\)/g) || []).length, 2, 'sin la migración sigue sincronizando');
});

// ───────────────────────────────────────────────────────────── migración
test('migración: en rango, idempotente, con reversa y sin tocar lo de turnos / Google Calendar', () => {
    const name = path.basename(MIGRATION);
    const ts = Number(name.slice(0, 14));
    assert.ok(ts >= 20261116150000 && ts <= 20261116150999, `${name} fuera de rango`);
    const sql = read(MIGRATION);
    const down = read(ROLLBACK);
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /^commit;$/m);
    assert.match(down, /^begin;$/m);
    assert.match(down, /^commit;$/m);

    // Las sesiones existentes quedan confirmadas sin UPDATE por fila; las nuevas nacen pendientes.
    assert.match(sql, /add column client_confirmation text not null default 'confirmed';\s*\n\s*alter table public\.quotation_sessions alter column client_confirmation set default 'pending';/);
    assert.doesNotMatch(sql, /update public\.quotation_sessions\s+set client_confirmation = 'confirmed'\s*;/);
    assert.match(sql, /check \(client_confirmation in \('pending', 'confirmed', 'change_requested'\)\)/);
    assert.match(sql, /check \(location_kind is null or location_kind in \('studio', 'own', 'client', 'custom'\)\)/);
    assert.match(sql, /char_length\(btrim\(location\)\) <= 300/, 'la dirección completa entra');

    // Regla de los 3 días en la base, igual que el modelo.
    assert.match(sql, /if v_s\.session_date - pg_catalog\.now\(\) < interval '3 days' then\s*\n\s*raise exception 'EDIT_WINDOW_CLOSED'/);
    assert.equal(Model.EDIT_WINDOW_DAYS, 3);
    for (const token of ['SESSION_PAST', 'SESSION_NEEDS_AGREEMENT', 'SESSION_DELETE_BLOCKED', 'REQUEST_PENDING', 'DIRECT_EDIT', 'SESSION_NOT_PAST', 'DISPUTE_ACTIVE', 'NOT_DISPUTABLE', 'FORBIDDEN']) {
        assert.ok(sql.includes(`'${token}'`), `falta ${token}`);
    }

    // Tablas nuevas cerradas al navegador; RPC solo service-role, security definer con search_path fijo.
    for (const table of ['quotation_session_change_requests', 'quotation_session_feedback', 'quotation_session_disputes']) {
        assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`));
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
        assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`));
        assert.match(down, new RegExp(`drop table if exists public\\.${table};`));
        assert.doesNotMatch(sql, new RegExp(`create policy [^;]* on public\\.${table}`));
    }
    const functions = [...sql.matchAll(/create or replace function public\.(sesiones_[a-z_]+)\(/g)].map((m) => m[1]);
    assert.deepEqual(functions.sort(), ['sesiones_close_requests', 'sesiones_confirm', 'sesiones_guard', 'sesiones_hold_confirms_session',
        'sesiones_open_dispute', 'sesiones_request_change', 'sesiones_respond_change', 'sesiones_save_feedback', 'sesiones_withdraw_change']);
    assert.equal((sql.match(/security definer\s*\nset search_path = ''/g) || []).length, functions.length);
    for (const fn of functions) {
        assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`), `${fn} sin revoke`);
        assert.match(down, new RegExp(`drop function if exists public\\.${fn}\\(`), `${fn} sin reversa`);
        assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to [^;]*(anon|authenticated)`), `${fn} expuesta`);
    }
    for (const rpc of ['sesiones_confirm', 'sesiones_request_change', 'sesiones_respond_change', 'sesiones_withdraw_change', 'sesiones_save_feedback', 'sesiones_open_dispute']) {
        assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}\\([^)]*\\) to service_role;`));
    }
    // El actor siempre se valida contra la cotización.
    assert.ok((sql.match(/raise exception 'FORBIDDEN' using errcode = '42501';/g) || []).length >= 7);

    // Disputa = ticket kind 'disputa' del centro de soporte, con las reglas de open_support_dispute.
    assert.match(sql, /insert into public\.support_tickets \([\s\S]*?\) values \(\s*\n\s*'disputa', 'disputa',/);
    assert.match(sql, /public\.support_disputable_quote_status\(v_quote_status\)/);
    assert.match(sql, /t\.kind = 'disputa'\s*\n\s*and t\.status in \('open', 'in_progress', 'waiting_user'\)/);

    // Turnos online nacen confirmados sin redefinir confirm_artist_slot_hold; triggers previos intactos.
    assert.match(sql, /create trigger trg_sesiones_hold_confirms_session\s*\n\s*after insert or update of status, session_id on public\.artist_booking_holds/);
    assert.doesNotMatch(sql, /create (or replace )?function (public\.confirm_artist_slot_hold|public\.prevent_quotation_session_overlap|private\.gcal_mark_dirty)/);
    assert.doesNotMatch(sql, /drop trigger if exists (trg_gcal_dirty|trg_prevent_quotation_session_overlap|trg_release_hold_on_session_cancel|trg_set_quotation_session_number|quotation_sessions_updated_at) on/);
    assert.match(sql, /create trigger trg_gcal_dirty_confirmacion\s*\n\s*after update of client_confirmation on public\.quotation_sessions/);
    assert.doesNotMatch(sql, /alter table public\.support_tickets/, 'no toca el esquema de soporte');

    // El navegador nunca decide la confirmación del cliente.
    assert.match(sql, /new\.client_confirmation := old\.client_confirmation;\s*\n\s*new\.client_confirmed_at := old\.client_confirmed_at;/);
    for (const trigger of ['trg_sesiones_guard', 'trg_sesiones_close_requests', 'trg_sesiones_hold_confirms_session', 'trg_gcal_dirty_confirmacion']) {
        assert.match(down, new RegExp(`drop trigger if exists ${trigger} on`));
    }
    assert.match(down, /char_length\(btrim\(location\)\) <= 120/);
});

test('sin imágenes pendientes: el frente no necesita assets generados', () => {
    const assets = JSON.parse(read('docs/plans/ronda2-assets/sesiones.json'));
    assert.deepEqual(assets, []);
});
