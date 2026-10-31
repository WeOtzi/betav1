'use strict';
// Área perfil-estadisticas · Figma final del flujo de artista (oct 2026)
//   801:1108 Perfil público - Artista y portafolio → /artist/profile
//   801:543  Estadísticas - Actividad y conversión → /my-quotations/statistics
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const Presentation = require('../public/shared/js/artist-profile-presentation');
const StatsFormat = require('../public/shared/js/statistics-format');

const GALLERY_CATEGORIES = { realizados: 'Realizados', flash: 'Flash', proyectos: 'Proyectos' };

test('portafolio: la categoría que no es de galería se lee como estilo (filtros por estilo del Figma)', () => {
    assert.deepEqual(
        Presentation.galleryItemStyles({ category: 'Fine line', styles: ['fine line', 'Blackwork'] }, GALLERY_CATEGORIES),
        ['fine line', 'Blackwork']
    );
    assert.deepEqual(Presentation.galleryItemStyles({ category: 'Botánico' }, GALLERY_CATEGORIES), ['Botánico']);
    assert.deepEqual(Presentation.galleryItemStyles({ category: 'flash', style: 'Dotwork' }, GALLERY_CATEGORIES), ['Dotwork']);
    assert.deepEqual(Presentation.galleryItemStyles({ category: 'realizados' }, GALLERY_CATEGORIES), []);
    assert.deepEqual(Presentation.galleryItemStyles(null, GALLERY_CATEGORIES), []);
});

test('residencias: rango de fechas del Figma ("12 – 18 oct" y meses cruzados)', () => {
    assert.equal(Presentation.formatResidencyRange('2026-10-12', '2026-10-18'), '12 – 18 oct');
    assert.equal(Presentation.formatResidencyRange('2026-10-28', '2026-11-04'), '28 oct – 4 nov');
    assert.equal(Presentation.formatResidencyRange(null, '2026-10-04'), '');
});

