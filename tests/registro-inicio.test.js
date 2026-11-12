'use strict';
// Revisión del registro (12/11) · grupo inicio-crear-cuenta.
// Página 1: /inicio (orden y animación de tarjetas).
// Página 2: /registerclosedbeta (estilos, "más adelante", país/ciudad, redes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------- /inicio

function loadInicio() {
  const context = {};
  vm.runInNewContext(read('public/inicio/inicio.js'), context);
  return context.WoInicio;
}

test('inicio: la tarjeta elegida va al centro y las otras conservan su orden', () => {
  const { layoutFor } = loadInicio();
  assert.deepEqual(Array.from(layoutFor('artist')), ['client', 'artist', 'studio']);
  assert.deepEqual(Array.from(layoutFor('client')), ['artist', 'client', 'studio']);
  assert.deepEqual(Array.from(layoutFor('studio')), ['client', 'studio', 'artist']);
  assert.deepEqual(Array.from(layoutFor('otra')), ['client', 'artist', 'studio']);
});

test('inicio: sin barra divisora, tarjetas laterales más chicas y reduced-motion', () => {
  const css = read('public/inicio/inicio.css');
  assert.match(css, /\.inicio-topbar \{[^}]*border-bottom:0/);
  assert.match(css, /\.has-selection \.inicio-card:not\(:has\(\.inicio-radio:checked\)\) \{ scale:\.86;/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{[\s\S]*\.inicio-card \{ transition:none; \}/);
  const js = read('public/inicio/inicio.js');
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /translate: `\$\{dx\}px \$\{dy\}px`/);
});

// ------------------------------------------------------ /registerclosedbeta

// main.js es un script de página: se evalúa con stubs mínimos de navegador.
function loadMain() {
  const storage = new Map();
  const window = { location: { pathname: '/registerclosedbeta', search: '' } };
  const context = {
    window,
    supabase: { createClient: () => ({ auth: {} }) },
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    URLSearchParams,
    console
  };
  vm.runInNewContext(read('public/shared/js/main.js'), context);
  return { api: window.WoBetaSignup, context, storage };
}

test('crear cuenta: estilos exactos de la revisión, en orden alfabético', () => {
  const { api } = loadMain();
  const expected = [
    'Blackwork', 'Fine Line', 'Geométrico', 'Japonés', 'Lettering / Caligrafía',
    'Microrealismo', 'Minimalista', 'Neotradicional', 'Realismo', 'Tradicional americano'
  ];
  assert.deepEqual(Array.from(api.BETA_STYLE_OPTIONS), expected);
  assert.deepEqual([...expected].sort((a, b) => a.localeCompare(b, 'es')), expected);
});

test('crear cuenta: 32 países, EE. UU., Argentina y España primero y el resto alfabético', () => {
  const { api } = loadMain();
  const names = Array.from(api.BETA_COUNTRIES, (c) => c.name);
  assert.equal(names.length, 32);
  assert.deepEqual(names.slice(0, 3), ['Estados Unidos', 'Argentina', 'España']);
  const rest = names.slice(3);
  assert.deepEqual([...rest].sort((a, b) => a.localeCompare(b, 'es')), rest);
  for (const name of ['Canadá', 'México', 'Costa Rica', 'Panamá', 'Colombia', 'Venezuela', 'Perú', 'Brasil',
    'Chile', 'Uruguay', 'Portugal', 'Francia', 'Alemania', 'Italia', 'Reino Unido', 'Dinamarca', 'Noruega',
    'Suecia', 'Finlandia', 'Polonia', 'Grecia', 'Corea del Sur', 'Tailandia', 'Indonesia', 'Japón',
    'Nueva Zelanda', 'Suiza', 'Países Bajos', 'Australia']) {
    assert.ok(names.includes(name), name);
  }
  for (const { code } of api.BETA_COUNTRIES) assert.match(code, /^[a-z]{2}$/);
  assert.equal(new Set(api.BETA_COUNTRIES.map((c) => c.code)).size, 32);
  assert.equal(api.betaCountryByName('Reino Unido').code, 'gb');
});

test('crear cuenta: lee /api/registration/catalogs y su respaldo local coincide', () => {
  const { api } = loadMain();
  const parsed = api.parseBetaCatalogs({
    data: { styles: { quick: [{ label: 'Blackwork' }, { label: 'Realismo' }] }, countries: [{ name: 'Argentina', code: 'AR' }, { name: 'X', code: '' }] }
  });
  assert.deepEqual(Array.from(parsed.styles), ['Blackwork', 'Realismo']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.countries)), [{ name: 'Argentina', code: 'ar' }]);
  assert.deepEqual(Array.from(api.parseBetaCatalogs({ quickStyles: ['Fine Line'] }).styles), ['Fine Line']);
  assert.equal(api.parseBetaCatalogs({}).styles, null);
  assert.equal(api.parseBetaCatalogs(null), null);
  // Si el grupo Backend ya publicó el catálogo, el respaldo local tiene que ser igual.
  const catalogsPath = path.join(__dirname, '../lib/registration-catalogs.js');
  if (fs.existsSync(catalogsPath)) {
    const backend = require(catalogsPath);
    assert.deepEqual(backend.QUICK_STYLES.map((s) => s.label), Array.from(api.BETA_STYLE_OPTIONS));
    assert.deepEqual(
      backend.REGISTRATION_COUNTRIES.map((c) => [c.name, c.code.toLowerCase()]),
      Array.from(api.BETA_COUNTRIES, (c) => [c.name, c.code])
    );
  }
});

