// Kit compartido del panel de estudio (WeOtziStudioKit): funciones puras en
// Node y la UI (modal, drawer, toasts, listEditor, readForm) sobre un DOM falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KIT_PATH = path.join(__dirname, '..', 'public', 'shared', 'js', 'studio-admin-kit.js');
const CSS_PATH = path.join(__dirname, '..', 'public', 'shared', 'css', 'studio-admin-kit.css');
const kit = require(KIT_PATH);
const kitSource = fs.readFileSync(KIT_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const plain = s => String(s).replace(/ /g, ' ');

function withTZ(tz, fn) {
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try { return fn(); } finally {
        if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
}

// -----------------------------------------------------------------
// DOM falso mínimo: elementos, eventos con burbujeo, selectores simples.
// -----------------------------------------------------------------
function matchesSimple(el, part) {
    const sel = part.replace(/:not\([^)]*\)/g, '').replace(/:[a-z-]+(\([^)]*\))?/g, '').trim();
    if (!sel) return false;
    const tag = /^[a-z][a-z0-9-]*/i.exec(sel);
    if (tag && el.tagName !== tag[0].toUpperCase()) return false;
    const classes = sel.match(/\.[\w-]+/g) || [];
    if (!classes.every(c => el.classList.contains(c.slice(1)))) return false;
    const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    return attrs.every(([, name, value]) => {
        const actual = el.getAttribute(name);
        if (actual == null && !(name in el && el[name] && name !== 'type')) return false;
        return value === undefined ? true : String(actual) === value;
    });
}

