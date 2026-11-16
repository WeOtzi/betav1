'use strict';

// ===========================================================================
// Specs de render por evento (correos renderizados en el servidor)
// ---------------------------------------------------------------------------
// Formato (el mismo que usan los archivos de services/email-events/*.js en su
// clave `render`):
//   {
//     audience: 'artist'|'client'|'studio'|'admin',
//     category: 'transactional'|'quotations'|'messages'|'calendar'|'account'|'studios',
//     subject(d, ctx), preheader(d, ctx), eyebrow, headline(d, ctx), intro(d, ctx),
//     rows(d, ctx) -> [[label, value], ...], cta(d, ctx) -> {label, url} | null,
//     // opcionales: greeting, highlight, quote, note, links, linksTitle,
//     //             secondary, aside, rowsTitle,
//     roles: { artist: {...}, client: {...} }  // pisa campos según el destinatario
//   }
// `d` es el payload ya validado por el servidor; `ctx` = { role, f, url(path),
// base } (f = helpers de lib/email-format atados a la zona del destinatario).
// Reglas: nada de datos de salud ni contacto del cliente en el cuerpo; todo
// CTA es absoluto (ctx.url) y los valores se escapan en el layout.
// ===========================================================================

const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || '';
const hello = (name) => (firstName(name) ? `Hola, ${firstName(name)}.` : 'Hola.');
const or = (value, fallback) => (String(value || '').trim() ? String(value).trim() : fallback);
const enc = (value) => encodeURIComponent(String(value || ''));
// Código que lee la persona en asuntos, textos y en la fila "Cotización": el
// corto de 6 caracteres (quote_code o short_code del payload), el mismo que ve
// en pantalla; sin él, el quote_id. Los enlaces siguen armándose con quote_id.
const { visibleCode } = require('../quote-code');
const code = (d) => visibleCode(d);

function quoteRows(d, { f }, extra = []) {
    return [
        ['Cotización', code(d)],
        ['Idea', f.text(d.tattoo_description || d.tattoo_idea_description, 220)],
        ['Zona del cuerpo', d.tattoo_location || d.tattoo_body_part],
        ['Tamaño', d.tattoo_size],
        ['Estilo', f.list(d.tattoo_style)],
        ...extra
    ];
}

function clientQuoteUrl(d, ctx) {
    return ctx.url(`/client/dashboard?quote=${enc(d.quote_id)}`);
}

function artistQuoteUrl(d, ctx) {
    return ctx.url(`/my-quotations/detail?quote=${enc(d.quote_id)}`);
}

function referenceLinks(d) {
    let list = d.reference_images;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch (_) { list = []; } }
    return (Array.isArray(list) ? list : []).slice(0, 8)
        .map((item, i) => ({ label: `Referencia ${i + 1}`, url: typeof item === 'string' ? item : item && item.url }))
        .concat(d.drive_folder || d.drive_folder_url ? [{ label: 'Carpeta de referencias', url: d.drive_folder || d.drive_folder_url }] : []);
}

const SESSION_COPY = {
    session_scheduled: { eyebrow: 'SESIÓN AGENDADA', headline: 'Sesión agendada', verb: 'quedó agendada' },
    session_rescheduled: { eyebrow: 'SESIÓN REPROGRAMADA', headline: 'Cambió la fecha de la sesión', verb: 'se reprogramó' },
    session_cancelled: { eyebrow: 'SESIÓN CANCELADA', headline: 'La sesión se canceló', verb: 'se canceló' },
    session_completed: { eyebrow: 'SESIÓN COMPLETADA', headline: 'Sesión completada', verb: 'quedó registrada como completada' }
};

function sessionSpec(eventId) {
    const copy = SESSION_COPY[eventId];
    const rows = (d, ctx) => [
        ['Fecha', ctx.f.dateTime(d.session_date)],
        ['Sesión', d.session_number ? `N.º ${d.session_number}` : ''],
        ['Duración', d.duration_hours ? `${ctx.f.value(Number(d.duration_hours))} h` : ''],
        ['Lugar', d.location],
        ['Cotización', code(d)]
    ];
    return {
        audience: 'client',
        category: 'calendar',
        subject: (d, ctx) => `${copy.headline}: ${ctx.f.date(d.session_date) || `cotización ${code(d)}`}`,
        preheader: (d, ctx) => `La sesión ${ctx.f.date(d.session_date) ? `del ${ctx.f.dateTime(d.session_date)}` : `de la cotización ${code(d)}`} ${copy.verb}. Revisá los detalles en We Ötzi.`,
        eyebrow: copy.eyebrow,
        headline: () => copy.headline,
        rows,
        roles: {
            client: {
                greeting: d => hello(d.client_name),
                intro: d => `Tu sesión con ${or(d.artist_name, 'tu artista')} ${copy.verb}. Guardá los datos y, si necesitás cambiar algo, escribile desde el chat.`,
                cta: (d, ctx) => ({ label: 'Ver mi cotización', url: clientQuoteUrl(d, ctx) })
            },
            artist: {
                greeting: d => hello(d.artist_name),
                intro: d => `La sesión con ${or(d.client_name, 'tu cliente')} ${copy.verb}. Ya se refleja en tu calendario de We Ötzi.`,
                cta: (d, ctx) => ({ label: 'Abrir mi calendario', url: ctx.url('/calendar') })
            }
        }
    };
}

