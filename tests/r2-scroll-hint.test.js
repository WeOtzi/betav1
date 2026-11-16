// Ronda 2 · P2 — "Evitar el scroll… y, si lo hay, un indicador animado".
//   - wo-scroll-hint.js: cuándo se muestra el indicador y cómo esquiva la barra fija.
//   - Carga única desde config-manager.js y wo-icons.js.
//   - quotation-pasos.css: los pasos 06 y 07 del cotizador en columnas desde 768 px.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const Hint = require('../public/shared/js/wo-scroll-hint.js');

test('shouldShow: solo arriba de todo y con contenido de verdad oculto', () => {
    const vh = 700;
    assert.equal(Hint.shouldShow({ scrollTop: 0, scrollHeight: vh, clientHeight: vh }), false, 'entra entero');
    assert.equal(Hint.shouldShow({ scrollTop: 0, scrollHeight: vh + Hint.MIN_OVERFLOW - 1, clientHeight: vh }), false, 'apenas sobra');
    assert.equal(Hint.shouldShow({ scrollTop: 0, scrollHeight: vh + Hint.MIN_OVERFLOW, clientHeight: vh }), true, 'sobra lo justo');
    assert.equal(Hint.shouldShow({ scrollTop: Hint.TOP_ZONE, scrollHeight: 2000, clientHeight: vh }), true, 'todavía arriba');
    assert.equal(Hint.shouldShow({ scrollTop: Hint.TOP_ZONE + 1, scrollHeight: 2000, clientHeight: vh }), false, 'ya se desplazó');
    assert.equal(Hint.shouldShow({ scrollTop: -40, scrollHeight: 2000, clientHeight: vh }), true, 'rebote elástico de iOS');
    assert.equal(Hint.shouldShow(null), false);
    assert.equal(Hint.shouldShow({}), false);
});

// DOM mínimo para probar la elección de contenedor y la barra fija sin navegador.
function fakeWindow({ innerHeight = 700, innerWidth = 1200, pageHeight = 700, pageYOffset = 0, stack = [], footers = [], styles = new Map(), modals = [], attr = null } = {}) {
    const html = { nodeType: 1, scrollHeight: pageHeight, clientHeight: innerHeight, scrollTop: pageYOffset, parentElement: null, getAttribute: (n) => (n === 'data-wo-scroll-hint' ? attr : null) };
    const body = { nodeType: 1, scrollHeight: pageHeight, clientHeight: innerHeight, parentElement: html };
    const document = {
        documentElement: html,
        body,
        scrollingElement: html,
        elementFromPoint: () => stack[0] || body,
        elementsFromPoint: () => (stack.length ? stack : [body]),
        querySelectorAll: (sel) => (/^footer/.test(sel) ? footers : (/dialog\[open\]/.test(sel) ? modals : []))
    };
    const win = {
        document,
        innerHeight,
        innerWidth,
        pageYOffset,
        getComputedStyle: (el) => styles.get(el) || { overflowY: 'visible', position: 'static' }
    };
    return { win, html, body };
}

function el(props, parent) {
    return Object.assign({ nodeType: 1, parentElement: parent || null, contains: () => false, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, width: 0 }) }, props);
}

test('pickScroller: el documento por defecto; un panel interno si es el que desplaza', () => {
    const plain = fakeWindow({ pageHeight: 2000 });
    assert.equal(Hint.pickScroller(plain.win), plain.html);

    const styles = new Map();
    const shell = fakeWindow({ styles });
    const panel = el({ scrollHeight: 1800, clientHeight: 600, scrollTop: 0 }, shell.body);
    const leaf = el({ scrollHeight: 20, clientHeight: 20 }, panel);
    styles.set(panel, { overflowY: 'auto', position: 'static' });
    shell.win.document.elementFromPoint = () => leaf;
    assert.equal(Hint.pickScroller(shell.win), panel, 'el panel con overflow propio');

    // Una cajita con scroll (lista corta) no cuenta como la pantalla.
    const small = el({ scrollHeight: 900, clientHeight: 200, scrollTop: 0 }, shell.body);
    styles.set(small, { overflowY: 'auto', position: 'static' });
    shell.win.document.elementFromPoint = () => small;
    assert.equal(Hint.pickScroller(shell.win), shell.html);
});

