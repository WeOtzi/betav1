'use strict';

// Ronda 3b · grupo "vencimiento" (output/figma-v3/reports/r3b-vencimiento.md).
// 1) Vencimiento opcional por cotización (migración 20261113100000).
// 2) Días ocupados: solo los viajes confirmados bloquean (migración 20261113100500).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const VM = require('../public/shared/js/quotations-view-model.js');
const M = require('../public/shared/js/quotation-new-model.js');
const expiry = require('../lib/quotation-expiry.js');

const MIG = 'supabase/migrations/20261113100000_quotation_expiry_opt_in.sql';
const MIG_DOWN = 'supabase/rollbacks/20261113100000_quotation_expiry_opt_in.down.sql';
const BUSY = 'supabase/migrations/20261113100500_busy_days_confirmed_trips.sql';
const BUSY_DOWN = 'supabase/rollbacks/20261113100500_busy_days_confirmed_trips.down.sql';
const BUSY_PREV = 'supabase/migrations/20261112190000_calendar_reminders_busy_days.sql';

const DAY = 86400000;
const NOW = new Date('2026-11-13T12:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

// ------------------------------------------------------------- regla de vencimiento
test('nada vence por defecto: sin quote_expiry_enabled no hay fecha de vencimiento', () => {
    const old = { quote_status: 'responded', artist_responded_at: ago(400) };
    assert.equal(expiry.offerExpiresAt(old), null);
    assert.equal(expiry.isOfferExpired(old, NOW), false);
    assert.equal(VM.offerExpiresAt(old), null);
    assert.equal(VM.effectiveStatus(old, NOW), 'responded');
    // quote_expires_at heredado de la regla vieja no cuenta si está apagado.
    const legacy = { ...old, quote_expires_at: ago(10) };
    assert.equal(expiry.isOfferExpired(legacy, NOW), false);
    assert.equal(VM.effectiveStatus(legacy, NOW), 'responded');
    // Días inválidos = apagado (la base no lo permite, la vista tampoco lo toma).
    assert.equal(expiry.isOfferExpired({ ...old, quote_expiry_enabled: true, quote_expiry_days: 0 }, NOW), false);
    assert.equal(expiry.isOfferExpired({ ...old, quote_expiry_enabled: 'true', quote_expiry_days: 3 }, NOW), false);
});

test('con vencimiento activado: respuesta + días o quote_expires_at, igual en servidor y vista', () => {
    const cases = [
        [{ quote_status: 'responded', artist_responded_at: ago(8), quote_expiry_enabled: true, quote_expiry_days: 7 }, true],
        [{ quote_status: 'responded', artist_responded_at: ago(6), quote_expiry_enabled: true, quote_expiry_days: 7 }, false],
        [{ quote_status: 'responded', artist_responded_at: ago(1), quote_expiry_enabled: true, quote_expiry_days: 1 }, true],
        [{ quote_status: 'responded', artist_responded_at: ago(30), quote_expiry_enabled: true, quote_expiry_days: 365 }, false],
        // quote_expires_at (calculado por el trigger al activar) manda sobre respuesta + días.
        [{ quote_status: 'responded', artist_responded_at: ago(30), quote_expires_at: ago(-2), quote_expiry_enabled: true, quote_expiry_days: 7 }, false],
        [{ quote_status: 'responded', artist_responded_at: ago(1), quote_expires_at: ago(0.5), quote_expiry_enabled: true, quote_expiry_days: 7 }, true],
        // Solo las respuestas vencen.
        [{ quote_status: 'pending', created_at: ago(90), quote_expiry_enabled: true, quote_expiry_days: 1 }, false],
        [{ quote_status: 'client_approved', artist_responded_at: ago(90), quote_expiry_enabled: true, quote_expiry_days: 1 }, false]
    ];
    for (const [quote, expired] of cases) {
        assert.equal(expiry.isOfferExpired(quote, NOW), expired, JSON.stringify(quote));
        assert.equal(VM.effectiveStatus(quote, NOW) === 'expired', expired, JSON.stringify(quote));
        const a = expiry.offerExpiresAt(quote);
        const b = VM.offerExpiresAt(quote);
        assert.equal(a && a.toISOString(), b && b.toISOString());
    }
    // El chip VENCIDA del resumen solo aparece si estaba activado.
    assert.equal(VM.stageBadge({ quote_status: 'responded', artist_responded_at: ago(100) }, []).label === 'Vencida', false);
    assert.equal(VM.stageBadge({ quote_status: 'responded', artist_responded_at: ago(100), quote_expiry_enabled: true, quote_expiry_days: 14 }, []).label, 'Vencida');
});

test('control "Vencimiento": días 1–365 y patch de quotations_db', () => {
    for (const [value, out] of [['14', 14], [1, 1], ['365', 365], ['0', null], ['366', null], ['7.5', null], ['', null], [null, null], ['abc', null], [' 30 ', 30]]) {
        assert.equal(VM.normalizeExpiryDays(value), out, String(value));
        assert.equal(expiry.normalizeExpiryDays(value), out, String(value));
    }
    assert.deepEqual(VM.expirySettingsPatch(false, '999'), { ok: true, patch: { quote_expiry_enabled: false, quote_expiry_days: null } });
    assert.deepEqual(VM.expirySettingsPatch(true, '30'), { ok: true, patch: { quote_expiry_enabled: true, quote_expiry_days: 30 } });
    const bad = VM.expirySettingsPatch(true, '0');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /entre 1 y 365 días/);
    assert.equal(VM.expirySummary({ quote_status: 'responded' }), 'Sin vencimiento');
    assert.equal(VM.expirySummary({ quote_status: 'pending', quote_expiry_enabled: true, quote_expiry_days: 1 }), '1 día desde que respondés');
    assert.match(VM.expirySummary({ quote_status: 'responded', quote_expiry_enabled: true, quote_expiry_days: 7, quote_expires_at: '2099-01-05T12:00:00Z' }, NOW), /^Vence el 05 ene/);
    assert.match(VM.expirySummary({ quote_status: 'responded', quote_expiry_enabled: true, quote_expiry_days: 7, quote_expires_at: ago(1) }, NOW), /^Venció el /);
});

