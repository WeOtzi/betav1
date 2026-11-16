// Alta y reclamo de estudio (frente estudio-registro, beta cerrada).
// studio-auth.js corre sobre el studios-repo.js real con un cliente falso: se
// verifican los argumentos de las RPC y los estados del onboarding. Portado de
// la revisión "Estudios v1" (release/2.3.0-estudios-store) y adaptado: reclamo
// con aceptación de Términos, conflictos que nunca quedan en el login.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const repoSource = read('public/shared/js/data/studios-repo.js');
const authSource = read('public/shared/js/studio-auth.js');
const registerSource = read('public/shared/js/studio-register.js');

const STUDIO_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_ID = '22222222-2222-4222-8222-222222222222';
const TERMS = '2026-11-13';
const user = { id: 'owner-id', email: 'studio@example.test', user_metadata: {} };
const catalogStudio = { id: STUDIO_ID, name: 'Black Ink', slug: 'black-ink', city: 'Rosario', country: 'Argentina', logo_image: null };
const claimDraft = { studio_id: STUDIO_ID, evidence: 'Soy la dueña, mira el Instagram @blackink', contact_name: 'Ana', contact_phone: '+54 341 555', terms_version: TERMS };
const profile = { name: 'Black Ink', languages: ['Español'], terms_accepted: true, terms_version: TERMS };
const locations = [{ label: 'Principal', formatted_address: 'Calle 123', is_primary: true }];
const pendingClaim = { id: CLAIM_ID, studio_id: STUDIO_ID, user_id: user.id, status: 'pending', created_at: '2026-10-30T12:00:00Z', studios: catalogStudio };
const RECLAMALO = { code: '23514', message: 'Ese estudio ya está en We Ötzi: reclamalo desde el registro.' };
const MISSING_FN = { code: '42883', message: 'function public.request_studio_claim does not exist' };

function sessionWith(metadata = {}) {
    return { access_token: 'jwt-token', user: { ...user, user_metadata: metadata } };
}

function fakeDocument() {
    const listeners = [];
    const hideables = [{ hidden: false }, { hidden: false }];
    const screen = {
        id: 'studio-claim-screen', hidden: true, innerHTML: '',
        querySelector(selector) {
            if (selector.includes('logout') && this.innerHTML.includes('data-claim-action="logout"')) {
                return { addEventListener: (event, fn) => listeners.push(fn) };
            }
            return null;
        }
    };
    const doc = {
        addEventListener() {},
        getElementById(id) { return id === 'studio-claim-screen' ? screen : null; },
        querySelectorAll() { return hideables; }
    };
    return { doc, screen, hideables, listeners };
}

