'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const modelPath = path.join(root, 'public', 'shared', 'js', 'travel-form-model.js');
const model = fs.existsSync(modelPath) ? require(modelPath) : {};

test('Travel provides a reusable create-form selection model', () => {
    assert.equal(typeof model.createTravelFormState, 'function');
});

test('selecting a city fills its country and preserves the Google place identity', () => {
    const form = model.createTravelFormState();
    form.selectCity({ city: 'Lisboa', country: 'Portugal', google_place_id: 'city-lisbon' });
    assert.deepEqual(form.location, {
        city: 'Lisboa',
        country: 'Portugal',
        cityPlaceId: 'city-lisbon',
        countryPlaceId: '',
    });
});

test('studio text is accepted only when it still matches a selected database studio', () => {
    const form = model.createTravelFormState();
    form.setType('guest_spot');
    form.selectStudio({ id: 'studio-1', name: 'Black Forest Tattoo' });
    assert.equal(form.validateVenue('Black Forest Tattoo').valid, true);
    form.changeVenue('Otro estudio');
    assert.equal(form.validateVenue('Otro estudio').valid, false);
    assert.equal(form.selectedStudio, null);
    assert.equal(form.validateVenue('').valid, true, 'an unconfirmed studio may remain empty');
});

test('convention mode swaps studio for a Google Maps place and maps its structured address', () => {
    const form = model.createTravelFormState();
    form.selectStudio({ id: 'studio-1', name: 'Black Forest Tattoo' });
    form.setType('convencion');
    assert.equal(form.selectedStudio, null);
    assert.equal(form.venueMode, 'place');
    form.selectPlace({
        city: 'Barcelona',
        country: 'España',
        formatted_address: 'Fira Barcelona, Avinguda de la Reina Maria Cristina, Barcelona, España',
        google_place_id: 'place-fira',
    }, { name: 'Fira Barcelona' });
    assert.deepEqual(form.place, {
        name: 'Fira Barcelona',
        formattedAddress: 'Fira Barcelona, Avinguda de la Reina Maria Cristina, Barcelona, España',
        googlePlaceId: 'place-fira',
    });
    assert.equal(form.location.city, 'Barcelona');
    assert.equal(form.location.country, 'España');
    assert.equal(form.validateVenue('Fira Barcelona').valid, true);
    form.changeVenue('Lugar inventado');
    assert.equal(form.validateVenue('Lugar inventado').valid, false);
});

test('AddressPicker gives consumers the original Google place as a second callback argument', () => {
    const source = fs.readFileSync(path.join(root, 'public', 'shared', 'js', 'address-picker.js'), 'utf8');
    assert.match(source, /options\.onChange\(addr,\s*place\)/);
});

test('AddressPicker detach removes native listeners before the same input is attached again', async () => {
    const source = fs.readFileSync(path.join(root, 'public', 'shared', 'js', 'address-picker.js'), 'utf8');
    const listeners = new Map();
    const input = {
        tagName: 'INPUT',
        value: '',
        classList: { add() {} },
        setAttribute() {},
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            if (listeners.has(type)) listeners.get(type).delete(handler);
        },
        dispatch(type, event) {
            for (const handler of listeners.get(type) || []) handler(event || {});
        },
        listenerCount(type) {
            return (listeners.get(type) || new Set()).size;
        },
    };

    let googleListenerRemovals = 0;
    class FakeAutocomplete {
        setComponentRestrictions() {}
        addListener() {
            return { remove() { googleListenerRemovals += 1; } };
        }
    }

    const browserWindow = {
        WeOtziGeocoder: { ensureGoogleMapsLoaded: () => Promise.resolve() },
        google: { maps: { places: { Autocomplete: FakeAutocomplete } } },
    };
    vm.runInNewContext(source, {
        window: browserWindow,
        console,
        Promise,
        Number,
        Object,
        String,
        setInterval,
        clearInterval,
    });

    let firstChanges = 0;
    const first = browserWindow.WeOtziAddressPicker.attach(input, {
        onChange() { firstChanges += 1; },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(input.listenerCount('keydown'), 1);
    assert.equal(input.listenerCount('input'), 1);

    first.detach();
    assert.equal(input.listenerCount('keydown'), 0);
    assert.equal(input.listenerCount('input'), 0);
    assert.equal(googleListenerRemovals, 1);

    let secondChanges = 0;
    const second = browserWindow.WeOtziAddressPicker.attach(input, {
        onChange() { secondChanges += 1; },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(input.listenerCount('keydown'), 1);
    assert.equal(input.listenerCount('input'), 1);

    input.value = '';
    input.dispatch('input');
    assert.equal(firstChanges, 0, 'the detached picker must not receive input changes');
    assert.equal(secondChanges, 1, 'only the active picker receives the input change');

    second.detach();
    assert.equal(input.listenerCount('keydown'), 0);
    assert.equal(input.listenerCount('input'), 0);
    assert.equal(googleListenerRemovals, 2);
});

test('AddressPicker degrades cleanly when Google Maps cannot load', async () => {
    const source = fs.readFileSync(path.join(root, 'public', 'shared', 'js', 'address-picker.js'), 'utf8');
    const warnings = [];
    const input = {
        tagName: 'INPUT',
        value: '',
        classList: { add() {} },
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
    };
    const browserWindow = {
        WeOtziGeocoder: { ensureGoogleMapsLoaded: () => Promise.reject(new Error('missing key')) },
    };
    vm.runInNewContext(source, {
        window: browserWindow,
        console: { warn(...args) { warnings.push(args); } },
        Promise,
        Number,
        Object,
        String,
        setInterval,
        clearInterval,
    });

    const picker = browserWindow.WeOtziAddressPicker.attach(input);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /Google Maps no está disponible/);
    picker.detach();
});

test('studio directory search is restricted to active, completed database studios', () => {
    const source = fs.readFileSync(path.join(root, 'public', 'shared', 'js', 'data', 'studios-repo.js'), 'utf8');
    assert.match(source, /searchTravelDirectory\(/);
    assert.match(source, /\.eq\('is_active',\s*true\)/);
    assert.match(source, /\.eq\('profile_complete',\s*true\)/);
    assert.match(source, /\.not\('user_id',\s*'is',\s*null\)/);
});
