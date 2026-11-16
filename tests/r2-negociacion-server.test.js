'use strict';
// Ronda 2 · frente "negociacion": lógica del servidor, rutas, repositorio,
// emails y contrato de la migración (P23 · P25 · P4-saldo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const logic = require('../lib/negociacion');
const { createHandlers, register } = require('../lib/routes/negociacion');
const EVENTS = require('../services/email-events/negociacion');
const { renderEmail } = require('../lib/email-render');
const mapping = require('../services/email-event-mapping');
const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const M = logic.Model;

const NOW = Date.parse('2026-11-16T12:00:00Z');
const CLIENT = '11111111-1111-4111-8111-111111111111';
const ARTIST = '22222222-2222-4222-8222-222222222222';
const PID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = (id) => ({ id, email: 'x@example.com', raw: {} });
const quote = (over = {}) => ({
    id: 7, quote_id: 'WO-7', quote_status: 'responded', client_user_id: CLIENT, artist_id: ARTIST,
    client_email: 'lucia@example.com', client_full_name: 'Lucía Fernández', artist_name: 'Mateo Rivas', artist_email: null,
    artist_budget_amount: '2000', artist_budget_currency: 'USD', tattoo_estimated_sessions: '3',
    tattoo_body_part: 'Antebrazo', tattoo_size: 'Mediano · 8 a 15 cm', tattoo_style: ['Realismo'],
    tattoo_color_type: 'Negro y gris', tattoo_idea_description: 'Un león realista mirando de frente.',
    quote_expires_at: null, dispute_status: 'none', agreement_approved_at: null, agreement_version: 0, ...over,
});
const agreed = (over = {}) => quote({
    quote_status: 'client_approved', final_budget_amount: '2000', final_budget_currency: 'USD', final_sessions: '3',
    agreement_approved_at: '2026-11-15T10:00:00Z', agreement_version: 1, ...over,
});
const proposalRow = (over = {}) => ({
    id: PID, quotation_id: 7, quote_id: 'WO-7', kind: 'counter', proposed_by: 'client', proposer_user_id: CLIENT, status: 'pending',
    changes: { artist_budget_amount: { from: '2000', to: '1800' } }, currency: 'USD', note: 'Me alcanza hasta 1800', response_note: null,
    resolved_by: null, resolved_at: null, base_agreement_version: 0, created_at: '2026-11-16T09:00:00Z', ...over,
});

// ---------------------------------------------------------------- lógica
test('pedido: tipo, cambios y nota normalizados; acción válida', () => {
    assert.equal(logic.normalizeProposeBody(null).status, 400);
    assert.equal(logic.normalizeProposeBody({ kind: 'otro', changes: {} }).code, 'kind');
    assert.equal(logic.normalizeProposeBody({ kind: 'counter', changes: [] }).code, 'changes');
    const ok = logic.normalizeProposeBody({ kind: ' Counter ', changes: { a: 1 }, note: '  hola \r\n\r\n\r\n mundo ', as: 'artist' });
    assert.deepEqual([ok.kind, ok.note, ok.hint], ['counter', 'hola\n\nmundo', 'artist']);
    assert.equal(logic.normalizeProposeBody({ kind: 'amendment', changes: {}, note: 'x'.repeat(900) }).note.length, 600);
    assert.equal(logic.normalizeResolveBody('borrar', {}).status, 400);
    assert.deepEqual(logic.normalizeResolveBody('ACCEPT', { note: ' ok ', as: 'hacker' }), { ok: true, action: 'accept', note: 'ok', hint: null });
    assert.equal(logic.isUuid(PID), true);
    assert.equal(logic.isUuid('1 or 1=1'), false);
    assert.equal(logic.cleanQuoteId('x'.repeat(65)), '');
});

test('evaluatePropose: sesión, parte de la cotización, rol, estado y cambios', () => {
    const base = { kind: 'counter', changes: { artist_budget_amount: '1800' }, now: NOW };
    assert.equal(logic.evaluatePropose({ ...base, user: null, quotation: quote() }).status, 401);
    assert.equal(logic.evaluatePropose({ ...base, user: user(CLIENT), quotation: null }).status, 404);
    assert.equal(logic.evaluatePropose({ ...base, user: user('otro'), quotation: quote() }).status, 403);
    const artist = logic.evaluatePropose({ ...base, user: user(ARTIST), quotation: quote() });
    assert.deepEqual([artist.status, artist.code], [403, 'role']);
    const ok = logic.evaluatePropose({ ...base, user: user(CLIENT), quotation: quote() });
    assert.deepEqual(ok, { ok: true, role: 'client', changes: { artist_budget_amount: '1800' } });
    assert.equal(logic.evaluatePropose({ ...base, user: user(CLIENT), quotation: quote({ quote_expires_at: '2026-11-15T00:00:00Z' }) }).status, 410);
    assert.equal(logic.evaluatePropose({ ...base, user: user(CLIENT), quotation: quote({ dispute_status: 'open' }) }).code, 'dispute');
    const rejected = logic.evaluatePropose({ ...base, user: user(CLIENT), quotation: quote({ quote_status: 'client_rejected' }) });
    assert.equal(rejected.status, 409);
    assert.match(rejected.error, /quedó finalizada/);
    assert.match(logic.evaluatePropose({ ...base, user: user(CLIENT), quotation: agreed() }).error, /propón un cambio al acuerdo/);
    assert.equal(logic.evaluatePropose({ ...base, changes: { artist_budget_amount: '2000' }, user: user(CLIENT), quotation: quote() }).code, 'no_changes');
});

