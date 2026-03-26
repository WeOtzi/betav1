# Job Board - Documentacion de Implementacion

**Version:** 1.0.0
**Fecha:** 2026-02-22
**Estado:** Implementacion completa

---

## 1. Resumen Ejecutivo

El **Job Board** es una nueva funcionalidad de We Otzi que permite a los clientes publicar solicitudes de tatuaje de forma publica para que artistas verificados puedan descubrirlas y postularse. Es un modelo inverso al flujo tradicional de cotizacion directa: en lugar de que el cliente busque un artista especifico, el cliente describe lo que quiere y los artistas vienen a el.

### Por que se implemento
- **Democratizar el acceso**: Clientes que no saben a quien elegir pueden recibir propuestas de multiples artistas.
- **Generar demanda para artistas**: Los artistas descubren oportunidades de trabajo que de otra forma no llegarian a ellos.
- **Coexistencia con el flujo existente**: El Job Board NO reemplaza la cotizacion directa (`/quotation`). Ambos flujos coexisten y, cuando un artista es aceptado en el Job Board, se crea automaticamente una cotizacion en `quotations_db` con `source = 'job_board'`.

### Flujo general
1. Cliente publica una solicitud de tatuaje (descripcion, zona, tamano, estilo, presupuesto, referencias)
2. La solicitud aparece en el feed publico `/job-board`
3. Artistas autenticados pueden postularse con un mensaje, precio estimado y disponibilidad
4. El cliente revisa las postulaciones desde su dashboard
5. Al aceptar un artista, se crea automaticamente una cotizacion en el sistema existente

---

## 2. Arquitectura del Sistema

```
                                CLIENTE                                        ARTISTA
                                  |                                              |
                    /job-board/request                                    /job-board (feed)
                    (formulario wizard 8 pasos)                     (directorio publico)
                                  |                                              |
                                  v                                              v
                    +---------------------------+              +---------------------------+
                    | job-board-request.js       |              | job-board-feed.js         |
                    | - Wizard multi-step        |              | - Fetch open requests     |
                    | - Draft persistence (LS)   |              | - Filtros avanzados       |
                    | - Auth gate (register/     |              | - Paginacion              |
                    |   login inline)            |              | - Modal de postulacion    |
                    | - Upload refs a Storage    |              | - Auth check (artist)     |
                    +---------------------------+              +---------------------------+
                                  |                                              |
                                  v                                              v
                    +-------------------------------------------------------+
                    |                   SUPABASE (PostgreSQL)                |
                    |                                                       |
                    |  job_board_requests  <----  job_board_applications     |
                    |       |                          |                     |
                    |       v                          v                     |
                    |  job_board_attachments     artists_db (FK)             |
                    |       |                                               |
                    |       v                                               |
                    |  Storage: job-board-references (bucket)               |
                    +-------------------------------------------------------+
                                  |
                   (Accept Flow)  |
                                  v
                    +---------------------------+
                    | server.js                 |
                    | POST /api/job-board/      |
                    |      accept-application   |
                    | - Crea quotation           |
                    | - Acepta postulacion       |
                    | - Rechaza las demas        |
                    | - Actualiza request status |
                    +---------------------------+
                                  |
                                  v
                    +---------------------------+
                    | quotations_db             |
                    | source = 'job_board'      |
                    | job_board_request_id = FK  |
                    +---------------------------+
                                  |
                    +-------------+-------------+
                    |                           |
             /client/dashboard           /my-quotations
             (tab Solicitudes)           (artista ve cotizacion)
```

### Eventos N8N
```
Cliente publica solicitud  -->  job_board_request_created
Artista se postula         -->  job_board_application_received
Cliente acepta artista     -->  job_board_artist_accepted
```

---

## 3. Base de Datos

### 3.1 Tabla: `job_board_requests`

