#!/usr/bin/env node
/*
 * Genera TODAS las plantillas de email de We Ötzi desde la base común
 * (lib/email-render/layout.js, la misma que usa el render en servidor):
 *   - templates/email/<nombre>.html y .min.html (n8n / BillionMail, {{variable}})
 *   - templates/email/billionmail/<nombre>.html
 *   - templates/email/supabase-*.html (Go templates de Supabase Auth) y
 *     templates/email/password-updated.html
 * y opcionalmente sincroniza el HTML en los workflows de n8n.
 *
 * Usage:
 *   node scripts/redesign-email-templates.js
 *   node scripts/redesign-email-templates.js --only=chat-message-client
 *   N8N_URL=https://... N8N_API_KEY=... node scripts/redesign-email-templates.js --sync-n8n
 *
 * Nota: el canal recomendado es el relé (render en servidor, por destinatario,
 * con formato de fechas/montos y sin filas vacías). Estas plantillas quedan
 * para los nodos de n8n que todavía arman su propio HTML.
 */

const fs = require('fs');
const path = require('path');
const { renderLayout, raw } = require('../lib/email-render/layout');
const { escapeHtml, DEFAULT_PUBLIC_BASE } = require('../lib/email-format');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'templates/email/billionmail/manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const LABELS = {
    age: 'Edad',
    ambassador_status: 'Estado',
    artist_budget_amount: 'Monto propuesto',
    artist_budget_currency: 'Moneda',
    artist_current_city: 'Ciudad del artista',
    artist_name: 'Artista',
    deposit_text: 'Seña',
    artist_response: 'Respuesta',
    artist_studio_name: 'Estudio',
    artistic_name: 'Nombre artístico',
    attachments_count: 'Referencias adjuntas',
    body_text: 'Detalle',
    budget_currency: 'Moneda',
    budget_max: 'Presupuesto máximo',
    budget_min: 'Presupuesto mínimo',
    city: 'Ciudad',
    client_budget: 'Presupuesto del cliente',
    client_budget_amount: 'Presupuesto',
    client_budget_currency: 'Moneda',
    client_city_residence: 'Ciudad del cliente',
    client_flexible_dates: 'Fechas flexibles',
    client_full_name: 'Cliente',
    client_name: 'Cliente',
    client_preferred_date: 'Fecha preferida',
    client_travel_willing: 'Puede viajar',
    completed_quotes: 'Cotizaciones completadas',
    completed_week: 'Completadas esta semana',
    country: 'País',
    date: 'Fecha',
    decision_detail: 'Detalle',
    decision_title: 'Decisión',
    dispute_title: 'Disputa',
    duration_hours: 'Duración (horas)',
    email: 'Email',
    estimated_price: 'Precio estimado',
    estimated_sessions: 'Sesiones estimadas',
    expires_label: 'Vence en',
    feature_1_description: 'Detalle',
    feature_1_title: 'Novedad',
    feature_2_description: 'Detalle',
    feature_2_title: 'Novedad',
    feature_3_description: 'Detalle',
    feature_3_title: 'Novedad',
    final_budget_amount: 'Monto final',
    final_budget_currency: 'Moneda',
    final_comment: 'Comentario final',
    final_sessions: 'Sesiones',
    first_session_date: 'Primera sesión',
    full_name: 'Nombre',
    instagram: 'Instagram',
    instagram_handle: 'Tu Instagram',
    job_board_applications: 'Postulaciones',
    message: 'Mensaje',
    message_preview: 'Mensaje',
    messages_received: 'Mensajes recibidos',
    new_jb_applications: 'Postulaciones nuevas',
    new_jb_requests: 'Solicitudes nuevas en el Job Board',
    new_quotes: 'Cotizaciones nuevas',
    new_quotes_week: 'Cotizaciones nuevas',
    new_today: 'Novedades de hoy',
    new_users_week: 'Usuarios nuevos',
    pending_count: 'Pendientes',
    pending_total: 'Pendientes totales',
    quotation_medium: 'Medio',
    quote_id: 'Cotización',
    rating: 'Calificación',
    rating_comment: 'Comentario',
    reason: 'Motivo',
    recipient_name: 'Destinatario',
    reminder_detail: 'Notas',
    reminder_title: 'Recordatorio',
    reminder_when: 'Cuándo',
    request_code: 'Código de solicitud',
    request_reference: 'Solicitud',
    responded_quotes: 'Respondidas',
    session_date: 'Fecha de la sesión',
    session_number: 'Sesión N.º',
    session_price: 'Tarifa por sesión',
    sessions_completed: 'Sesiones completadas',
    status_detail: 'Detalle',
    status_title: 'Estado',
    studio: 'Estudio',
    studio_name: 'Estudio',
    styles_text: 'Estilos',
    subject: 'Asunto',
    support_note: 'Nota de soporte',
    support_reference: 'Referencia',
    tattoo_body_part: 'Zona del cuerpo',
    tattoo_body_side: 'Lado',
    tattoo_color_type: 'Color',
    tattoo_idea_description: 'Idea del tatuaje',
    tattoo_is_cover_up: 'Cover up',
    tattoo_is_first_tattoo: 'Primer tatuaje',
    tattoo_references: 'Referencias',
    tattoo_size: 'Tamaño',
    tattoo_style: 'Estilo',
    temp_password: 'Contraseña temporal',
    total_active: 'Activos',
    total_artists: 'Artistas',
    total_clients: 'Clientes',
    unread_messages: 'Mensajes sin leer',
    upcoming_sessions: 'Próximas sesiones',
    user_name: 'Nombre',
    username: 'Usuario',
    verification_code: 'Código',
    week_range: 'Semana',
    weotzi_instagram: 'Cuenta a seguir',
    whatsapp: 'WhatsApp',
    work_type: 'Modalidad',
    years_experience: 'Experiencia'
};

const LINK_LABELS = {
    dashboard_url: 'Abrir mi panel',
    profile_url: 'Ver mi perfil público',
    portfolio_url: 'Ver mi portafolio',
    login_url: 'Iniciar sesión',
    quotation_url: 'Ver la cotización',
    chat_url: 'Abrir la conversación',
    account_url: 'Ver mi cuenta',
    review_url: 'Dejar mi reseña',
    dm_url: 'Abrir mensaje directo'
};

