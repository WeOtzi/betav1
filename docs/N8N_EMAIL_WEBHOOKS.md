# n8n Email Webhooks - Guia de Integracion

Esta guia describe como We Otzi envia eventos a n8n para notificaciones por email.

## Resumen

We Otzi utiliza webhooks de n8n para enviar notificaciones por email en diferentes escenarios. Cada evento tiene su propia URL de webhook configurable y puede activarse/desactivarse individualmente desde el backoffice.

**Remitente de emails**: `isai@weotzi.com` (configurado en n8n)

## Relé genérico de envío (`smtp_relay`) — recomendado para la beta

Desde la beta cerrada el servidor **arma el correo completo** (asunto, HTML
responsive con la base común de `lib/email-render/layout.js`, versión de texto
plano y headers) y lo entrega a **un único webhook** de n8n que solo lo manda
por SMTP. Así los eventos sin webhook propio (`instagram_verification_code`,
`studio_*`, `inbox_message_received`, `session_reminder_24h`, …) salen igual,
cada destinatario recibe su versión (cliente / artista) y los valores ya van
escapados y formateados en español.

**Configuración** (servidor): `N8N_EMAIL_RELAY_URL` (o `app_settings.email_relay_url`,
privada) y `N8N_EMAIL_RELAY_TOKEN` (o `N8N_WEBHOOK_SECRET`). Elegir el canal por
evento en `app_settings.email_routing` (`{"<evento>": {"channel": "smtp_relay"}}`,
o `{"*": {"channel": "smtp_relay"}}` para todos) desde Backoffice → Email routing.
Un evento en `n8n` **sin** webhook propio sale por el relé automáticamente si el
relé está configurado.

**Request** (`POST`, un correo = un request = un destinatario):

```http
POST <N8N_EMAIL_RELAY_URL>
Content-Type: application/json
X-Weotzi-Webhook-Token: <secreto>

{
  "event_id": "session_scheduled",
  "event_name": "Sesión: agendada",
  "category": "calendar",            // transactional | quotations | messages | calendar | account | studios
  "role": "client",                  // destinatario: client | artist | studio | admin | support
  "from_name": "We Ötzi",
  "to": "persona@example.com",       // siempre UNA dirección
  "reply_to": "soporte@weotzi.com",  // solo si SUPPORT_EMAIL está definido
  "subject": "Sesión agendada: sábado, 21 de noviembre de 2026",
  "html": "<!DOCTYPE html>…",        // listo para enviar, < 90 KB
  "text": "WE ÖTZI\n\nHola, Lucía.\n…",
  "headers": {
    "X-Weotzi-Event": "session_scheduled",
    "List-Unsubscribe": "<https://beta.weotzi.com/client/profile#notificaciones>, <mailto:soporte@weotzi.com?subject=…>"
  },
  "idempotency_key": "WO-2026-0142:session:…:client"   // si viene, n8n puede deduplicar
}
```

**Workflow esperado** ("We Ötzi · Enviar email"): `Webhook` (POST, Header Auth
con la credencial existente de `X-Weotzi-Webhook-Token`, responde con *Respond to
Webhook*) → `Send Email` (SMTP de notificaciones: To `{{$json.body.to}}`,
Subject `{{$json.body.subject}}`, HTML `{{$json.body.html}}`, Text
`{{$json.body.text}}`, Reply-To `{{$json.body.reply_to}}`, headers extra
`{{$json.body.headers}}` si el nodo lo permite) → `Respond to Webhook` con
`{ "messageId": "{{$json.messageId}}" }`.

**Respuesta**: `200` + `{ "messageId": "…" }` = aceptado por SMTP. Sin
`messageId`, con `{ "error" }`, `success:false` o 5xx el envío queda
**incierto** y no se reintenta solo (`email_delivery_ledger`). `401/403` sin
ejecutar = rechazo seguro (se puede reintentar). Una respuesta HTML se toma como
error.

**Seguridad**: un POST sin el header correcto tiene que responder `403`. El
webhook nunca debe aceptar HTML del navegador: solo lo llama el servidor.

### Antes del deploy de la beta cerrada (revisión de integración, 15 nov 2026)

