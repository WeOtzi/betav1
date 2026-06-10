// ============================================
// WE OTZI - BIO FORMATTING UTILITY
// Shared sanitization, rendering and plain-text
// extraction for artist bio_description (HTML).
// ============================================

const BioFormatting = (function () {
    'use strict';

    const ALLOWED_TAGS = [
        'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
        'br', 'div', 'p', 'span', 'a', 'font',
        'ul', 'ol', 'li'
    ];

    const ALLOWED_ATTRS = {
        a: ['href', 'target', 'rel'],
        span: ['style'],
        font: ['color'],
        b: [], strong: [], i: [], em: [], u: [], s: [], strike: [], del: [],
        br: [], div: ['style'], p: ['style'],
        ul: [], ol: [], li: []
    };

    // iOS Safari uses span+style instead of semantic tags for bold/italic/underline,
    // so we must allow these CSS properties to preserve formatting across all browsers.
    const ALLOWED_STYLE_PROPS = [
        'color', 'background-color', 'background',
        'font-weight', 'font-style',
        'text-decoration', 'text-decoration-line', 'text-decoration-style'
    ];

    const OUTPUT_TAG_MAP = {
        font: 'span'
    };

    const BLOCK_TEXT_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol']);
    const DROP_CONTENT_TAGS = new Set([
        'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
        'template', 'noscript', 'meta', 'link', 'base', 'form', 'input',
        'button', 'textarea', 'select', 'option', 'img', 'video', 'audio',
        'source', 'canvas'
    ]);
    const ALLOWED_TEXT_DECORATION_TOKENS = new Set([
        'none', 'underline', 'line-through', 'overline',
        'solid', 'double', 'dotted', 'dashed', 'wavy'
    ]);

    function hasHtmlMarkup(value) {
        return /<\/?[a-z][\s\S]*>/i.test(value);
    }

    function escapeAttrValue(val) {
        return val
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeTextAsHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\r\n?/g, '\n')
            .replace(/\n/g, '<br>');
    }

    function normalizeInputHtml(rawHtml) {
        const trimmed = String(rawHtml || '').trim();
        if (!trimmed) return '';
        return hasHtmlMarkup(trimmed) ? trimmed : escapeTextAsHtml(trimmed);
    }

    function rejectDangerousStyleValue(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return !normalized
            || normalized.length > 120
            || /expression\s*\(/i.test(normalized)
            || /url\s*\(/i.test(normalized)
            || /javascript\s*:/i.test(normalized)
            || /vbscript\s*:/i.test(normalized)
            || /data\s*:/i.test(normalized)
            || /@import/i.test(normalized)
            || /-moz-binding/i.test(normalized)
            || /behavior\s*:/i.test(normalized)
            || /[<>{}\\]/.test(normalized);
    }

    function normalizeCssColor(value, property) {
        if (rejectDangerousStyleValue(value)) return '';

        const probe = document.createElement('span');
        const targetProp = property === 'background' ? 'backgroundColor' : 'color';
        probe.style[targetProp] = '';
        probe.style[targetProp] = String(value || '').trim();
        return probe.style[targetProp] || '';
    }

    function normalizeFontWeight(value) {
        if (rejectDangerousStyleValue(value)) return '';
        const normalized = String(value || '').trim().toLowerCase();
        if (['normal', 'bold', 'bolder', 'lighter'].includes(normalized)) return normalized;
        if (/^[1-9]00$/.test(normalized) && Number(normalized) <= 900) return normalized;
        return '';
    }

    function normalizeFontStyle(value) {
        if (rejectDangerousStyleValue(value)) return '';
        const normalized = String(value || '').trim().toLowerCase();
        return ['normal', 'italic', 'oblique'].includes(normalized) ? normalized : '';
    }

    function normalizeTextDecoration(value) {
        if (rejectDangerousStyleValue(value)) return '';
        const tokens = String(value || '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
        if (!tokens.length) return '';
        return tokens.every((token) => ALLOWED_TEXT_DECORATION_TOKENS.has(token))
            ? tokens.join(' ')
            : '';
    }

    function normalizeStyleDeclaration(prop, value) {
        if (!ALLOWED_STYLE_PROPS.includes(prop)) return null;

        if (prop === 'color' || prop === 'background-color' || prop === 'background') {
            const color = normalizeCssColor(value, prop);
            if (!color) return null;
            return {
                prop: prop === 'background' ? 'background-color' : prop,
                value: color
            };
        }

        if (prop === 'font-weight') {
            const fontWeight = normalizeFontWeight(value);
            return fontWeight ? { prop, value: fontWeight } : null;
        }

        if (prop === 'font-style') {
            const fontStyle = normalizeFontStyle(value);
            return fontStyle ? { prop, value: fontStyle } : null;
        }

        if (prop === 'text-decoration' || prop === 'text-decoration-line' || prop === 'text-decoration-style') {
            const decoration = normalizeTextDecoration(value);
            return decoration ? { prop, value: decoration } : null;
        }

        return null;
    }

    function parseStyleString(raw) {
        if (!raw) return '';
        const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
        const kept = [];
        for (const part of parts) {
            const colonIdx = part.indexOf(':');
            if (colonIdx === -1) continue;
            const prop = part.slice(0, colonIdx).trim().toLowerCase();
            const val  = part.slice(colonIdx + 1).trim();
            const safeDeclaration = normalizeStyleDeclaration(prop, val);
            if (safeDeclaration) kept.push(safeDeclaration.prop + ': ' + safeDeclaration.value);
        }
        return kept.join('; ');
    }

    function sanitizeHref(rawVal) {
        const raw = String(rawVal || '').trim();
        if (!raw) return '';

        const lower = raw.toLowerCase().replace(/\s+/g, '');
        if (
            lower.startsWith('javascript:')
            || lower.startsWith('data:')
            || lower.startsWith('vbscript:')
        ) {
            return '';
        }

        try {
            const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
            const fallbackBase = /^https?:/i.test(window.location.href)
                ? window.location.href
                : 'https://weotzi.local/';
            const parsed = isAbsolute ? new URL(raw) : new URL(raw, fallbackBase);
            if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return raw;
        } catch {
            return '';
        }

        if (raw.startsWith('/') || raw.startsWith('#')) return raw;
        return '';
    }

    function sanitizeNode(node, doc) {
        if (node.nodeType === Node.TEXT_NODE) {
            return doc.createTextNode(node.textContent);
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        const tag = node.tagName.toLowerCase();

        if (!ALLOWED_TAGS.includes(tag)) {
            if (DROP_CONTENT_TAGS.has(tag)) return null;

            const frag = doc.createDocumentFragment();
            for (const child of Array.from(node.childNodes)) {
                const cleaned = sanitizeNode(child, doc);
                if (cleaned) frag.appendChild(cleaned);
            }
            return frag;
        }

        const el = doc.createElement(OUTPUT_TAG_MAP[tag] || tag);
        const allowedForTag = ALLOWED_ATTRS[tag] || [];

        for (const attrName of allowedForTag) {
            const rawVal = node.getAttribute(attrName);
            if (rawVal == null) continue;

            if (attrName === 'href') {
                const href = sanitizeHref(rawVal);
                if (!href) continue;
                el.setAttribute('href', href);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
                continue;
            }

            if (tag === 'font' && attrName === 'color') {
                const color = normalizeCssColor(rawVal, 'color');
                if (color) el.setAttribute('style', `color: ${color}`);
                continue;
            }

            if (attrName === 'style') {
                const safe = parseStyleString(rawVal);
                if (safe) el.setAttribute('style', safe);
                continue;
            }

            if (attrName === 'target' || attrName === 'rel') continue;

            el.setAttribute(attrName, escapeAttrValue(rawVal));
        }

        if (tag === 'span' && !el.getAttribute('style')) {
            const frag = doc.createDocumentFragment();
            for (const child of Array.from(node.childNodes)) {
                const cleaned = sanitizeNode(child, doc);
                if (cleaned) frag.appendChild(cleaned);
            }
            return frag;
        }

        for (const child of Array.from(node.childNodes)) {
            const cleaned = sanitizeNode(child, doc);
            if (cleaned) el.appendChild(cleaned);
        }

        return el;
    }

    function sanitizeBioHtml(rawHtml) {
        if (!rawHtml || typeof rawHtml !== 'string') return '';

        const trimmed = normalizeInputHtml(rawHtml);
        if (!trimmed) return '';

        const doc = document.implementation.createHTMLDocument('');
        const container = doc.createElement('div');
        container.innerHTML = trimmed;

        const result = doc.createElement('div');
        for (const child of Array.from(container.childNodes)) {
            const cleaned = sanitizeNode(child, doc);
            if (cleaned) result.appendChild(cleaned);
        }

        let html = result.innerHTML;
        html = html.replace(/(<br\s*\/?>){4,}/gi, '<br><br><br>');
        return html;
    }

    function renderBioHtml(targetElement, bioHtml, options = {}) {
        if (!targetElement) return;
        const safe = sanitizeBioHtml(bioHtml);
        if (safe) {
            targetElement.innerHTML = safe;
        } else {
            targetElement.textContent = options.emptyMessage
                || targetElement.dataset.emptyMessage
                || 'Sin bio aun.';
        }
    }

    function bioHtmlToPlainText(bioHtml) {
        if (!bioHtml || typeof bioHtml !== 'string') return '';
        const safe = sanitizeBioHtml(bioHtml);
        if (!safe) return '';

        const doc = document.implementation.createHTMLDocument('');
        const el = doc.createElement('div');
        el.innerHTML = safe;
        const parts = [];

        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                parts.push(node.textContent || '');
                return;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName.toLowerCase();
            if (tag === 'br') {
                parts.push('\n');
                return;
            }

            for (const child of Array.from(node.childNodes)) {
                walk(child);
            }

            if (BLOCK_TEXT_TAGS.has(tag)) {
                parts.push('\n');
            }
        }

        walk(el);
        return parts.join('')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }

    function splitGraphemes(value) {
        if (
            typeof Intl !== 'undefined'
            && typeof Intl.Segmenter === 'function'
        ) {
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            return Array.from(segmenter.segment(value), segment => segment.segment);
        }
        return Array.from(value);
    }

    function truncatePlainText(value, maxLength = 220, ellipsis = '...') {
        const text = String(value || '').trim();
        if (!text || !Number.isFinite(maxLength) || maxLength <= 0) return text;

        const segments = splitGraphemes(text);
        if (segments.length <= maxLength) return text;

        const ellipsisLength = splitGraphemes(ellipsis).length;
        const sliceLength = Math.max(1, maxLength - ellipsisLength);
        return segments.slice(0, sliceLength).join('').trimEnd() + ellipsis;
    }

    function getBioPlainTextSnippet(bioHtml, maxLength = 220, fallback = '') {
        const text = bioHtmlToPlainText(bioHtml);
        if (!text) return fallback;
        return truncatePlainText(text, maxLength);
    }

    function renderBioPlainTextSnippet(targetElement, bioHtml, options = {}) {
        if (!targetElement) return;
        const fallback = options.emptyMessage
            || targetElement.dataset.emptyMessage
            || '';
        const text = getBioPlainTextSnippet(bioHtml, options.maxLength || 220, fallback);
        targetElement.textContent = text || fallback;
    }

    return {
        sanitizeBioHtml: sanitizeBioHtml,
        renderBioHtml: renderBioHtml,
        renderBioPlainTextSnippet: renderBioPlainTextSnippet,
        getBioPlainTextSnippet: getBioPlainTextSnippet,
        truncatePlainText: truncatePlainText,
        bioHtmlToPlainText: bioHtmlToPlainText,
        ALLOWED_TAGS: ALLOWED_TAGS
    };
})();

if (typeof window !== 'undefined') {
    window.BioFormatting = BioFormatting;
}
