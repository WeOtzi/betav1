const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const svc = require('../services/studio-verification');
const igSvc = require('../services/instagram-verification');
const { StudiosRepo } = require('../lib/repos/studios');
const { EVENTS, resolveRecipients } = require('../services/email-event-mapping');
const { INTERNAL_ONLY_EVENTS, isInternalOnlyEvent } = require('../services/email-request-context');

const { buildInstagramState, setDeps } = svc._internal;
const { hashCode } = igSvc._internal;

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const NOW = Date.parse('2026-11-02T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_STUDIO_ID = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const AGENT_ID = '66666666-6666-4666-8666-666666666666';

function missingSchemaError() {
    const error = new Error('PostgREST GET studios failed (400): {"code":"42703","message":"column studios.verification_status does not exist"}');
    error.status = 400;
    return error;
}

// ---------------------------------------------------------------------------
// StudiosRepo en memoria: implementa solo los métodos que usa el servicio.
// ---------------------------------------------------------------------------
function createFakeRepo(seed = {}, { missing = false, insertConflicts = 0 } = {}) {
    const tables = {
        studios: (seed.studios || []).map((r) => ({ ...r })),
        requests: (seed.requests || []).map((r) => ({ ...r })),
        codes: (seed.codes || []).map((r) => ({ ...r }))
    };
    const calls = [];
    let conflicts = insertConflicts;
    const guardSchema = () => { if (missing) throw missingSchemaError(); };
    const byCreatedDesc = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);
    const repo = {
        async getOwnedStudioForVerification(userId) {
            calls.push(['getOwnedStudioForVerification', userId]);
            guardSchema();
            return tables.studios.find((s) => s.user_id === userId) || null;
        },
        async getLatestVerificationRequest(studioId) {
            calls.push(['getLatestVerificationRequest', studioId]);
            guardSchema();
            return tables.requests.filter((r) => r.studio_id === studioId).sort(byCreatedDesc)[0] || null;
        },
        async getStudioById(id) {
            calls.push(['getStudioById', id]);
            return tables.studios.find((s) => s.id === id) || null;
        },
        async expireStaleStudioInstagramCodes(studioId, nowIso) {
            calls.push(['expireStale', studioId]);
            guardSchema();
            tables.codes.filter((c) => c.status === 'pending' && Date.parse(c.expires_at) < Date.parse(nowIso)
                && (!studioId || c.studio_id === studioId)).forEach((c) => { c.status = 'expired'; });
        },
        async listStudioInstagramCodes(studioId) {
            guardSchema();
            return tables.codes.filter((c) => c.studio_id === studioId).sort(byCreatedDesc).map((c) => ({ ...c }));
        },
        async insertStudioInstagramCode(payload) {
            calls.push(['insertStudioInstagramCode', payload]);
            if (conflicts > 0) {
                conflicts -= 1;
                const error = new Error('duplicate key value violates unique constraint');
                error.status = 409;
                throw error;
            }
            const row = { id: crypto.randomUUID(), created_at: iso(NOW), ...payload };
            tables.codes.push(row);
            return { ...row };
        },
        async cancelOlderStudioInstagramCodes(studioId, row, note) {
            calls.push(['cancelOlder', studioId, row.id]);
            tables.codes.filter((c) => c.studio_id === studioId && c.status === 'pending'
                && Date.parse(c.created_at) < Date.parse(row.created_at)).forEach((c) => { c.status = 'cancelled'; c.note = note; });
        },
        async markStudioInstagramEmailSent(id) {
            const row = tables.codes.find((c) => c.id === id);
            if (row) row.email_sent = true;
        },
        async findStudioInstagramCodesByHash(hashes) {
            calls.push(['findByHash', hashes]);
            guardSchema();
            return tables.codes.filter((c) => hashes.includes(c.code_hash)).sort(byCreatedDesc).map((c) => ({ ...c }));
        },
        async claimStudioInstagramCode(id, update, fromStatuses) {
            calls.push(['claim', id, update]);
            const rows = tables.codes.filter((c) => c.id === id && fromStatuses.includes(c.status));
            rows.forEach((c) => Object.assign(c, update));
            return rows.map((c) => ({ ...c }));
        },
        async revertStudioInstagramCode(id, status) {
            const row = tables.codes.find((c) => c.id === id && c.status === 'verified');
            if (row) Object.assign(row, { status, verified_at: null, verified_via: null, verified_by: null });
        },
        async registerStudioInstagramMismatch(id, patch) {
            calls.push(['mismatch', id, patch]);
            const row = tables.codes.find((c) => c.id === id && c.status === 'pending');
            if (row) Object.assign(row, patch);
        },
        async cancelOtherStudioInstagramCodes(studioId, exceptId, note) {
            calls.push(['cancelOthers', studioId, exceptId]);
            tables.codes.filter((c) => c.studio_id === studioId && c.status === 'pending' && c.id !== exceptId)
                .forEach((c) => { c.status = 'cancelled'; c.note = note; });
        },
        async verifyPendingStudioInstagramCodesBySupport(studioId, handle, { verifiedAt, verifiedBy, note }) {
            calls.push(['verifyBySupport', studioId, handle]);
            const rows = tables.codes.filter((c) => c.studio_id === studioId && c.status === 'pending' && c.ig_handle === handle);
            rows.forEach((c) => Object.assign(c, { status: 'verified', verified_at: verifiedAt, verified_via: 'support', verified_by: verifiedBy, note }));
            return rows.map((c) => ({ ...c }));
        },
        async setStudioInstagramVerified(studioId, handle, verifiedAt) {
            calls.push(['setStudioInstagramVerified', studioId, handle, verifiedAt]);
            const studio = tables.studios.find((s) => s.id === studioId);
            if (studio) Object.assign(studio, { instagram_verified_at: verifiedAt, instagram_verified_handle: handle });
        }
    };
    return { repo, tables, calls };
}

