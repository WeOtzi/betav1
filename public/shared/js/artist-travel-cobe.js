/**
 * Travel COBE runtime.
 *
 * This file deliberately has no import statements. The Travel page loads the
 * vendored COBE ESM bundle and injects `createGlobe`, while Node can require
 * this module directly for focused route/lifecycle tests.
 */
(function exposeTravelCobe(root, factory) {
    'use strict';

    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ArtistTravelCobe = Object.assign(root.ArtistTravelCobe || {}, api);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTravelCobeApi() {
    'use strict';

    const FALLBACK_MESSAGE = 'El globo interactivo no está disponible. Podés consultar las paradas en la agenda.';
    const CANCELLED_TRIP_STATUSES = new Set(['cancelado', 'cancelled', 'canceled']);
    const INACTIVE_LINK_STATUSES = new Set(['rechazada', 'cancelada', 'rejected', 'cancelled', 'canceled']);
    const DEG = Math.PI / 180;

    // A small, explicit catalogue keeps the POC useful with the existing demo
    // graph. Supabase studio coordinates still win whenever they are present.
    const DEFAULT_CITY_COORDINATES = Object.freeze([
        { city: 'Buenos Aires', country: 'Argentina', latitude: -34.6037, longitude: -58.3816 },
        { city: 'Barcelona', country: 'España', latitude: 41.3874, longitude: 2.1686 },
        { city: 'Berlín', country: 'Alemania', latitude: 52.52, longitude: 13.405 },
        { city: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 },
        { city: 'Ciudad de México', country: 'México', latitude: 19.4326, longitude: -99.1332 },
        { city: 'Mexico City', country: 'Mexico', latitude: 19.4326, longitude: -99.1332 },
        { city: 'Lima', country: 'Perú', latitude: -12.0464, longitude: -77.0428 },
        { city: 'Lisboa', country: 'Portugal', latitude: 38.7223, longitude: -9.1393 },
        { city: 'Madrid', country: 'España', latitude: 40.4168, longitude: -3.7038 },
        { city: 'Montevideo', country: 'Uruguay', latitude: -34.9011, longitude: -56.1645 },
        { city: 'Santiago', country: 'Chile', latitude: -33.4489, longitude: -70.6693 },
    ]);

    function finiteNumber(value) {
        if (value === '' || value == null) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function validLocation(latitude, longitude) {
        const lat = finiteNumber(latitude);
        const lng = finiteNumber(longitude);
        if (lat == null || lng == null) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return [lat, lng];
    }

    function locationFrom(value) {
        if (!value) return null;
        if (Array.isArray(value)) return validLocation(value[0], value[1]);
        return validLocation(
            value.latitude ?? value.lat,
            value.longitude ?? value.lng ?? value.lon
        );
    }

    function keyPart(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    function placeKey(city, country) {
        return `${keyPart(city)}|${keyPart(country)}`;
    }

    function indexById(source, idFields) {
        const result = new Map();
        if (source instanceof Map) {
            source.forEach((value, key) => result.set(String(key), value));
            return result;
        }
        if (!Array.isArray(source)) return result;
        source.forEach((item) => {
            const field = idFields.find((candidate) => item && item[candidate] != null);
            if (field) result.set(String(item[field]), item);
        });
        return result;
    }

    function buildCityIndex(cityCoordinates) {
        const rows = Array.isArray(cityCoordinates) && cityCoordinates.length
            ? cityCoordinates
            : DEFAULT_CITY_COORDINATES;
        const result = new Map();
        const cityOnly = new Map();
        const duplicateCities = new Set();
        rows.forEach((row) => {
            const location = locationFrom(row);
            if (!location) return;
            const key = placeKey(row.city, row.country);
            if (key !== '|') result.set(key, location);
            const cityKey = keyPart(row.city);
            if (!cityKey) return;
            if (cityOnly.has(cityKey)) duplicateCities.add(cityKey);
            else cityOnly.set(cityKey, location);
        });
        cityOnly.forEach((location, cityKey) => {
            if (!duplicateCities.has(cityKey)) result.set(`${cityKey}|`, location);
        });
        return result;
    }

    function activeLinks(trip) {
        const links = Array.isArray(trip && trip.trip_studio_links)
            ? trip.trip_studio_links
            : [];
        return links
            .map((link, index) => ({ link, index }))
            .filter(({ link }) => !INACTIVE_LINK_STATUSES.has(keyPart(link && link.status)))
            .sort((left, right) => {
                const leftConfirmed = keyPart(left.link.status) === 'confirmada' ? 0 : 1;
                const rightConfirmed = keyPart(right.link.status) === 'confirmada' ? 0 : 1;
                return leftConfirmed - rightConfirmed || left.index - right.index;
            })
            .map(({ link }) => link);
    }

    function resolveStudioContext(trip, studiosById, studioLocationsById) {
        const links = activeLinks(trip);
        const link = links[0] || null;
        const studioId = link && link.studio_id != null ? String(link.studio_id) : null;
        const studio = studioId ? studiosById.get(studioId) || null : null;
        const primaryLocation = studioId ? studioLocationsById.get(studioId) || null : null;

        const coordinateCandidates = [
            primaryLocation,
            studio,
            link,
        ];
        let studioLocation = null;
        for (const candidate of coordinateCandidates) {
            studioLocation = locationFrom(candidate);
            if (studioLocation) break;
        }

        return {
            link,
            studio,
            primaryLocation,
            location: studioLocation,
            name: (link && link.studio_name)
                || (studio && studio.name)
                || trip.studio_name_hint
                || trip.event_name
                || 'Estudio por confirmar',
            address: (link && link.address_snapshot)
                || (primaryLocation && (primaryLocation.formatted_address || primaryLocation.address))
                || (studio && (studio.formatted_address || studio.address))
                || trip.formatted_address
                || [trip.city, trip.country].filter(Boolean).join(', '),
        };
    }

    function resolveBase(input, cityIndex) {
        const artist = input.artist || {};
        const providedBase = input.base || input.artistBase || {};
        const city = providedBase.city || artist.city || '';
        const country = providedBase.country || artist.country || '';
        const location = locationFrom(providedBase.location)
            || locationFrom(providedBase)
            || locationFrom(artist.location)
            || locationFrom(artist)
            || cityIndex.get(placeKey(city, country))
            || null;

        if (!location) return null;
        return {
            id: 'artist-base',
            city,
            country,
            label: providedBase.label || `Tu base · ${city || country || 'origen'}`,
            location,
        };
    }

    /**
     * Converts Supabase-shaped trips into a deterministic route for COBE.
     * Invalid/cancelled records are disclosed separately instead of being
     * plotted at invented coordinates.
     */
    function buildTravelRoute(input) {
        const source = input || {};
        const trips = Array.isArray(source.trips) ? source.trips : [];
        const studiosById = indexById(source.studios, ['id', 'studio_id']);
        const studioLocationsById = indexById(
            source.studioLocations || source.studio_locations,
            ['studio_id', 'id']
        );
        const cityIndex = buildCityIndex(source.cityCoordinates);
        const base = resolveBase(source, cityIndex);
        const excludedTrips = [];
        const unresolvedTrips = [];

        const stops = trips
            .map((trip, sourceIndex) => ({ trip, sourceIndex }))
            .filter(({ trip }) => {
                const cancelled = !trip
                    || CANCELLED_TRIP_STATUSES.has(keyPart(trip.status))
                    || Boolean(trip.cancelled_at);
                if (cancelled && trip) excludedTrips.push(trip);
                return !cancelled;
            })
            .map(({ trip, sourceIndex }) => {
                const studioContext = resolveStudioContext(trip, studiosById, studioLocationsById);
                const cityLocation = cityIndex.get(placeKey(trip.city, trip.country)) || null;
                const location = studioContext.location || cityLocation;
                if (!location) {
                    unresolvedTrips.push(trip);
                    return null;
                }

                return {
                    id: String(trip.id),
                    city: trip.city || '',
                    country: trip.country || '',
                    startDate: trip.start_date || '',
                    endDate: trip.end_date || trip.start_date || '',
                    status: trip.status || 'planificado',
                    studioId: studioContext.link && studioContext.link.studio_id
                        ? String(studioContext.link.studio_id)
                        : null,
                    studioName: studioContext.name,
                    address: studioContext.address,
                    summary: trip.personal_notes
                        || trip.agreed_conditions
                        || trip.event_name
                        || 'Consultá la agenda para ver el detalle de esta parada.',
                    location,
                    coordinateSource: studioContext.location ? 'studio' : 'city',
                    trip,
                    sourceIndex,
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const leftDate = String(left.startDate || '9999-12-31');
                const rightDate = String(right.startDate || '9999-12-31');
                return leftDate.localeCompare(rightDate)
                    || left.sourceIndex - right.sourceIndex;
            })
            .map(({ sourceIndex, ...stop }) => stop);

        const markers = [];
        if (base) {
            markers.push({ id: base.id, location: base.location.slice(), size: 0.055, kind: 'base' });
        }
        stops.forEach((stop) => {
            markers.push({
                id: stop.id,
                location: stop.location.slice(),
                size: 0.07,
                kind: 'stop',
                status: stop.status,
            });
        });

        const arcs = [];
        let previous = base
            ? { id: null, location: base.location }
            : null;
        stops.forEach((stop) => {
            if (previous) {
                const from = previous.location.slice();
                const to = stop.location.slice();
                arcs.push({
                    id: `${previous.id || 'artist-base'}--${stop.id}`,
                    from,
                    to,
                    start: from.slice(),
                    end: to.slice(),
                    fromStopId: previous.id,
                    toStopId: stop.id,
                    status: stop.status,
                });
            }
            previous = { id: stop.id, location: stop.location };
        });

        return {
            base,
            stops,
            markers,
            arcs,
            excludedTrips,
            unresolvedTrips,
            unresolvedCount: unresolvedTrips.length,
        };
    }

    function createTravelRouteNavigator(stops, initialStopId) {
        const items = Array.isArray(stops) ? stops.slice() : [];
        let index = items.length ? 0 : -1;

        if (initialStopId != null) {
            const initialIndex = items.findIndex((item) => String(item.id) === String(initialStopId));
            if (initialIndex >= 0) index = initialIndex;
        }

        return {
            get selectedIndex() {
                return index;
            },
            get selectedStop() {
                return index >= 0 ? items[index] : null;
            },
            select(id) {
                const nextIndex = items.findIndex((item) => String(item.id) === String(id));
                if (nextIndex >= 0) index = nextIndex;
                return index >= 0 ? items[index] : null;
            },
            next() {
                if (!items.length) return null;
                index = (index + 1) % items.length;
                return items[index];
            },
            previous() {
                if (!items.length) return null;
                index = (index - 1 + items.length) % items.length;
                return items[index];
            },
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function latLngToXYZ(location, radius) {
        const lat = location[0] * DEG;
        const lng = location[1] * DEG - Math.PI;
        const cosLat = Math.cos(lat);
        const scale = radius == null ? 1 : radius;
        return [
            -cosLat * Math.cos(lng) * scale,
            Math.sin(lat) * scale,
            cosLat * Math.sin(lng) * scale,
        ];
    }

    function normalizeVector(vector, radius) {
        const length = Math.hypot(vector[0], vector[1], vector[2]);
        if (length < 0.001) return [0, radius, 0];
        return vector.map((component) => component / length * radius);
    }

    /** Samples the same lifted quadratic curve used by COBE arcs. */
    function sampleTravelArc(from, to, progress, options) {
        const config = options || {};
        const t = clamp(finiteNumber(progress) ?? 0, 0, 1);
        const surfaceRadius = finiteNumber(config.surfaceRadius) ?? 0.86;
        const apexRadius = finiteNumber(config.apexRadius) ?? 1.16;
        const start = latLngToXYZ(from, surfaceRadius);
        const end = latLngToXYZ(to, surfaceRadius);
        const control = normalizeVector([
            start[0] + end[0],
            start[1] + end[1],
            start[2] + end[2],
        ], apexRadius);
        const remaining = 1 - t;

        return {
            progress: t,
            xyz: [
                remaining * remaining * start[0] + 2 * remaining * t * control[0] + t * t * end[0],
                remaining * remaining * start[1] + 2 * remaining * t * control[1] + t * t * end[1],
                remaining * remaining * start[2] + 2 * remaining * t * control[2] + t * t * end[2],
            ],
        };
    }

    function projectXYZ(xyz, state) {
        const phi = finiteNumber(state.phi) ?? 0;
        const theta = finiteNumber(state.theta) ?? 0;
        const width = Math.max(1, finiteNumber(state.width) ?? 1);
        const height = Math.max(1, finiteNumber(state.height) ?? width);
        const scale = finiteNumber(state.scale) ?? 1;
        const offset = Array.isArray(state.offset) ? state.offset : [0, 0];
        const tx = xyz[0];
        const ty = xyz[1];
        const tz = xyz[2];
        const cosTheta = Math.cos(theta);
        const cosPhi = Math.cos(phi);
        const sinTheta = Math.sin(theta);
        const sinPhi = Math.sin(phi);
        const projectedX = cosPhi * tx + sinPhi * tz;
        const projectedY = sinPhi * sinTheta * tx + cosTheta * ty - cosPhi * sinTheta * tz;
        const depth = -sinPhi * cosTheta * tx + sinTheta * ty + cosPhi * cosTheta * tz;
        const ndcX = projectedX / (width / height) * scale + (finiteNumber(offset[0]) ?? 0) * scale / width;
        const ndcY = -projectedY * scale + (finiteNumber(offset[1]) ?? 0) * scale / height;

        const frontFacing = depth >= 0;
        return {
            x: (ndcX + 1) * 0.5 * width,
            y: (ndcY + 1) * 0.5 * height,
            // COBE keeps elevated markers visible at the globe limb even when
            // their surface point has just crossed behind the camera plane.
            visible: frontFacing || projectedX * projectedX + projectedY * projectedY >= 0.64,
            frontFacing,
            depth,
        };
    }

    /** Projects a [latitude, longitude] point into CSS pixels. */
    function projectTravelLocation(location, state) {
        return projectXYZ(latLngToXYZ(location, finiteNumber(state && state.radius) ?? 0.86), state || {});
    }

    function cobePayload(route) {
        const safeRoute = route || { markers: [], arcs: [] };
        const colorForStatus = (status, fallback) => {
            const normalized = keyPart(status);
            if (normalized === 'confirmado') return [0.12, 0.32, 0.78];
            if (normalized === 'finalizado') return [0.63, 0.61, 0.56];
            if (normalized === 'pendiente' || normalized === 'planificado') return [1.0, 0.73, 0.08];
            return fallback;
        };
        return {
            markers: (safeRoute.markers || []).map((marker) => ({
                location: marker.location.slice(),
                size: finiteNumber(marker.size) ?? 0.07,
                color: marker.kind === 'base'
                    ? [1.0, 1.0, 1.0]
                    : colorForStatus(marker.status, [1.0, 0.73, 0.08]),
            })),
            arcs: (safeRoute.arcs || []).map((arc) => ({
                from: (arc.from || arc.start).slice(),
                to: (arc.to || arc.end).slice(),
                color: colorForStatus(arc.status, [1.0, 0.73, 0.08]),
            })),
        };
    }

    function setFallbackState(canvas, fallbackElement, enabled) {
        canvas.hidden = Boolean(enabled);
        // El canvas es puramente visual: los puntos y el detalle accesibles
        // viven en el DOM que monta Travel.
        canvas.setAttribute('aria-hidden', 'true');
        if (!fallbackElement) return;
        fallbackElement.hidden = !enabled;
        if (enabled) {
            fallbackElement.textContent = FALLBACK_MESSAGE;
            fallbackElement.setAttribute('role', 'status');
            fallbackElement.setAttribute('aria-live', 'polite');
        } else {
            fallbackElement.setAttribute('aria-hidden', 'true');
        }
    }

    function mountTravelGlobe(options) {
        const config = options || {};
        const canvas = config.canvas;
        const fallbackElement = config.fallbackElement || null;
        const createGlobe = config.createGlobe;
        if (!canvas || typeof createGlobe !== 'function') {
            throw new TypeError('mountTravelGlobe requires a canvas and createGlobe function');
        }

        const requestFrame = config.requestAnimationFrame
            || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : null);
        const cancelFrame = config.cancelAnimationFrame
            || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : null);
        const ResizeObserverClass = config.ResizeObserver
            || (typeof ResizeObserver === 'function' ? ResizeObserver : null);
        const IntersectionObserverClass = config.IntersectionObserver
            || (typeof IntersectionObserver === 'function' ? IntersectionObserver : null);
        const documentTarget = config.document
            || (typeof document !== 'undefined' ? document : null);
        const reducedMotion = Boolean(config.reducedMotion);
        const initialPhi = finiteNumber(config.phi) ?? 0;
        const initialTheta = finiteNumber(config.theta) ?? -0.18;
        const initialScale = finiteNumber(config.scale) ?? 1;
        const initialOffset = Array.isArray(config.offset) ? config.offset.slice(0, 2) : [0, 0];
        const initialRoute = config.route || { markers: [], arcs: [], stops: [] };

        let route = initialRoute;
        let navigator = createTravelRouteNavigator(initialRoute.stops || [], config.selectedStopId);
        let mode = 'initializing';
        let globe = null;
        let globeDestroyed = false;
        let destroyed = false;
        let rafId = null;
        let resizeObserver = null;
        let intersectionObserver = null;
        let width = 1;
        let height = 1;
        let phi = initialPhi;
        let theta = initialTheta;
        let scale = initialScale;
        let offset = initialOffset;
        let pendingResize = false;
        let lastFrameAt = null;
        let planeElapsedMs = 0;
        let planeState = null;
        let manualPaused = false;
        let hiddenPaused = false;
        let offscreenPaused = false;
        let pointerDown = false;
        let pointerX = 0;
        let pointerY = 0;
        const removers = [];

        function isPaused() {
            return manualPaused || hiddenPaused || offscreenPaused;
        }

        function measure() {
            const rect = typeof canvas.getBoundingClientRect === 'function'
                ? canvas.getBoundingClientRect()
                : null;
            const measuredWidth = rect && finiteNumber(rect.width);
            const measuredHeight = rect && finiteNumber(rect.height);
            width = Math.max(1, Math.round(measuredWidth || finiteNumber(canvas.clientWidth) || finiteNumber(canvas.width) || 1));
            height = Math.max(1, Math.round(measuredHeight || finiteNumber(canvas.clientHeight) || finiteNumber(canvas.height) || width));
        }

        function renderState() {
            return {
                mode,
                phi,
                theta,
                scale,
                offset: offset.slice(),
                width,
                height,
                plane: planeState,
                selectedStopId: navigator.selectedStop ? navigator.selectedStop.id : null,
                selectedStop: navigator.selectedStop,
                paused: isPaused(),
                reducedMotion,
                route,
            };
        }

        function notifyRender() {
            const state = renderState();
            if (typeof config.onRender === 'function') config.onRender(state);
            if (typeof config.onFrame === 'function' && config.onFrame !== config.onRender) {
                config.onFrame(state);
            }
        }

        function globeUpdate(extra) {
            if (!globe || typeof globe.update !== 'function' || destroyed) return;
            const payload = Object.assign({ phi, theta, scale, offset }, extra || {});
            globe.update(payload);
        }

        function currentPlaneState() {
            const arcs = route && Array.isArray(route.arcs) ? route.arcs : [];
            if (!arcs.length || reducedMotion) return null;
            const flightMs = Math.max(600, finiteNumber(config.flightDurationMs) ?? 3600);
            const dwellMs = Math.max(0, finiteNumber(config.stopDwellMs) ?? 450);
            const legMs = flightMs + dwellMs;
            const arcIndex = Math.floor(planeElapsedMs / legMs) % arcs.length;
            const localTime = planeElapsedMs % legMs;
            const progress = clamp(localTime / flightMs, 0, 1);
            const easedProgress = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const arc = arcs[arcIndex];
            const sample = sampleTravelArc(arc.from || arc.start, arc.to || arc.end, easedProgress, {
                surfaceRadius: 0.86,
                apexRadius: 1.22,
            });
            const position = projectXYZ(sample.xyz, { phi, theta, width, height, scale, offset });
            const aheadSample = sampleTravelArc(
                arc.from || arc.start,
                arc.to || arc.end,
                Math.min(1, easedProgress + 0.015),
                { surfaceRadius: 0.86, apexRadius: 1.22 }
            );
            const ahead = projectXYZ(aheadSample.xyz, { phi, theta, width, height, scale, offset });
            const heading = Math.atan2(ahead.y - position.y, ahead.x - position.x) * 180 / Math.PI + 90;
            return {
                arcIndex,
                progress,
                easedProgress,
                fromStopId: arc.fromStopId ?? null,
                toStopId: arc.toStopId ?? null,
                position,
                heading,
            };
        }

        function drawStaticFrame() {
            globeUpdate(pendingResize ? { width, height } : null);
            pendingResize = false;
            planeState = null;
            notifyRender();
        }

        function scheduleFrame() {
            if (destroyed || reducedMotion || mode !== 'webgl' || isPaused() || rafId != null || !requestFrame) return;
            rafId = requestFrame(frame);
        }

        function frame(timestamp) {
            rafId = null;
            if (destroyed || mode !== 'webgl' || isPaused()) return;
            const now = finiteNumber(timestamp) ?? 0;
            const elapsed = lastFrameAt == null ? 16.67 : clamp(now - lastFrameAt, 0, 64);
            lastFrameAt = now;
            phi += (finiteNumber(config.rotationSpeed) ?? 0.0018) * (elapsed / 16.67);
            planeElapsedMs += elapsed;
            planeState = currentPlaneState();
            const update = { phi, theta, scale, offset };
            if (pendingResize) {
                // Width and height are CSS pixels. COBE applies DPR itself.
                update.width = width;
                update.height = height;
                pendingResize = false;
            }
            globeUpdate(update);
            notifyRender();
            scheduleFrame();
        }

        function cancelPendingFrame() {
            if (rafId == null) return;
            if (cancelFrame) cancelFrame(rafId);
            rafId = null;
        }

        function pauseFor(reason, enabled) {
            if (destroyed) return;
            if (reason === 'manual') manualPaused = enabled;
            if (reason === 'hidden') hiddenPaused = enabled;
            if (reason === 'offscreen') offscreenPaused = enabled;
            if (isPaused()) {
                cancelPendingFrame();
                lastFrameAt = null;
            } else {
                scheduleFrame();
            }
            notifyRender();
        }

        function addListener(target, name, listener, listenerOptions) {
            if (!target || typeof target.addEventListener !== 'function') return;
            target.addEventListener(name, listener, listenerOptions);
            removers.push(() => target.removeEventListener(name, listener, listenerOptions));
        }

        function activateFallback(error) {
            if (mode === 'fallback') return;
            mode = 'fallback';
            cancelPendingFrame();
            setFallbackState(canvas, fallbackElement, true);
            if (typeof config.onModeChange === 'function') config.onModeChange(mode, error || null);
        }

        function destroyGlobeOnce() {
            if (!globe || globeDestroyed) return;
            globeDestroyed = true;
            if (typeof globe.destroy === 'function') globe.destroy();
            globe = null;
        }

        function targetContextIsUsable() {
            let context = null;
            try {
                context = canvas.getContext('webgl2') || canvas.getContext('webgl');
            } catch (error) {
                return false;
            }
            if (!context) return false;
            if (typeof context.isContextLost === 'function' && context.isContextLost()) return false;

            // COBE returns the same no-op shape when its principal shader fails.
            // A successfully initialized scene leaves a current program bound
            // after its synchronous first update. Lightweight test doubles do
            // not expose this API, so context presence remains their contract.
            if (typeof context.getParameter === 'function' && context.CURRENT_PROGRAM != null) {
                try {
                    return Boolean(context.getParameter(context.CURRENT_PROGRAM));
                } catch (error) {
                    return false;
                }
            }
            return true;
        }

        measure();
        const pixelRatio = clamp(finiteNumber(config.devicePixelRatio) ?? 1, 1, 3);
        const data = cobePayload(route);

        try {
            globe = createGlobe(canvas, {
                devicePixelRatio: pixelRatio,
                width,
                height,
                phi,
                theta,
                dark: 1,
                diffuse: finiteNumber(config.diffuse) ?? 2.2,
                mapSamples: 16000,
                mapBrightness: finiteNumber(config.mapBrightness) ?? 5.5,
                mapBaseBrightness: 0,
                baseColor: config.baseColor || [0.30, 0.29, 0.27],
                markerColor: config.markerColor || [1.0, 0.73, 0.16],
                glowColor: config.glowColor || [0.25, 0.18, 0.12],
                arcColor: config.arcColor || [0.08, 0.12, 0.22],
                arcWidth: finiteNumber(config.arcWidth) ?? 1.6,
                arcHeight: finiteNumber(config.arcHeight) ?? 0.36,
                markerElevation: finiteNumber(config.markerElevation) ?? 0.06,
                opacity: 1,
                scale,
                offset,
                markers: data.markers,
                arcs: data.arcs,
            });
        } catch (error) {
            activateFallback(error);
        }

        if (!globe || typeof globe.update !== 'function' || !targetContextIsUsable()) {
            destroyGlobeOnce();
            activateFallback(new Error('COBE could not initialize the target WebGL canvas'));
        } else {
            mode = 'webgl';
            setFallbackState(canvas, fallbackElement, false);
            if (typeof config.onModeChange === 'function') config.onModeChange(mode, null);

            addListener(canvas, 'webglcontextlost', (event) => {
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
                destroyGlobeOnce();
                activateFallback(new Error('WebGL context lost'));
                if (typeof config.onContextLost === 'function') config.onContextLost();
            });

            addListener(canvas, 'pointerdown', (event) => {
                pointerDown = true;
                pointerX = finiteNumber(event && event.clientX) ?? 0;
                pointerY = finiteNumber(event && event.clientY) ?? 0;
                if (canvas.setPointerCapture && event && event.pointerId != null) {
                    canvas.setPointerCapture(event.pointerId);
                }
            });
            addListener(canvas, 'pointermove', (event) => {
                if (!pointerDown) return;
                const nextX = finiteNumber(event && event.clientX) ?? pointerX;
                const nextY = finiteNumber(event && event.clientY) ?? pointerY;
                phi += (nextX - pointerX) * 0.005;
                theta = clamp(theta + (nextY - pointerY) * 0.005, -Math.PI / 2.4, Math.PI / 2.4);
                pointerX = nextX;
                pointerY = nextY;
                if (reducedMotion) drawStaticFrame();
            });
            const releasePointer = () => { pointerDown = false; };
            addListener(canvas, 'pointerup', releasePointer);
            addListener(canvas, 'pointercancel', releasePointer);
            addListener(canvas, 'wheel', (event) => {
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
                const delta = finiteNumber(event && event.deltaY) ?? 0;
                scale = clamp(scale - delta * 0.0005, 0.82, 1.22);
                if (reducedMotion) drawStaticFrame();
            }, { passive: false });

            if (ResizeObserverClass) {
                resizeObserver = new ResizeObserverClass(() => {
                    if (destroyed) return;
                    measure();
                    pendingResize = true;
                    if (reducedMotion) drawStaticFrame();
                });
                resizeObserver.observe(canvas);
            }

            if (IntersectionObserverClass) {
                intersectionObserver = new IntersectionObserverClass((entries) => {
                    if (destroyed) return;
                    const entry = entries && entries[0];
                    pauseFor('offscreen', Boolean(entry && !entry.isIntersecting));
                }, { threshold: 0.01 });
                intersectionObserver.observe(canvas);
            }

            if (documentTarget) {
                addListener(documentTarget, 'visibilitychange', () => {
                    pauseFor('hidden', documentTarget.visibilityState === 'hidden' || documentTarget.hidden === true);
                });
            }

            if (reducedMotion || !requestFrame) drawStaticFrame();
            else scheduleFrame();
        }

        return {
            get mode() {
                return mode;
            },
            get selectedStop() {
                return navigator.selectedStop;
            },
            updateRoute(nextRoute) {
                if (!nextRoute || destroyed) return route;
                const selectedId = navigator.selectedStop && navigator.selectedStop.id;
                route = nextRoute;
                navigator = createTravelRouteNavigator(nextRoute.stops || [], selectedId);
                planeElapsedMs = 0;
                const payload = cobePayload(route);
                globeUpdate(payload);
                if (reducedMotion) drawStaticFrame();
                return route;
            },
            pause() {
                pauseFor('manual', true);
            },
            resume() {
                if (destroyed) return;
                pauseFor('manual', false);
            },
            resetView() {
                phi = initialPhi;
                theta = initialTheta;
                scale = initialScale;
                offset = initialOffset.slice();
                planeElapsedMs = 0;
                globeUpdate({ phi, theta, scale, offset });
                notifyRender();
            },
            setSelectedStop(id) {
                const selected = navigator.select(id);
                if (selected) {
                    const arcIndex = Math.max(0, (route.arcs || []).findIndex((arc) => String(arc.toStopId) === String(selected.id)));
                    const legMs = Math.max(600, finiteNumber(config.flightDurationMs) ?? 3600)
                        + Math.max(0, finiteNumber(config.stopDwellMs) ?? 450);
                    planeElapsedMs = arcIndex * legMs;
                }
                notifyRender();
                return selected;
            },
            getState() {
                return renderState();
            },
            getRenderState() {
                return renderState();
            },
            destroy() {
                if (destroyed) return;
                destroyed = true;
                cancelPendingFrame();
                removers.splice(0).forEach((remove) => remove());
                if (resizeObserver) {
                    resizeObserver.disconnect();
                    resizeObserver = null;
                }
                if (intersectionObserver) {
                    intersectionObserver.disconnect();
                    intersectionObserver = null;
                }
                destroyGlobeOnce();
            },
        };
    }

    return {
        DEFAULT_CITY_COORDINATES,
        buildTravelRoute,
        createTravelRouteNavigator,
        mountTravelGlobe,
        projectTravelLocation,
        sampleTravelArc,
    };
}));
