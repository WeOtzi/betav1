'use strict';

// Beta cerrada · frente "cotizaciones del artista" (COT-A-01…20).
// Migraciones (lectura), avisos del servidor con dobles, rutas y contratos de
// front por lectura de archivos, como el resto de la suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const VM = require('../public/shared/js/quotations-view-model.js');
const DM = require('../public/shared/js/quotation-detail-model.js');
const PM = require('../public/shared/js/quotation-payments-model.js');
const NM = require('../public/shared/js/quotation-new-model.js');
const notices = require('../lib/cot-artista-notices');
const routes = require('../lib/routes/cot-artista');
const EVENTS = require('../services/email-events/cot-artista');
const { normalizeIntake } = require('../services/quotation-intake');

const MIG = {
    source: 'supabase/migrations/20261115120000_quotation_source_manual_prequote.sql',
    transitions: 'supabase/migrations/20261115120100_quotation_transitions_artist.sql',
    deposit: 'supabase/migrations/20261115120200_quotation_deposit.sql',
    tentative: 'supabase/migrations/20261115120300_manual_quote_tentative_at.sql'
};

// ------------------------------------------------------------ migraciones
test('migraciones del frente: rango 20261115120000–999, idempotentes y con reversa', () => {
    for (const rel of Object.values(MIG)) {
        const name = path.basename(rel);
        const ts = Number(name.slice(0, 14));
        assert.ok(ts >= 20261115120000 && ts <= 20261115120999, `${name} fuera de rango`);
        const sql = read(rel);
        assert.match(sql, /^begin;$/m);
        assert.match(sql, /^commit;$/m);
        assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rollbacks', name.replace(/\.sql$/, '.down.sql'))), `${name} sin reversa`);
    }
    assert.match(read(MIG.deposit), /add column if not exists artist_deposit_pct numeric/);
    assert.match(read(MIG.deposit), /drop constraint if exists quotations_db_artist_deposit_pct_check/);
    assert.match(read(MIG.source), /drop constraint if exists quotations_db_source_check/);
    assert.match(read(MIG.transitions), /create or replace function public\.fn_quotation_status_change\(\)/);
    assert.match(read(MIG.tentative), /create or replace function public\.create_manual_quotation\(p_quote jsonb, p_details jsonb\)/);
});

function sourceCheckValues() {
    const sql = read(MIG.source);
    const block = sql.slice(sql.indexOf('add constraint quotations_db_source_check'));
    return [...block.slice(0, block.indexOf(';')).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
}

test('COT-A-01/02: el CHECK de source admite manual y prequote (y los orígenes vivos)', () => {
    const values = sourceCheckValues();
    for (const v of ['direct', 'job_board', 'recommendation', 'web_chat', 'manual', 'prequote']) {
        assert.ok(values.includes(v), `falta ${v}`);
    }
    assert.match(read(MIG.source), /not valid;\s*\nalter table public\.quotations_db\s*\n\s*validate constraint quotations_db_source_check;/);
});

test('COT-A-02: el intake del pre-cotizador guarda un source aceptado por el CHECK', () => {
    const body = { submission_key: '3f2b8c1e-4d5a-4b6c-9d7e-1a2b3c4d5e6f', mode: 'draft', quotation: { source: 'prequote' } };
    const { q } = normalizeIntake(body, null, null);
    // Integración: el pre-cotizador se guarda como web_chat + quotation_medium
    // 'prequote', válido tanto con el CHECK vivo como con el de la migración.
    assert.equal(q.source, 'web_chat');
    assert.equal(q.quotation_medium, 'prequote');
    assert.ok(sourceCheckValues().includes(q.source));
    assert.ok(['direct', 'job_board', 'recommendation', 'web_chat'].includes(q.source), 'también vale con el CHECK vivo');
    const web = normalizeIntake({ ...body, quotation: { source: 'otro' } }, null, null).q;
    assert.ok(sourceCheckValues().includes(web.source));
});

test('COT-A-07/08: la copia DB_STATUS_TRANSITIONS es la del trigger de la migración', () => {
    const sql = read(MIG.transitions);
    const json = sql.slice(sql.indexOf("valid_transitions JSONB := '") + "valid_transitions JSONB := '".length, sql.indexOf("'::JSONB;"));
    assert.deepEqual(JSON.parse(json), VM.DB_STATUS_TRANSITIONS);
    assert.ok(VM.DB_STATUS_TRANSITIONS.responded.includes('cancelled'));
    assert.deepEqual(VM.DB_STATUS_TRANSITIONS.expired, ['responded', 'cancelled']);
    // La reversa vuelve a dejar expired terminal.
    assert.match(read('supabase/rollbacks/20261115120100_quotation_transitions_artist.down.sql'), /"expired": \[\]/);
});

test('COT-A-14: la RPC usa tentative_at y conserva el respaldo de 11:00 sin hora', () => {
    const sql = read(MIG.tentative);
    assert.match(sql, /v_session_at := v_tentative_at::timestamptz;/);
    assert.match(sql, /time '11:00'\) at time zone 'America\/Argentina\/Buenos_Aires'/);
    assert.match(sql, /raise exception 'Fecha tentativa no válida\.' using errcode = '22023'/);
    assert.match(sql, /q\.source := 'manual';/);
});

