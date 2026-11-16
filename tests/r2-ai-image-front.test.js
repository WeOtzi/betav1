'use strict';
// Ronda 2 · IA de imágenes en el navegador tras el cambio de proveedor a
// OpenAI: los cuatro consumidores del endpoint genérico, el cotizador y el
// backoffice. Sin red ni navegador: contratos sobre el código y funciones
// ejecutadas en un contexto vm con fetch simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const admin = read('public', 'shared', 'js', 'admin.js');
const dashboard = read('public', 'shared', 'js', 'dashboard.js');
const jobBoard = read('public', 'shared', 'js', 'job-board-request.js');
const configManager = read('public', 'shared', 'js', 'config-manager.js');
const r2 = read('public', 'shared', 'js', 'quotation-r2.js');
const backoffice = read('public', 'backoffice', 'index.html');

const JPEG_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';

// Extrae una función declarada a nivel de archivo (termina en la primera "}" en columna 0).
function extract(source, signature) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `no se encontró ${signature}`);
    const end = source.indexOf('\n}\n', start);
    assert.ok(end > start, `no se encontró el final de ${signature}`);
    return source.slice(start, end + 2);
}

function jsonResponse(status, payload) {
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('los consumidores del endpoint genérico usan /api/ai/generate-image y ya no mandan campos de Gemini', () => {
    for (const [name, source] of [['admin.js', admin], ['dashboard.js', dashboard], ['job-board-request.js', jobBoard]]) {
        assert.match(source, /fetch\('\/api\/ai\/generate-image'/, name);
        assert.doesNotMatch(source, /\/api\/gemini\/generate-image/, `${name}: el alias histórico queda solo para JS en caché`);
        assert.doesNotMatch(source, /imageSize|maxOutputTokens|safetySettings|HARM_CATEGORY/, `${name}: sin parámetros propios de Gemini`);
        assert.doesNotMatch(source, /gemini-3-pro-image-preview|gemini-2\.5-flash-image/, `${name}: sin IDs de modelo de Gemini`);
        assert.match(source, /dos minutos/, `${name}: avisa que la generación puede tardar`);
        assert.doesNotMatch(source, /puede tardar unos segundos/, name);
        assert.match(source, /response\.json\(\)\.catch\(\(\) => null\)/, `${name}: una respuesta que no es JSON no rompe`);
    }
    // admin.js llama dos veces (ícono de zona y prueba de conexión) a través de un único helper.
    assert.equal(admin.match(/\/api\/ai\/generate-image/g).length, 1);
    assert.equal(admin.match(/await requestAiImage\(/g).length, 2);
    // El cotizador sigue con su propia ruta y la bandera pública de siempre.
    assert.match(r2, /cm\.getValue\('gemini\.enabled'\) === true/);
    assert.match(r2, /puede tardar hasta dos minutos/);
    assert.doesNotMatch(r2, /hasta un minuto/);
});

test('backoffice: requestAiImage manda prompt, proporción y modelo con la sesión; nunca una clave', async () => {
    const calls = [];
    const context = vm.createContext({
        _getApifyAuthHeaders: async () => ({ Authorization: 'Bearer token-admin' }),
        fetch: async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return context.next; },
        String, JSON, Error
    });
    vm.runInContext(extract(admin, 'async function requestAiImage('), context);

    context.next = jsonResponse(200, { success: true, image: JPEG_URL, mime_type: 'image/jpeg', provider: 'openai', model: 'gpt-image-2.6-sunburst' });
    const data = await vm.runInContext(`requestAiImage({ prompt: 'un círculo', model: 'gpt-image-2.6-sunburst' })`, context);
    assert.equal(data.image, JPEG_URL);
    assert.equal(data.provider, 'openai');
    assert.equal(calls[0].url, '/api/ai/generate-image');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer token-admin');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(calls[0].body, { prompt: 'un círculo', aspectRatio: '1:1', model: 'gpt-image-2.6-sunburst' });

    // Sin modelo elegido no se manda el campo; sin sesión no se manda Authorization.
    context._getApifyAuthHeaders = async () => ({ _noSession: true });
    await vm.runInContext(`requestAiImage({ prompt: 'p', aspectRatio: '3:4' })`, context);
    assert.deepEqual(calls[1].body, { prompt: 'p', aspectRatio: '3:4' });
    assert.ok(!('Authorization' in calls[1].opts.headers));
    assert.ok(!('_noSession' in calls[1].opts.headers));

    // Errores: el mensaje del servidor, o uno propio si la respuesta no es JSON (p. ej. el proxy cortó la espera).
    context.next = jsonResponse(503, { success: false, code: 'ai_unavailable', error: 'La generación de imágenes con IA no está disponible en este momento.' });
    await assert.rejects(vm.runInContext(`requestAiImage({ prompt: 'p' })`, context), /no está disponible/);
    context.next = { ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token L'); } };
    await assert.rejects(vm.runInContext(`requestAiImage({ prompt: 'p' })`, context), /no devolvió una imagen \(HTTP 502\)/);
    context.next = jsonResponse(200, { success: true, image: 'javascript:alert(1)' });
    await assert.rejects(vm.runInContext(`requestAiImage({ prompt: 'p' })`, context), /no devolvió una imagen/);
});

test('backoffice: el estado de la tarjeta sale del servidor (aiImages), no de una clave en el navegador', async () => {
    const statuses = [];
    const note = { textContent: '' };
    const context = vm.createContext({
        document: { getElementById: (id) => (id === 'api-gemini-provider' ? note : null) },
        updateAPIStatus: (api, status) => statuses.push([api, status]),
        fetch: async (url, opts) => { context.requested = { url, opts }; return context.next; },
        AI_IMAGE_PROVIDER_LABELS: { openai: 'OpenAI (GPT Image 2.6)', gemini: 'Gemini (proveedor heredado)', none: 'apagada' }
    });
    vm.runInContext(extract(admin, 'async function refreshAiImagesStatus('), context);

    context.next = jsonResponse(200, { aiImages: { enabled: true, provider: 'openai' } });
    await vm.runInContext('refreshAiImagesStatus()', context);
    assert.equal(context.requested.url, '/shared/js/app-config.json');
    assert.equal(context.requested.opts.cache, 'no-store');
    assert.deepEqual(statuses.pop(), ['gemini', 'configured']);
    assert.match(note.textContent, /Proveedor activo: OpenAI \(GPT Image 2\.6\)/);
    assert.match(note.textContent, /no se muestra aquí/);

    context.next = jsonResponse(200, { aiImages: { enabled: false, provider: 'openai' } });
    await vm.runInContext('refreshAiImagesStatus()', context);
    assert.deepEqual(statuses.pop(), ['gemini', 'none']);
    assert.match(note.textContent, /OPENAI_API_KEY/);

    context.next = jsonResponse(200, { aiImages: { enabled: false, provider: 'none' } });
    await vm.runInContext('refreshAiImagesStatus()', context);
    assert.match(note.textContent, /apagada en el servidor/);

    context.next = { ok: false, status: 500, json: async () => { throw new Error('x'); } };
    await vm.runInContext('refreshAiImagesStatus()', context);
    assert.deepEqual(statuses.pop(), ['gemini', 'none']);
    assert.match(note.textContent, /No pudimos consultar/);

    // La carga del panel y el guardado ya no leen ni guardan una clave.
    assert.doesNotMatch(admin, /api-gemini-key/);
    assert.doesNotMatch(admin, /config\.gemini\?\.apiKey/);
    assert.match(extract(admin, 'function saveGeminiAPI('), /apiKey: '',/, 'al guardar se limpia cualquier clave vieja del navegador');
    assert.match(extract(admin, 'async function testGeminiAPI('), /requestAiImage\(\{/);
    assert.doesNotMatch(extract(admin, 'async function testGeminiAPI('), /API Key/);
    assert.doesNotMatch(admin, /Gemini AI no está habilitado|Configuración de Gemini AI guardada/);
});

test('backoffice: la tarjeta muestra OpenAI, sus dos modelos y ningún campo para la clave', () => {
    assert.match(backoffice, /<h3>IA de imágenes \(OpenAI\)<\/h3>/);
    assert.doesNotMatch(backoffice, /Gemini AI \(Imágenes\)|Gemini 3 Pro|Gemini 2\.5|Nano Banana/);
    assert.doesNotMatch(backoffice, /id="api-gemini-key"|togglePassword\('api-gemini-key'\)/, 'la clave no se escribe en el navegador');
    assert.match(backoffice, /id="api-gemini-provider"/);
    assert.match(backoffice, /<option value="gpt-image-2\.6-flare">/);
    assert.match(backoffice, /<option value="gpt-image-2\.6-sunburst">/);
    assert.doesNotMatch(backoffice, /value="gemini-/);
    // Los controles que solo existían en Gemini quedan a la vista pero inactivos.
    for (const id of ['ai-profile-model', 'ai-profile-temp', 'ai-profile-tokens', 'ai-profile-res', 'ai-profile-filters']) {
        assert.match(backoffice, new RegExp(`id="${id}"[^>]*\\bdisabled\\b`), id);
    }
    assert.doesNotMatch(backoffice, /id="ai-profile-prompt"[^>]*disabled/, 'el prompt predeterminado se sigue aplicando');
    assert.match(backoffice, /onclick="testGeminiAPI\(\)"/);
    assert.match(backoffice, /onclick="saveGeminiAPI\(\)"/);
    assert.match(admin, /window\.testGeminiAPI = testGeminiAPI;/);
    assert.match(admin, /const AI_IMAGE_MODELS = \['gpt-image-2\.6-flare', 'gpt-image-2\.6-sunburst'\];/);
    // SCI-04: el check "Habilitar IA Generativa" solo escribía en este navegador (no apagaba
    // nada en la plataforma ni frenaba el gasto). Se quitó y el panel dice dónde se apaga.
    assert.doesNotMatch(backoffice, /api-gemini-enabled|Habilitar IA Generativa/);
    assert.doesNotMatch(admin, /api-gemini-enabled/);
    assert.match(backoffice, /Para apagarla en toda la plataforma, define <code>AI_IMAGE_PROVIDER=off<\/code>/);
    assert.doesNotMatch(extract(admin, 'function saveGeminiAPI(').replace(/^\s*\/\/.*$/gm, ''), /enabled/, 'guardar no escribe gemini.enabled');
});

// Carga config-manager.js en un contexto aislado con lo que publica el servidor
// (app-config.json) y lo que este navegador tenía guardado en localStorage.
async function loadConfigManager({ stored, server, fileStatus = 200 }) {
    const store = new Map();
    if (stored) store.set('weotzi_config', JSON.stringify(stored));
    const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
    const noop = () => {};
    const element = () => ({ style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop });
    const document = { addEventListener: noop, removeEventListener: noop, readyState: 'complete', currentScript: null, getElementById: () => null, querySelector: () => null,
        querySelectorAll: () => [], createElement: element, head: { appendChild: noop }, body: { appendChild: noop },
        documentElement: { style: {}, classList: { add: noop, remove: noop }, setAttribute: noop } };
    const location = { pathname: '/quotation', hostname: 'beta.weotzi.com', origin: 'https://beta.weotzi.com', href: 'https://beta.weotzi.com/quotation', search: '' };
    const window = { localStorage, document, location, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, navigator: { userAgent: 'test' } };
    window.window = window;
    const fetch = async () => ({ ok: fileStatus === 200, status: fileStatus, json: async () => JSON.parse(JSON.stringify(server)) });
    const quiet = { log: noop, warn: noop, error: noop, info: noop, debug: noop };
    const context = vm.createContext({ window, document, localStorage, location, fetch, console: quiet, setTimeout, clearTimeout, AbortController, URL, URLSearchParams,
        navigator: window.navigator, CustomEvent: function CustomEvent() {}, Event: function Event() {} });
    vm.runInContext(`${configManager}\n;globalThis.__CM = ConfigManager;`, context);
    const manager = context.__CM;
    await manager.init();
    return { manager, stored: () => (store.has('weotzi_config') ? JSON.parse(store.get('weotzi_config')) : null) };
}

test('config-manager: la IA de imágenes la decide el servidor, no lo guardado en el navegador (SCI-04)', async () => {
    assert.match(configManager, /const STORAGE_KEY = 'weotzi_config';/);
    const flags = async (options) => {
        const { manager } = await loadConfigManager(options);
        // Copia por JSON: los objetos del contexto vm tienen otro prototipo.
        return JSON.parse(JSON.stringify({ gemini: manager.getValue('gemini.enabled'), ai: manager.getValue('aiImages') }));
    };
    const on = { supabase: { url: 'https://x.supabase.co', anonKey: 'anon' }, gemini: { enabled: true }, aiImages: { enabled: true, provider: 'openai' } };
    const off = { ...on, gemini: { enabled: false }, aiImages: { enabled: false, provider: 'openai' } };
    const enabled = { gemini: true, ai: { enabled: true, provider: 'openai' } };
    const disabled = { gemini: false, ai: { enabled: false, provider: 'openai' } };

    assert.deepEqual(await flags({ stored: null, server: on }), enabled, 'visitante sin nada guardado');
    // El navegador del dueño: guardó la configuración en el backoffice cuando todavía no había clave.
    // Antes veía gemini.enabled=false y el cotizador no le mostraba "Generar referencia con IA".
    assert.deepEqual(await flags({ stored: { gemini: { model: 'gemini-3-pro-image-preview', enabled: false } }, server: on }), enabled);
    assert.deepEqual(await flags({ stored: { gemini: { enabled: false }, aiImages: { enabled: false, provider: 'openai' } }, server: on }), enabled);
    // Al revés: un "enabled" guardado no muestra el botón si el servidor no tiene clave (terminaba en 503).
    assert.deepEqual(await flags({ stored: { gemini: { enabled: true }, aiImages: { enabled: true, provider: 'gemini' } }, server: off }), disabled);
    assert.deepEqual(await flags({ stored: { gemini: { enabled: true } }, server: { ...on, gemini: { enabled: false }, aiImages: { enabled: false, provider: 'none' } } }),
        { gemini: false, ai: { enabled: false, provider: 'none' } }, 'apagada con AI_IMAGE_PROVIDER=off');
    // Un servidor viejo que solo publica gemini.enabled sigue valiendo.
    assert.deepEqual(await flags({ stored: { gemini: { enabled: false } }, server: { gemini: { enabled: true } } }), enabled);
    // Si app-config.json no se pudo leer, lo guardado no dice nada del servidor: queda apagada.
    assert.deepEqual(await flags({ stored: { gemini: { enabled: true }, aiImages: { enabled: true, provider: 'openai' } }, server: on, fileStatus: 500 }), disabled);

    // Lo demás que guarda el backoffice (modelo y estilo de los íconos) se conserva.
    const kept = await loadConfigManager({ stored: { gemini: { model: 'gpt-image-2.6-sunburst', defaultStyle: 'Line art', enabled: false } }, server: on });
    assert.equal(kept.manager.getValue('gemini.model'), 'gpt-image-2.6-sunburst');
    assert.equal(kept.manager.getValue('gemini.defaultStyle'), 'Line art');
    // Guardar desde el panel no cambia lo que decide el servidor en la próxima carga.
    kept.manager.update({ gemini: { defaultStyle: 'Dotwork' } });
    assert.deepEqual(await flags({ stored: kept.stored(), server: off }), disabled);

    // Una clave vieja de Gemini guardada por el backoffice anterior se borra del navegador.
    const legacy = await loadConfigManager({ stored: { gemini: { apiKey: 'AIza-clave-vieja-0123456789', enabled: true }, emailjs: { serviceId: 's' } }, server: on });
    assert.equal(legacy.manager.getValue('gemini.apiKey'), '');
    assert.doesNotMatch(JSON.stringify(legacy.stored()), /AIza-clave-vieja/);
    assert.equal(legacy.stored().emailjs.serviceId, 's', 'el resto de lo guardado no se toca');
    assert.doesNotMatch(JSON.stringify(legacy.manager.get()), /AIza-clave-vieja/);
    // Sin clave guardada no se reescribe el almacenamiento.
    const untouched = await loadConfigManager({ stored: null, server: on });
    assert.equal(untouched.stored(), null);
});

test('backoffice: "Probar" y "Generar" quedan deshabilitados y con el estado a la vista mientras dura la generación (SCI-05)', async () => {
    const fakeButton = () => ({ disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
    const pending = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    // --- Probar (genera una imagen real: cada clic se paga) ---
    const testButton = fakeButton();
    const statuses = [];
    const toasts = [];
    const requests = [];
    const elements = { 'api-gemini-model': { value: 'gpt-image-2.6-flare' }, 'api-gemini-test': testButton };
    const context = vm.createContext({
        document: { getElementById: (id) => elements[id] || null },
        updateAPIStatus: (api, status) => statuses.push([api, status]),
        showToast: (message, type) => toasts.push([type, message]),
        requestAiImage: (options) => { const p = pending(); requests.push({ options, ...p }); return p.promise; },
        AI_IMAGE_PROVIDER_LABELS: { openai: 'OpenAI (GPT Image 2.6)' },
        window: { ConfigManager: { get: () => ({ gemini: { enabled: true, model: 'gpt-image-2.6-flare', defaultStyle: 'Line art', defaultBackgroundColor: 'White' } }) } },
        console: { error() {}, log() {} }
    });
    vm.runInContext(extract(admin, 'function setAiImageButtonBusy('), context);
    vm.runInContext(extract(admin, 'let aiImageTestRunning = false;'), context);
    vm.runInContext(extract(admin, 'async function generateBodyPartIcon('), context);

    const first = vm.runInContext('testGeminiAPI()', context);
    const second = vm.runInContext('testGeminiAPI()', context);
    await settle();
    assert.equal(requests.length, 1, 'un segundo clic durante la espera no genera otra imagen');
    assert.equal(testButton.disabled, true);
    assert.equal(testButton.attrs['aria-busy'], 'true');
    assert.deepEqual(statuses, [['gemini', 'working']], 'el estado queda en "Generando…", no en "Sin configurar"');
    requests[0].resolve({ success: true, image: JPEG_URL, provider: 'openai', model: 'gpt-image-2.6-flare' });
    await Promise.all([first, second]);
    assert.equal(testButton.disabled, false);
    assert.ok(!('aria-busy' in testButton.attrs));
    assert.deepEqual(statuses.pop(), ['gemini', 'connected']);
    assert.match(toasts.pop()[1], /Conexión correcta: imagen generada con OpenAI \(GPT Image 2\.6\) · gpt-image-2\.6-flare\./);
    // Si falla, el botón también vuelve.
    const failing = vm.runInContext('testGeminiAPI()', context);
    await settle();
    assert.equal(testButton.disabled, true);
    requests[1].reject(new Error('La imagen tardó demasiado en generarse. Inténtalo de nuevo.'));
    await failing;
    assert.equal(testButton.disabled, false);
    assert.deepEqual(statuses.pop(), ['gemini', 'error']);
    assert.match(toasts.pop()[1], /tardó demasiado/);

    // El estado "working" existe en el indicador y avisa de la espera.
    const chip = { innerHTML: '', className: '' };
    const chipContext = vm.createContext({ document: { getElementById: (id) => (id === 'api-gemini-status' ? chip : null) } });
    vm.runInContext(extract(admin, 'function updateAPIStatus('), chipContext);
    vm.runInContext(`updateAPIStatus('gemini', 'working')`, chipContext);
    assert.match(chip.innerHTML, /Generando… puede tardar hasta dos minutos/);
    assert.doesNotMatch(chip.innerHTML, /Sin configurar/);

    // --- Generar ícono desde el formulario ---
    const generateButton = fakeButton();
    const note = { textContent: '' };
    Object.assign(elements, { 'ai-generate-btn': generateButton, 'ai-generate-status': note, 'node-label': { value: ' Brazo ' }, 'ai-style': { value: 'Line art' },
        'ai-bg': { value: 'White' }, 'node-image': { value: '' }, 'node-image-preview': { innerHTML: '' } });
    requests.length = 0;
    const iconA = vm.runInContext('generateBodyPartIcon()', context);
    await settle();
    assert.equal(generateButton.disabled, true);
    assert.equal(generateButton.attrs['aria-busy'], 'true');
    assert.match(note.textContent, /Generando… puede tardar hasta dos minutos/);
    const iconB = vm.runInContext('generateBodyPartIcon()', context);
    await settle();
    assert.equal(requests.length, 1, 'un segundo clic no genera otro ícono');
    requests[0].resolve({ success: true, image: JPEG_URL });
    await Promise.all([iconA, iconB]);
    assert.equal(elements['node-image'].value, JPEG_URL);
    assert.equal(generateButton.disabled, false);
    assert.ok(!('aria-busy' in generateButton.attrs));
    assert.equal(note.textContent, '');
    // La generación masiva (por nodo) no usa ni bloquea el botón del formulario.
    const batch = vm.runInContext(`generateBodyPartIcon({ label: 'Pierna' })`, context);
    await settle();
    assert.equal(generateButton.disabled, false);
    requests[1].resolve({ success: true, image: JPEG_URL });
    assert.equal(await batch, JPEG_URL);

    // Los botones existen con esos ids y el estado ocupado se ve.
    assert.match(backoffice, /<button type="button" class="btn btn-primary btn-sm" id="api-gemini-test" onclick="testGeminiAPI\(\)">/);
    assert.match(backoffice, /<span class="api-status" id="api-gemini-status" role="status" aria-live="polite">/, 'el estado de la prueba se anuncia');
    assert.match(admin, /id="ai-generate-btn" onclick="generateBodyPartIcon\(\)"/);
    assert.match(admin, /<p id="ai-generate-status" role="status" aria-live="polite"/);
    assert.match(read('public', 'shared', 'css', 'admin-styles.css'), /\.btn\[aria-busy="true"\] \{\n\s+opacity: 0\.6;\n\s+cursor: progress;\n\}/);
    for (const text of [note.textContent, chip.innerHTML]) assert.doesNotMatch(text, /cerrés|Esperá|podés/, 'sin voseo');
});

test('config-manager: sin IDs de Gemini por defecto y la salud ya no depende de una clave en el navegador', () => {
    assert.doesNotMatch(configManager, /gemini-3-pro-image-preview|gemini-2\.5-flash-image/);
    assert.doesNotMatch(configManager, /getValue\('gemini\.apiKey'\)/);
    assert.match(configManager, /aiImages: \{\n\s+enabled: false,\n\s+provider: 'openai'\n\s+\}/);
    assert.match(configManager, /configured: getValue\('aiImages\.enabled'\) === true \|\| getValue\('gemini\.enabled'\) === true/);
    assert.match(configManager, /model: 'gpt-image-2\.6-flare'/);
});

test('cotizador: el mensaje de error de la referencia con IA no cae al genérico de "guardar"', () => {
    const window = { WoQuotationR2Model: require('../public/shared/js/quotation-r2-model.js'), location: { pathname: '/quotation' }, ConfigManager: { getValue: () => true } };
    const context = vm.createContext({ window, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console, setTimeout, Promise, navigator: {}, Uint8Array, Date, JSON,
        atob: (s) => Buffer.from(s, 'base64').toString('binary') });
    vm.runInContext(r2, context);
    const message = window.WoQuotationR2.aiErrorMessage;
    const intakeError = (text, status, data) => Object.assign(new Error(text), { status, data: data || {} });

    // El servidor respondió con su propio mensaje: se muestra tal cual.
    assert.equal(message(intakeError('x', 504, { error: 'La imagen tardó demasiado en generarse. Inténtalo de nuevo.', code: 'ai_timeout' })),
        'La imagen tardó demasiado en generarse. Inténtalo de nuevo.');
    assert.match(message(intakeError('x', 429, { error: 'Llegaste al límite de imágenes generadas por ahora.' })), /límite de imágenes/);
    // Un proxy cortó la espera (502 sin JSON): no se muestra "No pudimos guardar tu solicitud".
    const cut = message(intakeError('No pudimos guardar tu solicitud. Intenta de nuevo.', 502, {}));
    assert.match(cut, /tardó demasiado o el servicio no respondió/);
    assert.doesNotMatch(cut, /guardar|Intenta/);
    // Sin conexión.
    const offline = message(intakeError('No hay conexión. Revisa tu internet y vuelve a intentar.', 0, {}));
    assert.equal(offline, 'No hay conexión. Revisa tu internet e inténtalo de nuevo.');
    // Errores locales del panel (sin status) conservan su texto.
    assert.equal(message(new Error('No pudimos generar la imagen. Inténtalo de nuevo.')), 'No pudimos generar la imagen. Inténtalo de nuevo.');
    assert.equal(message(null), 'No pudimos generar la imagen. Inténtalo de nuevo.');
    for (const text of [cut, offline]) assert.doesNotMatch(text, /Probá|Revisá|volvé|Intentá|podés/, 'español neutro con tuteo');
});

test('la imagen generada ya no se asume PNG: extensión y tipo siguen al contenido (JPEG con OpenAI)', () => {
    assert.doesNotMatch(dashboard, /ai-avatar-\$\{Date\.now\(\)\}\.png/);
    assert.doesNotMatch(extract(dashboard, 'async function useAIAvatar('), /contentType: 'image\/png'/);
    assert.match(dashboard, /contentType: avatarType/);
    assert.doesNotMatch(jobBoard, /'inspiracion-ia\.png'/);
    assert.match(jobBoard, /'inspiracion-ia\.' \+ aiExt/);
    // La respuesta solo se usa si es una data URL de imagen.
    assert.match(jobBoard, /AI_IMAGE_DATA_URL_RE\.test\(String\(data\.image \|\| ''\)\)/);
    assert.match(dashboard, /\/\^data:image\\\/\(png\|jpeg\|webp\);base64,\/\.test\(String\(data\.image \|\| ''\)\)/);
});

test('las páginas cargan la versión nueva de los scripts que cambiaron', () => {
    const pages = {
        'quotation/index.html': ['quotation-r2.js'],
        'artist/dashboard/index.html': ['dashboard.js', 'config-manager.js'],
        'artist/login/index.html': ['config-manager.js'],
        'backoffice/index.html': ['admin.js', 'config-manager.js']
    };
    // admin.js y config-manager.js volvieron a cambiar con las correcciones de la revisión (r2d).
    const version = { 'quotation-r2.js': '20261116-r2c', 'dashboard.js': '20261116-r2c', 'admin.js': '20261116-r2d', 'config-manager.js': '20261116-r2d' };
    for (const [page, scripts] of Object.entries(pages)) {
        const html = read('public', ...page.split('/'));
        for (const script of scripts) {
            assert.match(html, new RegExp(`/shared/js/${script.replace(/\./g, '\\.')}\\?v=${version[script]}"`), `${page} → ${script}`);
        }
    }
});

test('textos legales y documentación: OpenAI es el proveedor de imágenes y sus variables están documentadas', () => {
    const privacy = read('public', 'legal', 'privacy', 'index.html');
    const terms = read('public', 'legal', 'terms', 'index.html');
    assert.match(privacy, /<th scope="row">OpenAI<\/th>/);
    assert.doesNotMatch(privacy, /Gemini/, 'Gemini ya no procesa datos de la plataforma');
    // SCI-02: la negación vale para las imágenes, no para todo lo que se hace con OpenAI
    // (el bot del chat de soporte usa la misma clave y sí envía el nombre de perfil).
    assert.match(privacy, /Para generar imágenes no le enviamos tu nombre, tu email ni tu dirección IP/);
    assert.doesNotMatch(privacy, /\. No le enviamos tu nombre/, 'sin una negación general sobre OpenAI');
    assert.match(terms, /inteligencia artificial de OpenAI \(GPT Image\)/);
    assert.doesNotMatch(terms, /Gemini/);

    const env = read('.env.example');
    const deploy = read('deployments', 'DEPLOY.md');
    const technical = read('docs', 'TECHNICAL.md');
    for (const name of ['OPENAI_API_KEY', 'AI_IMAGE_PROVIDER', 'AI_IMAGE_MODEL', 'AI_REFERENCE_MODEL', 'AI_IMAGE_QUALITY', 'AI_IMAGE_TIMEOUT_MS']) {
        assert.match(env, new RegExp(`^${name}=$`, 'm'), `.env.example documenta ${name} sin valor`);
        assert.match(deploy, new RegExp('`' + name + '`'), `DEPLOY.md documenta ${name}`);
        assert.match(technical, new RegExp('`' + name + '`'), `TECHNICAL.md documenta ${name}`);
    }
    for (const doc of [env, deploy, technical]) {
        assert.match(doc, /gpt-image-2\.6-flare/);
        assert.match(doc, /verificaci[óo]n|Verificar la organización/, 'avisa que la organización de OpenAI puede necesitar verificación');
    }
    assert.doesNotMatch(env, /sk-[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_-]{10,}/, 'sin claves reales en el ejemplo');
    assert.match(deploy, /proxy PHP[^\n]*60 s/, 'DEPLOY.md avisa del corte del proxy a los 60 s');
    // SCI-02: cargar OPENAI_API_KEY también enciende el bot del chat de soporte. El alta obliga a
    // decidirlo antes, y lo que dice la guía tiene que seguir siendo cierto en server.js.
    assert.match(deploy, /\*\*Chat de soporte con IA — decidir antes de cargar la clave\.\*\*/);
    assert.match(deploy, /dejar `SUPPORT_CHAT_ENABLED=false`/);
    // Decisión tomada (16 nov 2026): el bot va, y la política lo declara desde su versión 1.1.
    assert.match(deploy, /la política ya lo declara desde su versión 1\.1/);
    assert.match(deploy, /20261116240000_terminos_version_privacidad_1_1\.sql/, 'la guía dice cómo subir la versión legal');
    assert.match(privacy, /Asistente automático del chat de soporte, solo cuando escribes en ese chat\./, 'lo que la guía afirma tiene que estar en la política');
    assert.match(env, /^SUPPORT_CHAT_ENABLED=false$/m);
    assert.match(env, /cargarla lo ENCIENDE/);
    assert.match(read('server.js'), /const SUPPORT_CHAT_ENABLED = \(process\.env\.SUPPORT_CHAT_ENABLED \|\| 'true'\) === 'true';/,
        'si cambia el valor por defecto del chat de soporte, hay que actualizar el paso 4 del alta en DEPLOY.md');
    assert.match(technical, /POST \/api\/ai\/generate-image/);
    assert.match(read('docs', 'MAPA_APLICACION.md'), /\/api\/ai\/generate-image/);
});
