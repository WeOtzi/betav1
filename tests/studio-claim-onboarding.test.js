// Alta y reclamo de estudio (docs/plans/2026-10-30-estudios-plataforma.md → W-ONBOARD):
// studio-auth.js corre sobre el studios-repo.js real con un cliente falso, así
// se verifican los argumentos de las RPC y los estados del onboarding.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const repoSource = read('public/shared/js/data/studios-repo.js');
const authSource = read('public/shared/js/studio-auth.js');
const kitSource = read('public/shared/js/studio-admin-kit.js');
const registerSource = read('public/shared/js/studio-register.js');

const STUDIO_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_ID = '22222222-2222-4222-8222-222222222222';
const user = { id: 'owner-id', email: 'studio@example.test', user_metadata: {} };
const catalogStudio = { id: STUDIO_ID, name: 'Black Ink', slug: 'black-ink', city: 'Rosario', country: 'Argentina', logo_image: null };
const claimDraft = { studio_id: STUDIO_ID, evidence: 'Soy la dueña, mirá el Instagram @blackink', contact_name: 'Ana', contact_phone: '+54 341 555' };
const profile = { name: 'Black Ink', languages: ['Español'] };
const locations = [{ label: 'Principal', formatted_address: 'Calle 123', is_primary: true }];
const pendingClaim = { id: CLAIM_ID, studio_id: STUDIO_ID, user_id: user.id, status: 'pending', created_at: '2026-10-30T12:00:00Z', studios: catalogStudio };
const RECLAMALO = { code: '23514', message: 'Ese estudio ya está en We Ötzi: reclamalo desde el registro.' };
const MISSING_FN = { code: '42883', message: 'function public.request_studio_claim does not exist' };

function sessionWith(metadata = {}) {
    return { user: { ...user, user_metadata: metadata } };
}