| Columna | Tipo | Default | Nullable | Descripcion |
|---------|------|---------|----------|-------------|
| `id` | uuid | gen_random_uuid() | NO | PK |
| `request_code` | text | (trigger) | NO | Codigo unico auto-generado (JB-XXXXX). UNIQUE |
| `client_user_id` | uuid | - | NO | FK -> clients_db.user_id |
| `tattoo_body_part` | varchar | - | SI | Zona del cuerpo |
| `tattoo_body_side` | varchar | - | SI | Sub-zona especifica |
| `tattoo_idea_description` | text | - | NO | Descripcion de la idea |
| `tattoo_size` | varchar | - | SI | pequeno/mediano/grande/muy_grande |
| `tattoo_style` | jsonb | - | SI | Array de estilos (JSON) |
| `tattoo_color_type` | varchar | - | SI | full_color/black_grey/no_preference |
| `tattoo_is_first_tattoo` | boolean | false | SI | Es primer tatuaje |
| `tattoo_is_cover_up` | boolean | false | SI | Es cover-up |
| `client_city` | text | - | SI | Ciudad del cliente |
| `client_country` | text | - | SI | Pais del cliente |
| `client_travel_willing` | boolean | false | SI | Dispuesto a viajar |
| `client_preferred_date` | varchar | - | SI | Fecha preferida |
| `client_flexible_dates` | varchar | - | SI | Fechas flexibles |
| `client_budget_min` | integer | - | SI | Presupuesto minimo |
| `client_budget_max` | integer | - | SI | Presupuesto maximo |
| `client_budget_currency` | varchar | 'USD' | SI | Moneda |
| `status` | text | 'open' | NO | draft/open/in_review/accepted/closed/expired |
| `application_count` | integer | 0 | SI | Contador de postulaciones (trigger) |
| `max_applications` | integer | 20 | SI | Limite de postulaciones |
| `is_public` | boolean | true | SI | Visible en el feed |
| `created_at` | timestamptz | now() | SI | Fecha de creacion |
| `updated_at` | timestamptz | now() | SI | Ultima actualizacion |
| `expires_at` | timestamptz | now() + 30 days | SI | Fecha de expiracion |
| `accepted_at` | timestamptz | - | SI | Fecha de aceptacion |
| `accepted_artist_id` | uuid | - | SI | FK -> artists_db.user_id |
| `accepted_application_id` | uuid | - | SI | FK -> job_board_applications.id |
| `resulting_quote_id` | varchar | - | SI | quote_id de la cotizacion creada |

### 3.2 Tabla: `job_board_applications`

| Columna | Tipo | Default | Nullable | Descripcion |
|---------|------|---------|----------|-------------|
| `id` | uuid | gen_random_uuid() | NO | PK |
| `request_id` | uuid | - | NO | FK -> job_board_requests.id |
| `artist_id` | uuid | - | NO | FK -> artists_db.user_id |
| `message` | text | - | NO | Mensaje del artista al cliente (min. 10 caracteres) |
| `estimated_price` | varchar | - | NO | Precio estimado (numerico, > 0) |
| `estimated_sessions` | integer | - | NO | Sesiones estimadas (>= 1) |
| `availability_note` | varchar | - | SI | Nota de disponibilidad |
| `portfolio_links` | text[] | - | SI | Links a portfolio |
| `status` | text | 'pending' | NO | pending/viewed/accepted/rejected/withdrawn |
| `created_at` | timestamptz | now() | SI | Fecha de creacion |
| `updated_at` | timestamptz | now() | SI | Ultima actualizacion |
| `decided_at` | timestamptz | - | SI | Fecha de decision |

### 3.3 Tabla: `job_board_attachments`

| Columna | Tipo | Default | Nullable | Descripcion |
|---------|------|---------|----------|-------------|
| `id` | uuid | gen_random_uuid() | NO | PK |
| `request_id` | uuid | - | NO | FK -> job_board_requests.id |
| `file_name` | text | - | SI | Nombre del archivo |
| `file_url` | text | - | NO | URL publica del archivo |
| `storage_path` | text | - | SI | Ruta en Storage bucket |
| `mime_type` | text | - | SI | Tipo MIME |
| `file_size` | integer | - | SI | Tamano en bytes |
| `sort_order` | integer | 0 | SI | Orden de la imagen |
| `created_at` | timestamptz | now() | SI | Fecha de creacion |

### 3.4 Modificaciones a `quotations_db`

Se agregaron dos columnas:
- `source` (text, default 'direct', CHECK: direct/job_board/recommendation) - Origen de la cotizacion
- `job_board_request_id` (uuid, nullable, FK -> job_board_requests.id) - Referencia a la solicitud del Job Board

### 3.5 Relaciones FK

```
clients_db.user_id        <--  job_board_requests.client_user_id
job_board_requests.id     <--  job_board_applications.request_id
job_board_requests.id     <--  job_board_attachments.request_id
artists_db.user_id        <--  job_board_applications.artist_id
artists_db.user_id        <--  job_board_requests.accepted_artist_id
job_board_requests.id     <--  quotations_db.job_board_request_id
```