// Spec por plantilla (los textos admiten {{variable}}). Campos: subject,
// preheader, eyebrow, greeting, headline, intro, ctaLabel + ctaVar,
// highlightVar + highlightLabel (+ highlightSize), quoteVar + quoteLabel,
// rows (lista de variables; por defecto, las del manifest que no se usaron).
const SPECS = {
    'account-deletion': {
        subject: 'We Ötzi: {{status_title}}', preheader: 'Actualizamos tu solicitud de baja de cuenta. Te contamos el detalle y los próximos pasos.',
        eyebrow: 'BAJA DE CUENTA', greeting: 'Hola, {{user_name}}.', headline: 'Tu solicitud de baja',
        intro: 'Te escribimos porque {{status_title}}. {{status_detail}}',
        quoteVar: 'support_note', quoteLabel: 'Nota de soporte', ctaLabel: 'Ver mi cuenta', ctaVar: 'account_url'
    },
    'admin-new-quotation': {
        subject: 'Nueva cotización {{quote_id}}', preheader: 'Se registró una solicitud nueva en We Ötzi. Revisa cliente, artista, estilo y presupuesto.',
        eyebrow: 'ADMIN · COTIZACIÓN', headline: 'Nueva cotización en el sistema',
        intro: '{{client_full_name}} envió una solicitud a {{artist_name}}.'
    },
    'admin-weekly-report': {
        subject: 'Resumen semanal de We Ötzi · {{week_range}}', preheader: 'Crecimiento, actividad y conversiones de la semana para revisar el estado de la plataforma.',
        eyebrow: 'ADMIN · REPORTE', headline: 'Resumen semanal',
        intro: 'Lectura compacta de crecimiento, actividad y conversiones de la semana {{week_range}}.'
    },
    'ambassador-updated': {
        subject: 'Actualizamos tu estado de embajador', preheader: 'Hay novedades sobre tu participación en el programa de embajadores de We Ötzi.',
        eyebrow: 'PROGRAMA DE EMBAJADORES', greeting: 'Hola, {{artist_name}}.', headline: 'Tu estado de embajador cambió',
        intro: 'Actualizamos tu estado dentro del programa de embajadores. Revísalo desde tu panel.',
        ctaLabel: 'Abrir mi panel', ctaVar: 'dashboard_url'
    },
    'application-accepted': {
        subject: 'Aceptaron tu postulación', preheader: 'El cliente eligió avanzar contigo. Coordina los próximos pasos desde tu panel de We Ötzi.',
        eyebrow: 'JOB BOARD · ACEPTADA', greeting: 'Hola, {{artist_name}}.', headline: 'Tu postulación fue aceptada',
        intro: '{{client_name}} eligió avanzar contigo. La solicitud ya es una cotización en tu panel.',
        ctaLabel: 'Abrir mi panel', ctaVar: 'dashboard_url'
    },
    'application-rejected': {
        subject: 'Actualización de tu postulación', preheader: 'Esta vez la solicitud siguió otro camino. Hay más ideas esperando en el Job Board.',
        eyebrow: 'JOB BOARD · CIERRE', greeting: 'Hola, {{artist_name}}.', headline: 'Esta vez no fue seleccionada',
        intro: 'La solicitud siguió otro camino. Mantener tu portafolio actualizado ayuda en las próximas oportunidades.',
        ctaLabel: 'Ver el Job Board', ctaVar: 'dashboard_url'
    },
    'artist-quotation-notification': {
        subject: 'Nueva solicitud de {{client_full_name}}', preheader: 'Un cliente quiere tatuarse contigo. Revisa la idea y las referencias, y responde desde tu panel.',
        eyebrow: 'NUEVA SOLICITUD', greeting: 'Hola, {{artist_name}}.', headline: 'Tienes una nueva solicitud',
        intro: '{{client_full_name}} te envió una idea para cotizar. Revisa el brief y responde desde tu panel.',
        ctaLabel: 'Ver la solicitud', ctaVar: 'quotation_url'
    },
    'artist-rejected-quotation': {
        subject: '{{artist_name}} no puede tomar tu solicitud', preheader: 'Esta vez el artista no puede tomar tu idea. Puedes buscar otro artista o publicarla en el Job Board.',
        eyebrow: 'SOLICITUD SIN CUPO', greeting: 'Hola, {{client_name}}.', headline: 'El artista no va a tomar tu solicitud',
        intro: '{{artist_name}} revisó tu idea y esta vez no puede tomarla. Puedes buscar otro artista o publicar tu idea en el Job Board para recibir propuestas.',
        ctaLabel: 'Ver mis cotizaciones', ctaVar: 'dashboard_url'
    },
    'artist-responded': {
        subject: '{{artist_name}} respondió tu solicitud', preheader: 'Ya tienes la propuesta de tu artista: presupuesto, sesiones estimadas y mensaje.',
        eyebrow: 'PROPUESTA DEL ARTISTA', greeting: 'Hola, {{client_name}}.', headline: 'Tienes una propuesta',
        intro: '{{artist_name}} revisó tu idea y te mandó su propuesta. Revísala y apruébala o respóndele desde tu cuenta.',
        quoteVar: 'message_preview', quoteLabel: 'Mensaje del artista', ctaLabel: 'Ver la propuesta', ctaVar: 'quotation_url'
    },
    'artist-welcome': {
        subject: 'Te damos la bienvenida a We Ötzi', preheader: 'Tu perfil de artista ya está creado. Complétalo y empieza a recibir solicitudes de tatuaje.',
        eyebrow: 'REGISTRO DE ARTISTA', greeting: 'Hola, {{artistic_name}}.', headline: 'Tu perfil está listo',
        intro: 'Recibimos tu registro. Entra a tu panel con el email y la contraseña que elegiste para completar tu perfil, cargar tu galería y responder solicitudes.',
        ctaLabel: 'Abrir mi panel', ctaVar: 'dashboard_url'
    },
    'calendar-reminder': {
        subject: 'Recordatorio: {{reminder_title}}', preheader: 'Tienes un recordatorio agendado en tu calendario de We Ötzi. Revisa los detalles.',
        eyebrow: 'RECORDATORIO', greeting: 'Hola, {{artist_name}}.', headline: '{{reminder_title}}',
        intro: 'Lo agendaste en tu calendario de We Ötzi para {{reminder_when}}.',
        ctaLabel: 'Abrir mi calendario', ctaVar: 'dashboard_url'
    },
    'chat-message-artist': {
        subject: '{{client_name}} te escribió', preheader: 'Tienes un mensaje nuevo de tu cliente en We Ötzi. Responde desde la app para mantener el historial.',
        eyebrow: 'MENSAJE NUEVO', greeting: 'Hola, {{artist_name}}.', headline: 'Tienes un mensaje nuevo',
        intro: '{{client_name}} te escribió sobre su cotización. Responde desde We Ötzi para mantener todo el historial en un solo lugar.',
        quoteVar: 'message_preview', quoteLabel: 'Mensaje', ctaLabel: 'Responder en We Ötzi', ctaVar: 'chat_url'
    },
    'chat-message-client': {
        subject: '{{artist_name}} te escribió', preheader: 'Tienes un mensaje nuevo de tu artista en We Ötzi. Responde desde la app para mantener el historial.',
        eyebrow: 'MENSAJE NUEVO', greeting: 'Hola, {{client_name}}.', headline: 'Tienes un mensaje nuevo',
        intro: '{{artist_name}} te escribió sobre tu cotización. Responde desde We Ötzi para mantener todo el historial en un solo lugar.',
        quoteVar: 'message_preview', quoteLabel: 'Mensaje', ctaLabel: 'Responder en We Ötzi', ctaVar: 'chat_url'
    },
    'client-rating': {
        subject: 'Recibiste una nueva reseña', preheader: 'Un cliente calificó tu trabajo. La reseña se publica después de la moderación de soporte.',
        eyebrow: 'NUEVA RESEÑA', greeting: 'Hola, {{artist_name}}.', headline: 'Un cliente calificó tu trabajo',
        intro: '{{client_name}} dejó una reseña sobre su experiencia. Soporte la revisa antes de publicarla en tu perfil.',
        quoteVar: 'rating_comment', quoteLabel: 'Comentario', ctaLabel: 'Ver la cotización', ctaVar: 'quotation_url'
    },
    'client-welcome': {
        subject: 'Tu cuenta de We Ötzi está lista', preheader: 'Desde tu cuenta sigues tus cotizaciones, mensajes y sesiones con tus artistas.',
        eyebrow: 'REGISTRO DE CLIENTE', greeting: 'Hola, {{full_name}}.', headline: 'Tu cuenta está lista',
        intro: 'Creamos tu acceso a We Ötzi. Desde tu cuenta puedes seguir tus cotizaciones, conversar con tus artistas y ver tus sesiones.',
        ctaLabel: 'Entrar a mi cuenta', ctaVar: 'dashboard_url'
    },
    'daily-digest': {
        subject: 'Tu día en We Ötzi · {{date}}', preheader: 'Resumen rápido de oportunidades, pendientes, mensajes y sesiones para mantener tu agenda clara.',
        eyebrow: 'RESUMEN DIARIO', greeting: 'Hola, {{artist_name}}.', headline: 'Tu día en We Ötzi',
        intro: 'Resumen rápido de nuevas oportunidades, pendientes, mensajes y sesiones.'
    },
    'dispute-artist-response': {
        subject: 'El artista respondió la disputa', preheader: 'El artista dejó su respuesta a la disputa de tu cotización. Soporte acompaña la resolución.',
        eyebrow: 'DISPUTA · RESPUESTA', greeting: 'Hola, {{client_name}}.', headline: 'El artista respondió la disputa',
        intro: '{{artist_name}} dejó su respuesta a la disputa de tu cotización. Soporte de We Ötzi también la recibe para acompañar la resolución.',
        quoteVar: 'artist_response', quoteLabel: 'Respuesta del artista', ctaLabel: 'Ver la respuesta', ctaVar: 'dashboard_url'
    },
    'instagram-verification': {
        subject: 'Tu código para validar Instagram', preheader: 'Manda este código por mensaje directo a nuestra cuenta de Instagram para validar tu perfil.',
        eyebrow: 'VALIDACIÓN DE INSTAGRAM', greeting: 'Hola, {{artist_name}}.', headline: 'Tu código para validar Instagram',
        intro: 'Este es tu código para validar tu cuenta de Instagram en We Ötzi. Desde {{instagram_handle}}, sigue a {{weotzi_instagram}} y mándanos el código por mensaje directo. Vence en {{expires_label}}. Si no lo pediste, ignora este correo.',
        highlightVar: 'verification_code', highlightLabel: 'Tu código', highlightSize: 30,
        ctaLabel: 'Abrir mensaje directo', ctaVar: 'dm_url'
    },
    'job-board-application': {
        subject: '{{artist_name}} se postuló a tu idea', preheader: 'Un artista quiere tomar tu solicitud. Revisa su propuesta, precio estimado y mensaje.',
        eyebrow: 'JOB BOARD · POSTULACIÓN', greeting: 'Hola, {{client_name}}.', headline: 'Tienes una nueva postulación',
        intro: '{{artist_name}} quiere tomar tu solicitud. Revisa su propuesta antes de decidir.',
        quoteVar: 'message', quoteLabel: 'Mensaje del artista', ctaLabel: 'Ver postulaciones', ctaVar: 'dashboard_url'
    },
    'job-board-confirmed': {
        subject: 'Tu idea ya está en el Job Board', preheader: 'Tu solicitud quedó publicada para artistas compatibles. Te avisamos cuando lleguen postulaciones.',
        eyebrow: 'JOB BOARD · PUBLICADA', greeting: 'Hola, {{client_name}}.', headline: 'Tu solicitud fue publicada',
        intro: 'Tu idea quedó disponible para artistas compatibles. Te avisamos cuando lleguen postulaciones.',
        ctaLabel: 'Ver mi solicitud', ctaVar: 'dashboard_url'
    },
    'password-reset': {
        subject: 'Tu contraseña temporal de We Ötzi', preheader: 'Usa esta contraseña temporal para entrar y cámbiala apenas ingreses a tu cuenta.',
        eyebrow: 'SEGURIDAD DE LA CUENTA', headline: 'Tu contraseña temporal',
        intro: 'Usa esta contraseña para entrar con {{email}} y cámbiala desde tu cuenta apenas ingreses.',
        highlightVar: 'temp_password', highlightLabel: 'Contraseña temporal', highlightSize: 26,
        note: 'No compartas esta contraseña con nadie. Nadie del equipo de We Ötzi te la va a pedir.',
        ctaLabel: 'Iniciar sesión', ctaVar: 'login_url'
    },
    'platform-update': {
        subject: 'Novedades en We Ötzi', preheader: 'Sumamos mejoras para que gestionar tu perfil, tus solicitudes y tu comunidad sea más simple.',
        eyebrow: 'NOVEDADES', greeting: 'Hola, {{recipient_name}}.', headline: 'Novedades en We Ötzi',
        intro: 'Sumamos mejoras para que gestionar tu perfil, tus solicitudes y tu comunidad sea más simple.',
        ctaLabel: 'Entrar a We Ötzi', ctaVar: 'dashboard_url'
    },
    'profile-verified': {
        subject: 'Tu perfil está verificado', preheader: 'Tu perfil ya muestra la insignia de verificación de We Ötzi. Los clientes la van a ver.',
        eyebrow: 'VERIFICACIÓN APROBADA', greeting: 'Hola, {{artist_name}}.', headline: 'Tu perfil fue verificado',
        intro: 'Revisamos tu documentación y tu perfil ya muestra la insignia de verificación de We Ötzi.',
        ctaLabel: 'Ver mi cuenta', ctaVar: 'account_url'
    },
    // COT-A-11: el artista registra el acuerdo → aviso al cliente.
    'quotation-agreement-client': {
        subject: 'Tu tatuaje con {{artist_name}} tiene acuerdo', preheader: 'Guarda este resumen: presupuesto final, anticipo, sesiones y la primera fecha que acordaron.',
        eyebrow: 'ACUERDO CONFIRMADO', greeting: 'Hola, {{client_name}}.', headline: 'Tu tatuaje tiene acuerdo',
        intro: '{{artist_name}} registró lo que acordaron. Guarda este resumen: tiene el presupuesto final, el anticipo, las sesiones y la primera fecha.',
        ctaLabel: 'Ver mi cotización', ctaVar: 'dashboard_url'
    },
    'quotation-approved': {
        subject: '{{client_name}} aprobó tu propuesta', preheader: 'La cotización avanzó. Coordina la agenda y confirma los detalles finales desde el expediente.',
        eyebrow: 'PROPUESTA APROBADA', greeting: 'Hola, {{artist_name}}.', headline: 'Tu propuesta fue aprobada',
        intro: '{{client_name}} aprobó tu propuesta. Coordina la sesión y confirma los detalles desde el expediente.',
        ctaLabel: 'Abrir el expediente', ctaVar: 'quotation_url'
    },
    'quotation-completed': {
        subject: 'Cotización {{quote_id}} completada', preheader: 'El trabajo quedó cerrado. Te dejamos el resumen final con monto, sesiones y fecha.',
        eyebrow: 'COTIZACIÓN COMPLETADA', headline: 'Trabajo completado',
        intro: 'La cotización entre {{client_name}} y {{artist_name}} quedó completada.',
        quoteVar: 'final_comment', quoteLabel: 'Comentario final', ctaLabel: 'Ver la cotización', ctaVar: 'quotation_url'
    },
    'quotation-confirmation-client': {
        subject: 'Recibimos tu solicitud {{quote_id}}', preheader: 'Enviamos tu idea al artista. Te avisamos por email cuando responda.',
        eyebrow: 'SOLICITUD ENVIADA', greeting: 'Hola, {{client_full_name}}.', headline: 'Tu solicitud fue enviada',
        intro: 'Enviamos tu idea a {{artist_name}}. Te avisamos por email cuando responda; mientras tanto puedes seguir la solicitud desde tu cuenta.',
        ctaLabel: 'Seguir mi solicitud', ctaVar: 'quotation_url'
    },
    'quotation-expired': {
        subject: 'La propuesta de {{artist_name}} venció', preheader: 'La propuesta venció sin respuesta. Si todavía te interesa, escríbele al artista o pide una nueva.',
        eyebrow: 'PROPUESTA VENCIDA', greeting: 'Hola, {{client_name}}.', headline: 'La propuesta venció',
        intro: 'La propuesta de {{artist_name}} venció sin respuesta. Si todavía te interesa, escríbele o pide una nueva cotización desde tu cuenta.',
        ctaLabel: 'Ir a mi cuenta', ctaVar: 'dashboard_url'
    },
    'quotation-ready-client': {
        subject: 'Tu tatuaje está listo para revisar', preheader: 'Tu artista marcó el trabajo como terminado. Revísalo y confirma la entrega desde tu cuenta.',
        eyebrow: 'ENTREGA LISTA', greeting: 'Hola, {{client_name}}.', headline: 'Tu tatuaje está listo para revisar',
        intro: '{{artist_name}} marcó el trabajo como terminado. Entra a tu cuenta para revisarlo y aprobar la entrega, o cuéntale qué hay que ajustar.',
        ctaLabel: 'Revisar la entrega', ctaVar: 'dashboard_url'
    },
    'quotation-rejected': {
        subject: '{{client_name}} no aprobó la propuesta', preheader: 'La cotización se cerró sin aprobación. El historial queda disponible en tu panel.',
        eyebrow: 'PROPUESTA NO APROBADA', greeting: 'Hola, {{artist_name}}.', headline: 'La propuesta no fue aprobada',
        intro: '{{client_name}} decidió no avanzar con esta cotización. Conservamos el historial por si quieres revisarlo.',
        ctaLabel: 'Ver la cotización', ctaVar: 'quotation_url'
    },
    'request-rating': {
        subject: '¿Cómo fue tu experiencia con {{artist_name}}?', preheader: 'Tu reseña ayuda a cuidar la comunidad y a que otras personas elijan con más información.',
        eyebrow: 'TU EXPERIENCIA', greeting: 'Hola, {{client_name}}.', headline: 'Cuéntanos cómo te fue',
        intro: 'Tu trabajo con {{artist_name}} quedó completado. Dejar una reseña lleva un minuto y ayuda a otras personas a elegir.',
        ctaLabel: 'Dejar mi reseña', ctaVar: 'review_url'
    },
    'session-cancelled': {
        subject: 'La sesión se canceló', preheader: 'Registramos la cancelación de la sesión para que ambas partes tengan la agenda al día.',
        eyebrow: 'SESIÓN CANCELADA', greeting: 'Hola, {{recipient_name}}.', headline: 'La sesión se canceló',
        intro: 'La sesión entre {{client_name}} y {{artist_name}} se canceló.',
        ctaLabel: 'Ver la cotización', ctaVar: 'quotation_url'
    },
    'session-completed': {
        subject: 'Sesión completada', preheader: 'La sesión quedó registrada como completada. El resumen queda en tu cuenta de We Ötzi.',
        eyebrow: 'SESIÓN COMPLETADA', headline: 'Sesión completada',
        intro: 'La sesión entre {{client_name}} y {{artist_name}} quedó registrada como completada.',
        ctaLabel: 'Ver la cotización', ctaVar: 'quotation_url'
    },
    'session-reminder': {
        subject: 'Recordatorio: tu sesión es mañana', preheader: 'Tu sesión es mañana. Revisa fecha, horario y detalles para llegar con todo listo.',
        eyebrow: 'RECORDATORIO DE SESIÓN', greeting: 'Hola, {{recipient_name}}.', headline: 'Tu sesión es mañana',
        intro: 'Mañana es la sesión entre {{client_name}} y {{artist_name}}. Revisa los detalles para llegar con todo listo.',
        ctaLabel: 'Ver mi cuenta', ctaVar: 'dashboard_url'
    },
    'session-rescheduled': {
        subject: 'Cambió la fecha de la sesión', preheader: 'La sesión se reprogramó. Revisa la nueva fecha antes de confirmar tu agenda.',
        eyebrow: 'SESIÓN REPROGRAMADA', headline: 'Cambió la fecha de la sesión',
        intro: 'La sesión entre {{client_name}} y {{artist_name}} se reprogramó. Revisa la nueva fecha.',
        ctaLabel: 'Ver la cotización', ctaVar: 'quotation_url'
    },
    'session-scheduled': {
        subject: 'Sesión agendada', preheader: 'La sesión ya está en el calendario. Guarda este resumen con fecha, duración y cotización.',
        eyebrow: 'SESIÓN AGENDADA', headline: 'Sesión agendada',
        intro: 'La sesión entre {{client_name}} y {{artist_name}} ya está en el calendario.',
        ctaLabel: 'Ver la cotización', ctaVar: 'quotation_url'
    },
    'studio-notification': {
        subject: '{{subject}}', preheader: 'Tu estudio tiene una novedad para ti en We Ötzi. Revisa los detalles y responde desde tu cuenta.',
        eyebrow: 'ESTUDIOS', greeting: 'Hola, {{recipient_name}}.', headline: '{{subject}}',
        intro: '{{body_text}}', ctaLabel: 'Ver en We Ötzi', ctaVar: 'dashboard_url'
    },
    'support-decision': {
        subject: 'Soporte: {{decision_title}}', preheader: 'Soporte revisó tu cuenta de We Ötzi. Te contamos el detalle y los próximos pasos.',
        eyebrow: 'REVISIÓN DE SOPORTE', greeting: 'Hola, {{artist_name}}.', headline: 'Soporte revisó tu cuenta',
        intro: '{{decision_title}}. {{decision_detail}}',
        quoteVar: 'support_note', quoteLabel: 'Nota de soporte', ctaLabel: 'Ver mi cuenta', ctaVar: 'dashboard_url'
    },
    'verification-denied': {
        subject: 'Necesitamos revisar tu verificación', preheader: 'No pudimos verificar tu perfil con la información actual. Revisa el motivo y vuelve a enviarla.',
        eyebrow: 'VERIFICACIÓN', greeting: 'Hola, {{artist_name}}.', headline: 'Necesitamos ajustar tu verificación',
        intro: 'No pudimos verificar tu perfil con la información actual. Revisa el motivo, corrige lo pendiente y vuelve a enviarla desde tu cuenta.',
        quoteVar: 'reason', quoteLabel: 'Motivo', ctaLabel: 'Revisar mi verificación', ctaVar: 'account_url'
    },
    'weekly-digest': {
        subject: 'Tu semana en We Ötzi · {{week_range}}', preheader: 'Un resumen de cotizaciones, mensajes, sesiones y Job Board para cerrar la semana.',
        eyebrow: 'RESUMEN SEMANAL', greeting: 'Hola, {{artist_name}}.', headline: 'Tu semana en We Ötzi',
        intro: 'Un resumen de cotizaciones, mensajes, sesiones y Job Board de la semana {{week_range}}.'
    }
};