function studioRow(overrides = {}) {
    return {
        id: STUDIO_ID,
        user_id: OWNER_ID,
        name: 'Tinta Norte',
        slug: 'tinta-norte',
        email: 'ficha@tintanorte.test',
        instagram: '@Tinta.Norte',
        is_verified: false,
        verification_status: 'pending',
        verification_required: true,
        verification_reason: 'name_match',
        verified_at: null,
        instagram_verified_at: null,
        instagram_verified_handle: null,
        ...overrides
    };
}

function codeRow(overrides = {}) {
    return {
        id: ROW_ID, studio_id: STUDIO_ID, requested_by: OWNER_ID, ig_handle: 'tinta.norte', code_hash: hashCode('WO-4F7K2Q'),
        status: 'pending', email_sent_to: 'dueno@gmail.com', email_sent: true, attempts: 0,
        created_at: iso(NOW - HOUR), expires_at: iso(NOW + 71 * HOUR), ...overrides
    };
}

function fakeReq({ headers = {}, body = {}, query = {}, params = {} } = {}) {
    return { headers, body, query, params };
}

function fakeRes() {
    return {
        statusCode: 200,
        body: undefined,
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; return this; }
    };
}

async function call(handler, req) {
    const res = fakeRes();
    await handler(req, res);
    return res;
}

const ownerUser = async () => ({ id: OWNER_ID, email: 'Dueno@Gmail.com' });

function withDeps(t, overrides) {
    const restore = setDeps({ now: () => NOW, resolveBearerUser: ownerUser, sendEmail: async () => ({ ok: true }), ...overrides });
    t.after(restore);
}

// --- Estado -----------------------------------------------------------------

test('buildInstagramState: none, pending for the current handle and verified', () => {
    const studio = studioRow();
    assert.deepEqual(buildInstagramState({ studio, codes: [], now: NOW }),
        { status: 'none', handle: 'tinta.norte', expires_at: null, email_masked: null, email_sent: false });

    const pending = buildInstagramState({ studio, codes: [codeRow()], now: NOW });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.expires_at, iso(NOW + 71 * HOUR));
    assert.equal(pending.email_masked, 'du•••o@gmail.com');
    assert.equal(pending.email_sent, true);

    // Un código pedido para otro usuario de Instagram ya no sirve.
    assert.equal(buildInstagramState({ studio, codes: [codeRow({ ig_handle: 'otra.cuenta' })], now: NOW }).status, 'none');
    // Vencido: none.
    assert.equal(buildInstagramState({ studio, codes: [codeRow({ expires_at: iso(NOW - 1) })], now: NOW }).status, 'none');

    const verified = buildInstagramState({
        studio: studioRow({ instagram_verified_at: iso(NOW - HOUR), instagram_verified_handle: 'tinta.norte' }),
        codes: [codeRow()], now: NOW
    });
    assert.deepEqual(verified, { status: 'verified', handle: 'tinta.norte', expires_at: null, email_masked: null, email_sent: false });
    // Cambió el Instagram de la ficha: el validado viejo no cuenta.
    assert.equal(buildInstagramState({
        studio: studioRow({ instagram: 'nuevo.ig', instagram_verified_at: iso(NOW - HOUR), instagram_verified_handle: 'tinta.norte' }),
        now: NOW
    }).status, 'none');
});

