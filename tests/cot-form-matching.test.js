'use strict';
// Frente cot-form · sugerencia de artistas para cotizaciones sin artista
// (lib/artist-matching.js). Decisión del dueño: al cotizar sin artista el
// sistema sugiere artistas por estilo, ciudad, presupuesto y otros datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const matching = require('../lib/artist-matching');

const NOW = Date.parse('2026-11-15T12:00:00Z');

function artist(overrides) {
    return {
        user_id: overrides.user_id,
        username: overrides.username || overrides.user_id,
        name: overrides.name || overrides.user_id,
        registration_status: 'pendiente de validacion',
        styles_array: [],
        city: null,
        ubicacion: null,
        country: null,
        latitude: null,
        longitude: null,
        email: 'privado@example.test',
        whatsapp_number: '+54 11 0000 0000',
        verification_state: 'No',
        profile_picture: null,
        ...overrides
    };
}

const ARTISTS = [
    artist({ user_id: 'a-ba-fine', name: 'Ana', styles_array: ['Fine Line', 'Blackwork'], city: 'Buenos Aires', country: 'Argentina',
        latitude: -34.6, longitude: -58.38, session_price_amount: 150, session_price_currency: 'USD', session_price_amount_usd: 150 }),
    artist({ user_id: 'a-ba-trad', name: 'Beto', styles_array: ['Tradicional'], city: 'Buenos Aires', country: 'Argentina',
        session_price_amount_usd: 900, session_price_currency: 'USD', session_price_amount: 900 }),
    artist({ user_id: 'a-ros-fine', name: 'Caro', styles_array: ['Fine Line'], ubicacion: 'Rosario, Argentina',
        latitude: -32.95, longitude: -60.65, verification_state: 'Yes', session_price_amount_usd: 120 }),
    artist({ user_id: 'a-mx-fine', name: 'Dani', styles_array: ['Fine line'], city: 'Guadalajara', country: 'Mexico' }),
    artist({ user_id: 'a-mvd-anime', name: 'Eli', styles_array: ['Anime'], city: 'Montevideo', country: 'Uruguay' }),
    artist({ user_id: 'a-incompleto', name: 'Fede', styles_array: ['Fine Line'], city: 'Buenos Aires', registration_status: 'incompleto' }),
    artist({ user_id: 'a-sin-user', username: '', name: 'Gabi', styles_array: ['Fine Line'], city: 'Buenos Aires' })
];

const CRITERIA = {
    styles: { style_name: 'Fine Line', style_slug: 'fine-line', styles: [{ style_name: 'Fine Line', style_slug: 'fine-line' }] },
    city_residence: 'Buenos Aires, CABA, Argentina',
    budget_amount: 150,
    budget_currency: 'USD'
};

test('rankea por estilo + ciudad y deja afuera perfiles incompletos o sin usuario', () => {
    const ranked = matching.rankArtists(ARTISTS, CRITERIA, { now: NOW });
    const ids = ranked.map((a) => a.user_id);
    assert.equal(ids[0], 'a-ba-fine', 'estilo exacto + misma ciudad + dentro del presupuesto va primero');
    assert.ok(!ids.includes('a-incompleto'));
    assert.ok(!ids.includes('a-sin-user'));
    // Sin coincidencia de estilo ni de ubicación no se sugiere (Eli: Anime en Montevideo).
    assert.ok(!ids.includes('a-mvd-anime'));
    // Mismo estilo en otro país sí aparece (relevante por estilo), pero atrás.
    assert.ok(ids.indexOf('a-mx-fine') > ids.indexOf('a-ros-fine'));
});

test('la cercanía por coordenadas suma aunque la ciudad tenga otro nombre', () => {
    const ranked = matching.rankArtists(ARTISTS, { ...CRITERIA, city_residence: 'Funes, Santa Fe, Argentina', lat: -32.92, lng: -60.81 }, { now: NOW });
    assert.equal(ranked[0].user_id, 'a-ros-fine');
    assert.equal(ranked[0].match.location, 'city');
    assert.ok(ranked[0].match.distance_km < 25);
});