// Workflows de n8n que todavía usan su propio HTML (ver docs/N8N_EMAIL_WEBHOOKS.md).
// El workflow "Ronda 3" (8N3w5FsaVW5FvSEw) no está aquí porque sus nodos no son
// legibles por la API; el relé genérico lo reemplaza.
const NODE_TEMPLATE_MAP = {
    'We Otzi Email Notifications': {
        id: '7T2f3YNXeqFOjV0C',
        nodes: {
            'Email Bienvenida Artista': { template: 'artist-welcome', source: 'body' },
            'Email Bienvenida Cliente': { template: 'client-welcome', source: 'body' },
            'Estudio Respuesta Postulacion': { template: 'studio-notification', source: 'body' },
            'Estudio Invitacion Roster': { template: 'studio-notification', source: 'body' },
            'Email Password Temporal': { template: 'password-reset', source: 'body' },
            'Email Resumen Cotizacion': { template: 'quotation-confirmation-client', source: 'root' },
            'Email Notificacion Artista': { template: 'artist-quotation-notification', source: 'root' },
            'Artista Respondio': { template: 'artist-responded', source: 'body' },
            'Cotizacion Aprobada': { template: 'quotation-approved', source: 'body' },
            'Cotizacion Rechazada': { template: 'quotation-rejected', source: 'body' },
            'Cotizacion Completada': { template: 'quotation-completed', source: 'body' },
            'Job Board Confirmado': { template: 'job-board-confirmed', source: 'body' },
            'Nueva Postulacion': { template: 'job-board-application', source: 'body' },
            'Postulacion Aceptada': { template: 'application-accepted', source: 'body' },
            'Postulacion Rechazada': { template: 'application-rejected', source: 'body' },
            'Chat Mensaje Artista': { template: 'chat-message-artist', source: 'body' },
            'Chat Mensaje Cliente': { template: 'chat-message-client', source: 'body' },
            'Sesion Agendada': { template: 'session-scheduled', source: 'body' },
            'Sesion Completada': { template: 'session-completed', source: 'body' },
            'Sesion Reprogramada': { template: 'session-rescheduled', source: 'body' },
            'Sesion Cancelada': { template: 'session-cancelled', source: 'body' },
            'Perfil Verificado': { template: 'profile-verified', source: 'body' },
            'Verificacion Denegada': { template: 'verification-denied', source: 'body' },
            'Embajador Actualizado': { template: 'ambassador-updated', source: 'body' },
            'Codigo Validacion Instagram': { template: 'instagram-verification', source: 'body' },
            'Cliente Califico': { template: 'client-rating', source: 'body' },
            'Solicitar Calificacion': { template: 'request-rating', source: 'body' },
            'Email Admin Cotizacion': { template: 'admin-new-quotation', source: 'root' },
            'Actualizacion Plataforma': { template: 'platform-update', source: 'body' }
        }
    },
    'We Otzi Digest & Reports': {
        id: 'qd3fYRGe9GTrGfco',
        nodes: {
            'Email Session Reminder': { template: 'session-reminder', source: 'root' },
            'Email Daily Digest': { template: 'daily-digest', source: 'root' },
            'Email Weekly Digest': { template: 'weekly-digest', source: 'root' },
            'Email Admin Report': { template: 'admin-weekly-report', source: 'root' }
        }
    }
};

