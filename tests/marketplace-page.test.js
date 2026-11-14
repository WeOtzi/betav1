// Contratos de /marketplace y /explore para la beta cerrada (frente
// marketplace): navegación móvil, menús de filtro como bottom sheet, cards
// como enlaces reales, modo Estudios, verificados, paginado, scripts sin uso,
// supabase-js fijo, capa de datos y geocode sin persistencia.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const html = read('public/marketplace/index.html');
const js = read('public/shared/js/marketplace.js');
const css = read('public/shared/css/marketplace-ds.css');
const exploreHtml = read('public/explore/index.html');
const exploreJs = read('public/shared/js/explore-map.js');

// Bloque CSS de un @media (llaves balanceadas).
function mediaBlock(source, query) {
    const start = source.indexOf(`@media (${query}){`);
    assert.ok(start > -1, `@media (${query})`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('media sin cierre');
}

test('scripts: capa de datos y lógica compartida, sin los que no se usan', () => {
    for (const s of ['/shared/js/data/marketplace-repo.js', '/shared/js/marketplace-core.js', '/shared/js/data/studios-repo.js']) {
        assert.ok(html.includes(`<script src="${s}"></script>`), s);
    }
    for (const unused of ['quotations-repo.js', 'email-client.js', 'currency-utils.js']) {
        assert.ok(!html.includes(unused), `${unused} no se usa en el marketplace`);
    }
    assert.ok(html.indexOf('marketplace-core.js') < html.indexOf('/shared/js/marketplace.js'));
    assert.ok(html.indexOf('marketplace-repo.js') < html.indexOf('/shared/js/marketplace.js'));
    assert.ok(exploreHtml.indexOf('/shared/js/marketplace-core.js') < exploreHtml.indexOf('/shared/js/explore-map.js'));
});

test('supabase-js con versión exacta e igual en marketplace, explore y globo', () => {
    const pages = ['public/marketplace/index.html', 'public/explore/index.html', 'public/explore/globe/index.html'];
    const versions = pages.map((p) => (read(p).match(/@supabase\/supabase-js@([0-9][^"]*)"/) || [])[1]);
    versions.forEach((v, i) => assert.match(String(v), /^\d+\.\d+\.\d+$/, pages[i]));
    assert.equal(new Set(versions).size, 1);
});

test('sin CRUD inline: marketplace.js lee por WeotziData.Marketplace', () => {
    assert.ok(!/WeotziData\s*\.\s*from\s*\(/.test(js), 'nada de WeotziData.from(...) en la página');
    assert.ok(!/\.from\(\s*['"]/.test(js));
    const repo = read('public/shared/js/data/marketplace-repo.js');
    for (const m of ['listArtists', 'listAgenda', 'listUpcomingTrips', 'listReviewSummaries', 'listStudios', 'listStudioLocations', 'listStudioNames']) {
        assert.ok(repo.includes(`${m}(`), m);
    }
    // Ninguna columna privada en las lecturas públicas.
    for (const privateCol of ['email', 'contact_phone', 'verification_reason', 'whatsapp_number', 'birth_date', 'latitude']) {
        assert.ok(!new RegExp(`'${privateCol}'`).test(repo), privateCol);
    }
});

test('navegación: nav del cliente según Figma y menú móvil con hamburguesa', () => {
    for (const href of ['/client/dashboard?tab=solicitudes', '/explore/globe', '/client/chats/']) {
        assert.ok(js.includes(`'${href}'`), href);
    }
    assert.ok(!js.includes("href=\"/job-board\""), 'el Job board del cliente no es el feed de artistas');
    assert.match(html, /id="mk-menu-toggle"[^>]*aria-controls="mk-mobile-menu"/);
    assert.match(html, /<nav class="mk-mobile-menu" id="mk-mobile-menu"[^>]*hidden>/);
    assert.match(html, /href="\/client\/login"[^>]*>Ingresar</);
    assert.match(html, /data-mk-mode="studios"/);
    const mobile = mediaBlock(css, 'max-width:768px');
    assert.match(mobile, /\.mk-burger\{display:inline-flex\}/);
});

test('móvil: los menús de filtro son un bottom sheet fijo (no se recortan en la fila)', () => {
    const mobile = mediaBlock(css, 'max-width:768px');
    assert.match(mobile, /\.mk-filter-menu\{position:fixed;left:0;right:0;bottom:0/);
    assert.match(mobile, /\.mk-filter-menu-head\{display:flex/);
    assert.match(css, /\.mk-filter-menu-head\{display:none\}/);
    assert.match(html, /id="mk-filter-scrim" hidden/);
    assert.match(js, /closeAllFilterMenus\(\{ restoreFocus: true \}\)/, 'Escape devuelve el foco');
    assert.ok(js.includes("e.key !== 'Escape'"));
});

test('cards: enlace real a perfil/estudio, sin navegación por JS y con iniciales escapadas', () => {
    assert.ok(!js.includes('data-card-href'));
    assert.ok(!js.includes('window.location.href = card'));
    assert.match(js, /<a class="mk-card-hit" href="\$\{escapeHtml\(href\)\}"/);
    assert.match(js, /escapeHtml\(getInitials\(artist\.name\)\)/);
    assert.match(js, /escapeHtml\(getInitials\(studio\.name\)\)/);
    assert.match(css, /\.mk-card-hit\{position:absolute;inset:0;z-index:1\}/);
    assert.match(css, /\.mk-card-fav\{[^}]*z-index:2/);
});

test('modo Estudios (Figma 2113:9145): textos, filtros propios, cargar más', () => {
    assert.ok(js.includes("title: 'Descubrí estudios'"));
    assert.ok(js.includes("placeholder: 'Buscar estudios, estilos, ciudades…'"));
    assert.ok(js.includes("{ key: 'services', title: 'Servicios'"));
    assert.ok(js.includes("more: 'Cargar más estudios'"));
    assert.match(html, /id="mk-load-more"/);
    assert.match(css, /\.mk-featured--studios\{background:var\(--yellow-300\)/);
    assert.ok(js.includes('PAGE_SIZE = { artists: 24, studios: 8 }'));
});

test('verificados: sello y filtro en marketplace y explore (VER-A6)', () => {
    assert.ok(js.includes("artist.verification_state === 'Yes'"));
    assert.ok(js.includes('data-verified-toggle'));
    assert.ok(js.includes("verifiedBadge('Estudio verificado')"));
    assert.match(exploreHtml, /id="filter-verified"/);
    assert.match(exploreHtml, /id="modal-verified"/);
    assert.ok(exploreJs.includes("verification_state === 'Yes'"));
});

test('búsqueda en vivo con debounce y vaciado que limpia', () => {
    assert.ok(js.includes('SEARCH_DEBOUNCE_MS = 250'));
    assert.match(js, /input\.addEventListener\('input'/);
    assert.match(html, /<input type="search" id="smart-search"/);
});

test('explore: sin "Desconocido", sin persistir geocodes, mapa cooperativo en móvil y error visible', () => {
    assert.ok(!exploreJs.includes("'Desconocido'"));
    assert.ok(!exploreJs.includes('/api/artists/geocode'));
    assert.ok(!exploreJs.includes('persistGeocode'));
    assert.ok(exploreJs.includes("'cooperative'"));
    assert.ok(exploreJs.includes('data-explore-retry'));
    assert.ok(exploreJs.includes('Core.priceBucket(a.session_price_amount_usd)'));
    assert.ok(exploreJs.includes('explore-card-hit'));
});

test('servidor: POST /api/artists/geocode ya no existe (escribía sin auth con service role)', () => {
    const server = read('server.js');
    assert.ok(!/app\.(post|put|patch)\(\s*['"]\/api\/artists\/geocode/.test(server));
});

test('marketplace: cada filtro de artistas y estudios aplica la regla correcta', () => {
    const Core = require('../public/shared/js/marketplace-core.js');
    const pick = (startMarker, endMarker) => js.slice(js.indexOf(startMarker), js.indexOf(endMarker));
    const src = pick('function artistFlags', '// ============ ESTUDIOS')
        + pick('function artistMatches', 'function applyFilters');
    const agenda = Core.buildAgenda({
        today: '2026-11-14',
        locations: [{ artist_user_id: 'a', period_type: 'current', agenda_status: 'open' }],
        trips: [{ artist_user_id: 'b', start_date: '2027-01-10', end_date: '2027-01-20' }]
    });
    const context = vm.createContext({ Core, INDEPENDENT_KEY: 'independent', favoritesOnly: false, favoriteIds: new Set(), artistAgenda: agenda });
    vm.runInContext(src, context);
    const artists = [
        { user_id: 'a', name: 'Ana', styles_array: ['Japones'], city: 'Bogotá', session_price_amount_usd: 150, studio_id: 's1', _studioName: 'Casa Koi', verification_state: 'Yes' },
        { user_id: 'b', name: 'Beto', styles_array: ['Neo-Tradicional'], city: 'bogota', session_price_amount_usd: null, estudios: 'Sin estudio / Independiente' },
        { user_id: 'c', name: 'Ceci', styles_array: ['Tradicional'], city: 'Lima', session_price_amount_usd: 800, estudios: 'Estudio Sur' }
    ];
    const base = { search: '', style: null, location: null, priceRange: null, availability: null, travel: null, studio: null, verified: false };
    const run = (patch) => artists.filter((a) => context.artistMatches(a, { ...base, ...patch })).map((a) => a.user_id);
    assert.deepEqual(run({}), ['a', 'b', 'c']);
    assert.deepEqual(run({ style: Core.styleGroupKey('Japonés') }), ['a']);
    assert.deepEqual(run({ style: Core.styleGroupKey('Tradicional') }), ['c']);
    assert.deepEqual(run({ location: 'bogota' }), ['a', 'b']);
    assert.deepEqual(run({ priceRange: 'low' }), ['a'], 'sin precio no es Económico');
    assert.deepEqual(run({ priceRange: 'high' }), ['c']);
    assert.deepEqual(run({ studio: 'id:s1' }), ['a']);
    assert.deepEqual(run({ studio: 'independent' }), ['b']);
    assert.deepEqual(run({ studio: `txt:${Core.normalizeKey('Estudio Sur')}` }), ['c']);
    assert.deepEqual(run({ availability: 'available' }), ['a']);
    assert.deepEqual(run({ travel: 'travelling' }), ['b']);
    assert.deepEqual(run({ verified: true }), ['a']);
    assert.deepEqual(run({ search: 'casa koi' }), ['a'], 'busca por estudio real');
    assert.deepEqual(run({ search: 'BOGOTA' }), ['a', 'b']);

    const studios = [
        { id: 's1', name: 'Casa Koi', is_verified: true, _cities: ['Tokio', 'Lima'], _styles: ['Japones'], _flags: { openSlots: true, guests: false, seeking: false }, _services: ['Láser'] },
        { id: 's2', name: 'Ola Norte', is_verified: false, _cities: ['Rosario'], _styles: [], _flags: { openSlots: false, guests: true, seeking: true }, _services: [] }
    ];
    const sbase = { search: '', style: null, location: null, availability: null, services: null, verified: false };
    const srun = (patch) => studios.filter((s) => context.studioMatches(s, { ...sbase, ...patch })).map((s) => s.id);
    assert.deepEqual(srun({ location: 'lima' }), ['s1'], 'cualquier sede, no solo la principal');
    assert.deepEqual(srun({ availability: 'guests' }), ['s2']);
    assert.deepEqual(srun({ services: 'laser' }), ['s1']);
    assert.deepEqual(srun({ verified: true }), ['s1']);
    assert.deepEqual(srun({ style: Core.styleGroupKey('Japonés') }), ['s1']);
    assert.deepEqual(srun({ search: 'rosario' }), ['s2']);
});

test('marketplace: render de card escapa datos de usuario', () => {
    const Core = require('../public/shared/js/marketplace-core.js');
    const start = js.indexOf('function getInitials');
    const initials = js.slice(start, js.indexOf('function showLoading'));
    const cardStart = js.indexOf('function cardMedia');
    const cardEnd = js.indexOf('function studioCardHtml');
    const context = vm.createContext({
        Core, escapeHtml: Core.escapeHtml, favoriteIds: new Set(), artistRatings: {},
        getArtistStatus: () => ({ key: 'available', label: '<b>x</b>' }),
        isVerifiedArtist: () => true, artistStudioLabel: () => '<i>Estudio</i>'
    });
    vm.runInContext(initials + js.slice(cardStart, cardEnd), context);
    const out = context.artistCardHtml({
        user_id: 'u"1', username: 'a&b', name: '<script>alert(1)</script>', styles_array: ['<img src=x>'],
        city: '"><svg onload=1>', profile_picture: 'javascript:alert(1)', gallery_images: ['https://ok.test/a.jpg']
    });
    assert.ok(!out.includes('<script>'), 'nombre escapado');
    assert.ok(!out.includes('<img src=x>'));
    assert.ok(!out.includes('<svg'));
    assert.ok(!out.includes('<b>x</b>'));
    assert.ok(!out.includes('<i>Estudio</i>'));
    assert.ok(!out.includes('javascript:'), 'url peligrosa descartada');
    assert.ok(out.includes('src="https://ok.test/a.jpg"'), 'fallback a la galería pública');
    assert.ok(out.includes('href="/artist/profile?artist=a%26b"'));
    assert.ok(out.includes('Artista verificado'));
});
