'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'public', 'shared', 'js', 'artist-travel-cobe.js');
const subject = fs.existsSync(modulePath) ? require(modulePath) : null;
const behaviorTest = subject ? test : test.skip;

test('Travel exposes the COBE route and lifecycle module', () => {
    assert.ok(subject, 'public/shared/js/artist-travel-cobe.js must exist');
    assert.equal(typeof subject.buildTravelRoute, 'function');
    assert.equal(typeof subject.createTravelRouteNavigator, 'function');
    assert.equal(typeof subject.mountTravelGlobe, 'function');
});

test('Travel loads artist base coordinates and delegates responsive layout to the global component', () => {
    const integrationSource = fs.readFileSync(
        path.join(root, 'public', 'shared', 'js', 'artist-travel.js'),
        'utf8'
    );
    const componentSource = fs.readFileSync(
        path.join(root, 'public', 'shared', 'js', 'weotzi-travel-globe.js'),
        'utf8'
    );

    assert.match(integrationSource, /user_id, name, username, city, country, latitude, longitude/);
    assert.match(integrationSource, /setTravelData\s*\(/);
    assert.match(componentSource, /ResizeObserver/);
    assert.match(componentSource, /this\.clientWidth/);
});

function completeFixture() {
    return {
        artist: {
            user_id: 'artist-isainaz',
            name: 'Isaí Naz',
            username: 'isainazartattoo.wo',
            city: 'Buenos Aires',
            country: 'Argentina',
            formatted_address: 'Av. Corrientes 1660, Buenos Aires, Argentina',
            latitude: -34.6037,
            longitude: -58.3816,
        },
        studios: [
            {
                id: 'studio-berlin',
                name: 'Black Forest Tattoo',
                city: 'Berlín',
                country: 'Alemania',
                formatted_address: 'Rosenthaler Str. 43, Berlín, Alemania',
                latitude: null,
                longitude: null,
                primary_location_id: 'location-berlin',
                is_active: true,
            },
            {
                id: 'studio-lima',
                name: 'Estudio Costa',
                city: 'Lima',
                country: 'Perú',
                formatted_address: 'Av. Arequipa 1850, Lince, Lima, Perú',
                latitude: null,
                longitude: null,
                primary_location_id: 'location-lima',
                is_active: true,
            },
            {
                id: 'studio-madrid',
                name: 'Ritual Tattoo Madrid',
                city: 'Madrid',
                country: 'España',
                formatted_address: 'Calle de la Luna 23, Madrid, España',
                latitude: 40.4273,
                longitude: -3.7033,
                primary_location_id: 'location-madrid',
                is_active: true,
            },
            {
                id: 'studio-lisbon',
                name: 'Lisboa Ink Guest Studio',
                city: 'Lisboa',
                country: 'Portugal',
                formatted_address: 'Rua da Rosa 84, Lisboa, Portugal',
                latitude: null,
                longitude: null,
                primary_location_id: 'location-lisbon',
                is_active: true,
            },
            {
                id: 'studio-atlantis',
                name: 'Lost City Tattoo',
                city: 'Atlántida',
                country: 'Océano Atlántico',
                formatted_address: 'Distrito central, Atlántida',
                latitude: null,
                longitude: null,
                primary_location_id: null,
                is_active: true,
            },
        ],
        cityCoordinates: [
            { city: 'Buenos Aires', country: 'Argentina', latitude: -34.6037, longitude: -58.3816 },
            { city: 'Berlín', country: 'Alemania', latitude: 52.52, longitude: 13.405 },
            { city: 'Lima', country: 'Perú', latitude: -12.0464, longitude: -77.0428 },
            { city: 'Madrid', country: 'España', latitude: 40.4168, longitude: -3.7038 },
            { city: 'Lisboa', country: 'Portugal', latitude: 38.7223, longitude: -9.1393 },
            { city: 'Barcelona', country: 'España', latitude: 41.3874, longitude: 2.1686 },
        ],
        trips: [
            {
                id: 'trip-madrid',
                artist_user_id: 'artist-isainaz',
                city: 'Madrid',
                country: 'España',
                region: 'europa',
                start_date: '2026-11-10',
                end_date: '2026-11-18',
                trip_type: 'guest_spot',
                status: 'confirmado',
                origin: 'manual',
                studio_name_hint: 'Ritual Tattoo Madrid',
                event_name: null,
                agreed_conditions: 'Mesa y material descartable incluidos.',
                personal_notes: 'Guest spot con cupos limitados.',
                share_slug: 'madrid-nov26-demo',
                share_enabled: true,
                cancelled_at: null,
                source_type: 'demo',
                source_id: 'source-madrid',
                created_at: '2026-08-10T10:00:00.000Z',
                updated_at: '2026-08-11T10:00:00.000Z',
                trip_studio_links: [{
                    id: 'link-madrid',
                    trip_id: 'trip-madrid',
                    studio_id: 'studio-madrid',
                    studio_name: 'Ritual Tattoo Madrid',
                    studio_city: 'Madrid',
                    status: 'confirmada',
                    requested_at: '2026-08-10T10:05:00.000Z',
                    resolved_at: '2026-08-11T09:00:00.000Z',
                    contact_name: 'Lucía Torres',
                    contact_details: '+34 600 111 222',
                    address_snapshot: 'Calle de la Luna 23, Madrid, España',
                }],
            },
            {
                id: 'trip-barcelona-cancelled',
                artist_user_id: 'artist-isainaz',
                city: 'Barcelona',
                country: 'España',
                region: 'europa',
                start_date: '2026-09-01',
                end_date: '2026-09-05',
                trip_type: 'convencion',
                status: 'cancelado',
                origin: 'manual',
                studio_name_hint: null,
                event_name: 'Barcelona Tattoo Expo',
                agreed_conditions: null,
                personal_notes: 'El viaje fue cancelado.',
                share_slug: null,
                share_enabled: false,
                cancelled_at: '2026-08-20T12:00:00.000Z',
                source_type: 'demo',
                source_id: 'source-barcelona',
                created_at: '2026-08-01T10:00:00.000Z',
                updated_at: '2026-08-20T12:00:00.000Z',
                trip_studio_links: [],
            },
            {
                id: 'trip-lima',
                artist_user_id: 'artist-isainaz',
                city: 'Lima',
                country: 'Perú',
                region: 'sudamerica',
                start_date: '2026-10-03',
                end_date: '2026-10-08',
                trip_type: 'estudio_invitado',
                status: 'pendiente',
                origin: 'automatico',
                studio_name_hint: 'Estudio Costa',
                event_name: null,
                agreed_conditions: 'Confirmación de agenda pendiente.',
                personal_notes: 'Agenda abierta para blackwork y ornamental.',
                share_slug: null,
                share_enabled: false,
                cancelled_at: null,
                source_type: 'studio_invitation',
                source_id: 'source-lima',
                created_at: '2026-08-03T10:00:00.000Z',
                updated_at: '2026-08-04T10:00:00.000Z',
                trip_studio_links: [{
                    id: 'link-lima',
                    trip_id: 'trip-lima',
                    studio_id: 'studio-lima',
                    studio_name: 'Estudio Costa',
                    studio_city: 'Lima',
                    status: 'esperando_confirmacion',
                    requested_at: '2026-08-03T10:05:00.000Z',
                    resolved_at: null,
                    contact_name: 'Valeria Cruz',
                    contact_details: '+51 999 100 200',
                    address_snapshot: 'Av. Arequipa 1850, Lince, Lima, Perú',
                }],
            },
            {
                id: 'trip-atlantis-without-coordinates',
                artist_user_id: 'artist-isainaz',
                city: 'Atlántida',
                country: 'Océano Atlántico',
                region: 'otro',
                start_date: '2026-08-31',
                end_date: '2026-09-02',
                trip_type: 'guest_spot',
                status: 'confirmado',
                origin: 'manual',
                studio_name_hint: 'Lost City Tattoo',
                event_name: null,
                agreed_conditions: null,
                personal_notes: 'No debe aparecer sin coordenadas verificables.',
                share_slug: null,
                share_enabled: false,
                cancelled_at: null,
                source_type: 'demo',
                source_id: 'source-atlantis',
                created_at: '2026-08-05T10:00:00.000Z',
                updated_at: '2026-08-05T10:00:00.000Z',
                trip_studio_links: [{
                    id: 'link-atlantis',
                    trip_id: 'trip-atlantis-without-coordinates',
                    studio_id: 'studio-atlantis',
                    studio_name: 'Lost City Tattoo',
                    studio_city: 'Atlántida',
                    status: 'confirmada',
                    requested_at: '2026-08-05T10:05:00.000Z',
                    resolved_at: '2026-08-05T11:00:00.000Z',
                    contact_name: 'Atlas',
                    contact_details: 'Sin contacto público',
                    address_snapshot: 'Distrito central, Atlántida',
                }],
            },
            {
                id: 'trip-lisbon',
                artist_user_id: 'artist-isainaz',
                city: 'Lisboa',
                country: 'Portugal',
                region: 'europa',
                start_date: '2026-11-10',
                end_date: '2026-11-14',
                trip_type: 'guest_spot',
                status: 'planificado',
                origin: 'manual',
                studio_name_hint: 'Lisboa Ink Guest Studio',
                event_name: null,
                agreed_conditions: null,
                personal_notes: 'Segunda parada de noviembre.',
                share_slug: null,
                share_enabled: false,
                cancelled_at: null,
                source_type: 'demo',
                source_id: 'source-lisbon',
                created_at: '2026-08-12T10:00:00.000Z',
                updated_at: '2026-08-12T10:00:00.000Z',
                trip_studio_links: [{
                    id: 'link-lisbon',
                    trip_id: 'trip-lisbon',
                    studio_id: 'studio-lisbon',
                    studio_name: 'Lisboa Ink Guest Studio',
                    studio_city: 'Lisboa',
                    status: 'confirmada',
                    requested_at: '2026-08-12T10:05:00.000Z',
                    resolved_at: '2026-08-12T11:00:00.000Z',
                    contact_name: 'Inês Duarte',
                    contact_details: '+351 910 222 333',
                    address_snapshot: 'Rua da Rosa 84, Lisboa, Portugal',
                }],
            },
            {
                id: 'trip-berlin',
                artist_user_id: 'artist-isainaz',
                city: 'Berlín',
                country: 'Alemania',
                region: 'europa',
                start_date: '2026-01-10',
                end_date: '2026-01-18',
                trip_type: 'guest_spot',
                status: 'finalizado',
                origin: 'manual',
                studio_name_hint: 'Black Forest Tattoo',
                event_name: null,
                agreed_conditions: 'Viaje completado.',
                personal_notes: 'Parada histórica visible en la prueba.',
                share_slug: 'berlin-ene26-demo',
                share_enabled: true,
                cancelled_at: null,
                source_type: 'demo',
                source_id: 'source-berlin',
                created_at: '2025-12-01T10:00:00.000Z',
                updated_at: '2026-01-19T10:00:00.000Z',
                trip_studio_links: [{
                    id: 'link-berlin',
                    trip_id: 'trip-berlin',
                    studio_id: 'studio-berlin',
                    studio_name: 'Black Forest Tattoo',
                    studio_city: 'Berlín',
                    status: 'confirmada',
                    requested_at: '2025-12-01T10:05:00.000Z',
                    resolved_at: '2025-12-02T10:00:00.000Z',
                    contact_name: 'Mara Klein',
                    contact_details: '+49 30 123456',
                    address_snapshot: 'Rosenthaler Str. 43, Berlín, Alemania',
                }],
            },
        ],
    };
}

function minimalRoute() {
    return {
        base: {
            id: 'artist-base',
            city: 'Buenos Aires',
            country: 'Argentina',
            location: [-34.6037, -58.3816],
        },
        stops: [{
            id: 'trip-lima',
            city: 'Lima',
            country: 'Perú',
            startDate: '2026-10-03',
            endDate: '2026-10-08',
            status: 'pendiente',
            studioName: 'Estudio Costa',
            address: 'Av. Arequipa 1850, Lince, Lima, Perú',
            summary: 'Agenda abierta para blackwork y ornamental.',
            location: [-12.0464, -77.0428],
        }],
        markers: [
            { id: 'artist-base', location: [-34.6037, -58.3816], size: 0.05 },
            { id: 'trip-lima', location: [-12.0464, -77.0428], size: 0.07 },
        ],
        arcs: [{
            id: 'artist-base--trip-lima',
            from: [-34.6037, -58.3816],
            to: [-12.0464, -77.0428],
            fromStopId: null,
            toStopId: 'trip-lima',
        }],
    };
}

function fakeElement({ hidden = false, textContent = '', getContext = () => ({}) } = {}) {
    const classes = new Set();
    const attributes = new Map();
    return {
        hidden,
        textContent,
        clientWidth: 640,
        clientHeight: 640,
        width: 640,
        height: 640,
        style: {},
        dataset: {},
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            contains: (name) => classes.has(name),
            toggle: (name, force) => {
                const enabled = force == null ? !classes.has(name) : Boolean(force);
                if (enabled) classes.add(name);
                else classes.delete(name);
                return enabled;
            },
        },
        getBoundingClientRect: () => ({ width: 640, height: 640, top: 0, right: 640, bottom: 640, left: 0 }),
        getContext,
        addEventListener: () => {},
        removeEventListener: () => {},
        setAttribute: (name, value) => attributes.set(name, String(value)),
        removeAttribute: (name) => attributes.delete(name),
        getAttribute: (name) => attributes.get(name) ?? null,
    };
}

