// Figma final del flujo de artista (oct 2026) · área "acceso"
// Bienvenida, login, crear cuenta, registro 01-08, recuperar acceso, loader
// post-auth y correos de recuperación.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const core = require('../public/shared/js/acceso-register-final.js');
const extras = require('../public/shared/js/data/registration-extras-repo.js');

// ------------------------------------------------------------ lógica pura

test('el panel "Todos los estilos" cruza la taxonomía del Figma con el catálogo', () => {
    const groups = core.buildStyleGroups([
        { name: 'Fine line', parent_id: null, sort_order: 1 },
        { name: 'Nordico / Viking', parent_id: null, sort_order: 2 },
        { name: 'Estilo raro', parent_id: null, sort_order: 3 }
    ]);
    const titles = groups.map((g) => g.title);
    assert.equal(titles[0], 'Realismo');
    assert.ok(titles.includes('Fine Line y Minimalismo'));
    // El valor persistido es el nombre del catálogo aunque la etiqueta tenga tildes.
    const fine = groups.find((g) => g.title === 'Fine Line y Minimalismo').main[0];
    assert.equal(fine.label, 'Fine Line');
    assert.equal(fine.value, 'Fine line');
    assert.equal(fine.inCatalog, true);
    const viking = groups.find((g) => g.title === 'Tribal y cultural').subs.find((c) => c.label === 'Nórdico / Viking');
    assert.equal(viking.value, 'Nordico / Viking');
    // Lo que no está en la taxonomía cae en "Otros estilos".
    const others = groups[groups.length - 1];
    assert.equal(others.title, 'Otros estilos');
    assert.deepEqual(others.main.map((c) => c.value), ['Estilo raro']);
    // Sin coincidencia en el catálogo, se guarda la etiqueta.
    const irezumi = groups.find((g) => g.title === 'Japonés').subs[0];
    assert.equal(irezumi.value, 'Irezumi');
    assert.equal(irezumi.inCatalog, false);
});

test('la búsqueda del panel ignora tildes y oculta categorías vacías', () => {
    const groups = core.buildStyleGroups([]);
    const result = core.filterStyleGroups(groups, 'japon');
    assert.deepEqual(result.map((g) => g.title), ['Japonés', 'Anime e ilustrativo'].filter((t) => result.some((g) => g.title === t)));
    assert.ok(result.every((g) => g.main.concat(g.subs).every((c) => core.normalizeKey(c.label).includes('japon'))));
    assert.deepEqual(core.filterStyleGroups(groups, ''), groups);
    assert.equal(core.filterStyleGroups(groups, 'zzzz').length, 0);
});

test('los archivos del portfolio aceptan JPG/PNG/WebP de hasta 10 MB', () => {
    assert.equal(core.validatePortfolioFile({ type: 'image/png', size: 1024 }).ok, true);
    assert.equal(core.validatePortfolioFile({ type: 'image/jpeg', size: 10 * 1024 * 1024 }).ok, true);
    assert.equal(core.validatePortfolioFile({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }).reason, 'size');
    assert.equal(core.validatePortfolioFile({ type: 'application/pdf', size: 10 }).reason, 'pdf');
    assert.equal(core.validatePortfolioFile({ type: 'image/gif', size: 10 }).reason, 'type');
});

test('el plan de pasos del preview cubre los 8 frames del registro', () => {
    assert.deepEqual(core.previewStepPlan('1'), { group: 'quien' });
    assert.deepEqual(core.previewStepPlan(4), { group: 'presencia' });
    assert.deepEqual(core.previewStepPlan('7'), { screen: 'summary' });
    assert.deepEqual(core.previewStepPlan('8'), { screen: 'success' });
    assert.equal(core.previewStepPlan('9'), null);
    assert.equal(core.previewStepPlan('x'), null);
});

test('el usuario de Instagram se normaliza desde @, URL o texto', () => {
    assert.equal(core.normalizeInstagramHandle('@luumarth'), 'luumarth');
    assert.equal(core.normalizeInstagramHandle('https://www.instagram.com/luumarth/?hl=es'), 'luumarth');
    assert.equal(core.normalizeInstagramHandle('  luu.marth  '), 'luu.marth');
});

