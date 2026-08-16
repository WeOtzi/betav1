/* ============================================================================
   WE ÖTZI — Dashboard del artista · capa viva del rediseño Bauhaus (DS wo-*)
   ----------------------------------------------------------------------------
   Corre DESPUÉS de dashboard.js. dashboard.js sigue siendo dueño de: auth,
   formulario legacy (oculto), galería admin, banner de onboarding, modales
   (QR / contraseña / verificación) y milestones. Este archivo solo renderiza
   las superficies nuevas del dashboard y las alimenta con datos reales:

     · saludo del hero            ← nombre + sesiones de hoy
     · Agenda del día             ← quotation_sessions ⋈ quotations_db
     · stats de Cotizaciones      ← quotations_db (pendientes/aprobadas/rechazadas)
     · Actividad reciente         ← derivada de las cotizaciones reales
     · card de perfil (rail)      ← artistData (evento wo:dashboard-ready)
     · contador de la galería     ← espejo del grid que pinta dashboard.js
     · panel de notificaciones Ö  ← chat_messages (no leídos) + invitaciones
                                     pendientes + cotizaciones pendientes

   Defensivo por diseño: cada query va con timeout y cualquier sección que
   falle degrada a un CTA hacia la página completa, sin romper el dashboard.
   ============================================================================ */
