# Catálogo de queries con nombre — Capa PostgREST unificada

> Lista completa de **todos los métodos de acceso a datos con nombre** de la capa
> (frontend `window.WeotziData.*` y servidor `lib/repos/*`), con la **query inline
> que reemplazó** ("Antes"), qué hace, y qué devuelve. Es el "diccionario" de
> queries del proyecto + el mapa de qué función vieja → qué método nuevo.
>
> Estándar y cómo usarlo: [docs/GUIA_CAPA_DATOS.md](GUIA_CAPA_DATOS.md). Reemplazo
> 1-a-1 del piloto Cotizaciones: [docs/plans/2026-06-21-postgrest-capa-unificada-piloto-cotizaciones.md](plans/2026-06-21-postgrest-capa-unificada-piloto-cotizaciones.md) §3.

## Cómo leer la columna "Antes"

La columna **Antes** muestra la **query inline en supabase-js** que el método ahora
encapsula — es decir, lo que antes estaba escrito (y disperso) en el call site.
La evolución de cada acceso fue: `_supabase.from('tabla')…` (disperso, original) →
`WeotziData.from('tabla')…` (choke-point unificado) → **método con nombre** (hoy).
En la columna "Antes" se omite el prefijo del cliente y los `select(...)` muy largos
se abrevian a su constante; los **filtros y el terminal** (`.eq/.in/.or/.order/.maybeSingle/.single/.insert/.update/.delete/...`) se muestran tal cual porque son lo que identifica la query.

## Dos estilos de retorno

- **Repos "ricos" (Cotizaciones)** — el método **resuelve** y **devuelve los datos** (lanza `Error` en fallo). Internamente usa `run('label', c => c.from(...)...)`.
- **Repos "finos" (Artistas/Estudios)** — el método **devuelve el builder** `{ data, error }` sin resolver. Internamente `from('tabla')...` directo.

---

# 1. Frontend — `window.WeotziData`

## 1.1 Primitivos de la capa (`data/postgrest-client.js`)

| Método | Antes | Qué hace |
|---|---|---|
| `getClient()` | `window._supabase` / `supabase.createClient(...)` por módulo | El cliente singleton autenticado (RLS bajo la sesión). |
| `run(label, builder)` | `const {data,error} = await _supabase…; if(error)…` | Ejecuta un builder y normaliza el error. Base de los repos "ricos". |
| `from(table)` | `_supabase.from(table)` disperso por módulo | **Choke-point**: builder sobre el cliente único, contrato `{ data, error }`. |
| `channel(name)` / `removeChannel(ch)` | `_supabase.channel(...)` / `_supabase.removeChannel(...)` | Realtime sobre el cliente único. |
| `orValue(v)` | interpolación cruda en `.or(...)` | Escapa un valor para `.or(...)` (anti-inyección). |

## 1.2 `WeotziData.Quotations` (quotations_db) — estilo rico

| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listForArtist(uid, opts?)` | `.from('quotations_db').select(sel).eq('artist_id',uid)[.eq('is_archived',false)][.neq('quote_status','in_progress')][.order(..)][.limit(..)]` | Cotizaciones del artista (filtros configurables). |
| `listActiveForArtist(uid, opts?)` | idem con `is_archived=false` + `neq in_progress` | Activas (atajo). |
| `listArchivedForArtist(uid, sel?)` | `.select(sel).eq('artist_id',uid).eq('is_archived',true)` | Archivadas. |
| `listForClient(userId, email, sel?)` | `.select(sel).or('client_user_id.eq.<id>,client_email.ilike.<email>').is('client_deleted_at',null).order('created_at',desc)` | Del cliente (email escapado). |
| `listForAdmin({status?,sel?})` | `.select(sel).order('created_at',desc)[.eq('quote_status',status)]` | Backoffice, filtro opcional. |
| `listAll(sel?)` | `.select(sel).order('created_at',desc)` | Todas (soporte). |
| `listRecent(limit=5, sel?)` | `.select('quote_id,client_full_name,artist_name,created_at,quote_status').order('created_at',desc).limit(5)` | Recientes (dashboard admin). |
| `statusCountsForArtist(uid)` | `.select('quote_status').eq('artist_id',uid).neq('quote_status','in_progress')` | Filas para contar por estado. |
| `countAll()` | `.select('*',{count:'exact',head:true})` | Conteo total. |
| `countByStatus(status)` | `.select('*',{count,head}).eq('quote_status',status)` | Conteo por estado. |
| `setRating(id,{rating,reason,comment})` | `.update({rating,rating_reason,rating_comment}).eq('id',id)` | Setea rating. |
| `updateStatusById(id,status)` | `.update({quote_status:status}).eq('id',id)` | Cambia estado por PK. |
| `updatePriority(id,p)` | `.update({priority:p}).eq('id',id)` | Cambia prioridad. |
| `setArchivedById(id,a)` / `setArchivedByIds(ids,a)` | `.update({is_archived:a}).eq('id',id)` / `.in('id',ids)` | Archiva/desarchiva. |
| `updateStatusByIds(ids,status)` | `.update({quote_status}).in('id',ids)` | Estado masivo. |
| `updateField(id,field,value)` | `.update({[field]:value}).eq('id',id)` | Un campo (soporte). |
| `updateById(id,patch)` | `.update(patch).eq('id',id)` | Patch por PK. |
| `hardDeleteById(id)` / `hardDeleteByIds(ids)` | `.delete().eq('id',id)` / `.in('id',ids)` | Borrado por PK. |
| `hardDeleteByQuoteId(q)` / `hardDeleteByQuoteIds(qs)` | `.delete().eq('quote_id',q)` / `.in('quote_id',qs)` | Borrado por `quote_id`. |
| `upsert(payload)` | `.upsert([payload],{onConflict:'quote_id'})` | Upsert del wizard. |
| `findLatestByEmailForReuse(email,sel?)` | `.select(<9 cols PII>).ilike('client_email',email).neq('quote_status','in_progress').order('created_at',desc).limit(1)` | Última por email (reuso). |
| `findUnclaimedByEmail(email)` | `.select('quote_id').ilike('client_email',email).is('client_user_id',null)` | Huérfanas por email. |
| `claimByQuoteIds(uid,qs)` / `claimByQuoteId(uid,q)` | `.update({client_user_id:uid}).in('quote_id',qs)` / `.eq('quote_id',q).is('client_user_id',null)` | Vincula al cliente. |

## 1.3 `WeotziData.Notes` (quotation_notes · clave int `id`)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listForQuote(quotationId)` | `.from('quotation_notes').select('*').eq('quotation_id',id).order('note_date',desc)` | Notas de la cotización. |
| `create(note)` | `.insert([note])` | Crea nota. |
| `update(noteId,patch)` | `.update(patch).eq('id',noteId)` | Edita nota. |
| `delete(noteId)` | `.delete().eq('id',noteId)` | Borra nota. |

## 1.4 `WeotziData.Sessions` (quotation_sessions · clave int `id`)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listForQuote(quotationId)` | `.select('*').eq('quotation_id',id).order('session_date',asc)` | Sesiones de la cotización. |
| `listByQuotationIds(ids)` | `.select('*').in('quotation_id',ids).order('session_date',asc)` | Sesiones de varias (calendario). |
| `listUpcomingForArtist(fromIso,opts?)` | `.select('…,quotations_db(client_full_name,tattoo_style,tattoo_body_part)').gte('session_date',fromIso).order('session_date',asc).limit(20)` | Próximas con cotización embebida. |
| `create(s)` | `.insert([s])` | Crea sesión. |
| `update(id,patch)` | `.update(patch).eq('id',id)` | Edita sesión. |
| `updateStatus(id,status)` | `.update({status}).eq('id',id)` | Cambia estado. |
| `setGoogleEventId(id,eventId)` | `.update({google_event_id}).eq('id',id)` | Sync Google Calendar. |
| `delete(id)` | `.delete().eq('id',id)` | Borra sesión. |

## 1.5 `WeotziData.Attachments` (quotations_attachments · clave text `quote_id`)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listByQuoteIds(quoteIds)` | `.from('quotations_attachments').select('*').in('quotation_id',quoteIds)` | Adjuntos de varias cotizaciones. |
| `insertMany(records)` | `.insert(records).select()` | Inserta N adjuntos. |

