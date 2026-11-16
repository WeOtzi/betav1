# Documentación Técnica - We Ötzi Unified

> Para el inventario completo actualizado de rutas, funciones por usuario, servicios, arquitectura y componentes Supabase, ver [MAPA_APLICACION.md](./MAPA_APLICACION.md). Este documento mantiene detalles tecnicos de referencia y flujos especificos.

## 1. Arquitectura del Sistema

We Ötzi Unified es una aplicación web moderna construida sobre una arquitectura cliente-servidor, diseñada para ser escalable y fácil de mantener.

### Componentes Principales

*   **Backend**: Node.js con Express.js. Actúa como servidor web, proxy de APIs y orquestador de lógica de negocio.
*   **Frontend**: HTML5, CSS3 y JavaScript (Vanilla) servidos como archivos estáticos. La estructura imita una SPA (Single Page Application) mediante rutas limpias manejadas por el backend.
*   **Base de Datos & Auth**: Supabase (PostgreSQL). Se utiliza para persistencia de datos y gestión de usuarios.
*   **Almacenamiento de Archivos**:
    *   **Supabase Storage**: Para activos inmediatos.
    *   **Google Drive**: Para organización de carpetas de cotizaciones y archivos de referencia a largo plazo.
*   **IA Generativa**: OpenAI Images API con GPT Image 2.6 (`gpt-image-2.6-flare` por defecto; `gpt-image-2.6-sunburst` para trabajo detallado) para generación de imágenes, vía [`lib/ai-image.js`](../lib/ai-image.js). Gemini queda solo como proveedor heredado ([`lib/gemini-image.js`](../lib/gemini-image.js)).

## 2. Estructura de Directorios

```
weotzi-unified/
├── public/                 # Archivos estáticos del Frontend
│   ├── artist/             # Módulos de artista (dashboard, perfil)
│   ├── client/             # Módulos de cliente (login, dashboard)
│   ├── support/            # Módulos de soporte
│   ├── marketplace/        # Marketplace de artistas
│   ├── quotation/          # Formulario de cotización
│   ├── register-artist/    # Wizard de registro
│   ├── shared/             # Recursos compartidos (CSS, JS, Assets)
│   └── ...
├── server.js               # Punto de entrada del servidor Express
├── setup.js                # Bootstrapper del instalador/backup
├── installer/              # Servidor independiente para instalación/restauración
├── docs/                   # Documentación del proyecto
├── logs/                   # Logs del sistema
└── package.json            # Dependencias y scripts
```

## 3. API Reference (Backend)

El archivo `server.js` expone los siguientes endpoints API:

### IA & Generación
*   `POST /api/ai/generate-image` (alias histórico: `POST /api/gemini/generate-image`, mismo guard y mismo handler · [`lib/routes/ai-image.js`](../lib/routes/ai-image.js)): genera una imagen con el proveedor activo. Lo usan el backoffice (íconos de zonas y prueba de conexión), el avatar con IA del artista y "Inspirarme con AI" del Job Board.
    *   Body: `{ prompt, aspectRatio?, model? }`. Del navegador solo cuenta el prompt (máx. 4000 caracteres). `aspectRatio` (`1:1`, `4:3`, `3:2`, `16:9`, `3:4`, `2:3`, `9:16`) y `model` solo valen si los pide un superadmin y están en la lista blanca; para el resto la imagen es cuadrada (1024x1024) con el modelo del servidor. `imageSize`, `temperature`, `maxOutputTokens` y `safetySettings` se descartan.
    *   Respuesta: `{ success: true, image: "data:image/jpeg;base64,…", mime_type, provider, model }`. Error: `{ success: false, code, error }` con `400 ai_invalid`, `422 ai_blocked` (contenido bloqueado), `429 ai_busy` (límite o cuota), `502 ai_error`, `503 ai_unavailable` (sin clave) o `504 ai_timeout`. El detalle del proveedor queda solo en el log del servidor (`[ai-image] generación: …`).
    *   Límites: 20 pedidos por hora por IP (no corre para un superadmin con sesión: el backoffice genera un ícono por zona del cuerpo) y un tope diario del proceso (`AI_IMAGE_DAILY_CAP`, con `GEMINI_DAILY_CAP` como alias; 500 por defecto). El tope se descuenta recién cuando el pedido es válido y hay proveedor, justo antes de generar (un cuerpo vacío no lo gasta), y solo se devuelve si consta que el proveedor no generó nada (rechazo 4xx o pedido que no llegó a salir). Un vencimiento, un 5xx o una respuesta inservible sí lo consumen: pudieron cobrarse. Agotado, responde `429 ai_busy`. La misma regla vale para el tope del cotizador (`AI_REFERENCE_DAILY_CAP`).
*   Proveedor de imágenes ([`lib/ai-image.js`](../lib/ai-image.js)): OpenAI (`POST https://api.openai.com/v1/images/generations`) cuando hay `OPENAI_API_KEY`; Gemini solo si `AI_IMAGE_PROVIDER=gemini` (tener `GEMINI_API_KEY` cargada no lo activa); `AI_IMAGE_PROVIDER=off` apaga la función. La clave se lee solo del entorno del servidor: nunca del body ni de la configuración del backoffice.
    *   Modelos (lista blanca): `gpt-image-2.6-flare` (default) y `gpt-image-2.6-sunburst`. Tamaño según la proporción: `1024x1024`, `1536x1024` (apaisadas) o `1024x1536` (verticales). Salida JPEG (compresión 85), fondo opaco, moderación `auto`. Los modelos GPT Image devuelven siempre base64 (`data[0].b64_json`).
    *   Al proveedor va un `safety_identifier`: el SHA-256 de la llave del borrador (cotizador) o del id de la cuenta (endpoint genérico con sesión). Nunca email, nombre ni IP.
    *   Variables: `OPENAI_API_KEY`, `AI_IMAGE_PROVIDER` (`openai` | `gemini` | `off`), `AI_IMAGE_MODEL`, `AI_REFERENCE_MODEL` (cotizador), `AI_IMAGE_QUALITY` (`low` | `medium` | `high`; default `medium`) y `AI_IMAGE_TIMEOUT_MS` (default `120000`, máximo `280000`; tiene que ser menor que la espera del proxy PHP para estas rutas, 150 s en `deployments/hostinger/proxy.php`). Detalle y puesta en marcha en [`deployments/DEPLOY.md`](../deployments/DEPLOY.md).
    *   La organización de OpenAI puede necesitar verificación para usar los modelos GPT Image: sin ella la API responde 403 y el endpoint devuelve `502 ai_error`.
    *   Config pública (`/shared/js/app-config.json`): `aiImages: { enabled, provider }`. `gemini.enabled` conserva el nombre por compatibilidad y vale lo mismo. En el navegador, `ConfigManager` impone esos dos valores sobre lo guardado en `localStorage` (la IA de imágenes se enciende y se apaga solo en el servidor; el backoffice no tiene interruptor).
    *   Salud: `GET /api/health/gemini` (clave histórica del servicio) consulta el modelo del proveedor activo sin generar imágenes y devuelve `metadata.provider` y `metadata.model`.

### Google Drive Integration
*   `POST /api/google-drive/test`: Verifica conexión y permisos de carpeta.
*   `POST /api/google-drive/create-quote-folder`: re-copia manual (solo superadmin) de las referencias de una cotización a Drive.
    *   Credenciales y carpeta salen SIEMPRE del `.env` (`GOOGLE_DRIVE_SERVICE_ACCOUNT`, `GOOGLE_DRIVE_FOLDER_ID`); el body solo trae `quoteNumber` y `files` (URLs del folder de la cotización en el bucket `quotation-references`, validadas).
    *   La copia automática la hace el servidor después de cada envío (`mirrorQuoteFilesToDrive`). Drive es opcional: la fuente de verdad de las referencias es Storage.

