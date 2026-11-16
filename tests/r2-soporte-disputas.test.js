'use strict';
// Ronda 2 · P28 (REQ-15): la disputa de sesión abría un ticket que soporte no
// podía ver ni cerrar, y la cotización quedaba "En disputa" sin salida.
// Cubre: lógica pura (lib/soporte-disputas.js), repo (solo kind 'disputa'),
// rutas (autorización, cola, detalle, cambio de estado y aviso a las partes),
// el correo session_dispute_resolved y la pestaña del panel de soporte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-test-key';

const D = require('../lib/soporte-disputas');
const routes = require('../lib/routes/soporte-disputas');
const { renderEmail } = require('../lib/email-render');
const EVENTS = require('../services/email-events/sesiones');
const { resolveRecipientRoles, getEvent } = require('../services/email-event-mapping');
const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
const Front = require('../public/shared/js/support-dashboard-disputes.js')._internal;

const ARTIST = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const AGENT = '66666666-6666-4666-8666-666666666666';
const TICKET = '99999999-9999-4999-8999-999999999999';
const SESSION = '44444444-4444-4444-8444-444444444444';
const BASE = 'https://beta.weotzi.com';
const ATTACK = '"><img src=x onerror=alert(1)><script>alert(2)</script>';

function ticketRow(extra) {
    return Object.assign({
        id: TICKET, ticket_number: 12, kind: 'disputa', category: 'disputa', status: 'open', priority: 'high',
        subject: 'Disputa por la sesión 2', description: 'El artista cambió la fecha sin avisarme y no puedo ir.',
        requester_user_id: CLIENT, requester_role: 'client', counterpart_user_id: ARTIST, counterpart_role: 'artist',
        quotation_id: 9, quote_id: 'QN3501', dispute_reason: 'cancelacion', desired_outcome: 'mediacion',
        page_context: `session:${SESSION}`, assigned_support_user_id: null, resolution: null, resolution_outcome: null,
        last_activity_at: '2026-11-16T12:00:00Z', resolved_at: null, closed_at: null, created_at: '2026-11-16T12:00:00Z',
    }, extra || {});
}

function disputeRow(extra) {
    return Object.assign({
        ticket: ticketRow(),
        link: { id: 'l1', session_id: SESSION, quotation_id: 9, ticket_id: TICKET, opened_by: CLIENT, opened_by_role: 'client', reason: 'cancelacion' },
        session: { id: SESSION, quotation_id: 9, session_number: 2, session_date: '2026-12-01T15:00:00Z', duration_hours: 3, status: 'scheduled', client_confirmation: 'confirmed', location: 'Estudio X - Av. Corrientes 2151' },
        quote: { id: 9, quote_id: 'QN3501', quote_status: 'client_approved', dispute_status: 'open', client_user_id: CLIENT, client_email: 'lucia@example.com', client_full_name: 'Lucía Fernández', artist_id: ARTIST, artist_email: 'viejo@example.com', artist_name: 'Mateo Rivas', artist_username: 'mateo.ink' },
    }, extra || {});
}

function mockRes() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(key, value) { this.headers[key] = value; return this; },
    };
}

function fakeRepo(overrides = {}) {
    const calls = { list: [], updates: [], notes: [], gets: [] };
    const state = { row: disputeRow(overrides.row) };
    const repo = Object.assign({
        calls, state,
        async getActiveSupportUser(id) { return id === AGENT ? { user_id: AGENT, email: 'agente@weotzi.com', full_name: 'Ana Soporte', is_active: true } : null; },
        async supportNamesByIds() { return new Map([[AGENT, 'Ana Soporte']]); },
        async listDisputeTickets(filters) { calls.list.push(filters); return [state.row]; },
        async countActiveDisputes() { return 1; },
        async getDisputeTicket(id) { calls.gets.push(id); return id === TICKET ? state.row : null; },
        async listTicketMessages() {
            return [
                { id: 'm1', author_user_id: null, author_role: 'system', body: 'Disputa abierta sobre una sesión.', is_internal: false, created_at: '2026-11-16T12:00:00Z' },
                { id: 'm2', author_user_id: AGENT, author_role: 'support', body: 'Llamé al cliente.', is_internal: true, created_at: '2026-11-16T13:00:00Z' },
            ];
        },
        async updateDisputeTicket(id, patch) {
            calls.updates.push([id, patch]);
            const now = '2026-11-16T15:00:00Z';
            return Object.assign({}, state.row.ticket, patch, {
                resolved_at: patch.status === 'resolved' ? now : state.row.ticket.resolved_at,
                closed_at: patch.status === 'closed' ? now : state.row.ticket.closed_at,
                last_activity_at: now,
            });
        },
        async addTicketMessage(row) { calls.notes.push(row); return { id: 'n1', author_role: row.authorRole, body: row.body, is_internal: row.isInternal, created_at: '2026-11-16T15:00:00Z' }; },
        async getArtist() { return { user_id: ARTIST, name: 'Mateo R.', email: 'mateo@nuevo.example' }; },
        async getShortCode() { return 'K7M2QP'; },
    }, overrides);
    delete repo.row;
    return repo;
}

