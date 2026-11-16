'use strict';

// ===========================================================================
// Generación de imágenes con IA (servidor) — neutral de proveedor.
// ---------------------------------------------------------------------------
// Proveedor por defecto: OpenAI (GPT Image 2.6) con OPENAI_API_KEY.
// Gemini queda solo como proveedor heredado (lib/gemini-image.js): se usa
// ÚNICAMENTE si AI_IMAGE_PROVIDER=gemini. Tener GEMINI_API_KEY cargada no lo
// activa por sí sola: los textos legales nombran a OpenAI como proveedor.
// AI_IMAGE_PROVIDER=off apaga la generación aunque haya claves (OPENAI_API_KEY
// también la usa el chat de soporte).
//
// La clave se lee SOLO del entorno: nunca del body, nunca viaja al navegador y
// nunca se registra en logs. Modelo, tamaño y calidad los decide el servidor.
// La usan la referencia con IA del cotizador (lib/routes/cot-form.js) y el
// endpoint genérico (lib/routes/ai-image.js).
// ===========================================================================

const crypto = require('node:crypto');
const geminiImage = require('./gemini-image');

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';

// Lista blanca de modelos de OpenAI (GPT Image 2.6): "flare" es el rápido de
// uso cotidiano y "sunburst" el de trabajo detallado.
const OPENAI_MODELS = Object.freeze(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']);
const OPENAI_DEFAULT_MODEL = 'gpt-image-2.6-flare';
const QUALITIES = Object.freeze(['low', 'medium', 'high']);
const DEFAULT_QUALITY = 'medium';
const DEFAULT_TIMEOUT_MS = 120000;
// Tope de la espera: por encima de 2^31-1 ms Node dispara el temporizador al
// instante, y pasados los 300 s el fetch de Node corta por su cuenta.
const MAX_TIMEOUT_MS = 280000;
const MAX_PROMPT_CHARS = 32000;
const OUTPUT_FORMAT = 'jpeg';
const OUTPUT_COMPRESSION = 85;
const MAX_IMAGE_BASE64 = geminiImage.MAX_IMAGE_BASE64;

const SIZE_SQUARE = '1024x1024';
const SIZE_LANDSCAPE = '1536x1024';
const SIZE_PORTRAIT = '1024x1536';
const SIZE_BY_ASPECT = new Map([
    ['1:1', SIZE_SQUARE],
    ['4:3', SIZE_LANDSCAPE], ['3:2', SIZE_LANDSCAPE], ['16:9', SIZE_LANDSCAPE],
    ['3:4', SIZE_PORTRAIT], ['2:3', SIZE_PORTRAIT], ['9:16', SIZE_PORTRAIT]
]);
const ASPECT_RATIOS = Object.freeze([...SIZE_BY_ASPECT.keys()]);
// El proveedor heredado no tiene 3:2 ni 2:3: se piden en la proporción más cercana.
const GEMINI_ASPECT_FALLBACK = new Map([['3:2', '4:3'], ['2:3', '3:4']]);

const PROVIDER_OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0']);
const BLOCKED_CODES = new Set(['moderation_blocked', 'content_policy_violation']);
// Solo para cuando el bloqueo llega sin code ni type reconocibles. No incluye
// "moderation" a secas: es también el nombre de un parámetro del pedido.
const BLOCKED_MESSAGE_RE = /safety system|content[ _]policy/i;
// 400 de pedido mal armado (parámetro o modelo): fallo de integración, nunca
// "contenido bloqueado", diga lo que diga el mensaje.
const INVALID_REQUEST_CODES = new Set([
    'unknown_parameter', 'unsupported_parameter', 'missing_required_parameter',
    'invalid_value', 'invalid_type', 'model_not_found'
]);
// Fallos de red en los que el pedido nunca llegó a salir hacia el proveedor.
const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// Claves de proveedor que podrían venir citadas en un mensaje de error.
const KEY_LIKE_RE = /\b(?:sk-[A-Za-z0-9_*.-]{4,}|AIza[0-9A-Za-z_-]{10,})/g;

function aiError(message, status, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** Proveedor activo: 'openai' | 'gemini' | 'none' (apagado a propósito). */
function resolveProvider(env = process.env) {
    const e = env || {};
    const wanted = clean(e.AI_IMAGE_PROVIDER).toLowerCase();
    if (PROVIDER_OFF_VALUES.has(wanted)) return 'none';
    // Gemini solo con AI_IMAGE_PROVIDER=gemini: su clave sola no cambia de proveedor.
    return wanted === 'gemini' ? 'gemini' : 'openai';
}

function apiKeyFor(provider, env) {
    const e = env || {};
    if (provider === 'openai') return clean(e.OPENAI_API_KEY);
    if (provider === 'gemini') return clean(e.GEMINI_API_KEY);
    return '';
}

/** Primer candidato de la lista blanca; un valor desconocido cae al default. */
function pickOpenAiModel(...candidates) {
    return candidates.map(clean).find((c) => OPENAI_MODELS.includes(c)) || OPENAI_DEFAULT_MODEL;
}

function pickGeminiModel(...candidates) {
    return candidates.map(clean).find((c) => geminiImage.IMAGE_MODELS.includes(c)) || geminiImage.DEFAULT_MODEL;
}

function pickModel(provider, model, env) {
    const general = (env || {}).AI_IMAGE_MODEL;
    if (provider === 'gemini') return pickGeminiModel(model, general);
    return pickOpenAiModel(model, general);
}

function pickQuality(...candidates) {
    return candidates.map((c) => clean(c).toLowerCase()).find((c) => QUALITIES.includes(c)) || DEFAULT_QUALITY;
}

/** Proporción pedida → tamaño de OpenAI. Cualquier otra cae al cuadrado. */
function sizeForAspect(aspectRatio) {
    return SIZE_BY_ASPECT.get(clean(aspectRatio)) || SIZE_SQUARE;
}

function resolveTimeout(timeoutMs, env) {
    const explicit = Number(timeoutMs);
    if (Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, MAX_TIMEOUT_MS);
    const fromEnv = parseInt((env || {}).AI_IMAGE_TIMEOUT_MS, 10);
    return Number.isFinite(fromEnv) && fromEnv >= 1000 ? Math.min(fromEnv, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
}

/**
 * Identificador estable y hasheado del usuario final para el proveedor
 * (safety_identifier). Nunca se manda el dato original: solo su SHA-256.
 */
function safetyIdentifier(userKey) {
    const value = userKey == null ? '' : String(userKey).trim();
    return value ? crypto.createHash('sha256').update(value).digest('hex') : '';
}

function redact(text, apiKey) {
    let out = String(text || '');
    if (apiKey) out = out.split(apiKey).join('[clave]');
    return out.replace(KEY_LIKE_RE, '[clave]');
}

function isAbortError(error) {
    return !!error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** Tipo real de la imagen según sus primeros bytes (no se confía en el rótulo). */
function sniffImageMime(base64) {
    let head;
    try { head = Buffer.from(base64.slice(0, 16), 'base64'); } catch (_) { return ''; }
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return '';
}

// Dato corto del proveedor para el log (id de pedido, etapa, categoría): solo
// caracteres de identificador y con largo acotado.
function logToken(value, max = 40) {
    return clean(value).replace(/[^A-Za-z0-9_./-]/g, '').slice(0, max);
}

// x-request-id de la respuesta de OpenAI: es lo que pide su soporte para
// rastrear un pedido. Defensivo: una respuesta sin cabeceras devuelve ''.
function requestIdOf(response) {
    const headers = response && response.headers;
    return headers && typeof headers.get === 'function' ? logToken(headers.get('x-request-id'), 64) : '';
}

// Respuesta de error de OpenAI ({ error: { message, type, code, param } }) →
// error propio. code y type pueden faltar. El detalle queda en error.detail
// solo para el log del servidor: nunca va en la respuesta al navegador. Lleva
// el estado HTTP, el código, el id del pedido y, si el bloqueo es de contenido,
// la etapa y las categorías (error.moderation_details), antes del mensaje para
// que el recorte no se los lleve.
function openAiHttpError(status, data, apiKey, requestId) {
    const raw = data && data.error;
    const info = raw && typeof raw === 'object' ? raw : {};
    const code = clean(info.code);
    const type = clean(info.type);
    const message = clean(info.message) || clean(raw);
    // Un bloqueo de contenido llega sin `param`. Si el proveedor señala un
    // parámetro o un código de pedido inválido, el mensaje no se interpreta.
    const invalidRequest = !!clean(info.param) || INVALID_REQUEST_CODES.has(code);
    const blocked = status === 400
        && (BLOCKED_CODES.has(code) || type === 'image_generation_user_error'
            || (!invalidRequest && BLOCKED_MESSAGE_RE.test(message)));
    let error;
    if (blocked) error = aiError('No se pudo generar una imagen para esa idea.', 422, 'blocked');
    else if (status === 429) error = aiError('El servicio de imágenes llegó a su límite o cuota.', 429, 'rate_limited');
    else error = aiError('El servicio de imágenes no respondió bien.', 502, 'provider');
    const label = code || type;
    const extras = [];
    if (requestId) extras.push(`req=${requestId}`);
    const moderation = info.moderation_details && typeof info.moderation_details === 'object' ? info.moderation_details : null;
    const stage = moderation ? logToken(moderation.moderation_stage, 20) : '';
    const categories = moderation && Array.isArray(moderation.categories)
        ? moderation.categories.map((c) => logToken(c)).filter(Boolean).slice(0, 8).join(',')
        : '';
    if (stage) extras.push(`etapa=${stage}`);
    if (categories) extras.push(`categorias=${categories}`);
    error.detail = redact(`HTTP ${status}${label ? ` ${label}` : ''}${extras.length ? ` ${extras.join(' ')}` : ''}${message ? `: ${message}` : ''}`, apiKey).slice(0, 300);
    error.providerStatus = status;
    if (label) error.providerCode = label;
    if (requestId) error.requestId = requestId;
    if (stage) error.moderationStage = stage;
    return error;
}

async function generateWithOpenAi({ text, model, aspectRatio, quality, userKey, apiKey, env, fetchImpl, timeout }) {
    const target = pickOpenAiModel(model, env.AI_IMAGE_MODEL);
    // Los modelos GPT Image siempre devuelven base64 (data[0].b64_json): no se
    // envía response_format ni style.
    const body = {
        model: target,
        prompt: text,
        n: 1,
        size: sizeForAspect(aspectRatio),
        quality: pickQuality(quality, env.AI_IMAGE_QUALITY),
        output_format: OUTPUT_FORMAT,
        output_compression: OUTPUT_COMPRESSION,
        background: 'opaque',
        moderation: 'auto'
    };
    const safetyId = safetyIdentifier(userKey);
    if (safetyId) body.safety_identifier = safetyId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    let data = null;
    try {
        response = await fetchImpl(OPENAI_IMAGES_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify(body)
        });
        // Leer el cuerpo (varios MB en base64) también cuenta para el tiempo límite.
        try { data = await response.json(); } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) throw error;
            data = null;
        }
    } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw aiError('La generación tardó demasiado.', 504, 'timeout');
        const failure = aiError('No pudimos conectar con el servicio de imágenes.', 502, 'provider');
        const causeCode = error && error.cause && error.cause.code ? String(error.cause.code) : '';
        failure.detail = redact(`red: ${(error && error.message) || 'sin detalle'}${causeCode ? ` (${causeCode})` : ''}`, apiKey).slice(0, 300);
        // El pedido no llegó a salir (DNS, conexión rechazada): no pudo generar nada.
        if (NOT_SENT_CODES.has(causeCode)) failure.notSent = true;
        throw failure;
    } finally {
        clearTimeout(timer);
    }

    const requestId = requestIdOf(response);
    if (!response.ok) throw openAiHttpError(response.status, data, apiKey, requestId);

    const reqSuffix = requestId ? ` req=${requestId}` : '';
    const item = data && Array.isArray(data.data) ? data.data[0] : null;
    const base64 = item && typeof item.b64_json === 'string' ? item.b64_json : '';
    if (!base64) {
        const failure = aiError('El servicio de imágenes respondió sin imagen.', 502, 'provider');
        failure.detail = `respuesta 200 sin data[0].b64_json${reqSuffix}`;
        throw failure;
    }
    const mimeType = base64.length <= MAX_IMAGE_BASE64 && BASE64_RE.test(base64) ? sniffImageMime(base64) : '';
    if (!mimeType) {
        const failure = aiError('La imagen generada no es válida.', 502, 'provider');
        failure.detail = `b64_json inválido, demasiado grande o de un tipo no admitido${reqSuffix}`;
        throw failure;
    }
    return { mimeType, base64, model: target, provider: 'openai' };
}

