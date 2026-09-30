# Correo transaccional — 21 de septiembre de 2026

El cliente web envía los eventos a `/api/email/:eventId` (también `/beta/api/email/:eventId`). El servidor obtiene los destinatarios y datos de los registros guardados. Las notificaciones de cotizaciones, sesiones, mensajes y Job Board comprueban que la sesión pertenece al artista o cliente correspondiente. Los eventos administrativos exigen superadministrador.

Las confirmaciones de una cotización pública pueden solicitarse sin sesión durante los primeros 30 minutos: el email debe coincidir con el registro y el servidor utiliza únicamente los datos persistidos. Una clave derivada de ese registro permite un único envío. Las bienvenidas requieren sesión y perfil; no incluyen contraseñas.

Si la confirmación de email impide iniciar sesión al registrarse, el cliente conserva un marcador de bienvenida pendiente (sólo ID de usuario). El primer login autenticado reintenta esa bienvenida y lo elimina cuando se confirma el envío. La identidad recibida y el ledger del servidor siguen siendo obligatorios.

`Chat.sendMessage` notifica después de persistir y envía el ID exacto del mensaje. El backend comprueba simultáneamente mensaje, cotización y remitente. Las sesiones envían `session_id`, se consultan por ID y cotización, y deben conservar el estado del evento; una petición tardía no notifica otra sesión. Cambiar una fecha genera `session_rescheduled`. La valoración privada de oportunidades del artista ya no dispara una falsa reseña del cliente. Las decisiones registradas por el artista tras un acuerdo offline requieren el correspondiente estado guardado de la cotización.

`/api/studio/notify` mantiene la comprobación de propiedad del estudio y usa `studio_roster_invite` o `studio_spot_decision`. Las invitaciones deben seguir pendientes y la decisión debe coincidir con la postulación guardada. Una respuesta de fallo conserva el cambio de negocio; sólo `sent:true` confirma aceptación del correo.

`email_delivery_ledger` conserva las claves de envío y sus resultados sin cuerpos de correo, contraseñas ni destinatarios. Una petición repetida, concurrente o posterior a un reinicio no vuelve a enviar un correo aceptado. Un timeout, un HTTP 500 o un resultado parcial quedan como `uncertain`; requieren revisar la ejecución del proveedor antes de cualquier reenvío manual. Un rechazo confirmado antes de aceptación queda como `failed` y permite reclamar un reintento de forma atómica; dos reintentos concurrentes producen un solo envío. La migración `20260921001000_email_delivery_ledger.sql` debe estar aplicada antes de publicar el backend. `email_routing` es privado porque puede contener claves del proveedor.

El frontend adjunta la sesión, informa los fallos mediante `weotzi:email-failed` y muestra un aviso cuando la página ofrece `showToast`. El cambio de negocio permanece guardado aunque el correo falle. No existe fallback directo del navegador hacia n8n: evita saltarse la autorización y duplicar envíos.

## Proveedor n8n

Workflow: `7T2f3YNXeqFOjV0C` — `We Otzi Email Notifications`.

- Se respaldaron draft y active previos en `tmp/email-notifications-*-before-20260921.json`, excluidos de Git.
- Los 27 webhooks responden después de ejecutar el último nodo (`lastNode`, `allEntries`).
- Los 29 nodos SMTP detienen el workflow al fallar. Los pasos previos de datos también detienen errores.
- La consulta de adjuntos produce salida incluso si la cotización no tiene archivos.
- Las dos bienvenidas publicadas usan las plantillas locales sin campo de contraseña.
- Se agregaron dos canales para invitaciones y decisiones de estudios, con rutas privadas y plantilla `studio-notification`.
- Versión final publicada y reconsultada: `ddf0fd6e-a762-4402-827e-1519bc34f314`, con los 29 nodos SMTP usando `We Ötzi <notificaciones@weotzi.chat>` y la credencial `uEboReZj3XMBLc1P`. La credencial anterior se conserva para rollback.
- Se validaron los 60 nodos y 254 expresiones sin errores. La validación completa de conexiones identifica erróneamente los tres correos de cotización como manejadores de error; son tres destinatarios del camino exitoso y se conserva esa estructura. Se mantuvieron las 31 conexiones existentes y se agregaron dos enlaces directos para los canales de estudios.

