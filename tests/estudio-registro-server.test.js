// Frente estudio-registro: rutas del servidor (cola de reclamos del backoffice y
// bienvenida del estudio), eventos de email y migraciones. Sin red: las
// dependencias se inyectan en register(app, deps).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routes = require('../lib/routes/estudio-registro');
const events = require('../services/email-events/estudio-registro');
const repoModule = require('../lib/repos/studio-claims');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const CLAIM_ID = '22222222-2222-4222-8222-222222222222';
const STUDIO_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function fakeApp() {
    const handlers = {};
    return {
        handlers,
        get(p, fn) { handlers['GET ' + p] = fn; },
        post(p, fn) { handlers['POST ' + p] = fn; }
    };
}
function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.body = body; return res; };
    return res;
}
function setup(overrides = {}) {
    const sent = [];
    const repo = {
        listPendingClaims: async () => [{ id: CLAIM_ID, status: 'pending' }],
        decideClaimAsCaller: async () => ({ status: 'approved' }),
        getClaimWithParties: async () => ({ id: CLAIM_ID, status: 'approved', contact_name: 'Ana', decision_note: null, studios: { name: 'Black <Ink>' }, user: { email: 'ana@example.test' } }),
        isActiveSupportUser: async () => true,
        getOwnedStudioForWelcome: async () => ({ id: STUDIO_ID, slug: 'black-ink', name: 'Black Ink', verification_required: false, locations: [
            { label: 'Centro', city: 'Rosario', is_primary: true, is_active: true },
            { label: 'Norte', city: 'Rosario', is_primary: false, is_active: false }
        ] }),
        ...(overrides.repo || {})
    };
    const app = fakeApp();
    routes.register(app, {
        verifyAdminCaller: overrides.verifyAdminCaller || (async () => ({ ok: false, status: 403 })),
        resolveBearerUser: overrides.resolveBearerUser || (async () => ({ id: USER_ID, email: 'ana@example.test' })),
        bearerToken: () => 'jwt',
        applicationBase: () => 'https://weotzi.com/beta',
        sendEmail: async (...args) => { sent.push(args); return { ok: true, delivery_status: 'accepted' }; },
        repo,
        logger: { warn() {}, error() {} }
    });
    return { app, sent, repo };
}

test('la cola de reclamos exige superadmin o soporte activo', async () => {
    const anon = setup({ verifyAdminCaller: async () => ({ ok: false, status: 401, error: 'Authentication required' }) });
    const res = fakeRes();
    await anon.app.handlers['GET /api/admin/studio-claims']({ headers: {} }, res);
    assert.equal(res.statusCode, 401);

    const notSupport = setup({ repo: { isActiveSupportUser: async () => false } });
    const res2 = fakeRes();
    await notSupport.app.handlers['GET /api/admin/studio-claims']({ headers: {} }, res2);
    assert.equal(res2.statusCode, 403);

    const support = setup();
    const res3 = fakeRes();
    await support.app.handlers['GET /api/admin/studio-claims']({ headers: {} }, res3);
    assert.equal(res3.statusCode, 200);
    assert.equal(res3.body.claims[0].id, CLAIM_ID);
});

test('sin la tabla de reclamos la cola responde vacía con migration_pending', async () => {
    const h = setup({ repo: { listPendingClaims: async () => { const e = new Error('PostgREST GET failed (404): {"code":"42P01"}'); throw e; } } });
    const res = fakeRes();
    await h.app.handlers['GET /api/admin/studio-claims']({ headers: {} }, res);
    assert.deepEqual(res.body, { success: true, claims: [], migration_pending: true });
});

test('decidir valida el id, la decisión y el motivo del rechazo', async () => {
    const h = setup();
    const call = async (id, body) => { const res = fakeRes(); await h.app.handlers['POST /api/admin/studio-claims/:id/decide']({ params: { id }, body, headers: {} }, res); return res; };
    assert.equal((await call('nope', { decision: 'approve' })).statusCode, 400);
    assert.equal((await call(CLAIM_ID, { decision: 'maybe' })).statusCode, 400);
    const noReason = await call(CLAIM_ID, { decision: 'reject', note: ' ' });
    assert.equal(noReason.statusCode, 400);
    assert.match(noReason.body.error, /motivo/);
});