test('cotización manual: vencimiento apagado por defecto, viaja en el borrador y se aplica al enviar', () => {
    const state = M.createInitialState({ ref: 'COT-0001' });
    assert.equal(state.expiryEnabled, false);
    assert.equal(state.validityDays, 14);
    assert.deepEqual(M.expiryPatch(state), { ok: true, patch: { quote_expiry_enabled: false, quote_expiry_days: null } });
    assert.match(M.previewModel(state).conditions, /^Sin vencimiento\. /);

    state.expiryEnabled = true;
    state.validityDays = 21;
    assert.deepEqual(M.expiryPatch(state), { ok: true, patch: { quote_expiry_enabled: true, quote_expiry_days: 21 } });
    assert.match(M.previewModel(state).conditions, /^Vigencia: 21 días\. /);
    const details = M.buildDetailsPayload(state);
    assert.equal(details.project.expiry_enabled, true);
    assert.equal(details.validity_days, 21);
    const back = M.stateFromDraft(M.buildDraftRecord(state, { artistId: 'a' }));
    assert.equal(back.expiryEnabled, true);
    assert.equal(back.validityDays, 21);
    // Borradores viejos (sin la marca) quedan apagados.
    assert.equal(M.stateFromDraft({ quote_ref: 'COT-0002', project: {}, validity_days: 30 }).expiryEnabled, false);

    state.validityDays = 0;
    assert.equal(M.expiryPatch(state).ok, false);
});

// ------------------------------------------------------------- servidor
test('job: prendido por defecto cada hora, se apaga con QUOTATION_EXPIRY_JOB=off', () => {
    const def = expiry.expiryConfig({});
    assert.equal(def.jobEnabled, true);
    assert.equal(def.intervalMinutes, 60);
    assert.deepEqual(expiry.rpcBody(def), { p_limit: 500, p_opt_in_only: true });
    for (const off of ['off', 'OFF', '0', 'false', 'no']) assert.equal(expiry.expiryConfig({ QUOTATION_EXPIRY_JOB: off }).jobEnabled, false, off);
    for (const on of ['on', '1', 'true', '']) assert.equal(expiry.expiryConfig({ QUOTATION_EXPIRY_JOB: on }).jobEnabled, true, on);

    const calls = [];
    const timers = { setTimeout: () => { calls.push('t'); return 1; }, setInterval: (fn, ms) => { calls.push(ms); return 2; }, clearTimeout() {}, clearInterval() {} };
    expiry.startExpiryJob({ rpc: async () => [] }, expiry.expiryConfig({}), timers);
    assert.deepEqual(calls, ['t', 60 * 60 * 1000]);

    const server = read('server.js');
    assert.match(server, /quotationExpiry\.startExpiryJob\(quotationExpiryDeps, quotationExpiry\.expiryConfig\(\)\)/);
    assert.match(server, /QUOTATION_EXPIRY_JOB=off/);
});

