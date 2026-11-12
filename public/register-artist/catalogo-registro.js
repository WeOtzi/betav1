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
        'american traditional': 'Tradicional Americano (Old School)'
    };

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

    const catalog = { STYLE_GROUPS, STYLE_ALIASES, COUNTRIES, CURRENCIES };

    if (typeof module === 'object' && module.exports) module.exports = catalog;
    if (root) root.WoRegistroCatalogo = catalog;
})(typeof window !== 'undefined' ? window : null);