test('los extras del registro arman un patch limpio para artists_db', () => {
    const patch = extras.buildExtrasPatch({
        website_url: ' https://luumarth.com ',
        behance_url: '',
        other_url: null,
        newsletter_topics: ['avisos', 'spam', 'avisos', 'recursos']
    });
    assert.deepEqual(patch, {
        profile_links: { website: 'https://luumarth.com', behance: null, other: null },
        newsletter_topics: ['avisos', 'recursos']
    });
    assert.equal(extras.isMissingColumnError({ code: '42703' }), true);
    assert.equal(extras.isMissingColumnError({ code: 'PGRST204' }), true);
    assert.equal(extras.isMissingColumnError({ code: '23505' }), false);
});

// ------------------------------------------------------------ páginas

test('bienvenida usa el copy del Figma 797:269 y preselecciona por ?role=', () => {
    const html = read('public/bienvenida/index.html');
    assert.match(html, /¡Bienvenido!<br>¿Cómo querés usar We Ötzi\?/);
    assert.match(html, /Podrás cambiar esta experiencia en cualquier momento desde la configuración de tu cuenta\./);
    const js = read('public/shared/js/bienvenida.js');
    assert.match(js, /function roleFromQuery/);
    assert.match(js, /function appPath/);
});

test('login: Instagram · Email · Facebook, sin Google ni recuperación embebida', () => {
    const html = read('public/artist/login/index.html');
    assert.match(html, /Bienvenida de nuevo/);
    assert.match(html, /data-social="instagram"/);
    assert.match(html, /data-social="email"/);
    assert.match(html, /data-social="facebook"/);
    assert.doesNotMatch(html, /handleArtistGoogleLogin|recovery-view|¿Sos cliente\?/);
    assert.match(html, /wo-postauth-loader\.js/);
    const js = read('public/shared/js/artist-login.js');
    assert.match(js, /signInWithOtp/);
    assert.match(js, /provider: 'facebook'/);
    assert.match(js, /variant: 'v1'/);
    assert.match(js, /loader: 'v2'/);
    assert.match(js, /Continuá desde tu panel de artista/);
    // ?state=login solo en preview/demo.
    assert.match(js, /params\.get\('state'\) === 'login' && isPreviewContext\(\)/);
});

test('crear cuenta: sin topbar, copy corregido y Facebook vía /artist/login', () => {
    const html = read('public/registerclosedbeta/index.html');
    assert.doesNotMatch(html, /wo-beta-topbar|dashboard-mobile-menu|login-modal/);
    assert.match(html, /Creá tu cuenta/);
    assert.match(html, /Empezá hoy como artista\./);
    assert.match(html, /Tu próximo<\/span>/);
    assert.match(html, /Está acá/);
    assert.match(html, /Seleccioná tu estilo principal/);
    assert.match(html, /¿Ya tenés cuenta\?/);
    const main = read('public/shared/js/main.js');
    assert.match(main, /function handleFacebookSignup/);
    assert.match(main, /\/artist\/login\?/);
    assert.doesNotMatch(main, /signInWithOAuth/);
    assert.match(main, /window\.WEOTZI_PREVIEW !== true/);
});

test('registro: Behance, portfolio y panel de estilos del Figma final', () => {
    const html = read('public/register-artist/index.html');
    assert.match(html, /data-link="behance"/);
    assert.match(html, /id="behance_url"/);
    assert.match(html, /Agregar desde Instagram/);
    assert.match(html, /Subir manualmente/);
    // La galería solo publica imágenes: el copy y el accept no prometen PDF.
    assert.match(html, /JPG, PNG o WebP · hasta 10 MB cada uno\./);
    assert.doesNotMatch(html, /JPG, PNG o PDF/);
    assert.match(html, /id="ra-works-file" accept="image\/jpeg,image\/png,image\/webp"/);
    assert.match(html, /Conectar Instagram/);
    assert.match(html, /Tus trabajos/);
    assert.match(html, /acceso-register-final\.js/);
    assert.match(html, /registration-extras-repo\.js/);
    const js = read('public/shared/js/register.js');
    assert.match(js, /const STYLES_VISIBLE_COUNT = 10;/);
    assert.match(js, /'behance_url'/);
    assert.match(js, /'newsletter_topics'/);
    assert.match(js, /function redirectAfterRegistration/);
    assert.match(js, /variant: 'v3'/);
    // El prefill ya no borra los estilos cuando el grid todavía no existe.
    assert.match(js, /renderedStyleBtns\.length > 0/);
    const finalJs = read('public/shared/js/acceso-register-final.js');
    assert.match(finalJs, /root\.WEOTZI_PREVIEW === true/);
});