// ------------------------------------------------------------ selector de estado / resumen
test('COT-A-07: el selector del artista no decide por el cliente ni vence a mano', () => {
    for (const [from, targets] of Object.entries(VM.STATUS_TRANSITIONS)) {
        for (const to of targets) {
            assert.ok(VM.canTransition(from, to), `${from} → ${to}`);
            assert.ok(!['client_rejected', 'completed', 'expired'].includes(to), `${from} → ${to} no es decisión del artista`);
        }
    }
    assert.deepEqual(VM.STATUS_TRANSITIONS.responded, ['client_approved', 'cancelled']);
    assert.equal(VM.dialogUrlFor({ quote_id: 'WO-1' }, 'client_approved'), '/my-quotations/detail?id=WO-1&modal=acuerdo');
    assert.equal(VM.dialogUrlFor({ quote_id: 'WO-1' }, 'responded'), '/my-quotations/detail?id=WO-1&modal=responder');
    const summary = read('public/shared/js/quotations-summary.js');
    assert.match(summary, /value === 'client_approved'\) \{\s*\n\s*window\.location\.href = page\(\)\.appUrl\(VM\.agreementUrl\(quote\)\)/);
    assert.match(summary, /r\.withdraw \? 'Propuesta retirada\.'/);
});

test('COT-A-08: una vencida se vuelve a cotizar desde el resumen y el detalle', () => {
    const accept = VM.summaryActions({ quote_status: 'expired' }).accept;
    assert.equal(accept.label, 'Volver a cotizar');
    assert.equal(accept.needsDialog, true);
    assert.deepEqual(VM.statusOptions('expired').map((o) => o.value), ['expired', 'responded', 'cancelled']);
    assert.deepEqual(DM.commandActions('expired'), ['accept', 'contact']);
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.match(detail, /const label = v\.stage === 'expired' \? 'Volver a cotizar' : 'Aceptar';/);
    assert.match(detail, /title: requote \? 'Volver a cotizar' : 'Aceptar y enviar presupuesto'/);
});

// ------------------------------------------------------------ anticipo (COT-A-09)
test('COT-A-09: depositPatch valida el porcentaje y calcula el monto', () => {
    assert.deepEqual(DM.depositPatch('', 1000).patch, { artist_deposit_pct: null, artist_deposit_amount: null });
    assert.deepEqual(DM.depositPatch('0', 1000).patch, { artist_deposit_pct: null, artist_deposit_amount: null });
    assert.deepEqual(DM.depositPatch('30', 1000).patch, { artist_deposit_pct: 30, artist_deposit_amount: 300 });
    assert.deepEqual(DM.depositPatch('33', 333.33).patch, { artist_deposit_pct: 33, artist_deposit_amount: 110 });
    assert.equal(DM.depositPatch('150', 1000).ok, false);
    assert.equal(DM.depositPatch('-5', 1000).ok, false);
    assert.equal(DM.depositText(30, 300, 'USD'), '30 % · $300');
    assert.equal(DM.depositText(null, null, 'USD'), 'Sin anticipo');
    assert.match(DM.historyEvents({ quote_status: 'responded', created_at: '2026-11-01T10:00:00Z', artist_responded_at: '2026-11-02T10:00:00Z', artist_budget_amount: 1000, artist_deposit_pct: 30 }, [], [], [], new Date('2026-11-03'))
        .map((e) => e.text).join(' | '), /anticipo 30 %/);
});

test('COT-A-09: el anticipo está en los diálogos de respuesta y acuerdo y en el panel de pagos', () => {
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.equal((detail.match(/\$\{depositField\(q\)\}/g) || []).length, 2, 'respuesta y acuerdo');
    assert.equal((detail.match(/readDeposit\(data\.deposit_pct, value\)/g) || []).length, 2);
    // Sin fila manual, el anticipo sale de quotations_db.artist_deposit_*.
    const dep = PM.depositRequired(null, { artist_deposit_pct: 30, artist_deposit_amount: 150, artist_budget_currency: 'usd' });
    assert.deepEqual(dep, { amount: 150, currency: 'USD', pct: 30 });
    assert.equal(PM.depositRequired(null, { artist_deposit_amount: null }), null);
    // La manual tiene prioridad.
    assert.equal(PM.depositRequired({ deposit_amount: 90, deposit_pct: 30, currency: 'ARS' }, { artist_deposit_amount: 150 }).amount, 90);
    const summary = PM.summarize({ artist_budget_amount: 500, artist_budget_currency: 'USD', artist_deposit_pct: 30, artist_deposit_amount: 150 }, null, []);
    assert.equal(summary.deposit && summary.deposit.required, 150);
});

