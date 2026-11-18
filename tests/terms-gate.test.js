'use strict';
// Gate de Términos y bloqueo de reingreso (2.7.0, equipo T2).
// Cubre: versión única, lógica pura (lib/terms-gate.js), rutas con setDeps
// (lib/routes/terminos.js), repo (lib/repos/terminos.js) con fetch simulado,
// la migración 20261118120000, el gate del navegador y las llamadas desde
// los módulos de auth, server.js y services/account-modes.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-test-key';

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const { TERMS_VERSION } = require('../lib/terms-acceptance');
const gate = require('../lib/terms-gate');
const routes = require('../lib/routes/terminos');
const { TerminosRepo } = require('../lib/repos/terminos');
const browserGate = require('../public/shared/js/wo-terms-gate.js');
const consent = require('../public/shared/js/wo-consent.js');

const USER_ID = '33333333-3333-4333-8333-333333333333';
// Una semana después del release: las cuentas de 1-2 días están dentro del
// bloqueo de reingreso; las de 8 o más días, antes de REENTRY_ENFORCED_SINCE.
const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const GENERIC = 'No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.';

function mockRes() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(key, value) { this.headers[key] = value; return this; }
    };
}

function user({ createdDaysAgo = 30, phone = '', meta = {} } = {}) {
    return {
        id: USER_ID,
        email: 'persona@example.test',
        raw: { created_at: new Date(NOW - createdDaysAgo * DAY).toISOString(), phone, user_metadata: meta }
    };
}

function fakeRepo(overrides = {}) {
    const calls = { insert: [], stamp: [] };
    const repo = {
        calls,
        listAcceptances: async () => [],
        getProfiles: async () => ({ artist: null, client: { user_id: USER_ID, terms_version: '2026-11-16', terms_accepted_at: '2026-11-16T10:00:00Z' }, studios: [] }),
        insertAcceptance: async (args) => { calls.insert.push(args); return { stored: true, missingTable: false }; },
        stampAllProfiles: async (userId, args) => { calls.stamp.push({ userId, ...args }); return { artist: 0, client: 1, studio: 0 }; },
        ...overrides
    };
    return repo;
}

function fakeService({ blocked = false, sanction = null, throwOn = null } = {}) {
    const calls = { check: [], block: [], sanction: [] };
    return {
        calls,
        async checkReentry(input) {
            calls.check.push(input);
            if (throwOn === 'check') throw new Error('base caída');
            return blocked ? { blocked: true, matches: [{ kind: 'email', sanction_id: 's1' }] } : { blocked: false, matches: [] };
        },
        async blockNewAccount(args) { calls.block.push(args); },
        async getActiveSanction(userId) {
            calls.sanction.push(userId);
            if (throwOn === 'sanction') throw new Error('sin tabla');
            return sanction;
        }
    };
}

const silent = () => {};

// ------------------------------------------------------------ versión única

test('versión legal 2026-11-18 en lib, studio-register, el gate del navegador y la migración', () => {
    assert.equal(TERMS_VERSION, '2026-11-18');
    assert.equal(gate.TERMS_VERSION, TERMS_VERSION);
    assert.equal(browserGate.TERMS_VERSION, TERMS_VERSION, 'wo-terms-gate.js tiene la misma versión');
    assert.match(read('public/shared/js/studio-register.js'), new RegExp(`const TERMS_VERSION = '${TERMS_VERSION}';`));
    const sql = read('supabase/migrations/20261118120000_terminos_reaceptacion.sql');
    assert.match(sql, new RegExp(`current_terms_version constant text := '${TERMS_VERSION}'`));
    assert.match(sql, new RegExp(`v_version constant text := '${TERMS_VERSION}';`));
    assert.match(read('lib/terms-acceptance.js'), /re-aceptación es obligatoria/);
});

// ------------------------------------------------------------ lógica pura

test('acceptanceState: fila de terms_acceptances, respaldo de perfiles y versión anterior', () => {
    const old = { artist: { terms_version: '2026-11-16', terms_accepted_at: '2026-11-16T00:00:00Z' }, client: null, studios: [] };
    assert.deepEqual(gate.acceptanceState({ acceptances: [{ version: TERMS_VERSION, accepted_at: '2026-11-18T00:00:00Z' }], profiles: old }),
        { accepted: true, acceptedVersion: TERMS_VERSION });
    assert.deepEqual(gate.acceptanceState({ acceptances: [], profiles: { studios: [{ terms_version: TERMS_VERSION, terms_accepted_at: '2026-11-18T00:00:00Z' }] } }),
        { accepted: true, acceptedVersion: TERMS_VERSION }, 'un perfil sellado con la vigente cuenta (alta nueva)');
    assert.deepEqual(gate.acceptanceState({ acceptances: null, profiles: old }), { accepted: false, acceptedVersion: '2026-11-16' });
    assert.deepEqual(gate.acceptanceState({ acceptances: [], profiles: {} }), { accepted: false, acceptedVersion: null });
    // Un terms_version sin fecha no cuenta como aceptación.
    assert.equal(gate.acceptanceState({ acceptances: [], profiles: { client: { terms_version: TERMS_VERSION } } }).accepted, false);
});

test('rolesFrom y sanctionView', () => {
    assert.deepEqual(gate.rolesFrom({ artist: {}, client: null, studios: [{}] }), { artist: true, client: false, studio: true });
    assert.deepEqual(gate.rolesFrom(null), { artist: false, client: false, studio: false });
    assert.deepEqual(gate.sanctionView({ id: 'x', kind: 'suspension', status: 'active', ends_at: '2026-12-01T00:00:00Z' }), { kind: 'suspension', ends_at: '2026-12-01T00:00:00Z' });
    assert.deepEqual(gate.sanctionView({ kind: 'ban' }), { kind: 'ban', ends_at: null });
    assert.equal(gate.sanctionView({ kind: 'warning' }), null, 'una advertencia no bloquea ni avisa en el gate');
    assert.equal(gate.sanctionView(null), null);
});

