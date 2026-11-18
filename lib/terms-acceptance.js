'use strict';

// ===========================================================================
// Aceptación de Términos y Política de Privacidad en el registro del artista
// (ronda 3 · P3, Figma 801:536 "Crear cuenta" y 801:1097 "Revisa y confirma").
// ---------------------------------------------------------------------------
// El checkbox del navegador manda `terms_accepted: true` en el `data` del
// borrador y del finalize. El servidor guarda la fecha y la versión en
// artists_db.terms_accepted_at / terms_version (migración 20261112160000).
// Mientras la migración no esté aplicada, el guardado reintenta sin esas
// columnas para no romper el registro.
// ===========================================================================

// Subir esta versión cuando cambie el texto legal publicado. Es un solo código
// para el par de textos y vive en estos lugares que se suben a la vez: aquí,
// en public/shared/js/studio-register.js, en public.handle_new_user() y en
// public.complete_studio_registration() (con una migración nueva: ver
// 20261118120000). Desde 2026-11-18 la re-aceptación es obligatoria: quien
// tiene una versión anterior ve el gate de Términos al iniciar sesión
// (public/shared/js/wo-terms-gate.js → GET /api/account/terms-status y
// POST /api/account/terms-accept, lib/routes/terminos.js), que registra la
// aceptación en terms_acceptances y vuelve a sellar todos sus perfiles.
const TERMS_VERSION = '2026-11-18'; // Términos v1.1 y Privacidad v1.2 (18 nov 2026)
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
