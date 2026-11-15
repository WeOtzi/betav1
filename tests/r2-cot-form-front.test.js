'use strict';
// Ronda 2 · frente cot-form · wizard /quotation: modelo puro, hooks de
// script.js, interfaz nueva (quotation-r2.js), panel del cliente, detalle del
// artista (N11) y migraciones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
// CRLF del checkout en Windows: se normaliza para que los contratos no dependan del fin de línea.
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const Model = require('../public/shared/js/quotation-r2-model.js');
const script = read('public', 'shared', 'js', 'script.js');
const r2 = read('public', 'shared', 'js', 'quotation-r2.js');
const reuse = read('public', 'shared', 'js', 'wo-quote-reuse.js');
const css = read('public', 'shared', 'css', 'quotation-r2.css');
const html = read('public', 'quotation', 'index.html');

const NOW = new Date(2026, 10, 15, 12, 0, 0); // 15 nov 2026 (hora local)
// Los valores que salen de un contexto vm tienen otros prototipos: se copian para comparar.
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// Entornos de ejecución
// ---------------------------------------------------------------------------
function memoryStorage(initial = {}) {
    const data = { ...initial };
    return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; }, data };
}

// script.js con el modelo de la ronda 2 cargado (sin DOM real).
function wizard({ withModel = true, storage = memoryStorage() } = {}) {
    const elements = {};
    const window = { addEventListener() {}, scrollTo() {}, location: { search: '', pathname: '/quotation' } };
    if (withModel) window.WoQuotationR2Model = Model;
    const context = vm.createContext({
        window,
        document: {
            addEventListener() {}, body: { classList: { toggle() {} } },
            querySelector: () => null, querySelectorAll: () => [],
            getElementById: (id) => elements[id] || null
        },
        console, URLSearchParams, setTimeout, clearTimeout, Uint8Array, Math, Promise, WeakMap, WeakSet, URL,
        crypto: { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = (i * 37) % 256; return b; } },
        localStorage: storage
    });
    vm.runInContext(script, context);
    vm.runInContext(`renderInlineCalendar = () => {}; persistAnswer = () => {}; saveDraftToLocalStorage = () => {};
        autoSaveQuotation = () => {}; showToastMessage = () => {}; renderPreviews = () => {};`, context);
    return { context, elements, window };
}

// quotation-r2.js con un DOM mínimo.
function ui({ storage = memoryStorage(), config = { gemini: { enabled: true } } } = {}) {
    const window = { WoQuotationR2Model: Model, location: { pathname: '/quotation' }, ConfigManager: { getValue: (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), config) } };
    const context = vm.createContext({ window, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
        localStorage: storage, console, setTimeout, Promise, navigator: {}, atob: (s) => Buffer.from(s, 'base64').toString('binary'), Uint8Array, Date, JSON,
        File: class { constructor(parts, name, opts) { this.name = name; this.type = opts.type; this.size = parts[0].length; } } });
    vm.runInContext(r2, context);
    return { api: window.WoQuotationR2, window, context, storage };
}

// ---------------------------------------------------------------------------
// P15 · fecha de nacimiento
// ---------------------------------------------------------------------------
test('P15: menos de 14 no es válida; 14–17 es válida con aviso de menor; el año se elige en su propio campo', () => {
    assert.deepEqual(Model.birthStatus({ day: 16, month: 11, year: 2012 }, NOW), { complete: true, valid: false, age: 13, tooYoung: true, minor: false, real: true });
    const fourteen = Model.birthStatus({ day: 15, month: 11, year: 2012 }, NOW);
    assert.deepEqual([fourteen.valid, fourteen.age, fourteen.minor, fourteen.tooYoung], [true, 14, true, false]);
    assert.equal(Model.birthStatus({ day: 16, month: 11, year: 2008 }, NOW).minor, true, '17 años');
    const adult = Model.birthStatus({ day: 15, month: 11, year: 2008 }, NOW);
    assert.deepEqual([adult.valid, adult.age, adult.minor], [true, 18, false]);
    assert.equal(Model.birthStatus({ day: null, month: 11, year: 2000 }, NOW).complete, false);
    assert.equal(Model.birthStatus({ day: 31, month: 2, year: 2000 }, NOW).real, false, '31 de febrero no existe');
    assert.equal(Model.birthStatus({ day: 31, month: 2, year: 2000 }, NOW).valid, false);

    const years = Model.birthYears(NOW);
    assert.equal(years[0], 2012, 'el año más reciente ya cumple 14');
    assert.ok(!years.includes(2013) && years.includes(1926));
    assert.deepEqual(Model.parseBirthDate('20 Dic 1990'), { day: 20, month: 12, year: 1990 });
    assert.deepEqual(Model.parseBirthDate('1990-12-20'), { year: 1990, month: 12, day: 20 });
    assert.deepEqual(Model.parseBirthDate('cualquier cosa'), { day: null, month: null, year: null });
    assert.equal(Model.formatBirthDate({ day: 5, month: 1, year: 2001 }), '5 Ene 2001');
    assert.equal(Model.daysInMonth(2024, 2), 29);
});

test('P15: el control son tres selects (día · mes · año) y el aviso de menor nombra la autorización', () => {
    const { api } = ui();
    const control = api.birthControlHtml('20 Dic 1990');
    for (const id of ['q-birth-day', 'q-birth-month', 'q-birth-year']) assert.match(control, new RegExp(`<select id="${id}" class="wo-select"`));
    assert.ok(control.indexOf('q-birth-month') < control.indexOf('q-birth-year'), 'el año va al lado del mes');
    assert.match(control, /<option value="12" selected>Diciembre<\/option>/);
    assert.match(control, /<option value="1990" selected>1990<\/option>/);
    assert.match(control, /autocomplete="bday-year"/);
    const thisYear = new Date().getFullYear();
    assert.doesNotMatch(control, new RegExp(`<option value="${thisYear - 13}"`), 'no se ofrecen años de menos de 14');
    assert.match(control, new RegExp(`<option value="${thisYear - 14}"`));
    assert.match(r2, /Eres menor de edad\.<\/strong> Para tatuarte necesitas la autorización de tu madre, tu padre o tu representante legal/);
    assert.match(r2, /necesitas tener al menos ' \+ M\.MIN_AGE \+ ' años/);
});

