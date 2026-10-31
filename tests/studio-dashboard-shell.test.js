// Shell del panel de estudio (W-SHELL): sidebar agrupada, paneles de módulos,
// orden de scripts, registro window.WeOtziStudioAdmin, badges, roster con
// contrato vigente y decisiones de postulaciones vía contratos/repo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('public/studio/dashboard/index.html');
const source = read('public/shared/js/studio-dashboard.js');

const EXPOSED = [
    'createAdminRegistry', 'computeBadgeCounts', 'collectBadgeCounts', 'rosterRowHtml', 'rosterActionFor',
    'rosterRowLocked', 'spotPayloadFor', 'persistSpot', 'hasSpotV2Values', 'validateSpotTerms',
    'validateSpotLists', 'normalizeList', 'isMissingContractsBackend', 'isMissingColumnError', 'onAppDecision',
    'renderRosterTable', 'inviteEmptyHtml', 'registerArtistUrl', 'safeNotify', 'friendlyMessage', 'domEnv',
    'ACCEPT_COPY', 'ROSTER_LOCK_COPY'
];

function fakeElement(id) {
    return {
        id, innerHTML: '', textContent: '', hidden: true, className: '', value: '', disabled: false,
        dataset: {}, style: {}, attrs: {}, children: [], listeners: {},
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute(k, v) { this.attrs[k] = v; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(type, cb) { (this.listeners[type] = this.listeners[type] || []).push(cb); },
        appendChild(child) { this.children.push(child); return child; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        remove() {}
    };
}

function fakeDocument() {
    const els = new Map();
    const doc = {
        els,
        listeners: {},
        addEventListener(type, cb) { (doc.listeners[type] = doc.listeners[type] || []).push(cb); },
        getElementById(id) { if (!els.has(id)) els.set(id, fakeElement(id)); return els.get(id); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement(tag) { return fakeElement(tag); }
    };
    return doc;
}

// Corre studio-dashboard.js en una VM y expone sus funciones internas.
function shell(options = {}) {
    const document = options.document || fakeDocument();
    const calls = [];
    const data = options.data || {};
    const window = Object.assign({
        location: { origin: 'https://beta.weotzi.com', hash: '', pathname: '/studio/dashboard' },
        history: { state: null, replaceState(...args) { calls.push(['replaceState', ...args]); } },
        WeotziData: data,
        confirm: () => true,
        addEventListener() {}
    }, options.window || {});
    const exposed = source.replace(/\}\)\(\);\s*$/,
        'globalThis.__shell = { ' + EXPOSED.join(', ')
        + ', setState(s, sb) { studio = s; supabase = sb; } }; })();');
    const fetchCalls = [];
    const context = {
        window, document, WeotziData: data, console: { warn() {}, error() {}, log() {} },
        navigator: options.navigator || {},
        fetch: async (url, init) => { fetchCalls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ success: true, sent: true }) }; },
        setTimeout, clearTimeout, Promise, Date, URL, JSON, Intl, Map, Set
    };
    vm.runInNewContext(exposed, context);
    return { api: context.__shell, window, document, calls, fetchCalls };
}

