'use strict';

// ===========================================================================
// Emails del frente "cot-respuesta" (ronda 2, 16 nov 2026).
// ---------------------------------------------------------------------------
// El cargador de services/email-events/ suma este archivo al mapeo y al render.
//
//   artist_updated_quotation_proposal   al cliente, cuando el artista reenvía
//       su propuesta mientras la cotización todavía no está aprobada por
//       ambas partes (P25): presupuesto, seña, sesiones, duración, fechas
//       ofrecidas y el mensaje ya resuelto.
//
// Server-only: lo dispara lib/cot-respuesta.js después de guardar, con el
// destinatario de la cotización guardada (nunca el navegador). La primera
// respuesta sigue saliendo por artist_responded_quotation.
// ===========================================================================

// Código que lee la persona: el corto de la cotización (short_code) y, si la
// base todavía no lo tiene, el quote_id. El quote_id queda para los enlaces.
const { visibleCode } = require('../../lib/quote-code');

function text(value, fallback = '') {
    const out = String(value == null ? '' : value).trim();
    return out || fallback;
}

function firstName(value) {
    return text(value).split(/\s+/)[0] || '';
}

const EVENTS = {
    artist_updated_quotation_proposal: {
        name: 'Cliente: el artista actualizó su propuesta',
        description: 'Aviso al cliente cuando el artista modifica y reenvía la propuesta de una cotización que todavía no está aprobada por ambas partes.',
        templateHint: 'artist-responded',
        serverOnly: true,
        recipient: p => p.client_email || p.recipient_email || null,
        attribs: p => ({
            quote_id: text(p.quote_id),
            quote_code: text(visibleCode(p)),
            client_name: text(p.client_name),
            artist_name: text(p.artist_name, 'Tu artista'),
            budget_text: text(p.budget_text, 'A confirmar'),
            deposit_text: text(p.deposit_text, 'Sin seña'),
            sessions_text: text(p.sessions_text),
            duration_text: text(p.duration_text),
            offered_text: text(p.offered_text),
            availability_note: text(p.availability_note),
            location: text(p.location),
            expiry_text: text(p.expiry_text),
            message_preview: text(p.message_preview),
            quotation_url: text(p.quotation_url),
            dashboard_url: text(p.dashboard_url)
        }),
        render: {
            audience: 'client',
            category: 'quotations',
            subject: d => `${text(d.artist_name, 'Tu artista')} actualizó su propuesta`,
            preheader: d => `Hay cambios en la propuesta de ${text(d.artist_name, 'tu artista').slice(0, 28)}: revisa el presupuesto, las sesiones y las fechas.`,
            eyebrow: 'COTIZACIÓN / PROPUESTA ACTUALIZADA',
            headline: () => 'Tu propuesta tiene cambios.',
            intro: d => `${text(d.artist_name, 'Tu artista')} modificó la propuesta de tu tatuaje. Revísala en tu cuenta: puedes aceptarla o seguir conversando por el chat.`,
            quote: d => (text(d.message_preview)
                ? { label: `Mensaje de ${firstName(d.artist_name) || 'tu artista'}`, text: text(d.message_preview).slice(0, 400) }
                : null),
            rows: d => [
                ['Presupuesto', text(d.budget_text, 'A confirmar')],
                ['Seña', text(d.deposit_text, 'Sin seña')],
                ['Sesiones', text(d.sessions_text)],
                ['Duración por sesión', text(d.duration_text)],
                ['Fechas ofrecidas', text(d.offered_text)],
                ['Disponibilidad', text(d.availability_note)],
                ['Estudio o ubicación', text(d.location)],
                ['Vigencia de la propuesta', text(d.expiry_text)],
                ['Cotización', text(visibleCode(d))]
            ],
            // El servidor manda quotation_url (withLinks); sin ella, el panel del cliente.
            cta: (d, ctx) => ({
                label: 'Ver la propuesta',
                url: d.quotation_url || ctx.url(`/client/dashboard${d.quote_id ? `?quote=${encodeURIComponent(d.quote_id)}` : ''}`)
            })
        }
    }
};

module.exports = EVENTS;
