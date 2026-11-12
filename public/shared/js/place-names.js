/**
 * Nombres de ciudades para filtros (Job Board 801:1067, auditoría H9).
 *
 * - `cityKey` agrupa variantes de la misma ciudad ("Cdmx", "CDMX", "Ciudad De
 *   México", "Mexico City" → una sola clave) sin tildes ni mayúsculas.
 * - `spanishTitleCase` capitaliza como se escribe en español: las partículas
 *   ("de", "del", "la", "los", "y"…) van en minúscula salvo al inicio
 *   ("Mar del Plata", "San Juan de los Lagos").
 * - `buildCityOptions` arma las opciones del filtro: una por ciudad, con la
 *   cantidad total y la etiqueta canónica.
 *
 * Lógica pura (UMD): `window.WeotziPlaceNames` en el navegador, `require` en Node.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeotziPlaceNames = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'da', 'do', 'dos', 'das', 'di']);

    // Alias → clave canónica. Las claves van sin tildes, en minúscula.
    const CITY_ALIASES = Object.freeze({
        'cdmx': 'ciudad de mexico',
        'df': 'ciudad de mexico',
        'mexico df': 'ciudad de mexico',
        'ciudad de mexico df': 'ciudad de mexico',
        'mexico city': 'ciudad de mexico',
        'caba': 'buenos aires',
        'capital federal': 'buenos aires',
        'ciudad autonoma de buenos aires': 'buenos aires',
        'ciudad de buenos aires': 'buenos aires',
        'bs as': 'buenos aires',
        'bsas': 'buenos aires',
        'nyc': 'nueva york',
        'new york': 'nueva york',
        'new york city': 'nueva york',
        'sao paulo': 'sao paulo',
        'rio': 'rio de janeiro',
        'mdq': 'mar del plata',
    });

    // Etiquetas canónicas cuando la clave tiene una grafía preferida.
    const CITY_LABELS = Object.freeze({
        'ciudad de mexico': 'Ciudad de México',
        'buenos aires': 'Buenos Aires',
        'nueva york': 'Nueva York',
        'sao paulo': 'São Paulo',
        'rio de janeiro': 'Río de Janeiro',
        'mar del plata': 'Mar del Plata',
        'bogota': 'Bogotá',
        'medellin': 'Medellín',
        'cordoba': 'Córdoba',
        'malaga': 'Málaga',
        'berlin': 'Berlín',
        'paris': 'París',
        'asuncion': 'Asunción',
    });

    function plainKey(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[.,]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** Clave estable de una ciudad: sin tildes, en minúscula y con alias resueltos. */
    function cityKey(value) {
        const key = plainKey(value);
        return CITY_ALIASES[key] || key;
    }

    function capitalize(word) {
        const chars = Array.from(word);
        if (!chars.length) return '';
        return chars[0].toLocaleUpperCase('es') + chars.slice(1).join('');
    }

    /** "MAR DEL PLATA" / "mar Del plata" → "Mar del Plata". */
    function spanishTitleCase(value) {
        const text = String(value || '').trim().replace(/\s+/g, ' ');
        if (!text) return '';
        return text.toLocaleLowerCase('es').split(' ').map((word, index) => {
            if (index > 0 && PARTICLES.has(word)) return word;
            // Palabras con guion o apóstrofo: "Saint-Denis", "L'Hospitalet".
            return word.split('-').map((part) => part.split("'").map(capitalize).join("'")).join('-');
        }).join(' ');
    }

    /** Etiqueta para mostrar una ciudad, usando la grafía canónica si existe. */
    function cityLabel(value) {
        const key = cityKey(value);
        if (!key) return '';
        return CITY_LABELS[key] || spanishTitleCase(value);
    }

    /**
     * @param {Array<string|null>} cities  ciudades crudas (una por solicitud)
     * @returns {Array<{value:string,label:string,count:number}>} ordenadas por etiqueta
     */
    function buildCityOptions(cities) {
        const groups = new Map();
        (Array.isArray(cities) ? cities : []).forEach((raw) => {
            const text = String(raw || '').trim();
            const key = cityKey(text);
            if (!key) return;
            const group = groups.get(key) || { value: key, count: 0, variants: new Map() };
            group.count += 1;
            group.variants.set(text, (group.variants.get(text) || 0) + 1);
            groups.set(key, group);
        });
        return [...groups.values()].map((group) => {
            // Sin grafía canónica: la variante más usada (si empatan, la que
            // tiene tildes, que suele ser la correcta en español).
            const best = [...group.variants.entries()].sort((a, b) => b[1] - a[1]
                || Number(/[^\x00-\x7F]/.test(b[0])) - Number(/[^\x00-\x7F]/.test(a[0]))
                || a[0].localeCompare(b[0], 'es'))[0][0];
            return { value: group.value, label: CITY_LABELS[group.value] || spanishTitleCase(best), count: group.count };
        }).sort((a, b) => a.label.localeCompare(b.label, 'es'));
    }

    /** ¿La ciudad cruda corresponde a la clave del filtro? */
    function sameCity(value, key) {
        return Boolean(key) && cityKey(value) === cityKey(key);
    }

    return { cityKey, cityLabel, spanishTitleCase, buildCityOptions, sameCity, CITY_ALIASES };
}));
