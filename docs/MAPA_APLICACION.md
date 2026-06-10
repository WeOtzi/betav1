# Mapa completo de la aplicacion We Otzi

Actualizado: 2026-05-27  
Alcance: proyecto local (`weotzi-unified`) y esquema Supabase representado en el codigo local/migraciones. No incluye estado de produccion ni servidor Hostinger.

## Resumen ejecutivo

We Otzi es una aplicacion web monolitica liviana: un servidor Express (`server.js`) sirve paginas HTML estaticas desde `public/`, expone endpoints API bajo `/api/*` y delega persistencia/autenticacion a Supabase. El frontend es HTML/CSS/JavaScript vanilla; cada modulo de producto vive como una carpeta `public/<ruta>/index.html` con scripts compartidos en `public/shared/js/`.

Las areas actuales son:

- **Cliente**: cotizacion guiada, pre-cotizador, dashboard, job board, cuenta y chat.
- **Artista**: registro, dashboard, perfil publico, galeria, cotizaciones, calendario, job board, invitaciones de estudios e importacion de Instagram.
- **Estudio**: registro/login, perfil publico, dashboard operativo, sedes, roster, spots, inventario, proveedores, sponsors, documentos/facturas internas y analytics.
- **Soporte**: login, dashboard de operaciones, inspeccion/edicion de artistas/cotizaciones/tickets/sesiones y chat de soporte.
- **Admin/backoffice**: administracion global, usuarios de soporte, backups, salud, analytics, integraciones y configuracion secreta.

## Arquitectura del sistema

```text
Browser
  |
  | HTML/CSS/JS estatico
  v
Express server.js :4545
  |-- Sirve public/
  |-- Clean URLs -> public/<ruta>/index.html
  |-- APIs /api/*
  |
  | REST/Auth/Storage
  v
Supabase
  |-- Auth
  |-- Postgres public schema + RLS
  |-- Storage buckets
  |
  | Integraciones externas
  v
Google Drive, Gemini, Google Maps, n8n, EmailJS, Apify/Instagram, CDNs
```

### Backend local

- Runtime: Node.js + Express.
- Puerto por defecto: `4545` (`PORT` puede sobrescribirlo).
- Middlewares: `helmet`, `cors`, `express-rate-limit`, `express.json`/`urlencoded` con limite `50mb`.
- Manejo global: captura `uncaughtException`, `unhandledRejection` y monitoreo de memoria.
- Static hosting: `express.static(public)` y fallback de rutas limpias.
- Config dinamica: `GET /shared/js/app-config.json` mezcla archivo local y variables de entorno.

### Frontend

- Stack: HTML, CSS y JavaScript vanilla.
- Convencion: cada pagina vive en `public/<ruta>/index.html`.
- Scripts compartidos clave:
  - `config-manager.js`: carga configuracion, Supabase, app settings y catalogos.
  - `logging-loader.js`/`logging-service.js`/`error-reporter.js`: telemetria de sesiones/errores.
  - `client-auth.js`, `artist-auth.js`, `studio-auth.js`: autenticacion por tipo de usuario.
  - `shared-drawer.js`: drawer de cotizaciones, notas, sesiones, chat y rating.
  - `heic-converter.js` y `weotzi-uploader.js`: procesamiento/subida de imagenes.
  - `geocoder.js` y `address-picker.js`: normalizacion de direcciones.
  - `instagram-import.js`: UI reutilizable para importacion de perfil/galeria desde Instagram.

## Servicios e integraciones

