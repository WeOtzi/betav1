const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Figma final del flujo de artista · área invitaciones (2007:5792–5795).
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const M = require('../public/shared/js/invitations-model.js');

const NOW = new Date('2026-10-28T12:00:00');

test('fechas cortas, rangos y día relativo con el formato del Figma', () => {
    assert.equal(M.shortDate('2026-07-08'), '08 jul');
    assert.equal(M.rangeLabel('2026-09-28', '2026-10-11'), '28 sep – 11 oct');
    assert.equal(M.longDate('2026-08-03'), '3 de agosto, 2026');
    assert.equal(M.relativeDay('2026-10-28T08:00:00', NOW), 'hoy');
    assert.equal(M.relativeDay('2026-10-27T20:00:00', NOW), 'ayer');
    assert.equal(M.relativeDay('2026-07-08T10:00:00', NOW), 'el 08 JUL');
    assert.equal(M.splitLabel(50), 'Comisión 50/50');
    assert.equal(M.splitLabel(60), 'Comisión 40/60');
});

test('líneas de invitación y de contacto del mapa y del detalle de estudio', () => {
    const membership = { status: 'active', invited_at: '2026-07-08T12:00:00' };
    assert.equal(M.invitationLine(membership), 'Te invitó el 08 JUL · aceptada.');
    assert.equal(M.invitationLine(membership, 'detail'), 'Te invitó el 08 JUL · la aceptaste');
    const thread = { id: 't1', context_type: 'studio_contact', context_id: 's1', last_message_at: '2026-10-28T09:00:00', context: { reason: 'guest_spot' } };
    const summary = M.contactSummary(thread, NOW);
    assert.equal(summary.sentence, 'Le escribiste hoy.');
    assert.equal(summary.summary, 'Le escribiste hoy · Guest spot');
    assert.equal(summary.threadId, 't1');
    const byStudio = M.contactsByStudio([thread, { id: 't2', context_type: 'studio', context_id: 's1' }]);
    assert.deepEqual(Object.keys(byStudio), ['s1']);
});

test('oportunidades: spots abiertos primero, columnas del estudio como respaldo', () => {
    const studio = { id: 's1', accepts_guest_spots: false, is_seeking_artists: true, default_revenue_split_pct: 50, artist_requirements: ['NIE o permiso de trabajo en España'] };
    const spots = [{ studio_id: 's1', kind: 'guest_spot', status: 'open', start_date: '2026-11-27', end_date: '2026-12-10' }];
    const opp = M.opportunitiesFor(studio, spots, NOW);
    assert.equal(opp.guest.open, true);
    assert.equal(opp.guest.dates, '27 nov – 10 dic');
    assert.equal(opp.resident.open, true);
    assert.equal(opp.resident.split, 'Comisión 50/50');
    assert.equal(opp.summary, 'Guest spots y artistas residentes');
    assert.deepEqual(opp.kinds, ['guest_spot', 'resident']);
    assert.deepEqual(opp.requirements, ['NIE o permiso de trabajo en España']);

    const fromWindow = M.opportunitiesFor({ id: 's2', guest_window_start: '2026-11-01', guest_window_end: '2026-11-20' }, [], NOW);
    assert.equal(fromWindow.guest.dates, '1 nov – 20 nov');
    assert.equal(fromWindow.resident.open, false);

    const expired = M.opportunitiesFor({ id: 's3', guest_window_start: '2026-01-01', guest_window_end: '2026-02-01' }, [], NOW);
    assert.equal(expired.guest.open, false, 'una ventana vencida no cuenta como guest abierto');
});

