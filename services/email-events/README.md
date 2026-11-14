# Eventos de email por frente

Cada frente agrega sus correos nuevos en **un archivo propio** de este directorio
(`services/email-events/<frente>.js`). No hace falta editar
`services/email-event-mapping.js` ni la plantilla: el mapeo, el render y la lista
de eventos solo-servidor cargan automáticamente todos los `*.js` de acá
(salvo `index.js`), en orden alfabético.

```js
// services/email-events/estudios.js
module.exports = {
    studio_membership_request_created: {
        name: 'Estudio: solicitud de tatuador',
        description: 'Aviso al estudio cuando un tatuador pide sumarse.',
        templateHint: 'studio-notification',      // opcional (plantilla n8n/BillionMail)
        serverOnly: true,                          // solo lo dispara el servidor
        recipient: p => p.studio_email,            // o recipients: p => [...]
        // recipientRoles: p => [{ role: 'client', email: p.client_email }, ...]  // un correo por rol
        attribs: p => ({ studio_name: p.studio_name }), // variables para n8n/BillionMail (lista blanca)
        render: {
            audience: 'studio',                    // artist | client | studio | admin
            category: 'studios',                   // transactional | quotations | messages | calendar | account | studios
            subject: d => `Nueva solicitud de ${d.artist_name}`,
            preheader: d => `${d.artist_name} quiere sumarse a ${d.studio_name}. Revisá su perfil y respondé.`, // 40–110 caracteres
            eyebrow: 'SOLICITUD DE TATUADOR',
            headline: d => 'Tenés una solicitud nueva',
            intro: d => `${d.artist_name} quiere sumarse a tu estudio.`,
            rows: d => [['Tatuador', d.artist_name], ['Fecha', d.created_at]], // ISO → fecha en español, vacíos se omiten
            cta: (d, ctx) => ({ label: 'Revisar solicitud', url: ctx.url('/studio/dashboard') }) // siempre absoluto
        }
    }
};
```

Para enviarlo desde el servidor:

```js
const { sendEmail } = require('../services/email-service');
await sendEmail('studio_membership_request_created', payload, { idempotencyKey: `membership:${id}` });
```

Reglas:

- **Escape**: el layout escapa todos los valores; no armes HTML en los specs.
- **Links**: `ctx.url('/ruta')` arma la URL absoluta con `PUBLIC_APP_URL`
  (fallback `https://beta.weotzi.com`). Las URLs que vienen en el payload se
  validan (solo `https:`).
- **Fechas, montos y booleanos**: usá `ctx.f.dateTime(v)`, `ctx.f.money(monto, moneda)`,
  `ctx.f.bool(v)`; las filas formatean solas ISO, `true/false` y listas.
- **Privacidad**: nunca datos de salud, alergias, fecha de nacimiento ni
  contacto del cliente en el cuerpo del correo.
- **Canal**: si el evento no tiene webhook propio en `app_settings.n8n_events`,
  sale por el relé genérico (`smtp_relay`, ver `docs/N8N_EMAIL_WEBHOOKS.md`).
  `email_routing` permite elegir el canal por evento.
- Un id repetido en dos archivos se ignora en el segundo (queda un warning).
- Tests: `tests/email-render.test.js` renderiza todos los eventos con `render`
  y verifica escape, CTA absoluto, preheader, tamaño y formato.