function fakeDocument({ withScreen = true } = {}) {
    const listeners = [];
    const makeEl = tag => ({
        tag, id: '', className: '', hidden: false, innerHTML: '', children: [], attrs: {},
        setAttribute(key, value) { this.attrs[key] = value; },
        appendChild(child) { this.children.push(child); return child; },
        querySelector(selector) {
            if (selector.includes('logout') && this.innerHTML.includes('data-claim-action="logout"')) {
                return { addEventListener: (event, fn) => listeners.push(fn) };
            }
            return null;
        }
    });
    const hideables = [makeEl('form'), makeEl('div')];
    const page = makeEl('div');
    const screen = withScreen ? makeEl('div') : null;
    const created = [];
    const doc = {
        body: page,
        addEventListener() {},
        getElementById(id) {
            if (id !== 'studio-claim-screen') return null;
            return screen || created.find(el => el.id === id) || null;
        },
        createElement(tag) { const el = makeEl(tag); created.push(el); return el; },
        querySelector(selector) { return selector === '.studio-page' ? page : null; },
        querySelectorAll() { return hideables; }
    };
    return { doc, page, screen, hideables, created, listeners };
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
        rpc: async (name, args) => {
            calls.push(['rpc', name, args]);
            const result = rpcResults[name];
            if (typeof result === 'function') return result(args);
            return result || { data: null, error: MISSING_FN };
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
    const window = {
        location: {
            pathname: options.pathname || '/studio/register', search: options.search || '', hash: '',
            origin: 'https://weotzi.com', href: ''
        },
        WeotziData: data,
        ConfigManager: { ready: async () => {} }
    };
    const document = dom ? dom.doc : { addEventListener() {}, getElementById() { return null; } };
    const context = { window, document, WeotziData: data, URLSearchParams, Date, Promise, console: { error() {}, warn() {} } };
    vm.runInNewContext(repoSource, context);
    if (options.withoutClaimRepo) {
        delete data.Studios.getMyClaim;
        delete data.Studios.requestClaim;
        delete data.Studios.listUnownedStudios;
    }
    vm.runInNewContext(authSource, context);
    return { auth: window.WeOtziStudioAuth, window, calls, data, rpcCalls: name => calls.filter(c => c[0] === 'rpc' && c[1] === name) };
}

test('claim signUp keeps only the non-secret claim draft and files nothing before the email confirmation', async () => {
    const h = harness();
    const result = await h.auth.claim({
        studioId: STUDIO_ID, evidence: '  ' + claimDraft.evidence + '  ', contactName: 'Ana', contactPhone: '+54 341 555',
        email: user.email, password: 'test-password'
    });
    assert.deepEqual({ ...result }, { confirmationRequired: true, email: user.email });
    assert.equal(h.calls.some(c => c[0] === 'rpc'), false, 'request_studio_claim needs a confirmed email');
    const signup = h.calls.find(c => c[0] === 'signup')[1];
    assert.equal(signup.options.data.user_type, 'studio');
    assert.deepEqual({ ...signup.options.data.studio_claim }, claimDraft);
    assert.equal(signup.options.data.studio_registration, undefined);
    assert.equal(JSON.stringify(signup.options.data).includes('test-password'), false);
    assert.equal(signup.options.emailRedirectTo, 'https://weotzi.com/studio/login?confirmed=1');
});

test('confirming the email files the claim once and shows "Reclamo en revisión" instead of redirecting', async () => {
    const dom = fakeDocument();
    const h = harness({ pathname: '/studio/login', search: '?confirmed=1', session: sessionWith({ studio_claim: claimDraft }), claim: pendingClaim, dom });
    assert.equal(await h.auth.check(), null);
    const claims = h.rpcCalls('request_studio_claim');
    assert.equal(claims.length, 1);
    assert.deepEqual({ ...claims[0][2] }, {
        p_studio_id: STUDIO_ID, p_evidence: claimDraft.evidence, p_contact_name: 'Ana', p_contact_phone: '+54 341 555'
    });
    const cleared = h.calls.find(c => c[0] === 'updateUser')[1].data;
    assert.equal(cleared.studio_claim, null);
    assert.equal(cleared.studio_registration, null, 'a filed claim supersedes any registration draft');
    const lookup = h.calls.find(c => c[0] === 'from' && c[1] === 'studio_claim_requests')[2];
    assert.deepEqual(lookup.filters, [['user_id', user.id]]);
    assert.equal(h.auth.getState().kind, 'claim_pending');
    assert.equal(h.window.location.href, '');
    assert.equal(dom.screen.hidden, false);
    assert.match(dom.screen.innerHTML, /Reclamo en revisión/);
    assert.match(dom.screen.innerHTML, /Te avisamos por email/);
    assert.match(dom.screen.innerHTML, /Black Ink/);
    assert.match(dom.screen.innerHTML, /Rosario · Argentina/);
    assert.ok(dom.hideables.every(el => el.hidden), 'login form and help are hidden');
    // A second check (dashboard boot) does not file the claim again.
    await h.auth.check();
    assert.equal(h.rpcCalls('request_studio_claim').length, 1);
});

test('a signed-in account claims right away without another signUp', async () => {
    const h = harness({ session: sessionWith({ studio_registration: { profile, locations } }), claim: pendingClaim });
    const state = await h.auth.claim({ studioId: STUDIO_ID, studio: catalogStudio, evidence: claimDraft.evidence, email: user.email });
    assert.equal(state.kind, 'claim_pending');
    assert.equal(state.claim.id, CLAIM_ID);
    assert.equal(h.calls.some(c => c[0] === 'signup'), false);
    assert.equal(h.rpcCalls('request_studio_claim').length, 1);
    assert.equal(h.rpcCalls('request_studio_claim')[0][2].p_contact_name, null);
    const cleared = h.calls.find(c => c[0] === 'updateUser')[1].data;
    assert.equal(cleared.studio_registration, null);
});

test('another open account cannot claim with a different email', async () => {
    const h = harness({ session: sessionWith() });
    await assert.rejects(h.auth.claim({ studioId: STUDIO_ID, evidence: claimDraft.evidence, email: 'otra@example.test' }), /otra cuenta abierta/);
    await assert.rejects(h.auth.claim({ studioId: STUDIO_ID, evidence: '   ' }), /Contanos cómo podemos verificar/);
    assert.equal(h.calls.some(c => c[0] === 'rpc'), false);
});

test('a pending claim blocks the registration draft and keeps the dashboard on the review screen', async () => {
    const dom = fakeDocument({ withScreen: false });
    const h = harness({ pathname: '/studio/dashboard', session: sessionWith({ studio_registration: { profile, locations } }), claim: pendingClaim, dom });
    assert.equal(await h.auth.check(), null);
    assert.equal(h.rpcCalls('complete_studio_registration').length, 0);
    assert.equal(h.window.location.href, '', 'no redirect to /studio/register?complete=1');
    const host = dom.created.find(el => el.tag === 'main');
    assert.ok(host, 'the dashboard gets its own claim card');
    assert.equal(dom.page.children[0], host);
    const screen = dom.created.find(el => el.id === 'studio-claim-screen');
    assert.equal(screen.className, 'studio-card');
    assert.match(screen.innerHTML, /Reclamo en revisión/);
    assert.match(screen.innerHTML, /href="\/studio\/profile\/\?studio=black-ink"/);
    assert.ok(dom.hideables.every(el => el.hidden), 'the panel shell is hidden');
    assert.equal(dom.listeners.length, 1, 'logout button wired');
    await dom.listeners[0]();
    assert.ok(h.calls.some(c => c[0] === 'signOut'));
});

test('a rejected claim shows the motive and the way to register a new studio', async () => {
    const rejected = { ...pendingClaim, status: 'rejected', decided_at: '2026-10-31T12:00:00Z', decision_note: 'No pudimos verificar <el> local' };
    const dom = fakeDocument({ withScreen: false });
    const h = harness({ pathname: '/studio/dashboard', session: sessionWith(), claim: rejected, dom });
    await h.auth.check();
    assert.equal(h.auth.getState().kind, 'claim_rejected');
    assert.equal(h.window.location.href, '');
    const screen = dom.created.find(el => el.id === 'studio-claim-screen');
    assert.match(screen.innerHTML, /No aprobamos tu reclamo/);
    assert.match(screen.innerHTML, /No pudimos verificar &lt;el&gt; local/);
    assert.match(screen.innerHTML, /href="\/studio\/register">Registrar un estudio nuevo/);
    assert.match(screen.innerHTML, /Rechazado/);

    // On the register page the wizard stays (studio-register.js shows a notice).
    const onRegister = fakeDocument();
    const r = harness({ pathname: '/studio/register', session: sessionWith(), claim: rejected, dom: onRegister });
    await r.auth.check();
    assert.equal((await r.auth.whenChecked()).kind, 'claim_rejected');
    assert.equal(onRegister.screen.innerHTML, '', 'no review screen over the wizard');
    assert.ok(onRegister.hideables.every(el => !el.hidden));
});

test('a rejected claim does not block a new registration', async () => {
    const rejected = { ...pendingClaim, status: 'rejected' };
    const h = harness({ pathname: '/studio/login', session: sessionWith({ studio_registration: { profile, locations } }), claim: rejected });
    const studio = await h.auth.check();
    assert.equal(studio.id, 'new-studio');
    assert.equal(h.window.location.href, '/studio/dashboard');
});

test('catalog-name refusal keeps the draft and sends the user to claim that studio', async () => {
    const h = harness({
        pathname: '/studio/login', session: sessionWith({ studio_registration: { profile, locations } }),
        rpc: { complete_studio_registration: { data: null, error: RECLAMALO } }
    });
    assert.equal(await h.auth.check(), null);
    const state = h.auth.getState();
    assert.equal(state.kind, 'claimable');
    assert.equal(state.name, 'Black Ink');
    assert.equal(h.window.location.href, '/studio/register?reclamar=1');
    assert.equal(h.calls.some(c => c[0] === 'updateUser'), false, 'the registration draft survives');

    const r = harness({
        pathname: '/beta/studio/register', session: sessionWith({ studio_registration: { profile, locations } }),
        rpc: { complete_studio_registration: { data: null, error: RECLAMALO } }
    });
    await r.auth.check();
    assert.equal(r.auth.getState().kind, 'claimable');
    assert.equal(r.window.location.href, '', 'the register page offers the claim in place');

    const d = harness({
        pathname: '/beta/studio/dashboard', session: sessionWith({ studio_registration: { profile, locations } }),
        rpc: { complete_studio_registration: { data: null, error: RECLAMALO } }
    });
    await d.auth.check();
    assert.equal(d.window.location.href, '/beta/studio/register?reclamar=1');
});

test('only the catalog refusal is treated as claimable', () => {
    const { auth } = harness();
    assert.equal(auth.isClaimableError(RECLAMALO), true);
    assert.equal(auth.isClaimableError({ message: RECLAMALO.message }), true);
    assert.equal(auth.isClaimableError({ code: '23505', message: 'duplicate key value violates unique constraint "studios_normalized_name_key"' }), false);
    assert.equal(auth.isClaimableError({ code: '42501', message: 'reclamalo' }), false);
    assert.equal(auth.isClaimableError(null), false);
});

test('a definitive claim refusal drops the signUp draft; transient failures keep it', async () => {
    const owned = { data: null, error: { code: '23514', message: 'Este estudio ya tiene dueño en We Ötzi.' } };
    const dom = fakeDocument();
    const h = harness({ pathname: '/studio/login', session: sessionWith({ studio_claim: claimDraft }), rpc: { request_studio_claim: owned }, dom });
    assert.equal(await h.auth.check(), null);
    const state = h.auth.getState();
    assert.equal(state.kind, 'claim_failed');
    assert.equal(state.error, 'Este estudio ya tiene dueño en We Ötzi.');
    const cleared = h.calls.filter(c => c[0] === 'updateUser');
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0][1].data.studio_claim, null);
    assert.match(dom.screen.innerHTML, /No pudimos enviar tu reclamo/);
    assert.match(dom.screen.innerHTML, /Este estudio ya tiene dueño en We Ötzi\./);

    const flaky = harness({
        pathname: '/studio/login', session: sessionWith({ studio_claim: claimDraft }),
        rpc: { request_studio_claim: { data: null, error: { message: 'Failed to fetch' } } }
    });
    assert.equal(await flaky.auth.check(), null);
    assert.equal(flaky.auth.getState().kind, 'error');
    assert.equal(flaky.calls.some(c => c[0] === 'updateUser'), false, 'the draft waits for a retry');

    const missing = harness({ pathname: '/studio/login', session: sessionWith({ studio_claim: claimDraft }), rpc: { request_studio_claim: { data: null, error: MISSING_FN } } });
    await missing.auth.check();
    assert.equal(missing.auth.getState().error, 'Esta función todavía no está disponible (falta aplicar una migración).');
    assert.equal(missing.calls.some(c => c[0] === 'updateUser'), false);
});

