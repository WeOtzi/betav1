const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'main.js'),
    'utf8'
);
const registerArtistHtml = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'register-artist', 'index.html'),
    'utf8'
);
const quotationsJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'quotations.js'),
    'utf8'
);
const calendarJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'calendar.js'),
    'utf8'
);
const dashboardJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'dashboard.js'),
    'utf8'
);
const artistLoginJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'artist-login.js'),
    'utf8'
);
const quotationFormJs = fs.readFileSync(
    path.resolve(__dirname, '..', 'public', 'shared', 'js', 'script.js'),
    'utf8'
);

test('landing social login redirects preserve the active app base path', () => {
    assert.match(mainJs, /function appUrl\(/);
    assert.doesNotMatch(mainJs, /window\.location\.href\s*=\s*['"]\/register-artist/);
    assert.match(mainJs, /window\.location\.href\s*=\s*appUrl\(buildDraftWizardUrl\('/);
    assert.match(mainJs, /window\.location\.href\s*=\s*appUrl\(targetUrl\)/);
    assert.doesNotMatch(mainJs, /signInWithOAuth/);
});

test('registration wizard clears all active steps before activating a target step', () => {
    assert.match(mainJs, /function appUrl\(/);
    const registerJs = fs.readFileSync(
        path.resolve(__dirname, '..', 'public', 'shared', 'js', 'register.js'),
        'utf8'
    );

    assert.ok(registerJs.includes("querySelectorAll('.form-step.active')"));
    assert.ok(registerJs.includes('activeSteps.forEach'));
});

test('instagram registration source activates the IG step before async auth finishes', () => {
    assert.match(registerArtistHtml, /new URLSearchParams\(window\.location\.search\)\.get\('source'\) === 'instagram'/);
    assert.ok(registerArtistHtml.includes("document.querySelector('.form-step[data-step=\"0\"]')?.classList.add('active')"));
    assert.ok(registerArtistHtml.includes("label.textContent = 'IG / 11'"));
});

test('artist workspace redirects stay on the active app host and base path', () => {
    assert.match(quotationsJs, /function appUrl\(/);
    assert.match(calendarJs, /function appUrl\(/);
    assert.doesNotMatch(quotationsJs, /https:\/\/beta\.weotzi\.com\/registerclosedbeta/);
    assert.doesNotMatch(quotationsJs, /window\.location\.href\s*=\s*['"]dashboard\.html/);
    assert.doesNotMatch(calendarJs, /window\.location\.href\s*=\s*['"](?:index|dashboard)\.html/);
    assert.match(quotationsJs, /window\.location\.href\s*=\s*buildArtistLoginUrl\('\/my-quotations'\)/);
    assert.match(calendarJs, /window\.location\.href\s*=\s*buildArtistLoginUrl\('\/calendar'\)/);
});

test('artist dashboard accepts existing artist rows before profile completion', () => {
    const authResolverCall = dashboardJs.match(/resolveArtistAuthState\(\{[\s\S]*?\}\);/);

    assert.ok(authResolverCall, 'Dashboard should resolve artist auth before loading data');
    assert.doesNotMatch(authResolverCall[0], /requireCompleteProfile\s*:\s*true/);
    assert.match(authResolverCall[0], /returnTo:\s*'\/artist\/dashboard'/);
    assert.match(dashboardJs, /authState\.status === 'authenticated_non_artist'/);
});

test('artist login sends existing artist sessions to the dashboard', () => {
    assert.doesNotMatch(artistLoginJs, /PERFIL INCOMPLETO/);
    assert.match(artistLoginJs, /returnTo\s*\|\|\s*'\/artist\/dashboard'/);
    assert.match(artistLoginJs, /withArtistLoginTimeout/);
});

test('quotation form uses a database-accepted source value by default', () => {
    assert.match(quotationFormJs, /source:\s*formData\.quotation_source\s*\|\|\s*'web_chat'/);
    assert.doesNotMatch(quotationFormJs, /source:\s*formData\.quotation_source\s*\|\|\s*'web'/);
});