test('GET /api/studio/verification requires a session and an owned studio', async (t) => {
    const db = createFakeRepo({ studios: [studioRow()] });
    withDeps(t, { repo: db.repo, resolveBearerUser: async () => null });
    let res = await call(svc.getStudioVerification, fakeReq());
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);

    setDeps({ resolveBearerUser: async () => ({ id: AGENT_ID, email: 'otro@weotzi.test' }) });
    res = await call(svc.getStudioVerification, fakeReq());
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'STUDIO_NOT_FOUND');
});

test('GET /api/studio/verification answers 503 STUDIO_VERIFICATION_UNAVAILABLE without the migration', async (t) => {
    const db = createFakeRepo({ studios: [studioRow()] }, { missing: true });
    withDeps(t, { repo: db.repo });
    let res = await call(svc.getStudioVerification, fakeReq());
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'STUDIO_VERIFICATION_UNAVAILABLE');
    res = await call(svc.requestInstagramCode, fakeReq());
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'STUDIO_VERIFICATION_UNAVAILABLE');
});

test('GET /api/studio/verification returns the documented state shape', async (t) => {
    const request = {
        id: REQUEST_ID, studio_id: STUDIO_ID, status: 'pending', reasons: ['name_match', 'owner_request'],
        evidence: 'Somos el estudio de la calle Corrientes.', contact_name: 'Ana', contact_phone: '+54 11 5555 5555',
        links: ['https://tintanorte.test'], created_at: iso(NOW - 2 * HOUR), decided_at: null, decision_note: null,
        requested_by: OWNER_ID, decided_by: null
    };
    const db = createFakeRepo({ studios: [studioRow()], requests: [request], codes: [codeRow(), codeRow({ id: crypto.randomUUID(), status: 'pending', expires_at: iso(NOW - HOUR), created_at: iso(NOW - 80 * HOUR) })] });
    withDeps(t, { repo: db.repo });
    const res = await call(svc.getStudioVerification, fakeReq());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        success: true,
        available: true,
        studio: {
            id: STUDIO_ID, name: 'Tinta Norte', instagram: '@Tinta.Norte', is_verified: false, verification_status: 'pending',
            verification_required: true, verification_reason: 'name_match', verified_at: null,
            instagram_verified_at: null, instagram_verified_handle: null
        },
        request: {
            id: REQUEST_ID, status: 'pending', reasons: ['name_match', 'owner_request'],
            evidence: 'Somos el estudio de la calle Corrientes.', contact_name: 'Ana', contact_phone: '+54 11 5555 5555',
            links: ['https://tintanorte.test'], created_at: iso(NOW - 2 * HOUR), decided_at: null, decision_note: null
        },
        instagram: { status: 'pending', handle: 'tinta.norte', expires_at: iso(NOW + 71 * HOUR), email_masked: 'du•••o@gmail.com', email_sent: true },
        instructions: { account: 'weotzi', dm_url: 'https://ig.me/m/weotzi', follow_url: 'https://www.instagram.com/weotzi/' }
    });
    assert.ok(!JSON.stringify(res.body).includes('code_hash'));
    assert.ok(!JSON.stringify(res.body).includes('ficha@tintanorte.test'), 'studios.email never leaks');
    assert.equal(db.tables.codes[1].status, 'expired', 'stale codes expire lazily');

    // Sin solicitud: request null.
    const empty = createFakeRepo({ studios: [studioRow()] });
    setDeps({ repo: empty.repo });
    const res2 = await call(svc.getStudioVerification, fakeReq());
    assert.equal(res2.body.request, null);
    assert.equal(res2.body.instagram.status, 'none');
});

// --- Pedido de código -----------------------------------------------------------

