'use strict';
// Frente cot-cliente (beta cerrada): vínculo de cotizaciones de invitado y
// decisión del cliente sobre la propuesta del artista (CC-01 / CC-02 / ACC-12).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const logic = require('../lib/cot-cliente');
const { createHandlers, register, ARTIST_EVENT, CLIENT_EVENT } = require('../lib/routes/cot-cliente');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NOW = Date.parse('2026-11-15T12:00:00Z');
const verifiedUser = (over = {}) => ({
    id: 'user-1', email: 'Cliente@Example.com',
    raw: { email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: {}, user_metadata: {} }, ...over,
});
const responded = (over = {}) => ({
    id: 7, quote_id: 'WO-7', quote_status: 'responded', client_user_id: 'user-1', client_email: 'cliente@example.com',
    client_full_name: 'Cli', artist_id: 'artist-1', artist_name: 'Lau', artist_email: 'lau@example.com',
    artist_budget_amount: '410000', artist_budget_currency: 'ARS', tattoo_estimated_sessions: '2',
    artist_responded_at: '2026-11-10T00:00:00Z', quote_expires_at: null, dispute_status: 'none',
    tattoo_style: [{ style_name: 'Fine line' }], ...over,
});

// ---------------------------------------------------------------- lógica pura
test('borrador del cotizador = in_progress sin respuesta ni presupuesto', () => {
    assert.equal(logic.isWizardDraft({ quote_status: 'in_progress' }), true);
    assert.equal(logic.isWizardDraft({ quote_status: 'in_progress', artist_responded_at: '2026-01-01' }), false);
    assert.equal(logic.isWizardDraft({ quote_status: 'in_progress', final_budget_amount: '100' }), false);
    assert.equal(logic.isWizardDraft({ quote_status: 'pending' }), false);
});

test('email verificado: confirmado y sin marca de QA (app o user metadata)', () => {
    assert.equal(logic.isEmailVerified(verifiedUser()), true);
    assert.equal(logic.isEmailVerified(verifiedUser({ raw: { email_confirmed_at: null } })), false);
    assert.equal(logic.isEmailVerified(verifiedUser({ raw: { email_confirmed_at: 'x', app_metadata: { qa_unverified_email: true } } })), false);
    assert.equal(logic.isEmailVerified(verifiedUser({ raw: { email_confirmed_at: 'x', user_metadata: { qa_unverified_email: 'true' } } })), false);
    assert.equal(logic.isEmailVerified(null), false);
});

test('claim: solo igualdad exacta de email, sin dueño y sin borradores', () => {
    const rows = [
        { id: 1, client_email: ' CLIENTE@example.com ', client_user_id: null, quote_status: 'pending' },
        { id: 2, client_email: 'xcliente@example.com', client_user_id: null, quote_status: 'pending' },
        { id: 3, client_email: 'cliente@example.com', client_user_id: 'otro', quote_status: 'responded' },
        { id: 4, client_email: 'cliente@example.com', client_user_id: null, quote_status: 'in_progress' },
        { id: 5, client_email: 'cliente@example.com', client_user_id: null, quote_status: 'in_progress', artist_responded_at: '2026-01-01' },
    ];
    assert.deepEqual(logic.filterClaimable(rows, verifiedUser()).map((r) => r.id), [1, 5]);
    assert.deepEqual(logic.filterClaimable(rows, verifiedUser({ raw: { email_confirmed_at: null } })), []);
});

test('escapeLike neutraliza los comodines de LIKE', () => {
    assert.equal(logic.escapeLike('a_b%c\\d@x.com'), 'a\\_b\\%c\\\\d@x.com');
});

