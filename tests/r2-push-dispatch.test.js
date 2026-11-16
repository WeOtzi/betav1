'use strict';

// Ronda 2 · frente push · lib/push-dispatch.js
// Cada correo a un usuario registrado dispara su aviso push / in-app; los
// mensajes de chat avisan al instante; preferencias "Push"; sin PII sensible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dispatch = require('../lib/push-dispatch');
const prefs = require('../lib/notification-prefs');
const mapping = require('../services/email-event-mapping');
const emailRender = require('../lib/email-render');
const { fixtureFor } = require('../lib/email-render/fixtures');

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const ARTIST_ID = '22222222-2222-4222-8222-222222222222';
const STUDIO_ID = '33333333-3333-4333-8333-333333333333';
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

function fakeRepo(seed = {}) {
    const state = { notifications: [], subs: seed.subs || {}, users: seed.users || {}, deleted: [], success: [], failure: [], lookups: [] };
    return {
        state,
        async listSubscriptions(userId) { return state.subs[userId] || []; },
        async insertNotification(row) {
            if (row.dedupe_key && state.notifications.some(n => n.user_id === row.user_id && n.dedupe_key === row.dedupe_key)) return null;
            const saved = { id: `0000000${state.notifications.length + 1}-0000-4000-8000-000000000000`, ...row };
            state.notifications.push(saved);
            return saved;
        },
        async markSuccess(id) { state.success.push(id); },
        async markFailure(id, count) { state.failure.push([id, count]); },
        async deleteById(id) { state.deleted.push(id); },
        async pruneNotifications() {},
        async findUserIdByEmail(role, email) { state.lookups.push([role, email]); return (state.users[role] || {})[email] || null; }
    };
}

function harness(seed = {}, overrides = {}) {
    const repo = fakeRepo(seed);
    const sent = [];
    const deps = {
        repo,
        log: () => {},
        isConfigured: () => true,
        shouldNotify: async () => true,
        sendNotification: async (sub, payload, options) => { sent.push({ sub, payload, options }); return { ok: true, status: 201, gone: false }; },
        ...overrides
    };
    return { repo, sent, deps };
}

const SUB = { id: 's1', endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'x', auth: 'y', failure_count: 0 };

// ---------------------------------------------------------------- clasificación
test('qué eventos avisan: actividad sí; comprobantes propios, códigos y bajas no', () => {
    for (const [eventId, role] of [
        ['artist_responded_quotation', 'client'], ['artist_new_quotation', 'artist'], ['client_approved_quotation', 'artist'],
        ['chat_message_to_artist', 'artist'], ['chat_message_to_client', 'client'], ['inbox_message_received', 'studio'],
        ['session_scheduled', 'client'], ['session_reminder_24h', 'artist'], ['booking_slot_requested', 'artist'],
        ['studio_membership_request_created', 'studio'], ['studio_roster_invite', 'artist'],
        ['profile_verified', 'artist'], ['profile_verification_denied', 'artist'], ['dispute_artist_response', 'client']
    ]) assert.equal(dispatch.isPushEvent(eventId, role), true, `${eventId} → ${role}`);

    // Sesiones (P28): sus correos son transaccionales, pero para la otra parte son actividad.
    assert.equal(dispatch.SESSION_ACTIVITY_EVENTS.size, 8);
    for (const eventId of ['session_confirmation_requested', 'session_confirmed_by_client', 'session_change_requested',
        'session_change_resolved', 'session_dispute_opened', 'session_dispute_resolved', 'session_feedback_received', 'session_no_show']) {
        assert.equal(emailRender.getSpec(eventId).category, 'transactional', `${eventId}: el correo sale siempre`);
        for (const role of ['client', 'artist']) assert.equal(dispatch.isPushEvent(eventId, role), true, `${eventId} → ${role}`);
        assert.equal(prefs.EMAIL_EVENT_KINDS[eventId], undefined, `${eventId}: el correo no entra en la matriz`);
    }

    for (const [eventId, role] of [
        ['password_reset_temp', 'client'], ['instagram_verification_code', 'artist'],
        ['artist_registration_completed', 'artist'], ['client_registration_completed', 'client'],
        ['account_deletion_received', 'client'], ['platform_update', 'artist'],
        ['client_quotation_submitted', 'client'], ['client_quotation_accepted_receipt', 'client'],
        ['client_quotation_rejected_receipt', 'client'], ['job_board_request_created', 'client'],
        ['artist_verification_requested', 'admin'], ['dispute_artist_response', 'support'],
        ['session_dispute_support', 'admin'], ['session_dispute_support', 'support'], ['session_dispute_support', 'artist'],
        ['artist_responded_quotation', 'admin'], ['evento_inexistente', 'client']
    ]) assert.equal(dispatch.isPushEvent(eventId, role), false, `${eventId} → ${role}`);
});

test('cada evento con render es de actividad, transaccional o está decidido a mano', () => {
    // Si alguien agrega un evento con una categoría nueva, este test obliga a decidir si avisa.
    const known = new Set(['transactional', 'quotations', 'messages', 'calendar', 'account', 'studios']);
    for (const eventId of Object.keys(mapping.EVENTS)) {
        const spec = emailRender.getSpec(eventId);
        if (!spec) continue;
        assert.ok(known.has(spec.category), `${eventId}: categoría ${spec.category} sin decisión de push`);
    }
});

