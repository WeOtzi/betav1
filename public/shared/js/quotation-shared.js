/**
 * WE OTZI - QUOTATION SHARED CONSTANTS
 * Shared by /quotation and /pre-cotizador.
 */
(function () {
    'use strict';

    var TATTOO_SIZE_OPTIONS = [
        { label: 'Pequeño', value: 'pequeño', icon: '📏', subtitle: '< 5cm' },
        { label: 'Mediano', value: 'mediano', icon: '📐', subtitle: '5-15cm' },
        { label: 'Grande', value: 'grande', icon: '🖼️', subtitle: '15-30cm' },
        { label: 'Muy Grande', value: 'muy_grande', icon: '🎨', subtitle: '> 30cm' },
        { label: 'Media Manga', value: 'media_manga', icon: '💪', subtitle: '' },
        { label: 'Manga Completa', value: 'manga_completa', icon: '🦾', subtitle: '' },
        { label: 'Espalda Completa', value: 'espalda_completa', icon: '🔙', subtitle: '' },
        { label: 'Pecho Completo', value: 'pecho_completo', icon: '👔', subtitle: '' }
    ];

    var TATTOO_STYLE_OPTIONS = [
        { label: 'Realismo', value: 'realismo' },
        { label: 'Tradicional', value: 'tradicional' },
        { label: 'Neo-Tradicional', value: 'neo_tradicional' },
        { label: 'Japonés', value: 'japones' },
        { label: 'Minimalista', value: 'minimalista' },
        { label: 'Fine Line', value: 'fine_line' },
        { label: 'Blackwork', value: 'blackwork' },
        { label: 'Dotwork', value: 'dotwork' },
        { label: 'Acuarela', value: 'acuarela' },
        { label: 'Geométrico', value: 'geometrico' },
        { label: 'Trash Polka', value: 'trash_polka' },
        { label: 'Chicano', value: 'chicano' },
        { label: 'New School', value: 'new_school' },
        { label: 'Anime', value: 'anime' },
        { label: 'Ilustrativo', value: 'ilustrativo' },
        { label: 'Surrealista', value: 'surrealista' },
        { label: 'Black & Grey', value: 'black_grey' },
        { label: 'Microrealismo', value: 'microrealismo' },
        { label: 'Hiperrealismo', value: 'hiperrealismo' },
        { label: 'Ornamental', value: 'ornamental' },
        { label: 'Mandala', value: 'mandala' },
        { label: 'Tribal', value: 'tribal' },
        { label: 'Polinesio', value: 'polinesio' },
        { label: 'Maori', value: 'maori' },
        { label: 'Haida', value: 'haida' },
        { label: 'Celta', value: 'celta' },
        { label: 'Nordico / Viking', value: 'nordico_viking' },
        { label: 'Lettering', value: 'lettering' },
        { label: 'Blackletter / Gotico', value: 'blackletter_gotico' },
        { label: 'Caligrafia', value: 'caligrafia' },
        { label: 'Ignorant', value: 'ignorant' },
        { label: 'Handpoke / Stick and Poke', value: 'handpoke_stick_and_poke' },
        { label: 'Abstracto', value: 'abstracto' },
        { label: 'Sketch / Boceto', value: 'sketch_boceto' },
        { label: 'Etching / Grabado', value: 'etching_grabado' },
        { label: 'Woodcut / Xilografia', value: 'woodcut_xilografia' },
        { label: 'Linework', value: 'linework' },
        { label: 'Ilustracion botanica', value: 'ilustracion_botanica' },
        { label: 'Floral', value: 'floral' },
        { label: 'Fineline botanico', value: 'fineline_botanico' },
        { label: 'Biomecanico', value: 'biomecanico' },
        { label: 'Bioorganico', value: 'bioorganico' },
        { label: 'Horror', value: 'horror' },
        { label: 'Dark Art', value: 'dark_art' },
        { label: 'Glitch', value: 'glitch' },
        { label: 'Pixel Art', value: 'pixel_art' },
        { label: 'Graffiti', value: 'graffiti' },
        { label: 'Pop Art', value: 'pop_art' },
        { label: 'Art Nouveau', value: 'art_nouveau' },
        { label: 'Art Deco', value: 'art_deco' },
        { label: 'Barroco', value: 'barroco' },
        { label: 'Abstract Brush', value: 'abstract_brush' },
        { label: 'Patchwork', value: 'patchwork' },
        { label: 'Religious / Sacro', value: 'religious_sacro' },
        { label: 'Ornamental Blackwork', value: 'ornamental_blackwork' },
        { label: 'Pointillism', value: 'pointillism' }
    ];

    function toTitleCase(str) {
        if (!str || typeof str !== 'string') return '';
        return str.split(' ').map(function (word) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }).join(' ');
    }

    function sanitizeLocationSegment(segment) {
        if (!segment || typeof segment !== 'string') return '';
        return segment
            .replace(/\b(?:[A-Z]{1,3}\d{3,6}[A-Z]{0,3}|\d{3,8}(?:-\d{3,4})?)\b/gi, '')
            .replace(/\s+/g, ' ')
            .replace(/^[,\s-]+|[,\s-]+$/g, '')
            .trim();
    }

    function normalizeQuotationLocation(rawLocation) {
        if (!rawLocation || typeof rawLocation !== 'string') return '';
        var parts = rawLocation.split(',').map(sanitizeLocationSegment).filter(Boolean);
        var deduped = [];
        parts.forEach(function (part) {
            if (!deduped.some(function (existing) { return existing.toLowerCase() === part.toLowerCase(); })) {
                deduped.push(part);
            }
        });
        return deduped.slice(0, 3).join(', ');
    }

    function addressComponent(components, acceptedTypes) {
        if (!Array.isArray(components)) return '';
        for (var i = 0; i < acceptedTypes.length; i++) {
            var match = components.find(function (component) {
                return component.types && component.types.includes(acceptedTypes[i]);
            });
            if (match && match.long_name) return sanitizeLocationSegment(match.long_name);
        }
        return '';
    }

    function extractCityFromComponents(components, fallbackAddress) {
        var cityName = addressComponent(components, ['locality', 'postal_town', 'administrative_area_level_3', 'administrative_area_level_2', 'sublocality_level_1', 'sublocality']);
        var province = addressComponent(components, ['administrative_area_level_1', 'administrative_area_level_2']);
        var countryName = addressComponent(components, ['country']);
        var structured = [cityName, province, countryName].filter(Boolean);
        var deduped = structured.filter(function (part, index, arr) {
            return arr.findIndex(function (candidate) { return candidate.toLowerCase() === part.toLowerCase(); }) === index;
        });
        return {
            cityName: cityName,
            province: province,
            countryName: countryName,
            normalizedLocation: deduped.length ? deduped.join(', ') : normalizeQuotationLocation(fallbackAddress || '')
        };
    }

    function attachCityAutocomplete(input, options) {
        if (!input) return function () {};
        var opts = options || {};
        var retries = 0;
        var timer = null;

        function attach() {
            if (!window.google || !window.google.maps || !window.google.maps.places) return false;
            if (input._weotziAutocompleteAttached) return true;
            input._weotziAutocompleteAttached = true;
            var autocomplete = new google.maps.places.Autocomplete(input, {
                types: ['(cities)'],
                fields: ['formatted_address', 'address_components', 'geometry']
            });
            autocomplete.addListener('place_changed', function () {
                var place = autocomplete.getPlace();
                if (!place) return;
                var parsed = extractCityFromComponents(place.address_components, place.formatted_address);
                var normalized = parsed.normalizedLocation || normalizeQuotationLocation(place.formatted_address || '');
                if (!normalized) return;
                input.value = normalized;
                if (typeof opts.onSelect === 'function') {
                    opts.onSelect({ normalizedLocation: normalized, cityName: parsed.cityName, countryName: parsed.countryName, province: parsed.province });
                }
            });
            input.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') event.preventDefault();
            });
            return true;
        }

        if (!attach()) {
            timer = setInterval(function () {
                retries++;
                if (attach() || retries > 40) clearInterval(timer);
            }, 250);
        }
        return function () { if (timer) clearInterval(timer); };
    }

    function formatBodyPartLabel(zoneLabel, subzoneLabel) {
        var z = sanitizeLocationSegment(zoneLabel || '');
        var s = sanitizeLocationSegment(subzoneLabel || '');
        if (z && s && z.toLowerCase() !== s.toLowerCase()) return z + ': ' + s;
        return z || s || '';
    }

    function formatTattooStyleForDisplay(tattooStyle) {
        if (!tattooStyle) return '-';
        if (typeof tattooStyle === 'object') {
            if (tattooStyle.substyle_name) return tattooStyle.style_name + ' › ' + tattooStyle.substyle_name;
            return tattooStyle.style_name || '-';
        }
        var found = TATTOO_STYLE_OPTIONS.find(function (option) { return option.value === tattooStyle; });
        return found ? found.label : toTitleCase(String(tattooStyle).replace(/_/g, ' '));
    }

    window.WeotziQuotationShared = {
        TATTOO_SIZE_OPTIONS: TATTOO_SIZE_OPTIONS,
        TATTOO_STYLE_OPTIONS: TATTOO_STYLE_OPTIONS,
        toTitleCase: toTitleCase,
        formatTattooStyleForDisplay: formatTattooStyleForDisplay,
        normalizeQuotationLocation: normalizeQuotationLocation,
        extractCityFromComponents: extractCityFromComponents,
        attachCityAutocomplete: attachCityAutocomplete,
        formatBodyPartLabel: formatBodyPartLabel
    };
})();
