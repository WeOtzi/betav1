'use strict';
// Ronda 2 · frente cot-pasos · P11 — paso "¿Dónde quieres llevarlo?".
// Modelo puro de la selección (partes individuales + lado), silueta SVG,
// controlador (HTML sin DOM), contrato con script.js y migración de datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
// CRLF del checkout en Windows: los contratos no dependen del fin de línea.
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const Model = require('../public/shared/js/quotation-body-model.js');
const Figure = require('../public/shared/js/quotation-body-figure.js');

// Árbol como lo entrega ConfigManager.loadBodyPartsFromDB() con el catálogo
// vivo de body_parts + las subpartes de la migración 20261116100000.
const part = (id, label, sides, pain) => ({ id, label, sides, pain_level: pain, description: '', tattoo_info: '', experience_info: '', fun_fact: '' });
const NEW_PARTS = ['clavicula', 'esternon', 'espinilla', 'espalda_media'];
function tree({ withNew = true } = {}) {
    const zones = [
        { ...part('brazo', 'Brazo', 'both', 5), image: 'https://cdn.example.test/brazo.jpg', description: 'El brazo.', fun_fact: 'Dato del brazo.', subparts: [
            part('hombro', 'Hombro', 'both', 6), part('brazo_superior', 'Brazo Superior', 'both', 4), part('codo', 'Codo', 'both', 8),
            part('antebrazo', 'Antebrazo', 'both', 5), part('muneca', 'Muñeca', 'both', 7), part('mano', 'Mano', 'both', 8), part('dedos_mano', 'Dedos', 'both', 9)] },
        { ...part('pierna', 'Pierna', 'both', 5), subparts: [
            part('gluteo', 'Glúteo', 'both', 4), part('muslo', 'Muslo', 'both', 4), part('rodilla', 'Rodilla', 'both', 8), part('espinilla', 'Espinilla', 'both', 8),
            part('pantorrilla', 'Pantorrilla', 'both', 6), part('tobillo', 'Tobillo', 'both', 8), part('pie', 'Pie', 'both', 8), part('dedos_pie', 'Dedos del Pie', 'both', 9)] },
        { ...part('torso', 'Torso', 'none', 5), subparts: [
            part('clavicula', 'Clavícula', 'both', 8), part('pecho', 'Pecho', 'both', 6), part('esternon', 'Esternón', 'none', 9), part('costillas', 'Costillas', 'both', 9),
            part('abdomen', 'Abdomen', 'none', 7), part('costado', 'Costado', 'both', 8), part('cadera', 'Cadera', 'both', 6)] },
        { ...part('espalda', 'Espalda', 'none', 5), subparts: [
            part('espalda_alta', 'Espalda Alta', 'none', 6), part('omoplato', 'Omóplato', 'both', 5), part('columna', 'Columna', 'none', 9),
            part('espalda_media', 'Espalda Media', 'none', 5), part('espalda_baja', 'Espalda Baja', 'none', 8)] },
        { ...part('cabeza', 'Cabeza', 'none', 7), subparts: [
            part('cuello', 'Cuello', 'none', 8), part('nuca', 'Nuca', 'none', 9), part('detras_oreja', 'Detrás de la Oreja', 'both', 9),
            part('craneo', 'Cráneo', 'none', 10), part('cara', 'Cara', 'none', 9)] }
    ];
    if (!withNew) zones.forEach((zone) => { zone.subparts = zone.subparts.filter((p) => !NEW_PARTS.includes(p.id)); });
    return zones;
}
const CATALOG = Model.createCatalog(tree());
const sel = (...pairs) => pairs.map(([p, side]) => ({ part: p, side: side || null }));
const ARM = ['hombro', 'brazo_superior', 'codo', 'antebrazo', 'muneca', 'mano', 'dedos_mano'];

// ---------------------------------------------------------------------------
// Modelo: catálogo y selección
// ---------------------------------------------------------------------------
test('catálogo: zonas con sus partes individuales; una zona sin subpartes es su propia parte', () => {
    assert.deepEqual(CATALOG.zones.map((z) => z.id), ['brazo', 'pierna', 'torso', 'espalda', 'cabeza']);
    assert.equal(Object.keys(CATALOG.parts).length, 32);
    assert.deepEqual(Model.partById(CATALOG, 'antebrazo').sides, ['left', 'right']);
    assert.deepEqual(Model.partById(CATALOG, 'abdomen').sides, []);
    assert.equal(Model.partById(CATALOG, 'antebrazo').zoneId, 'brazo');
    assert.equal(Model.partById(CATALOG, 'craneo').pain, 10);
    assert.equal(Model.zoneById(CATALOG, 'brazo').funFact, 'Dato del brazo.');

    const lone = Model.createCatalog([{ id: 'ojo', label: 'Ojo', sides: 'left', pain_level: 99 }, null, { label: 'sin id' }]);
    assert.equal(lone.zones.length, 1);
    assert.deepEqual(lone.zones[0].parts.map((p) => p.id), ['ojo']);
    assert.deepEqual(lone.zones[0].parts[0].sides, ['left']);
    assert.equal(lone.zones[0].parts[0].pain, 10, 'dolor acotado a 1–10');
    assert.deepEqual(Model.createCatalog(null).zones, []);
});

test('selección: se limpia, se ordena y no admite lados imposibles', () => {
    const dirty = [{ part: 'mano', side: 'right' }, { part: 'antebrazo', side: 'left' }, { part: 'antebrazo', side: 'left' },
        { part: 'abdomen', side: 'left' }, { part: 'pecho', side: null }, { part: 'no_existe', side: 'left' }, null, { part: 'codo', side: 'up' }];
    assert.deepEqual(Model.sanitize(dirty, CATALOG), sel(['antebrazo', 'left'], ['mano', 'right'], ['abdomen']));
    assert.deepEqual(Model.sanitize('basura', CATALOG), []);
});

test('silueta: un clic agrega o quita UNA parte individual con su lado', () => {
    let s = Model.toggle([], CATALOG, 'antebrazo', 'left');
    assert.deepEqual(s, sel(['antebrazo', 'left']));
    s = Model.toggle(s, CATALOG, 'antebrazo', 'right');
    s = Model.toggle(s, CATALOG, 'abdomen', 'left'); // parte sin lado: el lado se ignora
    assert.deepEqual(s, sel(['antebrazo', 'left'], ['antebrazo', 'right'], ['abdomen']));
    s = Model.toggle(s, CATALOG, 'antebrazo', 'left');
    assert.deepEqual(s, sel(['antebrazo', 'right'], ['abdomen']));
    assert.deepEqual(Model.toggle(s, CATALOG, 'antebrazo', null), s, 'una parte con lado necesita el lado');
    assert.deepEqual(Model.toggle(s, CATALOG, 'fantasma', 'left'), s);
    assert.equal(Model.has(s, 'abdomen', null), true);
    assert.equal(Model.has(s, 'antebrazo', 'left'), false);
});

