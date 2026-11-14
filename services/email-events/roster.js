'use strict';

// ===========================================================================
// Eventos de email del roster de estudios (beta cerrada · EM-10 / ROSTER).
// ---------------------------------------------------------------------------
// El frente "emails" carga automáticamente todos los archivos de
// services/email-events/ en el mapeo de eventos y en el render del servidor.
// Todos los dispara SOLO el servidor (serverOnly: true): los payloads se arman
// en lib/roster-service.js con datos verificados (nunca del body del cliente).
//
// Payload común (lo arma lib/roster-service.js):
//   to, recipient_name, studio_name, artist_name, artist_username,
//   role_label, location_label, message, decision, status_label,
//   cta_url, cta_label, body_text (texto plano para la plantilla
//   studio-notification de n8n), membership_id, studio_id.
// ===========================================================================

function text(value, fallback = '') {
    const out = String(value == null ? '' : value).trim();
    return out || fallback;
}

function firstName(value) {
    const name = text(value);
    return name ? ` ${name.split(/\s+/)[0]}` : '';
}

function passthrough(p) {
    return {
        recipient_name: text(p.recipient_name),
        studio_name: text(p.studio_name, 'El estudio'),
        artist_name: text(p.artist_name, 'Un artista'),
        artist_username: text(p.artist_username),
        role_label: text(p.role_label),
        location_label: text(p.location_label),
        message: text(p.message),
        decision: text(p.decision),
        status_label: text(p.status_label),
        subject: text(p.subject),
        body_text: text(p.body_text),
        cta_url: text(p.cta_url),
        cta_label: text(p.cta_label),
        dashboard_url: text(p.cta_url),
        membership_id: text(p.membership_id),
        studio_id: text(p.studio_id)
    };
}

function roleRows(d) {
    return [
        ['Estudio', d.studio_name],
        ['Rol', d.role_label],
        ['Sede', d.location_label]
    ];
}

function cta(d, fallbackLabel) {
    return d.cta_url ? { label: d.cta_label || fallbackLabel, url: d.cta_url } : null;
}

