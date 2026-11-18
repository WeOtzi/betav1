'use strict';

// ===========================================================================
// Eventos de email del frente "diseños" (fase 2 · huellas de imágenes).
// Los carga solo services/email-events/index.js. Es serverOnly: lo dispara
// lib/routes/disenos.js cuando soporte elige «Retirar» en una alerta de
// imagen duplicada, con clave de idempotencia portfolio_item_removed:<alert_id>.
//   · portfolio_item_removed → el artista o el estudio que subió la foto
//
// Privacidad: el correo no nombra a la otra cuenta ni muestra la imagen
// anterior; solo cuenta qué pasó, el motivo que escribió soporte y cómo
// responder o apelar.
// ===========================================================================

const text = (value) => (value == null ? '' : String(value).trim());
const greeting = (d) => (text(d.recipient_name) ? `Hola, ${text(d.recipient_name)}.` : 'Hola.');

module.exports = {
    portfolio_item_removed: {
        name: 'Foto retirada del portafolio',
        description: 'Aviso al artista o al estudio cuando soporte retira una foto de su portafolio porque coincide con un trabajo anterior de otro artista: el motivo y cómo responder o apelar.',
        serverOnly: true,
        recipient: (p) => p.recipient_email,
        attribs: (p) => ({
            recipient_name: text(p.recipient_name),
            recipient_role: text(p.recipient_role),
            reason_note: text(p.reason_note),
            source_label: text(p.source_label),
            removed_at: text(p.removed_at)
        }),
        render: {
            audience: 'artist',
            category: 'transactional',
            subject: () => 'Retiramos una foto de tu portafolio',
            preheader: () => 'Soporte quitó una foto que coincide con un trabajo anterior de otro artista. Te contamos por qué.',
            eyebrow: 'Seguridad de la cuenta',
            greeting,
            headline: () => 'Retiramos una foto de tu portafolio',
            intro: () => 'Nuestro equipo de soporte quitó una foto de tu portafolio porque coincide con un trabajo que otro artista publicó antes en We Ötzi. El resto de tu perfil sigue igual: retirar una foto no es una sanción.',
            rows: (d) => [
                ['Motivo', text(d.reason_note)],
                ['Dónde estaba', text(d.source_label)],
                ['Fecha', text(d.removed_at)]
            ],
            note: () => 'Si la foto es tuya o tienes permiso para publicarla, responde a este correo o escríbenos a soporte@weotzi.com con lo que lo demuestre (por ejemplo, el archivo original o el permiso del autor). Revisamos cada caso y, si corresponde, la volvemos a publicar.',
            cta: (d, ctx) => ({ label: 'Ir a mi panel', url: ctx.url('/artist/dashboard') }),
            secondary: (d, ctx) => ({ label: 'Cómo cuidamos el plagio', url: ctx.url('/seguridad#plagio') }),
            roles: {
                studio: {
                    intro: () => 'Nuestro equipo de soporte quitó una foto de las fotos de tu estudio porque coincide con un trabajo que otro artista publicó antes en We Ötzi. El resto del perfil del estudio sigue igual: retirar una foto no es una sanción.',
                    cta: (d, ctx) => ({ label: 'Ir al panel del estudio', url: ctx.url('/studio/dashboard') })
                }
            }
        }
    }
};