// ------------------------------------------------------------ sesiones (COT-A-05 / 15)
test('COT-A-15: no_show y cancelled no ocupan lugar del acuerdo y quedan en el historial', () => {
    const quote = { quote_status: 'in_progress', final_sessions: 2, artist_responded_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T09:00:00Z' };
    const sessions = [
        { id: 1, status: 'no_show', session_date: '2026-11-05T15:00:00Z', updated_at: '2026-11-05T18:00:00Z' },
        { id: 2, status: 'cancelled', session_date: '2026-11-06T15:00:00Z', updated_at: '2026-11-04T18:00:00Z' },
        { id: 3, status: 'scheduled', session_date: '2026-11-20T15:00:00Z' }
    ];
    assert.deepEqual(DM.orderedSessions(sessions).map((s) => s.id), [3]);
    const slots = DM.sessionSlots(quote, sessions);
    assert.deepEqual(slots.map((s) => s.state), ['scheduled', 'unscheduled']);
    const texts = DM.historyEvents(quote, [], sessions, [], new Date('2026-11-10')).map((e) => e.text);
    assert.ok(texts.some((t) => /no se presentó/.test(t)));
    assert.ok(texts.some((t) => /cancelada/.test(t)));
    assert.match(read('lib/gcal-sync.js'), /CANCELLED_SESSION = new Set\(\[[^\]]*'no_show'/);
});

test('COT-A-05: acciones secundarias de sesión (cancelar / no se presentó)', () => {
    const slot = (date) => ({ state: 'scheduled', session: { id: 7, session_date: date } });
    const now = new Date('2026-11-10T12:00:00Z');
    assert.deepEqual(DM.sessionManageActions('in_progress', slot('2026-11-20T12:00:00Z'), now), ['cancel']);
    assert.deepEqual(DM.sessionManageActions('approved', slot('2026-11-09T12:00:00Z'), now), ['no_show', 'cancel']);
    assert.deepEqual(DM.sessionManageActions('completed', slot('2026-11-09T12:00:00Z'), now), []);
    assert.deepEqual(DM.sessionManageActions('in_progress', { state: 'done', session: { id: 1 } }, now), []);
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.match(detail, /updateSession\(session\.id, \{ status: 'cancelled' \}\);\s*\n\s*noticeSession\('session_cancelled', session\.id\);/);
    assert.match(detail, /updateSession\(session\.id, \{ status: 'no_show' \}\)/);
    assert.match(detail, /data-action="session-cancel"/);
    assert.match(detail, /type="button" data-action="session-no-show"/);
});

test('COT-A-05: el calendario cancela en vez de borrar y avisa por el servidor', () => {
    const repo = read('public/shared/js/data/calendar-repo.js');
    assert.match(repo, /async removeQuoteSession\(sessionId\) \{\s*\n\s*const Sessions = requireSessions\(\);\s*\n\s*await Sessions\.updateStatus\(sessionId, 'cancelled'\);/);
    assert.doesNotMatch(repo, /Sessions\.delete\(sessionId\)/);
    assert.match(repo, /if \(opts\.rescheduled\) patch\.status = 'rescheduled';/);
    const cal = read('public/shared/js/calendar.js');
    assert.match(cal, /noticeSession\('session_scheduled'/);
    assert.match(cal, /noticeSession\('session_rescheduled'/);
    assert.match(cal, /noticeSession\('session_cancelled'/);
    assert.match(cal, /persistRemove\(editing, \{ notify: isSession \}\)/);
    const page = read('public/calendar/index.html');
    assert.ok(page.indexOf('quotation-client-notices.js') !== -1 && page.indexOf('quotation-client-notices.js') < page.indexOf('/shared/js/calendar.js'));
});

test('COT-A-05/11: el detalle avisa sesiones y acuerdo por las rutas nuevas (sin client_approved_quotation)', () => {
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.doesNotMatch(detail, /notify\('client_approved_quotation'/);
    assert.doesNotMatch(detail, /notify\('session_/);
    // EMAIL-DUP-03: el acuerdo inicial ya informa la primera sesión (un solo aviso al cliente).
    assert.doesNotMatch(detail, /noticeAgreement\(\)\.then\(\(\) => noticeSession\('session_scheduled'/);
    assert.match(detail, /confirmFor\(q, \{ starts_at: first, minutes, from_agreement: true \}\)/);
});

test('QuotationClientNotices.notifySession/notifyAgreement llaman a las rutas del frente', async () => {
    const calls = [];
    const saved = { window: global.window, fetch: global.fetch };
    global.window = {
        location: { pathname: '/beta/my-quotations/detail' },
        ConfigManager: { getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }) }
    };
    global.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ success: true }) }; };
    try {
        delete require.cache[require.resolve('../public/shared/js/quotation-client-notices.js')];
        const N = require('../public/shared/js/quotation-client-notices.js');
        assert.equal((await N.notifySession({ quote_id: 'QN1' }, 'session_hacked', 3)).skipped, true);
        await N.notifySession({ quote_id: 'QN 1' }, 'session_cancelled', 3);
        await N.notifyAgreement({ quote_id: 'COT-AB12' });
        assert.equal(calls[0].url, '/beta/api/cot-artista/quotations/QN%201/session-notice');
        assert.deepEqual(JSON.parse(calls[0].init.body), { event: 'session_cancelled', session_id: 3 });
        assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
        assert.equal(calls[1].url, '/beta/api/cot-artista/quotations/COT-AB12/agreement-notice');
    } finally {
        global.window = saved.window;
        global.fetch = saved.fetch;
    }
});

// ------------------------------------------------------------ emails (archivo por frente)
test('services/email-events/cot-artista.js: forma de los eventos y plantillas existentes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/email/billionmail/manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(EVENTS).sort(), ['artist_confirmed_agreement', 'artist_new_quotation']);
    for (const [id, ev] of Object.entries(EVENTS)) {
        assert.ok(ev.name && ev.description, `${id} sin nombre/descripción`);
        assert.ok(manifest[ev.templateHint], `${id}: plantilla ${ev.templateHint} inexistente`);
        assert.equal(ev.serverOnly, true, `${id} debe ser server-only`);
        assert.equal(typeof ev.recipient, 'function');
        assert.equal(typeof ev.attribs, 'function');
        const r = ev.render;
        assert.ok(['artist', 'client', 'studio', 'admin'].includes(r.audience));
        assert.ok(['transactional', 'quotations', 'messages', 'calendar', 'account', 'studios'].includes(r.category));
        for (const key of ['subject', 'preheader', 'headline', 'intro', 'rows', 'cta']) assert.equal(typeof r[key], 'function', `${id}.render.${key}`);
        assert.equal(typeof r.eyebrow, 'string');
        const sample = { quote_id: 'QN1', client_full_name: 'Ana', artist_name: 'Leo', tattoo_style: { style_name: 'Blackwork' }, quotation_url: 'https://x/q', dashboard_url: 'https://x/d' };
        assert.ok(r.subject(sample).length > 5);
        assert.ok(Array.isArray(r.rows(sample)) && r.rows(sample).every((row) => row.length === 2));
        assert.ok(r.cta(sample).url.startsWith('https://'));
        assert.equal(r.cta({}), null);
    }
    assert.equal(EVENTS.artist_new_quotation.recipient({ artist_email: 'a@x.com', client_email: 'c@x.com' }), 'a@x.com');
    assert.equal(EVENTS.artist_confirmed_agreement.recipient({ artist_email: 'a@x.com', client_email: 'c@x.com' }), 'c@x.com');
    assert.equal(EVENTS.artist_new_quotation.attribs({ tattoo_style: '{"style_name":"Realismo"}' }).tattoo_style, 'Realismo');
    assert.equal(require('../lib/notification-prefs').kindForEmailEvent('artist_new_quotation'), 'cotizaciones');
    const tpl = fs.readFileSync(path.join(ROOT, manifest['quotation-agreement-client'].file), 'utf8');
    for (const v of manifest['quotation-agreement-client'].variables) assert.ok(tpl.includes(`{{${v}}}`), v);
});

// ------------------------------------------------------------ avisos del servidor
function fakeSend() {
    const sent = [];
    return { sent, sendEmail: async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return { ok: true }; } };
}
const BASE = 'https://beta.example.test';
const ROW = {
    id: 41, quote_id: 'QNabc', quote_status: 'pending', artist_id: 'art-1', artist_email: 'artist@example.com', artist_name: 'Leo',
    client_full_name: 'Ana', client_email: 'ana@example.com', tattoo_idea_description: 'Un lobo', tattoo_style: { style_name: 'Blackwork' },
    drive_folder_url: 'https://evil.example/x'
};

test('COT-A-03: aviso al artista una sola vez, con enlace al detalle del artista', async () => {
    const f = fakeSend();
    const res = await notices.notifyArtistNewQuotation('QNabc', { useDefaults: false, readQuote: async () => ({ ...ROW }), sendEmail: f.sendEmail, baseUrl: BASE });
    assert.equal(res.ok, true);
    assert.equal(f.sent.length, 1);
    const [{ eventId, payload, options }] = f.sent;
    assert.equal(eventId, 'artist_new_quotation');
    assert.equal(options.idempotencyKey, 'newquote:QNabc');
    assert.equal(payload.quotation_url, `${BASE}/my-quotations/detail?quote=QNabc`);
    assert.equal(payload.dashboard_url, `${BASE}/artist/dashboard`);
    assert.equal(payload.tattoo_style, 'Blackwork');
    assert.equal(payload.drive_folder_url, undefined, 'los *_url de la fila no viajan');
    for (const status of ['in_progress', 'responded', 'cancelled']) {
        const g = fakeSend();
        const skip = await notices.notifyArtistNewQuotation('QNabc', { useDefaults: false, readQuote: async () => ({ ...ROW, quote_status: status }), sendEmail: g.sendEmail, baseUrl: BASE });
        assert.equal(skip.skipped, true);
        assert.equal(g.sent.length, 0);
    }
    const noArtist = await notices.notifyArtistNewQuotation('QNabc', { useDefaults: false, readQuote: async () => ({ ...ROW, artist_id: null }), sendEmail: f.sendEmail, baseUrl: BASE });
    assert.equal(noArtist.skipped, true);
});

test('COT-A-03: el intake solo avisa en el envío definitivo y sin bloquear la respuesta', () => {
    const intake = read('services/quotation-intake.js');
    // Integración (intake de cot-form): el aviso sale solo dentro del envío
    // definitivo (submit + pending), en la transición real y nunca para las
    // elegidas entre sugerencias; corre en segundo plano (inBackground).
    const start = intake.indexOf("if (body.mode === 'submit' && status === 'pending') {");
    const end = intake.indexOf('res.json({ success: true, quote_id: saved.result.quote_id');
    assert.ok(start > 0 && end > start, 'bloque del envío definitivo antes de la respuesta');
    assert.match(intake.slice(start, end), /\/\/ COT-A-03[^\n]*\n[^\n]*\n\s*if \(freshlySubmitted && saved\.q\.artist_id && saved\.q\.source !== 'recommendation'\) notifyArtist\(saved\.q\.quote_id, req\);/);
    assert.equal((intake.match(/notifyArtist\(/g) || []).length, 2, 'una definición y una sola llamada');
    assert.match(intake, /notices\.inBackground\('artist_new_quotation'/);
    assert.match(read('public/shared/js/wo-artist-menu.js'), /href: '\/my-quotations\/detail\?id=' \+ encodeURIComponent\(q\.quote_id\)/);
});

test('COT-A-20: copias por rol con los enlaces de cada panel', () => {
    const copies = notices.rolePayloads({ quote_id: 'QN1', client_email: 'c@x.com', artist_email: 'a@x.com', quotation_url: 'https://evil' }, BASE);
    assert.equal(copies.client.artist_email, '');
    assert.equal(copies.client.client_email, 'c@x.com');
    assert.equal(copies.client.quotation_url, `${BASE}/client/dashboard?quote=QN1`);
    assert.equal(copies.client.login_url, `${BASE}/client/login`);
    assert.equal(copies.artist.client_email, '');
    assert.equal(copies.artist.artist_email, 'a@x.com');
    assert.equal(copies.artist.quotation_url, `${BASE}/my-quotations/detail?quote=QN1`);
    assert.equal(copies.artist.dashboard_url, `${BASE}/artist/dashboard`);
    // El mapeo resuelve un solo destinatario por copia (sesiones: cliente + artista).
    const mapping = require('../services/email-event-mapping');
    assert.deepEqual(mapping.resolveRecipients('session_scheduled', copies.client), ['c@x.com']);
    assert.deepEqual(mapping.resolveRecipients('session_scheduled', copies.artist), ['a@x.com']);
});

test('COT-A-12: resumen de completada a cliente y artista, solo si está completed', async () => {
    const f = fakeSend();
    const row = { ...ROW, quote_status: 'completed', final_budget_amount: '900', final_budget_currency: 'USD', final_sessions: '2' };
    const res = await notices.notifyQuotationCompleted('QNabc', {
        useDefaults: false, baseUrl: BASE, sendEmail: f.sendEmail, readQuote: async () => row,
        readSessions: async () => [{ session_date: '2026-11-02T10:00:00Z', status: 'cancelled' }, { session_date: '2026-11-03T10:00:00Z', status: 'completed' }]
    });
    assert.equal(res.ok, true);
    assert.deepEqual(f.sent.map((s) => [s.eventId, s.options.idempotencyKey]), [
        ['quotation_completed_summary', 'completed:QNabc:client'],
        ['quotation_completed_summary', 'completed:QNabc:artist']
    ]);
    assert.equal(f.sent[0].payload.first_session_date, '2026-11-03T10:00:00Z');
    assert.equal(f.sent[1].payload.quotation_url, `${BASE}/my-quotations/detail?quote=QNabc`);
    assert.deepEqual(f.sent.map((s) => s.options.actorUserId), [undefined, undefined], 'sin actor conocido no se inventa uno');
    // EP-02: quien cerró la cotización no recibe el aviso push / in-app de su propia acción.
    const closed = fakeSend();
    await notices.notifyQuotationCompleted('QNabc', { useDefaults: false, baseUrl: BASE, sendEmail: closed.sendEmail, readQuote: async () => row, actorUserId: 'cli-1' });
    assert.deepEqual(closed.sent.map((s) => s.options.actorUserId), ['cli-1', 'cli-1']);
    const g = fakeSend();
    const skip = await notices.notifyQuotationCompleted('QNabc', { useDefaults: false, baseUrl: BASE, sendEmail: g.sendEmail, readQuote: async () => ({ ...row, quote_status: 'artist_completed' }) });
    assert.equal(skip.skipped, true);
    assert.equal(g.sent.length, 0);
    const server = read('server.js');
    assert.match(server, /await QuotationsRepo\.markCompletedByClient\(quotation\.id, caller\.id, completedAt\);\s*\n[^\n]*cot-artista-notices[^\n]*\n\s*cotNotices\.inBackground\('completed', \(\) => cotNotices\.notifyQuotationCompleted\(quotation\.quote_id, \{ baseUrl: applicationBase\(req\), actorUserId: caller\.id \}\)/);
});

test('COT-A-05/20: aviso de sesión valida el evento y manda una copia por rol', async () => {
    const f = fakeSend();
    const bad = await notices.handleSessionNotice({}, 'QN1', { event: 'artist_new_quotation', session_id: 3 }, { useDefaults: false, sendEmail: f.sendEmail });
    assert.equal(bad.status, 400);
    const noSession = await notices.handleSessionNotice({}, 'QN1', { event: 'session_cancelled', session_id: 'x' }, { useDefaults: false, sendEmail: f.sendEmail });
    assert.equal(noSession.status, 400);
    let asked = null;
    const ok = await notices.handleSessionNotice({}, 'QN1', { event: 'session_cancelled', session_id: '3' }, {
        useDefaults: false, baseUrl: BASE, sendEmail: f.sendEmail,
        resolveEmailContext: async (req, eventId, payload) => {
            asked = { eventId, payload };
            return { ok: true, idempotencyKey: 'QN1:session:3:t', payload: { quote_id: 'QN1', client_email: 'c@x.com', artist_email: 'a@x.com', status: 'cancelled' } };
        }
    });
    assert.deepEqual(asked, { eventId: 'session_cancelled', payload: { quote_id: 'QN1', session_id: 3 } });
    assert.equal(ok.ok, true);
    assert.deepEqual(f.sent.map((s) => s.options.idempotencyKey), ['QN1:session:3:t:client', 'QN1:session:3:t:artist']);
    const denied = await notices.handleSessionNotice({}, 'QN1', { event: 'session_scheduled', session_id: 3 }, {
        useDefaults: false, sendEmail: f.sendEmail, resolveEmailContext: async () => ({ ok: false, status: 403, error: 'no' })
    });
    assert.equal(denied.status, 403);
});

test('COT-A-11: el acuerdo se avisa al cliente, solo por el artista y en client_approved', async () => {
    const quote = { ...ROW, quote_status: 'client_approved', final_budget_amount: '900', final_budget_currency: 'USD', artist_deposit_pct: 30, artist_deposit_amount: 270 };
    const base = { useDefaults: false, baseUrl: BASE, readQuote: async () => quote, readSessions: async () => [{ session_date: '2026-12-01T18:30:00Z', status: 'scheduled' }] };
    assert.equal((await notices.handleAgreementNotice({}, 'QNabc', { ...base, resolveUser: async () => null, sendEmail: fakeSend().sendEmail })).status, 401);
    assert.equal((await notices.handleAgreementNotice({}, 'QNabc', { ...base, resolveUser: async () => ({ id: 'otro', email: 'ana@example.com' }), sendEmail: fakeSend().sendEmail })).status, 403);
    assert.equal((await notices.handleAgreementNotice({}, 'QNabc', { ...base, readQuote: async () => ({ ...quote, quote_status: 'responded' }), resolveUser: async () => ({ id: 'art-1' }), sendEmail: fakeSend().sendEmail })).status, 409);
    const f = fakeSend();
    const res = await notices.handleAgreementNotice({}, 'QNabc', { ...base, resolveUser: async () => ({ id: 'art-1' }), sendEmail: f.sendEmail });
    assert.equal(res.ok, true);
    assert.equal(f.sent.length, 1);
    const [{ eventId, payload, options }] = f.sent;
    assert.equal(eventId, 'artist_confirmed_agreement');
    assert.equal(options.idempotencyKey, 'agreement:QNabc');
    assert.equal(options.actorUserId, 'art-1', 'EP-02: el artista que registró el acuerdo no recibe su propio aviso');
    assert.equal(payload.artist_email, '');
    assert.equal(payload.dashboard_url, `${BASE}/client/dashboard`);
    assert.equal(payload.first_session_date, '2026-12-01T18:30:00Z');
    assert.equal(payload.deposit_text, '30 % · 270 USD');
    assert.equal(EVENTS.artist_confirmed_agreement.recipient(payload), 'ana@example.com');
});

test('rutas: register agrega las dos rutas y server.js las registra con una línea', async () => {
    const registered = [];
    const app = { post: (route, ...handlers) => registered.push({ route, handlers }) };
    const limiter = (req, res, next) => next();
    routes.register(app, { limiter, noticeDeps: { useDefaults: false } });
    assert.deepEqual(registered.map((r) => r.route), [
        '/api/cot-artista/quotations/:quoteId/session-notice',
        '/api/cot-artista/quotations/:quoteId/agreement-notice'
    ]);
    assert.equal(registered[0].handlers[0], limiter);
    // Un evento inválido responde 400 sin tocar la red.
    const res = { statusCode: 200, body: null, set() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await registered[0].handlers[1]({ params: { quoteId: 'QN1' }, body: { event: 'nada' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.deepEqual(routes.summarize({ client: { ok: true, recipients: ['x@y.z'] } }), { client: { ok: true, skipped: false, deduplicated: false } });
    const server = read('server.js');
    assert.equal((server.match(/require\('\.\/lib\/routes\/cot-artista'\)\.register\(app\)/g) || []).length, 1);
    // Sin limiter inyectado usa uno propio (nunca authLimiter, que comparten alta y reset de contraseña).
    const own = [];
    routes.register({ post: (route, ...handlers) => own.push(handlers[0]) }, { noticeDeps: { useDefaults: false } });
    assert.equal(own.length, 2);
    assert.equal(typeof own[0], 'function');
    assert.notEqual(own[0], limiter);
    assert.doesNotMatch(read('lib/routes/cot-artista.js'), /deps\.authLimiter/);
    assert.ok(server.indexOf("require('./lib/routes/cot-artista')") < server.indexOf('app.listen('));
});

// ------------------------------------------------------------ cotización manual (COT-A-01/13/14)
test('COT-A-14: la cotización manual manda la hora tentativa como ISO', () => {
    assert.equal(NM.normalizeTimeParam('15:30'), '15:30');
    assert.equal(NM.normalizeTimeParam('25:00'), '');
    assert.equal(NM.tentativeAt('2026-12-01', '15:30'), new Date(2026, 11, 1, 15, 30).toISOString());
    assert.equal(NM.tentativeAt('2026-12-01', ''), new Date(2026, 11, 1, 11, 0).toISOString());
    assert.equal(NM.tentativeAt('2026-02-30', '10:00'), '');
    const state = NM.createInitialState({ origin: 'cita', date: '2026-12-01', time: '18:15', ref: 'COT-ABCD12' });
    assert.equal(state.time, '18:15');
    const details = NM.buildDetailsPayload(state);
    assert.equal(details.project.tentative_at, new Date(2026, 11, 1, 18, 15).toISOString());
    assert.equal(details.project.tentative_time, '18:15');
    assert.equal(NM.stateFromDraft(NM.buildDraftRecord(state)).time, '18:15');
    const ui = read('public/shared/js/quotation-new.js');
    assert.match(ui, /field\('Hora tentativa', `<input id="qn-f-time" class="qn-input" type="time"/);
    assert.match(ui, /time: params\.get\('hora'\)/);
});

test('COT-A-01/13: errores de la cotización manual en español y sin email no se avisa', () => {
    assert.match(NM.createErrorMessage({ code: '23514', cause: { message: 'new row for relation "quotations_db" violates check constraint' } }), /problema de configuración/);
    assert.doesNotMatch(NM.createErrorMessage({ code: '23514', cause: { message: 'violates check constraint' } }), /violates/);
    assert.match(NM.createErrorMessage({ code: '22023', cause: { message: 'Fecha tentativa no válida.' } }), /Fecha tentativa no válida\./);
    assert.match(NM.createErrorMessage({ code: 'XX000', cause: { message: 'internal' } }), /^No pudimos crear la cotización\. Guardamos un borrador/);
    const ui = read('public/shared/js/quotation-new.js');
    assert.match(ui, /if \(quotePayload\.client_email\) try \{/);
    assert.match(ui, /toast\(M\.createErrorMessage\(err\), 'error'\);/);
    assert.doesNotMatch(read('services/email-service.js'), /Could not resolve a recipient/);
});

// ------------------------------------------------------------ COT-A-16
test('COT-A-16: los tests que leen archivos normalizan CRLF y *.sql se versiona con LF', () => {
    for (const rel of ['tests/r3-integracion.test.js', 'tests/r3b-gcal.test.js', 'tests/r3b-vencimiento.test.js', 'tests/r3c-borrado.test.js', 'tests/registro-integracion.test.js']) {
        assert.match(read(rel), /const read = \([a-z]+\) => fs\.readFileSync\([^)]*\), 'utf8'\)\.replace\(\/\\r\\n\/g, '\\n'\)/, rel);
    }
    assert.match(read('.gitattributes'), /^\*\.sql text eol=lf$/m);
});

// ------------------------------------------------------------ revisión (escéptica)
test('revisión: el calendario no reprograma ni cancela sesiones ya realizadas', () => {
    const cal = read('public/shared/js/calendar.js');
    assert.match(cal, /function isOpenSession\(event\) \{\n\s+const status = String\(event\?\.sessionStatus \|\| 'scheduled'\)\.toLowerCase\(\);\n\s+return status === 'scheduled' \|\| status === 'rescheduled';/);
    assert.match(cal, /const rescheduled = isOpenSession\(event\) && !sameInstant\(event\.start, payload\.starts_at\);/);
    const del = cal.slice(cal.indexOf('async function deleteCurrentEvent'), cal.indexOf('window.confirm(message)'));
    assert.match(del, /if \(isSession && !isOpenSession\(editing\)\) \{[\s\S]*?return;\n\s+\}/);
});

test('revisión: el email al artista por solicitud nueva tiene CTA al detalle', () => {
    const { SPECS } = require('../scripts/redesign-email-templates.js');
    assert.equal(SPECS['artist-quotation-notification'].ctaVar, 'quotation_url');
    for (const rel of ['templates/email/artist-quotation-notification.html', 'templates/email/billionmail/artist-quotation-notification.html']) {
        assert.match(read(rel), new RegExp('href="\\{\\{quotation_url\\}\\}"[^>]*>' + SPECS['artist-quotation-notification'].ctaLabel), rel);
    }
    const p = notices.newQuotationPayload({ quote_id: 'QN9', artist_email: 'a@b.c' }, 'https://x.test/beta');
    assert.equal(p.quotation_url, 'https://x.test/beta/my-quotations/detail?quote=QN9');
});

test('EMAIL-NEW-01: cada copia lleva el destinatario de su rol', () => {
    const copies = notices.rolePayloads({
        quote_id: 'QN1', client_email: 'c@x.com', client_user_id: 'cli-1', client_name: 'Ana',
        artist_email: 'a@x.com', artist_id: 'art-1', artist_name: 'Leo',
        recipient_email: 'c@x.com', recipient_name: 'Ana'
    }, BASE);
    assert.equal(copies.client.recipient_email, 'c@x.com');
    assert.equal(copies.client.recipient_user_id, 'cli-1');
    assert.equal(copies.client.recipient_name, 'Ana');
    assert.equal(copies.artist.recipient_role, 'artist');
    assert.equal(copies.artist.recipient_email, 'a@x.com');
    assert.equal(copies.artist.recipient_user_id, 'art-1');
    assert.equal(copies.artist.recipient_name, 'Leo');
});

test('EMAIL-NEW-01: la copia del artista solo sale por el relé', async () => {
    const ctx = async () => ({ ok: true, idempotencyKey: 'QN1:session:3:t', payload: { quote_id: 'QN1', client_email: 'c@x.com', artist_email: 'a@x.com', status: 'cancelled' } });
    const viaN8n = fakeSend();
    const n8n = await notices.handleSessionNotice({}, 'QN1', { event: 'session_cancelled', session_id: '3' }, {
        useDefaults: false, baseUrl: BASE, sendEmail: viaN8n.sendEmail, resolveEmailContext: ctx, resolveChannel: async () => 'n8n'
    });
    assert.equal(n8n.ok, true);
    assert.deepEqual(viaN8n.sent.map((s) => s.options.idempotencyKey), ['QN1:session:3:t:client']);
    assert.equal(n8n.results.artist.reason, 'canal_sin_copia_artista');
    const viaRelay = fakeSend();
    await notices.handleSessionNotice({}, 'QN1', { event: 'session_cancelled', session_id: '3' }, {
        useDefaults: false, baseUrl: BASE, sendEmail: viaRelay.sendEmail, resolveEmailContext: ctx, resolveChannel: async () => 'smtp_relay'
    });
    assert.deepEqual(viaRelay.sent.map((s) => s.options.idempotencyKey), ['QN1:session:3:t:client', 'QN1:session:3:t:artist']);
});