test('evaluateDecision: dueño, reclamo por email, estado, disputa y vencimiento', () => {
    const user = verifiedUser();
    assert.equal(logic.evaluateDecision({ user: null, quotation: responded(), decision: 'approve', now: NOW }).status, 401);
    assert.equal(logic.evaluateDecision({ user, quotation: null, decision: 'approve', now: NOW }).status, 404);
    assert.equal(logic.evaluateDecision({ user, quotation: responded({ client_user_id: 'otro' }), decision: 'approve', now: NOW }).status, 403);
    assert.equal(logic.evaluateDecision({ user, quotation: responded({ client_user_id: null, client_email: 'otra@example.com' }), decision: 'approve', now: NOW }).status, 403);
    const claim = logic.evaluateDecision({ user, quotation: responded({ client_user_id: null }), decision: 'approve', now: NOW });
    assert.deepEqual([claim.ok, claim.claim, claim.targetStatus], [true, true, 'client_approved']);
    const pending = logic.evaluateDecision({ user, quotation: responded({ quote_status: 'pending' }), decision: 'approve', now: NOW });
    assert.equal(pending.status, 409);
    assert.match(pending.error, /todavía no te mandó/);
    assert.equal(logic.evaluateDecision({ user, quotation: responded({ dispute_status: 'open' }), decision: 'approve', now: NOW }).code, 'dispute');
    const expired = logic.evaluateDecision({ user, quotation: responded({ quote_expires_at: '2026-11-14T00:00:00Z' }), decision: 'reject', now: NOW });
    assert.equal(expired.status, 410);
    assert.equal(logic.evaluateDecision({ user, quotation: responded({ quote_expires_at: '2026-11-20T00:00:00Z' }), decision: 'reject', now: NOW }).ok, true);
    const again = logic.evaluateDecision({ user, quotation: responded({ quote_status: 'client_approved' }), decision: 'approve', now: NOW });
    assert.equal(again.already, true);
    // Aceptar algo ya rechazado no está permitido (el artista tiene que reenviar).
    assert.equal(logic.evaluateDecision({ user, quotation: responded({ quote_status: 'client_rejected' }), decision: 'approve', now: NOW }).status, 409);
});

test('decisionPatch: aceptar convierte la propuesta en acuerdo sin pisar uno existente', () => {
    assert.deepEqual(logic.decisionPatch(responded(), 'approve'), {
        quote_status: 'client_approved', final_budget_amount: '410000', final_budget_currency: 'ARS', final_sessions: '2',
    });
    assert.deepEqual(logic.decisionPatch(responded({ final_budget_amount: '500', final_sessions: '3' }), 'approve'), { quote_status: 'client_approved' });
    assert.deepEqual(logic.decisionPatch(responded(), 'reject'), { quote_status: 'client_rejected' });
});

test('normalizeDecisionBody valida la decisión y recorta el motivo', () => {
    assert.equal(logic.normalizeDecisionBody({}).status, 400);
    assert.equal(logic.normalizeDecisionBody({ decision: 'approve', reason: 'x' }).reason, '');
    const r = logic.normalizeDecisionBody({ decision: 'REJECT', reason: '  muy   caro  ' + 'a'.repeat(600) });
    assert.equal(r.decision, 'reject');
    assert.ok(r.reason.startsWith('muy caro'));
    assert.equal(r.reason.length, logic.MAX_REASON);
});

test('payloads de email: enlaces desde la base de la app y destinatarios guardados', () => {
    const out = logic.decisionEmailPayloads({ quotation: responded(), decision: 'approve', reason: '', base: 'https://beta.weotzi.com', artist: { name: 'Lau Ink', email: 'lau@ink.com' } });
    assert.equal(out.artist.artist_email, 'lau@ink.com');
    assert.equal(out.artist.quotation_url, 'https://beta.weotzi.com/my-quotations/detail?quote=WO-7');
    assert.equal(out.client.client_email, 'cliente@example.com');
    assert.equal(out.client.quotation_url, 'https://beta.weotzi.com/client/dashboard?quote=WO-7');
    assert.equal(out.client.budget_text, '410000 ARS');
    assert.equal(out.client.tattoo_style, 'Fine line');
});

