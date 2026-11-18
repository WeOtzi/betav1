'use strict';

// Sanciones (2.7.0) en el navegador: pestaña del panel de soporte
// (support-dashboard-sanctions.js + data/support-sanctions-repo.js) y la
// página pública /apelacion (apelacion.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const P = require('../public/shared/js/support-dashboard-sanctions.js')._internal;
const A = require('../public/shared/js/apelacion.js')._internal;
const S = require('../lib/sanciones');

const USER = '11111111-1111-4111-8111-111111111111';
const TICKET = '66666666-6666-4666-8666-666666666666';
const ATTACK = '<script>alert(1)</script><img src=x onerror=alert(2)>';

test('panel de soporte: pestaña SANCIONES en el menú y en las pestañas, con su contador', () => {
    const html = read('public/support/dashboard/index.html');
    assert.equal((html.match(/data-tab="sanciones"/g) || []).length, 2, 'menú lateral y pestaña');
    assert.match(html, /<button class="tab-btn" data-tab="sanciones" type="button">/);
    assert.equal((html.match(/class="snq-count" hidden/g) || []).length, 2);
    assert.match(html, /<link rel="stylesheet" href="\/shared\/css\/support-dashboard-sanctions\.css\?v=20261118-kyc2?">/);
    // Orden: base → … → feedback → repo de sanciones → módulo de sanciones.
    const base = html.indexOf('/shared/js/support-dashboard.js');
    const client = html.indexOf('/shared/js/data/postgrest-client.js');
    const feedback = html.indexOf('/shared/js/support-dashboard-feedback.js');
    const repoAt = html.indexOf('/shared/js/data/support-sanctions-repo.js?v=20261118-kyc');
    const moduleAt = html.indexOf('/shared/js/support-dashboard-sanctions.js?v=20261118-kyc');
    assert.ok(client > 0 && base > client, 'cliente de datos antes del panel');
    assert.ok(repoAt > feedback && moduleAt > repoAt, 'después de feedback: repo y luego módulo (envuelve su switchTab)');
    assert.ok(moduleAt > base);
    // La pestaña de denuncias (T1) con la versión de esta entrega.
    assert.match(html, /support-dashboard-reports\.js\?v=20261118-kyc/);
    assert.match(html, /support-dashboard-reports\.css\?v=20261118-kyc/);
    assert.match(html, /data\/support-reports-repo\.js\?v=20261118-kyc/);
});

test('módulo y repo: datos solo por WeotziData.SupportSanctions, sin CRUD ad-hoc', () => {
    const src = read('public/shared/js/support-dashboard-sanctions.js');
    assert.match(src, /const TAB = 'sanciones';/);
    assert.match(src, /root\.WeotziData && root\.WeotziData\.SupportSanctions/);
    assert.match(src, /root\.switchTab = switchTab;/);
    assert.match(src, /'#' \+ TAB/, 'abre con /support/dashboard#sanciones');
    assert.match(src, /root\.SupportSanctionsQueue = \{ refresh: load, open: openDetail, isActive: \(\) => active, propose \}/);
    assert.doesNotMatch(src, /\.from\(|rest\/v1\//, 'sin CRUD ad-hoc');
    assert.doesNotMatch(src, /fetch\(/, 'la red solo por el repo');

    const repo = read('public/shared/js/data/support-sanctions-repo.js');
    assert.match(repo, /D\.SupportSanctions = \{/);
    assert.match(repo, /Authorization: 'Bearer ' \+ s\.access_token/);
    for (const endpoint of ["'/api/support/sanctions'", "'/api/support/sanctions/accounts'", "'/api/support/sanctions/'", "'/confirm'", "'/lift'", "'/appeal-decision'", "'/api/support/security-alerts'"]) {
        assert.ok(repo.includes(endpoint), endpoint);
    }
    assert.doesNotMatch(repo, /\.from\(|rest\/v1\//);

    const css = read('public/shared/css/support-dashboard-sanctions.css');
    assert.match(css, /\.snq-count\{/);
    assert.match(css, /@media \(max-width:900px\)/);
    assert.match(css, /min-height:44px/);
});

test('repo en un navegador simulado: Bearer, base /beta y guardas de id', async () => {
    const calls = [];
    const sandbox = {
        console,
        location: { pathname: '/beta/support/dashboard' },
        WeotziData: { getClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'u' }, access_token: 'tok' } } }) } }) },
        fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ success: true, sanctions: [] }) }; }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(read('public/shared/js/data/support-sanctions-repo.js'), sandbox);
    const R = sandbox.WeotziData.SupportSanctions;
    const out = await R.list({ status: 'proposed' });
    assert.equal(out.ok, true);
    assert.equal(calls[0].url, '/beta/api/support/sanctions?status=proposed');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    await R.confirm(USER, 'nota');
    assert.equal(calls[1].url, `/beta/api/support/sanctions/${USER}/confirm`);
    assert.equal(calls[1].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].init.body), { note: 'nota' });
    assert.equal((await R.lift('nope', 'x')).status, 400, 'id inválido no sale a la red');
    assert.equal((await R.searchAccounts('ab')).status, 400);
    assert.equal(calls.length, 2);
});

