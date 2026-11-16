'use strict';
// Ronda 2 · frente cliente-panel: las páginas ejecutadas con un DOM mínimo.
//   - client-panel-ui.js: buscador del dashboard, datos extra y módulos de otros frentes.
//   - client-requests.js: índice de /client/requests con el modelo compartido.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const Panel = require('../public/shared/js/client-panel-model.js');

function node(id) {
    return {
        id, value: '', hidden: false, textContent: '', innerHTML: '', disabled: false, style: {}, listeners: {}, focused: 0,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        focus() { this.focused += 1; },
        contains() { return true; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, remove() {},
        reset() {},
    };
}

// ------------------------------------------------------------ client-panel-ui.js
function loadUi({ ids = ['cpn-quote-search', 'cpn-quick-search-input', 'cpn-quote-search-clear', 'cpn-quick-search', 'cpn-search-count', 'quotations-list'], hash = '', scripts = [], selectors = {}, favoritesLoader = null } = {}) {
    const nodes = Object.fromEntries(ids.map((id) => [id, node(id)]));
    nodes['cpn-quote-search-clear'] && (nodes['cpn-quote-search-clear'].hidden = true);
    const calls = [];
    const appended = [];
    const docListeners = {};
    const html = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const document = {
        readyState: 'complete', documentElement: html,
        head: { appendChild(el) { appended.push(el); } },
        getElementById: (id) => nodes[id] || null,
        addEventListener(type, fn) { docListeners[type] = fn; },
        createElement: () => ({ remove() { this.removed = true; } }),
        querySelector(selector) {
            const script = selector.match(/^script\[src\*="\/(.+)"\]$/);
            if (script) return scripts.includes(script[1]) || appended.some((el) => !el.removed && el.src.endsWith('/' + script[1])) ? {} : null;
            return selectors[selector] ? {} : null;
        },
    };
    const window = {
        WoClientPanel: Panel, location: { hash, pathname: '/client/dashboard' },
        filterQuotations: (f) => { calls.push(['filterQuotations', f]); },
        renderQuotations: () => { calls.push(['renderQuotations']); },
        revealQuotationsPanel: () => { calls.push(['revealQuotationsPanel']); },
        viewQuotationDetail: (id) => { calls.push(['viewQuotationDetail', id]); },
    };
    // Cargador de favoritos de config-manager.js (está en las páginas reales del panel).
    if (favoritesLoader) window.WoFavoritesLoader = favoritesLoader;
    const context = vm.createContext({ window, document, console: { warn() {}, log() {}, error() {} }, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, Promise });
    vm.runInContext(read('public/shared/js/client-panel-ui.js'), context, { filename: 'client-panel-ui.js' });
    return { ui: window.WoClientPanelUi, nodes, calls, appended, html, docListeners, window };
}

test('buscador del dashboard: escribir filtra en "Todas", limpiar vuelve al listado y cuenta los resultados', () => {
    const { ui, nodes, calls } = loadUi();
    const input = nodes['cpn-quote-search'];
    input.value = '  K7P2QX  ';
    input.listeners.input();
    assert.equal(ui.getSearch(), 'K7P2QX');
    assert.deepEqual(calls.at(-1), ['filterQuotations', 'all']);
    assert.equal(nodes['cpn-quick-search-input'].value, 'K7P2QX', 'los dos campos quedan sincronizados');
    assert.equal(input.value, '  K7P2QX  ', 'no pisa lo que la persona está escribiendo');
    assert.equal(nodes['cpn-quote-search-clear'].hidden, false);

    ui.afterRender({ shown: [{ quote_id: 'QN1' }] });
    assert.equal(nodes['cpn-search-count'].textContent, '1 resultado');
    ui.afterRender({ shown: [{ quote_id: 'QN1' }, { quote_id: 'QN2' }] });
    assert.equal(nodes['cpn-search-count'].textContent, '2 resultados');

    nodes['cpn-quote-search-clear'].listeners.click();
    assert.equal(ui.getSearch(), '');
    assert.deepEqual(calls.at(-1), ['renderQuotations']);
    assert.equal(input.value, '');
    assert.equal(nodes['cpn-search-count'].textContent, '');
    assert.equal(nodes['cpn-quote-search-clear'].hidden, true);
    assert.equal(input.focused, 1);

    // Un término larguísimo se recorta (no viaja nada raro al render).
    ui.setSearch('x'.repeat(500));
    assert.equal(ui.getSearch().length, 80);
});

test('buscador rápido: abre el listado y, si el código coincide exacto, la cotización', () => {
    const { ui, nodes, calls } = loadUi();
    const list = [{ quote_id: 'QN00007', short_code: 'K7P2QX' }, { quote_id: 'QN00008', short_code: 'K7P2ZZ' }];
    // El dashboard informa lo que quedó a la vista después de cada render.
    const submit = (term) => {
        calls.length = 0;
        nodes['cpn-quick-search-input'].value = term;
        const event = { prevented: false, preventDefault() { this.prevented = true; } };
        // filterQuotations (del dashboard) repinta y avisa: se simula aquí.
        ui.afterRender({ shown: Panel.searchQuotations(list, term) });
        nodes['cpn-quick-search'].listeners.submit(event);
        assert.equal(event.prevented, true);
        return calls.map((c) => c.join(':'));
    };
    assert.deepEqual(submit('k7p-2qx'), ['filterQuotations:all', 'revealQuotationsPanel', 'viewQuotationDetail:QN00007']);
    assert.deepEqual(submit('QN00008'), ['filterQuotations:all', 'revealQuotationsPanel', 'viewQuotationDetail:QN00008']);
    // Coincidencia parcial (dos resultados): no abre ninguna, deja el foco en el buscador del listado.
    const before = nodes['cpn-quote-search'].focused;
    assert.deepEqual(submit('K7P2'), ['filterQuotations:all', 'revealQuotationsPanel']);
    assert.equal(nodes['cpn-quote-search'].focused, before + 1);
    // Vacío: solo muestra el listado.
    assert.deepEqual(submit('   '), ['renderQuotations', 'revealQuotationsPanel']);
});

test('estados vacíos: "Limpiar búsqueda" y "Ver todas" actúan solo dentro del listado', () => {
    const { ui, nodes, calls, docListeners } = loadUi();
    ui.setSearch('algo');
    const target = (action, inside = true) => ({ closest: () => ({ getAttribute: () => action }), inside });
    nodes['quotations-list'].contains = (t) => t && t.getAttribute && true;
    docListeners.click({ target: target('clear-search') });
    assert.equal(ui.getSearch(), '');
    calls.length = 0;
    docListeners.click({ target: target('show-all') });
    assert.deepEqual(calls, [['filterQuotations', 'all']]);
    // Fuera del listado no hace nada.
    calls.length = 0;
    nodes['quotations-list'].contains = () => false;
    docListeners.click({ target: target('show-all') });
    assert.deepEqual(calls, []);
    docListeners.click({ target: { closest: () => null } });
    assert.deepEqual(calls, []);
});

test('datos extra: las sesiones del cliente alimentan "Sesión por confirmar" sin romper si fallan', async () => {
    const { ui, window } = loadUi();
    const quotations = [
        { id: 7, quote_id: 'QN7', quote_status: 'client_approved', artist_responded_at: 'x', final_budget_amount: '1' },
        { id: 8, quote_id: 'QN8', quote_status: 'client_approved', artist_responded_at: 'x', final_budget_amount: '1' },
        { quote_id: 'QN9', quote_status: 'pending' },
    ];
    assert.equal(await ui.loadExtras(quotations), false, 'sin repo de sesiones no hay nada que hacer');

    let asked = null;
    window.WeotziData = { Sessions: { listForClient: async (ids) => { asked = ids; return [
        { quotation_id: 7, status: 'scheduled', session_date: '2099-01-01T10:00:00Z' },
        { quotation_id: 8, status: 'pending_confirmation', session_date: '2099-01-02T10:00:00Z' },
        { quotation_id: null, status: 'proposed' },
    ]; } } };
    assert.equal(await ui.loadExtras(quotations), true);
    assert.deepEqual(Array.from(asked), [7, 8]);
    assert.equal(Panel.statusOf(quotations[1], ui.extrasFor(quotations[1])).label, 'Sesión por confirmar');
    assert.equal(Panel.statusOf(quotations[0], ui.extrasFor(quotations[0])).overlay, null);
    assert.equal(Object.keys(ui.extrasFor(quotations[2])).length, 0);

    // Misma respuesta: ninguna etiqueta cambió, no hace falta repintar.
    assert.equal(await ui.loadExtras(quotations), false, 'sin cambios');
    // La sesión se confirmó: la etiqueta pintada ya no corresponde, hay que repintar.
    window.WeotziData.Sessions.listForClient = async () => [{ quotation_id: 7, status: 'scheduled', session_date: '2099-01-01T10:00:00Z' }];
    assert.equal(await ui.loadExtras(quotations), true, 'la etiqueta se va');
    assert.equal(Panel.statusOf(quotations[1], ui.extrasFor(quotations[1])).overlay, null);
    assert.equal(await ui.loadExtras(quotations), false, 'nada por confirmar: no hace falta repintar');
    window.WeotziData.Sessions.listForClient = async () => { throw new Error('offline'); };
    assert.equal(await ui.loadExtras(quotations), false);
    assert.equal(await ui.loadExtras([]), false);
});

// DB-07 / CF-02: los datos reales de sesiones (client_confirmation) y de
// negociación (quotation_proposals) llegan a las etiquetas de las tarjetas.
test('datos extra reales: sesión por confirmar, contrapropuesta y cambio al acuerdo pendientes', async () => {
    const { ui, window } = loadUi();
    const base = { artist_responded_at: 'x', artist_budget_amount: '100', final_budget_amount: '100', quote_expires_at: '2099-01-01T00:00:00Z' };
    const quotations = [
        { id: 1, quote_id: 'QN1', quote_status: 'client_approved', ...base },
        { id: 2, quote_id: 'QN2', quote_status: 'responded', ...base, final_budget_amount: null },
        { id: 3, quote_id: 'QN3', quote_status: 'client_approved', ...base },
        { id: 4, quote_id: 'QN4', quote_status: 'client_approved', ...base },
        { id: 5, quote_id: 'QN5', quote_status: 'client_approved', ...base },
        { id: 6, quote_id: 'QN6', quote_status: 'client_rejected', ...base },
    ];
    const asked = { sessions: null, proposals: null };
    const future = '2099-01-02T10:00:00Z';
    window.WeotziData = {
        // Filas de la RPC list_client_quotation_sessions tras la migración 20261116150000.
        Sessions: { listForClient: async (ids) => { asked.sessions = ids; return [
            { quotation_id: 1, status: 'scheduled', session_date: future, client_confirmation: 'pending', pending_change_by: null },
            { quotation_id: 5, status: 'scheduled', session_date: future, client_confirmation: 'confirmed', pending_change_by: 'artist' },
            { quotation_id: 3, status: 'scheduled', session_date: future, client_confirmation: 'confirmed', pending_change_by: null },
        ]; } },
        // Filas de quotation_proposals con status 'pending' (una por cotización).
        Proposals: { listPendingByQuotationIds: async (ids) => { asked.proposals = ids; return [
            { quotation_id: 2, kind: 'counter', proposed_by: 'client', status: 'pending', created_at: '2026-11-16T10:00:00Z' },
            { quotation_id: 3, kind: 'amendment', proposed_by: 'artist', status: 'pending', created_at: '2026-11-16T10:00:00Z' },
            { quotation_id: 4, kind: 'amendment', proposed_by: 'client', status: 'pending', created_at: '2026-11-16T10:00:00Z' },
            { quotation_id: 6, kind: 'counter', proposed_by: 'client', status: 'pending', created_at: '2026-11-16T10:00:00Z' },
            { quotation_id: 1, kind: 'amendment', proposed_by: 'artist', status: 'accepted', created_at: '2026-11-16T10:00:00Z' },
            null,
        ]; } },
    };
    assert.equal(await ui.loadExtras(quotations), true);
    assert.deepEqual(Array.from(asked.sessions), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(Array.from(asked.proposals), [1, 2, 3, 4, 5, 6]);
    const status = (i) => Panel.statusOf(quotations[i], ui.extrasFor(quotations[i]));
    assert.deepEqual([status(0).overlay, status(0).label], ['session_to_confirm', 'Sesión por confirmar']);
    assert.deepEqual([status(1).overlay, status(1).label, status(1).waitingOn], ['counter_by_client', 'Cambios propuestos por ti', 'artist']);
    assert.deepEqual([status(2).overlay, status(2).label, status(2).waitingOn], ['agreement_change', 'Cambios al acuerdo pendientes de aprobar', 'client']);
    assert.deepEqual([status(3).overlay, status(3).waitingOn], ['agreement_change', 'artist']);
    assert.equal(status(4).overlay, 'session_to_confirm', 'el artista pidió mover la sesión');
    assert.equal(status(5).overlay, null, 'una cotización rechazada no lleva etiquetas nuevas');
    assert.deepEqual(JSON.parse(JSON.stringify(ui.extrasFor(quotations[1]))), { counterBy: 'client' });
    assert.deepEqual(JSON.parse(JSON.stringify(ui.extrasFor(quotations[3]))), { agreementChangePending: true, agreementChangeBy: 'client' });
    assert.deepEqual(Object.keys(ui.extrasFor({ quote_id: 'sin-id' })), []);

    // Nada cambió: no se repinta. El artista responde la contrapropuesta: la etiqueta se va.
    assert.equal(await ui.loadExtras(quotations), false);
    const pending = await window.WeotziData.Proposals.listPendingByQuotationIds([]);
    window.WeotziData.Proposals.listPendingByQuotationIds = async () => pending.filter((p) => p && p.quotation_id !== 2);
    assert.equal(await ui.loadExtras(quotations), true);
    assert.equal(status(1).overlay, null);
    assert.equal(status(2).overlay, 'agreement_change');

    // Si una lectura falla, la otra sigue y lo que ya había no se pierde.
    window.WeotziData.Proposals.listPendingByQuotationIds = async () => { throw new Error('offline'); };
    assert.equal(await ui.loadExtras(quotations), false);
    assert.equal(status(2).overlay, 'agreement_change');
    assert.equal(status(0).overlay, 'session_to_confirm');
    window.WeotziData.Proposals.listPendingByQuotationIds = () => { throw new Error('síncrono'); };
    assert.equal(await ui.loadExtras(quotations), false);

    // Solo negociación (página sin el repo de sesiones) o solo sesiones: funciona igual.
    const only = loadUi();
    only.window.WeotziData = { Proposals: { listPendingByQuotationIds: async () => [{ quotation_id: 2, kind: 'counter', proposed_by: 'client', status: 'pending' }] } };
    assert.equal(await only.ui.loadExtras(quotations), true);
    assert.equal(Panel.statusOf(quotations[1], only.ui.extrasFor(quotations[1])).overlay, 'counter_by_client');
});

test('módulos de otros frentes: se piden una sola vez, solo si hay botones, y nunca si ya están en la página', () => {
    const none = loadUi();
    assert.equal(none.appended.length, 0, 'sin botones no se pide nada');

    // Favoritos, camino normal (FE-01): el panel delega en el cargador de config-manager.js,
    // que pide CSS + modelo + módulo en orden. No inserta wo-favorites.js por su cuenta: si lo
    // hiciera, el cargador lo daría por presente y pondría el modelo DETRÁS del módulo.
    let loads = 0;
    const fav = loadUi({ selectors: { '[data-wo-favorite]': true }, favoritesLoader: { load() { loads += 1; } } });
    assert.equal(loads, 1, 'al arrancar, con corazones en la página');
    assert.equal(fav.appended.length, 0, 'ningún <script> de favoritos propio');
    fav.ui.ensureModules();
    assert.equal(loads, 2, 'cada tanda de corazones vuelve a avisar al cargador (que ignora las repetidas)');
    assert.equal(fav.appended.length, 0);
    const broken = loadUi({ selectors: { '[data-wo-favorite]': true }, favoritesLoader: { load: 'no es función' } });
    assert.deepEqual(broken.appended.map((el) => el.src), ['/shared/js/wo-favorites-model.js'], 'un cargador raro no deja la página sin corazones');

    // Respaldo (página sin config-manager.js): primero el modelo y, recién cuando cargó, el módulo.
    const bare = loadUi({ selectors: { '[data-wo-favorite]': true } });
    assert.deepEqual(bare.appended.map((el) => el.src), ['/shared/js/wo-favorites-model.js']);
    bare.ui.ensureModules();
    bare.ui.ensureModules();
    assert.equal(bare.appended.length, 1, 'no se duplica el script ni se adelanta el módulo');
    bare.appended[0].onload();
    assert.deepEqual(bare.appended.map((el) => el.src), ['/shared/js/wo-favorites-model.js', '/shared/js/wo-favorites.js']);
    bare.appended[1].onload();
    bare.ui.ensureModules();
    assert.equal(bare.appended.length, 2);
    // Si el archivo no existe todavía (otro frente), se retira sin ruido.
    const missing = loadUi({ selectors: { '[data-wo-favorite]': true } });
    missing.appended[0].onerror();
    assert.equal(missing.appended[0].removed, true);
    missing.ui.ensureModules();
    assert.equal(missing.appended.length, 1, 'no reintenta en bucle ni pide el módulo sin su modelo');

    const present = loadUi({ selectors: { '[data-wo-favorite]': true }, scripts: ['wo-favorites-model.js', 'wo-favorites.js'] });
    assert.equal(present.appended.length, 0, 'ya los cargó su propio frente');

    // CF-09: el panel del cliente no pide wo-report.js (las denuncias son de artistas y estudios).
    const report = loadUi({ selectors: { '[data-wo-report]': true } });
    assert.deepEqual(report.appended.map((el) => el.src), []);
    assert.equal(report.html.attrs['data-cpn-report'], undefined);

    const beta = loadUi({ selectors: { '[data-wo-favorite]': true } });
    assert.equal(beta.ui.appPath('/shared/js/x.js'), '/shared/js/x.js');
    beta.window.WEOTZI_BASE_PATH = '/beta/';
    assert.equal(beta.ui.appPath('/shared/js/x.js'), '/beta/shared/js/x.js');
    assert.equal(beta.ui.appPath('/beta/shared/js/x.js'), '/beta/shared/js/x.js');
});

test('llegar con #mis-cotizaciones abre el listado de cotizaciones', () => {
    assert.deepEqual(loadUi({ hash: '#mis-cotizaciones' }).calls, [['revealQuotationsPanel']]);
    assert.deepEqual(loadUi({ hash: '#otra' }).calls, []);
});

// ------------------------------------------------------------ client-requests.js
function loadRequests({ requests, offers = [], search = '', applicationOffers = {} }) {
    const nodes = new Map();
    const get = (id) => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
    const docListeners = {};
    const asked = { pending: [] };
    const location = { search, pathname: '/client/requests' };
    const WeotziData = {
        getClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 't' } } }) } }),
        removeChannel() {},
        Clients: { getByUserId: async () => ({ data: { user_id: 'u1' } }) },
        Artists: { getByUserId: async () => ({ data: null }), listByUserIds: async () => ({ data: [{ user_id: 'art1', name: 'Lau <Ink>', username: 'lau' }] }) },
        JobBoard: {
            Requests: { listForClient: async () => requests, getById: async (id) => requests.find((r) => r.id === id) || null },
            Applications: { markViewed: async () => false },
            CounterOffers: {
                listPendingByApplications: async (ids) => { asked.pending.push(ids); return offers; },
                listByApplication: async (id) => applicationOffers[id] || [],
            },
            Realtime: { subscribeApplicationsForRequest: () => ({}) },
        },
    };
    const window = { WoClientPanel: Panel, WeotziData, addEventListener() {}, scrollTo() {}, location };
    const document = { body: node('body'), getElementById: get, addEventListener(type, fn) { docListeners[type] = fn; } };
    const context = vm.createContext({
        window, document, location, WeotziData, history: { pushState() {} }, URLSearchParams, Intl, Date, Promise, Set, Math,
        console: { log() {}, warn() {}, error() {} }, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    });
    vm.runInContext(read('public/shared/js/client-requests.js'), context, { filename: 'client-requests.js' });
    // init() no espera a route(): se deja terminar el render asíncrono (seguimiento).
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    return { nodes, get, docListeners, asked, init: async () => { await docListeners.DOMContentLoaded(); await settle(); await settle(); } };
}