function resizeHarness() {
    const instances = [];
    class FakeResizeObserver {
        constructor(callback) {
            this.callback = callback;
            this.observed = [];
            this.disconnectCount = 0;
            instances.push(this);
        }

        observe(target) {
            this.observed.push(target);
        }

        disconnect() {
            this.disconnectCount += 1;
        }
    }
    return { ResizeObserver: FakeResizeObserver, instances };
}

function animationHarness() {
    let nextId = 40;
    const requests = [];
    const cancellations = [];
    return {
        requests,
        cancellations,
        requestAnimationFrame(callback) {
            nextId += 1;
            requests.push({ id: nextId, callback });
            return nextId;
        },
        cancelAnimationFrame(id) {
            cancellations.push(id);
        },
    };
}

behaviorTest('buildTravelRoute orders stops stably and excludes cancelled or ungeocoded trips', () => {
    const { buildTravelRoute } = subject;
    const fixture = completeFixture();
    const originalOrder = fixture.trips.map((trip) => trip.id);

    const route = buildTravelRoute(fixture);

    assert.deepEqual(route.stops.map((stop) => ({
        id: stop.id,
        city: stop.city,
        country: stop.country,
        startDate: stop.startDate,
        endDate: stop.endDate,
        status: stop.status,
        studioName: stop.studioName,
        address: stop.address,
        summary: stop.summary,
        coordinateSource: stop.coordinateSource,
    })), [
        {
            id: 'trip-berlin',
            city: 'Berlín',
            country: 'Alemania',
            startDate: '2026-01-10',
            endDate: '2026-01-18',
            status: 'finalizado',
            studioName: 'Black Forest Tattoo',
            address: 'Rosenthaler Str. 43, Berlín, Alemania',
            summary: 'Parada histórica visible en la prueba.',
            coordinateSource: 'city',
        },
        {
            id: 'trip-lima',
            city: 'Lima',
            country: 'Perú',
            startDate: '2026-10-03',
            endDate: '2026-10-08',
            status: 'pendiente',
            studioName: 'Estudio Costa',
            address: 'Av. Arequipa 1850, Lince, Lima, Perú',
            summary: 'Agenda abierta para blackwork y ornamental.',
            coordinateSource: 'city',
        },
        {
            id: 'trip-madrid',
            city: 'Madrid',
            country: 'España',
            startDate: '2026-11-10',
            endDate: '2026-11-18',
            status: 'confirmado',
            studioName: 'Ritual Tattoo Madrid',
            address: 'Calle de la Luna 23, Madrid, España',
            summary: 'Guest spot con cupos limitados.',
            coordinateSource: 'studio',
        },
        {
            id: 'trip-lisbon',
            city: 'Lisboa',
            country: 'Portugal',
            startDate: '2026-11-10',
            endDate: '2026-11-14',
            status: 'planificado',
            studioName: 'Lisboa Ink Guest Studio',
            address: 'Rua da Rosa 84, Lisboa, Portugal',
            summary: 'Segunda parada de noviembre.',
            coordinateSource: 'city',
        },
    ]);
    assert.deepEqual(fixture.trips.map((trip) => trip.id), originalOrder);
});

