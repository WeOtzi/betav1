# Catálogo de queries con nombre — Capa PostgREST unificada

> Lista completa de **todos los métodos de acceso a datos con nombre** de la capa
> (frontend `window.WeotziData.*` y servidor `lib/repos/*`), con su firma, qué
> devuelve y qué hace cada uno. Es el "diccionario" de queries del proyecto.
>
> Estándar y cómo usarlo: [docs/GUIA_CAPA_DATOS.md](GUIA_CAPA_DATOS.md).

## Dos estilos de retorno

- **Repos "ricos" (Cotizaciones)** — los métodos **resuelven** la query y **devuelven los datos** (lanzan `Error` en fallo). Ej.: `const quotes = await WeotziData.Quotations.listForArtist(id)`.
- **Repos "finos" (Artistas/Estudios)** — los métodos **devuelven el builder** de supabase-js sin resolver, conservando el contrato `{ data, error }`. Ej.: `const { data, error } = await WeotziData.Artists.getByUserId(id)`. (Elegido así para que la migración del choke-point fuera mecánica y sin cambiar el manejo de error.)

---

# 1. Frontend — `window.WeotziData`

## 1.1 Primitivos de la capa (`data/postgrest-client.js`)

| Método | Firma | Devuelve | Qué hace |
|---|---|---|---|
| `getClient` | `getClient()` | cliente supabase-js | El singleton autenticado (RLS bajo la sesión). |
| `run` | `run(label, builder)` | `{ data, count }` (lanza en error) | Ejecuta un builder y normaliza el error con etiqueta. Base de los repos "ricos". |
| `from` | `from(table)` | builder supabase-js | **Choke-point**: acceso a tabla sobre el cliente único, contrato `{ data, error }`. |
| `channel` | `channel(name, opts?)` | canal realtime | Suscripción realtime sobre el cliente único. |
| `removeChannel` | `removeChannel(ch)` | — | Baja un canal realtime. |
| `orValue` | `orValue(v)` | string | Escapa un valor para incrustarlo en `.or(...)` (anti-inyección). |

## 1.2 `WeotziData.Quotations` (cotizaciones) — estilo rico

| Método | Devuelve | Qué hace |
|---|---|---|
| `listForArtist(artistUserId, opts?)` | rows | Cotizaciones del artista (opts: excludeArchived, excludeInProgress, order, limit, select). |
| `listActiveForArtist(uid, opts?)` | rows | Activas (no archivadas, sin borradores `in_progress`). |
| `listArchivedForArtist(uid, select?)` | rows | Archivadas del artista (`is_archived=true`). |
| `listForClient(userId, email, select?)` | rows | Del cliente por `client_user_id` o email (no ocultas); email escapado. |
| `listForAdmin({status?, select?})` | rows | Listado de backoffice, filtro de estado opcional. |
| `listAll(select?)` | rows | Todas (soporte; acotado por RLS). |
| `listRecent(limit=5, select?)` | rows | Recientes para el dashboard admin. |
| `statusCountsForArtist(uid)` | rows`{quote_status}` | Filas para contar por estado (el caller agrega). |
| `countAll()` | number | Conteo total. |
| `countByStatus(status)` | number | Conteo por estado. |
| `setRating(id, {rating,reason,comment})` | — | Setea rating/razón/comentario. |
| `updateStatusById(id, newStatus)` | — | Cambia `quote_status` por PK. |
| `updatePriority(id, newPriority)` | — | Cambia prioridad. |
| `setArchivedById(id, archived)` / `setArchivedByIds(ids, archived)` | — | Archiva/desarchiva (soft-delete del artista). |
| `updateStatusByIds(ids, newStatus)` | — | Cambio de estado masivo. |
| `updateField(id, field, value)` | — | Update de un campo (inspector de soporte). |
| `updateById(id, patch)` | — | Patch arbitrario por PK. |
| `hardDeleteById(id)` / `hardDeleteByIds(ids)` | — | Borrado permanente por PK. |
| `hardDeleteByQuoteId(quoteId)` / `hardDeleteByQuoteIds(quoteIds)` | — | Borrado permanente por `quote_id` (texto). |
| `upsert(payload)` | rows | Upsert por `quote_id` (autosave/submit del wizard). |
| `findLatestByEmailForReuse(email, select?)` | row\|null | Última cotización no-`in_progress` por email (reuso de datos). |
| `findUnclaimedByEmail(email)` | rows`{quote_id}` | Cotizaciones huérfanas (sin `client_user_id`) por email. |
| `claimByQuoteIds(userId, quoteIds)` / `claimByQuoteId(userId, quoteId)` | — | Vincula cotizaciones al cliente. |

