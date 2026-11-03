const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = () => fs.readFileSync('public/shared/js/artist-dashboard-reference.js', 'utf8');
test('artist reference never activates outside the doubly guarded simulated preview', () => {
  for (const window of [{}, { WEOTZI_PREVIEW: true }, { WeotziPreview: { isSimulated: true } }]) {
    vm.runInNewContext(source(), { window });
    assert.equal(window.ArtistDashboardReference, undefined);
  }
});
test('artist reference supplies four agenda rows and three designs without writing data', () => {
  const window = { WEOTZI_PREVIEW: true, WeotziPreview: { isSimulated: true } };
  vm.runInNewContext(source(), { window });
  const ref = window.ArtistDashboardReference;
  assert.equal(ref.sessions.length, 4);
  assert.equal(ref.sessions[2].status, 'pending_confirmation');
  assert.equal(ref.designs.length, 3);
  assert.equal(ref.designs[1].progress, 40);
  assert.equal(ref.reminders.length, 4);
  assert.equal(ref.stats.approved, 8);
  assert.equal(ref.income.month, '$4.820');
});
