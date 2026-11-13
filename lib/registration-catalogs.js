'use strict';

// ===========================================================================
// Catalogos del registro de tatuadores (revision 12 nov 2026, pags. 2 y 5-6).
// ---------------------------------------------------------------------------
// Fuente unica en el servidor para:
//   - la lista rapida de 10 estilos de "Crear cuenta" (orden alfabetico),
//   - el catalogo completo de estilos en 3 grupos (nombres exactos de la
//     revision),
//   - los 32 paises del registro (Estados Unidos, Argentina, Espana primero y
//     el resto alfabetico) con ISO-2 y moneda,
//   - las monedas = solo las de esos paises, sin duplicados.
// Se exponen en GET /api/registration/catalogs.
//
// Compatibilidad: los artistas existentes guardaron etiquetas viejas en
// artists_db.styles_array ("Tradicional", "Japones", "Neo-Tradicional",
// "Black & Grey"...). NO se reescriben: cada estilo nuevo declara `aliases`
// con esas variantes y `styleMatchKeys()` / `canonicalStyleLabel()` permiten
// que busquedas y filtros (explore, marketplace) sigan encontrando a esos
// artistas. lib/expanded-tattoo-styles.js (catalogo historico que usan las
// pantallas de cotizacion/explore) queda intacto.
// ===========================================================================