### 3.6 Triggers y Funciones

| Trigger | Tabla | Evento | Funcion | Descripcion |
|---------|-------|--------|---------|-------------|
| `trg_generate_request_code` | job_board_requests | INSERT | `generate_request_code()` | Genera codigo unico JB-XXXXX |
| `trg_update_jbr_updated_at` | job_board_requests | UPDATE | `update_jbr_updated_at()` | Actualiza updated_at |
| `trg_increment_app_count` | job_board_applications | INSERT | `increment_application_count()` | Incrementa application_count en request |
| `trg_decrement_app_count_delete` | job_board_applications | DELETE | `decrement_application_count()` | Decrementa al eliminar |
| `trg_decrement_app_count_withdraw` | job_board_applications | UPDATE | `decrement_application_count()` | Decrementa cuando status cambia a 'withdrawn' |
| `trg_update_jba_updated_at` | job_board_applications | UPDATE | `update_jbr_updated_at()` | Actualiza updated_at |

**Funcion `generate_request_code()`:**
Genera codigos tipo `JB-XXXXX` (5 digitos aleatorios). Verifica unicidad en un loop.

**Funcion `increment_application_count()`:**
Incrementa en 1 el campo `application_count` de la request asociada.

**Funcion `decrement_application_count()`:**
Decrementa en 1 (con GREATEST(0,...)) cuando se elimina una application o su status cambia a 'withdrawn'.

**Funcion `expire_old_job_board_requests()`:**
Marca como 'expired' y oculta (is_public = false) las requests cuya `expires_at` ha pasado. Debe ser llamada periodicamente (cron o invocacion manual).

### 3.7 Politicas RLS

#### job_board_requests (RLS activado)
| Politica | Operacion | Condicion |
|----------|-----------|-----------|
| Anyone can view open requests | SELECT | status = 'open' AND is_public = true |
| Clients can view own requests | SELECT | auth.uid() = client_user_id |
| Clients can create requests | INSERT | auth.uid() = client_user_id |
| Clients can update own requests | UPDATE | auth.uid() = client_user_id |
| Clients can delete own draft requests | DELETE | auth.uid() = client_user_id AND status IN ('draft', 'open') |

#### job_board_applications (RLS activado)
| Politica | Operacion | Condicion |
|----------|-----------|-----------|
| Artists can view own applications | SELECT | auth.uid() = artist_id |
| Clients can view applications to own requests | SELECT | EXISTS(request WHERE client_user_id = auth.uid()) |
| Artists can create applications | INSERT | auth.uid() = artist_id AND request.status = 'open' AND application_count < max_applications |
| Artists can update own applications | UPDATE | auth.uid() = artist_id |
| Clients can decide on applications | UPDATE | EXISTS(request WHERE client_user_id = auth.uid()) |

#### job_board_attachments (RLS activado)
| Politica | Operacion | Condicion |
|----------|-----------|-----------|
| Anyone can view attachments for open requests | SELECT | request.status = 'open' AND request.is_public = true |
| Clients can view own request attachments | SELECT | request.client_user_id = auth.uid() |
| Clients can add attachments to own requests | INSERT | request.client_user_id = auth.uid() |
| Clients can delete own attachments | DELETE | request.client_user_id = auth.uid() |

### 3.8 Storage Bucket

- **Nombre:** `job-board-references`
- **Tipo:** Publico (read) / Autenticado (write)
- **Estructura de paths:** `{tempId}/ref_{index}.{ext}`
- **Limites:** 4 imagenes max, 5MB cada una, tipos: JPEG, PNG, WebP

### 3.9 Migraciones Aplicadas

| Version | Nombre | Descripcion |
|---------|--------|-------------|
| 20260222160906 | create_job_board_requests | Tabla de solicitudes |
| 20260222160917 | create_job_board_applications | Tabla de postulaciones |
| 20260222160923 | create_job_board_attachments | Tabla de adjuntos |
| 20260222160929 | add_source_columns_to_quotations | Columnas source y job_board_request_id en quotations_db |
| 20260222160947 | rls_policies_job_board | Todas las politicas RLS |
| 20260222160953 | auto_expire_requests_function | Funcion de expiracion automatica |
| 20260222170639 | fix_job_board_function_search_paths | Fix de search_path en funciones |