// ---------------------------------------------------------------- rutas
function fakeRes() {
    return {
        statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}
const quietLogger = { log() {}, warn() {}, error() {} };

function deps(over = {}) {
    const calls = { claimIds: [], decide: [], emails: [], history: [] };
    const d = {
        resolveBearerUser: async () => verifiedUser(),
        applicationBase: () => 'https://beta.weotzi.com',
        logger: quietLogger,
        now: () => NOW,
        emailService: { async sendEmail(eventId, payload, opts) { calls.emails.push({ eventId, payload, opts }); return { ok: true }; } },
        repo: {
            async listUnclaimedByEmail() { return []; },
            async claimIds(ids, userId) { calls.claimIds.push({ ids, userId }); return ids.map((id) => ({ id, quote_id: `WO-${id}` })); },
            async getForDecision() { return responded(); },
            async decide(id, patch, opts) { calls.decide.push({ id, patch, opts }); return { ...responded(), ...patch }; },
            async annotateHistory(...args) { calls.history.push(args); },
            async getArtist() { return { name: 'Lau', email: 'lau@example.com' }; },
            async listScheduledSessions() { return [{ id: 's1', status: 'scheduled' }]; },
        },
        ...over,
    };
    return { d, calls };
}

test('POST /claim: 401 sin sesión, 403 sin email verificado, vincula solo coincidencias exactas', async () => {
    let { d } = deps({ resolveBearerUser: async () => null });
    let res = fakeRes();
    await createHandlers(d).claim({}, res);
    assert.equal(res.statusCode, 401);

    ({ d } = deps({ resolveBearerUser: async () => verifiedUser({ raw: { email_confirmed_at: null } }) }));
    res = fakeRes();
    await createHandlers(d).claim({}, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'email_unverified');

    const built = deps();
    built.d.repo.listUnclaimedByEmail = async (email) => {
        assert.equal(email, 'Cliente@Example.com');
        return [
            { id: 1, client_email: 'cliente@example.com', client_user_id: null, quote_status: 'pending' },
            { id: 2, client_email: 'otro.cliente@example.com', client_user_id: null, quote_status: 'pending' },
            { id: 3, client_email: 'cliente@example.com', client_user_id: null, quote_status: 'in_progress' },
        ];
    };
    res = fakeRes();
    await createHandlers(built.d).claim({}, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(built.calls.claimIds, [{ ids: [1], userId: 'user-1' }]);
    assert.deepEqual(res.body, { success: true, linked: 1, quote_ids: ['WO-1'] });
});

test('POST /decision: aceptar guarda con guardia, avisa a ambas partes y dispara el hook', async () => {
    const { d, calls } = deps();
    const seen = [];
    const off = logic.onClientDecision((evt) => { seen.push(evt); });
    try {
        const res = fakeRes();
        await createHandlers(d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'approve' } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.quote_status, 'client_approved');
        assert.deepEqual(calls.decide[0].opts, { userId: 'user-1', claim: false });
        assert.equal(calls.decide[0].patch.final_budget_amount, '410000');
        assert.deepEqual(calls.emails.map((e) => e.eventId), [ARTIST_EVENT.approve, CLIENT_EVENT.approve]);
        assert.equal(calls.emails[0].payload.artist_email, 'lau@example.com');
        assert.equal(calls.emails[1].payload.client_email, 'cliente@example.com');
        assert.equal(calls.emails[0].opts.idempotencyKey, 'cot-cliente:decision:WO-7:client_approved:2026-11-10T00:00:00Z:artist');
        assert.equal(calls.emails[1].opts.idempotencyKey, 'cot-cliente:decision:WO-7:client_approved:2026-11-10T00:00:00Z:client');
        assert.equal(calls.history[0][1], 'client_approved');
        assert.equal(calls.history[0][3].changedBy, 'user-1');
        assert.equal(seen.length, 1);
        assert.equal(seen[0].decision, 'approve');
        assert.deepEqual(seen[0].sessions, [{ id: 's1', status: 'scheduled' }]);
    } finally { off(); }
});

test('POST /decision: rechazar guarda el motivo en el historial, un hook que falla no rompe', async () => {
    const { d, calls } = deps();
    const off = logic.onClientDecision(() => { throw new Error('turnos caído'); });
    try {
        const res = fakeRes();
        await createHandlers(d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'reject', reason: 'Muy caro' } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls.decide[0].patch, { quote_status: 'client_rejected' });
        assert.equal(calls.history[0][3].notes, 'Motivo del cliente: Muy caro');
        assert.deepEqual(calls.emails.map((e) => e.eventId), [ARTIST_EVENT.reject, CLIENT_EVENT.reject]);
        assert.equal(calls.emails[0].payload.decision_reason, 'Muy caro');
    } finally { off(); }
});