- **El relé es obligatorio** (EMAIL-RELAY-01). Al 15 nov 2026 no existe ni el
  workflow ni `app_settings.email_relay_url`. Sin él, 20 eventos sin webhook
  propio devuelven `ok:false` («No hay webhook de n8n ni relé»):
  `artist_new_quotation`, `artist_confirmed_agreement`,
  `quotation_artist_selected`, `client_quotation_accepted_receipt`,
  `client_quotation_rejected_receipt`, `booking_slot_requested`,
  `booking_slot_confirmed`, `booking_slot_hold_expired`,
  `artist_verification_requested`, `studio_registration_completed`,
  `studio_claim_decided`, `studio_verification_decision`,
  `studio_membership_request_created`, `studio_membership_request_decision`,
  `studio_artist_invite_email`, `studio_invite_link_joined`,
  `studio_invitation_response`, `inbox_message_received`,
  `session_reminder_24h` e `instagram_verification_code`.
  Pasos: (1) crear y activar el workflow de arriba (sin `messageId` el envío
  queda incierto); (2) aplicar `20261115180000_emails_settings_privados.sql` y
  después cargar `email_relay_url` (privada) o `N8N_EMAIL_RELAY_URL` en el
  `.env` de producción; (3) probar con `POST /api/email/test` forzando
  `smtp_relay` y confirmar `delivery_status = smtp_accepted`.
- **`client_quotation_submitted` prefiere el relé** (EMAIL-DUP-01): su flujo n8n
  también le escribe al artista, que ya recibe su aviso propio
  (`artist_new_quotation`, `quotation_artist_selected` o
  `booking_slot_requested`). Con el relé configurado y sin override de ese
  evento en `email_routing`, sale por el relé (cliente y admin, sin artista).
  Si se fuerza `n8n` para ese evento, desactivar el nodo «Email Notificacion
  Artista» del workflow de notificaciones.
- **Copia del artista de `session_*` y `quotation_completed_summary`**
  (EMAIL-NEW-01): solo sale si el canal efectivo del evento es `smtp_relay`; los
  flujos n8n de esos eventos son de un solo destinatario (el cliente). Para que
  el artista reciba su copia, pasar esos eventos a `smtp_relay` en
  `email_routing` una vez configurado el relé.
- **Recordatorio de sesión: una sola vía** (EMAIL-DUP-02). El job
  `session_reminder_24h` (lib/session-reminders.js, cada 30 min) arranca por
  defecto. Antes de configurar el relé, desactivar el nodo «Email Session
  Reminder» del workflow «We Otzi Digest & Reports», o definir
  `SESSION_REMINDERS_JOB=off` en producción y no programar
  `POST /api/sessions/reminders/dispatch`.

> Los webhooks por evento siguen funcionando (canal `n8n`). Desde ahora su body
> trae además `rendered: { subject, html, text, headers }` (el mismo correo del
> relé) y `data` / `vars` llegan **escapados** (EM-N4) y sin datos de salud.
> Las URLs de los webhooks ya no son públicas (`app_settings.n8n_events`
> privado; migración `20261115180000_emails_settings_privados.sql`).

## Eventos Disponibles

| ID del Evento | Nombre | Descripcion |
|---------------|--------|-------------|
| `artist_registration_completed` | Registro de Artista Completado | Se dispara cuando un artista completa su perfil |
| `client_registration_completed` | Registro de Cliente Completado | Se dispara cuando un cliente crea su cuenta |
| `password_reset_temp` | Restablecimiento de Contrasena | Se dispara cuando un usuario solicita recuperar su contrasena |
| `client_quotation_submitted` | Cotizacion de Cliente Enviada | Se dispara cuando un cliente envia una cotizacion |
| `instagram_verification_code` | Código de validación de Instagram | Solo servidor (`POST /api/artist/instagram-verification`). Variables finales: `artist_email`, `artist_name`, `verification_code`, `instagram_handle`, `expires_label`, `weotzi_instagram`, `dm_url`. Nodo n8n esperado: "Codigo Validacion Instagram" (plantilla `instagram-verification`). Ver `docs/VALIDACION-INSTAGRAM.md`. |

### Eventos de la ronda 2 (nov 2026)

Viven en `services/email-events/<frente>.js` y se cargan solos (ver el `README.md` de esa carpeta). Todos son **solo servidor** (`serverOnly: true`): el navegador no puede pedirlos por `POST /api/email/:eventId`; los dispara el servidor después de guardar la acción. No traen un webhook propio de n8n: con el relé configurado salen por `smtp_relay` con el HTML que arma el servidor (o por el webhook que se les cargue en Backoffice → Eventos/Webhooks).

Además del correo, los de sesiones (menos `session_dispute_support`), los de negociación, `artist_updated_quotation_proposal` y `shared_quotation_linked` dejan el aviso in-app y mandan el push al destinatario (`lib/push-dispatch.js`). Las denuncias y `artist_most_wanted_awarded` salen solo por correo.

Las variables traen `quote_id` (la llave de los enlaces) y `quote_code` (el código corto de 6 caracteres, que es lo que se muestra). Desde esta ronda, los correos de cotización anteriores (`client_quotation_submitted`, `artist_responded_quotation`, `session_*` de la agenda, `chat_message_*`…) también muestran `quote_code` en el asunto y en la fila "Cotización".