---

## 4. Archivos del Proyecto

### 4.1 Archivos Nuevos (6)

| Archivo | Lineas | Descripcion |
|---------|--------|-------------|
| `public/job-board/request/index.html` | 113 | Pagina del formulario wizard para publicar solicitudes |
| `public/job-board/index.html` | 220 | Pagina del feed publico con grid, filtros y modals |
| `public/shared/js/job-board-request.js` | 1468 | Logica del wizard: 8 pasos, auth gate, upload, submit, draft |
| `public/shared/js/job-board-feed.js` | 1172 | Logica del feed: fetch, filtros, busqueda, paginacion, postulacion |
| `public/shared/css/job-board-request.css` | 526 | Estilos Bauhaus para el wizard |
| `public/shared/css/job-board-feed.css` | 1042 | Estilos Bauhaus para el feed, cards, modals, responsive |

### 4.2 Archivos Modificados (7)

| Archivo | Cambios Realizados |
|---------|-------------------|
| `server.js` | Agregado endpoint `POST /api/job-board/accept-application` (~210 lineas). Rutas en consola de startup. |
| `public/shared/js/client-dashboard.js` | Agregada seccion JOB BOARD (~335 lineas): tab "Solicitudes", `switchToJobBoard()`, `loadJobBoardRequests()`, `renderJobBoardRequests()`, `viewJBRequestDetail()`, `acceptApplication()`, `rejectApplication()`, Realtime subscription. |
| `public/shared/js/quotations.js` | Agregada seccion JOB BOARD (~130 lineas): `showApplicationsView()`, `loadMyApplications()`, `renderApplicationsView()` (tabla grid de postulaciones del artista). |
| `public/client/dashboard/index.html` | Agregado boton "Publicar Solicitud" en acciones, tab "Solicitudes" con badge, contenedor `jb-requests-list`, modal `jb-applications-modal`. |
| `public/my-quotations/index.html` | Agregado enlace "Job Board" en sidebar, seccion `applications-view` con tabla y enlace a `/job-board`. |
| `public/artist/dashboard/index.html` | Agregado enlace "Job Board" en el panel lateral del artista. |
| `public/shared/js/app-config.json` | Agregados 3 eventos N8N: `job_board_request_created`, `job_board_application_received`, `job_board_artist_accepted`. Agregadas rutas `jobBoard` y `jobBoardRequest`. |

---

## 5. API Endpoints

### POST /api/job-board/accept-application

**Descripcion:** Acepta la postulacion de un artista, crea una cotizacion en quotations_db, rechaza las demas postulaciones y actualiza el estado de la solicitud.

**Request:**
```json
{
  "applicationId": "uuid-de-la-postulacion",
  "requestId": "uuid-de-la-solicitud"
}
```

**Response exitosa (200):**
```json
{
  "success": true,
  "quoteId": "QN-XXXXXXXX-XXXX",
  "message": "Application accepted and quotation created"
}
```

**Response error (400):**
```json
{
  "success": false,
  "error": "applicationId and requestId are required"
}
```

**Response error (500):**
```json
{
  "success": false,
  "error": "Mensaje de error"
}
```

**Flujo interno:**
1. Valida parametros
2. Obtiene application con datos del artista
3. Obtiene request con datos del cliente
4. Obtiene detalles del artista de `artists_db`
5. Obtiene detalles del cliente de `clients_db`
6. Genera `quote_id` unico (formato: QN-{base36timestamp}-{random4})
7. Crea cotizacion en `quotations_db` con `source='job_board'` y `job_board_request_id`
8. Actualiza application a `status='accepted'` con `decided_at`
9. Rechaza todas las demas applications pendientes/viewed
10. Actualiza request: `status='accepted'`, `is_public=false`, `accepted_artist_id`, `resulting_quote_id`

**Autenticacion:** Requiere header `Authorization: Bearer <access_token>` del cliente. El servidor valida la identidad del caller via `/auth/v1/user` y verifica que sea el dueno de la solicitud. Internamente usa `SUPABASE_SERVICE_ROLE_KEY` para las operaciones de escritura.

**Propagacion de oferta:** Al crear la cotizacion, el endpoint copia los datos de la postulacion aceptada: `estimated_price` -> `artist_budget_amount`, moneda del request -> `artist_budget_currency`, `estimated_sessions` -> `tattoo_estimated_sessions`.