test('presupuesto: dentro, cerca o por encima de la tarifa del artista', () => {
    const criteria = matching.normalizeCriteria(CRITERIA);
    const within = matching.scoreArtist(ARTISTS[0], criteria, { now: NOW });
    const above = matching.scoreArtist(ARTISTS[1], criteria, { now: NOW });
    assert.equal(within.match.budget, 'within');
    assert.equal(above.match.budget, 'above');
    assert.equal(matching.artistRateIn({ session_price: '300 USD' }, 'USD'), 300);
    assert.equal(matching.artistRateIn({ session_price_amount: 50000, session_price_currency: 'ARS' }, 'ARS'), 50000);
    assert.equal(matching.artistRateIn({ session_price_amount: 50000, session_price_currency: 'ARS' }, 'USD'), null);
});

test('verificado desempata a igual coincidencia', () => {
    const twins = [
        artist({ user_id: 'x1', name: 'Zeta', styles_array: ['Realismo'], city: 'Lima' }),
        // Insignia = verificado + Instagram validado (verified-badge.js).
        artist({ user_id: 'x2', name: 'Alfa', styles_array: ['Realismo'], city: 'Lima', verification_state: 'Yes', instagram: '@alfa.ink', instagram_verified_at: '2026-11-01T00:00:00Z', instagram_verified_handle: 'alfa.ink' })
    ];
    const ranked = matching.rankArtists(twins, { styles: 'realismo', city: 'Lima' }, { now: NOW });
    assert.deepEqual(ranked.map((a) => a.user_id), ['x2', 'x1']);
    assert.equal(ranked[0].verified, true);
});

test('estilos: acentos, guiones y coincidencia parcial', () => {
    const req = matching.extractRequestedStyles([{ style_name: 'Geométrico' }, 'neo-tradicional']);
    assert.equal(matching.styleMatchLevel(req, ['Geometrico']), 1);
    assert.equal(matching.styleMatchLevel(matching.extractRequestedStyles('Neo-Tradicional'), ['Neotradicional']), 1);
    assert.equal(matching.styleMatchLevel(matching.extractRequestedStyles('Micro-realismo'), ['Realismo']), 0.5);
    assert.equal(matching.styleMatchLevel(matching.extractRequestedStyles('Anime'), ['Realismo']), 0);
    // JSON del job board ("[\"Fine line\"]") también se entiende.
    assert.equal(matching.extractRequestedStyles('["Fine line"]')[0].label, 'Fine line');
});

test('la salida no expone email, WhatsApp ni coordenadas', () => {
    const ranked = matching.rankArtists(ARTISTS, CRITERIA, { now: NOW });
    assert.ok(ranked.length > 0);
    for (const s of ranked) {
        const json = JSON.stringify(s);
        assert.doesNotMatch(json, /privado@example|0000 0000|latitude|longitude|-34\.6/);
        // Ronda 2 (P19): etiqueta de recomendado, insignia de embajador y perfil reducido (todo público).
        assert.deepEqual(Object.keys(s).sort(), ['city', 'country', 'match', 'name', 'profile_picture', 'score',
            'session_price_amount', 'session_price_currency', 'studio', 'styles', 'user_id', 'username', 'verified',
            'recommended', 'ambassador', 'years_experience', 'bio', 'portfolio'].sort());
    }
});

test('foto solo https y límite de resultados acotado', () => {
    const many = Array.from({ length: 30 }, (_, i) => artist({ user_id: `m${i}`, styles_array: ['Fine Line'], city: 'Buenos Aires',
        profile_picture: i === 0 ? 'javascript:alert(1)' : `https://cdn.example.test/${i}.jpg` }));
    const ranked = matching.rankArtists(many, CRITERIA, { now: NOW, limit: 99 });
    assert.equal(ranked.length, 12);
    const first = matching.rankArtists([many[0]], CRITERIA, { now: NOW })[0];
    assert.equal(first.profile_picture, null);
});

test('artista de vacaciones hoy queda atrás pero no desaparece', () => {
    const list = [
        artist({ user_id: 'v1', name: 'A', styles_array: ['Fine Line'], city: 'Buenos Aires', vacation_start: '2026-11-10', vacation_end: '2026-11-20' }),
        artist({ user_id: 'v2', name: 'B', styles_array: ['Fine Line'], city: 'Buenos Aires' })
    ];
    const ranked = matching.rankArtists(list, CRITERIA, { now: NOW });
    assert.deepEqual(ranked.map((a) => a.user_id), ['v2', 'v1']);
});

