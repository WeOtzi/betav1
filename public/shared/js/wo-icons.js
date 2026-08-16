// We Ötzi DS · Íconos Feather 4.29.2 (regla del manual: solo Feather, 2px stroke,
// currentColor). Uso: <i data-wo-icon="search"></i> — este script inserta el SVG
// inline para que herede el color del texto. CDN pineado, igual que el DS fuente.
(function () {
  'use strict';
  var CDN = 'https://unpkg.com/feather-icons@4.29.2/dist/icons/';
  var cache = Object.create(null); // name -> Promise<string>

  function fetchIcon(name) {
    if (!cache[name]) {
      cache[name] = fetch(CDN + encodeURIComponent(name) + '.svg')
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
