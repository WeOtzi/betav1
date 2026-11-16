/* ============================================================================
   WE ÖTZI — Indicador de "hay más abajo" (ronda 2 · P2)
   Cuando una pantalla no entra entera y la persona todavía está arriba, muestra
   un botón fijo con una flecha animada. Un toque baja casi una pantalla. Se va
   en cuanto se desplaza y vuelve si regresa arriba.

   - Sirve para el documento y para las pantallas con panel propio de scroll
     (se elige el contenedor que realmente se desplaza bajo el centro de la vista).
   - Se corre solo hacia arriba si abajo hay una barra fija (pie del cotizador).
   - No aparece con un diálogo abierto ni con el scroll bloqueado.
   - Respeta "reducir movimiento": la flecha queda quieta.
   - Opt-out por página: <html data-wo-scroll-hint="off">.
   Lo cargan config-manager.js y wo-icons.js (entre los dos cubren todas las
   páginas). Es mejora progresiva: si falla, la página sigue igual.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    if (root.WoScrollHint && root.WoScrollHint.__real) return;
    root.WoScrollHint = api;
    try { api.start(root); } catch (err) { /* mejora progresiva */ }
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var MIN_OVERFLOW = 56;   // px de contenido oculto (sin contar el pie del sitio) a partir de los cuales vale avisar
  var TOP_ZONE = 24;       // px desde arriba en los que todavía cuenta como "sin desplazar"
  var MIN_SCROLLER = 0.5;  // un panel interno cuenta si ocupa al menos media pantalla
  var GAP = 16;            // separación con el borde inferior o con la barra fija
  var MODAL_SELECTOR = 'dialog[open], [aria-modal="true"]:not([hidden]), .wo-overlay:not([hidden]), .wo-fav-scrim';

  /** ¿Hay que mostrar el indicador con estas medidas? */
  function shouldShow(m) {
    if (!m) return false;
    var hidden = (m.scrollHeight || 0) - (m.clientHeight || 0);
    var top = Math.max(0, m.scrollTop || 0);
    return hidden >= MIN_OVERFLOW && top <= TOP_ZONE && hidden - top >= MIN_OVERFLOW;
  }

  function styleOf(win, el) {
    try { return win.getComputedStyle(el); } catch (err) { return null; }
  }

  function scrollsY(win, el) {
    var cs = styleOf(win, el);
    if (!cs) return false;
    var oy = cs.overflowY;
    return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight - el.clientHeight >= MIN_OVERFLOW;
  }

  /** El contenedor que de verdad se desplaza bajo el centro de la vista (o el documento). */
  function pickScroller(win) {
    var doc = win.document;
    var page = doc.scrollingElement || doc.documentElement;
    var vh = win.innerHeight || (page && page.clientHeight) || 0;
    var el = null;
    try { el = doc.elementFromPoint(Math.round((win.innerWidth || 0) / 2), Math.round(vh / 2)); } catch (err) { el = null; }
    while (el && el !== doc.body && el !== doc.documentElement) {
      if (el.nodeType === 1 && el.clientHeight >= vh * MIN_SCROLLER && scrollsY(win, el)) return el;
      el = el.parentElement;
    }
    return page;
  }

  /** Alto del pie del sitio cuando es lo último del documento: bajar solo para verlo no amerita aviso. */
  function trailingFooterHeight(win) {
    var doc = win.document;
    var page = doc.scrollingElement || doc.documentElement;
    var total = Math.max(page.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
    var y = win.pageYOffset != null ? win.pageYOffset : page.scrollTop;
    var vw = win.innerWidth || 0;
    var vh = win.innerHeight || 0;
    var best = 0;
    var list;
    try { list = doc.querySelectorAll('footer, [role="contentinfo"]'); } catch (err) { return 0; }
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (!r.height || r.width < vw * 0.5 || r.height > vh * 0.6) continue;
      if (total - (r.bottom + y) <= 8) best = Math.max(best, Math.round(total - (r.top + y)));
    }
    return best;
  }

  function metrics(win, scroller) {
    var doc = win.document;
    var page = doc.scrollingElement || doc.documentElement;
    if (!scroller || scroller === page || scroller === doc.body || scroller === doc.documentElement) {
      return {
        scrollTop: win.pageYOffset != null ? win.pageYOffset : page.scrollTop,
        scrollHeight: Math.max(page.scrollHeight, doc.body ? doc.body.scrollHeight : 0) - trailingFooterHeight(win),
        clientHeight: win.innerHeight || page.clientHeight
      };
    }
    return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
  }

  /** ¿La página tiene el scroll bloqueado o un diálogo encima? */
  function blocked(win) {
    var doc = win.document;
    var root = doc.documentElement;
    if (root && root.getAttribute && root.getAttribute('data-wo-scroll-hint') === 'off') return true;
    // Muchas pantallas dejan sus diálogos en el DOM y los ocultan con una clase: solo cuenta el que está pintado.
    try {
      var open = doc.querySelectorAll(MODAL_SELECTOR);
      for (var i = 0; i < open.length; i++) { if (open[i].getClientRects && open[i].getClientRects().length) return true; }
    } catch (err) { /* selector no soportado */ }
    var body = doc.body;
    var bs = body ? styleOf(win, body) : null;
    var rs = root ? styleOf(win, root) : null;
    var page = doc.scrollingElement || root;
    var pageOverflows = page && page.scrollHeight - (win.innerHeight || page.clientHeight) > 0;
    // Scroll del documento bloqueado (un diálogo o un menú lo fijó) cuando el documento sí desborda.
    if (pageOverflows && ((bs && bs.overflowY === 'hidden') || (rs && rs.overflowY === 'hidden'))) return true;
    return false;
  }

  /** Alto de la barra fija o pegajosa que tapa el borde inferior, si la hay. */
  function bottomBarHeight(win, own) {
    var doc = win.document;
    var vw = win.innerWidth || 0;
    var vh = win.innerHeight || 0;
    var el = null;
    try {
      var stack = doc.elementsFromPoint ? doc.elementsFromPoint(Math.round(vw / 2), vh - 4) : [doc.elementFromPoint(Math.round(vw / 2), vh - 4)];
      for (var i = 0; i < stack.length; i++) { if (stack[i] && stack[i] !== own && !(own && own.contains(stack[i]))) { el = stack[i]; break; } }
    } catch (err) { el = null; }
    while (el && el !== doc.body && el !== doc.documentElement) {
      var cs = styleOf(win, el);
      if (cs && (cs.position === 'fixed' || cs.position === 'sticky')) {
        var r = el.getBoundingClientRect();
        // Solo barras: anchas, pegadas abajo y de menos de un tercio de la pantalla.
        if (r.bottom >= vh - 2 && r.height > 0 && r.height <= vh / 3 && r.width >= vw * 0.5) return Math.round(vh - r.top);
        return 0;
      }
      el = el.parentElement;
    }
    return 0;
  }

  var ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M5 9l7 7 7-7"/></svg>';

  function start(win) {
    var doc = win && win.document;
    if (!doc || !doc.createElement || win.__woScrollHintStarted) return null;
    if (win.top !== win.self) { try { if (win.frameElement) return null; } catch (err) { return null; } }
    win.__woScrollHintStarted = true;

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'wo-scroll-hint';
    btn.setAttribute('aria-label', 'Ver lo que sigue abajo');
    btn.setAttribute('title', 'Hay más abajo');
    btn.hidden = true;
    btn.innerHTML = '<span class="wo-scroll-hint-arrow">' + ICON + '</span>';

    var scroller = null;
    var frame = 0;
    var timer = 0;
    var reduced = false;
    try { reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (err) { reduced = false; }

    function update() {
      frame = 0;
      if (!btn.isConnected && doc.body) doc.body.appendChild(btn);
      if (blocked(win)) { btn.hidden = true; return; }
      scroller = pickScroller(win);
      var show = shouldShow(metrics(win, scroller));
      if (show) {
        var bar = bottomBarHeight(win, btn);
        btn.style.setProperty('--wo-scroll-hint-bottom', (bar + GAP) + 'px');
      }
      btn.hidden = !show;
    }
    function schedule() {
      if (frame) return;
      frame = (win.requestAnimationFrame || win.setTimeout)(update, 16);
    }
    function settle() {
      win.clearTimeout(timer);
      timer = win.setTimeout(schedule, 160);
    }

    btn.addEventListener('click', function () {
      var target = scroller || pickScroller(win);
      var page = doc.scrollingElement || doc.documentElement;
      var step = Math.round(metrics(win, target).clientHeight * 0.8);
      var opts = { top: step, behavior: reduced ? 'auto' : 'smooth' };
      try {
        if (target === page || target === doc.body || target === doc.documentElement) win.scrollBy(opts);
        else target.scrollBy(opts);
      } catch (err) {
        if (target === page) win.scrollBy(0, step); else target.scrollTop += step;
      }
    });

    // El scroll no burbujea: se escucha en captura para enterarse también de los paneles internos.
    doc.addEventListener('scroll', schedule, { capture: true, passive: true });
    win.addEventListener('resize', schedule, { passive: true });
    win.addEventListener('load', schedule);
    win.addEventListener('pageshow', schedule);
    if (typeof win.MutationObserver === 'function') {
      var mo = new win.MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) { if (list[i].target !== btn && !btn.contains(list[i].target)) { settle(); return; } }
      });
      var observe = function () {
        mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'style', 'aria-hidden'] });
      };
      observe();
    }
    if (typeof win.ResizeObserver === 'function' && doc.body) {
      try { new win.ResizeObserver(settle).observe(doc.body); } catch (err) { /* sin observador de tamaño */ }
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedule);
    else schedule();
    return { update: update, element: btn };
  }

  return {
    __real: true,
    MIN_OVERFLOW: MIN_OVERFLOW,
    TOP_ZONE: TOP_ZONE,
    shouldShow: shouldShow,
    pickScroller: pickScroller,
    metrics: metrics,
    trailingFooterHeight: trailingFooterHeight,
    blocked: blocked,
    bottomBarHeight: bottomBarHeight,
    start: start
  };
});