function fakeEnv(tabs) {
    const log = [];
    const roots = new Map(tabs.map(tab => [tab, { tab }]));
    return {
        log, roots,
        hasTab: tab => tabs.includes(tab),
        showTab: tab => log.push(['show-tab', tab]),
        rootFor: tab => roots.get(tab) || null,
        replaceHash: tab => log.push(['hash', tab]),
        setBadge: (tab, n) => log.push(['badge', tab, n]),
        clearPlaceholder: root => log.push(['clear', root.tab]),
        markUnavailable: root => log.push(['unavailable', root.tab]),
        markFailed: (root, err) => log.push(['failed', root.tab, err.message]),
        reportError: err => log.push(['error', err.message])
    };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

// ---------------------------------------------------------------
// Markup
// ---------------------------------------------------------------
test('la sidebar agrupa las pestañas con las etiquetas del contrato e Inicio por defecto', () => {
    const sidebar = html.match(/<aside class="studio-dash-sidebar"[\s\S]*?<\/aside>/)[0];
    const groups = [...sidebar.matchAll(/<div class="sk-sidebar-group">\s*<p class="sk-sidebar-group-title">([^<]+)<\/p>([\s\S]*?)<\/div>/g)]
        .map(m => ({ title: m[1], tabs: [...m[2].matchAll(/data-tab="([a-z]+)"[^>]*>\s*<span class="dot"><\/span>\s*([^<]+?)\s*<\/a>/g)].map(t => [t[1], t[2]]) }));
    assert.deepEqual(groups, [
        { title: 'Estudio', tabs: [['inicio', 'Inicio'], ['perfil', 'Perfil'], ['sedes', 'Sedes'], ['cuenta', 'Cuenta']] },
        { title: 'Equipo', tabs: [['roster', 'Roster'], ['solicitudes', 'Solicitudes'], ['spots', 'Spots'], ['contratos', 'Contratos'], ['agenda', 'Agenda'], ['travel', 'Travel']] },
        { title: 'Operación', tabs: [['ops', 'Operaciones'], ['inventory', 'Inventario'], ['reposicion', 'Reposición'], ['suppliers', 'Proveedores'], ['sponsors', 'Sponsors']] },
        { title: 'Negocio', tabs: [['tienda', 'Tienda'], ['finanzas', 'Finanzas'], ['analytics', 'Reportes']] }
    ]);
    const active = [...sidebar.matchAll(/class="studio-dash-tab is-active" data-tab="([a-z]+)"/g)].map(m => m[1]);
    assert.deepEqual(active, ['inicio']);
    const activePanels = [...html.matchAll(/class="studio-dash-panel is-active" data-panel="([a-z]+)"/g)].map(m => m[1]);
    assert.deepEqual(activePanels, ['inicio']);
    assert.doesNotMatch(sidebar, /Analytics/);
});

test('cada pestaña tiene panel y los paneles de módulos traen [data-module-root]', () => {
    const tabs = [...html.matchAll(/class="studio-dash-tab[^"]*" data-tab="([a-z]+)"/g)].map(m => m[1]);
    const panels = new Map([...html.matchAll(/<section class="studio-dash-panel[^"]*" data-panel="([a-z]+)">([\s\S]*?)<\/section>/g)].map(m => [m[1], m[2]]));
    tabs.forEach(tab => assert.ok(panels.has(tab), 'falta el panel ' + tab));
    for (const tab of ['inicio', 'solicitudes', 'contratos', 'agenda', 'reposicion', 'tienda', 'finanzas']) {
        assert.match(panels.get(tab), /<div data-module-root\b/, tab + ' sin data-module-root');
    }
    // Materiales y reportes extendidos son el primer root de su panel.
    const inventory = panels.get('inventory');
    assert.match(inventory, /<div id="inventory-materials" data-module-root\b/);
    assert.equal((inventory.match(/data-module-root/g) || []).length, 1);
    const analytics = panels.get('analytics');
    assert.match(analytics, /<div id="reports-extended" data-module-root\b/);
    assert.ok(analytics.indexOf('reports-extended') < analytics.indexOf('analytics-summary'), 'reports-extended va arriba del contenido');
    assert.equal((analytics.match(/data-module-root/g) || []).length, 1);
    assert.match(panels.get('spots'), /revisá y emití el contrato para sumarlo al roster/);
});

test('scripts en el orden clásico del contrato y CSS de módulos después de studio.css', () => {
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1].replace(/^\/shared\/js\//, ''));
    const order = [
        'data/studios-repo.js', 'data/studio-contracts-repo.js', 'data/studio-finance-repo.js', 'data/supplies-repo.js',
        'studio-auth.js', 'weotzi-uploader.js', 'studio-admin-kit.js', 'studio-dashboard.js', 'studio-dashboard-ops.js',
        'studio-travel-links.js', 'studio-dashboard-home.js', 'studio-dashboard-requests.js', 'studio-dashboard-contracts.js',
        'studio-dashboard-agenda.js', 'studio-dashboard-materials.js', 'studio-dashboard-finance.js',
        'studio-dashboard-reports.js', 'studio-dashboard-restock.js', 'studio-dashboard-store.js'
    ];
    const positions = order.map(file => scripts.indexOf(file));
    positions.forEach((pos, i) => assert.ok(pos >= 0, 'falta ' + order[i]));
    positions.forEach((pos, i) => { if (i) assert.ok(pos > positions[i - 1], order[i] + ' fuera de orden'); });
    // Los cuatro repos van seguidos.
    assert.deepEqual(positions.slice(0, 4).map(p => p - positions[0]), [0, 1, 2, 3]);
    const modulePositions = positions.slice(10);
    assert.deepEqual(modulePositions.map(p => p - modulePositions[0]), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(!html.includes('type="module"'), 'scripts clásicos');

    const css = [...html.matchAll(/<link rel="stylesheet" href="\/shared\/css\/([^"]+)"/g)].map(m => m[1]);
    const base = css.indexOf('studio.css');
    for (const file of ['studio-admin-kit.css', 'studio-contracts.css', 'studio-agenda.css', 'studio-finance.css', 'studio-restock.css']) {
        assert.ok(css.indexOf(file) > base, file + ' debe ir después de studio.css');
    }
    assert.ok(css.indexOf('studio-admin-kit.css') < css.indexOf('studio-contracts.css'));
});

// ---------------------------------------------------------------
// Registro window.WeOtziStudioAdmin
// ---------------------------------------------------------------
test('WeOtziStudioAdmin existe de forma sincrónica con la API del contrato', () => {
    const { window, document } = shell();
    const admin = window.WeOtziStudioAdmin;
    for (const fn of ['register', 'getContext', 'activate', 'navigate', 'setBadge', 'notify', 'refresh', 'onRosterRender', '_emitRosterRender']) {
        assert.equal(typeof admin[fn], 'function', fn);
    }
    assert.equal(typeof admin.getContext().then, 'function');
    assert.equal(document.listeners.DOMContentLoaded.length, 1, 'el boot sigue esperando DOMContentLoaded');
    assert.ok(source.indexOf('window.WeOtziStudioAdmin = admin') < source.indexOf("document.addEventListener('DOMContentLoaded'"));
});

test('register guarda en buffer y monta al resolver el contexto si la pestaña está activa', async () => {
    const { api } = shell();
    const env = fakeEnv(['inicio', 'solicitudes']);
    const admin = api.createAdminRegistry(env);
    const events = [];
    admin.register('inicio', {
        mount: async (root, ctx) => { events.push(['mount', root.tab, ctx.studioId]); },
        show: (root, ctx, params) => { events.push(['show', root.tab, JSON.stringify(params)]); }
    });
    assert.equal(admin.activate('inicio'), true);
    await tick();
    assert.deepEqual(events, [], 'sin contexto no se monta');
    const ctx = { studioId: 's1', notify: async () => ({ ok: true }), refresh: async () => 'ok' };
    admin._setContext(ctx);
    await tick(); await tick();
    assert.deepEqual(events, [['mount', 'inicio', 's1'], ['show', 'inicio', '{}']]);
    assert.ok(env.log.some(entry => entry[0] === 'clear' && entry[1] === 'inicio'));
    assert.equal(await admin.getContext(), ctx);
    assert.equal(await admin.refresh(), 'ok');
});

test('activate es idempotente por tab+params, monta una sola vez y llama show en cada visita', async () => {
    const { api } = shell();
    const env = fakeEnv(['inicio', 'reposicion']);
    const admin = api.createAdminRegistry(env);
    let mounts = 0;
    const shows = [];
    admin.register('reposicion', { mount: async () => { mounts++; }, show: (root, ctx, params) => { shows.push(params.order || null); } });
    admin._setContext({ studioId: 's' });
    admin.activate('reposicion');
    admin.activate('reposicion');           // click + hashchange: no duplica
    await tick(); await tick();
    assert.equal(mounts, 1);
    assert.deepEqual(shows, [null]);
    admin.navigate('reposicion', { order: 'o-1' });
    await tick(); await tick();
    assert.deepEqual(shows, [null, 'o-1']);
    assert.deepEqual(env.log.filter(e => e[0] === 'hash'), [['hash', 'reposicion']]);
    admin.activate('inicio');
    admin.activate('reposicion');
    await tick(); await tick();
    assert.equal(mounts, 1);
    assert.deepEqual(shows, [null, 'o-1', null]);
    assert.equal(admin.activate('bookings'), false, 'pestaña inexistente');
    assert.equal(admin.activate('Inicio'), false, 'el regex ^[a-z]+$ se mantiene');
});

test('registro tardío monta en el momento y un mount fallido permite reintentar', async () => {
    const { api } = shell();
    const env = fakeEnv(['inicio', 'contratos']);
    const admin = api.createAdminRegistry(env);
    admin._setContext({ studioId: 's' });
    admin.activate('contratos');
    await tick();
    assert.ok(env.log.some(e => e[0] === 'unavailable' && e[1] === 'contratos'));
    let attempts = 0;
    admin.register('contratos', { mount: async () => { attempts++; if (attempts === 1) throw new Error('boom'); } });
    await tick(); await tick();
    assert.equal(attempts, 1);
    assert.ok(env.log.some(e => e[0] === 'failed' && e[2] === 'boom'));
    admin.activate('contratos');
    await tick(); await tick();
    assert.equal(attempts, 2);
    assert.equal(admin.register('contratos', { mount() {} }), false, 'no se registra dos veces');
    assert.equal(admin.register('contratos', {}), false);
});

test('setBadge, notify y onRosterRender delegan y reproducen el último render', async () => {
    const { api } = shell();
    const env = fakeEnv(['solicitudes']);
    const admin = api.createAdminRegistry(env);
    admin.setBadge('solicitudes', 3);
    admin.setBadge('<x>', 3);
    assert.deepEqual(env.log.filter(e => e[0] === 'badge'), [['badge', 'solicitudes', 3]]);

    const seen = [];
    const table = { tag: 'table' };
    admin._emitRosterRender(table, [{ id: 'm1' }]);
    const off = admin.onRosterRender((el, members) => seen.push([el, members.length]));
    assert.deepEqual(seen, [[table, 1]], 'replay del último render');
    admin.onRosterRender(() => { throw new Error('listener roto'); });
    admin._emitRosterRender(null, []);
    assert.deepEqual(seen, [[table, 1], [null, 0]], 'un listener roto no corta a los demás');
    off();
    admin._emitRosterRender(table, []);
    assert.equal(seen.length, 2);

    const payloads = [];
    admin._setContext({ notify: async payload => { payloads.push(payload); return { ok: true }; } });
    assert.deepEqual(await admin.notify({ kind: 'contract_issued', contract_id: 'c' }), { ok: true });
    assert.deepEqual(payloads, [{ kind: 'contract_issued', contract_id: 'c' }]);
});

test('domEnv.setBadge crea el span.sk-tab-badge y lo oculta en cero', () => {
    const tab = fakeElement('tab');
    let badge = null;
    tab.querySelector = selector => (selector === '.sk-tab-badge' ? badge : null);
    tab.appendChild = child => { badge = child; return child; };
    const document = fakeDocument();
    document.querySelector = selector => (selector === '.studio-dash-tab[data-tab="contratos"]' ? tab : null);
    const { api } = shell({ document });
    api.domEnv.setBadge('contratos', 0);
    assert.equal(badge, null, 'sin pendientes no se crea');
    api.domEnv.setBadge('contratos', 4);
    assert.equal(badge.className, 'sk-tab-badge');
    assert.equal(badge.textContent, '4');
    assert.equal(badge.hidden, false);
    api.domEnv.setBadge('contratos', 120);
    assert.equal(badge.textContent, '99+');
    api.domEnv.setBadge('contratos', 0);
    assert.equal(badge.hidden, true);
});

// Documento suficiente para correr el arranque completo (DOMContentLoaded).
function bootDocument(tabIds) {
    const deep = id => {
        const el = fakeElement(id);
        const cache = new Map();
        el.querySelector = sel => { if (!cache.has(sel)) cache.set(sel, deep(sel)); return cache.get(sel); };
        el.form = null;
        el.reportValidity = () => true;
        return el;
    };
    const doc = fakeDocument();
    const tabs = tabIds.map(tab => { const el = deep('tab-' + tab); el.dataset.tab = tab; el.badge = null; el.querySelector = sel => (sel === '.sk-tab-badge' ? el.badge : null); el.appendChild = child => { el.badge = child; return child; }; return el; });
    const roots = new Map(tabIds.map(tab => [tab, deep('root-' + tab)]));
    const panels = tabIds.map(tab => { const el = deep('panel-' + tab); el.dataset.panel = tab; el.querySelector = sel => (sel === '[data-module-root]' ? roots.get(tab) : null); return el; });
    const byId = new Map();
    doc.getElementById = id => { if (!byId.has(id)) byId.set(id, deep(id)); return byId.get(id); };
    doc.createElement = tag => deep(tag);
    doc.querySelectorAll = sel => (sel === '.studio-dash-tab' ? tabs : sel === '.studio-dash-panel' ? panels : []);
    doc.querySelector = sel => {
        const tab = sel.match(/^\.studio-dash-tab\[data-tab="([a-z]+)"\]$/);
        if (tab) return tabs.find(t => t.dataset.tab === tab[1]) || null;
        const panel = sel.match(/^\.studio-dash-panel\[data-panel="([a-z]+)"\]$/);
        if (panel) return panels.find(p => p.dataset.panel === panel[1]) || null;
        return null;
    };
    return { doc, tabs, roots, byId };
}

test('arranque: monta Inicio con el contexto, vence contratos antes del roster y pone badges', async () => {
    const order = [];
    const studio = { id: 'st', user_id: 'owner', name: 'Estudio <Sur>', slug: 'sur', email: 'sur@example.test' };
    const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' }, access_token: 't' } } }) } };
    const data = {
        StudioLocations: { listByStudio: async () => ({ data: [{ id: 'l1', label: 'Centro' }], error: null }), listActiveByStudio: async () => ({ data: [], error: null }) },
        StudioMemberships: {
            listRosterV2: async () => { order.push('roster'); return { data: [{ id: 'm1', role: 'resident', status: 'active', current_contract_id: 'c1', artists_db: {} }], error: null }; },
            listRoster: async () => ({ data: [], error: null }),
            listRequestsForStudio: async () => ({ data: [{ status: 'requested' }], error: null })
        },
        StudioSpots: { listByStudio: async () => ({ data: [], error: null }) },
        StudioContracts: {
            expireOverdue: async () => { order.push('expire'); return { data: 0, error: null }; },
            listForStudio: async () => ({ data: [{ status: 'sent' }], error: null })
        }
    };
    const tabIds = ['inicio', 'perfil', 'roster', 'solicitudes', 'contratos', 'spots'];
    const { doc, tabs, roots } = bootDocument(tabIds);
    const auth = { ready: async () => client, getSupabase: () => client, getCurrent: () => studio, check: async () => studio, appUrl: p => p, logout() {} };
    const h = shell({ document: doc, data, window: { WeOtziStudioAuth: auth, WeOtziStudioKit: { marker: 'kit' } } });
    const mounted = [];
    // Los módulos se registran al cargar (antes de DOMContentLoaded).
    h.window.WeOtziStudioAdmin.register('inicio', { mount: (root, ctx) => { mounted.push([root, ctx.studioId, ctx.userId, ctx.kit.marker, typeof ctx.navigate, typeof ctx.notify]); } });
    await doc.listeners.DOMContentLoaded[0]();
    for (let i = 0; i < 5; i++) await tick();

    assert.deepEqual(mounted, [[roots.get('inicio'), 'st', 'owner', 'kit', 'function', 'function']]);
    assert.ok(tabs.find(t => t.dataset.tab === 'inicio').attrs['aria-current'] === 'page', 'sin hash se activa inicio');
    assert.deepEqual(order, ['expire', 'roster'], 'expireOverdue corre antes de pintar el roster');
    assert.match(doc.getElementById('roster-content').innerHTML, /Se edita con una nueva versión del contrato/);
    assert.equal(tabs.find(t => t.dataset.tab === 'solicitudes').badge.textContent, '1');
    assert.equal(tabs.find(t => t.dataset.tab === 'contratos').badge.textContent, '1');
    assert.match(doc.getElementById('studio-name-display').innerHTML, /Estudio &lt;Sur&gt;/);
    // Click en una pestaña con módulo ausente marca el placeholder como no disponible.
    h.window.WeOtziStudioAdmin.activate('contratos');
    await tick();
    assert.equal(roots.get('contratos').querySelector('[data-module-loading]').textContent, 'Esta sección todavía no está disponible.');
});

// ---------------------------------------------------------------
// Badges al iniciar
// ---------------------------------------------------------------
test('badges: solicitudes + cambios + contraofertas y contratos enviados; los errores cuentan cero', async () => {
    const { api } = shell();
    const contractCalls = [];
    const data = {
        StudioMemberships: {
            listRequestsForStudio: async () => ({ data: [{ status: 'requested' }, { status: 'requested' }], error: null }),
            listChangeRequestsForStudio: async () => ({ data: null, error: { code: 'PGRST205', message: 'missing' } })
        },
        StudioSpots: { listArtistCounterOffersForStudio: async () => { throw new Error('red'); } },
        StudioContracts: { listForStudio: async (id, opts) => { contractCalls.push([id, opts]); return { data: [{ status: 'sent' }, { status: 'sent' }, { status: 'signed' }], error: null }; } }
    };
    assert.deepEqual(JSON.parse(JSON.stringify(await api.collectBadgeCounts(data, 'st'))), { solicitudes: 2, contratos: 2 });
    assert.deepEqual(JSON.parse(JSON.stringify(contractCalls)), [['st', { status: 'sent' }]]);
    // Sin repos nuevos (migraciones y W-REPO pendientes) no rompe.
    assert.deepEqual(JSON.parse(JSON.stringify(await api.collectBadgeCounts({}, 'st'))), { solicitudes: 0, contratos: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(api.computeBadgeCounts({
        requests: [{ status: 'requested' }], changes: [{ status: 'pending' }, { status: 'declined' }], counters: [{ status: 'pending' }]
    }))), { solicitudes: 3, contratos: 0 });
});

// ---------------------------------------------------------------
// Roster
// ---------------------------------------------------------------
test('roster: con current_contract_id rol y split quedan bloqueados con el aviso del contrato', () => {
    const { api } = shell();
    const locked = api.rosterRowHtml({ id: 'm1', role: 'resident', status: 'active', revenue_split_pct: 60, current_contract_id: 'c1', artists_db: { name: 'Ana <b>' } }, []);
    assert.match(locked, /data-field="role" aria-label="Rol" disabled aria-describedby="roster-lock-m1"/);
    assert.match(locked, /data-field="revenue_split_pct"[^>]* disabled aria-describedby="roster-lock-m1"/);
    assert.ok(locked.includes(api.ROSTER_LOCK_COPY));
    assert.equal(api.ROSTER_LOCK_COPY, 'Se edita con una nueva versión del contrato');
    assert.match(locked, /data-locked="true"/);
    assert.ok(locked.includes('Ana &lt;b&gt;'), 'escapa el nombre');
    assert.match(locked, /class="studio-roster-actions"/);

    const free = api.rosterRowHtml({ id: 'm2', role: 'guest', status: 'active', artists_db: {} }, []);
    assert.doesNotMatch(free, /disabled/);
    assert.doesNotMatch(free, /data-locked/);
});

test('roster: sin "Reactivar" para filas ended; paused lo conserva', () => {
    const { api } = shell();
    assert.equal(api.rosterActionFor('active'), 'end');
    assert.equal(api.rosterActionFor('pending_acceptance'), 'cancel');
    assert.equal(api.rosterActionFor('pending_invite'), 'cancel');
    assert.equal(api.rosterActionFor('paused'), 'resume');
    assert.equal(api.rosterActionFor('ended'), null);
    assert.equal(api.rosterActionFor('rejected'), null);
    const ended = api.rosterRowHtml({ id: 'm3', role: 'resident', status: 'ended', artists_db: {} }, []);
    assert.doesNotMatch(ended, /Reactivar/);
    assert.doesNotMatch(ended, /data-action="save"/);
    assert.match(api.rosterRowHtml({ id: 'm4', role: 'resident', status: 'paused', artists_db: {} }, []), /data-action="resume"[^>]*>Reactivar/);
    assert.match(ended, /Finalizado/, 'estado en español');
});

test('roster: usa listRosterV2, cae a listRoster si falla y emite _emitRosterRender al final', async () => {
    const document = fakeDocument();
    const table = { tag: 'table' };
    document.getElementById('roster-content').querySelector = selector => (selector === 'table' ? table : null);
    const used = [];
    const data = {
        StudioMemberships: {
            listRosterV2: async () => { used.push('v2'); return { data: null, error: { code: 'XX000', message: 'falló' } }; },
            listRoster: async () => { used.push('v1'); return { data: [{ id: 'm1', role: 'resident', status: 'active', artists_db: {} }], error: null }; }
        }
    };
    const { api, window } = shell({ document, data });
    api.setState({ id: 'st' }, {});
    const emitted = [];
    window.WeOtziStudioAdmin.onRosterRender((el, members) => emitted.push([el, members.map(m => m.id)]));
    await api.renderRosterTable();
    assert.deepEqual(used, ['v2', 'v1']);
    assert.match(document.getElementById('roster-content').innerHTML, /data-membership-id="m1"/);
    assert.deepEqual(JSON.parse(JSON.stringify(emitted)), [[table, ['m1']]]);
});

test('invitar: sin resultados ofrece copiar el link de registro', () => {
    const { api } = shell({ window: { WeOtziStudioAuth: { appUrl: p => '/beta' + p } } });
    const empty = api.inviteEmptyHtml();
    assert.ok(empty.includes('¿No está en We Ötzi? Compartile el link de registro'));
    assert.match(empty, /data-copy-register/);
    assert.equal(api.registerArtistUrl(), 'https://beta.weotzi.com/beta/register-artist');
});

// ---------------------------------------------------------------
// Spots: columnas nuevas con fallback
// ---------------------------------------------------------------
test('spot: reintenta sin las columnas nuevas ante PGRST204 y avisa que no se guardaron', async () => {
    const bodies = [];
    const data = {
        StudioSpots: {
            createSpot: async body => {
                bodies.push(body);
                return bodies.length === 1
                    ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'compensation_model' column" } }
                    : { data: { id: 'sp1' }, error: null };
            }
        }
    };
    const { api } = shell({ data });
    const payload = { title: 'Guest', studio_includes: ['Camilla'], benefit_tags: ['Agenda garantizada'], compensation_model: 'fixed', fixed_amount: 100, fixed_currency: 'ARS', fixed_period: 'monthly', fixed_payer: 'artist_to_studio' };
    const { result, degraded } = await api.persistSpot(null, payload);
    assert.equal(result.error, null);
    assert.equal(degraded, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].compensation_model, 'fixed');
    for (const col of ['benefit_tags', 'compensation_model', 'fixed_amount', 'fixed_currency', 'fixed_period', 'fixed_payer']) {
        assert.equal(col in bodies[1], false, col + ' no viaja en el reintento');
    }
    assert.deepEqual(bodies[1].studio_includes, ['Camilla'], 'las listas existentes se guardan igual');
    // Ya sabe que faltan: el siguiente guardado no vuelve a intentar.
    const again = await api.persistSpot(null, payload);
    assert.equal(bodies.length, 3);
    assert.equal('compensation_model' in bodies[2], false);
    assert.equal(again.degraded, true);
});

test('spot: sin valores nuevos y esquema desconocido no manda columnas nuevas', () => {
    const { api } = shell();
    const body = api.spotPayloadFor({ title: 'x', benefit_tags: [], compensation_model: null, fixed_amount: null }, null);
    assert.equal('benefit_tags' in body, false);
    assert.equal('compensation_model' in body, false);
    const known = api.spotPayloadFor({ title: 'x', benefit_tags: [], compensation_model: null }, new Set(['benefit_tags', 'compensation_model']));
    assert.ok('compensation_model' in known, 'con esquema conocido manda null para limpiar');
});

test('spot: valida modalidad, moneda ISO y listas', () => {
    const { api } = shell();
    assert.equal(api.validateSpotTerms({ compensation_model: 'percentage', revenue_split_pct: null }), 'Indicá el porcentaje que se queda el artista.');
    assert.equal(api.validateSpotTerms({ compensation_model: 'fixed', fixed_amount: 10, fixed_currency: 'usd', fixed_period: 'monthly', fixed_payer: 'artist_to_studio' }), 'Elegí la moneda del pago fijo.');
    assert.equal(api.validateSpotTerms({ compensation_model: 'mixed', revenue_split_pct: 60, fixed_amount: 10, fixed_currency: 'USD', fixed_period: 'monthly', fixed_payer: 'nadie' }), 'Elegí quién paga el monto fijo.');
    assert.equal(api.validateSpotTerms({ compensation_model: 'mixed', revenue_split_pct: 60, fixed_amount: 10, fixed_currency: 'USD', fixed_period: 'weekly', fixed_payer: 'studio_to_artist' }), null);
    assert.equal(api.validateSpotTerms({ compensation_model: null, revenue_split_pct: 120 }), 'El porcentaje para el artista debe estar entre 0 y 100.');
    assert.deepEqual([...api.normalizeList([' Camilla ', '', 'camilla', 'Tintas'])], ['Camilla', 'Tintas']);
    assert.match(api.validateSpotLists({ benefit_tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), /hasta 6/);
    assert.equal(api.validateSpotLists({ studio_includes: ['ok'] }), null);
    assert.match(source, /'ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN', 'COP', 'UYU', 'PEN'/);
});

// ---------------------------------------------------------------
// Spots: aceptar / rechazar postulaciones
// ---------------------------------------------------------------
function decisionHarness({ contracts, decideResult } = {}) {
    const decided = [];
    const data = {
        StudioSpots: {
            decideApplicationRpc: async (id, status) => { decided.push([id, status]); return decideResult || { data: { id, status: status === 'accepted' ? 'shortlisted' : status }, error: null }; },
            getSummaryById: async () => ({ data: { id: 'sp1', title: 'Guest', kind: 'guest_spot' }, error: null }),
            listApplications: async () => ({ data: [], error: null }),
            listByStudio: async () => ({ data: [], error: null })
        },
        StudioLocations: { listActiveByStudio: async () => ({ data: [], error: null }) },
        StudioMemberships: { listRoster: async () => ({ data: [], error: null }) }
    };
    const window = {
        WeOtziStudioAuth: { appUrl: p => p },
        WeOtziStudioKit: { confirmDialog: async () => true },
        WeOtziStudioContracts: contracts
    };
    const h = shell({ data, window });
    h.api.setState({ id: 'st', user_id: 'owner' }, { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } });
    return Object.assign(h, { decided });
}

test('aceptar abre el contrato con openFromApplication y no usa el flujo viejo', async () => {
    const opened = [];
    const h = decisionHarness({ contracts: { openFromApplication: async (app, spot) => { opened.push([app, spot]); return { contractId: 'c1', issued: false }; } } });
    await h.api.onAppDecision('accept', 'app1', 'artist1', { id: 'sp1', title: 'Guest', kind: 'guest_spot' });
    assert.deepEqual(JSON.parse(JSON.stringify(opened)), [[{ id: 'app1', artist_user_id: 'artist1' }, { id: 'sp1', title: 'Guest', kind: 'guest_spot' }]]);
    assert.deepEqual(h.decided, []);
    assert.equal(h.fetchCalls.length, 0);
    assert.equal(h.document.getElementById('spots-status').textContent, 'Postulación aceptada: revisá y emití el contrato para sumarlo al roster.');
    assert.equal(h.api.ACCEPT_COPY, 'Postulación aceptada: revisá y emití el contrato para sumarlo al roster.');
});

test('sin RPC de contratos (42883/PGRST202) cae a decideApplicationRpc + spot_decision', async () => {
    for (const code of ['42883', 'PGRST202']) {
        const h = decisionHarness({ contracts: { openFromApplication: async () => { throw { code, message: 'missing' }; } } });
        await h.api.onAppDecision('accept', 'app1', 'artist1', { id: 'sp1', title: 'Guest', kind: 'guest_spot' });
        assert.deepEqual(h.decided, [['app1', 'accepted']]);
        assert.deepEqual(h.fetchCalls.map(c => c.body), [{ kind: 'spot_decision', application_id: 'app1', decision: 'accepted' }]);
        assert.match(h.document.getElementById('spots-status').textContent, /revisá y emití el contrato/);
    }
    const noModule = decisionHarness({ contracts: undefined });
    await noModule.api.onAppDecision('accept', 'app2', 'artist2', { id: 'sp1', title: 'Guest', kind: 'guest_spot' });
    assert.deepEqual(noModule.decided, [['app2', 'accepted']]);
});

test('un error real del contrato no cae al flujo viejo; rechazar usa decideApplicationRpc', async () => {
    const h = decisionHarness({ contracts: { openFromApplication: async () => { throw { code: '23514', message: 'La postulación fue retirada' }; } } });
    await h.api.onAppDecision('accept', 'app1', 'artist1', { id: 'sp1', title: 'Guest', kind: 'guest_spot' });
    assert.deepEqual(h.decided, []);
    assert.equal(h.document.getElementById('spots-status').textContent, 'La postulación fue retirada');

    const opened = [];
    const r = decisionHarness({ contracts: { openFromApplication: async () => { opened.push(1); } } });
    await r.api.onAppDecision('reject', 'app9', 'artist1', { id: 'sp1', title: 'Guest', kind: 'guest_spot' });
    assert.deepEqual(opened, []);
    assert.deepEqual(r.decided, [['app9', 'rejected']]);
    assert.deepEqual(r.fetchCalls.map(c => c.body), [{ kind: 'spot_decision', application_id: 'app9', decision: 'rejected' }]);
});

test('ctx.notify nunca lanza y devuelve { ok, data, error }', async () => {
    const h = decisionHarness();
    const ok = await h.api.safeNotify({ kind: 'contract_issued', contract_id: 'c1' });
    assert.equal(ok.ok, true);
    assert.equal(h.fetchCalls[0].url, '/api/studio/notify');
});

test('el código del shell no llama RPCs de decisión directo y deja el copy viejo', () => {
    assert.doesNotMatch(source, /\.rpc\(\s*'decide_studio_spot_application'/);
    assert.match(source, /decideApplicationRpc\(applicationId, newStatus\)/);
    assert.match(source, /WeOtziStudioContracts\.openFromApplication\(/);
    assert.doesNotMatch(source, /sumado al roster/i);
    assert.match(source, /admin\._emitRosterRender\(container\.querySelector\('table'\), members\)/);
    assert.match(source, /safeUrl\(a\.portfolio_url\)/);
    assert.equal((source.match(/\}\)\(\);\s*$/) || []).length, 1, 'el archivo termina en })();');
});
