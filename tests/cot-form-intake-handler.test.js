'use strict';
// Frente cot-form · POST /api/quotations/intake de punta a punta con fetch
// simulado (PostgREST + Auth). Sin red ni base real.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://demo.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const intake = require('../services/quotation-intake');

const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const QID = intake.deriveQuoteId(KEY);
const ARTIST_ID = '11111111-2222-4333-8444-555555555555';

function json(status, body) {
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
        text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body };
}

function installFetch({ existing = null, authOk = true, rpcStatus = 'pending', rpcFail = false } = {}) {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        const method = opts.method || 'GET';
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url: u, method, body });
        if (u.endsWith('/auth/v1/user')) return authOk ? json(200, { id: 'user-1', email: 'qa@example.test' }) : json(401, { msg: 'expired' });
        if (u.includes('/rest/v1/artists_db')) return json(200, [{ user_id: ARTIST_ID, username: 'ana', name: 'Ana', email: 'ana@example.test', registration_status: 'pendiente de validacion' }]);
        if (u.includes('/rest/v1/rpc/save_web_quotation')) {
            if (rpcFail) return json(400, { code: '23514', message: 'violates check constraint' });
            return json(200, { quote_id: QID, status: rpcStatus });
        }
        if (u.includes('/rest/v1/quotations_db') && method === 'GET') return json(200, existing ? [existing] : []);
        if (method === 'PATCH' || method === 'DELETE') return json(204);
        if (method === 'POST') return json(201);
        return json(404, {});
    };
    return calls;
}

function res() {
    return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const submitBody = (extra = {}) => ({
    submission_key: KEY, mode: 'submit',
    quotation: { artist_id: ARTIST_ID, client_full_name: 'QA', client_email: 'qa@example.test', tattoo_idea_description: 'Idea',
        tattoo_style: { style_name: 'Fine Line' }, tattoo_body_part: 'Brazo', tattoo_size: 'Mediano' },
    references: [`${QID}/ref_1_1731600000000.jpg`],
    ...extra
});

test('envío: guarda, registra referencias (reference_images + adjuntos) y dispara avisos una vez', async () => {
    const calls = installFetch({ existing: { quote_id: QID, quote_status: 'in_progress', client_user_id: null } });
    const hooked = [];
    intake.hooks.afterSubmit = async (ctx) => hooked.push(ctx.quoteId);
    const r = res();
    await intake.handleIntake({ headers: {}, body: submitBody() }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'pending');
    assert.equal(r.body.references_saved, true);
    const rpc = calls.find((c) => c.url.includes('save_web_quotation'));
    assert.equal(rpc.body.p_quote.artist_id, ARTIST_ID);
    assert.equal(rpc.body.p_quote.quote_status, 'pending');
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('quotations_db'));
    assert.deepEqual(patch.body.reference_images, [`https://demo.supabase.test/storage/v1/object/public/quotation-references/${QID}/ref_1_1731600000000.jpg`]);
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('quotations_attachments') && c.url.includes('google_drive_id=is.null')));
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('quotations_attachments'));
    assert.equal(insert.body[0].quotation_id, QID);
    await new Promise((r2) => setImmediate(r2));
    assert.deepEqual(hooked, [QID]);
});

test('reintento del mismo envío (ya pending): no repite los avisos', async () => {
    installFetch({ existing: { quote_id: QID, quote_status: 'pending' } });
    const hooked = [];
    intake.hooks.afterSubmit = async (ctx) => hooked.push(ctx.quoteId);
    const r = res();
    await intake.handleIntake({ headers: {}, body: submitBody() }, r);
    assert.equal(r.statusCode, 200);
    await new Promise((r2) => setImmediate(r2));
    assert.deepEqual(hooked, []);
});

test('sesión vencida: guarda como anónima y avisa (sin 401)', async () => {
    const calls = installFetch({ authOk: false });
    intake.hooks.afterSubmit = null;
    const r = res();
    await intake.handleIntake({ headers: { authorization: 'Bearer viejo' }, body: { ...submitBody(), mode: 'draft' } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.session_expired, true);
    const rpc = calls.find((c) => c.url.includes('save_web_quotation'));
    assert.equal(rpc.body.p_quote.client_user_id, null);
});

test('un autosave sin sesión no desvincula la cuenta que ya reclamó la cotización', async () => {
    const calls = installFetch({ existing: { quote_id: QID, quote_status: 'in_progress', client_user_id: 'cuenta-1', client_email: 'qa@example.test' } });
    const r = res();
    await intake.handleIntake({ headers: {}, body: { ...submitBody(), mode: 'draft' } }, r);
    const rpc = calls.find((c) => c.url.includes('save_web_quotation'));
    assert.equal(rpc.body.p_quote.client_user_id, 'cuenta-1');
});

test('sin artista el envío responde 409 needs_destination y no toca la base', async () => {
    const calls = installFetch();
    const body = submitBody();
    delete body.quotation.artist_id;
    const r = res();
    await intake.handleIntake({ headers: {}, body }, r);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.needs_destination, true);
    assert.ok(!calls.some((c) => c.url.includes('save_web_quotation')));
});

test('error de la base: 502 con mensaje claro (sin romper si el cuerpo no es JSON)', async () => {
    installFetch({ rpcFail: true });
    const r = res();
    await intake.handleIntake({ headers: {}, body: { ...submitBody(), mode: 'draft' } }, r);
    assert.equal(r.statusCode, 502);
    assert.match(r.body.error, /No pudimos guardar/);
});

test('borrador ya publicado en el Job Board: el envío responde 409', async () => {
    installFetch({ existing: { quote_id: QID, quote_status: 'in_progress', job_board_request_id: 'jb-1' } });
    const r = res();
    await intake.handleIntake({ headers: {}, body: submitBody() }, r);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.job_board_request_id, 'jb-1');
});
