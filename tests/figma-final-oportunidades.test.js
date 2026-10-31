'use strict';

// Figma final del flujo de artista (oct 2026) · área "oportunidades":
// Job Board (/job-board), Postulaciones (/artist/applications) y Spots (/studio-spots).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function buildFixtures() {
    const sandbox = { console };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('public/shared/js/demo-fixtures/oportunidades.js'), sandbox);
    vm.runInContext(read('public/shared/js/wo-demo-fixtures.js'), sandbox);
    return sandbox.WoDemoFixtures.build({ userId: '0000c0de-0000-4000-8000-0000000000aa', username: 'lauumarth.wo', name: 'Lau' });
}

function loadSpotsRepo(fakeData) {
    const sandbox = { console, window: { WeotziData: fakeData } };
    vm.createContext(sandbox);
    vm.runInContext(read('public/shared/js/data/spots-opportunities-repo.js'), sandbox);
    return sandbox.window.WeotziData.SpotsOpportunities;
}

test('fixtures: el Job Board tiene sponsor, 13 solicitudes curadas y presupuestos sin USD', () => {
    const { tables } = buildFixtures();
    const open = tables.job_board_requests.filter((r) => r.status === 'open' && r.is_public);
    const curated = open.filter((r) => Number(r.feed_rank) >= 1).sort((a, b) => a.feed_rank - b.feed_rank);
    assert.equal(curated.length, 13);
    assert.equal(curated[0].request_code, 'JB-59407');
    const sponsor = open.find((r) => r.is_featured && r.is_sponsored);
    assert.ok(sponsor, 'falta la oportunidad patrocinada');
    assert.equal(sponsor.sponsor_name, 'Aurora Ink Collective');
    assert.equal(sponsor.featured_slots_count, 3);
    const abuela = curated.find((r) => r.request_code === 'JB-24872');
    assert.equal(abuela.specific_requirements.length, 3);
    assert.equal(abuela.tattoo_size, 'Mediano (15–20 cm)');
});

test('fixtures: las 9 postulaciones cubren todos los estados del Figma', () => {
    const { tables } = buildFixtures();
    assert.equal(tables.job_board_applications.length, 5);
    assert.equal(tables.studio_spot_applications.length, 4);
    const jbStatuses = Array.from(tables.job_board_applications, (a) => a.status).sort();
    assert.deepEqual(jbStatuses, ['accepted', 'pending', 'pending', 'rejected', 'viewed']);
    // La "expirada" apunta a una solicitud cerrada.
    const closed = new Set(tables.job_board_requests.filter((r) => r.status === 'closed').map((r) => r.id));
    assert.ok(tables.job_board_applications.some((a) => a.status === 'pending' && closed.has(a.request_id)));
    // Contraofertas pendientes: una del cliente (JB) y una del estudio (spot).
    assert.equal(tables.job_board_counter_offers.filter((o) => o.status === 'pendiente' && o.author_role === 'client').length, 1);
    assert.equal(tables.studio_spot_counter_offers.filter((o) => o.status === 'pending' && o.author_role === 'studio').length, 1);
    // La duración respeta el check constraint de job_board_applications.
    const allowed = [null, '1_day', '2_3_days', '1_week', '2_weeks', 'custom'];
    tables.job_board_applications.forEach((a) => assert.ok(allowed.includes(a.estimated_duration), a.estimated_duration));
});

