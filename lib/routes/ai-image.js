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
//            aspectRatio y model solo cuentan si los pide un superadmin y
//            están en la lista blanca (para el resto: imagen cuadrada y modelo
//            del servidor); los demás campos se descartan en el guard
//            (lib/routes/cot-form.js · aiImageGuard).
// Respuesta: { success: true, image: 'data:<mime>;base64,…', mime_type, provider, model }
//            { success: false, code, error }   (nunca el detalle del proveedor)
//
// Genera con lib/ai-image.js (OpenAI GPT Image 2.6 por defecto). La clave se
// lee solo del entorno del servidor.
//
// Tope diario: el guard deja el presupuesto en req.aiImageBudget y aquí se
// descuenta solo cuando el pedido es válido y hay proveedor configurado,
// justo antes de generar. Se devuelve solo si consta que el proveedor no
// generó nada (aiImage.isRefundable): un vencimiento o un 5xx sí cuentan.
// ===========================================================================

const aiImage = require('../ai-image');

const PATHS = Object.freeze(['/api/ai/generate-image', '/api/gemini/generate-image']);
const DAILY_CAP_MESSAGE = 'Hay mucha demanda en este momento. Inténtalo de nuevo más tarde.';

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
        const budget = req.aiImageBudget || deps.budget || null;
        if (budget && !budget.take()) {
            return res.status(429).json({ success: false, code: 'ai_busy', rate_limited: true, error: DAILY_CAP_MESSAGE });
        }
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
            if (budget && aiImage.isRefundable(error)) budget.refund();
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
