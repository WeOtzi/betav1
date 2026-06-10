const MAX_BIO_HTML_LENGTH = 12000;

const ALLOWED_TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
    'br', 'div', 'p', 'span', 'a', 'font',
    'ul', 'ol', 'li'
]);

const DROP_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
    'template', 'noscript', 'meta', 'link', 'base', 'form', 'input',
    'button', 'textarea', 'select', 'option', 'img', 'video', 'audio',
    'source', 'canvas'
]);

const ALLOWED_STYLE_PROPS = new Set([
    'color', 'background-color', 'background',
    'font-weight', 'font-style',
    'text-decoration', 'text-decoration-line', 'text-decoration-style'
]);

const ALLOWED_TEXT_DECORATION_TOKENS = new Set([
    'none', 'underline', 'line-through', 'overline',
    'solid', 'double', 'dotted', 'dashed', 'wavy'
]);

const OUTPUT_TAG_MAP = {
    font: 'span'
};

function hasHtmlMarkup(value) {
    return /<\/?[a-z][\s\S]*>/i.test(value);
}

function escapeTextAsHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r\n?/g, '\n')
        .replace(/\n/g, '<br>');
}

function escapeAttrValue(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

function normalizeCssColor(value) {
    const raw = String(value || '').trim();
    if (rejectDangerousStyleValue(raw)) return '';

    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
    if (/^rgba?\(\s*[-\d.]+%?\s*,\s*[-\d.]+%?\s*,\s*[-\d.]+%?(?:\s*,\s*(?:0|1|0?\.\d+|[-\d.]+%))?\s*\)$/i.test(raw)) return raw;
    if (/^hsla?\(\s*[-\d.]+(?:deg|rad|turn)?\s*,\s*[-\d.]+%\s*,\s*[-\d.]+%(?:\s*,\s*(?:0|1|0?\.\d+|[-\d.]+%))?\s*\)$/i.test(raw)) return raw;
    if (/^[a-z]+$/i.test(raw)) return raw.toLowerCase();

    return '';
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
    return tokens.every(token => ALLOWED_TEXT_DECORATION_TOKENS.has(token))
        ? tokens.join(' ')
        : '';
}

function normalizeStyleDeclaration(prop, value) {
    if (!ALLOWED_STYLE_PROPS.has(prop)) return null;

    if (prop === 'color' || prop === 'background-color' || prop === 'background') {
        const color = normalizeCssColor(value);
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
    const kept = [];
    String(raw)
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(part => {
            const colonIdx = part.indexOf(':');
            if (colonIdx === -1) return;
            const prop = part.slice(0, colonIdx).trim().toLowerCase();
            const value = part.slice(colonIdx + 1).trim();
            const safeDeclaration = normalizeStyleDeclaration(prop, value);
            if (safeDeclaration) kept.push(`${safeDeclaration.prop}: ${safeDeclaration.value}`);
        });
    return kept.join('; ');
}

function sanitizeHref(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';

    const lower = raw.toLowerCase().replace(/\s+/g, '');
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
        return '';
    }

    if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || raw.startsWith('/') || raw.startsWith('#')) {
        return raw;
    }

    return '';
}

function parseAttributes(rawAttrs) {
    const attrs = {};
    const attrRe = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = attrRe.exec(rawAttrs || '')) !== null) {
        const name = String(match[1] || '').toLowerCase();
        if (!name) continue;
        attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    return attrs;
}

function parseTag(token) {
    const match = String(token || '').match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)\b([\s\S]*?)\/?\s*>$/);
    if (!match) return null;
    return {
        closing: Boolean(match[1]),
        tag: match[2].toLowerCase(),
        attrs: parseAttributes(match[3] || ''),
        selfClosing: /\/\s*>$/.test(token)
    };
}

function buildOpeningTag(tag, attrs) {
    const outTag = OUTPUT_TAG_MAP[tag] || tag;

    if (tag === 'br') return '<br>';

    if (tag === 'a') {
        const href = sanitizeHref(attrs.href);
        if (!href) return '<a>';
        return `<a href="${escapeAttrValue(href)}" target="_blank" rel="noopener noreferrer">`;
    }

    if (tag === 'font') {
        const color = normalizeCssColor(attrs.color);
        return color ? `<span style="color: ${escapeAttrValue(color)}">` : '<span>';
    }

    if (tag === 'span' || tag === 'div' || tag === 'p') {
        const style = parseStyleString(attrs.style);
        return style ? `<${outTag} style="${escapeAttrValue(style)}">` : `<${outTag}>`;
    }

    return `<${outTag}>`;
}

function appendWithLimit(parts, value, state) {
    if (!value || state.length >= state.maxLength) return;
    const remaining = state.maxLength - state.length;
    const slice = value.length > remaining ? value.slice(0, remaining) : value;
    parts.push(slice);
    state.length += slice.length;
}

function sanitizeBioHtml(rawHtml, maxLength = MAX_BIO_HTML_LENGTH) {
    const raw = String(rawHtml || '').trim();
    if (!raw) return '';

    const normalized = hasHtmlMarkup(raw) ? raw : escapeTextAsHtml(raw);
    const parts = [];
    const state = { length: 0, maxLength };
    const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;
    const dropStack = [];
    let lastIndex = 0;
    let match;

    while ((match = tokenRe.exec(normalized)) !== null && state.length < maxLength) {
        const token = match[0];
        const text = normalized.slice(lastIndex, match.index);
        lastIndex = tokenRe.lastIndex;

        if (!dropStack.length) {
            appendWithLimit(parts, text, state);
        }

        const parsed = parseTag(token);
        if (!parsed) continue;

        if (dropStack.length) {
            if (parsed.closing && parsed.tag === dropStack[dropStack.length - 1]) {
                dropStack.pop();
            } else if (!parsed.closing && DROP_CONTENT_TAGS.has(parsed.tag) && !parsed.selfClosing) {
                dropStack.push(parsed.tag);
            }
            continue;
        }

        if (DROP_CONTENT_TAGS.has(parsed.tag)) {
            if (!parsed.closing && !parsed.selfClosing) dropStack.push(parsed.tag);
            continue;
        }

        if (!ALLOWED_TAGS.has(parsed.tag)) continue;

        if (parsed.closing) {
            if (parsed.tag === 'br') continue;
            appendWithLimit(parts, `</${OUTPUT_TAG_MAP[parsed.tag] || parsed.tag}>`, state);
            continue;
        }

        appendWithLimit(parts, buildOpeningTag(parsed.tag, parsed.attrs), state);
    }

    if (!dropStack.length && state.length < maxLength) {
        appendWithLimit(parts, normalized.slice(lastIndex), state);
    }

    return parts.join('')
        .replace(/(<br\s*\/?>){4,}/gi, '<br><br><br>')
        .trim();
}

function sanitizeBio(value, maxLength = MAX_BIO_HTML_LENGTH) {
    const safe = sanitizeBioHtml(value, maxLength);
    return safe || null;
}

module.exports = {
    MAX_BIO_HTML_LENGTH,
    sanitizeBio,
    sanitizeBioHtml
};