| ID del evento | Destinatario | Cuándo se dispara | Archivo |
|---------------|--------------|-------------------|---------|
| `session_confirmation_requested` | Cliente y artista (una copia cada uno) | El artista agendó o cambió una sesión: el cliente la confirma o pide otra fecha. | `sesiones.js` |
| `session_confirmed_by_client` | Cliente y artista | El cliente confirmó la sesión propuesta. | `sesiones.js` |
| `session_change_requested` | Cliente y artista | Una de las partes pidió cambiar la fecha, la duración o el lugar. | `sesiones.js` |
| `session_change_resolved` | Cliente y artista | El pedido de cambio se aceptó, se rechazó o se retiró. | `sesiones.js` |
| `session_feedback_received` | La otra parte | Una de las partes calificó una sesión pasada y dejó su registro. | `sesiones.js` |
| `session_no_show` | Cliente y artista | El artista registró que el cliente no se presentó. | `sesiones.js` |
| `session_dispute_opened` | Cliente y artista | Una de las partes pidió una disputa a soporte sobre una sesión. | `sesiones.js` |
| `session_dispute_support` | Soporte (`SUPPORT_EMAIL`; si falta, los agentes activos de `support_users_db`) | Lo mismo, para el equipo de soporte. Suma la referencia interna (`quote_id`). | `sesiones.js` |
| `session_dispute_resolved` | Cliente y artista | Soporte resolvió o cerró la disputa desde su panel. | `sesiones.js` |
| `negotiation_counter_proposed` | Artista | El cliente modificó la propuesta recibida (contrapropuesta). | `negociacion.js` |
| `negotiation_counter_accepted` | Cliente | El artista aceptó la contrapropuesta: la cotización queda aprobada por las dos partes. | `negociacion.js` |
| `negotiation_counter_declined` | Cliente | El artista mantiene su propuesta original. | `negociacion.js` |
| `negotiation_amendment_proposed` | La contraparte (cliente o artista) | Una parte propone cambiar el acuerdo ya aprobado. | `negociacion.js` |
| `negotiation_amendment_accepted` | Quien propuso el cambio | La otra parte lo aprobó: el acuerdo queda actualizado. | `negociacion.js` |
| `negotiation_amendment_rejected` | Quien propuso el cambio | La otra parte lo rechazó: el acuerdo sigue como estaba. | `negociacion.js` |
| `negotiation_proposal_withdrawn` | La contraparte | Quien propuso cambios los retiró. | `negociacion.js` |
| `artist_updated_quotation_proposal` | Cliente | El artista modificó y reenvió una propuesta que todavía no estaba aprobada. | `cot-respuesta.js` |
| `shared_quotation_linked` | Artista | El cliente abrió el enlace público `/cotizacion/<token>` y vinculó la cotización a su cuenta. | `cot-detalle.js` |
| `report_ticket_created_support` | Soporte (`SUPPORT_EMAIL`; si falta, los agentes activos) | Un artista o un estudio envió una denuncia. | `denuncias.js` |
| `report_ticket_received` | Quien denunció (artista o estudio) | Acuse de la denuncia: número de ticket, motivo y qué pasa después. | `denuncias.js` |
| `artist_most_wanted_awarded` | Artista | Su perfil entró al top de tendencia de su zona y ganó la insignia Most Wanted. Nace apagado: `MOST_WANTED_EMAILS=off` (ver `deployments/DEPLOY.md`). | `perfil.js` |

Los avisos de negociación, de la propuesta actualizada y del vínculo respetan "Cotizaciones → Email" de las preferencias de cada usuario (`lib/notification-prefs.js`); los de sesiones son transaccionales y salen siempre. Guías por frente: `docs/NEGOCIACION_COTIZACION.md`, `docs/COT_RESPUESTA.md` y `docs/PERFIL_INSIGNIAS.md`.

## Configuracion en el Backoffice

1. Accede al backoffice: `/backoffice`
2. En la seccion **Super Admin**, selecciona **Eventos/Webhooks**
3. Para cada evento:
   - Ingresa la URL del webhook de n8n
   - Activa el toggle para habilitarlo
   - Usa el boton de prueba para verificar la conexion

## Estructura de Payloads

### Estructura Base

Todos los webhooks envian un payload con esta estructura base:

```json
{
    "event_id": "nombre_del_evento",
    "event_name": "Nombre Legible del Evento",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        // Datos especificos del evento
    }
}
```

### 1. artist_registration_completed

Se dispara cuando un artista completa el registro de su perfil.