test('residencias: solo tramos con fecha y vigentes, con país, estados del Figma y viajes de Travel', () => {
    const rows = Presentation.buildResidencyRows([
        { city: 'Buenos Aires', studio_name: 'Base', agenda_status: 'open', start_date: null, end_date: null },
        { city: 'Madrid', country: 'España', studio_name: 'La Nave', agenda_status: 'open', start_date: '2026-11-12', end_date: '2026-11-18' },
        { city: 'Madrid', country: 'España', studio_name: 'Duplicada', agenda_status: 'open', start_date: '2026-11-12', end_date: '2026-11-18' },
        { city: 'París', agenda_status: 'waitlist', start_date: '2026-12-04', end_date: '2026-12-10' },
        { city: 'Lima', agenda_status: 'open', start_date: '2026-09-01', end_date: '2026-09-10' },
        { city: 'Berlín', country: 'Alemania', agenda_status: 'closed', start_date: '2027-01-02', end_date: '2027-01-08' }
    ], [
        { city: 'Barcelona', country: 'España', start_date: '2026-12-02', end_date: '2026-12-06', studio_name: 'Zorro Rojo' },
        { city: 'París', country: 'Francia', start_date: '2026-12-04', end_date: '2026-12-10', studio_name: 'Atelier' },
        { city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-20', end_date: '2026-11-03' }
    ], { today: '2026-10-28', base: { city: 'Buenos Aires', country: 'Argentina' } });

    assert.deepEqual(rows.map((row) => [row.city, row.country, row.state, row.label, row.dates]), [
        ['Montevideo', 'Uruguay', 'open', 'Agenda abierta', '20 oct – 3 nov'],
        ['Madrid', 'España', 'open', 'Agenda abierta', '12 – 18 nov'],
        ['Barcelona', 'España', 'upcoming', 'Próximamente', '2 – 6 dic'],
        ['París', 'Francia', 'waitlist', 'Lista de espera', '4 – 10 dic'],
        ['Berlín', 'Alemania', 'upcoming', 'Próximamente', '2 – 8 ene']
    ]);
    assert.equal(rows.find((row) => row.city === 'París').venue, 'Atelier');
});

test('dónde tatué: base + lugares ya iniciados, nunca residencias futuras', () => {
    const cities = Presentation.buildVisitedCities('Buenos Aires', [
        { city: 'Buenos Aires', start_date: null },
        { city: 'Ciudad de México', start_date: '2026-10-20' },
        { city: 'Berlín', start_date: '2027-01-02' },
        { city: 'Sin ciudad' }
    ], [
        { city: 'Montevideo', start_date: '2026-03-01' },
        { city: 'Barcelona', start_date: '2026-12-02' }
    ], { today: '2026-10-28' });
    assert.deepEqual(cities, ['Buenos Aires', 'Ciudad de México', 'Montevideo']);
});

test('estadísticas: formatos del Figma (ingresos, tiempos relativos, ordinal y fecha)', () => {
    assert.equal(StatsFormat.formatKpiMoney(3150000, 'ARS'), '$3,15M');
    assert.equal(StatsFormat.formatKpiMoney(310000, 'ARS'), '$310.000');
    assert.equal(StatsFormat.formatKpiMoney(4820, 'USD'), 'US$4.820');

    const now = new Date(2026, 9, 28, 15, 0, 0);
    assert.equal(StatsFormat.formatActivityTime(new Date(2026, 9, 28, 14, 0), now), 'Hace 1 hora');
    assert.equal(StatsFormat.formatActivityTime(new Date(2026, 9, 28, 12, 0), now), 'Hace 3 horas');
    assert.equal(StatsFormat.formatActivityTime(new Date(2026, 9, 27, 18, 40), now), 'Ayer, 18:40');
    assert.equal(StatsFormat.formatActivityTime(new Date(2026, 9, 26, 10, 0), now), 'Hace 2 días');
    assert.equal(StatsFormat.formatVisitorTime(new Date(2026, 9, 27, 10, 0), now), 'Hace 1 día');
    assert.equal(StatsFormat.formatVisitorTime(new Date(2026, 9, 21, 10, 0), now), 'Hace 7 días');
    assert.equal(StatsFormat.visitOrdinal(3), '3ª');
    assert.equal(StatsFormat.formatDayMonth('2026-08-12'), '12 de agosto');
    assert.equal(StatsFormat.initialsOf('Valentina Cruz'), 'VC');
});

test('perfil público: página alineada al frame 801:1108 (sin redes, sin "ver galería", reserva amarilla)', () => {
    const html = read('public', 'artist', 'profile', 'index.html');
    const js = read('public', 'shared', 'js', 'artist-profile.js');
    const css = read('public', 'shared', 'css', 'artist-profile.css');

    assert.doesNotMatch(html, /gallery-view-all-btn/);
    assert.doesNotMatch(js, /getGalleryFeedUrl|gallery\?artist=/);
    assert.doesNotMatch(js, /MAX_GALLERY_SLOTS/);
    assert.match(html, /wo-btn--accent wo-btn--s wo-btn--hard actionbar-btn/);
    assert.match(js, /Foto de portafolio/);
    assert.match(js, /buildResidencyRows\(tattooLocations, travelPresences/);
    assert.match(js, /presence-country/);
    assert.match(js, /isIntro && option\.value === GALLERY_ALL_FILTER \? 'Todo'/);
    assert.match(css, /Figma final 801:1108/);
    assert.match(css, /#profile-content\s*\{\s*align-content:\s*start;/);
    assert.match(css, /\.public-profile-view a\.wo-btn\s*\{\s*color:\s*var\(--action-primary-fg\)/);
});

test('estadísticas: página alineada al frame 801:543 y datos por la capa PostgREST', () => {
    const html = read('public', 'my-quotations', 'statistics', 'index.html');
    const js = read('public', 'shared', 'js', 'statistics.js');
    const css = read('public', 'shared', 'css', 'statistics.css');

    assert.match(html, /class="qadmin-main stats-main"/);
    assert.match(html, /data-wo-icon="external-link"[^>]*><\/i>Exportar informe/);
    assert.match(html, /\/shared\/js\/statistics-format\.js/);
    assert.match(html, /\/shared\/js\/data\/profile-public-repo\.js/);
    assert.doesNotMatch(js, /createClient\(/);
    assert.match(js, /ConfigManager\.ready\(\)/);
    assert.match(js, /listJobBoardApplications/);
    assert.match(js, /visitó tu perfil por/);
    assert.match(js, /stats-visitor-name-line/);
    assert.match(js, /'bar-chart-2'/);
    assert.match(css, /Figma final 801:543/);
    assert.match(css, /\.stats-main\s*\{[\s\S]*?max-width:\s*1280px/);
    assert.match(css, /#evolution-metrics \.q-chip\.is-active\s*\{[\s\S]*?box-shadow:\s*3px 3px 0 var\(--neutral-500\)/);
});

test('repo del área: degrada sin lanzar y reintenta residencias sin la columna country', async () => {
    const calls = [];
    const makeQuery = (table) => {
        const state = { table, columns: '' };
        const builder = {
            select(columns) { state.columns = columns; calls.push(`${table}:${columns}`); return builder; },
            eq() { return builder; },
            order() { return builder; },
            limit() { return builder; },
            then(resolve) {
                if (table === 'artist_tattoo_locations' && /country/.test(state.columns)) {
                    return resolve({ data: null, error: { message: 'column country does not exist' } });
                }
                if (table === 'job_board_applications') return resolve({ data: null, error: { message: 'RLS' } });
                return resolve({ data: [{ city: 'Madrid' }], error: null });
            }
        };
        return builder;
    };
    const sandbox = {
        WeotziData: {
            from: makeQuery,
            getClient: () => ({ rpc: async () => ({ data: null, error: { message: 'missing' } }) })
        },
        console: { warn() {} }
    };
    sandbox.window = sandbox;
    const vm = require('node:vm');
    vm.runInNewContext(read('public', 'shared', 'js', 'data', 'profile-public-repo.js'), sandbox);
    const repo = sandbox.WeotziData.ProfilePublic;

    assert.deepEqual(await repo.listResidencies('u1'), [{ city: 'Madrid' }]);
    assert.equal(calls.filter((c) => c.startsWith('artist_tattoo_locations')).length, 2);
    assert.equal(JSON.stringify(await repo.listJobBoardApplications('u1')), '[]');
    assert.equal(await repo.getPreferences('u1'), null);
    assert.equal(JSON.stringify(await repo.listTravelPresences('')), '[]');
});

test('backend: migración aditiva con rollback (país y lista de espera en residencias)', () => {
    const migration = read('supabase', 'migrations', '20261028160000_artist_residency_country_waitlist.sql');
    const rollback = read('supabase', 'rollbacks', '20261028160000_artist_residency_country_waitlist.down.sql');
    assert.match(migration, /add column if not exists country text/i);
    assert.match(migration, /check \(agenda_status in \('open', 'closed', 'waitlist'\)\)/i);
    assert.match(migration, /enable row level security/i);
    assert.match(rollback, /set agenda_status = 'open'[\s\S]*where agenda_status = 'waitlist'/i);
    assert.match(rollback, /drop column if exists country/i);
});

test('fixtures del preview: enriquecen al asignar y encadenan con otra área', () => {
    const vm = require('node:vm');
    const sandbox = {};
    sandbox.self = sandbox;
    vm.runInNewContext(read('public', 'shared', 'js', 'demo-fixtures', 'perfil-estadisticas.js'), sandbox);
    const ext = sandbox.WoDemoFixtureExtensions['perfil-estadisticas'];

    const tables = {
        studios: [{ id: 'studio-1', slug: 'la-aguja-negra', country: 'Argentina' }],
        artist_trips: [{ id: 't1', status: 'confirmado', city: 'Barcelona', country: 'España', start_date: '2026-12-01', end_date: '2026-12-05' }],
        trip_studio_links: [{ trip_id: 't1', status: 'confirmada', studio_id: 'studio-1', studio_name: 'Zorro Rojo', studio_city: 'Barcelona' }]
    };
    // Otra área ya interceptó artist_tattoo_locations (patrón de demo-fixtures/cuenta.js).
    Object.defineProperty(tables, 'artist_tattoo_locations', {
        configurable: true,
        enumerable: false,
        get() { return undefined; },
        set(rows) {
            Object.defineProperty(tables, 'artist_tattoo_locations', {
                value: rows.concat([{ id: 'otra-area', city: 'Berlín' }]), writable: true, enumerable: true, configurable: true
            });
        }
    });

    ext({ tables, identity: { userId: 'u1' } });
    assert.equal(Object.keys(tables).includes('artists_db'), false);

    tables.artists_db = [{ user_id: 'u1', username: 'demo.wo' }];
    tables.artist_tattoo_locations = [{ id: 'base', city: 'Buenos Aires' }];
    tables.artist_public_travel_presences = [];

    assert.equal(tables.artists_db[0].studio_id, 'studio-1');
    assert.deepEqual(Array.from(tables.artists_db[0].languages), ['Español', 'English', 'Italiano']);
    assert.deepEqual(tables.artist_tattoo_locations.map((row) => row.id), ['base', 'otra-area', 'perfil-residencia-paris']);
    assert.equal(tables.artist_tattoo_locations[0].agenda_status, 'open');
    assert.equal(tables.artist_public_travel_presences.length, 1);
    assert.equal(tables.artist_public_travel_presences[0].city, 'Barcelona');
});

// ---------------------------------------------------------------------------
// Corrección ronda 1 (auditoría independiente 801:1108 / 801:543)
// ---------------------------------------------------------------------------

test('perfil · ficha "Sobre el artista": "8 años tatuando" y "$180 USD" (Figma 344:1391/1401)', () => {
    assert.equal(Presentation.formatExperienceFact(8), '8 años tatuando');
    assert.equal(Presentation.formatExperienceFact('5'), '5 años tatuando');
    assert.equal(Presentation.formatExperienceFact('1'), '1 año tatuando');
    assert.equal(Presentation.formatExperienceFact('5-10'), '5-10 años tatuando');
    assert.equal(Presentation.formatExperienceFact('10+ años'), '10+ años tatuando');
    assert.equal(Presentation.formatExperienceFact('8 años tatuando'), '8 años tatuando');
    assert.equal(Presentation.formatExperienceFact(''), '');
    assert.equal(Presentation.formatExperienceFact(null), '');

    assert.equal(Presentation.formatSessionPriceFact('180 USD'), '$180 USD');
    assert.equal(Presentation.formatSessionPriceFact('usd 180'), '$180 USD');
    assert.equal(Presentation.formatSessionPriceFact('150 EUR'), '€150 EUR');
    assert.equal(Presentation.formatSessionPriceFact('90000 ARS'), '$90000 ARS');
    assert.equal(Presentation.formatSessionPriceFact('200 XYZ'), '200 XYZ');
    assert.equal(Presentation.formatSessionPriceFact('A convenir'), 'A convenir');
    assert.equal(Presentation.formatSessionPriceFact(''), '');
});

test('perfil · panel Estudio: ARTISTAS cuenta el roster activo y al propio artista sin repetir', () => {
    const roster = [
        { status: 'active', artists_db: { user_id: 'a1' } },
        { status: 'active', artist_user_id: 'a2' },
        { status: 'active', artists_db: { user_id: 'a1' } },
        { status: 'active', artists_db: null }
    ];
    assert.equal(Presentation.studioRosterCount(roster, 'yo'), 4);
    assert.equal(Presentation.studioRosterCount(roster, 'a2'), 3);
    assert.equal(Presentation.studioRosterCount([], 'yo'), 1);
    assert.equal(Presentation.studioRosterCount(null, null), 0);
});

test('perfil · reseñas, estudio y CTA alineados al Figma (autor en dos líneas, avatares, círculo, enlace)', () => {
    const js = read('public', 'shared', 'js', 'artist-profile.js');
    const css = read('public', 'shared', 'css', 'artist-profile.css');
    assert.match(js, /<span class="review-quote-who">/);
    assert.match(js, /review-quote-avatar\$\{index % REVIEW_AVATAR_COLORS\.length === 1 \? ' is-round' : ''\}/);
    assert.match(js, /studioRosterCount\(roster, artistUserId\)/);
    assert.match(css, /\.review-quote-who\s*\{\s*display:\s*flex;\s*flex-direction:\s*column/);
    assert.match(css, /\.review-quote-avatar\s*\{[^}]*font-family:\s*var\(--font-display\)[^}]*font-size:\s*12px/);
    assert.match(css, /\.reviews-panel-block\s*\{[^}]*width:\s*150px[^}]*background:\s*color-mix\(in srgb, var\(--ink\) 12%, transparent\)/);
    assert.match(css, /\.studio-panel\s*\{[^}]*justify-content:\s*center/);
    assert.match(css, /\.studio-panel \.studio-link\s*\{[^}]*margin-top:\s*30px[^}]*border-bottom:\s*1\.6px solid var\(--yellow-300\)/);
    assert.match(css, /\.studio-facts\s*\{[^}]*margin:\s*26px 0 0/);
    assert.match(css, /\.hero-cta-row \.wo-btn,\s*\.cta-actions \.cta-btn\s*\{[^}]*height:\s*52px[^}]*letter-spacing:\s*0\.08em/);
    assert.doesNotMatch(css, /\.studio-panel \.studio-link\s*\{[^}]*margin-top:\s*auto/);
});

test('fixtures del preview: La Aguja Negra con roster activo (Figma "6 residentes" con el artista)', () => {
    const vm = require('node:vm');
    const sandbox = {};
    sandbox.self = sandbox;
    vm.runInNewContext(read('public', 'shared', 'js', 'demo-fixtures', 'perfil-estadisticas.js'), sandbox);
    const ext = sandbox.WoDemoFixtureExtensions['perfil-estadisticas'];
    const tables = {
        studios: [{ id: 'studio-1', slug: 'la-aguja-negra', city: 'Buenos Aires', country: 'Argentina', primary_location_id: 'loc-1' }],
        studio_artist_memberships: [{ id: 'm-pend', studio_id: 'studio-1', artist_user_id: 'u1', status: 'pending_acceptance' }]
    };
    const TABLES = ['studios'];
    ext({ tables, identity: { userId: 'u1' }, TABLES });
    ext({ tables, identity: { userId: 'u1' }, TABLES });

    const active = tables.studio_artist_memberships.filter((m) => m.studio_id === 'studio-1' && m.status === 'active');
    assert.equal(active.length, 5);
    assert.equal(tables.artists_db_roster_demo.length, 5);
    assert.ok(active.every((m) => tables.artists_db_roster_demo.some((a) => a.user_id === m.artist_user_id)));
    assert.equal(tables.studio_artist_memberships.find((m) => m.id === 'm-pend').status, 'pending_acceptance');
    assert.ok(TABLES.includes('artists_db_roster_demo'));
    assert.equal(Presentation.studioRosterCount(active, 'u1'), 6);
});

test('estadísticas · KPI de ingresos compacto a 40px y embudo sin tasas mayores a 100%', () => {
    assert.equal(StatsFormat.formatKpiMoneyCompact(4890, 'USD'), 'US$4,9K');
    assert.equal(StatsFormat.formatKpiMoneyCompact(3820, 'USD'), 'US$3,8K');
    assert.equal(StatsFormat.formatKpiMoneyCompact(310000, 'ARS'), '$310K');
    assert.equal(StatsFormat.formatKpiMoneyCompact(3150000, 'ARS'), '$3,15M');
    assert.equal(StatsFormat.formatKpiMoneyCompact(999960, 'ARS'), '$1,00M');
    assert.equal(StatsFormat.formatKpiMoneyCompact(820, 'USD'), 'US$820');
    assert.equal(StatsFormat.formatKpiMoneyCompact(0, 'USD'), 'US$0');

    assert.equal(StatsFormat.funnelRate(43, 13), 30);
    assert.equal(StatsFormat.funnelRate(13, 17), 100);
    assert.equal(StatsFormat.funnelRate(0, 5), null);
    assert.equal(StatsFormat.funnelRate(10, 0), 0);
});

test('estadísticas · flechas Feather, chip "Ingresos (miles)" en miles y oportunidades que dicen lo que miden', () => {
    const html = read('public', 'my-quotations', 'statistics', 'index.html');
    const js = read('public', 'shared', 'js', 'statistics.js');
    const css = read('public', 'shared', 'css', 'statistics.css');
    assert.match(js, /data-wo-icon="\$\{up \? 'arrow-up-right' : 'arrow-up-left'\}"/);
    assert.doesNotMatch(css, /\.kpi-trend[^{]*::before/);
    assert.match(js, /label: 'Ingresos \(miles\)'[\s\S]*?total \/ 100\) \/ 10/);
    assert.match(js, /es el estilo más pedido en tus solicitudes/);
    assert.match(js, /es la ciudad que más te escribe/);
    assert.doesNotMatch(js, /con mayor crecimiento en tus visitas|convierten mejor que el resto/);
    assert.match(js, /funnelStepRate\(step\.value, next\.value\)/);
    assert.match(js, /borderWidth: 3/);
    assert.match(js, /`ESTADÍSTICAS · \$\{MONTH_NAMES/);
    assert.match(html, /chart\.js@4\.4\.1\/dist\/chart\.umd\.min\.js/);
    assert.match(html, /<div class="stats-hero-main">[\s\S]*?class="q-hero-sub"[\s\S]*?<\/div>\s*<button type="button" class="q-hero-btn" id="export-report-btn">/);
    assert.match(css, /\.perf-title\s*\{[^}]*font-weight:\s*var\(--weight-regular\)[^}]*letter-spacing:\s*0\.1em/);
    assert.match(css, /\.perf-lower-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});

test('copy con acentos en el widget compartido de reseñas y en el recorrido guiado', () => {
    const reviews = read('public', 'shared', 'js', 'reviews.js');
    const tour = read('public', 'shared', 'js', 'wo-tour-steps.js');
    for (const literal of ['Reputación pública', 'Filtrar reseñas por calificación', 'Cargando reseñas', 'Paginación de reseñas', "'reseña' : 'reseñas'", "'estrella' : 'estrellas'"]) {
        assert.ok(reviews.includes(literal), literal);
    }
    assert.doesNotMatch(reviews, /Reputacion publica|resenas|Resenas|calificacion\b/);
    assert.match(tour, /filtrable por estilo/);
    assert.match(tour, /desde la visita hasta el trabajo realizado/);
});