const baseRequest = (over = {}) => ({
    id: 'r1', request_code: 'JB-00012', status: 'open', created_at: '2026-11-10T12:00:00Z',
    tattoo_idea_description: 'Un colibrí <b>pequeño</b> en la muñeca', tattoo_style: ['Acuarela'], tattoo_body_part: 'Muñeca',
    client_budget_min: 100, client_budget_max: 200, client_budget_currency: 'USD',
    job_board_applications: [{ id: 'a1', artist_id: 'art1', status: 'pending', created_at: '2026-11-11T12:00:00Z', message: 'Hola' }],
    job_board_attachments: [], job_board_request_stats: { view_count: 3 }, ...over,
});

test('/client/requests: el índice usa las etiquetas del modelo, la contraoferta pendiente y el buscador', async () => {
    const requests = [
        baseRequest(),
        baseRequest({ id: 'r2', request_code: 'JB-00099', display_code: 'JB-00099', status: 'expired', tattoo_idea_description: 'Lettering en el antebrazo', job_board_applications: [] }),
        baseRequest({ id: 'r3', request_code: 'JB-00100', status: 'accepted', accepted_application_id: 'a3', job_board_applications: [{ id: 'a3', artist_id: 'art1', status: 'accepted' }] }),
    ];
    const page = loadRequests({ requests, offers: [{ id: 'o1', application_id: 'a1', author_role: 'artist', status: 'pendiente' }] });
    await page.init();
    assert.equal(page.asked.pending.length, 1, 'una sola consulta');
    assert.deepEqual(Array.from(page.asked.pending[0]), ['a1', 'a3'], 'solo las postulaciones en juego (la vencida no cuenta)');

    const shell = page.get('crq-root').innerHTML;
    assert.match(shell, /<h1 class="wo-h1">Mis solicitudes<\/h1>/);
    assert.match(shell, /<label class="wo-sr-only" for="crq-search">Busca en tus solicitudes<\/label>/);
    assert.match(shell, /id="crq-search"[^>]*value=""/);
    const cards = () => page.get('crq-cards').innerHTML;
    assert.match(cards(), /Cambios propuestos por el artista/);
    assert.match(cards(), /Vencida/);
    assert.match(cards(), /Artista seleccionado/);
    assert.doesNotMatch(cards(), /<b>pequeño<\/b>/);
    assert.match(cards(), /&lt;b&gt;pequeño&lt;\/b&gt;/);
    assert.equal((cards().match(/<article class="wo-card crq-reqcard">/g) || []).length, 3);

    // Buscar por código: solo repinta las tarjetas (el campo no se toca).
    const input = page.get('crq-search');
    input.value = 'jb-00099';
    input.listeners.input();
    assert.equal((cards().match(/<article/g) || []).length, 1);
    assert.match(cards(), /JB-00099/);
    assert.equal(page.get('crq-search-count').textContent, '1 resultado');
    assert.equal(page.get('crq-search-clear').hidden, false);

    input.value = 'no existe';
    input.listeners.input();
    assert.match(cards(), /No encontramos solicitudes para «no existe»/);
    assert.match(cards(), /data-cpn-action="clear-search"/);

    // "Limpiar búsqueda" del estado vacío.
    page.docListeners.click({ target: { closest: (sel) => (sel === '[data-cpn-action="clear-search"]' ? {} : null), classList: { contains: () => false } } });
    assert.equal((cards().match(/<article/g) || []).length, 3);
    assert.equal(page.get('crq-search-count').textContent, '');
    assert.equal(input.value, '');
});