class FakeElement {
    constructor(tag, doc) {
        this.tagName = String(tag).toUpperCase();
        this.nodeType = 1;
        this.ownerDocument = doc;
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.listeners = {};
        this.style = {};
        this._text = '';
        this.innerHTML = '';
        this.value = '';
        this.disabled = false;
        this.hidden = false;
        this.checked = false;
        const self = this;
        this.classList = {
            _set: new Set(),
            add(...names) { names.forEach(n => this._set.add(n)); self.attributes.class = [...this._set].join(' '); },
            remove(...names) { names.forEach(n => this._set.delete(n)); self.attributes.class = [...this._set].join(' '); },
            contains(n) { return this._set.has(n); },
            toggle(n, force) {
                const on = force === undefined ? !this._set.has(n) : !!force;
                if (on) this.add(n); else this.remove(n);
                return on;
            }
        };
    }
    get className() { return [...this.classList._set].join(' '); }
    set className(v) { this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); this.attributes.class = this.className; }
    get id() { return this.attributes.id || ''; }
    set id(v) { this.attributes.id = String(v); }
    get firstChild() { return this.children[0] || null; }
    get lastChild() { return this.children[this.children.length - 1] || null; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
    appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        child.parentNode = null;
        return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    insertAdjacentHTML(_pos, html) { this.innerHTML += html; }
    setAttribute(k, v) { if (k === 'class') this.className = v; else this.attributes[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
    dispatch(type, init = {}) {
        const event = {
            type, target: this, defaultPrevented: false, shiftKey: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() {},
            ...init
        };
        let node = this;
        while (node) {
            event.currentTarget = node;
            (node.listeners[type] || []).slice().forEach(fn => fn(event));
            node = node.parentNode || (node === this.ownerDocument.documentElement ? this.ownerDocument : null);
            if (node === this.ownerDocument) {
                event.currentTarget = node;
                (node.listeners[type] || []).slice().forEach(fn => fn(event));
                break;
            }
        }
        return event;
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { this.ownerDocument.activeElement = this; }
    contains(node) { while (node) { if (node === this) return true; node = node.parentNode; } return false; }
    matches(selector) { return selector.split(',').some(part => matchesSimple(this, part.trim())); }
    querySelectorAll(selector) {
        const out = [];
        const walk = node => node.children.forEach(child => { if (child.matches(selector)) out.push(child); walk(child); });
        walk(this);
        return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function fakeDocument({ studioPage = true, nativeDialog = false } = {}) {
    const doc = {
        listeners: {},
        activeElement: null,
        title: 'Panel',
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
        createElement(tag) {
            const el = new FakeElement(tag, doc);
            if (nativeDialog && el.tagName === 'DIALOG') {
                el.open = false;
                el.calls = [];
                el.showModal = function () { this.open = true; this.calls.push('showModal'); };
                el.close = function () { this.open = false; this.calls.push('close'); };
            }
            return el;
        },
        querySelector(sel) { return this.documentElement.querySelector(sel); },
        querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); },
        key(key, init = {}) {
            const target = this.activeElement || this.body;
            return target.dispatch('keydown', { key, ...init });
        }
    };
    doc.documentElement = new FakeElement('html', doc);
    doc.body = doc.documentElement.appendChild(new FakeElement('body', doc));
    doc.page = studioPage ? doc.body.appendChild(new FakeElement('div', doc)) : null;
    if (doc.page) doc.page.className = 'studio-page';
    doc.activeElement = doc.body;
    return doc;
}

function withDocument(doc, fn) {
    const previous = globalThis.document;
    globalThis.document = doc;
    const restore = () => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; };
    try {
        const out = fn();
        if (out && typeof out.then === 'function') return out.finally(restore);
        restore();
        return out;
    } catch (err) { restore(); throw err; }
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const overlays = doc => doc.querySelectorAll('dialog');
const buttonByText = (root, text) => root.querySelectorAll('button').find(b => b.textContent === text);

// -----------------------------------------------------------------
// Carga y superficie pública
// -----------------------------------------------------------------
test('el kit es un IIFE que expone window.WeOtziStudioKit y module.exports sin tocar el DOM al cargar', () => {
    const context = { window: {} };
    vm.runInNewContext(kitSource, context); // sin document, URL, fetch ni setTimeout
    assert.equal(typeof context.window.WeOtziStudioKit, 'object');
    assert.equal(typeof kit.fmtMoney, 'function');
    assert.match(kitSource, /module\.exports\s*=\s*kit/);
    const contractApi = [
        'escapeHtml', 'escapeAttr', 'safeUrl', 'fmtMoney', 'sumByCurrency', 'fmtTotals', 'fmtDate', 'fmtDateTime', 'fmtTime',
        'toDateInput', 'toLocalInput', 'fromLocalInput', 'monthKey', 'monthLabel', 'periodRange', 'label', 'badge', 'statusBadge',
        'toast', 'confirmDialog', 'promptDialog', 'openModal', 'openDrawer', 'emptyState', 'renderTable', 'barChart',
        'guarded', 'unwrap', 'friendlyError', 'isMissingSchema', 'downloadCsv', 'debounce', 'readForm', 'listEditor', 'postNotify'
    ];
    for (const name of contractApi) {
        assert.equal(typeof kit[name], 'function', name);
        assert.equal(typeof context.window.WeOtziStudioKit[name], 'function', 'VM: ' + name);
    }
    assert.equal(typeof kit.LABELS, 'object');
});

test('escapeHtml/escapeAttr neutralizan markup y comillas', () => {
    assert.equal(kit.escapeHtml('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
    assert.equal(kit.escapeHtml(null), '');
    assert.equal(kit.escapeAttr('a`b"c'), 'a&#96;b&quot;c');
    assert.equal(kit.htmlAttrs({ 'data-id': 'x"y', disabled: true, hidden: false, onclick: 'alert(1)', 'bad name': 1 }), ' data-id="x&quot;y" disabled');
});

test('safeUrl solo deja pasar http(s) con host, también sin URL global', () => {
    assert.equal(kit.safeUrl('https://instagram.com/estudio'), 'https://instagram.com/estudio');
    assert.equal(kit.safeUrl('  HTTP://example.com/a?b=1 '), 'http://example.com/a?b=1');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>', '/relativa', '//cdn.com/x', 'https://', 'ftp://x.com', '', null, undefined, 'https://a.com/\u0000x']) {
        assert.equal(kit.safeUrl(bad), null, String(bad));
    }
    const context = { window: {} };
    vm.runInNewContext(kitSource, context);
    assert.equal(context.window.WeOtziStudioKit.safeUrl('https://a.com/x'), 'https://a.com/x');
    assert.equal(context.window.WeOtziStudioKit.safeUrl('javascript:alert(1)'), null);
});

// -----------------------------------------------------------------
// Dinero por moneda
// -----------------------------------------------------------------
test('fmtMoney usa Intl es-AR y cae a "$ 1.234 ARS" sin Intl o con código inválido', () => {
    assert.equal(plain(kit.fmtMoney(1234, 'ARS')), '$ 1.234');
    assert.equal(plain(kit.fmtMoney(1234.5, 'usd')), 'US$ 1.234,50');
    assert.equal(plain(kit.fmtMoney('0', 'ARS')), '$ 0');
    assert.equal(kit.fmtMoney(null, 'ARS'), '—');
    assert.equal(kit.fmtMoney('', 'ARS'), '—');
    assert.equal(kit.fmtMoney('abc', 'ARS'), '—');
    assert.equal(plain(kit.fmtMoney(1234, 'A$')), '$ 1.234 A');
    assert.equal(kit.fmtMoney(5, '<script>').includes('<'), false, 'la moneda nunca inyecta markup');
    const context = { window: {}, Intl: undefined };
    vm.runInNewContext(kitSource, context);
    assert.equal(plain(context.window.WeOtziStudioKit.fmtMoney(1234, 'ARS')), '$ 1.234 ARS');
    assert.equal(plain(context.window.WeOtziStudioKit.fmtMoney(-1234.5, 'usd')), '$ -1.234,50 USD');
});

test('sumByCurrency agrupa por moneda en centavos y responde como objeto y como Map', () => {
    const totals = kit.sumByCurrency([
        { amount: 0.1, currency: 'ars' }, { amount: '0.2', currency: 'ARS' }, { amount: 3, currency: 'USD' },
        { amount: null, currency: 'EUR' }, { amount: 'x', currency: 'EUR' }, null, { amount: 5 }
    ], 'amount', 'currency');
    assert.deepEqual(Object.entries(totals), [['ARS', 0.3], ['USD', 8]]);
    assert.equal(totals.ARS, 0.3);
    assert.equal(totals.get('ars'), 0.3);
    assert.equal(totals.has('EUR'), false);
    assert.equal(totals.size, 2);
    assert.deepEqual([...totals], [['ARS', 0.3], ['USD', 8]]);
    assert.equal(JSON.stringify(totals), '{"ARS":0.3,"USD":8}');
    assert.deepEqual(Object.keys(kit.sumByCurrency([{ gross: 10, cur: 'BRL' }], row => row.gross * 2, 'cur')), ['BRL']);
    assert.equal(kit.sumByCurrency([{ gross: 10, cur: 'BRL' }], row => row.gross * 2, 'cur').BRL, 20);
    assert.equal(kit.sumByCurrency([{ a: { b: 7 }, c: 'clp' }], 'a.b', 'c').CLP, 7);
    assert.equal(kit.sumByCurrency(null).size, 0);
});

test('fmtTotals nunca mezcla monedas y mergeTotals resta por moneda', () => {
    const income = kit.sumByCurrency([{ amount: 1000, currency: 'USD' }, { amount: 50000, currency: 'ARS' }]);
    assert.equal(plain(kit.fmtTotals(income)), '$ 50.000 · US$ 1.000');
    assert.equal(kit.fmtTotals({}), '—');
    assert.equal(kit.fmtTotals(null, { empty: 'Sin movimientos' }), 'Sin movimientos');
    assert.equal(plain(kit.fmtTotals(new Map([['eur', 2]]))), 'EUR 2');
    const result = kit.mergeTotals(income, { ARS: 60000, EUR: 10 }, -1);
    assert.deepEqual(Object.entries(result), [['ARS', -10000], ['EUR', -10], ['USD', 1000]]);
    assert.match(kit.fmtTotalsHtml(result), /<span class="sk-total is-negative">/);
    assert.equal(kit.fmtTotalsHtml({}), '<span class="sk-total sk-muted">—</span>');
});

// -----------------------------------------------------------------
// Fechas y períodos
// -----------------------------------------------------------------
test('las fechas SQL de calendario no se corren de día en Argentina', () => withTZ('America/Argentina/Buenos_Aires', () => {
    assert.equal(kit.fmtDate('2026-09-01'), '01/09/2026');
    assert.equal(kit.toDateInput('2026-09-01'), '2026-09-01');
    assert.equal(kit.monthKey('2026-09-01'), '2026-09');
    assert.equal(kit.monthLabel('2026-09-01'), 'Septiembre 2026');
    assert.equal(kit.monthLabel('2026-10', { short: true }), 'Oct 2026');
    assert.equal(kit.fmtDate('2026-10-30T02:00:00Z'), '29/10/2026', 'un instante UTC se muestra en hora local');
    assert.equal(kit.fmtDate('2026-10-30', { style: 'long' }), '30 de octubre de 2026');
    assert.equal(kit.fmtDate('2026-10-29', { style: 'weekday' }), 'Jue 29/10');
    assert.equal(kit.fmtDate(null), '—');
    assert.equal(kit.fmtDate('no es fecha'), '—');
    assert.equal(kit.monthLabel('basura'), '—');
}));

test('horas en 24 h y round-trip de datetime-local', () => withTZ('America/Argentina/Buenos_Aires', () => {
    assert.equal(kit.fmtTime('2026-10-30T17:05:00Z'), '14:05');
    assert.equal(kit.fmtDateTime('2026-10-30T17:05:00Z'), '30/10/2026 14:05');
    assert.equal(kit.toLocalInput('2026-10-30T17:05:00Z'), '2026-10-30T14:05');
    assert.equal(kit.fromLocalInput('2026-10-30T14:05'), '2026-10-30T17:05:00.000Z');
    assert.equal(kit.fromLocalInput('2026-10-30'), '2026-10-30T03:00:00.000Z');
    assert.equal(kit.fromLocalInput(''), null);
    assert.equal(kit.fromLocalInput('nada'), null);
    assert.equal(kit.toLocalInput(null), '');
    assert.equal(kit.toDateInput(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
    assert.equal(kit.fmtRelative('2026-10-27', '2026-10-30'), 'hace 3 días');
    assert.equal(kit.fmtRelative('2026-10-31', '2026-10-30'), 'mañana');
    assert.equal(kit.daysUntil('2026-11-02', '2026-10-30T22:00'), 3);
}));

test('periodRange cubre todos los presets con meses calendario completos', () => withTZ('America/Argentina/Buenos_Aires', () => {
    const now = new Date(2026, 0, 15, 10, 0);
    const pick = r => [r.from, r.to, r.months.join(',')];
    assert.deepEqual(pick(kit.periodRange('this_month', null, now)), ['2026-01-01', '2026-01-31', '2026-01']);
    assert.deepEqual(pick(kit.periodRange('last_month', null, now)), ['2025-12-01', '2025-12-31', '2025-12']);
    assert.deepEqual(pick(kit.periodRange('last_3_months', null, now)), ['2025-11-01', '2026-01-31', '2025-11,2025-12,2026-01']);
    assert.equal(kit.periodRange('last_6_months', null, now).from, '2025-08-01');
    assert.equal(kit.periodRange('last_12_months', null, now).months.length, 12);
    assert.deepEqual(pick(kit.periodRange('this_year', null, now)).slice(0, 2), ['2026-01-01', '2026-12-31']);
    const custom = kit.periodRange('custom', { from: '2026-03-20', to: '2026-02-10' }, now);
    assert.deepEqual([custom.from, custom.to, custom.preset], ['2026-02-10', '2026-03-20', 'custom']);
    assert.equal(custom.label, 'Del 10/02/2026 al 20/03/2026');
    assert.equal(custom.fromMonth, '2026-02-01');
    assert.equal(custom.toMonth, '2026-03-01');
    assert.equal(custom.fromIso, '2026-02-10T03:00:00.000Z');
    assert.equal(custom.toIso, '2026-03-21T03:00:00.000Z', 'toIso es exclusivo (día siguiente)');
    assert.equal(kit.periodRange('custom', {}, now).from, '2026-01-01');
    assert.equal(kit.periodRange('cualquiera', null, now).preset, 'this_month');
    assert.equal(kit.periodRange('this_month', null, now).label, 'Este mes');
    for (const preset of kit.PERIOD_PRESETS) assert.ok(kit.LABELS.periodPreset[preset], preset);
}));

// -----------------------------------------------------------------
// Etiquetas
// -----------------------------------------------------------------
const CONTRACT_ENUMS = {
    membershipStatus: ['requested', 'pending_invite', 'pending_acceptance', 'active', 'paused', 'rejected', 'ended'],
    membershipRole: ['resident', 'guest', 'itinerant', 'manager'],
    initiatedBy: ['studio', 'artist'],
    contractStatus: ['draft', 'sent', 'signed', 'declined', 'cancelled', 'terminated', 'expired'],
    contractOrigin: ['spot_application', 'invitation', 'request', 'manual'],
    compensationModel: ['percentage', 'fixed', 'mixed'],
    fixedPeriod: ['per_session', 'daily', 'weekly', 'monthly', 'one_time'],
    fixedPayer: ['artist_to_studio', 'studio_to_artist'],
    bookingStatus: ['confirmed', 'completed', 'cancelled', 'no_show'],
    movementKind: ['restock', 'consumption', 'adjustment', 'loss', 'assignment', 'return'],
    financeCategory: [
        'rent', 'supplies', 'inventory_purchase', 'salaries', 'artist_payout', 'utilities', 'marketing', 'equipment',
        'maintenance', 'taxes', 'fees', 'software', 'other', 'chair_rent', 'merch_manual', 'service_other', 'sponsorship', 'other_income'
    ],
    paymentMethod: ['cash', 'card', 'transfer', 'other'],
    supplyOrderStatus: ['submitted', 'confirmed', 'rejected', 'shipped', 'delivered', 'received', 'cancelled'],
    supplyCategory: ['inks', 'needles_cartridges', 'gloves', 'paper_film', 'hygiene', 'aftercare', 'machines', 'power_supplies', 'furniture', 'piercing', 'other'],
    claimStatus: ['pending', 'approved', 'rejected'],
    financeEntryType: ['expense', 'income'],
    financeEntryStatus: ['recorded', 'voided'],
    spotKind: ['resident', 'itinerant', 'guest_spot'],
    applicationStatus: ['pending', 'viewed', 'shortlisted', 'accepted', 'rejected', 'withdrawn'],
    supplyActorRole: ['studio', 'vendor', 'support'],
    bookingCreatedByRole: ['studio', 'support'],
    busySource: ['agenda_personal', 'otro_estudio']
};
// Préstamos que en español se escriben igual, y valores que ya vienen en español de la base.
const LOANWORDS = new Set(['guest', 'guest_spot', 'manager', 'marketing', 'software', 'piercing', 'aftercare', 'agenda_personal']);

test('LABELS cubre cada estado/enum del contrato, en español', () => {
    for (const [dict, values] of Object.entries(CONTRACT_ENUMS)) {
        assert.ok(kit.LABELS[dict], 'falta LABELS.' + dict);
        for (const value of values) {
            const text = kit.LABELS[dict][value];
            assert.equal(typeof text, 'string', dict + '.' + value);
            assert.ok(text.trim().length > 1, dict + '.' + value);
            if (!LOANWORDS.has(value)) assert.notEqual(text.toLowerCase(), value.replace(/_/g, ' '), 'valor crudo en ' + dict + '.' + value);
            assert.equal(kit.label(dict, value), text);
            assert.equal(kit.label(kit.LABELS[dict], value), text);
        }
    }
    assert.equal(kit.LABELS.fixedPayer.artist_to_studio, 'Alquiler de puesto: el artista paga al estudio');
    assert.equal(kit.LABELS.fixedPayer.studio_to_artist, 'Pago al artista: el estudio paga');
    assert.equal(kit.LABELS.movementKind.assignment, 'Entrega a artista');
    assert.equal(kit.LABELS.movementKind.return, 'Devolución');
    assert.equal(kit.LABELS.financeCategory.merch_manual, 'Merch (manual)');
    assert.deepEqual(kit.FINANCE_CATEGORIES.expense.concat(kit.FINANCE_CATEGORIES.income).sort(), CONTRACT_ENUMS.financeCategory.slice().sort());
});

test('label nunca devuelve el valor crudo y statusBadge elige tono', () => {
    assert.equal(kit.label('contractStatus', null), '—');
    assert.equal(kit.label('contractStatus', 'weird_status'), 'Otro');
    assert.equal(kit.label('noExiste', 'pending'), 'Pendiente');
    assert.equal(kit.label('contractStatus', 'x', 'Sin dato'), 'Sin dato');
    assert.equal(kit.statusBadge('contractStatus', 'signed'), '<span class="sk-badge sk-badge--success">Firmado</span>');
    assert.equal(kit.statusBadge(kit.LABELS.bookingStatus, 'no_show'), '<span class="sk-badge sk-badge--danger">No asistió</span>');
    assert.equal(kit.statusBadge('membershipStatus', 'requested'), '<span class="sk-badge sk-badge--warning">Solicitud pendiente</span>');
    assert.equal(kit.statusBadge('supplyOrderStatus', 'shipped'), '<span class="sk-badge sk-badge--info">Despachado</span>');
    assert.equal(kit.badge('<b>', 'error'), '<span class="sk-badge sk-badge--danger">&lt;b&gt;</span>');
    assert.equal(kit.badge('x', 'raro'), '<span class="sk-badge sk-badge--neutral">x</span>');
    assert.equal(kit.optionsHtml('paymentMethod', 'card', { only: ['cash', 'card'], empty: 'Elegí' }),
        '<option value="">Elegí</option><option value="cash">Efectivo</option><option value="card" selected>Tarjeta</option>');
    assert.match(kit.currencyOptionsHtml('uyu'), /<option value="UYU" selected>UYU<\/option>/);
    assert.match(kit.currencyOptionsHtml('GBP'), /<option value="GBP" selected>GBP<\/option>/);
});

// -----------------------------------------------------------------
// Errores
// -----------------------------------------------------------------
test('friendlyError: códigos de migración pendiente → aviso; el resto, el mensaje', () => {
    for (const code of ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01']) {
        assert.equal(kit.friendlyError({ code, message: 'relation x does not exist' }), 'Esta función todavía no está disponible (falta aplicar una migración).', code);
        assert.equal(kit.isMissingSchema({ code }), true, code);
        assert.equal(kit.isMissingSchema({ data: null, error: { code } }), true, 'resultado ' + code);
        assert.equal(kit.isMissingSchema(code), true);
    }
    assert.equal(kit.friendlyError({ code: 'P0001', message: 'Esperá unos días antes de volver a solicitar' }), 'Esperá unos días antes de volver a solicitar');
    assert.equal(kit.friendlyError({ code: '23514', message: 'Stock insuficiente de Tinta' }), 'Stock insuficiente de Tinta');
    assert.equal(kit.friendlyError({ code: '42501', message: '' }), 'No pudimos completar la acción. Intentá de nuevo.');
    assert.equal(kit.friendlyError({ data: null, error: { message: 'Hola' } }), 'Hola');
    assert.equal(kit.friendlyError('Texto directo'), 'Texto directo');
    assert.equal(kit.friendlyError(null, 'Probá más tarde'), 'Probá más tarde');
    assert.equal(kit.friendlyError(new TypeError('Failed to fetch')), 'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.');
    assert.equal(kit.isMissingSchema({ code: '23514' }), false);
    assert.equal(kit.isMissingSchema(null), false);
    assert.equal(kit.isMissingSchema({ message: "Could not find the 'x' column of 'y' in the schema cache" }), true);
});

test('unwrap devuelve data y lanza un Error con el code original', () => {
    assert.deepEqual(kit.unwrap({ data: [1], error: null }), [1]);
    assert.equal(kit.unwrap({ data: null, error: null }), null);
    assert.equal(kit.unwrap(undefined), null);
    assert.throws(() => kit.unwrap({ data: null, error: { code: 'PGRST202', message: 'no fn' } }), err => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, 'PGRST202');
        assert.equal(kit.friendlyError(err), 'Esta función todavía no está disponible (falta aplicar una migración).');
        return true;
    });
});

// -----------------------------------------------------------------
// CSV
// -----------------------------------------------------------------
test('downloadCsv arma CSV con BOM, ";" , coma decimal y sin inyección de fórmulas', () => {
    const rows = [
        { name: 'Tinta "negra"', qty: 1.5, ok: true, when: new Date(2026, 9, 30, 14, 5), tags: ['a', 'b'], nested: { v: 3 } },
        { name: '=HYPERLINK("x")', qty: -2, ok: false, when: null, tags: [], nested: { v: null } },
        { name: 'a;b\nc', qty: '-5', ok: null, when: '2026-10-30', tags: null, nested: null }
    ];
    const columns = [
        { key: 'name', label: 'Ítem' }, { key: 'qty', label: 'Cantidad' }, { key: 'ok', label: 'OK' },
        { key: 'when', label: 'Fecha' }, { key: 'tags', label: 'Tags' }, { key: 'nested.v', label: 'V' },
        { label: 'Calc', value: row => (typeof row.qty === 'number' ? row.qty * 2 : '') }
    ];
    const csv = kit.downloadCsv('reporte', columns, rows); // sin DOM: devuelve el contenido
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[0], 'Ítem;Cantidad;OK;Fecha;Tags;V;Calc');
    assert.equal(lines[1], '"Tinta ""negra""";1,5;Sí;2026-10-30 14:05;a, b;3;3');
    assert.equal(lines[2], '"\'=HYPERLINK(""x"")";-2;No;;;;-4');
    assert.equal(lines[3], '"a;b\nc";-5;;2026-10-30;;;');
    assert.equal(lines[4], '');
    assert.equal(kit.toCsv(['a'], [{ a: 'x' }]), 'a\r\nx\r\n');
});

test('downloadCsv en el navegador descarga un Blob text/csv con nombre .csv', () => {
    const doc = fakeDocument();
    const created = [];
    const saved = { Blob: globalThis.Blob, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = blob => { created.push(blob); return 'blob:fake'; };
    URL.revokeObjectURL = () => {};
    let clicked = null;
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = tag => { const el = origCreate(tag); if (tag === 'a') el.click = () => { clicked = { href: el.href, download: el.download, inDom: el.isConnected }; }; return el; };
    try {
        withDocument(doc, () => kit.downloadCsv('ventas: octubre', [{ key: 'a', label: 'A' }], [{ a: 1 }]));
    } finally {
        URL.createObjectURL = saved.create;
        URL.revokeObjectURL = saved.revoke;
    }
    assert.equal(created.length, 1);
    assert.equal(created[0].type, 'text/csv;charset=utf-8');
    assert.deepEqual(clicked, { href: 'blob:fake', download: 'ventas- octubre.csv', inDom: true });
    assert.equal(doc.body.querySelectorAll('a').length, 0, 'el link temporal se quita');
});

// -----------------------------------------------------------------
// Bloques HTML
// -----------------------------------------------------------------
test('renderTable escapa celdas, formatea y muestra el empty state', () => {
    const html = kit.renderTable({
        columns: [
            { key: 'name', label: 'Artista' },
            { key: 'amount', label: 'Importe', format: 'money' },
            { key: 'status', label: 'Estado', badge: 'contractStatus' },
            { key: 'role', label: 'Rol', dict: 'membershipRole' },
            { key: 'occurred_on', label: 'Fecha', format: 'date' },
            { label: 'Acciones', render: row => '<button data-id="' + kit.escapeAttr(row.id) + '">Ver</button>' }
        ],
        rows: [{ id: 'c"1', name: '<script>', amount: 1500, currency: 'ARS', status: 'sent', role: 'guest', occurred_on: '2026-10-01' }],
        rowAttrs: row => ({ 'data-row': row.id })
    });
    assert.match(html, /^<div class="sk-table-wrap"><table class="sk-table">/);
    assert.match(html, /<td data-label="Artista">&lt;script&gt;<\/td>/);
    assert.match(plain(html), /<td class="sk-num" data-label="Importe">\$ 1\.500<\/td>/);
    assert.match(html, /sk-badge--info">Pendiente de firma/);
    assert.match(html, />Guest</);
    assert.match(html, />01\/10\/2026</);
    assert.match(html, /<tr data-row="c&quot;1">/);
    assert.match(html, /<button data-id="c&quot;1">Ver<\/button>/);
    assert.doesNotMatch(html, /<script>/);
    const empty = kit.renderTable({ columns: ['a'], rows: [], emptyText: 'Todavía no hay <gastos>' });
    assert.match(empty, /class="sk-empty sk-empty--compact"/);
    assert.match(empty, /Todavía no hay &lt;gastos&gt;/);
});

test('emptyState, kpis y barChart son HTML puro y escapado', () => {
    const empty = kit.emptyState({ title: 'La Tienda llega <pronto>', body: 'Registrá ventas en Finanzas → Ingreso', actionHtml: '<button class="studio-btn">Ir a Finanzas</button>' });
    assert.match(empty, /<p class="sk-empty__title">La Tienda llega &lt;pronto&gt;<\/p>/);
    assert.match(empty, /<div class="sk-empty__action"><button class="studio-btn">Ir a Finanzas<\/button><\/div>/);

    const k = kit.kpis([{ label: 'Gastos', valueHtml: kit.fmtTotalsHtml({ ARS: 10 }), hint: 'Mes <actual>', tone: 'warning' }, { label: 'Tatuajes', value: 3 }]);
    assert.match(k, /^<div class="sk-kpis"><div class="sk-kpi sk-kpi--warning">/);
    assert.match(k, /<small class="sk-kpi__hint">Mes &lt;actual&gt;<\/small>/);
    assert.match(k, /<strong class="sk-kpi__value">3<\/strong>/);

    const bars = kit.barChart({ items: [{ label: 'Alquiler', value: 200, currency: 'ARS' }, { label: 'Resultado <neg>', value: -50, currency: 'ARS' }, { label: 'Cero', value: 0 }], format: 'money' });
    assert.match(bars, /^<ul class="sk-bars">/);
    assert.match(bars, /style="width:100%"/);
    assert.match(bars, /<li class="sk-bar sk-bar--danger">.*Resultado &lt;neg&gt;.*style="width:25%"/);
    assert.match(bars, /<li class="sk-bar is-zero">/);
    assert.match(plain(bars), /\$ 200/);
    const custom = kit.barChart({ items: [{ label: 'A', value: 3 }], format: v => v + ' u.' });
    assert.match(custom, />3 u\.</);
    assert.match(kit.barChart({ items: [] }), /sk-empty/);
});

// -----------------------------------------------------------------
// Utilidades con tiempo
// -----------------------------------------------------------------
test('debounce agrupa llamadas y permite cancel/flush', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fn = kit.debounce(v => calls.push(v), 400);
    fn(1); fn(2); fn(3);
    t.mock.timers.tick(399);
    assert.deepEqual(calls, []);
    t.mock.timers.tick(1);
    assert.deepEqual(calls, [3]);
    fn(4); fn.cancel();
    t.mock.timers.tick(1000);
    assert.deepEqual(calls, [3]);
    fn(5); fn.flush();
    assert.deepEqual(calls, [3, 5]);
});

test('guarded deshabilita el botón, ignora el doble click y avisa el error', async () => {
    const doc = fakeDocument();
    await withDocument(doc, async () => {
        const btn = doc.createElement('button');
        let release;
        const first = kit.guarded(btn, () => new Promise(resolve => { release = resolve; }));
        await flush();
        assert.equal(btn.disabled, true);
        assert.equal(btn.getAttribute('aria-busy'), 'true');
        assert.equal(await kit.guarded(btn, () => 'segunda'), undefined, 'mientras corre no se ejecuta otra vez');
        release('listo');
        assert.equal(await first, 'listo');
        assert.equal(btn.disabled, false);
        assert.equal(btn.getAttribute('aria-busy'), null);

        const result = await kit.guarded(btn, async () => { throw { code: 'PGRST202', message: 'x' }; });
        assert.equal(result, undefined);
        assert.equal(btn.disabled, false);
        const toastEl = doc.querySelector('.sk-toast');
        assert.ok(toastEl, 'el error se muestra en un toast');
        assert.equal(toastEl.getAttribute('role'), 'alert');
        assert.equal(toastEl.querySelector('.sk-toast__text').textContent, 'Esta función todavía no está disponible (falta aplicar una migración).');
        toastEl.querySelector('.sk-toast__close').click();

        const seen = [];
        await kit.guarded(btn, () => { throw new Error('boom'); }, { onError: err => seen.push(err.message) });
        assert.deepEqual(seen, ['boom']);
        await assert.rejects(kit.guarded(btn, () => { throw new Error('re'); }, { rethrow: true, silent: true }), /re/);

        const handler = kit.guarded(async event => event.type);
        assert.equal(typeof handler, 'function');
        assert.equal(await handler({ type: 'click', currentTarget: btn }), 'click');
    });
});

test('toast apila en .studio-page, usa tono y se cierra solo', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const doc = fakeDocument();
    withDocument(doc, () => {
        const ok = kit.toast('Guardado', 'success');
        const stack = doc.page.querySelector('.sk-toast-stack');
        assert.ok(stack, 'el stack vive dentro de .studio-page');
        assert.equal(stack.getAttribute('aria-live'), 'polite');
        assert.equal(ok.el.className, 'sk-toast sk-toast--success');
        assert.equal(ok.el.getAttribute('role'), null);
        const sticky = kit.toast({ code: '42P01' }, 'error', { persist: true });
        assert.equal(sticky.el.className, 'sk-toast sk-toast--danger');
        assert.match(sticky.el.textContent, /falta aplicar una migración/);
        t.mock.timers.tick(4500);
        assert.equal(ok.el.parentNode, null, 'se fue a los 4,5 s');
        assert.equal(sticky.el.parentNode, stack, 'persist no se cierra solo');
        sticky.close();
        for (let i = 0; i < 6; i++) kit.toast('n' + i, 'info', { persist: true });
        assert.equal(stack.children.length, 4, 'máximo 4 en pantalla');
        stack.children.slice().forEach(c => c.remove());
    });
});

test('readForm tipa checkbox, radio, number, select múltiple y texto', () => {
    const doc = fakeDocument();
    const make = (tag, props) => Object.assign(doc.createElement(tag), props);
    const form = {
        elements: [
            make('input', { name: 'client_name', type: 'text', value: '  Ana  ' }),
            make('input', { name: 'client_phone', type: 'tel', value: '' }),
            make('input', { name: 'amount', type: 'number', value: '1500.5' }),
            make('input', { name: 'deposit_amount', type: 'number', value: '' }),
            make('input', { name: 'accept', type: 'checkbox', checked: true }),
            make('input', { name: 'days', type: 'checkbox', value: 'mon', checked: true }),
            make('input', { name: 'days', type: 'checkbox', value: 'tue', checked: false }),
            make('input', { name: 'days', type: 'checkbox', value: 'wed', checked: true }),
            make('input', { name: 'payer', type: 'radio', value: 'artist_to_studio', checked: false }),
            make('input', { name: 'payer', type: 'radio', value: 'studio_to_artist', checked: true }),
            make('select', { name: 'styles', type: 'select-multiple', multiple: true, options: [{ value: 'a', selected: true }, { value: 'b', selected: false }, { value: 'c', selected: true }] }),
            make('textarea', { name: 'notes', type: 'textarea', value: ' hola\n' }),
            make('input', { name: 'locked', type: 'text', value: 'x', disabled: true }),
            make('button', { name: 'save', type: 'submit' }),
            make('input', { type: 'text', value: 'sin nombre' })
        ]
    };
    form.elements[form.elements.length - 1].setAttribute('data-field', 'by_data');
    assert.deepEqual(kit.readForm(form), {
        client_name: 'Ana', client_phone: '', amount: 1500.5, deposit_amount: null, accept: true,
        days: ['mon', 'wed'], payer: 'studio_to_artist', styles: ['a', 'c'], notes: 'hola', by_data: 'sin nombre'
    });
    const nulls = kit.readForm(form, { emptyAsNull: true, includeDisabled: true });
    assert.equal(nulls.client_phone, null);
    assert.equal(nulls.locked, 'x');
    assert.deepEqual(kit.readForm(null), {});
});

// -----------------------------------------------------------------
// listEditor
// -----------------------------------------------------------------
test('listEditor normaliza, agrega con Enter/botón, quita y respeta max/maxLen', () => {
    const doc = fakeDocument();
    withDocument(doc, () => {
        const changes = [];
        const editor = kit.listEditor({
            items: ['  Camilla ', 'camilla', '', 'Lámpara', 'Wifi', 'Excedente'], max: 4, maxLen: 10,
            placeholder: 'Qué incluye', onChange: items => changes.push(items)
        });
        assert.equal(editor.el.className, 'sk-list-editor sk-list-editor--chips');
        assert.deepEqual(editor.getItems(), ['Camilla', 'Lámpara', 'Wifi', 'Excedente']);
        assert.equal(editor.input.disabled, true, 'lleno → no se puede agregar');
        assert.match(editor.el.querySelector('.sk-list-editor__count').textContent, /^4\/4/);

        const removeWifi = editor.el.querySelectorAll('.sk-list-editor__remove')[2];
        assert.equal(removeWifi.getAttribute('aria-label'), 'Quitar «Wifi»');
        removeWifi.click();
        assert.deepEqual(editor.getItems(), ['Camilla', 'Lámpara', 'Excedente']);
        assert.equal(editor.input.disabled, false);

        editor.input.value = 'Insumos básicos de higiene';
        const ev = editor.input.dispatch('keydown', { key: 'Enter' });
        assert.equal(ev.defaultPrevented, true, 'Enter no envía el formulario');
        assert.deepEqual(editor.getItems(), ['Camilla', 'Lámpara', 'Excedente', 'Insumos bá']);
        assert.equal(editor.input.value, '');
        assert.deepEqual(changes.map(c => c.length), [3, 4]);

        editor.setItems(['Uno']);
        editor.input.value = 'Pendiente';
        assert.deepEqual(editor.getItems(), ['Uno', 'Pendiente'], 'incluye lo tipeado sin agregar');
        editor.el.querySelector('.sk-list-editor__add-btn').click();
        assert.deepEqual(editor.getItems(), ['Uno', 'Pendiente']);

        const lines = kit.listEditor({ items: ['Puntualidad'], variant: 'lines' });
        const line = lines.el.querySelector('.sk-list-editor__line');
        line.value = 'Puntualidad y orden';
        line.dispatch('input');
        assert.deepEqual(lines.getItems(), ['Puntualidad y orden']);
        assert.equal(lines.el.className, 'sk-list-editor sk-list-editor--lines');
    });
    const headless = kit.listEditor({ items: ['a', 'A', 'b'] });
    assert.equal(headless.el, null);
    assert.deepEqual(headless.getItems(), ['a', 'b']);
});

// -----------------------------------------------------------------
// Modal / drawer / confirm / prompt
// -----------------------------------------------------------------
test('openModal monta en .studio-page, atrapa foco, cierra con Esc y restaura el foco', async () => {
    const doc = fakeDocument();
    await withDocument(doc, async () => {
        const opener = doc.page.appendChild(doc.createElement('button'));
        opener.focus();
        const closedWith = [];
        const m = kit.openModal({ title: 'Nueva cita', body: '<p>Formulario</p>', onClose: v => closedWith.push(v), actions: [{ label: 'Cancelar', variant: 'ghost' }, { label: 'Guardar', variant: 'primary', onClick: () => 'ok' }] });
        assert.equal(m.el.parentNode, doc.page, 'se monta dentro de .studio-page');
        assert.equal(m.el.tagName, 'DIALOG');
        assert.equal(m.el.getAttribute('role'), 'dialog', 'sin showModal → fallback con role');
        assert.equal(m.el.getAttribute('aria-modal'), 'true');
        assert.ok(m.el.classList.contains('sk-overlay') && m.el.classList.contains('sk-modal') && m.el.classList.contains('sk-modal--md'));
        assert.equal(m.el.querySelector('.sk-overlay__title').textContent, 'Nueva cita');
        assert.equal(m.el.getAttribute('aria-labelledby'), m.el.querySelector('.sk-overlay__title').id);
        assert.equal(m.body.innerHTML, '<p>Formulario</p>');
        assert.equal(doc.activeElement, buttonByText(m.el, 'Guardar'), 'foco inicial en la acción primaria');
        assert.ok(doc.documentElement.classList.contains('sk-scroll-lock'));

        // Tab en el último → vuelve al primero (botón cerrar del header).
        const tab = doc.key('Tab');
        assert.equal(tab.defaultPrevented, true);
        assert.equal(doc.activeElement, m.el.querySelector('.sk-overlay__close'));
        doc.key('Tab', { shiftKey: true });
        assert.equal(doc.activeElement, buttonByText(m.el, 'Guardar'));

        doc.key('Escape');
        assert.equal(await m.closed, null);
        assert.deepEqual(closedWith, [null]);
        assert.equal(m.el.parentNode, null, 'se quita del DOM');
        assert.equal(doc.activeElement, opener, 'devuelve el foco');
        assert.equal(doc.documentElement.classList.contains('sk-scroll-lock'), false);
    });
});

test('las acciones del modal: error queda adentro, false no cierra, value cierra', async () => {
    const doc = fakeDocument({ studioPage: false });
    await withDocument(doc, async () => {
        let attempts = 0;
        const m = kit.openModal({
            title: 'Gasto', body: 'Texto plano', size: 'lg',
            actions: [
                { label: 'Validar', close: false, onClick: () => 'x' },
                { label: 'Guardar', variant: 'primary', value: 'saved', onClick: async modal => {
                    attempts++;
                    if (attempts === 1) throw { code: '23514', message: 'Stock insuficiente de Tinta' };
                    if (attempts === 2) return false;
                    assert.equal(modal.isBusy(), true, 'mientras corre queda ocupado');
                    return 'ignorado';
                } }
            ]
        });
        assert.equal(m.el.parentNode, doc.body, 'sin .studio-page → body');
        assert.ok(m.el.classList.contains('sk-modal--lg'));
        assert.equal(m.body.innerHTML, '<p class="sk-overlay__text">Texto plano</p>');
        const save = buttonByText(m.el, 'Guardar');
        save.click(); await flush();
        const error = m.el.querySelector('.sk-overlay__error');
        assert.equal(error.hidden, false);
        assert.equal(error.textContent, 'Stock insuficiente de Tinta');
        assert.equal(m.el.isConnected, true);
        save.click(); await flush();
        assert.equal(m.el.isConnected, true, 'false mantiene abierto');
        assert.equal(error.hidden, true, 'el error se limpia al reintentar');
        buttonByText(m.el, 'Validar').click(); await flush();
        assert.equal(m.el.isConnected, true, 'close:false no cierra');
        save.click();
        assert.equal(await m.closed, 'saved');
    });
});

test('Esc cierra solo el overlay de arriba y no cierra mientras está ocupado', async () => {
    const doc = fakeDocument();
    await withDocument(doc, async () => {
        const drawer = kit.openDrawer({ title: 'Contrato C-2026-0001', body: '<div class="sk-print-doc">Doc</div>', width: 'lg' });
        assert.ok(drawer.el.classList.contains('sk-drawer') && drawer.el.classList.contains('sk-drawer--lg'));
        assert.equal(drawer.footer.hidden, true, 'sin acciones no hay pie');
        const confirmP = kit.confirmDialog({ title: '¿Rescindir?', body: 'El artista recibe un aviso.', confirmLabel: 'Rescindir', tone: 'danger' });
        const dialogs = overlays(doc);
        assert.equal(dialogs.length, 2);
        const confirmEl = dialogs[1];
        assert.equal(doc.activeElement, buttonByText(confirmEl, 'Cancelar'), 'en peligro el foco va a Cancelar');
        assert.ok(buttonByText(confirmEl, 'Rescindir').classList.contains('sk-btn--danger'));
        doc.key('Escape');
        assert.equal(await confirmP, false);
        assert.equal(drawer.el.isConnected, true, 'el drawer sigue abierto');
        drawer.setBusy(true);
        doc.key('Escape');
        assert.equal(drawer.el.isConnected, true, 'ocupado no se cierra');
        drawer.setBusy(false);
        drawer.el.querySelector('.sk-overlay__close').click();
        assert.equal(await drawer.closed, null);
        const custom = kit.openDrawer({ title: 'x', width: 720 });
        assert.equal(custom.panel.style.width, '720px');
        custom.close();
    });
});

test('al cerrar un confirm anidado el foco vuelve a la acción del drawer', async () => {
    const doc = fakeDocument();
    await withDocument(doc, async () => {
        const drawer = kit.openDrawer({
            title: 'Contrato', width: 'lg',
            actions: [{ label: 'Rescindir', variant: 'danger', onClick: async () => {
                doc.activeElement = doc.body; // el navegador saca el foco del botón deshabilitado
                await kit.confirmDialog({ title: '¿Rescindir?', tone: 'danger' });
                return false;
            } }]
        });
        const action = buttonByText(drawer.el, 'Rescindir');
        action.click();
        await flush();
        assert.equal(overlays(doc).length, 2);
        assert.equal(action.disabled, true, 'ocupado mientras confirma');
        doc.key('Escape');
        await flush(); await flush();
        assert.equal(overlays(doc).length, 1);
        assert.equal(action.disabled, false);
        assert.equal(doc.activeElement, action);
        drawer.close();
    });
});

test('con <dialog> nativo usa showModal/close y el evento cancel', async () => {
    const doc = fakeDocument({ nativeDialog: true });
    await withDocument(doc, async () => {
        const m = kit.openModal({ title: 'Nativo' });
        assert.deepEqual(m.el.calls, ['showModal']);
        assert.equal(m.el.getAttribute('role'), null, 'el rol es implícito');
        assert.equal(m.el.classList.contains('sk-overlay--fallback'), false);
        const ev = m.el.dispatch('cancel');
        assert.equal(ev.defaultPrevented, true);
        assert.equal(await m.closed, null);
        assert.deepEqual(m.el.calls, ['showModal', 'close']);

        // Click en el fondo: cierra sin campos ('auto'), no si hay campos.
        const info = kit.openModal({ title: 'Info', body: '<p>x</p>' });
        info.el.dispatch('mousedown');
        info.el.dispatch('click');
        assert.equal(await info.closed, null);
        const form = kit.openModal({ title: 'Form', body: doc.createElement('input') });
        form.el.dispatch('mousedown');
        form.el.dispatch('click');
        assert.equal(form.el.isConnected, true, 'con campos el fondo no cierra');
        form.close('x');
        assert.equal(await form.closed, 'x');
    });
});

test('confirmDialog y promptDialog resuelven valores', async () => {
    const doc = fakeDocument();
    await withDocument(doc, async () => {
        const yes = kit.confirmDialog({ title: '¿Emitir?', body: 'Se envía al artista.' });
        const el = overlays(doc)[0];
        assert.equal(doc.activeElement, buttonByText(el, 'Confirmar'));
        buttonByText(el, 'Confirmar').click();
        assert.equal(await yes, true);

        const name = kit.promptDialog({ title: 'Firmá el contrato', label: 'Nombre completo', placeholder: 'Nombre y apellido', required: true, minLength: 3 });
        const dlg = overlays(doc)[0];
        const input = dlg.querySelector('input');
        assert.equal(doc.activeElement, input);
        assert.equal(input.getAttribute('placeholder'), 'Nombre y apellido');
        const accept = buttonByText(dlg, 'Aceptar');
        accept.click(); await flush();
        assert.equal(dlg.querySelector('.sk-overlay__error').textContent, 'Completá este campo para continuar.');
        assert.equal(input.getAttribute('aria-invalid'), 'true');
        input.value = 'Al';
        accept.click(); await flush();
        assert.equal(dlg.querySelector('.sk-overlay__error').textContent, 'Ingresá al menos 3 caracteres.');
        input.value = '  Ana Pérez  ';
        input.dispatch('keydown', { key: 'Enter' });
        assert.equal(await name, 'Ana Pérez');

        const cancelled = kit.promptDialog({ title: 'Motivo' });
        doc.key('Escape');
        assert.equal(await cancelled, null);
    });
    assert.equal(await kit.confirmDialog({ title: 'sin DOM' }), false);
    assert.equal(await kit.promptDialog({ title: 'sin DOM' }), null);
});

test('con un modal abierto los toasts se muestran dentro del dialog y vuelven al cerrar', async () => {
    const doc = fakeDocument();
    await withDocument(doc, async () => {
        const m = kit.openModal({ title: 'Recibir pedido' });
        const t = kit.toast('Recepción parcial', 'warning', { persist: true });
        const stack = t.el.parentNode;
        assert.equal(stack.parentNode, m.el, 'stack en el top layer del modal');
        m.close();
        await m.closed;
        assert.equal(stack.parentNode, doc.page, 'vuelve a la raíz al cerrar');
        t.close();
    });
});

// -----------------------------------------------------------------
// postNotify
// -----------------------------------------------------------------
test('postNotify manda el Bearer de la sesión, respeta el base path y nunca lanza', async () => {
    const savedFetch = globalThis.fetch;
    const savedBase = globalThis.WEOTZI_BASE_PATH;
    const calls = [];
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) } };
    try {
        globalThis.WEOTZI_BASE_PATH = '/beta/';
        globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ success: true, sent: true, delivery_status: 'sent' }) }; };
        const res = await kit.postNotify('/api/supplies/notify', { kind: 'order_submitted', order_id: 'o1' }, client);
        assert.deepEqual(res, { ok: true, data: { success: true, sent: true, delivery_status: 'sent' }, status: 200, sent: true });
        assert.equal(calls[0].url, '/beta/api/supplies/notify');
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-123');
        assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(calls[0].init.body), { kind: 'order_submitted', order_id: 'o1' });

        delete globalThis.WEOTZI_BASE_PATH;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, sent: false }) });
        const noOwner = await kit.postNotify('/api/artist/studio-notify', { kind: 'membership_request_created', membership_id: 'm' }, client);
        assert.equal(noOwner.ok, true);
        assert.equal(noOwner.sent, false, 'estudio sin dueño: no se envía');

        globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => { throw new Error('no json'); } });
        assert.deepEqual(await kit.postNotify('/api/studio/notify', {}, client), { ok: false, data: null, status: 403, sent: false });

        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: false }) });
        assert.equal((await kit.postNotify('/api/studio/notify', {}, client)).ok, false);

        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        const offline = await kit.postNotify('/api/studio/notify', {}, client);
        assert.equal(offline.ok, false);
        assert.equal(kit.friendlyError(offline.error), 'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.');

        const seen = [];
        globalThis.fetch = async (url, init) => { seen.push(init.headers.Authorization); return { ok: true, status: 200, json: async () => ({ success: true }) }; };
        const broken = { auth: { getSession: async () => { throw new Error('sin sesión'); } } };
        assert.equal((await kit.postNotify('/api/studio/notify', {}, broken)).ok, true);
        assert.deepEqual(seen, [undefined], 'sin token igual se intenta (el servidor responde 401)');

        const circular = {}; circular.self = circular;
        assert.equal((await kit.postNotify('/api/studio/notify', circular, client)).ok, false);
        delete globalThis.fetch;
        assert.equal((await kit.postNotify('/api/studio/notify', {}, client)).ok, false);
    } finally {
        globalThis.fetch = savedFetch;
        if (savedBase === undefined) delete globalThis.WEOTZI_BASE_PATH; else globalThis.WEOTZI_BASE_PATH = savedBase;
    }
});

