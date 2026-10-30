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
*   **IA Generativa**: Google Gemini API (modelo `gemini-3-pro-image-preview`) para generación de imágenes.

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
*   `POST /api/gemini/generate-image`: Genera imágenes de tatuajes usando Gemini.
    *   Body: `{ prompt, model, aspectRatio, imageSize, temperature, safetySettings }`. La API key se lee desde `GEMINI_API_KEY` en el entorno del servidor.

### Google Drive Integration
*   `POST /api/google-drive/test`: Verifica conexión y permisos de carpeta.
*   `POST /api/google-drive/create-quote-folder`: Crea carpeta para cotización y sube archivos.
    *   Lógica: Busca carpeta existente -> Si no, crea nueva -> Descarga archivos de URL -> Sube a Drive.

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
*   `GET /api/client-info`: Retorna IP y timestamp del cliente.
*   `POST /api/session-log`: Endpoint para `sendBeacon` (logs de sesión al cerrar pestaña).

### Store
Contrato completo en [`docs/plans/2026-10-30-store-artista.md`](plans/2026-10-30-store-artista.md) (§7). Handlers en [`services/store-orders.js`](../services/store-orders.js) (testeables con `createHandlers(deps)`), datos en [`lib/repos/store.js`](../lib/repos/store.js) (service role), firma de Storage en [`lib/storage-sign.js`](../lib/storage-sign.js) y adaptadores de pago en [`services/store-payments.js`](../services/store-payments.js). Todas las respuestas son `{ success, error? }` con `Cache-Control: no-store`; los 500 son genéricos (el detalle queda en el log). Los ids de la URL tienen que ser UUID (si no, 400).

> **`features.store` es solo un gate de UI.** Ni estos endpoints ni las RPC/policies de `store_core` lo consultan: con la migración aplicada, la Store se puede operar por API (publicar productos, crear pedidos, ver la vitrina pública) aunque el flag esté en `false`. Hasta que el SQL tenga su propio gate, la migración se aplica recién en la ventana de lanzamiento, junto con el flag.

*   `POST /api/store/licenses/:licenseId/assets/:assetId/url`: URL firmada para bajar el original o el stencil de una licencia.
    *   Headers: `Authorization: Bearer <supabase_access_token>`. Rate limit: `storeDownloadLimiter` (60 cada 15 min por IP).
    *   Lógica: la licencia tiene que ser del titular (`holder_user_id`) o del comprador del pedido (si no, o si no existe, 403) y no estar revocada (410). El asset tiene que ser del mismo producto (404). Tope de 50 descargas por licencia en una ventana móvil de 24 h (429): primero registra la fila en `store_download_events` y después recuenta incluyéndola; si se pasó del tope, la borra y responde 429. Así, ni con requests en paralelo se emiten más de 50 URLs (en una ráfaga justo en el tope puede rechazar de más). Después firma en `store-design-files` por **300 s fijos** con `download = file_name`.
    *   Respuesta: `{ success: true, url, expires_in: 300 }`.
*   `POST /api/store/orders/:id/checkout`: inicia el pago con el adaptador del pedido (`payment_provider`).
    *   Headers: `Authorization: Bearer <supabase_access_token>`. Solo el comprador dueño (si no, 404) y con el pedido `pending_payment` y sin vencer (409). Adaptador no registrado o sin configurar: 503.
    *   Respuesta: `{ success: true, checkout: { mode, instructions?, redirectUrl? } }`. `redirectUrl` siempre es `https://`. En modo `manual` el front no lo llama: pinta las instrucciones desde la fila.
*   `POST /api/store/maintenance`: corre `run_store_maintenance()` (vencimientos, pagos informados vencidos, entregas automáticas y liberación de fondos). Lo dispara un job de n8n cada hora.
    *   Headers: `X-Cron-Token: <CRON_API_TOKEN>` (comparación en tiempo constante). Token ausente o distinto: 401; sin `CRON_API_TOKEN` en el servidor: 503.
    *   Respuesta: `{ success: true, result: { expired, flagged, delivered, released, failed: [ids] } }`.
*   `POST /api/store/payments/webhook/:provider`: aviso de pago de un proveedor real (Stripe, Mercado Pago; hoy ninguno registrado, así que responde 404).
    *   Body crudo (`express.raw({ type: '*/*', limit: '1mb' })`), registrado **antes** de `app.use(express.json(...))` para que la firma se calcule sobre los bytes exactos. `apiLimiter` lo saltea (`skip`) y tiene su propio limiter (120/min).
    *   Lógica: sin adaptador con `parseWebhook` → 404. Con adaptador: `verifyWebhook(rawBody, headers)` (HMAC con `crypto.timingSafeEqual`; si falla, 401) → `parseWebhook` (`null` o un evento que no es `payment_succeeded` → 200 `{ ignored: true }`; ilegible o inválido → 400) → RPC `confirm_store_order_payment_as_provider` → 200. Un error `store:<código>` de la RPC responde 422; cualquier otro, 500 (el proveedor reintenta).

## 4. Flujos de Datos Críticos

### Creación de Cotización
1.  Cliente llena formulario en `/quotation`.
2.  Frontend guarda datos en Supabase.
3.  Frontend llama a `/api/google-drive/create-quote-folder` en el backend.
4.  Backend autentica con Service Account de Google.
5.  Backend crea estructura de carpetas en Drive y transfiere imágenes.

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

### 6.2 Microsoft Clarity opt-in por entorno

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
