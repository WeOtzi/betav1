'use strict';

// ===========================================================================
// Emails del frente "negociacion" (ronda 2 · 16 nov 2026).
// ---------------------------------------------------------------------------
// Los carga automáticamente services/email-event-mapping.js. Todos son
// server-only: los dispara lib/routes/negociacion.js después de guardar cada
// paso, con el destinatario y los enlaces resueltos desde la cotización
// guardada (lib/negociacion.js · emailFor), nunca desde el navegador. Salen
// por el relé con render en el servidor; el frente "push" suma el aviso push
// de cada correo.
//
//   negotiation_counter_proposed    al artista: el cliente propone cambios (P23)
//   negotiation_counter_accepted    al cliente: el artista aceptó los cambios
//   negotiation_counter_declined    al cliente: el artista mantiene su propuesta
//   negotiation_amendment_proposed  a la contraparte: cambio al acuerdo (P25)
//   negotiation_amendment_accepted  a quien propuso: cambio aprobado y aplicado
//   negotiation_amendment_rejected  a quien propuso: el acuerdo sigue igual
//   negotiation_proposal_withdrawn  a la contraparte: se retiró la propuesta
//
// El payload trae recipient_role ('artist' | 'client'): los textos y el
// enlace cambian según quién recibe. Sin datos de salud ni de contacto.
// ===========================================================================

function text(value, fallback = '') {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return s || fallback;
}