## 1.6 `WeotziData.Chat` (chat_messages · clave text `quote_id`)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listByQuote(quoteId)` | `.from('chat_messages').select('*').eq('quotation_id',quoteId).order('created_at',asc)` | Hilo de chat. |
| `sendMessage({quoteId,senderType,senderId,message})` | `.insert({quotation_id,sender_type,sender_id,message})` | Envía mensaje. |
| `markRead(quoteId,fromSenderType)` | `.update({is_read:true}).eq('quotation_id',q).eq('sender_type',t).eq('is_read',false)` | Marca leídos. |
| `countUnread(quoteId,fromSenderType)` | `.select('*',{count,head}).eq(...).eq('sender_type',t).eq('is_read',false)` | No leídos (1 cotización). |
| `countUnreadByQuotationIds(quoteIds,fromSenderType)` | **antes: N queries** `countUnread` en loop → ahora `.select('quotation_id').in('quotation_id',ids).eq('sender_type',t).eq('is_read',false)` + agg JS | No leídos batch (fix N+1). |

## 1.7 `WeotziData.Realtime`
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `subscribeChatMessages(ch,quoteId,onInsert)` | `_supabase.channel(ch).on('postgres_changes',{event:'INSERT',table:'chat_messages',filter:'quotation_id=eq.<q>'},cb).subscribe()` | INSERT de chat de una cotización. |
| `subscribeNewChatFromSender(ch,senderType,onInsert)` | `…filter:'sender_type=eq.<t>'…` | INSERT de chat de un sender (badges). |
| `subscribeQuotationUpdates(ch,onUpdate)` | `…{event:'UPDATE',table:'quotations_db'}…` | UPDATE de cotizaciones (cliente). |
| `subscribeQuotationsForAdmin(ch,{onInsert,onUpdate})` | mismo canal con INSERT+UPDATE de `quotations_db` | Realtime admin. |
| `remove(ch)` | `_supabase.removeChannel(ch)` | Baja un canal. |

## 1.8 `WeotziData.Api` (operaciones mediadas por Express)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `hideForClient(quoteId,token)` | `fetch('/api/client/quotations/'+q+'/hide',{method:'POST',headers:{Authorization}})` | Soft-delete del cliente (server). |
| `confirmCompletionByClient(quoteId,token)` | `fetch('/api/client/quotations/'+q+'/complete',…)` | Cierre verificado (server). |

---

## 1.9 `WeotziData.Artists` (artists_db) — estilo fino `{ data, error }`

| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `getByUserId(userId, cols='*')` | `.from('artists_db').select(cols).eq('user_id',userId).maybeSingle()` | Artista por user_id (auth/perfil propio). |
| `getByUserIdSingle(userId, cols='*')` | `…eq('user_id',userId).single()` | Igual pero exige fila (calendar/archive/quotations). |
| `getDashboardByUserId(userId)` | `.select(DASHBOARD_SELECT).eq('user_id',userId).maybeSingle()` | Registro completo del dashboard. |
| `getProfileByUserId(userId)` | `.select(PROFILE_SELECT).eq('user_id',userId).maybeSingle()` | Perfil para auth/onboarding. |
| `getProfileByEmail(email)` | `.select(PROFILE_SELECT).eq('email',email).maybeSingle()` | Perfil incompleto por email (reanudar alta). |
| `getContactByUserId(userId)` | `.select('email, whatsapp_number').eq('user_id',userId).maybeSingle()` | Contacto (logging). |
| `getGalleryFeedItems(userId)` | `.select('gallery_feed_items').eq('user_id',userId).single()` | Galería previa al merge. |
| `getPublicByUsername(username, cols='*')` | `.select(cols).ilike('username',username).single()` | Perfil público por username (ilike). |
| `getPublicByExactUsername(username, cols='*')` | `.select(cols).eq('username',username).maybeSingle()` | Perfil público exacto (página pública). |
| `findByUsername(username, cols, {exact})` | `.select(cols).eq\|ilike('username',username).limit(1)` | Lookup (feed de galería). |
| `isUsernameAvailable(username, currentUserId)` | `.select('user_id').eq('username',u).neq('user_id',cur).limit(1)` | Username tomado por otro. |
| `listPublic(cols='*')` | `.from('artists_db').select(cols)` | Todos los públicos (RLS acota). |
| `listAll(cols='*')` | `.select(cols)` | Lista completa (soporte). |
| `listByUserIds(userIds, cols='*')` | `.select(cols).in('user_id',userIds)` | Batch por user_ids. |
| `searchByUsernameOrName(term, limit=8)` | `.select('user_id,username,name,profile_picture,city,country').or('username.ilike.%<t>%,name.ilike.%<t>%').limit(8)` | Buscar para invitar al roster. |
| `searchCities(query, limit=10)` | `.select('city').ilike('city','%<q>%').limit(10)` | Ciudades de perfiles (autocomplete). |
| `listWithLocation(cols=WITH_LOCATION_SELECT)` | `.from('artists_with_location').select(WITH_LOCATION_SELECT)` | Vista para pines del mapa/globo. |
| `listForMap(cols=FOR_MAP_SELECT)` | `.from('artists_db').select(FOR_MAP_SELECT)` | Fallback a `artists_db` (mapa). |
| `count()` | `.select('*',{count:'exact',head:true})` | Conteo total. |
| `updateByUserId(userId, patch)` | `.update(patch).eq('user_id',userId)` | Patch por user_id. |
| `updateByUserIdReturning(userId, patch)` | `.update(patch).eq('user_id',userId).select('user_id')` | Update que devuelve user_id (detectar RLS). |
| `upsertProfile(artistData)` | `.upsert(artistData,{onConflict:'user_id'}).select()` | Crea/actualiza registro principal (wizard). |

