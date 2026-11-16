'use strict';
// Ronda 2 · frente "negociacion": controlador del navegador con un DOM mínimo
// (sin navegador real). Recorre el montaje en el expediente del artista y en
// el panel del cliente, las acciones y los contratos de eventos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '../public/shared/js/quotation-negotiation.js'), 'utf8');
const PID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };

const pending = () => ({
    id: PID, kind: 'counter', proposed_by: 'client', status: 'pending', currency: 'USD', note: 'Me alcanza hasta 1800',
    changes: { artist_budget_amount: { from: '2000', to: '1800' } }, created_at: '2026-11-16T09:00:00Z',
});
const baseState = (over = {}) => ({
    success: true, available: true, role: 'artist', quote_id: 'WO-7', quote_status: 'responded',
    names: { client: 'Lucía Fernández', artist: 'Mateo Rivas' },
    agreement: { approved: false, approved_at: null, version: 0 }, can: { counter: false, amend: false },
    currency: { counter: 'USD', amendment: 'USD' },
    current: {
        counter: { artist_budget_amount: '2000', tattoo_body_part: 'Antebrazo', tattoo_size: 'Mediano · 8 a 15 cm', tattoo_style: ['Realismo'], tattoo_color_type: 'Negro y gris', tattoo_idea_description: 'Un león realista mirando de frente.' },
        amendment: { final_budget_amount: '2000', final_sessions: '3', artist_deposit_pct: null, final_comment: '' },
    },
    limits: { paid: 0, sessions_used: 0 }, pending: pending(), proposals: [pending()], ...over,
});

function makeEl(attrs = {}, extra = {}) {
    const el = Object.assign({
        attrs: Object.assign({}, attrs), hidden: false, innerHTML: '', id: '', className: '', feedback: { textContent: '', classList: { toggle() {} } },
        reason: { value: '', focus() {} },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
        setAttribute(name, value) { this.attrs[name] = String(value); },
        removeAttribute(name) { delete this.attrs[name]; },
        querySelector(sel) {
            if (sel === '[data-wqn-feedback]') return this.innerHTML.includes('data-wqn-feedback') ? this.feedback : null;
            if (sel === '[data-wqn-reason]') return this.innerHTML.includes('data-wqn-reason') ? this.reason : null;
            return null;
        },
        querySelectorAll() { return []; },
        closest(sel) { return sel.includes('[data-wqn-mount]') && 'data-wqn-mount' in this.attrs ? this : null; },
        focus() {}, scrollIntoView() {},
    }, extra);
    return el;
}

function browser({ pathname, stateFor, onFetch }) {
    const listeners = {};
    const events = [];
    const calls = [];
    const timers = [];
    const navigations = [];
    const byId = {};
    const attached = new Set();
    const lists = { mounts: [], open: [], dialogs: [] };
    const document = {
        readyState: 'complete', head: { appendChild() {} }, body: {}, visibilityState: 'visible',
        addEventListener(type, fn, capture) { const key = type + (capture ? ':capture' : ''); (listeners[key] = listeners[key] || []).push(fn); },
        dispatchEvent(ev) { events.push(ev); (listeners[ev.type] || []).forEach((fn) => fn(ev)); return !ev.defaultPrevented; },
        querySelector() { return null; },
        querySelectorAll(sel) {
            if (sel === '[data-wqn-mount]') return lists.mounts;
            if (sel === '[data-wqn-open="counter"]') return lists.open;
            if (sel.startsWith('dialog[open]')) return lists.dialogs;
            return [];
        },
        getElementById(id) { return byId[id] || null; },
        createElement() { return makeEl(); },
        contains(el) { return attached.has(el); },
    };
    const window = {
        document, console: { log() {}, warn() {}, error() {} },
        location: { pathname, href: `https://beta.weotzi.com${pathname}`, assign(url) { navigations.push(url); } },
        _supabase: { auth: { async getSession() { return { data: { session: { access_token: 'tok' } } }; } } },
        MutationObserver: class { observe() {} },
        setTimeout(fn) { timers.push(fn); return timers.length; },
        addEventListener() {},
        CustomEvent: class {
            constructor(type, init) { this.type = type; this.detail = init && init.detail; this.defaultPrevented = false; }
            preventDefault() { this.defaultPrevented = true; }
        },
        fetch: async (url, opts) => {
            calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
            const custom = onFetch && onFetch(url, opts);
            if (custom) return custom;
            if (opts.method === 'GET') return { ok: true, status: 200, json: async () => stateFor() };
            return { ok: true, status: 200, json: async () => ({ success: true, proposal: { id: PID, status: 'accepted' }, quote_status: 'client_approved' }) };
        },
    };
    const start = () => vm.runInContext(SRC, vm.createContext({ self: window, window }));
    const fire = (type, target, extra = {}) => {
        const event = Object.assign({ target, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }, extra);
        (listeners[`${type}:capture`] || []).forEach((fn) => fn(event));
        if (!event.stopped) (listeners[type] || []).forEach((fn) => fn(event));
        return event;
    };
    // Botón dentro de un punto de montaje (data-wqn-act).
    const actButton = (mount, act) => ({
        getAttribute(name) { return name === 'data-wqn-act' ? act : null; },
        closest(sel) { return sel.includes('[data-wqn-act]') ? this : sel === '[data-wqn-mount]' ? mount : null; },
    });
    return { window, document, listeners, events, calls, timers, navigations, byId, attached, lists, start, fire, actButton };
}

