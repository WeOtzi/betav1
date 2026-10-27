const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/artist/login/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/shared/js/artist-login.js'), 'utf8');

test('anonymous artist can reach Google and client login without activating an unavailable provider', () => {
    const extras = html.match(/<section class="wo-auth-extras"[\s\S]*?<\/section>/)?.[0];
    assert.ok(extras, 'the extra access choices should be available below the designed screen');
    assert.match(extras, /onclick="handleArtistGoogleLogin\(\)"/);
    assert.match(extras, /href="\/client\/login"/);
    assert.doesNotMatch(extras, /\bhidden\b/);
    assert.ok(html.indexOf('<section class="wo-auth-extras"') > html.indexOf('</main>'));
});

test('authenticated artist does not see anonymous-only extra login choices', () => {
    const ids = [
        'login-anonymous-view', 'recovery-view', 'login-authenticated-view',
        'auth-view-email', 'auth-view-kicker', 'auth-view-kicker-text',
        'auth-view-title', 'auth-view-subcopy', 'auth-view-progress-note',
        'auth-view-actions', 'wo-auth-extras'
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, {
        hidden: false, textContent: '', innerHTML: '', appendChild() {}
    }]));
    const context = {
        window: { CONFIG: {}, location: { pathname: '/artist/login', search: '' } },
        document: { getElementById: (id) => elements[id] || null, addEventListener() {}, createElement: () => ({}) },
        supabase: { createClient: () => ({ auth: {} }) },
        setTimeout, clearTimeout, console
    };
    vm.runInNewContext(script, context);
    vm.runInNewContext("renderAuthenticatedView({ email: 'artist@example.invalid', role: 'artist', progress: { isComplete: true } })", context);
    assert.equal(elements['wo-auth-extras'].hidden, true);
});
