'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { providerResult } = require('../services/email-service');
const { resolveRecipients } = require('../services/email-event-mapping');
const { resolveEmailContext, applicationBase } = require('../services/email-request-context');
const { dispatchOnce } = require('../services/email-delivery-ledger');

const request = { headers: { host: 'weotzi.com' }, weotziBasePath: '/beta' };
const quote = { id: 1, quote_id: 'WO-100', artist_id: 'artist-id', client_user_id: 'client-id',
    artist_email: 'artist@example.com', client_email: 'client@example.com', client_full_name: 'Client',
    created_at: new Date().toISOString(), quote_status: 'pending' };
function dependencies(user, records = {}) {
    return { resolveUser: async () => user, read: async table => records[table] || (table === 'quotations_db' ? quote : null),
        verifyAdmin: async () => ({ ok: false, status: 403, error: 'Admin required' }) };
}

test('provider detects failure payload even with HTTP 200', async () => {
    for (const body of [{ success: false }, { status: false }, { error: 'SMTP login failed' }, [{ error: 'SMTP refused' }], [{ rejected: ['client@example.com'] }]]) {
        const result = await providerResult(new Response(JSON.stringify(body)), 'n8n');
        assert.equal(result.ok, false);
        assert.doesNotMatch(result.error, /SMTP login failed|client@example/);
    }
});

test('SMTP message ID is evidence of acceptance, not mailbox delivery', async () => {
    const result = await providerResult(new Response(JSON.stringify([{ accepted: ['client@example.com'], rejected: [], messageId: 'mail-1' }])), 'n8n');
    assert.equal(result.ok, true);
    assert.equal(result.delivery_status, 'smtp_accepted');
    assert.equal(result.message_id, 'mail-1');
});

test('provider login HTML is never treated as successful email', async () => {
    assert.equal((await providerResult(new Response('<!DOCTYPE html><html>Login</html>'), 'billionmail')).ok, false);
});

test('workflow acknowledgement without SMTP evidence remains unconfirmed', async () => {
    const result = await providerResult(new Response(JSON.stringify({ message: 'Workflow was started' })), 'n8n');
    assert.equal(result.ok, false);
    assert.equal(result.uncertain, true);
});

test('recipients are normalized, deduplicated, and reject header injection', () => {
    assert.deepEqual(resolveRecipients('session_scheduled', { client_email: ' X@EXAMPLE.COM ', artist_email: 'x@example.com' }), ['x@example.com']);
    assert.deepEqual(resolveRecipients('client_registration_completed', { email: 'a@example.com\r\nBcc: b@example.com' }), []);
});

test('registration only sends to authenticated profile and never copies credentials', async () => {
    const result = await resolveEmailContext(request, 'client_registration_completed', { email: 'victim@example.com', password: 'secret' }, dependencies({ id: 'client-id', email: 'client@example.com' }, {
        clients_db: { user_id: 'client-id', full_name: 'Client' }
    }));
    assert.equal(result.ok, true);
    assert.equal(result.payload.email, 'client@example.com');
    assert.notEqual(result.payload.password, 'secret');
    assert.equal(result.payload.dashboard_url, 'https://weotzi.com/beta/client/dashboard');
});

test('anonymous registration and unrelated quotation dispatch are rejected', async () => {
    assert.equal((await resolveEmailContext(request, 'artist_registration_completed', {}, dependencies(null))).status, 401);
    assert.equal((await resolveEmailContext(request, 'artist_responded_quotation', { quote_id: quote.quote_id }, dependencies({ id: 'other-id', email: 'stranger@example.com' }))).status, 403);
});

test('public quotation confirmation uses only persisted recipients and content', async () => {
    const result = await resolveEmailContext(request, 'client_quotation_submitted', {
        quote_id: quote.quote_id, client_email: quote.client_email, artist_email: 'victim@example.com',
        client_name: 'Spoof', login_url: 'https://evil.example'
    }, dependencies(null));
    assert.equal(result.ok, true);
    assert.equal(result.payload.artist_email, quote.artist_email);
    assert.equal(result.payload.client_name, quote.client_full_name);
    assert.equal(result.payload.login_url, 'https://weotzi.com/beta/client/login');
    assert.equal(result.idempotencyKey, quote.quote_id);
});

test('public quote cannot resend old records or redirect recipients', async () => {
    assert.equal((await resolveEmailContext(request, 'client_quotation_submitted', { quote_id: quote.quote_id, client_email: 'victim@example.com' }, dependencies(null))).status, 403);
    assert.equal((await resolveEmailContext(request, 'client_quotation_submitted', { quote_id: quote.quote_id, client_email: quote.client_email }, dependencies(null, {
        quotations_db: { ...quote, created_at: '2020-01-01T00:00:00Z' }
    }))).status, 403);
});

