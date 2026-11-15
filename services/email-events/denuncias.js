'use strict';

// ===========================================================================
// Eventos de email del frente "denuncias" (ronda 2 · P33).
// Los carga solo services/email-events/index.js (mapeo + render + serverOnly).
// Los dispara únicamente el servidor (lib/routes/denuncias.js) después de
// crear el ticket de denuncia:
//   · report_ticket_created_support → aviso al equipo de soporte
//     (SUPPORT_EMAIL o, si no está, los agentes activos de support_users_db).
//   · report_ticket_received        → acuse al denunciante (email de auth.users).
//
// Privacidad: el correo lleva solo nombres, motivo y número de ticket. La
// descripción, la evidencia y los datos de contacto quedan en el expediente
// del panel de soporte, nunca en el cuerpo del correo.
// ===========================================================================

const text = (value) => (value == null ? '' : String(value).trim());
const or = (value, fallback) => text(value) || fallback;

// Panel de cada rol (lista blanca: el payload nunca decide la URL).
const DASHBOARD_PATHS = {
    artist: '/artist/dashboard',
    studio: '/studio/dashboard',
    client: '/client/dashboard'
};

function withRole(name, role) {
    const n = text(name);
    const r = text(role);
    if (n && r) return `${n} (${r})`;
    return n || r;
}

module.exports = {
    report_ticket_created_support: {
        name: 'Soporte: nueva denuncia',
        description: 'Aviso al equipo de soporte cuando un artista o un estudio envía una denuncia (cotización, artista o estudio). El expediente completo queda en el panel de soporte.',
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
        description: 'Acuse al artista o al estudio que envió una denuncia: número de ticket, motivo y qué pasa después.',
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
            cta: (d, ctx) => ({ label: 'Ir a mi panel', url: ctx.url(DASHBOARD_PATHS[d.recipient_role] || DASHBOARD_PATHS.artist) })
        }
    }
};