function harness(options = {}) {
    const calls = [];
    let session = options.session || null;
    const rpcResults = {
        complete_studio_registration: { data: { id: 'new-studio', user_id: user.id, name: profile.name }, error: null },
        request_studio_claim: { data: CLAIM_ID, error: null },
        list_unowned_studios: { data: [catalogStudio], error: null },
        ...(options.rpc || {})
    };
    const client = {
        auth: {
            getSession: async () => ({ data: { session } }),
            signUp: async payload => {
                calls.push(['signup', payload]);
                return { data: options.signup || { user: { id: 'new-user', identities: [{ id: 'x' }] }, session: null } };
            },
            signInWithPassword: async () => { session = options.loginSession || session; return { data: { session } }; },
            updateUser: async payload => {
                calls.push(['updateUser', payload]);
                if (session) session = { ...session, user: { ...session.user, user_metadata: { ...session.user.user_metadata, ...payload.data } } };
                return { data: { user: session && session.user } };
            },
            signOut: async () => { calls.push(['signOut']); return {}; }
        },
        // Como supabase-js: rpc() devuelve un builder "thenable" (studios-repo
        // encadena .select().eq().maybeSingle() sobre get_my_studio, pii-studios).
        rpc: (name, args) => {
            calls.push(['rpc', name, args]);
            const run = () => {
                const result = rpcResults[name];
                if (typeof result === 'function') return result(args);
                return result || { data: null, error: MISSING_FN };
            };
            const builder = {
                select() { return builder; },
                eq() { return builder; },
                maybeSingle() { return Promise.resolve().then(run); },
                then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); }
            };
            return builder;
        }
    };
    function from(table) {
        const query = { table, filters: [] };
        calls.push(['from', table, query]);
        const resolve = () => {
            if (table === 'studios') return { data: options.studio || null, error: null };
            if (table === 'studio_claim_requests') {
                if (options.claimError) return { data: null, error: options.claimError };
                return { data: options.claim || null, error: null };
            }
            return { data: null, error: null };
        };
        const builder = {
            select(columns) { query.select = columns; return builder; },
            eq(key, value) { query.filters.push([key, value]); return builder; },
            order(key, opts) { query.order = [key, opts]; return builder; },
            limit(n) { query.limit = n; return builder; },
            maybeSingle() { return Promise.resolve(resolve()); }
        };
        return builder;
    }
    const data = { getClient: () => client, from };
    const dom = options.dom || null;
    const fetches = [];
    const window = {
        location: { pathname: options.pathname || '/studio/register', search: options.search || '', hash: '', origin: 'https://weotzi.com', href: '' },
        WeotziData: data,
        ConfigManager: { ready: async () => {} },
        fetch: options.fetch === false ? undefined : async (...args) => { fetches.push(args); return { ok: true }; }
    };
    const document = dom ? dom.doc : { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } };
    const context = { window, document, WeotziData: data, URLSearchParams, Date, Promise, console: { error() {}, warn() {} } };
    vm.runInNewContext(repoSource, context);
    if (options.withoutClaimRepo) {
        delete data.Studios.getMyClaim;
        delete data.Studios.requestClaim;
        delete data.Studios.listUnownedStudios;
    }
    vm.runInNewContext(authSource, context);
    return { auth: window.WeOtziStudioAuth, window, calls, data, fetches, rpcCalls: name => calls.filter(c => c[0] === 'rpc' && c[1] === name) };
}

test('el signUp del reclamo guarda solo el borrador sin secretos y no envía nada antes de confirmar el email', async () => {
    const h = harness();
    const result = await h.auth.claim({
        studioId: STUDIO_ID, evidence: '  ' + claimDraft.evidence + '  ', contactName: 'Ana', contactPhone: '+54 341 555',
        email: user.email, password: 'test-password', termsVersion: TERMS
    });
    assert.deepEqual({ ...result }, { confirmationRequired: true, email: user.email });
    assert.equal(h.calls.some(c => c[0] === 'rpc'), false, 'request_studio_claim necesita el email confirmado');
    const signup = h.calls.find(c => c[0] === 'signup')[1];
    assert.equal(signup.options.data.user_type, 'studio');
    assert.deepEqual({ ...signup.options.data.studio_claim }, claimDraft);
    assert.equal(signup.options.data.studio_registration, undefined);
    assert.equal(JSON.stringify(signup.options.data).includes('test-password'), false);
    assert.equal(signup.options.emailRedirectTo, 'https://weotzi.com/studio/login?confirmed=1');
});

test('el reclamo exige aceptar los Términos', async () => {
    const h = harness({ session: sessionWith() });
    await assert.rejects(h.auth.claim({ studioId: STUDIO_ID, evidence: claimDraft.evidence }), /Términos/);
    assert.equal(h.calls.some(c => c[0] === 'rpc'), false);
});

