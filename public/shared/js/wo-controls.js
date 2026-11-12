/* ============================================================================
   We Ötzi DS · Controles propios — select, fecha y prefijo fijo.
   Se carga solo en todas las páginas (loader en config-manager.js / wo-icons.js).

   Contrato:
   - <select> (salvo [data-native] en el control o un ancestro): el nativo sigue
     visible como disparador y es la fuente de verdad (value, change/input,
     required, disabled). Solo se reemplaza la lista desplegable del navegador
     por una propia (ARIA listbox, búsqueda si hay más de 10 opciones, optgroup,
     teclado completo). <select multiple> usa un disparador propio.
   - <input type="date"> (salvo [data-native]): el nativo queda oculto con el
     valor ISO; se muestra un campo dd/mm/aaaa con calendario propio (min/max).
   - .wo-prefixed[data-prefix] > input: prefijo fijo no borrable.
   - API: window.WoControls.refresh(el) · window.WoControls.enhance(root).
   ========================================================================== */
(function (factory) {
  'use strict';
  var core = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = core.pure;
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__woControlsBooted) {
    window.__woControlsBooted = true;
    core.boot(window, document);
  }
})(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     Lógica pura (testeable en Node)
     ---------------------------------------------------------------------- */
  var SEARCH_THRESHOLD = 10;
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  var WEEKDAYS_SHORT = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function matchesQuery(label, query) {
    var q = normalizeText(query);
    if (!q) return true;
    return normalizeText(label).indexOf(q) !== -1;
  }

  function shouldSearch(optionCount) {
    return Number(optionCount) > SEARCH_THRESHOLD;
  }

  // Typeahead: siguiente opción habilitada cuyo texto empieza con el buffer.
  // Si el buffer es una sola letra repetida ("aaa") cicla entre las que empiezan
  // con esa letra, como el select nativo.
  function typeaheadIndex(labels, disabled, startIndex, buffer) {
    var list = labels || [];
    var n = list.length;
    if (!n) return -1;
    var b = normalizeText(buffer);
    if (!b) return -1;
    var allSame = b.split('').every(function (c) { return c === b[0]; });
    var needle = allSame ? b[0] : b;
    var from = allSame || b.length === 1 ? startIndex + 1 : startIndex;
    for (var k = 0; k < n; k++) {
      var i = ((from + k) % n + n) % n;
      if (disabled && disabled[i]) continue;
      if (normalizeText(list[i]).indexOf(needle) === 0) return i;
    }
    return -1;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pad4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m: 1-12

  function isValidYMD(y, m, d) {
    return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
      && y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }

  function toISO(y, m, d) { return pad4(y) + '-' + pad2(m) + '-' + pad2(d); }

  function parseISO(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    var y = +match[1], m = +match[2], d = +match[3];
    return isValidYMD(y, m, d) ? { y: y, m: m, d: d } : null;
  }

  // Acepta dd/mm/aaaa, d/m/aaaa, dd-mm-aaaa, dd.mm.aaaa y ddmmaaaa.
  function parseDisplayDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return null;
    var match = /^(\d{1,2})[\/.\-\s](\d{1,2})[\/.\-\s](\d{4})$/.exec(raw) || /^(\d{2})(\d{2})(\d{4})$/.exec(raw);
    if (!match) return null;
    var d = +match[1], m = +match[2], y = +match[3];
    return isValidYMD(y, m, d) ? toISO(y, m, d) : null;
  }

  function formatDisplayDate(iso) {
    var p = parseISO(iso);
    return p ? pad2(p.d) + '/' + pad2(p.m) + '/' + pad4(p.y) : '';
  }

  function formatLongDate(iso) {
    var p = parseISO(iso);
    if (!p) return '';
    var wd = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
    return WEEKDAYS[wd] + ' ' + p.d + ' de ' + MONTHS[p.m - 1] + ' de ' + p.y;
  }

  // Máscara mientras se escribe: solo dígitos, barras automáticas.
  function maskDateTyping(value) {
    var digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
  }

  function compareISO(a, b) { return a === b ? 0 : (a < b ? -1 : 1); }

  function isInRange(iso, min, max) {
    if (!parseISO(iso)) return false;
    if (parseISO(min) && iso < min) return false;
    if (parseISO(max) && iso > max) return false;
    return true;
  }

  function clampISO(iso, min, max) {
    var v = iso;
    if (parseISO(min) && v < min) v = min;
    if (parseISO(max) && v > max) v = max;
    return v;
  }

  function addDays(iso, n) {
    var p = parseISO(iso);
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  function addMonths(iso, n) {
    var p = parseISO(iso);
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12), m = total % 12 + 1;
    return toISO(y, m, Math.min(p.d, daysInMonth(y, m)));
  }

  function todayISO(now) {
    var t = now || new Date();
    return toISO(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }

  // 6 semanas × 7 días, lunes primero.
  function calendarMatrix(year, month) {
    var first = new Date(Date.UTC(year, month - 1, 1));
    var offset = (first.getUTCDay() + 6) % 7;
    var start = toISO(year, month, 1);
    start = addDays(start, -offset);
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var row = [];
      for (var d = 0; d < 7; d++) {
        var iso = addDays(start, w * 7 + d);
        var p = parseISO(iso);
        row.push({ iso: iso, y: p.y, m: p.m, d: p.d, inMonth: p.m === month && p.y === year });
      }
      weeks.push(row);
    }
    return weeks;
  }

  function monthInRange(y, m, min, max) {
    var first = toISO(y, m, 1), last = toISO(y, m, daysInMonth(y, m));
    if (parseISO(min) && last < min) return false;
    if (parseISO(max) && first > max) return false;
    return true;
  }

  function yearInRange(y, min, max) {
    if (parseISO(min) && y < parseISO(min).y) return false;
    if (parseISO(max) && y > parseISO(max).y) return false;
    return true;
  }

  function dateRangeMessage(min, max) {
    var a = formatDisplayDate(min), b = formatDisplayDate(max);
    if (a && b) return 'Elegí una fecha entre el ' + a + ' y el ' + b + '.';
    if (a) return 'Elegí una fecha desde el ' + a + '.';
    if (b) return 'Elegí una fecha hasta el ' + b + '.';
    return '';
  }

  // Prefijo fijo: quita el prefijo (y sus variantes de URL) si el usuario lo pegó.
  function normalizePrefixedValue(value, prefix) {
    var v = String(value == null ? '' : value).replace(/^\s+/, '');
    var p = String(prefix || '');
    if (!p) return v;
    if (p === '@') {
      var url = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/@?([^\/?#\s]+)/i.exec(v);
      if (url && /\//.test(v)) v = url[1];
      return v.replace(/^@+/, '');
    }
    var lower = p.toLowerCase();
    var bare = lower.replace(/^https?:\/\//, '');
    var guard = 0;
    var changed = true;
    while (changed && guard++ < 5) {
      changed = false;
      var before = v;
      v = v.replace(/^https?:\/\//i, '');
      if (bare) {
        var withoutWww = v.replace(/^www\./i, '');
        var bareNoWww = bare.replace(/^www\./, '');
        if (withoutWww.toLowerCase().indexOf(bareNoWww) === 0) v = withoutWww.slice(bareNoWww.length);
        else if (v.toLowerCase().indexOf(bare) === 0) v = v.slice(bare.length);
      }
      if (v !== before) changed = true;
    }
    return v;
  }

  var pure = {
    SEARCH_THRESHOLD: SEARCH_THRESHOLD,
    MONTHS: MONTHS,
    WEEKDAYS_SHORT: WEEKDAYS_SHORT,
    normalizeText: normalizeText,
    matchesQuery: matchesQuery,
    shouldSearch: shouldSearch,
    typeaheadIndex: typeaheadIndex,
    isValidYMD: isValidYMD,
    toISO: toISO,
    parseISO: parseISO,
    parseDisplayDate: parseDisplayDate,
    formatDisplayDate: formatDisplayDate,
    formatLongDate: formatLongDate,
    maskDateTyping: maskDateTyping,
    compareISO: compareISO,
    isInRange: isInRange,
    clampISO: clampISO,
    addDays: addDays,
    addMonths: addMonths,
    todayISO: todayISO,
    calendarMatrix: calendarMatrix,
    monthInRange: monthInRange,
    yearInRange: yearInRange,
    dateRangeMessage: dateRangeMessage,
    normalizePrefixedValue: normalizePrefixedValue
  };

  /* ------------------------------------------------------------------------
     Navegador
     ---------------------------------------------------------------------- */
  function boot(win, doc) {
    var uid = 0;
    var current = null; // popover abierto: { anchor, pop, close(), reposition(), onKey(e) }
    var proxies = new WeakMap(); // nativo -> controlador (date / multiple / prefixed)
    var INPUT_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    var SELECT_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    var SELECT_INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    var ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    var ICON_LEFT = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polyline points="15 18 9 12 15 6"/></svg>';
    var ICON_RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polyline points="9 18 15 12 9 6"/></svg>';
    var ICON_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"/></svg>';

    function nextId(prefix) { uid += 1; return 'wo-' + prefix + '-' + uid; }

    function isOptedOut(el) { return !!(el && el.closest && el.closest('[data-native]')); }

    function fire(el, type) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }

    function labelText(el) {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      var ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (ids.length) {
        return ids.map(function (id) { var n = doc.getElementById(id); return n ? n.textContent : ''; }).join(' ').trim();
      }
      if (el.labels && el.labels.length) return el.labels[0].textContent.replace(/\s+/g, ' ').trim();
      return el.getAttribute('title') || el.getAttribute('placeholder') || '';
    }

    function ensureLabelId(el) {
      if (el.labels && el.labels.length) {
        var lab = el.labels[0];
        if (!lab.id) lab.id = nextId('label');
        return lab.id;
      }
      return '';
    }

    /* ---------- Popover: host, posición y cierre ---------- */

    // El popover se inserta en el modal más cercano (diálogo en top layer, foco
    // atrapado, "click afuera") o en <body>. Va con position:fixed y se corrige
    // si un ancestro transformado cambia el bloque contenedor.
    function hostCandidates(anchor) {
      var list = [];
      var n = anchor.parentElement;
      while (n && n !== doc.body) {
        if (n.matches('dialog, [aria-modal="true"], [role="dialog"], [role="alertdialog"]')) list.push(n);
        n = n.parentElement;
      }
      list.push(doc.body);
      return list;
    }

    function viewportBox() {
      var vv = win.visualViewport;
      var w = doc.documentElement.clientWidth || win.innerWidth;
      var h = vv ? vv.height : win.innerHeight;
      var top = vv ? vv.offsetTop : 0;
      return { left: 0, top: top, width: w, height: h };
    }

    // Rectángulo visible del ancla recortado por sus ancestros con scroll.
    function visibleRect(el) {
      var r = el.getBoundingClientRect();
      var box = { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
      var n = el.parentElement;
      while (n && n !== doc.body && n !== doc.documentElement) {
        var cs = win.getComputedStyle(n);
        if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowY + cs.overflowX)) {
          var pr = n.getBoundingClientRect();
          box.top = Math.max(box.top, pr.top); box.left = Math.max(box.left, pr.left);
          box.bottom = Math.min(box.bottom, pr.bottom); box.right = Math.min(box.right, pr.right);
        }
        n = n.parentElement;
      }
      var vp = viewportBox();
      box.top = Math.max(box.top, vp.top); box.bottom = Math.min(box.bottom, vp.top + vp.height);
      return box.bottom - box.top > 2 && box.right - box.left > 2 ? box : null;
    }

    function placePopover(pop, anchor, opts) {
      opts = opts || {};
      var vp = viewportBox();
      var gap = 4, margin = 8;
      var r = anchor.getBoundingClientRect();
      var width = Math.max(r.width, opts.minWidth || 0);
      if (opts.width) width = opts.width;
      width = Math.min(width, vp.width - margin * 2);
      pop.style.width = width + 'px';
      pop.style.maxHeight = '';
      // offsetHeight incluye el borde (max-height es border-box).
      var natural = Math.max(pop.offsetHeight, pop.scrollHeight);
      var below = vp.top + vp.height - r.bottom - gap - margin;
      var above = r.top - vp.top - gap - margin;
      var cap = opts.maxHeight || 360;
      var wanted = Math.min(natural, cap);
      var placeBelow = below >= wanted || below >= above;
      var avail = Math.max(120, placeBelow ? below : above);
      var height = Math.min(wanted, avail);
      if (opts.fitContent !== true) pop.style.maxHeight = height + 'px';
      var top = placeBelow ? r.bottom + gap : r.top - gap - Math.min(natural, height);
      var left = Math.min(Math.max(r.left, margin), vp.width - width - margin);
      pop.dataset.side = placeBelow ? 'bottom' : 'top';
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      // Corrección de bloque contenedor (ancestro con transform/filter).
      var actual = pop.getBoundingClientRect();
      var dx = actual.left - left, dy = actual.top - top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        pop.style.left = (left - dx) + 'px';
        pop.style.top = (top - dy) + 'px';
      }
    }

    function mountPopover(pop, anchor) {
      var hosts = hostCandidates(anchor);
      hosts[0].appendChild(pop);
      return hosts;
    }

    function closeCurrent(opts) {
      if (current) current.close(opts || {});
    }

    function onWindowScroll(e) {
      if (!current) return;
      if (e && e.target && e.target.nodeType === 1 && current.pop.contains(e.target)) return;
      if (!visibleRect(current.anchor)) { closeCurrent({ restoreFocus: false }); return; }
      current.reposition();
    }

    win.addEventListener('scroll', onWindowScroll, true);
    win.addEventListener('resize', function () { if (current) current.reposition(); });
    if (win.visualViewport) win.visualViewport.addEventListener('resize', function () { if (current) current.reposition(); });

    doc.addEventListener('mousedown', function (e) {
      if (!current) return;
      var t = e.target;
      if (current.pop.contains(t) || current.anchor === t || (current.owns && current.owns(t))) return;
      closeCurrent({ restoreFocus: false });
    }, true);

    doc.addEventListener('focusin', function (e) {
      if (!current) return;
      var t = e.target;
      if (current.pop.contains(t) || current.anchor === t || (current.owns && current.owns(t))) return;
      closeCurrent({ restoreFocus: false });
    }, true);

    /* ---------- Select ---------- */

    function isEnhanceableSelect(el) {
      return !!el && el.tagName === 'SELECT' && !el.multiple && !(el.size > 1) && !isOptedOut(el);
    }

    function selectItems(sel) {
      var items = [];
      var groups = [];
      function pushOption(opt, group) {
        if (opt.hidden || opt.style.display === 'none') return;
        var isPlaceholder = opt.value === '' && opt.index === 0;
        if (isPlaceholder && opt.disabled) return; // placeholder no elegible
        items.push({
          opt: opt,
          label: (opt.label || opt.textContent || '').replace(/\s+/g, ' ').trim(),
          disabled: opt.disabled || !!(group && group.disabled),
          placeholder: isPlaceholder,
          group: group || null
        });
      }
      Array.prototype.forEach.call(sel.children, function (child) {
        if (child.tagName === 'OPTION') pushOption(child, null);
        else if (child.tagName === 'OPTGROUP') {
          if (child.hidden) return;
          groups.push(child);
          Array.prototype.forEach.call(child.children, function (opt) {
            if (opt.tagName === 'OPTION') pushOption(opt, child);
          });
        }
      });
      return items;
    }

    function syncEmptyState(sel) {
      if (!sel || sel.multiple) return;
      // Solo un placeholder real (opción vacía deshabilitada u oculta) se ve atenuado:
      // una opción vacía elegible ("Todos") es un valor legítimo.
      var opt = sel.options[SELECT_INDEX.get.call(sel)];
      var empty = !opt || (opt.value === '' && (opt.disabled || opt.hidden));
      sel.classList.toggle('wo-sel-empty', empty);
    }

    function patchSelectValue(sel) {
      if (sel.__woValuePatched) return;
      sel.__woValuePatched = true;
      try {
        Object.defineProperty(sel, 'value', {
          configurable: true,
          get: function () { return SELECT_VALUE.get.call(this); },
          set: function (v) { SELECT_VALUE.set.call(this, v); syncEmptyState(this); refreshIfOpen(this); }
        });
        Object.defineProperty(sel, 'selectedIndex', {
          configurable: true,
          get: function () { return SELECT_INDEX.get.call(this); },
          set: function (v) { SELECT_INDEX.set.call(this, v); syncEmptyState(this); refreshIfOpen(this); }
        });
      } catch (err) { /* navegador sin soporte: el estado vacío se sincroniza en change */ }
    }

    function enhanceSelect(sel) {
      if (sel.__woSelect) { syncEmptyState(sel); return; }
      if (sel.multiple) { enhanceMultiple(sel); return; }
      if (!isEnhanceableSelect(sel)) return;
      sel.__woSelect = true;
      sel.classList.add('wo-sel');
      sel.setAttribute('aria-haspopup', 'listbox');
      sel.setAttribute('aria-expanded', 'false');
      syncEmptyState(sel);
      patchSelectValue(sel);
      sel.addEventListener('change', function () { syncEmptyState(sel); });
    }

    function refreshIfOpen(el) {
      if (current && (current.anchor === el || current.source === el) && current.rebuild) current.rebuild();
    }

    // Lista desplegable compartida por select simple y múltiple.
    function openListbox(sel, anchor, opts) {
      opts = opts || {};
      if (current && current.source === sel) return current;
      closeCurrent({ restoreFocus: false });
      var multiple = sel.multiple;
      var pop = doc.createElement('div');
      pop.className = 'wo-pop wo-pop--select';
      var listId = nextId('listbox');
      var items = [];
      var visible = [];
      var active = -1;
      var search = null;
      var list = doc.createElement('ul');
      list.className = 'wo-pop__list';
      list.id = listId;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', labelText(sel) || 'Opciones');
      if (multiple) list.setAttribute('aria-multiselectable', 'true');
      var empty = doc.createElement('div');
      empty.className = 'wo-pop__empty';
      empty.textContent = 'Sin resultados';
      empty.hidden = true;

      function build() {
        items = selectItems(sel);
        list.textContent = '';
        var groupEls = new Map();
        items.forEach(function (it) {
          var li = doc.createElement('li');
          li.className = 'wo-opt';
          li.id = nextId('opt');
          li.setAttribute('role', 'option');
          li.textContent = it.label || '\u00a0';
          if (it.disabled) li.setAttribute('aria-disabled', 'true');
          it.el = li;
          if (it.group) {
            var g = groupEls.get(it.group);
            if (!g) {
              var wrap = doc.createElement('li');
              wrap.className = 'wo-opt-group';
              wrap.setAttribute('role', 'presentation');
              var gl = doc.createElement('div');
              gl.className = 'wo-opt-group__label';
              gl.id = nextId('grp');
              gl.setAttribute('role', 'presentation');
              gl.textContent = it.group.label || '';
              var ul = doc.createElement('ul');
              ul.setAttribute('role', 'group');
              ul.setAttribute('aria-labelledby', gl.id);
              wrap.appendChild(gl);
              wrap.appendChild(ul);
              list.appendChild(wrap);
              g = { wrap: wrap, ul: ul };
              groupEls.set(it.group, g);
            }
            g.ul.appendChild(li);
            it.groupEl = g.wrap;
          } else {
            list.appendChild(li);
          }
        });
        syncSelected();
        filter(search ? search.value : '', true);
      }

      function syncSelected() {
        items.forEach(function (it) {
          it.el.setAttribute('aria-selected', it.opt.selected ? 'true' : 'false');
        });
      }

      function filter(q, keepActive) {
        visible = [];
        var groupsSeen = new Map();
        items.forEach(function (it) {
          var show = matchesQuery(it.label, q) && !(q && it.placeholder);
          it.el.hidden = !show;
          if (show) visible.push(it);
          if (it.groupEl) groupsSeen.set(it.groupEl, (groupsSeen.get(it.groupEl) || false) || show);
        });
        groupsSeen.forEach(function (show, el) { el.hidden = !show; });
        empty.hidden = visible.length > 0;
        var prev = keepActive && active >= 0 && visible.indexOf(prevActiveItem) !== -1 ? visible.indexOf(prevActiveItem) : -1;
        if (prev !== -1) setActive(prev, false);
        else {
          var selIdx = -1;
          for (var i = 0; i < visible.length; i++) { if (visible[i].opt.selected && !visible[i].disabled) { selIdx = i; break; } }
          setActive(selIdx !== -1 && !q ? selIdx : firstEnabled(0, 1), true);
        }
      }

      var prevActiveItem = null;
      function firstEnabled(from, step) {
        for (var i = from; i >= 0 && i < visible.length; i += step) if (!visible[i].disabled) return i;
        return -1;
      }

      function setActive(i, scroll) {
        items.forEach(function (it) { it.el.classList.remove('is-active'); });
        active = i;
        prevActiveItem = i >= 0 ? visible[i] : null;
        var target = search || anchor;
        if (i < 0 || !visible[i]) { target.removeAttribute('aria-activedescendant'); return; }
        var el = visible[i].el;
        el.classList.add('is-active');
        target.setAttribute('aria-activedescendant', el.id);
        if (scroll !== false) {
          var lt = list.scrollTop, lh = list.clientHeight, et = el.offsetTop, eh = el.offsetHeight;
          if (et < lt) list.scrollTop = et - 4;
          else if (et + eh > lt + lh) list.scrollTop = et + eh - lh + 4;
        }
      }

      function move(delta) {
        if (!visible.length) return;
        var i = active;
        var step = delta > 0 ? 1 : -1;
        var count = Math.abs(delta);
        var last = i;
        while (count > 0) {
          var n = (i < 0 ? (step > 0 ? -1 : visible.length) : i) + step;
          if (n < 0 || n >= visible.length) break;
          i = n;
          if (!visible[i].disabled) { last = i; count--; }
        }
        if (last >= 0) setActive(last);
      }

      function commit(it) {
        if (!it || it.disabled) return;
        if (multiple) {
          it.opt.selected = !it.opt.selected;
          syncSelected();
          fire(sel, 'input'); fire(sel, 'change');
          if (opts.onChange) opts.onChange();
          return;
        }
        var changed = SELECT_INDEX.get.call(sel) !== it.opt.index;
        SELECT_INDEX.set.call(sel, it.opt.index);
        syncEmptyState(sel);
        close({ restoreFocus: true });
        if (changed) { fire(sel, 'input'); fire(sel, 'change'); }
      }

      if (shouldSearch(selectItems(sel).length)) {
        var sw = doc.createElement('div');
        sw.className = 'wo-pop__search';
        sw.innerHTML = ICON_SEARCH;
        search = doc.createElement('input');
        search.type = 'text';
        search.className = 'wo-pop__search-input';
        search.setAttribute('placeholder', 'Buscar…');
        search.setAttribute('autocomplete', 'off');
        search.setAttribute('spellcheck', 'false');
        search.setAttribute('role', 'combobox');
        search.setAttribute('aria-expanded', 'true');
        search.setAttribute('aria-controls', listId);
        search.setAttribute('aria-autocomplete', 'list');
        search.setAttribute('aria-label', 'Buscar en ' + (labelText(sel) || 'las opciones'));
        sw.appendChild(search);
        pop.appendChild(sw);
        ['input', 'change', 'keyup', 'keypress'].forEach(function (type) {
          search.addEventListener(type, function (e) {
            e.stopPropagation();
            if (type === 'input') filter(search.value, false);
          });
        });
        search.addEventListener('keydown', function (e) { e.stopPropagation(); handleKey(e, true); });
      }
      pop.appendChild(list);
      pop.appendChild(empty);

      list.addEventListener('mousedown', function (e) { e.preventDefault(); });
      list.addEventListener('click', function (e) {
        var li = e.target.closest('.wo-opt');
        if (!li) return;
        var it = items.find(function (x) { return x.el === li; });
        if (it) { setActive(visible.indexOf(it), false); commit(it); }
      });
      list.addEventListener('mousemove', function (e) {
        var li = e.target.closest('.wo-opt');
        if (!li) return;
        var idx = visible.findIndex(function (x) { return x.el === li; });
        if (idx !== -1 && idx !== active && !visible[idx].disabled) setActive(idx, false);
      });
      pop.addEventListener('mousedown', function (e) { if (e.target !== search) e.preventDefault(); });

      var typeBuffer = '', typeTimer = 0;
      function typeahead(ch) {
        clearTimeout(typeTimer);
        typeBuffer += ch;
        typeTimer = setTimeout(function () { typeBuffer = ''; }, 600);
        var labels = visible.map(function (x) { return x.label; });
        var dis = visible.map(function (x) { return x.disabled; });
        var idx = typeaheadIndex(labels, dis, active < 0 ? -1 : active, typeBuffer);
        if (idx !== -1) setActive(idx);
      }

      function handleKey(e, fromSearch) {
        var k = e.key;
        // Las teclas que maneja la lista no llegan a los atajos de la página
        // (p. ej. Enter = "siguiente paso" en el registro).
        if (k !== 'Tab' && (k.length > 1 || !fromSearch)) e.stopPropagation();
        if (k === 'ArrowDown') { e.preventDefault(); if (e.altKey) return; move(1); return; }
        if (k === 'ArrowUp') {
          e.preventDefault();
          if (e.altKey) { if (!multiple) commit(visible[active]); else close({ restoreFocus: true }); return; }
          move(-1); return;
        }
        if (k === 'PageDown') { e.preventDefault(); move(10); return; }
        if (k === 'PageUp') { e.preventDefault(); move(-10); return; }
        if ((k === 'Home' || k === 'End') && !fromSearch) {
          e.preventDefault();
          setActive(k === 'Home' ? firstEnabled(0, 1) : firstEnabled(visible.length - 1, -1));
          return;
        }
        if (k === 'Enter') { e.preventDefault(); if (active >= 0) commit(visible[active]); return; }
        if (k === ' ' && !fromSearch && !typeBuffer) { e.preventDefault(); if (active >= 0) commit(visible[active]); return; }
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close({ restoreFocus: true }); return; }
        if (k === 'Tab') { close({ restoreFocus: true }); return; }
        if (!fromSearch && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          if (search) { search.focus(); search.value += k; filter(search.value, false); }
          else typeahead(k);
        }
      }

      function reposition() { placePopover(pop, anchor, { minWidth: 200 }); }

      function close(o) {
        if (current !== state) return;
        current = null;
        clearTimeout(typeTimer);
        anchor.setAttribute('aria-expanded', 'false');
        anchor.removeAttribute('aria-activedescendant');
        anchor.removeAttribute('aria-controls');
        anchor.classList.remove('is-open');
        if (pop.parentNode) pop.parentNode.removeChild(pop);
        // En táctil no se devuelve el foco al select: iOS abriría su selector nativo.
        if (o && o.restoreFocus && !opts.noFocus) { try { anchor.focus({ preventScroll: true }); } catch (err) { anchor.focus(); } }
        if (opts.onClose) opts.onClose();
      }

      var state = {
        anchor: anchor,
        source: sel,
        pop: pop,
        close: close,
        reposition: reposition,
        rebuild: function () { build(); reposition(); },
        onKey: function (e) { handleKey(e, false); }
      };
      current = state;
      mountPopover(pop, anchor);
      build();
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', listId);
      anchor.classList.add('is-open');
      reposition();
      if (search && opts.focusSearch !== false) {
        search.focus({ preventScroll: true });
        if (opts.initialChar) { search.value = opts.initialChar; filter(search.value, false); }
      } else if (opts.initialChar) {
        typeahead(opts.initialChar);
      }
      return state;
    }

    function selectFromEventTarget(t) {
      if (!t || t.nodeType !== 1) return null;
      var sel = t.tagName === 'SELECT' ? t : (t.closest ? t.closest('select') : null);
      return sel && isEnhanceableSelect(sel) ? sel : null;
    }

    function toggleSelect(sel, opts) {
      if (sel.matches(':disabled')) return;
      enhanceSelect(sel);
      if (current && current.source === sel) { closeCurrent({ restoreFocus: !opts.noFocus }); return; }
      if (!opts.noFocus) { try { sel.focus({ preventScroll: true }); } catch (err) { sel.focus(); } }
      openListbox(sel, sel, opts);
    }

    // Delegación: un solo listener para todos los selects (también los que
    // las páginas insertan después).
    win.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var sel = selectFromEventTarget(e.target);
      if (!sel) return;
      e.preventDefault();
      toggleSelect(sel, { focusSearch: true });
    }, true);

    var touchStart = null;
    win.addEventListener('touchstart', function (e) {
      var sel = selectFromEventTarget(e.target);
      touchStart = sel && e.touches.length === 1 ? { sel: sel, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }, { capture: true, passive: true });
    win.addEventListener('touchend', function (e) {
      if (!touchStart) return;
      var t = e.changedTouches[0];
      var moved = Math.abs(t.clientX - touchStart.x) > 10 || Math.abs(t.clientY - touchStart.y) > 10;
      var sel = touchStart.sel;
      touchStart = null;
      if (moved || selectFromEventTarget(e.target) !== sel) return;
      if (e.cancelable) e.preventDefault();
      // En táctil no se enfoca la búsqueda: el teclado taparía la lista.
      toggleSelect(sel, { focusSearch: false, noFocus: true });
    }, { capture: true, passive: false });

    win.addEventListener('keydown', function (e) {
      // Escape cierra el popover abierto sin llegar a los modales de la página.
      if (current && e.key === 'Escape' && (current.anchor === e.target || current.pop.contains(e.target))) {
        e.preventDefault(); e.stopPropagation();
        closeCurrent({ restoreFocus: true });
        return;
      }
      if (current && current.onKey && (e.target === current.anchor)) { current.onKey(e); return; }
      var sel = selectFromEventTarget(e.target);
      if (!sel || sel.matches(':disabled')) return;
      var k = e.key;
      var opens = k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' || k === 'F4'
        || (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey);
      if (!opens) return;
      e.preventDefault();
      enhanceSelect(sel);
      var printable = k.length === 1 && k !== ' ';
      openListbox(sel, sel, { focusSearch: true, initialChar: printable ? k : '' });
    }, true);

    /* ---------- Select múltiple: disparador propio ---------- */

    function multipleSummary(sel) {
      var chosen = Array.prototype.filter.call(sel.options, function (o) { return o.selected && o.value !== ''; });
      if (!chosen.length) {
        var ph = sel.getAttribute('data-placeholder');
        var first = sel.options[0];
        if (!ph && first && first.value === '') ph = first.textContent.trim();
        return { text: ph || 'Seleccioná…', empty: true };
      }
      if (chosen.length <= 2) return { text: chosen.map(function (o) { return o.textContent.trim(); }).join(', '), empty: false };
      return { text: chosen.length + ' seleccionadas', empty: false };
    }

    function hideNative(el) {
      el.classList.add('wo-ctl-native');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('aria-hidden', 'true');
    }

    function mirrorLook(native, proxy, extraClass) {
      var cls = native.className.split(/\s+/).filter(function (c) {
        return c && c !== 'wo-ctl-native' && c !== 'wo-sel' && c !== 'wo-sel-empty';
      });
      proxy.className = cls.concat(extraClass).join(' ');
      proxy.style.cssText = native.style.cssText;
      var hiddenByPage = native.hidden || win.getComputedStyle(native).display === 'none';
      proxy.hidden = hiddenByPage;
      if (hiddenByPage) proxy.style.display = 'none';
    }

    function wireValidity(native, proxy, ctl) {
      var pendingInvalid = false;
      native.addEventListener('invalid', function () {
        pendingInvalid = true;
        proxy.classList.add('wo-is-invalid');
        proxy.setAttribute('aria-invalid', 'true');
        setTimeout(function () { pendingInvalid = false; }, 0);
      });
      native.addEventListener('focus', function () {
        var report = pendingInvalid;
        ctl.focus();
        if (report && typeof proxy.reportValidity === 'function' && proxy.setCustomValidity) {
          proxy.setCustomValidity(native.validationMessage || 'Completá este campo.');
          proxy.reportValidity();
          ctl.validityFromNative = true;
        }
      });
    }

    function clearValidity(native, proxy, ctl) {
      // validity.valid no dispara 'invalid' (checkValidity sí).
      if (!native.validity || native.validity.valid) {
        proxy.classList.remove('wo-is-invalid');
        proxy.removeAttribute('aria-invalid');
      }
      if (ctl.validityFromNative && proxy.setCustomValidity) {
        proxy.setCustomValidity('');
        ctl.validityFromNative = false;
      }
    }

    function observeNative(native, sync, extraAttrs) {
      var mo = new MutationObserver(function () { sync(); });
      mo.observe(native, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'disabled', 'readonly', 'required', 'aria-invalid'].concat(extraAttrs || [])
      });
      return mo;
    }

    function enhanceMultiple(sel) {
      if (proxies.has(sel) || isOptedOut(sel) || !sel.multiple) return;
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'combobox');
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      var labId = ensureLabelId(sel);
      var valueSpan = doc.createElement('span');
      valueSpan.className = 'wo-msel__value';
      valueSpan.id = nextId('msel');
      btn.appendChild(valueSpan);
      if (labId) btn.setAttribute('aria-labelledby', labId + ' ' + valueSpan.id);
      else btn.setAttribute('aria-label', labelText(sel) || 'Opciones');
      var ctl = {
        focus: function () { try { btn.focus({ preventScroll: true }); } catch (err) { btn.focus(); } },
        sync: function () {
          mirrorLook(sel, btn, ['wo-msel']);
          btn.disabled = sel.disabled;
          var s = multipleSummary(sel);
          valueSpan.textContent = s.text;
          btn.classList.toggle('wo-sel-empty', s.empty);
          clearValidity(sel, btn, ctl);
          if (current && current.source === sel) current.rebuild();
        }
      };
      proxies.set(sel, ctl);
      sel.__woSelect = true;
      hideNative(sel);
      sel.parentNode.insertBefore(btn, sel.nextSibling);
      btn.addEventListener('click', function () {
        if (current && current.source === sel) { closeCurrent({ restoreFocus: true }); return; }
        openListbox(sel, btn, { focusSearch: true, onChange: ctl.sync });
      });
      btn.addEventListener('keydown', function (e) {
        if (current && current.source === sel) return; // lo maneja el listener global
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'F4') {
          e.preventDefault();
          openListbox(sel, btn, { focusSearch: true, onChange: ctl.sync });
        }
      });
      sel.addEventListener('change', ctl.sync);
      wireValidity(sel, btn, ctl);
      observeNative(sel, ctl.sync);
      new MutationObserver(ctl.sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled', 'label'] });
      if (sel.form) sel.form.addEventListener('reset', function () { setTimeout(ctl.sync, 0); });
      ctl.sync();
    }

    /* ---------- Fecha ---------- */

    function enhanceDate(input) {
      if (proxies.has(input) || isOptedOut(input) || input.type !== 'date') return;
      var proxy = doc.createElement('input');
      proxy.type = 'text';
      proxy.setAttribute('inputmode', 'numeric');
      proxy.setAttribute('autocomplete', 'off');
      proxy.setAttribute('placeholder', 'dd/mm/aaaa');
      proxy.setAttribute('maxlength', '10');
      proxy.setAttribute('aria-haspopup', 'dialog');
      proxy.setAttribute('aria-expanded', 'false');
      proxy.setAttribute('data-wo-proxy', 'date');
      var labId = ensureLabelId(input);
      if (labId) proxy.setAttribute('aria-labelledby', labId);
      else if (labelText(input)) proxy.setAttribute('aria-label', labelText(input));
      var hint = doc.createElement('span');
      hint.className = 'wo-ctl-sr wo-date-hint';
      hint.id = nextId('datehint');
      hint.textContent = 'Formato dd/mm/aaaa. Flecha abajo abre el calendario.';
      var described = [input.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' ');
      proxy.setAttribute('aria-describedby', described);

      var ctl = {
        input: input,
        proxy: proxy,
        focus: function () { try { proxy.focus({ preventScroll: false }); } catch (err) { proxy.focus(); } },
        sync: function () {
          mirrorLook(input, proxy, ['wo-date-proxy']);
          proxy.disabled = input.disabled;
          proxy.readOnly = input.readOnly;
          var iso = INPUT_VALUE.get.call(input);
          // Mientras se escribe no se pisa el texto parcial; sí si la página
          // asigna otra fecha por JS.
          if (doc.activeElement !== proxy || (iso && parseDisplayDate(proxy.value) !== iso)) {
            INPUT_VALUE.set.call(proxy, formatDisplayDate(iso));
          }
          if (input.classList.contains('error') || input.getAttribute('aria-invalid') === 'true') proxy.setAttribute('aria-invalid', 'true');
          clearValidity(input, proxy, ctl);
          if (current && current.source === input && current.rebuild) current.rebuild();
        }
      };
      proxies.set(input, ctl);
      hideNative(input);
      input.parentNode.insertBefore(proxy, input.nextSibling);
      input.parentNode.insertBefore(hint, proxy.nextSibling);

      // El nativo conserva el valor ISO: también si la página lo asigna por JS.
      try {
        Object.defineProperty(input, 'value', {
          configurable: true,
          get: function () { return INPUT_VALUE.get.call(this); },
          set: function (v) { INPUT_VALUE.set.call(this, v); ctl.sync(); }
        });
        ['valueAsDate', 'valueAsNumber'].forEach(function (prop) {
          var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop);
          if (!d) return;
          Object.defineProperty(input, prop, {
            configurable: true,
            get: function () { return d.get.call(this); },
            set: function (v) { d.set.call(this, v); ctl.sync(); }
          });
        });
      } catch (err) { /* sin parche: se sincroniza por eventos */ }

      function setNative(iso, emitChange) {
        var prev = INPUT_VALUE.get.call(input);
        if (prev === iso) { ctl.sync(); return; }
        INPUT_VALUE.set.call(input, iso);
        ctl.sync();
        fire(input, 'input');
        if (emitChange) fire(input, 'change');
      }
      ctl.setNative = setNative;

      function commitTyped(emitChange) {
        var raw = proxy.value.trim();
        proxy.setCustomValidity('');
        if (!raw) { setNative('', emitChange); return; }
        var iso = parseDisplayDate(raw);
        if (!iso) {
          proxy.setCustomValidity('Ingresá una fecha válida con formato dd/mm/aaaa.');
          if (INPUT_VALUE.get.call(input)) setNative('', emitChange);
          return;
        }
        if (!isInRange(iso, input.min, input.max)) {
          proxy.setCustomValidity(dateRangeMessage(input.min, input.max) || 'La fecha está fuera de rango.');
          if (INPUT_VALUE.get.call(input)) setNative('', emitChange);
          return;
        }
        setNative(iso, emitChange);
        INPUT_VALUE.set.call(proxy, formatDisplayDate(iso));
      }

      proxy.addEventListener('input', function (e) {
        e.stopPropagation();
        var atEnd = proxy.selectionStart === proxy.value.length;
        var deleting = e.inputType && e.inputType.indexOf('delete') === 0;
        if (atEnd && !deleting) {
          var masked = maskDateTyping(proxy.value);
          if (masked !== proxy.value) INPUT_VALUE.set.call(proxy, masked);
        }
        proxy.setCustomValidity('');
        proxy.classList.remove('wo-is-invalid');
        var iso = parseDisplayDate(proxy.value);
        if (iso && isInRange(iso, input.min, input.max)) setNative(iso, false);
        else if (!proxy.value.trim()) setNative('', false);
        if (current && current.source === input && iso) current.goTo(iso);
      });
      proxy.addEventListener('change', function (e) { e.stopPropagation(); commitTyped(true); });
      proxy.addEventListener('blur', function () {
        if (current && current.source === input) return;
        var iso = parseDisplayDate(proxy.value);
        if (proxy.value && iso) INPUT_VALUE.set.call(proxy, formatDisplayDate(iso));
      });
      proxy.addEventListener('click', function () {
        if (proxy.disabled || proxy.readOnly) return;
        if (!(current && current.source === input)) openCalendar(ctl, { focusGrid: false });
      });
      // En táctil, el primer toque abre el calendario sin levantar el teclado
      // (lo taparía); un segundo toque con el calendario abierto deja escribir.
      var touchAt = null;
      proxy.addEventListener('touchstart', function (e) {
        touchAt = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      }, { passive: true });
      proxy.addEventListener('touchend', function (e) {
        if (!touchAt || proxy.disabled || proxy.readOnly) return;
        var t = e.changedTouches[0];
        var moved = Math.abs(t.clientX - touchAt.x) > 10 || Math.abs(t.clientY - touchAt.y) > 10;
        touchAt = null;
        if (moved || (current && current.source === input) || doc.activeElement === proxy) return;
        if (e.cancelable) e.preventDefault();
        openCalendar(ctl, { focusGrid: false });
      }, { passive: false });
      proxy.addEventListener('keydown', function (e) {
        if (proxy.disabled || proxy.readOnly) return;
        var open = current && current.source === input;
        if (e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
          e.preventDefault();
          if (open) current.focusGrid(); else openCalendar(ctl, { focusGrid: true });
        } else if (e.key === 'Escape' && open) {
          e.preventDefault(); e.stopPropagation();
          closeCurrent({ restoreFocus: true });
        } else if (e.key === 'Enter') {
          commitTyped(true);
          if (open) { e.stopPropagation(); e.preventDefault(); closeCurrent({ restoreFocus: true }); }
          if (!proxy.checkValidity()) { e.preventDefault(); proxy.reportValidity(); }
        } else if (e.key === 'Tab' && open) {
          closeCurrent({ restoreFocus: false });
        }
      });

      wireValidity(input, proxy, ctl);
      observeNative(input, ctl.sync, ['min', 'max']);
      if (input.form) input.form.addEventListener('reset', function () { setTimeout(ctl.sync, 0); });
      ctl.sync();
    }

    function openCalendar(ctl, opts) {
      var input = ctl.input, proxy = ctl.proxy;
      closeCurrent({ restoreFocus: false });
      var pop = doc.createElement('div');
      pop.className = 'wo-pop wo-pop--date wo-cal';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-modal', 'false');
      pop.setAttribute('aria-label', 'Elegí una fecha');
      var view = 'days';
      var min = '', max = '';
      var today = todayISO();
      var selected = '';
      var focusIso = '';
      var yearPageStart = 0;

      function readRange() {
        min = parseISO(input.min) ? input.min : '';
        max = parseISO(input.max) ? input.max : '';
        selected = parseISO(INPUT_VALUE.get.call(input)) ? INPUT_VALUE.get.call(input) : '';
      }
      readRange();
      focusIso = selected || clampISO(today, min, max);
      var cursor = parseISO(focusIso); // mes visible

      var head = doc.createElement('div');
      head.className = 'wo-cal__head';
      var prev = navButton('prev', ICON_LEFT);
      var next = navButton('next', ICON_RIGHT);
      var title = doc.createElement('div');
      title.className = 'wo-cal__title';
      var monthBtn = doc.createElement('button');
      monthBtn.type = 'button';
      monthBtn.className = 'wo-cal__pick';
      monthBtn.setAttribute('data-act', 'months');
      var yearBtn = doc.createElement('button');
      yearBtn.type = 'button';
      yearBtn.className = 'wo-cal__pick';
      yearBtn.setAttribute('data-act', 'years');
      title.appendChild(monthBtn);
      title.appendChild(yearBtn);
      head.appendChild(prev);
      head.appendChild(title);
      head.appendChild(next);
      var live = doc.createElement('div');
      live.className = 'wo-ctl-sr';
      live.setAttribute('aria-live', 'polite');
      var body = doc.createElement('div');
      body.className = 'wo-cal__body';
      var foot = doc.createElement('div');
      foot.className = 'wo-cal__foot';
      var todayBtn = doc.createElement('button');
      todayBtn.type = 'button';
      todayBtn.className = 'wo-cal__link';
      todayBtn.setAttribute('data-act', 'today');
      todayBtn.textContent = 'Hoy';
      var clearBtn = doc.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'wo-cal__link';
      clearBtn.setAttribute('data-act', 'clear');
      clearBtn.textContent = 'Borrar';
      foot.appendChild(clearBtn);
      foot.appendChild(todayBtn);
      pop.appendChild(head);
      pop.appendChild(live);
      pop.appendChild(body);
      pop.appendChild(foot);

      function navButton(act, icon) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'wo-cal__nav';
        b.setAttribute('data-act', act);
        b.innerHTML = icon;
        return b;
      }

      function render(focus) {
        readRange();
        body.textContent = '';
        monthBtn.innerHTML = '';
        monthBtn.appendChild(doc.createTextNode(MONTHS[cursor.m - 1].charAt(0).toUpperCase() + MONTHS[cursor.m - 1].slice(1)));
        yearBtn.textContent = String(cursor.y);
        monthBtn.insertAdjacentHTML('beforeend', ICON_DOWN);
        yearBtn.insertAdjacentHTML('beforeend', ICON_DOWN);
        monthBtn.setAttribute('aria-label', 'Elegir mes, ahora ' + MONTHS[cursor.m - 1]);
        yearBtn.setAttribute('aria-label', 'Elegir año, ahora ' + cursor.y);
        monthBtn.setAttribute('aria-pressed', view === 'months' ? 'true' : 'false');
        yearBtn.setAttribute('aria-pressed', view === 'years' ? 'true' : 'false');
        pop.setAttribute('data-view', view);
        todayBtn.disabled = !isInRange(today, min, max);
        clearBtn.hidden = !selected;
        if (view === 'days') renderDays(focus);
        else if (view === 'months') renderMonths(focus);
        else renderYears(focus);
      }

      function renderDays(focus) {
        var py = cursor.m === 1 ? cursor.y - 1 : cursor.y, pm = cursor.m === 1 ? 12 : cursor.m - 1;
        var ny = cursor.m === 12 ? cursor.y + 1 : cursor.y, nm = cursor.m === 12 ? 1 : cursor.m + 1;
        prev.disabled = !monthInRange(py, pm, min, max);
        next.disabled = !monthInRange(ny, nm, min, max);
        prev.setAttribute('aria-label', 'Mes anterior');
        next.setAttribute('aria-label', 'Mes siguiente');
        var table = doc.createElement('table');
        table.className = 'wo-cal__grid';
        table.setAttribute('role', 'grid');
        table.setAttribute('aria-label', MONTHS[cursor.m - 1] + ' de ' + cursor.y);
        var thead = doc.createElement('thead');
        var hr = doc.createElement('tr');
        WEEKDAYS_SHORT.forEach(function (w, i) {
          var th = doc.createElement('th');
          th.scope = 'col';
          th.setAttribute('abbr', WEEKDAYS[i]);
          th.textContent = w;
          hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = doc.createElement('tbody');
        var inView = parseISO(focusIso) && parseISO(focusIso).m === cursor.m && parseISO(focusIso).y === cursor.y;
        if (!inView) focusIso = clampISO(toISO(cursor.y, cursor.m, Math.min(parseISO(focusIso) ? parseISO(focusIso).d : 1, daysInMonthLocal(cursor.y, cursor.m))), min, max);
        calendarMatrix(cursor.y, cursor.m).forEach(function (week) {
          var tr = doc.createElement('tr');
          week.forEach(function (day) {
            var td = doc.createElement('td');
            td.setAttribute('role', 'gridcell');
            var b = doc.createElement('button');
            b.type = 'button';
            b.className = 'wo-cal__day';
            b.textContent = String(day.d);
            b.setAttribute('data-iso', day.iso);
            b.setAttribute('aria-label', formatLongDate(day.iso));
            b.tabIndex = day.iso === focusIso ? 0 : -1;
            if (!day.inMonth) b.classList.add('is-outside');
            if (day.iso === today) { b.classList.add('is-today'); b.setAttribute('aria-current', 'date'); }
            if (day.iso === selected) { b.classList.add('is-selected'); td.setAttribute('aria-selected', 'true'); }
            if (!isInRange(day.iso, min, max)) { b.setAttribute('aria-disabled', 'true'); b.classList.add('is-disabled'); }
            td.appendChild(b);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        body.appendChild(table);
        if (focus) {
          var f = body.querySelector('[data-iso="' + focusIso + '"]');
          if (f) f.focus({ preventScroll: true });
        }
      }

      function daysInMonthLocal(y, m) { return new Date(y, m, 0).getDate(); }

      function renderMonths(focus) {
        prev.disabled = !yearInRange(cursor.y - 1, min, max);
        next.disabled = !yearInRange(cursor.y + 1, min, max);
        prev.setAttribute('aria-label', 'Año anterior');
        next.setAttribute('aria-label', 'Año siguiente');
        var grid = doc.createElement('div');
        grid.className = 'wo-cal__months';
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', 'Meses de ' + cursor.y);
        MONTHS_SHORT.forEach(function (name, i) {
          var b = doc.createElement('button');
          b.type = 'button';
          b.className = 'wo-cal__cell';
          b.textContent = name;
          b.setAttribute('data-month', String(i + 1));
          b.setAttribute('aria-label', MONTHS[i] + ' de ' + cursor.y);
          b.tabIndex = i + 1 === cursor.m ? 0 : -1;
          if (!monthInRange(cursor.y, i + 1, min, max)) b.disabled = true;
          var sp = parseISO(selected);
          if (sp && sp.y === cursor.y && sp.m === i + 1) { b.classList.add('is-selected'); b.setAttribute('aria-pressed', 'true'); }
          grid.appendChild(b);
        });
        body.appendChild(grid);
        if (focus) { var f = grid.querySelector('[tabindex="0"]:not(:disabled)') || grid.querySelector('button:not(:disabled)'); if (f) f.focus({ preventScroll: true }); }
      }

      function yearBounds() {
        var lo = parseISO(min) ? parseISO(min).y : 1900;
        var hi = parseISO(max) ? parseISO(max).y : Math.max(2100, cursor.y);
        return { lo: Math.min(lo, cursor.y), hi: Math.max(hi, cursor.y) };
      }

      function renderYears(focus) {
        var bounds = yearBounds();
        if (!yearPageStart || cursor.y < yearPageStart || cursor.y >= yearPageStart + 20) {
          // El año actual queda centrado, sin pasar los límites (fechas de nacimiento: el
          // máximo queda al final de la grilla y se ven los 19 años anteriores).
          yearPageStart = Math.max(bounds.lo, Math.min(cursor.y - 10, bounds.hi - 19));
        }
        prev.disabled = yearPageStart <= bounds.lo;
        next.disabled = yearPageStart + 20 > bounds.hi;
        prev.setAttribute('aria-label', 'Años anteriores');
        next.setAttribute('aria-label', 'Años siguientes');
        var grid = doc.createElement('div');
        grid.className = 'wo-cal__years';
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', 'Años ' + yearPageStart + ' a ' + (yearPageStart + 19));
        for (var y = yearPageStart; y < yearPageStart + 20; y++) {
          var b = doc.createElement('button');
          b.type = 'button';
          b.className = 'wo-cal__cell';
          b.textContent = String(y);
          b.setAttribute('data-year', String(y));
          b.tabIndex = y === cursor.y ? 0 : -1;
          if (y < bounds.lo || y > bounds.hi || !yearInRange(y, min, max)) b.disabled = true;
          var sp = parseISO(selected);
          if (sp && sp.y === y) { b.classList.add('is-selected'); b.setAttribute('aria-pressed', 'true'); }
          grid.appendChild(b);
        }
        body.appendChild(grid);
        if (focus) { var f = grid.querySelector('[tabindex="0"]:not(:disabled)') || grid.querySelector('button:not(:disabled)'); if (f) f.focus({ preventScroll: true }); }
      }

      function announce(text) { live.textContent = text; }

      function setCursor(y, m) {
        cursor = { y: y, m: m, d: 1 };
      }

      function choose(iso) {
        if (!isInRange(iso, min, max)) return;
        ctl.setNative(iso, true);
        close({ restoreFocus: true });
      }

      function moveFocus(iso) {
        if (!parseISO(iso)) return;
        var p = parseISO(iso);
        focusIso = iso;
        if (p.y !== cursor.y || p.m !== cursor.m) {
          setCursor(p.y, p.m);
          announce(MONTHS[p.m - 1] + ' de ' + p.y);
        }
        render(true);
      }

      pop.addEventListener('mousedown', function (e) {
        // Mantener el foco donde está (campo o grilla) salvo en botones.
        if (!e.target.closest('button')) e.preventDefault();
      });

      pop.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || b.disabled) return;
        var act = b.getAttribute('data-act');
        if (act === 'prev' || act === 'next') {
          var dir = act === 'prev' ? -1 : 1;
          if (view === 'days') {
            var t = addMonths(toISO(cursor.y, cursor.m, 1), dir);
            setCursor(parseISO(t).y, parseISO(t).m);
            announce(MONTHS[cursor.m - 1] + ' de ' + cursor.y);
          } else if (view === 'months') {
            setCursor(cursor.y + dir, cursor.m);
            announce(String(cursor.y));
          } else {
            yearPageStart += dir * 20;
            cursor.y = Math.min(Math.max(cursor.y + dir * 20, yearBounds().lo), yearBounds().hi);
            if (cursor.y < yearPageStart || cursor.y >= yearPageStart + 20) cursor.y = yearPageStart;
            announce('Años ' + yearPageStart + ' a ' + (yearPageStart + 19));
          }
          render(false);
          return;
        }
        if (act === 'months' || act === 'years') {
          view = view === act ? 'days' : act;
          render(true);
          return;
        }
        if (act === 'today') { choose(today); return; }
        if (act === 'clear') { ctl.setNative('', true); INPUT_VALUE.set.call(proxy, ''); close({ restoreFocus: true }); return; }
        if (b.hasAttribute('data-iso')) {
          if (b.getAttribute('aria-disabled') === 'true') return;
          choose(b.getAttribute('data-iso'));
          return;
        }
        if (b.hasAttribute('data-month')) {
          setCursor(cursor.y, +b.getAttribute('data-month'));
          view = 'days';
          render(true);
          return;
        }
        if (b.hasAttribute('data-year')) {
          setCursor(+b.getAttribute('data-year'), cursor.m);
          view = 'months';
          render(true);
        }
      });

      pop.addEventListener('keydown', function (e) {
        var t = e.target;
        if (e.key !== 'Tab') e.stopPropagation();
        if (e.key === 'Tab') {
          // Salir del calendario con Tab vuelve al campo (y el Tab sigue su curso).
          var focusables = Array.prototype.filter.call(pop.querySelectorAll('button'), function (b) {
            return !b.disabled && !b.hidden && b.tabIndex !== -1;
          });
          var first = focusables[0], last = focusables[focusables.length - 1];
          if ((!e.shiftKey && t === last) || (e.shiftKey && t === first)) {
            if (e.shiftKey) e.preventDefault();
            close({ restoreFocus: true });
          }
          return;
        }
        if (t.hasAttribute && t.hasAttribute('data-iso')) {
          var iso = t.getAttribute('data-iso');
          var map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (map[e.key] !== undefined) { e.preventDefault(); moveFocus(addDays(iso, map[e.key])); return; }
          var wd = (new Date(Date.UTC(parseISO(iso).y, parseISO(iso).m - 1, parseISO(iso).d)).getUTCDay() + 6) % 7;
          if (e.key === 'Home') { e.preventDefault(); moveFocus(addDays(iso, -wd)); return; }
          if (e.key === 'End') { e.preventDefault(); moveFocus(addDays(iso, 6 - wd)); return; }
          if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            moveFocus(addMonths(iso, (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1)));
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (t.getAttribute('aria-disabled') !== 'true') choose(iso); }
          return;
        }
        var cells = t.classList && t.classList.contains('wo-cal__cell') ? Array.prototype.slice.call(body.querySelectorAll('.wo-cal__cell')) : null;
        if (cells) {
          var cols = view === 'months' ? 3 : 4;
          var delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
          if (delta !== undefined) {
            e.preventDefault();
            var i = cells.indexOf(t) + delta;
            while (i >= 0 && i < cells.length && cells[i].disabled) i += delta > 0 ? 1 : -1;
            if (cells[i]) { cells.forEach(function (c) { c.tabIndex = -1; }); cells[i].tabIndex = 0; cells[i].focus(); }
          }
        }
      });

      function reposition() {
        placePopover(pop, proxy, { width: Math.min(328, viewportBox().width - 16), maxHeight: 480 });
      }

      function close(o) {
        if (current !== state) return;
        current = null;
        proxy.setAttribute('aria-expanded', 'false');
        proxy.classList.remove('is-open');
        if (pop.parentNode) pop.parentNode.removeChild(pop);
        if (o && o.restoreFocus) { try { proxy.focus({ preventScroll: true }); } catch (err) { proxy.focus(); } }
      }

      var state = {
        anchor: proxy,
        source: input,
        pop: pop,
        close: close,
        reposition: reposition,
        rebuild: function () { readRange(); render(false); },
        goTo: function (iso) { var p = parseISO(iso); if (!p) return; focusIso = iso; setCursor(p.y, p.m); view = 'days'; render(false); },
        focusGrid: function () { view = 'days'; render(true); }
      };
      current = state;
      mountPopover(pop, proxy);
      proxy.setAttribute('aria-expanded', 'true');
      proxy.classList.add('is-open');
      render(!!(opts && opts.focusGrid));
      reposition();
    }

    /* ---------- Prefijo fijo ---------- */

    function enhancePrefixed(wrap) {
      var input = wrap.querySelector('input');
      if (!input || proxies.has(input) || isOptedOut(wrap)) return;
      var prefix = wrap.getAttribute('data-prefix') || '';
      if (!prefix) return;
      var inValue = wrap.hasAttribute('data-prefix-in-value');
      var span = doc.createElement('span');
      span.className = 'wo-prefix';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = prefix;
      wrap.insertBefore(span, wrap.firstChild);
      wrap.classList.add('wo-prefixed--ready');
      var baseInline = input.style.paddingLeft;
      var raw = function () { return INPUT_VALUE.get.call(input); };

      function layout() {
        input.style.paddingLeft = baseInline;
        var cs = win.getComputedStyle(input);
        span.style.font = cs.font;
        span.style.letterSpacing = cs.letterSpacing;
        span.style.setProperty('--wo-prefix-fg', cs.color);
        var padL = parseFloat(cs.paddingLeft) || 0;
        var borderL = parseFloat(cs.borderLeftWidth) || 0;
        span.style.left = (input.offsetLeft + borderL + padL) + 'px';
        span.style.top = input.offsetTop + 'px';
        span.style.height = input.offsetHeight + 'px';
        var w = span.getBoundingClientRect().width;
        input.style.paddingLeft = (padL + w) + 'px';
      }

      function syncFilled() { wrap.classList.toggle('is-filled', raw().length > 0); }

      function normalize() {
        var v = raw();
        var n = normalizePrefixedValue(v, prefix);
        if (n !== v) {
          var end = input.selectionEnd;
          INPUT_VALUE.set.call(input, n);
          try { var pos = Math.max(0, Math.min(n.length, (end == null ? n.length : end) - (v.length - n.length))); input.setSelectionRange(pos, pos); } catch (err) { /* type sin selección */ }
        }
        syncFilled();
      }

      try {
        Object.defineProperty(input, 'value', {
          configurable: true,
          get: function () { var v = INPUT_VALUE.get.call(this); return inValue && v ? prefix + v : v; },
          set: function (v) { INPUT_VALUE.set.call(this, normalizePrefixedValue(v, prefix)); syncFilled(); }
        });
      } catch (err) { /* sin parche */ }
      if (inValue && input.form && input.name) {
        input.form.addEventListener('formdata', function (e) {
          var v = raw();
          e.formData.set(input.name, v ? prefix + v : '');
        });
      }
      input.addEventListener('input', normalize);
      input.addEventListener('change', normalize);
      input.addEventListener('focus', function () { requestAnimationFrame(layout); });
      input.addEventListener('blur', function () { requestAnimationFrame(layout); });
      proxies.set(input, { sync: function () { layout(); syncFilled(); } });
      INPUT_VALUE.set.call(input, normalizePrefixedValue(raw(), prefix));
      layout();
      syncFilled();
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(layout);
      if (typeof ResizeObserver === 'function') new ResizeObserver(function () { layout(); }).observe(input, { box: 'border-box' });
    }

    /* ---------- Enhance / refresh / observer ---------- */

    function enhance(root) {
      root = root || doc;
      if (root.nodeType !== 1 && root.nodeType !== 9) return;
      var list = [];
      if (root.nodeType === 1 && root.matches('select, input[type="date"], .wo-prefixed[data-prefix]')) list.push(root);
      Array.prototype.push.apply(list, root.querySelectorAll('select, input[type="date"], .wo-prefixed[data-prefix]'));
      list.forEach(function (el) {
        try {
          if (el.tagName === 'SELECT') { if (!isOptedOut(el)) enhanceSelect(el); }
          else if (el.tagName === 'INPUT') enhanceDate(el);
          else enhancePrefixed(el);
        } catch (err) {
          if (win.console) win.console.warn('[WoControls] no se pudo mejorar el control', el, err);
        }
      });
    }

    function refresh(el) {
      if (!el) { enhance(doc); return; }
      if (el.tagName === 'SELECT') { syncEmptyState(el); refreshIfOpen(el); }
      var ctl = proxies.get(el) || (el.querySelector && el.querySelector('input') && proxies.get(el.querySelector('input')));
      if (ctl && ctl.sync) ctl.sync();
      else enhance(el);
    }

    var pending = new Set();
    var scheduled = false;
    function schedule(node) {
      pending.add(node);
      if (scheduled) return;
      scheduled = true;
      Promise.resolve().then(function () {
        scheduled = false;
        var nodes = Array.from(pending);
        pending.clear();
        nodes.forEach(function (n) {
          if (!n.isConnected) return;
          if (n.tagName === 'SELECT') refresh(n);
          else enhance(n);
        });
      });
    }

    function start() {
      enhance(doc);
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          var target = m.target;
          // Opciones agregadas/quitadas en un select existente.
          var sel = target.nodeType === 1 ? (target.tagName === 'SELECT' ? target : target.closest && target.closest('select')) : null;
          if (sel) { schedule(sel); continue; }
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1 && !(current && current.pop.contains(n)) && !n.classList.contains('wo-pop')) schedule(n);
          }
        }
      }).observe(doc.documentElement, { childList: true, subtree: true });
    }

    win.WoControls = {
      enhance: enhance,
      refresh: refresh,
      close: function () { closeCurrent({ restoreFocus: false }); },
      pure: pure,
      version: '1.0.0'
    };

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
    else start();
    try { doc.dispatchEvent(new CustomEvent('wo-controls:ready')); } catch (err) { /* noop */ }
  }

  return { pure: pure, boot: boot };
});