test('POST /api/studio/verification/instagram validates the handle and refuses an already validated account', async (t) => {
    const db = createFakeRepo({ studios: [studioRow({ instagram: null })] });
    withDeps(t, { repo: db.repo });
    let res = await call(svc.requestInstagramCode, fakeReq());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'IG_HANDLE_REQUIRED');
    res = await call(svc.requestInstagramCode, fakeReq({ body: { handle: 'no válido!' } }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'IG_HANDLE_INVALID');

    const verified = createFakeRepo({ studios: [studioRow({ instagram_verified_at: iso(NOW - HOUR), instagram_verified_handle: 'tinta.norte' })] });
    setDeps({ repo: verified.repo });
    res = await call(svc.requestInstagramCode, fakeReq({ body: { handle: 'https://instagram.com/Tinta.Norte/' } }));
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'IG_ALREADY_VERIFIED');
    assert.equal(verified.tables.codes.length, 0);
});

test('POST stores only the hash, cancels older codes and emails the code to the auth email', async (t) => {
    const older = codeRow({ id: crypto.randomUUID(), created_at: iso(NOW - 5 * HOUR) });
    const db = createFakeRepo({ studios: [studioRow()], codes: [older] }, { insertConflicts: 1 });
    const sent = [];
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    t.after(() => { console.error = originalError; });
    withDeps(t, { repo: db.repo, sendEmail: async (...args) => { sent.push(args); return { ok: true }; } });

    const res = await call(svc.requestInstagramCode, fakeReq());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['email_masked', 'email_sent', 'expires_at', 'handle', 'status', 'success']);
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.handle, 'tinta.norte');
    assert.equal(res.body.email_masked, 'du•••o@gmail.com');
    assert.equal(res.body.email_sent, true);
    assert.equal(res.body.expires_at, iso(NOW + 72 * HOUR));

    const inserts = db.calls.filter((c) => c[0] === 'insertStudioInstagramCode');
    assert.equal(inserts.length, 2, 'a 409 hash collision retries with a new code');
    const row = db.tables.codes.find((c) => c.id !== older.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.studio_id, STUDIO_ID);
    assert.equal(row.requested_by, OWNER_ID);
    assert.equal(row.ig_handle, 'tinta.norte');
    assert.equal(row.email_sent_to, 'dueno@gmail.com');
    assert.equal(row.email_sent, true);
    assert.match(row.code_hash, /^[a-f0-9]{64}$/);
    assert.ok(!('code' in row) && !('verification_code' in row));
    assert.equal(db.tables.codes.find((c) => c.id === older.id).status, 'cancelled');

    assert.equal(sent.length, 1);
    const [eventId, payload, opts] = sent[0];
    assert.equal(eventId, 'instagram_verification_code');
    assert.equal(payload.artist_email, 'dueno@gmail.com', 'auth.users email, never studios.email');
    assert.equal(payload.artist_name, 'Tinta Norte');
    assert.match(payload.verification_code, /^WO-[A-Z2-9]{6}$/);
    assert.equal(hashCode(payload.verification_code), row.code_hash);
    assert.equal(payload.instagram_handle, '@tinta.norte');
    assert.equal(payload.expires_label, '72 horas');
    assert.equal(payload.weotzi_instagram, '@weotzi');
    assert.equal(payload.dm_url, 'https://ig.me/m/weotzi');
    assert.equal(opts.idempotencyKey, `studio-ig-verify:${STUDIO_ID}:${row.id}`);
    assert.ok(!JSON.stringify(res.body).includes(payload.verification_code), 'the code is never returned');
    assert.ok(!logs.join('\n').includes(payload.verification_code), 'the code is never logged');
});

