// Revisión del registro (12 nov 2026, text.txt línea 82) · grupo monedas
// "Que las monedas sean las monedas que se manejan únicamente en el listado de
// países": todos los selectores de moneda del sitio usan la misma lista de 24
// (WeOtziCurrency.COUNTRY_CURRENCIES en currency-utils.js), con el mismo orden
// y agrupación que el registro, y conservan un valor viejo fuera de la lista.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const C = require('../public/shared/js/currency-utils.js');
const catalogs = require('../lib/registration-catalogs.js');
const registro = require('../public/register-artist/catalogo-registro.js');

// ------------------------------------------------------------ lista única

test('COUNTRY_CURRENCIES coincide exactamente con lib/registration-catalogs.js (códigos y nombres)', () => {
    assert.equal(C.COUNTRY_CURRENCIES.length, 24);
    const server = new Map(catalogs.REGISTRATION_CURRENCIES.map((c) => [c.code, c.name]));
    const front = new Map(C.COUNTRY_CURRENCIES.map((c) => [c.code, c.name]));
    assert.equal(front.size, C.COUNTRY_CURRENCIES.length, 'sin duplicados');
    assert.deepEqual([...front.keys()].sort(), [...server.keys()].sort());
    for (const [code, name] of server) assert.equal(front.get(code), name, code);
    // Cada moneda de cada país del listado está, y ninguna sobra.
    const fromCountries = new Set(catalogs.REGISTRATION_COUNTRIES.map((c) => c.currency));
    assert.deepEqual([...fromCountries].sort(), [...front.keys()].sort());
    C.COUNTRY_CURRENCIES.forEach((c) => assert.ok(catalogs.isRegistrationCurrency(c.code), c.code));
});

test('mismo orden y agrupación que el selector del registro (catalogo-registro.js)', () => {
    assert.deepEqual(
        C.COUNTRY_CURRENCIES.map((c) => [c.code, c.name, c.region]),
        registro.CURRENCIES.map((c) => [c.code, c.name, c.region])
    );
    assert.deepEqual([...C.CURRENCY_REGIONS], ['Américas', 'Europa', 'Asia y Oceanía']);
    // Regiones contiguas y en el orden de CURRENCY_REGIONS.
    const seq = C.COUNTRY_CURRENCIES.map((c) => c.region).filter((r, i, a) => i === 0 || a[i - 1] !== r);
    assert.deepEqual(seq, [...C.CURRENCY_REGIONS]);
    assert.ok(Object.isFrozen(C.COUNTRY_CURRENCIES));
});

test('el select del registro en el HTML tiene las mismas opciones en el mismo orden', () => {
    const html = read('public/register-artist/index.html');
    const block = html.slice(html.indexOf('id="session_currency"'), html.indexOf('</select>', html.indexOf('id="session_currency"')));
    const codes = [...block.matchAll(/<option value="([A-Z]{3})"/g)].map((m) => m[1]);
    assert.deepEqual(codes, C.COUNTRY_CURRENCIES.map((c) => c.code));
});

// ------------------------------------------------------------ helpers

test('countryCurrencyOptionsHtml: 3 optgroups, 24 opciones y la elegida marcada', () => {
    const html = C.countryCurrencyOptionsHtml({ value: 'ars' });
    assert.deepEqual([...html.matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1]), ['Américas', 'Europa', 'Asia y Oceanía']);
    assert.deepEqual([...html.matchAll(/<option value="([A-Z]{3})"/g)].map((m) => m[1]), C.COUNTRY_CURRENCIES.map((c) => c.code));
    assert.match(html, /<option value="ARS" selected>Peso argentino \(ARS\)<\/option>/);
    assert.equal((html.match(/ selected/g) || []).length, 1);
    assert.doesNotMatch(html, /Otras/);
});

test('un valor guardado fuera de la lista (cotización vieja en BOB) se conserva en "Otras"', () => {
    const html = C.countryCurrencyOptionsHtml({ value: 'BOB', label: 'code' });
    assert.match(html, /<optgroup label="Otras" data-wo-currency-extra=""><option value="BOB" selected>BOB<\/option><\/optgroup>$/);
    assert.equal([...html.matchAll(/<option /g)].length, 25);
    // extra explícitos sin duplicar los de la lista
    const extra = C.countryCurrencyOptionsHtml({ value: 'USD', extra: ['bob', 'USD', 'BOB', 'xx'] });
    assert.equal((extra.match(/value="BOB"/g) || []).length, 1);
    assert.doesNotMatch(extra, /value="XX"/);
    assert.match(extra, /<option value="USD" selected>/);
});

