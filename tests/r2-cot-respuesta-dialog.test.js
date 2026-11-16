'use strict';

// Ronda 2 · frente cot-respuesta: el diálogo de la propuesta
// (quote-respond-dialog.js) y la franja Estado · Prioridad
// (quote-status-priority.js) ejecutados de punta a punta sobre un DOM mínimo:
// sin navegador, con el modelo real y un repositorio falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const source = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const M = require('../public/shared/js/quote-respond-model.js');
const B = require('../public/shared/js/booking-slots-model.js');
const VM = require('../public/shared/js/quotations-view-model.js');

const TZ = 'America/Argentina/Buenos_Aires';
const NOW = Date.parse('2026-11-16T15:00:00Z'); // lunes 16 nov 2026, 12:00 en Buenos Aires
const WEEKLY = B.DAY_KEYS.map((day, i) => ({ day, enabled: i < 5, start: '10:00', end: '18:00' }));
const BLOCKING = [
    { starts_at: '2026-11-18T13:00:00Z', ends_at: '2026-11-18T21:00:00Z', kind: 'session' }, // mié 18: ocupado
    { starts_at: '2026-11-19T16:00:00Z', ends_at: '2026-11-19T19:00:00Z', kind: 'event' }, // jue 19: 13–16
];
const XSS = '<img src=x onerror=alert(1)>';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
// Lo que crea el script dentro del contexto vm tiene otros prototipos: se compara por valor.
const plain = (value) => JSON.parse(JSON.stringify(value));

// --------------------------------------------------------------- DOM mínimo
function makeEnv(options = {}) {
    class El {
        constructor(tag) {
            this.tagName = String(tag || 'div').toUpperCase();
            this.attrs = {};
            this.listeners = {};
            this.children = [];
            this.nodes = {};
            this.html = '';
            this.textContent = '';
            this.value = '';
            this.hidden = false;
            this.disabled = false;
            this.checked = false;
            this.readOnly = false;
            this.tabIndex = 0;
            this.removed = false;
            this.selectionStart = 0;
            this.selectionEnd = 0;
            const classes = new Set();
            this.classes = classes;
            this.classList = {
                add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
                toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
            };
        }
        set innerHTML(value) { this.html = String(value); }
        get innerHTML() { return this.html; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
        hasAttribute(k) { return k in this.attrs; }
        removeAttribute(k) { delete this.attrs[k]; }
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
        focus() { document.activeElement = this; }
        select() {}
        click() {}
        setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
        remove() { this.removed = true; }
        contains() { return true; }
        closest() { return null; }
        appendChild(child) { this.children.push(child); return child; }
        insertAdjacentElement(_where, child) { this.children.push(child); return child; }
        // Un nodo por selector (memorizado): alcanza para leer lo que el código pintó.
        querySelector(selector) {
            if ((options.missing || ['reserve_slot']).some((part) => selector.includes(part))) return null;
            if (!this.nodes[selector]) this.nodes[selector] = new El(selector === 'form' ? 'form' : 'div');
            return this.nodes[selector];
        }
        querySelectorAll() { return []; }
    }

    const docListeners = {};
    const dispatched = [];
    const body = new El('body');
    const opener = new El('button');
    const byId = Object.assign({}, options.byId || {});
    const document = {
        body,
        activeElement: opener,
        documentElement: new El('html'),
        createElement: (tag) => new El(tag),
        getElementById: (id) => byId[id] || null,
        addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
        removeEventListener: (type, fn) => { docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn); },
        dispatchEvent: (event) => { dispatched.push(event); (docListeners[event.type] || []).forEach((fn) => fn(event)); return true; },
        contains: () => true,
    };

    const calls = { availability: [], saves: [], savedTemplates: [], deletedTemplates: [], context: 0 };
    const repo = {
        isMissingSchema: () => false,
        context: async () => {
            calls.context += 1;
            return options.context || { success: true, editable: true, timezone: TZ, has_schedule: true, extras: M.extrasFromManual(null), quotation: { offered_slots: [] } };
        },
        availability: async (quoteId, range) => {
            calls.availability.push(Object.assign({ quoteId }, range));
            const agenda = M.computeAgenda({
                tz: TZ, from: range.from, to: range.to, now: NOW, minutes: range.minutes, settings: {},
                availability: { weekly: WEEKLY }, locations: [], busy: M.confirmedBusy(BLOCKING, []),
            });
            return Object.assign({ success: true, from: range.from, to: range.to, today: '2026-11-16' }, M.publicAgenda(agenda));
        },
        save: async (quoteId, payload) => {
            calls.saves.push({ quoteId, payload });
            if (options.saveError) throw options.saveError;
            return options.saveResult || { success: true, first_response: true, updated: false, extras_saved: true };
        },
        listTemplates: async () => ({ available: true, rows: options.templates || [{ id: 'tpl-1', title: `Mía ${XSS}`, body: 'Hola {{cliente}}, te ofrezco {{fechas}}.' }] }),
        saveTemplate: async (userId, template) => { calls.savedTemplates.push({ userId, template }); return Object.assign({ id: 'tpl-2' }, template); },
        deleteTemplate: async (id) => { calls.deletedTemplates.push(id); },
        syncAgreement: async () => ({ success: true }),
    };

    class FixedDate extends Date {
        constructor(...args) { if (args.length) super(...args); else super(NOW); }
        static now() { return NOW; }
    }
    class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init && init.detail) || null; } }

    const window = {
        WoQuoteRespondModel: options.noModel ? undefined : M,
        WoBookingSlots: B,
        WoQuotationsViewModel: VM,
        WeotziData: { QuoteRespond: repo },
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
    };
    Object.assign(window, options.window || {});
    const context = vm.createContext({ window, document, console: { log() {}, warn() {}, error() {} }, Date: FixedDate, CustomEvent, setImmediate });
    return { El, window, document, body, opener, calls, repo, docListeners, dispatched, context };
}

