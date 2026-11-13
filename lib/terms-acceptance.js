'use strict';

// ===========================================================================
// Aceptación de Términos y Política de Privacidad en el registro del artista
// (ronda 3 · P3, Figma 801:536 "Crear cuenta" y 801:1097 "Revisá y confirmá").
// ---------------------------------------------------------------------------
// El checkbox del navegador manda `terms_accepted: true` en el `data` del
// borrador y del finalize. El servidor guarda la fecha y la versión en
// artists_db.terms_accepted_at / terms_version (migración 20261112160000).
// Mientras la migración no esté aplicada, el guardado reintenta sin esas
// columnas para no romper el registro.
// ===========================================================================

// Subir esta versión cuando cambie el texto legal publicado.
const TERMS_VERSION = '2026-11-12';
const TERMS_COLUMNS = ['terms_accepted_at', 'terms_version'];

function hasAcceptedTerms(formData) {
    const value = formData && formData.terms_accepted;
    return value === true || value === 'true';
}

/**
 * Columnas a escribir en artists_db.
 * - Sin aceptación: nada (no se borra una aceptación anterior).
 * - Borrador (`force` false): solo la primera vez o si cambió la versión.
 * - Finalize (`force` true): siempre sella la aceptación final con la fecha.
 */
function termsAcceptancePatch(formData, { existing = null, force = false, now = new Date().toISOString(), version = TERMS_VERSION } = {}) {
    if (!hasAcceptedTerms(formData)) return {};
    if (!force && existing && existing.terms_accepted_at && existing.terms_version === version) return {};
    return { terms_accepted_at: now, terms_version: version };
}

function isMissingTermsColumnError(error) {
    const text = String((error && (error.message || error)) || '');
    return /PGRST204|42703|column/i.test(text) && TERMS_COLUMNS.some((c) => text.includes(c));
}

function withoutTermsColumns(patch) {
    const copy = { ...(patch || {}) };
    TERMS_COLUMNS.forEach((c) => { delete copy[c]; });
    return copy;
}

/**
 * Ejecuta `write(patch)`; si el backend todavía no tiene las columnas de
 * términos, reintenta una vez sin ellas. Devuelve { result, termsSaved }.
 */
async function writeWithTermsFallback(patch, write) {
    const hasTerms = TERMS_COLUMNS.some((c) => patch && c in patch);
    try {
        return { result: await write(patch), termsSaved: hasTerms };
    } catch (error) {
        if (!hasTerms || !isMissingTermsColumnError(error)) throw error;
        return { result: await write(withoutTermsColumns(patch)), termsSaved: false };
    }
}

module.exports = {
    TERMS_VERSION,
    TERMS_COLUMNS,
    hasAcceptedTerms,
    termsAcceptancePatch,
    isMissingTermsColumnError,
    withoutTermsColumns,
    writeWithTermsFallback
};
