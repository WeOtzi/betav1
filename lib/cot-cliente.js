'use strict';

// ===========================================================================
// Cotizaciones del cliente (beta cerrada · frente cot-cliente) — lógica pura.
// ---------------------------------------------------------------------------
// Sin I/O: la usan las rutas de lib/routes/cot-cliente.js y los tests.
//
//   · Vínculo de cotizaciones de invitado (CC-02 / ACC-12): qué filas puede
//     reclamar una cuenta con el email VERIFICADO.
//   · Decisión del cliente sobre la propuesta del artista (CC-01): validación de
//     dueño, estado, disputa y vencimiento, y el patch que se guarda.
//   · Hook para el frente "turnos": onClientDecision(fn) se dispara después de
//     guardar la decisión (ver runClientDecisionHooks).
// ===========================================================================

const DECISIONS = Object.freeze({
    approve: 'client_approved',
    reject: 'client_rejected',
});

const MAX_REASON = 500;

function normEmail(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

function hasValue(value) {
    return value != null && String(value).trim() !== '';
}

// Borrador del cotizador: in_progress sin respuesta del artista. Mismo criterio
// que QuotationsViewModel.isClientWizardDraft y la función SQL
// public.cot_cliente_is_wizard_draft (migración 20261115140000).
function isWizardDraft(q) {
    return !!q && q.quote_status === 'in_progress'
        && !q.artist_responded_at && !hasValue(q.artist_budget_amount) && !hasValue(q.final_budget_amount);
}

// Email verificado de verdad: confirmado y sin la marca de cuentas de QA.
function isEmailVerified(user) {
    const raw = (user && user.raw) || {};
    if (!user || !user.email || !raw.email_confirmed_at) return false;
    if (raw.app_metadata && (raw.app_metadata.qa_unverified_email === true || raw.app_metadata.qa_unverified_email === 'true')) return false;
    if (raw.user_metadata && (raw.user_metadata.qa_unverified_email === true || raw.user_metadata.qa_unverified_email === 'true')) return false;
    return true;
}

// ¿La cuenta puede reclamar esta cotización sin dueño por su email verificado?
function canClaim(user, q) {
    return !!q && !q.client_user_id && isEmailVerified(user)
        && normEmail(q.client_email) !== '' && normEmail(q.client_email) === normEmail(user.email)
        && !isWizardDraft(q);
}

// Filtra los candidatos de la consulta por ilike: igualdad exacta (sin
// mayúsculas ni espacios), sin dueño y sin borradores.
function filterClaimable(rows, user) {
    if (!isEmailVerified(user)) return [];
    return (Array.isArray(rows) ? rows : []).filter((q) => canClaim(user, q));
}

// Escapa los comodines de LIKE para el filtro ilike de PostgREST.
function escapeLike(value) {
    return String(value == null ? '' : value).replace(/[\\%_]/g, (c) => '\\' + c);
}

function isExpired(q, now = Date.now()) {
    if (!q) return false;
    if (q.quote_status === 'expired') return true;
    if (!q.quote_expires_at) return false;
    const at = Date.parse(q.quote_expires_at);
    return Number.isFinite(at) && at <= now;
}

function normalizeDecisionBody(body) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const raw = String(b.decision || '').trim().toLowerCase();
    const decision = raw === 'approve' || raw === 'accept' ? 'approve' : raw === 'reject' ? 'reject' : null;
    if (!decision) return { ok: false, status: 400, error: 'Indicá si aceptás o rechazás la propuesta.' };
    const reason = String(b.reason == null ? '' : b.reason).replace(/\s+/g, ' ').trim().slice(0, MAX_REASON);
    return { ok: true, decision, reason: decision === 'reject' ? reason : '' };
}

const STATUS_BLOCK = {
    pending: 'El artista todavía no te mandó su propuesta.',
    in_progress: 'Esta cotización ya está en curso.',
    en_progreso: 'Esta cotización ya está en curso.',
    client_approved: 'Ya aceptaste esta propuesta.',
    client_rejected: 'Ya rechazaste esta propuesta.',
    artist_completed: 'Esta cotización ya está en curso.',
    completed: 'Esta cotización ya terminó.',
    cancelled: 'El artista canceló esta solicitud.',
    expired: 'La propuesta venció. Escribile al artista si querés retomarla.',
};

/**
 * Valida la decisión. Devuelve
 *   { ok:false, status, code, error }
 *   { ok:true, already:true, targetStatus }            (idempotente)
 *   { ok:true, claim:boolean, targetStatus }
 */
function evaluateDecision({ user, quotation, decision, now = Date.now() }) {
    if (!user) return { ok: false, status: 401, code: 'auth', error: 'Iniciá sesión para responder la propuesta.' };
    if (!quotation) return { ok: false, status: 404, code: 'not_found', error: 'No encontramos esa cotización.' };
    const targetStatus = DECISIONS[decision];
    if (!targetStatus) return { ok: false, status: 400, code: 'decision', error: 'Indicá si aceptás o rechazás la propuesta.' };

    const owner = quotation.client_user_id && quotation.client_user_id === user.id;
    const claim = !owner && canClaim(user, quotation);
    if (!owner && !claim) return { ok: false, status: 403, code: 'not_owner', error: 'Esta cotización no corresponde a tu cuenta.' };

    if (quotation.quote_status === targetStatus) return { ok: true, already: true, claim, targetStatus };
    if ((quotation.dispute_status || 'none') === 'open') {
        return { ok: false, status: 409, code: 'dispute', error: 'Esta cotización tiene un reclamo abierto. Soporte lo está revisando.' };
    }
    if (quotation.quote_status !== 'responded') {
        return { ok: false, status: 409, code: 'status', error: STATUS_BLOCK[quotation.quote_status] || 'El estado de la cotización cambió. Actualizá la página.' };
    }
    if (isExpired(quotation, now)) {
        return { ok: false, status: 410, code: 'expired', error: STATUS_BLOCK.expired };
    }
    return { ok: true, claim, targetStatus };
}

