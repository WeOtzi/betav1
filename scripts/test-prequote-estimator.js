#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { parseSessionPrice, estimatePreQuote } = require('../lib/prequote-estimator');

assert.strictEqual(parseSessionPrice('9500,00 US$'), 9500);
assert.strictEqual(parseSessionPrice('$1,500.00'), 1500);
assert.strictEqual(parseSessionPrice('500 MXN'), 500);
assert.strictEqual(parseSessionPrice('Consultar'), null);

const artists = [
    { user_id: 'a1', username: 'real.one', name: 'Real One', city: 'Bogota', country: 'Colombia', ubicacion: 'Bogota, Colombia', styles_array: ['Realismo'], session_price: '400 USD', artist_index: 80 },
    { user_id: 'a2', username: 'real.two', name: 'Real Two', city: 'Bogota', country: 'Colombia', ubicacion: 'Bogota, Colombia', styles_array: ['Realismo'], session_price: '600 USD', artist_index: 70 },
    { user_id: 'a3', username: 'trad.one', name: 'Trad One', city: 'Medellin', country: 'Colombia', ubicacion: 'Medellin, Colombia', styles_array: ['Tradicional'], session_price: '300 USD', artist_index: 60 }
];

const result = estimatePreQuote({
    tattoo_style: 'realismo',
    tattoo_size: 'grande',
    client_city_residence: 'Bogotá, Colombia'
}, artists);

assert.strictEqual(result.estimate.estimatedSessionsMin, 2);
assert.strictEqual(result.estimate.estimatedSessionsMax, 3);
assert.strictEqual(result.suggestedArtists[0].username, 'real.one');
assert.strictEqual(result.suggestedArtists[0].match_tier, 1);
assert.ok(result.estimate.minAmount > 0);
assert.ok(result.estimate.maxAmount >= result.estimate.minAmount);

console.log('prequote estimator tests passed');