test('/client/requests: sin solicitudes, el vacío ofrece publicar, explorar y cotizar', async () => {
    const page = loadRequests({ requests: [] });
    await page.init();
    const html = page.get('crq-root').innerHTML;
    assert.match(html, /Todavía no publicaste ninguna idea/);
    assert.match(html, /href="\/job-board\/request">Publicar una idea<\/a>/);
    assert.match(html, /href="\/marketplace">Explorar artistas<\/a>/);
    assert.match(html, /href="\/quotation">Solicitar cotización<\/a>/);
    assert.doesNotMatch(html, /id="crq-search"/);
    assert.equal(page.asked.pending.length, 0, 'sin postulaciones no se consulta nada');
});

test('/client/requests: una solicitud vencida no se muestra como publicada ni deja cerrarla', async () => {
    const page = loadRequests({ requests: [baseRequest({ status: 'expired', job_board_applications: [] })], search: '?id=r1' });
    await page.init();
    const html = page.get('crq-root').innerHTML;
    assert.match(html, /<h1 class="wo-h1">Publicación vencida<\/h1>/);
    assert.match(html, /<span class="wo-tag wo-tag--archived">Vencida<\/span>/);
    assert.doesNotMatch(html, /recibiendo postulaciones|data-action="close-request"|Todavía no hay postulaciones/);
    assert.match(html, /href="\/job-board\/request">Publicar una idea/);
});