test('artista: el expediente monta "El cliente propone cambios", acepta y recarga', async () => {
    let state = baseState();
    const b = browser({ pathname: '/my-quotations/detail', stateFor: () => state });
    let reloads = 0;
    b.window.WoQuotationDetailReload = async () => { reloads += 1; };
    const host = makeEl({}, {
        children: [], insertBefore(el) { b.attached.add(el); if (el.id) b.byId[el.id] = el; },
    });
    const anchor = makeEl();
    anchor.parentNode = host;
    anchor.nextSibling = null;
    b.byId['quotation-detail-root'] = host;
    b.byId['qd-slot-hold-slot'] = anchor;
    b.start();

    // Vista simulada, borrador o pendiente: no se monta nada.
    for (const detail of [{ quote: { quote_id: 'WO-7' }, stage: 'responded', readOnly: true }, { quote: { quote_id: 'WO-7' }, stage: 'pending' }, { quote: null, stage: 'responded' }]) {
        b.document.dispatchEvent({ type: 'wo:quotation-detail-rendered', detail });
    }
    assert.equal(b.byId['qd-negotiation-slot'], undefined);

    b.document.dispatchEvent({ type: 'wo:quotation-detail-rendered', detail: { quote: { quote_id: 'WO-7', quote_status: 'responded' }, stage: 'responded', readOnly: false } });
    const slot = b.byId['qd-negotiation-slot'];
    assert.ok(slot, 'inserta su propio slot');
    assert.deepEqual([slot.attrs['data-role'], slot.attrs['data-quote-id'], slot.attrs['data-status']], ['artist', 'WO-7', 'responded']);
    await settle();
    assert.equal(b.calls[0].url, '/api/negociacion/quotations/WO-7?as=artist');
    assert.match(slot.innerHTML, /El cliente propone cambios/);
    assert.match(slot.innerHTML, /data-wqn-act="requote">Hacer otra propuesta/);
    assert.equal(slot.hidden, false);

    // Aceptar pide confirmación antes de llamar al servidor.
    b.fire('click', b.actButton(slot, 'accept'));
    assert.match(slot.innerHTML, /data-wqn-act="confirm-accept"/);
    assert.equal(b.calls.length, 1);
    b.fire('click', b.actButton(slot, 'cancel-confirm'));
    assert.doesNotMatch(slot.innerHTML, /confirm-accept/);

    b.fire('click', b.actButton(slot, 'accept'));
    state = baseState({ quote_status: 'client_approved', agreement: { approved: true, approved_at: '2026-11-16T12:00:00Z', version: 1 }, can: { counter: false, amend: true }, pending: null, proposals: [{ ...pending(), status: 'accepted' }] });
    b.fire('click', b.actButton(slot, 'confirm-accept'));
    await settle();
    const post = b.calls.find((c) => c.method === 'POST');
    assert.equal(post.url, `/api/negociacion/quotations/WO-7/proposals/${PID}/accept`);
    assert.deepEqual(post.body, { as: 'artist', note: '' });
    const changed = b.events.find((e) => e.type === 'wo:negotiation-changed');
    assert.deepEqual([changed.detail.quoteId, changed.detail.role, changed.detail.action, changed.detail.quote_status], ['WO-7', 'artist', 'accept', 'client_approved']);
    assert.equal(reloads, 1, 'el expediente relee la cotización');

    // El expediente se repinta: el slot nuevo muestra el aviso y el acuerdo aprobado.
    delete b.byId['qd-negotiation-slot'];
    b.attached.clear();
    b.document.dispatchEvent({ type: 'wo:quotation-detail-rendered', detail: { quote: { quote_id: 'WO-7', quote_status: 'client_approved' }, stage: 'approved', readOnly: false } });
    const next = b.byId['qd-negotiation-slot'];
    assert.match(next.innerHTML, /Aceptaste los cambios: la cotización quedó aprobada por ambas partes\./);
    assert.match(next.innerHTML, /Acuerdo aprobado por ambas partes/);
    assert.match(next.innerHTML, /data-wqn-act="open-amend"/);
});