### Cotizador web (`/quotation` y pre-cotizador) · `lib/routes/cot-form.js`
*   `POST /api/quotations/intake`: autosave (`mode: draft`) y envío (`mode: submit`) con service role. La llave del borrador es `submission_key` (UUID v4 del navegador); `quote_id = QN + sha256(submission_key)[0..32]`.
    *   Envío sin artista → `409 { needs_destination: true }`: nunca queda una cotización enviada sin destino.
    *   `references`: paths `QN…/ref_<n>_<ts>.<ext>` del folder del propio borrador (máx. 4). El servidor los registra en `quotations_db.reference_images` y `quotations_attachments`.
    *   Después del envío: `client_quotation_submitted` (llave `quote_id`), `quotation_artist_selected` si el artista salió de las sugerencias (respeta `notification_prefs`), copia opcional a Drive (o a `N8N_REFERENCES_WEBHOOK_URL`/`N8N_WEBHOOK_URL`).
    *   Sesión vencida: responde `session_expired: true` y guarda como anónima (se vincula por email).
    *   Pre-cotizador: `source = web_chat`, `quotation_medium = prequote` (el CHECK de `source` no acepta `prequote`).
*   `POST /api/quotations/suggestions`: artistas sugeridos para una cotización sin artista (`lib/artist-matching.js`: estilo, ciudad/cercanía, presupuesto, verificado). Sin PII.
*   `POST /api/quotations/intake/job-board`: publica la idea sin artista en el Job Board (requiere sesión de cliente; `401/403 { needs_account: true }`). Idempotente por borrador.
*   `POST /api/quotations/style-suggestions`: `{ idea?, artist_styles?, limit? }` → estilos del catálogo `tattoo_styles` sugeridos por palabras clave (`public/shared/js/quotation-style-model.js`, compartido con el wizard) y los que trabaja el artista. Público, sin PII: la idea va en el cuerpo y no se guarda ni se registra. El paso Estilo de `/quotation` calcula lo mismo en el navegador (`quotation-style-step.js`); los pasos Cuerpo y Tamaño viven en `quotation-body-map.js` (silueta + zonas de `body_parts`) y `quotation-size-step.js`.
*   `POST /api/quotations/ai-reference`: referencia generada con IA ("solo referencial"). Body `{ submission_key, idea, styles?, body_part?, color? }`; el prompt, el modelo (`AI_REFERENCE_MODEL`), el tamaño y la calidad los decide el servidor ([`lib/ai-image.js`](../lib/ai-image.js), OpenAI GPT Image). Responde `{ success, image, mime_type, ai_generated, label }`. Límites: 6 por borrador y 10 por IP por hora, más un tope diario (`AI_REFERENCE_DAILY_CAP`, 300 por defecto). El que acota es el de IP: la llave del borrador la elige el navegador (el borrador recién existe en el servidor cuando hay un correo de contacto, dos pantallas después), y el tope diario vive en memoria del proceso (vuelve a cero en cada reinicio).
*   Rate limit propio (no el `apiLimiter` global): 120 por borrador y 1500 por IP cada 15 min en el intake.
*   `GET /api/quotations/artist-locations?artist_id=<uuid>` (ronda 2 · P27, público): sedes y ciudades donde tatúa el artista, armadas con `artist_tattoo_locations`, `studio_public_roster` y `artist_trips`. Responde `{ success, options: [{ key, type, label, studio_name, city, country, from, to, agenda }] }`, con caché de 60 s por artista. Lo que elige el cliente se guarda en `quotations_db.preferred_location_*` y llega precargado al agendar la sesión.
*   `POST /api/quotations/:quoteId/reuse` (ronda 2 · P32, Bearer del cliente dueño): "Cotizar con otro artista". Clona la idea, los datos del cliente y las referencias a un borrador nuevo sin artista y responde `{ success, draft: { submission_key, quote_id, form, references, references_missing, source_code } }`. `401 { needs_account: true }` sin sesión; `404` si la solicitud no es de esa cuenta; `409` si todavía es un borrador. La nueva guarda el origen en `reused_from_quote_id`.
*   Código corto (ronda 2 · P16): `quotations_db.short_code`, 6 caracteres sin `0`, `1`, `I`, `L` ni `O`. Es lo que ve la persona en pantallas, correos y PDF (`lib/quote-code.js` → `visibleCode`); `quote_id` sigue siendo la llave de los enlaces. Al enviar, el servidor llama a la RPC `link_quotation_contact`: el correo con cuenta verificada vincula la cotización a esa cuenta y el teléfono solo agrupa "mismo contacto" (`quotation_contact_links`, lectura por `quotation_same_contact`).

### Pre Cotizador
*   `POST /api/pre-quote/estimate`: Calcula un estimado aproximado de costo y artistas sugeridos a partir de inputs básicos del tatuaje.
    *   Body: `{ tattoo_idea_description?, tattoo_style, tattoo_size, tattoo_body_part?, client_city_residence }`
    *   Validación: `tattoo_style`, `tattoo_size` y `client_city_residence` son requeridos.
    *   Lógica: lee `artists_db`, normaliza `session_price`, clasifica artistas por tier (1: ciudad+estilo, 2: país+estilo, 3: estilo, 4: ciudad). Usa percentiles p25/p75 sobre el sample del mejor tier disponible y multiplica por sesiones estimadas según `tattoo_size`.
    *   Lógica pura: [`lib/prequote-estimator.js`](../lib/prequote-estimator.js).
    *   Pruebas: `npm run test:prequote` ([`scripts/test-prequote-estimator.js`](../scripts/test-prequote-estimator.js)).

### Cliente
*   `POST /api/client/quotations/:quoteId/hide`: Oculta una cotización del dashboard del cliente (soft-delete solo para el cliente).
    *   Headers: `Authorization: Bearer <supabase_access_token>`
    *   Lógica: Verifica identidad del cliente -> Confirma propiedad por `client_user_id` o `client_email` -> Establece `client_deleted_at` en la fila. No afecta la vista del artista ni del admin.
    *   Campo DB: `quotations_db.client_deleted_at` (timestamptz, null = visible).

### Administración & Sistema
*   `POST /api/admin/update-user-password`: Actualiza contraseñas de usuarios (Supabase Admin).
*   `POST /api/admin/generate-backup`: Genera un ZIP completo del sistema (Código + DB + Config).
*   `GET /api/admin/backup-tables`: Lista tablas disponibles para backup.
*   `GET /api/client-info`: Retorna la IP anonimizada (IPv4 /24, IPv6 /48) y timestamp del cliente.
*   `POST /api/session-log`: Endpoint para `sendBeacon` (logs de sesión al cerrar pestaña).

### Store
Contrato completo en [`docs/plans/2026-10-30-store-artista.md`](plans/2026-10-30-store-artista.md) (§7). Handlers en [`services/store-orders.js`](../services/store-orders.js) (testeables con `createHandlers(deps)`), datos en [`lib/repos/store.js`](../lib/repos/store.js) (service role), firma de Storage en [`lib/storage-sign.js`](../lib/storage-sign.js) y adaptadores de pago en [`services/store-payments.js`](../services/store-payments.js). Todas las respuestas son `{ success, error? }` con `Cache-Control: no-store`; los 500 son genéricos (el detalle queda en el log). Los ids de la URL tienen que ser UUID (si no, 400).

> **`features.store` es solo un gate de UI.** Ni estos endpoints ni las RPC/policies de `store_core` lo consultan: con la migración aplicada, la Store se puede operar por API (publicar productos, crear pedidos, ver la vitrina pública) aunque el flag esté en `false`. La migración está aplicada desde el 31 oct 2026 y el flag encendido; un gate propio en el SQL queda pendiente.

