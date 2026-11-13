'use strict';

// ===========================================================================
// Saneo server-side de la presentacion del artista (artists_db.bio_description).
// ---------------------------------------------------------------------------
// Revision 12 nov 2026 (pag. 7): la "Breve presentacion" es HTML enriquecido
// (WoRichText) con un maximo de 2000 caracteres de TEXTO VISIBLE.
//
// Allowlist (todo lo demas se descarta; el texto de las etiquetas peligrosas
// tambien):
//   b, strong, i, em, u, mark, p, br, ul, ol, li
//   a[href]  -> solo http(s) y mailto; se fuerza target=_blank y
//               rel="noopener noreferrer"
//   span[style] -> color, background-color y font-size (valores acotados).
//                  Tambien font-weight / font-style / text-decoration: iOS
//                  Safari marca negrita/cursiva/subrayado con span+style en vez
//                  de <b>/<i>/<u>; son los mismos formatos de la allowlist.
// Compatibilidad con bios ya guardadas: <font color> -> <span style="color">,
// <div> -> <p>, y el texto plano (sin etiquetas) se escapa y sus saltos de
// linea pasan a <br>.
//
// El parser es un tokenizador con pila: solo emite cierres de etiquetas
// abiertas y cierra lo que quede abierto, asi el HTML resultante siempre esta
// balanceado aunque se trunque en el limite de texto.
// ===========================================================================

const MAX_BIO_TEXT_LENGTH = 2000;
// Tope defensivo del HTML resultante (markup incluido).
const MAX_BIO_HTML_LENGTH = 16000;

const ALLOWED_TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 'mark',
    'p', 'br', 'span', 'a',
    'ul', 'ol', 'li'
]);

// Etiquetas heredadas que se transforman a una permitida.
const LEGACY_TAG_MAP = {
    font: 'span',
    div: 'p'
};

const VOID_TAGS = new Set(['br']);

const DROP_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
    'template', 'noscript', 'meta', 'link', 'base', 'form', 'input',
    'button', 'textarea', 'select', 'option', 'img', 'video', 'audio',
    'source', 'canvas', 'title', 'head', 'frame', 'frameset', 'applet', 'xmp',
    'noembed', 'noframes', 'plaintext'
]);

const ALLOWED_STYLE_PROPS = new Set([
    'color', 'background-color', 'background', 'font-size',
    'font-weight', 'font-style', 'text-decoration', 'text-decoration-line'
]);

const ALLOWED_TEXT_DECORATION_TOKENS = new Set(['none', 'underline', 'line-through', 'solid', 'double', 'dotted', 'dashed', 'wavy']);

function normalizeFontWeight(value) {
    const v = String(value || '').trim().toLowerCase();
    if (['normal', 'bold', 'bolder', 'lighter'].includes(v)) return v;
    return /^[1-9]00$/.test(v) ? v : '';
}

function normalizeFontStyle(value) {
    const v = String(value || '').trim().toLowerCase();
    return ['normal', 'italic'].includes(v) ? v : '';
}

function normalizeTextDecoration(value) {
    const tokens = String(value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.length > 4) return '';
    return tokens.every(t => ALLOWED_TEXT_DECORATION_TOKENS.has(t)) ? tokens.join(' ') : '';
}

const FONT_SIZE_KEYWORDS = new Set(['x-small', 'small', 'medium', 'large', 'x-large', 'smaller', 'larger']);
const FONT_SIZE_LIMITS = {
    px: [10, 40],
    pt: [8, 30],
    em: [0.6, 2.5],
    rem: [0.6, 2.5],
    '%': [60, 250]
};

const NAMED_COLORS = new Set([
    'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey',
    'cyan', 'magenta', 'lime', 'navy', 'teal', 'olive', 'maroon', 'silver', 'gold', 'indigo', 'violet',
    'crimson', 'coral', 'salmon', 'tomato', 'turquoise', 'transparent', 'inherit', 'currentcolor'
]);

function hasHtmlMarkup(value) {
    return /<\/?[a-z][\s\S]*>/i.test(value);
}

function escapeText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeTextAsHtml(value) {
    return escapeText(value)
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

function decodeAttrEntities(value) {
    return String(value || '')
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => safeFromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);?/g, (_, dec) => safeFromCodePoint(Number.parseInt(dec, 10)))
        .replace(/&(quot|apos|lt|gt|amp|colon|tab|newline);/gi, (_, name) => ({
            quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', colon: ':', tab: '\t', newline: '\n'
        }[name.toLowerCase()]));
}

