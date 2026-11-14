'use strict';

// Canal smtp_relay (render en servidor + webhook genérico de n8n), escape de
// los datos que viajan a n8n, preferencias del cliente y envíos server-side.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.N8N_EMAIL_RELAY_URL = 'https://n8n.example.test/webhook/weotzi-email-relay';
process.env.N8N_EMAIL_RELAY_TOKEN = 'relay-secret';

const service = require('../services/email-service');
const prefs = require('../lib/notification-prefs');
const { fixtureFor } = require('../lib/email-render/fixtures');
const routes = require('../lib/routes/emails');
const sessionReminders = require('../lib/session-reminders');
const { serverQuotationContext, resolveEmailContext } = require('../services/email-request-context');

function fakeQuery(tables) {
    return (table) => {
        const filters = [];
        const api = {
            select() { return api; }, limit() { return api; }, single() { api._single = true; return api; },
            eq(col, val) { filters.push([col, val]); return api; }, ilike(col, val) { filters.push([col, String(val).replace(/\\/g, '')]); return api; },
            gte() { return api; }, lte() { return api; }, order() { return api; },
            async execute() {
                const rows = (tables[table] || []).filter(row => filters.every(([c, v]) => String(row[c]).toLowerCase() === String(v).toLowerCase()));
                return api._single ? rows[0] || null : rows;
            }
        };
        return api;
    };
}

function stubFetch(handler) {
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts, body: opts.body ? JSON.parse(opts.body) : null });
        if (String(url).includes('/rest/v1/')) return new Response('[]', { status: 200 });
        return handler(String(url), opts);
    };
    return { calls, restore: () => { global.fetch = original; } };
}

const relayCalls = calls => calls.filter(c => c.url === process.env.N8N_EMAIL_RELAY_URL);

