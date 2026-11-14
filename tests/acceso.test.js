'use strict';
// Frente "acceso" (beta cerrada): registro sin fricción, bienvenida que llega
// siempre (sin bienvenidas masivas), recuperar contraseña y enlace mágico para
// artista, cliente y estudio, links vencidos y Términos del cliente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const acceso = require('../lib/acceso');
const { createHandlers, register } = require('../lib/routes/acceso');
const EC = require('../public/shared/js/email-confirmation.js');
const { TERMS_VERSION } = require('../lib/terms-acceptance');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-20T12:00:00Z');
const CONFIG = { cutoff: Date.parse('2026-11-15T00:00:00Z'), maxAgeDays: 30 };
const user = (raw = {}) => ({ id: 'u1', email: 'qa@example.invalid', raw: { email_confirmed_at: '2026-11-19T10:00:00Z', created_at: '2026-11-19T09:00:00Z', ...raw } });

// ---------------- ACC-04 · decisión de la bienvenida ----------------

test('ACC-04: la bienvenida sale para la cuenta nueva y confirmada con perfil', () => {
    const d = acceso.welcomeDecision({ user: user(), role: 'client', client: { user_id: 'u1' }, now: NOW, config: CONFIG });
    assert.deepEqual(d, { send: true, reason: 'eligible', eventId: 'client_registration_completed' });
    const a = acceso.welcomeDecision({ user: user(), role: 'artist', artist: { registration_status: 'pendiente de validacion' }, now: NOW, config: CONFIG });
    assert.equal(a.eventId, 'artist_registration_completed');
});

test('ACC-04: nunca a cuentas viejas (antes del corte o demasiado antiguas): sin bienvenidas masivas', () => {
    const old = acceso.welcomeDecision({ user: user({ created_at: '2026-09-21T00:00:00Z' }), role: 'client', client: {}, now: NOW, config: CONFIG });
    assert.equal(old.send, false);
    assert.equal(old.reason, 'before_cutoff');
    const stale = acceso.welcomeDecision({ user: user({ created_at: '2026-11-16T00:00:00Z' }), role: 'client', client: {}, now: NOW + 40 * DAY, config: CONFIG });
    assert.equal(stale.reason, 'too_old');
});

test('ACC-04: sin confirmar, sin perfil, registro incompleto o artista en modo cliente → no sale', () => {
    const base = { now: NOW, config: CONFIG };
    assert.equal(acceso.welcomeDecision({ ...base, user: user({ email_confirmed_at: null }), role: 'client', client: {} }).reason, 'email_not_confirmed');
    assert.equal(acceso.welcomeDecision({ ...base, user: user(), role: 'client', client: null }).reason, 'no_profile');
    assert.equal(acceso.welcomeDecision({ ...base, user: user(), role: 'artist', artist: null }).reason, 'no_profile');
    assert.equal(acceso.welcomeDecision({ ...base, user: user(), role: 'artist', artist: { registration_status: 'incompleto' } }).reason, 'registration_incomplete');
    assert.equal(acceso.welcomeDecision({ ...base, user: user(), role: 'client', client: {}, artist: { registration_status: 'aprobado' } }).reason, 'artist_account');
    assert.equal(acceso.welcomeDecision({ ...base, user: user(), role: 'admin', client: {} }).reason, 'bad_role');
    assert.equal(acceso.welcomeDecision({ ...base, user: null, role: 'client' }).reason, 'no_user');
});

test('ACC-04: la fecha de corte y la antigüedad se configuran por .env con valores seguros', () => {
    const def = acceso.welcomeConfig({});
    assert.equal(def.cutoff, Date.parse(acceso.DEFAULT_WELCOME_CUTOFF));
    assert.equal(def.maxAgeDays, 30);
    const custom = acceso.welcomeConfig({ WELCOME_EMAIL_CUTOFF: '2026-12-01T00:00:00Z', WELCOME_EMAIL_MAX_AGE_DAYS: '7' });
    assert.equal(custom.cutoff, Date.parse('2026-12-01T00:00:00Z'));
    assert.equal(custom.maxAgeDays, 7);
    const bad = acceso.welcomeConfig({ WELCOME_EMAIL_CUTOFF: 'mañana', WELCOME_EMAIL_MAX_AGE_DAYS: '-3' });
    assert.equal(bad.cutoff, Date.parse(acceso.DEFAULT_WELCOME_CUTOFF));
    assert.equal(bad.maxAgeDays, 30);
});