test('/client/requests: en el seguimiento, la etiqueta de arriba y la del costado dicen lo mismo', async () => {
    const request = baseRequest({
        status: 'accepted', accepted_application_id: 'a1', resulting_quote_id: 'QN 77',
        job_board_applications: [{ id: 'a1', artist_id: 'art1', status: 'accepted', created_at: '2026-11-11T12:00:00Z', message: 'Hola', estimated_price: '300' }],
    });
    const page = loadRequests({
        requests: [request], search: '?id=r1&view=seguimiento',
        applicationOffers: { a1: [{ id: 'o9', application_id: 'a1', author_role: 'client', status: 'pendiente', price: 250, currency: 'USD' }] },
    });
    await page.init();
    const html = page.get('crq-root').innerHTML;
    assert.equal((html.match(/<span class="wo-tag wo-tag--info">Cambios propuestos por ti<\/span>/g) || []).length, 2);
    assert.doesNotMatch(html, /En negociación/);
    assert.match(html, /href="\/client\/chats\/\?quote=QN%2077"/);
    assert.match(html, /Lau &lt;Ink&gt;/);
    assert.doesNotMatch(html, /Lau <Ink>/);
});

test('/client/requests: postulaciones con los huecos de favoritos y denuncias', async () => {
    const page = loadRequests({ requests: [baseRequest()], search: '?id=r1&view=postulaciones' });
    await page.init();
    let html = page.get('crq-root').innerHTML;
    assert.match(html, /<button type="button" class="cpn-fav" data-wo-favorite data-kind="artist" data-id="art1" data-label="Lau &lt;Ink&gt;" data-image=""><\/button>/);

    const detail = loadRequests({ requests: [baseRequest()], search: '?id=r1&view=postulacion&app=a1' });
    await detail.init();
    html = detail.get('crq-root').innerHTML;
    assert.doesNotMatch(html, /data-wo-report|cpn-report|Denunciar/, 'CF-09: el cliente no tiene botón de denuncia');
    assert.match(html, /data-wo-favorite data-kind="artist" data-id="art1"/);
});

