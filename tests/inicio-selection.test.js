'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Boundary harness: native radio state belongs to the browser; our controller
// must keep the actual navigation link synchronized, without navigating early.
function loadSelection(value) {
  const listeners = {};
  const form = { elements: { experience: { value } }, addEventListener(type, fn) { listeners[type] = fn; } };
  const link = { href: '', setAttribute(name, value) { this[name] = value; } };
  const document = { querySelector(selector) { return selector === '#inicio-selection' ? form : link; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/inicio/inicio.js'), 'utf8'), { document });
  return { form, link, change(value) { form.elements.experience.value = value; listeners.change(); } };
}

test('Inicio continues to artist login for the initial artist selection', () => {
  assert.equal(loadSelection('artist').link.href, '/artist/login/');
});
test('selecting client updates Continuar without leaving Inicio', () => {
  const state = loadSelection('artist');
  state.change('client');
  assert.equal(state.link.href, '/marketplace/');
});
test('switching back to artist restores the artist destination', () => {
  const state = loadSelection('artist');
  state.change('client');
  state.change('artist');
  assert.equal(state.link.href, '/artist/login/');
});
