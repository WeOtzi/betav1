'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTravelWithVenue } = require('../public/shared/js/travel-form-model.js');

test('createTravelWithVenue links the selected database studio after creating the trip', async () => {
    const calls = [];
    const travel = {
        async create(payload) {
            calls.push(['create', payload]);
            return { id: 'trip-1', city: payload.city };
        },
        async requestStudioLink(payload) {
            calls.push(['link', payload]);
        },
    };

    const result = await createTravelWithVenue({
        travel,
        payload: { city: 'Berlín' },
        selectedStudio: { id: 'studio-7', name: 'Black Forest Tattoo' },
    });

    assert.equal(result.partial, false);
    assert.equal(result.trip.status, 'pendiente');
    assert.deepEqual(calls, [
        ['create', { city: 'Berlín' }],
        ['link', { tripId: 'trip-1', studioId: 'studio-7' }],
    ]);
});

test('createTravelWithVenue reports partial success when a convention place update fails', async () => {
    const failure = new Error('update unavailable');
    const travel = {
        async create() {
            return { id: 'trip-2', city: 'Barcelona' };
        },
        async update() {
            throw failure;
        },
    };

    const result = await createTravelWithVenue({
        travel,
        payload: { city: 'Barcelona' },
        selectedPlace: { name: 'Fira Barcelona' },
    });

    assert.equal(result.partial, true);
    assert.equal(result.pendingAction, 'place');
    assert.equal(result.trip.id, 'trip-2');
    assert.equal(result.completionError, failure);
});

test('createTravelWithVenue still rejects when the base trip itself was not created', async () => {
    const failure = new Error('create failed');
    const travel = {
        async create() {
            throw failure;
        },
    };

    await assert.rejects(
        createTravelWithVenue({ travel, payload: { city: 'Madrid' } }),
        failure,
    );
});
