/* ========================================================================== *
 * We Otzi Design System - Organisms
 * Source: Figma "Design System We Otzi" / Atomic Design (21:2753).
 *
 * Reusable light-DOM Web Components. Demo fixtures intentionally live in one
 * public object so the catalogue can render the exact same examples at every
 * viewport without duplicating markup or mutating product data.
 * ========================================================================== */
(function () {
  'use strict';

  var DATA = {
    navigation: [
      { id: 'quotations', label: 'COTIZACIONES', href: '/my-quotations' },
      { id: 'job-board', label: 'JOB BOARD', href: '/job-board' },
      { id: 'spots', label: 'SPOTS', href: '/studio-spots' },
      { id: 'calendar', label: 'CALENDARIO', href: '/calendar' },
      { id: 'statistics', label: 'ESTADÍSTICAS', href: '/my-quotations/statistics' },
      { id: 'travel', label: 'TRAVEL', href: '/artist/travel' }
    ],
    profile: {
      initials: 'LM',
      name: 'LAUUMARTH',
      handle: '@lauumarth.wo',
      verification: 'NO VERIFICADO',
      lifecycle: 'NUEVO',
      rate: '$150 / SESIÓN',
      styles: '1 ESTILO',
      experience: '0-1 AÑOS'
    },
    income: {
      month: '$4.820',
      week: '$1.240',
      sessions: '$920',
      pending: '$650',
      goal: '$6.000',
      progress: 80
    },
    reminders: [
      { icon: 'droplet', label: 'Reponer tinta negra' },
      { icon: 'edit', label: 'Enviar boceto a Camila' },
      { icon: 'message-circle', label: 'Responder WhatsApp de Nico' },
      { icon: 'dollar-sign', label: 'Cobrar saldo · Mateo' }
    ],
    agenda: [
      { time: '10:00', initials: 'SM', name: 'Sofía Martínez', detail: 'Primera sesión · Brazo completo', duration: '3H', status: 'CONFIRMADO', tone: 'success' },
      { time: '13:30', initials: 'MR', name: 'Mateo Ruiz', detail: 'Sesión 2/3 · Espalda · dragón', duration: '2H', status: 'CONFIRMADO', tone: 'success' },
      { time: '16:00', initials: 'JF', name: 'Julia Ferrer', detail: 'Retoque · Muñeca', duration: '1H', status: 'POR CONFIRMAR', tone: 'warning' },
      { time: '18:30', initials: 'TV', name: 'Tomás Vega', detail: 'Consulta · Boceto nuevo', duration: '45M', status: 'CONFIRMADO', tone: 'success' }
    ],
    upcoming: [
      { day: 'MAR 01', name: 'Valentina Ríos', detail: 'Sesión 1/2 · gemelo' },
      { day: 'MIÉ 02', name: 'Hueco libre', detail: '14:00 – 18:00', open: true },
      { day: 'JUE 03', name: 'Diego Lamas', detail: 'Retoque · costado' },
      { day: 'VIE 04', name: 'Hueco libre', detail: '10:00 – 13:00', open: true }
    ],
    designs: [
      { title: 'Manga floral', client: 'Sofía M.', stage: 'ENTINTADO', deadline: 'LÍMITE 12 JUL', progress: 75, tone: 'yellow' },
      { title: 'Dragón espalda', client: 'Mateo R.', stage: 'BOCETO', deadline: 'LÍMITE 20 JUL', progress: 40, tone: 'blue' },
      { title: 'Mandala geométrico', client: 'Lucía B.', stage: 'FINAL', deadline: 'LÍMITE 08 JUL', progress: 90, tone: 'green' }
    ],
    quoteStats: [
      { value: '3', label: 'PENDIENTES', tone: 'pending' },
      { value: '8', label: 'APROBADAS', tone: 'approved' },
      { value: '1', label: 'RECHAZADAS', tone: 'rejected' }
    ],
    activity: [
      { icon: 'check-circle', label: 'Sofía confirmó su turno', time: 'HACE 12 MIN' },
      { icon: 'dollar-sign', label: 'Pago recibido · Mateo · $180', time: 'HACE 1 H' },
      { icon: 'mail', label: 'Nueva cotización de Camila Soto', time: 'HACE 2 H' },
      { icon: 'star', label: 'Reseña 5★ de Julia Ferrer', time: 'AYER' }
    ],
    jobs: [
      { id: 'JB-59407', title: 'Calavera con auriculares y notas musicales, estilo new school', tags: ['NEW SCHOOL', 'TRADICIONAL'], city: 'Medellín', placement: 'Hombro', price: '$200 – $400', applications: '4 postulaciones', tone: 'blue', flag: 'red', isNew: true },
      { id: 'JB-76217', title: 'Retrato de gato persa estilo anime con ojos grandes', tags: ['ANIME', 'NEW SCHOOL'], city: 'Lima', placement: 'Antebrazo', price: '$100 – $250', applications: '1 postulaciones', tone: 'red', flag: 'yellow', isNew: true },
      { id: 'JB-33005', title: 'Mandala geométrico con simbolismo lunar', tags: ['GEOMÉTRICO', 'MANDALA'], city: 'Bogotá', placement: 'Costilla', price: '$150 – $300', applications: '2 postulaciones', tone: 'red', flag: 'yellow', isNew: false },
      { id: 'JB-34654', title: 'Serpiente enroscada en estilo japonés tradicional', tags: ['JAPONÉS', 'TRADICIONAL'], city: 'CDMX', placement: 'Pierna', price: '$400 – $800', applications: '6 postulaciones', tone: 'blue', flag: 'red', isNew: false },
      { id: 'JB-28471', title: 'Brújula vintage con mapa náutico', tags: ['TRADICIONAL', 'LETTERING'], city: 'Rosario', placement: 'Pantorrilla', price: '$150 – $350', applications: '3 postulaciones', tone: 'blue', flag: 'red', isNew: false }
    ],
    spots: [
      { size: 'feature', marker: 'triangle', eyebrow: 'GUEST SPOT · BUENOS AIRES', title: 'Palermo Tattoo Club', meta: '4 semanas · Split 68% · Cierra en 3 días', tags: ['Blackwork', 'Dotwork', 'Tradicional'], copy: 'Cupo guest para blackwork y dotwork en el corazón de Palermo. Clientela propia más agenda compartida con el estudio.' },
      { size: 'feature', marker: 'circle', eyebrow: 'RESIDENCIA · NEW YORK', title: 'Bang Bang NYC', meta: '3 a 6 meses · Split 70% · Stipend 800 USD', tags: ['Realismo', 'Black and grey', 'Fine line'], copy: 'Residencia larga en uno de los estudios más reconocidos de NYC. Incluye stipend mensual y mentoría.', dark: true },
      { size: 'small', eyebrow: 'ÚLTIMA OPORTUNIDAD', title: 'Sur Tattoo House', meta: 'Rosario · Cierra en 2 días', alert: true },
      { size: 'small', eyebrow: 'ITINERANTE', title: 'Línea Fina Studio', meta: 'Villa Crespo, BA. 2 semanas, Fine line / Minimalista, split 65%. Cierra en 5 días.' },
      { size: 'small', marker: 'triangle', eyebrow: 'CÓRDOBA', title: 'Geometría Negra', meta: '2 semanas · Split 70%' },
      { size: 'small', marker: 'circle', eyebrow: 'BERLÍN', title: 'Estudio Bauhaus Ink', meta: '6 meses · Stipend 1200 EUR' },
      { size: 'small', marker: 'square', eyebrow: 'BARCELONA', title: 'Costa Ink Collective', meta: '3 semanas · Split 66%' },
      { size: 'small', marker: 'circle', eyebrow: 'OSLO', title: 'Nordic Line Studio', meta: '4 meses · Stipend 900 EUR' }
    ],
    ticker: [
      'Casa Ré Tattoo · Ciudad de México · Cierra en 8 días',
      'Bariloche Ink · Bariloche · Cierra en 25 días',
      'Estudio Lisboa Sur · Lisboa · Cierra en 90 días',
      'Mendoza Tattoo Lab · Mendoza · Cierra en 15 días'
    ],
    portfolio: [
      { number: '01', title: 'Manga floral', style: 'Ilustrativo', state: 'feature' },
      { number: '02', title: 'Antebrazo', style: 'Blackwork', state: 'landscape' },
      { number: '03', title: 'Costilla', style: 'Fine line', state: 'portrait' },
      { title: 'Zona_tattoo.png', state: 'upload', progress: 72 },
      { number: '05', title: 'arrastrando…', state: 'dragging' }
    ],
    statistics: {
      month: 'JULIO 2026',
      period: 'ÚLTIMOS 30 DÍAS',
      profileViews: '4.820',
      portfolioViews: '1.340',
      income: '$3.150.000',
      conversion: '1,6%',
      requests: '86',
      answered: '74',
      bookings: '21',
      growth: [
        { month: 'FEB', value: '3.050', height: 28 },
        { month: 'MAR', value: '3.320', height: 42 },
        { month: 'ABR', value: '3.680', height: 58 },
        { month: 'MAY', value: '4.010', height: 67 },
        { month: 'JUN', value: '4.310', height: 64 },
        { month: 'JUL', value: '4.820', height: 66, current: true }
      ],
      styles: [
        { label: 'Blackwork', value: 34, tone: 'yellow' },
        { label: 'Realismo', value: 27, tone: 'blue' },
        { label: 'Fine line', value: 19, tone: 'ink' },
        { label: 'Dotwork', value: 12, tone: 'yellow' },
        { label: 'Old school', value: 8, tone: 'sand' }
      ],
      cities: [
        { label: 'Buenos Aires', value: 38 }, { label: 'Córdoba', value: 16 },
        { label: 'Madrid', value: 12 }, { label: 'Ciudad de México', value: 10 },
        { label: 'Santiago', value: 9 }, { label: 'Barcelona', value: 8 },
        { label: 'Otras ciudades', value: 7 }
      ],
      works: [
        { number: '01', label: 'Jaguar en blackwork', views: '2.340', value: 82 },
        { number: '02', label: 'Retrato realista — brazo', views: '1.860', value: 66 },
        { number: '03', label: 'Line art minimalista', views: '1.120', value: 41 }
      ]
    }
  };

  var NODE_IDS = {
    'weotzi-dashboard-sidebar': '34:134',
    'weotzi-income-stats': '34:135',
    'weotzi-upcoming-appointments': '34:137',
    'weotzi-agenda-board': '34:138',
    'weotzi-agenda-designs': '34:139',
    'weotzi-job-board': '34:525',
    'weotzi-job-filters': { expanded: '34:526', compact: '34:527' },
    'weotzi-profile-panel': '34:136',
    'weotzi-spots': '34:524',
    'weotzi-quote-form': '34:528',
    'weotzi-auth-form': '34:529',
    'weotzi-portfolio-gallery': { compact: '34:521', full: '34:522' },
    'weotzi-statistics-dashboard': '34:532',
    'weotzi-quotes-activity': '34:523',
    'weotzi-product-nav': '80:13241',
    'weotzi-dashboard': '34:533'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function icon(name) {
    return '<i class="wo-org-icon" data-wo-icon="' + escapeHtml(name) + '" aria-hidden="true"></i>';
  }

  function marker(kind) {
    return kind ? '<i class="wo-org-marker wo-org-marker--' + escapeHtml(kind) + '" aria-hidden="true"></i>' : '';
  }

  function hydrateIcons(root) {
    if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
      window.WoIcons.hydrate(root);
    }
  }

  function renderProductNav(active, options) {
    active = active || 'quotations';
    options = options || {};
    var navigation = DATA.navigation.concat({ id: 'inbox', label: 'INBOX', href: '/artist/inbox' });
    var menuToggleId = options.menuToggleId || 'artist-product-menu-toggle';
    var menuId = options.menuId || 'artist-product-mobile-menu';
    var profileHref = options.profileHref || '/artist/account';
    var profileLabel = options.profileLabel || 'Centro de la cuenta';
    var mobileExtras = options.dashboardExtras ? [
      { id: 'invitations', label: 'INVITACIONES', href: '/artist/invitations' },
      { id: 'visitors', label: 'VISITANTES', href: '/artist/visitors/' },
      { id: 'account', label: 'PERFIL', href: '/artist/profile/details' }
    ] : [];
    if (options.archiveExtra) {
      mobileExtras.push({ label: 'ARCHIVO', href: '/archive' });
    }
    var desktopLinks = navigation.map(function (item) {
      var current = item.id === active;
      var badge = item.id === options.badgeItem && options.badgeId
        ? '<span class="' + escapeHtml(options.badgeClass || 'wo-org-product-nav__badge') + '" id="' + escapeHtml(options.badgeId) + '" hidden>0</span>'
        : '';
      return '<a class="wo-org-product-nav__link' + (current ? ' is-active' : '') + '" href="' + item.href + '"' + (current ? ' aria-current="page"' : '') + '>' + item.label + badge + '</a>';
    }).join('');
    var mobileLinks = navigation.concat(mobileExtras).map(function (item) {
      var current = item.id === active;
      return '<a href="' + item.href + '"' + (current ? ' class="is-active" aria-current="page"' : '') + '>' + item.label + '</a>';
    }).join('');
    var profileId = options.profileId ? ' id="' + escapeHtml(options.profileId) + '"' : '';
    var profileClass = 'wo-org-product-nav__profile wo-o-tile' + (options.profileClass ? ' ' + escapeHtml(options.profileClass) : '');
    var profileLabelMarkup = options.profileLabelId
      ? '<span id="' + escapeHtml(options.profileLabelId) + '" class="wo-sr-only">' + escapeHtml(profileLabel) + '</span>'
      : '';
    var logoutId = options.logoutId ? ' id="' + escapeHtml(options.logoutId) + '"' : '';
    var logoutClass = 'wo-org-product-nav__logout' + (options.logoutClass ? ' ' + escapeHtml(options.logoutClass) : '');
    var logoutHandler = options.logoutHandler ? ' onclick="' + escapeHtml(options.logoutHandler) + '()"' : '';

    return '<div class="wo-org wo-org-product-navigation" data-figma-node="80:13241" data-figma-file="UmVbDewiAHkfLedTR5uyFj">' +
      '<header class="wo-org-product-nav wo-topbar wo-topbar--artist" aria-label="Navegación del producto">' +
      '<a class="wo-org-product-nav__brand" href="/artist/dashboard">WE ÖTZI</a>' +
      '<div class="wo-org-product-nav__links">' + desktopLinks + '</div>' +
      '<div class="wo-org-product-nav__account">' +
      '<button class="wo-org-product-nav__menu wo-topbar-menu-toggle" id="' + escapeHtml(menuToggleId) + '" type="button" aria-expanded="false" aria-controls="' + escapeHtml(menuId) + '" aria-label="Menú">' + icon('menu') + '<span>MENÚ</span></button>' +
      '<a' + profileId + ' class="' + profileClass + '" href="' + escapeHtml(profileHref) + '" aria-label="' + escapeHtml(profileLabel) + '"' + (options.profileCurrent ? ' aria-current="page"' : '') + '>Ö' + profileLabelMarkup + '</a>' +
      '<button' + logoutId + ' type="button" class="' + logoutClass + '" aria-label="Cerrar sesión"' + logoutHandler + (options.logoutHidden ? ' hidden' : '') + '>LOG OUT</button>' +
      '</div></header>' +
      '<nav id="' + escapeHtml(menuId) + '" class="wo-org-product-nav__mobile wo-topbar-mobile-menu' + (options.menuClass ? ' ' + escapeHtml(options.menuClass) : '') + '" aria-label="Navegación móvil de artista" hidden>' + mobileLinks + '</nav>' +
      '</div>';
  }

  function renderProfilePanel() {
    var p = DATA.profile;
    return '<aside class="wo-org wo-org-profile" data-figma-node="34:136" aria-label="Información de perfil">' +
      '<div class="wo-org-profile__rule" aria-hidden="true"></div>' +
      '<div class="wo-org-profile__content">' +
        '<div class="wo-org-profile__shapes" aria-hidden="true"><i></i><i></i><i></i></div>' +
        '<div class="wo-org-profile__avatar">' + p.initials + '</div>' +
        '<h2>' + p.name + '</h2><p class="wo-org-profile__handle">' + p.handle + '</p>' +
        '<div class="wo-org-profile__badges"><span>' + p.verification + '</span><span>' + p.lifecycle + '</span></div>' +
        '<p class="wo-org-profile__meta">' + p.rate + ' · ' + p.styles + ' · ' + p.experience + '</p>' +
        '<a href="/artist/profile/details">Editar perfil <b aria-hidden="true">→</b></a>' +
      '</div>' +
    '</aside>';
  }

  function renderDashboardSidebar() {
    var income = DATA.income;
    return '<aside class="wo-org wo-org-sidebar" data-figma-node="34:134" aria-label="Resumen lateral">' +
      '<section class="wo-org-sidebar__income"><p class="wo-org-kicker">INGRESOS · JUNIO</p><strong>' + income.month + '</strong>' +
        '<div><p><b>' + income.week + '</b><span>SEMANA</span></p><p><b>' + income.pending + '</b><span>SALDO PEND.</span></p></div></section>' +
      '<section><p class="wo-org-kicker">RECORDATORIOS</p><ul class="wo-org-reminders">' + DATA.reminders.map(function (item) {
        return '<li>' + icon(item.icon) + '<span>' + escapeHtml(item.label) + '</span></li>';
      }).join('') + '</ul></section>' +
      '<section><p class="wo-org-kicker">ACCIONES RÁPIDAS</p><div class="wo-org-quick-actions">' +
        '<button type="button">' + icon('plus') + 'NUEVO CLIENTE</button>' +
        '<button type="button">' + icon('calendar') + 'NUEVA CITA</button>' +
        '<button type="button">' + icon('dollar-sign') + 'REGISTRAR PAGO</button>' +
      '</div></section>' +
    '</aside>';
  }

  function renderIncomeStats() {
    var d = DATA.income;
    return '<section class="wo-org wo-org-income-stats" data-figma-node="34:135" aria-label="Ingresos">' +
      '<h2>Ingresos</h2><div class="wo-org-income-stats__grid">' +
        '<p><strong>' + d.month + '</strong><span>FACTURACIÓN MENSUAL</span></p>' +
        '<p><strong>' + d.week + '</strong><span>FACTURACIÓN SEMANAL</span></p>' +
        '<p class="is-success"><strong>' + d.sessions + '</strong><span>SEÑAS RECIBIDAS</span></p>' +
        '<p class="is-error"><strong>' + d.pending + '</strong><span>SALDO PENDIENTE</span></p>' +
      '</div><div class="wo-org-goal"><p><span>META MENSUAL · ' + d.goal + '</span><b>' + d.progress + '%</b></p><div><i style="width:' + d.progress + '%"></i></div></div>' +
    '</section>';
  }

  function renderUpcomingAppointments() {
    return '<aside class="wo-org wo-org-upcoming" data-figma-node="34:137" aria-label="Próximos turnos">' +
      '<p class="wo-org-kicker">PRÓXIMOS TURNOS</p><ol>' + DATA.upcoming.map(function (item) {
        return '<li><time>' + item.day + '</time><div><strong>' + item.name + '</strong><span>' + item.detail + '</span>' + (item.open ? '<em>HUECO LIBRE</em>' : '') + '</div></li>';
      }).join('') + '</ol><button type="button">' + icon('lock') + 'BLOQUEAR DÍA</button>' +
    '</aside>';
  }

  function agendaRows(cardMode) {
    return DATA.agenda.map(function (item) {
      return '<li class="wo-org-agenda-row' + (cardMode ? ' is-card' : '') + '">' +
        '<time><strong>' + item.time + '</strong><small>' + item.duration + '</small></time>' +
        (cardMode ? '<span class="wo-org-agenda-row__avatar">' + item.initials + '</span>' : '') +
        '<div><strong>' + item.name + '</strong><span>' + item.detail + '</span></div>' +
        '<em class="is-' + item.tone + '">' + item.status + '</em>' +
      '</li>';
    }).join('');
  }

  function renderAgendaBoard() {
    return '<section class="wo-org wo-org-agenda-board" data-figma-node="34:138" aria-label="Agenda del lunes 30 de junio">' +
      '<header><div><p class="wo-org-kicker">LUNES 30 JUN</p><h2>Hola, Laura — hoy tenés 4 sesiones</h2></div><span>6H 45M</span></header>' +
      '<ol>' + agendaRows(true) + '</ol>' +
    '</section>';
  }

  function designCards() {
    return DATA.designs.map(function (item) {
      return '<article class="wo-org-design-card"><div class="wo-org-design-card__media" aria-label="Placeholder de ' + escapeHtml(item.title) + '">' + icon('image') + '</div>' +
        '<h3>' + item.title + '</h3><p>' + item.client + '</p><div class="wo-org-design-card__progress"><i class="is-' + item.tone + '" style="width:' + item.progress + '%"></i></div>' +
        '<footer><span>' + item.stage + '</span><span>' + item.deadline + '</span></footer></article>';
    }).join('');
  }

  function renderAgendaDesigns() {
    return '<section class="wo-org wo-org-agenda-designs" data-figma-node="34:139">' +
      '<section class="wo-org-agenda-list" aria-labelledby="wo-org-agenda-title"><header><h2 id="wo-org-agenda-title">Agenda del día</h2><a href="/calendar">ABRIR CALENDARIO →</a></header><ol>' + agendaRows(false) + '</ol>' +
        '<div class="wo-org-agenda-list__action"><button type="button">' + icon('lock') + 'BLOQUEAR DÍA</button></div></section>' +
      '<section class="wo-org-designs" aria-labelledby="wo-org-designs-title"><header><h2 id="wo-org-designs-title">Diseños en proceso</h2><a href="#todos">VER TODOS →</a></header><div>' + designCards() + '</div></section>' +
    '</section>';
  }

  function renderQuotesActivity() {
    return '<section class="wo-org wo-org-quotes-activity" data-figma-node="34:523">' +
      '<section aria-label="Cotizaciones"><header><h2>Cotizaciones</h2><a href="/my-quotations">VER TODO →</a></header><div class="wo-org-quote-stats">' + DATA.quoteStats.map(function (item) {
        return '<p class="is-' + item.tone + '"><strong>' + item.value + '</strong><span>' + item.label + '</span></p>';
      }).join('') + '</div><a href="/my-quotations">RESPONDER PENDIENTES →</a></section>' +
      '<section aria-label="Actividad reciente"><h2>Actividad reciente</h2><ul>' + DATA.activity.map(function (item) {
        return '<li>' + icon(item.icon) + '<span>' + item.label + '</span><time>' + item.time + '</time></li>';
      }).join('') + '</ul></section>' +
    '</section>';
  }

  function renderJobBoard() {
    return '<section class="wo-org wo-org-job-board" data-figma-node="34:525">' +
      '<a class="wo-org-job-board__back" href="/job-board">← EXPLORAR</a><p class="wo-org-kicker">JOB BOARD</p>' +
      '<header><div><h2>6 solicitudes encontradas</h2><p>Resultados para Fine Line + Black &amp; Grey + Blackwork.</p></div><div class="wo-org-job-board__tools"><button type="button">Más recientes⌄</button><span><button class="is-active" type="button" aria-label="Vista grilla">' + icon('grid') + '</button><button type="button" aria-label="Vista lista">' + icon('menu') + '</button></span></div></header>' +
      '<div class="wo-org-job-board__query"><span>FINE LINE ×</span><span>BLACK &amp; GREY ×</span><span>BLACKWORK ×</span></div>' +
      '<div class="wo-org-job-board__section-head"><h3>Recomendado para vos</h3><a href="#todos">VER TODO →</a></div>' +
      '<div class="wo-org-job-carousel" role="list" aria-label="Solicitudes recomendadas">' + DATA.jobs.map(function (job) {
        return '<article class="wo-org-job-card" role="listitem"><div class="wo-org-job-card__media is-' + job.tone + ' is-flag-' + job.flag + '">' +
          '<span>' + job.id + '</span><div>' + (job.isNew ? '<b>NUEVO</b>' : '') + '<button type="button" aria-label="Guardar solicitud" aria-pressed="false">' + icon('heart') + '</button></div><i aria-hidden="true"></i></div>' +
          '<div class="wo-org-job-card__body"><h4>' + job.title + '</h4><div class="wo-org-job-card__tags">' + job.tags.map(function (tag) { return '<span>' + tag + '</span>'; }).join('') + '</div>' +
          '<p>' + icon('map-pin') + job.city + '<span>' + job.placement + '</span></p><footer><div><strong>' + job.price + '</strong><small>' + job.applications + '</small></div><a href="/job-board/request">POSTULARME →</a></footer></div></article>';
      }).join('') + '</div>' +
    '</section>';
  }

  function filterIconItem(name, label) {
    return '<button type="button">' + icon(name) + '<span>' + label + '</span></button>';
  }

  function renderJobFilters(variant) {
    variant = variant === 'compact' ? 'compact' : 'expanded';
    return '<aside class="wo-org wo-org-job-filters is-' + variant + '" data-figma-node="' + (variant === 'compact' ? '34:527' : '34:526') + '" aria-label="Filtros de Job Board">' +
      '<header><span>FILTROS</span><button type="button" data-filter-toggle aria-label="' + (variant === 'compact' ? 'Expandir filtros' : 'Comprimir filtros') + '">' + (variant === 'compact' ? '›' : '‹') + '</button></header>' +
      '<label class="wo-org-filter-search">' + icon('search') + '<input type="search" placeholder="Buscá estilo, ciudad..." aria-label="Buscar estilo o ciudad"></label>' +
      '<section><p class="wo-org-kicker">PARA VOS</p><div class="wo-org-filter-options">' +
        filterIconItem('star', 'Recomendado') + filterIconItem('map-pin', 'Cerca tuyo') + filterIconItem('zap', 'Recién publicados') + filterIconItem('heart', 'Guardados') +
      '</div></section>' +
      '<section><div class="wo-org-filter-title"><p class="wo-org-kicker">ESTILOS</p><b>3</b></div><div class="wo-org-filter-groups">' +
        '<button type="button"><span>TÉCNICA</span><b>⌃</b></button><ul><li class="is-active">Fine Line <span>12</span></li><li class="is-active">Blackwork <span>11</span></li><li class="is-active">Black &amp; Grey <span>8</span></li><li>Microrrealismo <span>8</span></li></ul><small>+ 3 MÁS</small>' +
        '<button type="button"><span>REGIONAL</span><b>⌄</b></button><button type="button"><span>TEMÁTICO</span><b>⌄</b></button><button type="button"><span>OTROS</span><b>⌄</b></button>' +
      '</div></section>' +
      '<section class="wo-org-filter-refine"><p class="wo-org-kicker">REFINAR</p><label>CIUDAD<select><option>Todas las ciudades</option></select></label><label>TAMAÑO<select><option>Cualquier tamaño</option></select></label><label>PRESUPUESTO<select><option>Cualquier presupuesto</option></select></label><button type="button">×&nbsp; LIMPIAR FILTROS (3)</button></section>' +
    '</aside>';
  }

  function renderSpots() {
    return '<section class="wo-org wo-org-spots" data-figma-node="34:524">' +
      '<header><div><h2>Spots abiertos</h2><nav aria-label="Categorías de spots"><button class="is-active" type="button">TODOS</button><button type="button">RESIDENCIAS</button><button type="button">ITINERANTES</button><button type="button">GUEST SPOTS</button></nav></div><p>EDICIÓN Nº 24 · 12 CONVOCATORIAS ACTIVAS</p></header>' +
      '<div class="wo-org-spots__grid">' + DATA.spots.map(function (spot, index) {
        return '<article class="wo-org-spot-card is-' + spot.size + (spot.dark ? ' is-dark' : '') + (spot.alert ? ' is-alert' : '') + '">' +
          (spot.dark ? '<div class="wo-org-spot-card__photo" role="img" aria-label="Fotografía de Bang Bang NYC"></div>' : '') +
          '<div class="wo-org-spot-card__content">' + (spot.eyebrow === 'ITINERANTE' ? '<p class="wo-org-spot-card__itinerant">ITINERANTE · ' + spot.title + ' · ' + spot.meta + '</p>' : '<p class="wo-org-spot-card__eyebrow">' + marker(spot.marker) + spot.eyebrow + '</p><h3>' + spot.title + '</h3><p class="wo-org-spot-card__meta">' + spot.meta + '</p>') +
          (spot.tags ? '<div class="wo-org-spot-card__tags">' + spot.tags.map(function (tag) { return '<span>' + tag + '</span>'; }).join('') + '</div>' : '') +
          (spot.copy ? '<p class="wo-org-spot-card__copy">' + spot.copy + '</p>' : '') +
          (index < 2 ? '<a href="#postularme">POSTULARME →</a>' : '') + '</div></article>';
      }).join('') + '</div>' +
      '<div class="wo-org-spots__ticker" aria-label="Más oportunidades">' + DATA.ticker.map(function (item, index) { return '<span>' + marker(['square', 'triangle', 'circle', 'square'][index]) + item + '</span>'; }).join('') + '</div>' +
    '</section>';
  }

  function renderQuoteForm() {
    return '<form class="wo-org wo-org-quote-form" data-figma-node="34:528" action="#" method="post">' +
      '<p class="wo-org-quote-form__title">FORMULARIO COMPLETO · ENVIAR COTIZACIÓN</p>' +
      '<label class="is-wide">NOMBRE COMPLETO *<input type="text" placeholder="Tu nombre" autocomplete="name" required></label>' +
      '<label>EMAIL *<input type="email" placeholder="tu@email.com" autocomplete="email" required></label>' +
      '<label>CIUDAD<input type="text" value="Buenos Aires" autocomplete="address-level2"></label>' +
      '<label class="is-wide">ESTILO *<select required><option>Seleccioná un estilo</option><option>Fine Line</option><option>Blackwork</option></select></label>' +
      '<label class="is-wide">DESCRIPCIÓN *<textarea placeholder="Describí tu idea..." required></textarea></label>' +
      '<p class="wo-org-quote-form__budget">PRESUPUESTO: <strong>USD 1750</strong></p>' +
      '<label class="wo-org-quote-form__terms"><input type="checkbox" required><span>Acepto los <u>términos y condiciones</u></span></label>' +
      '<button class="wo-org-quote-form__submit" type="submit">ENVIAR COTIZACIÓN →</button>' +
    '</form>';
  }

  function renderAuthForm() {
    return '<form class="wo-org wo-org-auth-form" data-figma-node="34:529" action="#" method="post">' +
      '<a class="wo-org-auth-form__brand" href="/"><span aria-hidden="true"><i></i><i></i><i></i></span>WE ÖTZI</a>' +
      '<h2>Bienvenida de nuevo</h2><p>Ingresá para gestionar tus spots y cotizaciones.</p>' +
      '<label>EMAIL<div>' + icon('mail') + '<input type="email" placeholder="vos@email.com" autocomplete="email" required></div></label>' +
      '<label>CONTRASEÑA<div>' + icon('lock') + '<input type="password" value="12345678" autocomplete="current-password" required></div></label>' +
      '<button class="wo-org-auth-form__submit" type="submit">ENTRAR&nbsp; →</button>' +
      '<div class="wo-org-auth-form__divider"><span>O CONTINUÁ CON</span></div>' +
      '<div class="wo-org-auth-form__social"><button type="button">' + icon('instagram') + 'INSTAGRAM</button><button type="button">' + icon('mail') + 'EMAIL</button><button type="button">FACEBOOK</button></div>' +
      '<p class="wo-org-auth-form__register">¿SIN CUENTA? <a href="/registerclosedbeta">REGISTRATE</a></p>' +
    '</form>';
  }

  function portfolioMedia(item) {
    if (item.state === 'upload') {
      return '<article class="wo-org-portfolio-item is-upload"><div>' + icon('image') + '</div><strong>' + item.title + '</strong><progress max="100" value="' + item.progress + '"></progress><span>Subiendo... ' + item.progress + '%</span></article>';
    }
    if (item.state === 'dragging') {
      return '<article class="wo-org-portfolio-item is-dragging"><div>' + icon('image') + '</div><p>' + item.number + ' — ' + item.title + '</p></article>';
    }
    return '<article class="wo-org-portfolio-item is-' + item.state + '"><div>' + icon('image') + (item.state === 'portrait' ? '<em>HOVER</em>' : '') + '</div><p>' + item.number + ' — ' + item.title + ' · ' + item.style + '</p>' + (item.state === 'portrait' ? '<small>Editar · Eliminar</small>' : '') + '</article>';
  }

  function renderPortfolioGallery(variant) {
    variant = variant === 'full' ? 'full' : 'compact';
    if (variant === 'full') {
      return '<section class="wo-org wo-org-portfolio is-full" data-figma-node="34:522">' +
        '<p class="wo-org-preview-label">VISTA PREVIA</p><div class="wo-org-portfolio__light"><header><div><p>GALERÍA DE TRABAJOS</p><h2>Tu portfolio</h2></div><span>12 TRABAJOS</span></header>' +
        '<div class="wo-org-portfolio__rules"><span>MÁX 12 ARCHIVOS · HASTA 2 VIDEOS · MP4 / MOV · 30S</span><span>ARRASTRÁ PARA REORDENAR</span></div>' +
        '<div class="wo-org-portfolio__grid">' + DATA.portfolio.map(portfolioMedia).join('') + '<button class="wo-org-portfolio__add" type="button">＋<span>AGREGÁ MÁS TRABAJOS</span></button></div></div>' +
        '<div class="wo-org-portfolio__empty">' + icon('grid') + '<h3>Empezá tu portfolio</h3><p>Subí trabajos uno por uno o importá tu feed completo.</p><div><button type="button">＋ SUBIR FOTOS/VIDEOS</button><button type="button">' + icon('instagram') + 'IMPORTAR INSTAGRAM</button></div></div>' +
      '</section>';
    }
    return '<section class="wo-org wo-org-portfolio is-compact" data-figma-node="34:521">' +
      '<p class="wo-org-preview-label">VISTA PREVIA</p><header class="wo-org-portfolio__compact-head"><h2>Galería de trabajos <span>— 12</span></h2><button type="button">' + icon('instagram') + 'IMPORTAR INSTAGRAM</button></header>' +
      '<div class="wo-org-portfolio__editor"><div class="wo-org-portfolio__editor-note"><span>MÁX 12 ARCHIVOS · HASTA 2 VIDEOS · MP4 / MOV · 30S</span><b>▲ ARRASTRÁ PARA REORDENAR</b></div>' +
        '<div class="wo-org-portfolio__editor-grid"><article class="is-main"><i>★</i>' + icon('image') + '<p>Manga floral — destacado</p><span>' + icon('star') + icon('edit') + icon('trash-2') + '</span></article><article class="is-hover">' + icon('image') + '<small>HOVER</small></article><article class="is-progress"><progress value="38" max="100"></progress><span>38%</span></article><button type="button">' + icon('image') + '<span>SUBIR MÁS</span></button></div>' +
        '<div class="wo-org-portfolio__editor-empty">' + icon('edit-3') + '<h3>Mostrá tu mejor trabajo</h3><p>Un portfolio con fotos de calidad genera más cotizaciones.</p><button type="button">＋ SUBIR FOTOS/VIDEOS</button></div>' +
      '</div></section>';
  }

  function renderStatisticsDashboard() {
    var s = DATA.statistics;
    return '<section class="wo-org wo-org-statistics" data-figma-node="34:532">' +
      '<header><div><p class="wo-org-kicker">SECCIÓN · ESTADÍSTICAS</p><h2>Así rindió tu perfil este mes</h2></div><p>' + s.month + '<br>PERÍODO · ' + s.period + '</p></header>' +
      '<div class="wo-org-statistics__top">' +
        '<article class="wo-org-stat-card is-views"><p>VISUALIZACIONES DEL PERFIL</p><strong>' + s.profileViews + '</strong><span><b>+12%</b> VS. MES ANTERIOR</span><hr><em>' + s.portfolioViews + ' <small>VISTAS AL PORTAFOLIO</small></em></article>' +
        '<article class="wo-org-stat-card is-donut"><div><i></i></div></article>' +
        '<article class="wo-org-stat-card is-tall"><p><strong>' + s.requests + '</strong><span>SOLICITUDES<br>RECIBIDAS</span></p><p><strong>' + s.answered + '</strong><span>COTIZACIONES<br>RESPONDIDAS</span></p><p><strong>' + s.bookings + '</strong><span>RESERVAS<br>CONFIRMADAS</span></p></article>' +
        '<article class="wo-org-stat-card is-income"><p>INGRESOS<br>GENERADOS</p><strong>' + s.income + '</strong><i aria-hidden="true">▲</i></article>' +
        '<article class="wo-org-stat-card is-conversion"><p>CONVERSIÓN DE VISITAS A RESERVAS</p><strong>' + s.conversion + '</strong><i aria-hidden="true"></i></article>' +
      '</div>' +
      '<article class="wo-org-growth"><header><span>CRECIMIENTO MENSUAL · VISUALIZACIONES</span><b>+12% JUL</b></header><div>' + s.growth.map(function (bar) { return '<p' + (bar.current ? ' class="is-current"' : '') + '><em>' + bar.value + '</em><i style="height:' + bar.height + '%"></i><span>' + bar.month + '</span></p>'; }).join('') + '</div></article>' +
      '<article class="wo-org-style-bars"><p>ESTILOS MÁS SOLICITADOS</p>' + s.styles.map(function (row) { return '<div><span>' + row.label + '</span><i><b class="is-' + row.tone + '" style="width:' + row.value + '%"></b></i><strong>' + row.value + '%</strong></div>'; }).join('') + '</article>' +
      '<div class="wo-org-statistics__bottom"><article class="wo-org-city-stats"><p>CIUDADES CON MAYOR INTERÉS</p>' + s.cities.map(function (row) { var blocks = Math.max(1, Math.round(row.value / 5)); return '<div><span>' + row.label + '</span><i>' + Array.from({ length: 10 }, function (_, index) { return '<b' + (index < blocks ? ' class="is-on"' : '') + '></b>'; }).join('') + '</i><strong>' + row.value + '%</strong></div>'; }).join('') + '</article>' +
      '<article class="wo-org-work-stats"><p>TRABAJOS MÁS VISTOS</p>' + s.works.map(function (row) { return '<div><em>' + row.number + '</em><span><b>' + row.label + '</b><i><strong style="width:' + row.value + '%"></strong></i></span><small>' + row.views + '</small></div>'; }).join('') + '</article></div>' +
      '<footer><span>DATOS DEL PERÍODO · ACTUALIZADO 05 JUL 2026</span><a href="#reporte">VER REPORTE COMPLETO →</a></footer>' +
    '</section>';
  }

  function renderDashboard(active) {
    return '<main class="wo-org wo-org-dashboard" data-figma-node="34:533">' +
      renderProductNav(active || 'quotations') +
      '<div class="wo-org-dashboard__body"><header class="wo-org-dashboard__hero"><p class="wo-org-kicker">LUNES, 30 JUN · 09:12</p><h1>Buen día, Laura.<br>Hoy <mark>tenés 4 sesiones</mark> programadas.</h1></header>' +
      '<div class="wo-org-dashboard__layout"><div class="wo-org-dashboard__main"><weotzi-agenda-designs></weotzi-agenda-designs><weotzi-quotes-activity></weotzi-quotes-activity></div>' +
      '<aside class="wo-org-dashboard__rail"><weotzi-profile-panel></weotzi-profile-panel><weotzi-dashboard-sidebar></weotzi-dashboard-sidebar></aside></div>' +
      '<weotzi-portfolio-gallery variant="compact"></weotzi-portfolio-gallery></div>' +
    '</main>';
  }

  class WeotziOrganism extends HTMLElement {
    connectedCallback() { this.renderOrganism(); }
    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue !== newValue && this.isConnected) this.renderOrganism();
    }
    set data(value) { this._data = value; if (this.isConnected) this.renderOrganism(); }
    get data() { return this._data || null; }
    renderOrganism() {
      this.innerHTML = this.template();
      this.setAttribute('data-wo-organism-ready', 'true');
      this.bind();
      hydrateIcons(this);
    }
    template() { return ''; }
    bind() {}
  }

  class ProductNavElement extends WeotziOrganism {
    static get observedAttributes() {
      return [
        'active', 'variant', 'menu-toggle-id', 'menu-id', 'menu-class',
        'profile-href', 'profile-id', 'profile-class', 'profile-label-id',
        'profile-label', 'profile-current', 'logout-id', 'logout-class',
        'logout-handler', 'logout-hidden', 'badge-item', 'badge-id',
        'badge-class', 'dashboard-extras', 'archive-extra'
      ];
    }
    template() {
      return renderProductNav(this.getAttribute('active') || this.getAttribute('variant') || 'quotations', {
        menuToggleId: this.getAttribute('menu-toggle-id'),
        menuId: this.getAttribute('menu-id'),
        menuClass: this.getAttribute('menu-class'),
        profileHref: this.getAttribute('profile-href'),
        profileId: this.getAttribute('profile-id'),
        profileClass: this.getAttribute('profile-class'),
        profileLabelId: this.getAttribute('profile-label-id'),
        profileLabel: this.getAttribute('profile-label'),
        profileCurrent: this.hasAttribute('profile-current'),
        logoutId: this.getAttribute('logout-id'),
        logoutClass: this.getAttribute('logout-class'),
        logoutHandler: this.getAttribute('logout-handler'),
        logoutHidden: this.hasAttribute('logout-hidden'),
        badgeItem: this.getAttribute('badge-item'),
        badgeId: this.getAttribute('badge-id'),
        badgeClass: this.getAttribute('badge-class'),
        dashboardExtras: this.hasAttribute('dashboard-extras'),
        archiveExtra: this.hasAttribute('archive-extra')
      });
    }
  }
  class ProfilePanelElement extends WeotziOrganism { template() { return renderProfilePanel(); } }
  class DashboardSidebarElement extends WeotziOrganism { template() { return renderDashboardSidebar(); } }
  class IncomeStatsElement extends WeotziOrganism { template() { return renderIncomeStats(); } }
  class UpcomingAppointmentsElement extends WeotziOrganism { template() { return renderUpcomingAppointments(); } }
  class AgendaBoardElement extends WeotziOrganism { template() { return renderAgendaBoard(); } }
  class AgendaDesignsElement extends WeotziOrganism { template() { return renderAgendaDesigns(); } }
  class QuotesActivityElement extends WeotziOrganism { template() { return renderQuotesActivity(); } }
  class JobBoardElement extends WeotziOrganism {
    template() { return renderJobBoard(); }
    bind() {
      this.querySelectorAll('.wo-org-job-card__media button').forEach(function (button) {
        button.addEventListener('click', function () {
          var saved = button.getAttribute('aria-pressed') === 'true';
          button.setAttribute('aria-pressed', String(!saved));
          button.closest('.wo-org-job-card').classList.toggle('is-saved', !saved);
        });
      });
    }
  }
  class JobFiltersElement extends WeotziOrganism {
    static get observedAttributes() { return ['variant', 'active']; }
    template() { return renderJobFilters(this.getAttribute('variant') || 'expanded'); }
    bind() {
      var self = this;
      var toggle = this.querySelector('[data-filter-toggle]');
      if (toggle) toggle.addEventListener('click', function () {
        self.setAttribute('variant', self.getAttribute('variant') === 'compact' ? 'expanded' : 'compact');
      });
    }
  }
  class SpotsElement extends WeotziOrganism { template() { return renderSpots(); } }
  class QuoteFormElement extends WeotziOrganism { static get observedAttributes() { return ['variant']; } template() { return renderQuoteForm(); } }
  class AuthFormElement extends WeotziOrganism { static get observedAttributes() { return ['variant']; } template() { return renderAuthForm(); } }
  class PortfolioGalleryElement extends WeotziOrganism {
    static get observedAttributes() { return ['variant', 'active']; }
    template() { return renderPortfolioGallery(this.getAttribute('variant') || 'compact'); }
  }
  class StatisticsDashboardElement extends WeotziOrganism { template() { return renderStatisticsDashboard(); } }
  class DashboardElement extends WeotziOrganism {
    static get observedAttributes() { return ['active', 'variant']; }
    template() { return renderDashboard(this.getAttribute('active') || 'quotations'); }
  }

  function define(name, constructor) {
    if (!window.customElements.get(name)) window.customElements.define(name, constructor);
  }

  define('weotzi-dashboard-sidebar', DashboardSidebarElement);
  define('weotzi-income-stats', IncomeStatsElement);
  define('weotzi-upcoming-appointments', UpcomingAppointmentsElement);
  define('weotzi-agenda-designs', AgendaDesignsElement);
  define('weotzi-agenda-board', AgendaBoardElement);
  define('weotzi-job-board', JobBoardElement);
  define('weotzi-job-filters', JobFiltersElement);
  define('weotzi-profile-panel', ProfilePanelElement);
  define('weotzi-spots', SpotsElement);
  define('weotzi-quote-form', QuoteFormElement);
  define('weotzi-auth-form', AuthFormElement);
  define('weotzi-portfolio-gallery', PortfolioGalleryElement);
  define('weotzi-statistics-dashboard', StatisticsDashboardElement);
  define('weotzi-quotes-activity', QuotesActivityElement);
  define('weotzi-product-nav', ProductNavElement);
  define('weotzi-dashboard', DashboardElement);

  window.WeotziOrganismData = DATA;
  window.WeotziOrganisms = {
    data: DATA,
    nodeIds: NODE_IDS,
    render: {
      productNav: renderProductNav,
      profilePanel: renderProfilePanel,
      dashboardSidebar: renderDashboardSidebar,
      incomeStats: renderIncomeStats,
      upcomingAppointments: renderUpcomingAppointments,
      agendaBoard: renderAgendaBoard,
      agendaDesigns: renderAgendaDesigns,
      quotesActivity: renderQuotesActivity,
      jobBoard: renderJobBoard,
      jobFilters: renderJobFilters,
      spots: renderSpots,
      quoteForm: renderQuoteForm,
      authForm: renderAuthForm,
      portfolioGallery: renderPortfolioGallery,
      statisticsDashboard: renderStatisticsDashboard,
      dashboard: renderDashboard
    }
  };
})();
