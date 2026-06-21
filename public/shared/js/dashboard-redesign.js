/* ============================================================================
   WE ÖTZI — Dashboard "V2 Flow" redesign · live data layer
   ----------------------------------------------------------------------------
   Layered AFTER dashboard.js. dashboard.js still owns auth, the legacy
   (hidden) profile form, gallery admin, banner, QR/password/verification
   modals and milestone tracking. This file ONLY renders the new visible
   surfaces and feeds them with real Supabase data:

     · slim profile card        ← artistData (from wo:dashboard-ready)
     · 15s hero carousel        ← real pending/agenda/spots/visits
     · KPI stat strip           ← real quotes + applications + visitors mirror
     · live Cotizaciones table  ← quotations_db
     · live Agenda table        ← quotation_sessions ⋈ quotations_db
     · live Job Board spots     ← studio_spots ⋈ studios/location (style match)
     · Próximos pasos           ← ONBOARDING_MILESTONES booleans on artistData

   Defensive by design: every query is wrapped, schemas are read with
   fallbacks, and any failing section degrades to a "go to full page" CTA
   instead of breaking the dashboard.
   ============================================================================ */
(function () {
  'use strict';

  var sb = null;          // supabase client (from dashboard.js)
  var user = null;        // currentUser (auth user; .id == artist_id)
  var artist = null;      // artistData row (artists_db)
  var quotes = [];        // cached quotations for tab filtering
  var heroState = { slides: [], idx: 0, timer: null };
  var LIVE_QUERY_TIMEOUT_MS = 8000;

  /* ---------- tiny helpers --------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function firstChar(s) { s = (s || '').trim(); return s ? s[0].toUpperCase() : '?'; }

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
      if (t[0] === '[' || t[0] === '{') { try { var p = JSON.parse(t); return Array.isArray(p) ? p.filter(Boolean) : [t]; } catch (e) { /* fall through */ } }
      return t.split(/[,;|]/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return [];
  }
  function moneyFmt(amount, currency) {
    if (amount == null || amount === '') return null;
    var n = Number(amount); if (isNaN(n)) return null;
    return n.toLocaleString('es-AR') + (currency ? ' ' + currency : '');
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
  function replaceLoadingState(id, html) {
    var el = $(id);
    if (!el) return;
    if (/Cargando/i.test(el.textContent || '')) el.innerHTML = html;
  }
  function clearStaleLoadingStates() {
    replaceLoadingState('wod-cotiz-rows', '<div class="wod-empty">Sin cotizaciones visibles · <a href="/my-quotations">abrir panel →</a></div>');
    replaceLoadingState('wod-agenda-rows', '<div class="wod-empty">Sin turnos visibles · <a href="/calendar">abrir calendario →</a></div>');
    replaceLoadingState('wod-jobs-grid', '<div class="wod-empty" style="grid-column:1/-1;">Sin spots visibles · <a href="/studio-spots">ver job board →</a></div>');
  }

  /* ===================================================================== *
   *  SLIM PROFILE CARD                                                     *
   * ===================================================================== */
  function renderProfileCard() {
    if (!artist) return;
    var name = artist.username || artist.name || 'Tu perfil';
    var rawUsername = String(artist.username || '').replace(/^@/, '').trim();
    var handle = rawUsername
      ? '@' + (rawUsername.toLowerCase().endsWith('.wo') ? rawUsername : rawUsername + '.wo')
      : '@usuario.wo';
    var full = artist.name || artist.full_name || '—';
    var nm = $('artist-name'); if (nm) nm.textContent = (name || '').toUpperCase();
    var un = $('artist-username'); if (un) un.textContent = handle;
    var fn = $('wod-profile-fullname'); if (fn) fn.textContent = full;

    var avatar = artist.profile_picture || artist.avatar_url || '';
    var img = $('avatar-image'), ph = $('avatar-placeholder');
    if (avatar && img) { img.src = avatar; img.style.display = 'block'; if (ph) ph.style.display = 'none'; }

    // years of experience
    var exp = artist.years_experience || artist.experience || artist.experiencia;
    var expTxt = exp ? (String(exp).indexOf('10') === 0 || String(exp).indexOf('+') > -1 ? '10+' : String(exp).split('-')[0] || String(exp)) : '—';
    var se = $('stat-experience'); if (se) se.textContent = expTxt;

    var styles = styleList(artist.styles_array || artist.styles || artist.estilos);
    var ss = $('stat-styles'); if (ss) ss.textContent = styles.length || '—';

    var price = moneyFmt(artist.session_price, artist.session_price_currency || artist.currency);
    var sp = $('stat-price');
    if (sp) { sp.textContent = price || '—'; sp.classList.toggle('stat__value--red', !price); }

    // badges
    var vstate = artist.verification_state || 'No';
    var vbadge = $('verification-badge'), vtext = $('verification-text');
    if (vbadge) {
      vbadge.style.display = '';
      var verified = (vstate === 'Yes' || vstate === 'Verified');
      vbadge.className = 'pill ' + (verified ? 'pill--blue' : 'pill--red') + ' verification-badge';
      if (vtext) vtext.textContent = verified ? 'VERIFICADO' : 'NO VERIFICADO';
    }
    var lvl = $('level-text');
    if (lvl) lvl.textContent = (artist.artist_level || artist.level || 'Nuevo').toString().toUpperCase();
    if (String(artist.embajador || '').toLowerCase() === 'si' || artist.embajador === true) {
      var eb = $('embajador-badge'); if (eb) eb.style.display = '';
    }
  }

  /* ===================================================================== *
   *  PRÓXIMOS PASOS  (real ONBOARDING_MILESTONES on artistData)            *
   * ===================================================================== */
  function renderNextSteps() {
    var list = $('wod-steps-list'); if (!list || !artist) return;
    // Mirror dashboard.js ONBOARDING_MILESTONES + conversion-framed copy.
    var tasks = [
      { f: 'ms_first_quote_received', t: 'Respondé tus cotizaciones pendientes',
        h: 'Responder en <24 h sube tu tasa de conversión', href: '/my-quotations', red: true },
      { f: 'ms_profile_complete', t: 'Completá tu perfil',
        h: 'Los perfiles completos reciben 2.4× más cotizaciones', href: '/artist/profile/details' },
      { f: 'ms_whatsapp_shared', t: 'Compartí tu enlace de WhatsApp',
        h: 'El contacto directo cierra más sesiones', href: '/artist/profile/details' },
      { f: 'ms_profile_shared', t: 'Compartí tu perfil público',
        h: 'Más visitas = más pedidos de cotización', href: '/artist/profile/details' }
    ];
    var done = 0;
    var html = tasks.map(function (k) {
      var ok = !!(artist[k.f]);
      if (ok) done++;
      var cls = 'wod-step' + (ok ? ' is-completed' : (k.red ? ' wod-step--red' : ''));
      return '<a class="' + cls + '" href="' + k.href + '">' +
        '<span class="wod-step__box"></span>' +
        '<span class="wod-step__txt"><span class="wod-step__t">' + esc(k.t) + '</span>' +
        '<span class="wod-step__h">' + esc(k.h) + '</span></span>' +
        '<span class="wod-step__arrow">→</span></a>';
    }).join('');
    list.innerHTML = html;
    var meta = $('wod-steps-meta'); if (meta) meta.textContent = done + ' / ' + tasks.length + ' COMPLETADAS';
    var fill = $('wod-steps-fill'); if (fill) fill.style.width = Math.round(done / tasks.length * 100) + '%';
  }

  /* ===================================================================== *
   *  COTIZACIONES  (live · quotations_db)                                  *
   * ===================================================================== */
  function statusPill(st) {
    var s = String(st || '').toLowerCase();
    if (s === 'pending') return { cls: 'pill--red', txt: 'PENDIENTE' };
    if (s === 'responded') return { cls: 'pill--ink', txt: 'RESPONDIDA' };
    if (s === 'client_approved' || s === 'completed') return { cls: 'pill--blue', txt: 'APROBADA' };
    if (s === 'artist_completed') return { cls: 'pill--ink', txt: 'LISTA PARA CLIENTE' };
    if (s === 'client_rejected' || s === 'discarded' || s === 'archived') return { cls: 'pill--outline', txt: 'DESCARTADA' };
    if (s === 'viewed' || s === 'seen') return { cls: 'pill--outline', txt: 'VISTO' };
    return { cls: 'pill--outline', txt: (st || '—').toString().toUpperCase() };
  }
  function quoteMeta(q) {
    var parts = [];
    var styles = styleList(q.tattoo_style); if (styles.length) parts.push(styles.slice(0, 2).join(' / '));
    if (q.tattoo_body_part) parts.push(q.tattoo_body_part);
    if (q.tattoo_size) parts.push(q.tattoo_size);
    return parts.join(' · ');
  }
  function renderCotizaciones(filter) {
    var box = $('wod-cotiz-rows'); if (!box) return;
    var rows = quotes.slice();
    if (filter === 'pending') rows = rows.filter(function (q) { return q.quote_status === 'pending'; });
    else if (filter === 'responded') rows = rows.filter(function (q) { return q.quote_status === 'responded'; });
    rows = rows.slice(0, 6);
    if (!rows.length) {
      box.innerHTML = '<div class="wod-empty">Sin cotizaciones en esta vista · <a href="/my-quotations">ir al panel →</a></div>';
      return;
    }
    box.innerHTML = rows.map(function (q) {
      var name = q.client_full_name || q.client_name || 'Cliente';
      var p = statusPill(q.quote_status);
      var body = q.tattoo_idea_description || q.client_message || q.description || '';
      return '<div class="wod-trow wod-cols-cotiz">' +
        '<div class="wod-avatar-mono">' + esc(firstChar(name)) + '</div>' +
        '<div class="wod-cotiz__who"><div class="wod-cotiz__line1">' +
          '<span class="wod-cotiz__name">' + esc(name) + '</span>' +
          '<span class="wod-cotiz__meta">' + esc(quoteMeta(q)) + '</span></div>' +
          '<div class="wod-cotiz__body">' + esc(body) + '</div></div>' +
        '<div class="wod-cell-mono">' + esc(timeAgo(q.created_at)) + '</div>' +
        '<div><span class="pill ' + p.cls + '">' + p.txt + '</span></div>' +
        '<a class="wbtn wbtn--dark" style="padding:8px 10px;font-size:10px;" href="/my-quotations">RESPONDER →</a>' +
        '</div>';
    }).join('');
  }
  function wireCotizTabs() {
    var tabs = $('wod-cotiz-tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.tabs__tab'); if (!b) return;
      tabs.querySelectorAll('.tabs__tab').forEach(function (t) { t.classList.remove('is-active'); });
      b.classList.add('is-active');
      renderCotizaciones(b.getAttribute('data-cf'));
    });
  }
  function loadCotizaciones() {
    return withLiveTimeout(WeotziData.Quotations.listForArtist(user.id, { limit: 40 }), 'cotizaciones')
      .then(function (rows) {
        quotes = (rows || []).filter(function (q) { return !q.is_archived; });
        var total = quotes.length;
        var pending = quotes.filter(function (q) { return q.quote_status === 'pending'; }).length;
        var resp = quotes.filter(function (q) { return q.quote_status === 'responded'; }).length;
        var setT = function (id, v) { var el = $(id); if (el) el.textContent = v; };
        setT('wod-ct-all', total); setT('wod-ct-pending', pending); setT('wod-ct-resp', resp);
        setT('ws-pending', pending); setT('ws-answered', resp);
        var ph = $('ws-pending-h'); if (ph) ph.textContent = pending ? 'requieren respuesta' : 'al día';
        var ah = $('ws-answered-h'); if (ah) ah.textContent = total ? ('Tasa ' + Math.round(resp / total * 100) + '%') : '—';
        if (pending) {
          var bb = $('wod-bb-cotiz'); if (bb) { bb.textContent = pending; bb.hidden = false; }
          var nb = $('wod-nav-msg-badge'); if (nb) { nb.textContent = pending; nb.hidden = false; }
        }
        renderCotizaciones('pending');
        return { total: total, pending: pending, resp: resp };
      })
      .catch(function (e) {
        console.warn('[redesign] cotizaciones', e);
        var box = $('wod-cotiz-rows');
        if (box) box.innerHTML = '<div class="wod-empty">No se pudieron cargar · <a href="/my-quotations">abrir panel →</a></div>';
        return { total: 0, pending: 0, resp: 0 };
      });
  }

  /* ===================================================================== *
   *  AGENDA  (live · quotation_sessions ⋈ quotations_db)                   *
   * ===================================================================== */
  function dayChip(d) {
    var dt = new Date(d); if (isNaN(dt)) return { d: '—', h: '--:--' };
    var dow = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][dt.getDay()];
    return {
      d: dow + ' ' + String(dt.getDate()).padStart(2, '0'),
      h: String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0')
    };
  }
  function loadAgenda() {
    var nowIso = new Date().toISOString();
    return withLiveTimeout(WeotziData.Sessions.listUpcomingForArtist(nowIso, { limit: 20 }), 'agenda')
      .then(function (rows) {
        // sessions are only the artist's via RLS / the quotation join; filter defensively
        rows = (rows || []).filter(function (s) { return s.status !== 'cancelled'; }).slice(0, 5);
        var box = $('wod-agenda-rows'); if (!box) return rows.length;
        if (!rows.length) {
          box.innerHTML = '<div class="wod-empty">Sin turnos próximos · <a href="/calendar">abrir calendario →</a></div>';
          return 0;
        }
        box.innerHTML = rows.map(function (s, i) {
          var q = s.quotations_db || {};
          var who = q.client_full_name || 'Cliente';
          var c = dayChip(s.session_date);
          var soon = (new Date(s.session_date) - Date.now()) < 1000 * 60 * 60 * 48;
          var ref = [].concat(styleList(q.tattoo_style).slice(0, 1), q.tattoo_body_part || []).filter(Boolean).join(' · ');
          var detail = s.session_number ? ('Sesión ' + s.session_number) : 'Sesión';
          if (s.notes) detail += ' · ' + s.notes;
          return '<div class="wod-trow wod-cols-agenda">' +
            '<div class="wod-datechip ' + (soon ? 'wod-datechip--red' : '') + '">' +
              '<div class="wod-datechip__d">' + esc(c.d) + '</div><div class="wod-datechip__h">' + esc(c.h) + '</div></div>' +
            '<div class="wod-agenda__who"><div class="wod-avatar-mono" style="width:28px;height:28px;font-size:12px;">' + esc(firstChar(who)) + '</div>' +
              '<span class="wod-cotiz__name">' + esc(who) + '</span>' + (soon ? '<span class="pill pill--red">PRÓXIMO</span>' : '') + '</div>' +
            '<div class="wod-agenda__detail">' + esc(detail) + '</div>' +
            '<div class="wod-cell-mono wod-agenda__ref">' + esc(ref || '—') + '</div>' +
            '<a class="wbtn wbtn--dark" style="padding:8px 10px;font-size:10px;" href="/calendar">VER TURNO →</a>' +
            '</div>';
        }).join('');
        var cap = $('wod-agenda-cap'); if (cap) cap.textContent = 'Agenda · próximos turnos · ' + rows.length + ' programados';
        return rows.length;
      })
      .catch(function (e) {
        console.warn('[redesign] agenda', e);
        var box = $('wod-agenda-rows');
        if (box) box.innerHTML = '<div class="wod-empty">Sin turnos visibles · <a href="/calendar">abrir calendario →</a></div>';
        return 0;
      });
  }

  /* ===================================================================== *
   *  JOB BOARD SPOTS  (live · studio_spots ⋈ studios/location)             *
   * ===================================================================== */
  function loadJobSpots() {
    var mine = styleList(artist && (artist.styles_array || artist.styles || artist.estilos))
      .map(function (s) { return s.toLowerCase(); });
    return withLiveTimeout(sb.from('studio_spots')
      .select('id, title, kind, styles_wanted, start_date, status, studios:studio_id(name), location:location_id(city, country, label)')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(12), 'job spots')
      .then(function (res) {
        if (res.error) throw res.error;
        var spots = res.data || [];
        // rank style-matched first
        spots.sort(function (a, b) {
          var am = styleList(a.styles_wanted).some(function (s) { return mine.indexOf(s.toLowerCase()) > -1; }) ? 0 : 1;
          var bm = styleList(b.styles_wanted).some(function (s) { return mine.indexOf(s.toLowerCase()) > -1; }) ? 0 : 1;
          return am - bm;
        });
        var top = spots.slice(0, 3);
        var grid = $('wod-jobs-grid');
        if (grid) {
          if (!top.length) {
            grid.innerHTML = '<div class="wod-empty" style="grid-column:1/-1;">No hay spots abiertos · <a href="/studio-spots">ver job board →</a></div>';
          } else {
            grid.innerHTML = top.map(function (sp) {
              var studio = (sp.studios && sp.studios.name) || sp.title || 'Estudio';
              var loc = sp.location || {};
              var city = [loc.city, loc.country].filter(Boolean).join(' · ') || loc.label || '';
              var styles = styleList(sp.styles_wanted).slice(0, 2).join(' / ') || (sp.kind || 'Spot');
              var date = sp.start_date ? new Date(sp.start_date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).toUpperCase() : 'ABIERTO';
              return '<div class="wod-jobcard">' +
                '<div class="mono-sm" style="color:var(--ink-2);">◍ SPOT · ' + esc(date) + '</div>' +
                '<div class="wod-jobcard__studio">' + esc(studio) + '</div>' +
                '<div class="wod-jobcard__city">' + esc(city) + '</div>' +
                '<div class="wod-jobcard__tags"><span class="pill pill--outline">' + esc(styles) + '</span></div>' +
                '<div class="wod-jobcard__spacer"></div>' +
                '<div class="wod-jobcard__actions">' +
                  '<a class="wbtn wbtn--dark" style="flex:1;padding:8px 10px;font-size:10px;" href="/studio-spots">POSTULAR →</a>' +
                  '<a class="wbtn wbtn--dashed" style="padding:8px 10px;font-size:10px;" href="/studio-spots">VER</a></div>' +
                '</div>';
            }).join('');
          }
        }
        var cap = $('wod-jobs-cap'); if (cap) cap.textContent = 'Job Board · spots abiertos para vos · ' + spots.length + ' abiertos';
        var setT = function (id, v) { var el = $(id); if (el) el.textContent = v; };
        setT('ws-spots', spots.length);
        var sh = $('ws-spots-h'); if (sh) sh.textContent = spots.length ? 'para tu estilo' : 'sin novedades';
        return spots.length;
      })
      .catch(function (e) {
        console.warn('[redesign] jobspots', e);
        var grid = $('wod-jobs-grid');
        if (grid) grid.innerHTML = '<div class="wod-empty" style="grid-column:1/-1;">No se pudo cargar · <a href="/studio-spots">ver job board →</a></div>';
        return 0;
      });
  }

  /* ---- applications count (stat strip) -------------------------------- */
  function loadApplications() {
    return withLiveTimeout(sb.from('job_board_applications').select('id', { count: 'exact', head: true })
      .eq('artist_id', user.id), 'applications')
      .then(function (res) {
        var n = res.count || 0;
        var el = $('ws-applications'); if (el) el.textContent = n;
        var h = $('ws-applications-h'); if (h) h.textContent = n ? 'enviadas' : 'sin postulaciones';
      })
      .catch(function () { var el = $('ws-applications'); if (el) el.textContent = '0'; });
  }

  /* ---- visitors stat strip -------------------------------------------- */
  function mirrorVisitors() {
    var src = $('vs-total');
    var apply = function () {
      var v = (src.textContent || '').trim();
      if (v && v !== '0') {
        var el = $('ws-visits'); if (el) el.textContent = v;
        var h = $('ws-visits-h'); if (h) h.textContent = 'únicos: ' + (($('vs-unique') || {}).textContent || '—');
        buildHero();
      }
    };
    if (src) {
      apply();
      try { new MutationObserver(apply).observe(src, { childList: true, characterData: true, subtree: true }); } catch (e) {}
      return;
    }
    var since = new Date();
    since.setDate(since.getDate() - 7);
    withLiveTimeout(sb.from('artist_profile_visits').select('id', { count: 'exact', head: true })
      .eq('artist_id', user.id)
      .gte('created_at', since.toISOString()), 'visitors')
      .then(function (res) {
        var n = res.count || 0;
        var el = $('ws-visits'); if (el) el.textContent = n;
        var h = $('ws-visits-h'); if (h) h.textContent = n ? 'ultimos 7 dias' : 'sin visitas';
        buildHero();
      })
      .catch(function () {
        var el = $('ws-visits'); if (el) el.textContent = '0';
        var h = $('ws-visits-h'); if (h) h.textContent = 'sin datos';
      });
  }

  /* ===================================================================== *
   *  HERO CAROUSEL  (15s · real data, empty slides skipped)               *
   * ===================================================================== */
  function buildHero() {
    if (!artist) return;
    var uname = artist.username || artist.name || 'artista';
    var pending = parseInt(($('ws-pending') || {}).textContent, 10) || 0;
    var spots = parseInt(($('ws-spots') || {}).textContent, 10) || 0;
    var visits = parseInt(($('ws-visits') || {}).textContent, 10) || 0;
    var agendaRow = document.querySelector('#wod-agenda-rows .wod-trow');

    var now = new Date();
    var kickerDate = '◍ ' + now.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'short' }).toUpperCase() +
                     ' · ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    var slides = [];
    slides.push({
      kicker: kickerDate,
      title: 'Hola, <span class="hl-red">' + esc(uname) + '</span>.' +
             (pending ? '<br>Tenés <span class="hl-yellow">' + pending + ' cotizacion' + (pending === 1 ? '' : 'es') + '</span> sin responder.'
                      : '<br>Estás <span class="hl-yellow">al día</span> con tus cotizaciones.'),
      body: 'Este es tu panel de control en We Ötzi — cotizaciones, postulaciones, agenda y quién te visita.',
      actions: [{ l: 'IR A COTIZACIONES →', href: '/my-quotations', dark: true }, { l: 'VER PERFIL PÚBLICO', href: '#', act: 'preview' }, { l: 'EDITAR PERFIL', href: '/artist/profile/details', dashed: true }]
    });
    if (agendaRow) {
      var who = (agendaRow.querySelector('.wod-cotiz__name') || {}).textContent || 'tu cliente';
      var when = (agendaRow.querySelector('.wod-datechip__d') || {}).textContent || '';
      var hour = (agendaRow.querySelector('.wod-datechip__h') || {}).textContent || '';
      slides.push({
        kicker: '◍ AGENDA · PRÓXIMA SESIÓN',
        title: '<span class="hl-yellow">' + esc(when + ' ' + hour) + '</span><br>sesión con <span class="hl-red">' + esc(who) + '</span>',
        body: 'Confirmá el turno y revisá la referencia que te mandó antes de la cita.',
        actions: [{ l: 'ABRIR AGENDA →', href: '/calendar', dark: true }, { l: 'VER MENSAJE', href: '/my-quotations' }]
      });
    }
    if (spots) {
      slides.push({
        kicker: '◍ JOB BOARD · NUEVOS SPOTS',
        title: '<span class="hl-yellow">' + spots + ' spot' + (spots === 1 ? '' : 's') + '</span><br>abierto' + (spots === 1 ? '' : 's') + ' para tu estilo.',
        body: 'Estudios buscan artistas como vos esta semana — postulate antes de que se llenen.',
        actions: [{ l: 'VER JOB BOARD →', href: '/studio-spots', dark: true }, { l: 'FILTRAR ESTILOS', href: '/studio-spots', dashed: true }]
      });
    }
    if (visits) {
      slides.push({
        kicker: '◍ ESTADÍSTICAS · ÚLTIMOS DÍAS',
        title: '<span class="hl-red">' + visits + '</span> personas<br>vieron tu perfil.',
        body: 'Buen momento para subir trabajos nuevos y compartir tu perfil.',
        actions: [{ l: 'VER ANALÍTICAS →', href: '/artist/visitors/', dark: true }, { l: 'COMPARTIR PERFIL', href: '#', act: 'share' }]
      });
    }
    heroState.slides = slides;
    if (heroState.idx >= slides.length) heroState.idx = 0;
    renderHero();
    startHeroTimer();
  }
  function renderHero() {
    var s = heroState.slides[heroState.idx]; if (!s) return;
    var k = $('wod-hero-kicker'); if (k) k.textContent = s.kicker;
    var t = $('wod-hero-title'); if (t) t.innerHTML = s.title;
    var b = $('wod-hero-body'); if (b) b.textContent = s.body;
    var a = $('wod-hero-actions');
    if (a) {
      a.innerHTML = s.actions.map(function (x) {
        var cls = 'wbtn' + (x.dark ? ' wbtn--dark' : '') + (x.dashed ? ' wbtn--dashed' : '');
        return '<a class="' + cls + '" href="' + (x.href || '#') + '"' + (x.act ? ' data-act="' + x.act + '"' : '') + '>' + esc(x.l) + '</a>';
      }).join('');
    }
    var dots = $('wod-hero-dots');
    if (dots) {
      dots.innerHTML = heroState.slides.map(function (_, i) {
        return '<button class="wod-hero__dot' + (i === heroState.idx ? ' is-active' : '') + '" data-i="' + i + '" aria-label="Aviso ' + (i + 1) + '"></button>';
      }).join('') + '<span class="mono-sm wod-hero__counter">' +
        String(heroState.idx + 1).padStart(2, '0') + ' / ' + String(heroState.slides.length).padStart(2, '0') + '</span>';
    }
    // restart progress animation
    var hero = $('wod-hero');
    if (hero) { hero.setAttribute('data-animate', 'off'); void hero.offsetWidth; hero.setAttribute('data-animate', 'on'); }
  }
  function startHeroTimer() {
    clearInterval(heroState.timer);
    if (heroState.slides.length < 2) return;
    heroState.timer = setInterval(function () {
      heroState.idx = (heroState.idx + 1) % heroState.slides.length;
      renderHero();
    }, 15000);
  }
  function wireHero() {
    var dots = $('wod-hero-dots');
    if (dots) dots.addEventListener('click', function (e) {
      var d = e.target.closest('.wod-hero__dot'); if (!d) return;
      heroState.idx = parseInt(d.getAttribute('data-i'), 10) || 0;
      renderHero(); startHeroTimer();
    });
    var act = $('wod-hero-actions');
    if (act) act.addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]'); if (!a) return;
      var which = a.getAttribute('data-act');
      if (which === 'preview') { e.preventDefault(); var pb = $('preview-profile-btn'); if (pb) pb.click(); }
      if (which === 'share') { e.preventDefault(); var shb = $('share-profile-btn'); if (shb) shb.click(); }
      if (a.getAttribute('href') === '#analytics') { e.preventDefault(); window.location.href = '/artist/visitors/'; }
    });
  }

  /* ===================================================================== *
   *  NAV (overflow "+ MÁS" · mobile burger)                                *
   * ===================================================================== */
  function wireNav() {
    var more = $('wod-nav-more'), burger = $('dashboard-mobile-menu-toggle'),
        overflow = $('dashboard-mobile-menu');
    function toggle(btn) {
      if (!overflow) return;
      var open = overflow.classList.toggle('is-open');
      overflow.hidden = !open;
      if (btn) { btn.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open)); }
    }
    if (overflow && !overflow.classList.contains('is-open')) overflow.hidden = true;
    if (more) more.addEventListener('click', function () { toggle(more); });
    if (burger) burger.addEventListener('click', function () { toggle(burger); });
    document.addEventListener('click', function (e) {
      if (overflow && overflow.classList.contains('is-open') &&
          !e.target.closest('#dashboard-mobile-menu') &&
          !e.target.closest('#wod-nav-more') &&
          !e.target.closest('#dashboard-mobile-menu-toggle')) {
        overflow.classList.remove('is-open');
        overflow.hidden = true;
        if (more) more.classList.remove('is-open');
        if (burger) burger.classList.remove('is-open');
      }
    });
  }

  /* ===================================================================== *
   *  BOOTSTRAP                                                             *
   * ===================================================================== */
  function boot(detail) {
    sb = detail.supabase || window._supabase;
    user = detail.currentUser;
    artist = detail.artistData || null;
    if (!sb || !user) { console.warn('[redesign] missing supabase/user; aborting live layer'); return; }

    renderProfileCard();
    renderNextSteps();
    wireCotizTabs();
    wireHero();
    wireNav();

    buildHero(); // initial (will rebuild as data lands)
    clearStaleLoadingStates();
    setTimeout(clearStaleLoadingStates, LIVE_QUERY_TIMEOUT_MS + 500);

    Promise.resolve(loadCotizaciones())
      .then(function () { buildHero(); });
    loadAgenda().then(function () { buildHero(); });
    loadJobSpots().then(function () { buildHero(); });
    loadApplications();
    mirrorVisitors();
  }

  var booted = false;
  window.addEventListener('wo:dashboard-ready', function (ev) {
    if (booted) return; booted = true;
    try { boot(ev.detail || {}); } catch (e) { console.error('[redesign] boot failed', e); }
  });
  // Safety net: if the event fired before this listener attached, poll briefly.
  var tries = 0;
  var poll = setInterval(function () {
    if (booted) { clearInterval(poll); return; }
    if (window._supabase && window.currentUser) {
      clearInterval(poll); booted = true;
      boot({ supabase: window._supabase, currentUser: window.currentUser, artistData: window.artistData });
    } else if (++tries > 60) { clearInterval(poll); }
  }, 250);
})();
