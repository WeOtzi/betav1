'use strict';

// Ronda 3 · grupo "cotizaciones": P3, P6, P7, P8, P10, P15
// (output/figma-v3/reports/impl-cotizaciones.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const VM = require('../public/shared/js/quotations-view-model.js');
const expiry = require('../lib/quotation-expiry.js');
const terms = require('../lib/terms-acceptance.js');
const notices = require('../public/shared/js/quotation-client-notices.js');
const feedModel = require('../public/shared/js/notification-feed-model.js');
const { EVENTS, resolveRecipients } = require('../services/email-event-mapping.js');
const { resolveEmailContext, SERVER_ONLY_EVENTS } = require('../services/email-request-context.js');

// ---------------------------------------------------------------- P6
test('P6: el selector de estado solo ofrece transiciones que acepta el trigger vivo', () => {
    for (const [from, targets] of Object.entries(VM.STATUS_TRANSITIONS)) {
        for (const to of targets) {
            assert.ok((VM.DB_STATUS_TRANSITIONS[from] || []).includes(to), `${from} → ${to} no está en fn_quotation_status_change`);
            assert.equal(VM.canTransition(from, to), true);
        }
    }
    assert.deepEqual(VM.STATUS_TRANSITIONS.client_approved, ['in_progress', 'cancelled']);
    assert.deepEqual(VM.STATUS_TRANSITIONS.in_progress, ['artist_completed', 'cancelled']);
    assert.deepEqual(VM.STATUS_TRANSITIONS.artist_completed, ['in_progress', 'completed', 'cancelled']);
    assert.equal(VM.canTransition('client_approved', 'expired'), false, 'el trigger rechaza client_approved → expired');
    assert.deepEqual(VM.statusOptions('in_progress').map((o) => o.value), ['in_progress', 'artist_completed', 'cancelled']);
});

test('P6: la copia del trigger coincide con la migración/función documentada', () => {
    // Copia literal leída del proyecto vivo (12 nov 2026). Si el trigger cambia,
    // actualizar DB_STATUS_TRANSITIONS y este test juntos.
    assert.deepEqual(VM.DB_STATUS_TRANSITIONS.pending, ['responded', 'expired', 'cancelled']);
    assert.deepEqual(VM.DB_STATUS_TRANSITIONS.responded, ['client_approved', 'client_rejected', 'expired']);
    assert.deepEqual(VM.DB_STATUS_TRANSITIONS.completed, []);
});

// ---------------------------------------------------------------- P7
test('P7: ACEPTAR del resumen abre el diálogo de presupuesto del detalle', () => {
    const accept = VM.summaryActions({ quote_status: 'pending' }).accept;
    assert.equal(accept.needsDialog, true);
    assert.equal(VM.respondUrl({ quote_id: 'WO-1', id: 9 }), '/my-quotations/detail?id=WO-1&modal=responder');
    const summary = read('public/shared/js/quotations-summary.js');
    assert.match(summary, /if \(a\.needsDialog\) return goRespond\(quote\);/);
    assert.match(summary, /value === 'responded' && VM\.RESPOND_NEEDS_DIALOG\) return goRespond\(quote\)/);
    assert.doesNotMatch(summary, /Cotización aceptada y enviada al cliente/, 'ya no se copia el presupuesto del cliente sin preguntar');
    // El detalle abre el diálogo con ?modal=responder y avisa por artist_responded_quotation.
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.match(detail, /responder: openRespondDialog/);
    assert.match(detail, /notify\('artist_responded_quotation'/);
});

// ---------------------------------------------------------------- P8
test('P8: eventos de aviso al cliente con plantilla y destinatario de la cotización', () => {
    for (const id of ['artist_rejected_quotation', 'quotation_ready_for_client', 'dispute_artist_response', 'quotation_expired']) {
        assert.ok(EVENTS[id], `falta ${id}`);
        assert.ok(fs.existsSync(path.join(ROOT, 'templates/email', `${EVENTS[id].templateHint}.html`)), `falta plantilla ${id}`);
    }
    assert.deepEqual(resolveRecipients('dispute_artist_response', { client_email: 'c@example.com', support_email: 'soporte@example.com' }),
        ['c@example.com', 'soporte@example.com']);
    assert.ok(SERVER_ONLY_EVENTS.has('quotation_expired'));
    assert.equal(notices.eventForStatus('cancelled', 'pending'), 'artist_rejected_quotation');
    assert.equal(notices.eventForStatus('artist_completed', 'in_progress'), 'quotation_ready_for_client');
    assert.equal(notices.eventForStatus('in_progress', 'client_approved'), null);
    assert.equal(notices.eventForStatus('cancelled', 'cancelled'), null);
});