test('avisos: solo a clientes de respuestas vencidas que devuelve la RPC (opt-in)', async () => {
    const sent = [];
    const result = await expiry.runExpiryCycle({
        rpc: async (body) => { assert.equal(body.p_opt_in_only, true); return [{ id: 9, quote_id: 'WO-9', old_status: 'responded', client_email: 'c@example.com' }]; },
        sendEmail: async (id, payload, opts) => { sent.push(opts.idempotencyKey); return { ok: true }; }
    }, expiry.expiryConfig({}));
    assert.equal(result.notified, 1);
    assert.deepEqual(sent, ['quotation_expired:WO-9']);
});

// ------------------------------------------------------------- migración 1
test('migración 20261113100000: columnas, guard, trigger y RPC solo opt-in', () => {
    const sql = read(MIG);
    assert.match(sql, /add column if not exists quote_expiry_enabled boolean not null default false/);
    assert.match(sql, /add column if not exists quote_expiry_days integer/);
    assert.match(sql, /quotations_db_quote_expiry_days_check/);
    assert.match(sql, /quote_expiry_days between 1 and 365/);
    assert.match(sql, /if not exists \(\s*select 1 from pg_constraint/);
    // Guard: dueño, soporte o service_role; el cliente no lo activa al insertar.
    assert.match(sql, /raise exception 'quotation:expiry_forbidden' using errcode = '42501'/);
    assert.match(sql, /public\.is_support_user\(\)/);
    assert.match(sql, /auth\.uid\(\) = v_owner/);
    assert.match(sql, /new\.quote_expires_at := now\(\) \+ make_interval\(days => new\.quote_expiry_days\)/);
    assert.match(sql, /before insert or update of quote_expiry_enabled, quote_expiry_days, artist_responded_at/);
    // RPC: firma nueva, la vieja se borra, solo service_role, solo las activadas.
    assert.match(sql, /drop function if exists public\.expire_stale_quotations\(integer, integer, integer\);/);
    assert.match(sql, /create or replace function public\.expire_stale_quotations\(\s*p_limit integer default 500,\s*p_opt_in_only boolean default true\s*\)/);
    assert.match(sql, /security definer/);
    assert.match(sql, /and q\.quote_expiry_enabled\n/);
    assert.match(sql, /where q\.quote_status = 'responded'/);
    const rpc = sql.slice(sql.indexOf('create or replace function public.expire_stale_quotations'));
    assert.doesNotMatch(rpc, /quote_status = 'pending'/, 'no vence solicitudes pendientes');
    assert.doesNotMatch(rpc, /validity_days|p_default_days/,'no usa la vigencia por defecto de la cotización manual');
    assert.match(sql, /revoke all on function public\.expire_stale_quotations\(integer, boolean\) from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.expire_stale_quotations\(integer, boolean\) to service_role/);
    assert.doesNotMatch(sql, /\bdelete from\b|\bdrop table\b|\bupdate public\.quotations_db\s+set\s+quote_expiry/i, 'no toca datos existentes');

    const down = read(MIG_DOWN);
    assert.match(down, /drop function if exists public\.expire_stale_quotations\(integer, boolean\)/);
    assert.match(down, /drop trigger if exists trg_quotation_expiry_settings/);
    assert.match(down, /drop column if exists quote_expiry_enabled/);
    assert.match(down, /create or replace function public\.expire_stale_quotations\(\s*p_default_days integer default 14/);
    assert.match(down, /QUOTATION_EXPIRY_JOB=off/);
});

// ------------------------------------------------------------- migración 2
function busyBody(sql) {
    const start = sql.indexOf('create or replace function public.list_artist_public_busy_days(');
    const end = sql.indexOf('to anon, authenticated, service_role;', start);
    return sql.slice(start, end);
}

test('migración 20261113100500: copia de la función vigente con un solo cambio (viajes confirmados)', () => {
    const prev = busyBody(read(BUSY_PREV));
    const next = busyBody(read(BUSY));
    assert.ok(prev.length > 1000 && next.length > 1000);
    assert.match(next, /and t\.status = 'confirmado'/);
    assert.doesNotMatch(next, /t\.status <> 'cancelado'/);
    assert.equal(next.replace("and t.status = 'confirmado'", "and t.status <> 'cancelado'"), prev, 'el resto de la función queda igual');
    assert.match(read(BUSY), /grant execute on function public\.list_artist_public_busy_days\(uuid, date, date\)\s+to anon, authenticated, service_role/);
    assert.equal(busyBody(read(BUSY_DOWN)), prev, 'la reversa restaura la versión de 20261112190000');
});

test('preview: la RPC simulada de días ocupados solo bloquea viajes confirmados', () => {
    global.self = global;
    delete global.WoDemoFixtureExtensions;
    require('../public/shared/js/demo-fixtures/calendario.js');
    const ext = global.WoDemoFixtureExtensions.calendario;
    const ctx = { tables: {}, TABLES: [], rpcs: {}, identity: { userId: 'artist-1' }, helpers: { DAY } };
    ext(ctx);
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const trips = [
        { artist_user_id: 'artist-1', status: 'planificado', start_date: iso(100), end_date: iso(100) },
        { artist_user_id: 'artist-1', status: 'pendiente', start_date: iso(101), end_date: iso(101) },
        { artist_user_id: 'artist-1', status: 'confirmado', start_date: iso(102), end_date: iso(103) },
        { artist_user_id: 'artist-1', status: 'cancelado', start_date: iso(104), end_date: iso(104) },
        { artist_user_id: 'artist-1', status: 'confirmado', cancelled_at: '2026-11-01T00:00:00Z', start_date: iso(105), end_date: iso(105) }
    ];
    const store = { rows: (name) => (name === 'artist_trips' ? trips : []) };
    const rows = ctx.rpcs.list_artist_public_busy_days({ p_artist_user_id: 'artist-1', p_from: iso(99), p_to: iso(110) }, store);
    assert.deepEqual(rows, [
        { busy_date: iso(102), busy_status: 'unavailable' },
        { busy_date: iso(103), busy_status: 'unavailable' }
    ]);
});

// ------------------------------------------------------------- UI
test('UI: control "Vencimiento" en el detalle, el diálogo de respuesta y la cotización manual', () => {
    const detail = read('public/shared/js/quotation-detail-figma.js');
    assert.match(detail, /function expiryControl\(q, idPrefix\)/);
    assert.match(detail, /class="wo-toggle"><input type="checkbox" role="switch"/);
    assert.match(detail, /data-action="save-expiry"/);
    assert.match(detail, /\$\{expiryControl\(q, 'qd-dialog'\)\}/);
    assert.doesNotMatch(detail, /Vigencia de la propuesta|validityExpiry/);
    assert.match(read('public/my-quotations/detail/index.html'), /quotations-view-model\.js\?v=20261113-venc/);
    const qn = read('public/shared/js/quotation-new.js');
    assert.match(qn, /function expiryFieldHtml\(\)/);
    assert.match(qn, /D\(\)\.Quotations\.updateById\(result\.id, expiry\.patch\)/);
    assert.doesNotMatch(qn, /field\('Vigencia de la cotización'/);
    assert.match(read('public/shared/css/quotation-detail-figma.css'), /\.qd-expiry-row/);
    assert.match(read('public/shared/css/quotation-new.css'), /\.qn-expiry-row/);
    // Fixture de preview: la respuesta vencida tiene el vencimiento activado.
    assert.match(read('public/shared/js/demo-fixtures/cotizaciones.js'), /ref: 'DEMO-R02'[^\n]*expiryDays: 14/);
});

test('la versión de días ocupados de Google Calendar (y su reversa) también cuenta solo viajes confirmados', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '..', 'supabase');
    const mig = fs.readFileSync(path.join(dir, 'migrations', '20261113102000_google_calendar_sync.sql'), 'utf8');
    const rb = fs.readdirSync(path.join(dir, 'rollbacks')).find((f) => f.startsWith('20261113102000'));
    const down = fs.readFileSync(path.join(dir, 'rollbacks', rb), 'utf8');
    for (const sql of [mig, down]) {
        assert.doesNotMatch(sql, /t\.status <> 'cancelado'/);
        assert.match(sql, /t\.status = 'confirmado'/);
    }
});
