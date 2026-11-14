'use strict';
// Frente cot-form · revisión: vínculo de cuenta solo para clientes (FK
// quotations_db.client_user_id → clients_db), historial de estados acotado
// y artistas sin estado de alta incluidos en las sugerencias.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = 'https://demo.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const intake = require('../services/quotation-intake');

const KEY = '3f2a9c1e-8b7d-4e6f-a5c4-1d2e3f4a5b6c';
const ARTIST_ID = '11111111-2222-4333-8444-555555555555';
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function json(status, body) {
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
        text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body };
}

function installFetch({ clientRow = null, clientsFail = false } = {}) {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        const method = opts.method || 'GET';
        const body = opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url: u, method, body });
        if (u.endsWith('/auth/v1/user')) return json(200, { id: 'user-artista', email: 'qa@example.test' });
        if (u.includes('/rest/v1/clients_db')) return clientsFail ? json(500, {}) : json(200, clientRow ? [clientRow] : []);
        if (u.includes('/rest/v1/artists_db')) return json(200, [{ user_id: ARTIST_ID, username: 'ana', name: 'Ana', email: 'ana@example.test', registration_status: 'pendiente de validacion' }]);
        if (u.includes('/rest/v1/rpc/save_web_quotation')) return json(200, { quote_id: intake.deriveQuoteId(KEY), status: 'in_progress' });
        if (u.includes('/rest/v1/quotations_db') && method === 'GET') return json(200, []);
        return json(204);
    };
    return calls;
}

function res() {
    return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const draftBody = () => ({
    submission_key: KEY, mode: 'draft',
    quotation: { artist_id: ARTIST_ID, client_full_name: 'QA', client_email: 'qa@example.test', tattoo_idea_description: 'Idea' }
});

test('sesión de una cuenta sin perfil de cliente (p. ej. artista): guarda como anónima, sin violar la FK', async () => {
    const calls = installFetch({ clientRow: null });
    intake.hooks.afterSubmit = null;
    const r = res();
    await intake.handleIntake({ headers: { authorization: 'Bearer token-artista' }, body: draftBody() }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const rpc = calls.find((c) => c.url.includes('save_web_quotation'));
    assert.equal(rpc.body.p_quote.client_user_id, null);
});

test('sesión de cliente con el mismo correo: la cotización queda vinculada a su cuenta', async () => {
    const calls = installFetch({ clientRow: { user_id: 'user-artista' } });
    const r = res();
    await intake.handleIntake({ headers: { authorization: 'Bearer token-cliente' }, body: draftBody() }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const rpc = calls.find((c) => c.url.includes('save_web_quotation'));
    assert.equal(rpc.body.p_quote.client_user_id, 'user-artista');
});

test('si no se puede consultar clients_db, guarda igual como anónima (nunca traba el wizard)', async () => {
    const calls = installFetch({ clientsFail: true });
    const r = res();
    await intake.handleIntake({ headers: { authorization: 'Bearer token' }, body: draftBody() }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const rpc = calls.find((c) => c.url.includes('save_web_quotation'));
    assert.equal(rpc.body.p_quote.client_user_id, null);
});

test('migración: el insert de historial de estados de authenticated deja de ser libre (y el rollback lo restaura)', () => {
    const up = read('supabase/migrations/20261115130000_cot_form_rls_cierre.sql');
    const block = up.slice(up.indexOf('create policy "Allow authenticated insert on status history"'));
    assert.ok(block.length > 0, 'falta la política acotada');
    const policy = block.slice(0, block.indexOf(');') + 2);
    assert.match(policy, /for insert to authenticated/);
    assert.match(policy, /is_support_user\(\)/);
    assert.match(policy, /q\.artist_id = \(select auth\.uid\(\)\) or q\.client_user_id = \(select auth\.uid\(\)\)/);
    assert.doesNotMatch(policy, /with check \(true\)/);
    const down = read('supabase/rollbacks/20261115130000_cot_form_rls_cierre.down.sql');
    assert.match(down, /create policy "Allow authenticated insert on status history" on public\.quotation_status_history\n {2}for insert to authenticated\n {2}with check \(true\);/);
});

test('sugerencias: los artistas sin estado de alta (NULL) no quedan afuera del filtro', () => {
    const src = read('lib/routes/cot-form.js');
    assert.match(src, /col: 'registration_status', op: 'is', val: null/);
    assert.match(src, /col: 'registration_status', op: 'neq', val: 'incompleto'/);
    assert.doesNotMatch(src, /\.neq\('registration_status', 'incompleto'\)/);
});

test('detalle de cotización del cliente: los datos (incluidos los del artista) se escapan', () => {
    const src = read('public/shared/js/client-dashboard.js');
    const start = src.indexOf('<h3 class="detail-section-title">Información del tatuaje</h3>');
    const end = src.indexOf('${renderReviewWorkflowPanel(quotation)}', start);
    const block = src.slice(start, src.indexOf('`;', end));
    assert.ok(start > 0 && end > start);
    const raw = block.match(/\$\{quotation\.[a-z_]+ \|\|/g) || [];
    assert.deepEqual(raw, [], 'quedan campos sin escapar');
    assert.match(block, /escapeFeedHtml\(quotation\.artist_name \|\| '–'\)/);
    assert.ok(block.includes(String.raw`/^https:\/\//i.test(String(quotation.tattoo_references`));
    assert.match(block, /rel="noopener noreferrer"/);
});

test('bucket quotation-references: la cotización manual del artista sigue pudiendo subir referencias (imágenes y PDF)', () => {
    const up = read('supabase/migrations/20261115130000_cot_form_rls_cierre.sql');
    assert.match(up, /create or replace function private\.is_own_quote_folder\(p_quote_id text\)/);
    assert.match(up, /q\.artist_id = \(select auth\.uid\(\)\)/);
    assert.match(up, /grant execute on function private\.is_own_quote_folder\(text\) to anon, authenticated, service_role;/);
    assert.match(up, /and private\.is_own_quote_folder\(split_part\(name, '\/', 1\)\)/);
    assert.match(up, /'application\/pdf'/);
    assert.doesNotMatch(up, /image\/svg/);
    const down = read('supabase/rollbacks/20261115130000_cot_form_rls_cierre.down.sql');
    assert.match(down, /drop function if exists private\.is_own_quote_folder\(text\);/);
    // quotation-new.js sube a <quote_id>/<archivo> con el uploader compartido.
    assert.match(read('public/shared/js/quotation-new.js'), /bucket: 'quotation-references', file, pathPrefix: quoteId/);
});