async function generateWithGemini({ text, model, aspectRatio, apiKey, env, fetchImpl, timeout }) {
    const target = pickGeminiModel(model, env.AI_IMAGE_MODEL);
    const aspect = clean(aspectRatio);
    try {
        const image = await geminiImage.generateImage({
            prompt: text, model: target, aspectRatio: GEMINI_ASPECT_FALLBACK.get(aspect) || aspect, apiKey, fetchImpl, timeoutMs: timeout
        });
        return { mimeType: image.mimeType, base64: image.base64, model: image.model || target, provider: 'gemini' };
    } catch (error) {
        if (error && error.status === 429) error.code = 'rate_limited';
        if (error && error.detail) error.detail = redact(error.detail, apiKey);
        throw error;
    }
}

/**
 * Genera UNA imagen. Devuelve { mimeType, base64, model, provider }.
 * Errores con .status/.code para que las rutas respondan sin filtrar el
 * detalle del proveedor: not_configured (503), invalid (400), blocked (422),
 * rate_limited (429), provider (502), timeout (504).
 * userKey identifica al usuario final; al proveedor solo llega su SHA-256.
 */
async function generateImage({ prompt, model, aspectRatio, quality, userKey, env = process.env, fetchImpl = fetch, timeoutMs } = {}) {
    const e = env || {};
    const provider = resolveProvider(e);
    const apiKey = apiKeyFor(provider, e);
    if (!apiKey) throw aiError('La generación con IA no está configurada.', 503, 'not_configured');
    const text = String(prompt == null ? '' : prompt).trim().slice(0, MAX_PROMPT_CHARS);
    if (!text) throw aiError('Falta el prompt.', 400, 'invalid');
    const options = { text, model, aspectRatio, quality, userKey, apiKey, env: e, fetchImpl, timeout: resolveTimeout(timeoutMs, e) };
    return provider === 'gemini' ? generateWithGemini(options) : generateWithOpenAi(options);
}

