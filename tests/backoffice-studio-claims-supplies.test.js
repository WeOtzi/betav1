// Backoffice: reclamos de estudios, vendors Supplies y la aceptación de
// postulaciones por RPC (W-BACKOFFICE).
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Backoffice".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const CLAIMS_FILE = 'public/shared/js/backoffice-studio-claims.js';
const SUPPLIES_FILE = 'public/shared/js/backoffice-supplies.js';
const KIT_FILE = 'public/shared/js/studio-admin-kit.js';
const ADMIN_FILE = 'public/shared/js/admin.js';
const HTML_FILE = 'public/backoffice/index.html';

const CLAIM_ID = '11111111-1111-4111-8111-111111111111';
const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const VENDOR_ID = '33333333-3333-4333-8333-333333333333';
const VENDOR_B = '44444444-4444-4444-8444-444444444444';
const VENDOR_C = '55555555-5555-4555-8555-555555555555';
const APP_ID = '66666666-6666-4666-8666-666666666666';

function freshRequire(file) {
    const full = path.join(ROOT, file);
    delete require.cache[require.resolve(full)];
    return require(full);
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function sessionClient(token = 'tok-123') {
    return { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } };
}

// fetch falso: registra cada llamada y responde con lo que devuelva `respond`.
function fakeFetch(respond) {
    const calls = [];
    const fn = async (url, options) => {
        const call = { url, options: options || {}, body: options && options.body ? JSON.parse(options.body) : null };
        calls.push(call);
        const out = (respond ? respond(call) : null) || { status: 200, body: { success: true } };
        const status = out.status || 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => (out.body === undefined ? '' : JSON.stringify(out.body))
        };
    };
    fn.calls = calls;
    return fn;
}

function claimRow(overrides = {}) {
    return Object.assign({
        id: CLAIM_ID,
        studio_id: STUDIO_ID,
        user_id: '77777777-7777-4777-8777-777777777777',
        status: 'pending',
        evidence: 'Soy la dueña. Mirá https://instagram.com/tinta.norte y javascript:alert(1)',
        contact_name: 'Ana Pérez',
        contact_phone: '+54 11 5555-5555',
        created_at: '2026-10-28T12:00:00.000Z',
        studios: { id: STUDIO_ID, name: 'Tinta Norte', slug: 'tinta-norte', city: 'Rosario', country: 'AR', user_id: null, is_active: true, logo_image: 'https://cdn.example.com/logo.png' },
        user: { id: '77777777-7777-4777-8777-777777777777', email: 'ana@example.com', email_confirmed_at: '2026-10-27T10:00:00Z', full_name: 'Ana P.' }
    }, overrides);
}

function vendorRow(overrides = {}) {
    return Object.assign({
        id: VENDOR_ID, user_id: '88888888-8888-4888-8888-888888888888', email: 'ventas@insumos.com',
        name: 'Insumos Sur', slug: 'insumos-sur-8888', country: 'AR', city: 'Córdoba', currency: 'ARS',
        platform_discount_pct: 10, is_verified: false, is_active: true, profile_complete: true,
        logo_image: null, created_at: '2026-10-29T09:00:00Z'
    }, overrides);
}

// =====================================================================
// Reclamos de estudios — funciones puras y HTTP
// =====================================================================

test('claims: buildDecideRequest arma POST /api/admin/studio-claims/:id/decide con {decision, note}', () => {
    const claims = freshRequire(CLAIMS_FILE);
    const approve = claims.buildDecideRequest(CLAIM_ID, 'approve', '   ');
    assert.equal(approve.url, `/api/admin/studio-claims/${CLAIM_ID}/decide`);
    assert.equal(approve.options.method, 'POST');
    assert.equal(approve.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(approve.options.body), { decision: 'approve', note: null });

    const reject = claims.buildDecideRequest(CLAIM_ID, 'reject', '  No pudimos verificarlo  ');
    assert.deepEqual(JSON.parse(reject.options.body), { decision: 'reject', note: 'No pudimos verificarlo' });

    const long = claims.buildDecideRequest(CLAIM_ID, 'reject', 'x'.repeat(1500));
    assert.equal(JSON.parse(long.options.body).note.length, 1000, 'la nota se recorta a 1000');

    assert.throws(() => claims.buildDecideRequest('no-uuid', 'approve'), /inválido/);
    assert.throws(() => claims.buildDecideRequest(CLAIM_ID, 'accept'), /approve o reject/);
    assert.throws(() => claims.buildDecideRequest(CLAIM_ID, 'reject', 'no'), /motivo/);
});

test('claims: claimView lee el embed `studios` y el usuario resuelto en el servidor', () => {
    const claims = freshRequire(CLAIMS_FILE);
    const view = claims.claimView(claimRow());
    assert.equal(view.studioName, 'Tinta Norte');
    assert.equal(view.location, 'Rosario, AR');
    assert.equal(view.profileHref, '/studio/profile?studio=tinta-norte');
    assert.equal(view.claimantEmail, 'ana@example.com');
    assert.equal(view.claimantName, 'Ana Pérez', 'contact_name gana sobre full_name');
    assert.equal(view.emailConfirmed, true);
    assert.equal(view.studioOwned, false);
    assert.equal(view.logo, 'https://cdn.example.com/logo.png');

    const owned = claims.claimView(claimRow({ studios: { id: STUDIO_ID, name: 'X', user_id: 'someone', logo_image: 'javascript:alert(1)' } }));
    assert.equal(owned.studioOwned, true);
    assert.equal(owned.logo, null, 'safeUrl descarta protocolos que no son http(s)');
});

