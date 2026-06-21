# Capa PostgREST unificada — Piloto: Cotizaciones

> Estado: **ACTIVO / pendiente de visto bueno para desplegar**
> Fecha: 2026-06-21 · Autor: sesión Claude Code · Proyecto Supabase vivo: `flbgmlvfiejfttlawnfu`
> Alcance de esta pasada: dominio **Cotizaciones** (cluster de 5 tablas). El resto de dominios se migrará después, reusando esta misma capa.

---

## 0. Resumen ejecutivo

**Hallazgo que reencuadra el pedido:** PostgREST **ya está debajo de todo el proyecto**. Supabase expone PostgREST en `/rest/v1/`, y:

- el **servidor** (`server.js`, 6.487 líneas) ya habla con esa API por `fetch()` crudo (no hay `@supabase/supabase-js` en el backend);
- el **frontend** ya usa `supabase-js` (`_supabase.from('tabla')…`), que es un wrapper de PostgREST.

El problema real no es "adoptar PostgREST", sino que **el acceso a datos está fragmentado e inconsistente**:

- En el servidor conviven **al menos 3 helpers de datos solapados** — `_supabaseFetch` (service role), `supabaseQuery` (anon key), `fetchAdminTableRows` (service role + `Range`/count) — más `lib/app-settings.js` con su propio `supabaseConfig`/`serviceHeaders`, **más decenas de `fetch('${url}/rest/v1/…')` inline** que rearmen headers y querystrings a mano en cada endpoint.
- En el frontend, **cada módulo crea su propio cliente** o usa el singleton, y dispersa llamadas `.from('quotations_db')…` con filtros ad-hoc, sin manejo de error homogéneo, sin un lugar único para nombres de tabla/columna ni para las **claves de relación** (que además son inconsistentes: ver §1.3).

**Objetivo:** introducir **una capa de acceso a datos unificada** sobre PostgREST —repos por dominio, con un cliente/query-builder común— **sin nuevas dependencias**, preservando RLS en el frontend y `service_role` en el backend. A partir de aquí, toda la lógica de negocio nueva se construye contra esta capa en lugar de armar CRUD a mano.

**Decisión tomada (dueño del producto):** Dirección = *capa unificada* · Alcance de la primera pasada = *piloto de un dominio* (Cotizaciones).

**Tamaño del piloto:** **113 sitios de acceso a datos** al cluster de cotizaciones (101 inventariados + 12 recuperados por el crítico de completitud), repartidos en **1 backend + 13 módulos frontend**.

**Gate:** el despliegue a producción (`beta.weotzi.com`) queda **pendiente de tu visto bueno** de este documento. La implementación de la capa y la migración local sí se pueden empezar de inmediato porque son reversibles.

---

## 1. Alcance, servicios y procesos afectados

### 1.1 Cluster de tablas (dominio Cotizaciones)

| Tabla | PK | Clave de relación a cotización | Notas |
|---|---|---|---|
| `quotations_db` | `id` (int) | — | Entidad raíz. Clave de negocio secundaria `quote_id` (varchar). Soft-delete: `client_deleted_at` (cliente) e `is_archived` (artista). Estado: `quote_status`. |
| `quotation_notes` | `id` (uuid) | `quotation_id` → **`quotations_db.id` (int)** | Notas internas del artista. `content`/`images` jsonb. |
| `quotation_sessions` | `id` (uuid) | `quotation_id` → **`quotations_db.id` (int)** | Sesiones agendadas. `google_event_id` para sync con Google Calendar. |
| `quotations_attachments` | `id` (uuid) | `quotation_id` → **`quotations_db.quote_id` (text)** | Adjuntos/referencias. |
| `chat_messages` | `id` (uuid) | `quotation_id` → **`quotations_db.quote_id` (text)** | Chat cliente↔artista. `is_read`, `sender_type`. |

### 1.2 Postura RLS (verificada en el proyecto vivo)

RLS está **habilitado** en las 5 tablas, con políticas ricas (coinciden con el hardening reciente):

- `quotations_db`: `anon` puede **insertar** y **leer/actualizar sólo `in_progress`** (el wizard pre-login); artistas ven/editan/borran-archivadas las propias (`artist_id = auth.uid()`); clientes ven/editan las propias (`client_user_id = auth.uid()`); soporte (`is_support_user()`) ve/edita/borra todo.
- `quotation_notes` / `quotation_sessions`: `authenticated`, el artista dueño vía join a `quotations_db.artist_id`.
- `quotations_attachments`: insert público; select visible por `in_progress`/dueño; update/delete sólo soporte.
- `chat_messages`: artista/cliente insertan/leen los suyos vía join; soporte lee todo; update sólo de `is_read`.