function clip(value, max) {
    const s = text(value);
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// Nombre de quien actuó, o un genérico según su rol.
function actor(d) {
    return text(d.actor_name, d.actor_role === 'artist' ? 'Tu artista' : d.actor_role === 'client' ? 'Tu cliente' : 'La otra parte');
}

// Filas "Dato: antes → después" (changes_rows = [[etiqueta, texto], ...]).
function changeRows(d) {
    const list = Array.isArray(d.changes_rows) ? d.changes_rows : [];
    return list.slice(0, 10)
        .filter(row => Array.isArray(row) && row.length >= 2 && text(row[0]) && text(row[1]))
        .map(row => [clip(row[0], 60), clip(row[1], 400)]);
}

function rows(d, before = [], after = []) {
    return [['Cotización', text(d.quote_id)], ...before, ...changeRows(d), ...after];
}

// Siempre absoluto: el del payload (lo arma el servidor) o el panel del rol.
function link(label) {
    return (d, ctx) => {
        const fromPayload = ctx.f.url(d.quotation_url);
        const quote = encodeURIComponent(text(d.quote_id));
        const fallback = ctx.role === 'artist'
            ? ctx.url(quote ? `/my-quotations/detail?quote=${quote}` : '/my-quotations')
            : ctx.url(quote ? `/client/dashboard?quote=${quote}` : '/client/dashboard');
        return { label, url: fromPayload || fallback };
    };
}

function attribs(p) {
    return {
        quote_id: text(p.quote_id),
        recipient_name: text(p.recipient_name),
        recipient_role: text(p.recipient_role),
        actor_name: text(p.actor_name),
        artist_name: text(p.artist_name),
        client_name: text(p.client_name),
        proposal_kind: text(p.proposal_kind),
        changes_text: clip(p.changes_text, 600),
        proposal_note: clip(p.proposal_note, 600),
        response_note: clip(p.response_note, 600),
        agreed_total_text: text(p.agreed_total_text),
        quotation_url: text(p.quotation_url),
    };
}

const recipient = p => p.recipient_email || null;

function event(name, description, render) {
    return { name, description, serverOnly: true, recipient, attribs, render: Object.assign({ category: 'quotations' }, render) };
}

const EVENTS = {
    negotiation_counter_proposed: event(
        'Artista: el cliente propone cambios',
        'Aviso al artista cuando el cliente modifica la propuesta recibida (presupuesto, zona, tamaño, estilo, color o idea).',
        {
            audience: 'artist',
            subject: d => `${text(d.client_name, 'Tu cliente')} propone cambios en la cotización ${text(d.quote_id)}`,
            preheader: () => 'Revisa el antes y el después: puedes aceptar los cambios o enviar otra propuesta.',
            eyebrow: 'COTIZACIÓN / CAMBIOS PROPUESTOS',
            headline: () => 'Tu cliente propone cambios.',
            intro: d => `${text(d.client_name, 'Tu cliente')} revisó tu propuesta y sugiere los cambios de abajo. Si los aceptas, la cotización queda aprobada por ambas partes; si prefieres, envíale otra propuesta.`,
            rows: d => rows(d, [], [['Mensaje del cliente', clip(d.proposal_note, 400)]]),
            cta: link('Ver los cambios'),
        }
    ),

    negotiation_counter_accepted: event(
        'Cliente: el artista aceptó los cambios',
        'Aviso al cliente cuando el artista acepta su contrapropuesta: la cotización queda aprobada por ambas partes.',
        {
            audience: 'client',
            subject: d => `${text(d.artist_name, 'Tu artista')} aceptó tus cambios · ${text(d.quote_id)}`,
            preheader: () => 'La cotización quedó aprobada por ambas partes con las condiciones que propusiste.',
            eyebrow: 'COTIZACIÓN / APROBADA',
            headline: () => 'Tus cambios fueron aceptados.',
            intro: d => `${text(d.artist_name, 'Tu artista')} aceptó los cambios que propusiste: la cotización quedó aprobada por ambas partes. El próximo paso es coordinar el turno y la seña desde el chat de la cotización.`,
            rows: d => rows(d, [['Total acordado', text(d.agreed_total_text)]], [['Mensaje del artista', clip(d.response_note, 400)]]),
            cta: link('Ver la cotización'),
        }
    ),

    negotiation_counter_declined: event(
        'Cliente: el artista mantiene su propuesta',
        'Aviso al cliente cuando el artista no aplica su contrapropuesta y mantiene la propuesta original.',
        {
            audience: 'client',
            subject: d => `${text(d.artist_name, 'Tu artista')} mantiene su propuesta · ${text(d.quote_id)}`,
            preheader: () => 'Tu artista prefirió no aplicar los cambios. Puedes aceptar, rechazar o proponer otros.',
            eyebrow: 'COTIZACIÓN / PROPUESTA VIGENTE',
            headline: () => 'El artista mantiene su propuesta.',
            intro: d => `${text(d.artist_name, 'Tu artista')} revisó tus cambios y prefirió mantener su propuesta original. Puedes aceptarla, rechazarla o proponer otros cambios desde tu panel.`,
            rows: d => rows(d, [], [['Mensaje del artista', clip(d.response_note, 400)]]),
            cta: link('Ver la propuesta'),
        }
    ),

    negotiation_amendment_proposed: event(
        'Acuerdo: cambio propuesto',
        'Aviso a la contraparte (cliente o artista) cuando la otra parte propone cambiar el acuerdo ya aprobado.',
        {
            audience: 'client',
            subject: d => `${actor(d)} propone cambiar el acuerdo · ${text(d.quote_id)}`,
            preheader: () => 'El acuerdo actual sigue vigente hasta que apruebes o rechaces los cambios propuestos.',
            eyebrow: 'ACUERDO / CAMBIO PROPUESTO',
            headline: () => 'Te proponen un cambio al acuerdo.',
            intro: d => `${actor(d)} propone los cambios de abajo. No rigen hasta que los apruebes: mientras tanto, el acuerdo actual sigue igual.`,
            rows: d => rows(d, [], [['Motivo', clip(d.proposal_note, 400)]]),
            cta: link('Revisar los cambios'),
        }
    ),

    negotiation_amendment_accepted: event(
        'Acuerdo: cambio aprobado',
        'Aviso a quien propuso el cambio cuando la otra parte lo aprueba: el acuerdo queda actualizado.',
        {
            audience: 'client',
            subject: d => `${actor(d)} aprobó los cambios al acuerdo · ${text(d.quote_id)}`,
            preheader: () => 'El acuerdo ya está actualizado con los cambios que propusiste y quedó en el historial.',
            eyebrow: 'ACUERDO / ACTUALIZADO',
            headline: () => 'El acuerdo quedó actualizado.',
            intro: d => `${actor(d)} aprobó los cambios que propusiste. El acuerdo ya rige con las condiciones nuevas.`,
            rows: d => rows(d, [['Total acordado', text(d.agreed_total_text)]], [['Comentario', clip(d.response_note, 400)]]),
            cta: link('Ver el acuerdo'),
        }
    ),

    negotiation_amendment_rejected: event(
        'Acuerdo: cambio rechazado',
        'Aviso a quien propuso el cambio cuando la otra parte lo rechaza: el acuerdo sigue como estaba.',
        {
            audience: 'client',
            subject: d => `${actor(d)} no aprobó los cambios al acuerdo · ${text(d.quote_id)}`,
            preheader: () => 'El acuerdo sigue como estaba. Puedes proponer otro cambio o escribirle por el chat.',
            eyebrow: 'ACUERDO / SIN CAMBIOS',
            headline: () => 'El acuerdo sigue igual.',
            intro: d => `${actor(d)} no aprobó los cambios que propusiste, así que el acuerdo queda como estaba. Si hace falta, propón otro cambio o conversen por el chat.`,
            rows: d => rows(d, [], [['Motivo', clip(d.response_note, 400)]]),
            cta: link('Ver el acuerdo'),
        }
    ),

    negotiation_proposal_withdrawn: event(
        'Negociación: propuesta retirada',
        'Aviso a la contraparte cuando quien propuso cambios (contrapropuesta o enmienda) los retira.',
        {
            audience: 'client',
            subject: d => `${actor(d)} retiró su propuesta de cambios · ${text(d.quote_id)}`,
            preheader: () => 'Ya no hay cambios pendientes de tu respuesta en esta cotización. Todo sigue como estaba.',
            eyebrow: 'COTIZACIÓN / SIN CAMBIOS PENDIENTES',
            headline: () => 'Ya no hay cambios pendientes.',
            intro: d => `${actor(d)} retiró la propuesta de cambios que te había enviado. No tienes que hacer nada: la cotización sigue como estaba.`,
            rows: d => rows(d),
            cta: link('Ver la cotización'),
        }
    ),
};

// Solo eventos como claves enumerables (el cargador recorre el objeto).
Object.defineProperty(EVENTS, '_internal', { value: { text, clip, actor, changeRows }, enumerable: false });
module.exports = EVENTS;