(function () {
  'use strict';

  var sb = null;          // cliente supabase (desde dashboard.js)
  var user = null;        // currentUser (auth user; .id == artist_id)
  var artist = null;      // fila artists_db
  var todaySessions = null; // null = aún sin datos; number cuando carga agenda
  var LIVE_QUERY_TIMEOUT_MS = 8000;

  /* ---------- helpers ---------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function timeAgo(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'Recién';
    if (s < 3600) return 'Hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'Hace ' + Math.floor(s / 3600) + ' h';
    var days = Math.floor(s / 86400);
    if (days === 1) return 'Ayer';
    if (days < 7) return 'Hace ' + days + ' d';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }
  function styleList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string') {
      var t = v.trim();
      if (t[0] === '[' || t[0] === '{') { try { var p = JSON.parse(t); return Array.isArray(p) ? p.filter(Boolean) : [t]; } catch (e) { /* sigue */ } }
      return t.split(/[,;|]/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return [];
  }
  function withLiveTimeout(promise, label) {
    var timer = null;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new Error(label + ' timed out after ' + LIVE_QUERY_TIMEOUT_MS + 'ms'));
      }, LIVE_QUERY_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }
  function sameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ===================================================================== *
   *  HERO — "Buen día, {nombre}. Hoy tenés {n} sesiones programadas."      *
   * ===================================================================== */
  function greetingByHour(h) {
    if (h < 12) return 'Buen día';
    if (h < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }
  function renderHero() {
    var now = new Date();
    var kicker = $('wod-hero-kicker');
    if (kicker) {
      kicker.textContent = now.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'short' }) +
        ' · ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    }
    var title = $('wod-hero-title'); if (!title) return;
    var name = '';
    if (artist) {
      name = String(artist.name || '').trim().split(/\s+/)[0] || String(artist.username || '').replace(/^@/, '') || '';
    }
    var hello = greetingByHour(now.getHours()) + (name ? ', ' + esc(name) : '') + '.';
    var agendaBit;
    if (todaySessions === null) {
      agendaBit = 'Este es tu panel en We Ötzi.';
    } else if (todaySessions === 0) {
      agendaBit = 'Hoy tenés <span class="wo-highlight">agenda libre</span>.';
    } else if (todaySessions === 1) {
      agendaBit = 'Hoy <span class="wo-highlight">tenés 1 sesión</span> programada.';
    } else {
      agendaBit = 'Hoy <span class="wo-highlight">tenés ' + todaySessions + ' sesiones</span> programadas.';
    }
    title.innerHTML = hello + '<br>' + agendaBit;
  }

  /* ===================================================================== *
   *  CARD DE PERFIL (rail)                                                 *
   * ===================================================================== */
  function renderProfileCard() {
    if (!artist) return;
    var name = artist.username || artist.name || 'Tu perfil';
    var rawUsername = String(artist.username || '').replace(/^@/, '').trim();
    var handle = rawUsername
      ? '@' + (rawUsername.toLowerCase().endsWith('.wo') ? rawUsername : rawUsername + '.wo')
      : '@usuario.wo';
    var nm = $('artist-name'); if (nm) nm.textContent = String(name).toUpperCase();
    var un = $('artist-username'); if (un) un.textContent = handle;

    var avatar = artist.profile_picture || artist.avatar_url || '';
    var img = $('avatar-image'), ph = $('avatar-placeholder');
    if (avatar && img) {
      img.src = avatar; img.style.display = 'block';
      if (ph) ph.style.display = 'none';
    } else if (ph) {
      var initials = String(artist.username || artist.name || 'Ö').replace(/^@/, '').trim().slice(0, 2).toUpperCase();
      ph.textContent = initials || 'Ö';
    }

    // La verificación y el nivel los pinta dashboard.js (updateVerificationUI /
    // updateLevelBadge) sobre los mismos ids; acá solo garantizamos visibilidad.
    var vbadge = $('verification-badge'); if (vbadge) vbadge.style.display = 'inline-flex';
    if (String(artist.embajador || '').toLowerCase() === 'si' || artist.embajador === true) {
      var eb = $('embajador-badge'); if (eb) eb.style.display = 'inline-flex';
    }

    // Línea meta "$X / SESIÓN · N ESTILOS · Y AÑOS": dashboard.js llena
    // #stat-price / #stat-styles / #stat-experience; fallback defensivo acá.
    var styles = styleList(artist.styles_array || artist.styles || artist.estilos);
    var ss = $('stat-styles'); if (ss && (ss.textContent === '—' || ss.textContent === '')) ss.textContent = styles.length || '—';
    var se = $('stat-experience'); if (se && (se.textContent === '—' || se.textContent === '')) se.textContent = artist.years_experience || '—';
  }

  /* ===================================================================== *
   *  AGENDA DEL DÍA  (live · quotation_sessions ⋈ quotations_db)           *
   * ===================================================================== */
  function sessionState(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'confirmed' || s === 'scheduled') return { cls: 'is-ok', txt: 'CONFIRMADO' };
    if (s === 'completed') return { cls: 'is-ok', txt: 'COMPLETADO' };
    if (s === 'pending' || s === 'tentative' || s === 'pending_confirmation') return { cls: 'is-warn', txt: 'POR CONFIRMAR' };
    return { cls: 'is-warn', txt: (status || 'POR CONFIRMAR').toString().toUpperCase() };
  }
  function loadAgenda() {
    var nowIso = new Date().toISOString();
    return withLiveTimeout(WeotziData.Sessions.listUpcomingForArtist(nowIso, { limit: 30 }), 'agenda')
      .then(function (rows) {
        rows = (rows || []).filter(function (s) { return String(s.status || '').toLowerCase() !== 'cancelled'; });
        var now = new Date();
        todaySessions = rows.filter(function (s) {
          var d = new Date(s.session_date);
          return !isNaN(d) && sameLocalDay(d, now);
        }).length;
        renderHero();

        var cap = $('wod-agenda-cap');
        if (cap) cap.textContent = todaySessions > 0 ? 'Agenda del día' : 'Agenda · próximos turnos';

        var box = $('wod-agenda-rows'); if (!box) return rows.length;
        if (!rows.length) {
          box.innerHTML = '<div class="wod-empty">Sin turnos próximos · <a href="/calendar">abrir calendario →</a></div>';
          return 0;
        }
        box.innerHTML = rows.slice(0, 5).map(function (s) {
          var q = s.quotations_db || {};
          var who = q.client_full_name || 'Cliente';
          var d = new Date(s.session_date);
          var hour = isNaN(d) ? '--:--' : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
          var isToday = !isNaN(d) && sameLocalDay(d, now);
          var dayLabel = isToday ? '' :
            (isNaN(d) ? '' : ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][d.getDay()] + ' ' + pad2(d.getDate()));
          var st = sessionState(s.status);
          var detailParts = [];
          detailParts.push(s.session_number ? 'Sesión ' + s.session_number : 'Sesión');
          var style = styleList(q.tattoo_style)[0];
          if (style) detailParts.push(style);
          if (q.tattoo_body_part) detailParts.push(q.tattoo_body_part);
          if (s.notes) detailParts.push(s.notes);
          return '<div class="wo-dash-agendarow">' +
            '<div class="wo-dash-agendatime">' +
              '<span class="wo-dash-agendahour">' + esc(hour) + '</span>' +
              (dayLabel ? '<span class="wo-dash-agendaday">' + esc(dayLabel) + '</span>' : '') +
            '</div>' +
            '<div class="wo-dash-agendabody">' +
              '<div class="wo-dash-agendawho">' + esc(who) + '</div>' +
              '<div class="wo-dash-agendadetail">' + esc(detailParts.join(' · ')) + '</div>' +
            '</div>' +
            '<div class="wo-dash-agendameta">' +
              '<span class="wo-dash-state ' + st.cls + '">' + esc(st.txt) + '</span>' +
            '</div>' +
          '</div>';
        }).join('');
        return rows.length;
      })
      .catch(function (e) {
        console.warn('[redesign] agenda', e);
        // todaySessions queda en null: el hero mantiene el saludo genérico
        // en vez de afirmar "agenda libre" sin datos.
        var box = $('wod-agenda-rows');
        if (box) box.innerHTML = '<div class="wod-empty">Sin turnos visibles · <a href="/calendar">abrir calendario →</a></div>';
        return 0;
      });
  }

  /* ===================================================================== *
   *  COTIZACIONES  (live · quotations_db)  +  ACTIVIDAD RECIENTE           *
   * ===================================================================== */
  function activityEvent(q) {
    var name = q.client_full_name || q.client_name || 'Cliente';
    var s = String(q.quote_status || '').toLowerCase();
    var when = q.responded_at || q.updated_at || q.created_at;
    if (s === 'pending') return { icon: 'mail', txt: 'Nueva cotización de ' + name, when: q.created_at };
    if (s === 'responded' || s === 'artist_completed') return { icon: 'corner-up-left', txt: 'Respondiste a ' + name, when: when };
    if (s === 'client_approved' || s === 'completed') return { icon: 'check-circle', txt: name + ' aprobó tu cotización', when: when };
    if (s === 'client_rejected') return { icon: 'x-circle', txt: name + ' rechazó tu cotización', when: when };
    return null;
  }
  function renderActivity(quotes) {
    var sec = $('wod-activity-section'), list = $('wod-activity-list');
    if (!sec || !list) return;
    var events = quotes.map(activityEvent).filter(Boolean);
    events.sort(function (a, b) { return new Date(b.when || 0) - new Date(a.when || 0); });
    events = events.slice(0, 4);
    if (!events.length) { sec.hidden = true; return; }
    sec.hidden = false;
    list.innerHTML = events.map(function (ev) {
      return '<div class="wo-dash-activityrow">' +
        '<i data-wo-icon="' + ev.icon + '" class="wo-icon-18"></i>' +
        '<span class="wo-dash-activitytxt">' + esc(ev.txt) + '</span>' +
        '<span class="wo-dash-activitywhen">' + esc(timeAgo(ev.when)) + '</span>' +
      '</div>';
    }).join('');
    if (window.WoIcons) window.WoIcons.hydrate(list);
  }
  function loadCotizaciones() {
    return withLiveTimeout(WeotziData.Quotations.listForArtist(user.id, { limit: 60 }), 'cotizaciones')
      .then(function (rows) {
        var quotes = (rows || []).filter(function (q) { return !q.is_archived; });
        var count = function (fn) { return quotes.filter(fn).length; };
        var pending = count(function (q) { return q.quote_status === 'pending'; });
        var approved = count(function (q) { return q.quote_status === 'client_approved' || q.quote_status === 'completed'; });
        var rejected = count(function (q) { return q.quote_status === 'client_rejected'; });
        var setT = function (id, v) { var el = $(id); if (el) el.textContent = v; };
        setT('ws-pending', pending);
        setT('ws-approved', approved);
        setT('ws-rejected', rejected);
        if (pending) {
          var bb = $('wod-bb-cotiz'); if (bb) { bb.textContent = pending; bb.hidden = false; }
          var nb = $('wod-nav-msg-badge'); if (nb) { nb.textContent = pending; nb.hidden = false; }
        }
        renderActivity(quotes);
        notifCounts.solic = pending;
        applyNotifCounts();
        loadNotifMessages(quotes);
        return { pending: pending, approved: approved, rejected: rejected };
      })
      .catch(function (e) {
        console.warn('[redesign] cotizaciones', e);
        ['ws-pending', 'ws-approved', 'ws-rejected'].forEach(function (id) {
          var el = $(id); if (el && el.textContent === '—') el.textContent = '0';
        });
        return { pending: 0, approved: 0, rejected: 0 };
      });
  }

  /* ===================================================================== *
   *  CONTADOR DE GALERÍA — espejo del grid que pinta dashboard.js          *
   * ===================================================================== */
  function watchGalleryCount() {
    var grid = $('gallery-admin-grid'), out = $('wod-gallery-count');
    if (!grid || !out) return;
    var apply = function () {
      var n = grid.querySelectorAll('.gallery-item').length;
      out.textContent = '— ' + n;
    };
    apply();
    try { new MutationObserver(apply).observe(grid, { childList: true }); } catch (e) { /* opcional */ }
  }

  /* ===================================================================== *
   *  PANEL DE NOTIFICACIONES — dropdown del tile Ö (Figma 167:24120)       *
   *  Contadores 100% reales: mensajes no leídos (chat_messages, sender     *
   *  'client'), invitaciones pendientes (studio_artist_memberships) y      *
   *  solicitudes pendientes (quotations_db, reutiliza loadCotizaciones).   *
   *  "Notificaciones" es la fila agregadora = suma de las tres; el badge   *
   *  del tile Ö muestra ese mismo total. La fila "Actualizaciones de la    *
   *  plataforma" del Figma se omite: no existe backend que la alimente.    *
   * ===================================================================== */
  var notifCounts = { msgs: null, inv: null, solic: null };
  var notifWired = false;

  function setNotifRow(key, n) {
    var count = Number(n) || 0;
    var num = $('wod-notif-n-' + key);
    if (num) num.textContent = count > 99 ? '99+' : String(count);
    var row = $('wod-notif-row-' + key);
    if (row) row.classList.toggle('has-count', count > 0);
  }

  function applyNotifCounts() {
    setNotifRow('msgs', notifCounts.msgs);
    setNotifRow('inv', notifCounts.inv);
    setNotifRow('solic', notifCounts.solic);
    var total = (notifCounts.msgs || 0) + (notifCounts.inv || 0) + (notifCounts.solic || 0);
    setNotifRow('total', total);
    var tileBadge = $('wod-notif-count');
    if (tileBadge) {
      tileBadge.textContent = total > 99 ? '99+' : String(total);
      tileBadge.hidden = total <= 0;
    }
  }

  // Mensajes de clientes sin leer sobre las cotizaciones ya cargadas
  // (mismo batch query que usa client-dashboard.js, con sender invertido).
  function loadNotifMessages(quotes) {
    var ids = (quotes || []).map(function (q) { return q.quote_id; }).filter(Boolean);
    if (!ids.length) { notifCounts.msgs = 0; applyNotifCounts(); return; }
    withLiveTimeout(WeotziData.Chat.countUnreadByQuotationIds(ids, 'client'), 'mensajes sin leer')
      .then(function (counts) {
        var total = 0;
        Object.keys(counts || {}).forEach(function (k) { total += counts[k] || 0; });
        notifCounts.msgs = total;
        applyNotifCounts();
      })
      .catch(function (e) { console.warn('[redesign] mensajes sin leer', e); });
  }

  // Invitaciones de estudios pendientes de aceptar (como artist-invitations.js).
  function loadNotifInvitations() {
    var repo = window.WeotziData && window.WeotziData.StudioMemberships;
    if (!repo || typeof repo.listPendingForArtist !== 'function' || !user) return;
    withLiveTimeout(Promise.resolve(repo.listPendingForArtist(user.id)), 'invitaciones')
      .then(function (res) {
        if (res && res.error) throw res.error;
        notifCounts.inv = ((res && res.data) || []).length;
        applyNotifCounts();
      })
      .catch(function (e) { console.warn('[redesign] invitaciones', e); });
  }

  // Cabecera del panel (avatar + username + email) y link al perfil público.
  function renderNotifIdentity() {
    var rawUsername = artist ? String(artist.username || '').replace(/^@/, '').trim() : '';
    var display = rawUsername || (artist && artist.name) || '';
    var u = $('wod-notif-user'); if (u && display) u.textContent = display;
    var email = (user && user.email) || '';
    var m = $('wod-notif-mail'); if (m && email) m.textContent = email;
    var av = $('wod-notif-avatar');
    if (av) {
      var pic = artist && (artist.profile_picture || artist.avatar_url);
      if (pic) {
        av.innerHTML = '<img src="' + esc(pic) + '" alt="">';
      } else if (display) {
        av.textContent = display.slice(0, 2).toUpperCase();
      }
    }
    var pub = $('wod-notif-public');
    if (pub && artist && artist.username) {
      pub.href = '/artist/profile?artist=' + encodeURIComponent(artist.username);
    }
  }

  // Abrir/cerrar: click en el tile, click afuera y Escape (devuelve el foco).
  function wireNotifPanel() {
    if (notifWired) return;
    notifWired = true;
    var btn = $('wod-notif-toggle'), panel = $('wod-notif-panel');
    if (!btn || !panel) return;
    function setOpen(open) {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function () { setOpen(panel.hidden); });
    document.addEventListener('click', function (e) {
      if (panel.hidden) return;
      if (btn.contains(e.target) || panel.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        try { btn.focus(); } catch (err) { /* sin foco */ }
      }
    });
  }

  /* ---------- degradación de estados "Cargando…" ------------------------ */
  function clearStaleLoadingStates() {
    var el = $('wod-agenda-rows');
    if (el && /Cargando/i.test(el.textContent || '')) {
      el.innerHTML = '<div class="wod-empty">Sin turnos visibles · <a href="/calendar">abrir calendario →</a></div>';
    }
  }

  /* ===================================================================== *
   *  BOOTSTRAP                                                             *
   * ===================================================================== */
  function boot(detail) {
    sb = detail.supabase || window._supabase;
    user = detail.currentUser;
    artist = detail.artistData || null;

    renderHero();
    watchGalleryCount();
    wireNotifPanel();

    if (!sb || !user) { console.warn('[redesign] missing supabase/user; aborting live layer'); return; }

    renderProfileCard();
    renderNotifIdentity();
    setTimeout(clearStaleLoadingStates, LIVE_QUERY_TIMEOUT_MS + 500);
    loadAgenda();
    loadCotizaciones();
    loadNotifInvitations();
  }

  var booted = false;
  window.addEventListener('wo:dashboard-ready', function (ev) {
    if (booted) return; booted = true;
    try { boot(ev.detail || {}); } catch (e) { console.error('[redesign] boot failed', e); }
  });
  // Red de seguridad: si el evento se disparó antes de este listener, poll breve.
  var tries = 0;
  var poll = setInterval(function () {
    if (booted) { clearInterval(poll); return; }
    if (window._supabase && window.currentUser) {
      clearInterval(poll); booted = true;
      boot({ supabase: window._supabase, currentUser: window.currentUser, artistData: window.artistData });
    } else if (++tries > 60) { clearInterval(poll); }
  }, 250);

  // El hero (fecha/saludo) y el panel Ö no dependen de datos: apenas el DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wireNotifPanel();
      if (!booted) renderHero();
    });
  } else {
    wireNotifPanel();
    if (!booted) renderHero();
  }
})();
