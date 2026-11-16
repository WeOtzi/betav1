'use strict';

// ===========================================================================
// Sugerencia de estilos para el cotizador — frente cot-pasos (P10).
// ---------------------------------------------------------------------------
// Lógica pura, compartida con el navegador: el modelo vive en
// public/shared/js/quotation-style-model.js (palabras clave y sinónimos por
// estilo del catálogo lib/expanded-tattoo-styles.js + estilos base). Aquí solo
// se arma la respuesta pública del endpoint: sin PII y sin devolver la idea.
// ===========================================================================

const Model = require('../public/shared/js/quotation-style-model.js');

const MAX_ARTIST_STYLES = 40;
const MAX_STYLE_LABEL = 80;

function publicStyle(style) {
    return { slug: style.slug || '', name: style.name || '' };
}

// Entrada del cliente → valores acotados (nunca se confía en tipos ni largos).
function normalizeInput(body) {
    const input = body && typeof body === 'object' ? body : {};
    const idea = typeof input.idea === 'string' ? input.idea.slice(0, Model.MAX_IDEA_LENGTH) : '';
    const artistStyles = Model.cleanLabels(input.artist_styles)
        .slice(0, MAX_ARTIST_STYLES)
        .map((label) => label.slice(0, MAX_STYLE_LABEL));
    const limit = Math.min(Model.MAX_LIMIT, Math.max(1, parseInt(input.limit, 10) || Model.DEFAULT_LIMIT));
    return { idea, artistStyles, limit };
}

/**
 * Respuesta del endpoint a partir del catálogo (árbol de tattoo_styles o el
 * respaldo estático del modelo).
 */
function buildSuggestions(input, catalog) {
    const styles = Array.isArray(catalog) && catalog.length ? catalog : Model.STATIC_CATALOG;
    const { idea, artistStyles, limit } = normalizeInput(input);
    const arranged = Model.arrangeStyles(styles, { idea, artistStyles, limit });
    const recommended = Model.suggestStylesForIdea(idea, styles, { limit });
    return {
        mode: arranged.mode,
        artist_styles: Model.matchArtistStyles(artistStyles, styles).map(publicStyle),
        suggestions: recommended.map((item) => ({
            ...publicStyle(item.style),
            score: item.score,
            matches: item.matches
        }))
    };
}

module.exports = {
    Model,
    MAX_ARTIST_STYLES,
    normalizeInput,
    buildSuggestions
};