function safeFromCodePoint(code) {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try { return String.fromCodePoint(code); } catch (_) { return ''; }
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
        || /var\s*\(/i.test(normalized)
        || /[<>{}\\;"'`]/.test(normalized);
}

function normalizeCssColor(value) {
    const raw = String(value || '').trim();
    if (rejectDangerousStyleValue(raw)) return '';
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
    if (/^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i.test(raw)) return raw.toLowerCase();
    if (/^rgba?\(\s*\d{1,3}%?\s+\d{1,3}%?\s+\d{1,3}%?(?:\s*\/\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i.test(raw)) return raw.toLowerCase();
    if (/^hsla?\(\s*-?\d{1,3}(?:\.\d+)?(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i.test(raw)) return raw.toLowerCase();
    if (NAMED_COLORS.has(raw.toLowerCase())) return raw.toLowerCase();
    return '';
}

function normalizeFontSize(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (rejectDangerousStyleValue(raw)) return '';
    if (FONT_SIZE_KEYWORDS.has(raw)) return raw;
    const match = raw.match(/^(\d{1,3}(?:\.\d{1,3})?)(px|pt|em|rem|%)$/);
    if (!match) return '';
    const amount = Number.parseFloat(match[1]);
    const [min, max] = FONT_SIZE_LIMITS[match[2]];
    if (!Number.isFinite(amount) || amount < min || amount > max) return '';
    return `${match[1]}${match[2]}`;
}

function normalizeStyleDeclaration(prop, value) {
    if (!ALLOWED_STYLE_PROPS.has(prop)) return null;
    if (prop === 'font-size') {
        const size = normalizeFontSize(value);
        return size ? { prop, value: size } : null;
    }
    if (rejectDangerousStyleValue(value)) return null;
    if (prop === 'font-weight') {
        const weight = normalizeFontWeight(value);
        return weight ? { prop, value: weight } : null;
    }
    if (prop === 'font-style') {
        const style = normalizeFontStyle(value);
        return style ? { prop, value: style } : null;
    }
    if (prop === 'text-decoration' || prop === 'text-decoration-line') {
        const decoration = normalizeTextDecoration(value);
        return decoration ? { prop: 'text-decoration', value: decoration } : null;
    }
    const color = normalizeCssColor(value);
    if (!color) return null;
    return { prop: prop === 'background' ? 'background-color' : prop, value: color };
}

function parseStyleString(raw) {
    if (!raw) return '';
    const kept = new Map();
    String(decodeAttrEntities(raw))
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(part => {
            const colonIdx = part.indexOf(':');
            if (colonIdx === -1) return;
            const prop = part.slice(0, colonIdx).trim().toLowerCase();
            const value = part.slice(colonIdx + 1).trim();
            const safe = normalizeStyleDeclaration(prop, value);
            if (safe) kept.set(safe.prop, safe.value);
        });
    return [...kept.entries()].map(([prop, value]) => `${prop}: ${value}`).join('; ');
}

function sanitizeHref(rawValue) {
    const decoded = decodeAttrEntities(rawValue).replace(/[\u0000- \u007f-\u009f]/g, '');
    if (!decoded || decoded.length > 2000) return '';
    if (/^https?:\/\/[^\s/?#]+/i.test(decoded)) {
        try {
            const url = new URL(decoded);
            if (url.username || url.password) return '';
            return url.toString();
        } catch (_) {
            return '';
        }
    }
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(decoded)) return decoded;
    return '';
}

function parseAttributes(rawAttrs) {
    const attrs = {};
    const attrRe = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = attrRe.exec(rawAttrs || '')) !== null) {
        const name = String(match[1] || '').toLowerCase();
        if (!name || Object.prototype.hasOwnProperty.call(attrs, name)) continue;
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

function buildOpeningTag(sourceTag, outTag, attrs) {
    if (outTag === 'br') return '<br>';
    if (outTag === 'a') {
        const href = sanitizeHref(attrs.href);
        if (!href) return '<a>';
        return `<a href="${escapeAttrValue(href)}" target="_blank" rel="noopener noreferrer">`;
    }
    if (outTag === 'span') {
        if (sourceTag === 'font') {
            const color = normalizeCssColor(decodeAttrEntities(attrs.color));
            return color ? `<span style="color: ${escapeAttrValue(color)}">` : '<span>';
        }
        const style = parseStyleString(attrs.style);
        return style ? `<span style="${escapeAttrValue(style)}">` : '<span>';
    }
    return `<${outTag}>`;
}

// Texto entre etiquetas -> unidades visibles. Las entidades validas cuentan
// como 1 caracter y se conservan; `<`/`>` sueltos y `&` sin entidad se
// escapan. Se cuenta por punto de codigo (un emoji simple = 1).
const TEXT_UNIT_RE = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});|[\s\S]/gu;

function appendText(out, text, state) {
    if (!text) return;
    TEXT_UNIT_RE.lastIndex = 0;
    let match;
    while ((match = TEXT_UNIT_RE.exec(text)) !== null) {
        if (state.textLength >= state.maxText) {
            state.truncated = true;
            return;
        }
        const unit = match[0];
        let html;
        if (unit.length > 1 && unit[0] === '&') html = unit;
        else if (unit === '&') html = '&amp;';
        else if (unit === '<') html = '&lt;';
        else if (unit === '>') html = '&gt;';
        else html = unit;
        out.push(html);
        state.textLength += 1;
    }
}

function sanitizeBioHtml(rawHtml, maxTextLength = MAX_BIO_TEXT_LENGTH) {
    const raw = String(rawHtml || '').trim();
    if (!raw) return '';

    const maxText = Number.isFinite(maxTextLength) && maxTextLength > 0 ? maxTextLength : MAX_BIO_TEXT_LENGTH;
    const normalized = hasHtmlMarkup(raw) ? raw : escapeTextAsHtml(raw);
    const out = [];
    const stack = [];
    const dropStack = [];
    const state = { textLength: 0, maxText, truncated: false };
    const tokenRe = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<\/?[a-zA-Z][^>]*>/g;
    let lastIndex = 0;
    let match;

    const closeTo = (index) => {
        while (stack.length > index) out.push(`</${stack.pop()}>`);
    };

    while ((match = tokenRe.exec(normalized)) !== null) {
        const token = match[0];
        const text = normalized.slice(lastIndex, match.index);
        lastIndex = tokenRe.lastIndex;

        if (!dropStack.length) appendText(out, text, state);
        if (state.truncated) break;

        const parsed = parseTag(token);
        if (!parsed) continue;

        if (dropStack.length) {
            if (parsed.closing && parsed.tag === dropStack[dropStack.length - 1]) dropStack.pop();
            else if (!parsed.closing && DROP_CONTENT_TAGS.has(parsed.tag) && !parsed.selfClosing && !VOID_TAGS.has(parsed.tag)) dropStack.push(parsed.tag);
            continue;
        }

        if (DROP_CONTENT_TAGS.has(parsed.tag)) {
            const voidLike = ['img', 'input', 'source', 'meta', 'link', 'base'].includes(parsed.tag);
            if (!parsed.closing && !parsed.selfClosing && !voidLike) dropStack.push(parsed.tag);
            continue;
        }

        const outTag = LEGACY_TAG_MAP[parsed.tag] || parsed.tag;
        if (!ALLOWED_TAGS.has(outTag)) continue;

        if (parsed.closing) {
            if (VOID_TAGS.has(outTag)) continue;
            const idx = stack.lastIndexOf(outTag);
            if (idx === -1) continue;
            closeTo(idx);
            continue;
        }

        if (VOID_TAGS.has(outTag)) {
            out.push('<br>');
            continue;
        }

        // <li> fuera de lista o <p> anidado: se cierra el bloque anterior para
        // no producir HTML que el navegador reinterprete distinto.
        if (outTag === 'p') {
            const openP = stack.lastIndexOf('p');
            if (openP !== -1) closeTo(openP);
        }
        if (outTag === 'li') {
            const openLi = stack.lastIndexOf('li');
            const openList = Math.max(stack.lastIndexOf('ul'), stack.lastIndexOf('ol'));
            if (openLi > openList && openLi !== -1) closeTo(openLi);
        }

        out.push(buildOpeningTag(parsed.tag, outTag, parsed.attrs));
        stack.push(outTag);
        if (stack.length > 32) {
            // Anidamiento absurdo: se corta para no inflar el HTML.
            state.truncated = true;
            break;
        }
    }

    if (!state.truncated && !dropStack.length) {
        appendText(out, normalized.slice(lastIndex), state);
    }
    closeTo(0);

    let html = out.join('')
        .replace(/(<br>\s*){4,}/gi, '<br><br><br>')
        .replace(/<(b|strong|i|em|u|mark|span|a)(?:\s[^>]*)?><\/\1>/gi, '')
        .trim();

    if (html.length > MAX_BIO_HTML_LENGTH) {
        // Markup desproporcionado frente al texto: se degrada a texto plano.
        html = escapeTextAsHtml(bioHtmlToPlainText(html)).slice(0, MAX_BIO_HTML_LENGTH);
    }
    return html;
}

function decodeTextEntities(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(Number.parseInt(dec, 10)))
        .replace(/&amp;/gi, '&');
}

// Texto visible de una bio (para contar caracteres o generar resumenes).
function bioHtmlToPlainText(html) {
    const raw = String(html || '');
    if (!raw) return '';
    const withBreaks = raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li)>/gi, '\n')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]*>/g, '');
    return decodeTextEntities(withBreaks).replace(/\n{3,}/g, '\n\n').trim();
}

function bioVisibleLength(html) {
    return Array.from(bioHtmlToPlainText(html).replace(/\n/g, '')).length;
}

function sanitizeBio(value, maxTextLength = MAX_BIO_TEXT_LENGTH) {
    const safe = sanitizeBioHtml(value, maxTextLength);
    return safe || null;
}

module.exports = {
    MAX_BIO_TEXT_LENGTH,
    MAX_BIO_HTML_LENGTH,
    bioHtmlToPlainText,
    bioVisibleLength,
    sanitizeBio,
    sanitizeBioHtml
};