test('without the claim migration onboarding behaves exactly as before', async () => {
    const h = harness({ pathname: '/studio/dashboard', session: sessionWith(), claimError: { code: '42P01', message: 'relation "public.studio_claim_requests" does not exist' } });
    assert.equal(await h.auth.check(), null);
    assert.equal(h.auth.getState().kind, 'none');
    assert.equal(h.window.location.href, '/studio/register?complete=1');

    const legacy = harness({ pathname: '/studio/dashboard', session: sessionWith(), withoutClaimRepo: true });
    await legacy.auth.check();
    assert.equal(legacy.window.location.href, '/studio/register?complete=1');
    await assert.rejects(
        legacy.auth.claim({ studioId: STUDIO_ID, evidence: claimDraft.evidence }),
        /Esta función todavía no está disponible/
    );
});

test('login with a claim under review shows the review screen instead of failing', async () => {
    const dom = fakeDocument();
    const h = harness({ pathname: '/studio/login', loginSession: sessionWith(), claim: pendingClaim, dom });
    assert.equal(await h.auth.login(user.email, 'test-password'), null);
    assert.equal(h.auth.getState().kind, 'claim_pending');
    assert.match(dom.screen.innerHTML, /Reclamo en revisión/);

    const empty = harness({ pathname: '/studio/login', loginSession: sessionWith() });
    await assert.rejects(empty.auth.login(user.email, 'test-password'), /todavía no tiene un estudio/);

    const owner = harness({ pathname: '/studio/login', loginSession: sessionWith(), studio: { id: 'studio-id', name: 'Mío' } });
    assert.equal((await owner.auth.login(user.email, 'test-password')).id, 'studio-id');
});

