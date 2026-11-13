// Revisión del registro de tatuadores (12 nov 2026) · grupo registro-pasos
// Páginas 3 a 10: fecha de nacimiento, contraseñas, catálogo de estilos y
// monedas, presencia con prefijos y editor, importador IG, estudio nuevo,
// errores del envío y reanudar el registro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const core = require('../public/shared/js/acceso-register-final.js');
const catalog = require('../public/register-artist/catalogo-registro.js');

// ------------------------------------------------------------ catálogo (páginas 5 y 6)

test('el catálogo local tiene los 3 grupos y los estilos exactos de la revisión', () => {
    assert.deepEqual(catalog.STYLE_GROUPS.map((g) => g.title), [
        'Estilos principales',
        'Subestilos y especialidades',
        'Estilos y tendencias contemporáneas en auge'
    ]);
    assert.deepEqual(catalog.STYLE_GROUPS.map((g) => g.styles.length), [30, 52, 27]);
    const all = catalog.STYLE_GROUPS.flatMap((g) => g.styles);
    for (const name of ['Tradicional Americano (Old School)', 'Ignorant Style', 'Ilusión Óptica (3D)', 'Freehand Abstract', 'Bordado (Embroidery Tattoo)']) {
        assert.ok(all.includes(name), name);
    }
    assert.equal(catalog.STYLE_GROUPS[0].styles[0], 'Realismo');
    assert.equal(catalog.STYLE_GROUPS[2].styles[0], 'Cibersigilismo (Cybersigilism)');
});

test('las monedas son solo las de los países del listado de Crear cuenta', () => {
    const fromCountries = new Set(catalog.COUNTRIES.flatMap((c) => c.currencies));
    const codes = catalog.CURRENCIES.map((c) => c.code);
    assert.equal(catalog.COUNTRIES.length, 32);
    assert.deepEqual(new Set(codes), fromCountries);
    for (const legacy of ['BOB', 'PYG', 'RUB', 'TRY', 'HUF', 'CZK']) assert.ok(!codes.includes(legacy), legacy);
    assert.equal(core.currencyForCountry('Argentina'), 'ARS');
    assert.equal(core.currencyForCountry('españa'), 'EUR');
    assert.equal(core.currencyForCountry('JP'), 'JPY');
    assert.equal(core.currencyForCountry('Atlántida'), '');
});

test('el catálogo del servidor se normaliza con el mismo formato (styleGroups / currencies)', () => {
    const groups = core.normalizeStyleGroups([
        { title: 'Grupo A', styles: ['Uno', { name: 'Dos' }, ''] },
        { name: 'Vacío', items: [] },
        { label: 'Grupo B', chips: [{ label: 'Tres' }] }
    ]);
    assert.deepEqual(groups.map((g) => [g.title, g.styles]), [['Grupo A', ['Uno', 'Dos']], ['Grupo B', ['Tres']]]);
    assert.equal(core.normalizeStyleGroups(null), null);
    assert.equal(core.normalizeStyleGroups([]), null);
    const currencies = core.normalizeCurrencies(['ars', { code: 'EUR', name: 'Euro' }, 'XX', 'ARS']);
    assert.deepEqual(currencies.map((c) => c.code), ['ARS', 'EUR']);
    assert.equal(currencies[0].name, 'Peso argentino');
    assert.equal(core.normalizeCurrencies('nope'), null);
});

test('la respuesta real de /api/registration/catalogs coincide con el respaldo local', () => {
    let backend;
    try { backend = require('../lib/registration-catalogs.js'); } catch (_) { backend = null; }
    if (!backend || typeof backend.getRegistrationCatalogs !== 'function') return; // backend todavía sin el endpoint
    const parsed = core.parseCatalogPayload({ success: true, ...backend.getRegistrationCatalogs() });
    assert.deepEqual(parsed.styleGroups.map((g) => g.styles), catalog.STYLE_GROUPS.map((g) => g.styles));
    assert.deepEqual(new Set(parsed.currencies.map((c) => c.code)), new Set(catalog.CURRENCIES.map((c) => c.code)));
    assert.ok(parsed.currencies.every((c) => c.region && c.region !== 'Otras'));
    // Los alias del servidor (lista rápida y valores históricos) también canonicalizan.
    const groups = core.buildStyleGroups([], parsed.styleGroups);
    assert.deepEqual(core.canonicalizeStyles(['Japonés', 'Tradicional americano'], groups, parsed.aliases),
        ['Tradicional Japonés (Irezumi)', 'Tradicional Americano (Old School)']);
});

