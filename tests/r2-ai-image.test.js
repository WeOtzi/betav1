'use strict';
// Ronda 2 · IA de imágenes neutral de proveedor (lib/ai-image.js): OpenAI
// GPT Image 2.6 por defecto y Gemini como proveedor heredado. Sin red: todo
// pedido pasa por un fetch simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const aiImage = require('../lib/ai-image');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

// Ningún test puede salir a la red: si algo llama al fetch global, falla.
const realFetch = global.fetch;
test.before(() => { global.fetch = async () => { throw new Error('llamada de red real en un test'); }; });
test.after(() => { global.fetch = realFetch; });

const KEY = 'sk-test-0123456789abcdef';
const ENV = Object.freeze({ OPENAI_API_KEY: KEY });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString('base64');
const WEBP = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1').toString('base64');

function reply(status, payload) {
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function okReply(b64 = JPEG) {
    return reply(200, { created: 1, data: [{ b64_json: b64 }], output_format: 'jpeg', quality: 'medium', size: '1024x1024', usage: {} });
}

function recorder(response = okReply()) {
    const calls = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ url, opts, body: JSON.parse(opts.body) });
        return typeof response === 'function' ? response(url, opts) : response;
    };
    return { calls, fetchImpl };
}

function failsWith(expected) {
    return (error) => {
        for (const [key, value] of Object.entries(expected)) assert.equal(error[key], value, `${key}: ${JSON.stringify(error.detail || error.message)}`);
        assert.doesNotMatch(`${error.message} ${error.detail || ''}`, new RegExp(KEY.replace(/[-]/g, '\\-')), 'la clave nunca aparece en el error');
        return true;
    };
}

