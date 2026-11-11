# Validación de Instagram del artista

Fecha: 2026-10-30
Estado: código listo y probado; migración **aplicada en producción** el 2026-10-30 (versión remota
`20261030131202`). La lectura automática de mensajes directos todavía requiere configuración fuera del repo
(ver "Puesta en marcha").

Relacionados: [MODO-ASISTIDO.md](MODO-ASISTIDO.md) (paso 2 del modo asistido) y
[EMAIL-DELIVERY-20260921.md](EMAIL-DELIVERY-20260921.md).

## Qué resuelve

Las fotos que un artista importa desde Instagram **no se muestran a los clientes
hasta que valida que esa cuenta de Instagram es suya**. La validación:

1. En Centro de la cuenta → Portafolio, el artista toca **Generar código**.
2. El servidor genera un código `WO-XXXXXX` (alfabeto sin caracteres ambiguos
   `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), guarda **solo su hash** y lo manda por
   email al correo de la cuenta. Vence en 72 horas y un código nuevo cancela los
   anteriores.
3. Desde la cuenta de Instagram cargada en su perfil, el artista **sigue a
   @weotzi** y le **manda el código por mensaje directo**.
4. La automatización de mensajes de @weotzi avisa al servidor (webhook) o, si no
   está activa, soporte confirma a mano desde su dashboard.
5. Se marca la cuenta como validada y las fotos importadas de ese usuario pasan a
   ser públicas.

## Qué se muestra y qué no

Regla única en `public/shared/js/gallery-visibility.js` (espejada en SQL):

- Un ítem es "de Instagram" si tiene `source: 'instagram'`, un `permalink` de
  `instagram.com`, un archivo en la carpeta `/instagram-import/` o la categoría
  `instagram` / `instagram-reel`.
- Es público si no es de Instagram, si tiene `ig_legacy: true`, o si la cuenta
  está validada y el `ig_handle` del ítem coincide con el usuario validado (o el
  ítem no sabe de qué cuenta vino).
- **Las fotos importadas antes de esta función siguen visibles**: la migración
  les agrega `ig_legacy: true`. Solo las importaciones nuevas esperan la
  validación.
- Mientras la migración no esté aplicada todo se muestra como hasta ahora.

Dónde se aplica: perfil público (`artist-profile.js`, filtra antes de armar la
galería, los chips y las especialidades), columna derivada `gallery_images` (la
recalcula el trigger, y de ahí la leen job board y solicitudes de clientes),
y marcas "Pendiente de validación" / "PENDIENTE · IG" en el centro de la cuenta
y en la galería del dashboard. Cada importación nueva guarda `source`,
`ig_handle` e `imported_at` en el ítem.

Límite conocido: es un control de calidad, no de seguridad. El JSON crudo de
`gallery_feed_items` sigue siendo legible con la anon key y las URLs de Storage
son públicas.

## API

| Ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /api/artist/instagram-verification` | Artista (Bearer) | Estado: `available`, `enforced`, `verified`, `status` (`none`/`pending`/`verified`/`expired`), `handle`, `verified_handle`, `verified_at`, `expires_at`, `email_masked`, `pending_items`, `legacy_items`, instrucciones. |
| `POST /api/artist/instagram-verification` | Artista (Bearer), máx. 5 por hora por IP | Genera y envía el código. Devuelve `email_sent` (nunca el código). 400 sin usuario de Instagram, 409 si ese usuario ya está validado, 503 `IG_VERIFICATION_UNAVAILABLE` sin migración. |
| `POST /api/instagram-verification/inbound` | Automatización de DMs, header `X-Weotzi-Webhook-Token` | Ver abajo. |
| `GET /api/support/instagram-verifications?status=pending\|verified\|expired\|cancelled\|rejected\|all` | Agente de soporte activo | Cola de validaciones (sin códigos ni hashes). |
| `POST /api/support/instagram-verifications/:id/confirm` | Agente de soporte | `{ code }` valida con el código del DM; `{ force: true, note }` valida sin código (también filas vencidas). |
| `POST /api/support/instagram-verifications/:id/reject` | Agente de soporte | `{ note }` rechaza. |

Implementación: `services/instagram-verification.js`, rutas en `server.js`.

### Webhook de mensajes directos

```http
POST /api/instagram-verification/inbound
X-Weotzi-Webhook-Token: <IG_VERIFY_WEBHOOK_SECRET>
Content-Type: application/json

{ "sender_username": "laura.tattoo", "message_text": "hola, mi código es WO-4F7K2Q", "follows_business": true }
```

- Secreto: `IG_VERIFY_WEBHOOK_SECRET`; si está vacío usa la fila
  `n8n_webhook_secret` de `app_settings` y después `N8N_WEBHOOK_SECRET`. Sin
  ningún secreto responde 503. La comparación es en tiempo constante.
- Extrae el código del texto (acepta minúsculas, espacios o guiones raros),
  busca un pendiente vigente con ese hash y exige que `sender_username` sea el
  usuario para el que se generó (sin `@`, sin mayúsculas) y que
  `follows_business` no sea `false`.
- Respuesta `{ success, verified, reason }`. `reason`: `verified`, `no_code`,
  `code_not_found`, `code_not_pending` (también para entregas duplicadas),
  `handle_mismatch` (5 intentos desde otra cuenta cancelan el código),
  `not_following`, `missing_sender` (400).

## Puesta en marcha

1. **Migración** `supabase/migrations/20261030120000_instagram_verification.sql`
   (reversa: `supabase/rollbacks/20261030120000_instagram_verification.down.sql`).
   **Aplicada** en `flbgmlvfiejfttlawnfu` el 2026-10-30 (versión remota
   `20261030131202`): 45 fotos de Instagram en 4 artistas quedaron con
   `ig_legacy`, ninguna galería pública perdió fotos, la tabla nueva no es
   accesible para `anon`/`authenticated` y el RPC ya devuelve
   `instagram_validation`. Antes de aplicarla se comprobó que las funciones vivas
   coincidían con las del repo; la reversa repone además el `search_path` que la
   función de sincronización tenía en producción.
   Crea `artist_instagram_verifications` (solo service_role), las columnas
   `artists_db.instagram_verified_at` / `instagram_verified_handle` con un
   trigger que impide que el artista las cambie, marca `ig_legacy` en las fotos
   ya importadas, hace que `gallery_images` excluya las pendientes y agrega
   `instagram_validation` al RPC `get_artist_public_profile_preferences`. Se
   ejecutó completa, dos veces y con su reversa en Postgres 18 (PGlite) con
   77/77 comprobaciones antes de aplicarla en producción (Postgres 15.8).
2. **Email** `instagram_verification_code` (plantilla
   `templates/email/instagram-verification.html`, generada con
   `node scripts/redesign-email-templates.js`): crear en el flujo de n8n
   `7T2f3YNXeqFOjV0C` los nodos Webhook + emailSend "Codigo Validacion
   Instagram" y registrar la URL del webhook en `app_settings.n8n_events` (o con
   `PUT /api/email/events/instagram_verification_code`). Alternativa: rutear el
   evento a BillionMail y subir la plantilla al panel. Hasta entonces la API
   responde `email_sent: false` y la tarjeta lo dice.
3. **Lectura de DMs**: una automatización (por ejemplo n8n con la API de
   mensajería de Instagram de la cuenta @weotzi) que, por cada mensaje recibido,
   llame al webhook con el usuario del remitente, el texto y
   `is_user_follow_business`. Configurar `IG_VERIFY_WEBHOOK_SECRET` en el
   servidor.
4. **Sin automatización**: soporte abre los mensajes directos de @weotzi, busca
   el del artista y valida desde **Soporte → Validaciones IG** con el código (o
   sin código, con una nota).

## Pruebas

```bash
node --test tests/instagram-verification.test.js tests/instagram-verification-migration.test.js tests/gallery-visibility.test.js tests/support-instagram-queue.test.js tests/assisted-flow-integration.test.js
```

`tests/assisted-flow-integration.test.js` monta los handlers reales en un
Express efímero con una base en memoria que emula PostgREST (incluido el
trigger) y recorre el flujo completo: código por email, webhook con remitente
equivocado y correcto, reintentos simultáneos, cola de soporte y modo sin
migración.