test('los estilos de Crear cuenta y de borradores viejos se llevan al nombre del catálogo', () => {
    const groups = core.buildStyleGroups([{ name: 'Fine line' }]);
    assert.deepEqual(
        core.canonicalizeStyles(['Tradicional americano', 'Japonés', 'Lettering / Caligrafía', 'Fine Line', 'fine line', 'Mi estilo'], groups),
        ['Tradicional Americano (Old School)', 'Tradicional Japonés (Irezumi)', 'Lettering', 'Fine line', 'Mi estilo']
    );
    assert.equal(core.findStyleChip('irezumi', groups).label, 'Tradicional Japonés (Irezumi)');
    assert.equal(core.findStyleChip('Kintsugi', groups), null);
});

test('la vista alfabética no agrupa ni repite y ordena con reglas del español', () => {
    const chips = core.alphabeticalChips(core.buildStyleGroups([]));
    assert.equal(chips.length, 109);
    const labels = chips.map((c) => c.label);
    assert.deepEqual(labels.slice().sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })), labels);
    assert.equal(new Set(chips.map((c) => c.key)).size, chips.length);
});

test('el grupo 03 muestra primero los elegidos y después los estilos principales', () => {
    const groups = core.buildStyleGroups([]);
    const chips = core.stepStyleChips(['Mi estilo', 'Blackwork'], groups, 10);
    assert.equal(chips[0].name, 'Mi estilo');
    assert.equal(chips[1].name, 'Blackwork');
    assert.ok(chips[0].selected && chips[1].selected && !chips[2].selected);
    assert.equal(chips.filter((c) => c.name === 'Blackwork').length, 1);
    assert.equal(chips.filter((c) => !c.extra).length, 10);
});

// ------------------------------------------------------------ fecha (página 3)

test('la fecha de nacimiento va de hoy − 100 años a hoy − 18 años', () => {
    assert.deepEqual(core.birthDateBounds(new Date(2026, 10, 12)), { min: '1926-11-12', max: '2008-11-12' });
    // 29 de febrero: el máximo es el 28 (todavía no cumplió 18 el 1 de marzo).
    assert.deepEqual(core.birthDateBounds(new Date(2028, 1, 29)), { min: '1928-02-29', max: '2010-02-28' });
    const html = read('public/register-artist/index.html');
    assert.match(html, /<input type="date" id="birth_date"/);
    const js = read('public/shared/js/register.js');
    assert.match(js, /function applyBirthDateBounds\(\)/);
    assert.match(js, /input\.min = bounds\.min;/);
    assert.match(js, /input\.max = bounds\.max;/);
    assert.match(js, /birthDateWithinBounds\(iso\)/);
});

// ------------------------------------------------------------ enlaces (página 7)

test('los enlaces con prefijo fijo se guardan normalizados como antes', () => {
    assert.equal(core.websiteFromInput('tusitio.com'), 'https://tusitio.com');
    assert.equal(core.websiteFromInput('https://tusitio.com/obra'), 'https://tusitio.com/obra');
    assert.equal(core.websiteFromInput('http://tusitio.com'), 'https://tusitio.com');
    assert.equal(core.websiteFromInput('   '), '');
    assert.equal(core.websiteToInput('https://tusitio.com'), 'tusitio.com');
    assert.equal(core.behanceFromInput('valen'), 'behance.net/valen');
    assert.equal(core.behanceFromInput('https://www.behance.net/valen'), 'behance.net/valen');
    assert.equal(core.behanceToInput('behance.net/valen'), 'valen');
    assert.equal(core.normalizeInstagramHandle('@valen.ink'), 'valen.ink');
    assert.equal(core.isValidWebsite('https://tusitio.com'), true);
    assert.equal(core.isValidWebsite('https://tusitio'), false);
    assert.equal(core.isValidWebsite('https://tu sitio.com'), false);
});

test('presencia: solo Instagram activo, prefijos del DS y editor de 2000 caracteres', () => {
    const html = read('public/register-artist/index.html');
    assert.match(html, /class="link-toggle is-active" data-link="instagram" aria-pressed="true"/);
    for (const link of ['website', 'behance', 'other']) {
        assert.match(html, new RegExp(`class="link-toggle" data-link="${link}" aria-pressed="false"`), link);
        assert.match(html, new RegExp(`data-link-field="${link}" hidden`), link);
    }
    assert.match(html, /<div class="wo-prefixed" data-prefix="@">\s*<input type="text" id="instagram_handle"/);
    assert.match(html, /<div class="wo-prefixed" data-prefix="https:\/\/">\s*<input type="text" inputmode="url" id="portfolio_url"/);
    assert.match(html, /<div class="wo-prefixed" data-prefix="behance\.net\/">\s*<input type="text" id="behance_url"/);
    const js = read('public/shared/js/register.js');
    assert.match(js, /window\.WoRichText\.mount\(textarea, \{ maxLength: BIO_MAX_LENGTH \}\)/);
    assert.match(js, /const BIO_MAX_LENGTH = 2000;/);
    assert.match(js, /core\.websiteFromInput\(siteInput\.value\)/);
    assert.match(js, /core\.behanceFromInput\(behanceInput\.value\)/);
});