| Servicio | Uso actual | Punto de integracion |
| --- | --- | --- |
| Supabase Auth | Login/registro de artistas, clientes, estudios, soporte y superadmin | Frontend `supabase-js`; backend via REST/Auth admin |
| Supabase Postgres | Datos de producto, RLS, vistas y funciones SQL | Migraciones en `supabase/migrations/`; consultas en JS |
| Supabase Storage | Imagenes de cotizacion, perfil, galeria, media importada, estudios, spots y documentos | Buckets `quotation-references`, `profile-pictures`, `artist-gallery`, `studio-photos`, `studio-documents`, `studio-spot-attachments` |
| Google Drive | Carpeta por cotizacion y subida de referencias | `/api/google-drive/*` |
| Gemini | Generacion de imagen/concepto para tatuajes | `/api/gemini/generate-image` |
| Google Maps/Geocoder | Direcciones, mapas, pins, exploracion | `geocoder.js`, `address-picker.js`, `/api/artists/geocode` |
| n8n | Webhooks de email/eventos de negocio | `app-config.json`, `/api/studio/notify`, flujos de registro/cotizacion/job board |
| EmailJS | Notificaciones frontend heredadas | Config publica en `app-config.json` |
| Apify/Instagram | Importacion de bio, links, fotos y reels | `/api/admin/integrations/apify*`, `/api/instagram/*`, `lib/instagram-import.js` |
| CDNs | Supabase JS, Font Awesome, Chart.js, FullCalendar, Quill, Editor.js, cobe | Referencias directas en HTML |

## Rutas de paginas

Express sirve rutas limpias; por ejemplo `/artist/dashboard` resuelve a `public/artist/dashboard/index.html`.

| Ruta | Usuario principal | Archivo | Funcion |
| --- | --- | --- | --- |
| `/` | Publico | `server.js` | Redirige a `/quotation`. |
| `/quotation` | Cliente | `public/quotation/index.html` | Wizard principal de cotizacion con referencias, seleccion de artista, calendario y handoff a Drive/n8n/Supabase. |
| `/quotations` | Cliente/legacy | `public/quotations/index.html` | Redirecciona a `/quotation` preservando query/hash. |
| `/pre-cotizador` | Cliente | `public/pre-cotizador/index.html` | Estimador previo de costo y artistas sugeridos antes de iniciar la cotizacion completa. |
| `/marketplace` | Cliente/publico | `public/marketplace/index.html` | Busqueda/listado de artistas desde `artists_db`. |
| `/explore` | Cliente/publico | `public/explore/index.html` | Mapa 2D de artistas y estudios usando `artists_with_location` y `studio_locations`. |
| `/explore/globe` | Cliente/publico | `public/explore/globe/index.html` | Globo 3D con artistas, itinerarios, filtros y spotlight. |
| `/client/register` | Cliente | `public/client/register/index.html` | Registro de cuenta cliente. |
| `/client/login` | Cliente | `public/client/login/index.html` | Login de cliente. |
| `/client/dashboard` | Cliente | `public/client/dashboard/index.html` | Panel cliente: cotizaciones, perfil, chat y solicitudes de job board. |
| `/job-board/request` | Cliente | `public/job-board/request/index.html` | Publicar solicitud abierta de tatuaje. |
| `/job-board` | Artista | `public/job-board/index.html` | Feed de solicitudes publicas para que artistas postulen. |
| `/register-artist` | Artista | `public/register-artist/index.html` | Registro completo de artista, ubicacion, estilos, galeria e importacion de Instagram. |
| `/registerclosedbeta` | Artista | `public/registerclosedbeta/index.html` | Landing/registro de beta cerrada para artistas. |
| `/artist/dashboard` | Artista | `public/artist/dashboard/index.html` | Panel de artista: perfil, ubicaciones, galeria, QR, cotizaciones, aplicaciones y ajustes. |
| `/artist/profile` | Artista/publico | `public/artist/profile/index.html` | Perfil publico del artista por username/user id. |
| `/artist/profile/gallery` | Artista/publico | `public/artist/profile/gallery/index.html` | Galeria publica categorizada del artista. |
| `/artist/invitations` | Artista | `public/artist/invitations/index.html` | Invitaciones y membresias pendientes/activas con estudios. |
| `/my-quotations` | Artista/admin operativo | `public/my-quotations/index.html` | Gestion de cotizaciones asignadas, drawer, notas, sesiones, chat y estados. |
| `/my-quotations/statistics` | Artista/admin operativo | `public/my-quotations/statistics/index.html` | Estadisticas de cotizaciones. |
| `/calendar` | Artista/admin operativo | `public/calendar/index.html` | Calendario de sesiones/cotizaciones con FullCalendar. |
| `/archive` | Artista/admin operativo | `public/archive/index.html` | Cotizaciones archivadas. |
| `/tutorial` | Artista/admin operativo | `public/tutorial/index.html` | Tour del panel de cotizaciones. |
| `/studio/register` | Estudio | `public/studio/register/index.html` | Registro de estudio en 5 pasos: cuenta, identidad, sedes, fotos, confirmar. |
| `/studio/login` | Estudio | `public/studio/login/index.html` | Login de estudio. |
| `/studio/dashboard` | Estudio | `public/studio/dashboard/index.html` | Panel de estudio: perfil, sedes, roster, spots, operaciones, inventario, proveedores, sponsors y analytics. |
| `/studio/profile` | Estudio/publico | `public/studio/profile/index.html` | Perfil publico del estudio con sedes y roster. |
| `/studio-spots` | Artista/publico | `public/studio-spots/index.html` | Directorio de spots abiertos por estudios y postulacion de artistas. |
| `/support/login` | Soporte | `public/support/login/index.html` | Login de soporte. |
| `/support/dashboard` | Soporte | `public/support/dashboard/index.html` | Dashboard de soporte para artistas, cotizaciones, tickets, sesiones, chats y acciones operativas. |
| `/backoffice/login` | Admin | `public/backoffice/login/index.html` | Login de superadmin/backoffice. |
| `/backoffice` | Admin | `public/backoffice/index.html` | Backoffice global: cotizaciones, artistas, soporte, analytics, salud, backup, integraciones y configuracion. |