---

## 6. Eventos N8N

### 6.1 job_board_request_created
**Disparado por:** `job-board-request.js` al completar el submit exitoso.

```json
{
  "request_id": "uuid",
  "request_code": "JB-12345",
  "client_user_id": "uuid",
  "client_email": "email@test.com",
  "client_name": "Nombre",
  "tattoo_body_part": "Brazo",
  "tattoo_idea_description": "Descripcion...",
  "tattoo_size": "mediano",
  "tattoo_style": ["Realismo", "Fine Line"],
  "tattoo_color_type": "full_color",
  "is_first_tattoo": false,
  "is_cover_up": false,
  "budget_min": 200,
  "budget_max": 500,
  "budget_currency": "USD",
  "client_city": "Buenos Aires",
  "preferred_date": "2026-04",
  "flexible_dates": true,
  "travel_willing": false,
  "reference_images_count": 2,
  "dashboard_url": "https://weotzi.com/client/dashboard?tab=solicitudes"
}
```

### 6.2 job_board_application_received
**Disparado por:** `job-board-feed.js` al completar submit de postulacion.

```json
{
  "application_id": "uuid",
  "request_id": "uuid",
  "request_code": "JB-12345",
  "artist_id": "uuid",
  "artist_username": "artista.wo",
  "artist_name": "Nombre Artista",
  "message": "Mensaje del artista...",
  "estimated_price": "350",
  "estimated_sessions": 2,
  "timestamp": "2026-02-22T15:30:00.000Z"
}
```

### 6.3 job_board_artist_accepted
**Configurado en:** `app-config.json` (evento definido, aun no implementado en el flujo de accept del server.js - el server.js no envia este evento directamente, se puede triggear desde el frontend despues del accept exitoso).

---

## 7. Flujos de Usuario

### 7.1 Flujo del Cliente - Crear Solicitud

1. Cliente accede a `/job-board/request`
2. **Paso 0 - Welcome:** Ve pantalla de bienvenida con 3 feature cards. Click "Comenzar".
3. **Paso 1 - Body Part:** Selecciona zona del cuerpo (cards) y opcionalmente sub-zona.
4. **Paso 2 - Description:** Describe la idea (min 10 caracteres, max 1000). Checkboxes: primer tatuaje, cover-up.
5. **Paso 3 - Size:** Selecciona tamano (pequeno/mediano/grande/muy_grande).
6. **Paso 4 - Style:** Selecciona uno o varios estilos (opcional, puede saltar).
7. **Paso 5 - Color + Refs:** Selecciona tipo de color. Sube hasta 4 imagenes de referencia (drag & drop o click). Puede saltar.
8. **Paso 6 - Preferences:** Presupuesto (min-max con selector de moneda), ciudad (con Google Places autocomplete), fecha preferida, checkboxes flexible/viaje. Puede saltar.
9. **Paso 7 - Account Gate:**
   - Si ya esta logueado: ve resumen y boton "Publicar solicitud"
   - Si no esta logueado: ve formulario register/login inline (tabs)
   - Al registrarse: crea cuenta en auth, inserta en clients_db, auto-login, re-render como logueado
10. Click "Publicar solicitud":
    - Sube imagenes a Storage bucket `job-board-references`
    - Inserta en `job_board_requests` (trigger genera `request_code`)
    - Inserta en `job_board_attachments`
    - Envia evento N8N `job_board_request_created`
    - Limpia draft de localStorage
    - Redirige a `/client/dashboard?tab=solicitudes`

**Draft persistence:** Se guarda automaticamente en localStorage al cambiar de paso. Expira a los 7 dias. Al volver, se ofrece continuar o empezar de nuevo.

### 7.2 Flujo del Artista - Descubrir y Postularse

1. Artista accede a `/job-board` (feed publico)
2. Ve grid de solicitudes abiertas con cards Bauhaus
3. Puede filtrar por: estilo (botones), ciudad (dropdown), tamano, presupuesto
4. Puede buscar por texto (debounced 300ms)
5. Puede ordenar: mas recientes, presupuesto mayor/menor, fecha limite
6. Click en card:
   - Si es artista logueado: abre modal de postulacion con detalle de la solicitud y formulario
   - Si no es artista: abre modal de detalle con prompt de login/registro