test('needsReentryCheck: toda cuenta creada desde el release (fecha fija) sin aceptación registrada', () => {
    assert.equal(gate.REENTRY_ENFORCED_SINCE, '2026-11-18T00:00:00Z');
    assert.equal(gate.needsReentryCheck({ user: user({ createdDaysAgo: 1 }), acceptances: [] }), true);
    assert.equal(gate.needsReentryCheck({ user: user({ createdDaysAgo: 1 }), acceptances: null }), true, 'sin la tabla también se revisa');
    assert.equal(gate.needsReentryCheck({ user: user({ createdDaysAgo: 1 }), acceptances: [{ version: '2026-11-18' }] }), false);
    assert.equal(gate.needsReentryCheck({ user: user({ createdDaysAgo: 8 }), acceptances: [] }), false, 'anterior al release');
    assert.equal(gate.needsReentryCheck({ user: { id: USER_ID, raw: {} }, acceptances: [] }), false);
    // Sin ventana móvil: una cuenta del release que tarda meses en entrar se revisa igual.
    const late = { id: USER_ID, raw: { created_at: '2026-11-18T00:00:00Z' } };
    assert.equal(gate.isEnforcedAccount(late), true);
    assert.equal(gate.needsReentryCheck({ user: late, acceptances: [] }), true);
    assert.equal(gate.isEnforcedAccount({ id: USER_ID, raw: { created_at: '2026-11-17T23:59:59Z' } }), false);
    assert.equal(gate.isRecentAccount, undefined, 'sin la ventana de 7 días');
});

test('countryIso2 y reentryInputs: correo, teléfonos, Instagram y país de los perfiles', () => {
    assert.equal(gate.countryIso2('Argentina'), 'AR');
    assert.equal(gate.countryIso2('España'), 'ES');
    assert.equal(gate.countryIso2('espana'), 'ES');
    assert.equal(gate.countryIso2('United States'), 'US');
    assert.equal(gate.countryIso2('mx'), 'MX');
    assert.equal(gate.countryIso2('Narnia'), null);
    const inputs = gate.reentryInputs({
        user: user({ phone: '5491122223333' }),
        profiles: {
            artist: { instagram: '@tinta.real', whatsapp_number: '+5491122223333', country: 'Argentina' },
            client: { whatsapp: '+34 600 111 222', instagram: 'otra.cuenta' },
            studios: []
        },
        flow: 'login'
    });
    assert.deepEqual(inputs[0], { email: 'persona@example.test', phone: '5491122223333', instagram: '@tinta.real', country: 'AR', flow: 'login', userId: USER_ID });
    assert.ok(inputs.some((i) => i.phone === '+34 600 111 222' && !i.email), 'teléfono extra en otra entrada');
    assert.ok(inputs.some((i) => i.instagram === 'otra.cuenta'), 'Instagram extra en otra entrada');
});

test('validateAccept: 400 sin aceptar, 409 TERMS_OUTDATED con otra versión', () => {
    assert.deepEqual(gate.validateAccept({ accepted: true, version: TERMS_VERSION }), { ok: true, version: TERMS_VERSION });
    const missing = gate.validateAccept({ accepted: 'true', version: TERMS_VERSION });
    assert.equal(missing.status, 400);
    const outdated = gate.validateAccept({ accepted: true, version: '2026-11-16' });
    assert.equal(outdated.status, 409);
    assert.equal(outdated.code, 'TERMS_OUTDATED');
});

test('precheckInput: recorta, valida el correo y fija el flujo', () => {
    assert.deepEqual(gate.precheckInput({}), { ok: false });
    assert.deepEqual(gate.precheckInput({ email: 'no-es-correo' }), { ok: false });
    const ok = gate.precheckInput({ email: ' Persona@Example.TEST ', instagram: '@x', country: 'España', flow: 'studio' });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.input, { email: 'persona@example.test', phone: null, instagram: '@x', country: 'ES', flow: 'precheck', userId: null });
    assert.equal(gate.precheckInput({ phone: '+1 555', flow: 'cualquiera' }).input.flow, 'precheck');
});

test('checkReentrySafe: falla abierta sin módulo o con error; corta en la primera coincidencia', async () => {
    const logs = [];
    const log = (...a) => logs.push(a.join(' '));
    assert.deepEqual(await gate.checkReentrySafe({ email: 'a@b.c' }, { service: null, log }), { blocked: false, matches: [], checked: false });
    const broken = fakeService({ throwOn: 'check' });
    assert.deepEqual(await gate.checkReentrySafe({ email: 'a@b.c' }, { service: broken, log }), { blocked: false, matches: [], checked: false });
    assert.ok(logs.length >= 2, 'deja aviso en el log');
    assert.ok(!logs.join(' ').includes('a@b.c'), 'el log no tiene datos personales');
    const svc = fakeService({ blocked: true });
    const res = await gate.checkReentrySafe([{ email: 'a@b.c' }, { phone: '+1' }], { service: svc, log });
    assert.equal(res.blocked, true);
    assert.equal(svc.calls.check.length, 1);
    const clean = fakeService();
    assert.equal((await gate.checkReentrySafe([{ email: 'a@b.c' }, { phone: '+1' }], { service: clean, log })).checked, true);
    assert.equal(clean.calls.check.length, 2);
});

test('loadSanctionsService no rompe si lib/sanciones-service falta o no carga', () => {
    const missing = () => { const e = new Error('Cannot find module'); e.code = 'MODULE_NOT_FOUND'; throw e; };
    assert.equal(gate.loadSanctionsService(missing), null);
    assert.deepEqual(gate.loadSanctionsService(() => ({ checkReentry() {} })) !== null, true);
});

// ------------------------------------------------------------ rutas

function withRoutes(overrides) {
    return routes._internal.setDeps({ log: silent, now: () => NOW, ...overrides });
}

test('GET terms-status: 401 sin sesión', async () => {
    const restore = withRoutes({ resolveUser: async () => null, repo: fakeRepo(), sanctions: fakeService() });
    try {
        const res = mockRes();
        await routes._internal.statusHandler({ headers: {} }, res);
        assert.equal(res.statusCode, 401);
    } finally { restore(); }
});

test('GET terms-status: sin aceptar la vigente → accepted:false con roles y versión anterior', async () => {
    const svc = fakeService();
    const restore = withRoutes({ resolveUser: async () => user(), repo: fakeRepo(), sanctions: svc });
    try {
        const res = mockRes();
        await routes._internal.statusHandler({ headers: {} }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, {
            success: true, current: TERMS_VERSION, accepted: false, acceptedVersion: '2026-11-16',
            roles: { artist: false, client: true, studio: false }, sanction: null, blocked: false
        });
        assert.equal(svc.calls.check.length, 0, 'una cuenta vieja no pasa por el bloqueo de reingreso');
        assert.equal(res.headers['Cache-Control'], 'no-store');
    } finally { restore(); }
});