```json
{
    "event_id": "artist_registration_completed",
    "event_name": "Registro de Artista Completado",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "email": "artista@email.com",
        "username": "nombreartistico.wo",
        "password": "OtziArtist2025",
        "name": "Nombre Completo",
        "artistic_name": "Nombre Artistico",
        "city": "Ciudad",
        "country": "Pais",
        "styles": ["Realismo", "Black & Grey"],
        "studio": "Nombre del Estudio",
        "session_price": "500 USD",
        "years_experience": 5,
        "bio": "Biografia del artista...",
        "portfolio_url": "https://portfolio.com",
        "dashboard_url": "https://weotzi.chat/artist/dashboard",
        "profile_url": "https://weotzi.chat/artist/profile/nombreartistico.wo"
    }
}
```

### 2. client_registration_completed

Se dispara cuando un cliente crea su cuenta.

```json
{
    "event_id": "client_registration_completed",
    "event_name": "Registro de Cliente Completado",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "email": "cliente@email.com",
        "password": "contrasenaDelCliente",
        "full_name": "Nombre del Cliente",
        "whatsapp": "+5491123456789",
        "birth_date": "1990-01-15",
        "age": 34,
        "instagram": "@cliente",
        "city": "Buenos Aires",
        "quote_id": "QN12345",
        "dashboard_url": "https://weotzi.chat/client/dashboard",
        "login_url": "https://weotzi.chat/client/login"
    }
}
```

### 3. password_reset_temp

Se dispara cuando un usuario (artista o cliente) solicita restablecer su contrasena.

```json
{
    "event_id": "password_reset_temp",
    "event_name": "Restablecimiento de Contrasena",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "email": "usuario@email.com",
        "temp_password": "Ab3dEf7hJk",
        "user_type": "artist",
        "login_url": "https://weotzi.chat/registerclosedbeta"
    }
}
```

**Nota**: `user_type` puede ser `"artist"` o `"client"`. El `login_url` varia segun el tipo de usuario.

### 4. client_quotation_submitted

Se dispara cuando un cliente completa y envia una cotizacion.

```json
{
    "event_id": "client_quotation_submitted",
    "event_name": "Cotizacion de Cliente Enviada",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "client_name": "Nombre del Cliente",
        "client_email": "cliente@email.com",
        "client_whatsapp": "+5491123456789",
        "client_age": 28,
        "quote_id": "QN12345",
        "quote_code": "A7K3QX",
        "artist_name": "Nombre del Artista",
        "artist_email": "artista@email.com",
        "tattoo_description": "Descripcion de la idea del tatuaje...",
        "tattoo_location": "Brazo derecho - Antebrazo",
        "tattoo_size": "Mediano (10-15 cm)",
        "tattoo_style": "Realismo",
        "tattoo_references": "https://drive.google.com/...",
        "client_budget": "500 USD",
        "client_preferred_date": "2026-03-15",
        "has_medical_conditions": false,
        "medical_details": null,
        "register_url": "https://weotzi.chat/client/register",
        "login_url": "https://weotzi.chat/client/login"
    }
}
```

`quote_code` es el código corto que ve el cliente en pantalla: es el que va en el asunto y en el cuerpo. `quote_id` queda para armar enlaces.

## Configuracion del Servidor

Para que el flujo de restablecimiento de contrasena funcione, el servidor necesita la variable de entorno:

```env
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_aqui
```

Esta clave se obtiene del dashboard de Supabase en **Settings > API > service_role key**.

**Importante**: Esta clave tiene permisos de administrador. Nunca la expongas en el frontend.

## Creando Workflows en n8n

### Ejemplo basico de workflow

1. **Trigger**: Webhook node (recibe el POST)
2. **Proceso**: Set node (prepara variables para el email)
3. **Envio**: Email node o SMTP node

### Tips para n8n

- Usa el `event_id` para filtrar eventos si usas una sola URL para multiples eventos
- Los datos estan en `$json.data.*`
- El timestamp esta en formato ISO 8601
- Para testing, usa el boton "Probar Webhook" en el backoffice

## Solucion de Problemas

### El webhook no se envia

1. Verifica que el evento este **activado** en el backoffice
2. Verifica que la URL del webhook sea correcta
3. Revisa la consola del navegador para errores
4. Usa el boton "Probar Webhook" para validar la conexion

### Error al restablecer contrasena

1. Verifica que `SUPABASE_SERVICE_ROLE_KEY` este configurada en el servidor
2. Verifica que el email exista en la base de datos
3. Revisa los logs del servidor para mas detalles

### El email no llega

1. Verifica la configuracion SMTP en n8n
2. Revisa que el workflow en n8n este activo
3. Verifica que el email del destinatario sea correcto

## Referencias

- [Documentacion de n8n](https://docs.n8n.io/)
- [Supabase Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)
- [EASYPANEL_DEPLOYMENT.md](./EASYPANEL_DEPLOYMENT.md) - Configuracion de variables de entorno
