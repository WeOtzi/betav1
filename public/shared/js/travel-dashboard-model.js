/**
 * Reusable, framework-free state for Travel's upcoming-destination summary.
 *
 * The browser exposes `window.TravelDashboardModel`; focused Node tests can
 * require the same implementation without a DOM.
 */
(function exposeTravelDashboardModel(root, factory) {
    'use strict';

    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.TravelDashboardModel = Object.assign(root.TravelDashboardModel || {}, api);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTravelDashboardModelApi() {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;
    const UPCOMING_STATUSES = new Set([
        'planificado', 'planificada', 'planned',
        'pendiente', 'pending',
        'confirmado', 'confirmada', 'confirmed',
    ]);
    const CONFIRMED_LINK_STATUSES = new Set([
        'confirmada', 'confirmado', 'confirmed', 'accepted', 'aceptada', 'aceptado',
    ]);

    function normalized(value) {
        return String(value == null ? '' : value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    // Date-only database values should remain calendar dates regardless of the
    // browser timezone. Converting their components through UTC gives us a
    // stable ordinal that is also safe across daylight-saving transitions.
    function dayOrdinal(value) {
        if (value == null || value === '') return null;

        if (value instanceof Date) {
            if (!Number.isFinite(value.getTime())) return null;
            return Math.floor(Date.UTC(
                value.getFullYear(),
                value.getMonth(),
                value.getDate()
            ) / DAY_MS);
        }

        const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const stamp = Date.UTC(year, month - 1, day);
        const parsed = new Date(stamp);
        if (
            parsed.getUTCFullYear() !== year
            || parsed.getUTCMonth() !== month - 1
            || parsed.getUTCDate() !== day
        ) return null;
        return Math.floor(stamp / DAY_MS);
    }

    function buildUpcomingDestinations(trips, { today = new Date() } = {}) {
        const todayDay = dayOrdinal(today);
        if (todayDay == null) return [];

        return (Array.isArray(trips) ? trips : [])
            .filter(function (trip) {
                if (!trip || !UPCOMING_STATUSES.has(normalized(trip.status))) return false;
                const startDay = dayOrdinal(trip.start_date);
                const endDay = dayOrdinal(trip.end_date) ?? startDay;
                return startDay != null && endDay != null && endDay >= startDay && endDay >= todayDay;
            })
            .slice()
            .sort(function (left, right) {
                const leftStart = dayOrdinal(left.start_date);
                const rightStart = dayOrdinal(right.start_date);
                const leftEnd = dayOrdinal(left.end_date) ?? leftStart;
                const rightEnd = dayOrdinal(right.end_date) ?? rightStart;
                const leftOngoing = leftStart <= todayDay && leftEnd >= todayDay;
                const rightOngoing = rightStart <= todayDay && rightEnd >= todayDay;

                if (leftOngoing !== rightOngoing) return leftOngoing ? -1 : 1;
                if (leftStart !== rightStart) return leftStart - rightStart;
                if (leftEnd !== rightEnd) return leftEnd - rightEnd;
                return String(left.id || '').localeCompare(String(right.id || ''));
            });
    }

    function createDestinationNavigator(destinations, initialDestinationId) {
        const rows = Array.isArray(destinations) ? destinations.slice() : [];
        let index = initialDestinationId == null
            ? 0
            : rows.findIndex(function (row) { return String(row && row.id) === String(initialDestinationId); });
        if (index < 0) index = 0;

        return {
            get selected() {
                return rows[index] || null;
            },
            get selectedIndex() {
                return rows.length ? index : -1;
            },
            get canPrevious() {
                return rows.length > 0 && index > 0;
            },
            get canNext() {
                return rows.length > 0 && index < rows.length - 1;
            },
            previous() {
                if (!(rows.length > 0 && index > 0)) return null;
                index -= 1;
                return rows[index];
            },
            next() {
                if (!(rows.length > 0 && index < rows.length - 1)) return null;
                index += 1;
                return rows[index];
            },
            select(destinationId) {
                const nextIndex = rows.findIndex(function (row) {
                    return String(row && row.id) === String(destinationId);
                });
                if (nextIndex < 0) return null;
                index = nextIndex;
                return rows[index];
            },
        };
    }

    function finitePersistedNumber(value) {
        if (value == null || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function confirmedStudioCount(links) {
        if (!Array.isArray(links)) return null;
        const identities = new Set();
        let anonymousCount = 0;

        links.forEach(function (link) {
            if (!link || !CONFIRMED_LINK_STATUSES.has(normalized(link.status))) return;
            const identity = link.studio_id || link.id || link.studio_name;
            if (identity == null || identity === '') anonymousCount += 1;
            else identities.add(String(identity));
        });

        return identities.size + anonymousCount;
    }

    function buildDestinationMetrics(trip, { today = new Date() } = {}) {
        const row = trip || {};
        const todayDay = dayOrdinal(today);
        const startDay = dayOrdinal(row.start_date);
        const endDay = dayOrdinal(row.end_date);

        return {
            daysRemaining: todayDay == null || startDay == null
                ? null
                : Math.max(0, startDay - todayDay),
            stayDays: startDay == null || endDay == null
                ? null
                : Math.max(0, endDay - startDay),
            interestedPeople: finitePersistedNumber(row.interested_people_count),
            climateCelsius: finitePersistedNumber(row.climate_celsius),
            confirmedStudioCount: confirmedStudioCount(row.trip_studio_links),
        };
    }

    function destinationCoordinateKey(value) {
        const row = value || {};
        const city = normalized(row.city);
        const country = normalized(row.country);
        return city && country ? `${city}|${country}` : '';
    }

    function buildMissingDestinationQueries(trips, cityCoordinates, options) {
        const known = new Set((Array.isArray(cityCoordinates) ? cityCoordinates : [])
            .filter(function (row) {
                const latitude = Number(row && (row.latitude ?? row.lat));
                const longitude = Number(row && (row.longitude ?? row.lng));
                return destinationCoordinateKey(row)
                    && Number.isFinite(latitude)
                    && Number.isFinite(longitude)
                    && !(latitude === 0 && longitude === 0);
            })
            .map(destinationCoordinateKey));
        const queued = new Set();

        return buildUpcomingDestinations(trips, options).reduce(function (queries, trip) {
            const key = destinationCoordinateKey(trip);
            if (!key || known.has(key) || queued.has(key)) return queries;
            queued.add(key);
            queries.push({
                key,
                city: String(trip.city).trim(),
                country: String(trip.country).trim(),
                query: `${String(trip.city).trim()}, ${String(trip.country).trim()}`,
            });
            return queries;
        }, []);
    }

    function canonicalTravelPath(tripId) {
        if (tripId == null || String(tripId).trim() === '') return '/artist/travel/';
        return `/artist/travel/?trip=${encodeURIComponent(String(tripId))}`;
    }

    return {
        buildUpcomingDestinations,
        createDestinationNavigator,
        buildDestinationMetrics,
        buildMissingDestinationQueries,
        canonicalTravelPath,
    };
}));
