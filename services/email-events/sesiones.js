'use strict';

// ===========================================================================
// Emails del frente "sesiones" (ronda 2 · P28 y P27-sesión).
// ---------------------------------------------------------------------------
// Los carga automáticamente el mapeo de eventos (services/email-events/). Son
// todos server-only: los dispara lib/routes/sesiones.js o
// lib/cot-artista-notices.js con datos releídos de la base, nunca el navegador.
//
//   session_confirmation_requested  el artista agendó o cambió una sesión: el
//                                   cliente la confirma o pide otra fecha.
//   session_confirmed_by_client     el cliente confirmó la sesión.
//   session_change_requested        una de las partes pidió un cambio.
//   session_change_resolved         el cambio se aceptó, se rechazó o se retiró.
//   session_dispute_opened          una de las partes pidió una disputa a soporte.
//   session_dispute_support         aviso a soporte de esa disputa.
//   session_dispute_resolved        soporte resolvió o cerró la disputa (lo dispara
//                                   lib/routes/soporte-disputas.js).
//   session_feedback_received       la otra parte calificó y dejó un registro.
//   session_no_show                 el artista registró que el cliente no vino.
//
// Payload común (lib/sesiones.js emailPayload): quote_id, quote_code, client_*/artist_*,
// session_id, session_number, session_date, duration_hours, location (dirección
// completa), location_maps, edit_window_days. Cada correo sale una vez por rol
// (cliente y artista) con su texto y sus enlaces.
// ===========================================================================

// Código que lee la persona: el corto de la cotización (short_code) y, si la
// base todavía no lo tiene, el quote_id. El quote_id queda para los enlaces.
const { visibleCode } = require('../../lib/quote-code');
const code = (d) => visibleCode(d);

const enc = (value) => encodeURIComponent(String(value == null ? '' : value));
const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || '';
const hello = (name) => (firstName(name) ? `Hola, ${firstName(name)}.` : 'Hola.');
const or = (value, fallback) => (String(value == null ? '' : value).trim() ? String(value).trim() : fallback);
const days = (d) => (Number(d.edit_window_days) > 0 ? Number(d.edit_window_days) : 3);

const clientArtist = (p) => [
    { role: 'client', email: p.client_email, user_id: p.client_user_id, name: p.client_name },
    { role: 'artist', email: p.artist_email, user_id: p.artist_user_id || p.artist_id, name: p.artist_name },
];
const both = (p) => [p.client_email, p.artist_email].filter(Boolean);

// Solo lo necesario para una plantilla externa (lista blanca: sin la fila entera).
const attribs = (p) => ({
    quote_id: or(p.quote_id, '-'),
    quote_code: or(code(p), '-'),
    client_name: or(p.client_name, 'Cliente'),
    artist_name: or(p.artist_name, 'Artista'),
    session_number: p.session_number != null ? String(p.session_number) : '',
    session_date: p.session_date || '',
    duration_hours: p.duration_hours != null ? String(p.duration_hours) : '',
    location: or(p.location, ''),
    location_maps: p.location_maps || '',
});

function clientUrl(d, ctx) {
    return ctx.url(`/client/dashboard${d.session_id ? `?session=${enc(d.session_id)}` : ''}#mis-sesiones`);
}

function artistUrl(d, ctx) {
    const query = [d.quote_id ? `quote=${enc(d.quote_id)}` : '', d.session_id ? `session=${enc(d.session_id)}` : ''].filter(Boolean).join('&');
    return ctx.url(`/my-quotations/detail${query ? `?${query}` : ''}#qd-sessions`);
}

const roleUrl = (d, ctx) => (ctx.role === 'artist' ? artistUrl(d, ctx) : clientUrl(d, ctx));
const selfName = (d, ctx) => (ctx.role === 'artist' ? d.artist_name : d.client_name);
const otherName = (d, ctx) => (ctx.role === 'artist' ? or(d.client_name, 'tu cliente') : or(d.artist_name, 'tu artista'));
const nameOf = (d, role) => (role === 'artist' ? or(d.artist_name, 'El artista') : or(d.client_name, 'El cliente'));
const when = (d, ctx) => (ctx.f.date(d.session_date) ? ` del ${ctx.f.date(d.session_date)}` : '');

