(function () {
  'use strict';

  var ATOMIC_META = {
    'weotzi-typography': { node: '1:31', title: 'Typography', size: '1137 × 1075' },
    'weotzi-logos': { node: '3:198', title: 'Logos y elementos', size: '458 × 413' },
    'weotzi-colors': { node: '3:25', title: 'Colors', size: '1458 × 1312' },
    'weotzi-buttons': { node: '4:6', title: 'Buttons', size: '762 × 1373' },
    'weotzi-icons': { node: '4:185', title: 'Icons', size: '861 × 534' },
    'weotzi-checkboxes': { node: '6:525', title: 'Checkbox', size: '887 × 667' },
    'weotzi-avatars': { node: '6:591', title: 'Avatars', size: '376 × 727' },
    'weotzi-system-status': { node: '6:657', title: 'System', size: '493 × 354' },
    'weotzi-input-fields': { node: '6:1800', title: 'Input Field', size: '351 × 1352' },
    'weotzi-toggle-switches': { node: '6:1889', title: 'Toggle Switch', size: '542 × 575' },
    'weotzi-loaders': { node: '6:1949', title: 'Loaders', size: '492 × 524' },
    'weotzi-mood-board': { node: '6:2035', title: 'Mood Board', size: '2707 × 1542' },
    'weotzi-cards': { node: '6:2102', title: 'Cards', size: '1337 × 782' },
    'weotzi-dropdowns': { node: '8:151', title: 'Dropdown', size: '857 × 560' },
    'weotzi-miscellany': { node: '8:193', title: 'Misceláneas', size: '1547 × 1199' },
    'weotzi-tables': { node: '8:487', title: 'Tablas', size: '880 × 553' },
    'weotzi-navigation': { node: '8:816', title: 'Navigation', size: '1520 × 798' },
    'weotzi-tags': { node: '11:32', title: 'Tags', size: '1199 × 1332' },
    'weotzi-charts': { node: '11:256', title: 'Charts', size: '984 × 1375' },
    'weotzi-empty-error': { node: '11:382', title: 'Vacío y error', size: '534 × 885' },
    'weotzi-form-fields': { node: '11:428', title: 'Form Fields', size: '1992 × 1250' }
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function attr(node, name, fallback) {
    var value = node.getAttribute(name);
    return value == null || value === '' ? fallback : value;
  }

  function icon(name, label) {
    return '<i data-wo-icon="' + escapeHtml(name) + '"' +
      (label ? ' aria-label="' + escapeHtml(label) + '"' : ' aria-hidden="true"') + '></i>';
  }

  function define(name, constructor) {
    if (!customElements.get(name)) customElements.define(name, constructor);
  }

  function marks() {
    return '<span class="wods-marks" aria-hidden="true"><i></i><i></i><i></i></span>';
  }

  function board(tag, content, modifier) {
    var meta = ATOMIC_META[tag];
    var naturalWidth = parseFloat(meta.size);
    return '<section class="wods-board' + (modifier ? ' ' + modifier : '') + '" data-figma-node="' + meta.node + '" data-natural-width="' + naturalWidth + '" style="max-width:' + naturalWidth + 'px">' +
      '<header class="wods-board-head"><span class="wods-board-brand">WE ÖTZI</span><span class="wods-board-subtitle">COMPONENT SYSTEM · BAUHAUS EDITION</span><strong class="wods-board-tab">' + escapeHtml(meta.title) + '</strong></header>' +
      '<div class="wods-board-sheet">' + content + '</div></section>';
  }

  function demoButton(label, classes, disabled) {
    return '<button class="wo-btn ' + classes + '" type="button"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
  }

  function renderTypography() {
    var rows = [
      ['HEADLINE 72', 'Archivo Black · 72 / 56', 'Diseño que conecta'],
      ['HEADLINE 56', 'Archivo Black · 56 / 44', 'Encontrá tu próximo tattoo'],
      ['HEADLINE 32', 'Archivo Black · 32 / 40', 'Artistas destacados'],
      ['HEADLINE 24', 'Archivo Black · 24 / 36', 'Reservá tu sesión'],
      ['BODY L', 'Inter Medium · 20 / 30', 'Una comunidad para descubrir artistas, ideas y lugares.'],
      ['BODY M', 'Inter Medium · 16 / 20', 'Explorá portfolios y conectá directamente con tu artista.'],
      ['BODY S', 'Inter Medium · 14 / 21', 'Información de disponibilidad y precios orientativos.'],
      ['BUTTON M', 'Inter Bold · 14 / 21', 'ENVIAR COTIZACIÓN'],
      ['META M', 'JetBrains Mono · 12 / 14', 'BUENOS AIRES · ARGENTINA']
    ];
    return board('weotzi-typography', '<div class="wods-type-list">' + rows.map(function (row, index) {
      return '<article class="wods-type-row"><div><b>' + row[0] + '</b><small>' + row[1] + '</small></div><p class="wods-type-sample wods-type-' + index + '">' + row[2] + '</p></article>';
    }).join('') + '</div>', 'wods-board--wide');
  }

  function renderLogos() {
    return board('weotzi-logos', '<div class="wods-logo-stage"><div class="wods-logo-symbol" aria-label="Isotipo We Ötzi"><i></i><i></i><i></i></div><div class="wods-wordmark">WE ÖTZI</div><div class="wods-logo-lockup"><span class="wods-logo-symbol is-small"><i></i><i></i><i></i></span><strong>WE ÖTZI</strong></div><span class="wods-o-tile">Ö</span></div>');
  }

  function renderColors() {
    var ramps = [
      ['PRIMARIO', ['blue-100', 'blue-200', 'blue-300', 'blue-400', 'blue-500']],
      ['SECUNDARIO', ['red-100', 'red-200', 'red-300', 'red-400', 'red-500']],
      ['TERCIARIO', ['yellow-100', 'yellow-200', 'yellow-300', 'yellow-400', 'yellow-500']],
      ['NEUTRAL', ['neutral-100', 'neutral-200', 'neutral-300', 'neutral-400', 'neutral-500']]
    ];
    var systems = [['success', 'ÉXITO'], ['warning', 'ATENCIÓN'], ['error', 'ERROR']];
    return board('weotzi-colors', '<div class="wods-color-ramps">' + ramps.map(function (ramp) {
      return '<section><h3>' + ramp[0] + '</h3><div class="wods-swatches">' + ramp[1].map(function (token, i) {
        return '<div class="wods-swatch" style="--swatch:var(--' + token + ')"><span>' + (i + 1) + '00</span><code>--' + token + '</code></div>';
      }).join('') + '</div></section>';
    }).join('') + '<section><h3>SISTEMA</h3><div class="wods-system-swatches">' + systems.map(function (s) {
      return '<div style="--swatch:var(--system-' + s[0] + ')"><b>' + s[1] + '</b><code>--system-' + s[0] + '</code></div>';
    }).join('') + '<div style="--swatch:var(--ink)"><b>INK</b><code>--ink</code></div></div></section></div>', 'wods-board--wide');
  }

  function renderButtons() {
    return board('weotzi-buttons', '<div class="wods-component-columns"><section><h3>BOTONES</h3><div class="wods-button-grid">' +
      demoButton('PRINCIPAL', '', false) + demoButton('PRINCIPAL', 'wo-btn--hard', false) +
      demoButton('DIRECTO', 'wo-btn--direct', false) + demoButton('DIRECTO', 'wo-btn--direct wo-btn--hard', false) +
      demoButton('SECUNDARIO', 'wo-btn--secondary', false) + demoButton('SECUNDARIO', 'wo-btn--secondary wo-btn--hard', false) +
      demoButton('DESTACADO', 'wo-btn--accent', false) + demoButton('DESTACADO', 'wo-btn--accent wo-btn--hard', false) +
      demoButton('DESTRUCTIVO', 'wo-btn--danger', false) + demoButton('DESTRUCTIVO', 'wo-btn--danger wo-btn--hard', false) +
      demoButton('NAVEGACIÓN', 'wo-btn--nav', false) + '<button class="wo-btn wo-btn--nav is-active" type="button">NAVEGACIÓN</button>' +
      '</div></section><section><h3>ÍCONOS Y FAB</h3><div class="wods-icon-button-row"><button class="wo-iconbtn is-ink" aria-label="Acción rápida">' + icon('zap') + '</button><button class="wo-iconbtn is-blue" aria-label="Enviar">' + icon('send') + '</button><button class="wods-fab" aria-label="Nuevo">' + icon('plus') + '</button></div><h3>RADIO</h3><div class="wods-radio-list"><label class="wo-radio"><input type="radio" name="wods-radio" checked><span></span>Seleccionado</label><label class="wo-radio"><input type="radio" name="wods-radio"><span></span>Disponible</label><label class="wo-radio"><input type="radio" disabled><span></span>Desactivado</label></div><div class="wods-radio-group"><label><input type="radio" name="size"><span>Pequeño</span></label><label class="is-active"><input type="radio" name="size" checked><span>Mediano</span></label><label><input type="radio" name="size"><span>Grande</span></label></div></section></div>');
  }

  function renderIcons() {
    var names = ['home', 'search', 'zoom-in', 'bell', 'inbox', 'user', 'users', 'settings', 'menu', 'grid', 'calendar', 'bar-chart-2', 'briefcase', 'plus', 'x', 'check', 'check-circle', 'send', 'zap', 'edit', 'trash-2', 'share-2', 'copy', 'filter', 'sliders', 'more-horizontal', 'link', 'chevron-down', 'chevron-up', 'chevron-left', 'chevron-right', 'arrow-right', 'arrow-left', 'map-pin', 'dollar-sign', 'star', 'heart', 'clock', 'eye', 'eye-off', 'lock', 'mail', 'message-circle', 'image', 'instagram', 'pen-tool', 'feather', 'droplet', 'navigation', 'alert-circle', 'alert-triangle', 'info', 'help-circle', 'loader', 'award', 'external-link'];
    return board('weotzi-icons', '<div class="wods-icon-grid">' + names.map(function (name) { return '<div>' + icon(name) + '<code>' + name + '</code></div>'; }).join('') + '</div>', 'wods-board--wide');
  }

  function checkbox(state, label, checked, disabled, mixed) {
    return '<label class="wo-check wods-check' + (mixed ? ' is-mixed' : '') + '"><input type="checkbox"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span></span><b>' + label + '</b><small>' + state + '</small></label>';
  }

  function renderCheckboxes() {
    return board('weotzi-checkboxes', '<div class="wods-component-columns"><section><h3>ESTADOS</h3><div class="wods-check-list">' + checkbox('DEFAULT', 'Sin seleccionar', false, false, false) + checkbox('CHECKED', 'Seleccionado', true, false, false) + checkbox('INDETERMINATE', 'Selección parcial', false, false, true) + checkbox('DISABLED', 'No disponible', false, true, false) + checkbox('CHECKED · DISABLED', 'Seleccionado', true, true, false) + '</div></section><section><h3>LISTA INTERACTIVA</h3><div class="wods-check-panel">' + checkbox('LISTO', 'Preparar boceto', true, false, false) + checkbox('LISTO', 'Confirmar horario', true, false, false) + checkbox('PENDIENTE', 'Reponer tinta', false, false, false) + checkbox('PENDIENTE', 'Enviar referencia', false, false, false) + '</div></section></div>');
  }

  function avatar(size, initials, tone, status) {
    return '<span class="wods-avatar wods-avatar--' + size + ' is-' + tone + '">' + initials + (status ? '<i class="is-' + status + '"></i>' : '') + '</span>';
  }

  function renderAvatars() {
    return board('weotzi-avatars', '<div class="wods-avatar-groups"><section><h3>TAMAÑOS · 32 / 44 / 60</h3><div class="wods-avatar-row">' + avatar('s', 'LM', 'yellow') + avatar('m', 'LM', 'blue') + avatar('l', 'LM', 'red') + '</div></section><section><h3>COLORES</h3><div class="wods-avatar-row">' + avatar('m', 'SM', 'yellow') + avatar('m', 'MR', 'blue') + avatar('m', 'JF', 'red') + avatar('m', 'TV', 'sand') + avatar('m', 'LM', 'ink') + '</div></section><section><h3>ESTADO</h3><div class="wods-avatar-row">' + avatar('l', 'SM', 'blue', 'online') + avatar('l', 'MR', 'red', 'busy') + '</div></section><section><h3>STACK</h3><div class="wods-avatar-stack">' + avatar('m', 'SM', 'yellow') + avatar('m', 'MR', 'blue') + avatar('m', 'JF', 'red') + '<span class="wods-avatar wods-avatar--m is-ink">+8</span></div></section></div>');
  }

  function renderSystemStatus() {
    function phone(dark) { return '<div class="wods-status-phone' + (dark ? ' is-dark' : '') + '"><span>4:24 PM</span><div><i></i><i></i><b>89%</b></div></div>'; }
    return board('weotzi-system-status', '<div class="wods-status-pair"><section><h3>LIGHT</h3>' + phone(false) + '</section><section><h3>DARK</h3>' + phone(true) + '</section></div>');
  }

  function field(label, value, state, iconName, type, placeholder, helper) {
    var stateClass = state === 'error' ? ' wo-textarea--error' : state === 'success' ? ' wo-textarea--success' : '';
    var input = type === 'textarea'
      ? '<textarea class="wo-textarea' + stateClass + '" placeholder="' + escapeHtml(placeholder || '') + '"' + (state === 'disabled' ? ' disabled' : '') + '>' + escapeHtml(value || '') + '</textarea>'
      : '<div class="wods-field-control">' + (iconName ? icon(iconName) : '') + '<input class="wo-input' + (state === 'error' ? ' wo-input--error' : state === 'success' ? ' wo-input--success' : '') + '" type="' + (type || 'text') + '" value="' + escapeHtml(value || '') + '" placeholder="' + escapeHtml(placeholder || '') + '"' + (state === 'disabled' ? ' disabled' : '') + '></div>';
    return '<label class="wo-field wods-field is-' + state + '"><span class="wo-label">' + label + '</span>' + input + (helper ? '<small class="' + (state === 'error' ? 'wo-error-msg' : 'wo-help' + (state === 'success' ? ' is-success' : '')) + '">' + escapeHtml(helper) + '</small>' : '') + '</label>';
  }

  function renderInputFields() {
    return board('weotzi-input-fields', '<div class="wods-fields-stack">' + field('DEFAULT', '', 'default', '', 'text', 'Ingresá un valor') + field('CON VALOR', 'lauumarth.wo', 'value') + field('FOCUS', 'Foco activo', 'focus') + field('ERROR', 'email-invalido', 'error', '', 'email', '', 'Este email no es válido') + field('ÉXITO', 'lau@weotzi.com', 'success', 'check-circle', 'email', '', 'Email verificado') + field('DESHABILITADO', 'Campo bloqueado', 'disabled') + field('CON ÍCONO IZQUIERDO', '', 'default', 'search', 'search', 'Buscar...') + field('TEXTAREA', '', 'default', '', 'textarea', 'Contá algo sobre vos...') + field('PRECIO / NUMÉRICO', '0', 'value', 'dollar-sign', 'number') + field('CONTRASEÑA', 'mipassword123', 'value', 'lock', 'password') + '</div>');
  }

  function renderToggleSwitches() {
    function toggle(label, checked, disabled) { return '<label class="wods-toggle"><span><b>' + label + '</b><small>' + (checked ? 'ON' : 'OFF') + '</small></span><input type="checkbox"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '><i></i></label>'; }
    return board('weotzi-toggle-switches', '<div class="wods-toggle-list">' + toggle('Estado base', false, false) + toggle('Estado activo', true, false) + toggle('Deshabilitado', false, true) + '<hr>' + toggle('Perfil público', true, false) + toggle('Notificaciones', false, false) + toggle('Modo viaje', true, false) + '</div>');
  }

  function renderLoaders() {
    return board('weotzi-loaders', '<div class="wods-loaders"><section><h3>SPINNER · 28</h3><div class="wods-spinner-row"><span class="wo-spinner"></span><span class="wo-spinner is-blue"></span><span class="wo-spinner is-red"></span><span class="wo-spinner is-yellow"></span></div></section><section><h3>PROGRESO · 65%</h3><div class="wo-progress"><i style="width:65%"></i></div></section><section><h3>TRES PUNTOS</h3><span class="wods-dots"><i></i><i></i><i></i></span></section><section><h3>EN BOTÓN</h3><button class="wo-btn" disabled><span class="wo-spinner is-small"></span>ENVIANDO</button></section></div>');
  }

  function renderMoodBoard() {
    var images = [
      ['06', 'MODULAR'], ['02', 'FORMAS DIRECTAS'], ['03', 'DASHBOARD'], ['10', 'LIMPIO'],
      ['11', 'BAUHAUS'], ['07', 'PRODUCTO'], ['08', 'GRILLA'], ['12', 'SATURADO'],
      ['17', 'EDITORIAL'], ['16', 'COLOR'], ['01', 'SISTEMA']
    ];
    return board('weotzi-mood-board', '<div class="wods-mood-intro"><strong>Modular.</strong><strong>Colores saturados.</strong><strong>Limpio y minimalismo.</strong></div><div class="wods-mood-grid">' + images.map(function (item, index) {
      return '<figure class="wods-mood-tile tile-' + (index + 1) + '"><img src="/shared/assets/figma/design-system/mood-board/mood-' + item[0] + '.png" alt="Referencia visual ' + item[1].toLocaleLowerCase('es') + '"><figcaption>' + String(index + 1).padStart(2, '0') + ' · ' + item[1] + '</figcaption></figure>';
    }).join('') + '</div>', 'wods-board--wide');
  }

  function renderCards() {
    return board('weotzi-cards', '<div class="wods-card-grid"><article class="wo-card wods-profile-mini"><span class="wods-avatar wods-avatar--l is-yellow">LM</span><h3>LAUUMARTH</h3><p>@lauumarth.wo</p><span class="wo-badge wo-badge--error">NO VERIFICADO</span><a href="#">Editar perfil →</a></article><article class="wo-card wo-card--inverse wods-modal-card"><span class="wo-eyebrow">CONFIRMAR ACCIÓN</span><h3>¿Eliminar trabajo?</h3><p>Esta acción no se puede deshacer.</p><div>' + demoButton('CANCELAR', 'wo-btn--secondary', false) + demoButton('ELIMINAR', 'wo-btn--danger', false) + '</div></article><weotzi-project-card></weotzi-project-card></div>', 'wods-board--wide');
  }

  function renderDropdowns() {
    return board('weotzi-dropdowns', '<div class="wods-dropdown-grid"><section><h3>DEFAULT</h3><button class="wods-select-button" type="button">Seleccioná una ciudad ' + icon('chevron-down') + '</button></section><section><h3>SELECCIONADO</h3><button class="wods-select-button" type="button">Buenos Aires ' + icon('chevron-down') + '</button></section><section class="is-open"><h3>OPEN</h3><button class="wods-select-button" type="button" aria-expanded="true">Buenos Aires ' + icon('chevron-up') + '</button><div class="wods-select-menu"><button>Buenos Aires</button><button>Córdoba</button><button>Rosario</button><button>Mendoza</button><button>Remoto</button></div></section><section><h3>DISABLED</h3><button class="wods-select-button" type="button" disabled>No disponible ' + icon('chevron-down') + '</button></section></div>');
  }

  function renderMiscellany() {
    return board('weotzi-miscellany', '<div class="wods-misc-grid"><section><h3>STEPPER</h3><div class="wo-stepper"><span class="wo-step is-done">1</span><i class="wo-step-line is-done"></i><span class="wo-step is-done">2</span><i class="wo-step-line is-done"></i><span class="wo-step is-active">3</span><i class="wo-step-line"></i><span class="wo-step">4</span></div></section><section><h3>DIVISORES</h3><hr class="wo-divider"><div class="wods-text-divider"><span>O CONTINUÁ CON</span></div><button class="wods-filter-divider">FINE LINE <span>×</span></button></section><section><h3>PAGINACIÓN</h3><div class="wods-pagination"><button class="is-active">1</button><button>2</button><span>…</span><button>12</button><button>→</button></div></section><section><h3>TABS</h3><nav class="wo-tabs"><button class="wo-tab is-active">COTIZACIONES</button><button class="wo-tab">POSTULACIONES</button><button class="wo-tab">JOB BOARD <b>24</b></button></nav></section><section><h3>BADGES</h3><div class="wods-inline-list"><span class="wo-badge wo-badge--accent">PRO</span><span class="wo-badge wo-badge--info">BETA</span><span class="wo-badge wo-badge--error">SIN VERIFICAR</span><span class="wo-badge wo-badge--success">NUEVO</span><span class="wo-badge wo-badge--outline">BORRADOR</span></div></section><section><h3>TIMELINE</h3><ol class="wods-timeline"><li><i></i><b>Solicitud recibida</b><small>HOY · 10:24</small></li><li><i></i><b>Cotización enviada</b><small>HOY · 12:10</small></li><li><i></i><b>Cliente respondió</b><small>HOY · 14:42</small></li><li><i></i><b>Reserva confirmada</b><small>PENDIENTE</small></li><li><i></i><b>Sesión completada</b><small>PENDIENTE</small></li></ol></section><section class="is-full"><h3>ALERTAS</h3><div class="wods-alerts"><div class="wo-alert wo-alert--success">' + icon('check-circle') + '<span><b>Guardado correctamente</b><small>Los cambios ya están visibles.</small></span><a href="#">VER</a></div><div class="wo-alert wo-alert--error">' + icon('x-circle') + '<span><b>No se pudo completar</b><small>Intentá de nuevo.</small></span><a href="#">REINTENTAR</a></div><div class="wo-alert wo-alert--warning">' + icon('alert-triangle') + '<span><b>Revisá tu agenda</b><small>Tenés un turno por confirmar.</small></span><a href="#">ABRIR</a></div><div class="wo-alert wo-alert--info">' + icon('info') + '<span><b>Nueva oportunidad</b><small>Hay un proyecto cerca tuyo.</small></span><a href="#">EXPLORAR</a></div></div></section></div>', 'wods-board--wide');
  }

  function renderTables() {
    var rows = [['10:00', 'SM', 'Sofía Martínez', 'Primera sesión · Brazo completo', '3H', 'CONFIRMADO'], ['13:30', 'MR', 'Mateo Ruiz', 'Sesión 2/3 · Espalda · dragón', '2H', 'CONFIRMADO'], ['16:00', 'JF', 'Julia Ferrer', 'Retoque · Muñeca', '1H', 'POR CONFIRMAR'], ['18:30', 'TV', 'Tomás Vega', 'Consulta · Boceto nuevo', '45M', 'CONFIRMADO']];
    return board('weotzi-tables', '<div class="wods-table-wrap"><table class="wo-table wods-table"><thead><tr><th>HORA</th><th>CLIENTE</th><th>SESIÓN</th><th>DURACIÓN</th><th>ESTADO</th></tr></thead><tbody>' + rows.map(function (row, i) { return '<tr' + (i === 1 ? ' class="is-selected"' : '') + '><td data-label="Hora"><b>' + row[0] + '</b></td><td data-label="Cliente"><span class="wods-avatar wods-avatar--s is-' + (i % 2 ? 'red' : 'yellow') + '">' + row[1] + '</span><strong>' + row[2] + '</strong></td><td data-label="Sesión">' + row[3] + '</td><td data-label="Duración"><code>' + row[4] + '</code></td><td data-label="Estado"><span class="wo-badge ' + (row[5] === 'CONFIRMADO' ? 'wo-badge--success' : 'wo-badge--accent') + '">' + row[5] + '</span></td></tr>'; }).join('') + '</tbody></table><button class="wo-btn wo-btn--direct wo-btn--block">BLOQUEAR DÍA</button></div>', 'wods-board--wide');
  }

  function productNavMarkup(active) {
    var items = [['cotizaciones', 'COTIZACIONES', '/my-quotations'], ['job-board', 'JOB BOARD', '/job-board'], ['spots', 'SPOTS', '/studio-spots'], ['calendario', 'CALENDARIO', '/calendar'], ['estadisticas', 'ESTADÍSTICAS', '/my-quotations/statistics'], ['travel', 'TRAVEL', '/artist/travel']];
    return '<header class="wods-product-nav"><a class="wods-product-brand" href="/artist/dashboard">WE ÖTZI</a><nav aria-label="Navegación de producto">' + items.map(function (item) { return '<a href="' + item[2] + '"' + (item[0] === active ? ' class="is-active" aria-current="page"' : '') + '>' + item[1] + '</a>'; }).join('') + '</nav><div class="wods-product-account"><a href="/artist/account" aria-label="Perfil">Ö</a><button type="button">LOG OUT</button></div></header>';
  }

  function renderNavigation() {
    return board('weotzi-navigation', '<div class="wods-navigation-demos"><section><h3>DESKTOP · 8:464</h3>' + productNavMarkup('cotizaciones') + '</section><section><h3>MOBILE BOTTOM NAV · 8:280</h3><nav class="wods-bottom-nav" aria-label="Navegación móvil"><a class="is-active">' + icon('home') + '<span>INICIO</span></a><a>' + icon('briefcase') + '<span>TRABAJOS</span></a><a>' + icon('calendar') + '<span>AGENDA</span></a><a>' + icon('user') + '<span>PERFIL</span></a></nav></section><section><h3>SIDEBAR · 8:825</h3><aside class="wods-sidebar"><strong>WE ÖTZI</strong><nav><a class="is-active">' + icon('grid') + 'Dashboard</a><a>' + icon('mail') + 'Cotizaciones</a><a>' + icon('calendar') + 'Calendario</a><a>' + icon('image') + 'Portfolio</a><a>' + icon('settings') + 'Configuración</a></nav><button>' + icon('log-out') + 'Cerrar sesión</button></aside></section></div>', 'wods-board--wide');
  }

  function renderTags() {
    var semantic = [['', 'DEFAULT'], ['wo-tag--filled', 'FILLED'], ['wo-tag--highlight', 'DESTACADO'], ['wo-tag--info', 'INFO'], ['wo-tag--active', 'ACTIVO'], ['wo-tag--urgent', 'URGENTE'], ['wo-tag--archived', 'ARCHIVADO']];
    var selected = ['FINE LINE', 'BLACK & GREY', 'BLACKWORK'];
    return board('weotzi-tags', '<div class="wods-tags-board"><main><section><h3>TAGS · SEMÁNTICOS</h3><div class="wods-tag-row">' + semantic.map(function (tag) { return '<span class="wo-tag ' + tag[0] + '">' + tag[1] + '</span>'; }).join('') + '</div></section><section><h3>TAGS · CON ÍCONO Y DISMISS</h3><div class="wods-tag-row"><span class="wo-tag wo-tag--info">' + icon('map-pin') + 'BUENOS AIRES</span><span class="wo-tag wo-tag--active">' + icon('check') + 'VERIFICADO</span><span class="wo-tag wo-tag--highlight">' + icon('star') + 'DESTACADO</span><span class="wo-tag wo-tag--urgent">PENDIENTE <button aria-label="Quitar pendiente">×</button></span></div></section><section class="wods-tags-results"><a href="#">← EXPLORAR</a><span>JOB BOARD</span><h2>6 solicitudes encontradas</h2><p>Resultados para Fine Line + Black & Grey + Blackwork.</p><div><div class="wods-tag-row">' + selected.map(function (tag) { return '<button class="wo-tag wo-tag--archived">' + tag + '<span>×</span></button>'; }).join('') + '</div><select aria-label="Ordenar solicitudes"><option>Más recientes</option><option>Mayor presupuesto</option></select><div class="wods-view-switch"><button class="is-active" aria-label="Vista en cuadrícula">' + icon('grid') + '</button><button aria-label="Vista en lista">' + icon('menu') + '</button></div></div></section></main><aside class="wods-tags-filters" aria-label="Variantes de filtros"><weotzi-job-filters variant="expanded"></weotzi-job-filters><weotzi-job-filters variant="compact"></weotzi-job-filters></aside></div>', 'wods-board--wide');
  }

  function lineChart() {
    return '<svg class="wods-line-chart" viewBox="0 0 520 190" role="img" aria-label="Crecimiento de visualizaciones de febrero a julio"><g class="grid"><path d="M20 30H500M20 75H500M20 120H500M20 165H500"></path></g><path class="area" d="M20 150L112 136L204 114L296 88L388 65L480 24L480 170L20 170Z"></path><path class="line" d="M20 150L112 136L204 114L296 88L388 65L480 24"></path><g class="points"><circle cx="20" cy="150" r="4"></circle><circle cx="112" cy="136" r="4"></circle><circle cx="204" cy="114" r="4"></circle><circle cx="296" cy="88" r="4"></circle><circle cx="388" cy="65" r="4"></circle><circle cx="480" cy="24" r="4"></circle></g></svg><div class="wods-chart-labels"><span>FEB</span><span>MAR</span><span>ABR</span><span>MAY</span><span>JUN</span><span>JUL</span></div>';
  }

  function bars(items) { return '<div class="wods-bars">' + items.map(function (item) { return '<div><span>' + item[0] + '</span><i><b style="width:' + item[1] + '%"></b></i><strong>' + item[1] + '%</strong></div>'; }).join('') + '</div>'; }

  function renderCharts() {
    var months = [['3.050', 'FEB', 33], ['3.320', 'MAR', 45], ['3.680', 'ABR', 60], ['4.010', 'MAY', 72], ['4.310', 'JUN', 80], ['4.820', 'JUL', 100]];
    var styles = [['Blackwork', 34, 'yellow'], ['Realismo', 27, 'blue'], ['Fine line', 19, 'ink'], ['Dotwork', 12, 'yellow'], ['Old school', 8, 'sand']];
    var cities = [['Buenos Aires', 38, 4], ['Córdoba', 16, 2], ['Madrid', 12, 1], ['Ciudad de México', 10, 1], ['Santiago', 9, 1], ['Barcelona', 8, 1], ['Otras ciudades', 7, 1]];
    var works = [['01', 'Jaguar en blackwork', '2.340', 100], ['02', 'Retrato realista — brazo', '1.860', 80], ['03', 'Line art minimalista', '1.120', 48]];
    return board('weotzi-charts', '<div class="wods-chart-grid">' +
      '<article class="wods-chart-hero"><span>VISUALIZACIONES DEL PERFIL</span><strong>4.820</strong><div><b>+12%</b><small>vs. mes anterior</small></div><em><b>1.340</b> VISITAS AL PORTAFOLIO</em></article>' +
      '<article class="wods-donut-card"><div class="wods-donut"><span><b>86%</b><small>TASA DE<br>RESPUESTA</small></span></div></article>' +
      '<article class="wods-chart-metrics"><div><b>86</b><span>SOLICITUDES<br>RECIBIDAS</span></div><div><b>74</b><span>COTIZACIONES<br>RESPONDIDAS</span></div><div><b>21</b><span>RESERVAS<br>CONFIRMADAS</span></div></article>' +
      '<article class="wods-chart-revenue"><span>INGRESOS<br>GENERADOS</span><i aria-hidden="true"></i><strong>$3.150.000</strong></article>' +
      '<article class="wods-chart-conversion"><span>CONVERSIÓN DE VISITAS A RESERVAS</span><strong>1,6%</strong><i aria-hidden="true"></i></article>' +
      '<article class="wods-growth-chart"><header><h3>CRECIMIENTO MENSUAL · VISUALIZACIONES</h3><code>+12% JUL</code></header><div>' + months.map(function (month, index) { return '<p' + (index === months.length - 1 ? ' class="is-current"' : '') + '><em>' + month[0] + '</em><i style="height:' + month[2] + '%"></i><span>' + month[1] + '</span></p>'; }).join('') + '</div></article>' +
      '<article class="wods-style-chart"><h3>ESTILOS MÁS SOLICITADOS</h3><div>' + styles.map(function (style) { return '<p><span>' + style[0] + '</span><i><b class="is-' + style[2] + '" style="width:' + style[1] + '%"></b></i><strong>' + style[1] + '%</strong></p>'; }).join('') + '</div></article>' +
      '<article class="wods-city-chart"><h3>CIUDADES CON MAYOR INTERÉS</h3><div>' + cities.map(function (city) { return '<p><span>' + city[0] + '</span><i>' + Array.from({ length: 10 }, function (_, i) { return '<b' + (i < city[2] ? ' class="is-active"' : '') + '></b>'; }).join('') + '</i><strong>' + city[1] + '%</strong></p>'; }).join('') + '</div></article>' +
      '<article class="wods-top-works"><h3>TRABAJOS MÁS VISTOS</h3><ol>' + works.map(function (work) { return '<li><span>' + work[0] + '</span><div><b>' + work[1] + '</b><i><em style="width:' + work[3] + '%"></em></i></div><strong>' + work[2] + '</strong></li>'; }).join('') + '</ol></article>' +
      '<article class="wods-income-summary"><h3>Ingresos</h3><div><p><strong>$4.820</strong><span>FACTURACIÓN MENSUAL</span></p><p><strong>$1.240</strong><span>FACTURACIÓN SEMANAL</span></p><p class="is-success"><strong>$920</strong><span>SEÑAS RECIBIDAS</span></p><p class="is-error"><strong>$650</strong><span>SALDO PENDIENTE</span></p></div><footer><span>META MENSUAL · $6.000</span><b>80%</b><i><em style="width:80%"></em></i></footer></article>' +
      '</div>', 'wods-board--wide');
  }

  function renderEmptyError() {
    return board('weotzi-empty-error', '<div class="wods-empty-stack"><section class="wods-error-state"><span>404</span><h3>Esta página no está disponible</h3><p>Puede que el enlace haya cambiado o ya no exista.</p><div>' + demoButton('VOLVER AL INICIO', 'wo-btn--direct', false) + demoButton('REPORTAR ERROR', 'wo-btn--secondary', false) + '</div></section><section class="wo-empty"><div class="wods-empty-symbol">' + marks() + '</div><h3 class="wo-empty-title">No encontramos resultados</h3><p>Probá quitando filtros o buscando otra ciudad.</p>' + demoButton('LIMPIAR FILTROS', 'wo-btn--accent', false) + '</section><section class="wods-blank"><span>PÁGINA VACÍA</span></section></div>');
  }

  function renderFormFields() {
    var brand = '<a class="wods-auth-brand" href="#">' + marks() + 'WE ÖTZI</a>';
    var signup = '<form class="wods-signup-card">' + brand + '<h3>Crea tu cuenta</h3><p>Empieza hoy como artista.</p><label>NOMBRE COMPLETO *<input type="text" placeholder="Tu nombre"></label><div class="wods-signup-row"><label>EMAIL *<input type="email" placeholder="tu@email.com"></label><label>CIUDAD<input type="text" value="Buenos Aires"></label></div><label>ESTILO *<select><option>Seleccioná tú estilo principal</option></select></label><label class="wods-signup-terms"><input type="checkbox">Acepto los términos y condiciones</label><button type="submit">registrarme</button><div class="wods-text-divider"><span>O CONTINUÁ CON</span></div><em>Recomendado</em><div class="wods-auth-social"><button type="button">INSTAGRAM</button><button type="button">EMAIL</button><button type="button">FACEBOOK</button></div><small>¿Ya tienes CUENTA? <a href="#">Ingresar</a></small></form>';
    var rating = '<section class="wods-rating-specimen"><h3>RATING · INTERACTIVO</h3><div class="wods-rating-row is-empty"><span>★★★★★</span><b>0</b><small>Sin calificar</small></div><h3>RATING · SOLO LECTURA</h3><div class="wods-rating-row"><span>★★★★★</span><b>4.8</b><small>(127 reseñas)</small></div><div class="wods-rating-row is-medium"><span>★★★<i>★★</i></span><b>3.2</b><small>(8 reseñas)</small></div><h3>DISTRIBUCIÓN</h3><div class="wods-rating-distribution">' + bars([['5', 72], ['4', 18], ['3', 6], ['2', 3], ['1', 1]]) + '</div></section>';
    var textareas = '<section class="wods-textarea-specimens"><h3>TEXTAREA · ESTADOS</h3><div><label><span>DEFAULT</span><textarea placeholder="Contá tu idea..."></textarea><small><b>0 / 300</b><em>CON CONTADOR</em></small></label><label class="is-focus"><span>FOCUS</span><textarea placeholder="Foco activo..."></textarea><small>FOCUS STATE</small></label><label class="is-error"><span>ERROR</span><textarea>Muy corto</textarea><small><b>Mínimo 50 caracteres</b><em>ERROR</em></small></label><label class="is-disabled"><span>DISABLED</span><textarea disabled placeholder="Campo bloqueado"></textarea><small>DISABLED</small></label></div><label class="is-auto"><span>TEXTAREA · AUTOEXPANDIBLE</span><b>AUTOEXPANDIBLE</b><textarea>Este campo crece con el contenido...</textarea><small>MIN-HEIGHT: 44PX · CRECE AUTOMÁTICAMENTE</small></label></section>';
    var sliders = '<section class="wods-slider-examples"><h3>SLIDER · VARIANTES</h3><label><span>PRESUPUESTO MÁXIMO <b>USD 250</b></span><input type="range" min="0" max="1000" value="250"><small><b>USD 0</b><b>USD 500</b><b>USD 1000</b></small></label><label><span>TAMAÑO <b>20 cm</b></span><input type="range" min="1" max="40" value="20"><small><b>1cm</b><b>20cm</b><b>40cm</b></small></label><div class="wods-double-range"><span>RANGO DE PRECIO <b>USD 50 — 400</b></span><div><input aria-label="Precio mínimo" type="range" min="0" max="1000" value="50"><input aria-label="Precio máximo" type="range" min="0" max="1000" value="400"></div><small><b>USD 0</b><b>USD 1000</b></small><em>RANGE SLIDER · DOBLE THUMB</em></div></section>';
    var upload = '<section class="wods-upload-examples"><h3>FILE UPLOAD · VARIANTES</h3><span>PREVIEW DE ARCHIVOS</span><div class="wods-upload-list"><p><b>Cotizacion_2026.pdf</b><small>2.4 MB</small><button aria-label="Quitar Cotizacion_2026.pdf">×</button></p><p><b>Referencia.jpg</b><small>1.1 MB</small><button aria-label="Quitar Referencia.jpg">×</button></p><p class="is-progress"><b>Zona_tattoo.png</b><small>Subiendo... 72%</small><i><em style="width:72%"></em></i><button aria-label="Quitar Zona_tattoo.png">×</button></p></div><span>DROP ZONE</span><label class="wo-dropzone">' + icon('upload') + '<b>Arrastrá o hacé click</b><small>PNG, JPG, PDF · máx. 10MB</small><input type="file" hidden></label></section>';
    return board('weotzi-form-fields', '<div class="wods-form-layout"><div class="wods-form-top"><weotzi-quote-form></weotzi-quote-form><weotzi-auth-form></weotzi-auth-form>' + signup + rating + '</div><div class="wods-form-bottom">' + textareas + sliders + upload + '</div></div>', 'wods-board--wide');
  }

  var RENDERERS = {
    'weotzi-typography': renderTypography, 'weotzi-logos': renderLogos, 'weotzi-colors': renderColors,
    'weotzi-buttons': renderButtons, 'weotzi-icons': renderIcons, 'weotzi-checkboxes': renderCheckboxes,
    'weotzi-avatars': renderAvatars, 'weotzi-system-status': renderSystemStatus, 'weotzi-input-fields': renderInputFields,
    'weotzi-toggle-switches': renderToggleSwitches, 'weotzi-loaders': renderLoaders, 'weotzi-mood-board': renderMoodBoard,
    'weotzi-cards': renderCards, 'weotzi-dropdowns': renderDropdowns, 'weotzi-miscellany': renderMiscellany,
    'weotzi-tables': renderTables, 'weotzi-navigation': renderNavigation, 'weotzi-tags': renderTags,
    'weotzi-charts': renderCharts, 'weotzi-empty-error': renderEmptyError, 'weotzi-form-fields': renderFormFields
  };

  class AtomicShowcase extends HTMLElement {
    static get observedAttributes() { return ['variant']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() { var renderer = RENDERERS[this.localName]; if (renderer) this.innerHTML = renderer(this); if (window.WoIcons) window.WoIcons.hydrate(this); }
  }

  class WeotziProjectCard extends HTMLElement {
    static get observedAttributes() { return ['project-id', 'title', 'tags', 'location', 'price', 'meta', 'tone', 'new']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      var id = attr(this, 'project-id', 'JB-59407');
      var title = attr(this, 'title', 'Calavera con auriculares y notas musicales, estilo new school');
      var tags = attr(this, 'tags', 'NEW SCHOOL,TRADICIONAL').split(',').filter(Boolean);
      var location = attr(this, 'location', 'Medellín · Hombro');
      var price = attr(this, 'price', '$200 – $400');
      var meta = attr(this, 'meta', '4 postulaciones');
      var tone = attr(this, 'tone', 'blue');
      var isNew = this.getAttribute('new') !== 'false';
      this.innerHTML = '<article class="wo-project-card wo-project-card--' + escapeHtml(tone) + '"><div class="wo-project-media"><span class="wo-project-id">' + escapeHtml(id) + '</span>' + (isNew ? '<span class="wo-badge wo-badge--s wo-badge--accent">NEW</span>' : '') + '<button class="wo-project-favorite" type="button" aria-label="Guardar proyecto" aria-pressed="false">' + icon('heart') + '</button><span class="wo-project-shape" aria-hidden="true"></span></div><div class="wo-project-body"><h3>' + escapeHtml(title) + '</h3><div class="wo-project-tags">' + tags.map(function (tag) { return '<span>' + escapeHtml(tag.trim()) + '</span>'; }).join('') + '</div><p class="wo-project-location">' + icon('map-pin') + '<span>' + escapeHtml(location) + '</span></p><div class="wo-project-footer"><div><strong>' + escapeHtml(price) + '</strong><small>' + escapeHtml(meta) + '</small></div><a class="wo-btn wo-btn--direct wo-btn--s" href="#oportunidades">POSTULARME →</a></div></div></article>';
      var favorite = this.querySelector('.wo-project-favorite');
      favorite.addEventListener('click', function () { var pressed = favorite.getAttribute('aria-pressed') === 'true'; favorite.setAttribute('aria-pressed', String(!pressed)); favorite.setAttribute('aria-label', pressed ? 'Guardar proyecto' : 'Quitar de guardados'); });
      if (window.WoIcons) window.WoIcons.hydrate(this);
    }
  }

  class WeotziHeader extends HTMLElement {
    static get observedAttributes() { return ['variant', 'active']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      var variant = attr(this, 'variant', 'docs');
      if (variant === 'product') { this.innerHTML = customElements.get('weotzi-product-nav') ? '<weotzi-product-nav active="' + escapeHtml(attr(this, 'active', 'cotizaciones')) + '"></weotzi-product-nav>' : productNavMarkup(attr(this, 'active', 'cotizaciones')); return; }
      var active = attr(this, 'active', 'componentes');
      var items = [['componentes', 'Componentes', '/componentes/'], ['compuestos', 'Compuestos', '/componentes/compuestos/'], ['tokens', 'Tokens', '/componentes/#tokens']];
      this.innerHTML = '<header class="wo-site-header"><a class="wo-site-brand" href="/componentes/">' + marks() + '<span>WE ÖTZI</span></a><nav aria-label="Documentación">' + items.map(function (item) { return '<a href="' + item[2] + '"' + (active === item[0] ? ' class="is-active" aria-current="page"' : '') + '>' + item[1] + '</a>'; }).join('') + '</nav><a class="wo-site-cta" href="/">IR AL SITIO →</a></header>';
    }
  }

  class WeotziProfileCard extends HTMLElement {
    connectedCallback() { this.innerHTML = '<aside class="wo-profile-card">' + marks() + '<div class="wo-profile-avatar">' + escapeHtml(attr(this, 'initials', 'LM')) + '</div><div class="wo-profile-name"><strong>' + escapeHtml(attr(this, 'name', 'LAUUMARTH')) + '</strong><span>' + escapeHtml(attr(this, 'handle', '@lauumarth.wo')) + '</span></div><div class="wo-profile-badges"><span class="wo-badge wo-badge--error">NO VERIFICADO</span><span class="wo-badge wo-badge--info">NUEVO</span></div><p class="wo-profile-meta">$150 / SESIÓN · 1 ESTILO · 0-1 AÑOS</p><a class="wo-profile-link" href="#perfil">Editar perfil →</a></aside>'; }
  }

  class WeotziStatGrid extends HTMLElement { connectedCallback() { this.innerHTML = '<weotzi-statistics-dashboard></weotzi-statistics-dashboard>'; } }
  class WeotziFooter extends HTMLElement { connectedCallback() { this.innerHTML = '<footer class="wo-site-footer"><div><strong>WE ÖTZI</strong><span>Biblioteca de interfaz · Figma ' + escapeHtml(attr(this, 'figma-node', '0:1')) + '</span></div><nav><a href="/componentes/">Componentes</a><a href="/componentes/compuestos/">Compuestos</a><a href="https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi">Figma</a></nav></footer>'; } }

  Object.keys(RENDERERS).forEach(function (tag) { define(tag, class extends AtomicShowcase {}); });
  define('weotzi-project-card', WeotziProjectCard);
  define('weotzi-header', WeotziHeader);
  define('weotzi-profile-card', WeotziProfileCard);
  define('weotzi-stat-grid', WeotziStatGrid);
  define('weotzi-footer', WeotziFooter);

  window.WeotziAtomicComponents = { meta: ATOMIC_META, productNavMarkup: productNavMarkup, renderers: RENDERERS };
})();