test('al confirmar el email se envía el reclamo una vez (con términos) y el registro muestra "Reclamo en revisión"', async () => {
    const dom = fakeDocument();
    const h = harness({ pathname: '/studio/register', search: '?reclamo=1', session: sessionWith({ studio_claim: claimDraft }), claim: pendingClaim, dom });
    assert.equal(await h.auth.check(), null);
    const claims = h.rpcCalls('request_studio_claim');
    assert.equal(claims.length, 1);
    assert.deepEqual({ ...claims[0][2] }, {
        p_studio_id: STUDIO_ID, p_evidence: claimDraft.evidence, p_contact_name: 'Ana', p_contact_phone: '+54 341 555', p_terms_version: TERMS
    });
    const cleared = h.calls.find(c => c[0] === 'updateUser')[1].data;
    assert.equal(cleared.studio_claim, null);
    assert.equal(cleared.studio_registration, null, 'un reclamo enviado reemplaza el borrador de registro');
    const lookup = h.calls.find(c => c[0] === 'from' && c[1] === 'studio_claim_requests')[2];
    assert.deepEqual(lookup.filters, [['user_id', user.id]]);
    assert.equal(h.auth.getState().kind, 'claim_pending');
    assert.equal(h.window.location.href, '');
    assert.equal(dom.screen.hidden, false);
    assert.match(dom.screen.innerHTML, /Reclamo en revisión/);
    assert.match(dom.screen.innerHTML, /Te avisamos por email/);
    assert.match(dom.screen.innerHTML, /Black Ink/);
    assert.match(dom.screen.innerHTML, /Rosario · Argentina/);
    assert.match(dom.screen.innerHTML, /class="wo-btn/, 'pantalla con los botones del DS');
    assert.ok(dom.hideables.every(el => el.hidden), 'el wizard queda oculto');
    await h.auth.check();
    assert.equal(h.rpcCalls('request_studio_claim').length, 1, 'un segundo chequeo no lo vuelve a enviar');
    assert.equal(dom.listeners.length >= 1, true, 'botón Cerrar sesión cableado');
});

test('sin la sobrecarga de términos el reclamo reintenta con la firma anterior', async () => {
    let first = true;
    const h = harness({
        session: sessionWith(), claim: pendingClaim,
        rpc: { request_studio_claim: args => {
            if (first && 'p_terms_version' in args) { first = false; return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; }
            return { data: CLAIM_ID, error: null };
        } }
    });
    const state = await h.auth.claim({ studioId: STUDIO_ID, studio: catalogStudio, evidence: claimDraft.evidence, email: user.email, termsVersion: TERMS });
    assert.equal(state.kind, 'claim_pending');
    const calls = h.rpcCalls('request_studio_claim');
    assert.equal(calls.length, 2);
    assert.equal('p_terms_version' in calls[1][2], false);
});

test('con sesión abierta reclama al instante sin otro signUp y una cuenta distinta no puede reclamar', async () => {
    const h = harness({ session: sessionWith({ studio_registration: { profile, locations } }), claim: pendingClaim });
    const state = await h.auth.claim({ studioId: STUDIO_ID, studio: catalogStudio, evidence: claimDraft.evidence, email: user.email, termsVersion: TERMS });
    assert.equal(state.kind, 'claim_pending');
    assert.equal(state.claim.id, CLAIM_ID);
    assert.equal(h.calls.some(c => c[0] === 'signup'), false);
    assert.equal(h.rpcCalls('request_studio_claim')[0][2].p_contact_name, null);

    const other = harness({ session: sessionWith() });
    await assert.rejects(other.auth.claim({ studioId: STUDIO_ID, evidence: claimDraft.evidence, email: 'otra@example.test', termsVersion: TERMS }), /otra cuenta abierta/);
    await assert.rejects(other.auth.claim({ studioId: STUDIO_ID, evidence: '   ', termsVersion: TERMS }), /Cuéntanos cómo podemos verificar/);
});

test('un reclamo pendiente bloquea el borrador y fuera del registro lleva a la pantalla de revisión', async () => {
    const h = harness({ pathname: '/studio/dashboard', session: sessionWith({ studio_registration: { profile, locations } }), claim: pendingClaim });
    assert.equal(await h.auth.check(), null);
    assert.equal(h.rpcCalls('complete_studio_registration').length, 0);
    assert.equal(h.window.location.href, '/studio/register?reclamo=1');

    const login = harness({ pathname: '/beta/studio/login', loginSession: sessionWith(), claim: pendingClaim });
    assert.equal(await login.auth.login(user.email, 'test-password'), null);
    assert.equal(login.window.location.href, '/beta/studio/register?reclamo=1');
});

test('un reclamo rechazado no bloquea un alta nueva y en el registro se muestra como aviso', async () => {
    const rejected = { ...pendingClaim, status: 'rejected', decided_at: '2026-10-31T12:00:00Z', decision_note: 'No pudimos verificar <el> local' };
    const reg = harness({ pathname: '/studio/register', session: sessionWith(), claim: rejected, dom: fakeDocument() });
    await reg.auth.check();
    assert.equal((await reg.auth.whenChecked()).kind, 'claim_rejected');
    assert.equal(reg.window.location.href, '');

    const html = reg.auth.claimScreenHtml({ kind: 'claim_rejected', claim: rejected });
    assert.match(html, /No aprobamos tu reclamo/);
    assert.match(html, /No pudimos verificar &lt;el&gt; local/);
    assert.match(html, /Registrar un estudio nuevo/);

    const fresh = harness({ pathname: '/studio/login', session: sessionWith({ studio_registration: { profile, locations } }), claim: { ...pendingClaim, status: 'rejected' } });
    const studio = await fresh.auth.check();
    assert.equal(studio.id, 'new-studio');
    assert.equal(fresh.window.location.href, '/studio/dashboard');
});

test('el rechazo por ficha del catálogo conserva el borrador y lleva al registro (nunca deja el error en el login)', async () => {
    const h = harness({
        pathname: '/studio/login', session: sessionWith({ studio_registration: { profile, locations } }),
        rpc: { complete_studio_registration: { data: null, error: RECLAMALO } }
    });
    assert.equal(await h.auth.check(), null);
    const state = h.auth.getState();
    assert.equal(state.kind, 'claimable');
    assert.equal(state.name, 'Black Ink');
    assert.equal(h.window.location.href, '/studio/register?complete=1&revisar=1');
    assert.equal(h.calls.some(c => c[0] === 'updateUser'), false, 'el borrador sobrevive');

    const r = harness({
        pathname: '/beta/studio/register', session: sessionWith({ studio_registration: { profile, locations } }),
        rpc: { complete_studio_registration: { data: null, error: RECLAMALO } }
    });
    await r.auth.check();
    assert.equal(r.auth.getState().kind, 'claimable');
    assert.equal(r.window.location.href, '', 'el registro ofrece el reclamo en el lugar');
});

test('homónimo con dueño, dirección en conflicto y términos faltantes son conflictos del registro', async () => {
    for (const [error, code] of [
        [{ code: '23505', message: 'Ya hay un estudio llamado «Black Ink»' }, '23505'],
        [{ code: '23P01', message: 'La dirección de Principal coincide con «Otro»' }, '23P01'],
        [{ code: '22023', hint: 'terms_required', message: 'Acepta los Términos y la Política de Privacidad para crear el estudio.' }, 'terms']
    ]) {
        const h = harness({
            pathname: '/studio/login', session: sessionWith({ studio_registration: { profile, locations } }),
            rpc: { complete_studio_registration: { data: null, error } }
        });
        assert.equal(await h.auth.check(), null);
        const state = h.auth.getState();
        assert.equal(state.kind, 'registration_conflict');
        assert.equal(state.code, code);
        assert.equal(h.window.location.href, '/studio/register?complete=1&revisar=1');
    }
    const { auth } = harness();
    assert.equal(auth.isClaimableError(RECLAMALO), true);
    assert.equal(auth.isClaimableError({ code: '23505', message: 'duplicate key' }), false);
    assert.equal(auth.isTermsError({ code: '22023', message: 'Acepta los Términos' }), true);
    assert.equal(auth.isTermsError({ code: '22023', message: 'El nombre debe tener entre 2 y 160 caracteres.' }), false);
});

test('el alta pasa por WeotziData.Studios.completeRegistration y pide la bienvenida una sola vez sin bloquear', async () => {
    const h = harness({ pathname: '/studio/register', session: sessionWith() });
    const studio = await h.auth.register({ ...profile, email: user.email, locations });
    assert.equal(studio.id, 'new-studio');
    const rpc = h.rpcCalls('complete_studio_registration');
    assert.equal(rpc.length, 1);
    assert.equal(rpc[0][2].p_profile.terms_accepted, true);
    assert.equal(rpc[0][2].p_profile.terms_version, TERMS);
    assert.equal(h.fetches.length, 1);
    assert.equal(h.fetches[0][0], '/api/studio/registration/welcome');
    assert.equal(h.fetches[0][1].headers.Authorization, 'Bearer jwt-token');
    assert.equal(h.fetches[0][1].keepalive, true);

    const failing = harness({ pathname: '/studio/register', session: sessionWith(), fetch: false });
    const again = await failing.auth.register({ ...profile, email: user.email, locations });
    assert.equal(again.id, 'new-studio', 'sin fetch el alta igual termina');
});

test('sin la migración de reclamos el onboarding sigue como antes', async () => {
    const h = harness({ pathname: '/studio/dashboard', session: sessionWith(), claimError: { code: '42P01', message: 'relation "public.studio_claim_requests" does not exist' } });
    assert.equal(await h.auth.check(), null);
    assert.equal(h.auth.getState().kind, 'none');
    assert.equal(h.window.location.href, '/studio/register?complete=1');

    const legacy = harness({ pathname: '/studio/dashboard', session: sessionWith(), withoutClaimRepo: true });
    await legacy.auth.check();
    assert.equal(legacy.window.location.href, '/studio/register?complete=1');
    await assert.rejects(legacy.auth.claim({ studioId: STUDIO_ID, evidence: claimDraft.evidence, termsVersion: TERMS }), /Esta función todavía no está disponible/);
});

test('un rechazo definitivo del reclamo descarta el borrador; uno transitorio lo conserva', async () => {
    const owned = { data: null, error: { code: '23514', message: 'Este estudio ya tiene dueño en We Ötzi.' } };
    const h = harness({ pathname: '/studio/register', session: sessionWith({ studio_claim: claimDraft }), rpc: { request_studio_claim: owned }, dom: fakeDocument() });
    assert.equal(await h.auth.check(), null);
    const state = h.auth.getState();
    assert.equal(state.kind, 'claim_failed');
    assert.equal(state.error, 'Este estudio ya tiene dueño en We Ötzi.');
    const cleared = h.calls.filter(c => c[0] === 'updateUser');
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0][1].data.studio_claim, null);

    const flaky = harness({ pathname: '/studio/login', session: sessionWith({ studio_claim: claimDraft }), rpc: { request_studio_claim: { data: null, error: { message: 'Failed to fetch' } } } });
    assert.equal(await flaky.auth.check(), null);
    assert.equal(flaky.auth.getState().kind, 'error');
    assert.equal(flaky.calls.some(c => c[0] === 'updateUser'), false, 'el borrador espera un reintento');
});

