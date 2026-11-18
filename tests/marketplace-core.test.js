// Lógica pura del marketplace (public/shared/js/marketplace-core.js):
// estilos sin tildes y por catálogo (MK-04), precio sin solapes (MK-05),
// disponibilidad/viajes con Travel y vacaciones (MK-12), ciudades (MK-18),
// estado de estudios (MK-09), búsqueda (MK-13) y paginado (MK-17).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const corePath = path.join(__dirname, '..', 'public', 'shared', 'js', 'marketplace-core.js');
const catalogs = require('../lib/registration-catalogs');

function freshCore() {
    delete require.cache[require.resolve(corePath)];
    return require(corePath);
}

test('la copia local de alias es idéntica a LEGACY_STYLE_ALIASES del servidor', () => {
    const Core = freshCore();
    assert.deepEqual(Core.FALLBACK_ALIASES, JSON.parse(JSON.stringify(catalogs.LEGACY_STYLE_ALIASES)));
    const quick = catalogs.QUICK_STYLES.map((q) => ({ label: q.label, catalog: [...q.catalog] }));
    assert.deepEqual(Core.FALLBACK_QUICK, quick);
});

test('paridad con lib/registration-catalogs: styleMatchKeys y canónica con el catálogo completo', () => {
    const Core = freshCore();
    assert.equal(Core.setStyleCatalog(JSON.parse(JSON.stringify(catalogs.getRegistrationCatalogs()))), true);
    const samples = [
        'Japonés', 'Japones', 'JAPONES', 'Tradicional', 'Neo-Tradicional', 'NEOTRADICIONAL', 'Realismo',
        'REALIMSMO', 'Microrealismo', 'Micro-realismo', 'Black & Grey', 'Geometrico', 'Lettering / Caligrafía',
        'CYBERSIGILISMO', 'FREEHAND', 'Dotwork', 'Fine Line', 'FINELINE', 'Acuarela', 'Estilo propio raro'
    ];
    for (const s of samples) {
        assert.deepEqual(Core.styleMatchKeys(s).sort(), catalogs.styleMatchKeys(s).sort(), s);
        assert.equal(Core.canonicalStyleLabel(s), catalogs.canonicalStyleLabel(s), s);
    }
    for (const style of catalogs.ALL_CATALOG_STYLES) {
        for (const alias of style.aliases) {
            assert.equal(Core.canonicalStyleLabel(alias), catalogs.canonicalStyleLabel(alias), alias);
        }
    }
});

test('con la copia local, los alias históricos resuelven a la misma canónica que el servidor', () => {
    const Core = freshCore();
    for (const [label, aliases] of Object.entries(catalogs.LEGACY_STYLE_ALIASES)) {
        for (const alias of [label, ...aliases]) {
            assert.equal(Core.canonicalStyleLabel(alias), catalogs.canonicalStyleLabel(alias), alias);
        }
    }
});

test('filtro de estilo: Japonés agrupa sus variantes; Tradicional y Realismo no arrastran a otros', () => {
    const Core = freshCore();
    const artists = [
        { id: 1, styles_array: ['Japones'] },
        { id: 2, styles_array: ['JAPONES', 'Blackwork'] },
        { id: 3, styles_array: ['Tradicional Japonés (Irezumi)'] },
        { id: 4, styles_array: ['Neo-Tradicional'] },
        { id: 5, styles_array: ['Tradicional'] },
        { id: 6, styles_array: ['Microrealismo'] },
        { id: 7, styles_array: ['Realismo'] },
        { id: 8, styles_array: 'Hiperrealismo, Dotwork' }
    ];
    const options = Core.buildStyleOptions(artists, (a) => a.styles_array);
    const japones = options.find((o) => o.label === 'Tradicional Japonés (Irezumi)');
    assert.ok(japones, 'opción canónica de japonés');
    assert.equal(japones.count, 3);
    const ids = (key) => artists.filter((a) => Core.hasStyle(a.styles_array, key)).map((a) => a.id);
    assert.deepEqual(ids(japones.value), [1, 2, 3]);
    assert.deepEqual(ids(Core.styleGroupKey('Japonés')), [1, 2, 3]);
    assert.deepEqual(ids(Core.styleGroupKey('Tradicional')), [5]);
    assert.deepEqual(ids(Core.styleGroupKey('Realismo')), [7]);
    assert.deepEqual(ids(Core.styleGroupKey('Neotradicional')), [4]);
    assert.ok(options.some((o) => o.label === 'Dotwork' && o.count === 1), 'estilos fuera del top también son opción');
    assert.ok(options.every((o) => o.count > 0));
});

test('precio: tramos sin solape y sin precio no cae en Económico', () => {
    const Core = freshCore();
    assert.equal(Core.priceBucket(null), null);
    assert.equal(Core.priceBucket(undefined), null);
    assert.equal(Core.priceBucket(''), null);
    assert.equal(Core.priceBucket(0), null);
    assert.equal(Core.priceBucket('abc'), null);
    assert.equal(Core.priceBucket(1), 'low');
    assert.equal(Core.priceBucket(199.99), 'low');
    assert.equal(Core.priceBucket(200), 'medium');
    assert.equal(Core.priceBucket('799'), 'medium');
    assert.equal(Core.priceBucket(800), 'high');
    assert.equal(Core.priceBucket(5000), 'high');
});