test('crear cuenta: todo es obligatorio salvo Estilo con "Añadir más adelante"', () => {
  const { api } = loadMain();
  const base = { fullName: 'Ana', email: 'ana@example.com', country: 'Argentina', city: 'Rosario', style: 'Realismo', styleLater: false, terms: true };
  assert.equal(api.validateBetaForm(base), null);
  assert.equal(api.validateBetaForm({ ...base, country: '' }).field, 'beta-country');
  assert.equal(api.validateBetaForm({ ...base, city: '' }).field, 'beta-city');
  assert.equal(api.validateBetaForm({ ...base, style: '' }).field, 'beta-style');
  assert.equal(api.validateBetaForm({ ...base, style: '', styleLater: true }), null);
  assert.equal(api.validateBetaForm({ ...base, terms: false }).field, 'beta-terms');
});

test('crear cuenta: el borrador y el handoff llevan país, ciudad y "estilo más adelante"', () => {
  const { api } = loadMain();
  const later = api.buildBetaSignupData({
    fullName: 'Ana', email: 'ana@example.com', country: 'Uruguay', countryCode: 'uy',
    city: 'Montevideo', cityPlaceId: 'pid', style: 'Realismo', styleLater: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(later.draftData)), {
    full_name: 'Ana', location_country: 'Uruguay', location_city: 'Montevideo', city: 'Montevideo', styles: []
  });
  assert.equal(later.handoff.style_later, true);
  assert.equal(later.handoff.country_code, 'uy');
  assert.equal(later.handoff.city_place_id, 'pid');
  const chosen = api.buildBetaSignupData({ fullName: 'Ana', email: 'a@b.co', country: 'Chile', city: 'Santiago', style: 'Fine Line', styleLater: false });
  assert.deepEqual(Array.from(chosen.draftData.styles), ['Fine Line']);
  assert.equal(chosen.handoff.style_later, false);
  assert.equal(api.BETA_SIGNUP_HANDOFF_KEY, 'wo:artist-registration:signup-handoff');
});

test('crear cuenta: Ciudad usa Places (cities) restringido al país y degrada a texto', () => {
  const main = read('public/shared/js/main.js');
  assert.match(main, /types: \['\(cities\)'\]/);
  assert.match(main, /setComponentRestrictions\(\{ country: country\.code \}\)/);
  assert.match(main, /WeOtziGeocoder\.ensureGoogleMapsLoaded\(\{ libraries: \['places'\] \}\)/);
  assert.match(main, /betaCityState\.placesFailed = true/);
  assert.match(main, /withUrlParams\(targetUrl, \{ styleLater: '1' \}\)/);
  assert.doesNotMatch(main, /loadTattooStylesFromDB/);
});

test('crear cuenta: HTML sin asteriscos, con País, check de estilo y redes sin Email', () => {
  const html = read('public/registerclosedbeta/index.html');
  assert.doesNotMatch(html, /class="req"/);
  assert.match(html, /<select id="beta-country"[^>]*required/);
  assert.match(html, /<input id="beta-city"[^>]*required disabled/);
  assert.match(html, /id="beta-style-later"/);
  assert.match(html, /Añadir más adelante, mi estilo no está aquí/);
  assert.doesNotMatch(html, /data-social="email"/);
  assert.match(html, /<div class="wo-auth-social-reco">\s*<span class="wo-auth-reco">[\s\S]*?data-social="instagram"/);
  assert.match(html, /data-social="facebook"/);
  assert.match(html, /src="\/shared\/js\/geocoder\.js"/);
  // Los selects los mejora el DS: esta página no los estiliza.
  const css = read('public/shared/css/registerclosedbeta-ds.css');
  assert.doesNotMatch(css, /wo-controls|\.wo-select-/);
});