test('excluye ids y tolera entradas basura', () => {
    assert.deepEqual(matching.rankArtists(null, CRITERIA), []);
    assert.deepEqual(matching.rankArtists([null, undefined, {}], CRITERIA), []);
    const ranked = matching.rankArtists(ARTISTS, { ...CRITERIA, exclude: ['a-ba-fine'] }, { now: NOW });
    assert.ok(!ranked.some((a) => a.user_id === 'a-ba-fine'));
    const criteria = matching.normalizeCriteria({ lat: 'x', lng: 200, budget_amount: '-5', budget_currency: 'dólares' });
    assert.equal(criteria.coords, null);
    assert.equal(criteria.budgetAmount, null);
    assert.equal(criteria.budgetCurrency, null);
});

// CF-13: el perfil reducido de los sugeridos sale por un endpoint público. Las
// fotos importadas de Instagram siguen la misma regla que el perfil público
// (gallery-visibility.js): ocultas hasta que el artista valida su cuenta.
test('portfolio de sugeridos: las fotos de Instagram sin validar no se muestran', () => {
    const feed = [
        { url: 'https://cdn.example.test/u/instagram-import/a.jpg', kind: 'image', source: 'instagram', ig_handle: 'ana_ink', caption: 'Importada' },
        { url: 'https://cdn.example.test/u/b.jpg', kind: 'image', category: 'instagram' },
        { url: 'https://cdn.example.test/u/propia.jpg', kind: 'image', category: 'realizados' },
        { url: 'https://cdn.example.test/u/vieja.jpg', kind: 'image', source: 'instagram', ig_legacy: true },
        null, 'https://cdn.example.test/u/suelta.jpg',
    ];
    const names = (a) => matching.portfolioPreview(a).map((item) => item.url.split('/').pop());
    const base = artist({ user_id: 'ig', styles_array: ['Fine Line'], city: 'Buenos Aires', gallery_feed_items: feed });

    // Sin validar (o sin las columnas de validación en la fila): solo lo propio y lo heredado.
    assert.deepEqual(names(base), ['propia.jpg', 'vieja.jpg']);
    assert.deepEqual(names({ ...base, instagram_verified_at: null, instagram_verified_handle: null }), ['propia.jpg', 'vieja.jpg']);
    // Fecha sin cuenta validada, o cuenta sin fecha: sigue sin validar.
    assert.deepEqual(names({ ...base, instagram_verified_at: '2026-11-10T10:00:00Z' }), ['propia.jpg', 'vieja.jpg']);
    assert.deepEqual(names({ ...base, instagram_verified_handle: 'ana_ink' }), ['propia.jpg', 'vieja.jpg']);

    // Validada: aparecen las de esa cuenta (y las que no dicen de qué cuenta vinieron).
    const verified = { ...base, instagram_verified_at: '2026-11-10T10:00:00Z', instagram_verified_handle: '@Ana_Ink' };
    assert.deepEqual(names(verified), ['a.jpg', 'b.jpg', 'propia.jpg', 'vieja.jpg']);
    // Validó OTRA cuenta: la foto importada de ana_ink sigue oculta.
    assert.deepEqual(names({ ...verified, instagram_verified_handle: 'otra_cuenta' }), ['b.jpg', 'propia.jpg', 'vieja.jpg']);

    // gallery_images (ya filtrada por la base) se sigue sumando detrás.
    assert.deepEqual(names({ ...base, gallery_images: ['https://cdn.example.test/u/propia.jpg', 'https://cdn.example.test/u/otra.jpg'] }),
        ['propia.jpg', 'vieja.jpg', 'otra.jpg']);

    // El servidor lee el estado de validación para decidir, pero no lo publica.
    for (const col of ['instagram_verified_at', 'instagram_verified_handle']) assert.match(matching.MATCHING_COLUMNS, new RegExp('\\b' + col + '\\b'));
    const ranked = matching.rankArtists([verified], CRITERIA, { now: NOW });
    assert.equal(ranked.length, 1);
    assert.deepEqual(ranked[0].portfolio.map((item) => item.url.split('/').pop()), ['a.jpg', 'b.jpg', 'propia.jpg', 'vieja.jpg']);
    assert.doesNotMatch(JSON.stringify(ranked[0]), /instagram_verified|ana_ink/i);
    const hidden = matching.rankArtists([base], CRITERIA, { now: NOW })[0];
    assert.deepEqual(hidden.portfolio.map((item) => item.url.split('/').pop()), ['propia.jpg', 'vieja.jpg']);
});
