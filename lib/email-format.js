'use strict';

// ===========================================================================
// Formato de valores para los correos (render en servidor)
// ---------------------------------------------------------------------------
// Funciones puras: escape HTML, fechas en español con la zona horaria del
// destinatario, montos, booleanos (Sí/No), truncado y validación de URLs.
// La usan lib/email-render (HTML y texto plano) y scripts/email-preview.js.
// Ningún valor de usuario llega al HTML sin pasar por escapeHtml().
// ===========================================================================

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_PUBLIC_BASE = 'https://beta.weotzi.com';
const LOCALE = 'es-AR';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Texto multilínea escapado con saltos de línea como <br>. */
function escapeMultiline(value) {
    return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

function validTimezone(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try {
        new Intl.DateTimeFormat(LOCALE, { timeZone: tz });
        return true;
    } catch (_) {
        return false;
    }
}

function resolveTimezone(tz) {
    return validTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

function isIsoDate(value) {
    return typeof value === 'string' && ISO_DATE_RE.test(value.trim());
}

function toDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw = value.trim();
    // "2026-11-20" es una fecha de calendario: se fija al mediodía UTC para que
    // ninguna zona horaria la corra al día anterior.
    const d = DATE_ONLY_RE.test(raw) ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "viernes, 20 de noviembre de 2026" (en minúscula: va dentro de frases) */
function formatDate(value, tz) {
    const d = toDate(value);
    if (!d) return '';
    const dateOnly = typeof value === 'string' && DATE_ONLY_RE.test(value.trim());
    return (new Intl.DateTimeFormat(LOCALE, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: dateOnly ? 'UTC' : resolveTimezone(tz)
    }).format(d));
}

/** "viernes, 20 de noviembre de 2026, 15:30 h" (fecha sola si no trae hora) */
function formatDateTime(value, tz) {
    const d = toDate(value);
    if (!d) return '';
    if (typeof value === 'string' && DATE_ONLY_RE.test(value.trim())) return formatDate(value, tz);
    const zone = resolveTimezone(tz);
    const date = formatDate(d, zone);
    const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone }).format(d);
    return `${date}, ${time} h`;
}

function parseAmount(amount) {
    if (typeof amount === 'number') return amount;
    let s = String(amount).trim().replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return Number(s);
}

/** Monto + moneda: "250 USD" · "120.000 ARS". Vacío si no hay monto. */
function formatMoney(amount, currency) {
    if (amount === undefined || amount === null || String(amount).trim() === '') return '';
    const code = String(currency || '').trim().toUpperCase().slice(0, 6);
    const num = parseAmount(amount);
    if (!Number.isFinite(num)) {
        const text = String(amount).trim();
        return text ? `${text}${code ? ` ${code}` : ''}` : '';
    }
    const formatted = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(num);
    return code ? `${formatted} ${code}` : formatted;
}

function formatBool(value) {
    if (value === true || value === 'true' || value === 'si' || value === 'sí' || value === 'yes') return 'Sí';
    if (value === false || value === 'false' || value === 'no') return 'No';
    return '';
}

function truncate(value, max = 280) {
    const text = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/** Lista legible: "Realismo · Blackwork". Acepta arrays, JSON de arrays o texto. */
function formatList(value, sep = ' · ') {
    let list = value;
    if (typeof value === 'string' && value.trim().startsWith('[')) {
        try { list = JSON.parse(value); } catch (_) { list = value; }
    }
    if (Array.isArray(list)) {
        return list.map(item => (item && typeof item === 'object' ? item.name || item.label || '' : item))
            .map(item => String(item === undefined || item === null ? '' : item).trim())
            .filter(Boolean).join(sep);
    }
    return typeof list === 'string' ? list.trim() : '';
}

/** URL absoluta http(s) o '' (nunca javascript:, data:, relativas). */
function safeUrl(value) {
    if (!value || typeof value !== 'string') return '';
    try {
        const url = new URL(value.trim());
        if (url.protocol === 'https:') return url.toString();
        if (url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) return url.toString();
        return '';
    } catch (_) {
        return '';
    }
}

/** Base pública de la app para links de email (PUBLIC_APP_URL > APP_URL > beta). */
function publicBaseUrl(env = process.env) {
    const configured = (env && (env.PUBLIC_APP_URL || env.APP_URL)) || '';
    const base = safeUrl(configured) ? configured : DEFAULT_PUBLIC_BASE;
    return base.replace(/\/+$/, '');
}

/**
 * Valor "humano" para una fila clave-valor: '' (se omite la fila) para
 * vacíos, null/undefined/objetos; Sí/No para booleanos; fecha para ISO.
 */
function displayValue(value, tz) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return formatBool(value);
    if (typeof value === 'number') return Number.isFinite(value) ? new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(value) : '';
    if (Array.isArray(value)) return formatList(value);
    if (typeof value === 'object') return '';
    const text = String(value).trim();
    if (!text || /^(null|undefined|nan|-)$/i.test(text)) return '';
    if (/^(true|false)$/i.test(text)) return formatBool(text.toLowerCase());
    if (isIsoDate(text)) return capitalize(formatDateTime(text, tz));
    if (text.startsWith('[') && text.endsWith(']')) return formatList(text);
    return text;
}

/** Helpers que reciben los specs (ctx.f), atados a la zona del destinatario. */
function formatter(tz) {
    const zone = resolveTimezone(tz);
    return {
        tz: zone,
        date: v => formatDate(v, zone),
        dateTime: v => formatDateTime(v, zone),
        money: (amount, currency) => formatMoney(amount, currency),
        bool: formatBool,
        text: (v, max) => truncate(v, max),
        list: formatList,
        value: v => displayValue(v, zone),
        url: safeUrl
    };
}

module.exports = {
    DEFAULT_TIMEZONE,
    DEFAULT_PUBLIC_BASE,
    escapeHtml,
    escapeMultiline,
    validTimezone,
    resolveTimezone,
    isIsoDate,
    formatDate,
    formatDateTime,
    formatMoney,
    formatBool,
    truncate,
    formatList,
    safeUrl,
    publicBaseUrl,
    displayValue,
    capitalize,
    formatter
};