test('directorio del mapa: une sedes, spots, invitaciones y contactos; filtra por texto, país y tipo', () => {
    const directory = M.buildDirectory({
        locations: [
            { studio_id: 'a', latitude: 41.4, longitude: 2.17, city: 'Barcelona', country: 'España', studios: { id: 'a', name: 'Zorro Rojo Tattoo', user_id: 'u1', is_seeking_artists: true } },
            { studio_id: 'b', latitude: 4.65, longitude: -74.06, city: 'Bogotá', country: 'Colombia', studios: { id: 'b', name: 'Taller Ceiba', user_id: null, accepts_guest_spots: true } },
            { studio_id: 'c', latitude: null, longitude: null, city: 'Lima', country: 'Perú', studios: { id: 'c', name: 'Sin coordenadas' } },
            { studio_id: 'a', latitude: 41.4, longitude: 2.17, studios: { id: 'a', name: 'Zorro Rojo Tattoo' } },
        ],
        spots: [],
        memberships: [{ id: 'm1', studio_id: 'a', status: 'active', invited_at: '2026-07-08', studios: { id: 'a' } }],
        contacts: [{ id: 't1', context_type: 'studio_contact', context_id: 'a', last_message_at: '2026-10-28' }],
    }, NOW);
    assert.deepEqual(directory.map((s) => s.name), ['Taller Ceiba', 'Zorro Rojo Tattoo']);
    const zorro = directory.find((s) => s.id === 'a');
    assert.equal(zorro.membership.id, 'm1');
    assert.equal(zorro.contact.id, 't1');
    assert.equal(zorro.hasAccount, true);
    assert.equal(directory.find((s) => s.id === 'b').hasAccount, false);
    assert.equal(M.filterDirectory(directory, { query: 'bogota' }).length, 1, 'la búsqueda ignora acentos');
    assert.equal(M.filterDirectory(directory, { country: 'España' })[0].id, 'a');
    assert.deepEqual(M.filterDirectory(directory, { kind: 'resident' }).map((s) => s.id), ['a']);
    assert.deepEqual(M.filterDirectory(directory, { kind: 'guest_spot' }).map((s) => s.id), ['b']);
    assert.deepEqual(M.countries(directory), ['Colombia', 'España']);
});

test('proyección del globo: mismo encuadre que COBE, giro corto y agrupación de marcadores', () => {
    const view = Object.assign({ scale: 1, width: 800, height: 600 }, M.focusAngles(41.39, 2.17));
    const center = M.project(41.39, 2.17, view);
    assert.ok(Math.abs(center.x - 400) < 0.01 && Math.abs(center.y - 300) < 0.01 && center.front);
    const antipode = M.project(-41.39, -177.83, view);
    assert.equal(antipode.front, false);
    const circle = M.globeCircle(view);
    assert.equal(circle.r, 0.8 * 300);
    assert.ok(Math.abs(M.nearestAngle(0, Math.PI * 2 + 0.1) - 0.1) < 1e-9);
    const clusters = M.clusterPoints([{ id: 1, x: 0, y: 0 }, { id: 2, x: 10, y: 5 }, { id: 3, x: 200, y: 200 }], 24);
    assert.deepEqual(clusters.map((c) => c.ids), [[1, 2], [3]]);
    const mid = M.centroid([{ lat: 41.39, lng: 2.17 }, { lat: 40.42, lng: -3.7 }]);
    assert.ok(mid.lat > 40 && mid.lat < 41.5 && mid.lng > -3.7 && mid.lng < 2.17);
    assert.ok(M.graticulePaths(view, 15).length > 10);
});

test('validación de "Escribir al estudio" (2007:5795)', () => {
    const ok = M.validateContact({ reason: 'guest_spot', message: 'Hola, me interesa un guest spot en noviembre.', startDate: '2026-11-01', endDate: '2026-11-14' }, NOW);
    assert.equal(ok.ok, true);
    const short = M.validateContact({ reason: 'guest_spot', message: 'Hola' }, NOW);
    assert.equal(short.errors.message, 'Escribí al menos 20 caracteres.');
    assert.match(M.validateContact({ reason: 'resident', message: 'x'.repeat(30), startDate: '2026-11-01' }, NOW).errors.dates, /dos fechas/);
    assert.match(M.validateContact({ reason: 'resident', message: 'x'.repeat(30), startDate: '2026-11-10', endDate: '2026-11-01' }, NOW).errors.dates, /posterior/);
    assert.match(M.validateContact({ reason: 'resident', message: 'x'.repeat(30), startDate: '2026-10-01', endDate: '2026-10-10' }, NOW).errors.dates, /a partir de hoy/);
    assert.equal(M.validateContact({ reason: 'spam', message: 'x'.repeat(30) }, NOW).errors.reason, 'Elegí un motivo.');
    assert.equal(M.characterCount(''), '0 caracteres · mínimo 20');
});