/**
 * ¿Se puede devolver el cupo diario tras este error? Solo cuando consta que
 * el proveedor no generó nada: el pedido no salió (sin clave, prompt vacío,
 * fallo al conectar) o fue rechazado con un 4xx (contenido, clave, cuota).
 * Un vencimiento, un 5xx, una respuesta 200 inservible o un bloqueo sobre la
 * imagen ya generada pudieron costar: esos no se devuelven, para que el tope
 * diario acote de verdad las llamadas que pueden cobrarse.
 */
function isRefundable(error) {
    if (!error) return false;
    if (error.code === 'invalid' || error.code === 'not_configured') return true;
    if (error.code === 'timeout' || error.moderationStage === 'output') return false;
    const status = Number(error.providerStatus);
    if (Number.isFinite(status) && status > 0) return status >= 400 && status < 500;
    return error.notSent === true;
}

/** { provider, configured, model } del proveedor activo. Nunca incluye la clave. */
function providerInfo(env = process.env) {
    const provider = resolveProvider(env);
    if (provider === 'none') return { provider, configured: false, model: null };
    return { provider, configured: !!apiKeyFor(provider, env), model: pickModel(provider, undefined, env) };
}

function isConfigured(env = process.env) {
    return providerInfo(env).configured;
}

// El chequeo consulta el modelo (no genera): un 401 también puede ser una
// clave restringida sin permiso de lectura de modelos, que sí genera.
const HEALTH_HINTS = {
    401: 'la clave fue rechazada o no tiene permiso para consultar modelos',
    403: 'la cuenta no tiene acceso al modelo (en OpenAI, la organización puede necesitar verificación)',
    404: 'el modelo no existe o la cuenta no tiene acceso',
    429: 'límite o cuota agotada'
};

