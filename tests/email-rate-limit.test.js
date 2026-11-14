'use strict';

// EM-N1 / INB-03 / CC-12: POST /api/email/:eventId tiene su propio rate limit
// por usuario (no comparte authLimiter) y el handler no trata como error lo
// que no lo es (omitido por preferencia, ya leído, en cola, incierto).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const routes = require('../lib/routes/emails');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

async function withApp(setup, run) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    setup(app);
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(base);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

const post = (base, url, token, body = { data: { quote_id: 'WO-1' } }) => fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
});

test('server.js: /api/email/:eventId usa el limiter propio y no authLimiter', () => {
    const server = read('server.js');
    assert.match(server, /app\.post\('\/api\/email\/:eventId', require\('\.\/lib\/routes\/emails'\)\.dispatchLimiter, require\('\.\/lib\/routes\/emails'\)\.dispatchHandler\);/);
    assert.doesNotMatch(server, /app\.post\('\/api\/email\/:eventId', authLimiter/);
    assert.doesNotMatch(server, /app\.post\('\/api\/studio\/notify', authLimiter/);
    assert.doesNotMatch(server, /app\.use\('\/api\/email\/events', authLimiter\)/);
    assert.match(server, /require\('\.\/lib\/routes\/emails'\)\.register\(app, \{/);
});

test('15 avisos seguidos de un mismo usuario no dan 429; el tope es por usuario y no por IP', async () => {
    const users = { 'token-a': { id: 'user-a' }, 'token-b': { id: 'user-b' } };
    const limiter = routes.createEmailDispatchLimiter({ resolveUser: async req => users[req.headers.authorization.slice(7)] || null, max: 20 });
    await withApp(app => app.post('/api/email/:eventId', limiter, (req, res) => res.json({ success: true, user: req.weotziEmailUser && req.weotziEmailUser.id })), async (base) => {
        for (let i = 0; i < 15; i++) {
            const res = await post(base, '/api/email/chat_message_to_client', 'token-a');
            assert.equal(res.status, 200, `envío ${i + 1}`);
            if (i === 0) assert.equal((await res.json()).user, 'user-a', 'el usuario verificado queda en la request');
        }
        for (let i = 0; i < 5; i++) await post(base, '/api/email/chat_message_to_client', 'token-a');
        const blocked = await post(base, '/api/email/chat_message_to_client', 'token-a');
        assert.equal(blocked.status, 429);
        assert.equal((await blocked.json()).rate_limited, true);
        // Otro usuario detrás de la misma IP no comparte el contador.
        assert.equal((await post(base, '/api/email/chat_message_to_client', 'token-b')).status, 200);
    });
});

test('sin sesión el tope cae a la IP; un token inválido no suma a otro usuario', async () => {
    const limiter = routes.createEmailDispatchLimiter({ resolveUser: async () => null, max: 3 });
    await withApp(app => app.post('/api/email/:eventId', limiter, (req, res) => res.json({ success: true })), async (base) => {
        for (let i = 0; i < 3; i++) assert.equal((await post(base, '/api/email/client_quotation_submitted', null)).status, 200);
        assert.equal((await post(base, '/api/email/client_quotation_submitted', 'forged')).status, 429);
    });
});

function fakeService(result) {
    const calls = [];
    return {
        calls,
        eventMapping: require('../services/email-event-mapping'),
        VALID_CHANNELS: ['n8n', 'smtp_relay', 'billionmail', 'dual', 'off'],
        sendEmail: async (...args) => { calls.push(args); return typeof result === 'function' ? result(...args) : result; }
    };
}

async function dispatch(handler, eventId = 'artist_responded_quotation') {
    let status = 200, body = null;
    const res = { status(code) { status = code; return this; }, json(data) { body = data; return this; } };
    await handler({ params: { eventId }, body: { data: { quote_id: 'WO-1' } }, query: {}, headers: {} }, res);
    return { status, body };
}

test('omitido por preferencia es 200 success; incierto o deduplicado es 202 (sin error para el usuario)', async () => {
    const ok = { ok: true, payload: { client_email: 'c@example.com' }, idempotencyKey: 'k' };
    const skipped = routes.createDispatchHandler({ emailService: fakeService({ ok: true, skipped: true, delivery_status: 'skipped_by_preference' }), resolveEmailContext: async () => ok });
    assert.deepEqual(await dispatch(skipped), { status: 200, body: { success: true, ok: true, skipped: true, delivery_status: 'skipped_by_preference' } });
    const uncertain = routes.createDispatchHandler({ emailService: fakeService({ ok: false, uncertain: true, error: 'x' }), resolveEmailContext: async () => ok });
    assert.equal((await dispatch(uncertain)).status, 202);
    const failed = routes.createDispatchHandler({ emailService: fakeService({ ok: false, error: 'rechazado' }), resolveEmailContext: async () => ok });
    assert.equal((await dispatch(failed)).status, 502);
});

test('contexto rechazado se loguea sin PII; ya leído no envía', async () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
        const handler = routes.createDispatchHandler({ emailService: fakeService({ ok: true }),
            resolveEmailContext: async () => ({ ok: false, status: 403, error: 'Esta cotización no corresponde a tu cuenta.', reason: 'http_403' }) });
        const out = await dispatch(handler);
        assert.equal(out.status, 403);
        assert.deepEqual(warnings[0], ['[email] context rejected', { eventId: 'artist_responded_quotation', status: 403, reason: 'http_403' }]);
    } finally {
        console.warn = original;
    }
    const service = fakeService({ ok: true });
    const read = routes.createDispatchHandler({ emailService: service, resolveEmailContext: async () => ({ ok: true, skip: true, reason: 'already_read' }) });
    const out = await dispatch(read, 'chat_message_to_client');
    assert.equal(out.body.success, true);
    assert.equal(out.body.delivery_status, 'already_read');
    assert.equal(service.calls.length, 0);
});

test('chat diferido: responde 202 en cola y al vencer el plazo no envía si ya se leyó', async () => {
    const scheduled = [];
    let unread = true;
    const service = fakeService({ ok: true, message_id: 'm' });
    const handler = routes.createDispatchHandler({
        emailService: service,
        schedule: (fn, ms) => scheduled.push({ fn, ms }),
        sendEmail: service.sendEmail,
        resolveEmailContext: async () => ({ ok: true, payload: { client_email: 'c@example.com' }, idempotencyKey: 'chat:WO-1:client:1',
            defer: { delayMs: 120000, stillPending: async () => unread } })
    });
    const out = await dispatch(handler, 'chat_message_to_client');
    assert.equal(out.status, 202);
    assert.equal(out.body.queued, true);
    assert.equal(scheduled[0].ms, 120000);
    await scheduled[0].fn();
    assert.equal(service.calls.length, 1);
    assert.equal(service.calls[0][2].idempotencyKey, 'chat:WO-1:client:1');
    unread = false;
    await dispatch(handler, 'chat_message_to_client');
    await scheduled[1].fn();
    assert.equal(service.calls.length, 1, 'ya leído: no se envía');
});

test('EmailClient: omitido, en cola o incierto no muestra el toast de error; un fallo real sí', async () => {
    const vm = require('node:vm');
    const toasts = [];
    const responses = [];
    const context = { AbortController, setTimeout, clearTimeout, console: { ...console, warn() {} },
        CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } },
        window: { location: { pathname: '/artist/dashboard' }, dispatchEvent() {}, showToast: (msg) => toasts.push(msg) },
        fetch: async () => responses.shift() };
    vm.runInNewContext(read('public/shared/js/email-client.js'), context);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    responses.push(reply(200, { success: true, skipped: true, delivery_status: 'skipped_by_preference' }));
    assert.equal((await context.window.EmailClient.sendEmail('artist_responded_quotation', {})).success, true);
    responses.push(reply(202, { success: true, queued: true }));
    assert.equal((await context.window.EmailClient.sendEmail('chat_message_to_client', {})).success, true);
    responses.push(reply(202, { success: false, uncertain: true }));
    await context.window.EmailClient.sendEmail('client_quotation_submitted', {});
    responses.push(reply(502, { success: false, error: 'rechazado' }));
    await context.window.EmailClient.sendEmail('chat_message_to_client', {});
    assert.equal(toasts.length, 0, 'ningún toast para resultados benignos ni avisos de chat');
    responses.push(reply(502, { success: false, error: 'rechazado' }));
    assert.equal((await context.window.EmailClient.sendEmail('artist_responded_quotation', {})).success, false);
    assert.equal(toasts.length, 1);
});
