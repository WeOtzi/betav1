'use strict';
// Ronda 2 · frente cot-pasos · P12 — paso "¿Qué tamaño imaginas?" y manifiesto
// de imágenes del frente (fotos de tamaños y de zonas del cuerpo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
// CRLF del checkout en Windows: los contratos no dependen del fin de línea.
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const estimator = require('../lib/prequote-estimator');

function wizard({ withModules = true } = {}) {
    const sandbox = {
        console, URLSearchParams, setTimeout, clearTimeout, Uint8Array, Math, Promise,
        addEventListener() {}, scrollTo() {},
        crypto: { getRandomValues: (b) => b },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.document = {
        addEventListener() {}, body: { classList: { toggle() {} }, contains: () => false },
        querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
    };
    const context = vm.createContext(sandbox);
    const files = withModules
        ? ['quotation-shared.js', 'quotation-body-figure.js', 'quotation-size-step.js', 'script.js']
        : ['script.js'];
    for (const file of files) vm.runInContext(read('public', 'shared', 'js', file), context);
    return context;
}

const SIZE_Q = "{ id: 6, step: 'size', type: 'cards', field: 'tattoo_size' }";

test('tamaños: se suman micro, media manga y manga, con rango y foto de referencia', () => {
    const ctx = wizard();
    const options = JSON.parse(vm.runInContext('JSON.stringify(FIGMA_SIZE_OPTIONS)', ctx));
    assert.deepEqual(options.map((o) => o.label), ['Micro', 'Pequeño', 'Mediano', 'Grande', 'XL', 'Media manga', 'Manga']);
    assert.deepEqual(options.map((o) => o.value), ['micro', 'pequeño', 'mediano', 'grande', 'muy_grande', 'media manga', 'manga completa']);
    assert.deepEqual(options.map((o) => o.img), ['micro', 'pequeno', 'mediano', 'grande', 'xl', 'media-manga', 'manga']);
    assert.ok(options.every((o) => o.subtitle && o.ind));

    const html = vm.runInContext(`formData = {}; renderQuestionControl(${SIZE_Q})`, ctx);
    const cards = html.match(/<button type="button" class="q-size-card qp-size-card[^>]*>/g) || [];
    assert.equal(cards.length, 8, '7 tamaños + "No estoy seguro"');
    assert.ok(cards.every((card) => /aria-pressed="false"/.test(card) && /data-field="tattoo_size"/.test(card)));
    for (const o of options) {
        assert.match(html, new RegExp(`src="/shared/assets/ronda2/cot-pasos/tamano-${o.img}\\.webp" alt="" loading="lazy"`));
    }
    assert.match(html, /role="group" aria-label="Tamaño del tatuaje"/);
    assert.match(html, /<span class="q-size-name">Media manga<\/span><span class="q-size-range">Medio brazo o media pierna<\/span>/);
    // Respaldo si la foto no existe todavía: la silueta con la marca a escala.
    assert.equal((html.match(/<svg class="qp-scale-svg"/g) || []).length, 7);
    assert.match(html, /<ellipse class="qp-scale-mark" cx="84" cy="100" rx="3\.5" ry="3\.5"\/>/);
    assert.match(html, /class="qp-scale-part is-on"/);
    assert.match(html, /onerror="WoQuotationSize\.imageFailed\(this\)"/);
});

test('"No estoy seguro": tarjeta con casilla que se marca al elegirla', () => {
    const ctx = wizard();
    const off = vm.runInContext(`formData = {}; renderQuestionControl(${SIZE_Q})`, ctx);
    const unsureOff = off.slice(off.indexOf('qp-size-card--unsure') - 60);
    assert.match(unsureOff, /class="q-size-card qp-size-card qp-size-card--unsure" data-field="tattoo_size" data-value="No estoy seguro" aria-pressed="false"/);
    assert.match(unsureOff, /<span class="qp-size-unsure-box" aria-hidden="true"><svg/);
    assert.match(unsureOff, /<span class="q-size-name">No estoy seguro<\/span>/);

    const on = vm.runInContext(`formData = { tattoo_size: 'No Estoy Seguro' }; renderQuestionControl(${SIZE_Q})`, ctx);
    assert.match(on, /qp-size-card--unsure is-selected" data-field="tattoo_size" data-value="No estoy seguro" aria-pressed="true"/);
    assert.equal((on.match(/aria-pressed="true"/g) || []).length, 1);

    const css = read('public', 'shared', 'css', 'quotation-pasos.css');
    assert.match(css, /\.qp-size-card--unsure\.is-selected \.qp-size-unsure-box \{ background: var\(--neutral-500\); color: var\(--accent\); \}/);
    assert.match(css, /\.qp-size-unsure-box \{[^}]*color: transparent;/, 'sin elegir, la casilla está vacía');
    assert.match(css, /\.qp-size-card\.is-selected \.qp-size-check \{ display: grid; \}/, 'cada tamaño elegido también muestra su check');
});

test('elegir un tamaño: usa handleOptionSelect del wizard y sincroniza aria-pressed', () => {
    const ctx = wizard();
    const selected = vm.runInContext(`formData = { tattoo_size: 'Media Manga' }; renderQuestionControl(${SIZE_Q})`, ctx);
    assert.match(selected, /is-selected" data-field="tattoo_size" data-value="media manga" aria-pressed="true"/);
    assert.equal((selected.match(/aria-pressed="true"/g) || []).length, 1);

    // pick(): delega en el wizard y deja aria-pressed como la clase is-selected.
    const calls = [];
    const card = (value, on) => {
        const attrs = { 'data-field': 'tattoo_size', 'data-value': value, 'aria-pressed': 'false' };
        const node = {
            classList: { on, contains: () => node.classList.on, toggle(_, state) { node.classList.on = state; } },
            getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }, attrs
        };
        return node;
    };
    const a = card('micro', false);
    const b = card('No estoy seguro', false);
    const grid = { querySelectorAll: () => [a, b] };
    a.closest = () => grid; b.closest = () => grid;
    ctx.handleOptionSelect = (field, value) => { calls.push([field, value]); a.classList.on = value === 'micro'; b.classList.on = value === 'No estoy seguro'; };
    ctx.WoQuotationSize.pick(b);
    assert.deepEqual(calls, [['tattoo_size', 'No estoy seguro']]);
    assert.equal(b.attrs['aria-pressed'], 'true');
    assert.equal(a.attrs['aria-pressed'], 'false');
    ctx.WoQuotationSize.pick(a);
    assert.equal(a.attrs['aria-pressed'], 'true');
    assert.equal(b.attrs['aria-pressed'], 'false');
    assert.doesNotThrow(() => ctx.WoQuotationSize.pick(null));

    // El valor real lo guarda handleOptionSelect de script.js (Title Case).
    const real = wizard();
    vm.runInContext("persistAnswer = () => {}; questionsConfig = []; handleOptionSelect('tattoo_size', 'manga completa');", real);
    assert.equal(vm.runInContext('formData.tattoo_size', real), 'Manga Completa');
    vm.runInContext("handleOptionSelect('tattoo_size', 'No estoy seguro');", real);
    assert.equal(vm.runInContext('formData.tattoo_size', real), 'No Estoy Seguro');
});

test('los valores nuevos pasan el estimador y el resumen los muestra legibles', () => {
    const ctx = wizard();
    const options = JSON.parse(vm.runInContext('JSON.stringify(FIGMA_SIZE_OPTIONS)', ctx));
    const stored = options.map((o) => vm.runInContext(`toTitleCase(${JSON.stringify(o.value)})`, ctx));
    assert.deepEqual(stored, ['Micro', 'Pequeño', 'Mediano', 'Grande', 'Muy_grande', 'Media Manga', 'Manga Completa']);
    for (const value of stored) {
        const key = estimator.normalizeText(value).replace(/\s+/g, '_');
        assert.ok(estimator.SIZE_SESSION_RULES[key], `el estimador no conoce "${value}" (${key})`);
        assert.ok(value.length <= 255, 'entra en quotations_db.tattoo_size (varchar 255)');
    }
    const sessions = (size) => {
        const { estimate } = estimator.estimatePreQuote({ tattoo_size: size, tattoo_style: 'x', client_city_residence: 'y' }, []);
        return [estimate.estimatedSessionsMin, estimate.estimatedSessionsMax];
    };
    assert.deepEqual(sessions('Micro'), [1, 1]);
    assert.deepEqual(sessions('Media Manga'), [3, 5]);
    assert.deepEqual(sessions('Manga Completa'), [6, 10]);
    assert.deepEqual(sessions('Manga'), [6, 10]);
    assert.deepEqual(sessions('No Estoy Seguro'), [1, 2], 'sin tamaño definido: rango por defecto');

    assert.equal(vm.runInContext("formatTattooSizeForDisplay('Micro')", ctx), 'Micro (Hasta 5 cm)');
    assert.equal(vm.runInContext("formatTattooSizeForDisplay('Media Manga')", ctx), 'Media manga (Medio brazo o media pierna)');
    assert.equal(vm.runInContext("formatTattooSizeForDisplay('Manga Completa')", ctx), 'Manga (Brazo o pierna completos)');
    assert.equal(vm.runInContext("formatTattooSizeForDisplay('No Estoy Seguro')", ctx), 'No Estoy Seguro');
    // El servidor no restringe el tamaño a una lista cerrada.
    assert.doesNotMatch(read('services', 'quotation-intake.js'), /tattoo_size[^;\n]*\.includes\(/);
});

test('sin el módulo cargado, el wizard conserva las tarjetas originales', () => {
    const ctx = wizard({ withModules: false });
    const html = vm.runInContext(`formData = {}; renderQuestionControl(${SIZE_Q})`, ctx);
    assert.equal((html.match(/class="q-size-card /g) || []).length, 7);
    assert.match(html, /No estoy seguro/);
    assert.doesNotMatch(html, /qp-size-card/);
});

test('las fotos se escapan y solo salen de la carpeta del frente', () => {
    const ctx = wizard();
    const html = ctx.WoQuotationSize.render({
        field: 'tattoo_size"><img src=x onerror=alert(1)>', value: null,
        options: [{ label: '<b>XL</b>', value: '"><script>alert(1)</script>', subtitle: '<i>x</i>', ind: 'm"x', img: 'xl' }]
    });
    assert.doesNotMatch(html, /<b>XL<\/b>|<script>|<i>x<\/i>|<img src=x/);
    assert.match(html, /&lt;b&gt;XL&lt;\/b&gt;/);
    assert.equal(ctx.WoQuotationSize.ASSET_BASE, '/shared/assets/ronda2/cot-pasos/');
});

// ---------------------------------------------------------------------------
// Manifiesto de imágenes (las genera el orquestador)
// ---------------------------------------------------------------------------
test('manifiesto de assets: cubre exactamente las fotos que lee el código', () => {
    const manifest = JSON.parse(read('docs', 'plans', 'ronda2-assets', 'cot-pasos.json'));
    assert.ok(Array.isArray(manifest) && manifest.length === 12);
    const paths = manifest.map((item) => item.path);
    assert.equal(new Set(paths).size, paths.length);
    for (const item of manifest) {
        assert.deepEqual(Object.keys(item).sort(), ['aspect', 'path', 'prompt', 'uso']);
        assert.match(item.path, /^public\/shared\/assets\/ronda2\/cot-pasos\/[a-z0-9-]+\.webp$/);
        assert.ok(['1:1', '4:3', '3:4', '16:9'].includes(item.aspect), item.aspect);
        assert.ok(item.prompt.length > 120 && item.uso.length > 20);
        assert.match(item.prompt, /no text/i);
        assert.match(item.prompt, /wears|shirt|sleeve/i, 'piel con contexto vestido');
        assert.doesNotMatch(item.prompt, /\b(nude|naked|topless|shirtless|underwear|lingerie)\b/i);
        assert.doesNotMatch(item.prompt, /[áéíóúñ¿¡]/i, 'prompt en inglés');
    }

    const ctx = wizard();
    const sizeImgs = JSON.parse(vm.runInContext('JSON.stringify(FIGMA_SIZE_OPTIONS.map((o) => o.img))', ctx))
        .map((img) => `public/shared/assets/ronda2/cot-pasos/tamano-${img}.webp`);
    const map = read('public', 'shared', 'js', 'quotation-body-map.js');
    const zonePhotos = [...map.slice(map.indexOf('var ZONE_PHOTOS'), map.indexOf('var ZONE_CROPS')).matchAll(/'(zona-[a-z]+\.webp)'/g)]
        .map((m) => `public/shared/assets/ronda2/cot-pasos/${m[1]}`);
    assert.equal(zonePhotos.length, 5);
    assert.deepEqual([...paths].sort(), [...sizeImgs, ...zonePhotos].sort());
    assert.match(map, /var ASSET_BASE = '\/shared\/assets\/ronda2\/cot-pasos\/';/);
});

// REQ-03 (P12): "Micro" y los rangos del cotizador llegan también al
// pre-cotizador y al filtro de tamaño del Job Board.
test('pre-cotizador: ofrece Micro y los mismos rangos en cm que el cotizador', () => {
    const ctx = wizard();
    const shared = JSON.parse(JSON.stringify(ctx.WeotziQuotationShared.TATTOO_SIZE_OPTIONS));
    const figma = JSON.parse(vm.runInContext('JSON.stringify(FIGMA_SIZE_OPTIONS)', ctx));
    assert.equal(shared[0].label, 'Micro');
    assert.equal(shared[0].subtitle, 'Hasta 5 cm');
    assert.deepEqual(shared.map((o) => o.value),
        ['micro', 'pequeño', 'mediano', 'grande', 'muy_grande', 'media_manga', 'manga_completa', 'espalda_completa', 'pecho_completo']);
    // Un mismo tamaño no se describe con dos rangos distintos.
    for (const value of ['micro', 'pequeño', 'mediano', 'grande', 'muy_grande']) {
        assert.equal(shared.find((o) => o.value === value).subtitle, figma.find((o) => o.value === value).subtitle, value);
    }
    // Todo lo que ofrece el select lo entiende el estimador.
    for (const option of shared) {
        const key = estimator.normalizeText(option.value).replace(/\s+/g, '_');
        assert.ok(estimator.SIZE_SESSION_RULES[key], `el estimador no conoce "${option.value}"`);
    }
    // pre-quote.js arma el select con esta lista ("Micro · Hasta 5 cm").
    assert.ok(read('public', 'shared', 'js', 'pre-quote.js').includes('(shared.TATTOO_SIZE_OPTIONS || []).map('));
});

test('job board: una solicitud "Micro" entra en el filtro "Pequeño" y la ficha la nombra', () => {
    const js = read('public', 'shared', 'js', 'job-board-feed.js');
    const pick = (re) => { const m = js.match(re); assert.ok(m, String(re)); return m[0]; };
    // El predicado del filtro de tamaño, tal como está en el archivo.
    const predicate = "if (!validSizes.some(s => requestSize.includes(s.replace(/\\s+/g, '_')) || requestSize.includes(s))) return false;";
    assert.ok(js.includes(predicate), 'el filtro sigue comparando así');
    const context = vm.createContext({});
    vm.runInContext([
        pick(/const SIZE_MAP = \{[\s\S]*?\n\};/),
        pick(/const SIZE_LABELS = \{[\s\S]*?\n\};/),
        pick(/function toTitleCase\(str\) \{[\s\S]*?\n\}/),
        pick(/function sizeLabelFor\(request\) \{[\s\S]*?\n\}/),
        'function inFilter(size, tattooSize) {',
        "    const requestSize = (tattooSize || '').toLowerCase().replace(/\\s+/g, '_');",
        '    const validSizes = SIZE_MAP[size] || [];',
        '    ' + predicate,
        '    return true;',
        '}',
        'globalThis.api = { SIZE_MAP, inFilter, sizeLabelFor };'
    ].join('\n'), context);
    const { SIZE_MAP, inFilter, sizeLabelFor } = context.api;
    assert.ok(Array.from(SIZE_MAP.small).includes('micro'));

    // Ningún tamaño que guarda el cotizador queda fuera de los filtros.
    const ctx = wizard();
    const stored = JSON.parse(vm.runInContext('JSON.stringify(FIGMA_SIZE_OPTIONS.map((o) => toTitleCase(o.value)))', ctx));
    const buckets = Object.fromEntries(stored.map((value) => [value, Object.keys(SIZE_MAP).filter((size) => inFilter(size, value))]));
    for (const value of stored) assert.ok(buckets[value].length >= 1, `"${value}" no entra en ningún filtro de tamaño`);
    assert.deepEqual(buckets.Micro, ['small']);
    assert.deepEqual(buckets['Pequeño'], ['small']);
    assert.deepEqual(buckets['Media Manga'], ['large']);
    assert.deepEqual(buckets['Manga Completa'], ['xlarge']);

    assert.equal(sizeLabelFor({ tattoo_size: 'Micro' }), 'Micro (hasta 5 cm)');
    assert.equal(sizeLabelFor({ tattoo_size: 'Pequeño' }), 'Pequeño (menos de 10 cm)');
    assert.equal(sizeLabelFor({ tattoo_size: '' }), 'No especificado');
});
