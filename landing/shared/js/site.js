/* site.js — capa corporativa We Ötzi (weotzi.com).
   Drawer con focus trap, header .snav, promo con detección de video, facade de
   YouTube, selector de público de la beta y sync ARIA del FAQ.
   Vanilla, sin dependencias duras (GSAP NO es requerido aquí).
   NO duplica lo que ya hace motion.js: reveals (.r-up/.r-fade), toggle del FAQ
   (.faq__q → .is-open), preloader ni parallax. Aquí solo sincronizamos ARIA. */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ---------- Focus trap reutilizable (drawer + modal) ---------- */
  function trapFocus(container, ev) {
    if (ev.key !== "Tab") return;
    var items = $$(FOCUSABLE, container).filter(function (el) {
      return el.getClientRects().length > 0;
    });
    if (!items.length) { ev.preventDefault(); return; }
    var first = items[0], last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    else if (!container.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
  }

  /* ---------- Header .snav: estado is-scrolled (rAF-throttled) ---------- */
  function snav() {
    var n = $(".snav"); if (!n) return;
    var ticking = false;
    function update() {
      n.classList.toggle("is-scrolled", (window.scrollY || window.pageYOffset || 0) > 24);
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ---------- Drawer ---------- */
  function drawer() {
    var d = $(".drawer"); if (!d) return;
    var panel = $(".drawer__panel", d);
    var openers = $$("[data-drawer-open]");
    var lastFocus = null;

    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
      trapFocus(d, ev);
    }
    function open() {
      lastFocus = document.activeElement;
      d.classList.add("is-open");
      d.setAttribute("aria-hidden", "false");
      document.body.classList.add("drawer-open");
      openers.forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
      document.addEventListener("keydown", onKey);
      var first = $$(FOCUSABLE, panel)[0];
      if (first) first.focus();
    }
    function close() {
      if (!d.classList.contains("is-open")) return;
      d.classList.remove("is-open");
      document.body.classList.remove("drawer-open");
      openers.forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
      document.removeEventListener("keydown", onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      d.setAttribute("aria-hidden", "true");
    }
    openers.forEach(function (b) { b.addEventListener("click", open); });
    $$("[data-drawer-close]", d).forEach(function (b) { b.addEventListener("click", close); });
    // Un link del drawer hacia un ancla de la misma página debe cerrar el panel.
    $$("a[href]", d).forEach(function (a) { a.addEventListener("click", function () { close(); }); });
  }

  /* ---------- Modal de video (se construye una sola vez, bajo demanda) ---------- */
  var vmodal = null, vReturnFocus = null;

  function buildModal() {
    if (vmodal) return vmodal;
    var m = document.createElement("div");
    m.className = "vmodal";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    m.setAttribute("aria-label", "Video promocional de We Ötzi");
    m.innerHTML =
      '<div class="vmodal__scrim" data-vmodal-close></div>' +
      '<div class="vmodal__box">' +
        '<button type="button" class="vmodal__close" aria-label="Cerrar video" data-vmodal-close>' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
        '</button>' +
        '<video controls playsinline preload="auto"></video>' +
      '</div>';
    document.body.appendChild(m);
    $$("[data-vmodal-close]", m).forEach(function (b) { b.addEventListener("click", closeVideo); });
    vmodal = m;
    return m;
  }
  function onVKey(ev) {
    if (ev.key === "Escape") { ev.preventDefault(); closeVideo(); return; }
    trapFocus(vmodal, ev);
  }
  function openVideo(src, trigger) {
    var m = buildModal();
    var video = $("video", m);
    vReturnFocus = trigger || document.activeElement;
    if (video.getAttribute("src") !== src) video.setAttribute("src", src);
    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onVKey);
    var p = video.play(); if (p && p.catch) p.catch(function () {});
    var closeBtn = $(".vmodal__close", m);
    if (closeBtn) closeBtn.focus();
  }
  function closeVideo() {
    if (!vmodal || !vmodal.classList.contains("is-open")) return;
    var video = $("video", vmodal);
    if (video) video.pause();
    vmodal.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", onVKey);
    if (vReturnFocus && vReturnFocus.focus) vReturnFocus.focus();
    vmodal.setAttribute("aria-hidden", "true");
  }

  /* ---------- PROMO: habilita el play solo si el mp4 existe ---------- */
  function promo() {
    var root = $(".promo"); if (!root) return;
    var play = $(".promo__play", root); if (!play) return;
    var src = root.getAttribute("data-video-src");
    if (!src) {
      var carrier = $("[data-video-src]", root);
      src = carrier ? carrier.getAttribute("data-video-src") : null;
    }
    function soon() {
      root.classList.add("is-soon");
      play.setAttribute("aria-disabled", "true");
      play.disabled = true; // fuera del tab order: es un botón sin acción (CSS además lo oculta)
    }
    if (!src) { soon(); return; }
    fetch(src, { method: "HEAD" }).then(function (r) {
      if (!r.ok) { soon(); return; }
      root.classList.add("is-live");
      play.removeAttribute("aria-disabled");
      play.addEventListener("click", function () { openVideo(src, play); });
    }).catch(soon);
  }

  /* ---------- Facade de YouTube (.yt[data-yt-id]) ---------- */
  function yt() {
    $$(".yt").forEach(function (el) {
      var id = (el.getAttribute("data-yt-id") || "").trim();
      var play = $(".yt__play", el);
      if (!id) {
        el.classList.add("is-soon");
        if (play) play.setAttribute("aria-disabled", "true");
        return;
      }
      el.classList.add("is-live");
      if (!play) return;
      play.addEventListener("click", function () {
        if (el.querySelector("iframe")) return;
        var iframe = document.createElement("iframe");
        iframe.className = "yt__iframe";
        iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
        iframe.title = el.getAttribute("data-yt-title") || "Video de We Ötzi en YouTube";
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.setAttribute("allowfullscreen", "");
        el.appendChild(iframe);
        el.classList.add("is-playing");
      });
    });
  }

  /* ---------- Beta picker (radiogroup + ?p= + hints por chip) ---------- */
  function betaPicker() {
    var picker = $(".beta-picker"); if (!picker) return;
    var chips = $$('[role="radio"]', picker);
    if (!chips.length) return;
    var waitlistRoot = $(".waitlist");
    var hint = waitlistRoot ? $(".waitlist__hint", waitlistRoot) : null;

    function select(chip, moveFocus) {
      chips.forEach(function (c) {
        var on = c === chip;
        c.setAttribute("aria-checked", on ? "true" : "false");
        c.tabIndex = on ? 0 : -1;
      });
      document.body.setAttribute("data-user-type", chip.getAttribute("data-user-type") || "artist");
      if (hint && chip.hasAttribute("data-hint")) {
        hint.textContent = chip.getAttribute("data-hint");
        hint.className = "waitlist__hint";
      }
      if (moveFocus) chip.focus();
    }

    chips.forEach(function (chip, i) {
      chip.addEventListener("click", function () { select(chip, false); });
      chip.addEventListener("keydown", function (ev) {
        var dir = 0;
        if (ev.key === "ArrowRight" || ev.key === "ArrowDown") dir = 1;
        else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") dir = -1;
        else if (ev.key === " " || ev.key === "Enter") { ev.preventDefault(); select(chip, false); return; }
        else return;
        ev.preventDefault();
        select(chips[(i + dir + chips.length) % chips.length], true);
      });
    });

    var TYPE_MAP = { client: "client", cliente: "client", studio: "studio", estudio: "studio", artist: "artist", tatuador: "artist" };

    // Preselección vía ?p=client|studio|artist
    var pre = null;
    try {
      var p = new URLSearchParams(window.location.search).get("p");
      if (p) pre = TYPE_MAP[p.toLowerCase()] || null;
    } catch (e) {}
    var initial = null;
    if (pre) {
      initial = chips.filter(function (c) { return c.getAttribute("data-user-type") === pre; })[0] || null;
    }
    if (!initial) {
      initial = chips.filter(function (c) { return c.getAttribute("aria-checked") === "true"; })[0] || chips[0];
    }
    select(initial, false);

    // Si viene #beta en la URL, scroll suave al formulario (tras el layout inicial)
    if (window.location.hash === "#beta") {
      var target = document.getElementById("beta");
      if (target) {
        setTimeout(function () {
          target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        }, 80);
      }
    }

    // En la home, los links a la propia home (/?p=...#beta) no recargan el
    // documento: seleccionan el chip, actualizan la URL y hacen scroll a #beta.
    $$('a[href^="/?p="]').forEach(function (a) {
      a.addEventListener("click", function (ev) {
        var url;
        try { url = new URL(a.getAttribute("href"), window.location.origin); } catch (e) { return; }
        var type = TYPE_MAP[(url.searchParams.get("p") || "").toLowerCase()];
        if (!type) return;
        ev.preventDefault();
        var chip = chips.filter(function (c) { return c.getAttribute("data-user-type") === type; })[0];
        if (chip && !chip.disabled) select(chip, false);
        try { history.replaceState(null, "", url.pathname + url.search + url.hash); } catch (e) {}
        var target = document.getElementById("beta");
        if (target) target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      });
    });

    // Cuando el lead ya se guardó, el picker se apaga elegantemente
    // (is-done solo bloquea el mouse: los chips se deshabilitan también para teclado)
    document.addEventListener("waitlist:joined", function () {
      picker.classList.add("is-done");
      chips.forEach(function (c) { c.disabled = true; });
    });
  }

  /* ---------- FAQ: motion.js maneja el toggle; aquí solo ARIA ---------- */
  function faqAria() {
    $$(".faq__item").forEach(function (item, i) {
      var q = $(".faq__q", item), a = $(".faq__a", item);
      if (!q || !a) return;
      if (!a.id) a.id = "faq-panel-" + (i + 1);
      q.setAttribute("aria-controls", a.id);
      function sync() {
        var open = item.classList.contains("is-open");
        q.setAttribute("aria-expanded", open ? "true" : "false");
        // Panel cerrado (height:0 + overflow:hidden): sus links no deben recibir
        // foco de teclado ni quedar en el árbol de accesibilidad (WCAG 2.4.7).
        a.inert = !open;
      }
      sync();
      if (window.MutationObserver) {
        new MutationObserver(sync).observe(item, { attributes: true, attributeFilter: ["class"] });
      } else {
        q.addEventListener("click", function () { setTimeout(sync, 0); });
      }
    });
  }

  /* ---------- Boot ---------- */
  function init() { snav(); drawer(); promo(); yt(); betaPicker(); faqAria(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
