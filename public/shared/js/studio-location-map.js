// Pin de sede seleccionable (revisión Estudios v1, paso 3).
// Monta un mapa de Google con un pin arrastrable. Al soltar el pin o tocar el
// mapa se busca la dirección del punto (Geocoder inverso) y se devuelve con el
// mismo formato que WeOtziAddressPicker (país, provincia, ciudad, calle…), pero
// con las coordenadas exactas del pin. Sin Maps (sin API key o sin red) no
// monta nada y el wizard conserva el enlace "Comprobar ubicación en el mapa".
(function (root) {
    'use strict';
    const DEFAULT_CENTER = { lat: -34.6037, lng: -58.3816 }; // Buenos Aires
    const DEFAULT_ZOOM = 12;
    const PIN_ZOOM = 17;

    function mapsReady() { return !!(root.google && root.google.maps && root.google.maps.Map && root.google.maps.Marker && root.google.maps.Geocoder); }
    function namespaceReady() { return !!(root.google && root.google.maps && (root.google.maps.importLibrary || root.google.maps.Map)); }
    // Con `loading=async` (registro) las clases llegan recién con importLibrary.
    async function importLibraries() {
        const maps = root.google.maps;
        if (typeof maps.importLibrary !== 'function') return mapsReady();
        try {
            await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker'), maps.importLibrary('geocoding')]);
        } catch (_) { return false; }
        return mapsReady();
    }
    function whenMaps(timeoutMs = 10000) {
        if (mapsReady()) return Promise.resolve(true);
        return new Promise(resolve => {
            const started = Date.now();
            const timer = setInterval(() => {
                if (namespaceReady()) { clearInterval(timer); importLibraries().then(resolve); }
                else if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(false); }
            }, 150);
        });
    }
    function toAddress(result, lat, lng) {
        const picker = root.WeOtziAddressPicker;
        const base = picker && typeof picker.placeToAddress === 'function' ? picker.placeToAddress(result) : {
            formatted_address: result?.formatted_address || '', google_place_id: result?.place_id || ''
        };
        return { ...base, latitude: lat, longitude: lng };
    }
    function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
    // Google a veces devuelve primero un "premise" con la localidad = código
    // postal ("C1414DMH"). Preferimos la primera dirección de calle con una
    // localidad real; si no hay, la primera de calle; si no, la primera.
    function bestResult(results) {
        const list = Array.isArray(results) ? results : [];
        const isStreet = r => (r.types || []).some(t => t === 'street_address' || t === 'premise' || t === 'subpremise');
        const cleanLocality = r => {
            const locality = (r.address_components || []).find(c => (c.types || []).includes('locality'));
            return !locality || !/\d/.test(locality.long_name || '');
        };
        return list.find(r => isStreet(r) && cleanLocality(r)) || list.find(isStreet) || list[0] || null;
    }

    function attach(container, opts = {}) {
        let map = null;
        let marker = null;
        let geocoder = null;
        let seq = 0;
        const state = { ready: false };

        function place(lat, lng, { pan = true, zoom = false } = {}) {
            if (!map) return;
            const position = { lat, lng };
            if (!marker) {
                marker = new root.google.maps.Marker({ map, position, draggable: true, title: opts.pinTitle || 'Ubicación de la sede' });
                marker.addListener('dragend', event => pick(event.latLng.lat(), event.latLng.lng()));
            } else {
                marker.setPosition(position);
            }
            if (pan) map.panTo(position);
            if (zoom && map.getZoom() < PIN_ZOOM) map.setZoom(PIN_ZOOM);
        }
        async function pick(lat, lng) {
            place(lat, lng, { pan: false });
            const token = ++seq;
            if (typeof opts.onPending === 'function') opts.onPending();
            let address = { latitude: lat, longitude: lng };
            try {
                const { results } = await geocoder.geocode({ location: { lat, lng } });
                if (token !== seq) return;
                const best = bestResult(results);
                if (best) address = toAddress(best, lat, lng);
            } catch (error) {
                if (token !== seq) return;
                if (typeof opts.onError === 'function') opts.onError(error);
            }
            if (typeof opts.onPick === 'function') opts.onPick(address);
        }

        const ready = whenMaps(opts.timeoutMs).then(ok => {
            if (!ok || !container) return false;
            container.hidden = false;
            const start = finite(opts.latitude) && finite(opts.longitude) ? { lat: opts.latitude, lng: opts.longitude } : null;
            map = new root.google.maps.Map(container, {
                center: start || opts.center || DEFAULT_CENTER,
                zoom: start ? PIN_ZOOM : DEFAULT_ZOOM,
                disableDefaultUI: true,
                zoomControl: true,
                fullscreenControl: false,
                streetViewControl: false,
                mapTypeControl: false,
                clickableIcons: false,
                gestureHandling: 'cooperative'
            });
            geocoder = new root.google.maps.Geocoder();
            map.addListener('click', event => pick(event.latLng.lat(), event.latLng.lng()));
            if (start) place(start.lat, start.lng, { pan: false });
            state.ready = true;
            return true;
        });

        return {
            ready,
            get isReady() { return state.ready; },
            // Dirección elegida desde el buscador: mueve el pin sin reverse-geocode.
            setPosition(lat, lng) { if (finite(lat) && finite(lng)) place(lat, lng, { zoom: true }); },
            // Dirección manual: la ubica en el mapa (geocode directo) y avisa con onPick.
            async locate(query) {
                if (!state.ready || !query) return null;
                try {
                    const { results } = await geocoder.geocode({ address: query });
                    const hit = results && results[0];
                    if (!hit) return null;
                    const loc = hit.geometry.location;
                    place(loc.lat(), loc.lng(), { zoom: true });
                    return toAddress(hit, loc.lat(), loc.lng());
                } catch (_) { return null; }
            },
            destroy() { if (marker) marker.setMap(null); marker = null; map = null; }
        };
    }

    root.WeOtziLocationMap = { attach, whenMaps, bestResult };
})(typeof window !== 'undefined' ? window : globalThis);