## 1.10 `WeotziData.ArtistLocations` (artist_tattoo_locations)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listByArtistUserId(uid, cols='*')` | `.from('artist_tattoo_locations').select(cols).eq('artist_user_id',uid).order('sort_order',asc).order('start_date',asc,nullsFirst)` | Ubicaciones ordenadas. |
| `listSimpleByArtistUserId(uid, cols='*')` | `.select(cols).eq('artist_user_id',uid)` | Sin orden (itinerario del globo). |
| `searchCities(query, limit=10)` | `.select('city').ilike('city','%<q>%').limit(10)` | Ciudades de ubicaciones. |
| `insertMany(rows)` | `.insert(rows)` | Insert bulk. |
| `deleteByArtistUserId(uid)` | `.delete().eq('artist_user_id',uid)` | Borrado total. |
| `replaceForArtist(uid, rows)` | **antes: delete + insert sueltos** → ahora envuelve `deleteByArtistUserId` + `insertMany` | Replace-all. |
| `upsertCurrentLocation(row)` | `.upsert(row,{onConflict:'artist_user_id,period_type,sort_order'})` | Upsert ubicación actual (registro). |

## 1.11 `WeotziData.ArtistVisits` (artist_profile_visits)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `countSince(artistId, sinceIso)` | `.from('artist_profile_visits').select('id',{count,head}).eq('artist_id',a).gte('created_at',since)` | Conteo de visitas (dashboard). |
| `listVisitsByArtistSince(artistId, sinceIso, limit)` | `.select('id,country,city,latitude,longitude,device_type,os,browser,created_at,ip_hash,device_fingerprint').eq('artist_id',a).gte('created_at',since).order('created_at',desc).limit(n)` | Visitas crudas (mapa). |
| `listDailyVisitsByArtist(artistId, limit=1000)` | `.from('artist_profile_visits_daily').select('*').eq('artist_id',a).order('day',desc).limit(1000)` | Visitas agregadas por día. |

## 1.12 `WeotziData.Studios` (studios)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `getById(studioId, cols='*')` | `.from('studios').select(cols).eq('id',id).maybeSingle()` | Estudio por id. |
| `getAddressById(studioId)` | `.select(ADDRESS_COLS).eq('id',id).maybeSingle()` | Solo dirección (dashboard del artista). |
| `getBySlug(slug, cols='*')` | `.select(cols).eq('slug',slug).maybeSingle()` | Estudio por slug. |
| `getByUserId(userId, cols='*')` | `.select(cols).eq('user_id',uid).maybeSingle()` | Estudio del usuario (panel). |
| `getByOwnerUserId(userId, cols=…)` | `.select('id,user_id,slug,name,logo_image,country').eq('user_id',uid).maybeSingle()` | Estudio como reviewer. |
| `getOwnedByUser(studioId, userId, cols='id,user_id')` | `.select(cols).eq('id',id).eq('user_id',uid).maybeSingle()` | Verifica ownership. |
| `searchByNormalizedName(q, {limit,cols})` | `.select(cols).ilike('normalized_name','%<q>%').order('name').limit(8)` | Búsqueda por nombre (autocomplete). |
| `findIdByNormalizedName(name, {single})` | `.select('id').eq('normalized_name',name).maybeSingle()\|single()` | id por nombre (find-or-create). |
| `createMinimal({name,normalizedName})` | `.insert({name,normalized_name}).select('id').single()` | Crea estudio mínimo. |
| `create(payload)` | `.insert(payload).select('id, slug, name, user_id').single()` | Crea estudio completo (registro). |
| `update(studioId, patch)` / `updateProfile(studioId, patch)` | `.update(patch).eq('id',id)` | Patch / guardar perfil. |
| `updateAddress(studioId, patch)` | `.update(patch).eq('id',id)` | Dirección geocodificada. |
| `setPrimaryLocation(studioId, locationId)` | `.update({primary_location_id:loc}).eq('id',id)` | Apunta la sede principal. |

