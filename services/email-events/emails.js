'use strict';

// Eventos nuevos del frente "emails" (beta cerrada). Formato: README.md.

const enc = (value) => encodeURIComponent(String(value || ''));
const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || '';
const hello = (name) => (firstName(name) ? `Hola, ${firstName(name)}.` : 'Hola.');
const or = (value, fallback) => (String(value || '').trim() ? String(value).trim() : fallback);

module.exports = {
    // Inbox directo (inbox_messages vía RPC send_inbox_message) y de estudios.
    // Lo pide el navegador después del RPC; el servidor resuelve el mensaje
    // guardado, el hilo y al OTRO participante (services/email-request-context.js).
    inbox_message_received: {
        name: 'Inbox: mensaje nuevo',
        description: 'Aviso al otro participante de un hilo del inbox (artista, cliente o estudio). Máximo uno cada 15 minutos por hilo y destinatario, y no se envía si ya lo leyó.',
        templateHint: 'chat-message-client',
        recipient: p => p.recipient_email,
        attribs: p => ({
            recipient_name: p.recipient_name || '',
            sender_name: p.sender_name || '',
            thread_subject: p.thread_subject || '',
            message_preview: p.message_preview || '',
            chat_url: p.chat_url || ''
        }),
        render: {
            audience: 'artist',
            category: 'messages',
            subject: d => `${or(d.sender_name, 'Alguien')} te escribió en We Ötzi`,
            preheader: d => `Tienes un mensaje nuevo de ${or(d.sender_name, 'un contacto')} en tu inbox de We Ötzi. Responde desde la app.`,
            eyebrow: 'MENSAJE NUEVO',
            greeting: d => hello(d.recipient_name),
            headline: () => 'Tienes un mensaje nuevo',
            intro: d => `${or(d.sender_name, 'Un contacto')} te escribió${d.thread_subject ? ` sobre “${d.thread_subject}”` : ''}. Responde desde We Ötzi para mantener la conversación en un solo lugar.`,
            quote: (d, ctx) => ({ label: `Mensaje de ${or(firstName(d.sender_name), 'tu contacto')}`, text: ctx.f.text(d.message_preview, 280) }),
            rows: () => [],
            cta: (d, ctx) => ({ label: 'Responder en We Ötzi', url: ctx.f.url(d.chat_url) || ctx.url(d.recipient_role === 'client' ? '/client/chats' : d.recipient_role === 'studio' ? '/studio/dashboard' : '/artist/inbox') })
        }
    },

    // Recordatorio 24 h antes de una sesión agendada (job interno
    // lib/session-reminders.js). Un correo por destinatario (cliente y artista).
    session_reminder_24h: {
        name: 'Sesión: recordatorio 24 h',
        description: 'Recordatorio al cliente y al artista un día antes de una sesión agendada.',
        templateHint: 'session-reminder',
        serverOnly: true,
        recipients: p => [p.client_email, p.artist_email].filter(Boolean),
        recipientRoles: p => [
            { role: 'client', email: p.client_email, user_id: p.client_user_id, name: p.client_name },
            { role: 'artist', email: p.artist_email, user_id: p.artist_user_id, name: p.artist_name }
        ],
        attribs: p => ({
            artist_name: p.artist_name || '',
            client_name: p.client_name || '',
            session_date: p.session_date || '',
            quote_id: p.quote_id || '',
            dashboard_url: p.dashboard_url || ''
        }),
        render: {
            audience: 'client',
            category: 'calendar',
            subject: (d, ctx) => `Recordatorio: tu sesión es ${ctx.f.date(d.session_date) ? `el ${ctx.f.date(d.session_date).toLowerCase()}` : 'mañana'}`,
            preheader: (d, ctx) => `Tu sesión es mañana (${ctx.f.dateTime(d.session_date) || 'revisa el horario'}). Llega con todo listo.`,
            eyebrow: 'RECORDATORIO DE SESIÓN',
            headline: () => 'Tu sesión es mañana',
            rows: (d, ctx) => [
                ['Fecha', ctx.f.dateTime(d.session_date)],
                ['Sesión', d.session_number ? `N.º ${d.session_number}` : ''],
                ['Duración', d.duration_hours ? `${ctx.f.value(Number(d.duration_hours))} h` : ''],
                ['Lugar', d.location],
                ['Cotización', d.quote_id]
            ],
            roles: {
                client: {
                    greeting: d => hello(d.client_name),
                    intro: d => `Mañana tienes sesión con ${or(d.artist_name, 'tu artista')}. Descansa bien, come antes de ir y evita el alcohol el día previo. Si necesitas cambiar algo, escríbele desde el chat.`,
                    cta: (d, ctx) => ({ label: 'Ver mi cotización', url: ctx.url(`/client/dashboard?quote=${enc(d.quote_id)}`) })
                },
                artist: {
                    greeting: d => hello(d.artist_name),
                    intro: d => `Mañana tienes sesión con ${or(d.client_name, 'tu cliente')}. Revisa el diseño y el material en el expediente.`,
                    cta: (d, ctx) => ({ label: 'Abrir el expediente', url: ctx.url(`/my-quotations/detail?quote=${enc(d.quote_id)}`) })
                }
            }
        }
    }
};