test('aprobar avisa por email una sola vez al reclamante con links del servidor', async () => {
    const h = setup();
    const res = fakeRes();
    await h.app.handlers['POST /api/admin/studio-claims/:id/decide']({ params: { id: CLAIM_ID }, body: { decision: 'approve', note: 'ok' }, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.email.sent, true);
    assert.equal(h.sent.length, 1);
    const [eventId, payload, opts] = h.sent[0];
    assert.equal(eventId, 'studio_claim_decided');
    assert.equal(payload.email, 'ana@example.test');
    assert.equal(payload.cta_url, 'https://weotzi.com/beta/studio/dashboard');
    assert.equal(opts.idempotencyKey, `studio_claim_decided:${CLAIM_ID}:approved`);
});

test('los errores de decide_studio_claim se traducen a HTTP', async () => {
    const fail = code => setup({ repo: { decideClaimAsCaller: async () => { const e = new Error('rpc failed'); e.code = code; e.dbMessage = 'Este reclamo ya fue resuelto.'; throw e; } } });
    for (const [code, status] of [['42501', 403], ['22023', 400], ['23514', 409], ['PGRST202', 503], ['XX000', 502]]) {
        const h = fail(code);
        const res = fakeRes();
        await h.app.handlers['POST /api/admin/studio-claims/:id/decide']({ params: { id: CLAIM_ID }, body: { decision: 'approve' }, headers: {} }, res);
        assert.equal(res.statusCode, status, code);
        assert.equal(h.sent.length, 0, 'sin decisión no hay email');
    }
});

test('la bienvenida usa el estudio del token, links confiables y una clave por cuenta', async () => {
    const h = setup();
    const res = fakeRes();
    await h.app.handlers['POST /api/studio/registration/welcome']({ headers: {}, body: { email: 'otro@evil.test', dashboard_url: 'https://evil.test' } }, res);
    assert.equal(res.statusCode, 200);
    const [eventId, payload, opts] = h.sent[0];
    assert.equal(eventId, 'studio_registration_completed');
    assert.equal(payload.email, 'ana@example.test', 'nunca el email del body');
    assert.equal(payload.dashboard_url, 'https://weotzi.com/beta/studio/dashboard');
    assert.equal(payload.verification_url, 'https://weotzi.com/beta/studio/dashboard#verificacion');
    assert.equal(payload.locations_count, 1, 'solo sedes activas');
    assert.equal(payload.locations_text, 'Centro · Rosario');
    assert.equal(opts.idempotencyKey, `registration:studio:${USER_ID}`);

    const anon = setup({ resolveBearerUser: async () => null });
    const res2 = fakeRes();
    await anon.app.handlers['POST /api/studio/registration/welcome']({ headers: {} }, res2);
    assert.equal(res2.statusCode, 401);

    const noStudio = setup({ repo: { getOwnedStudioForWelcome: async () => null } });
    const res3 = fakeRes();
    await noStudio.app.handlers['POST /api/studio/registration/welcome']({ headers: {} }, res3);
    assert.equal(res3.statusCode, 404);
    assert.equal(noStudio.sent.length, 0);
});

test('los eventos de email del frente siguen el contrato del frente emails', () => {
    for (const [id, ev] of Object.entries(events)) {
        assert.equal(ev.serverOnly, true, id + ' lo dispara solo el servidor');
        assert.equal(typeof ev.recipient, 'function');
        assert.equal(typeof ev.attribs, 'function');
        assert.ok(ev.name && ev.description && ev.templateHint);
        assert.ok(['artist', 'client', 'studio', 'admin'].includes(ev.render.audience));
        assert.ok(['transactional', 'quotations', 'messages', 'calendar', 'account', 'studios'].includes(ev.render.category));
        for (const key of ['subject', 'preheader', 'headline', 'intro', 'rows', 'cta']) assert.equal(typeof ev.render[key], 'function', id + '.' + key);
        assert.equal(typeof ev.render.eyebrow, 'string');
    }
    const welcome = events.studio_registration_completed;
    const attribs = welcome.attribs({ email: 'a@b.test', studio_name: 'Black Ink', locations_text: 'Centro', dashboard_url: 'https://x/studio/dashboard', verification_required: true });
    assert.equal(welcome.recipient({ email: 'a@b.test' }), 'a@b.test');
    assert.match(welcome.render.subject(attribs), /Black Ink/);
    assert.match(welcome.render.intro(attribs), /verificado/);
    assert.deepEqual(welcome.render.cta(attribs), { label: 'Ir al panel del estudio', url: 'https://x/studio/dashboard' });
    const decided = events.studio_claim_decided;
    const rejected = decided.attribs({ email: 'a@b.test', studio_name: 'Black Ink', status: 'rejected', decision_note: 'Sin pruebas' });
    assert.match(decided.render.subject(rejected), /no fue aprobado/);
    assert.ok(decided.render.rows(rejected).some(([k, v]) => k === 'Nota de soporte' && v === 'Sin pruebas'));
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'services', 'email-event-mapping.js')) && /studio_registration_completed/.test(read('services/email-event-mapping.js')), false,
        'el mapeo central no se edita: lo carga el frente emails desde services/email-events/');
});