// ---------------------------------------------------------------------------
// Pedido a OpenAI
// ---------------------------------------------------------------------------
test('OpenAI: URL, cabeceras y cuerpo exactos del pedido; respuesta en image/jpeg', async () => {
    const { calls, fetchImpl } = recorder();
    const image = await aiImage.generateImage({ prompt: '  Una golondrina con rosas  ', aspectRatio: '1:1', userKey: 'borrador-1', env: ENV, fetchImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations');
    assert.equal(calls[0].opts.method, 'POST');
    assert.deepEqual(calls[0].opts.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    assert.ok(calls[0].opts.signal instanceof AbortSignal, 'el pedido se puede cortar por tiempo');
    assert.deepEqual(calls[0].body, {
        model: 'gpt-image-2.6-flare',
        prompt: 'Una golondrina con rosas',
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'jpeg',
        output_compression: 85,
        background: 'opaque',
        moderation: 'auto',
        safety_identifier: crypto.createHash('sha256').update('borrador-1').digest('hex')
    });
    assert.ok(!('response_format' in calls[0].body) && !('style' in calls[0].body), 'GPT Image no admite response_format ni style');
    assert.doesNotMatch(calls[0].url, /sk-/, 'la clave va en la cabecera, nunca en la URL');
    assert.doesNotMatch(calls[0].opts.body, /sk-|borrador-1/, 'ni la clave ni el identificador en claro viajan en el cuerpo');
    assert.deepEqual(image, { mimeType: 'image/jpeg', base64: JPEG, model: 'gpt-image-2.6-flare', provider: 'openai' });
});

test('OpenAI: sin userKey no se manda safety_identifier; con userKey va solo su SHA-256', async () => {
    const anon = recorder();
    await aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: anon.fetchImpl });
    assert.ok(!('safety_identifier' in anon.calls[0].body));
    const blank = recorder();
    await aiImage.generateImage({ prompt: 'p', userKey: '   ', env: ENV, fetchImpl: blank.fetchImpl });
    assert.ok(!('safety_identifier' in blank.calls[0].body));

    const personal = recorder();
    await aiImage.generateImage({ prompt: 'p', userKey: 'ana@example.test', env: ENV, fetchImpl: personal.fetchImpl });
    const sent = personal.calls[0].body.safety_identifier;
    assert.match(sent, /^[0-9a-f]{64}$/);
    assert.equal(sent, aiImage.safetyIdentifier('ana@example.test'));
    assert.doesNotMatch(personal.calls[0].opts.body, /ana@example\.test/, 'nunca un dato personal en claro');
    assert.equal(aiImage.safetyIdentifier(''), '');
    assert.equal(aiImage.safetyIdentifier(null), '');
});

test('OpenAI: mapa de proporciones a tamaños', async () => {
    const expected = {
        '1:1': '1024x1024',
        '4:3': '1536x1024', '3:2': '1536x1024', '16:9': '1536x1024',
        '3:4': '1024x1536', '2:3': '1024x1536', '9:16': '1024x1536'
    };
    for (const [aspect, size] of Object.entries(expected)) {
        assert.equal(aiImage.sizeForAspect(aspect), size, aspect);
        const { calls, fetchImpl } = recorder();
        await aiImage.generateImage({ prompt: 'p', aspectRatio: aspect, env: ENV, fetchImpl });
        assert.equal(calls[0].body.size, size, aspect);
    }
    for (const other of ['7:1', '21:9', '', undefined, null, 42, 'auto', 'constructor', '__proto__', '1024x1536']) {
        assert.equal(aiImage.sizeForAspect(other), '1024x1024', String(other));
    }
    assert.deepEqual([...aiImage.ASPECT_RATIOS].sort(), Object.keys(expected).sort());
});

test('OpenAI: lista blanca de modelos y calidad; lo desconocido cae al default sin romper', async () => {
    assert.deepEqual([...aiImage.OPENAI_MODELS], ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']);
    assert.equal(aiImage.OPENAI_DEFAULT_MODEL, 'gpt-image-2.6-flare');
    const sent = async (args, env = ENV) => {
        const { calls, fetchImpl } = recorder();
        const image = await aiImage.generateImage({ prompt: 'p', env, fetchImpl, ...args });
        assert.equal(image.model, calls[0].body.model);
        return calls[0].body;
    };
    assert.equal((await sent({ model: 'gpt-image-2.6-sunburst' })).model, 'gpt-image-2.6-sunburst');
    // Un ID viejo de Gemini (p. ej. AI_REFERENCE_MODEL sin actualizar) o cualquier texto raro: default.
    for (const bad of ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', '../../v1/files?x=', 'gpt-image-1', '', null, 7]) {
        assert.equal((await sent({ model: bad })).model, 'gpt-image-2.6-flare', String(bad));
    }
    // AI_IMAGE_MODEL es el general; el modelo pedido por la ruta (si es válido) gana.
    const general = { ...ENV, AI_IMAGE_MODEL: ' gpt-image-2.6-sunburst ' };
    assert.equal((await sent({}, general)).model, 'gpt-image-2.6-sunburst');
    assert.equal((await sent({ model: 'gemini-2.5-flash-image' }, general)).model, 'gpt-image-2.6-sunburst');
    assert.equal((await sent({ model: 'gpt-image-2.6-flare' }, general)).model, 'gpt-image-2.6-flare');
    assert.equal((await sent({}, { ...ENV, AI_IMAGE_MODEL: 'dall-e-3' })).model, 'gpt-image-2.6-flare');

    assert.equal((await sent({})).quality, 'medium');
    assert.equal((await sent({}, { ...ENV, AI_IMAGE_QUALITY: 'HIGH' })).quality, 'high');
    assert.equal((await sent({}, { ...ENV, AI_IMAGE_QUALITY: 'auto' })).quality, 'medium', 'auto no está en la lista: default');
    assert.equal((await sent({ quality: 'low' }, { ...ENV, AI_IMAGE_QUALITY: 'high' })).quality, 'low');
    assert.equal((await sent({ quality: 'ultra' }, { ...ENV, AI_IMAGE_QUALITY: 'high' })).quality, 'high');
});

test('OpenAI: el prompt se recorta al máximo de la API y uno vacío no llega al proveedor', async () => {
    const long = recorder();
    await aiImage.generateImage({ prompt: 'x'.repeat(40000), env: ENV, fetchImpl: long.fetchImpl });
    assert.equal(long.calls[0].body.prompt.length, 32000);
    for (const empty of ['', '   ', null, undefined]) {
        const { calls, fetchImpl } = recorder();
        await assert.rejects(aiImage.generateImage({ prompt: empty, env: ENV, fetchImpl }), failsWith({ code: 'invalid', status: 400 }));
        assert.equal(calls.length, 0);
    }
});

test('OpenAI: el tipo de la imagen sale de sus bytes (jpeg, png o webp)', async () => {
    for (const [b64, mime] of [[JPEG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp']]) {
        const image = await aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: recorder(okReply(b64)).fetchImpl });
        assert.equal(image.mimeType, mime);
        assert.equal(image.base64, b64);
    }
});

// ---------------------------------------------------------------------------
// Selección de proveedor
// ---------------------------------------------------------------------------
test('proveedor según variables: OpenAI por defecto, Gemini solo si se pide, apagado explícito', () => {
    const info = (env) => aiImage.providerInfo(env);
    assert.deepEqual(info({}), { provider: 'openai', configured: false, model: 'gpt-image-2.6-flare' });
    assert.deepEqual(info({ OPENAI_API_KEY: 'k' }), { provider: 'openai', configured: true, model: 'gpt-image-2.6-flare' });
    assert.deepEqual(info({ OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'g' }), { provider: 'openai', configured: true, model: 'gpt-image-2.6-flare' });
    // SCI-09: la clave de Gemini sola NO cambia de proveedor (los textos legales nombran a OpenAI).
    assert.deepEqual(info({ GEMINI_API_KEY: 'g' }), { provider: 'openai', configured: false, model: 'gpt-image-2.6-flare' });
    assert.deepEqual(info({ GEMINI_API_KEY: 'g', AI_IMAGE_PROVIDER: 'gemini' }), { provider: 'gemini', configured: true, model: 'gemini-2.5-flash-image' });
    assert.deepEqual(info({ OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'g', AI_IMAGE_PROVIDER: 'Gemini ' }), { provider: 'gemini', configured: true, model: 'gemini-2.5-flash-image' });
    assert.deepEqual(info({ OPENAI_API_KEY: 'k', AI_IMAGE_PROVIDER: 'gemini' }), { provider: 'gemini', configured: false, model: 'gemini-2.5-flash-image' });
    assert.deepEqual(info({ GEMINI_API_KEY: 'g', AI_IMAGE_PROVIDER: 'openai' }), { provider: 'openai', configured: false, model: 'gpt-image-2.6-flare' });
    assert.deepEqual(info({ OPENAI_API_KEY: 'k', AI_IMAGE_PROVIDER: 'cualquiera' }), { provider: 'openai', configured: true, model: 'gpt-image-2.6-flare' });
    assert.deepEqual(info({ OPENAI_API_KEY: 'k', AI_IMAGE_MODEL: 'gpt-image-2.6-sunburst' }), { provider: 'openai', configured: true, model: 'gpt-image-2.6-sunburst' });
    assert.deepEqual(info({ OPENAI_API_KEY: '   ' }), { provider: 'openai', configured: false, model: 'gpt-image-2.6-flare' }, 'una clave en blanco no cuenta');
    for (const off of ['off', 'none', 'OFF', 'disabled']) {
        assert.deepEqual(info({ OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'g', AI_IMAGE_PROVIDER: off }), { provider: 'none', configured: false, model: null });
    }
    assert.equal(aiImage.isConfigured({ OPENAI_API_KEY: 'k' }), true);
    assert.equal(aiImage.isConfigured({ GEMINI_API_KEY: 'g' }), false);
    assert.equal(aiImage.isConfigured({ GEMINI_API_KEY: 'g', AI_IMAGE_PROVIDER: 'gemini' }), true);
    assert.equal(aiImage.isConfigured({}), false);
    assert.equal(aiImage.isConfigured({ OPENAI_API_KEY: 'k', AI_IMAGE_PROVIDER: 'off' }), false);
    assert.doesNotMatch(JSON.stringify(info({ OPENAI_API_KEY: KEY })), /sk-/, 'providerInfo nunca incluye la clave');
});

test('Gemini heredado: delega en lib/gemini-image.js con su URL y su cabecera', async () => {
    const seen = [];
    const fetchImpl = async (url, opts) => {
        seen.push({ url, opts });
        return reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }] });
    };
    const GEMINI_ENV = { GEMINI_API_KEY: 'g-key', AI_IMAGE_PROVIDER: 'gemini' };
    const image = await aiImage.generateImage({ prompt: 'p', model: 'gpt-image-2.6-flare', aspectRatio: '3:4', userKey: 'u', env: GEMINI_ENV, fetchImpl });
    assert.deepEqual(image, { mimeType: 'image/png', base64: 'QUJD', model: 'gemini-2.5-flash-image', provider: 'gemini' });
    assert.equal(seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent');
    assert.equal(seen[0].opts.headers['x-goog-api-key'], 'g-key');
    assert.equal(JSON.parse(seen[0].opts.body).generationConfig.imageConfig.aspectRatio, '3:4');

    // OAI-06: toda proporción que acepta el guard llega a Gemini como una que Gemini conoce
    // (3:2 y 2:3 van a la más cercana; antes caían a 1:1 sin avisar).
    const sentAspect = { '1:1': '1:1', '4:3': '4:3', '3:2': '4:3', '16:9': '16:9', '3:4': '3:4', '2:3': '3:4', '9:16': '9:16' };
    assert.deepEqual(Object.keys(sentAspect).sort(), [...aiImage.ASPECT_RATIOS].sort());
    for (const [asked, sent] of Object.entries(sentAspect)) {
        seen.length = 0;
        await aiImage.generateImage({ prompt: 'p', aspectRatio: asked, env: GEMINI_ENV, fetchImpl });
        assert.equal(JSON.parse(seen[0].opts.body).generationConfig.imageConfig.aspectRatio, sent, asked);
    }
    seen.length = 0;
    await aiImage.generateImage({ prompt: 'p', env: GEMINI_ENV, fetchImpl });
    assert.equal(JSON.parse(seen[0].opts.body).generationConfig.imageConfig.aspectRatio, '1:1', 'sin proporción: cuadrado');

    // Con las dos claves y sin AI_IMAGE_PROVIDER, manda OpenAI.
    const both = recorder();
    const viaOpenAi = await aiImage.generateImage({ prompt: 'p', env: { OPENAI_API_KEY: KEY, GEMINI_API_KEY: 'g-key' }, fetchImpl: both.fetchImpl });
    assert.equal(viaOpenAi.provider, 'openai');
    assert.equal(both.calls[0].url, 'https://api.openai.com/v1/images/generations');

    // SCI-09: con SOLO la clave de Gemini (sin AI_IMAGE_PROVIDER) no se genera con Google.
    seen.length = 0;
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: { GEMINI_API_KEY: 'g-key' }, fetchImpl }), (e) => e.code === 'not_configured' && e.status === 503);
    assert.equal(seen.length, 0, 'ningún pedido a Gemini');

    // El 429 de Gemini sale con el mismo código que el de OpenAI.
    await assert.rejects(
        aiImage.generateImage({ prompt: 'p', env: GEMINI_ENV, fetchImpl: async () => reply(429, { error: { message: 'quota' } }) }),
        (e) => e.status === 429 && e.code === 'rate_limited' && e.providerStatus === 429);
});

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------
test('sin clave: not_configured (503) y ningún pedido al proveedor', async () => {
    for (const env of [{}, { OPENAI_API_KEY: '' }, { OPENAI_API_KEY: KEY, AI_IMAGE_PROVIDER: 'off' }, { OPENAI_API_KEY: KEY, AI_IMAGE_PROVIDER: 'gemini' }, { GEMINI_API_KEY: 'g' }, null]) {
        const { calls, fetchImpl } = recorder();
        await assert.rejects(aiImage.generateImage({ prompt: 'p', env, fetchImpl }), (e) => e.code === 'not_configured' && e.status === 503);
        assert.equal(calls.length, 0);
    }
    // La clave no se acepta por parámetro: solo del entorno.
    const { calls, fetchImpl } = recorder();
    await assert.rejects(aiImage.generateImage({ prompt: 'p', apiKey: KEY, env: {}, fetchImpl }), (e) => e.code === 'not_configured');
    assert.equal(calls.length, 0);
});