test('artista: "Hacer otra propuesta" emite wo:quote-respond y, si nadie escucha, abre el expediente', async () => {
    const b = browser({ pathname: '/my-quotations/detail', stateFor: () => baseState() });
    const host = makeEl({}, { children: [], insertBefore(el) { b.attached.add(el); if (el.id) b.byId[el.id] = el; } });
    b.byId['quotation-detail-root'] = host;
    b.start();
    b.document.dispatchEvent({ type: 'wo:quotation-detail-rendered', detail: { quote: { quote_id: 'WO-7', quote_status: 'responded' }, stage: 'responded' } });
    const slot = b.byId['qd-negotiation-slot'];
    await settle();

    b.fire('click', b.actButton(slot, 'requote'));
    const ev = b.events.find((e) => e.type === 'wo:quote-respond');
    assert.equal(ev.detail.quoteId, 'WO-7');
    assert.deepEqual([ev.detail.prefill.source, ev.detail.prefill.amount, ev.detail.prefill.currency, ev.detail.prefill.proposalId], ['client_counter', '1800', 'USD', PID]);
    assert.equal(JSON.stringify(ev.detail.prefill.changes), '{"artist_budget_amount":"1800"}');
    b.timers.splice(0).forEach((fn) => fn());
    assert.deepEqual(b.navigations, ['/my-quotations/detail?id=WO-7&modal=responder']);

    // Con un diálogo que lo atiende (marca handled, cancela el evento o abre un diálogo) no se navega.
    for (const how of ['handled', 'prevent', 'dialog']) {
        b.navigations.length = 0;
        b.lists.dialogs = [];
        const handler = (e) => {
            if (how === 'handled') e.detail.handled = true;
            if (how === 'prevent') e.preventDefault();
            if (how === 'dialog') b.lists.dialogs = [{}];
        };
        b.listeners['wo:quote-respond'] = [handler];
        b.fire('click', b.actButton(slot, 'requote'));
        b.timers.splice(0).forEach((fn) => fn());
        assert.deepEqual(b.navigations, [], how);
    }
});

test('artista: "edita el acuerdo" abre el cambio propuesto en vez de la edición directa', async () => {
    const approved = baseState({ quote_status: 'client_approved', agreement: { approved: true, approved_at: null, version: 1 }, can: { counter: false, amend: true }, pending: null, proposals: [] });
    const b = browser({ pathname: '/my-quotations/detail', stateFor: () => approved });
    const host = makeEl({}, { children: [], insertBefore(el) { b.attached.add(el); if (el.id) b.byId[el.id] = el; } });
    b.byId['quotation-detail-root'] = host;
    b.start();
    const edit = { closest(sel) { return sel === '[data-action="edit-agreement"]' ? this : null; }, getAttribute() { return null; } };
    // Sin panel montado, el clic sigue su camino original.
    assert.equal(b.fire('click', edit).stopped, undefined);
    b.document.dispatchEvent({ type: 'wo:quotation-detail-rendered', detail: { quote: { quote_id: 'WO-7', quote_status: 'client_approved' }, stage: 'approved' } });
    await settle();
    const slot = b.byId['qd-negotiation-slot'];
    const event = b.fire('click', edit);
    assert.equal(event.stopped, true);
    assert.equal(event.prevented, true);
    assert.match(slot.innerHTML, /data-wqn-form="amendment"/);
    assert.match(slot.innerHTML, /Proponer un cambio al acuerdo/);
    b.fire('click', b.actButton(slot, 'cancel-form'));
    assert.doesNotMatch(slot.innerHTML, /data-wqn-form/);
});

