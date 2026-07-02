/* motion.js — preloader, intro, cursor, magnetismo, parallax, kinetic type,
   thaw-reveal por scroll, contadores y acordeon. Requiere GSAP + ScrollTrigger (CDN).
   Degrada con gracia: sin GSAP o con reduced-motion, el contenido queda visible. */
(function () {
  "use strict";
  document.documentElement.classList.remove("no-js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGSAP = !!(window.gsap);
  if (hasGSAP && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  /* ---------- Preloader ---------- */
  function runPreloader(done) {
    var pre = document.querySelector(".preloader");
    if (!pre) { done(); return; }
    var bar = pre.querySelector(".preloader__bar i");
    var pct = pre.querySelector(".preloader__pct");
    document.body.classList.add("is-locked");

    if (!hasGSAP || reduce) {
      pre.style.display = "none"; document.body.classList.remove("is-locked"); done(); return;
    }
    var tl = gsap.timeline({ onComplete: function () { document.body.classList.remove("is-locked"); done(); } });
    var prog = { v: 0 };
    tl.to(prog, { v: 100, duration: 1.1, ease: "power2.inOut", onUpdate: function () {
      var n = Math.round(prog.v);
      if (bar) bar.style.width = n + "%";
      if (pct) pct.textContent = String(n).padStart(3, "0");
    }});
    tl.to(".preloader__inner", { y: -16, opacity: 0, duration: 0.5, ease: "power2.in" }, "+=0.1");
    tl.to(".preloader", { yPercent: -100, duration: 0.9, ease: "expo.inOut" }, "-=0.1");
    tl.set(".preloader", { display: "none" });
  }

  /* ---------- Intro del hero ---------- */
  function heroIntro() {
    if (!hasGSAP || reduce) return;
    var lines = document.querySelectorAll(".hero__title .line > span");
    var tl = gsap.timeline({ defaults: { ease: "expo.out" } });
    if (lines.length) tl.from(lines, { yPercent: 115, duration: 1.1, stagger: 0.08 });
    tl.from(".hero__sub", { y: 20, opacity: 0, duration: 0.8 }, "-=0.6");
    tl.from(".hero__cta", { y: 20, opacity: 0, duration: 0.8 }, "-=0.6");
    tl.from(".hero__meta > *", { y: 14, opacity: 0, duration: 0.6, stagger: 0.08 }, "-=0.5");
    tl.from(".scrollcue", { opacity: 0, duration: 0.6 }, "-=0.3");
  }

  /* ---------- Cursor de escarcha ---------- */
  function cursor() {
    if (reduce || matchMedia("(hover: none)").matches) return;
    var el = document.createElement("div");
    el.className = "cursor"; el.innerHTML = '<div class="cursor__ring"></div>';
    document.body.appendChild(el);
    var x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y;
    addEventListener("pointermove", function (e) { tx = e.clientX; ty = e.clientY; }, { passive: true });
    (function loop() {
      x += (tx - x) * 0.18; y += (ty - y) * 0.18;
      el.style.transform = "translate(" + x + "px," + y + "px)";
      requestAnimationFrame(loop);
    })();
    var hot = "a, button, .btn, input, .card, .faq__q, [data-hot]";
    document.addEventListener("pointerover", function (e) {
      if (e.target.closest(hot)) el.classList.add("is-hot");
    });
    document.addEventListener("pointerout", function (e) {
      if (e.target.closest(hot)) el.classList.remove("is-hot");
    });
  }

  /* ---------- Botones magneticos ---------- */
  function magnetic() {
    if (reduce || matchMedia("(hover: none)").matches || !hasGSAP) return;
    document.querySelectorAll("[data-magnetic]").forEach(function (m) {
      var strength = parseFloat(m.getAttribute("data-magnetic")) || 0.4;
      m.addEventListener("pointermove", function (e) {
        var r = m.getBoundingClientRect();
        gsap.to(m, { x: (e.clientX - (r.left + r.width / 2)) * strength, y: (e.clientY - (r.top + r.height / 2)) * strength, duration: 0.5, ease: "power3.out" });
      });
      m.addEventListener("pointerleave", function () { gsap.to(m, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1,0.4)" }); });
    });
  }

  /* ---------- Nav stuck ---------- */
  function nav() {
    var n = document.querySelector(".nav"); if (!n) return;
    var onScroll = function () { n.classList.toggle("is-stuck", scrollY > 40); };
    onScroll(); addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Parallax hero (scroll + pointer) ---------- */
  function heroParallax() {
    if (!hasGSAP || reduce) return;
    var layers = document.querySelectorAll(".hero__layer");
    layers.forEach(function (l, i) {
      var depth = (i + 1) * 12;
      if (window.ScrollTrigger) {
        gsap.to(l, { yPercent: depth, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
      }
    });
    if (!matchMedia("(hover: none)").matches) {
      addEventListener("pointermove", function (e) {
        var mx = (e.clientX / innerWidth - 0.5), my = (e.clientY / innerHeight - 0.5);
        layers.forEach(function (l, i) {
          gsap.to(l, { x: mx * (i + 1) * 16, y: my * (i + 1) * 10, duration: 0.8, ease: "power2.out" });
        });
      }, { passive: true });
    }
  }

  /* ---------- Reveal on scroll ---------- */
  function reveals() {
    var items = document.querySelectorAll(".r-up, .r-fade");
    if (!items.length) return;
    if (!hasGSAP || !window.ScrollTrigger || reduce) {
      items.forEach(function (i) { i.classList.add("is-inview"); }); return;
    }
    ScrollTrigger.batch(items, {
      start: "top 86%",
      onEnter: function (els) { gsap.to(els, { opacity: 1, y: 0, duration: 0.9, stagger: 0.08, ease: "power3.out", onStart: function () { els.forEach(function (e) { e.classList.add("is-inview"); }); } }); }
    });
  }

  /* ---------- Kinetic manifesto ---------- */
  function manifesto() {
    var big = document.querySelector(".manifesto__big"); if (!big) return;
    if (!big.dataset.split) {
      var html = big.innerHTML.replace(/(<em>.*?<\/em>|[^\s<]+)(\s*)/g, function (_, w, sp) {
        return '<span class="w">' + w + "</span>" + sp;
      });
      big.innerHTML = html; big.dataset.split = "1";
    }
    if (!hasGSAP || !window.ScrollTrigger || reduce) return;
    gsap.from(big.querySelectorAll(".w"), {
      opacity: 0.12, y: 18, duration: 0.8, stagger: 0.05, ease: "power2.out",
      scrollTrigger: { trigger: big, start: "top 78%", end: "bottom 60%", scrub: false }
    });
  }

  /* ---------- Thaw reveal (clip-path por scroll) ---------- */
  function thaw() {
    var ice = document.querySelector(".reveal__ice"); if (!ice) return;
    if (!hasGSAP || !window.ScrollTrigger || reduce) { ice.style.opacity = 0; return; }
    gsap.fromTo(ice,
      { clipPath: "inset(0% 0% 0% 0%)", opacity: 1, scale: 1.06 },
      { clipPath: "inset(50% 50% 50% 50%)", opacity: 0, scale: 1.18, ease: "none",
        scrollTrigger: { trigger: ".reveal", start: "top top", end: "bottom top", scrub: 0.6, pin: true } });
    var cap = document.querySelector(".reveal__caption");
    if (cap) gsap.fromTo(cap, { opacity: 0, y: 20 }, { opacity: 1, y: 0,
      scrollTrigger: { trigger: ".reveal", start: "top 60%", end: "center center", scrub: 0.6 } });
  }

  /* ---------- Contadores / meter ---------- */
  function counters() {
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var target = parseFloat(el.getAttribute("data-count"));
      var fmt = function (n) { return Math.round(n).toLocaleString("es"); };
      if (!hasGSAP || !window.ScrollTrigger || reduce) { el.textContent = fmt(target); return; }
      var o = { v: 0 };
      gsap.to(o, { v: target, duration: 1.6, ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 90%" },
        onUpdate: function () { el.textContent = fmt(o.v); } });
    });
    document.querySelectorAll("[data-meter]").forEach(function (el) {
      var pct = Math.max(0, Math.min(100, parseFloat(el.getAttribute("data-meter")) || 0));
      if (!hasGSAP || !window.ScrollTrigger || reduce) { el.style.width = pct + "%"; return; }
      gsap.fromTo(el, { width: "0%" }, { width: pct + "%", duration: 1.6, ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 92%" } });
    });
  }

  /* ---------- Cupos reales (RPC opcional) + fallback ---------- */
  function liveSpots() {
    var el = document.querySelector("[data-spots-live]"); if (!el) return;
    var goal = parseInt(el.getAttribute("data-goal") || "500", 10);
    function paint(taken) {
      var left = Math.max(0, goal - taken);
      var leftEl = document.querySelector("[data-spots-left]");
      var meter = document.querySelector("[data-meter-live]");
      if (leftEl) leftEl.setAttribute("data-count", left);
      if (meter) meter.setAttribute("data-meter", Math.min(100, (taken / goal) * 100));
      counters();
    }
    var c = window.supabase && window.__sbForSpots;
    try {
      var sb = window.supabase && window.supabase.createClient
        ? window.supabase.createClient("https://flbgmlvfiejfttlawnfu.supabase.co", "sb_publishable_NSMF05hUVLA81aPvXuhRRA_vjOvT7CP", { auth: { persistSession: false } })
        : null;
      if (sb && sb.rpc) {
        var ut = document.body.getAttribute("data-user-type") || "artist";
        sb.rpc("beta_waitlist_count", { p_user_type: ut }).then(function (res) {
          if (!res.error && typeof res.data === "number") paint(res.data);
        }).catch(function () {});
      }
    } catch (e) {}
  }

  /* ---------- Cards: glow sigue al cursor ---------- */
  function cardGlow() {
    if (reduce) return;
    document.querySelectorAll(".card").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
  }

  /* ---------- FAQ ---------- */
  function faq() {
    document.querySelectorAll(".faq__item").forEach(function (item) {
      var q = item.querySelector(".faq__q");
      var a = item.querySelector(".faq__a");
      if (!q || !a) return;
      q.addEventListener("click", function () {
        var open = item.classList.toggle("is-open");
        if (!hasGSAP || reduce) { a.style.height = open ? "auto" : "0"; return; }
        if (open) { gsap.set(a, { height: "auto" }); gsap.from(a, { height: 0, duration: 0.45, ease: "power2.out" }); }
        else gsap.to(a, { height: 0, duration: 0.4, ease: "power2.inOut" });
      });
    });
  }

  /* ---------- Confeti de ascuas al unirse ---------- */
  function joinBurst() {
    document.addEventListener("waitlist:joined", function () {
      if (reduce || !hasGSAP) return;
      var n = 26;
      for (var i = 0; i < n; i++) {
        var p = document.createElement("div");
        p.style.cssText = "position:fixed;z-index:9998;left:50%;top:60%;width:7px;height:7px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,var(--accent-soft),var(--accent-2));box-shadow:0 0 12px var(--accent-glow)";
        document.body.appendChild(p);
        gsap.to(p, { x: (Math.random() - 0.5) * innerWidth * 0.7, y: -(Math.random() * innerHeight * 0.6) - 60, opacity: 0, duration: 1.2 + Math.random(), ease: "power2.out", onComplete: function () { this.targets()[0].remove(); } });
      }
    });
  }

  /* ---------- Video de hero (mejora progresiva) ---------- */
  function heroVideo() {
    var v = document.querySelector(".hero__video"); if (!v) return;
    if (reduce || matchMedia("(max-width: 600px)").matches) return; // movil/reduced: hero estatico
    var src = v.getAttribute("data-src"); if (!src) return;
    // Solo carga el video si el archivo existe (evita 404 mientras no esté el mp4).
    fetch(src, { method: "HEAD" }).then(function (r) {
      if (!r.ok) return;
      v.src = src;
      v.addEventListener("loadeddata", function () { v.classList.add("is-on"); var p = v.play(); if (p && p.catch) p.catch(function () {}); });
      v.load();
    }).catch(function () {});
  }

  /* ---------- Boot ---------- */
  function boot() {
    cursor(); nav(); magnetic(); cardGlow(); faq(); joinBurst(); heroVideo();
    heroParallax(); reveals(); manifesto(); thaw(); counters(); liveSpots();
  }
  runPreloader(function () { heroIntro(); boot(); if (hasGSAP && window.ScrollTrigger) ScrollTrigger.refresh(); });
})();