// ------------------------------------------------------------ client-profile.js (CP4)
const Notif = require('../public/shared/js/client-notif-model.js');

function loadProfile({ prefs = null, matrix = null, matrixFails = false, update = async () => ({ data: [{ user_id: 'u1' }], error: null }), saveFails = false } = {}) {
    const nodes = new Map();
    const get = (id) => {
        if (!nodes.has(id)) {
            const el = node(id);
            el.options = [];
            el.classNames = new Set();
            el.attrs = {};
            el.classList = { add: (c) => el.classNames.add(c), remove: (c) => el.classNames.delete(c), toggle: (c, on) => (on ? el.classNames.add(c) : el.classNames.delete(c)), contains: (c) => el.classNames.has(c) };
            el.setAttribute = (k, v) => { el.attrs[k] = v; };
            el.removeAttribute = (k) => { delete el.attrs[k]; };
            nodes.set(id, el);
        }
        return nodes.get(id);
    };
    const docListeners = {};
    const events = [];
    const saved = [];
    const updates = [];
    const fetched = [];
    let stored = prefs;
    const WeotziData = {
        Clients: {
            getByUserId: async () => ({ data: { user_id: 'u1', full_name: 'Ana Pérez', email: 'ana@example.com', public_username: 'ana', country: 'Chile' }, error: null }),
            updateByUserId: (id, patch) => ({ select: (cols) => { updates.push({ id, patch, cols }); return update(patch); } }),
        },
        Prefs: {
            get: async () => (stored ? { user_id: 'u1', notification_prefs: stored, app_settings: {} } : null),
            saveSection: async (id, section, value) => {
                if (saveFails) throw new Error('offline');
                saved.push({ id, section, value: JSON.parse(JSON.stringify(value)) });
                stored = Object.assign({}, stored || {}, value);
                return { user_id: id, notification_prefs: stored };
            },
        },
    };
    const window = {
        WoClientNotif: Notif, WeotziData, addEventListener() {},
        location: { search: '', hash: '#notificaciones', pathname: '/client/profile', href: '' },
        _supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'ana@example.com' } } } }) } },
    };
    const document = {
        getElementById: get, querySelectorAll: () => [], querySelector: () => null,
        addEventListener(type, fn) { docListeners[type] = fn; },
        dispatchEvent(event) { events.push(event); },
    };
    function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
    const context = vm.createContext({
        window, document, URLSearchParams, Intl, Promise, WeakMap, CustomEvent,
        console: { log() {}, warn() {}, error() {} }, setTimeout: () => 1, clearTimeout() {},
        fetch: async (url) => {
            fetched.push(url);
            if (matrixFails) throw new Error('offline');
            return { ok: true, json: async () => matrix || { success: true, kinds: [{ key: 'postulaciones', defaults: { email: true, push: false } }, { key: 'mensajes', defaults: { email: true, push: false } }, { key: 'cotizaciones', defaults: { email: true, push: false } }] } };
        },
    });
    vm.runInContext(read('public/shared/js/client-profile.js'), context, { filename: 'client-profile.js' });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const toggle = async (kind, channel, checked) => {
        const input = { checked, disabled: false, matches: (sel) => sel === 'input[data-notif]', getAttribute: (k) => (k === 'data-notif' ? kind : channel) };
        await get('cpa-notif-rows').listeners.change({ target: input });
    };
    return { get, events, saved, updates, fetched, toggle, init: async () => { docListeners.DOMContentLoaded(); await settle(); await settle(); await settle(); } };
}