*   `POST /api/store/licenses/:licenseId/assets/:assetId/url`: URL firmada para bajar el original o el stencil de una licencia.
    *   Headers: `Authorization: Bearer <supabase_access_token>`. Rate limit: `storeDownloadLimiter` (60 cada 15 min por IP).
    *   Lógica: la licencia tiene que ser del titular (`holder_user_id`) o del comprador del pedido (si no, o si no existe, 403) y no estar revocada (410). El asset tiene que ser del mismo producto (404). Tope de 50 descargas por licencia en una ventana móvil de 24 h (429): primero registra la fila en `store_download_events` y después recuenta incluyéndola; si se pasó del tope, la borra y responde 429. Así, ni con requests en paralelo se emiten más de 50 URLs (en una ráfaga justo en el tope puede rechazar de más). Después firma en `store-design-files` por **300 s fijos** con `download = downloadFileName(asset)`: `sanitizeFilename` (de `store-model.js`) sobre la base sin su extensión, más la extensión del `mime_type` real (`DOWNLOAD_EXTENSIONS`, igual a `v_exts` de `store_design_assets_guard`). Es defensa en profundidad además del guard SQL: se conserva la extensión propia solo si es de ese MIME, otra conocida se reemplaza («scan.png» en JPEG → «scan.jpg»), una desconocida queda en la base («x.exe» → «x.exe.png») y un MIME fuera del bucket baja como `.bin`.
    *   Respuesta: `{ success: true, url, expires_in: 300 }`.
*   `POST /api/store/orders/:id/checkout`: inicia el pago con el adaptador del pedido (`payment_provider`).
    *   Headers: `Authorization: Bearer <supabase_access_token>`. Solo el comprador dueño (si no, 404) y con el pedido `pending_payment` y sin vencer (409). Adaptador no registrado o sin configurar: 503.
    *   Respuesta: `{ success: true, checkout: { mode, instructions?, redirectUrl? } }`. `redirectUrl` siempre es `https://`. En modo `manual` el front no lo llama: pinta las instrucciones desde la fila.
*   `POST /api/quotations/maintenance/expire` (`X-Cron-Token`): corre `expire_stale_quotations(p_limit, p_opt_in_only)` (migración `20261113100000`) y manda `quotation_expired` al cliente de cada respuesta vencida (idempotente por cotización). El vencimiento es opcional y por cotización: el artista lo activa en el detalle, en «Aceptar y enviar presupuesto» o en la cotización manual (`quotations_db.quote_expiry_enabled` + `quote_expiry_days` 1–365; el trigger `trg_quotation_expiry_settings` calcula `quote_expires_at` y solo deja cambiarlo al artista dueño, soporte o service_role). Nada vence por defecto. Variables: `QUOTATION_EXPIRY_BATCH` (500), job interno prendido por defecto cada `QUOTATION_EXPIRY_INTERVAL_MIN` (60) — `QUOTATION_EXPIRY_JOB=off` lo apaga —, `QUOTATION_EXPIRY_EMAIL=off` para no avisar. Lógica en `lib/quotation-expiry.js`.
*   `POST /api/support/artist-decision-notify` (`Authorization: Bearer` de un agente activo de `support_users_db`): body `{ subject: 'document'|'destination'|'withdrawal', id }`. Lo llama la pestaña VERIFICACIONES de soporte después de la RPC (`support_review_verification_document`, `support_review_payout_destination` o `support_settle_artist_withdrawal`). Relee la fila con service-role, solo avisa decisiones de los últimos 15 min, respeta `shouldNotify(artista, 'cuenta', 'email')` y manda `artist_support_decision` (server-only) con idempotencia por decisión. Respuesta `{ success, sent, skipped }`. Lógica en `lib/integracion-support-notify.js`; el aviso in-app lo deriva el panel del artista de las mismas filas.
*   Bajas de cuenta (ronda 3c · borrado, migración `20261113103000`): clientes, artistas y dueños de estudio piden la baja desde su cuenta («Eliminar mi cuenta», `public/shared/js/account-deletion.js`) con la RPC `request_account_deletion(role, reason)`; nada se borra al pedir. `account_deletion_blockers(user_id)` (security definer; el usuario solo para sí, soporte y service-role para cualquiera) lista bloqueos `block`/`check` (disputas abiertas, saldo/retiros/cobros del wallet, cotizaciones en curso, sesiones y reservas futuras, pedidos de la Store, membresías/contratos/equipo de estudio, cuentas protegidas) y avisos `warn`. Soporte gestiona la cola «BAJAS DE CUENTA» (`support-dashboard-account-deletion.js`) con `support_review_account_deletion(id, in_review|blocked|approved|rejected|note|refresh, nota)`; aprobar exige cero bloqueos. `POST /api/support/account-deletions/:id/execute` ejecuta el borrado (service-role) y `POST /api/account-deletion/notify` manda los emails `account_deletion_received|approved|rejected` (server-only, transaccionales, sin `notification_prefs`). Auditoría en `account_deletion_events`. La tabla vieja `artist_account_deletion_requests` queda deprecada (se copia una vez).
*   Acceso (beta cerrada, `lib/routes/acceso.js`, lógica en `lib/acceso.js`, migración `20261115100000`):
    *   `POST /api/account/welcome` (`Authorization: Bearer`): body `{ role: 'artist'|'client' }`. Bienvenida idempotente (`registration:<user_id>` en `email_delivery_ledger`) cuando la cuenta ya está confirmada; la piden `/artist/dashboard`, `/client/dashboard` y el login/registro de cliente (`public/shared/js/wo-welcome.js`). Solo cuentas creadas después de `WELCOME_EMAIL_CUTOFF` y con menos de `WELCOME_EMAIL_MAX_AGE_DAYS` días (sin bienvenidas masivas a cuentas viejas). Respuesta `{ success, sent, deduplicated?, reason }`.
    *   `POST /api/account/terms` (`Authorization: Bearer`): body `{ accepted: true }`. Sella `clients_db.terms_accepted_at/terms_version` con la hora del servidor para el cliente que entró con Google o Facebook (el alta por email la sella `handle_new_user` con `terms_accepted` en el metadata). El navegador no puede escribir esas columnas (`guard_client_terms_acceptance`).
    *   Enlace mágico (`signInWithOtp`, `shouldCreateUser:false`, mensaje neutro) en `/artist/login`, `/client/login` y `/studio/login`. Links vencidos o ya usados (`#error=access_denied&error_code=otp_expired`) se avisan en todas las páginas destino con `WeotziEmailConfirm.readAuthLinkError()` / `renderLinkErrorNotice()`.
*   Panel del cliente (ronda 2, `lib/routes/cliente-panel.js`, lógica en `lib/cliente-panel.js`):
    *   `GET /api/client/panel/notification-matrix` (público, cacheable 5 min): `{ success, role: 'client', channels: ['email','push'], kinds: [{ key, defaults: { email, push } }] }`, tomado de `CLIENT_NOTIF_DEFAULTS` de `lib/notification-prefs.js`. `/client/profile#notificaciones` pinta sus toggles con esa respuesta (`public/shared/js/client-notif-model.js`) y guarda SOLO el evento tocado en `user_preferences.notification_prefs` (RLS dueño), así lo que el cliente nunca eligió sigue el valor por defecto del servidor. El toggle "Email" del registro del cliente (`notification_prefs.email_updates === false`, formato plano) apaga los correos de la matriz del cliente mientras no haya una elección por evento (`resolvePreference`).
    *   Estados y código de la cotización para el cliente: `public/shared/js/client-panel-model.js` (`WoClientPanel`) es la única fuente de etiquetas de `/client/dashboard`, `/client/requests` y `/client/chats`. Reutiliza `WoClientQuoteProposal.statusOf` y superpone, solo si los datos existen, "Cambios propuestos por ti / por el artista", "Cambios al acuerdo pendientes de aprobar" y "Sesión por confirmar" (el contrato de campos tolerados está en la cabecera del archivo). `quoteCode()` muestra `quotations_db.short_code` si existe y si no el `quote_id`; el buscador del panel encuentra por ese código.