## Rutas API

| Metodo | Ruta | Funcion | Dependencias principales |
| --- | --- | --- | --- |
| `POST` | `/api/gemini/generate-image` | Genera imagenes/conceptos con Gemini usando `GEMINI_API_KEY`. | Gemini API |
| `POST` | `/api/google-drive/test` | Valida acceso a una carpeta de Google Drive. | Google Drive service account |
| `POST` | `/api/google-drive/create-quote-folder` | Crea carpeta de cotizacion y sube referencias descargadas por URL. | Google Drive |
| `GET` | `/api/client-info` | Devuelve IP detectada y timestamp. | Request headers |
| `POST` | `/api/session-log` | Recibe logs finales via `sendBeacon`, geolocaliza IP y actualiza `session_logs`. | Supabase, ip-api.com |
| `POST` | `/api/admin/update-user-password` | Superadmin actualiza password de un usuario en Supabase Auth. | Supabase Admin API, `verifyAdminCaller` |
| `POST` | `/api/auth/reset-temp-password` | Reset temporal para artista/cliente/estudio usado por flujo n8n email. | Supabase Auth Admin, tablas `artists_db`, `clients_db`, `studios` |
| `POST` | `/api/tattoo-styles/ensure` | Busca o crea estilo raiz en `tattoo_styles`. | Supabase REST |
| `POST` | `/api/admin/generate-backup` | Genera ZIP con datos recibidos, config y archivos de app. | `archiver`, filesystem |
| `GET` | `/api/admin/backup-tables` | Lista tablas conocidas para backup. | `verifyAdminCaller` |
| `GET` | `/shared/js/app-config.json` | Sirve configuracion publica con overrides de entorno. | `app-config.json`, env vars |
| `POST` | `/api/job-board/accept-application` | Cliente acepta postulacion, crea cotizacion, actualiza solicitud y rechaza otras postulaciones. | Supabase REST/Admin |
| `POST` | `/api/client/quotations/:quoteId/hide` | Oculta cotizacion para el cliente con `client_deleted_at`. | Supabase Auth/REST |
| `GET` | `/api/health/all` | Healthcheck de todos los servicios configurados. | Supabase, n8n, Gemini, Maps, Drive, EmailJS, Calendar |
| `GET` | `/api/health/:service` | Healthcheck individual. | Config local/env |
| `GET` | `/api/health/history/:service` | Historial desde `service_health_logs`. | Supabase |
| `GET` | `/api/analytics/users` | Sesiones por tipo de usuario y periodo. | `analytics_user_sessions` |
| `GET` | `/api/analytics/devices` | Distribucion por OS/dispositivo/browser. | `analytics_devices` |
| `GET` | `/api/analytics/pages` | Paginas mas visitadas. | `analytics_user_sessions` |
| `GET` | `/api/analytics/errors` | Sesiones con errores. | `analytics_user_sessions` |
| `GET` | `/api/analytics/locations` | Pais/ciudad/IP de sesiones. | `analytics_user_sessions` |
| `GET` | `/api/analytics/quotations` | Metricas de cotizaciones, conversion y tiempos de respuesta. | `quotations_db` |
| `GET` | `/api/analytics/summary` | Resumen de analytics para dashboard. | `analytics_user_sessions`, `analytics_devices` |
| `POST` | `/api/artists/geocode` | Persiste lat/lng y direccion geocodificada de artistas. | `artists_db` |
| `POST` | `/api/studio/notify` | Notifica decisiones de spots o invitaciones de roster a artistas; exige Bearer JWT y ownership del estudio. | Supabase REST, n8n |
| `POST` | `/api/pre-quote/estimate` | Calcula rango de costo y artistas sugeridos. | `artists_db`, `lib/prequote-estimator.js` |
| `GET` | `/api/admin/integrations/apify` | Devuelve metadata del token Apify sin exponerlo. | `app_settings`, `verifyAdminCaller` |
| `POST` | `/api/admin/integrations/apify` | Guarda token Apify como secreto en `app_settings`. | `lib/app-settings.js` |
| `POST` | `/api/admin/integrations/apify/test` | Prueba token Apify contra un handle. | Apify API |
| `GET` | `/api/admin/integrations/apify/stats` | Estadisticas de importaciones Instagram y costo estimado. | `instagram_imports` |
| `GET` | `/api/instagram/proxy-thumb` | Proxy seguro para thumbnails de Instagram/Facebook CDN. | Allowlist CDN |
| `POST` | `/api/instagram/preview` | Preview de perfil Instagram via Apify. En dashboard requiere auth; en signup permite modo limitado. | Apify, cache en memoria |
| `POST` | `/api/instagram/commit` | Importa media seleccionada a Storage y actualiza artista/estudio. | Apify payload, Supabase Storage/REST |