test('contrato con DENUNCIAS: propose(prefill) limpia lo que llega', () => {
    assert.deepEqual(P.cleanPrefill({ user_id: USER, ticket_id: TICKET, reason_code: 'plagio_diseno', summary: '  Copia de fotos  ' }),
        { user_id: USER, ticket_id: TICKET, reason_code: 'plagio_diseno', kind: '', summary: 'Copia de fotos' });
    assert.deepEqual(P.cleanPrefill({ user_id: 'x', ticket_id: '1', reason_code: 'desconocido' }), { user_id: '', ticket_id: '', reason_code: 'otro', kind: '', summary: '' });
    assert.deepEqual(P.cleanPrefill(null), { user_id: '', ticket_id: '', reason_code: '', kind: '', summary: '' });
    const form = P.proposeFormHtml({ user_id: USER, ticket_id: TICKET, reason_code: 'estafa', summary: ATTACK });
    assert.ok(form.includes(`value="${USER}"`));
    assert.ok(form.includes(`value="${TICKET}"`));
    assert.match(form, /<option value="estafa" selected>/);
    assert.doesNotMatch(form, /<script>|<img src=x/);
    assert.match(form, /data-snq-propose-form/);
});

test('formulario: validación antes de enviar', () => {
    const now = new Date('2026-11-18T15:00:00Z');
    const base = { user_id: USER, kind: 'ban', reason_code: 'suplantacion_identidad', summary: 'Se hace pasar por otro artista.' };
    assert.deepEqual(P.buildPropose(base, now), { payload: base });
    assert.equal(P.buildPropose({ ...base, user_id: '' }, now).field, 'user_id');
    assert.equal(P.buildPropose({ ...base, summary: 'corto' }, now).field, 'summary');
    assert.equal(P.buildPropose({ ...base, ticket_id: 'x' }, now).field, 'ticket_id');
    assert.equal(P.buildPropose({ ...base, kind: 'suspension' }, now).field, 'ends_at');
    const susp = P.buildPropose({ ...base, kind: 'suspension', ends_at: '2026-12-01T10:00' }, now);
    assert.ok(susp.payload.ends_at && !Number.isNaN(Date.parse(susp.payload.ends_at)));
    assert.equal(P.buildNote('corto', 10).error !== undefined, true);
    assert.deepEqual(P.buildAppealDecision('lifted', 'Validó su Instagram.'), { outcome: 'lifted', note: 'Validó su Instagram.' });
    assert.ok(P.buildAppealDecision('accepted', 'Validó su Instagram.').error);
    assert.deepEqual(P.buildAlertUpdate('handled', 'Devuelto'), { payload: { status: 'handled', resolution: 'Devuelto' } });
    assert.ok(P.buildAlertUpdate('open', 'x').error);
    // Mismos tipos y vistas que el servidor.
    assert.deepEqual(P.KINDS, S.KINDS);
    assert.deepEqual(P.VIEWS, ['proposed', 'active', 'appealed', 'lifted', 'alerts']);
    assert.equal(P.statusForView('alerts'), null);
});

