const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const MODULE_FILE = 'public/shared/js/backoffice-studio-verifications.js';
const HTML_FILE = 'public/backoffice/index.html';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const mod = require('../' + MODULE_FILE);

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

function requestRow(overrides = {}) {
    return {
        id: REQUEST_ID,
        studio_id: STUDIO_ID,
        status: 'pending',
        reasons: ['name_match', 'owner_request'],
        matched_studio_ids: [OTHER_ID],
        evidence: 'Somos el estudio de Corrientes 1234. Mirá https://tintanorte.test/sobre',
        contact_name: 'Ana Pérez',
        contact_phone: '+54 11 5555 5555',
        links: ['https://instagram.com/tinta.norte', 'javascript:alert(1)'],
        created_at: '2026-11-01T12:00:00.000Z',
        studio: {
            id: STUDIO_ID, name: 'Tinta Norte', slug: 'tinta-norte', city: 'CABA', country: 'Argentina', logo_image: null,
            instagram: '@Tinta.Norte', instagram_verified_at: null, instagram_verified_handle: null,
            verification_reason: 'name_match', verification_status: 'pending'
        },
        matched_studios: [{ id: OTHER_ID, name: 'Tinta Norte Palermo', slug: 'tinta-norte-palermo', city: 'CABA' }],
        owner_email: 'dueno@gmail.com',
        owner_email_confirmed: true,
        instagram_pending_code: null,
        ...overrides
    };
}

test('reasonLabel translates the reasons to Spanish', () => {
    assert.equal(mod.reasonLabel('name_match'), 'Nombre parecido a otro estudio');
    assert.equal(mod.reasonLabel('instagram_match'), 'Mismo Instagram que otro estudio');
    assert.equal(mod.reasonLabel('owner_request'), 'Pedido del estudio');
});

test('normalizeRequests keeps only pending rows with an id', () => {
    const list = mod.normalizeRequests({ requests: [requestRow(), requestRow({ id: null }), requestRow({ status: 'approved' }), null] });
    assert.equal(list.length, 1);
    assert.deepEqual(mod.normalizeRequests(null), []);
});

test('requestView reads studio, matches, links, contact and Instagram state', () => {
    const v = mod.requestView(requestRow());
    assert.equal(v.studioName, 'Tinta Norte');
    assert.equal(v.profileHref, '/studio/profile/?studio=tinta-norte');
    assert.deepEqual(v.reasonLabels, ['Nombre parecido a otro estudio', 'Pedido del estudio']);
    assert.equal(v.matched[0].href, '/studio/profile/?studio=tinta-norte-palermo');
    assert.deepEqual(v.links, [
        { raw: 'https://instagram.com/tinta.norte', href: 'https://instagram.com/tinta.norte' },
        { raw: 'javascript:alert(1)', href: null }
    ]);
    assert.equal(v.igHandle, 'tinta.norte');
    assert.equal(v.igVerified, false);
    assert.equal(v.canConfirmInstagram, true);
    assert.equal(v.ownerEmail, 'dueno@gmail.com');

    const verified = mod.requestView(requestRow({ studio: { ...requestRow().studio, instagram_verified_at: '2026-11-01T00:00:00Z', instagram_verified_handle: 'tinta.norte' } }));
    assert.equal(verified.igVerified, true);
    assert.equal(verified.canConfirmInstagram, false);
    assert.equal(mod.requestView(requestRow({ studio: { ...requestRow().studio, instagram: null } })).canConfirmInstagram, false);
    assert.equal(mod.requestView(requestRow({ instagram_pending_code: { handle: 'tinta.norte' } })).igPendingCode, true);
});

