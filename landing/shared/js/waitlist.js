/* waitlist.js — captura de leads para la beta. Inserta en Supabase (tabla beta_waitlist).
   Detecta si el valor es email o @instagram. Maneja duplicados como exito. */
(function () {
  "use strict";

  var SUPABASE_URL = "https://flbgmlvfiejfttlawnfu.supabase.co";
  var SUPABASE_KEY = "sb_publishable_NSMF05hUVLA81aPvXuhRRA_vjOvT7CP";

  var sb = null;
  function client() {
    if (sb) return sb;
    if (!window.supabase || !window.supabase.createClient) return null;
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    return sb;
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function parseContact(raw) {
    var v = (raw || "").trim();
    if (!v) return { ok: false };
    if (EMAIL_RE.test(v)) return { ok: true, email: v.toLowerCase(), instagram: null };
    // instagram: limpia @, urls, espacios
    var ig = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
              .replace(/[/?#].*$/, "")
              .replace(/^@/, "")
              .trim();
    if (/^[A-Za-z0-9._]{2,40}$/.test(ig)) return { ok: true, email: null, instagram: ig.toLowerCase() };
    return { ok: false };
  }

  function wire(form) {
    var root = form.closest(".waitlist") || form.parentElement;
    var input = form.querySelector("input");
    var hint = root.querySelector(".waitlist__hint");
    var btn = form.querySelector("button[type=submit], .btn");
    var userType = document.body.getAttribute("data-user-type") || "artist";
    var source = document.body.getAttribute("data-source") || "landing";

    var field = form.querySelector(".waitlist__field");
    if (field) {
      input.addEventListener("focus", function () { field.classList.add("is-breathing"); });
      input.addEventListener("blur", function () { if (!input.value) field.classList.remove("is-breathing"); });
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var parsed = parseContact(input.value);
      if (!parsed.ok) {
        setHint(hint, "Escribe un correo valido o tu @usuario de Instagram.", "is-error");
        input.focus(); return;
      }
      var c = client();
      if (!c) { setHint(hint, "No se pudo conectar. Reintenta en un momento.", "is-error"); return; }

      var origLabel = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.innerHTML = "Reservando..."; }
      setHint(hint, "", "");

      var payload = {
        user_type: userType,
        email: parsed.email,
        instagram: parsed.instagram,
        source: source,
        referrer: (document.referrer || "").slice(0, 300) || null,
        user_agent: (navigator.userAgent || "").slice(0, 300),
        locale: navigator.language || null
      };

      c.from("beta_waitlist").insert(payload).then(function (res) {
        var err = res && res.error;
        if (err && err.code !== "23505") {
          if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
          setHint(hint, "Algo fallo al guardar. Intenta de nuevo.", "is-error");
          return;
        }
        // exito (o ya estaba en la lista)
        succeed(root, parsed, err && err.code === "23505");
        document.dispatchEvent(new CustomEvent("waitlist:joined", { detail: { userType: userType } }));
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
        setHint(hint, "Sin conexion. Intenta de nuevo.", "is-error");
      });
    });
  }

  function setHint(el, msg, cls) {
    if (!el) return;
    el.textContent = msg;
    el.className = "waitlist__hint" + (cls ? " " + cls : "");
  }

  function succeed(root, parsed, already) {
    var s = root.querySelector(".waitlist__success");
    if (s) {
      var who = parsed.email || ("@" + parsed.instagram);
      var echo = s.querySelector("[data-echo]");
      if (echo) echo.textContent = who;
      var note = s.querySelector("[data-note]");
      if (note) note.textContent = already
        ? "Ya estabas en la lista — tu lugar sigue reservado."
        : "Te avisaremos en cuanto abramos tu acceso.";
    }
    root.classList.add("is-done");
  }

  function init() {
    var forms = document.querySelectorAll(".waitlist__form");
    forms.forEach(wire);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
