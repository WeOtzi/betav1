'use strict';

// Figma final del flujo de artista (oct 2026) · área travel-inbox.
// Cubre la lógica pura nueva: enlaces profundos del Inbox, fixtures/RPC de
// preview alineadas con el contrato real de Travel y los estados
// direccionables por URL de /artist/travel.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { resolveDeepLink, OPPORTUNITY_FILTERS } = require(path.join(root, 'public', 'shared', 'js', 'inbox-deeplink.js'));

const ROWS = [
    { key: 'unified:t-spot', id: 't-spot', source: 'unified', category: 'spots', contextType: 'studio_spot_application', contextId: 'app-9', context: {}, archived: false },
    { key: 'unified:t-job', id: 't-job', source: 'unified', category: 'job_board', contextType: 'job_board_application', contextId: null, context: { application_id: 'app-7' }, archived: false },
    { key: 'quote:Q-100', id: 'Q-100', source: 'quote', category: 'quotations', context: {}, archived: false },
    { key: 'unified:t-quote', id: 't-quote', source: 'unified', category: 'quotations', contextType: 'quotation', contextId: 'Q-200', context: {}, archived: false },
    { key: 'unified:t-trip', id: 't-trip', source: 'unified', category: 'trips', contextType: 'artist_trip', contextId: 'trip-1', context: { trip_id: 'trip-1' }, archived: false },
    { key: 'unified:t-old', id: 't-old', source: 'unified', category: 'clients', contextType: 'client', contextId: null, context: {}, archived: true },
    { key: 'support:s-1', id: 's-1', source: 'support', category: 'support', context: {}, archived: false },
];
const params = (query) => new URLSearchParams(query);

test('Inbox deep links: nothing requested keeps the default view', () => {
    assert.equal(resolveDeepLink(ROWS, params('')), null);
});

test('Inbox deep links open threads by id, key or context id', () => {
    assert.deepEqual(resolveDeepLink(ROWS, params('thread=t-spot')), { key: 'unified:t-spot', filter: null });
    assert.deepEqual(resolveDeepLink(ROWS, params('thread=quote:Q-100')), { key: 'quote:Q-100', filter: null });
    assert.deepEqual(resolveDeepLink(ROWS, params('thread=trip-1')), { key: 'unified:t-trip', filter: null });
    // El hilo de soporte sigue accesible desde el Inbox (aunque no tenga filtro propio).
    assert.deepEqual(resolveDeepLink(ROWS, params('thread=s-1')), { key: 'support:s-1', filter: null });
});

test('Inbox deep links resolve ?quote= for legacy chat and unified quotation threads', () => {
    assert.equal(resolveDeepLink(ROWS, params('quote=Q-100')).key, 'quote:Q-100');
    assert.equal(resolveDeepLink(ROWS, params('quote=Q-200')).key, 'unified:t-quote');
});

test('Inbox deep links from Postulaciones match the application or fall back to its category', () => {
    assert.equal(resolveDeepLink(ROWS, params('opportunity=jobboard&application=app-7')).key, 'unified:t-job');
    assert.equal(resolveDeepLink(ROWS, params('opportunity=spot&application=app-9')).key, 'unified:t-spot');
    assert.deepEqual(resolveDeepLink(ROWS, params('opportunity=spot&application=missing')), { key: null, filter: 'spots' });
    assert.deepEqual(resolveDeepLink(ROWS, params('quote=missing&opportunity=jobboard&application=x')), { key: null, filter: 'job_board' });
    assert.equal(OPPORTUNITY_FILTERS.jobboard, 'job_board');
});

test('Inbox deep links open archived threads inside the Archivados filter and honour ?filter=', () => {
    assert.deepEqual(resolveDeepLink(ROWS, params('thread=t-old')), { key: 'unified:t-old', filter: 'archived' });
    assert.deepEqual(resolveDeepLink(ROWS, params('filter=trips')), { key: null, filter: 'trips' });
    assert.deepEqual(resolveDeepLink(ROWS, params('filter=not-a-filter')), null);
});

