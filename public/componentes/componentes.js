(() => {
  "use strict";

  const FIGMA_FILE = "https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi";
  const VIEWPORTS = Object.freeze({ desktop: 1440, tablet: 768, mobile: 390 });

  const CATEGORY_COPY = Object.freeze({
    "Fundaciones": "Tipografía, marca, color y dirección visual. Estas referencias fijan el lenguaje antes de componer controles o pantallas.",
    "Acciones y entrada": "Controles interactivos y captura de datos con todos los estados visibles en los boards de Figma.",
    "Identidad y estado": "Recursos que comunican identidad, contexto, progreso, feedback y clasificación.",
    "Contenido y datos": "Patrones para agrupar contenido, navegar, tabular información y explicar estados vacíos o de error.",
    "Moléculas": "Las 28 composiciones intermedias del nodo 11:782: componentes agrupados que conservan una responsabilidad concreta antes de formar organismos."
  });

  const COMPONENT_REFERENCES = Object.freeze([
    {
      category: "Fundaciones", id: "tipografia", title: "Tipografía", nodeId: "1:31", width: 1137, height: 1075,
      tag: "weotzi-typography", description: "Escala completa de Archivo Black, Inter y JetBrains Mono con títulos, cuerpo y metadatos.",
      states: "Display, headings, body, labels y mono"
    },
    {
      category: "Fundaciones", id: "logos", title: "Logos y elementos", nodeId: "3:198", width: 458, height: 413,
      tag: "weotzi-logos", description: "Wordmark WE ÖTZI y las primitivas Bauhaus cuadrado, círculo y triángulo.",
      states: "Marca y símbolos"
    },
    {
      category: "Fundaciones", id: "colores", title: "Colores", nodeId: "3:25", width: 1458, height: 1312,
      tag: "weotzi-colors", description: "Rampas azul, roja, amarilla y neutral, más los colores semánticos de sistema.",
      states: "Blue, red, yellow, neutral y system"
    },
    {
      category: "Acciones y entrada", id: "botones", title: "Botones", nodeId: "4:6", width: 762, height: 1373,
      tag: "weotzi-buttons", description: "Acciones sólidas y hard-shadow, botones con icono, FAB y grupos de radio.",
      states: "Default, hover, focus, disabled y selección"
    },
    {
      category: "Identidad y estado", id: "iconos", title: "Iconos", nodeId: "4:185", width: 861, height: 534,
      tag: "weotzi-icons", description: "Inventario de glyphs de interfaz usados por navegación, acciones, estado y contenido.",
      states: "Más de 50 glyphs"
    },
    {
      category: "Acciones y entrada", id: "checkbox", title: "Checkbox", nodeId: "6:525", width: 887.47, height: 667.46,
      tag: "weotzi-checkboxes", description: "Checkbox individual y listas de selección con lectura clara de estado.",
      states: "Unchecked, checked, mixed, focus y disabled"
    },
    {
      category: "Identidad y estado", id: "avatares", title: "Avatares", nodeId: "6:591", width: 376, height: 727.4,
      tag: "weotzi-avatars", description: "Escala de avatar, iniciales, color, presencia y agrupaciones superpuestas.",
      states: "Tamaños, color, stack y status"
    },
    {
      category: "Identidad y estado", id: "sistema", title: "System", nodeId: "6:657", width: 493, height: 354,
      tag: "weotzi-system-status", description: "Barra de estado móvil en temas claro y oscuro, alineada al lenguaje del producto.",
      states: "Light y dark"
    },
    {
      category: "Acciones y entrada", id: "campos-input", title: "Input Field", nodeId: "6:1800", width: 351, height: 1352,
      tag: "weotzi-input-fields", description: "Campos de texto, número y contraseña con feedback, ayudas e iconos contextuales.",
      states: "Default, value, focus, error, success y disabled"
    },
    {
      category: "Acciones y entrada", id: "toggle-switch", title: "Toggle Switch", nodeId: "6:1889", width: 542, height: 575.2,
      tag: "weotzi-toggle-switches", description: "Interruptores binarios y ejemplos de uso con etiqueta y descripción.",
      states: "Off, on y disabled"
    },
    {
      category: "Identidad y estado", id: "loaders", title: "Loaders", nodeId: "6:1949", width: 492, height: 524,
      tag: "weotzi-loaders", description: "Indicadores de carga para página, proceso y acción sin perder el contexto del usuario.",
      states: "Progress, dots, spinner y button loading"
    },
    {
      category: "Fundaciones", id: "mood-board", title: "Mood Board", nodeId: "6:2035", width: 2707, height: 1542,
      tag: "weotzi-mood-board", description: "Tres direcciones visuales del sistema que conectan composición, contraste y tratamiento de imagen.",
      states: "Modular, saturado y minimal"
    },
    {
      category: "Contenido y datos", id: "tarjetas", title: "Cards", nodeId: "6:2102", width: 1337, height: 782,
      tag: "weotzi-cards", description: "Tarjetas de perfil, modal y proyecto con jerarquías y acciones distintas.",
      states: "Perfil, modal y proyecto"
    },
    {
      category: "Acciones y entrada", id: "dropdown", title: "Dropdown", nodeId: "8:151", width: 857, height: 560,
      tag: "weotzi-dropdowns", description: "Selector cerrado, menú desplegado y estado no disponible.",
      states: "Default, open y disabled"
    },
    {
      category: "Contenido y datos", id: "miscelaneas", title: "Misceláneas", nodeId: "8:193", width: 1547, height: 1199,
      tag: "weotzi-miscellany", description: "Piezas auxiliares del sistema reunidas en una matriz de variantes y estados.",
      states: "Stepper, divider, pagination, tabs, badges, timeline y alerts"
    },
    {
      category: "Contenido y datos", id: "tablas", title: "Tablas", nodeId: "8:487", width: 880, height: 553,
      tag: "weotzi-tables", description: "Tabla de agenda con encabezado, filas, jerarquía temporal y acciones.",
      states: "Agenda"
    },
    {
      category: "Contenido y datos", id: "navegacion", title: "Navigation", nodeId: "8:816", width: 1520, height: 798,
      tag: "weotzi-navigation", description: "Sistemas de navegación superior, inferior y lateral incluidos en el UI Kit.",
      states: "Desktop, bottom bar y sidebar"
    },
    {
      category: "Identidad y estado", id: "tags", title: "Tags", nodeId: "11:32", width: 1199, height: 1332,
      tag: "weotzi-tags", description: "Etiquetas semánticas y contextuales, con ejemplos aplicados a resultados y filtros.",
      states: "Semánticos, contextuales, resultados y filtros"
    },
    {
      category: "Contenido y datos", id: "charts", title: "Charts", nodeId: "11:256", width: 984, height: 1375,
      tag: "weotzi-charts", description: "Panel de visualización con métricas, barras, líneas, distribución y progreso.",
      states: "Dashboard de estadísticas"
    },
    {
      category: "Contenido y datos", id: "vacio-error", title: "Vacío y error", nodeId: "11:382", width: 534, height: 885,
      tag: "weotzi-empty-error", description: "Estados sin resultados y fallos recuperables con mensaje, contexto y siguiente acción.",
      states: "Empty y error"
    },
    {
      category: "Acciones y entrada", id: "form-fields", title: "Form Fields", nodeId: "11:428", width: 1992, height: 1250,
      tag: "weotzi-form-fields", description: "Conjunto de formularios avanzados para rating, sliders y carga de archivos.",
      states: "Forms, rating, sliders y file upload"
    },
    {
      category: "Moléculas", id: "molecula-ingresos-lateral", title: "Ingresos lateral", nodeId: "21:7026", width: 241, height: 135,
      tag: "weotzi-molecule", variant: "ingresos-lateral", previewHeight: 320,
      description: "Resumen vertical de ingresos para el rail del dashboard.",
      states: "Total mensual, semana y saldo pendiente"
    },
    {
      category: "Moléculas", id: "molecula-acciones-rapidas", title: "Acciones rápidas", nodeId: "21:7025", width: 212.815, height: 137.9,
      tag: "weotzi-molecule", variant: "acciones-rapidas", previewHeight: 320,
      description: "Grupo compacto de accesos para las operaciones frecuentes del artista.",
      states: "Nuevo cliente, nueva cita y registrar pago"
    },
    {
      category: "Moléculas", id: "molecula-recordatorios", title: "Recordatorios", nodeId: "21:7024", width: 212.815, height: 105.65,
      tag: "weotzi-molecule", variant: "recordatorios", previewHeight: 300,
      description: "Lista breve de pendientes priorizados dentro del rail.",
      states: "Pendientes y siguiente acción"
    },
    {
      category: "Moléculas", id: "molecula-ingresos-estadisticas", title: "Ingresos estadísticas", nodeId: "21:7027", width: 484.107, height: 136.85,
      tag: "weotzi-molecule", variant: "ingresos-estadisticas", previewHeight: 320,
      description: "Métricas financieras horizontales con lectura comparativa.",
      states: "Ingresos, semana, pendiente y recibido"
    },
    {
      category: "Moléculas", id: "molecula-barra-progreso", title: "Barra de progreso", nodeId: "21:7028", width: 484.107, height: 28.94,
      tag: "weotzi-molecule", variant: "barra-progreso", previewHeight: 260,
      description: "Indicador de avance hacia la meta mensual de ingresos.",
      states: "Meta $6.000 · 80%"
    },
    {
      category: "Moléculas", id: "molecula-proximos-turnos", title: "Próximos turnos", nodeId: "21:7032", width: 188.4, height: 346.13,
      tag: "weotzi-molecule", variant: "proximos-turnos",
      description: "Listado vertical de citas próximas con cliente, hora y estado.",
      states: "Valentina Ríos, Diego Lamas y dos huecos libres"
    },
    {
      category: "Moléculas", id: "molecula-agenda-lateral-1", title: "Agenda lateral 1", nodeId: "21:7033", width: 535.655, height: 345.6,
      tag: "weotzi-molecule", variant: "agenda-lateral-1",
      description: "Primera composición lateral de agenda con citas del día.",
      states: "Agenda del día · variante 1"
    },
    {
      category: "Moléculas", id: "molecula-disenos-en-proceso", title: "Diseños en proceso", nodeId: "21:7034", width: 716, height: 282.897,
      tag: "weotzi-molecule", variant: "disenos-en-proceso",
      description: "Seguimiento visual de trabajos activos y su porcentaje de avance.",
      states: "Manga floral, Dragón espalda y Mandala geométrico"
    },
    {
      category: "Moléculas", id: "molecula-agenda-lateral-2", title: "Agenda lateral 2", nodeId: "21:7035", width: 716.4, height: 362.13,
      tag: "weotzi-molecule", variant: "agenda-lateral-2",
      description: "Segunda composición de agenda, ampliada para convivir con otros módulos.",
      states: "Agenda del día · variante 2"
    },
    {
      category: "Moléculas", id: "molecula-titulares-subtitulos", title: "Titulares y subtítulos", nodeId: "21:7036", width: 1527.2, height: 96.2,
      tag: "weotzi-molecule", variant: "titulares-subtitulos", previewHeight: 300,
      description: "Jerarquía de encabezados reutilizada por las páginas de resultados.",
      states: "Eyebrow, título y texto contextual"
    },
    {
      category: "Moléculas", id: "molecula-carrusel", title: "Carrusel", nodeId: "21:7038", width: 1527.2, height: 511.8,
      tag: "weotzi-molecule", variant: "carrusel",
      description: "Carrusel horizontal de cinco oportunidades del Job Board.",
      states: "5 tarjetas · scroll horizontal"
    },
    {
      category: "Moléculas", id: "molecula-encabezado-resultados", title: "Encabezado de resultados", nodeId: "21:7037", width: 1527.2, height: 201.799,
      tag: "weotzi-molecule", variant: "encabezado-resultados",
      description: "Resumen de búsqueda con cantidad, filtros activos, orden y cambio de vista.",
      states: "6 solicitudes · tags · sort · grid/list"
    },
    {
      category: "Moléculas", id: "molecula-filtros-laterales", title: "Filtros laterales", nodeId: "21:7039", width: 282, height: 1089,
      tag: "weotzi-molecule", variant: "filtros-laterales",
      description: "Panel completo de filtros para refinar oportunidades.",
      states: "Expandido"
    },
    {
      category: "Moléculas", id: "molecula-filtros-comprimidos", title: "Filtros comprimidos", nodeId: "21:7040", width: 74, height: 704,
      tag: "weotzi-molecule", variant: "filtros-comprimidos",
      description: "Versión iconográfica del panel de filtros para espacios estrechos.",
      states: "Comprimido"
    },
    {
      category: "Moléculas", id: "molecula-informacion-perfil", title: "Información de perfil", nodeId: "21:7031", width: 278, height: 112.2,
      tag: "weotzi-molecule", variant: "informacion-perfil", previewHeight: 300,
      description: "Badges, tarifa y acceso de edición para completar la información del artista.",
      states: "No verificado · nuevo · $150 / sesión"
    },
    {
      category: "Moléculas", id: "molecula-perfil", title: "Perfil", nodeId: "21:7030", width: 266.4, height: 158,
      tag: "weotzi-molecule", variant: "perfil", previewHeight: 340,
      description: "Tarjeta compacta del artista con avatar e información principal.",
      states: "LM · @lauumarth.wo"
    },
    {
      category: "Moléculas", id: "molecula-mosaico-seccion", title: "Mosaico de sección", nodeId: "21:7449", width: 1036.641, height: 679.463,
      tag: "weotzi-molecule", variant: "mosaico-seccion",
      description: "Mosaico editorial de estudios dentro de la exploración de Spots.",
      states: "Tarjetas de estudio · ticker"
    },
    {
      category: "Moléculas", id: "molecula-barra-herramientas-resultados", title: "Barra de herramientas de resultados", nodeId: "21:7450", width: 1036.641, height: 118.9,
      tag: "weotzi-molecule", variant: "barra-herramientas-resultados", previewHeight: 320,
      description: "Encabezado de Spots con edición activa y filtros de categoría.",
      states: "Todos, residencias, itinerantes y guest spots"
    },
    {
      category: "Moléculas", id: "molecula-galeria-trabajos-2", title: "Galería de trabajos 2", nodeId: "21:7350", width: 1180, height: 1095,
      tag: "weotzi-molecule", variant: "galeria-trabajos-2",
      description: "Galería de portfolio extendida con carga y herramientas de edición.",
      states: "Variante extendida"
    },
    {
      category: "Moléculas", id: "molecula-galeria-trabajos", title: "Galería de trabajos", nodeId: "21:7245", width: 1180, height: 731.2,
      tag: "weotzi-molecule", variant: "galeria-trabajos",
      description: "Galería compacta para exhibir y gestionar el portfolio.",
      states: "Variante compacta"
    },
    {
      category: "Moléculas", id: "molecula-tabla-contenido", title: "Tabla de contenido", nodeId: "21:7454", width: 833, height: 511,
      tag: "weotzi-molecule", variant: "tabla-contenido",
      description: "Panel principal de estadísticas con visualizaciones, ingresos, conversión y crecimiento.",
      states: "KPIs, donut, ingresos y evolución mensual"
    },
    {
      category: "Moléculas", id: "molecula-tabla-porcentual-2", title: "Tabla porcentual 2", nodeId: "21:7453", width: 409.916, height: 167.2,
      tag: "weotzi-molecule", variant: "tabla-porcentual-2", previewHeight: 340,
      description: "Tabla compacta de distribución porcentual en su segunda variante.",
      states: "Porcentajes · variante 2"
    },
    {
      category: "Moléculas", id: "molecula-tabla-porcentaje", title: "Tabla porcentual", nodeId: "21:7452", width: 832.844, height: 169.4,
      tag: "weotzi-molecule", variant: "tabla-porcentaje", previewHeight: 340,
      description: "Distribución porcentual amplia para el dashboard de estadísticas.",
      states: "Porcentajes · variante principal"
    },
    {
      category: "Moléculas", id: "molecula-actividad-reciente", title: "Actividad reciente", nodeId: "21:7247", width: 263, height: 122.84,
      tag: "weotzi-molecule", variant: "actividad-reciente", previewHeight: 300,
      description: "Lista cronológica de cambios y eventos recientes.",
      states: "Evento y timestamp"
    },
    {
      category: "Moléculas", id: "molecula-cotizaciones-preview", title: "Cotizaciones preview", nodeId: "21:7248", width: 433, height: 125.85,
      tag: "weotzi-molecule", variant: "cotizaciones-preview", previewHeight: 300,
      description: "Vista resumida de cotizaciones por estado.",
      states: "Pendientes, aprobadas y rechazadas"
    },
    {
      category: "Moléculas", id: "molecula-form-cotizacion", title: "Formulario de cotización", nodeId: "21:7086", width: 400, height: 476,
      tag: "weotzi-molecule", variant: "form-cotizacion",
      description: "Formulario molecular para solicitar una cotización de tatuaje.",
      states: "Datos, idea y envío"
    },
    {
      category: "Moléculas", id: "molecula-form-inicio", title: "Formulario de inicio", nodeId: "21:7162", width: 380, height: 514.6,
      tag: "weotzi-molecule", variant: "form-inicio",
      description: "Flujo de ingreso con credenciales, ayuda y alternativas.",
      states: "Email, contraseña y recuperar acceso"
    },
    {
      category: "Moléculas", id: "molecula-form-crear-cuenta", title: "Formulario de crear cuenta", nodeId: "21:7244", width: 380, height: 452,
      tag: "weotzi-molecule", variant: "form-crear-cuenta", previewHeight: 620,
      description: "Registro compacto para crear una cuenta nueva.",
      states: "Datos de cuenta y acción principal"
    }
  ]);

  const normalizeSearch = (value) => String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const nodeUrl = (nodeId, figmaFile = FIGMA_FILE) => `${figmaFile}?node-id=${String(nodeId).replaceAll(":", "-")}`;
  const naturalSize = (item) => item.natural || `${item.width} × ${item.height} px`;
  const selectedVariant = (item) => item.variant || item.variants?.[0]?.value || "";

  function componentCode(item, variant = selectedVariant(item)) {
    const attributes = [];
    if (variant) attributes.push(`variant="${variant}"`);
    for (const [name, value] of Object.entries(item.attributes || {})) attributes.push(`${name}="${value}"`);
    const suffix = attributes.length ? `\n  ${attributes.join("\n  ")}` : "";
    return `<${item.tag}${suffix}></${item.tag}>`;
  }

  function previewUrl(item, variant = selectedVariant(item)) {
    const params = new URLSearchParams({ component: item.tag });
    if (variant) params.set("variant", variant);
    return `/componentes/preview/?${params.toString()}`;
  }

  function itemNodes(item) {
    if (item.variants?.length) return item.variants.map((variant) => ({
      id: variant.nodeId || item.nodeId,
      natural: variant.natural || naturalSize(item),
      label: variant.label
    }));
    return [{ id: item.nodeId, natural: naturalSize(item), label: "" }];
  }

  function cardTemplate(item, order) {
    const previewHeight = Math.min(Math.max(Math.round(item.previewHeight || item.height + 64), 420), 880);
    const variant = selectedVariant(item);
    const nodes = itemNodes(item);
    const metadata = nodes.map((node) => `
      <div>
        <dt>Nodo Figma${node.label ? ` · ${escapeHtml(node.label)}` : ""}</dt>
        <dd><a href="${nodeUrl(node.id, item.figmaFile)}" target="_blank" rel="noreferrer">${escapeHtml(node.id)} ↗</a></dd>
      </div>
      <div>
        <dt>Medida natural${node.label ? ` · ${escapeHtml(node.label)}` : ""}</dt>
        <dd>${escapeHtml(node.natural)}</dd>
      </div>`).join("");
    const variantControl = item.variants?.length ? `
      <label class="docs-variant-control">
        <span>Variante</span>
        <select data-variant-select>
          ${item.variants.map((entry) => `<option value="${escapeHtml(entry.value)}"${entry.value === variant ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}
        </select>
      </label>` : "";
    const haystack = normalizeSearch([item.title, item.description, item.nodeId, item.tag, item.states, item.category]
      .concat(nodes.map((node) => `${node.id} ${node.label}`)).join(" "));

    return `
      <article class="docs-component" id="${escapeHtml(item.id)}" data-catalog-item data-search="${escapeHtml(haystack)}" data-tag="${escapeHtml(item.tag)}">
        <header class="docs-component-heading">
          <div class="docs-component-title-row">
            <h3>${escapeHtml(item.title)}</h3>
            <span class="docs-reference-badge">Referencia Figma</span>
          </div>
          <p class="docs-component-description">${escapeHtml(item.description)}</p>
          <dl class="docs-component-meta">
            ${metadata}
            <div><dt>Custom element</dt><dd>&lt;${escapeHtml(item.tag)}&gt;</dd></div>
            <div><dt>Incluye</dt><dd>${escapeHtml(item.states)}</dd></div>
          </dl>
        </header>

        <div class="docs-demo" data-component-demo data-order="${order}">
          <div class="docs-demo-toolbar">
            <div class="docs-toolbar-group">
              <div class="docs-tabs" role="tablist" aria-label="Vista de ${escapeHtml(item.title)}">
                <button type="button" id="tab-preview-${escapeHtml(item.id)}" role="tab" aria-selected="true" aria-controls="panel-preview-${escapeHtml(item.id)}" data-tab="preview">Vista</button>
                <button type="button" id="tab-code-${escapeHtml(item.id)}" role="tab" aria-selected="false" aria-controls="panel-code-${escapeHtml(item.id)}" data-tab="code" tabindex="-1">Código</button>
              </div>
              ${variantControl}
            </div>
            <div class="docs-toolbar-group">
              <div class="docs-devices" aria-label="Viewport de ${escapeHtml(item.title)}">
                <button type="button" aria-pressed="true" data-viewport="desktop" title="Desktop, 1440 píxeles"><span>Desktop 1440</span><b class="sr-only"> píxeles</b></button>
                <button type="button" aria-pressed="false" data-viewport="tablet" title="Tablet, 768 píxeles"><span>Tablet 768</span><b class="sr-only"> píxeles</b></button>
                <button type="button" aria-pressed="false" data-viewport="mobile" title="Móvil, 390 píxeles"><span>Móvil 390</span><b class="sr-only"> píxeles</b></button>
              </div>
              <output class="docs-viewport-readout" aria-live="polite" data-viewport-readout>1440 px</output>
            </div>
          </div>

          <div class="docs-panel" id="panel-preview-${escapeHtml(item.id)}" role="tabpanel" aria-labelledby="tab-preview-${escapeHtml(item.id)}" data-panel="preview">
            <div class="docs-preview-scroll">
              <div class="docs-preview-stage">
                <iframe class="docs-preview-frame" src="${previewUrl(item, variant)}" title="Preview de ${escapeHtml(item.title)}" loading="lazy" style="--preview-width: 1440px; height: ${previewHeight}px" data-preview-frame></iframe>
              </div>
            </div>
          </div>
          <div class="docs-panel docs-code-panel" id="panel-code-${escapeHtml(item.id)}" role="tabpanel" aria-labelledby="tab-code-${escapeHtml(item.id)}" data-panel="code" hidden>
            <button class="docs-copy" type="button" data-copy>Copia</button>
            <pre><code data-code>${escapeHtml(componentCode(item, variant))}</code></pre>
          </div>
        </div>
      </article>`;
  }

  function groupItems(items) {
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    }
    return groups;
  }

  function renderCatalog(options) {
    const items = options.items || [];
    const root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    const nav = typeof options.nav === "string" ? document.querySelector(options.nav) : options.nav;
    if (!root) return;

    const groups = groupItems(items);
    let order = 0;
    root.innerHTML = [...groups].map(([category, entries], groupIndex) => `
      <section class="docs-family" id="familia-${escapeHtml(options.categorySlugs?.[category] || category.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-"))}" data-catalog-group>
        <header class="docs-family-header">
          <div>
            <span class="docs-family-number">${String(groupIndex + 1).padStart(2, "0")}</span>
            <h2>${escapeHtml(category)}</h2>
          </div>
          <p>${escapeHtml(options.categoryCopy?.[category] || CATEGORY_COPY[category] || "Componentes documentados con su fuente y medida natural en Figma.")}</p>
        </header>
        <div class="docs-family-list">
          ${entries.map((item) => cardTemplate(item, order++)).join("")}
        </div>
      </section>`).join("") + `
      <div class="docs-empty-search" data-empty-search hidden>
        <h2>Sin coincidencias</h2>
        <p>Probá con el nombre del componente, su custom element o el ID del nodo Figma.</p>
      </div>`;

    if (nav) nav.innerHTML = [...groups].map(([category, entries]) => `
      <div class="docs-index-group" data-nav-group>
        <p>${escapeHtml(category)}</p>
        ${entries.map((item) => `<a href="#${escapeHtml(item.id)}" data-nav-item="${escapeHtml(item.id)}">${escapeHtml(item.title)}</a>`).join("")}
      </div>`).join("");

    document.querySelectorAll("[data-result-count]").forEach((node) => { node.textContent = String(items.length); });
    wireDemos(root, items);
    wireSearch(root, nav, items);
    wireShell(nav);
    observeSections(root, nav);
  }

  function wireDemos(root, items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    root.querySelectorAll("[data-component-demo]").forEach((demo) => {
      const article = demo.closest("[data-catalog-item]");
      const item = byId.get(article?.id);
      const tabs = [...demo.querySelectorAll("[role='tab']")];
      const panels = [...demo.querySelectorAll("[role='tabpanel']")];
      const frame = demo.querySelector("[data-preview-frame]");
      const readout = demo.querySelector("[data-viewport-readout]");
      const code = demo.querySelector("[data-code]");

      const activateTab = (name, focus = false) => {
        tabs.forEach((tab) => {
          const active = tab.dataset.tab === name;
          tab.setAttribute("aria-selected", String(active));
          tab.tabIndex = active ? 0 : -1;
          if (active && focus) tab.focus();
        });
        panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activateTab(tab.dataset.tab));
        tab.addEventListener("keydown", (event) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          const delta = event.key === 'ArrowRight' ? 1 : -1;
          const next = tabs[(index + delta + tabs.length) % tabs.length];
          activateTab(next.dataset.tab, true);
        });
      });

      demo.querySelectorAll("[data-viewport]").forEach((button) => {
        button.addEventListener("click", () => {
          const width = VIEWPORTS[button.dataset.viewport] || VIEWPORTS.desktop;
          demo.querySelectorAll("[data-viewport]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
          frame.style.setProperty("--preview-width", `${width}px`);
          frame.style.width = `${width}px`;
          readout.textContent = `${width} px`;
        });
      });

      const variantSelect = demo.querySelector("[data-variant-select]");
      variantSelect?.addEventListener("change", () => {
        const variant = variantSelect.value;
        frame.src = previewUrl(item, variant);
        code.textContent = componentCode(item, variant);
      });

      demo.querySelector("[data-copy]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(code.textContent);
          button.textContent = "Copiado";
        } catch {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
          button.textContent = "Seleccionado";
        }
        window.setTimeout(() => { button.textContent = "Copia"; }, 1400);
      });
    });
  }

  function wireSearch(root, nav, items) {
    const search = document.querySelector("[data-catalog-search]");
    if (!search || search.dataset.wired === "true") return;
    search.dataset.wired = "true";
    const status = document.querySelector("[data-search-status]");
    const empty = root.querySelector("[data-empty-search]");

    const filter = () => {
      const query = normalizeSearch(search.value.trim());
      let visible = 0;
      root.querySelectorAll("[data-catalog-item]").forEach((article) => {
        const matches = !query || article.dataset.search.includes(query);
        article.hidden = !matches;
        if (matches) visible += 1;
        nav?.querySelector(`[data-nav-item="${CSS.escape(article.id)}"]`)?.toggleAttribute("hidden", !matches);
      });
      root.querySelectorAll("[data-catalog-group]").forEach((group) => {
        group.hidden = !group.querySelector("[data-catalog-item]:not([hidden])");
      });
      nav?.querySelectorAll("[data-nav-group]").forEach((group) => {
        group.hidden = !group.querySelector("[data-nav-item]:not([hidden])");
      });
      empty.hidden = visible !== 0;
      document.querySelectorAll("[data-result-count]").forEach((node) => { node.textContent = String(visible); });
      if (status) status.textContent = query ? `${visible} de ${items.length} coincidencias para “${search.value.trim()}”.` : "";
    };

    search.addEventListener("input", filter);
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !search.value) return;
      search.value = "";
      filter();
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (event.key !== "/" || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      event.preventDefault();
      search.focus();
    });
  }

  function wireShell(nav) {
    const button = document.querySelector("[data-docs-menu]");
    const sidebar = document.querySelector(".docs-sidebar");
    const overlay = document.querySelector("[data-docs-overlay]");
    if (!button || !sidebar || button.dataset.wired === "true") return;
    button.dataset.wired = "true";

    const setOpen = (open) => {
      sidebar.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
      if (overlay) overlay.hidden = !open;
    };

    button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
    overlay?.addEventListener("click", () => setOpen(false));
    nav?.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        button.focus();
      }
    });
  }

  function observeSections(root, nav) {
    if (!nav || !("IntersectionObserver" in window)) return;
    const links = new Map([...nav.querySelectorAll("[data-nav-item]")].map((link) => [link.dataset.navItem, link]));
    const observer = new IntersectionObserver((entries) => {
      const current = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!current) return;
      links.forEach((link, id) => link.toggleAttribute("aria-current", id === current.target.id));
    }, { rootMargin: "-18% 0px -68%", threshold: [0, .15, .5] });
    root.querySelectorAll("[data-catalog-item]").forEach((section) => observer.observe(section));
  }

  window.WeotziDocs = Object.freeze({
    FIGMA_FILE,
    VIEWPORTS,
    COMPONENT_REFERENCES,
    UI_KIT_COMPONENTS: COMPONENT_REFERENCES,
    renderCatalog,
    nodeUrl
  });

  const mainRoot = document.querySelector("#component-catalog");
  if (mainRoot) renderCatalog({ items: COMPONENT_REFERENCES, root: mainRoot, nav: "#catalog-nav" });
})();
