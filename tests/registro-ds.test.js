'use strict';

// Revisión del registro (12 nov 2026) · grupo DS (controles propios).
// Lógica pura de select/fecha/prefijo (wo-controls.js), saneado y conteo del
// editor (wo-richtext.js), loader automático y utilidad .wo-enter.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const C = require('../public/shared/js/wo-controls.js');
const R = require('../public/shared/js/wo-richtext.js');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ---------------- select ---------------- */

test('select: búsqueda solo con más de 10 opciones', () => {
    assert.equal(C.shouldSearch(10), false);
    assert.equal(C.shouldSearch(11), true);
    assert.equal(C.SEARCH_THRESHOLD, 10);
});

test('select: el filtro ignora tildes, mayúsculas y espacios', () => {
    assert.equal(C.matchesQuery('Japón', 'japon'), true);
    assert.equal(C.matchesQuery('Países Bajos', 'PAISES  b'), true);
    assert.equal(C.matchesQuery('Perú', 'chile'), false);
    assert.equal(C.matchesQuery('Lo que sea', ''), true);
});

test('select: typeahead busca por prefijo, cicla con la misma letra y salta deshabilitadas', () => {
    const labels = ['Argentina', 'Alemania', 'Australia', 'Brasil', 'Bolivia'];
    const disabled = [false, true, false, false, false];
    assert.equal(C.typeaheadIndex(labels, disabled, -1, 'a'), 0);
    assert.equal(C.typeaheadIndex(labels, disabled, 0, 'a'), 2, 'salta Alemania (deshabilitada)');
    assert.equal(C.typeaheadIndex(labels, disabled, 2, 'aa'), 0, 'letra repetida cicla');
    assert.equal(C.typeaheadIndex(labels, disabled, 0, 'bo'), 4);
    assert.equal(C.typeaheadIndex(labels, disabled, 0, 'z'), -1);
    assert.equal(C.typeaheadIndex(['Ñandú', 'Óleo'], null, -1, 'o'), 1);
});

/* ---------------- fecha ---------------- */

test('fecha: formato visible dd/mm/aaaa y valor ISO', () => {
    assert.equal(C.formatDisplayDate('1995-06-01'), '01/06/1995');
    assert.equal(C.formatDisplayDate(''), '');
    assert.equal(C.parseDisplayDate('01/06/1995'), '1995-06-01');
    assert.equal(C.parseDisplayDate('1/6/1995'), '1995-06-01');
    assert.equal(C.parseDisplayDate('01-06-1995'), '1995-06-01');
    assert.equal(C.parseDisplayDate('01061995'), '1995-06-01');
    assert.equal(C.parseDisplayDate('31/02/2000'), null, 'día inexistente');
    assert.equal(C.parseDisplayDate('29/02/2000'), '2000-02-29', 'bisiesto');
    assert.equal(C.parseDisplayDate('29/02/1900'), null, '1900 no es bisiesto');
    assert.equal(C.parseDisplayDate('hola'), null);
    assert.equal(C.formatLongDate('2026-11-12'), 'jueves 12 de noviembre de 2026');
});

test('fecha: máscara de tipeo agrega las barras', () => {
    assert.equal(C.maskDateTyping('0'), '0');
    assert.equal(C.maskDateTyping('010'), '01/0');
    assert.equal(C.maskDateTyping('01061995'), '01/06/1995');
    assert.equal(C.maskDateTyping('01/06/19951'), '01/06/1995');
    assert.equal(C.maskDateTyping('ab12'), '12');
});

test('fecha: min/max (mayor de 18, sin fechas futuras)', () => {
    const today = '2026-11-12';
    const max = '2008-11-12'; // hoy - 18 años
    assert.equal(C.isInRange('2008-11-12', '', max), true);
    assert.equal(C.isInRange('2008-11-13', '', max), false);
    assert.equal(C.isInRange(today, '', max), false);
    assert.equal(C.isInRange('1926-11-11', '1926-11-12', max), false);
    assert.equal(C.clampISO(today, '1926-11-12', max), max, 'la vista inicial cae en el máximo');
    assert.equal(C.monthInRange(2008, 12, '', max), false);
    assert.equal(C.monthInRange(2008, 11, '', max), true);
    assert.equal(C.yearInRange(2009, '', max), false);
    assert.equal(C.dateRangeMessage('1926-11-12', max), 'Elegí una fecha entre el 12/11/1926 y el 12/11/2008.');
    assert.equal(C.dateRangeMessage('', max), 'Elegí una fecha hasta el 12/11/2008.');
});