test('cliente: Modificar aparece cuando el servidor lo habilita, valida y envía solo lo que cambia', async () => {
    let state = baseState({ role: 'client', can: { counter: true, amend: false }, pending: null, proposals: [] });
    const b = browser({ pathname: '/client/dashboard', stateFor: () => state });
    const hostCalls = [];
    b.window.loadQuotations = async () => { hostCalls.push('load'); };
    b.window.refreshOpenDetail = (id) => { hostCalls.push(`refresh:${id}`); };
    const decision = { hidden: false };
    const scope = { querySelector(sel) { return sel === '.cqp-decision' ? decision : null; } };
    const mount = makeEl({ 'data-wqn-mount': '', 'data-quote-id': 'WO-7', 'data-role': 'client', 'data-status': 'responded' }, {
        hidden: true,
        closest(sel) { return sel === '.cqp' ? scope : sel.includes('[data-wqn-mount]') ? this : null; },
    });
    const modify = makeEl({ 'data-wqn-open': 'counter', 'data-quote-id': 'WO-7', 'data-role': 'client' }, {
        hidden: true,
        closest(sel) { return sel.includes('[data-wqn-open]') ? this : null; },
    });
    b.lists.mounts = [mount];
    b.lists.open = [modify];
    b.attached.add(mount);
    b.start();
    await settle();
    assert.equal(b.calls[0].url, '/api/negociacion/quotations/WO-7?as=client');
    assert.equal(modify.hidden, false, 'Modificar se habilita');
    assert.equal(mount.hidden, true, 'sin nada pendiente, el panel no ocupa lugar');

    b.fire('click', modify);
    assert.match(mount.innerHTML, /data-wqn-form="counter"/);
    assert.deepEqual([mount.hidden, decision.hidden, modify.hidden], [false, true, true]);

    const form = (values) => ({
        getAttribute(name) { return name === 'data-wqn-form' ? 'counter' : null; },
        closest(sel) { return sel === 'form[data-wqn-form]' ? this : sel === '[data-wqn-mount]' ? mount : null; },
        elements: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, focus() {} }])),
    });
    const same = { artist_budget_amount: '2000', tattoo_body_part: 'Antebrazo', tattoo_size: 'Mediano · 8 a 15 cm', tattoo_style: 'Realismo', tattoo_color_type: 'Negro y gris', tattoo_idea_description: 'Un león realista mirando de frente.', note: '' };

    // Sin cambios o con un dato inválido no se llama al servidor.
    b.fire('submit', form(same));
    await settle();
    assert.match(mount.feedback.textContent, /Cambia al menos un dato/);
    b.fire('submit', form({ ...same, artist_budget_amount: '0' }));
    await settle();
    assert.match(mount.feedback.textContent, /mayor a cero/);
    assert.equal(b.calls.filter((c) => c.method === 'POST').length, 0);

    state = baseState({ role: 'client', can: { counter: true, amend: false } });
    const submitted = b.fire('submit', form({ ...same, artist_budget_amount: '1.800', tattoo_size: 'Grande · 15 a 30 cm', note: '  Me alcanza hasta 1800 ' }));
    assert.equal(submitted.prevented, true);
    await settle();
    const post = b.calls.find((c) => c.method === 'POST');
    assert.equal(post.url, '/api/negociacion/quotations/WO-7/proposals');
    assert.deepEqual(post.body, { as: 'client', kind: 'counter', changes: { artist_budget_amount: '1800', tattoo_size: 'Grande · 15 a 30 cm' }, note: 'Me alcanza hasta 1800' });
    assert.deepEqual(hostCalls, ['load', 'refresh:WO-7']);
    assert.match(mount.innerHTML, /Listo: enviamos tus cambios al artista/);
    assert.match(mount.innerHTML, /Esperando la respuesta del artista/);
    assert.match(mount.innerHTML, /data-wqn-act="withdraw"/);
    assert.equal(decision.hidden, false, 'vuelven Aceptar / Rechazar');
});