*   `POST /api/store/maintenance`: corre `run_store_maintenance()` (vencimientos, pagos informados vencidos, entregas automáticas y liberación de fondos). Lo dispara un job de n8n cada hora. Un pago informado vencido tiene 7 días de gracia: se marca `needs_support` y recién después se vence. La RPC usa `lock_timeout = 5s` y `skip locked`; el error de un pedido va a `store_order_support_notes` (`maintenance_error`) y no corta la corrida.
    *   Headers: `X-Cron-Token: <CRON_API_TOKEN>` (comparación en tiempo constante). Token ausente o distinto: 401; sin `CRON_API_TOKEN` en el servidor: 503.
    *   Respuesta: `{ success: true, result: { expired, flagged, delivered, released, failed: [ids] } }`.
*   `POST /api/store/payments/webhook/:provider`: aviso de pago de un proveedor real (Stripe, Mercado Pago; hoy ninguno registrado, así que responde 404).
    *   Body crudo (`express.raw({ type: '*/*', limit: '1mb' })`), registrado **antes** de `app.use(express.json(...))` para que la firma se calcule sobre los bytes exactos. `apiLimiter` lo saltea (`skip`) y tiene su propio limiter (120/min).
    *   Lógica: sin adaptador con `parseWebhook` → 404. Con adaptador: `verifyWebhook(rawBody, headers)` (HMAC con `crypto.timingSafeEqual`; si falla, 401) → `parseWebhook` (`null` o un evento que no es `payment_succeeded` → 200 `{ ignored: true }`; ilegible o inválido → 400) → RPC `confirm_store_order_payment_as_provider` → 200. La RPC también reabre un pedido `expired` (webhook tardío con un cobro real). Un error `store:<código>` de la RPC responde 422; cualquier otro, 500 (el proveedor reintenta). Con `store:cannot_reopen` (venció y ya no hay stock, o el diseño se reservó o vendió para otro pedido) el cobro queda huérfano: además del 422, el handler deja un `log.error` «COBRO HUÉRFANO» con pedido, proveedor, referencia y monto, para que soporte devuelva el pago o lo resuelva a mano.

### Denuncias → tickets de soporte
Ronda 2 (frente «denuncias»). Migración `20261116210000_support_ticket_reports.sql` (reversa en `supabase/rollbacks/`): `support_tickets.kind` admite `denuncia`, tabla `support_ticket_reports` (un expediente jsonb por ticket; RLS: solo soporte lee) y RPC `create_support_report(p_report jsonb)` solo `service_role`. Lógica pura en `lib/denuncias.js`, rutas en `lib/routes/denuncias.js`, datos en `lib/repos/denuncias.js`, emails server-only en `services/email-events/denuncias.js` (`report_ticket_created_support` a `SUPPORT_EMAIL` o a los agentes activos; `report_ticket_received` al denunciante).
*   Quién denuncia qué: el artista, una cotización que recibió (comentarios abusivos, fotos inapropiadas, violencia, spam) o el perfil de otro artista; el dueño o manager activo de un estudio, otro estudio (suplantación de identidad, robo de propiedad intelectual, difamación). Nadie se denuncia a sí mismo. El denunciado **no** queda como `counterpart_user_id` del ticket: no ve la denuncia.
*   Front: cualquier `<button data-wo-report data-kind="quotation|artist|studio" data-id data-label>` lo activa `public/shared/js/wo-report.js` (carga su CSS, decide quién ve el botón y abre el modal: motivo, descripción, enlaces, hasta 3 imágenes al bucket privado `support-attachments` bajo `<user_id>/denuncias/`, confirmación y acuse con el número `WO-00000`). `data-id` acepta el id numérico o el código de la cotización, el `user_id`/`id`/usuario del artista y el `id`/slug del estudio.
*   `GET /api/reports/eligibility?kind&id` (Bearer): `{ eligible, reasons[], target_label }` o `{ eligible: false, code, message }`.
*   `POST /api/reports` (Bearer; 20/h por IP y 10 denuncias por persona cada 24 h en la RPC): body `{ kind, target_id, reason, description, links[], attachments[], page_context }`. El servidor arma el expediente con service-role (denunciante y denunciado: id, rol, nombre, email de `auth.users`, ficha; cotización: datos, referencias y últimos 80 mensajes; nunca salud, alergias ni fecha de nacimiento) y llama a la RPC, que deduplica denuncias abiertas iguales (mismo denunciante, objetivo y motivo → devuelve el ticket existente con `duplicate: true`), valida que los adjuntos existan en Storage y crea ticket + expediente en una transacción. Respuesta `201 { success, ticket: { id, number, code, status } }`; `429 REPORT_DAILY_LIMIT` al pasar el tope.
*   Soporte (agente activo de `support_users_db` o superadmin): `GET /api/support/reports?status&kind`, `GET /api/support/reports/:ticketId` (expediente con evidencia y adjuntos del chat firmados 10 min), `POST …/:ticketId/status` `{ status, resolution, outcome }` y `POST …/:ticketId/notes` `{ note }` (nota interna en `support_ticket_messages`). Pestaña DENUNCIAS de `/support/dashboard` (`support-dashboard-reports.js`; `#denuncias` la abre directo).
*   Disputas (P28): `POST /api/sesiones/:sessionId/dispute` abre un ticket `kind='disputa'` y la cotización queda con `dispute_status='open'` (no se completa ni se cambia el acuerdo). Soporte las ve y las cierra con `GET /api/support/disputes?status`, `GET /api/support/disputes/:ticketId`, `POST …/:ticketId/status` `{ status: in_progress | waiting_user | resolved | closed, resolution, outcome }` y `POST …/:ticketId/notes` (`lib/routes/soporte-disputas.js`; pestaña DISPUTAS de `/support/dashboard`, `#disputas` la abre directo). Resolver pide resultado y resolución; cerrar sin resolver pide el motivo. El trigger `trg_support_tickets_sync_dispute` recalcula `dispute_status` (`resolved`, o `none` si se cerró sin resolver) y las dos partes reciben `session_dispute_resolved` con el texto de soporte. Pendiente: aplicar desde soporte el cambio de fecha o lugar de la sesión cuando la disputa se resuelve a favor del cambio (hoy, resuelta la disputa, el artista cancela esa sesión y agenda una nueva, que el cliente confirma).