test('the Inbox page loads the deep-link resolver before its controller', () => {
    const html = read('public/artist/inbox/index.html');
    const resolverAt = html.indexOf('/shared/js/inbox-deeplink.js');
    assert.ok(resolverAt > 0 && resolverAt < html.indexOf('/shared/js/artist-inbox.js'));
    assert.match(read('public/shared/js/artist-inbox.js'), /ArtistInboxDeepLink[\s\S]*resolveDeepLink\(state\.rows, params\)/);
});

function loadFixtureExtension() {
    const previous = globalThis.self;
    globalThis.self = globalThis;
    delete require.cache[require.resolve(path.join(root, 'public', 'shared', 'js', 'demo-fixtures', 'travel-inbox.js'))];
    require(path.join(root, 'public', 'shared', 'js', 'demo-fixtures', 'travel-inbox.js'));
    const extension = globalThis.WoDemoFixtureExtensions['travel-inbox'];
    if (previous === undefined) delete globalThis.self; else globalThis.self = previous;
    return extension;
}

function memoryStore(tables) {
    let seq = 0;
    return {
        rows(name) { if (!tables[name]) tables[name] = []; return tables[name]; },
        insert(name, list) {
            const rows = list.map((row) => ({ id: `new-${++seq}`, created_at: new Date().toISOString(), ...row }));
            this.rows(name).push(...rows);
            return rows;
        },
    };
}

function buildContext() {
    const tables = {
        artist_trips: [{ id: 'base', artist_user_id: 'artist-1' }],
        studios: [{ id: 'studio-zr', slug: 'zorro-rojo-tattoo', name: 'Zorro Rojo Tattoo', city: 'Barcelona', formatted_address: 'El Born, Barcelona' }],
        inbox_threads: [
            { id: 'costa', artist_user_id: 'artist-1', category: 'spots', counterparty_name: 'Costa Ink Collective', subject: 'Guest spot · Valparaíso', context: { city: 'Valparaíso' } },
            { id: 'zorro', artist_user_id: 'artist-1', category: 'studios', counterparty_name: 'Zorro Rojo Tattoo', context_type: 'studio_contact', context: { start_date: '2026-11-27' }, last_message: 'Hola, me interesa hacer un guest spot en septiembre.' },
        ],
        inbox_messages: [
            { id: 'm-old', thread_id: 'costa', body: 'viejo' },
            { id: 'z-1', thread_id: 'zorro', body: 'Confirmo que llego el 22 y me quedo dos semanas.' },
            { id: 'z-2', thread_id: 'zorro', body: 'Perfecto, te esperamos el 22.' },
            { id: 'z-3', thread_id: 'zorro', body: 'Hola, me interesa hacer un guest spot en septiembre.' },
        ],
        studio_spots: [{ id: 'spot-costa', studio_id: 'studio-costa', title: 'Residencia · Barcelona · 3 a 6 meses', start_date: '2026-12-02', end_date: '2027-05-31' }],
        studio_spot_applications: [
            { id: 'spot-app-costa', spot_id: 'spot-costa', status: 'shortlisted', message: 'Me sumo a la residencia.', requested_dates: '[2026-09-01,2026-09-16)', created_at: '2026-08-01T10:00:00.000Z', decided_at: null },
        ],
        job_board_requests: [{ id: 'req-1', client_user_id: 'client-1', client_display_name: 'Diego M.', display_title: 'Calavera new school', request_code: 'JB-1' }],
        job_board_applications: [
            { id: 'jb-app-1', request_id: 'req-1', status: 'viewed', message: 'Me encanta la idea.', created_at: '2026-10-20T10:00:00.000Z', viewed_at: '2026-10-21T10:00:00.000Z', decided_at: null, updated_at: '2026-10-21T10:00:00.000Z' },
        ],
    };
    tables.studios.push({ id: 'studio-costa', slug: 'costa-ink-collective', name: 'Costa Ink Collective', city: 'Valparaíso' });
    const ctx = { tables, rpcs: {}, identity: { userId: 'artist-1', name: 'Artista demo', username: 'artista.wo' }, helpers: { DAY: 86400000 } };
    loadFixtureExtension()(ctx);
    return ctx;
}