test('claims: normalizeClaims descarta filas sin id o que ya no están pendientes', () => {
    const claims = freshRequire(CLAIMS_FILE);
    const list = claims.normalizeClaims({ claims: [claimRow(), { id: 'b', status: 'approved' }, null, { status: 'pending' }, { id: 'c' }] });
    assert.deepEqual(list.map(c => c.id), [CLAIM_ID, 'c']);
    assert.deepEqual(claims.normalizeClaims(null), []);
});

test('claims: el listado escapa datos, linkea solo http(s) y bloquea aprobar fichas con dueño', () => {
    const claims = freshRequire(CLAIMS_FILE);
    const evil = claimRow({
        contact_name: '<img src=x onerror=alert(1)>',
        studios: { id: STUDIO_ID, name: '<script>alert("x")</script>', slug: 'a"b', user_id: null }
    });
    const html = claims.renderClaimsHtml({ claims: [evil] });
    assert.ok(!html.includes('<script>alert'), 'el nombre del estudio va escapado');
    assert.ok(!html.includes('<img src=x'), 'el contacto va escapado');
    assert.ok(html.includes('&lt;script&gt;'));
    assert.match(html, /href="https:\/\/instagram\.com\/tinta\.norte" target="_blank" rel="noopener noreferrer nofollow"/);
    assert.ok(!/href="javascript:/i.test(html), 'javascript: nunca llega a un href');
    assert.match(html, /data-claim-action="approve" data-claim-id="[^"]+" title="Asignar/);
    assert.match(html, /href="\/studio\/profile\?studio=a%22b"/, 'el slug va codificado en la URL');

    const owned = claims.renderClaimsHtml({ claims: [claimRow({ studios: { id: STUDIO_ID, name: 'Con dueño', user_id: 'u' } })] });
    assert.match(owned, /data-claim-action="approve"[^>]* disabled title="La ficha ya tiene dueño/);
    assert.match(owned, /Ya tiene dueño/);
    assert.match(owned, /data-claim-action="reject"/);

    const unconfirmed = claims.renderClaimsHtml({ claims: [claimRow({ user: { id: 'u', email: 'x@y.com', email_confirmed_at: null } })] });
    assert.match(unconfirmed, /Email sin confirmar/);
});

test('claims: estados de carga, error, vacío y migración pendiente', () => {
    const claims = freshRequire(CLAIMS_FILE);
    assert.match(claims.renderClaimsHtml({ loading: true }), /Cargando reclamos/);
    const err = claims.renderClaimsHtml({ error: '<b>falló</b>' });
    assert.match(err, /No pudimos cargar los reclamos/);
    assert.match(err, /&lt;b&gt;falló&lt;\/b&gt;/);
    assert.match(err, /data-claims-action="reload"/);
    assert.match(claims.renderClaimsHtml({ claims: [] }), /No hay reclamos pendientes/);
    assert.match(claims.renderClaimsHtml({ migrationPending: true, claims: [] }), /falta aplicar una migración/);
    assert.equal(claims.MISSING_SCHEMA_MESSAGE, 'Esta función todavía no está disponible (falta aplicar una migración).');
});

test('claims: describeFailure traduce las respuestas del servidor (voseo, hint de soporte en 403)', () => {
    const claims = freshRequire(CLAIMS_FILE);
    assert.match(claims.describeFailure({ error: 'no_session' }), /Iniciá sesión/);
    assert.match(claims.describeFailure({ error: 'network' }), /Revisá tu conexión/);
    assert.equal(claims.describeFailure({ status: 503, data: { migration_pending: true } }), claims.MISSING_SCHEMA_MESSAGE);
    assert.match(claims.describeFailure({ status: 401, data: {} }), /sesión/);
    const forbidden = claims.describeFailure({ status: 403, data: { error: 'Solo soporte puede decidir reclamos' } }, { supportHint: true });
    assert.ok(forbidden.startsWith('Solo soporte puede decidir reclamos'));
    assert.ok(forbidden.includes(claims.SUPPORT_HINT));
    assert.match(claims.describeFailure({ status: 404, data: null }), /actualizá el deploy/);
    assert.equal(claims.describeFailure({ status: 409, data: { error: 'El estado cambió.' } }), 'El estado cambió.');
});

test('claims: decideClaim manda el Bearer de la sesión y nunca lanza', async () => {
    const claims = freshRequire(CLAIMS_FILE);
    const fetch = fakeFetch(() => ({ status: 200, body: { success: true, result: { status: 'approved' }, email_sent: false } }));
    const ok = await claims.decideClaim(CLAIM_ID, 'approve', 'Verificado por llamada', { fetch, client: sessionClient() });
    assert.equal(ok.ok, true);
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].url, `/api/admin/studio-claims/${CLAIM_ID}/decide`);
    assert.equal(fetch.calls[0].options.method, 'POST');
    assert.equal(fetch.calls[0].options.headers.Authorization, 'Bearer tok-123');
    assert.equal(fetch.calls[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(fetch.calls[0].body, { decision: 'approve', note: 'Verificado por llamada' });
    assert.match(claims.successMessage(claims.claimView(claimRow()), 'approve', ok.data), /No pudimos enviar el aviso por email/);

    const denied = await claims.decideClaim(CLAIM_ID, 'reject', 'No verificado',
        { fetch: fakeFetch(() => ({ status: 403, body: { success: false, error: 'No tenés permiso para esta acción.' } })), client: sessionClient() });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    assert.ok(denied.message.includes(claims.SUPPORT_HINT));

    const noSessionFetch = fakeFetch();
    const noSession = await claims.decideClaim(CLAIM_ID, 'approve', '', { fetch: noSessionFetch, client: sessionClient(null) });
    assert.equal(noSession.ok, false);
    assert.equal(noSessionFetch.calls.length, 0, 'sin sesión no se llama al servidor');

    const invalid = await claims.decideClaim('x', 'approve', '', { fetch: noSessionFetch, client: sessionClient() });
    assert.equal(invalid.ok, false);
    assert.match(invalid.message, /inválido/);

    const thrown = await claims.decideClaim(CLAIM_ID, 'approve', '', { fetch: async () => { throw new Error('boom'); }, client: sessionClient() });
    assert.equal(thrown.ok, false);
    assert.match(thrown.message, /Revisá tu conexión/);

    const softFail = await claims.fetchAdminJson('/api/x', {}, { fetch: fakeFetch(() => ({ status: 200, body: { success: false, error: 'nope' } })), client: sessionClient() });
    assert.equal(softFail.ok, false, 'success:false con HTTP 200 cuenta como error');
});

test('claims: load() trae los pendientes y respeta migration_pending', async () => {
    const claims = freshRequire(CLAIMS_FILE);
    const fetch = fakeFetch(() => ({ status: 200, body: { success: true, claims: [claimRow(), claimRow({ id: 'x', status: 'rejected' })] } }));
    const state = await claims.load({ fetch, client: sessionClient() });
    assert.equal(fetch.calls[0].url, '/api/admin/studio-claims');
    assert.equal(fetch.calls[0].options.method, 'GET');
    assert.equal(state.claims.length, 1);
    assert.equal(state.error, null);

    const pending = await claims.load({ fetch: fakeFetch(() => ({ status: 200, body: { success: true, claims: [], migration_pending: true } })), client: sessionClient() });
    assert.equal(pending.migrationPending, true);
    assert.equal(pending.error, null);
    assert.deepEqual(pending.claims, []);

    const failed = await claims.load({ fetch: fakeFetch(() => ({ status: 500, body: { success: false, error: 'No se pudieron cargar los reclamos.' } })), client: sessionClient() });
    assert.equal(failed.error, 'No se pudieron cargar los reclamos.');
});

test('claims: aprobar una ficha que ya tiene dueño no llega al servidor', async () => {
    const claims = freshRequire(CLAIMS_FILE);
    const fetch = fakeFetch(() => ({ status: 200, body: { success: true, claims: [claimRow({ studios: { id: STUDIO_ID, name: 'Con dueño', user_id: 'u' } })] } }));
    await claims.load({ fetch, client: sessionClient() });
    const toasts = [];
    globalThis.showToast = (msg, type) => toasts.push({ msg, type });
    try {
        const res = await claims.startDecision(CLAIM_ID, 'approve');
        assert.equal(res, null);
        assert.equal(fetch.calls.length, 1, 'solo el GET inicial');
        assert.equal(toasts[0].type, 'warning');
        assert.match(toasts[0].msg, /ya tiene dueño/);
    } finally {
        delete globalThis.showToast;
    }
});

test('claims: dialogConfig exige motivo al rechazar y explica el efecto de aprobar', () => {
    const claims = freshRequire(CLAIMS_FILE);
    const view = claims.claimView(claimRow());
    const approve = claims.dialogConfig(view, 'approve');
    assert.equal(approve.required, false);
    assert.match(approve.bodyHtml, /Los otros reclamos pendientes de este estudio quedan rechazados/);
    const reject = claims.dialogConfig(view, 'reject');
    assert.equal(reject.required, true);
    assert.match(reject.noteLabel, /Motivo/);
    const evil = claims.dialogConfig(claims.claimView(claimRow({ studios: { name: '<b>x</b>' } })), 'approve');
    assert.ok(!evil.bodyHtml.includes('<b>x</b>'));
});

test('claims + supplies: el contador del menú suma los pendientes de ambos módulos', () => {
    const claims = freshRequire(CLAIMS_FILE);
    const supplies = freshRequire(SUPPLIES_FILE);
    delete globalThis.__weotziBoPendingCounts;
    try {
        assert.equal(claims.reportPending('studio_claims', 2), 2);
        assert.equal(supplies.reportPending('supply_vendors', 3), 5);
        assert.equal(claims.reportPending('studio_claims', 0), 3);
        assert.equal(supplies.reportPending('supply_vendors', -4), 0, 'nunca negativo');
    } finally {
        delete globalThis.__weotziBoPendingCounts;
    }
});

test('claims + supplies: becameActive detecta la activación y el re-click en el menú', () => {
    for (const mod of [freshRequire(CLAIMS_FILE), freshRequire(SUPPLIES_FILE)]) {
        assert.equal(mod.becameActive([{ oldValue: 'content-section' }], false), true, 'pasa a activa');
        assert.equal(mod.becameActive([{ oldValue: 'content-section active' }, { oldValue: 'content-section' }], true), true, 're-click');
        assert.equal(mod.becameActive([{ oldValue: 'content-section active' }], true), false, 'otro cambio de clase');
        assert.equal(mod.becameActive(undefined, false), true, 'sin registros: transición');
        assert.equal(mod.becameActive(undefined, true), false);
    }
});

test('claims + supplies: con el kit cargado usan su safeUrl/escapeHtml', () => {
    globalThis.WeOtziStudioKit = freshRequire(KIT_FILE);
    try {
        const claims = freshRequire(CLAIMS_FILE);
        const supplies = freshRequire(SUPPLIES_FILE);
        assert.equal(claims.claimView(claimRow({ studios: { logo_image: 'javascript:alert(1)' } })).logo, null);
        assert.equal(claims.claimView(claimRow()).logo, 'https://cdn.example.com/logo.png');
        const html = supplies.renderVendorsHtml({ vendors: [vendorRow({ name: '<i>x</i>', logo_image: 'data:image/png;base64,AAA' })] });
        assert.ok(!html.includes('<i>x</i>'));
        assert.ok(!html.includes('data:image'), 'un logo data: no llega al src');
        assert.match(html, /We Ötzi: 10/);
    } finally {
        delete globalThis.WeOtziStudioKit;
    }
});

// =====================================================================
// Vendors Supplies — funciones puras y HTTP
// =====================================================================

test('supplies: estado del vendor y visibilidad para estudios (activo + verificado)', () => {
    const supplies = freshRequire(SUPPLIES_FILE);
    assert.equal(supplies.vendorStatus(vendorRow()), 'unverified');
    assert.equal(supplies.vendorStatus(vendorRow({ is_verified: true })), 'verified');
    assert.equal(supplies.vendorStatus(vendorRow({ is_verified: true, is_active: false })), 'inactive');
    assert.equal(supplies.isVisibleToStudios(vendorRow({ is_verified: true })), true);
    assert.equal(supplies.isVisibleToStudios(vendorRow({ is_verified: true, is_active: false })), false);
    assert.equal(supplies.isVisibleToStudios(vendorRow()), false);
    assert.deepEqual(
        supplies.vendorCounts([vendorRow(), vendorRow({ is_verified: true }), vendorRow({ is_active: false })]),
        { total: 3, review: 1, verified: 1, inactive: 1 }
    );
});

test('supplies: filterVendors ordena En revisión → verificados → inactivos y busca por texto', () => {
    const supplies = freshRequire(SUPPLIES_FILE);
    const list = [
        vendorRow({ id: 'a', name: 'Alfa', is_verified: true }),
        vendorRow({ id: 'b', name: 'Beta', is_active: false }),
        vendorRow({ id: 'c', name: 'Gamma', city: 'Mendoza' }),
        vendorRow({ id: 'd', name: 'Delta', is_verified: true })
    ];
    assert.deepEqual(supplies.filterVendors(list, {}).map(v => v.id), ['c', 'a', 'd', 'b']);
    assert.deepEqual(supplies.filterVendors(list, { status: 'review' }).map(v => v.id), ['c']);
    assert.deepEqual(supplies.filterVendors(list, { status: 'verified' }).map(v => v.id), ['a', 'd']);
    assert.deepEqual(supplies.filterVendors(list, { status: 'inactive' }).map(v => v.id), ['b']);
    assert.deepEqual(supplies.filterVendors(list, { search: 'mendoza' }).map(v => v.id), ['c']);
    assert.deepEqual(supplies.filterVendors(list, { status: 'otro' }).length, 4, 'un filtro desconocido equivale a todos');
});

test('supplies: buildPatchRequest solo manda is_verified / is_active booleanos', () => {
    const supplies = freshRequire(SUPPLIES_FILE);
    const req = supplies.buildPatchRequest(VENDOR_ID, { is_verified: true, name: 'hack', is_admin: true });
    assert.equal(req.url, `/api/admin/supply-vendors/${VENDOR_ID}`);
    assert.equal(req.options.method, 'PATCH');
    assert.deepEqual(JSON.parse(req.options.body), { is_verified: true });
    assert.deepEqual(JSON.parse(supplies.buildPatchRequest(VENDOR_ID, { is_active: false, is_verified: false }).options.body),
        { is_verified: false, is_active: false });
    assert.throws(() => supplies.buildPatchRequest(VENDOR_ID, { is_verified: 'true' }), /true o false/);
    assert.throws(() => supplies.buildPatchRequest(VENDOR_ID, { name: 'x' }), /No hay cambios/);
    assert.throws(() => supplies.buildPatchRequest('nope', { is_active: true }), /inválido/);
    assert.deepEqual(supplies.ACTIONS, {
        verify: { is_verified: true }, unverify: { is_verified: false },
        activate: { is_active: true }, deactivate: { is_active: false }
    });
});

test('supplies: el listado escapa, ofrece la acción opuesta al estado y avisa si no es visible', () => {
    const supplies = freshRequire(SUPPLIES_FILE);
    const html = supplies.renderVendorsHtml({
        vendors: [
            vendorRow({ name: '<script>x</script>', profile_complete: false }),
            vendorRow({ id: VENDOR_B, name: 'Verificado', is_verified: true }),
            vendorRow({ id: VENDOR_C, name: 'Apagado', is_verified: true, is_active: false, user_id: null })
        ]
    });
    assert.ok(!html.includes('<script>x</script>'));
    assert.match(html, new RegExp(`data-vendor-action="verify" data-vendor-id="${VENDOR_ID}"`));
    assert.match(html, new RegExp(`data-vendor-action="deactivate" data-vendor-id="${VENDOR_ID}"`));
    assert.match(html, new RegExp(`data-vendor-action="unverify" data-vendor-id="${VENDOR_B}"`));
    assert.match(html, new RegExp(`data-vendor-action="activate" data-vendor-id="${VENDOR_C}"`));
    assert.match(html, /Perfil incompleto/);
    assert.match(html, /No visible para los estudios/);
    assert.match(html, /Sin cuenta vinculada/);
    assert.match(html, /En revisión/);
    assert.ok(!html.includes('fa-badge-check'), 'sin íconos de Font Awesome Pro');
    assert.match(supplies.renderVendorsHtml({ vendors: [], migrationPending: true }), /falta aplicar una migración/);
    assert.match(supplies.renderVendorsHtml({ vendors: [] }), /Todavía no hay vendors Supplies/);
    assert.match(supplies.renderVendorsHtml({ vendors: [vendorRow()], filters: { status: 'inactive' } }), /Ningún vendor coincide/);
    assert.match(supplies.renderVendorsHtml({ error: 'x' }), /data-vendors-action="reload"/);
});

test('supplies: textos de confirmación y de éxito explican la visibilidad para estudios', () => {
    const supplies = freshRequire(SUPPLIES_FILE);
    assert.match(supplies.confirmText(vendorRow({ profile_complete: false }), 'verify'), /todavía no completó su perfil/);
    assert.match(supplies.confirmText(vendorRow(), 'deactivate'), /deja de estar visible/);
    assert.equal(supplies.confirmText(vendorRow(), 'activate'), null, 'activar no pide confirmación');
    assert.match(supplies.successMessage(vendorRow({ is_verified: true, is_active: false }), 'verify'), /Activalo/);
    assert.match(supplies.successMessage(vendorRow({ is_verified: false }), 'activate'), /Verificalo/);
    assert.match(supplies.successMessage(vendorRow({ is_verified: true }), 'activate'), /ya ven su catálogo/);
});

test('supplies: load + runAction hacen GET y PATCH con Bearer y actualizan la fila en memoria', async () => {
    const supplies = freshRequire(SUPPLIES_FILE);
    const fetch = fakeFetch(call => {
        if (call.options.method === 'GET') return { status: 200, body: { success: true, vendors: [vendorRow()] } };
        return { status: 200, body: { success: true, vendor: vendorRow({ is_verified: true, updated_at: 'now' }) } };
    });
    const deps = { fetch, client: sessionClient('tok-v') };
    const state = await supplies.load(deps);
    assert.equal(fetch.calls[0].url, '/api/admin/supply-vendors');
    assert.equal(fetch.calls[0].options.headers.Authorization, 'Bearer tok-v');
    assert.equal(state.vendors.length, 1);

    const toasts = [];
    const confirms = [];
    globalThis.showToast = (msg, type) => toasts.push({ msg, type });
    globalThis.confirm = text => { confirms.push(text); return true; };
    try {
        const res = await supplies.runAction(VENDOR_ID, 'verify', deps);
        assert.equal(res.ok, true);
        assert.equal(fetch.calls[1].url, `/api/admin/supply-vendors/${VENDOR_ID}`);
        assert.equal(fetch.calls[1].options.method, 'PATCH');
        assert.deepEqual(fetch.calls[1].body, { is_verified: true });
        assert.equal(confirms.length, 1);
        assert.equal(supplies.getState().vendors[0].is_verified, true);
        assert.equal(toasts.at(-1).type, 'success');

        globalThis.confirm = () => false;
        const cancelled = await supplies.runAction(VENDOR_ID, 'deactivate', deps);
        assert.equal(cancelled, null, 'si no confirma, no hay PATCH');
        assert.equal(fetch.calls.length, 2);

        assert.equal(await supplies.runAction(VENDOR_ID, 'delete', deps), null, 'acción desconocida');
    } finally {
        delete globalThis.showToast;
        delete globalThis.confirm;
    }

    const pending = await supplies.load({ fetch: fakeFetch(() => ({ status: 200, body: { success: true, vendors: [], migration_pending: true } })), client: sessionClient() });
    assert.equal(pending.migrationPending, true);
    assert.equal(pending.error, null);

    const failedPatch = await supplies.setVendorFlags(VENDOR_ID, { is_active: false },
        { fetch: fakeFetch(() => ({ status: 503, body: { success: false, migration_pending: true, error: 'x' } })), client: sessionClient() });
    assert.equal(failedPatch.ok, false);
    assert.equal(failedPatch.message, supplies.MISSING_SCHEMA_MESSAGE);
});

// =====================================================================
// Montaje en el backoffice (DOM falso en una VM)
// =====================================================================

function classList(initial) {
    const set = new Set(initial);
    return {
        contains: c => set.has(c),
        add: c => set.add(c),
        remove: c => set.delete(c),
        toString: () => [...set].join(' ')
    };
}

function fakeElement(name, extra = {}) {
    const el = {
        name, attrs: {}, children: {}, listeners: {}, innerHTML: '', textContent: '', hidden: true,
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        querySelector(sel) { return this.children[sel] || null; },
        querySelectorAll() { return []; },
        closest() { return null; }
    };
    return Object.assign(el, extra);
}

// Corre kit + módulo como en index.html (scripts clásicos sobre `window`).
function bootBackoffice(moduleFile, { rootId, listSel, metaSel, active = false, client = sessionClient(), respond } = {}) {
    const observers = [];
    const timers = [];
    const section = fakeElement('section', { classList: classList(active ? ['content-section', 'active'] : ['content-section']) });
    section.attrs['data-title'] = 'Reclamos de estudios y vendors Supplies';
    const list = fakeElement('list');
    const meta = fakeElement('meta');
    const rootEl = fakeElement('root', { closest: sel => (sel === '.content-section' ? section : null) });
    rootEl.children[listSel] = list;
    rootEl.children[metaSel] = meta;
    const title = fakeElement('title');
    const navBadge = fakeElement('badge');
    const styles = [];
    const document = {
        readyState: 'complete',
        head: { appendChild: el => styles.push(el) },
        getElementById: id => ({ [rootId]: rootEl, 'section-title': title })[id] || null,
        createElement: tag => ({ tag }),
        querySelectorAll: sel => (sel === '[data-bo-pending-count]' ? [navBadge] : []),
        addEventListener() {}
    };
    class FakeMutationObserver {
        constructor(cb) { this.cb = cb; observers.push(this); }
        observe(target, opts) { this.target = target; this.opts = opts; }
    }
    const fetch = fakeFetch(respond);
    const sandbox = {
        document, console, URL, fetch,
        MutationObserver: FakeMutationObserver,
        ConfigManager: { getSupabaseClient: () => sandbox.__client },
        __client: client,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {},
        showToast() {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read(KIT_FILE), sandbox, { filename: KIT_FILE });
    vm.runInContext(read(moduleFile), sandbox, { filename: moduleFile });
    // showSection(...) de admin.js: saca y pone `active` (registros con oldValue).
    const activate = () => {
        const wasActive = section.classList.contains('active');
        section.classList.remove('active');
        section.classList.add('active');
        observers.forEach(o => o.cb(wasActive
            ? [{ oldValue: 'content-section active' }, { oldValue: 'content-section' }]
            : [{ oldValue: 'content-section' }]));
    };
    return { sandbox, section, rootEl, list, meta, title, navBadge, styles, observers, timers, fetch, activate };
}

test('montaje: reclamos se montan en #bo-studio-claims-root y cargan al activar la sección', async () => {
    const env = bootBackoffice(CLAIMS_FILE, {
        rootId: 'bo-studio-claims-root', listSel: '[data-claims-list]', metaSel: '[data-claims-meta]',
        respond: () => ({ status: 200, body: { success: true, claims: [claimRow()] } })
    });
    assert.ok(env.sandbox.WeOtziBackofficeStudioClaims, 'expone window.WeOtziBackofficeStudioClaims');
    assert.equal(env.rootEl.getAttribute('data-bo-mounted'), 'true');
    assert.match(env.rootEl.innerHTML, /data-claims-list/);
    assert.match(env.rootEl.innerHTML, /Reclamos de estudios/);
    assert.equal(env.styles.length, 1, 'inyecta sus estilos una vez');
    assert.equal(env.observers.length, 1);
    assert.equal(env.observers[0].target, env.section);
    assert.deepEqual([...env.observers[0].opts.attributeFilter], ['class']);
    assert.equal(env.observers[0].opts.attributeOldValue, true);
    assert.equal(env.fetch.calls.length, 0, 'la sección inactiva no carga al montar');
    assert.equal(env.timers.length, 1, 'agenda la precarga del contador');

    env.activate();
    await flush();
    assert.equal(env.title.textContent, 'Reclamos de estudios y vendors Supplies', 'sincroniza el título del header');
    assert.equal(env.fetch.calls.length, 1);
    assert.equal(env.fetch.calls[0].url, '/api/admin/studio-claims');
    assert.equal(env.fetch.calls[0].options.headers.Authorization, 'Bearer tok-123');
    assert.match(env.list.innerHTML, /Tinta Norte/);
    assert.match(env.meta.innerHTML, /1<\/strong> reclamo pendiente/);
    assert.equal(env.navBadge.textContent, '1');
    assert.equal(env.navBadge.hidden, false);

    env.activate(); // click otra vez en "Revisiones"
    await flush();
    assert.equal(env.fetch.calls.length, 2, 'volver a entrar recarga, como el resto de las secciones');

    env.timers[0].fn(); // la precarga ya no hace falta
    await flush();
    assert.equal(env.fetch.calls.length, 2);
});

test('montaje: la precarga del contador reintenta mientras no hay sesión', async () => {
    const env = bootBackoffice(CLAIMS_FILE, {
        rootId: 'bo-studio-claims-root', listSel: '[data-claims-list]', metaSel: '[data-claims-meta]',
        client: sessionClient(null),
        respond: () => ({ status: 200, body: { success: true, claims: [claimRow(), claimRow({ id: CLAIM_ID.replace('1111-4', '9999-4') })] } })
    });
    env.timers.shift().fn();
    await flush();
    assert.equal(env.fetch.calls.length, 0, 'sin sesión no hay request');
    assert.equal(env.timers.length, 1, 'agenda un reintento');
    env.sandbox.__client = sessionClient('tok-late');
    env.timers.shift().fn();
    await flush();
    assert.equal(env.fetch.calls.length, 1);
    assert.equal(env.fetch.calls[0].options.headers.Authorization, 'Bearer tok-late');
    assert.equal(env.navBadge.textContent, '2');
    assert.equal(env.timers.length, 0, 'con sesión no reintenta más');
});

test('montaje: vendors Supplies se montan en #bo-supply-vendors-root y cuentan "En revisión"', async () => {
    const env = bootBackoffice(SUPPLIES_FILE, {
        rootId: 'bo-supply-vendors-root', listSel: '[data-vendors-list]', metaSel: '[data-vendors-meta]',
        active: true,
        respond: () => ({ status: 200, body: { success: true, vendors: [vendorRow(), vendorRow({ id: VENDOR_B, is_verified: true })] } })
    });
    assert.ok(env.sandbox.WeOtziBackofficeSupplies, 'expone window.WeOtziBackofficeSupplies');
    assert.match(env.rootEl.innerHTML, /data-vendors-search/);
    assert.match(env.rootEl.innerHTML, /data-vendors-filter/);
    await flush();
    assert.equal(env.fetch.calls.length, 1, 'la sección ya activa carga al montar');
    assert.equal(env.fetch.calls[0].url, '/api/admin/supply-vendors');
    assert.equal(env.timers.length, 0, 'sin precarga si ya cargó');
    assert.equal(env.title.textContent, 'Reclamos de estudios y vendors Supplies');
    assert.match(env.list.innerHTML, /Insumos Sur/);
    assert.match(env.meta.innerHTML, /1<\/strong> en revisión/);
    assert.equal(env.navBadge.textContent, '1');
});

// =====================================================================
// admin.js: setApplicationStatus('accepted') → RPC vía endpoint de admin
// =====================================================================

function adminSpotDecision({ fetchImpl, rosterLoaded = true } = {}) {
    const source = read(ADMIN_FILE);
    const start = source.indexOf('// ---- Postulaciones: aceptar por la RPC');
    const end = source.indexOf('// ---- Roster (studio_artist_memberships) ----');
    assert.ok(start > 0 && end > start, 'el bloque de postulaciones está delimitado en admin.js');
    const calls = [];
    const toasts = [];
    const reloads = { applications: [], roster: 0 };
    const sandbox = {
        console,
        sdCurrentSpotId: 'spot-1',
        _fetchAdminJson: async (url, options) => {
            const call = { url, options, body: options && options.body ? JSON.parse(options.body) : null };
            calls.push(call);
            return fetchImpl ? fetchImpl(call) : { success: true };
        },
        showToast: (msg, type) => toasts.push({ msg, type }),
        escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        loadSpotApplications: id => reloads.applications.push(id),
        loadStudioRoster: () => { reloads.roster += 1; },
        document: { getElementById: id => (id === 'sd-roster-body' && rosterLoaded ? {} : null) }
    };
    vm.createContext(sandbox);
    vm.runInContext(source.slice(start, end), sandbox, { filename: ADMIN_FILE });
    return { sandbox, calls, toasts, reloads };
}

test('admin.js: aceptar una postulación llama a decide_studio_spot_application por el endpoint de admin', async () => {
    const env = adminSpotDecision({ fetchImpl: () => ({ success: true, application: { id: APP_ID, status: 'shortlisted' } }) });
    const application = await env.sandbox.setApplicationStatus(APP_ID, 'accepted');
    assert.equal(application.status, 'shortlisted');
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].url, `/api/admin/studio-spot-applications/${APP_ID}/decide`);
    assert.equal(env.calls[0].options.method, 'POST');
    assert.equal(env.calls[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(env.calls[0].body, { status: 'accepted' });
    assert.ok(!env.calls.some(c => /database\/tables\/studio_spot_applications/.test(c.url)), 'nunca escribe accepted directo en la tabla');
    assert.equal(env.toasts[0].type, 'success');
    assert.match(env.toasts[0].msg, /borrador de contrato/);
    assert.deepEqual(env.reloads.applications, ['spot-1']);
    assert.equal(env.reloads.roster, 1, 'refresca el roster si está a la vista');
});

test('admin.js: sin la migración de contratos la RPC viva acepta y suma al roster', async () => {
    const env = adminSpotDecision({ fetchImpl: () => ({ success: true, application: { id: APP_ID, status: 'accepted' } }), rosterLoaded: false });
    await env.sandbox.setApplicationStatus(APP_ID, 'accepted');
    assert.match(env.toasts[0].msg, /sumado al roster/);
    assert.equal(env.reloads.roster, 0, 'sin roster en pantalla no lo recarga');
});

test('admin.js: un error de permisos muestra el hint de soporte escapado y no duplica requests', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const env = adminSpotDecision({
        fetchImpl: async () => { await gate; throw new Error('No tenés permiso <para> esta acción.'); }
    });
    const first = env.sandbox.setApplicationStatus(APP_ID, 'accepted');
    const second = await env.sandbox.setApplicationStatus(APP_ID, 'accepted');
    assert.equal(second, null, 'un doble click mientras está en curso no manda otro request');
    release();
    assert.equal(await first, null);
    assert.equal(env.calls.length, 1);
    assert.equal(env.toasts[0].type, 'error');
    assert.match(env.toasts[0].msg, /No se pudo aceptar la postulación/);
    assert.match(env.toasts[0].msg, /Usuarios Soporte/);
    assert.ok(env.toasts[0].msg.includes('&lt;para&gt;'), 'el mensaje del servidor va escapado');
    assert.deepEqual(env.reloads.applications, ['spot-1'], 'recarga la lista para mostrar el estado real');
});

test('admin.js: rechazar va por la RPC; preseleccionar sigue por la edición de fila', async () => {
    const env = adminSpotDecision();
    await env.sandbox.setApplicationStatus(APP_ID, 'rejected');
    await env.sandbox.setApplicationStatus(APP_ID, 'shortlisted');
    assert.equal(env.calls.length, 2);
    assert.equal(env.calls[0].url, `/api/admin/studio-spot-applications/${APP_ID}/decide`);
    assert.equal(env.calls[0].options.method, 'POST');
    assert.equal(env.calls[0].body.status, 'rejected');
    assert.equal(env.calls[1].url, '/api/admin/database/tables/studio_spot_applications/row');
    assert.equal(env.calls[1].options.method, 'PATCH');
    assert.equal(env.calls[1].body.patch.status, 'shortlisted');
});

// =====================================================================
// Markup y contrato con el servidor
// =====================================================================

test('index.html: entrada de menú, contenedor y scripts de Revisiones', () => {
    const html = read(HTML_FILE);
    const nav = html.match(/<a href="#" class="nav-item" data-section="reviews">([\s\S]*?)<\/a>/);
    assert.ok(nav, 'entrada de menú data-section="reviews"');
    assert.match(nav[1], /<span>Revisiones<\/span>/);
    assert.match(nav[1], /data-bo-pending-count hidden/);
    assert.ok(html.indexOf('data-section="reviews"') > html.indexOf('data-section="studios"'), 'va junto a Estudios');
    assert.ok(html.indexOf('data-section="reviews"') < html.indexOf('nav-divider'), 'fuera de Super Admin: también la usa soporte');

    const section = html.match(/<section id="section-reviews" class="content-section" data-title="([^"]+)">([\s\S]*?)<\/section>/);
    assert.ok(section, 'section#section-reviews (showSection usa section-${id})');
    assert.match(section[2], /<div id="bo-studio-claims-root"><\/div>/);
    assert.match(section[2], /<div id="bo-supply-vendors-root"><\/div>/);
    assert.equal((html.match(/id="bo-studio-claims-root"/g) || []).length, 1);
    assert.equal((html.match(/id="bo-supply-vendors-root"/g) || []).length, 1);

    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1].split('?')[0]);
    const iAdmin = scripts.indexOf('/shared/js/admin.js');
    const iKit = scripts.indexOf('/shared/js/studio-admin-kit.js');
    const iClaims = scripts.indexOf('/shared/js/backoffice-studio-claims.js');
    const iSupplies = scripts.indexOf('/shared/js/backoffice-supplies.js');
    assert.ok(iAdmin >= 0 && iKit > iAdmin && iClaims > iKit && iSupplies > iClaims, 'admin.js → kit → reclamos → supplies');
    for (const src of ['/shared/js/studio-admin-kit.js', '/shared/js/backoffice-studio-claims.js', '/shared/js/backoffice-supplies.js']) {
        assert.ok(fs.existsSync(path.join(ROOT, 'public', src)), `${src} existe`);
    }
    assert.match(html, /admin\.js\?v=20261030-spot-decide-rpc/, 'cache-buster de admin.js actualizado');
});