test('POST keeps the row and answers email_sent:false when the email fails', async (t) => {
    const db = createFakeRepo({ studios: [studioRow()] });
    const originalError = console.error;
    console.error = () => {};
    t.after(() => { console.error = originalError; });
    withDeps(t, { repo: db.repo, sendEmail: async () => { throw new Error('smtp down'); } });
    const res = await call(svc.requestInstagramCode, fakeReq({ body: { handle: '@Otra.Cuenta' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.email_sent, false);
    assert.equal(res.body.handle, 'otra.cuenta');
    assert.equal(db.tables.codes[0].email_sent, false);
});

test('server.js rate-limits the studio code request like the artist one', () => {
    const server = read('server.js');
    assert.match(server, /const studioIgVerifyLimiter = rateLimit\(\{\s*windowMs: 60 \* 60 \* 1000,\s*max: 5,\s*standardHeaders: true,\s*legacyHeaders: false,/);
    assert.match(server, /app\.post\('\/api\/studio\/verification\/instagram', studioIgVerifyLimiter, studioVerification\.requestInstagramCode\)/);
    assert.match(server, /app\.get\('\/api\/studio\/verification', studioVerification\.getStudioVerification\)/);
    assert.match(server, /igVerification\.setStudioInboundHandler\(studioVerification\.handleInboundCodes\)/);
    const spa = server.indexOf("app.get('*'");
    assert.ok(server.indexOf("app.get('/api/studio/verification'") < spa);
});

// --- Webhook (fallback de estudios) -----------------------------------------------

test('handleInboundCodes verifies the studio and only touches the studio columns', async (t) => {
    const other = codeRow({ id: crypto.randomUUID(), code_hash: hashCode('WO-ZZZZZZ'), created_at: iso(NOW - 2 * HOUR) });
    const db = createFakeRepo({ studios: [studioRow()], codes: [codeRow(), other] });
    withDeps(t, { repo: db.repo });
    const out = await svc.handleInboundCodes({ sender: '@Tinta.Norte', codes: ['WO-4F7K2Q'], followsBusiness: true });
    assert.deepEqual(out, { verified: true, reason: 'verified' });
    const row = db.tables.codes.find((c) => c.id === ROW_ID);
    assert.equal(row.status, 'verified');
    assert.equal(row.verified_via, 'dm_webhook');
    assert.equal(row.verified_at, iso(NOW));
    assert.equal(row.dm_sender_handle, 'tinta.norte');
    assert.equal(db.tables.studios[0].instagram_verified_at, iso(NOW));
    assert.equal(db.tables.studios[0].instagram_verified_handle, 'tinta.norte');
    assert.equal(db.tables.studios[0].is_verified, false, 'the Instagram code does not verify the whole studio');
    assert.equal(db.tables.codes.find((c) => c.id === other.id).status, 'cancelled');

    const again = await svc.handleInboundCodes({ sender: 'tinta.norte', codes: ['WO-4F7K2Q'] });
    assert.deepEqual(again, { verified: false, reason: 'code_not_pending' });
});

test('handleInboundCodes answers the artist webhook reasons', async (t) => {
    let db = createFakeRepo({ studios: [studioRow()], codes: [codeRow()] });
    withDeps(t, { repo: db.repo });
    assert.deepEqual(await svc.handleInboundCodes({ sender: 'otra.cuenta', codes: ['WO-4F7K2Q'] }), { verified: false, reason: 'handle_mismatch' });
    assert.equal(db.tables.codes[0].attempts, 1);
    assert.equal(db.tables.codes[0].status, 'pending');
    assert.deepEqual(await svc.handleInboundCodes({ sender: 'tinta.norte', codes: ['WO-4F7K2Q'], followsBusiness: false }), { verified: false, reason: 'not_following' });
    assert.deepEqual(await svc.handleInboundCodes({ sender: 'tinta.norte', codes: ['WO-ABCDEF'] }), { verified: false, reason: 'code_not_found' });
    assert.deepEqual(await svc.handleInboundCodes({ sender: 'tinta.norte', codes: [] }), { verified: false, reason: 'no_code' });
    assert.equal(db.tables.studios[0].instagram_verified_at, null);

    db = createFakeRepo({ studios: [studioRow()], codes: [codeRow({ expires_at: iso(NOW - HOUR) })] });
    setDeps({ repo: db.repo });
    assert.deepEqual(await svc.handleInboundCodes({ sender: 'tinta.norte', codes: ['WO-4F7K2Q'] }), { verified: false, reason: 'code_expired' });
    assert.equal(db.tables.codes[0].status, 'expired');

    db = createFakeRepo({}, { missing: true });
    setDeps({ repo: db.repo });
    assert.deepEqual(await svc.handleInboundCodes({ sender: 'tinta.norte', codes: ['WO-4F7K2Q'] }), { verified: false, reason: 'code_not_found' });
});

// PostgREST en memoria mínimo para el lado de artistas del webhook.
function artistPgrest(log) {
    return function pgrest(table) {
        const q = {
            select() { return q; }, eq() { return q; }, neq() { return q; }, lt() { return q; }, in() { return q; },
            order() { return q; }, limit() { return q; }, single() { return q; },
            async execute() { log.push({ table, op: 'select' }); return []; },
            async patch(values) { log.push({ table, op: 'patch', values }); return []; },
            async insert(values) { log.push({ table, op: 'insert', values }); return []; }
        };
        return q;
    };
}

test('the DM webhook falls back to studio codes when no artist code matches, without touching artists', async (t) => {
    const db = createFakeRepo({ studios: [studioRow()], codes: [codeRow()] });
    withDeps(t, { repo: db.repo });
    const log = [];
    process.env.IG_VERIFY_WEBHOOK_SECRET = 'hook-secret';
    const restoreIg = igSvc._internal.setDeps({ pgrest: artistPgrest(log), now: () => NOW, studioInbound: null });
    t.after(() => { restoreIg(); delete process.env.IG_VERIFY_WEBHOOK_SECRET; });
    const req = () => fakeReq({
        headers: { 'x-weotzi-webhook-token': 'hook-secret' },
        body: { sender_username: 'Tinta.Norte', message_text: 'hola, mi código es wo-4f7k2q', follows_business: true }
    });

    // Sin el fallback registrado: el comportamiento de siempre.
    let res = await call(igSvc.handleInbound, req());
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'code_not_found' });
    assert.equal(db.tables.codes[0].status, 'pending');

    igSvc.setStudioInboundHandler(svc.handleInboundCodes);
    res = await call(igSvc.handleInbound, req());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, verified: true, reason: 'verified' });
    assert.equal(db.tables.codes[0].status, 'verified');
    assert.equal(db.tables.studios[0].instagram_verified_handle, 'tinta.norte');
    assert.equal(log.filter((e) => e.table === 'artists_db').length, 0, 'artists_db is never read nor patched');
    assert.equal(log.filter((e) => e.op === 'patch' && e.table !== 'artist_instagram_verifications').length, 0);

    res = await call(igSvc.handleInbound, req());
    assert.deepEqual(res.body, { success: true, verified: false, reason: 'code_not_pending' });
});

// --- Backoffice ---------------------------------------------------------------------

test('parseDecisionInput validates id, decision, note and confirm_instagram', () => {
    assert.deepEqual(svc.parseDecisionInput({ id: 'no-uuid' }, { decision: 'approve' }).status, 400);
    assert.equal(svc.parseDecisionInput({ id: REQUEST_ID }, { decision: 'maybe' }).ok, false);
    assert.equal(svc.parseDecisionInput({ id: REQUEST_ID }, null).ok, false);
    const reject = svc.parseDecisionInput({ id: REQUEST_ID }, { decision: 'reject', note: ' no ' });
    assert.equal(reject.ok, false);
    assert.equal(reject.status, 400);
    assert.match(reject.error, /al menos 3 caracteres/);
    assert.equal(svc.parseDecisionInput({ id: REQUEST_ID }, { decision: 'reject', note: 'x'.repeat(1001) }).ok, false);
    assert.equal(svc.parseDecisionInput({ id: REQUEST_ID }, { decision: 'approve', confirm_instagram: 'yes' }).ok, false);
    assert.deepEqual(svc.parseDecisionInput({ id: REQUEST_ID }, { decision: 'reject', note: '  Falta info  ', confirm_instagram: true }),
        { ok: true, id: REQUEST_ID, decision: 'reject', note: 'Falta info', confirmInstagram: false });
    assert.deepEqual(svc.parseDecisionInput({ id: REQUEST_ID }, { decision: 'approve', note: '', confirm_instagram: true }),
        { ok: true, id: REQUEST_ID, decision: 'approve', note: null, confirmInstagram: true });
    assert.equal(svc.parseAdminStatus(undefined), 'pending');
    assert.equal(svc.parseAdminStatus('ALL'), 'all');
    assert.equal(svc.parseAdminStatus('approved'), 'approved');
    assert.equal(svc.parseAdminStatus('raro'), null);
});

test('confirmInstagramBySupport marks the studio and its pending codes as verified by support', async (t) => {
    const stale = codeRow({ id: crypto.randomUUID(), ig_handle: 'vieja.cuenta', code_hash: hashCode('WO-ZZZZZZ') });
    const db = createFakeRepo({ studios: [studioRow()], codes: [codeRow(), stale] });
    withDeps(t, { repo: db.repo });
    const out = await svc.confirmInstagramBySupport({ studioId: STUDIO_ID, verifiedBy: AGENT_ID });
    assert.equal(out.confirmed, true);
    assert.equal(out.handle, 'tinta.norte');
    assert.equal(out.codes_verified, 1);
    assert.equal(db.tables.studios[0].instagram_verified_at, iso(NOW));
    assert.equal(db.tables.studios[0].instagram_verified_handle, 'tinta.norte');
    const row = db.tables.codes.find((c) => c.id === ROW_ID);
    assert.equal(row.status, 'verified');
    assert.equal(row.verified_via, 'support');
    assert.equal(row.verified_by, AGENT_ID);
    assert.equal(db.tables.codes.find((c) => c.id === stale.id).status, 'cancelled');

    const again = await svc.confirmInstagramBySupport({ studioId: STUDIO_ID, verifiedBy: AGENT_ID });
    assert.equal(again.already, true);

    const noHandle = createFakeRepo({ studios: [studioRow({ instagram: '' })] });
    setDeps({ repo: noHandle.repo });
    assert.deepEqual(await svc.confirmInstagramBySupport({ studioId: STUDIO_ID }), { confirmed: false, reason: 'no_handle' });
    assert.equal(noHandle.calls.filter((c) => c[0] === 'setStudioInstagramVerified').length, 0);
    assert.deepEqual(await svc.confirmInstagramBySupport({ studioId: 'x' }), { confirmed: false, reason: 'invalid_studio' });
});

// --- Repo (fetch stub, sin red) -----------------------------------------------------

function withFetch(t, handler) {
    const previous = { fetch: global.fetch, url: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY, anon: process.env.SUPABASE_ANON_KEY };
    process.env.SUPABASE_URL = 'https://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    const calls = [];
    global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts });
        const out = await handler(String(url), opts);
        const status = out.status || 200;
        const text = out.body === undefined ? '' : JSON.stringify(out.body);
        return { ok: status < 400, status, headers: { get: () => null }, text: async () => text, json: async () => out.body };
    };
    t.after(() => {
        global.fetch = previous.fetch;
        for (const [key, env] of [['url', 'SUPABASE_URL'], ['service', 'SUPABASE_SERVICE_ROLE_KEY'], ['anon', 'SUPABASE_ANON_KEY']]) {
            if (previous[key] === undefined) delete process.env[env]; else process.env[env] = previous[key];
        }
    });
    return calls;
}