test('artist events cannot be triggered by client and chat body is loaded from stored message', async () => {
    assert.equal((await resolveEmailContext(request, 'chat_message_to_client', { quote_id: quote.quote_id }, dependencies({ id: 'client-id', email: quote.client_email }))).status, 403);
    const deps = dependencies({ id: 'artist-id', email: quote.artist_email });
    deps.latestMessage = async () => ({ id: 42, message: 'Saved message' });
    const result = await resolveEmailContext(request, 'chat_message_to_client', { quote_id: quote.quote_id, message_preview: 'Fake' }, deps);
    assert.equal(result.payload.message_preview, 'Saved message');
    assert.match(result.idempotencyKey, /message:42/);
});

test('job application resolves the client recipient missing in current browser payload', async () => {
    const result = await resolveEmailContext(request, 'job_board_application_received', { application_id: 2 }, dependencies({ id: 'artist-id' }, {
        job_board_applications: { id: 2, request_id: 3, artist_id: 'artist-id', message: 'Application' },
        job_board_requests: { id: 3, client_user_id: 'client-id' },
        clients_db: { email: quote.client_email, full_name: 'Client' },
        artists_db: { email: quote.artist_email, name: 'Artist' }
    }));
    assert.equal(result.ok, true);
    assert.equal(result.payload.client_email, quote.client_email);
});

test('session mail selects the exact persisted session and rejects stale status', async () => {
    const lookups = [];
    const deps = dependencies({ id: 'artist-id', email: quote.artist_email });
    deps.read = async (table, filters) => { lookups.push({ table, filters }); return table === 'quotations_db' ? quote : table === 'quotation_sessions' ? { id: 71, quotation_id: 1, status: 'rescheduled', session_date: '2026-10-01', updated_at: 'v2' } : null; };
    assert.equal((await resolveEmailContext(request, 'session_scheduled', { quote_id: quote.quote_id }, deps)).status, 400);
    assert.equal((await resolveEmailContext(request, 'session_completed', { quote_id: quote.quote_id, session_id: 71 }, deps)).status, 409);
    const result = await resolveEmailContext(request, 'session_rescheduled', { quote_id: quote.quote_id, session_id: 71 }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.payload.session_date, '2026-10-01');
    assert.match(result.idempotencyKey, /session:71:v2/);
    assert.deepEqual(lookups.find(row => row.table === 'quotation_sessions').filters, { id: 71, quotation_id: 1 });
});

test('offline decision by artist requires the matching persisted status', async () => {
    const artist = { id: 'artist-id', email: quote.artist_email };
    assert.equal((await resolveEmailContext(request, 'client_approved_quotation', { quote_id: quote.quote_id }, dependencies(artist))).status, 403);
    const result = await resolveEmailContext(request, 'client_approved_quotation', { quote_id: quote.quote_id }, dependencies(artist, { quotations_db: { ...quote, quote_status: 'client_approved' } }));
    assert.equal(result.ok, true);
    assert.equal(result.payload.quotation_url, 'https://weotzi.com/beta/my-quotations/detail?quote=WO-100');
});

test('chat notifications use the requested stored message and enforce both ownership keys', async () => {
    const deps = dependencies({ id: 'artist-id', email: quote.artist_email });
    let selection;
    deps.read = async (table, filters) => table === 'quotations_db' ? quote : table === 'chat_messages' ? (selection = filters, { id: 9, message: 'Persisted' }) : null;
    const result = await resolveEmailContext(request, 'chat_message_to_client', { quote_id: quote.quote_id, message_id: 9 }, deps);
    assert.deepEqual(selection, { id: 9, quotation_id: quote.quote_id, sender_id: 'artist-id' });
    assert.equal(result.payload.message_preview, 'Persisted');
});

