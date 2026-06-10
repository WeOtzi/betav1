/**
 * WeOtziAddressPicker
 *
 * Reusable Google Places autocomplete + structured-address picker.
 *
 * Lives in this single file because it's used by /register (studio choice),
 * /artist/profile (current studio + independent personal address), and the
 * admin dashboard's studio CRUD. All callers need the same address shape:
 *
 *   {
 *     country, country_code, state_province, city, locality,
 *     street, street_number, unit, postal_code,
 *     formatted_address, latitude, longitude, google_place_id
 *   }
 *
 * Usage:
 *   const picker = WeOtziAddressPicker.attach(inputElement, {
 *     onChange(address) { ... }
 *   });
 *   picker.setValue({ formatted_address: 'Av. Santa Fe 1750, ...', ... });
 *   picker.detach();
 */
(function (window) {
    'use strict';

    var COMPONENT_TYPE_MAP = [
        // [google component types[]] -> { field, prefer }
        // 'long' = use long_name, 'short' = use short_name
        { types: ['country'],                                field: 'country',         prefer: 'long' },
        { types: ['country'],                                field: 'country_code',    prefer: 'short' },
        { types: ['administrative_area_level_1'],            field: 'state_province',  prefer: 'long' },
        { types: ['locality', 'postal_town'],                field: 'city',            prefer: 'long' },
        { types: ['administrative_area_level_2'],            field: 'city',            prefer: 'long', fallbackOnly: true },
        { types: ['sublocality_level_1', 'sublocality',
                  'neighborhood'],                           field: 'locality',        prefer: 'long' },
        { types: ['route'],                                  field: 'street',          prefer: 'long' },
        { types: ['street_number'],                          field: 'street_number',   prefer: 'short' },
        { types: ['subpremise'],                             field: 'unit',            prefer: 'long' },
        { types: ['postal_code'],                            field: 'postal_code',     prefer: 'short' }
    ];

    function emptyAddress() {
        return {
            country: '', country_code: '',
            state_province: '', city: '', locality: '',
            street: '', street_number: '', unit: '', postal_code: '',
            formatted_address: '',
            latitude: null, longitude: null,
            google_place_id: ''
        };
    }

    function placeToAddress(place) {
        var addr = emptyAddress();
        if (!place) return addr;

        var components = place.address_components || [];

        COMPONENT_TYPE_MAP.forEach(function (rule) {
            // Skip if a non-fallback rule already filled this field.
            if (rule.fallbackOnly && addr[rule.field]) return;

            var match = components.find(function (c) {
                return rule.types.some(function (t) { return (c.types || []).indexOf(t) >= 0; });
            });
            if (match) {
                var value = rule.prefer === 'short' ? match.short_name : match.long_name;
                if (value && !addr[rule.field]) addr[rule.field] = value;
            }
        });

        addr.formatted_address = place.formatted_address || '';
        addr.google_place_id   = place.place_id || '';

        var loc = place.geometry && place.geometry.location;
        if (loc) {
            addr.latitude  = typeof loc.lat === 'function' ? Number(loc.lat()) : Number(loc.lat);
            addr.longitude = typeof loc.lng === 'function' ? Number(loc.lng()) : Number(loc.lng);
            if (!Number.isFinite(addr.latitude))  addr.latitude  = null;
            if (!Number.isFinite(addr.longitude)) addr.longitude = null;
        }

        return addr;
    }

    function ensureGoogleMapsLoaded() {
        if (window.WeOtziGeocoder && typeof window.WeOtziGeocoder.ensureGoogleMapsLoaded === 'function') {
            return window.WeOtziGeocoder.ensureGoogleMapsLoaded({ libraries: ['places'] });
        }
        // Fallback: assume already loaded.
        return new Promise(function (resolve) {
            if (window.google && window.google.maps && window.google.maps.places) return resolve();
            // Wait up to 5s for some other code to load it.
            var t = 0;
            var iv = setInterval(function () {
                t += 100;
                if (window.google && window.google.maps && window.google.maps.places) {
                    clearInterval(iv);
                    resolve();
                } else if (t >= 5000) {
                    clearInterval(iv);
                    resolve(); // fail open; attach() will warn
                }
            }, 100);
        });
    }

    /**
     * Attach autocomplete + structured-output behaviour to an input.
     *
     * options:
     *   onChange(address)   - called whenever a place is selected or value cleared
     *   types               - Places autocomplete types (default: ['geocode'])
     *   placeholder         - input placeholder
     *   countryRestriction  - 2-letter code or array, restricts to that country
     */
    function attach(input, options) {
        if (!input || input.tagName !== 'INPUT') {
            console.warn('[AddressPicker] attach() requires an input element');
            return null;
        }
        options = options || {};

        if (options.placeholder) input.placeholder = options.placeholder;
        input.setAttribute('autocomplete', 'off');
        input.classList.add('weotzi-address-picker-input');

        var state = {
            input: input,
            autocomplete: null,
            address: emptyAddress(),
            listener: null,
            destroyed: false
        };

        ensureGoogleMapsLoaded().then(function () {
            if (state.destroyed) return;
            if (!(window.google && window.google.maps && window.google.maps.places)) {
                console.warn('[AddressPicker] Google Places library not available; falling back to plain text input.');
                return;
            }

            try {
                var ac = new window.google.maps.places.Autocomplete(input, {
                    fields: ['address_components', 'formatted_address', 'geometry', 'place_id', 'name'],
                    types: options.types || ['geocode']
                });
                if (options.countryRestriction) {
                    ac.setComponentRestrictions({
                        country: options.countryRestriction
                    });
                }
                state.autocomplete = ac;

                state.listener = ac.addListener('place_changed', function () {
                    var place = ac.getPlace();
                    var addr = placeToAddress(place);
                    state.address = addr;
                    // Always show the resolved address back in the input
                    if (addr.formatted_address) input.value = addr.formatted_address;
                    if (typeof options.onChange === 'function') options.onChange(addr);
                });
            } catch (err) {
                console.warn('[AddressPicker] Failed to instantiate Autocomplete:', err);
            }
        });

        // Pressing Enter with no suggestion selected was reloading the form;
        // suppress that so callers can submit only via their own buttons.
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') e.preventDefault();
        });

        // If the user clears the input manually, reset address state.
        input.addEventListener('input', function () {
            if (input.value === '') {
                state.address = emptyAddress();
                if (typeof options.onChange === 'function') options.onChange(state.address);
            }
        });

        return {
            getAddress: function () { return Object.assign({}, state.address); },
            setValue: function (address) {
                if (!address) return;
                state.address = Object.assign(emptyAddress(), address);
                input.value = address.formatted_address || '';
            },
            clear: function () {
                state.address = emptyAddress();
                input.value = '';
                if (typeof options.onChange === 'function') options.onChange(state.address);
            },
            detach: function () {
                state.destroyed = true;
                if (state.listener && state.listener.remove) state.listener.remove();
                state.autocomplete = null;
            }
        };
    }

    /**
     * Render a "preview" block of the structured fields so the user can
     * confirm the picker parsed the address correctly. Read-only.
     *
     *   <div class="weotzi-address-fields"
     *        data-address-preview-for="my-input-id"></div>
     *
     * Pass the address from onChange. Hidden until a place is selected.
     */
    function renderPreview(container, address) {
        if (!container) return;
        var addr = address || emptyAddress();
        var hasAny = ['street', 'street_number', 'city', 'country', 'postal_code']
            .some(function (k) { return addr[k]; });

        if (!hasAny) {
            container.innerHTML = '';
            container.hidden = true;
            return;
        }

        container.hidden = false;
        container.innerHTML = [
            row('País',     [addr.country, addr.country_code ? '(' + addr.country_code + ')' : ''].filter(Boolean).join(' ')),
            row('Provincia / Estado', addr.state_province),
            row('Ciudad',   addr.city),
            row('Localidad / Barrio', addr.locality),
            row('Calle',    [addr.street, addr.street_number].filter(Boolean).join(' ')),
            row('Depto / unidad', addr.unit),
            row('Código postal', addr.postal_code),
            row('Coordenadas', (addr.latitude != null && addr.longitude != null)
                ? (Number(addr.latitude).toFixed(5) + ', ' + Number(addr.longitude).toFixed(5))
                : '')
        ].filter(Boolean).join('');

        function row(label, value) {
            if (!value) return '';
            return '<div class="weotzi-address-row">'
                +    '<span class="weotzi-address-label">' + escapeHtml(label) + '</span>'
                +    '<span class="weotzi-address-value">' + escapeHtml(value) + '</span>'
                +  '</div>';
        }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * Hidden form-fields helper. Given a form and an address, writes each
     * structured field into <input type="hidden" name="address_xxx"> nodes
     * (creating them if missing). Keeps any other form data untouched.
     */
    function syncHiddenFields(form, address, prefix) {
        if (!form) return;
        prefix = prefix || 'address_';
        var addr = address || emptyAddress();
        Object.keys(addr).forEach(function (key) {
            var name = prefix + key;
            var existing = form.querySelector('input[name="' + name + '"]');
            if (!existing) {
                existing = document.createElement('input');
                existing.type = 'hidden';
                existing.name = name;
                form.appendChild(existing);
            }
            existing.value = addr[key] == null ? '' : String(addr[key]);
        });
    }

    window.WeOtziAddressPicker = {
        attach: attach,
        emptyAddress: emptyAddress,
        renderPreview: renderPreview,
        syncHiddenFields: syncHiddenFields,
        placeToAddress: placeToAddress
    };
})(window);
