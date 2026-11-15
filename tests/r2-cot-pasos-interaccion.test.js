'use strict';
// Ronda 2 · frente cot-pasos — recorridos de usuario sobre los controladores
// reales (silueta + zonas, estilos, tamaños) con un DOM mínimo de test
// (tests/helpers/mini-dom.js): clics, teclado, hover, fotos que no cargan y el
// botón "Continuar" del wizard.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createDocument, createEvent } = require('./helpers/mini-dom');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
// Los módulos corren en otro contexto (vm): sus arrays tienen otro prototipo.
const plain = (value) => JSON.parse(JSON.stringify(value));

const part = (id, label, sides, pain) => ({ id, label, sides, pain_level: pain, description: '', tattoo_info: '', experience_info: '', fun_fact: '' });
const TREE = [
    { ...part('brazo', 'Brazo', 'both', 5), image: 'https://cdn.example.test/brazo.jpg', fun_fact: 'Dato del brazo.', subparts: [
        part('hombro', 'Hombro', 'both', 6), part('brazo_superior', 'Brazo Superior', 'both', 4), part('codo', 'Codo', 'both', 8),
        part('antebrazo', 'Antebrazo', 'both', 5), part('muneca', 'Muñeca', 'both', 7), part('mano', 'Mano', 'both', 8), part('dedos_mano', 'Dedos', 'both', 9)] },
    { ...part('torso', 'Torso', 'none', 5), subparts: [
        part('pecho', 'Pecho', 'both', 6), part('abdomen', 'Abdomen', 'none', 7), part('costillas', 'Costillas', 'both', 9)] },
    { ...part('cabeza', 'Cabeza', 'none', 7), subparts: [part('craneo', 'Cráneo', 'none', 10), part('cara', 'Cara', 'none', 9)] }
];

function page(files) {
    const document = createDocument();
    const sandbox = { console, document };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    const context = vm.createContext(sandbox);
    for (const file of files) vm.runInContext(read('public', 'shared', 'js', file), context);
    return { document, window: context };
}

function bodyPage(options = {}) {
    const { document, window } = page(['quotation-body-model.js', 'quotation-body-figure.js', 'quotation-body-map.js']);
    const host = document.createElement('div');
    host.setAttribute('id', 'body-selector');
    document.body.appendChild(host);
    // Barra del wizard: "Continuar" avanza con su propio handler.
    const next = document.createElement('button');
    next.setAttribute('id', 'continue-btn');
    document.body.appendChild(next);
    const state = { changes: [], advanced: 0 };
    next.addEventListener('click', () => { state.advanced += 1; });
    const selection = window.WoQuotationBody.mount(host, Object.assign({
        tree: TREE, selection: [],
        onChange: (items, info) => state.changes.push({ items: plain(items), info: plain(info) })
    }, options));
    const $ = (selector) => host.querySelector(selector);
    const $$ = (selector) => host.querySelectorAll(selector);
    const shape = (view, id, side) => $$(`.qp-fig-part[data-part="${id}"]`).find((node) =>
        node.ownerSVGElement.getAttribute('data-qp-view') === view && (node.getAttribute('data-side') || null) === (side || null));
    const last = () => state.changes[state.changes.length - 1];
    return { document, window, host, next, state, selection: plain(selection), $, $$, shape, last };
}

const change = (node) => node.dispatchEvent(createEvent('change', { bubbles: true }));
const key = (node, k) => { const e = createEvent('keydown', { bubbles: true, key: k }); node.dispatchEvent(e); return e; };

// ---------------------------------------------------------------------------
// Silueta
// ---------------------------------------------------------------------------
test('silueta: un clic selecciona la parte individual, queda marcada y aparece en el resumen', () => {
    const p = bodyPage();
    assert.deepEqual(p.selection, []);
    const forearm = p.shape('front', 'antebrazo', 'left');
    assert.equal(forearm.getAttribute('aria-checked'), 'false');
    forearm.click();
    assert.deepEqual(p.last().items, [{ part: 'antebrazo', side: 'left' }]);
    assert.equal(p.last().info.bodyPart, 'Brazo: Antebrazo');
    assert.equal(p.last().info.bodySide, 'Izquierdo');
    assert.ok(forearm.classList.contains('is-selected'));
    assert.equal(forearm.getAttribute('aria-checked'), 'true');
    // La misma parte se ve elegida en la vista de espalda; el otro lado no.
    assert.ok(p.shape('back', 'antebrazo', 'left').classList.contains('is-selected'));
    assert.ok(!p.shape('front', 'antebrazo', 'right').classList.contains('is-selected'));
    assert.match(p.$('[data-qp-summary]').textContent, /Tu selección.*Brazo lado izquierdo · Antebrazo/);
    assert.equal(p.$('[data-qp-status]').textContent, 'Elegiste Antebrazo · lado izquierdo. Dolor 5/10 · moderado.');
    // La zona de la grilla refleja la selección parcial.
    assert.ok(p.$('[data-qp-zone="brazo"]').classList.contains('is-selected'));
    assert.equal(p.$('[data-qp-zone="brazo"]').querySelector('.qp-zone-state').textContent, 'lado izquierdo · Antebrazo');
});