test('400 con contenido bloqueado: blocked (422), con code, con type o solo con el mensaje', async () => {
    const run = (payload) => aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: async () => reply(400, payload) });
    for (const payload of [
        { error: { message: 'Your request was rejected by the safety system.', type: 'image_generation_user_error', code: 'moderation_blocked' } },
        { error: { message: 'Rejected.', type: 'invalid_request_error', code: 'content_policy_violation' } },
        { error: { message: 'x', type: 'image_generation_user_error' } },
        { error: { message: 'Your request was rejected as a result of our safety system.' } },
        { error: { message: 'This request violates our content policy.', type: 'invalid_request_error', code: 'codigo_nuevo', param: null } },
        { error: { code: 'moderation_blocked' } }
    ]) {
        await assert.rejects(run(payload), failsWith({ code: 'blocked', status: 422, providerStatus: 400 }));
    }
    // Un 400 que NO es de contenido (parámetro o modelo inválido) es un fallo de integración, no del usuario.
    for (const payload of [
        { error: { message: "Invalid value: 'gpt-image-9'.", type: 'invalid_request_error', code: 'invalid_value' } },
        { error: { message: 'Billing hard limit has been reached', type: 'invalid_request_error', code: 'billing_hard_limit_reached' } },
        // OAI-02 / SCI-06: el pedido siempre lleva moderation:'auto'. Si la API rechaza ese
        // parámetro, el mensaje lo nombra y no por eso es "contenido bloqueado".
        { error: { message: "Unknown parameter: 'moderation'.", type: 'invalid_request_error', param: 'moderation', code: 'unknown_parameter' } },
        { error: { message: "Invalid value: 'auto'. Supported values for 'moderation' are: 'low'.", type: 'invalid_request_error', param: 'moderation', code: 'invalid_value' } },
        { error: { message: "Unsupported parameter: 'moderation' is not supported with this model.", type: 'invalid_request_error', param: 'moderation', code: 'unsupported_parameter' } },
        { error: { message: "Unknown parameter: 'moderation'." } },
        // Con `param` o con un código de pedido inválido, el mensaje no se interpreta.
        { error: { message: "Invalid 'moderation': see the content policy guide.", type: 'invalid_request_error', param: 'moderation' } },
        { error: { message: 'The model does not exist. See our content policy.', code: 'model_not_found' } },
        { error: 'bad request' },
        {},
        null
    ]) {
        await assert.rejects(run(payload), failsWith({ code: 'provider', status: 502, providerStatus: 400 }), JSON.stringify(payload));
    }
});