test('detalle: Confirmar deshabilitado para quien propuso un cierre; todo escapado', () => {
    const me = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const item = {
        id: USER, user_id: USER, kind: 'ban', status: 'proposed', reason_code: 'estafa', reason_label: 'Estafa', summary: ATTACK,
        proposed_by: me, proposed_by_name: ATTACK, can_confirm: false, can_lift: true, can_decide_appeal: false, pending_steps: [],
        account: { user_id: USER, email: 'x@example.com', artist: { name: ATTACK, username: 'u' }, studios: [] }, effects: {}
    };
    const html = P.detailHtml(item, me);
    assert.match(html, /data-snq-confirm-form/);
    assert.match(html, /<button type="submit" class="action-btn rpq-btn rpq-btn--accent" disabled aria-describedby="snq-confirm-help">CONFIRMAR<\/button>/);
    assert.match(html, /lo tiene que confirmar otro agente/);
    assert.match(html, /DESCARTAR/);
    assert.doesNotMatch(html, /<script>|<img src=x/);
    const other = P.detailHtml({ ...item, can_confirm: true }, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    assert.match(other, />CONFIRMAR<\/button>/);
    assert.doesNotMatch(other, /disabled aria-describedby="snq-confirm-help"/);
    const appealed = P.detailHtml({ ...item, status: 'appealed', appeal_text: ATTACK, appeal_submitted_at: '2026-11-20T00:00:00Z', can_decide_appeal: false, can_lift: true }, me);
    assert.match(appealed, /data-snq-appeal-form/);
    assert.match(appealed, /<fieldset class="snq-radios" disabled>/);
    assert.match(appealed, /LEVANTAR/);
    const row = P.rowHtml({ ...item, last_error: 'quotations' });
    assert.match(row, /data-snq-id="/);
    assert.match(row, /Pasos pendientes/);
    const alert = P.alertRowHtml({ id: USER, kind: 'reentry_blocked', status: 'open', payload: { match_kinds: ['email', 'instagram'], flow: 'client' } });
    assert.match(alert, /Coincide por correo, Instagram/);
    const refund = P.alertSummary({ kind: 'refund_needed', payload: { client_name: 'Lucía', quotes: [{ quote_id: 'WO-1' }], totals: [{ amount: 100, currency: 'USD' }] } });
    assert.equal(refund, 'Lucía · 1 cotización · 100 USD');
    assert.doesNotMatch(P.searchResultsHtml([{ user_id: USER, name: ATTACK, role: 'artist' }]), /<script>/);
});

test('/apelacion: página pública con DS, sin sesión ni Supabase, token sin Referer', () => {
    const html = read('public/apelacion/index.html');
    assert.match(html, /<html lang="es">/);
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /\/shared\/css\/ds\/tokens\.css/);
    assert.match(html, /\/shared\/css\/ds\/components\.css/);
    assert.match(html, /\/shared\/css\/apelacion\.css\?v=20261118-kyc/);
    assert.match(html, /<script src="\/shared\/js\/apelacion\.js\?v=20261118-kyc"><\/script>/);
    assert.doesNotMatch(html, /supabase-js/);
    const src = read('public/shared/js/apelacion.js');
    assert.match(src, /'\/api\/sanctions\/appeal'/);
    assert.match(src, /\/\^\\\/beta/, 'respeta el base path /beta');
    assert.doesNotMatch(src, /\.from\(|rest\/v1\//);
    assert.doesNotMatch(src + html, /\bseña\b|\bvos\b|\bquerés\b|\bescribí\b/i, 'tuteo y anticipo');
});

test('/apelacion: estados (inválido, vencido, ya apelada, enviada) y validación', () => {
    assert.equal(A.tokenFrom('?t=abc'), '', 'token demasiado corto');
    const tok = 'eyJzIjoiYWJjIn0.' + 'x'.repeat(43);
    assert.equal(A.tokenFrom('?t=' + tok), tok);
    assert.equal(A.tokenFrom('?t=<script>'), '');
    assert.equal(A.stateFor(200, { success: true, sanction: { appeal_state: 'open' } }), 'open');
    assert.equal(A.stateFor(200, { success: true, sanction: { appeal_state: 'already_appealed' } }), 'already_appealed');
    assert.equal(A.stateFor(410, { code: 'EXPIRED' }), 'expired');
    assert.equal(A.stateFor(409, { code: 'ALREADY_APPEALED' }), 'already_appealed');
    assert.equal(A.stateFor(400, { code: 'INVALID' }), 'invalid');
    assert.equal(A.stateFor(503, { code: 'NOT_CONFIGURED' }), 'unavailable');
    assert.equal(A.stateFor(0, {}), 'unavailable');
    assert.match(A.validateText('corto'), /al menos 20/);
    assert.match(A.validateText('a'.repeat(3001)), /hasta 3000/);
    assert.equal(A.validateText('a'.repeat(25)), '');
    assert.equal(A.MIN, S.APPEAL_MIN);
    assert.equal(A.MAX, S.APPEAL_MAX);
    const summary = A.summaryHtml({ kind: 'ban', kind_label: ATTACK, reason_label: 'Estafa', starts_at: '2026-11-18T15:00:00Z', ends_at: null, appeal_state: 'open', appeal_deadline: '2026-12-18T15:00:00Z' });
    assert.match(summary, /Permanente/);
    assert.doesNotMatch(summary, /<script>/);
    assert.match(A.formHtml(), /Tienes una sola apelación/);
    assert.match(A.stateHtml('sent'), /Recibimos tu apelación/);
    assert.match(A.stateHtml('expired'), /30 días/);
});