**Implicación de diseño:** la seguridad del frontend la da **RLS bajo la sesión del usuario** (anon key + JWT). La capa unificada **no debe romper ese contexto**: el cliente frontend sigue siendo el `supabase-js` autenticado. El servidor sigue usando `service_role` (salta RLS) para operaciones de sistema/admin/soporte y para los gates server-side (hide/complete/job-board).

### 1.3 Inventario por archivo (cluster cotizaciones)

| Capa | Archivo | Sitios | Transporte hoy |
|---|---|---:|---|
| Backend | `server.js` | 16 | `fetch` crudo `/rest/v1/` (service_role) + helpers `_supabaseFetch`/`supabaseQuery`/`fetchAdminTableRows` |
| Frontend | `shared-drawer.js` | 23 | `supabase-js` (anon+jwt) |
| Frontend | `client-dashboard.js` | 13 | `supabase-js` + 2 vía `fetch('/api/client/…')` |
| Frontend | `admin.js` | 19 | `supabase-js` directo + rutas genéricas vía `/api/admin/database/…` |
| Frontend | `quotations.js` | 7 | `supabase-js` |
| Frontend | `calendar.js` | 6 | `supabase-js` |
| Frontend | `archive.js` | 6 | `supabase-js` |
| Frontend | `script.js` (wizard) | 4 | `supabase-js` |
| Frontend | `dashboard.js` + `dashboard-redesign.js` | 3 | `supabase-js` |
| Frontend | `client-auth.js` | 3 | `supabase-js` |
| Frontend | `support-dashboard.js` | 3 | `supabase-js` |
| Frontend | `statistics.js` | 1 | `supabase-js` |
| Frontend | `config-manager.js` | 1 | `supabase-js` (conteo genérico) |
| Frontend | `chat.js` | 6 | `supabase-js` — **código muerto** (no referenciado por ningún HTML/loader; ver §4) |

### 1.4 Procesos / flujos de negocio afectados

Wizard de cotización (autosave + submit) · Dashboard de artista (stats, listado, agenda) · "Mis Cotizaciones" (listar/filtrar/archivar/borrar/cambiar estado) · Drawer (rating, estado, prioridad, notas, sesiones, chat, respuesta del artista, confirmación final) · Archivo (restaurar/borrar) · Calendario (sesiones + sync Google Calendar) · Dashboard de cliente (listar, ocultar, completar, chat) · Soporte (inspección/edición/borrado) · Backoffice/admin (stats, CRUD genérico, backups/export) · Analytics de cotizaciones · Job board (aceptar postulación → crear cotización) · Chatbot server-side (`get_quotation_status`).

### 1.5 Lo que **no** cambia en este piloto

- Express sigue sirviendo páginas, auth, archivos e integraciones (Drive/Gemini/Maps/n8n/Apify).
- `supabase-js` sigue siendo el transporte del frontend (ya está cargado; no se quita → "sin dependencias nuevas").
- El servidor sigue sin `@supabase/supabase-js`: la capa server usa `fetch` nativo + `service_role`, igual que hoy.
- El esquema y las políticas RLS **no se tocan** (salvo que una corrección de §4 se apruebe explícitamente).
- Los webhooks n8n disparados tras cada operación se mantienen (la capa expone la data; el disparo de eventos sigue en el llamador).

---

## 2. Diseño de la capa unificada

Misma filosofía y nombres en ambos lados; implementación distinta por transporte.

### 2.1 Servidor (`lib/`)

**`lib/postgrest.js`** — cliente PostgREST mínimo sobre `fetch` nativo (sin dependencias). Reemplaza a `_supabaseFetch`, `supabaseQuery`, `fetchAdminTableRows`, `getSupabaseAdminConfig`/`getAdminHeaders`, `parseContentRangeTotal` y al `supabaseConfig`/`serviceHeaders` duplicado en `app-settings.js`.

```
const { pgrest } = require('./postgrest');

// Lectura con select explícito, filtros parametrizados y escapados:
const rows = await pgrest('quotations_db')
  .select('id,quote_id,client_user_id,client_email,client_deleted_at')
  .eq('quote_id', quoteId)        // escapa el valor → sin inyección de filtro
  .limit(1).execute();

// Escritura:
await pgrest('quotations_db').eq('id', id)
  .patch({ client_deleted_at: new Date().toISOString() });

// Conteo + paginación (Range/Prefer):
const { rows, count } = await pgrest('quotations_db').range(0, 49).count('exact').execute();
```

- Config por defecto: `service_role` (salta RLS). Permite `pgrest(table, { key: 'anon' })` para casos que deban respetar RLS.
- Manejo de error homogéneo: lanza `Error` con `status` y cuerpo recortado (mismo estilo que `app-settings.js`), traduce FK `23503` → 409.
- Centraliza el `encodeURIComponent` de valores de filtro (hoy a veces ausente).