test('el detalle para el log lleva el id del pedido y la etapa del bloqueo, antes del mensaje y sin la clave', async () => {
    // OAI-04: x-request-id y error.moderation_details (solo etapa y categorías, acotadas).
    const withHeaders = (status, payload, id) => ({ ...reply(status, payload), headers: { get: (name) => (String(name).toLowerCase() === 'x-request-id' ? id : null) } });
    const blocked = async () => withHeaders(400, { error: {
        message: `Your request was rejected by the safety system. ${'x'.repeat(400)}`, type: 'image_generation_user_error', code: 'moderation_blocked',
        moderation_details: { moderation_stage: 'input', categories: ['sexual', 'violence/graphic', 'con espacios <b>', 42], otro: `dato ${KEY}` }
    } }, 'req_abc123DEF');
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: blocked }), (e) => {
        failsWith({ code: 'blocked', status: 422, providerStatus: 400, requestId: 'req_abc123DEF', moderationStage: 'input' })(e);
        assert.match(e.detail, /^HTTP 400 moderation_blocked req=req_abc123DEF etapa=input categorias=sexual,violence\/graphic,conespaciosb: Your request was rejected/);
        assert.ok(e.detail.length <= 300, 'el detalle sigue acotado');
        assert.doesNotMatch(e.message, /req_|etapa|sexual/, 'el mensaje público no trae nada de esto');
        return true;
    });
    // Un id con caracteres raros se limpia y se acorta; sin id no aparece "req=".
    const weird = async () => withHeaders(500, { error: { message: 'boom' } }, `req\r\nx-evil: 1 ${'z'.repeat(200)}`);
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: weird }), (e) => {
        assert.match(e.detail, /^HTTP 500 req=reqx-evil1z+: boom$/);
        assert.equal(e.requestId.length, 64);
        return true;
    });
    for (const headers of [undefined, null, {}, { get: () => null }, { get: () => 42 }]) {
        const plain = async () => ({ ...reply(403, { error: { message: 'no', code: 'x' } }), headers });
        await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: plain }), (e) => e.detail === 'HTTP 403 x: no' && !('requestId' in e));
    }
    // moderation_details con forma inesperada no rompe ni ensucia el detalle.
    for (const details of ['texto', 7, [], { moderation_stage: {}, categories: 'sexual' }, { categories: [] }]) {
        const odd = async () => reply(400, { error: { message: 'no', code: 'moderation_blocked', moderation_details: details } });
        await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: odd }), (e) => e.code === 'blocked' && e.detail === 'HTTP 400 moderation_blocked: no');
    }
    // Una respuesta 200 inservible también deja el id para reclamar.
    const empty = async () => withHeaders(200, { data: [] }, 'req_200');
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: empty }), (e) => e.code === 'provider' && /sin data\[0\]\.b64_json req=req_200$/.test(e.detail));
});

test('isRefundable: el cupo diario solo se devuelve si consta que el proveedor no generó nada', async () => {
    const failure = async (fetchImpl, extra = {}) => {
        try { await aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl, ...extra }); } catch (error) { return error; }
        throw new Error('debía fallar');
    };
    // Rechazos 4xx: contenido bloqueado, clave, verificación, cuota.
    for (const [status, payload] of [
        [400, { error: { code: 'moderation_blocked' } }], [400, { error: { code: 'invalid_value', param: 'size' } }],
        [401, { error: { code: 'invalid_api_key' } }], [403, { error: { message: 'verify' } }], [429, { error: { code: 'insufficient_quota' } }]
    ]) {
        assert.equal(aiImage.isRefundable(await failure(async () => reply(status, payload))), true, `HTTP ${status}`);
    }
    // El pedido no salió: sin clave, prompt vacío o fallo al conectar.
    assert.equal(aiImage.isRefundable(await failure(async () => okReply(), { env: {} })), true);
    assert.equal(aiImage.isRefundable(await failure(async () => okReply(), { prompt: ' ' })), true);
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']) {
        const error = await failure(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code } }); });
        assert.equal(error.notSent, true, code);
        assert.equal(aiImage.isRefundable(error), true, code);
    }
    // Pudo generarse (y cobrarse): vencimiento, 5xx, corte a mitad de camino, 200 inservible, bloqueo de salida.
    const hang = (url, opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    assert.equal(aiImage.isRefundable(await failure(hang, { timeoutMs: 20 })), false, 'timeout');
    for (const status of [500, 502, 503]) assert.equal(aiImage.isRefundable(await failure(async () => reply(status, null))), false, `HTTP ${status}`);
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', '']) {
        const error = await failure(async () => { throw Object.assign(new TypeError('fetch failed'), code ? { cause: { code } } : {}); });
        assert.equal(aiImage.isRefundable(error), false, code || 'sin causa');
    }
    assert.equal(aiImage.isRefundable(await failure(async () => reply(200, { data: [] }))), false, '200 sin imagen');
    assert.equal(aiImage.isRefundable(await failure(async () => okReply('QUJD'))), false, '200 con algo que no es imagen');
    const output = await failure(async () => reply(400, { error: { code: 'moderation_blocked', moderation_details: { moderation_stage: 'output' } } }));
    assert.equal(output.code, 'blocked');
    assert.equal(aiImage.isRefundable(output), false, 'bloqueo sobre la imagen ya generada');
    // Errores sin forma conocida: no se devuelve.
    for (const unknown of [null, undefined, {}, new Error('x'), { code: 'provider', status: 502 }, { code: 'blocked', status: 422 }]) {
        assert.equal(aiImage.isRefundable(unknown), false);
    }
    // Proveedor heredado: su 4xx también cuenta; su "sin imagen" (respuesta 200) no.
    const gemini = { GEMINI_API_KEY: 'g', AI_IMAGE_PROVIDER: 'gemini' };
    assert.equal(aiImage.isRefundable(await failure(async () => reply(429, { error: { message: 'quota' } }), { env: gemini })), true);
    assert.equal(aiImage.isRefundable(await failure(async () => reply(200, { candidates: [] }), { env: gemini })), false);
});

test('401 y 403: provider (502); el detalle queda para el log sin la clave', async () => {
    const unauthorized = async () => reply(401, { error: { message: `Incorrect API key provided: ${KEY}. You can find your API key at https://platform.openai.com.`, type: 'invalid_request_error', code: 'invalid_api_key' } });
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: unauthorized }), (e) => {
        failsWith({ code: 'provider', status: 502, providerStatus: 401, providerCode: 'invalid_api_key' })(e);
        assert.match(e.detail, /^HTTP 401 invalid_api_key: Incorrect API key provided: \[clave\]/);
        assert.doesNotMatch(e.message, /Incorrect|invalid_api_key|401/, 'el mensaje público no trae el detalle del proveedor');
        return true;
    });
    // OpenAI suele devolver la clave enmascarada: tampoco queda en el detalle.
    const masked = async () => reply(401, { error: { message: 'Incorrect API key provided: sk-proj-********************cdef.', code: 'invalid_api_key' } });
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: masked }), (e) => !/sk-proj|cdef/.test(e.detail) && /\[clave\]/.test(e.detail));

    const forbidden = async () => reply(403, { error: { message: 'Your organization must be verified to use the model `gpt-image-2.6-flare`.', type: 'invalid_request_error', code: null } });
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: forbidden }), (e) => {
        failsWith({ code: 'provider', status: 502, providerStatus: 403, providerCode: 'invalid_request_error' })(e);
        assert.match(e.detail, /^HTTP 403 invalid_request_error: Your organization must be verified/);
        return true;
    });
});

