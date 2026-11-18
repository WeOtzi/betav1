'use strict';

// ===========================================================================
// Eventos de email del frente "denuncias" (ronda 2 · P33).
// Los carga solo services/email-events/index.js (mapeo + render + serverOnly).
// Los dispara únicamente el servidor (lib/routes/denuncias.js) después de
// crear el ticket de denuncia:
//   · report_ticket_created_support → aviso al equipo de soporte
//     (SUPPORT_EMAIL o, si no está, los agentes activos de support_users_db).
//   · report_ticket_received        → acuse al denunciante (email de auth.users),
//     con el panel de su rol (artista, estudio o cliente).
//   · report_outcome_notice         → al denunciante cuando soporte resuelve la
//     denuncia: «Se tomó acción» o «Sin acción», solo con el número de ticket.
//   · report_response_requested     → al denunciado (artista o dueño del estudio)
//     cuando soporte lo avisa: motivo, plazo de 5 días hábiles y cómo responder.
//     Nunca quién denunció, la descripción ni la evidencia.
//
// Privacidad: el correo lleva solo nombres, motivo y número de ticket. La
// descripción, la evidencia y los datos de contacto quedan en el expediente
// del panel de soporte, nunca en el cuerpo del correo.
// ===========================================================================

const { SUPPORT_EMAIL } = require('../../lib/email-render/layout');

const text = (value) => (value == null ? '' : String(value).trim());
const or = (value, fallback) => text(value) || fallback;

// Panel de cada rol (lista blanca: el payload nunca decide la URL).
const DASHBOARD_PATHS = {
    artist: '/artist/dashboard',
    studio: '/studio/dashboard',
    client: '/client/dashboard'
};

function dashboardPath(role) {
    return DASHBOARD_PATHS[text(role)] || DASHBOARD_PATHS.artist;
}

// Resultado de la denuncia (OUTCOMES de lib/denuncias.js): 'resuelto' = se tomó acción.
function tookAction(d) {
    return text(d && d.outcome) === 'resuelto';
}

// Dónde escribe a soporte el denunciado (lista blanca): el artista tiene el hilo
// fijo de Soporte en su bandeja; el estudio, el chat de soporte de su panel.
const SUPPORT_PATHS = {
    artist: '/artist/inbox?filter=support',
    studio: '/studio/dashboard'
};

function supportPath(role) {
    return SUPPORT_PATHS[text(role)] || SUPPORT_PATHS.artist;
}

function businessDays(d) {
    const n = Number.parseInt(text(d && d.response_business_days), 10);
    return Number.isFinite(n) && n > 0 && n < 60 ? n : 5;
}

// "miércoles, 25 de noviembre de 2026" (fecha de calendario, sin hora).
function deadlineText(d, ctx) {
    const raw = text(d && d.response_deadline_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !ctx || !ctx.f) return '';
    return ctx.f.date(raw);
}

