'use strict';

// ============================================
// Eventos de email del frente cot-cliente (beta cerrada).
// Los carga automáticamente el mapeo de services/email-event-mapping.js (frente
// "emails"). Los dispara SOLO el servidor (lib/routes/cot-cliente.js) después de
// guardar la decisión del cliente; el destinatario sale de la cotización
// guardada, nunca del navegador.
//
// Al artista se le avisa con los eventos existentes client_approved_quotation /
// client_rejected_quotation (email-event-mapping.js). Estos dos son el
// comprobante para el CLIENTE.
// ============================================

function text(value, fallback = '') {
    const s = String(value == null ? '' : value).trim();
    return s || fallback;
}

function attribs(p) {
    return {
        quote_id: text(p.quote_id),
        client_name: text(p.client_name),
        artist_name: text(p.artist_name, 'el artista'),
        artist_budget_amount: text(p.artist_budget_amount),
        artist_budget_currency: text(p.artist_budget_currency),
        budget_text: text(p.budget_text, '—'),
        sessions: text(p.sessions, '—'),
        tattoo_style: text(p.tattoo_style, '—'),
        tattoo_body_part: text(p.tattoo_body_part, '—'),
        tattoo_size: text(p.tattoo_size, '—'),
        decision_reason: text(p.decision_reason),
        quotation_url: text(p.quotation_url),
        dashboard_url: text(p.dashboard_url)
    };
}

module.exports = {
    client_quotation_accepted_receipt: {
        name: 'Cliente: aceptó la propuesta (comprobante)',
        description: 'Confirmación al cliente de que aceptó la propuesta del artista y de los próximos pasos (turno y seña se coordinan con el artista).',
        templateHint: 'quotation-approved',
        serverOnly: true,
        recipient: p => p.client_email || p.recipient_email || null,
        attribs,
        render: {
            audience: 'client',
            category: 'quotations',
            subject: d => `Aceptaste la propuesta de ${text(d.artist_name, 'tu artista')} · ${text(d.quote_id)}`,
            preheader: d => `Total ${text(d.budget_text, 'a confirmar')}. El artista ya tiene tu respuesta.`,
            eyebrow: 'COTIZACIÓN / ACEPTADA',
            headline: () => 'Aceptaste la propuesta.',
            intro: d => `Le avisamos a ${text(d.artist_name, 'tu artista')}. El próximo paso es coordinar el turno y la seña con el artista desde el chat de la cotización. We Ötzi no cobra la seña por ahora: pagala solo por los medios que te indique el artista.`,
            rows: d => [
                ['Cotización', text(d.quote_id)],
                ['Artista', text(d.artist_name, '—')],
                ['Total acordado', text(d.budget_text, 'A confirmar')],
                ['Sesiones', text(d.sessions, '—')],
                ['Estilo', text(d.tattoo_style, '—')],
                ['Zona', text(d.tattoo_body_part, '—')]
            ],
            cta: d => (d.quotation_url ? { label: 'Ver la cotización', url: d.quotation_url } : null)
        }
    },
    client_quotation_rejected_receipt: {
        name: 'Cliente: rechazó la propuesta (comprobante)',
        description: 'Confirmación al cliente de que rechazó la propuesta del artista.',
        templateHint: 'quotation-rejected',
        serverOnly: true,
        recipient: p => p.client_email || p.recipient_email || null,
        attribs,
        render: {
            audience: 'client',
            category: 'quotations',
            subject: d => `Rechazaste la propuesta de ${text(d.artist_name, 'tu artista')} · ${text(d.quote_id)}`,
            preheader: () => 'La cotización quedó finalizada y le avisamos al artista. Puedes iniciar una nueva.',
            eyebrow: 'COTIZACIÓN / RECHAZADA',
            headline: () => 'Rechazaste la propuesta.',
            // P23 (ronda 2): rechazar es definitivo; el artista ya no puede escribir por el chat.
            intro: d => `Le avisamos a ${text(d.artist_name, 'el artista')} y la cotización quedó finalizada. Si quieres retomar la idea, inicia una cotización nueva; también puedes buscar otros artistas en el marketplace.`,
            rows: d => {
                const rows = [
                    ['Cotización', text(d.quote_id)],
                    ['Artista', text(d.artist_name, '—')],
                    ['Propuesta', text(d.budget_text, '—')]
                ];
                if (text(d.decision_reason)) rows.push(['Tu motivo', text(d.decision_reason)]);
                return rows;
            },
            cta: d => (d.quotation_url ? { label: 'Ver la cotización', url: d.quotation_url } : null)
        }
    }
};