test('printDocument clona el documento fuera de los dialogs y limpia en afterprint', () => {
    const doc = fakeDocument();
    const listeners = {};
    const savedPrint = globalThis.print, savedAdd = globalThis.addEventListener;
    let printed = 0;
    globalThis.print = () => { printed++; };
    globalThis.addEventListener = (type, fn) => { listeners[type] = fn; };
    try {
        withDocument(doc, () => {
            assert.equal(kit.printDocument('<article class="sk-print-doc">C-2026-0001</article>', { title: 'Contrato C-2026-0001' }), true);
            const holder = doc.body.querySelector('.sk-print-root');
            assert.ok(holder);
            assert.equal(holder.parentNode, doc.body);
            assert.ok(doc.documentElement.classList.contains('sk-print-mode'));
            assert.equal(doc.title, 'Contrato C-2026-0001');
            assert.equal(printed, 1);
            listeners.afterprint();
            assert.equal(doc.body.querySelector('.sk-print-root'), null);
            assert.equal(doc.documentElement.classList.contains('sk-print-mode'), false);
            assert.equal(doc.title, 'Panel');
        });
    } finally {
        if (savedPrint === undefined) delete globalThis.print; else globalThis.print = savedPrint;
        if (savedAdd === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = savedAdd;
    }
});

// -----------------------------------------------------------------
// CSS del kit
// -----------------------------------------------------------------
test('la CSS del kit define todas las clases del contrato con prefijo sk-', () => {
    const required = [
        'sk-modal', 'sk-drawer', 'sk-toast-stack', 'sk-kpis', 'sk-kpi', 'sk-toolbar', 'sk-chips', 'sk-chip', 'sk-table', 'sk-empty',
        'sk-bars', 'sk-section', 'sk-subtabs', 'sk-grid-2', 'sk-field', 'sk-list-editor', 'sk-sidebar-group', 'sk-sidebar-group-title',
        'sk-tab-badge', 'sk-print-doc', 'sk-overlay'
    ];
    for (const cls of required) assert.match(css, new RegExp('\\.' + cls + '(?![\\w-])'), cls);
    for (const tone of ['neutral', 'info', 'success', 'warning', 'danger']) assert.match(css, new RegExp('\\.sk-badge--' + tone + '\\b'), tone);
    assert.match(css, /\.sk-chip\[aria-pressed="true"\]/);
    // Clases propias: todas sk-; las studio-* solo aparecen como contexto.
    const own = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map(m => m[1]).filter(c => !/^\d/.test(c));
    const foreign = [...new Set(own.filter(c => !c.startsWith('sk-') && !c.startsWith('studio-') && !['is-active', 'is-zero', 'is-negative', 'key'].includes(c)))];
    assert.deepEqual(foreign, []);
    // Fuera de @media print, cada selector queda acotado a markup del kit (sk-):
    // nunca redefine una regla suelta de studio.css.
    const screen = css.replace(/\/\*[\s\S]*?\*\//g, '').split('@media print')[0];
    const splitSelectors = sel => {
        const parts = []; let depth = 0, cur = '';
        for (const ch of sel) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
        }
        return parts.concat(cur).map(s => s.trim()).filter(Boolean);
    };
    // Única excepción: el arreglo del <main> flex del shell (styles.css lo centra).
    const shellFix = new Set(['.studio-dash-shell > .studio-dash-main', '.studio-dash-shell > .studio-dash-main > .studio-dash-panel']);
    for (const [, selector] of screen.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const part of splitSelectors(selector)) {
            if (/^(from|to|\d+%)$/.test(part) || shellFix.has(part)) continue; // keyframes / shell
            assert.match(part, /sk-/, 'selector sin sk-: ' + part);
        }
    }
});

