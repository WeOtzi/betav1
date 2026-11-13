'use strict';
// Ronda 3c · confirmación de email: el código funciona con "Confirm email"
// DESACTIVADO (hoy) y ACTIVADO (mañana) sin asumir el modo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const EC = require('../public/shared/js/email-confirmation.js');
const lib = require('../lib/email-confirmation');

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
        dump: () => Object.fromEntries(data)
    };
}

// ---------------- Frontend: lógica pura ----------------

test('needsConfirmation: user sin session = falta confirmar; con session = modo autoconfirm', () => {
    assert.equal(EC.needsConfirmation({ user: { id: 'u1' }, session: null }), true);
    assert.equal(EC.needsConfirmation({ user: { id: 'u1' }, session: { access_token: 'x' } }), false);
    assert.equal(EC.needsConfirmation({ user: null, session: null }), false);
    assert.equal(EC.needsConfirmation(null), false);
});

test('isExistingAccountSignup detecta el usuario ofuscado (identities vacío)', () => {
    assert.equal(EC.isExistingAccountSignup({ user: { id: 'u', identities: [] } }), true);
    assert.equal(EC.isExistingAccountSignup({ user: { id: 'u', identities: [{ provider: 'email' }] } }), false);
    assert.equal(EC.isExistingAccountSignup({ user: { id: 'u' } }), false);
});

test('isEmailNotConfirmedError reconoce el código y el mensaje de Supabase', () => {
    assert.equal(EC.isEmailNotConfirmedError({ code: 'email_not_confirmed' }), true);
    assert.equal(EC.isEmailNotConfirmedError({ message: 'Email not confirmed' }), true);
    assert.equal(EC.isEmailNotConfirmedError({ message: 'Invalid login credentials' }), false);
    assert.equal(EC.isEmailNotConfirmedError(null), false);
});

test('reenviar: cuenta regresiva de 60 s y mensajes en español', () => {
    assert.equal(EC.cooldownLeft(0, 1000), 0);
    assert.equal(EC.cooldownLeft(1000, 1000), 60);
    assert.equal(EC.cooldownLeft(1000, 1000 + 59500), 1);
    assert.equal(EC.cooldownLeft(1000, 1000 + 61000), 0);
    assert.match(EC.resendErrorMessage({ status: 429 }), /Esperá un minuto/);
    assert.match(EC.resendErrorMessage({ code: 'over_email_send_rate_limit' }), /Esperá/);
    assert.match(EC.resendErrorMessage({ message: 'boom' }), /No pudimos reenviar/);
});

test('redirectUrl arma la URL absoluta con base path y parámetros', () => {
    assert.equal(
        EC.redirectUrl('/client/register/', { confirmado: '1', returnTo: '' }, { origin: 'https://beta.weotzi.com', basePath: '' }),
        'https://beta.weotzi.com/client/register/?confirmado=1'
    );
    assert.equal(
        EC.redirectUrl('/job-board/request/', { confirmado: '1' }, { origin: 'http://localhost:4672', basePath: '/preview/x' }),
        'http://localhost:4672/preview/x/job-board/request/?confirmado=1'
    );
    assert.equal(
        EC.redirectUrl('/client/register/', { returnTo: '/store/checkout' }, { origin: 'https://a.b', basePath: '' }),
        'https://a.b/client/register/?returnTo=%2Fstore%2Fcheckout'
    );
});

test('progreso pendiente: nunca guarda la contraseña y vence a los 7 días', () => {
    const store = memoryStorage();
    assert.equal(EC.savePending('k', { email: 'a@b.co', password: 'secreta', savedAt: 1000 }, store), true);
    const raw = JSON.stringify(store.dump());
    assert.doesNotMatch(raw, /secreta/);
    assert.equal(EC.readPending('k', store, 2000).email, 'a@b.co');
    assert.equal(EC.readPending('k', store, 1000 + EC.PENDING_MAX_AGE_MS + 1), null);
    assert.equal(store.getItem('weotzi_email_confirm:k'), null);
    EC.savePending('k2', { email: 'x@y.co' }, store);
    EC.clearPending('k2', store);
    assert.equal(EC.readPending('k2', store), null);
});

