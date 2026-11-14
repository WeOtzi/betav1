// Registro de estudios (beta cerrada, frente estudio-registro): selectores del
// paso 2, pin del paso 3, términos, verificación, Google Maps con un solo
// cargador, pie legal y patrones del registro de artistas rediseñado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const pickers = require('../public/shared/js/studio-register-pickers.js');
const { TERMS_VERSION } = require('../lib/terms-acceptance.js');

test('idiomas sin duplicados ni acentos, con la ortografía canónica y hasta diez', () => {
    assert.deepEqual(plain(pickers.parseLanguages('español, Inglés ,ingles, klingon, ')), ['Español', 'Inglés', 'Klingon']);
    assert.equal(pickers.serializeLanguages(['Francés', 'frances', 'Portugués']), 'Francés, Portugués');
    assert.equal(pickers.parseLanguages(pickers.LANGUAGES.slice(0, 12).join(',')).length, pickers.MAX_LANGUAGES);
    assert.deepEqual(plain(pickers.parseLanguages('')), []);
});

test('el calendario de años termina en el año actual y deshabilita los fuera de rango', () => {
    assert.equal(pickers.pageStart(2026, 1900, 2026), 2015);
    assert.equal(pickers.pageStart(2014, 1900, 2026), 2003);
    assert.equal(pickers.pageStart(3000, 1900, 2026), 2015);
    const first = pickers.yearPage(1895, { min: 1900, max: 2026, selected: 1901 });
    assert.deepEqual(first.filter(c => c.disabled).map(c => c.year), [1895, 1896, 1897, 1898, 1899]);
    assert.deepEqual(first.filter(c => c.selected).map(c => c.year), [1901]);
});

function loadLocationMap() {
    const context = { setInterval, clearInterval, Date, Promise, globalThis: null };
    context.globalThis = context;
    vm.runInNewContext(read('public/shared/js/studio-location-map.js'), context);
    return context.WeOtziLocationMap;
}

test('la dirección inversa del pin evita resultados con localidad = código postal', () => {
    const map = loadLocationMap();
    const comp = (types, name) => ({ types, long_name: name });
    const results = [
        { types: ['premise', 'street_address'], formatted_address: 'Malabia 1686, C1414DMH', address_components: [comp(['locality'], 'C1414DMH')] },
        { types: ['establishment'], formatted_address: 'Un local', address_components: [comp(['locality'], 'Ciudad Autónoma de Buenos Aires')] },
        { types: ['street_address'], formatted_address: 'Malabia 1690, CABA', address_components: [comp(['locality'], 'Ciudad Autónoma de Buenos Aires')] }
    ];
    assert.equal(map.bestResult(results).formatted_address, 'Malabia 1690, CABA');
    assert.equal(map.bestResult([]), null);
});

test('ER-03: el registro carga Google Maps solo por el geocoder compartido', () => {
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /window\.WeOtziGeocoder\.ensureGoogleMapsLoaded\(\{ libraries: \['places'\] \}\)/);
    assert.doesNotMatch(source, /maps\.googleapis\.com/, 'no inyecta un segundo <script> de Maps');
    assert.doesNotMatch(read('public/studio/register/index.html'), /maps\.googleapis\.com/);
    assert.match(read('public/shared/css/address-picker.css'), /background: var\(--bg, var\(--surface-card, #FFFFFF\)\)/, 'el dropdown de Places no queda transparente');
});

test('ER-04: cada sede tiene pin arrastrable y la dirección manual se geocodifica o queda pendiente', () => {
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /window\.WeOtziLocationMap\.attach\(entry\.row\.querySelector\('\[data-map\]'\)/);
    assert.match(source, /entry\.map\.locate\(query\)/);
    assert.match(source, /window\.WeOtziGeocoder\.geocodeQuery\(query\)/);
    assert.match(source, /Dirección manual · pin pendiente/);
    const html = read('public/studio/register/index.html');
    assert.ok(html.indexOf('studio-location-map.js') < html.indexOf('studio-register.js'));
    assert.ok(html.indexOf('studio-register-pickers.js') < html.indexOf('studio-register.js'));
});

test('ER-06: el alta y el reclamo exigen aceptar Términos y Privacidad con la versión vigente', () => {
    const html = read('public/studio/register/index.html');
    assert.match(html, /<input type="checkbox" id="reg-terms" required>/);
    assert.match(html, /<input type="checkbox" id="claim-terms">/);
    assert.equal((html.match(/href="\/legal\/terms\/"/g) || []).length, 2);
    assert.equal((html.match(/href="\/legal\/privacy\/"/g) || []).length, 2);
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, new RegExp("const TERMS_VERSION = '" + TERMS_VERSION + "';"), 'misma versión que lib/terms-acceptance.js');
    assert.match(source, /terms_accepted: true, terms_version: TERMS_VERSION/);
    assert.match(source, /if \(!\$\('reg-terms'\)\.checked\) return showStatus\('error'/);
    assert.match(source, /if \(!\$\('claim-terms'\)\.checked\) return showStatus\('error'/);
    assert.match(source, /termsVersion: TERMS_VERSION/);
});

test('ER-06: el pie del onboarding enlaza los documentos legales reales (sin diálogo "no disponible")', () => {
    const onboarding = read('public/shared/js/ds/onboarding.js');
    assert.match(onboarding, /href="\/legal\/privacy\/"/);
    assert.match(onboarding, /href="\/legal\/terms\/"/);
    assert.doesNotMatch(onboarding, /todavía no está disponible/);
    assert.doesNotMatch(onboarding, /data-document/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'legal', 'terms', 'index.html')));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'legal', 'privacy', 'index.html')));
});