test('CSS: radio 0, sombra dura solo en hover/focus, grupos de sidebar y print', () => {
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map(m => m[1].trim());
    assert.ok(radii.length > 0);
    assert.ok(radii.every(r => r === '0'), 'radios: ' + radii.join(','));
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, selector, body] of rules) {
        if (/box-shadow:\s*(?!none)/.test(body)) assert.match(selector, /:hover|:focus/, 'box-shadow fuera de hover/focus en ' + selector.trim());
    }
    const below900 = /@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    assert.ok(below900, 'breakpoint 900px');
    assert.match(below900[1], /\.sk-sidebar-group\s*\{\s*display:\s*contents;/);
    // En móvil las pestañas envuelven y cada grupo arranca en su fila con su título.
    assert.match(below900[1], /\.studio-dash-sidebar:has\(\.sk-sidebar-group\)\s*\{[^}]*flex-wrap:\s*wrap;/);
    assert.match(below900[1], /\.sk-sidebar-group-title\s*\{\s*display:\s*block;\s*flex-basis:\s*100%;/);
    assert.match(css, /\.sk-sidebar-group\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/);
    assert.match(css, /@media \(max-width: 600px\)/);
    const print = /@media print\s*\{([\s\S]*)\}\s*$/.exec(css);
    assert.ok(print, '@media print al final');
    assert.match(print[1], /\.sk-print-doc/);
    assert.match(print[1], /html\.sk-print-mode/);
});