const SPECS = {
    // ===== Registro =====
    artist_registration_completed: {
        audience: 'artist',
        category: 'account',
        subject: () => 'Te damos la bienvenida a We Ötzi',
        preheader: () => 'Tu perfil de artista ya está creado. Completalo y empezá a recibir solicitudes de tatuaje.',
        eyebrow: 'REGISTRO DE ARTISTA',
        greeting: d => hello(d.artistic_name || d.name),
        headline: () => 'Tu perfil está listo',
        intro: () => 'Recibimos tu registro. Entrá a tu panel con el email y la contraseña que elegiste para completar tu perfil, cargar tu galería y responder solicitudes.',
        rows: (d, { f }) => [
            ['Usuario', d.username ? `@${String(d.username).replace(/^@+/, '')}` : ''],
            ['Estilos', f.list(d.styles_text || d.styles_array)],
            ['Ciudad', [d.city, d.country].filter(Boolean).join(', ')],
            ['Estudio', d.studio]
        ],
        cta: (d, ctx) => ({ label: 'Abrir mi panel', url: ctx.url('/artist/dashboard') }),
        secondary: d => (d.profile_url ? { label: 'Ver mi perfil público', url: d.profile_url } : null)
    },
    client_registration_completed: {
        audience: 'client',
        category: 'account',
        subject: () => 'Tu cuenta de We Ötzi está lista',
        preheader: () => 'Desde tu cuenta seguís tus cotizaciones, mensajes y sesiones con tus artistas.',
        eyebrow: 'REGISTRO DE CLIENTE',
        greeting: d => hello(d.full_name),
        headline: () => 'Tu cuenta está lista',
        intro: () => 'Creamos tu acceso a We Ötzi. Desde tu cuenta podés seguir tus cotizaciones, conversar con tus artistas y ver tus sesiones.',
        rows: d => [['Email', d.email], ['Cotización', d.quote_id && d.quote_id !== '-' ? code(d) : '']],
        cta: (d, ctx) => ({ label: 'Entrar a mi cuenta', url: ctx.url('/client/dashboard') })
    },
    password_reset_temp: {
        audience: 'client',
        category: 'transactional',
        subject: () => 'Tu contraseña temporal de We Ötzi',
        preheader: () => 'Usá esta contraseña temporal para entrar y cambiala apenas ingreses a tu cuenta.',
        eyebrow: 'SEGURIDAD DE LA CUENTA',
        headline: () => 'Tu contraseña temporal',
        intro: () => 'Usá esta contraseña para entrar y cambiala desde tu cuenta apenas ingreses.',
        highlight: d => ({ label: 'Contraseña temporal', value: d.temp_password, spacing: 2, size: 26 }),
        note: () => 'No compartas esta contraseña con nadie. Nadie del equipo de We Ötzi te la va a pedir.',
        rows: () => [],
        cta: (d, ctx) => ({ label: 'Iniciar sesión', url: ctx.f.url(d.login_url) || ctx.url(d.user_type === 'artist' ? '/artist/login' : '/client/login') })
    },

    // ===== Cotizaciones =====
    client_quotation_submitted: {
        audience: 'client',
        category: 'transactional',
        subject: d => `Recibimos tu solicitud ${or(code(d), '')}`.trim(),
        preheader: d => `Enviamos tu idea a ${or(d.artist_name, 'tu artista')}. Te avisamos por email cuando responda.`,
        eyebrow: 'SOLICITUD ENVIADA',
        headline: () => 'Tu solicitud fue enviada',
        rows: (d, ctx) => quoteRows(d, ctx, [['Presupuesto', ctx.f.money(d.client_budget_amount, d.client_budget_currency)]]),
        roles: {
            client: {
                greeting: d => hello(d.client_name),
                intro: d => `Enviamos tu idea a ${or(d.artist_name, 'tu artista')}. Te avisamos por email cuando responda; mientras tanto podés seguir la solicitud desde tu cuenta.`,
                cta: (d, ctx) => ({ label: 'Seguir mi solicitud', url: d.client_user_id ? clientQuoteUrl(d, ctx) : ctx.url('/client/register') }),
                secondary: (d, ctx) => (d.client_user_id ? null : { label: '¿Ya tenés cuenta? Iniciá sesión', url: ctx.url('/client/login') })
            },
            // Sin rol artist: el artista recibe artist_new_quotation /
            // quotation_artist_selected / booking_slot_requested (EMAIL-DUP-01).
            admin: {
                subject: d => `Nueva cotización ${or(code(d), '')}`.trim(),
                preheader: d => `Se registró una solicitud nueva de ${or(d.client_name, 'un cliente')} para ${or(d.artist_name, 'un artista')}.`,
                eyebrow: 'ADMIN · COTIZACIÓN',
                headline: () => 'Nueva cotización en el sistema',
                intro: d => `${or(d.client_name, 'Un cliente')} envió una solicitud a ${or(d.artist_name, 'un artista')}.`,
                cta: (d, ctx) => ({ label: 'Abrir el backoffice', url: ctx.url('/backoffice') })
            }
        }
    },
    artist_responded_quotation: {
        audience: 'client',
        category: 'quotations',
        subject: d => `${or(d.artist_name, 'Tu artista')} respondió tu solicitud`,
        preheader: d => `Ya tenés la propuesta de ${or(d.artist_name, 'tu artista')}: presupuesto, sesiones estimadas y mensaje.`,
        eyebrow: 'PROPUESTA DEL ARTISTA',
        greeting: d => hello(d.client_name),
        headline: () => 'Tenés una propuesta',
        intro: d => `${or(d.artist_name, 'Tu artista')} revisó tu idea y te mandó su propuesta. Revisala y aprobala o respondele desde tu cuenta.`,
        quote: (d, { f }) => ({ label: `Mensaje de ${or(firstName(d.artist_name), 'tu artista')}`, text: f.text(d.message_preview, 400) }),
        rows: (d, ctx) => [
            ['Presupuesto', ctx.f.money(d.artist_budget_amount, d.artist_budget_currency)],
            ['Sesiones estimadas', d.estimated_sessions],
            ['Vence', d.quote_expiry_enabled ? ctx.f.date(d.quote_expires_at) : ''],
            ['Cotización', code(d)]
        ],
        cta: (d, ctx) => ({ label: 'Ver la propuesta', url: clientQuoteUrl(d, ctx) })
    },
    client_approved_quotation: {
        audience: 'artist',
        category: 'quotations',
        subject: d => `${or(firstName(d.client_name), 'Tu cliente')} aprobó tu propuesta`,
        preheader: d => `La cotización ${or(code(d), '')} avanzó. Coordiná la agenda y confirmá los detalles finales.`,
        eyebrow: 'PROPUESTA APROBADA',
        greeting: d => hello(d.artist_name),
        headline: () => 'Tu propuesta fue aprobada',
        intro: d => `${or(d.client_name, 'Tu cliente')} aprobó tu propuesta. Coordiná la sesión y confirmá los detalles desde el expediente.`,
        rows: (d, ctx) => quoteRows(d, ctx, [['Presupuesto', ctx.f.money(d.artist_budget_amount, d.artist_budget_currency)]]),
        cta: (d, ctx) => ({ label: 'Abrir el expediente', url: artistQuoteUrl(d, ctx) })
    },
    client_rejected_quotation: {
        audience: 'artist',
        category: 'quotations',
        subject: d => `${or(firstName(d.client_name), 'Tu cliente')} no aprobó la propuesta`,
        preheader: d => `La cotización ${or(code(d), '')} se cerró sin aprobación. El historial queda en tu panel.`,
        eyebrow: 'PROPUESTA NO APROBADA',
        greeting: d => hello(d.artist_name),
        headline: () => 'La propuesta no fue aprobada',
        intro: d => `${or(d.client_name, 'Tu cliente')} decidió no avanzar con esta cotización. Conservamos el historial por si querés revisarlo.`,
        rows: (d, ctx) => quoteRows(d, ctx),
        cta: (d, ctx) => ({ label: 'Ver la cotización', url: artistQuoteUrl(d, ctx) })
    },
    artist_rejected_quotation: {
        audience: 'client',
        category: 'quotations',
        subject: d => `${or(d.artist_name, 'El artista')} no puede tomar tu solicitud`,
        preheader: () => 'Esta vez el artista no puede tomar tu idea. Podés buscar otro artista o publicarla en el Job Board.',
        eyebrow: 'SOLICITUD SIN CUPO',
        greeting: d => hello(d.client_name),
        headline: () => 'El artista no va a tomar tu solicitud',
        intro: d => `${or(d.artist_name, 'El artista')} revisó tu idea y esta vez no puede tomarla. Podés buscar otro artista o publicar tu idea en el Job Board para recibir propuestas.`,
        rows: (d, ctx) => quoteRows(d, ctx),
        cta: (d, ctx) => ({ label: 'Ver mis cotizaciones', url: ctx.url('/client/dashboard') }),
        secondary: (d, ctx) => ({ label: 'Explorar artistas', url: ctx.url('/explore') })
    },
    quotation_ready_for_client: {
        audience: 'client',
        category: 'quotations',
        subject: () => 'Tu tatuaje está listo para revisar',
        preheader: d => `${or(d.artist_name, 'Tu artista')} marcó el trabajo como terminado. Revisalo y confirmá la entrega.`,
        eyebrow: 'ENTREGA LISTA',
        greeting: d => hello(d.client_name),
        headline: () => 'Tu tatuaje está listo para revisar',
        intro: d => `${or(d.artist_name, 'Tu artista')} marcó el trabajo como terminado. Entrá a tu cuenta para revisarlo y aprobar la entrega, o contale qué hay que ajustar.`,
        rows: (d, ctx) => quoteRows(d, ctx),
        cta: (d, ctx) => ({ label: 'Revisar la entrega', url: clientQuoteUrl(d, ctx) })
    },
    dispute_artist_response: {
        audience: 'client',
        category: 'transactional',
        subject: () => 'El artista respondió la disputa',
        preheader: d => `${or(d.artist_name, 'El artista')} dejó su respuesta a la disputa de la cotización ${or(code(d), '')}.`,
        eyebrow: 'DISPUTA · RESPUESTA',
        greeting: d => hello(d.client_name),
        headline: () => 'El artista respondió la disputa',
        intro: d => `${or(d.artist_name, 'El artista')} dejó su respuesta. Soporte de We Ötzi también la recibe para acompañar la resolución.`,
        quote: (d, { f }) => ({ label: 'Respuesta del artista', text: f.text(d.artist_response, 600) }),
        rows: d => [['Disputa', d.dispute_title], ['Cotización', code(d)]],
        cta: (d, ctx) => ({ label: 'Ver la respuesta', url: clientQuoteUrl(d, ctx) }),
        roles: {
            support: {
                greeting: () => 'Hola, equipo de soporte.',
                intro: d => `${or(d.artist_name, 'El artista')} respondió la disputa de ${or(d.client_name, 'un cliente')}.`,
                cta: (d, ctx) => ({ label: 'Abrir soporte', url: ctx.url('/support/dashboard') })
            }
        }
    },
    quotation_expired: {
        audience: 'client',
        category: 'quotations',
        subject: d => `La propuesta de ${or(d.artist_name, 'tu artista')} venció`,
        preheader: () => 'La propuesta venció sin respuesta. Si todavía te interesa, escribile al artista o pedí una nueva.',
        eyebrow: 'PROPUESTA VENCIDA',
        greeting: d => hello(d.client_name),
        headline: () => 'La propuesta venció',
        intro: d => `La propuesta de ${or(d.artist_name, 'tu artista')} venció sin respuesta. Si todavía te interesa, escribile o pedí una nueva cotización desde tu cuenta.`,
        rows: (d, { f }) => [['Cotización', code(d)], ['Venció', f.date(d.expired_at)]],
        cta: (d, ctx) => ({ label: 'Ir a mi cuenta', url: d.quote_id ? clientQuoteUrl(d, ctx) : ctx.url('/client/dashboard') })
    },
    quotation_completed_summary: {
        audience: 'client',
        category: 'quotations',
        subject: d => `Cotización ${or(code(d), '')} completada`.replace(/\s+/g, ' '),
        preheader: () => 'El trabajo quedó cerrado. Te dejamos el resumen final con monto, sesiones y fecha.',
        eyebrow: 'COTIZACIÓN COMPLETADA',
        headline: () => 'Trabajo completado',
        rows: (d, ctx) => [
            ['Cotización', code(d)],
            ['Monto final', ctx.f.money(d.final_budget_amount || d.artist_budget_amount, d.final_budget_currency || d.artist_budget_currency)],
            ['Sesiones', d.final_sessions || d.estimated_sessions],
            ['Completada', ctx.f.date(d.client_completed_at)]
        ],
        roles: {
            client: {
                greeting: d => hello(d.client_name),
                intro: d => `Confirmaste la entrega de ${or(d.artist_name, 'tu artista')}. Gracias por confiar en We Ötzi.`,
                cta: (d, ctx) => ({ label: 'Ver mi cotización', url: clientQuoteUrl(d, ctx) })
            },
            artist: {
                greeting: d => hello(d.artist_name),
                intro: d => `${or(d.client_name, 'Tu cliente')} confirmó la entrega. La cotización quedó completada en tu panel.`,
                cta: (d, ctx) => ({ label: 'Abrir el expediente', url: artistQuoteUrl(d, ctx) })
            }
        }
    },
    client_left_rating: {
        audience: 'artist',
        category: 'quotations',
        subject: () => 'Recibiste una nueva reseña',
        preheader: d => `${or(firstName(d.client_name), 'Un cliente')} calificó tu trabajo. La reseña se publica después de la moderación.`,
        eyebrow: 'NUEVA RESEÑA',
        greeting: d => hello(d.artist_name),
        headline: () => 'Un cliente calificó tu trabajo',
        intro: d => `${or(d.client_name, 'Un cliente')} dejó una reseña sobre su experiencia. Soporte la revisa antes de publicarla en tu perfil.`,
        quote: (d, { f }) => ({ label: 'Comentario', text: f.text(d.rating_comment, 400) }),
        rows: d => [['Calificación', d.rating ? `${d.rating} / 5` : ''], ['Cotización', code(d)]],
        cta: (d, ctx) => ({ label: 'Ver mi perfil', url: ctx.url('/artist/dashboard') })
    },
    request_rating: {
        audience: 'client',
        category: 'quotations',
        subject: d => `¿Cómo fue tu experiencia con ${or(d.artist_name, 'tu artista')}?`,
        preheader: () => 'Tu reseña ayuda a cuidar la comunidad y a que otras personas elijan con más información.',
        eyebrow: 'TU EXPERIENCIA',
        greeting: d => hello(d.client_name),
        headline: () => 'Contanos cómo te fue',
        intro: d => `Tu trabajo con ${or(d.artist_name, 'tu artista')} quedó completado. Dejar una reseña lleva un minuto y ayuda a otras personas a elegir.`,
        rows: d => [['Cotización', code(d)]],
        cta: (d, ctx) => ({ label: 'Dejar mi reseña', url: ctx.url(`/client/dashboard?quote=${enc(d.quote_id)}&review=1`) })
    },

    // ===== Job Board =====
    job_board_request_created: {
        audience: 'client',
        category: 'quotations',
        subject: () => 'Tu idea ya está en el Job Board',
        preheader: () => 'Tu solicitud quedó publicada para artistas compatibles. Te avisamos cuando lleguen postulaciones.',
        eyebrow: 'JOB BOARD · PUBLICADA',
        greeting: d => hello(d.client_name),
        headline: () => 'Tu solicitud fue publicada',
        intro: () => 'Tu idea quedó disponible para artistas compatibles. Te avisamos cuando lleguen postulaciones.',
        rows: (d, ctx) => [
            ['Código', d.request_code || d.display_code],
            ['Idea', ctx.f.text(d.tattoo_idea_description, 220)],
            ['Zona del cuerpo', d.tattoo_body_part],
            ['Presupuesto', [ctx.f.money(d.budget_min || d.client_budget_min, ''), ctx.f.money(d.budget_max || d.client_budget_max, '')].filter(Boolean).join(' – ') + (d.budget_currency || d.client_budget_currency ? ` ${d.budget_currency || d.client_budget_currency}` : '')]
        ].map(([k, v]) => [k, String(v || '').trim()]),
        cta: (d, ctx) => ({ label: 'Ver mi solicitud', url: ctx.url('/client/requests') })
    },
    job_board_application_received: {
        audience: 'client',
        category: 'quotations',
        subject: d => `${or(d.artist_name, 'Un artista')} se postuló a tu idea`,
        preheader: () => 'Un artista quiere tomar tu solicitud. Revisá su propuesta, precio estimado y mensaje.',
        eyebrow: 'JOB BOARD · POSTULACIÓN',
        greeting: d => hello(d.client_name),
        headline: () => 'Tenés una nueva postulación',
        intro: d => `${or(d.artist_name, 'Un artista')} quiere tomar tu solicitud. Revisá su propuesta antes de decidir.`,
        quote: (d, { f }) => ({ label: 'Mensaje del artista', text: f.text(d.message_preview || d.message, 400) }),
        rows: (d, ctx) => [
            ['Precio estimado', ctx.f.money(d.estimated_price, d.budget_currency)],
            ['Sesiones estimadas', d.estimated_sessions],
            ['Código', d.request_code]
        ],
        cta: (d, ctx) => ({ label: 'Ver postulaciones', url: ctx.url('/client/requests') })
    },
    job_board_application_accepted: {
        audience: 'artist',
        category: 'quotations',
        subject: () => 'Aceptaron tu postulación',
        preheader: d => `${or(firstName(d.client_name), 'El cliente')} eligió avanzar con vos. Coordiná los próximos pasos.`,
        eyebrow: 'JOB BOARD · ACEPTADA',
        greeting: d => hello(d.artist_name),
        headline: () => 'Tu postulación fue aceptada',
        intro: d => `${or(d.client_name, 'El cliente')} eligió avanzar con vos. La solicitud ya es una cotización en tu panel.`,
        rows: d => [['Código', d.request_code], ['Cotización', code(d)]],
        cta: (d, ctx) => ({ label: 'Abrir la cotización', url: d.quote_id ? artistQuoteUrl(d, ctx) : ctx.url('/artist/applications') })
    },
    job_board_application_rejected: {
        audience: 'artist',
        category: 'quotations',
        subject: () => 'Actualización de tu postulación',
        preheader: () => 'Esta vez la solicitud siguió otro camino. Hay más ideas esperando en el Job Board.',
        eyebrow: 'JOB BOARD · CIERRE',
        greeting: d => hello(d.artist_name),
        headline: () => 'Esta vez no fue seleccionada',
        intro: () => 'La solicitud siguió otro camino. Mantener tu portafolio actualizado ayuda en las próximas oportunidades.',
        rows: d => [['Código', d.request_code]],
        cta: (d, ctx) => ({ label: 'Ver el Job Board', url: ctx.url('/job-board') })
    },

    // ===== Chat =====
    chat_message_to_artist: {
        audience: 'artist',
        category: 'messages',
        subject: d => `${or(firstName(d.client_name), 'Tu cliente')} te escribió`,
        preheader: d => `Tenés un mensaje nuevo de ${or(d.client_name, 'tu cliente')} sobre la cotización ${or(code(d), '')}.`,
        eyebrow: 'MENSAJE NUEVO',
        greeting: d => hello(d.artist_name),
        headline: () => 'Tenés un mensaje nuevo',
        intro: d => `${or(d.client_name, 'Tu cliente')} te escribió sobre su cotización. Respondé desde We Ötzi para mantener todo el historial en un solo lugar.`,
        quote: (d, { f }) => ({ label: `Mensaje de ${or(firstName(d.client_name), 'tu cliente')}`, text: f.text(d.message_preview, 280) }),
        rows: d => [['Cotización', code(d)]],
        cta: (d, ctx) => ({ label: 'Responder en We Ötzi', url: ctx.f.url(d.chat_url) || ctx.url(`/artist/inbox?quote=${enc(d.quote_id)}`) })
    },
    chat_message_to_client: {
        audience: 'client',
        category: 'messages',
        subject: d => `${or(d.artist_name, 'Tu artista')} te escribió`,
        preheader: d => `Tenés un mensaje nuevo de ${or(d.artist_name, 'tu artista')} sobre tu cotización ${or(code(d), '')}.`,
        eyebrow: 'MENSAJE NUEVO',
        greeting: d => hello(d.client_name),
        headline: () => 'Tenés un mensaje nuevo',
        intro: d => `${or(d.artist_name, 'Tu artista')} te escribió sobre tu cotización. Respondé desde We Ötzi para mantener todo el historial en un solo lugar.`,
        quote: (d, { f }) => ({ label: `Mensaje de ${or(firstName(d.artist_name), 'tu artista')}`, text: f.text(d.message_preview, 280) }),
        rows: d => [['Cotización', code(d)]],
        cta: (d, ctx) => ({ label: 'Responder en We Ötzi', url: ctx.f.url(d.chat_url) || ctx.url(`/client/chats?quote=${enc(d.quote_id)}`) })
    },

    // ===== Sesiones =====
    session_scheduled: sessionSpec('session_scheduled'),
    session_rescheduled: sessionSpec('session_rescheduled'),
    session_cancelled: sessionSpec('session_cancelled'),
    session_completed: sessionSpec('session_completed'),

    // ===== Calendario =====
    artist_calendar_reminder: {
        audience: 'artist',
        category: 'calendar',
        subject: d => `Recordatorio: ${or(d.reminder_title, 'tenés un recordatorio')}`,
        preheader: d => `${or(d.reminder_title, 'Recordatorio')} · ${or(d.reminder_when, 'hoy')}. Lo agendaste en tu calendario de We Ötzi.`,
        eyebrow: 'RECORDATORIO',
        greeting: d => hello(d.artist_name),
        headline: d => or(d.reminder_title, 'Tenés un recordatorio'),
        intro: () => 'Lo agendaste en tu calendario de We Ötzi.',
        rows: d => [['Cuándo', d.reminder_when], ['Notas', d.reminder_detail && d.reminder_detail !== '-' ? d.reminder_detail : '']],
        cta: (d, ctx) => ({ label: 'Abrir mi calendario', url: ctx.f.url(d.dashboard_url) || ctx.url('/calendar') })
    },

    // ===== Verificación =====
    profile_verified: {
        audience: 'artist',
        category: 'account',
        subject: () => 'Tu perfil está verificado',
        preheader: () => 'Tu perfil ya muestra la insignia de verificación de We Ötzi. Los clientes lo van a ver en tu perfil.',
        eyebrow: 'VERIFICACIÓN APROBADA',
        greeting: d => hello(d.artist_name || d.name),
        headline: () => 'Tu perfil fue verificado',
        intro: () => 'Revisamos tu documentación y tu perfil ya muestra la insignia de verificación de We Ötzi.',
        rows: () => [],
        cta: (d, ctx) => ({ label: 'Ver mi cuenta', url: ctx.url('/artist/account#verificacion') })
    },
    profile_verification_denied: {
        audience: 'artist',
        category: 'account',
        subject: () => 'Necesitamos revisar tu verificación',
        preheader: () => 'No pudimos verificar tu perfil con la información actual. Revisá el motivo y volvé a enviarla.',
        eyebrow: 'VERIFICACIÓN',
        greeting: d => hello(d.artist_name || d.name),
        headline: () => 'Necesitamos ajustar tu verificación',
        intro: () => 'No pudimos verificar tu perfil con la información actual. Revisá el motivo, corregí lo pendiente y volvé a enviarla desde tu cuenta.',
        quote: (d, { f }) => ({ label: 'Motivo', text: f.text(d.reason, 500) }),
        rows: () => [],
        cta: (d, ctx) => ({ label: 'Revisar mi verificación', url: ctx.url('/artist/account#verificacion') })
    },
    instagram_verification_code: {
        audience: 'artist',
        category: 'transactional',
        subject: () => 'Tu código para validar Instagram',
        preheader: d => `Mandá el código ${or(d.verification_code, '')} por mensaje directo a ${or(d.weotzi_instagram, '@weotzi')} para validar tu cuenta.`,
        eyebrow: 'VALIDACIÓN DE INSTAGRAM',
        greeting: d => hello(d.artist_name),
        headline: () => 'Tu código para validar Instagram',
        intro: d => `Desde ${or(d.instagram_handle, 'tu cuenta de Instagram')}, seguí a ${or(d.weotzi_instagram, '@weotzi')} y mandanos este código por mensaje directo.`,
        highlight: d => ({ label: 'Tu código', value: d.verification_code, note: `Vence en ${or(d.expires_label, '72 horas')}.` }),
        note: () => 'Si no pediste este código, ignorá este correo.',
        rows: () => [],
        cta: (d, ctx) => ({ label: 'Abrir mensaje directo', url: ctx.f.url(d.dm_url) || 'https://ig.me/m/weotzi' })
    },
    artist_support_decision: {
        audience: 'artist',
        category: 'account',
        subject: d => `Soporte: ${or(d.decision_title, 'revisamos tu cuenta')}`,
        preheader: d => `${or(d.decision_title, 'Soporte revisó tu cuenta')}. Te contamos el detalle y los próximos pasos.`,
        eyebrow: 'REVISIÓN DE SOPORTE',
        greeting: d => hello(d.artist_name),
        headline: () => 'Soporte revisó tu cuenta',
        intro: d => [d.decision_title, d.decision_detail].filter(Boolean).join('. '),
        quote: (d, { f }) => ({ label: 'Nota de soporte', text: d.support_note && d.support_note !== '-' ? f.text(d.support_note, 500) : '' }),
        rows: d => [['Referencia', d.support_reference && d.support_reference !== '-' ? d.support_reference : '']],
        cta: (d, ctx) => ({ label: 'Ver mi cuenta', url: ctx.f.url(d.dashboard_url) || ctx.url('/artist/account') })
    },
    ambassador_status_updated: {
        audience: 'artist',
        category: 'account',
        subject: () => 'Actualizamos tu estado de embajador',
        preheader: () => 'Hay novedades sobre tu participación en el programa de embajadores de We Ötzi.',
        eyebrow: 'PROGRAMA DE EMBAJADORES',
        greeting: d => hello(d.artist_name || d.name),
        headline: () => 'Tu estado de embajador cambió',
        intro: () => 'Actualizamos tu estado dentro del programa de embajadores. Revisalo desde tu panel.',
        rows: d => [['Estado', d.ambassador_status]],
        cta: (d, ctx) => ({ label: 'Abrir mi panel', url: ctx.url('/artist/dashboard') })
    },

    // ===== Estudios =====
    studio_roster_invite: {
        audience: 'artist',
        category: 'studios',
        subject: d => or(d.subject, `${or(d.studio_name, 'Un estudio')} te invitó a su equipo`),
        preheader: d => `${or(d.studio_name, 'Un estudio')} te invitó a su roster en We Ötzi. Aceptá o rechazá la invitación desde tu panel.`,
        eyebrow: 'INVITACIÓN DE ESTUDIO',
        greeting: d => hello(d.recipient_name),
        headline: d => `${or(d.studio_name, 'Un estudio')} te invitó a su equipo`,
        intro: d => d.body_text || `${or(d.studio_name, 'Un estudio')} te invitó a su roster en We Ötzi.`,
        rows: d => [['Estudio', d.studio_name]],
        cta: (d, ctx) => ({ label: 'Ver la invitación', url: ctx.f.url(d.links && d.links.invitations) || ctx.url('/artist/invitations') })
    },
    studio_spot_decision: {
        audience: 'artist',
        category: 'studios',
        subject: d => or(d.subject, `Actualización de tu postulación a ${or(d.studio_name, 'un estudio')}`),
        preheader: d => `${or(d.studio_name, 'El estudio')} respondió tu postulación. Revisá el detalle en We Ötzi.`,
        eyebrow: 'POSTULACIÓN A ESTUDIO',
        greeting: d => hello(d.recipient_name),
        headline: d => (d.decision === 'accepted' ? `${or(d.studio_name, 'El estudio')} aceptó tu postulación` : 'Tu postulación tuvo respuesta'),
        intro: d => d.body_text || '',
        rows: d => [['Estudio', d.studio_name], ['Decisión', d.decision === 'accepted' ? 'Aceptada' : d.decision === 'rejected' ? 'No seleccionada' : '']],
        cta: (d, ctx) => (d.decision === 'accepted'
            ? { label: 'Ver mis estudios', url: ctx.f.url(d.links && d.links.invitations) || ctx.url('/artist/invitations') }
            : { label: 'Ver otros spots', url: ctx.f.url(d.links && d.links.spots_directory) || ctx.url('/studio-spots') })
    },

    // ===== Cuenta / producto =====
    platform_update: {
        audience: 'artist',
        category: 'account',
        subject: d => or(d.subject, 'Novedades en We Ötzi'),
        preheader: () => 'Sumamos mejoras para que gestionar tu perfil, tus solicitudes y tu comunidad sea más simple.',
        eyebrow: 'NOVEDADES',
        greeting: d => hello(d.recipient_name || d.name),
        headline: d => or(d.headline, 'Novedades en We Ötzi'),
        intro: d => or(d.intro, 'Sumamos mejoras para que gestionar tu perfil, tus solicitudes y tu comunidad sea más simple.'),
        rows: d => [1, 2, 3].map(i => [d[`feature_${i}_title`], d[`feature_${i}_description`]]),
        cta: (d, ctx) => ({ label: 'Entrar a We Ötzi', url: ctx.url(d.user_type === 'client' ? '/client/dashboard' : '/artist/dashboard') })
    }
};