test('GET terms-status: aceptada por terms_acceptances y sanción de suspensión pasa tal cual', async () => {
    const svc = fakeService({ sanction: { id: 's', kind: 'suspension', status: 'active', ends_at: '2026-12-01T00:00:00Z' } });
    const repo = fakeRepo({ listAcceptances: async () => [{ version: TERMS_VERSION, accepted_at: '2026-11-18T10:00:00Z', surface: 'gate' }] });
    const restore = withRoutes({ resolveUser: async () => user(), repo, sanctions: svc });
    try {
        const res = mockRes();
        await routes._internal.statusHandler({ headers: {} }, res);
        assert.equal(res.body.accepted, true);
        assert.equal(res.body.acceptedVersion, TERMS_VERSION);
        assert.deepEqual(res.body.sanction, { kind: 'suspension', ends_at: '2026-12-01T00:00:00Z' });
        assert.deepEqual(svc.calls.sanction, [USER_ID]);
    } finally { restore(); }
});

test('GET terms-status: si getActiveSanction falla, sanction:null y sigue', async () => {
    const restore = withRoutes({ resolveUser: async () => user(), repo: fakeRepo(), sanctions: fakeService({ throwOn: 'sanction' }) });
    try {
        const res = mockRes();
        await routes._internal.statusHandler({ headers: {} }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.sanction, null);
    } finally { restore(); }
});

test('GET terms-status: cuenta nueva que coincide con una baneada → blockNewAccount y blocked:true', async () => {
    const svc = fakeService({ blocked: true });
    const repo = fakeRepo({ getProfiles: async () => ({ artist: null, client: { whatsapp: '+5491100000000', instagram: 'mismo' }, studios: [] }) });
    const restore = withRoutes({ resolveUser: async () => user({ createdDaysAgo: 0 }), repo, sanctions: svc });
    try {
        const res = mockRes();
        await routes._internal.statusHandler({ headers: {} }, res);
        assert.equal(res.body.blocked, true);
        assert.equal(svc.calls.check[0].flow, 'login');
        assert.equal(svc.calls.check[0].phone, '+5491100000000');
        assert.equal(svc.calls.check[0].userId, USER_ID);
        assert.deepEqual(svc.calls.block, [{ userId: USER_ID, matches: [{ kind: 'email', sanction_id: 's1' }], flow: 'login' }]);
    } finally { restore(); }
});

test('GET terms-status: cuenta nueva sin coincidencia → blocked:false; sin servicio falla abierta', async () => {
    const svc = fakeService();
    let restore = withRoutes({ resolveUser: async () => user({ createdDaysAgo: 2 }), repo: fakeRepo(), sanctions: svc });
    try {
        const res = mockRes();
        await routes._internal.statusHandler({ headers: {} }, res);
        assert.equal(res.body.blocked, false);
        assert.equal(svc.calls.check.length, 1);
        assert.equal(svc.calls.block.length, 0);
    } finally { restore(); }
    restore = withRoutes({ resolveUser: async () => user({ createdDaysAgo: 2 }), repo: fakeRepo(), sanctions: null });
    try {
        const res = mockRes();
        await routes._internal.statusHandler({ headers: {} }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.blocked, false);
        assert.equal(res.body.sanction, null);
    } finally { restore(); }
});

test('POST terms-accept: 400 sin aceptar y 409 TERMS_OUTDATED con otra versión (sin escribir nada)', async () => {
    const repo = fakeRepo();
    const restore = withRoutes({ resolveUser: async () => user(), repo, sanctions: fakeService() });
    try {
        let res = mockRes();
        await routes._internal.acceptHandler({ headers: {}, body: { accepted: false, version: TERMS_VERSION } }, res);
        assert.equal(res.statusCode, 400);
        res = mockRes();
        await routes._internal.acceptHandler({ headers: {}, body: { accepted: true, version: '2026-11-16' } }, res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, 'TERMS_OUTDATED');
        assert.equal(res.body.current, TERMS_VERSION);
        assert.equal(repo.calls.insert.length + repo.calls.stamp.length, 0);
    } finally { restore(); }
});

test('POST terms-accept: registra la aceptación y sella todos los perfiles con la hora del servidor', async () => {
    const repo = fakeRepo();
    const restore = withRoutes({ resolveUser: async () => user(), repo, sanctions: fakeService() });
    try {
        const res = mockRes();
        await routes._internal.acceptHandler({ headers: { 'user-agent': 'Prueba/1.0' }, body: { accepted: true, version: TERMS_VERSION, surface: 'studio', accepted_at: '2000-01-01' } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { success: true, version: TERMS_VERSION, recorded: true, stamped: { artist: 0, client: 1, studio: 0 } });
        assert.deepEqual(repo.calls.insert, [{ userId: USER_ID, version: TERMS_VERSION, surface: 'studio', userAgent: 'Prueba/1.0' }]);
        assert.deepEqual(repo.calls.stamp, [{ userId: USER_ID, version: TERMS_VERSION, acceptedAt: new Date(NOW).toISOString() }]);
    } finally { restore(); }
});

test('POST terms-accept: baneo → 403 y reingreso bloqueado → 403 REGISTRATION_BLOCKED, sin escribir', async () => {
    let repo = fakeRepo();
    let restore = withRoutes({ resolveUser: async () => user(), repo, sanctions: fakeService({ sanction: { kind: 'ban' } }) });
    try {
        const res = mockRes();
        await routes._internal.acceptHandler({ headers: {}, body: { accepted: true, version: TERMS_VERSION } }, res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, 'ACCOUNT_SANCTIONED');
    } finally { restore(); }
    repo = fakeRepo();
    const svc = fakeService({ blocked: true });
    restore = withRoutes({ resolveUser: async () => user({ createdDaysAgo: 1 }), repo, sanctions: svc });
    try {
        const res = mockRes();
        await routes._internal.acceptHandler({ headers: {}, body: { accepted: true, version: TERMS_VERSION } }, res);
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.body, { success: false, code: 'REGISTRATION_BLOCKED', error: GENERIC });
        assert.equal(svc.calls.block.length, 1);
        assert.equal(repo.calls.insert.length + repo.calls.stamp.length, 0);
    } finally { restore(); }
});