### Turnos y reservas online
Migración `20261115160000_turnos_reservas_online.sql` (reversa en `supabase/rollbacks/`). El artista activa las reservas online (opt-in) en Cuenta → Disponibilidad → «Reservas online» con sus reglas (`artist_booking_settings`: duración 180 min, intervalo 60, margen 30, anticipación 24 h, horizonte 365 d, apartado 72 h por defecto). Los turnos libres se calculan en el servidor con el modelo puro `public/shared/js/booking-slots-model.js` (horario semanal de `user_preferences.app_settings.availability`, ubicación vigente, zona horaria del artista con DST) menos los ocupados de `list_artist_blocking_intervals` (eventos que bloquean, sesiones, citas de estudio, viajes confirmados, vacaciones y apartados vigentes). Servicio en `lib/booking-slots.js`, rutas en `lib/routes/turnos.js`, datos en `lib/repos/booking.js`.
*   `GET /api/public/artists/:username/slots?from&to&granularity=day|slot` (público, `Cache-Control: public, max-age=60`, máx. 93 días): solo inicio, fin y etiqueta horaria de cada turno libre; nunca títulos, clientes ni ids. Lo usa `/turnos?artist=<u>` (página pública), el perfil (`#turnos`) y el cotizador.
*   `GET /api/calendar/availability?summary=1[&from&to]`, `GET|PUT /api/calendar/booking-settings`, `GET /api/calendar/booking-holds` (Bearer del artista): resumen semana/mes/3 meses/año (capacidad real sin superponer turnos), reglas y apartados para el calendario.
*   `POST /api/quotations/intake` con `requested_slot {start, minutes}` y `mode: 'submit'`: el servidor confirma que el turno sigue ofrecido y llama a `save_web_quotation_with_slot`, que guarda la cotización y crea el apartado (`artist_booking_holds`, 72 h) en una sola transacción con advisory lock por artista. Si otro cliente lo tomó: 409 `slot_taken` con `alternatives` y la cotización queda en borrador. Los autosaves de borrador nunca crean apartados.
*   `POST /api/turnos/holds/:id/confirm` (artista; opcional `starts_at`, `minutes` para proponer otro horario): `confirm_artist_slot_hold` crea la sesión (`quotation_sessions`) y el turno queda bloqueado; choque → 409. `POST /api/turnos/holds/:id/release` (artista o cliente). `GET /api/turnos/quotations/:id/hold` (artista o cliente de la cotización).
*   En el detalle de la cotización (artista): «Aceptar y enviar presupuesto» trae marcada «Reservar el turno pedido»; si se destilda, el apartado se libera al responder. «Confirmar acuerdo y agendar» precarga la primera sesión con el turno apartado y la crea con `confirm_artist_slot_hold` (antes de aprobar: si el horario choca, no se guarda nada). Los errores de la base nunca se devuelven crudos: las rutas de turnos solo exponen sus propios mensajes.
*   Vencimiento: job interno cada 15 min (`TURNOS_HOLD_JOB=off` lo apaga) y `POST /api/turnos/maintenance/expire` (`X-Cron-Token`) con `expire_artist_slot_holds`. Cancelar, vencer o rechazar la cotización libera el apartado por trigger (y cancela la sesión futura del turno); cancelar esa sesión libera el turno.
*   Superposición: `quotation_sessions` no puede pisar eventos que bloquean, otras sesiones ni citas de estudio (`23P01 CALENDAR_OVERLAP`); `prevent_artist_calendar_overlap` también mira sesiones y citas de estudio, y `check_artist_calendar_conflicts` avisa sesiones, citas, viajes, vacaciones y solicitudes de turno con títulos genéricos.
*   Emails server-only en `services/email-events/turnos.js`: `booking_slot_requested` (artista), `booking_slot_confirmed` y `booking_slot_hold_expired` (cliente), con idempotencia por apartado.

### Avisos push e in-app (ronda 2 · frente push)
Migración `20261116170000_push_notifications.sql` (reversa en `supabase/rollbacks/`): `push_subscriptions` (una fila por navegador; escribe el servidor, el dueño lee sin las claves y borra) y `user_notifications` (avisos del usuario; inserta el servidor, el dueño lee y marca `read_at`; está en la publicación `supabase_realtime`).
*   **Un solo camino**: `lib/push-dispatch.js` → `notifyUser()` guarda el aviso en `user_notifications` (la app abierta lo recibe por Realtime: toast + sonido, `public/shared/js/wo-notify.js`) y lo manda por Web Push a los navegadores suscriptos (`lib/web-push.js`: VAPID RFC 8292 + `aes128gcm` RFC 8291 con `node:crypto`, sin dependencias). El índice único `(user_id, dedupe_key)` evita repetir un aviso.
*   **Disparo**: `services/email-service.js` llama a `pushDispatch.onEmailEvent()` en cada `sendEmail()` (título = asunto, texto = preheader, destino = CTA del render spec; solo categorías `quotations`, `messages`, `calendar`, `studios` y decisiones de verificación; nunca códigos ni datos de salud). `POST /api/email/:eventId` llama a `onMessageEvent()` para chat e inbox: el aviso sale al instante aunque el correo vaya agrupado (15 min) o diferido (2 min). Quien hizo la acción (`options.actorUserId`) no recibe su propio aviso.
*   **A quién se avisa**: al `user_id` que trae el evento; si solo trae un email, a la cuenta de ese rol cuyo email **verificado en Auth** es ese (RPC `push_recipient_user_id(rol, email)`, solo `service_role`, en la misma migración). No se mira la columna `email` de `clients_db` / `artists_db` / `studios`, que el usuario puede editar. Sin cuenta verificada con ese correo no hay aviso (el correo sale igual). Las cuentas de QA marcadas `qa_unverified_email` tampoco se resuelven por email.
*   **Preferencias**: columna "Push" de la matriz (`user_preferences.notification_prefs`, `lib/notification-prefs.js` con canal `push`). Independiente del email.
*   `GET /api/push/config` → `{ enabled, publicKey }`. `POST /api/push/subscribe` `{ subscription }` (Bearer; valida que el endpoint sea de un servicio push conocido — anti SSRF). `POST /api/push/unsubscribe` `{ endpoint }`. `POST /api/push/refresh` `{ old_endpoint, old_auth, subscription }` (rotación desde el service worker; exige el secreto `auth` de la suscripción anterior). `POST /api/push/test` `{ role }` (Bearer; "Probar aviso"). Rutas en `lib/routes/push.js`, datos en `lib/repos/push.js`.
*   **Front**: `config-manager.js` inyecta `wo-notify.js` en todas las páginas; expone `window.WoNotify.ping({ title, body, url })`, `enablePush()` (desde el botón "Activar avisos" o al prender un toggle "Push" de la matriz, que emite `wo:notif-pref-changed`; siempre tras un clic), `focusArrival(ver)` y el evento `wo:notify`. El service worker `public/wo-sw.js` muestra la notificación del sistema si la app no tiene el foco y abre el destino al tocarla; en Safari (WebKit) la muestra también con foco, muda y por 4 s, porque WebKit revoca la suscripción a los tres push sin notificación visible. Sin `VAPID_*` el push queda apagado en silencio y lo demás sigue funcionando.
*   **Historial de avisos (EP-08)**: las contrapropuestas, los cambios al acuerdo y las novedades de sesiones quedan en la campana del artista (`wo-artist-menu.js`, ítems `type: 'aviso'`) y en "Tu actividad" del cliente (`client-dashboard.js`), leídas de `user_notifications` por `WeotziData.Notifications.listStored(userId, { role, eventIds, days, limit })` (14 días). La lista de eventos por rol (`STORED_NOTICE_EVENTS`) y el mapeo fila → ítem (`storedNoticeItems`, `clientNoticeEvents`) están en `notification-feed-model.js`: solo entran los eventos que no tienen ya un ítem derivado de otra tabla (mensajes, solicitudes, cambios de estado), para no repetir. Abrir el ítem sella `read_at`. Los avisos existen desde que se aplica la migración `20261116170000`; lo anterior no se reconstruye.
*   **Actividad clicable (P26)**: `public/shared/js/notification-feed-model.js` arma el destino exacto de cada ítem (`/my-quotations/detail?id=`, `/client/dashboard?quote=`, `/artist/inbox?quote=|thread=`, `/client/chats?quote=`, `/calendar?view=day&date=&event=session:<id>`, `/artist/account#verificacion`). `?ver=<zona>` (propuesta, acuerdo, chat, sesiones, historial, disputa, cierre, pagos) resalta el bloque al llegar.