**`lib/repos/quotations.js`** — repositorio de dominio con métodos con nombre (las operaciones reales, no CRUD genérico). Cubre las 5 tablas del cluster:

`QuotationsRepo`: `getByQuoteId`, `listForUser`, `createFromJobBoard`, `claimForClient`, `softDeleteForClient`, `markCompletedByClient`, … · `QuotationNotesRepo`, `QuotationSessionsRepo`, `QuotationAttachmentsRepo`, `ChatRepo` para las hijas · `AdminTableRepo` (genérico, allow-list) para el CRUD por `:tableName` del backoffice.

**`lib/auth/supabase-auth.js`** — unifica la resolución de usuario por Bearer (hoy duplicada entre `_getAuthUserFromBearer`, el bloque repetido en `/hide` y `/complete`, y `verifyAdminCaller`): `resolveBearerUser(req)` y `verifyAdminCaller(req)`.

### 2.2 Frontend (`public/shared/js/data/`)

**`postgrest-client.js`** — envuelve el singleton autenticado `window.ConfigManager.getSupabaseClient()` (NO crea clientes nuevos como hace hoy `quotations.js`). Expone helpers con manejo de error consistente (`{ data, error }` → throw normalizado / log único) y filtros parametrizados.

**`quotations-repo.js`** — repos de dominio que envuelven los `.from('quotations_db')…` dispersos:

- `QuotationsRepo`: `listForArtist`, `listActiveForArtist`, `listArchivedForArtist`, `listForClient`, `listForAdmin`, `listRecent`, `statusCountsForArtist`, `countAll`, `countByStatus`, `setRating`, `updateStatusById`, `updatePriority`, `setArchivedById`, `archiveByIds`, `updateStatusByIds`, `hardDeleteById`, `hardDeleteByIds`, `confirmFinalQuote`, `submitArtistResponse`, `updateTattooDetails`, `upsertDraft`, `findLatestByEmailForReuse`, `findUnclaimedByEmail`, `claimByQuoteIds`, `claimByQuoteId`.
- `QuotationNotesRepo` / `QuotationSessionsRepo` / `QuotationAttachmentsRepo` / `ChatRepo`: encapsulan **la clave de relación correcta** (int `id` vs text `quote_id`) para que ningún llamador tenga que recordarla.
- `QuotationsRealtime` / `ChatRealtime`: helpers de suscripción/teardown (hoy duplicados con `.channel()` ad-hoc).
- Las operaciones server-mediadas (`/api/client/quotations/:id/hide` y `/complete`) se exponen como `QuotationsApi.hideForClient` / `confirmCompletionByClient` (siguen pasando por Express).

Se carga vía `<script src="/shared/js/data/postgrest-client.js">` + `…/quotations-repo.js` antes de los módulos que los usan (sin build step, igual que el resto).

### 2.3 Principios PostgREST que adopta la capa

1. **`select` explícito** siempre (evita `select=*` salvo inspección admin) → menos payload, menos exposición de PII.
2. **Filtros parametrizados y escapados** → corrige el riesgo de inyección en `.or()`/interpolación de email (ver §4).
3. **`Prefer`** correcto (`return=representation` / `return=minimal` / `resolution=merge-duplicates` / `count=exact`).
4. **`Range`** para paginación server-side (hoy varias listas traen todo y paginan en cliente).
5. **Recursos embebidos** (`quotation_sessions?select=…,quotations_db(...)`) en vez de joins manuales en cliente cuando aplica.
6. **Soft-delete vs hard-delete explícitos** por nombre de método (hoy se mezclan en `delete()` directos).

---

## 3. Reemplazo 1-a-1 (función anterior → función nueva → razón)

> Convención: "Antes" = `archivo:línea` · función/endpoint · operación. "Después" = método de la capa unificada. Líneas son aproximadas (snapshot 2026-06-21).

### 3.1 Backend — `server.js` + `lib/app-settings.js`