behaviorTest('buildTravelRoute prefers studio coordinates over the city catalogue', () => {
    const { buildTravelRoute } = subject;
    const route = buildTravelRoute(completeFixture());

    assert.deepEqual(route.stops.map((stop) => ({ id: stop.id, location: stop.location })), [
        { id: 'trip-berlin', location: [52.52, 13.405] },
        { id: 'trip-lima', location: [-12.0464, -77.0428] },
        { id: 'trip-madrid', location: [40.4273, -3.7033] },
        { id: 'trip-lisbon', location: [38.7223, -9.1393] },
    ]);
});

behaviorTest('buildTravelRoute creates COBE arcs between consecutive dated stops starting at the artist base', () => {
    const { buildTravelRoute } = subject;
    const route = buildTravelRoute(completeFixture());

    assert.deepEqual(route.base, {
        id: 'artist-base',
        city: 'Buenos Aires',
        country: 'Argentina',
        label: 'Tu base · Buenos Aires',
        location: [-34.6037, -58.3816],
    });
    assert.deepEqual(route.markers.map((marker) => ({ id: marker.id, location: marker.location })), [
        { id: 'artist-base', location: [-34.6037, -58.3816] },
        { id: 'trip-berlin', location: [52.52, 13.405] },
        { id: 'trip-lima', location: [-12.0464, -77.0428] },
        { id: 'trip-madrid', location: [40.4273, -3.7033] },
        { id: 'trip-lisbon', location: [38.7223, -9.1393] },
    ]);
    assert.deepEqual(route.arcs.map((arc) => ({
        from: arc.from,
        to: arc.to,
        fromStopId: arc.fromStopId,
        toStopId: arc.toStopId,
    })), [
        {
            from: [-34.6037, -58.3816],
            to: [52.52, 13.405],
            fromStopId: null,
            toStopId: 'trip-berlin',
        },
        {
            from: [52.52, 13.405],
            to: [-12.0464, -77.0428],
            fromStopId: 'trip-berlin',
            toStopId: 'trip-lima',
        },
        {
            from: [-12.0464, -77.0428],
            to: [40.4273, -3.7033],
            fromStopId: 'trip-lima',
            toStopId: 'trip-madrid',
        },
        {
            from: [40.4273, -3.7033],
            to: [38.7223, -9.1393],
            fromStopId: 'trip-madrid',
            toStopId: 'trip-lisbon',
        },
    ]);
});