test('la pantalla de reclamo escapa los datos del catálogo y conserva el prefijo /beta', () => {
    const h = harness({ pathname: '/beta/studio/register' });
    const html = h.auth.claimScreenHtml({
        kind: 'claim_pending',
        claim: { ...pendingClaim, studios: { ...catalogStudio, name: '<img src=x onerror=alert(1)>', slug: 'a b&c' } }
    });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /href="\/beta\/studio\/profile\/\?studio=a%20b%26c"/);
    assert.match(html, /En revisión/);
    const failed = h.auth.claimScreenHtml({ kind: 'claim_failed', error: '<b>Ya tienes un reclamo</b>' });
    assert.match(failed, /&lt;b&gt;Ya tienes un reclamo&lt;\/b&gt;/);
    assert.match(failed, /href="\/beta\/studio\/register\?nuevo=1"/);
});

/* ------------------------------ registro (studio-register.js) ------------------------------ */

function registerHelpers() {
    const window = { WeotziData: {} };
    const context = { window, document: { addEventListener() {} }, location: { pathname: '/studio/register/', search: '' }, console: { error() {}, warn() {} }, URL, setTimeout, clearTimeout };
    vm.runInNewContext(registerSource, context);
    return window.WeOtziStudioRegister;
}

test('las tarjetas de coincidencia escapan datos, descartan logos inseguros y ofrecen el reclamo solo sin dueño', () => {
    const reg = registerHelpers();
    const unowned = reg.matchCardHtml({ id: 'b"x', name: 'Otro <b>estudio</b>', city: 'Rosario', country: 'Argentina', logo_image: 'javascript:alert(1)', owned: false, verified: false, match: 'similar', slug: 'otro', locations: [{ formatted_address: 'Calle <i>1</i>' }] });
    assert.doesNotMatch(unowned, /javascript:/);
    assert.doesNotMatch(unowned, /<b>estudio|<i>1/);
    assert.match(unowned, /data-match-action="claim" data-id="b&quot;x"/);
    assert.match(unowned, />Ficha sin dueño</);
    assert.doesNotMatch(unowned, /link de alta/);
    const artistCreated = reg.matchCardHtml({ id: 'a', name: 'Sumado', owned: false, artist_created: true, match: 'exact', locations: [] });
    assert.match(artistCreated, /pídele el link de alta/);
    assert.match(artistCreated, /data-match-action="claim"/);
    const owned = reg.matchCardHtml({ id: 'o', name: 'Black Ink', owned: true, artist_created: false, verified: true, match: 'exact', logo_image: 'https://cdn.example.test/logo.png', locations: [] });
    assert.doesNotMatch(owned, /data-match-action="claim"/, 'un estudio con dueño no se reclama: se inicia sesión');
    assert.match(owned, />Iniciar sesión</);
    assert.match(owned, />Verificado</);
});