function normalizeStyleKey(value) {
    return String(value || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function slugify(value) {
    return normalizeStyleKey(value).replace(/\s+/g, '-');
}

// Alias historicos (valores ya guardados en artists_db.styles_array y en
// tattoo_styles) -> etiqueta del catalogo nuevo. Se comparan normalizados
// (sin tildes, sin mayusculas, & = and).
const LEGACY_STYLE_ALIASES = Object.freeze({
    'Realismo': ['REALIMSMO'],
    'Hiperrealismo': [],
    'Microrealismo': ['Micro-realismo', 'Micro realismo'],
    'Fine Line': ['FINELINE', 'Fineline'],
    'Black and Grey': ['Black & Grey', 'Black and Gray', 'Black & Gray'],
    'Tradicional Americano (Old School)': ['Tradicional', 'Tradicional americano', 'Old School', 'American Traditional'],
    'Neotradicional': ['Neo-Tradicional', 'Neo Tradicional', 'NEOTRADICIONAL'],
    'Tradicional Japonés (Irezumi)': ['Japonés', 'Japones', 'Irezumi'],
    'Neojaponés': ['Neo-Japanese', 'Neo Japonés', 'Neojapones'],
    'Geométrico': ['Geometrico'],
    'Lettering': ['Lettering / Caligrafía'],
    'Caligrafía': ['Caligrafia'],
    'Acuarela (Watercolor)': ['Acuarela', 'Watercolor'],
    'Surrealismo': ['Surrealista'],
    'Mandalas': ['Mandala'],
    'Tribal Polinesio': ['Polinesio'],
    'Maorí': ['Maori'],
    'Nórdico': ['Nordico / Viking', 'Nordico'],
    'Grabado (Engraving)': ['Etching / Grabado', 'Grabado'],
    'Xilografía (Woodcut)': ['Woodcut / Xilografia', 'Xilografia', 'Woodcut'],
    'Sketch': ['Sketch / Boceto', 'Boceto'],
    'Gothic Lettering': ['Blackletter / Gotico', 'Blackletter'],
    'Ignorant Style': ['Ignorant'],
    'Biomecánico': ['Biomecanico'],
    'Bioorgánico': ['Bioorganico'],
    'Botánico': ['Ilustracion botanica', 'Fineline botanico'],
    'Art Déco': ['Art Deco'],
    'Retratos': ['Retrato'],
    'Puntillismo Geométrico': ['Pointillism'],
    'Blackwork Ornamental': ['Ornamental Blackwork'],
    'Glitch Tattoo': ['Glitch'],
    'Cibersigilismo (Cybersigilism)': ['CYBERSIGILISMO', 'Cybersigilismo', 'Cybersigilism'],
    'Freehand Abstract': ['FREEHAND', 'Freehand'],
    'Brushstroke': ['Abstract Brush']
});

// Catalogo completo (pags. 5-6), nombres exactos de la revision.
const STYLE_GROUP_DEFINITIONS = [
    {
        id: 'principales',
        label: 'Estilos principales',
        styles: [
            'Realismo', 'Hiperrealismo', 'Microrealismo', 'Fine Line', 'Blackwork', 'Black and Grey',
            'Tradicional Americano (Old School)', 'Neotradicional', 'Tradicional Japonés (Irezumi)', 'Neojaponés',
            'Tribal', 'Geométrico', 'Dotwork', 'Minimalista', 'Ornamental', 'Lettering', 'Caligrafía',
            'Acuarela (Watercolor)', 'Ilustrativo', 'Surrealismo', 'Abstracto', 'New School', 'Trash Polka',
            'Chicano', 'Biomecánico', 'Bioorgánico', 'Anime', 'Manga', 'Dark Art', 'Ignorant Style'
        ]
    },
    {
        id: 'subestilos',
        label: 'Subestilos y especialidades',
        styles: [
            'Realismo a Color', 'Realismo en Negro y Gris', 'Retratos', 'Microtattoo', 'Single Needle', 'Blackout',
            'Negative Space', 'Blackwork Ornamental', 'Blackwork Abstracto', 'Blackwork Geométrico',
            'Geometría Sagrada', 'Mandalas', 'Puntillismo Geométrico', 'Botánico', 'Floral', 'Florales Realistas',
            'Filigrana', 'Ornamental Floral', 'Ornamental Gótico', 'Grabado (Engraving)', 'Xilografía (Woodcut)',
            'Etching', 'Sketch', 'Doodle', 'Linework', 'Línea Continua', 'Fine Script', 'Gothic Lettering',
            'Lettering Experimental', 'Lettering Chicano', 'Caligrafía de Autor', 'Tribal Polinesio', 'Maorí',
            'Samoano', 'Celta', 'Nórdico', 'Viking', 'Tradicional Europeo', 'Art Nouveau', 'Art Déco',
            'Psicodélico', 'Horror', 'Gótico', 'Medieval', 'Kawaii', 'Cartoon', 'Comic', 'Pixel Art', 'Graffiti',
            'Bordado (Embroidery Tattoo)', 'Patch Tattoo', 'Ilusión Óptica (3D)'
        ]
    },
    {
        id: 'tendencias',
        label: 'Estilos y tendencias contemporáneas en auge',
        styles: [
            'Cibersigilismo (Cybersigilism)', 'Neotribal (Neo Tribal)', 'Cyber Tribal', 'Y2K Tattoo',
            'Chrome Tattoo', 'Glitch Tattoo', 'Cyberpunk', 'Techno Ornamental', 'Abstract Flow', 'Fluid Abstract',
            'Brushstroke', 'Patchwork', 'Sticker Sleeve', 'Sticker Tattoo', 'Charm Tattoo', 'Micro Ornamental',
            'Fine Line Ornamental', 'Dark Ornamental', 'Anime Blackwork', 'Nostalgic Realism', 'Ignorant Tattoo',
            'Abstract Blackwork', 'Sigilismo', 'Cyber Gothic', 'Digital Surrealism', 'Anatomical Flow',
            'Freehand Abstract'
        ]
    }
];

function buildStyleEntry(label) {
    return Object.freeze({
        label,
        value: slugify(label),
        aliases: Object.freeze([...(LEGACY_STYLE_ALIASES[label] || [])])
    });
}

const STYLE_GROUPS = Object.freeze(STYLE_GROUP_DEFINITIONS.map(group => Object.freeze({
    id: group.id,
    label: group.label,
    styles: Object.freeze(group.styles.map(buildStyleEntry))
})));

const ALL_CATALOG_STYLES = Object.freeze(STYLE_GROUPS.flatMap(group => group.styles));

// Lista rapida de "Crear cuenta" (pag. 2): estos 10, orden alfabetico.
// `catalog` dice a que entradas del catalogo completo equivale cada una (para
// preseleccionarlas si el tatuador abre "Ver mas estilos").
const QUICK_STYLE_DEFINITIONS = [
    { label: 'Blackwork', catalog: ['Blackwork'] },
    { label: 'Fine Line', catalog: ['Fine Line'] },
    { label: 'Geométrico', catalog: ['Geométrico'] },
    { label: 'Japonés', catalog: ['Tradicional Japonés (Irezumi)'] },
    { label: 'Lettering / Caligrafía', catalog: ['Lettering', 'Caligrafía'] },
    { label: 'Microrealismo', catalog: ['Microrealismo'] },
    { label: 'Minimalista', catalog: ['Minimalista'] },
    { label: 'Neotradicional', catalog: ['Neotradicional'] },
    { label: 'Realismo', catalog: ['Realismo'] },
    { label: 'Tradicional americano', catalog: ['Tradicional Americano (Old School)'] }
];

const QUICK_STYLES = Object.freeze(QUICK_STYLE_DEFINITIONS.map(def => {
    const aliases = new Set();
    def.catalog.forEach(label => {
        aliases.add(label);
        (LEGACY_STYLE_ALIASES[label] || []).forEach(a => aliases.add(a));
    });
    aliases.delete(def.label);
    return Object.freeze({
        label: def.label,
        value: slugify(def.label),
        catalog: Object.freeze([...def.catalog]),
        aliases: Object.freeze([...aliases])
    });
}));

// Indice normalizado: cualquier etiqueta (nueva, rapida o historica) -> etiqueta
// canonica del catalogo completo.
const CANONICAL_INDEX = (() => {
    const index = new Map();
    ALL_CATALOG_STYLES.forEach(style => {
        index.set(normalizeStyleKey(style.label), style.label);
    });
    ALL_CATALOG_STYLES.forEach(style => {
        style.aliases.forEach(alias => {
            const key = normalizeStyleKey(alias);
            if (!index.has(key)) index.set(key, style.label);
        });
    });
    QUICK_STYLES.forEach(quick => {
        const key = normalizeStyleKey(quick.label);
        if (!index.has(key)) index.set(key, quick.catalog[0]);
    });
    return index;
})();

// Etiqueta canonica del catalogo para un valor guardado o elegido; null si es
// un estilo propio ("Otro") que no esta en el catalogo.
function canonicalStyleLabel(value) {
    const key = normalizeStyleKey(value);
    if (!key) return null;
    return CANONICAL_INDEX.get(key) || null;
}

// Claves normalizadas con las que un estilo debe "matchear" en busquedas: la
// etiqueta, su canonica y todos los alias de esa canonica. Un filtro por
// "Japonés" encuentra artistas con "Japones" o "Tradicional Japonés (Irezumi)".
function styleMatchKeys(value) {
    const keys = new Set();
    const own = normalizeStyleKey(value);
    if (!own) return [];
    keys.add(own);
    const canonical = canonicalStyleLabel(value);
    if (canonical) {
        keys.add(normalizeStyleKey(canonical));
        const entry = ALL_CATALOG_STYLES.find(style => style.label === canonical);
        (entry ? entry.aliases : []).forEach(alias => keys.add(normalizeStyleKey(alias)));
    }
    const quick = QUICK_STYLES.find(q => normalizeStyleKey(q.label) === own);
    if (quick) quick.aliases.forEach(alias => keys.add(normalizeStyleKey(alias)));
    return [...keys];
}

function stylesMatch(storedValue, filterValue) {
    const stored = new Set(styleMatchKeys(storedValue));
    return styleMatchKeys(filterValue).some(key => stored.has(key));
}

// Saneo de lo que llega del formulario: recorta, limita largo, deduplica sin
// distinguir mayusculas/tildes y respeta el orden. No traduce valores (los
// estilos propios de "Otro" y los historicos se guardan tal cual).
const MAX_STYLES_PER_ARTIST = 40;
const MAX_STYLE_LENGTH = 60;

function sanitizeStyleList(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of values) {
        if (typeof raw !== 'string') continue;
        const label = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_STYLE_LENGTH).trim();
        const key = normalizeStyleKey(label);
        if (!label || !key || seen.has(key)) continue;
        seen.add(key);
        out.push(label);
        if (out.length >= MAX_STYLES_PER_ARTIST) break;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Paises (pag. 2): Estados Unidos, Argentina y Espana primero; el resto en
// orden alfabetico (es). Moneda = la de uso corriente en el pais (Panama:
// USD, de curso legal junto al balboa).
// ---------------------------------------------------------------------------
const PRIORITY_COUNTRIES = [
    { name: 'Estados Unidos', code: 'US', currency: 'USD' },
    { name: 'Argentina', code: 'AR', currency: 'ARS' },
    { name: 'España', code: 'ES', currency: 'EUR' }
];

const OTHER_COUNTRIES = [
    { name: 'Alemania', code: 'DE', currency: 'EUR' },
    { name: 'Australia', code: 'AU', currency: 'AUD' },
    { name: 'Brasil', code: 'BR', currency: 'BRL' },
    { name: 'Canadá', code: 'CA', currency: 'CAD' },
    { name: 'Chile', code: 'CL', currency: 'CLP' },
    { name: 'Colombia', code: 'CO', currency: 'COP' },
    { name: 'Corea del Sur', code: 'KR', currency: 'KRW' },
    { name: 'Costa Rica', code: 'CR', currency: 'CRC' },
    { name: 'Dinamarca', code: 'DK', currency: 'DKK' },
    { name: 'Finlandia', code: 'FI', currency: 'EUR' },
    { name: 'Francia', code: 'FR', currency: 'EUR' },
    { name: 'Grecia', code: 'GR', currency: 'EUR' },
    { name: 'Indonesia', code: 'ID', currency: 'IDR' },
    { name: 'Italia', code: 'IT', currency: 'EUR' },
    { name: 'Japón', code: 'JP', currency: 'JPY' },
    { name: 'México', code: 'MX', currency: 'MXN' },
    { name: 'Noruega', code: 'NO', currency: 'NOK' },
    { name: 'Nueva Zelanda', code: 'NZ', currency: 'NZD' },
    { name: 'Países Bajos', code: 'NL', currency: 'EUR' },
    { name: 'Panamá', code: 'PA', currency: 'USD' },
    { name: 'Perú', code: 'PE', currency: 'PEN' },
    { name: 'Polonia', code: 'PL', currency: 'PLN' },
    { name: 'Portugal', code: 'PT', currency: 'EUR' },
    { name: 'Reino Unido', code: 'GB', currency: 'GBP' },
    { name: 'Suecia', code: 'SE', currency: 'SEK' },
    { name: 'Suiza', code: 'CH', currency: 'CHF' },
    { name: 'Tailandia', code: 'TH', currency: 'THB' },
    { name: 'Uruguay', code: 'UY', currency: 'UYU' },
    { name: 'Venezuela', code: 'VE', currency: 'VES' }
];

const REGISTRATION_COUNTRIES = Object.freeze(
    PRIORITY_COUNTRIES.concat(OTHER_COUNTRIES).map(country => Object.freeze({ ...country }))
);

const CURRENCY_NAMES = Object.freeze({
    USD: 'Dólar estadounidense',
    ARS: 'Peso argentino',
    EUR: 'Euro',
    AUD: 'Dólar australiano',
    BRL: 'Real brasileño',
    CAD: 'Dólar canadiense',
    CLP: 'Peso chileno',
    COP: 'Peso colombiano',
    KRW: 'Won surcoreano',
    CRC: 'Colón costarricense',
    DKK: 'Corona danesa',
    IDR: 'Rupia indonesia',
    JPY: 'Yen japonés',
    MXN: 'Peso mexicano',
    NOK: 'Corona noruega',
    NZD: 'Dólar neozelandés',
    PEN: 'Sol peruano',
    PLN: 'Esloti polaco',
    GBP: 'Libra esterlina',
    SEK: 'Corona sueca',
    CHF: 'Franco suizo',
    THB: 'Baht tailandés',
    UYU: 'Peso uruguayo',
    VES: 'Bolívar venezolano'
});

// Monedas: solo las de los paises del registro, sin duplicados, en el orden en
// que aparecen sus paises (USD, ARS, EUR primero).
const REGISTRATION_CURRENCIES = Object.freeze((() => {
    const seen = new Set();
    const out = [];
    REGISTRATION_COUNTRIES.forEach(country => {
        if (seen.has(country.currency)) return;
        seen.add(country.currency);
        out.push(Object.freeze({ code: country.currency, name: CURRENCY_NAMES[country.currency] || country.currency }));
    });
    return out;
})());

const COUNTRY_BY_CODE = new Map(REGISTRATION_COUNTRIES.map(c => [c.code, c]));

function countryByCode(code) {
    return COUNTRY_BY_CODE.get(String(code || '').trim().toUpperCase()) || null;
}

function isRegistrationCurrency(code) {
    const upper = String(code || '').trim().toUpperCase();
    return REGISTRATION_CURRENCIES.some(c => c.code === upper);
}

function getRegistrationCatalogs() {
    return {
        version: '2026-11-12',
        styles: {
            quick: QUICK_STYLES,
            groups: STYLE_GROUPS,
            custom_style_warning: 'Un estilo propio puede afectar tu ratio de descubrimiento. Te recomendamos sumar además algún estilo de la lista.'
        },
        countries: REGISTRATION_COUNTRIES,
        currencies: REGISTRATION_CURRENCIES
    };
}

module.exports = {
    QUICK_STYLES,
    STYLE_GROUPS,
    ALL_CATALOG_STYLES,
    LEGACY_STYLE_ALIASES,
    REGISTRATION_COUNTRIES,
    REGISTRATION_CURRENCIES,
    MAX_STYLES_PER_ARTIST,
    MAX_STYLE_LENGTH,
    canonicalStyleLabel,
    countryByCode,
    getRegistrationCatalogs,
    isRegistrationCurrency,
    normalizeStyleKey,
    sanitizeStyleList,
    styleMatchKeys,
    stylesMatch
};