behaviorTest('createTravelRouteNavigator selects a stop and cycles next and previous at both ends', () => {
    const { buildTravelRoute, createTravelRouteNavigator } = subject;
    const route = buildTravelRoute(completeFixture());
    const navigator = createTravelRouteNavigator(route.stops);

    assert.equal(navigator.selectedIndex, 0);
    assert.equal(navigator.selectedStop.id, 'trip-berlin');
    assert.equal(navigator.select('trip-madrid').id, 'trip-madrid');
    assert.equal(navigator.selectedIndex, 2);
    assert.equal(navigator.next().id, 'trip-lisbon');
    assert.equal(navigator.next().id, 'trip-berlin');
    assert.equal(navigator.previous().id, 'trip-lisbon');
    assert.equal(navigator.selectedStop.id, 'trip-lisbon');
});

behaviorTest('mountTravelGlobe renders a static COBE scene without scheduling RAF in reduced motion', () => {
    const { mountTravelGlobe } = subject;
    const canvas = fakeElement({ hidden: true });
    const fallbackElement = fakeElement({ hidden: false });
    const animation = animationHarness();
    const resize = resizeHarness();
    let destroyCount = 0;

    const controller = mountTravelGlobe({
        canvas,
        fallbackElement,
        route: minimalRoute(),
        createGlobe: () => ({
            update: () => {},
            destroy: () => { destroyCount += 1; },
        }),
        reducedMotion: true,
        ResizeObserver: resize.ResizeObserver,
        requestAnimationFrame: animation.requestAnimationFrame,
        cancelAnimationFrame: animation.cancelAnimationFrame,
        devicePixelRatio: 2,
    });

    assert.equal(controller.mode, 'webgl');
    assert.equal(canvas.hidden, false);
    assert.equal(canvas.getAttribute('aria-hidden'), 'true');
    assert.equal(fallbackElement.hidden, true);
    assert.equal(animation.requests.length, 0);
    controller.destroy();
    assert.equal(destroyCount, 1);
});