function capitalize(value) {
    const t = text(value);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function withRole(name, role) {
    const n = text(name);
    const r = text(role);
    if (n && r) return `${n} (${r})`;
    return n || r;
}

module.exports = {
    report_ticket_created_support: {
        name: 'Soporte: nueva denuncia',
        description: 'Aviso al equipo de soporte cuando alguien envía una denuncia (cotización, artista o estudio). El expediente completo queda en el panel de soporte.',
        templateHint: 'support-report-created',
        serverOnly: true,
        recipients: (p) => [].concat(p.support_email || [], Array.isArray(p.support_emails) ? p.support_emails : []).filter(Boolean),
        attribs: (p) => ({
            ticket_code: text(p.ticket_code),
            report_kind_label: text(p.report_kind_label),
            reason_label: text(p.reason_label),
            reporter_name: text(p.reporter_name),
            reporter_role_label: text(p.reporter_role_label),
            reported_name: text(p.reported_name),
            reported_role_label: text(p.reported_role_label),
            report_quote_id: text(p.report_quote_id),
            priority_label: text(p.priority_label),
            reported_at: text(p.reported_at),
            queue_url: text(p.queue_url)
        }),
        render: {
            audience: 'admin',
            category: 'transactional',
            subject: (d) => `Nueva denuncia${d.ticket_code ? ` ${text(d.ticket_code)}` : ''}: ${or(d.reason_label, 'revisión pendiente')}`,
            preheader: (d) => `${or(d.reporter_name, 'Una persona')} envió una denuncia. Revisa el expediente completo en el panel de soporte.`,
            eyebrow: 'Denuncias',
            headline: (d) => `Nueva denuncia: ${or(d.reason_label, 'revisión pendiente')}`,
            intro: () => 'Se abrió un ticket de denuncia con el expediente del denunciante y del denunciado. Revísalo en el panel de soporte, deja tus notas internas y actualiza el estado.',
            rows: (d) => [
                ['Ticket', text(d.ticket_code)],
                ['Tipo', text(d.report_kind_label)],
                ['Motivo', text(d.reason_label)],
                ['Prioridad', text(d.priority_label)],
                ['Denunciante', withRole(d.reporter_name, d.reporter_role_label)],
                ['Denunciado', withRole(d.reported_name, d.reported_role_label)],
                ['Cotización', text(d.report_quote_id)],
                ['Recibida', text(d.reported_at)]
            ],
            cta: (d, ctx) => ({ label: 'Abrir la denuncia', url: ctx.url('/support/dashboard#denuncias') })
        }
    },

    report_ticket_received: {
        name: 'Denuncia recibida (acuse)',
        description: 'Acuse a quien envió una denuncia (artista, estudio o cliente): número de ticket, motivo y qué pasa después.',
        templateHint: 'report-received',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            ticket_code: text(p.ticket_code),
            report_kind_label: text(p.report_kind_label),
            reason_label: text(p.reason_label),
            reported_name: text(p.reported_name),
            reported_at: text(p.reported_at)
        }),
        render: {
            audience: 'artist',
            category: 'transactional',
            subject: (d) => `Recibimos tu denuncia${d.ticket_code ? ` ${text(d.ticket_code)}` : ''}`,
            preheader: (d) => `Tu denuncia quedó registrada${d.ticket_code ? ` con el número ${text(d.ticket_code)}` : ''}. Nuestro equipo de soporte la va a revisar.`,
            eyebrow: 'Denuncias',
            greeting: (d) => (text(d.recipient_name) ? `Hola, ${text(d.recipient_name)}.` : 'Hola.'),
            headline: () => 'Recibimos tu denuncia',
            intro: () => 'Gracias por avisarnos. Nuestro equipo de soporte va a revisar lo que nos cuentas y la evidencia que hayas adjuntado. La persona o el estudio que denunciaste no ve tu denuncia ni tus datos.',
            highlight: (d) => (text(d.ticket_code) ? { label: 'Número de ticket', value: text(d.ticket_code) } : null),
            rows: (d) => [
                ['Tipo', text(d.report_kind_label)],
                ['Motivo', text(d.reason_label)],
                ['Denunciaste a', text(d.reported_name)],
                ['Enviada', text(d.reported_at)]
            ],
            note: () => 'Si necesitamos más información, te vamos a escribir a este correo. Guarda el número de ticket para cualquier consulta.',
            cta: (d, ctx) => ({ label: 'Ir a mi panel', url: ctx.url(dashboardPath(d.recipient_role)) })
        }
    },

    report_outcome_notice: {
        name: 'Denuncia resuelta (resultado al denunciante)',
        description: 'Aviso a quien envió una denuncia cuando soporte la resuelve: «Se tomó acción» o «Sin acción». Solo lleva el número de ticket; nunca datos de la otra parte.',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            ticket_code: text(p.ticket_code),
            outcome: text(p.outcome),
            outcome_label: text(p.outcome_label)
        }),
        render: {
            audience: 'client',
            category: 'transactional',
            subject: (d) => `Tu denuncia${d.ticket_code ? ` ${text(d.ticket_code)}` : ''}: ${tookAction(d) ? 'se tomó acción' : 'cerrada sin acción'}`,
            preheader: (d) => (tookAction(d)
                ? 'Revisamos tu denuncia y tomamos medidas. Por privacidad, no compartimos los detalles.'
                : 'Revisamos tu denuncia y por ahora no encontramos motivos para tomar medidas.'),
            eyebrow: 'Denuncias',
            greeting: (d) => (text(d.recipient_name) ? `Hola, ${text(d.recipient_name)}.` : 'Hola.'),
            headline: (d) => (tookAction(d) ? 'Se tomó acción sobre tu denuncia' : 'Tu denuncia se cerró sin acción'),
            intro: (d) => (tookAction(d)
                ? 'Nuestro equipo de soporte revisó tu denuncia y tomó las medidas que corresponden según las normas de We Ötzi. Por privacidad, no compartimos los detalles de lo que se decidió sobre la otra cuenta.'
                : 'Nuestro equipo de soporte revisó tu denuncia y la evidencia que enviaste. Por ahora no encontramos motivos suficientes para tomar medidas. Si tienes información nueva, puedes enviar otra denuncia o escribirnos.'),
            highlight: (d) => (text(d.ticket_code) ? { label: 'Número de ticket', value: text(d.ticket_code) } : null),
            rows: (d) => [
                ['Ticket', text(d.ticket_code)],
                ['Resultado', tookAction(d) ? 'Se tomó acción' : 'Sin acción']
            ],
            note: () => 'Gracias por ayudarnos a cuidar la comunidad. Si tienes dudas, escríbenos por el chat de soporte con tu número de ticket.',
            cta: (d, ctx) => ({ label: 'Ir a mi panel', url: ctx.url(dashboardPath(d.recipient_role || ctx.role)) })
        }
    },

    report_response_requested: {
        name: 'Denuncia: aviso al denunciado',
        description: 'Aviso al artista o al dueño del estudio denunciado: motivo de la denuncia y plazo de 5 días hábiles para enviar su versión a soporte con el número de ticket. Nunca lleva quién denunció ni la evidencia.',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            ticket_code: text(p.ticket_code),
            report_kind_label: text(p.report_kind_label),
            reason_label: text(p.reason_label),
            profile_name: text(p.profile_name),
            response_business_days: text(p.response_business_days),
            response_deadline_date: text(p.response_deadline_date),
            support_note: text(p.support_note),
            notified_at: text(p.notified_at)
        }),
        render: {
            audience: 'artist',
            category: 'transactional',
            subject: (d) => `Recibimos una denuncia sobre tu perfil${d.ticket_code ? ` (${text(d.ticket_code)})` : ''}`,
            preheader: (d, ctx) => `Tienes ${businessDays(d)} días hábiles para contarnos tu versión${deadlineText(d, ctx) ? `, hasta el ${deadlineText(d, ctx)}` : ''}.`,
            eyebrow: 'Denuncias',
            greeting: (d) => (text(d.recipient_name) ? `Hola, ${text(d.recipient_name)}.` : 'Hola.'),
            headline: () => 'Recibimos una denuncia sobre tu perfil',
            intro: (d) => `Una persona denunció ${text(d.recipient_role) === 'studio' ? 'el perfil de tu estudio' : 'tu perfil'} en We Ötzi. Antes de tomar cualquier decisión queremos escuchar tu versión. Por privacidad, no compartimos quién hizo la denuncia ni lo que envió.`,
            highlight: (d, ctx) => (deadlineText(d, ctx)
                ? { label: 'Plazo para responder', value: capitalize(deadlineText(d, ctx)), note: `${businessDays(d)} días hábiles: no cuentan sábados ni domingos.` }
                : null),
            quote: (d) => (text(d.support_note) ? { label: 'Lo que te pide soporte', text: text(d.support_note) } : null),
            rows: (d) => [
                ['Ticket', text(d.ticket_code)],
                ['Motivo', text(d.reason_label)],
                ['Perfil', text(d.profile_name)]
            ],
            note: (d) => `Para responder, escríbenos por el chat de soporte de tu panel o a ${SUPPORT_EMAIL}${text(d.ticket_code) ? ` con el número de ticket ${text(d.ticket_code)}` : ''}. Cuéntanos tu versión y suma lo que la respalde: enlaces a tus publicaciones originales, fotos del proceso o fechas. Si no recibimos respuesta dentro del plazo, decidimos con la información que tenemos.`,
            cta: (d, ctx) => ({ label: 'Escribir a soporte', url: ctx.url(supportPath(d.recipient_role)) }),
            secondary: (d, ctx) => ({ label: 'Leer los Términos', url: ctx.url('/legal/terms') })
        }
    }
};
