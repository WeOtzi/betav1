'use strict';

// ===========================================================================
// Rutas del cotizador web — frente cot-pasos (pasos Estilo, Cuerpo y Tamaño).
// ---------------------------------------------------------------------------
//   POST /api/quotations/style-suggestions
//        { idea?: string, artist_styles?: string[], limit?: number }
//        → { success, mode, artist_styles: [{slug,name}],
//            suggestions: [{slug,name,score,matches}] }
//
// Analiza la idea del cliente con palabras clave (lib/quotation-style-suggest,
// sin IA externa) y la cruza con el catálogo vivo de tattoo_styles. Es público
// y no recibe ni devuelve datos personales: la idea no se guarda ni se loguea,
// y va en el cuerpo (nunca en la URL). El wizard calcula lo mismo en el
// navegador con el modelo compartido; el endpoint queda para otros clientes
// (pre-cotizador, chat) y como única fuente si el catálogo cambia.
// ===========================================================================

const { TattooStylesRepo } = require('../repos/tattoo-styles');
const styleSuggest = require('../quotation-style-suggest');

const CATALOG_CACHE_MS = 5 * 60 * 1000;
const RATE_MESSAGE = 'Estás enviando muchas solicitudes seguidas. Espera un minuto y vuelve a intentar.';

function createLimiter(erl) {
    const rateLimit = erl.rateLimit || erl;
    const ipKey = (req) => (erl.ipKeyGenerator ? erl.ipKeyGenerator(req.ip || '') : String(req.ip || ''));
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: ipKey,
        message: { success: false, error: RATE_MESSAGE, rate_limited: true }
    });
}

// Catálogo de tattoo_styles con caché corta. Si la base no responde se usa el
// catálogo estático del modelo: sugerir estilos nunca rompe el wizard.
function createCatalogSource(deps = {}) {
    const load = deps.loadStyleCatalog || (() => TattooStylesRepo.listTree());
    const now = deps.now || Date.now;
    let cache = { at: 0, rows: null };
    return async function loadCatalog() {
        if (cache.rows && now() - cache.at < CATALOG_CACHE_MS) return cache.rows;
        try {
            const rows = await load();
            if (Array.isArray(rows) && rows.length) {
                cache = { at: now(), rows };
                return rows;
            }
        } catch (error) {
            console.error('[cot-pasos] catálogo de estilos:', error.message);
        }
        return cache.rows || styleSuggest.Model.STATIC_CATALOG;
    };
}

function createStyleSuggestionsHandler(deps = {}) {
    const loadCatalog = deps.loadCatalog || createCatalogSource(deps);
    return async function handleStyleSuggestions(req, res) {
        res.set('Cache-Control', 'no-store');
        try {
            const input = styleSuggest.normalizeInput(req.body);
            if (!input.idea.trim() && !input.artistStyles.length) {
                return res.status(400).json({ success: false, error: 'Cuéntanos tu idea para sugerirte estilos.' });
            }
            const result = styleSuggest.buildSuggestions(req.body, await loadCatalog());
            return res.json({ success: true, ...result });
        } catch (error) {
            console.error('[cot-pasos] sugerencia de estilos:', error.message);
            return res.status(500).json({ success: false, error: 'No pudimos sugerirte estilos ahora. Elige el que más te guste.' });
        }
    };
}

function register(app, deps = {}) {
    const limiter = createLimiter(deps.rateLimit || require('express-rate-limit'));
    app.post('/api/quotations/style-suggestions', limiter, createStyleSuggestionsHandler(deps));
}

module.exports = {
    register,
    createLimiter,
    createCatalogSource,
    createStyleSuggestionsHandler
};
