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
  var supplementalActivity = [];
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
  function dashboardConfig() {
    var config = artist && artist.dashboard_config;
    if (!config) return {};
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch (e) { return {}; }
    }
    return config && typeof config === 'object' ? config : {};
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
  // Figma 24:1424 y regla 10 del DS: simbolo adelante y numeros europeos
  // (4.820). Intl con locale es-AR devuelve "4820 US$", que no es el formato
  // del sistema, asi que se arma a mano con el simbolo de la moneda.
  function money(amount, code) {
    var n = Math.round(Number(amount) || 0).toLocaleString('es-AR');
    var symbol = String.fromCharCode(36);
    var c = window.WeOtziCurrency;
    try {
      if (c && typeof c.get === 'function') {
        var meta = c.get(code);
        if (meta && meta.symbol) symbol = meta.symbol;
      }
    } catch (e) { /* simbolo por defecto */ }
    return symbol + n;
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
    // Figma 24:1425: "LAUUMARTH" en el título y "@lauumarth.wo" aparte; el
    // sufijo .wo del username no va en mayúsculas en el nombre.
    var name = String(artist.username || artist.name || 'Tu perfil').replace(/^@/, '').replace(/\.wo$/i, '');
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
    // 'rescheduled' y 'no_show' son estados reales de quotation_sessions: sin
    // esto caian al fallback y se mostraban crudos en ingles.
    if (s === 'pending' || s === 'tentative' || s === 'pending_confirmation' || s === 'rescheduled') return { cls: 'is-warn', txt: 'POR CONFIRMAR' };
    if (s === 'no_show') return { cls: 'is-warn', txt: 'NO ASISTIÓ' };
    return { cls: 'is-warn', txt: (status || 'POR CONFIRMAR').toString().toUpperCase() };
  }
  // "Sesión 2/3" (Figma 24:1425); sin número, "Sesión"; sin total, "Sesión 2".
  function sessionLabel(number, total) {
    var n = parseInt(number, 10);
    var t = parseInt(total, 10);
    if (!isFinite(n) || n <= 0) return 'Sesión';
    return 'Sesión ' + n + (isFinite(t) && t >= n && t > 1 ? '/' + t : '');
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
      'quotations_db(quote_id, client_full_name, tattoo_style, tattoo_body_part, final_sessions, tattoo_estimated_sessions)';
    return WeotziData.Sessions.listUpcomingForArtist(nowIso, { limit: 30, select: cols })
      .catch(function (e) {
        console.warn('[redesign] agenda sin duration_hours', e);
        return WeotziData.Sessions.listUpcomingForArtist(nowIso, { limit: 30 });
      });
  }
  // Ronda 3 (P11): eventos propios del calendario (artist_calendar_events) de
  // hoy, con repeticiones semanales expandidas por calendar-repo.js. Si el repo
  // no está o la consulta falla, la agenda sigue solo con los turnos.
  function fetchTodayEvents() {
    var C = window.WeotziData && window.WeotziData.Calendar;
    if (!C || typeof C.listManualRange !== 'function' || !user) return Promise.resolve([]);
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return withLiveTimeout(C.listManualRange(user.id, start, end), 'eventos del calendario')
      .catch(function (e) { console.warn('[redesign] eventos del calendario', e); return []; });
  }
  function agendaRowHtml(item, now) {
    var LM = window.DashboardLiveModel;
    var t = LM.agendaTime(item, now);
    var dur = durationLabel(item.durationHours);
    var tag = item.href ? 'a' : 'div';
    return '<' + tag + ' class="wo-dash-agendarow' + (item.kind === 'event' ? ' is-own-event' : '') + '"' +
        (item.href ? ' href="' + esc(item.href) + '"' : '') + '>' +
      '<div class="wo-dash-agendatime">' +
        '<span class="wo-dash-agendahour">' + esc(t.hour) + '</span>' +
        (t.day ? '<span class="wo-dash-agendaday">' + esc(t.day) + '</span>' : '') +
      '</div>' +
      '<div class="wo-dash-agendabody">' +
        '<div class="wo-dash-agendawho">' + esc(item.who) + '</div>' +
        '<div class="wo-dash-agendadetail">' + esc(item.detail) + '</div>' +
      '</div>' +
      '<div class="wo-dash-agendameta">' +
        '<span class="wo-dash-state ' + item.state.cls + '">' + esc(item.state.txt) + '</span>' +
        (dur ? '<span class="wo-dash-agendadur">' + esc(dur) + '</span>' : '') +
      '</div>' +
    '</' + tag + '>';
  }
  function loadAgenda() {
    // Desde el inicio del día: un turno de esta mañana ya pasado sigue siendo
    // parte de la "Agenda del día".
    var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    var sessionsP = withLiveTimeout(fetchAgendaRows(dayStart.toISOString()), 'agenda');
    return Promise.all([sessionsP, fetchTodayEvents()])
      .then(function (res) {
        var rows = res[0];
        var events = res[1] || [];
        rows = (rows || []).filter(function (s) { return String(s.status || '').toLowerCase() !== 'cancelled'; });
        var agendaIds = dashboardConfig().dashboard_demo_quote_ids;
        if (Array.isArray(agendaIds) && agendaIds.length) {
          var allowedAgenda = {};
          agendaIds.forEach(function (id) { allowedAgenda[String(id)] = true; });
          rows = rows.filter(function (s) {
            return allowedAgenda[String((s.quotations_db || {}).quote_id)];
          });
        }
        var now = new Date();
        var LM = window.DashboardLiveModel;
        var agenda = LM.mergeAgenda(rows, events, now, function (v) { return styleList(v)[0]; });
        todaySessions = agenda.todayCount;
        renderHero();

        // El Figma define un único título para el bloque; las filas ya llevan
        // el chip de día cuando el turno no es de hoy.
        var cap = $('wod-agenda-cap');
        if (cap) cap.textContent = 'Agenda del día';

        var box = $('wod-agenda-rows'); if (!box) return agenda.items.length;
        if (!agenda.items.length) {
          box.innerHTML = '<div class="wod-empty">Sin turnos próximos · <a href="/calendar">abrir calendario →</a></div>';
          return 0;
        }
        // "Agenda del día" muestra turnos y eventos propios de hoy; si la
        // agenda está libre, mantiene el próximo turno como orientación útil.
        var shown = agenda.items.slice(0, 6);
        var more = agenda.items.length - shown.length;
        box.innerHTML = shown.map(function (item) { return agendaRowHtml(item, now); }).join('') +
          (more > 0 ? '<a class="wod-agenda-more" href="/calendar">+ ' + more + ' más en tu calendario →</a>' : '');
        return agenda.items.length;
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
  /* Actividad reciente (P14, ronda 3): cotizaciones + turnos + reseñas +
     fuentes registradas por otros módulos con
     WeotziData.DashboardActivity.registerSource (punto de extensión para
     "Pago recibido", grupo pagos). La lógica pura vive en
     dashboard-live-model.js. user_preferences.dashboard_activity queda solo
     para la cuenta demo (dashboard_demo_marker). */
  var extraActivity = { sessions: [], reviews: [], sources: [] };
  function activityEvent(q) { return window.DashboardLiveModel.quoteActivity(q); }
  function supplementalActivityEvent(item) { return window.DashboardLiveModel.externalActivity(item); }
  function reviewsHref() {
    var username = artist && String(artist.username || '').replace(/^@/, '').trim();
    return username ? '/artist/profile?artist=' + encodeURIComponent(username) + '#artist-reviews-panel' : null;
  }
  function renderActivity(quotes) {
    var sec = $('wod-activity-section'), list = $('wod-activity-list');
    if (!sec || !list) return;
    var LM = window.DashboardLiveModel;
    var demoActivityOnly = Boolean(dashboardConfig().dashboard_demo_marker && supplementalActivity.length);
    var events = demoActivityOnly
      ? LM.mergeActivity([supplementalActivity.map(supplementalActivityEvent)], 4)
      : LM.mergeActivity([
          (quotes || []).map(activityEvent),
          extraActivity.sessions,
          extraActivity.reviews,
          extraActivity.sources.map(supplementalActivityEvent),
          (supplementalActivity || []).map(supplementalActivityEvent)
        ], 4);
    if (!events.length) { sec.hidden = true; return; }
    sec.hidden = false;
    list.innerHTML = events.map(function (ev) {
      var tag = ev.href ? 'a' : 'div';
      return '<' + tag + ' class="wo-dash-activityrow"' + (ev.href ? ' href="' + esc(ev.href) + '"' : '') + '>' +
        '<i data-wo-icon="' + esc(ev.icon) + '" class="wo-icon-18"></i>' +
        '<span class="wo-dash-activitytxt">' + esc(ev.txt) + '</span>' +
        '<span class="wo-dash-activitywhen">' + esc(timeAgo(ev.when)) + '</span>' +
      '</' + tag + '>';
    }).join('');
    if (window.WoIcons) window.WoIcons.hydrate(list);
  }
  // Turnos y reseñas recientes + fuentes registradas. Cada parte degrada sola.
  function loadExtraActivity(quotes) {
    var A = window.WeotziData && window.WeotziData.DashboardActivity;
    var LM = window.DashboardLiveModel;
    if (!A || !LM || !user) return Promise.resolve();
    var since = LM.activitySince(new Date());
    var byId = {};
    (quotes || []).forEach(function (q) { if (q && q.id != null) byId[q.id] = q; });
    var ids = Object.keys(byId).map(Number);
    var sessionsP = withLiveTimeout(A.listRecentSessions(ids, since), 'actividad · turnos')
      .then(function (rows) {
        extraActivity.sessions = (rows || []).map(function (s) { return LM.sessionActivity(s, byId, since); }).filter(Boolean);
      })
      .catch(function (e) { console.warn('[redesign] actividad · turnos', e); });
    var reviewsP = withLiveTimeout(A.listRecentReviews(user.id, since), 'actividad · reseñas')
      .then(function (rows) {
        var href = reviewsHref();
        extraActivity.reviews = (rows || []).map(function (r) { return LM.reviewActivity(r, href); }).filter(Boolean);
      })
      .catch(function (e) { console.warn('[redesign] actividad · reseñas', e); });
    return Promise.all([sessionsP, reviewsP, loadActivitySources(quotes, since)])
      .then(function () { renderActivity(lastQuotes); });
  }
  function loadActivitySources(quotes, since) {
    var A = window.WeotziData && window.WeotziData.DashboardActivity;
    if (!A || typeof A.loadSources !== 'function' || !user) return Promise.resolve();
    return withLiveTimeout(A.loadSources({ artistId: user.id, quotes: quotes || [], since: since }), 'actividad · fuentes')
      .then(function (items) { extraActivity.sources = items || []; })
      .catch(function (e) { console.warn('[redesign] actividad · fuentes', e); });
  }
  document.addEventListener('weotzi:dashboard-activity-refresh', function () {
    if (!user || !window.DashboardLiveModel) return;
    loadActivitySources(lastQuotes, window.DashboardLiveModel.activitySince(new Date()))
      .then(function () { renderActivity(lastQuotes); });
  });
  function loadCotizaciones() {
    return withLiveTimeout(WeotziData.Quotations.listForArtist(user.id, { limit: 60 }), 'cotizaciones')
      .then(function (rows) {
        var quotes = (rows || []).filter(function (q) { return !q.is_archived; });
        var demoIds = dashboardConfig().dashboard_demo_quote_ids;
        if (Array.isArray(demoIds) && demoIds.length) {
          var visible = {};
          demoIds.forEach(function (id) { visible[String(id)] = true; });
          quotes = quotes.filter(function (q) { return visible[String(q.quote_id)]; });
        }
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
        lastQuotes = quotes;
        renderActivity(quotes);
        loadExtraActivity(quotes);
        renderDesigns(quotes);
        renderIncome(quotes);
        loadIncomePayments();
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
   *  "LÍMITE <fecha>":                                                      *
   *    · etapa   → quotations_db.design_stage (editable en la tarjeta);     *
   *                sin cargar, el estado real (CONFIRMADA / LISTA…)         *
   *    · avance  → sesiones completadas / sesiones totales                  *
   *    · fecha   → LÍMITE design_due_date o PRÓXIMA sesión agendada         *
   *  La imagen es la primera referencia adjunta del cliente; si no hay,     *
   *  queda el placeholder de la caja que dibuja el Figma.                   *
   * ===================================================================== */
  var lastDesignPaint = null;
  // P12: abre el editor de etapa (design-stage-editor.js) y repinta la tarjeta
  // con lo guardado, sin volver a consultar todo el dashboard.
  function wireDesignStage(box) {
    if (box.__woStageWired) return;
    box.__woStageWired = true;
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-design-stage]');
      if (!btn) return;
      e.preventDefault();
      var id = btn.getAttribute('data-design-stage');
      var q = (lastQuotes || []).filter(function (x) { return String(x.id) === String(id); })[0];
      if (!q || !window.DesignStageEditor) return;
      window.DesignStageEditor.open({
        quote: q,
        title: designTitle(q),
        trigger: btn,
        onSaved: function (saved) {
          q.design_stage = saved.design_stage;
          q.design_due_date = saved.design_due_date;
          if (lastDesignPaint) {
            box.innerHTML = lastDesignPaint.quotes.map(function (x) {
              return designCard(x, lastDesignPaint.sessions[x.id] || [], lastDesignPaint.thumbs[x.quote_id] || '');
            }).join('');
            if (window.WoIcons) window.WoIcons.hydrate(box);
            var again = box.querySelector('[data-design-stage="' + String(id).replace(/"/g, '') + '"]');
            if (again) again.focus();
          }
        }
      });
    });
  }
  function designTitle(q) {
    if (q.project_description) return String(q.project_description).trim();
    var parts = [];
    var style = styleList(q.tattoo_style)[0];
    if (style) parts.push(String(style).trim());
    if (q.tattoo_body_part) parts.push(String(q.tattoo_body_part).trim());
    if (parts.length) return parts.join(' · ');
    return q.quote_id ? 'Cotización ' + q.quote_id : 'Cotización';
  }
  function designClient(name) {
    var parts = String(name || 'Cliente').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || 'Cliente';
    return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
  }
  function designCard(q, sessions, thumb) {
    var now = new Date();
    var live = (sessions || []).filter(function (s) { return String(s.status || '').toLowerCase() !== 'cancelled'; });
    var done = live.filter(function (s) { return String(s.status || '').toLowerCase() === 'completed'; }).length;
    var declared = parseInt(q.final_sessions || q.tattoo_estimated_sessions, 10);
    var total = Math.max(isFinite(declared) ? declared : 0, live.length);
    var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
    var configuredProgress = dashboardConfig().dashboard_design_progress || {};
    var progressOverride = Number(configuredProgress[q.quote_id]);
    if (isFinite(progressOverride)) pct = Math.max(0, Math.min(100, progressOverride));

    // Ronda 3 (P12): la etapa (BOCETO / ENTINTADO / FINAL) y la fecha LÍMITE
    // salen de quotations_db.design_stage / design_due_date, que el artista
    // edita desde la tarjeta (design-stage-editor.js). Sin etapa cargada se
    // muestra el estado real de la cotización; sin límite, la próxima sesión.
    // Color de la barra por etapa (Figma 24:1425): is-boceto azul,
    // is-entintado amarillo, is-final / lista para el cliente verde.
    var LM = window.DashboardLiveModel;
    var info = LM.designStageInfo(q);
    var ready = q.quote_status === 'artist_completed';
    var deadline = LM.designDeadline(q, live, now);
    var href = q.quote_id ? '/my-quotations/detail?id=' + encodeURIComponent(q.quote_id) : '';
    var title = designTitle(q);

    var media = thumb
      ? '<img src="' + esc(thumb) + '" alt="" loading="lazy">'
      : '<i data-wo-icon="image"></i>';

    // P13: la tarjeta lleva al detalle. El título es el link y su ::after cubre
    // la tarjeta (sin anidar el botón de etapa dentro del <a>).
    return '<article class="wo-dash-design' + (href ? ' is-linked' : '') + '" data-quote-id="' + esc(q.quote_id || '') + '">' +
      '<div class="wo-dash-design-media">' + media + '</div>' +
      '<h3 class="wo-dash-design-title">' +
        (href ? '<a class="wo-dash-design-link" href="' + esc(href) + '">' + esc(title) + '</a>' : esc(title)) +
      '</h3>' +
      '<p class="wo-dash-design-client">' + esc(designClient(q.client_full_name)) + '</p>' +
      (pct === null ? '' :
        '<div class="wo-dash-design-track"><div class="wo-dash-design-fill' + (ready ? ' is-ready' : '') + info.cls +
        '" style="width:' + pct + '%"></div></div>') +
      '<div class="wo-dash-design-foot">' +
        (info.editable && q.id != null
          ? '<button type="button" class="wo-dash-design-stage" data-design-stage="' + esc(q.id) + '"' +
              ' aria-label="Editar etapa y fecha límite de ' + esc(title) + ' (etapa actual: ' + esc(info.label.toLowerCase()) + ')">' +
              '<span>' + esc(info.label) + '</span><i data-wo-icon="edit-2" aria-hidden="true"></i></button>'
          : '<span>' + esc(info.label) + '</span>') +
        (deadline
          ? '<span class="' + (deadline.overdue ? 'is-overdue' : '') + '">' + esc(deadline.label) + ' ' + esc(dayMonth(deadline.date)) + '</span>'
          : '') +
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
    var preferredDesigns = dashboardConfig().dashboard_demo_design_quote_ids;
    if (Array.isArray(preferredDesigns) && preferredDesigns.length) {
      var order = {};
      preferredDesigns.forEach(function (id, index) { order[String(id)] = index; });
      inWork = inWork.filter(function (q) { return order[String(q.quote_id)] != null; });
      inWork.sort(function (a, b) { return order[String(a.quote_id)] - order[String(b.quote_id)]; });
    }
    inWork = inWork.slice(0, 3);
    if (!inWork.length) { sec.hidden = true; return; }

    var paint = function (sessionsByQuote, thumbByQuote) {
      lastDesignPaint = { sessions: sessionsByQuote, thumbs: thumbByQuote, quotes: inWork };
      box.innerHTML = inWork.map(function (q) {
        return designCard(q, sessionsByQuote[q.id] || [], thumbByQuote[q.quote_id] || '');
      }).join('');
      sec.hidden = false;
      if (window.WoIcons) window.WoIcons.hydrate(box);
      wireDesignStage(box);
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
   *  Con quotation_payments (grupo pagos) INGRESOS y "SALDO PEND." salen   *
   *  de WoPaymentsModel.income / dashboardDue (pagos registrados + cerradas *
   *  sin pagos; acordado − cobrado). Sin la tabla, el cálculo por estado.   *
   * ===================================================================== */
  var lastQuotes = [];
  var lastPayments = null; // null = ledger de pagos no disponible / sin cargar
  // Estados con trabajo comprometido y cobro pendiente.
  var PENDING_PAYMENT_STATUSES = ['client_approved', 'in_progress', 'artist_completed'];
  // ── integracion ── carga los pagos registrados y repinta INGRESOS.
  function loadIncomePayments() {
    var R = window.WeotziData && window.WeotziData.QuotationPayments;
    var M = window.WoPaymentsModel;
    if (!R || !M || !user) return Promise.resolve();
    return withLiveTimeout(Promise.resolve(R.isAvailable()).then(function (ok) {
      if (!ok) return null;
      return R.listForArtist(user.id, { limit: 500 });
    }), 'ingresos · pagos')
      .then(function (rows) {
        var list = rows ? rows.map(M.normalize) : null;
        // Cuenta demo: solo los pagos de las cotizaciones visibles.
        var demoIds = dashboardConfig().dashboard_demo_quote_ids;
        if (list && Array.isArray(demoIds) && demoIds.length) {
          var seen = {};
          (lastQuotes || []).forEach(function (q) { seen[String(q.id)] = true; });
          list = list.filter(function (p) { return seen[String(p.quotationId)]; });
        }
        lastPayments = list;
        renderIncome(lastQuotes);
      })
      .catch(function (e) { console.warn('[redesign] ingresos · pagos', e); });
  }
  document.addEventListener('weotzi:payments-changed', function () { loadIncomePayments(); });
  function renderIncome(quotes) {
    var sec = $('wod-income');
    if (!sec || !quotes) return;
    var target = String((artist && artist.session_price_currency) || 'USD').toUpperCase();
    var cur = window.WeOtziCurrency;
    var PM = window.WoPaymentsModel;
    if (PM && lastPayments) {
      var conv = cur && typeof cur.convert === 'function' ? function (a, f, t) { return cur.convert(a, f, t); } : null;
      var inc = PM.income(quotes, lastPayments, target, conv, new Date());
      var dueP = PM.dashboardDue(quotes, lastPayments, target, conv);
      if (!inc.counted && !dueP) { sec.hidden = true; return; }
      var capP = $('wod-income-cap');
      if (capP) capP.textContent = 'INGRESOS · ' + MONTHS_ES[new Date().getMonth()];
      var tP = $('wod-income-total'); if (tP) tP.textContent = money(inc.month, target);
      var wP = $('wod-income-week'); if (wP) wP.textContent = money(inc.week, target);
      var dP = $('wod-income-due'); if (dP) dP.textContent = money(dueP, target);
      sec.hidden = false;
      return;
    }

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
    // Saldo pendiente: trabajo cerrado con precio pactado y todavia sin cobrar.
    var due = 0;
    quotes.forEach(function (q) {
      if (PENDING_PAYMENT_STATUSES.indexOf(q.quote_status) === -1) return;
      var rawDue = parseFloat(q.final_budget_amount || q.artist_budget_amount);
      if (!isFinite(rawDue) || rawDue <= 0) return;
      var fromDue = String(q.final_budget_currency || q.artist_budget_currency || target).toUpperCase();
      var valDue = rawDue;
      if (fromDue !== target) {
        var cDue = cur && typeof cur.convert === 'function' ? cur.convert(rawDue, fromDue, target) : null;
        if (cDue === null || !isFinite(cDue)) return;
        valDue = cDue;
      }
      due += valDue;
    });
    var d = $('wod-income-due'); if (d) d.textContent = money(due, target);
    sec.hidden = false;
  }

  /* ===================================================================== *
   *  GALERÍA — la grilla del Figma 2003:862 (nombre + papelera por celda,  *
   *  insignias VIDEO / NUEVO · IG, dropzone SUBIR MÁS · N LIBRES, ★ para   *
   *  destacar y arrastrar para reordenar) la pinta dashboard-gallery.js    *
   *  desde renderGalleryAdmin(). Acá solo queda el contador "— N" como     *
   *  respaldo si la grilla cambia por otra vía.                            *
   * ===================================================================== */
  var galleryWatched = false;
  function watchGalleryCount() {
    var grid = $('gallery-admin-grid'), out = $('wod-gallery-count');
    if (!grid || galleryWatched) return;
    galleryWatched = true;
    var apply = function () {
      if (out) out.textContent = '— ' + grid.querySelectorAll('.gallery-item').length;
    };
    apply();
    try { new MutationObserver(apply).observe(grid, { childList: true }); } catch (e) { /* opcional */ }
  }

  /* El botón IMPORTAR INSTAGRAM lo monta instagram-import.js con el label y
     el glifo del Figma (opción triggerLabel que pasa dashboard.js). */
  function watchIgTrigger() { /* sin override: ver instagram-import.js */ }

  /* El dropdown del tile Ö y el panel de notificaciones viven ahora en el
   * componente compartido /shared/js/wo-artist-menu.js (Figma 167:24120 y
   * 167:23251), disponible en todas las páginas del artista. */

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
  /* ===================================================================== *
   *  ACTIVIDAD COMPLEMENTARIA + LINKS DEL RAIL (Figma 24:1425)             *
   *  Los recordatorios ahora los maneja dashboard-reminders.js (tabla      *
   *  artist_reminders). Acá solo queda la actividad extra que vive en      *
   *  user_preferences.app_settings.dashboard_activity.                     *
   * ===================================================================== */
  function loadActivityPrefs() {
    var P = window.WeotziData && window.WeotziData.Prefs;
    if (!P || typeof P.get !== 'function' || !user) return;
    withLiveTimeout(P.get(user.id), 'actividad')
      .then(function (row) {
        var app = (row && row.app_settings) || {};
        supplementalActivity = app.dashboard_activity || [];
        renderActivity(lastQuotes);
      })
      .catch(function (e) { console.warn('[redesign] actividad', e); });
  }

  // Link del rail que depende del username: perfil público. "Nuevo cliente" y
  // "Nueva cita" van a la cotización manual (/my-quotations/new?origen=…).
  function wireRailLinks() {
    var username = artist && String(artist.username || '').replace(/^@/, '').trim();
    if (!username) return;
    var pub = $('wod-profile-public');
    if (pub) pub.href = '/artist/profile?artist=' + encodeURIComponent(username);
  }

  function boot(detail) {
    sb = detail.supabase || window._supabase;
    user = detail.currentUser;
    artist = detail.artistData || null;

    if (dashboardConfig().dashboard_demo_marker) {
      document.body.classList.add('wod-figma-demo');
    }

    renderHero();
    watchGalleryCount();
    watchIgTrigger();
    watchStylesWord();

    if (!sb || !user) { console.warn('[redesign] missing supabase/user; aborting live layer'); return; }

    renderProfileCard();
    wireRailLinks();
    loadActivityPrefs();
    setTimeout(clearStaleLoadingStates, LIVE_QUERY_TIMEOUT_MS + 500);
    loadAgenda();
    loadCotizaciones();
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

  // El hero (fecha/saludo) no depende de datos: apenas el DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      watchIgTrigger();
      watchStylesWord();
      if (!booted) renderHero();
    });
  } else {
    watchIgTrigger();
    watchStylesWord();
    if (!booted) renderHero();
  }
})();