| # | Antes | Después | Razón |
|---|---|---|---|
| S1 | `:350` `_supabaseFetch(path,opts)` (transporte genérico service_role) | `lib/postgrest.js` `pgrest()` | Helper base disperso; se vuelve el único transporte server. |
| S2 | `:3699` `supabaseQuery(cfg,path)` (anon key) | `pgrest(table,{key})` | 2º helper solapado; **además usa anon key server-side** (ver §4-A). |
| S3 | `:2199` `fetchAdminTableRows` + `:2189` `parseContentRangeTotal` | `AdminTableRepo.listRows/count` (usa `pgrest…range().count()`) | 3er helper solapado; centraliza Range/Content-Range. |
| S4 | `app-settings.js:18/27` `supabaseConfig`/`serviceHeaders` | `lib/postgrest.js` (config/headers internos) | Config/headers duplicados; `app-settings` pasa a usar `pgrest`. |
| S5 | `:373` `_getAuthUserFromBearer` + bloques duplicados en `:3188` y `:3305` + `app-settings.js:153` `verifyAdminCaller` | `lib/auth/supabase-auth.js` `resolveBearerUser`/`verifyAdminCaller` | Misma resolución Bearer copiada 4×. |
| S6 | `:571` chatbot `get_quotation_status` (vía `_supabaseFetch`) | `QuotationsRepo.listForUser({userId,quoteId})` | Centraliza; **y expone bug de columnas inexistentes** `status`/`service_type`/`user_id` (§4-E). |
| S7 | `:3010` `POST /api/job-board/accept-application` (insert) | `QuotationsRepo.createFromJobBoard(payload)` | Insert de ~40 columnas inline. |
| S8 | `:3210` `/hide` (select por `quote_id`) | `QuotationsRepo.getByQuoteId(quoteId,{select})` | Lectura de ownership inline. |
| S9 | `:3228` `/hide` (claim por email) | `QuotationsRepo.claimForClient(id,userId)` | Idéntico a S11 (duplicado). |
| S10 | `:3247` `/hide` (set `client_deleted_at`) | `QuotationsRepo.softDeleteForClient(id)` | Soft-delete cliente. |
| S11 | `:3325` `/complete` (select) + `:3340` (claim) | `getByQuoteId` + `claimForClient` | Mismo patrón que /hide. |
| S12 | `:3377` `/complete` (set `completed`) | `QuotationsRepo.markCompletedByClient(id,userId)` | Gate de cierre verificado. |
| S13 | `:3987` `/api/analytics/quotations` (vía `supabaseQuery` anon) | `QuotationsAnalyticsRepo.fetchSince({since})` | Centraliza; decidir anon vs service_role (§4-A). |
| S14 | `:2333` `POST …/database/tables/:t/row` | `AdminTableRepo.insertRow(table,values)` | CRUD genérico admin (allow-list) — toca las 5 tablas. |
| S15 | `:2399` `PATCH …/row` | `AdminTableRepo.updateRow(table,idCol,idVal,patch)` | idem. |
| S16 | `:2435`+`:2443` `DELETE …/row` (select previo + delete) | `AdminTableRepo.getRow` + `deleteRow` | idem; hard-delete con protección superadmin. |

### 3.2 Frontend — `quotations.js` ("Mis Cotizaciones")

| # | Antes | Después | Razón |
|---|---|---|---|
| Q1 | `:10` `supabase.createClient(...)` propio | `ConfigManager.getSupabaseClient()` (vía la capa) | No re-crear cliente; usar el singleton autenticado. |
| Q2 | `:230` `loadQuotations` select | `QuotationsRepo.listForArtist` | Listado principal del artista. |
| Q3 | `:257` attachments `.in('quotation_id',quoteIds)` | `QuotationAttachmentsRepo.listByQuoteIds` | Join manual por `quote_id` (text). |
| Q4 | `:474` `bulkArchive` update `is_archived` | `QuotationsRepo.archiveByIds` | Soft-delete masivo. |
| Q5 | `:486` `bulkDelete` delete `.in('id')` | `QuotationsRepo.hardDeleteByIds` | Hard-delete masivo. |
| Q6 | `:497` `bulkUpdateStatus` | `QuotationsRepo.updateStatusByIds` | Cambio de estado masivo. |
| Q7 | `:509` `removeChannel` (teardown chat) | `ChatRealtime.teardown` | Centraliza limpieza de canal. |

### 3.3 Frontend — `shared-drawer.js` (detalle/acciones de cotización)

