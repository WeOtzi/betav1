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