test('las reglas de nombre y dirección replican las funciones SQL', () => {
    const reg = registerHelpers();
    assert.equal(reg.normName('  Estudio  Ñandú-Tattoo '), 'estudio nandu tattoo');
    assert.deepEqual(JSON.parse(JSON.stringify(reg.nameTokens('Estudio Ñandú Tattoo'))), ['nandu']);
    assert.equal(reg.nameMatchKind('Claroscuro', 'CLAROSCURO'), 'exact');
    assert.equal(reg.nameMatchKind('Claroscuro', 'Claroscuro Tattoo Studio'), 'similar');
    assert.equal(reg.nameMatchKind('Sur Tattoo House', 'Sur Ink'), null);
    assert.equal(reg.streetKey('Gorriti 4800, Palermo, CABA'), 'gorriti 4800');
    assert.equal(reg.streetKey('Palermo, CABA'), null);
    const demo = { formatted_address: 'Gorriti 4800, Palermo, CABA, Argentina', city: 'Buenos Aires', latitude: -34.5889, longitude: -58.4306 };
    assert.equal(reg.addressConflict({ formatted_address: 'Gorriti 4800, C1414 Cdad. Autónoma de Buenos Aires, Argentina', latitude: -34.5907952, longitude: -58.4292052 }, demo), true);
    assert.equal(reg.addressConflict({ formatted_address: 'Gorriti 4800, Rosario', latitude: -32.95, longitude: -60.65 }, demo), false);
    assert.equal(reg.addressConflict({ formatted_address: 'Otra 1', latitude: -34.58893, longitude: -58.4306 }, demo), true);
    const entries = [{ address: { formatted_address: 'Lejos 1', latitude: -31.4, longitude: -64.18 } }, { address: { formatted_address: 'Gorriti 4800', latitude: -34.5890, longitude: -58.4306 } }];
    assert.equal(reg.locationConflicts(entries, [{ name: 'Demo', locations: [demo] }]).entry, entries[1]);
});