test('resend llama a auth.resend type signup con emailRedirectTo', async () => {
    const calls = [];
    const client = { auth: { resend: async (p) => { calls.push(p); return { data: {}, error: null }; } } };
    const ok = await EC.resend(client, ' Ana@Mail.com ', 'https://x/y?confirmado=1');
    assert.equal(ok.ok, true);
    assert.deepEqual(calls[0], { type: 'signup', email: 'ana@mail.com', options: { emailRedirectTo: 'https://x/y?confirmado=1' } });
    const limited = await EC.resend({ auth: { resend: async () => ({ error: { status: 429, message: 'rate limit' } }) } }, 'a@b.co');
    assert.equal(limited.ok, false);
    assert.match(limited.message, /Esperá/);
    const missing = await EC.resend({ auth: {} }, 'a@b.co');
    assert.equal(missing.ok, false);
});

// ---------------- Servidor: lib/email-confirmation ----------------

test('el modo sale de /auth/v1/settings; desconocido = exigir confirmación', () => {
    assert.equal(lib.resolveConfirmationRequired({ settings: { mailer_autoconfirm: true } }), false);
    assert.equal(lib.resolveConfirmationRequired({ settings: { mailer_autoconfirm: false } }), true);
    assert.equal(lib.resolveConfirmationRequired({ settings: null }), true);
    assert.equal(lib.resolveConfirmationRequired({ mode: 'disabled', settings: { mailer_autoconfirm: false } }), false);
    assert.equal(lib.resolveConfirmationRequired({ mode: 'required', settings: { mailer_autoconfirm: true } }), true);
    assert.deepEqual(lib.adminCreateConfirmFields(true), { email_confirm: false });
    assert.deepEqual(lib.adminCreateConfirmFields(false), { email_confirm: true });
});

test('createConfirmationModeReader cachea la respuesta y cae a "exigir" si falla', async () => {
    let calls = 0;
    let t = 0;
    const reader = lib.createConfirmationModeReader({
        fetchImpl: async (url) => { calls++; assert.match(url, /\/auth\/v1\/settings$/); return { ok: true, json: async () => ({ mailer_autoconfirm: true }) }; },
        supabaseUrl: 'https://p.supabase.co/', apiKey: 'k', now: () => t, ttlMs: 1000
    });
    assert.equal(await reader(), false);
    assert.equal(await reader(), false);
    assert.equal(calls, 1);
    t = 2000;
    await reader();
    assert.equal(calls, 2);

    const failing = lib.createConfirmationModeReader({ fetchImpl: async () => { throw new Error('offline'); }, supabaseUrl: 'x', apiKey: 'k' });
    assert.equal(await failing(), true);
    const forced = lib.createConfirmationModeReader({ fetchImpl: async () => { throw new Error('no debe llamarse'); }, mode: 'disabled' });
    assert.equal(await forced(), false);
});

test('sendSignupConfirmation hace POST /auth/v1/resend con redirect_to', async () => {
    let seen;
    const ok = await lib.sendSignupConfirmation({
        fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200 }; },
        supabaseUrl: 'https://p.supabase.co', apiKey: 'anon', email: 'Ana@Mail.com',
        redirectTo: 'https://beta.weotzi.com/register-artist/?confirmado=1'
    });
    assert.equal(ok.ok, true);
    assert.equal(seen.url, 'https://p.supabase.co/auth/v1/resend?redirect_to=' + encodeURIComponent('https://beta.weotzi.com/register-artist/?confirmado=1'));
    assert.deepEqual(JSON.parse(seen.init.body), { type: 'signup', email: 'ana@mail.com' });
    assert.equal(seen.init.headers.apikey, 'anon');
    const bad = await lib.sendSignupConfirmation({ fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ msg: 'rate' }) }), supabaseUrl: 'x', apiKey: 'k', email: 'a@b.co' });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 429);
});