test('Travel preview fixtures follow the Figma distribution and the Barcelona detail state', () => {
    const { tables } = buildContext();
    const trips = tables.artist_trips;
    const count = (status) => trips.filter((trip) => trip.status === status).length;
    assert.equal(trips.length, 8);
    assert.deepEqual([count('confirmado'), count('pendiente'), count('finalizado')], [2, 3, 3]);
    const barcelona = trips[0];
    assert.equal(barcelona.city, 'Barcelona');
    assert.equal(barcelona.interested_people_count, 12);
    assert.equal(barcelona.climate_celsius, 28);
    const checklist = tables.trip_checklist_items.filter((item) => item.trip_id === barcelona.id);
    assert.equal(checklist.length, 10);
    assert.equal(checklist.filter((item) => item.is_done).length, 3);
    const primary = tables.trip_studio_links.find((link) => link.trip_id === barcelona.id && link.studio_name === 'Zorro Rojo Tattoo');
    assert.equal(primary.status, 'esperando_confirmacion');
    assert.equal(tables.trip_documents.filter((doc) => doc.trip_id === barcelona.id).length, 3);
    assert.equal(tables.artist_travel_passport_stamps.length, 3);
});

test('Travel preview RPCs mirror the real contract (canonical checklist, public whitelist)', () => {
    const ctx = buildContext();
    const store = memoryStore(ctx.tables);
    const created = ctx.rpcs.create_artist_trip({ p_city: 'Lisboa', p_country: 'Portugal', p_start_date: '2026-09-03', p_end_date: '2026-09-05', p_trip_type: 'convencion' }, store, { userId: 'artist-1' });
    assert.equal(created.status, 'planificado');
    assert.equal(store.rows('trip_checklist_items').filter((item) => item.trip_id === created.id).length, 10);

    // Figma 801:1083: el viaje del detalle (Barcelona) todavía no tiene el enlace publicado.
    assert.equal(ctx.tables.artist_trips[0].share_enabled, false);
    assert.deepEqual(ctx.rpcs.get_public_travel_share({ p_share_slug: 'barcelona-zorro-rojo' }, store), []);
    const shared = ctx.rpcs.get_public_travel_share({ p_share_slug: 'MONTEVIDEO-INK-SOCIETY' }, store);
    assert.equal(shared.length, 1);
    assert.deepEqual(Object.keys(shared[0]).sort(), ['artist_name', 'artist_username', 'city', 'climate_celsius', 'country', 'end_date',
        'event_name', 'id', 'interested_people_count', 'region', 'share_slug', 'start_date', 'status', 'trip_type'].sort());
    assert.equal(shared[0].artist_name, 'Artista demo');

    ctx.rpcs.cancel_artist_trip({ p_trip_id: shared[0].id }, store);
    assert.deepEqual(ctx.rpcs.get_public_travel_share({ p_share_slug: 'montevideo-ink-society' }, store), []);

    const link = ctx.rpcs.request_trip_studio_link({ p_trip_id: created.id, p_studio_id: 'studio-zr' }, store);
    assert.equal(link.status, 'esperando_confirmacion');
});

test('Inbox preview fixtures cover every sidebar category and the exact Spot context', () => {
    const { tables } = buildContext();
    const categories = new Set(tables.inbox_threads.map((thread) => thread.category));
    for (const category of ['clients', 'quotations', 'invitations', 'spots', 'job_board', 'studios', 'trips']) {
        assert.ok(categories.has(category), category);
    }
    assert.ok(tables.inbox_threads.some((thread) => thread.is_archived));
    const costa = tables.inbox_threads.find((thread) => thread.id === 'costa');
    assert.equal(costa.context.studio, 'Costa Ink Collective');
    assert.equal(costa.context.application_status, 'accepted');
    assert.equal(costa.context.city, null);
    // Coherente con Postulaciones: misma postulación, fechas pedidas y título del Spot.
    assert.equal(costa.context_id, 'spot-app-costa');
    assert.equal(costa.subject, 'Residencia · Barcelona');
    assert.equal(costa.context.start_date, '2026-09-01');
    assert.equal(costa.context.end_date, '2026-09-15');
    const bodies = tables.inbox_messages.filter((message) => message.thread_id === 'costa').map((message) => message.body);
    assert.deepEqual(bodies, ['Confirmo mi interés en la próxima residencia de septiembre.', 'Perfecto, mandanos tus fechas confirmadas']);
});