test('429: límite o cuota → 429 (rate_limited) con el código del proveedor en el detalle', async () => {
    for (const code of ['insufficient_quota', 'rate_limit_exceeded']) {
        const fetchImpl = async () => reply(429, { error: { message: 'You exceeded your current quota.', type: code, code } });
        await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl }), (e) => {
            failsWith({ code: 'rate_limited', status: 429, providerStatus: 429, providerCode: code })(e);
            assert.match(e.detail, new RegExp(`^HTTP 429 ${code}: `));
            return true;
        });
    }
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: async () => reply(429, null) }), failsWith({ code: 'rate_limited', status: 429 }));
});

test('5xx, cuerpo que no es JSON y fallo de red: provider (502)', async () => {
    for (const status of [500, 502, 503, 404]) {
        const fetchImpl = async () => reply(status, { error: { message: 'The server had an error.', type: 'server_error' } });
        await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl }), failsWith({ code: 'provider', status: 502, providerStatus: status }));
    }
    const html = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: html }), (e) => e.code === 'provider' && e.status === 502 && e.detail === 'HTTP 502');
    const network = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: network }), (e) => e.code === 'provider' && e.status === 502 && /ENOTFOUND/.test(e.detail));
});

test('timeout: 504 al cortar por tiempo, también si se corta mientras llega el cuerpo', async () => {
    // El proveedor nunca responde: el AbortController corta el pedido.
    const hang = (url, opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
    });
    const started = Date.now();
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: hang, timeoutMs: 20 }), failsWith({ code: 'timeout', status: 504 }));
    assert.ok(Date.now() - started < 2000);
    // Llegan las cabeceras pero el cuerpo se queda a medias.
    const slowBody = async (url, opts) => ({ ok: true, status: 200, json: () => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: slowBody, timeoutMs: 20 }), failsWith({ code: 'timeout', status: 504 }));
    // AbortSignal.timeout usa TimeoutError: mismo resultado.
    const timeoutError = async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: timeoutError }), failsWith({ code: 'timeout', status: 504 }));
    // AI_IMAGE_TIMEOUT_MS: default 120000; un valor inválido no rompe.
    assert.equal(aiImage.DEFAULT_TIMEOUT_MS, 120000);
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: { ...ENV, AI_IMAGE_TIMEOUT_MS: '1000' }, fetchImpl: hang }), failsWith({ code: 'timeout', status: 504 }));
    const image = await aiImage.generateImage({ prompt: 'p', env: { ...ENV, AI_IMAGE_TIMEOUT_MS: 'abc' }, fetchImpl: recorder().fetchImpl });
    assert.equal(image.provider, 'openai');
});

test('timeout: un valor enorme se acota en vez de cortar al instante', async () => {
    // OAI-03: por encima de 2^31-1 ms Node dispara el temporizador a 1 ms y todo daba 504.
    assert.equal(aiImage.MAX_TIMEOUT_MS, 280000);
    assert.ok(aiImage.MAX_TIMEOUT_MS < 300000 && aiImage.MAX_TIMEOUT_MS >= aiImage.DEFAULT_TIMEOUT_MS);
    // El proveedor tarda un poco (más que 1 ms) y respeta la señal de corte.
    const slow = (url, opts) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(okReply()), 40);
        opts.signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
    const warnings = [];
    const onWarning = (warning) => warnings.push(warning.name);
    process.on('warning', onWarning);
    try {
        for (const value of ['3000000000', '2147483648', '999999999999']) {
            const image = await aiImage.generateImage({ prompt: 'p', env: { ...ENV, AI_IMAGE_TIMEOUT_MS: value }, fetchImpl: slow });
            assert.equal(image.provider, 'openai', `AI_IMAGE_TIMEOUT_MS=${value}`);
        }
        for (const timeoutMs of [3000000000, 2147483648, Number.MAX_SAFE_INTEGER]) {
            const image = await aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: slow, timeoutMs });
            assert.equal(image.provider, 'openai', `timeoutMs=${timeoutMs}`);
        }
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
        process.removeListener('warning', onWarning);
    }
    assert.ok(!warnings.includes('TimeoutOverflowWarning'), 'el temporizador nunca se arma con un valor fuera de rango');
});

test('base64 inválido, imagen que no es imagen o demasiado grande: provider (502)', async () => {
    const run = (b64) => aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: async () => okReply(b64) });
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
    for (const bad of ['no es base64 !!', `${JPEG}\n${JPEG}`, `data:image/jpeg;base64,${JPEG}`, '====', html, svg, 'QUJD']) {
        await assert.rejects(run(bad), failsWith({ code: 'provider', status: 502 }), bad.slice(0, 20));
    }
    const huge = JPEG.replace(/=+$/, '') + 'A'.repeat(aiImage.MAX_IMAGE_BASE64);
    await assert.rejects(run(huge), failsWith({ code: 'provider', status: 502 }));
    assert.equal(aiImage.MAX_IMAGE_BASE64, require('../lib/gemini-image').MAX_IMAGE_BASE64, 'mismo tope que el proveedor heredado');
});

test('respuesta 200 sin data: provider (502)', async () => {
    for (const payload of [{}, { data: [] }, { data: [{}] }, { data: [{ url: 'https://x.test/a.png' }] }, { data: [{ b64_json: 42 }] }, { data: 'x' }, null]) {
        await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: async () => reply(200, payload) }),
            failsWith({ code: 'provider', status: 502 }), JSON.stringify(payload));
    }
    const notJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
    await assert.rejects(aiImage.generateImage({ prompt: 'p', env: ENV, fetchImpl: notJson }), failsWith({ code: 'provider', status: 502 }));
});