test('relé: un POST por destinatario con asunto, HTML, texto y headers; token del relé', async () => {
    const net = stubFetch(() => new Response(JSON.stringify({ messageId: 'mid-1' }), { status: 200 }));
    try {
        const result = await service.sendEmail('session_scheduled', fixtureFor('session_scheduled'), {
            forceChannel: 'smtp_relay', prefsDeps: { query: fakeQuery({}) }
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        const sent = relayCalls(net.calls);
        assert.deepEqual(sent.map(c => c.body.to).sort(), ['lucia.cliente@example.com', 'mateo.artista@example.com']);
        for (const call of sent) {
            assert.equal(call.opts.headers['X-Weotzi-Webhook-Token'], 'relay-secret');
            assert.ok(call.body.subject && call.body.html && call.body.text);
            assert.equal(call.body.headers['X-Weotzi-Event'], 'session_scheduled');
            assert.match(call.body.headers['List-Unsubscribe'], /#notificaciones>/);
            assert.equal(typeof call.body.to, 'string');
        }
        const artist = sent.find(c => c.body.role === 'artist');
        assert.match(artist.body.html, /\/calendar/);
        assert.doesNotMatch(artist.body.html, /client\/dashboard\?quote/);
    } finally {
        net.restore();
    }
});

test('relé: un rol con el aviso apagado se omite y el resto sale; el resultado no es error', async () => {
    const net = stubFetch(() => new Response(JSON.stringify({ messageId: 'mid-2' }), { status: 200 }));
    try {
        const query = fakeQuery({
            artists_db: [{ user_id: '22222222-2222-4222-8222-222222222222', email: 'mateo.artista@example.com' }],
            user_preferences: [{ user_id: '22222222-2222-4222-8222-222222222222', notification_prefs: { calendario: { email: false } } }]
        });
        const result = await service.sendEmail('session_scheduled', fixtureFor('session_scheduled'), { forceChannel: 'smtp_relay', prefsDeps: { query } });
        assert.equal(result.ok, true);
        assert.deepEqual(relayCalls(net.calls).map(c => c.body.role), ['client']);
        assert.ok(result.results.some(r => r.role === 'artist' && r.delivery_status === 'skipped_by_preference'));
    } finally {
        net.restore();
    }
});

test('un evento sin webhook de n8n sale por el relé (instagram_verification_code, EM-02 / VER-N1)', async () => {
    const net = stubFetch(() => new Response(JSON.stringify({ messageId: 'mid-3' }), { status: 200 }));
    try {
        const channel = await service.resolveChannel('instagram_verification_code', { channel: 'n8n' }, {});
        assert.equal(channel, 'smtp_relay');
        const result = await service.sendEmail('instagram_verification_code', fixtureFor('instagram_verification_code'), { prefsDeps: { query: fakeQuery({}) } });
        assert.equal(result.ok, true, JSON.stringify(result));
        const [call] = relayCalls(net.calls);
        assert.equal(call.body.to, 'mateo.artista@example.com');
        assert.match(call.body.html, /WO-4F7K2Q/);
        assert.equal(call.body.headers['List-Unsubscribe'], undefined, 'transaccional: sin baja');
    } finally {
        net.restore();
    }
});

test('relé sin messageId queda incierto (no se reenvía solo)', async () => {
    const net = stubFetch(() => new Response(JSON.stringify({ message: 'Workflow was started' }), { status: 200 }));
    try {
        const result = await service.sendViaRelay('instagram_verification_code', fixtureFor('instagram_verification_code'), {}, { to: 'a@example.com', role: 'artist' });
        assert.equal(result.ok, false);
        assert.equal(result.uncertain, true);
    } finally {
        net.restore();
    }
});

test('EM-01: un flujo que manda varios correos solo es OK si todos traen messageId', async () => {
    const all = await service.providerResult(new Response(JSON.stringify([{ messageId: 'a' }, { messageId: 'b' }, { messageId: 'c' }])), 'n8n');
    assert.equal(all.ok, true);
    const partial = await service.providerResult(new Response(JSON.stringify([{ messageId: 'a' }, { messageId: 'b' }, {}])), 'n8n');
    assert.equal(partial.ok, false);
    assert.equal(partial.uncertain, true);
    assert.equal(partial.partial, true);
});

test('EM-N4: lo que viaja a n8n va escapado, con URLs validadas y sin datos de salud', async () => {
    const net = stubFetch(() => new Response(JSON.stringify({ messageId: 'n8n-1' }), { status: 200 }));
    try {
        await service.sendViaN8N('chat_message_to_artist', {
            ...fixtureFor('chat_message_to_artist'),
            message_preview: '<a href="https://evil.example">ganaste</a>',
            client_health_conditions: 'SECRETO', chat_url: 'javascript:alert(1)'
        }, { n8n_webhook_url: 'https://n8n.example.test/webhook/weotzi-chat-artist' });
        const call = net.calls.find(c => c.url.endsWith('weotzi-chat-artist'));
        assert.equal(call.body.data.message_preview, '&lt;a href=&quot;https://evil.example&quot;&gt;ganaste&lt;/a&gt;');
        assert.equal(call.body.data.client_health_conditions, undefined);
        assert.equal(call.body.data.chat_url, '');
        assert.equal(call.body.vars.message_preview, call.body.data.message_preview);
        assert.ok(call.body.rendered && /<!DOCTYPE html>/.test(call.body.rendered.html), 'body.rendered para migrar nodos');
    } finally {
        net.restore();
    }
});

test('EM-N3: las preferencias del cliente se respetan (y el artista sigue recibiendo)', async () => {
    const query = fakeQuery({
        clients_db: [{ user_id: 'client-1', email: 'lucia.cliente@example.com' }],
        user_preferences: [{ user_id: 'client-1', notification_prefs: { mensajes: { email: false }, cotizaciones: { email: true } } }]
    });
    const deps = { query, resolveRecipients: require('../services/email-event-mapping').resolveRecipients };
    const chat = await prefs.applyEmailPreferences('chat_message_to_client', { client_email: 'lucia.cliente@example.com', client_user_id: 'client-1' }, deps);
    assert.equal(chat.skip, true);
    const quote = await prefs.applyEmailPreferences('artist_responded_quotation', { client_email: 'lucia.cliente@example.com', client_user_id: 'client-1' }, deps);
    assert.equal(quote.skip, false);
    assert.equal((await prefs.allowRecipient('chat_message_to_client', { role: 'client', email: 'lucia.cliente@example.com' }, { query })).allowed, false);
    assert.equal((await prefs.allowRecipient('client_quotation_submitted', { role: 'client', email: 'lucia.cliente@example.com' }, { query })).allowed, true, 'transaccional');
    assert.equal(prefs.resolvePreference({ postulaciones: { email: false } }, 'postulaciones', 'email', { defaults: prefs.CLIENT_NOTIF_DEFAULTS }), false);
});

test('inbox: avisa al otro participante con ventana de 15 min y no si ya leyó', async () => {
    const tables = {
        inbox_messages: { id: '4a1f2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', thread_id: 'th-1', sender_user_id: 'artist-1', body: 'Hola <b>Estudio</b>', created_at: '2026-11-14T12:00:00Z' },
        inbox_threads: { id: 'th-1', artist_user_id: 'artist-1', counterparty_user_id: 'studio-owner', subject: 'Guest spot' },
        artists_db: null, clients_db: null,
        studios: { user_id: 'studio-owner', email: 'estudio@example.com', name: 'Estudio Norte' }
    };
    let lastRead = null;
    const deps = {
        resolveUser: async () => ({ id: 'artist-1', email: 'artista@example.com' }),
        read: async (table, filters) => {
            if (table === 'artists_db') return filters.user_id === 'artist-1' ? { user_id: 'artist-1', name: 'Mateo', email: 'artista@example.com' } : null;
            if (table === 'studios') return filters.user_id === 'studio-owner' ? tables.studios : null;
            if (table === 'inbox_messages') return filters.sender_user_id === 'artist-1' ? tables.inbox_messages : null;
            return tables[table] || null;
        },
        listParticipants: async () => [{ user_id: 'artist-1' }, { user_id: 'studio-owner', last_read_at: lastRead }]
    };
    const ctx = await resolveEmailContext({ headers: {} }, 'inbox_message_received', { message_id: '4a1f2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }, deps);
    assert.equal(ctx.ok, true, ctx.error);
    assert.equal(ctx.payload.recipient_email, 'estudio@example.com');
    assert.equal(ctx.payload.recipient_role, 'studio');
    assert.equal(ctx.payload.sender_name, 'Mateo');
    assert.match(ctx.payload.chat_url, /\/studio\/dashboard\?thread=th-1$/);
    assert.match(ctx.idempotencyKey, /^inbox:th-1:studio-owner:\d+$/);
    assert.equal(await ctx.defer.stillPending(), true);
    lastRead = '2026-11-14T12:05:00Z';
    assert.equal(await ctx.defer.stillPending(), false);
    const stranger = await resolveEmailContext({ headers: {} }, 'inbox_message_received', { message_id: '4a1f2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }, { ...deps, resolveUser: async () => ({ id: 'otro' }) });
    assert.equal(stranger.ok, false);
    // message_id con forma de UUID antes de cualquier lectura.
    const reads = [];
    const bad = await resolveEmailContext({ headers: {} }, 'inbox_message_received', { message_id: "1' or 1=1" }, { ...deps, read: async (...args) => { reads.push(args); return null; } });
    assert.equal(bad.status, 400);
    assert.equal(reads.filter(([table]) => table === 'inbox_messages').length, 0);
});

test('cierre por el cliente: resumen a ambos + pedido de reseña, solo si está completada', async () => {
    const quote = { id: 9, quote_id: 'WO-9', quote_status: 'completed', client_email: 'c@example.com', client_full_name: 'Lucía', artist_id: 'a-1', client_health_conditions: 'SECRETO', client_completed_at: '2026-11-14T10:00:00Z' };
    const read = async (table) => (table === 'quotations_db' ? quote : table === 'artists_db' ? { user_id: 'a-1', email: 'a@example.com', name: 'Mateo' } : null);
    const sent = [];
    const out = await routes.notifyQuotationCompleted('WO-9', {
        serverQuotationContext: (eventId, id) => serverQuotationContext(eventId, id, { read, baseUrl: 'https://beta.weotzi.com' }),
        sendEmail: async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return { ok: true }; }
    });
    assert.deepEqual(sent.map(s => s.eventId), ['quotation_completed_summary', 'request_rating']);
    assert.equal(sent[0].payload.artist_email, 'a@example.com');
    assert.equal(sent[0].payload.client_health_conditions, undefined);
    assert.match(sent[1].options.idempotencyKey, /^WO-9:request_rating:/);
    assert.equal(out.request_rating.ok, true);
    const pending = await serverQuotationContext('request_rating', 'WO-9', { read: async (t) => (t === 'quotations_db' ? { ...quote, quote_status: 'artist_completed' } : null) });
    assert.equal(pending.status, 409);
});

test('verificación: relee el estado guardado y manda el correo que corresponde una vez por día', async () => {
    const sent = [];
    const deps = state => ({
        fetchArtist: async () => ({ user_id: '33333333-3333-4333-8333-333333333333', email: 'a@example.com', name: 'Mateo', verification_state: state }),
        sendEmail: async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return { ok: true }; },
        baseUrl: 'https://beta.weotzi.com', now: Date.parse('2026-11-14T12:00:00Z')
    });
    const body = { artist_user_id: '33333333-3333-4333-8333-333333333333', reason: 'Documento borroso' };
    assert.equal((await routes.notifyArtistVerification(body, deps('Yes'))).eventId, 'profile_verified');
    assert.equal((await routes.notifyArtistVerification(body, deps('Denied'))).eventId, 'profile_verification_denied');
    assert.equal(sent[1].payload.reason, 'Documento borroso');
    assert.equal(sent[0].payload.reason, '');
    assert.equal(sent[0].options.idempotencyKey, 'verify:33333333-3333-4333-8333-333333333333:Yes:2026-11-14');
    assert.equal((await routes.notifyArtistVerification(body, deps('Requested'))).sent, false);
    assert.equal((await routes.notifyArtistVerification({ artist_user_id: 'x' }, deps('Yes'))).status, 400);
});

test('recordatorio 24 h: busca la ventana 23-25 h y envía con clave por sesión y fecha', async () => {
    const sent = [];
    const query = fakeQuery({
        quotation_sessions: [{ id: 's-1', quotation_id: 9, session_number: 1, session_date: '2026-11-15T14:00:00Z', status: 'scheduled' }],
        quotations_db: [{ id: 9, quote_id: 'WO-9', quote_status: 'in_progress', client_email: 'c@example.com', client_full_name: 'Lucía', artist_id: 'a-1' }],
        artists_db: [{ user_id: 'a-1', email: 'a@example.com', name: 'Mateo' }]
    });
    const summary = await sessionReminders.dispatchSessionReminders({ query, sendEmail: async (...args) => { sent.push(args); return { ok: true }; },
        baseUrl: 'https://beta.weotzi.com', now: Date.parse('2026-11-14T14:30:00Z') });
    assert.deepEqual(summary, { found: 1, sent: 1, skipped: 0, failed: 0 });
    assert.equal(sent[0][0], 'session_reminder_24h');
    assert.equal(sent[0][2].idempotencyKey, 'reminder24:s-1:2026-11-15T14:00:00Z');
    assert.equal(sent[0][1].artist_email, 'a@example.com');
    const w = sessionReminders.reminderWindow(Date.parse('2026-11-14T00:00:00Z'));
    assert.deepEqual(w, { from: '2026-11-14T23:00:00.000Z', to: '2026-11-15T01:00:00.000Z' });
    assert.equal(sessionReminders.intervalFromEnv({ SESSION_REMINDERS_JOB: 'off' }), 0);
    assert.equal(sessionReminders.intervalFromEnv({}), 30 * 60 * 1000);
    // Cotizaciones rechazadas por cualquiera de las partes no reciben recordatorio.
    for (const status of ['client_rejected', 'artist_rejected', 'cancelled', 'expired']) {
        const none = [];
        const q = fakeQuery({
            quotation_sessions: [{ id: 's-2', quotation_id: 10, session_number: 1, session_date: '2026-11-15T14:00:00Z', status: 'scheduled' }],
            quotations_db: [{ id: 10, quote_id: 'WO-10', quote_status: status, client_email: 'c@example.com', artist_id: 'a-1' }],
            artists_db: [{ user_id: 'a-1', email: 'a@example.com', name: 'Mateo' }]
        });
        const out = await sessionReminders.dispatchSessionReminders({ query: q, sendEmail: async (...args) => { none.push(args); return { ok: true }; },
            baseUrl: 'https://beta.weotzi.com', now: Date.parse('2026-11-14T14:30:00Z') });
        assert.equal(none.length, 0, status);
        assert.equal(out.skipped, 1, status);
    }
});

test('resolveRequestUser: un fallo de Auth no se cachea; un usuario válido sí', async () => {
    const token = 'Bearer tok-' + Date.now();
    let calls = 0;
    const flaky = async () => { calls += 1; return calls === 1 ? null : { id: 'u-1' }; };
    assert.equal(await routes.resolveRequestUser({ headers: { authorization: token } }, flaky), null);
    assert.deepEqual(await routes.resolveRequestUser({ headers: { authorization: token } }, flaky), { id: 'u-1' });
    assert.deepEqual(await routes.resolveRequestUser({ headers: { authorization: token } }, flaky), { id: 'u-1' });
    assert.equal(calls, 2, 'el segundo pedido reintenta; el tercero sale de la caché');
});

test('disputa: la copia de soporte lleva al panel de soporte', () => {
    const { renderEmail } = require('../lib/email-render');
    const out = renderEmail('dispute_artist_response', fixtureFor('dispute_artist_response'), { role: 'support' });
    assert.equal(out.cta.url, 'https://beta.weotzi.com/support/dashboard');
});

test('CC-19: el JSON público no expone URLs de webhooks', () => {
    const config = { n8n: { webhookUrl: 'https://n8n/x', driveFolderId: 'f', events: [{ id: 'a', webhookUrl: 'https://n8n/y', enabled: true }] } };
    routes.stripPublicWebhooks(config);
    assert.equal(config.n8n.webhookUrl, undefined);
    assert.deepEqual(config.n8n.events, [{ id: 'a', enabled: true, webhookUrl: '' }]);
    assert.equal(config.n8n.driveFolderId, 'f');
});

test('reseña del cliente: relee verified_reviews y avisa al artista una vez por reseña', async () => {
    const quote = { id: 9, quote_id: 'WO-9', quote_status: 'completed', client_user_id: 'c-1', client_email: 'c@example.com', artist_id: 'a-1' };
    const deps = review => ({
        resolveUser: async () => ({ id: 'c-1', email: 'c@example.com' }),
        read: async (table, filters) => (table === 'quotations_db' ? (filters.quote_id === '9' ? null : quote)
            : table === 'artists_db' ? { user_id: 'a-1', email: 'a@example.com', name: 'Mateo' }
                : table === 'verified_reviews' ? review : null)
    });
    const ok = await resolveEmailContext({ headers: {} }, 'client_left_rating', { quote_id: '9' }, deps({ id: 'r-1', rating: 5, comment: 'Excelente' }));
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.payload.rating, 5);
    assert.equal(ok.idempotencyKey, 'WO-9:review:r-1');
    const missing = await resolveEmailContext({ headers: {} }, 'client_left_rating', { quote_id: 'WO-9' }, deps(null));
    assert.equal(missing.status, 409);
    const reviewsJs = require('node:fs').readFileSync(require.resolve('../public/shared/js/reviews.js'), 'utf8');
    assert.match(reviewsJs, /sendN8NEvent\('client_left_rating', \{ quote_id: String\(options\.contextId\) \}\)/);
});

test('EMAIL-DUP-01: client_quotation_submitted no le escribe al artista y prefiere el relé', async () => {
    const mapping = require('../services/email-event-mapping');
    const roles = mapping.getEvent('client_quotation_submitted').recipientRoles(fixtureFor('client_quotation_submitted')).map(r => r.role);
    assert.ok(!roles.includes('artist'), 'el artista recibe su aviso propio');
    assert.ok(roles.includes('client'));
    const { SPECS } = require('../lib/email-render/specs');
    assert.equal((SPECS.client_quotation_submitted.roles || {}).artist, undefined);
    // Relé configurado (N8N_EMAIL_RELAY_URL) y sin override del evento: relé.
    assert.equal(await service.resolveChannel('client_quotation_submitted', { channel: 'n8n', channel_source: 'default' }, {}), 'smtp_relay');
    // Con override explícito en email_routing para este evento, se respeta n8n.
    assert.equal(await service.resolveChannel('client_quotation_submitted', { channel: 'n8n', channel_source: 'event', n8n_webhook_url: 'https://n8n.example.test/webhook/x' }, {}), 'n8n');
    // Otro evento con webhook propio no cambia de canal.
    assert.equal(await service.resolveChannel('session_scheduled', { channel: 'n8n', n8n_webhook_url: 'https://n8n.example.test/webhook/s' }, {}), 'n8n');
});