// ---------------- Rutas /api/account/welcome y /api/account/terms ----------------

function fakeRes() {
    return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function handlers(over = {}) {
    const sent = [];
    const stamped = [];
    const h = createHandlers({
        resolveUser: async () => ('user' in over ? over.user : user()),
        repo: {
            getArtistProfile: async () => over.artist || null,
            getClientProfile: async () => ('client' in over ? over.client : { user_id: 'u1' }),
            stampClientTerms: async (id, patch) => { stamped.push({ id, patch }); return { stored: true, already: false }; }
        },
        resolveEmailContext: async (req, eventId, input, deps) => {
            const u = await deps.resolveUser();
            return { ok: true, idempotencyKey: `registration:${u.id}`, payload: { email: u.email } };
        },
        sendEmail: async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return over.sendResult || { ok: true }; },
        now: () => NOW,
        config: () => CONFIG,
        log: () => {}
    });
    return { h, sent, stamped };
}

test('POST /api/account/welcome: idempotente por usuario (registration:<id>) y solo si corresponde', async () => {
    const { h, sent } = handlers();
    const res = fakeRes();
    await h.welcome({ body: { role: 'client' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].eventId, 'client_registration_completed');
    assert.equal(sent[0].options.idempotencyKey, 'registration:u1');

    const dedup = handlers({ sendResult: { ok: true, deduplicated: true } });
    const r2 = fakeRes();
    await dedup.h.welcome({ body: { role: 'client' } }, r2);
    assert.equal(r2.body.sent, false);
    assert.equal(r2.body.deduplicated, true);

    const old = handlers({ user: user({ created_at: '2026-01-01T00:00:00Z' }) });
    const r3 = fakeRes();
    await old.h.welcome({ body: { role: 'client' } }, r3);
    assert.equal(r3.body.sent, false);
    assert.equal(r3.body.reason, 'before_cutoff');
    assert.equal(old.sent.length, 0);
});

test('POST /api/account/welcome: 401 sin sesión y 400 con un rol inválido', async () => {
    const anon = handlers({ user: null });
    const r1 = fakeRes();
    await anon.h.welcome({ body: { role: 'client' } }, r1);
    assert.equal(r1.statusCode, 401);
    const { h } = handlers();
    const r2 = fakeRes();
    await h.welcome({ body: { role: 'superadmin' } }, r2);
    assert.equal(r2.statusCode, 400);
});

test('POST /api/account/terms: exige accepted:true, perfil de cliente y sella con la hora del servidor', async () => {
    const { h, stamped } = handlers();
    const r1 = fakeRes();
    await h.terms({ body: { accepted: 'true' } }, r1);
    assert.equal(r1.statusCode, 400);
    const r2 = fakeRes();
    await h.terms({ body: { accepted: true, terms_accepted_at: '2000-01-01' } }, r2);
    assert.equal(r2.statusCode, 200);
    assert.equal(stamped[0].patch.version, TERMS_VERSION);
    assert.equal(stamped[0].patch.acceptedAt, new Date(NOW).toISOString(), 'ignora cualquier fecha que mande el navegador');
    const noClient = handlers({ client: null });
    const r3 = fakeRes();
    await noClient.h.terms({ body: { accepted: true } }, r3);
    assert.equal(r3.statusCode, 409);
});

test('register() monta las dos rutas con limitador y server.js lo registra en una línea antes del 404', () => {
    const routes = [];
    register({ post: (p, ...fns) => routes.push([p, fns.length]) }, { limiter: (req, res, next) => next() });
    assert.deepEqual(routes, [['/api/account/welcome', 2], ['/api/account/terms', 2]]);
    const server = read('server.js');
    const at = server.indexOf("require('./lib/routes/acceso').register(app)");
    assert.ok(at > 0);
    assert.ok(at < server.indexOf("app.listen("));
    assert.ok(at < server.indexOf("return res.status(404).send('Not Found')"));
});

test('artista que pasa a modo cliente hereda su aceptación de Términos (dato del servidor)', () => {
    assert.equal(acceso.termsFromArtist(null), null);
    assert.equal(acceso.termsFromArtist({ terms_accepted_at: null }), null);
    assert.deepEqual(acceso.termsFromArtist({ terms_accepted_at: '2026-11-14T00:00:00Z', terms_version: 'v1' }), { acceptedAt: '2026-11-14T00:00:00Z', version: 'v1' });
    assert.match(read('services/account-modes.js'), /await carryArtistTermsToClient\(user\.id\)/);
});

// ---------------- wo-welcome.js (front) ----------------

function loadWelcome({ path: pathname = '/client/dashboard', session, storage = new Map() } = {}) {
    const calls = [];
    const context = {
        console, Promise, JSON, setTimeout,
        window: {
            location: { pathname },
            sessionStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
            fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ success: true, sent: true }) }; },
            _supabase: { auth: { getSession: async () => ({ data: { session } }) } }
        }
    };
    context.globalThis = context.window;
    vm.runInNewContext(read('public/shared/js/wo-welcome.js'), context);
    return { api: context.window.WoWelcome, calls, storage };
}