test('la fila de la matriz que gobierna el aviso sale del evento y del rol', () => {
    assert.equal(dispatch.pushKind('chat_message_to_artist', 'artist'), 'mensajes');
    assert.equal(dispatch.pushKind('chat_message_to_client', 'client'), 'mensajes');
    assert.equal(dispatch.pushKind('artist_responded_quotation', 'client'), 'cotizaciones');
    assert.equal(dispatch.pushKind('artist_new_quotation', 'artist'), 'cotizaciones');
    assert.equal(dispatch.pushKind('job_board_application_received', 'client'), 'postulaciones');
    assert.equal(dispatch.pushKind('job_board_application_accepted', 'artist'), 'job_board');
    assert.equal(dispatch.pushKind('studio_spot_decision', 'artist'), 'spots');
    assert.equal(dispatch.pushKind('studio_roster_invite', 'artist'), 'invitaciones');
    assert.equal(dispatch.pushKind('session_scheduled', 'artist'), 'calendario');
    assert.equal(dispatch.pushKind('booking_slot_requested', 'artist'), 'calendario');
    // Sesiones: al artista lo gobierna "Calendario → Push"; al cliente se le avisa siempre.
    for (const eventId of dispatch.SESSION_ACTIVITY_EVENTS) {
        assert.equal(dispatch.pushKind(eventId, 'artist'), 'calendario', eventId);
        assert.equal(dispatch.pushKind(eventId, 'client'), null, eventId);
    }
    // Sin fila en la matriz: se avisa siempre.
    assert.equal(dispatch.pushKind('session_scheduled', 'client'), null);
    assert.equal(dispatch.pushKind('profile_verified', 'artist'), null);
    assert.equal(dispatch.pushKind('studio_membership_request_created', 'studio'), null);
});

test('preferencias: el canal push tiene sus propios defaults y no depende del email', () => {
    assert.equal(prefs.resolvePreference(null, 'mensajes', 'push'), true);
    assert.equal(prefs.resolvePreference(null, 'spots', 'push'), false);
    assert.equal(prefs.resolvePreference({ mensajes: { email: false } }, 'mensajes', 'push'), true, 'apagar el email no apaga el push');
    assert.equal(prefs.resolvePreference({ mensajes: { email: true, push: false } }, 'mensajes', 'push'), false);
    for (const kind of ['postulaciones', 'mensajes', 'cotizaciones']) {
        assert.equal(prefs.CLIENT_NOTIF_DEFAULTS[kind].push, true, `cliente · ${kind}`);
        assert.equal(prefs.resolvePreference({ [kind]: { email: true, push: false } }, kind, 'push', { defaults: prefs.CLIENT_NOTIF_DEFAULTS }), false);
    }
});

// ---------------------------------------------------------------- helpers puros
test('toAppPath: del link absoluto del correo a una ruta interna (con o sin /beta)', () => {
    const base = 'https://beta.weotzi.com';
    assert.equal(dispatch.toAppPath(`${base}/client/dashboard?quote=WO-1`, [base]), '/client/dashboard?quote=WO-1');
    assert.equal(dispatch.toAppPath(`${base}/artist/account#verificacion`, [base]), '/artist/account#verificacion');
    assert.equal(dispatch.toAppPath('https://weotzi.com/beta/calendar?x=1', ['https://weotzi.com/beta']), '/calendar?x=1');
    assert.equal(dispatch.toAppPath('https://weotzi.com/otra/cosa', ['https://weotzi.com/beta']), '');
    assert.equal(dispatch.toAppPath('https://evil.example/client/dashboard', [base]), '');
    assert.equal(dispatch.toAppPath('javascript:alert(1)', [base]), '');
    assert.equal(dispatch.toAppPath('', [base]), '');
    assert.equal(dispatch.toAppPath(`${base}/x`, ['no es una url', base]), '/x');
    assert.equal(dispatch.isInternalPath('/client/dashboard'), true);
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'client/dashboard', '', null, `/${'a'.repeat(700)}`]) {
        assert.equal(dispatch.isInternalPath(bad), false, String(bad).slice(0, 30));
    }
});

test('withFocus: suma ?ver=<zona> solo en el detalle de la cotización', () => {
    assert.equal(dispatch.withFocus('/client/dashboard?quote=WO-1', 'artist_responded_quotation'), '/client/dashboard?quote=WO-1&ver=propuesta');
    assert.equal(dispatch.withFocus('/my-quotations/detail?quote=WO-1', 'client_approved_quotation'), '/my-quotations/detail?quote=WO-1&ver=acuerdo');
    assert.equal(dispatch.withFocus('/client/dashboard?quote=WO-1#x', 'session_scheduled'), '/client/dashboard?quote=WO-1&ver=sesiones#x');
    assert.equal(dispatch.withFocus('/calendar', 'session_scheduled'), '/calendar');
    assert.equal(dispatch.withFocus('/client/dashboard?quote=WO-1&ver=chat', 'artist_responded_quotation'), '/client/dashboard?quote=WO-1&ver=chat');
    assert.equal(dispatch.withFocus('/client/dashboard?quote=WO-1', 'artist_new_quotation'), '/client/dashboard?quote=WO-1');
});

