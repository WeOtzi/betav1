'use strict';
// Ronda 2 · frente cliente-panel: coherencia del panel del cliente.
//   CP1 código corto + buscador · CP2 estados nuevos centralizados ·
//   CP3 usabilidad (vacíos con acción, accesos directos) · CP4 preferencias.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
// Los checkouts de Windows traen \r\n: los contratos se leen normalizados.
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const Panel = require('../public/shared/js/client-panel-model.js');
const Proposal = require('../public/shared/js/client-quote-proposal.js');
const Notif = require('../public/shared/js/client-notif-model.js');
const prefs = require('../lib/notification-prefs');
const logic = require('../lib/cliente-panel');

const NOW = Date.parse('2026-11-16T12:00:00Z');
const responded = (over = {}) => ({
    id: 7, quote_id: 'QN00007', quote_status: 'responded', artist_name: 'Lau Ink', artist_responded_at: '2026-11-10T00:00:00Z',
    artist_budget_amount: '410000', artist_budget_currency: 'ARS', quote_expires_at: '2099-01-01T00:00:00Z',
    tattoo_style: [{ style_name: 'Fine line' }], tattoo_body_part: 'Antebrazo', dispute_status: 'none', ...over,
});

// ------------------------------------------------------------ CP2 · estados
test('CP2: el estado base es el del modelo existente del panel (una sola fuente de etiquetas)', () => {
    // Estados base de hoy (si otro frente suma estados al modelo, esta lista no cambia).
    for (const key of ['pending', 'responded', 'client_approved', 'client_rejected', 'in_progress', 'artist_completed', 'completed', 'cancelled', 'expired']) {
        const q = { quote_status: key, artist_responded_at: '2026-01-01', quote_expires_at: '2099-01-01T00:00:00Z' };
        const status = Panel.statusOf(q, { now: NOW });
        assert.equal(status.label, Proposal.statusOf(q, NOW).label, key);
        assert.equal(status.key, Proposal.statusOf(q, NOW).key, key);
        assert.equal(status.overlay, null);
        assert.match(status.tag, /^wo-tag--/);
    }
    assert.equal(Panel.statusOf({ quote_status: 'in_progress' }, { now: NOW }).label, Proposal.STATUS.draft.label);
    assert.equal(Panel.statusOf({ quote_status: 'raro' }, { now: NOW }).label, Proposal.STATUS.unknown.label);
    assert.equal(Panel.statusOf(responded({ quote_expires_at: '2026-11-01T00:00:00Z' }), { now: NOW }).key, 'expired');
});

test('CP2: sin el script de la propuesta, el respaldo no deja estados crudos', () => {
    const standalone = Panel.create(() => null);
    for (const s of ['pending', 'responded', 'client_approved', 'client_rejected', 'en_progreso', 'artist_completed', 'completed', 'cancelled', 'expired', 'otro_estado']) {
        const status = standalone.statusOf({ quote_status: s, artist_responded_at: 'x', quote_expires_at: '2099-01-01T00:00:00Z' }, { now: NOW });
        assert.ok(status.label && !/_/.test(status.label), s);
        assert.ok(standalone.STATUS[status.key], s);
    }
    assert.equal(standalone.statusOf({ quote_status: 'in_progress' }).key, 'draft');
    assert.equal(standalone.matchesFilter({ quote_status: 'in_progress' }, 'all'), false);
    assert.equal(standalone.matchesFilter({ quote_status: 'pending' }, 'active'), true);
});

test('CP2: contrapropuesta pendiente → "Cambios propuestos por ti / por el artista" con varias formas de dato', () => {
    const byArtist = [
        { ctx: { counterBy: 'artist' } },
        { ctx: { counterOffers: [{ status: 'pendiente', author_role: 'artist', created_at: '2026-11-12' }] } },
        { row: { counter_offers: [{ status: 'pending', author_role: 'artist' }, { status: 'rechazada', author_role: 'client' }] } },
        { row: { pending_counter_by: 'artist' } },
        { row: { counter_offer_by: 'artista', counter_offer_status: 'pending' } },
        { row: { quote_status: 'artist_counter' } },
    ];
    for (const { ctx = {}, row = {} } of byArtist) {
        const status = Panel.statusOf(responded(row), { now: NOW, ...ctx });
        assert.equal(status.label, 'Cambios propuestos por el artista', JSON.stringify({ ctx, row }));
        assert.equal(status.overlay, 'counter_by_artist');
        assert.equal(status.waitingOn, 'client');
        assert.ok(status.hint);
    }
    const byClient = [
        { ctx: { counterBy: 'client' } },
        { ctx: { counterOffers: [{ status: 'pendiente', author_role: 'client' }] } },
        { row: { pending_counter_by: 'client' } },
        { row: { quote_status: 'client_counter' } },
    ];
    for (const { ctx = {}, row = {} } of byClient) {
        const status = Panel.statusOf(responded(row), { now: NOW, ...ctx });
        assert.equal(status.label, 'Cambios propuestos por ti', JSON.stringify({ ctx, row }));
        assert.equal(status.waitingOn, 'artist');
    }
    // La contraoferta ya decidida no deja la etiqueta pegada.
    assert.equal(Panel.statusOf(responded({ counter_offers: [{ status: 'aceptada', author_role: 'artist' }] }), { now: NOW }).overlay, null);
    assert.equal(Panel.statusOf(responded({ counter_by: 'artist', counter_status: 'accepted' }), { now: NOW }).overlay, null);
    // key sigue siendo el estado base: filtros y resto del panel no cambian.
    assert.equal(Panel.statusOf(responded({ pending_counter_by: 'artist' }), { now: NOW }).key, 'responded');
    assert.equal(Panel.statusOf(responded({ pending_counter_by: 'artist' }), { now: NOW }).baseLabel, Proposal.STATUS.responded.label);
});

