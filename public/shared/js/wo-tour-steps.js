/**
 * WE OTZI - Recorrido guiado del artista (guion)
 * ----------------------------------------------
 * Capítulos y pasos que narra wo-tour.js sobre el modo demo. Cada capítulo es
 * una página; cada paso enfoca una sección (`target`: selector o lista de
 * selectores, gana el primero visible) y trae el texto que se muestra y se
 * lee en voz alta. `before`/`after` abren y cierran estados de la interfaz
 * (menú Ö, editor del calendario, secciones del centro de la cuenta).
 *
 * Copy: español rioplatense (voseo), sentence case, sin signos de exclamación
 * (regla 10 del DS). Para cambiar el guion alcanza con editar este archivo.
 */
(function () {
    'use strict';

    function $(sel) { return document.querySelector(sel); }
    function click(sel) { var el = $(sel); if (el) el.click(); return !!el; }
    function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 250); }); }

    // Abre el menú del tile Ö (wo-artist-menu.js) y confirma que quedó visible.
    function openArtistMenu() {
        var drop = $('.wo-oam-drop'), tile = $('.wo-o-tile');
        if (!drop || !tile) return false;
        if (drop.hidden) tile.click();
        return settle(200).then(function () { return !$('.wo-oam-drop').hidden; });
    }
    function closeArtistMenu() {
        var drop = $('.wo-oam-drop');
        if (drop && !drop.hidden) click('.wo-o-tile');
    }
    function showAccountSection(name) {
        return function () {
            var link = $('[data-aac-nav="' + name + '"]');
            if (!link) return false;
            link.click();
            return settle(200).then(function () { var sec = $('#aac-' + name); return !!sec && !sec.hidden; });
        };
    }

    var chapters = [
        {
            id: 'dashboard', title: 'Inicio', path: '/artist/dashboard',
            steps: [
                {
                    id: 'intro', target: null, title: 'Bienvenido al centro de control de We Ötzi',
                    text: [
                        'Este es el primer paso para impulsar tu carrera como artista del tatuaje. A continuación vamos a hacer un recorrido por la interfaz y sus funciones.',
                        'Mientras dure el modo demo vas a ver cotizaciones, turnos y mensajes de ejemplo. Nada de lo que hagas se guarda: es un espacio para probar sin miedo.'
                    ],
                    hint: 'Podés avanzar con las flechas del teclado o esperar a que termine la narración.',
                    nextLabel: 'EMPEZAR EL RECORRIDO →'
                },
                {
                    id: 'topbar', target: ['.wo-org-product-nav__links', '.wo-org-product-nav'], title: 'La navegación',
                    text: 'Arriba está la barra de navegación. Desde acá vas a Cotizaciones, Job board, Spots, Calendario, Estadísticas, Travel e Inbox. El tile con la Ö abre tus notificaciones y el centro de la cuenta.'
                },
                {
                    id: 'hero', target: '#wod-hero', title: 'El saludo del día',
                    text: 'El saludo cambia según la hora y te adelanta cuántos turnos tenés hoy, así sabés cómo viene el día antes de scrollear.'
                },
                {
                    id: 'agenda', target: '.wo-dash-section[aria-label="Agenda"]', title: 'Agenda del día',
                    text: 'En esta página podés ver tu agenda del día, con un primer vistazo de las citas programadas para hoy: hora, cliente, detalle de la sesión y su estado. Si querés ver más días, pulsá el botón Abrir calendario.'
                },
                {
                    id: 'designs', target: '#wod-designs-section', title: 'Diseños en proceso',
                    text: 'Continuando el recorrido, debajo tenés Diseños en proceso. Acá podés ver los diseños en los que estás trabajando actualmente para los trabajos por venir ya confirmados, con su etapa, el avance por sesiones y la fecha de la próxima cita.'
                },
                {
                    id: 'quotes', target: '.wo-dash-section[aria-label="Cotizaciones"]', title: 'Cotizaciones',
                    text: 'Cotizaciones resume cuántas solicitudes tenés pendientes de responder, cuántas aprobó el cliente y cuántas rechazó. El número de pendientes también aparece como aviso en la navegación.'
                },
                {
                    id: 'activity', target: '#wod-activity-section', title: 'Actividad reciente',
                    text: 'Actividad reciente es tu bitácora: nuevas cotizaciones, respuestas, aprobaciones y rechazos, en orden cronológico.'
                },
                {
                    id: 'profile', target: '.wo-dash-profile', title: 'Tu perfil',
                    text: 'En el riel derecho está tu tarjeta de perfil: foto, nombre artístico, nivel y verificación, más tu tarifa por sesión, estilos y años de experiencia. Desde acá editás el perfil o abrís tu perfil público.'
                },
                {
                    id: 'income', target: '#wod-income', title: 'Ingresos',
                    text: 'Ingresos suma lo cobrado en el mes por trabajos completados, lo de esta semana y el saldo pendiente de trabajos confirmados que todavía no cerraste.'
                },
                {
                    id: 'reminders', target: '#wod-reminders', title: 'Recordatorios',
                    text: 'Recordatorios guarda tus pendientes cortos: reponer insumos, enviar un boceto o responder un mensaje.'
                },
                {
                    id: 'quick', target: '.wo-dash-quick', title: 'Acciones rápidas',
                    text: 'Acciones rápidas concentra lo más frecuente: dar de alta un cliente nuevo con el cotizador, crear una cita en el calendario o registrar un pago.'
                },
                {
                    id: 'gallery', target: '.wo-dash-gallery', title: 'Galería de trabajos',
                    text: 'Abajo está la galería de trabajos: la vista previa de lo que muestra tu perfil público. Subí hasta doce archivos, hasta dos videos, y arrastrá para reordenar. Un portfolio con fotos de calidad genera más cotizaciones.'
                },
                {
                    id: 'menu', target: '.wo-oam-drop', title: 'El menú Ö', before: openArtistMenu, after: closeArtistMenu,
                    text: 'El tile Ö abre tu menú: notificaciones, mensajes sin leer, invitaciones pendientes y solicitudes, más accesos al centro de la cuenta y a tu perfil público. Desde acá también podés volver a ver este recorrido.'
                },
                {
                    id: 'go-quotes', target: null, title: 'Vamos a Cotizaciones',
                    text: 'Ahora vamos a Cotizaciones, donde se responden las solicitudes de tus clientes.'
                }
            ]
        },
        {
            id: 'quotations', title: 'Cotizaciones', path: '/my-quotations',
            steps: [
                { id: 'hero', target: '.q-hero', title: 'Tu bandeja de cotizaciones', text: 'Esta es tu bandeja de cotizaciones: todo lo que te pidieron tus clientes en un solo lugar. Desde acá también podés crear una cotización manual, exportar el listado o configurar tu cotizador.' },
                { id: 'aside', target: '.q-hero-aside', title: 'Moneda y alcance', text: 'Elegí en qué moneda ver los montos y si querés ver todas las cotizaciones, solo las abiertas o solo las cerradas.' },
                { id: 'stats', target: '.stats-strip', title: 'Los indicadores', text: 'Los indicadores muestran el total de cotizaciones, las pendientes de respuesta, tu tasa de respuesta, los ingresos confirmados y cuántas son de alta prioridad.' },
                { id: 'toolbar', target: '.table-toolbar', title: 'Buscar y filtrar', text: 'Buscá por cliente, ciudad o ID, filtrá con los chips rápidos y ordená la lista. En Más filtros podés combinar estado y prioridad.' },
                { id: 'legend', target: '.table-legend', title: 'La leyenda', text: 'La leyenda explica los colores de estado y las formas de prioridad. Desde acá también entrás a las cotizaciones archivadas.' },
                { id: 'list', target: '#quotes-table-body', title: 'El listado', text: 'Cada fila es una cotización: cliente, idea, zona del cuerpo, estado y prioridad. Tocá una fila para abrir el expediente completo.' },
                { id: 'go-detail', target: null, title: 'Abramos un expediente', text: 'Abramos una cotización para ver el expediente completo.' }
            ]
        },
        {
            id: 'detail', title: 'Expediente', path: '/my-quotations/detail?quote=DEMO-P01',
            steps: [
                { id: 'commandbar', target: '#quotation-commandbar', title: 'La barra de comandos', text: 'La barra de comandos muestra la referencia y el estado, y concentra las acciones: aceptar, rechazar, agendar sesiones o contactar al cliente.' },
                { id: 'identity', target: '.qd-identity', title: 'Quién pide el tatuaje', text: 'Arriba, quién pide el tatuaje y las etiquetas que resumen el proyecto.' },
                { id: 'proposal', target: '.qd-proposal', title: 'La propuesta', text: 'La propuesta: zona del cuerpo, estilo, tamaño estimado, presupuesto del cliente y las referencias que adjuntó.' },
                { id: 'evaluation', target: '.qd-evaluation', title: 'Tu evaluación', text: 'Tu evaluación: cargá tu presupuesto, las sesiones estimadas y tu disponibilidad, y dejá notas privadas que solo ves vos.' },
                { id: 'timeline', target: '.qd-timeline-section', title: 'El timeline', text: 'El timeline registra cada cambio de estado de la cotización, desde que llegó hasta que se completa.' },
                { id: 'messages', target: '.qd-messages', title: 'Mensajes con el cliente', text: 'Y acá conversás con el cliente sin salir del expediente. El chat completo vive en tu Inbox.' },
                { id: 'go-calendar', target: null, title: 'Sigamos con el Calendario', text: 'Sigamos con el Calendario, donde se organizan las sesiones.' }
            ]
        },
        {
            id: 'calendar', title: 'Calendario', path: '/calendar',
            steps: [
                { id: 'hero', target: '.cal-hero', title: 'Tu agenda en un solo mural', text: 'Tu agenda en un solo mural. El resumen te dice cuántos turnos confirmados, solicitudes pendientes y días bloqueados tenés este mes.' },
                { id: 'views', target: '.cal-view-tabs', title: 'Las vistas', text: 'Cambiá entre vista de mes, semana, día o agenda según cómo prefieras planificar.' },
                { id: 'nav', target: '.cal-controls', title: 'Navegar y buscar', text: 'Navegá entre períodos con las flechas y buscá un evento o un cliente por nombre.' },
                { id: 'legend', target: '#calendar-legend', title: 'La leyenda', text: 'La leyenda filtra por tipo de evento: turnos, reservas, días bloqueados, guest spots, convenciones y eventos personales.' },
                { id: 'board', target: '#calendar-view', title: 'El mural', text: 'El mural muestra tus sesiones de cotizaciones, tus viajes y los eventos manuales, sin duplicarlos.' },
                { id: 'upcoming', target: '.cal-upcoming', title: 'Próximos eventos', text: 'A la derecha, los próximos eventos en orden, para saber qué viene.' },
                {
                    id: 'new-event', target: '#event-type-picker', title: 'Nuevo evento',
                    before: function () { if (!click('#new-event-button')) return false; return settle(300); },
                    after: function () { click('#editor-back'); },
                    text: 'Con Nuevo evento elegís el tipo: turno con cliente, reserva, disponibilidad, día bloqueado, guest spot, convención, recordatorio o evento personal. Si se superpone con otro, el sistema te avisa.'
                },
                { id: 'go-jobboard', target: null, title: 'Ahora el Job board', text: 'Ahora vamos al Job board, donde los clientes publican lo que quieren tatuarse.' }
            ]
        },
        {
            id: 'jobboard', title: 'Job board', path: '/job-board',
            steps: [
                { id: 'head', target: '.jbf-head', title: 'Solicitudes abiertas', text: 'El Job board reúne solicitudes abiertas de clientes que todavía no eligieron artista, curadas según tu perfil y tus estilos.' },
                { id: 'filters', target: ['#jbf-sidebar', '.jbf-sidebar'], title: 'Los filtros', text: 'Filtrá por búsqueda, recomendaciones, estilos, ciudad, tamaño y presupuesto, y guardá las que te interesen.' },
                { id: 'rails', target: '#job-board-rails', title: 'Los rieles', text: 'Las solicitudes se agrupan en rieles: recomendadas para vos y por estilo. Cada tarjeta muestra la idea, la zona, la ciudad, el presupuesto y cuántos artistas se postularon.' },
                { id: 'card', target: ['#job-board-rails article', '#job-board-rails .jbf-card'], title: 'Postularte', text: 'Abrí una tarjeta para ver el detalle y enviá tu propuesta con precio estimado, sesiones y disponibilidad. Si el cliente te elige, se convierte en una cotización.' },
                { id: 'go-spots', target: null, title: 'Sigamos con Spots', text: 'Sigamos con Spots, las posiciones que publican los estudios.' }
            ]
        },
        {
            id: 'spots', title: 'Spots', path: '/studio-spots',
            steps: [
                { id: 'feature', target: '#spots-feature', title: 'El spot destacado', text: 'Spots son posiciones que publican los estudios: guest spots, residencias y vacantes. El destacado aparece primero.' },
                { id: 'mosaic', target: '#spots-mosaic', title: 'Spots abiertos', text: 'El mosaico muestra los spots abiertos con los estilos buscados, las fechas, el reparto de ingresos y si incluyen alojamiento.' },
                { id: 'ribbon', target: '#spots-ribbon', title: 'Cierran pronto', text: 'Los que cierran pronto se marcan en esta franja para que no se te pasen.' },
                { id: 'invitations-link', target: ['.wo-org-product-nav__item--spots', '.wo-org-product-nav__menu'], title: 'Invitaciones', text: 'Desde Spots también entrás a Invitaciones, donde los estudios te proponen sumarte a su equipo.' },
                { id: 'go-invitations', target: null, title: 'Vamos a Invitaciones', text: 'Vamos a ver las invitaciones que te mandaron los estudios para sumarte a su equipo.' }
            ]
        },
        {
            id: 'invitations', title: 'Invitaciones', path: '/artist/invitations',
            steps: [
                { id: 'head', target: '.inv-head', title: 'Estudios que te quieren', text: 'Los estudios que te quieren en su equipo. El contador muestra cuántas invitaciones abiertas tenés.' },
                { id: 'bar', target: '.inv-bar', title: 'Filtrar y ordenar', text: 'Filtrá por pendientes, aceptadas o rechazadas, ordená y buscá por estudio o ciudad.' },
                { id: 'list', target: '#invitations-list', title: 'Cada invitación', text: 'Cada invitación trae el rol, las condiciones económicas y el mensaje del estudio. Podés aceptar, rechazar o pedir cambios.' },
                { id: 'go-applications', target: null, title: 'Tus postulaciones', text: 'Ahora, el seguimiento de todo lo que enviaste: tus postulaciones.' }
            ]
        },
        {
            id: 'applications', title: 'Postulaciones', path: '/artist/applications',
            steps: [
                { id: 'header', target: '.apx-header', title: 'Mis postulaciones', text: 'Mis postulaciones concentra el seguimiento de todo lo que enviaste, tanto al Job board como a Spots.' },
                { id: 'tabs', target: '.apx-tabs', title: 'Job board o Spots', text: 'Separá por Job board o Spots con estas pestañas.' },
                { id: 'chips', target: '#apx-chips', title: 'Los estados', text: 'Los chips muestran el estado: esperando respuesta, en revisión, contraoferta recibida, confirmada, rechazada o retirada.' },
                { id: 'rows', target: '#apx-rows', title: 'Cada postulación', text: 'Abrí una fila para ver tu propuesta, negociar contraofertas o retirarla.' },
                { id: 'go-statistics', target: null, title: 'Estadísticas', text: 'Pasemos a Estadísticas, para ver cómo crece tu actividad.' }
            ]
        },
        {
            id: 'statistics', title: 'Estadísticas', path: '/my-quotations/statistics',
            steps: [
                { id: 'hero', target: '.stats-hero', title: 'Tu negocio en We Ötzi', text: 'Tu negocio en We Ötzi: un vistazo a cómo crece tu actividad. Podés exportar el informe en CSV.' },
                { id: 'kpis', target: '.kpi-row', title: 'Seis indicadores', text: 'Seis indicadores: visualizaciones del perfil, visitas al portfolio, solicitudes recibidas, cotizaciones enviadas, reservas confirmadas e ingresos generados.' },
                { id: 'funnel', target: 'section[aria-labelledby="funnel-title"]', title: 'Embudo de conversión', text: 'El embudo muestra dónde se pierden las oportunidades, desde la visita hasta la reserva.' },
                { id: 'evolution', target: 'section[aria-labelledby="evolution-title"]', title: 'Evolución', text: 'Evolución compara semana, mes o año y cambia la métrica: visitas, solicitudes, reservas o ingresos.' },
                { id: 'performance', target: 'section[aria-labelledby="performance-title"]', title: 'Rendimiento del perfil', text: 'Rendimiento del perfil: trabajos más vistos, estilos más buscados, ciudades con más visitas y horarios de mayor actividad.' },
                { id: 'dual', target: '.stats-dual', title: 'Actividad y oportunidades', text: 'Actividad reciente y Oportunidades: sugerencias concretas para mejorar tu conversión.' },
                { id: 'visitors', target: 'section[aria-labelledby="visitors-title"]', title: 'Quiénes te visitaron', text: 'Y quiénes visitaron tu perfil: filtrá entre clientes potenciales y estudios.' },
                { id: 'go-travel', target: null, title: 'Travel', text: 'Seguimos con Travel, para organizar tus giras.' }
            ]
        },
        {
            id: 'travel', title: 'Travel', path: '/artist/travel',
            steps: [
                { id: 'hero', target: '#tv-hero', title: 'Tu próximo destino', text: 'Travel organiza tus giras. El hero muestra tu próximo destino con días restantes, personas interesadas, estadía, clima y estudios donde vas a tatuar.' },
                { id: 'tabs', target: '.tvl-tabsrow', title: 'Regiones y viaje nuevo', text: 'Filtrá por región y creá un viaje nuevo desde acá.' },
                { id: 'filters', target: '.tvl-filters', title: 'Refinar', text: 'Refiná la lista por año, estado, tipo de viaje y origen del dato: manual o automático.' },
                { id: 'globe', target: '.tvl-globegrid', title: 'El globo', text: 'El globo ubica tus viajes y la agenda resumida los lista con sus fechas.' },
                { id: 'timeline', target: 'section[aria-label="Cronología de viajes"]', title: 'Cronología', text: 'La cronología ordena todos tus viajes. Desde cada uno entrás al detalle con checklist, documentos y el vínculo con el estudio.' },
                { id: 'passport', target: 'section[aria-label="Tattoo Passport"]', title: 'Tattoo Passport', text: 'Tattoo Passport guarda los sellos de cada ciudad donde tatuaste.' },
                { id: 'go-inbox', target: null, title: 'Inbox', text: 'Ahora el Inbox, donde viven todas tus conversaciones.' }
            ]
        },
        {
            id: 'inbox', title: 'Inbox', path: '/artist/inbox',
            steps: [
                { id: 'side', target: '.ai-side', title: 'Todas tus conversaciones', text: 'El Inbox reúne todas tus conversaciones: clientes, cotizaciones, soporte, invitaciones, spots, job board, estudios y viajes.' },
                { id: 'summary', target: '.ai-summary', title: 'El resumen', text: 'El resumen muestra cuántas están sin leer, respondidas o esperando tu respuesta.' },
                { id: 'list', target: '.ai-listcol', title: 'La lista', text: 'La lista ordena las conversaciones por actividad. Marcá favoritas o archivá las que ya cerraste.' },
                { id: 'thread', target: '#ai-threadcol', title: 'El hilo', text: 'Elegí una conversación para leer el hilo y responder con texto, imágenes o adjuntos.' },
                { id: 'go-account', target: null, title: 'Centro de la cuenta', text: 'Vamos al centro de la cuenta, donde configurás todo lo tuyo.' }
            ]
        },
        {
            id: 'account', title: 'Centro de la cuenta', path: '/artist/account',
            steps: [
                { id: 'sidebar', target: '.aac-sidebar', title: 'Nueve secciones', text: 'El centro de la cuenta tiene nueve secciones: perfil, portafolio, cobros, disponibilidad, notificaciones, seguridad, integraciones, verificación y configuración.' },
                { id: 'perfil', target: '#aac-perfil', title: 'Mi perfil', before: showAccountSection('perfil'), text: 'Mi perfil es cómo te van a ver clientes y estudios: nombre, usuario, idiomas, biografía, ciudad y redes.' },
                { id: 'portafolio', target: '#aac-portafolio', title: 'Portafolio', before: showAccountSection('portafolio'), text: 'Portafolio administra los trabajos de tu perfil público.' },
                { id: 'cobros', target: '#aac-cobros', title: 'Cobros y facturación', before: showAccountSection('cobros'), text: 'Cobros y facturación: saldo, ingresos del mes, historial, datos fiscales y métodos de pago.' },
                { id: 'verificacion', target: '#aac-verificacion', title: 'Verificación', before: showAccountSection('verificacion'), after: showAccountSection('perfil'), text: 'Verificación: subí tus documentos para obtener el sello de perfil verificado, que da confianza a los clientes.' },
                { id: 'go-profile', target: null, title: 'Cómo te ven los clientes', text: 'Para cerrar, veamos cómo te ven los clientes en tu perfil público.' }
            ]
        },
        {
            id: 'profile', title: 'Perfil público',
            path: function (identity) { return identity && identity.username ? '/artist/profile?artist=' + encodeURIComponent(identity.username) : '/artist/profile'; },
            match: function (loc) { return /^\/artist\/profile\/?$/.test(loc.pathname); },
            steps: [
                { id: 'hero', target: '.hero-band', title: 'Así te ven', text: 'Así te ven los clientes: ciudad, nombre artístico, estilos y los botones para reservar sesión o pedir cotización.' },
                { id: 'stats', target: '#stats-band', title: 'Tus métricas', text: 'Años tatuando, tatuajes realizados, tasa de respuesta y calificación.' },
                { id: 'about', target: '.sobre-band', title: 'Sobre el artista', text: 'Sobre el artista: tu biografía, idiomas, sesión mínima y tiempo de respuesta.' },
                { id: 'reviews', target: '#artist-reviews-panel', title: 'Reseñas', text: 'Reseñas verificadas de clientes con los que completaste un trabajo.' },
                { id: 'availability', target: '.cta-band', title: 'Disponibilidad', text: 'Disponibilidad invita a reservar cuando tu agenda está abierta.' },
                { id: 'gallery', target: '#block-gallery', title: 'Tu portafolio', text: 'Y tu portafolio completo, filtrable por categoría.' },
                {
                    id: 'end', target: null, title: 'Fin del recorrido',
                    text: [
                        'Ya conocés las secciones principales de We Ötzi. Cuando quieras, salí del modo demo para empezar a cargar tus datos reales.',
                        'Podés volver a ver este recorrido desde el menú Ö, en Recorrido guiado.'
                    ],
                    nextLabel: 'SEGUIR EXPLORANDO EL DEMO', exitLabel: 'Salir del demo y empezar con mis datos →'
                }
            ]
        }
    ];

    window.WoTourSteps = { chapters: chapters };
})();