### Propuesta del artista (ronda 2 · frente cot-respuesta)
Migración `20261116120000_cot_respuesta_propuesta.sql`. Guía completa: [COT_RESPUESTA.md](COT_RESPUESTA.md). Rutas en [`lib/routes/cot-respuesta.js`](../lib/routes/cot-respuesta.js), lógica en `lib/cot-respuesta.js`. Todas piden el Bearer del artista dueño de la cotización.
*   `GET /api/cot-respuesta/quotations/:quoteId/proposal`: contexto del diálogo "Aceptar y enviar presupuesto" (si se puede enviar, zona horaria del artista y campos ya guardados).
*   `GET /api/cot-respuesta/quotations/:quoteId/availability?from&to&minutes`: agenda real del artista (libre, parcial u ocupado por día, turnos sugeridos y lo confirmado).
*   `POST /api/cot-respuesta/quotations/:quoteId/proposal`: valida y guarda la propuesta (`offered_slots`, `proposal_message`). `409 slot_conflict` si una fecha ofrecida choca con algo confirmado. Si la cotización ya estaba respondida, avisa al cliente con `artist_updated_quotation_proposal`.
*   `POST /api/cot-respuesta/quotations/:quoteId/agreement-sync`: después del acuerdo, alinea el anticipo de la fila de la cotización manual.
*   Front: `quote-respond-dialog.js` + `quote-respond-model.js` (`WeotziData.QuoteRespond`). Otro módulo reabre el diálogo precargado con el evento `wo:quote-respond` (`detail: { quoteId, prefill }`).

### Negociación y cambios al acuerdo (ronda 2 · frente negociacion)
Migración `20261116140000_negociacion_propuestas.sql`. Guía completa: [NEGOCIACION_COTIZACION.md](NEGOCIACION_COTIZACION.md). Rutas en [`lib/routes/negociacion.js`](../lib/routes/negociacion.js). Todas piden Bearer y que el usuario sea parte de la cotización.
*   `GET /api/negociacion/quotations/:quoteId[?as=client|artist]`: permisos, valores vigentes, propuesta pendiente, historial y si el acuerdo está aprobado por las dos partes.
*   `POST /api/negociacion/quotations/:quoteId/proposals` `{ kind, changes, note? }`: `counter` (el cliente propone cambios sobre la propuesta del artista: presupuesto, zona, tamaño, estilo, color, idea) o `amendment` (cualquiera de los dos propone cambiar el acuerdo aprobado: precio, sesiones, anticipo, condiciones). Reemplaza a la pendiente anterior.
*   `POST /api/negociacion/quotations/:quoteId/proposals/:proposalId/:action`: `accept` y `reject` los hace la contraparte; `withdraw`, quien propuso. Al aceptar, la base aplica los cambios en una transacción (RPC `negociacion_resolve`).
*   Base: tabla `quotation_proposals` (una sola pendiente por cotización), `quotations_db.agreement_approved_at` / `agreement_version` como marca única de "aprobada por ambas partes", y triggers que impiden editar el acuerdo aprobado por fuera de una propuesta. El rechazo del cliente es definitivo y cierra el chat para los dos.
*   Emails server-only en `services/email-events/negociacion.js` (`negotiation_*`).

### Sesiones: confirmación, cambios, registro y disputa (ronda 2 · frente sesiones)
Migración `20261116150000_sesiones_confirmacion_ubicacion.sql`. Rutas en [`lib/routes/sesiones.js`](../lib/routes/sesiones.js), lógica en `lib/sesiones.js`; las reglas son las de `public/shared/js/wo-session-model.js` y la base las vuelve a validar.
*   Reglas: la sesión que agenda el artista nace por confirmar; el cliente la confirma o pide otra fecha. Confirmada, se cambia solo con acuerdo de las dos partes y hasta 3 días antes. Las sesiones pasadas no se modifican: se califican y admiten disputa. Un turno reservado online nace confirmado si el artista no movió la hora.
*   Cliente o artista: `GET /api/sesiones/quotations/:quoteId`, `POST /api/sesiones/:sessionId/change-requests` `{ proposed_date, note, duration_hours?, location… }`, `POST /api/sesiones/change-requests/:requestId/respond` `{ decision, note }` (la otra parte), `POST …/:requestId/withdraw` (quien lo pidió), `POST /api/sesiones/:sessionId/feedback` `{ rating, note }` y `POST /api/sesiones/:sessionId/dispute` `{ reason, description }`.
*   Cliente: `GET /api/sesiones/mine` (panel "Mis sesiones") y `POST /api/sesiones/:sessionId/confirm`. Artista: `GET /api/sesiones/locations[?quote=<quote_id>]` (sedes, ubicaciones propias y la que eligió el cliente).
*   Base: columnas `client_confirmation`, `client_confirmed_at`, `location_kind`, `location_ref` y `location_place_id` en `quotation_sessions`; tablas `quotation_session_change_requests`, `quotation_session_feedback` y `quotation_session_disputes`; RPC `sesiones_*` solo `service_role`; trigger `sesiones_guard` (el navegador del artista no decide la confirmación del cliente ni cambia una sesión confirmada sin acuerdo).
*   Límites: 120 escrituras cada 15 min por IP; pedir o retirar un cambio, 20; la base corta en 6 pedidos de cambio por sesión, por persona y por día (`429 change_limit`).
*   La disputa abre un ticket `kind='disputa'` que soporte resuelve en `/api/support/disputes` (sección Denuncias). Emails server-only en `services/email-events/sesiones.js` (`session_*`).

### Expediente, hoja compartible y enlace público (ronda 2 · frente cot-detalle)
Migración `20261116130000_quotation_share_links.sql`. Rutas en [`lib/routes/cot-detalle.js`](../lib/routes/cot-detalle.js). La regla de contacto está en la sección 7.1.
*   Artista (Bearer; siempre se verifica que la cotización sea suya): `GET /api/cot-detalle/quotations/:quoteId/info` (contacto, si el cliente está registrado y estado de los enlaces), `GET …/client-profile` (perfil reducido del cliente, historial con ese artista y reseñas), `GET …/sheet` (hoja para PDF o imagen), `POST …/share` `{ days }` (crea un enlace, hasta 366 días) y `DELETE …/share[?id=]` (lo revoca). `GET /api/cot-detalle/client-contacts` alimenta el buscador de la cotización manual.
*   Público: `GET /api/cot-detalle/public/:token` (hoja sin datos de salud ni de contacto), `POST /api/cot-detalle/public/:token/claim` (Bearer: vincula la cotización a la cuenta) y la página `GET /cotizacion/:token`. En la base solo se guarda el SHA-256 del token (`quotation_share_links`, sin policies).
*   "Mismo contacto": el expediente lista las otras cotizaciones del mismo correo o teléfono con ese artista (`WeotziData.Quotations.listSameContact` → RPC `quotation_same_contact`).
*   Email server-only: `shared_quotation_linked` (al artista, cuando el cliente vincula la cotización).

### Perfil público: insignias, Most Wanted y compartidos (ronda 2 · frente perfil)
Migración `20261116180000_perfil_insignias_most_wanted.sql`. Guía completa: [PERFIL_INSIGNIAS.md](PERFIL_INSIGNIAS.md). Rutas en [`lib/routes/perfil.js`](../lib/routes/perfil.js).
*   `POST /api/artist/profile-share` `{ artist_username | artist_id, channel }`: anónimo, con límite de frecuencia. Guarda en `artist_profile_shares` (solo `service_role`).
*   `POST /api/perfil/most-wanted/recalculate` (`X-Cron-Token`): llama a `recalculate_most_wanted`, que llena `artist_trend_scores` y `artist_most_wanted`. También corre solo cada `MOST_WANTED_INTERVAL_HOURS` (12 por defecto; `0` apaga el ciclo de Node) y avisa a quien gana la insignia con `artist_most_wanted_awarded` (`MOST_WANTED_EMAILS=off` lo apaga).
*   Campo público: RPC `get_artist_public_badges(p_artist_user_id)` (Embajador y Most Wanted, sin conteos). La tarjeta Open Graph que compone el artista queda en `artist_share_cards` y se usa como `og:image`.

