// Revisión "Estudios v1" del registro y la verificación de estudios:
// selectores del paso 2, elección del resultado del pin, módulo de
// verificación del panel, regla de fotos de Instagram en el perfil público y
// contratos de las migraciones 20261102120000/130000/140000.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const pickers = require('../public/shared/js/studio-register-pickers.js');

// ---------------------------------------------------------------
// Paso 2 · selectores
// ---------------------------------------------------------------
test('languages are de-duplicated without accents, keep the canonical spelling and cap at ten', () => {
    assert.deepEqual(plain(pickers.parseLanguages('español, Inglés ,ingles, klingon, ')), ['Español', 'Inglés', 'Klingon']);
    assert.equal(pickers.serializeLanguages(['Francés', 'frances', 'Portugués']), 'Francés, Portugués');
    const many = pickers.LANGUAGES.slice(0, 12).join(',');
    assert.equal(pickers.parseLanguages(many).length, pickers.MAX_LANGUAGES);
    assert.deepEqual(plain(pickers.parseLanguages('')), []);
});

test('the year calendar pages end on the current year and disable years out of range', () => {
    assert.equal(pickers.pageStart(2026, 1900, 2026), 2015, 'la primera página muestra los últimos 12 años');
    assert.equal(pickers.pageStart(2015, 1900, 2026), 2015);
    assert.equal(pickers.pageStart(2014, 1900, 2026), 2003);
    assert.equal(pickers.pageStart(3000, 1900, 2026), 2015, 'un año futuro cae en la página actual');
    const first = pickers.yearPage(1895, { min: 1900, max: 2026, selected: 1901 });
    assert.equal(first.length, 12);
    assert.deepEqual(first.filter(c => c.disabled).map(c => c.year), [1895, 1896, 1897, 1898, 1899]);
    assert.deepEqual(first.filter(c => c.selected).map(c => c.year), [1901]);
});