test('etiqueta y clave de dedupe: una por conversación / por mensaje / por evento y rol', () => {
    assert.equal(dispatch.tagFor('chat_message_to_client', { quote_id: 'WO-1' }), 'chat:WO-1');
    assert.equal(dispatch.tagFor('inbox_message_received', { thread_id: 'abc-1' }), 'inbox:abc-1');
    assert.equal(dispatch.tagFor('session_scheduled', { quote_id: 'WO-1', session_id: 'sess-1' }), 'session:sess-1');
    assert.equal(dispatch.tagFor('artist_responded_quotation', { quote_id: 'WO-1' }), 'quote:WO-1:artist_responded_quotation');
    assert.equal(dispatch.tagFor('profile_verified', {}), 'profile_verified');
    assert.equal(dispatch.tagFor('chat_message_to_client', { quote_id: 'WO 1<script>' }), 'chat:WO1script');

    assert.equal(dispatch.dedupeKeyFor('chat_message_to_client', { message_id: 'm-1' }, { idempotencyKey: 'chat:WO-1:client:123', role: 'client' }), 'msg:m-1');
    const a = dispatch.dedupeKeyFor('session_scheduled', {}, { idempotencyKey: 'k1', role: 'client' });
    const b = dispatch.dedupeKeyFor('session_scheduled', {}, { idempotencyKey: 'k1', role: 'artist' });
    assert.match(a, /^ev:[0-9a-f]{40}:client$/);
    assert.notEqual(a, b, 'la misma persona con los dos roles recibe los dos avisos');
    assert.equal(dispatch.dedupeKeyFor('session_scheduled', {}, { role: 'client' }), null, 'sin clave de idempotencia no se deduplica');
    assert.notEqual(a, dispatch.dedupeKeyFor('session_rescheduled', {}, { idempotencyKey: 'k1', role: 'client' }));
});

// ---------------------------------------------------------------- aviso a partir del correo
test('el aviso toma asunto, preheader y CTA del render spec del correo', () => {
    const payload = fixtureFor('artist_responded_quotation');
    const rendered = emailRender.renderEmail('artist_responded_quotation', payload, { role: 'client' });
    const n = dispatch.buildNotification('artist_responded_quotation', payload, { role: 'client' });
    assert.equal(n.title, rendered.subject);
    assert.equal(n.body, rendered.preheader);
    assert.equal(n.url, '/client/dashboard?quote=WO-2026-0142&ver=propuesta');
    assert.equal(n.tag, 'quote:WO-2026-0142:artist_responded_quotation');

    const artist = dispatch.buildNotification('session_scheduled', fixtureFor('session_scheduled'), { role: 'artist' });
    const client = dispatch.buildNotification('session_scheduled', fixtureFor('session_scheduled'), { role: 'client' });
    assert.equal(artist.url, '/calendar?date=2026-11-21&event=session%3Asess-1', 'el artista va a la sesión en su calendario');
    assert.equal(client.url, '/client/dashboard?quote=WO-2026-0142&ver=sesiones');

    // Un CTA externo o un render roto nunca terminan en el aviso.
    const external = dispatch.buildNotification('x', {}, { role: 'client' }, { renderEmail: () => ({ subject: 'Hola', preheader: 'p', cta: { url: 'https://evil.example/x' } }) });
    assert.equal(external.url, '/client/dashboard');
    assert.equal(dispatch.buildNotification('x', {}, { role: 'client' }, { renderEmail: () => { throw new Error('boom'); } }), null);
    assert.equal(dispatch.buildNotification('x', {}, { role: 'client' }, { renderEmail: () => ({ subject: '' }) }), null);
});

test('P26: un CTA general del correo se afina al destino exacto con los datos del evento', () => {
    const url = (eventId, role, extra = {}) => dispatch.buildNotification(eventId, { ...fixtureFor(eventId), ...extra }, { role }).url;
    // El correo de rechazo lleva al panel; el aviso, a esa cotización.
    assert.equal(url('artist_rejected_quotation', 'client'), '/client/dashboard?quote=WO-2026-0142&ver=propuesta');
    assert.equal(url('client_left_rating', 'artist'), '/my-quotations/detail?quote=WO-2026-0142');
    assert.equal(url('job_board_application_received', 'client', { request_id: 'r-1', application_id: 'a-1' }), '/client/requests?id=r-1&view=postulacion&app=a-1');
    assert.equal(url('job_board_application_received', 'client'), '/client/requests', 'sin ids queda la lista');
    // Sesión cancelada: el día en el calendario, sin abrir un evento que ya no está.
    assert.equal(url('session_cancelled', 'artist'), '/calendar?date=2026-11-21');
    assert.equal(url('session_completed', 'artist'), '/calendar?date=2026-11-21&event=session%3Asess-1');
    assert.equal(url('session_scheduled', 'artist', { session_date: 'mañana' }), '/calendar', 'sin fecha válida, el calendario');
    assert.equal(url('booking_slot_confirmed', 'client'), '/client/dashboard?quote=WO-2026-0142&ver=sesiones');
    assert.equal(url('artist_new_quotation', 'artist'), '/my-quotations/detail?quote=WO-2026-0142');
    assert.equal(url('profile_verification_denied', 'artist'), '/artist/account#verificacion');

    assert.equal(dispatch.refinePath('session_scheduled', { session_id: 's', session_date: '2026-11-21T14:00:00Z' }, 'artist', '/calendar?view=week'), '/calendar?view=week', 'un destino ya específico no se toca');
    assert.equal(dispatch.refinePath('x', { quote_id: 'a b&c' }, 'client', '/client/dashboard'), '/client/dashboard?quote=a%20b%26c');
    for (const eventId of Object.keys(mapping.EVENTS)) {
        for (const role of ['artist', 'client', 'studio']) {
            const n = dispatch.buildNotification(eventId, fixtureFor(eventId), { role });
            if (n) assert.ok(dispatch.isInternalPath(n.url), `${eventId}/${role}: ${n.url}`);
        }
    }
});