test('POST /decision: carrera, ajena, vencida, sin quote e idempotente', async () => {
    let built = deps();
    built.d.repo.decide = async () => null;
    let res = fakeRes();
    await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'approve' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'race');
    assert.equal(built.calls.emails.length, 0);

    built = deps();
    built.d.repo.getForDecision = async () => responded({ client_user_id: 'otro' });
    res = fakeRes();
    await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'approve' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(built.calls.decide.length, 0);

    built = deps();
    built.d.repo.getForDecision = async () => responded({ quote_expires_at: '2026-11-01T00:00:00Z' });
    res = fakeRes();
    await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'approve' } }, res);
    assert.equal(res.statusCode, 410);

    built = deps();
    built.d.repo.getForDecision = async () => responded({ quote_status: 'client_approved' });
    res = fakeRes();
    await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'approve' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.already, true);
    assert.equal(built.calls.emails.length, 0);

    built = deps();
    res = fakeRes();
    await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'quizas' } }, res);
    assert.equal(res.statusCode, 400);

    built = deps();
    built.d.repo.getForDecision = async () => responded({ client_user_id: null });
    res = fakeRes();
    await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'approve' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.claimed, true);
    assert.deepEqual(built.calls.decide[0].opts, { userId: 'user-1', claim: true });
});

test('register monta las dos rutas y server.js lo registra con una línea', () => {
    const routes = [];
    register({ post(p) { routes.push(p); } }, deps().d);
    assert.deepEqual(routes, ['/api/client/quotations/claim', '/api/client/quotations/:quoteId/decision']);
    assert.match(read('server.js'), /require\('\.\/lib\/routes\/cot-cliente'\)\.register\(app\)/);
});