Después de publicar y verificar el backend se activó autenticación con el header `X-Weotzi-Webhook-Token` en los 27 webhooks. El secreto existe únicamente como configuración privada `n8n_webhook_secret` (o `N8N_WEBHOOK_SECRET` en entorno) y en la credencial n8n `77cxyyUNUDbVnZvC`. Una consulta anónima comprobó que el secreto y `email_routing` devuelven cero filas. La versión activa `454c4843-98a5-41c1-91ec-d01bdfbf3ac5` fue reconsultada y confirma los 27 canales protegidos. Una petición sin credencial al canal de invitaciones respondió 403, sin enviar correo.

El backend solo confirma `smtp_accepted` cuando n8n devuelve `messageId`. Un HTTP 200 con un simple acuse de ejecución, HTML, un error JSON o destinatarios rechazados no se presenta como correo enviado. La aceptación SMTP no demuestra recepción en la bandeja del usuario.

## Recuperación de acceso

`/recover` utiliza Supabase Auth para enviar y verificar OTP antes de cambiar la contraseña. Los wrappers heredados de artista y cliente usan ese mismo canal. El endpoint `reset-temp-password` sigue reservado a soporte/service-role; los usuarios anónimos no pueden elegir una contraseña para otra cuenta. La recuperación de estudios usa Supabase Auth con su URL de retorno.

El SMTP de Supabase quedó habilitado con el mismo remitente Hostinger, puerto 465 y TLS. Se guardó una plantilla con `{{ .Token }}` y `{{ .ConfirmationURL }}`. La primera recepción aún usó la plantilla anterior; luego se verificó el nuevo asunto, el código real y su aceptación en la pantalla publicada hasta el paso de nueva contraseña. No se cambió una contraseña de usuario existente. La cuenta Auth sintética fue eliminada después.

El código de `/recover` también atiende `PASSWORD_RECOVERY` y la sesión del enlace de retorno. Supabase permite `https://beta.weotzi.com/recover?recovery=1` y `https://beta.weotzi.com/studio/login?recovery=1`; ambas entradas se verificaron guardadas. Tres pruebas locales cubren recuperación por sesión y que un login ordinario no avance por error al cambio de contraseña.

## Validación local

`node --test tests/email-dispatch.test.js tests/email-templates.test.js` cubre autorización, destinatarios persistidos, enlaces `/beta`, errores lógicos del proveedor, mensaje SMTP, deduplicación concurrente y posterior, timeout incierto, credenciales fuera de las bienvenidas y autenticación desde el navegador.

En `http://localhost:4646` se comprobaron nueve respuestas HTTP reales sin ejecutar envíos: listar eventos, prueba administrativa, bienvenida artista, bienvenida cliente, evento de reset, override de canal, bienvenida bajo `/beta` y cambio de contraseña rechazaron acceso anónimo con 401; una cotización inexistente respondió 404.

## Prueba controlada realizada

El usuario autorizó crear y usar un buzón. Se configuró `notificaciones@weotzi.chat` en el plan gratuito de Hostinger sin modificar el correo de `weotzi.com`. MX, SPF, DKIM y DMARC fueron verificados en el DNS autoritativo. El buzón sirvió también como único destinatario controlado; no se enviaron pruebas a cuentas de terceros.

Desde el servidor publicado se ejecutó el servicio de correo de producción con payloads sintéticos y claves de idempotencia fijas. Las dos bienvenidas devolvieron HTTP 200, `smtp_accepted` y Message-ID. Después se confirmó la recepción por IMAP de los mismos IDs, con SPF, DKIM y DMARC aprobados:

- Artista: `<eecb473b-3cfd-5c3e-4b7d-e2cd46f42f07@weotzi.chat>`.
- Cliente: `<4dadb60b-bce9-4340-092b-5811afd44974@weotzi.chat>`.
- Recuperación, enviada desde la web por Supabase: `<4hpdPY451Cz2xhG@fr-int-smtpout30.hostinger.io>`; código presente y validado en el navegador.

Las pruebas reales anteriores no constituyen un envío de cada evento del catálogo. La autorización de endpoints, destinatarios persistidos, estado de cotización/sesión, reintentos y duplicados están cubiertos por pruebas automatizadas. `/api/email/test` sigue exigiendo una sesión real de superadministrador; la prueba del transporte por SSH no añadió excepciones a ese control. Los 27 webhooks requieren header privado y una llamada anónima fue rechazada con 403.

Configuración Auth/SMTP verificada mediante Dashboard autenticado; el endpoint público `/auth/v1/settings` por sí solo no prueba SMTP. Referencia usada para diagnosticar plantillas: [Supabase — Email template not updating](https://supabase.com/docs/guides/troubleshooting/email-template-not-updating).