const checkedOf = (html, kind, channel) => new RegExp(`data-notif="${kind}" data-channel="${channel}" checked`).test(html);

test('CP4 /client/profile: la matriz se pinta con lo guardado y los valores por defecto del servidor', async () => {
    const page = loadProfile({ prefs: { mensajes: { email: false, push: true }, email_updates: true, weekly_discovery: false } });
    await page.init();
    assert.deepEqual(page.fetched, ['/api/client/panel/notification-matrix']);
    const html = page.get('cpa-notif-rows').innerHTML;
    assert.equal((html.match(/<input type="checkbox"/g) || []).length, 6, '3 eventos × email y push');
    assert.doesNotMatch(html, /disabled/);
    assert.equal(checkedOf(html, 'mensajes', 'email'), false);
    assert.equal(checkedOf(html, 'mensajes', 'push'), true);
    assert.equal(checkedOf(html, 'postulaciones', 'email'), true);
    assert.equal(checkedOf(html, 'postulaciones', 'push'), false);
    assert.match(html, /aria-label="Cotizaciones por push"/);
    assert.equal('aria-busy' in page.get('cpa-notif-rows').attrs, false);

    // Si el servidor prende el push por defecto o suma un evento, la matriz lo sigue.
    const server = loadProfile({ matrix: { success: true, kinds: [{ key: 'mensajes', defaults: { email: true, push: true } }, { key: 'sesiones', defaults: { email: true, push: true } }] } });
    await server.init();
    const serverHtml = server.get('cpa-notif-rows').innerHTML;
    assert.equal(checkedOf(serverHtml, 'mensajes', 'push'), true);
    assert.match(serverHtml, /<p class="cpa-row-title">Sesiones<\/p>/);

    // Sin respuesta del servidor: valores del modelo, toggles igual de usables.
    const offline = loadProfile({ matrixFails: true, prefs: { email_updates: false } });
    await offline.init();
    const offlineHtml = offline.get('cpa-notif-rows').innerHTML;
    assert.equal((offlineHtml.match(/<input type="checkbox"/g) || []).length, 6);
    assert.equal(checkedOf(offlineHtml, 'cotizaciones', 'email'), false, 'se respeta el Email apagado en el registro');
});