| # | Antes | Después | Razón |
|---|---|---|---|
| D1 | `:542` `saveRating` | `QuotationsRepo.setRating` | Update por `id`. |
| D2 | `:704` `updateQuoteStatus` | `QuotationsRepo.updateStatusById` | Transición de estado. |
| D3 | `:774` `updateQuotePriority` | `QuotationsRepo.updatePriority` | — |
| D4 | `:793` `loadNotesForQuote` | `QuotationNotesRepo.listForQuote` | Clave int `id`. |
| D5 | `:914`/`:918` `saveNote` (update/insert) | `QuotationNotesRepo.update`/`create` | — |
| D6 | `:947` `confirmDeleteNote` | `QuotationNotesRepo.delete` | Hard-delete. |
| D7 | `:1033` `loadSessionsForQuote` | `QuotationSessionsRepo.listForQuote` | — |
| D8 | `:1175`/`:1193` `saveSession` (update/insert) | `QuotationSessionsRepo.update`/`create` | `session_number` calculado en cliente (§4-G). |
| D9 | `:1226` `updateSessionStatus` | `QuotationSessionsRepo.updateStatus` | — |
| D10 | `:1316` `confirmDeleteSession` | `QuotationSessionsRepo.delete` | — |
| D11 | `:1424` `loadChatMessages` | `ChatRepo.listMessagesForQuote` | Clave text `quote_id`. |
| D12 | `:1545` `auth.getSession()` + `:1548` insert chat | `ChatRepo.sendMessage` (sender_type='artist') | — |
| D13 | `:1607` `markChatMessagesAsRead` | `ChatRepo.markClientMessagesRead` | — |
| D14 | `:1625` `getUnreadChatCount` | `ChatRepo.countUnreadClientMessages` | count head. |
| D15 | `:1662` `subscribeToChatUpdates` | `ChatRealtime.subscribeToMessages` | Centraliza canal. |
| D16 | `:1897` `submitConfirmation` (update) + `:1910` insert sesión | `QuotationsRepo.confirmFinalQuote` + `QuotationSessionsRepo.create` | — |
| D17 | `:2109` `saveQuoteEdits` | `QuotationsRepo.updateTattooDetails` | — |
| D18 | `:2160` `submitResponse` | `QuotationsRepo.submitArtistResponse` | — |
| D19 | `:2404` `unarchiveSingle` | `QuotationsRepo.setArchivedById(id,false)` | — |
| D20 | `:2419` `deleteSingle` | `QuotationsRepo.hardDeleteById` | — |

### 3.4 Frontend — `client-dashboard.js`

| # | Antes | Después | Razón |
|---|---|---|---|
| C1 | `:168` select huérfanas por email | `QuotationsRepo.findUnclaimedByEmail` | — |
| C2 | `:176` claim `.in('quote_id')` | `QuotationsRepo.claimByQuoteIds` | — |
| C3 | `:233` `loadQuotations` `.or(...)` interpolado | `QuotationsRepo.listForClient` | **Corrige inyección de filtro** (§4-B). |
| C4 | `:393` `hideQuotation` → `fetch('/api/.../hide')` | `QuotationsApi.hideForClient` | Mantiene Express; nombre único. |
| C5 | `:432` `loadUnreadCounts` (N+1) | `ChatRepo.countUnreadByQuotationIds` (batch) | **Corrige N+1** (§4-F). |
| C6 | `:645` `acceptQuotationCompletion` → `/complete` | `QuotationsApi.confirmCompletionByClient` | — |
| C7 | `:720` `loadChatMessages` | `ChatRepo.listByQuotation` | — |
| C8 | `:760` `markMessagesAsRead` | `ChatRepo.markArtistMessagesRead` | — |
| C9 | `:790` `sendChatMessage` | `ChatRepo.sendClientMessage` | — |
| C10 | `:832` `subscribeToChatMessages` | `ChatRealtime.subscribeMessagesByQuotation` | — |
| C11 | `:921` `setupRealtimeSubscriptions` (quotations UPDATE) | `QuotationsRealtime.subscribeUpdatesForClient` | — |
| C12 | `:940` `setupRealtimeSubscriptions` (chat INSERT) | `ChatRealtime.subscribeNewArtistMessages` | — |

### 3.5 Frontend — `calendar.js`

| # | Antes | Después | Razón |
|---|---|---|---|
| K1 | `:181` `loadQuotations` (activas) | `QuotationsRepo.listActiveForArtist` | — |
| K2 | `:210` attachments `.in('quotation_id')` | `QuotationAttachmentsRepo.listByQuoteIds` | Igual a Q3 (unificable). |
| K3 | `:222` sessions `.in('quotation_id', quoteDbIds)` | `QuotationSessionsRepo.listByQuotationIds` | Clave int `id` (≠ K2). |
| K4 | `:716` `bulkArchiveSingle` | `QuotationsRepo.setArchivedById(id,true)` | — |
| K5 | `:735` `updateQuoteStatus` (fallback) | `QuotationsRepo.updateStatusById` | — |
| K6 | `:986` set `google_event_id` | `QuotationSessionsRepo.setGoogleEventId` | Sync Google Calendar. |

### 3.6 Frontend — `archive.js`

| # | Antes | Después | Razón |
|---|---|---|---|
| A1 | `:168` select archivadas | `QuotationsRepo.listArchivedForArtist` | — |
| A2 | `:192` attachments | `QuotationAttachmentsRepo.listByQuoteIds` | — |
| A3 | `:378` unarchive `.in('id')` | `QuotationsRepo.setArchivedByIds(ids,false)` | — |
| A4 | `:390` delete `.in('id')` | `QuotationsRepo.hardDeleteByIds` | — |
| A5 | `:400` unarchive `.eq('id')` | `QuotationsRepo.setArchivedById(id,false)` | — |
| A6 | `:410` delete `.eq('id')` | `QuotationsRepo.hardDeleteById` | — |