module.exports = {
    studio_membership_request_created: {
        name: 'Estudio: nueva solicitud de alta',
        description: 'Avisa al dueño del estudio que un tatuador pidió sumarse a su equipo (registro, enlace o desde su cuenta).',
        templateHint: 'studio-notification',
        serverOnly: true,
        recipient: p => p.to || p.studio_email,
        attribs: passthrough,
        render: {
            audience: 'studio',
            category: 'studios',
            subject: d => `${text(d.artist_name, 'Un artista')} quiere sumarse a ${text(d.studio_name, 'tu estudio')}`,
            preheader: d => `Revisá la solicitud de ${text(d.artist_name, 'un artista')} y aprobala o rechazala desde Equipo.`,
            eyebrow: 'Solicitud de alta',
            headline: d => `${text(d.artist_name, 'Un artista')} pidió sumarse a tu equipo`,
            intro: d => `Hola${firstName(d.recipient_name)}, ${text(d.artist_name, 'un artista')} quiere trabajar en ${text(d.studio_name, 'tu estudio')}. Revisá su perfil y decidí desde el panel del estudio.`,
            rows: d => [
                ['Artista', d.artist_username ? `${d.artist_name} · @${d.artist_username}` : d.artist_name],
                ...roleRows(d),
                ['Mensaje', d.message]
            ],
            cta: d => cta(d, 'Revisar solicitud')
        }
    },

    studio_membership_request_decision: {
        name: 'Estudio: decisión sobre una solicitud de alta',
        description: 'Avisa al tatuador si el estudio aprobó o rechazó su solicitud para sumarse al equipo.',
        templateHint: 'studio-notification',
        serverOnly: true,
        recipient: p => p.to || p.artist_email,
        attribs: passthrough,
        render: {
            audience: 'artist',
            category: 'studios',
            subject: d => (d.decision === 'accepted'
                ? `${text(d.studio_name, 'El estudio')} aprobó tu solicitud`
                : `Novedades de tu solicitud a ${text(d.studio_name, 'el estudio')}`),
            preheader: d => (d.decision === 'accepted'
                ? `Ya formás parte del equipo de ${text(d.studio_name, 'el estudio')} en We Ötzi.`
                : `${text(d.studio_name, 'El estudio')} no aprobó tu solicitud por ahora.`),
            eyebrow: 'Solicitud de alta',
            headline: d => (d.decision === 'accepted'
                ? `Ya sos parte de ${text(d.studio_name, 'el estudio')}`
                : 'Tu solicitud no fue aprobada'),
            intro: d => (d.decision === 'accepted'
                ? `Hola${firstName(d.recipient_name)}, ${text(d.studio_name, 'el estudio')} aprobó tu solicitud. Tu perfil ya muestra el estudio y su sede.`
                : `Hola${firstName(d.recipient_name)}, ${text(d.studio_name, 'el estudio')} no aprobó tu solicitud por ahora. Podés seguir explorando estudios y oportunidades.`),
            rows: d => (d.decision === 'accepted' ? roleRows(d) : [['Estudio', d.studio_name]]),
            cta: d => cta(d, d.decision === 'accepted' ? 'Ver mis estudios' : 'Explorar estudios')
        }
    },

    studio_artist_invite_email: {
        name: 'Estudio: invitación por email a un tatuador sin cuenta',
        description: 'Invitación personal del estudio con un enlace para crear el perfil y quedar en su equipo.',
        templateHint: 'studio-notification',
        serverOnly: true,
        recipient: p => p.to,
        attribs: passthrough,
        render: {
            audience: 'artist',
            category: 'studios',
            subject: d => `${text(d.studio_name, 'Un estudio')} te invita a su equipo en We Ötzi`,
            preheader: d => `Creá tu perfil de artista con este enlace y quedás en el equipo de ${text(d.studio_name, 'el estudio')}.`,
            eyebrow: 'Invitación de estudio',
            headline: d => `${text(d.studio_name, 'Un estudio')} te quiere en su equipo`,
            intro: d => `Hola${firstName(d.recipient_name)}, ${text(d.studio_name, 'un estudio')} te invitó a sumarte a su equipo en We Ötzi. Creá tu perfil de artista con el enlace (o ingresá si ya tenés cuenta) y el vínculo queda hecho.`,
            rows: d => [...roleRows(d), ['Mensaje', d.message]],
            cta: d => cta(d, 'Aceptar invitación')
        }
    },

    studio_invite_link_joined: {
        name: 'Estudio: un tatuador se sumó con el enlace',
        description: 'Avisa al dueño que un tatuador se sumó al equipo con un enlace de invitación sin aprobación.',
        templateHint: 'studio-notification',
        serverOnly: true,
        recipient: p => p.to || p.studio_email,
        attribs: passthrough,
        render: {
            audience: 'studio',
            category: 'studios',
            subject: d => `${text(d.artist_name, 'Un artista')} se sumó a ${text(d.studio_name, 'tu estudio')}`,
            preheader: d => `${text(d.artist_name, 'Un artista')} usó tu enlace de invitación y ya forma parte del equipo.`,
            eyebrow: 'Equipo',
            headline: d => `${text(d.artist_name, 'Un artista')} ya está en tu equipo`,
            intro: d => `Hola${firstName(d.recipient_name)}, ${text(d.artist_name, 'un artista')} se sumó a ${text(d.studio_name, 'tu estudio')} con tu enlace de invitación. Podés editar su rol, sede y reparto desde Equipo.`,
            rows: d => [
                ['Artista', d.artist_username ? `${d.artist_name} · @${d.artist_username}` : d.artist_name],
                ...roleRows(d)
            ],
            cta: d => cta(d, 'Ver equipo')
        }
    },

    studio_invitation_response: {
        name: 'Estudio: el tatuador respondió la invitación',
        description: 'Avisa al dueño del estudio si el tatuador aceptó o rechazó su invitación al equipo.',
        templateHint: 'studio-notification',
        serverOnly: true,
        recipient: p => p.to || p.studio_email,
        attribs: passthrough,
        render: {
            audience: 'studio',
            category: 'studios',
            subject: d => (d.decision === 'accepted'
                ? `${text(d.artist_name, 'El artista')} aceptó tu invitación`
                : `${text(d.artist_name, 'El artista')} rechazó tu invitación`),
            preheader: d => (d.decision === 'accepted'
                ? `${text(d.artist_name, 'El artista')} ya forma parte del equipo de ${text(d.studio_name, 'tu estudio')}.`
                : `${text(d.artist_name, 'El artista')} no aceptó sumarse a ${text(d.studio_name, 'tu estudio')} por ahora.`),
            eyebrow: 'Invitación al equipo',
            headline: d => (d.decision === 'accepted'
                ? `${text(d.artist_name, 'El artista')} se sumó a tu equipo`
                : `${text(d.artist_name, 'El artista')} no aceptó la invitación`),
            intro: d => (d.decision === 'accepted'
                ? `Hola${firstName(d.recipient_name)}, ${text(d.artist_name, 'el artista')} aceptó tu invitación como ${text(d.role_label, 'artista').toLowerCase()}.`
                : `Hola${firstName(d.recipient_name)}, ${text(d.artist_name, 'el artista')} rechazó tu invitación. Podés escribirle desde Mensajes o invitar a otra persona.`),
            rows: d => [
                ['Artista', d.artist_username ? `${d.artist_name} · @${d.artist_username}` : d.artist_name],
                ...roleRows(d)
            ],
            cta: d => cta(d, 'Ver equipo')
        }
    }
};