test('CP2: "Cambios al acuerdo pendientes de aprobar" y "Sesión por confirmar"', () => {
    const approved = (over = {}) => responded({ quote_status: 'client_approved', final_budget_amount: '400000', ...over });
    for (const row of [
        { agreement_change_status: 'pending' },
        { pending_agreement: { status: 'pending', requested_by: 'artist' } },
        { pending_agreement_change: true },
        { agreement_change_requested_at: '2026-11-15T10:00:00Z' },
    ]) {
        const status = Panel.statusOf(approved(row), { now: NOW });
        assert.equal(status.label, 'Cambios al acuerdo pendientes de aprobar', JSON.stringify(row));
        assert.equal(status.waitingOn, 'client');
        assert.equal(status.key, 'client_approved');
    }
    assert.equal(Panel.statusOf(approved({ agreement_change_requested_at: '2026-11-15', agreement_change_decided_at: '2026-11-16' }), { now: NOW }).overlay, null);
    assert.equal(Panel.statusOf(approved({ agreement_change_status: 'approved' }), { now: NOW }).overlay, null);
    // Si el cambio lo pidió el cliente, la etiqueta es la misma pero espera al artista.
    const mine = Panel.statusOf(approved(), { now: NOW, agreementChangePending: true, agreementChangeBy: 'client' });
    assert.equal(mine.label, 'Cambios al acuerdo pendientes de aprobar');
    assert.equal(mine.waitingOn, 'artist');

    const future = '2026-12-01T15:00:00Z';
    for (const session of [
        { status: 'proposed', session_date: future },
        { status: 'scheduled', session_date: future, confirmation_status: 'pending' },
        { status: 'scheduled', session_date: future, needs_client_confirmation: true },
        { status: 'scheduled', session_date: future, client_confirmed: false },
    ]) {
        const status = Panel.statusOf(approved(), { now: NOW, sessions: [session] });
        assert.equal(status.label, 'Sesión por confirmar', JSON.stringify(session));
    }
    assert.equal(Panel.statusOf(approved(), { now: NOW, sessionsByQuotationId: { 7: [{ status: 'pending_confirmation', session_date: future }] } }).overlay, 'session_to_confirm');
    assert.equal(Panel.statusOf(approved({ session_confirmation_status: 'pending' }), { now: NOW }).overlay, 'session_to_confirm');
    // Sesiones agendadas, canceladas, completadas o viejas no piden confirmación.
    for (const session of [
        { status: 'scheduled', session_date: future },
        { status: 'cancelled', session_date: future, confirmation_status: 'pending' },
        { status: 'completed', session_date: '2026-11-01T10:00:00Z' },
        { status: 'proposed', session_date: '2026-10-01T10:00:00Z' },
    ]) {
        assert.equal(Panel.statusOf(approved(), { now: NOW, sessions: [session] }).overlay, null, JSON.stringify(session));
    }
});

test('CP2: prioridad (primero lo que espera al cliente) y cotizaciones cerradas sin etiquetas nuevas', () => {
    const q = responded({ quote_status: 'client_approved' });
    const all = { now: NOW, counterBy: 'client', agreementChangePending: true, sessionToConfirm: true };
    assert.equal(Panel.statusOf(q, all).overlay, 'agreement_change');
    assert.equal(Panel.statusOf(q, { ...all, counterBy: 'artist' }).overlay, 'counter_by_artist');
    assert.equal(Panel.statusOf(q, { now: NOW, counterBy: 'client', sessionToConfirm: true }).overlay, 'session_to_confirm');
    for (const closed of ['completed', 'cancelled', 'client_rejected', 'expired']) {
        const status = Panel.statusOf(responded({ quote_status: closed, pending_counter_by: 'artist' }), all);
        assert.equal(status.overlay, null, closed);
        assert.equal(status.label, Proposal.STATUS[closed].label);
    }
    assert.equal(Panel.statusOf({ quote_status: 'in_progress', pending_counter_by: 'artist' }, { now: NOW }).label, Proposal.STATUS.draft.label);
    // Ninguna cotización de hoy (sin campos nuevos) cambia de etiqueta.
    assert.deepEqual(Panel.flagsOf(responded(), { now: NOW }), { counterBy: null, agreementChange: null, sessionToConfirm: false });
    assert.equal(Panel.statusOf(responded(), { now: NOW }).waitingOn, null);
    assert.equal(Panel.statusOf(responded(), { now: NOW, counterBy: 'client' }).waitingOn, 'artist');
    assert.equal(Panel.statusOf(responded({ quote_status: 'client_approved' }), { now: NOW, sessionToConfirm: true }).waitingOn, 'client');
});

// ------------------------------------------------------------ CP1 · código corto y buscador
test('CP1: código corto si existe, quote_id si no; el buscador lo encuentra sin importar formato', () => {
    assert.equal(Panel.quoteCode({ quote_id: 'QN00007' }), 'QN00007');
    assert.equal(Panel.quoteCode({ quote_id: 'QN00007', short_code: ' K7P2QX ' }), 'K7P2QX');
    assert.equal(Panel.quoteCode({ quote_id: 'QN00007', short_code: '' }), 'QN00007');
    assert.equal(Panel.quoteCode({ quote_id: 'QN00007', short_code: null }), 'QN00007');
    assert.equal(Panel.quoteCode(null), '');
    assert.equal(Panel.hasShortCode({ short_code: 'K7P2QX' }), true);
    assert.equal(Panel.hasShortCode({ quote_id: 'QN00007' }), false);

    const list = [
        responded({ quote_id: 'QN00007', short_code: 'K7P2QX' }),
        responded({ id: 8, quote_id: 'QN00008', short_code: 'ZZ91AB', artist_name: 'Martín Ochoa', tattoo_style: 'Blackwork', tattoo_body_part: 'Espalda' }),
        responded({ id: 9, quote_id: 'QN00009', artist_name: 'Otra Artista', quote_status: 'pending' }),
    ];
    const ids = (term) => Panel.searchQuotations(list, term, { now: NOW }).map((q) => q.quote_id);
    assert.deepEqual(ids('K7P2QX'), ['QN00007']);
    assert.deepEqual(ids('k7p2qx'), ['QN00007']);
    assert.deepEqual(ids('#k7p-2qx'), ['QN00007']);
    assert.deepEqual(ids('K7P'), ['QN00007']);
    assert.deepEqual(ids('QN00009'), ['QN00009']);
    assert.deepEqual(ids('martin'), ['QN00008']);
    assert.deepEqual(ids('black espalda'), ['QN00008']);
    assert.deepEqual(ids('fine line'), ['QN00007', 'QN00009']);
    assert.deepEqual(ids('esperando al artista'), ['QN00009']);
    assert.deepEqual(ids('   '), ['QN00007', 'QN00008', 'QN00009']);
    assert.deepEqual(ids('no-existe-xyz'), []);
    // Un solo carácter no dispara coincidencias por código.
    assert.equal(Panel.matchesSearch({ quote_id: 'QN00007', short_code: 'K7P2QX' }, 'K', { now: NOW }), false);
});