## 1.13 `WeotziData.StudioLocations` (studio_locations)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listByStudio(studioId, cols='*')` | `.from('studio_locations').select(cols).eq('studio_id',s).order('sort_order',asc)` | Todas las sedes. |
| `listActiveByStudio(studioId, cols='*')` | `.select(cols).eq('studio_id',s).eq('is_active',true).order('is_primary',desc).order('sort_order',asc)` | Sedes activas. |
| `listPrimaryWithStudioForMap()` | `.select('…,studios:studio_id(…)').eq('is_active',true).eq('is_primary',true).not('latitude','is',null)` | Sedes primarias con estudio (mapa). |
| `listPrimaryByStudioIds(ids, cols=…)` | `.select(cols).in('studio_id',ids).eq('is_primary',true)` | Bulk de sedes primarias (itinerario). |
| `demotePrimary(studioId)` | `.update({is_primary:false}).eq('studio_id',s).eq('is_primary',true)` | Degrada la primaria actual. |
| `updateLocation(id, patch)` | `.update(patch).eq('id',id).select().single()` | Edita sede. |
| `createLocation(payload)` | `.insert(payload).select().single()` | Crea sede. |
| `createMany(rows)` | `.insert(rows).select('id, is_primary')` | Sedes en lote (registro). |
| `deleteLocation(id)` | `.delete().eq('id',id)` | Borra sede. |

## 1.14 `WeotziData.StudioMemberships` (studio_artist_memberships)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listRoster(studioId)` | `.select('…,artists_db(…)').eq('studio_id',s).in('status',['active','pending_acceptance','paused']).order('status').order('role')` | Roster con artista embebido. |
| `listActiveRosterWithArtists(studioId)` | `.select('role,status,artists_db(…)').eq('studio_id',s).eq('status','active')` | Roster activo (perfil público). |
| `listActiveArtists(studioId, {withRole})` | `.select('artist_user_id[,role],artists_db(user_id,username,name)').eq('studio_id',s).eq('status','active')` | Artistas activos (selectores). |
| `listPendingForArtist(uid)` | `.select('…,studios:studio_id(…),location:location_id(…)').eq('artist_user_id',uid).eq('status','pending_acceptance').order('invited_at',desc)` | Invitaciones pendientes. |
| `listActiveForArtist(uid)` | `.select('…,studios:studio_id(…)').eq('artist_user_id',uid).eq('status','active')` | Memberships activas del artista. |
| `createMembership(payload)` | `.insert(payload)` | Membership directa. |
| `inviteArtist(payload)` | `.insert(payload).select('id').single()` | Invitación. |
| `updateMembership(id, patch)` | `.update(patch).eq('id',id)` | Patch de membership. |
| `endMembership(id)` | `.update({status:'ended',ended_at:now}).eq('id',id)` | Finaliza. |
| `resumeMembership(id)` | `.update({status:'active',ended_at:null}).eq('id',id)` | Reactiva. |
| `deleteMembership(id)` | `.delete().eq('id',id)` | Cancela. |
| `respondToInvitation(id, uid, action)` | `.update(accept?{status:'active',started_at}:{status:'rejected',ended_at}).eq('id',id).eq('artist_user_id',uid)` | Artista acepta/rechaza. |