7. En el modal de postulacion:
   - Campo obligatorio: mensaje (min 10 caracteres)
   - Campos opcionales: precio estimado (USD), sesiones estimadas, disponibilidad
   - Validacion: verifica que no se haya postulado ya, que la solicitud este abierta, que no se haya alcanzado el max
8. Click "Enviar postulacion":
   - Inserta en `job_board_applications` (trigger incrementa `application_count`)
   - Envia evento N8N `job_board_application_received`
   - Muestra toast de exito
   - Re-renderiza el feed
9. Artista puede ver sus postulaciones en `/my-quotations` > seccion "Mis Postulaciones" (tabla grid con estado, fecha, idea, ciudad, zona, presupuesto, precio propio)

### 7.3 Flujo de Aceptacion

1. Cliente accede a `/client/dashboard`, tab "Solicitudes"
2. Ve lista de sus solicitudes con badge de postulaciones
3. Click en una solicitud: abre modal con todas las postulaciones
4. Cada postulacion muestra: foto, nombre, ubicacion, estilos, mensaje, precio estimado, sesiones, link a perfil del artista
5. Botones "Aceptar" / "Rechazar" para postulaciones pendientes/viewed
6. Click "Aceptar":
   - Confirmacion con alert
   - Llama a `POST /api/job-board/accept-application`
   - Server crea cotizacion con todos los datos cruzados
   - Server acepta la postulacion, rechaza las demas
   - Server marca la solicitud como accepted, oculta del feed
   - Frontend muestra mensaje de exito
   - La cotizacion creada aparece en el sistema de cotizaciones normal

**Realtime:** El dashboard del cliente tiene una suscripcion Realtime que escucha nuevas inserciones en `job_board_applications` y refresca automaticamente la lista si esta visible.

---

## 8. Decisiones Tecnicas

1. **Wizard multi-step vs formulario largo:** Se eligio un wizard de 8 pasos con animaciones para mejorar la UX y reducir la friccion. Los pasos opcionales se pueden saltar.

2. **Auth gate inline:** En lugar de redirigir a una pagina de login externa, se incluyo un formulario de registro/login directamente en el paso final. Esto evita perder los datos del formulario y reduce el abandono.

3. **Draft en localStorage:** Se persisten los datos del formulario en localStorage con expiracion de 7 dias. Permite al usuario retomar donde lo dejo sin perder informacion.

4. **Endpoint server-side para accept:** La logica de aceptacion se ejecuta en el servidor (server.js) usando `SUPABASE_SERVICE_ROLE_KEY` porque necesita actualizar multiples tablas atomicamente y crear una cotizacion que requiere permisos elevados.

5. **application_count via triggers:** En lugar de contar con un COUNT query cada vez, se mantiene un contador denormalizado en `job_board_requests.application_count` que se actualiza via triggers en INSERT/DELETE/UPDATE de applications. Esto optimiza las queries de listado.

6. **request_code via trigger:** El codigo unico JB-XXXXX se genera en un trigger de INSERT para garantizar unicidad a nivel de base de datos, evitando race conditions.

7. **Expiracion a 30 dias:** Las solicitudes expiran automaticamente despues de 30 dias (default de `expires_at`). La funcion `expire_old_job_board_requests()` se debe llamar periodicamente.

8. **Imagenes en Storage separado:** Las referencias del Job Board usan el bucket `job-board-references`, separado del bucket de cotizaciones (`quotation-references`), para mantener organizacion y facilitar cleanup.

9. **Feed client-side filtering:** Los filtros se aplican en el frontend sobre los datos ya cargados (no hay queries adicionales al filtrar). Esto funciona bien para el volumen esperado en beta cerrada y proporciona una experiencia instantanea.

10. **Paginacion client-side:** 20 items por pagina, calculada sobre el array filtrado en memoria. Adecuado para el volumen de beta.

---

## 9. Consideraciones de Seguridad

### RLS (Row Level Security)
- Todas las tablas del Job Board tienen RLS activado.
- Solicitudes publicas: solo se ven las que estan `status='open'` AND `is_public=true`.
- Clientes solo pueden CRUD sobre sus propios datos.
- Artistas solo pueden ver/editar sus propias postulaciones.
- La creacion de postulaciones valida a nivel de RLS que la request este abierta y no haya alcanzado el maximo.

### Auth Gates
- El formulario de solicitud tiene un auth gate en el paso final: el usuario debe estar logueado para publicar.
- El feed de postulaciones requiere artista autenticado para enviar postulaciones. Usuarios no logueados o no-artistas ven un modal de login.