## 1.3 `WeotziData.Notes` (quotation_notes · clave int `id`)
| Método | Qué hace |
|---|---|
| `listForQuote(quotationId)` | Notas de la cotización (orden `note_date` desc). |
| `create(note)` / `update(noteId, patch)` / `delete(noteId)` | CRUD de notas. |

## 1.4 `WeotziData.Sessions` (quotation_sessions · clave int `id`)
| Método | Qué hace |
|---|---|
| `listForQuote(quotationId)` | Sesiones de la cotización (orden `session_date` asc). |
| `listByQuotationIds(ids)` | Sesiones de varias cotizaciones (calendario). |
| `listUpcomingForArtist(fromIso, opts?)` | Próximas sesiones con datos de la cotización embebidos. |
| `create(s)` / `update(id,patch)` / `updateStatus(id,status)` / `setGoogleEventId(id,eventId)` / `delete(id)` | CRUD + estado + sync Google Calendar. |

## 1.5 `WeotziData.Attachments` (quotations_attachments · clave text `quote_id`)
| Método | Qué hace |
|---|---|
| `listByQuoteIds(quoteIds)` | Adjuntos de varias cotizaciones. |
| `insertMany(records)` | Inserta N adjuntos (referencias del wizard). |

## 1.6 `WeotziData.Chat` (chat_messages · clave text `quote_id`)
| Método | Qué hace |
|---|---|
| `listByQuote(quoteId)` | Hilo de chat (orden cronológico). |
| `sendMessage({quoteId,senderType,senderId,message})` | Envía un mensaje. |
| `markRead(quoteId, fromSenderType)` | Marca leídos los del otro lado. |
| `countUnread(quoteId, fromSenderType)` | Cuenta no leídos (1 cotización). |
| `countUnreadByQuotationIds(quoteIds, fromSenderType)` | No leídos de N cotizaciones en 1 query (batch). |

## 1.7 `WeotziData.Realtime` (suscripciones)
| Método | Qué hace |
|---|---|
| `subscribeChatMessages(channel, quoteId, onInsert)` | INSERT de chat de una cotización. |
| `subscribeNewChatFromSender(channel, senderType, onInsert)` | INSERT de chat de un sender (badges). |
| `subscribeQuotationUpdates(channel, onUpdate)` | UPDATE de cotizaciones (cliente). |
| `subscribeQuotationsForAdmin(channel, {onInsert,onUpdate})` | INSERT/UPDATE de cotizaciones (admin). |
| `remove(ch)` | Baja un canal. |

## 1.8 `WeotziData.Api` (operaciones mediadas por Express)
| Método | Qué hace |
|---|---|
| `hideForClient(quoteId, accessToken)` | POST `/api/client/quotations/:id/hide` (soft-delete del cliente). |
| `confirmCompletionByClient(quoteId, accessToken)` | POST `/api/client/quotations/:id/complete` (cierre verificado). |

---

## 1.9 `WeotziData.Artists` (artists_db) — estilo fino `{ data, error }`

