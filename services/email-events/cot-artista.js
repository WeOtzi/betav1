'use strict';

// ===========================================================================
// Emails del frente "cotizaciones del artista" (beta cerrada, 15 nov 2026).
// ---------------------------------------------------------------------------
// El frente "emails" carga automáticamente todos los archivos de
// services/email-events/ en el mapeo (email-event-mapping) y en el render.
// Los dos eventos son server-only (serverOnly: true → SERVER_ONLY_EVENTS):
// solo los dispara el servidor con destinatario y enlaces resueltos desde la
// cotización guardada (lib/cot-artista-notices.js), nunca el navegador.
//
//   artist_new_quotation        al artista, cuando entra una solicitud nueva
//                               de un cliente (COT-A-03).
//   artist_confirmed_agreement  al cliente, cuando el artista registra el
//                               acuerdo y agenda la primera sesión (COT-A-11).
// ===========================================================================

function text(value, fallback = '-') {
    if (value == null) return fallback;
    const out = String(value).trim();
    return out || fallback;
}

// tattoo_style es jsonb ({ style_name } | [..] | texto).
function styleName(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        const raw = value.trim();
        if (raw.startsWith('{') || raw.startsWith('[')) {
            try { return styleName(JSON.parse(raw)); } catch (_) { return raw; }
        }
        return raw;
    }
    if (Array.isArray(value)) return value.map(styleName).filter(Boolean).join(', ');
    if (typeof value === 'object') return text(value.style_name || value.name || value.label || '', '');
    return String(value);
}

function money(amount, currency) {
    const a = text(amount, '');
    if (!a) return '';
    return `${a} ${text(currency, '')}`.trim();
}

function yesNo(value) {
    if (value === true || value === 'true') return 'Sí';
    if (value === false || value === 'false') return 'No';
    return text(value);
}

