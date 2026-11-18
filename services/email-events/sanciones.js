'use strict';

// ===========================================================================
// Eventos de email del frente "sanciones" (fase 1 · 2.7.0).
// Los carga solo services/email-events/index.js. Todos son serverOnly: los
// dispara lib/sanciones-service.js con clave de idempotencia:
//   · account_sanction_notice            → la persona sancionada (motivo, plazo y cómo apelar)
//                                          clave account_sanction_notice:<sanction_id>
//   · account_sanction_lifted            → la persona, cuando se levanta
//                                          clave account_sanction_lifted:<sanction_id>
//   · account_sanction_appeal_upheld     → la persona, cuando su apelación no prospera
//                                          clave account_sanction_appeal_upheld:<sanction_id>
//   · quotation_cancelled_profile_removed → el cliente de cada cotización cancelada por un cierre
//                                          clave quotation_cancelled_profile_removed:<quote_id>
//   · support_security_alert             → soporte: reingreso bloqueado, devolución de anticipo,
//                                          imagen duplicada (fase 2). clave support_security_alert:<alert_id>
//   · support_appeal_received            → soporte: llegó una apelación
//                                          clave support_appeal_received:<sanction_id>
//
// Privacidad: al denunciante no se le escribe desde aquí (lo hace denuncias).
// A soporte nunca le llegan correos, teléfonos ni handles en claro: solo ids y
// el tipo de coincidencia. El detalle está en el panel (#sanciones).
// ===========================================================================

const text = (value) => (value == null ? '' : String(value).trim());
const or = (value, fallback) => text(value) || fallback;

// Panel de cada rol (lista blanca: el payload nunca decide la URL).
const DASHBOARD_PATHS = {
    artist: '/artist/dashboard',
    studio: '/studio/dashboard',
    client: '/client/dashboard'
};
const SUPPORT_QUEUE_PATH = '/support/dashboard#sanciones';

const supportRecipients = (p) => [].concat(p.support_email || [], Array.isArray(p.support_emails) ? p.support_emails : []).filter(Boolean);
const greeting = (d) => (text(d.recipient_name) ? `Hola, ${text(d.recipient_name)}.` : 'Hola.');

const NOTICE_COPY = {
    warning: {
        subject: 'Recibiste una advertencia en We Ötzi',
        headline: 'Recibiste una advertencia',
        intro: 'Nuestro equipo de soporte revisó una denuncia sobre tu cuenta y decidió dejarte una advertencia. Tu cuenta sigue funcionando con normalidad, pero si se repite podemos suspenderla o cerrarla.',
        preheader: 'Soporte revisó tu cuenta y te dejó una advertencia. Te contamos el motivo y cómo apelar.'
    },
    suspension: {
        subject: 'Suspendimos tu perfil en We Ötzi',
        headline: 'Suspendimos tu perfil',
        intro: 'Nuestro equipo de soporte suspendió tu perfil mientras dure la sanción: no aparece en el explorador ni puede recibir cotizaciones nuevas. Tus cotizaciones en curso siguen como estaban.',
        preheader: 'Tu perfil quedó suspendido por un tiempo. Te contamos el motivo, hasta cuándo y cómo apelar.'
    },
    ban: {
        subject: 'Cerramos tu cuenta de We Ötzi',
        headline: 'Cerramos tu cuenta',
        intro: 'Después de revisar el caso, dos agentes de soporte decidieron cerrar tu cuenta de forma permanente. Ya no puedes iniciar sesión, tu perfil dejó de ser público y las cotizaciones abiertas se cancelaron.',
        preheader: 'Tu cuenta quedó cerrada de forma permanente. Te contamos el motivo y cómo apelar la decisión.'
    }
};

function noticeCopy(d) {
    return NOTICE_COPY[text(d.sanction_kind)] || NOTICE_COPY.warning;
}

function untilLabel(d) {
    if (text(d.ends_at)) return text(d.ends_at);
    return text(d.sanction_kind) === 'warning' ? '' : 'Permanente';
}

// Dueño de una imagen (alerta image_duplicate): artista o estudio.
const OWNER_ROLE_LABELS = { artist: 'artista', studio: 'estudio' };
const ownerRoleLabel = (kind) => OWNER_ROLE_LABELS[text(kind)] || 'cuenta';

const LIFTED_INTRO = {
    appeal: 'Revisamos tu apelación y la aceptamos: levantamos la sanción.',
    expired: 'Terminó el plazo de tu suspensión y levantamos la sanción.',
    support: 'Nuestro equipo de soporte revisó tu caso y levantó la sanción.'
};