test('claim screen escapes catalog data and keeps the beta prefix', () => {
    const h = harness({ pathname: '/beta/studio/login' });
    const html = h.auth.claimScreenHtml({
        kind: 'claim_pending',
        claim: { ...pendingClaim, studios: { ...catalogStudio, name: '<img src=x onerror=alert(1)>', slug: 'a b&c' } }
    });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /href="\/beta\/studio\/profile\/\?studio=a%20b%26c"/);
    assert.match(html, /30\/10\/2026|31\/10\/2026/);
    assert.match(html, /En revisión/);
    const failed = h.auth.claimScreenHtml({ kind: 'claim_failed', error: '<b>Ya tenés un reclamo</b>' });
    assert.match(failed, /&lt;b&gt;Ya tenés un reclamo&lt;\/b&gt;/);
    assert.match(failed, /href="\/beta\/studio\/register"/);
});

/* ------------------------------ registro (studio-register.js) ------------------------------ */

function registerHelpers() {
    const window = { WeotziData: {} };
    const context = { window, document: { addEventListener() {} }, console: { error() {}, warn() {} }, URL, setTimeout, clearTimeout };
    vm.runInNewContext(kitSource, context);
    vm.runInNewContext(registerSource, context);
    return window.WeOtziStudioRegister;
}