test('agenda: banderas independientes, viajes de Travel y vacaciones', () => {
    const Core = freshCore();
    const today = '2026-11-14';
    const agenda = Core.buildAgenda({
        today,
        locations: [
            { artist_user_id: 'a', period_type: 'current', agenda_status: 'open' },
            { artist_user_id: 'b', period_type: 'current', agenda_status: 'closed' },
            { artist_user_id: 'c', period_type: 'upcoming', start_date: '2026-11-10', end_date: '2026-11-20' }
        ],
        trips: [
            { artist_user_id: 'a', start_date: '2026-12-01', end_date: '2026-12-10', city: 'Lisboa' },
            { artist_user_id: 'd', start_date: '2026-11-13', end_date: '2026-11-15' }
        ],
        artists: [
            { user_id: 'e', vacation_start: '2026-11-01', vacation_end: '2026-11-30' },
            { user_id: 'a', vacation_start: '2026-10-01', vacation_end: '2026-10-05' }
        ]
    });
    // Disponible con viaje futuro: aparece en Disponible Y en De viaje pronto.
    assert.equal(Core.matchesAvailability(agenda.a, 'available'), true);
    assert.equal(Core.matchesTravel(agenda.a, 'travelling'), true);
    assert.equal(agenda.a.nextTrip.city, 'Lisboa');
    assert.equal(Core.matchesAvailability(agenda.b, 'booked'), true);
    assert.equal(Core.matchesAvailability(agenda.b, 'available'), false);
    assert.equal(Core.matchesTravel(agenda.c, 'guest'), true);
    assert.equal(Core.matchesTravel(agenda.d, 'guest'), true, 'viaje de Travel en curso = invitado');
    assert.equal(Core.matchesAvailability(agenda.e, 'booked'), true, 'vacaciones = agenda cerrada');
    assert.equal(Core.artistStatus(agenda.e).label, 'De vacaciones');
    assert.equal(Core.artistStatus(agenda.a).label, 'Disponible');
    assert.equal(Core.matchesAvailability(undefined, 'available'), false);
    assert.equal(Core.artistStatus(undefined), null);
});

test('ciudades: sin tildes ni mayúsculas, se muestra la variante más frecuente', () => {
    const Core = freshCore();
    const items = [{ c: 'Bogotá' }, { c: 'bogota' }, { c: 'BOGOTÁ' }, { c: 'Bogotá, Colombia' }, { c: 'Córdoba' }];
    const options = Core.buildCityOptions(items, (i) => Core.cityOf({ city: i.c }));
    assert.equal(options.length, 2);
    assert.equal(options[0].value, 'bogota');
    assert.equal(options[0].count, 4);
    assert.equal(options[0].label, 'Bogotá');
});

test('estudios: invitados, busca artistas y turnos según su roster', () => {
    const Core = freshCore();
    const agenda = Core.buildAgenda({ today: '2026-11-14', locations: [{ artist_user_id: 'x', period_type: 'current', agenda_status: 'open' }] });
    // Sello: verificado y con el Instagram validado (instagram_badge_ok, KYC 2.7.0).
    const open = Core.studioFlags({ accepts_guest_spots: true, guest_window_end: '2027-01-01', is_seeking_artists: true, is_verified: true, instagram_badge_ok: true },
        { today: '2026-11-14', roster: [{ user_id: 'x' }], agenda });
    assert.deepEqual(open, { guests: true, seeking: true, openSlots: true, verified: true });
    assert.equal(Core.studioStatus(open).label, 'Turnos disponibles');
    const closedWindow = Core.studioFlags({ accepts_guest_spots: true, guest_window_end: '2026-01-01' }, { today: '2026-11-14' });
    assert.equal(closedWindow.guests, false, 'ventana de guest vencida');
    assert.equal(Core.studioStatus(Core.studioFlags({}, {})), null);
});

test('búsqueda en vivo: sin tildes y por alias de estilo', () => {
    const Core = freshCore();
    assert.equal(Core.matchesSearch('', ['x']), true);
    assert.equal(Core.matchesSearch('bogota', ['Bogotá']), true);
    assert.equal(Core.matchesSearch('lau', ['Laura Ink', null]), true);
    assert.equal(Core.matchesSearch('irezumi', ['Ana'], ['Japones']), true);
    assert.equal(Core.matchesSearch('zzz', ['Ana'], ['Japones']), false);
});

test('paginado y textos', () => {
    const Core = freshCore();
    assert.deepEqual(Core.pageInfo(50, 24), { shown: 24, remaining: 26, hasMore: true });
    assert.deepEqual(Core.pageInfo(10, 24), { shown: 10, remaining: 0, hasMore: false });
    assert.equal(Core.plural(1, 'artista encontrado', 'artistas encontrados'), '1 artista encontrado');
    assert.equal(Core.plural(0, 'artista encontrado', 'artistas encontrados'), '0 artistas encontrados');
    assert.equal(Core.escapeHtml('<img src=x onerror=1>"\''), '&lt;img src=x onerror=1&gt;&quot;&#39;');
    assert.equal(Core.safeMediaUrl('javascript:alert(1)'), '');
    assert.equal(Core.safeMediaUrl('//evil.com/x.png'), '');
    assert.equal(Core.safeMediaUrl('/shared/a.png'), '/shared/a.png');
    assert.equal(Core.safeMediaUrl('https://x.supabase.co/a.jpg'), 'https://x.supabase.co/a.jpg');
});