test('grilla: la ficha de una zona nueva arranca con todas las subpartes marcadas', () => {
    assert.deepEqual(Model.draftForZone([], CATALOG, 'brazo'), { parts: ARM, side: null }, 'brazo: hay que elegir lado');
    const torso = Model.draftForZone([], CATALOG, 'torso');
    assert.equal(torso.side, 'both', 'zona central: ambos lados por defecto');
    assert.equal(torso.parts.length, 7);
    assert.equal(Model.needsSide(CATALOG, 'torso', ['abdomen', 'esternon']), false);
    assert.equal(Model.needsSide(CATALOG, 'torso', ['abdomen', 'pecho']), true);
    assert.equal(Model.needsSide(CATALOG, 'no_existe'), false);

    assert.deepEqual(Model.validateDraft(CATALOG, 'brazo', { parts: ARM, side: null }), { ok: false, reason: 'side', message: 'Elige de qué lado va el tatuaje.' });
    assert.equal(Model.validateDraft(CATALOG, 'brazo', { parts: [], side: 'left' }).reason, 'parts');
    assert.equal(Model.validateDraft(CATALOG, 'brazo', { parts: ['pecho'], side: 'left' }).reason, 'parts', 'partes de otra zona no cuentan');
    assert.equal(Model.validateDraft(CATALOG, 'torso', { parts: ['abdomen'], side: null }).ok, true);
    assert.equal(Model.validateDraft(CATALOG, 'nada', { parts: ['x'], side: 'left' }).reason, 'zone');
});

test('grilla: confirmar reemplaza lo elegido de esa zona; "ambos" son los dos lados', () => {
    let s = Model.applyZone(sel(['abdomen']), CATALOG, 'brazo', { parts: ARM, side: 'left' });
    assert.equal(s.length, 8);
    assert.deepEqual(Model.zoneState(s, CATALOG, 'brazo'), { selected: true, complete: true, parts: ARM, count: 7, total: 7, side: 'left' });
    // Editar: se desmarcan subpartes y se pasa a ambos lados.
    s = Model.applyZone(s, CATALOG, 'brazo', { parts: ['antebrazo', 'mano'], side: 'both' });
    assert.deepEqual(s, sel(['antebrazo', 'left'], ['antebrazo', 'right'], ['mano', 'left'], ['mano', 'right'], ['abdomen']));
    assert.equal(Model.zoneState(s, CATALOG, 'brazo').side, 'both');
    assert.equal(Model.zoneState(s, CATALOG, 'brazo').complete, false);
    // Borrador inválido: no cambia nada.
    assert.deepEqual(Model.applyZone(s, CATALOG, 'brazo', { parts: ARM, side: null }), s);
    assert.deepEqual(Model.previewItems(CATALOG, 'brazo', { parts: ARM, side: null }), []);
    assert.deepEqual(Model.previewItems(CATALOG, 'brazo', { parts: ['mano'], side: 'right' }), sel(['mano', 'right']));
    // La ficha de una zona ya elegida se abre con lo que tiene.
    assert.deepEqual(Model.draftForZone(s, CATALOG, 'brazo'), { parts: ['antebrazo', 'mano'], side: 'both' });
    assert.deepEqual(Model.removeZone(s, CATALOG, 'brazo'), sel(['abdomen']));
    assert.equal(Model.zoneState(s, CATALOG, 'pierna').selected, false);
    // Lados distintos por subparte (marcados en la silueta): estado "mixed".
    const mixed = sel(['antebrazo', 'left'], ['mano', 'right']);
    assert.equal(Model.zoneState(mixed, CATALOG, 'brazo').side, 'mixed');
    assert.equal(Model.draftForZone(mixed, CATALOG, 'brazo').side, 'both');
});

// ---------------------------------------------------------------------------
// Modelo: lo que se guarda en la cotización
// ---------------------------------------------------------------------------
test('guardado compatible: "Zona" / "Zona: Subzona" + lado en su columna', () => {
    const d = (s) => { const info = Model.describe(s, CATALOG); return [info.bodyPart, info.bodySide]; };
    assert.deepEqual(d(Model.applyZone([], CATALOG, 'brazo', { parts: ARM, side: 'left' })), ['Brazo', 'Izquierdo']);
    assert.deepEqual(d(sel(['antebrazo', 'right'])), ['Brazo: Antebrazo', 'Derecho']);
    assert.deepEqual(d(sel(['antebrazo', 'left'], ['mano', 'left'])), ['Brazo: Antebrazo, Mano', 'Izquierdo']);
    assert.deepEqual(d(sel(['antebrazo', 'left'], ['antebrazo', 'right'])), ['Brazo: Antebrazo', 'Ambos']);
    assert.deepEqual(d(sel(['abdomen'], ['esternon'])), ['Torso: Esternón, Abdomen', null], 'sin partes con lado no hay lado');
    assert.deepEqual(d(sel(['columna'])), ['Espalda: Columna', null]);
    assert.deepEqual(d([]), ['', null]);
    // Varias zonas con el mismo lado: el lado sigue en su columna.
    assert.deepEqual(d(sel(['antebrazo', 'left'], ['muslo', 'left'], ['abdomen'])), ['Brazo: Antebrazo + Pierna: Muslo + Torso: Abdomen', 'Izquierdo']);
    // Torso completo, ambos lados.
    assert.deepEqual(d(Model.applyZone([], CATALOG, 'torso', Model.draftForZone([], CATALOG, 'torso'))), ['Torso', 'Ambos']);
});

test('guardado: lados distintos viajan en el texto y la columna de lado queda vacía', () => {
    const a = Model.describe(sel(['antebrazo', 'left'], ['muslo', 'right']), CATALOG);
    assert.equal(a.bodyPart, 'Brazo (izq.): Antebrazo + Pierna (der.): Muslo');
    assert.equal(a.bodySide, null);
    const b = Model.describe(sel(['antebrazo', 'left'], ['mano', 'left'], ['mano', 'right'], ['hombro', 'right']), CATALOG);
    assert.equal(b.bodyPart, 'Brazo (ambos lados): Mano + Brazo (izq.): Antebrazo + Brazo (der.): Hombro');
    assert.equal(b.bodySide, null);
    assert.equal(b.zones.length, 1);
    assert.equal(b.zones[0].mode, 'mixed');
    const c = Model.describe(Model.applyZone(sel(['pecho', 'left'], ['pecho', 'right']), CATALOG, 'brazo', { parts: ARM, side: 'right' }), CATALOG);
    assert.equal(c.bodyPart, 'Brazo (der.) + Torso (ambos lados): Pecho');
    assert.equal(c.bodySide, null);
});