test('Inbox fixtures: every application has its thread and Zorro Rojo keeps only the first contact', () => {
    const { tables } = buildContext();
    // Sin hilo de Job Board huérfano (Aurora sin postulación); el trigger real crea uno por postulación.
    assert.ok(!tables.inbox_threads.some((thread) => thread.counterparty_name === 'Aurora Ink Collective'));
    const jb = tables.inbox_threads.find((thread) => thread.context_id === 'jb-app-1');
    assert.equal(jb.category, 'job_board');
    assert.equal(jb.context_type, 'job_board_application');
    assert.equal(jb.counterparty_name, 'Diego M.');
    assert.equal(jb.context.application_id, 'jb-app-1');
    assert.equal(jb.unread_count, 3);
    const zorroBodies = tables.inbox_messages.filter((message) => message.thread_id === 'zorro').map((message) => message.body);
    assert.deepEqual(zorroBodies, ['Hola, me interesa hacer un guest spot en noviembre.']);
});

test('Travel exposes addressable states for QA and deep links', () => {
    const script = read('public/shared/js/artist-travel.js');
    for (const key of ['crear', 'editar', 'fechas', 'vincular', 'compartir', 'cancelar', 'adjuntar']) {
        assert.match(script, new RegExp(`${key}: '(tv-modal-|open-|doc-)`), key);
    }
    assert.match(script, /params\.get\('agregado'\)/);
    assert.match(script, /history\.pushState\(\{\}, '', `\$\{travelPrefix\(\)\}\/artist\/travel\/\?agregado=/);
    // Figma final: sin flechas en el hero y cronología por más recientes primero.
    assert.doesNotMatch(read('public/artist/travel/index.html'), /tv-hero-previous|tv-hero-next/);
    assert.match(script, /let sortAsc = false;/);
});

test('Travel globe wireframe mode follows Figma 801:1076 (static lines, dashed next route, short base label)', () => {
    const globe = require(path.join(root, 'public', 'shared', 'js', 'weotzi-travel-globe.js'));
    assert.equal(globe.abbreviateBaseCity('Buenos Aires'), 'Bs. As.');
    assert.equal(globe.abbreviateBaseCity('Lisboa'), 'Lisboa');
    assert.equal(globe.wireframeBaseLabel({ city: 'Buenos Aires', country: 'Argentina' }), 'Tu base · Bs. As.');
    const route = {
        base: { city: 'Buenos Aires', location: [-34.6037, -58.3816] },
        stops: [
            { id: 'bcn', city: 'Barcelona', status: 'confirmado', location: [41.3874, 2.1686] },
            { id: 'scl', city: 'Santiago', status: 'pendiente', location: [-33.4489, -70.6693] },
        ],
    };
    const { svg, points } = globe.buildWireframeSvg(route, 'bcn', 960, 986);
    assert.match(svg, /class="tvg-wire"/);
    assert.equal((svg.match(/<ellipse class="tvg-wire"/g) || []).length, 4);
    assert.match(svg, /tvg-route tvg-route--selected" data-wire-stop="bcn"/);
    assert.match(svg, /tvg-route tvg-route--pendiente" data-wire-stop="scl"/);
    assert.match(svg, /TU BASE · BS\. AS\./);
    const bcn = points.get('bcn');
    assert.ok(bcn.x > 480 && bcn.y < 478, 'Europa queda arriba a la derecha de la base');
    const page = read('public/artist/travel/index.html');
    assert.match(page, /<weotzi-travel-globe[^>]*mode="wireframe"/);
    const css = read('public/shared/css/weotzi-travel-globe.css');
    assert.match(css, /\.tvg-route--selected\{[^}]*stroke-dasharray/);
    assert.match(css, /\.tvg-wire\{[^}]*stroke:var\(--neutral-400\)/);
});

test('Travel globe 801:1076 (ronda 2): finalizadas en gris, medidas del Figma y parada resaltable por URL', () => {
    const globe = require(path.join(root, 'public', 'shared', 'js', 'weotzi-travel-globe.js'));
    const model = require(path.join(root, 'public', 'shared', 'js', 'travel-dashboard-model.js'));
    const today = new Date(2026, 9, 28);
    const trips = [
        { id: 'bcn', city: 'Barcelona', country: 'España', status: 'confirmado', start_date: '2026-12-06', end_date: '2026-12-13' },
        { id: 'mad', city: 'Madrid', country: 'España', status: 'pendiente', start_date: '2027-01-31', end_date: '2027-02-04' },
        { id: 'mvd', city: 'Montevideo', country: 'Uruguay', status: 'finalizado', start_date: '2026-10-11', end_date: '2026-10-18' },
        { id: 'lim', city: 'Lima', country: 'Perú', status: 'finalizado', start_date: '2026-09-26', end_date: '2026-10-03' },
        { id: 'old', city: 'Rosario', country: 'Argentina', status: 'confirmado', start_date: '2026-01-10', end_date: '2026-01-12' },
        { id: 'x', city: 'Lisboa', country: 'Portugal', status: 'cancelado', start_date: '2026-12-20', end_date: '2026-12-22' },
    ];
    // El globo recibe todas las paradas (próximas primero, después el historial); sin canceladas.
    assert.deepEqual(model.buildGlobeDestinations(trips, { today }).map((t) => t.id), ['bcn', 'mad', 'mvd', 'lim', 'old']);
    assert.deepEqual(model.buildUpcomingDestinations(trips, { today }).map((t) => t.id), ['bcn', 'mad']);
    // Las finalizadas también se geocodifican cuando se pide includePast.
    const queries = model.buildMissingDestinationQueries(trips, [], { today, includePast: true }).map((q) => q.key);
    assert.ok(queries.includes('rosario|argentina') && queries.includes('lima|peru'));
    assert.equal(model.buildMissingDestinationQueries(trips, [], { today }).length, 2);

    const route = {
        base: { city: 'Buenos Aires', location: [-34.6037, -58.3816] },
        stops: [
            { id: 'bcn', city: 'Barcelona', status: 'confirmado', location: [41.3874, 2.1686] },
            { id: 'mad', city: 'Madrid', status: 'pendiente', location: [40.4168, -3.7038] },
            { id: 'lim', city: 'Lima', status: 'finalizado', location: [-12.0464, -77.0428] },
        ],
    };
    const { svg } = globe.buildWireframeSvg(route, 'mad', 960, 988);
    assert.match(svg, /tvg-route tvg-route--finalizado" data-wire-stop="lim"/);
    assert.match(svg, /tvg-route tvg-route--selected" data-wire-stop="mad"/);
    // Figma: parada Ø19.62, seleccionada Ø27.46, base Ø23.54 en #FAF8F3; las rutas pintan sobre la base.
    assert.match(svg, /tvg-stop--finalizado" data-wire-stop="lim" cx="[\d.]+" cy="[\d.]+" r="9\.81"/);
    assert.match(svg, /tvg-stop--selected" data-wire-stop="mad" cx="[\d.]+" cy="[\d.]+" r="13\.73"/);
    assert.match(svg, /class="tvg-base" cx="[\d.]+" cy="[\d.]+" r="11\.77"/);
    assert.ok(svg.indexOf('tvg-basepoint') < svg.indexOf('tvg-routes'), 'la base queda debajo de las rutas');
    const small = globe.buildWireframeSvg(route, 'mad', 357, 360).svg;
    assert.match(small, /tvg-stop--selected" data-wire-stop="mad" cx="[\d.]+" cy="[\d.]+" r="8\.24"/);

    const css = read('public/shared/css/weotzi-travel-globe.css');
    assert.match(css, /\.tvg-route\{[^}]*stroke-width:2\.94;stroke-opacity:\.25/);
    assert.match(css, /\.tvg-route--finalizado\{stroke:var\(--neutral-300\)\}/);
    assert.match(css, /\.tvg-route--selected\{[^}]*stroke-width:5\.89/);
    assert.match(css, /\.tvg-base\{fill:var\(--neutral-100\)\}/);

    const script = read('public/shared/js/artist-travel.js');
    assert.match(script, /buildGlobeDestinations\(/);
    assert.match(script, /params\.get\('parada'\)/);
    assert.match(script, /includePast: true/);
});

test('Travel corrections from the Figma audit (search field, overlay, modals, icons, feedback)', () => {
    const css = read('public/shared/css/artist-travel-ds.css');
    const script = read('public/shared/js/artist-travel.js');
    const page = read('public/artist/travel/index.html');
    // 801:1081: el foco del DS no puede pisar el padding del buscador.
    assert.match(css, /\.tvm \.tvm-search-input\{padding-left:44px\}/);
    assert.match(css, /\.tvm \.tvm-search-input:focus\{padding-left:43px\}/);
    // Overlay alineado con la nav real (no 75px fijos).
    assert.match(css, /\.tvm-overlay\{inset:var\(--tvm-top,75px\) 0 0;/);
    assert.match(script, /getBoundingClientRect\(\)\.bottom/);
    // 801:1080–801:1084: borde de 1px sin sombra; solo "Crear viaje" con sombra dura.
    assert.match(css, /\.tvm\{[^}]*border:var\(--border-hairline\) solid var\(--border-strong\)[^}]*box-shadow:none/);
    assert.match(css, /\.tvm--create\{box-shadow:var\(--shadow-hard-lg\)\}/);
    assert.match(css, /#tv-cancel-confirm\{background:var\(--system-error\)/);
    assert.match(css, /#tv-main,\.tvm-overlay,\.tvs-share-shell\{font-synthesis:none\}/);
    assert.match(css, /::-webkit-calendar-picker-indicator\{[^}]*opacity:0/);
    assert.match(css, /\.tvm \.wo-textarea\{resize:none\}/);
    // 801:1079: íconos de documentos.
    assert.match(script, /DOC_ICONS = \{ pasaje: 'copy', reserva_hotel: 'home', contrato: 'copy', otro: 'paperclip' \}/);
    // Feedback visible en acciones del detalle.
    assert.match(script, /Solicitud enviada a \$\{studioName\}/);
    assert.match(script, /Otras solicitudes de vinculación/);
    for (const id of ['tve-error', 'tvl-error', 'tvs-error', 'tvx-error']) assert.match(page, new RegExp(`id="${id}"`), id);
});

test('Inbox corrections from the Figma audit (deep link scroll, base path, studio context, list details)', () => {
    const script = read('public/shared/js/artist-inbox.js');
    const css = read('public/shared/css/artist-inbox-ds.css');
    assert.match(script, /revealActiveRow\(target\.key\)/);
    assert.match(script, /href: appHref\(/);
    assert.match(script, /\/studio\/profile\?studio=/);
    assert.match(script, /ctxBlock\('Motivo', context\.reason_label\)/);
    assert.match(script, /row\.category === 'studios' \? '' : 'Estudio'/);
    assert.match(script, /function linkify\(/);
    assert.match(script, /WEEKDAYS_SHORT = \['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'\]/);
    assert.match(script, /replace\(\/\[\^\\p\{L\}\]\/gu, ''\)/);
    assert.match(css, /\.ai-composer-tools \.ai-attach svg \{ width: 16px; height: 16px;/);
    assert.match(css, /\.ai-summary-row \{ box-sizing: border-box; height: 25px;/);
});