behaviorTest('mountTravelGlobe cleanup cancels RAF, disconnects ResizeObserver and destroys COBE once', () => {
    const { mountTravelGlobe } = subject;
    const canvas = fakeElement();
    const fallbackElement = fakeElement({ hidden: true });
    const animation = animationHarness();
    const resize = resizeHarness();
    let destroyCount = 0;

    const controller = mountTravelGlobe({
        canvas,
        fallbackElement,
        route: minimalRoute(),
        createGlobe: () => ({
            update: () => {},
            destroy: () => { destroyCount += 1; },
        }),
        reducedMotion: false,
        ResizeObserver: resize.ResizeObserver,
        requestAnimationFrame: animation.requestAnimationFrame,
        cancelAnimationFrame: animation.cancelAnimationFrame,
        devicePixelRatio: 2,
    });

    assert.equal(animation.requests.length, 1);
    assert.equal(resize.instances.length, 1);
    assert.deepEqual(resize.instances[0].observed, [canvas]);

    animation.requests[0].callback(1000);
    assert.equal(animation.requests.length, 2);
    const staleFrame = animation.requests[1].callback;

    controller.destroy();
    controller.destroy();

    assert.deepEqual(animation.cancellations, [42]);
    assert.equal(resize.instances[0].disconnectCount, 1);
    assert.equal(destroyCount, 1);

    staleFrame(2000);
    assert.equal(animation.requests.length, 2);
});