test('payloads puros: decisión sin destinatario y bienvenida con muchas sedes', () => {
    assert.equal(routes.claimDecisionPayload({ status: 'pending', user: { email: 'a@b.test' } }, 'https://x'), null);
    assert.equal(routes.claimDecisionPayload({ status: 'approved', user: null }, 'https://x'), null);
    const rejected = routes.claimDecisionPayload({ status: 'rejected', studios: { name: 'Black Ink' }, user: { email: 'a@b.test' } }, 'https://x');
    assert.equal(rejected.cta_url, 'https://x/studio/register');
    const many = routes.welcomePayload({ id: STUDIO_ID, name: 'E', locations: Array.from({ length: 7 }, (_, i) => ({ label: 'S' + i, is_active: true })) }, 'a@b.test', 'https://x');
    assert.match(many.locations_text, /y 2 más$/);
    assert.equal(many.profile_url, `https://x/studio/profile/?studio=${STUDIO_ID}`);
});

test('el repo del servidor lee códigos y mensajes de PostgREST', () => {
    const err = new Error('PostgREST RPC decide_studio_claim failed (400): {"code":"23514","message":"Este reclamo ya fue resuelto."}');
    assert.equal(repoModule.pgErrorCode(err), '23514');
    assert.equal(repoModule.pgErrorMessage(err), 'Este reclamo ya fue resuelto.');
    assert.equal(repoModule.isMissingSchemaError({ message: '{"code":"PGRST202"}' }), true);
    assert.equal(repoModule.isUuid(CLAIM_ID), true);
});

test('server.js registra el módulo con una sola línea antes del catch-all', () => {
    const server = read('server.js');
    const line = "require('./lib/routes/estudio-registro').register(app, { applicationBase });";
    assert.equal(server.split(line).length - 1, 1);
    assert.ok(server.indexOf(line) < server.indexOf("app.get('*'"), 'antes de las rutas limpias');
    assert.ok(server.indexOf(line) > server.indexOf("const { resolveEmailContext, applicationBase } = require('./services/email-request-context');"));
});

test('migraciones del frente: rango, idempotencia, rollback y contrato', () => {
    const dir = path.join(__dirname, '..', 'supabase', 'migrations');
    const mine = fs.readdirSync(dir).filter(f => /^2026111521\d{4}_/.test(f));
    assert.deepEqual(mine.sort(), ['20261115210000_estudio_registro_terminos.sql', '20261115210100_estudio_registro_sedes.sql']);
    for (const file of mine) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'supabase', 'rollbacks', file.replace('.sql', '.down.sql'))), file + ' sin rollback');
    }
    const terms = read('supabase/migrations/20261115210000_estudio_registro_terminos.sql');
    assert.match(terms, /add column if not exists terms_accepted_at timestamptz/);
    assert.match(terms, /p_profile->>'terms_accepted', ''\) <> 'true'/);
    assert.match(terms, /hint = 'terms_required'/);
    assert.match(terms, /drop trigger if exists trg_guard_studio_terms_columns/);
    assert.match(terms, /private\.complete_studio_registration\(p_profile, p_locations\)/);
    assert.match(terms, /private\.claim_studio_with_link\(v_token, p_profile - 'claim_token', p_locations\)/);
    assert.match(terms, /p_terms_version text/);
    assert.doesNotMatch(terms, /guard_studio_protected_columns\(\)\s*returns/i, 'no reemplaza el guard del frente de verificación');
    const sedes = read('supabase/migrations/20261115210100_estudio_registro_sedes.sql');
    assert.match(sedes, /v_geocoded := CASE WHEN v_lat IS NOT NULL AND v_lng IS NOT NULL THEN now\(\) END;/);
    assert.doesNotMatch(sedes, /'geocoded_at', now\(\)/);
    assert.match(sedes, /'artist_created', s\.user_id is null and s\.created_by_artist_user_id is not null/);
    assert.doesNotMatch(sedes, /created_by_artist_user_id'/, 'nunca expone el id del tatuador');
});