function loadDialog(env) {
    vm.runInContext(source('public/shared/js/quote-respond-dialog.js'), env.context, { filename: 'quote-respond-dialog.js' });
    return env.window.WoQuoteRespond;
}

function quoteRow(extra = {}) {
    return Object.assign({
        id: 77, quote_id: 'QT-0077', quote_status: 'pending', client_full_name: `Lucía ${XSS}`, client_user_id: 'c-1',
        artist_name: 'Mateo Rivas', client_budget_currency: 'ARS', tattoo_estimated_sessions: '2', artist_session_minutes: 180,
    }, extra);
}

function makeCtx(extra = {}) {
    const log = { toasts: [], chats: [], notified: [], reloads: 0, flushed: 0 };
    const ctx = Object.assign({
        quote: quoteRow(), user: { id: 'artist-1' }, prefill: null, budgetDraft: '410.000',
        toast: (message, opts) => log.toasts.push({ message, error: !!(opts && opts.error) }),
        reload: async () => { log.reloads += 1; },
        flushNotes: async () => { log.flushed += 1; },
        sendChat: async (message) => { log.chats.push(message); },
        notifyResponded: (payload) => log.notified.push(payload),
    }, extra);
    return { ctx, log };
}

// Controladores del diálogo abierto.
function driver(env) {
    const overlay = env.body.children[env.body.children.length - 1];
    const form = overlay.querySelector('form');
    const q = (selector) => overlay.querySelector(selector);
    const button = (attrs) => {
        const el = new env.El('button');
        Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
        return el;
    };
    return {
        overlay, form, q,
        shell: () => overlay.html,
        click: (attrs) => overlay.listeners.click[0]({ target: { closest: (sel) => (sel === 'button' ? button(attrs) : null) } }),
        input: (name, value, extra) => form.listeners.input[0]({ target: Object.assign({ name, value, removeAttribute() {}, closest: () => null }, extra || {}) }),
        submit: () => form.listeners.submit[0]({ preventDefault() {} }),
        key: (key, target) => env.docListeners.keydown[0]({ key, target: target || null, preventDefault() {}, shiftKey: false }),
    };
}

// ------------------------------------------------------------------ apertura
test('sin el modelo o el repositorio el diálogo no se hace cargo (queda el diálogo anterior)', () => {
    const env = makeEnv({ noModel: true });
    const dialog = loadDialog(env);
    assert.equal(dialog.open(makeCtx().ctx), false);
    assert.equal(env.body.children.length, 0);
    const noRepo = makeEnv({ window: { WeotziData: {} } });
    assert.equal(loadDialog(noRepo).open(makeCtx().ctx), false);
    // Modo demo: las cotizaciones de ejemplo no existen en el servidor.
    const demo = makeEnv({ window: { WoDemo: { enabled: true } } });
    assert.equal(loadDialog(demo).open(makeCtx().ctx), false);
    assert.equal(demo.body.children.length, 0);
    assert.equal(demo.calls.context, 0);
});

test('P25: en una cotización aprobada por ambas partes no se abre y explica por qué', () => {
    const env = makeEnv();
    const dialog = loadDialog(env);
    const { ctx, log } = makeCtx({ quote: quoteRow({ quote_status: 'client_approved' }) });
    assert.equal(dialog.open(ctx), true, 'se hace cargo: no cae al diálogo anterior');
    assert.equal(env.body.children.length, 0);
    assert.equal(dialog.isOpen(), false);
    assert.equal(log.toasts.length, 1);
    assert.match(log.toasts[0].message, /aprobada por ambas partes/);
    assert.equal(log.toasts[0].error, true);
});