// ---------------------------------------------------------------------------
// Chequeo de salud (sin generar imágenes)
// ---------------------------------------------------------------------------
test('salud: consulta el modelo activo sin gastar cuota y nunca devuelve la clave ni el texto del proveedor', async () => {
    assert.deepEqual(await aiImage.checkHealth({ env: {}, fetchImpl: async () => { throw new Error('no debería llamar'); } }),
        { status: 'unconfigured', metadata: { provider: 'openai', model: 'gpt-image-2.6-flare' } });
    assert.deepEqual(await aiImage.checkHealth({ env: { OPENAI_API_KEY: KEY, AI_IMAGE_PROVIDER: 'off' }, fetchImpl: async () => { throw new Error('no debería llamar'); } }),
        { status: 'unconfigured', metadata: { provider: 'none' } });

    const seen = [];
    const ok = async (url, opts) => { seen.push({ url, opts }); return reply(200, { id: 'gpt-image-2.6-flare' }); };
    assert.deepEqual(await aiImage.checkHealth({ env: ENV, fetchImpl: ok }), { status: 'healthy', metadata: { provider: 'openai', model: 'gpt-image-2.6-flare' } });
    assert.equal(seen[0].url, 'https://api.openai.com/v1/models/gpt-image-2.6-flare');
    assert.equal(seen[0].opts.method, 'GET');
    assert.deepEqual(seen[0].opts.headers, { Authorization: `Bearer ${KEY}` });

    const gemini = [];
    await aiImage.checkHealth({ env: { GEMINI_API_KEY: 'g-key', AI_IMAGE_PROVIDER: 'gemini' }, fetchImpl: async (url, opts) => { gemini.push({ url, opts }); return reply(200, {}); } });
    assert.doesNotMatch(gemini[0].url, /g-key|key=/, 'la clave de Gemini va en la cabecera, no en la URL');
    assert.equal(gemini[0].opts.headers['x-goog-api-key'], 'g-key');
    // Con solo la clave de Gemini no hay proveedor configurado: ni siquiera se consulta.
    assert.deepEqual(await aiImage.checkHealth({ env: { GEMINI_API_KEY: 'g-key' }, fetchImpl: async () => { throw new Error('no debería llamar'); } }),
        { status: 'unconfigured', metadata: { provider: 'openai', model: 'gpt-image-2.6-flare' } });

    // OAI-05: el 401 también llega con una clave válida sin permiso de lectura de modelos.
    for (const [status, hint] of [[401, /clave fue rechazada o no tiene permiso para consultar modelos/], [403, /verificación/], [404, /modelo no existe/], [429, /cuota/], [500, /HTTP 500/]]) {
        const fetchImpl = async () => reply(status, { error: { message: `Incorrect API key provided: ${KEY}` } });
        await assert.rejects(aiImage.checkHealth({ env: ENV, fetchImpl }), (e) => {
            assert.match(e.message, new RegExp(`OpenAI respondió HTTP ${status}`));
            assert.match(e.message, hint);
            assert.doesNotMatch(e.message, /sk-|Incorrect/);
            return true;
        });
    }
    await assert.rejects(aiImage.checkHealth({ env: ENV, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /No pudimos conectar con OpenAI/);
    await assert.rejects(aiImage.checkHealth({ env: ENV, fetchImpl: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } }), /no respondió a tiempo/);
});

test('el módulo no registra la clave ni lee nada del body', () => {
    // Solo el código: los comentarios pueden nombrar lo que NO se envía.
    const source = read('lib', 'ai-image.js').replace(/^\s*(\/\/|\/\*|\*).*$/gm, '');
    assert.doesNotMatch(source, /console\.(log|info|warn|error|debug)/, 'el módulo no escribe logs: el detalle lo decide la ruta');
    assert.doesNotMatch(source, /req\.body|apiKey\s*=\s*process\.env/, 'la clave sale solo del env recibido');
    assert.doesNotMatch(source, /response_format|\bstyle\b/);
});

// ---------------------------------------------------------------------------
// Endpoint genérico (lib/routes/ai-image.js)
// ---------------------------------------------------------------------------
const express = require('express');
const endpoint = require('../lib/routes/ai-image');
const cotFormRoutes = require('../lib/routes/cot-form');
const { listRegisteredRoutes } = require('../lib/registered-routes');

function fakeRes() {
    return { statusCode: 200, body: null, headers: {},
        set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; } };
}

test('endpoint genérico: /api/ai/generate-image y el alias /api/gemini/generate-image comparten guard y handler', () => {
    assert.deepEqual([...endpoint.PATHS], ['/api/ai/generate-image', '/api/gemini/generate-image']);
    const calls = [];
    const guard = [() => {}, () => {}];
    endpoint.register({ post: (...args) => calls.push(args) }, { guard });
    assert.deepEqual(calls.map((c) => c[0]), ['/api/ai/generate-image', '/api/gemini/generate-image']);
    assert.equal(calls[0][1], guard);
    assert.equal(calls[1][1], guard, 'el mismo guard: comparten el límite por IP y el tope diario');
    assert.equal(calls[0][2], calls[1][2], 'el mismo handler');
    assert.equal(typeof calls[0][2], 'function');

    // Sin deps usa el guard real del proceso (el mismo que antes protegía la ruta de Gemini).
    const real = [];
    endpoint.register({ post: (...args) => real.push(args) });
    assert.equal(real[0][1], cotFormRoutes.aiImageGuard());
    assert.equal(real[1][1], cotFormRoutes.geminiGuard());

    // Las dos rutas quedan en el listado de arranque de Express.
    const app = express();
    endpoint.register(app, { guard: [(req, res, next) => next()] });
    const listed = listRegisteredRoutes(app._router.stack).map((r) => `${r.methods} ${r.path}`);
    assert.deepEqual(listed, ['POST /api/ai/generate-image', 'POST /api/gemini/generate-image']);

    const server = read('server.js');
    assert.match(server, /require\('\.\/lib\/routes\/ai-image'\)\.register\(app\);/);
    assert.doesNotMatch(server, /app\.post\('\/api\/gemini\/generate-image'/, 'el handler ya no vive en server.js');
    assert.ok(server.indexOf("require('./lib/routes/ai-image').register(app)") > server.indexOf('app.use(express.json('), 'se registra después del parser de JSON');
    assert.ok(server.indexOf("require('./lib/routes/ai-image').register(app)") > server.indexOf("app.use('/api/', apiLimiter)"), 'y después del límite global de /api/');
});

test('endpoint genérico: forma de la respuesta que leen el backoffice, el dashboard y el Job Board', async () => {
    const seen = [];
    const handler = endpoint.createGenerateHandler({
        env: ENV,
        generateImage: async (options) => { seen.push(options); return { mimeType: 'image/jpeg', base64: JPEG, model: 'gpt-image-2.6-flare', provider: 'openai' }; }
    });
    const res = fakeRes();
    await handler({ body: { prompt: '  Un avatar minimalista  ', aspectRatio: '3:4', model: 'gpt-image-2.6-sunburst' }, aiImageUserKey: 'user:u-1' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        success: true,
        image: `data:image/jpeg;base64,${JPEG}`,
        mime_type: 'image/jpeg',
        provider: 'openai',
        model: 'gpt-image-2.6-flare'
    });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(seen[0], { prompt: 'Un avatar minimalista', model: 'gpt-image-2.6-sunburst', aspectRatio: '3:4', userKey: 'user:u-1', env: ENV });

    // Sin sesión no hay identificador de usuario.
    await handler({ body: { prompt: 'p' } }, fakeRes());
    assert.equal(seen[1].userKey, undefined);
});

test('endpoint genérico: de punta a punta con el guard, el body del navegador no decide modelo, tamaño ni calidad', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return okReply(); };
    const [, sanitize] = cotFormRoutes.createAiImageGuard({
        rateLimit: { rateLimit: (opts) => opts, ipKeyGenerator: (ip) => ip },
        resolveUser: async () => null, budget: cotFormRoutes.createDailyBudget(5)
    });
    const handler = endpoint.createGenerateHandler({ env: ENV, generateImage: (options) => aiImage.generateImage({ ...options, fetchImpl }) });
    // Lo que mandaban los consumidores cuando el proveedor era Gemini.
    const req = { headers: {}, ip: '203.0.113.9', body: {
        prompt: 'Referencia visual para un tatuaje: un colibrí.', model: 'gemini-3-pro-image-preview', aspectRatio: '1:1', imageSize: '4K',
        temperature: 0.7, maxOutputTokens: 1024, safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }],
        quality: 'high', n: 4, size: '1536x1024', apiKey: 'sk-del-navegador'
    } };
    const res = fakeRes();
    await sanitize(req, fakeRes(), () => {});
    await handler(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.match(res.body.image, /^data:image\/jpeg;base64,/);
    assert.deepEqual(calls[0].body, {
        model: 'gpt-image-2.6-flare',
        prompt: 'Referencia visual para un tatuaje: un colibrí.',
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'jpeg',
        output_compression: 85,
        background: 'opaque',
        moderation: 'auto'
    });
    assert.equal(calls[0].opts.headers.Authorization, `Bearer ${KEY}`, 'la clave es la del servidor, no la del body');
    assert.doesNotMatch(calls[0].opts.body, /203\.0\.113\.9|sk-del-navegador/);
});