test('recuperar acceso: copy del Figma y ?step= solo en preview', () => {
    const html = read('public/recover/index.html');
    assert.match(html, /Ingresá tu email y te mandamos un código para restablecer tu contraseña\./);
    assert.doesNotMatch(html, /reestablecer/);
    assert.match(html, /¡Contraseña actualizada!/);
    assert.match(html, /Ya podés iniciar sesión con tu nueva contraseña\./);
    assert.match(html, />Iniciar sesión</);
    assert.match(html, /rc-step-line/);
    const js = read('public/shared/js/recover.js');
    assert.match(js, /isPreviewContext\(\) && previewStep >= 1 && previewStep <= 4/);
});

test('loader post-auth: diseño único para v1/v2/v3 y QA solo en preview', () => {
    const js = read('public/shared/js/wo-postauth-loader.js');
    assert.match(js, /Organizando tu agenda…/);
    assert.match(js, /WE ÖTZI/);
    assert.match(js, /\^v\[123\]\$/);
    assert.match(js, /!isPreviewContext\(\)/);
});

// ------------------------------------------------------------ backend y correos

test('la migración del registro es aditiva, idempotente y tiene reversa', () => {
    const up = read('supabase/migrations/20261028100000_acceso_registro_extras.sql');
    assert.match(up, /ADD COLUMN IF NOT EXISTS profile_links jsonb/);
    assert.match(up, /ADD COLUMN IF NOT EXISTS newsletter_topics text\[\]/);
    assert.doesNotMatch(up, /DROP\s+(TABLE|COLUMN)/i);
    const down = read('supabase/rollbacks/20261028100000_acceso_registro_extras.down.sql');
    assert.match(down, /DROP COLUMN IF EXISTS profile_links/);
    assert.match(down, /DROP COLUMN IF EXISTS newsletter_topics/);
});

test('las plantillas de recuperación usan las variables correctas', () => {
    const recovery = read('templates/email/supabase-recovery.html');
    assert.match(recovery, /\{\{ \.Token \}\}/);
    assert.match(recovery, /\{\{ \.ConfirmationURL \}\}/);
    assert.match(recovery, /Recuperá tu acceso/);
    assert.match(recovery, /Este código vence en 10 minutos\./);
    const updated = read('templates/email/password-updated.html');
    for (const variable of ['nombre', 'fecha', 'hora', 'zona_horaria', 'login_url', 'recover_url', 'año']) {
        assert.ok(updated.includes(`{{${variable}}}`), `falta {{${variable}}}`);
    }
    assert.match(updated, /Tu contraseña se actualizó/);
    const supa = read('templates/email/supabase-password-changed.html');
    assert.match(supa, /\{\{ \.Email \}\}/);
    assert.doesNotMatch(supa, /\{\{(nombre|fecha|hora)\}\}/);
});

// ------------------------------------------------------------ correcciones de auditoría (ronda 1)