test('ER-12 / VER-N2: "Verificar mi estudio" lleva al panel de verificación sin interceptar el click', () => {
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /url\('\/studio\/dashboard#verificacion'\)/);
    assert.doesNotMatch(source, /todavía no está disponible desde este panel/);
    assert.doesNotMatch(source, /dashboard#perfil/);
    assert.match(source, /Verificación adicional requerida/, 'avisa cuando el alta quedó marcada para verificar');
});

test('ER-10: pasos con ✓, CTA con flecha fijo en mobile, tarjetas PRINCIPAL/ADICIONAL y filas con EDITAR', () => {
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /button\.classList\.toggle\('is-done'/);
    assert.match(source, /class="sr-edit-btn" data-go-step="/);
    assert.match(source, /badge\.textContent = entry\.primary \? 'Principal' : entry\.active \? 'Adicional' : 'Inactiva'/);
    const css = read('public/shared/css/studio-register-ds.css');
    assert.match(css, /\.sr-wizard-actions \.sr-next::after\{content:" \\2192";\}/);
    assert.match(css, /\.sr-wizard-actions\{position:sticky;bottom:0/);
    assert.match(css, /\.wo-input\.has-value:not\(\[readonly\]\)\{box-shadow:var\(--shadow-hard-sm/);
    assert.match(read('public/shared/css/ds/onboarding.css'), /\.wo-onboarding-nav button\.is-done \.wo-onboarding-check\{display:inline-block\}/);
    assert.match(read('public/shared/js/ds/onboarding.js'), /wo-onboarding-done-label/);
});

test('ER-11 y ER-16: cuenta abierta visible, "Usar otra cuenta" y borrador de otro dispositivo', () => {
    const html = read('public/studio/register/index.html');
    assert.match(html, /id="account-card" hidden/);
    assert.match(html, /<button type="button" class="sr-link-btn" id="switch-account">Usar otra cuenta<\/button>/);
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /restoreMetadataDraft\(existingSession\.user\.user_metadata\?\.studio_registration\)/);
    assert.match(source, /saveDraft\(\);\s+const auth = window\.WeOtziStudioAuth\.getSupabase\(\)\.auth;\s+const \{ error \} = await auth\.signOut\(\);/, 'conserva el borrador antes de cerrar sesión');
    assert.match(source, /if \(state\.code === 'terms'\)/);
    assert.match(source, /if \(claimToken && claimPreview\) return true;/, 'con link de alta no hay coincidencias');
});

test('ER-14: el alta usa WeotziData.Studios.completeRegistration (sin RPC directa nueva)', () => {
    const auth = read('public/shared/js/studio-auth.js');
    assert.match(auth, /studios\.completeRegistration\(draft\.profile, draft\.locations\)/);
    const repo = read('public/shared/js/data/studios-repo.js');
    assert.match(repo, /completeRegistration\(profile, locations\) \{\s+return regRpc\('complete_studio_registration'/);
    assert.match(repo, /save\(studioId, locationId, payload\) \{\s+return regRpc\('save_studio_location'/);
    assert.match(repo, /remove\(studioId, locationId\) \{\s+return regRpc\('remove_studio_location'/);
    const dash = read('public/shared/js/studio-dashboard.js');
    assert.doesNotMatch(dash, /rpc\('save_studio_location'|rpc\('remove_studio_location'/);
    assert.doesNotMatch(read('public/shared/js/studio-register.js') + read('public/shared/js/studio-dashboard-sedes.js'), /\.rpc\(|fetch\(['"]\/rest\/v1|_supabase\.from/);
});

test('el registro escapa los datos de usuario que pinta con innerHTML', () => {
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /'<li><strong>' \+ esc\(m\.name\) \+ '<\/strong> · ' \+ esc\(l\.formatted_address\)/);
    assert.match(source, /box\.innerHTML = '<p>' \+ esc\(instagramMessage\(handle, matches\)\)/);
    assert.match(source, /'<span>' \+ esc\(entry\.address\.formatted_address \|\| 'Sin dirección'\)/);
});