test('si el estado cambió del otro lado (409), se muestra el real con el motivo', async () => {
    let state = baseState();
    const b = browser({
        pathname: '/my-quotations/detail', stateFor: () => state,
        onFetch: (url, opts) => (opts.method === 'POST'
            ? { ok: false, status: 409, json: async () => ({ success: false, code: 'not_pending', error: 'Esta propuesta ya no está pendiente. Actualiza la página.' }) }
            : null),
    });
    const host = makeEl({}, { children: [], insertBefore(el) { b.attached.add(el); if (el.id) b.byId[el.id] = el; } });
    b.byId['quotation-detail-root'] = host;
    b.start();
    b.document.dispatchEvent({ type: 'wo:quotation-detail-rendered', detail: { quote: { quote_id: 'WO-7', quote_status: 'responded' }, stage: 'responded' } });
    await settle();
    const slot = b.byId['qd-negotiation-slot'];
    b.fire('click', b.actButton(slot, 'reject'));
    assert.match(slot.innerHTML, /Mantener mi propuesta/);
    slot.reason.value = 'Prefiero mi propuesta';
    state = baseState({ pending: null, proposals: [{ ...pending(), status: 'withdrawn' }] });
    b.fire('click', b.actButton(slot, 'confirm-reject'));
    await settle();
    const post = b.calls.find((c) => c.method === 'POST');
    assert.deepEqual(post.body, { as: 'artist', note: 'Prefiero mi propuesta' });
    assert.match(slot.innerHTML, /class="wqn-flash wqn-flash--warn" role="alert"[^>]*>Esta propuesta ya no está pendiente/);
    assert.doesNotMatch(slot.innerHTML, /data-wqn-act="accept"/);
    assert.match(slot.innerHTML, /Historial de cambios \(1\)/);
    assert.equal(b.events.some((e) => e.type === 'wo:negotiation-changed'), false);
});

test('artista: en una cotización rechazada el redactor del chat queda desactivado y explicado', async () => {
    const b = browser({ pathname: '/my-quotations/detail', stateFor: () => baseState({ quote_status: 'client_rejected', pending: null, proposals: [] }) });
    const host = makeEl({}, { children: [], insertBefore(el) { b.attached.add(el); if (el.id) b.byId[el.id] = el; } });
    const controls = [{ disabled: false }, { disabled: false }];
    const inserted = [];
    const compose = makeEl({}, { querySelectorAll() { return controls; }, parentNode: { insertBefore(el, ref) { inserted.push([el, ref]); } } });
    b.byId['quotation-detail-root'] = host;
    b.byId['qd-compose'] = compose;
    b.start();
    const rejected = { type: 'wo:quotation-detail-rendered', detail: { quote: { quote_id: 'WO-7', quote_status: 'client_rejected' }, stage: 'rejected' } };
    b.document.dispatchEvent(rejected);
    assert.deepEqual(controls.map((c) => c.disabled), [true, true]);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0][1], compose);
    assert.match(inserted[0][0].textContent, /quedó finalizada y ya no puedes enviarle mensajes/);
    // No se repite si el mismo redactor sigue en pantalla.
    b.document.dispatchEvent(rejected);
    assert.equal(inserted.length, 1);
    await settle();

    // En cualquier otro estado el redactor no se toca.
    const open = browser({ pathname: '/my-quotations/detail', stateFor: () => baseState() });
    const other = [{ disabled: false }];
    open.byId['quotation-detail-root'] = makeEl({}, { children: [], insertBefore(el) { open.attached.add(el); if (el.id) open.byId[el.id] = el; } });
    open.byId['qd-compose'] = makeEl({}, { querySelectorAll() { return other; }, parentNode: { insertBefore() { throw new Error('no debería'); } } });
    open.start();
    open.document.dispatchEvent({ type: 'wo:quotation-detail-rendered', detail: { quote: { quote_id: 'WO-7', quote_status: 'responded' }, stage: 'responded' } });
    assert.equal(other[0].disabled, false);
    await settle();
});

test('sin sesión, en demo o sin migración el panel no aparece ni rompe la página', async () => {
    const demo = browser({ pathname: '/client/dashboard', stateFor: () => baseState() });
    demo.window.WoDemo = { enabled: true };
    const m1 = makeEl({ 'data-wqn-mount': '', 'data-quote-id': 'WO-7', 'data-role': 'client' });
    demo.lists.mounts = [m1];
    demo.attached.add(m1);
    demo.start();
    await settle();
    assert.deepEqual([demo.calls.length, m1.hidden], [0, true]);

    const off = browser({ pathname: '/client/dashboard', stateFor: () => ({ success: true, available: false }) });
    const m2 = makeEl({ 'data-wqn-mount': '', 'data-quote-id': 'WO-7', 'data-role': 'client' });
    const modify = makeEl({ 'data-wqn-open': 'counter', 'data-quote-id': 'WO-7' }, { hidden: true });
    off.lists.mounts = [m2];
    off.lists.open = [modify];
    off.attached.add(m2);
    off.start();
    await settle();
    assert.deepEqual([m2.hidden, m2.innerHTML, modify.hidden], [true, '', true]);

    const anon = browser({ pathname: '/client/dashboard', stateFor: () => baseState() });
    anon.window._supabase = { auth: { async getSession() { return { data: { session: null } }; } } };
    const m3 = makeEl({ 'data-wqn-mount': '', 'data-quote-id': 'WO-7', 'data-role': 'client' });
    anon.lists.mounts = [m3];
    anon.attached.add(m3);
    anon.start();
    await settle();
    assert.deepEqual([anon.calls.length, m3.hidden], [0, true]);
});