// ------------------------------------------------------------ solicitudes del Job Board
test('CP2: solicitudes — etiquetas únicas y contraoferta pendiente del Job Board', () => {
    const req = (over = {}) => ({
        id: 'r1', request_code: 'JB-00012', status: 'open', job_board_applications: [
            { id: 'a1', status: 'pending' }, { id: 'a2', status: 'withdrawn' },
        ], ...over,
    });
    assert.equal(Panel.requestStatusOf(req({ job_board_applications: [] })).label, 'Recibiendo postulaciones');
    assert.equal(Panel.requestStatusOf(req({ job_board_applications: [{ id: 'a2', status: 'withdrawn' }] })).key, 'receiving');
    assert.equal(Panel.requestStatusOf(req()).label, 'Propuestas recibidas');
    assert.equal(Panel.requestStatusOf(req({ status: 'accepted' })).label, 'Artista seleccionado');
    assert.equal(Panel.requestStatusOf(req({ status: 'closed' })).label, 'Cerrada');
    assert.equal(Panel.requestStatusOf(req({ status: 'expired' })).label, 'Vencida');
    assert.equal(Panel.requestStatusOf(req({ status: 'draft' })).label, 'Borrador');

    const offers = (role, app = 'a1') => ({ pendingOffers: [{ application_id: app, author_role: role, status: 'pendiente' }] });
    assert.equal(Panel.requestStatusOf(req(), offers('artist')).label, 'Cambios propuestos por el artista');
    assert.equal(Panel.requestStatusOf(req(), offers('client')).label, 'Cambios propuestos por ti');
    assert.equal(Panel.requestStatusOf(req(), offers('client')).negotiating, true);
    // Contraoferta de una postulación retirada o de otra solicitud: no cuenta.
    assert.equal(Panel.requestStatusOf(req(), offers('artist', 'a2')).label, 'Propuestas recibidas');
    assert.equal(Panel.requestStatusOf(req(), offers('artist', 'zz')).label, 'Propuestas recibidas');
    // Elegido el artista, solo cuenta la postulación elegida.
    const accepted = req({ status: 'accepted', accepted_application_id: 'a1', job_board_applications: [{ id: 'a1', status: 'accepted' }, { id: 'a3', status: 'rejected' }] });
    assert.equal(Panel.requestStatusOf(accepted, offers('artist', 'a3')).label, 'Artista seleccionado');
    assert.equal(Panel.requestStatusOf(accepted, offers('artist', 'a1')).label, 'Cambios propuestos por el artista');
    // Cerrada: la negociación ya no se muestra.
    assert.equal(Panel.requestStatusOf(req({ status: 'closed' }), offers('artist')).label, 'Cerrada');
    // Mismas palabras que en las cotizaciones.
    assert.equal(Panel.REQUEST_STATUS.counter_by_client.label, Panel.OVERLAYS.counter_by_client.label);
    assert.equal(Panel.REQUEST_STATUS.counter_by_artist.label, Panel.OVERLAYS.counter_by_artist.label);

    assert.equal(Panel.requestCode({ request_code: 'JB-FIGMA-FEED-00042', display_code: 'JB-00042' }), 'JB-00042');
    assert.equal(Panel.requestCode({ request_code: 'JB-00012' }), 'JB-00012');
    const list = [req(), req({ id: 'r2', request_code: 'JB-00099', tattoo_idea_description: 'Un colibrí en acuarela', tattoo_style: ['Acuarela'] })];
    assert.deepEqual(Panel.searchRequests(list, 'jb00099').map((r) => r.id), ['r2']);
    assert.deepEqual(Panel.searchRequests(list, 'colibri').map((r) => r.id), ['r2']);
    assert.deepEqual(Panel.searchRequests(list, 'cambios propuestos', (r) => (r.id === 'r1' ? offers('artist') : {})).map((r) => r.id), ['r1']);
});

// ------------------------------------------------------------ CP3 · vacíos y accesos
test('CP3: estados vacíos con acción (cotizar, explorar artistas, publicar idea) y todo escapado', () => {
    const hrefs = (spec) => spec.actions.map((a) => a.href || a.action);
    assert.deepEqual(hrefs(Panel.emptyState('quotations')), ['/quotation', '/marketplace', '/job-board/request']);
    assert.deepEqual(hrefs(Panel.emptyState('requests')), ['/job-board/request', '/marketplace', '/quotation']);
    assert.deepEqual(hrefs(Panel.emptyState('quotations-filter')), ['show-all', '/quotation']);
    assert.deepEqual(hrefs(Panel.emptyState('quotations-search', { term: 'K7' })), ['clear-search']);
    for (const kind of ['quotations', 'quotations-filter', 'quotations-search', 'requests', 'requests-search']) {
        const spec = Panel.emptyState(kind, { term: 'x' });
        assert.equal(spec.actions.filter((a) => a.primary).length, 1, kind + ': una sola acción principal');
        assert.ok(spec.title && spec.copy && spec.icon, kind);
    }
    const html = Panel.emptyHtml(Panel.emptyState('quotations-search', { term: '<img src=x onerror=1>' }), { variant: 'dashboard' });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=1&gt;/);
    assert.match(html, /class="empty-state cpn-empty"/);
    assert.match(html, /<button type="button" class="wo-btn wo-btn--hard wo-btn--accent" data-cpn-action="clear-search">Limpiar búsqueda<\/button>/);
    const ds = Panel.emptyHtml(Panel.emptyState('requests'), { variant: 'ds' });
    assert.match(ds, /class="wo-empty cpn-empty"/);
    assert.match(ds, /<span class="wo-empty-title">/);
    assert.match(ds, /<a class="wo-btn wo-btn--hard wo-btn--accent" href="\/job-board\/request">Publicar una idea<\/a>/);
    assert.match(ds, /href="\/marketplace">Explorar artistas<\/a>/);
    assert.match(ds, /href="\/quotation">Solicitar cotización<\/a>/);
});

