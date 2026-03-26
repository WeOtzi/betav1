// ============================================
// WE OTZI - BIO FORMATTING UTILITY
// Shared sanitization, rendering and plain-text
// extraction for artist bio_description (HTML).
// ============================================

const BioFormatting = (function () {
    'use strict';

    const ALLOWED_TAGS = [
        'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
        'br', 'div', 'p', 'span', 'a',
        'ul', 'ol', 'li'
    ];

    const ALLOWED_ATTRS = {
        a: ['href', 'target', 'rel'],
        span: ['style'],
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

    function escapeAttrValue(val) {
        return val
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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
            if (ALLOWED_STYLE_PROPS.includes(prop) && !val.includes('expression') && !val.includes('url(') && !val.includes('javascript')) {
                kept.push(prop + ': ' + val);
            }
        }
        return kept.join('; ');
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
            const frag = doc.createDocumentFragment();
            for (const child of Array.from(node.childNodes)) {
                const cleaned = sanitizeNode(child, doc);
                if (cleaned) frag.appendChild(cleaned);
            }
            return frag;
        }

        const el = doc.createElement(tag);
        const allowedForTag = ALLOWED_ATTRS[tag] || [];

        for (const attrName of allowedForTag) {
            const rawVal = node.getAttribute(attrName);
            if (rawVal == null) continue;

            if (attrName === 'href') {
                const trimmed = rawVal.trim().toLowerCase();
                if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
                    continue;
                }
                el.setAttribute('href', rawVal);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
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

        const trimmed = rawHtml.trim();
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

    function renderBioHtml(targetElement, bioHtml) {
        if (!targetElement) return;
        const safe = sanitizeBioHtml(bioHtml);
        if (safe) {
            targetElement.innerHTML = safe;
        } else {
            targetElement.textContent = targetElement.dataset.emptyMessage ||
                'Sin bio aun.';
        }
    }

    function bioHtmlToPlainText(bioHtml) {
        if (!bioHtml || typeof bioHtml !== 'string') return '';
        const doc = document.implementation.createHTMLDocument('');
        const el = doc.createElement('div');
        el.innerHTML = bioHtml;
        return (el.textContent || el.innerText || '').trim();
    }

    return {
        sanitizeBioHtml: sanitizeBioHtml,
        renderBioHtml: renderBioHtml,
        bioHtmlToPlainText: bioHtmlToPlainText,
        ALLOWED_TAGS: ALLOWED_TAGS
    };
})();

if (typeof window !== 'undefined') {
    window.BioFormatting = BioFormatting;
}