test('StudiosRepo.decideVerificationAsCaller calls the RPC with the caller JWT', async (t) => {
    const calls = withFetch(t, () => ({ body: { id: REQUEST_ID, studio_id: STUDIO_ID, status: 'approved' } }));
    const out = await StudiosRepo.decideVerificationAsCaller(REQUEST_ID, 'approve', '', 'user-jwt');
    assert.deepEqual(out, { id: REQUEST_ID, studio_id: STUDIO_ID, status: 'approved' });
    assert.equal(calls[0].url, 'https://db.test/rest/v1/rpc/decide_studio_verification');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer user-jwt');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { p_request_id: REQUEST_ID, p_decision: 'approve', p_note: null });
    await assert.rejects(() => StudiosRepo.decideVerificationAsCaller(REQUEST_ID, 'approve', null, null), (err) => err.status === 401);
});

test('StudiosRepo.listVerificationRequests joins the studio, matches and the auth.users owner email', async (t) => {
    let empty = false;
    const calls = withFetch(t, (url) => {
        if (empty) return { body: [] };
        if (url.includes('/rest/v1/studio_verification_requests')) {
            return { body: [{
                id: REQUEST_ID, studio_id: STUDIO_ID, status: 'pending', reasons: ['name_match'], matched_studio_ids: [OTHER_STUDIO_ID],
                evidence: 'Info', links: ['https://x.test'], created_at: iso(NOW - HOUR),
                studios: { ...studioRow(), city: 'CABA', country: 'Argentina', logo_image: null }
            }] };
        }
        if (url.includes('/rest/v1/studios?')) return { body: [{ id: OTHER_STUDIO_ID, name: 'Tinta Norte Palermo', slug: 'tinta-norte-palermo', city: 'CABA' }] };
        if (url.includes('/rest/v1/studio_instagram_verifications')) return { body: [{ studio_id: STUDIO_ID, ig_handle: 'tinta.norte', expires_at: iso(NOW + HOUR) }] };
        if (url.includes('/auth/v1/admin/users/')) return { body: { id: OWNER_ID, email: 'Dueno@Gmail.com', email_confirmed_at: iso(NOW - 99 * HOUR) } };
        return { status: 404, body: {} };
    });
    const rows = await StudiosRepo.listVerificationRequests({ status: 'pending', now: iso(NOW) });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.owner_email, 'dueno@gmail.com');
    assert.equal(row.owner_email_confirmed, true);
    assert.equal(row.studio.name, 'Tinta Norte');
    assert.ok(!('user_id' in row.studio), 'the owner id does not travel to the backoffice');
    assert.ok(!('studios' in row));
    assert.deepEqual(row.matched_studios, [{ id: OTHER_STUDIO_ID, name: 'Tinta Norte Palermo', slug: 'tinta-norte-palermo', city: 'CABA' }]);
    assert.deepEqual(row.instagram_pending_code, { handle: 'tinta.norte', expires_at: iso(NOW + HOUR) });
    const listCall = calls.find((c) => c.url.includes('studio_verification_requests'));
    assert.match(listCall.url, /status=eq\.pending/);
    assert.match(listCall.url, /order=created_at\.asc/);
    assert.ok(decodeURIComponent(listCall.url).includes('studios(id,name,slug,city,country,logo_image,instagram,user_id,'));
    assert.ok(!decodeURIComponent(listCall.url).includes('email'), 'studios.email is never selected');
    assert.ok(calls.some((c) => c.url === `https://db.test/auth/v1/admin/users/${OWNER_ID}`));

    empty = true;
    const before = calls.length;
    await StudiosRepo.listVerificationRequests({ status: 'all' });
    assert.ok(!calls[before].url.includes('status=eq'));
    assert.match(calls[before].url, /order=created_at\.desc/);
});

