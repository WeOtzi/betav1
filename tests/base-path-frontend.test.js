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

test('el acordeón de registro deja un solo grupo abierto a la vez', () => {
    assert.match(mainJs, /function appUrl\(/);
    const registerJs = fs.readFileSync(
        path.resolve(__dirname, '..', 'public', 'shared', 'js', 'register.js'),
        'utf8'
    );

    // renderGroups() es el único que decide visibilidad: el panel se muestra
    // solo para el grupo activo y la sección solo si está activa o completada.
    assert.match(registerJs, /function renderGroups/);
    assert.match(registerJs, /panel\.hidden\s*=\s*!isActive/);
    assert.match(registerJs, /section\.hidden\s*=\s*!isActive\s*&&\s*!isDone/);
});

test('el registro por Instagram no muestra el primer grupo antes de resolver la sesión', () => {
    // El markup arranca con todos los paneles ocultos, así que no hay flash del
    // grupo 01 mientras se resuelve el auth async.
    // Cada grupo arranca cerrado: o la sección entera está oculta, o su panel.
    const sections = registerArtistHtml.split('<section class="ra-group').slice(1);
    assert.ok(sections.length >= 8, `esperaba las secciones del acordeón, encontré ${sections.length}`);
    for (const section of sections) {
        const openTag = section.slice(0, section.indexOf('>'));
        const panelTag = section.slice(section.indexOf('<div class="ra-panel'));
        const panelOpen = panelTag.slice(0, panelTag.indexOf('>'));
        const group = (openTag.match(/data-group="([^"]+)"/) || [])[1] || '?';
        assert.ok(
            /hidden/.test(openTag) || /hidden/.test(panelOpen),
            `el grupo ${group} arranca abierto`
        );
    }
    // La entrada alterna ?source=instagram sigue existiendo y se evalúa antes
    // de esperar a Supabase, para poder abrir el grupo IG en el primer render.
    assert.match(registerArtistHtml, /data-group="ig"[^>]*hidden/);
    const registerJs = fs.readFileSync(
        path.resolve(__dirname, '..', 'public', 'shared', 'js', 'register.js'),
        'utf8'
    );
    assert.match(registerJs, /function isInstagramSignup/);
    const igCheck = registerJs.indexOf('const igSignupPreAuth = isInstagramSignup()');
    const authCall = registerJs.indexOf('await _supabase.auth.getSession()', igCheck);
    assert.notEqual(igCheck, -1, 'falta la detección temprana del alta por Instagram');
    assert.ok(igCheck < authCall, 'el origen Instagram debe resolverse antes del await de sesión');
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