async function run(handler, { userId, email, body, query, params, repo = fakeRepo(), superadmin = false, sendEmail } = {}) {
    const emails = [];
    const restore = routes._internal.setDeps({
        repo,
        resolveBearerUser: async () => (userId ? { id: userId, email: email || 'persona@example.com' } : null),
        isSuperadminEmail: () => superadmin,
        sendEmail: sendEmail || (async (eventId, payload, options) => { emails.push({ eventId, payload, options }); return { ok: true }; }),
        applicationBase: () => BASE,
    });
    const res = mockRes();
    const log = console.log; const warn = console.warn; const error = console.error;
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    try {
        await handler({ headers: {}, body: body || {}, query: query || {}, params: params || {} }, res);
    } finally {
        console.log = log; console.warn = warn; console.error = error;
        restore();
    }
    return { res, emails, repo };
}

// ---------------------------------------------------------------- lógica pura

test('cola: filtros de estado y vista resumida sin datos sensibles', () => {
    assert.deepEqual(D.parseListQuery({}).value, { status: 'active', statuses: ['open', 'in_progress', 'waiting_user'] });
    assert.deepEqual(D.parseListQuery({ status: 'all' }).value, { status: 'all', statuses: null });
    assert.deepEqual(D.parseListQuery({ status: 'resolved' }).value.statuses, ['resolved']);
    assert.equal(D.parseListQuery({ status: 'borrado' }).ok, false);

    const item = D.summarizeDispute(disputeRow());
    assert.equal(item.ticket_id, TICKET);
    assert.equal(item.code, 'WO-00012');
    assert.equal(item.reason_label, 'Cambio o cancelación sin acuerdo');
    assert.equal(item.scope, 'session');
    assert.deepEqual([item.opened_by.role, item.opened_by.name, item.counterpart.role, item.counterpart.name], ['client', 'Lucía Fernández', 'artist', 'Mateo Rivas']);
    assert.equal(item.session.session_number, 2);
    assert.equal(item.dispute_status, 'open');
    // Disputa de la cotización (centro de soporte), sin sesión, abierta por el artista.
    const plain = D.summarizeDispute(disputeRow({ ticket: ticketRow({ requester_role: 'artist', dispute_reason: 'diseno' }), link: null, session: null }));
    assert.deepEqual([plain.scope, plain.session, plain.opened_by.role, plain.counterpart.role, plain.reason_label], ['quotation', null, 'artist', 'client', 'Diseño']);
    // Sin la cotización (borrada) no rompe.
    assert.equal(D.summarizeDispute({ ticket: ticketRow(), link: null, session: null, quote: null }).quote_id, 'QN3501');
    assert.doesNotMatch(JSON.stringify(item), /health|allerg|birth|whatsapp/i);
});

test('cambio de estado: resolver pide resultado y resolución; cerrar sin resolver pide el motivo', () => {
    const open = ticketRow();
    assert.equal(D.parseStatusInput({ status: 'open' }, open).ok, false, "'open' no se elige a mano");
    assert.equal(D.parseStatusInput({ status: 'borrado' }, open).field, 'status');
    assert.deepEqual(D.parseStatusInput({ status: 'in_progress', resolution: 'no se guarda' }, open).value, { status: 'in_progress', resolution: '', outcome: '' });
    assert.equal(D.parseStatusInput({ status: 'resolved', resolution: 'Se reprograma la sesión.' }, open).field, 'outcome');
    assert.equal(D.parseStatusInput({ status: 'resolved', outcome: 'acuerdo', resolution: 'corta' }, open).field, 'resolution');
    assert.equal(D.parseStatusInput({ status: 'resolved', outcome: 'inventado', resolution: 'Se reprograma la sesión.' }, open).field, 'outcome');
    assert.deepEqual(D.parseStatusInput({ status: 'resolved', outcome: 'acuerdo', resolution: '  Se reprograma la sesión.\r\n\r\n\r\n\r\nSin costo. ' }, open).value,
        { status: 'resolved', outcome: 'acuerdo', resolution: 'Se reprograma la sesión.\n\nSin costo.' });
    assert.equal(D.parseStatusInput({ status: 'resolved', outcome: 'acuerdo', resolution: 'x'.repeat(4001) }, open).field, 'resolution');
    // Cerrar sin haber resuelto: hace falta el motivo; el resultado por defecto es "sin acción".
    assert.equal(D.parseStatusInput({ status: 'closed' }, open).field, 'resolution');
    assert.deepEqual(D.parseStatusInput({ status: 'closed', resolution: 'Las partes ya lo arreglaron.' }, open).value,
        { status: 'closed', outcome: 'sin_accion', resolution: 'Las partes ya lo arreglaron.' });
    // Cerrar una ya resuelta: nada más que pedir.
    assert.deepEqual(D.parseStatusInput({ status: 'closed' }, ticketRow({ status: 'resolved', resolution: 'Se reprogramó.' })).value, { status: 'closed', outcome: '', resolution: '' });

    // El aviso a las partes sale una sola vez: cuando la disputa deja de estar activa.
    assert.equal(D.closingNotice('open', 'resolved'), 'resolved');
    assert.equal(D.closingNotice('waiting_user', 'closed'), 'closed');
    assert.equal(D.closingNotice('resolved', 'closed'), null);
    assert.equal(D.closingNotice('open', 'in_progress'), null);
    assert.equal(D.closingNotice('closed', 'in_progress'), null);

    assert.equal(D.parseNoteInput({ note: '  ' }).ok, false);
    assert.deepEqual(D.parseNoteInput({ note: ' Llamé al artista. ' }).value, { note: 'Llamé al artista.' });
});