test('un asunto vacío de contenido no llega como título del aviso', () => {
    const n = dispatch.buildNotification('studio_verification_decision', fixtureFor('studio_verification_decision'), { role: 'studio' });
    assert.equal(n.title, 'Tienes una novedad en We Ötzi');
    assert.match(n.body, /Estudio Norte/);
    const real = dispatch.buildNotification('studio_verification_decision', { ...fixtureFor('studio_verification_decision'), subject: 'Tu estudio está verificado' }, { role: 'studio' });
    assert.equal(real.title, 'Tu estudio está verificado');
});

test('el aviso de un mensaje no lleva el texto del mensaje (se ve en la pantalla bloqueada)', () => {
    for (const [eventId, role] of [['chat_message_to_artist', 'artist'], ['chat_message_to_client', 'client'], ['inbox_message_received', 'artist']]) {
        const payload = { ...fixtureFor(eventId), message_preview: 'SECRETO-DEL-MENSAJE tengo diabetes' };
        const n = dispatch.buildNotification(eventId, payload, { role });
        assert.ok(n.title && n.body, eventId);
        assert.doesNotMatch(`${n.title} ${n.body} ${n.url}`, /SECRETO-DEL-MENSAJE|diabetes/, eventId);
    }
    assert.equal(dispatch.buildNotification('chat_message_to_client', fixtureFor('chat_message_to_client'), { role: 'client' }).url, '/client/chats?quote=WO-2026-0142');
    assert.equal(dispatch.buildNotification('inbox_message_received', fixtureFor('inbox_message_received'), { role: 'artist' }).url, '/artist/inbox?thread=abc');
});

// ---------------------------------------------------------------- notifyForEvent
test('correo a un usuario registrado → aviso guardado + push a sus navegadores', async () => {
    const { repo, sent, deps } = harness({ subs: { [CLIENT_ID]: [SUB] } });
    const results = await dispatch.notifyForEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), { idempotencyKey: 'WO-2026-0142:responded' }, deps);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(repo.state.notifications.length, 1);
    const row = repo.state.notifications[0];
    assert.equal(row.user_id, CLIENT_ID);
    assert.equal(row.role, 'client');
    assert.equal(row.kind, 'cotizaciones');
    assert.equal(row.event_id, 'artist_responded_quotation');
    assert.equal(row.url, '/client/dashboard?quote=WO-2026-0142&ver=propuesta');
    assert.match(row.dedupe_key, /^ev:[0-9a-f]{40}:client$/);
    assert.equal(repo.state.lookups.length, 0, 'el user_id del payload alcanza: no se busca por email');

    assert.equal(sent.length, 1);
    assert.deepEqual(Object.keys(sent[0].payload).sort(), ['body', 'id', 'kind', 'tag', 'title', 'ts', 'url']);
    assert.equal(sent[0].payload.id, row.id);
    assert.equal(sent[0].payload.title, row.title);
    assert.equal(sent[0].payload.url, row.url);
    assert.equal(sent[0].options.topic, row.tag);
    assert.equal(sent[0].options.urgency, 'normal');
    assert.deepEqual(repo.state.success, ['s1']);
});

test('el mismo evento reintentado (job, correo diferido) no repite el aviso ni el push', async () => {
    const { repo, sent, deps } = harness({ subs: { [CLIENT_ID]: [SUB] } });
    const payload = fixtureFor('session_reminder_24h');
    await dispatch.notifyForEvent('session_reminder_24h', payload, { idempotencyKey: 'reminder:sess-1' }, deps);
    const again = await dispatch.notifyForEvent('session_reminder_24h', payload, { idempotencyKey: 'reminder:sess-1' }, deps);
    assert.equal(repo.state.notifications.length, 2, 'cliente y artista, una vez cada uno');
    assert.deepEqual(repo.state.notifications.map(n => n.role).sort(), ['artist', 'client']);
    assert.equal(sent.length, 1, 'solo el cliente tiene un navegador suscripto');
    assert.ok(again.every(r => r.duplicate === true));
});

test('la preferencia "Push" apagada corta el aviso; sin fila en la matriz se avisa siempre', async () => {
    const asked = [];
    const { repo, sent, deps } = harness({ subs: { [CLIENT_ID]: [SUB] } }, {
        shouldNotify: async (user, kind, channel, _deps, role) => { asked.push([user.id, kind, channel, role]); return false; }
    });
    const results = await dispatch.notifyForEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), { idempotencyKey: 'k' }, deps);
    assert.deepEqual(asked, [[CLIENT_ID, 'cotizaciones', 'push', 'client']]);
    assert.deepEqual(results, [{ ok: true, skipped: true, role: 'client' }]);
    assert.equal(repo.state.notifications.length, 0);
    assert.equal(sent.length, 0);

    // profile_verified no tiene fila: no consulta la preferencia.
    const second = harness({ users: { artist: { 'mateo.artista@example.com': ARTIST_ID } } }, { shouldNotify: async () => { throw new Error('no debería consultarse'); } });
    await dispatch.notifyForEvent('profile_verified', fixtureFor('profile_verified'), { idempotencyKey: 'v1' }, second.deps);
    assert.equal(second.repo.state.notifications.length, 1);
    assert.equal(second.repo.state.notifications[0].kind, null);
    assert.equal(second.repo.state.notifications[0].url, '/artist/account#verificacion');
});