function sessionRows(d, ctx, extra = []) {
    return [
        ['Fecha', ctx.f.dateTime(d.session_date)],
        ['Sesión', d.session_number ? `N.º ${d.session_number}` : ''],
        ['Duración', d.duration_hours ? `${ctx.f.value(Number(d.duration_hours))} h` : ''],
        ['Lugar', d.location],
        ...extra,
        ['Cotización', code(d)],
    ];
}

const mapsLink = (d) => (d.location_maps ? { label: 'Abrir en Google Maps', url: d.location_maps } : null);

// Categoría 'transactional': piden o confirman una acción sobre una sesión y
// no dependen de la matriz de preferencias (no se ofrece un "dejar de recibir").
function base(spec) {
    return Object.assign({
        audience: 'client',
        category: 'transactional',
        greeting: (d, ctx) => hello(selfName(d, ctx)),
        secondary: mapsLink,
    }, spec);
}

module.exports = {
    session_confirmation_requested: {
        name: 'Sesión: por confirmar',
        description: 'El artista agendó o cambió una sesión: el cliente la confirma o pide otra fecha. El artista recibe la copia de su propuesta.',
        templateHint: 'session-confirmation-requested',
        serverOnly: true,
        recipients: both,
        recipientRoles: clientArtist,
        attribs,
        render: base({
            eyebrow: 'SESIÓN POR CONFIRMAR',
            subject: (d, ctx) => `Confirma tu sesión${when(d, ctx)}`,
            preheader: (d) => `${or(d.artist_name, 'Tu artista')} te propuso una sesión. Confírmala o pide otra fecha desde tu cuenta.`,
            headline: (d) => (d.proposal_changed ? 'Tu sesión tiene una nueva propuesta' : 'Confirma tu sesión'),
            intro: (d) => `${or(d.artist_name, 'Tu artista')} ${d.proposal_changed ? 'cambió la propuesta de' : 'agendó'} una sesión contigo. Revisa la fecha y el lugar: puedes confirmarla o pedir una modificación. Una vez confirmada, los cambios se acuerdan entre ambos hasta ${days(d)} días antes.`,
            rows: (d, ctx) => sessionRows(d, ctx),
            cta: (d, ctx) => ({ label: 'Confirmar o pedir un cambio', url: clientUrl(d, ctx) }),
            roles: {
                artist: {
                    subject: (d, ctx) => `Sesión propuesta${when(d, ctx)}: falta la confirmación`,
                    preheader: (d) => `Le propusimos la sesión a ${or(d.client_name, 'tu cliente')}. Te avisamos cuando la confirme o pida un cambio.`,
                    headline: () => 'Sesión propuesta',
                    intro: (d) => `Le enviamos la propuesta a ${or(d.client_name, 'tu cliente')}. Te avisamos cuando la confirme o pida una modificación. Mientras tanto aparece como "por confirmar" en tu calendario.`,
                    cta: (d, ctx) => ({ label: 'Ver la cotización', url: artistUrl(d, ctx) }),
                },
            },
        }),
    },

    session_confirmed_by_client: {
        name: 'Sesión: confirmada por el cliente',
        description: 'El cliente confirmó la sesión propuesta: queda agendada para ambos.',
        templateHint: 'session-confirmed-by-client',
        serverOnly: true,
        recipients: both,
        recipientRoles: clientArtist,
        attribs,
        render: base({
            eyebrow: 'SESIÓN CONFIRMADA',
            subject: (d, ctx) => `Confirmaste tu sesión${when(d, ctx)}`,
            preheader: (d) => `Tu sesión con ${or(d.artist_name, 'tu artista')} quedó confirmada. Guarda la fecha y el lugar.`,
            headline: () => 'Tu sesión quedó confirmada',
            intro: (d) => `Confirmaste la sesión con ${or(d.artist_name, 'tu artista')}. Si necesitas cambiarla, puedes pedirlo hasta ${days(d)} días antes y tiene que aceptarlo la otra parte.`,
            rows: (d, ctx) => sessionRows(d, ctx),
            cta: (d, ctx) => ({ label: 'Ver mis sesiones', url: clientUrl(d, ctx) }),
            roles: {
                artist: {
                    subject: (d, ctx) => `${or(d.client_name, 'Tu cliente')} confirmó la sesión${when(d, ctx)}`,
                    preheader: (d) => `${or(d.client_name, 'Tu cliente')} confirmó la sesión. Ya quedó agendada para ambos en We Ötzi.`,
                    headline: () => 'Sesión confirmada',
                    intro: (d) => `${or(d.client_name, 'Tu cliente')} confirmó la sesión. Quedó agendada para ambos. Los cambios se acuerdan entre los dos hasta ${days(d)} días antes.`,
                    cta: (d, ctx) => ({ label: 'Ver la cotización', url: artistUrl(d, ctx) }),
                },
            },
        }),
    },

    session_change_requested: {
        name: 'Sesión: pedido de cambio',
        description: 'Una de las partes pidió cambiar la fecha, la duración o el lugar de una sesión. La otra la acepta o la rechaza.',
        templateHint: 'session-change-requested',
        serverOnly: true,
        recipients: both,
        recipientRoles: clientArtist,
        attribs: (p) => Object.assign(attribs(p), {
            requested_by_role: or(p.requested_by_role, ''),
            proposed_date: p.proposed_date || '',
            proposed_location: or(p.proposed_location, ''),
        }),
        render: base({
            eyebrow: 'CAMBIO DE SESIÓN',
            subject: (d, ctx) => (d.requested_by_role === ctx.role
                ? 'Enviamos tu pedido de cambio de sesión'
                : `${nameOf(d, d.requested_by_role === 'artist' ? 'artist' : 'client')} pidió cambiar la sesión`),
            preheader: (d, ctx) => (d.requested_by_role === ctx.role
                ? `Le avisamos a ${otherName(d, ctx)}. La sesión sigue en la fecha actual hasta que acepte.`
                : `${otherName(d, ctx)} quiere modificar la sesión. Revisa la propuesta y respóndela.`),
            headline: (d, ctx) => (d.requested_by_role === ctx.role ? 'Pedido de cambio enviado' : 'Te pidieron un cambio de sesión'),
            intro: (d, ctx) => (d.requested_by_role === ctx.role
                ? `Le avisamos a ${otherName(d, ctx)}. La sesión sigue como estaba hasta que acepte el cambio; puedes retirar tu pedido cuando quieras.`
                : `${otherName(d, ctx)} quiere modificar la sesión. Revisa la propuesta y acéptala o recházala. Si no llegan a un acuerdo, cualquiera de los dos puede pedir una disputa a soporte.`),
            rows: (d, ctx) => [
                ['Fecha actual', ctx.f.dateTime(d.session_date)],
                ['Fecha propuesta', ctx.f.dateTime(d.proposed_date)],
                ['Duración propuesta', d.proposed_duration_hours ? `${ctx.f.value(Number(d.proposed_duration_hours))} h` : ''],
                ['Lugar propuesto', d.proposed_location],
                ['Motivo', ctx.f.text(d.change_note, 400)],
                ['Sesión', d.session_number ? `N.º ${d.session_number}` : ''],
                ['Cotización', code(d)],
            ],
            cta: (d, ctx) => ({ label: d.requested_by_role === ctx.role ? 'Ver la sesión' : 'Responder el pedido', url: roleUrl(d, ctx) }),
            secondary: () => null,
        }),
    },

    session_change_resolved: {
        name: 'Sesión: cambio resuelto',
        description: 'El pedido de cambio de una sesión se aceptó, se rechazó o se retiró.',
        templateHint: 'session-change-resolved',
        serverOnly: true,
        recipients: both,
        recipientRoles: clientArtist,
        attribs: (p) => Object.assign(attribs(p), { decision: or(p.decision, 'accepted'), requested_by_role: or(p.requested_by_role, '') }),
        render: base({
            eyebrow: 'CAMBIO DE SESIÓN',
            subject: (d, ctx) => (d.decision === 'rejected' ? 'El cambio de sesión no se aceptó'
                : d.decision === 'withdrawn' ? 'Se retiró el pedido de cambio de sesión'
                    : `Cambio de sesión aceptado${when(d, ctx)}`),
            preheader: (d) => (d.decision === 'rejected' ? 'El pedido de cambio se rechazó. La sesión sigue en la fecha y el lugar acordados.'
                : d.decision === 'withdrawn' ? 'El pedido de cambio se retiró. La sesión sigue en la fecha y el lugar acordados.'
                    : 'El cambio se aceptó: la sesión quedó confirmada con los nuevos datos.'),
            headline: (d) => (d.decision === 'rejected' ? 'Cambio de sesión rechazado'
                : d.decision === 'withdrawn' ? 'Pedido de cambio retirado' : 'Cambio de sesión aceptado'),
            intro: (d, ctx) => {
                const requester = d.requested_by_role === ctx.role;
                if (d.decision === 'rejected') {
                    return requester
                        ? `${otherName(d, ctx)} no aceptó el cambio. La sesión sigue como estaba. Si necesitas modificarla igual, puedes pedir una disputa a soporte.`
                        : 'Rechazaste el cambio. La sesión sigue como estaba.';
                }
                if (d.decision === 'withdrawn') {
                    return requester
                        ? 'Retiraste tu pedido de cambio. La sesión sigue como estaba.'
                        : `${otherName(d, ctx)} retiró su pedido de cambio. La sesión sigue como estaba.`;
                }
                return requester
                    ? `${otherName(d, ctx)} aceptó tu pedido. La sesión quedó confirmada con los nuevos datos.`
                    : 'Aceptaste el cambio. La sesión quedó confirmada con los nuevos datos.';
            },
            rows: (d, ctx) => sessionRows(d, ctx, [['Respuesta', ctx.f.text(d.response_note, 400)]]),
            cta: (d, ctx) => ({ label: 'Ver la sesión', url: roleUrl(d, ctx) }),
        }),
    },

    session_dispute_opened: {
        name: 'Sesión: disputa pedida a soporte',
        description: 'Una de las partes pidió a soporte abrir una disputa sobre una sesión. Las dos reciben el aviso.',
        templateHint: 'session-dispute-opened',
        serverOnly: true,
        recipients: both,
        recipientRoles: clientArtist,
        attribs: (p) => Object.assign(attribs(p), {
            opened_by_role: or(p.opened_by_role, ''),
            dispute_reason: or(p.dispute_reason_label, ''),
            ticket_number: p.ticket_number != null ? String(p.ticket_number) : '',
        }),
        render: base({
            category: 'transactional',
            eyebrow: 'DISPUTA DE SESIÓN',
            subject: (d, ctx) => (d.opened_by_role === ctx.role ? 'Recibimos tu disputa sobre la sesión' : 'Hay una disputa sobre tu sesión'),
            preheader: (d, ctx) => (d.opened_by_role === ctx.role
                ? 'Soporte revisa el caso y te responde dentro de las próximas 48 horas hábiles.'
                : `${otherName(d, ctx)} pidió una disputa sobre la sesión. Soporte revisa el caso.`),
            headline: (d, ctx) => (d.opened_by_role === ctx.role ? 'Recibimos tu disputa' : 'Hay una disputa sobre tu sesión'),
            intro: (d, ctx) => (d.opened_by_role === ctx.role
                ? 'Soporte revisa el caso y te responde dentro de las próximas 48 horas hábiles. La otra parte también recibió el aviso. Mientras la disputa esté abierta, el trabajo no se marca como completado.'
                : `${otherName(d, ctx)} pidió a soporte abrir una disputa sobre la sesión. Soporte revisa el caso y responde dentro de las próximas 48 horas hábiles. Si quieres sumar tu versión, escribe a soporte indicando el número de ticket.`),
            rows: (d, ctx) => sessionRows(d, ctx, [
                ['Motivo', d.dispute_reason_label],
                ['Ticket', d.ticket_number ? `N.º ${d.ticket_number}` : ''],
            ]),
            cta: (d, ctx) => ({ label: 'Ver la sesión', url: roleUrl(d, ctx) }),
            secondary: () => null,
        }),
    },

    session_dispute_support: {
        name: 'Soporte: disputa sobre una sesión',
        description: 'Aviso al equipo de soporte cuando un cliente o un artista pide una disputa sobre una sesión (ticket kind "disputa").',
        templateHint: 'support-session-dispute',
        serverOnly: true,
        // SUPPORT_EMAIL si está configurado; si no, los agentes activos de support_users_db.
        recipients: (p) => [].concat(p.support_email || [], Array.isArray(p.support_emails) ? p.support_emails : []).filter(Boolean),
        attribs: (p) => ({
            quote_id: or(p.quote_id, '-'),
            quote_code: or(code(p), '-'),
            ticket_number: p.ticket_number != null ? String(p.ticket_number) : '',
            dispute_reason: or(p.dispute_reason_label, ''),
            opened_by_role: or(p.opened_by_role, ''),
            queue_url: p.queue_url || '',
        }),
        render: {
            audience: 'admin',
            category: 'transactional',
            eyebrow: 'DISPUTA DE SESIÓN',
            subject: (d) => `Disputa de sesión${d.ticket_number ? ` · ticket N.º ${d.ticket_number}` : ''}${code(d) ? ` · ${code(d)}` : ''}`,
            preheader: (d) => `${d.opened_by_role === 'artist' ? or(d.artist_name, 'El artista') : or(d.client_name, 'El cliente')} pidió una disputa sobre una sesión. Revisa el caso.`,
            headline: () => 'Pidieron una disputa sobre una sesión',
            intro: (d) => `${d.opened_by_role === 'artist' ? `El artista ${or(d.artist_name, '')}`.trim() : `El cliente ${or(d.client_name, '')}`.trim()} pidió abrir una disputa. La encuentras en la pestaña Disputas del panel de soporte; la cotización figura en disputa hasta que la resuelvas o la cierres ahí.`,
            quote: (d, ctx) => (d.dispute_description ? { text: ctx.f.text(d.dispute_description, 900) } : null),
            rows: (d, ctx) => [
                ['Ticket', d.ticket_number ? `N.º ${d.ticket_number}` : ''],
                ['Motivo', d.dispute_reason_label],
                ['Cliente', d.client_name],
                ['Artista', d.artist_name],
                ['Fecha de la sesión', ctx.f.dateTime(d.session_date)],
                ['Sesión', d.session_number ? `N.º ${d.session_number}` : ''],
                ['Lugar', d.location],
                ['Cotización', code(d)],
                ['Referencia interna', d.quote_id && d.quote_id !== code(d) ? d.quote_id : ''],
            ],
            cta: (d, ctx) => ({ label: 'Abrir la disputa', url: ctx.f.url(d.queue_url) || ctx.url('/support/dashboard#disputas') }),
        },
    },

    session_dispute_resolved: {
        name: 'Disputa: resuelta o cerrada por soporte',
        description: 'Soporte resolvió o cerró una disputa desde su panel. Las dos partes reciben la resolución y la cotización deja de figurar en disputa.',
        templateHint: 'session-dispute-resolved',
        serverOnly: true,
        recipients: both,
        recipientRoles: clientArtist,
        attribs: (p) => Object.assign(attribs(p), {
            dispute_decision: p.dispute_decision === 'closed' ? 'closed' : 'resolved',
            dispute_outcome: or(p.dispute_outcome_label, ''),
            dispute_reason: or(p.dispute_reason_label, ''),
            ticket_number: p.ticket_number != null ? String(p.ticket_number) : '',
        }),
        render: base({
            eyebrow: 'DISPUTA',
            subject: (d) => `${d.dispute_decision === 'closed' ? 'Soporte cerró la disputa' : 'Soporte resolvió la disputa'}${code(d) ? ` · ${code(d)}` : ''}`,
            preheader: (d) => (d.dispute_decision === 'closed'
                ? 'Soporte revisó el caso y cerró la disputa. La cotización ya no figura en disputa.'
                : 'Soporte revisó el caso y dejó su resolución. La cotización ya no figura en disputa.'),
            headline: (d) => (d.dispute_decision === 'closed' ? 'Soporte cerró la disputa' : 'Soporte resolvió la disputa'),
            intro: (d, ctx) => {
                const about = d.dispute_scope === 'session' && ctx.f.date(d.session_date)
                    ? `sobre la sesión del ${ctx.f.date(d.session_date)}`
                    : 'de esta cotización';
                const decision = d.dispute_decision === 'closed' ? 'la cerró' : 'la dio por resuelta';
                return `Soporte revisó la disputa ${about} con ${otherName(d, ctx)} y ${decision}. La cotización ya no figura en disputa: pueden seguir con el trabajo desde su cuenta. Si no estás de acuerdo con la decisión, escribe a soporte indicando el número de ticket.`;
            },
            quote: (d, ctx) => (d.dispute_resolution ? { label: 'Resolución de soporte', text: ctx.f.text(d.dispute_resolution, 1500) } : null),
            rows: (d, ctx) => sessionRows(d, ctx, [
                ['Motivo', d.dispute_reason_label],
                ['Resultado', d.dispute_outcome_label],
                ['Ticket', d.ticket_number ? `N.º ${d.ticket_number}` : ''],
            ]),
            cta: (d, ctx) => ({ label: d.session_id ? 'Ver la sesión' : 'Ver la cotización', url: roleUrl(d, ctx) }),
            secondary: () => null,
        }),
    },

    session_feedback_received: {
        name: 'Sesión: registro y calificación de la otra parte',
        description: 'Una de las partes calificó una sesión pasada y dejó su registro: se avisa a la otra.',
        templateHint: 'session-feedback-received',
        serverOnly: true,
        recipients: (p) => clientArtist(p).filter((r) => r.role !== p.author_role).map((r) => r.email).filter(Boolean),
        recipientRoles: (p) => clientArtist(p).filter((r) => r.role !== p.author_role),
        attribs: (p) => Object.assign(attribs(p), { author_role: or(p.author_role, '') }),
        render: base({
            eyebrow: 'REGISTRO DE SESIÓN',
            subject: (d, ctx) => `${otherName(d, ctx)} dejó un registro de la sesión`,
            preheader: (d, ctx) => `${otherName(d, ctx)} calificó la sesión y dejó su registro. Míralo y deja el tuyo.`,
            headline: () => 'Hay un registro nuevo de la sesión',
            intro: (d, ctx) => `${otherName(d, ctx)} calificó la sesión y dejó su registro. Puedes verlo y dejar el tuyo: queda guardado para ambos y para soporte. No es la reseña pública del trabajo.`,
            rows: (d, ctx) => sessionRows(d, ctx),
            cta: (d, ctx) => ({ label: 'Ver el registro', url: roleUrl(d, ctx) }),
            secondary: () => null,
        }),
    },

    session_no_show: {
        name: 'Sesión: ausencia registrada',
        description: 'El artista registró que el cliente no se presentó a la sesión. El cliente puede pedir una disputa si no es correcto.',
        templateHint: 'session-no-show',
        serverOnly: true,
        recipients: both,
        recipientRoles: clientArtist,
        attribs,
        render: base({
            eyebrow: 'AUSENCIA REGISTRADA',
            subject: (d, ctx) => `Se registró una ausencia en tu sesión${when(d, ctx)}`,
            preheader: (d) => `${or(d.artist_name, 'Tu artista')} registró que no te presentaste. Si no es correcto, pide una disputa.`,
            headline: () => 'Se registró una ausencia',
            intro: (d) => `${or(d.artist_name, 'Tu artista')} registró que no te presentaste a la sesión. Si no es correcto, puedes pedir una disputa a soporte desde tus sesiones. Para coordinar otra fecha, escríbele por el chat.`,
            rows: (d, ctx) => sessionRows(d, ctx),
            cta: (d, ctx) => ({ label: 'Ver mis sesiones', url: clientUrl(d, ctx) }),
            secondary: () => null,
            roles: {
                artist: {
                    subject: (d, ctx) => `Ausencia registrada${when(d, ctx)}`,
                    preheader: (d) => `Registraste que ${or(d.client_name, 'tu cliente')} no se presentó. Puedes agendar otra fecha cuando quieras.`,
                    headline: () => 'Ausencia registrada',
                    intro: (d) => `Registraste que ${or(d.client_name, 'tu cliente')} no se presentó. Le avisamos por correo. La sesión deja de ocupar un lugar del acuerdo y puedes agendar otra fecha.`,
                    cta: (d, ctx) => ({ label: 'Ver la cotización', url: artistUrl(d, ctx) }),
                },
            },
        }),
    },
};