// ── borrado ── un spec para los 4 estados de baja de cuenta.
const accountDeletion = {
    audience: 'client',
    category: 'transactional',
    subject: d => `We Ötzi: ${or(d.status_title, 'actualizamos tu solicitud de baja')}`,
    preheader: d => `${capital(or(d.status_title, 'actualizamos tu solicitud de baja'))}. Te contamos el detalle y los próximos pasos.`,
    eyebrow: 'BAJA DE CUENTA',
    greeting: d => hello(d.user_name && d.user_name !== '-' ? d.user_name : ''),
    headline: d => capital(or(d.status_title, 'Tu solicitud de baja')),
    intro: d => d.status_detail || '',
    quote: (d, { f }) => ({ label: 'Nota de soporte', text: d.support_note && d.support_note !== '-' ? f.text(d.support_note, 500) : '' }),
    rows: d => [['Solicitud', d.request_reference && d.request_reference !== '-' ? d.request_reference : '']],
    cta: (d, ctx) => ({ label: 'Ver mi cuenta', url: ctx.f.url(d.account_url) || ctx.url('/') })
};
function capital(text) { return text ? text.charAt(0).toUpperCase() + text.slice(1) : text; }
for (const id of ['account_deletion_received', 'account_deletion_approved', 'account_deletion_rejected', 'account_deletion_completed']) {
    SPECS[id] = accountDeletion;
}

module.exports = { SPECS, helpers: { firstName, hello, or, enc, quoteRows, clientQuoteUrl, artistQuoteUrl, referenceLinks } };