// ---------------------------------------------------------------- REQ-13 · expediente del artista
test('REQ-13: el expediente no abre "Confirmar acuerdo" con una contrapropuesta del cliente pendiente', async () => {
    const detail = fs.readFileSync(path.resolve(__dirname, '../public/shared/js/quotation-detail-figma.js'), 'utf8').replace(/\r\n/g, '\n');
    const fn = /    async function clientCounterPending\(q\) \{\n[\s\S]*?\n    \}\n/.exec(detail);
    assert.ok(fn, 'la comprobación está en el controlador del expediente');
    const make = (repo, extra) => {
        const ctx = Object.assign({ scenario: null, preview: false }, extra);
        const calls = [];
        const D = () => ({ Negotiation: repo ? { state: async (id, role) => { calls.push([id, role]); return repo(); } } : undefined });
        // eslint-disable-next-line no-new-func
        const check = new Function('D', 'state', 'isPreviewEnv', `${fn[0]}; return clientCounterPending;`)(D, { scenario: ctx.scenario }, () => ctx.preview);
        return { check, calls };
    };
    const responded = { id: 7, quote_id: 'WO-7', quote_status: 'responded' };

    // Contrapropuesta pendiente: bloquea. Pregunta por el quote_id y como artista.
    const blocked = make(() => ({ success: true, pending: pending() }));
    assert.equal(await blocked.check(responded), true);
    assert.deepEqual(blocked.calls, [['WO-7', 'artist']]);
    // Sin pendiente, con una enmienda pendiente o con la contrapropuesta ya resuelta: no bloquea.
    assert.equal(await make(() => ({ success: true, pending: null })).check(responded), false);
    assert.equal(await make(() => ({ success: true, pending: { ...pending(), kind: 'amendment' } })).check(responded), false);
    assert.equal(await make(() => ({ success: true, pending: { ...pending(), status: 'rejected' } })).check(responded), false);
    // Migración sin aplicar, error de red, sin el módulo, vista simulada o vista previa: decide la base.
    assert.equal(await make(() => ({ success: true, available: false, pending: pending() })).check(responded), false);
    assert.equal(await make(() => { throw new Error('red'); }).check(responded), false);
    assert.equal(await make(null).check(responded), false);
    assert.equal(await make(() => ({ pending: pending() }), { scenario: 'demo' }).check(responded), false);
    assert.equal(await make(() => ({ pending: pending() }), { preview: true }).check(responded), false);
    // Solo se pregunta en "respondida" (una contrapropuesta no vive en otro estado).
    const other = make(() => ({ pending: pending() }));
    assert.equal(await other.check({ id: 7, quote_id: 'WO-7', quote_status: 'pending' }), false);
    assert.equal(other.calls.length, 0);

    // Se mira antes de abrir y, otra vez, antes de reservar el turno y de guardar.
    assert.match(detail, /if \(edit \|\| !q \|\| q\.quote_status !== 'responded'\) \{ showAgreementDialog\(edit\); return; \}\n\s+clientCounterPending\(q\)\.then\(\(blocked\) => \{[\s\S]*?showToast\(COUNTER_PENDING_MESSAGE, \{ error: true \}\);[\s\S]*?showAgreementDialog\(false\);/);
    const submit = detail.slice(detail.indexOf('function showAgreementDialog(edit)'), detail.indexOf('function syncAgreementExtras()'));
    const recheck = submit.indexOf('if (!edit && await clientCounterPending(q)) throw userError(COUNTER_PENDING_MESSAGE);');
    assert.ok(recheck > 0, 'se vuelve a comprobar al confirmar');
    assert.ok(recheck < submit.indexOf('window.WoSlotHold.confirmFor('), 'antes de reservar el turno');
    assert.ok(recheck < submit.indexOf('await updateQuote(patch);'), 'antes de guardar el acuerdo');
});
