'use strict';
// Frente verif-estudio · verificación de estudios para la beta cerrada.
// Cubre: migraciones (contrato + reversa + las 3 de 20261102 copiadas de la
// base viva), el servicio y las rutas (autorización, decisión, revocación,
// email), el evento de email, el panel #verificacion del estudio, la cola del
// backoffice, el sello en el perfil público / marketplace / mapa y el perfil
// público rehecho con el DS (sin FontAwesome ni styles.css).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-test-key';

const MIGRATION = 'supabase/migrations/20261115220000_studio_verification_documents.sql';
const ROLLBACK = 'supabase/rollbacks/20261115220000_studio_verification_documents.down.sql';
const STUDIO_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function mockRes() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(key, value) { this.headers[key] = value; return this; }
    };
}

// ---------------------------------------------------------------- migraciones

test('migración de documentos: rango, idempotencia, bucket privado y RPC solo service_role', () => {
    assert.ok(exists(MIGRATION), 'falta la migración');
    assert.ok(exists(ROLLBACK), 'falta la reversa');
    const ts = Number(path.basename(MIGRATION).slice(0, 14));
    assert.ok(ts >= 20261115220000 && ts <= 20261115220999, 'timestamp fuera del rango del frente');
    const sql = read(MIGRATION);
    assert.match(sql, /add column if not exists legal_name/);
    assert.match(sql, /add column if not exists documents jsonb not null default '\[\]'::jsonb/);
    assert.match(sql, /'studio-verification', 'studio-verification', false, 10485760/);
    assert.match(sql, /on conflict \(id\) do update/);
    for (const policy of ['studio_verification_owner_insert', 'studio_verification_owner_select', 'studio_verification_support_select']) {
        assert.match(sql, new RegExp(`drop policy if exists ${policy} on storage\\.objects`));
    }
    // Sin UPDATE/DELETE de documentos enviados.
    assert.doesNotMatch(sql, /for (update|delete) to authenticated/);
    assert.match(sql, /create or replace function public\.submit_studio_verification\(p_studio_id uuid, p_payload jsonb\)/);
    assert.match(sql, /grant execute on function public\.submit_studio_verification\(uuid, jsonb\) to authenticated/);
    for (const fn of ['decide_studio_verification_as(uuid, text, text, uuid)', 'revoke_studio_verification_as(uuid, text, uuid)']) {
        const escaped = fn.replace(/[()]/g, '\\$&');
        assert.match(sql, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated`));
        assert.match(sql, new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
    }
    assert.match(sql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
    // decide_studio_verification conserva la firma y el chequeo de soporte.
    assert.match(sql, /create or replace function public\.decide_studio_verification\(p_request_id uuid, p_decision text, p_note text default null\)/);
    assert.match(sql, /if not public\.is_support_user\(\) then/);
    // Validaciones del Figma: sede del estudio, documentos de representación y espacio, rutas propias.
    assert.match(sql, /l\.studio_id = p_studio_id/);
    assert.match(sql, /'representation', 'space'/);
    assert.match(sql, /v_path not like p_studio_id::text \|\| '\/%'/);
    assert.match(sql, /storage\.objects o where o\.bucket_id = 'studio-verification'/);
    assert.match(sql, /set search_path to ''/);
});

test('reversa: restaura decide_studio_verification y borra lo nuevo', () => {
    const sql = read(ROLLBACK);
    assert.match(sql, /create or replace function public\.decide_studio_verification/);
    assert.match(sql, /decided_by = auth\.uid\(\)/);
    for (const fn of ['revoke_studio_verification_as', 'decide_studio_verification_as', 'submit_studio_verification', 'apply_studio_verification_decision']) {
        assert.match(sql, new RegExp(`drop function if exists (public|private)\\.${fn}`));
    }
    assert.match(sql, /drop column if exists documents/);
    assert.match(sql, /drop policy if exists studio_verification_owner_insert on storage\.objects/);
});

test('las migraciones de estudios aplicadas en vivo (20261102*) están en el repo con su reversa', () => {
    for (const name of ['20261102120000_studio_verification', '20261102130000_studio_matches_unowned_fix', '20261102140000_studio_address_match']) {
        assert.ok(exists(`supabase/migrations/${name}.sql`), name);
        assert.ok(exists(`supabase/rollbacks/${name}.down.sql`), name + ' (reversa)');
    }
    const base = read('supabase/migrations/20261102120000_studio_verification.sql');
    assert.match(base, /create table if not exists public\.studio_verification_requests/i);
    assert.match(base, /decide_studio_verification/);
});

// ---------------------------------------------------------------- servicio

test('servicio: validación de la decisión, la revocación y el filtro de estado', () => {
    const sv = require('../services/studio-verification');
    assert.equal(sv.parseDecisionInput({ id: 'x' }, {}).status, 400);
    assert.equal(sv.parseDecisionInput({ id: REQUEST_ID }, { decision: 'maybe' }).ok, false);
    assert.equal(sv.parseDecisionInput({ id: REQUEST_ID }, { decision: 'reject', note: 'no' }).ok, false);
    const ok = sv.parseDecisionInput({ id: REQUEST_ID }, { decision: 'approve', confirm_instagram: true, note: '  ' });
    assert.deepEqual(ok, { ok: true, id: REQUEST_ID, decision: 'approve', note: null, confirmInstagram: true });
    assert.equal(sv.parseDecisionInput({ id: REQUEST_ID }, { decision: 'approve', confirm_instagram: 'yes' }).ok, false);
    assert.equal(sv.parseRevokeInput({ studioId: STUDIO_ID }, { note: 'ab' }).ok, false);
    assert.deepEqual(sv.parseRevokeInput({ studioId: STUDIO_ID }, { note: ' Fraude ' }), { ok: true, studioId: STUDIO_ID, note: 'Fraude' });
    assert.equal(sv.parseAdminStatus(''), 'pending');
    assert.equal(sv.parseAdminStatus('ALL'), 'all');
    assert.equal(sv.parseAdminStatus('nope'), null);
});

test('servicio: requestState solo deja documentos del propio estudio', () => {
    const { requestState } = require('../services/studio-verification')._internal;
    const state = requestState({
        id: REQUEST_ID, status: 'pending', legal_name: 'Horizonte SRL', contact_name: 'Ana', responsible_role: 'Dueña',
        responsible_contact: 'ana@example.com', evidence: 'nota',
        documents: [
            { kind: 'representation', path: `${STUDIO_ID}/rep.pdf`, name: 'rep.pdf' },
            { kind: 'space', path: 'otro-estudio/x.jpg', name: 'x.jpg' },
            { kind: 'space', path: `${STUDIO_ID}/../x.jpg` }
        ]
    }, STUDIO_ID);
    assert.equal(state.responsible_name, 'Ana');
    assert.equal(state.note, 'nota');
    assert.equal(state.documents.length, 1);
    assert.equal(state.documents[0].path, `${STUDIO_ID}/rep.pdf`);
});

test('servicio: GET /api/studio/verification exige sesión y estudio, y devuelve sedes', async () => {
    const sv = require('../services/studio-verification');
    const repo = {
        getOwnedStudioForVerification: async () => ({ id: STUDIO_ID, name: 'Horizonte', slug: 'horizonte', verification_status: 'unverified' }),
        getLatestVerificationRequest: async () => null,
        expireStaleStudioInstagramCodes: async () => null,
        listStudioInstagramCodes: async () => [],
        listStudioLocations: async () => [{ id: 'loc-1', label: 'Centro', city: 'Madrid', is_primary: true }]
    };
    let restore = sv._internal.setDeps({ repo, resolveBearerUser: async () => null });
    let res = mockRes();
    await sv.getStudioVerification({ headers: {} }, res);
    assert.equal(res.statusCode, 401);
    restore();

    restore = sv._internal.setDeps({ repo: { ...repo, getOwnedStudioForVerification: async () => null }, resolveBearerUser: async () => ({ id: USER_ID }) });
    res = mockRes();
    await sv.getStudioVerification({ headers: {} }, res);
    assert.equal(res.statusCode, 404);
    restore();

    restore = sv._internal.setDeps({ repo, resolveBearerUser: async () => ({ id: USER_ID, email: 'a@b.c' }) });
    res = mockRes();
    await sv.getStudioVerification({ headers: {} }, res);
    restore();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.studio.slug, 'horizonte');
    assert.equal(res.body.locations[0].label, 'Centro');
    assert.equal(res.body.request, null);
    assert.equal(res.body.instagram.status, 'none');
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

// ---------------------------------------------------------------- rutas

function routeDeps(overrides = {}) {
    const calls = { decide: [], revoke: [], emails: [] };
    const repo = {
        getActiveSupportUser: async (id) => (id === 'agent' ? { user_id: 'agent', email: 'agente@weotzi.com' } : null),
        decideVerification: async (...args) => { calls.decide.push(args); return { id: REQUEST_ID, studio_id: STUDIO_ID, status: args[1] === 'approve' ? 'approved' : 'rejected' }; },
        revokeVerification: async (...args) => { calls.revoke.push(args); return { id: REQUEST_ID, studio_id: STUDIO_ID, status: 'revoked' }; },
        getVerificationRequestWithStudio: async () => ({ id: REQUEST_ID, studio_id: STUDIO_ID, location_id: null, studios: { name: 'Horizonte', slug: 'horizonte' } }),
        getStudioOwnerContact: async () => ({ email: 'duena@example.com', name: 'Ana', studio_name: 'Horizonte', studio_slug: 'horizonte' }),
        listStudioLocations: async () => [],
        listVerificationRequests: async () => [{ id: REQUEST_ID, documents: [{ kind: 'representation', path: `${STUDIO_ID}/a.pdf`, name: 'a.pdf' }] }],
        ...overrides.repo
    };
    return {
        calls,
        deps: {
            repo,
            resolveBearerUser: overrides.resolveBearerUser || (async () => ({ id: 'agent', email: 'agente@weotzi.com' })),
            isSuperadminEmail: (email) => email === 'admin@weotzi.com',
            sendEmail: async (...args) => { calls.emails.push(args); return { ok: true, delivery_status: 'sent' }; },
            applicationBase: () => 'https://beta.weotzi.com'
        }
    };
}

test('rutas: revisores = superadmin o agente activo; el resto 401/403', async () => {
    const routes = require('../lib/routes/verif-estudio');
    const { deps } = routeDeps();
    const restore = routes._internal.setDeps(deps);
    const as = (user) => routes._internal.setDeps({ resolveBearerUser: async () => user });
    try {
        as(null);
        assert.equal((await routes.authorizeReviewer({})).status, 401);
        as({ id: 'otro', email: 'x@y.z' });
        assert.equal((await routes.authorizeReviewer({})).status, 403);
        as({ id: 'admin', email: 'admin@weotzi.com' });
        assert.equal((await routes.authorizeReviewer({})).role, 'superadmin');
        as({ id: 'agent', email: 'agente@weotzi.com' });
        assert.equal((await routes.authorizeReviewer({})).role, 'support');
    } finally { restore(); }
});

test('rutas: la cola no expone rutas de Storage', async () => {
    const routes = require('../lib/routes/verif-estudio');
    const { deps } = routeDeps();
    const restore = routes._internal.setDeps(deps);
    try {
        const res = mockRes();
        await routes._internal.listHandler({ query: {} }, res);
        assert.equal(res.body.success, true);
        assert.equal(res.body.requests[0].documents[0].name, 'a.pdf');
        assert.equal(res.body.requests[0].documents[0].path, undefined);
    } finally { restore(); }
});

test('rutas: decidir aplica la RPC con el actor y avisa al dueño por email (idempotente)', async () => {
    const routes = require('../lib/routes/verif-estudio');
    const { deps, calls } = routeDeps();
    const restore = routes._internal.setDeps(deps);
    try {
        let res = mockRes();
        await routes._internal.decideHandler({ params: { id: REQUEST_ID }, body: { decision: 'reject', note: 'x' } }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(calls.decide.length, 0);

        res = mockRes();
        await routes._internal.decideHandler({ params: { id: REQUEST_ID }, body: { decision: 'reject', note: 'Falta el documento completo' } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls.decide[0], [REQUEST_ID, 'reject', 'Falta el documento completo', 'agent']);
        const [eventId, payload, options] = calls.emails[0];
        assert.equal(eventId, 'studio_verification_decision');
        assert.equal(payload.recipient_email, 'duena@example.com');
        assert.equal(payload.decision, 'rejected');
        assert.equal(payload.dashboard_url, 'https://beta.weotzi.com/studio/dashboard#verificacion');
        assert.equal(options.idempotencyKey, `studio_verification_decision:${REQUEST_ID}:rejected`);
        assert.equal(res.body.email_sent, true);
    } finally { restore(); }
});

test('rutas: errores de la RPC se traducen (22023 → 409 con el mensaje de Postgres)', async () => {
    const routes = require('../lib/routes/verif-estudio');
    const { deps } = routeDeps({
        repo: {
            decideVerification: async () => {
                throw new Error('PostgREST POST rpc/decide_studio_verification_as failed (400): {"code":"23514","details":null,"hint":null,"message":"La solicitud ya fue resuelta."}');
            }
        }
    });
    const restore = routes._internal.setDeps(deps);
    try {
        const res = mockRes();
        await routes._internal.decideHandler({ params: { id: REQUEST_ID }, body: { decision: 'approve' } }, res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.error, 'La solicitud ya fue resuelta.');
    } finally { restore(); }
});

test('rutas: retirar el sello exige motivo y avisa al estudio', async () => {
    const routes = require('../lib/routes/verif-estudio');
    const { deps, calls } = routeDeps();
    const restore = routes._internal.setDeps(deps);
    try {
        let res = mockRes();
        await routes._internal.revokeHandler({ params: { studioId: STUDIO_ID }, body: { note: '' } }, res);
        assert.equal(res.statusCode, 400);
        res = mockRes();
        await routes._internal.revokeHandler({ params: { studioId: STUDIO_ID }, body: { note: 'Datos falsos' } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(calls.revoke[0], [STUDIO_ID, 'Datos falsos', 'agent']);
        assert.equal(calls.emails[0][1].decision, 'revoked');
    } finally { restore(); }
});

test('rutas: se registran con una línea en server.js, bajo /api/admin y /api/support', () => {
    const routes = require('../lib/routes/verif-estudio');
    const seen = [];
    routes.register({ get: (p) => seen.push('GET ' + p), post: (p) => seen.push('POST ' + p) });
    for (const route of [
        'GET /api/studio/verification', 'GET /api/studio/verification/documents', 'POST /api/studio/verification/instagram',
        'GET /api/admin/studio-verifications', 'POST /api/admin/studio-verifications/:id/decide',
        'POST /api/admin/studio-verifications/studios/:studioId/revoke', 'GET /api/support/studio-verifications/:id/documents'
    ]) assert.ok(seen.includes(route), route);
    const server = read('server.js');
    assert.match(server, /require\('\.\/lib\/routes\/verif-estudio'\)\.register\(app\);/);
});

test('el PATCH del backoffice ya no edita is_verified (VER-S5)', () => {
    const server = read('server.js');
    const block = server.slice(server.indexOf('const STUDIO_EDITABLE_COLUMNS'), server.indexOf(']);', server.indexOf('const STUDIO_EDITABLE_COLUMNS')));
    assert.doesNotMatch(block, /'is_verified'/);
    const admin = read('public/shared/js/admin.js');
    assert.doesNotMatch(admin, /is_verified: getVal\(/);
    const bo = read('public/backoffice/index.html');
    assert.match(bo, /id="sd-is-verified" disabled/);
});

test('Instagram: el webhook de DMs prueba con códigos de estudios', () => {
    const ig = require('../services/instagram-verification');
    assert.equal(typeof ig.setStudioInboundHandler, 'function');
    const src = read('services/instagram-verification.js');
    assert.match(src, /deps\.studioInbound\(\{ sender, codes, followsBusiness: body\.follows_business \}\)/);
});

// ---------------------------------------------------------------- email

test('evento studio_verification_decision: serverOnly, destinatario y render', () => {
    const events = require('../services/email-events/verif-estudio');
    const ev = events.studio_verification_decision;
    assert.equal(ev.serverOnly, true);
    assert.equal(ev.templateHint, 'studio-notification');
    const routes = require('../lib/routes/verif-estudio');
    const payload = routes.buildDecisionEmail({
        request: { studios: { name: 'Horizonte <b>', slug: 'horizonte' }, location: { label: 'Centro', city: 'Madrid' } },
        owner: { email: 'duena@example.com', name: 'Ana' },
        base: 'https://beta.weotzi.com',
        decision: 'approved'
    });
    assert.equal(ev.recipient(payload), 'duena@example.com');
    const attribs = ev.attribs(payload);
    assert.doesNotMatch(attribs.studio_name, /</);
    assert.equal(ev.render.audience, 'studio');
    assert.equal(ev.render.category, 'studios');
    assert.equal(ev.render.headline(attribs), 'Tu estudio está verificado');
    assert.deepEqual(ev.render.rows(attribs)[1], ['Sede revisada', 'Centro · Madrid']);
    assert.equal(ev.render.cta(attribs).url, 'https://beta.weotzi.com/studio/dashboard#verificacion');
    assert.match(ev.render.subject(attribs), /verificado/);
});

// ---------------------------------------------------------------- panel del estudio

test('panel #verificacion: pestaña, panel, scripts y navegación móvil', () => {
    const html = read('public/studio/dashboard/index.html');
    assert.match(html, /href="#verificacion" data-tab="verificacion"/);
    assert.match(html, /data-panel="verificacion"/);
    assert.match(html, /data-sv-root/);
    assert.match(html, /\/shared\/css\/studio-verification\.css/);
    assert.ok(html.indexOf('<script src="/shared/js/data/studio-verification-repo.js">') < html.indexOf('<script src="/shared/js/studio-dashboard-verification.js">'));
    assert.ok(html.indexOf('<script src="/shared/js/studio-auth.js">') < html.indexOf('<script src="/shared/js/studio-dashboard-verification.js">'));
    assert.match(read('public/shared/js/ds/organisms.js'), /\{ id: 'verificacion', label: 'VERIFICACIÓN' \}/);
    // Solo el dueño: no es una pestaña de manager.
    assert.match(read('public/shared/js/studio-dashboard.js'), /const MANAGER_TABS = \['mensajes', 'roster'\];/);
    // El registro ya no bloquea "Verificar".
    const register = read('public/shared/js/studio-register.js');
    assert.match(register, /studio\/dashboard#verificacion/);
    assert.doesNotMatch(register, /todavía no está disponible desde este panel/);
});

test('panel #verificacion: vistas del Figma, validación y escape', () => {
    const ui = require('../public/shared/js/studio-dashboard-verification.js');
    const base = {
        studio: { id: STUDIO_ID, name: '<img src=x onerror=alert(1)>', slug: 'h', verification_status: 'unverified' },
        locations: [{ id: 'loc-1', label: 'Centro', city: 'Madrid', is_primary: true }],
        instagram: { status: 'none', handle: 'horizonte' },
        request: null
    };
    assert.equal(ui.viewFor(base), 'form');
    assert.equal(ui.viewFor({ ...base, request: { status: 'pending', legal_name: 'X', documents: [{ kind: 'space' }] } }), 'pending');
    assert.equal(ui.viewFor({ ...base, request: { status: 'pending', documents: [] } }), 'form');
    assert.equal(ui.viewFor({ ...base, request: { status: 'rejected' } }), 'correction');
    assert.equal(ui.viewFor({ ...base, studio: { ...base.studio, is_verified: true } }), 'approved');

    const html = ui.panelHtml(base, { draft: { files: { representation: [], space: [] } } });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /Verificá tu estudio/);
    assert.match(html, /Documento que acredita representación/);
    assert.match(html, /Evidencia del espacio/);
    assert.match(html, /Sede a verificar/);
    assert.match(html, /<option value="loc-1" selected>Centro · Madrid \(principal\)<\/option>/);
    assert.match(html, /<label class="sv-label-mono" for="sv-legal">/);

    const correction = ui.panelHtml({ ...base, request: { status: 'rejected', decision_note: '<script>x</script>', documents: [] } }, { draft: { files: { representation: [], space: [] } } });
    assert.match(correction, /Necesitamos una corrección/);
    assert.match(correction, /&lt;script&gt;x&lt;\/script&gt;/);

    const approved = ui.panelHtml({ ...base, studio: { ...base.studio, is_verified: true, verified_at: '2026-11-10T00:00:00Z' }, request: { status: 'approved', responsible_name: 'Ana', location_id: 'loc-1' } }, {});
    assert.match(approved, /Tu estudio está verificado/);
    assert.match(approved, /Ver perfil público/);

    assert.equal(ui.validateForm({}).field, 'sv-legal');
    assert.equal(ui.validateForm({ legal_name: 'Hz', responsible_name: 'Ana', responsible_role: 'Dueña', responsible_contact: 'a@b.co', location_id: 'l', hasRepresentation: true, hasSpace: false }).field, 'sv-space-file');
    assert.equal(ui.validateForm({ legal_name: 'Hz', responsible_name: 'Ana', responsible_role: 'Dueña', responsible_contact: 'a@b.co', location_id: 'l', hasRepresentation: true, hasSpace: true }), null);
    // URLs de documentos solo http(s).
    assert.doesNotMatch(ui.documentsListHtml([{ kind: 'space', name: 'a', url: 'javascript:alert(1)' }]), /href=/);
});

// ---------------------------------------------------------------- backoffice

test('backoffice: sección, script y cola con escape y URLs seguras', () => {
    const html = read('public/backoffice/index.html');
    assert.match(html, /data-section="studio-verifications"/);
    assert.match(html, /id="section-studio-verifications"/);
    assert.match(html, /id="bo-studio-verifications-root"/);
    assert.match(html, /backoffice-studio-verifications\.js/);
    assert.match(read('public/shared/js/admin.js'), /'studio-verifications': 'Verificaciones de estudios'/);

    const bo = require('../public/shared/js/backoffice-studio-verifications.js');
    const card = bo.cardHtml({
        id: REQUEST_ID, studio_id: STUDIO_ID, status: 'pending', reasons: ['name_match'],
        studio: { name: '<b>Horizonte</b>', slug: 'horizonte', instagram: '@hz' },
        legal_name: 'Horizonte SRL', contact_name: 'Ana', responsible_role: 'Dueña',
        links: ['javascript:alert(1)', 'https://hz.example.com'],
        documents: [{ kind: 'representation', name: 'rep.pdf' }],
        owner_email: 'duena@example.com'
    });
    assert.doesNotMatch(card, /<b>Horizonte/);
    assert.doesNotMatch(card, /href="javascript:/);
    assert.match(card, /href="https:\/\/hz\.example\.com"/);
    assert.match(card, /Aprobar verificación/);
    assert.match(card, /Pedir corrección/);
    assert.match(card, /Confirmar también el Instagram/);
    assert.match(card, /Nombre parecido a otro estudio/);
    assert.equal(bo.validateDecision('reject', 'ok'), 'Contale al estudio qué tiene que corregir (al menos 3 caracteres).');
    assert.equal(bo.validateDecision('approve', ''), null);
    assert.equal(bo.normalizeStatus('zzz'), 'pending');
    const approvedCard = bo.cardHtml({ id: REQUEST_ID, studio_id: STUDIO_ID, status: 'approved', studio: { name: 'Hz', is_verified: true }, documents: [] });
    assert.match(approvedCard, /Retirar el sello/);
    assert.doesNotMatch(approvedCard, /Aprobar verificación/);
});

// ---------------------------------------------------------------- perfil público

test('perfil público: DS del rediseño, sin FontAwesome ni hojas viejas, sello y reseñas', () => {
    const html = read('public/studio/profile/index.html');
    assert.doesNotMatch(html, /font-awesome/i);
    assert.doesNotMatch(html, /shared\/css\/styles\.css|shared\/css\/studio\.css/);
    assert.match(html, /shared\/css\/ds\/tokens\.css/);
    assert.match(html, /shared\/css\/studio-profile-ds\.css/);
    assert.match(html, /id="sp-seal"[^>]*title="Estudio verificado por We Ötzi"/);
    assert.match(html, /id="studio-reviews"/);
    assert.match(html, /name="viewport"/);
    const css = read('public/shared/css/studio-profile-ds.css');
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /\.sp-gallery \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('perfil público: lógica pura (equipo, preparación, enlaces y escape)', () => {
    const sp = require('../public/shared/js/studio-profile.js');
    assert.doesNotMatch(sp.STUDIO_PUBLIC_COLUMNS, /\bemail\b|user_id|contact_phone/);
    const memberships = [
        { role: 'resident', location_id: 'a', artists_db: { name: 'Nico', username: 'nico', styles_array: ['Ornamental'] } },
        { role: 'guest', location_id: 'b', artists_db: { name: 'Lu', username: 'lu', styles_array: ['Blackwork'] } }
    ];
    const locations = [{ id: 'a', label: 'Centro' }, { id: 'b', label: 'Norte' }];
    assert.deepEqual(sp.teamRows(memberships, locations, { location: 'b' }).map((r) => r.title), ['Lu · Blackwork']);
    assert.deepEqual(sp.teamRows(memberships, locations, { style: 'Ornamental' })[0].meta, 'Residente · Centro');
    assert.equal(sp.teamRows(memberships, locations, {})[0].href, '/artist/profile?artist=nico');
    assert.equal(sp.isPreparing({ bio: '' }, []), true);
    assert.equal(sp.isPreparing({ bio: 'Hola' }, []), false);
    assert.equal(sp.initial('Estudio Horizonte'), 'H');
    assert.equal(sp.igUrl('javascript:alert(1)'), '');
    assert.equal(sp.igUrl('@hz.ink'), 'https://www.instagram.com/hz.ink/');
    assert.equal(sp.waUrl('+54 9 11 1234-5678'), 'https://wa.me/5491112345678');
    const gallery = sp.galleryHtml({ name: '"><script>', photo_feed_items: [{ url: 'https://x.example/a.jpg' }, { url: 'javascript:1' }] });
    assert.equal((gallery.match(/<img /g) || []).length, 1);
    assert.doesNotMatch(gallery, /"><script>/);
    const links = sp.linksHtml({ instagram: 'hz', website: 'javascript:1' }, { hasTeam: true });
    assert.match(links, /href="#equipo"/);
    assert.match(links, /instagram\.com\/hz\//);
    assert.doesNotMatch(links, /javascript:/);
    assert.match(sp.locationsHtml([{ label: 'Centro', formatted_address: 'Calle 1', city: 'Madrid', is_primary: true }]), /01 · Centro/);
});

test('panel de soporte: pestaña ESTUDIOS con la misma cola (endpoint /api/support)', () => {
    const html = read('public/support/dashboard/index.html');
    assert.match(html, /<script src="\/shared\/js\/backoffice-studio-verifications\.js"><\/script>/);
    const src = read('public/shared/js/backoffice-studio-verifications.js');
    assert.match(src, /const SUPPORT_ENDPOINT = '\/api\/support\/studio-verifications';/);
    assert.match(src, /root\.switchTab = function \(tabName\)/);
    assert.match(src, /support\.previousSwitch\.apply\(this, arguments\)/);
});

test('sello de verificado donde se listan estudios (marketplace y mapa)', () => {
    // Integración (marketplace): la card de estudio usa el mismo sello que la de
    // artista (verifiedBadge → .mk-card-verified), solo con is_verified === true.
    const mk = read('public/shared/js/marketplace.js').replace(/\r\n/g, '\n');
    const card =mk.slice(mk.indexOf('function studioCardHtml('), mk.indexOf('\n}\n', mk.indexOf('function studioCardHtml(')));
    assert.match(card, /const verified = studio\.is_verified === true;/);
    assert.match(card, /\$\{verified \? verifiedBadge\('Estudio verificado'\) : ''\}/);
    assert.match(mk, /function verifiedBadge\(label\) \{\s*\n\s*return `<span class="mk-card-verified" title="\$\{escapeHtml\(label\)\}">/);
    assert.match(read('public/shared/css/marketplace-ds.css'), /\.mk-card-verified\{/);
    assert.match(read('public/shared/js/explore-map.js'), /s\.is_verified \? '<i data-wo-icon="check" class="pin-verified"/);
    assert.match(read('public/shared/js/data/studios-repo.js'), /studios:studio_id\(id, slug, name, tagline, cover_image, instagram, website, is_verified\)/);
});
