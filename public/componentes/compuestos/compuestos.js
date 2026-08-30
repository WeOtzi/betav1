(() => {
  "use strict";

  const ORGANISMS = Object.freeze([
    {
      category: "Pantalla completa", id: "dashboard-completo", title: "Dashboard completo", nodeId: "34:533",
      width: 1082.77, height: 1813, tag: "weotzi-dashboard",
      description: "Composición integral del dashboard del artista: navegación, saludo, agenda, diseños, perfil, ingresos, recordatorios, acciones, cotizaciones, actividad y galería.",
      states: "Organismo completo · demo Laura / LAUUMARTH"
    },
    {
      category: "Shell del producto", id: "navegacion-producto", title: "Navegación del producto", nodeId: "80:13241",
      figmaFile: "https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi",
      width: 1440, height: 76, previewHeight: 280, tag: "weotzi-product-nav",
      description: "Barra superior WE ÖTZI con Cotizaciones, Job Board, Spots, Calendario, Estadísticas, Travel, Inbox, acceso de perfil y Log out.",
      states: "Desktop · 1440 × 76 · Cotizaciones activo"
    },
    {
      category: "Dashboard", id: "lateral-dashboard", title: "Lateral del dashboard", nodeId: "34:134",
      width: 241, height: 418.405, tag: "weotzi-dashboard-sidebar",
      description: "Columna compacta que agrupa ingresos, recordatorios y acciones rápidas.",
      states: "Ingresos lateral + recordatorios + acciones"
    },
    {
      category: "Dashboard", id: "estadisticas-ingresos", title: "Estadísticas de ingresos", nodeId: "34:135",
      width: 484, height: 182.373, tag: "weotzi-income-stats",
      description: "Resumen horizontal de ingresos, valores semanales, saldo pendiente y progreso a la meta.",
      states: "$4.820 · meta $6.000 · 80%"
    },
    {
      category: "Dashboard", id: "proximos-turnos", title: "Próximos turnos", nodeId: "34:137",
      width: 188.4, height: 346.13, tag: "weotzi-upcoming-appointments",
      description: "Lista lateral de las próximas sesiones con hora, cliente y estado.",
      states: "Sofía, Mateo, Julia y Tomás"
    },
    {
      category: "Dashboard", id: "agenda-y-disenos", title: "Agenda y diseños en proceso", nodeId: "34:139",
      width: 716, height: 666.026, tag: "weotzi-agenda-designs",
      description: "Bloque principal que conecta la agenda del día con el seguimiento visual de diseños activos.",
      states: "Agenda + Manga floral + Dragón + Mandala"
    },
    {
      category: "Dashboard", id: "agenda-tarjetas", title: "Agenda en tarjetas", nodeId: "34:138",
      width: 558.655, height: 346, tag: "weotzi-agenda-board",
      description: "Variante de agenda construida con tarjetas de cita para una lectura más modular.",
      states: "4 sesiones programadas"
    },
    {
      category: "Dashboard", id: "perfil-completo", title: "Panel de perfil", nodeId: "34:136",
      width: 374, height: 414.2, tag: "weotzi-profile-panel",
      description: "Perfil completo de LAUUMARTH con identidad, estado de verificación, tarifa y datos del artista.",
      states: "NO VERIFICADO · NUEVO · $150/sesión"
    },
    {
      category: "Dashboard", id: "cotizaciones-actividad", title: "Cotizaciones y actividad", nodeId: "34:523",
      width: 1010.423, height: 125.85, previewHeight: 360, tag: "weotzi-quotes-activity",
      description: "Resumen horizontal de cotizaciones junto a la actividad reciente del estudio.",
      states: "Cotizaciones preview + actividad reciente"
    },
    {
      category: "Marketplace", id: "job-board", title: "Job Board", nodeId: "34:525",
      width: 1527.2, height: 732.8, tag: "weotzi-job-board",
      description: "Página completa de resultados con encabezado, filtros y carrusel de cinco oportunidades.",
      states: "6 solicitudes · 5 tarjetas · filtros laterales"
    },
    {
      category: "Marketplace", id: "filtros-job-board", title: "Filtros de Job Board", nodeId: "34:526",
      width: 282, height: 1089, tag: "weotzi-job-filters",
      description: "La misma herramienta de filtrado en sus densidades expandida y comprimida.",
      states: "Expandido y comprimido",
      variants: [
        { label: "Expandido", value: "expanded", nodeId: "34:526", natural: "282 × 1089 px" },
        { label: "Comprimido", value: "compact", nodeId: "34:527", natural: "74 × 704 px" }
      ]
    },
    {
      category: "Marketplace", id: "spots", title: "Spots", nodeId: "34:524",
      width: 1039.08, height: 800.817, tag: "weotzi-spots",
      description: "Exploración de estudios mediante encabezado, herramientas, mosaico editorial y ticker.",
      states: "Palermo, Bang Bang NYC, Sur Tattoo House y más"
    },
    {
      category: "Formularios", id: "formulario-cotizacion", title: "Formulario de cotización", nodeId: "34:528",
      width: 463, height: 557.4, tag: "weotzi-quote-form",
      description: "Formulario compuesto para convertir una idea de tatuaje en una solicitud de cotización.",
      states: "Campos, selección, detalle y acción"
    },
    {
      category: "Formularios", id: "inicio-sesion", title: "Inicio de sesión", nodeId: "34:529",
      width: 380, height: 474.6, tag: "weotzi-auth-form",
      description: "Acceso compacto en superficie blanca, con marca, credenciales, ayuda y alternativa de registro.",
      states: "Email, contraseña y recuperación"
    },
    {
      category: "Portfolio y datos", id: "galeria-trabajos-completa", title: "Galería de trabajos completa", nodeId: "34:522",
      width: 1180, height: 1095, tag: "weotzi-portfolio-gallery", variant: "full",
      description: "Portfolio de gran formato con herramientas, cargas, mosaico visual y estados de gestión.",
      states: "Variante full · uploads + galería"
    },
    {
      category: "Portfolio y datos", id: "galeria-trabajos", title: "Galería de trabajos", nodeId: "34:521",
      width: 1180, height: 731.2, tag: "weotzi-portfolio-gallery", variant: "compact",
      description: "Variante compacta de la galería para páginas donde el portfolio comparte jerarquía con otros módulos.",
      states: "Variante compact"
    },
    {
      category: "Portfolio y datos", id: "dashboard-estadisticas", title: "Dashboard de estadísticas", nodeId: "34:532",
      width: 907.8, height: 1068.13, tag: "weotzi-statistics-dashboard",
      description: "Superficie analítica completa con KPIs, progreso, distribución y evolución temporal.",
      states: "Métricas, donut, barras y series"
    }
  ]);

  const CATEGORY_COPY = Object.freeze({
    "Pantalla completa": "La composición de referencia del dashboard confirma cómo conviven todos los organismos en una página real.",
    "Shell del producto": "Navegación persistente que conecta las áreas operativas del producto.",
    "Dashboard": "Módulos de gestión diaria que pueden reutilizarse juntos o en superficies más pequeñas.",
    "Marketplace": "Exploración de oportunidades y estudios con herramientas de búsqueda, filtrado y comparación.",
    "Formularios": "Flujos completos de entrada que reúnen campos, contexto, validación y llamada a la acción.",
    "Portfolio y datos": "Superficies densas para mostrar trabajos, progreso y lectura cuantitativa."
  });

  window.WEOTZI_ORGANISM_CATALOG = ORGANISMS;
  window.WeotziDocs?.renderCatalog({
    items: ORGANISMS,
    root: "#organism-catalog",
    nav: "#organism-nav",
    categoryCopy: CATEGORY_COPY
  });
})();