test('fixtures: el directorio de Spots tiene 13 oportunidades abiertas con hero, promovido e itinerante', () => {
    const { tables } = buildFixtures();
    const open = tables.studio_spots.filter((s) => s.status === 'open');
    assert.equal(open.length, 13);
    const featured = open.filter((s) => s.is_featured).sort((a, b) => a.featured_rank - b.featured_rank);
    assert.equal(featured.length, 2);
    assert.equal(featured[0].directory_rank, 1);
    assert.ok(open.some((s) => s.kind === 'itinerant'));
    const urgent = open.filter((s) => (new Date(s.expires_at) - Date.now()) / 86400000 <= 2);
    assert.ok(urgent.length >= 1, 'falta un spot que cierre en ≤ 2 días');
    const ids = new Set(tables.studio_spots.map((s) => s.id));
    tables.studio_spot_applications.forEach((a) => assert.ok(ids.has(a.spot_id)));
    // Todos los ids de postulaciones son UUID válidos (el Inbox los usa como context_id).
    tables.studio_spot_applications.concat(tables.job_board_applications).forEach((a) => {
        assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});

test('fixtures: "Ver conversación" encuentra el hilo del Inbox por context_id', () => {
    const { tables } = buildFixtures();
    const appIds = new Set(tables.studio_spot_applications.map((a) => a.id));
    const linked = tables.inbox_threads.filter((t) => t.context_type === 'studio_spot_application' && appIds.has(t.context_id));
    assert.ok(linked.length >= 1);
    const js = read('public/shared/js/artist-applications.js');
    assert.match(js, /params\.set\('application', item\.id\)/);
    assert.match(js, /params\.set\('opportunity', item\.kind\)/);
    assert.match(read('public/shared/js/inbox-deeplink.js'), /application/);
});

test('migración 20261028170000: aditiva, idempotente, con rollback y sin aplicar', () => {
    const up = read('supabase/migrations/20261028170000_oportunidades_figma_final.sql');
    const down = read('supabase/rollbacks/20261028170000_oportunidades_figma_final.down.sql');
    assert.match(up, /add column if not exists specific_requirements text\[\]/);
    assert.match(up, /add column if not exists benefit_tags text\[\]/);
    assert.match(up, /add column if not exists availability_summary text/);
    assert.match(up, /enable row level security/);
    assert.doesNotMatch(up, /drop\s+(table|column)/i);
    assert.match(down, /drop column if exists specific_requirements/);
    assert.match(down, /drop column if exists benefit_tags/);
    assert.match(down, /drop column if exists availability_summary/);
});

test('SpotsOpportunities degrada al select previo si la migración no está aplicada', async () => {
    const calls = [];
    const missing = { data: null, error: { code: '42703', message: 'column studio_spots.benefit_tags does not exist' } };
    const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; }, then(resolve) { resolve(missing); } };
    const fake = {
        from(table) { calls.push(table); return chain; },
        StudioSpots: {
            listOpenWithStudioAndLocation: async () => ({ data: [{ id: 'legacy' }], error: null }),
            listApplicationsByArtist: async () => ({ data: [{ id: 'legacy-app' }], error: null })
        },
        StudioMemberships: { listPendingForArtist: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }) }
    };
    const repo = loadSpotsRepo(fake);
    const original = console.warn;
    console.warn = () => {};
    try {
        const dir = await repo.listOpenDirectory();
        assert.equal(dir.data[0].id, 'legacy');
        const apps = await repo.listApplicationsByArtist('u1');
        assert.equal(apps.data[0].id, 'legacy-app');
    } finally {
        console.warn = original;
    }
    assert.deepEqual(calls, ['studio_spots', 'studio_spot_applications']);
    assert.equal((await repo.countPendingInvitations('u1')).data, 2);
    assert.equal(repo.isMissingColumn({ code: 'PGRST204' }), true);
    assert.equal(repo.isMissingColumn({ code: '23505', message: 'duplicate key' }), false);
});

