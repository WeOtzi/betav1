'use strict';

// ===========================================================================
// Código de una cotización tal como lo ven las personas (pantallas, correos,
// PDF). quotations_db.short_code (migración 20261116110000) son 6 caracteres
// sin 0/1/I/L/O; el quote_id interno ("QN" + 32 hex) sigue siendo la llave de
// los enlaces y nunca se reemplaza por el corto en una URL.
// Funciones puras: las usan lib/cot-form.js, los armadores de correos y los
// eventos de services/email-events/.
// ===========================================================================

const SHORT_CODE_RE = /^[2-9A-HJKMNP-Z]{6}$/;

function isShortCode(value) {
    return SHORT_CODE_RE.test(String(value || ''));
}

/**
 * El código que se muestra: el corto si la fila lo tiene; si no (base sin la
 * migración), el quote_id de siempre. Acepta la fila de la cotización o el
 * payload de un correo (que puede traer `quote_code` ya resuelto).
 */
function visibleCode(row) {
    const r = row || {};
    if (isShortCode(r.quote_code)) return r.quote_code;
    if (isShortCode(r.short_code)) return r.short_code;
    return String(r.quote_code || r.quote_id || '').trim();
}

module.exports = { SHORT_CODE_RE, isShortCode, visibleCode };