test('CP3: accesos directos a favoritos y mensajes, presentes en el dashboard', () => {
    const shortcuts = Panel.shortcuts();
    const byKey = Object.fromEntries(shortcuts.map((s) => [s.key, s]));
    assert.equal(byKey.favorites.href, '/client/favorites');
    assert.equal(byKey.messages.href, '/client/chats/');
    const html = read('public/client/dashboard/index.html');
    const quick = html.match(/<div class="cpn-quick">[\s\S]*?<\/form>\s*<\/div>/);
    assert.ok(quick, 'barra de accesos rápidos');
    assert.match(quick[0], /<nav class="cpn-quick-nav" aria-label="Accesos rápidos">/);
    for (const s of shortcuts) {
        assert.ok(quick[0].includes(`href="${s.href}"`), s.key);
        assert.ok(quick[0].includes(s.label), s.label);
        assert.ok(quick[0].includes(`data-wo-icon="${s.icon}"`), s.icon);
    }
    // Antes de "Tu actividad": las acciones principales quedan arriba.
    assert.ok(html.indexOf('class="cpn-quick"') < html.indexOf('class="client-activity"'));
    assert.match(quick[0], /<label class="wo-sr-only" for="cpn-quick-search-input">/);
    assert.match(quick[0], /<form class="cpn-quick-search" id="cpn-quick-search" role="search"/);
});

// ------------------------------------------------------------ dashboard (vm)
function dashboard({ term = '', extras = {}, withPanel = true } = {}) {
    const nodes = new Map();
    const channel = { on() { return this; }, subscribe() { return this; } };
    const sdk = { auth: { async getSession() { return { data: { session: { access_token: 't', user: { id: 'u1' } } } }; } } };
    const shown = [];
    const window = { _supabase: sdk, location: { search: '', hash: '' }, WoClientQuoteProposal: Proposal };
    if (withPanel) {
        window.WoClientPanel = Panel;
        window.WoClientPanelUi = {
            getSearch: () => term,
            extrasFor: (q) => extras[q.quote_id] || {},
            afterRender: (info) => { shown.push(info.shown.map((q) => q.quote_id)); },
        };
    }
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, Date, URLSearchParams, URL, Intl, Promise,
        window,
        supabase: { createClient() { throw new Error('sin cliente real'); } },
        WeotziData: { channel() { return channel; } },
        document: {
            addEventListener() {}, body: { style: {} },
            getElementById(id) {
                if (!nodes.has(id)) nodes.set(id, { id, innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {} });
                return nodes.get(id);
            },
        },
    });
    vm.runInContext(read('public/shared/js/client-dashboard.js'), context, { filename: 'client-dashboard.js' });
    vm.runInContext('loadChatMessages = async () => {}; subscribeToChatMessages = () => {};', context);
    return { context, nodes, shown };
}

test('CP1: la tarjeta y el detalle muestran el código corto y conservan el quote_id real', async () => {
    const { context, nodes } = dashboard();
    context.quotation = responded({ quote_id: 'QN00007', short_code: 'K7P2QX' });
    const card = vm.runInContext('renderQuotationCard(quotation)', context);
    assert.match(card, /<span class="quotation-id">K7P2QX<\/span>/);
    assert.match(card, /<div class="quotation-card" data-quote-id="QN00007">/);
    assert.match(card, /id="unread-QN00007"/);
    vm.runInContext('currentQuotations = [quotation]', context);
    await vm.runInContext('viewQuotationDetail("QN00007")', context);
    assert.equal(nodes.get('modal-quote-id').textContent, 'K7P2QX');
    assert.match(nodes.get('quotation-detail-content').innerHTML, /data-wo-report data-kind="quotation" data-id="QN00007" data-label="Cotización K7P2QX"/);

    // Sin la columna nueva, todo queda como hoy.
    context.quotation = responded({ quote_id: 'QN00010' });
    assert.match(vm.runInContext('renderQuotationCard(quotation)', context), /<span class="quotation-id">QN00010<\/span>/);
    // El código se escapa como cualquier dato.
    context.quotation = responded({ quote_id: 'QN00011', short_code: '<b>x</b>' });
    assert.doesNotMatch(vm.runInContext('renderQuotationCard(quotation)', context), /<b>x<\/b>/);
    // Sin el modelo nuevo cargado, el panel sigue pintando (respaldo).
    const legacy = dashboard({ withPanel: false });
    legacy.context.quotation = responded({ quote_id: 'QN00012', short_code: 'AB12CD' });
    const legacyCard = vm.runInContext('renderQuotationCard(quotation)', legacy.context);
    assert.match(legacyCard, /<span class="quotation-id">AB12CD<\/span>/);
    assert.match(legacyCard, /Propuesta recibida/);
});

