/* ============================================================================
   We Ötzi DS · WoRichText — editor WYSIWYG propio, sin dependencias.
   Uso: window.WoRichText.mount(textarea, { maxLength: 2000 })
   - El textarea queda oculto y recibe HTML saneado (evento input/change).
   - Allowlist (igual a la que se pide al servidor): b/strong, i/em, u,
     a[href http(s)/mailto], span[style color/background-color/font-size],
     ul/ol/li, p, br, mark.
   - Contador "N / máx" sobre el texto visible; no deja superar el máximo.
   - Pegar inserta solo texto plano.
   ========================================================================== */
(function (factory) {
  'use strict';
  var core = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = core.pure;
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__woRichTextBooted) {
    window.__woRichTextBooted = true;
    core.boot(window, document);
  }
})(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     Saneado (puro, testeable en Node)
     ---------------------------------------------------------------------- */
  var NBSP = String.fromCharCode(160);
  // Ancla invisible para aplicar estilo con el cursor sin selección.
  var ZWSP = String.fromCharCode(0x200b);
  var ZWSP_RE = new RegExp(ZWSP, 'g');
  var ALLOWED = { b: 1, strong: 1, i: 1, em: 1, u: 1, a: 1, span: 1, ul: 1, ol: 1, li: 1, p: 1, br: 1, mark: 1 };
  var RENAME = { div: 'p', font: 'span' };
  var DROP = {
    script: 1, style: 1, iframe: 1, object: 1, embed: 1, svg: 1, math: 1, template: 1, noscript: 1,
    meta: 1, link: 1, base: 1, form: 1, input: 1, button: 1, textarea: 1, select: 1, option: 1,
    img: 1, video: 1, audio: 1, source: 1, canvas: 1, head: 1, title: 1, xml: 1, picture: 1
  };
  var VOID = { br: 1, hr: 1, wbr: 1, col: 1, area: 1, param: 1, track: 1, img: 1, input: 1, meta: 1, link: 1, source: 1, base: 1, embed: 1 };
  var FONT_KEYWORD_PX = { 'x-small': 12, small: 14, medium: 16, large: 20, 'x-large': 24, 'xx-large': 28, 'xxx-large': 32 };
  var FONT_ATTR_PX = { 1: 12, 2: 14, 3: 16, 4: 20, 5: 24, 6: 28, 7: 32 };
  var MIN_FONT_PX = 10;
  var MAX_FONT_PX = 40;

  function decodeEntities(value) {
    return String(value || '')
      .replace(/&#x([0-9a-f]+);/gi, function (m, h) { var c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
      .replace(/&#(\d+);/g, function (m, d) { var c = parseInt(d, 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
      .replace(/&nbsp;/gi, NBSP)
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cleanText(text) {
    return String(text || '')
      .replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});)/gi, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeHref(raw) {
    var v = decodeEntities(raw).trim();
    if (!v || /[\s<>"'`]/.test(v) || /[\x00-\x1f]/.test(v)) return '';
    if (/^https?:\/\/[^\/?#]+/i.test(v)) return v;
    if (/^mailto:[^@\s]+@[^@\s]+$/i.test(v)) return v;
    return '';
  }

  function normalizeColor(raw) {
    var v = String(raw || '').trim().toLowerCase();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return v;
    var m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/.exec(v);
    if (m) {
      if (+m[1] > 255 || +m[2] > 255 || +m[3] > 255) return '';
      if (m[4] !== undefined && Number(m[4]) === 0) return ''; // transparente = sin color
      return m[4] !== undefined ? 'rgba(' + m[1] + ', ' + m[2] + ', ' + m[3] + ', ' + m[4] + ')' : 'rgb(' + m[1] + ', ' + m[2] + ', ' + m[3] + ')';
    }
    return '';
  }

  function normalizeFontSize(raw) {
    var v = String(raw || '').trim().toLowerCase();
    if (FONT_KEYWORD_PX[v]) return FONT_KEYWORD_PX[v] + 'px';
    var m = /^(\d{1,2}(?:\.\d+)?)px$/.exec(v);
    if (!m) return '';
    var n = Math.round(Number(m[1]));
    return n >= MIN_FONT_PX && n <= MAX_FONT_PX ? n + 'px' : '';
  }

  function parseStyle(raw) {
    var out = {};
    String(decodeEntities(raw) || '').split(';').forEach(function (part) {
      var idx = part.indexOf(':');
      if (idx === -1) return;
      var prop = part.slice(0, idx).trim().toLowerCase();
      var value = part.slice(idx + 1).replace(/!important/i, '').trim();
      if (/expression|url\s*\(|javascript:|[<>{}\\]/i.test(value)) return;
      if (prop === 'color') { var c = normalizeColor(value); if (c) out.color = c; }
      else if (prop === 'background-color' || prop === 'background') { var b = normalizeColor(value); if (b) out['background-color'] = b; }
      else if (prop === 'font-size') { var f = normalizeFontSize(value); if (f) out['font-size'] = f; }
      // Safari/Chrome con styleWithCSS: negrita/cursiva/subrayado como estilos.
      else if (prop === 'font-weight') { if (/^(bold|bolder|[6-9]00)$/i.test(value)) out.__b = true; }
      else if (prop === 'font-style') { if (/^(italic|oblique)$/i.test(value)) out.__i = true; }
      else if (prop === 'text-decoration' || prop === 'text-decoration-line') { if (/underline/i.test(value)) out.__u = true; }
    });
    return out;
  }

  function styleString(map) {
    return ['color', 'background-color', 'font-size']
      .filter(function (k) { return map[k]; })
      .map(function (k) { return k + ': ' + map[k]; })
      .join('; ');
  }

  function parseAttrs(raw) {
    var attrs = {};
    var re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    var m;
    while ((m = re.exec(raw || '')) !== null) {
      var name = m[1].toLowerCase();
      if (!(name in attrs)) attrs[name] = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : ''));
    }
    return attrs;
  }

  function openTagFor(name, attrs) {
    var tag = RENAME[name] || name;
    if (!ALLOWED[tag]) return null;
    if (tag === 'a') {
      var href = sanitizeHref(attrs.href);
      return href ? { open: '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">', close: '</a>' } : null;
    }
    if (tag === 'span') {
      var map = parseStyle(attrs.style);
      if (name === 'font') {
        var c = normalizeColor(attrs.color);
        if (c && !map.color) map.color = c;
        if (attrs.size && FONT_ATTR_PX[attrs.size] && !map['font-size']) map['font-size'] = FONT_ATTR_PX[attrs.size] + 'px';
      }
      var s = styleString(map);
      var open = s ? '<span style="' + s + '">' : '';
      var close = s ? '</span>' : '';
      if (map.__b) { open += '<b>'; close = '</b>' + close; }
      if (map.__i) { open += '<i>'; close = '</i>' + close; }
      if (map.__u) { open += '<u>'; close = '</u>' + close; }
      return open ? { open: open, close: close } : null;
    }
    return { open: '<' + tag + '>', close: '</' + tag + '>' };
  }

  // Tokenizador con pila: lo no permitido se desenvuelve (queda el texto),
  // los contenedores peligrosos se descartan con su contenido y todo queda
  // balanceado al final.
  function sanitize(html) {
    var src = String(html == null ? '' : html).replace(ZWSP_RE, '');
    if (!src.trim()) return '';
    var out = [];
    var stack = [];
    var drop = [];
    var re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[\s\S]*?(?:\?>|$)|<\/?[a-zA-Z][^>]*>/g;
    var last = 0;
    var m;
    while ((m = re.exec(src)) !== null) {
      var token = m[0];
      if (!drop.length) out.push(cleanText(src.slice(last, m.index)));
      last = re.lastIndex;
      var t = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)(\/?)\s*>$/.exec(token);
      if (!t) continue;
      var closing = !!t[1];
      var name = t[2].toLowerCase();
      var selfClosing = !!t[4] || VOID[name];
      if (drop.length) {
        if (closing && name === drop[drop.length - 1]) drop.pop();
        else if (!closing && DROP[name] && !selfClosing) drop.push(name);
        continue;
      }
      if (DROP[name]) {
        if (!closing && !selfClosing) drop.push(name);
        continue;
      }
      if (closing) {
        for (var i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === name) {
            while (stack.length > i) {
              var e = stack.pop();
              if (e.tag) out.push(e.close);
            }
            break;
          }
        }
        continue;
      }
      if (name === 'br') { out.push('<br>'); continue; }
      if (selfClosing) continue;
      // Cierres implícitos de HTML: <li> cierra el <li> abierto de su lista y
      // <p> cierra el <p> abierto.
      var mappedName = RENAME[name] || name;
      if (mappedName === 'li' || mappedName === 'p') {
        var stopAt = mappedName === 'li' ? { ul: 1, ol: 1 } : { li: 1, ul: 1, ol: 1 };
        for (var k = stack.length - 1; k >= 0 && !stopAt[stack[k].tag]; k--) {
          if (stack[k].tag === mappedName) {
            while (stack.length > k) {
              var c = stack.pop();
              if (c.tag) out.push(c.close);
            }
            break;
          }
        }
      }
      var open = openTagFor(name, parseAttrs(t[3]));
      var tag = open ? (RENAME[name] || name) : null;
      if (open) out.push(open.open);
      stack.push({ name: name, tag: tag, close: open ? open.close : '' });
    }
    if (!drop.length) out.push(cleanText(src.slice(last)));
    while (stack.length) {
      var rest = stack.pop();
      if (rest.tag) out.push(rest.close);
    }
    var result = out.join('')
      .replace(/<span style="[^"]*"><\/span>/g, '')
      .replace(/<p><\/p>/g, '')
      .replace(/(<br>){4,}/g, '<br><br><br>')
      .trim();
    if (!visibleText(result).trim() && !/<li>/.test(result)) return '';
    return result;
  }

  function visibleText(html) {
    return decodeEntities(String(html || '').replace(/<[^>]*>/g, '')).replace(ZWSP_RE, '');
  }

  function textLength(text) {
    return Array.from(String(text || '')).length;
  }

  function visibleTextLength(html) {
    return textLength(visibleText(html));
  }

  function truncateText(text, max) {
    var chars = Array.from(String(text || ''));
    return chars.length > max ? chars.slice(0, Math.max(0, max)).join('') : String(text || '');
  }

  function hasMarkup(value) { return /<\/?[a-z][\s\S]*>/i.test(String(value || '')); }

  function textToHtml(plain) {
    var t = String(plain || '').replace(/\r\n?/g, '\n').trim();
    if (!t) return '';
    return t.split(/\n{2,}/).map(function (para) {
      return '<p>' + escapeHtml(para).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  // Enlace escrito por la persona -> href válido o '' (para mostrar error).
  function normalizeLinkInput(value) {
    var v = String(value || '').trim();
    if (!v) return '';
    if (/^(https?:\/\/|mailto:)/i.test(v)) return sanitizeHref(v);
    if (/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(v)) return sanitizeHref('mailto:' + v);
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#][^\s]*)?$/i.test(v)) return sanitizeHref('https://' + v);
    return '';
  }

  var pure = {
    sanitize: sanitize,
    visibleText: visibleText,
    visibleTextLength: visibleTextLength,
    textLength: textLength,
    truncateText: truncateText,
    textToHtml: textToHtml,
    hasMarkup: hasMarkup,
    normalizeLinkInput: normalizeLinkInput,
    sanitizeHref: sanitizeHref,
    normalizeColor: normalizeColor,
    normalizeFontSize: normalizeFontSize
  };

  /* ------------------------------------------------------------------------
     Editor (navegador)
     ---------------------------------------------------------------------- */
  function boot(win, doc) {
    var uid = 0;
    var TEXTAREA_VALUE = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    var EMOJIS = ['😀', '😂', '😍', '🥰', '😎', '🤩', '😉', '🙌',
      '👏', '🙏', '💪', '👌', '👍', '✌️', '🔥', '✨',
      '⭐', '💫', '❤️', '🖤', '💙', '💛', '💚', '💜',
      '💀', '🌹', '🌸', '🌿', '🐍', '🐉', '🦋', '🌙',
      '⚡', '🎨', '✒️', '💉', '📍', '📅', '📸', '✅'];
    var COLORS = [
      { name: 'Tinta', token: '--ink', fallback: '#001125' },
      { name: 'Grafito', token: '--neutral-400', fallback: '#5A5449' },
      { name: 'Rojo', token: '--red-400', fallback: '#C82D16' },
      { name: 'Azul', token: '--blue-400', fallback: '#0055FF' },
      { name: 'Azul profundo', token: '--blue-300', fallback: '#1E3FA6' },
      { name: 'Ocre', token: '--yellow-500', fallback: '#A86A00' },
      { name: 'Verde', token: '--success-fg', fallback: '#14654A' }
    ];
    var HIGHLIGHT = { token: '--yellow-200', fallback: '#FFD25A' };
    var SIZES = [
      { name: 'Chico', px: 14 },
      { name: 'Normal', px: 16 },
      { name: 'Grande', px: 20 },
      { name: 'Título', px: 24 }
    ];
    var ICONS = {
      bold: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
      italic: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
      underline: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
      ul: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
      ol: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 4.5l1.5-1V9"/><path d="M3.5 13.2c.4-.7 1-1 1.7-1 .8 0 1.4.6 1.4 1.3 0 1.2-3.1 2.4-3.1 3.5h3.2"/></svg>',
      link: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
      smile: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>'
    };

    function nextId(p) { uid += 1; return 'wo-rt-' + p + '-' + uid; }
    function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

    function tokenColor(token, fallback) {
      try {
        var v = win.getComputedStyle(doc.documentElement).getPropertyValue(token).trim();
        return normalizeColor(v) || fallback;
      } catch (err) { return fallback; }
    }

    function formatCount(n) {
      try { return Number(n).toLocaleString('es-AR'); } catch (err) { return String(n); }
    }

    function mount(textarea, options) {
      if (!textarea || textarea.tagName !== 'TEXTAREA') throw new Error('WoRichText.mount necesita un <textarea>.');
      if (textarea.__woRichText) return textarea.__woRichText;
      options = options || {};
      var max = Number(options.maxLength) || Number(textarea.getAttribute('data-maxlength')) || Number(textarea.getAttribute('maxlength')) || 2000;
      var lastValue = null;
      var dirty = false;
      var savedRange = null;
      var openMenu = null;

      var wrap = doc.createElement('div');
      wrap.className = 'wo-rt';
      var bar = doc.createElement('div');
      bar.className = 'wo-rt__bar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Formato del texto');
      var area = doc.createElement('div');
      area.className = 'wo-rt__area';
      area.id = nextId('area');
      area.setAttribute('contenteditable', 'true');
      area.setAttribute('role', 'textbox');
      area.setAttribute('aria-multiline', 'true');
      area.setAttribute('spellcheck', 'true');
      area.setAttribute('lang', 'es');
      area.setAttribute('data-placeholder', textarea.getAttribute('placeholder') || '');
      bar.setAttribute('aria-controls', area.id);
      var foot = doc.createElement('div');
      foot.className = 'wo-rt__foot';
      var count = doc.createElement('span');
      count.className = 'wo-rt__count';
      count.id = nextId('count');
      var live = doc.createElement('span');
      live.className = 'wo-ctl-sr';
      live.setAttribute('aria-live', 'polite');
      foot.appendChild(count);
      foot.appendChild(live);

      if (textarea.labels && textarea.labels.length) {
        var lab = textarea.labels[0];
        if (!lab.id) lab.id = nextId('label');
        area.setAttribute('aria-labelledby', lab.id);
      } else {
        area.setAttribute('aria-label', textarea.getAttribute('aria-label') || textarea.getAttribute('placeholder') || 'Texto');
      }
      area.setAttribute('aria-describedby', [textarea.getAttribute('aria-describedby'), count.id].filter(Boolean).join(' '));

      /* ---- toolbar ---- */
      var buttons = {};
      function addButton(key, label, html, extraClass) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'wo-rt__btn' + (extraClass ? ' ' + extraClass : '');
        b.setAttribute('data-cmd', key);
        b.setAttribute('aria-label', label);
        b.title = label;
        b.innerHTML = html;
        b.tabIndex = -1;
        bar.appendChild(b);
        buttons[key] = b;
        return b;
      }
      function sep() { var s = doc.createElement('span'); s.className = 'wo-rt__sep'; s.setAttribute('aria-hidden', 'true'); bar.appendChild(s); }
      addButton('bold', 'Negrita (Ctrl+B)', ICONS.bold).setAttribute('aria-pressed', 'false');
      addButton('italic', 'Cursiva (Ctrl+I)', ICONS.italic).setAttribute('aria-pressed', 'false');
      addButton('underline', 'Subrayado (Ctrl+U)', ICONS.underline).setAttribute('aria-pressed', 'false');
      sep();
      addButton('size', 'Tamaño del texto', '<span class="wo-rt__glyph" aria-hidden="true">Aa</span>', 'wo-rt__btn--size');
      addButton('color', 'Color del texto', '<span class="wo-rt__glyph" aria-hidden="true">A</span><span class="wo-rt__swatch" aria-hidden="true"></span>', 'wo-rt__btn--color');
      addButton('highlight', 'Resaltado', '<span class="wo-rt__glyph" aria-hidden="true">ab</span>', 'wo-rt__btn--mark').setAttribute('aria-pressed', 'false');
      sep();
      addButton('ol', 'Lista numerada', ICONS.ol).setAttribute('aria-pressed', 'false');
      addButton('ul', 'Lista con viñetas', ICONS.ul).setAttribute('aria-pressed', 'false');
      sep();
      addButton('link', 'Enlace (Ctrl+K)', ICONS.link).setAttribute('aria-pressed', 'false');
      addButton('emoji', 'Emojis', ICONS.smile);
      buttons.bold.tabIndex = 0;
      ['size', 'color', 'emoji', 'link'].forEach(function (k) {
        buttons[k].setAttribute('aria-haspopup', k === 'link' ? 'dialog' : 'true');
        buttons[k].setAttribute('aria-expanded', 'false');
      });

      /* ---- menús ---- */
      function makeMenu(key, title, role) {
        var m = doc.createElement('div');
        m.className = 'wo-rt__menu';
        m.id = nextId('menu');
        m.hidden = true;
        m.setAttribute('role', role || 'dialog');
        m.setAttribute('aria-label', title);
        var h = doc.createElement('p');
        h.className = 'wo-rt__menu-title';
        h.textContent = title;
        h.setAttribute('aria-hidden', 'true');
        m.appendChild(h);
        buttons[key].setAttribute('aria-controls', m.id);
        wrap.appendChild(m);
        return m;
      }

      var sizeMenu = makeMenu('size', 'Tamaño', 'menu');
      var sizeList = doc.createElement('div');
      sizeList.className = 'wo-rt__sizes';
      SIZES.forEach(function (s) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'wo-rt__size';
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', 'false');
        b.setAttribute('data-px', String(s.px));
        b.style.fontSize = s.px + 'px';
        b.textContent = s.name;
        sizeList.appendChild(b);
      });
      sizeMenu.appendChild(sizeList);

      var colorMenu = makeMenu('color', 'Color', 'menu');
      var swatches = doc.createElement('div');
      swatches.className = 'wo-rt__swatches';
      COLORS.forEach(function (c) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'wo-rt__color';
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', 'false');
        b.setAttribute('aria-label', c.name);
        b.title = c.name;
        var value = tokenColor(c.token, c.fallback);
        b.setAttribute('data-color', value);
        b.style.background = value;
        swatches.appendChild(b);
      });
      colorMenu.appendChild(swatches);

      var emojiMenu = makeMenu('emoji', 'Emojis', 'dialog');
      var emojiGrid = doc.createElement('div');
      emojiGrid.className = 'wo-rt__emojis';
      emojiGrid.setAttribute('role', 'group');
      emojiGrid.setAttribute('aria-label', 'Emojis');
      EMOJIS.forEach(function (e, i) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'wo-rt__emoji';
        b.textContent = e;
        b.setAttribute('data-emoji', e);
        b.tabIndex = i === 0 ? 0 : -1;
        emojiGrid.appendChild(b);
      });
      emojiMenu.appendChild(emojiGrid);

      var linkMenu = makeMenu('link', 'Enlace', 'dialog');
      var linkForm = doc.createElement('div');
      linkForm.className = 'wo-rt__link-form';
      var linkInput = doc.createElement('input');
      linkInput.type = 'text';
      linkInput.className = 'wo-rt__link-input';
      linkInput.setAttribute('inputmode', 'url');
      linkInput.setAttribute('autocomplete', 'off');
      linkInput.setAttribute('spellcheck', 'false');
      linkInput.setAttribute('placeholder', 'https://… o email');
      linkInput.setAttribute('aria-label', 'Dirección del enlace');
      var linkError = doc.createElement('p');
      linkError.className = 'wo-rt__link-error';
      linkError.id = nextId('linkerr');
      linkError.hidden = true;
      linkInput.setAttribute('aria-describedby', linkError.id);
      var linkActions = doc.createElement('div');
      linkActions.className = 'wo-rt__link-actions';
      linkActions.innerHTML = '<button type="button" class="wo-rt__act wo-rt__act--danger" data-link="remove">Quitar enlace</button>'
        + '<button type="button" class="wo-rt__act" data-link="cancel">Cancelar</button>'
        + '<button type="button" class="wo-rt__act wo-rt__act--primary" data-link="apply">Aplicar</button>';
      linkForm.appendChild(linkInput);
      linkForm.appendChild(linkError);
      linkForm.appendChild(linkActions);
      linkMenu.appendChild(linkForm);

      var menus = { size: sizeMenu, color: colorMenu, emoji: emojiMenu, link: linkMenu };

      wrap.insertBefore(bar, wrap.firstChild);
      wrap.insertBefore(area, bar.nextSibling);
      wrap.insertBefore(foot, area.nextSibling);
      textarea.parentNode.insertBefore(wrap, textarea.nextSibling);
      textarea.classList.add('wo-ctl-native');
      textarea.setAttribute('tabindex', '-1');
      textarea.setAttribute('aria-hidden', 'true');

      /* ---- selección ---- */
      function rangeInArea() {
        var sel = win.getSelection();
        if (!sel || !sel.rangeCount) return null;
        var r = sel.getRangeAt(0);
        return area.contains(r.commonAncestorContainer) ? r : null;
      }
      function saveRange() { var r = rangeInArea(); if (r) savedRange = r.cloneRange(); }
      function restoreRange() {
        try { area.focus({ preventScroll: true }); } catch (err) { area.focus(); }
        var sel = win.getSelection();
        if (savedRange && area.contains(savedRange.commonAncestorContainer)) {
          sel.removeAllRanges();
          sel.addRange(savedRange);
        } else if (!rangeInArea()) {
          var r = doc.createRange();
          r.selectNodeContents(area);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
      function selectedTextLength() {
        var r = rangeInArea();
        return r && !r.collapsed ? textLength(r.toString()) : 0;
      }
      function closestInArea(node, selector) {
        var el = node && (node.nodeType === 1 ? node : node.parentElement);
        while (el && el !== area) {
          if (el.matches(selector)) return el;
          el = el.parentElement;
        }
        return null;
      }

      /* ---- contador y sincronización ---- */
      function length() { return textLength((area.textContent || '').replace(ZWSP_RE, '')); }
      function isEmpty() { return length() === 0 && !area.querySelector('li'); }

      function updateCount() {
        var n = length();
        count.textContent = formatCount(n) + ' / ' + formatCount(max);
        wrap.classList.toggle('is-full', n >= max);
        wrap.classList.toggle('is-empty', isEmpty());
      }

      var fullAnnounced = false;
      function announceFull() {
        if (fullAnnounced) return;
        fullAnnounced = true;
        live.textContent = 'Llegaste al máximo de ' + formatCount(max) + ' caracteres.';
        setTimeout(function () { fullAnnounced = false; live.textContent = ''; }, 2500);
      }

      function sync(silent) {
        updateCount();
        var html = isEmpty() ? '' : sanitize(area.innerHTML);
        if (html === lastValue) return;
        lastValue = html;
        TEXTAREA_VALUE.set.call(textarea, html);
        if (textarea.validity && textarea.validity.valid) { wrap.classList.remove('wo-is-invalid'); area.removeAttribute('aria-invalid'); }
        if (!silent) { dirty = true; fire(textarea, 'input'); }
      }

      function load(value) {
        var v = String(value == null ? '' : value);
        var html = sanitize(hasMarkup(v) ? v : textToHtml(v));
        area.innerHTML = html;
        lastValue = null;
        sync(true);
        updateState();
      }

      /* ---- recorte al máximo ---- */
      function trimExcess() {
        var excess = length() - max;
        if (excess <= 0) return;
        var sel = win.getSelection();
        var node = sel && sel.rangeCount ? sel.focusNode : null;
        if (node && node.nodeType === 3 && area.contains(node)) {
          var chars = Array.from(node.data.slice(0, sel.focusOffset));
          var take = Math.min(excess, chars.length);
          if (take > 0) {
            var before = chars.slice(0, chars.length - take).join('');
            var after = node.data.slice(sel.focusOffset);
            node.data = before + after;
            var r = doc.createRange();
            r.setStart(node, before.length);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            excess -= take;
          }
        }
        if (excess > 0) {
          var walker = doc.createTreeWalker(area, NodeFilter.SHOW_TEXT);
          var texts = [];
          while (walker.nextNode()) texts.push(walker.currentNode);
          for (var i = texts.length - 1; i >= 0 && excess > 0; i--) {
            var cs = Array.from(texts[i].data);
            var cut = Math.min(excess, cs.length);
            texts[i].data = cs.slice(0, cs.length - cut).join('');
            excess -= cut;
          }
        }
        announceFull();
      }

      function insertPlain(text) {
        var clean = String(text || '').replace(/\r\n?/g, '\n').replace(new RegExp(NBSP, 'g'), ' ');
        var room = max - (length() - selectedTextLength());
        if (room <= 0) { announceFull(); return; }
        if (textLength(clean) > room) { clean = truncateText(clean, room); announceFull(); }
        if (!clean) return;
        doc.execCommand('insertText', false, clean);
      }

      /* ---- comandos ---- */
      function exec(cmd, value) {
        restoreRange();
        try { doc.execCommand(cmd, false, value); } catch (err) { /* navegador sin soporte */ }
        afterChange();
      }

      function afterChange() {
        normalizeDom();
        saveRange();
        sync(false);
        updateState();
      }

      function unwrap(el) {
        var parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }

      // Normaliza lo que generan los navegadores: <font> -> <span style>, <div> -> <p>.
      function normalizeDom() {
        Array.prototype.slice.call(area.querySelectorAll('font')).forEach(function (f) {
          var span = doc.createElement('span');
          var c = f.getAttribute('color');
          if (c) span.style.color = c;
          var sz = f.getAttribute('size');
          if (sz && FONT_ATTR_PX[sz]) span.style.fontSize = FONT_ATTR_PX[sz] + 'px';
          if (f.getAttribute('style')) span.style.cssText += ';' + f.getAttribute('style');
          while (f.firstChild) span.appendChild(f.firstChild);
          f.parentNode.replaceChild(span, f);
        });
        Array.prototype.slice.call(area.querySelectorAll('div')).forEach(function (d) {
          if (d.querySelector('p, div, ul, ol')) { unwrap(d); return; }
          var p = doc.createElement('p');
          while (d.firstChild) p.appendChild(d.firstChild);
          d.parentNode.replaceChild(p, d);
        });
      }

      // Con el cursor sin selección, execCommand deja un "estilo pendiente" poco
      // fiable (Chrome mueve el cursor antes del span). Se inserta un span con
      // un ancla invisible y el cursor adentro: lo que se escribe hereda el estilo.
      function styledCaret(style) {
        restoreRange();
        var r = rangeInArea();
        if (!r) return false;
        var span = doc.createElement('span');
        Object.keys(style).forEach(function (k) { span.style.setProperty(k, style[k]); });
        var z = doc.createTextNode(ZWSP);
        span.appendChild(z);
        r.insertNode(span);
        var nr = doc.createRange();
        nr.setStart(z, 1);
        nr.collapse(true);
        var sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(nr);
        savedRange = nr.cloneRange();
        afterChange();
        return true;
      }

      function caretAfter(el) {
        var z = doc.createTextNode(ZWSP);
        el.parentNode.insertBefore(z, el.nextSibling);
        var nr = doc.createRange();
        nr.setStart(z, 1);
        nr.collapse(true);
        var sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(nr);
        savedRange = nr.cloneRange();
        afterChange();
      }

      function applySize(px) {
        restoreRange();
        var r = rangeInArea();
        if (!r) return;
        if (r.collapsed) { styledCaret({ 'font-size': px + 'px' }); return; }
        var baseInside = closestInArea(r.commonAncestorContainer, 'span[style*="font-size"]');
        try { doc.execCommand('styleWithCSS', false, false); } catch (err) { /* noop */ }
        doc.execCommand('fontSize', false, '7');
        var created = Array.prototype.slice.call(area.querySelectorAll('font[size="7"]'));
        var first = null, lastNode = null;
        created.forEach(function (f) {
          Array.prototype.slice.call(f.querySelectorAll('span')).forEach(function (s) {
            if (s.style.fontSize) { s.style.fontSize = ''; if (!s.getAttribute('style')) unwrap(s); }
          });
          Array.prototype.slice.call(f.querySelectorAll('font[size]')).forEach(function (inner) { inner.removeAttribute('size'); if (!inner.attributes.length) unwrap(inner); });
          var span = doc.createElement('span');
          if (px !== 16 || baseInside) span.style.fontSize = px + 'px';
          while (f.firstChild) span.appendChild(f.firstChild);
          f.parentNode.replaceChild(span, f);
          if (!first) first = span;
          lastNode = span;
          if (!span.getAttribute('style')) {
            var kids = Array.prototype.slice.call(span.childNodes);
            unwrap(span);
            if (first === span) first = kids[0] || null;
            if (lastNode === span) lastNode = kids[kids.length - 1] || null;
          }
        });
        if (first && lastNode) {
          var nr = doc.createRange();
          nr.setStartBefore(first);
          nr.setEndAfter(lastNode);
          var sel = win.getSelection();
          sel.removeAllRanges();
          sel.addRange(nr);
        }
        afterChange();
      }

      function applyColor(value) {
        restoreRange();
        var rc = rangeInArea();
        if (rc && rc.collapsed) { styledCaret({ color: value }); return; }
        try { doc.execCommand('styleWithCSS', false, true); } catch (err) { /* noop */ }
        doc.execCommand('foreColor', false, value);
        try { doc.execCommand('styleWithCSS', false, false); } catch (err) { /* noop */ }
        afterChange();
      }

      function currentHighlight() {
        var r = rangeInArea() || savedRange;
        if (!r) return false;
        var el = closestInArea(r.startContainer, 'mark, span[style*="background"]');
        if (!el) return false;
        if (el.tagName === 'MARK') return true;
        return !!normalizeColor(el.style.backgroundColor);
      }

      function toggleHighlight() {
        var on = currentHighlight();
        restoreRange();
        var rh = rangeInArea();
        if (rh && rh.collapsed) {
          if (!on) { styledCaret({ 'background-color': tokenColor(HIGHLIGHT.token, HIGHLIGHT.fallback) }); return; }
          var hl = closestInArea(rh.startContainer, 'mark, span[style*="background"]');
          if (hl) { caretAfter(hl); return; }
        }
        try { doc.execCommand('styleWithCSS', false, true); } catch (err) { /* noop */ }
        var color = on ? 'transparent' : tokenColor(HIGHLIGHT.token, HIGHLIGHT.fallback);
        if (!doc.execCommand('hiliteColor', false, color)) doc.execCommand('backColor', false, color);
        try { doc.execCommand('styleWithCSS', false, false); } catch (err) { /* noop */ }
        if (on) {
          Array.prototype.slice.call(area.querySelectorAll('mark')).forEach(function (m) {
            var r = rangeInArea();
            if (r && r.intersectsNode(m)) unwrap(m);
          });
        }
        afterChange();
      }

      /* ---- estado de la toolbar ---- */
      function q(cmd) { try { return doc.queryCommandState(cmd); } catch (err) { return false; } }
      function updateState() {
        var inside = !!rangeInArea();
        buttons.bold.setAttribute('aria-pressed', String(inside && q('bold')));
        buttons.italic.setAttribute('aria-pressed', String(inside && q('italic')));
        buttons.underline.setAttribute('aria-pressed', String(inside && q('underline')));
        buttons.ol.setAttribute('aria-pressed', String(inside && q('insertOrderedList')));
        buttons.ul.setAttribute('aria-pressed', String(inside && q('insertUnorderedList')));
        buttons.highlight.setAttribute('aria-pressed', String(inside && currentHighlight()));
        var r = rangeInArea();
        buttons.link.setAttribute('aria-pressed', String(!!(r && closestInArea(r.startContainer, 'a'))));
      }

      /* ---- menús: abrir/cerrar ---- */
      function positionMenu(menu, btn) {
        menu.style.left = '0px';
        var maxLeft = Math.max(0, wrap.clientWidth - menu.offsetWidth);
        menu.style.left = Math.min(btn.offsetLeft, maxLeft) + 'px';
        menu.style.top = (bar.offsetTop + bar.offsetHeight + 4) + 'px';
      }

      function closeMenu(focusButton) {
        if (!openMenu) return;
        var key = openMenu;
        openMenu = null;
        menus[key].hidden = true;
        buttons[key].setAttribute('aria-expanded', 'false');
        if (focusButton) buttons[key].focus();
      }

      function openMenuFor(key) {
        if (openMenu === key) { closeMenu(true); return; }
        closeMenu(false);
        saveRange();
        openMenu = key;
        var menu = menus[key];
        menu.hidden = false;
        buttons[key].setAttribute('aria-expanded', 'true');
        positionMenu(menu, buttons[key]);
        if (key === 'size') {
          var r = savedRange;
          var span = r ? closestInArea(r.startContainer, 'span[style*="font-size"]') : null;
          var px = span ? parseInt(span.style.fontSize, 10) : 16;
          Array.prototype.forEach.call(sizeList.children, function (b) { b.setAttribute('aria-checked', String(+b.getAttribute('data-px') === px)); });
          (sizeList.querySelector('[aria-checked="true"]') || sizeList.firstChild).focus();
        } else if (key === 'color') {
          swatches.firstChild.focus();
        } else if (key === 'emoji') {
          emojiGrid.querySelector('[tabindex="0"]').focus();
        } else if (key === 'link') {
          var a = savedRange ? closestInArea(savedRange.startContainer, 'a') : null;
          linkInput.value = a ? a.getAttribute('href') || '' : '';
          linkError.hidden = true;
          linkActions.querySelector('[data-link="remove"]').hidden = !a;
          linkInput.focus();
          linkInput.select();
        }
      }

      function applyLink() {
        var href = normalizeLinkInput(linkInput.value);
        if (!href) {
          linkError.textContent = 'Ingresá un enlace válido: https://… o un email.';
          linkError.hidden = false;
          linkInput.setAttribute('aria-invalid', 'true');
          linkInput.focus();
          return;
        }
        linkInput.removeAttribute('aria-invalid');
        closeMenu(false);
        restoreRange();
        var r = rangeInArea();
        var existing = r ? closestInArea(r.startContainer, 'a') : null;
        if (existing) {
          existing.setAttribute('href', href);
        } else if (r && r.collapsed) {
          var text = href.replace(/^mailto:/i, '').replace(/^https?:\/\//i, '');
          var room = max - length();
          if (room <= 0) { announceFull(); return; }
          text = truncateText(text, room);
          doc.execCommand('insertHTML', false, '<a href="' + escapeHtml(href) + '">' + escapeHtml(text) + '</a>' + NBSP);
        } else {
          doc.execCommand('createLink', false, href);
        }
        afterChange();
      }

      function removeLink() {
        closeMenu(false);
        restoreRange();
        var r = rangeInArea();
        var a = r ? closestInArea(r.startContainer, 'a') : null;
        if (a) {
          var nr = doc.createRange();
          nr.selectNodeContents(a);
          var sel = win.getSelection();
          sel.removeAllRanges();
          sel.addRange(nr);
        }
        doc.execCommand('unlink', false, null);
        afterChange();
      }

      /* ---- eventos ---- */
      bar.addEventListener('mousedown', function (e) {
        if (e.target.closest('.wo-rt__btn')) e.preventDefault();
      });
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('.wo-rt__btn');
        if (!b || b.disabled) return;
        var cmd = b.getAttribute('data-cmd');
        Array.prototype.forEach.call(bar.querySelectorAll('.wo-rt__btn'), function (x) { x.tabIndex = x === b ? 0 : -1; });
        if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') { closeMenu(false); exec(cmd); }
        else if (cmd === 'ol') { closeMenu(false); exec('insertOrderedList'); }
        else if (cmd === 'ul') { closeMenu(false); exec('insertUnorderedList'); }
        else if (cmd === 'highlight') { closeMenu(false); toggleHighlight(); }
        else openMenuFor(cmd);
      });
      bar.addEventListener('keydown', function (e) {
        var list = Array.prototype.slice.call(bar.querySelectorAll('.wo-rt__btn'));
        var i = list.indexOf(doc.activeElement);
        if (i === -1) return;
        var n = -1;
        if (e.key === 'ArrowRight') n = (i + 1) % list.length;
        else if (e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = list.length - 1;
        if (n === -1) return;
        e.preventDefault();
        list.forEach(function (x, k) { x.tabIndex = k === n ? 0 : -1; });
        list[n].focus();
      });

      // Los menús no deben burbujear eventos a los handlers del form de la página.
      Object.keys(menus).forEach(function (key) {
        var menu = menus[key];
        ['input', 'change', 'keyup', 'keypress'].forEach(function (type) {
          menu.addEventListener(type, function (e) { e.stopPropagation(); });
        });
        menu.addEventListener('mousedown', function (e) {
          if (e.target !== linkInput) e.preventDefault();
        });
        menu.addEventListener('keydown', function (e) {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
          if (key === 'link' && e.key === 'Enter') { e.preventDefault(); applyLink(); return; }
          var items = key === 'size' ? Array.prototype.slice.call(sizeList.children)
            : key === 'color' ? Array.prototype.slice.call(swatches.children)
            : key === 'emoji' ? Array.prototype.slice.call(emojiGrid.children) : null;
          if (!items) return;
          var i = items.indexOf(doc.activeElement);
          if (i === -1) return;
          var cols = 1;
          if (key === 'color') cols = items.length;
          if (key === 'emoji') cols = (win.getComputedStyle(emojiGrid).gridTemplateColumns || '').split(' ').filter(Boolean).length || 8;
          var delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
          if (key === 'size') delta = { ArrowDown: 1, ArrowUp: -1 }[e.key];
          if (e.key === 'Home') delta = -i;
          if (e.key === 'End') delta = items.length - 1 - i;
          if (delta === undefined) return;
          e.preventDefault();
          var n = Math.min(items.length - 1, Math.max(0, i + delta));
          if (key === 'emoji') items.forEach(function (x, k) { x.tabIndex = k === n ? 0 : -1; });
          items[n].focus();
        });
      });
      sizeList.addEventListener('click', function (e) {
        var b = e.target.closest('.wo-rt__size');
        if (!b) return;
        closeMenu(false);
        applySize(+b.getAttribute('data-px'));
      });
      swatches.addEventListener('click', function (e) {
        var b = e.target.closest('.wo-rt__color');
        if (!b) return;
        closeMenu(false);
        applyColor(b.getAttribute('data-color'));
        buttons.color.querySelector('.wo-rt__swatch').style.background = b.getAttribute('data-color');
      });
      emojiGrid.addEventListener('click', function (e) {
        var b = e.target.closest('.wo-rt__emoji');
        if (!b) return;
        restoreRange();
        insertPlain(b.getAttribute('data-emoji'));
        afterChange();
        // El menú queda abierto para elegir varios; el foco vuelve a la grilla.
        b.focus();
      });
      linkActions.addEventListener('click', function (e) {
        var b = e.target.closest('[data-link]');
        if (!b) return;
        var act = b.getAttribute('data-link');
        if (act === 'apply') applyLink();
        else if (act === 'remove') removeLink();
        else { closeMenu(false); restoreRange(); }
      });
      linkInput.addEventListener('input', function () { linkError.hidden = true; linkInput.removeAttribute('aria-invalid'); });

      doc.addEventListener('mousedown', function (e) {
        if (openMenu && !menus[openMenu].contains(e.target) && !buttons[openMenu].contains(e.target)) closeMenu(false);
      }, true);
      wrap.addEventListener('focusout', function (e) {
        var to = e.relatedTarget;
        if (openMenu && to && !wrap.contains(to)) closeMenu(false);
        if (to && wrap.contains(to)) return;
        if (dirty) { dirty = false; fire(textarea, 'change'); }
      });

      area.addEventListener('focus', function () {
        try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (err) { /* noop */ }
        // Sin CSS: negrita/cursiva/subrayado salen como <b>/<i>/<u>.
        try { doc.execCommand('styleWithCSS', false, false); } catch (err) { /* noop */ }
      });
      area.addEventListener('beforeinput', function (e) {
        var t = e.inputType || '';
        if (t.indexOf('insert') !== 0) return;
        if (t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'insertParagraph' || t === 'insertLineBreak'
          || t === 'insertOrderedList' || t === 'insertUnorderedList' || t === 'insertCompositionText') return;
        var data = e.data || '';
        if (!data && e.dataTransfer) data = e.dataTransfer.getData('text/plain') || '';
        if (!data) return;
        var room = max - (length() - selectedTextLength());
        if (textLength(data) > room) {
          e.preventDefault();
          if (room > 0) insertPlain(truncateText(data, room));
          announceFull();
        }
      });
      area.addEventListener('input', function (e) {
        e.stopPropagation();
        if (length() > max) trimExcess();
        normalizeDom();
        sync(false);
        updateState();
      });
      area.addEventListener('paste', function (e) {
        e.preventDefault();
        var data = (e.clipboardData || win.clipboardData);
        insertPlain(data ? data.getData('text/plain') || data.getData('Text') || '' : '');
      });
      area.addEventListener('drop', function (e) {
        e.preventDefault();
        var text = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
        if (!text) return;
        var r = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(e.clientX, e.clientY) : null;
        if (r) { var sel = win.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
        insertPlain(text);
      });
      area.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          openMenuFor('link');
          return;
        }
        if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
      });
      ['change', 'keyup', 'keypress'].forEach(function (type) {
        area.addEventListener(type, function (e) { e.stopPropagation(); });
      });
      doc.addEventListener('selectionchange', function () {
        if (rangeInArea()) { saveRange(); updateState(); }
      });

      /* ---- textarea como fuente de verdad ---- */
      try {
        Object.defineProperty(textarea, 'value', {
          configurable: true,
          get: function () { return TEXTAREA_VALUE.get.call(this); },
          set: function (v) { TEXTAREA_VALUE.set.call(this, v); load(v); }
        });
      } catch (err) { /* sin parche: usar setHTML */ }

      var pendingInvalid = false;
      textarea.addEventListener('invalid', function () {
        pendingInvalid = true;
        wrap.classList.add('wo-is-invalid');
        area.setAttribute('aria-invalid', 'true');
        setTimeout(function () { pendingInvalid = false; }, 0);
      });
      textarea.addEventListener('focus', function () {
        try { area.focus({ preventScroll: pendingInvalid ? false : true }); } catch (err) { area.focus(); }
        if (pendingInvalid) area.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });

      function syncDisabled() {
        var off = textarea.disabled || textarea.readOnly;
        area.setAttribute('contenteditable', off ? 'false' : 'true');
        area.setAttribute('aria-disabled', textarea.disabled ? 'true' : 'false');
        area.setAttribute('aria-readonly', textarea.readOnly ? 'true' : 'false');
        Array.prototype.forEach.call(bar.querySelectorAll('.wo-rt__btn'), function (b) { b.disabled = off; });
        wrap.classList.toggle('is-disabled', off);
        wrap.hidden = textarea.hidden;
      }
      new MutationObserver(syncDisabled).observe(textarea, { attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden', 'placeholder'] });
      if (textarea.form) textarea.form.addEventListener('reset', function () { setTimeout(function () { load(TEXTAREA_VALUE.get.call(textarea)); }, 0); });

      load(TEXTAREA_VALUE.get.call(textarea));
      syncDisabled();

      var controller = {
        pending: false,
        element: wrap,
        editor: area,
        textarea: textarea,
        maxLength: max,
        getHTML: function () { return isEmpty() ? '' : sanitize(area.innerHTML); },
        setHTML: function (html) { load(html); TEXTAREA_VALUE.set.call(textarea, lastValue || ''); fire(textarea, 'input'); fire(textarea, 'change'); },
        getText: function () { return area.textContent || ''; },
        getLength: length,
        focus: function () { area.focus(); },
        refresh: function () { syncDisabled(); updateCount(); },
        destroy: function () {
          try { delete textarea.value; } catch (err) { /* noop */ }
          textarea.classList.remove('wo-ctl-native');
          textarea.removeAttribute('tabindex');
          textarea.removeAttribute('aria-hidden');
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          delete textarea.__woRichText;
        }
      };
      controller.setValue = controller.setHTML;
      controller.setContent = controller.setHTML;
      controller.getValue = controller.getHTML;
      textarea.__woRichText = controller;
      return controller;
    }

    var api = {
      mount: mount,
      sanitize: sanitize,
      visibleTextLength: visibleTextLength,
      normalizeLinkInput: normalizeLinkInput,
      version: '1.0.0'
    };

    // Llamadas hechas antes de que este archivo cargara (stub del loader).
    var stub = win.WoRichText;
    var queue = stub && stub.__queue ? stub.__queue : [];
    win.WoRichText = api;
    queue.forEach(function (entry) {
      try {
        var real = mount(entry[0], entry[1]);
        Object.keys(real).forEach(function (k) { entry[2][k] = real[k]; });
        entry[2].pending = false;
      } catch (err) {
        entry[2].pending = false;
        entry[2].error = err;
        if (win.console) win.console.warn('[WoRichText] no se pudo montar', entry[0], err);
      }
    });

    function autoMount(root) {
      if (!root || !root.querySelectorAll) return;
      var list = root.matches && root.matches('textarea[data-wo-richtext]') ? [root] : [];
      Array.prototype.push.apply(list, root.querySelectorAll('textarea[data-wo-richtext]'));
      list.forEach(function (ta) {
        if (ta.__woRichText || ta.closest('[data-native]')) return;
        try { mount(ta, { maxLength: Number(ta.getAttribute('data-wo-richtext')) || undefined }); } catch (err) { /* noop */ }
      });
    }
    function startAuto() {
      autoMount(doc);
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && (n.tagName === 'TEXTAREA' || n.querySelector)) autoMount(n); });
        });
      }).observe(doc.documentElement, { childList: true, subtree: true });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', startAuto);
    else startAuto();
  }

  return { pure: pure, boot: boot };
});
