/**
 * WeOtziGeocoder
 *
 * Cliente compartido de geocoding para We Otzi.
 *
 * Responsabilidades:
 *   - Cargar dinamicamente la JS API de Google Maps (key desde window.CONFIG.googleMaps.apiKey).
 *   - Exponer geocodeQuery(query) con cache localStorage (TTL 30 dias),
 *     rate-limit (>= 280ms entre requests), retries en OVER_QUERY_LIMIT/UNKNOWN_ERROR
 *     y deduplicacion de requests in-flight para la misma query.
 *
 * Uso:
 *   await WeOtziGeocoder.ensureGoogleMapsLoaded();
 *   const point = await WeOtziGeocoder.geocodeQuery('Buenos Aires, Argentina');
 *   // point => { lat, lng, displayName, placeId }  | null si falla
 */
(function (window) {
    'use strict';

    var CACHE_PREFIX = 'weotzi:geocoder:v1:';
    var CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;   // 30 dias
    var MIN_INTERVAL_MS = 280;
    var OVER_QUERY_LIMIT_RETRIES = 3;
    var UNKNOWN_ERROR_RETRIES = 1;

    var googleGeocoder = null;
    var lastRequestAt = 0;
    var inFlight = new Map();
    var googleMapsLoadPromise = null;

    function wait(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function normalizeQuery(query) {
        return String(query || '').trim().replace(/\s+/g, ' ');
    }

    function readCache(query, opts) {
        opts = opts || {};
        try {
            var raw = localStorage.getItem(CACHE_PREFIX + query);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
            if (!opts.allowExpired && (Date.now() - (parsed.cachedAt || 0) > CACHE_TTL_MS)) return null;
            return { lat: parsed.lat, lng: parsed.lng, displayName: parsed.displayName, placeId: parsed.placeId };
        } catch (e) {
            return null;
        }
    }

    function writeCache(query, result) {
        try {
            localStorage.setItem(CACHE_PREFIX + query, JSON.stringify({
                lat: result.lat,
                lng: result.lng,
                displayName: result.displayName || '',
                placeId: result.placeId || '',
                cachedAt: Date.now()
            }));
        } catch (e) { /* localStorage full or disabled - silent fail */ }
    }

    function hasGoogleApi() {
        return Boolean(window.google && window.google.maps && window.google.maps.Geocoder);
    }

    function ensureGoogleGeocoder() {
        if (!hasGoogleApi()) return null;
        if (!googleGeocoder) googleGeocoder = new window.google.maps.Geocoder();
        return googleGeocoder;
    }

    /**
     * Carga la JS API de Google Maps si no esta ya cargada.
     * Resuelve cuando window.google.maps.Geocoder esta disponible.
     * Rechaza si window.CONFIG.googleMaps.apiKey no existe tras 5 segundos.
     */
    function ensureGoogleMapsLoaded(opts) {
        opts = opts || {};
        var libraries = opts.libraries || ['places'];

        if (hasGoogleApi()) return Promise.resolve();
        if (googleMapsLoadPromise) return googleMapsLoadPromise;

        googleMapsLoadPromise = new Promise(function (resolve, reject) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (hasGoogleApi()) {
                    clearInterval(timer);
                    return resolve();
                }
                var apiKey = window.CONFIG && window.CONFIG.googleMaps && window.CONFIG.googleMaps.apiKey;
                if (apiKey) {
                    clearInterval(timer);

                    var cbName = '__weOtziGeocoderCb_' + Date.now();
                    window[cbName] = function () {
                        try { delete window[cbName]; } catch (e) {}
                        if (hasGoogleApi()) resolve();
                        else reject(new Error('google.maps loaded but Geocoder unavailable'));
                    };

                    var script = document.createElement('script');
                    script.async = true;
                    script.defer = true;
                    script.dataset.role = 'weotzi-geocoder-google-maps';
                    script.src = 'https://maps.googleapis.com/maps/api/js'
                        + '?key=' + encodeURIComponent(apiKey)
                        + '&libraries=' + encodeURIComponent(libraries.join(','))
                        + '&loading=async'
                        + '&callback=' + cbName;
                    script.onerror = function () { reject(new Error('Failed to load Google Maps script')); };
                    document.head.appendChild(script);
                    return;
                }
                if (attempts >= 50) {
                    clearInterval(timer);
                    reject(new Error('window.CONFIG.googleMaps.apiKey not available after 5s'));
                }
            }, 100);
        });

        return googleMapsLoadPromise;
    }

    function rawGeocode(query) {
        var geocoder = ensureGoogleGeocoder();
        if (!geocoder) return Promise.resolve({ ok: false, status: 'GOOGLE_NOT_READY', result: null });

        return new Promise(function (resolve) {
            var overQueryRetries = 0;
            var unknownRetries = 0;

            function attempt() {
                geocoder.geocode({ address: query }, function (results, status) {
                    if (status === 'OK' && Array.isArray(results) && results.length) {
                        var first = results[0];
                        var loc = first.geometry && first.geometry.location;
                        var lat = loc && typeof loc.lat === 'function' ? Number(loc.lat()) : NaN;
                        var lng = loc && typeof loc.lng === 'function' ? Number(loc.lng()) : NaN;
                        if (Number.isFinite(lat) && Number.isFinite(lng)) {
                            return resolve({
                                ok: true,
                                status: status,
                                result: {
                                    lat: lat,
                                    lng: lng,
                                    displayName: String(first.formatted_address || query),
                                    placeId: String(first.place_id || '')
                                }
                            });
                        }
                        return resolve({ ok: false, status: 'INVALID_GEOMETRY', result: null });
                    }
                    if (status === 'OVER_QUERY_LIMIT' && overQueryRetries < OVER_QUERY_LIMIT_RETRIES) {
                        overQueryRetries++;
                        return wait(400 * Math.pow(2, overQueryRetries - 1)).then(attempt);
                    }
                    if (status === 'UNKNOWN_ERROR' && unknownRetries < UNKNOWN_ERROR_RETRIES) {
                        unknownRetries++;
                        return wait(300).then(attempt);
                    }
                    return resolve({ ok: false, status: String(status || 'UNKNOWN'), result: null });
                });
            }

            attempt();
        });
    }

    /**
     * Geocodea una query de texto (e.g. "Buenos Aires, Argentina") con cache, retries
     * y rate-limit. Devuelve { lat, lng, displayName, placeId } o null si falla.
     */
    function geocodeQuery(query) {
        var normalized = normalizeQuery(query);
        if (!normalized) return Promise.resolve(null);

        var cached = readCache(normalized);
        if (cached) return Promise.resolve(cached);

        if (inFlight.has(normalized)) return inFlight.get(normalized);

        var promise = ensureGoogleMapsLoaded()
            .then(function () {
                var elapsed = Date.now() - lastRequestAt;
                return elapsed < MIN_INTERVAL_MS ? wait(MIN_INTERVAL_MS - elapsed) : null;
            })
            .then(function () {
                lastRequestAt = Date.now();
                return rawGeocode(normalized);
            })
            .then(function (response) {
                if (response.ok && response.result) {
                    writeCache(normalized, response.result);
                    return response.result;
                }
                return readCache(normalized, { allowExpired: true }) || null;
            })
            .catch(function (err) {
                if (window.console && window.console.warn) {
                    console.warn('[WeOtziGeocoder] geocodeQuery failed:', normalized, err);
                }
                return null;
            })
            .then(function (result) {
                inFlight.delete(normalized);
                return result;
            });

        inFlight.set(normalized, promise);
        return promise;
    }

    window.WeOtziGeocoder = {
        ensureGoogleMapsLoaded: ensureGoogleMapsLoaded,
        geocodeQuery: geocodeQuery,
        hasGoogleApi: hasGoogleApi
    };
})(window);
