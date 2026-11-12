// We Ötzi DS · Íconos Feather 4.29.2 (regla del manual: solo Feather, 2px stroke,
// currentColor). Uso: <i data-wo-icon="search"></i> — este script inserta el SVG
// inline para que herede el color del texto. CDN pineado, igual que el DS fuente.
(function () {
  'use strict';
  var CDN = 'https://unpkg.com/feather-icons@4.29.2/dist/icons/';
  var script = document.currentScript;
  var localBase = script && script.getAttribute('data-icon-base');
  if (localBase) localBase = new URL(localBase, script.src).href;
  var cache = Object.create(null); // name -> Promise<string>

  function fetchIcon(name) {
    if (!cache[name]) {
      cache[name] = fetch((localBase || CDN) + encodeURIComponent(name) + '.svg')
        .then(function (r) { return r.ok ? r.text() : ''; })
        .catch(function () { return ''; });
    }
    return cache[name];
  }

  function hydrate(root) {
    var els = (root || document).querySelectorAll('[data-wo-icon]:not([data-wo-icon-done])');
    els.forEach(function (el) {
      var name = el.getAttribute('data-wo-icon');
      if (!name) return;
      el.setAttribute('data-wo-icon-done', '1');
      fetchIcon(name).then(function (svg) {
        if (!svg) return;
        // el SVG de Feather ya trae stroke="currentColor"
        el.innerHTML = svg;
        var s = el.querySelector('svg');
        if (s) { s.removeAttribute('width'); s.removeAttribute('height'); }
      });
    });
  }

  // Observa el DOM para íconos insertados dinámicamente por los scripts de página.
  function start() {
    hydrate(document);
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) hydrate(n.parentNode || document);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.WoIcons = { hydrate: hydrate };
})();

// ---------------------------------------------------------------------------
// DS · Controles propios (select, fecha, prefijo fijo, editor de texto).
// Carga única en todas las páginas: este bloque vive en config-manager.js y en
// wo-icons.js (entre los dos cubren todas las páginas). Opt-out: [data-native].
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.createElement) return;
    if (window.__woControlsLoader) return;
    var me = document.currentScript;
    var match = me && me.src ? /^(.*\/shared\/)js\/[^\/?#]+(?:[?#].*)?$/.exec(me.src) : null;
    if (!match) return;
    window.__woControlsLoader = true;
    var base = match[1];
    var head = document.head || document.documentElement;
    // Stub: mount() antes de que llegue wo-richtext.js queda en cola y el
    // controlador devuelto se completa al montar de verdad.
    if (!window.WoRichText) {
      var queue = [];
      window.WoRichText = {
        __queue: queue,
        mount: function (textarea, options) {
          var pendingCtl = { pending: true };
          queue.push([textarea, options || {}, pendingCtl]);
          return pendingCtl;
        }
      };
    }
    if (!window.WoControls) {
      window.WoControls = { enhance: function () {}, refresh: function () {}, close: function () {}, pending: true };
    }
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + 'css/wo-controls.css';
    css.setAttribute('data-wo-controls', '');
    head.appendChild(css);
    ['js/wo-controls.js', 'js/wo-richtext.js'].forEach(function (path) {
      var s = document.createElement('script');
      s.src = base + path;
      s.async = false;
      s.setAttribute('data-wo-controls', '');
      head.appendChild(s);
    });
  } catch (err) { /* los controles son mejora progresiva: nunca bloquean la página */ }
})();