test('guardado: nunca supera los 255 caracteres de quotations_db.tattoo_body_part', () => {
    // Peor caso: casi todo el cuerpo, con lados distintos por zona.
    let s = [];
    for (const zone of CATALOG.zones) {
        const parts = zone.parts.slice(1).map((p) => p.id);
        s = Model.applyZone(s, CATALOG, zone.id, { parts, side: zone.id === 'pierna' ? 'right' : 'left' });
    }
    const info = Model.describe(s, CATALOG);
    assert.ok(info.bodyPart.length <= Model.MAX_BODY_PART_LENGTH, `${info.bodyPart.length} caracteres`);
    assert.match(info.bodyPart, /^Brazo \(izq\.\): 6 zonas \+ Pierna \(der\.\): 7 zonas/);
    assert.equal(info.bodySide, null);
    assert.ok((info.bodySide || '').length <= 50);
    // Catálogo con nombres enormes: se corta con puntos suspensivos.
    const huge = Model.createCatalog(Array.from({ length: 12 }, (_, i) => ({ id: 'z' + i, label: 'Zona larguísima número ' + i + ' '.repeat(1) + 'x'.repeat(30), sides: 'none' })));
    const all = huge.zones.map((z) => ({ part: z.id, side: null }));
    const cut = Model.describe(all, huge).bodyPart;
    assert.ok(cut.length <= 255);
    assert.match(cut, /…$/);
});

test('resumen bajo la silueta: una entrada por zona, con lado y dolor', () => {
    const info = Model.describe(sel(['antebrazo', 'left'], ['mano', 'left'], ['abdomen'], ['craneo']), CATALOG);
    assert.equal(info.count, 4);
    assert.deepEqual(info.zones.map((z) => [z.label, z.summary]), [
        ['Brazo', 'lado izquierdo · Antebrazo, Mano'], ['Torso', 'Abdomen'], ['Cabeza', 'Cráneo']]);
    assert.deepEqual(info.pain, { min: 5, max: 10 });
    const full = Model.describe(Model.applyZone([], CATALOG, 'pierna', { parts: Model.zoneById(CATALOG, 'pierna').parts.map((p) => p.id), side: 'both' }), CATALOG);
    assert.equal(full.zones[0].summary, 'ambos lados · completo');
    assert.equal(Model.describe([], CATALOG).pain, null);
    assert.equal(Model.partLabel(CATALOG, 'antebrazo', 'left'), 'Antebrazo · lado izquierdo');
    assert.equal(Model.partLabel(CATALOG, 'abdomen', null), 'Abdomen');
    assert.deepEqual([1, 3, 4, 6, 7, 8, 9, 10].map(Model.painLabel), ['Bajo', 'Bajo', 'Moderado', 'Moderado', 'Alto', 'Alto', 'Muy alto', 'Muy alto']);
    assert.deepEqual(Model.painRange(CATALOG, ['muslo', 'rodilla', 'x']), { min: 4, max: 8 });
    assert.equal(Model.painRange(CATALOG, []), null);
});

test('borradores del wizard anterior y textos ya guardados se recuperan', () => {
    // Formato viejo: un objeto con zona/subzona y lado.
    assert.deepEqual(Model.fromLegacy([{ key: 'brazo::antebrazo', id: 'antebrazo', zone: 'brazo', sides: 'both', side: 'left', sideLabel: 'Izquierdo' }], CATALOG), sel(['antebrazo', 'left']));
    assert.equal(Model.fromLegacy([{ key: 'brazo', id: 'brazo', zone: 'brazo', sides: 'both', side: 'right' }], CATALOG).length, 7, 'zona raíz = todas sus partes');
    assert.deepEqual(Model.fromLegacy([{ key: 'brazo', id: 'brazo', zone: 'brazo', sides: 'both', side: null }], CATALOG), [], 'sin lado no se adivina');
    assert.deepEqual(Model.fromLegacy([{ key: 'cabeza::craneo', id: 'craneo', zone: 'cabeza', sides: 'none', side: null }], CATALOG), sel(['craneo']));
    assert.deepEqual(Model.fromLegacy(sel(['mano', 'left']), CATALOG), sel(['mano', 'left']), 'formato nuevo: pasa tal cual');
    assert.deepEqual(Model.fromLegacy(undefined, CATALOG), []);

    // Ida y vuelta del texto guardado.
    for (const s of [
        sel(['antebrazo', 'left'], ['mano', 'left']),
        sel(['antebrazo', 'left'], ['muslo', 'right'], ['abdomen']),
        Model.applyZone([], CATALOG, 'torso', Model.draftForZone([], CATALOG, 'torso')),
        sel(['antebrazo', 'left'], ['mano', 'left'], ['mano', 'right'], ['hombro', 'right']),
        sel(['detras_oreja', 'right'], ['craneo'])
    ]) {
        const info = Model.describe(s, CATALOG);
        const back = Model.parseText(info.bodyPart, info.bodySide, CATALOG);
        assert.deepEqual(back.selection, Model.sanitize(s, CATALOG), info.bodyPart);
        assert.deepEqual(back.pending, []);
    }
    // Texto del pre-cotizador (sin lado) o con mayúsculas del wizard viejo.
    assert.deepEqual(Model.parseText('Brazo: Antebrazo, Mano', null, CATALOG), { selection: [], pending: [{ zoneId: 'brazo', parts: ['antebrazo', 'mano'] }] });
    assert.deepEqual(Model.parseText('Brazo: Zona entera', null, CATALOG).pending[0].parts, ARM);
    assert.deepEqual(Model.parseText('Cabeza: Detrás De La Oreja', 'Derecho', CATALOG).selection, sel(['detras_oreja', 'right']));
    assert.deepEqual(Model.parseText('Antebrazo', 'Izquierdo', CATALOG).selection, sel(['antebrazo', 'left']));
    assert.deepEqual(Model.parseText('Espalda', null, CATALOG).selection.length, 0, 'omóplato pide lado');
    assert.deepEqual(Model.parseText('Marte: Cráter', 'Izquierdo', CATALOG), { selection: [], pending: [] });
    assert.deepEqual(Model.parseText('', null, CATALOG), { selection: [], pending: [] });
});

