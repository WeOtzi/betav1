'use strict';

// ===========================================================================
// Lectura del código corto de una cotización (quotations_db.short_code) por la
// capa PostgREST unificada.
// ---------------------------------------------------------------------------
// Se pide APARTE de la lectura principal de cada frente y nunca lanza: si la
// base todavía no tiene la columna (migración 20261116110000 sin aplicar) o la
// consulta falla, devuelve null y quien lo muestra cae en el quote_id.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { isShortCode } = require('../quote-code');

/** short_code guardado de la cotización (por id numérico o quote_id), o null. */
async function readShortCode(quote, { query = pgrest } = {}) {
    const q = quote || {};
    if (isShortCode(q.short_code)) return q.short_code;
    const byId = q.id != null && q.id !== '';
    if (!byId && !q.quote_id) return null;
    try {
        const base = query('quotations_db').select('short_code');
        const row = await (byId ? base.eq('id', q.id) : base.eq('quote_id', q.quote_id)).limit(1).single().execute();
        return row && isShortCode(row.short_code) ? row.short_code : null;
    } catch (_) {
        return null;
    }
}

/** La misma cotización con su short_code si existe. No modifica la original. */
async function withShortCode(quote, deps) {
    if (!quote || isShortCode(quote.short_code)) return quote;
    const code = await readShortCode(quote, deps);
    return code ? { ...quote, short_code: code } : quote;
}

module.exports = { readShortCode, withShortCode };