const request = { headers: { host: 'weotzi.com' }, weotziBasePath: '/beta' };
const baseQuote = { id: 7, quote_id: 'WO-7', artist_id: 'artist-id', client_user_id: 'client-id',
    artist_email: 'artist@example.com', client_email: 'client@example.com', client_full_name: 'Cliente',
    created_at: new Date().toISOString(), quote_status: 'cancelled' };
function deps(user, records = {}) {
    return { resolveUser: async () => user, read: async (table) => records[table] !== undefined ? records[table] : null,
        verifyAdmin: async () => ({ ok: false, status: 403, error: 'Admin required' }) };
}
const artist = { id: 'artist-id', email: 'artist@example.com' };

test('P8: el rechazo solo se avisa si la cotización guardada está rechazada y va al cliente guardado', async () => {
    const ok = await resolveEmailContext(request, 'artist_rejected_quotation', { quote_id: 'WO-7', client_email: 'victim@example.com' },
        deps(artist, { quotations_db: baseQuote, artists_db: { user_id: 'artist-id', email: 'artist@example.com', name: 'Ana' } }));
    assert.equal(ok.ok, true);
    assert.equal(ok.payload.client_email, 'client@example.com');
    assert.equal(ok.payload.dashboard_url, 'https://weotzi.com/beta/client/dashboard');
    const stale = await resolveEmailContext(request, 'artist_rejected_quotation', { quote_id: 'WO-7' },
        deps(artist, { quotations_db: { ...baseQuote, quote_status: 'pending' } }));
    assert.equal(stale.status, 409);
    const stranger = await resolveEmailContext(request, 'quotation_ready_for_client', { quote_id: 'WO-7' },
        deps({ id: 'otro', email: 'x@example.com' }, { quotations_db: { ...baseQuote, quote_status: 'artist_completed' } }));
    assert.equal(stranger.status, 403);
    const clientCannot = await resolveEmailContext(request, 'quotation_ready_for_client', { quote_id: 'WO-7' },
        deps({ id: 'client-id', email: 'client@example.com' }, { quotations_db: { ...baseQuote, quote_status: 'artist_completed' } }));
    assert.equal(clientCannot.status, 403, 'el cliente no dispara avisos del artista');
});

test('P8: la respuesta a la disputa exige la respuesta guardada', async () => {
    const quote = { ...baseQuote, quote_status: 'in_progress' };
    const missing = await resolveEmailContext(request, 'dispute_artist_response', { quote_id: 'WO-7', dispute_id: 3 },
        deps(artist, { quotations_db: quote, quotation_disputes: { id: 3, quotation_id: 7, artist_response: '' } }));
    assert.equal(missing.status, 409);
    const ok = await resolveEmailContext(request, 'dispute_artist_response', { quote_id: 'WO-7', dispute_id: 3 },
        deps(artist, { quotations_db: quote, quotation_disputes: { id: 3, quotation_id: 7, artist_response: 'Te propongo un retoque sin cargo.', artist_responded_at: '2026-11-12T10:00:00Z' } }));
    assert.equal(ok.ok, true);
    assert.match(ok.idempotencyKey, /:dispute:3:/);
    assert.equal(ok.payload.artist_response, 'Te propongo un retoque sin cargo.');
    assert.equal((await resolveEmailContext(request, 'quotation_expired', { quote_id: 'WO-7' }, deps(artist, { quotations_db: quote }))).status, 403);
});

