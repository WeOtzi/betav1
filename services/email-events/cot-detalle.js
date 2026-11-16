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
// salud, WhatsApp ni Instagram del cliente. En las cotizaciones manuales lleva
// el correo de la cuenta que vinculó (linked_account_email): el nombre es el
// del cliente que el artista tenía previsto, y sin ese dato no podría notar
// que la vinculó otra persona.
// ===========================================================================

// Código que lee la persona: el corto de la cotización (short_code) y, si la
// base todavía no lo tiene, el quote_id. El quote_id queda para los enlaces.
const { visibleCode } = require('../../lib/quote-code');

function text(value, fallback = '') {
    const s = String(value == null ? '' : value).trim();
    return s || fallback;
}

function detailPath(d) {
    return `/my-quotations/detail?quote=${encodeURIComponent(text(d.quote_id))}`;
}

// Correo de la cuenta que vinculó: solo si tiene forma de correo.
function linkedEmail(d) {
    const email = text(d && d.linked_account_email).toLowerCase();
    return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) && email.length <= 254 ? email : '';
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
            quote_code: text(visibleCode(p)),
            artist_name: text(p.artist_name, 'Hola'),
            client_name: text(p.client_name, 'Tu cliente'),
            linked_account_email: linkedEmail(p),
            quotation_url: text(p.quotation_url),
            chat_url: text(p.chat_url)
        }),
        render: {
            audience: 'artist',
            category: 'quotations',
            subject: d => `${text(d.client_name, 'Tu cliente')} vinculó la cotización ${text(visibleCode(d))} a su cuenta`,
            preheader: d => `${text(d.client_name, 'Tu cliente').slice(0, 40)} abrió tu enlace y ya tiene cuenta: pueden seguir por el chat.`,
            eyebrow: 'COTIZACIÓN / CLIENTE VINCULADO',
            headline: () => 'Tu cliente ya tiene cuenta.',
            intro: d => (linkedEmail(d)
                ? `La cuenta ${linkedEmail(d)} abrió el enlace que compartiste y vinculó la cotización de ${text(d.client_name, 'tu cliente')} en We Ötzi. Desde ahora puede responder tu propuesta y escribirte por el chat de la cotización. Si no reconoces ese correo, escríbenos a soporte.`
                : `${text(d.client_name, 'Tu cliente')} abrió el enlace que le compartiste y vinculó la cotización a su cuenta de We Ötzi. Desde ahora puede responder tu propuesta y escribirte por el chat de la cotización.`),
            rows: d => [
                ['Cotización', text(visibleCode(d))],
                ['Cliente', text(d.client_name, 'Tu cliente')],
                ['Cuenta que la vinculó', linkedEmail(d)]
            ],
            cta: (d, ctx) => ({ label: 'Abrir la cotización', url: ctx.url(detailPath(d)) })
        }
    }
};