test('el aviso de cuenta abierta dice con qué cuenta y tipo se registra el estudio (ER-11)', () => {
    const reg = registerHelpers();
    assert.match(reg.accountNotice({ email: 'ana@example.test', user_metadata: { user_type: 'artist' } }), /ana@example\.test \(tu cuenta de artista\)/);
    assert.match(reg.accountNotice({ email: 'c@example.test', user_metadata: { user_type: 'client' } }), /tu cuenta de cliente/);
    assert.match(reg.accountNotice({ email: 'x@example.test' }), /tu cuenta actual/);
});

test('findMatches pasa por find_studio_matches y degrada sin la migración', async () => {
    const live = harness({ rpc: { find_studio_matches: { data: [{ id: 'm', name: 'Black Ink', match: 'exact', owned: false, locations: [] }], error: null } } });
    const res = await live.data.Studios.findMatches('  Black Ink ', '@blackink');
    assert.equal(res.data[0].id, 'm');
    assert.deepEqual({ ...live.rpcCalls('find_studio_matches')[0][2] }, { p_name: 'Black Ink', p_instagram: '@blackink' });
    const nothing = harness();
    assert.deepEqual(JSON.parse(JSON.stringify(await nothing.data.Studios.findMatches('x', ''))), { data: [], error: null });
    assert.equal(nothing.rpcCalls('find_studio_matches').length, 0);
    const missing = harness();
    const degraded = await missing.data.Studios.findMatches('Black Ink');
    assert.equal(degraded.unavailable, true);
    assert.deepEqual(JSON.parse(JSON.stringify(degraded.data)), []);
});
