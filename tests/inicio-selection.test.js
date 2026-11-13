'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Revisión 12/11 (p. 1): Inicio ya no tiene un único "Continuar". Cada
// experiencia muestra sus propios enlaces (visibles por CSS según el radio
// marcado) e inicio.js solo reordena las tarjetas. Ver también
// tests/registro-inicio.test.js.
const html = fs.readFileSync(path.join(__dirname, '../public/inicio/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/inicio/inicio.css'), 'utf8');

function group(name) {
  const match = html.match(new RegExp(`<div class="inicio-actions-group" data-for="${name}"[\\s\\S]*?</div>`));
  assert.ok(match, `grupo ${name}`);
  return match[0];
}

test('Inicio arranca sin experiencia elegida ni botón Continuar global', () => {
  assert.doesNotMatch(html, /name="experience"[^>]*checked/);
  assert.doesNotMatch(html, /id="inicio-continue"/);
  assert.match(css, /\.inicio-actions \{[^}]*display:none/);
  assert.match(css, /\.inicio-main:has\(\.inicio-radio:checked\) \.inicio-actions \{ display:flex; \}/);
});

test('Soy tatuador: Soy nuevo → crear cuenta y Ya tengo cuenta → login de artista', () => {
  const artist = group('artist');
  assert.match(artist, /href="\/registerclosedbeta"[^>]*>Soy nuevo/);
  assert.match(artist, /href="\/artist\/login\/"[^>]*>Ya tengo cuenta/);
});

test('Quiero tatuarme: marketplace y cotizador en "Quiero explorar opciones"', () => {
  const client = group('client');
  assert.match(client, /href="\/marketplace\/"[^>]*>Buscar tatuador/);
  assert.match(client, /href="\/quotation\?idea=explorar"[^>]*>Recomiéndame tatuador/);
  const quotation = fs.readFileSync(path.join(__dirname, '../public/shared/js/script.js'), 'utf8');
  assert.match(quotation, /initialUrlParams\.get\('idea'\) === 'explorar'\) formData\.tattoo_idea_mode = 'explorar'/);
});

test('Tengo un estudio sigue yendo al alta de estudio', () => {
  assert.match(group('studio'), /href="\/studio\/register\/"/);
});

test('inicio.js se carga sin DOM y expone el orden de tarjetas', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/inicio/inicio.js'), 'utf8'), context);
  assert.deepEqual(Array.from(context.WoInicio.layoutFor('')), ['client', 'artist', 'studio']);
});