test('catalog results escape data, drop unsafe logos and flag the same-name studio', () => {
    const reg = registerHelpers();
    const rows = [
        { id: 'a', name: 'Otro <b>estudio</b>', city: 'Córdoba', country: 'Argentina', logo_image: 'javascript:alert(1)' },
        { id: 'b"x', name: 'Black Ínk', city: 'Rosario', country: null, logo_image: 'https://cdn.example.test/logo.png' }
    ];
    const sorted = reg.sortCatalogMatches(rows, 'black ink');
    assert.deepEqual([...sorted].map(r => r.id), ['b"x', 'a']);
    assert.equal(reg.findExactMatch(rows, '  BLACK   INK ').id, 'b"x');
    assert.equal(reg.findExactMatch(rows, 'Black'), null);
    const html = reg.renderCatalogResults(sorted, { query: 'black', matchName: 'Black Ink' });
    assert.doesNotMatch(html, /javascript:/);
    assert.doesNotMatch(html, /<b>estudio/);
    assert.match(html, /Otro &lt;b&gt;estudio&lt;\/b&gt;/);
    assert.match(html, /<img src="https:\/\/cdn\.example\.test\/logo\.png"/);
    assert.match(html, /data-claim-studio="b&quot;x"/);
    assert.match(html, />Es mi estudio</);
    assert.equal((html.match(/is-match/g) || []).length, 1);
    assert.match(html, /Mismo nombre que tu registro/);
    assert.match(html, /Rosario<\/small>/);
    assert.match(reg.renderCatalogResults([], { query: 'zz<' }), /No encontramos «zz&lt;» en el catálogo/);
    assert.equal(reg.renderCatalogResults([], { query: 'z' }), '');
});