| Método | Devuelve | Qué hace |
|---|---|---|
| `getByUserId(userId, columns='*')` | `.maybeSingle()` | Registro del artista por `user_id` (auth/perfil propio). |
| `getByUserIdSingle(userId, columns='*')` | `.single()` | Perfil propio completo que exige fila. |
| `getDashboardByUserId(userId)` | `.maybeSingle()` | Registro completo del dashboard (columnas fijas encapsuladas). |
| `getProfileByUserId(userId)` | `.maybeSingle()` | Perfil para auth/onboarding (sin password). |
| `getProfileByEmail(email)` | `.maybeSingle()` | Perfil incompleto por email para reanudar alta. |
| `getContactByUserId(userId)` | `.maybeSingle()` | `email` + `whatsapp_number` (logging). |
| `getGalleryFeedItems(userId)` | `.single()` | `gallery_feed_items` (lectura previa al merge de galería). |
| `getPublicByUsername(username, columns='*')` | `.single()` | Perfil público por username (`ilike`). |
| `getPublicByExactUsername(username, columns='*')` | `.maybeSingle()` | Perfil público por username exacto (página pública). |
| `findByUsername(username, columns, {exact})` | `.limit(1)` | Lookup por username (feed de galería). |
| `isUsernameAvailable(username, currentUserId)` | lista | Filas con ese username tomadas por otro (caller: vacío = disponible). |
| `listPublic(columns='*')` | lista | Todos los artistas públicos (RLS acota). |
| `listAll(columns='*')` | lista | Lista completa (soporte/backoffice). |
| `listByUserIds(userIds, columns='*')` | lista | Batch por `user_id` (`.in`). |
| `searchByUsernameOrName(term, limit=8)` | lista | Búsqueda por username/nombre (invitar al roster). |
| `searchCities(query, limit=10)` | lista | Ciudades de perfiles (autocompletado). |
| `listWithLocation(columns=…)` | lista | Vista `artists_with_location` (pines del mapa/globo). |
| `listForMap(columns=…)` | lista | Fallback a `artists_db` para el mapa. |
| `count()` | `{count}` | Conteo total de artistas. |
| `updateByUserId(userId, patch)` | update | Patch arbitrario por `user_id`. |
| `updateByUserIdReturning(userId, patch)` | `.select('user_id')` | Update que devuelve `user_id` (detectar fallos RLS). |
| `upsertProfile(artistData)` | `.select()` | Crea/actualiza el registro principal (`onConflict user_id`). |

## 1.10 `WeotziData.ArtistLocations` (artist_tattoo_locations)
| Método | Qué hace |
|---|---|
| `listByArtistUserId(artistUserId, columns='*')` | Ubicaciones ordenadas (sort_order, start_date). |
| `listSimpleByArtistUserId(artistUserId, columns='*')` | Ubicaciones sin orden (itinerario del globo). |
| `searchCities(query, limit=10)` | Ciudades de ubicaciones (autocompletado). |
| `insertMany(rows)` / `deleteByArtistUserId(artistUserId)` | Insert bulk / borrado total. |
| `replaceForArtist(artistUserId, rows)` | Replace-all (borra + reinserta). |
| `upsertCurrentLocation(row)` | Upsert de la ubicación/estudio actual. |

## 1.11 `WeotziData.ArtistVisits` (artist_profile_visits)
| Método | Qué hace |
|---|---|
| `listVisitsByArtistSince(artistId, sinceIso, limit)` | Visitas crudas en un rango (mapa de visitantes). |
| `listDailyVisitsByArtist(artistId, limit=1000)` | Visitas agregadas por día (rango "all"). |

## 1.12 `WeotziData.Studios` (studios)
| Método | Qué hace |
|---|---|
| `getById(studioId, columns='*')` / `getBySlug(slug, columns='*')` | Estudio por id / por slug. |
| `getAddressById(studioId)` | Columnas de dirección (borrador del dashboard del artista). |
| `getByUserId(userId, columns='*')` | Estudio del usuario autenticado (panel). |
| `getByOwnerUserId(userId, columns=…)` | Estudio del usuario (como reviewer). |
| `getOwnedByUser(studioId, userId, columns=…)` | Verifica ownership (id + dueño). |
| `searchByNormalizedName(q, {limit,columns})` | Búsqueda por nombre normalizado (autocompletado). |
| `findIdByNormalizedName(name, {single})` | id por nombre normalizado (find-or-create). |
| `createMinimal({name,normalizedName})` / `create(payload)` | Crea estudio mínimo / completo. |
| `update(studioId, patch)` / `updateProfile(studioId, patch)` | Patch / guardar perfil. |
| `updateAddress(studioId, addressPatch)` | Persiste dirección geocodificada. |
| `setPrimaryLocation(studioId, locationId)` | Apunta la sede principal. |