test('un destinatario sin cuenta (invitado) no recibe nada; con cuenta se lo busca por email y rol', async () => {
    const payload = fixtureFor('job_board_application_received');
    const guest = harness();
    await dispatch.notifyForEvent('job_board_application_received', payload, { idempotencyKey: 'jb' }, guest.deps);
    assert.deepEqual(guest.repo.state.lookups, [['client', 'lucia.cliente@example.com']]);
    assert.equal(guest.repo.state.notifications.length, 0);

    const registered = harness({ users: { client: { 'lucia.cliente@example.com': CLIENT_ID } } });
    await dispatch.notifyForEvent('job_board_application_received', payload, { idempotencyKey: 'jb' }, registered.deps);
    assert.equal(registered.repo.state.notifications.length, 1);
    assert.equal(registered.repo.state.notifications[0].kind, 'postulaciones');

    // Un user_id con formato inválido no se usa.
    const broken = harness({ users: { client: { 'lucia.cliente@example.com': 'no-es-un-uuid' } } });
    await dispatch.notifyForEvent('job_board_application_received', payload, { idempotencyKey: 'jb' }, broken.deps);
    assert.equal(broken.repo.state.notifications.length, 0);
});

test('quien hizo la acción no recibe el aviso de su propia acción', async () => {
    const { repo, deps } = harness();
    await dispatch.notifyForEvent('session_scheduled', fixtureFor('session_scheduled'), { idempotencyKey: 's', actorUserId: ARTIST_ID }, deps);
    assert.deepEqual(repo.state.notifications.map(n => n.user_id), [CLIENT_ID], 'el artista agendó: solo se avisa al cliente');
});

// EP-01: con cuenta de cliente, agendar o reprogramar manda session_confirmation_requested
// (transaccional). Sin el aviso, el cliente solo se enteraba por correo.
function sessionPayload(extra = {}) {
    return {
        quote_id: 'WO-2026-0142', app_base_url: 'https://beta.weotzi.com',
        client_email: 'lucia.cliente@example.com', client_user_id: CLIENT_ID, client_name: 'Lucía Fernández',
        artist_email: 'mateo.artista@example.com', artist_user_id: ARTIST_ID, artist_name: 'Mateo Rivas',
        session_id: '44444444-4444-4444-8444-444444444444', session_number: 1,
        session_date: '2026-12-01T15:00:00Z', duration_hours: 3, location: 'Estudio Norte, Av. Corrientes 2151',
        ...extra
    };
}

test('sesiones: agendar con cuenta de cliente avisa al cliente (in-app + push) y no al artista que agendó', async () => {
    const { repo, sent, deps } = harness({ subs: { [CLIENT_ID]: [SUB], [ARTIST_ID]: [{ ...SUB, id: 's2' }] } });
    const results = await dispatch.notifyForEvent('session_confirmation_requested', sessionPayload(),
        { idempotencyKey: 'WO-2026-0142:session:4444:confirm', actorUserId: ARTIST_ID }, deps);
    assert.equal(results.length, 1);
    assert.equal(repo.state.notifications.length, 1, 'un solo aviso');
    const row = repo.state.notifications[0];
    assert.equal(row.user_id, CLIENT_ID);
    assert.equal(row.role, 'client');
    assert.equal(row.kind, null, 'el cliente no tiene fila "calendario": se avisa siempre');
    assert.equal(row.event_id, 'session_confirmation_requested');
    assert.match(row.title, /^Confirma tu sesión/);
    assert.ok(row.url.startsWith('/client/dashboard?session=44444444-4444-4444-8444-444444444444'), row.url);
    assert.ok(row.url.endsWith('#mis-sesiones'), row.url);
    assert.equal(row.tag, 'session:44444444-4444-4444-8444-444444444444');
    assert.deepEqual(sent.map((s) => s.sub.id), ['s1'], 'push solo al navegador del cliente');
});