test('the catalog search stays hidden while list_unowned_studios is unavailable', async () => {
    const reg = registerHelpers();
    assert.equal(await reg.catalogAvailable(null), false);
    assert.equal(await reg.catalogAvailable({}), false);
    assert.equal(await reg.catalogAvailable({ listUnownedStudios: async () => ({ data: [], error: null, unavailable: true }) }), false);
    assert.equal(await reg.catalogAvailable({ listUnownedStudios: async () => ({ data: null, error: { message: 'boom' } }) }), false);
    assert.equal(await reg.catalogAvailable({ listUnownedStudios: async () => { throw new Error('offline'); } }), false);
    assert.equal(await reg.catalogAvailable({ listUnownedStudios: async () => ({ data: [], error: null }) }), true);

    // With the real repo: the probe goes through the RPC and a missing function hides the search.
    const live = harness();
    assert.equal(await reg.catalogAvailable(live.data.Studios), true);
    assert.deepEqual({ ...live.rpcCalls('list_unowned_studios')[0][2] }, { p_query: 'we' });
    const missing = harness({ rpc: { list_unowned_studios: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } } });
    assert.equal(await reg.catalogAvailable(missing.data.Studios), false);
});

test('rejected claim notice on the register page names the studio and the motive', () => {
    const reg = registerHelpers();
    assert.equal(
        reg.rejectedClaimNotice({ decision_note: 'No coincide el Instagram', studios: { name: 'Black Ink' } }),
        'Soporte no aprobó tu reclamo de Black Ink. Motivo: No coincide el Instagram. Podés reclamar otro estudio o registrar uno nuevo.'
    );
    assert.equal(
        reg.rejectedClaimNotice({}),
        'Soporte no aprobó tu reclamo de tu estudio. Podés reclamar otro estudio o registrar uno nuevo.'
    );
});

/* ------------------------------------- markup ------------------------------------- */

test('register page hides the catalog search until it is available and hosts the claim panel', () => {
    const html = read('public/studio/register/index.html');
    assert.match(html, /<div class="studio-location-row studio-claim-search" id="claim-search" hidden>/);
    assert.match(html, /¿Tu estudio ya figura en We Ötzi\?/);
    assert.match(html, /<input type="search" id="claim-query"[^>]*maxlength="80"/);
    assert.match(html, /<section id="claim-panel"[^>]*hidden>/);
    assert.match(html, /<textarea id="claim-evidence"[^>]*maxlength="1000"/);
    assert.match(html, /<section class="studio-wizard" data-claim-hide>/);
    assert.match(html, /<section id="studio-claim-screen" class="studio-card"[^>]*hidden><\/section>/);
    // The claim panel sits outside the wizard steps, before the shared status and actions.
    assert.ok(html.indexOf('id="wizard-body"') < html.indexOf('id="claim-panel"'));
    assert.ok(html.indexOf('id="claim-panel"') < html.indexOf('id="wizard-status"'));
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    const at = file => scripts.indexOf('/shared/js/' + file);
    assert.ok(at('data/studios-repo.js') >= 0 && at('studio-admin-kit.js') > at('data/studios-repo.js'));
    assert.ok(at('studio-auth.js') > at('studio-admin-kit.js'));
    assert.ok(at('studio-register.js') > at('studio-auth.js'));
});

test('login page lets studio-auth.js swap the form for the claim screen', () => {
    const html = read('public/studio/login/index.html');
    assert.match(html, /<form id="studio-login-form" class="studio-form" novalidate data-claim-hide>/);
    assert.match(html, /<form id="studio-recovery-form" class="studio-form" hidden data-claim-hide>/);
    assert.match(html, /<div id="studio-claim-screen" aria-live="polite" hidden><\/div>/);
    // The recovery code looks up the first kicker/h2: the claim screen must come after them.
    assert.ok(html.indexOf('studio-claim-screen') > html.indexOf('class="studio-h2"'));
    assert.match(html, /const studio = await window\.WeOtziStudioAuth\.login\(email, password\);\s*if \(!studio\) \{/);
});

test('studio-register.js routes the catalog refusal and the claim through WeOtziStudioAuth', () => {
    assert.match(registerSource, /isClaimableError\?\.\(err\)/);
    assert.match(registerSource, /window\.WeOtziStudioAuth\.claim\(\{/);
    assert.match(registerSource, /auth\.whenChecked\(\)/);
    assert.doesNotMatch(registerSource, /\.from\(|\/rest\/v1|_supabase\.from/, 'data access only through WeotziData repos');
    assert.doesNotMatch(authSource, /\.from\(|\/rest\/v1/, 'studio-auth.js uses the Studios repo');
});