// --- Emails y server.js ------------------------------------------------------------

test('studio_verification_decision uses the studio-notification template and is internal-only', () => {
    const event = EVENTS.studio_verification_decision;
    assert.ok(event);
    assert.equal(event.templateHint, 'studio-notification');
    assert.deepEqual(resolveRecipients('studio_verification_decision', { recipient_email: 'dueno@gmail.com', client_email: 'x@y.z' }), ['dueno@gmail.com']);
    assert.ok(INTERNAL_ONLY_EVENTS.has('studio_verification_decision'));
    assert.ok(isInternalOnlyEvent('studio_verification_decision'));
});

test('server.js exposes the admin verification endpoints next to the studio claims', () => {
    const server = read('server.js');
    const claims = server.indexOf("app.post('/api/admin/studio-claims/:id/decide'");
    const list = server.indexOf("app.get('/api/admin/studio-verifications',");
    const decide = server.indexOf("app.post('/api/admin/studio-verifications/:id/decide',");
    const vendors = server.indexOf("app.get('/api/admin/supply-vendors'");
    assert.ok(claims > -1 && list > claims && decide > list && vendors > decide);
    const block = server.slice(list, vendors);
    assert.match(block, /_verifyBackofficeOrSupport\(req\)/);
    assert.match(block, /requests: \[\], migration_pending: true/);
    assert.match(block, /studioVerification\.parseDecisionInput\(req\.params, req\.body\)/);
    assert.match(block, /StudiosRepo\.decideVerificationAsCaller\(id, decision, note, bearerToken\(req\)\)/);
    assert.match(block, /_respondRpcFailure\(res, err, 'decide_studio_verification'\)/);
    assert.match(block, /studioVerification\.confirmInstagramBySupport\(/);
    assert.ok(!/\/rest\/v1\//.test(block), 'no ad-hoc PostgREST');

    const notify = server.slice(server.indexOf('async function _notifyStudioVerificationDecision'), list);
    assert.match(notify, /StudiosRepo\.getStudioOwnerContact\(request\.studio_id\)/);
    assert.match(notify, /eventId: 'studio_verification_decision'/);
    assert.match(notify, /'Tu estudio está verificado'/);
    assert.match(notify, /\/studio\/dashboard#verificacion/);
    assert.match(notify, /Motivo: \$\{note\}/);
    assert.ok(!/studios\.email|\.email\s*\|\|\s*studio/.test(notify), 'never studios.email');
});
