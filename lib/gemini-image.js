'use strict';

// ===========================================================================
// Generación de imágenes con Gemini (servidor). La API key vive solo en
// process.env.GEMINI_API_KEY: nunca viaja al navegador ni se acepta del body.
// La usa la referencia con IA del cotizador (lib/routes/cot-form.js); el
// modelo, el tamaño y el prompt los decide siempre el servidor.
// ===========================================================================

// Modelos de imagen admitidos (lista blanca: el modelo va en la URL del pedido).
const IMAGE_MODELS = Object.freeze(['gemini-2.5-flash-image', 'gemini-3-pro-image-preview']);
const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const ASPECT_RATIOS = Object.freeze(['1:1', '3:4', '4:3', '9:16', '16:9']);
const IMAGE_MIME_RE = /^image\/(png|jpeg|webp)$/;
const MAX_IMAGE_BASE64 = 12 * 1024 * 1024;

function pickModel(value) {
    return IMAGE_MODELS.includes(value) ? value : DEFAULT_MODEL;
}

function geminiError(message, status, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

/**
 * Genera UNA imagen. Devuelve { mimeType, base64 }.
 * Errores con .status/.code para que la ruta responda sin filtrar el detalle
 * del proveedor: not_configured (503), blocked (422), provider (502), timeout (504).
 */
async function generateImage({ prompt, model, aspectRatio, apiKey = process.env.GEMINI_API_KEY, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
    if (!apiKey) throw geminiError('La generación con IA no está configurada.', 503, 'not_configured');
    const text = String(prompt || '').trim();
    if (!text) throw geminiError('Falta el prompt.', 400, 'invalid');
    const target = pickModel(model);
    const imageConfig = { aspectRatio: ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1' };
    // imageSize solo existe en Gemini 3 Pro Image.
    if (target.startsWith('gemini-3')) imageConfig.imageSize = '1K';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${target}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
                generationConfig: { responseModalities: ['IMAGE'], temperature: 0.8, imageConfig }
            })
        });
    } catch (error) {
        if (error && error.name === 'AbortError') throw geminiError('La generación tardó demasiado.', 504, 'timeout');
        throw geminiError('No pudimos conectar con el servicio de imágenes.', 502, 'provider');
    } finally {
        clearTimeout(timer);
    }

    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok) {
        const detail = data && data.error && data.error.message ? String(data.error.message).slice(0, 200) : `HTTP ${response.status}`;
        const error = geminiError('El servicio de imágenes no respondió bien.', response.status === 429 ? 429 : 502, 'provider');
        error.detail = detail;
        throw error;
    }
    const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    const part = parts.find((p) => p && p.inlineData && p.inlineData.data);
    if (!part) {
        // Sin imagen: filtro de seguridad del proveedor o respuesta solo de texto.
        throw geminiError('No se pudo generar una imagen para esa idea.', 422, 'blocked');
    }
    const mimeType = String(part.inlineData.mimeType || '').toLowerCase();
    const base64 = String(part.inlineData.data || '');
    if (!IMAGE_MIME_RE.test(mimeType) || !/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length > MAX_IMAGE_BASE64) {
        throw geminiError('La imagen generada no es válida.', 502, 'provider');
    }
    return { mimeType, base64, model: target };
}

module.exports = { generateImage, pickModel, IMAGE_MODELS, DEFAULT_MODEL };
