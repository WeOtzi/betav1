'use strict';

// Emails del frente "turnos" (reservas online). Los carga automáticamente el
// mapeo de eventos (frente "emails" lee todos los archivos de
// services/email-events/). Los tres los envía SOLO el servidor
// (lib/routes/turnos.js y services/quotation-intake.js), nunca el navegador.
//
// Payload común (lo arma lib/turnos-notify.js con datos releídos de la base):
//   artist_name, artist_email, client_name, client_email, quote_id,
//   slot_label ("jue 20 nov 2026 · 15:00–18:00"), slot_timezone,
//   hold_expires_label, quotation_url, slots_url

function text(value, fallback) {
    const s = String(value == null ? '' : value).trim();
    return s || fallback;
}

module.exports = {
    booking_slot_requested: {
        name: 'Turnos: solicitud con turno (artista)',
        description: 'Aviso al artista: entró una solicitud de cotización con un turno apartado.',
        templateHint: 'booking-slot-requested',
        serverOnly: true,
        recipient: (p) => p.artist_email,
        attribs: (p) => ({
            artist_name: text(p.artist_name, 'Hola'),
            client_name: text(p.client_name, 'Un cliente'),
            quote_id: text(p.quote_id, '-'),
            slot_label: text(p.slot_label, '-'),
            slot_timezone: text(p.slot_timezone, ''),
            hold_expires_label: text(p.hold_expires_label, '-'),
            quotation_url: p.quotation_url || '',
        }),
        render: {
            audience: 'artist',
            category: 'calendar',
            subject: (d) => `Nueva solicitud con turno · ${text(d.slot_label, 'turno pedido')}`,
            preheader: (d) => `${text(d.client_name, 'Un cliente')} pidió un turno. Queda apartado hasta ${text(d.hold_expires_label, 'que respondas')}.`,
            eyebrow: 'Turnos',
            headline: () => 'Te pidieron un turno',
            intro: (d) => `${text(d.client_name, 'Un cliente')} eligió uno de tus turnos disponibles y te mandó su idea. El turno queda apartado mientras respondés: si lo aceptás, se agenda y se bloquea en tu calendario.`,
            rows: (d) => [
                ['Turno pedido', text(d.slot_label, '-')],
                ['Zona horaria', text(d.slot_timezone, '-')],
                ['Apartado hasta', text(d.hold_expires_label, '-')],
                ['Cotización', text(d.quote_id, '-')],
            ],
            cta: (d) => (d.quotation_url ? { label: 'Ver la solicitud', url: d.quotation_url } : null),
        },
    },

    booking_slot_confirmed: {
        name: 'Turnos: turno confirmado (cliente)',
        description: 'Aviso al cliente: el artista aceptó el turno y quedó agendado.',
        templateHint: 'booking-slot-confirmed',
        serverOnly: true,
        recipient: (p) => p.client_email,
        attribs: (p) => ({
            client_name: text(p.client_name, 'Hola'),
            artist_name: text(p.artist_name, 'Tu artista'),
            quote_id: text(p.quote_id, '-'),
            slot_label: text(p.slot_label, '-'),
            slot_timezone: text(p.slot_timezone, ''),
            quotation_url: p.quotation_url || '',
        }),
        render: {
            audience: 'client',
            category: 'calendar',
            subject: (d) => `Turno confirmado con ${text(d.artist_name, 'tu artista')}`,
            preheader: (d) => `Tu sesión quedó agendada: ${text(d.slot_label, '')}.`,
            eyebrow: 'Turno confirmado',
            headline: () => 'Tu turno quedó agendado',
            intro: (d) => `${text(d.artist_name, 'El artista')} aceptó tu solicitud y reservó el turno que elegiste. Si necesitás cambiarlo, escribile desde tu cotización.`,
            rows: (d) => [
                ['Turno', text(d.slot_label, '-')],
                ['Zona horaria', text(d.slot_timezone, '-')],
                ['Artista', text(d.artist_name, '-')],
                ['Cotización', text(d.quote_id, '-')],
            ],
            cta: (d) => (d.quotation_url ? { label: 'Ver mi cotización', url: d.quotation_url } : null),
        },
    },

    booking_slot_hold_expired: {
        name: 'Turnos: apartado vencido (cliente)',
        description: 'Aviso al cliente: el artista no respondió a tiempo y el turno apartado se liberó.',
        templateHint: 'booking-slot-hold-expired',
        serverOnly: true,
        recipient: (p) => p.client_email,
        attribs: (p) => ({
            client_name: text(p.client_name, 'Hola'),
            artist_name: text(p.artist_name, 'El artista'),
            quote_id: text(p.quote_id, '-'),
            slot_label: text(p.slot_label, '-'),
            slots_url: p.slots_url || '',
        }),
        render: {
            audience: 'client',
            category: 'calendar',
            subject: () => 'Tu turno apartado se liberó',
            preheader: (d) => `El turno ${text(d.slot_label, '')} ya no está apartado. Tu solicitud sigue activa.`,
            eyebrow: 'Turnos',
            headline: () => 'El apartado de tu turno venció',
            intro: (d) => `${text(d.artist_name, 'El artista')} todavía no respondió y el turno que habías elegido volvió a quedar libre. Tu solicitud de cotización sigue activa: podés elegir otro turno o esperar la respuesta.`,
            rows: (d) => [
                ['Turno liberado', text(d.slot_label, '-')],
                ['Cotización', text(d.quote_id, '-')],
            ],
            cta: (d) => (d.slots_url ? { label: 'Elegir otro turno', url: d.slots_url } : null),
        },
    },
};