test('POST register/precheck: bloqueado → 403 genérico; libre → ok; sin servicio o con error → ok', async () => {
    const svc = fakeService({ blocked: true });
    let restore = withRoutes({ sanctions: svc });
    try {
        const res = mockRes();
        await routes._internal.precheckHandler({ headers: {}, body: { email: 'persona@example.test', flow: 'client' } }, res);
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.body, { ok: false, code: 'REGISTRATION_BLOCKED', error: GENERIC });
        assert.equal(svc.calls.check[0].flow, 'precheck');
        assert.equal(svc.calls.block.length, 0, 'sin cuenta todavía: no hay nada que bloquear en Auth');
    } finally { restore(); }
    for (const sanctions of [fakeService(), null, fakeService({ throwOn: 'check' })]) {
        restore = withRoutes({ sanctions });
        try {
            const res = mockRes();
            await routes._internal.precheckHandler({ headers: {}, body: { email: 'persona@example.test' } }, res);
            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.body, { ok: true });
        } finally { restore(); }
    }
    const untouched = fakeService({ blocked: true });
    restore = withRoutes({ sanctions: untouched });
    try {
        const res = mockRes();
        await routes._internal.precheckHandler({ headers: {}, body: { email: 'roto' } }, res);
        assert.deepEqual(res.body, { ok: true });
        assert.equal(untouched.calls.check.length, 0);
    } finally { restore(); }
});

test('register: monta las tres rutas con limitadores; no se registra en server.js (lo hace la integración)', () => {
    const mounted = [];
    const app = { get: (p, ...h) => mounted.push(['GET', p, h.length]), post: (p, ...h) => mounted.push(['POST', p, h.length]) };
    const noop = (req, res, next) => next();
    const restore = routes._internal.setDeps({ sweepIntervalMs: 0 });
    try {
        routes.register(app, { statusLimiter: noop, acceptLimiter: noop, precheckLimiter: noop });
    } finally { restore(); }
    assert.deepEqual(mounted, [
        ['GET', '/api/account/terms-status', 2],
        ['POST', '/api/account/terms-accept', 2],
        ['POST', '/api/register/precheck', 2]
    ]);
    const src = read('lib/routes/terminos.js');
    assert.match(src, /require\('express-rate-limit'\)/);
});

// ------------------------------------------------------------ barrido (sin navegador)

function pendingRow(id, extra = {}) {
    return { user_id: id, email: `${id.slice(0, 4)}@example.test`, phone: null, created_at: '2026-11-20T10:00:00Z', user_metadata: {}, ...extra };
}

function sweepRepo({ pending, profiles } = {}) {
    const recorded = [];
    const repo = fakeRepo({
        listPendingReentry: async (since, limit) => { repo.calls.list = { since, limit }; return pending; },
        getProfiles: async (id) => (profiles && profiles[id]) || { artist: null, client: null, studios: [] },
        recordReentryCheck: async (userId, opts) => { recorded.push({ userId, ...opts }); return true; }
    });
    repo.recorded = recorded;
    return repo;
}

test('barrido: cuenta de estudio que coincide → blockNewAccount y queda marcada; la limpia se marca revisada', async () => {
    const A = '44444444-4444-4444-8444-444444444444';
    const B = '55555555-5555-4555-8555-555555555555';
    const repo = sweepRepo({
        pending: [pendingRow(A), pendingRow(B)],
        profiles: { [A]: { artist: null, client: null, studios: [{ id: 's1', user_id: A, instagram: 'estudio.x', country_code: 'AR' }] } }
    });
    const svc = fakeService();
    svc.checkReentry = async (input) => { svc.calls.check.push(input); return input.userId === A ? { blocked: true, matches: [{ kind: 'instagram', sanction_id: 's9' }] } : { blocked: false, matches: [] }; };
    const restore = withRoutes({ repo, sanctions: svc, sweepLimit: 25 });
    try {
        const out = await routes._internal.sweepPendingAccounts();
        assert.deepEqual(out, { checked: 2, blocked: 1, skipped: false });
        assert.deepEqual(repo.calls.list, { since: gate.REENTRY_ENFORCED_SINCE, limit: 25 });
        assert.equal(svc.calls.check[0].flow, 'studio');
        assert.equal(svc.calls.check[0].instagram, 'estudio.x');
        assert.equal(svc.calls.check[1].flow, 'login');
        assert.deepEqual(svc.calls.block, [{ userId: A, matches: [{ kind: 'instagram', sanction_id: 's9' }], flow: 'studio' }]);
        assert.deepEqual(repo.recorded.map((r) => [r.userId, r.blocked]), [[A, true], [B, false]]);
        assert.equal(repo.calls.insert.length, 0, 'el barrido nunca registra una aceptación');
    } finally { restore(); }
});

test('barrido: sin sanciones-service o con error no marca nada (se reintenta); si el bloqueo falla, tampoco', async () => {
    const A = '44444444-4444-4444-8444-444444444444';
    let repo = sweepRepo({ pending: [pendingRow(A)] });
    let restore = withRoutes({ repo, sanctions: null });
    try {
        assert.deepEqual(await routes._internal.sweepPendingAccounts(), { checked: 0, blocked: 0, skipped: false });
        assert.equal(repo.recorded.length, 0);
    } finally { restore(); }
    repo = sweepRepo({ pending: [pendingRow(A)] });
    restore = withRoutes({ repo, sanctions: fakeService({ throwOn: 'check' }) });
    try {
        await routes._internal.sweepPendingAccounts();
        assert.equal(repo.recorded.length, 0);
    } finally { restore(); }
    repo = sweepRepo({ pending: [pendingRow(A)] });
    const svc = fakeService({ blocked: true });
    svc.blockNewAccount = async () => { throw new Error('auth caído'); };
    restore = withRoutes({ repo, sanctions: svc });
    try {
        assert.deepEqual(await routes._internal.sweepPendingAccounts(), { checked: 0, blocked: 0, skipped: false });
        assert.equal(repo.recorded.length, 0);
    } finally { restore(); }
    repo = sweepRepo({ pending: [] });
    repo.listPendingReentry = async () => { throw new Error('base caída'); };
    restore = withRoutes({ repo, sanctions: fakeService() });
    try {
        assert.deepEqual(await routes._internal.sweepPendingAccounts(), { checked: 0, blocked: 0, skipped: false }, 'no rompe el servidor');
    } finally { restore(); }
});