test('server.js expone los endpoints que usa el backoffice', () => {
    const server = read('server.js');
    assert.match(server, /app\.get\('\/api\/admin\/studio-claims',/);
    assert.match(server, /app\.post\('\/api\/admin\/studio-claims\/:id\/decide',/);
    assert.match(server, /app\.get\('\/api\/admin\/supply-vendors',/);
    assert.match(server, /app\.patch\('\/api\/admin\/supply-vendors\/:id',/);
    assert.match(server, /app\.post\('\/api\/admin\/studio-spot-applications\/:id\/decide',/);
    assert.match(server, /\['approve', 'reject'\]\.includes\(decision\)/);
    assert.match(server, /for \(const key of \['is_verified', 'is_active'\]\)/);
    assert.match(server, /\['accepted', 'rejected'\]\.includes\(status\)/);
});

test('los módulos del backoffice no tocan PostgREST directo ni usan innerHTML con datos sin escapar', () => {
    for (const file of [CLAIMS_FILE, SUPPLIES_FILE]) {
        const src = read(file);
        assert.ok(!/\/rest\/v1\//.test(src), `${file}: sin fetch('/rest/v1/...')`);
        assert.ok(!/\.from\(['"]/.test(src), `${file}: sin _supabase.from(...)`);
        assert.ok(!/\bon(click|error|load)=/i.test(src), `${file}: sin handlers inline`);
        assert.match(src, /\$\{|esc\(/, `${file}: escapa interpolaciones`);
    }
});