test('evaluatePropose (enmienda): ambas partes, solo con acuerdo, con los pisos de pagos y sesiones', () => {
    const base = { kind: 'amendment', changes: { final_budget_amount: '2500', final_sessions: '4' }, now: NOW };
    for (const id of [CLIENT, ARTIST]) {
        const ok = logic.evaluatePropose({ ...base, user: user(id), quotation: agreed() });
        assert.deepEqual(ok.changes, { final_budget_amount: '2500', final_sessions: '4' });
    }
    const early = logic.evaluatePropose({ ...base, user: user(ARTIST), quotation: quote() });
    assert.equal(early.status, 409);
    assert.match(early.error, /Todavía no hay un acuerdo aprobado por ambas partes/);
    assert.match(logic.evaluatePropose({ ...base, user: user(ARTIST), quotation: agreed({ quote_status: 'completed' }) }).error, /ya está completado/);
    // Cotización manual o de invitado: sin cuenta del cliente no hay quién apruebe.
    const guest = logic.evaluatePropose({ ...base, user: user(ARTIST), quotation: agreed({ client_user_id: null }) });
    assert.deepEqual([guest.status, guest.code], [409, 'no_counterparty']);
    assert.match(guest.error, /todavía no tiene cuenta/);
    const paid = logic.evaluatePropose({ kind: 'amendment', changes: { final_budget_amount: '300' }, user: user(ARTIST), quotation: agreed(), extras: { paid: 500 }, now: NOW });
    assert.equal(paid.code, 'below_paid');
    const sessions = logic.evaluatePropose({ kind: 'amendment', changes: { final_sessions: '1' }, user: user(CLIENT), quotation: agreed(), extras: { sessionsUsed: 2 }, now: NOW });
    assert.equal(sessions.code, 'below_sessions');
    // Los pisos de la enmienda no aplican a una contrapropuesta.
    assert.equal(logic.evaluatePropose({ kind: 'counter', changes: { artist_budget_amount: '100' }, user: user(CLIENT), quotation: quote(), extras: { paid: 500 }, now: NOW }).ok, true);
});

test('estado: permisos, valores vigentes, pendiente e historial; sin ids de usuarios', () => {
    const rows = [proposalRow(), proposalRow({ id: 'b', status: 'rejected', resolved_by: ARTIST })];
    const out = logic.stateFor({ user: user(CLIENT), quotation: quote(), proposals: rows, now: NOW });
    assert.equal(out.ok, true);
    const s = out.state;
    assert.deepEqual([s.available, s.role, s.quote_id, s.quote_status], [true, 'client', 'WO-7', 'responded']);
    assert.deepEqual(s.can, { counter: true, amend: false });
    assert.deepEqual(s.agreement, { approved: false, approved_at: null, version: 0 });
    assert.equal(s.pending.id, PID);
    assert.equal(s.proposals.length, 2);
    assert.equal(s.current.counter.artist_budget_amount, '2000');
    assert.deepEqual(s.currency, { counter: 'USD', amendment: 'USD' });
    const json = JSON.stringify(s);
    assert.doesNotMatch(json, /proposer_user_id|resolved_by|client_email|lucia@example\.com/);
    assert.ok(!json.includes(CLIENT) && !json.includes(ARTIST));

    const a = logic.stateFor({ user: user(ARTIST), quotation: agreed({ artist_deposit_pct: null }), proposals: [], extras: { paid: 500, sessionsUsed: 2, manualDepositPct: 10 }, now: NOW }).state;
    assert.deepEqual([a.role, a.can.amend, a.agreement.approved, a.agreement.version], ['artist', true, true, 1]);
    assert.deepEqual(a.limits, { paid: 500, sessions_used: 2 });
    assert.equal(a.current.amendment.artist_deposit_pct, 10);
    assert.equal(a.pending, null);
    assert.equal(logic.stateFor({ user: user('otro'), quotation: quote(), proposals: [] }).status, 403);
    assert.equal(logic.stateFor({ user: null, quotation: quote() }).status, 401);
});

test('errores de la base (NEG_*) → mensaje claro; migración sin aplicar → 503', () => {
    const pg = (code, details) => new Error(`PostgREST POST rpc/negociacion_propose failed (400): {"code":"22023","details":${details ? `"${details}"` : 'null'},"hint":null,"message":"${code}"}`);
    assert.deepEqual([logic.dbError(pg('NEG_STATUS', 'expired')).status, logic.dbError(pg('NEG_STATUS')).code], [409, 'status']);
    const paid = logic.dbError(pg('NEG_BELOW_PAID', '500'));
    assert.deepEqual([paid.status, paid.code, paid.known], [409, 'below_paid', true]);
    assert.match(paid.error, /\(500\)/);
    assert.match(logic.dbError(pg('NEG_BELOW_SESSIONS', '2')).error, /Ya hay 2 sesiones/);
    assert.equal(logic.dbError(pg('NEG_VALUE', 'tattoo_size')).field, 'tattoo_size');
    assert.equal(logic.dbError(pg('NEG_FORBIDDEN')).status, 403);
    assert.equal(logic.dbError(pg('NEG_EXPIRED')).status, 410);
    assert.equal(logic.dbError(pg('NEG_NOT_PENDING', 'accepted')).status, 409);
    const missing = logic.dbError(new Error('PostgREST POST rpc/negociacion_propose failed (404): {"code":"PGRST202","message":"Could not find the function public.negociacion_propose"}'));
    assert.deepEqual([missing.status, missing.code, missing.known], [503, 'unavailable', true]);
    const unknown = logic.dbError(new Error('ECONNRESET'));
    assert.deepEqual([unknown.status, unknown.known], [500, false]);
    assert.doesNotMatch(unknown.error, /ECONNRESET/);
});