test('register step 2 keeps the hidden inputs as the draft source of truth', () => {
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /pickers\.yearPicker\(\$\('reg-founded'\), \$\('founded-picker'\)/);
    assert.match(source, /pickers\.languagePicker\(\$\('reg-languages'\), \$\('languages-picker'\)/);
    assert.match(source, /WeOtziStudioPickers\.parseLanguages\(value\('reg-languages'\)\)/, 'el perfil manda la lista normalizada');
    assert.match(source, /showStatus\('error', 'Revisá el año de fundación\.', \$\('reg-founded-trigger'\)\)/);
});

// ---------------------------------------------------------------
// Paso 3 · pin en el mapa
// ---------------------------------------------------------------
function loadLocationMap() {
    const context = { setInterval, clearInterval, Date, Promise, globalThis: null };
    context.globalThis = context;
    vm.runInNewContext(read('public/shared/js/studio-location-map.js'), context);
    return context.WeOtziLocationMap;
}

test('the reverse geocode skips results whose locality is a postal code', () => {
    const map = loadLocationMap();
    const comp = (types, name) => ({ types, long_name: name });
    const results = [
        { types: ['premise', 'street_address'], formatted_address: 'Malabia 1686, C1414DMH C1414DMH', address_components: [comp(['locality'], 'C1414DMH')] },
        { types: ['establishment'], formatted_address: 'Un local', address_components: [comp(['locality'], 'Ciudad Autónoma de Buenos Aires')] },
        { types: ['street_address'], formatted_address: 'Malabia 1690, CABA', address_components: [comp(['locality'], 'Ciudad Autónoma de Buenos Aires')] }
    ];
    assert.equal(map.bestResult(results).formatted_address, 'Malabia 1690, CABA');
    assert.equal(map.bestResult(results.slice(0, 2)).formatted_address, 'Malabia 1686, C1414DMH C1414DMH', 'sin alternativa limpia, la primera de calle');
    assert.equal(map.bestResult([results[1]]).formatted_address, 'Un local');
    assert.equal(map.bestResult([]), null);
});

test('register loads Google Maps through the shared geocoder loader only', () => {
    const source = read('public/shared/js/studio-register.js');
    assert.match(source, /window\.WeOtziGeocoder\.ensureGoogleMapsLoaded\(\{ libraries: \['places'\] \}\)/);
    assert.match(source, /script\[src\*="maps\.googleapis\.com\/maps\/api\/js"\]/, 'no inyecta un segundo <script> de Maps');
    const mapSource = read('public/shared/js/studio-location-map.js');
    assert.match(mapSource, /importLibrary\('maps'\), maps\.importLibrary\('marker'\), maps\.importLibrary\('geocoding'\)/);
    const css = read('public/shared/css/address-picker.css');
    assert.match(css, /\.pac-container \{[^}]*background: var\(--bg, var\(--surface-card, #FFFFFF\)\)/, 'el dropdown de Google no queda transparente en el DS');
});

// ---------------------------------------------------------------
// Panel · verificación
// ---------------------------------------------------------------
function loadVerification() {
    const window = { WeOtziStudioKit: null };
    const context = { window, console, Promise, fetch: async () => ({}) };
    vm.runInNewContext(read('public/shared/js/studio-admin-kit.js'), context);
    vm.runInNewContext(read('public/shared/js/studio-dashboard-verification.js'), context);
    return window.WeOtziStudioVerification;
}

test('the verification panel shows status, the extra-verification notice and the support note escaped', () => {
    const v = loadVerification();
    const pending = v.statusCardHtml({ studio: { verification_status: 'pending', verification_required: true }, request: { reasons: ['name_match', 'owner_request'], created_at: '2026-11-02T10:00:00Z' } });
    assert.match(pending, /En revisión/);
    assert.match(pending, /Verificación adicional/);
    assert.match(pending, /nombre parecido/);
    assert.match(pending, /Solicitud del 02\/11\/2026/);
    const rejected = v.statusCardHtml({ studio: { verification_status: 'rejected' }, request: { decision_note: '<b>falta</b> la habilitación' } });
    assert.match(rejected, /No aprobada/);
    assert.match(rejected, /&lt;b&gt;falta&lt;\/b&gt;/);
    const verified = v.statusCardHtml({ studio: { verification_status: 'verified', verification_required: true } });
    assert.match(verified, /Verificado/);
    assert.doesNotMatch(verified, /Verificación adicional/, 'el aviso desaparece al verificar');
    assert.equal(v.formHtml({ studio: { verification_status: 'verified' } }), '', 'sin formulario cuando ya está verificado');
    assert.match(v.formHtml({ studio: {}, request: { status: 'pending', evidence: 'x'.repeat(20), links: ['https://a.test'] } }), /Actualizar la información/);
});

test('the Instagram block explains the DM code and never renders unsafe handles', () => {
    const v = loadVerification();
    const none = v.instagramHtml({ studio: { instagram: '@estudio"><script>' }, instagram: { status: 'none' } });
    assert.doesNotMatch(none, /<script>/);
    assert.match(none, /Enviar código a mi email/);
    const pending = v.instagramHtml({ studio: { instagram: 'estudio' }, instagram: { status: 'pending', handle: 'estudio', email_masked: 'e••@x.test', expires_at: '2026-11-05T10:00:00Z' }, instructions: { dm_url: 'https://ig.me/m/weotzi' } });
    assert.match(pending, /Mandá el código por mensaje directo a <strong>@weotzi<\/strong>/);
    assert.match(pending, /rel="noopener noreferrer"/);
    assert.match(pending, /Enviar un código nuevo/);
    assert.match(v.instagramHtml({ studio: { instagram_verified_at: '2026-11-01', instagram_verified_handle: 'estudio' } }), /Validado/);
    assert.match(v.instagramHtml({ studio: {} }), /Cargá el Instagram del estudio/);
    assert.deepEqual(plain(v.linksFrom(' https://a.test \n\n https://b.test ')), ['https://a.test', 'https://b.test']);
    assert.equal(v.validLink('javascript:alert(1)'), false);
    assert.equal(v.validLink('https://ok.test/x'), true);
});

test('the dashboard exposes the verification tab in the strip, the menu and the panel', () => {
    const html = read('public/studio/dashboard/index.html');
    assert.match(html, /href="#verificacion" data-tab="verificacion">Verificación<\/a>/);
    assert.match(html, /<section class="studio-dash-panel" data-panel="verificacion" hidden>[\s\S]*?<div data-module-root>/);
    assert.match(html, /<script src="\/shared\/js\/studio-dashboard-verification\.js"><\/script>/);
    assert.match(read('public/shared/js/ds/organisms.js'), /\{ id: 'verificacion', label: 'VERIFICACIÓN' \}/);
    assert.match(read('public/shared/js/studio-register.js'), /url\('\/studio\/dashboard#verificacion'\)/, 'el resultado del registro lleva a Verificación');
});

// ---------------------------------------------------------------
// Perfil público
// ---------------------------------------------------------------
test('the public profile shows the seal and hides Instagram imports until the account is validated', () => {
    const source = read('public/shared/js/studio-profile.js');
    assert.match(source, /if \(studio\.is_verified\) \{[\s\S]*?seal\.textContent = '✓ Verificado';/);
    assert.match(source, /hasOwnProperty\.call\(studio, 'instagram_verified_at'\)/, 'sin la migración se muestra todo');
    assert.match(source, /WoGalleryVisibility\.filterPublic\(studio\.photo_feed_items, igState\)/);
    const vis = require('../public/shared/js/gallery-visibility.js');
    const items = [{ url: 'https://a.test/1.jpg', source: 'instagram' }, { url: 'https://a.test/2.jpg' }, { url: 'https://a.test/3.jpg', source: 'instagram', ig_legacy: true }];
    assert.equal(vis.filterPublic(items, { enforced: true, verified: false, handle: null }).length, 2);
    assert.equal(vis.filterPublic(items, { enforced: true, verified: true, handle: 'estudio' }).length, 3);
    assert.match(read('public/studio/profile/index.html'), /<script src="\/shared\/js\/gallery-visibility\.js"><\/script>\s*<script src="\/shared\/js\/studio-profile\.js">/);
});

// ---------------------------------------------------------------
// Migraciones
// ---------------------------------------------------------------
test('verification migrations are additive, ship rollbacks and keep the support-only guard', () => {
    const files = ['20261102120000_studio_verification', '20261102130000_studio_matches_unowned_fix', '20261102140000_studio_address_match'];
    for (const name of files) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'supabase/migrations', name + '.sql')), name);
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'supabase/rollbacks', name + '.down.sql')), name + ' rollback');
    }
    const m1 = read('supabase/migrations/20261102120000_studio_verification.sql');
    assert.match(m1, /grant execute on function public\.find_studio_matches\(text, text\) to anon, authenticated;/);
    assert.match(m1, /revoke all on public\.studio_instagram_verifications from anon, authenticated;/, 'los hashes de código no se exponen');
    assert.match(m1, /if not public\.is_support_user\(\) then\s+raise exception 'Solo soporte de We Ötzi decide verificaciones\.'/);
    assert.match(m1, /new\.verification_status is distinct from old\.verification_status/);
    assert.doesNotMatch(m1, /drop table|drop column|delete from/i);
    const m2 = read('supabase/migrations/20261102130000_studio_matches_unowned_fix.sql');
    assert.match(m2, /where q\.uid is null or s\.user_id is null or s\.user_id <> q\.uid/, 'las fichas sin dueño aparecen para visitas anónimas');
    const m3 = read('supabase/migrations/20261102140000_studio_address_match.sql');
    assert.match(m3, /if v_dist is not null then return v_dist < 1000; end if;/);
    assert.match(m3, /USING ERRCODE = '23P01'/);
    assert.match(read('supabase/tests/studio_verification.sql'), /rollback;\s*$/);
});
