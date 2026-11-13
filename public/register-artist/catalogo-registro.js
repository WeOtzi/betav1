/**
 * WE OTZI - Catálogo local del registro de artistas (respaldo)
 * ------------------------------------------------------------
 * Revisión del registro (12 nov 2026), páginas 5 y 6: catálogo exacto de
 * estilos en 3 grupos y monedas solo de los países del listado de Crear cuenta.
 *
 * La fuente principal es GET /api/registration/catalogs (styleGroups,
 * currencies). Este archivo es el respaldo cuando el endpoint no responde
 * (preview local, servidor viejo, red caída) y lo usan los tests.
 *
 * Carga: antes de acceso-register-final.js. Expone window.WoRegistroCatalogo
 * y, en Node, module.exports.
 */
(function (root) {
    'use strict';

    // Grupos y estilos copiados literal de la revisión (orden incluido).
    const STYLE_GROUPS = [
        {
            id: 'principales',
            title: 'Estilos principales',
            styles: [
                'Realismo', 'Hiperrealismo', 'Microrealismo', 'Fine Line', 'Blackwork', 'Black and Grey',
                'Tradicional Americano (Old School)', 'Neotradicional', 'Tradicional Japonés (Irezumi)',
                'Neojaponés', 'Tribal', 'Geométrico', 'Dotwork', 'Minimalista', 'Ornamental', 'Lettering',
                'Caligrafía', 'Acuarela (Watercolor)', 'Ilustrativo', 'Surrealismo', 'Abstracto', 'New School',
                'Trash Polka', 'Chicano', 'Biomecánico', 'Bioorgánico', 'Anime', 'Manga', 'Dark Art',
                'Ignorant Style'
            ]
        },
        {
            id: 'subestilos',
            title: 'Subestilos y especialidades',
            styles: [
                'Realismo a Color', 'Realismo en Negro y Gris', 'Retratos', 'Microtattoo', 'Single Needle',
                'Blackout', 'Negative Space', 'Blackwork Ornamental', 'Blackwork Abstracto',
                'Blackwork Geométrico', 'Geometría Sagrada', 'Mandalas', 'Puntillismo Geométrico', 'Botánico',
                'Floral', 'Florales Realistas', 'Filigrana', 'Ornamental Floral', 'Ornamental Gótico',
                'Grabado (Engraving)', 'Xilografía (Woodcut)', 'Etching', 'Sketch', 'Doodle', 'Linework',
                'Línea Continua', 'Fine Script', 'Gothic Lettering', 'Lettering Experimental',
                'Lettering Chicano', 'Caligrafía de Autor', 'Tribal Polinesio', 'Maorí', 'Samoano', 'Celta',
                'Nórdico', 'Viking', 'Tradicional Europeo', 'Art Nouveau', 'Art Déco', 'Psicodélico', 'Horror',
                'Gótico', 'Medieval', 'Kawaii', 'Cartoon', 'Comic', 'Pixel Art', 'Graffiti',
                'Bordado (Embroidery Tattoo)', 'Patch Tattoo', 'Ilusión Óptica (3D)'
            ]
        },
        {
            id: 'tendencias',
            title: 'Estilos y tendencias contemporáneas en auge',
            styles: [
                'Cibersigilismo (Cybersigilism)', 'Neotribal (Neo Tribal)', 'Cyber Tribal', 'Y2K Tattoo',
                'Chrome Tattoo', 'Glitch Tattoo', 'Cyberpunk', 'Techno Ornamental', 'Abstract Flow',
                'Fluid Abstract', 'Brushstroke', 'Patchwork', 'Sticker Sleeve', 'Sticker Tattoo',
                'Charm Tattoo', 'Micro Ornamental', 'Fine Line Ornamental', 'Dark Ornamental',
                'Anime Blackwork', 'Nostalgic Realism', 'Ignorant Tattoo', 'Abstract Blackwork', 'Sigilismo',
                'Cyber Gothic', 'Digital Surrealism', 'Anatomical Flow', 'Freehand Abstract'
            ]
        }
    ];

    // Nombres que pueden llegar de Crear cuenta (lista corta de la página 2) o
    // de borradores viejos y que equivalen a un estilo del catálogo. La clave
    // va normalizada (minúsculas, sin tildes, separadores como espacio).
    const STYLE_ALIASES = {
        'japones': 'Tradicional Japonés (Irezumi)',
        'lettering caligrafia': 'Lettering',
        'neo tradicional': 'Neotradicional',
        'neo japanese': 'Neojaponés',
        'neo japones': 'Neojaponés',
        'black & grey': 'Black and Grey',
        'black grey': 'Black and Grey',
        'acuarela': 'Acuarela (Watercolor)',
        'old school': 'Tradicional Americano (Old School)',
        'american traditional': 'Tradicional Americano (Old School)',
        // Nombres históricos de tattoo_styles / artists_db.styles_array (mismos
        // alias que LEGACY_STYLE_ALIASES de lib/registration-catalogs.js).
        'realimsmo': 'Realismo',
        'micro realismo': 'Microrealismo',
        'fineline': 'Fine Line',
        'black and gray': 'Black and Grey',
        'black & gray': 'Black and Grey',
        'tradicional': 'Tradicional Americano (Old School)',
        'surrealista': 'Surrealismo',
        'mandala': 'Mandalas',
        'polinesio': 'Tribal Polinesio',
        'nordico viking': 'Nórdico',
        'etching grabado': 'Grabado (Engraving)',
        'woodcut xilografia': 'Xilografía (Woodcut)',
        'sketch boceto': 'Sketch',
        'boceto': 'Sketch',
        'blackletter gotico': 'Gothic Lettering',
        'blackletter': 'Gothic Lettering',
        'ignorant': 'Ignorant Style',
        'ilustracion botanica': 'Botánico',
        'fineline botanico': 'Botánico',
        'retrato': 'Retratos',
        'pointillism': 'Puntillismo Geométrico',
        'ornamental blackwork': 'Blackwork Ornamental',
        'glitch': 'Glitch Tattoo',
        'cybersigilismo': 'Cibersigilismo (Cybersigilism)',
        'freehand': 'Freehand Abstract',
        'abstract brush': 'Brushstroke'
    };

    // ---- Estilos para editar el perfil (Cuenta, dashboard) ----------------
    // Misma normalización que acceso-register-final.js: minúsculas, sin
    // tildes, separadores (espacio - _ / · .) como un espacio.
    function normalizeKey(name) {
        return String(name == null ? '' : name).trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[\s\-_/·.]+/g, ' ')
            .trim();
    }

    // Claves de un estilo del catálogo: la etiqueta, sin el paréntesis y el
    // contenido del paréntesis ("Tradicional Americano (Old School)" →
    // "tradicional americano" y "old school").
    function styleKeys(label) {
        const text = String(label == null ? '' : label);
        const keys = [normalizeKey(text)];
        const base = normalizeKey(text.replace(/\s*\([^)]*\)\s*/g, ' '));
        const match = text.match(/\(([^)]*)\)/);
        const alt = match ? normalizeKey(match[1]) : '';
        [base, alt].forEach((key) => { if (key && !keys.includes(key)) keys.push(key); });
        return keys.filter(Boolean);
    }

    function catalogEntries(groups) {
        const seen = new Set();
        const out = [];
        (groups || STYLE_GROUPS).forEach((group) => {
            (group.styles || []).forEach((label) => {
                const keys = styleKeys(label);
                if (!keys.length || seen.has(keys[0])) return;
                seen.add(keys[0]);
                out.push({ label, keys, group: group.id });
            });
        });
        return out;
    }

    // Entrada del catálogo para un nombre guardado (etiqueta, nombre de
    // tattoo_styles o alias histórico). null si es un estilo propio.
    function findCatalogEntry(value, entries, exclude) {
        const key = normalizeKey(value);
        if (!key) return null;
        const list = (entries || catalogEntries()).filter((e) => !(exclude && exclude.has(e)));
        const aliasKey = STYLE_ALIASES[key] ? normalizeKey(STYLE_ALIASES[key]) : '';
        return list.find((e) => e.keys[0] === key)
            || (aliasKey && list.find((e) => e.keys[0] === aliasKey))
            || list.find((e) => e.keys.includes(key))
            || null;
    }

    // Etiqueta del catálogo para mostrar un estilo guardado ("Old School" →
    // "Tradicional Americano (Old School)"); los propios quedan como están.
    function styleLabelFor(value) {
        const entry = findCatalogEntry(value);
        return entry ? entry.label : String(value == null ? '' : value).trim();
    }

    // Opciones de estilos para editar el perfil del artista, desde el catálogo
    // (no desde tattoo_styles). Cada opción: { value, label, selected, custom,
    // group }. `value` es lo que se guarda: el estilo guardado tal cual (no se
    // reescribe) o, para los no elegidos, el nombre de tattoo_styles cuando
    // coincide (igual que el registro) o la etiqueta del catálogo. Los
    // guardados que no están en el catálogo siguen elegidos (custom: true).
    // Orden: los elegidos primero y después el catálogo por grupo.
    function buildStyleOptions(dbStyles, saved, groups) {
        const tableByKey = new Map();
        (Array.isArray(dbStyles) ? dbStyles : []).forEach((row) => {
            const name = row && (row.name || row.display_name);
            const key = normalizeKey(name);
            if (key && !tableByKey.has(key)) tableByKey.set(key, String(name));
        });
        const entries = catalogEntries(groups);
        const used = new Set();
        const chosen = [];
        const chosenKeys = new Set();
        (Array.isArray(saved) ? saved : []).forEach((raw) => {
            const value = String(raw == null ? '' : raw).trim();
            const key = normalizeKey(value);
            if (!key || chosenKeys.has(key)) return;
            chosenKeys.add(key);
            const entry = findCatalogEntry(value, entries, used);
            if (entry) used.add(entry);
            chosen.push({ value, label: entry ? entry.label : value, selected: true, custom: !entry, group: entry ? entry.group : 'propios' });
        });
        const rest = [];
        entries.forEach((entry) => {
            if (used.has(entry)) return;
            const hit = entry.keys.find((k) => tableByKey.has(k));
            const value = hit ? tableByKey.get(hit) : entry.label;
            const key = normalizeKey(value);
            if (chosenKeys.has(key)) return;
            chosenKeys.add(key);
            rest.push({ value, label: entry.label, selected: false, custom: false, group: entry.group });
        });
        return chosen.concat(rest);
    }

    // Países del listado de Crear cuenta (página 2) con su moneda (igual que
    // lib/registration-catalogs.js: Panamá usa el dólar, de curso legal).
    const COUNTRIES = [
        { name: 'Estados Unidos', code: 'US', currencies: ['USD'] },
        { name: 'Argentina', code: 'AR', currencies: ['ARS'] },
        { name: 'España', code: 'ES', currencies: ['EUR'] },
        { name: 'Alemania', code: 'DE', currencies: ['EUR'] },
        { name: 'Australia', code: 'AU', currencies: ['AUD'] },
        { name: 'Brasil', code: 'BR', currencies: ['BRL'] },
        { name: 'Canadá', code: 'CA', currencies: ['CAD'] },
        { name: 'Chile', code: 'CL', currencies: ['CLP'] },
        { name: 'Colombia', code: 'CO', currencies: ['COP'] },
        { name: 'Corea del Sur', code: 'KR', currencies: ['KRW'] },
        { name: 'Costa Rica', code: 'CR', currencies: ['CRC'] },
        { name: 'Dinamarca', code: 'DK', currencies: ['DKK'] },
        { name: 'Finlandia', code: 'FI', currencies: ['EUR'] },
        { name: 'Francia', code: 'FR', currencies: ['EUR'] },
        { name: 'Grecia', code: 'GR', currencies: ['EUR'] },
        { name: 'Indonesia', code: 'ID', currencies: ['IDR'] },
        { name: 'Italia', code: 'IT', currencies: ['EUR'] },
        { name: 'Japón', code: 'JP', currencies: ['JPY'] },
        { name: 'México', code: 'MX', currencies: ['MXN'] },
        { name: 'Noruega', code: 'NO', currencies: ['NOK'] },
        { name: 'Nueva Zelanda', code: 'NZ', currencies: ['NZD'] },
        { name: 'Países Bajos', code: 'NL', currencies: ['EUR'] },
        { name: 'Panamá', code: 'PA', currencies: ['USD'] },
        { name: 'Perú', code: 'PE', currencies: ['PEN'] },
        { name: 'Polonia', code: 'PL', currencies: ['PLN'] },
        { name: 'Portugal', code: 'PT', currencies: ['EUR'] },
        { name: 'Reino Unido', code: 'GB', currencies: ['GBP'] },
        { name: 'Suecia', code: 'SE', currencies: ['SEK'] },
        { name: 'Suiza', code: 'CH', currencies: ['CHF'] },
        { name: 'Tailandia', code: 'TH', currencies: ['THB'] },
        { name: 'Uruguay', code: 'UY', currencies: ['UYU'] },
        { name: 'Venezuela', code: 'VE', currencies: ['VES'] }
    ];

    // Monedas de esos países, agrupadas para el selector "Mostrar en".
    const CURRENCIES = [
        { code: 'USD', name: 'Dólar estadounidense', region: 'Américas' },
        { code: 'CAD', name: 'Dólar canadiense', region: 'Américas' },
        { code: 'MXN', name: 'Peso mexicano', region: 'Américas' },
        { code: 'CRC', name: 'Colón costarricense', region: 'Américas' },
        { code: 'COP', name: 'Peso colombiano', region: 'Américas' },
        { code: 'VES', name: 'Bolívar venezolano', region: 'Américas' },
        { code: 'PEN', name: 'Sol peruano', region: 'Américas' },
        { code: 'BRL', name: 'Real brasileño', region: 'Américas' },
        { code: 'ARS', name: 'Peso argentino', region: 'Américas' },
        { code: 'CLP', name: 'Peso chileno', region: 'Américas' },
        { code: 'UYU', name: 'Peso uruguayo', region: 'Américas' },
        { code: 'EUR', name: 'Euro', region: 'Europa' },
        { code: 'GBP', name: 'Libra esterlina', region: 'Europa' },
        { code: 'CHF', name: 'Franco suizo', region: 'Europa' },
        { code: 'DKK', name: 'Corona danesa', region: 'Europa' },
        { code: 'NOK', name: 'Corona noruega', region: 'Europa' },
        { code: 'SEK', name: 'Corona sueca', region: 'Europa' },
        { code: 'PLN', name: 'Esloti polaco', region: 'Europa' },
        { code: 'KRW', name: 'Won surcoreano', region: 'Asia y Oceanía' },
        { code: 'THB', name: 'Baht tailandés', region: 'Asia y Oceanía' },
        { code: 'IDR', name: 'Rupia indonesia', region: 'Asia y Oceanía' },
        { code: 'JPY', name: 'Yen japonés', region: 'Asia y Oceanía' },
        { code: 'AUD', name: 'Dólar australiano', region: 'Asia y Oceanía' },
        { code: 'NZD', name: 'Dólar neozelandés', region: 'Asia y Oceanía' }
    ];

    const catalog = {
        STYLE_GROUPS, STYLE_ALIASES, COUNTRIES, CURRENCIES,
        normalizeKey, styleKeys, styleLabelFor, buildStyleOptions
    };

    if (typeof module === 'object' && module.exports) module.exports = catalog;
    if (root) root.WoRegistroCatalogo = catalog;
})(typeof window !== 'undefined' ? window : null);