### APIs referenciadas por frontend pero no implementadas en `server.js`

Estas llamadas existen en scripts locales, pero no aparecen como rutas Express en el `server.js` actual. Deben tratarse como dependencias incompletas, rutas movidas a otro backend o pendientes de implementar antes de considerarlas funcionales en local.

| Metodo | Ruta | Referencia local | Funcion esperada |
| --- | --- | --- | --- |
| `POST` | `/api/artist/profile-visit` | `public/shared/js/artist-profile.js` | Registrar visitas al perfil publico del artista. |
| `POST` | `/api/support-chat/assign` | `public/shared/js/support-dashboard.js` | Asignar conversacion de soporte a un agente. |
| `POST` | `/api/support-chat/release` | `public/shared/js/support-dashboard.js` | Liberar conversacion tomada por un agente. |
| `POST` | `/api/support-chat/close` | `public/shared/js/support-dashboard.js` | Cerrar conversacion de soporte. |
| `POST` | `/api/support-chat/agent-message` | `public/shared/js/support-dashboard.js` | Enviar mensaje de agente a una conversacion de soporte. |

## Funciones por tipo de usuario

### Cliente

- Solicitar cotizacion completa en `/quotation`.
- Usar pre-cotizador en `/pre-cotizador` para rango de precio, sesiones estimadas y artistas compatibles.
- Buscar artistas en `/marketplace`, `/explore` y `/explore/globe`.
- Crear cuenta, iniciar sesion y gestionar perfil desde `/client/*`.
- Ver cotizaciones propias, ocultarlas del dashboard, chatear y responder estados desde `/client/dashboard`.
- Publicar solicitudes abiertas en `/job-board/request`.
- Revisar postulaciones de artistas y aceptar una; la aceptacion crea una fila en `quotations_db`.

### Artista