test('Spots 801:537: cabecera con pestañas, búsqueda, filtros, contador y orden', () => {
    const html = read('public/studio-spots/index.html');
    assert.match(html, /Encontrá tu próximo spot/);
    assert.match(html, /Explorá residencias, guest spots y oportunidades en estudios de todo el mundo\./);
    assert.match(html, /href="\/artist\/applications\?tab=spots"/);
    assert.match(html, /href="\/artist\/invitations"/);
    assert.match(html, /Buscar por estudio, ciudad o país…/);
    ['País', 'Ciudad', 'Fecha', 'Tipo de spot', 'Más filtros', 'Más relevantes'].forEach((label) => assert.ok(html.includes(label), label));
    assert.match(html, /spots-opportunities-repo\.js/);
    const js = read('public/shared/js/studio-spots-directory.js');
    assert.match(js, /function applyFilters\(\)/);
    assert.match(js, /estado'\) === 'enviada'/);
    assert.match(js, /function itinerantLine\(s\)/);
});

test('Job Board 801:1067/1068: acceso a postulaciones, requisitos persistidos y propuesta ya enviada', () => {
    const html = read('public/job-board/index.html');
    assert.match(html, /href="\/artist\/applications\?tab=jobboard"/);
    assert.match(html, /data-wo-icon="zap"/);
    const js = read('public/shared/js/job-board-feed.js');
    assert.match(js, /request\.specific_requirements/);
    assert.match(js, /const suffix = cur === 'USD' \? '' : ` \$\{cur\}`/);
    assert.match(js, /async function markAlreadyApplied\(request\)/);
    assert.match(js, /Datos de contacto disponibles cuando el cliente acepte tu propuesta/);
    assert.doesNotMatch(js, /<span class="req">\*<\/span>/);
});

/* ---------------- Corrección ronda 1 (auditoría Figma final) ---------------- */

const AppState = require('../public/shared/js/applications-state.js');

test('estado unificado: la contraoferta pendiente pisa el status crudo en Job Board y Spots', () => {
    const offerClient = [{ author_role: 'client', status: 'pendiente' }];
    assert.equal(AppState.deriveJb({ status: 'viewed' }, { status: 'open' }, offerClient), 'contraoferta_recibida');
    assert.equal(AppState.deriveJb({ status: 'viewed' }, { status: 'open' }, []), 'en_revision');
    assert.equal(AppState.deriveJb({ status: 'pending' }, { status: 'closed' }, []), 'expirada');
    assert.equal(AppState.deriveJb({ status: 'accepted' }, { status: 'closed' }, offerClient), 'confirmada');
    assert.equal(AppState.deriveJb({ status: 'pending' }, null, [{ author_role: 'client', status: 'reemplazada' }]), 'esperando_respuesta');
    const offerStudio = { data: [{ author_role: 'studio', status: 'pending' }] };
    assert.equal(AppState.deriveSpot({ status: 'shortlisted' }, { status: 'open' }, offerStudio), 'contraoferta_recibida');
    assert.equal(AppState.deriveSpot({ status: 'shortlisted' }, { status: 'open' }, []), 'en_revision');
    assert.equal(AppState.deriveSpot({ status: 'pending' }, { status: 'closed' }, []), 'expirada');
    assert.equal(AppState.label('contraoferta_recibida'), 'Contraoferta recibida');
    assert.equal(AppState.rawSpotLabel('pending'), 'Esperando respuesta');
    assert.equal(AppState.rawSpotLabel('shortlisted'), 'En revisión');
});

test('asides "ya te postulaste" y confirmaciones usan el estado derivado, no el status crudo', () => {
    const jb = read('public/shared/js/job-board-feed.js');
    assert.match(jb, /async function ownApplicationState\(application, request\)/);
    assert.match(jb, /S\.deriveJb\(application, request, offers\)/);
    assert.doesNotMatch(jb, /labels\[application\.status\] \|\| 'Enviada'/);
    // "Postularme" en una solicitud ya postulada abre el detalle (aside con "Ver seguimiento").
    assert.match(jb, /if \(existingApp\) \{\s*openRequestDetail\(request\);/);
    const spots = read('public/shared/js/studio-spots-directory.js');
    assert.match(spots, /async function applicationState\(application, spot\)/);
    assert.doesNotMatch(spots, /'Ya te postulaste a este spot\. Estado: ' \+ existing\.status/);
    ['public/job-board/index.html', 'public/studio-spots/index.html', 'public/artist/applications/index.html'].forEach((rel) => {
        assert.match(read(rel), /\/shared\/js\/applications-state\.js/, rel);
    });
});

test('íconos Feather y placeholders del DS (sin "☆", "→" ni "browse files")', () => {
    const files = ['public/shared/js/job-board-feed.js', 'public/shared/js/studio-spots-directory.js', 'public/shared/js/artist-applications.js'];
    files.forEach((rel) => {
        const js = read(rel);
        assert.doesNotMatch(js, /browse files|browse<br>files/, rel);
        assert.doesNotMatch(js, /☆/, rel);
    });
    const spots = read('public/shared/js/studio-spots-directory.js');
    assert.match(spots, /data-wo-icon="external-link" class="wo-icon-18" aria-hidden="true"><\/i> \$\{escapeHtml\(String\(studio\.website\)/);
    assert.match(spots, /data-wo-icon="star"/);
    const apps = read('public/shared/js/artist-applications.js');
    assert.match(apps, /data-wo-icon="briefcase" aria-hidden="true"><\/i>' \+ escapeHtml\(it\.kindLabel\)/);
    assert.doesNotMatch(apps, /Explorar el job board →|Ver cotización →/);
});

test('spots 801:537: hero sin alto fijo con regla gruesa, buscador sin desborde y marcas rotativas', () => {
    const css = read('public/shared/css/studio-spots-figma.css');
    assert.match(css, /\.sps-explore-search \{ box-sizing: border-box; \}/);
    assert.match(css, /\.sps-feature \{\s*height: auto;\s*min-height: 24\.75rem;/);
    assert.match(css, /\.sps-feature \{ border-bottom: calc\(var\(--border-hairline\) \* 5\) solid var\(--border-strong\); \}/);
    const js = read('public/shared/js/studio-spots-directory.js');
    assert.match(js, /const MARK_ROTATION = \['square', 'triangle', 'circle'\];/);
});

test('postulaciones: contador con el total general, chips en cero sin deshabilitar y edición de propuesta', () => {
    const js = read('public/shared/js/artist-applications.js');
    assert.match(js, /filtered\.length \+ ' de ' \+ items\.length/);
    assert.doesNotMatch(js, /\(dim \? ' disabled' : ''\)/);
    assert.match(js, /n < done \|\| n \+ 1 === active/);
    assert.match(js, /function openEditProposalModal\(item\)/);
    assert.match(js, /JB\.Applications\.updateProposal\(item\.id/);
    const repo = read('public/shared/js/data/jobboard-repo.js');
    assert.match(repo, /async updateProposal\(applicationId, patch\)/);
    assert.match(repo, /\.eq\('status', 'pending'\)/);
});

test('fixtures: portfolio con ?artist=, cliente verificado con rating y un hilo del Inbox por postulación', () => {
    const { tables } = buildFixtures();
    tables.job_board_applications.forEach((a) => assert.match(a.portfolio_links[0], /^\/artist\/profile\?artist=/));
    tables.studio_spot_applications.forEach((a) => assert.match(a.portfolio_url, /^\/artist\/profile\?artist=/));
    const camila = tables.client_public_profiles.find((p) => p.public_username === 'Camila R.');
    assert.ok(camila.profile_completed_at, 'Camila R. sin perfil verificado');
    const ratings = tables.verified_reviews.filter((r) => r.reviewee_type === 'client' && r.reviewee_user_id === camila.user_id).map((r) => r.rating);
    assert.equal(Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10, 4.9);
    const apps = tables.job_board_applications.map((a) => a.id).concat(tables.studio_spot_applications.map((a) => a.id));
    apps.forEach((appId) => {
        const thread = tables.inbox_threads.find((t) => t.context_id === appId && String(t.context_type).includes('application'));
        assert.ok(thread, 'falta hilo para ' + appId);
        assert.ok(tables.inbox_messages.some((m) => m.thread_id === thread.id), 'hilo sin mensajes ' + appId);
    });
    const costaThread = tables.inbox_threads.find((t) => t.context_id === tables.studio_spot_applications[0].id && t.counterparty_name === 'Costa Ink Collective');
    assert.equal(costaThread.context.application_status, 'pending_acceptance');
});

test('ronda 2: resumen de confirmación con 20 px de aire y cabecera de 48 px (801:1069 / 801:539)', () => {
    const jb = read('public/shared/css/job-board-feed.css');
    assert.match(jb, /\.jbf-summary-body \{ padding: 1\.25rem; \}/);
    assert.match(jb, /\.jbf-summary-head \{\s*box-sizing: border-box;\s*min-height: 3rem;\s*padding: \.875rem 1\.25rem;/);
    assert.match(jb, /\.jbf-summary-row \{\s*min-height: 0;\s*padding: \.75rem 0;/);
    const sps = read('public/shared/css/studio-spots-figma.css');
    assert.match(sps, /\.sps-summary-body \{ padding: 1\.25rem; \}/);
    assert.match(sps, /\.sps-summary-head \{\s*box-sizing: border-box;\s*min-height: 3rem;\s*padding: \.875rem 1\.25rem;/);
    assert.match(sps, /\.sps-summary-row \{\s*min-height: 0;\s*padding: \.75rem 0;/);
});

test('ronda 2: aside "Seguimiento" sin el hueco bajo el título y botón de contraoferta por tipo (801:1073 / 801:1074)', () => {
    const css = read('public/shared/css/opportunity-applications-figma.css');
    assert.match(css, /\.apx-track \.wo-h3 \{ line-height: 22px; \}/);
    assert.match(css, /\.apx-track-rule \+ \.apx-track-rows \{ margin-top: -15px; \}/);
    assert.match(css, /\.apx-track--spot \.apx-offerbox \.wo-btn \{ min-height: 41px; height: 41px; \}/);
    assert.match(css, /\.apx-track-actions > \.apx-offerbox \{ margin-bottom: 10px; \}/);
    const js = read('public/shared/js/artist-applications.js');
    assert.match(js, /<aside class="wo-card apx-track apx-track--spot"/);
});

test('ronda 2: detalle con título en caja de 680 px y tarjetas de 437 px con el pie abajo (801:1068 / 801:1067)', () => {
    const css = read('public/shared/css/job-board-feed.css');
    assert.match(css, /\.jbf-detail-title \{\s*max-width: 42\.5rem;/);
    assert.match(css, /\.jbf-refs \{ row-gap: 93px; \}/);
    assert.match(css, /\.jbf-refs \+ \.jbf-sum-label \{ margin-top: 13px; \}/);
    assert.match(css, /\.jbf-card-body \{\s*box-sizing: border-box;\s*min-height: 13\.4375rem;\s*gap: \.625rem;/);
    assert.match(css, /\.jbf-card-apply \{\s*box-sizing: border-box;\s*height: 2\.25rem;/);
});

test('ronda 3: Volver y el breadcrumb centrados en una fila de 36 px, 32 px bajo la barra (801:1068)', () => {
    const css = read('public/shared/css/job-board-feed.css');
    assert.match(css, /\.jbf-detail-nav \{\s*display: flex;\s*flex-wrap: wrap;\s*align-items: center;\s*min-height: 36px;\s*margin-bottom: 1\.25rem;/);
    assert.match(css, /#jbf-detail-view \.jbf-detail-nav \.jbf-back \{ margin-bottom: 0; \}/);
    assert.match(css, /\.jbf-shell\.is-detail \.jbf-main \{ padding-top: var\(--space-8\); \}/);
    const js = read('public/shared/js/job-board-feed.js');
    assert.match(js, /<div class="jbf-detail-nav">\s*<button type="button" class="jbf-back"/);
    assert.match(js, /shell\.classList\.toggle\('is-detail', name === 'detail'\)/);
});