test('metrics: el pie del sitio no cuenta como contenido oculto', () => {
    const footer = el({ getBoundingClientRect: () => ({ top: 760, bottom: 840, height: 80, width: 1200 }) });
    const withFooter = fakeWindow({ pageHeight: 840, footers: [footer] });
    const m = Hint.metrics(withFooter.win, withFooter.html);
    assert.equal(m.scrollHeight, 760, 'se descuenta el pie');
    assert.equal(Hint.shouldShow(m), true, 'quedan 60 px de contenido debajo');

    const justFooter = fakeWindow({ pageHeight: 780, footers: [el({ getBoundingClientRect: () => ({ top: 700, bottom: 780, height: 80, width: 1200 }) })] });
    assert.equal(Hint.shouldShow(Hint.metrics(justFooter.win, justFooter.html)), false, 'bajar solo para ver el pie no amerita aviso');

    // Un "footer" de tarjeta, angosto o en medio de la página, no se descuenta.
    const card = el({ getBoundingClientRect: () => ({ top: 300, bottom: 360, height: 60, width: 300 }) });
    const mid = fakeWindow({ pageHeight: 1500, footers: [card] });
    assert.equal(Hint.metrics(mid.win, mid.html).scrollHeight, 1500);
});

test('bottomBarHeight: se corre por encima de una barra fija pegada abajo', () => {
    const styles = new Map();
    const w = fakeWindow({ styles });
    const bar = el({ getBoundingClientRect: () => ({ top: 579, bottom: 700, height: 121, width: 1044 }) }, w.body);
    const button = el({}, bar);
    styles.set(bar, { overflowY: 'visible', position: 'sticky' });
    w.win.document.elementsFromPoint = () => [button, bar, w.body];
    assert.equal(Hint.bottomBarHeight(w.win, null), 121);

    // Un panel lateral fijo (alto) o un botón flotante (angosto) no son una barra.
    const tall = el({ getBoundingClientRect: () => ({ top: 100, bottom: 700, height: 600, width: 1200 }) }, w.body);
    styles.set(tall, { overflowY: 'visible', position: 'fixed' });
    w.win.document.elementsFromPoint = () => [tall, w.body];
    assert.equal(Hint.bottomBarHeight(w.win, null), 0);
    const fab = el({ getBoundingClientRect: () => ({ top: 640, bottom: 700, height: 60, width: 60 }) }, w.body);
    styles.set(fab, { overflowY: 'visible', position: 'fixed' });
    w.win.document.elementsFromPoint = () => [fab, w.body];
    assert.equal(Hint.bottomBarHeight(w.win, null), 0);
    // Sin nada fijo abajo.
    w.win.document.elementsFromPoint = () => [w.body];
    assert.equal(Hint.bottomBarHeight(w.win, null), 0);
});

test('blocked: no se muestra con un diálogo abierto, con el scroll bloqueado ni con el opt-out', () => {
    assert.equal(Hint.blocked(fakeWindow({ pageHeight: 2000 }).win), false);
    assert.equal(Hint.blocked(fakeWindow({ pageHeight: 2000, modals: [{ getClientRects: () => [{}] }] }).win), true, 'diálogo abierto');
    assert.equal(Hint.blocked(fakeWindow({ pageHeight: 2000, modals: [{ getClientRects: () => [] }] }).win), false, 'un diálogo en el DOM pero oculto con una clase no bloquea');
    assert.equal(Hint.blocked(fakeWindow({ pageHeight: 2000, attr: 'off' }).win), true, 'opt-out de la página');
    const styles = new Map();
    const locked = fakeWindow({ pageHeight: 2000, styles });
    styles.set(locked.body, { overflowY: 'hidden', position: 'static' });
    assert.equal(Hint.blocked(locked.win), true, 'scroll del documento bloqueado');
    // Una app de pantalla fija (overflow hidden, sin desborde) no bloquea: el aviso mira su panel interno.
    const fixedStyles = new Map();
    const fixed = fakeWindow({ pageHeight: 700, styles: fixedStyles });
    fixedStyles.set(fixed.body, { overflowY: 'hidden', position: 'static' });
    assert.equal(Hint.blocked(fixed.win), false);
});