// ---------------------------------------------------------------- repo

test('repo: solo tickets kind "disputa", por la capa PostgREST y sin depender de relaciones embebidas', () => {
    const src = read('lib/repos/soporte-disputas.js');
    assert.match(src, /require\('\.\.\/postgrest'\)/);
    assert.doesNotMatch(src, /fetch\(|\/rest\/v1\//, 'sin CRUD ad-hoc');
    // Toda lectura o escritura de support_tickets filtra por kind = 'disputa'.
    const ticketQueries = src.match(/pgrest\('support_tickets'\)[^;]*;/g) || [];
    assert.equal(ticketQueries.length, 4);
    for (const q of ticketQueries) assert.match(q, /\.eq\('kind', 'disputa'\)/, q);
    assert.match(src, /pgrest\('support_tickets'\)\.eq\('id', ticketId\)\.eq\('kind', 'disputa'\)\.patch\(patch\)/);
    assert.doesNotMatch(src, /\.delete\(/);
    // Sin la migración de sesiones la cola sigue: el vínculo con la sesión es opcional.
    assert.match(src, /pgrest\('quotation_session_disputes'\)\.select\(LINK_SELECT\)\.in\('ticket_id', ids\)/);
    assert.match(src, /if \(isMissingSchemaError\(err\)\) return \[\];/);
    assert.doesNotMatch(src, /support_tickets\(|quotation_session_disputes\(/, 'sin embeber relaciones');
    assert.doesNotMatch(/const QUOTE_SELECT = ([^;]+);/.exec(src)[1], /health|allerg|birth|whatsapp|instagram/);
    // Las rutas se registran en el servidor.
    assert.match(read('server.js'), /require\('\.\/lib\/routes\/soporte-disputas'\)\.register\(app\);/);
});

// ---------------------------------------------------------------- rutas

test('rutas: solo soporte (agente activo o superadmin) ve y gestiona disputas', async () => {
    const H = routes._internal;
    for (const handler of [H.listHandler, H.detailHandler, H.statusHandler, H.noteHandler]) {
        const anon = await run(handler, { params: { ticketId: TICKET }, body: { status: 'in_progress', note: 'x' } });
        assert.equal(anon.res.statusCode, 401);
        const outsider = await run(handler, { userId: ARTIST, params: { ticketId: TICKET }, body: { status: 'in_progress', note: 'x' } });
        assert.equal(outsider.res.statusCode, 403, 'una de las partes no entra a la cola de soporte');
        assert.deepEqual([outsider.repo.calls.updates.length, outsider.repo.calls.notes.length, outsider.repo.calls.list.length], [0, 0, 0]);
    }
    const agent = await run(H.listHandler, { userId: AGENT });
    assert.equal(agent.res.statusCode, 200);
    assert.equal(agent.res.headers['Cache-Control'], 'no-store');
    assert.equal(agent.res.body.reviewer.role, 'support');
    const admin = await run(H.listHandler, { userId: ARTIST, superadmin: true });
    assert.equal(admin.res.body.reviewer.role, 'superadmin');
    // Si no se puede comprobar el acceso, no se abre.
    const broken = await run(H.listHandler, { userId: AGENT, repo: fakeRepo({ async getActiveSupportUser() { throw new Error('db caída'); } }) });
    assert.equal(broken.res.statusCode, 500);
});

test('rutas: cola y detalle con el reclamo, la sesión, las partes y la actividad', async () => {
    const H = routes._internal;
    const list = await run(H.listHandler, { userId: AGENT });
    assert.deepEqual(list.repo.calls.list, [{ statuses: ['open', 'in_progress', 'waiting_user'] }]);
    assert.equal(list.res.body.active_count, 1);
    assert.equal(list.res.body.disputes.length, 1);
    assert.equal(list.res.body.disputes[0].code, 'WO-00012');
    assert.equal(list.res.body.disputes[0].description, undefined, 'la descripción viaja solo en el detalle');
    assert.equal((await run(H.listHandler, { userId: AGENT, query: { status: 'x' } })).res.statusCode, 400);
    // Base sin el esquema de tickets: cola vacía con aviso, no un error.
    const missing = Object.assign(new Error('PostgREST GET support_tickets failed (404): {"code":"PGRST205","message":"Could not find the table"}'), { status: 404 });
    const pending = await run(H.listHandler, { userId: AGENT, repo: fakeRepo({ async listDisputeTickets() { throw missing; } }) });
    assert.deepEqual([pending.res.statusCode, pending.res.body.migration_pending, pending.res.body.disputes.length], [200, true, 0]);

    const detail = await run(H.detailHandler, { userId: AGENT, params: { ticketId: TICKET } });
    assert.equal(detail.res.statusCode, 200);
    const d = detail.res.body.dispute;
    assert.equal(d.description, 'El artista cambió la fecha sin avisarme y no puedo ir.');
    assert.equal(d.desired_outcome, 'mediacion');
    assert.equal(d.session.location, 'Estudio X - Av. Corrientes 2151');
    assert.deepEqual(d.messages.map((m) => [m.author_role, m.is_internal, m.mine, m.author_name]), [['system', false, false, ''], ['support', true, true, 'Ana Soporte']]);
    assert.equal((await run(H.detailHandler, { userId: AGENT, params: { ticketId: 'no-es-uuid' } })).res.statusCode, 400);
    assert.equal((await run(H.detailHandler, { userId: AGENT, params: { ticketId: '88888888-8888-4888-8888-888888888888' } })).res.statusCode, 404, 'un ticket que no es disputa no existe para estas rutas');
});

test('rutas: tomar, resolver y cerrar; al resolver se avisa a las dos partes una sola vez', async () => {
    const H = routes._internal;
    // Tomar: pasa a "En revisión", se asigna al agente y no se avisa a nadie.
    const take = await run(H.statusHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { status: 'in_progress' } });
    assert.equal(take.res.statusCode, 200);
    assert.deepEqual(take.repo.calls.updates, [[TICKET, { status: 'in_progress', assigned_support_user_id: AGENT }]]);
    assert.equal(take.emails.length, 0);
    assert.equal(take.res.body.parties_notified, false);
    assert.match(take.repo.calls.notes[0].body, /^Estado: Abierta → En revisión\.$/);
    assert.equal(take.repo.calls.notes[0].isInternal, true);

    // Resolver sin resultado o sin texto: 400 y nada guardado.
    const bad = await run(H.statusHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { status: 'resolved', resolution: 'Se reprograma la sesión.' } });
    assert.deepEqual([bad.res.statusCode, bad.res.body.field, bad.repo.calls.updates.length, bad.emails.length], [400, 'outcome', 0, 0]);

    // Resolver: guarda, deja la nota y manda el correo con la resolución a las dos partes.
    const resolved = await run(H.statusHandler, {
        userId: AGENT, params: { ticketId: TICKET },
        body: { status: 'resolved', outcome: 'acuerdo', resolution: 'Se reprograma la sesión para el 5 de diciembre, sin costo.' },
    });
    assert.equal(resolved.res.statusCode, 200);
    assert.deepEqual(resolved.repo.calls.updates[0][1], {
        status: 'resolved', resolution: 'Se reprograma la sesión para el 5 de diciembre, sin costo.', resolution_outcome: 'acuerdo', assigned_support_user_id: AGENT,
    });
    assert.equal(resolved.res.body.ticket.status_label, 'Resuelta');
    assert.equal(resolved.res.body.parties_notified, true);
    assert.equal(resolved.emails.length, 1);
    const mail = resolved.emails[0];
    assert.equal(mail.eventId, 'session_dispute_resolved');
    assert.equal(mail.options.idempotencyKey, `disputa:${TICKET}:resolved:2026-11-16T15:00:00Z`);
    assert.equal(mail.payload.dispute_decision, 'resolved');
    assert.equal(mail.payload.dispute_resolution, 'Se reprograma la sesión para el 5 de diciembre, sin costo.');
    assert.equal(mail.payload.dispute_outcome_label, 'Acuerdo entre las partes');
    assert.equal(mail.payload.dispute_scope, 'session');
    assert.equal(mail.payload.ticket_number, 12);
    assert.equal(mail.payload.artist_email, 'mateo@nuevo.example', 'el email vigente del artista');
    assert.equal(mail.payload.client_email, 'lucia@example.com');
    assert.equal(mail.payload.quote_code, 'K7M2QP');
    assert.equal(mail.payload.session_id, SESSION);
    assert.deepEqual(resolveRecipientRoles('session_dispute_resolved', mail.payload).map((r) => r.role), ['client', 'artist']);
    assert.match(resolved.repo.calls.notes[0].body, /Estado: Abierta → Resuelta\.\nResolución \(Acuerdo entre las partes\): Se reprograma/);

    // Cerrar una ya resuelta: sin texto nuevo y sin segundo correo.
    const again = await run(H.statusHandler, {
        userId: AGENT, params: { ticketId: TICKET }, body: { status: 'closed' },
        repo: fakeRepo({ row: { ticket: ticketRow({ status: 'resolved', resolution: 'Se reprogramó.', resolution_outcome: 'acuerdo', assigned_support_user_id: AGENT, resolved_at: '2026-11-16T15:00:00Z' }) } }),
    });
    assert.deepEqual([again.res.statusCode, again.emails.length], [200, 0]);
    assert.deepEqual(again.repo.calls.updates[0][1], { status: 'closed' }, 'no pisa la resolución ni al agente asignado');

    // Cerrar sin resolver: pide el motivo y avisa con "cerró".
    const closeBad = await run(H.statusHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { status: 'closed' } });
    assert.deepEqual([closeBad.res.statusCode, closeBad.res.body.field], [400, 'resolution']);
    const closed = await run(H.statusHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { status: 'closed', resolution: 'Las partes ya lo arreglaron entre ellas.' } });
    assert.equal(closed.emails[0].payload.dispute_decision, 'closed');
    assert.equal(closed.emails[0].payload.dispute_outcome_label, 'Sin acción');
    assert.equal(closed.emails[0].options.idempotencyKey, `disputa:${TICKET}:closed:2026-11-16T15:00:00Z`);

    // El correo nunca rompe el guardado: la respuesta dice que no se pudo avisar.
    const mailDown = await run(H.statusHandler, {
        userId: AGENT, params: { ticketId: TICKET }, body: { status: 'resolved', outcome: 'a_favor_cliente', resolution: 'Se devuelve el anticipo completo.' },
        sendEmail: async () => { throw new Error('relé caído'); },
    });
    assert.deepEqual([mailDown.res.statusCode, mailDown.res.body.success, mailDown.res.body.parties_notified], [200, true, false]);

    // Ticket inexistente (o de otro tipo) y errores de base.
    assert.equal((await run(H.statusHandler, { userId: AGENT, params: { ticketId: '88888888-8888-4888-8888-888888888888' }, body: { status: 'in_progress' } })).res.statusCode, 404);
    const gone = await run(H.statusHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { status: 'in_progress' }, repo: fakeRepo({ async updateDisputeTicket() { return null; } }) });
    assert.equal(gone.res.statusCode, 404);
    const boom = await run(H.statusHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { status: 'in_progress' }, repo: fakeRepo({ async updateDisputeTicket() { throw new Error('boom'); } }) });
    assert.deepEqual([boom.res.statusCode, boom.res.body.error], [500, 'No pudimos guardar el estado.']);

    // Nota interna.
    const note = await run(H.noteHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { note: 'Llamé al artista: confirma la nueva fecha.' } });
    assert.equal(note.res.statusCode, 201);
    assert.deepEqual(note.repo.calls.notes[0], { ticketId: TICKET, authorUserId: AGENT, authorRole: 'support', body: 'Llamé al artista: confirma la nueva fecha.', isInternal: true });
    assert.equal((await run(H.noteHandler, { userId: AGENT, params: { ticketId: TICKET }, body: { note: '' } })).res.statusCode, 400);
});