test('avisos: cada paso le llega a la contraparte, con el enlace de su panel', () => {
    const base = 'https://beta.weotzi.com/';
    const artist = { name: 'Mateo Rivas', email: 'mateo@example.com' };
    const mail = (step, proposal, quotation = quote()) => logic.emailFor({ step, proposal, quotation, artist, base });

    const proposed = mail('proposed', proposalRow());
    assert.equal(proposed.eventId, 'negotiation_counter_proposed');
    assert.equal(proposed.idempotencyKey, `negociacion:${PID}:proposed`);
    assert.deepEqual([proposed.payload.recipient_role, proposed.payload.recipient_email, proposed.payload.recipient_user_id], ['artist', 'mateo@example.com', ARTIST]);
    assert.equal(proposed.payload.quotation_url, 'https://beta.weotzi.com/my-quotations/detail?quote=WO-7');
    assert.deepEqual(proposed.payload.changes_rows, [['Presupuesto', '2.000 USD → 1.800 USD']]);
    assert.deepEqual([proposed.payload.actor_role, proposed.payload.actor_name, proposed.payload.client_name], ['client', 'Lucía', 'Lucía']);

    const accepted = mail('accepted', proposalRow({ status: 'accepted' }), agreed({ final_budget_amount: '1800' }));
    assert.deepEqual([accepted.eventId, accepted.payload.recipient_role, accepted.payload.recipient_email], ['negotiation_counter_accepted', 'client', 'lucia@example.com']);
    assert.equal(accepted.payload.quotation_url, 'https://beta.weotzi.com/client/dashboard?quote=WO-7');
    assert.equal(accepted.payload.agreed_total_text, '1.800 USD');
    assert.equal(mail('rejected', proposalRow()).eventId, 'negotiation_counter_declined');
    assert.equal(mail('rejected', proposalRow()).payload.recipient_role, 'client');

    // Enmienda del artista: se le avisa al cliente; al resolverla, al artista.
    const amendment = proposalRow({ kind: 'amendment', proposed_by: 'artist', changes: { final_sessions: { from: '3', to: '4' } } });
    assert.deepEqual([mail('proposed', amendment, agreed()).eventId, mail('proposed', amendment, agreed()).payload.recipient_role], ['negotiation_amendment_proposed', 'client']);
    assert.deepEqual([mail('accepted', amendment, agreed()).eventId, mail('accepted', amendment, agreed()).payload.recipient_role], ['negotiation_amendment_accepted', 'artist']);
    assert.deepEqual([mail('rejected', amendment, agreed()).eventId, mail('rejected', amendment, agreed()).payload.recipient_role], ['negotiation_amendment_rejected', 'artist']);
    assert.deepEqual([mail('withdrawn', amendment, agreed()).eventId, mail('withdrawn', amendment, agreed()).payload.recipient_role], ['negotiation_proposal_withdrawn', 'client']);
    assert.equal(mail('withdrawn', proposalRow()).payload.recipient_role, 'artist');

    // Sin destinatario guardado no hay aviso; nunca viajan datos de contacto del cliente al artista.
    assert.equal(logic.emailFor({ step: 'proposed', proposal: proposalRow(), quotation: quote(), artist: null, base }), null);
    assert.doesNotMatch(JSON.stringify(proposed.payload), /lucia@example\.com|whatsapp|instagram/i);
    assert.equal(mail('inventado', proposalRow()), null);
});

// ---------------------------------------------------------------- rutas
function fakeRes() {
    return {
        statusCode: 200, headers: {}, body: null,
        set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    };
}
function setup(over = {}) {
    const calls = { propose: [], resolve: [], emails: [], hooks: [], reads: 0 };
    const store = Object.assign({ quotation: quote(), proposals: [], paid: 0, sessions: 0, afterAccept: null, proposeError: null, resolveError: null }, over.store || {});
    const repo = {
        async getQuotation(id) { calls.reads += 1; return id === store.quotation.quote_id ? store.quotation : null; },
        async listProposals() { return store.proposals; },
        async getProposal(id) { return store.proposals.find((p) => p.id === id) || null; },
        async propose(args) {
            calls.propose.push(args);
            if (store.proposeError) throw store.proposeError;
            const changes = {};
            for (const [k, v] of Object.entries(args.changes)) changes[k] = { from: 'antes', to: v };
            const row = proposalRow({ kind: args.kind, proposed_by: args.role, proposer_user_id: args.actor, changes, note: args.note });
            store.proposals.unshift(row);
            return row;
        },
        async resolve(args) {
            calls.resolve.push(args);
            if (store.resolveError) throw store.resolveError;
            const row = store.proposals.find((p) => p.id === args.proposalId);
            row.status = { accept: 'accepted', reject: 'rejected', withdraw: 'withdrawn' }[args.action];
            row.response_note = args.note;
            if (args.action === 'accept' && store.afterAccept) store.quotation = store.afterAccept;
            return { already: false, proposal: row };
        },
        async paidTotal() { return store.paid; },
        async activeSessions() { return store.sessions; },
        async manualDepositPct() { return null; },
        async getArtist() { return { user_id: ARTIST, name: 'Mateo Rivas', email: 'mateo@example.com' }; },
        async listScheduledSessions() { return [{ id: 's1' }]; },
    };
    const deps = Object.assign({
        resolveBearerUser: async (req) => req.user || null,
        repo,
        emailService: { async sendEmail(id, payload, opts) { calls.emails.push({ id, payload, opts }); return { ok: true }; } },
        applicationBase: () => 'https://beta.weotzi.com',
        runDecisionHooks: async (evt) => { calls.hooks.push(evt); return []; },
        logger: { log() {}, warn() {}, error() {} },
        now: () => NOW,
    }, over.deps || {});
    return { calls, store, handlers: createHandlers(deps) };
}
const req = (userId, params, body, query) => ({ user: userId ? user(userId) : null, params, body: body || {}, query: query || {}, headers: {} });