test('sesiones: el cliente confirma o pide un cambio → aviso al artista con "Calendario → Push"; el comprobante propio no avisa', async () => {
    const asked = [];
    const { repo, deps } = harness({}, {
        shouldNotify: async (user, kind, channel, _deps, role) => { asked.push([user.id, kind, channel, role]); return true; }
    });
    await dispatch.notifyForEvent('session_confirmed_by_client', sessionPayload(), { idempotencyKey: 'c1', actorUserId: CLIENT_ID }, deps);
    assert.deepEqual(repo.state.notifications.map((n) => [n.user_id, n.kind]), [[ARTIST_ID, 'calendario']]);
    assert.deepEqual(asked, [[ARTIST_ID, 'calendario', 'push', 'artist']]);
    assert.match(repo.state.notifications[0].title, /confirmó la sesión/);
    assert.match(repo.state.notifications[0].url, /^\/my-quotations\/detail\?quote=WO-2026-0142&session=44444444-4444-4444-8444-444444444444#qd-sessions$/);

    // El artista apagó "Calendario → Push": no se le avisa (el correo sale igual).
    const off = harness({}, { shouldNotify: async () => false });
    const skipped = await dispatch.notifyForEvent('session_change_requested', sessionPayload({ requested_by_role: 'client' }),
        { idempotencyKey: 'c2', actorUserId: CLIENT_ID }, off.deps);
    assert.deepEqual(skipped, [{ ok: true, skipped: true, role: 'artist' }]);
    assert.equal(off.repo.state.notifications.length, 0);

    // Cada evento de sesiones arma un aviso con destino interno para ambos roles.
    for (const eventId of dispatch.SESSION_ACTIVITY_EVENTS) {
        for (const role of ['client', 'artist']) {
            const n = dispatch.buildNotification(eventId, sessionPayload({ requested_by_role: 'client', opened_by_role: 'client', author_role: 'client', decision: 'accepted' }), { role });
            assert.ok(n && n.title.length > 3, `${eventId} → ${role}`);
            assert.ok(dispatch.isInternalPath(n.url), `${eventId} → ${role}: ${n && n.url}`);
            assert.match(n.url, /[?&]session=44444444-4444-4444-8444-444444444444/, `${eventId} → ${role}`);
        }
    }
});

test('mensajes de chat: aviso inmediato por mensaje y sin duplicar cuando sale el correo diferido', async () => {
    const { repo, sent, deps } = harness({ subs: { [CLIENT_ID]: [SUB] } });
    const payload = { ...fixtureFor('chat_message_to_client'), message_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    // 1) al instante, desde POST /api/email/chat_message_to_client (el correo queda en cola)
    await dispatch.notifyForEvent('chat_message_to_client', payload, {}, deps);
    // 2) dos minutos después, sendEmail() del correo diferido (con su clave por ventana de 15 min)
    await dispatch.notifyForEvent('chat_message_to_client', payload, { idempotencyKey: 'chat:WO-2026-0142:client:1958000' }, deps);
    assert.equal(repo.state.notifications.length, 1);
    assert.equal(repo.state.notifications[0].dedupe_key, 'msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(repo.state.notifications[0].kind, 'mensajes');
    assert.equal(repo.state.notifications[0].tag, 'chat:WO-2026-0142');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].options.urgency, 'high', 'un mensaje es urgente');

    // Otro mensaje en la misma ventana de 15 min: el correo se agrupa, el aviso no.
    await dispatch.notifyForEvent('chat_message_to_client', { ...payload, message_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, {}, deps);
    assert.equal(repo.state.notifications.length, 2);
    assert.equal(sent.length, 2);
});

test('ningún aviso lleva secretos, y todos apuntan a una ruta interna de la app', async () => {
    // Todo email resuelve a una cuenta registrada del rol pedido.
    const handler = { get: (target, email) => (typeof email === 'string' && email.includes('@') ? target.__id : undefined) };
    const users = {
        artist: new Proxy({ __id: ARTIST_ID }, handler),
        client: new Proxy({ __id: CLIENT_ID }, handler),
        studio: new Proxy({ __id: STUDIO_ID }, handler)
    };
    const { repo, deps } = harness({ users });
    for (const eventId of Object.keys(mapping.EVENTS)) {
        await dispatch.notifyForEvent(eventId, fixtureFor(eventId), { idempotencyKey: `all:${eventId}` }, deps);
    }
    const rows = repo.state.notifications;
    assert.ok(rows.length >= 30, `se esperaban avisos de la mayoría de los eventos (${rows.length})`);
    const events = new Set(rows.map(r => r.event_id));
    for (const never of ['password_reset_temp', 'instagram_verification_code', 'client_quotation_submitted', 'artist_registration_completed',
        'account_deletion_received', 'artist_verification_requested', 'platform_update']) {
        assert.equal(events.has(never), false, `${never} no debe avisar`);
    }
    for (const row of rows) {
        const text = `${row.title} ${row.body} ${row.url}`;
        assert.ok(dispatch.isInternalPath(row.url), `${row.event_id}: ${row.url}`);
        assert.ok(row.title.length > 0 && row.title.length <= 160, row.event_id);
        assert.ok((row.body || '').length <= 400, row.event_id);
        assert.ok(['artist', 'client', 'studio'].includes(row.role), row.event_id);
        // Códigos, contraseñas, textos de mensajes y emails no viajan en el aviso.
        assert.doesNotMatch(text, /Tq7-ab9X|WO-4F7K2Q|@example\.com|ajustamos el tamaño|pasar la sesión al sábado|llegar el 3 de diciembre/, row.event_id);
        assert.doesNotMatch(text, /https?:\/\//, `${row.event_id}: sin links absolutos`);
    }
});

// ---------------------------------------------------------------- notifyUser / sendToUser
test('notifyUser valida usuario, título y destino; sin VAPID guarda el aviso y no envía', async () => {
    const { repo, sent, deps } = harness({ subs: { [CLIENT_ID]: [SUB] } }, { isConfigured: () => false });
    assert.equal((await dispatch.notifyUser({ userId: 'x', title: 'Hola' }, deps)).reason, 'invalid_user');
    assert.equal((await dispatch.notifyUser({ userId: CLIENT_ID, title: '   ' }, deps)).reason, 'empty_title');
    const result = await dispatch.notifyUser({ userId: CLIENT_ID, role: 'client', title: 'Hola', body: 'x', url: 'https://evil.example/x', tag: 't' }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.stored, true);
    assert.deepEqual(result.push, { attempted: 0, sent: 0, removed: 0 });
    assert.equal(repo.state.notifications[0].url, '/client/dashboard', 'un destino externo cae al panel del rol');
    assert.equal(sent.length, 0, 'sin claves VAPID el push queda apagado en silencio');
});

test('sendToUser borra las suscripciones vencidas y cuenta los fallos de las demás', async () => {
    const subs = [
        { id: 'ok', endpoint: 'https://fcm.googleapis.com/a', failure_count: 0 },
        { id: 'gone', endpoint: 'https://fcm.googleapis.com/b', failure_count: 0 },
        { id: 'flaky', endpoint: 'https://fcm.googleapis.com/c', failure_count: 2 },
        { id: 'dead', endpoint: 'https://fcm.googleapis.com/d', failure_count: 7 }
    ];
    // El servicio de push rechaza la suscripción (403): eso sí cuenta para el borrado.
    const outcomes = { ok: { ok: true, status: 201, gone: false }, gone: { ok: false, status: 410, gone: true }, flaky: { ok: false, status: 403, gone: false }, dead: { ok: false, status: 403, gone: false } };
    const { repo, deps } = harness({ subs: { [CLIENT_ID]: subs } }, { sendNotification: async (sub) => outcomes[sub.id] });
    const summary = await dispatch.sendToUser(CLIENT_ID, { title: 'x' }, {}, deps);
    assert.deepEqual(summary, { attempted: 4, sent: 1, removed: 2 });
    assert.deepEqual(repo.state.success, ['ok']);
    assert.deepEqual(repo.state.deleted.sort(), ['dead', 'gone']);
    assert.deepEqual(repo.state.failure, [['flaky', 2]]);
});

// EP-04: una caída de la red del servidor, un 429 o un 5xx del servicio de push
// no dicen nada de la suscripción. Antes, ocho seguidos la borraban.
test('sendToUser no cuenta ni borra por fallos transitorios (red caída, timeout, 429, 5xx)', async () => {
    const transient = {
        red: { ok: false, status: 0, gone: false, error: 'network_error' },
        timeout: { ok: false, status: 0, gone: false, error: 'timeout' },
        limite: { ok: false, status: 429, gone: false },
        caido: { ok: false, status: 503, gone: false },
        interno: { ok: false, status: 500, gone: false }
    };
    // Todas al borde: con la regla anterior, este envío las borraba.
    const subs = Object.keys(transient).map((id) => ({ id, endpoint: `https://fcm.googleapis.com/${id}`, failure_count: dispatch.MAX_FAILURES - 1 }));
    const logged = [];
    const { repo, deps } = harness({ subs: { [CLIENT_ID]: subs } }, { sendNotification: async (sub) => transient[sub.id], log: (...args) => logged.push(args.join(' ')) });
    for (let attempt = 0; attempt < 20; attempt += 1) {
        assert.deepEqual(await dispatch.sendToUser(CLIENT_ID, { title: 'x' }, {}, deps), { attempted: 5, sent: 0, removed: 0 });
    }
    assert.deepEqual(repo.state.deleted, [], 'ninguna suscripción se borra');
    assert.deepEqual(repo.state.failure, [], 'ni suma fallos');
    assert.deepEqual(repo.state.success, []);
    assert.ok(logged.some((line) => /sin respuesta del servicio.*network_error/.test(line)), 'queda registrado para diagnosticar');

    for (const result of Object.values(transient)) assert.equal(dispatch.isTransientFailure(result), true, JSON.stringify(result));
    // Lo que sí habla de la suscripción o de la configuración sigue contando (o borra en el acto).
    for (const result of [{ ok: false, status: 400 }, { ok: false, status: 401 }, { ok: false, status: 403 }, { ok: false, status: 413 },
        { ok: false, status: 404, gone: true }, { ok: false, status: 410, gone: true }, { ok: false, status: 0, gone: true, error: 'endpoint_not_allowed' },
        { ok: true, status: 201 }, null]) {
        assert.equal(dispatch.isTransientFailure(result), false, JSON.stringify(result));
    }

    // Un rechazo real al borde sí la borra.
    const rejected = harness({ subs: { [CLIENT_ID]: [{ id: 'vapid', endpoint: 'https://fcm.googleapis.com/v', failure_count: dispatch.MAX_FAILURES - 1 }] } }, { sendNotification: async () => ({ ok: false, status: 401, gone: false }) });
    assert.deepEqual(await dispatch.sendToUser(CLIENT_ID, { title: 'x' }, {}, rejected.deps), { attempted: 1, sent: 0, removed: 1 });
    assert.deepEqual(rejected.repo.state.deleted, ['vapid']);
});

test('si la tabla de avisos falla, un aviso con clave de dedupe no se envía a ciegas', async () => {
    const { sent, deps } = harness({ subs: { [CLIENT_ID]: [SUB] } });
    deps.repo.insertNotification = async () => { throw new Error('relation "user_notifications" does not exist'); };
    const withKey = await dispatch.notifyUser({ userId: CLIENT_ID, title: 'Hola', dedupeKey: 'k' }, deps);
    assert.deepEqual(withKey, { ok: false, reason: 'store_failed' });
    assert.equal(sent.length, 0);
    const withoutKey = await dispatch.notifyUser({ userId: CLIENT_ID, title: 'Prueba' }, deps);
    assert.equal(withoutKey.ok, true);
    assert.equal(withoutKey.stored, false);
    assert.equal(sent.length, 1, 'el aviso de prueba igual sale por push');
    assert.equal(sent[0].payload.id, null);
});

// ---------------------------------------------------------------- enganches
test('el enganche está apagado hasta que el servidor lo habilita (los tests de correo no tocan la red)', async () => {
    dispatch.disable();
    assert.equal(dispatch.isEnabled(), false);
    assert.equal(dispatch.onEmailEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), {}), null);
    assert.equal(dispatch.onMessageEvent('chat_message_to_client', { ok: true, payload: fixtureFor('chat_message_to_client') }), null);

    const { repo, deps } = harness();
    dispatch.enable(deps);
    try {
        assert.equal(dispatch.onEmailEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), { claimed: true }), null, 'la llamada interna de dispatchOnce no repite');
        assert.equal(dispatch.onEmailEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), { push: false }), null);
        assert.equal(dispatch.onEmailEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), { forceChannel: 'smtp_relay' }), null, 'las pruebas de correo del backoffice no avisan a nadie');
        await dispatch.onEmailEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), { idempotencyKey: 'k1' });
        assert.equal(repo.state.notifications.length, 1);

        // onMessageEvent: solo chat e inbox, con contexto válido y mensaje sin leer.
        assert.equal(dispatch.onMessageEvent('artist_responded_quotation', { ok: true, payload: {} }), null);
        assert.equal(dispatch.onMessageEvent('chat_message_to_client', { ok: true, skip: true, reason: 'already_read' }), null);
        assert.equal(dispatch.onMessageEvent('chat_message_to_client', { ok: false, status: 403 }), null);
        await dispatch.onMessageEvent('chat_message_to_client', { ok: true, payload: { ...fixtureFor('chat_message_to_client'), message_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, defer: { delayMs: 120000 } });
        assert.equal(repo.state.notifications.length, 2);
        assert.equal(repo.state.notifications[1].dedupe_key, 'msg:cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    } finally {
        dispatch.disable();
    }
});