// ---------------------------------------------------------------------------
// Silueta SVG
// ---------------------------------------------------------------------------
test('silueta: frente y espalda dibujan una <path> por cada parte individual del catálogo', () => {
    const drawn = Figure.drawnParts();
    for (const id of Object.keys(CATALOG.parts)) assert.ok(drawn.includes(id), `la silueta no dibuja ${id}`);
    assert.deepEqual(Figure.VIEWS.map((v) => v.id), ['front', 'back']);

    const front = Figure.shapes('front');
    const back = Figure.shapes('back');
    assert.ok(front.length >= 40 && back.length >= 34);
    const keys = new Set();
    for (const shape of front.concat(back)) {
        const key = [shape.view, shape.part, shape.side].join('|');
        assert.ok(!keys.has(key), `forma repetida ${key}`);
        keys.add(key);
        // Solo comandos absolutos M L C Q Z con números: un path válido y predecible.
        assert.match(shape.d, /^M [\d. ]+(?: (?:[LCQ] [\d. ]+|Z(?: M [\d. ]+)?))+$/, `${key}: ${shape.d}`);
        assert.ok(shape.d.trim().endsWith('Z'), `${key} sin cerrar`);
        assert.equal(shape.candidates[0], shape.part);
    }
    // Partes de una sola vista.
    const frontParts = front.map((s) => s.part);
    const backParts = back.map((s) => s.part);
    for (const id of ['cara', 'pecho', 'abdomen', 'clavicula', 'esternon', 'espinilla', 'dedos_pie']) assert.ok(frontParts.includes(id) && !backParts.includes(id), id);
    for (const id of ['nuca', 'columna', 'omoplato', 'gluteo', 'pantorrilla', 'espalda_media', 'detras_oreja']) assert.ok(backParts.includes(id) && !frontParts.includes(id), id);
});

test('silueta: el lado es anatómico y las partes con lado van en espejo', () => {
    const pick = (view, id) => Figure.shapes(view).filter((s) => s.part === id);
    const front = pick('front', 'antebrazo');
    assert.equal(front.length, 2);
    // De frente, lo dibujado en la mitad izquierda del lienzo es el lado derecho de la persona.
    assert.deepEqual(front.map((s) => [s.side, s.transform]), [['right', null], ['left', Figure.MIRROR]]);
    assert.deepEqual(pick('back', 'antebrazo').map((s) => [s.side, s.transform]), [['left', null], ['right', Figure.MIRROR]]);
    assert.equal(front[0].d, front[1].d);
    assert.deepEqual(pick('front', 'abdomen').map((s) => s.side), [null]);
    // Lo dibujado sin espejo queda en la mitad izquierda; todo entra en el viewBox.
    const [vx, vy, vw, vh] = Figure.VIEWBOX.split(' ').map(Number);
    for (const shape of Figure.allShapes()) {
        const nums = shape.d.replace(/[MLCQZ]/g, ' ').trim().split(/\s+/).map(Number);
        for (let i = 0; i < nums.length; i += 2) {
            const x = shape.transform ? 200 - nums[i] : nums[i];
            const y = nums[i + 1];
            assert.ok(x >= vx && x <= vx + vw && y >= vy && y <= vy + vh, `${shape.part} fuera del viewBox: ${x},${y}`);
            if (shape.side && !shape.transform) assert.ok(nums[i] <= 100.5, `${shape.part} cruza el eje`);
        }
    }
    // Subpartes nuevas: mientras no exista la migración se usa una parte vecina.
    const byPart = (view, id) => Figure.shapes(view).find((s) => s.part === id);
    assert.deepEqual(byPart('front', 'espinilla').candidates, ['espinilla', 'pantorrilla']);
    assert.deepEqual(byPart('front', 'clavicula').candidates, ['clavicula', 'pecho']);
    assert.deepEqual(byPart('back', 'espalda_media').candidates, ['espalda_media', 'espalda_alta']);
});

// ---------------------------------------------------------------------------
// Controlador (HTML sin DOM)
// ---------------------------------------------------------------------------
function browser() {
    const sandbox = { console };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.document = { addEventListener() {}, body: { contains: () => false } };
    const context = vm.createContext(sandbox);
    for (const file of ['quotation-body-model.js', 'quotation-body-figure.js', 'quotation-body-map.js']) {
        vm.runInContext(read('public', 'shared', 'js', file), context);
    }
    return context;
}