// ---------------- Cableado (estático) ----------------

test('ningún signUp del navegador asume sesión inmediata', () => {
    const client = read('public/shared/js/client-auth.js');
    assert.match(client, /if \(!authData\.session\) \{[\s\S]*pendingEmailConfirmation: true/);
    assert.match(client, /emailRedirectTo: clientConfirmRedirectUrl\(\)/);
    const jb = read('public/shared/js/job-board-request.js');
    assert.match(jb, /authData\.user && !authData\.session[\s\S]*enterJBPendingConfirmation/);
    assert.match(jb, /emailRedirectTo: jbConfirmRedirectUrl\(\)/);
    const studio = read('public/shared/js/studio-auth.js');
    assert.match(studio, /if \(!data\.session\) return \{ confirmationRequired: true/);
    // El alta de soporte ya no hace signUp desde el navegador (va por el servidor).
    const admin = read('public/shared/js/admin.js');
    assert.doesNotMatch(admin, /\.auth\.signUp\(/);
    assert.match(admin, /email_confirmation_required/);
});

test('el wizard del cliente guarda el progreso y lo retoma al volver del link', () => {
    const html = read('public/client/register/index.html');
    assert.match(html, /id="cw-confirm"/);
    assert.match(html, /pendingConfirmation: pendingConfirmation/);
    assert.match(html, /EC\.stashFiles\(PHOTO_STASH_KEY/);
    assert.match(html, /resumeAfterConfirmation\(\)/);
    assert.match(read('public/shared/js/client-auth.js'), /WO_CLIENT_REGISTER_RESUME/);
});

test('el servidor crea artistas y soporte según el modo y envía la confirmación', () => {
    const server = read('server.js');
    assert.doesNotMatch(server, /email_confirm:\s*true/);
    assert.match(server, /adminCreateConfirmFields\(confirmationRequired\)/);
    assert.match(server, /adminCreateConfirmFields\(supportConfirmationRequired\)/);
    assert.match(server, /email_confirmation_required: Boolean\(emailConfirmationRequired\)/);
    assert.match(server, /sendServerSignupConfirmation\(req, email, 'artist'\)/);
    const reg = read('public/shared/js/register.js');
    assert.match(reg, /if \(finalizeData\.email_confirmation_required\) \{/);
    assert.match(reg, /await resumeArtistAfterEmailConfirmation\(\)/);
    assert.equal(lib.CONFIRM_REDIRECT_PATHS.artist, '/register-artist/?confirmado=1');
});

test('los logins muestran "Confirmá tu email" con reenviar', () => {
    for (const f of ['client-auth.js', 'artist-login.js', 'studio-login.js', 'job-board-request.js', 'main.js', 'support-login.js', 'script.js']) {
        assert.match(read('public/shared/js/' + f), /isEmailNotConfirmedError/, f);
    }
    const pages = {
        'public/client/login/index.html': 'client-auth.js',
        'public/client/register/index.html': 'client-auth.js',
        'public/quotation/index.html': 'client-auth.js',
        'public/job-board/request/index.html': 'job-board-request.js',
        'public/register-artist/index.html': 'register.js',
        'public/artist/login/index.html': 'artist-login.js',
        'public/studio/login/index.html': 'studio-login.js',
        'public/support/login/index.html': 'support-login.js',
        'public/registerclosedbeta/index.html': 'main.js'
    };
    for (const [page, script] of Object.entries(pages)) {
        const html = read(page);
        const ec = html.indexOf('/shared/js/email-confirmation.js');
        const target = html.indexOf('/shared/js/' + script);
        assert.ok(ec !== -1, page + ' incluye email-confirmation.js');
        assert.ok(ec < target, page + ': email-confirmation.js antes de ' + script);
    }
    assert.ok(fs.existsSync(path.join(root, 'public/shared/css/email-confirmation.css')));
});