test('un fallo del aviso nunca rompe el envío del correo', async () => {
    const { deps } = harness();
    deps.repo.findUserIdByEmail = async () => { throw new Error('db caída'); };
    deps.repo.insertNotification = async () => { throw new Error('db caída'); };
    dispatch.enable(deps);
    try {
        const results = await dispatch.onEmailEvent('job_board_application_received', fixtureFor('job_board_application_received'), { idempotencyKey: 'k' });
        assert.deepEqual(results, []);
        assert.deepEqual(await dispatch.onEmailEvent('artist_responded_quotation', fixtureFor('artist_responded_quotation'), { idempotencyKey: 'k' }), [{ ok: false, reason: 'store_failed', role: 'client' }]);
    } finally {
        dispatch.disable();
    }
});

test('services/email-service.js dispara el aviso en cada sendEmail(), también con el correo apagado', async () => {
    const service = require('../services/email-service');
    const { repo, deps } = harness();
    dispatch.enable(deps);
    try {
        const result = await service.sendEmail('artist_responded_quotation', fixtureFor('artist_responded_quotation'),
            { routing: { channel: 'off' }, channel: 'off', idempotencyKey: 'WO-2026-0142:responded:x' });
        assert.equal(result.skipped, true, 'el correo está apagado en esta prueba');
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(repo.state.notifications.length, 1, 'el aviso push / in-app sale igual');
        assert.equal(repo.state.notifications[0].user_id, CLIENT_ID);
        // Evento desconocido o sin destinatario: ni correo ni aviso.
        await service.sendEmail('evento_inexistente', {}, { channel: 'off', routing: {} });
        await service.sendEmail('artist_responded_quotation', {}, { channel: 'off', routing: {} });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(repo.state.notifications.length, 1);
    } finally {
        dispatch.disable();
    }
});