test('formatos de etiqueta, placeholder y opciones iniciales (Local)', () => {
    assert.match(C.countryCurrencyOptionsHtml({ label: 'code' }), /<option value="EUR">EUR<\/option>/);
    assert.match(C.countryCurrencyOptionsHtml({ label: 'code-name' }), /<option value="EUR">EUR · Euro<\/option>/);
    assert.match(C.countryCurrencyOptionsHtml({ label: (c) => `${c.code} - ${c.name}` }), /<option value="JPY">JPY - Yen japonés<\/option>/);
    const withPlaceholder = C.countryCurrencyOptionsHtml({ value: '', placeholder: 'Elegí una moneda' });
    assert.match(withPlaceholder, /^<option value="" selected>Elegí una moneda<\/option><optgroup/);
    const local = C.countryCurrencyOptionsHtml({ value: 'local', leading: [{ value: 'local', label: 'Local' }], label: 'code' });
    assert.match(local, /^<option value="local" selected>Local<\/option><optgroup label="Américas">/);
    assert.doesNotMatch(local, /Otras/);
    // escapado
    assert.doesNotMatch(C.countryCurrencyOptionsHtml({ placeholder: '<b>' }), /<b>/);
});

test('isCountryCurrency / countryCurrencyName / normalizeCurrencyCode', () => {
    assert.equal(C.isCountryCurrency('uyu'), true);
    assert.equal(C.isCountryCurrency('BOB'), false);
    assert.equal(C.isCountryCurrency(''), false);
    assert.equal(C.countryCurrencyName('chf'), 'Franco suizo');
    assert.equal(C.countryCurrencyName('BOB'), null);
    assert.equal(C.normalizeCurrencyCode(' usdt '), 'USDT');
    assert.equal(C.normalizeCurrencyCode('1$'), '');
});

// ------------------------------------------------------------ consumidores

test('ningún selector de moneda conserva una lista vieja propia', () => {
    const files = {
        'public/shared/js/artist-account.js': /fillAccountCurrencySelect\(\$\('aac-price-currency'\)[\s\S]*fillAccountCurrencySelect\(currencySel/,
        'public/shared/js/wallet-account.js': /setDestinationCurrency\(dest \? dest\.currency/,
        'public/shared/js/dashboard.js': /fillCurrencySelect\('input-currency'/,
        'public/shared/js/artist-store.js': /fillCurrencySelect\(\$\('ast-ed-f-currency'\)/,
        'public/shared/js/quotations.js': /api\.fillCurrencySelect\(select/,
        'public/shared/js/quotation-new.js': /countryCurrencyOptionsHtml\(\{ value: state\.currency/,
        'public/shared/js/quotation-detail-figma.js': /countryCurrencyOptionsHtml\(\{ value: current/,
        'public/shared/js/job-board-request.js': /countryCurrencyOptionsHtml\(\{ value: selected/,
        'public/shared/js/admin.js': /fillDefaultCurrencySelect\(settings\.app\.defaultCurrency/
    };
    for (const [file, re] of Object.entries(files)) assert.match(read(file), re, file);
    // Las listas cortas que quedaban (9, 5, 6 monedas) no vuelven.
    assert.doesNotMatch(read('public/shared/js/artist-account.js'), /'COP', 'CLP', 'PEN', 'BRL', 'GBP'/);
    assert.doesNotMatch(read('public/shared/js/quotation-detail-figma.js'), /'CLP', 'MXN', 'EUR'/);
    assert.doesNotMatch(read('public/shared/js/quotation-new.js'), /WeOtziCurrency\.list\(\)/);
    assert.doesNotMatch(read('public/artist/dashboard/index.html'), /<option value="GBP">/);
    assert.doesNotMatch(read('public/artist/account/index.html'), /<option value="MXN">MXN<\/option>/);
    assert.doesNotMatch(read('public/backoffice/index.html'), /MXN - Peso Mexicano/);
    // El widget "Mostrar en" de currency-utils tampoco lista el catálogo de tasas completo.
    assert.match(read('public/shared/js/currency-utils.js'), /function rebuildOptions\(\) \{\s*fillCurrencySelect\(select/);
});

test('las páginas con selector de moneda cargan currency-utils.js antes de su script', () => {
    const pages = {
        'public/artist/account/index.html': 'artist-account.js',
        'public/artist/dashboard/index.html': 'dashboard.js',
        'public/artist/store/index.html': 'artist-store.js',
        'public/my-quotations/index.html': 'quotations.js',
        'public/my-quotations/new/index.html': 'quotation-new.js',
        'public/my-quotations/detail/index.html': 'quotation-detail-figma.js',
        'public/job-board/request/index.html': 'job-board-request.js',
        'public/backoffice/index.html': 'admin.js'
    };
    for (const [page, script] of Object.entries(pages)) {
        const html = read(page);
        const utils = html.indexOf('/shared/js/currency-utils.js');
        const own = html.indexOf('/shared/js/' + script);
        assert.ok(utils > -1, page + ' carga currency-utils.js');
        assert.ok(own > utils, page + ': currency-utils.js antes de ' + script);
    }
});

test('el respaldo offline de tasas incluye las 24 sin inventar tasas', () => {
    const src = read('public/shared/js/currency-utils.js');
    assert.match(src, /units_per_usd: null, units_per_eur: null/);
});
