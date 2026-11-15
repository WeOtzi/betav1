'use strict';

// ===========================================================================
// Emails del frente cot-detalle (ronda 2).
// ---------------------------------------------------------------------------
// Los carga automáticamente el mapeo de services/email-event-mapping.js.
//
//   shared_quotation_linked   al ARTISTA, cuando su cliente abre el enlace
//                             público de una cotización (/cotizacion/<token>),
//                             crea o inicia su cuenta y la vincula [P30].
//
// Solo lo dispara el servidor (lib/routes/cot-detalle.js) después de guardar
// el vínculo; el destinatario sale de la cotización guardada. Sin datos de
// salud ni de contacto del cliente.
// ===========================================================================

function text(value, fallback = '') {
    const s = String(value == null ? '' : value).trim();
    return s || fallback;
}

function detailPath(d) {
    return `/my-quotations/detail?quote=${encodeURIComponent(text(d.quote_id))}`;
}

module.exports = {
    shared_quotation_linked: {
        name: 'Artista: el cliente vinculó la cotización compartida',
        description: 'Aviso al artista cuando el cliente abre el enlace público de una cotización y la vincula a su cuenta (ya pueden chatear).',
        templateHint: 'artist-quotation-notification',
        serverOnly: true,
        recipient: p => p.artist_email || p.recipient_email || null,
        attribs: p => ({
            quote_id: text(p.quote_id),
            artist_name: text(p.artist_name, 'Hola'),
            client_name: text(p.client_name, 'Tu cliente'),
            quotation_url: text(p.quotation_url),
            chat_url: text(p.chat_url)
        }),
        render: {
            audience: 'artist',
            category: 'quotations',
            subject: d => `${text(d.client_name, 'Tu cliente')} vinculó la cotización ${text(d.quote_id)} a su cuenta`,
            preheader: d => `${text(d.client_name, 'Tu cliente').slice(0, 40)} abrió tu enlace y ya tiene cuenta: pueden seguir por el chat.`,
            eyebrow: 'COTIZACIÓN / CLIENTE VINCULADO',
            headline: () => 'Tu cliente ya tiene cuenta.',
            intro: d => `${text(d.client_name, 'Tu cliente')} abrió el enlace que le compartiste y vinculó la cotización a su cuenta de We Ötzi. Desde ahora puede responder tu propuesta y escribirte por el chat de la cotización.`,
            rows: d => [
                ['Cotización', text(d.quote_id)],
                ['Cliente', text(d.client_name, 'Tu cliente')]
            ],
            cta: (d, ctx) => ({ label: 'Abrir la cotización', url: ctx.url(detailPath(d)) })
        }
    }
};