### 3.7 Frontend — dashboards de artista (`dashboard.js`, `dashboard-redesign.js`)

| # | Antes | Después | Razón |
|---|---|---|---|
| B1 | `dashboard.js:1790` `populateQuotes` (counts) | `QuotationsRepo.statusCountsForArtist` | — |
| B2 | `dashboard-redesign.js:224` `loadCotizaciones` | `QuotationsRepo.listForArtist(...,{limit:40})` | — |
| B3 | `dashboard-redesign.js:268` `loadAgenda` (join embebido) | `QuotationsRepo.listUpcomingSessionsForArtist` | Recurso embebido PostgREST. |

### 3.8 Frontend — `admin.js` (backoffice)

| # | Antes | Después | Razón |
|---|---|---|---|
| M1 | `:450` `countAll` | `QuotationsRepo.countAll` | — |
| M2-4 | `:457/:465/:473` counts por estado | `QuotationsRepo.countByStatus(status)` | 3 llamadas repetidas → 1 método. |
| M5 | `:488` recientes | `QuotationsRepo.listRecent` | — |
| M6 | `:551` `loadQuotations` (trae todo) | `QuotationsRepo.listForAdmin({status,range})` | Añade paginación server-side. |
| M7 | `:721` `deleteQuotation` | `QuotationsRepo.hardDeleteById` | — |
| M8 | `:754` `deleteSelectedQuotations` | `QuotationsRepo.hardDeleteByIds` | — |
| M9-10 | `:7157/:7172` realtime INSERT/UPDATE | `QuotationsRealtime.subscribeForAdmin` | — |
| M11 | rutas legacy `:4592/:4659/:5083/:5145/:5385/:5479/:5535` (count/inspect/export por nombre, `supabase-js` directo) | `AdminTablesApi.*` (vía `/api/admin/database/…`, service_role) | **Decisión:** consolidar en las rutas activas no-legacy; el resto es código legacy candidato a borrar (§4-D). |
| M12 | rutas activas `:4765/:4783/:4805/:5021/:5037` (vía `/api/admin/database/…`) | `AdminTablesApi.listTablePage/exportTable/updateRow/insertRow/deleteRow` | Ya pasan por Express; sólo se envuelven cliente-side. |

### 3.9 Frontend — soporte / misc / wizard

| # | Antes | Después | Razón |
|---|---|---|---|
| P1 | `support-dashboard.js:198` `loadAllData` select todo | `QuotationsRepo.listAll` | — |
| P2 | `support-dashboard.js:1637` `updateQuoteField` | `QuotationsRepo.updateField(id,field,value)` | — |
| P3 | `support-dashboard.js:1721` `confirmAction` delete | `QuotationsRepo.hardDeleteById` | — |
| P4 | `statistics.js:51` `loadStatisticsData` | `QuotationsRepo.listForArtist` | — |
| P5 | `config-manager.js:1208` `getTableRowCounts` | `AdminTablesRepo.countTable` (genérico) | — |
| P6 | `client-auth.js:341/356/379` link/claim por email | `QuotationsRepo.findUnclaimedByEmail`/`claimByQuoteIds`/`claimByQuoteId` | Igual a C1/C2 (unificable). |
| P7 | `script.js:1415` `autoSaveQuotation` upsert | `QuotationsRepo.upsertDraft` | Comparte `preparePayload` con P8. |
| P8 | `script.js:3607` `submitQuotation` upsert | `QuotationsRepo.upsertFinal` | — |
| P9 | `script.js:1657` `checkEmailReuse` | `QuotationsRepo.findLatestByEmailForReuse` | **Revisar exposición de PII** (§4-C). |
| P10 | `script.js:3347` `saveAttachmentRecords` insert | `QuotationAttachmentsRepo.insertMany` | — |

### 3.10 `chat.js` — **código muerto**

| # | Antes | Decisión |
|---|---|---|
| X1-6 | `chat.js:66/165/203/228/245/365` (ChatManager sobre `chat_messages`) | **No migrar.** El crítico verificó que `chat.js` no está referenciado por ningún HTML ni loader (las coincidencias eran de `support-chat.js`). Propuesta: eliminar el archivo en un commit aparte tras confirmar. |

---

## 4. Hallazgos y riesgos detectados durante el inventario

> Surgieron al mapear el código. Para cada uno indico el tratamiento propuesto **dentro** del piloto vs lo que requiere tu decisión.