test('render escapes every field and only links http(s) URLs', () => {
    const evil = requestRow({
        evidence: '<img src=x onerror=alert(1)> ver javascript:alert(2)',
        contact_name: '<script>alert(3)</script>',
        links: ['javascript:alert(4)', 'https://ok.test/"onmouseover="x'],
        owner_email: '"><b>x</b>@mail.com',
        studio: { ...requestRow().studio, name: '<b>Estudio</b>', slug: 'a"b', city: '<i>c</i>' },
        matched_studios: [{ id: OTHER_ID, name: '<svg onload=alert(5)>', slug: 'x', city: null }]
    });
    const html = mod.renderVerificationsHtml({ requests: [evil] });
    assert.ok(!/<script/i.test(html));
    assert.ok(!/<img src=x/i.test(html));
    assert.ok(!/<svg/i.test(html));
    assert.ok(!/<b>Estudio<\/b>/.test(html));
    assert.ok(!/href="javascript:/i.test(html), 'javascript: is never a link');
    assert.match(html, /&lt;b&gt;Estudio&lt;\/b&gt;/);
    assert.match(html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
    assert.match(html, /javascript:alert\(4\)/, 'non-http links stay as plain text');
    // Todos los enlaces externos llevan rel="noopener noreferrer".
    for (const m of html.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) assert.match(m[0], /rel="noopener noreferrer"/);
    assert.ok(!/onmouseover="/.test(html));
});

test('render shows reasons, matches, contact, Instagram status and the actions', () => {
    const html = mod.renderVerificationsHtml({ requests: [requestRow()] });
    assert.match(html, /Nombre parecido a otro estudio/);
    assert.match(html, /Pedido del estudio/);
    assert.match(html, /Coincide con:/);
    assert.match(html, /Tinta Norte Palermo/);
    assert.match(html, /href="\/studio\/profile\/\?studio=tinta-norte"/);
    assert.match(html, /<a href="https:\/\/instagram\.com\/tinta\.norte" target="_blank" rel="noopener noreferrer">/);
    assert.match(html, /<a href="https:\/\/tintanorte\.test\/sobre" target="_blank" rel="noopener noreferrer">/);
    assert.match(html, /Ana Pérez/);
    assert.match(html, /\+54 11 5555 5555/);
    assert.match(html, /dueno@gmail\.com/);
    assert.match(html, /@tinta\.norte/);
    assert.match(html, /Sin validar/);
    assert.match(html, /data-verification-action="approve" data-verification-id="55555555-5555-4555-8555-555555555555"/);
    assert.match(html, /data-verification-action="reject"/);

    assert.match(mod.instagramHtml(mod.requestView(requestRow({ instagram_pending_code: { handle: 'tinta.norte' } }))), /Código pedido, falta el DM/);
    assert.match(mod.renderVerificationsHtml({ requests: [] }), /No hay verificaciones pendientes/);
    assert.match(mod.renderVerificationsHtml({ migrationPending: true }), /falta aplicar una migración/);
    assert.match(mod.renderVerificationsHtml({ error: '<x>' }), /&lt;x&gt;/);
    assert.match(mod.renderVerificationsHtml({ loading: true }), /Cargando verificaciones/);
    assert.match(mod.metaHtml([requestRow()]), /1<\/strong> verificación pendiente/);
});

test('buildDecideRequest validates and only sends confirm_instagram on approve', () => {
    assert.throws(() => mod.buildDecideRequest('no-uuid', 'approve'), /inválido/);
    assert.throws(() => mod.buildDecideRequest(REQUEST_ID, 'maybe'), /Decisión inválida/);
    assert.throws(() => mod.buildDecideRequest(REQUEST_ID, 'reject', ' no '), /motivo/);
    const approve = mod.buildDecideRequest(REQUEST_ID, 'approve', '', true);
    assert.equal(approve.url, `/api/admin/studio-verifications/${REQUEST_ID}/decide`);
    assert.equal(approve.options.method, 'POST');
    assert.deepEqual(JSON.parse(approve.options.body), { decision: 'approve', note: null, confirm_instagram: true });
    const reject = mod.buildDecideRequest(REQUEST_ID, 'reject', '  Falta información  ', true);
    assert.deepEqual(JSON.parse(reject.options.body), { decision: 'reject', note: 'Falta información' });
});

test('dialogConfig offers the Instagram checkbox only when approving an unverified handle', () => {
    const view = mod.requestView(requestRow());
    const approve = mod.dialogConfig(view, 'approve');
    assert.equal(approve.instagramHandle, 'tinta.norte');
    assert.equal(approve.required, false);
    const reject = mod.dialogConfig(view, 'reject');
    assert.equal(reject.instagramHandle, null);
    assert.equal(reject.required, true);
    const verifiedView = mod.requestView(requestRow({ studio: { ...requestRow().studio, instagram_verified_at: '2026-11-01T00:00:00Z', instagram_verified_handle: 'tinta.norte' } }));
    assert.equal(mod.dialogConfig(verifiedView, 'approve').instagramHandle, null);
    const evil = mod.requestView(requestRow({ studio: { ...requestRow().studio, name: '<b>x</b>' } }));
    assert.ok(!/<b>x<\/b>/.test(mod.dialogConfig(evil, 'approve').bodyHtml));

    assert.match(mod.successMessage(view, 'approve', { email_sent: true, instagram_confirmed: true, instagram_handle: 'tinta.norte' }), /También validamos el Instagram @tinta\.norte/);
    assert.match(mod.successMessage(view, 'reject', { email_sent: false }), /No pudimos enviar el aviso/);
});

test('describeFailure reuses the claims copy', () => {
    assert.equal(mod.describeFailure({ error: 'no_session' }), mod.NO_SESSION_MESSAGE);
    assert.equal(mod.describeFailure({ status: 200, data: { migration_pending: true } }), mod.MISSING_SCHEMA_MESSAGE);
    assert.match(mod.describeFailure({ status: 403, data: { error: 'Solo soporte' } }, { supportHint: true }), /Solo soporte .*Usuarios Soporte/);
    assert.match(mod.describeFailure({ status: 409, data: { error: 'La solicitud ya fue resuelta.' } }), /ya fue resuelta/);
});

test('decideRequest posts with the session Bearer and never throws', async () => {
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) } };
    const calls = [];
    const fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, email_sent: true }) };
    };
    const res = await mod.decideRequest(REQUEST_ID, 'approve', 'ok', true, { client, fetch });
    assert.equal(res.ok, true);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer tok-1');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    const bad = await mod.decideRequest(REQUEST_ID, 'reject', '', false, { client, fetch });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /motivo/);
    const noSession = await mod.decideRequest(REQUEST_ID, 'approve', '', false, { client: null, fetch });
    assert.equal(noSession.message, mod.NO_SESSION_MESSAGE);
});