## 1.15 `WeotziData.StudioSpots` (studio_spots + applications/attachments)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listByStudio(studioId)` | `.from('studio_spots').select('…').eq('studio_id',s).order('created_at',desc)` | Spots del estudio (panel). |
| `listOpenWithStudioAndLocation()` | `.select('…,studios:studio_id(…),location:location_id(…)').eq('status','open').order('created_at',desc)` | Directorio público de spots. |
| `listOpenForDashboard()` | `.select('…,studios:studio_id(name),location:location_id(city,country,label)').eq('status','open').order('created_at',desc).limit(12)` | Spots abiertos (hero del dashboard). |
| `getById(spotId, cols='*')` | `.select(cols).eq('id',spot).maybeSingle()` | Spot completo (editor). |
| `getSummaryById(spotId)` | `.select('id, title, kind').eq('id',spot).single()` | Spot mínimo (al abrir postulaciones). |
| `updateSpot(spotId, payload)` | `.update(payload).eq('id',spot).select().single()` | Edita spot. |
| `createSpot(payload)` | `.insert(payload).select().single()` | Crea spot. |
| `updateStatus(spotId, status)` | `.update({status}).eq('id',spot)` | Cambia estado del spot. |
| `deleteSpot(spotId)` | `.delete().eq('id',spot)` | Borra spot. |
| `deleteAttachmentsBySpot(spotId)` | `.from('studio_spot_attachments').delete().eq('spot_id',spot)` | Borra adjuntos del spot. |
| `insertAttachment(att)` | `.from('studio_spot_attachments').insert(att)` | Registra adjunto (portada). |
| `listApplications(spotId)` | `.from('studio_spot_applications').select('…,artists_db(…)').eq('spot_id',spot).order('created_at',desc)` | Postulaciones con artista. |
| `getApplication(spotId, uid)` | `.select('id, status').eq('spot_id',spot).eq('artist_user_id',uid).maybeSingle()` | ¿Ya postuló? |
| `createApplication({…})` | `.insert({spot_id,artist_user_id,message,portfolio_url})` | Crea postulación. |
| `decideApplication(appId, status)` | `.update({status,decided_at:now}).eq('id',app)` | Acepta/rechaza postulación. |

## 1.16 `WeotziData.StudioOps` (jobs, invoices, documents, inventory, suppliers, sponsors, vistas)
| Método nuevo | Antes (query inline) | Qué hace |
|---|---|---|
| `listJobs(studioId,{limit})` | `.from('studio_jobs_log').select('…,artists_db(username,name)').eq('studio_id',s).order('performed_at',desc).limit(100)` | Trabajos con artista. |
| `listJobsForClientAggregation(studioId)` | `.select('client_user_id,client_display_name,client_email,gross_amount,gross_currency,performed_at').eq('studio_id',s)` | Trabajos para agregar clientes. |
| `getJobById(id)` / `updateJob(id,p)` / `createJob(p)` / `deleteJob(id)` | `.select('*').eq('id',id).single()` / `.update(p).eq('id',id).select().single()` / `.insert(p).select().single()` / `.delete().eq('id',id)` | CRUD de trabajos. |
| `listInvoices(studioId)` | `.from('studio_invoices').select('*').eq('studio_id',s).order('issue_date',desc)` | Facturas. |
| `getInvoiceById(id)` / `updateInvoice(id,h)` / `createInvoice(h)` / `markInvoicePaid(id)` / `deleteInvoice(id)` | `.select('*').eq('id',id).single()` / `.update(h).eq('id',id).select().single()` / `.insert(h).select().single()` / `.update({status:'paid',paid_at:now}).eq('id',id)` / `.delete().eq('id',id)` | CRUD + pagar factura. |
| `listInvoiceItems(invId)` / `insertInvoiceItems(rows)` / `deleteInvoiceItems(invId)` | `.from('studio_invoice_items').select('*').eq('invoice_id',i).order('sort_order')` / `.insert(rows)` / `.delete().eq('invoice_id',i)` | Ítems de factura. |
| `listDocuments(studioId)` / `getDocumentById(id)` / `updateDocument(id,p)` / `createDocument(p)` / `deleteDocument(id)` | `.from('studio_documents').…` (mismo patrón list/get/update/create/delete) | Documentos. |
| `listInventoryItems(studioId)` | `.from('studio_inventory_items').select('…,studio_suppliers(name)').eq('studio_id',s).eq('is_active',true).order('name',asc)` | Inventario con proveedor. |
| `getInventoryItemById(id)` / `updateInventoryItem(id,p)` / `createInventoryItem(p)` / `deleteInventoryItem(id)` | patrón get/update/create/delete sobre `studio_inventory_items` | CRUD de inventario. |
| `createInventoryMovement(p)` | `.from('studio_inventory_movements').insert(p)` | Movimiento de stock. |
| `listInventoryHealth(studioId)` | `.from('studio_inventory_health_view').select('…').eq('studio_id',s).order('needs_reorder',desc)` | Vista de salud de inventario. |
| `listSuppliers(studioId)` / `listSupplierOptions(studioId)` / `getSupplierById(id)` / `updateSupplier(id,p)` / `createSupplier(p)` / `deleteSupplier(id)` | `.from('studio_suppliers').…` (list `*`/`id,name`, get/update/create/delete) | Proveedores. |
| `listSponsors(studioId)` | `.from('studio_sponsors').select('*').eq('studio_id',s).order('tier',desc)` | Sponsors. |
| `listPublicSponsors(studioId)` | `.from('studio_public_sponsors_view').select('…').eq('studio_id',s).order('tier',desc)` | Sponsors públicos (vista). |
| `getSponsorById(id)` / `updateSponsor(id,p)` / `createSponsor(p)` / `deleteSponsor(id)` | patrón get/update/create/delete sobre `studio_sponsors` | CRUD de sponsors. |
| `listSponsorArtistsBySponsorIds(ids)` | `.from('studio_sponsor_artists').select('sponsor_id,artist_user_id,artists_db(user_id,username,name)').in('sponsor_id',ids)` | Vínculos con artista. |
| `listSponsorArtistIds(sponsorId)` / `insertSponsorArtists(rows)` / `deleteSponsorArtists(sponsorId)` | `.select('artist_user_id').eq('sponsor_id',sp)` / `.insert(rows)` / `.delete().eq('sponsor_id',sp)` | Vínculos sponsor-artista. |
| `getDashboardMetrics(studioId,{months})` | `.from('studio_dashboard_metrics_view').select('*').eq('studio_id',s).order('month',desc).limit(12)` | Métricas mensuales. |
| `getArtistPerformance(studioId,{limit})` | `.from('studio_artist_performance_view').select('*').eq('studio_id',s).order('gross_billed',desc).limit(20)` | Performance por artista. |