test('contrato de los enganches en el código del servidor', () => {
    const svc = read('services', 'email-service.js');
    assert.match(svc, /const pushDispatch = require\('\.\.\/lib\/push-dispatch'\)/);
    const hook = svc.indexOf('pushDispatch.onEmailEvent(eventId, payload, options)');
    assert.ok(hook > svc.indexOf('async function sendEmail('), 'el enganche vive en sendEmail');
    assert.ok(hook < svc.indexOf("if (channel === 'off')"), 'antes de decidir el canal: el push no depende del correo');
    assert.equal(svc.split('pushDispatch.onEmailEvent(').length - 1, 1, 'un solo enganche');

    const routes = read('lib', 'routes', 'emails.js');
    const messageHook = routes.indexOf("require('../push-dispatch').onMessageEvent(eventId, context)");
    assert.ok(messageHook > routes.indexOf('if (context.skip)'), 'un mensaje ya leído no avisa');
    assert.ok(messageHook < routes.indexOf('scheduleDeferred(eventId, context, options, deps)'), 'el aviso sale antes de encolar el correo');
    assert.match(routes, /options\.actorUserId = req\.weotziEmailUser\.id/);

    const server = read('server.js');
    const register = server.indexOf("require('./lib/routes/push').register(app)");
    assert.ok(register > 0);
    assert.ok(register < server.indexOf('legacyRedirectFor(req.path'), 'antes de las redirecciones legacy');
    assert.ok(register < server.indexOf("app.use(express.static(path.join(__dirname, 'public')))"), 'antes del estático');
    assert.equal(server.split("require('./lib/routes/push')").length - 1, 1, 'una sola línea en server.js');
});
