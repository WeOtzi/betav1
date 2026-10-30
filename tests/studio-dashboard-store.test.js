// Tienda del panel de estudio (W-HOME, placeholder): empty state con botón a
// Finanzas mientras no exista WeotziData.Store; "Tienda en preparación" cuando
// el repo de Store ya está cargado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('public/shared/js/studio-dashboard-store.js');
const kit = require('../public/shared/js/studio-admin-kit.js');

function loadStore({ data = {}, withAdmin = true } = {}) {
    const registered = {};
    const warnings = [];
    const window = { WeOtziStudioKit: kit, WeotziData: data };
    if (withAdmin) window.WeOtziStudioAdmin = { register(tab, def) { registered[tab] = def; return true; } };
    const exposed = source.replace(/\}\)\(\);\s*$/, 'globalThis.__store = { storeState, storeHtml, COPY }; })();');
    const context = { window, console: { warn: (...a) => warnings.push(a), error() {}, log() {} } };
    vm.runInNewContext(exposed, context);
    return { api: context.__store, registered, warnings, window };
}

function fakeRoot() {
    const listeners = {};
    return {
        innerHTML: '', listeners,
        addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
        contains() { return true; }
    };
}

function click(root, attrs) {
    const el = { getAttribute: key => (key in attrs ? attrs[key] : null) };
    const target = { closest: selector => (selector === '[data-nav]' && attrs['data-nav'] != null ? el : null) };
    let prevented = false;
    (root.listeners.click || []).forEach(cb => cb({ target, preventDefault() { prevented = true; } }));
    return prevented;
}

test('se registra en la pestaña tienda con mount y show', () => {
    const { registered } = loadStore();
    assert.deepEqual(Object.keys(registered), ['tienda']);
    assert.equal(typeof registered.tienda.mount, 'function');
    assert.equal(typeof registered.tienda.show, 'function');
    assert.equal(loadStore({ withAdmin: false }).warnings.length, 1);
});

test('sin WeotziData.Store muestra el empty state del contrato con botón a Finanzas', () => {
    const data = { StudioFinance: {} };
    const { registered } = loadStore({ data });
    const root = fakeRoot();
    const navigations = [];
    const ctx = { data, kit, navigate: (...args) => navigations.push(args) };
    registered.tienda.mount(root, ctx);
    assert.match(root.innerHTML, /data-store-state="pending"/);
    assert.match(root.innerHTML, /class="sk-empty"/);
    assert.match(root.innerHTML, /La Tienda llega en la próxima fase/);
    assert.match(root.innerHTML, /Mientras tanto, registrá ventas de merch en Finanzas → Ingreso → Merch \(manual\)\./);
    assert.match(root.innerHTML, /<button type="button" class="studio-btn studio-btn-primary" data-nav="finanzas">Ir a Finanzas<\/button>/);
    assert.equal(click(root, { 'data-nav': 'finanzas' }), true);
    assert.deepEqual(navigations, [['finanzas']]);
    assert.equal(click(root, {}), false, 'clicks fuera del botón no navegan');
    assert.equal(navigations.length, 1);
});

test('con WeotziData.Store cargado no monta nada todavía y avisa "Tienda en preparación"', () => {
    const data = { Store: {} };
    const { registered, api } = loadStore({ data });
    assert.equal(api.storeState(data), 'preparing');
    assert.equal(api.storeState({}), 'pending');
    assert.equal(api.storeState(null), 'pending');
    const root = fakeRoot();
    registered.tienda.mount(root, { data, kit, navigate() {} });
    assert.match(root.innerHTML, /data-store-state="preparing"/);
    assert.match(root.innerHTML, /Tienda en preparación/);
    assert.match(root.innerHTML, /data-nav="finanzas"/);
    assert.doesNotMatch(root.innerHTML, /La Tienda llega en la próxima fase/);
});

test('show vuelve a evaluar si Store apareció después del primer montaje', () => {
    const data = {};
    const { registered } = loadStore({ data });
    const root = fakeRoot();
    const ctx = { data, kit, navigate() {} };
    registered.tienda.mount(root, ctx);
    assert.match(root.innerHTML, /data-store-state="pending"/);
    root.innerHTML = 'sin cambios';
    registered.tienda.show(root, ctx);
    assert.equal(root.innerHTML, 'sin cambios', 'mismo estado: no repinta');
    data.Store = {};
    registered.tienda.show(root, ctx);
    assert.match(root.innerHTML, /data-store-state="preparing"/);
});

test('el placeholder no lee ni escribe datos', () => {
    assert.doesNotMatch(source, /\.from\(|\.rpc\(|fetch\(|_supabase|\/rest\/v1/);
    assert.match(source, /\}\)\(\);\s*$/);
});