## 1.13 `WeotziData.StudioLocations` (studio_locations)
| Método | Qué hace |
|---|---|
| `listByStudio(studioId, columns='*')` / `listActiveByStudio(studioId, columns='*')` | Sedes (todas / activas ordenadas). |
| `listPrimaryWithStudioForMap()` | Sedes primarias con estudio embebido (mapa). |
| `listPrimaryByStudioIds(studioIds, columns=…)` | Bulk de sedes primarias (itinerario). |
| `demotePrimary(studioId)` | Degrada la primaria actual. |
| `createLocation(payload)` / `updateLocation(id, patch)` / `deleteLocation(id)` / `createMany(rows)` | CRUD de sedes. |

## 1.14 `WeotziData.StudioMemberships` (studio_artist_memberships)
| Método | Qué hace |
|---|---|
| `listRoster(studioId)` | Roster (active/pending/paused) con artista embebido. |
| `listActiveRosterWithArtists(studioId)` | Roster activo con artista (perfil público). |
| `listActiveArtists(studioId, {withRole})` | Artistas activos (embed mínimo) para selectores. |
| `listPendingForArtist(artistUserId)` | Invitaciones pendientes (estudio+sede embebidos). |
| `listActiveForArtist(artistUserId)` | Memberships activas del artista. |
| `createMembership(payload)` / `inviteArtist(payload)` | Membership directa / invitación. |
| `updateMembership(id, patch)` / `endMembership(id)` / `resumeMembership(id)` / `deleteMembership(id)` | Lifecycle de membership. |
| `respondToInvitation(id, artistUserId, action)` | Artista acepta/rechaza invitación. |

## 1.15 `WeotziData.StudioSpots` (studio_spots + applications/attachments)
| Método | Qué hace |
|---|---|
| `listByStudio(studioId)` | Spots del estudio (panel). |
| `listOpenWithStudioAndLocation()` | Directorio público de spots abiertos (embeds). |
| `getById(spotId, columns='*')` / `getSummaryById(spotId)` | Spot completo / mínimo. |
| `createSpot(payload)` / `updateSpot(spotId, payload)` / `updateStatus(spotId, status)` / `deleteSpot(spotId)` | CRUD de spots. |
| `deleteAttachmentsBySpot(spotId)` / `insertAttachment(att)` | Adjuntos del spot. |
| `listApplications(spotId)` | Postulaciones con artista embebido. |
| `getApplication(spotId, artistUserId)` / `createApplication({…})` / `decideApplication(id, status)` | Postulación: ver/crear/decidir. |

## 1.16 `WeotziData.StudioOps` (operaciones: jobs, invoices, documents, inventory, suppliers, sponsors, métricas)
| Método | Qué hace |
|---|---|
| `listJobs(studioId, {limit})` / `listJobsForClientAggregation(studioId)` / `getJobById(id)` / `createJob(p)` / `updateJob(id,p)` / `deleteJob(id)` | Ledger de trabajos. |
| `listInvoices(studioId)` / `getInvoiceById(id)` / `createInvoice(h)` / `updateInvoice(id,h)` / `markInvoicePaid(id)` / `deleteInvoice(id)` | Facturas (cabecera). |
| `listInvoiceItems(invoiceId)` / `insertInvoiceItems(rows)` / `deleteInvoiceItems(invoiceId)` | Ítems de factura. |
| `listDocuments(studioId)` / `getDocumentById(id)` / `createDocument(p)` / `updateDocument(id,p)` / `deleteDocument(id)` | Documentos. |
| `listInventoryItems(studioId)` / `getInventoryItemById(id)` / `createInventoryItem(p)` / `updateInventoryItem(id,p)` / `deleteInventoryItem(id)` | Inventario (con proveedor embebido). |
| `createInventoryMovement(p)` / `listInventoryHealth(studioId)` | Movimiento de stock / vista de salud. |
| `listSuppliers(studioId)` / `listSupplierOptions(studioId)` / `getSupplierById(id)` / `createSupplier(p)` / `updateSupplier(id,p)` / `deleteSupplier(id)` | Proveedores. |
| `listSponsors(studioId)` / `listPublicSponsors(studioId)` / `getSponsorById(id)` / `createSponsor(p)` / `updateSponsor(id,p)` / `deleteSponsor(id)` | Sponsors. |
| `listSponsorArtistsBySponsorIds(ids)` / `listSponsorArtistIds(sponsorId)` / `insertSponsorArtists(rows)` / `deleteSponsorArtists(sponsorId)` | Vínculo sponsor-artista. |
| `getDashboardMetrics(studioId, {months})` / `getArtistPerformance(studioId, {limit})` | Vistas de métricas/performance. |

