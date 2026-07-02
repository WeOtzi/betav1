/* frost.js — fondo de hero: ascuas que ascienden + escarcha, "calentado" por el cursor.
   Liviano: cap de particulas, DPR-aware, pausa fuera de vista, off en reduced-motion. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var host = document.querySelector(".hero__frost");
  if (!host || reduce) return;

  var canvas = document.createElement("canvas");
  host.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0;
  var embers = [], frostBits = [];
  var pointer = { x: -9999, y: -9999, active: false };
  var running = true;

  function css(v) { return getComputedStyle(document.body).getPropertyValue(v).trim(); }
  var ACCENT = css("--accent") || "#e8893b";
  var ICE = css("--ice") || "#9fc2d4";

  function resize() {
    W = host.clientWidth; H = host.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function seed() {
    var area = W * H;
    var nE = Math.max(26, Math.min(70, Math.round(area / 26000)));
    var nF = Math.max(30, Math.min(90, Math.round(area / 20000)));
    embers = []; frostBits = [];
    for (var i = 0; i < nE; i++) embers.push(newEmber(true));
    for (var j = 0; j < nF; j++) frostBits.push(newFrost());
  }

  function newEmber(spread) {
    return {
      x: rnd(0, W),
      y: spread ? rnd(0, H) : H + rnd(0, 60),
      r: rnd(0.6, 2.2),
      vy: rnd(0.12, 0.5),
      vx: rnd(-0.18, 0.18),
      a: rnd(0.15, 0.7),
      tw: rnd(0, Math.PI * 2),
      tws: rnd(0.01, 0.04)
    };
  }
  function newFrost() {
    return { x: rnd(0, W), y: rnd(0, H), r: rnd(0.4, 1.3), a: rnd(0.04, 0.22), drift: rnd(-0.05, 0.05) };
  }

  function hex(c) {
    c = c.replace("#", "");
    if (c.length === 3) c = c.split("").map(function (x) { return x + x; }).join("");
    return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
  }
  var AC = hex(ACCENT), IC = hex(ICE);

  function step() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "screen";

    // escarcha (fria, casi estatica)
    for (var f = 0; f < frostBits.length; f++) {
      var b = frostBits[f];
      b.x += b.drift; if (b.x < 0) b.x = W; if (b.x > W) b.x = 0;
      ctx.beginPath();
      ctx.fillStyle = "rgba(" + IC[0] + "," + IC[1] + "," + IC[2] + "," + b.a + ")";
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }

    // ascuas (suben, brillan cerca del cursor)
    for (var i = 0; i < embers.length; i++) {
      var e = embers[i];
      e.y -= e.vy; e.x += e.vx; e.tw += e.tws;
      if (e.y < -10) { embers[i] = newEmber(false); continue; }

      var heat = 0;
      if (pointer.active) {
        var dx = e.x - pointer.x, dy = e.y - pointer.y;
        var d2 = dx * dx + dy * dy;
        var R = 170;
        if (d2 < R * R) { heat = 1 - Math.sqrt(d2) / R; e.x += dx * 0.002 * heat; e.y += dy * 0.001 * heat; }
      }
      var alpha = Math.min(1, (e.a + Math.sin(e.tw) * 0.12) + heat * 0.6);
      var rr = e.r + heat * 1.8;
      var g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, rr * 4);
      g.addColorStop(0, "rgba(" + AC[0] + "," + AC[1] + "," + AC[2] + "," + alpha + ")");
      g.addColorStop(1, "rgba(" + AC[0] + "," + AC[1] + "," + AC[2] + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x, e.y, rr * 4, 0, Math.PI * 2); ctx.fill();
    }

    // halo calido alrededor del cursor
    if (pointer.active) {
      var hg = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 160);
      hg.addColorStop(0, "rgba(" + AC[0] + "," + AC[1] + "," + AC[2] + ",0.10)");
      hg.addColorStop(1, "rgba(" + AC[0] + "," + AC[1] + "," + AC[2] + ",0)");
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 160, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(step);
  }

  window.addEventListener("pointermove", function (ev) {
    var rect = host.getBoundingClientRect();
    pointer.x = ev.clientX - rect.left; pointer.y = ev.clientY - rect.top; pointer.active = true;
  }, { passive: true });
  window.addEventListener("pointerleave", function () { pointer.active = false; });

  document.addEventListener("visibilitychange", function () {
    running = !document.hidden;
    if (running) requestAnimationFrame(step);
  });

  var ro = new ResizeObserver(resize); ro.observe(host);
  resize();
  requestAnimationFrame(step);
})();