- **A. Analytics con anon key server-side** — `/api/analytics/quotations` (`server.js:3987`) usa `supabaseQuery` (anon key) corriendo en el servidor y sin auth de admin visible. Depende de RLS de anon: o devuelve vacío o expone datos. *Tratamiento:* la capa lo migra preservando comportamiento, pero **recomiendo decidir** moverlo a `service_role` + `verifyAdminCaller`. → decisión.
- **B. Inyección de filtro PostgREST** — `client-dashboard.js:233` interpola `email`/`user.id` directo en `.or(\`client_user_id.eq.${id},client_email.ilike.${email}\`)`. Un email con `,`/`)` puede romper el filtro. *Tratamiento:* `QuotationsRepo.listForClient` parametriza/escapa. **Se corrige en el piloto** (sin cambio de comportamiento esperado).
- **C. Exposición de PII por email** — `script.js:1657` `checkEmailReuse` lee `whatsapp/birth_date/health_conditions/allergies` filtrando `.neq('quote_status','in_progress')` con sesión anon. Bajo la RLS actual, anon sólo ve `in_progress`, así que **o RLS lo bloquea (feature ya rota) o hay un hueco de política**. *Tratamiento:* la capa **preserva el comportamiento**; marco la verificación de RLS en pruebas. → posible decisión.
- **D. Código admin legacy duplicado** — `admin.js` tiene rutas `*Legacy` (count/inspect/export con `supabase-js` directo) en paralelo a las activas (vía API admin). *Tratamiento:* migrar sólo las activas; marcar las legacy para borrado. → decisión (borrar vs mantener).
- **E. Bug latente en chatbot** — `server.js:571` (`get_quotation_status`) hace `select=id,status,service_type,...` pero `quotations_db` **no tiene** `status`/`service_type`/`user_id` (tiene `quote_status`/`client_user_id`/`artist_id`). La query probablemente falla hoy. *Tratamiento:* `QuotationsRepo.listForUser` usa columnas reales → **corrige el bug** (verificar contrato del chatbot). → señalar.
- **F. N+1 en no leídos** — `client-dashboard.js:432` consulta `chat_messages` una vez por cotización. *Tratamiento:* `ChatRepo.countUnreadByQuotationIds` agrupa en una query. **Mejora incluida**.
- **G. `session_number` en cliente** — `shared-drawer.js:1193` calcula `session_number = length+1` (riesgo de colisión concurrente). *Tratamiento:* fuera de alcance; anotar para una secuencia/columna server-side futura.
- **H. Hard-delete sin cascada verificada** — varios `delete()` sobre `quotations_db` no borran hijas; depende de `ON DELETE CASCADE`. *Tratamiento:* verificar FKs en pruebas; no cambiar comportamiento.
- **I. Inconsistencia de clave de relación** — hijas mezclan int `id` (notes/sessions) y text `quote_id` (attachments/chat). *Tratamiento:* **encapsulado** en los repos; ningún llamador vuelve a decidirlo.

---

## 5. Plan de despliegue (gated)

**Estrategia: coexistencia + migración incremental** — la capa nueva se agrega sin borrar lo viejo; se migra archivo por archivo; en ningún punto se rompe la API ni el contrato.

1. **Construir la capa** (local): `lib/postgrest.js`, `lib/repos/quotations.js`, `lib/auth/supabase-auth.js`, `public/shared/js/data/postgrest-client.js`, `public/shared/js/data/quotations-repo.js`.
2. **Migrar backend**: endpoints de cotizaciones (`/hide`, `/complete`, job-board accept, analytics, chatbot tool) + el CRUD admin genérico → repos. Borrar los helpers solapados una vez sin usos.
3. **Migrar frontend** por módulo en orden de riesgo creciente: `statistics` → `quotations` → `archive` → `calendar` → `shared-drawer` → `client-dashboard` → dashboards → `admin` → `script` (wizard). Incluir los `<script>` de la capa en los HTML correspondientes.
4. **Tests locales** (§6) en verde: `node --test "tests/*.test.js"` + nuevos tests de la capa + smoke manual con preview tools.
5. **Deploy a `beta.weotzi.com`** vía `scripts/deploy.py` (SSH + PM2) — **sólo tras tu visto bueno**.
6. **Smoke test en producción** de los flujos críticos (crear cotización, responder, chatear, archivar, completar).

**Rollback:** como es coexistencia + git, el rollback es revertir el commit del módulo afectado y `scripts/deploy.py` de nuevo. La capa no toca esquema, así que no hay migración que revertir.

**Commits** (convención del repo): `feat(data): capa postgrest unificada (lib + frontend)`, `refactor(quotations): migrar <módulo> a QuotationsRepo`, etc. Rama `feature/postgrest-capa-unificada` desde `main`.

---

## 6. Plan de pruebas

