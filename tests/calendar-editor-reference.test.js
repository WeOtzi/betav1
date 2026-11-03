const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../public/shared/js/calendar-editor-reference.js');
const model = fs.existsSync(file) ? require(file) : {};

test('only the four approved create states get the editor reference layer', () => {
  assert.equal(typeof model.referenceState, 'function', 'Missing approved-state isolation');
  assert.equal(model.referenceState(null, false), 'choose-type');
  for (const type of ['confirmed_session', 'reservation', 'availability']) {
    assert.equal(model.referenceState(type, false), type);
    assert.equal(model.referenceState(type, true), null);
  }
  for (const type of ['blocked_day', 'guest_spot', 'convention', 'reminder', 'personal']) {
    assert.equal(model.referenceState(type, false), null);
  }
});

test('quotation choices are owned, searchable and retain numeric relationship ids', () => {
  assert.equal(typeof model.quotationOptions, 'function', 'Missing owned quotation choices');
  const rows = [
    { id: 56, quote_id: 'COT-056', artist_id: 'owner', quote_status: 'client_approved', client_full_name: 'Julieta Sosa', tattoo_idea_description: 'Ola fina en costilla' },
    { id: 58, quote_id: 'COT-058', artist_id: 'owner', quote_status: 'pending', client_full_name: 'Marina Ibáñez', tattoo_idea_description: 'Jaguar' },
    { id: 49, quote_id: 'COT-049', artist_id: 'owner', quote_status: 'client_rejected', client_full_name: 'Rechazada' },
    { id: 99, quote_id: 'OTHER', artist_id: 'someone-else', quote_status: 'client_approved', client_full_name: 'Ajena' },
    { id: 100, artist_id: 'owner', quote_status: 'in_progress', client_full_name: 'Borrador' },
  ];
  const choices = model.quotationOptions(rows, 'owner', '');
  assert.deepEqual(choices.map(c => c.id), [56, 58, 49]);
  assert.equal(choices[0].number, 'COT-056');
  assert.equal(choices[0].group, 'approved');
  assert.equal(choices[1].group, 'pending');
  assert.equal(choices[2].disabled, true);
  assert.equal(model.quotationOptions(rows, 'owner', 'ibanez')[0].id, 58);
  assert.equal(model.quotationOptions(rows, 'owner', 'costilla')[0].id, 56);
  assert.equal(model.quotationOptions(rows, 'owner', 'COT-056')[0].id, 56);
  assert.deepEqual(model.quotationOptions(rows, 'owner', 'sin coincidencias'), []);
  assert.deepEqual(model.quotationOptions(rows, null, ''), []);
});

test('the agreed linkage limitation cannot silently save a manual substitute', () => {
  assert.equal(typeof model.assertManualSaveAllowed, 'function', 'Missing explicit linkage guard');
  assert.doesNotThrow(() => model.assertManualSaveAllowed(null));
  assert.throws(() => model.assertManualSaveAllowed({ id: 56 }), /vinculación.*no está disponible/i);
});

test('quotation labels do not relabel a completed artist step as work in progress', () => {
  const choices = model.quotationOptions([
    { id: 1, artist_id: 'owner', quote_status: 'artist_completed', client_full_name: 'Lista' },
    { id: 2, artist_id: 'owner', quote_status: 'responded', client_full_name: 'Respondida' },
  ], 'owner', '');
  assert.equal(choices[0].statusLabel, 'Lista para cliente');
  assert.equal(choices[1].statusLabel, 'Respondida');
});

test('mini calendar reference uses actual weeks instead of an extra sixth July row', () => {
  assert.equal(typeof model.monthDayCount, 'function', 'Missing actual month week count');
  assert.equal(model.monthDayCount(new Date(2026, 6, 9)), 35);
  assert.equal(model.monthDayCount(new Date(2026, 7, 1)), 42);
  assert.equal(model.monthDayCount(new Date(2027, 1, 1)), 28);
});

test('calendar submit blocks a selected quotation before calling any write repository', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/shared/js/calendar.js'), 'utf8');
  // Test-only access to the real submit handler; no test hooks in production.
  const instrumented = source.replace('window.WeotziCalendar = {',
    'window.testSubmit = saveCurrentEvent; window.testState = state; window.testElements = el; window.WeotziCalendar = {');
  let writes = 0;
  const inputs = {
    'event-date': { value: '2026-07-11' }, 'event-time': { value: '10:00' },
    'event-duration': { value: '1' }, 'event-client': { value: 'Cliente de prueba' },
    'event-location': { value: 'Estudio propio' }, 'event-notes': { value: '' },
  };
  const sandbox = {
    window: {
      WeotziCalendarEditorReference: model,
      WeotziData: { Calendar: { async create() { writes++; }, async update() { writes++; } } },
      location: { pathname: '/calendar', search: '' }, setTimeout, clearTimeout,
    },
    document: { addEventListener() {}, getElementById(id) { return inputs[id] || null; } },
    console, Date, Intl, URLSearchParams, Set, Map,
  };
  vm.runInNewContext(instrumented, sandbox);
  const w = sandbox.window;
  w.testState.user = { id: 'owner' };
  w.testState.selectedType = 'confirmed_session';
  w.testState.selectedQuote = { id: 56 };
  const error = { textContent: '' };
  Object.assign(w.testElements, {
    'event-form-error': error,
    'calendar-event-form': { checkValidity() { return true; } },
    'save-event': { disabled: false, textContent: '' },
    'calendar-editor': { hasAttribute() { return false; } },
  });
  await w.testSubmit({ preventDefault() {} });
  assert.equal(writes, 0, 'A selected quotation must never be saved as a manual event');
  assert.match(error.textContent, /vinculación.*no está disponible/i);
});