test('chat repository schedules mail only after persistence and keeps a failed mail separate', async () => {
    const events = [];
    const context = { console, window: { WeotziData: { run: async () => ({ data: [{ id: 101 }] }), orValue: x => x },
        ConfigManager: { sendN8NEvent: async (...args) => { events.push(args); return { success: false }; } } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/shared/js/data/quotations-repo.js'), 'utf8'), context);
    const data = await context.window.WeotziData.Chat.sendMessage({ quoteId: quote.quote_id, senderType: 'artist', senderId: 'artist-id', message: 'Hi' });
    assert.equal(data[0].id, 101);
    assert.equal(events[0][0], 'chat_message_to_client');
    assert.equal(events[0][1].message_id, 101);
    assert.equal(events[0][1].quote_id, quote.quote_id);
});

test('production link origin cannot be replaced through Host header', () => {
    assert.equal(applicationBase({ headers: { host: 'evil.example' } }), 'https://weotzi.com/beta');
});

function memoryLedger() {
    const records = new Map();
    return () => {
        let key, state;
        const api = {
            async insert(row) { if (records.has(row.delivery_key)) throw Object.assign(new Error('duplicate'), { status: 409 }); records.set(row.delivery_key, { ...row }); },
            select() { return api; }, eq(name, value) { if (name === 'state') state = value; else key = value; return api; }, limit() { return api; },
            async execute() { return records.has(key) ? [records.get(key)] : []; },
            async patch(row) { if (state && records.get(key)?.state !== state) return []; Object.assign(records.get(key), row); return [records.get(key)]; }
        };
        return api;
    };
}

test('durable delivery claim deduplicates concurrent and later retries', async () => {
    const db = memoryLedger();
    let count = 0;
    const send = async () => { count++; return { ok: true, channel: 'n8n', recipients: ['client@example.com'] }; };
    const results = await Promise.all([dispatchOnce('event', 'entity', send, db), dispatchOnce('event', 'entity', send, db)]);
    const replay = await dispatchOnce('event', 'entity', send, db);
    assert.equal(count, 1);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.ok, true);
    assert.equal(replay.recipients, undefined);
    assert.ok(results.some(result => result.ok));
});

test('uncertain provider response is never resent automatically', async () => {
    const db = memoryLedger();
    let count = 0;
    const send = async () => { count++; throw new Error('connection reset after send'); };
    await dispatchOnce('event', 'entity', send, db);
    const result = await dispatchOnce('event', 'entity', send, db);
    assert.equal(count, 1);
    assert.equal(result.uncertain, true);
});

test('confirmed failure can recover with only one concurrent retry claim', async () => {
    const db = memoryLedger();
    let count = 0;
    await dispatchOnce('event', 'recoverable', async () => { count++; return { ok: false, channel: 'n8n', status: 401, uncertain: false }; }, db);
    const send = async () => { count++; return { ok: true, channel: 'n8n', message_id: 'accepted' }; };
    await Promise.all([dispatchOnce('event', 'recoverable', send, db), dispatchOnce('event', 'recoverable', send, db)]);
    const again = await dispatchOnce('event', 'recoverable', send, db);
    assert.equal(count, 2);
    assert.equal(again.ok, true);
    assert.equal(again.deduplicated, true);
});

test('workflow failure and partial SMTP result remain uncertain', async () => {
    assert.equal((await providerResult(new Response('{"error":"Workflow failed"}', { status: 500 }), 'n8n')).uncertain, true);
    assert.equal((await providerResult(new Response('{"accepted":["a@example.com"],"rejected":["b@example.com"]}'), 'n8n')).uncertain, true);
    assert.equal((await providerResult(new Response('{"error":"Unauthorized"}', { status: 401 }), 'n8n')).uncertain, false);
});

test('EmailClient uses beta path, bearer session, and surfaces logical failure', async () => {
    const calls = [], events = [];
    const context = { AbortController, setTimeout, clearTimeout, console,
        CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } },
        window: { location: { pathname: '/beta/artist/dashboard' }, dispatchEvent: event => events.push(event),
            ConfigManager: { getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } }) } },
        fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ success: false, error: 'SMTP failed' }) }; }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/shared/js/email-client.js'), 'utf8'), context);
    const result = await context.window.EmailClient.sendEmail('client_registration_completed', {});
    assert.equal(calls[0].url, '/beta/api/email/client_registration_completed');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer test-token');
    assert.equal(result.success, false);
    assert.equal(events[0].type, 'weotzi:email-failed');
});

test('deferred client welcome waits for its authenticated user and clears only on success', async () => {
    const values = new Map([['weotzi_pending_client_welcome', 'client-id']]);
    let attempts = 0, success = false;
    const context = { console, localStorage: { getItem: key => values.get(key), removeItem: key => values.delete(key) },
        document: { addEventListener() {} }, supabase: { createClient: () => ({}) },
        window: { ConfigManager: { sendN8NEvent: async () => { attempts++; return { success }; } } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/shared/js/client-auth.js'), 'utf8'), context);
    await context.sendPendingClientWelcome({ id: 'other-user' });
    assert.equal(attempts, 0);
    await context.sendPendingClientWelcome({ id: 'client-id' });
    assert.equal(values.has('weotzi_pending_client_welcome'), true);
    success = true;
    await context.sendPendingClientWelcome({ id: 'client-id' });
    assert.equal(values.has('weotzi_pending_client_welcome'), false);
    assert.equal(attempts, 2);
});