test('CP4 /client/profile: cada toggle guarda solo su evento y dos cambios seguidos no se pisan', async () => {
    const page = loadProfile({ prefs: { cotizaciones: { email: false } } });
    await page.init();
    // Dos cambios del mismo evento sin esperar al primero.
    await Promise.all([page.toggle('mensajes', 'email', false), page.toggle('mensajes', 'push', true)]);
    assert.deepEqual(page.saved.map((s) => s.value), [{ mensajes: { email: false } }, { mensajes: { email: false, push: true } }]);
    assert.ok(page.saved.every((s) => s.section === 'notification_prefs' && s.id === 'u1'));
    await page.toggle('cotizaciones', 'push', true);
    assert.deepEqual(page.saved.at(-1).value, { cotizaciones: { email: false, push: true } }, 'conserva el email ya elegido');
    assert.equal(page.get('cpa-notif-status').textContent, 'Guardado');
    assert.deepEqual(page.events.map((e) => [e.type, e.detail.kind, e.detail.channel, e.detail.value, e.detail.role]), [
        ['wo:notif-pref-changed', 'mensajes', 'email', false, 'client'],
        ['wo:notif-pref-changed', 'mensajes', 'push', true, 'client'],
        ['wo:notif-pref-changed', 'cotizaciones', 'push', true, 'client'],
    ]);

    // Si el guardado falla, se avisa y la matriz vuelve a lo que quedó guardado.
    const failing = loadProfile({ prefs: { mensajes: { email: true } }, saveFails: true });
    await failing.init();
    await failing.toggle('mensajes', 'email', false);
    assert.equal(failing.get('cpa-notif-status').textContent, 'No se pudo guardar. Inténtalo de nuevo.');
    assert.equal(failing.get('cpa-notif-status').classNames.has('is-error'), true);
    assert.equal(checkedOf(failing.get('cpa-notif-rows').innerHTML, 'mensajes', 'email'), true);
    assert.equal(failing.events.length, 0);
});