/**
 * Chequeo de salud del proveedor activo SIN generar imágenes ni gastar cuota:
 * consulta el modelo configurado. Devuelve { status, metadata } o lanza un
 * Error con un mensaje propio (nunca el texto del proveedor ni la clave).
 */
async function checkHealth({ env = process.env, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
    const info = providerInfo(env);
    const metadata = { provider: info.provider };
    if (info.model) metadata.model = info.model;
    if (!info.configured) return { status: 'unconfigured', metadata };
    const apiKey = apiKeyFor(info.provider, env);
    const gemini = info.provider === 'gemini';
    const label = gemini ? 'Gemini' : 'OpenAI';
    let response;
    try {
        response = await fetchImpl(gemini ? GEMINI_MODELS_URL : `${OPENAI_MODELS_URL}/${encodeURIComponent(info.model)}`, {
            method: 'GET',
            headers: gemini ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        throw new Error(isAbortError(error) ? `${label} no respondió a tiempo.` : `No pudimos conectar con ${label}.`);
    }
    if (!response.ok) {
        const hint = HEALTH_HINTS[response.status];
        throw new Error(`${label} respondió HTTP ${response.status}${hint ? `: ${hint}` : ''}.`);
    }
    return { status: 'healthy', metadata };
}

module.exports = {
    generateImage,
    isRefundable,
    providerInfo,
    isConfigured,
    checkHealth,
    resolveProvider,
    pickOpenAiModel,
    sizeForAspect,
    safetyIdentifier,
    OPENAI_IMAGES_URL,
    OPENAI_MODELS,
    OPENAI_DEFAULT_MODEL,
    ASPECT_RATIOS,
    QUALITIES,
    DEFAULT_QUALITY,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    MAX_IMAGE_BASE64
};
