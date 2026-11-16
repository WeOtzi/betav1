'use strict';

// ===========================================================================
// Render de correos en el servidor
// ---------------------------------------------------------------------------
// renderEmail(eventId, payload, { role, timezone, baseUrl }) devuelve
//   { subject, preheader, html, text, headers, category, audience, role }
// usando el spec del evento: el `render` del archivo de services/email-events
// (si existe) o lib/email-render/specs.js. El layout común está en layout.js.
// ===========================================================================

const { SPECS } = require('./specs');
const { renderLayout, renderPlainText, SUPPORT_EMAIL } = require('./layout');
const { formatter, publicBaseUrl, safeUrl, truncate, capitalize } = require('../email-format');

const NON_ESSENTIAL = new Set(['quotations', 'messages', 'calendar', 'studios']);
const PREFERENCES_PATH = {
    artist: '/artist/account#notificaciones',
    client: '/client/profile#notificaciones'
};
const PREHEADER_MIN = 40;
const PREHEADER_MAX = 110;

let warned = new Set();

function mapping() {
    // require diferido: email-event-mapping no depende del render.
    return require('../../services/email-event-mapping');
}

/** Spec efectivo de un evento (archivo de email-events > specs.js). */
function getSpec(eventId) {
    const event = mapping().getEvent(eventId);
    if (event && event.render && typeof event.render === 'object') return event.render;
    return SPECS[eventId] || null;
}

function hasSpec(eventId) {
    return !!getSpec(eventId);
}

function call(spec, key, d, ctx, eventId) {
    const value = spec[key];
    if (typeof value !== 'function') return value;
    try {
        return value(d, ctx);
    } catch (error) {
        const tag = `${eventId}.${key}`;
        if (!warned.has(tag)) {
            warned.add(tag);
            console.warn(`[email-render] ${tag} falló: ${error.message}`);
        }
        return undefined;
    }
}

function oneLine(value, max) {
    return truncate(String(value === undefined || value === null ? '' : value).replace(/[\r\n]+/g, ' '), max);
}

function normalizePreheader(preheader, intro, headline) {
    let text = oneLine(preheader, PREHEADER_MAX);
    if (text.length < PREHEADER_MIN) {
        text = oneLine([text, intro || headline].filter(Boolean).join(' · '), PREHEADER_MAX);
    }
    if (text.length < PREHEADER_MIN) text = oneLine(`${text} · Entrá a We Ötzi para ver el detalle.`, PREHEADER_MAX);
    return text;
}

const WEEKDAY_RE = /^(lunes|martes|miércoles|jueves|viernes|sábado|domingo)(?=[\s,])/;
function capitalizeDate(value) {
    return WEEKDAY_RE.test(value) ? capitalize(value) : value;
}

function normalizeLink(link) {
    if (!link || typeof link !== 'object') return null;
    const url = safeUrl(link.url);
    return url && link.label ? { label: String(link.label), url } : null;
}

/**
 * @param {string} eventId
 * @param {object} payload  datos ya validados por el servidor
 * @param {{ role?: string, timezone?: string, baseUrl?: string }} [options]
 */
function renderEmail(eventId, payload, options = {}) {
    const d = payload && typeof payload === 'object' ? payload : {};
    const base = (safeUrl(options.baseUrl) || safeUrl(d.app_base_url) || publicBaseUrl()).replace(/\/+$/, '');
    const event = mapping().getEvent(eventId);
    const baseSpec = getSpec(eventId) || {
        audience: 'client',
        category: 'transactional',
        subject: () => (event && event.name) || 'Novedades en We Ötzi',
        headline: () => (event && event.name) || 'Novedades en We Ötzi',
        intro: () => (event && event.description) || 'Tenés una novedad en tu cuenta de We Ötzi.',
        rows: () => []
    };
    const role = options.role || d.recipient_role || baseSpec.audience || 'client';
    const spec = { ...baseSpec, ...((baseSpec.roles && baseSpec.roles[role]) || {}) };
    const f = formatter(options.timezone || d.recipient_timezone);
    const ctx = { role, f, base, url: (p = '/') => `${base}${String(p).startsWith('/') ? '' : '/'}${p}` };

    const headline = oneLine(call(spec, 'headline', d, ctx, eventId) || (event && event.name) || 'We Ötzi', 160);
    const intro = String(call(spec, 'intro', d, ctx, eventId) || '').trim();
    const subject = oneLine(call(spec, 'subject', d, ctx, eventId) || headline, 140);
    const preheader = normalizePreheader(call(spec, 'preheader', d, ctx, eventId), intro, headline);
    const rows = (call(spec, 'rows', d, ctx, eventId) || [])
        .filter(row => Array.isArray(row) && row.length >= 2)
        .map(([label, value]) => [oneLine(label, 60), capitalizeDate(f.value(value))])
        .filter(([label, value]) => label && value);
    const highlight = call(spec, 'highlight', d, ctx, eventId) || null;
    const quote = call(spec, 'quote', d, ctx, eventId) || null;
    const ctaRaw = call(spec, 'cta', d, ctx, eventId);
    const cta = normalizeLink(ctaRaw);
    const secondary = normalizeLink(call(spec, 'secondary', d, ctx, eventId));
    const links = (call(spec, 'links', d, ctx, eventId) || []).map(normalizeLink).filter(Boolean);
    const category = spec.category || 'transactional';
    const prefsPath = NON_ESSENTIAL.has(category) ? PREFERENCES_PATH[role] : null;
    const preferencesUrl = prefsPath ? ctx.url(prefsPath) : '';

    const model = {
        subject,
        preheader,
        eyebrow: call(spec, 'eyebrow', d, ctx, eventId) || '',
        greeting: call(spec, 'greeting', d, ctx, eventId) || '',
        headline,
        intro,
        highlight: highlight && highlight.value ? { ...highlight, value: String(highlight.value) } : null,
        quote: quote && quote.text ? quote : null,
        note: call(spec, 'note', d, ctx, eventId) || '',
        rows,
        rowsTitle: call(spec, 'rowsTitle', d, ctx, eventId) || (rows.length > 1 ? 'Detalle' : ''),
        links,
        linksTitle: call(spec, 'linksTitle', d, ctx, eventId) || '',
        cta,
        secondary,
        aside: call(spec, 'aside', d, ctx, eventId) || null,
        footer: {
            baseUrl: base,
            preferencesUrl,
            // Sin verbo conjugado: sirve en los correos viejos (voseo) y en los nuevos (tuteo). EP-10.
            reason: preferencesUrl ? 'Este aviso te llega por tu actividad en We Ötzi.' : ''
        }
    };

    const headers = {};
    if (preferencesUrl) {
        headers['List-Unsubscribe'] = `<${preferencesUrl}>, <mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Baja de avisos por email')}>`;
    }
    return {
        eventId,
        role,
        audience: baseSpec.audience || role,
        category,
        subject,
        preheader,
        html: renderLayout(model),
        text: renderPlainText(model),
        headers,
        cta
    };
}

module.exports = { renderEmail, getSpec, hasSpec, NON_ESSENTIAL, PREFERENCES_PATH };