- Registrarse en `/register-artist` o beta cerrada.
- Importar bio, link, ubicacion, fotos y reels desde Instagram durante registro o dashboard.
- Administrar perfil, ubicaciones, estilos, galeria, QR y datos de sesion en `/artist/dashboard`.
- Publicar perfil y galeria en `/artist/profile` y `/artist/profile/gallery`.
- Recibir y gestionar cotizaciones en `/my-quotations`, con notas, sesiones, chat, rating y estados.
- Consultar calendario y archivo.
- Ver solicitudes publicas de job board y postular.
- Ver/aceptar/rechazar invitaciones de estudios en `/artist/invitations`.
- Aplicar a spots abiertos de estudios desde `/studio-spots`.

### Estudio

- Registrar estudio con cuenta Supabase, identidad publica, sedes y fotos.
- Iniciar sesion en `/studio/login`.
- Administrar perfil publico, cover/logo, galeria y metadatos.
- Crear y mantener multiples sedes (`studio_locations`).
- Gestionar roster de artistas (`studio_artist_memberships`) con roles y estado.
- Publicar spots/residencias/guest spots y gestionar postulaciones.
- Enviar notificaciones via n8n para decisiones o invitaciones con validacion server-side de ownership.
- Registrar trabajos realizados, facturas internas, documentos y adjuntos.
- Gestionar inventario, movimientos, salud de stock, proveedores, sponsors y artistas patrocinados.
- Consultar metricas internas mediante vistas de dashboard, performance e inventario.

### Soporte

- Login dedicado y validacion contra `support_users_db`.
- Ver y filtrar artistas, cotizaciones, tickets, sesiones y conversaciones.
- Inspeccionar registros en drawers.
- Actualizar campos operativos de artistas, cotizaciones y tickets.
- Asignar, liberar, cerrar y responder conversaciones de soporte.
- Acceder a vistas de actividad/errores/sesiones para diagnostico.

### Admin / Backoffice

- Login de superadmin protegido por `backoffice-guard.js` y `verifyAdminCaller`.
- Gestionar cotizaciones, artistas y usuarios de soporte.
- Editar contrasenas via Supabase Admin API.
- Generar backups ZIP y seleccionar tablas conocidas.
- Ver salud de servicios, analytics y logs.
- Configurar secretos de integraciones como Apify sin exponer tokens al frontend.
- Ver estadisticas globales de importacion de Instagram.
- Operar configuracion publica/privada via `app_settings`.

## Componentes de datos en Supabase

### Tablas principales de producto

| Entidad | Proposito | Usuarios |
| --- | --- | --- |
| `artists_db` | Perfil, auth link, portfolio, estilos, ubicacion, precios, galeria y ranking de artista. | Artista, cliente, soporte, admin, estudio |
| `clients_db` / `client_accounts` | Perfil/cuenta de cliente segun modulos heredados. | Cliente, admin |
| `quotations_db` | Cotizaciones, estados, datos cliente/artista, source, presupuesto, soft-delete cliente. | Cliente, artista, soporte, admin |
| `quotations_attachments` | Adjuntos/referencias de cotizaciones. | Cliente, artista |
| `quotation_notes` | Notas internas por cotizacion. | Artista/admin operativo |
| `quotation_sessions` | Sesiones agendadas/completadas. | Artista, cliente, soporte |
| `chat_messages` | Chat asociado a cotizaciones. | Cliente, artista |
| `artist_tattoo_locations` | Ubicaciones actuales/proximas del artista, con soporte para estudio asociado y fechas. | Artista, cliente, estudio |
| `tattoo_styles`, `body_parts`, `quotation_flow_config` | Catalogos/configuracion del flujo de cotizacion. | Todos |
| `feedback_tickets` | Feedback/soporte reportado por usuarios. | Soporte, admin |
| `session_logs` | Telemetria de sesion, errores, IP, geo. | Soporte, admin |
| `service_health_logs` | Historial de healthchecks. | Admin/soporte |
| `app_settings` | Configuracion publica y secretos privados, incluido `apify_token`. | Admin/backend |
| `support_conversations` | Bandeja de conversaciones de soporte referenciada por el dashboard. | Soporte |
| `support_messages` | Mensajes de conversaciones de soporte. | Soporte |

### Job board