test('silueta: segundo clic la quita; partes centrales no llevan lado', () => {
    const p = bodyPage();
    p.shape('front', 'abdomen').click();
    assert.deepEqual(p.last().items, [{ part: 'abdomen', side: null }]);
    assert.equal(p.last().info.bodySide, null);
    p.shape('back', 'antebrazo', 'right').click();
    p.shape('back', 'antebrazo', 'right').click();
    assert.deepEqual(p.last().items, [{ part: 'abdomen', side: null }]);
    assert.equal(p.$('[data-qp-status]').textContent, 'Quitaste Antebrazo · lado derecho.');
    p.shape('front', 'abdomen').click();
    assert.deepEqual(p.last().items, []);
    assert.match(p.$('[data-qp-summary]').textContent, /Aún no has elegido ninguna parte\./);
    // Partes que el catálogo de prueba no tiene: dibujadas pero inertes.
    assert.ok(p.$$('.qp-fig-part.is-inert').length > 0);
    const before = p.state.changes.length;
    p.$('.qp-fig-part.is-inert').click();
    assert.equal(p.state.changes.length, before);
});

test('silueta con mouse: al pasar se muestra el nombre; con el dedo no queda el cartel', () => {
    const p = bodyPage();
    const hand = p.shape('front', 'mano', 'right');
    hand.dispatchEvent(createEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX: 40, clientY: 200 }));
    const tip = p.$('[data-qp-tip]');
    assert.equal(tip.hidden, false);
    assert.equal(tip.textContent, 'Mano · lado derecho');
    assert.equal(p.$('[data-qp-status]').textContent, 'Mano · lado derecho — Dolor 8/10 · alto');
    hand.dispatchEvent(createEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
    assert.equal(tip.hidden, true);
    hand.dispatchEvent(createEvent('pointerover', { bubbles: true, pointerType: 'touch' }));
    assert.equal(tip.hidden, true);
    // Pasar por una zona de la grilla insinúa sus partes en la silueta.
    const tile = p.$('[data-qp-zone="torso"]');
    tile.dispatchEvent(createEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    assert.ok(p.shape('front', 'pecho', 'left').classList.contains('is-hint'));
    assert.ok(!p.shape('front', 'mano', 'left').classList.contains('is-hint'));
    tile.dispatchEvent(createEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
    assert.ok(!p.shape('front', 'pecho', 'left').classList.contains('is-hint'));
});

test('silueta con teclado: flechas para moverse, Espacio o Enter para elegir sin avanzar', () => {
    const p = bodyPage();
    let globalEnter = 0;
    p.document.addEventListener('keydown', (e) => { if (e.key === 'Enter') globalEnter += 1; });
    const svg = p.$('.qp-fig-svg[data-qp-view="front"]');
    const all = svg.querySelectorAll('.qp-fig-part[data-part]');
    assert.equal(all.filter((n) => n.getAttribute('tabindex') === '0').length, 1);
    all[0].focus();
    assert.equal(p.$('[data-qp-status]').textContent.startsWith(all[0].getAttribute('aria-label')), true);
    assert.equal(key(all[0], 'ArrowDown').defaultPrevented, true);
    assert.equal(p.document.activeElement, all[1]);
    assert.equal(all[1].getAttribute('tabindex'), '0');
    assert.equal(all[0].getAttribute('tabindex'), '-1');
    key(all[1], 'ArrowUp'); key(all[0], 'ArrowUp');
    assert.equal(p.document.activeElement, all[all.length - 1], 'da la vuelta');
    key(p.document.activeElement, 'Home');
    assert.equal(p.document.activeElement, all[0]);
    key(all[0], 'End');
    const lastShape = p.document.activeElement;
    assert.equal(lastShape, all[all.length - 1]);

    const space = key(lastShape, ' ');
    assert.equal(space.defaultPrevented, true);
    assert.equal(p.last().items.length, 1);
    assert.equal(lastShape.getAttribute('aria-checked'), 'true');
    assert.equal(p.document.activeElement, lastShape, 'el foco no se pierde al elegir');
    key(lastShape, 'Enter');
    assert.deepEqual(p.last().items, []);
    assert.equal(globalEnter, 0, 'Enter sobre la silueta no llega al atajo "Continuar" del wizard');
    // Enter sobre un botón de la grilla tampoco avanza el wizard.
    key(p.$('[data-qp-zone="brazo"]'), 'Enter');
    assert.equal(globalEnter, 0);
});

// ---------------------------------------------------------------------------
// Grilla → ficha → confirmar
// ---------------------------------------------------------------------------
test('grilla: elegir una zona abre su ficha; al confirmar vuelve la grilla con la zona resaltada', () => {
    const p = bodyPage();
    assert.equal(p.$$('[data-qp-zone]').length, 3);
    p.$('[data-qp-zone="brazo"]').click();
    assert.equal(p.$$('[data-qp-zone]').length, 0, 'la ficha reemplaza a la grilla');
    assert.ok(p.$('[data-qp-panel]'));
    assert.equal(p.document.activeElement, p.$('#qp-panel-title'));
    assert.equal(p.$('#qp-panel-title').textContent, 'Brazo');
    assert.equal(p.$$('[data-qp-side]').length, 3);
    assert.ok(p.$$('[data-qp-part]').every((box) => box.checked));
    assert.equal(p.state.changes.length, 0, 'abrir la ficha no cambia la selección');
    assert.equal(p.$('[data-qp-status]').textContent, 'Brazo: elige el lado, revisa las subpartes y confirma.');
    assert.equal(p.$$('[data-qp-part]')[0].getAttribute('aria-label'), 'Hombro, dolor 6 de 10');

    // Mientras falta el lado, la silueta insinúa el brazo completo de ambos lados.
    assert.ok(p.shape('front', 'mano', 'left').classList.contains('is-hint'));
    assert.ok(p.shape('back', 'codo', 'right').classList.contains('is-hint'));
    assert.ok(!p.shape('front', 'pecho', 'left').classList.contains('is-hint'));
    assert.ok(!p.shape('front', 'mano', 'left').classList.contains('is-selected'));

    // Confirmar sin lado: no avanza y dice qué falta.
    p.$('[data-qp-action="confirm"]').click();
    assert.equal(p.state.changes.length, 0);
    assert.equal(p.$('[data-qp-error]').hidden, false);
    assert.equal(p.$('[data-qp-error]').textContent, 'Elige de qué lado va el tatuaje.');
    assert.equal(p.document.activeElement, p.$('[data-qp-side]'));

    // Lado izquierdo: la silueta muestra la vista previa de todo el brazo.
    const left = p.$$('[data-qp-side]').find((radio) => radio.value === 'left');
    left.checked = true; change(left);
    assert.equal(p.$('[data-qp-error]').hidden, true);
    assert.ok(p.shape('front', 'hombro', 'left').classList.contains('is-selected'));
    assert.ok(p.shape('front', 'hombro', 'left').classList.contains('is-preview'));
    assert.ok(!p.shape('front', 'hombro', 'right').classList.contains('is-selected'));

    // Se desmarcan dos subpartes.
    for (const id of ['codo', 'dedos_mano']) {
        const box = p.$$('[data-qp-part]').find((b) => b.value === id);
        box.checked = false; change(box);
    }
    assert.ok(!p.shape('back', 'codo', 'left').classList.contains('is-selected'));

    p.$('[data-qp-action="confirm"]').click();
    assert.equal(p.state.changes.length, 1);
    assert.deepEqual(p.last().items.map((item) => item.part + ':' + item.side),
        ['hombro:left', 'brazo_superior:left', 'antebrazo:left', 'muneca:left', 'mano:left']);
    assert.equal(p.last().info.bodyPart, 'Brazo: Hombro, Brazo Superior, Antebrazo, Muñeca, Mano');
    assert.equal(p.last().info.bodySide, 'Izquierdo');
    // Vuelve la grilla, con la zona resaltada y el foco en su tarjeta.
    assert.equal(p.$('[data-qp-panel]'), null);
    const tile = p.$('[data-qp-zone="brazo"]');
    assert.ok(tile.classList.contains('is-selected'));
    assert.equal(tile.getAttribute('aria-pressed'), 'true');
    assert.equal(p.document.activeElement, tile);
    assert.ok(p.shape('front', 'mano', 'left').classList.contains('is-selected'));
    assert.ok(!p.shape('front', 'mano', 'left').classList.contains('is-preview'));
    assert.equal(p.$('[data-qp-status]').textContent, 'Listo: Brazo · lado izquierdo · Hombro, Brazo Superior, Antebrazo, Muñeca, Mano.');
});

test('ficha: editar una zona elegida, quitarla y cancelar', () => {
    const p = bodyPage({ selection: [{ part: 'antebrazo', side: 'left' }, { part: 'abdomen', side: null }] });
    assert.equal(p.selection.length, 2);
    // Desde el resumen se reabre la ficha con lo que ya tiene.
    p.$('[data-qp-edit-zone="brazo"]').click();
    assert.equal(p.$$('[data-qp-side]').find((r) => r.checked).value, 'left');
    assert.deepEqual(p.$$('[data-qp-part]').filter((b) => b.checked).map((b) => b.value), ['antebrazo']);
    assert.equal(p.$('[data-qp-action="confirm"]').textContent, 'Guardar cambios');
    // Cancelar (o Escape) no cambia nada.
    p.$('[data-qp-action="cancel"]').click();
    assert.equal(p.state.changes.length, 0);
    assert.equal(p.$$('[data-qp-zone]').length, 3);
    p.$('[data-qp-zone="brazo"]').click();
    key(p.$('#qp-panel-title'), 'Escape');
    assert.equal(p.$('[data-qp-panel]'), null);
    // Ambos lados.
    p.$('[data-qp-zone="brazo"]').click();
    const both = p.$$('[data-qp-side]').find((r) => r.value === 'both');
    both.checked = true; change(both);
    p.$('[data-qp-action="confirm"]').click();
    assert.equal(p.last().info.bodyPart, 'Brazo: Antebrazo + Torso: Abdomen');
    assert.equal(p.last().info.bodySide, 'Ambos');
    // Quitar la zona desde la ficha y desde el resumen.
    p.$('[data-qp-zone="brazo"]').click();
    p.$('[data-qp-action="remove"]').click();
    assert.deepEqual(p.last().items, [{ part: 'abdomen', side: null }]);
    assert.equal(p.$('[data-qp-panel]'), null);
    p.$('[data-qp-remove-zone="torso"]').click();
    assert.deepEqual(p.last().items, []);
    assert.equal(p.$('[data-qp-status]').textContent, 'Quitaste Torso de tu selección.');
});

test('ficha de una zona central: ambos lados por defecto; sin partes con lado no se pregunta', () => {
    const p = bodyPage();
    p.$('[data-qp-zone="torso"]').click();
    assert.equal(p.$$('[data-qp-side]').find((r) => r.checked).value, 'both');
    // Se dejan solo las partes sin lado: el campo "¿De qué lado?" desaparece.
    for (const id of ['pecho', 'costillas']) {
        const box = p.$$('[data-qp-part]').find((b) => b.value === id);
        box.checked = false; change(box);
    }
    assert.equal(p.$('[data-qp-side-field]'), null);
    assert.deepEqual(p.$$('[data-qp-part]').filter((b) => b.checked).map((b) => b.value), ['abdomen']);
    // Sin ninguna subparte marcada no se puede confirmar.
    const abdomen = p.$$('[data-qp-part]').find((b) => b.value === 'abdomen');
    abdomen.checked = false; change(abdomen);
    p.$('[data-qp-action="confirm"]').click();
    assert.equal(p.$('[data-qp-error]').textContent, 'Deja marcada al menos una subparte.');
    assert.equal(p.state.changes.length, 0);
    abdomen.checked = true; change(abdomen);
    p.$('[data-qp-action="confirm"]').click();
    assert.deepEqual(p.last().items, [{ part: 'abdomen', side: null }]);
    // Cabeza no tiene partes con lado: se confirma directo.
    p.$('[data-qp-zone="cabeza"]').click();
    assert.equal(p.$$('[data-qp-side]').length, 0);
    assert.equal(p.$('[data-qp-status]').textContent, 'Cabeza: revisa las subpartes y confirma.');
    p.$('[data-qp-action="confirm"]').click();
    assert.equal(p.last().info.bodyPart, 'Torso: Abdomen + Cabeza');
    assert.equal(p.last().info.bodySide, null);
    // "Quitar todo".
    p.$('[data-qp-clear]').click();
    assert.deepEqual(p.last().items, []);
});

test('clic en la silueta con una ficha abierta: la ficha se actualiza con lo marcado', () => {
    const p = bodyPage();
    p.$('[data-qp-zone="brazo"]').click();
    p.shape('front', 'mano', 'right').click();
    assert.deepEqual(p.last().items, [{ part: 'mano', side: 'right' }]);
    assert.equal(p.$$('[data-qp-side]').find((r) => r.checked).value, 'right');
    assert.deepEqual(p.$$('[data-qp-part]').filter((b) => b.checked).map((b) => b.value), ['mano']);
    assert.equal(p.$('[data-qp-action="confirm"]').textContent, 'Guardar cambios');
});

// ---------------------------------------------------------------------------
// "Continuar" del wizard con la ficha abierta
// ---------------------------------------------------------------------------
test('Continuar: con la ficha a medio completar no avanza; completa, se confirma sola', () => {
    const p = bodyPage();
    p.next.click();
    assert.equal(p.state.advanced, 1, 'sin ficha abierta, el botón sigue su curso');

    p.$('[data-qp-zone="brazo"]').click();
    p.next.click();
    assert.equal(p.state.advanced, 1, 'falta el lado: no avanza');
    assert.equal(p.$('[data-qp-error]').textContent, 'Elige de qué lado va el tatuaje.');
    assert.equal(p.state.changes.length, 0);

    const right = p.$$('[data-qp-side]').find((r) => r.value === 'right');
    right.checked = true; change(right);
    p.next.click();
    assert.equal(p.state.advanced, 2);
    assert.equal(p.state.changes.length, 1, 'la ficha completa se confirma al continuar');
    assert.equal(p.last().info.bodyPart, 'Brazo');
    assert.equal(p.last().info.bodySide, 'Derecho');
});

test('Continuar: una ficha abierta solo para mirar no agrega nada si ya hay selección', () => {
    const p = bodyPage({ selection: [{ part: 'craneo', side: null }] });
    p.$('[data-qp-zone="torso"]').click(); // torso arranca válido (ambos lados)
    p.next.click();
    assert.equal(p.state.advanced, 1);
    assert.equal(p.state.changes.length, 0, 'no se agregó el torso');
    assert.equal(p.$('[data-qp-panel]'), null);
    // Si en cambio la tocó, sí se confirma.
    p.$('[data-qp-zone="torso"]').click();
    const box = p.$$('[data-qp-part]').find((b) => b.value === 'costillas');
    box.checked = false; change(box);
    p.next.click();
    assert.equal(p.state.advanced, 2);
    assert.equal(p.last().info.bodyPart, 'Torso: Pecho, Abdomen + Cabeza: Cráneo');
});

// ---------------------------------------------------------------------------
// Montaje: borradores, pre-cotizador y fotos
// ---------------------------------------------------------------------------
test('montaje: borrador viejo migrado, texto del pre-cotizador y reinicio', () => {
    const legacy = bodyPage({ selection: [{ key: 'brazo::antebrazo', id: 'antebrazo', zone: 'brazo', sides: 'both', side: 'right', sideLabel: 'Derecho' }] });
    assert.deepEqual(legacy.selection, [{ part: 'antebrazo', side: 'right' }]);
    assert.ok(legacy.shape('front', 'antebrazo', 'right').classList.contains('is-selected'));
    assert.equal(legacy.state.changes.length, 0, 'montar no dispara onChange');

    // El pre-cotizador no trae lado: se abre la ficha con las subpartes ya marcadas.
    const pre = bodyPage({ selection: [], bodyPart: 'Brazo: Antebrazo, Mano', bodySide: null });
    assert.deepEqual(pre.selection, []);
    assert.equal(pre.$('#qp-panel-title').textContent, 'Brazo');
    assert.deepEqual(pre.$$('[data-qp-part]').filter((b) => b.checked).map((b) => b.value), ['antebrazo', 'mano']);
    // Texto con lado: se recupera completo.
    const saved = bodyPage({ selection: [], bodyPart: 'Brazo: Antebrazo, Mano', bodySide: 'Izquierdo' });
    assert.deepEqual(saved.selection, [{ part: 'antebrazo', side: 'left' }, { part: 'mano', side: 'left' }]);
    assert.equal(saved.$('[data-qp-panel]'), null);

    saved.window.WoQuotationBody.reset();
    assert.equal(saved.$$('.qp-fig-part.is-selected').length, 0);
    assert.match(saved.$('[data-qp-summary]').textContent, /Aún no has elegido/);
    assert.equal(saved.state.changes.length, 0, 'reset lo decide el wizard: no avisa cambios');

    // Sin los módulos del modelo, el contenedor avisa en vez de romper.
    const { document, window } = page(['quotation-body-map.js']);
    const host = document.createElement('div');
    document.body.appendChild(host);
    assert.deepEqual(plain(window.WoQuotationBody.mount(host, { tree: TREE, selection: [{ part: 'x', side: null }] })), [{ part: 'x', side: null }]);
    assert.match(host.textContent, /No pudimos cargar el selector de zonas\. Recarga la página\./);
    assert.deepEqual(plain(window.WoQuotationBody.mount(null, { selection: [] })), []);
});

test('fotos de zona: local → la de body_parts → silueta de respaldo', () => {
    const p = bodyPage();
    const tile = p.$('[data-qp-zone="brazo"]');
    const img = () => tile.querySelector('.qp-zone-img');
    assert.equal(img().getAttribute('src'), '/shared/assets/ronda2/cot-pasos/zona-brazo.webp');
    assert.ok(tile.querySelector('.qp-zone-fallback'), 'la ilustración está debajo desde el inicio');
    img().dispatchEvent(createEvent('error')); // no burbujea: se escucha en captura
    assert.equal(img().getAttribute('src'), 'https://cdn.example.test/brazo.jpg');
    assert.equal(img().hasAttribute('data-qp-alt-src'), false);
    img().dispatchEvent(createEvent('error'));
    assert.equal(img(), null);
    assert.ok(tile.querySelector('.qp-mini-svg'));
    // Zona sin foto en body_parts: un solo intento.
    const torso = p.$('[data-qp-zone="torso"]').querySelector('.qp-zone-img');
    assert.equal(torso.hasAttribute('data-qp-alt-src'), false);
});

// ---------------------------------------------------------------------------
// Estilos y tamaños
// ---------------------------------------------------------------------------
test('estilos: la grilla se ordena, avisa el motivo, delega el clic y conserva el foco', () => {
    const { document, window } = page(['quotation-style-model.js', 'quotation-style-step.js']);
    const block = document.createElement('div');
    const grid = document.createElement('div');
    grid.setAttribute('id', 'styles-grid');
    block.appendChild(grid);
    document.body.appendChild(block);
    const styles = [
        { id: 's1', name: 'Realismo', slug: 'realismo', cover_image_url: 'https://cdn.example.test/realismo.jpg' },
        { id: 's2', name: 'Japonés', slug: 'japones' },
        { id: 's3', name: 'Blackwork', slug: 'blackwork' }
    ];
    const selected = new Set();
    const toggles = [];
    const ctx = {
        artistName: 'Ana Tinta', artistStyles: ['BLACKWORK', 'Japones'], idea: 'un dragón japonés',
        isSelected: (id) => selected.has(id),
        onToggle: (id) => { toggles.push(id); if (selected.has(id)) selected.delete(id); else selected.add(id); window.WoQuotationStyle.render(grid, styles, ctx); }
    };
    const view = window.WoQuotationStyle.render(grid, styles, ctx);
    assert.equal(view.mode, 'artist');
    const cards = () => grid.querySelectorAll('.style-card[data-style-id]');
    assert.deepEqual(cards().map((c) => c.getAttribute('data-style-id')), ['s2', 's3', 's1']);
    assert.deepEqual(cards().map((c) => c.getAttribute('data-style-badge')), ['artist', 'artist', null]);
    assert.equal(grid.querySelectorAll('.qp-style-badge--artist').length, 2);
    assert.equal(grid.querySelectorAll('.qp-style-badge')[0].textContent, 'Artista');
    const hint = block.querySelector('.qp-style-hint');
    assert.equal(block.children[0], hint, 'el aviso va antes de la grilla');
    assert.equal(hint.textContent, 'Primero ves los estilos que trabaja Ana Tinta, marcados con «Artista».');
    assert.equal(grid.dataset.styleMode, 'artist');

    cards()[0].focus();
    cards()[0].click();
    assert.deepEqual(toggles, ['s2']);
    assert.equal(cards()[0].getAttribute('aria-pressed'), 'true');
    assert.ok(cards()[0].querySelector('.style-check'));
    assert.equal(document.activeElement, cards()[0], 'tras redibujar, el foco sigue en la misma tarjeta');
    assert.equal(block.querySelectorAll('.qp-style-hint').length, 1, 'no duplica el aviso ni los listeners');
    cards()[0].click();
    assert.deepEqual(toggles, ['s2', 's2']);
    assert.equal(cards()[0].getAttribute('aria-pressed'), 'false');

    // Portada rota → ícono de respaldo.
    const img = grid.querySelector('.style-card-img');
    img.dispatchEvent(createEvent('error'));
    assert.equal(grid.querySelector('.style-card-img'), null);
    assert.equal(grid.querySelectorAll('.style-card-placeholder').length, 3);

    // Sin artista: recomendados por la idea.
    ctx.artistStyles = null; ctx.artistName = '';
    assert.equal(window.WoQuotationStyle.render(grid, styles, ctx).mode, 'recommended');
    assert.deepEqual(cards().map((c) => c.getAttribute('data-style-badge')), ['recommended', null, null]);
    assert.equal(grid.querySelector('.qp-style-badge').textContent, 'Recomendado');
    assert.match(hint.textContent, /^Según tu idea te recomendamos Japonés\./);
    ctx.idea = '';
    assert.equal(window.WoQuotationStyle.render(grid, styles, ctx).mode, 'plain');
    assert.equal(hint.hidden, true);
    assert.equal(window.WoQuotationStyle.render(null, styles, ctx), null);
});

test('tamaños: elegir marca la tarjeta y la casilla de "No estoy seguro"; la foto rota deja la ilustración', () => {
    const { document, window } = page(['quotation-body-figure.js', 'quotation-size-step.js']);
    const block = document.createElement('div');
    document.body.appendChild(block);
    const options = [
        { label: 'Micro', value: 'micro', subtitle: 'Hasta 5 cm', ind: 'xs', img: 'micro' },
        { label: 'Manga', value: 'manga completa', subtitle: 'Brazo o pierna completos', ind: 'full', img: 'manga' }
    ];
    block.innerHTML = window.WoQuotationSize.render({ field: 'tattoo_size', value: 'Micro', options });
    const cards = () => block.querySelectorAll('.qp-size-card[data-value]');
    assert.equal(cards().length, 3);
    assert.deepEqual(cards().map((c) => c.getAttribute('aria-pressed')), ['true', 'false', 'false']);
    // handleOptionSelect del wizard: marca is-selected por data-value (Title Case).
    const title = (s) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const saved = [];
    window.handleOptionSelect = (field, value) => {
        saved.push([field, title(value)]);
        block.querySelectorAll('[data-value]').forEach((el) => el.classList.toggle('is-selected', title(el.getAttribute('data-value')) === title(value)));
    };
    const unsure = cards()[2];
    assert.ok(unsure.classList.contains('qp-size-card--unsure'));
    assert.ok(unsure.querySelector('.qp-size-unsure-box'));
    window.WoQuotationSize.pick(unsure);
    assert.deepEqual(saved, [['tattoo_size', 'No Estoy Seguro']]);
    assert.deepEqual(cards().map((c) => c.getAttribute('aria-pressed')), ['false', 'false', 'true']);
    assert.deepEqual(cards().map((c) => c.classList.contains('is-selected')), [false, false, true]);
    window.WoQuotationSize.pick(cards()[1]);
    assert.deepEqual(saved[1], ['tattoo_size', 'Manga Completa']);
    assert.deepEqual(cards().map((c) => c.getAttribute('aria-pressed')), ['false', 'true', 'false']);

    const img = cards()[0].querySelector('.qp-size-img');
    assert.equal(img.getAttribute('src'), '/shared/assets/ronda2/cot-pasos/tamano-micro.webp');
    window.WoQuotationSize.imageFailed(img);
    assert.equal(cards()[0].querySelector('.qp-size-img'), null);
    assert.ok(cards()[0].querySelector('.qp-scale-svg'), 'queda la silueta con la marca a escala');
    assert.doesNotThrow(() => window.WoQuotationSize.imageFailed(null));
});
