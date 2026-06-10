#!/usr/bin/env node
/*
 * Generate We Otzi transactional email templates and optionally sync the same
 * HTML into the active n8n email workflows.
 *
 * Usage:
 *   node scripts/redesign-email-templates.js
 *   N8N_URL=https://... N8N_API_KEY=... node scripts/redesign-email-templates.js --sync-n8n
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'templates/email/billionmail/manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const COLORS = {
    paper: '#F2EFE6',
    paperAlt: '#FFFCF3',
    ink: '#15110D',
    muted: '#6F6A61',
    line: '#15110D',
    red: '#EE3524',
    blue: '#2445AD',
    yellow: '#F4B51C',
    green: '#2FA84F'
};

const LABELS = {
    age: 'Edad',
    artist_budget_amount: 'Monto propuesto',
    artist_budget_currency: 'Moneda propuesta',
    artist_current_city: 'Ciudad del artista',
    artist_email: 'Email del artista',
    artist_name: 'Artista',
    artist_studio_name: 'Estudio',
    artistic_name: 'Nombre artistico',
    attachments_count: 'Referencias adjuntas',
    attachments_html: 'Vista de referencias',
    ambassador_status: 'Estado embajador',
    bio: 'Bio',
    budget_currency: 'Moneda',
    budget_max: 'Presupuesto maximo',
    budget_min: 'Presupuesto minimo',
    cause: 'Categoria',
    city: 'Ciudad',
    client_age: 'Edad del cliente',
    client_allergies: 'Alergias',
    client_budget: 'Presupuesto cliente',
    client_budget_amount: 'Presupuesto',
    client_budget_currency: 'Moneda',
    client_city_residence: 'Ciudad del cliente',
    client_contact_preference: 'Contacto preferido',
    client_email: 'Email del cliente',
    client_flexible_dates: 'Fechas flexibles',
    client_full_name: 'Cliente',
    client_health_conditions: 'Condiciones medicas',
    client_instagram: 'Instagram cliente',
    client_name: 'Cliente',
    client_preferred_date: 'Fecha preferida',
    client_travel_willing: 'Disponibilidad para viajar',
    client_whatsapp: 'WhatsApp cliente',
    completed_quotes: 'Cotizaciones completadas',
    completed_week: 'Completadas esta semana',
    country: 'Pais',
    dashboard_url: 'Dashboard',
    date: 'Fecha',
    duration_hours: 'Duracion estimada',
    email: 'Email',
    estimated_price: 'Precio estimado',
    estimated_sessions: 'Sesiones estimadas',
    feature_1_description: 'Detalle 1',
    feature_1_title: 'Novedad 1',
    feature_2_description: 'Detalle 2',
    feature_2_title: 'Novedad 2',
    feature_3_description: 'Detalle 3',
    feature_3_title: 'Novedad 3',
    final_budget_amount: 'Monto final',
    final_budget_currency: 'Moneda final',
    final_comment: 'Comentario final',
    final_sessions: 'Sesiones finales',
    first_session_date: 'Primera sesion',
    full_name: 'Nombre completo',
    instagram: 'Instagram',
    job_board_applications: 'Postulaciones',
    login_url: 'Login',
    message: 'Mensaje',
    message_preview: 'Vista previa',
    messages_received: 'Mensajes recibidos',
    new_jb_applications: 'Nuevas postulaciones',
    new_jb_requests: 'Nuevas solicitudes job board',
    new_quotes: 'Nuevas cotizaciones',
    new_quotes_week: 'Cotizaciones nuevas',
    new_today: 'Novedades de hoy',
    new_users_week: 'Usuarios nuevos',
    password: 'Contrasena',
    pending_count: 'Pendientes',
    pending_total: 'Pendientes totales',
    portfolio_url: 'Portfolio',
    profile_url: 'Perfil publico',
    quotation_medium: 'Medio de cotizacion',
    quote_id: 'ID de cotizacion',
    rating: 'Calificacion',
    rating_comment: 'Comentario',
    reason: 'Motivo',
    recipient_name: 'Destinatario',
    request_code: 'Codigo de solicitud',
    responded_quotes: 'Respondidas',
    session_date: 'Fecha de sesion',
    session_number: 'Numero de sesion',
    session_price: 'Tarifa por sesion',
    sessions_completed: 'Sesiones completadas',
    studio: 'Estudio',
    styles_text: 'Estilos',
    tattoo_body_part: 'Zona del cuerpo',
    tattoo_body_side: 'Lado',
    tattoo_color_type: 'Color',
    tattoo_idea_description: 'Idea del tatuaje',
    tattoo_is_cover_up: 'Cover up',
    tattoo_is_first_tattoo: 'Primer tatuaje',
    tattoo_location: 'Zona del cuerpo',
    tattoo_references: 'Referencias',
    tattoo_size: 'Tamano',
    tattoo_style: 'Estilo',
    total_active: 'Activos',
    total_artists: 'Artistas',
    total_clients: 'Clientes',
    unread_messages: 'Mensajes sin leer',
    upcoming_sessions: 'Proximas sesiones',
    user_email: 'Email usuario',
    username: 'Usuario',
    week_range: 'Semana',
    whatsapp: 'WhatsApp',
    work_type: 'Modalidad',
    years_experience: 'Experiencia'
};

const SPECS = {
    'admin-new-quotation': {
        eyebrow: 'ADMIN / COTIZACION',
        headline: 'Nueva cotizacion en el sistema.',
        intro: 'Se registro una solicitud nueva. El resumen conserva cliente, artista, estilo y presupuesto para control operativo.'
    },
    'admin-weekly-report': {
        eyebrow: 'ADMIN / REPORTE',
        headline: 'Resumen semanal We Otzi.',
        intro: 'Lectura compacta de crecimiento, actividad y conversiones para revisar el estado de la plataforma.'
    },
    'ambassador-updated': {
        eyebrow: 'ARTISTA / EMBAJADOR',
        headline: 'Tu estado de embajador fue actualizado.',
        intro: 'Actualizamos tu estado dentro del programa. Revisa el nuevo estado y continua gestionando tu perfil desde We Otzi.'
    },
    'application-accepted': {
        eyebrow: 'JOB BOARD / ACEPTADA',
        headline: 'Tu postulacion fue aceptada.',
        intro: 'El cliente eligio avanzar contigo. Te dejamos los datos clave de la solicitud para coordinar los siguientes pasos.'
    },
    'application-rejected': {
        eyebrow: 'JOB BOARD / CIERRE',
        headline: 'Esta vez no fue seleccionada.',
        intro: 'La solicitud siguio otro camino. Mantener tu portfolio actualizado ayuda a mejorar futuras oportunidades.'
    },
    'artist-quotation-notification': {
        eyebrow: 'ARTISTA / NUEVA COTIZACION',
        headline: 'Tienes una nueva solicitud.',
        intro: 'Un cliente envio una idea para cotizar. Este email incluye el brief completo, datos de contacto y referencias disponibles.'
    },
    'artist-responded': {
        eyebrow: 'COTIZACION / RESPUESTA',
        headline: 'El artista respondio tu cotizacion.',
        intro: 'Ya tienes una respuesta para revisar. Compara la propuesta, las sesiones estimadas y los datos del tatuaje antes de aprobar.'
    },
    'artist-welcome': {
        eyebrow: 'REGISTRO ARTISTA',
        headline: 'Tu perfil esta en revision.',
        intro: 'Recibimos tu registro de artista. Guardamos tus credenciales y datos principales para que puedas volver al dashboard cuando lo necesites.',
        ctaLabel: 'Abrir dashboard',
        ctaVar: 'dashboard_url'
    },
    'chat-message-artist': {
        eyebrow: 'CHAT / ARTISTA',
        headline: 'Nuevo mensaje de cliente.',
        intro: 'Tienes una conversacion esperando respuesta. Revisa el contexto y responde desde el dashboard.'
    },
    'chat-message-client': {
        eyebrow: 'CHAT / CLIENTE',
        headline: 'El artista te envio un mensaje.',
        intro: 'Hay una actualizacion en tu conversacion. Mantener la respuesta dentro de We Otzi ayuda a ordenar la cotizacion.'
    },
    'client-rating': {
        eyebrow: 'CALIFICACION / ARTISTA',
        headline: 'Un cliente califico tu trabajo.',
        intro: 'Recibiste una nueva valoracion. El comentario y la nota ayudan a entender la experiencia despues de la sesion.'
    },
    'client-welcome': {
        eyebrow: 'REGISTRO CLIENTE',
        headline: 'Tu cuenta esta lista.',
        intro: 'Creamos tu acceso para que puedas seguir tus cotizaciones, mensajes y sesiones desde We Otzi.',
        ctaLabel: 'Entrar al dashboard',
        ctaVar: 'dashboard_url'
    },
    'daily-digest': {
        eyebrow: 'DIGEST / DIARIO',
        headline: 'Tu dia en We Otzi.',
        intro: 'Resumen rapido de nuevas oportunidades, pendientes, mensajes y sesiones para mantener tu agenda clara.'
    },
    'job-board-application': {
        eyebrow: 'JOB BOARD / POSTULACION',
        headline: 'Nuevo artista postulo.',
        intro: 'Un artista quiere tomar tu solicitud. Revisa su propuesta, precio estimado y mensaje antes de decidir.'
    },
    'job-board-confirmed': {
        eyebrow: 'JOB BOARD / PUBLICADA',
        headline: 'Tu solicitud fue publicada.',
        intro: 'El pedido quedo disponible para artistas compatibles. Te avisaremos cuando lleguen postulaciones.'
    },
    'password-reset': {
        eyebrow: 'SEGURIDAD / ACCESO',
        headline: 'Tu contrasena temporal.',
        intro: 'Usa esta contrasena para entrar y cambiala desde tu cuenta apenas ingreses.',
        ctaLabel: 'Iniciar sesion',
        ctaVar: 'login_url'
    },
    'platform-update': {
        eyebrow: 'PRODUCTO / NOVEDADES',
        headline: 'Novedades en We Otzi.',
        intro: 'Sumamos mejoras para que gestionar tu perfil, tus solicitudes y tu comunidad sea mas simple.'
    },
    'profile-verified': {
        eyebrow: 'VERIFICACION / APROBADA',
        headline: 'Tu perfil fue verificado.',
        intro: 'Tu perfil ya cuenta con la validacion de We Otzi. Desde ahora puedes operar con mayor confianza dentro de la plataforma.'
    },
    'quotation-approved': {
        eyebrow: 'COTIZACION / APROBADA',
        headline: 'El cliente aprobo tu propuesta.',
        intro: 'La cotizacion avanzo. Usa los datos del resumen para coordinar agenda y confirmar detalles finales.'
    },
    'quotation-completed': {
        eyebrow: 'COTIZACION / COMPLETADA',
        headline: 'Cotizacion completada.',
        intro: 'El proceso quedo cerrado. El resumen conserva monto final, sesiones y primera fecha acordada.'
    },
    'quotation-confirmation-client': {
        eyebrow: 'CLIENTE / COTIZACION',
        headline: 'Tu cotizacion fue enviada.',
        intro: 'Enviamos tu solicitud al artista. Este resumen conserva todo el brief para que puedas revisar lo que se compartio.'
    },
    'quotation-rejected': {
        eyebrow: 'COTIZACION / NO APROBADA',
        headline: 'La propuesta no fue aprobada.',
        intro: 'El cliente decidio no avanzar con esta cotizacion. Conservamos el contexto por si necesitas revisarlo.'
    },
    'request-rating': {
        eyebrow: 'EXPERIENCIA / CALIFICACION',
        headline: 'Como fue tu experiencia?',
        intro: 'Tu opinion ayuda a cuidar la comunidad y a que otros clientes elijan con mas informacion.'
    },
    'session-cancelled': {
        eyebrow: 'SESION / CANCELADA',
        headline: 'La sesion fue cancelada.',
        intro: 'Registramos la cancelacion para mantener a ambas partes alineadas. Revisa fecha, numero de sesion y cotizacion asociada.'
    },
    'session-completed': {
        eyebrow: 'SESION / COMPLETADA',
        headline: 'Sesion marcada como completada.',
        intro: 'La sesion quedo registrada. Este resumen mantiene el contexto operativo para seguimiento.'
    },
    'session-reminder': {
        eyebrow: 'SESION / RECORDATORIO',
        headline: 'Tu sesion es manana.',
        intro: 'Recordatorio previo para llegar con todo listo. Revisa artista, cliente, fecha y acceso al dashboard.',
        ctaLabel: 'Ver dashboard',
        ctaVar: 'dashboard_url'
    },
    'session-rescheduled': {
        eyebrow: 'SESION / REPROGRAMADA',
        headline: 'La sesion fue reprogramada.',
        intro: 'Actualizamos la fecha de la sesion. Revisa los datos antes de confirmar tu agenda.'
    },
    'session-scheduled': {
        eyebrow: 'SESION / AGENDADA',
        headline: 'Sesion agendada.',
        intro: 'La sesion ya esta en calendario. Guarda este resumen con fecha, duracion y cotizacion relacionada.'
    },
    'verification-denied': {
        eyebrow: 'VERIFICACION / REVISION',
        headline: 'Necesitamos ajustar tu perfil.',
        intro: 'No pudimos verificar el perfil con la informacion actual. Revisa el motivo y corrige los datos pendientes.'
    },
    'weekly-digest': {
        eyebrow: 'DIGEST / SEMANAL',
        headline: 'Tu semana en We Otzi.',
        intro: 'Un resumen de cotizaciones, mensajes, sesiones y job board para cerrar la semana con claridad.'
    }
};

const NODE_TEMPLATE_MAP = {
    'We Otzi Email Notifications': {
        id: '7T2f3YNXeqFOjV0C',
        nodes: {
            'Email Bienvenida Artista': { template: 'artist-welcome', source: 'body' },
            'Email Bienvenida Cliente': { template: 'client-welcome', source: 'body' },
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

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function humanize(key) {
    return LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function placeholder(name, mode, source) {
    if (mode === 'n8n') {
        const base = source === 'body' ? '$json.body.data' : '$json';
        return `{{ ${base}.${name} || '' }}`;
    }
    return `{{${name}}}`;
}

function groupName(name) {
    if (/email|password|username|login_url|dashboard_url|profile_url|portfolio_url/.test(name)) return 'Acceso';
    if (/^client_|^full_name$|^age$|^whatsapp$|^instagram$/.test(name)) return 'Cliente';
    if (/^artist_|^artistic_name$|^ambassador|^styles_text$|^studio$|^work_type$|^years_experience$|^session_price$/.test(name)) return 'Artista';
    if (/^tattoo_/.test(name)) return 'Tatuaje';
    if (/^session_|^duration_hours$/.test(name)) return 'Sesion';
    if (/quote_id|request_code|budget|estimated_|final_|first_session|quotation_medium/.test(name)) return 'Operacion';
    if (/message|reason|cause|comment|description|feature_|bio|rating|allergies|health/.test(name)) return 'Contenido';
    if (/new_|total_|pending_|unread|upcoming|completed_|responded|week|date/.test(name)) return 'Metricas';
    if (/city|country/.test(name)) return 'Ubicacion';
    return 'Detalles';
}

function orderedGroups(vars) {
    const order = ['Acceso', 'Cliente', 'Artista', 'Tatuaje', 'Sesion', 'Operacion', 'Contenido', 'Metricas', 'Ubicacion', 'Detalles'];
    const groups = new Map(order.map(name => [name, []]));
    for (const variable of vars) {
        groups.get(groupName(variable)).push(variable);
    }
    return order
        .map(name => ({ name, vars: groups.get(name) }))
        .filter(group => group.vars.length);
}

function renderLogo() {
    return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
                <td style="width:13px;height:13px;background:${COLORS.red};font-size:0;line-height:0;">&nbsp;</td>
                <td style="width:7px;font-size:0;line-height:0;">&nbsp;</td>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:13px;color:${COLORS.yellow};font-weight:900;">&#9679;</td>
                <td style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:13px;color:${COLORS.blue};font-weight:900;">&#9650;</td>
                <td style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
                <td style="font-family:Arial Black,Arial,Helvetica,sans-serif;font-size:20px;line-height:20px;color:${COLORS.ink};font-weight:900;letter-spacing:0;text-transform:uppercase;">WE&Ouml;TZI</td>
            </tr>
        </table>`;
}

function row(variable, mode, source) {
    const value = placeholder(variable, mode, source);
    const raw = variable === 'attachments_html';
    return `
        <tr>
            <td class="wo-label-cell" style="border-top:2px solid ${COLORS.line};padding:12px 14px 10px 14px;width:34%;vertical-align:top;">
                <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:10px;line-height:1.3;color:${COLORS.muted};letter-spacing:2px;text-transform:uppercase;">${escapeHtml(humanize(variable))}</p>
            </td>
            <td class="wo-value-cell" style="border-top:2px solid ${COLORS.line};border-left:2px solid ${COLORS.line};padding:11px 14px 10px 14px;vertical-align:top;">
                ${raw
                    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:${COLORS.ink};">${value}</div>`
                    : `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:${COLORS.ink};font-weight:700;word-break:break-word;">${value}</p>`}
            </td>
        </tr>`;
}

function panel(title, variables, mode, source) {
    return `
        <tr>
            <td class="wo-pad-x" style="padding:0 40px 22px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:2px solid ${COLORS.line};background:${COLORS.paperAlt};table-layout:fixed;">
                    <tr>
                        <td colspan="2" style="background:${COLORS.ink};padding:10px 14px;">
                            <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.2;color:${COLORS.paper};letter-spacing:2px;text-transform:uppercase;font-weight:700;">${escapeHtml(title)}</p>
                        </td>
                    </tr>
                    ${variables.map(variable => row(variable, mode, source)).join('')}
                </table>
            </td>
        </tr>`;
}

function renderCta(spec, mode, source) {
    if (!spec.ctaVar) return '';
    const href = placeholder(spec.ctaVar, mode, source);
    return `
        <tr>
            <td class="wo-pad-x" style="padding:0 40px 24px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td style="background:${COLORS.red};border:2px solid ${COLORS.line};padding:15px 22px;text-align:center;">
                            <a href="${href}" target="_blank" style="font-family:Arial Black,Arial,Helvetica,sans-serif;font-size:15px;line-height:1;color:${COLORS.paperAlt};text-decoration:none;letter-spacing:2px;text-transform:uppercase;font-weight:900;">${escapeHtml(spec.ctaLabel || 'Abrir')} &rarr;</a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>`;
}

function buildEmailHtml(templateName, options = {}) {
    const entry = manifest[templateName];
    if (!entry) throw new Error(`Unknown email template: ${templateName}`);
    const spec = SPECS[templateName];
    if (!spec) throw new Error(`Missing email spec: ${templateName}`);
    const mode = options.mode || 'local';
    const source = options.source || 'body';
    const code = templateName.replace(/-/g, ' / ').toUpperCase();
    const groups = orderedGroups(entry.variables);
    const body = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(spec.eyebrow)} - We Otzi</title>
<style>
@media only screen and (max-width: 620px) {
  .wo-shell { padding: 12px 0 !important; }
  .wo-container { width: 84% !important; max-width: 84% !important; }
  .wo-pad { padding: 26px 18px 18px 18px !important; }
  .wo-pad-x { padding-left: 18px !important; padding-right: 18px !important; }
  .wo-h1 { font-size: 36px !important; line-height: .94 !important; }
  .wo-intro { font-size: 15px !important; line-height: 1.45 !important; }
  .wo-meta { text-align: left !important; padding-top: 14px !important; }
  .wo-label-cell, .wo-value-cell { display: block !important; width: auto !important; border-left: 0 !important; box-sizing: border-box !important; }
  .wo-value-cell { border-top: 0 !important; padding-top: 0 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.paper};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.paper};">
<tr>
<td class="wo-shell" align="center" style="padding:24px 12px;">
<table class="wo-container" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:680px;background:${COLORS.paper};border:2px solid ${COLORS.line};table-layout:fixed;">
<tr>
<td style="padding:18px 22px;border-bottom:2px solid ${COLORS.line};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;">
<tr>
<td style="vertical-align:middle;">${renderLogo()}</td>
<td class="wo-meta" align="right" style="vertical-align:middle;text-align:right;">
<p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.3;color:${COLORS.ink};letter-spacing:2px;text-transform:uppercase;">${escapeHtml(code)}</p>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="height:12px;background:${COLORS.red};font-size:0;line-height:0;">&nbsp;</td>
</tr>
<tr>
<td class="wo-pad" style="padding:38px 40px 24px 40px;">
<p style="margin:0 0 18px 0;font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.3;color:${COLORS.ink};letter-spacing:2px;text-transform:uppercase;"><span style="color:${COLORS.red};font-size:16px;">&#9679;</span>&nbsp; ${escapeHtml(spec.eyebrow)}</p>
<h1 class="wo-h1" style="margin:0 0 18px 0;font-family:Arial Black,Arial,Helvetica,sans-serif;font-size:48px;line-height:.92;color:${COLORS.ink};font-weight:900;letter-spacing:0;">${escapeHtml(spec.headline)}</h1>
<p class="wo-intro" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.55;color:${COLORS.ink};">${escapeHtml(spec.intro)}</p>
</td>
</tr>
${renderCta(spec, mode, source)}
${groups.map(group => panel(group.name, group.vars, mode, source)).join('')}
<tr>
<td class="wo-pad-x" style="padding:2px 40px 34px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td style="border-top:2px solid ${COLORS.line};padding-top:18px;">
<p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.6;color:${COLORS.muted};letter-spacing:2px;text-transform:uppercase;">WE OTZI &middot; EMAIL TRANSACCIONAL &middot; ${escapeHtml(spec.eyebrow)}</p>
<p style="margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:${COLORS.muted};">Este mensaje se genero automaticamente desde We Otzi para mantener el proceso registrado y trazable.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
    return mode === 'n8n' ? `=${body}` : body;
}

function minify(html) {
    return html
        .replace(/>\s+</g, '><')
        .replace(/\s{2,}/g, ' ')
        .replace(/\n/g, '')
        .trim();
}

function writeTemplates() {
    const baseDir = path.join(ROOT, 'templates/email');
    const bmDir = path.join(baseDir, 'billionmail');
    const names = Object.keys(manifest).sort();
    for (const name of names) {
        const html = buildEmailHtml(name, { mode: 'local' });
        const min = minify(html);
        fs.writeFileSync(path.join(bmDir, `${name}.html`), html, 'utf8');
        fs.writeFileSync(path.join(baseDir, `${name}.html`), html, 'utf8');
        fs.writeFileSync(path.join(baseDir, `${name}.min.html`), min, 'utf8');
    }
    return names.length;
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
    const count = writeTemplates();
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
    manifest,
    NODE_TEMPLATE_MAP,
    SPECS
};