test('mounts into #bo-studio-verifications-root and loads the pending queue when the section activates', async () => {
    function fakeElement() {
        const attrs = {};
        const el = {
            innerHTML: '', children: {}, attrs,
            setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return attrs[k] == null ? null : attrs[k]; },
            querySelector(sel) { return el.children[sel] || null; }, querySelectorAll() { return []; },
            addEventListener() {}
        };
        return el;
    }
    const classes = new Set(['content-section']);
    const section = { classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    const list = fakeElement();
    const meta = fakeElement();
    const rootEl = fakeElement();
    rootEl.closest = (sel) => (sel === '.content-section' ? section : null);
    rootEl.children['[data-verifications-list]'] = list;
    rootEl.children['[data-verifications-meta]'] = meta;
    const observers = [];
    const fetchCalls = [];
    const sandbox = {
        console, URL,
        document: {
            readyState: 'complete', head: { appendChild() {} },
            getElementById: (id) => (id === 'bo-studio-verifications-root' ? rootEl : null),
            createElement: (tag) => ({ tag }), querySelectorAll: () => [], addEventListener() {}
        },
        MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} },
        ConfigManager: { getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok-9' } } }) } }) },
        fetch: async (url, options) => {
            fetchCalls.push({ url, options });
            return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, requests: [requestRow()] }) };
        },
        setTimeout: () => 0
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read(MODULE_FILE), sandbox, { filename: MODULE_FILE });
    assert.ok(sandbox.WeOtziBackofficeStudioVerifications);
    assert.equal(rootEl.getAttribute('data-bo-mounted'), 'true');
    assert.match(rootEl.innerHTML, /Verificaciones de estudios/);
    assert.equal(fetchCalls.length, 0);
    classes.add('active');
    observers[0].cb([{ oldValue: 'content-section' }]);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, '/api/admin/studio-verifications?status=pending');
    assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer tok-9');
    assert.match(list.innerHTML, /Tinta Norte/);
});

test('backoffice/index.html mounts the verifications root after the claims root and loads the script after claims', () => {
    const html = read(HTML_FILE);
    const section = html.match(/<section id="section-reviews" class="content-section" data-title="([^"]+)">([\s\S]*?)<\/section>/);
    assert.ok(section);
    const inner = section[2];
    const claims = inner.indexOf('<div id="bo-studio-claims-root"></div>');
    const verifications = inner.indexOf('<div id="bo-studio-verifications-root"');
    const vendors = inner.indexOf('<div id="bo-supply-vendors-root"></div>');
    assert.ok(claims > -1 && verifications > claims && vendors > verifications);
    assert.equal((html.match(/id="bo-studio-verifications-root"/g) || []).length, 1);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
    const iClaims = scripts.indexOf('/shared/js/backoffice-studio-claims.js');
    const iVerif = scripts.indexOf('/shared/js/backoffice-studio-verifications.js');
    assert.ok(iClaims > -1 && iVerif === iClaims + 1);
});

test('the module never touches PostgREST directly nor uses inline handlers', () => {
    const src = read(MODULE_FILE);
    assert.ok(!/\/rest\/v1\//.test(src));
    assert.ok(!/\.from\(['"]/.test(src));
    assert.ok(!/\bon(click|error|load)=/i.test(src));
});