- **Unitarias (node:test)**: `lib/postgrest.js` (construcción de query: select/eq/in/order/range/Prefer; escape de filtros; manejo de error/204/FK). `lib/repos/quotations.js` (mapeo de cada método al request PostgREST esperado, con `fetch` mockeado).
- **Contрато PostgREST**: para cada método de repo, verificar que la URL/método/headers/body generados igualan al `fetch` anterior (test de equivalencia "antes vs después").
- **RLS / seguridad**: con anon key vs service_role, confirmar que (a) anon sólo ve `in_progress`; (b) artista sólo ve lo suyo; (c) el fix de §4-B no cambia resultados; (d) §4-C se comporta como hoy. Vía `execute_sql`/llamadas REST controladas.
- **Smoke E2E (preview tools)**: wizard (autosave+submit) → aparece en dashboard artista → responder → chat bidireccional → archivar/restaurar → completar (cliente) → analytics refleja. Verificar consola/red sin errores.
- **Regresión backend**: `node --test "tests/*.test.js"` + `npm run test:prequote`.
- **Checklist por flujo** (§1.4): marcar cada proceso como verificado antes del deploy.

---

## 7. Criterios de aceptación (Definition of Done del piloto)

1. Los **113 sitios** del cluster cotizaciones acceden a datos **sólo** a través de la capa unificada (cero `fetch('/rest/v1/…')` inline y cero `_supabase.from('quotations_db'…)` fuera de los repos, dentro del alcance).
2. Los helpers server solapados (`_supabaseFetch`, `supabaseQuery`, `fetchAdminTableRows`, config/headers duplicados) quedan **eliminados o delegando** en `lib/postgrest.js`.
3. Sin nuevas dependencias npm; `supabase-js` sigue siendo el transporte frontend.
4. RLS y `service_role` intactos; los fixes de §4 (B, F) aplicados; A/C/D/E documentados con decisión registrada.
5. Tests en verde + smoke E2E + smoke producción tras deploy.
6. Documentación actualizada: este doc + `docs/MAPA_APLICACION.md`/`docs/TECHNICAL.md` con la nueva capa, y la guía para construir dominios futuros sobre ella.

---

## 8. Estado de implementación — 2026-06-21 (local, deploy pendiente de OK)

**Capa construida (sin dependencias nuevas):**
- Servidor: [lib/postgrest.js](../../lib/postgrest.js) (query-builder sobre `fetch`), [lib/repos/quotations.js](../../lib/repos/quotations.js), [lib/auth/supabase-auth.js](../../lib/auth/supabase-auth.js). `lib/app-settings.js` ahora delega en ambas.
- Frontend: [public/shared/js/data/postgrest-client.js](../../public/shared/js/data/postgrest-client.js) + [public/shared/js/data/quotations-repo.js](../../public/shared/js/data/quotations-repo.js). Inyectados (vía `<script>`) en las 33 páginas que cargan `config-manager.js`.

**Migración de los 113 sitios:**
- Backend: helpers `_supabaseFetch`/`fetchAdminTableRows`/`_getAuthUserFromBearer` ahora **delegan** en la capa (las ~60 llamadas no-cotización siguen intactas). Endpoints de cotizaciones (`/hide`, `/complete`, job-board accept, chatbot tool) migrados a `QuotationsRepo`.
- Frontend: los 13 módulos migrados a los repos. **Cero `_supabase.from('<cluster>')` directos** fuera de `quotations-repo.js` (verificado por grep).

**Fixes aplicados:** §4-A (analytics → service_role + `verifyAdminCaller`, devuelve 401 sin token), §4-B (inyección de filtro en `.or()` del cliente), §4-E (columnas reales del chatbot), §4-F (N+1 → `countUnreadByQuotationIds` batch), §4-X (borrado de `chat.js` muerto + 4 funciones `*Legacy` de admin, 162 líneas).

**Verificación:** `node --test "tests/*.test.js"` → **122/122** + 13 tests nuevos de `lib/postgrest.js`. Smoke en navegador (servidor real): `window.WeotziData` y los 7 repos cargan; `findUnclaimedByEmail` ejecuta contra la BD viva sin error; sin errores de consola; `/api/analytics/quotations` → 401, `/api/client-info` → 200.

**Follow-ups (fuera del piloto, anotados):**
- §4-C: verificar en pruebas la exposición de PII por email (`findLatestByEmailForReuse`) vs RLS — comportamiento preservado, no corregido.
- §4-G: `session_number` calculado en cliente (riesgo de colisión) — mover a secuencia server-side.
- Los analytics NO-cotización (`users`/`devices`/`pages`/`errors`/`locations`/`summary`) siguen usando `supabaseQuery` (anon) — migrar al unificar el dominio analytics.
- Migrar los demás dominios (artistas, estudios, soporte, job board) a la misma capa, reusando `lib/postgrest.js`.

**Pendiente:** deploy a `beta.weotzi.com` vía `scripts/deploy.py` (esperando visto bueno).
```