test('barrido: register lo arranca con timers unref; sweepIntervalMs 0 lo desactiva', () => {
    const src = read('lib/routes/terminos.js');
    assert.match(src, /startSweep\(\);\n\}/);
    assert.match(src, /first\.unref\(\)/);
    assert.match(src, /sweepTimer\.unref\(\)/);
    const restore = routes._internal.setDeps({ sweepIntervalMs: 0 });
    try {
        assert.equal(routes._internal.startSweep(), null);
    } finally { restore(); }
});

// ------------------------------------------------------------ repo

test('listPendingReentry y recordReentryCheck: RPC con service_role y upsert por user_id', async () => {
    let f = captureFetch(() => okJson([pendingRow('66666666-6666-4666-8666-666666666666')]));
    try {
        const rows = await TerminosRepo.listPendingReentry(gate.REENTRY_ENFORCED_SINCE, 50);
        assert.equal(rows.length, 1);
        assert.equal(f.calls[0].method, 'POST');
        assert.ok(f.calls[0].url.endsWith('/rest/v1/rpc/terms_reentry_pending'));
        assert.deepEqual(f.calls[0].body, { p_since: gate.REENTRY_ENFORCED_SINCE, p_limit: 50 });
        assert.equal(f.calls[0].headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
    } finally { f.restore(); }
    f = captureFetch(() => ({ ok: true, status: 201, text: async () => '', json: async () => null, headers: { get: () => null } }));
    try {
        await TerminosRepo.recordReentryCheck(USER_ID, { blocked: true, checkedAt: '2026-11-25T12:00:00.000Z' });
        assert.ok(f.calls[0].url.endsWith('/rest/v1/terms_reentry_checks?on_conflict=user_id'));
        assert.equal(f.calls[0].headers.Prefer, 'resolution=merge-duplicates,return=minimal');
        assert.deepEqual(f.calls[0].body, { user_id: USER_ID, blocked: true, checked_at: '2026-11-25T12:00:00.000Z' });
    } finally { f.restore(); }
    f = captureFetch(() => ({ ok: false, status: 404, text: async () => '{"code":"PGRST202","message":"Could not find the function public.terms_reentry_pending"}', headers: { get: () => null } }));
    try {
        assert.deepEqual(await TerminosRepo.listPendingReentry(gate.REENTRY_ENFORCED_SINCE, 50), [], 'sin la migración no rompe');
    } finally { f.restore(); }
});

test('clearReentry e isReentryCleared: excepción de soporte con upsert por user_id; sin la migración no rompe', async () => {
    const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const SANCTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    let f = captureFetch(() => ({ ok: true, status: 201, text: async () => '', json: async () => null, headers: { get: () => null } }));
    try {
        const out = await TerminosRepo.clearReentry(USER_ID, { by: AGENT, sanctionId: SANCTION, at: '2026-11-25T12:00:00.000Z' });
        assert.deepEqual(out, { stored: true, missingTable: false });
        assert.ok(f.calls[0].url.endsWith('/rest/v1/terms_reentry_checks?on_conflict=user_id'));
        assert.equal(f.calls[0].method, 'POST');
        assert.equal(f.calls[0].headers.Prefer, 'resolution=merge-duplicates,return=minimal');
        assert.equal(f.calls[0].headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
        assert.deepEqual(f.calls[0].body, {
            user_id: USER_ID, blocked: false, checked_at: '2026-11-25T12:00:00.000Z', cleared_at: '2026-11-25T12:00:00.000Z',
            cleared_by: AGENT, cleared_sanction_id: SANCTION, cleared_alert_id: null
        });
    } finally { f.restore(); }
    f = captureFetch(() => okJson([{ user_id: USER_ID, cleared_at: '2026-11-25T12:00:00.000Z' }]));
    try {
        assert.equal(await TerminosRepo.isReentryCleared(USER_ID), true);
        assert.ok(f.calls[0].url.includes('/rest/v1/terms_reentry_checks?'));
        assert.ok(f.calls[0].url.includes(`user_id=eq.${USER_ID}`));
    } finally { f.restore(); }
    f = captureFetch(() => okJson([{ user_id: USER_ID, cleared_at: null }]));
    try {
        assert.equal(await TerminosRepo.isReentryCleared(USER_ID), false, 'revisada por el barrido, sin excepción');
    } finally { f.restore(); }
    f = captureFetch(() => ({ ok: false, status: 400, text: async () => '{"code":"42703","message":"column terms_reentry_checks.cleared_at does not exist"}', headers: { get: () => null } }));
    try {
        assert.equal(await TerminosRepo.isReentryCleared(USER_ID), false);
        assert.deepEqual(await TerminosRepo.clearReentry(USER_ID, { by: AGENT }), { stored: false, missingTable: true });
    } finally { f.restore(); }
    f = captureFetch(() => ({ ok: false, status: 500, text: async () => '{"message":"connection reset"}', headers: { get: () => null } }));
    try {
        await assert.rejects(() => TerminosRepo.clearReentry(USER_ID, { by: AGENT }), 'un error real se propaga (el levantamiento queda en PARTIAL)');
    } finally { f.restore(); }
});

function captureFetch(responder) {
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
        return responder(String(url), opts);
    };
    return { calls, restore: () => { global.fetch = original; } };
}

const okJson = (rows, status = 200) => ({ ok: true, status, json: async () => rows, text: async () => JSON.stringify(rows), headers: { get: () => null } });

test('stampAllProfiles: PATCH en artists_db, clients_db y studios por user_id, sin filtro is.null', async () => {
    const f = captureFetch((url) => okJson(url.includes('studios') ? [{ user_id: USER_ID }, { user_id: USER_ID }] : [{ user_id: USER_ID }]));
    try {
        const out = await TerminosRepo.stampAllProfiles(USER_ID, { version: TERMS_VERSION, acceptedAt: '2026-11-18T12:00:00.000Z' });
        assert.deepEqual(out, { artist: 1, client: 1, studio: 2 });
        assert.equal(f.calls.length, 3);
        for (const [i, table] of ['artists_db', 'clients_db', 'studios'].entries()) {
            const c = f.calls[i];
            assert.equal(c.method, 'PATCH');
            assert.ok(c.url.includes(`/rest/v1/${table}?`), table);
            assert.ok(c.url.includes(`user_id=eq.${USER_ID}`));
            assert.ok(!c.url.includes('is.null'), 'vuelve a sellar aunque ya hubiera una aceptación');
            assert.deepEqual(c.body, { terms_accepted_at: '2026-11-18T12:00:00.000Z', terms_version: TERMS_VERSION });
            assert.equal(c.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY, 'service_role');
        }
    } finally { f.restore(); }
});

test('insertAcceptance: on_conflict=user_id,version e ignore-duplicates; sin tabla no rompe', async () => {
    let f = captureFetch(() => ({ ok: true, status: 201, text: async () => '', json: async () => null, headers: { get: () => null } }));
    try {
        const out = await TerminosRepo.insertAcceptance({ userId: USER_ID, version: TERMS_VERSION, surface: 'gate', userAgent: 'UA' });
        assert.deepEqual(out, { stored: true, missingTable: false });
        assert.ok(f.calls[0].url.endsWith('/rest/v1/terms_acceptances?on_conflict=user_id,version'));
        assert.equal(f.calls[0].headers.Prefer, 'resolution=ignore-duplicates,return=minimal');
        assert.deepEqual(f.calls[0].body, { user_id: USER_ID, version: TERMS_VERSION, surface: 'gate', user_agent: 'UA' });
    } finally { f.restore(); }
    f = captureFetch(() => ({ ok: false, status: 404, text: async () => '{"code":"PGRST205","message":"Could not find the table public.terms_acceptances in the schema cache"}', headers: { get: () => null } }));
    try {
        assert.deepEqual(await TerminosRepo.insertAcceptance({ userId: USER_ID, version: TERMS_VERSION, surface: 'gate' }), { stored: false, missingTable: true });
        assert.equal(await TerminosRepo.listAcceptances(USER_ID), null);
    } finally { f.restore(); }
});

// ------------------------------------------------------------ migración

test('migración 20261118120000: tabla con RLS de solo lectura propia, bump de handle_new_user y estudio con versión del servidor', () => {
    const sql = read('supabase/migrations/20261118120000_terminos_reaceptacion.sql');
    assert.match(sql, /references auth\.users\(id\) on delete cascade/);
    assert.match(sql, /check \(surface in \('artist', 'client', 'studio', 'signup', 'gate'\)\)/);
    assert.match(sql, /unique \(user_id, version\)/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
    assert.match(sql, /revoke all on table public\.terms_acceptances from public, anon, authenticated;/);
    assert.match(sql, /grant select on table public\.terms_acceptances to authenticated;/);
    assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*to (anon|authenticated)/i);
    assert.match(sql, /select pg_get_functiondef\('public\.handle_new_user\(\)'::regprocedure\) into def;/);
    assert.match(sql, /raise exception 'handle_new_user no tiene la constante de versión esperada \(2026-11-16\)/);
    assert.match(sql, /terms_version = v_version/);
    assert.doesNotMatch(sql, /Confirmá|iniciá|Aceptá/, 'mensajes en tuteo');
    assert.match(sql, /Confirma tu correo e inicia sesión para completar el registro\./);
    assert.match(sql, /Acepta los Términos y la Política de Privacidad para crear el estudio\./);
    // Barrido del bloqueo de reingreso: solo service_role.
    assert.match(sql, /create table if not exists public\.terms_reentry_checks/);
    assert.match(sql, /revoke all on table public\.terms_reentry_checks from public, anon, authenticated;/);
    assert.match(sql, /create or replace function public\.terms_reentry_pending\(p_since timestamptz, p_limit integer default 50\)/);
    assert.match(sql, /security definer\s+set search_path to ''/);
    assert.match(sql, /revoke all on function public\.terms_reentry_pending\(timestamptz, integer\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.terms_reentry_pending\(timestamptz, integer\) to service_role;/);
    assert.match(sql, /not exists \(select 1 from public\.terms_acceptances ta where ta\.user_id = u\.id\)/);
    assert.match(sql, /u\.banned_until is null or u\.banned_until <= now\(\)/);
    // Excepción de soporte: columnas cleared_* y la RPC saltea las cuentas revisadas.
    assert.match(sql, /cleared_at timestamptz,\s+cleared_by uuid,\s+cleared_sanction_id uuid,\s+cleared_alert_id uuid,/);
    assert.match(sql, /constraint terms_reentry_checks_cleared_check\s+check \(cleared_at is not null or \(cleared_by is null and cleared_sanction_id is null and cleared_alert_id is null\)\)/);
    assert.match(sql, /and \(rc\.cleared_at is not null\s+or rc\.checked_at >= greatest\(/);
    const down = read('supabase/rollbacks/20261118120000_terminos_reaceptacion.down.sql');
    assert.match(down, /drop table if exists public\.terms_acceptances;/);
    assert.match(down, /drop function if exists public\.terms_reentry_pending\(timestamptz, integer\);/);
    assert.match(down, /drop table if exists public\.terms_reentry_checks;/);
    assert.match(down, /execute replace\(def, nuevo, viejo\);/);
    assert.match(down, /create or replace function public\.complete_studio_registration/);
});

// ------------------------------------------------------------ navegador

test('wo-terms-gate: decisiones, rutas excluidas, caché por versión y textos', () => {
    assert.equal(browserGate.decide(null), 'unknown');
    assert.equal(browserGate.decide({ success: true, blocked: true, accepted: true }), 'blocked');
    assert.equal(browserGate.decide({ success: true, accepted: true, sanction: { kind: 'ban' } }), 'banned');
    assert.equal(browserGate.decide({ success: true, accepted: false, sanction: { kind: 'suspension' } }), 'needs_accept');
    assert.equal(browserGate.decide({ success: true, accepted: true, sanction: { kind: 'suspension' } }), 'suspended');
    assert.equal(browserGate.decide({ success: true, accepted: true, sanction: null }), 'ok');
    assert.equal(browserGate.isExcludedPath('/beta/support/dashboard/', '/beta'), true);
    assert.equal(browserGate.isExcludedPath('/backoffice/admin', ''), true);
    assert.equal(browserGate.isExcludedPath('/legal/terms', ''), true);
    assert.equal(browserGate.isExcludedPath('/artist/dashboard', ''), false);
    assert.equal(browserGate.isExcludedPath('/supporter', ''), false);
    assert.equal(browserGate.defersAccept('/beta/client/register/', '/beta'), true);
    assert.equal(browserGate.defersAccept('/client/dashboard', ''), false);
    assert.equal(browserGate.cacheKey(TERMS_VERSION, 'u1'), `wo_terms_gate:${TERMS_VERSION}:u1`);
    assert.equal(browserGate.normalizeSurface('STUDIO'), 'studio');
    assert.equal(browserGate.normalizeSurface('signup'), 'gate', 'el navegador no puede marcar un alta del servidor');
    assert.equal(browserGate.BAN_MESSAGE, 'Tu cuenta fue dada de baja por incumplir los Términos. Revisa el correo que te enviamos para conocer el motivo y cómo apelar.');
    assert.equal(browserGate.BLOCKED_MESSAGE, GENERIC);
    assert.match(browserGate.suspensionText({ ends_at: '2026-12-01T12:00:00Z' }), /^Tu perfil está suspendido hasta el .+; mientras tanto no aparece en búsquedas\.$/);
    assert.equal(browserGate.suspensionText({ ends_at: null }), 'Tu perfil está suspendido; mientras tanto no aparece en búsquedas.');
    assert.equal(browserGate.sessionFromStorageValue('{"access_token":"t","expires_at":1}'), null, 'sesión vencida');
    assert.deepEqual(browserGate.sessionFromStorageValue({ access_token: 't', user: { id: 'u' } }), { access_token: 't', user: { id: 'u' } });
    const titles = browserGate.SUMMARY.map((s) => s.title);
    assert.deepEqual(titles, ['Identidad', 'Tu obra', 'Sanciones', 'Apelación']);
});

test('wo-terms-gate: modal accesible y enlaces legales', () => {
    const src = read('public/shared/js/wo-terms-gate.js');
    assert.match(src, /'aria-modal', 'true'/);
    assert.match(src, /event\.key === 'Escape'\) \{ event\.preventDefault\(\)/, 'no se cierra con Escape');
    assert.match(src, /setAttribute\('inert', ''\)/);
    assert.match(src, /Actualizamos los Términos y la Política de privacidad/);
    assert.match(src, /Aceptar y continuar/);
    assert.match(src, /Cerrar sesión/);
    assert.match(src, /appUrl\('\/legal\/terms'\)/);
    assert.match(src, /appUrl\('\/legal\/privacy'\)/);
    assert.match(src, /appUrl\('\/api\/account\/terms-status'\)/);
    assert.match(src, /appUrl\('\/api\/account\/terms-accept'\)/);
    assert.match(src, /sessionStorage/);
    assert.doesNotMatch(src, /\bseña\b|\bvos\b|querés|tenés|podés/i);
    assert.ok(fs.existsSync(path.join(root, 'public/shared/css/wo-terms-gate.css')));
});

test('wo-terms-gate: 401 con sesión guardada → confirma con Supabase; baja o sesión revocada cierran la sesión local', () => {
    assert.equal(browserGate.isBannedAuthError({ code: 'user_banned', message: 'User is banned' }), true);
    assert.equal(browserGate.isBannedAuthError({ message: 'User is banned' }), true);
    assert.equal(browserGate.isBannedAuthError({ message: 'Invalid login credentials' }), false);
    assert.equal(browserGate.classifyRejectedSession(null), 'unknown', 'Supabase acepta la sesión: no se toca');
    assert.equal(browserGate.classifyRejectedSession({ code: 'user_banned', status: 403 }), 'banned');
    assert.equal(browserGate.classifyRejectedSession({ code: 'session_not_found', status: 403 }), 'invalid');
    assert.equal(browserGate.classifyRejectedSession({ name: 'AuthSessionMissingError', status: 400 }), 'invalid');
    assert.equal(browserGate.classifyRejectedSession({ status: 401 }), 'invalid');
    assert.equal(browserGate.classifyRejectedSession({ name: 'AuthRetryableFetchError', status: 0 }), 'unknown', 'sin red no cierra la sesión');
    const src = read('public/shared/js/wo-terms-gate.js');
    assert.match(src, /if \(r\.status === 401\) return handleRejectedSession\(\);/);
    assert.match(src, /client\.auth\.getUser\(\)/);
    assert.match(src, /CACHE_PREFIX \+ 'reloaded'/, 'recarga una sola vez');
});

test('login de cliente y estudio: user_banned muestra el mensaje de la baja (WoAccountBan)', () => {
    const ban = browserGate.BAN_MESSAGE;
    const client = read('public/shared/js/client-auth.js');
    const studio = read('public/shared/js/studio-auth.js');
    const artist = read('public/shared/js/artist-auth.js');
    for (const src of [client, studio, artist]) {
        assert.ok(src.includes(`MESSAGE: '${ban}'`), 'mismo texto que el gate');
        assert.match(src, /WoAccountBan = (window|root)\.WoAccountBan \|\| \{/);
        assert.match(src, /error\.code === 'user_banned'/);
    }
    const loginCatch = client.slice(client.indexOf("let errorMessage = 'No pudimos iniciar sesión. Prueba de nuevo.';"));
    assert.ok(loginCatch.indexOf('window.WoAccountBan.isBannedError(error)') < loginCatch.indexOf("'Email o contraseña incorrectos.'"));
    assert.ok((client.match(/window\.WoAccountBan\.isBannedError\(error\)/g) || []).length >= 2, 'handleClientLogin y ClientAuth.login');
    const loginStudio = studio.slice(studio.indexOf('async function loginStudio('));
    assert.ok(loginStudio.indexOf('window.WoAccountBan.isBannedError(error)') < loginStudio.indexOf('if (error) throw error;'));
    // Helper ejecutable (mismo cuerpo en los tres archivos).
    const sandbox = {};
    new Function('window', client.slice(client.indexOf('window.WoAccountBan = '), client.indexOf('};', client.indexOf('window.WoAccountBan = ')) + 2))(sandbox);
    assert.equal(sandbox.WoAccountBan.isBannedError({ code: 'user_banned' }), true);
    assert.equal(sandbox.WoAccountBan.isBannedError({ message: 'User is banned' }), true);
    assert.equal(sandbox.WoAccountBan.isBannedError({ message: 'Invalid login credentials' }), false);
    assert.equal(sandbox.WoAccountBan.MESSAGE, ban);
});

test('wo-consent carga el gate con sesión, fuera de soporte y backoffice, respetando /beta', () => {
    assert.equal(consent.shouldLoadTermsGate('/artist/dashboard', '', true), true);
    assert.equal(consent.shouldLoadTermsGate('/artist/dashboard', '', false), false);
    assert.equal(consent.shouldLoadTermsGate('/beta/support/dashboard', '/beta', true), false);
    assert.equal(consent.shouldLoadTermsGate('/backoffice/admin', '', true), false);
    assert.equal(consent.termsGateScriptUrl('https://beta.weotzi.com/beta/shared/js/wo-consent.js?v=2', '/beta'), 'https://beta.weotzi.com/beta/shared/js/wo-terms-gate.js?v=20261118');
    assert.equal(consent.termsGateScriptUrl('', '/beta'), '/beta/shared/js/wo-terms-gate.js?v=20261118');
});

test('artist-auth, client-auth y studio-auth llaman al gate al resolver la sesión', () => {
    const artist = read('public/shared/js/artist-auth.js');
    assert.match(artist, /requestTermsGate\(targetRoot, session, supabase\);/);
    assert.match(artist, /surface: 'artist'/);
    const client = read('public/shared/js/client-auth.js');
    assert.match(client, /surface: 'client'/);
    assert.ok((client.match(/requestClientTermsGate\(session\);/g) || []).length >= 2, 'checkClientAuthState y handleOAuthCallback');
    const studio = read('public/shared/js/studio-auth.js');
    assert.match(studio, /surface: 'studio'/);
    assert.match(studio, /requestTermsGate\(session\);/);
    assert.match(studio, /requestTermsGate\(data\.session\);/);
    for (const src of [artist, client, studio]) assert.match(src, /wo-terms-gate\.js\?v=20261118/);
});

test('client-auth y studio-auth piden el precheck antes del signUp', () => {
    const client = read('public/shared/js/client-auth.js');
    const pre = client.indexOf('await precheckClientRegistration({ email, whatsapp, instagram });');
    assert.ok(pre > 0);
    assert.ok(pre < client.indexOf('await _supabase.auth.signUp({'), 'precheck antes del signUp');
    assert.match(client, /clientAppPath\('\/api\/register\/precheck'\)/);
    const studio = read('public/shared/js/studio-auth.js');
    const register = studio.indexOf("flow: 'studio'\n");
    const claim = studio.indexOf("flow: 'studio_claim' });");
    assert.ok(register > 0 && claim > 0);
    assert.ok(register < studio.indexOf("data: { user_type: 'studio', studio_registration: draft }"));
    assert.ok(claim < studio.indexOf("data: { user_type: 'studio', studio_claim: draft }"));
    assert.match(studio, /appUrl\('\/api\/register\/precheck'\)/);
});

// ------------------------------------------------------------ server.js y account-modes

test('server.js: bloqueo de reingreso en el finalize (antes de crear la cuenta); ni draft ni check-uniqueness son oráculo', () => {
    const server = read('server.js');
    const finalizeCheck = server.indexOf("registrationReentryInput(formData, email, 'artist', ownAuthUser");
    assert.ok(finalizeCheck > 0);
    assert.ok(finalizeCheck < server.indexOf('authUser = await createArtistAuthUser({'), 'antes de crear el usuario de Auth');
    assert.equal((server.match(/termsGate\.checkReentrySafe\(/g) || []).length, 1, 'solo el finalize (authLimiter) comprueba');
    const routeBody = (marker) => {
        const start = server.indexOf(marker);
        assert.ok(start > 0, marker);
        const rest = server.slice(start);
        return rest.slice(0, rest.search(/\r?\n\}\);/));
    };
    assert.doesNotMatch(routeBody("app.post('/api/register/check-uniqueness'"), /REGISTRATION_BLOCKED|checkReentry/);
    assert.doesNotMatch(routeBody("app.post('/api/register/artist-draft'"), /REGISTRATION_BLOCKED|checkReentry/);
    assert.equal((server.match(/status\(403\)\.json\(\{ success: false, \.\.\.termsGate\.REGISTRATION_BLOCKED \}\)/g) || []).length, 1);
    assert.match(server, /surface: 'signup'/);
    assert.match(server, /require\('\.\/lib\/routes\/terminos'\)\.register/, 'la integración registra la ruta');
});

test('account-modes: test-client y modo cliente responden 403 genérico si el reingreso está bloqueado', async () => {
    const accountModes = require('../services/account-modes');
    const svc = fakeService({ blocked: true });
    const restoreService = gate._internal.setSanctionsService(svc);
    const prevOpen = process.env.AUDIT_REGISTRATION_OPEN;
    process.env.AUDIT_REGISTRATION_OPEN = 'true';
    const f = captureFetch((url) => {
        if (url.endsWith('/auth/v1/user')) return okJson({ id: USER_ID, email: 'persona@example.test', created_at: new Date().toISOString(), user_metadata: {} });
        throw new Error('no debería escribir: ' + url);
    });
    try {
        let res = mockRes();
        await accountModes.registerTestClient({ body: { email: 'persona@example.test', password: 'segura123', full_name: 'Persona' } }, res);
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.body, { success: false, code: 'REGISTRATION_BLOCKED', error: GENERIC });
        assert.equal(svc.calls.check[0].flow, 'client');

        res = mockRes();
        await accountModes.activate({ headers: { authorization: 'Bearer token' }, body: { mode: 'client' } }, res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, 'REGISTRATION_BLOCKED');
        assert.equal(svc.calls.block.length, 1, 'cuenta nueva: se bloquea en Auth');
        assert.equal(f.calls.filter((c) => c.url.includes('/rest/v1/')).length, 0, 'no crea el perfil');
    } finally {
        f.restore();
        restoreService();
        if (prevOpen === undefined) delete process.env.AUDIT_REGISTRATION_OPEN; else process.env.AUDIT_REGISTRATION_OPEN = prevOpen;
    }
});