---

# 2. Servidor — `lib/`

> "Antes" = el `fetch('${url}/rest/v1/...')` inline o el helper (`_supabaseFetch`/`supabaseQuery`) que estos métodos reemplazaron.

## 2.1 `lib/postgrest.js` — query-builder + escape
`pgrest(table, {key})` encadena `.select/.eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in/.or/.order/.limit/.range/.onConflict/.count/.single` y termina con `.execute()` (lectura), `.insert/.upsert/.patch/.delete` (escritura). `pgrest.raw(path, {method,body,prefer,key,apiKey})` para paths arbitrarios. **Antes:** `fetch('${url}/rest/v1/'+path,{headers:{apikey,Authorization}})` repetido + 3 helpers solapados (`_supabaseFetch`, `supabaseQuery`, `fetchAdminTableRows`).

## 2.2 `lib/repos/quotations.js` — `QuotationsRepo`
| Método nuevo | Antes (inline) | Qué hace |
|---|---|---|
| `getByQuoteId(quoteId,{select})` | `fetch('…/quotations_db?quote_id=eq.<q>&select=…')` | Cotización por `quote_id`. |
| `claimForClient(id,clientUserId)` | `fetch('…/quotations_db?id=eq.<id>',{PATCH {client_user_id}})` | Auto-link por email. |
| `softDeleteForClient(id)` | `…PATCH {client_deleted_at:now}` | Soft-delete del cliente. |
| `markCompletedByClient(id,uid,at?)` | `…PATCH {quote_status:'completed',client_completed_at,completed_by_client_user_id}` | Cierre verificado. |
| `createFromJobBoard(payload)` | `fetch('…/quotations_db',{POST payload})` | Crea cotización desde job board. |
| `listForUser({userId,quoteId})` | `_supabaseFetch('quotations_db?or=(…)&select=…')` (con columnas reales — fix §4-E) | Cotizaciones del usuario (chatbot). |
| `fetchAnalyticsSince(sinceIso)` | `supabaseQuery(cfg,'quotations_db?select=…&created_at=gte.<since>')` (ahora service-role — fix §4-A) | Datos de analytics. |