### Favoritos del cliente (ronda 2 · frente favoritos)
Migración `20261116190000_favoritos_listas.sql`. Sin rutas propias en el servidor: el navegador lee y escribe por la capa de datos con la sesión del dueño (RLS).
*   Tablas `favorite_lists` y `favorite_items` (`kind`: `artist`, `design`, `merch`, `studio`); topes de 50 listas por usuario y 500 ítems por lista. `client_favorites` queda como espejo en los dos sentidos.
*   Capa de datos: `WeotziData.FavoriteLists` (listas, ítems y contadores públicos) y `WeotziData.Favorites` (firma anterior, ahora sobre las listas). RPC `favorites_save` y `favorites_default_list_id`.
*   Front: `<button data-wo-favorite data-kind data-id data-label data-image>` lo activa `public/shared/js/wo-favorites.js`, que `config-manager.js` carga solo en páginas con corazones. La página es `/client/favorites`.

### Inbox: voz, mensajes rápidos y respuestas automáticas (ronda 2 · frente inbox)
Migraciones `20261116160000`, `20261116160100` y `20261116160200`. Sin rutas propias en el servidor ni correos nuevos.
*   Voz: el audio se graba en el navegador (`wo-voice.js`) y se sube como adjunto a `chat-attachments` o `inbox-attachments`; tope de 6 MB (la base lee el tamaño y el tipo del objeto real en Storage) y 3 minutos. Columna `attachment_duration_ms`; RPC `send_inbox_voice_message` para el inbox unificado.
*   Mensajes rápidos: `artist_message_templates` (`kind = 'chat'`; `kind = 'quote'` son las respuestas de cotización) y `client_message_templates`, con RLS de dueño (`WeotziData.QuickReplies`, `wo-quick-replies.js`).
*   Respuestas automáticas del artista: saludo al primer mensaje de un cliente y aviso de ausencia fuera de horario o en vacaciones (`artist_inbox_automations`, `WeotziData.InboxAutomations`). Las manda la base con triggers en `chat_messages` e `inbox_messages` y quedan marcadas con `auto_kind`.

### Panel del cliente y registro (ronda 2)
*   `GET /api/client/panel/notification-matrix` ([`lib/routes/cliente-panel.js`](../lib/routes/cliente-panel.js)): eventos, canales y valores por defecto de las notificaciones del cliente, de `lib/notification-prefs.js`. No lee datos de ninguna cuenta; cada cliente guarda sus preferencias con su propia sesión (`user_preferences`).
*   `GET /api/register/confirmation-status?uid=<uuid>` ([`lib/routes/registro.js`](../lib/routes/registro.js)): responde solo `{ confirmed }`, para que la pestaña "Falta confirmar email" siga sola. Un uid inexistente responde igual que una cuenta sin confirmar.

## 4. Flujos de Datos Críticos

### Creación de Cotización
1.  Cliente llena formulario en `/quotation`; el borrador vive en localStorage y, con correo, en el servidor (`POST /api/quotations/intake`, debounce 1,5 s).
2.  Envío: borrador → subida de referencias al bucket `quotation-references` (folder del borrador) → `mode: submit` con los paths.
3.  Sin artista: el último paso muestra artistas sugeridos (`/api/quotations/suggestions`) o publica la idea en el Job Board (`/api/quotations/intake/job-board`).
4.  El servidor registra las referencias, manda los avisos y, si está configurado, copia las referencias a Drive.
5.  El navegador nunca escribe `quotations_db`, `quotations_attachments` ni `quotation_intake_extras` (RLS cerrada en `20261115130000_cot_form_rls_cierre.sql`).

### Backup y Restauración
1.  Admin solicita backup desde `/backoffice` o `/installer`.
2.  Backend (`installer/server.js` o endpoint de backup) recopila:
    *   Dumps de base de datos (JSON).
    *   Archivos `public/`.
    *   Configuraciones.
3.  Genera archivo ZIP descargable.
4.  Para restaurar, se usa `node setup.js` que levanta un servidor temporal para cargar el ZIP.

## 5. Pre Cotizador (`/pre-cotizador`)

Herramienta independiente que entrega un rango de costo aproximado del tatuaje y sugiere artistas compatibles antes de que el cliente entre al wizard completo. Reutiliza por completo el sistema visual del flujo de cotización.

### Componentes

*   **Página**: [`public/pre-cotizador/index.html`](../public/pre-cotizador/index.html). Usa `styles.css` y los mismos componentes Bauhaus (`.app-container`, `.app-header`, `.question-container`, `.btn`, `.artist-card`, `.loading-overlay`).
*   **CSS adapter**: [`public/shared/css/pre-quote.css`](../public/shared/css/pre-quote.css) — solo capas de layout específicas, prefijo `prequote-`.
*   **Frontend**: [`public/shared/js/pre-quote.js`](../public/shared/js/pre-quote.js).
*   **Constantes compartidas**: [`public/shared/js/quotation-shared.js`](../public/shared/js/quotation-shared.js) — `TATTOO_SIZE_OPTIONS`, `TATTOO_STYLE_OPTIONS`, `toTitleCase`, `formatTattooStyleForDisplay`. Se carga también en `/quotation` antes de `script.js`, así no hay listas duplicadas.
*   **Backend**: `POST /api/pre-quote/estimate` en [`server.js`](../server.js).
*   **Lógica pura**: [`lib/prequote-estimator.js`](../lib/prequote-estimator.js).
*   **Pruebas**: `npm run test:prequote`.

### Flujo

1. El cliente ingresa idea, estilo, tamaño, zona y ciudad.
2. La página llama `POST /api/pre-quote/estimate`. El servidor consulta `artists_db` y delega a `estimatePreQuote` para calcular rango y artistas.
3. La UI muestra rango (min/max), sesiones estimadas, confianza y hasta 6 artistas sugeridos usando las clases existentes `.artist-card` y `.artist-meta`.
4. Al hacer clic en "Cotizar con este artista", la página guarda un handoff en `localStorage` (`weotzi_prequote_handoff`, TTL 30 min) con los campos compatibles del flujo normal y redirige a `/quotation?artist=<username>&source=prequote`.
5. `script.js` detecta `source=prequote`, aplica el handoff a `formData`, salta los pasos ya completados y aterriza en el primer campo faltante (color, referencias, datos del cliente).

### Reglas de costo (V1)

*   Sesiones por tamaño: `pequeño=1`, `mediano=1-2`, `grande=2-3`, `muy_grande=3-5`, `media_manga=3-5`, `manga_completa=6-10`, `espalda_completa=6-10`, `pecho_completo=4-7`.
*   Tier de match: `1` ciudad+estilo, `2` país+estilo, `3` estilo, `4` ciudad, `5` fallback.
*   Rango: `minAmount = p25(price) * sessionsMin`, `maxAmount = p75(price) * sessionsMax`. La moneda se hereda del primer artista del sample.
*   Confianza: `alta` con 5+ matches tier 1, `media` con 3+ matches tier 1+2 o 3+ precios válidos, `baja` en cualquier otro caso.

### Compatibilidad

*   `applyPrequoteHandoff()` solo corre cuando la URL trae `source=prequote`; no afecta visitas normales a `/quotation`.
*   Si no se carga `quotation-shared.js`, `script.js` cae en sus listas inline (compat hacia atrás).
*   El payload final reusa columnas existentes (`tattoo_estimated_sessions`, `source`); no se introduce migración para esta versión.

## 6. Convenciones Frontend