test('fixtures del preview: estudios geolocalizados, invitaciones del Figma y RPC de contacto', () => {
    global.self = global;
    delete require.cache[require.resolve('../public/shared/js/demo-fixtures/invitaciones.js')];
    require('../public/shared/js/demo-fixtures/oportunidades.js');
    require('../public/shared/js/demo-fixtures/invitaciones.js');
    const Fixtures = require('../public/shared/js/wo-demo-fixtures.js');
    const Postgrest = require('../public/shared/js/wo-demo-postgrest.js');
    const userId = '11111111-1111-4111-8111-111111111111';
    const fx = Fixtures.build({ userId, username: 'vale.wo', name: 'Vale' });
    const store = Postgrest.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views });
    const call = (p, search, body, method) => {
        const res = store.handle({ method: method || 'GET', path: p, search: search || '', headers: {}, body: body ? JSON.stringify(body) : null, ctx: { userId } });
        return res.body ? JSON.parse(res.body) : null;
    };

    const locations = call('studio_locations', '?select=id,studios:studio_id(id,name,user_id,specialty_styles)&is_active=eq.true&is_primary=eq.true&latitude=not.is.null');
    assert.ok(locations.length >= 25, `al menos 25 estudios en el mapa, hay ${locations.length}`);
    assert.ok(locations.every((l) => l.studios && l.studios.user_id), 'todos los estudios del demo pueden recibir mensajes');

    const mine = call('studio_artist_memberships', `?select=id,status,studios:studio_id(name),invitation_details:studio_membership_invitation_details(is_featured)&artist_user_id=eq.${userId}`);
    const names = mine.map((m) => m.studios.name);
    ['Fierro Negro Tattoo', 'Casa Aguja', 'Tierra Firme Tattoo', 'Zorro Rojo Tattoo'].forEach((name) => assert.ok(names.includes(name), name));
    assert.equal(mine.filter((m) => m.invitation_details && m.invitation_details.is_featured).length, 1, 'una sola invitación del mes');

    const zorro = fx.tables.studios.find((s) => s.slug === 'zorro-rojo-tattoo');
    const roster = call('studio_artist_memberships', `?select=artists_db(name)&studio_id=eq.${zorro.id}&status=eq.active`);
    assert.deepEqual(roster.map((r) => r.artists_db && r.artists_db.name).filter(Boolean), ['Pau Serra', 'Lu Ibarra', 'Laura M.']);

    const before = call('rpc/list_artist_inbox_threads', '', {}, 'POST').filter((t) => t.context_type === 'studio_contact');
    assert.equal(before.length, 1);
    const gotic = fx.tables.studios.find((s) => s.slug === 'gotic-13');
    const sent = call('rpc/contact_studio_as_artist', '', { p_studio_id: gotic.id, p_reason: 'guest_spot', p_message: 'Hola, quiero hacer un guest spot en noviembre.', p_start_date: '2026-11-09', p_end_date: '2026-12-07', p_include_portfolio: true }, 'POST');
    assert.equal(sent.reason_label, 'Guest spot');
    const after = call('rpc/list_artist_inbox_threads', '', {}, 'POST').filter((t) => t.context_type === 'studio_contact');
    assert.equal(after.length, 2);
    const messages = call('inbox_messages', `?select=body&thread_id=eq.${sent.thread_id}`);
    assert.match(messages[0].body, /Fechas tentativas: 09\/11\/2026 – 07\/12\/2026/);
    assert.match(messages[0].body, /Portfolio: \/artist\/profile\?artist=vale\.wo/);
});

test('migración nueva (no aplicada) con rollback, RLS heredada y RPC con validaciones', () => {
    const migration = read('supabase/migrations/20261028180000_invitaciones_estudios_contacto.sql');
    const rollback = read('supabase/rollbacks/20261028180000_invitaciones_estudios_contacto.down.sql');
    ['specialty_styles', 'station_count', 'equipment', 'artist_requirements', 'default_revenue_split_pct',
        'accepts_guest_spots', 'guest_window_start', 'guest_window_end', 'accepts_artist_inquiries'].forEach((column) => {
        assert.match(migration, new RegExp(`add column if not exists ${column}`));
        assert.match(rollback, new RegExp(`drop column if exists ${column}`));
    });
    assert.match(migration, /create or replace function public\.contact_studio_as_artist/);
    assert.match(migration, /security definer/);
    assert.match(migration, /ensure_domain_inbox_thread/);
    assert.match(migration, /'studio_contact'/);
    assert.match(migration, /char_length\(v_message\) < 20/);
    assert.match(migration, /revoke all on function public\.contact_studio_as_artist[\s\S]*from public, anon/);
    assert.match(rollback, /drop function if exists public\.contact_studio_as_artist/);
});

