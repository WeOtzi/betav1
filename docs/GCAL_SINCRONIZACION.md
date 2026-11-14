# Google Calendar · sincronización de la agenda (solo de ida)

We Ötzi publica la agenda del artista en su Google Calendar (calendario `primary`). Es **solo de ida**: nunca se leen eventos de Google. Solo se crean, actualizan y borran los eventos que publica We Ötzi. Cada uno lleva `extendedProperties.private.weotzi = 1` y `weotzi_source = <source_key>`.

Código: `lib/gcal-sync.js` (servicio y fuentes), `lib/gcal-oauth.js` (OAuth y cliente HTTP), `lib/repos/google-calendar.js` (datos) y `public/shared/js/data/google-calendar-repo.js` (front). Rutas en el bloque `── gcal ──` de `server.js`.

## Qué se publica

| source_key | Origen | En Google |
|---|---|---|
| `event:<uuid>` | `artist_calendar_events` de tipo turno, reserva, día bloqueado, guest spot, convención o personal | Con su horario o de todo el día, con repetición semanal |
| `session:<uuid>` | `quotation_sessions` | "Sesión — Cliente" con el link a la cotización. No se publican las `cancelled` ni las `no_show`, ni las de cotizaciones `cancelled`, `expired` o `client_rejected` |
| `trip:<uuid>` | `artist_trips` (Travel) | Días completos. Los cancelados no se publican |
| `reminder:<uuid>` | `artist_reminders` | Con hora: 30 min con aviso emergente a la hora. Con solo fecha: todo el día. No ocupa horario (`transparent`). Los completados salen |
| `booking:<uuid>` | `studio_bookings` confirmadas o completadas | "Cita en Estudio · Cliente", con la dirección de la sede. Sin email ni teléfono del cliente |
| `hold:<uuid>` | `artist_booking_holds` en `pending` sin vencer (los crea el frente "turnos") | "Solicitud de turno · Cliente", provisorio (`tentative`). Al confirmarse sale y entra la sesión |
| `vacation:<user_id>` | `artists_db.vacation_start/_end` | "Vacaciones", días completos |

La disponibilidad semanal no se publica: es el horario de atención, no son eventos. Las solicitudes pendientes sin turno apartado tampoco: no tienen hora.

## Cuándo llega a Google

1. **Al escribir desde la web**: los repos del front piden `POST /api/google-calendar/sync` (debounce de 1,5 s). Lo hacen `calendar-repo.js` (eventos, sesiones y recordatorios), `travel-repo.js`, `QuotationDetail` (sesiones y cambios de estado) y `Quotations.createManual` (cita manual). Estos dos últimos los envuelve `google-calendar-repo.js` al cargarse. El servidor frena a 1 corrida cada 20 s por artista. Si un pedido llega dentro del freno, se agenda una corrida al cumplirse, y si llega mientras corre una, se repite al terminar.
2. **Cualquier otra escritura** (RPC, estudio, backoffice, triggers): los triggers `trg_gcal_dirty` marcan `artist_google_calendar_connections.dirty_at`. El servidor revisa cada `GCAL_DIRTY_POLL_MS` (30 s por defecto; `0` lo apaga) y sincroniza solo a esos artistas.
3. **Respaldo**: el job completo cada 15 min (`GCAL_SYNC_JOB=off` lo apaga).
4. **Desde otro módulo del servidor**: `require('./lib/gcal-sync').notifyChange(artistUserId)`.

## Garantías

- **Historial**: la lectura toma lo que terminó hace menos de 30 días. Lo más viejo no se borra de Google, porque el vínculo guarda `source_ends_at`. Solo se borra de Google lo que se borró, canceló, completó o venció en We Ötzi. Antes de borrar, se verifica la fila por id. Si una fuente falla al leerse, no se toca ninguno de sus vínculos.
- **Sin duplicados al reconectar**: el id del evento en Google es determinístico (`sha256(artista, source_key)`, base32hex). Los vínculos ya no se borran al desconectar: su FK es a `auth.users`. Si el evento ya existe, Google responde 409 y se adopta con un update.
- **Cambio de cuenta de Google**: los vínculos de la cuenta anterior (`google_email` distinto) se descartan y los eventos se publican en la nueva.
- **Desconectar**: el diálogo de Cuenta → Disponibilidad permite quitar de Google los eventos que todavía no pasaron (`removeEvents`). Los pasados quedan como historial.
- **Zona horaria**: se usa `user_preferences.app_settings.timezone`. Si falta, el front guarda la del navegador al abrir Cuenta, el calendario, Travel o las cotizaciones (nunca pisa una elegida). Sin ella, el servidor usa Buenos Aires.

## Cómo se suma una fuente nueva

1. **Migración**: sumar el prefijo al CHECK `artist_google_calendar_event_links_source_key_check` y enganchar la marca de cambios con una línea:
   ```sql
   select private.gcal_attach_dirty_trigger('public.mi_tabla', 'artist_user_id');
   -- o, si la tabla referencia una cotización:
   select private.gcal_attach_dirty_trigger('public.mi_tabla', 'quotation_id', 'quotation');
   ```
2. **Repo** (`lib/repos/google-calendar.js`): `listX(userId, sinceIso)` con las filas vigentes y `getXByIds(userId, ids)` con las filas por id. Si la tabla puede no existir todavía, devolver `[]` (o `null` en el `get`) ante `isMissingSchema(err)`.
3. **Servicio** (`lib/gcal-sync.js`): un normalizador `fila → fuente | null` y una entrada en `DEFAULT_SOURCES`:
   ```js
   { kind: 'x', idOf: (row) => row.id,
     list: (db, userId, ctx) => callDb(db, 'listX', userId, ctx.since),
     fetchByIds: (db, userId, ids) => callDb(db, 'getXByIds', userId, ids),
     normalize: (row, ctx) => normalizeX(row, ctx) }
   ```
   La fuente puede definir `status: 'tentative'`, `transparency: 'transparent'` y `reminders`. No cambiar el cuerpo de las fuentes existentes sin necesidad: cambia su hash y fuerza un update de todos sus eventos.
4. **Tests**: un caso por normalizador en `tests/gcal-fuentes.test.js`.
