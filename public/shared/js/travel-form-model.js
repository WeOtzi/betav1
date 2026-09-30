/**
 * Selection state for Travel's create form.
 *
 * It keeps the identity returned by Google Places / Supabase separate from the
 * visible input text, so free text cannot accidentally masquerade as a chosen
 * studio or convention venue.
 */
(function exposeTravelFormModel(root, factory) {
    'use strict';

    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.TravelFormModel = Object.assign(root.TravelFormModel || {}, api);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTravelFormModelApi() {
    'use strict';

    function text(value) {
        return String(value == null ? '' : value).trim();
    }

    function comparable(value) {
        return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function isConvention(type) {
        const value = comparable(type);
        return value === 'convencion' || value === 'convention';
    }

    function createTravelFormState(initialState) {
        const initial = initialState || {};
        let type = text(initial.type || 'guest_spot');
        let city = text(initial.city);
        let country = text(initial.country);
        let cityPlaceId = text(initial.cityPlaceId);
        let countryPlaceId = text(initial.countryPlaceId);
        let studio = null;
        let selectedPlace = null;

        function clearStudio() {
            studio = null;
        }

        function clearPlace() {
            selectedPlace = null;
        }

        const state = {
            get type() {
                return type;
            },
            get venueMode() {
                return isConvention(type) ? 'place' : 'studio';
            },
            get location() {
                return { city, country, cityPlaceId, countryPlaceId };
            },
            get selectedStudio() {
                return studio ? Object.assign({}, studio) : null;
            },
            get place() {
                return selectedPlace ? Object.assign({}, selectedPlace) : null;
            },

            setType(nextType) {
                const wasConvention = isConvention(type);
                type = text(nextType);
                const nowConvention = isConvention(type);
                if (nowConvention) clearStudio();
                if (!nowConvention) clearPlace();
                if (wasConvention !== nowConvention) {
                    // The visible venue input changes meaning across modes. Its
                    // prior selection must never remain valid implicitly.
                    if (nowConvention) clearPlace();
                    else clearStudio();
                }
                return state.venueMode;
            },

            selectCity(address) {
                const value = address || {};
                city = text(value.city || value.locality);
                country = text(value.country);
                cityPlaceId = text(value.google_place_id || value.place_id);
                // The country came from the city's structured address, not from
                // a separately selected country suggestion.
                countryPlaceId = '';
                return state.location;
            },

            selectCountry(address) {
                const value = address || {};
                country = text(value.country || value.formatted_address);
                countryPlaceId = text(value.google_place_id || value.place_id);
                return state.location;
            },

            changeCity(value) {
                city = text(value);
                cityPlaceId = '';
                return state.location;
            },

            changeCountry(value) {
                const nextCountry = text(value);
                if (comparable(nextCountry) !== comparable(country)) cityPlaceId = '';
                country = nextCountry;
                countryPlaceId = '';
                return state.location;
            },

            selectStudio(value) {
                if (state.venueMode !== 'studio' || !value || !text(value.id) || !text(value.name)) {
                    clearStudio();
                    return null;
                }
                studio = {
                    id: text(value.id),
                    name: text(value.name),
                    city: text(value.city),
                    country: text(value.country),
                    formattedAddress: text(value.formatted_address || value.formattedAddress),
                };
                clearPlace();
                return state.selectedStudio;
            },

            selectPlace(address, googlePlace) {
                if (state.venueMode !== 'place') {
                    clearPlace();
                    return null;
                }
                const value = address || {};
                const original = googlePlace || {};
                const name = text(original.name || value.name || value.formatted_address);
                const formattedAddress = text(value.formatted_address);
                const googlePlaceId = text(value.google_place_id || original.place_id);

                if (!name || !googlePlaceId) {
                    clearPlace();
                    return null;
                }

                selectedPlace = { name, formattedAddress, googlePlaceId };
                city = text(value.city || value.locality);
                country = text(value.country);
                cityPlaceId = '';
                countryPlaceId = '';
                clearStudio();
                return state.place;
            },

            changeVenue(value) {
                if (state.venueMode === 'place') {
                    if (selectedPlace && comparable(value) !== comparable(selectedPlace.name)) clearPlace();
                    return state.place;
                }
                if (studio && comparable(value) !== comparable(studio.name)) clearStudio();
                return state.selectedStudio;
            },

            validateVenue(value) {
                const visibleValue = text(value);
                if (state.venueMode === 'place') {
                    const valid = Boolean(
                        selectedPlace
                        && visibleValue
                        && comparable(visibleValue) === comparable(selectedPlace.name)
                    );
                    return {
                        valid,
                        mode: 'place',
                        reason: valid ? '' : 'Seleccioná un lugar de Google Maps.',
                    };
                }

                if (!visibleValue) return { valid: true, mode: 'studio', reason: '' };
                const valid = Boolean(studio && comparable(visibleValue) === comparable(studio.name));
                return {
                    valid,
                    mode: 'studio',
                    reason: valid ? '' : 'Seleccioná un estudio existente.',
                };
            },

            reset() {
                type = 'guest_spot';
                city = '';
                country = '';
                cityPlaceId = '';
                countryPlaceId = '';
                clearStudio();
                clearPlace();
                return state;
            },
        };

        return state;
    }

    async function createTravelWithVenue(options) {
        const value = options || {};
        const travel = value.travel;
        if (!travel || typeof travel.create !== 'function') {
            throw new TypeError('Travel.create no está disponible.');
        }

        // Creating the base trip is the only all-or-nothing boundary exposed by
        // the current data contract. Venue enrichment happens afterwards, so a
        // failure there must be reported as a partial success instead of
        // inviting the user to create the same trip again.
        const createdTrip = await travel.create(value.payload || {});
        if (!createdTrip || !text(createdTrip.id)) {
            throw new Error('Travel.create no devolvió un viaje válido.');
        }

        const trip = Object.assign({}, createdTrip);
        const selectedPlace = value.selectedPlace || null;
        const selectedStudio = value.selectedStudio || null;

        if (selectedPlace && text(selectedPlace.name)) {
            try {
                if (typeof travel.update !== 'function') throw new TypeError('Travel.update no está disponible.');
                await travel.update(trip.id, { event_name: text(selectedPlace.name) });
                trip.event_name = text(selectedPlace.name);
            } catch (completionError) {
                return { trip, partial: true, pendingAction: 'place', completionError };
            }
        } else if (selectedStudio && text(selectedStudio.id)) {
            try {
                if (typeof travel.requestStudioLink !== 'function') {
                    throw new TypeError('Travel.requestStudioLink no está disponible.');
                }
                await travel.requestStudioLink({ tripId: trip.id, studioId: text(selectedStudio.id) });
                // request_trip_studio_link transitions the persisted trip to
                // pendiente. Mirror that server-owned transition so the
                // immediate success screen never displays stale state.
                trip.status = 'pendiente';
            } catch (completionError) {
                return { trip, partial: true, pendingAction: 'studio', completionError };
            }
        }

        return { trip, partial: false, pendingAction: null, completionError: null };
    }

    return { createTravelFormState, createTravelWithVenue };
}));