module.exports = {
    account_sanction_notice: {
        name: 'Sanción de cuenta (aviso)',
        description: 'Aviso a la persona sancionada: tipo de sanción, motivo, desde y hasta cuándo, y el enlace para apelar (una sola vez, dentro de 30 días).',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            sanction_kind: text(p.sanction_kind),
            kind_label: text(p.kind_label),
            reason_label: text(p.reason_label),
            starts_at: text(p.starts_at),
            ends_at: text(p.ends_at),
            appeal_deadline_at: text(p.appeal_deadline_at)
        }),
        render: {
            audience: 'client',
            category: 'transactional',
            subject: (d) => noticeCopy(d).subject,
            preheader: (d) => noticeCopy(d).preheader,
            eyebrow: 'Seguridad de la cuenta',
            greeting,
            headline: (d) => noticeCopy(d).headline,
            intro: (d) => noticeCopy(d).intro,
            rows: (d) => [
                ['Sanción', text(d.kind_label)],
                ['Motivo', text(d.reason_label)],
                ['Desde', text(d.starts_at)],
                ['Hasta', untilLabel(d)],
                ['Puedes apelar hasta', text(d.appeal_deadline_at)]
            ],
            note: () => 'Tienes una sola apelación, dentro de 30 días. La revisa un agente que no intervino en la sanción y te respondemos por correo.',
            cta: (d, ctx) => ({
                label: 'Apelar la sanción',
                url: text(d.appeal_token) ? ctx.url(`/apelacion?t=${encodeURIComponent(text(d.appeal_token))}`) : ctx.url('/seguridad')
            }),
            secondary: (d, ctx) => ({ label: 'Cómo funcionan las sanciones', url: ctx.url('/seguridad') })
        }
    },

    account_sanction_lifted: {
        name: 'Sanción de cuenta levantada',
        description: 'Aviso a la persona cuando su sanción se levanta (por apelación, por soporte o porque terminó el plazo de una suspensión).',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            kind_label: text(p.kind_label),
            reason_label: text(p.reason_label),
            lifted_via: text(p.lifted_via),
            lifted_at: text(p.lifted_at)
        }),
        render: {
            audience: 'client',
            category: 'transactional',
            subject: () => 'Levantamos la sanción de tu cuenta',
            preheader: () => 'Tu cuenta de We Ötzi vuelve a funcionar con normalidad. Te contamos qué cambió.',
            eyebrow: 'Seguridad de la cuenta',
            greeting,
            headline: () => 'Levantamos la sanción',
            intro: (d) => `${LIFTED_INTRO[text(d.lifted_via)] || LIFTED_INTRO.support} Tu cuenta vuelve a funcionar con normalidad. Las cotizaciones que se cancelaron no se reabren.`,
            rows: (d) => [
                ['Sanción', text(d.kind_label)],
                ['Motivo', text(d.reason_label)],
                ['Levantada', text(d.lifted_at)]
            ],
            note: () => 'Si tienes dudas, responde a este correo o escribe a soporte.',
            cta: (d, ctx) => ({ label: 'Ir a mi panel', url: ctx.url(DASHBOARD_PATHS[text(d.recipient_role)] || DASHBOARD_PATHS.client) })
        }
    },

    account_sanction_appeal_upheld: {
        name: 'Apelación de sanción: se mantiene',
        description: 'Aviso a la persona cuando un agente que no intervino revisó su apelación y decidió mantener la sanción.',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            kind_label: text(p.kind_label),
            reason_label: text(p.reason_label),
            decided_at: text(p.decided_at)
        }),
        render: {
            audience: 'client',
            category: 'transactional',
            subject: () => 'Revisamos tu apelación',
            preheader: () => 'Un agente que no intervino revisó tu apelación y decidió mantener la sanción.',
            eyebrow: 'Seguridad de la cuenta',
            greeting,
            headline: () => 'La sanción se mantiene',
            intro: () => 'Un agente de soporte que no intervino en la sanción revisó tu apelación y lo que nos contaste. Decidió mantener la sanción. Esta decisión es final: la apelación era una sola.',
            rows: (d) => [
                ['Sanción', text(d.kind_label)],
                ['Motivo', text(d.reason_label)],
                ['Decidida', text(d.decided_at)]
            ],
            cta: (d, ctx) => ({ label: 'Cómo funcionan las sanciones', url: ctx.url('/seguridad') })
        }
    },

    quotation_cancelled_profile_removed: {
        name: 'Cotización cancelada: perfil dado de baja',
        description: 'Aviso al cliente cuando su cotización se cancela porque soporte dio de baja el perfil del artista. Si pagó un anticipo, soporte gestiona la devolución.',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            quote_id: text(p.quote_id),
            artist_name: text(p.artist_name),
            cancelled_at: text(p.cancelled_at),
            quotation_url: text(p.quotation_url)
        }),
        render: {
            audience: 'client',
            category: 'transactional',
            subject: (d) => `Cancelamos tu cotización${text(d.quote_id) ? ` ${text(d.quote_id)}` : ''}`,
            preheader: (d) => `El perfil de ${or(d.artist_name, 'tu artista')} fue dado de baja por soporte y cancelamos tu cotización.`,
            eyebrow: 'Cotizaciones',
            greeting,
            headline: () => 'Cancelamos tu cotización',
            intro: (d) => `El perfil de ${or(d.artist_name, 'tu artista')} fue dado de baja por soporte, así que tu cotización quedó cancelada. Puedes pedir una cotización nueva a otro artista cuando quieras.`,
            rows: (d) => [
                ['Cotización', text(d.quote_id)],
                ['Artista', text(d.artist_name)],
                ['Cancelada', text(d.cancelled_at)]
            ],
            note: () => 'Si pagaste un anticipo, soporte se comunicará contigo para gestionar la devolución.',
            cta: (d, ctx) => ({ label: 'Ver mi cotización', url: text(d.quotation_url) || ctx.url('/client/dashboard') }),
            secondary: (d, ctx) => ({ label: 'Buscar otro artista', url: ctx.url('/explore') })
        }
    },

    support_security_alert: {
        name: 'Soporte: alerta de seguridad',
        description: 'Aviso al equipo de soporte por una alerta de seguridad: reingreso bloqueado de una cuenta sancionada, devolución de anticipo pendiente o imagen duplicada (también cuando una imagen retirada vuelve a publicarse). Sin identificadores en claro.',
        serverOnly: true,
        recipients: supportRecipients,
        attribs: (p) => ({
            alert_id: text(p.alert_id),
            alert_kind: text(p.alert_kind),
            kind_label: text(p.kind_label),
            flow_label: text(p.flow_label),
            match_kinds_label: text(p.match_kinds_label),
            sanction_id: text(p.sanction_id),
            subject_user_id: text(p.subject_user_id),
            related_user_id: text(p.related_user_id),
            quotes_count: text(p.quotes_count),
            totals_label: text(p.totals_label),
            confidence_label: text(p.confidence_label),
            distance: text(p.distance),
            new_owner_kind: text(p.new_owner_kind),
            existing_owner_kind: text(p.existing_owner_kind),
            existing_flow_label: text(p.existing_flow_label),
            reappeared: p.reappeared === true || text(p.reappeared) === 'si' ? 'si' : '',
            created_at: text(p.created_at)
        }),
        render: {
            audience: 'admin',
            category: 'transactional',
            subject: (d) => {
                const kind = text(d.alert_kind);
                if (kind === 'image_duplicate' && d.reappeared) return 'Alerta reabierta: volvió a publicarse una imagen retirada';
                if (kind === 'image_duplicate') return `Posible copia de imagen${text(d.confidence_label) ? ` (confianza ${text(d.confidence_label)})` : ''}`;
                if (kind === 'refund_needed') return 'Devolución de anticipo pendiente';
                return `Alerta de seguridad: ${or(d.kind_label, 'revisión pendiente')}`;
            },
            preheader: (d) => {
                const kind = text(d.alert_kind);
                if (kind === 'image_duplicate' && d.reappeared) return 'Una imagen que soporte retiró por posible copia volvió al portafolio. Revísala en Sanciones.';
                if (kind === 'image_duplicate') return 'Una imagen nueva se parece a otra de otra cuenta. Revisa el par en la pestaña Sanciones.';
                if (kind === 'refund_needed') return 'Un anticipo quedó retenido por un cierre de cuenta. Gestiona la devolución con el cliente.';
                return `${or(d.kind_label, 'Una alerta de seguridad')} espera revisión en la pestaña Sanciones del panel de soporte.`;
            },
            eyebrow: 'Sanciones',
            headline: (d) => {
                const kind = text(d.alert_kind);
                if (kind === 'image_duplicate' && d.reappeared) return 'Volvió a publicarse una imagen retirada';
                if (kind === 'refund_needed') return 'Devolución de anticipo pendiente';
                return or(d.kind_label, 'Alerta de seguridad');
            },
            intro: (d) => {
                const kind = text(d.alert_kind);
                if (kind === 'reentry_blocked') return 'Una cuenta nueva coincidió con una cuenta sancionada y quedó bloqueada. Revisa la coincidencia en el panel: si es un error, levanta el bloqueo desde la pestaña Sanciones.';
                if (kind === 'refund_needed') return 'Un cliente pagó un anticipo en una cotización que se canceló por un cierre de cuenta. El anticipo queda retenido: comunícate con el cliente para gestionar la devolución y marca la alerta como gestionada cuando termines.';
                if (kind === 'image_duplicate' && d.reappeared) return 'Una imagen que soporte retiró por posible copia volvió a publicarse en el mismo portafolio. Reabrimos la alerta: revisa el par y decide de nuevo si es legítima, si la retiras o si abres una denuncia.';
                if (kind === 'image_duplicate') {
                    const conf = text(d.confidence_label);
                    const dist = text(d.distance);
                    const detail = conf || dist ? ` (confianza ${conf || 'posible'}${dist ? `, distancia ${dist} de 64` : ''})` : '';
                    return `Una imagen publicada hace poco se parece a otra que otra cuenta publicó antes${detail}. No ocultamos nada: revisa el par en la pestaña Sanciones y decide si es legítima, si la retiras o si abres una denuncia.`;
                }
                return 'Hay una alerta de seguridad nueva. Revísala en la pestaña Sanciones del panel de soporte.';
            },
            rows: (d) => {
                const kind = text(d.alert_kind);
                if (kind === 'image_duplicate') {
                    return [
                        ['Tipo', text(d.kind_label)],
                        ['Alerta', text(d.alert_id)],
                        ['Confianza', text(d.confidence_label)],
                        ['Distancia', text(d.distance) ? `${text(d.distance)} de 64` : ''],
                        ['Imagen nueva en', text(d.flow_label)],
                        ['Imagen anterior en', text(d.existing_flow_label)],
                        [`Subió la nueva (${ownerRoleLabel(d.new_owner_kind)})`, text(d.subject_user_id)],
                        [`Dueño de la anterior (${ownerRoleLabel(d.existing_owner_kind)})`, text(d.related_user_id)],
                        ['Creada', text(d.created_at)]
                    ];
                }
                if (kind === 'refund_needed') {
                    return [
                        ['Tipo', text(d.kind_label)],
                        ['Alerta', text(d.alert_id)],
                        ['Sanción', text(d.sanction_id)],
                        ['Cliente', text(d.subject_user_id)],
                        ['Cuenta cerrada', text(d.related_user_id)],
                        ['Cotizaciones con anticipo', text(d.quotes_count)],
                        ['Anticipo retenido', text(d.totals_label)],
                        ['Creada', text(d.created_at)]
                    ];
                }
                return [
                    ['Tipo', text(d.kind_label)],
                    ['Alerta', text(d.alert_id)],
                    ['Dónde', text(d.flow_label)],
                    ['Coincidencia por', text(d.match_kinds_label)],
                    ['Sanción', text(d.sanction_id)],
                    ['Cuenta', text(d.subject_user_id)],
                    ['Cuenta sancionada', text(d.related_user_id)],
                    ['Cotizaciones', text(d.quotes_count)],
                    ['Creada', text(d.created_at)]
                ];
            },
            cta: (d, ctx) => ({
                label: text(d.alert_kind) === 'image_duplicate' ? 'Revisar el par en Sanciones' : 'Abrir Sanciones',
                url: ctx.url(SUPPORT_QUEUE_PATH)
            })
        }
    },

    support_appeal_received: {
        name: 'Soporte: apelación recibida',
        description: 'Aviso al equipo de soporte cuando una persona sancionada envía su apelación. La decide un agente que no propuso ni confirmó la sanción.',
        serverOnly: true,
        recipients: supportRecipients,
        attribs: (p) => ({
            sanction_id: text(p.sanction_id),
            user_id: text(p.user_id),
            kind_label: text(p.kind_label),
            reason_label: text(p.reason_label),
            submitted_at: text(p.submitted_at)
        }),
        render: {
            audience: 'admin',
            category: 'transactional',
            subject: (d) => `Nueva apelación: ${or(d.kind_label, 'sanción')}`,
            preheader: () => 'Una persona sancionada envió su apelación. La decide un agente que no intervino.',
            eyebrow: 'Sanciones',
            headline: () => 'Nueva apelación',
            intro: () => 'Una persona sancionada envió su apelación. La tiene que decidir un agente que no propuso ni confirmó la sanción. El texto completo está en el panel de soporte.',
            rows: (d) => [
                ['Sanción', text(d.kind_label)],
                ['Motivo', text(d.reason_label)],
                ['ID de la sanción', text(d.sanction_id)],
                ['Cuenta', text(d.user_id)],
                ['Enviada', text(d.submitted_at)]
            ],
            cta: (d, ctx) => ({ label: 'Revisar la apelación', url: ctx.url(SUPPORT_QUEUE_PATH) })
        }
    }
};
