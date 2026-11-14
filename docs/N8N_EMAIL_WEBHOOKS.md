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