test('GET estado: sesión obligatoria, solo las partes, y oculto si falta la migración', async () => {
    const { handlers } = setup({ store: { proposals: [proposalRow()] } });
    let res = fakeRes();
    await handlers.state(req(null, { quoteId: 'WO-7' }), res);
    assert.equal(res.statusCode, 401);
    res = fakeRes();
    await handlers.state(req('otro', { quoteId: 'WO-7' }), res);
    assert.equal(res.statusCode, 403);
    res = fakeRes();
    await handlers.state(req(CLIENT, { quoteId: 'NO' }), res);
    assert.equal(res.statusCode, 404);
    res = fakeRes();
    await handlers.state(req(ARTIST, { quoteId: 'WO-7' }, null, { as: 'artist' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual([res.body.success, res.body.role, res.body.pending.id, res.body.can.counter], [true, 'artist', PID, false]);

    const missing = setup({ deps: {} });
    missing.handlers = createHandlers({
        resolveBearerUser: async (r) => r.user, logger: { log() {}, warn() {}, error() {} },
        repo: { async getQuotation() { throw new Error('PostgREST GET quotations_db failed (400): {"code":"42703","message":"column quotations_db.agreement_approved_at does not exist"}'); } },
    });
    res = fakeRes();
    await missing.handlers.state(req(CLIENT, { quoteId: 'WO-7' }), res);
    assert.deepEqual(res.body, { success: true, available: false });
});

test('POST contrapropuesta: valida, guarda con el rol del servidor y avisa al artista', async () => {
    const { handlers, calls } = setup();
    const res = fakeRes();
    await handlers.propose(req(CLIENT, { quoteId: 'WO-7' }, { kind: 'counter', changes: { artist_budget_amount: '1.800', tattoo_size: 'Mediano · 8 a 15 cm' }, note: ' Me alcanza hasta 1800 ', as: 'artist' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.propose, [{ quotationId: 7, actor: CLIENT, role: 'client', kind: 'counter', changes: { artist_budget_amount: '1800' }, note: 'Me alcanza hasta 1800' }]);
    assert.equal(res.body.proposal.status, 'pending');
    assert.equal(res.body.proposal.proposer_user_id, undefined);
    assert.equal(calls.emails.length, 1);
    assert.equal(calls.emails[0].id, 'negotiation_counter_proposed');
    assert.equal(calls.emails[0].payload.recipient_email, 'mateo@example.com');
    assert.equal(calls.emails[0].opts.idempotencyKey, `negociacion:${PID}:proposed`);
    assert.deepEqual(res.body.emails, [{ event: 'negotiation_counter_proposed', ok: true, skipped: false }]);
});

test('POST propuesta: rechazos del servidor y de la base, sin efectos', async () => {
    const cases = [
        [null, { kind: 'counter', changes: { artist_budget_amount: '1' } }, 401],
        ['otro', { kind: 'counter', changes: { artist_budget_amount: '1' } }, 403],
        [ARTIST, { kind: 'counter', changes: { artist_budget_amount: '1' } }, 403],
        [CLIENT, { kind: 'counter', changes: { artist_budget_amount: '2000' } }, 400],
        [CLIENT, { kind: 'amendment', changes: { final_sessions: '4' } }, 409],
        [CLIENT, { kind: 'nada', changes: {} }, 400],
    ];
    for (const [who, body, status] of cases) {
        const { handlers, calls } = setup();
        const res = fakeRes();
        await handlers.propose(req(who, { quoteId: 'WO-7' }, body), res);
        assert.equal(res.statusCode, status, JSON.stringify(body));
        assert.equal(res.body.success, false);
        assert.equal(calls.propose.length + calls.emails.length, 0);
    }
    // La base tiene la última palabra (carrera con un cambio de estado).
    const race = setup({ store: { proposeError: new Error('PostgREST POST rpc/negociacion_propose failed (400): {"code":"22023","details":"client_approved","message":"NEG_STATUS"}') } });
    const res = fakeRes();
    await race.handlers.propose(req(CLIENT, { quoteId: 'WO-7' }, { kind: 'counter', changes: { artist_budget_amount: '1800' } }), res);
    assert.deepEqual([res.statusCode, res.body.code], [409, 'status']);
    assert.equal(race.calls.emails.length, 0);
    const boom = setup({ store: { proposeError: new Error('ECONNRESET') } });
    const res2 = fakeRes();
    await boom.handlers.propose(req(CLIENT, { quoteId: 'WO-7' }, { kind: 'counter', changes: { artist_budget_amount: '1800' } }), res2);
    assert.equal(res2.statusCode, 500);
    assert.doesNotMatch(res2.body.error, /ECONNRESET/);
});

test('POST aceptar contrapropuesta: solo el artista; cotización aprobada, aviso al cliente y hook de turnos', async () => {
    const approved = agreed({ final_budget_amount: '1800', artist_budget_amount: '1800' });
    const { handlers, calls } = setup({ store: { proposals: [proposalRow()], afterAccept: approved } });
    let res = fakeRes();
    await handlers.resolve(req(CLIENT, { quoteId: 'WO-7', proposalId: PID, action: 'accept' }), res);
    assert.deepEqual([res.statusCode, res.body.code], [403, 'own_proposal']);
    assert.equal(calls.resolve.length, 0);

    res = fakeRes();
    await handlers.resolve(req(ARTIST, { quoteId: 'WO-7', proposalId: PID, action: 'accept' }, { note: ' Dale ' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.resolve, [{ proposalId: PID, actor: ARTIST, action: 'accept', note: 'Dale' }]);
    assert.deepEqual([res.body.quote_status, res.body.agreement.approved, res.body.proposal.status], ['client_approved', true, 'accepted']);
    assert.equal(calls.emails[0].id, 'negotiation_counter_accepted');
    assert.equal(calls.emails[0].payload.recipient_email, 'lucia@example.com');
    assert.equal(calls.emails[0].payload.agreed_total_text, '1.800 USD');
    assert.equal(calls.hooks.length, 1);
    assert.deepEqual([calls.hooks[0].decision, calls.hooks[0].status, calls.hooks[0].userId, calls.hooks[0].via, calls.hooks[0].sessions.length], ['approve', 'client_approved', CLIENT, 'counter_accepted', 1]);

    // Repetir la aceptación es idempotente: no vuelve a la base ni manda otro correo.
    res = fakeRes();
    await handlers.resolve(req(ARTIST, { quoteId: 'WO-7', proposalId: PID, action: 'accept' }), res);
    assert.deepEqual([res.statusCode, res.body.already], [200, true]);
    assert.equal(calls.resolve.length, 1);
    assert.equal(calls.emails.length, 1);
});

test('POST rechazar / retirar: nada cambia en la cotización y se avisa a quien corresponde', async () => {
    const amendment = proposalRow({ kind: 'amendment', proposed_by: 'artist', proposer_user_id: ARTIST, changes: { final_sessions: { from: '3', to: '4' } } });
    const a = setup({ store: { quotation: agreed(), proposals: [amendment] } });
    let res = fakeRes();
    await a.handlers.resolve(req(CLIENT, { quoteId: 'WO-7', proposalId: PID, action: 'reject' }, { note: 'No puedo otra sesión' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual([res.body.proposal.status, res.body.quote_status, res.body.agreement.version], ['rejected', 'client_approved', 1]);
    assert.deepEqual([a.calls.emails[0].id, a.calls.emails[0].payload.recipient_email], ['negotiation_amendment_rejected', 'mateo@example.com']);
    assert.equal(a.calls.hooks.length, 0);
    assert.equal(a.calls.reads, 1, 'sin aceptar no se relee la cotización');

    const w = setup({ store: { proposals: [proposalRow()] } });
    res = fakeRes();
    await w.handlers.resolve(req(ARTIST, { quoteId: 'WO-7', proposalId: PID, action: 'withdraw' }), res);
    assert.deepEqual([res.statusCode, res.body.code], [403, 'not_proposer']);
    res = fakeRes();
    await w.handlers.resolve(req(CLIENT, { quoteId: 'WO-7', proposalId: PID, action: 'withdraw' }), res);
    assert.equal(res.body.proposal.status, 'withdrawn');
    assert.deepEqual([w.calls.emails[0].id, w.calls.emails[0].payload.recipient_role], ['negotiation_proposal_withdrawn', 'artist']);
});

test('POST resolver: ids inválidos, propuesta ajena y carrera en la base', async () => {
    const { handlers, calls } = setup({ store: { proposals: [proposalRow({ quotation_id: 99 })] } });
    let res = fakeRes();
    await handlers.resolve(req(ARTIST, { quoteId: 'WO-7', proposalId: 'x', action: 'accept' }), res);
    assert.equal(res.statusCode, 400);
    res = fakeRes();
    await handlers.resolve(req(ARTIST, { quoteId: 'WO-7', proposalId: PID, action: 'borrar' }), res);
    assert.equal(res.statusCode, 400);
    res = fakeRes();
    await handlers.resolve(req(ARTIST, { quoteId: 'WO-7', proposalId: PID, action: 'accept' }), res);
    assert.equal(res.statusCode, 404, 'la propuesta es de otra cotización');
    res = fakeRes();
    await handlers.resolve(req('otro', { quoteId: 'WO-7', proposalId: PID, action: 'accept' }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(calls.resolve.length, 0);

    const race = setup({ store: { proposals: [proposalRow()], resolveError: new Error('PostgREST POST rpc/negociacion_resolve failed (400): {"code":"22023","details":"superseded","message":"NEG_NOT_PENDING"}') } });
    res = fakeRes();
    await race.handlers.resolve(req(ARTIST, { quoteId: 'WO-7', proposalId: PID, action: 'accept' }), res);
    assert.deepEqual([res.statusCode, res.body.code], [409, 'not_pending']);
    assert.equal(race.calls.emails.length + race.calls.hooks.length, 0);
});

test('register: tres rutas, las escrituras con límite propio; server.js lo registra antes del estático', () => {
    const routes = [];
    const app = { get(p, ...h) { routes.push(['GET', p, h.length]); }, post(p, ...h) { routes.push(['POST', p, h.length]); } };
    register(app, { limiter: (rq, rs, next) => next(), resolveBearerUser: async () => null, repo: {}, emailService: {}, applicationBase: () => '', runDecisionHooks: async () => [] });
    assert.deepEqual(routes, [
        ['GET', '/api/negociacion/quotations/:quoteId', 1],
        ['POST', '/api/negociacion/quotations/:quoteId/proposals', 2],
        ['POST', '/api/negociacion/quotations/:quoteId/proposals/:proposalId/:action', 2],
    ]);
    const server = read('server.js');
    const at = server.indexOf("require('./lib/routes/negociacion').register(app)");
    assert.ok(at > 0);
    assert.equal(server.split("require('./lib/routes/negociacion')").length, 2, 'una sola línea');
    assert.ok(at < server.indexOf('legacyRedirectFor(req.path'));
    assert.ok(at < server.indexOf("app.use(express.static(path.join(__dirname, 'public')))"));
});

// ---------------------------------------------------------------- repositorio
test('repositorio: RPC atómicas y lecturas por la capa PostgREST', async () => {
    const prev = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: global.fetch };
    process.env.SUPABASE_URL = 'https://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    const seen = [];
    let next = '[]';
    global.fetch = async (url, opts) => { seen.push({ url, method: opts.method, body: opts.body }); return { ok: true, status: 200, headers: { get: () => null }, text: async () => next }; };
    try {
        const { NegotiationRepo, QUOTE_SELECT } = require('../lib/repos/negotiation');
        next = '{"id":"p1","status":"pending"}';
        const row = await NegotiationRepo.propose({ quotationId: 7, actor: CLIENT, role: 'client', kind: 'counter', changes: { artist_budget_amount: '1800' }, note: '' });
        assert.equal(row.id, 'p1');
        assert.deepEqual([seen[0].method, seen[0].url], ['POST', 'https://db.test/rest/v1/rpc/negociacion_propose']);
        assert.deepEqual(JSON.parse(seen[0].body), { p_quotation_id: 7, p_actor: CLIENT, p_role: 'client', p_kind: 'counter', p_changes: { artist_budget_amount: '1800' }, p_note: null });
        next = '{"already":false,"proposal":{"id":"p1","status":"accepted"}}';
        const out = await NegotiationRepo.resolve({ proposalId: PID, actor: ARTIST, action: 'accept', note: 'ok' });
        assert.equal(out.proposal.status, 'accepted');
        assert.equal(seen[1].url, 'https://db.test/rest/v1/rpc/negociacion_resolve');
        assert.deepEqual(JSON.parse(seen[1].body), { p_proposal_id: PID, p_actor: ARTIST, p_action: 'accept', p_note: 'ok' });

        next = '[]';
        await NegotiationRepo.getQuotation('WO 7');
        assert.match(seen[2].url, /quotations_db\?select=.*&quote_id=eq\.WO%207&limit=1/);
        for (const column of ['agreement_approved_at', 'agreement_version', 'final_comment', 'artist_deposit_pct', 'tattoo_color_type']) assert.ok(QUOTE_SELECT.split(',').includes(column), column);
        for (const column of ['client_health_conditions', 'client_allergies', 'client_whatsapp', 'client_instagram', 'client_birth_date']) assert.ok(!QUOTE_SELECT.includes(column), column);
        await NegotiationRepo.listProposals(7);
        assert.match(seen[3].url, /quotation_proposals\?select=.*&quotation_id=eq\.7&order=created_at\.desc&limit=30/);

        next = '[{"amount":"300.50","currency":"usd"},{"amount":200,"currency":"USD"},{"amount":999,"currency":"ARS"}]';
        assert.equal(await NegotiationRepo.paidTotal(7, 'USD'), 500.5);
        assert.equal(await NegotiationRepo.paidTotal(7, ''), 0);
        next = '[{"id":1,"status":"scheduled"},{"id":2,"status":"completed"},{"id":3,"status":"cancelled"},{"id":4,"status":"no_show"}]';
        assert.equal(await NegotiationRepo.activeSessions(7), 2);
        next = '[{"deposit_pct":"10.00","deposit_amount":"200.00","status":"sent"}]';
        assert.equal(await NegotiationRepo.manualDepositPct('COT-ABCD'), 10);
        next = '[{"deposit_pct":"30.00","deposit_amount":"0","status":"sent"}]';
        assert.equal(await NegotiationRepo.manualDepositPct('COT-ABCD'), null);
    } finally {
        if (prev.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prev.url;
        if (prev.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key;
        global.fetch = prev.fetch;
    }
});

// ---------------------------------------------------------------- emails
test('eventos de email: siete, solo servidor, con render por rol y CTA absoluto', () => {
    const ids = Object.keys(EVENTS).sort();
    assert.deepEqual(ids, [
        'negotiation_amendment_accepted', 'negotiation_amendment_proposed', 'negotiation_amendment_rejected',
        'negotiation_counter_accepted', 'negotiation_counter_declined', 'negotiation_counter_proposed',
        'negotiation_proposal_withdrawn',
    ]);
    const used = new Set([...Object.values(logic.EVENTS.counter), ...Object.values(logic.EVENTS.amendment)]);
    assert.deepEqual([...used].sort(), ids);
    for (const id of ids) {
        assert.equal(mapping.EXTENSION_SOURCES[id], 'negociacion.js', id);
        assert.ok(SERVER_ONLY_EVENTS.has(id), `${id} solo servidor`);
        assert.equal(EVENTS[id].recipient({ recipient_email: 'a@x.com', client_email: 'c@x.com' }), 'a@x.com');
        assert.equal(EVENTS[id].recipient({}), null);
        assert.equal(EVENTS[id].render.category, 'quotations');
    }
});

test('render: textos por rol, filas antes → después, escape y preheader', () => {
    const ATTACK = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
    const mail = logic.emailFor({
        step: 'proposed', base: 'https://beta.weotzi.com',
        proposal: proposalRow({ note: `Hola ${ATTACK}`, changes: { artist_budget_amount: { from: '2000', to: '1800' }, tattoo_body_part: { from: 'Antebrazo', to: `Hombro ${ATTACK}` } } }),
        quotation: quote({ client_full_name: `Lucía ${ATTACK}` }), artist: { name: 'Mateo Rivas', email: 'mateo@example.com' },
    });
    const out = renderEmail(mail.eventId, mail.payload, { role: mail.payload.recipient_role });
    assert.equal(out.role, 'artist');
    assert.match(out.subject, /propone cambios en la cotización WO-7/);
    assert.match(out.html, /Tu cliente propone cambios\./);
    assert.match(out.html, /2\.000 USD → 1\.800 USD/);
    assert.match(out.html, /Mensaje del cliente/);
    assert.equal(out.cta.url, 'https://beta.weotzi.com/my-quotations/detail?quote=WO-7');
    assert.doesNotMatch(out.html, /<script>alert|<img src=x/);
    assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110);
    assert.match(out.headers['List-Unsubscribe'], /\/artist\/account#notificaciones/);
    // EP-10: el pie compartido no conjuga (el cuerpo va en tuteo; "Recibís" era voseo).
    assert.equal(mail.eventId, 'negotiation_counter_proposed');
    assert.match(out.text, /Este aviso te llega por tu actividad en We Ötzi\./);
    assert.doesNotMatch(`${out.text} ${out.html}`, /Recib[ií]s/);

    // Enmienda: el mismo evento cambia de panel según quién recibe.
    const amendment = proposalRow({ kind: 'amendment', proposed_by: 'client', changes: { final_budget_amount: { from: '2000', to: '2500' } } });
    const toArtist = logic.emailFor({ step: 'proposed', proposal: amendment, quotation: agreed(), artist: { name: 'Mateo Rivas', email: 'mateo@example.com' }, base: 'https://beta.weotzi.com' });
    const a = renderEmail(toArtist.eventId, toArtist.payload, { role: 'artist' });
    assert.match(a.subject, /^Lucía propone cambiar el acuerdo · WO-7$/);
    assert.match(a.cta.url, /\/my-quotations\/detail\?quote=WO-7$/);
    assert.match(a.html, /No rigen hasta que los apruebes/);
    // Sin enlace en el payload (o con uno inválido) el CTA cae al panel del rol.
    const c = renderEmail('negotiation_amendment_accepted', { ...toArtist.payload, quotation_url: 'javascript:alert(1)', recipient_role: 'client', actor_role: 'artist', actor_name: '' }, { role: 'client' });
    assert.equal(c.cta.url, 'https://beta.weotzi.com/client/dashboard?quote=WO-7');
    assert.match(c.subject, /^Tu artista aprobó los cambios al acuerdo/);
    for (const id of Object.keys(EVENTS)) {
        const text = [EVENTS[id].render.headline({}), EVENTS[id].render.intro({}), EVENTS[id].render.preheader({})].join(' ');
        assert.doesNotMatch(text, /undefined|null/, id);
        const len = EVENTS[id].render.preheader({}).length;
        assert.ok(len >= 40 && len <= 110, `${id}: preheader de ${len}`);
    }
});

test('el comprobante del rechazo ya no promete una propuesta nueva (la cotización queda finalizada)', () => {
    const receipt = require('../services/email-events/cot-cliente').client_quotation_rejected_receipt.render;
    const intro = receipt.intro({ artist_name: 'Mateo' });
    assert.match(intro, /quedó finalizada/);
    assert.match(intro, /inicia una cotización nueva/);
    assert.doesNotMatch(intro + receipt.preheader({}), /propuesta nueva|escribile|Podés/);
});

// ---------------------------------------------------------------- migración
test('migración: tabla, RLS, funciones solo para service_role, triggers propios y chat cerrado', () => {
    const name = '20261116140000_negociacion_propuestas';
    assert.ok(Number(name.slice(0, 14)) >= 20261116140000 && Number(name.slice(0, 14)) <= 20261116140999);
    const sql = read(`supabase/migrations/${name}.sql`);
    const down = read(`supabase/rollbacks/${name}.down.sql`);

    // P4-saldo: el sello del acuerdo.
    assert.match(sql, /add column if not exists agreement_approved_at timestamptz/);
    assert.match(sql, /add column if not exists agreement_version integer not null default 0/);
    // Propuestas: una sola pendiente, solo lectura para las partes.
    assert.match(sql, /create table if not exists public\.quotation_proposals/);
    assert.match(sql, /check \(status in \('pending', 'accepted', 'rejected', 'superseded', 'withdrawn'\)\)/);
    assert.match(sql, /create unique index if not exists quotation_proposals_one_pending_idx\s+on public\.quotation_proposals \(quotation_id\) where status = 'pending'/);
    assert.match(sql, /alter table public\.quotation_proposals enable row level security/);
    assert.match(sql, /revoke all on table public\.quotation_proposals from public, anon, authenticated;\ngrant select on table public\.quotation_proposals to authenticated;/);
    assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*quotation_proposals to (anon|authenticated)/);
    // Funciones atómicas: security definer, sin acceso para anon/authenticated.
    for (const fn of ['negociacion_propose(integer, uuid, text, text, jsonb, text)', 'negociacion_resolve(uuid, uuid, text, text)']) {
        assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
        assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
    }
    assert.equal((sql.match(/^security definer$/gm) || []).length, 4, 'sync, deposit_pct, propose y resolve');
    assert.doesNotMatch(sql, /grant execute[^;]*to (anon|authenticated|public)/);
    assert.match(sql, /select \* into v_q from public\.quotations_db where id = p_quotation_id for update/);
    // Chat cerrado tras el rechazo (P23), en la base.
    assert.match(sql, /create policy chat_closed_after_client_rejection\s+on public\.chat_messages\s+as restrictive\s+for insert/);
    // CF-05: cerrado para los dos (si no, el cliente le escribe a un artista que no puede responder).
    assert.match(sql, /q\.quote_status = 'client_rejected'\s+and \(q\.artist_id = \(select auth\.uid\(\)\) or q\.client_user_id = \(select auth\.uid\(\)\)\)/);
    // CF-12: una zona nueva escrita por el cliente deja sin efecto el lado anterior,
    // tanto al aceptar la contrapropuesta como cuando el artista responde con otra propuesta.
    assert.match(sql, /tattoo_body_side = case when v_p\.changes \? 'tattoo_body_part'\s+then null else q\.tattoo_body_side end,/);
    assert.match(sql, /new\.tattoo_body_part := v_p\.changes #>> '\{tattoo_body_part,to\}';\s+(?:--[^\n]*\s+)*if new\.tattoo_body_side is not distinct from old\.tattoo_body_side then\s+new\.tattoo_body_side := null;/);
    // Rechazo definitivo y acuerdo bloqueado para el usuario final.
    assert.match(sql, /old\.quote_status = 'client_rejected'/);
    // El servidor (service_role) tampoco la reabre en nombre del artista; soporte y postgres sí.
    assert.match(sql, /if old\.quote_status = 'client_rejected'\s+and current_user in \('anon', 'authenticated', 'service_role'\)\s+and not coalesce\(public\.is_support_user\(\), false\) then/);
    assert.match(sql, /El acuerdo ya está aprobado por ambas partes/);
    // SEG-04: con el acuerdo sellado y cliente con cuenta, el usuario final no vuelve a
    // pending / responded (ahí se borraba el sello y se podía reescribir el precio).
    assert.match(sql, /if v_restricted\s+and old\.agreement_approved_at is not null\s+and old\.client_user_id is not null\s+and new\.quote_status in \('pending', 'responded'\) then\s+raise exception 'El acuerdo ya está aprobado por ambas partes/);
    const guard = sql.slice(sql.indexOf('create or replace function public.negociacion_quotation_guard()'), sql.indexOf('revoke all on function public.negociacion_quotation_guard()'));
    assert.ok(guard.indexOf("new.quote_status in ('pending', 'responded') then\n      raise exception") < guard.indexOf('new.agreement_approved_at := null;'),
        'el bloqueo corre antes de borrar el sello');
    assert.match(sql, /and old\.agreement_approved_at is not null\s+and old\.client_user_id is not null/, 'sin cuenta del cliente no se bloquea la edición del artista');
    assert.match(sql, /if v_q\.client_user_id is null or v_q\.artist_id is null then\s+raise exception 'NEG_NO_COUNTERPARTY'/);
    // Triggers propios, después de los existentes; no pisa funciones de otros frentes.
    assert.match(sql, /create trigger trg_quotation_zy_negociacion_guard\s+before update on public\.quotations_db/);
    assert.match(sql, /create trigger trg_quotation_zz_negociacion_sync\s+before update on public\.quotations_db/);
    assert.ok('trg_quotation_status_change' < 'trg_quotation_zy_negociacion_guard' && 'trg_quotation_zy_negociacion_guard' < 'trg_quotation_zz_negociacion_sync');
    assert.doesNotMatch(sql, /create or replace function public\.(fn_quotation_status_change|fn_quotations_client_column_guard|chat_messages_before_insert)/);
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /^commit;$/m);

    // Reversa completa.
    for (const piece of ['drop policy if exists chat_closed_after_client_rejection', 'drop trigger if exists trg_quotation_zz_negociacion_sync', 'drop trigger if exists trg_quotation_zy_negociacion_guard',
        'drop function if exists public.negociacion_resolve(uuid, uuid, text, text)', 'drop function if exists public.negociacion_propose(integer, uuid, text, text, jsonb, text)',
        'drop function if exists public.negociacion_deposit_pct(public.quotations_db)', 'drop function if exists public.negociacion_quotation_sync()', 'drop function if exists public.negociacion_quotation_guard()',
        'drop table if exists public.quotation_proposals', 'drop column if exists agreement_version', 'drop column if exists agreement_approved_at']) {
        assert.ok(down.includes(piece), piece);
    }
});

test('la base y el modelo validan lo mismo (campos y límites)', () => {
    const sql = read('supabase/migrations/20261116140000_negociacion_propuestas.sql');
    const list = (re) => re.exec(sql)[1].replace(/\s+/g, '').replace(/'/g, '').split(',');
    assert.deepEqual(list(/v_allowed := array\[('artist_budget_amount'[^\]]+)\]/), M.COUNTER_FIELDS);
    assert.deepEqual(list(/v_allowed := array\[('final_budget_amount'[^\]]+)\]/), M.AMENDMENT_FIELDS);
    assert.match(sql, new RegExp(`when 'tattoo_idea_description' then ${M.LIMITS.tattoo_idea_description[0]} when 'tattoo_body_part' then ${M.LIMITS.tattoo_body_part[0]} else ${M.LIMITS.tattoo_size[0]} end`));
    assert.match(sql, new RegExp(`when 'tattoo_idea_description' then ${M.LIMITS.tattoo_idea_description[1]}\\s+when 'tattoo_body_part' then ${M.LIMITS.tattoo_body_part[1]}\\s+when 'tattoo_size' then ${M.LIMITS.tattoo_size[1]}\\s+else ${M.LIMITS.tattoo_color_type[1]} end`));
    assert.match(sql, new RegExp(`v_int < ${M.LIMITS.sessionsMin} or v_int > ${M.LIMITS.sessionsMax}`));
    assert.match(sql, new RegExp(`char_length\\(coalesce\\(v_text, ''\\)\\) > ${M.LIMITS.final_comment}`));
    assert.match(sql, new RegExp(`not between 1 and ${M.LIMITS.stylesMax}`));
    assert.match(sql, new RegExp(`not between 1 and ${M.LIMITS.styleMax}`));
    assert.match(sql, new RegExp(`left\\(nullif\\(btrim\\(coalesce\\(p_note, ''\\)\\), ''\\), ${M.LIMITS.note}\\)`));
    assert.equal(String(M.LIMITS.amountMax).length, 10, 'la base acepta hasta 10 dígitos enteros');
    // Todos los códigos que levanta la base tienen mensaje en el servidor.
    const codes = new Set(sql.match(/NEG_[A-Z_]+/g));
    for (const code of codes) {
        const mapped = logic.dbError(new Error(`{"message":"${code}"}`));
        assert.equal(mapped.known, true, code);
        assert.notEqual(mapped.status, 500, code);
    }
});

test('documentación del frente y lista de imágenes pendientes', () => {
    const doc = read('docs/NEGOCIACION_COTIZACION.md');
    for (const piece of ['agreement_approved_at', 'quotation_proposals', 'chat_closed_after_client_rejection', 'wo:quote-respond', 'wo:negotiation-changed', '/api/negociacion/quotations/']) {
        assert.ok(doc.includes(piece), piece);
    }
    assert.deepEqual(JSON.parse(read('docs/plans/ronda2-assets/negociacion.json')), []);
});

test('REQ-13: con una contrapropuesta del cliente pendiente, el artista no registra el acuerdo por su cuenta', () => {
    const sql = read('supabase/migrations/20261116140000_negociacion_propuestas.sql');
    const guard = sql.slice(sql.indexOf('create or replace function public.negociacion_quotation_guard()'), sql.indexOf('revoke all on function public.negociacion_quotation_guard()'));
    const rule = /if v_restricted\s+and old\.quote_status = 'responded'\s+and new\.quote_status = 'client_approved' then\s+if \(select auth\.uid\(\)\) = old\.artist_id then\s+if exists \(\s+select 1 from public\.quotation_proposals p\s+where p\.quotation_id = new\.id and p\.kind = 'counter' and p\.status = 'pending'\s+\) then\s+raise exception 'El cliente propuso cambios: acéptalos, envía otra propuesta o mantén la tuya antes de registrar el acuerdo\.'\s+using errcode = '42501';/;
    assert.match(guard, rule);
    // Va antes del sello: si se rechaza, la cotización no queda "aprobada por ambas partes".
    assert.ok(guard.search(rule) < guard.indexOf("new.agreement_approved_at := coalesce(new.agreement_approved_at, now());"));
    // El guardia corre con los derechos de quien escribe: el artista lee las propuestas de sus cotizaciones.
    assert.doesNotMatch(guard, /security definer/);
    assert.match(sql, /q\.client_user_id = \(select auth\.uid\(\)\) or q\.artist_id = \(select auth\.uid\(\)\)/);
    // El servidor (aceptar la contrapropuesta, o el cliente que acepta la propuesta original) no pasa por la regla:
    // negociacion_resolve cierra la propuesta antes de cambiar el estado.
    const resolve = sql.slice(sql.indexOf('create or replace function public.negociacion_resolve('));
    assert.ok(resolve.indexOf("set status = 'accepted', resolved_by = p_actor") < resolve.indexOf("quote_status = 'client_approved'"));
    // El mensaje es el mismo que muestra el expediente antes de abrir el diálogo.
    assert.match(read('public/shared/js/quotation-detail-figma.js'), /const COUNTER_PENDING_MESSAGE = 'El cliente propuso cambios: acéptalos, envía otra propuesta o mantén la tuya antes de registrar el acuerdo\.';/);
    assert.match(read('docs/NEGOCIACION_COTIZACION.md'), /REQ-13/);
});
