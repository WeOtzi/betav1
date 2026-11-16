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
    const cut = message(intakeError('No pudimos guardar tu solicitud. Intentá de nuevo.', 502, {}));
    assert.match(cut, /tardó demasiado o el servicio no respondió/);
    assert.doesNotMatch(cut, /guardar|Intentá/);
    // Sin conexión.
    const offline = message(intakeError('No hay conexión. Revisá tu internet y volvé a intentar.', 0, {}));
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
    for (const [page, scripts] of Object.entries(pages)) {
        const html = read('public', ...page.split('/'));
        for (const script of scripts) {
            assert.match(html, new RegExp(`/shared/js/${script.replace(/\./g, '\\.')}\\?v=20261116-r2c"`), `${page} → ${script}`);
        }
    }
});

test('textos legales y documentación: OpenAI es el proveedor de imágenes y sus variables están documentadas', () => {
    const privacy = read('public', 'legal', 'privacy', 'index.html');
    const terms = read('public', 'legal', 'terms', 'index.html');
    assert.match(privacy, /<th scope="row">OpenAI<\/th>/);
    assert.doesNotMatch(privacy, /Gemini/, 'Gemini ya no procesa datos de la plataforma');
    assert.match(privacy, /No le enviamos tu nombre, tu email ni tu dirección IP/);
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
    assert.match(technical, /POST \/api\/ai\/generate-image/);
    assert.match(read('docs', 'MAPA_APLICACION.md'), /\/api\/ai\/generate-image/);
});