// ------------------------------------------------------------ contraseñas (página 4)

test('"Repetir contraseña" va a la derecha de "Contraseña" en desktop y apilado en móvil', () => {
    const css = read('public/shared/css/register-artist-ds.css');
    assert.match(css, /\.ra-fields--access \.ig-preauth-only\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
    assert.match(css, /\.ig-preauth-only\[hidden\]\{display:none\}/);
    const js = read('public/shared/js/register.js');
    assert.match(js, /el\.hidden = !preAuth;/);
    assert.doesNotMatch(js, /el\.style\.display = preAuth \? 'block' : 'none'/);
});

// ------------------------------------------------------------ animaciones (página 3)

test('las animaciones de entrada usan .wo-enter-stagger del DS (con reduced-motion)', () => {
    const js = read('public/shared/js/register.js');
    assert.match(js, /function playPanelEntrance\(panel\)/);
    assert.match(js, /panel\.classList\.add\('wo-enter-stagger'\)/);
    const ds = read('public/shared/css/ds/components.css');
    if (ds.includes('.wo-enter-stagger')) {
        assert.match(ds, /@media \(prefers-reduced-motion:reduce\)\{\.wo-enter,\.wo-enter-stagger>\*\{animation:none\}\}/);
    }
});

// ------------------------------------------------------------ panel de estilos (página 5)

test('panel de estilos: pie al final (no sticky), vista A–Z y "Otro" con aviso', () => {
    const css = read('public/shared/css/register-artist-ds.css');
    const tail = css.slice(css.indexOf('Revisión del registro (12 nov 2026)'));
    assert.match(tail, /\.ra-styles-foot\{position:static\}/);
    assert.match(tail, /\.ra-styles-group\{border-bottom:0/);
    const js = read('public/shared/js/acceso-register-final.js');
    assert.match(js, /data-styles-view="alpha"/);
    assert.match(js, /\/api\/registration\/catalogs/);
    assert.match(js, /btn\.textContent = 'Otro';/);
    const html = read('public/register-artist/index.html');
    assert.match(html, /Un estilo propio puede afectar tu ratio de descubrimiento: te recomendamos sumar también algún estilo de la lista\./);
    assert.match(html, /<script src="\/register-artist\/catalogo-registro\.js"><\/script>\s*<script src="\/shared\/js\/register\.js"><\/script>/);
    // Monedas estáticas de respaldo = las del catálogo.
    const select = html.slice(html.indexOf('id="session_currency"'), html.indexOf('</select>', html.indexOf('id="session_currency"')));
    const codes = Array.from(select.matchAll(/value="([A-Z]{3})"/g)).map((m) => m[1]);
    assert.deepEqual(new Set(codes), new Set(catalog.CURRENCIES.map((c) => c.code)));
});

// ------------------------------------------------------------ Instagram (página 8)

test('importador IG: sin "Publicaciones a buscar", hasta 50, aviso de verificación y re-importar', () => {
    const js = read('public/shared/js/instagram-import.js');
    assert.doesNotMatch(js, /PUBLICACIONES A BUSCAR|id="igi-limit"/);
    assert.match(js, /const FETCH_LIMIT = 50;/);
    assert.match(js, /no van a ser visibles en tu perfil hasta que validemos tu identidad y que la cuenta es tuya/);
    assert.match(js, /preselectPermalinks/);
    assert.match(js, /SELECCIONAR TODAS/);
    const finalJs = read('public/shared/js/acceso-register-final.js');
    assert.equal(core.IG_SIGNUP_MAX_POSTS, 50);
    assert.match(finalJs, /max: IG_SIGNUP_MAX_POSTS/);
    assert.match(finalJs, /function reimportInstagram\(\)/);
    const html = read('public/register-artist/index.html');
    assert.match(html, /id="ra-works-reimport"/);
    assert.match(html, /id="ra-works-ig-note"/);
});

// ------------------------------------------------------------ estudio nuevo (página 9)

test('estudio nuevo: aviso en el paso 05 y link de alta en "Perfil creado"', () => {
    const html = read('public/register-artist/index.html');
    assert.match(html, /id="studio-new-notice"/);
    assert.match(html, /Un representante del estudio tiene que completar el alta en We Ötzi\./);
    assert.match(html, /no figura como ubicación verificada en tu perfil/);
    assert.match(html, /id="ra-studio-claim"[^>]*hidden/);
    assert.match(html, /id="ra-studio-claim-copy"/);
    const js = read('public/shared/js/register.js');
    assert.match(js, /renderStudioClaim\(finalizeData\.studio_claim_url, finalizeData\.studio_claim_expires_at\)/);
    assert.match(js, /if \(!hasStudioClaim\)/, 'con link de alta no redirige solo');
    assert.match(js, /return Boolean\(name && !formState\.data\.studio_id && studioAddressRequired\);/);
});

// ------------------------------------------------------------ errores del envío (página 10)

test('el error del envío muestra el detalle real y permite reintentar', () => {
    const server = core.describeSubmitError(Object.assign(new Error('No se pudo finalizar el registro'), {
        status: 500, serverMessage: 'No se pudo finalizar el registro', detail: 'studio_artist_memberships: conflicto'
    }));
    assert.equal(server.title, 'No pudimos crear tu perfil');
    assert.match(server.message, /No se pudo finalizar el registro\./);
    assert.match(server.message, /Detalle: studio_artist_memberships: conflicto\./);
    assert.match(server.message, /\(Error 500\)/);
    assert.equal(server.retry, true);
    const network = core.describeSubmitError(new TypeError('Failed to fetch'));
    assert.equal(network.title, 'Sin conexión con el servidor');
    const password = core.describeSubmitError(Object.assign(new Error('x'), { code: 'PASSWORD_REQUIRED' }));
    assert.equal(password.retry, false);
    const js = read('public/shared/js/register.js');
    assert.doesNotMatch(js, /alert\(error\.message \|\| 'No se pudo finalizar el registro/);
    assert.match(js, /showSubmitError\(error\);/);
    assert.match(js, /if \(registrationSubmitInFlight\) return;/);
    assert.match(js, /error\.status = finalizeRes\.status;/);
    const html = read('public/register-artist/index.html');
    assert.match(html, /id="ra-submit-error"[^>]*hidden/);
    assert.match(html, /id="ra-submit-retry"/);
});

// ------------------------------------------------------------ reanudar (pedido nuevo)

test('reanudar: solo hay avance si se completó algo más que Crear cuenta', () => {
    assert.equal(core.hasResumableProgress({ full_name: 'Ana', email: 'a@b.co', city: 'Rosario', location_country: 'Argentina', styles: ['Realismo'] }), false);
    assert.equal(core.hasResumableProgress({ artistic_name: 'ana.ink' }), true);
    assert.equal(core.hasResumableProgress({ newsletter_topics: ['avisos'] }), true);
    assert.equal(core.hasResumableProgress({ portfolio_ig_items: [{ id: 'ig-1' }] }), true);
    assert.equal(core.hasResumableProgress(null), false);
});

test('reanudar: diálogo Continuar / Empezar de cero sobre el borrador local y remoto', () => {
    const js = read('public/shared/js/register.js');
    assert.match(js, /function shouldOfferResume\(/);
    assert.match(js, /function startRegistrationOver\(\)/);
    assert.match(js, /url\.searchParams\.set\('startOver', '1'\)/);
    // El arranque con ?startOver=1 limpia y saca el parámetro (una recarga no vuelve a borrar).
    assert.match(js, /removeUrlParams\(\['startOver', 'resumeStep'\]\)/);
    // La contraseña nunca va al borrador: al reanudar se vuelve a pedir.
    assert.match(js, /function ensurePasswordStepOnResume\(\)/);
    assert.doesNotMatch(js.slice(js.indexOf('const REGISTRATION_DRAFT_FIELDS'), js.indexOf('];', js.indexOf('const REGISTRATION_DRAFT_FIELDS'))), /signup_password/);
    // Navegador cerrado: se retoma el borrador activo de este navegador.
    assert.match(js, /function readStoredActiveDraftId\(\)/);
    const finalJs = read('public/shared/js/acceso-register-final.js');
    assert.match(finalJs, /Continuar donde lo dejé/);
    assert.match(finalJs, /Empezar de cero/);
});

test('Crear cuenta: se lee el handoff de main.js (país, ciudad, estilo o "más adelante")', () => {
    const finalJs = read('public/shared/js/acceso-register-final.js');
    assert.match(finalJs, /'wo:artist-registration:signup-handoff'/);
    assert.match(finalJs, /params\.get\('styleLater'\)/);
    assert.match(finalJs, /handoff\.style_later/);
    const html = read('public/register-artist/index.html');
    assert.match(html, /id="styles-later-hint"[^>]*hidden/);
});