test('repo de servidor usa la capa PostgREST con guardias de carrera', () => {
    const repo = read('lib/repos/client-quotations.js');
    assert.match(repo, /require\('\.\.\/postgrest'\)/);
    assert.match(repo, /\.eq\('quote_status', 'responded'\)/);
    assert.match(repo, /\.is\('client_user_id', null\)/);
    assert.doesNotMatch(repo, /fetch\(/);
});

// ---------------------------------------------------------------- emails
test('eventos de email del frente: comprobantes al cliente, solo servidor, con render', () => {
    const events = require('../services/email-events/cot-cliente');
    for (const id of Object.values(CLIENT_EVENT)) {
        const ev = events[id];
        assert.ok(ev, id);
        assert.equal(ev.serverOnly, true);
        assert.equal(ev.recipient({ client_email: 'c@x.com', artist_email: 'a@x.com' }), 'c@x.com');
        assert.equal(ev.render.audience, 'client');
        assert.equal(ev.render.category, 'quotations');
        const d = { quote_id: 'WO-7', artist_name: 'Lau', budget_text: '410.000 ARS', quotation_url: 'https://beta.weotzi.com/client/dashboard?quote=WO-7', decision_reason: 'Caro' };
        for (const k of ['subject', 'preheader', 'headline', 'intro']) assert.equal(typeof ev.render[k](d), 'string');
        assert.ok(Array.isArray(ev.render.rows(d)));
        assert.deepEqual(ev.render.cta(d), { label: 'Ver la cotización', url: d.quotation_url });
        assert.doesNotMatch(JSON.stringify(ev.render.rows(d)), /undefined/);
    }
    const mapping = require('../services/email-event-mapping');
    for (const id of Object.values(ARTIST_EVENT)) {
        assert.equal(mapping.EVENTS[id].recipient({ artist_email: 'a@x.com', client_email: 'c@x.com' }), 'a@x.com');
    }
});

test('el email artist_responded lleva al cliente a su propuesta (?quote=ID)', () => {
    const { withLinks } = require('../services/email-request-context');
    assert.equal(withLinks({ quote_id: 'WO 7' }, 'https://beta.weotzi.com', 'client').quotation_url, 'https://beta.weotzi.com/client/dashboard?quote=WO%207');
    assert.equal(withLinks({}, 'https://beta.weotzi.com', 'client').quotation_url, 'https://beta.weotzi.com/client/dashboard');
    assert.match(read('templates/email/billionmail/artist-responded.html'), /href="\{\{quotation_url\}\}"/);
    assert.match(read('templates/email/artist-responded.min.html'), /\{\{quotation_url\}\}/);
});

// ---------------------------------------------------------------- migración
test('migración 20261115140000: vínculo al confirmar el email, sin borradores, idempotente y con reversa', () => {
    const sql = read('supabase/migrations/20261115140000_cot_cliente_vinculo_al_confirmar.sql');
    assert.match(sql, /create or replace function public\.link_client_quotations_on_email_confirm\(\)/);
    assert.match(sql, /security definer/);
    assert.match(sql, /drop trigger if exists on_email_confirmed_link_client_quotations on auth\.users/);
    assert.match(sql, /after update of email_confirmed_at on auth\.users/);
    assert.match(sql, /when \(old\.email_confirmed_at is null and new\.email_confirmed_at is not null\)/);
    assert.match(sql, /qa_unverified_email/);
    assert.match(sql, /not public\.cot_cliente_is_wizard_draft/);
    assert.match(sql, /set email_verified = true/);
    assert.match(sql, /revoke all on function public\.link_client_quotations_on_email_confirm\(\) from anon, authenticated/);
    // No toca funciones de otros frentes.
    assert.doesNotMatch(sql, /function public\.(handle_new_user|sync_email_confirmed)/);
    const down = read('supabase/rollbacks/20261115140000_cot_cliente_vinculo_al_confirmar.down.sql');
    assert.match(down, /drop trigger if exists on_email_confirmed_link_client_quotations on auth\.users/);
    assert.match(down, /drop function if exists public\.link_client_quotations_on_email_confirm\(\)/);
});

// ---------------------------------------------------------------- revisión
test('revisión: doble clic gana la carrera con la misma decisión → idempotente, sin emails', async () => {
    const built = deps();
    let reads = 0;
    built.d.repo.getForDecision = async () => (reads++ === 0 ? responded() : responded({ quote_status: 'client_approved' }));
    built.d.repo.decide = async () => null;
    const res = fakeRes();
    await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'approve' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.already, true);
    assert.equal(built.calls.emails.length, 0);
});

test('revisión: la clave de idempotencia cambia con cada propuesta nueva del artista', async () => {
    const keys = [];
    for (const at of ['2026-11-10T00:00:00Z', '2026-11-12T09:30:00Z']) {
        const built = deps();
        built.d.repo.getForDecision = async () => responded({ artist_responded_at: at });
        built.d.repo.decide = async (id, patch) => ({ ...responded({ artist_responded_at: at }), ...patch });
        await createHandlers(built.d).decision({ params: { quoteId: 'WO-7' }, body: { decision: 'reject' } }, fakeRes());
        keys.push(built.calls.emails[0].opts.idempotencyKey);
    }
    assert.notEqual(keys[0], keys[1]);
});

test('revisión: cotización de invitado con el mismo email pero sin confirmar → 403 email_unverified', () => {
    const unverified = verifiedUser({ raw: { email_confirmed_at: null } });
    const out = logic.evaluateDecision({ user: unverified, quotation: responded({ client_user_id: null }), decision: 'approve', now: NOW });
    assert.equal(out.status, 403);
    assert.equal(out.code, 'email_unverified');
    const other = logic.evaluateDecision({ user: unverified, quotation: responded({ client_user_id: null, client_email: 'x@y.com' }), decision: 'approve', now: NOW });
    assert.equal(other.code, 'not_owner');
});