test('P8: el detalle y el resumen avisan al cliente y el feed in-app del cliente lo muestra', () => {
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.match(detail, /noticeClient\('cancelled', previous\)/);
    assert.match(detail, /noticeClient\('artist_completed', previous\)/);
    assert.match(detail, /noticeClient\('dispute', dispute\.id\)/);
    const summary = read('public/shared/js/quotations-summary.js');
    assert.match(summary, /noticeClient\(quote, r\.patch\.quote_status, previous\)/);
    const client = read('public/shared/js/client-dashboard.js');
    assert.match(client, /cancelled: \{ icon: 'x-circle'/);
    assert.match(client, /expired: \{ icon: 'clock'/);
    assert.match(client, /respondió tu disputa/);
    for (const page of ['public/my-quotations/index.html', 'public/my-quotations/detail/index.html']) {
        assert.match(read(page), /quotation-client-notices\.js/);
    }
});

// ---------------------------------------------------------------- P10
// Decisión del dueño (13 nov 2026): el vencimiento es opcional y por
// cotización (quote_expiry_enabled + quote_expiry_days, migración
// 20261113100000). Los casos detallados viven en tests/r3b-vencimiento.test.js.
test('P10: sin vencimiento activado nada vence; con vencimiento, la vista coincide con el servidor', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    const on = { quote_expiry_enabled: true, quote_expiry_days: 14 };
    const cases = [
        { quote: { quote_status: 'responded', artist_responded_at: '2026-10-28T11:00:00Z' }, expired: false },
        { quote: { quote_status: 'responded', artist_responded_at: '2026-10-28T11:00:00Z', ...on }, expired: true },
        { quote: { quote_status: 'responded', artist_responded_at: '2026-11-01T12:00:00Z', ...on }, expired: false },
        { quote: { quote_status: 'responded', artist_responded_at: '2026-10-01T00:00:00Z', quote_expires_at: '2026-12-01T00:00:00Z', ...on }, expired: false },
        { quote: { quote_status: 'responded', artist_responded_at: '2026-11-10T00:00:00Z', quote_expires_at: '2026-11-11T00:00:00Z' }, expired: false },
        { quote: { quote_status: 'responded', artist_responded_at: '2026-11-10T00:00:00Z', quote_expires_at: '2026-11-11T00:00:00Z', ...on }, expired: true },
        { quote: { quote_status: 'pending', created_at: '2020-01-01T00:00:00Z', ...on }, expired: false },
        { quote: { quote_status: 'client_approved', artist_responded_at: '2020-01-01T00:00:00Z', ...on }, expired: false }
    ];
    for (const { quote, expired } of cases) {
        assert.equal(expiry.isOfferExpired(quote, now), expired, JSON.stringify(quote));
        assert.equal(VM.effectiveStatus(quote, now) === 'expired', expired, JSON.stringify(quote));
    }
    assert.equal(VM.stageBadge({ quote_status: 'responded', artist_responded_at: '2020-01-01T00:00:00Z' }, []).label === 'Vencida', false);
    assert.equal(VM.stageBadge({ quote_status: 'responded', artist_responded_at: '2020-01-01T00:00:00Z', ...on }, []).label, 'Vencida');
    assert.equal(expiry.DEFAULT_VALIDITY_DAYS, 14);
    assert.equal(VM.DEFAULT_VALIDITY_DAYS, 14);
});

test('P10: configuración por entorno: job prendido por defecto, cada hora, se apaga con off', () => {
    const def = expiry.expiryConfig({});
    assert.deepEqual(expiry.rpcBody(def), { p_limit: 500, p_opt_in_only: true });
    assert.equal(def.jobEnabled, true);
    assert.equal(def.intervalMinutes, 60);
    assert.equal(def.emailEnabled, true);
    const custom = expiry.expiryConfig({ QUOTATION_EXPIRY_BATCH: '9999', QUOTATION_EXPIRY_JOB: 'off', QUOTATION_EXPIRY_EMAIL: 'off' });
    assert.equal(custom.limit, 2000);
    assert.equal(custom.jobEnabled, false);
    assert.equal(custom.emailEnabled, false);
});

test('P10: el ciclo vence por RPC y avisa solo a clientes con propuesta vencida, una vez', async () => {
    const sent = [];
    const result = await expiry.runExpiryCycle({
        rpc: async (body) => {
            assert.deepEqual(body, { p_limit: 500, p_opt_in_only: true });
            return [
                { id: 1, quote_id: 'WO-1', old_status: 'responded', client_email: 'a@example.com', artist_name: 'Ana' },
                { id: 2, quote_id: 'WO-2', old_status: 'pending', client_email: 'b@example.com' },
                { id: 3, quote_id: 'WO-3', old_status: 'responded', client_email: null }
            ];
        },
        sendEmail: async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return { ok: true }; },
        baseUrl: 'https://weotzi.com/beta/'
    }, expiry.expiryConfig({}));
    assert.equal(result.expired, 3);
    assert.equal(result.notified, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].eventId, 'quotation_expired');
    assert.equal(sent[0].options.idempotencyKey, 'quotation_expired:WO-1');
    assert.equal(sent[0].payload.dashboard_url, 'https://weotzi.com/beta/client/dashboard');
});