---

# 2. Servidor — `lib/`

## 2.1 `lib/postgrest.js` — query-builder + escape
`pgrest(table, {key})` encadena `.select/.eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in/.or/.order/.limit/.range/.onConflict/.count/.single` y termina con `.execute()` (lectura), `.insert/.upsert/.patch/.delete` (escritura). `pgrest.raw(path, {method,body,prefer,key,apiKey})` para paths arbitrarios. Default service-role; `{key:'anon'}` o `{apiKey}` para anon.

## 2.2 `lib/repos/quotations.js` — `QuotationsRepo`
| Método | Qué hace |
|---|---|
| `getByQuoteId(quoteId, {select})` | Cotización por `quote_id`. |
| `claimForClient(id, clientUserId)` | Auto-link por email (setea `client_user_id`). |
| `softDeleteForClient(id)` | Soft-delete del cliente (`client_deleted_at`). |
| `markCompletedByClient(id, clientUserId, at?)` | Cierre verificado (`artist_completed`→`completed`). |
| `createFromJobBoard(payload)` | Inserta una cotización desde el job board. |
| `listForUser({userId, quoteId})` | Cotizaciones del usuario (tool del chatbot). |
| `fetchAnalyticsSince(sinceIso)` | Datos para `/api/analytics/quotations` (service-role). |

## 2.3 `lib/repos/jobboard.js` — `JobBoardRepo`
| Método | Qué hace |
|---|---|
| `getApplicationById(id)` / `getRequestById(id)` | Lecturas para aceptar postulación. |
| `acceptApplication(id)` | Marca la postulación aceptada. |
| `rejectOtherApplications(requestId, exceptId)` | Rechaza las demás postulaciones. |
| `closeRequestAsAccepted(requestId, {artistId, applicationId, quoteId})` | Cierra el request. |

## 2.4 `lib/repos/currencies.js` — `CurrenciesRepo`
| Método | Qué hace |
|---|---|
| `listActive()` | Monedas activas (anon). |
| `upsertRates(rows, {returning})` | Upsert de tasas (`onConflict code`). |
| `logRefresh(entry)` | Registra una corrida de refresco. |

## 2.5 `lib/repos/instagram.js` — `InstagramRepo`
| Método | Qué hace |
|---|---|
| `countSince(sinceIso)` / `countTotal()` | Conteos de importaciones. |
| `sumCost()` | Suma del costo estimado. |
| `recent()` / `sinceForDailyBreakdown(sinceIso)` | Listados para stats. |

## 2.6 `lib/auth/supabase-auth.js`
`resolveBearerUser(req)` (usuario desde el Bearer), `verifyAdminCaller(req)` (gate de superadmin), `isSuperadminEmail(email)`, `bearerToken(req)`.

---

> **Excepciones legítimas** (no pasan por repos/choke-point, documentado): `.storage.from(...)` (buckets), `.auth.*`, `resolveArtistAuthState` (cliente inyectado para tests), el `testClient` ad-hoc del backoffice, los bucles de backup genéricos de `admin.js` (acceso por nombre de tabla dinámico), y dos **fallbacks raw-REST intencionales** a `artists_db` (`dashboard.js fetchDashboardArtistViaRest`, `artist-auth.js fetchArtistViaRest`) que existen justamente para evitar el cliente supabase-js cuando éste agota su timeout.