behaviorTest('mountTravelGlobe exposes the accessible fallback when createGlobe does not produce WebGL', () => {
    const { mountTravelGlobe } = subject;
    const canvas = fakeElement();
    const fallbackElement = fakeElement({ hidden: true });
    const animation = animationHarness();
    const resize = resizeHarness();

    const controller = mountTravelGlobe({
        canvas,
        fallbackElement,
        route: minimalRoute(),
        createGlobe: () => null,
        reducedMotion: false,
        ResizeObserver: resize.ResizeObserver,
        requestAnimationFrame: animation.requestAnimationFrame,
        cancelAnimationFrame: animation.cancelAnimationFrame,
        devicePixelRatio: 2,
    });

    assert.equal(controller.mode, 'fallback');
    assert.equal(canvas.hidden, true);
    assert.equal(fallbackElement.hidden, false);
    assert.equal(
        fallbackElement.textContent,
        'El globo interactivo no está disponible. Podés consultar las paradas en la agenda.'
    );
    assert.equal(animation.requests.length, 0);
    controller.destroy();
});

behaviorTest('mountTravelGlobe keeps the fallback when COBE returns a no-op for a failed target context', () => {
    const { mountTravelGlobe } = subject;
    const canvas = fakeElement({ getContext: () => null });
    const fallbackElement = fakeElement({ hidden: true });
    let destroyCount = 0;

    const controller = mountTravelGlobe({
        canvas,
        fallbackElement,
        route: minimalRoute(),
        createGlobe: () => ({
            update: () => {},
            destroy: () => { destroyCount += 1; },
        }),
        reducedMotion: true,
    });

    assert.equal(controller.mode, 'fallback');
    assert.equal(canvas.hidden, true);
    assert.equal(fallbackElement.hidden, false);
    assert.equal(destroyCount, 1);
    controller.destroy();
});

behaviorTest('projectTravelLocation keeps elevated COBE markers interactive at the globe limb', () => {
    const { projectTravelLocation } = subject;
    const projected = projectTravelLocation([0, 20], {
        phi: 0,
        theta: 0,
        width: 100,
        height: 100,
        scale: 1,
        offset: [0, 0],
    });

    assert.ok(projected.depth < 0, 'fixture must be just behind the globe surface');
    assert.equal(projected.frontFacing, false);
    assert.equal(projected.visible, true);
});

behaviorTest('mountTravelGlobe sends COBE 2 marker and arc shapes with explicit colors', () => {
    const { mountTravelGlobe } = subject;
    const canvas = fakeElement();
    const fallbackElement = fakeElement({ hidden: false });
    const resize = resizeHarness();
    let received = null;

    const controller = mountTravelGlobe({
        canvas,
        fallbackElement,
        route: minimalRoute(),
        createGlobe: (_canvas, options) => {
            received = options;
            return { update: () => {}, destroy: () => {} };
        },
        reducedMotion: true,
        ResizeObserver: resize.ResizeObserver,
        devicePixelRatio: 2,
    });

    assert.deepEqual(received.markers.map((marker) => Object.keys(marker).sort()), [
        ['color', 'location', 'size'],
        ['color', 'location', 'size'],
    ]);
    assert.deepEqual(received.arcs.map((arc) => Object.keys(arc).sort()), [
        ['color', 'from', 'to'],
    ]);
    assert.deepEqual(received.arcs[0].from, [-34.6037, -58.3816]);
    assert.deepEqual(received.arcs[0].to, [-12.0464, -77.0428]);
    controller.destroy();
});