// Patch que se guarda. Al aceptar, la propuesta del artista pasa a ser el
// acuerdo (final_*), sin pisar un acuerdo que el artista ya haya cargado.
function decisionPatch(quotation, decision) {
    const q = quotation || {};
    if (decision === 'reject') return { quote_status: DECISIONS.reject };
    const patch = { quote_status: DECISIONS.approve };
    if (!hasValue(q.final_budget_amount) && hasValue(q.artist_budget_amount)) {
        patch.final_budget_amount = String(q.artist_budget_amount);
        patch.final_budget_currency = q.final_budget_currency || q.artist_budget_currency || null;
    }
    if (!hasValue(q.final_sessions) && hasValue(q.tattoo_estimated_sessions)) {
        const n = Number.parseInt(String(q.tattoo_estimated_sessions), 10);
        if (Number.isFinite(n) && n > 0) patch.final_sessions = String(n);
    }
    return patch;
}

function styleText(value) {
    const list = Array.isArray(value) ? value : [value];
    return list.map((s) => {
        if (typeof s === 'string') return s.trim();
        if (s && typeof s === 'object') return String(s.style_name || '').trim();
        return '';
    }).filter(Boolean).join(', ');
}

function moneyText(amount, currency) {
    if (!hasValue(amount)) return '';
    return `${String(amount).trim()} ${String(currency || '').trim()}`.trim();
}

/**
 * Payloads de los avisos. `base` sale de la configuración del servidor
 * (applicationBase), nunca del navegador.
 */
function decisionEmailPayloads({ quotation, decision, reason, base, artist, saved }) {
    const q = Object.assign({}, quotation || {}, saved || {});
    const quoteId = q.quote_id;
    const amount = hasValue(q.final_budget_amount) ? q.final_budget_amount : q.artist_budget_amount;
    const currency = hasValue(q.final_budget_amount) ? (q.final_budget_currency || q.artist_budget_currency) : q.artist_budget_currency;
    const shared = {
        quote_id: quoteId,
        decision,
        decision_label: decision === 'approve' ? 'aceptó' : 'rechazó',
        decision_reason: reason || '',
        client_name: q.client_full_name || '',
        client_email: q.client_email || '',
        artist_name: (artist && artist.name) || q.artist_name || '',
        artist_email: (artist && artist.email) || q.artist_email || '',
        artist_budget_amount: hasValue(amount) ? String(amount) : '',
        artist_budget_currency: currency || '',
        budget_text: moneyText(amount, currency),
        sessions: hasValue(q.final_sessions) ? String(q.final_sessions) : (hasValue(q.tattoo_estimated_sessions) ? String(q.tattoo_estimated_sessions) : ''),
        tattoo_style: styleText(q.tattoo_style),
        tattoo_body_part: q.tattoo_body_part || '',
        tattoo_size: q.tattoo_size || '',
    };
    const enc = encodeURIComponent(quoteId || '');
    return {
        artist: Object.assign({}, shared, {
            recipient_email: shared.artist_email,
            quotation_url: `${base}/my-quotations/detail?quote=${enc}`,
            dashboard_url: `${base}/artist/dashboard`,
        }),
        client: Object.assign({}, shared, {
            recipient_email: shared.client_email,
            quotation_url: `${base}/client/dashboard?quote=${enc}`,
            dashboard_url: `${base}/client/dashboard`,
        }),
    };
}

// ---------------------------------------------------------------------------
// Hook para el frente "turnos" (y cualquier otro interesado).
// Se registra una vez al cargar el módulo del frente:
//   require('../cot-cliente').onClientDecision(async (evt) => { ... });
// evt = { decision:'approve'|'reject', status, quotation (fila guardada),
//         userId, sessions (quotation_sessions 'scheduled' de la cotización) }
// Los errores de un hook se loguean y no afectan la respuesta al cliente.
// ---------------------------------------------------------------------------
const decisionHooks = [];

function onClientDecision(fn) {
    if (typeof fn !== 'function') throw new TypeError('onClientDecision espera una función');
    decisionHooks.push(fn);
    return () => {
        const i = decisionHooks.indexOf(fn);
        if (i !== -1) decisionHooks.splice(i, 1);
    };
}

async function runClientDecisionHooks(evt, logger = console) {
    const results = [];
    for (const fn of decisionHooks.slice()) {
        try {
            results.push({ ok: true, value: await fn(evt) });
        } catch (err) {
            if (logger && logger.warn) logger.warn('[cot-cliente] hook onClientDecision falló:', err && err.message);
            results.push({ ok: false, error: err && err.message });
        }
    }
    return results;
}

module.exports = {
    DECISIONS,
    MAX_REASON,
    normEmail,
    isWizardDraft,
    isEmailVerified,
    canClaim,
    filterClaimable,
    escapeLike,
    isExpired,
    normalizeDecisionBody,
    evaluateDecision,
    decisionPatch,
    decisionEmailPayloads,
    styleText,
    onClientDecision,
    runClientDecisionHooks,
};