test('el repo de invitaciones degrada si la migración no está aplicada', () => {
    const repo = read('public/shared/js/data/invitations-repo.js');
    assert.match(repo, /D\.Invitations = Invitations/);
    assert.match(repo, /function isMissingColumn/);
    assert.match(repo, /function isMissingFunction/);
    assert.match(repo, /withStudioColumns/);
    assert.match(repo, /unavailable: true/);
    assert.match(repo, /rpc\('contact_studio_as_artist'/);
    assert.doesNotMatch(repo, /\/rest\/v1\//);
});

// ---------------------------------------------------------------------------
// Ronda 1 de corrección (auditoría Figma vs implementación)
// ---------------------------------------------------------------------------

test('801:540 · índice: nombre corto, invitación del mes como 01 y resto por fecha', () => {
    assert.equal(M.shortStudioName('Fierro Negro Tattoo'), 'Fierro Negro');
    assert.equal(M.shortStudioName('Tierra Firme Tattoo'), 'Tierra Firme');
    assert.equal(M.shortStudioName('Costa Ink Collective'), 'Costa Ink');
    assert.equal(M.shortStudioName('Estudio Cactus'), 'Estudio Cactus');
    assert.equal(M.shortStudioName('Casa Aguja'), 'Casa Aguja');
    assert.equal(M.shortStudioName('Tattoo'), 'Tattoo', 'nunca deja el nombre vacío');

    const dateOf = (item) => item.at;
    const items = [
        { id: 'aguja-negra', _state: 'pending', at: '2026-10-28T11:00:00', featured: false },
        { id: 'fierro', _state: 'pending', at: '2026-10-27T20:00:00', featured: true },
        { id: 'casa', _state: 'pending', at: '2026-10-24T10:00:00', featured: false },
        { id: 'zorro', _state: 'active', at: '2026-10-10T10:00:00', featured: false },
        { id: 'cactus', _state: 'rejected', at: '2026-10-13T10:00:00', featured: false },
    ];
    const featured = M.featuredInvitation(items, (item) => item.featured, dateOf);
    assert.equal(featured.id, 'fierro', 'la destacada manda aunque haya una pendiente más reciente');
    assert.deepEqual(M.indexOrder(items, featured, dateOf).map((i) => i.id), ['fierro', 'aguja-negra', 'casa', 'cactus', 'zorro']);
    const noFeatured = items.map((i) => Object.assign({}, i, { featured: false }));
    assert.equal(M.featuredInvitation(noFeatured, (i) => i.featured, dateOf).id, 'aguja-negra', 'sin destacada: la pendiente más reciente');
});

test('801:540 · listado: un filtro no promueve otra invitación del mes y Ordenar ordena todo', () => {
    const dateOf = (item) => item.at;
    const nameOf = (item) => item.name;
    const items = [
        { id: 'f', name: 'Fierro Negro Tattoo', _state: 'pending', at: '2026-10-27' },
        { id: 'c', name: 'Casa Aguja', _state: 'pending', at: '2026-10-24' },
        { id: 't', name: 'Tierra Firme Tattoo', _state: 'pending', at: '2026-10-16' },
        { id: 'z', name: 'Zorro Rojo Tattoo', _state: 'active', at: '2026-10-10' },
        { id: 'b', name: 'Bang Bang NYC', _state: 'rejected', at: '2026-10-13' },
    ];
    const featured = items[0];
    const recent = M.listLayout(items, { sortMode: 'recent', featured, dateOf, nameOf });
    assert.equal(recent.feature.id, 'f');
    assert.deepEqual(recent.items.map((i) => i.id), ['z', 'c', 't', 'b'], 'bloques del Figma: roster, pendientes, rechazadas');

    const searched = M.listLayout([items[1]], { sortMode: 'recent', featured, dateOf, nameOf });
    assert.equal(searched.feature, null, 'buscar "cordoba" no convierte a Casa Aguja en invitación del mes');
    assert.deepEqual(searched.items.map((i) => i.id), ['c']);

    const az = M.listLayout(items, { sortMode: 'studio', featured, dateOf, nameOf });
    assert.equal(az.feature, null);
    assert.deepEqual(az.items.map((i) => i.id), ['b', 'c', 'f', 't', 'z']);
    const oldest = M.listLayout(items, { sortMode: 'oldest', featured, dateOf, nameOf });
    assert.deepEqual(oldest.items.map((i) => i.id), ['z', 'b', 't', 'c', 'f']);
});

test('2007:5792 · los grupos de marcadores no se pisan (globo chico de 390px)', () => {
    // Caso del auditor: "10" y "2" a ~17px quedaban superpuestos en el sur de Sudamérica.
    const points = [];
    for (let i = 0; i < 10; i++) points.push({ id: 'a' + i, x: 160 + (i % 3) * 6, y: 322 + Math.floor(i / 3) * 4 });
    points.push({ id: 'b0', x: 192, y: 330 }, { id: 'b1', x: 196, y: 331 });
    const loose = M.clusterPoints(points, 24, 0);
    const tight = M.clusterPoints(points, 24, 32);
    assert.ok(loose.length > tight.length);
    for (let i = 0; i < tight.length; i++) {
        for (let j = i + 1; j < tight.length; j++) {
            const d = Math.hypot(tight[i].x - tight[j].x, tight[i].y - tight[j].y);
            assert.ok(d >= 32, 'grupos a ' + d.toFixed(1) + 'px');
        }
    }
    assert.equal(tight.reduce((n, c) => n + c.ids.length, 0), points.length, 'no se pierde ningún estudio');
    const map = read('public/shared/js/invitations-map.js');
    assert.match(map, /M\.clusterPoints\(points, CLUSTER_RADIUS, CLUSTER_GAP\)/);
});

test('2007:5792/5793 · globo con tierra rellena sin dependencias nuevas y grupo en la URL', () => {
    const html = read('public/artist/invitations/index.html');
    const globe = read('public/shared/js/invitations-globe.js');
    const map = read('public/shared/js/invitations-map.js');
    const app = read('public/shared/js/artist-invitations.js');
    const css = read('public/shared/css/invitations-studios.css');
    const cobe = read('public/shared/vendor/cobe/index.esm.js');

    const model = html.indexOf('/shared/js/invitations-model.js');
    const globeTag = html.indexOf('/shared/js/invitations-globe.js');
    assert.ok(globeTag > model && globeTag < html.indexOf('/shared/js/invitations-map.js'));
    // Retícula y esfera (SVG) debajo del canvas de tierra.
    assert.ok(html.indexOf('id="ism-grid"') < html.indexOf('id="ism-canvas"'));
    assert.match(css, /\.ism-sphere\s*\{\s*fill:\s*var\(--figma-white\)/);
    // La máscara es la misma que ya trae COBE (vendorizado): no hay datos ni librerías nuevas.
    const mask = globe.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)[1];
    assert.ok(cobe.includes(mask), 'la máscara de tierra sale del COBE vendorizado');
    assert.doesNotMatch(globe + map, /https?:\/\//, 'sin CDNs ni servicios externos');
    assert.doesNotMatch(map, /vendor\/cobe|mapSamples/, 'el mapa ya no dibuja la tierra con puntos COBE');
    assert.match(map, /--figma-sand-border/);
    // Estado de grupo reproducible: ?vista=mapa&grupo=<id>,<id>
    assert.match(app, /'grupo'/);
    assert.match(app, /groupIds:\s*\(query\.get\('grupo'\)/);
    assert.match(map, /navigate\(\{ vista: 'mapa', grupo: groupParam\(\) \}/);
});

test('especificidad frente al DS: subrayados, placeholders y colores del Figma', () => {
    const css = read('public/shared/css/artist-invitations-figma.css');
    const studios = read('public/shared/css/invitations-studios.css');
    assert.match(css, /\.inv-shell a\.inv-link\s*\{\s*text-decoration:\s*underline/);
    assert.match(css, /\.wo-app \.inv-search::placeholder\s*\{\s*color:\s*var\(--neutral-400\)/);
    assert.match(css, /\.wo-app \.inv-change-textarea::placeholder\s*\{\s*color:\s*var\(--neutral-400\)/);
    assert.match(css, /\.inv-change-form \.inv-key\s*\{[^}]*color:\s*var\(--neutral-400\)/);
    assert.match(css, /\.inv-index \.inv-dot--rejected\s*\{\s*background:\s*var\(--red-300\)/);
    assert.match(css, /@media \(min-width: 80rem\)[\s\S]*\.inv-row-name\s*\{\s*white-space:\s*nowrap/);
    assert.match(studios, /\.ism \.ism-line a\s*\{\s*text-decoration:\s*underline/);
    assert.match(studios, /legend\.isc-label\s*\{\s*margin-bottom:\s*10px/);
    assert.match(studios, /::-webkit-calendar-picker-indicator\s*\{[\s\S]*?opacity:\s*0/);
});

test('drawers: rechazada vuelve al listado desde el detalle y aceptada tiene cierre visible', () => {
    const js = read('public/shared/js/artist-invitations.js');
    assert.match(js, /data-other-invitations/);
    assert.match(js, /if \(onDetail\) navigate\(\{\}\)/);
    assert.match(js, /inv-drawer--accepted[\s\S]{0,200}class="inv-drawer-close" data-drawer-close aria-label="Cerrar"/);
    const studio = read('public/shared/js/invitations-studio.js');
    assert.doesNotMatch(studio, /Las respuestas te llegan al Inbox/, 'sin subtítulo inventado en 03 · Contacto');
});

// Ronda 2 · 2007:5792/5793: geografía Natural Earth (TopoJSON world-atlas) lista para
// cargarse, fronteras vectoriales, retícula de 10° y respaldo COBE sin casquete ártico.
const G = require('../public/shared/js/invitations-globe.js');

function gridTopology() {
    // Dos "países" A (−10..3) y B (3..15) que comparten el arco 0, cuantizados con transform.
    const q = (lon, lat) => [Math.round((lon + 180) * 10), Math.round((lat + 90) * 10)];
    const delta = (points) => points.map((p, i) => (i ? [p[0] - points[i - 1][0], p[1] - points[i - 1][1]] : p));
    const arc = (coords) => delta(coords.map(([lon, lat]) => q(lon, lat)));
    return {
        type: 'Topology',
        transform: { scale: [0.1, 0.1], translate: [-180, -90] },
        objects: {
            countries: {
                type: 'GeometryCollection',
                geometries: [
                    { type: 'Polygon', arcs: [[0, 1]] },
                    { type: 'MultiPolygon', arcs: [[[~0, 2]], [[3]]] },
                    { type: 'Polygon', arcs: [[4]] },
                ],
            },
        },
        arcs: [
            arc([[3, 44], [3, 36]]),
            arc([[3, 36], [-10, 36], [-10, 44], [3, 44]]),
            arc([[3, 44], [3, 50], [15, 50], [15, 36], [3, 36]]),
            arc([[172, -14], [-172, -14], [-172, -22], [172, -22], [172, -14]]),
            arc([[-180, -70], [-60, -72], [60, -67], [180, -70], [-180, -70]]),
        ],
    };
}

test('2007:5792/5793 · TopoJSON de Natural Earth: anillos cosidos y fronteras = arcos compartidos', () => {
    const geo = G.topologyGeography(gridTopology());
    assert.equal(geo.polygons.length, 4, 'A, B (dos partes) y la Antártida');
    const ringA = geo.polygons[0][0];
    assert.deepEqual(ringA.map((p) => p.map((v) => Math.round(v))), [[3, 44], [3, 36], [-10, 36], [-10, 44], [3, 44]]);
    const ringB = geo.polygons[1][0];
    assert.deepEqual(ringB[0].map(Math.round), [3, 36], 'el arco invertido (~0) arranca en su último punto');
    assert.equal(ringB.length, 6, 'sin repetir el punto de unión entre arcos');
    assert.equal(geo.borders.length, 1, 'solo el arco compartido por A y B es frontera (las costas no)');
    assert.deepEqual(geo.borders[0].map((p) => p.map((v) => Math.round(v))), [[3, 44], [3, 36]]);
    assert.equal(G.topologyGeography({ type: 'FeatureCollection' }), null);
    assert.equal(G.topologyGeography(null), null);
});

test('2007:5792/5793 · anillos que cruzan el antimeridiano o rodean el polo', () => {
    const fiji = G.unwrapRing([[172, -14], [-172, -14], [-172, -22], [172, -22], [172, -14]]);
    assert.deepEqual(fiji.map((p) => p[0]), [172, 188, 188, 172, 172], 'longitudes continuas');
    const antarctica = G.unwrapRing([[-180, -70], [-60, -72], [60, -67], [180, -70], [-180, -70]]);
    const tail = antarctica.slice(-2);
    assert.deepEqual(tail.map((p) => p[1]), [-90, -90], 'se cierra por el polo sur');
    const north = G.unwrapRing([[-180, 80], [0, 81], [180, 80], [-180, 80]]);
    assert.deepEqual(north.slice(-2).map((p) => p[1]), [90, 90]);
});

test('2007:5792/5793 · las fronteras se proyectan igual que los marcadores', () => {
    const views = [
        { phi: 0.3, theta: 0.6, scale: 1.16, width: 870, height: 760 },
        { phi: -2.1, theta: -0.4, scale: 2.6, width: 600, height: 560 },
    ];
    [[2.17, 41.39], [-74.07, 4.71], [139.69, 35.68], [-58.38, -34.6]].forEach(([lon, lat]) => {
        views.forEach((view) => {
            const a = G.projectLonLat(lon, lat, view);
            const b = M.project(lat, lon, view);
            assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, `${lon},${lat}`);
            assert.equal(a.front, b.front);
        });
    });
    // Ancho medido en el Figma: ~0,5px (5792, zoom 1,16) y ~0,9px (5793, zoom 2,6).
    assert.equal(G.borderWidth(1.16), 0.5);
    assert.ok(Math.abs(G.borderWidth(2.6) - 0.9) < 0.02);
    assert.ok(G.borderWidth(5.2) <= 1.2);
});

test('2007:5792/5793 · retícula de 10°, capa de fronteras y pie según la geografía cargada', () => {
    const html = read('public/artist/invitations/index.html');
    const map = read('public/shared/js/invitations-map.js');
    const globe = read('public/shared/js/invitations-globe.js');
    const css = read('public/shared/css/invitations-studios.css');
    // Orden de capas: retícula (SVG) < tierra (WebGL) < fronteras (2D) < marcadores.
    const order = ['id="ism-grid"', 'id="ism-canvas"', 'id="ism-borders"', 'id="ism-markers"'].map((id) => html.indexOf(id));
    assert.ok(order.every((pos, i) => pos > 0 && (i === 0 || pos > order[i - 1])), order.join(','));
    assert.match(html, /<p class="ism-source" id="ism-source">Geografía: máscara de tierra de COBE · escala aproximada\.<\/p>/);
    assert.match(map, /SOURCE_NATURAL_EARTH = 'Geografía: Natural Earth · escala 1:110m\.'/);
    assert.match(map, /M\.graticulePaths\(view, GRATICULE_STEP\)/);
    assert.match(map, /GRATICULE_STEP = 10;/);
    // Solo URLs del mismo origen para el TopoJSON (sin CDNs).
    assert.ok(map.includes('!/^\\/(?!\\/)/.test(url)'), 'data-geography solo acepta rutas del mismo origen');
    assert.match(map, /overlay: el\['ism-borders'\]/);
    assert.match(globe, /gl\.LUMINANCE/);
    assert.match(css, /\.ism-graticule\s*\{[^}]*stroke:\s*var\(--figma-sand-border\)/);
    // Retícula: meridianos cada 10°, los mayores (cada 90°) hasta el polo.
    const view = { phi: M.focusAngles(90, 0).phi, theta: Math.PI / 2 - 1e-4, scale: 1.2, width: 600, height: 600 };
    const paths = M.graticulePaths(view, 10);
    const reachesPole = paths.some((d) => / 300\.0$|L300\.0 300\.0/.test(d) || d.includes('300.0 300.0'));
    assert.ok(reachesPole, 'un meridiano mayor llega al polo (centro de la vista)');
    // Respaldo COBE: sin casquete ártico fuera de Groenlandia y con tope de Natural Earth.
    assert.equal(G.ARCTIC_CUT, 73.5);
    assert.equal(G.NORTH_LIMIT, 83.6);
});