test('P10: el job interno se apaga con off y tolera la migración sin aplicar', async () => {
    const calls = [];
    const timers = {
        setTimeout: (fn) => { calls.push(['t', fn]); return 1; }, setInterval: (fn, ms) => { calls.push(['i', fn, ms]); return 2; },
        clearTimeout: () => {}, clearInterval: () => {}
    };
    expiry.startExpiryJob({ rpc: async () => [] }, expiry.expiryConfig({ QUOTATION_EXPIRY_JOB: 'off' }), timers);
    assert.equal(calls.length, 0, 'apagado con off');
    const warnings = [];
    const stop = expiry.startExpiryJob({
        rpc: async () => { throw new Error('PostgREST POST rpc/expire_stale_quotations failed (404): PGRST202 Could not find the function'); },
        log: { log() {}, warn: (m) => warnings.push(m), error: (m) => warnings.push('ERR ' + m) }
    }, expiry.expiryConfig({ QUOTATION_EXPIRY_INTERVAL_MIN: '30' }), timers);
    assert.equal(calls.find((c) => c[0] === 'i')[2], 30 * 60 * 1000);
    await calls[0][1]();
    await calls[0][1]();
    assert.equal(warnings.length, 1, 'avisa una sola vez');
    assert.match(warnings[0], /20261113100000/);
    stop();
});