## 2.3 `lib/repos/jobboard.js` — `JobBoardRepo`
| Método nuevo | Antes (inline) | Qué hace |
|---|---|---|
| `getApplicationById(id)` / `getRequestById(id)` | `fetch('…/job_board_applications?id=eq.<id>&select=*')` / `…job_board_requests…` | Lecturas para aceptar. |
| `acceptApplication(id)` | `…job_board_applications?id=eq.<id> PATCH {status:'accepted',decided_at}` | Marca aceptada. |
| `rejectOtherApplications(reqId,exceptId)` | `…?request_id=eq.<r>&id=neq.<a>&status=in.(pending,viewed) PATCH {status:'rejected'}` | Rechaza las demás. |
| `closeRequestAsAccepted(reqId,{…})` | `…job_board_requests?id=eq.<r> PATCH {status:'accepted',…,is_public:false}` | Cierra el request. |

## 2.4 `lib/repos/currencies.js` — `CurrenciesRepo`
| Método nuevo | Antes (inline) | Qué hace |
|---|---|---|
| `listActive()` | `fetch('…/currencies?…',{anon})` | Monedas activas (anon). |
| `upsertRates(rows,{returning})` | `fetch('…/currencies?on_conflict=code',{POST})` | Upsert de tasas. |
| `logRefresh(entry)` | `fetch('…/currency_refresh_logs',{POST})` | Registra refresco. |

## 2.5 `lib/repos/instagram.js` — `InstagramRepo`
| Método nuevo | Antes (inline) | Qué hace |
|---|---|---|
| `countSince(sinceIso)` / `countTotal()` | `fetch('…/instagram_imports?…',{count})` | Conteos de importaciones. |
| `sumCost()` | `fetch('…/instagram_imports?select=cost_estimate_usd')` | Suma de costo. |
| `recent()` / `sinceForDailyBreakdown(sinceIso)` | `fetch('…/instagram_imports?select=…&order=…')` | Listados para stats. |

## 2.6 `lib/auth/supabase-auth.js`
`resolveBearerUser(req)`, `verifyAdminCaller(req)`, `isSuperadminEmail(email)`, `bearerToken(req)`. **Antes:** `_getAuthUserFromBearer` + bloques `fetch('${url}/auth/v1/user')` duplicados en `/hide`, `/complete` y `verifyAdminCaller`.

---

# 3. Deuda conocida / follow-ups

Pendientes anotados (no urgentes; la capa está al 100% en lo migrado). Tomar
cuando se toque cada área:

1. **Fallbacks raw-REST a la capa + des-duplicar el select del dashboard.**
   `dashboard.js fetchDashboardArtistViaRest` y `artist-auth.js fetchArtistViaRest`
   son `fetch('${url}/rest/v1/artists_db?...')` crudos (existen para evitar
   supabase-js cuando agota su timeout). Por eso la constante de ~50 columnas
   `DASHBOARD_ARTIST_SELECT` (en `dashboard.js`) sigue **duplicada** del
   `DASHBOARD_SELECT` que vive en `artists-repo.js` → riesgo de desincronización.
   Follow-up: exponer en la capa una variante raw/anon (p.ej. `WeotziData.Artists.getDashboardViaRest(...)`)
   y mover ambos fallbacks ahí; eliminar la constante duplicada.
2. **Repo de Clientes.** `clients_db` / `client_public_profiles` siguen accediéndose
   por el choke-point `WeotziData.from(...)` (client-auth.js, client-dashboard.js,
   artist-login.js, reviews.js, etc.). Falta un `WeotziData.Clients` con métodos con nombre.
3. **Constantes muertas tras migrar.** `ARTIST_PROFILE_SELECT` en `main.js` quedó sin
   uso (su query se encapsuló en `Artists.getProfileByUserId`); ídem `DASHBOARD_ARTIST_SELECT`
   cuando se cierre el punto 1. Limpieza menor.
4. **Analytics no-cotización** ya migrado, pero sigue usando el helper `supabaseQuery`
   (anon) en `server.js`; al unificar el dominio analytics conviene darle su repo.
5. **`session_number` calculado en cliente** (`shared-drawer.js`) — mover a una
   secuencia/columna server-side (riesgo de colisión concurrente).

---

> **Excepciones legítimas** (no pasan por repos/choke-point, documentado): `.storage.from(...)` (buckets), `.auth.*`, `resolveArtistAuthState` (cliente inyectado para tests), el `testClient` ad-hoc del backoffice, los bucles de backup genéricos de `admin.js` (acceso por nombre de tabla dinámico), y dos **fallbacks raw-REST intencionales** a `artists_db` (`dashboard.js fetchDashboardArtistViaRest`, `artist-auth.js fetchArtistViaRest`) — ver follow-up #1.