| Entidad | Proposito |
| --- | --- |
| `job_board_requests` | Solicitudes abiertas creadas por clientes. |
| `job_board_applications` | Postulaciones de artistas a solicitudes. |
| `job_board_attachments` | Adjuntos/referencias de solicitudes job board; usado por feed y dashboard cliente. |

### Estudios

| Entidad | Proposito |
| --- | --- |
| `studios` | Cuenta, identidad publica, marca, contacto y estado del estudio. |
| `studio_locations` | Sedes/ubicaciones multiples con direccion y coordenadas. |
| `studio_artist_memberships` | Relacion canonica artista-estudio, rol, split y lifecycle. |
| `studio_spots` | Oportunidades abiertas por estudios. |
| `studio_spot_applications` | Postulaciones de artistas a spots. |
| `studio_spot_attachments` | Adjuntos de spots. |
| `studio_jobs_log` | Ledger operativo de trabajos realizados. |
| `studio_invoices` | Facturas internas no fiscales. |
| `studio_invoice_items` | Items de factura con totales generados. |
| `studio_documents` | Documentos, plantillas, contratos, consentimientos. |
| `studio_document_attachments` | Adjuntos polimorficos a cotizaciones, facturas, memberships, spots o jobs. |
| `studio_suppliers` | Proveedores del estudio. |
| `studio_inventory_items` | Inventario/SKU/stock. |
| `studio_inventory_movements` | Movimientos de inventario con trigger de stock. |
| `studio_sponsors` | Sponsors del estudio. |
| `studio_sponsor_artists` | Relacion sponsor-artista. |

### Vistas y funciones SQL importantes

- `artists_with_location`: fuente unificada para mapa/explore; combina ubicacion propia de artista con sede primaria del estudio.
- `analytics_devices`, `analytics_user_sessions`: vistas de analytics sobre `session_logs`.
- `studio_dashboard_metrics_view`, `studio_artist_performance_view`, `studio_inventory_health_view`: consumidas por `studio-dashboard-ops.js`.
- `studio_public_sponsors_view`: superficie publica limitada para sponsors del perfil de estudio.
- `can_manage_studio_storage_path`: helper RLS para objetos Storage bajo prefijo `<studio_id>/...`.
- `sync_artist_to_auth`, `delete_auth_on_artist_delete`, `delete_artist_on_auth_delete`: sincronizacion de artista con Supabase Auth.
- `calculate_artist_index`, `calculate_profile_completeness`, `update_artist_index`: ranking/completitud de artista.
- `artist_gallery_feed_items_*`, `sync_artist_gallery_feed_items`: normalizacion de galeria por categoria.
- `normalize_location_city_province_country`: normalizacion de ubicaciones.
- `set_*_updated_at`: triggers de mantenimiento de timestamps.
- `recompute_invoice_totals`: recalcula totales de facturas internas.
- `apply_inventory_movement`: actualiza stock a partir de movimientos.
- `bump_studio_spot_app_count`: mantiene contador de aplicaciones a spots.
- `sync_artists_db_studio_id_from_membership`: mantiene `artists_db.studio_id` desde memberships activos.

### Storage

- `quotation-references`: referencias de cotizaciones.
- `profile-pictures`: imagenes de perfil/avatars.
- `artist-gallery`: galeria de artistas e importaciones Instagram.
- `job-board-references`: referencias adjuntas a solicitudes del job board.
- `studio-photos`: publico; imagenes de perfil, portada, galeria y sponsors de estudios.
- `studio-documents`: privado; documentos subidos por estudios.
- `studio-spot-attachments`: publico; adjuntos de spots publicados por estudios.
- Media importada desde Instagram tambien puede actualizar `artists_db.gallery_feed_items` o `studios.photo_feed_items`.

## Flujos principales

### Cotizacion cliente-artista

1. Cliente completa `/quotation`.
2. Frontend crea/actualiza registros en `quotations_db` y adjuntos.
3. Backend puede crear carpeta en Drive con `/api/google-drive/create-quote-folder`.
4. n8n envia emails/eventos segun `app-config.json`.
5. Artista gestiona la solicitud desde `/my-quotations`.
6. Cliente revisa estado/chat desde `/client/dashboard`.