function humanize(key) {
    return LABELS[key] || key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

function placeholder(name, mode, source) {
    if (mode === 'n8n') {
        const base = source === 'body' ? '$json.body.data' : '$json';
        return `{{ ${base}.${name} || '' }}`;
    }
    return `{{${name}}}`;
}

function tokens(text) {
    return [...String(text || '').matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
}

/** Texto del spec con {{variable}} → HTML escapado + placeholders del canal. */
function renderText(text, mode, source) {
    return raw(escapeHtml(text).replace(/\{\{(\w+)\}\}/g, (_, name) => placeholder(name, mode, source)));
}

function buildEmailHtml(templateName, options = {}) {
    const entry = manifest[templateName];
    if (!entry) throw new Error(`Unknown email template: ${templateName}`);
    const spec = SPECS[templateName];
    if (!spec) throw new Error(`Missing email spec: ${templateName}`);
    const mode = options.mode || 'local';
    const source = options.source || 'body';
    const P = name => raw(placeholder(name, mode, source));
    const T = text => (text ? renderText(text, mode, source) : '');

    const used = new Set([spec.ctaVar, spec.highlightVar, spec.quoteVar, 'preferences_url',
        ...['subject', 'preheader', 'greeting', 'headline', 'intro', 'note'].flatMap(k => tokens(spec[k]))].filter(Boolean));
    const variables = entry.variables;
    const urlVars = variables.filter(v => /_url$/.test(v) && !used.has(v));
    const rowVars = spec.rows || variables.filter(v => !used.has(v) && !/_url$/.test(v));

    const model = {
        subject: T(spec.subject || spec.headline),
        preheader: T(spec.preheader),
        eyebrow: spec.eyebrow,
        greeting: T(spec.greeting),
        headline: T(spec.headline),
        intro: T(spec.intro),
        note: T(spec.note),
        highlight: spec.highlightVar ? { label: spec.highlightLabel || humanize(spec.highlightVar), value: P(spec.highlightVar), size: spec.highlightSize || 40 } : null,
        quote: spec.quoteVar ? { label: spec.quoteLabel || humanize(spec.quoteVar), text: P(spec.quoteVar) } : null,
        cta: spec.ctaVar ? { label: spec.ctaLabel || 'Abrir We Ötzi', url: P(spec.ctaVar) } : null,
        rows: rowVars.map(v => [humanize(v), P(v)]),
        rowsTitle: rowVars.length > 1 ? 'Detalle' : '',
        links: urlVars.map(v => ({ label: LINK_LABELS[v] || humanize(v), url: P(v) })),
        footer: {
            baseUrl: DEFAULT_PUBLIC_BASE,
            preferencesUrl: variables.includes('preferences_url') ? P('preferences_url') : '',
            reason: variables.includes('preferences_url') ? 'Este aviso te llega por tu actividad en We Ötzi.' : ''
        },
        comment: `Plantilla "${templateName}" generada por scripts/redesign-email-templates.js (no editar a mano).\nVariables: ${variables.join(', ')}`
    };
    const html = renderLayout(model);
    return mode === 'n8n' ? `=${html}` : html;
}

// ---------------------------------------------------------------- Supabase Auth

const SUPABASE_FOOTER = { baseUrl: raw('{{ .SiteURL }}'), year: '2026' };

const SUPABASE_TEMPLATES = {
    'supabase-confirm-signup': {
        comment: 'Supabase Auth · "Confirm signup" (Authentication → Emails → Templates).\nAsunto: Confirma tu email en We Ötzi\nVariables: {{ .Email }}, {{ .ConfirmationURL }}, {{ .SiteURL }}',
        subject: 'Confirma tu email · We Ötzi',
        preheader: 'Confirma tu email para activar tu cuenta de We Ötzi y retomar lo que dejaste cargado.',
        eyebrow: 'ÚLTIMO PASO · TU CUENTA',
        headline: 'Confirma tu email',
        intro: 'Para activar tu cuenta de We Ötzi, confirma que este email es tuyo. Abre el link desde el mismo navegador donde creaste la cuenta: así retomamos lo que dejaste cargado.',
        highlight: { label: 'CUENTA A CONFIRMAR', value: raw('{{ .Email }}'), size: 18, spacing: 0 },
        cta: { label: 'Confirmar mi email', url: raw('{{ .ConfirmationURL }}') },
        aside: { title: '¿No creaste una cuenta?', text: 'Si no creaste una cuenta en We Ötzi, ignora este email: sin confirmar, la cuenta no se activa. El link vence en 24 horas.' }
    },
    'supabase-recovery': {
        comment: 'Supabase Auth · plantilla "Reset Password" (Authentication → Emails → Reset Password).\nFigma final del flujo de artista (oct 2026): 801:1116 "Correo - Código para recuperar acceso".\nAsunto sugerido: Tu código para recuperar el acceso a We Ötzi\nVariables de Supabase (Go templates):\n  {{ .Token }}            código OTP de 6 dígitos que /recover valida con verifyOtp(type:\'recovery\')\n  {{ .ConfirmationURL }}  enlace seguro; vuelve a /recover?recovery=1 y abre el paso "Nueva contraseña"\n  {{ .SiteURL }}          URL del sitio configurada en Supabase (links del pie)\n  {{ .Data.full_name }}   nombre guardado en user_metadata (si existe)\n"Este código vence en 10 minutos": configurar Email OTP Expiration = 600 s en Supabase\n(Authentication → Providers → Email) para que el texto sea exacto.',
        subject: 'Tu código para recuperar el acceso a We Ötzi',
        preheader: 'Usa este código para recuperar el acceso a tu cuenta de We Ötzi. Vence en 10 minutos.',
        eyebrow: 'SEGURIDAD DE LA CUENTA',
        greeting: raw('{{ if .Data.full_name }}Hola, {{ .Data.full_name }}.{{ else }}Hola.{{ end }}'),
        headline: 'Recupera tu acceso',
        intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta de We Ötzi.',
        introMargin: 78,
        highlight: { label: 'TU CÓDIGO DE VERIFICACIÓN', value: raw('{{ .Token }}'), note: 'Este código vence en 10 minutos.', size: 46, spacing: 12 },
        note: 'No compartas este código con nadie. Nadie del equipo de We Ötzi te lo va a pedir.',
        cta: { label: 'Continuar recuperación', url: raw('{{ .ConfirmationURL }}') },
        aside: { title: '¿No solicitaste este cambio?', text: 'Puedes ignorar este mensaje. Tu contraseña continuará siendo la misma y no se realizará ningún cambio en tu cuenta.' }
    },
    'supabase-password-changed': {
        comment: 'Supabase Auth · notificación de seguridad "Password changed"\n(Authentication → Emails → Security notifications → Password changed; habilitar el envío).\nMisma pieza que templates/email/password-updated.html (Figma 2001:3351) con variables de Supabase.\nAsunto sugerido: Tu contraseña de We Ötzi se actualizó\nVariables: {{ .Email }}, {{ .SiteURL }}',
        subject: 'Tu contraseña se actualizó · We Ötzi',
        preheader: 'Cambiaste la contraseña de tu cuenta de We Ötzi correctamente. Ya puedes iniciar sesión.',
        eyebrow: 'SEGURIDAD DE LA CUENTA',
        headline: 'Tu contraseña se actualizó',
        intro: 'Cambiaste la contraseña de tu cuenta de We Ötzi correctamente. Ya puedes iniciar sesión con tu nueva contraseña.',
        highlight: { label: 'CONTRASEÑA ACTUALIZADA', value: raw('{{ .Email }}'), size: 18, spacing: 0 },
        cta: { label: 'Iniciar sesión', url: raw('{{ .SiteURL }}/bienvenida') },
        aside: { title: '¿No hiciste este cambio?', text: 'Si no reconoces este cambio, restablece tu contraseña cuanto antes para proteger tu cuenta. Si necesitas ayuda, contacta a nuestro equipo de soporte.' },
        secondary: { label: 'Proteger mi cuenta →', url: raw('{{ .SiteURL }}/recover') }
    },
    'supabase-magic-link': {
        comment: 'Supabase Auth · "Magic Link" (Authentication → Emails → Magic Link).\nLo usa signInWithOtp({ shouldCreateUser: false }) del login de artista (y del cliente cuando se sume).\nAsunto: Tu link para entrar a We Ötzi\nVariables: {{ .ConfirmationURL }}, {{ .Token }}, {{ .Email }}, {{ .SiteURL }}',
        subject: 'Tu link para entrar a We Ötzi',
        preheader: 'Entra a tu cuenta de We Ötzi con un toque, sin contraseña. El link vence pronto.',
        eyebrow: 'ACCESO SIN CONTRASEÑA',
        headline: 'Entra a We Ötzi',
        intro: 'Toca el botón para entrar a tu cuenta con este email. Ábrelo en el mismo dispositivo donde lo pediste.',
        cta: { label: 'Entrar a We Ötzi', url: raw('{{ .ConfirmationURL }}') },
        highlight: { label: 'O USA ESTE CÓDIGO', value: raw('{{ .Token }}'), note: 'El link y el código vencen en 10 minutos.', size: 34, spacing: 8 },
        note: 'No compartas este link ni el código con nadie. Nadie del equipo de We Ötzi te los va a pedir.',
        aside: { title: '¿No pediste entrar?', text: 'Puedes ignorar este mensaje: sin el link o el código nadie puede entrar a tu cuenta.' }
    },
    'supabase-email-change': {
        comment: 'Supabase Auth · "Change Email Address" (Authentication → Emails → Change Email Address).\nLo dispara updateUser({ email }) desde la cuenta del artista o del cliente.\nAsunto: Confirma tu nuevo email en We Ötzi\nVariables: {{ .ConfirmationURL }}, {{ .Email }} (actual), {{ .NewEmail }}, {{ .Token }}, {{ .SiteURL }}',
        subject: 'Confirma tu nuevo email en We Ötzi',
        preheader: 'Confirma el cambio de email de tu cuenta de We Ötzi. Hasta entonces sigues entrando con el anterior.',
        eyebrow: 'SEGURIDAD DE LA CUENTA',
        headline: 'Confirma tu nuevo email',
        intro: raw(`${escapeHtml('Pediste cambiar el email de tu cuenta de We Ötzi de')} {{ .Email }} ${escapeHtml('a')} {{ .NewEmail }}. ${escapeHtml('Confirma el cambio para empezar a usarlo.')}`),
        highlight: { label: 'NUEVO EMAIL', value: raw('{{ .NewEmail }}'), size: 18, spacing: 0 },
        cta: { label: 'Confirmar el cambio', url: raw('{{ .ConfirmationURL }}') },
        aside: { title: '¿No pediste este cambio?', text: 'No toques el link y cambia tu contraseña desde tu cuenta. Si necesitas ayuda, escríbenos a soporte.' }
    },
    'password-updated': {
        comment: 'Correo "Contraseña actualizada" — Figma final del flujo de artista (oct 2026),\n2001:3351 "Recuperar acceso - 05 Correo contraseña actualizada".\nAsunto sugerido: Tu contraseña de We Ötzi se actualizó\nVariables {{variable}}: {{nombre}}, {{fecha}}, {{hora}}, {{zona_horaria}}, {{login_url}}, {{recover_url}}, {{año}}.\nAlternativa sin servidor: templates/email/supabase-password-changed.html.',
        subject: 'Tu contraseña se actualizó · We Ötzi',
        preheader: 'Cambiaste la contraseña de tu cuenta de We Ötzi correctamente. Ya puedes iniciar sesión.',
        eyebrow: 'SEGURIDAD DE LA CUENTA',
        greeting: raw('Hola, {{nombre}}.'),
        headline: 'Tu contraseña se actualizó',
        intro: 'Cambiaste la contraseña de tu cuenta de We Ötzi correctamente. Ya puedes iniciar sesión con tu nueva contraseña.',
        highlight: { label: 'CONTRASEÑA ACTUALIZADA', value: raw('{{fecha}} &middot; {{hora}} ({{zona_horaria}})'), size: 16, spacing: 0 },
        cta: { label: 'Iniciar sesión', url: raw('{{login_url}}') },
        aside: { title: '¿No hiciste este cambio?', text: 'Si no reconoces este cambio, restablece tu contraseña cuanto antes para proteger tu cuenta. Si necesitas ayuda, contacta a nuestro equipo de soporte.' },
        secondary: { label: 'Proteger mi cuenta →', url: raw('{{recover_url}}') },
        footer: { baseUrl: DEFAULT_PUBLIC_BASE, year: raw('{{año}}') }
    }
};

function buildAuthTemplate(name) {
    const spec = SUPABASE_TEMPLATES[name];
    if (!spec) throw new Error(`Unknown auth template: ${name}`);
    return renderLayout({ footer: SUPABASE_FOOTER, ...spec });
}

// ---------------------------------------------------------------- escritura

function minify(html) {
    return html
        // Fuera los comentarios de documentación; quedan los condicionales de Outlook.
        .replace(/<!--(?!\[if|>|<!\[endif)[\s\S]*?-->/g, '')
        .replace(/>\s+</g, '><')
        .replace(/\s{2,}/g, ' ')
        .replace(/\n/g, '')
        .trim();
}

function writeTemplates(only) {
    const baseDir = path.join(ROOT, 'templates/email');
    const bmDir = path.join(baseDir, 'billionmail');
    // `--only=<nombre>` regenera una sola plantilla (sin tocar las demás).
    const names = Object.keys(manifest).sort().filter((name) => !only || name === only);
    for (const name of names) {
        const html = buildEmailHtml(name, { mode: 'local' });
        fs.writeFileSync(path.join(bmDir, `${name}.html`), html, 'utf8');
        fs.writeFileSync(path.join(baseDir, `${name}.html`), html, 'utf8');
        fs.writeFileSync(path.join(baseDir, `${name}.min.html`), minify(html), 'utf8');
    }
    const auth = Object.keys(SUPABASE_TEMPLATES).filter((name) => !only || name === only);
    for (const name of auth) {
        fs.writeFileSync(path.join(baseDir, `${name}.html`), buildAuthTemplate(name), 'utf8');
    }
    return names.length + auth.length;
}

async function requestJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!res.ok) {
        const err = new Error(`n8n API ${res.status}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return body;
}

function cleanWorkflowForUpdate(workflow) {
    return {
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings || {},
        staticData: workflow.staticData || null,
        pinData: workflow.pinData || {},
        active: workflow.active
    };
}

async function syncN8nWorkflows() {
    const n8nUrl = process.env.N8N_URL;
    const apiKey = process.env.N8N_API_KEY;
    if (!n8nUrl || !apiKey) {
        throw new Error('Set N8N_URL and N8N_API_KEY to sync n8n workflows.');
    }
    const base = n8nUrl.replace(/\/$/, '');
    const headers = {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': apiKey
    };
    const backupDir = path.join(ROOT, 'tmp', 'n8n-email-workflow-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = [];
    for (const [workflowName, cfg] of Object.entries(NODE_TEMPLATE_MAP)) {
        const workflow = await requestJson(`${base}/api/v1/workflows/${cfg.id}`, { headers });
        fs.writeFileSync(path.join(backupDir, `${stamp}-${cfg.id}.json`), JSON.stringify(workflow, null, 2), 'utf8');
        let updatedNodes = 0;
        for (const node of workflow.nodes || []) {
            const map = cfg.nodes[node.name];
            if (!map || node.type !== 'n8n-nodes-base.emailSend') continue;
            node.parameters = node.parameters || {};
            node.parameters.html = buildEmailHtml(map.template, { mode: 'n8n', source: map.source });
            updatedNodes += 1;
        }
        const payload = cleanWorkflowForUpdate(workflow);
        try {
            await requestJson(`${base}/api/v1/workflows/${cfg.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });
        } catch (err) {
            if (err.status === 400) {
                delete payload.active;
                await requestJson(`${base}/api/v1/workflows/${cfg.id}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify(payload)
                });
            } else {
                throw err;
            }
        }
        result.push({ workflowName, workflowId: cfg.id, updatedNodes });
    }
    return result;
}

async function main() {
    const args = new Set(process.argv.slice(2));
    const onlyArg = [...args].find((a) => a.startsWith('--only='));
    const count = writeTemplates(onlyArg ? onlyArg.slice('--only='.length) : null);
    console.log(`Generated ${count} email templates in templates/email and templates/email/billionmail.`);
    if (args.has('--sync-n8n')) {
        const result = await syncN8nWorkflows();
        console.log(JSON.stringify({ synced: result }, null, 2));
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}

module.exports = {
    buildEmailHtml,
    buildAuthTemplate,
    minify,
    manifest,
    NODE_TEMPLATE_MAP,
    SPECS,
    SUPABASE_TEMPLATES
};
