'use strict';

// ===========================================================================
// Eventos de email del frente cot-form (cotizador web).
// El frente "emails" carga todos los archivos de services/email-events/ en el
// mapeo y en el render. serverOnly: solo los dispara el servidor
// (lib/routes/cot-form.js), nunca POST /api/email/:eventId.
// ===========================================================================

const dash = (value) => {
    const text = value == null ? '' : String(value).trim();
    return text || '-';
};

module.exports = {
    // Un cliente sin artista eligió a este artista entre las sugerencias del
    // sistema al cerrar su cotización. Respeta notification_prefs
    // (tipo "cotizaciones"): el servidor consulta la preferencia antes de enviar.
    quotation_artist_selected: {
        name: 'Artista: un cliente te eligió para su tatuaje',
        description: 'Aviso al artista cuando un cliente lo elige entre los artistas sugeridos al cotizar sin artista.',
        templateHint: 'artist-quotation-notification',
        serverOnly: true,
        recipient: (p) => p.artist_email,
        attribs: (p) => ({
            artist_name: dash(p.artist_name),
            client_first_name: dash(p.client_first_name),
            quote_id: dash(p.quote_id),
            tattoo_description: dash(p.tattoo_description),
            tattoo_style: dash(p.tattoo_style),
            tattoo_location: dash(p.tattoo_location),
            tattoo_size: dash(p.tattoo_size),
            client_city: dash(p.client_city),
            client_budget: dash(p.client_budget),
            quotation_url: p.quotation_url || ''
        }),
        render: {
            audience: 'artist',
            category: 'quotations',
            subject: (d) => `${dash(d.client_first_name)} te eligió para su próximo tatuaje`,
            preheader: (d) => `Nueva solicitud ${dash(d.quote_id)}: ${dash(d.tattoo_style)} · ${dash(d.tattoo_location)}`,
            eyebrow: 'Nueva solicitud',
            headline: (d) => `${dash(d.client_first_name)} quiere tatuarse con vos`,
            intro: () => 'Cotizó sin artista y te eligió entre los artistas que le sugerimos por estilo y ubicación. Revisá la idea y respondé con tu propuesta.',
            rows: (d) => [
                ['Solicitud', dash(d.quote_id)],
                ['Idea', dash(d.tattoo_description)],
                ['Estilo', dash(d.tattoo_style)],
                ['Zona', dash(d.tattoo_location)],
                ['Tamaño', dash(d.tattoo_size)],
                ['Ciudad del cliente', dash(d.client_city)],
                ['Presupuesto', dash(d.client_budget)]
            ],
            cta: (d) => (d.quotation_url ? { label: 'Ver la solicitud', url: d.quotation_url } : null)
        }
    }
};