// Guard real (sin límite por IP) + handler real + proveedor simulado.
function pipeline({ cap = 5, user = null, admin = false, env = ENV, respond = () => okReply() } = {}) {
    const calls = [];
    const logged = [];
    const budget = cotFormRoutes.createDailyBudget(cap);
    const [, sanitize] = cotFormRoutes.createAiImageGuard({
        rateLimit: { rateLimit: (opts) => opts, ipKeyGenerator: (ip) => ip },
        resolveUser: async () => user, isAdmin: () => admin, budget
    });
    const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return respond(url, opts); };
    const handler = endpoint.createGenerateHandler({
        env, log: (...args) => logged.push(args.join(' ')),
        generateImage: (options) => aiImage.generateImage({ ...options, fetchImpl, timeoutMs: 30 })
    });
    const post = async (body) => {
        const req = { headers: user ? { authorization: 'Bearer t' } : {}, ip: '203.0.113.9', body };
        const res = fakeRes();
        let passed = false;
        await sanitize(req, res, () => { passed = true; });
        if (passed) await handler(req, res);
        return res;
    };
    return { post, calls, logged, budget };
}

test('endpoint genérico: el tope diario solo lo gastan los pedidos que llegan al proveedor (SCI-03)', async () => {
    // Antes el guard descontaba antes de validar: una IP mandando cuerpos vacíos dejaba sin imágenes a todos.
    const { post, calls } = pipeline({ cap: 2 });
    for (const body of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: 42 }, null, 'texto', []]) {
        const res = await post(body);
        assert.equal(res.statusCode, 400, JSON.stringify(body));
        assert.equal(res.body.code, 'ai_invalid');
    }
    assert.equal(calls.length, 0, 'nada de eso llegó al proveedor');
    // Los dos cupos del día siguen intactos para los pedidos de verdad…
    assert.equal((await post({ prompt: 'un colibrí' })).statusCode, 200);
    assert.equal((await post({ prompt: 'una rosa' })).statusCode, 200);
    assert.equal(calls.length, 2);
    // …y el tercero se corta acá, sin llamar al proveedor.
    const capped = await post({ prompt: 'un ancla' });
    assert.equal(capped.statusCode, 429);
    assert.deepEqual(capped.body, { success: false, code: 'ai_busy', rate_limited: true, error: 'Hay mucha demanda en este momento. Inténtalo de nuevo más tarde.' });
    assert.equal(capped.headers['Cache-Control'], 'no-store');
    assert.equal(calls.length, 2);

    // Sin clave en el servidor tampoco se gasta el cupo.
    const off = pipeline({ cap: 1, env: {} });
    for (let i = 0; i < 3; i += 1) assert.equal((await off.post({ prompt: 'p' })).statusCode, 503);
    assert.equal(off.budget.take(), true, 'el cupo sigue disponible');

    // El guard ya no descuenta: solo deja el presupuesto a mano del handler.
    const budget = cotFormRoutes.createDailyBudget(1);
    const [, sanitize] = cotFormRoutes.createAiImageGuard({ rateLimit: { rateLimit: (opts) => opts, ipKeyGenerator: (ip) => ip }, resolveUser: async () => null, budget });
    for (let i = 0; i < 3; i += 1) {
        const req = { headers: {}, body: { prompt: 'p' } };
        let passed = false;
        await sanitize(req, fakeRes(), () => { passed = true; });
        assert.equal(passed, true);
        assert.equal(req.aiImageBudget, budget);
    }
    assert.equal(budget.take(), true);
    assert.equal(budget.take(), false);
    const guardSource = read('lib', 'routes', 'cot-form.js');
    assert.doesNotMatch(guardSource.slice(guardSource.indexOf('function createGeminiGuard('), guardSource.indexOf('let defaultGeminiGuard')), /budget\.take\(/, 'el guard no toca el tope');

    // Sin presupuesto en el pedido (handler usado suelto) acepta uno por deps.
    const own = cotFormRoutes.createDailyBudget(1);
    const direct = endpoint.createGenerateHandler({ env: ENV, budget: own, generateImage: async () => ({ mimeType: 'image/jpeg', base64: JPEG, model: 'm', provider: 'openai' }) });
    const first = fakeRes();
    await direct({ body: { prompt: 'p' } }, first);
    const second = fakeRes();
    await direct({ body: { prompt: 'p' } }, second);
    assert.deepEqual([first.statusCode, second.statusCode], [200, 429]);
});