test('CP4 /client/profile: guardar el perfil — columnas reales, alias repetido y guardado sin fila', async () => {
    const submit = async (page) => {
        page.get('cpa-full-name').value = ' Ana Pérez ';
        page.get('cpa-username').value = '@Ana Tattoo';
        page.get('cpa-country').value = 'Chile';
        page.get('cpa-whatsapp').value = '';
        page.get('cpa-city').value = 'Santiago';
        await page.get('cpa-profile-form').listeners.submit({ preventDefault() {} });
    };
    const ok = loadProfile();
    await ok.init();
    await submit(ok);
    assert.equal(ok.updates.length, 1);
    assert.equal(ok.updates[0].cols, 'user_id');
    assert.equal(ok.updates[0].id, 'u1');
    assert.deepEqual(Object.keys(ok.updates[0].patch).sort(), ['city_residence', 'country', 'full_name', 'profile_completed_at', 'public_profile_enabled', 'public_username', 'whatsapp']);
    assert.equal(ok.updates[0].patch.full_name, 'Ana Pérez');
    assert.equal(ok.updates[0].patch.public_username, 'ana_tattoo');
    assert.equal(ok.updates[0].patch.whatsapp, null);
    assert.equal(ok.get('cpa-profile-status').textContent, 'Cambios guardados');
    assert.equal(ok.get('cpa-username').value, 'ana_tattoo', 'el campo muestra el alias como quedó guardado');
    assert.equal(ok.get('cpa-username-error').textContent, '');

    const taken = loadProfile({ update: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_clients_public_username_unique"' } }) });
    await taken.init();
    await submit(taken);
    assert.equal(taken.get('cpa-username-error').textContent, 'Ese alias ya está en uso. Elige otro.');
    assert.equal(taken.get('cpa-username').attrs['aria-invalid'], 'true');
    assert.equal(taken.get('cpa-username').focused, 1);
    assert.equal(taken.get('cpa-profile-status').classNames.has('is-error'), true);
    assert.equal(taken.get('cpa-profile-save').disabled, false, 'el botón vuelve a quedar usable');
    // Al corregir el alias desaparece el error.
    taken.get('cpa-username').listeners.input();
    assert.equal(taken.get('cpa-username-error').textContent, '');
    assert.equal('aria-invalid' in taken.get('cpa-username').attrs, false);

    // RLS sin fila (sesión vencida): ya no dice "guardado".
    const none = loadProfile({ update: async () => ({ data: [], error: null }) });
    await none.init();
    await submit(none);
    assert.equal(none.get('cpa-profile-status').textContent, 'No se pudieron guardar los cambios. Inténtalo de nuevo.');
    assert.equal(none.get('cpa-profile-status').classNames.has('is-error'), true);
});