test('fecha: aritmética de días y meses', () => {
    assert.equal(C.addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(C.addDays('2024-03-01', -1), '2024-02-29');
    assert.equal(C.addMonths('2024-01-31', 1), '2024-02-29', 'recorta al último día');
    assert.equal(C.addMonths('2024-01-15', -13), '2022-12-15');
    assert.equal(C.todayISO(new Date(2026, 10, 12)), '2026-11-12');
});

test('fecha: grilla de 6 semanas que empieza en lunes', () => {
    const weeks = C.calendarMatrix(2026, 11); // 1/11/2026 es domingo
    assert.equal(weeks.length, 6);
    weeks.forEach((w) => assert.equal(w.length, 7));
    assert.equal(weeks[0][0].iso, '2026-10-26');
    assert.equal(weeks[0][6].iso, '2026-11-01');
    assert.equal(weeks[0][6].inMonth, true);
    assert.equal(weeks[0][0].inMonth, false);
    assert.deepEqual(C.WEEKDAYS_SHORT, ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']);
});

/* ---------------- prefijo fijo ---------------- */

test('prefijo: @ quita arrobas y extrae el usuario de una URL pegada', () => {
    assert.equal(C.normalizePrefixedValue('@juan', '@'), 'juan');
    assert.equal(C.normalizePrefixedValue('@@juan', '@'), 'juan');
    assert.equal(C.normalizePrefixedValue('https://www.instagram.com/juan.tattoo/?hl=es', '@'), 'juan.tattoo');
    assert.equal(C.normalizePrefixedValue('instagram.com/juan', '@'), 'juan');
    assert.equal(C.normalizePrefixedValue('juan.tattoo', '@'), 'juan.tattoo');
});

test('prefijo: https:// y behance.net/ no se duplican al pegar la URL completa', () => {
    assert.equal(C.normalizePrefixedValue('https://weotzi.com', 'https://'), 'weotzi.com');
    assert.equal(C.normalizePrefixedValue('http://weotzi.com/a', 'https://'), 'weotzi.com/a');
    assert.equal(C.normalizePrefixedValue('https://https://weotzi.com', 'https://'), 'weotzi.com');
    assert.equal(C.normalizePrefixedValue('www.weotzi.com', 'https://'), 'www.weotzi.com');
    assert.equal(C.normalizePrefixedValue('https://www.behance.net/juan', 'behance.net/'), 'juan');
    assert.equal(C.normalizePrefixedValue('behance.net/juan', 'behance.net/'), 'juan');
    assert.equal(C.normalizePrefixedValue('Behance.net/Juan', 'behance.net/'), 'Juan');
    assert.equal(C.normalizePrefixedValue('juan', 'behance.net/'), 'juan');
});

/* ---------------- editor de texto ---------------- */

test('richtext: allowlist del servidor (b/strong, i/em, u, a, span, listas, p, br, mark)', () => {
    const html = '<div>Hola <b onclick="x()">mundo</b><script>alert(1)</script></div>'
        + '<font color="#ff0000" size="5">rojo</font>'
        + '<a href="javascript:alert(1)">malo</a><a href="https://weotzi.com?a=1&amp;b=2">bueno</a>'
        + '<span style="color: rgb(200, 45, 22); font-size: 24px; position: absolute">t</span>'
        + '<mark class="x">m</mark><img src=x onerror=alert(1)><iframe src="//x"></iframe>'
        + '<ul><li>uno<li>dos</ul><s>tachado</s>';
    assert.equal(R.sanitize(html),
        '<p>Hola <b>mundo</b></p><span style="color: #ff0000; font-size: 24px">rojo</span>malo'
        + '<a href="https://weotzi.com?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">bueno</a>'
        + '<span style="color: rgb(200, 45, 22); font-size: 24px">t</span><mark>m</mark>'
        + '<ul><li>uno</li><li>dos</li></ul>tachado');
});

test('richtext: estilos de Safari/Chrome pasan a etiquetas y lo vacío se descarta', () => {
    assert.equal(R.sanitize('<span style="font-weight: bold">a</span><span style="font-style: italic; color:#000">b</span>'),
        '<b>a</b><span style="color: #000"><i>b</i></span>');
    assert.equal(R.sanitize('<p>x <span style="background-color: transparent">y</span></p>'), '<p>x y</p>');
    assert.equal(R.sanitize('<p><br></p>'), '');
    assert.equal(R.sanitize('   '), '');
    assert.equal(R.sanitize('<div><div>a</div></div>'), '<p>a</p>');
    assert.equal(R.sanitize('<a href="mailto:hola@weotzi.com">mail</a>'), '<a href="mailto:hola@weotzi.com" target="_blank" rel="noopener noreferrer">mail</a>');
    assert.equal(R.sanitize('<span style="font-size: 200px; background: url(x)">z</span>'), 'z');
    assert.equal(R.sanitize('1 < 2 & 3 > 2'), '1 &lt; 2 &amp; 3 &gt; 2');
});

test('richtext: contador sobre el texto visible (emoji = 1, entidades decodificadas)', () => {
    assert.equal(R.visibleTextLength('<p>Hola&nbsp;<b>mundo</b></p>'), 10);
    assert.equal(R.visibleTextLength('<p>🔥🔥</p>'), 2);
    assert.equal(R.visibleTextLength('&lt;3'), 2);
    assert.equal(R.truncateText('ab🔥cd', 3), 'ab🔥');
    assert.equal(R.textToHtml('uno\ndos\n\ntres'), '<p>uno<br>dos</p><p>tres</p>');
    assert.equal(R.hasMarkup('texto plano'), false);
});

test('richtext: enlaces escritos por la persona', () => {
    assert.equal(R.normalizeLinkInput('weotzi.com/artista'), 'https://weotzi.com/artista');
    assert.equal(R.normalizeLinkInput('hola@weotzi.com'), 'mailto:hola@weotzi.com');
    assert.equal(R.normalizeLinkInput('https://weotzi.com'), 'https://weotzi.com');
    assert.equal(R.normalizeLinkInput('javascript:alert(1)'), '');
    assert.equal(R.normalizeLinkInput('no es un link'), '');
});

/* ---------------- loader ---------------- */

const LOADER_MARK = 'window.__woControlsLoader';

function runLoader(file, scriptSrc) {
    const appended = [];
    const head = { appendChild: (n) => appended.push(n) };
    const document = {
        currentScript: { src: scriptSrc },
        head,
        documentElement: head,
        createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
        addEventListener() {},
        readyState: 'complete',
        querySelectorAll: () => []
    };
    const window = {};
    const context = { window, document, console, URL, setTimeout, clearTimeout, URLSearchParams, localStorage: undefined, MutationObserver: function () { this.observe = () => {}; }, fetch: async () => ({ ok: false, text: async () => '' }) };
    context.self = window;
    const src = read(file);
    const start = src.indexOf('// DS · Controles propios');
    assert.ok(start > 0, file + ' tiene el bloque del loader');
    vm.runInNewContext(src.slice(start), context, { filename: file });
    return { window, appended };
}

test('loader: config-manager.js y wo-icons.js cargan CSS + JS de los controles una sola vez', () => {
    for (const file of ['public/shared/js/config-manager.js', 'public/shared/js/wo-icons.js']) {
        assert.ok(read(file).includes(LOADER_MARK), file);
        const { window, appended } = runLoader(file, 'https://beta.weotzi.com/beta/shared/js/' + path.basename(file) + '?v=1');
        assert.deepEqual(appended.map((n) => n.href || n.src), [
            'https://beta.weotzi.com/beta/shared/css/wo-controls.css',
            'https://beta.weotzi.com/beta/shared/js/wo-controls.js',
            'https://beta.weotzi.com/beta/shared/js/wo-richtext.js'
        ]);
        assert.equal(appended[1].async, false, 'orden de ejecución estable');
        assert.equal(typeof window.WoRichText.mount, 'function', 'stub de mount disponible antes de cargar');
        const pendingCtl = window.WoRichText.mount({ tagName: 'TEXTAREA' }, { maxLength: 2000 });
        assert.equal(pendingCtl.pending, true);
        assert.equal(window.WoRichText.__queue.length, 1);
        assert.equal(typeof window.WoControls.refresh, 'function');
    }
});

test('loader: la ruta del preview se respeta y no se duplica', () => {
    const { appended } = runLoader('public/shared/js/wo-icons.js', 'http://localhost:4672/preview/preview-local-safe/shared/js/wo-icons.js');
    assert.equal(appended[0].href, 'http://localhost:4672/preview/preview-local-safe/shared/css/wo-controls.css');
    // Segundo script en la misma página: el flag global corta.
    const src = read('public/shared/js/config-manager.js');
    const block = src.slice(src.indexOf('// DS · Controles propios'));
    const appended2 = [];
    const head = { appendChild: (n) => appended2.push(n) };
    const ctx = { window: { __woControlsLoader: true }, document: { currentScript: { src: 'http://x/shared/js/config-manager.js' }, head, documentElement: head, createElement: () => ({ setAttribute() {} }) } };
    vm.runInNewContext(block, ctx);
    assert.equal(appended2.length, 0);
});

test('archivos del DS: controles, editor y animación de entrada', () => {
    const css = read('public/shared/css/wo-controls.css');
    assert.match(css, /\.wo-ctl-native\{position:absolute!important/);
    assert.match(css, /\.wo-pop\{position:fixed;z-index:var\(--woc-z\)/);
    assert.match(css, /@media \(max-width:480px\)/);
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
    const ds = read('public/shared/css/ds/components.css');
    assert.match(ds, /@keyframes wo-enter\{/);
    assert.match(ds, /\.wo-enter,\.wo-enter-stagger>\*\{animation:wo-enter/);
    assert.match(ds, /--wo-enter-delay/);
    assert.match(ds, /@media \(prefers-reduced-motion:reduce\)\{\.wo-enter,\.wo-enter-stagger>\*\{animation:none\}\}/);
    // El chevron del select no se pierde ni se repite en hover/focus.
    assert.match(ds, /\.wo-select:hover\{background-color:/);
    assert.match(ds, /\.wo-select:focus\{background-color:/);
    const js = read('public/shared/js/wo-controls.js');
    assert.match(js, /closest\('\[data-native\]'\)/, 'opt-out por data-native');
    assert.match(js, /win\.WoControls = \{\s*enhance: enhance,\s*refresh: refresh/);
    assert.match(read('public/shared/js/wo-richtext.js'), /mount: mount,\s*sanitize: sanitize/);
});