test('wo-welcome: pide la bienvenida una vez por pestaña, con Bearer y solo con email confirmado', async () => {
    const session = { access_token: 'tok', user: { id: 'u1', email_confirmed_at: '2026-11-19T10:00:00Z' } };
    const w = loadWelcome({ session });
    await w.api.request('client');
    await w.api.request('client');
    assert.equal(w.calls.length, 1);
    assert.equal(w.calls[0].url, '/api/account/welcome');
    assert.equal(w.calls[0].opts.headers.Authorization, 'Bearer tok');
    assert.equal(JSON.parse(w.calls[0].opts.body).role, 'client');

    const unconfirmed = loadWelcome({ session: { access_token: 't', user: { id: 'u2', email_confirmed_at: null } } });
    await unconfirmed.api.request('client');
    assert.equal(unconfirmed.calls.length, 0);
    assert.equal(w.api.roleForPath('/artist/dashboard'), 'artist');
    assert.equal(w.api.roleForPath('/client/login'), null);
});

test('wo-welcome se carga en los dos paneles y en login/registro de cliente', () => {
    for (const page of ['public/artist/dashboard/index.html', 'public/client/dashboard/index.html', 'public/client/login/index.html', 'public/client/register/index.html']) {
        assert.match(read(page), /\/shared\/js\/wo-welcome\.js/, page);
    }
    // El envío sin sesión (401 + toast falso) ya no existe en la rama "confirmá tu email".
    const reg = read('public/shared/js/register.js');
    const branch = reg.slice(reg.indexOf('if (finalizeData.email_confirmation_required) {'), reg.indexOf("goToStep('success');", reg.indexOf('if (finalizeData.email_confirmation_required) {')));
    assert.doesNotMatch(branch, /sendArtistRegistrationCompletedEvent\(/);
});

// ---------------- ACC-17 · links vencidos ----------------

test('ACC-17: parseAuthLinkError lee el hash y la query de Supabase', () => {
    const e = EC.parseAuthLinkError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '');
    assert.equal(e.code, 'otp_expired');
    assert.equal(e.expired, true);
    assert.match(e.description, /invalid or has expired/);
    const q = EC.parseAuthLinkError('', '?error=server_error&error_description=boom');
    assert.equal(q.error, 'server_error');
    assert.equal(q.expired, false);
    assert.equal(EC.parseAuthLinkError('#access_token=x&type=recovery', '?recovery=1'), null);
    assert.equal(EC.parseAuthLinkError('', ''), null);
    const copy = EC.linkErrorCopy(e, { what: 'link de acceso' });
    assert.match(copy.title, /venció o ya se usó/);
    assert.match(copy.text, /antivirus/);
});

