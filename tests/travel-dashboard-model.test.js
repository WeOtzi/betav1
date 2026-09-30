'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'public', 'shared', 'js', 'travel-dashboard-model.js');
const subject = fs.existsSync(modulePath) ? require(modulePath) : {};

test('Travel provides a reusable destination model', () => {
    assert.equal(typeof subject.buildUpcomingDestinations, 'function');
    assert.equal(typeof subject.createDestinationNavigator, 'function');
    assert.equal(typeof subject.buildDestinationMetrics, 'function');
    assert.equal(typeof subject.buildMissingDestinationQueries, 'function');
    assert.equal(typeof subject.canonicalTravelPath, 'function');
});

test('upcoming destinations exclude expired/cancelled records and sort ongoing before future', () => {
    const rows = subject.buildUpcomingDestinations([
        { id: 'expired-demo', start_date: '2026-08-15', end_date: '2026-08-22', status: 'confirmado' },
        { id: 'future-later', start_date: '2026-09-20', end_date: '2026-09-25', status: 'planificado' },
        { id: 'cancelled', start_date: '2026-09-01', end_date: '2026-09-03', status: 'cancelado' },
        { id: 'unknown-status', start_date: '2026-09-02', end_date: '2026-09-04', status: 'borrador' },
        { id: 'invalid-range', start_date: '2026-09-08', end_date: '2026-09-06', status: 'confirmado' },
        { id: 'ongoing', start_date: '2026-08-28', end_date: '2026-09-03', status: 'confirmado' },
        { id: 'future-first', start_date: '2026-09-03', end_date: '2026-09-07', status: 'pendiente' },
    ], { today: new Date(2026, 7, 30) });

    assert.deepEqual(rows.map((row) => row.id), ['ongoing', 'future-first', 'future-later']);
});

test('destination navigator advances without wrapping and exposes truthful bounds', () => {
    const nav = subject.createDestinationNavigator([{ id: 'a' }, { id: 'b' }]);
    assert.equal(nav.selected.id, 'a');
    assert.equal(nav.canPrevious, false);
    assert.equal(nav.canNext, true);
    assert.equal(nav.previous(), null);
    assert.equal(nav.next().id, 'b');
    assert.equal(nav.canNext, false);
    assert.equal(nav.next(), null);
    assert.equal(nav.previous().id, 'a');
});

test('destination metrics use persisted values and confirmed studio links only', () => {
    const metrics = subject.buildDestinationMetrics({
        start_date: '2026-09-03',
        end_date: '2026-09-10',
        interested_people_count: 0,
        climate_celsius: null,
        trip_studio_links: [
            { studio_id: 'confirmed', status: 'confirmada' },
            { studio_id: 'pending', status: 'esperando_confirmacion' },
            { studio_id: 'rejected', status: 'rechazada' },
        ],
    }, { today: new Date(2026, 7, 30) });

    assert.deepEqual(metrics, {
        daysRemaining: 4,
        stayDays: 7,
        interestedPeople: 0,
        climateCelsius: null,
        confirmedStudioCount: 1,
    });
});

test('studio metric distinguishes a loaded empty relationship from a missing embed', () => {
    const dates = { start_date: '2026-09-03', end_date: '2026-09-10' };
    assert.equal(subject.buildDestinationMetrics({ ...dates, trip_studio_links: [] }).confirmedStudioCount, 0);
    assert.equal(subject.buildDestinationMetrics(dates).confirmedStudioCount, null);
});

test('canonical Travel URLs never preserve the removed globe proof-of-concept flag', () => {
    assert.equal(subject.canonicalTravelPath(), '/artist/travel/');
    assert.equal(subject.canonicalTravelPath('trip-1'), '/artist/travel/?trip=trip-1');
});

test('missing destination queries include only unique upcoming cities without known coordinates', () => {
    const rows = subject.buildMissingDestinationQueries([
        { id: 'past', city: 'Oslo', country: 'Noruega', start_date: '2026-07-01', end_date: '2026-07-03', status: 'confirmado' },
        { id: 'known', city: 'Madrid', country: 'España', start_date: '2026-09-01', end_date: '2026-09-03', status: 'confirmado' },
        { id: 'new-1', city: 'Reikiavik', country: 'Islandia', start_date: '2026-09-04', end_date: '2026-09-06', status: 'planificado' },
        { id: 'new-2', city: 'REIKIAVIK', country: 'ISLANDIA', start_date: '2026-09-07', end_date: '2026-09-08', status: 'pendiente' },
    ], [
        { city: 'Madrid', country: 'España', latitude: 40.4168, longitude: -3.7038 },
    ], { today: new Date(2026, 7, 31) });

    assert.deepEqual(rows, [{
        key: 'reikiavik|islandia',
        city: 'Reikiavik',
        country: 'Islandia',
        query: 'Reikiavik, Islandia',
    }]);
});