test('P4: el diálogo abre ancho, con cuatro pestañas y los datos de usuario escapados', async () => {
    const env = makeEnv();
    const dialog = loadDialog(env);
    assert.equal(dialog.open(makeCtx().ctx), true);
    const d = driver(env);
    const shell = d.shell();
    assert.match(shell, /<h2 class="qr-title" id="qr-title">Aceptar y enviar presupuesto<\/h2>/);
    assert.match(shell, /id="qr-submit">Enviar propuesta<\/button>/);
    assert.equal((shell.match(/role="tab" /g) || []).length, 4);
    assert.equal((shell.match(/role="tabpanel"/g) || []).length, 4);
    assert.ok(!shell.includes(XSS), 'el nombre del cliente no entra crudo');
    assert.ok(shell.includes('Lucía &lt;img src=x onerror=alert(1)&gt;'));
    assert.match(shell, /name="amount" inputmode="decimal" autocomplete="off" value="410\.000"/, 'toma el presupuesto que ya escribió en el expediente');
    assert.match(shell, /name="sessions" type="number"[^>]*value="2"/);
    assert.match(shell, /name="hours" type="number"[^>]*value="3"/);
    for (const label of ['Presupuesto', 'Moneda', 'Sesiones', 'Anticipo (%)', 'Complejidad', 'Estudio o ubicación', 'Vencimiento de la propuesta',
        'Desglose económico (opcional)', 'Política de reserva y cancelación', 'Notas para el cliente', 'Términos adicionales',
        'Respuestas rápidas', 'Mensaje para el cliente (opcional)', 'Fechas ofrecidas']) {
        assert.ok(shell.includes(label), label);
    }
    for (const key of ['cliente', 'presupuesto', 'moneda', 'sesiones', 'duracion', 'anticipo', 'fechas', 'estudio', 'artista']) {
        assert.ok(shell.includes(`data-qr-var="${key}"`), `chip de ${key}`);
    }
    // El chip muestra la variable canónica: la anterior ya no se ofrece.
    assert.ok(shell.includes('data-qr-var="anticipo" title="Anticipo para reservar">{{anticipo}}</button>'), 'chip {{anticipo}} con su ayuda');
    assert.equal((shell.match(/data-qr-var="/g) || []).length, 9, 'un chip por variable, sin alias');
    assert.ok(!shell.includes('data-qr-var="seña"') && !shell.includes('{{seña}}'), 'sin chip {{seña}}');
    assert.equal(d.q('#qr-panel-propuesta').hidden, false);
    assert.equal(d.q('#qr-panel-disponibilidad').hidden, true);
    assert.equal(d.q('#qr-tab-propuesta').getAttribute('aria-selected'), 'true');
    assert.equal(env.document.documentElement.classes.has('qr-open'), true);
    assert.match(d.q('#qr-money').html, /Total propuesto<\/span><strong>410\.000 ARS<\/strong>/);
    assert.match(d.q('#qr-money').html, /El saldo acordado se activa cuando el cliente aprueba la propuesta, no antes\./);
    assert.equal(d.q('#qr-summary').textContent, 'Total 410.000 ARS · Sin anticipo · 2 sesiones de 3 h · Sin fechas ofrecidas');

    await flush();
    assert.equal(env.calls.context, 1);
    const templates = d.q('#qr-templates').html;
    assert.equal((templates.match(/data-qr-template="/g) || []).length, M.DEFAULT_TEMPLATES.length + 1, 'sugeridas + la guardada');
    assert.ok(!templates.includes(XSS), 'el título de la plantilla guardada se escapa');
    assert.match(templates, /data-qr-template-delete="tpl-1"/, 'solo las propias se pueden eliminar');
    assert.doesNotMatch(templates, /data-qr-template-delete="default-/);
    assert.equal(env.calls.availability.length, 0, 'la agenda se pide recién al entrar a Disponibilidad');
});

// ------------------------------------------------------------ disponibilidad
test('P4: calendario conectado a la agenda — turnos, rangos y días ocupados', async () => {
    const env = makeEnv();
    const dialog = loadDialog(env);
    dialog.open(makeCtx().ctx);
    const d = driver(env);
    await flush();
    d.click({ 'data-qr-tab': 'disponibilidad' });
    await flush();
    assert.deepEqual(env.calls.availability, [{ quoteId: 'QT-0077', from: '2026-11-16', to: '2026-11-30', minutes: 180 }]);
    assert.equal(d.q('#qr-cal-title').textContent, 'noviembre 2026');
    const grid = d.q('#qr-cal').html;
    assert.match(grid, /class="qr-cal-day is-past" data-qr-date="2026-11-15"[^>]*disabled/);
    assert.match(grid, /class="qr-cal-day is-free is-today" data-qr-date="2026-11-16"/);
    assert.match(grid, /class="qr-cal-day is-busy" data-qr-date="2026-11-18" aria-label="miércoles 18 de noviembre de 2026, ocupado"/);
    assert.match(grid, /class="qr-cal-day is-partial" data-qr-date="2026-11-19"/);
    assert.match(grid, /class="qr-cal-day is-closed" data-qr-date="2026-11-21"/);
    assert.match(grid, /data-qr-date="2026-11-17" aria-label="martes 17 de noviembre de 2026, libre, 6 turnos sugeridos"/);
    assert.equal(d.q('[data-qr-cal="prev"]').disabled, true, 'no se navega al pasado');
    assert.match(d.q('#qr-cal-note').html, /Horarios en tu zona horaria \(America\/Argentina\/Buenos Aires\)\./);

    // Turnos con horario: elegir un día libre y ofrecer dos turnos.
    d.click({ 'data-qr-date': '2026-11-17' });
    const day = d.q('#qr-day').html;
    assert.match(day, /mar 17 nov 2026 · horario 10:00–18:00/);
    assert.equal((day.match(/data-qr-slot="/g) || []).length, 6);
    d.click({ 'data-qr-slot': '2026-11-17T13:00:00.000Z', 'data-qr-slot-end': '2026-11-17T16:00:00.000Z' });
    d.click({ 'data-qr-slot': '2026-11-17T17:00:00.000Z', 'data-qr-slot-end': '2026-11-17T20:00:00.000Z' });
    assert.match(d.q('#qr-day').html, /class="qr-chip qr-chip--slot is-on" aria-pressed="true" data-qr-slot="2026-11-17T13:00:00\.000Z"/);
    assert.equal(d.q('#qr-offers-count').textContent, '2/12');
    assert.match(d.q('#qr-offers').html, /mar 17 nov 2026 · 10:00–13:00/);
    assert.match(d.q('#qr-summary').textContent, /2 fechas ofrecidas$/);
    assert.match(d.q('#qr-cal').html, /class="qr-cal-day is-free has-offer is-selected" data-qr-date="2026-11-17"[^>]*ya ofrecido/);
    // Volver a tocar el turno lo quita.
    d.click({ 'data-qr-slot': '2026-11-17T17:00:00.000Z', 'data-qr-slot-end': '2026-11-17T20:00:00.000Z' });
    assert.equal(d.q('#qr-offers-count').textContent, '1/12');

    // Día ocupado: se ve lo confirmado y un horario a mano que choca no entra.
    d.click({ 'data-qr-date': '2026-11-19' });
    assert.match(d.q('#qr-day').html, /Evento del calendario · 13:00–16:00/);
    d.q('[name="custom_start"]').value = '14:00';
    d.q('[name="custom_end"]').value = '17:00';
    d.click({ 'data-qr-add-custom': '' });
    assert.match(d.q('#qr-day').html, /Ese horario se superpone con algo confirmado: Evento del calendario · 13:00–16:00\./);
    assert.equal(d.q('#qr-offers-count').textContent, '1/12');
    d.q('[name="custom_start"]').value = '10:00';
    d.q('[name="custom_end"]').value = '12:30';
    d.click({ 'data-qr-add-custom': '' });
    assert.equal(d.q('#qr-offers-count').textContent, '2/12');
    assert.match(d.q('#qr-offers').html, /jue 19 nov 2026 · 10:00–12:30/);

    // Rango de fechas: los días ocupados quedan fuera y el rango se parte.
    d.click({ 'data-qr-mode': 'range' });
    assert.match(d.q('#qr-cal').html, /data-qr-date="2026-11-18"[^>]*disabled/, 'un día ocupado no puede empezar un rango');
    d.click({ 'data-qr-date': '2026-11-17' });
    assert.match(d.q('#qr-day').html, /Desde mar 17 nov 2026\. Ahora elige el último día del rango\./);
    d.click({ 'data-qr-date': '2026-11-20' });
    await flush();
    const offers = d.q('#qr-offers').html;
    assert.match(offers, /<span class="qr-offer-kind">Rango<\/span><span class="qr-offer-label">mar 17 nov 2026</);
    assert.match(offers, /<span class="qr-offer-label">19 al 20 nov 2026</);
    assert.equal(d.q('#qr-offers-count').textContent, '4/12');
    assert.match(d.q('#qr-day').html, /Dejamos fuera los días ocupados: mié 18 nov\./);
    assert.equal(d.q('[data-qr-flag="disponibilidad"]').textContent, '4');

    // Quitar una fecha de la lista.
    d.click({ 'data-qr-remove': '0' });
    assert.equal(d.q('#qr-offers-count').textContent, '3/12');
    // Mes siguiente: se pide su agenda una sola vez.
    d.click({ 'data-qr-cal': 'next' });
    await flush();
    assert.equal(d.q('#qr-cal-title').textContent, 'diciembre 2026');
    assert.deepEqual(env.calls.availability[1], { quoteId: 'QT-0077', from: '2026-12-01', to: '2026-12-31', minutes: 180 });
    d.click({ 'data-qr-cal': 'prev' });
    await flush();
    assert.equal(env.calls.availability.length, 2, 'noviembre ya estaba en memoria');
});

// ---------------------------------------------------- condiciones y mensaje
test('P29 + P4: desglose, respuestas rápidas, variables y envío con el mensaje ya resuelto', async () => {
    const env = makeEnv();
    const dialog = loadDialog(env);
    const { ctx, log } = makeCtx();
    dialog.open(ctx);
    const d = driver(env);
    await flush();

    // Fechas (para la variable {{fechas}}).
    d.click({ 'data-qr-tab': 'disponibilidad' });
    await flush();
    d.click({ 'data-qr-date': '2026-11-17' });
    d.click({ 'data-qr-slot': '2026-11-17T13:00:00.000Z', 'data-qr-slot-end': '2026-11-17T16:00:00.000Z' });

    // Condiciones: un concepto rápido arranca con el presupuesto ya escrito.
    d.click({ 'data-qr-tab': 'condiciones' });
    d.click({ 'data-qr-concept': 'Sesión de tatuaje' });
    const items = d.q('#qr-items').html;
    const itemId = /data-qr-item="(qri\d+)"/.exec(items)[1];
    assert.match(items, /name="item_name"[^>]*value="Sesión de tatuaje"/);
    assert.match(items, /name="item_price"[^>]*value="410\.000"/);
    const row = { closest: (sel) => (sel === '[data-qr-item]' ? { getAttribute: () => itemId } : null) };
    d.input('item_qty', '2', row);
    d.input('item_price', '250000', row);
    d.input('discount_pct', '10');
    assert.match(d.q('#qr-totals').html, /<dt>Subtotal<\/dt><dd>500\.000 ARS<\/dd>/);
    assert.match(d.q('#qr-totals').html, /<dt>Total<\/dt><dd>450\.000 ARS<\/dd>/);
    assert.equal(d.q('[name="amount"]').readOnly, true, 'el presupuesto sale del desglose');
    assert.equal(d.q('[name="amount"]').value, '450.000');
    assert.equal(d.q('#qr-amount-help').textContent, 'Calculado desde el desglose económico (pestaña Condiciones).');
    d.input('policy', 'no-reembolsable-48');
    d.input('client_notes', 'Trae ropa cómoda.');
    d.input('extra_terms', 'Un retoque incluido.');
    d.input('deposit_pct', '30');
    d.input('complexity', 'Alta');
    d.input('location', 'Estudio Norte');
    assert.match(d.q('#qr-money').html, /Anticipo para reservar<\/span><strong>135\.000 ARS · 30 %<\/strong>/);

    // Mensaje: respuesta rápida guardada + una variable insertada con su chip.
    d.click({ 'data-qr-tab': 'mensaje' });
    d.click({ 'data-qr-template': 'tpl-1' });
    const area = d.q('#qr-message');
    assert.equal(area.value, 'Hola {{cliente}}, te ofrezco {{fechas}}.');
    area.selectionStart = area.value.length;
    area.selectionEnd = area.value.length;
    d.click({ 'data-qr-var': 'anticipo' });
    assert.equal(area.value, 'Hola {{cliente}}, te ofrezco {{fechas}}. {{anticipo}}');
    assert.equal(d.q('#qr-preview').textContent, 'Hola Lucía, te ofrezco mar 17 nov 2026 · 10:00–13:00. 30 % (135.000 ARS)');
    // Guardar el mensaje como respuesta rápida propia (con las variables sin resolver).
    d.q('[name="template_title"]').value = 'Con anticipo';
    d.click({ 'data-qr-template-save': '' });
    await flush();
    assert.deepEqual(plain(env.calls.savedTemplates[0]), { userId: 'artist-1', template: { title: 'Con anticipo', body: 'Hola {{cliente}}, te ofrezco {{fechas}}. {{anticipo}}', sort: 2 } });
    assert.equal(d.q('#qr-template-status').textContent, 'Respuesta rápida guardada.');
    // Eliminar pide confirmación en dos pasos.
    d.click({ 'data-qr-template-delete': 'tpl-1' });
    assert.deepEqual(env.calls.deletedTemplates, []);
    d.click({ 'data-qr-template-delete': 'tpl-1' });
    await flush();
    assert.deepEqual(env.calls.deletedTemplates, ['tpl-1']);

    // Envío.
    await d.submit();
    await flush();
    assert.equal(env.calls.saves.length, 1);
    const { quoteId, payload } = env.calls.saves[0];
    assert.equal(quoteId, 'QT-0077');
    assert.equal(payload.message, 'Hola Lucía, te ofrezco mar 17 nov 2026 · 10:00–13:00. 30 % (135.000 ARS)', 'se guarda ya resuelto');
    assert.deepEqual(plain(payload.offered), [{ kind: 'slot', start: '2026-11-17T13:00:00.000Z', end: '2026-11-17T16:00:00.000Z' }]);
    assert.equal(payload.currency, 'ARS');
    assert.equal(payload.minutes, 180);
    assert.equal(payload.deposit_pct, '30');
    assert.equal(payload.complexity, 'Alta');
    assert.equal(payload.location, 'Estudio Norte');
    assert.deepEqual(plain(payload.extras), {
        items: [{ name: 'Sesión de tatuaje', description: '', qty: '2', price: '250000' }],
        discount_pct: '10', tax_pct: 0, policy: 'no-reembolsable-48', client_notes: 'Trae ropa cómoda.', extra_terms: 'Un retoque incluido.',
    });
    assert.equal(M.validateProposal(payload).value.amount, 450000, 'el servidor llega al mismo total');
    assert.equal(payload.validate_only, undefined);
    assert.deepEqual(log.chats, [payload.message], 'el mismo texto va al chat');
    assert.deepEqual(plain(log.notified), [{ artist_budget_amount: 450000, artist_budget_currency: 'ARS', estimated_sessions: 2 }]);
    assert.equal(log.flushed, 1);
    assert.equal(log.reloads, 1);
    assert.deepEqual(log.toasts, [{ message: 'Propuesta enviada al cliente.', error: false }]);
    assert.equal(d.overlay.removed, true);
    assert.equal(dialog.isOpen(), false);
    assert.equal(env.document.documentElement.classes.has('qr-open'), false);
});

test('P4: una respuesta rápida guardada con {{seña}} sigue resolviendo como {{anticipo}}', async () => {
    // Lo que un artista ya tiene guardado en artist_message_templates.
    const env = makeEnv({
        templates: [
            { id: 'tpl-old', title: 'Con seña', body: 'Hola {{cliente}}, para reservar pido {{seña}}.' },
            { id: 'tpl-alias', title: 'Otras formas', body: '{{sena}} · {{señal}} · {{deposito}} · {{Depósito}} · {{anticipo}}' },
        ],
    });
    const dialog = loadDialog(env);
    const { ctx, log } = makeCtx();
    dialog.open(ctx);
    const d = driver(env);
    await flush();
    d.input('deposit_pct', '30');
    d.click({ 'data-qr-tab': 'mensaje' });

    // Se usa tal como está guardada: el texto del artista no se reescribe.
    d.click({ 'data-qr-template': 'tpl-old' });
    const area = d.q('#qr-message');
    assert.equal(area.value, 'Hola {{cliente}}, para reservar pido {{seña}}.');
    assert.equal(d.q('#qr-preview').textContent, 'Hola Lucía, para reservar pido 30 % (123.000 ARS).');
    assert.doesNotMatch(d.q('#qr-preview-note').textContent, /No reconocemos|Sin valor todavía/);
    assert.equal(d.q('#qr-preview-note').classes.has('is-error'), false);

    // Todas las formas anteriores dan el mismo valor que la canónica.
    d.input('message', '{{sena}} · {{señal}} · {{deposito}} · {{Depósito}} · {{anticipo}}');
    assert.equal(d.q('#qr-preview').textContent, Array(5).fill('30 % (123.000 ARS)').join(' · '));
    assert.doesNotMatch(d.q('#qr-preview-note').textContent, /No reconocemos/);

    // Y se envía resuelta: al cliente no le llega ni {{seña}} ni {{anticipo}}.
    d.input('message', 'Hola {{cliente}}, para reservar pido {{seña}}.');
    await d.submit();
    await flush();
    assert.equal(env.calls.saves.length, 1);
    assert.equal(env.calls.saves[0].payload.message, 'Hola Lucía, para reservar pido 30 % (123.000 ARS).');
    assert.deepEqual(log.chats, ['Hola Lucía, para reservar pido 30 % (123.000 ARS).']);
    assert.equal(d.q('#qr-error').hidden, true);
});

test('validación antes de enviar: lleva a la pestaña y al campo con el error', async () => {
    const env = makeEnv();
    const dialog = loadDialog(env);
    dialog.open(makeCtx({ budgetDraft: '' }).ctx);
    const d = driver(env);
    await flush();
    d.click({ 'data-qr-tab': 'mensaje' });
    await d.submit();
    assert.equal(env.calls.saves.length, 0);
    assert.equal(d.q('#qr-error').textContent, 'Ingresa un presupuesto válido.');
    assert.equal(d.q('#qr-error').hidden, false);
    assert.equal(d.q('#qr-panel-propuesta').hidden, false, 'vuelve a la pestaña del campo');
    assert.equal(d.q('[name="amount"]').getAttribute('aria-invalid'), 'true');
    assert.equal(env.document.activeElement, d.q('[name="amount"]'));
    d.input('amount', '500');
    assert.equal(d.q('#qr-error').hidden, true, 'el error se limpia al corregir');
    d.input('message', 'Hola {{cliente}}, {{variable_rara}}');
    assert.match(d.q('#qr-preview-note').textContent, /No reconocemos \{\{variable_rara\}\}: corrígelas o quítalas para poder enviar\./);
    await d.submit();
    assert.match(d.q('#qr-error').textContent, /variables sin resolver/, 'al cliente no le llega una variable cruda');
    assert.equal(env.calls.saves.length, 0);
    d.input('message', 'x'.repeat(2001));
    await d.submit();
    assert.match(d.q('#qr-error').textContent, /hasta 2000 caracteres/);
    assert.equal(d.q('#qr-panel-mensaje').hidden, false);
    assert.equal(dialog.isOpen(), true);
});

test('P29: sin el contexto del servidor no se envía (no se pisa un desglose ya guardado)', async () => {
    const env = makeEnv();
    let attempts = 0;
    env.repo.context = async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('sin conexión');
        return {
            success: true, editable: true, timezone: TZ, has_manual: true, quotation: { offered_slots: [] },
            extras: { items: [{ name: 'Sesión', qty: 1, price: 410000 }], discountPct: 0, taxPct: 0, policy: 'sin-sena', clientNotes: 'Nota previa', extraTerms: '', complexity: '', location: '' },
        };
    };
    const dialog = loadDialog(env);
    dialog.open(makeCtx().ctx);
    const d = driver(env);
    await flush();
    assert.equal(attempts, 1, 'falló al abrir');
    // 1.er intento de envío: el contexto sigue sin llegar → no se envía nada.
    await d.submit();
    await flush();
    assert.equal(env.calls.saves.length, 0);
    assert.match(d.q('#qr-error').textContent, /No pudimos cargar los datos guardados de esta propuesta/);
    assert.equal(d.q('#qr-submit').disabled, false);
    // 2.º intento: llega el desglose guardado → se muestra para revisarlo antes de enviar.
    await d.submit();
    await flush();
    assert.equal(env.calls.saves.length, 0);
    assert.match(d.q('#qr-error').textContent, /Revísalos y vuelve a enviarla/);
    assert.equal(d.q('#qr-panel-condiciones').hidden, false);
    assert.match(d.q('#qr-items').html, /name="item_name"[^>]*value="Sesión"/);
    // 3.er intento: ahora sí, con el desglose y las condiciones que ya tenía.
    await d.submit();
    await flush();
    assert.equal(env.calls.saves.length, 1);
    assert.deepEqual(plain(env.calls.saves[0].payload.extras.items), [{ name: 'Sesión', description: '', qty: 1, price: 410000 }]);
    assert.equal(env.calls.saves[0].payload.extras.policy, 'sin-sena');
    assert.equal(env.calls.saves[0].payload.extras.client_notes, 'Nota previa');
});

test('P4: si el servidor rechaza fechas ocupadas, se marcan en la lista y el diálogo sigue abierto', async () => {
    const error = Object.assign(new Error('Esa fecha ya está ocupada en tu agenda: mar 17 nov 2026 · 10:00–13:00. Quítala o elige otra.'), {
        userMessage: 'Esa fecha ya está ocupada en tu agenda: mar 17 nov 2026 · 10:00–13:00. Quítala o elige otra.',
        code: 'slot_conflict', status: 409,
        payload: { conflicts: [{ index: 0, label: 'mar 17 nov 2026 · 10:00–13:00', reason: 'Se superpone con una sesión agendada.' }] },
    });
    const env = makeEnv({ saveError: error });
    const dialog = loadDialog(env);
    const { ctx, log } = makeCtx();
    dialog.open(ctx);
    const d = driver(env);
    await flush();
    d.click({ 'data-qr-tab': 'disponibilidad' });
    await flush();
    d.click({ 'data-qr-date': '2026-11-17' });
    d.click({ 'data-qr-slot': '2026-11-17T13:00:00.000Z', 'data-qr-slot-end': '2026-11-17T16:00:00.000Z' });
    d.click({ 'data-qr-tab': 'propuesta' });
    await d.submit();
    await flush();
    assert.equal(dialog.isOpen(), true);
    assert.equal(d.q('#qr-panel-disponibilidad').hidden, false);
    assert.match(d.q('#qr-offers').html, /class="qr-offer is-conflict"/);
    assert.match(d.q('#qr-offers').html, /<small>Se superpone con una sesión agendada\.<\/small>/);
    assert.match(d.q('#qr-error').textContent, /ya está ocupada en tu agenda/);
    assert.equal(d.q('#qr-submit').disabled, false, 'se puede corregir y reintentar');
    assert.equal(log.reloads, 0);
    assert.deepEqual(log.notified, []);
});

test('P25: modificar una propuesta ya enviada — precargada y sin el aviso de primera respuesta', async () => {
    const stored = [
        { kind: 'range', from: '2026-12-10', to: '2026-12-15', start: '2026-12-10T03:00:00.000Z', end: '2026-12-16T03:00:00.000Z', label: '10 al 15 dic 2026', tz: TZ },
        { kind: 'slot', start: '2026-11-10T13:00:00.000Z', end: '2026-11-10T16:00:00.000Z', label: 'mar 10 nov 2026 · 10:00–13:00', tz: TZ }, // ya pasó
    ];
    const quote = quoteRow({
        quote_status: 'responded', artist_budget_amount: '410000', artist_budget_currency: 'USD', artist_deposit_pct: 30,
        artist_availability: 'Prefiero tardes; 10 al 15 dic 2026; mar 10 nov 2026 · 10:00–13:00', offered_slots: stored, artist_studio_name: 'Estudio Norte',
    });
    const env = makeEnv({
        saveResult: { success: true, first_response: false, updated: true, extras_saved: true },
        context: {
            success: true, editable: true, timezone: TZ, quotation: { offered_slots: stored },
            extras: { items: [{ name: 'Sesión', qty: 2, price: 205000 }], discountPct: 0, taxPct: 0, policy: 'sin-sena', clientNotes: 'Nota previa', extraTerms: '', complexity: 'Media', location: '' },
        },
    });
    const dialog = loadDialog(env);
    // El módulo de negociación pide 3 sesiones y abre en la pestaña del mensaje.
    const { ctx, log } = makeCtx({ quote, budgetDraft: '', prefill: { sessions: 3, tab: 'mensaje', message: 'Hola {{cliente}}, ajusté las sesiones a {{sesiones}}.' } });
    assert.equal(dialog.open(ctx), true);
    const d = driver(env);
    const shell = d.shell();
    assert.match(shell, /id="qr-title">Modificar propuesta<\/h2>/);
    assert.match(shell, /id="qr-submit">Reenviar propuesta<\/button>/);
    assert.match(shell, /name="amount"[^>]*value="410\.000"/);
    assert.match(shell, /name="sessions" type="number"[^>]*value="3"/, 'prefill del evento wo:quote-respond');
    assert.match(shell, /name="deposit_pct"[^>]*value="30"/);
    assert.match(shell, /name="availability_note"[^>]*value="Prefiero tardes"/);
    assert.match(shell, /name="location"[^>]*value="Estudio Norte"/);
    assert.equal(d.q('#qr-panel-mensaje').hidden, false);
    assert.equal(d.q('#qr-offers-count').textContent, '1/12');
    await flush();
    // Los campos de la manual guardados llegan con el contexto del servidor.
    assert.match(d.q('#qr-items').html, /name="item_name"[^>]*value="Sesión"/);
    assert.equal(d.q('[name="policy"]').value, 'sin-sena');
    assert.equal(d.q('[name="client_notes"]').value, 'Nota previa');
    assert.equal(d.q('[name="complexity"]').value, 'Media');

    await d.submit();
    await flush();
    const payload = env.calls.saves[0].payload;
    assert.equal(payload.sessions, '3');
    assert.equal(payload.message, 'Hola Lucía, ajusté las sesiones a 3 sesiones.');
    assert.deepEqual(plain(payload.offered), [{ kind: 'range', from: '2026-12-10', to: '2026-12-15' }], 'la fecha que ya pasó no vuelve a ofrecerse');
    assert.equal(payload.extras.policy, 'sin-sena');
    assert.equal(payload.complexity, 'Media');
    assert.deepEqual(log.notified, [], 'la propuesta reenviada la avisa el servidor');
    assert.deepEqual(log.toasts, [{ message: 'Propuesta actualizada. Le avisamos al cliente.', error: false }]);
});

test('turno pedido: antes de reservarlo se valida la propuesta completa en el servidor', async () => {
    const order = [];
    const env = makeEnv({
        missing: [],
        window: {
            WoSlotHold: {
                respondFieldHtml: () => '<div class="wo-field is-wide"><input type="hidden" name="reserve_slot_offered" value="1"></div>',
                confirmFor: async () => { order.push('confirm'); },
                releaseFor: async () => { order.push('release'); },
            },
        },
    });
    env.repo.save = async (quoteId, payload) => { order.push(payload.validate_only ? 'validate' : 'save'); return { success: true, first_response: true, extras_saved: true }; };
    const dialog = loadDialog(env);
    dialog.open(makeCtx().ctx);
    const d = driver(env);
    await flush();
    assert.match(d.shell(), /<div class="qr-col-4 qr-hold"><div class="wo-field is-wide"><input type="hidden" name="reserve_slot_offered"/);
    d.form.querySelector('[name="reserve_slot"]').checked = true;
    await d.submit();
    await flush();
    assert.deepEqual(order, ['validate', 'confirm', 'save']);
    // Destildado: el turno se libera después de guardar.
    order.length = 0;
    dialog.open(makeCtx().ctx);
    const d2 = driver(env);
    await flush();
    d2.form.querySelector('[name="reserve_slot"]').checked = false;
    await d2.submit();
    await flush();
    assert.deepEqual(order, ['save', 'release']);
});

test('accesibilidad: Escape cierra y devuelve el foco; las flechas mueven entre pestañas', async () => {
    const env = makeEnv();
    const dialog = loadDialog(env);
    dialog.open(makeCtx().ctx);
    const d = driver(env);
    await flush();
    const tab = new env.El('button');
    tab.setAttribute('data-qr-tab', 'propuesta');
    d.key('ArrowRight', tab);
    assert.equal(d.q('#qr-panel-disponibilidad').hidden, false);
    assert.equal(env.document.activeElement, d.q('#qr-tab-disponibilidad'));
    d.key('End', tab);
    assert.equal(d.q('#qr-panel-mensaje').hidden, false);
    d.key('Escape');
    assert.equal(dialog.isOpen(), false);
    assert.equal(d.overlay.removed, true);
    assert.equal(env.document.activeElement, env.opener, 'el foco vuelve a quien abrió el diálogo');
    assert.deepEqual(env.docListeners.keydown, [], 'sin escuchas colgadas');
});

// ------------------------------------------------- franja Estado · Prioridad
function loadStrip(extraWindow = {}) {
    const identity = new (makeEnv().El)('section');
    const env = makeEnv({ window: extraWindow });
    const root = new env.El('main');
    root.nodes['.qd-identity'] = identity;
    env.document.getElementById = (id) => (id === 'quotation-detail-root' ? root : null);
    vm.runInContext(source('public/shared/js/quote-status-priority.js'), env.context, { filename: 'quote-status-priority.js' });
    const render = (detail) => env.docListeners['wo:quotation-detail-rendered'][0]({ detail });
    return { env, root, render, box: () => root.querySelector('#qsp') };
}

test('P5: la franja muestra el estado con las transiciones del artista y la prioridad', () => {
    const changes = [];
    const strip = loadStrip({ WoQuotationDetailActions: { changeStatus: async (v) => { changes.push(['status', v]); return true; }, changePriority: async (v) => { changes.push(['priority', v]); return true; } } });
    strip.render({ quote: { id: 7, quote_id: 'QT-7', quote_status: 'responded', priority: 'high' }, stage: 'responded', readOnly: false });
    const html = strip.box().html;
    assert.match(html, /<label class="qsp-label" for="qsp-status">Estado<\/label>/);
    assert.deepEqual((html.match(/<option value="[a-z_]+"[^>]*>[^<]+/g) || []).slice(0, 3).map((o) => o.replace(/<option value="([a-z_]+)"( selected)?>/, '$1$2|')), [
        'responded selected|Respondida', 'client_approved|Confirmada · registrar acuerdo', 'cancelled|Cancelada · retirar propuesta',
    ]);
    assert.match(html, /<option value="high" selected>Alta<\/option><option value="medium">Media<\/option><option value="low">Baja<\/option>/);
    assert.match(html, /Puedes modificar la propuesta mientras no esté aprobada por ambas partes\./);
    assert.match(html, /<button type="button" class="qsp-btn" data-qsp-propose>Modificar propuesta<\/button>/);

    // Aprobada por ambos: sin botón de propuesta y con el saldo ya activo.
    strip.render({ quote: { id: 7, quote_id: 'QT-7', quote_status: 'client_approved', priority: 'medium' }, stage: 'approved', readOnly: false });
    assert.doesNotMatch(strip.box().html, /data-qsp-propose/);
    assert.match(strip.box().html, /Aprobada por ambas partes: el saldo acordado ya está activo\./);
    assert.match(strip.box().html, /<option value="in_progress">En progreso · iniciar trabajo<\/option>/);
    // P23: rechazada por el cliente = finalizada. Sin "Volver a cotizar" y sin transiciones.
    const rejectedDetail = { quote: { id: 7, quote_id: 'QT-7', quote_status: 'client_rejected', priority: 'medium' }, stage: 'rejected', readOnly: false };
    strip.render(rejectedDetail);
    assert.doesNotMatch(strip.box().html, /data-qsp-propose|Volver a cotizar|Puedes enviarle una nueva/);
    assert.match(strip.box().html, /El cliente rechazó la propuesta y la cotización quedó finalizada\./);
    assert.match(strip.box().html, /id="qsp-status" aria-describedby="qsp-note" disabled>/);
    assert.equal(strip.env.window.WoQuoteStatusPriority.proposeLabel(rejectedDetail), '');
    assert.match(strip.env.window.WoQuoteStatusPriority.noteFor(rejectedDetail), /quedó finalizada/);
    // Vista simulada o en disputa: todo deshabilitado.
    strip.render({ quote: { id: 7, quote_status: 'pending' }, stage: 'pending', readOnly: true });
    assert.match(strip.box().html, /id="qsp-status" aria-describedby="qsp-note" disabled>/);
    assert.match(strip.box().html, /id="qsp-priority" disabled>/);
    // Estado terminal: nada que elegir.
    strip.render({ quote: { id: 7, quote_status: 'completed' }, stage: 'completed', readOnly: false });
    assert.match(strip.box().html, /id="qsp-status" aria-describedby="qsp-note" disabled>/);
    // Datos raros de la base no rompen el HTML.
    strip.render({ quote: { id: 7, quote_status: 'pending', priority: '"><script>x</script>' }, stage: 'pending', readOnly: false });
    assert.doesNotMatch(strip.box().html, /<script>/);
});

test('P5/P25: cambiar estado o prioridad llama a las acciones del expediente; el botón dispara wo:quote-respond', async () => {
    const changes = [];
    const strip = loadStrip({
        WoQuotationDetailActions: {
            changeStatus: async (v) => { changes.push(['status', v]); return false; }, // p. ej. abrió un diálogo
            changePriority: async (v) => { changes.push(['priority', v]); return true; },
        },
    });
    strip.render({ quote: { id: 7, quote_id: 'QT-7', quote_status: 'responded', priority: 'medium' }, stage: 'responded', readOnly: false });
    const change = strip.env.docListeners.change[0];
    const statusSelect = { id: 'qsp-status', value: 'client_approved', disabled: false };
    strip.env.document.getElementById = (id) => (id === 'qsp-status' ? statusSelect : null);
    change({ target: statusSelect });
    await flush();
    assert.deepEqual(changes, [['status', 'client_approved']]);
    assert.equal(statusSelect.value, 'responded', 'si el cambio no se aplicó, el selector vuelve al estado real');
    assert.equal(statusSelect.disabled, false);
    const prioritySelect = { id: 'qsp-priority', value: 'high', disabled: false, focus() {} };
    change({ target: prioritySelect });
    await flush();
    assert.deepEqual(changes[1], ['priority', 'high']);
    assert.equal(prioritySelect.value, 'high');

    strip.env.docListeners.click[0]({ target: { closest: (sel) => (sel === '[data-qsp-propose]' ? {} : null) } });
    const event = strip.env.dispatched.find((e) => e.type === 'wo:quote-respond');
    assert.ok(event, 'contrato entre frentes');
    assert.deepEqual(JSON.parse(JSON.stringify(event.detail)), { quoteId: 'QT-7', prefill: {} });
});