test('P15: "¿Es un cover-up?" solo aparece si NO es el primer tatuaje (y no viaja en true)', () => {
    const { context } = wizard();
    const visible = (first) => vm.runInContext(`formData = { tattoo_is_first_tattoo: ${first} }; isQuestionVisible({ step: 'cover-up' })`, context);
    assert.equal(visible('false'), true);
    assert.equal(visible('true'), false);
    assert.equal(visible('undefined'), false, 'sin responder todavía no se pregunta');
    const cover = vm.runInContext(`formData = { tattoo_is_first_tattoo: true, tattoo_is_cover_up: true }; preparePayload().tattoo_is_cover_up`, context);
    assert.equal(cover, false);
    assert.equal(vm.runInContext(`formData = { tattoo_is_first_tattoo: false, tattoo_is_cover_up: true }; preparePayload().tattoo_is_cover_up`, context), true);
    assert.match(script, /if \(field === 'tattoo_is_first_tattoo'\) \{\n\s*const coverUp = document\.getElementById\('block-cover-up'\);\n\s*if \(coverUp\) coverUp\.classList\.toggle\('hidden', value !== false\);/);
    // El servidor rechaza menores de 14: el wizard vuelve al campo y lo marca.
    assert.match(script, /error\.data\.code === 'under_age'/);
});

// ---------------------------------------------------------------------------
// P14 · rango de fechas
// ---------------------------------------------------------------------------
test('P14: el calendario arma un rango tentativo (inicio → fin) y un tercer toque empieza otro', () => {
    let state = Model.pickRangeDay({}, '2027-01-10');
    assert.deepEqual(state, { start: '2027-01-10', end: null });
    state = Model.pickRangeDay(state, '2027-01-15');
    assert.deepEqual(state, { start: '2027-01-10', end: '2027-01-15' });
    assert.deepEqual(Model.pickRangeDay(state, '2027-01-20'), { start: '2027-01-20', end: null }, 'rango completo: se reinicia');
    assert.deepEqual(Model.pickRangeDay({ start: '2027-01-10' }, '2027-01-05'), { start: '2027-01-05', end: null }, 'anterior al inicio');
    assert.deepEqual(Model.pickRangeDay({ start: '2027-01-10' }, '2027-01-10'), { start: '2027-01-10', end: null });
    assert.deepEqual(Model.pickRangeDay({ start: '2027-01-10' }, 'x'), { start: '2027-01-10', end: null });
    assert.equal(Model.rangeLabel('2027-01-10', '2027-01-15'), '10 Ene 2027 – 15 Ene 2027');
    assert.equal(Model.rangeLabel('2027-01-10', null), '10 Ene 2027');
    assert.deepEqual(['2027-01-10', '2027-01-12', '2027-01-15', '2027-01-16'].map((d) => Model.rangePosition(d, '2027-01-10', '2027-01-15')), ['start', 'between', 'end', null]);
});

test('P14: script.js guarda el rango, lo manda en ISO y convive con el turno preseleccionado', () => {
    const { context } = wizard();
    vm.runInContext(`formData = { client_flexible_dates: true }; pickCalendarDay('2099-01-10');`, context);
    assert.equal(vm.runInContext('formData._preferred_date_iso', context), '2099-01-10');
    assert.equal(vm.runInContext('formData.client_preferred_date', context), '10 Ene 2099', 'mismo formato de un solo día que antes');
    assert.equal(vm.runInContext('formData.client_flexible_dates', context), false, 'al pasar de un chip a una fecha se reinicia');
    vm.runInContext(`formData.client_flexible_dates = true; pickCalendarDay('2099-01-15');`, context);
    assert.equal(vm.runInContext('formData._preferred_date_end_iso', context), '2099-01-15');
    assert.equal(vm.runInContext('formData.client_preferred_date', context), '10 Ene 2099 – 15 Ene 2099');
    assert.equal(vm.runInContext('formData.client_flexible_dates', context), true, 'la flexibilidad la marca el cliente');
    const payload = vm.runInContext('preparePayload()', context);
    assert.equal(payload.preferred_date_from, '2099-01-10');
    assert.equal(payload.preferred_date_to, '2099-01-15');
    // Chip: sin fechas ISO.
    vm.runInContext(`selectDateChip('Sin fecha', true)`, context);
    const chip = vm.runInContext('preparePayload()', context);
    assert.deepEqual([chip.preferred_date_from, chip.preferred_date_to, chip.client_preferred_date], [null, null, 'Sin fecha']);
    // Con turno elegido un toque elige UN día (quotation-slot.js llama a pickCalendarDay).
    vm.runInContext(`formData = { _preferred_date_iso: '2099-02-01', requested_slot: { date: '2099-02-01' } };
        window.WoQuotationSlot = { onDatePicked() {}, payload: () => ({}) }; pickCalendarDay('2099-02-05');`, context);
    assert.equal(vm.runInContext('formData._preferred_date_iso', context), '2099-02-05');
    assert.equal(vm.runInContext('formData._preferred_date_end_iso', context), null);
    vm.runInContext(`formData = { _preferred_date_iso: '2099-02-01', _preferred_date_end_iso: '2099-02-09', requested_slot: { date: '2099-02-01' } }`, context);
    assert.equal(vm.runInContext('preparePayload().preferred_date_to', context), '2099-02-01', 'un turno es de un solo día');
    // Texto de ayuda y flexibilidad.
    assert.match(script, /rango de fechas tentativo<\/strong>: toca el primer día y después el último\. Es solo tu preferencia: <strong>no garantiza disponibilidad<\/strong>/);
    assert.match(script, /id="date-flexible"[^>]*onchange="setDateFlexibility\(this\.checked\)"/);
    assert.match(script, /Tengo flexibilidad con las fechas/);
    assert.match(script, /window\.WoQuotationSlot \? window\.WoQuotationSlot\.cardHtml\(formData\) : ''/, 'la tarjeta del turno sigue primera');
    assert.match(script, /is-in-range/);
});

test('sin el módulo de la ronda 2 el calendario sigue eligiendo un día (como antes)', () => {
    const { context } = wizard({ withModel: false });
    vm.runInContext(`formData = {}; pickCalendarDay('2099-01-10'); pickCalendarDay('2099-01-15');`, context);
    assert.equal(vm.runInContext('formData._preferred_date_iso', context), '2099-01-15');
    assert.equal(vm.runInContext('formData._preferred_date_end_iso', context), null);
    assert.equal(vm.runInContext('formData.client_preferred_date', context), '15 Ene 2099');
});

// ---------------------------------------------------------------------------
// P18 · datos faltantes en rojo
// ---------------------------------------------------------------------------
test('P18: "Continuar" junta TODOS los datos que faltan y los marca (rojo, mensaje, aria-invalid, foco)', () => {
    const { context } = wizard();
    const errors = vm.runInContext(`formData = { client_email: 'mal' }; selectedBodyParts = [];
        collectScreenErrors({ id: 'client', title: 'x', questions: [
            { id: 1, step: 'name', type: 'text', field: 'client_full_name' },
            { id: 2, step: 'email', type: 'email', field: 'client_email' },
            { id: 3, step: 'instagram', type: 'text', field: 'client_instagram', optional: true },
            { id: 4, step: 'first-tattoo', type: 'boolean', field: 'tattoo_is_first_tattoo' },
            { id: 5, step: 'cover-up', type: 'boolean', field: 'tattoo_is_cover_up' }
        ] }).map((e) => e.message)`, context);
    assert.equal(errors.length, 3, 'nombre, correo inválido y primer tatuaje; cover-up oculto no cuenta');
    assert.match(errors[1], /correo/);
    assert.equal(vm.runInContext(`collectScreenValues({ id: 'x', title: 't', questions: [{ id: 9, step: 'body-part', type: 'body-selector', field: 'tattoo_body_part' }] }).ok`, context), false);
    assert.match(script, /const errors = collectScreenErrors\(screen\);\n\s*if \(errors\.length\) \{\n\s*showScreenErrors\(errors\);/);
    // Todos los tipos de bloque devuelven el elemento a resaltar.
    for (const fragment of ["message: 'Elegí una zona del cuerpo.', el:", "message: 'Elegí al menos un estilo.', el:", "message: 'Elegí un rango de presupuesto.', el:"]) {
        assert.ok(script.includes(fragment), fragment);
    }
    assert.match(r2, /control\.setAttribute\('aria-invalid', 'true'\)/);
    assert.match(r2, /block\.classList\.add\('is-invalid'\)/);
    assert.match(r2, /message\.setAttribute\('role', index === 0 \? 'alert' : 'note'\)/);
    assert.match(r2, /firstTarget\.focus\(/);
    assert.match(css, /\.q-block\.is-invalid \{[^}]*border: var\(--border-strong-width\) solid var\(--system-error\)/);
    assert.match(css, /\.q-field-error \{[^}]*color: var\(--error-fg\)/);
});

// ---------------------------------------------------------------------------
// P7 / P13 / N11 · referencias en el wizard
// ---------------------------------------------------------------------------
function storageClient(failPaths = []) {
    const uploaded = [];
    return { uploaded, client: { storage: { from: () => ({ upload: async (p, file) => {
        if (failPaths.some((f) => file.name === f)) return { error: { message: 'network' } };
        uploaded.push(p);
        return { error: null };
    } }) } } };
}

test('N11/P13: las 4 referencias viajan completas y cada nota va con SU imagen aunque falle una subida', async () => {
    const { context, window } = wizard();
    const QID = 'QN' + 'c'.repeat(32);
    const ok = storageClient();
    window.ConfigManager = { getSupabaseClient: () => ok.client };
    context.files = ['a', 'b', 'c', 'd'].map((n) => ({ name: `${n}.jpg`, type: 'image/jpeg' }));
    vm.runInContext(`uploadedFiles = files; formData = { reference_notes: ['nota a', 'nota b', 'nota c', 'nota d'] }; _aiReferenceFiles.add(files[3]);`, context);
    const full = plain(await vm.runInContext(`uploadReferencesToStorage('${QID}')`, context));
    assert.equal(full.references.length, 4);
    assert.equal(full.failed, 0);
    assert.deepEqual(full.references.map((r) => r.note), ['nota a', 'nota b', 'nota c', 'nota d']);
    assert.deepEqual(full.references.map((r) => r.ai_generated), [false, false, false, true]);
    assert.deepEqual(full.references.map((r) => r.path), full.paths);
    assert.ok(full.paths.every((p) => /^QN[0-9a-f]{32}\/ref_\d_\d{10,14}\.jpg$/.test(p)));

    const second = wizard();
    const flaky = storageClient(['b.jpg']);
    second.window.ConfigManager = { getSupabaseClient: () => flaky.client };
    second.context.files = ['a', 'b', 'c', 'd'].map((n) => ({ name: `${n}.jpg`, type: 'image/jpeg' }));
    vm.runInContext(`uploadedFiles = files; formData = { reference_notes: ['nota a', 'nota b', 'nota c', 'nota d'] };`, second.context);
    const partial = plain(await vm.runInContext(`uploadReferencesToStorage('${QID}')`, second.context));
    assert.equal(partial.failed, 1);
    assert.deepEqual(partial.references.map((r) => r.note), ['nota a', 'nota c', 'nota d'], 'la nota no se corre a otra imagen');
});

test('N11: dos tandas a la vez no superan el máximo de 4 ni rompen el envío', async () => {
    const { context } = wizard();
    vm.runInContext(`convertIfHEIC = async (f) => f; compressImage = async (f) => { await new Promise((r) => setTimeout(r, 5)); return f; };
        uploadedFiles = []; formData = {};`, context);
    context.batchA = [1, 2, 3].map((i) => ({ name: `a${i}.jpg`, type: 'image/jpeg' }));
    context.batchB = [1, 2, 3].map((i) => ({ name: `b${i}.jpg`, type: 'image/jpeg' }));
    await vm.runInContext(`Promise.all([handleFiles(batchA), handleFiles(batchB)])`, context);
    assert.equal(vm.runInContext('uploadedFiles.length', context), 4);
    assert.equal(vm.runInContext('formData.reference_images_count', context), 4);
    assert.equal(vm.runInContext('formData.reference_notes.length', context), 4);
});

test('P7: tile "Generar referencia con IA", ruta propia y marca "solo referencial" hasta el envío', async () => {
    assert.match(script, /postQuotationApi\('\/api\/quotations\/ai-reference', body\)/);
    assert.doesNotMatch(script, /\/api\/gemini\/generate-image/, 'el cotizador no usa el endpoint genérico');
    assert.match(script, /onUse: \(file\) => handleFiles\(\[file\], \{ ai: true \}\)/);
    assert.match(script, /if \(R2 && R2\.aiEnabled\(\)\) \{/, 'solo si la IA está habilitada');
    assert.match(script, /Generada con IA · solo referencial/);
    const { api } = ui();
    assert.equal(api.aiEnabled(), true);
    assert.equal(ui({ config: { gemini: { enabled: false } } }).api.aiEnabled(), false);
    assert.match(api.aiTileHtml(), /Generar referencia con IA<\/span><small>Solo referencial<\/small>/);
    assert.match(r2, /Solo referencial\.<\/strong> ' \+ esc\(AI_DISCLAIMER\)/);
    assert.match(r2, /no es el diseño final ni un compromiso sobre el resultado/);
    // La imagen del servidor solo se acepta como data URL de imagen.
    assert.match(r2, /\/\^data:image\\\/\(png\|jpeg\|webp\);base64,\/\.test\(data\.image\)/);
    // Con IA marcada, el archivo procesado conserva la marca.
    const { context } = wizard();
    vm.runInContext(`convertIfHEIC = async (f) => f; compressImage = async (f) => ({ name: 'c.jpg', type: 'image/jpeg' }); uploadedFiles = []; formData = {};`, context);
    await vm.runInContext(`handleFiles([{ name: 'ia.png', type: 'image/png' }], { ai: true })`, context);
    assert.equal(vm.runInContext('isAiReferenceFile(uploadedFiles[0])', context), true);
    assert.equal(vm.runInContext('cssUrlValue(\'javascript:alert(1)\')', context), '');
    assert.equal(vm.runInContext('cssUrlValue(\'https://x.test/a") url(evil\')', context), 'https://x.test/a) url(evil');
});

// ---------------------------------------------------------------------------
// P16 · solicitud enviada
// ---------------------------------------------------------------------------
test('P16: código corto de 6 caracteres y beneficios de la cuenta (cupones y financiamiento como "Próximamente")', () => {
    assert.equal(Model.displayCode({ short_code: 'A7K3QX', quote_id: 'QN' + 'a'.repeat(32) }), 'A7K3QX');
    assert.equal(Model.displayCode({ short_code: 'a7k3qx', quote_id: 'QN0123456789abcdef0123456789abcdef' }), 'ABCDEF');
    const { context } = wizard();
    assert.equal(vm.runInContext(`formData = { short_code: 'B8M4RT', quote_id: 'QN${'a'.repeat(32)}' }; quotationDisplayCode()`, context), 'B8M4RT');
    assert.match(script, /if \(result\.short_code\) formData\.short_code = result\.short_code;/);
    assert.doesNotMatch(script, /highlight-text">\$\{escapeQuotationHtml\(formData\.quote_id\)\}/, 'ya no se muestra el id largo');

    const { api } = ui();
    const guest = api.successHtml({ code: 'A7K3QX', artistName: '<b>Ana</b>', loggedIn: false, warningsHtml: '', minor: true, location: 'Sede <1>' });
    assert.match(guest, /<h1 id="success-title" class="q-ok-title" tabindex="-1">Solicitud enviada<\/h1>/);
    assert.match(guest, /id="q-ok-code"[^>]*>A7K3QX<\/span>/);
    assert.match(guest, /&lt;b&gt;Ana&lt;\/b&gt;<\/strong> recibió tu solicitud/);
    assert.doesNotMatch(guest, /<b>Ana<\/b>|Sede <1>/);
    assert.match(guest, /Con una cuenta gratuita/);
    assert.match(guest, /onclick="goToClientRegistration\(\)"/);
    assert.match(guest, /onclick="showSuccessWithoutAccount\(\)"/);
    assert.match(guest, /Cupones de descuento <em class="q-ok-soon">Próximamente<\/em>/);
    assert.match(guest, /Financiamiento <em class="q-ok-soon">Próximamente<\/em>/);
    assert.match(guest, /autorización de tu madre, tu padre o tu representante legal/);
    const logged = api.successHtml({ code: 'A7K3QX', loggedIn: true });
    assert.match(logged, /Lo que tienes con tu cuenta/);
    assert.match(logged, /href="\/client\/dashboard"/);
    assert.doesNotMatch(logged, /goToClientRegistration/);
    assert.equal(Model.COMING_SOON_BENEFITS.length, 2);
    assert.ok(Model.ACCOUNT_BENEFITS.every((b) => b.icon && b.title && b.text));
    assert.ok(Model.ACCOUNT_BENEFITS.some((b) => /otro artista/i.test(b.title)), 'reutilizar la solicitud es un beneficio real de la cuenta');
});

// ---------------------------------------------------------------------------
// P19 · artistas sugeridos
// ---------------------------------------------------------------------------
test('P19: etiquetas de colores solo si cumple, "Recomendado" amarillo e insignia de embajador', () => {
    const full = { match: { style: 'exact', location: 'country', budget: 'within' }, recommended: true, ambassador: true };
    assert.deepEqual(Model.suggestionTags(full).map((t) => [t.label, t.tone]), [['Trabaja tu estilo', 'style'], ['En tu país', 'place'], ['Dentro de tu presupuesto', 'budget']]);
    assert.deepEqual(Model.suggestionTags({ match: { style: null, location: null, budget: 'above' } }), [], 'lo que no cumple no se muestra');
    assert.deepEqual(Model.suggestionTags({ match: { budget: 'near' } }), []);
    assert.deepEqual(Model.suggestionTags({ match: { location: 'near', distance_km: 40 } }).map((t) => t.label), ['A 40 km']);
    assert.deepEqual(Model.suggestionBadges(full).map((b) => b.key), ['recommended', 'ambassador']);
    assert.deepEqual(Model.suggestionBadges({ recommended: 'true', ambassador: 1 }), []);
    for (const tone of ['style', 'place', 'budget']) assert.match(css, new RegExp(`\\.q-sug-why \\.q-sug-tag--${tone} \\{[^}]*background: var\\(--`));
    assert.match(css, /\.q-sug-badge--recommended \{ background: var\(--yellow-300\)/);
    assert.match(css, /\.q-sug-badge--ambassador \{/);
    assert.match(css, /\.q-sug-actions \.q-sug-profile \{\n\s*align-self: center;/, '"Ver perfil" centrado');
});

test('P19: la tarjeta abre el perfil reducido desde la foto, el nombre y "Ver perfil" (con ojo)', () => {
    const { context } = wizard();
    const card = vm.runInContext(`suggestionCardHtml({ user_id: 'a1', username: 'ana"x', name: '<b>Ana</b>', profile_picture: 'https://cdn.test/a.jpg',
        styles: ['Fine Line'], city: 'Buenos Aires', country: 'Argentina', verified: true, recommended: true, ambassador: true,
        match: { style: 'exact', location: 'city', budget: 'above' } }, 2)`, context);
    assert.match(card, /<button type="button" class="q-sug-head q-sug-open" data-sug-profile="2" aria-label="Ver el perfil de &lt;b&gt;Ana&lt;\/b&gt;">/);
    assert.match(card, /<a class="q-sug-profile" href="\/artist\/profile\?artist=ana%22x" target="_blank" rel="noopener" data-sug-profile="2"><i data-wo-icon="eye" aria-hidden="true"><\/i> Ver perfil/);
    assert.match(card, /q-sug-badge--recommended"><i data-wo-icon="star" aria-hidden="true"><\/i>Recomendado/);
    assert.match(card, /q-sug-badge--ambassador"><i data-wo-icon="award" aria-hidden="true"><\/i>Embajador/);
    assert.match(card, /q-sug-tag--style">Trabaja tu estilo/);
    assert.match(card, /q-sug-tag--place">En tu ciudad/);
    assert.doesNotMatch(card, /presupuesto/i, 'no cumple el presupuesto: no se muestra');
    assert.match(script, /closest\('\[data-sug-profile\]'\)/);
    assert.match(script, /R2\.openProfile\(s, \{ canChoose: !_isSubmittingQuotation, onChoose: \(\) => chooseSuggestedArtist\(index\) \}\)/);
    // Modal: portfolio + "Ver perfil completo" en otra pestaña; la cotización sigue abierta.
    assert.match(r2, /role="dialog" aria-modal="true"/);
    assert.match(r2, /Ver perfil completo <i data-wo-icon="external-link"/);
    assert.match(r2, /target="_blank" rel="noopener">' \+\n\s*'Ver perfil completo/);
    assert.match(r2, /class="q-prof-grid"/);
    assert.match(r2, /event\.key === 'Escape'/);
    assert.deepEqual(Model.portfolioItems({ portfolio: [{ url: 'https://c.test/1.jpg', caption: ' Hola ' }, { url: 'javascript:x' }, 'https://c.test/2.jpg', null] }),
        [{ url: 'https://c.test/1.jpg', caption: 'Hola' }, { url: 'https://c.test/2.jpg', caption: '' }]);
});

// ---------------------------------------------------------------------------
// P27 · sede
// ---------------------------------------------------------------------------
test('P27: el cliente elige sede/ciudad; viaja solo la llave y solo en el envío', () => {
    assert.match(script, /if \(mode === 'submit' && formData\.preferred_location_key\) body\.preferred_location = formData\.preferred_location_key;/);
    assert.match(script, /const show = !!R2 && options\.length > 1;/, 'solo si tatúa en más de un lugar');
    assert.match(script, /if \(screen\.id === 'details' && q\.step === 'date'\) \{\n\s*const locationBlock = buildLocationBlock\(\);/);
    assert.match(script, /const key = await R2\.chooseLocation\(s\.name \|\| s\.username, options\);\n\s*if \(key === null\) return;/);
    const { context } = wizard();
    vm.runInContext(`formData = { artist_id: 'a1', preferred_location_key: 'x' }; _artistLocations = { artistId: 'a1', options: [{ key: 'k1', label: 'Sede 1' }, { key: 'k2', label: 'Sede 2' }] };
        setPreferredLocation('k2');`, context);
    assert.equal(vm.runInContext('formData.preferred_location_key', context), 'k2');
    assert.equal(vm.runInContext('formData.preferred_location_label', context), 'Sede 2');
    vm.runInContext(`setPreferredLocation('inventada')`, context);
    assert.equal(vm.runInContext('formData.preferred_location_key', context), null);
    vm.runInContext(`formData = { artist_id: 'otro' }`, context);
    assert.equal(vm.runInContext('artistLocationOptions().length', context), 0, 'las sedes son del artista cargado');
    // Deshacer un artista sugerido suelta su sede.
    vm.runInContext(`formData = { quotation_source: 'recommendation', artist_id: 'a1', preferred_location_key: 'k1', preferred_location_label: 'Sede 1' }; resetChosenArtist();`, context);
    assert.equal(vm.runInContext('formData.preferred_location_key', context), null);

    const { api } = ui();
    const block = api.locationBlockHtml([{ key: 'studio_location:l1', label: 'CLAROSCURO · <Sede>', type: 'studio_location' },
        { key: 'trip:v1', label: 'Madrid', type: 'trip', from: '2027-02-01', to: '2027-02-10', agenda: 'waitlist' }], 'trip:v1');
    assert.match(block, /<legend class="q-block-label">¿Dónde quieres tatuarte\?<\/legend>/);
    assert.match(block, /value="" ?>|value=""><span/, 'opción "Sin preferencia"');
    assert.match(block, /Sin preferencia/);
    assert.match(block, /CLAROSCURO · &lt;Sede&gt;/);
    assert.match(block, /value="trip:v1" checked/);
    assert.match(block, /Viaje · del 1 feb al 10 feb 2027 · lista de espera/);
    assert.equal(Model.locationDates({ from: '2026-12-28', to: '2027-01-05' }), 'del 28 dic 2026 al 5 ene 2027');
    assert.equal(Model.locationDates({}), '');
    assert.match(r2, /'\/api\/quotations\/artist-locations\?artist_id=' \+ encodeURIComponent\(id\)/);
});

// ---------------------------------------------------------------------------
// P32 · cotizar con otro artista
// ---------------------------------------------------------------------------
test('P32: el panel del cliente clona en el servidor y el cotizador abre el borrador en el paso de elegir artista', () => {
    const dashboard = read('public', 'shared', 'js', 'client-dashboard.js');
    const page = read('public', 'client', 'dashboard', 'index.html');
    assert.match(dashboard, /\$\{window\.WoQuoteReuse \? window\.WoQuoteReuse\.buttonHtml\(quotation\) : ''\}/);
    assert.ok(page.indexOf('/shared/js/wo-quote-reuse.js') > 0 && page.indexOf('/shared/js/wo-quote-reuse.js') < page.indexOf('/shared/js/client-dashboard.js"'));
    assert.match(reuse, /'\/api\/quotations\/' \+ encodeURIComponent\(quoteId\) \+ '\/reuse'/);
    assert.match(reuse, /Authorization: 'Bearer ' \+ token/);
    assert.match(reuse, /appUrl\('\/quotation\?source=reuse'\)/);

    const win = { location: { pathname: '/client/dashboard' } };
    vm.runInContext(reuse, vm.createContext({ window: win, document: {}, localStorage: memoryStorage(), console, fetch: async () => ({}) }));
    const R = win.WoQuoteReuse;
    assert.equal(R.canReuse({ quote_id: 'Q1', quote_status: 'pending' }), true);
    assert.equal(R.canReuse({ quote_id: 'Q1', quote_status: 'in_progress' }), false, 'un borrador no se reutiliza');
    assert.equal(R.canReuse({ quote_id: 'Q1', quote_status: 'in_progress', artist_responded_at: '2026-11-01' }), true);
    const button = R.buttonHtml({ quote_id: 'Q"1<x>', quote_status: 'completed' });
    assert.match(button, /data-quote-id="Q&quot;1&lt;x&gt;"/);
    assert.match(button, />Cotizar con otro artista<\/button>/);
    assert.match(button, /onclick="WoQuoteReuse\.start\(this\.dataset\.quoteId, this\)"/);
    assert.equal(R.buttonHtml({ quote_id: 'Q1', quote_status: 'in_progress' }), '');

    assert.match(script, /if \(initialUrlParams\.get\('source'\) === 'reuse' && applyReuseHandoff\(\)\) \{/);
    assert.match(script, /if \(currentStepIndex === summaryIdx\) setTimeout\(\(\) => showArtistSuggestions\(\), 0\);/);
});

test('P32: el borrador clonado se toma una sola vez, vence y trae sus referencias ya guardadas', async () => {
    const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    const QID = 'QN' + 'd'.repeat(32);
    const draft = { submission_key: KEY, quote_id: QID, source_code: 'B8M4RT',
        form: { tattoo_idea_description: 'Una golondrina', client_email: 'qa@example.test', artist_id: undefined },
        references: [{ path: `${QID}/ref_1_1731600000001.jpg`, url: 'https://demo.supabase.test/x/ref_1.jpg', note: 'nota', ai_generated: true },
            { path: 'otro/ref.jpg', url: 'https://x.test/y.jpg' }, { path: `${QID}/ref_2_1731600000002.jpg`, url: 'javascript:alert(1)' }] };
    const fresh = memoryStorage({ weotzi_quotation_reuse: JSON.stringify({ draft, expiresAt: Date.now() + 60000 }) });
    const first = ui({ storage: fresh });
    assert.equal(first.api.takeReuseHandoff().submission_key, KEY);
    assert.equal(first.api.takeReuseHandoff(), null, 'se consume');
    assert.equal(ui({ storage: memoryStorage({ weotzi_quotation_reuse: JSON.stringify({ draft, expiresAt: Date.now() - 1 }) }) }).api.takeReuseHandoff(), null, 'vencido');
    assert.equal(ui({ storage: memoryStorage({ weotzi_quotation_reuse: '{mal json' }) }).api.takeReuseHandoff(), null);
    assert.equal(ui({ storage: memoryStorage({ weotzi_quotation_reuse: JSON.stringify({ draft: { ...draft, submission_key: 'x' }, expiresAt: Date.now() + 60000 }) }) }).api.takeReuseHandoff(), null);

    const w = wizard();
    w.window.WoQuotationR2 = { takeReuseHandoff: () => draft };
    vm.runInContext(`_applyClientSessionPrefill = () => {}; buildScreensConfig = () => {}; getScreenIndexById = () => 3; findFirstIncompleteScreenIndex = () => 3;
        isScreenSkipped = () => false; screensConfig = [{}, {}, {}, {}]; renderCurrentStep = () => {}; updateBackButton = () => {}; showArtistSuggestions = () => {};`, w.context);
    assert.equal(vm.runInContext('applyReuseHandoff()', w.context), true);
    assert.equal(vm.runInContext('formData.submission_key', w.context), KEY);
    assert.equal(vm.runInContext('formData.quote_id', w.context), QID);
    assert.equal(vm.runInContext('formData.no_artist', w.context), true);
    assert.equal(vm.runInContext('formData.reused_from_code', w.context), 'B8M4RT');
    assert.equal(vm.runInContext('formData.stored_references.length', w.context), 1, 'solo paths del borrador con URL https');
    assert.equal(vm.runInContext('formData.reference_images_count', w.context), 1);
    assert.equal(vm.runInContext('currentStepIndex', w.context), 3);
    // En el envío las referencias guardadas viajan con su nota y marca, junto a las nuevas.
    w.window.ConfigManager = { getSupabaseClient: () => storageClient().client };
    w.context.extra = [{ name: 'n.jpg', type: 'image/jpeg' }];
    vm.runInContext(`uploadedFiles = extra; formData.reference_notes = ['nueva'];`, w.context);
    const upload = plain(await vm.runInContext(`uploadReferencesToStorage('${QID}')`, w.context));
    assert.deepEqual(upload.references.map((r) => [r.note, r.ai_generated]), [['nota', true], ['nueva', false]]);
    assert.equal(vm.runInContext('totalReferences()', w.context), 2);
    assert.deepEqual(plain(vm.runInContext('prepareIntakeExtrasPayload().reference_notes', w.context)), ['nota', 'nueva']);
});

// ---------------------------------------------------------------------------
// N11 · detalle del artista
// ---------------------------------------------------------------------------
test('N11: el detalle del artista dibuja las 4 referencias (antes 3 tarjetas fijas y un "+1")', () => {
    const src = read('public', 'shared', 'js', 'quotation-detail-figma.js');
    const start = src.indexOf('function referencesHtml(q) {');
    const end = src.indexOf('\n    }\n', start) + 6;
    assert.ok(start > 0 && end > start);
    const body = src.slice(start, end);
    assert.doesNotMatch(body, /Array\.from\(\{ length: 3 \}/);
    assert.doesNotMatch(body, /refs\.length - 3/);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const build = (attachments) => new Function('state', 'esc', 'icon', 'safeUrl', 'driveThumbnail', `${body}; return referencesHtml;`)(
        { attachments }, esc, () => '<i></i>', (u) => (/^https:/.test(u) ? u : ''), () => '');
    const urls = [1, 2, 3, 4].map((i) => `https://demo.supabase.test/storage/v1/object/public/quotation-references/QNx/ref_${i}.jpg`);
    // Como llega una cotización web: 4 adjuntos + las mismas 4 URLs en reference_images.
    const four = build(urls.map((u, i) => ({ google_drive_url: u, file_name: i === 3 ? 'Generada con IA · solo referencial (4)' : `ref_${i + 1}.jpg` })))({ reference_images: urls });
    assert.equal((four.match(/qd-reference-card has-image/g) || []).length, 4, 'se ven las 4, sin duplicar');
    assert.match(four, /Generada con IA · solo referencial \(4\)<\/span>/, 'la etiqueta de IA le llega al artista');
    const one = build([])({ reference_images: [urls[0]] });
    assert.equal((one.match(/qd-reference-card/g) || []).length, 3, 'con menos de 3 se mantienen los lugares vacíos del diseño');
    assert.equal((one.match(/has-image/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// Página, estilos, textos y migraciones
// ---------------------------------------------------------------------------
test('la página carga la capa de la ronda 2 antes de script.js', () => {
    const model = html.indexOf('/shared/js/quotation-r2-model.js');
    const uiScript = html.indexOf('/shared/js/quotation-r2.js');
    const app = html.indexOf('/shared/js/script.js');
    assert.ok(model > 0 && uiScript > model && app > uiScript);
    assert.ok(html.indexOf('/shared/js/quotation-slot.js') < model);
    assert.ok(html.indexOf('/shared/css/quotation-r2.css') > html.indexOf('/shared/css/quotation-ds.css"'), 'la capa nueva pisa a la base');
});

test('estilos de la ronda 2: tokens del DS (sin hex), responsive y foco visible', () => {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(css, /@media \(max-width: 768px\) \{/);
    assert.match(css, /@media \(max-width: 1024px\) \{\n\s*\.q-ok \{ grid-template-columns: 1fr;/);
    assert.match(css, /\.q-ok \{\n\s*display: grid;\n\s*grid-template-columns: minmax\(0, 1\.05fr\) minmax\(0, 0\.95fr\);/);
    assert.match(css, /\.q-r2-modal \{[^}]*max-height: min\(680px, calc\(100vh - 32px\)\)/, 'el modal entra en 720px de alto');
    assert.ok((css.match(/:focus-visible/g) || []).length >= 8);
    assert.match(css, /\.q-cal-day\.is-in-range \{/);
    assert.match(css, /\.q-ref-badge \{/);
});

test('textos nuevos en español neutro (tuteo, sin voseo)', () => {
    // Formas del voseo (agudas con tilde) y pronombres; el tuteo ("espera", "completa") no cuenta.
    const voseo = /(?<![a-záéíóúñ])(querés|podés|tenés|sabés|hacé|completá|revisá|iniciá|volvé|esperá|mirá|probá|subí|agregá|contá|escribí|ingresá|recargá|elegí|contanos|mostranos|decinos|fijate|acordate|vos)(?![a-záéíóúñ])/i;
    const strings = (source) => (source.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || []).join('\n');
    for (const [name, source] of [['quotation-r2.js', r2], ['quotation-r2-model.js', read('public', 'shared', 'js', 'quotation-r2-model.js')], ['wo-quote-reuse.js', reuse]]) {
        const hit = voseo.exec(strings(source));
        assert.equal(hit, null, `${name}: "${hit && hit[0]}"`);
    }
    // Textos nuevos dentro de archivos existentes.
    for (const text of ['Completa tu fecha de nacimiento: día, mes y año.', 'Los marcamos en rojo.', 'Tengo flexibilidad con las fechas',
        'Elige a qué otro artista enviársela o publica tu idea en el Job Board.']) assert.ok(script.includes(text), text);
    const serverRoutes = read('lib', 'routes', 'cot-form.js');
    for (const text of ['Inicia sesión con tu cuenta de cliente para reutilizar una solicitud.', 'Puedes subir tus propias referencias']) assert.ok(serverRoutes.includes(text), text);
});

test('migraciones de la ronda 2: en rango, idempotentes, con rollback y privilegios cerrados', () => {
    const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => /cot_form_r2/.test(f)).sort();
    assert.deepEqual(files, ['20261116110000_cot_form_r2_columnas.sql', '20261116110100_cot_form_r2_intake.sql', '20261116110200_cot_form_r2_vinculo_contacto.sql']);
    for (const file of files) {
        const stamp = Number(file.slice(0, 14));
        assert.ok(stamp >= 20261116110000 && stamp <= 20261116110999, file);
        assert.ok(fs.existsSync(path.join(root, 'supabase', 'rollbacks', file.replace(/\.sql$/, '.down.sql'))), `rollback de ${file}`);
        const sql = read('supabase', 'migrations', file);
        assert.match(sql, /^begin;$/m);
        assert.match(sql, /^commit;$/m);
    }
    const cols = read('supabase', 'migrations', files[0]);
    for (const col of ['short_code', 'client_is_minor', 'preferred_date_from', 'preferred_date_to', 'preferred_location_type', 'preferred_location_ref',
        'preferred_location_label', 'preferred_location_city', 'preferred_location_country', 'preferred_location_studio_id', 'reused_from_quote_id']) {
        assert.match(cols, new RegExp(`add column if not exists ${col} `), col);
    }
    assert.match(cols, /alter table public\.quotations_attachments\n\s*add column if not exists note text,\n\s*add column if not exists ai_generated boolean not null default false;/);
    assert.match(cols, /v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';/, 'sin 0, 1, I, L ni O');
    assert.match(cols, /create unique index if not exists quotations_db_short_code_key/);
    assert.match(cols, /set local session_replication_role = replica;[\s\S]*set local session_replication_role = origin;/, 'el backfill no toca updated_at');
    assert.match(cols, /if old\.short_code is not null then\n\s*new\.short_code := old\.short_code;/, 'el código no cambia');
    assert.match(cols, /new\.client_birth_date > \(current_date - interval '18 years'\)::date/);
    assert.match(cols, /drop trigger if exists trg_quotations_r2_server_fields on public\.quotations_db;/);
    // Mismo alfabeto en la base, el servidor y el navegador.
    assert.match(cols, /short_code ~ '\^\[2-9A-HJKMNP-Z\]\{6\}\$'/);
    assert.match(read('lib', 'cot-form.js'), /const SHORT_CODE_RE = \/\^\[2-9A-HJKMNP-Z\]\{6\}\$\/;/);

    const rpc = read('supabase', 'migrations', files[1]);
    assert.match(rpc, /create or replace function public\.save_web_quotation\(p_quote jsonb, p_extras jsonb\)/);
    assert.match(rpc, /'short_code', saved\.short_code/);
    assert.match(rpc, /reused_from_quote_id = coalesce\(excluded\.reused_from_quote_id, quotations_db\.reused_from_quote_id\)/);
    assert.match(rpc, /where quotations_db\.quote_status = 'in_progress'/);
    assert.match(rpc, /revoke all on function public\.save_web_quotation\(jsonb, jsonb\) from anon, authenticated;/);
    // Las columnas que manda el intake existen en el insert del RPC.
    for (const col of ['preferred_date_from', 'preferred_location_label', 'client_birth_date', 'tattoo_is_cover_up']) assert.match(rpc, new RegExp(`q\\.${col}\\b`));
    assert.match(read('supabase', 'rollbacks', files[1].replace(/\.sql$/, '.down.sql')), /return jsonb_build_object\('quote_id',saved\.quote_id,'status',saved\.quote_status\);/);

    const link = read('supabase', 'migrations', files[2]);
    assert.match(link, /create table if not exists public\.quotation_contact_links/);
    assert.match(link, /alter table public\.quotation_contact_links enable row level security;/);
    assert.match(link, /revoke all on table public\.quotation_contact_links from anon, authenticated;/);
    assert.doesNotMatch(link, /create policy/i, 'tabla privada: sin políticas');
    assert.match(link, /revoke all on function public\.link_quotation_contact\(text\) from anon, authenticated;/);
    assert.match(link, /u\.email_confirmed_at is not null/, 'solo cuentas con email verificado');
    assert.match(link, /qa_unverified_email/);
    assert.match(link, /join public\.clients_db c on c\.user_id = u\.id/);
    assert.doesNotMatch(link.slice(link.indexOf('if v_email <> \'\' then'), link.indexOf('return jsonb_build_object(\n    \'found\', true,')), /v_phone/, 'el teléfono nunca vincula a una cuenta');
    assert.match(link, /base\.artist_id = \(select auth\.uid\(\)\) and q\.artist_id = base\.artist_id/, 'el artista solo ve las suyas');
    assert.match(link, /revoke all on function public\.quotation_same_contact\(text\) from anon;/);
    assert.match(link, /security definer\nset search_path = ''/);
});

test('imágenes pendientes: el listado existe y es un arreglo', () => {
    const assets = JSON.parse(read('docs', 'plans', 'ronda2-assets', 'cot-form.json'));
    assert.ok(Array.isArray(assets));
    for (const a of assets) {
        assert.match(a.path, /^public\/shared\/assets\/ronda2\/cot-form\//);
        assert.ok(a.prompt && a.aspect && a.uso);
    }
});
