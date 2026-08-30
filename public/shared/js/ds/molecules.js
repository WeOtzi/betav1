/* ========================================================================== *
 * We Otzi Design System - Molecules
 * Source: Figma "Design System We Otzi" / Atomic Design (21:2753).
 *
 * One light-DOM Web Component exposes the 28 catalogue molecules. The
 * fixtures mirror Figma and reuse window.WeotziOrganismData when organisms.js
 * is present, keeping composed examples and isolated previews in sync.
 * ========================================================================== */
(function () {
  'use strict';

  var METADATA = Object.freeze({
    'ingresos-lateral': Object.freeze({ nodeId: '21:7026', title: 'Ingresos lateral', width: 241, height: 135 }),
    'acciones-rapidas': Object.freeze({ nodeId: '21:7025', title: 'Acciones rápidas', width: 212.815, height: 137.9 }),
    'recordatorios': Object.freeze({ nodeId: '21:7024', title: 'Recordatorios', width: 212.815, height: 105.65 }),
    'ingresos-estadisticas': Object.freeze({ nodeId: '21:7027', title: 'Ingresos estadísticas', width: 484.107, height: 136.85 }),
    'barra-progreso': Object.freeze({ nodeId: '21:7028', title: 'Barra de progreso', width: 484.107, height: 28.94 }),
    'proximos-turnos': Object.freeze({ nodeId: '21:7032', title: 'Próximos turnos', width: 188.4, height: 346.13 }),
    'agenda-lateral-1': Object.freeze({ nodeId: '21:7033', title: 'Agenda lateral 1', width: 535.655, height: 345.6 }),
    'disenos-en-proceso': Object.freeze({ nodeId: '21:7034', title: 'Diseños en proceso', width: 716, height: 282.897 }),
    'agenda-lateral-2': Object.freeze({ nodeId: '21:7035', title: 'Agenda lateral 2', width: 716.4, height: 362.13 }),
    'titulares-subtitulos': Object.freeze({ nodeId: '21:7036', title: 'Titulares y subtítulos', width: 1527.2, height: 96.2 }),
    'carrusel': Object.freeze({ nodeId: '21:7038', title: 'Carrusel', width: 1527.2, height: 511.8 }),
    'encabezado-resultados': Object.freeze({ nodeId: '21:7037', title: 'Encabezado de resultados', width: 1527.2, height: 201.799 }),
    'filtros-laterales': Object.freeze({ nodeId: '21:7039', title: 'Filtros laterales', width: 282, height: 1089 }),
    'filtros-comprimidos': Object.freeze({ nodeId: '21:7040', title: 'Filtros comprimidos', width: 74, height: 704 }),
    'informacion-perfil': Object.freeze({ nodeId: '21:7031', title: 'Información de perfil', width: 278, height: 112.2 }),
    'perfil': Object.freeze({ nodeId: '21:7030', title: 'Perfil', width: 266.4, height: 158 }),
    'mosaico-seccion': Object.freeze({ nodeId: '21:7449', title: 'Mosaico de sección', width: 1036.641, height: 679.463 }),
    'barra-herramientas-resultados': Object.freeze({ nodeId: '21:7450', title: 'Barra de herramientas de resultados', width: 1036.641, height: 118.9 }),
    'galeria-trabajos-2': Object.freeze({ nodeId: '21:7350', title: 'Galería de trabajos 2', width: 1180, height: 1095 }),
    'galeria-trabajos': Object.freeze({ nodeId: '21:7245', title: 'Galería de trabajos', width: 1180, height: 731.2 }),
    'tabla-contenido': Object.freeze({ nodeId: '21:7454', title: 'Tabla de contenido', width: 833, height: 511 }),
    'tabla-porcentual-2': Object.freeze({ nodeId: '21:7453', title: 'Tabla porcentual 2', width: 409.916, height: 167.2 }),
    'tabla-porcentaje': Object.freeze({ nodeId: '21:7452', title: 'Tabla porcentual', width: 832.844, height: 169.4 }),
    'actividad-reciente': Object.freeze({ nodeId: '21:7247', title: 'Actividad reciente', width: 263, height: 122.84 }),
    'cotizaciones-preview': Object.freeze({ nodeId: '21:7248', title: 'Cotizaciones preview', width: 433, height: 125.85 }),
    'form-cotizacion': Object.freeze({ nodeId: '21:7086', title: 'Formulario de cotización', width: 400, height: 476 }),
    'form-inicio': Object.freeze({ nodeId: '21:7162', title: 'Formulario de inicio', width: 380, height: 514.6 }),
    'form-crear-cuenta': Object.freeze({ nodeId: '21:7244', title: 'Formulario de crear cuenta', width: 380, height: 452 })
  });

  var FALLBACK = {
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
    upcoming: [
      { day: 'MAR 01', name: 'Valentina Ríos', detail: 'Sesión 1/2 · gemelo' },
      { day: 'MIÉ 02', name: 'Hueco libre', detail: '14:00 – 18:00', open: true },
      { day: 'JUE 03', name: 'Diego Lamas', detail: 'Retoque · costado' },
      { day: 'VIE 04', name: 'Hueco libre', detail: '10:00 – 13:00', open: true }
    ],
    agenda: [
      { time: '10:00', initials: 'SM', name: 'Sofía Martínez', detail: 'Primera sesión · Brazo completo', duration: '3H', status: 'CONFIRMADO', tone: 'success' },
      { time: '13:30', initials: 'MR', name: 'Mateo Ruiz', detail: 'Sesión 2/3 · Espalda · dragón', duration: '2H', status: 'CONFIRMADO', tone: 'success' },
      { time: '16:00', initials: 'JF', name: 'Julia Ferrer', detail: 'Retoque · Muñeca', duration: '1H', status: 'POR CONFIRMAR', tone: 'warning' },
      { time: '18:30', initials: 'TV', name: 'Tomás Vega', detail: 'Consulta · Boceto nuevo', duration: '45M', status: 'CONFIRMADO', tone: 'success' }
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
      { id: 'JB-59407', title: 'Calavera con auriculares y notas musicales, estilo new school', tags: ['NEW SCHOOL', 'TRADICIONAL'], city: 'Medellín', placement: 'Hombro', price: '$200 – $400', applications: '4 postulaciones', tone: 'blue', isNew: true },
      { id: 'JB-76217', title: 'Retrato de gato persa estilo anime con ojos grandes', tags: ['ANIME'], city: 'Lima', placement: 'Antebrazo', price: '$100 – $250', applications: '1 postulaciones', tone: 'red', isNew: true },
      { id: 'JB-33005', title: 'Mandala geométrico con simbolismo lunar', tags: ['GEOMÉTRICO', 'MANDALA'], city: 'Bogotá', placement: 'Costilla', price: '$150 – $300', applications: '2 postulaciones', tone: 'red' },
      { id: 'JB-34654', title: 'Serpiente enroscada en estilo japonés tradicional', tags: ['JAPONÉS'], city: 'CDMX', placement: 'Pierna', price: '$400 – $800', applications: '6 postulaciones', tone: 'blue' },
      { id: 'JB-28471', title: 'Brújula vintage con mapa náutico', tags: ['LETTERING'], city: 'Rosario', placement: 'Pantorrilla', price: '$150 – $350', applications: '3 postulaciones', tone: 'blue' }
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
      works: [
        { number: '01', label: 'Jaguar en blackwork', views: '2.340', value: 82 },
        { number: '02', label: 'Retrato realista — brazo', views: '1.860', value: 66 },
        { number: '03', label: 'Line art minimalista', views: '1.120', value: 41 }
      ]
    }
  };

  function data() {
    return window.WeotziOrganismData || FALLBACK;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  var generatedId = 0;

  function nextId(prefix) {
    generatedId += 1;
    return 'wo-mol-' + prefix + '-' + generatedId;
  }

  function icon(name, className) {
    return '<i class="wo-mol-icon' + (className ? ' ' + className : '') + '" data-wo-icon="' + escapeHtml(name) + '" aria-hidden="true"></i>';
  }

  function marker(kind) {
    return kind ? '<i class="wo-mol-marker wo-mol-marker--' + escapeHtml(kind) + '" aria-hidden="true"></i>' : '';
  }

  function hydrateIcons(root) {
    if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
      window.WoIcons.hydrate(root);
    }
  }

  function renderIncomeSide() {
    var d = data().income;
    return '<section class="wo-mol wo-mol-income-side" aria-label="Ingresos de junio">' +
      '<p class="wo-mol-kicker">INGRESOS · JUNIO</p>' +
      '<strong class="wo-mol-income-side__total">' + escapeHtml(d.month) + '</strong>' +
      '<div class="wo-mol-income-side__split">' +
        '<p><b>' + escapeHtml(d.week) + '</b><span>SEMANA</span></p>' +
        '<p class="is-pending"><b>' + escapeHtml(d.pending) + '</b><span>SALDO PEND.</span></p>' +
      '</div></section>';
  }

  function renderQuickActions() {
    return '<section class="wo-mol wo-mol-quick" aria-label="Acciones rápidas">' +
      '<p class="wo-mol-kicker">ACCIONES RÁPIDAS</p>' +
      '<div><button type="button">' + icon('plus') + '<span>NUEVO CLIENTE</span></button>' +
      '<button type="button">' + icon('calendar') + '<span>NUEVA CITA</span></button>' +
      '<button type="button">' + icon('dollar-sign') + '<span>REGISTRAR PAGO</span></button></div></section>';
  }

  function renderReminders() {
    return '<section class="wo-mol wo-mol-reminders" aria-label="Recordatorios">' +
      '<p class="wo-mol-kicker">RECORDATORIOS</p><ul>' +
      data().reminders.map(function (item) {
        return '<li>' + icon(item.icon) + '<span>' + escapeHtml(item.label) + '</span></li>';
      }).join('') + '</ul></section>';
  }

  function renderIncomeStats() {
    var d = data().income;
    return '<section class="wo-mol wo-mol-income-stats" aria-label="Ingresos">' +
      '<h2>Ingresos</h2><div>' +
      '<p><strong>' + escapeHtml(d.month) + '</strong><span>FACTURACIÓN MENSUAL</span></p>' +
      '<p><strong>' + escapeHtml(d.week) + '</strong><span>FACTURACIÓN SEMANAL</span></p>' +
      '<p class="is-success"><strong>' + escapeHtml(d.sessions) + '</strong><span>SEÑAS RECIBIDAS</span></p>' +
      '<p class="is-error"><strong>' + escapeHtml(d.pending) + '</strong><span>SALDO PENDIENTE</span></p>' +
      '</div></section>';
  }

  function renderProgress() {
    var d = data().income;
    return '<section class="wo-mol wo-mol-progress" aria-label="Meta mensual">' +
      '<p><span>META MENSUAL · ' + escapeHtml(d.goal) + '</span><b>' + escapeHtml(d.progress) + '%</b></p>' +
      '<div role="progressbar" aria-label="Progreso de la meta mensual" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + escapeHtml(d.progress) + '"><i style="width:' + Number(d.progress) + '%"></i></div></section>';
  }

  function renderUpcoming() {
    return '<section class="wo-mol wo-mol-upcoming" aria-label="Próximos turnos">' +
      '<p class="wo-mol-kicker">PRÓXIMOS TURNOS</p><ol>' +
      data().upcoming.map(function (item) {
        return '<li class="' + (item.open ? 'is-open' : '') + '"><time>' + escapeHtml(item.day) + '</time>' +
          '<div><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.detail) + '</span>' +
          (item.open ? '<button type="button">HUECO LIBRE</button>' : '') + '</div></li>';
      }).join('') + '</ol><button class="wo-mol-upcoming__block" type="button">' + icon('lock') + '<span>BLOQUEAR DÍA</span></button></section>';
  }

  function agendaRows(mode) {
    return data().agenda.map(function (item) {
      return '<li class="wo-mol-agenda-row is-' + escapeHtml(item.tone) + '">' +
        '<time><strong>' + escapeHtml(item.time) + '</strong><small>' + escapeHtml(item.duration) + '</small></time>' +
        (mode === 'cards' ? '<span class="wo-mol-agenda-row__avatar">' + escapeHtml(item.initials) + '</span>' : '') +
        '<div><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.detail) + '</span></div>' +
        '<em>' + escapeHtml(item.status) + '</em></li>';
    }).join('');
  }

  function renderAgendaOne() {
    return '<section class="wo-mol wo-mol-agenda-one" aria-label="Agenda del lunes 30 de junio">' +
      '<header><div><p>LUNES 30 JUN</p><h2>Hola, Laura — hoy tenés 4 sesiones</h2></div><strong>6H 45M</strong></header>' +
      '<ol>' + agendaRows('cards') + '</ol></section>';
  }

  function renderAgendaTwo() {
    return '<section class="wo-mol wo-mol-agenda-two" aria-label="Agenda del día">' +
      '<header><h2>Agenda del día</h2><a href="/calendar">ABRIR CALENDARIO →</a></header>' +
      '<ol>' + agendaRows('rows') + '</ol><button type="button">' + icon('lock') + '<span>BLOQUEAR DÍA</span></button></section>';
  }

  function renderDesigns() {
    return '<section class="wo-mol wo-mol-designs" aria-label="Diseños en proceso">' +
      '<header><h2>Diseños en proceso</h2><button type="button" data-molecule-action="designs-all">VER TODOS →</button></header><div>' +
      data().designs.map(function (item) {
        return '<article class="is-' + escapeHtml(item.tone) + '"><div class="wo-mol-designs__art" aria-hidden="true">' +
          marker(item.tone === 'blue' ? 'triangle' : item.tone === 'green' ? 'circle' : 'square') + icon('edit-3') + '</div>' +
          '<h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.client) + '</p>' +
          '<div class="wo-mol-designs__meta"><span>' + escapeHtml(item.stage) + '</span><b>' + escapeHtml(item.deadline) + '</b></div>' +
          '<div class="wo-mol-designs__progress" role="progressbar" aria-label="Progreso de ' + escapeHtml(item.title) + '" aria-valuenow="' + Number(item.progress) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + Number(item.progress) + '%"></i></div>' +
        '</article>';
      }).join('') + '</div></section>';
  }

  function renderTitles() {
    return '<header class="wo-mol wo-mol-titles"><p>JOB BOARD</p><div><h1>Explorá solicitudes abiertas</h1>' +
      '<span>Curado según tu perfil y tus estilos favoritos.</span></div></header>';
  }

  function jobCard(job) {
    return '<article class="wo-mol-job-card is-' + escapeHtml(job.tone) + '">' +
      '<div class="wo-mol-job-card__media"><span>' + escapeHtml(job.id) + '</span>' +
      (job.isNew ? '<em>NUEVO</em>' : '') + '<button type="button" aria-label="Guardar solicitud ' + escapeHtml(job.id) + '" aria-pressed="false">' + icon('bookmark') + '</button>' +
      '<i aria-hidden="true"></i></div><div class="wo-mol-job-card__body">' +
      '<h3>' + escapeHtml(job.title) + '</h3><div class="wo-mol-job-card__tags">' +
      job.tags.map(function (tag) { return '<span>' + escapeHtml(tag) + '</span>'; }).join('') + '</div>' +
      '<dl><div><dt>CIUDAD</dt><dd>' + escapeHtml(job.city) + '</dd></div><div><dt>ZONA</dt><dd>' + escapeHtml(job.placement) + '</dd></div></dl>' +
      '<p class="wo-mol-job-card__price">' + escapeHtml(job.price) + '</p><p class="wo-mol-job-card__apps">' + escapeHtml(job.applications) + '</p>' +
      '<button class="wo-mol-job-card__apply" type="button">POSTULARME</button></div></article>';
  }

  function renderCarousel() {
    return '<section class="wo-mol wo-mol-carousel" aria-label="Solicitudes recomendadas">' +
      '<header><h2>Recomendado para vos</h2><a href="/job-board">VER TODO</a></header>' +
      '<div class="wo-mol-carousel__track" tabindex="0" aria-label="Solicitudes recomendadas">' +
      data().jobs.map(jobCard).join('') + '</div></section>';
  }

  function renderResultsHeader() {
    return '<section class="wo-mol wo-mol-results-head" aria-label="Resultados del Job Board">' +
      '<header><div><p>EXPLORAR</p><h1>JOB BOARD</h1></div>' +
      '<button type="button" class="wo-mol-results-head__filter">' + icon('sliders') + '<span>FILTROS</span></button></header>' +
      '<div class="wo-mol-results-head__tools"><strong>6 solicitudes encontradas</strong>' +
      '<label><span>ORDENAR</span><select aria-label="Ordenar solicitudes"><option>Más recientes</option></select></label>' +
      '<div class="wo-mol-results-head__views" role="group" aria-label="Vista"><button type="button" data-results-view="grid" aria-pressed="true" aria-label="Ver en grilla">' + icon('grid') + '</button><button type="button" data-results-view="list" aria-pressed="false" aria-label="Ver en lista">' + icon('list') + '</button></div></div>' +
      '<div class="wo-mol-results-head__tags" aria-label="Filtros activos"><button type="button" data-filter-chip="FINE LINE" aria-label="Quitar filtro Fine Line">FINE LINE ' + icon('x') + '</button><button type="button" data-filter-chip="BLACKWORK" aria-label="Quitar filtro Blackwork">BLACKWORK ' + icon('x') + '</button></div></section>';
  }

  function filterCheck(label, count, checked) {
    return '<label><input type="checkbox"' + (checked ? ' checked' : '') + '><span>' + escapeHtml(label) + '</span>' +
      (count ? '<b>' + escapeHtml(count) + '</b>' : '') + '</label>';
  }

  function renderFilters() {
    return '<aside class="wo-mol wo-mol-filters" aria-label="Filtros">' +
      '<header><h2>FILTROS</h2><button type="button" data-molecule-filter-toggle aria-expanded="true" aria-label="Comprimir filtros">' + icon('chevrons-left') + '</button></header>' +
      '<label class="wo-mol-filters__search">' + icon('search') + '<span class="wo-mol-sr-only">Buscar</span><input type="search" placeholder="Buscá estilo, ciudad..."></label>' +
      '<section><h3>PARA VOS</h3>' + filterCheck('Recomendado', '', true) + filterCheck('Cerca tuyo') + filterCheck('Recién publicados') + filterCheck('Guardados') + '</section>' +
      '<section><h3>ESTILOS <b data-filter-count>3</b></h3><h4>TÉCNICA</h4>' + filterCheck('Fine Line', '12', true) + filterCheck('Blackwork', '11', true) + filterCheck('Dotwork', '8', true) + filterCheck('Microrealismo') +
      '<button type="button" class="wo-mol-filters__more" data-filter-disclosure aria-expanded="false">+ 3 MÁS</button><h4>REGIONAL</h4><button type="button" class="wo-mol-filters__disclosure" data-filter-disclosure aria-expanded="false">TEMÁTICO ' + icon('chevron-down') + '</button><button type="button" class="wo-mol-filters__disclosure" data-filter-disclosure aria-expanded="false">OTROS ' + icon('chevron-down') + '</button></section>' +
      '<section><h3>REFINAR</h3><label class="wo-mol-filters__select"><span>CIUDAD</span><select><option>Todas las ciudades</option></select></label>' +
      '<label class="wo-mol-filters__select"><span>TAMAÑO</span><select><option>Cualquier tamaño</option></select></label>' +
      '<label class="wo-mol-filters__select"><span>PRESUPUESTO</span><select><option>Cualquier presupuesto</option></select></label></section>' +
      '<button type="button" class="wo-mol-filters__clear" data-filter-clear>LIMPIAR FILTROS (3)</button></aside>';
  }

  function renderCompactFilters() {
    var actions = [
      ['chevrons-right', 'Expandir filtros', 'toggle'],
      ['search', 'Buscar'],
      ['star', 'Recomendado'],
      ['map-pin', 'Cerca tuyo'],
      ['clock', 'Recién publicados'],
      ['bookmark', 'Guardados']
    ];
    return '<nav class="wo-mol wo-mol-filter-compact" aria-label="Filtros comprimidos">' +
      actions.map(function (action) {
        return '<button type="button"' + (action[2] ? ' data-molecule-filter-toggle aria-expanded="false"' : '') + ' aria-label="' + escapeHtml(action[1]) + '">' +
          icon(action[0]) + '<span class="wo-mol-filter-compact__label">' + escapeHtml(action[1]) + '</span></button>';
      }).join('') + '</nav>';
  }

  function renderProfileInfo() {
    var p = data().profile;
    return '<section class="wo-mol wo-mol-profile-info" aria-label="Información de perfil">' +
      '<div class="wo-mol-profile-info__badges"><span>' + escapeHtml(p.verification) + '</span><span>' + escapeHtml(p.lifecycle) + '</span></div>' +
      '<p>' + escapeHtml(p.rate) + ' · ' + escapeHtml(p.styles) + ' · ' + escapeHtml(p.experience) + '</p>' +
      '<a href="/artist/profile/details">Editar perfil →</a></section>';
  }

  function renderProfile() {
    var p = data().profile;
    return '<section class="wo-mol wo-mol-profile" aria-label="Perfil de ' + escapeHtml(p.name) + '">' +
      '<div class="wo-mol-profile__shapes" aria-hidden="true">' + marker('square') + marker('circle') + marker('triangle') + '</div>' +
      '<div class="wo-mol-profile__avatar">' + escapeHtml(p.initials) + '</div>' +
      '<div><h2>' + escapeHtml(p.name) + '</h2><p>' + escapeHtml(p.handle) + '</p></div></section>';
  }

  function spotCard(item, index) {
    return '<article class="wo-mol-spot-card is-' + escapeHtml(item.size) + (item.dark ? ' is-dark' : '') + (item.alert ? ' is-alert' : '') + ' is-card-' + index + '">' +
      '<div class="wo-mol-spot-card__media" aria-hidden="true">' + marker(item.marker) + '</div><div class="wo-mol-spot-card__copy">' +
      '<p>' + escapeHtml(item.eyebrow) + '</p><h3>' + escapeHtml(item.title) + '</h3><strong>' + escapeHtml(item.meta) + '</strong>' +
      (item.tags ? '<div>' + item.tags.map(function (tag) { return '<span>' + escapeHtml(tag) + '</span>'; }).join('') + '</div>' : '') +
      (item.copy ? '<p class="wo-mol-spot-card__description">' + escapeHtml(item.copy) + '</p>' : '') +
      (item.size === 'feature' ? '<button type="button">POSTULARME</button>' : '') + '</div></article>';
  }

  function renderSpotsMosaic() {
    return '<section class="wo-mol wo-mol-spots-mosaic" aria-label="Spots abiertos"><div class="wo-mol-spots-mosaic__grid">' +
      data().spots.map(spotCard).join('') + '</div><div class="wo-mol-spots-mosaic__ticker" aria-label="Más oportunidades">' +
      data().ticker.map(function (item) { return '<span>' + escapeHtml(item) + '</span>'; }).join('') + '</div></section>';
  }

  function renderSpotsToolbar() {
    return '<header class="wo-mol wo-mol-spots-toolbar"><div><h2>Spots abiertos</h2><p>EDICIÓN Nº 24 · 12 CONVOCATORIAS ACTIVAS</p></div>' +
      '<nav aria-label="Filtrar spots"><button type="button" data-spots-tab="all" aria-pressed="true">TODOS</button><button type="button" data-spots-tab="residencias" aria-pressed="false">RESIDENCIAS</button><button type="button" data-spots-tab="itinerantes" aria-pressed="false">ITINERANTES</button><button type="button" data-spots-tab="guest-spots" aria-pressed="false">GUEST SPOTS</button></nav></header>';
  }

  function portfolioTile(item) {
    if (item.state === 'upload') {
      return '<article class="wo-mol-portfolio-tile is-upload">' + icon('image') + '<strong>' + escapeHtml(item.title) + '</strong><progress value="' + Number(item.progress) + '" max="100" aria-label="Carga de ' + escapeHtml(item.title) + '"></progress><span>Subiendo... ' + Number(item.progress) + '%</span></article>';
    }
    if (item.state === 'dragging') {
      return '<article class="wo-mol-portfolio-tile is-dragging">' + icon('move') + '<p>' + escapeHtml(item.number) + ' — ' + escapeHtml(item.title) + '</p></article>';
    }
    return '<article class="wo-mol-portfolio-tile is-' + escapeHtml(item.state) + '"><div>' + icon('image') +
      (item.state === 'portrait' ? '<em>HOVER</em><span>Editar · Eliminar</span>' : '') + '</div><p>' +
      escapeHtml(item.number) + ' — ' + escapeHtml(item.title) + ' · ' + escapeHtml(item.style) + '</p></article>';
  }

  function galleryHeader(title, count) {
    return '<header><div><p>GALERÍA DE TRABAJOS</p><h2>' + title + '</h2></div><span>' + count + '</span></header>' +
      '<div class="wo-mol-gallery__rules"><span>MÁX 12 ARCHIVOS · HASTA 2 VIDEOS · MP4 / MOV · 30S</span><b>ARRASTRÁ PARA REORDENAR</b></div>';
  }

  function renderGalleryFull() {
    return '<section class="wo-mol wo-mol-gallery is-full" aria-label="Galería de trabajos extendida">' +
      '<div class="wo-mol-gallery__onboarding"><div>' + icon('grid') + '<h2>Empezá tu portfolio</h2><p>Subí trabajos uno por uno o importá tu feed completo.</p></div>' +
      '<div><button type="button">＋ SUBIR FOTOS/VIDEOS</button><button type="button">' + icon('instagram') + ' IMPORTAR INSTAGRAM</button></div></div>' +
      '<p class="wo-mol-preview">VISTA PREVIA</p><div class="wo-mol-gallery__canvas">' + galleryHeader('Tu portfolio', '12 TRABAJOS') +
      '<div class="wo-mol-gallery__grid">' + data().portfolio.map(portfolioTile).join('') +
      '<button class="wo-mol-gallery__add" type="button">＋<span>AGREGÁ MÁS TRABAJOS</span></button></div></div></section>';
  }

  function renderGalleryCompact() {
    return '<section class="wo-mol wo-mol-gallery is-compact" aria-label="Galería de trabajos">' +
      '<p class="wo-mol-preview">VISTA PREVIA</p><div class="wo-mol-gallery__compact-head"><h2>Galería de trabajos <span>— 12</span></h2>' +
      '<button type="button">' + icon('instagram') + ' IMPORTAR INSTAGRAM</button></div><div class="wo-mol-gallery__canvas">' +
      '<div class="wo-mol-gallery__rules"><span>MÁX 12 ARCHIVOS · HASTA 2 VIDEOS · MP4 / MOV · 30S</span><b>ARRASTRÁ PARA REORDENAR</b></div>' +
      '<div class="wo-mol-gallery__editor-grid"><article class="is-main"><i>★</i>' + icon('image') + '<p>Manga floral — destacado</p><span>' + icon('star') + icon('edit') + icon('trash-2') + '</span></article>' +
      '<article class="is-hover">' + icon('image') + '<small>HOVER</small></article><article class="is-progress"><progress value="38" max="100" aria-label="Carga de trabajo"></progress><span>38%</span></article>' +
      '<button type="button">' + icon('image') + '<span>SUBIR MÁS</span></button></div>' +
      '<div class="wo-mol-gallery__promotion">' + icon('edit-3') + '<h3>Mostrá tu mejor trabajo</h3><p>Un portfolio con fotos de calidad genera más cotizaciones.</p><button type="button">＋ SUBIR FOTOS/VIDEOS</button></div></div></section>';
  }

  function renderStatisticsContent() {
    var s = data().statistics;
    return '<section class="wo-mol wo-mol-stat-content" aria-label="Resumen de estadísticas">' +
      '<div class="wo-mol-stat-content__top"><article><p>VISUALIZACIONES DEL PERFIL</p><strong>' + escapeHtml(s.profileViews) + '</strong><span><b>+12%</b> vs. mes anterior</span><hr><em>' + escapeHtml(s.portfolioViews) + '<small>VISITAS AL PORTAFOLIO</small></em></article>' +
      '<article class="is-response"><div aria-hidden="true"><i></i></div><p><strong>86%</strong><span>TASA DE<br>RESPUESTA</span></p></article>' +
      '<article class="is-income"><p>INGRESOS<br>GENERADOS</p><strong>' + escapeHtml(s.income) + '</strong></article>' +
      '<article class="is-conversion"><p>CONVERSIÓN DE VISITAS A RESERVAS</p><strong>' + escapeHtml(s.conversion) + '</strong></article></div>' +
      '<article class="wo-mol-stat-content__growth"><header><span>CRECIMIENTO MENSUAL · VISUALIZACIONES</span><b>+12% JUL</b></header><div>' +
      s.growth.map(function (bar) { return '<p class="' + (bar.current ? 'is-current' : '') + '"><em>' + escapeHtml(bar.value) + '</em><i style="height:' + Number(bar.height) + '%"></i><span>' + escapeHtml(bar.month) + '</span></p>'; }).join('') + '</div></article>' +
      '<div class="wo-mol-stat-content__totals"><p><strong>' + escapeHtml(s.requests) + '</strong><span>SOLICITUDES<br>RECIBIDAS</span></p><p><strong>' + escapeHtml(s.answered) + '</strong><span>COTIZACIONES<br>RESPONDIDAS</span></p><p><strong>' + escapeHtml(s.bookings) + '</strong><span>RESERVAS<br>CONFIRMADAS</span></p></div></section>';
  }

  function renderWorkTable() {
    return '<section class="wo-mol wo-mol-work-table" aria-label="Trabajos más vistos"><h2>TRABAJOS MÁS VISTOS</h2>' +
      data().statistics.works.map(function (row) {
        return '<div><em>' + escapeHtml(row.number) + '</em><span><b>' + escapeHtml(row.label) + '</b><i><strong style="width:' + Number(row.value) + '%"></strong></i></span><small>' + escapeHtml(row.views) + '</small></div>';
      }).join('') + '</section>';
  }

  function renderStyleTable() {
    return '<section class="wo-mol wo-mol-style-table" aria-label="Estilos más solicitados"><h2>ESTILOS MÁS SOLICITADOS</h2>' +
      data().statistics.styles.map(function (row) {
        return '<div><span>' + escapeHtml(row.label) + '</span><i><b class="is-' + escapeHtml(row.tone) + '" style="width:' + Number(row.value) + '%"></b></i><strong>' + Number(row.value) + '%</strong></div>';
      }).join('') + '</section>';
  }

  function renderActivity() {
    return '<section class="wo-mol wo-mol-activity" aria-label="Actividad reciente"><h2>Actividad reciente</h2><ol>' +
      data().activity.map(function (item) {
        return '<li>' + icon(item.icon) + '<p><strong>' + escapeHtml(item.label) + '</strong><time>' + escapeHtml(item.time) + '</time></p></li>';
      }).join('') + '</ol></section>';
  }

  function renderQuotesPreview() {
    return '<section class="wo-mol wo-mol-quotes" aria-label="Cotizaciones"><h2>Cotizaciones</h2><div>' +
      data().quoteStats.map(function (item) {
        return '<p class="is-' + escapeHtml(item.tone) + '"><strong>' + escapeHtml(item.value) + '</strong><span>' + escapeHtml(item.label) + '</span></p>';
      }).join('') + '</div><button type="button">RESPONDER PENDIENTES ' + icon('arrow-right') + '</button></section>';
  }

  function field(label, control) {
    return '<label class="wo-mol-field"><span>' + label + '</span>' + control + '</label>';
  }

  function terms() {
    var checkboxId = nextId('terms');
    return '<div class="wo-mol-terms"><input id="' + checkboxId + '" name="terms" type="checkbox" required aria-required="true">' +
      '<span><label for="' + checkboxId + '">Acepto los </label><a href="/legal/terms" target="_blank" rel="noopener">términos y condiciones</a></span></div>';
  }

  function formFeedback() {
    return '<p class="wo-mol-form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p>';
  }

  function brand() {
    return '<div class="wo-mol-brand"><span aria-hidden="true">' + marker('square') + marker('circle') + marker('triangle') + '</span><strong>WE ÖTZI</strong></div>';
  }

  function socialButtons() {
    return '<div class="wo-mol-social"><span>Recomendado</span><button type="button">' + icon('instagram') + '<b>INSTAGRAM</b></button>' +
      '<button type="button">' + icon('mail') + '<b>EMAIL</b></button><button type="button">' + icon('facebook') + '<b>FACEBOOK</b></button></div>';
  }

  function separator() {
    return '<div class="wo-mol-separator"><i></i><span>O CONTINUÁ CON</span><i></i></div>';
  }

  function renderQuoteForm() {
    return '<form class="wo-mol wo-mol-quote-form" data-demo-success="Cotización de demostración enviada. No se guardaron datos.">' +
      field('NOMBRE COMPLETO *', '<input name="name" autocomplete="name" placeholder="Tu nombre" required aria-required="true">') +
      '<div class="wo-mol-form-row">' + field('EMAIL *', '<input name="email" type="email" autocomplete="email" placeholder="tu@email.com" required aria-required="true">') +
      field('CIUDAD', '<input name="city" autocomplete="address-level2" placeholder="Buenos Aires">') + '</div>' +
      field('ESTILO *', '<select name="style" required aria-required="true"><option value="" selected disabled>Seleccioná un estilo</option><option>Fine Line</option><option>Blackwork</option></select>') +
      field('DESCRIPCIÓN *', '<textarea name="description" placeholder="Describí tu idea..." required aria-required="true"></textarea>') +
      '<label class="wo-mol-budget"><span>PRESUPUESTO: <b>USD 1750</b></span><input type="range" min="100" max="3000" value="1750" aria-label="Presupuesto, 1750 dólares"></label>' +
      terms() + '<button class="wo-mol-form-submit" type="submit">ENVIAR COTIZACIÓN →</button>' + formFeedback() + '</form>';
  }

  function renderLogin() {
    var passwordId = nextId('login-password');
    return '<form class="wo-mol wo-mol-auth" data-demo-success="Inicio de sesión de demostración. No se guardaron datos.">' + brand() +
      '<header><h1>Bienvenida de nuevo</h1><p>Ingresá para gestionar tus spots y cotizaciones.</p></header>' +
      field('EMAIL', '<span class="wo-mol-auth__control">' + icon('mail') + '<input name="email" type="email" autocomplete="email" placeholder="vos@email.com" required aria-required="true"></span>') +
      '<div class="wo-mol-field"><label class="wo-mol-field__label" for="' + passwordId + '">CONTRASEÑA</label>' +
      '<span class="wo-mol-auth__control">' + icon('lock') + '<input id="' + passwordId + '" name="password" type="password" autocomplete="current-password" value="password" required aria-required="true"><button type="button" data-password-toggle aria-label="Mostrar contraseña">' + icon('eye') + '</button></span></div>' +
      '<a class="wo-mol-auth__recover" href="/recover">¿Olvidaste tu contraseña?</a>' +
      '<button class="wo-mol-auth__primary" type="submit">ENTRAR ' + icon('arrow-right') + '</button>' + formFeedback() + separator() + socialButtons() +
      '<p class="wo-mol-auth__switch">¿SIN CUENTA? <a href="/registerclosedbeta">REGISTRATE</a></p></form>';
  }

  function renderSignup() {
    return '<form class="wo-mol wo-mol-auth is-signup" data-demo-success="Cuenta de demostración lista. No se guardaron datos.">' + brand() +
      '<header><h1>Crea tu cuenta</h1><p>Empieza hoy como artista.</p></header>' +
      '<div class="wo-mol-auth__signup-fields">' +
      field('NOMBRE COMPLETO *', '<input name="name" autocomplete="name" placeholder="Tu nombre" required aria-required="true">') +
      '<div class="wo-mol-form-row">' + field('EMAIL *', '<input name="email" type="email" autocomplete="email" placeholder="tu@email.com" required aria-required="true">') +
      field('CIUDAD', '<input name="city" autocomplete="address-level2" placeholder="Buenos Aires">') + '</div>' +
      field('ESTILO *', '<select name="style" required aria-required="true"><option value="" selected disabled>Seleccioná tú estilo principal</option><option>Fine Line</option><option>Blackwork</option></select>') + terms() + '</div>' +
      '<button class="wo-mol-auth__primary" type="submit">REGISTRARME ' + icon('arrow-right') + '</button>' + formFeedback() + separator() + socialButtons() +
      '<p class="wo-mol-auth__switch">¿YA TIENES CUENTA? <a href="/artist/login">INGRESAR</a></p></form>';
  }

  var RENDERERS = Object.freeze({
    'ingresos-lateral': renderIncomeSide,
    'acciones-rapidas': renderQuickActions,
    'recordatorios': renderReminders,
    'ingresos-estadisticas': renderIncomeStats,
    'barra-progreso': renderProgress,
    'proximos-turnos': renderUpcoming,
    'agenda-lateral-1': renderAgendaOne,
    'disenos-en-proceso': renderDesigns,
    'agenda-lateral-2': renderAgendaTwo,
    'titulares-subtitulos': renderTitles,
    'carrusel': renderCarousel,
    'encabezado-resultados': renderResultsHeader,
    'filtros-laterales': renderFilters,
    'filtros-comprimidos': renderCompactFilters,
    'informacion-perfil': renderProfileInfo,
    'perfil': renderProfile,
    'mosaico-seccion': renderSpotsMosaic,
    'barra-herramientas-resultados': renderSpotsToolbar,
    'galeria-trabajos-2': renderGalleryFull,
    'galeria-trabajos': renderGalleryCompact,
    'tabla-contenido': renderStatisticsContent,
    'tabla-porcentual-2': renderWorkTable,
    'tabla-porcentaje': renderStyleTable,
    'actividad-reciente': renderActivity,
    'cotizaciones-preview': renderQuotesPreview,
    'form-cotizacion': renderQuoteForm,
    'form-inicio': renderLogin,
    'form-crear-cuenta': renderSignup
  });

  function renderVariant(variant) {
    var renderer = RENDERERS[variant];
    return renderer ? renderer() : '';
  }

  class WeotziMoleculeElement extends HTMLElement {
    static get observedAttributes() { return ['variant']; }

    connectedCallback() {
      this.renderMolecule();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue !== newValue && this.isConnected) this.renderMolecule();
    }

    renderMolecule() {
      var variant = this.getAttribute('variant') || 'ingresos-lateral';
      var meta = METADATA[variant];
      if (!meta) {
        this.removeAttribute('data-figma-node');
        this.removeAttribute('data-wo-molecule-ready');
        this.innerHTML = '<p class="wo-mol wo-mol-error">Variante de molécula desconocida: ' + escapeHtml(variant) + '</p>';
        return;
      }

      this.setAttribute('data-figma-node', meta.nodeId);
      this.setAttribute('data-wo-molecule-ready', 'true');
      this.setAttribute('aria-label', meta.title);
      this.style.setProperty('--wo-molecule-natural-width', meta.width + 'px');
      this.innerHTML = renderVariant(variant);
      this.bindMolecule();
      hydrateIcons(this);
    }

    bindMolecule() {
      var self = this;

      function emitAction(action, detail) {
        self.dispatchEvent(new CustomEvent('weotzi-molecule-action', {
          bubbles: true,
          detail: Object.assign({ action: action, variant: self.getAttribute('variant') }, detail || {})
        }));
      }

      function showFormFeedback(form, message, tone) {
        var feedback = form.querySelector('[data-form-feedback]');
        if (!feedback) return;
        feedback.textContent = message;
        feedback.hidden = false;
        feedback.setAttribute('data-tone', tone || 'success');
      }

      this.querySelectorAll('form').forEach(function (form) {
        form.addEventListener('invalid', function () {
          showFormFeedback(form, 'Revisá los campos obligatorios antes de continuar.', 'error');
        }, true);
        form.addEventListener('submit', function (event) {
          event.preventDefault();
          if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
            showFormFeedback(form, 'Revisá los campos obligatorios antes de continuar.', 'error');
            if (typeof form.reportValidity === 'function') form.reportValidity();
            return;
          }
          form.setAttribute('data-demo-submitted', 'true');
          showFormFeedback(form, form.getAttribute('data-demo-success') || 'Demostración completada. No se guardaron datos.', 'success');
          emitAction('demo-form-submit', { form: form.className });
        });
      });
      this.querySelectorAll('[data-molecule-filter-toggle]').forEach(function (button) {
        button.addEventListener('click', function () {
          var expanded = self.getAttribute('variant') !== 'filtros-comprimidos';
          button.setAttribute('aria-expanded', String(!expanded));
          self.setAttribute('variant', self.getAttribute('variant') === 'filtros-comprimidos' ? 'filtros-laterales' : 'filtros-comprimidos');
          emitAction('filter-panel-toggle', { expanded: !expanded });
        });
      });
      this.querySelectorAll('[data-results-view]').forEach(function (button) {
        button.addEventListener('click', function () {
          var view = button.getAttribute('data-results-view');
          self.querySelectorAll('[data-results-view]').forEach(function (candidate) {
            candidate.setAttribute('aria-pressed', String(candidate === button));
          });
          self.setAttribute('data-results-view', view);
          emitAction('results-view', { view: view });
        });
      });
      this.querySelectorAll('[data-filter-chip]').forEach(function (button) {
        button.addEventListener('click', function () {
          var filter = button.getAttribute('data-filter-chip');
          button.remove();
          var remaining = self.querySelectorAll('[data-filter-chip]').length;
          self.setAttribute('data-active-filters', String(remaining));
          emitAction('filter-chip-remove', { filter: filter, remaining: remaining });
        });
      });
      this.querySelectorAll('[data-filter-disclosure]').forEach(function (button) {
        button.addEventListener('click', function () {
          var expanded = button.getAttribute('aria-expanded') === 'true';
          button.setAttribute('aria-expanded', String(!expanded));
          button.classList.toggle('is-expanded', !expanded);
          emitAction('filter-disclosure', { label: button.textContent.trim(), expanded: !expanded });
        });
      });
      this.querySelectorAll('[data-filter-clear]').forEach(function (button) {
        button.addEventListener('click', function () {
          var panel = button.closest('.wo-mol-filters');
          panel.querySelectorAll('input[type="checkbox"]').forEach(function (input) { input.checked = false; });
          panel.querySelectorAll('input[type="search"]').forEach(function (input) { input.value = ''; });
          panel.querySelectorAll('select').forEach(function (select) { select.selectedIndex = 0; });
          panel.querySelectorAll('[data-filter-disclosure]').forEach(function (disclosure) {
            disclosure.setAttribute('aria-expanded', 'false');
            disclosure.classList.remove('is-expanded');
          });
          var count = panel.querySelector('[data-filter-count]');
          if (count) count.textContent = '0';
          button.textContent = 'LIMPIAR FILTROS (0)';
          self.setAttribute('data-active-filters', '0');
          emitAction('filters-clear', { remaining: 0 });
        });
      });
      this.querySelectorAll('[data-spots-tab]').forEach(function (button) {
        button.addEventListener('click', function () {
          var tab = button.getAttribute('data-spots-tab');
          self.querySelectorAll('[data-spots-tab]').forEach(function (candidate) {
            candidate.setAttribute('aria-pressed', String(candidate === button));
          });
          self.setAttribute('data-spots-tab', tab);
          emitAction('spots-tab', { tab: tab });
        });
      });
      this.querySelectorAll('[data-molecule-action]').forEach(function (button) {
        button.addEventListener('click', function () {
          emitAction(button.getAttribute('data-molecule-action'));
        });
      });
      this.querySelectorAll('.wo-mol-job-card__media button').forEach(function (button) {
        button.addEventListener('click', function () {
          var pressed = button.getAttribute('aria-pressed') === 'true';
          button.setAttribute('aria-pressed', String(!pressed));
          button.closest('.wo-mol-job-card').classList.toggle('is-saved', !pressed);
        });
      });
      this.querySelectorAll('[data-password-toggle]').forEach(function (button) {
        button.addEventListener('click', function () {
          var input = button.parentElement.querySelector('input');
          var reveal = input.type === 'password';
          input.type = reveal ? 'text' : 'password';
          button.setAttribute('aria-label', reveal ? 'Ocultar contraseña' : 'Mostrar contraseña');
        });
      });
    }
  }

  if (!window.customElements.get('weotzi-molecule')) {
    window.customElements.define('weotzi-molecule', WeotziMoleculeElement);
  }

  var NODE_IDS = Object.freeze(Object.keys(METADATA).reduce(function (result, variant) {
    result[variant] = METADATA[variant].nodeId;
    return result;
  }, {}));

  window.WeotziMolecules = Object.freeze({
    metadata: METADATA,
    nodeIds: NODE_IDS,
    variants: Object.freeze(Object.keys(METADATA)),
    render: renderVariant
  });
})();