test('registro 05: el gate exige elegir o crear el estudio (801:1095)', () => {
    const js = read('public/shared/js/register.js');
    // isGroupReady('trabajo') usa la misma regla que el aviso del gate.
    const gate = js.slice(js.indexOf("case 'trabajo': {"), js.indexOf("case 'novedades':"));
    assert.match(gate, /isStudioSelectionResolved\(\)/);
    assert.match(js, /function isStudioSelectionResolved\(\)/);
    const resolved = js.slice(js.indexOf('function isStudioSelectionResolved()'));
    assert.match(resolved.slice(0, 1400), /if \(formState\.data\.studio_id\) return true;/);
    assert.match(resolved.slice(0, 1400), /return studioAddressRequired && hasAddress;/);
    // validateStep(9) también lo exige (no solo el botón deshabilitado).
    assert.match(js, /Elegí tu estudio de la lista o creá uno nuevo\./);
    // Hasta 5 estudios y "Crear «x»" siempre al pie.
    assert.match(js, /const STUDIO_SUGGESTIONS_LIMIT = 5;/);
    assert.match(js, /studioSuggestionsCache\.slice\(0, STUDIO_SUGGESTIONS_LIMIT\)/);
    // TU DIRECCIÓN muestra la ubicación guardada al reanudar (801:1094).
    assert.match(js, /function syncAddressInputFromState\(\)/);
});