const EVENTS = {
    artist_new_quotation: {
        name: 'Artista: nueva solicitud de cotización',
        description: 'Aviso al artista cuando un cliente le envía una solicitud de cotización nueva.',
        templateHint: 'artist-quotation-notification',
        serverOnly: true,
        recipient: p => p.artist_email,
        attribs: p => ({
            ...p,
            artist_name: text(p.artist_name, 'Hola'),
            client_full_name: text(p.client_full_name || p.client_name),
            client_email: text(p.client_email),
            client_age: text(p.client_age),
            client_allergies: text(p.client_allergies, 'Ninguna'),
            client_health_conditions: text(p.client_health_conditions, 'Ninguna'),
            client_budget_amount: text(p.client_budget_amount, 'Sin indicar'),
            client_budget_currency: text(p.client_budget_currency, ''),
            client_city_residence: text(p.client_city_residence),
            client_contact_preference: text(p.client_contact_preference),
            client_flexible_dates: text(p.client_flexible_dates),
            client_instagram: text(p.client_instagram),
            client_preferred_date: text(p.client_preferred_date, 'Flexible'),
            client_travel_willing: text(p.client_travel_willing),
            client_whatsapp: text(p.client_whatsapp),
            quotation_medium: text(p.quotation_medium, 'web'),
            tattoo_body_part: text(p.tattoo_body_part),
            tattoo_body_side: text(p.tattoo_body_side),
            tattoo_color_type: text(p.tattoo_color_type),
            tattoo_idea_description: text(p.tattoo_idea_description),
            tattoo_is_cover_up: yesNo(p.tattoo_is_cover_up),
            tattoo_is_first_tattoo: yesNo(p.tattoo_is_first_tattoo),
            tattoo_references: text(p.tattoo_references),
            tattoo_size: text(p.tattoo_size),
            tattoo_style: text(styleName(p.tattoo_style)),
            attachments_count: String(Number(p.reference_images_count) || 0),
            attachments_html: '',
            quotation_url: p.quotation_url || '',
            dashboard_url: p.dashboard_url || ''
        }),
        render: {
            audience: 'artist',
            category: 'quotations',
            subject: d => `Nueva solicitud de ${text(d.client_full_name || d.client_name, 'un cliente')}`,
            preheader: d => `${text(d.client_full_name || d.client_name, 'Un cliente')} quiere cotizar un tatuaje con vos.`,
            eyebrow: 'ARTISTA / NUEVA COTIZACIÓN',
            headline: () => 'Tenés una solicitud nueva.',
            intro: d => `${text(d.client_full_name || d.client_name, 'Un cliente')} te mandó una idea para cotizar. Respondé desde el detalle: presupuesto, sesiones, seña y disponibilidad.`,
            rows: d => [
                ['Cliente', text(d.client_full_name || d.client_name)],
                ['Idea', text(d.tattoo_idea_description).slice(0, 280)],
                ['Estilo', text(styleName(d.tattoo_style))],
                ['Zona', text(d.tattoo_body_part)],
                ['Tamaño', text(d.tattoo_size)],
                ['Presupuesto del cliente', money(d.client_budget_amount, d.client_budget_currency) || 'Sin indicar'],
                ['Fecha preferida', text(d.client_preferred_date, 'Flexible')],
                ['Referencia', text(d.quote_id)]
            ],
            cta: d => (d.quotation_url ? { label: 'Ver solicitud', url: d.quotation_url } : null)
        }
    },

    artist_confirmed_agreement: {
        name: 'Cliente: acuerdo confirmado por el artista',
        description: 'Aviso al cliente cuando el artista registra el acuerdo (presupuesto final, sesiones y primera fecha).',
        templateHint: 'quotation-agreement-client',
        serverOnly: true,
        recipient: p => p.client_email,
        attribs: p => ({
            ...p,
            client_name: text(p.client_name || p.client_full_name, 'Hola'),
            artist_name: text(p.artist_name, 'Tu artista'),
            final_budget_amount: text(p.final_budget_amount),
            final_budget_currency: text(p.final_budget_currency, ''),
            final_sessions: text(p.final_sessions),
            first_session_date: text(p.first_session_date, 'A confirmar'),
            final_comment: text(p.final_comment, '-'),
            deposit_text: text(p.deposit_text, 'Sin seña'),
            tattoo_style: text(styleName(p.tattoo_style)),
            tattoo_body_part: text(p.tattoo_body_part),
            tattoo_size: text(p.tattoo_size),
            quote_id: text(p.quote_id),
            dashboard_url: p.dashboard_url || ''
        }),
        render: {
            audience: 'client',
            category: 'quotations',
            subject: d => `${text(d.artist_name, 'Tu artista')} confirmó el acuerdo de tu tatuaje`,
            preheader: d => `Presupuesto final, sesiones y primera fecha con ${text(d.artist_name, 'tu artista')}.`,
            eyebrow: 'COTIZACIÓN / ACUERDO',
            headline: () => 'Tu tatuaje tiene acuerdo.',
            intro: d => `${text(d.artist_name, 'Tu artista')} registró lo que acordaron. Guardá este resumen: tiene el presupuesto final, las sesiones y la primera fecha.`,
            rows: d => [
                ['Artista', text(d.artist_name)],
                ['Presupuesto final', money(d.final_budget_amount, d.final_budget_currency) || '-'],
                ['Seña', text(d.deposit_text, 'Sin seña')],
                ['Sesiones', text(d.final_sessions)],
                ['Primera sesión', text(d.first_session_date, 'A confirmar')],
                ['Comentario', text(d.final_comment)],
                ['Referencia', text(d.quote_id)]
            ],
            cta: d => (d.dashboard_url ? { label: 'Ver mi cotización', url: d.dashboard_url } : null)
        }
    }
};

// Solo eventos como claves enumerables: el cargador del frente "emails" recorre
// el objeto. Los helpers quedan disponibles para los tests sin enumerarse.
Object.defineProperty(EVENTS, '_internal', { value: { styleName, money, text }, enumerable: false });
module.exports = EVENTS;