// ---------------------------------------------------------------- correo

test('correo session_dispute_resolved: server-only, a las dos partes, con la resolución escapada', () => {
    const spec = EVENTS.session_dispute_resolved;
    assert.ok(spec && spec.serverOnly === true);
    assert.ok(getEvent('session_dispute_resolved'), 'cargado en el mapeo de eventos');
    assert.ok(SERVER_ONLY_EVENTS.has('session_dispute_resolved'), 'el navegador no lo puede disparar');
    const Sesiones = require('../lib/sesiones');
    const row = disputeRow();
    const data = (extra) => Sesiones.emailPayload(Object.assign({}, row.quote, { short_code: 'K7M2QP' }), null, row.session, Object.assign({
        app_base_url: BASE, dispute_decision: 'resolved', dispute_scope: 'session', dispute_reason_label: 'Cambio o cancelación sin acuerdo',
        dispute_outcome_label: 'Acuerdo entre las partes', dispute_resolution: `Se reprograma la sesión. ${ATTACK}`, ticket_number: 12,
    }, extra || {}));
    const client = renderEmail('session_dispute_resolved', data(), { role: 'client' });
    const artist = renderEmail('session_dispute_resolved', data(), { role: 'artist' });
    assert.equal(client.subject, 'Soporte resolvió la disputa · K7M2QP');
    assert.match(client.html, /Hola, Lucía\./);
    assert.match(artist.html, /Hola, Mateo\./);
    assert.match(client.text, /Soporte revisó la disputa sobre la sesión del .* con Mateo Rivas y la dio por resuelta\. La cotización ya no figura en disputa/);
    assert.match(artist.text, /con Lucía Fernández y la dio por resuelta/);
    assert.match(client.text, /Resolución de soporte:\n"Se reprograma la sesión\./);
    assert.match(client.text, /- Resultado: Acuerdo entre las partes\n- Ticket: N\.º 12/);
    assert.doesNotMatch(client.html, /<img src=x|<script>alert/, 'el texto de soporte sale escapado');
    assert.equal(client.cta.url, `${BASE}/client/dashboard?session=${SESSION}#mis-sesiones`);
    assert.equal(artist.cta.url, `${BASE}/my-quotations/detail?quote=QN3501&session=${SESSION}#qd-sessions`);
    // Cierre sin resolver y disputa sin sesión.
    const closed = renderEmail('session_dispute_resolved', Sesiones.emailPayload(row.quote, null, {}, {
        app_base_url: BASE, dispute_decision: 'closed', dispute_scope: 'quotation', dispute_resolution: 'Las partes ya lo arreglaron.', ticket_number: 12,
    }), { role: 'client' });
    assert.equal(closed.subject, 'Soporte cerró la disputa · QN3501');
    assert.match(closed.text, /Soporte revisó la disputa de esta cotización con Mateo Rivas y la cerró\./);
    assert.equal(closed.cta.label, 'Ver la cotización');
    assert.doesNotMatch(closed.text + closed.html, /undefined|null|Invalid Date/);
    // La otra parte y quien abrió también lo ven en la campana y en "Tu actividad".
    const dispatch = require('../lib/push-dispatch');
    assert.ok(dispatch.SESSION_ACTIVITY_EVENTS.has('session_dispute_resolved'));
    const feed = read('public/shared/js/notification-feed-model.js');
    assert.equal((feed.match(/'session_dispute_resolved'/g) || []).length, 2, 'artista y cliente');
    // El aviso a soporte lleva a la pestaña nueva.
    assert.match(read('lib/routes/sesiones.js'), /queue_url: `\$\{base\}\/support\/dashboard#disputas`/);
});

// ---------------------------------------------------------------- panel de soporte

test('panel de soporte: pestaña DISPUTAS con su repo y su módulo', () => {
    const html = read('public/support/dashboard/index.html');
    assert.equal((html.match(/data-tab="disputas"/g) || []).length, 2, 'menú lateral y pestaña');
    assert.match(html, /<button class="tab-btn" data-tab="disputas" type="button">/);
    assert.equal((html.match(/class="dsq-count" hidden/g) || []).length, 2);
    assert.equal((html.match(/class="rpq-count" hidden/g) || []).length, 2, 'el contador de denuncias sigue siendo solo de denuncias');
    const repoAt = html.indexOf('/shared/js/data/support-disputes-repo.js?v=20261116-r2b');
    const moduleAt = html.indexOf('/shared/js/support-dashboard-disputes.js?v=20261116-r2b');
    assert.ok(repoAt > html.indexOf('/shared/js/data/postgrest-client.js') && moduleAt > repoAt, 'orden de carga');
    assert.ok(moduleAt > html.indexOf('/shared/js/support-dashboard-reports.js'), 'después de la pestaña de denuncias (envuelve su switchTab)');
    assert.match(html, /support-dashboard-reports\.css\?v=20261116-r2b/);
    assert.match(read('public/shared/css/support-dashboard-reports.css'), /\.rpq-count,\.dsq-count\{/);

    const repo = read('public/shared/js/data/support-disputes-repo.js');
    assert.match(repo, /D\.SupportDisputes = \{/);
    for (const endpoint of ["'/api/support/disputes?status='", "'/api/support/disputes/' + encodeURIComponent(ticketId)", "'/status'", "'/notes'"]) {
        assert.ok(repo.includes(endpoint), endpoint);
    }
    assert.match(repo, /Authorization: 'Bearer ' \+ s\.access_token/);

    const src = read('public/shared/js/support-dashboard-disputes.js');
    assert.match(src, /const TAB = 'disputas';/);
    assert.match(src, /root\.WeotziData\.SupportDisputes/);
    assert.doesNotMatch(src, /\.from\(|\/rest\/v1\/|_supabase/, 'sin CRUD ad-hoc');
    assert.match(src, /querySelectorAll\('\.dsq-count'\)/);
    assert.match(src, /root\.location\.hash \|\| ''\)\.toLowerCase\(\) !== '#' \+ TAB/);
});

test('panel de soporte: fila, detalle y formulario escapan los datos y explican qué pasa al resolver', () => {
    const item = D.summarizeDispute(disputeRow());
    const row = Front.rowHtml(Object.assign({}, item, { opened_by: Object.assign({}, item.opened_by, { name: ATTACK }) }));
    assert.match(row, /data-dsq-id="99999999-9999-4999-8999-999999999999"/);
    assert.match(row, /WO-00012/);
    assert.match(row, /Cambio o cancelación sin acuerdo/);
    assert.match(row, /Sesión · QN3501/);
    assert.doesNotMatch(row, /<img src=x|<script>/);

    const detail = Front.detailHtml(Object.assign({}, item, {
        description: `Cambió la fecha ${ATTACK}`, desired_outcome: 'mediacion', resolution: null, resolution_outcome: null,
        messages: [{ author_role: 'system', is_internal: false, body: 'Disputa abierta.', created_at: '2026-11-16T12:00:00Z' },
            { author_role: 'support', author_name: 'Ana', mine: true, is_internal: true, body: ATTACK, created_at: '2026-11-16T13:00:00Z' }],
    }));
    assert.doesNotMatch(detail, /<img src=x|<script>alert/);
    assert.match(detail, /Disputa · Sesión · WO-00012/);
    assert.match(detail, /Sesión en disputa/);
    assert.match(detail, /<dt>Sesión<\/dt><dd>N\.º 2<\/dd>/);
    assert.match(detail, /<dt>Confirmación<\/dt><dd>Confirmada por el cliente<\/dd>/);
    assert.match(detail, /<dt>La cotización figura<\/dt><dd>En disputa<\/dd>/);
    assert.match(detail, /Abrió la disputa[\s\S]*Lucía Fernández[\s\S]*La otra parte[\s\S]*Mateo Rivas/);
    assert.match(detail, /href="mailto:lucia@example\.com"/);
    assert.match(detail, /data-dsq-take>TOMAR LA DISPUTA</, 'una disputa abierta se puede tomar con un clic');
    assert.match(detail, /las dos partes reciben este texto por correo y la cotización deja de figurar en disputa/);
    assert.match(detail, /Soporte · Ana \(tú\) · nota interna/);
    // Estados que se pueden elegir: sin "Abierta".
    const options = [...detail.matchAll(/<option value="(in_progress|waiting_user|resolved|closed|open)"/g)].map((m) => m[1]);
    assert.deepEqual(options, ['in_progress', 'waiting_user', 'resolved', 'closed']);
    assert.doesNotMatch(Front.detailHtml(Object.assign({}, item, { status: 'in_progress' })), /data-dsq-take/);
    assert.doesNotMatch(Front.detailHtml(Object.assign({}, item, { session: null, scope: 'quotation' })), /Sesión en disputa/);

    // El formulario valida igual que el servidor.
    assert.deepEqual(Front.buildStatusPayload('in_progress', 'acuerdo', 'texto', item), { payload: { status: 'in_progress' } });
    assert.equal(Front.buildStatusPayload('open', '', '', item).field, 'status');
    assert.equal(Front.buildStatusPayload('resolved', '', 'Se reprograma la sesión.', item).field, 'outcome');
    assert.equal(Front.buildStatusPayload('resolved', 'acuerdo', 'corta', item).field, 'resolution');
    assert.deepEqual(Front.buildStatusPayload('resolved', 'acuerdo', ' Se reprograma la sesión. ', item).payload, { status: 'resolved', outcome: 'acuerdo', resolution: 'Se reprograma la sesión.' });
    assert.equal(Front.buildStatusPayload('closed', '', '', item).field, 'resolution');
    assert.deepEqual(Front.buildStatusPayload('closed', '', '', Object.assign({}, item, { status: 'resolved', resolution: 'Se reprogramó.' })).payload, { status: 'closed' });
    for (const [status, outcome, text] of [['resolved', 'acuerdo', 'Se reprograma la sesión.'], ['closed', '', 'Las partes ya lo arreglaron.'], ['closed', '', ''], ['resolved', '', 'Se reprograma la sesión.']]) {
        const front = Front.buildStatusPayload(status, outcome, text, item);
        const server = D.parseStatusInput({ status, outcome, resolution: text }, ticketRow());
        assert.equal(!!front.payload, server.ok, `${status}/${outcome}/${text}`);
    }
    assert.ok(Front.matchesSearch(item, 'lucía'));
    assert.ok(Front.matchesSearch(item, 'wo-00012'));
    assert.equal(Front.matchesSearch(item, 'nadie'), false);
});

test('idioma: los textos nuevos van en español neutro con tuteo (sin voseo)', () => {
    const VOSEO = /\b(querés|podés|tenés|sabés|hacé|elegí|contanos|mirá|revisá|probá|ingresá|iniciá|creá|pedile|pedí|escribile|escribiles|mandale|avisale|resolvé|cerrá|tomá|esperá|guardá|confirmá|entrá|vos)\b/i;
    for (const rel of ['lib/soporte-disputas.js', 'lib/routes/soporte-disputas.js', 'lib/repos/soporte-disputas.js',
        'public/shared/js/support-dashboard-disputes.js', 'public/shared/js/data/support-disputes-repo.js']) {
        const hit = read(rel).split('\n').find((line) => VOSEO.test(line));
        assert.equal(hit, undefined, `${rel}: ${hit}`);
    }
});

// ---------------------------------------------------------------- pestaña en el navegador (DOM mínimo)

function fakeDom() {
    const byId = new Map();
    const listeners = {};
    function element(tag) {
        const el = {
            tagName: String(tag || 'div').toUpperCase(), dataset: {}, style: {}, attrs: {}, hidden: false, checked: false,
            className: '', _html: '', value: '', textContent: '', handlers: {},
            classList: { toggle() {}, contains: () => false, add() {}, remove() {} },
            setAttribute(k, v) { this.attrs[k] = String(v); },
            removeAttribute(k) { delete this.attrs[k]; },
            addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
            insertAdjacentElement(_where, node) { node.parentNode = this.parentNode; },
            focus() {},
            closest() { return null; },
            get innerHTML() { return this._html; },
            set innerHTML(html) {
                this._html = String(html);
                // Registra los id del marcado para que getElementById los encuentre.
                for (const m of this._html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)) {
                    const child = element(m[1]);
                    child._auto = true;
                    child.id = m[2];
                }
            },
        };
        Object.defineProperty(el, 'id', {
            get() { return this._id; },
            set(v) { this._id = v; if (!byId.has(v) || byId.get(v)._auto) byId.set(v, this); },
        });
        return el;
    }
    const table = element('div'); table.id = 'table-container'; table.parentNode = element('main');
    const drawer = element('div'); drawer.id = 'drawer-content';
    const toggle = element('input'); toggle.id = 'drawer-toggle';
    const counters = [element('span'), element('span')];
    const document = {
        readyState: 'complete',
        getElementById: (id) => byId.get(id) || null,
        createElement: (tag) => element(tag),
        querySelector: () => null,
        querySelectorAll: (sel) => (sel === '.dsq-count' ? counters : []),
        addEventListener() {},
    };
    const window = {
        document, location: { hash: '', pathname: '/support/dashboard' },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
        WeotziData: {},
    };
    return { window, document, byId, drawer, toggle, counters, listeners };
}

test('pestaña en el navegador: entra con switchTab, pinta la cola, abre el detalle y guarda el estado', async () => {
    const vm = require('node:vm');
    const dom = fakeDom();
    const item = D.summarizeDispute(disputeRow());
    const detail = Object.assign({}, item, { description: 'El artista cambió la fecha sin avisarme.', desired_outcome: 'mediacion', resolution: null, resolution_outcome: null, messages: [] });
    const calls = [];
    dom.window.WeotziData.SupportDisputes = {
        hasSession: async () => true,
        list: async (filters) => { calls.push(['list', filters]); return { ok: true, status: 200, json: { success: true, active_count: 1, disputes: [item] } }; },
        get: async (id) => { calls.push(['get', id]); return { ok: true, status: 200, json: { success: true, dispute: Object.assign({}, detail) } }; },
        setStatus: async (id, payload) => {
            calls.push(['setStatus', id, payload]);
            Object.assign(detail, { status: payload.status, resolution: payload.resolution || null, resolution_outcome: payload.outcome || null });
            return { ok: true, status: 200, json: { success: true, parties_notified: true, ticket: { status: payload.status } } };
        },
        addNote: async () => ({ ok: true, status: 201, json: { success: true, message: null } }),
    };
    const previous = [];
    dom.window.switchTab = (name) => { previous.push(name); };
    const tick = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
    vm.runInNewContext(read('public/shared/js/support-dashboard-disputes.js'), { window: dom.window, console, URL });

    // Otra pestaña: delega en el switchTab anterior (denuncias, bajas, las nativas…).
    dom.window.switchTab('artists');
    assert.deepEqual(previous, ['artists']);
    assert.equal(dom.byId.has('dsq-panel'), false, 'el panel no se crea hasta entrar');

    dom.window.switchTab('disputas');
    await tick();
    assert.deepEqual(previous, ['artists'], 'la pestaña propia no pasa por las demás');
    const panel = dom.byId.get('dsq-panel');
    assert.ok(panel && panel.hidden === false);
    assert.equal(panel.className, 'rpq-panel');
    assert.match(panel.innerHTML, /Mientras una disputa está activa, la cotización figura “En disputa”/);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['list', { status: 'active' }]);
    const body = dom.byId.get('dsq-body');
    assert.match(body.innerHTML, /data-dsq-id="99999999-9999-4999-8999-999999999999"/);
    assert.match(body.innerHTML, /Lucía Fernández[\s\S]*Mateo Rivas/);
    assert.deepEqual(dom.counters.map((c) => [c.textContent, c.hidden]), [['1', false], ['1', false]]);

    // Detalle en el drawer.
    await dom.window.SupportDisputesQueue.open(TICKET);
    assert.equal(dom.toggle.checked, true);
    assert.match(dom.drawer.innerHTML, /id="dsq-detail"[\s\S]*TOMAR LA DISPUTA/);
    assert.deepEqual(calls[1], ['get', TICKET]);

    // "Tomar la disputa" → En revisión.
    dom.drawer.handlers.click[0]({ target: { closest: (sel) => (sel === '[data-dsq-take]' ? {} : null) }, preventDefault() {} });
    await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find((c) => c[0] === 'setStatus'))), ['setStatus', TICKET, { status: 'in_progress' }]);
    assert.doesNotMatch(dom.drawer.innerHTML, /data-dsq-take/, 'ya tomada');

    // Resolver desde el formulario: sin resultado no se envía; con todo, sí.
    const submit = dom.drawer.handlers.submit[0];
    const formEvent = { target: { closest: (sel) => (sel === '[data-dsq-status-form]' ? {} : null) }, preventDefault() {} };
    dom.byId.get('dsq-new-status').value = 'resolved';
    dom.byId.get('dsq-outcome').value = '';
    dom.byId.get('dsq-resolution').value = 'Se reprograma la sesión para el 5 de diciembre.';
    submit(formEvent);
    await tick();
    assert.equal(calls.filter((c) => c[0] === 'setStatus').length, 1, 'falta el resultado: no se envía');
    assert.equal(dom.byId.get('dsq-status-feedback').textContent, 'Indica cómo se resolvió la disputa.');
    dom.byId.get('dsq-outcome').value = 'acuerdo';
    submit(formEvent);
    await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(calls.filter((c) => c[0] === 'setStatus')[1])),
        ['setStatus', TICKET, { status: 'resolved', outcome: 'acuerdo', resolution: 'Se reprograma la sesión para el 5 de diciembre.' }]);
    assert.equal(dom.byId.get('dsq-status-feedback').textContent, 'Estado guardado: Resuelta. Les avisamos a las dos partes por correo.');
    assert.ok(calls.filter((c) => c[0] === 'list').length >= 2, 'la cola se actualiza después de guardar');

    // Salir de la pestaña la oculta y sigue la cadena.
    dom.window.switchTab('denuncias');
    assert.equal(panel.hidden, true);
    assert.deepEqual(previous, ['artists', 'denuncias']);
});