test('P10: migración aditiva con RPC solo service_role, guard de vigencia y reversa', () => {
    const sql = read('supabase/migrations/20261112160000_quotation_expiry_terms.sql');
    assert.match(sql, /add column if not exists quote_expires_at timestamptz/);
    assert.match(sql, /create or replace function public\.expire_stale_quotations/);
    assert.match(sql, /security definer/);
    assert.match(sql, /trg_guard_quotation_expires_at/);
    assert.doesNotMatch(sql, /\bdelete from\b|\bdrop table\b/i, 'no borra datos');
    assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rollbacks/20261112160000_quotation_expiry_terms.down.sql')));
    const server = read('server.js');
    assert.match(server, /\/\/ ── cotizaciones ──/);
    assert.match(server, /app\.post\('\/api\/quotations\/maintenance\/expire'/);
    assert.match(server, /storeOrders\.safeTokenEqual\(req\.headers\['x-cron-token'\], expected\)/);
    // El diálogo de respuesta guarda el vencimiento opcional (columnas opcionales mientras no se aplique).
    assert.match(read('public/shared/js/data/quotation-detail-repo.js'), /'quote_expiry_enabled', 'quote_expiry_days'/);
    assert.match(read('public/shared/js/quotation-detail-figma.js'), /\.\.\.readExpiry\(data\.expiry_enabled === '1', data\.expiry_days\)/);
});

// ---------------------------------------------------------------- P15
test('P15: contraofertas pendientes generan "Contraoferta recibida" con deep link', () => {
    const items = feedModel.counterOfferItems({
        jb: [
            { app: { id: 'a1', status: 'pending', job_board_requests: { display_title: 'Dragón en la espalda' } },
              offers: [{ id: 'o1', author_role: 'client', status: 'pendiente', created_at: '2026-11-11T10:00:00Z' }] },
            { app: { id: 'a2', status: 'viewed' }, offers: [{ id: 'o2', author_role: 'artist', status: 'pendiente' }] }
        ],
        spots: [
            { app: { id: 's1', status: 'shortlisted', studio_spots: { title: 'Guest spot Madrid' } },
              offers: [{ id: 'o3', author_role: 'studio', status: 'pending', created_at: '2026-11-10T10:00:00Z' }] }
        ]
    }, new Set(['cof:spot:o3']));
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'Contraoferta recibida');
    assert.equal(items[0].href, '/artist/applications?type=jobboard&id=a1&from=jobboard');
    assert.match(items[0].desc, /Dragón en la espalda/);
    assert.equal(items[0].unread, true);
    assert.equal(items[1].href, '/artist/applications?type=spot&id=s1&from=spots');
    assert.equal(items[1].unread, false);
    assert.deepEqual(feedModel.openJbApplications([{ status: 'pending' }, { status: 'accepted' }, { status: 'viewed' }]).length, 2);
    const menu = read('public/shared/js/wo-artist-menu.js');
    assert.match(menu, /notification-feed-model\.js/);
    assert.match(menu, /pushCounterOffers\('jb'/);
    assert.match(menu, /pushCounterOffers\('spots'/);
});

// ---------------------------------------------------------------- P3
test('P3: aceptación de términos: fecha + versión, borrador una vez, finalize siempre', () => {
    const now = '2026-11-12T10:00:00.000Z';
    assert.deepEqual(terms.termsAcceptancePatch({}, { now }), {});
    assert.deepEqual(terms.termsAcceptancePatch({ terms_accepted: false }, { now }), {});
    assert.deepEqual(terms.termsAcceptancePatch({ terms_accepted: true }, { now }), { terms_accepted_at: now, terms_version: terms.TERMS_VERSION });
    assert.deepEqual(terms.termsAcceptancePatch({ terms_accepted: 'true' }, {
        now, existing: { terms_accepted_at: '2026-11-01T00:00:00Z', terms_version: terms.TERMS_VERSION }
    }), {}, 'el borrador no re-sella la misma versión');
    assert.deepEqual(terms.termsAcceptancePatch({ terms_accepted: true }, {
        now, force: true, existing: { terms_accepted_at: '2026-11-01T00:00:00Z', terms_version: terms.TERMS_VERSION }
    }), { terms_accepted_at: now, terms_version: terms.TERMS_VERSION });
});

test('P3: si la migración no está aplicada, el registro guarda sin las columnas de términos', async () => {
    const bodies = [];
    const { result, termsSaved } = await terms.writeWithTermsFallback({ name: 'Ana', terms_accepted_at: 'x', terms_version: 'v' }, async (body) => {
        bodies.push(body);
        if ('terms_accepted_at' in body) throw new Error('PostgREST PATCH artists_db failed (400): {"code":"PGRST204","message":"Could not find the \'terms_accepted_at\' column of \'artists_db\' in the schema cache"}');
        return [{ id: 1 }];
    });
    assert.deepEqual(result, [{ id: 1 }]);
    assert.equal(termsSaved, false);
    assert.deepEqual(bodies[1], { name: 'Ana' });
    await assert.rejects(terms.writeWithTermsFallback({ terms_version: 'v' }, async () => { throw new Error('duplicate key 23505'); }), /23505/);
});

test('P3: finalize exige los términos y Crear cuenta los manda al borrador', () => {
    const server = read('server.js');
    assert.match(server, /code: 'TERMS_REQUIRED'/);
    assert.match(server, /termsAcceptance\.termsAcceptancePatch\(formData, \{ force: true \}\)/);
    assert.match(server, /termsAcceptance\.termsAcceptancePatch\(formData, \{ existing \}\)/);
    assert.match(read('public/shared/js/main.js'), /extraData: \{ \.\.\.signup\.draftData, terms_accepted: terms \}/);
    // El wizard ya manda formState.data (con terms_accepted) al finalize.
    assert.match(read('public/shared/js/register.js'), /data: \{ \.\.\.formState\.data, registration_source: registrationSource \}/);
    const sql = read('supabase/migrations/20261112160000_quotation_expiry_terms.sql');
    assert.match(sql, /add column if not exists terms_accepted_at timestamptz/);
    assert.match(sql, /trg_guard_artist_terms_acceptance/);
});