### Pre-cotizador

1. Cliente ingresa idea, estilo, tamano, zona y ciudad.
2. `/api/pre-quote/estimate` consulta `artists_db`.
3. `lib/prequote-estimator.js` calcula rango p25/p75, sesiones y confianza.
4. Al elegir artista, `pre-quote.js` guarda handoff temporal y envia a `/quotation?source=prequote`.

### Job board

1. Cliente publica solicitud en `/job-board/request`.
2. Artistas ven solicitudes en `/job-board` y postulan.
3. Cliente acepta una postulacion desde su dashboard.
4. `/api/job-board/accept-application` crea una cotizacion, acepta la aplicacion, rechaza las demas y cierra la solicitud.

### Estudio y spots

1. Estudio se registra en `/studio/register` y crea `studios` + `studio_locations`.
2. En `/studio/dashboard` administra sedes, roster, spots y operaciones.
3. Publica spots abiertos que aparecen en `/studio-spots`.
4. Artistas postulan; el estudio decide.
5. Al aceptar/invitar, se crea/actualiza `studio_artist_memberships` y se notifica via `/api/studio/notify`.

### Instagram import

1. Admin configura token Apify en `/backoffice`.
2. Usuario abre modal `IGImport` desde registro/dashboard.
3. `/api/instagram/preview` obtiene y normaliza perfil.
4. `/api/instagram/commit` sube media a Storage, actualiza artista/estudio y registra `instagram_imports`.

### Observabilidad y soporte

1. `logging-loader.js` registra sesiones/errores.
2. Al cerrar pagina, `/api/session-log` persiste datos finales y geolocaliza IP.
3. Backoffice/soporte consumen `/api/analytics/*` y tablas de soporte.
4. `/api/health/*` mide servicios y guarda historial en `service_health_logs`.

## Componentes locales relevantes

| Archivo/modulo | Rol |
| --- | --- |
| `server.js` | Servidor Express, APIs, health, analytics, Google, Gemini, Instagram, backup y clean URLs. |
| `lib/prequote-estimator.js` | Logica pura del pre-cotizador. |
| `lib/app-settings.js` | Lectura/escritura de settings privados/publicos en Supabase. |
| `lib/instagram-import.js` | Orquestacion Apify -> transform -> Storage -> DB -> audit. |
| `public/shared/js/script.js` | Flujo principal de cotizacion. |
| `public/shared/js/dashboard.js` | Dashboard de artista. |
| `public/shared/js/admin.js` | Backoffice. |
| `public/shared/js/support-dashboard.js` | Operaciones de soporte. |
| `public/shared/js/studio-dashboard.js` | Perfil/sedes/roster/spots de estudio. |
| `public/shared/js/studio-dashboard-ops.js` | Operaciones, facturas, documentos, inventario, proveedores, sponsors y analytics de estudio. |
| `public/shared/js/client-dashboard.js` | Dashboard de cliente, cotizaciones, chat y job board. |
| `public/shared/js/shared-drawer.js` | Acciones comunes sobre cotizaciones. |
| `public/shared/js/explore-map.js` / `explore-globe.js` | Descubrimiento geografico de artistas/estudios. |

## Notas de alcance y riesgos

- La fuente de verdad usada para este mapa es el codigo local y las migraciones locales. Si la base remota de Supabase tiene migraciones aplicadas fuera del repo, este documento no las ve.
- Hay tablas legacy o documentadas por codigo pero no creadas en las migraciones recientes del repo (`clients_db`, `support_users_db`, `feedback_tickets`, `chat_messages`, `quotation_*`, `job_board_*`, `app_settings`). Existen como dependencias reales del codigo y probablemente vienen de migraciones anteriores o de estado historico de Supabase.
- `app-config.json` contiene configuracion publica y URLs de webhooks; los secretos operativos deben vivir en variables de entorno o en `app_settings` privado.
- Algunos modulos siguen compartiendo convenciones heredadas de "admin operativo" (`/my-quotations`, `/archive`, `/calendar`) aunque hoy tambien funcionan para artistas.
