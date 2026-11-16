'use strict';

// ===========================================================================
// Endpoint genérico de generación de imágenes con IA.
// ---------------------------------------------------------------------------
//   POST /api/ai/generate-image       ruta actual
//   POST /api/gemini/generate-image   alias histórico (mismo guard y handler)
//
// Lo usan el backoffice (íconos de zonas del cuerpo y prueba de conexión), el
// avatar con IA del artista y "Inspirarme con AI" del Job Board.
//
// Body:      { prompt, aspectRatio?, model? }
//            model solo cuenta si lo pide un superadmin y está en la lista
//            blanca; el resto de los campos se descarta en el guard
//            (lib/routes/cot-form.js · aiImageGuard).
// Respuesta: { success: true, image: 'data:<mime>;base64,…', mime_type, provider, model }
//            { success: false, code, error }   (nunca el detalle del proveedor)
//
// Genera con lib/ai-image.js (OpenAI GPT Image 2.6 por defecto). La clave se
// lee solo del entorno del servidor.
// ===========================================================================

const aiImage = require('../ai-image');

const PATHS = Object.freeze(['/api/ai/generate-image', '/api/gemini/generate-image']);

// clave → [status HTTP, código, mensaje para la persona]
const ERRORS = {
    invalid: [400, 'ai_invalid', 'Escribe una descripción para generar la imagen.'],
    not_configured: [503, 'ai_unavailable', 'La generación de imágenes con IA no está disponible en este momento.'],
    blocked: [422, 'ai_blocked', 'No pudimos generar una imagen para esa descripción. Prueba describirla de otra forma.'],
    timeout: [504, 'ai_timeout', 'La imagen tardó demasiado en generarse. Inténtalo de nuevo.'],
    rate_limited: [429, 'ai_busy', 'Hay mucha demanda en este momento. Inténtalo de nuevo en unos minutos.'],
    provider: [502, 'ai_error', 'No pudimos generar la imagen. Inténtalo de nuevo.']
};

function errorKey(error) {
    if (error && error.status === 429) return 'rate_limited';
    if (error && error.code && Object.prototype.hasOwnProperty.call(ERRORS, error.code)) return error.code;
    return 'provider';
}

function createGenerateHandler(deps = {}) {
    const env = deps.env || process.env;
    const generate = deps.generateImage || ((options) => aiImage.generateImage(options));
    const log = deps.log || ((...args) => console.error(...args));
    return async function handleGenerateImage(req, res) {
        res.set('Cache-Control', 'no-store');
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const fail = (key) => res.status(ERRORS[key][0]).json({ success: false, code: ERRORS[key][1], error: ERRORS[key][2] });
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt) return fail('invalid');
        if (!aiImage.isConfigured(env)) return fail('not_configured');
        try {
            const image = await generate({
                prompt,
                model: body.model,
                aspectRatio: body.aspectRatio,
                userKey: req.aiImageUserKey || undefined,
                env
            });
            return res.json({
                success: true,
                image: `data:${image.mimeType};base64,${image.base64}`,
                mime_type: image.mimeType,
                provider: image.provider,
                model: image.model
            });
        } catch (error) {
            const key = errorKey(error);
            // El detalle del proveedor (sin la clave ni el prompt) queda solo en el log.
            if (key !== 'invalid' && key !== 'not_configured') {
                log('[ai-image] generación:', key, String((error && (error.detail || error.message)) || '').slice(0, 300));
            }
            return fail(key);
        }
    };
}

function register(app, deps = {}) {
    const guard = deps.guard || require('./cot-form').aiImageGuard();
    const handler = createGenerateHandler(deps);
    for (const routePath of PATHS) app.post(routePath, guard, handler);
}

module.exports = { register, createGenerateHandler, PATHS, ERRORS };