test('módulo: accesible, sin movimiento si la persona lo pide y como mejora progresiva', () => {
    const js = read('public/shared/js/wo-scroll-hint.js');
    assert.match(js, /btn\.type = 'button'/);
    assert.match(js, /setAttribute\('aria-label', 'Ver lo que sigue abajo'\)/);
    assert.match(js, /prefers-reduced-motion: reduce/);
    assert.match(js, /behavior: reduced \? 'auto' : 'smooth'/);
    assert.match(js, /addEventListener\('scroll', schedule, \{ capture: true, passive: true \}\)/, 'el scroll de los paneles internos no burbujea: se escucha en captura');
    assert.doesNotMatch(js, /innerHTML = [^;]*\+ *(?!ICON)[a-zA-Z_]+\.[a-zA-Z]/, 'el botón no interpola datos de la página');

    const css = read('public/shared/css/wo-scroll-hint.css');
    assert.match(css, /\.wo-scroll-hint\{[^}]*position:fixed/);
    assert.match(css, /\.wo-scroll-hint\[hidden\]\{display:none\}/);
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\s*\.wo-scroll-hint,\.wo-scroll-hint-arrow\{animation:none\}/);
    assert.match(css, /@media print\{\s*\.wo-scroll-hint\{display:none\}/);
    assert.match(css, /width:var\(--tap-target-min,44px\);height:var\(--tap-target-min,44px\)/, 'área táctil de 44 px');
    assert.match(css, /bottom:calc\(var\(--wo-scroll-hint-bottom,16px\) \+ env\(safe-area-inset-bottom,0px\)\)/);
});

test('carga única: config-manager.js y wo-icons.js piden el módulo y su hoja una sola vez', () => {
    for (const rel of ['public/shared/js/config-manager.js', 'public/shared/js/wo-icons.js']) {
        const js = read(rel);
        const block = js.slice(js.indexOf('Indicador de "hay más abajo"'));
        assert.ok(js.includes('__woScrollHintLoader'), rel + ' carga el indicador');
        assert.match(block, /if \(window\.__woScrollHintLoader\) return;/, rel + ' no lo carga dos veces');
        assert.match(block, /css\/wo-scroll-hint\.css/);
        assert.match(block, /js\/wo-scroll-hint\.js/);
        assert.match(block, /data-wo-scroll-hint'\) === 'off'/, rel + ' respeta el opt-out');
    }
});

test('cotizador: los pasos 06 y 07 se reparten en columnas desde 768 px y el teléfono no cambia', () => {
    const css = read('public/shared/css/quotation-pasos.css').replace(/\r\n/g, '\n');
    const section = css.slice(css.indexOf('Una pantalla en PC y tablet'));
    assert.ok(section.length > 500, 'existe la sección de una pantalla');
    assert.doesNotMatch(section, /@media \((?:max-width: 767px|max-width: 480px)\)/, 'la sección no toca el teléfono');
    assert.match(section, /@media \(min-width: 768px\) \{\n[\s\S]*?#screen-details \.q-blocks \{\n\s*display: grid;\n\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    assert.match(section, /#screen-details #block-date \{ grid-column: 2; grid-row: 1 \/ span 3; \}/, 'la fecha ocupa la columna derecha');
    assert.match(section, /#screen-client \.q-blocks \{\n\s*display: grid;\n\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(section, /@media \(min-width: 1000px\) \{[\s\S]*?#screen-client \.q-blocks \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/, 'tres columnas en escritorio');
    assert.match(section, /@media \(min-width: 768px\) and \(max-height: 960px\) \{/, 'menos aire vertical en pantallas bajas');
    assert.match(section, /@media \(min-width: 768px\) and \(max-height: 740px\) \{/, 'escalón extra para ventanas de 740 px o menos');
    // La portada del artista (Figma) no entra en la compactación.
    for (const line of section.split('\n').filter((l) => /\.quotation-page[^{]*\.q-screen(-title)? \{/.test(l))) {
        assert.match(line, /\.quotation-page:not\(\.q-artist-confirm-page\)/, line.trim());
    }
    // El presupuesto de alto de la silueta descuenta la barra inferior real (121 px), no la de 80.
    assert.match(css, /--qp-fig-h: clamp\(260px, min\(calc\(100vh - 505px\), 38vw\), 540px\);/);
});