test('pantalla: silueta accesible, grilla de zonas completas y resumen vacío', () => {
    const body = browser().WoQuotationBody;
    const html = body.htmlFor({ tree: tree(), selection: [] });
    // Silueta: dos vistas, cada parte es una casilla con nombre y lado.
    assert.equal((html.layout.match(/<svg class="qp-fig-svg"/g) || []).length, 2);
    assert.match(html.layout, /aria-label="Silueta de frente: usa las flechas para moverte y Espacio para elegir"/);
    const paths = html.layout.match(/<path class="qp-fig-part" role="checkbox"[^>]*>/g) || [];
    assert.equal(paths.length, Figure.allShapes().length, 'con el catálogo completo no queda ninguna forma inerte');
    assert.ok(paths.some((p) => /data-part="antebrazo" data-side="left" aria-label="Antebrazo · lado izquierdo"/.test(p)));
    assert.ok(paths.some((p) => /data-part="abdomen" aria-label="Abdomen"/.test(p)));
    // Un solo tabulador por figura (el resto se recorre con flechas).
    assert.equal((html.layout.match(/tabindex="0"/g) || []).length, 2);
    assert.match(html.layout, /data-qp-status role="status">Toca una parte de la silueta o elige una zona completa\.</);
    assert.match(html.layout, /<figcaption class="qp-fig-caption">Frente<\/figcaption>/);
    assert.match(html.layout, /<figcaption class="qp-fig-caption">Espalda<\/figcaption>/);
    // El resumen vive dentro del aside, después de las figuras.
    assert.ok(html.layout.indexOf('data-qp-figures') < html.layout.indexOf('data-qp-summary'));
    assert.ok(html.layout.indexOf('data-qp-summary') < html.layout.indexOf('data-qp-main'));

    // Grilla: solo zonas completas (no subpartes), con foto local y respaldo.
    const tiles = html.main.match(/<button type="button" class="q-zone-tile qp-zone-tile[^>]*>/g) || [];
    assert.equal(tiles.length, 5);
    assert.match(html.main, /data-qp-zone="brazo" aria-pressed="false"/);
    assert.match(html.main, /src="\/shared\/assets\/ronda2\/cot-pasos\/zona-brazo\.webp" data-qp-alt-src="https:\/\/cdn\.example\.test\/brazo\.jpg"/);
    assert.match(html.main, /class="qp-mini-svg"/);
    assert.match(html.main, /7 subpartes/);
    assert.doesNotMatch(html.main, /data-qp-zone="antebrazo"/);
    assert.doesNotMatch(html.main, /data-qp-side/, 'el lado ya no está fijo debajo de la grilla');
    assert.match(html.summary, /Aún no has elegido ninguna parte\./);
});

test('pantalla: sin la migración aplicada la silueta sigue completa (usa la parte vecina)', () => {
    const body = browser().WoQuotationBody;
    const html = body.htmlFor({ tree: tree({ withNew: false }), selection: [] });
    assert.match(html.layout, /data-part="pantorrilla" data-side="left"/);
    assert.doesNotMatch(html.layout, /data-part="espinilla"/);
    // El esternón no tiene parte vecina sin lado: queda dibujado pero inerte.
    assert.equal((html.layout.match(/class="qp-fig-part is-inert" aria-hidden="true"/g) || []).length, 1);
    // Catálogo local de respaldo (config-manager.js): ids distintos, misma silueta.
    const local = body.htmlFor({ tree: [{ id: 'brazo', label: 'Brazo', sides: 'both', subparts: [{ id: 'dedos', label: 'Dedos', sides: 'both' }] }], selection: [] });
    assert.match(local.layout, /data-part="dedos" data-side="left" aria-label="Dedos · lado izquierdo"/);
});

test('ficha de zona: lado, dolor, subpartes desmarcables y datos; al confirmar se ve elegida', () => {
    const body = browser().WoQuotationBody;
    const data = tree();
    data[0].tattoo_info = 'Mangas.';
    data[0].experience_info = 'Duele en el codo.';
    const panel = body.htmlFor({ tree: data, selection: [], openZone: 'brazo' }).main;
    assert.match(panel, /<h2 class="qp-panel-title" id="qp-panel-title" tabindex="-1">Brazo<\/h2>/);
    assert.match(panel, /data-qp-action="cancel">Volver a las zonas</);
    // Lado: izquierdo / derecho / ambos, sin ninguno elegido de entrada.
    assert.deepEqual([...panel.matchAll(/name="qp-side" value="(\w+)" data-qp-side( checked)?>/g)].map((m) => [m[1], !!m[2]]),
        [['left', false], ['right', false], ['both', false]]);
    assert.match(panel, /<span class="q-chip qp-choice-chip">Ambos<\/span>/);
    // Subpartes: todas marcadas.
    const boxes = [...panel.matchAll(/<input type="checkbox" value="(\w+)" data-qp-part aria-label="[^"]+"( checked)?>/g)];
    assert.deepEqual(boxes.map((m) => m[1]), ARM);
    assert.ok(boxes.every((m) => m[2]));
    assert.match(panel, /Desmarca las que no quieras/);
    // Dolor y datos.
    assert.match(panel, /role="img" aria-label="Nivel de dolor: 4–9 sobre 10, muy alto"/);
    assert.match(panel, /value="dedos_mano" data-qp-part aria-label="Dedos, dolor 9 de 10" checked>/);
    assert.match(panel, /qp-part-pain qp-part-pain--max" aria-hidden="true">9</);
    assert.match(panel, /<dt>Sobre la zona<\/dt><dd>El brazo\.<\/dd>/);
    assert.match(panel, /<dt>Cómo se siente<\/dt><dd>Duele en el codo\.<\/dd>/);
    assert.match(panel, /<dt>Ideal para<\/dt><dd>Mangas\.<\/dd>/);
    assert.match(panel, /qp-info--fact"><dt>Dato curioso<\/dt><dd>Dato del brazo\.<\/dd>/);
    assert.match(panel, /data-qp-action="confirm">Confirmar parte</);
    assert.doesNotMatch(panel, /data-qp-action="remove"/);

    // Torso: ambos lados por defecto y aviso de a qué subpartes aplica.
    const torso = body.htmlFor({ tree: data, selection: [], openZone: 'torso' }).main;
    assert.match(torso, /value="both" data-qp-side checked>/);
    assert.match(torso, /Aplica a Clavícula, Pecho, Costillas, Costado, Cadera/);
    // Zona sin partes con lado marcadas: no se pregunta el lado.
    const noSide = body.htmlFor({ tree: data, selection: [], openZone: 'torso', draft: { parts: ['abdomen'], side: null } }).main;
    assert.doesNotMatch(noSide, /data-qp-side/);

    // Ya elegida: la grilla y el resumen la muestran, y la ficha permite editarla o quitarla.
    const chosen = Model.applyZone([], CATALOG, 'brazo', { parts: ['antebrazo', 'mano'], side: 'left' });
    const after = body.htmlFor({ tree: data, selection: chosen });
    assert.match(after.main, /class="q-zone-tile qp-zone-tile is-selected" data-qp-zone="brazo" aria-pressed="true" aria-label="Brazo\. En tu selección: lado izquierdo · Antebrazo, Mano\. Pulsa para editar\."/);
    assert.match(after.main, /<span class="qp-zone-state">lado izquierdo · Antebrazo, Mano<\/span>/);
    assert.match(after.summary, /data-qp-edit-zone="brazo"[^>]*><strong>Brazo<\/strong> <span>lado izquierdo · Antebrazo, Mano<\/span>/);
    assert.match(after.summary, /data-qp-remove-zone="brazo" aria-label="Quitar Brazo"/);
    assert.match(after.summary, /Dolor 5–8\/10/);
    assert.doesNotMatch(after.summary, /data-qp-clear/, '"Quitar todo" solo con más de una zona');
    const editing = body.htmlFor({ tree: data, selection: chosen, openZone: 'brazo' }).main;
    assert.match(editing, /value="left" data-qp-side checked>/);
    assert.match(editing, /value="antebrazo" data-qp-part aria-label="Antebrazo, dolor 5 de 10" checked>/);
    assert.match(editing, /value="codo" data-qp-part aria-label="Codo, dolor 8 de 10">/);
    assert.match(editing, /data-qp-action="confirm">Guardar cambios</);
    assert.match(editing, /data-qp-action="remove">Quitar esta zona</);
    assert.match(body.htmlFor({ tree: data, selection: chosen.concat(sel(['abdomen'])) }).summary, /data-qp-clear>Quitar todo</);
    // Error de validación visible.
    assert.match(body.htmlFor({ tree: data, selection: [], openZone: 'brazo', error: 'Elige de qué lado va el tatuaje.' }).main,
        /data-qp-error role="alert">Elige de qué lado va el tatuaje\.</);
});

test('pantalla: los datos del catálogo se escapan (sin HTML ni URLs ejecutables)', () => {
    const body = browser().WoQuotationBody;
    const evil = [{ id: 'z"><img src=x onerror=alert(1)>', label: '<img src=x onerror=alert(1)>', sides: 'both', image: 'javascript:alert(1)',
        description: '<script>alert(2)</script>', fun_fact: '"><svg onload=alert(3)>',
        subparts: [{ id: 'p1', label: '<b>Sub</b>', sides: 'both', pain_level: 5, description: '" onmouseover="alert(4)' }] }];
    const closed = body.htmlFor({ tree: evil, selection: [{ part: 'p1', side: 'left' }] });
    const open = body.htmlFor({ tree: evil, selection: [], openZone: evil[0].id });
    const all = closed.layout + closed.main + closed.summary + open.main;
    assert.doesNotMatch(all, /<img src=x|<script>|<svg onload|<b>Sub<\/b>|javascript:/);
    assert.doesNotMatch(all, /" onmouseover="/);
    assert.match(all, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(open.main, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
});

// ---------------------------------------------------------------------------
// Integración con script.js (wizard)
// ---------------------------------------------------------------------------
function wizard() {
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
    for (const file of ['quotation-body-model.js', 'quotation-body-figure.js', 'quotation-body-map.js', 'script.js']) {
        vm.runInContext(read('public', 'shared', 'js', file), context);
    }
    vm.runInContext('persistCalls = 0; persistAnswer = () => { persistCalls += 1; };', context);
    context.__tree = tree();
    vm.runInContext('BODY_PARTS_DATA = __tree;', context);
    return context;
}

test('script.js: la selección se guarda en tattoo_body_part / tattoo_body_side como siempre', () => {
    const ctx = wizard();
    vm.runInContext(`selectedBodyParts = [{ part: 'antebrazo', side: 'left' }, { part: 'mano', side: 'left' }]; commitBodySelection();`, ctx);
    assert.equal(vm.runInContext('formData.tattoo_body_part', ctx), 'Brazo: Antebrazo, Mano');
    assert.equal(vm.runInContext('formData.tattoo_body_side', ctx), 'Izquierdo');
    assert.equal(vm.runInContext('formData.tattoo_body_parts_data.length', ctx), 2);
    assert.equal(vm.runInContext('persistCalls', ctx), 1);
    // Lo que valida el wizard al continuar y lo que viaja al servidor.
    assert.equal(vm.runInContext('selectedBodyParts.length > 0 && isScreenCompleted({ questions: [{ type: "body-selector", field: "tattoo_body_part" }] })', ctx), true);
    assert.equal(vm.runInContext('preparePayload().tattoo_body_part', ctx), 'Brazo: Antebrazo, Mano');
    assert.equal(vm.runInContext('preparePayload().tattoo_body_side', ctx), 'Izquierdo');
    assert.equal(vm.runInContext('"tattoo_body_parts_data" in preparePayload()', ctx), false);

    // Quitar todo limpia los dos campos y guarda el borrador una vez.
    vm.runInContext('removeBodyPart();', ctx);
    assert.equal(vm.runInContext('formData.tattoo_body_part', ctx), null);
    assert.equal(vm.runInContext('formData.tattoo_body_side', ctx), null);
    assert.equal(vm.runInContext('persistCalls', ctx), 2);
    vm.runInContext('commitBodySelection();', ctx);
    assert.equal(vm.runInContext('persistCalls', ctx), 2, 'sin cambios no vuelve a guardar');
});

test('script.js: monta el selector, conserva los nombres exportados y el resto del wizard', () => {
    const script = read('public', 'shared', 'js', 'script.js');
    const block = script.slice(script.indexOf('// ============ SELECTOR DE ZONA'), script.indexOf('// ============ ESTILOS (Figma 02)'));
    assert.match(block, /selectedBodyParts = window\.WoQuotationBody\.mount\(host, \{/);
    assert.match(block, /bodyPart: formData\.tattoo_body_part,/);
    assert.match(block, /const host = document\.getElementById\('body-selector'\);/);
    assert.doesNotMatch(block, /innerHTML = zones\.map|data-zone-key|body-side-panel/);
    // Nombres que script.js exporta en window al final del archivo.
    for (const name of ['confirmBodyParts', 'removeBodyPart', 'selectBodyZone', 'handleSideChosen', 'toggleBodySilhouette']) {
        assert.match(block, new RegExp(`function ${name}\\(`), name);
        assert.match(script, new RegExp(`window\\.${name} = ${name};`), name);
    }
    const ctx = wizard();
    for (const name of ['confirmBodyParts', 'removeBodyPart', 'selectBodyZone', 'handleSideChosen', 'toggleBodySilhouette', 'setupBodySelector']) {
        assert.equal(vm.runInContext(`typeof ${name}`, ctx), 'function', name);
    }
    // Sin el contenedor en pantalla no hace nada (otras pantallas del wizard).
    assert.doesNotThrow(() => vm.runInContext('setupBodySelector(); selectBodyZone("brazo"); handleSideChosen("left");', ctx));
});

test('página: el template solo deja el contenedor y los módulos cargan antes de script.js', () => {
    const html = read('public', 'quotation', 'index.html');
    const tpl = html.slice(html.indexOf('<template id="tmpl-body-selector">'), html.indexOf('<!-- TEMPLATE: TATTOO STYLES SELECTOR'));
    assert.match(tpl, /<div class="q-body-selector" id="body-selector">/);
    assert.doesNotMatch(tpl, /body-side-panel|q-sil-seg|q-body-aside-toggle|handleSideChosen/);
    const at = (needle) => html.indexOf(needle);
    assert.ok(at('/shared/js/quotation-body-model.js') > -1);
    assert.ok(at('/shared/js/quotation-body-model.js') < at('/shared/js/quotation-body-map.js'));
    assert.ok(at('/shared/js/quotation-body-figure.js') < at('/shared/js/quotation-body-map.js'));
    assert.ok(at('/shared/js/quotation-body-map.js') < at('/shared/js/script.js'));
    assert.ok(at('/shared/js/quotation-body-figure.js') < at('/shared/js/quotation-size-step.js'), 'el paso Tamaño usa la silueta de respaldo');
    assert.match(read('public', 'shared', 'js', 'config-manager.js'), /fun_fact: item\.fun_fact \|\| '',/);
});

test('"Continuar" con la ficha abierta: se confirma sola o frena, según el caso', () => {
    const map = read('public', 'shared', 'js', 'quotation-body-map.js');
    const guard = map.slice(map.indexOf('function resolveOpenPanel()'), map.indexOf('function mount(host, options)'));
    assert.match(guard, /if \(!state\.dirty && state\.selection\.length\) \{\n\s*closePanel\(\);\n\s*return true;/);
    assert.match(guard, /return confirmPanel\(\);/);
    assert.match(guard, /closest\('#continue-btn'\)/);
    assert.match(guard, /event\.preventDefault\(\);\n\s*event\.stopPropagation\(\);/);
    assert.match(guard, /\}, true\);/, 'en captura: corre antes del onclick del botón');
    // Teclado: flechas para moverse, Espacio/Enter para elegir sin disparar "Continuar".
    const keys = map.slice(map.indexOf('function onKeydown(event)'), map.indexOf('function onPointerOver(event)'));
    assert.match(keys, /key === ' ' \|\| key === 'Spacebar' \|\| key === 'Enter'/);
    assert.match(keys, /event\.stopPropagation\(\); \/\/ Enter no debe disparar "Continuar"\./);
    assert.match(keys, /ArrowDown[\s\S]*ArrowUp[\s\S]*Home[\s\S]*End/);
    // Mouse: nombre al pasar por la silueta; táctil sin cartel pegado.
    assert.match(map, /if \(shape && event\.pointerType !== 'touch'\) \{\n\s*showTip\(shape, event\);/);
});

// ---------------------------------------------------------------------------
// CSS y copy
// ---------------------------------------------------------------------------
test('CSS propio: tokens del DS, foco visible en la silueta y tres anchos', () => {
    const css = read('public', 'shared', 'css', 'quotation-pasos.css');
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b/, 'cero hex sueltos');
    assert.match(css, /\.wo-app \.qp-fig-part:focus-visible \{[^}]*stroke: var\(--white\);/);
    assert.match(css, /\.qp-fig-part\.is-selected \{ fill: var\(--blue-400\);/);
    assert.match(css, /@media \(hover: hover\) \{\n\s*\.qp-fig-part:hover \{ fill: var\(--yellow-300\); \}/);
    assert.match(css, /@media \(max-width: 1024px\)/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /@media \(max-width: 480px\)/);
    assert.match(css, /\.qp-body-layout \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'una columna en móvil');
    assert.match(css, /--qp-fig-h: clamp\(260px, min\(calc\(100vh - 414px\), 38vw\), 540px\);/, 'la silueta se adapta al alto y al ancho de la ventana');
    // FE-04: en PC y tablet el resumen bajo la silueta tiene tope de alto y se desplaza
    // por dentro; el tope usa el mismo descuento (414) y el mismo máximo (540) de la silueta.
    const capAt = css.indexOf('.qp-body-aside .qp-sum-list {');
    assert.ok(capAt > -1, 'hay tope para el listado del resumen');
    assert.match(css.slice(css.lastIndexOf('@media', capAt), capAt), /^@media \(min-width: 768px\) \{\s*$/, 'solo desde 768 px: en móvil va entero');
    assert.match(css, /\.qp-body-aside \.qp-sum-list \{[^}]*max-height: max\(62px, calc\(100vh - 414px - 540px \+ 62px\)\);[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
    assert.match(css, /\.qp-body-aside \.qp-sum-item \{ flex: none; \}/, 'las filas no se achican: se desplazan');
    assert.doesNotMatch(css.slice(css.indexOf('.qp-body-summary {'), css.indexOf('.qp-sum-title {')), /overflow|max-height/, '"Quitar todo" queda fuera de la zona que se desplaza');
    assert.match(css, /\.qp-panel-body \{\n\s*display: grid;\n\s*grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, 1fr\);/);
    assert.match(css, /\.qp-choice input:focus-visible \+ \.qp-choice-chip \{ box-shadow: var\(--shadow-focus\); \}/);
    assert.match(css, /prefers-reduced-motion/);
});

test('textos nuevos en español neutro (tuteo), sin voseo', () => {
    // Las formas del voseo llevan tilde en la última sílaba ("tocá", "elegí");
    // el tuteo ("toca", "elige") no. \b no sirve con vocales acentuadas.
    const voseo = /(?<!\p{L})(querés|podés|tenés|sabés|pensás|elegí|contanos|tocá|marcá|desmarcá|recargá|volvé|esperá|mirá|completá|hacé|cotizá|publicá|dejá|usá|probá|cerca tuyo|acá)(?!\p{L})/iu;
    assert.match('Tocá la silueta', voseo);
    assert.doesNotMatch('Toca una parte de la silueta o elige una zona completa.', voseo);
    const files = [
        ['public', 'shared', 'js', 'quotation-body-map.js'], ['public', 'shared', 'js', 'quotation-body-model.js'],
        ['public', 'shared', 'js', 'quotation-size-step.js'], ['public', 'shared', 'js', 'quotation-style-step.js'],
        ['lib', 'routes', 'cot-pasos.js'], ['supabase', 'migrations', '20261116100000_cot_pasos_body_parts_datos.sql']
    ];
    for (const file of files) {
        // Solo cadenas de texto: los comentarios técnicos no son copy del producto.
        const strings = (read(...file).match(/'(?:[^'\\\n]|\\.|'')*'/g) || []).join('\n');
        const hit = strings.match(voseo);
        assert.equal(hit, null, `${file.join('/')}: "${hit && hit[0]}"`);
    }
});

// ---------------------------------------------------------------------------
// Migración de datos de body_parts
// ---------------------------------------------------------------------------
test('migración: idempotente, con reversa, sin pisar lo que ya cargó soporte', () => {
    const name = '20261116100000_cot_pasos_body_parts_datos';
    const up = read('supabase', 'migrations', name + '.sql');
    const down = read('supabase', 'rollbacks', name + '.down.sql');
    assert.ok(Number(name.slice(0, 14)) >= 20261116100000 && Number(name.slice(0, 14)) <= 20261116100999, 'timestamp dentro del rango del frente');
    assert.match(up, /^begin;$/m);
    assert.match(up, /^commit;$/m);
    assert.match(up, /alter table public\.body_parts add column if not exists fun_fact text;/);
    assert.match(up, /on conflict \(part_id\) do nothing;/);
    assert.match(up, /and b\.sort_order is distinct from v\.sort_order;/);
    // Solo se siembra donde falta (o está el texto de prueba).
    assert.match(up, /description = case when v\.description is not null and coalesce\(btrim\(b\.description\), ''\) = '' then v\.description else b\.description end/);
    assert.match(up, /in \('', 'Otro ejemplosas'\)/);
    assert.doesNotMatch(up, /\bdrop\b|\bdelete\b|\btruncate\b/i);
    for (const id of NEW_PARTS) assert.match(up, new RegExp(`\\('${id}', '[^']+', '(torso|pierna|espalda)', '(both|none)', \\d+\\)`), id);

    // Cada parte del catálogo recibe su dato curioso; textos breves.
    const seeded = up.slice(up.indexOf('-- 4. Textos'));
    const rows = [...seeded.matchAll(/^ {4}\('([a-z_]+)', (.+)\),?$/gm)];
    const ids = rows.map((m) => m[1]);
    for (const id of ['brazo', 'pierna', 'torso', 'espalda', 'cabeza', ...Object.keys(CATALOG.parts)]) assert.ok(ids.includes(id), `sin textos: ${id}`);
    assert.equal(new Set(ids).size, ids.length);
    for (const [, id, rest] of rows) {
        const texts = [...rest.matchAll(/'((?:[^']|'')*)'|null/g)].map((m) => m[1]);
        assert.equal(texts.length, 4, id);
        assert.ok(texts[3] && texts[3].length >= 20, `dato curioso de ${id}`);
        for (const t of texts) if (t) assert.ok(t.length <= 220, `${id}: texto de ${t.length} caracteres`);
    }
    // Lo que ya tenía textos reales no se toca (solo recibe el dato curioso).
    for (const id of ['hombro', 'antebrazo', 'muneca', 'muslo', 'pecho', 'costillas']) {
        assert.match(seeded, new RegExp(`^ {4}\\('${id}', null, null, null, '`, 'm'), id);
    }

    assert.match(down, /delete from public\.body_parts\nwhere part_id in \('clavicula', 'esternon', 'espinilla', 'espalda_media'\);/);
    assert.match(down, /alter table public\.body_parts drop column if exists fun_fact;/);
    assert.match(down, /when b\.tattoo_info = v\.tattoo_info and b\.part_id = 'brazo' then 'Otro ejemplosas'/);
    assert.match(down, /\('omoplato', 4\)/, 'devuelve el orden anterior');
});

// REQ-08 (P11): el "dato curioso" se edita desde el backoffice. La columna
// llega con la migración 20261116100000 y el código se publica antes: mientras
// la base no la tenga, el editor no ofrece el campo ni lo escribe.
test('backoffice: el dato curioso de la zona se edita y se guarda solo si la base tiene la columna', async () => {
    const cm = read('public', 'shared', 'js', 'config-manager.js');
    const block = cm.slice(cm.indexOf('// ========== BODY PARTS - SUPABASE OPERATIONS =========='), cm.indexOf('     * Delete a body part from Supabase'));
    assert.ok(block.length > 2000);
    const load = (rows) => {
        const writes = [];
        const chain = (result) => ({ select: () => chain(result), eq: () => chain(result), single: async () => result, order: async () => result });
        const sandbox = {
            console: { warn() {}, error() {}, log() {} },
            _dbg() {}, getBodyParts: () => [], getSupabaseClient: () => ({}),
            WeotziData: {
                from(table) {
                    assert.equal(table, 'body_parts');
                    return {
                        select: () => chain({ data: rows, error: null }),
                        insert: (list) => { writes.push({ op: 'insert', row: list[0] }); return chain({ data: { part_id: list[0].part_id }, error: null }); },
                        update: (row) => { writes.push({ op: 'update', row }); return chain({ data: { part_id: row.part_id }, error: null }); }
                    };
                }
            }
        };
        vm.runInNewContext(`${block}\n*/\nthis.api = { loadBodyPartsFromDB, createBodyPartInDB, updateBodyPartInDB, bodyPartsSupportFunFact };`, sandbox);
        return { api: sandbox.api, writes };
    };
    const row = (extra) => ({ id: 1, part_id: 'brazo', label: 'Brazo', sort_order: 1, parent_id: null, ...extra });
    const form = { id: 'brazo', label: 'Brazo', description: 'El brazo.', tattoo_info: null, experience_info: null };

    // Base con la columna: el árbol trae el dato y el guardado lo escribe.
    const withColumn = load([row({ fun_fact: 'Dato del brazo.' }), row({ id: 2, part_id: 'codo', label: 'Codo', parent_id: 1, fun_fact: null })]);
    assert.equal(withColumn.api.bodyPartsSupportFunFact(), false, 'antes de cargar no se asume la columna');
    const tree = await withColumn.api.loadBodyPartsFromDB();
    assert.equal(withColumn.api.bodyPartsSupportFunFact(), true);
    assert.equal(tree[0].fun_fact, 'Dato del brazo.');
    assert.equal(tree[0].subparts[0].fun_fact, '');
    await withColumn.api.updateBodyPartInDB(1, { ...form, fun_fact: '  Otro dato.  ' });
    await withColumn.api.updateBodyPartInDB(1, { ...form, fun_fact: '   ' });
    await withColumn.api.createBodyPartInDB({ ...form, id: 'nueva', fun_fact: 'Dato nuevo.' }, 1);
    assert.deepEqual(withColumn.writes.map((w) => [w.op, w.row.fun_fact]), [['update', 'Otro dato.'], ['update', null], ['insert', 'Dato nuevo.']]);
    // Un guardado que no trae el campo (formulario sin el textarea) no toca la columna.
    await withColumn.api.updateBodyPartInDB(1, form);
    assert.ok(!('fun_fact' in withColumn.writes[3].row));
    assert.equal(withColumn.writes[3].row.description, 'El brazo.');

    // Base sin la migración: nunca se manda la columna, el resto se guarda igual.
    const without = load([row({})]);
    await without.api.loadBodyPartsFromDB();
    assert.equal(without.api.bodyPartsSupportFunFact(), false);
    await without.api.updateBodyPartInDB(1, { ...form, fun_fact: 'Dato.' });
    await without.api.createBodyPartInDB({ ...form, id: 'nueva', fun_fact: 'Dato.' }, null);
    for (const write of without.writes) assert.ok(!('fun_fact' in write.row), `${write.op} manda fun_fact sin la columna`);
    assert.equal(without.writes.length, 2);
    assert.match(cm, /deleteBodyPartFromDB,\n\s+bodyPartsSupportFunFact,/);

    // Editor del backoffice: campo propio, valor escapado y lectura al guardar.
    const admin = read('public', 'shared', 'js', 'admin.js');
    assert.match(admin, /const funFactField = window\.ConfigManager\?\.bodyPartsSupportFunFact\?\.\(\) \? `/);
    assert.match(admin, /<label for="node-fun-fact">Dato curioso<\/label>\s*<textarea id="node-fun-fact"[^>]*>\$\{escapeHtml\(node\.fun_fact \|\| ''\)\}<\/textarea>/);
    assert.match(admin, /id="node-experience-info"[^\n]*\n\s*<\/div>\n\$\{funFactField\}/, 'va después de "Experiencia de Tatuaje"');
    assert.match(admin, /fun_fact: document\.getElementById\('node-fun-fact'\) \? document\.getElementById\('node-fun-fact'\)\.value\.trim\(\) : undefined,/);
});