test('endpoint genérico: el cupo vuelve si el proveedor rechazó sin generar; un vencimiento o un 5xx lo consumen (SCI-03, SCI-07)', async () => {
    const hang = (url, opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const outcomes = [
        // [respuesta del proveedor, status esperado, ¿se devuelve el cupo?]
        [() => reply(400, { error: { code: 'moderation_blocked' } }), 422, true],
        [() => reply(401, { error: { code: 'invalid_api_key' } }), 502, true],
        [() => reply(403, { error: { message: 'Your organization must be verified.' } }), 502, true],
        [() => reply(429, { error: { code: 'insufficient_quota' } }), 429, true],
        [() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }, 502, true],
        [hang, 504, false],
        [() => reply(500, { error: { message: 'boom' } }), 502, false],
        [() => reply(200, { data: [] }), 502, false],
        [() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); }, 502, false],
        [() => reply(400, { error: { code: 'moderation_blocked', moderation_details: { moderation_stage: 'output' } } }), 422, false]
    ];
    for (const [respond, status, refunded] of outcomes) {
        const { post, budget, calls } = pipeline({ cap: 1, respond });
        const res = await post({ prompt: 'p' });
        assert.equal(res.statusCode, status, String(respond));
        assert.equal(calls.length, 1, 'el pedido llegó al proveedor');
        assert.equal(budget.take(), refunded, `${status}: ${refunded ? 'el cupo vuelve' : 'el cupo se consume'} · ${String(respond).slice(0, 60)}`);
    }
    // Cinco vencimientos seguidos con tope 2: solo dos llegan al proveedor.
    const slow = pipeline({ cap: 2, respond: hang });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await slow.post({ prompt: 'p' })).statusCode);
    assert.deepEqual(statuses, [504, 504, 429, 429, 429]);
    assert.equal(slow.calls.length, 2, 'el tope acota las llamadas al proveedor');
});

test('endpoint genérico: solo un superadmin elige la proporción; para el resto la imagen es cuadrada (SCI-08)', async () => {
    const anon = pipeline();
    for (const aspectRatio of ['16:9', '9:16', '3:2', '1:1', 'auto']) {
        assert.equal((await anon.post({ prompt: 'p', aspectRatio, size: '1536x1024' })).statusCode, 200);
    }
    assert.deepEqual(anon.calls.map((c) => c.size), ['1024x1024', '1024x1024', '1024x1024', '1024x1024', '1024x1024']);

    const artist = pipeline({ user: { id: 'u-2', email: 'artista@example.test' }, admin: false });
    await artist.post({ prompt: 'p', aspectRatio: '16:9', model: 'gpt-image-2.6-sunburst' });
    assert.equal(artist.calls[0].size, '1024x1024', 'una cuenta común tampoco elige tamaño');
    assert.equal(artist.calls[0].model, 'gpt-image-2.6-flare');

    const admin = pipeline({ user: { id: 'u-1', email: 'admin@example.test' }, admin: true });
    await admin.post({ prompt: 'p', aspectRatio: '16:9', model: 'gpt-image-2.6-sunburst' });
    await admin.post({ prompt: 'p', aspectRatio: '3:4' });
    await admin.post({ prompt: 'p', aspectRatio: '7:1' });
    assert.deepEqual(admin.calls.map((c) => c.size), ['1536x1024', '1024x1536', '1024x1024']);
    assert.equal(admin.calls[0].model, 'gpt-image-2.6-sunburst');
});

test('endpoint genérico: cada error responde con su status, un código y un mensaje propio, sin el detalle del proveedor', async () => {
    const logged = [];
    const run = async (deps, body = { prompt: 'p' }) => {
        const res = fakeRes();
        await endpoint.createGenerateHandler({ env: ENV, log: (...args) => logged.push(args.join(' ')), ...deps })({ body }, res);
        return res;
    };
    const thrower = (props) => async () => { throw Object.assign(new Error('interno'), props); };

    const noPrompt = await run({ generateImage: async () => { throw new Error('no debería generar'); } }, { prompt: '   ' });
    assert.equal(noPrompt.statusCode, 400);
    assert.deepEqual(noPrompt.body, { success: false, code: 'ai_invalid', error: 'Escribe una descripción para generar la imagen.' });
    assert.equal((await run({ generateImage: async () => { throw new Error('x'); } }, null)).statusCode, 400);

    const off = await run({ env: {}, generateImage: async () => { throw new Error('no debería generar'); } });
    assert.equal(off.statusCode, 503);
    assert.equal(off.body.code, 'ai_unavailable');
    assert.equal(logged.length, 0, 'ni el prompt vacío ni la falta de clave ensucian el log');

    const cases = [
        [{ code: 'blocked', status: 422, detail: 'HTTP 400 moderation_blocked: rejected' }, 422, 'ai_blocked'],
        [{ code: 'timeout', status: 504 }, 504, 'ai_timeout'],
        [{ code: 'rate_limited', status: 429, detail: 'HTTP 429 insufficient_quota: You exceeded your current quota.' }, 429, 'ai_busy'],
        [{ code: 'provider', status: 429 }, 429, 'ai_busy'],
        [{ code: 'provider', status: 502, detail: 'HTTP 401 invalid_api_key: Incorrect API key provided: [clave]' }, 502, 'ai_error'],
        [{ code: 'provider', status: 502, detail: 'HTTP 403: Your organization must be verified' }, 502, 'ai_error'],
        [{}, 502, 'ai_error']
    ];
    for (const [props, status, code] of cases) {
        const res = await run({ generateImage: thrower(props) });
        assert.equal(res.statusCode, status, JSON.stringify(props));
        assert.deepEqual(Object.keys(res.body), ['success', 'code', 'error']);
        assert.equal(res.body.success, false);
        assert.equal(res.body.code, code);
        assert.doesNotMatch(res.body.error, /HTTP|quota|invalid_api_key|organization|interno|OpenAI|Gemini/, 'mensaje propio, en español neutro');
        assert.doesNotMatch(res.body.error, /Probá|Intentá|Escribí|podés|querés/, 'sin voseo');
        assert.equal(res.headers['Cache-Control'], 'no-store');
    }
    assert.match(logged.join('\n'), /insufficient_quota/, 'el detalle queda en el log del servidor');
    assert.match(logged.join('\n'), /organization must be verified/);

    // Con el proveedor real simulado: un 403 de verificación de la organización no llega al navegador.
    const forbidden = async () => reply(403, { error: { message: 'Your organization must be verified to use the model.', type: 'invalid_request_error' } });
    const real = await run({ generateImage: (options) => aiImage.generateImage({ ...options, fetchImpl: forbidden }) });
    assert.equal(real.statusCode, 502);
    assert.equal(real.body.code, 'ai_error');
    assert.doesNotMatch(JSON.stringify(real.body), /organization|verified|sk-/);
});