test('registro: flechas Feather, links legales unificados y CTA final sin desborde', () => {
    const html = read('public/register-artist/index.html');
    assert.doesNotMatch(html, /<span aria-hidden="true">→<\/span>/);
    assert.match(html, /id="ra-success-cta">Ir a tu panel <i data-wo-icon="arrow-right"/);
    assert.match(html, /href="\/legal\/terms"[^>]*>Términos y Condiciones/);
    assert.match(html, /href="\/legal\/privacy"[^>]*>Política de Privacidad/);
    assert.doesNotMatch(html, /href="\/terminos"|href="\/privacidad"/);
    assert.match(html, /class="ra-hint wo-sr-only" id="address-picker-help"/);
    const css = read('public/shared/css/register-artist-ds.css');
    assert.match(css, /#ra-success-cta\{box-sizing:border-box;height:44px;max-width:100%\}/);
    assert.match(css, /body\.register-page \.form-input::placeholder/);
    assert.match(css, /body\.igi-open \.ra-topbar\{z-index:0\}/);
    assert.match(css, /min-height:47px;height:47px/);
    const signup = read('public/registerclosedbeta/index.html');
    assert.match(signup, /href="\/legal\/terms"/);
});

test('login: Instagram abre el inicio rápido y Facebook usa el logo del Figma', () => {
    const js = read('public/shared/js/artist-login.js');
    assert.doesNotMatch(js, /El ingreso directo con Instagram todavía no está disponible/);
    assert.match(js, /appPath\('\/register-artist\/\?source=instagram'\)/);
    const svg = read('public/artist/login/assets/facebook.svg');
    assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
    assert.doesNotMatch(svg, /<script|on\w+=/i);
    for (const page of ['public/artist/login/index.html', 'public/registerclosedbeta/index.html']) {
        const html = read(page);
        assert.match(html, /src="\/artist\/login\/assets\/facebook\.svg"/, page);
        assert.doesNotMatch(html, /data-wo-icon="facebook"/, page);
    }
    assert.match(read('public/shared/css/artist-auth-ds.css'), /\.wo-app \.wo-auth-input::placeholder/);
});

test('crear cuenta: validación propia, botón sin estilos inline y sesión activa → /artist/login', () => {
    const html = read('public/registerclosedbeta/index.html');
    assert.match(html, /onsubmit="handleRegistration\(event\)" novalidate/);
    assert.doesNotMatch(html, /id="active-session-note"/);
    const main = read('public/shared/js/main.js');
    const handler = main.slice(main.indexOf('async function handleRegistration('), main.indexOf('async function handleContinueRegistration('));
    assert.doesNotMatch(handler, /btn\.style|'ERROR'/);
    assert.match(handler, /setRegisterButtonState\(btn, ''\)/);
    assert.match(main, /function validateBetaForm\(/);
    assert.match(main, /Para seguir, aceptá los términos y condiciones\./);
    assert.match(main, /window\.location\.replace\(appUrl\('\/artist\/login'/);
    assert.doesNotMatch(main, /function renderActiveSessionBanner/);
    const css = read('public/shared/css/registerclosedbeta-ds.css');
    assert.match(css, /\.wo-beta-submit\.is-busy/);
    assert.match(css, /@media \(max-width:1279px\)\{\s*\.wo-auth-poster-eyebrow\{top:76px/);
});

test('recuperar acceso: redirectTo con appPath y email de destino en peso regular', () => {
    const js = read('public/shared/js/recover.js');
    assert.match(js, /redirectTo: window\.location\.origin \+ appPath\('\/recover\?recovery=1'\)/);
    assert.doesNotMatch(js, /window\.WEOTZI_BASE_PATH \|\| ''/);
    const css = read('public/shared/css/recover-ds.css');
    assert.match(css, /#rc-code-email\{font-weight:var\(--weight-regular\)/);
    assert.match(css, /\.wo-app \.rc-inputwrap \.wo-input::placeholder/);
});

test('correos de recuperación: el círculo de la marca es una celda del mismo tamaño', () => {
    for (const file of ['supabase-recovery.html', 'password-updated.html', 'supabase-password-changed.html']) {
        const html = read(`templates/email/${file}`);
        assert.doesNotMatch(html, /&#9679;/, file);
        assert.match(html, /background:#F2B519;border-radius:50%/, file);
    }
    assert.match(read('templates/email/supabase-recovery.html'), /margin:0 0 100px;[^>]*>Recibimos una solicitud/);
});

// ------------------------------------------------------------ correcciones de auditoría (ronda 2)

test('portfolio: los mensajes de validación nombran los mismos formatos que la card', () => {
    const html = read('public/register-artist/index.html');
    const hint = html.match(/class="ra-portfolio-choice-hint">(JPG[^<]+)</)[1];
    const accept = html.match(/id="ra-works-file" accept="([^"]+)"/)[1].split(',');
    for (const mime of accept) {
        assert.equal(core.validatePortfolioFile({ type: mime, size: 10 }).ok, true, mime);
    }
    const pdf = core.validatePortfolioFile({ type: 'application/pdf', size: 10 });
    const gif = core.validatePortfolioFile({ type: 'image/gif', size: 10 });
    for (const msg of [pdf.message, gif.message]) {
        assert.match(msg, /JPG, PNG o WebP/);
        assert.ok(hint.startsWith('JPG, PNG o WebP'), hint);
    }
});

test('registro 05/07: medidas del Figma (ronda 2)', () => {
    const css = read('public/shared/css/register-artist-ds.css');
    const r2 = css.slice(css.indexOf('Correcciones de auditoría (ronda 2)'));
    // 07 · Revisión: valor en x+140 (sin gap entre columnas) y layout apilado en mobile.
    assert.match(r2, /@media \(min-width:769px\)\{\s*\.summary-row\{grid-template-columns:140px minmax\(0,1fr\) auto;column-gap:0\}/);
    assert.match(r2, /@media \(max-width:768px\)\{\s*\.summary-row\{grid-template-columns:minmax\(0,1fr\) auto/);
    // 05 · Tarjetas de 84.2px (padding 18.6 + borde de 1px) y elegida sin sombra.
    assert.match(r2, /\.work-type-option\{min-height:0;padding:18\.6px;gap:6px;background:transparent;border:var\(--border-hairline\) solid var\(--ink\)\}/);
    assert.match(r2, /\.work-type-option\.selected\{box-shadow:none\}/);
    // TU DIRECCIÓN: 1px + sombra 3px y 8px entre etiqueta y campo.
    assert.match(r2, /\.address-picker-wrapper > \.ra-label,\s*\.studio-location-select-wrapper > \.ra-label\{display:block;margin-bottom:8px\}/);
    assert.match(r2, /\.address-picker-wrapper #address_search\{[^}]*border:var\(--border-hairline\) solid var\(--neutral-500\)/);
    assert.match(r2, /#address_search\.has-value,\s*\.address-picker-wrapper #address_search:focus\{box-shadow:3px 3px 0 var\(--neutral-500\)\}/);
    // 05 · Buscar estudio: lista sobre arena y CONTINUAR deshabilitado de 46px.
    assert.match(r2, /\.studio-suggestions\{background:var\(--surface-input\)\}/);
    assert.match(r2, /\.ra-group\[data-group="trabajo"\] \.ra-continue:disabled\{height:46px;min-height:46px;padding:0 22px;gap:12px;font-size:13px/);
});