### Sanitizacion
- `escapeHtml()` se usa en ambos archivos JS para sanitizar contenido renderizado en el DOM.
- Los IDs se pasan como parametros a Supabase via el SDK (no concatenados en queries SQL directas en el frontend).

### Endpoint Accept
- Usa `SUPABASE_SERVICE_ROLE_KEY` del lado del servidor (no expuesto al frontend).
- Valida que `applicationId` y `requestId` existan antes de proceder.
- La validacion de propiedad del request se delega al flujo del frontend (el cliente solo puede ver sus propias requests gracias a RLS).

### Storage
- El bucket `job-board-references` acepta solo imagenes (JPEG, PNG, WebP).
- Limite de 5MB por archivo, maximo 4 archivos.
- Validacion client-side de tipo y tamano antes de subir.

---

## 10. Estado de Implementacion

### Completado
- [x] Tabla `job_board_requests` con triggers y RLS
- [x] Tabla `job_board_applications` con triggers y RLS
- [x] Tabla `job_board_attachments` con RLS
- [x] Columnas `source` y `job_board_request_id` en `quotations_db`
- [x] Funcion `generate_request_code()` con trigger
- [x] Funciones `increment/decrement_application_count()` con triggers
- [x] Funcion `expire_old_job_board_requests()`
- [x] Formulario wizard de 8 pasos (`/job-board/request`)
- [x] Feed publico con filtros y paginacion (`/job-board`)
- [x] Modal de postulacion para artistas
- [x] Modal de login prompt para no-artistas
- [x] Auth gate inline (register + login)
- [x] Upload de imagenes de referencia a Storage
- [x] Draft persistence en localStorage
- [x] Endpoint `POST /api/job-board/accept-application`
- [x] Creacion automatica de cotizacion al aceptar
- [x] Rechazo automatico de postulaciones restantes
- [x] Tab "Solicitudes" en Client Dashboard con card list
- [x] Modal de postulaciones en Client Dashboard con accept/reject
- [x] Vista "Mis Postulaciones" en Artist Quotations (tabla grid)
- [x] Realtime subscription para nuevas postulaciones
- [x] 3 eventos N8N configurados
- [x] Responsive design (4-3-2-1 columnas)
- [x] Estilos Bauhaus consistentes
- [x] Dark mode support en feed
- [x] Google Places autocomplete en campo ciudad
- [x] Navegacion por teclado (Enter/Escape) en wizard
- [x] 7 migraciones aplicadas correctamente

### Cambios v1.1 (2026-03-12)

- **Fix:** Artistas con lookup fallido ya no ven "REVISAR PANEL" en `/job-board`. `artist-auth.js` reintenta una vez ante errores transitorios y `job-board-feed.js` resuelve el estado localmente.
- **Obligatorio:** Precio estimado y sesiones estimadas son ahora campos requeridos en la postulacion (HTML `required` + validacion JS).
- **Auth:** `acceptApplication()` en `client-dashboard.js` envia `Authorization: Bearer <token>` al endpoint `accept-application`.
- **Propagacion:** Al aceptar, `server.js` copia `estimated_price` -> `artist_budget_amount`, moneda -> `artist_budget_currency`, y `estimated_sessions` -> `tattoo_estimated_sessions` en `quotations_db`.
- **Dashboard artista:** Contador `#quote-applications` poblado con total de postulaciones. Click navega a `/my-quotations?tab=applications`.
- **Vista postulaciones artista:** Rediseño de tabla grid a tarjetas con mensaje, precio, sesiones y enlace a cotizacion aceptada.
- **Select:** `client-dashboard.js` ahora incluye `availability_note` en el select de `job_board_applications`.
- **Tests:** 2 regresiones nuevas en `tests/artist-auth.test.js` (retry exitoso + doble fallo persistente).

### Pendiente / Mejoras Futuras
- [ ] Cron job o pg_cron para ejecutar `expire_old_job_board_requests()` automaticamente
- [ ] Envio del evento N8N `job_board_artist_accepted` desde el endpoint de accept
- [ ] Notificaciones push/email al recibir postulaciones
- [ ] Permitir al artista retirar (withdraw) su postulacion
- [ ] Edicion de solicitudes por parte del cliente
- [ ] Galeria de imagenes de referencia en el feed (actualmente solo se muestra la primera)
