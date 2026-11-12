// Ronda 3 (12 nov 2026) · grupo "auditoria-fixes" · hallazgos de
// output/figma-v3/reports/auditoria-sesion.md (H1, H3, H4, H5, H7, H8, H9, H10, H11).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const Cobe = require('../public/shared/js/artist-travel-cobe.js');
const Presentation = require('../public/shared/js/artist-profile-presentation.js');
const InboxState = require('../public/shared/js/inbox-response-state.js');
const Places = require('../public/shared/js/place-names.js');
const AppState = require('../public/shared/js/applications-state.js');
const LM = require('../public/shared/js/dashboard-live-model.js');

/* ------------------------------ H1 · Travel ------------------------------ */
const madridTrip = { id: 'trip-madrid', city: 'Madrid', country: 'España', status: 'confirmado', start_date: '2026-12-01', end_date: '2026-12-10' };

test('H1: ciudad base fuera del catálogo usa la sede del estudio base (misma ciudad primero)', () => {
    const route = Cobe.buildTravelRoute({
        artist: { city: 'Pilar', country: 'Argentina', latitude: null, longitude: null },
        trips: [madridTrip],
        baseStudioLocations: [
            { city: 'Buenos Aires', latitude: -34.6092, longitude: -58.4216, is_active: true },
            { city: 'Pilar', latitude: -34.4343, longitude: -58.797, is_active: true },
        ],
    });
    assert.deepEqual(route.base.location, [-34.4343, -58.797]);
    assert.equal(route.base.label, 'Tu base · Pilar');
    assert.equal(route.arcs.length, 1, 'arco desde la base hasta Madrid');
});

test('H1: sin coordenadas ni estudio, cae a la capital del país (nombre o ISO-2)', () => {
    const byName = Cobe.resolveTravelBase({ artist: { city: 'Pilar', country: 'Argentina' } });
    assert.deepEqual(byName.location, [-34.6037, -58.3816]);
    assert.equal(byName.label, 'Tu base · Pilar');
    const byCode = Cobe.resolveTravelBase({ artist: { city: 'Guadalajara', country: '', country_code: 'MX' } });
    assert.deepEqual(byCode.location, [19.4326, -99.1332]);
    const route = Cobe.buildTravelRoute({ artist: { city: 'Pilar', country: 'Argentina' }, trips: [madridTrip] });
    assert.ok(route.base, 'el globo nunca queda sin base si hay país');
    assert.equal(route.arcs.length, 1);
});

test('H1: lat/lng del artista y ciudad geocodificada tienen prioridad sobre el fallback', () => {
    const own = Cobe.resolveTravelBase({ artist: { city: 'Pilar', country: 'Argentina', latitude: -34.45, longitude: -58.9 } });
    assert.deepEqual(own.location, [-34.45, -58.9]);
    const geocoded = Cobe.resolveTravelBase({
        artist: { city: 'Pilar', country: 'Argentina' },
        cityCoordinates: [{ city: 'Pilar', country: 'Argentina', latitude: -34.46, longitude: -58.91 }],
        baseStudioLocations: [{ city: 'Pilar', latitude: -34.4, longitude: -58.7 }],
    });
    assert.deepEqual(geocoded.location, [-34.46, -58.91]);
    assert.equal(Cobe.resolveTravelBase({ artist: {} }), null, 'sin ninguna ubicación declarada no se inventa');
});

