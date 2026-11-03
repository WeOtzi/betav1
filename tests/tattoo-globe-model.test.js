'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function model() {
    const context = { window: {} };
    const file = path.join(__dirname, '../public/shared/js/tattoo-globe-model.js');
    if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
    return context.window.TattooGlobeModel;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('normal runtime never substitutes Figma example history or directory counts for real data', () => {
    const result = model()?.buildScreen({ preview: false, artists: [
        { user_id: 'one', city: 'Madrid', studio_id: 'studio-1' },
        { user_id: 'two', city: 'MADRID', studio_id: 'studio-1' },
        { user_id: 'three', city: 'Paris', studio_id: null }
    ] });
    assert.ok(result, 'screen model is available');
    assert.deepEqual(plain(result.stamps), []);
    assert.equal(result.journey, null);
    assert.deepEqual(plain(result.savedIds), []);
    assert.equal(result.destinations[0].artists, 2);
    assert.equal(result.destinations[0].studios, 1);
    assert.equal(result.destinations[1].artists, 1);
    assert.equal(result.destinations[2].artists, 0);
});

test('isolated preview renders the three reference stamps, not arbitrary real user history', () => {
    const result = model()?.buildScreen({ preview: true, artists: [] });
    assert.ok(result, 'screen model is available');
    assert.deepEqual(plain(result.stamps.map(row => [row.city, row.tattoos, row.artists, row.year])), [
        ['Buenos Aires', 3, 2, 2025], ['São Paulo', 1, 1, 2024], ['Bogotá', 2, 2, 2023]
    ]);
    assert.deepEqual(plain(result.journey), [3, 3, 6, 5, '4,180']);
    assert.equal(result.destinations[0].artists, 38);
    assert.deepEqual(plain(result.savedIds), ['madrid', 'paris', 'barcelona']);
});

test('city discovery ignores case and accents but does not match unrelated cities', () => {
    const api = model();
    assert.equal(api?.matchesCity({ city: '  São Paulo ' }, 'Sao Paulo'), true);
    assert.equal(api?.matchesCity({ city: 'París' }, 'Paris'), true);
    assert.equal(api?.matchesCity({ city: 'Madrid' }, 'Barcelona'), false);
    assert.equal(api?.matchesCity({ city: null }, 'Madrid'), false);
    assert.equal(api?.matchesCity({ city: 'Madrid' }, ''), true);
});

test('saved destinations preserve intentional empty state and discard corrupt or unknown stored entries', () => {
    const api = model();
    assert.deepEqual(plain(api?.readSaved('[]', ['madrid'])), []);
    assert.deepEqual(plain(api?.readSaved('["madrid","unknown","madrid",null]', [])), ['madrid']);
    assert.deepEqual(plain(api?.readSaved('{broken', ['paris'])), ['paris']);
    assert.deepEqual(plain(api?.readSaved('{"madrid":true}', ['paris'])), ['paris']);
});
