const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function model() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('public/shared/js/artist-dashboard-menu-model.js', 'utf8'), context);
  return context.window.ArtistDashboardMenuModel;
}
test('dashboard notification fixtures cannot activate on other routes or real sessions', () => {
  const api = model();
  for (const flags of [{}, { dashboard: true }, { dashboard: true, preview: true }, { preview: true, simulated: true }]) {
    assert.equal(api.create(flags), null);
  }
});
test('notification drawer starts with five unread of nine and returns independent snapshots', () => {
  const reference = model().create({ dashboard: true, preview: true, simulated: true });
  const feed = reference.feed(new Set());
  assert.equal(feed.length, 9);
  assert.equal(feed.filter(row => row.unread).length, 5);
  assert.equal(feed[0].href, '/artist/inbox');
  assert.equal(feed[3].href, '/artist/applications?tab=spots');
  feed[0].unread = false;
  assert.equal(reference.feed(new Set())[0].unread, true);
});
test('read receipts clear only their matching preview notification and survive a fresh model', () => {
  const api = model();
  const reference = api.create({ dashboard: true, preview: true, simulated: true });
  const feed = reference.feed(new Set());
  const seen = new Set([feed[0].key]);
  const next = api.create({ dashboard: true, preview: true, simulated: true }).feed(seen);
  assert.equal(next.filter(row => row.unread).length, 4);
  assert.equal(next[1].unread, true);
  assert.equal(reference.counts(new Set()).notifications, 6);
  assert.equal(reference.counts(seen).notifications, 5);
  const all = new Set(feed.map(row => row.key));
  assert.equal(reference.feed(all).filter(row => row.unread).length, 0);
  assert.equal(reference.counts(all).notifications, 0);
  assert.equal(reference.counts(all).msgs, 0);
  assert.equal(reference.counts(all).apps, 2, 'reading does not remove applications');
});