### 6.1 Cliente Supabase compartido (singleton `window._supabase`)

Antes de 2026-05-13 multiples scripts en `public/shared/js/` instanciaban su propio cliente Supabase al cargar (`const _supabase = supabase.createClient(...)`), lo que en paginas donde coincidian dos o mas scripts producia el warning del SDK:

```
Multiple GoTrueClient instances detected in the same browser context.
```

El problema no era solo cosmetico: dos instancias compartiendo la misma `storageKey` (`sb-<ref>-auth-token` en `localStorage`) pueden generar race conditions al refrescar el JWT, duplicar `onAuthStateChange` listeners y machacarse mutuamente en escrituras a storage.

**Patron actual**: todo script que necesite el cliente Supabase debe reusar el global:

```js
const _supabase = (window._supabase = window._supabase || supabase.createClient(supabaseUrl, supabaseKey));
```

`config-manager.js` (`getSupabaseClient()`) tambien lee y escribe `window._supabase`, de modo que el primer script que cargue (suele ser `main.js` o `config-manager.js` bajo demanda) crea la unica instancia y los demas la reutilizan.

**Excepciones deliberadas**:

*   `admin.js` lineas 395 y 3343: clientes efimeros (`testClient`) usados por el superadmin para probar URL/key arbitrarios desde un formulario del backoffice. No deben compartir el singleton porque su proposito es validar credenciales potencialmente distintas a las globales.

### 6.2 Microsoft Clarity y banner de cookies (consentimiento)

**Vigente (ronda 3c · privacidad):** ninguna página carga Clarity por su cuenta. Todas las páginas de `public/` incluyen `/shared/js/wo-consent.js`, que lee `GET /api/privacy/cookie-config` (configurable en el backoffice → *Cookies y privacidad*, guardado en `app_settings.cookie_consent_config`) y solo inyecta `https://www.clarity.ms/tag/<id>` si la persona aceptó la categoría Analítica. Respeta Global Privacy Control, guarda la elección en `localStorage.wo_cookie_consent` + cookie `wo_consent` (versión y fecha) y, con sesión, en `user_preferences.privacy.cookie_consent` + `cookie_consent_log` (migración `20261113105000`). El ID de Clarity sale del backoffice o, si está vacío, de `CLARITY_PROJECT_ID` del servidor. `[data-wo-cookie-settings]` reabre el panel. Lo que sigue es histórico.

#### Histórico: Clarity opt-in por entorno

El snippet de Clarity en los 6 HTML que lo cargan (`registerclosedbeta`, `marketplace`, `quotation`, `artist/dashboard`, `artist/profile`, `job-board`) esta envuelto en un guard:

```js
(function(){
    var id = window.CLARITY_PROJECT_ID;
    if (!id || id === 'CLARITY_TRACKING_ID') return;
    // ... inyeccion estandar de Clarity ...
})();
```

Para activar Clarity en un entorno determinado, define `window.CLARITY_PROJECT_ID = '<project_id_real>'` antes del bloque. La forma recomendada es inyectarlo desde el servidor segun `NODE_ENV` o desde un script de configuracion compartido. Sin esa variable definida, el snippet es un no-op (no genera el 400 que producia antes el placeholder literal).

### 6.3 Flujo de registro pre-auth

Ver [ARTIST_SIGNUP_FLOW.md](./ARTIST_SIGNUP_FLOW.md) para el detalle. Resumen:

*   El frontend NO escribe directamente a `artists_db` durante el wizard. Todas las operaciones de draft pasan por `POST /api/register/artist-draft` (service role, evita RLS de anon).
*   `auth.users` se crea solo en `POST /api/register/artist-finalize` cuando el usuario confirma el resumen final.
*   El trigger SQL `handle_new_user` (migracion `20260513000000_artist_registration_drafts.sql`) vincula la fila de `artists_db` con el nuevo `auth.users` por email, evitando duplicados.

## 7. Seguridad

*   **Credenciales**: Las claves de API (Google, Supabase) se manejan via variables de entorno o se pasan de forma segura desde el cliente autenticado (dependiendo del endpoint).
*   **CORS**: Configurado implícitamente al servir frontend desde el mismo origen.
*   **Body Parser limit**: 50MB para permitir subida de imágenes en base64 si es necesario (aunque se prefiere URL).

### 7.1 Contacto del cliente en las cotizaciones (ronda 2 · P20 / P23)

Regla (`lib/cot-detalle.js` → `contactAccess`): el artista ve el email, WhatsApp, Instagram y la preferencia de contacto del cliente solo si su perfil está verificado (`artists_db.verification_state = 'Yes'`) y el cliente no rechazó la cotización. En las cotizaciones manuales (el contacto lo cargó el propio artista) se ve siempre.

Dónde se aplica:

*   `GET /api/cot-detalle/quotations/:quoteId/info`: contacto del expediente.
*   `GET /api/cot-detalle/client-contacts`: buscador de clientes de la cotización manual (`/my-quotations/new`). Devuelve nombre, ciudad y fecha de cada cotización del artista; el contacto solo donde la regla lo permite. El navegador ya no lee esas columnas (`WeotziData.Quotations.listClientNamesForArtist` es el respaldo, solo nombres).
*   Base (migración `20261116220000`): `fn_quotations_client_column_guard` impide que un usuario final, artista dueño incluido, cambie `source`, `quotation_medium` (no puede marcar una recibida como manual) o `client_user_id` (solo el cliente vincula su cotización de invitado a su propia cuenta).
*   Vista `chat_threads` (migración `20261116220100`): ya no incluye `client_email`.
*   Enlace público `/cotizacion/<token>` (`claimVerdict`): para vincular, la cuenta tiene que ser la del correo de la cotización y tenerlo verificado. Vale para las recibidas y para las manuales con correo cargado; la manual sin correo se vincula con solo el enlace y toma el de la cuenta. El aviso al artista (`shared_quotation_linked`) dice qué cuenta la vinculó en las manuales.

**Decisión de producto anotada (SEG-02), pendiente del dueño.** Si el artista escribió mal el correo del cliente en una cotización manual, nadie puede vincularla hasta que ese correo se corrija. Hoy no hay pantalla para editar el correo de una manual ya enviada: el artista arma otra cotización con el correo correcto o lo corrige soporte. Una vez vinculada, el artista no puede desvincular (la guarda de `20261116220000` lo impide por REST): deshacer un vínculo también lo hace soporte con `service_role`; no hay endpoint para ninguna de las dos cosas.

**Riesgo residual (abierto).** La regla vive en el servidor y en la interfaz, no en la base: la policy `Artists can view own quotations` entrega todas las columnas de las cotizaciones del artista, así que un artista sin verificar todavía puede leer `client_email`, `client_whatsapp`, `client_instagram` y `client_contact_preference` llamando a la API REST de Supabase con su propia sesión (`select=*` o esas columnas). También viajan en los lectores del navegador que usan `select('*')` sobre `quotations_db` (por ejemplo `quotation-detail-repo.js` y `quotations-repo.js`), aunque la interfaz no los pinte.

**Pendiente de fondo (tamaño grande).** (1) Pasar todos los `select('*')` del navegador sobre `quotations_db` a listas explícitas de columnas sin las de contacto (hay 11 lectores entre artista, cliente y admin); (2) `revoke select` de la tabla a `authenticated` y `grant select` por columnas sin `client_email`, `client_whatsapp`, `client_instagram` ni `client_contact_preference` (el cliente lee su propio contacto por un endpoint o una vista propia); (3) dejar el contacto solo en los endpoints de `/api/cot-detalle`. El frente cot-detalle probó en vivo (dentro de `begin … rollback`) que el `revoke` rompe los `select('*')` actuales: por eso el orden es primero (1) y después (2).
