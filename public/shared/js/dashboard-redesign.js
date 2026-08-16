/* ============================================================================
   WE ÖTZI — Dashboard del artista · capa viva del rediseño Bauhaus (DS wo-*)
   ----------------------------------------------------------------------------
   Corre DESPUÉS de dashboard.js. dashboard.js sigue siendo dueño de: auth,
   formulario legacy (oculto), galería admin, banner de onboarding, modales
   (QR / contraseña / verificación) y milestones. Este archivo solo renderiza
   las superficies nuevas del dashboard y las alimenta con datos reales:

     · saludo del hero            ← nombre + sesiones de hoy
     · Agenda del día             ← quotation_sessions ⋈ quotations_db (con duración)
     · Diseños en proceso         ← cotizaciones confirmadas + sesiones + adjuntos
     · stats de Cotizaciones      ← quotations_db (pendientes/aprobadas/rechazadas)
     · Actividad reciente         ← derivada de las cotizaciones reales
     · card de perfil (rail)      ← artistData (evento wo:dashboard-ready)
     · INGRESOS (rail)            ← final_budget_amount de cotizaciones completadas
     · galería                    ← realce del grid que pinta dashboard.js
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
  var MONTHS_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO',
    'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  var MONTHS_ES_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  function dayMonth(d) { return pad2(d.getDate()) + ' ' + MONTHS_ES_SHORT[d.getMonth()]; }
  // Miniatura de un adjunto de Drive (mismo criterio que shared-drawer.js).
  function driveThumb(url) {
    if (!url) return '';
    if (url.indexOf('drive.google.com') === -1) return url;
    var fileId = '';
    if (url.indexOf('/d/') !== -1) fileId = url.split('/d/')[1].split('/')[0];
    else if (url.indexOf('id=') !== -1) fileId = url.split('id=')[1].split('&')[0];
    return fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w600' : '';
  }
  // Formatea un monto con la moneda del artista (WeOtziCurrency si está listo).
  function money(amount, code) {
    var c = window.WeOtziCurrency;
    if (c && typeof c.format === 'function') {
      try { return c.format(amount, code, { decimals: 0 }); } catch (e) { /* sigue */ }
    }
    return (code || '') + ' ' + Math.round(amount).toLocaleString('es-AR');
  }

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
    applyStylesWord();
  }

  /* Figma: "1 ESTILO" en singular. dashboard.js escribe el número en
     #stat-styles; acá solo concordamos la palabra que lo acompaña. */
  function applyStylesWord() {
    var n = $('stat-styles'), w = $('wod-styles-word');
    if (!n || !w) return;
    var v = parseInt(String(n.textContent || '').replace(/[^0-9]/g, ''), 10);
    w.textContent = v === 1 ? 'ESTILO' : 'ESTILOS';
  }
  var stylesWordWatched = false;
  function watchStylesWord() {
    var n = $('stat-styles'); if (!n || stylesWordWatched) return;
    stylesWordWatched = true;
    applyStylesWord();
    try {
      new MutationObserver(applyStylesWord).observe(n, { childList: true, characterData: true, subtree: true });
    } catch (e) { /* opcional */ }
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
  // Duración real de la sesión: 3H / 1.5H → 90M. Sin dato, sin chip.
  function durationLabel(hours) {
    var h = parseFloat(hours);
    if (!isFinite(h) || h <= 0) return '';
    if (h < 1) return Math.round(h * 60) + 'M';
    if (Math.abs(h - Math.round(h)) < 0.01) return Math.round(h) + 'H';
    return Math.round(h * 60) + 'M';
  }
  // El select por defecto del repo no trae duration_hours; lo pedimos y, si la
  // columna no estuviera disponible, reintentamos con el select por defecto para
  // no degradar la agenda entera por un campo opcional.
  function fetchAgendaRows(nowIso) {
    var cols = 'id, session_date, session_number, status, notes, duration_hours, quotation_id, ' +
      'quotations_db(client_full_name, tattoo_style, tattoo_body_part)';
    return WeotziData.Sessions.listUpcomingForArtist(nowIso, { limit: 30, select: cols })
      .catch(function (e) {
        console.warn('[redesign] agenda sin duration_hours', e);
        return WeotziData.Sessions.listUpcomingForArtist(nowIso, { limit: 30 });
      });
  }
  function loadAgenda() {
    var nowIso = new Date().toISOString();
    return withLiveTimeout(fetchAgendaRows(nowIso), 'agenda')
      .then(function (rows) {
        rows = (rows || []).filter(function (s) { return String(s.status || '').toLowerCase() !== 'cancelled'; });
        var now = new Date();
        todaySessions = rows.filter(function (s) {
          var d = new Date(s.session_date);
          return !isNaN(d) && sameLocalDay(d, now);
        }).length;
        renderHero();

        // El Figma define un único título para el bloque; las filas ya llevan
        // el chip de día cuando el turno no es de hoy.
        var cap = $('wod-agenda-cap');
        if (cap) cap.textContent = 'Agenda del día';

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
          var dur = durationLabel(s.duration_hours);
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
              (dur ? '<span class="wo-dash-agendadur">' + esc(dur) + '</span>' : '') +
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
        lastQuotes = quotes;
        renderDesigns(quotes);
        renderIncome(quotes);
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
   *  DISEÑOS EN PROCESO  (live · quotations_db ⋈ quotation_sessions ⋈       *
   *  quotations_attachments)                                               *
   *  El Figma pide "etapa (BOCETO/ENTINTADO/FINAL)", "% de avance" y        *
   *  "LÍMITE <fecha>". No existe pipeline de diseño ni deadline en el       *
   *  modelo, así que se derivan datos reales equivalentes:                  *
   *    · etapa   → estado real de la cotización (CONFIRMADA / LISTA…)       *
   *    · avance  → sesiones completadas / sesiones totales                  *
   *    · fecha   → PRÓXIMA <fecha de la siguiente sesión agendada>          *
   *  La imagen es la primera referencia adjunta del cliente; si no hay,     *
   *  queda el placeholder de la caja que dibuja el Figma.                   *
   * ===================================================================== */
  var DESIGN_STAGES = {
    client_approved: 'CONFIRMADA',
    artist_completed: 'LISTA PARA CLIENTE'
  };
  function designTitle(q) {
    var parts = [];
    var style = styleList(q.tattoo_style)[0];
    if (style) parts.push(String(style).trim());
    if (q.tattoo_body_part) parts.push(String(q.tattoo_body_part).trim());
    if (parts.length) return parts.join(' · ');
    return q.quote_id ? 'Cotización ' + q.quote_id : 'Cotización';
  }
  function designCard(q, sessions, thumb) {
    var now = new Date();
    var live = (sessions || []).filter(function (s) { return String(s.status || '').toLowerCase() !== 'cancelled'; });
    var done = live.filter(function (s) { return String(s.status || '').toLowerCase() === 'completed'; }).length;
    var declared = parseInt(q.final_sessions || q.tattoo_estimated_sessions, 10);
    var total = Math.max(isFinite(declared) ? declared : 0, live.length);
    var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

    var next = live
      .map(function (s) { return new Date(s.session_date); })
      .filter(function (d) { return !isNaN(d) && d >= now; })
      .sort(function (a, b) { return a - b; })[0];

    var stage = DESIGN_STAGES[q.quote_status] || String(q.quote_status || '').toUpperCase();
    var ready = q.quote_status === 'artist_completed';

    var media = thumb
      ? '<img src="' + esc(thumb) + '" alt="" loading="lazy">'
      : '<i data-wo-icon="image"></i>';

    return '<article class="wo-dash-design">' +
      '<div class="wo-dash-design-media">' + media + '</div>' +
      '<h3 class="wo-dash-design-title">' + esc(designTitle(q)) + '</h3>' +
      '<p class="wo-dash-design-client">' + esc(q.client_full_name || 'Cliente') + '</p>' +
      (pct === null ? '' :
        '<div class="wo-dash-design-track"><div class="wo-dash-design-fill' + (ready ? ' is-ready' : '') +
        '" style="width:' + pct + '%"></div></div>') +
      '<div class="wo-dash-design-foot">' +
        '<span>' + esc(stage) + '</span>' +
        (next ? '<span>PRÓXIMA ' + esc(dayMonth(next)) + '</span>' : '') +
      '</div>' +
    '</article>';
  }
  function renderDesigns(quotes) {
    var sec = $('wod-designs-section'), box = $('wod-designs-grid');
    if (!sec || !box) return;
    var inWork = (quotes || []).filter(function (q) {
      return q.quote_status === 'client_approved' || q.quote_status === 'artist_completed';
    });
    inWork.sort(function (a, b) {
      return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    });
    inWork = inWork.slice(0, 3);
    if (!inWork.length) { sec.hidden = true; return; }

    var paint = function (sessionsByQuote, thumbByQuote) {
      box.innerHTML = inWork.map(function (q) {
        return designCard(q, sessionsByQuote[q.id] || [], thumbByQuote[q.quote_id] || '');
      }).join('');
      sec.hidden = false;
      if (window.WoIcons) window.WoIcons.hydrate(box);
    };

    var ids = inWork.map(function (q) { return q.id; }).filter(function (v) { return v != null; });
    var quoteIds = inWork.map(function (q) { return q.quote_id; }).filter(Boolean);

    var sessionsP = ids.length
      ? withLiveTimeout(WeotziData.Sessions.listByQuotationIds(ids), 'sesiones de diseños')
          .catch(function (e) { console.warn('[redesign] sesiones de diseños', e); return []; })
      : Promise.resolve([]);
    var thumbsP = quoteIds.length
      ? withLiveTimeout(WeotziData.Attachments.listByQuoteIds(quoteIds), 'referencias')
          .catch(function (e) { console.warn('[redesign] referencias', e); return []; })
      : Promise.resolve([]);

    Promise.all([sessionsP, thumbsP]).then(function (res) {
      var byQuote = {};
      (res[0] || []).forEach(function (s) {
        (byQuote[s.quotation_id] = byQuote[s.quotation_id] || []).push(s);
      });
      var thumbs = {};
      (res[1] || []).forEach(function (a) {
        if (thumbs[a.quotation_id]) return;
        var t = driveThumb(a.google_drive_url);
        if (t) thumbs[a.quotation_id] = t;
      });
      paint(byQuote, thumbs);
    });
  }

  /* ===================================================================== *
   *  INGRESOS (rail) — suma real de final_budget_amount de cotizaciones     *
   *  completadas, convertida a la moneda de tarifa del artista.            *
   *  La fecha de cierre sale de client_completed_at / artist_completed_at   *
   *  (los sella el trigger de estado) con updated_at como respaldo para     *
   *  filas cerradas antes de esa migración.                                 *
   *  "SALDO PEND." del Figma se omite: no existe ledger de pagos.           *
   * ===================================================================== */
  var lastQuotes = null;
  function renderIncome(quotes) {
    var sec = $('wod-income');
    if (!sec || !quotes) return;
    var target = String((artist && artist.session_price_currency) || 'USD').toUpperCase();
    var cur = window.WeOtziCurrency;

    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // lunes

    var month = 0, week = 0, counted = 0;
    quotes.forEach(function (q) {
      if (q.quote_status !== 'completed') return;
      var raw = parseFloat(q.final_budget_amount);
      if (!isFinite(raw) || raw <= 0) return;
      var from = String(q.final_budget_currency || target).toUpperCase();
      var value = raw;
      if (from !== target) {
        var conv = cur && typeof cur.convert === 'function' ? cur.convert(raw, from, target) : null;
        if (conv === null || !isFinite(conv)) return; // sin tipo de cambio no inventamos
        value = conv;
      }
      var when = new Date(q.client_completed_at || q.artist_completed_at || q.updated_at || q.created_at);
      if (isNaN(when)) return;
      counted++;
      if (when >= monthStart) month += value;
      if (when >= weekStart) week += value;
    });

    if (!counted) { sec.hidden = true; return; }
    var cap = $('wod-income-cap');
    if (cap) cap.textContent = 'INGRESOS · ' + MONTHS_ES[now.getMonth()];
    var t = $('wod-income-total'); if (t) t.textContent = money(month, target);
    var w = $('wod-income-week'); if (w) w.textContent = money(week, target);
    sec.hidden = false;
  }

  /* ===================================================================== *
   *  GALERÍA — contador + realce del grid que pinta dashboard.js           *
   *  (card destacada 2×2 con bandera ★, caption y cluster de acciones,     *
   *  y la dropzone SUBIR MÁS dentro de la grilla, como en el Figma).       *
   *  Se opera sobre el DOM ya pintado: dashboard.js sigue siendo el dueño  *
   *  del markup y de la persistencia del feed.                             *
   * ===================================================================== */
  var GALLERY_CATEGORIES = [
    ['realizados', 'Trabajos realizados'],
    ['flash', 'Flash disponibles'],
    ['proyectos', 'Proyectos']
  ];
  function galleryFeed() {
    return typeof window.normalizeDashboardGalleryFeedItems === 'function'
      ? window.normalizeDashboardGalleryFeedItems() : null;
  }
  function persistFeed(next) {
    if (typeof window.persistDashboardGalleryFeed !== 'function') return Promise.resolve();
    return Promise.resolve(window.persistDashboardGalleryFeed(next)).then(function () {
      if (typeof window.renderGalleryAdmin === 'function') window.renderGalleryAdmin();
    }).catch(function (e) { console.warn('[redesign] galería', e); });
  }
  // ★ Destacar = mover el archivo al primer lugar del feed (la card 2×2).
  function featureGalleryItem(index) {
    var feed = galleryFeed();
    if (!feed || index <= 0 || index >= feed.length) return;
    var next = feed.slice();
    next.unshift(next.splice(index, 1)[0]);
    persistFeed(next);
  }
  // ✎ Editar = cambiar la categoría del archivo (único metadato editable).
  function openCategoryEditor(item, index) {
    if (item.querySelector('.wod-gal-catsel')) return;
    var feed = galleryFeed();
    if (!feed || !feed[index]) return;
    var sel = document.createElement('select');
    sel.className = 'wod-gal-catsel';
    sel.setAttribute('aria-label', 'Categoría del archivo');
    GALLERY_CATEGORIES.forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0]; o.textContent = pair[1];
      sel.appendChild(o);
    });
    sel.value = feed[index].category || 'realizados';
    sel.addEventListener('click', function (e) { e.stopPropagation(); });
    sel.addEventListener('change', function (e) {
      e.stopPropagation();
      var next = galleryFeed();
      if (!next || !next[index]) { sel.remove(); return; }
      next[index] = Object.assign({}, next[index], { category: sel.value });
      persistFeed(next);
    });
    sel.addEventListener('blur', function () { sel.remove(); });
    item.appendChild(sel);
    sel.focus();
  }
  function actionButton(icon, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = '<i data-wo-icon="' + icon + '"></i>';
    return b;
  }
  function enhanceGallery() {
    var grid = $('gallery-admin-grid');
    if (!grid) return;
    var items = grid.querySelectorAll('.gallery-item');
    Array.prototype.forEach.call(items, function (item, i) {
      if (item.getAttribute('data-wod-gal') === '1') return;
      item.setAttribute('data-wod-gal', '1');

      var acts = document.createElement('div');
      acts.className = 'wod-gal-acts';

      var star = actionButton('star', i === 0 ? 'Ya es el trabajo destacado' : 'Destacar este trabajo');
      if (i === 0) {
        star.setAttribute('aria-disabled', 'true');
        star.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
      } else {
        star.addEventListener('click', function (e) { e.stopPropagation(); featureGalleryItem(i); });
      }
      acts.appendChild(star);

      var pen = actionButton('edit-2', 'Cambiar la categoría del archivo');
      pen.addEventListener('click', function (e) { e.stopPropagation(); openCategoryEditor(item, i); });
      acts.appendChild(pen);

      var del = item.querySelector('.gallery-item-delete');
      if (del) acts.appendChild(del);
      item.appendChild(acts);

      if (i === 0) {
        var flag = document.createElement('span');
        flag.className = 'wod-gal-flag';
        flag.setAttribute('aria-hidden', 'true');
        flag.textContent = '★';
        item.appendChild(flag);

        var badge = item.querySelector('.gallery-category-badge');
        var cap = document.createElement('div');
        cap.className = 'wod-gal-caption';
        cap.innerHTML = '<span class="wod-gal-captxt">' +
          esc(((badge && badge.textContent) || 'Trabajo') + ' — destacado') + '</span>';
        item.appendChild(cap);
      }
    });

    // dashboard.js emite un slot vacío por hueco libre; el Figma dibuja una
    // sola dropzone "SUBIR MÁS" (el resto se oculta por CSS).
    var slot = grid.querySelector('.gallery-item-slot');
    if (slot && slot.getAttribute('data-wod-gal') !== '1') {
      slot.setAttribute('data-wod-gal', '1');
      slot.removeAttribute('aria-hidden');
      slot.setAttribute('role', 'button');
      slot.setAttribute('tabindex', '0');
      slot.setAttribute('aria-label', 'Subir más archivos');
      slot.innerHTML = '<i data-wo-icon="image"></i><span class="wo-meta-s">SUBIR MÁS</span>';
      var pick = function (e) {
        e.stopPropagation();
        var input = $('gallery-input');
        if (input) input.click();
      };
      slot.addEventListener('click', pick);
      slot.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); }
      });
    }

    if (window.WoIcons) window.WoIcons.hydrate(grid);
  }
  var galleryWatched = false;
  function watchGalleryCount() {
    var grid = $('gallery-admin-grid'), out = $('wod-gallery-count');
    if (!grid || galleryWatched) return;
    galleryWatched = true;
    var apply = function () {
      if (out) out.textContent = '— ' + grid.querySelectorAll('.gallery-item').length;
      enhanceGallery();
    };
    apply();
    try { new MutationObserver(apply).observe(grid, { childList: true }); } catch (e) { /* opcional */ }
  }

  /* ---- Botón IMPORTAR INSTAGRAM (lo monta instagram-import.js) ---------- */
  /* El componente compartido inyecta un ícono de Font Awesome, que esta página
     no carga, y el label "Importar desde Instagram". El Figma pide el glifo
     Feather y "IMPORTAR INSTAGRAM": se normaliza acá, sin tocar el módulo. */
  function enhanceIgTrigger() {
    var mount = $('ig-import-mount-dashboard');
    if (!mount) return;
    var btn = mount.querySelector('.ig-import-trigger');
    if (!btn || btn.getAttribute('data-wod-ig') === '1') return;
    btn.setAttribute('data-wod-ig', '1');
    btn.innerHTML = '<i data-wo-icon="instagram"></i><span>IMPORTAR INSTAGRAM</span>';
    if (window.WoIcons) window.WoIcons.hydrate(btn);
  }
  var igWatched = false;
  function watchIgTrigger() {
    var mount = $('ig-import-mount-dashboard');
    if (!mount || igWatched) return;
    igWatched = true;
    enhanceIgTrigger();
    try { new MutationObserver(enhanceIgTrigger).observe(mount, { childList: true }); } catch (e) { /* opcional */ }
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
    watchIgTrigger();
    watchStylesWord();
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

  // El catálogo de monedas carga async: cuando llega (o cuando el usuario
  // cambia la moneda de visualización) se recalcula INGRESOS con los mismos
  // datos ya cargados, sin volver a consultar.
  document.addEventListener('weotzi:currencies-loaded', function () { renderIncome(lastQuotes); });
  document.addEventListener('weotzi:currency-changed', function () { renderIncome(lastQuotes); });

  // El hero (fecha/saludo) y el panel Ö no dependen de datos: apenas el DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wireNotifPanel();
      watchIgTrigger();
      watchStylesWord();
      if (!booted) renderHero();
    });
  } else {
    wireNotifPanel();
    watchIgTrigger();
    watchStylesWord();
    if (!booted) renderHero();
  }
})();