test('ACC-17: todas las páginas destino manejan el link vencido', () => {
    assert.match(read('public/shared/js/artist-login.js'), /showArtistLinkError\(/);
    assert.match(read('public/shared/js/client-auth.js'), /showClientLinkError\(linkError\)/);
    assert.match(read('public/shared/js/register.js'), /enlace=vencido/);
    assert.match(read('public/client/register/index.html'), /explainConfirmationReturn\(\)/);
    assert.match(read('public/shared/js/recover.js'), /showLinkError\(linkError\)/);
    assert.match(read('public/shared/js/studio-login.js'), /renderLinkErrorNotice\(status/);
    const recover = read('public/recover/index.html');
    assert.match(recover, /id="rc-link-notice"/);
    assert.ok(recover.indexOf('/shared/js/email-confirmation.js') < recover.indexOf('/shared/js/recover.js'));
    const studio = read('public/studio/login/index.html');
    assert.ok(studio.indexOf('/shared/js/email-confirmation.js') < studio.indexOf('/shared/js/studio-auth.js'), 'email-confirmation antes de studio-auth');
    // Con el link de recuperación vencido el estudio no entra a "Nueva contraseña".
    assert.match(read('public/shared/js/studio-auth.js'), /const recoveryMode = !linkError &&/);
});

// ---------------- ACC-02 / ACC-11 / ER-17 · enlace mágico ----------------

test('ACC-11: "Signups not allowed for otp" responde igual que el éxito (anti-enumeración)', () => {
    const neutral = EC.magicLinkOutcome({ message: 'Signups not allowed for otp' }, 'a<b>@x.com');
    assert.equal(neutral.ok, true);
    assert.match(neutral.message, /Si a&lt;b&gt;@x\.com tiene una cuenta/);
    assert.equal(EC.magicLinkOutcome(null, 'a@x.com').ok, true);
    assert.equal(EC.magicLinkOutcome({ code: 'otp_disabled' }, 'a@x.com').ok, true);
    const rate = EC.magicLinkOutcome({ status: 429, message: 'rate limit' }, 'a@x.com');
    assert.equal(rate.ok, false);
    assert.match(rate.message, /Esperá un minuto/);
    assert.equal(EC.magicLinkOutcome({ message: 'Failed to fetch' }, 'a@x.com').ok, false);
    assert.match(read('public/shared/js/artist-login.js'), /artistMagicLinkOutcome\(error, email\)/);
});

test('ACC-01/02/13: login de cliente con recuperar contraseña, enlace mágico, Facebook y aviso legal', () => {
    const html = read('public/client/login/index.html');
    assert.match(html, /class="ca-forgot" onclick="handlePasswordRecovery\(event\)"/);
    assert.match(html, /id="btn-client-magic-link" onclick="handleClientMagicLink\(\)"/);
    assert.match(html, /onclick="handleClientFacebookLogin\(\)"/);
    assert.match(html, /href="\/legal\/terms"[\s\S]*href="\/legal\/privacy"/);
    const src = read('public/shared/js/client-auth.js');
    const magic = src.slice(src.indexOf('async function handleClientMagicLink'), src.indexOf('async function handleGoogleLogin'));
    assert.match(magic, /shouldCreateUser: false/);
    assert.match(magic, /emailRedirectTo: clientAuthRedirectUrl\(\)/);
    assert.match(src, /provider: 'facebook'/);
    assert.match(read('public/shared/css/client-login-figma.css'), /\.ca-forgot\{[^}]*min-height:44px/);
});

test('ACC-02: handleClientMagicLink manda el OTP sin crear cuentas y responde neutro', async () => {
    const otpCalls = [];
    const els = {
        'login-email': { value: ' Persona@Example.com ', focus() {} },
        'form-message': { innerHTML: '', className: '', style: {} },
        'btn-client-magic-link': { disabled: false, setAttribute() {}, removeAttribute() {} }
    };
    const context = {
        console, URLSearchParams, Promise, JSON,
        localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
        sessionStorage: { getItem: () => null, removeItem() {}, setItem() {} },
        document: { addEventListener() {}, getElementById: (id) => els[id] || null, querySelector: () => null },
        supabase: { createClient: () => ({ auth: { signInWithOtp: async (args) => { otpCalls.push(args); return { error: { message: 'Signups not allowed for otp' } }; } } }) },
        window: { location: { pathname: '/client/login', search: '?returnTo=/store/checkout/', hash: '', origin: 'https://beta.weotzi.com' }, WeotziEmailConfirm: EC }
    };
    vm.runInNewContext(read('public/shared/js/client-auth.js'), context);
    await context.handleClientMagicLink();
    assert.equal(otpCalls.length, 1);
    assert.equal(otpCalls[0].email, 'persona@example.com');
    assert.equal(otpCalls[0].options.shouldCreateUser, false);
    assert.equal(otpCalls[0].options.emailRedirectTo, 'https://beta.weotzi.com/client/login?returnTo=%2Fstore%2Fcheckout%2F');
    assert.match(els['form-message'].className, /success/);
    assert.match(els['form-message'].innerHTML, /Si persona@example\.com tiene una cuenta/);
});

test('ER-17: el login de estudios tiene enlace mágico que nunca crea cuentas', () => {
    assert.match(read('public/studio/login/index.html'), /id="studio-magic-link"/);
    const auth = read('public/shared/js/studio-auth.js');
    assert.match(auth, /signInWithOtp\(\{\s*email: clean,\s*options: \{ shouldCreateUser: false, emailRedirectTo: window\.location\.origin \+ appUrl\('\/studio\/login'\) \}/);
    assert.match(auth, /sendMagicLink: sendStudioMagicLink/);
    assert.match(read('public/shared/js/studio-login.js'), /auth\.sendMagicLink\(emailInput\.value\)/);
});

// ---------------- ACC-08 · Términos del cliente ----------------

test('ACC-08: el registro de cliente exige Términos y los manda al signUp', () => {
    const html = read('public/client/register/index.html');
    assert.match(html, /<input type="checkbox" id="cw-terms" required>/);
    assert.match(html, /href="\/legal\/terms"[^>]*>Términos y Condiciones/);
    assert.match(html, /if \(!accountUserId && !state\.termsAccepted\)/);
    assert.match(html, /termsAccepted: state\.termsAccepted === true/);
    const src = read('public/shared/js/client-auth.js');
    assert.match(src, /if \(payload\.termsAccepted !== true\)/);
    assert.match(src, /terms_accepted: true/);
    assert.match(src, /await recordClientTerms\(session, \{ onlyIfPending: true \}\)/);
});

test('migración 20261115100000: handle_new_user sin artistas OAuth, Términos del cliente y guard', () => {
    const name = '20261115100000_acceso_handle_new_user_terminos_cliente';
    const sql = read(`supabase/migrations/${name}.sql`);
    assert.match(sql, /add column if not exists terms_accepted_at timestamptz/);
    assert.match(sql, /create trigger trg_guard_client_terms_acceptance\s+before insert or update on public\.clients_db/);
    assert.match(sql, /AND \(signup_provider = 'email' OR signup_type = 'artist' OR signup_role = 'artist'\)/);
    assert.match(sql, /CASE WHEN terms_ok THEN now\(\) END/);
    assert.match(sql, new RegExp(`current_terms_version constant text := '${TERMS_VERSION}'`), 'misma versión que lib/terms-acceptance.js');
    assert.doesNotMatch(sql, /delete\s+from\s+public\.artists_db/i, 'nunca borra artistas (el trigger borraría la cuenta de Auth)');
    const down = read(`supabase/rollbacks/${name}.down.sql`);
    assert.match(down, /drop column if exists terms_accepted_at/);
    assert.match(down, /create or replace function public\.handle_new_user\(\)/);
    assert.doesNotMatch(down, /signup_provider/);
});

// ---------------- ACC-07 / ACC-14 ----------------

test('ACC-07: la marca qa_unverified_email solo para cuentas autoconfirmadas', () => {
    const server = read('server.js');
    assert.match(server, /app_metadata: \{ registration_draft_id: draftId, \.\.\.\(confirmationRequired \? \{\} : \{ qa_unverified_email: true \}\) \}/);
    const { shouldClear } = require('../scripts/ops/clear-qa-flag');
    assert.equal(shouldClear({ email_confirmed_at: 'x', app_metadata: { qa_unverified_email: true, registration_draft_id: 'd' } }), true);
    assert.equal(shouldClear({ email_confirmed_at: null, app_metadata: { qa_unverified_email: true, registration_draft_id: 'd' } }), false);
    assert.equal(shouldClear({ email_confirmed_at: 'x', app_metadata: { qa_unverified_email: true } }), false, 'clientes de prueba quedan igual');
});

test('ACC-14: /inicio ofrece ingresar o crear cuenta de cliente, con respaldo sin :has()', () => {
    const html = read('public/inicio/index.html');
    const client = html.slice(html.indexOf('data-for="client"'), html.indexOf('data-for="studio"'));
    assert.match(client, /href="\/client\/login\/"[^>]*>Ya tengo cuenta/);
    assert.match(client, /href="\/client\/register\/"[^>]*>Crear cuenta/);
    assert.match(read('public/inicio/inicio.js'), /actions\.dataset\.selected = selected/);
    assert.match(read('public/inicio/inicio.css'), /\.inicio-actions\[data-selected="client"\] \.inicio-actions-group\[data-for="client"\]/);
});