test('CP2: la tarjeta pinta los estados nuevos con su aclaración y a quién le toca', () => {
    const { context } = dashboard({ extras: { 'QN-S': { sessions: [{ status: 'proposed', session_date: '2099-01-01T10:00:00Z' }] } } });
    context.quotation = responded({ quote_id: 'QN-A', pending_counter_by: 'artist' });
    let card = vm.runInContext('renderQuotationCard(quotation)', context);
    assert.match(card, /<span class="quotation-status cpn-warning">Cambios propuestos por el artista<\/span>/);
    assert.match(card, /<p class="cpn-status-hint">Revisa los cambios y responde\.<\/p>/);
    assert.match(card, /Ver propuesta/);

    context.quotation = responded({ quote_id: 'QN-C', pending_counter_by: 'client' });
    card = vm.runInContext('renderQuotationCard(quotation)', context);
    assert.match(card, /Cambios propuestos por ti/);
    // Le toca al artista: no se le pide respuesta al cliente.
    assert.doesNotMatch(card, /Esperando tu respuesta/);
    assert.match(card, /wo-btn--ghost wo-btn--s" data-quote-id="QN-C" onclick="viewQuotationDetail/);

    context.quotation = responded({ quote_id: 'QN-S', quote_status: 'client_approved', final_budget_amount: '400000', final_budget_currency: 'ARS' });
    card = vm.runInContext('renderQuotationCard(quotation)', context);
    assert.match(card, /Sesión por confirmar/);
    assert.match(card, /wo-btn--accent wo-btn--s" data-quote-id="QN-S"/);
    assert.match(card, /Revisar/);
    assert.match(card, /Total acordado/);
});

test('CP1/CP3: el listado filtra por el buscador y los vacíos traen acciones', () => {
    const list = [
        responded({ quote_id: 'QN00007', short_code: 'K7P2QX' }),
        responded({ id: 8, quote_id: 'QN00008', short_code: 'ZZ91AB', artist_name: 'Martín Ochoa' }),
        { quote_id: 'QN-D', quote_status: 'in_progress' },
    ];
    const found = dashboard({ term: 'zz91' });
    found.context.list = list;
    vm.runInContext('currentQuotations = list; currentFilter = "all"; renderQuotations();', found.context);
    let html = found.nodes.get('quotations-list').innerHTML;
    assert.match(html, /data-quote-id="QN00008"/);
    assert.doesNotMatch(html, /data-quote-id="QN00007"/);
    assert.doesNotMatch(html, /client-drafts-notice/, 'buscando no se mezcla el aviso de borradores');
    assert.deepEqual(found.shown.at(-1), ['QN00008']);

    const none = dashboard({ term: 'nada' });
    none.context.list = list;
    vm.runInContext('currentQuotations = list; currentFilter = "all"; renderQuotations();', none.context);
    html = none.nodes.get('quotations-list').innerHTML;
    assert.match(html, /No encontramos cotizaciones para «nada»/);
    assert.match(html, /data-cpn-action="clear-search"/);

    const empty = dashboard();
    vm.runInContext('currentQuotations = []; currentFilter = "all"; renderQuotations();', empty.context);
    html = empty.nodes.get('quotations-list').innerHTML;
    assert.match(html, /Todavía no tienes cotizaciones/);
    assert.match(html, /href="\/quotation">Solicitar cotización<\/a>/);
    assert.match(html, /href="\/marketplace">Explorar artistas<\/a>/);
    assert.match(html, /href="\/job-board\/request">Publicar una idea<\/a>/);

    const filtered = dashboard();
    filtered.context.list = [responded()];
    vm.runInContext('currentQuotations = list; currentFilter = "completed"; renderQuotations();', filtered.context);
    html = filtered.nodes.get('quotations-list').innerHTML;
    assert.match(html, /No tienes cotizaciones en este estado/);
    assert.match(html, /data-cpn-action="show-all"/);
});

test('CP3: las solicitudes del dashboard se escapan, usan las mismas etiquetas y llevan a /client/requests', () => {
    const { context, nodes } = dashboard();
    context.reqs = [{
        id: 'r1"><img src=x>', request_code: '<i>JB</i>', status: 'open', tattoo_idea_description: '<script>alert(1)</script>',
        tattoo_body_part: '<b>Brazo</b>', client_budget_min: 100, client_budget_max: 200, client_budget_currency: 'USD',
        job_board_applications: [{ id: 'a1', status: 'pending' }, { id: 'a2', status: 'viewed' }, { id: 'a3', status: 'withdrawn' }],
        job_board_attachments: [{ file_url: 'javascript:alert(1)' }],
    }, { id: 'r2', request_code: 'JB-00002', status: 'expired', job_board_applications: [] }];
    vm.runInContext('jbRequests = reqs; renderJobBoardRequests();', context);
    const html = nodes.get('jb-requests-list').innerHTML;
    assert.doesNotMatch(html, /<script>alert|<img src=x>|<b>Brazo<\/b>|<i>JB<\/i>|javascript:/);
    assert.doesNotMatch(html, /onclick=/, 'sin handlers inline con ids interpolados');
    assert.match(html, /Propuestas recibidas/);
    assert.match(html, /Vencida/);
    assert.doesNotMatch(html, />open<|>expired<|Expirada/);
    assert.match(html, /2 \(1 sin ver\)/);
    assert.match(html, /href="\/client\/requests\?id=r2">\s*Ver solicitud\s*<\/a>/);
    assert.match(html, /href="\/client\/requests\?id=r1%22%3E%3Cimg%20src%3Dx%3E">\s*Ver postulaciones/);

    vm.runInContext('jbRequests = []; renderJobBoardRequests();', context);
    assert.match(nodes.get('jb-requests-list').innerHTML, /href="\/job-board\/request">Publicar una idea<\/a>/);
});

// ------------------------------------------------------------ contratos de página
test('CP2: /client/dashboard, /client/chats y /client/requests cargan el mismo modelo', () => {
    const dash = read('public/client/dashboard/index.html');
    assert.ok(dash.includes('/shared/css/client-panel.css'));
    const order = ['client-quote-proposal.js', 'client-panel-model.js', 'client-panel-ui.js', 'client-dashboard.js'].map((f) => dash.indexOf('/shared/js/' + f + '"'));
    assert.ok(order.every((i) => i > -1), 'scripts del panel presentes');
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'orden: propuesta → modelo → ui → dashboard');
    assert.match(dash, /<label class="wo-sr-only" for="cpn-quote-search">/);
    assert.match(dash, /<input class="wo-input" type="search" id="cpn-quote-search"/);

    const chats = read('public/client/chats/index.html');
    const chatOrder = ['client-quote-proposal.js', 'client-panel-model.js', 'client-chats.js'].map((f) => chats.indexOf('/shared/js/' + f + '"'));
    assert.ok(chatOrder.every((i) => i > -1));
    assert.deepEqual([...chatOrder].sort((a, b) => a - b), chatOrder);
    const chatsJs = read('public/shared/js/client-chats.js');
    assert.match(chatsJs, /let status = P\.statusOf\(t, ctx\);/);
    assert.match(chatsJs, /const ctx = session \? \{ sessions: \[session\] \} : \{\};/);
    assert.match(chatsJs, /const info = quoteStatusTag\(t\);/);
    // El respaldo dice lo mismo que el modelo.
    assert.ok(chatsJs.includes(`pending:          { label: '${Panel.STATUS.pending.label}'`));
    assert.ok(chatsJs.includes(`responded:        { label: '${Panel.STATUS.responded.label}'`));
    assert.match(chatsJs, /\['quote_expires_at', 'dispute_status'\]/);

    const reqs = read('public/client/requests/index.html');
    assert.ok(reqs.includes('/shared/css/client-panel.css'));
    const reqOrder = ['data/jobboard-repo.js', 'client-panel-model.js', 'client-panel-ui.js', 'client-requests.js'].map((f) => reqs.indexOf('/shared/js/' + f + '"'));
    assert.ok(reqOrder.every((i) => i > -1));
    assert.deepEqual([...reqOrder].sort((a, b) => a - b), reqOrder);
    const nav = reqs.match(/<nav class="wo-topbar-nav"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /href="\/client\/chats\/">Mensajes<\/a>/);
    assert.match(nav, /href="\/client\/favorites">Favoritos<\/a>/);
    assert.match(reqs, /<a class="wo-o-tile" href="\/client\/profile"/);
    assert.match(nav, /href="\/client\/dashboard#mis-cotizaciones">Cotizaciones<\/a>/);
    assert.match(read('public/shared/js/client-panel-ui.js'), /hash === '#mis-cotizaciones'\) call\('revealQuotationsPanel'\)/, 'ese enlace abre el listado al llegar');

    const reqJs = read('public/shared/js/client-requests.js');
    assert.match(reqJs, /Panel\.requestStatusOf\(req, \{ pendingOffers: offersFor\(req\) \}\)/);
    assert.match(reqJs, /CO\.listPendingByApplications\(ids\)/);
    assert.match(reqJs, /Panel\.emptyHtml\(Panel\.emptyState\('requests'\), \{ variant: 'ds' \}\)/);
    assert.match(reqJs, /'\/client\/chats\/\?quote=' \+ encodeURIComponent\(req\.resulting_quote_id\)/);
    assert.match(reqJs, /'\/client\/dashboard\?quote=' \+ encodeURIComponent\(req\.resulting_quote_id\)/);
    assert.match(reqJs, /data-wo-favorite data-kind="artist" data-id="' \+ esc\(app\.artist_id\)/);
    assert.match(reqJs, /data-wo-report data-kind="artist" data-id="' \+ esc\(app\.artist_id\)/);

    const repo = read('public/shared/js/data/jobboard-repo.js');
    const method = repo.slice(repo.indexOf('async listPendingByApplications'), repo.indexOf('// Crea una contraoferta'));
    assert.match(method, /from\('job_board_counter_offers'\)/);
    assert.match(method, /\.in\('application_id', chunk\)/);
    assert.match(method, /\.eq\('status', 'pendiente'\)/);
});

test('contratos con otros frentes: favoritos y denuncias quedan como huecos que no molestan', () => {
    const dash = read('public/shared/js/client-dashboard.js');
    assert.match(dash, /class="cpn-fav cpn-fav--media" data-wo-favorite data-kind="artist" data-id="\$\{escapeFeedHtml\(artist\.user_id\)\}"/);
    assert.match(dash, /data-label="\$\{name\}" data-image="\$\{escapeFeedHtml\(artist\.profile_picture \|\| ''\)\}"><\/button>/);
    const css = read('public/shared/css/client-panel.css');
    assert.match(css, /\.cpn-fav:empty\{display:none\}/);
    assert.match(css, /\.cpn-report\{display:none;/);
    assert.match(css, /html\[data-cpn-report="on"\] \.cpn-report\{display:inline-flex\}/);
    const ui = read('public/shared/js/client-panel-ui.js');
    assert.match(ui, /ensureModule\('wo-favorites\.js'\)/);
    assert.match(ui, /ensureModule\('wo-report\.js'/);
    assert.match(ui, /script\[src\*="\/' \+ file \+ '"\]/, 'no se carga dos veces el módulo de otro frente');
});

test('CSS del panel: solo tokens, cortes responsive y nav del cliente visible en mobile', () => {
    const css = read('public/shared/css/client-panel.css');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'solo tokens');
    assert.doesNotMatch(css, /border-radius:\s*[1-9]/);
    for (const cut of ['1151px', '1024px', '768px', '480px']) assert.ok(css.includes(`@media (max-width:${cut})`), cut);
    assert.match(css, /\.crq-page \.wo-topbar-nav,\.cpa-topbar \.wo-topbar-nav\{display:flex;order:3;width:100%;overflow-x:auto/);
    assert.match(css, /\.wo-topbar-item\{[^}]*min-height:var\(--tap-target-min\)/, 'destinos de la nav con alto táctil');
    assert.match(css, /\.client-page \.quotation-status\{white-space:normal/);
    assert.match(css, /input:focus-visible \+ \.knob\{box-shadow:var\(--shadow-focus\)\}/);
});

// ------------------------------------------------------------ CP4 · preferencias
test('CP4: el modelo del navegador decide igual que lib/notification-prefs.js', () => {
    const defaults = Notif.normalizeDefaults(logic.clientNotificationMatrix(prefs));
    const cases = [
        null, {}, 'x', [],
        { mensajes: { email: false } },
        { mensajes: { email: true, push: true } },
        { mensajes: { email: 'no' } },
        { cotizaciones: { push: true }, postulaciones: { email: false, push: false } },
        { email_updates: false },
        { email_updates: false, mensajes: { email: true } },
        { email_updates: true, push: false, weekly_discovery: true },
        { email_updates: false, cotizaciones: { push: true } },
    ];
    for (const saved of cases) {
        for (const kind of Object.keys(prefs.CLIENT_NOTIF_DEFAULTS)) {
            for (const channel of Notif.CHANNELS) {
                assert.equal(
                    Notif.effective(saved, kind, channel, defaults),
                    prefs.resolvePreference(saved, kind, channel, { defaults: prefs.CLIENT_NOTIF_DEFAULTS }),
                    `${JSON.stringify(saved)} ${kind}/${channel}`
                );
            }
        }
    }
    assert.deepEqual(Notif.KINDS.map((k) => k.key).sort(), Object.keys(prefs.CLIENT_NOTIF_DEFAULTS).sort());
    assert.deepEqual(Notif.CHANNELS, ['email', 'push']);
});

test('CP4: el "Email" apagado en el registro del cliente se respeta al enviar (y el artista no cambia)', async () => {
    const client = { defaults: prefs.CLIENT_NOTIF_DEFAULTS };
    assert.equal(prefs.resolvePreference({ email_updates: false }, 'mensajes', 'email', client), false);
    assert.equal(prefs.resolvePreference({ email_updates: false }, 'cotizaciones', 'email', client), false);
    assert.equal(prefs.resolvePreference({ email_updates: false, mensajes: { email: true } }, 'mensajes', 'email', client), true);
    assert.equal(prefs.resolvePreference({ email_updates: true }, 'mensajes', 'email', client), true);
    assert.equal(prefs.resolvePreference({ email_updates: false }, 'mensajes', 'push', client), prefs.CLIENT_NOTIF_DEFAULTS.mensajes.push);
    // La matriz del artista no mira ese campo.
    assert.equal(prefs.resolvePreference({ email_updates: false }, 'mensajes', 'email'), true);

    const rows = {
        clients_db: { user_id: 'c1' },
        user_preferences: { user_id: 'c1', notification_prefs: { email_updates: false, postulaciones: { email: true } } },
    };
    const query = (table) => {
        const builder = { select: () => builder, eq: () => builder, ilike: () => builder, limit: () => builder, single: () => builder, execute: async () => rows[table] };
        return builder;
    };
    assert.equal(await prefs.shouldNotify({ id: 'c1' }, 'cotizaciones', 'email', { query }, 'client'), false);
    assert.equal(await prefs.shouldNotify({ id: 'c1' }, 'postulaciones', 'email', { query }, 'client'), true);
    assert.equal(await prefs.shouldNotify({ email: 'a@b.co' }, 'mensajes', 'email', { query }, 'client'), false);
});

test('CP4: matriz y parche — se escribe solo el evento tocado, conservando el otro canal', () => {
    const defaults = Notif.normalizeDefaults(null);
    const rows = Notif.matrix({ mensajes: { email: false, push: true } }, defaults);
    assert.deepEqual(rows.map((r) => r.key), ['postulaciones', 'mensajes', 'cotizaciones']);
    assert.deepEqual(rows.find((r) => r.key === 'mensajes'), { key: 'mensajes', label: 'Mensajes', help: Notif.KINDS[1].help, email: false, push: true });
    assert.equal(rows.find((r) => r.key === 'postulaciones').email, true);

    assert.deepEqual(Notif.patchFor({ mensajes: { email: false, sms: true }, cotizaciones: { email: false } }, 'mensajes', 'push', true), { mensajes: { email: false, sms: true, push: true } });
    assert.deepEqual(Notif.patchFor(null, 'cotizaciones', 'email', false), { cotizaciones: { email: false } });
    assert.deepEqual(Notif.patchFor({ mensajes: 'roto' }, 'mensajes', 'push', 1), { mensajes: { push: true } });
    assert.equal(Notif.patchFor({}, 'mensajes', 'sms', true), null);
    assert.equal(Notif.patchFor({}, '__proto__', 'email', true), null);
    assert.equal(Notif.patchFor({}, 'Mensajes<script>', 'email', true), null);

    // Si el servidor suma un evento o cambia un valor por defecto, la matriz lo sigue.
    const server = Notif.normalizeDefaults({ kinds: [{ key: 'mensajes', defaults: { email: true, push: true } }, { key: 'sesiones', defaults: { email: true, push: true } }, { key: 'x y', defaults: { email: true } }] });
    assert.equal(server.mensajes.push, true);
    assert.deepEqual(server.sesiones, { email: true, push: true });
    assert.equal(server['x y'], undefined);
    const extended = Notif.matrix({}, server);
    assert.equal(extended.find((r) => r.key === 'mensajes').push, true);
    assert.equal(extended.at(-1).label, 'Sesiones');
});

test('CP4: GET /api/client/panel/notification-matrix sale de lib/notification-prefs.js', () => {
    const matrix = logic.clientNotificationMatrix(prefs);
    assert.deepEqual(matrix.channels, ['email', 'push']);
    assert.deepEqual(matrix.kinds.map((k) => k.key), Object.keys(prefs.CLIENT_NOTIF_DEFAULTS));
    for (const kind of matrix.kinds) {
        assert.deepEqual(kind.defaults, { email: prefs.CLIENT_NOTIF_DEFAULTS[kind.key].email === true, push: prefs.CLIENT_NOTIF_DEFAULTS[kind.key].push === true });
        assert.equal('sms' in kind.defaults, false);
    }
    assert.deepEqual(logic.clientNotificationMatrix({ CLIENT_NOTIF_DEFAULTS: { ok_1: { email: true, push: true }, 'Mal Nombre': { email: true }, roto: null } }).kinds, [{ key: 'ok_1', defaults: { email: true, push: true } }]);
    assert.deepEqual(logic.clientNotificationMatrix(null).kinds, []);

    const routes = [];
    const app = { get(route, handler) { routes.push({ route, handler }); } };
    require('../lib/routes/cliente-panel').register(app, { notificationPrefs: { CLIENT_NOTIF_DEFAULTS: { mensajes: { email: true, push: true, sms: false } } } });
    assert.deepEqual(routes.map((r) => r.route), ['/api/client/panel/notification-matrix']);
    const headers = {};
    let body = null;
    routes[0].handler({}, { set(k, v) { headers[k] = v; }, json(payload) { body = payload; return payload; } });
    assert.deepEqual(body, { success: true, role: 'client', channels: ['email', 'push'], kinds: [{ key: 'mensajes', defaults: { email: true, push: true } }] });
    assert.match(headers['Cache-Control'], /max-age=300/);

    const server = read('server.js');
    const line = "require('./lib/routes/cliente-panel').register(app);";
    assert.equal(server.split(line).length - 1, 1, 'una sola línea de registro');
    assert.ok(server.indexOf(line) < server.indexOf('rosterRoutes.register(app'), 'antes de las redirecciones legacy y del estático');
    assert.ok(server.indexOf(line) > server.indexOf("app.use('/api/', apiLimiter);"), 'detrás del rate limit general');
});

test('CP4: /client/profile — toggles de email y push, alias repetido y guardado verificado', () => {
    const html = read('public/client/profile/index.html');
    const section = html.slice(html.indexOf('data-panel="notificaciones"'), html.indexOf('data-panel="configuracion"'));
    assert.doesNotMatch(section, /Próximamente|cpa-soon/);
    for (const kind of Notif.KINDS) {
        for (const channel of Notif.CHANNELS) {
            assert.match(section, new RegExp(`<input type="checkbox" data-notif="${kind.key}" data-channel="${channel}"[^>]*aria-label="${kind.label} por ${channel}"`), `${kind.key}/${channel}`);
        }
        assert.ok(section.includes(kind.help), kind.key);
    }
    assert.match(section, /id="cpa-notif-rows" aria-busy="true"/);
    assert.ok(html.indexOf('/shared/js/client-notif-model.js"') > -1);
    assert.ok(html.indexOf('/shared/js/client-notif-model.js"') < html.indexOf('/shared/js/client-profile.js"'));
    assert.ok(html.indexOf('/shared/js/data/account-repo.js"') < html.indexOf('/shared/js/client-profile.js"'));
    const nav = html.match(/<nav class="wo-topbar-nav" aria-label="Navegación principal de cliente">[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /href="\/client\/requests">Solicitudes<\/a>/);
    assert.match(nav, /href="\/client\/chats\/">Mensajes<\/a>/);
    assert.match(nav, /href="\/client\/favorites">Favoritos<\/a>/);
    assert.match(html, /id="cpa-username"[^>]*aria-describedby="cpa-username-error"/);
    assert.match(html, /<p class="cpa-field-error" id="cpa-username-error" role="alert"><\/p>/);

    const js = read('public/shared/js/client-profile.js');
    assert.match(js, /const NOTIF_MATRIX_PATH = '\/api\/client\/panel\/notification-matrix';/);
    assert.match(js, /Notif\.patchFor\(localNotif, kind, channel, value\)/);
    assert.match(js, /Prefs\.saveSection\(sessionUser\.id, 'notification_prefs', patch\)/);
    assert.match(js, /\.updateByUserId\(sessionUser\.id, updateData\)\.select\('user_id'\)/);
    assert.match(js, /error\.code === '23505'/);
    assert.match(js, /Ese alias ya está en uso\. Elige otro\./);
    assert.match(js, /new CustomEvent\('wo:notif-pref-changed'/);
    // Las columnas que guarda existen en clients_db (esquema vivo, 2026-11-16).
    const liveColumns = ['full_name', 'public_username', 'country', 'public_profile_enabled', 'whatsapp', 'city_residence', 'profile_completed_at', 'profile_picture'];
    const block = js.slice(js.indexOf('const updateData = {'), js.indexOf('// .select() confirma'));
    const written = [...block.matchAll(/(?:^|\s|\.)([a-z_]+)(?::| =)/gm)].map((m) => m[1]).filter((k) => /_|country|whatsapp/.test(k) && k !== 'updateData');
    assert.ok(written.length >= liveColumns.length);
    for (const column of written) assert.ok(liveColumns.includes(column), `columna desconocida: ${column}`);
    assert.doesNotMatch(block, /terms_accepted_at|terms_version/, 'los Términos los sella el servidor (guard en clients_db)');
});

// ------------------------------------------------------------ idioma
test('textos nuevos en español neutro (tuteo, sin voseo)', () => {
    // Formas voseantes (imperativo y presente con acento final) y "vos"; las formas de tú (busca, revisa, cuenta) no cuentan.
    const voseo = /(?<![a-záéíóúñ])(tenés|querés|podés|sabés|hacés|elegí|contanos|contale|contá|probá|revisá|revisalos|mirá|escribí|subí|hacé|fijate|avisanos|recargá|actualizá|buscá|iniciá|completá|confirmá|ingresá|seguí|recibí|vos)(?![a-záéíóúñ])/i;
    for (const rel of [
        'public/shared/js/client-panel-model.js',
        'public/shared/js/client-notif-model.js',
        'public/shared/js/client-panel-ui.js',
        'lib/cliente-panel.js',
        'lib/routes/cliente-panel.js',
    ]) {
        const text = read(rel).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
        const strings = [...text.matchAll(/'([^'\n]{4,})'/g)].map((m) => m[1]).join('\n');
        assert.doesNotMatch(strings, voseo, rel);
    }
    const quick = read('public/client/dashboard/index.html').match(/<div class="cpn-quick">[\s\S]*?<\/form>\s*<\/div>/)[0];
    assert.doesNotMatch(quick, voseo);
    const toolbar = read('public/client/dashboard/index.html').match(/<div class="cpn-toolbar">[\s\S]*?<\/div>\s*<p class="cpn-search-count/)[0];
    assert.doesNotMatch(toolbar, voseo);
    assert.doesNotMatch(read('public/client/profile/index.html').match(/<p class="cpa-matrix-note">[\s\S]*?<\/p>/)[0], voseo);
});