test('H1: Travel carga el estudio base y geocodifica la ciudad del artista', () => {
    const src = read('public/shared/js/artist-travel.js');
    assert.match(src, /latitude, longitude, country_code, studio_id/);
    assert.match(src, /listActiveByStudio\(/);
    assert.match(src, /baseStudioLocations: baseStudioCoordinates/);
    assert.match(src, /hydrateArtistBaseCoordinate\(geocoder\)/);
});

/* --------------------------- H4 · Perfil público --------------------------- */
test('H4: iniciales del retrato vacío', () => {
    assert.equal(Presentation.artistInitials('Isaí Nazar', 'neotheonettt.wo'), 'IN');
    assert.equal(Presentation.artistInitials('', 'neotheonettt.wo'), 'NE');
    assert.equal(Presentation.artistInitials('Valentina · Preview', ''), 'VP');
    assert.equal(Presentation.artistInitials('', ''), 'WO');
});

test('H4: estudio base por studio_id y, si no se lee, por membresía activa', () => {
    assert.deepEqual(Presentation.pickBaseStudioIds('s1', [{ studio_id: 's2' }, { studio_id: 's1' }]), ['s1', 's2']);
    assert.deepEqual(Presentation.pickBaseStudioIds(null, [{ studios: { id: 's3' } }]), ['s3']);
    assert.deepEqual(Presentation.pickBaseStudioIds(null, null), []);
});

test('H4: sin foto no hay <img src=""> y se muestran iniciales', () => {
    const html = read('public/artist/profile/index.html');
    assert.doesNotMatch(html, /<img[^>]*src=""[^>]*id="avatar-image"/);
    assert.match(html, /id="avatar-image"[^>]*hidden/);
    assert.match(html, /id="avatar-initials"/);
    const js = read('public/shared/js/artist-profile.js');
    assert.match(js, /function renderAvatarInitials\(/);
    assert.match(js, /renderAvatarInitials\(artisticName\)/);
    assert.match(js, /listActiveForArtist/);
});

test('H4: el demo legacy sirve las presencias públicas derivadas de los viajes de ejemplo', () => {
    global.self = global;
    const F = require('../public/shared/js/wo-demo-fixtures.js');
    (F.EXTENSIONS || []).forEach((name) => {
        try { require(`../public/shared/js/demo-fixtures/${name}.js`); } catch (e) { /* extensión opcional */ }
    });
    const built = (global.WoDemoFixtures || F).build({ userId: 'artista-real', name: 'Artista', username: 'artista.wo' });
    assert.ok(Object.keys(built.tables).includes('artist_public_travel_presences'), 'la vista se sirve desde memoria');
    const rows = built.tables.artist_public_travel_presences;
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((row) => row.artist_user_id === 'artista-real'));
});

/* ------------------------------ H8 · Inbox ------------------------------ */
test('H8: invitación aceptada por mensaje de sistema no queda "Esperando respuesta"', () => {
    const accepted = { lastSenderUserId: null, lastSenderRole: 'system', context: { membership_status: 'active' } };
    assert.equal(InboxState.responseState(accepted, 'u1').key, 'replied');
    const newInvite = { lastSenderUserId: null, lastSenderRole: 'system', context: { membership_status: 'pending_acceptance' } };
    assert.equal(InboxState.responseState(newInvite, 'u1').key, 'waiting');
    const studioWrote = { lastSenderUserId: 'studio', lastSenderRole: 'user', context: { membership_status: 'active' } };
    assert.equal(InboxState.responseState(studioWrote, 'u1').key, 'waiting', 'un mensaje humano posterior sí espera respuesta');
    assert.equal(InboxState.responseState({ lastSenderUserId: 'u1' }, 'u1').key, 'replied');
    assert.equal(InboxState.responseState({ closed: true }, 'u1').key, 'closed');
    // Filas legacy (cotización/soporte) sin rol: siguen la regla anterior.
    assert.equal(InboxState.responseState({ lastSenderUserId: null, context: { status: 'accepted' } }, 'u1').key, 'waiting');
});

test('H8: el inbox carga el helper y marca el rol de sistema en hilos unificados', () => {
    assert.match(read('public/artist/inbox/index.html'), /inbox-response-state\.js[\s\S]*artist-inbox\.js/);
    const js = read('public/shared/js/artist-inbox.js');
    assert.match(js, /lastSenderRole: item\.last_sender_user_id \? 'user'/);
    assert.match(js, /InboxResponseState\.responseState\(row, state\.userId\)/);
});

/* ------------------------- H9 · Ciudades del Job Board ------------------------- */
test('H9: variantes de la misma ciudad se agrupan y se capitalizan en español', () => {
    const options = Places.buildCityOptions(['Cdmx', 'Ciudad De México', 'CDMX', 'mar del plata', 'Mar Del Plata', 'Buenos Aires', 'CABA', null, '']);
    assert.deepEqual(options.map((o) => [o.value, o.label, o.count]), [
        ['buenos aires', 'Buenos Aires', 2],
        ['ciudad de mexico', 'Ciudad de México', 3],
        ['mar del plata', 'Mar del Plata', 2],
    ]);
    assert.equal(Places.spanishTitleCase('SAN JUAN DE LOS LAGOS'), 'San Juan de los Lagos');
    assert.equal(Places.spanishTitleCase('la plata'), 'La Plata');
    assert.equal(Places.cityLabel('rosario'), 'Rosario');
    assert.ok(Places.sameCity('Cdmx', 'ciudad de mexico'));
    assert.ok(!Places.sameCity('Lima', 'ciudad de mexico'));
});

test('H9: el filtro de ciudad del Job Board usa las claves agrupadas', () => {
    assert.match(read('public/job-board/index.html'), /place-names\.js[\s\S]*job-board-feed\.js/);
    const js = read('public/shared/js/job-board-feed.js');
    assert.match(js, /WeotziPlaceNames\.buildCityOptions/);
    assert.match(js, /WeotziPlaceNames\.sameCity\(request\.client_city, currentFilters\.city\)/);
});

/* -------------------- H10 · Confirmaciones "enviada" -------------------- */
test('H10: la confirmación muestra ENVIADA / EN REVISIÓN salvo contraoferta o decisión', () => {
    assert.deepEqual(AppState.sentBadge(null, 'jb'), { key: 'enviada', label: 'Enviada' });
    assert.deepEqual(AppState.sentBadge({ key: 'en_revision' }, 'jb'), { key: 'enviada', label: 'Enviada' });
    assert.deepEqual(AppState.sentBadge('esperando_respuesta', 'spot'), { key: 'en_revision', label: 'En revisión' });
    assert.equal(AppState.sentBadge({ key: 'contraoferta_recibida' }, 'jb').label, 'Contraoferta recibida');
    assert.equal(AppState.sentBadge('confirmada', 'spot').label, 'Confirmada');
    assert.match(read('public/shared/js/job-board-feed.js'), /sentBadge\(proposal\.state, 'jb'\)/);
    assert.match(read('public/shared/js/studio-spots-directory.js'), /sentBadge\(state, 'spot'\)/);
});

test('H10: los deep links de QA de las confirmaciones apuntan a postulaciones sin contraoferta', () => {
    const screens = JSON.parse(read('output/figma-v2/screens.json'));
    const byNode = Object.fromEntries(screens.map((s) => [s.node, s.url]));
    assert.match(byNode['801:1069'], /JB-59407&estado=enviada/);
    assert.match(byNode['801:539'], /b10000000002&estado=enviada/);
});

/* ------------------------------ Dashboard ------------------------------ */
test('H3: los hitos no se evalúan en modo demo ni se disparan dos veces', () => {
    const js = read('public/shared/js/dashboard.js');
    const body = js.slice(js.indexOf('async function trackMilestone('), js.indexOf('async function shareProfile('));
    assert.match(body, /window\.WoDemo\?\.enabled\) return/);
    assert.match(body, /milestonesInFlight\.has\(milestoneField\)/);
    assert.match(body, /finally \{\s*milestonesInFlight\.delete\(milestoneField\)/);
});

test('H5: el saludo cuenta los turnos con clientes de todo el día, incluido el que está en curso', () => {
    const now = new Date(2026, 10, 12, 10, 20);
    const at = (h, m) => new Date(2026, 10, 12, h, m).toISOString();
    const sessions = [
        { id: 1, session_date: at(10, 0), status: 'scheduled', duration_hours: 3, quotations_db: { client_full_name: 'Sofía Martínez' } },
        { id: 2, session_date: at(13, 30), status: 'scheduled', duration_hours: 2, quotations_db: { client_full_name: 'Nico' } },
        { id: 3, session_date: at(16, 0), status: 'rescheduled', duration_hours: 1, quotations_db: { client_full_name: 'Ana' } },
        { id: 4, session_date: at(18, 30), status: 'scheduled', duration_hours: 0.75, quotations_db: { client_full_name: 'Juan' } },
    ];
    const events = [{ id: 'e1', event_type: 'personal', title: 'Bloque de dibujo', starts_at: at(8, 0), ends_at: at(9, 0) }];
    const agenda = LM.mergeAgenda(sessions, events, now, (v) => v);
    assert.equal(agenda.todayCount, 4, 'mismo número que los 4 turnos de la vista día del calendario');
    assert.equal(agenda.items.length, 5, 'el evento personal se lista pero no cuenta como sesión');
    assert.match(read('public/shared/js/dashboard-redesign.js'), /fetchAgendaRows\(dayStart\.toISOString\(\)\)/);
});

test('H11: el paso 02 de importar IG usa el handle del artista', () => {
    const js = read('public/shared/js/instagram-import.js');
    const body = js.slice(js.indexOf('openSample(step) {'), js.indexOf('buildItems() {'));
    assert.match(body, /sampleHandle\(this\.handle/);
    assert.match(body, /if \(ownHandle\) sample\.username = ownHandle/);
    assert.match(read('public/shared/js/dashboard.js'), /getHandle: \(\) => \(artistData\?\.instagram/);
});

test('H7: la sugerencia del demo va en un lugar reservado del dashboard, no flotando', () => {
    assert.match(read('public/artist/dashboard/index.html'), /data-wo-demo-suggest-slot/);
    const js = read('public/shared/js/wo-demo.js');
    assert.match(js, /querySelector\('\[data-wo-demo-suggest-slot\]'\)/);
    assert.match(js, /wo-demo-suggest--inline/);
    const css = read('public/shared/css/wo-onboarding.css');
    assert.match(css, /\.wo-demo-suggest\.wo-demo-suggest--inline\{\s*position:static/);
    assert.match(css, /html\.wo-tour-active body \.wo-demo-suggest\.wo-demo-suggest--inline\{display:none\}/);
});
